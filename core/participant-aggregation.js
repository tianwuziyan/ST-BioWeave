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
function nonEmptyFloorScalar(value) { return text(value) || (typeof value === 'number' && Number.isFinite(value)); }
function validFloorVersion(value) {
  return isRecord(value)
    && text(value.chat_id)
    && nonEmptyFloorScalar(value.message_id)
    && finite(value.floor)
    && finite(value.swipe_id)
    && text(value.content_hash)
    && nonEmptyFloorScalar(value.message_version);
}

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
  if (!validFloorVersion(value.created_at_floor_version)) errors.push('participant_aggregation.created_at_floor_version:invalid');
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

export const PARTICIPANT_AGGREGATION_SNAPSHOT_SCHEMA_VERSION = PARTICIPANT_AGGREGATION_SCHEMA_VERSION;

export function emptyParticipantAggregationSnapshot() {
  return {schema_version: PARTICIPANT_AGGREGATION_SNAPSHOT_SCHEMA_VERSION, items: []};
}

/**
 * Participant aggregation is stored as the complete collection for one Floor.
 * Only `items` is authoritative; old timeline fields are intentionally not
 * read or migrated.
 */
export function normalizeParticipantAggregationSnapshot(value, {expectedChatId = null} = {}) {
  const validRoot = isRecord(value)
    && value.schema_version === PARTICIPANT_AGGREGATION_SNAPSHOT_SCHEMA_VERSION
    && Array.isArray(value.items);
  const source = validRoot ? value : {};
  const items = [];
  const conflicts = [];
  const rejected = [];
  const byId = new Map();
  for (const item of Array.isArray(source.items) ? source.items : []) {
    try {
      const normalized = normalizeParticipantAggregation(item);
      if (expectedChatId !== null && normalized.created_at_floor_version.chat_id !== expectedChatId) throw new Error('chat_scope');
      const previous = byId.get(normalized.aggregation_id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(normalized)) conflicts.push(normalized.aggregation_id);
      else if (!previous) byId.set(normalized.aggregation_id, normalized);
    } catch { rejected.push(item?.aggregation_id ?? null); }
  }
  items.push(...byId.values());
  items.sort((left, right) => left.aggregation_id.localeCompare(right.aggregation_id));
  return {
    snapshot: {schema_version: PARTICIPANT_AGGREGATION_SNAPSHOT_SCHEMA_VERSION, items},
    conflicts,
    rejected,
    invalid: !validRoot,
  };
}

export function upsertParticipantAggregation(record, {snapshot, expectedChatId = null} = {}) {
  const normalized = normalizeParticipantAggregation(record);
  if (expectedChatId !== null && normalized.created_at_floor_version.chat_id !== expectedChatId) throw new Error('CHAT_SCOPE_MISMATCH');
  const current = normalizeParticipantAggregationSnapshot(snapshot, {expectedChatId});
  if (current.invalid || current.conflicts.length || current.rejected.length) throw new Error('PARTICIPANT_AGGREGATION_SNAPSHOT_INVALID');
  const index = current.snapshot.items.findIndex(item => item.aggregation_id === normalized.aggregation_id);
  if (index < 0) {
    return {
      status: 'created',
      snapshot: {
        ...current.snapshot,
        items: [...current.snapshot.items, normalized].sort((left, right) => left.aggregation_id.localeCompare(right.aggregation_id)),
      },
    };
  }
  if (JSON.stringify(current.snapshot.items[index]) === JSON.stringify(normalized)) return {status: 'deduped', snapshot: current.snapshot};
  const items = current.snapshot.items.slice();
  items[index] = normalized;
  return {
    status: 'updated',
    snapshot: {...current.snapshot, items: items.sort((left, right) => left.aggregation_id.localeCompare(right.aggregation_id))},
  };
}

export function removeParticipantAggregation(aggregationId, {snapshot, expectedChatId = null} = {}) {
  const current = normalizeParticipantAggregationSnapshot(snapshot, {expectedChatId});
  if (current.invalid || current.conflicts.length || current.rejected.length) throw new Error('PARTICIPANT_AGGREGATION_SNAPSHOT_INVALID');
  const items = current.snapshot.items.filter(item => item.aggregation_id !== aggregationId);
  return {
    status: items.length === current.snapshot.items.length ? 'not_found' : 'removed',
    snapshot: {...current.snapshot, items},
  };
}

