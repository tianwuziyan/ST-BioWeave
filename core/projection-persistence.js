import {
  PROJECTION_LIFECYCLE_ACTIONS,
  createProjectionEvidenceRecord,
  createProjectionDeliveryRecord,
  createProjectionLifecycleRecord,
  createProjectionObservationRecord,
  createProjectionTriggeredSnapshot,
  dedupeProjectionEvidenceRecords,
  dedupeProjectionDeliveryRecords,
  dedupeProjectionLifecycleRecords,
  dedupeProjectionObservationRecords,
  dedupeProjectionTriggeredSnapshots,
  dedupeProjections,
  resolveProjectionView,
  validateProjection,
  validateProjectionEvidenceRecord,
  validateProjectionDeliveryRecord,
  validateProjectionLifecycleRecord,
  validateProjectionObservationRecord,
  validateProjectionTriggeredSnapshot,
} from './projection.js'
import {BUILT_IN_PRE_CONFIRMATION_STAGES, builtInPreConfirmationBranchForConcern, builtInPreConfirmationStageCodeForConcern} from './projection-eligibility.js'

export const PROJECTION_TIMELINE_SCHEMA_VERSION = 1

function clone(value) {
  if (value === undefined || value === null || typeof value !== 'object') return value
  if (typeof structuredClone === 'function') return structuredClone(value)
  if (Array.isArray(value)) return value.map(clone)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]))
}

function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }

export function emptyProjectionTimeline() {
  return {schema_version: PROJECTION_TIMELINE_SCHEMA_VERSION, creations: [], evidence_records: [], lifecycle_records: [], delivery_records: [], observation_records: [], triggered_snapshots: [], triggered_snapshot_complete: false}
}

function timelineSource(value) {
  return isRecord(value) ? value : emptyProjectionTimeline()
}

export function normalizeProjectionTimeline(value, {expectedChatId = null, knownProjectionIds = null} = {}) {
  const source = timelineSource(value)
  if (source.schema_version !== undefined && source.schema_version !== PROJECTION_TIMELINE_SCHEMA_VERSION) throw new TypeError('projection_timeline.schema_version:invalid')
  const projections = dedupeProjections(source.creations ?? [])
  const allKnownProjectionIds = new Set(knownProjectionIds ?? projections.projections.map(item => item.projection_id))
  for (const projection of projections.projections) allKnownProjectionIds.add(projection.projection_id)
  const evidence = dedupeProjectionEvidenceRecords(source.evidence_records ?? [], {knownProjectionIds: allKnownProjectionIds, expectedChatId})
  const lifecycle = dedupeProjectionLifecycleRecords(source.lifecycle_records ?? [], {knownProjectionIds: allKnownProjectionIds, expectedChatId})
  const delivery = dedupeProjectionDeliveryRecords(source.delivery_records ?? [], {knownProjectionIds: allKnownProjectionIds, expectedChatId})
  const observations = dedupeProjectionObservationRecords(source.observation_records ?? [], {knownProjectionIds: allKnownProjectionIds, expectedChatId})
  const triggeredSnapshots = dedupeProjectionTriggeredSnapshots(source.triggered_snapshots ?? [], {knownProjectionIds: allKnownProjectionIds, expectedChatId})
  const projectionErrors = projections.rejected.flatMap(item => item.errors)
  if (expectedChatId !== null) {
    for (const projection of projections.projections) {
      const validation = validateProjection(projection, {expectedChatId})
      projectionErrors.push(...validation.errors)
    }
  }
  return {
    timeline: {
      schema_version: PROJECTION_TIMELINE_SCHEMA_VERSION,
      creations: projections.projections,
      evidence_records: evidence.records,
      lifecycle_records: lifecycle.records,
      delivery_records: delivery.records,
      observation_records: observations.records,
      triggered_snapshots: triggeredSnapshots.records,
      ...(source.triggered_snapshot_complete === true ? {triggered_snapshot_complete: true} : {}),
    },
    conflicts: [...projections.conflicts, ...evidence.conflicts, ...lifecycle.conflicts, ...delivery.conflicts, ...observations.conflicts, ...triggeredSnapshots.conflicts],
    rejected: [...projectionErrors.map(error => ({errors: [error]})), ...evidence.rejected, ...lifecycle.rejected, ...delivery.rejected, ...observations.rejected, ...triggeredSnapshots.rejected],
  }
}

