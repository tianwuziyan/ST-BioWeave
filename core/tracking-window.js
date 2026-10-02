import { compareStoryTime } from '../story/time.js';
import { deterministicDigest } from './projection.js';
import { buildProjectionTimingCycleId } from './projection-timing.js';
import {
  isPregnancyRelevantExposure,
  normalizeEvent,
  sortEvents,
  validateEvent,
} from './events.js';

export const TRACKING_WINDOW_SCHEMA_VERSION = 1;
export const TRACKING_WINDOW_STATUSES = Object.freeze([
  'open',
  'resolved_pregnant',
  'terminated',
]);
export const TRACKING_WINDOW_TERMINAL_REASONS = Object.freeze({
  pregnancy_confirmation: 'resolved_pregnant',
  pregnancy_loss: 'terminated',
  abortion: 'terminated',
});

const WINDOW_FIELDS = new Set([
  'schema_version', 'tracking_window_id', 'cycle_id', 'subject_id',
  'mechanism_key', 'source_event_ids', 'source_basis_refs', 'status',
  'opened_story_time', 'opened_at_floor_version', 'terminal_event_id',
  'terminal_reason', 'terminal_story_time', 'terminal_at_floor_version',
  'created_at', 'updated_at',
]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function clone(value) {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  if (Array.isArray(value)) return value.map(clone);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}
function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function idArray(value, required = false) {
  return Array.isArray(value) && (!required || value.length > 0)
    && value.every(item => Boolean(text(item))) && new Set(value).size === value.length;
}
function mechanismKey(event) {
  const mechanism = event?.pregnancy_relevance?.reproductive_mechanism;
  return text(mechanism?.kind)?.toLowerCase()
    ?? text(mechanism?.key)?.toLowerCase()
    ?? text(mechanism?.label)?.toLowerCase()
    ?? text(mechanism?.pathway)?.toLowerCase()
    ?? 'unspecified';
}
function eventVersion(event) {
  return clone(event?.source ?? null);
}
function eventSort(left, right) {
  const comparison = compareStoryTime(left?.story_time, right?.story_time);
  if (comparison !== null && comparison !== 0) return comparison;
  return String(left?.event_id ?? '').localeCompare(String(right?.event_id ?? ''));
}
function validEvent(raw) {
  try {
    const event = normalizeEvent(raw);
    return validateEvent(event).ok ? event : null;
  } catch {
    return null;
  }
}
function exposureForSubject(event, subjectId) {
  return isPregnancyRelevantExposure(event)
    && event.pregnancy_relevance.gestational_subject_ids.includes(subjectId)
    && Boolean(mechanismKey(event));
}
function terminalForSubject(event, subjectId) {
  return event?.status === 'confirmed'
    && Object.hasOwn(TRACKING_WINDOW_TERMINAL_REASONS, event.type)
    && event?.state_fact?.subject_id === subjectId;
}
function bindingMaterial({chatId, subjectId, mechanismKeyValue, firstEvent}) {
  return {
    schema_version: TRACKING_WINDOW_SCHEMA_VERSION,
    chat_id: text(chatId),
    subject_id: text(subjectId),
    mechanism_key: text(mechanismKeyValue),
    first_event_id: text(firstEvent?.event_id),
    first_event_story_time: clone(firstEvent?.story_time ?? null),
  };
}

export function buildTrackingWindowCycleId({chatId, subjectId, mechanismKey: mechanism, firstEvent} = {}) {
  return buildProjectionTimingCycleId({
    chatId,
    subjectId,
    mechanismKey: mechanism,
    firstEvent,
  });
}

export function buildTrackingWindowId({cycleId} = {}) {
  return text(cycleId)
    ? `tracking_window_${deterministicDigest({schema_version: TRACKING_WINDOW_SCHEMA_VERSION, cycle_id: cycleId})}`
    : null;
}

export function areCompatibleTrackingWindowExposures(left, right) {
  const leftEvent = validEvent(left);
  const rightEvent = validEvent(right);
  if (!leftEvent || !rightEvent) return false;
  const leftSubjects = leftEvent.pregnancy_relevance.gestational_subject_ids;
  const rightSubjects = rightEvent.pregnancy_relevance.gestational_subject_ids;
  return leftSubjects.length === 1 && rightSubjects.length === 1
    && leftSubjects[0] === rightSubjects[0]
    && mechanismKey(leftEvent) === mechanismKey(rightEvent)
    && exposureForSubject(leftEvent, leftSubjects[0])
    && exposureForSubject(rightEvent, rightSubjects[0]);
}

export function validateTrackingWindow(value) {
  const errors = [];
  if (!isRecord(value)) return {ok: false, errors: ['tracking_window:invalid']};
  for (const key of Object.keys(value)) if (!WINDOW_FIELDS.has(key)) errors.push(`tracking_window.${key}:unexpected`);
  if (value.schema_version !== TRACKING_WINDOW_SCHEMA_VERSION) errors.push('tracking_window.schema_version:invalid');
  for (const field of ['tracking_window_id', 'cycle_id', 'subject_id', 'mechanism_key']) if (!text(value[field])) errors.push(`tracking_window.${field}:required`);
  if (!idArray(value.source_event_ids, true)) errors.push('tracking_window.source_event_ids:invalid');
  if (!isRecord(value.source_basis_refs)) errors.push('tracking_window.source_basis_refs:invalid');
  if (!TRACKING_WINDOW_STATUSES.includes(value.status)) errors.push('tracking_window.status:invalid');
  if (!isRecord(value.opened_at_floor_version)) errors.push('tracking_window.opened_at_floor_version:invalid');
  if (value.terminal_event_id !== null && value.terminal_event_id !== undefined && !text(value.terminal_event_id)) errors.push('tracking_window.terminal_event_id:invalid');
  if (value.terminal_reason !== null && value.terminal_reason !== undefined && !text(value.terminal_reason)) errors.push('tracking_window.terminal_reason:invalid');
  if (value.status === 'open' && (value.terminal_event_id || value.terminal_reason)) errors.push('tracking_window.open_terminal_fields:invalid');
  if (value.status !== 'open' && (!text(value.terminal_event_id) || !text(value.terminal_reason))) errors.push('tracking_window.terminal_fields:required');
  return {ok: errors.length === 0, errors};
}

export function normalizeTrackingWindow(value = {}) {
  const source = clone(value);
  const normalized = {
    schema_version: TRACKING_WINDOW_SCHEMA_VERSION,
    tracking_window_id: text(source.tracking_window_id),
    cycle_id: text(source.cycle_id),
    subject_id: text(source.subject_id),
    mechanism_key: text(source.mechanism_key)?.toLowerCase() ?? null,
    source_event_ids: [...new Set(Array.isArray(source.source_event_ids) ? source.source_event_ids.map(text).filter(Boolean) : [])].sort(),
    source_basis_refs: isRecord(source.source_basis_refs) ? source.source_basis_refs : {},
    status: TRACKING_WINDOW_STATUSES.includes(source.status) ? source.status : 'open',
    opened_story_time: clone(source.opened_story_time ?? null),
    opened_at_floor_version: clone(source.opened_at_floor_version ?? null),
    terminal_event_id: text(source.terminal_event_id),
    terminal_reason: text(source.terminal_reason),
    terminal_story_time: clone(source.terminal_story_time ?? null),
    terminal_at_floor_version: clone(source.terminal_at_floor_version ?? null),
    created_at: source.created_at ?? null,
    updated_at: source.updated_at ?? null,
  };
  const validation = validateTrackingWindow(normalized);
  if (!validation.ok) throw new TypeError(validation.errors.join(', '));
  return normalized;
}

function createWindow({chatId, subjectId, mechanism, event, now}) {
  const cycleId = buildTrackingWindowCycleId({
    chatId,
    subjectId,
    mechanismKey: mechanism,
    firstEvent: event,
  });
  const trackingWindowId = buildTrackingWindowId({cycleId});
  return normalizeTrackingWindow({
    tracking_window_id: trackingWindowId,
    cycle_id: cycleId,
    subject_id: subjectId,
    mechanism_key: mechanism,
    source_event_ids: [event.event_id],
    source_basis_refs: {
      [event.event_id]: {
        event_id: event.event_id,
        story_time: clone(event.story_time),
        source: eventVersion(event),
      },
    },
    status: 'open',
    opened_story_time: clone(event.story_time),
    opened_at_floor_version: eventVersion(event),
    terminal_event_id: null,
    terminal_reason: null,
    terminal_story_time: null,
    terminal_at_floor_version: null,
    created_at: typeof now === 'function' ? now() : null,
    updated_at: typeof now === 'function' ? now() : null,
  });
}

function attachExposure(window, event, now) {
  if (!window.source_event_ids.includes(event.event_id)) {
    window.source_event_ids.push(event.event_id);
    window.source_event_ids.sort();
    window.source_basis_refs[event.event_id] = {
      event_id: event.event_id,
      story_time: clone(event.story_time),
      source: eventVersion(event),
    };
  }
  window.updated_at = typeof now === 'function' ? now() : window.updated_at;
}

function closeWindow(window, event, now) {
  if (window.status !== 'open') return;
  window.status = TRACKING_WINDOW_TERMINAL_REASONS[event.type];
  window.terminal_event_id = event.event_id;
  window.terminal_reason = event.type;
  window.terminal_story_time = clone(event.story_time);
  window.terminal_at_floor_version = eventVersion(event);
  window.updated_at = typeof now === 'function' ? now() : window.updated_at;
}

export function deriveTrackingWindows(events = [], {chatId, now = () => new Date().toISOString()} = {}) {
  const normalizedEvents = [...new Map(
    (Array.isArray(events) ? events : [])
      .map(validEvent)
      .filter(Boolean)
      .filter(event => event.event_id)
      .map(event => [event.event_id, event]),
  ).values()].sort(eventSort);
  const windows = new Map();
  for (const event of normalizedEvents) {
    const subjects = [...new Set([
      ...(event.pregnancy_relevance?.gestational_subject_ids ?? []),
      ...(event.state_fact?.subject_id ? [event.state_fact.subject_id] : []),
    ])];
    for (const subjectId of subjects) {
      if (exposureForSubject(event, subjectId)) {
        const mechanism = mechanismKey(event);
        const open = [...windows.values()].find(window =>
          window.status === 'open'
          && window.subject_id === subjectId
          && window.mechanism_key === mechanism,
        );
        if (open) attachExposure(open, event, now);
        else {
          const created = createWindow({chatId, subjectId, mechanism, event, now});
          if (created.tracking_window_id) windows.set(created.tracking_window_id, created);
        }
      }
      if (terminalForSubject(event, subjectId)) {
        for (const window of windows.values()) {
          if (window.status !== 'open' || window.subject_id !== subjectId) continue;
          const order = compareStoryTime(event.story_time, window.opened_story_time);
          if (order !== null && order >= 0) closeWindow(window, event, now);
        }
      }
    }
  }
  return [...windows.values()].sort((left, right) => left.tracking_window_id.localeCompare(right.tracking_window_id));
}

export function activeTrackingWindows(windows = []) {
  return (Array.isArray(windows) ? windows : []).filter(window => window?.status === 'open');
}

export function openWindowExposureIds(windows = []) {
  return new Set(activeTrackingWindows(windows).flatMap(window => window.source_event_ids ?? []));
}

export function windowCycleMatchesTiming(window, timingInstance) {
  return Boolean(window && timingInstance && window.cycle_id === timingInstance.cycle_id);
}

export function trackingWindowBindingMaterial({chatId, subjectId, mechanismKey: mechanism, firstEvent} = {}) {
  return bindingMaterial({chatId, subjectId, mechanismKeyValue: mechanism, firstEvent});
}

export function mergeTrackingSubjectsWithActivePregnancies(trackingSubjects = {}, currentState = {}) {
  const result = isRecord(trackingSubjects) ? {...trackingSubjects} : {};
  for (const [characterId, character] of Object.entries(currentState?.characters ?? {})) {
    const pregnancyStatus = character?.pregnancy?.current_status;
    const hasActivePregnancy = pregnancyStatus === 'confirmed' || pregnancyStatus === 'suspected'
      || (Array.isArray(character?.pregnancy?.active_pregnancy_ids) && character.pregnancy.active_pregnancy_ids.length > 0);
    if (!hasActivePregnancy || result[characterId]) continue;
    result[characterId] = {
      character_id: characterId,
      display_name: character?.identity?.display_name ?? null,
      created_from_event_id: null,
      exposure_event_ids: [],
      status: 'active',
      factual_pregnancy_state: pregnancyStatus,
    };
  }
  return result;
}
