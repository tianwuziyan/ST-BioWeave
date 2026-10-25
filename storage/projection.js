import {floorVersionFromData, hasCompleteFloorVersion, sameFloorVersion} from '../runtime/floor.js'
import {
  appendProjectionCreation,
  appendProjectionEvidence,
  appendProjectionDelivery,
  appendProjectionLifecycle,
  appendProjectionObservation,
  appendProjectionTriggeredSnapshot,
  appendProjectionStorylineSnapshot,
  appendProjectionStorylineDelivery,
  emptyProjectionTimeline,
  evolutionDecisionToLifecycleRecord,
  normalizeProjectionTimeline,
  resolveProjectionTimeline,
} from '../core/projection-persistence.js'
import {
  createProjectionEvidenceRecord,
  createProjectionDeliveryRecord,
  createProjectionLifecycleRecord,
  createProjectionObservationRecord,
  createProjectionTriggeredSnapshot,
  validateProjection,
} from '../core/projection.js'
import {cloneValue, emptyFloor} from './schema.js'
import {createFloorPersistenceCoordinator} from '../runtime/floor-persistence.js'
import {createStorylineSnapshot} from '../core/projection-storyline.js'

function error(code) { const result = new Error(code); result.code = code; return result }
function ownerSelector(owner = {}) {
  // The Floor store addresses the chat-array slot; message_id is provenance
  // and must remain a fallback rather than an array index.
  return owner.message_index ?? owner.messageIndex ?? owner.index
    ?? owner.message_id ?? owner.messageId;
}
function ownerSwipe(owner = {}, version = {}) { return Number(owner.swipe_id ?? owner.swipeId ?? version.swipe_id) }
function assertRecordVersion(record, version) {
  if (!sameFloorVersion(record?.created_at_floor_version, version)) throw error('FLOOR_VERSION_STALE')
}

function assertCharacterOwner(store, owner, version) {
  const selector = ownerSelector(owner)
  if (selector === undefined || selector === null) throw error('FLOOR_OWNER_REQUIRED')
  const swipeId = ownerSwipe(owner, version)
  if (!Number.isInteger(swipeId) || swipeId < 0) throw error('SWIPE_REQUIRED')
  const metadata = store.getFloorOwner?.(selector, swipeId)
  if (!metadata || metadata.owner_type !== 'character') throw error('BIOWEAVE_USER_FLOOR_WRITE_FORBIDDEN')
  if (metadata.active_swipe_id !== swipeId) throw error('ACTIVE_SWIPE_STALE')
  const floorData = store.getFloor(selector, swipeId) ?? emptyFloor()
  const storedVersion = floorVersionFromData(floorData)
  if (!hasCompleteFloorVersion(storedVersion) || !sameFloorVersion(storedVersion, version)) throw error('FLOOR_VERSION_STALE')
  if (String(version.chat_id) !== String(owner.chat_id ?? version.chat_id)) throw error('CHAT_SCOPE_MISMATCH')
  return {selector, swipeId, floorData, metadata}
}

