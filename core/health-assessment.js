import {normalizeEvent} from './events.js';
import {HEALTH_ROLES} from './events.js';
import {normalizeStoryTime} from '../story/time.js';
import {hashText} from '../runtime/floor.js';

const HEALTH_EVENT_TYPES = new Set(['physical_symptom', 'medical_event', 'other_biological']);

export const HEALTH_ASSESSMENT_SCHEMA_VERSION = 3;
export const HEALTH_ASSESSMENT_RECOVERY_STAGES = Object.freeze([
  'early', 'recovering', 'near_recovery',
]);
export const HEALTH_ASSESSMENT_GUIDANCE_MAX_LENGTH = 600;
export const HEALTH_ASSESSMENT_SEVERITY = Object.freeze([
  'unknown', 'mild', 'moderate', 'severe',
]);
export const HEALTH_ASSESSMENT_PERSISTENCE = Object.freeze([
  'short_term', 'long_term', 'permanent', 'unknown',
]);
export const HEALTH_ASSESSMENT_RECOVERY = Object.freeze([
  'eligible', 'not_eligible', 'unknown',
]);
export const HEALTH_ASSESSMENT_SOURCES = Object.freeze([
  'explicit_narrative_timing',
  'ai_derived_assessment',
  'world_model_rule',
  'product_policy_fallback',
  'unknown',
]);

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

export function stableHealthAssessmentString(value) {
  return JSON.stringify(stable(value));
}

function healthFact(event) {
  const payload = record(event?.state_fact?.payload);
  return record(payload.symptom ?? payload.fact);
}

export function healthRoleOfEvent(rawEvent) {
  const event = normalizeEvent(rawEvent);
  const role = healthFact(event).health_role;
  return HEALTH_ROLES.includes(role) ? role : null;
}

export function healthAssessmentEligibility(rawEvent) {
  const event = normalizeEvent(rawEvent);
  const role = healthRoleOfEvent(event);
  const factualValid = HEALTH_EVENT_TYPES.has(event.type)
    && !['negated', 'fictional'].includes(event.status)
    && Boolean(event.state_fact?.subject_id)
    && Array.isArray(event.source_evidence)
    && event.source_evidence.length > 0;
  const eligibleRole = factualValid && role === 'observation';
  return {
    eligible: eligibleRole,
    reason: eligibleRole
      ? 'eligible_health_observation'
      : role === 'intervention'
        ? 'health_intervention_not_assessment_eligible'
        : 'health_role_observation_required',
    event,
  };
}

// Deliberately excludes location, display-only metadata, diagnostics and the
// generated source envelope. The same event id/version can be edited in place.
export function healthObservationFingerprint(rawEvent) {
  const event = normalizeEvent(rawEvent);
  return stableHealthAssessmentString({
    type: event.type,
    status: event.status,
    subject_id: event.state_fact?.subject_id ?? null,
    participants: (event.participants ?? []).map(item => ({
      character_id: item.character_id ?? null,
      event_role: item.event_role ?? null,
      biological_context: item.biological_context ?? null,
    })).sort((a, b) => stableHealthAssessmentString(a).localeCompare(stableHealthAssessmentString(b))),
    pregnancy_relevance: event.pregnancy_relevance?.relevant === true
      ? {relevant: true, gestational_subject_ids: event.pregnancy_relevance.gestational_subject_ids}
      : {relevant: false},
    source_evidence: event.source_evidence,
    physical_effect: event.physical_effect,
    state_fact: event.state_fact,
    story_time: normalizeStoryTime(event.story_time),
  });
}

export async function healthAssessmentRequestKey({eventId, floorVersion, observationFingerprint}) {
  const version = record(floorVersion);
  const material = stableHealthAssessmentString({
    event_id: eventId ?? null,
    floor_version: {
      chat_id: version.chat_id ?? null,
      message_id: version.message_id ?? null,
      floor: version.floor ?? null,
      swipe_id: version.swipe_id ?? null,
      content_hash: version.content_hash ?? null,
      message_version: version.message_version ?? null,
    },
    observation_fingerprint: observationFingerprint ?? null,
  });
  return `health_assessment_${(await hashText(material)).slice(0, 48)}`;
}

