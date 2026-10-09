import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveCurrentHealthState, expiredHealthEventIds} from '../core/health-evolution.js';
import {summarizeActiveHealthSeverity} from '../core/health-aggregation.js';
import {activeHealthAssessments, healthObservationFingerprint} from '../core/health-assessment.js';

const version = {
  chat_id: 'chat-health', message_id: 'message-health', floor: 1,
  swipe_id: 0, content_hash: 'hash-health', message_version: 1,
};

function story(day, calendar_id = null) {
  return {display: `Day ${day}`, normalized: null, day_index: day, calendar_id, precision: 'day'};
}

function event({id = 'event-a', subject = 'char-a', kind = 'abrasion', description = null, day = 1, type = 'physical_symptom', source = version, bodySite = null, laterality = null, continuation, healthRole = 'observation'} = {}) {
  const symptom = {kind};
  if (description !== null) symptom.description = description;
  if (bodySite !== null) symptom.body_site = bodySite;
  if (laterality !== null) symptom.laterality = laterality;
  if (continuation !== undefined) symptom.continuation = continuation;
  if (healthRole !== null) symptom.health_role = healthRole;
  const factualKey = type === 'physical_symptom' ? 'symptom' : 'fact';
  return {
    event_id: id,
    type,
    status: 'confirmed',
    location: 'A',
    source,
    story_time: story(day),
    source_evidence: [{kind: 'narrative', text: `${kind} observed`}],
    participants: [{character_id: subject, event_role: 'unknown'}],
    state_fact: {subject_id: subject, payload: {[factualKey]: symptom}},
  };
}

function assessment({eventId = 'event-a', day = 1, persistence = 'short_term', severity, expectedDay = null, expectedDuration = null, id = `assessment-${eventId}`} = {}) {
  return {
    assessment_id: id,
    source_event_id: eventId,
    persistence,
    ...(severity === undefined ? {} : {severity}),
    natural_recovery: persistence === 'short_term' ? 'eligible' : 'not_eligible',
    reference_story_time: story(day),
    earliest_recovery: {duration: null, boundary: null},
    expected_recovery: {
      duration: expectedDuration === null ? null : {story_days: expectedDuration},
      boundary: expectedDay === null ? null : story(expectedDay),
    },
    recovery_stage_guidance: {
      early: `early-${eventId}`,
      recovering: `recovering-${eventId}`,
      near_recovery: `near-${eventId}`,
    },
  };
}

function activeObservations(result, subject = 'char-a') {
  return result.characters[subject]?.active_observations ?? [];
}

test('independent observations keep separate lifecycle boundaries', () => {
  const events = [
    event({id: 'pain', kind: 'pain', day: 0, bodySite: 'wrist', laterality: 'left'}),
    event({id: 'abrasion', kind: 'abrasion', day: 0, bodySite: 'wrist', laterality: 'left'}),
  ];
  const assessments = [assessment({eventId: 'pain', day: 0, expectedDay: 3}), assessment({eventId: 'abrasion', day: 0, expectedDay: 5})];
  const day2 = deriveCurrentHealthState({events, assessments, currentStoryTime: story(2)});
  assert.deepEqual(activeObservations(day2).map(item => item.source_event_id), ['abrasion', 'pain']);
  const day3 = deriveCurrentHealthState({events, assessments, currentStoryTime: story(3)});
  assert.deepEqual(activeObservations(day3).map(item => item.source_event_id), ['abrasion']);
  const day5 = deriveCurrentHealthState({events, assessments, currentStoryTime: story(5)});
  assert.deepEqual(day5.characters, {});
});

test('same site does not share deadlines and duplicate display issues retain active sources', () => {
  const events = [
    event({id: 'pain-a', kind: 'pain', bodySite: 'wrist', laterality: 'left'}),
    event({id: 'pain-b', kind: 'pain', bodySite: 'wrist', laterality: 'left'}),
  ];
  const assessments = [assessment({eventId: 'pain-a', expectedDay: 3}), assessment({eventId: 'pain-b', expectedDay: 5})];
  const day3 = deriveCurrentHealthState({events, assessments, currentStoryTime: story(3)});
  assert.equal(activeObservations(day3).length, 1);
  assert.deepEqual(day3.characters['char-a'].grouped_issues[0].source_observation_ids, ['pain-b']);
  const day5 = deriveCurrentHealthState({events, assessments, currentStoryTime: story(5)});
  assert.deepEqual(day5.characters, {});
});

