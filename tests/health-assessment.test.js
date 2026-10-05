import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HEALTH_ASSESSMENT_SEVERITY,
  activeHealthAssessments,
  emptyHealthAssessmentTimeline,
  healthAssessmentEligibility,
  healthAssessmentRequestKey,
  healthObservationFingerprint,
  normalizeHealthAssessment,
  normalizeHealthAssessmentTimeline,
  validateHealthAssessment,
} from '../core/health-assessment.js';
import {createHealthAssessmentCoordinator} from '../runtime/health-assessment.js';
import {buildHealthAssessmentMessages} from '../ai/prompts.js';

const version = {chat_id: 'chat-a', message_id: 'message-a', floor: 1, swipe_id: 0, content_hash: 'hash-a', message_version: 1};

function event(overrides = {}) {
  return {
    event_id: 'evt-health-1',
    type: 'physical_symptom',
    status: 'confirmed',
    location: '地点 A',
    participants: [{character_id: 'char_000001', display_name: '祁鸢', event_role: 'unknown', biological_context: {species: null, biological_type: null}}],
    source_evidence: [{kind: 'narrative', text: '手腕有轻微擦伤'}],
    state_fact: {subject_id: 'char_000001', payload: {symptom: {kind: 'abrasion', description: '轻微擦伤'}}},
    story_time: {display: 'Day 1', normalized: null, day_index: 1, calendar_id: null, precision: 'day'},
    source: version,
    ...overrides,
  };
}

function response() {
  return {
    schema_version: 2,
    severity: 'mild',
    persistence: 'short_term',
    natural_recovery: 'eligible',
    earliest_recovery: {duration: {story_days: 3}, boundary: null},
    expected_recovery: {duration: {story_days: 7}, boundary: null},
    assessment_source: 'ai_derived_assessment',
  };
}

function persistedAssessment(overrides = {}) {
  return {
    ...response(),
    assessment_id: 'assessment-health-1',
    request_key: 'request-health-1',
    source_event_id: 'evt-health-1',
    source_floor_version: version,
    source_observation_fingerprint: healthObservationFingerprint(event()),
    ...overrides,
  };
}

test('severity contract accepts only the four v2 values and keeps other fields on malformed input', () => {
  assert.deepEqual(HEALTH_ASSESSMENT_SEVERITY, ['unknown', 'mild', 'moderate', 'severe']);
  for (const severity of HEALTH_ASSESSMENT_SEVERITY) {
    assert.equal(normalizeHealthAssessment({...persistedAssessment(), severity}).severity, severity);
  }
  assert.equal(normalizeHealthAssessment({...persistedAssessment(), severity: 'severe', persistence: 'short_term'}).persistence, 'short_term');
  assert.equal(normalizeHealthAssessment({...persistedAssessment(), severity: 'mild', persistence: 'long_term'}).persistence, 'long_term');
  assert.equal(normalizeHealthAssessment({...persistedAssessment(), severity: 'mild', persistence: 'permanent'}).persistence, 'permanent');
  const malformed = validateHealthAssessment({...persistedAssessment(), severity: 'critical'});
  assert.equal(malformed.ok, true);
  assert.equal(malformed.value.severity, 'unknown');
  assert.equal(malformed.value.persistence, 'short_term');
  assert.equal(malformed.value.expected_recovery.duration.story_days, 7);
});

test('legacy v1 Assessment keeps missing severity distinct from v2 unknown', () => {
  const legacySource = persistedAssessment({schema_version: 1});
  delete legacySource.severity;
  delete legacySource.schema_version;
  const legacy = normalizeHealthAssessmentTimeline({
    schema_version: 1,
    assessments: [legacySource],
  });
  const current = normalizeHealthAssessmentTimeline({
    schema_version: 2,
    assessments: [persistedAssessment({schema_version: 2, severity: 'unknown'})],
  });
  assert.equal(legacy.schema_version, 1);
  assert.equal(Object.hasOwn(legacy.assessments[0], 'severity'), false);
  assert.equal(current.schema_version, 2);
  assert.equal(current.assessments[0].severity, 'unknown');
});

test('Health Assessment prompt carries severity v2 contract without a separate pass', () => {
  const prompt = buildHealthAssessmentMessages(event()).map(message => message.content).join('\n');
  assert.match(prompt, /schema_version.:2/);
  assert.match(prompt, /severity.:.unknown\|mild\|moderate\|severe/);
  assert.match(prompt, /证据不足时 severity 必须为 unknown/);
  assert.match(prompt, /不要根据恢复时间/);
});

