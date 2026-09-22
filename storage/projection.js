import {floorVersionFromData, hasCompleteFloorVersion, sameFloorVersion} from '../runtime/floor.js'
import {
  appendProjectionCreation,
  appendProjectionEvidence,
  appendProjectionLifecycle,
  emptyProjectionTimeline,
  evolutionDecisionToLifecycleRecord,
  normalizeProjectionTimeline,
  resolveProjectionTimeline,
} from '../core/projection-persistence.js'
import {
  createProjectionEvidenceRecord,
  createProjectionLifecycleRecord,
  validateProjection,
} from '../core/projection.js'
import {cloneValue, emptyFloor} from './schema.js'

function error(code) { const result = new Error(code); result.code = code; return result }
function ownerSelector(owner = {}) { return owner.message_id ?? owner.messageId ?? owner.message_index ?? owner.messageIndex ?? owner.index }
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

export function createProjectionPersistence({store, resolveCurrentFloorVersion = null, enabledResolver = () => true} = {}) {
  if (!store || typeof store.getFloor !== 'function' || typeof store.saveFloor !== 'function') throw new TypeError('PROJECTION_STORE_REQUIRED')
  const resolveVersion = resolveCurrentFloorVersion ?? store.getCurrentFloorVersion

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
    for (const collection of ['creations', 'evidence_records', 'lifecycle_records']) {
      for (const record of existingRoot?.[collection] ?? []) assertRecordVersion(record, resolved.version)
    }
    const knownProjectionIds = new Set((await getProjectionViews({chatId: resolved.chatId, endpointFloor: resolved.version.floor})).all.map(item => item.projection_id))
    const normalized = normalizeProjectionTimeline(resolved.floorData.projection_timeline, {expectedChatId: resolved.chatId, knownProjectionIds})
    if (normalized.conflicts.length || normalized.rejected.length) throw error('PROJECTION_TIMELINE_INVALID')
    const currentTimeline = normalized.timeline
    const result = mutate(currentTimeline, resolved)
    if (result.status === 'rejected' || result.status === 'conflict') throw error(result.code)
    if (result.status === 'deduped') return {status: result.status, timeline: currentTimeline}
    const nextFloor = cloneValue(resolved.floorData)
    nextFloor.projection_timeline = result.timeline
    assertEnabled()
    await store.saveFloor(resolved.selector, resolved.swipeId, nextFloor)
    return {status: result.status, timeline: result.timeline}
  }

  async function saveGeneratedProjection({chatId, ownerFloor, floorVersion, projectionCandidate} = {}) {
    const validation = validateProjection(projectionCandidate, {expectedChatId: chatId})
    if (!validation.ok) throw error(validation.errors[0])
    assertRecordVersion(projectionCandidate, floorVersion)
    return mutateFloor({chatId, ownerFloor, floorVersion}, timeline => appendProjectionCreation(projectionCandidate, {timeline, expectedChatId: chatId}))
  }

  async function saveProjectionEvidence({chatId, ownerFloor, floorVersion, evidenceRecord} = {}) {
    const record = createProjectionEvidenceRecord(evidenceRecord)
    if (evidenceRecord?.evidence_record_id && evidenceRecord.evidence_record_id !== record.evidence_record_id) throw error('evidence_record_id:not_deterministic')
    assertRecordVersion(record, floorVersion)
    const knownProjectionIds = new Set((await getProjectionViews({chatId, endpointFloor: floorVersion.floor})).all.map(item => item.projection_id))
    return mutateFloor({chatId, ownerFloor, floorVersion}, timeline => appendProjectionEvidence(record, {timeline, expectedChatId: chatId, knownProjectionIds}))
  }

  async function saveProjectionLifecycle({chatId, ownerFloor, floorVersion, lifecycleRecord} = {}) {
    const record = createProjectionLifecycleRecord(lifecycleRecord)
    if (lifecycleRecord?.lifecycle_id && lifecycleRecord.lifecycle_id !== record.lifecycle_id) throw error('lifecycle_id:not_deterministic')
    assertRecordVersion(record, floorVersion)
    const knownProjectionIds = new Set((await getProjectionViews({chatId, endpointFloor: floorVersion.floor})).all.map(item => item.projection_id))
    return mutateFloor({chatId, ownerFloor, floorVersion}, timeline => appendProjectionLifecycle(record, {timeline, expectedChatId: chatId, knownProjectionIds}))
  }

  async function saveEvolutionDecision({chatId, ownerFloor, floorVersion, projectionId, decision, evidenceRefs = []} = {}) {
    const record = evolutionDecisionToLifecycleRecord({projectionId, decision, floorVersion, evidenceRefs})
    if (!record) return {status: 'skipped', reason: decision}
    return saveProjectionLifecycle({chatId, ownerFloor, floorVersion, lifecycleRecord: record})
  }

  async function getProjectionViews({chatId, endpointFloor = Number.POSITIVE_INFINITY} = {}) {
    if (!chatId) throw error('CHAT_OWNER_REQUIRED')
    const ownerSnapshot = store.getCurrentChatOwnerSnapshot(chatId)
    const entries = []
    for (let index = 0; index < ownerSnapshot.messages.length; index += 1) {
      const message = ownerSnapshot.messages[index]
      const selector = index
      const swipeId = store.getActiveSwipeId?.(selector)
      if (swipeId === null || swipeId === undefined) continue
      const floor = store.getFloor(selector, swipeId)
      const version = floorVersionFromData(floor)
      if (!hasCompleteFloorVersion(version) || String(version.chat_id) !== String(chatId) || Number(version.floor) > Number(endpointFloor)) continue
      const messageId = message?.message_id ?? message?.messageId ?? message?.id ?? version.message_id
      if (version.swipe_id !== swipeId || String(version.message_id) !== String(messageId)) continue
      if (typeof resolveVersion !== 'function') continue
      let currentVersion
      try { currentVersion = await resolveVersion({chatId, ownerFloor: {message_index: index, message_id: messageId}, floorVersion: version, swipeId}) } catch { continue }
      if (!sameFloorVersion(currentVersion, version)) continue
      const timeline = floor.projection_timeline && typeof floor.projection_timeline === 'object'
        ? {
          schema_version: floor.projection_timeline.schema_version,
          creations: Array.isArray(floor.projection_timeline.creations) ? cloneValue(floor.projection_timeline.creations.filter(record => sameFloorVersion(record.created_at_floor_version, version))) : [],
          evidence_records: Array.isArray(floor.projection_timeline.evidence_records) ? cloneValue(floor.projection_timeline.evidence_records.filter(record => sameFloorVersion(record.created_at_floor_version, version))) : [],
          lifecycle_records: Array.isArray(floor.projection_timeline.lifecycle_records) ? cloneValue(floor.projection_timeline.lifecycle_records.filter(record => sameFloorVersion(record.created_at_floor_version, version))) : [],
        }
        : emptyProjectionTimeline()
      if (!timeline.creations.length && !timeline.evidence_records.length && !timeline.lifecycle_records.length) continue
      entries.push({floor_version: version, ...timeline})
    }
    return resolveProjectionTimeline(entries)
  }

  async function deleteProjection({chatId, ownerFloor, floorVersion, projectionId, evidenceRefs = []} = {}) {
    const views = await getProjectionViews({chatId, endpointFloor: floorVersion?.floor})
    const view = views.all.find(item => item.projection_id === projectionId)
    if (!view) throw error('PROJECTION_NOT_FOUND')
    if (view.deleted) return {status: 'deduped', view}
    const record = createProjectionLifecycleRecord({projection_id: projectionId, action: 'deleted', created_at_floor_version: floorVersion, evidence_refs: evidenceRefs})
    const result = await saveProjectionLifecycle({chatId, ownerFloor, floorVersion, lifecycleRecord: record})
    return {...result, view: (await getProjectionViews({chatId, endpointFloor: floorVersion.floor})).all.find(item => item.projection_id === projectionId) ?? null}
  }

  return {saveGeneratedProjection, saveProjectionEvidence, saveProjectionLifecycle, saveEvolutionDecision, deleteProjection, getProjectionViews}
}
