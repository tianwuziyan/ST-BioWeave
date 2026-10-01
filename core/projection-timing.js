import {differenceStoryTime} from '../story/time.js';
import {deterministicDigest} from './projection.js';
import {normalizeCharacterTimingConfig, validateCharacterTimingConfig} from './character-timing-config.js';

export const PROJECTION_TIMING_SCHEMA_VERSION = 1;
export const PROJECTION_TIMING_STATUS = Object.freeze(['before_min', 'window_open', 'window_missed', 'source_invalidated', 'pregnancy_confirmed', 'terminated_by_loss_or_abortion']);

const TIMING_FIELDS = new Set([
  'schema_version', 'timing_instance_id', 'owner_type', 'subject_id',
  'mechanism_key', 'cycle_id', 'source_event_ids', 'source_basis_refs',
  'reference_story_time', 'config_snapshot', 'base_min_story_days',
  'base_max_story_days', 'variance_ratio', 'variance_cap_story_days',
  'sampled_individual_offset_story_days', 'state_modifier_story_days',
  'total_adjustment_story_days', 'total_adjustment_cap_story_days',
  'effective_min_story_days', 'effective_max_story_days', 'world_rule_binding',
  'created_at_floor_version', 'created_at',
]);

function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function clone(value) { if (value === undefined || value === null || typeof value !== 'object') return value; if (typeof structuredClone === 'function') return structuredClone(value); if (Array.isArray(value)) return value.map(clone); return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])); }
function text(value) { return typeof value === 'string' && value.trim() !== ''; }
function uniqueTextArray(value) { return Array.isArray(value) && value.every(text) && new Set(value).size === value.length; }
function finite(value) { return Number.isFinite(Number(value)); }
function finiteNonNegative(value) { return finite(value) && Number(value) >= 0; }
function validateFloorVersion(value, path, errors) { if (!isRecord(value) || !text(value.chat_id) || !text(value.message_id) || !finite(value.floor) || !finite(value.swipe_id) || !text(value.content_hash) || !text(String(value.message_version))) errors.push(`${path}:invalid`); }

export function validateProjectionTimingInstance(value) {
  const errors = [];
  if (!isRecord(value)) return {ok: false, errors: ['projection_timing:invalid']};
  for (const key of Object.keys(value)) if (!TIMING_FIELDS.has(key)) errors.push(`projection_timing.${key}:unexpected`);
  if (value.schema_version !== PROJECTION_TIMING_SCHEMA_VERSION) errors.push('projection_timing.schema_version:invalid');
  for (const field of ['timing_instance_id', 'owner_type', 'subject_id', 'mechanism_key', 'cycle_id']) if (!text(value[field])) errors.push(`projection_timing.${field}:required`);
  if (!uniqueTextArray(value.source_event_ids) || value.source_event_ids.length < 1) errors.push('projection_timing.source_event_ids:invalid');
  if (!isRecord(value.source_basis_refs)) errors.push('projection_timing.source_basis_refs:invalid');
  if (!isRecord(value.config_snapshot) || !validateCharacterTimingConfig(value.config_snapshot).ok) errors.push('projection_timing.config_snapshot:invalid');
  for (const field of ['base_min_story_days', 'base_max_story_days', 'variance_ratio', 'variance_cap_story_days', 'sampled_individual_offset_story_days', 'state_modifier_story_days', 'total_adjustment_story_days', 'total_adjustment_cap_story_days', 'effective_min_story_days', 'effective_max_story_days']) if (!finite(value[field])) errors.push(`projection_timing.${field}:invalid`);
  if (Number(value.base_max_story_days) < Number(value.base_min_story_days)) errors.push('projection_timing.base_max_story_days:before_min');
  if (Number(value.effective_min_story_days) < 0 || Number(value.effective_max_story_days) < Number(value.effective_min_story_days)) errors.push('projection_timing.effective_window:invalid');
  if (value.reference_story_time !== null && value.reference_story_time !== undefined && !isRecord(value.reference_story_time)) errors.push('projection_timing.reference_story_time:invalid');
  if (value.world_rule_binding !== null && value.world_rule_binding !== undefined && !isRecord(value.world_rule_binding)) errors.push('projection_timing.world_rule_binding:invalid');
  validateFloorVersion(value.created_at_floor_version, 'projection_timing.created_at_floor_version', errors);
  return {ok: errors.length === 0, errors};
}

