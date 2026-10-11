import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveProjectionTimingInstance} from '../core/projection-timing.js';
import {appendParticipantAggregation, buildParticipantAggregationEvidence, deriveParticipantList, filterProjectionViewsByAggregationEvidence, normalizeParticipantAggregation, resolveParticipantAggregationTrigger} from '../core/participant-aggregation.js';
import {createParticipantAggregationPersistence} from '../storage/participant-aggregation.js';
import {emptyFloor} from '../storage/schema.js';

const version = {chat_id: 'chat-aggregation', message_id: 'message-1', floor: 1, swipe_id: 0, content_hash: 'hash-1', message_version: 'v1'};
const config = {schema_version: 1, config_version: 1, base_min_story_days: 14, base_max_story_days: 42, variance_ratio: 0.1, variance_cap_story_days: 3, total_adjustment_cap_story_days: 3};
const exposure = (event_id, day, counterpart_ids = ['source-1']) => ({event_id, type: 'sexual_activity', status: 'confirmed', story_time: {day_index: day}, pregnancy_relevance: {relevant: true, possible_conception: true, gestational_subject_ids: ['subject-1'], counterpart_ids, reproductive_mechanism: {kind: 'fertilization'}}});

function timing() {
  return resolveProjectionTimingInstance({chatId: version.chat_id, subjectId: 'subject-1', mechanismKey: 'fertilization', firstEvent: exposure('exposure-1', 1), config, floorVersion: version, rng: () => 1});
}

test('aggregation trigger consumes frozen effective range and never window_missed', () => {
  const instance = timing();
  assert.equal(instance.effective_min_story_days, 16.8);
  assert.equal(instance.effective_max_story_days, 44.8);
  assert.equal(resolveParticipantAggregationTrigger({timingInstance: instance, currentStoryTime: {day_index: 18}}).status, 'aggregate_due');
  assert.equal(resolveParticipantAggregationTrigger({timingInstance: instance, currentStoryTime: {day_index: 100}}).status, 'aggregate_due_overdue');
  assert.equal(resolveParticipantAggregationTrigger({strategy: 'random_within_effective_range', timingInstance: instance, currentStoryTime: {day_index: 18}}).status, 'strategy_reserved');
});

test('same timing instance and aggregation record are idempotent without resampling', () => {
  const instance = timing();
  const record = normalizeParticipantAggregation({aggregation_id: 'aggregation-1', subject_id: instance.subject_id, mechanism_key: instance.mechanism_key, cycle_id: instance.cycle_id, timing_instance_id: instance.timing_instance_id, reference_story_time: instance.reference_story_time, aggregation_story_time: {day_index: 18}, elapsed_story_days: 17, effective_min_story_days: instance.effective_min_story_days, effective_max_story_days: instance.effective_max_story_days, sampled_individual_offset_story_days: instance.sampled_individual_offset_story_days, config_snapshot: instance.config_snapshot, accepted_exposure_event_ids: ['exposure-1'], source_basis_refs: instance.source_basis_refs, created_at_floor_version: version});
  const first = appendParticipantAggregation(record, {timeline: {schema_version: 1, creations: [], lifecycle_records: []}, expectedChatId: version.chat_id});
  const second = appendParticipantAggregation(record, {timeline: first.timeline, expectedChatId: version.chat_id});
  assert.equal(first.status, 'appended');
  assert.equal(second.status, 'deduped');
  assert.ok(Math.abs(first.timeline.creations[0].sampled_individual_offset_story_days - 2.8) < 1e-9);
});

test('participant list is rebuilt from accepted complete events and preserves surviving participants', () => {
  const events = [exposure('exposure-1', 1, ['source-1']), exposure('exposure-2', 2, ['source-1', 'source-2']), exposure('exposure-3', 3, ['source-2'])];
  const afterDelete = deriveParticipantList({events, subjectId: 'subject-1', acceptedExposureEventIds: ['exposure-2', 'exposure-3']});
  assert.deepEqual(afterDelete, [
    {participant_id: 'source-1', exposure_event_ids: ['exposure-2'], exposure_count: 1},
    {participant_id: 'source-2', exposure_event_ids: ['exposure-2', 'exposure-3'], exposure_count: 2},
  ]);
});