export function replaceParticipantAggregationSnapshot(items, {expectedChatId = null} = {}) {
  const normalized = normalizeParticipantAggregationSnapshot({schema_version: PARTICIPANT_AGGREGATION_SNAPSHOT_SCHEMA_VERSION, items}, {expectedChatId});
  if (normalized.invalid || normalized.conflicts.length || normalized.rejected.length) throw new Error('PARTICIPANT_AGGREGATION_SNAPSHOT_INVALID');
  return normalized.snapshot;
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

export function findParticipantAggregationEvidenceInvalidEventIds({aggregation = null, events = [], subjectId = null} = {}) {
  const acceptedIds = Array.isArray(aggregation?.accepted_exposure_event_ids) ? aggregation.accepted_exposure_event_ids : [];
  const eventById = new Map((Array.isArray(events) ? events : []).map(event => [event?.event_id, event]));
  return acceptedIds.filter(eventId => {
    const event = eventById.get(eventId);
    return event?.pregnancy_relevance?.relevant !== true
      || !event.pregnancy_relevance.gestational_subject_ids?.includes(subjectId)
      || event.pregnancy_relevance.reproductive_mechanism?.kind !== aggregation?.mechanism_key;
  });
}

// Historical Aggregation stays immutable; Projection generation may opt into a
// current valid subset, while strict callers keep the all-sources contract.
export function buildParticipantAggregationEvidence({aggregation = null, events = [], subjectId = null, allowPartial = false} = {}) {
  if (!aggregation?.aggregation_id || !aggregation?.cycle_id || !subjectId || !ids(aggregation.accepted_exposure_event_ids, true)) return null;
  const invalidEventIds = findParticipantAggregationEvidenceInvalidEventIds({aggregation, events, subjectId});
  if (invalidEventIds.length && !allowPartial) return null;
  const acceptedExposureEventIds = aggregation.accepted_exposure_event_ids.filter(eventId => !invalidEventIds.includes(eventId));
  if (!acceptedExposureEventIds.length) return null;
  return {
    subject_id: subjectId,
    aggregation_id: aggregation.aggregation_id,
    pregnancy_id: aggregation.pregnancy_id ?? null,
    cycle_id: aggregation.cycle_id,
    accepted_exposure_event_ids: [...new Set(acceptedExposureEventIds)].sort(),
    participant_exposure_mapping: deriveParticipantList({
      events,
      acceptedExposureEventIds,
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

export const PROJECTION_AGGREGATION_EVIDENCE_REASON_CODES = Object.freeze({
  NON_AGGREGATION_PROJECTION: 'NON_AGGREGATION_PROJECTION',
  MISSING_EVIDENCE: 'MISSING_EVIDENCE',
  EVIDENCE_INCOMPLETE: 'EVIDENCE_INCOMPLETE',
  AGGREGATION_NOT_FOUND: 'AGGREGATION_NOT_FOUND',
  AGGREGATION_ID_MISMATCH: 'AGGREGATION_ID_MISMATCH',
  SUBJECT_ID_MISMATCH: 'SUBJECT_ID_MISMATCH',
  CYCLE_ID_MISMATCH: 'CYCLE_ID_MISMATCH',
  PREGNANCY_ID_MISMATCH: 'PREGNANCY_ID_MISMATCH',
  CURRENT_EVIDENCE_UNAVAILABLE: 'CURRENT_EVIDENCE_UNAVAILABLE',
  EXPOSURE_ID_MISMATCH: 'EXPOSURE_ID_MISMATCH',
  PARTICIPANT_MAPPING_MISMATCH: 'PARTICIPANT_MAPPING_MISMATCH',
  VALID: 'VALID',
});

function reportProjectionAggregationDecision(diagnosticCollector, decision) {
  if (typeof diagnosticCollector === 'function') {
    diagnosticCollector(decision);
    return;
  }
  if (Array.isArray(diagnosticCollector)) diagnosticCollector.push(decision);
}

export function projectionAggregationEvidenceDecision({projection = null, aggregation = null, events = []} = {}) {
  const evidence = projection?.aggregation_evidence;
  const participantAggregationProjection = Boolean(
    evidence || projection?.aggregation_path === 'participant_aggregation',
  );
  if (!participantAggregationProjection) {
    return {
      projection_id: projection?.projection_id ?? null,
      subject_id: projection?.subject_id ?? null,
      aggregation_id: null,
      valid: true,
      reason_code: PROJECTION_AGGREGATION_EVIDENCE_REASON_CODES.NON_AGGREGATION_PROJECTION,
    };
  }
  if (!evidence) {
    return {
      projection_id: projection?.projection_id ?? null,
      subject_id: projection?.subject_id ?? null,
      aggregation_id: null,
      valid: false,
      reason_code: PROJECTION_AGGREGATION_EVIDENCE_REASON_CODES.MISSING_EVIDENCE,
    };
  }
  const base = {
    projection_id: projection?.projection_id ?? null,
    subject_id: projection?.subject_id ?? null,
    aggregation_id: evidence.aggregation_id ?? null,
  };
  if (!isParticipantAggregationEvidenceComplete(evidence)) {
    return {...base, valid: false, reason_code: PROJECTION_AGGREGATION_EVIDENCE_REASON_CODES.EVIDENCE_INCOMPLETE};
  }
  if (!aggregation) {
    return {...base, valid: false, reason_code: PROJECTION_AGGREGATION_EVIDENCE_REASON_CODES.AGGREGATION_NOT_FOUND};
  }
  if (evidence.aggregation_id !== aggregation.aggregation_id) {
    return {...base, valid: false, reason_code: PROJECTION_AGGREGATION_EVIDENCE_REASON_CODES.AGGREGATION_ID_MISMATCH};
  }
  if (evidence.subject_id !== projection.subject_id) {
    return {...base, valid: false, reason_code: PROJECTION_AGGREGATION_EVIDENCE_REASON_CODES.SUBJECT_ID_MISMATCH};
  }
  if (evidence.cycle_id !== aggregation.cycle_id) {
    return {...base, valid: false, reason_code: PROJECTION_AGGREGATION_EVIDENCE_REASON_CODES.CYCLE_ID_MISMATCH};
  }
  if ((evidence.pregnancy_id ?? null) !== (aggregation.pregnancy_id ?? null)) {
    return {...base, valid: false, reason_code: PROJECTION_AGGREGATION_EVIDENCE_REASON_CODES.PREGNANCY_ID_MISMATCH};
  }
  const current = buildParticipantAggregationEvidence({aggregation, events, subjectId: projection.subject_id, allowPartial: true});
  if (!current) {
    return {...base, valid: false, reason_code: PROJECTION_AGGREGATION_EVIDENCE_REASON_CODES.CURRENT_EVIDENCE_UNAVAILABLE};
  }
  if (!sameIds(evidence.accepted_exposure_event_ids, current.accepted_exposure_event_ids)) {
    return {...base, valid: false, reason_code: PROJECTION_AGGREGATION_EVIDENCE_REASON_CODES.EXPOSURE_ID_MISMATCH};
  }
  if (JSON.stringify(evidence.participant_exposure_mapping ?? []) !== JSON.stringify(current.participant_exposure_mapping ?? [])) {
    return {...base, valid: false, reason_code: PROJECTION_AGGREGATION_EVIDENCE_REASON_CODES.PARTICIPANT_MAPPING_MISMATCH};
  }
  return {...base, valid: true, reason_code: PROJECTION_AGGREGATION_EVIDENCE_REASON_CODES.VALID};
}

export function projectionAggregationEvidenceMatches({projection = null, aggregation = null, events = [], diagnosticCollector = null} = {}) {
  const decision = projectionAggregationEvidenceDecision({projection, aggregation, events});
  reportProjectionAggregationDecision(diagnosticCollector, decision);
  return decision.valid;
}

export function filterProjectionViewsByAggregationEvidence({views, aggregations = [], events = [], diagnosticCollector = null} = {}) {
  const source = Array.isArray(views?.all) ? views : {all: Array.isArray(views) ? views : []};
  const aggregationById = new Map((Array.isArray(aggregations) ? aggregations : []).map(item => [item?.aggregation_id, item]));
  const all = source.all.map(view => {
    const aggregation = aggregationById.get(view?.aggregation_evidence?.aggregation_id);
    const decision = projectionAggregationEvidenceDecision({projection: view, aggregation, events});
    reportProjectionAggregationDecision(diagnosticCollector, decision);
    if (decision.reason_code === PROJECTION_AGGREGATION_EVIDENCE_REASON_CODES.NON_AGGREGATION_PROJECTION) return view;
    return decision.valid ? view : {...view, context_visible: false, aggregation_evidence_invalid: true};
  });
  return {...source, all, active: all.filter(item => item?.context_visible === true)};
}