export function normalizeProjectionTimingInstance(value) {
  const source = clone(value ?? {});
  const normalized = {
    schema_version: PROJECTION_TIMING_SCHEMA_VERSION,
    timing_instance_id: source.timing_instance_id ?? null,
    owner_type: source.owner_type ?? 'character',
    subject_id: source.subject_id ?? null,
    mechanism_key: source.mechanism_key ?? null,
    cycle_id: source.cycle_id ?? null,
    source_event_ids: [...new Set(source.source_event_ids ?? [])].sort(),
    source_basis_refs: source.source_basis_refs && typeof source.source_basis_refs === 'object' ? source.source_basis_refs : {},
    reference_story_time: clone(source.reference_story_time ?? null),
    config_snapshot: source.config_snapshot ? normalizeCharacterTimingConfig(source.config_snapshot) : null,
    base_min_story_days: Number(source.base_min_story_days),
    base_max_story_days: Number(source.base_max_story_days),
    variance_ratio: Number(source.variance_ratio),
    variance_cap_story_days: Number(source.variance_cap_story_days),
    sampled_individual_offset_story_days: Number(source.sampled_individual_offset_story_days),
    state_modifier_story_days: Number(source.state_modifier_story_days ?? 0),
    total_adjustment_story_days: Number(source.total_adjustment_story_days),
    total_adjustment_cap_story_days: Number(source.total_adjustment_cap_story_days),
    effective_min_story_days: Number(source.effective_min_story_days),
    effective_max_story_days: Number(source.effective_max_story_days),
    world_rule_binding: clone(source.world_rule_binding ?? null),
    created_at_floor_version: clone(source.created_at_floor_version ?? null),
    created_at: source.created_at ?? null,
  };
  const validation = validateProjectionTimingInstance(normalized);
  if (!validation.ok) throw new TypeError(validation.errors.join(', '));
  return normalized;
}

export function isPregnancyRelevantBasis(event, subjectId, mechanismKey = null) {
  const relevance = event?.pregnancy_relevance;
  return relevance?.relevant === true
    && Array.isArray(relevance.gestational_subject_ids)
    && relevance.gestational_subject_ids.includes(subjectId)
    && text(relevance.reproductive_mechanism?.kind)
    && (!mechanismKey || relevance.reproductive_mechanism.kind === mechanismKey);
}

export function buildProjectionTimingCycleId({chatId, subjectId, mechanismKey, firstEvent} = {}) {
  if (!text(chatId) || !text(subjectId) || !text(mechanismKey) || !text(firstEvent?.event_id)) return null;
  return `projection_timing_cycle_${deterministicDigest({schema_version: PROJECTION_TIMING_SCHEMA_VERSION, chat_id: chatId, subject_id: subjectId, mechanism_key: mechanismKey, first_event_id: firstEvent.event_id, first_event_story_time: firstEvent.story_time ?? null})}`;
}

export function buildProjectionTimingInstanceId({cycleId} = {}) {
  return text(cycleId) ? `projection_timing_${deterministicDigest({schema_version: PROJECTION_TIMING_SCHEMA_VERSION, cycle_id: cycleId})}` : null;
}