function appendRecord(timeline, collection, value, validate, create, idKey, conflictCode, options = {}) {
  const normalized = create ? create(value) : clone(value)
  const validation = validate(normalized, options)
  if (!validation.ok) return {status: 'rejected', code: validation.errors[0], timeline: clone(timeline)}
  const records = timeline[collection] ?? []
  const existing = records.find(item => item?.[idKey] === normalized[idKey])
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(normalized)) return {status: 'conflict', code: conflictCode, timeline: clone(timeline)}
    return {status: 'deduped', code: null, timeline: clone(timeline)}
  }
  return {status: 'appended', code: null, timeline: {...clone(timeline), [collection]: [...records, normalized]}}
}

export function appendProjectionCreation(value, {timeline = emptyProjectionTimeline(), expectedChatId = null} = {}) {
  const current = normalizeProjectionTimeline(timeline, {expectedChatId}).timeline
  const validation = validateProjection(value, {expectedChatId})
  if (!validation.ok) return {status: 'rejected', code: validation.errors[0], timeline: current}
  const existing = current.creations.find(item => item.projection_id === value.projection_id)
  if (existing) {
    const same = JSON.stringify(existing) === JSON.stringify(value)
    return {status: same ? 'deduped' : 'conflict', code: same ? null : 'projection_id_conflict', timeline: current}
  }
  return {status: 'appended', code: null, timeline: {...current, creations: [...current.creations, clone(value)]}}
}

export function appendProjectionEvidence(value, {timeline = emptyProjectionTimeline(), expectedChatId = null, knownProjectionIds = null} = {}) {
  const current = normalizeProjectionTimeline(timeline, {expectedChatId}).timeline
  const knownIds = new Set(knownProjectionIds ?? current.creations.map(item => item.projection_id))
  return appendRecord(current, 'evidence_records', value, item => validateProjectionEvidenceRecord(item, {knownProjectionIds: knownIds, expectedChatId}), createProjectionEvidenceRecord, 'evidence_record_id', 'evidence_record_conflict')
}

export function appendProjectionLifecycle(value, {timeline = emptyProjectionTimeline(), expectedChatId = null, knownProjectionIds = null} = {}) {
  const current = normalizeProjectionTimeline(timeline, {expectedChatId}).timeline
  const knownIds = new Set(knownProjectionIds ?? current.creations.map(item => item.projection_id))
  return appendRecord(current, 'lifecycle_records', value, item => validateProjectionLifecycleRecord(item, {knownProjectionIds: knownIds, expectedChatId}), createProjectionLifecycleRecord, 'lifecycle_id', 'lifecycle_id_conflict')
}

export function appendProjectionDelivery(value, {timeline = emptyProjectionTimeline(), expectedChatId = null, knownProjectionIds = null} = {}) {
  const current = normalizeProjectionTimeline(timeline, {expectedChatId, knownProjectionIds}).timeline
  const knownIds = new Set(knownProjectionIds ?? current.creations.map(item => item.projection_id))
  return appendRecord(current, 'delivery_records', value, item => validateProjectionDeliveryRecord(item, {knownProjectionIds: knownIds, expectedChatId}), createProjectionDeliveryRecord, 'delivery_record_id', 'delivery_record_conflict')
}

export function appendProjectionObservation(value, {timeline = emptyProjectionTimeline(), expectedChatId = null, knownProjectionIds = null} = {}) {
  const current = normalizeProjectionTimeline(timeline, {expectedChatId, knownProjectionIds}).timeline
  const knownIds = new Set(knownProjectionIds ?? current.creations.map(item => item.projection_id))
  return appendRecord(current, 'observation_records', value, item => validateProjectionObservationRecord(item, {knownProjectionIds: knownIds, expectedChatId}), createProjectionObservationRecord, 'observation_id', 'observation_id_conflict')
}

export function appendProjectionTriggeredSnapshot(value, {timeline = emptyProjectionTimeline(), expectedChatId = null, knownProjectionIds = null} = {}) {
  const current = normalizeProjectionTimeline(timeline, {expectedChatId, knownProjectionIds}).timeline
  const knownIds = new Set(knownProjectionIds ?? current.creations.map(item => item.projection_id))
  return appendRecord(current, 'triggered_snapshots', value, item => validateProjectionTriggeredSnapshot(item, {knownProjectionIds: knownIds, expectedChatId}), createProjectionTriggeredSnapshot, 'snapshot_id', 'triggered_snapshot_id_conflict')
}

