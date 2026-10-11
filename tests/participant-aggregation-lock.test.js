import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterSubjectExposureSlices,
  filterCycleLockedSlices,
  isParticipantAggregationLockEnabled,
  isCycleEventEditable,
  isSubjectEventEditable,
  resolveCycleLocks,
} from '../core/participant-aggregation-lock.js';

test('aggregation lock stays disabled until lifecycle archive/release is ready', () => {
  assert.equal(isParticipantAggregationLockEnabled(), false);
  const result = filterSubjectExposureSlices({
    slices: [{subject_id: 'subject-a'}, {subject_id: 'subject-b'}],
    lockedSubjectIds: ['subject-a'],
  });
  assert.equal(result.enabled, false);
  assert.equal(result.slices.length, 2);
  assert.equal(isSubjectEventEditable({subjectId: 'subject-a', lockedSubjectIds: ['subject-a']}).allowed, true);
});

test('simulated lifecycle gate filters only locked subject slices and keeps edit lock scoped', () => {
  const result = filterSubjectExposureSlices({
    slices: [{subject_id: 'subject-a'}, {subject_id: 'subject-b'}, {type: 'ordinary'}],
    lockedSubjectIds: ['subject-a'],
    lifecycleArchiveReleaseReady: true,
  });
  assert.deepEqual(result.slices, [{subject_id: 'subject-b'}, {type: 'ordinary'}]);
  assert.deepEqual(isSubjectEventEditable({subjectId: 'subject-a', lockedSubjectIds: ['subject-a'], lifecycleArchiveReleaseReady: true}), {allowed: false, reason_code: 'participant_aggregation_event_locked'});
  assert.deepEqual(isSubjectEventEditable({subjectId: 'subject-b', lockedSubjectIds: ['subject-a'], lifecycleArchiveReleaseReady: true}), {allowed: true, reason_code: 'participant_aggregation_event_unlocked'});
});

test('simulated lock can remove all or only selected pregnancy slices without removing ordinary NSFW content', () => {
  const allFiltered = filterSubjectExposureSlices({
    slices: [{subject_id: 'subject-a', kind: 'exposure'}, {subject_id: 'subject-a', kind: 'exposure'}, {kind: 'ordinary-nsfw'}],
    lockedSubjectIds: ['subject-a'],
    lifecycleArchiveReleaseReady: true,
  });
  assert.deepEqual(allFiltered.slices, [{kind: 'ordinary-nsfw'}]);
  const partial = filterSubjectExposureSlices({
    slices: [{subject_id: 'subject-a', kind: 'exposure'}, {subject_id: 'subject-b', kind: 'exposure'}, {kind: 'ordinary-nsfw'}],
    lockedSubjectIds: ['subject-a'],
    lifecycleArchiveReleaseReady: true,
  });
  assert.deepEqual(partial.slices, [{subject_id: 'subject-b', kind: 'exposure'}, {kind: 'ordinary-nsfw'}]);
  assert.deepEqual(isSubjectEventEditable({subjectId: 'subject-a', lockedSubjectIds: ['subject-a'], lifecycleArchiveReleaseReady: true}), {allowed: false, reason_code: 'participant_aggregation_event_locked'});
});

test('cycle-scoped lock releases after terminal lifecycle and leaves C002 writable', () => {
  const aggregation = {status: 'succeeded', subject_id: 'subject-a', pregnancy_id: 'preg-1', cycle_id: 'c1'};
  const locked = resolveCycleLocks({aggregations: [aggregation], lifecycleArchiveReleaseReady: true});
  assert.deepEqual([...locked], ['subject-a:preg-1:c1']);
  const released = resolveCycleLocks({aggregations: [aggregation], lifecycleFacts: [{subject_id: 'subject-a', pregnancy_id: 'preg-1', cycle_id: 'c1', status: 'delivery'}], lifecycleArchiveReleaseReady: true});
  assert.equal(released.size, 0);
  const filtered = filterCycleLockedSlices({
    lockedCycleKeys: ['subject-a:preg-1:c1'],
    lifecycleArchiveReleaseReady: true,
    slices: [
      {type: 'sexual_activity', pregnancy_relevance: {relevant: true}, subject_id: 'subject-a', pregnancy_id: 'preg-1', cycle_id: 'c1'},
      {type: 'sexual_activity', pregnancy_relevance: {relevant: true}, subject_id: 'subject-a', pregnancy_id: 'preg-2', cycle_id: 'c2'},
      {type: 'medical_event', subject_id: 'subject-a', cycle_id: 'c1'},
      {type: 'sexual_activity', pregnancy_relevance: {relevant: true}, subject_id: 'subject-b', cycle_id: 'c1'},
    ],
  });
  assert.equal(filtered.slices.length, 3);
  assert.equal(isCycleEventEditable({subjectId: 'subject-a', pregnancyId: 'preg-1', cycleId: 'c1', event: {type: 'sexual_activity', pregnancy_relevance: {relevant: true}}, lockedCycleKeys: ['subject-a:preg-1:c1'], lifecycleArchiveReleaseReady: true}).allowed, false);
  assert.equal(isCycleEventEditable({subjectId: 'subject-a', pregnancyId: 'preg-1', cycleId: 'c1', event: {type: 'medical_event'}, lockedCycleKeys: ['subject-a:preg-1:c1'], lifecycleArchiveReleaseReady: true}).allowed, true);
});
