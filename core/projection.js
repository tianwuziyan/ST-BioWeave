import {differenceStoryTime, compareStoryTime} from '../story/time.js';

export const PROJECTION_SCHEMA_VERSION = 1;
export const PROJECTION_TRIGGER_SCHEMA_VERSION = 1;
export const PROJECTION_LIFECYCLE_SCHEMA_VERSION = 1;
export const PROJECTION_EVIDENCE_SCHEMA_VERSION = 1;
export const PROJECTION_DELIVERY_SCHEMA_VERSION = 1;
export const PROJECTION_OBSERVATION_SCHEMA_VERSION = 1;
export const PROJECTION_TRIGGERED_SNAPSHOT_SCHEMA_VERSION = 1;
export const PROJECTION_DEVELOPMENT_KINDS = Object.freeze([
  'possible_biological_change', 'possible_detection', 'mechanism_progression',
  'no_obvious_change', 'monitoring_signal',
]);
export const PROJECTION_TRIGGER_KINDS = Object.freeze([
  'immediate_after_event', 'elapsed_after_event', 'story_time_reached',
]);
export const PROJECTION_FACTUAL_ACTIONS = Object.freeze(['realized', 'contradicted', 'expired']);
export const PROJECTION_LIFECYCLE_ACTIONS = Object.freeze([...PROJECTION_FACTUAL_ACTIONS, 'deleted']);

const FLOOR_VERSION_FIELDS = Object.freeze(['chat_id', 'message_id', 'floor', 'swipe_id', 'content_hash', 'message_version']);
const PROJECTION_FIELDS = new Set(['schema_version', 'projection_id', 'owner_type', 'subject_id', 'projection_rule_id', 'development_concern_key', 'mechanism', 'source_event_ids', 'development', 'timing', 'created_at_floor_version', 'evidence_refs', 'tracking_scope', 'tracking_window_id', 'aggregation_path', 'aggregation_evidence']);
const MECHANISM_FIELDS = new Set(['key', 'world_model_rule_refs']);
const BASIS_FIELDS = new Set(['event_ids', 'state_refs', 'mechanism_rule_refs']);
const DEVELOPMENT_FIELDS = new Set(['kind', 'current_basis', 'next_signal']);
const TIMING_FIELDS = new Set(['trigger_kind', 'reference_event_id', 'reference_story_time', 'current_story_time', 'elapsed_story_days']);
const LIFECYCLE_FIELDS = new Set(['schema_version', 'lifecycle_id', 'projection_id', 'owner_type', 'record_kind', 'action', 'created_at_floor_version', 'evidence_refs']);
const EVIDENCE_FIELDS = new Set(['schema_version', 'evidence_record_id', 'projection_id', 'owner_type', 'source_event_ids', 'created_at_floor_version', 'evidence_refs']);
const DELIVERY_FIELDS = new Set(['schema_version', 'delivery_record_id', 'delivery_id', 'projection_id', 'aggregation_id', 'subject_id', 'pregnancy_id', 'cycle_id', 'submitted_floor_version', 'created_at_floor_version', 'context_fingerprint', 'status', 'response_id', 'response_floor_version', 'generation_id', 'generation_intent_id', 'analysis_execution_id', 'analysis_status', 'explicit_lifecycle_fact_ids']);
const OBSERVATION_FIELDS = new Set(['schema_version', 'observation_id', 'projection_id', 'subject_id', 'action', 'reaction_concept', 'event_ids', 'created_at_floor_version']);
const TRIGGERED_SNAPSHOT_FIELDS = new Set(['schema_version', 'snapshot_id', 'subject_id', 'status', 'stage_code', 'triggered', 'created_at_floor_version']);
const TRIGGERED_SNAPSHOT_ITEM_FIELDS = new Set(['projection_id', 'reaction_concept', 'event_ids']);
const TRIGGER_FIELDS = new Set(['schema_version', 'kind', 'source_event_type', 'reference_event_id', 'min_elapsed_story_days', 'target_story_time', 'development_kind']);
const FORBIDDEN_KEYS = new Set(['prompt', 'raw_prompt', 'raw_response', 'raw_ai_response', 'snapshot', 'current_state', 'probability', 'random', 'random_result', 'seed', 'ui', 'formatted_ui', 'conception_id', 'outcome']);
const UINT64_MASK = (1n << 64n) - 1n;

