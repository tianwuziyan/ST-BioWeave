import {deterministicDigest} from './projection.js';

export const PREGNANCY_LIFECYCLE_SCHEMA_VERSION = 1;
export const PREGNANCY_LIFECYCLE_STATUSES = Object.freeze([
  'not_pregnant',
  'pregnant_ongoing',
  'miscarriage',
  'termination',
  'delivery',
  'outcome_unknown',
]);
export const PREGNANCY_TERMINAL_STATUSES = Object.freeze([
  'not_pregnant', 'miscarriage', 'termination', 'delivery',
]);

const STATUS_SET = new Set(PREGNANCY_LIFECYCLE_STATUSES);
const TERMINAL_SET = new Set(PREGNANCY_TERMINAL_STATUSES);

function record(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function text(value) { return typeof value === 'string' && value.trim() !== ''; }
function clone(value) {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return Array.isArray(value) ? value.map(clone) : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}
function unique(values) { return [...new Set((Array.isArray(values) ? values : []).filter(text))].sort(); }

export function buildPregnancyLifecycleFactId({subjectId, pregnancyId = null, cycleId, status, sourceEventId = null} = {}) {
  if (!text(subjectId) || !text(cycleId) || !STATUS_SET.has(status)) return null;
  return `pregnancy_lifecycle_${deterministicDigest({schema_version: PREGNANCY_LIFECYCLE_SCHEMA_VERSION, subject_id: subjectId, pregnancy_id: pregnancyId ?? null, cycle_id: cycleId, status, source_event_id: sourceEventId ?? null})}`;
}

export function normalizePregnancyLifecycleFact(value = {}) {
  const source = record(value);
  const status = text(source.status) ? source.status.trim() : null;
  const pregnancyId = source.pregnancy_id ?? null;
  const fact = {
    schema_version: PREGNANCY_LIFECYCLE_SCHEMA_VERSION,
    fact_id: source.fact_id ?? buildPregnancyLifecycleFactId({
      subjectId: source.subject_id,
      pregnancyId,
      cycleId: source.cycle_id,
      status,
      sourceEventId: source.source_event_id,
    }),
    subject_id: text(source.subject_id) ? source.subject_id.trim() : null,
    pregnancy_id: pregnancyId === null || pregnancyId === undefined ? null : String(pregnancyId).trim() || null,
    cycle_id: text(source.cycle_id) ? source.cycle_id.trim() : null,
    status,
    source_event_id: text(source.source_event_id) ? source.source_event_id.trim() : null,
    evidence_refs: unique(source.evidence_refs),
    source_floor_version: clone(source.source_floor_version ?? null),
    confirmed_at: source.confirmed_at ?? null,
  };
  return fact;
}

export function validatePregnancyLifecycleFact(value) {
  const fact = normalizePregnancyLifecycleFact(value);
  const errors = [];
  if (fact.schema_version !== PREGNANCY_LIFECYCLE_SCHEMA_VERSION) errors.push('schema_version');
  if (!text(fact.fact_id)) errors.push('fact_id');
  if (!text(fact.subject_id)) errors.push('subject_id');
  if (!text(fact.cycle_id)) errors.push('cycle_id');
  if (!STATUS_SET.has(fact.status)) errors.push('status');
  if (fact.status === 'not_pregnant' && fact.pregnancy_id !== null) errors.push('not_pregnant_pregnancy_id_must_be_null');
  if (fact.status !== 'not_pregnant' && !text(fact.pregnancy_id)) errors.push('pregnancy_id');
  if (!Array.isArray(fact.evidence_refs)) errors.push('evidence_refs');
  if (fact.status !== 'outcome_unknown' && !text(fact.source_event_id)) errors.push('source_event_id');
  return {ok: errors.length === 0, errors, value: fact};
}

export function emptyPregnancyLifecycleTimeline() {
  return {schema_version: PREGNANCY_LIFECYCLE_SCHEMA_VERSION, facts: [], candidate_records: [], archives: [], release_records: []};
}

export function normalizePregnancyLifecycleTimeline(value) {
  const source = record(value);
  const facts = [];
  const seenFacts = new Map();
  for (const item of Array.isArray(source.facts) ? source.facts : []) {
    const result = validatePregnancyLifecycleFact(item);
    if (!result.ok || seenFacts.has(result.value.fact_id)) continue;
    seenFacts.set(result.value.fact_id, true);
    facts.push(result.value);
  }
  const candidateRecords = (Array.isArray(source.candidate_records) ? source.candidate_records : [])
    .filter(item => text(item?.candidate_record_id) && text(item?.subject_id) && text(item?.cycle_id))
    .map(clone);
  const archives = (Array.isArray(source.archives) ? source.archives : [])
    .filter(item => text(item?.archive_id) && text(item?.subject_id) && text(item?.cycle_id))
    .map(clone);
  const releaseRecords = (Array.isArray(source.release_records) ? source.release_records : [])
    .filter(item => text(item?.operation_key) && text(item?.subject_id) && text(item?.cycle_id))
    .map(clone);
  return {schema_version: PREGNANCY_LIFECYCLE_SCHEMA_VERSION, facts, candidate_records: candidateRecords, archives, release_records: releaseRecords};
}

export function appendPregnancyLifecycleFact(timeline, value) {
  const result = validatePregnancyLifecycleFact(value);
  if (!result.ok) throw new TypeError(result.errors.join(', '));
  const current = normalizePregnancyLifecycleTimeline(timeline);
  const existing = current.facts.find(item => item.fact_id === result.value.fact_id);
  if (existing) return JSON.stringify(existing) === JSON.stringify(result.value)
    ? {status: 'deduped', timeline: current}
    : {status: 'conflict', timeline: current};
  const sameIdentity = current.facts.filter(item => item.subject_id === result.value.subject_id && item.cycle_id === result.value.cycle_id);
  if (sameIdentity.some(item => TERMINAL_SET.has(item.status) && TERMINAL_SET.has(result.value.status) && item.status !== result.value.status)) {
    return {status: 'fact_conflict', timeline: current};
  }
  return {status: 'appended', timeline: {...current, facts: [...current.facts, result.value]}};
}

export function buildCandidateRecord({subjectId, pregnancyId, cycleId, candidates = [], sourceExposureEventIds = [], participantMapping = [], projectionEvidence = [], fatherStatus = 'unknown'} = {}) {
  if (!text(subjectId) || !text(cycleId)) throw new TypeError('CANDIDATE_IDENTITY_REQUIRED');
  const candidateRecordId = `candidate_${deterministicDigest({schema_version: PREGNANCY_LIFECYCLE_SCHEMA_VERSION, subject_id: subjectId, pregnancy_id: pregnancyId ?? null, cycle_id: cycleId})}`;
  return {schema_version: PREGNANCY_LIFECYCLE_SCHEMA_VERSION, candidate_record_id: candidateRecordId, subject_id: subjectId, pregnancy_id: pregnancyId ?? null, cycle_id: cycleId, candidates: clone(candidates), source_exposure_event_ids: unique(sourceExposureEventIds), participant_mapping: clone(participantMapping), projection_evidence: clone(projectionEvidence), father_status: fatherStatus === 'confirmed' ? 'confirmed' : 'unknown'};
}

export function buildArchiveSnapshot({fact = null, closureReason = null, aggregation = null, candidateRecord = null, floorVersion, exposureEventIds = [], operationKey} = {}) {
  const normalized = fact ? validatePregnancyLifecycleFact(fact) : {ok: false, value: null};
  if (fact && !normalized.ok) throw new TypeError(normalized.errors.join(', '));
  if (!normalized.value && closureReason !== 'timeout_no_pregnancy') throw new TypeError('ARCHIVE_CLOSURE_REASON_REQUIRED');
  const value = normalized.value ?? {
    fact_id: null,
    subject_id: aggregation?.subject_id ?? null,
    pregnancy_id: aggregation?.pregnancy_id ?? null,
    cycle_id: aggregation?.cycle_id ?? null,
    source_event_id: null,
  };
  if (!value.subject_id || !value.cycle_id) throw new TypeError('ARCHIVE_IDENTITY_REQUIRED');
  const archiveId = `archive_${deterministicDigest({fact_id: value.fact_id, closure_reason: closureReason ?? null, subject_id: value.subject_id, pregnancy_id: value.pregnancy_id ?? null, cycle_id: value.cycle_id, operation_key: operationKey ?? null})}`;
  return {
    schema_version: PREGNANCY_LIFECYCLE_SCHEMA_VERSION,
    archive_id: archiveId,
    operation_key: operationKey ?? archiveId,
    subject_id: value.subject_id,
    pregnancy_id: value.pregnancy_id,
    cycle_id: value.cycle_id,
    terminal_status: closureReason ?? value.status,
    terminal_fact_id: value.fact_id,
    closure_reason: closureReason ?? null,
    accepted_exposure_event_ids: unique(exposureEventIds.length ? exposureEventIds : aggregation?.accepted_exposure_event_ids),
    aggregation_id: aggregation?.aggregation_id ?? null,
    participant_mapping: clone(candidateRecord?.participant_mapping ?? aggregation?.participant_exposure_mapping ?? []),
    candidates: clone(candidateRecord?.candidates ?? []),
    projection_evidence: clone(candidateRecord?.projection_evidence ?? []),
    source_event_ids: unique([value.source_event_id, ...(candidateRecord?.source_exposure_event_ids ?? [])]),
    archived_at_floor_version: clone(floorVersion ?? value.source_floor_version),
    archived_at: new Date().toISOString(),
  };
}

export function cycleLockKey({subjectId, pregnancyId = null, cycleId} = {}) {
  return text(subjectId) && text(cycleId) ? `${subjectId}:${pregnancyId ?? 'none'}:${cycleId}` : null;
}

export function isTerminalLifecycleStatus(status) { return TERMINAL_SET.has(status); }
