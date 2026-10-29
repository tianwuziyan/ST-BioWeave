import { compareStoryTime, differenceStoryTime } from '../story/time.js';
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
  'expired',
]);
export const TRACKING_WINDOW_TERMINAL_REASONS = Object.freeze({
  pregnancy_confirmation: 'resolved_pregnant',
  pregnancy_loss: 'terminated',
  abortion: 'terminated',
  delivery: 'terminated',
});

const WINDOW_FIELDS = new Set([
  'schema_version', 'tracking_window_id', 'cycle_id', 'subject_id',
  'mechanism_key', 'source_event_ids', 'source_basis_refs', 'status',
  'opened_story_time', 'opened_at_floor_version', 'terminal_event_id',
  'terminal_reason', 'terminal_story_time', 'terminal_at_floor_version',
  'created_at', 'updated_at',
]);

export const TRACKING_WINDOW_EXPIRATION_REASON = 'tracking_window_horizon_reached';

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function clone(value, metrics = null) {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  if (metrics) metrics.clone_count += 1;
  if (typeof structuredClone === 'function') return structuredClone(value);
  if (Array.isArray(value)) return value.map(item => clone(item, metrics));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item, metrics)]));
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
function eventVersion(event, metrics = null) {
  return clone(event?.source ?? null, metrics);
}

function now() {
  return typeof performance?.now === 'function' ? performance.now() : Date.now();
}

function nowTime() {
  return typeof performance?.now === 'function' ? performance.now() : Date.now();
}

function normalizedStoryTimeParts(value) {
  const normalized = typeof value?.normalized === 'string' ? value.normalized.trim() : '';
  const match = normalized.match(/^(?:(cn)-(-?\d+)-(\d+)-(\d+)|(-?\d{4})-(\d{2})-(\d{2}))(?:T(\d{2}):(\d{2}))?$/u);
  if (!match) return null;
  return {
    domain: match[1] ? 'cn' : 'gregorian',
    year: Number(match[2] ?? match[5]),
    month: Number(match[3] ?? match[6]),
    day: Number(match[4] ?? match[7]),
    minute: match[8] == null ? null : Number(match[8]) * 60 + Number(match[9]),
    calendarId: value?.calendar_id ?? null,
  };
}

function fastNormalizedStoryTimeCompare(left, right) {
  const leftParts = normalizedStoryTimeParts(left);
  const rightParts = normalizedStoryTimeParts(right);
  if (!leftParts || !rightParts || leftParts.domain !== rightParts.domain) return undefined;
  if (leftParts.calendarId !== rightParts.calendarId && leftParts.calendarId && rightParts.calendarId)
    return null;
  for (const field of ['year', 'month', 'day']) {
    if (leftParts[field] !== rightParts[field]) return leftParts[field] < rightParts[field] ? -1 : 1;
  }
  if (leftParts.minute !== null && rightParts.minute !== null && leftParts.minute !== rightParts.minute)
    return leftParts.minute < rightParts.minute ? -1 : 1;
  return 0;
}

function measuredStoryTime(left, right, metrics) {
  if (metrics) metrics.story_time_compare_count += 1;
  if (metrics && left && typeof left === 'object' && right && typeof right === 'object') {
    const rightCache = metrics.story_time_cache.get(left);
    if (rightCache?.has(right)) {
      metrics.story_time_compare_cache_hit_count += 1;
      return rightCache.get(right);
    }
  }
  const fastResult = fastNormalizedStoryTimeCompare(left, right);
  if (fastResult !== undefined) {
    if (metrics) metrics.fast_story_time_compare_count += 1;
    return fastResult;
  }
  const startedAt = metrics ? now() : 0;
  const result = compareStoryTime(left, right);
  if (metrics) {
    metrics.story_time_compare_ms += Math.max(0, now() - startedAt);
    if (left && typeof left === 'object' && right && typeof right === 'object') {
      let rightCache = metrics.story_time_cache.get(left);
      if (!rightCache) {
        rightCache = new WeakMap();
        metrics.story_time_cache.set(left, rightCache);
      }
      rightCache.set(right, result);
    }
  }
  return result;
}

function eventChronology(left, right) {
  return compareStoryTime(left?.story_time, right?.story_time);
}

function hasReliableStoryTime(event) {
  return compareStoryTime(event?.story_time, event?.story_time) !== null;
}