function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function cloneValue(value) {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  if (Array.isArray(value)) return value.map(cloneValue);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
}
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}
function stableFingerprint(value) { return JSON.stringify(stableValue(value)); }
export function deterministicDigest(value) {
  const bytes = new TextEncoder().encode(stableFingerprint(value));
  let hash = 14695981039346656037n;
  for (const byte of bytes) { hash ^= BigInt(byte); hash = (hash * 1099511628211n) & UINT64_MASK; }
  return hash.toString(16).padStart(16, '0');
}
function nonEmptyText(value) { return typeof value === 'string' && value.trim().length > 0; }
function uniqueTextArray(value, required = false) { return Array.isArray(value) && (!required || value.length > 0) && value.every(nonEmptyText) && new Set(value).size === value.length; }
function completeFloorVersion(value) {
  return isRecord(value) && FLOOR_VERSION_FIELDS.every(field => Object.hasOwn(value, field)) && nonEmptyText(String(value.chat_id)) && nonEmptyText(String(value.message_id)) && Number.isFinite(Number(value.floor)) && Number.isFinite(Number(value.swipe_id)) && nonEmptyText(value.content_hash) && nonEmptyText(String(value.message_version));
}
function collectUnexpected(errors, value, allowed, path) {
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) errors.push(`${path}.${key}:forbidden_field`);
    else if (!allowed.has(key)) errors.push(`${path}.${key}:unexpected_field`);
  }
}
function validateFloorVersion(value, path, errors) {
  if (!completeFloorVersion(value)) { errors.push(`${path}:incomplete_floor_version`); return; }
  for (const key of Object.keys(value)) if (!FLOOR_VERSION_FIELDS.includes(key)) errors.push(`${path}.${key}:unexpected_field`);
}
function validateStoryTime(value, path, errors) {
  if (value === null || value === undefined) return;
  if (!isRecord(value)) { errors.push(`${path}:invalid_story_time`); return; }
  if (value.day_index !== undefined && value.day_index !== null && !Number.isFinite(Number(value.day_index))) errors.push(`${path}.day_index:invalid`);
  if (value.calendar_id !== undefined && value.calendar_id !== null && !nonEmptyText(value.calendar_id)) errors.push(`${path}.calendar_id:invalid`);
}
function validateEvidenceRefs(value, path, errors, required = false) { if (!uniqueTextArray(value, required)) errors.push(`${path}:invalid_refs`); }
function validateAggregationEvidence(value, path, errors) {
  if (value === null || value === undefined) return;
  if (!isRecord(value)) { errors.push(`${path}:invalid`); return; }
  const allowed = new Set(['subject_id', 'aggregation_id', 'pregnancy_id', 'cycle_id', 'accepted_exposure_event_ids', 'participant_exposure_mapping']);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${path}.${key}:unexpected_field`);
  if (!nonEmptyText(value.subject_id) || !nonEmptyText(value.aggregation_id) || !nonEmptyText(value.cycle_id)) errors.push(`${path}:identity_required`);
  if (value.pregnancy_id !== null && value.pregnancy_id !== undefined && !nonEmptyText(value.pregnancy_id)) errors.push(`${path}.pregnancy_id:invalid`);
  if (!uniqueTextArray(value.accepted_exposure_event_ids, true)) errors.push(`${path}.accepted_exposure_event_ids:invalid`);
  if (!Array.isArray(value.participant_exposure_mapping)) errors.push(`${path}.participant_exposure_mapping:invalid`);
  else for (const item of value.participant_exposure_mapping) {
    if (!isRecord(item) || !nonEmptyText(item.participant_id) || !uniqueTextArray(item.exposure_event_ids, true)) errors.push(`${path}.participant_exposure_mapping:item_invalid`);
  }
}
function validateBasis(value, path, errors) {
  if (!isRecord(value)) { errors.push(`${path}:invalid`); return; }
  collectUnexpected(errors, value, BASIS_FIELDS, path);
  for (const field of BASIS_FIELDS) if (value[field] !== undefined && !uniqueTextArray(value[field])) errors.push(`${path}.${field}:invalid_refs`);
  if (![...BASIS_FIELDS].some(field => (value[field]?.length ?? 0) > 0)) errors.push(`${path}:empty`);
}
function validateMechanism(value, path, errors) {
  if (!isRecord(value)) { errors.push(`${path}:invalid`); return; }
  collectUnexpected(errors, value, MECHANISM_FIELDS, path);
  if (!nonEmptyText(value.key)) errors.push(`${path}.key:required`);
  if (!uniqueTextArray(value.world_model_rule_refs)) errors.push(`${path}.world_model_rule_refs:invalid_refs`);
}
function validateDevelopment(value, path, errors) {
  if (!isRecord(value)) { errors.push(`${path}:invalid`); return; }
  collectUnexpected(errors, value, DEVELOPMENT_FIELDS, path);
  if (!PROJECTION_DEVELOPMENT_KINDS.includes(value.kind)) errors.push(`${path}.kind:invalid`);
  validateBasis(value.current_basis, `${path}.current_basis`, errors);
  if (!nonEmptyText(value.next_signal)) errors.push(`${path}.next_signal:required`);
}
function validateTiming(value, path, errors) {
  if (!isRecord(value)) { errors.push(`${path}:invalid`); return; }
  collectUnexpected(errors, value, TIMING_FIELDS, path);
  if (!PROJECTION_TRIGGER_KINDS.includes(value.trigger_kind)) errors.push(`${path}.trigger_kind:invalid`);
  if (value.reference_event_id !== null && value.reference_event_id !== undefined && !nonEmptyText(value.reference_event_id)) errors.push(`${path}.reference_event_id:invalid`);
  validateStoryTime(value.reference_story_time, `${path}.reference_story_time`, errors);
  validateStoryTime(value.current_story_time, `${path}.current_story_time`, errors);
  if (value.elapsed_story_days !== null && value.elapsed_story_days !== undefined && (!Number.isFinite(Number(value.elapsed_story_days)) || Number(value.elapsed_story_days) < 0)) errors.push(`${path}.elapsed_story_days:invalid`);
  if (['immediate_after_event', 'elapsed_after_event'].includes(value.trigger_kind) && !nonEmptyText(value.reference_event_id)) errors.push(`${path}.reference_event_id:required`);
}
function projectionIdentityMaterial(value) { return {schema_version: PROJECTION_SCHEMA_VERSION, chat_id: value.created_at_floor_version.chat_id, subject_id: value.subject_id, projection_rule_id: value.projection_rule_id, development_concern_key: value.development_concern_key}; }
export function buildProjectionId(value) { return `projection_${deterministicDigest(projectionIdentityMaterial(value))}`; }
function lifecycleIdentityMaterial(value) { return {schema_version: PROJECTION_LIFECYCLE_SCHEMA_VERSION, projection_id: value.projection_id, record_kind: value.record_kind, action: value.action, created_at_floor_version: value.created_at_floor_version, evidence_refs: [...value.evidence_refs].sort()}; }
export function buildLifecycleId(value) { return `projection_lifecycle_${deterministicDigest(lifecycleIdentityMaterial(value))}`; }
function evidenceIdentityMaterial(value) { return {schema_version: PROJECTION_EVIDENCE_SCHEMA_VERSION, projection_id: value.projection_id, source_event_ids: [...value.source_event_ids].sort(), created_at_floor_version: value.created_at_floor_version, evidence_refs: [...value.evidence_refs].sort()}; }
export function buildProjectionEvidenceRecordId(value) { return `projection_evidence_${deterministicDigest(evidenceIdentityMaterial(value))}`; }
function deliveryIdentityMaterial(value) { return {schema_version: PROJECTION_DELIVERY_SCHEMA_VERSION, projection_id: value.projection_id, aggregation_id: value.aggregation_id, subject_id: value.subject_id, pregnancy_id: value.pregnancy_id ?? null, cycle_id: value.cycle_id}; }
function deliveryRecordIdentityMaterial(value) { return {schema_version: PROJECTION_DELIVERY_SCHEMA_VERSION, delivery_id: value.delivery_id, response_id: value.response_id ?? null, submitted_floor_version: value.submitted_floor_version, response_floor_version: value.response_floor_version ?? null, context_fingerprint: value.context_fingerprint ?? null, analysis_execution_id: value.analysis_execution_id ?? null}; }
function observationIdentityMaterial(value) { return {schema_version: PROJECTION_OBSERVATION_SCHEMA_VERSION, projection_id: value.projection_id, subject_id: value.subject_id, action: value.action, reaction_concept: value.reaction_concept, event_ids: [...value.event_ids].sort(), created_at_floor_version: value.created_at_floor_version}; }
export function buildProjectionDeliveryId(value) { return `projection_delivery_${deterministicDigest(deliveryIdentityMaterial(value))}`; }
export function buildProjectionDeliveryRecordId(value) { return `projection_delivery_record_${deterministicDigest(deliveryRecordIdentityMaterial(value))}`; }
export function buildProjectionObservationId(value) { return `projection_observation_${deterministicDigest(observationIdentityMaterial(value))}`; }
function triggeredSnapshotIdentityMaterial(value) { return {schema_version: PROJECTION_TRIGGERED_SNAPSHOT_SCHEMA_VERSION, subject_id: value.subject_id, status: value.status, stage_code: value.stage_code ?? null, triggered: value.triggered, created_at_floor_version: value.created_at_floor_version}; }
export function buildProjectionTriggeredSnapshotId(value) { return `projection_triggered_snapshot_${deterministicDigest(triggeredSnapshotIdentityMaterial(value))}`; }

export function normalizeProjection(value = {}) {
  const source = cloneValue(value);
  const timing = {
    trigger_kind: source.timing?.trigger_kind ?? null,
    reference_event_id: source.timing?.reference_event_id ?? null,
    reference_story_time: cloneValue(source.timing?.reference_story_time ?? null),
    current_story_time: cloneValue(source.timing?.current_story_time ?? null),
    ...(source.tracking_scope === 'pre_confirmation' && !Object.hasOwn(source.timing ?? {}, 'elapsed_story_days')
      ? {}
      : {elapsed_story_days: source.timing?.elapsed_story_days ?? null}),
  };
  return {
    schema_version: PROJECTION_SCHEMA_VERSION, projection_id: source.projection_id ?? null, owner_type: source.owner_type ?? 'character', subject_id: source.subject_id ?? null, projection_rule_id: source.projection_rule_id ?? null, development_concern_key: source.development_concern_key ?? null,
    mechanism: {key: source.mechanism?.key ?? null, world_model_rule_refs: [...(source.mechanism?.world_model_rule_refs ?? [])].sort()}, source_event_ids: [...(source.source_event_ids ?? [])].sort(),
    development: {kind: source.development?.kind ?? null, current_basis: {event_ids: [...(source.development?.current_basis?.event_ids ?? [])].sort(), state_refs: [...(source.development?.current_basis?.state_refs ?? [])].sort(), mechanism_rule_refs: [...(source.development?.current_basis?.mechanism_rule_refs ?? [])].sort()}, next_signal: source.development?.next_signal ?? null},
    timing,
    created_at_floor_version: cloneValue(source.created_at_floor_version ?? null), evidence_refs: [...(source.evidence_refs ?? [])].sort(), aggregation_path: source.aggregation_path ?? null, aggregation_evidence: cloneValue(source.aggregation_evidence ?? null),
    tracking_scope: source.tracking_scope ?? null, tracking_window_id: source.tracking_window_id ?? null,
  };
}
export function createProjection(value = {}) { const normalized = normalizeProjection(value); normalized.projection_id = buildProjectionId(normalized); const result = validateProjection(normalized); if (!result.ok) throw new TypeError(result.errors.join(', ')); return cloneValue(normalized); }
export function validateProjection(value, {expectedChatId = null} = {}) {
  const errors = [];
  if (!isRecord(value)) return {ok: false, errors: ['projection:invalid']};
  collectUnexpected(errors, value, PROJECTION_FIELDS, 'projection');
  if (value.schema_version !== PROJECTION_SCHEMA_VERSION) errors.push('projection.schema_version:invalid');
  if (!nonEmptyText(value.projection_id)) errors.push('projection.projection_id:required');
  if (value.owner_type !== 'character') errors.push('projection.owner_type:not_character');
  if (!nonEmptyText(value.subject_id)) errors.push('projection.subject_id:required');
  if (!nonEmptyText(value.projection_rule_id)) errors.push('projection.projection_rule_id:required');
  if (!nonEmptyText(value.development_concern_key)) errors.push('projection.development_concern_key:required');
  if (value.tracking_scope !== null && value.tracking_scope !== undefined && !['pre_confirmation', 'pregnancy_stage'].includes(value.tracking_scope)) errors.push('projection.tracking_scope:invalid');
  if (value.tracking_window_id !== null && value.tracking_window_id !== undefined && !nonEmptyText(value.tracking_window_id)) errors.push('projection.tracking_window_id:invalid');
  if (value.tracking_scope === 'pre_confirmation' && !nonEmptyText(value.tracking_window_id)) errors.push('projection.tracking_window_id:required');
  if (value.aggregation_path !== null && value.aggregation_path !== undefined && value.aggregation_path !== 'participant_aggregation') errors.push('projection.aggregation_path:invalid');
  validateMechanism(value.mechanism, 'projection.mechanism', errors); if (!uniqueTextArray(value.source_event_ids, true)) errors.push('projection.source_event_ids:invalid'); validateDevelopment(value.development, 'projection.development', errors); validateTiming(value.timing, 'projection.timing', errors); validateFloorVersion(value.created_at_floor_version, 'projection.created_at_floor_version', errors); validateEvidenceRefs(value.evidence_refs, 'projection.evidence_refs', errors, true); validateAggregationEvidence(value.aggregation_evidence, 'projection.aggregation_evidence', errors); if (value.aggregation_path === 'participant_aggregation' && (value.aggregation_evidence === null || value.aggregation_evidence === undefined)) errors.push('projection.aggregation_evidence:required_for_aggregation_path'); if (value.aggregation_path === 'participant_aggregation' && value.aggregation_evidence?.subject_id !== value.subject_id) errors.push('projection.aggregation_evidence:subject_mismatch');
  if (expectedChatId !== null && value.created_at_floor_version?.chat_id !== expectedChatId) errors.push('projection.created_at_floor_version:wrong_chat');
  if (completeFloorVersion(value.created_at_floor_version) && nonEmptyText(value.projection_id) && value.projection_id !== buildProjectionId(value)) errors.push('projection.projection_id:not_deterministic');
  return {ok: errors.length === 0, errors};
}
function lifecycleBase(value) { return {schema_version: PROJECTION_LIFECYCLE_SCHEMA_VERSION, lifecycle_id: value.lifecycle_id ?? null, projection_id: value.projection_id ?? null, owner_type: value.owner_type ?? 'character', record_kind: value.record_kind ?? (value.action === 'deleted' ? 'deletion' : 'factual'), action: value.action ?? null, created_at_floor_version: cloneValue(value.created_at_floor_version ?? null), evidence_refs: [...(value.evidence_refs ?? [])].sort()}; }
export function createProjectionLifecycleRecord(value = {}) { const normalized = lifecycleBase(value); normalized.lifecycle_id = buildLifecycleId(normalized); const result = validateProjectionLifecycleRecord(normalized); if (!result.ok) throw new TypeError(result.errors.join(', ')); return cloneValue(normalized); }
export function validateProjectionLifecycleRecord(value, {knownProjectionIds = null, expectedChatId = null} = {}) {
  const errors = []; if (!isRecord(value)) return {ok: false, errors: ['lifecycle:invalid']}; collectUnexpected(errors, value, LIFECYCLE_FIELDS, 'lifecycle'); if (value.schema_version !== PROJECTION_LIFECYCLE_SCHEMA_VERSION) errors.push('lifecycle.schema_version:invalid'); if (!nonEmptyText(value.lifecycle_id)) errors.push('lifecycle.lifecycle_id:required'); if (!nonEmptyText(value.projection_id)) errors.push('lifecycle.projection_id:required'); if (knownProjectionIds && !knownProjectionIds.has(value.projection_id)) errors.push('lifecycle.projection_id:unknown'); if (value.owner_type !== 'character') errors.push('lifecycle.owner_type:not_character'); if (!['factual', 'deletion'].includes(value.record_kind)) errors.push('lifecycle.record_kind:invalid'); if (!PROJECTION_LIFECYCLE_ACTIONS.includes(value.action)) errors.push('lifecycle.action:invalid'); if (value.record_kind === 'factual' && !PROJECTION_FACTUAL_ACTIONS.includes(value.action)) errors.push('lifecycle.action:not_factual'); if (value.record_kind === 'deletion' && value.action !== 'deleted') errors.push('lifecycle.action:not_deletion'); validateFloorVersion(value.created_at_floor_version, 'lifecycle.created_at_floor_version', errors); validateEvidenceRefs(value.evidence_refs, 'lifecycle.evidence_refs', errors); if (expectedChatId !== null && value.created_at_floor_version?.chat_id !== expectedChatId) errors.push('lifecycle.created_at_floor_version:wrong_chat'); if (completeFloorVersion(value.created_at_floor_version) && nonEmptyText(value.lifecycle_id) && value.lifecycle_id !== buildLifecycleId(value)) errors.push('lifecycle.lifecycle_id:not_deterministic'); return {ok: errors.length === 0, errors};
}
function evidenceBase(value) { return {schema_version: PROJECTION_EVIDENCE_SCHEMA_VERSION, evidence_record_id: value.evidence_record_id ?? null, projection_id: value.projection_id ?? null, owner_type: value.owner_type ?? 'character', source_event_ids: [...(value.source_event_ids ?? [])].sort(), created_at_floor_version: cloneValue(value.created_at_floor_version ?? null), evidence_refs: [...(value.evidence_refs ?? [])].sort()}; }
export function createProjectionEvidenceRecord(value = {}) { const normalized = evidenceBase(value); normalized.evidence_record_id = buildProjectionEvidenceRecordId(normalized); const result = validateProjectionEvidenceRecord(normalized); if (!result.ok) throw new TypeError(result.errors.join(', ')); return cloneValue(normalized); }
export function validateProjectionEvidenceRecord(value, {knownProjectionIds = null, expectedChatId = null} = {}) { const errors = []; if (!isRecord(value)) return {ok: false, errors: ['evidence:invalid']}; collectUnexpected(errors, value, EVIDENCE_FIELDS, 'evidence'); if (value.schema_version !== PROJECTION_EVIDENCE_SCHEMA_VERSION) errors.push('evidence.schema_version:invalid'); if (!nonEmptyText(value.evidence_record_id)) errors.push('evidence.evidence_record_id:required'); if (!nonEmptyText(value.projection_id)) errors.push('evidence.projection_id:required'); if (knownProjectionIds && !knownProjectionIds.has(value.projection_id)) errors.push('evidence.projection_id:unknown'); if (value.owner_type !== 'character') errors.push('evidence.owner_type:not_character'); if (!uniqueTextArray(value.source_event_ids, true)) errors.push('evidence.source_event_ids:invalid'); validateFloorVersion(value.created_at_floor_version, 'evidence.created_at_floor_version', errors); validateEvidenceRefs(value.evidence_refs, 'evidence.evidence_refs', errors); if (expectedChatId !== null && value.created_at_floor_version?.chat_id !== expectedChatId) errors.push('evidence.created_at_floor_version:wrong_chat'); if (completeFloorVersion(value.created_at_floor_version) && nonEmptyText(value.evidence_record_id) && value.evidence_record_id !== buildProjectionEvidenceRecordId(value)) errors.push('evidence.evidence_record_id:not_deterministic'); return {ok: errors.length === 0, errors}; }
function deliveryBase(value) { return {schema_version: PROJECTION_DELIVERY_SCHEMA_VERSION, delivery_record_id: value.delivery_record_id ?? null, delivery_id: value.delivery_id ?? null, projection_id: value.projection_id ?? null, aggregation_id: value.aggregation_id ?? null, subject_id: value.subject_id ?? null, pregnancy_id: value.pregnancy_id ?? null, cycle_id: value.cycle_id ?? null, submitted_floor_version: cloneValue(value.submitted_floor_version ?? null), created_at_floor_version: cloneValue(value.created_at_floor_version ?? value.submitted_floor_version ?? null), context_fingerprint: value.context_fingerprint ?? null, status: value.status ?? 'submitted', response_id: value.response_id ?? null, response_floor_version: cloneValue(value.response_floor_version ?? null), generation_id: value.generation_id ?? null, generation_intent_id: value.generation_intent_id ?? null, analysis_execution_id: value.analysis_execution_id ?? null, analysis_status: value.analysis_status ?? null, explicit_lifecycle_fact_ids: [...(value.explicit_lifecycle_fact_ids ?? [])].sort()}; }
export function createProjectionDeliveryRecord(value = {}) { const normalized = deliveryBase(value); normalized.delivery_id = buildProjectionDeliveryId(normalized); normalized.delivery_record_id = buildProjectionDeliveryRecordId(normalized); const result = validateProjectionDeliveryRecord(normalized); if (!result.ok) throw new TypeError(result.errors.join(', ')); return cloneValue(normalized); }
export function validateProjectionDeliveryRecord(value, {knownProjectionIds = null, expectedChatId = null} = {}) {
  const errors = [];
  if (!isRecord(value)) return {ok: false, errors: ['delivery:invalid']};
  collectUnexpected(errors, value, DELIVERY_FIELDS, 'delivery');
  if (value.schema_version !== PROJECTION_DELIVERY_SCHEMA_VERSION) errors.push('delivery.schema_version:invalid');
  if (!nonEmptyText(value.delivery_record_id) || !nonEmptyText(value.delivery_id)) errors.push('delivery.identity_required');
  if (!nonEmptyText(value.projection_id)) errors.push('delivery.projection_id:required');
  if (knownProjectionIds && !knownProjectionIds.has(value.projection_id)) errors.push('delivery.projection_id:unknown');
  if (!nonEmptyText(value.aggregation_id) || !nonEmptyText(value.subject_id) || !nonEmptyText(value.cycle_id)) errors.push('delivery.binding_required');
  if (value.pregnancy_id !== null && value.pregnancy_id !== undefined && !nonEmptyText(value.pregnancy_id)) errors.push('delivery.pregnancy_id:invalid');
  validateFloorVersion(value.submitted_floor_version, 'delivery.submitted_floor_version', errors);
  validateFloorVersion(value.created_at_floor_version, 'delivery.created_at_floor_version', errors);
  if (!nonEmptyText(value.context_fingerprint)) errors.push('delivery.context_fingerprint:required');
  if (!['submitted', 'readback_verified', 'response_observed'].includes(value.status)) errors.push('delivery.status:invalid');
  if (value.response_id !== null && value.response_id !== undefined) {
    if (!nonEmptyText(value.response_id) || !['success', 'failed', 'skipped', 'stale'].includes(value.analysis_status)) errors.push('delivery.response:invalid');
    validateFloorVersion(value.response_floor_version, 'delivery.response_floor_version', errors);
    if (!nonEmptyText(value.analysis_execution_id)) errors.push('delivery.analysis_execution_id:required');
    if (!Array.isArray(value.explicit_lifecycle_fact_ids) || !value.explicit_lifecycle_fact_ids.every(nonEmptyText)) errors.push('delivery.explicit_lifecycle_fact_ids:invalid');
  } else if (value.status !== 'submitted' && value.status !== 'readback_verified') errors.push('delivery.response_id:required');
  if (expectedChatId !== null && value.submitted_floor_version?.chat_id !== expectedChatId) errors.push('delivery.submitted_floor_version:wrong_chat');
  if (expectedChatId !== null && value.created_at_floor_version?.chat_id !== expectedChatId) errors.push('delivery.created_at_floor_version:wrong_chat');
  if (value.delivery_id !== buildProjectionDeliveryId(value)) errors.push('delivery.delivery_id:not_deterministic');
  if (value.delivery_record_id !== buildProjectionDeliveryRecordId(value)) errors.push('delivery.delivery_record_id:not_deterministic');
  return {ok: errors.length === 0, errors};
}
function observationBase(value) { return {schema_version: PROJECTION_OBSERVATION_SCHEMA_VERSION, observation_id: value.observation_id ?? null, projection_id: value.projection_id ?? null, subject_id: value.subject_id ?? null, action: value.action ?? null, reaction_concept: value.reaction_concept ?? null, event_ids: [...(value.event_ids ?? [])].sort(), created_at_floor_version: cloneValue(value.created_at_floor_version ?? null)}; }
export function createProjectionObservationRecord(value = {}) { const normalized = observationBase(value); normalized.observation_id = buildProjectionObservationId(normalized); const result = validateProjectionObservationRecord(normalized); if (!result.ok) throw new TypeError(result.errors.join(', ')); return cloneValue(normalized); }
export function validateProjectionObservationRecord(value, {knownProjectionIds = null, expectedChatId = null} = {}) { const errors = []; if (!isRecord(value)) return {ok: false, errors: ['observation:invalid']}; collectUnexpected(errors, value, OBSERVATION_FIELDS, 'observation'); if (value.schema_version !== PROJECTION_OBSERVATION_SCHEMA_VERSION) errors.push('observation.schema_version:invalid'); if (!nonEmptyText(value.observation_id)) errors.push('observation.observation_id:required'); if (!nonEmptyText(value.projection_id)) errors.push('observation.projection_id:required'); if (knownProjectionIds && !knownProjectionIds.has(value.projection_id)) errors.push('observation.projection_id:unknown'); if (!nonEmptyText(value.subject_id)) errors.push('observation.subject_id:required'); if (!['triggered', 'revoked'].includes(value.action)) errors.push('observation.action:invalid'); if (!nonEmptyText(value.reaction_concept)) errors.push('observation.reaction_concept:required'); if (!uniqueTextArray(value.event_ids, true)) errors.push('observation.event_ids:invalid'); validateFloorVersion(value.created_at_floor_version, 'observation.created_at_floor_version', errors); if (expectedChatId !== null && value.created_at_floor_version?.chat_id !== expectedChatId) errors.push('observation.created_at_floor_version:wrong_chat'); if (value.observation_id !== buildProjectionObservationId(value)) errors.push('observation.observation_id:not_deterministic'); return {ok: errors.length === 0, errors}; }
function dedupeById(values, validate, idKey, conflictCode, options = {}) { const records = [], conflicts = [], rejected = [], byId = new Map(); for (const value of Array.isArray(values) ? values : []) { const id = value?.[idKey]; const duplicate = byId.get(id); if (duplicate) { if (stableFingerprint(duplicate) !== stableFingerprint(value)) conflicts.push({code: conflictCode, [idKey]: id, values: [cloneValue(duplicate), cloneValue(value)]}); continue; } const validation = validate(value, options); if (!validation.ok) { rejected.push({value: cloneValue(value), errors: validation.errors}); continue; } byId.set(id, value); records.push(cloneValue(value)); } return {records, conflicts, rejected}; }
export function dedupeProjections(values = []) { const result = dedupeById(values, validateProjection, 'projection_id', 'projection_id_conflict'); return {...result, projections: result.records}; }
export function dedupeProjectionLifecycleRecords(values = [], options = {}) { const result = dedupeById(values, value => validateProjectionLifecycleRecord(value, options), 'lifecycle_id', 'lifecycle_id_conflict'); return {...result, records: result.records}; }
export function dedupeProjectionEvidenceRecords(values = [], options = {}) { const result = dedupeById(values, value => validateProjectionEvidenceRecord(value, options), 'evidence_record_id', 'evidence_record_id_conflict'); return {...result, records: result.records}; }
export function dedupeProjectionDeliveryRecords(values = [], options = {}) { const result = dedupeById(values, value => validateProjectionDeliveryRecord(value, options), 'delivery_record_id', 'delivery_record_conflict'); return {...result, records: result.records}; }
export function dedupeProjectionObservationRecords(values = [], options = {}) { const result = dedupeById(values, value => validateProjectionObservationRecord(value, options), 'observation_id', 'observation_id_conflict'); return {...result, records: result.records}; }
function triggeredSnapshotBase(value) { return {schema_version: PROJECTION_TRIGGERED_SNAPSHOT_SCHEMA_VERSION, snapshot_id: value.snapshot_id ?? null, subject_id: value.subject_id ?? null, status: value.status ?? 'active', ...(value.stage_code !== undefined ? {stage_code: value.stage_code} : {}), triggered: (value.triggered ?? []).map(item => ({projection_id: item?.projection_id ?? null, reaction_concept: item?.reaction_concept ?? null, event_ids: [...(item?.event_ids ?? [])].sort()})).sort((left, right) => `${left.reaction_concept}\u001f${left.projection_id}`.localeCompare(`${right.reaction_concept}\u001f${right.projection_id}`)), created_at_floor_version: cloneValue(value.created_at_floor_version ?? null)}; }
export function createProjectionTriggeredSnapshot(value = {}) { const normalized = triggeredSnapshotBase(value); normalized.snapshot_id = buildProjectionTriggeredSnapshotId(normalized); const result = validateProjectionTriggeredSnapshot(normalized); if (!result.ok) throw new TypeError(result.errors.join(', ')); return cloneValue(normalized); }
export function validateProjectionTriggeredSnapshot(value, {knownProjectionIds = null, expectedChatId = null} = {}) {
  const errors = [];
  if (!isRecord(value)) return {ok: false, errors: ['triggered_snapshot:invalid']};
  collectUnexpected(errors, value, TRIGGERED_SNAPSHOT_FIELDS, 'triggered_snapshot');
  if (value.schema_version !== PROJECTION_TRIGGERED_SNAPSHOT_SCHEMA_VERSION) errors.push('triggered_snapshot.schema_version:invalid');
  if (!nonEmptyText(value.snapshot_id)) errors.push('triggered_snapshot.snapshot_id:required');
  if (!nonEmptyText(value.subject_id)) errors.push('triggered_snapshot.subject_id:required');
  if (!['active', 'terminated'].includes(value.status)) errors.push('triggered_snapshot.status:invalid');
  if (value.stage_code !== undefined && value.stage_code !== null && !/^\d+-\d+$/.test(String(value.stage_code))) errors.push('triggered_snapshot.stage_code:invalid');
  if (!Array.isArray(value.triggered)) errors.push('triggered_snapshot.triggered:invalid');
  const seen = new Set();
  for (const item of value.triggered ?? []) {
    if (!isRecord(item)) { errors.push('triggered_snapshot.triggered_item:invalid'); continue; }
    collectUnexpected(errors, item, TRIGGERED_SNAPSHOT_ITEM_FIELDS, 'triggered_snapshot.triggered_item');
    if (!nonEmptyText(item.projection_id) || (knownProjectionIds && !knownProjectionIds.has(item.projection_id))) errors.push('triggered_snapshot.projection_id:unknown');
    if (!nonEmptyText(item.reaction_concept)) errors.push('triggered_snapshot.reaction_concept:required');
    if (!uniqueTextArray(item.event_ids, false)) errors.push('triggered_snapshot.event_ids:invalid');
    const key = `${item.projection_id}\u001f${item.reaction_concept}`;
    if (seen.has(key)) errors.push('triggered_snapshot.triggered:duplicate');
    seen.add(key);
  }
  if (value.status === 'terminated' && (value.triggered ?? []).length) errors.push('triggered_snapshot.terminated_not_empty');
  validateFloorVersion(value.created_at_floor_version, 'triggered_snapshot.created_at_floor_version', errors);
  if (expectedChatId !== null && value.created_at_floor_version?.chat_id !== expectedChatId) errors.push('triggered_snapshot.created_at_floor_version:wrong_chat');
  if (value.snapshot_id !== buildProjectionTriggeredSnapshotId(value)) errors.push('triggered_snapshot.snapshot_id:not_deterministic');
  return {ok: errors.length === 0, errors};
}
export function dedupeProjectionTriggeredSnapshots(values = [], options = {}) { const result = dedupeById(values, value => validateProjectionTriggeredSnapshot(value, options), 'snapshot_id', 'triggered_snapshot_id_conflict'); return {...result, records: result.records}; }

function validateTimelineEntry(entry) { const errors = []; if (!isRecord(entry) || entry.owner_type !== 'character') errors.push('timeline_entry:not_character'); validateFloorVersion(entry?.floor_version, 'timeline_entry.floor_version', errors); if (!Array.isArray(entry?.projections) || !Array.isArray(entry?.lifecycle_records) || !Array.isArray(entry?.evidence_records) || !Array.isArray(entry?.delivery_records ?? [])) errors.push('timeline_entry:collections_required'); return errors; }
function compareObservationFloorVersions(left, right) {
  return Number(left?.created_at_floor_version?.floor) - Number(right?.created_at_floor_version?.floor)
    || String(left?.created_at_floor_version?.message_id ?? '').localeCompare(String(right?.created_at_floor_version?.message_id ?? ''))
    || Number(left?.created_at_floor_version?.swipe_id) - Number(right?.created_at_floor_version?.swipe_id)
    || String(left?.created_at_floor_version?.message_version ?? '').localeCompare(String(right?.created_at_floor_version?.message_version ?? ''))
    || String(left?.observation_id ?? '').localeCompare(String(right?.observation_id ?? ''));
}
export function resolveProjectionObservationRecords(records = []) {
  const latest = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const key = `${record?.projection_id}\u001f${record?.subject_id}\u001f${record?.reaction_concept}`;
    const previous = latest.get(key);
    if (!previous || compareObservationFloorVersions(previous, record) <= 0) latest.set(key, record);
  }
  return [...latest.values()].sort(compareObservationFloorVersions);
}
function statusLists(views) { const result = {all: views, active: [], realized: [], contradicted: [], expired: [], deleted: [], conflicts: [], rejected: []}; for (const view of views) { if (view.context_visible) result.active.push(view); if (view.factual_status && result[view.factual_status]) result[view.factual_status].push(view); if (view.deleted) result.deleted.push(view); } return result; }
export function resolveProjectionView({timeline = []} = {}) {
  const entries = Array.isArray(timeline) ? timeline : []; const errors = entries.flatMap(validateTimelineEntry); const projectionResult = dedupeProjections(entries.flatMap(entry => entry?.projections ?? [])); const knownProjectionIds = new Set(projectionResult.projections.map(item => item.projection_id)); const lifecycleResult = dedupeProjectionLifecycleRecords(entries.flatMap(entry => entry?.lifecycle_records ?? []), {knownProjectionIds}); const evidenceResult = dedupeProjectionEvidenceRecords(entries.flatMap(entry => entry?.evidence_records ?? []), {knownProjectionIds}); const observationResult = dedupeProjectionObservationRecords(entries.flatMap(entry => entry?.observation_records ?? []), {knownProjectionIds}); const conflicts = [...errors.map(code => ({code})), ...projectionResult.conflicts, ...lifecycleResult.conflicts, ...evidenceResult.conflicts, ...observationResult.conflicts]; const rejected = [...projectionResult.rejected, ...lifecycleResult.rejected, ...evidenceResult.rejected, ...observationResult.rejected]; const conflictedIds = new Set(projectionResult.conflicts.map(item => item.projection_id)); const recordsById = new Map(); const evidenceById = new Map(); const observationsById = new Map(); for (const record of lifecycleResult.records) { if (!recordsById.has(record.projection_id)) recordsById.set(record.projection_id, []); recordsById.get(record.projection_id).push(record); } for (const record of evidenceResult.records) { if (!evidenceById.has(record.projection_id)) evidenceById.set(record.projection_id, []); evidenceById.get(record.projection_id).push(record); } for (const record of observationResult.records) { if (!observationsById.has(record.projection_id)) observationsById.set(record.projection_id, []); observationsById.get(record.projection_id).push(record); }
  const views = projectionResult.projections.filter(item => !conflictedIds.has(item.projection_id)).map(projection => { const records = recordsById.get(projection.projection_id) ?? []; const factual = records.filter(record => record.record_kind === 'factual'); const positions = new Map(); for (const record of factual) { const position = stableFingerprint(record.created_at_floor_version); if (!positions.has(position)) positions.set(position, new Set()); positions.get(position).add(record.action); } const localConflicts = [...positions.entries()].filter(([, actions]) => actions.size > 1).map(([position, actions]) => ({code: 'factual_lifecycle_conflict', projection_id: projection.projection_id, position, actions: [...actions].sort()})); conflicts.push(...localConflicts); const factualStatus = localConflicts.length ? null : (factual[factual.length - 1]?.action ?? 'active'); const deleted = records.some(record => record.record_kind === 'deletion' && record.action === 'deleted'); const sourceEventIds = new Set(projection.source_event_ids); for (const record of evidenceById.get(projection.projection_id) ?? []) for (const eventId of record.source_event_ids) sourceEventIds.add(eventId); return {...cloneValue(projection), source_event_ids: [...sourceEventIds].sort(), factual_status: factualStatus, deleted, context_visible: !deleted && factualStatus === 'active', lifecycle_records: cloneValue(records), evidence_records: cloneValue(evidenceById.get(projection.projection_id) ?? []), observation_records: cloneValue(observationsById.get(projection.projection_id) ?? []), lifecycle_conflicts: localConflicts}; }); const result = statusLists(views); result.observation_records = cloneValue(observationResult.records); result.observation_conflicts = cloneValue(observationResult.conflicts); result.conflicts = conflicts; result.rejected = rejected; return result;
}

export function validateProjectionTrigger(value) { const errors = []; if (!isRecord(value)) return {ok: false, errors: ['trigger:invalid']}; collectUnexpected(errors, value, TRIGGER_FIELDS, 'trigger'); if (value.schema_version !== PROJECTION_TRIGGER_SCHEMA_VERSION) errors.push('trigger.schema_version:invalid'); if (!PROJECTION_TRIGGER_KINDS.includes(value.kind)) errors.push('trigger.kind:invalid'); if (!PROJECTION_DEVELOPMENT_KINDS.includes(value.development_kind)) errors.push('trigger.development_kind:invalid'); if (value.source_event_type !== null && value.source_event_type !== undefined && !nonEmptyText(value.source_event_type)) errors.push('trigger.source_event_type:invalid'); if (value.reference_event_id !== null && value.reference_event_id !== undefined && !nonEmptyText(value.reference_event_id)) errors.push('trigger.reference_event_id:invalid'); if (value.kind === 'immediate_after_event' && !nonEmptyText(value.reference_event_id)) errors.push('trigger.reference_event_id:required'); if (value.kind === 'elapsed_after_event' && (!nonEmptyText(value.reference_event_id) || !Number.isFinite(Number(value.min_elapsed_story_days)) || Number(value.min_elapsed_story_days) < 0)) errors.push('trigger.elapsed_contract:invalid'); if (value.kind === 'story_time_reached') { validateStoryTime(value.target_story_time, 'trigger.target_story_time', errors); if (!isRecord(value.target_story_time)) errors.push('trigger.target_story_time:required'); } return {ok: errors.length === 0, errors}; }
export function isProjectionEligible({trigger, referenceEvent = null, currentStoryTime = null, precomputedDifference = undefined} = {}) { const validation = validateProjectionTrigger(trigger); if (!validation.ok) return {eligible: false, status: 'unresolved', reason: 'invalid_trigger', errors: validation.errors}; if (trigger.kind === 'immediate_after_event') { if (referenceEvent?.event_id !== trigger.reference_event_id) return {eligible: false, status: 'unresolved', reason: 'reference_event_missing'}; if (trigger.source_event_type && referenceEvent.type !== trigger.source_event_type) return {eligible: false, status: 'not_eligible', reason: 'event_type_mismatch'}; return {eligible: true, status: 'eligible', reason: 'immediate_after_event'}; } if (trigger.kind === 'elapsed_after_event') { if (referenceEvent?.event_id !== trigger.reference_event_id) return {eligible: false, status: 'unresolved', reason: 'reference_event_missing'}; const difference = precomputedDifference === undefined ? differenceStoryTime(currentStoryTime, referenceEvent.story_time) : precomputedDifference; if (!difference || difference.unit !== 'day') return {eligible: false, status: 'unresolved', reason: 'story_time_incomparable'}; return difference.value >= Number(trigger.min_elapsed_story_days) ? {eligible: true, status: 'eligible', reason: 'elapsed_threshold_reached', elapsed_story_days: difference.value} : {eligible: false, status: 'not_eligible', reason: 'elapsed_threshold_not_reached', elapsed_story_days: difference.value}; } const comparison = compareStoryTime(currentStoryTime, trigger.target_story_time); if (comparison === null) return {eligible: false, status: 'unresolved', reason: 'story_time_incomparable'}; return comparison >= 0 ? {eligible: true, status: 'eligible', reason: 'story_time_reached'} : {eligible: false, status: 'not_eligible', reason: 'story_time_not_reached'}; }
