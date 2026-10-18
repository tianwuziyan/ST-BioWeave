import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyFloor} from '../storage/schema.js';
import {appendPregnancyLifecycleFact, buildCandidateRecord, normalizePregnancyLifecycleFact, pregnancyIdentityMatches, validatePregnancyLifecycleFact} from '../core/pregnancy-lifecycle.js';
import {createPregnancyLifecyclePersistence} from '../storage/pregnancy-lifecycle.js';
import {createFloorPersistenceCoordinator} from '../runtime/floor-persistence.js';

const version = {chat_id: 'chat-lifecycle', message_id: 'message-1', floor: 1, swipe_id: 0, content_hash: 'hash-1', message_version: 'v1'};
const exposure = (event_id, subject_id = 'subject-1') => ({event_id, type: 'sexual_activity', status: 'confirmed', pregnancy_relevance: {relevant: true, gestational_subject_ids: [subject_id], counterpart_ids: ['source-1']}});

function fixture(events = [exposure('e-c1')]) {
  let floor = {...emptyFloor(), floor_version: version, events};
  const store = {
    getActiveSwipeId: () => 0,
    getFloorOwner: () => ({owner_type: 'character', active_swipe_id: 0}),
    getFloor: () => structuredClone(floor),
    getCurrentChatOwnerSnapshot: () => ({messages: [{}]}),
    async saveFloor(_index, _swipe, next) { floor = structuredClone(next); },
  };
  return {store, getFloor: () => floor, persistence: createPregnancyLifecyclePersistence({store, resolveCurrentFloorVersion: async () => version})};
}

test('not_pregnant keeps nullable pregnancy identity and requires a cycle', () => {
  const fact = normalizePregnancyLifecycleFact({subject_id: 'subject-1', cycle_id: 'c1', status: 'not_pregnant', pregnancy_ref: {kind: 'new'}});
  assert.equal(fact.pregnancy_id, null);
  assert.equal(validatePregnancyLifecycleFact(fact).ok, false);
  assert.equal(validatePregnancyLifecycleFact({...fact, source_event_id: 'fact-1'}).ok, true);
});

test('pregnancy lifecycle terminal conflicts stay isolated by concrete pregnancy identity', () => {
  const first = appendPregnancyLifecycleFact(null, {fact_id: 'fact-p1', subject_id: 'subject-1', pregnancy_id: 'pregnancy-1', cycle_id: 'c1', status: 'delivery', source_event_id: 'event-p1'});
  const second = appendPregnancyLifecycleFact(first.timeline, {fact_id: 'fact-p2', subject_id: 'subject-1', pregnancy_id: 'pregnancy-2', cycle_id: 'c1', status: 'delivery', source_event_id: 'event-p2'});
  assert.equal(second.status, 'appended');
  assert.equal(pregnancyIdentityMatches({subjectId: 'subject-1', pregnancyId: null, candidateSubjectId: 'subject-1', candidatePregnancyId: 'pregnancy-1', candidateStatus: 'delivery'}), false);
  assert.equal(pregnancyIdentityMatches({subjectId: 'subject-1', pregnancyId: null, candidateSubjectId: 'subject-1', candidatePregnancyId: 'pregnancy-1', candidateStatus: 'pregnancy_confirmation', allowObservationPromotion: true}), true);
});

test('terminal lifecycle archives evidence, deletes only accepted current-cycle Events, preserves empty snapshot, and releases once', async () => {
  const {persistence, getFloor} = fixture([exposure('e-c1'), {event_id: 'other', type: 'medical_event', status: 'confirmed'}]);
  const candidate = buildCandidateRecord({subjectId: 'subject-1', pregnancyId: 'preg-1', cycleId: 'c1', candidates: [{participant_id: 'source-1'}], sourceExposureEventIds: ['e-c1'], participantMapping: [{participant_id: 'source-1', exposure_event_ids: ['e-c1']}], projectionEvidence: [{projection_id: 'p1'}]});
  await persistence.saveCandidateRecord({ownerFloor: {message_index: 0}, floorVersion: version, candidateRecord: candidate});
  const result = await persistence.archiveAndRelease({ownerFloor: {message_index: 0}, floorVersion: version, fact: {fact_id: 'fact-delivery', subject_id: 'subject-1', pregnancy_id: 'preg-1', cycle_id: 'c1', status: 'delivery', source_event_id: 'fact-delivery'}, aggregation: {aggregation_id: 'agg-1', accepted_exposure_event_ids: ['e-c1']}, candidateRecord: candidate, operationKey: 'op-c1'});
  assert.deepEqual(getFloor().events.map(item => item.event_id), ['other']);
  assert.equal(result.deleted_event_ids[0], 'e-c1');
  const retry = await persistence.archiveAndRelease({ownerFloor: {message_index: 0}, floorVersion: version, fact: {fact_id: 'fact-delivery', subject_id: 'subject-1', pregnancy_id: 'preg-1', cycle_id: 'c1', status: 'delivery', source_event_id: 'fact-delivery'}, aggregation: {aggregation_id: 'agg-1', accepted_exposure_event_ids: ['e-c1']}, candidateRecord: candidate, operationKey: 'op-c1'});
  assert.equal(retry.status, 'deduped');
});

