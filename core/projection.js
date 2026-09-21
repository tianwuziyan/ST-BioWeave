import {differenceStoryTime, compareStoryTime} from '../story/time.js';

export const PROJECTION_SCHEMA_VERSION = 1;
export const PROJECTION_TRIGGER_SCHEMA_VERSION = 1;
export const PROJECTION_LIFECYCLE_SCHEMA_VERSION = 1;
export const PROJECTION_EVIDENCE_SCHEMA_VERSION = 1;
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
const PROJECTION_FIELDS = new Set(['schema_version', 'projection_id', 'owner_type', 'subject_id', 'projection_rule_id', 'development_concern_key', 'mechanism', 'source_event_ids', 'development', 'timing', 'created_at_floor_version', 'evidence_refs']);
const MECHANISM_FIELDS = new Set(['key', 'world_model_rule_refs']);
const BASIS_FIELDS = new Set(['event_ids', 'state_refs', 'mechanism_rule_refs']);
const DEVELOPMENT_FIELDS = new Set(['kind', 'current_basis', 'next_signal']);
const TIMING_FIELDS = new Set(['trigger_kind', 'reference_event_id', 'reference_story_time', 'current_story_time', 'elapsed_story_days']);
const LIFECYCLE_FIELDS = new Set(['schema_version', 'lifecycle_id', 'projection_id', 'owner_type', 'record_kind', 'action', 'created_at_floor_version', 'evidence_refs']);
const EVIDENCE_FIELDS = new Set(['schema_version', 'evidence_record_id', 'projection_id', 'owner_type', 'source_event_ids', 'created_at_floor_version', 'evidence_refs']);
const TRIGGER_FIELDS = new Set(['schema_version', 'kind', 'source_event_type', 'reference_event_id', 'min_elapsed_story_days', 'target_story_time', 'development_kind']);
const FORBIDDEN_KEYS = new Set(['prompt', 'raw_prompt', 'raw_response', 'raw_ai_response', 'snapshot', 'current_state', 'probability', 'random', 'random_result', 'seed', 'ui', 'formatted_ui', 'pregnancy_id', 'conception_id', 'outcome']);
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

