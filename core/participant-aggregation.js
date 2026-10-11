import {differenceStoryTime} from '../story/time.js';
import {deterministicDigest} from './projection.js';
import {validateCharacterTimingConfig} from './character-timing-config.js';

export const PARTICIPANT_AGGREGATION_SCHEMA_VERSION = 1;
export const PARTICIPANT_AGGREGATION_STRATEGIES = Object.freeze([
  'at_effective_min',
  'random_within_effective_range',
]);

const FIELDS = new Set([
  'schema_version', 'aggregation_id', 'owner_type', 'subject_id', 'pregnancy_id',
  'mechanism_key', 'cycle_id', 'timing_instance_id', 'aggregation_trigger_strategy',
  'status', 'reference_story_time', 'aggregation_story_time', 'elapsed_story_days',
  'effective_min_story_days', 'effective_max_story_days',
  'sampled_individual_offset_story_days', 'config_snapshot',
  'accepted_exposure_event_ids', 'source_basis_refs', 'created_at_floor_version',
  'created_at',
]);

function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function clone(value) { if (value === undefined || value === null || typeof value !== 'object') return value; if (typeof structuredClone === 'function') return structuredClone(value); if (Array.isArray(value)) return value.map(clone); return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])); }
function text(value) { return typeof value === 'string' && value.trim() !== ''; }
function ids(value, required = false) { return Array.isArray(value) && (!required || value.length > 0) && value.every(text) && new Set(value).size === value.length; }
function finite(value) { return Number.isFinite(Number(value)); }

export function buildParticipantAggregationId({cycleId, timingInstanceId} = {}) {
  if (!text(cycleId) || !text(timingInstanceId)) return null;
  return `participant_aggregation_${deterministicDigest({schema_version: PARTICIPANT_AGGREGATION_SCHEMA_VERSION, cycle_id: cycleId, timing_instance_id: timingInstanceId})}`;
}

export function validateParticipantAggregation(value) {
  const errors = [];
  if (!isRecord(value)) return {ok: false, errors: ['participant_aggregation:invalid']};
  for (const key of Object.keys(value)) if (!FIELDS.has(key)) errors.push(`participant_aggregation.${key}:unexpected`);
  for (const field of ['aggregation_id', 'owner_type', 'subject_id', 'mechanism_key', 'cycle_id', 'timing_instance_id', 'status']) if (!text(value[field])) errors.push(`participant_aggregation.${field}:required`);
  if (value.schema_version !== PARTICIPANT_AGGREGATION_SCHEMA_VERSION) errors.push('participant_aggregation.schema_version:invalid');
  if (value.status !== 'succeeded') errors.push('participant_aggregation.status:invalid');
  if (value.aggregation_trigger_strategy !== 'at_effective_min') errors.push('participant_aggregation.strategy:invalid');
  if (!ids(value.accepted_exposure_event_ids, true)) errors.push('participant_aggregation.accepted_exposure_event_ids:invalid');
  if (!isRecord(value.source_basis_refs)) errors.push('participant_aggregation.source_basis_refs:invalid');
  if (!isRecord(value.config_snapshot) || !validateCharacterTimingConfig(value.config_snapshot).ok) errors.push('participant_aggregation.config_snapshot:invalid');
  for (const field of ['elapsed_story_days', 'effective_min_story_days', 'effective_max_story_days', 'sampled_individual_offset_story_days']) if (!finite(value[field])) errors.push(`participant_aggregation.${field}:invalid`);
  if (Number(value.effective_min_story_days) < 0 || Number(value.effective_max_story_days) < Number(value.effective_min_story_days)) errors.push('participant_aggregation.effective_window:invalid');
  if (!isRecord(value.created_at_floor_version)) errors.push('participant_aggregation.created_at_floor_version:invalid');
  return {ok: errors.length === 0, errors};
}

export function normalizeParticipantAggregation(value) {
  const source = clone(value ?? {});
  const normalized = {
    schema_version: PARTICIPANT_AGGREGATION_SCHEMA_VERSION,
    aggregation_id: source.aggregation_id ?? null,
    owner_type: source.owner_type ?? 'character',
    subject_id: source.subject_id ?? null,
    pregnancy_id: source.pregnancy_id ?? null,
    mechanism_key: source.mechanism_key ?? null,
    cycle_id: source.cycle_id ?? null,
    timing_instance_id: source.timing_instance_id ?? null,
    aggregation_trigger_strategy: source.aggregation_trigger_strategy ?? 'at_effective_min',
    status: source.status ?? 'succeeded',
    reference_story_time: clone(source.reference_story_time ?? null),
    aggregation_story_time: clone(source.aggregation_story_time ?? null),
    elapsed_story_days: Number(source.elapsed_story_days),
    effective_min_story_days: Number(source.effective_min_story_days),
    effective_max_story_days: Number(source.effective_max_story_days),
    sampled_individual_offset_story_days: Number(source.sampled_individual_offset_story_days),
    config_snapshot: clone(source.config_snapshot ?? null),
    accepted_exposure_event_ids: [...new Set(source.accepted_exposure_event_ids ?? [])].sort(),
    source_basis_refs: clone(source.source_basis_refs ?? {}),
    created_at_floor_version: clone(source.created_at_floor_version ?? null),
    created_at: source.created_at ?? null,
  };
  const validation = validateParticipantAggregation(normalized);
  if (!validation.ok) throw new TypeError(validation.errors.join(', '));
  return normalized;
}