test('health fingerprint is deterministic and ignores location-only changes', async () => {
  const first = event();
  const second = event({location: '地点 B'});
  assert.equal(healthObservationFingerprint(first), healthObservationFingerprint(second));
  assert.notEqual(
    healthObservationFingerprint(first),
    healthObservationFingerprint(event({state_fact: {subject_id: 'char_000001', payload: {symptom: {kind: 'fracture'}}}})),
  );
  assert.equal(await healthAssessmentRequestKey({eventId: first.event_id, floorVersion: version, observationFingerprint: healthObservationFingerprint(first)}), await healthAssessmentRequestKey({eventId: first.event_id, floorVersion: version, observationFingerprint: healthObservationFingerprint(first)}));
});

test('eligibility is conservative and excludes reproductive exposure', () => {
  assert.equal(healthAssessmentEligibility(event()).eligible, true);
  assert.equal(healthAssessmentEligibility(event({type: 'sexual_activity', state_fact: null})).eligible, false);
  assert.equal(healthAssessmentEligibility(event({status: 'negated'})).eligible, false);
});

test('persisted assessment is reused and active filtering invalidates changed source facts', async () => {
  let floor = {floor_version: version, events: [event()], health_assessment_timeline: emptyHealthAssessmentTimeline()};
  let calls = 0;
  const coordinator = createHealthAssessmentCoordinator({
    analyzer: {analyzeHealthAssessment: async () => { calls += 1; return response(); }},
    getFloor: () => structuredClone(floor),
    commitFloorPatch: async (_target, _owner, patch) => { floor = {...floor, ...structuredClone(patch)}; },
    assertExecutionTargetCurrent: async () => true,
  });
  const target = {index: 0, swipeId: 0, version};
  await coordinator.assessFloor({target, execution: {}, token: {}, events: floor.events});
  await coordinator.assessFloor({target, execution: {}, token: {}, events: floor.events});
  assert.equal(calls, 1);
  assert.equal(floor.health_assessment_timeline.assessments.length, 1);
  assert.equal(floor.health_assessment_timeline.assessments[0].severity, 'mild');
  assert.equal(activeHealthAssessments({timeline: floor.health_assessment_timeline, events: floor.events, floorVersion: version}).length, 1);
  const edited = event({state_fact: {subject_id: 'char_000001', payload: {symptom: {kind: 'infection'}}}});
  floor.events = [edited];
  assert.equal(activeHealthAssessments({timeline: floor.health_assessment_timeline, events: floor.events, floorVersion: version}).length, 0);
});

test('legacy v1 Assessment is reused without backfill or another AI request', async () => {
  const requestKey = await healthAssessmentRequestKey({
    eventId: event().event_id,
    floorVersion: version,
    observationFingerprint: healthObservationFingerprint(event()),
  });
  const legacy = persistedAssessment({schema_version: 1, request_key: requestKey});
  delete legacy.severity;
  let floor = {
    floor_version: version,
    events: [event()],
    health_assessment_timeline: {schema_version: 1, assessments: [legacy]},
  };
  let calls = 0;
  const coordinator = createHealthAssessmentCoordinator({
    analyzer: {analyzeHealthAssessment: async () => { calls += 1; return response(); }},
    getFloor: () => structuredClone(floor),
    commitFloorPatch: async () => { throw new Error('legacy Assessment must not be rewritten'); },
    assertExecutionTargetCurrent: async () => true,
  });
  const result = await coordinator.assessFloor({
    target: {index: 0, swipeId: 0, version}, execution: {}, token: {}, events: floor.events,
  });
  assert.equal(calls, 0);
  assert.equal(result[0].schema_version, 1);
  assert.equal(Object.hasOwn(result[0], 'severity'), false);
  assert.equal(floor.health_assessment_timeline.schema_version, 1);
  assert.equal(Object.hasOwn(floor.health_assessment_timeline.assessments[0], 'severity'), false);
});

test('malformed severity is persisted as unknown without losing the valid Assessment', async () => {
  let floor = {floor_version: version, events: [event()], health_assessment_timeline: emptyHealthAssessmentTimeline()};
  const coordinator = createHealthAssessmentCoordinator({
    analyzer: {analyzeHealthAssessment: async () => ({...response(), severity: 'critical'})},
    getFloor: () => structuredClone(floor),
    commitFloorPatch: async (_target, _owner, patch) => { floor = {...floor, ...structuredClone(patch)}; },
    assertExecutionTargetCurrent: async () => true,
  });
  await coordinator.assessFloor({target: {index: 0, swipeId: 0, version}, execution: {}, token: {}, events: floor.events});
  const saved = floor.health_assessment_timeline.assessments[0];
  assert.equal(saved.severity, 'unknown');
  assert.equal(saved.persistence, 'short_term');
  assert.equal(saved.expected_recovery.duration.story_days, 7);
});