test('projection evidence is invalidated at accepted-set and participant-mapping granularity without deleting history', () => {
  const events = [exposure('exposure-1', 1, ['source-1']), exposure('exposure-2', 2, ['source-1', 'source-2'])];
  const aggregation = normalizeParticipantAggregation({aggregation_id: 'aggregation-1', subject_id: 'subject-1', mechanism_key: 'fertilization', cycle_id: 'cycle-1', timing_instance_id: 'timing-1', reference_story_time: {day_index: 1}, aggregation_story_time: {day_index: 18}, elapsed_story_days: 17, effective_min_story_days: 14, effective_max_story_days: 42, sampled_individual_offset_story_days: 0, config_snapshot: config, accepted_exposure_event_ids: ['exposure-1', 'exposure-2'], source_basis_refs: {}, created_at_floor_version: version});
  const evidence = buildParticipantAggregationEvidence({aggregation, events, subjectId: 'subject-1'});
  assert.equal(evidence.subject_id, 'subject-1');
  const view = {projection_id: 'projection-1', subject_id: 'subject-1', aggregation_evidence: evidence, context_visible: true};
  assert.equal(filterProjectionViewsByAggregationEvidence({views: {all: [view]}, aggregations: [aggregation], events}).all[0].context_visible, true);
  const afterDelete = filterProjectionViewsByAggregationEvidence({views: {all: [view]}, aggregations: [aggregation], events: [events[1]]});
  assert.equal(afterDelete.all[0].context_visible, false);
  assert.equal(afterDelete.all[0].aggregation_evidence_invalid, true);
  assert.equal(afterDelete.all[0].projection_id, 'projection-1');
});

test('projection evidence invalidates unique and all-Exposure deletions while retaining history', () => {
  const events = [exposure('exposure-1', 1, ['source-1']), exposure('exposure-2', 2, ['source-1', 'source-2'])];
  const aggregation = normalizeParticipantAggregation({aggregation_id: 'aggregation-delete-cases', subject_id: 'subject-1', mechanism_key: 'fertilization', cycle_id: 'cycle-delete-cases', timing_instance_id: 'timing-delete-cases', reference_story_time: {day_index: 1}, aggregation_story_time: {day_index: 18}, elapsed_story_days: 17, effective_min_story_days: 14, effective_max_story_days: 42, sampled_individual_offset_story_days: 0, config_snapshot: config, accepted_exposure_event_ids: ['exposure-1', 'exposure-2'], source_basis_refs: {}, created_at_floor_version: version});
  const evidence = buildParticipantAggregationEvidence({aggregation, events, subjectId: 'subject-1'});
  const view = {projection_id: 'projection-delete-cases', subject_id: 'subject-1', aggregation_evidence: evidence, context_visible: true};
  const uniqueRemaining = filterProjectionViewsByAggregationEvidence({views: {all: [view]}, aggregations: [aggregation], events: [events[1]]}).all[0];
  assert.equal(uniqueRemaining.context_visible, false);
  assert.equal(uniqueRemaining.aggregation_evidence_invalid, true);
  const noneRemaining = filterProjectionViewsByAggregationEvidence({views: {all: [view]}, aggregations: [aggregation], events: []}).all[0];
  assert.equal(noneRemaining.context_visible, false);
  assert.equal(noneRemaining.aggregation_evidence_invalid, true);
  assert.equal(noneRemaining.projection_id, view.projection_id);
});

test('projection evidence is invalid when its persisted aggregation is absent from current readback', () => {
  const aggregation = normalizeParticipantAggregation({aggregation_id: 'aggregation-missing', subject_id: 'subject-1', mechanism_key: 'fertilization', cycle_id: 'cycle-missing', timing_instance_id: 'timing-missing', reference_story_time: {day_index: 1}, aggregation_story_time: {day_index: 18}, elapsed_story_days: 17, effective_min_story_days: 14, effective_max_story_days: 42, sampled_individual_offset_story_days: 0, config_snapshot: config, accepted_exposure_event_ids: ['exposure-1'], source_basis_refs: {}, created_at_floor_version: version});
  const view = {projection_id: 'projection-missing-aggregation', subject_id: 'subject-1', aggregation_evidence: buildParticipantAggregationEvidence({aggregation, events: [exposure('exposure-1', 1)], subjectId: 'subject-1'}), context_visible: true};
  const result = filterProjectionViewsByAggregationEvidence({views: {all: [view]}, aggregations: [], events: [exposure('exposure-1', 1)]}).all[0];
  assert.equal(result.context_visible, false);
  assert.equal(result.aggregation_evidence_invalid, true);
});

test('aggregation evidence construction rejects accepted IDs absent from the current subject-local Event snapshot', () => {
  const aggregation = normalizeParticipantAggregation({aggregation_id: 'aggregation-current-events', subject_id: 'subject-1', mechanism_key: 'fertilization', cycle_id: 'cycle-current-events', timing_instance_id: 'timing-current-events', reference_story_time: {day_index: 1}, aggregation_story_time: {day_index: 18}, elapsed_story_days: 17, effective_min_story_days: 14, effective_max_story_days: 42, sampled_individual_offset_story_days: 0, config_snapshot: config, accepted_exposure_event_ids: ['missing-exposure'], source_basis_refs: {}, created_at_floor_version: version});
  assert.equal(buildParticipantAggregationEvidence({aggregation, events: [], subjectId: 'subject-1'}), null);
});
test('legacy projections without aggregation evidence remain visible while invalid new-path projections are hidden', () => {
  const legacy = {projection_id: 'legacy', subject_id: 'subject-1', context_visible: true};
  const invalidNew = {projection_id: 'new', subject_id: 'subject-1', aggregation_path: 'participant_aggregation', context_visible: true};
  const result = filterProjectionViewsByAggregationEvidence({views: {all: [legacy, invalidNew]}, aggregations: [], events: []});
  assert.equal(result.all[0].context_visible, true);
  assert.equal(result.all[1].context_visible, false);
  assert.equal(result.all[1].aggregation_evidence_invalid, true);
});

