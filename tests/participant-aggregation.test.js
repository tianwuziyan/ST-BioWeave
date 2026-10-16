import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveProjectionTimingInstance} from '../core/projection-timing.js';
import {buildParticipantAggregationEvidence, deriveParticipantList, emptyParticipantAggregationSnapshot, filterProjectionViewsByAggregationEvidence, normalizeParticipantAggregation, normalizeParticipantAggregationSnapshot, resolveParticipantAggregationTrigger, upsertParticipantAggregation} from '../core/participant-aggregation.js';
import {createParticipantAggregationPersistence} from '../storage/participant-aggregation.js';
import {emptyFloor} from '../storage/schema.js';

const version = {chat_id: 'chat-aggregation', message_id: 'message-1', floor: 1, swipe_id: 0, content_hash: 'hash-1', message_version: 'v1'};
const config = {schema_version: 1, config_version: 1, base_min_story_days: 14, base_max_story_days: 42, variance_ratio: 0.1, variance_cap_story_days: 3, total_adjustment_cap_story_days: 3};
const exposure = (event_id, day, counterpart_ids = ['source-1']) => ({event_id, type: 'sexual_activity', status: 'confirmed', story_time: {day_index: day}, pregnancy_relevance: {relevant: true, possible_conception: true, gestational_subject_ids: ['subject-1'], counterpart_ids, reproductive_mechanism: {kind: 'fertilization'}}});

function timing() {
  return resolveProjectionTimingInstance({chatId: version.chat_id, subjectId: 'subject-1', mechanismKey: 'fertilization', firstEvent: exposure('exposure-1', 1), config, floorVersion: version, rng: () => 1});
}

function timingFor(floorVersion, eventId, subjectId = 'subject-1') {
  return resolveProjectionTimingInstance({
    chatId: floorVersion.chat_id,
    subjectId,
    mechanismKey: 'fertilization',
    firstEvent: exposure(eventId, 1),
    config,
    floorVersion,
    rng: () => 0.5,
  });
}

function aggregationFor(floorVersion, aggregationId, eventId, subjectId = 'subject-1') {
  const instance = timingFor(floorVersion, eventId, subjectId);
  return normalizeParticipantAggregation({
    aggregation_id: aggregationId,
    subject_id: subjectId,
    mechanism_key: instance.mechanism_key,
    cycle_id: instance.cycle_id,
    timing_instance_id: instance.timing_instance_id,
    reference_story_time: instance.reference_story_time,
    aggregation_story_time: {day_index: 18},
    elapsed_story_days: 17,
    effective_min_story_days: instance.effective_min_story_days,
    effective_max_story_days: instance.effective_max_story_days,
    sampled_individual_offset_story_days: instance.sampled_individual_offset_story_days,
    config_snapshot: instance.config_snapshot,
    accepted_exposure_event_ids: [eventId],
    source_basis_refs: instance.source_basis_refs,
    created_at_floor_version: floorVersion,
  });
}

function historyFixture(entries, {activeSwipes = {}} = {}) {
  const floors = new Map(entries.map(({index, swipeId = 0, floor}) => [`${index}:${swipeId}`, structuredClone(floor)]));
  const messages = Array.from({length: Math.max(0, ...entries.map(entry => entry.index)) + 1}, () => ({}));
  const currentVersions = new Map(entries.map(({index, floor}) => [index, structuredClone(floor.floor_version)]));
  const store = {
    getActiveSwipeId: index => activeSwipes[index] ?? 0,
    getFloorOwner: index => ({owner_type: 'character', active_swipe_id: activeSwipes[index] ?? 0}),
    getFloor: (index, swipeId = 0) => structuredClone(floors.get(`${index}:${swipeId}`) ?? emptyFloor()),
    getCurrentChatOwnerSnapshot: () => ({messages}),
    async saveFloor(index, swipeId, next) { floors.set(`${index}:${swipeId}`, structuredClone(next)); },
  };
  return {
    store,
    floors,
    currentVersions,
    resolveCurrentFloorVersion: async ({ownerFloor, floorVersion}) => {
      const current = currentVersions.get(ownerFloor?.message_index);
      return current ? structuredClone(current) : structuredClone(floorVersion);
    },
  };
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
  const first = upsertParticipantAggregation(record, {snapshot: emptyParticipantAggregationSnapshot(), expectedChatId: version.chat_id});
  const second = upsertParticipantAggregation(record, {snapshot: first.snapshot, expectedChatId: version.chat_id});
  assert.equal(first.status, 'created');
  assert.equal(second.status, 'deduped');
  assert.ok(Math.abs(first.snapshot.items[0].sampled_individual_offset_story_days - 2.8) < 1e-9);
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
  await persistence.upsertAggregation({chatId: version.chat_id, ownerFloor: {message_index: 0}, floorVersion: version, aggregation});
  await assert.rejects(Promise.reject(new Error('projection-ai-failed')), /projection-ai-failed/);
  const afterFailure = await persistence.getParticipantAggregations({chatId: version.chat_id, endpointFloor: version.floor});
  assert.equal(afterFailure.items.length, 1);
  assert.equal(afterFailure.items[0].sampled_individual_offset_story_days, aggregation.sampled_individual_offset_story_days);
  const deduped = await persistence.upsertAggregation({chatId: version.chat_id, ownerFloor: {message_index: 0}, floorVersion: version, aggregation});
  assert.equal(deduped.status, 'deduped');
  assert.equal(deduped.noWrite, true);
  assert.equal((await persistence.getParticipantAggregations({chatId: version.chat_id, endpointFloor: version.floor})).items.length, 1);
});

