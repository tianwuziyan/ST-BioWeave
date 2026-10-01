import {normalizeProjectionTimingInstance, validateProjectionTimingInstance} from './projection-timing.js';

export const PROJECTION_TIMING_TIMELINE_SCHEMA_VERSION = 1;

export function emptyProjectionTimingTimeline() {
  return {schema_version: PROJECTION_TIMING_TIMELINE_SCHEMA_VERSION, creations: [], basis_records: [], lifecycle_records: []};
}

function clone(value) { if (value === undefined || value === null || typeof value !== 'object') return value; if (typeof structuredClone === 'function') return structuredClone(value); if (Array.isArray(value)) return value.map(clone); return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])); }
function sameVersion(left, right) { return JSON.stringify(left ?? null) === JSON.stringify(right ?? null); }

export function normalizeProjectionTimingTimeline(value, {expectedChatId = null} = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const conflicts = [];
  const rejected = [];
  const creations = [];
  const byId = new Map();
  for (const item of Array.isArray(source.creations) ? source.creations : []) {
    try {
      const normalized = normalizeProjectionTimingInstance(item);
      if (expectedChatId && normalized.created_at_floor_version.chat_id !== expectedChatId) throw new Error('chat_scope');
      const previous = byId.get(normalized.timing_instance_id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(normalized)) conflicts.push(normalized.timing_instance_id);
      else if (!previous) { byId.set(normalized.timing_instance_id, normalized); creations.push(normalized); }
    } catch { rejected.push(item?.timing_instance_id ?? null); }
  }
  const basisRecords = (Array.isArray(source.basis_records) ? source.basis_records : []).filter(record => record && typeof record === 'object' && typeof record.timing_instance_id === 'string' && Array.isArray(record.source_event_ids));
  const lifecycleRecords = (Array.isArray(source.lifecycle_records) ? source.lifecycle_records : []).filter(record => record && typeof record === 'object' && typeof record.timing_instance_id === 'string' && typeof record.action === 'string');
  return {timeline: {schema_version: PROJECTION_TIMING_TIMELINE_SCHEMA_VERSION, creations: creations.sort((a, b) => String(a.timing_instance_id).localeCompare(String(b.timing_instance_id))), basis_records: clone(basisRecords), lifecycle_records: clone(lifecycleRecords)}, conflicts, rejected};
}

export function appendProjectionTimingCreation(record, {timeline, expectedChatId = null} = {}) {
  const normalized = normalizeProjectionTimingInstance(record);
  if (expectedChatId && normalized.created_at_floor_version.chat_id !== expectedChatId) throw new Error('CHAT_SCOPE_MISMATCH');
  const current = normalizeProjectionTimingTimeline(timeline, {expectedChatId});
  if (current.conflicts.length || current.rejected.length) throw new Error('PROJECTION_TIMING_TIMELINE_INVALID');
  const existing = current.timeline.creations.find(item => item.timing_instance_id === normalized.timing_instance_id);
  if (existing) return JSON.stringify(existing) === JSON.stringify(normalized) ? {status: 'deduped', timeline: current.timeline} : {status: 'conflict'};
  return {status: 'appended', timeline: {...current.timeline, creations: [...current.timeline.creations, normalized]}};
}

export function appendProjectionTimingBasis({timingInstanceId, sourceEventIds, sourceBasisRefs = {}, createdAtFloorVersion}, {timeline} = {}) {
  const current = normalizeProjectionTimingTimeline(timeline);
  const creation = current.timeline.creations.find(item => item.timing_instance_id === timingInstanceId);
  if (!creation) return {status: 'rejected', code: 'PROJECTION_TIMING_NOT_FOUND'};
  const ids = [...new Set(sourceEventIds ?? [])].sort();
  const existing = current.timeline.basis_records.find(item => item.timing_instance_id === timingInstanceId && JSON.stringify(item.source_event_ids) === JSON.stringify(ids));
  if (existing) return {status: 'deduped', timeline: current.timeline};
  const record = {schema_version: PROJECTION_TIMING_TIMELINE_SCHEMA_VERSION, timing_instance_id: timingInstanceId, source_event_ids: ids, source_basis_refs: clone(sourceBasisRefs), created_at_floor_version: clone(createdAtFloorVersion)};
  return {status: 'appended', timeline: {...current.timeline, basis_records: [...current.timeline.basis_records, record]}};
}

export function resolveProjectionTimingTimeline(entries = []) {
  const creations = new Map();
  const basis = new Map();
  const lifecycle = new Map();
  for (const entry of entries) {
    for (const record of entry?.creations ?? []) creations.set(record.timing_instance_id, clone(record));
    for (const record of entry?.basis_records ?? []) basis.set(`${record.timing_instance_id}:${JSON.stringify(record.source_event_ids)}`, clone(record));
    for (const record of entry?.lifecycle_records ?? []) lifecycle.set(`${record.timing_instance_id}:${record.action}`, clone(record));
  }
  return {creations: [...creations.values()], basis_records: [...basis.values()], lifecycle_records: [...lifecycle.values()]};
}