test('aggregation success survives Projection AI failure and retry does not resample or duplicate', async () => {
  let floor = {...emptyFloor(), floor_version: version};
  const store = {
    getActiveSwipeId: () => 0,
    getFloorOwner: () => ({owner_type: 'character', active_swipe_id: 0}),
    getFloor: () => structuredClone(floor),
    getCurrentChatOwnerSnapshot: () => ({messages: [{}, {}]}),
    async saveFloor(_index, _swipe, next) { floor = structuredClone(next); },
  };
  const persistence = createParticipantAggregationPersistence({store, resolveCurrentFloorVersion: async () => version});
  const instance = timing();
  const aggregation = normalizeParticipantAggregation({aggregation_id: 'aggregation-ai-retry', subject_id: instance.subject_id, mechanism_key: instance.mechanism_key, cycle_id: instance.cycle_id, timing_instance_id: instance.timing_instance_id, reference_story_time: instance.reference_story_time, aggregation_story_time: {day_index: 18}, elapsed_story_days: 17, effective_min_story_days: instance.effective_min_story_days, effective_max_story_days: instance.effective_max_story_days, sampled_individual_offset_story_days: instance.sampled_individual_offset_story_days, config_snapshot: instance.config_snapshot, accepted_exposure_event_ids: ['exposure-1'], source_basis_refs: instance.source_basis_refs, created_at_floor_version: version});
  await persistence.appendAggregation({chatId: version.chat_id, ownerFloor: {message_index: 0}, floorVersion: version, aggregation});
  await assert.rejects(Promise.reject(new Error('projection-ai-failed')), /projection-ai-failed/);
  const afterFailure = await persistence.getParticipantAggregations({chatId: version.chat_id, endpointFloor: version.floor});
  assert.equal(afterFailure.creations.length, 1);
  assert.equal(afterFailure.creations[0].sampled_individual_offset_story_days, aggregation.sampled_individual_offset_story_days);
  assert.equal((await persistence.appendAggregation({chatId: version.chat_id, ownerFloor: {message_index: 0}, floorVersion: version, aggregation})).status, 'deduped');
  assert.equal((await persistence.getParticipantAggregations({chatId: version.chat_id, endpointFloor: version.floor})).creations.length, 1);
});

test('participant aggregation persistence is Floor-owned, swipe/version guarded, bounded, and deduped', async () => {
  let floor = {...emptyFloor(), floor_version: version};
  let activeSwipe = 0;
  const store = {
    getActiveSwipeId: () => activeSwipe,
    getFloorOwner: () => ({owner_type: 'character', active_swipe_id: 0}),
    getFloor: () => structuredClone(floor),
    getCurrentChatOwnerSnapshot: () => ({messages: [{}, {}]}),
    async saveFloor(_index, _swipe, next) { floor = structuredClone(next); },
  };
  const persistence = createParticipantAggregationPersistence({store, resolveCurrentFloorVersion: async () => version});
  const instance = timing();
  const aggregation = normalizeParticipantAggregation({aggregation_id: 'aggregation-1', subject_id: instance.subject_id, mechanism_key: instance.mechanism_key, cycle_id: instance.cycle_id, timing_instance_id: instance.timing_instance_id, reference_story_time: instance.reference_story_time, aggregation_story_time: {day_index: 18}, elapsed_story_days: 17, effective_min_story_days: instance.effective_min_story_days, effective_max_story_days: instance.effective_max_story_days, sampled_individual_offset_story_days: instance.sampled_individual_offset_story_days, config_snapshot: instance.config_snapshot, accepted_exposure_event_ids: ['exposure-1'], source_basis_refs: instance.source_basis_refs, created_at_floor_version: version});
  assert.equal((await persistence.appendAggregation({chatId: version.chat_id, ownerFloor: {message_index: 0}, floorVersion: version, aggregation})).status, 'appended');
  assert.equal((await persistence.appendAggregation({chatId: version.chat_id, ownerFloor: {message_index: 0}, floorVersion: version, aggregation})).status, 'deduped');
  assert.equal((await persistence.getParticipantAggregations({chatId: version.chat_id, endpointFloor: 1})).creations.length, 1);
  activeSwipe = 1;
  await assert.rejects(persistence.appendAggregation({chatId: version.chat_id, ownerFloor: {message_index: 0}, floorVersion: version, aggregation}), error => error.code === 'FLOOR_SWIPE_STALE');
});