test('participant aggregation persistence is Floor-owned, swipe/version guarded, bounded, and deduped', async () => {
  let floor = {...emptyFloor(), floor_version: version};
  let saveCount = 0;
  let activeSwipe = 0;
  const store = {
    getActiveSwipeId: () => activeSwipe,
    getFloorOwner: () => ({owner_type: 'character', active_swipe_id: 0}),
    getFloor: () => structuredClone(floor),
    getCurrentChatOwnerSnapshot: () => ({messages: [{}, {}]}),
    async saveFloor(_index, _swipe, next) { saveCount += 1; floor = structuredClone(next); },
  };
  const persistence = createParticipantAggregationPersistence({store, resolveCurrentFloorVersion: async () => version});
  const instance = timing();
  const aggregation = normalizeParticipantAggregation({aggregation_id: 'aggregation-1', subject_id: instance.subject_id, mechanism_key: instance.mechanism_key, cycle_id: instance.cycle_id, timing_instance_id: instance.timing_instance_id, reference_story_time: instance.reference_story_time, aggregation_story_time: {day_index: 18}, elapsed_story_days: 17, effective_min_story_days: instance.effective_min_story_days, effective_max_story_days: instance.effective_max_story_days, sampled_individual_offset_story_days: instance.sampled_individual_offset_story_days, config_snapshot: instance.config_snapshot, accepted_exposure_event_ids: ['exposure-1'], source_basis_refs: instance.source_basis_refs, created_at_floor_version: version});
  assert.equal((await persistence.upsertAggregation({chatId: version.chat_id, ownerFloor: {message_index: 0}, floorVersion: version, aggregation})).status, 'created');
  assert.equal((await persistence.upsertAggregation({chatId: version.chat_id, ownerFloor: {message_index: 0}, floorVersion: version, aggregation})).status, 'deduped');
  assert.equal(saveCount, 1);
  assert.equal((await persistence.getParticipantAggregations({chatId: version.chat_id, endpointFloor: 1})).items.length, 1);
  activeSwipe = 1;
  await assert.rejects(persistence.upsertAggregation({chatId: version.chat_id, ownerFloor: {message_index: 0}, floorVersion: version, aggregation}), error => error.code === 'FLOOR_SWIPE_STALE');
});

test('current owner aggregation metadata mismatch is repairable only for manual reevaluation', async () => {
  const oldVersion = {...version, message_id: 72, floor: 72, content_hash: 'old-content-hash', message_version: 'v1:host-revision-72'};
  const currentVersion = {...oldVersion, content_hash: 'current-content-hash', message_version: 'v1:current-edit-start-72'};
  const aggregation = aggregationFor(oldVersion, 'aggregation-current-owner-repair', 'exposure-current-owner-repair');
  const fixture = historyFixture([
    {index: 0, floor: {...emptyFloor(), floor_version: oldVersion, participant_aggregation_snapshot: {schema_version: 1, items: [aggregation]}}},
  ]);
  fixture.currentVersions.set(0, currentVersion);
  const persistence = createParticipantAggregationPersistence({store: fixture.store, resolveCurrentFloorVersion: fixture.resolveCurrentFloorVersion});

  const currentRead = await persistence.getParticipantAggregations({chatId: version.chat_id, endpointFloor: 72, endpointIndex: 0, editStartFloorVersion: currentVersion});
  assert.deepEqual(currentRead.items.map(item => item.aggregation_id), [aggregation.aggregation_id]);
  assert.equal(currentRead.floor_version.content_hash, currentVersion.content_hash);
  const otherAggregation = aggregationFor(oldVersion, 'aggregation-other-owner', 'exposure-other-owner');
  fixture.floors.get('0:0').participant_aggregation_snapshot.items.push(otherAggregation);
  await assert.rejects(
    persistence.removeAggregation({
      chatId: version.chat_id,
      ownerFloor: {message_index: 0, swipe_id: 0},
      floorVersion: currentVersion,
      aggregationId: aggregation.aggregation_id,
    }),
    error => error.code === 'FLOOR_VERSION_STALE' && error.version_classification === 'INTERNAL_OWNER_SLOT_MISMATCH',
  );

  const removed = await persistence.removeAggregation({
    chatId: version.chat_id,
    ownerFloor: {message_index: 0, swipe_id: 0},
    floorVersion: currentVersion,
    aggregationId: aggregation.aggregation_id,
    editStartFloorVersion: currentVersion,
    operation_type: 'manual-timing-aggregation-reevaluation',
  });
  assert.equal(removed.status, 'removed');
  const afterRemoval = await persistence.getParticipantAggregations({chatId: version.chat_id, endpointFloor: 72, endpointIndex: 0, editStartFloorVersion: currentVersion});
  assert.deepEqual(afterRemoval.items.map(item => item.aggregation_id), [otherAggregation.aggregation_id]);
  assert.deepEqual(fixture.floors.get('0:0').floor_version, currentVersion);
});