export function evolutionDecisionToLifecycleRecord({projectionId, decision, floorVersion, evidenceRefs = []} = {}) {
  if (!['realized', 'contradicted', 'expired'].includes(decision)) return null
  if (!projectionId) throw new TypeError('projection_id:required')
  if (!floorVersion) throw new TypeError('floor_version:required')
  return createProjectionLifecycleRecord({projection_id: projectionId, action: decision, created_at_floor_version: floorVersion, evidence_refs: evidenceRefs})
}

export function resolveProjectionTimeline(timelineEntries = []) {
  const entries = (Array.isArray(timelineEntries) ? timelineEntries : [])
    .map(entry => ({
      owner_type: 'character',
      floor_version: clone(entry.floor_version),
      projections: clone(entry.creations ?? entry.projections ?? []),
      evidence_records: clone(entry.evidence_records ?? []),
      lifecycle_records: clone(entry.lifecycle_records ?? []),
      delivery_records: clone(entry.delivery_records ?? []),
      observation_records: clone(entry.observation_records ?? []),
      triggered_snapshots: clone(entry.triggered_snapshots ?? []),
      triggered_snapshot_complete: entry.triggered_snapshot_complete === true,
    }))
    .sort((left, right) => Number(left.floor_version?.floor) - Number(right.floor_version?.floor) || String(left.floor_version?.message_id).localeCompare(String(right.floor_version?.message_id)))
  const selectedEntries = resolveBuiltInStageSnapshots(entries)
  const snapshotEntries = selectedEntries.filter(entry => entry.triggered_snapshot_complete === true)
  const snapshotSource = snapshotEntries.at(-1)
  const historicalProjectionStageCode = new Map();
  for (const entry of entries) {
    for (const projection of entry.projections ?? []) {
      const stageCode = builtInPreConfirmationStageCodeForConcern(projection?.development_concern_key);
      if (stageCode) historicalProjectionStageCode.set(projection.projection_id, stageCode);
    }
  }
  const resolveSnapshotCompatibility = snapshot => {
    if (snapshot?.stage_code !== undefined) return clone(snapshot);
    const codes = new Set((snapshot?.triggered ?? [])
      .map(item => historicalProjectionStageCode.get(item?.projection_id))
      .filter(Boolean));
    return codes.size === 1 ? {...clone(snapshot), stage_code: [...codes][0]} : clone(snapshot);
  };
  const snapshots = new Map()
  if (snapshotSource) {
    for (const snapshot of snapshotSource.triggered_snapshots ?? []) snapshots.set(snapshot.subject_id, resolveSnapshotCompatibility(snapshot))
  } else {
    // Bounded compatibility for old append-only observation data and early
    // snapshot records. New product reads never merge complete snapshots from
    // multiple Floors; only legacy records use the historical latest-per-subject
    // fallback until the next legal current-Floor write converges them.
    for (const entry of selectedEntries) {
      for (const snapshot of entry.triggered_snapshots ?? []) {
        const previous = snapshots.get(snapshot.subject_id)
        if (!previous || Number(snapshot.created_at_floor_version?.floor) >= Number(previous.created_at_floor_version?.floor)) snapshots.set(snapshot.subject_id, resolveSnapshotCompatibility(snapshot))
      }
    }
  }
  const result = resolveProjectionView({timeline: selectedEntries})
  result.triggered_snapshots = [...snapshots.values()].sort((left, right) => String(left.subject_id).localeCompare(String(right.subject_id)))
  return result
}

function builtInStageIdentity(projection) {
  if (projection?.tracking_scope !== 'pre_confirmation' || projection?.aggregation_path !== 'participant_aggregation') return null
  const branch = builtInPreConfirmationBranchForConcern(projection.development_concern_key)
  const stage = BUILT_IN_PRE_CONFIRMATION_STAGES.find(item => item.key === branch?.stage_key)
  const evidence = projection.aggregation_evidence
  if (!stage || !evidence || evidence.subject_id !== projection.subject_id) return null
  return {
    key: JSON.stringify([projection.subject_id, evidence.pregnancy_id ?? null, evidence.cycle_id]),
    stageKey: stage.key,
    branch: branch.key,
  }
}