test('different site and laterality remain separate presentation groups', () => {
  const events = [
    event({id: 'left-wrist', kind: 'pain', bodySite: 'wrist', laterality: 'left'}),
    event({id: 'right-wrist', kind: 'pain', bodySite: 'wrist', laterality: 'right'}),
    event({id: 'ankle', kind: 'sprain', bodySite: 'ankle', laterality: 'right'}),
  ];
  const result = deriveCurrentHealthState({events, assessments: events.map(item => assessment({eventId: item.event_id, expectedDay: 100})), currentStoryTime: story(2)});
  assert.equal(result.characters['char-a'].grouped_issues.length, 3);
});

test('interventions do not enter Current Health presentation or severity', () => {
  const observation = event({id: 'laceration', kind: 'laceration', description: '右臂外侧有血口', bodySite: '右臂外侧', laterality: 'right'});
  const intervention = event({id: 'treatment', type: 'medical_event', kind: 'wound_treatment', description: '外敷止血药粉', bodySite: '右臂外侧', laterality: 'right', healthRole: 'intervention'});
  const result = deriveCurrentHealthState({
    events: [observation, intervention],
    assessments: [assessment({eventId: 'laceration', severity: 'mild', expectedDay: 100})],
    currentStoryTime: story(2),
  });
  const character = result.characters['char-a'];
  assert.equal(character.grouped_issues.length, 1);
  assert.equal(character.grouped_issues[0].health_observations.length, 1);
  assert.equal('medical_interventions' in character, false);
  assert.deepEqual(character.grouped_issues[0].source_event_ids, ['laceration']);
  assert.deepEqual(character.active_observations.map(item => item.source_event_id), ['laceration']);
  assert.equal(character.severity_summary, 'mild');
});

test('same site observations with different factual kinds remain one site group', () => {
  const result = deriveCurrentHealthState({
    events: [
      event({id: 'wound', kind: 'laceration', bodySite: '右臂外侧', laterality: 'right'}),
      event({id: 'pain', kind: 'pain', bodySite: '右臂外侧', laterality: 'right'}),
    ],
    assessments: [assessment({eventId: 'wound', expectedDay: 100}), assessment({eventId: 'pain', expectedDay: 100})],
    currentStoryTime: story(2),
  });
  assert.equal(result.characters['char-a'].grouped_issues.length, 1);
  assert.deepEqual(result.characters['char-a'].grouped_issues[0].source_observation_ids.sort(), ['pain', 'wound']);
});

test('intervention-only health data does not create Current Health state', () => {
  const result = deriveCurrentHealthState({
    events: [event({id: 'treatment', type: 'medical_event', kind: 'wound_treatment', healthRole: 'intervention'})],
    assessments: [],
    currentStoryTime: story(2),
  });
  assert.deepEqual(result.characters, {});
});

test('missing body site remains active in a general read-model group without mutating Event', () => {
  const source = event({id: 'fever', kind: 'fever', description: '全身发热，但正文没有结构化部位字段'});
  const before = structuredClone(source);
  const result = deriveCurrentHealthState({events: [source], assessments: [assessment({eventId: 'fever', expectedDay: 10})], currentStoryTime: story(2)});
  assert.equal(result.characters['char-a'].grouped_issues[0].display_site, 'general');
  assert.equal(result.characters['char-a'].active_observations[0].body_site, null);
  assert.deepEqual(source, before);
});

test('factual health description survives evolution and presentation aggregation', () => {
  const description = '大腿根部与腰侧肌肉钝痛，下腹沉坠淤痛，胯骨酸软且体虚无力';
  const source = event({id: 'pelvic-pain', kind: 'pain_and_soreness', description, bodySite: '大腿根部、腰侧、胯骨、下腹'});
  const result = deriveCurrentHealthState({
    events: [source],
    assessments: [assessment({eventId: 'pelvic-pain', expectedDay: 10})],
    currentStoryTime: story(2),
  });
  assert.equal(result.characters['char-a'].active_observations[0].description, description);
  assert.equal(result.characters['char-a'].grouped_issues[0].description, description);
  assert.equal(result.characters['char-a'].grouped_issues[0].display_site, '大腿根部、腰侧、胯骨、下腹');
});

test('earliest recovery does not close an observation', () => {
  const saved = assessment({expectedDay: 10});
  saved.earliest_recovery = {duration: null, boundary: story(3)};
  const result = deriveCurrentHealthState({events: [event()], assessments: [saved], currentStoryTime: story(5)});
  assert.equal(activeObservations(result).length, 1);
});