export function normalizeProjection(value = {}) {
  const source = cloneValue(value);
  return {
    schema_version: PROJECTION_SCHEMA_VERSION, projection_id: source.projection_id ?? null, owner_type: source.owner_type ?? 'character', subject_id: source.subject_id ?? null, projection_rule_id: source.projection_rule_id ?? null, development_concern_key: source.development_concern_key ?? null,
    mechanism: {key: source.mechanism?.key ?? null, world_model_rule_refs: [...(source.mechanism?.world_model_rule_refs ?? [])].sort()}, source_event_ids: [...(source.source_event_ids ?? [])].sort(),
    development: {kind: source.development?.kind ?? null, current_basis: {event_ids: [...(source.development?.current_basis?.event_ids ?? [])].sort(), state_refs: [...(source.development?.current_basis?.state_refs ?? [])].sort(), mechanism_rule_refs: [...(source.development?.current_basis?.mechanism_rule_refs ?? [])].sort()}, next_signal: source.development?.next_signal ?? null},
    timing: {trigger_kind: source.timing?.trigger_kind ?? null, reference_event_id: source.timing?.reference_event_id ?? null, reference_story_time: cloneValue(source.timing?.reference_story_time ?? null), current_story_time: cloneValue(source.timing?.current_story_time ?? null), elapsed_story_days: source.timing?.elapsed_story_days ?? null},
    created_at_floor_version: cloneValue(source.created_at_floor_version ?? null), evidence_refs: [...(source.evidence_refs ?? [])].sort(),
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
  validateMechanism(value.mechanism, 'projection.mechanism', errors); if (!uniqueTextArray(value.source_event_ids, true)) errors.push('projection.source_event_ids:invalid'); validateDevelopment(value.development, 'projection.development', errors); validateTiming(value.timing, 'projection.timing', errors); validateFloorVersion(value.created_at_floor_version, 'projection.created_at_floor_version', errors); validateEvidenceRefs(value.evidence_refs, 'projection.evidence_refs', errors, true);
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
function dedupeById(values, validate, idKey, conflictCode, options = {}) { const records = [], conflicts = [], rejected = [], byId = new Map(); for (const value of Array.isArray(values) ? values : []) { const id = value?.[idKey]; const duplicate = byId.get(id); if (duplicate) { if (stableFingerprint(duplicate) !== stableFingerprint(value)) conflicts.push({code: conflictCode, [idKey]: id, values: [cloneValue(duplicate), cloneValue(value)]}); continue; } const validation = validate(value, options); if (!validation.ok) { rejected.push({value: cloneValue(value), errors: validation.errors}); continue; } byId.set(id, value); records.push(cloneValue(value)); } return {records, conflicts, rejected}; }
export function dedupeProjections(values = []) { const result = dedupeById(values, validateProjection, 'projection_id', 'projection_id_conflict'); return {...result, projections: result.records}; }
export function dedupeProjectionLifecycleRecords(values = [], options = {}) { const result = dedupeById(values, value => validateProjectionLifecycleRecord(value, options), 'lifecycle_id', 'lifecycle_id_conflict'); return {...result, records: result.records}; }
export function dedupeProjectionEvidenceRecords(values = [], options = {}) { const result = dedupeById(values, value => validateProjectionEvidenceRecord(value, options), 'evidence_record_id', 'evidence_record_id_conflict'); return {...result, records: result.records}; }

function validateTimelineEntry(entry) { const errors = []; if (!isRecord(entry) || entry.owner_type !== 'character') errors.push('timeline_entry:not_character'); validateFloorVersion(entry?.floor_version, 'timeline_entry.floor_version', errors); if (!Array.isArray(entry?.projections) || !Array.isArray(entry?.lifecycle_records) || !Array.isArray(entry?.evidence_records)) errors.push('timeline_entry:collections_required'); return errors; }
function statusLists(views) { const result = {all: views, active: [], realized: [], contradicted: [], expired: [], deleted: [], conflicts: [], rejected: []}; for (const view of views) { if (view.context_visible) result.active.push(view); if (view.factual_status && result[view.factual_status]) result[view.factual_status].push(view); if (view.deleted) result.deleted.push(view); } return result; }
export function resolveProjectionView({timeline = []} = {}) {
  const entries = Array.isArray(timeline) ? timeline : []; const errors = entries.flatMap(validateTimelineEntry); const projectionResult = dedupeProjections(entries.flatMap(entry => entry?.projections ?? [])); const knownProjectionIds = new Set(projectionResult.projections.map(item => item.projection_id)); const lifecycleResult = dedupeProjectionLifecycleRecords(entries.flatMap(entry => entry?.lifecycle_records ?? []), {knownProjectionIds}); const evidenceResult = dedupeProjectionEvidenceRecords(entries.flatMap(entry => entry?.evidence_records ?? []), {knownProjectionIds}); const conflicts = [...errors.map(code => ({code})), ...projectionResult.conflicts, ...lifecycleResult.conflicts, ...evidenceResult.conflicts]; const rejected = [...projectionResult.rejected, ...lifecycleResult.rejected, ...evidenceResult.rejected]; const conflictedIds = new Set(projectionResult.conflicts.map(item => item.projection_id)); const recordsById = new Map(); const evidenceById = new Map(); for (const record of lifecycleResult.records) { if (!recordsById.has(record.projection_id)) recordsById.set(record.projection_id, []); recordsById.get(record.projection_id).push(record); } for (const record of evidenceResult.records) { if (!evidenceById.has(record.projection_id)) evidenceById.set(record.projection_id, []); evidenceById.get(record.projection_id).push(record); }
  const views = projectionResult.projections.filter(item => !conflictedIds.has(item.projection_id)).map(projection => { const records = recordsById.get(projection.projection_id) ?? []; const factual = records.filter(record => record.record_kind === 'factual'); const positions = new Map(); for (const record of factual) { const position = stableFingerprint(record.created_at_floor_version); if (!positions.has(position)) positions.set(position, new Set()); positions.get(position).add(record.action); } const localConflicts = [...positions.entries()].filter(([, actions]) => actions.size > 1).map(([position, actions]) => ({code: 'factual_lifecycle_conflict', projection_id: projection.projection_id, position, actions: [...actions].sort()})); conflicts.push(...localConflicts); const factualStatus = localConflicts.length ? null : (factual[factual.length - 1]?.action ?? 'active'); const deleted = records.some(record => record.record_kind === 'deletion' && record.action === 'deleted'); const sourceEventIds = new Set(projection.source_event_ids); for (const record of evidenceById.get(projection.projection_id) ?? []) for (const eventId of record.source_event_ids) sourceEventIds.add(eventId); return {...cloneValue(projection), source_event_ids: [...sourceEventIds].sort(), factual_status: factualStatus, deleted, context_visible: !deleted && factualStatus === 'active', lifecycle_records: cloneValue(records), evidence_records: cloneValue(evidenceById.get(projection.projection_id) ?? []), lifecycle_conflicts: localConflicts}; }); const result = statusLists(views); result.conflicts = conflicts; result.rejected = rejected; return result;
}

export function validateProjectionTrigger(value) { const errors = []; if (!isRecord(value)) return {ok: false, errors: ['trigger:invalid']}; collectUnexpected(errors, value, TRIGGER_FIELDS, 'trigger'); if (value.schema_version !== PROJECTION_TRIGGER_SCHEMA_VERSION) errors.push('trigger.schema_version:invalid'); if (!PROJECTION_TRIGGER_KINDS.includes(value.kind)) errors.push('trigger.kind:invalid'); if (!PROJECTION_DEVELOPMENT_KINDS.includes(value.development_kind)) errors.push('trigger.development_kind:invalid'); if (value.source_event_type !== null && value.source_event_type !== undefined && !nonEmptyText(value.source_event_type)) errors.push('trigger.source_event_type:invalid'); if (value.reference_event_id !== null && value.reference_event_id !== undefined && !nonEmptyText(value.reference_event_id)) errors.push('trigger.reference_event_id:invalid'); if (value.kind === 'immediate_after_event' && !nonEmptyText(value.reference_event_id)) errors.push('trigger.reference_event_id:required'); if (value.kind === 'elapsed_after_event' && (!nonEmptyText(value.reference_event_id) || !Number.isFinite(Number(value.min_elapsed_story_days)) || Number(value.min_elapsed_story_days) < 0)) errors.push('trigger.elapsed_contract:invalid'); if (value.kind === 'story_time_reached') { validateStoryTime(value.target_story_time, 'trigger.target_story_time', errors); if (!isRecord(value.target_story_time)) errors.push('trigger.target_story_time:required'); } return {ok: errors.length === 0, errors}; }
export function isProjectionEligible({trigger, referenceEvent = null, currentStoryTime = null} = {}) { const validation = validateProjectionTrigger(trigger); if (!validation.ok) return {eligible: false, status: 'unresolved', reason: 'invalid_trigger', errors: validation.errors}; if (trigger.kind === 'immediate_after_event') { if (referenceEvent?.event_id !== trigger.reference_event_id) return {eligible: false, status: 'unresolved', reason: 'reference_event_missing'}; if (trigger.source_event_type && referenceEvent.type !== trigger.source_event_type) return {eligible: false, status: 'not_eligible', reason: 'event_type_mismatch'}; return {eligible: true, status: 'eligible', reason: 'immediate_after_event'}; } if (trigger.kind === 'elapsed_after_event') { if (referenceEvent?.event_id !== trigger.reference_event_id) return {eligible: false, status: 'unresolved', reason: 'reference_event_missing'}; const difference = differenceStoryTime(currentStoryTime, referenceEvent.story_time); if (!difference || difference.unit !== 'day') return {eligible: false, status: 'unresolved', reason: 'story_time_incomparable'}; return difference.value >= Number(trigger.min_elapsed_story_days) ? {eligible: true, status: 'eligible', reason: 'elapsed_threshold_reached', elapsed_story_days: difference.value} : {eligible: false, status: 'not_eligible', reason: 'elapsed_threshold_not_reached', elapsed_story_days: difference.value}; } const comparison = compareStoryTime(currentStoryTime, trigger.target_story_time); if (comparison === null) return {eligible: false, status: 'unresolved', reason: 'story_time_incomparable'}; return comparison >= 0 ? {eligible: true, status: 'eligible', reason: 'story_time_reached'} : {eligible: false, status: 'not_eligible', reason: 'story_time_not_reached'}; }

export function activeProjections({timeline = []} = {}) { return resolveProjectionView({timeline}).active; }