export function emptyParticipantAggregationTimeline() {
  return {schema_version: PARTICIPANT_AGGREGATION_SCHEMA_VERSION, creations: [], lifecycle_records: []};
}

export function normalizeParticipantAggregationTimeline(value, {expectedChatId = null} = {}) {
  const source = isRecord(value) ? value : {};
  const creations = [];
  const conflicts = [];
  const rejected = [];
  const byId = new Map();
  for (const item of Array.isArray(source.creations) ? source.creations : []) {
    try {
      const normalized = normalizeParticipantAggregation(item);
      if (expectedChatId !== null && normalized.created_at_floor_version.chat_id !== expectedChatId) throw new Error('chat_scope');
      const previous = byId.get(normalized.aggregation_id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(normalized)) conflicts.push(normalized.aggregation_id);
      else if (!previous) { byId.set(normalized.aggregation_id, normalized); creations.push(normalized); }
    } catch { rejected.push(item?.aggregation_id ?? null); }
  }
  const lifecycleRecords = Array.isArray(source.lifecycle_records)
    ? source.lifecycle_records.filter(record => isRecord(record) && text(record.aggregation_id) && text(record.action)).map(clone)
    : [];
  return {timeline: {schema_version: PARTICIPANT_AGGREGATION_SCHEMA_VERSION, creations: creations.sort((a, b) => a.aggregation_id.localeCompare(b.aggregation_id)), lifecycle_records: lifecycleRecords}, conflicts, rejected};
}

export function appendParticipantAggregation(record, {timeline, expectedChatId = null} = {}) {
  const normalized = normalizeParticipantAggregation(record);
  if (expectedChatId !== null && normalized.created_at_floor_version.chat_id !== expectedChatId) throw new Error('CHAT_SCOPE_MISMATCH');
  const current = normalizeParticipantAggregationTimeline(timeline, {expectedChatId});
  if (current.conflicts.length || current.rejected.length) throw new Error('PARTICIPANT_AGGREGATION_TIMELINE_INVALID');
  const existing = current.timeline.creations.find(item => item.aggregation_id === normalized.aggregation_id);
  if (existing) return JSON.stringify(existing) === JSON.stringify(normalized)
    ? {status: 'deduped', timeline: current.timeline}
    : {status: 'conflict'};
  return {status: 'appended', timeline: {...current.timeline, creations: [...current.timeline.creations, normalized]}};
}

export function resolveParticipantAggregationTimeline(entries = []) {
  const creations = new Map();
  const lifecycle = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    for (const record of entry?.creations ?? []) creations.set(record.aggregation_id, clone(record));
    for (const record of entry?.lifecycle_records ?? []) lifecycle.set(`${record.aggregation_id}:${record.action}:${record.event_id ?? ''}`, clone(record));
  }
  return {creations: [...creations.values()], lifecycle_records: [...lifecycle.values()]};
}

export function resolveParticipantAggregationTrigger({strategy = 'at_effective_min', timingInstance = null, currentStoryTime = null, aggregation = null} = {}) {
  if (aggregation?.status === 'succeeded') return {status: 'already_succeeded', eligible: false};
  if (strategy === 'random_within_effective_range') return {status: 'strategy_reserved', eligible: false, reason_code: 'random_strategy_not_implemented'};
  if (strategy !== 'at_effective_min') return {status: 'strategy_invalid', eligible: false, reason_code: 'strategy_invalid'};
  if (!timingInstance) return {status: 'source_invalidated', eligible: false, reason_code: 'no_timing_instance'};
  const elapsed = differenceStoryTime(currentStoryTime, timingInstance.reference_story_time);
  if (!elapsed || elapsed.unit !== 'day') return {status: 'unresolved', eligible: false, reason_code: 'story_time_unresolved'};
  if (Number(elapsed.value) < Number(timingInstance.effective_min_story_days)) return {status: 'before_min', eligible: false, elapsed_story_days: elapsed.value};
  if (Number(elapsed.value) > Number(timingInstance.effective_max_story_days)) return {status: 'aggregate_due_overdue', eligible: true, elapsed_story_days: elapsed.value};
  return {status: 'aggregate_due', eligible: true, elapsed_story_days: elapsed.value};
}