test('long-term and permanent observations remain active after large jumps', () => {
  const events = [event({id: 'long', kind: 'heart_disease'}), event({id: 'perm', kind: 'amputation'})];
  const assessments = [assessment({eventId: 'long', persistence: 'long_term'}), assessment({eventId: 'perm', persistence: 'permanent'})];
  const result = deriveCurrentHealthState({events, assessments, currentStoryTime: story(3650)});
  assert.equal(activeObservations(result).length, 2);
});

test('incomparable Story Time stays conservatively active', () => {
  const result = deriveCurrentHealthState({events: [event()], assessments: [assessment({expectedDay: 10})], currentStoryTime: story(10, 'other-calendar')});
  assert.equal(activeObservations(result).length, 1);
});

test('explicit observations without Assessments remain represented without a deadline', () => {
  const result = deriveCurrentHealthState({events: [event()], assessments: [], currentStoryTime: story(100)});
  assert.equal(activeObservations(result)[0].assessment_id, null);
  assert.equal(activeObservations(result)[0].expected_recovery, null);
});

test('Evolution transparently forwards Assessment severity and defaults legacy data to unknown', () => {
  const assessed = deriveCurrentHealthState({
    events: [event({id: 'severe-event'})],
    assessments: [assessment({eventId: 'severe-event', severity: 'severe', expectedDay: 100})],
    currentStoryTime: story(2),
  });
  assert.equal(activeObservations(assessed)[0].severity, 'severe');
  assert.equal(assessed.characters['char-a'].active_observations[0].recovery_stage_guidance.early, 'early-severe-event');

  const legacy = deriveCurrentHealthState({
    events: [event({id: 'legacy-event'})],
    assessments: [assessment({eventId: 'legacy-event', expectedDay: 100})],
    currentStoryTime: story(2),
  });
  assert.equal(activeObservations(legacy)[0].severity, 'unknown');
});

test('Evolution forwards the source-bound recovery profile without changing lifecycle semantics', () => {
  const result = deriveCurrentHealthState({
    events: [event({id: 'profiled'})],
    assessments: [assessment({eventId: 'profiled', expectedDay: 10})],
    currentStoryTime: story(2),
  });
  assert.deepEqual(result.characters['char-a'].active_observations[0].recovery_stage_guidance, {
    early: 'early-profiled',
    recovering: 'recovering-profiled',
    near_recovery: 'near-profiled',
  });
  assert.equal(result.characters['char-a'].active_observations[0].recovery_stage, 'early');
  assert.equal(result.characters['char-a'].active_observations[0].current_description, 'early-profiled');
  assert.equal(result.characters['char-a'].grouped_issues[0].recovery_stage, 'early');
  assert.equal(result.characters['char-a'].grouped_issues[0].current_description, 'early-profiled');
  assert.equal(deriveCurrentHealthState({
    events: [event({id: 'profiled'})],
    assessments: [assessment({eventId: 'profiled', expectedDay: 2})],
    currentStoryTime: story(2),
  }).characters['char-a'], undefined);
});

test('Current Health display description follows the persisted guidance for each stage', () => {
  const events = [event({id: 'stage-event', description: '原始伤口事实'})];
  const assessments = [assessment({eventId: 'stage-event', expectedDuration: 9})];
  const stages = [
    [1, 'early', 'early-stage-event'],
    [4, 'recovering', 'recovering-stage-event'],
    [7, 'near_recovery', 'near-stage-event'],
  ];
  for (const [day, stage, description] of stages) {
    const result = deriveCurrentHealthState({events, assessments, currentStoryTime: story(day)});
    const observation = result.characters['char-a'].active_observations[0];
    assert.equal(observation.recovery_stage, stage);
    assert.equal(observation.description, '原始伤口事实');
    assert.equal(observation.current_description, description);
    assert.equal(result.characters['char-a'].grouped_issues[0].health_observations[0].current_description, description);
  }
});

test('Current Health falls back to factual description without valid staged guidance', () => {
  const result = deriveCurrentHealthState({
    events: [event({id: 'fallback-event', description: '原始事实描述'})],
    assessments: [assessment({eventId: 'fallback-event', expectedDuration: 9, persistence: 'long_term'})],
    currentStoryTime: story(4),
  });
  const observation = result.characters['char-a'].active_observations[0];
  assert.equal(observation.recovery_stage, null);
  assert.equal(observation.current_description, '原始事实描述');
});