test('candidate record is independently readable after Exposure deletion and can be cleaned after father confirmation', async () => {
  const {persistence, getFloor} = fixture([exposure('e-c1')]);
  const candidate = buildCandidateRecord({subjectId: 'subject-1', pregnancyId: 'preg-1', cycleId: 'c1', candidates: [{participant_id: 'source-1'}], sourceExposureEventIds: ['e-c1']});
  await persistence.saveCandidateRecord({ownerFloor: {message_index: 0}, floorVersion: version, candidateRecord: candidate});
  await persistence.archiveAndRelease({ownerFloor: {message_index: 0}, floorVersion: version, fact: {fact_id: 'fact-delivery-2', subject_id: 'subject-1', pregnancy_id: 'preg-1', cycle_id: 'c1', status: 'delivery', source_event_id: 'fact-delivery-2'}, aggregation: {accepted_exposure_event_ids: ['e-c1']}, candidateRecord: candidate, operationKey: 'op-c1-2'});
  const preserved = await persistence.getTimeline({chatId: version.chat_id});
  assert.equal(preserved.candidate_records.length, 1);
  await persistence.confirmFather({ownerFloor: {message_index: 0}, floorVersion: version, subjectId: 'subject-1', pregnancyId: 'preg-1', cycleId: 'c1', confirmedFactId: 'father-fact'});
  const cleaned = await persistence.getTimeline({chatId: version.chat_id});
  assert.equal(cleaned.candidate_records.length, 0);
  assert.equal(getFloor().events.length, 0);
});

test('stale Floor versions fail closed before lifecycle writes', async () => {
  const {persistence} = fixture();
  await assert.rejects(persistence.archiveAndRelease({ownerFloor: {message_index: 0}, floorVersion: {...version, content_hash: 'stale'}, fact: {fact_id: 'fact-stale', subject_id: 'subject-1', pregnancy_id: null, cycle_id: 'c1', status: 'not_pregnant', source_event_id: 'fact-stale'}, operationKey: 'op-stale'}), error => error.code === 'FLOOR_VERSION_STALE');
});

test('lifecycle deletion preserves an unrelated Event queued on the same Floor Version', async () => {
  const {store, getFloor} = fixture([exposure('e-c1')]);
  const floorPersistence = createFloorPersistenceCoordinator({store, enabledResolver: () => true});
  const persistence = createPregnancyLifecyclePersistence({store, floorPersistence, resolveCurrentFloorVersion: async () => version});
  const aggregation = {aggregation_id: 'agg-c1-race', accepted_exposure_event_ids: ['e-c1']};
  const unrelated = {event_id: 'e-unrelated', type: 'medical_event', status: 'confirmed'};
  const originalCommit = floorPersistence.commitFloorPatch.bind(floorPersistence);
  let unrelatedWrite = null;
  let injected = false;
  floorPersistence.commitFloorPatch = input => {
    if (!injected && input.operation_type === 'pregnancy-exposure-delete-patch') {
      injected = true;
      unrelatedWrite = originalCommit({
        owner: 'event',
        chatId: version.chat_id,
        ownerFloor: {message_index: 0, message_id: version.message_id},
        swipeId: version.swipe_id,
        floorVersion: version,
        patch: {events: [exposure('e-c1'), unrelated]},
        operation_type: 'unrelated-event-write',
      });
    }
    return originalCommit(input);
  };
  const lifecycleRelease = persistence.archiveAndRelease({
    ownerFloor: {message_index: 0},
    floorVersion: version,
    fact: {fact_id: 'fact-race', subject_id: 'subject-1', pregnancy_id: 'preg-1', cycle_id: 'c1', status: 'delivery', source_event_id: 'fact-race'},
    aggregation,
    operationKey: 'op-race',
  });
  await Promise.all([unrelatedWrite ?? Promise.resolve(), lifecycleRelease]);
  assert.deepEqual(getFloor().events.map(item => item.event_id), ['e-unrelated']);
});

test('archive remains recoverable when current Floor Exposure deletion fails', async () => {
  const {store, getFloor} = fixture([exposure('e-c1')]);
  const basePersistence = createFloorPersistenceCoordinator({store, enabledResolver: () => true});
  const originalCommit = basePersistence.commitFloorPatch.bind(basePersistence);
  const floorPersistence = {commitFloorPatch(input) {
    if (input.operation_type === 'pregnancy-exposure-delete-patch') throw new Error('SIMULATED_EXPOSURE_EXIT_FAILURE');
    return originalCommit(input);
  }};
  const persistence = createPregnancyLifecyclePersistence({store, floorPersistence, resolveCurrentFloorVersion: async () => version});
  await assert.rejects(persistence.archiveAndRelease({
    ownerFloor: {message_index: 0},
    floorVersion: version,
    fact: {fact_id: 'fact-archive-before-delete-failure', subject_id: 'subject-1', pregnancy_id: 'preg-1', cycle_id: 'c1', status: 'delivery', source_event_id: 'fact-archive-before-delete-failure'},
    aggregation: {accepted_exposure_event_ids: ['e-c1']},
    operationKey: 'op-archive-before-delete-failure',
  }), /SIMULATED_EXPOSURE_EXIT_FAILURE/);
  assert.equal(getFloor().events.some(item => item.event_id === 'e-c1'), true);
  assert.equal(getFloor().pregnancy_lifecycle_timeline.archives.length, 1);
  assert.equal(getFloor().pregnancy_lifecycle_timeline.release_records.some(item => item.action === 'cycle-lock-released'), false);
});

