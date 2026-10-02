import { normalizeTrackingWindow, validateTrackingWindow, TRACKING_WINDOW_SCHEMA_VERSION } from './tracking-window.js';

export function emptyTrackingWindowTimeline() {
  return {schema_version: TRACKING_WINDOW_SCHEMA_VERSION, creations: [], lifecycle_records: []};
}

function clone(value) {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  if (Array.isArray(value)) return value.map(clone);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}

export function normalizeTrackingWindowTimeline(value, {expectedChatId = null} = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const creations = [];
  const rejected = [];
  const conflicts = [];
  const byId = new Map();
  for (const item of Array.isArray(source.creations) ? source.creations : []) {
    try {
      const window = normalizeTrackingWindow(item);
      if (expectedChatId !== null && window.opened_at_floor_version?.chat_id !== expectedChatId) throw new Error('chat_scope');
      const previous = byId.get(window.tracking_window_id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(window)) conflicts.push(window.tracking_window_id);
      else if (!previous) {
        byId.set(window.tracking_window_id, window);
        creations.push(window);
      }
    } catch {
      rejected.push(item?.tracking_window_id ?? null);
    }
  }
  const lifecycleRecords = Array.isArray(source.lifecycle_records)
    ? source.lifecycle_records.filter(record => record && typeof record === 'object' && typeof record.tracking_window_id === 'string' && typeof record.action === 'string').map(clone)
    : [];
  return {
    timeline: {
      schema_version: TRACKING_WINDOW_SCHEMA_VERSION,
      creations: creations.sort((left, right) => left.tracking_window_id.localeCompare(right.tracking_window_id)),
      lifecycle_records: lifecycleRecords,
    },
    conflicts,
    rejected,
  };
}

export function appendTrackingWindowCreation(window, {timeline, expectedChatId = null} = {}) {
  const normalized = normalizeTrackingWindow(window);
  if (expectedChatId !== null && normalized.opened_at_floor_version?.chat_id !== expectedChatId) throw new Error('CHAT_SCOPE_MISMATCH');
  const current = normalizeTrackingWindowTimeline(timeline, {expectedChatId});
  if (current.conflicts.length || current.rejected.length) throw new Error('TRACKING_WINDOW_TIMELINE_INVALID');
  const existing = current.timeline.creations.find(item => item.tracking_window_id === normalized.tracking_window_id);
  if (existing) {
    const merged = normalizeTrackingWindow({
      ...existing,
      source_event_ids: [...new Set([...(existing.source_event_ids ?? []), ...(normalized.source_event_ids ?? [])])].sort(),
      source_basis_refs: {...(existing.source_basis_refs ?? {}), ...(normalized.source_basis_refs ?? {})},
      updated_at: normalized.updated_at ?? existing.updated_at,
    });
    if (JSON.stringify(existing) === JSON.stringify(merged)) return {status: 'deduped', timeline: current.timeline};
    return {status: 'appended', timeline: {...current.timeline, creations: current.timeline.creations.map(item => item.tracking_window_id === normalized.tracking_window_id ? merged : item)}};
  }
  return {status: 'appended', timeline: {...current.timeline, creations: [...current.timeline.creations, normalized]}};
}

export function appendTrackingWindowLifecycle({trackingWindowId, action, eventId, reason, terminalStoryTime, terminalFloorVersion, createdAtFloorVersion}, {timeline} = {}) {
  const current = normalizeTrackingWindowTimeline(timeline);
  if (!current.timeline.creations.some(item => item.tracking_window_id === trackingWindowId)) return {status: 'rejected', code: 'TRACKING_WINDOW_NOT_FOUND'};
  const record = {
    schema_version: TRACKING_WINDOW_SCHEMA_VERSION,
    tracking_window_id: trackingWindowId,
    action,
    event_id: eventId ?? null,
    reason: reason ?? null,
    terminal_story_time: clone(terminalStoryTime ?? null),
    terminal_at_floor_version: clone(terminalFloorVersion ?? null),
    created_at_floor_version: clone(createdAtFloorVersion ?? null),
  };
  const exists = current.timeline.lifecycle_records.some(item => JSON.stringify(item) === JSON.stringify(record));
  if (exists) return {status: 'deduped', timeline: current.timeline};
  return {status: 'appended', timeline: {...current.timeline, lifecycle_records: [...current.timeline.lifecycle_records, record]}};
}

export function resolveTrackingWindowTimeline(entries = []) {
  const creations = new Map();
  const lifecycleRecords = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    for (const window of entry?.creations ?? []) {
      const validation = validateTrackingWindow(window);
      if (validation.ok) creations.set(window.tracking_window_id, clone(window));
    }
    for (const record of entry?.lifecycle_records ?? []) {
      lifecycleRecords.set(`${record.tracking_window_id}:${record.action}:${record.event_id ?? ''}`, clone(record));
    }
  }
  return {
    creations: [...creations.values()].sort((left, right) => left.tracking_window_id.localeCompare(right.tracking_window_id)),
    lifecycle_records: [...lifecycleRecords.values()],
  };
}