test('first malformed assessment does not occupy the successful slot', async () => {
  let floor = {floor_version: version, events: [event()], health_assessment_timeline: emptyHealthAssessmentTimeline()};
  let calls = 0;
  const coordinator = createHealthAssessmentCoordinator({
    analyzer: {analyzeHealthAssessment: async () => {
      calls += 1;
      return calls === 1 ? {persistence: 'bad'} : response();
    }},
    getFloor: () => structuredClone(floor),
    commitFloorPatch: async (_target, _owner, patch) => { floor = {...floor, ...structuredClone(patch)}; },
    assertExecutionTargetCurrent: async () => true,
  });
  const input = {target: {index: 0, swipeId: 0, version}, execution: {}, token: {}, events: floor.events};
  await coordinator.assessFloor(input);
  await coordinator.assessFloor(input);
  assert.equal(calls, 2);
  assert.equal(normalizeHealthAssessmentTimeline(floor.health_assessment_timeline).assessments.length, 1);
});

test('two concurrent requests accept one persisted result', async () => {
  let floor = {floor_version: version, events: [event()], health_assessment_timeline: emptyHealthAssessmentTimeline()};
  let calls = 0;
  const coordinator = createHealthAssessmentCoordinator({
    analyzer: {analyzeHealthAssessment: async () => { calls += 1; await new Promise(resolve => setTimeout(resolve, 2)); return response(); }},
    getFloor: () => structuredClone(floor),
    commitFloorPatch: async (_target, _owner, patch) => { floor = {...floor, ...structuredClone(patch)}; },
    assertExecutionTargetCurrent: async () => true,
  });
  const input = {target: {index: 0, swipeId: 0, version}, execution: {}, token: {}, events: floor.events};
  await Promise.all([coordinator.assessFloor(input), coordinator.assessFloor(input)]);
  assert.equal(calls, 1);
  assert.equal(floor.health_assessment_timeline.assessments.length, 1);
});

test('deleted, replaced, or swiped source versions cannot activate an old assessment', async () => {
  let floor = {floor_version: version, events: [event()], health_assessment_timeline: emptyHealthAssessmentTimeline()};
  const coordinator = createHealthAssessmentCoordinator({
    analyzer: {analyzeHealthAssessment: async () => response()},
    getFloor: () => structuredClone(floor),
    commitFloorPatch: async (_target, _owner, patch) => { floor = {...floor, ...structuredClone(patch)}; },
    assertExecutionTargetCurrent: async () => true,
  });
  await coordinator.assessFloor({target: {index: 0, swipeId: 0, version}, execution: {}, token: {}, events: floor.events});
  const saved = floor.health_assessment_timeline;
  floor.events = [];
  assert.equal(activeHealthAssessments({timeline: saved, events: floor.events, floorVersion: version}).length, 0);
  floor.events = [event({source: {...version, swipe_id: 1}})];
  assert.equal(activeHealthAssessments({timeline: saved, events: floor.events, floorVersion: version}).length, 0);
  assert.equal(activeHealthAssessments({timeline: saved, events: [event()], floorVersion: {...version, content_hash: 'hash-v2'}}).length, 0);
});

test('stale assessment completion fails closed after source edit', async () => {
  let floor = {floor_version: version, events: [event()], health_assessment_timeline: emptyHealthAssessmentTimeline()};
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const acceptedDiagnostics = [];
  const coordinator = createHealthAssessmentCoordinator({
    analyzer: {analyzeHealthAssessment: async () => { await pending; return response(); }},
    getFloor: () => structuredClone(floor),
    commitFloorPatch: async (_target, _owner, patch) => { floor = {...floor, ...structuredClone(patch)}; },
    assertExecutionTargetCurrent: async () => true,
    trace: item => acceptedDiagnostics.push(item),
  });
  const work = coordinator.assessFloor({target: {index: 0, swipeId: 0, version}, execution: {}, token: {}, events: floor.events});
  floor.events = [event({state_fact: {subject_id: 'char_000001', payload: {symptom: {kind: 'infection'}}}})];
  release();
  await work;
  assert.equal(floor.health_assessment_timeline.assessments.length, 0);
  assert.ok(acceptedDiagnostics.some(item => [
    'HEALTH_ASSESSMENT_STALE_BEFORE_REQUEST',
    'HEALTH_ASSESSMENT_STALE_COMPLETION_DISCARDED',
  ].includes(item.stage)));
});