export function deriveParticipantList({events = [], acceptedExposureEventIds = [], subjectId} = {}) {
  const accepted = new Set(acceptedExposureEventIds);
  const participants = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    if (!accepted.has(event?.event_id)) continue;
    const relevance = event?.pregnancy_relevance;
    if (relevance?.relevant !== true || !relevance?.gestational_subject_ids?.includes(subjectId)) continue;
    for (const participantId of [...new Set(relevance.counterpart_ids ?? [])].filter(text)) {
      const current = participants.get(participantId) ?? {participant_id: participantId, exposure_event_ids: []};
      current.exposure_event_ids = [...new Set([...current.exposure_event_ids, event.event_id])].sort();
      participants.set(participantId, current);
    }
  }
  return [...participants.values()].sort((left, right) => left.participant_id.localeCompare(right.participant_id)).map(item => ({...item, exposure_count: item.exposure_event_ids.length}));
}

export function buildParticipantAggregationEvidence({aggregation = null, events = [], subjectId = null} = {}) {
  if (!aggregation?.aggregation_id || !aggregation?.cycle_id || !subjectId || !ids(aggregation.accepted_exposure_event_ids, true)) return null;
  const acceptedEvents = (Array.isArray(events) ? events : []).filter(event =>
    aggregation.accepted_exposure_event_ids.includes(event?.event_id) &&
    event?.pregnancy_relevance?.relevant === true &&
    event?.pregnancy_relevance?.gestational_subject_ids?.includes(subjectId));
  if (acceptedEvents.length !== aggregation.accepted_exposure_event_ids.length) return null;
  return {
    subject_id: subjectId,
    aggregation_id: aggregation.aggregation_id,
    pregnancy_id: aggregation.pregnancy_id ?? null,
    cycle_id: aggregation.cycle_id,
    accepted_exposure_event_ids: [...new Set(aggregation.accepted_exposure_event_ids ?? [])].sort(),
    participant_exposure_mapping: deriveParticipantList({
      events,
      acceptedExposureEventIds: aggregation.accepted_exposure_event_ids,
      subjectId,
    }),
  };
}

export function isParticipantAggregationEvidenceComplete(value) {
  if (!isRecord(value) || !text(value.subject_id) || !text(value.aggregation_id) || !text(value.cycle_id)) return false;
  if (value.pregnancy_id !== null && value.pregnancy_id !== undefined && !text(value.pregnancy_id)) return false;
  if (!ids(value.accepted_exposure_event_ids, true) || !Array.isArray(value.participant_exposure_mapping)) return false;
  const accepted = new Set(value.accepted_exposure_event_ids);
  const participantIds = new Set();
  return value.participant_exposure_mapping.every(item =>
    isRecord(item) && text(item.participant_id) && !participantIds.has(item.participant_id) && participantIds.add(item.participant_id) && ids(item.exposure_event_ids, true) && item.exposure_event_ids.every(eventId => accepted.has(eventId)));
}

function sameIds(left = [], right = []) {
  return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
}

export function projectionAggregationEvidenceMatches({projection = null, aggregation = null, events = []} = {}) {
  const evidence = projection?.aggregation_evidence;
  if (!evidence) return projection?.aggregation_path !== 'participant_aggregation';
  if (!isParticipantAggregationEvidenceComplete(evidence)) return false;
  if (!aggregation || evidence.subject_id !== projection.subject_id || evidence.aggregation_id !== aggregation.aggregation_id || evidence.cycle_id !== aggregation.cycle_id) return false;
  if ((evidence.pregnancy_id ?? null) !== (aggregation.pregnancy_id ?? null)) return false;
  const current = buildParticipantAggregationEvidence({aggregation, events, subjectId: projection.subject_id});
  if (!current || !sameIds(evidence.accepted_exposure_event_ids, current.accepted_exposure_event_ids)) return false;
  return JSON.stringify(evidence.participant_exposure_mapping ?? []) === JSON.stringify(current.participant_exposure_mapping ?? []);
}

export function filterProjectionViewsByAggregationEvidence({views, aggregations = [], events = []} = {}) {
  const source = Array.isArray(views?.all) ? views : {all: Array.isArray(views) ? views : []};
  const aggregationById = new Map((Array.isArray(aggregations) ? aggregations : []).map(item => [item?.aggregation_id, item]));
  const all = source.all.map(view => {
    if (!view?.aggregation_evidence && view?.aggregation_path !== 'participant_aggregation') return view;
    const aggregation = aggregationById.get(view?.aggregation_evidence?.aggregation_id);
    const valid = projectionAggregationEvidenceMatches({projection: view, aggregation, events});
    return valid ? view : {...view, context_visible: false, aggregation_evidence_invalid: true};
  });
  return {...source, all, active: all.filter(item => item?.context_visible === true)};
}