test('Aggregation snapshots replace a complete Floor collection, inherit absent roots, and preserve same IDs with new content', async () => {
  const v20 = {...version, message_id: 'message-20', floor: 20, content_hash: 'hash-20', message_version: 'v1:20'};
  const v26 = {...version, message_id: 'message-26', floor: 26, content_hash: 'hash-26', message_version: 'v1:26'};
  const v30 = {...version, message_id: 'message-30', floor: 30, content_hash: 'hash-30', message_version: 'v1:30'};
  const v40 = {...version, message_id: 'message-40', floor: 40, content_hash: 'hash-40', message_version: 'v1:40'};
  const a20 = aggregationFor(v20, 'aggregation-a', 'exposure-a');
  const b20 = aggregationFor(v20, 'aggregation-b', 'exposure-b');
  const fixture = historyFixture([
    {index: 0, floor: {...emptyFloor(), floor_version: v20, participant_aggregation_snapshot: {schema_version: 1, items: [a20, b20]}}},
    {index: 1, floor: {floor_version: v26}},
    {index: 2, floor: {floor_version: v30}},
    {index: 3, floor: {...emptyFloor(), floor_version: v40, participant_aggregation_snapshot: {schema_version: 1, items: [aggregationFor(v40, 'aggregation-future', 'exposure-future')]}}},
  ]);
  const persistence = createParticipantAggregationPersistence({store: fixture.store, resolveCurrentFloorVersion: fixture.resolveCurrentFloorVersion});

  const beforeModify = await persistence.getParticipantAggregations({chatId: version.chat_id, endpointFloor: 23});
  assert.deepEqual(beforeModify.items.map(item => item.aggregation_id), ['aggregation-a', 'aggregation-b']);
  const inherited = await persistence.getParticipantAggregations({chatId: version.chat_id, endpointFloor: 28});
  assert.deepEqual(inherited.items.map(item => item.aggregation_id), ['aggregation-a', 'aggregation-b']);
  const futureBounded = await persistence.getParticipantAggregations({chatId: version.chat_id, endpointFloor: 32});
  assert.deepEqual(futureBounded.items.map(item => item.aggregation_id), ['aggregation-a', 'aggregation-b']);

  const a26 = {...a20, sampled_individual_offset_story_days: 1, created_at_floor_version: v26};
  await persistence.upsertAggregation({chatId: v26.chat_id, ownerFloor: {message_index: 1, swipe_id: 0}, floorVersion: v26, aggregation: a26});
  assert.deepEqual(fixture.floors.get('1:0').participant_aggregation_snapshot.items.map(item => item.aggregation_id), ['aggregation-a', 'aggregation-b']);
  assert.equal((await persistence.getParticipantAggregations({chatId: version.chat_id, endpointFloor: 28})).items.find(item => item.aggregation_id === 'aggregation-a').sampled_individual_offset_story_days, 1);

  await persistence.removeAggregation({chatId: v30.chat_id, ownerFloor: {message_index: 2, swipe_id: 0}, floorVersion: v30, aggregationId: b20.aggregation_id});
  const afterDelete = await persistence.getParticipantAggregations({chatId: version.chat_id, endpointFloor: 32});
  assert.deepEqual(afterDelete.items.map(item => item.aggregation_id), ['aggregation-a']);
});