function eventSort(left, right, metrics = null) {
  const storyComparison = measuredStoryTime(left?.story_time, right?.story_time, metrics);
  if (storyComparison !== null) {
    if (storyComparison !== 0) return storyComparison;
    return String(left?.event_id ?? '').localeCompare(String(right?.event_id ?? ''));
  }
  return 0;
}
function validEvent(raw, metrics = null) {
  const startedAt = metrics ? now() : 0;
  if (metrics) metrics.normalize_validate_count += 1;
  try {
    const event = normalizeEvent(raw);
    const result = validateEvent(event).ok ? event : null;
    if (metrics) metrics.normalize_validate_ms += Math.max(0, now() - startedAt);
    return result;
  } catch {
    if (metrics) metrics.normalize_validate_ms += Math.max(0, now() - startedAt);
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

function matchingTimingInstance(window, timingInstances = []) {
  if (!window?.cycle_id) return null;
  return (Array.isArray(timingInstances) ? timingInstances : []).find(instance =>
    instance?.cycle_id === window.cycle_id
      && instance?.subject_id === window.subject_id
      && instance?.mechanism_key === window.mechanism_key
      && Number.isFinite(Number(instance.effective_max_story_days))) ?? null;
}

function aggregationIdentityKey(value = {}) {
  return `${value?.subject_id ?? ''}:${value?.pregnancy_id ?? 'none'}:${value?.cycle_id ?? ''}`;
}

export function isExposureBlockedByParticipantAggregation({event = null, subjectId = null, mechanismKey: expectedMechanismKey = null, participantAggregations = [], lifecycleReleaseRecords = []} = {}) {
  if (!event?.event_id || !text(subjectId) || !text(expectedMechanismKey)) return false;
  const released = new Set((Array.isArray(lifecycleReleaseRecords) ? lifecycleReleaseRecords : [])
    .filter(record => record?.action === 'cycle-lock-released')
    .map(aggregationIdentityKey));
  const activeAggregations = (Array.isArray(participantAggregations) ? participantAggregations : [])
    .filter(aggregation => aggregation?.status === 'succeeded'
      && aggregation?.subject_id === subjectId
      && aggregation?.mechanism_key === expectedMechanismKey
      && !released.has(aggregationIdentityKey(aggregation)));
  if (!activeAggregations.length) return false;
  return !activeAggregations.some(aggregation =>
    (aggregation.accepted_exposure_event_ids ?? []).includes(event.event_id),
  );
}

function horizonReachedBeforeExposure(window, event, {timingInstances = []} = {}) {
  if (!window || window.status !== 'open' || !event?.story_time || !window.opened_story_time) return false;
  const timing = matchingTimingInstance(window, timingInstances);
  if (!timing) return false;
  const difference = differenceStoryTime(event.story_time, window.opened_story_time);
  return Boolean(
    difference &&
    difference.unit === 'day' &&
    Number.isFinite(Number(difference.value)) &&
    Number(difference.value) >= Number(timing.effective_max_story_days),
  );
}

function confirmationForSubject(event, subjectId) {
  return event?.type === 'pregnancy_confirmation'
    && event?.status === 'confirmed'
    && event?.state_fact?.subject_id === subjectId
    && text(event?.state_fact?.payload?.pregnancy_id)
    ? event
    : null;
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

export function buildTrackingWindowCycleId({chatId, subjectId, mechanismKey: mechanism, firstEvent, metrics = null} = {}) {
  const startedAt = metrics ? now() : 0;
  if (metrics) metrics.digest_count += 1;
  const result = buildProjectionTimingCycleId({
    chatId,
    subjectId,
    mechanismKey: mechanism,
    firstEvent,
  });
  if (metrics) metrics.digest_ms += Math.max(0, now() - startedAt);
  return result;
}

export function buildTrackingWindowId({cycleId, metrics = null} = {}) {
  if (!text(cycleId)) return null;
  const startedAt = metrics ? now() : 0;
  if (metrics) metrics.digest_count += 1;
  const result = `tracking_window_${deterministicDigest({schema_version: TRACKING_WINDOW_SCHEMA_VERSION, cycle_id: cycleId})}`;
  if (metrics) metrics.digest_ms += Math.max(0, now() - startedAt);
  return result;
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
  if (value.status !== 'open' && value.status !== 'expired' && (!text(value.terminal_event_id) || !text(value.terminal_reason))) errors.push('tracking_window.terminal_fields:required');
  if (value.status === 'expired' && (!text(value.terminal_reason) || value.terminal_event_id)) errors.push('tracking_window.expired_terminal_fields:invalid');
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

function profileIdentity(profile) {
  return {
    species: text(profile?.species ?? profile?.biological_context?.species),
    biologicalType: text(profile?.biological_type ?? profile?.biological_context?.biological_type),
  };
}

/** Resolve only an exact World mechanism declaration. Missing or ambiguous
 * identity is intentionally indistinguishable from an unavailable horizon. */
export function resolveTrackingWindowHorizon({worldModel = {}, subjectProfile = null, mechanismKey: requestedMechanism} = {}) {
  const identity = profileIdentity(subjectProfile);
  const mechanism = text(requestedMechanism)?.toLowerCase();
  if (!identity.species || !identity.biologicalType || !mechanism) return null;
  const species = (Array.isArray(worldModel?.species) ? worldModel.species : [])
    .filter(item => text(item?.name) === identity.species);
  if (species.length !== 1) return null;
  const types = (Array.isArray(species[0].biological_types) ? species[0].biological_types : [])
    .filter(item => text(item?.name) === identity.biologicalType);
  if (types.length !== 1) return null;
  const mechanisms = (Array.isArray(types[0].reproductive_mechanisms) ? types[0].reproductive_mechanisms : [])
    .filter(item => text(item?.key)?.toLowerCase() === mechanism);
  if (mechanisms.length !== 1) return null;
  const horizon = mechanisms[0].tracking_window_horizon;
  const maxDays = Number(horizon?.max_story_days);
  return horizon?.schema_version === 1 && Number.isInteger(maxDays) && maxDays >= 0
    ? {schema_version: 1, max_story_days: maxDays}
    : null;
}

export function evaluateTrackingWindowHorizon(window, {timingInstances = [], currentStoryTime = null, now = () => new Date().toISOString(), floorVersion = null} = {}) {
  if (!window || window.status !== 'open') return window;
  const timing = matchingTimingInstance(window, timingInstances);
  if (!timing || !currentStoryTime || !window.opened_story_time) return window;
  const difference = differenceStoryTime(currentStoryTime, window.opened_story_time);
  if (!difference || difference.unit !== 'day' || !Number.isFinite(Number(difference.value)) || Number(difference.value) < Number(timing.effective_max_story_days)) return window;
  return normalizeTrackingWindow({
    ...window,
    status: 'expired',
    terminal_event_id: null,
    terminal_reason: TRACKING_WINDOW_EXPIRATION_REASON,
    terminal_story_time: clone(currentStoryTime),
    terminal_at_floor_version: clone(floorVersion),
    updated_at: typeof now === 'function' ? now() : window.updated_at,
  });
}

export function evaluateTrackingWindowLifecycles(windows = [], options = {}) {
  return (Array.isArray(windows) ? windows : [])
    .map(window => evaluateTrackingWindowHorizon(window, {
      ...options,
    }))
    .sort((left, right) => String(left?.tracking_window_id ?? '').localeCompare(String(right?.tracking_window_id ?? '')));
}

function createWindow({chatId, subjectId, mechanism, event, now: timestamp, metrics = null}) {
  const startedAt = metrics ? now() : 0;
  const cycleId = buildTrackingWindowCycleId({
    chatId,
    subjectId,
    mechanismKey: mechanism,
    firstEvent: event,
    metrics,
  });
  const trackingWindowId = buildTrackingWindowId({cycleId, metrics});
  const result = normalizeTrackingWindow({
    tracking_window_id: trackingWindowId,
    cycle_id: cycleId,
    subject_id: subjectId,
    mechanism_key: mechanism,
    source_event_ids: [event.event_id],
    source_basis_refs: {
      [event.event_id]: {
        event_id: event.event_id,
        story_time: clone(event.story_time, metrics),
        source: eventVersion(event, metrics),
      },
    },
    status: 'open',
    opened_story_time: clone(event.story_time, metrics),
    opened_at_floor_version: eventVersion(event, metrics),
    terminal_event_id: null,
    terminal_reason: null,
    terminal_story_time: null,
    terminal_at_floor_version: null,
    created_at: typeof timestamp === 'function' ? timestamp() : null,
    updated_at: typeof timestamp === 'function' ? timestamp() : null,
  });
  if (metrics) metrics.window_create_ms += Math.max(0, now() - startedAt);
  return result;
}

function attachExposure(window, event, timestamp, metrics = null) {
  const startedAt = metrics ? now() : 0;
  if (!window.source_event_ids.includes(event.event_id)) {
    window.source_event_ids.push(event.event_id);
    window.source_event_ids.sort();
    window.source_basis_refs[event.event_id] = {
      event_id: event.event_id,
      story_time: clone(event.story_time, metrics),
      source: eventVersion(event, metrics),
    };
  }
  window.updated_at = typeof timestamp === 'function' ? timestamp() : window.updated_at;
  if (metrics) metrics.window_binding_ms += Math.max(0, now() - startedAt);
}

function closeWindow(window, event, timestamp, metrics = null) {
  const startedAt = metrics ? now() : 0;
  if (window.status !== 'open') return;
  window.status = TRACKING_WINDOW_TERMINAL_REASONS[event.type];
  window.terminal_event_id = event.event_id;
  window.terminal_reason = event.type;
  window.terminal_story_time = clone(event.story_time, metrics);
  window.terminal_at_floor_version = eventVersion(event, metrics);
  window.updated_at = typeof timestamp === 'function' ? timestamp() : window.updated_at;
  if (metrics) metrics.window_binding_ms += Math.max(0, now() - startedAt);
}

export function deriveTrackingWindows(events = [], {
  chatId,
  now = () => null,
  worldModel = {},
  subjectProfiles = {},
  timingInstances = [],
  participantAggregations = [],
  lifecycleReleaseRecords = [],
  currentStoryTime = null,
  onDiagnostics = null,
} = {}) {
  const metrics = {
    normalize_validate_count: 0,
    normalize_validate_ms: 0,
    sort_compare_count: 0,
    sort_ms: 0,
    story_time_compare_count: 0,
    story_time_compare_ms: 0,
    story_time_compare_cache_hit_count: 0,
    fast_story_time_compare_count: 0,
    story_time_cache: new WeakMap(),
    window_create_count: 0,
    window_create_ms: 0,
    window_binding_ms: 0,
    clone_count: 0,
    digest_count: 0,
    digest_ms: 0,
    output_ms: 0,
  };
  const totalStartedAt = nowTime();
  const normalizedEvents = [...new Map(
    (Array.isArray(events) ? events : [])
      .map(event => validEvent(event, metrics))
      .filter(Boolean)
      .filter(event => event.event_id)
      // Only exposure and pregnancy-lifecycle Events can affect a Window.
      // Other state facts (for example physical symptoms) cannot open,
      // resolve, terminate, or expire one, so excluding them before
      // chronology sorting avoids Story Time parsing work.
      .filter(event =>
        isPregnancyRelevantExposure(event) ||
        event.type === 'pregnancy_confirmation' ||
        Object.hasOwn(TRACKING_WINDOW_TERMINAL_REASONS, event.type),
      )
      .filter(event => {
        if (!isPregnancyRelevantExposure(event)) return true;
        const subjects = event?.pregnancy_relevance?.gestational_subject_ids ?? [];
        const expectedMechanismKey = mechanismKey(event);
        return subjects.every(subjectId => !isExposureBlockedByParticipantAggregation({
          event,
          subjectId,
          mechanismKey: expectedMechanismKey,
          participantAggregations,
          lifecycleReleaseRecords,
        }));
      })
      .filter(event => {
        const order = measuredStoryTime(event.story_time, currentStoryTime, metrics);
        return order === null || order <= 0;
      })
      .map(event => [event.event_id, event]),
  ).values()];
  const sortStartedAt = nowTime();
  normalizedEvents.sort((left, right) => {
    metrics.sort_compare_count += 1;
    return eventSort(left, right, metrics);
  });
  metrics.sort_ms = Math.max(0, nowTime() - sortStartedAt);
  const ambiguousExposureIds = new Set();
  for (let leftIndex = 0; leftIndex < normalizedEvents.length; leftIndex += 1) {
    const left = normalizedEvents[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < normalizedEvents.length; rightIndex += 1) {
      const right = normalizedEvents[rightIndex];
      if (measuredStoryTime(left.story_time, right.story_time, metrics) !== null) continue;
      const leftSubjects = left.pregnancy_relevance?.gestational_subject_ids ?? [];
      const rightSubjects = right.pregnancy_relevance?.gestational_subject_ids ?? [];
      if (!leftSubjects.some(subjectId => rightSubjects.includes(subjectId))) continue;
      if (!leftSubjects.some(subjectId => exposureForSubject(left, subjectId) && exposureForSubject(right, subjectId))) continue;
      ambiguousExposureIds.add(left.event_id);
      ambiguousExposureIds.add(right.event_id);
    }
  }
  const windows = new Map();
  const confirmedPregnancies = new Map();
  for (const event of normalizedEvents) {
    const subjects = [...new Set([
      ...(event.pregnancy_relevance?.gestational_subject_ids ?? []),
      ...(event.state_fact?.subject_id ? [event.state_fact.subject_id] : []),
    ])];
    for (const subjectId of subjects) {
      if (exposureForSubject(event, subjectId)) {
        if (!hasReliableStoryTime(event) || ambiguousExposureIds.has(event.event_id)) continue;
        const confirmation = confirmedPregnancies.get(subjectId);
        const afterConfirmation = confirmation
          && measuredStoryTime(event.story_time, confirmation.story_time, metrics) !== null
          && measuredStoryTime(event.story_time, confirmation.story_time, metrics) > 0;
        if (afterConfirmation) continue;
        const mechanism = mechanismKey(event);
        const open = [...windows.values()].find(window =>
          window.status === 'open'
          && window.subject_id === subjectId
          && window.mechanism_key === mechanism,
        );
        const orderAgainstAnchor = open ? measuredStoryTime(event.story_time, {
          story_time: open.opened_story_time,
        }, metrics) : null;
        if (open && orderAgainstAnchor === null && !open.source_event_ids.includes(event.event_id)) {
          // An exposure with no comparable Story Time and no distinct trusted
          // Floor cannot safely become part of this cycle or move its anchor.
          continue;
        }
        if (open && !horizonReachedBeforeExposure(open, event, {timingInstances})) {
          attachExposure(open, event, now, metrics);
        } else if (open) {
          metrics.window_create_count += 1;
          const created = createWindow({chatId, subjectId, mechanism, event, now: now, metrics});
          if (created.tracking_window_id) windows.set(created.tracking_window_id, created);
        }
        else {
          const historicalResolved = [...windows.values()].find(window => {
            if (window.status !== 'resolved_pregnant' || window.subject_id !== subjectId || window.mechanism_key !== mechanism) return false;
            const order = measuredStoryTime(event.story_time, window.terminal_story_time, metrics);
            return order !== null && order <= 0;
          });
          if (historicalResolved) attachExposure(historicalResolved, event, now, metrics);
          else {
            metrics.window_create_count += 1;
            const created = createWindow({chatId, subjectId, mechanism, event, now: now, metrics});
            if (created.tracking_window_id) windows.set(created.tracking_window_id, created);
          }
        }
      }
      const confirmation = confirmationForSubject(event, subjectId);
      if (confirmation) confirmedPregnancies.set(subjectId, confirmation);
      if (terminalForSubject(event, subjectId)) {
        if (event.type !== 'pregnancy_confirmation') {
          const confirmation = confirmedPregnancies.get(subjectId);
          const afterConfirmation = confirmation
            && measuredStoryTime(event.story_time, confirmation.story_time, metrics) !== null
            && measuredStoryTime(event.story_time, confirmation.story_time, metrics) >= 0;
          if (afterConfirmation) confirmedPregnancies.delete(subjectId);
        }
        for (const window of windows.values()) {
          if (window.status !== 'open' || window.subject_id !== subjectId) continue;
          const order = measuredStoryTime(event.story_time, window.opened_story_time, metrics);
          if (order !== null && order >= 0) closeWindow(window, event, now, metrics);
        }
      }
    }
  }
  const outputStartedAt = nowTime();
  const result = [...windows.values()].sort((left, right) => left.tracking_window_id.localeCompare(right.tracking_window_id));
  metrics.output_ms = Math.max(0, nowTime() - outputStartedAt);
  if (typeof onDiagnostics === 'function') {
    const {story_time_cache, ...safeMetrics} = metrics;
    onDiagnostics({...safeMetrics, total_ms: Math.max(0, nowTime() - totalStartedAt)});
  }
  return result;
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