export function resolveProjectionTimingInstance({chatId, subjectId, mechanismKey, firstEvent, config, floorVersion, worldRuleBinding = null, rng = Math.random, now = () => new Date().toISOString()} = {}) {
  const normalizedConfig = normalizeCharacterTimingConfig(config);
  if (!isPregnancyRelevantBasis(firstEvent, subjectId, mechanismKey)) throw new TypeError('projection_timing:factual_basis_invalid');
  const cycleId = buildProjectionTimingCycleId({chatId, subjectId, mechanismKey, firstEvent});
  const timingInstanceId = buildProjectionTimingInstanceId({cycleId});
  const referenceDays = (normalizedConfig.base_min_story_days + normalizedConfig.base_max_story_days) / 2;
  const allowedOffset = Math.min(referenceDays * normalizedConfig.variance_ratio, normalizedConfig.variance_cap_story_days);
  const randomValue = Number(rng());
  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue > 1) throw new TypeError('projection_timing:rng_invalid');
  const sampled = (randomValue * 2 - 1) * allowedOffset;
  const total = Math.max(-normalizedConfig.total_adjustment_cap_story_days, Math.min(normalizedConfig.total_adjustment_cap_story_days, sampled));
  const effectiveMin = Math.max(0, normalizedConfig.base_min_story_days + total);
  const effectiveMax = Math.max(effectiveMin, normalizedConfig.base_max_story_days + total);
  return normalizeProjectionTimingInstance({
    timing_instance_id: timingInstanceId,
    owner_type: 'character',
    subject_id: subjectId,
    mechanism_key: mechanismKey,
    cycle_id: cycleId,
    source_event_ids: [firstEvent.event_id],
    source_basis_refs: {[firstEvent.event_id]: {event_id: firstEvent.event_id, story_time: clone(firstEvent.story_time ?? null), event_version: firstEvent.version ?? firstEvent.event_version ?? null}},
    reference_story_time: clone(firstEvent.story_time ?? null),
    config_snapshot: normalizedConfig,
    base_min_story_days: normalizedConfig.base_min_story_days,
    base_max_story_days: normalizedConfig.base_max_story_days,
    variance_ratio: normalizedConfig.variance_ratio,
    variance_cap_story_days: normalizedConfig.variance_cap_story_days,
    sampled_individual_offset_story_days: sampled,
    state_modifier_story_days: 0,
    total_adjustment_story_days: total,
    total_adjustment_cap_story_days: normalizedConfig.total_adjustment_cap_story_days,
    effective_min_story_days: effectiveMin,
    effective_max_story_days: effectiveMax,
    world_rule_binding: worldRuleBinding,
    created_at_floor_version: floorVersion,
    created_at: now(),
  });
}

export function evaluateProjectionTiming({timingInstance, currentStoryTime, events = [], subjectId, pregnancyConfirmed = false, terminated = false} = {}) {
  if (!timingInstance) return {status: 'source_invalidated', eligible: 'not_eligible', reason_code: 'no_timing_instance'};
  const basis = timingInstance.source_event_ids.filter(id => (Array.isArray(events) ? events : []).some(event => event?.event_id === id && isPregnancyRelevantBasis(event, subjectId, timingInstance.mechanism_key)));
  if (!basis.length) return {status: 'source_invalidated', eligible: 'not_eligible', reason_code: 'source_invalidated'};
  if (pregnancyConfirmed) return {status: 'pregnancy_confirmed', eligible: 'not_eligible', reason_code: 'pregnancy_confirmed'};
  if (terminated) return {status: 'terminated_by_loss_or_abortion', eligible: 'not_eligible', reason_code: 'terminated_by_loss_or_abortion'};
  const elapsed = differenceStoryTime(currentStoryTime, timingInstance.reference_story_time);
  if (!elapsed || elapsed.unit !== 'day') return {status: 'before_min', eligible: 'unresolved', reason_code: 'story_time_unresolved'};
  if (elapsed.value < timingInstance.effective_min_story_days) return {status: 'before_min', eligible: 'not_eligible', reason_code: 'before_min', elapsed_story_days: elapsed.value};
  if (elapsed.value <= timingInstance.effective_max_story_days) return {status: 'window_open', eligible: 'eligible', reason_code: 'window_open', elapsed_story_days: elapsed.value};
  return {status: 'window_missed', eligible: 'not_eligible', reason_code: 'window_missed', elapsed_story_days: elapsed.value};
}