function normalizeDuration(value) {
  const source = record(value);
  const days = Number(source.story_days ?? source.days);
  return Number.isFinite(days) && days >= 0 ? {story_days: days} : null;
}

function normalizeRecoveryStageGuidance(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const normalized = {};
  for (const stage of HEALTH_ASSESSMENT_RECOVERY_STAGES) {
    const text = typeof value[stage] === 'string' ? value[stage].trim() : '';
    normalized[stage] = text || null;
  }
  return normalized;
}

function recoveryStageGuidanceErrors(source, normalized) {
  if (Number(source.schema_version) !== HEALTH_ASSESSMENT_SCHEMA_VERSION) return [];
  if (!Object.prototype.hasOwnProperty.call(source, 'recovery_stage_guidance')) {
    return ['recovery_stage_guidance'];
  }
  const raw = source.recovery_stage_guidance;
  if (raw === null) return [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return ['recovery_stage_guidance'];
  }
  const errors = [];
  const allowed = new Set(HEALTH_ASSESSMENT_RECOVERY_STAGES);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) errors.push(`recovery_stage_guidance.${key}`);
  }
  for (const stage of HEALTH_ASSESSMENT_RECOVERY_STAGES) {
    const value = raw[stage];
    if (typeof value !== 'string' || !value.trim() || value.trim().length > HEALTH_ASSESSMENT_GUIDANCE_MAX_LENGTH) {
      errors.push(`recovery_stage_guidance.${stage}`);
    }
  }
  if (normalized.recovery_stage_guidance === null) errors.push('recovery_stage_guidance');
  return errors;
}

export function normalizeHealthAssessment(raw = {}) {
  const source = record(raw);
  const sourceSchemaVersion = [1, 2, HEALTH_ASSESSMENT_SCHEMA_VERSION].includes(Number(source.schema_version))
    ? Number(source.schema_version)
    : HEALTH_ASSESSMENT_SCHEMA_VERSION;
  const legacy = sourceSchemaVersion === 1;
  const earliest = record(source.earliest_recovery);
  const expected = record(source.expected_recovery);
  const persistence = HEALTH_ASSESSMENT_PERSISTENCE.includes(source.persistence)
    ? source.persistence : 'unknown';
  const naturalRecovery = HEALTH_ASSESSMENT_RECOVERY.includes(source.natural_recovery)
    ? source.natural_recovery : 'unknown';
  const assessmentSource = HEALTH_ASSESSMENT_SOURCES.includes(source.assessment_source)
    ? source.assessment_source : 'unknown';
  const normalized = {
    schema_version: sourceSchemaVersion,
    assessment_id: typeof source.assessment_id === 'string' ? source.assessment_id : null,
    request_key: typeof source.request_key === 'string' ? source.request_key : null,
    source_event_id: typeof source.source_event_id === 'string' ? source.source_event_id : null,
    source_floor_version: record(source.source_floor_version),
    source_observation_fingerprint: typeof source.source_observation_fingerprint === 'string'
      ? source.source_observation_fingerprint : null,
    reference_story_time: normalizeStoryTime(source.reference_story_time),
    persistence,
    natural_recovery: naturalRecovery,
    earliest_recovery: {
      duration: normalizeDuration(earliest.duration),
      boundary: earliest.boundary ? normalizeStoryTime(earliest.boundary) : null,
    },
    expected_recovery: {
      duration: normalizeDuration(expected.duration),
      boundary: expected.boundary ? normalizeStoryTime(expected.boundary) : null,
    },
    assessment_source: assessmentSource,
    recovery_stage_guidance: normalizeRecoveryStageGuidance(source.recovery_stage_guidance),
  };
  // Preserve the persisted distinction between a v1 Assessment with no field
  // and v2/v3 Assessments explicitly normalized to unknown.
  if (!legacy || hasOwn(source, 'severity')) {
    normalized.severity = HEALTH_ASSESSMENT_SEVERITY.includes(source.severity)
      ? source.severity : 'unknown';
  }
  return normalized;
}