/**
 * Built-in pre-confirmation creations are stage snapshots, not a cumulative
 * list. Keep the latest complete snapshot for each subject/cycle identity
 * while leaving factual and delivery replay untouched. Mechanism metadata is
 * projection content, not a second stage identity for one subject.
 */
function resolveBuiltInStageSnapshots(entries) {
  const candidates = new Map()
  for (const entry of entries) {
    for (const projection of entry.projections ?? []) {
      const identity = builtInStageIdentity(projection)
      if (!identity) continue
      if (!candidates.has(identity.key)) candidates.set(identity.key, new Map())
      const byStage = candidates.get(identity.key)
      if (!byStage.has(identity.stageKey)) byStage.set(identity.stageKey, new Map())
      const branches = byStage.get(identity.stageKey)
      const existing = branches.get(identity.branch)
      if (!existing || Number(entry.floor_version?.floor) >= existing.floor) {
        branches.set(identity.branch, {floor: Number(entry.floor_version?.floor), projectionId: projection.projection_id})
      }
    }
  }
  const selectedSnapshots = new Map()
  for (const [identityKey, stages] of candidates) {
    for (const [stageKey, branches] of stages) {
      const expected = BUILT_IN_PRE_CONFIRMATION_STAGES.find(stage => stage.key === stageKey)?.branches.map(branch => branch.key) ?? []
      if (expected.length === 0 || expected.some(branch => !branches.has(branch))) continue
      const completionFloor = Math.max(...expected.map(branch => branches.get(branch).floor))
      const previous = selectedSnapshots.get(identityKey)
      const stageIndex = BUILT_IN_PRE_CONFIRMATION_STAGES.findIndex(stage => stage.key === stageKey)
      const previousStageIndex = previous ? BUILT_IN_PRE_CONFIRMATION_STAGES.findIndex(stage => stage.key === previous.stageKey) : -1
      // Story Time stages advance monotonically. A late legacy branch from an
      // older stage must not make that older stage current again merely because
      // it completes at a higher Floor than the already complete newer stage.
      // Within the same stage, the latest complete snapshot still wins.
      if (!previous || stageIndex > previousStageIndex || (stageIndex === previousStageIndex && completionFloor > previous.completionFloor)) {
        selectedSnapshots.set(identityKey, {
          stageKey,
          completionFloor,
          projections: expected.map(branch => branches.get(branch)),
        })
      }
    }
  }
  const selectedIds = new Set([...selectedSnapshots.values()].flatMap(snapshot => snapshot.projections.map(item => item.projectionId)))
  if (!selectedSnapshots.size) return entries
  // Stage replacement changes which creations are current, not which later
  // evidence/lifecycle records are valid. Build one endpoint-wide allowlist
  // before filtering every collection so records owned by later Floors survive.
  const allowedProjectionIds = new Set()
  for (const entry of entries) {
    for (const projection of entry.projections ?? []) {
      const identity = builtInStageIdentity(projection)
      if (!identity) {
        allowedProjectionIds.add(projection.projection_id)
        continue
      }
      if (selectedIds.has(projection.projection_id)) {
        allowedProjectionIds.add(projection.projection_id)
      }
    }
  }
  return entries.map(entry => {
    const projections = (entry.projections ?? []).filter(projection => allowedProjectionIds.has(projection.projection_id))
    const filterRecords = records => (records ?? []).filter(record => allowedProjectionIds.has(record.projection_id))
    return {
      ...entry,
      projections,
      evidence_records: filterRecords(entry.evidence_records),
      lifecycle_records: filterRecords(entry.lifecycle_records),
      delivery_records: filterRecords(entry.delivery_records),
      observation_records: clone(entry.observation_records ?? []),
      triggered_snapshots: clone(entry.triggered_snapshots ?? []),
      triggered_snapshot_complete: entry.triggered_snapshot_complete === true,
    }
  }).filter(entry => entry.projections.length || entry.evidence_records.length || entry.lifecycle_records.length || entry.delivery_records.length || entry.observation_records.length || entry.triggered_snapshots.length || entry.triggered_snapshot_complete)
}

export function projectionTimelineHasAction(timeline, projectionId, action) {
  return (timeline?.lifecycle_records ?? []).some(record => record.projection_id === projectionId && record.action === action)
}

export {PROJECTION_LIFECYCLE_ACTIONS}