test('Aggregation explicit empty snapshot blocks inheritance and old timeline fields are ignored', async () => {
  const v20 = {...version, message_id: 'message-20', floor: 20, content_hash: 'hash-20', message_version: 'v1:20'};
  const v26 = {...version, message_id: 'message-26', floor: 26, content_hash: 'hash-26', message_version: 'v1:26'};
  const aggregation = aggregationFor(v20, 'aggregation-history', 'exposure-history');
  const fixture = historyFixture([
    {index: 0, floor: {...emptyFloor(), floor_version: v20, participant_aggregation_snapshot: {schema_version: 1, items: [aggregation]}}},
    {index: 1, floor: {floor_version: v26, participant_aggregation_snapshot: {schema_version: 1, items: []}}},
  ]);
  const persistence = createParticipantAggregationPersistence({store: fixture.store, resolveCurrentFloorVersion: fixture.resolveCurrentFloorVersion});
  const result = await persistence.getParticipantAggregations({chatId: version.chat_id, endpointFloor: 28});
  assert.deepEqual(result.items, []);
  assert.equal(result.source_index, 1);
  const normalized = normalizeParticipantAggregationSnapshot({creations: [aggregation], lifecycle_records: []}, {expectedChatId: version.chat_id});
  assert.deepEqual(normalized.snapshot.items, []);
  assert.equal(normalized.invalid, true);
});

test('Aggregation historical candidates require active Swipe and recomputed current Floor Version', async () => {
  const v20 = {...version, message_id: 'message-20', floor: 20, content_hash: 'hash-20', message_version: 'v1:20'};
  const v26 = {...version, message_id: 'message-26', floor: 26, content_hash: 'hash-26', message_version: 'v1:26'};
  const valid = aggregationFor(v20, 'aggregation-valid', 'exposure-valid');
  const stale = aggregationFor(v26, 'aggregation-stale', 'exposure-stale');
  const fixture = historyFixture([
    {index: 0, floor: {...emptyFloor(), floor_version: v20, participant_aggregation_snapshot: {schema_version: 1, items: [valid]}}},
    {index: 1, floor: {...emptyFloor(), floor_version: v26, participant_aggregation_snapshot: {schema_version: 1, items: [stale]}}},
    {index: 2, swipeId: 0, floor: {...emptyFloor(), floor_version: {...v26, message_id: 'message-30', floor: 30, content_hash: 'hash-30', message_version: 'v1:30'}, participant_aggregation_snapshot: {schema_version: 1, items: [aggregationFor(v26, 'aggregation-inactive', 'exposure-inactive')]}}},
  ], {activeSwipes: {2: 1}});
  fixture.currentVersions.set(1, {...v26, content_hash: 'recomputed-current-hash', message_version: 'v1:current'});
  const persistence = createParticipantAggregationPersistence({store: fixture.store, resolveCurrentFloorVersion: fixture.resolveCurrentFloorVersion});
  const result = await persistence.getParticipantAggregations({chatId: version.chat_id, endpointFloor: 40});
  assert.deepEqual(result.items.map(item => item.aggregation_id), ['aggregation-valid']);
  assert.equal(result.source_index, 0);
});

test('Aggregation invalid snapshot roots are skipped instead of becoming explicit empty state', async () => {
  const v20 = {...version, message_id: 'message-20', floor: 20, content_hash: 'hash-20', message_version: 'v1:20'};
  const v26 = {...version, message_id: 'message-26', floor: 26, content_hash: 'hash-26', message_version: 'v1:26'};
  const valid = aggregationFor(v20, 'aggregation-valid-root', 'exposure-valid-root');
  const fixture = historyFixture([
    {index: 0, floor: {...emptyFloor(), floor_version: v20, participant_aggregation_snapshot: {schema_version: 1, items: [valid]}}},
    {index: 1, floor: {...emptyFloor(), floor_version: v26, participant_aggregation_snapshot: {schema_version: 1, creations: [valid]}}},
  ]);
  const persistence = createParticipantAggregationPersistence({store: fixture.store, resolveCurrentFloorVersion: fixture.resolveCurrentFloorVersion});
  const result = await persistence.getParticipantAggregations({chatId: version.chat_id, endpointFloor: 28});
  assert.deepEqual(result.items.map(item => item.aggregation_id), [valid.aggregation_id]);
  assert.equal(result.source_index, 0);
});