export function createProjectionPersistence({store, resolveCurrentFloorVersion = null, enabledResolver = () => true, floorPersistence = null, emit = null} = {}) {
  if (!store || typeof store.getFloor !== 'function' || typeof store.saveFloor !== 'function') throw new TypeError('PROJECTION_STORE_REQUIRED')
  const resolveVersion = resolveCurrentFloorVersion ?? store.getCurrentFloorVersion
  const persistence = floorPersistence ?? createFloorPersistenceCoordinator({store, enabledResolver, emit})

  function assertEnabled() {
    if (enabledResolver() !== false) return
    throw error('BIOWEAVE_DISABLED')
  }

  async function resolveOwner(input) {
    const chatId = input.chatId ?? input.chat_id
    const version = input.floorVersion ?? input.floor_version
    if (!chatId || !hasCompleteFloorVersion(version)) throw error('FLOOR_VERSION_REQUIRED')
    if (String(version.chat_id) !== String(chatId)) throw error('CHAT_SCOPE_MISMATCH')
    const owner = {...(input.ownerFloor ?? input.owner ?? {}), chat_id: chatId}
    const resolved = assertCharacterOwner(store, owner, version)
    if (typeof resolveVersion !== 'function') throw error('FLOOR_VERSION_RESOLVER_REQUIRED')
    const current = await resolveVersion({chatId, ownerFloor: owner, floorVersion: version, swipeId: resolved.swipeId})
    if (!sameFloorVersion(current, version)) throw error('FLOOR_VERSION_STALE')
    return {...resolved, chatId, version}
  }

  async function mutateFloor(input, mutate) {
    assertEnabled()
    const resolved = await resolveOwner(input)
    const existingRoot = resolved.floorData.projection_timeline
    for (const collection of ['creations', 'evidence_records', 'lifecycle_records', 'delivery_records', 'observation_records', 'triggered_snapshots', 'storyline_snapshots', 'storyline_delivery_records']) {
      for (const record of existingRoot?.[collection] ?? []) assertRecordVersion(record, resolved.version)
    }
    // Delivery/lifecycle records may still point at a historical stage that
    // the endpoint resolver hides from the current product view. Validation
    // must therefore use all surviving historical creation IDs, not only the
    // latest visible stage.
    const {historicalProjectionIds: knownProjectionIds} = await readProjectionTimelineEntries({
      chatId: resolved.chatId,
      endpointIndex: resolved.selector,
      endpointFloor: resolved.version.floor,
    })
    const normalized = normalizeProjectionTimeline(resolved.floorData.projection_timeline, {expectedChatId: resolved.chatId, knownProjectionIds})
    if (normalized.conflicts.length || normalized.rejected.length) throw error('PROJECTION_TIMELINE_INVALID')
    const currentTimeline = normalized.timeline
    const result = mutate(currentTimeline, resolved, knownProjectionIds)
    if (result.status === 'rejected' || result.status === 'conflict') throw error(result.code)
    const rebaseAtCommit = input.rebaseAtCommit === true
    if (!rebaseAtCommit && result.status === 'deduped' && !normalized.normalized) {
      return {status: result.status, timeline: currentTimeline, authoritativeReadback: false}
    }
    assertEnabled()
    const commitInput = {
      owner: 'projection',
      chatId: resolved.chatId,
      ownerFloor: {
        message_index: resolved.selector,
        message_id: resolved.version.message_id,
      },
      swipeId: resolved.swipeId,
      floorVersion: resolved.version,
      operation_type: 'projection-timeline-patch',
      traceContext: input.traceContext ?? {},
    }
    if (rebaseAtCommit) {
      // Storyline snapshots are complete-collection writes. Re-evaluate the
      // mutation against the coordinator's latest Floor immediately before
      // saving, otherwise two parallel subject requests can carry the same
      // stale timeline and the later one can erase the earlier sibling.
      commitInput.patchResolver = ({latest, expected}) => {
        const latestRoot = latest?.projection_timeline ?? emptyProjectionTimeline()
        const latestNormalized = normalizeProjectionTimeline(latestRoot, {expectedChatId: resolved.chatId, knownProjectionIds})
        if (latestNormalized.conflicts.length || latestNormalized.rejected.length) throw error('PROJECTION_TIMELINE_INVALID')
        const latestResult = mutate(latestNormalized.timeline, {
          ...resolved,
          version: expected,
          floorData: latest,
        }, knownProjectionIds)
        if (latestResult.status === 'rejected' || latestResult.status === 'conflict') throw error(latestResult.code)
        return {projection_timeline: latestResult.timeline}
      }
    } else {
      commitInput.patch = {projection_timeline: result.timeline}
    }
    const persistenceResult = await persistence.commitFloorPatch(commitInput)
    return {
      status: result.status,
      timeline: persistenceResult?.floor?.projection_timeline ?? result.timeline,
      authoritativeReadback: persistenceResult?.authoritativeReadback === true,
    }
  }

  async function saveGeneratedProjection({chatId, ownerFloor, floorVersion, projectionCandidate, traceContext = {}} = {}) {
    return saveProjectionBatch({chatId, ownerFloor, floorVersion, traceContext, records: [{projectionCandidate}]})
  }

  async function saveProjectionEvidence({chatId, ownerFloor, floorVersion, evidenceRecord, traceContext = {}} = {}) {
    return saveProjectionBatch({chatId, ownerFloor, floorVersion, traceContext, records: [{evidenceRecord}]})
  }

  async function saveProjectionBatch({chatId, ownerFloor, floorVersion, records = [], traceContext = {}} = {}) {
    if (!Array.isArray(records) || records.length === 0) throw error('PROJECTION_BATCH_RECORDS_REQUIRED')
    const normalizedRecords = records.map(item => {
      const projectionCandidate = item?.projectionCandidate ?? null
      const evidenceInput = item?.evidenceRecord ?? null
      if (projectionCandidate) {
        const validation = validateProjection(projectionCandidate, {expectedChatId: chatId})
        if (!validation.ok) throw error(validation.errors[0])
        assertRecordVersion(projectionCandidate, floorVersion)
      }
      let evidenceRecord = null
      if (evidenceInput) {
        evidenceRecord = createProjectionEvidenceRecord(evidenceInput)
        if (evidenceInput.evidence_record_id && evidenceInput.evidence_record_id !== evidenceRecord.evidence_record_id) throw error('evidence_record_id:not_deterministic')
        assertRecordVersion(evidenceRecord, floorVersion)
      }
      if (!projectionCandidate && !evidenceRecord) throw error('PROJECTION_BATCH_RECORD_REQUIRED')
      return {projectionCandidate, evidenceRecord}
    })
    return mutateFloor({chatId, ownerFloor, floorVersion, traceContext}, (timeline, resolved, knownProjectionIds) => {
      let nextTimeline = timeline
      let changed = false
      for (const {projectionCandidate, evidenceRecord} of normalizedRecords) {
        if (projectionCandidate) {
          const creation = appendProjectionCreation(projectionCandidate, {timeline: nextTimeline, expectedChatId: chatId})
          if (creation.status === 'rejected' || creation.status === 'conflict') return creation
          nextTimeline = creation.timeline
          if (creation.status === 'appended') changed = true
          knownProjectionIds.add(projectionCandidate.projection_id)
        }
        if (evidenceRecord) {
          const evidence = appendProjectionEvidence(evidenceRecord, {timeline: nextTimeline, expectedChatId: chatId, knownProjectionIds})
          if (evidence.status === 'rejected' || evidence.status === 'conflict') return evidence
          nextTimeline = evidence.timeline
          if (evidence.status === 'appended') changed = true
        }
      }
      return {status: changed ? 'appended' : 'deduped', timeline: nextTimeline}
    })
  }

  async function saveProjectionLifecycleBatch({chatId, ownerFloor, floorVersion, records = [], traceContext = {}} = {}) {
    if (!Array.isArray(records) || records.length === 0) throw error('PROJECTION_LIFECYCLE_BATCH_RECORDS_REQUIRED')
    const normalizedRecords = records.map(lifecycleRecord => {
      const record = createProjectionLifecycleRecord(lifecycleRecord)
      if (lifecycleRecord?.lifecycle_id && lifecycleRecord.lifecycle_id !== record.lifecycle_id) throw error('lifecycle_id:not_deterministic')
      assertRecordVersion(record, floorVersion)
      return record
    })
    return mutateFloor({chatId, ownerFloor, floorVersion, traceContext}, (timeline, resolved, knownProjectionIds) => {
      let nextTimeline = timeline
      let changed = false
      for (const record of normalizedRecords) {
        const result = appendProjectionLifecycle(record, {timeline: nextTimeline, expectedChatId: chatId, knownProjectionIds})
        if (result.status === 'rejected' || result.status === 'conflict') return result
        nextTimeline = result.timeline
        if (result.status === 'appended') changed = true
      }
      return {status: changed ? 'appended' : 'deduped', timeline: nextTimeline}
    })
  }

  async function saveProjectionObservationBatch({chatId, ownerFloor, floorVersion, records = [], traceContext = {}} = {}) {
    if (!Array.isArray(records) || records.length === 0) throw error('PROJECTION_OBSERVATION_BATCH_RECORDS_REQUIRED')
    const normalizedRecords = records.map(input => {
      const record = createProjectionObservationRecord(input)
      if (input?.observation_id && input.observation_id !== record.observation_id) throw error('observation_id:not_deterministic')
      assertRecordVersion(record, floorVersion)
      return record
    })
    return mutateFloor({chatId, ownerFloor, floorVersion, traceContext}, (timeline, resolved, knownProjectionIds) => {
      let nextTimeline = timeline
      let changed = false
      for (const record of normalizedRecords) {
        const result = appendProjectionObservation(record, {timeline: nextTimeline, expectedChatId: chatId, knownProjectionIds})
        if (result.status === 'rejected' || result.status === 'conflict') return result
        nextTimeline = result.timeline
        changed ||= result.status === 'appended'
      }
      return {status: changed ? 'appended' : 'deduped', timeline: nextTimeline}
    })
  }

  async function saveProjectionTriggeredSnapshot({chatId, ownerFloor, floorVersion, subjectId, subject_id, stageCode, stage_code, triggered = [], status = 'active', traceContext = {}} = {}) {
    return saveProjectionTriggeredSnapshotBatch({chatId, ownerFloor, floorVersion, snapshots: [{subject_id: subjectId ?? subject_id, stage_code: stageCode ?? stage_code, triggered, status}], traceContext})
  }

  async function saveProjectionTriggeredSnapshotBatch({chatId, ownerFloor, floorVersion, snapshots = [], traceContext = {}} = {}) {
    if (!Array.isArray(snapshots) || snapshots.length === 0) throw error('PROJECTION_TRIGGERED_SNAPSHOT_BATCH_REQUIRED')
    const normalizedSnapshots = snapshots.map(input => createProjectionTriggeredSnapshot({...input, created_at_floor_version: floorVersion}))
    // A snapshot write is a complete current-Floor replacement. Use the
    // nearest prior authoritative snapshot as the base, then overlay the
    // subjects supplied by this operation. This keeps sibling people intact
    // while allowing an explicit terminated/empty subject snapshot to remove
    // only that person's current history.
    const priorEntries = (await readProjectionTimelineEntries({
      chatId,
      endpointIndex: ownerSelector(ownerFloor),
      endpointFloor: floorVersion.floor,
    })).entries.filter(entry => !sameFloorVersion(entry.floor_version, floorVersion))
    const priorViews = resolveProjectionTimeline(priorEntries)
    const priorBySubject = new Map((priorViews.triggered_snapshots ?? []).map(snapshot => [snapshot.subject_id, snapshot]))
    return mutateFloor({chatId, ownerFloor, floorVersion, traceContext}, (timeline, resolved, knownProjectionIds) => {
      const currentComplete = timeline.triggered_snapshot_complete === true
        || (timeline.triggered_snapshots ?? []).length > 0
      const bySubject = new Map((currentComplete ? timeline.triggered_snapshots : [...priorBySubject.values()]).map(snapshot => [snapshot.subject_id, snapshot]))
      for (const snapshot of normalizedSnapshots) bySubject.set(snapshot.subject_id, snapshot)
      const merged = [...bySubject.values()]
        .map(snapshot => createProjectionTriggeredSnapshot({...snapshot, created_at_floor_version: resolved.version}))
        .sort((left, right) => String(left.subject_id).localeCompare(String(right.subject_id)))
      for (const snapshot of merged) {
        const validation = appendProjectionTriggeredSnapshot(snapshot, {timeline: {...timeline, triggered_snapshots: []}, expectedChatId: chatId, knownProjectionIds})
        if (validation.status === 'rejected' || validation.status === 'conflict') return validation
      }
      const previous = timeline.triggered_snapshots ?? []
      const changed = JSON.stringify(previous) !== JSON.stringify(merged) || timeline.triggered_snapshot_complete !== true
      return {
        status: changed ? 'appended' : 'deduped',
        timeline: {...timeline, triggered_snapshots: merged, triggered_snapshot_complete: true},
      }
    })
  }

  async function saveProjectionStorylineSnapshotBatch({chatId, ownerFloor, floorVersion, snapshots = [], traceContext = {}} = {}) {
    if (!Array.isArray(snapshots) || snapshots.length === 0) throw error('PROJECTION_STORYLINE_SNAPSHOT_BATCH_REQUIRED')
    const normalizedSnapshots = snapshots.map(input => createStorylineSnapshot({...input, created_at_floor_version: floorVersion}))
    const priorEntries = (await readProjectionTimelineEntries({chatId, endpointIndex: ownerSelector(ownerFloor), endpointFloor: floorVersion.floor})).entries.filter(entry => !sameFloorVersion(entry.floor_version, floorVersion))
    const priorViews = resolveProjectionTimeline(priorEntries)
    const priorBySubject = new Map((priorViews.storyline_snapshots ?? []).map(snapshot => [snapshot.subject_id, snapshot]))
    return mutateFloor({chatId, ownerFloor, floorVersion, traceContext, rebaseAtCommit: true}, (timeline, resolved) => {
      const currentComplete = timeline.storyline_snapshot_complete === true || (timeline.storyline_snapshots ?? []).length > 0
      const bySubject = new Map((currentComplete ? timeline.storyline_snapshots : [...priorBySubject.values()]).map(snapshot => [snapshot.subject_id, snapshot]))
      for (const snapshot of normalizedSnapshots) bySubject.set(snapshot.subject_id, snapshot)
      const merged = [...bySubject.values()].map(snapshot => createStorylineSnapshot({...snapshot, created_at_floor_version: resolved.version})).sort((a, b) => String(a.subject_id).localeCompare(String(b.subject_id)))
      for (const snapshot of merged) {
        const validation = appendProjectionStorylineSnapshot(snapshot, {timeline: {...timeline, storyline_snapshots: []}, expectedChatId: chatId})
        if (validation.status === 'rejected' || validation.status === 'conflict') return validation
      }
      const changed = JSON.stringify(timeline.storyline_snapshots ?? []) !== JSON.stringify(merged) || timeline.storyline_snapshot_complete !== true
      return {status: changed ? 'appended' : 'deduped', timeline: {...timeline, storyline_snapshots: merged, storyline_snapshot_complete: true}}
    })
  }

  async function saveProjectionStorylineDelivery({chatId, ownerFloor, floorVersion, record, traceContext = {}} = {}) {
    if (record?.floor_version && !sameFloorVersion(record.floor_version, floorVersion)) throw error('FLOOR_VERSION_STALE')
    return mutateFloor({chatId, ownerFloor, floorVersion, traceContext}, (timeline) => appendProjectionStorylineDelivery({...record, floor_version: record?.floor_version ?? floorVersion, created_at_floor_version: floorVersion}, {timeline, expectedChatId: chatId}))
  }

  async function saveProjectionLifecycle({chatId, ownerFloor, floorVersion, lifecycleRecord, traceContext = {}} = {}) {
    return saveProjectionLifecycleBatch({chatId, ownerFloor, floorVersion, traceContext, records: [lifecycleRecord]})
  }

  async function saveProjectionDeliveryBatch({chatId, ownerFloor, floorVersion, records = [], status, traceContext = {}} = {}) {
    if (!Array.isArray(records) || records.length === 0) throw error('PROJECTION_DELIVERY_BATCH_RECORDS_REQUIRED')
    const normalizedRecords = records.map(deliveryRecord => {
      const record = createProjectionDeliveryRecord({...deliveryRecord, status})
      if (deliveryRecord?.delivery_record_id && deliveryRecord.delivery_record_id !== record.delivery_record_id) throw error('delivery_record_id:not_deterministic')
      if (status === 'response_observed' && !record.response_id) throw error('delivery_response_id:required')
      assertRecordVersion(record, floorVersion)
      if (status === 'response_observed' && !sameFloorVersion(record.response_floor_version, floorVersion)) throw error('FLOOR_VERSION_STALE')
      return record
    })
    return mutateFloor({chatId, ownerFloor, floorVersion, traceContext}, (timeline, resolved, knownProjectionIds) => {
      let nextTimeline = timeline
      let changed = false
      for (const record of normalizedRecords) {
        const result = appendProjectionDelivery(record, {timeline: nextTimeline, expectedChatId: chatId, knownProjectionIds})
        if (result.status === 'rejected' || result.status === 'conflict') return result
        nextTimeline = result.timeline
        if (result.status === 'appended') changed = true
      }
      return {status: changed ? 'appended' : 'deduped', timeline: nextTimeline}
    })
  }

  async function saveProjectionDeliverySubmissionBatch({chatId, ownerFloor, floorVersion, records, traceContext = {}} = {}) {
    return saveProjectionDeliveryBatch({chatId, ownerFloor, floorVersion, records, status: 'readback_verified', traceContext})
  }

  async function saveProjectionDeliveryResponseBatch({chatId, ownerFloor, floorVersion, records, traceContext = {}} = {}) {
    return saveProjectionDeliveryBatch({chatId, ownerFloor, floorVersion, records, status: 'response_observed', traceContext})
  }

  async function saveProjectionDeliverySubmission({chatId, ownerFloor, floorVersion, deliveryRecord, traceContext = {}} = {}) {
    return saveProjectionDeliverySubmissionBatch({chatId, ownerFloor, floorVersion, records: [deliveryRecord], traceContext})
  }

  async function saveProjectionDeliveryResponse({chatId, ownerFloor, floorVersion, deliveryRecord, traceContext = {}} = {}) {
    return saveProjectionDeliveryResponseBatch({chatId, ownerFloor, floorVersion, records: [deliveryRecord], traceContext})
  }

  async function saveEvolutionDecision({chatId, ownerFloor, floorVersion, projectionId, decision, evidenceRefs = []} = {}) {
    const record = evolutionDecisionToLifecycleRecord({projectionId, decision, floorVersion, evidenceRefs})
    if (!record) return {status: 'skipped', reason: decision}
    return saveProjectionLifecycle({chatId, ownerFloor, floorVersion, lifecycleRecord: record})
  }

  async function readProjectionTimelineEntries({chatId, endpointIndex = Number.POSITIVE_INFINITY, endpointFloor = Number.POSITIVE_INFINITY} = {}) {
    if (!chatId) throw error('CHAT_OWNER_REQUIRED')
    const ownerSnapshot = store.getCurrentChatOwnerSnapshot(chatId)
    const entries = []
    const historicalProjectionIds = new Set()
    for (let index = 0; index < ownerSnapshot.messages.length; index += 1) {
      const message = ownerSnapshot.messages[index]
      const swipeId = store.getActiveSwipeId?.(index)
      if (swipeId === null || swipeId === undefined) continue
      const floor = store.getFloor(index, swipeId)
      const version = floorVersionFromData(floor)
      if (!hasCompleteFloorVersion(version) || String(version.chat_id) !== String(chatId) || index > Number(endpointIndex) || Number(version.floor) > Number(endpointFloor) || Number(version.swipe_id) !== Number(swipeId)) continue
      const messageId = message?.message_id ?? message?.messageId ?? message?.id ?? version.message_id
      if (String(version.message_id) !== String(messageId)) continue
      if (typeof resolveVersion !== 'function') continue
      const currentVersion = await resolveVersion({chatId, ownerFloor: {message_index: index, message_id: messageId}, floorVersion: version, swipeId}).catch(() => null)
      if (!sameFloorVersion(currentVersion, version)) continue
      const rawTimeline = floor.projection_timeline && typeof floor.projection_timeline === 'object' ? floor.projection_timeline : null
      const timeline = rawTimeline
        ? {
          schema_version: rawTimeline.schema_version,
          creations: Array.isArray(rawTimeline.creations) ? cloneValue(rawTimeline.creations.filter(record => sameFloorVersion(record.created_at_floor_version, version))) : [],
          evidence_records: Array.isArray(rawTimeline.evidence_records) ? cloneValue(rawTimeline.evidence_records.filter(record => sameFloorVersion(record.created_at_floor_version, version))) : [],
          lifecycle_records: Array.isArray(rawTimeline.lifecycle_records) ? cloneValue(rawTimeline.lifecycle_records.filter(record => sameFloorVersion(record.created_at_floor_version, version))) : [],
          delivery_records: Array.isArray(rawTimeline.delivery_records) ? cloneValue(rawTimeline.delivery_records.filter(record => sameFloorVersion(record.created_at_floor_version, version))) : [],
          observation_records: Array.isArray(rawTimeline.observation_records) ? cloneValue(rawTimeline.observation_records.filter(record => sameFloorVersion(record.created_at_floor_version, version))) : [],
          triggered_snapshots: Array.isArray(rawTimeline.triggered_snapshots) ? cloneValue(rawTimeline.triggered_snapshots.filter(record => sameFloorVersion(record.created_at_floor_version, version))) : [],
          triggered_snapshot_complete: rawTimeline.triggered_snapshot_complete === true,
          storyline_snapshots: Array.isArray(rawTimeline.storyline_snapshots) ? cloneValue(rawTimeline.storyline_snapshots.filter(record => sameFloorVersion(record.created_at_floor_version, version))) : [],
          storyline_snapshot_complete: rawTimeline.storyline_snapshot_complete === true,
          storyline_delivery_records: Array.isArray(rawTimeline.storyline_delivery_records) ? cloneValue(rawTimeline.storyline_delivery_records.filter(record => sameFloorVersion(record.created_at_floor_version, version))) : [],
        }
        : emptyProjectionTimeline()
      for (const creation of timeline.creations) if (creation?.projection_id) historicalProjectionIds.add(creation.projection_id)
      if (!timeline.creations.length && !timeline.evidence_records.length && !timeline.lifecycle_records.length && !timeline.delivery_records.length && !timeline.observation_records.length && !timeline.triggered_snapshots.length && !timeline.triggered_snapshot_complete && !timeline.storyline_snapshots.length && !timeline.storyline_snapshot_complete && !timeline.storyline_delivery_records.length) continue
      entries.push({floor_version: version, owner_index: index, owner_swipe_id: swipeId, ...timeline})
    }
    return {entries, historicalProjectionIds}
  }

  async function getProjectionViews({chatId, endpointIndex = Number.POSITIVE_INFINITY, endpointFloor = Number.POSITIVE_INFINITY} = {}) {
    const {entries} = await readProjectionTimelineEntries({chatId, endpointIndex, endpointFloor})
    return resolveProjectionTimeline(entries.filter(entry => entry.creations.length || entry.evidence_records.length || entry.lifecycle_records.length || entry.observation_records.length || entry.triggered_snapshots.length || entry.triggered_snapshot_complete || entry.storyline_snapshots.length || entry.storyline_snapshot_complete || entry.storyline_delivery_records.length))
  }

  async function getProjectionDeliveryRecords({chatId, endpointIndex = Number.POSITIVE_INFINITY, endpointFloor = Number.POSITIVE_INFINITY} = {}) {
    // Delivery replay needs historical creation IDs even when the product
    // view intentionally hides an earlier built-in stage snapshot. Do not use
    // getProjectionViews() here: its endpoint resolver returns only the latest
    // stage and would make valid historical A deliveries look unknown after B
    // replaces A.
    const {entries, historicalProjectionIds} = await readProjectionTimelineEntries({chatId, endpointIndex, endpointFloor})
    const records = entries.flatMap(entry => {
      const timeline = normalizeProjectionTimeline(entry, {expectedChatId: chatId, knownProjectionIds: historicalProjectionIds})
      return timeline.timeline.delivery_records.map(record => ({...cloneValue(record), owner_index: entry.owner_index, owner_swipe_id: entry.owner_swipe_id}))
    })
    return records.sort((left, right) => Number(left.owner_index) - Number(right.owner_index) || String(left.delivery_record_id).localeCompare(String(right.delivery_record_id)))
  }

  async function deleteProjection({chatId, ownerFloor, floorVersion, projectionId, evidenceRefs = []} = {}) {
    const views = await getProjectionViews({chatId, endpointFloor: floorVersion?.floor, endpointIndex: ownerSelector(ownerFloor)})
    const view = views.all.find(item => item.projection_id === projectionId)
    if (!view) throw error('PROJECTION_NOT_FOUND')
    if (view.deleted) return {status: 'deduped', view}
    const record = createProjectionLifecycleRecord({projection_id: projectionId, action: 'deleted', created_at_floor_version: floorVersion, evidence_refs: evidenceRefs})
    const result = await saveProjectionLifecycle({chatId, ownerFloor, floorVersion, lifecycleRecord: record})
    return {...result, view: (await getProjectionViews({chatId, endpointFloor: floorVersion.floor, endpointIndex: ownerSelector(ownerFloor)})).all.find(item => item.projection_id === projectionId) ?? null}
  }

  return {saveGeneratedProjection, saveProjectionEvidence, saveProjectionBatch, saveProjectionObservationBatch, saveProjectionTriggeredSnapshot, saveProjectionTriggeredSnapshotBatch, saveProjectionStorylineSnapshotBatch, saveProjectionStorylineDelivery, saveProjectionLifecycleBatch, saveProjectionLifecycle, saveEvolutionDecision, saveProjectionDeliverySubmissionBatch, saveProjectionDeliveryResponseBatch, saveProjectionDeliverySubmission, saveProjectionDeliveryResponse, getProjectionDeliveryRecords, deleteProjection, getProjectionViews}
}
