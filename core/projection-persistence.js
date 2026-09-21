import {
  PROJECTION_LIFECYCLE_ACTIONS,
  createProjectionEvidenceRecord,
  createProjectionLifecycleRecord,
  dedupeProjectionEvidenceRecords,
  dedupeProjectionLifecycleRecords,
  dedupeProjections,
  resolveProjectionView,
  validateProjection,
  validateProjectionEvidenceRecord,
  validateProjectionLifecycleRecord,
} from './projection.js'

export const PROJECTION_TIMELINE_SCHEMA_VERSION = 1

function clone(value) {
  if (value === undefined || value === null || typeof value !== 'object') return value
  if (typeof structuredClone === 'function') return structuredClone(value)
  if (Array.isArray(value)) return value.map(clone)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]))
}

function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }

export function emptyProjectionTimeline() {
  return {schema_version: PROJECTION_TIMELINE_SCHEMA_VERSION, creations: [], evidence_records: [], lifecycle_records: []}
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
    },
    conflicts: [...projections.conflicts, ...evidence.conflicts, ...lifecycle.conflicts],
    rejected: [...projectionErrors.map(error => ({errors: [error]})), ...evidence.rejected, ...lifecycle.rejected],
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
    }))
    .sort((left, right) => Number(left.floor_version?.floor) - Number(right.floor_version?.floor) || String(left.floor_version?.message_id).localeCompare(String(right.floor_version?.message_id)))
  return resolveProjectionView({timeline: entries})
}

export function projectionTimelineHasAction(timeline, projectionId, action) {
  return (timeline?.lifecycle_records ?? []).some(record => record.projection_id === projectionId && record.action === action)
}

export {PROJECTION_LIFECYCLE_ACTIONS}
