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
import {createAnalyzer} from '../ai/analyzer.js';
import {SILLYTAVERN_CURRENT_API} from '../storage/schema.js';

const version = {chat_id: 'chat-a', message_id: 'message-a', floor: 1, swipe_id: 0, content_hash: 'hash-a', message_version: 1};

function event(overrides = {}) {
  return {
    event_id: 'evt-health-1',
    type: 'physical_symptom',
    status: 'confirmed',
    location: '地点 A',
    participants: [{character_id: 'char_000001', display_name: '祁鸢', event_role: 'unknown', biological_context: {species: null, biological_type: null}}],
    source_evidence: [{kind: 'narrative', text: '手腕有轻微擦伤'}],
    state_fact: {subject_id: 'char_000001', payload: {symptom: {kind: 'abrasion', description: '轻微擦伤', health_role: 'observation'}}},
    story_time: {display: 'Day 1', normalized: null, day_index: 1, calendar_id: null, precision: 'day'},
    source: version,
    ...overrides,
  };
}

function response() {
  return {
    schema_version: 3,
    severity: 'mild',
    persistence: 'short_term',
    natural_recovery: 'eligible',
    earliest_recovery: {duration: {story_days: 3}, boundary: null},
    expected_recovery: {duration: {story_days: 7}, boundary: null},
    assessment_source: 'ai_derived_assessment',
    recovery_stage_guidance: {
      early: 'EARLY_OBSERVATION_GUIDANCE',
      recovering: 'RECOVERING_OBSERVATION_GUIDANCE',
      near_recovery: 'NEAR_RECOVERY_OBSERVATION_GUIDANCE',
    },
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

test('severity contract accepts only the four values and keeps other fields on malformed input', () => {
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

test('legacy v2 Assessment without recovery profile remains lifecycle-readable without backfill', () => {
  const legacy = persistedAssessment({schema_version: 2});
  delete legacy.recovery_stage_guidance;
  const timeline = normalizeHealthAssessmentTimeline({schema_version: 2, assessments: [legacy]});
  assert.equal(timeline.schema_version, 2);
  assert.equal(timeline.assessments.length, 1);
  assert.equal(timeline.assessments[0].recovery_stage_guidance, null);
  assert.equal(validateHealthAssessment(timeline.assessments[0]).ok, true);
});

test('Health Assessment prompt carries severity and v3 recovery profile contract without a separate pass', () => {
  const prompt = buildHealthAssessmentMessages(event()).map(message => message.content).join('\n');
  assert.match(prompt, /schema_version.:3/);
  assert.match(prompt, /severity.:.unknown\|mild\|moderate\|severe/);
  assert.match(prompt, /证据不足时 severity 必须为 unknown/);
  assert.match(prompt, /不要根据恢复时间/);
  assert.match(prompt, /明确的 factual timing/);
  assert.match(prompt, /信息充分、可合理评估的普通 short_term observation/);
  assert.match(prompt, /不要为了避免估计而默认返回 null/);
  assert.match(prompt, /recovery_stage_guidance/);
  assert.match(prompt, /non-factual、conditional/);
  assert.match(prompt, /百分比/);
  assert.match(prompt, /Day1\/Day2\/Day3/);
});

test('Health Assessment prompt preserves explicit timing and AI-derived timing as separate paths', () => {
  const explicit = event({
    source_evidence: [{kind: 'narrative', text: '医生判断约三天后恢复正常活动'}],
  });
  const explicitPrompt = buildHealthAssessmentMessages(explicit).map(message => message.content).join('\n');
  assert.match(explicitPrompt, /source_event\/source_evidence/);
  assert.match(explicitPrompt, /explicit_narrative_timing/);
  assert.match(explicitPrompt, /assessment_source/);

  const derivedPrompt = buildHealthAssessmentMessages(event({
    source_evidence: [{kind: 'narrative', text: '右手腕轻微扭伤，短期活动受限'}],
  })).map(message => message.content).join('\n');
  assert.match(derivedPrompt, /ai_derived_assessment/);
  assert.match(derivedPrompt, /expected_recovery/);
});

test('Health Assessment analyzer preserves a valid v3 profile and rejects missing profile', async () => {
  const analyzer = createAnalyzer({
    profileResolver: () => SILLYTAVERN_CURRENT_API,
    contextResolver: () => ({generateRaw: () => JSON.stringify(response())}),
  });
  const parsed = await analyzer.analyzeHealthAssessment({event: event()});
  assert.equal(parsed.schema_version, 3);
  assert.deepEqual(parsed.recovery_stage_guidance, response().recovery_stage_guidance);

  const rejected = createAnalyzer({
    profileResolver: () => SILLYTAVERN_CURRENT_API,
    contextResolver: () => ({generateRaw: () => JSON.stringify({
      ...response(),
      recovery_stage_guidance: undefined,
    })}),
  });
  await assert.rejects(() => rejected.analyzeHealthAssessment({event: event()}), error => {
    assert.equal(error.code, 'HEALTH_ASSESSMENT_INVALID');
    return true;
  });
});

test('Health Assessment invalid JSON diagnostics expose parser input without repairing it', async () => {
  const previousFlag = globalThis.__BIOWEAVE_API_TRACE__;
  const previousDebug = console.debug;
  const traces = [];
  globalThis.__BIOWEAVE_API_TRACE__ = true;
  console.debug = (...args) => {
    if (args[0] === '[BioWeave API TRACE]') traces.push(args);
  };
  try {
    const analyzer = createAnalyzer({
      profileResolver: () => SILLYTAVERN_CURRENT_API,
      contextResolver: () => ({generateRaw: () => ' ```json\n' + JSON.stringify(response()) + '\n``` '}),
    });
    await assert.rejects(() => analyzer.analyzeHealthAssessment({event: event()}), error => {
      assert.equal(error.code, 'HEALTH_ASSESSMENT_INVALID_JSON');
      return true;
    });
    const parserError = traces.find(args => args[1] === 'health-assessment-parser-error')?.[2];
    assert.equal(parserError.rawResponseShape, 'string');
    assert.equal(parserError.codeFenceDetected, true);
    assert.equal(parserError.firstNonWhitespaceChar, '`');
    assert.equal(parserError.lastNonWhitespaceChar, '`');
    assert.equal(parserError.parseErrorName, 'SyntaxError');
    assert.match(parserError.parseErrorMessage, /JSON|Unexpected/u);
    assert.equal(typeof parserError.responseFingerprint, 'string');
    assert.equal(typeof parserError.extractedTextFingerprint, 'string');
    assert.equal(parserError.extractedTextLength > 0, true);
  } finally {
    console.debug = previousDebug;
    if (previousFlag === undefined) delete globalThis.__BIOWEAVE_API_TRACE__;
    else globalThis.__BIOWEAVE_API_TRACE__ = previousFlag;
  }
});

test('explicit narrative timing survives Assessment normalization as a derived timing source', () => {
  const value = normalizeHealthAssessment({
    ...response(),
    assessment_source: 'explicit_narrative_timing',
    expected_recovery: {duration: {story_days: 3}, boundary: null},
  });
  assert.equal(value.assessment_source, 'explicit_narrative_timing');
  assert.equal(value.expected_recovery.duration.story_days, 3);
  assert.equal(validateHealthAssessment({...value, assessment_id: 'a', request_key: 'r', source_event_id: 'e', source_floor_version: version, source_observation_fingerprint: 'fp'}).ok, true);
});

test('genuinely unresolved recovery timing remains valid without forcing a duration', () => {
  const value = normalizeHealthAssessment({
    ...response(),
    assessment_source: 'unknown',
    expected_recovery: {duration: null, boundary: null},
  });
  assert.equal(value.expected_recovery.duration, null);
  assert.equal(value.expected_recovery.boundary, null);
  assert.equal(value.assessment_source, 'unknown');
});

test('v3 recovery profile requires exactly three bounded non-empty stage strings when eligible', () => {
  const valid = validateHealthAssessment({
    ...persistedAssessment(),
    schema_version: 3,
  });
  assert.equal(valid.ok, true);

  for (const invalid of [
    {...persistedAssessment(), schema_version: 3, recovery_stage_guidance: null},
    {...persistedAssessment(), schema_version: 3, recovery_stage_guidance: {...response().recovery_stage_guidance, early: ''}},
    {...persistedAssessment(), schema_version: 3, recovery_stage_guidance: {...response().recovery_stage_guidance, extra: 'invalid'}},
    {...persistedAssessment(), schema_version: 3, recovery_stage_guidance: {...response().recovery_stage_guidance, near_recovery: 42}},
    {...persistedAssessment(), schema_version: 3, recovery_stage_guidance: {...response().recovery_stage_guidance, recovering: 'x'.repeat(601)}},
  ]) {
    assert.equal(validateHealthAssessment(invalid).ok, false);
  }
});

test('v3 ineligible or unresolved observations persist null profile without staged guidance', () => {
  for (const overrides of [
    {persistence: 'long_term', natural_recovery: 'not_eligible'},
    {persistence: 'short_term', natural_recovery: 'unknown'},
    {persistence: 'short_term', natural_recovery: 'eligible', expected_recovery: {duration: null, boundary: null}},
  ]) {
    const value = validateHealthAssessment({
      ...persistedAssessment(),
      ...overrides,
      schema_version: 3,
      recovery_stage_guidance: null,
    });
    assert.equal(value.ok, true);
    assert.equal(value.value.recovery_stage_guidance, null);
  }
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

test('medical intervention is not eligible for Health Assessment', async () => {
  const intervention = event({
    event_id: 'evt-treatment',
    type: 'medical_event',
    state_fact: {subject_id: 'char_000001', payload: {
      fact: {kind: 'wound_treatment', description: '外敷止血药粉', health_role: 'intervention'},
    }},
  });
  assert.equal(healthAssessmentEligibility(intervention).eligible, false);
  let calls = 0;
  let floor = {floor_version: version, events: [intervention], health_assessment_timeline: emptyHealthAssessmentTimeline()};
  const coordinator = createHealthAssessmentCoordinator({
    analyzer: {analyzeHealthAssessment: async () => { calls += 1; return response(); }},
    getFloor: () => structuredClone(floor),
    commitFloorPatch: async (_target, _owner, patch) => { floor = {...floor, ...structuredClone(patch)}; },
    assertExecutionTargetCurrent: async () => true,
  });
  await coordinator.assessFloor({target: {index: 0, swipeId: 0, version}, execution: {}, token: {}, events: floor.events});
  assert.equal(calls, 0);
  assert.equal(floor.health_assessment_timeline.assessments.length, 0);
});

test('legacy treatment Assessment cannot authorize a missing health role', () => {
  const legacyTreatment = event({
    event_id: 'evt-legacy-treatment',
    type: 'medical_event',
    state_fact: {subject_id: 'char_000001', payload: {
      fact: {kind: 'wound_treatment', description: '旧治疗记录'},
    }},
  });
  assert.equal(healthAssessmentEligibility(legacyTreatment).eligible, false);
});

test('ordinary short-term observations persist one AI-derived recovery estimate without explicit timing', async () => {
  let floor = {floor_version: version, events: [event()], health_assessment_timeline: emptyHealthAssessmentTimeline()};
  const diagnostics = [];
  const coordinator = createHealthAssessmentCoordinator({
    analyzer: {analyzeHealthAssessment: async () => response()},
    getFloor: () => structuredClone(floor),
    commitFloorPatch: async (_target, _owner, patch) => { floor = {...floor, ...structuredClone(patch)}; },
    assertExecutionTargetCurrent: async () => true,
    trace: item => diagnostics.push(item),
  });
  await coordinator.assessFloor({
    target: {index: 0, swipeId: 0, version}, execution: {}, token: {}, events: floor.events,
  });
  const saved = floor.health_assessment_timeline.assessments[0];
  assert.equal(saved.persistence, 'short_term');
  assert.equal(saved.natural_recovery, 'eligible');
  assert.equal(saved.assessment_source, 'ai_derived_assessment');
  assert.equal(saved.expected_recovery.duration.story_days, 7);
  assert.deepEqual(saved.recovery_stage_guidance, response().recovery_stage_guidance);
  assert.equal(diagnostics.filter(item => item.stage === 'HEALTH_ASSESSMENT_REQUEST_STARTED').length, 1);
  assert.equal(diagnostics.filter(item => item.stage === 'HEALTH_ASSESSMENT_REQUEST_COMPLETED').length, 1);
  assert.equal(diagnostics.filter(item => item.stage === 'HEALTH_ASSESSMENT_ACCEPTED').length, 1);
});

test('persisted assessment is reused and active filtering invalidates changed source facts', async () => {
  let floor = {floor_version: version, events: [event()], health_assessment_timeline: emptyHealthAssessmentTimeline()};
  let calls = 0;
  const diagnostics = [];
  const coordinator = createHealthAssessmentCoordinator({
    analyzer: {analyzeHealthAssessment: async () => { calls += 1; return response(); }},
    getFloor: () => structuredClone(floor),
    commitFloorPatch: async (_target, _owner, patch) => { floor = {...floor, ...structuredClone(patch)}; },
    assertExecutionTargetCurrent: async () => true,
    trace: item => diagnostics.push(item),
  });
  const target = {index: 0, swipeId: 0, version};
  await coordinator.assessFloor({target, execution: {}, token: {}, events: floor.events});
  await coordinator.assessFloor({target, execution: {}, token: {}, events: floor.events});
  assert.equal(calls, 1);
  assert.equal(floor.health_assessment_timeline.assessments.length, 1);
  assert.equal(floor.health_assessment_timeline.assessments[0].severity, 'mild');
  assert.equal(diagnostics.filter(item => item.stage === 'HEALTH_ASSESSMENT_REQUEST_STARTED').length, 1);
  assert.equal(diagnostics.filter(item => item.stage === 'HEALTH_ASSESSMENT_REUSED').length, 1);
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
  const diagnostics = [];
  const coordinator = createHealthAssessmentCoordinator({
    analyzer: {analyzeHealthAssessment: async () => { calls += 1; await new Promise(resolve => setTimeout(resolve, 2)); return response(); }},
    getFloor: () => structuredClone(floor),
    commitFloorPatch: async (_target, _owner, patch) => { floor = {...floor, ...structuredClone(patch)}; },
    assertExecutionTargetCurrent: async () => true,
    trace: item => diagnostics.push(item),
  });
  const input = {target: {index: 0, swipeId: 0, version}, execution: {}, token: {}, events: floor.events};
  await Promise.all([coordinator.assessFloor(input), coordinator.assessFloor(input)]);
  assert.equal(calls, 1);
  assert.equal(floor.health_assessment_timeline.assessments.length, 1);
  assert.equal(diagnostics.filter(item => item.stage === 'HEALTH_ASSESSMENT_REQUEST_STARTED').length, 1);
  assert.equal(diagnostics.filter(item => item.stage === 'HEALTH_ASSESSMENT_INFLIGHT_REUSED').length, 1);
});

test('duplicate same-key candidates in one lifecycle pass start one Assessment request', async () => {
  let floor = {floor_version: version, events: [event()], health_assessment_timeline: emptyHealthAssessmentTimeline()};
  let calls = 0;
  const diagnostics = [];
  const coordinator = createHealthAssessmentCoordinator({
    analyzer: {analyzeHealthAssessment: async () => { calls += 1; return response(); }},
    getFloor: () => structuredClone(floor),
    commitFloorPatch: async (_target, _owner, patch) => { floor = {...floor, ...structuredClone(patch)}; },
    assertExecutionTargetCurrent: async () => true,
    trace: item => diagnostics.push(item),
  });
  const input = {target: {index: 0, swipeId: 0, version}, execution: {}, token: {}, events: [event(), event()]};
  await coordinator.assessFloor(input);
  assert.equal(calls, 1);
  assert.equal(diagnostics.filter(item => item.stage === 'HEALTH_ASSESSMENT_REQUEST_STARTED').length, 1);
  assert.equal(diagnostics.filter(item => item.stage === 'HEALTH_ASSESSMENT_REUSED').length, 1);
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