test('recovery duration drives the stage when staged guidance is absent', () => {
  const profileless = assessment({eventId: 'two-day-fever', expectedDuration: 2});
  profileless.recovery_stage_guidance = null;
  const result = deriveCurrentHealthState({
    events: [event({id: 'two-day-fever', kind: 'fever', description: '发热'})],
    assessments: [profileless],
    currentStoryTime: story(1),
  });
  const observation = result.characters['char-a'].active_observations[0];
  assert.equal(observation.recovery_stage, 'early');
  assert.equal(observation.current_description, '发热');
  assert.equal(observation.recovery_stage_guidance, null);
});

test('Grouped observations keep different current descriptions instead of first-wins', () => {
  const result = deriveCurrentHealthState({
    events: [
      event({id: 'first', bodySite: 'wrist', laterality: 'left'}),
      event({id: 'second', bodySite: 'wrist', laterality: 'left'}),
    ],
    assessments: [
      assessment({eventId: 'first', expectedDuration: 9}),
      assessment({eventId: 'second', expectedDuration: 9, id: 'assessment-second'}),
    ],
    currentStoryTime: story(1),
  });
  const group = result.characters['char-a'].grouped_issues[0];
  assert.equal(group.current_description, null);
  assert.deepEqual(group.health_observations.map(item => item.current_description), ['early-first', 'early-second']);
});

test('grouped issues omit recovery stage when independent observations disagree', () => {
  const result = deriveCurrentHealthState({
    events: [
      event({id: 'early-event', bodySite: 'wrist', laterality: 'left'}),
      event({id: 'recovering-event', bodySite: 'wrist', laterality: 'left'}),
    ],
    assessments: [
      assessment({eventId: 'early-event', expectedDuration: 9}),
      assessment({eventId: 'recovering-event', expectedDuration: 15}),
    ],
    currentStoryTime: story(4),
  });
  const group = result.characters['char-a'].grouped_issues[0];
  assert.equal(group.recovery_stage, null);
  assert.deepEqual(group.health_observations.map(item => item.recovery_stage), ['recovering', 'early']);
});

test('legacy or unresolved observations do not expose a recovery stage', () => {
  const result = deriveCurrentHealthState({
    events: [event({id: 'legacy-profile'})],
    assessments: [assessment({eventId: 'legacy-profile', expectedRecovery: null})],
    currentStoryTime: story(2),
  });
  assert.equal(activeObservations(result)[0].recovery_stage, null);
  assert.equal(result.characters['char-a'].grouped_issues[0].recovery_stage, null);
});

test('legacy Event without health_role is excluded even with an existing source Assessment', () => {
  const legacyEvent = event({id: 'legacy-event', healthRole: null});
  const withoutAssessment = deriveCurrentHealthState({
    events: [legacyEvent],
    assessments: [],
    currentStoryTime: story(2),
  });
  assert.deepEqual(withoutAssessment.characters, {});

  const withAssessment = deriveCurrentHealthState({
    events: [legacyEvent],
    assessments: [assessment({eventId: 'legacy-event', expectedDay: 100})],
    currentStoryTime: story(2),
  });
  assert.deepEqual(withAssessment.characters, {});
});

test('legacy treatment Assessment cannot raise explicit observation severity summary', () => {
  const legacyTreatment = event({id: 'legacy-treatment', type: 'medical_event', kind: 'wound_treatment', healthRole: null, bodySite: '右臂外侧', laterality: 'right'});
  const observation = event({id: 'mild-wound', kind: 'laceration', healthRole: 'observation', bodySite: '右臂外侧', laterality: 'right'});
  const result = deriveCurrentHealthState({
    events: [legacyTreatment, observation],
    assessments: [
      assessment({eventId: 'legacy-treatment', severity: 'moderate', expectedDay: 100}),
      assessment({eventId: 'mild-wound', severity: 'mild', expectedDay: 100}),
    ],
    currentStoryTime: story(2),
  });
  assert.equal(result.characters['char-a'].severity_summary, 'mild');
});

test('presentation severity summary ranks active observations without mutating them', () => {
  const observations = [
    {severity: 'mild'},
    {severity: 'MODERATE'},
    {severity: 'invalid'},
    {severity: 'severe'},
  ];
  const before = structuredClone(observations);
  assert.equal(summarizeActiveHealthSeverity(observations), 'severe');
  assert.deepEqual(observations, before);
  assert.equal(summarizeActiveHealthSeverity([{severity: 'unknown'}, {severity: 'invalid'}]), 'unknown');
  assert.equal(summarizeActiveHealthSeverity([{severity: 'unknown'}, {severity: 'mild'}]), 'mild');
  assert.equal(summarizeActiveHealthSeverity([{severity: 'mild'}, {severity: 'moderate'}]), 'moderate');
  assert.equal(summarizeActiveHealthSeverity([{severity: 'moderate'}, {severity: 'severe'}]), 'severe');
  assert.equal(summarizeActiveHealthSeverity([{severity: 'mild'}, {severity: 'severe'}]), 'severe');
  assert.equal(summarizeActiveHealthSeverity([]), 'normal');
});

