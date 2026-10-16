import {normalizeProjectionTimingInstance} from './projection-timing.js';

export const PROJECTION_TIMING_SNAPSHOT_SCHEMA_VERSION = 1;

function clone(value) {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  if (Array.isArray(value)) return value.map(clone);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sameValue(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export function emptyProjectionTimingSnapshot() {
  return {
    schema_version: PROJECTION_TIMING_SNAPSHOT_SCHEMA_VERSION,
    items: [],
  };
}

/**
 * Timing storage is a complete Floor snapshot. This reducer deliberately
 * reads only `items`; the former timeline fields are not a compatibility
 * source and are therefore ignored rather than migrated.
 */
export function normalizeProjectionTimingSnapshot(value, {expectedChatId = null} = {}) {
  const validRoot = isRecord(value)
    && value.schema_version === PROJECTION_TIMING_SNAPSHOT_SCHEMA_VERSION
    && Array.isArray(value.items);
  const source = validRoot ? value : {};
  const conflicts = [];
  const rejected = [];
  const byId = new Map();
  for (const item of Array.isArray(source.items) ? source.items : []) {
    try {
      const normalized = normalizeProjectionTimingInstance(item);
      if (expectedChatId !== null && normalized.created_at_floor_version.chat_id !== expectedChatId) {
        throw new Error('chat_scope');
      }
      const previous = byId.get(normalized.timing_instance_id);
      if (previous && !sameValue(previous, normalized)) conflicts.push(normalized.timing_instance_id);
      else if (!previous) byId.set(normalized.timing_instance_id, normalized);
    } catch {
      rejected.push(item?.timing_instance_id ?? null);
    }
  }
  return {
    snapshot: {
      schema_version: PROJECTION_TIMING_SNAPSHOT_SCHEMA_VERSION,
      items: [...byId.values()].sort((left, right) => String(left.timing_instance_id).localeCompare(String(right.timing_instance_id))),
    },
    conflicts,
    rejected,
    invalid: !validRoot,
  };
}

export function upsertProjectionTimingInstance(record, {snapshot, expectedChatId = null} = {}) {
  const normalized = normalizeProjectionTimingInstance(record);
  if (expectedChatId !== null && normalized.created_at_floor_version.chat_id !== expectedChatId) {
    throw new Error('CHAT_SCOPE_MISMATCH');
  }
  const current = normalizeProjectionTimingSnapshot(snapshot, {expectedChatId});
  if (current.invalid || current.conflicts.length || current.rejected.length) throw new Error('PROJECTION_TIMING_SNAPSHOT_INVALID');
  const index = current.snapshot.items.findIndex(item => item.timing_instance_id === normalized.timing_instance_id);
  if (index < 0) {
    return {
      status: 'created',
      snapshot: {
        ...current.snapshot,
        items: [...current.snapshot.items, normalized].sort((left, right) => String(left.timing_instance_id).localeCompare(String(right.timing_instance_id))),
      },
    };
  }
  if (sameValue(current.snapshot.items[index], normalized)) {
    return {status: 'deduped', snapshot: current.snapshot};
  }
  const items = current.snapshot.items.slice();
  items[index] = normalized;
  return {
    status: 'updated',
    snapshot: {
      ...current.snapshot,
      items: items.sort((left, right) => String(left.timing_instance_id).localeCompare(String(right.timing_instance_id))),
    },
  };
}

export function removeProjectionTimingInstance(timingInstanceId, {snapshot, expectedChatId = null} = {}) {
  const current = normalizeProjectionTimingSnapshot(snapshot, {expectedChatId});
  if (current.invalid || current.conflicts.length || current.rejected.length) throw new Error('PROJECTION_TIMING_SNAPSHOT_INVALID');
  const items = current.snapshot.items.filter(item => item.timing_instance_id !== timingInstanceId);
  return {
    status: items.length === current.snapshot.items.length ? 'not_found' : 'removed',
    snapshot: {...current.snapshot, items},
  };
}

export function replaceProjectionTimingSnapshot(items, {expectedChatId = null} = {}) {
  const source = {schema_version: PROJECTION_TIMING_SNAPSHOT_SCHEMA_VERSION, items: clone(items)};
  const normalized = normalizeProjectionTimingSnapshot(source, {expectedChatId});
  if (normalized.invalid || normalized.conflicts.length || normalized.rejected.length) throw new Error('PROJECTION_TIMING_SNAPSHOT_INVALID');
  return normalized.snapshot;
}
