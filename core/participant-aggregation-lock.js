export const PARTICIPANT_AGGREGATION_LOCK_DISABLED = 'disabled_until_lifecycle_archive_release';

function text(value) { return typeof value === 'string' && value.trim() !== ''; }

export function isParticipantAggregationLockEnabled({lifecycleArchiveReleaseReady = false} = {}) {
  return lifecycleArchiveReleaseReady === true;
}

export function filterSubjectExposureSlices({slices = [], lockedSubjectIds = [], lifecycleArchiveReleaseReady = false} = {}) {
  const source = Array.isArray(slices) ? slices : [];
  if (!isParticipantAggregationLockEnabled({lifecycleArchiveReleaseReady})) return {enabled: false, reason_code: PARTICIPANT_AGGREGATION_LOCK_DISABLED, slices: source.slice()};
  const locked = new Set((Array.isArray(lockedSubjectIds) ? lockedSubjectIds : []).filter(text));
  return {
    enabled: true,
    reason_code: 'lifecycle_archive_release_ready',
    slices: source.filter(slice => !locked.has(slice?.subject_id)),
  };
}

function lockableSlice(slice) {
  return slice?.type === 'sexual_activity' && slice?.pregnancy_relevance?.relevant === true;
}

export function resolveCycleLocks({aggregations = [], lifecycleFacts = [], releaseRecords = undefined, lifecycleArchiveReleaseReady = false} = {}) {
  if (!isParticipantAggregationLockEnabled({lifecycleArchiveReleaseReady})) return new Set();
  const terminal = new Set(['not_pregnant', 'miscarriage', 'termination', 'delivery']);
  const facts = new Map();
  for (const fact of Array.isArray(lifecycleFacts) ? lifecycleFacts : []) {
    const key = `${fact?.subject_id ?? ''}:${fact?.pregnancy_id ?? 'none'}:${fact?.cycle_id ?? ''}`;
    if (key && fact?.status) facts.set(key, fact.status);
  }
  const locks = new Set();
  const releaseStateProvided = Array.isArray(releaseRecords);
  const released = new Set((releaseRecords ?? [])
    .filter(record => record?.action === 'cycle-lock-released')
    .map(record => `${record?.subject_id ?? ''}:${record?.pregnancy_id ?? 'none'}:${record?.cycle_id ?? ''}`));
  for (const aggregation of Array.isArray(aggregations) ? aggregations : []) {
    if (aggregation?.status !== 'succeeded' || !text(aggregation?.subject_id) || !text(aggregation?.cycle_id)) continue;
    const key = `${aggregation.subject_id}:${aggregation.pregnancy_id ?? 'none'}:${aggregation.cycle_id}`;
    if (releaseStateProvided ? !released.has(key) : !terminal.has(facts.get(key))) locks.add(key);
  }
  return locks;
}

export function isCycleExposureLocked({event = null, lockedCycleKeys = [], lifecycleArchiveReleaseReady = false} = {}) {
  if (!isParticipantAggregationLockEnabled({lifecycleArchiveReleaseReady}) || !lockableSlice(event)) return false;
  const subjects = event?.pregnancy_relevance?.gestational_subject_ids ?? [];
  const locked = new Set((Array.isArray(lockedCycleKeys) ? lockedCycleKeys : []).filter(text));
  const explicitCycleId = event?.cycle_id ?? event?.pregnancy_relevance?.cycle_id ?? null;
  const explicitPregnancyId = event?.pregnancy_id ?? event?.pregnancy_relevance?.pregnancy_id ?? 'none';
  return subjects.some(subjectId => explicitCycleId
    ? locked.has(`${subjectId}:${explicitPregnancyId}:${explicitCycleId}`)
    : [...locked].some(key => key.startsWith(`${subjectId}:`)));
}

export function filterCycleLockedSlices({slices = [], lockedCycleKeys = [], lifecycleArchiveReleaseReady = false} = {}) {
  const source = Array.isArray(slices) ? slices : [];
  if (!isParticipantAggregationLockEnabled({lifecycleArchiveReleaseReady})) return {enabled: false, reason_code: PARTICIPANT_AGGREGATION_LOCK_DISABLED, slices: source.slice()};
  const locked = new Set((Array.isArray(lockedCycleKeys) ? lockedCycleKeys : []).filter(text));
  return {
    enabled: true,
    reason_code: 'lifecycle_archive_release_ready',
    slices: source.filter(slice => {
      if (!lockableSlice(slice)) return true;
      const subjectId = slice?.subject_id ?? slice?.gestational_subject_id;
      const pregnancyId = slice?.pregnancy_id ?? slice?.pregnancy_relevance?.pregnancy_id ?? 'none';
      const cycleId = slice?.cycle_id ?? slice?.pregnancy_relevance?.cycle_id;
      return !locked.has(`${subjectId ?? ''}:${pregnancyId}:${cycleId ?? ''}`);
    }),
  };
}

export function isSubjectEventEditable({subjectId, lockedSubjectIds = [], lifecycleArchiveReleaseReady = false} = {}) {
  if (!isParticipantAggregationLockEnabled({lifecycleArchiveReleaseReady})) return {allowed: true, reason_code: PARTICIPANT_AGGREGATION_LOCK_DISABLED};
  return new Set((Array.isArray(lockedSubjectIds) ? lockedSubjectIds : []).filter(text)).has(subjectId)
    ? {allowed: false, reason_code: 'participant_aggregation_event_locked'}
    : {allowed: true, reason_code: 'participant_aggregation_event_unlocked'};
}

export function isCycleEventEditable({subjectId, pregnancyId = null, cycleId, event = null, lockedCycleKeys = [], lifecycleArchiveReleaseReady = false} = {}) {
  if (!isParticipantAggregationLockEnabled({lifecycleArchiveReleaseReady})) return {allowed: true, reason_code: PARTICIPANT_AGGREGATION_LOCK_DISABLED};
  if (!lockableSlice(event)) return {allowed: true, reason_code: 'non_nsfw_event'};
  const key = `${subjectId ?? ''}:${pregnancyId ?? 'none'}:${cycleId ?? ''}`;
  return new Set((Array.isArray(lockedCycleKeys) ? lockedCycleKeys : []).filter(text)).has(key)
    ? {allowed: false, reason_code: 'participant_aggregation_event_locked', cycle_key: key}
    : {allowed: true, reason_code: 'participant_aggregation_event_unlocked', cycle_key: key};
}