export function validateHealthAssessment(raw = {}) {
  const source = record(raw);
  const value = normalizeHealthAssessment(raw);
  const errors = [];
  if (source.schema_version !== undefined && ![1, 2, HEALTH_ASSESSMENT_SCHEMA_VERSION].includes(Number(source.schema_version))) errors.push('schema_version');
  if (source.persistence !== undefined && !HEALTH_ASSESSMENT_PERSISTENCE.includes(source.persistence)) errors.push('persistence');
  if (source.natural_recovery !== undefined && !HEALTH_ASSESSMENT_RECOVERY.includes(source.natural_recovery)) errors.push('natural_recovery');
  if (source.assessment_source !== undefined && !HEALTH_ASSESSMENT_SOURCES.includes(source.assessment_source)) errors.push('assessment_source');
  if (!value.assessment_id) errors.push('assessment_id');
  if (!value.request_key) errors.push('request_key');
  if (!value.source_event_id) errors.push('source_event_id');
  if (!value.source_observation_fingerprint) errors.push('source_observation_fingerprint');
  if (!value.source_floor_version.chat_id || value.source_floor_version.message_id === null ||
      value.source_floor_version.floor === null || value.source_floor_version.swipe_id === null ||
      !value.source_floor_version.content_hash || value.source_floor_version.message_version === null) {
    errors.push('source_floor_version');
  }
  errors.push(...recoveryStageGuidanceErrors(source, value));
  if (value.schema_version === HEALTH_ASSESSMENT_SCHEMA_VERSION) {
    const hasExpectedRecovery = Boolean(
      value.expected_recovery.duration || value.expected_recovery.boundary,
    );
    const profileRequired = value.persistence === 'short_term'
      && value.natural_recovery === 'eligible'
      && hasExpectedRecovery;
    if (profileRequired && !value.recovery_stage_guidance) errors.push('recovery_stage_guidance');
    if (!profileRequired && value.recovery_stage_guidance) errors.push('recovery_stage_guidance_not_eligible');
  }
  return {ok: errors.length === 0, value, errors};
}

export function emptyHealthAssessmentTimeline() {
  return {schema_version: HEALTH_ASSESSMENT_SCHEMA_VERSION, assessments: []};
}

export function normalizeHealthAssessmentTimeline(raw) {
  const source = record(raw);
  const timelineVersion = [1, 2, HEALTH_ASSESSMENT_SCHEMA_VERSION].includes(Number(source.schema_version))
    ? Number(source.schema_version)
    : HEALTH_ASSESSMENT_SCHEMA_VERSION;
  const assessments = Array.isArray(source.assessments)
    ? source.assessments
      .map(item => normalizeHealthAssessment(
        record(item).schema_version === undefined
          ? {...record(item), schema_version: timelineVersion}
          : item,
      ))
      .filter(item => validateHealthAssessment(item).ok)
    : [];
  const seen = new Set();
  return {
    schema_version: timelineVersion,
    assessments: assessments.filter(item => {
      if (seen.has(item.request_key)) return false;
      seen.add(item.request_key);
      return true;
    }),
  };
}

export function activeHealthAssessments({timeline, events, floorVersion}) {
  const normalized = normalizeHealthAssessmentTimeline(timeline);
  const eventMap = new Map((Array.isArray(events) ? events : []).map(event => [event?.event_id, event]));
  const versionFields = ['chat_id', 'message_id', 'floor', 'swipe_id', 'content_hash', 'message_version'];
  const sameVersion = (left, right) => versionFields.every(field =>
    String(left?.[field] ?? '') === String(right?.[field] ?? ''));
  return normalized.assessments.filter(assessment => {
    const event = eventMap.get(assessment.source_event_id);
    return event && sameVersion(event.source, assessment.source_floor_version)
      && sameVersion(floorVersion, assessment.source_floor_version)
      && healthObservationFingerprint(event) === assessment.source_observation_fingerprint;
  });
}