test('Aggregation roots containing future-provenance items do not pollute an earlier Floor read', async () => {
  const v20 = {...version, message_id: 'message-20', floor: 20, content_hash: 'hash-20', message_version: 'v1:20'};
  const v40 = {...version, message_id: 'message-40', floor: 40, content_hash: 'hash-40', message_version: 'v1:40'};
  const future = aggregationFor(v40, 'aggregation-future-item', 'exposure-future-item');
  const fixture = historyFixture([
    {index: 0, floor: {...emptyFloor(), floor_version: v20, participant_aggregation_snapshot: {schema_version: 1, items: [future]}}},
  ]);
  const persistence = createParticipantAggregationPersistence({store: fixture.store, resolveCurrentFloorVersion: fixture.resolveCurrentFloorVersion});
  const result = await persistence.getParticipantAggregations({chatId: version.chat_id, endpointFloor: 20});
  assert.deepEqual(result.items, []);
  assert.equal(result.source_index, null);
  await assert.rejects(
    persistence.upsertAggregation({chatId: v20.chat_id, ownerFloor: {message_index: 0, swipe_id: 0}, floorVersion: v20, aggregation: future}),
    error => error.code === 'PARTICIPANT_AGGREGATION_SNAPSHOT_INVALID',
  );
});

test('Aggregation same-Floor updates preserve siblings when queued from stale pre-queue reads', async () => {
  const v20 = {...version, message_id: 'message-20', floor: 20, content_hash: 'hash-20', message_version: 'v1:20'};
  const v26 = {...version, message_id: 'message-26', floor: 26, content_hash: 'hash-26', message_version: 'v1:26'};
  const a20 = aggregationFor(v20, 'aggregation-a', 'exposure-a');
  const b20 = aggregationFor(v20, 'aggregation-b', 'exposure-b');
  const fixture = historyFixture([
    {index: 0, floor: {...emptyFloor(), floor_version: v20, participant_aggregation_snapshot: {schema_version: 1, items: [a20, b20]}}},
    {index: 1, floor: {floor_version: v26}},
  ]);
  const persistence = createParticipantAggregationPersistence({store: fixture.store, resolveCurrentFloorVersion: fixture.resolveCurrentFloorVersion});
  const a26 = {...a20, sampled_individual_offset_story_days: 1, created_at_floor_version: v26};
  const b26 = {...b20, sampled_individual_offset_story_days: -1, created_at_floor_version: v26};
  await Promise.all([
    persistence.upsertAggregation({chatId: v26.chat_id, ownerFloor: {message_index: 1, swipe_id: 0}, floorVersion: v26, aggregation: a26}),
    persistence.upsertAggregation({chatId: v26.chat_id, ownerFloor: {message_index: 1, swipe_id: 0}, floorVersion: v26, aggregation: b26}),
  ]);
  const saved = fixture.floors.get('1:0').participant_aggregation_snapshot.items;
  assert.equal(saved.length, 2);
  assert.equal(saved.find(item => item.aggregation_id === a26.aggregation_id).sampled_individual_offset_story_days, 1);
  assert.equal(saved.find(item => item.aggregation_id === b26.aggregation_id).sampled_individual_offset_story_days, -1);
});

test('Aggregation storage exposes complete snapshot replacement and skips an identical replacement', async () => {
  const v20 = {...version, message_id: 'message-20', floor: 20, content_hash: 'hash-20', message_version: 'v1:20'};
  const v26 = {...version, message_id: 'message-26', floor: 26, content_hash: 'hash-26', message_version: 'v1:26'};
  const a20 = aggregationFor(v20, 'aggregation-a', 'exposure-a');
  const b20 = aggregationFor(v20, 'aggregation-b', 'exposure-b');
  const fixture = historyFixture([
    {index: 0, floor: {...emptyFloor(), floor_version: v20, participant_aggregation_snapshot: {schema_version: 1, items: [a20]}}},
    {index: 1, floor: {floor_version: v26}},
  ]);
  const persistence = createParticipantAggregationPersistence({store: fixture.store, resolveCurrentFloorVersion: fixture.resolveCurrentFloorVersion});

  const replaced = await persistence.saveParticipantAggregationSnapshot({
    chatId: v26.chat_id,
    ownerFloor: {message_index: 1, swipe_id: 0},
    floorVersion: v26,
    items: [a20, b20],
  });
  assert.equal(replaced.status, 'replaced');
  assert.deepEqual(fixture.floors.get('1:0').participant_aggregation_snapshot.items.map(item => item.aggregation_id), [a20.aggregation_id, b20.aggregation_id].sort());

  const deduped = await persistence.saveParticipantAggregationSnapshot({
    chatId: v26.chat_id,
    ownerFloor: {message_index: 1, swipe_id: 0},
    floorVersion: v26,
    items: [a20, b20],
  });
  assert.equal(deduped.status, 'deduped');
  assert.equal(deduped.noWrite, true);
});