test('Evolution exposes severity summary only for surviving active observations', () => {
  const result = deriveCurrentHealthState({
    events: [event({id: 'mild-active'}), event({id: 'severe-closed'})],
    assessments: [
      assessment({eventId: 'mild-active', severity: 'mild', expectedDay: 100}),
      assessment({eventId: 'severe-closed', severity: 'severe', expectedDay: 2}),
    ],
    currentStoryTime: story(3),
  });
  assert.equal(result.characters['char-a'].severity_summary, 'mild');
  assert.equal(deriveCurrentHealthState({
    events: [event({id: 'closed-only'})],
    assessments: [assessment({eventId: 'closed-only', severity: 'severe', expectedDay: 2})],
    currentStoryTime: story(3),
  }).characters['char-a'], undefined);
});

test('different characters do not share observations', () => {
  const events = [event({id: 'a', subject: 'char-a'}), event({id: 'b', subject: 'char-b'})];
  const result = deriveCurrentHealthState({events, assessments: events.map(item => assessment({eventId: item.event_id, expectedDay: 100})), currentStoryTime: story(2)});
  assert.equal(activeObservations(result, 'char-a').length, 1);
  assert.equal(activeObservations(result, 'char-b').length, 1);
});

test('non-health Events never enter the Health State', () => {
  const result = deriveCurrentHealthState({events: [event({type: 'sexual_activity'})], assessments: [], currentStoryTime: story(2)});
  assert.deepEqual(result.characters, {});
});

test('closure changes only the derived read model', () => {
  const events = [event()];
  const assessments = [assessment({expectedDay: 3})];
  const snapshot = structuredClone({events, assessments});
  assert.deepEqual(deriveCurrentHealthState({events, assessments, currentStoryTime: story(3)}).characters, {});
  assert.deepEqual({events, assessments}, snapshot);
});

test('direct Story Time jumps are evaluated without intermediate events', () => {
  const result = deriveCurrentHealthState({events: [event({day: 10})], assessments: [assessment({day: 10, expectedDuration: 7})], currentStoryTime: story(90)});
  assert.deepEqual(result.characters, {});
});

test('active Assessment filtering remains source-bound', () => {
  const source = event();
  const saved = {
    ...assessment({expectedDay: 10}), request_key: 'key-a', source_floor_version: version,
    source_observation_fingerprint: healthObservationFingerprint(source),
  };
  assert.equal(activeHealthAssessments({timeline: {assessments: [saved]}, events: [source], floorVersion: version}).length, 1);
  assert.equal(activeHealthAssessments({timeline: {assessments: [saved]}, events: [], floorVersion: version}).length, 0);
});

test('repeated evaluation is deterministic', () => {
  const input = {events: [event()], assessments: [assessment({expectedDay: 10})], currentStoryTime: story(5)};
  assert.deepEqual(deriveCurrentHealthState(input), deriveCurrentHealthState(structuredClone(input)));
});

test('expiredHealthEventIds identifies only reached short-term natural recovery boundaries', () => {
  const fever = event({id: 'fever', kind: 'fever', day: 1});
  const wound = event({id: 'wound', kind: 'abrasion', day: 1});
  assert.deepEqual(expiredHealthEventIds({
    events: [fever, wound],
    assessments: [
      assessment({eventId: 'fever', day: 1, expectedDay: 3}),
      assessment({eventId: 'wound', day: 1, expectedDay: 11}),
    ],
    currentStoryTime: story(4),
  }), ['fever']);
});

test('expiredHealthEventIds is conservative for missing profiles and current facts', () => {
  const fever = event({id: 'fever', kind: 'fever'});
  assert.deepEqual(expiredHealthEventIds({
    events: [fever],
    assessments: [assessment({eventId: 'fever', expectedDay: 2})],
    currentStoryTime: story(3),
    protectedEventIds: ['fever'],
  }), []);
  assert.deepEqual(expiredHealthEventIds({
    events: [fever],
    assessments: [assessment({eventId: 'fever', expectedRecovery: null})],
    currentStoryTime: story(3),
  }), []);
});