test('successful Exposure deletion retries release after a release failure without deleting C002', async () => {
  const {store, getFloor} = fixture([exposure('e-c1'), exposure('e-c2', 'subject-2')]);
  const basePersistence = createFloorPersistenceCoordinator({store, enabledResolver: () => true});
  const originalCommit = basePersistence.commitFloorPatch.bind(basePersistence);
  let failRelease = true;
  const floorPersistence = {commitFloorPatch(input) {
    if (failRelease && input.operation_type === 'pregnancy-cycle-release-patch') {
      failRelease = false;
      throw new Error('SIMULATED_RELEASE_FAILURE');
    }
    return originalCommit(input);
  }};
  const persistence = createPregnancyLifecyclePersistence({store, floorPersistence, resolveCurrentFloorVersion: async () => version});
  const request = {
    ownerFloor: {message_index: 0},
    floorVersion: version,
    fact: {fact_id: 'fact-delete-before-release-failure', subject_id: 'subject-1', pregnancy_id: 'preg-1', cycle_id: 'c1', status: 'delivery', source_event_id: 'fact-delete-before-release-failure'},
    aggregation: {accepted_exposure_event_ids: ['e-c1']},
    operationKey: 'op-delete-before-release-failure',
  };
  await assert.rejects(persistence.archiveAndRelease(request), /SIMULATED_RELEASE_FAILURE/);
  assert.deepEqual(getFloor().events.map(item => item.event_id), ['e-c2']);
  const retry = await persistence.archiveAndRelease(request);
  assert.equal(retry.status, 'released');
  assert.deepEqual(getFloor().events.map(item => item.event_id), ['e-c2']);
});

test('release readback failure is retryable without deleting a newer-cycle Event', async () => {
  const {store, getFloor} = fixture([exposure('e-c1'), exposure('e-c2', 'subject-1')]);
  const basePersistence = createFloorPersistenceCoordinator({store, enabledResolver: () => true});
  const originalCommit = basePersistence.commitFloorPatch.bind(basePersistence);
  let corruptReleaseReadback = true;
  const floorPersistence = {async commitFloorPatch(input) {
    const result = await originalCommit(input);
    if (corruptReleaseReadback && input.operation_type === 'pregnancy-cycle-release-patch') {
      corruptReleaseReadback = false;
      const current = getFloor();
      current.pregnancy_lifecycle_timeline.release_records = current.pregnancy_lifecycle_timeline.release_records.filter(item => item.action !== 'cycle-lock-released');
    }
    return result;
  }};
  const persistence = createPregnancyLifecyclePersistence({store, floorPersistence, resolveCurrentFloorVersion: async () => version});
  const request = {
    ownerFloor: {message_index: 0},
    floorVersion: version,
    fact: {fact_id: 'fact-release-readback-failure', subject_id: 'subject-1', pregnancy_id: 'preg-1', cycle_id: 'c1', status: 'delivery', source_event_id: 'fact-release-readback-failure'},
    aggregation: {accepted_exposure_event_ids: ['e-c1']},
    operationKey: 'op-release-readback-failure',
  };
  await assert.rejects(persistence.archiveAndRelease(request), error => error.code === 'PREGNANCY_RELEASE_READBACK_FAILED');
  assert.deepEqual(getFloor().events.map(item => item.event_id), ['e-c2']);
  const retry = await persistence.archiveAndRelease(request);
  assert.equal(retry.status, 'released');
  assert.deepEqual(getFloor().events.map(item => item.event_id), ['e-c2']);
});

for (const status of ['miscarriage', 'termination']) {
  test(`${status} deletes the current cycle Exposure and releases without changing unrelated Events`, async () => {
    const {persistence, getFloor} = fixture([exposure('e-c1'), exposure('e-c2', 'subject-2'), {event_id: 'medical', type: 'medical_event', status: 'confirmed'}]);
    const fact = {fact_id: `fact-${status}`, subject_id: 'subject-1', pregnancy_id: 'preg-1', cycle_id: 'c1', status, source_event_id: `fact-${status}`};
    await persistence.archiveAndRelease({ownerFloor: {message_index: 0}, floorVersion: version, fact, aggregation: {aggregation_id: 'agg-c1', accepted_exposure_event_ids: ['e-c1']}, operationKey: `op-${status}`});
    assert.deepEqual(getFloor().events.map(item => item.event_id), ['e-c2', 'medical']);
    assert.equal(getFloor().pregnancy_lifecycle_timeline.release_records.some(item => item.action === 'cycle-lock-released' && item.cycle_id === 'c1'), true);
  });
}
