import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBuiltInPreConfirmationRules, evaluateProjectionEligibility, evaluateProjectionEvolution, isLegacyBuiltInPreConfirmationProjection, LEGACY_BUILT_IN_PRE_CONFIRMATION_DESCRIPTION, matchBuiltInObservedReaction, validateProjectionRule} from '../core/projection-eligibility.js';

const SUBJECT = 'char_000001';
const SOURCE_B = 'char_000002';
const SOURCE_C = 'char_000003';

function story(day, calendar_id = 'main') { return {display: `Day ${day}`, normalized: `day-${day}`, day_index: day, calendar_id, precision: 'day'}; }
function exposure(event_id, day, source = SOURCE_B, mechanism = 'mechanism:implant') { return {event_id, type: 'sexual_activity', status: 'confirmed', story_time: story(day), pregnancy_relevance: {relevant: true, gestational_subject_ids: [SUBJECT], counterpart_ids: [source], reproductive_mechanism: {kind: mechanism}}}; }
function eraStory(display, precision = 'day') { return {display, normalized: null, day_index: null, calendar_id: null, precision}; }
function eraExposure(event_id, display, source = SOURCE_B, precision = 'day') { return {event_id, type: 'sexual_activity', status: 'confirmed', story_time: eraStory(display, precision), pregnancy_relevance: {relevant: true, gestational_subject_ids: [SUBJECT], counterpart_ids: [source], reproductive_mechanism: {kind: 'mechanism:implant'}}}; }
function factual(event_id, type, status = 'confirmed') { return {event_id, type, status, story_time: story(10), state_fact: {subject_id: SUBJECT, payload: {}}}; }
function rule(overrides = {}) { return {schema_version: 1, projection_rule_id: 'rule:implant-change-v1', mechanism_key: 'mechanism:implant', development_concern_key: 'concern:implant-change', development_kind: 'possible_biological_change', trigger: {kind: 'elapsed_after_event', source_event_type: 'sexual_activity', min_elapsed_story_days: 5}, requirements: {capabilities: [{key: 'can_carry_pregnancy', equals: true}], source_compatibility: 'required_true', contributor_relationships: []}, realization: {event_types: ['medical_event']}, contradiction: {event_types: ['other_biological']}, ...overrides}; }
function state(capability = true, extra = {}) { return {characters: {[SUBJECT]: {reproductive_capabilities: {can_carry_pregnancy: capability}, pregnancy: {episodes: {}, ...extra}}}}; }
function candidate(source_character_id, compatibility = true) { return {subject_id: SUBJECT, source_character_id, source_event_ids: [`event-${source_character_id}`], mechanism_key: 'mechanism:implant', contribution_kind: 'genetic', compatibility}; }
function evaluate(overrides = {}) { return evaluateProjectionEligibility({currentState: state(), events: [exposure('e1', 0), exposure('e2', 1, SOURCE_C)], sourceCandidates: [candidate(SOURCE_B), candidate(SOURCE_C)], worldModel: {projection_rules: [rule()]}, currentStoryTime: story(10), ...overrides}); }

test('projection rule contract is deterministic and rejects outcome/probability fields', () => {
  assert.equal(validateProjectionRule(rule()).ok, true);
  assert.equal(validateProjectionRule({...rule(), probability: 0.5}).ok, false);
  assert.equal(validateProjectionRule({...rule(), trigger: {kind: 'unknown'}}).ok, false);
});
test('matching exposure, capability, candidate compatibility, and Story Time produce eligible decision', () => {
  const result = evaluate();
  assert.equal(result.decisions.length, 1);
  assert.equal(result.decisions[0].eligibility, 'eligible');
  assert.deepEqual(result.decisions[0].source_event_ids, ['e1', 'e2', 'event-char_000002', 'event-char_000003']);
});
test('projection orders comparable era events by Story Time instead of event ID', () => {
  const result = evaluate({
    events: [
      eraExposure('z-earlier', '羲和元年三月四日'),
      eraExposure('a-later', '羲和元年三月十五日', SOURCE_C),
    ],
    sourceCandidates: [candidate(SOURCE_B), candidate(SOURCE_C)],
    currentStoryTime: eraStory('羲和元年三月二十日'),
  });
  assert.equal(result.decisions[0].eligibility, 'eligible');
  assert.equal(result.decisions[0].reference_event_id, 'z-earlier');
  assert.deepEqual(result.decisions[0].exposure_event_ids, ['z-earlier', 'a-later']);
});
test('projection orders same-day era events by comparable traditional time', () => {
  const result = evaluate({
    events: [
      eraExposure('z-earlier', '羲和元年三月二十日 午时', SOURCE_B, 'hour'),
      eraExposure('a-later', '羲和元年三月二十日 酉时', SOURCE_C, 'hour'),
    ],
    sourceCandidates: [candidate(SOURCE_B), candidate(SOURCE_C)],
    currentStoryTime: eraStory('羲和元年三月三十日', 'day'),
  });
  assert.equal(result.decisions[0].eligibility, 'eligible');
  assert.equal(result.decisions[0].reference_event_id, 'z-earlier');
  assert.deepEqual(result.decisions[0].exposure_event_ids, ['z-earlier', 'a-later']);
});
test('projection uses event ID only as a stable tie breaker for identical Story Time', () => {
  const result = evaluate({
    events: [
      eraExposure('z-same', '羲和元年三月二十日 午时', SOURCE_B, 'hour'),
      eraExposure('a-same', '羲和元年三月二十日 午时', SOURCE_C, 'hour'),
    ],
    sourceCandidates: [candidate(SOURCE_B), candidate(SOURCE_C)],
    currentStoryTime: eraStory('羲和元年三月三十日'),
  });
  assert.equal(result.decisions[0].eligibility, 'eligible');
  assert.equal(result.decisions[0].reference_event_id, 'a-same');
  assert.deepEqual(result.decisions[0].exposure_event_ids, ['a-same', 'z-same']);
});
test('projection keeps different-era events unresolved instead of inferring an order', () => {
  const result = evaluate({
    events: [eraExposure('tianhe-event', '天河元年三月四日')],
    sourceCandidates: [candidate(SOURCE_B)],
    currentStoryTime: eraStory('羲和元年三月二十日'),
  });
  assert.equal(result.decisions[0].eligibility, 'unresolved');
  assert.equal(result.decisions[0].reason_code, 'story_time_incomparable');
});
test('projection keeps incomparable candidates stable while comparable candidates retain eligibility semantics', () => {
  const result = evaluate({
    events: [
      eraExposure('z-earlier', '羲和元年三月四日', SOURCE_B),
      eraExposure('unknown-event', '第三日', SOURCE_C),
    ],
    sourceCandidates: [candidate(SOURCE_B), candidate(SOURCE_C)],
    currentStoryTime: eraStory('羲和元年三月二十日'),
  });
  assert.equal(result.decisions[0].eligibility, 'eligible');
  assert.equal(result.decisions[0].reference_event_id, 'z-earlier');
  assert.deepEqual(result.decisions[0].exposure_event_ids, ['z-earlier', 'unknown-event']);
});
test('multiple exposures share one concern decision and existing identity is not recreated', () => {
  const result = evaluate({existingProjections: [{projection_id: 'projection-existing', subject_id: SUBJECT, projection_rule_id: 'rule:implant-change-v1', development_concern_key: 'concern:implant-change'}]});
  assert.equal(result.decisions.length, 1);
  assert.equal(result.decisions[0].existing_projection_id, 'projection-existing');
  assert.equal(result.decisions[0].projection_rule_id, 'rule:implant-change-v1');
});
test('capability null, unknown compatibility, and incomparable Story Time are unresolved', () => {
  assert.equal(evaluate({currentState: state(null)}).decisions[0].eligibility, 'unresolved');
  assert.equal(evaluate({sourceCandidates: [candidate(SOURCE_B, null), candidate(SOURCE_C, null)]}).decisions[0].eligibility, 'unresolved');
  assert.equal(evaluate({currentStoryTime: story(10, 'other')}).decisions[0].eligibility, 'unresolved');
});
test('explicit incompatibility and unmet trigger are not eligible', () => {
  assert.equal(evaluate({sourceCandidates: [candidate(SOURCE_B, false), candidate(SOURCE_C, false)]}).decisions[0].eligibility, 'not_eligible');
  assert.equal(evaluate({currentStoryTime: story(2)}).decisions[0].eligibility, 'not_eligible');
  assert.equal(evaluate({currentState: state(false)}).decisions[0].eligibility, 'not_eligible');
});
test('aggregation path fails closed with a stable reason when evidence cannot be built', () => {
  const result = evaluate({
    preConfirmationTiming: {
      enabled: false,
      instances: [{subject_id: SUBJECT, mechanism_key: 'mechanism:implant', cycle_id: 'cycle-1', timing_instance_id: 'timing-1', source_event_ids: ['e1']}],
      aggregations: [{aggregation_id: 'aggregation-1', subject_id: SUBJECT, mechanism_key: 'mechanism:implant', cycle_id: 'cycle-1', accepted_exposure_event_ids: []}],
    },
  });
  assert.equal(result.decisions[0].eligibility, 'not_eligible');
  assert.equal(result.decisions[0].reason_code, 'participant_aggregation_evidence_invalid');
  assert.equal(result.decisions[0].aggregation_path, 'participant_aggregation');
});
test('aggregation path keeps current valid evidence when one historical source is missing', () => {
  const result = evaluate({
    events: [exposure('e1', 0)],
    sourceCandidates: [candidate(SOURCE_B)],
    currentStoryTime: story(17),
    preConfirmationTiming: {
      enabled: true,
      instances: [{subject_id: SUBJECT, mechanism_key: 'mechanism:implant', cycle_id: 'cycle-partial', timing_instance_id: 'timing-partial', source_event_ids: ['e1', 'missing'], reference_story_time: story(0), effective_min_story_days: 14, effective_max_story_days: 42}],
      windows: [{tracking_window_id: 'window-partial', subject_id: SUBJECT, mechanism_key: 'mechanism:implant', cycle_id: 'cycle-partial', status: 'open', source_event_ids: ['e1', 'missing']}],
      aggregations: [{aggregation_id: 'aggregation-partial', subject_id: SUBJECT, mechanism_key: 'mechanism:implant', cycle_id: 'cycle-partial', pregnancy_id: null, status: 'succeeded', accepted_exposure_event_ids: ['e1', 'missing']}],
    },
  });
  assert.equal(result.decisions[0].eligibility, 'eligible');
  assert.equal(result.decisions[0].reason_code, 'elapsed_threshold_reached');
  assert.deepEqual(result.decisions[0].aggregation_evidence.accepted_exposure_event_ids, ['e1']);
  assert.deepEqual(result.decisions[0].aggregation_evidence_invalid_event_ids, ['missing']);
});
test('missing World Model rule is unresolved at the rule layer and does not create facts', () => {
  const events = [exposure('e1', 0)]; const before = structuredClone(events); const result = evaluateProjectionEligibility({currentState: state(), events, worldModel: {}, currentStoryTime: story(10)});
  assert.deepEqual(result.decisions, []);
  assert.equal(result.diagnostics[0].code, 'projection_rules_unavailable');
  assert.deepEqual(events, before);
});

test('empty projection rules provide independent built-in observation branches with stable identities', () => {
  const rules = buildBuiltInPreConfirmationRules({
    instances: [{mechanism_key: 'fertilization'}],
  });
  assert.equal(rules.length, 12);
  assert.equal(new Set(rules.map(rule => rule.projection_rule_id)).size, 12);
  assert.equal(new Set(rules.map(rule => rule.development_concern_key)).size, 12);
  assert.deepEqual(
    rules.map(rule => rule.development_concern_key).sort(),
    [
      'pre_confirmation_observation:fatigue',
      'pre_confirmation_observation:breast_sensitivity',
      'pre_confirmation_observation:scent_food_change',
      'pre_confirmation_observation:no_reaction_early',
      'pre_confirmation_observation:nausea',
      'pre_confirmation_observation:odor_discomfort',
      'pre_confirmation_observation:mood_change',
      'pre_confirmation_observation:appetite_change',
      'pre_confirmation_observation:nausea_worsening',
      'pre_confirmation_observation:vomiting',
      'pre_confirmation_observation:persistent_fatigue',
      'pre_confirmation_observation:no_reaction_late',
    ].sort(),
  );
});
test('built-in observation branches use the agreed elapsed-day windows', () => {
  const rules = buildBuiltInPreConfirmationRules({
    instances: [{mechanism_key: 'fertilization'}],
  });
  assert.deepEqual(
    Object.fromEntries(rules.map(item => [item.development_concern_key.split(':').at(-1), item.trigger.min_elapsed_story_days])),
    {
      fatigue: 14,
      breast_sensitivity: 14,
      scent_food_change: 14,
      no_reaction_early: 14,
      nausea: 21,
      odor_discomfort: 21,
      mood_change: 21,
      appetite_change: 21,
      nausea_worsening: 28,
      vomiting: 28,
      persistent_fatigue: 28,
      no_reaction_late: 28,
    },
  );
  assert.ok(rules.every(item => item.trigger.kind === 'elapsed_after_event'));
  assert.deepEqual(
    Object.fromEntries(rules.map(item => [item.development_concern_key.split(':').at(-1), item.expiration.trigger.min_elapsed_story_days])),
    {
      fatigue: 21,
      breast_sensitivity: 21,
      scent_food_change: 21,
      no_reaction_early: 21,
      nausea: 28,
      odor_discomfort: 28,
      mood_change: 28,
      appetite_change: 28,
      nausea_worsening: 43,
      vomiting: 43,
      persistent_fatigue: 43,
      no_reaction_late: 43,
    },
  );
});

function observedReactionEvent({subjectId = SUBJECT, kind = 'nausea', day = 23, status = 'confirmed', healthRole = 'observation', description = '正文记录'} = {}) {
  return {
    event_id: `symptom-${subjectId}-${kind}-${day}`,
    type: 'physical_symptom',
    status,
    story_time: story(day),
    source_evidence: [{type: 'narrative', text: description}],
    state_fact: {subject_id: subjectId, payload: {symptom: {kind, description, health_role: healthRole}}},
  };
}

function observedReactionProjection({subjectId = SUBJECT, concern = 'nausea', referenceDay = 0} = {}) {
  return {
    subject_id: subjectId,
    development_concern_key: `pre_confirmation_observation:${concern}`,
    timing: {reference_story_time: story(referenceDay)},
  };
}

test('built-in observed reaction matching is exact, subject-local, and time-bounded', () => {
  const event = observedReactionEvent({description: '闻到气味后恶心，食欲也下降'});
  const before = structuredClone(event);
  assert.deepEqual(
    matchBuiltInObservedReaction({projectionView: observedReactionProjection(), events: [event]}),
    {matched: true, matched_event_ids: [event.event_id], matched_kind: 'nausea', reason_code: 'EXACT_STRUCTURED_KIND_MATCH'},
  );
  assert.deepEqual(event, before);
  assert.equal(matchBuiltInObservedReaction({projectionView: observedReactionProjection({subjectId: SOURCE_B}), events: [event]}).matched, false);
  assert.equal(matchBuiltInObservedReaction({projectionView: observedReactionProjection({concern: 'odor_discomfort'}), events: [event]}).matched, false);
  assert.equal(matchBuiltInObservedReaction({projectionView: observedReactionProjection({concern: 'nausea_worsening'}), events: [event]}).matched, false);
  assert.equal(matchBuiltInObservedReaction({projectionView: observedReactionProjection(), events: [observedReactionEvent({kind: 'odor_discomfort', description: '恶心'}), event]}).matched, true);
  assert.equal(matchBuiltInObservedReaction({projectionView: observedReactionProjection(), events: [observedReactionEvent({day: 20})]}).matched, false);
  assert.equal(matchBuiltInObservedReaction({projectionView: observedReactionProjection(), events: [observedReactionEvent({day: 28})]}).matched, false);
  assert.equal(matchBuiltInObservedReaction({projectionView: observedReactionProjection(), events: [observedReactionEvent({healthRole: 'intervention'})]}).matched, false);
  assert.equal(matchBuiltInObservedReaction({projectionView: observedReactionProjection(), events: [observedReactionEvent({status: 'negated'})]}).matched, false);
});
test('built-in observation branches advance by elapsed days for every complete subject', () => {
  const secondSubject = 'char_000003';
  const secondEvent = structuredClone(exposure('e3', 0));
  secondEvent.pregnancy_relevance.gestational_subject_ids = [secondSubject];
  const result = evaluate({
    currentState: {characters: {[SUBJECT]: {}, [secondSubject]: {}}},
    events: [exposure('e1', 0), secondEvent],
    sourceCandidates: [],
    worldModel: {projection_rules: []},
    currentStoryTime: story(17),
    preConfirmationTiming: {
      enabled: true,
      instances: [
        {subject_id: SUBJECT, mechanism_key: 'mechanism:implant', cycle_id: 'cycle-1', timing_instance_id: 'timing-1', source_event_ids: ['e1'], reference_story_time: story(0), effective_min_story_days: 14, effective_max_story_days: 42},
        {subject_id: secondSubject, mechanism_key: 'mechanism:implant', cycle_id: 'cycle-2', timing_instance_id: 'timing-2', source_event_ids: ['e3'], reference_story_time: story(0), effective_min_story_days: 14, effective_max_story_days: 42},
      ],
      windows: [
        {tracking_window_id: 'window-1', subject_id: SUBJECT, mechanism_key: 'mechanism:implant', cycle_id: 'cycle-1', status: 'open', source_event_ids: ['e1']},
        {tracking_window_id: 'window-2', subject_id: secondSubject, mechanism_key: 'mechanism:implant', cycle_id: 'cycle-2', status: 'open', source_event_ids: ['e3']},
      ],
      aggregations: [
        {aggregation_id: 'aggregation-1', subject_id: SUBJECT, mechanism_key: 'mechanism:implant', cycle_id: 'cycle-1', pregnancy_id: null, status: 'succeeded', accepted_exposure_event_ids: ['e1']},
        {aggregation_id: 'aggregation-2', subject_id: secondSubject, mechanism_key: 'mechanism:implant', cycle_id: 'cycle-2', pregnancy_id: null, status: 'succeeded', accepted_exposure_event_ids: ['e3']},
      ],
    },
  });
  const eligible = result.decisions
    .filter(item => item.eligibility === 'eligible')
    .map(item => `${item.subject_id}:${item.development_concern_key}`)
    .sort();
  assert.deepEqual(eligible, [
    `${SUBJECT}:pre_confirmation_observation:fatigue`,
    `${SUBJECT}:pre_confirmation_observation:breast_sensitivity`,
    `${SUBJECT}:pre_confirmation_observation:scent_food_change`,
    `${SUBJECT}:pre_confirmation_observation:no_reaction_early`,
    `${secondSubject}:pre_confirmation_observation:fatigue`,
    `${secondSubject}:pre_confirmation_observation:breast_sensitivity`,
    `${secondSubject}:pre_confirmation_observation:scent_food_change`,
    `${secondSubject}:pre_confirmation_observation:no_reaction_early`,
  ].sort());
});
test('built-in observation branches follow each elapsed-day stage', () => {
  const timing = {
    enabled: true,
    instances: [{subject_id: SUBJECT, mechanism_key: 'mechanism:implant', cycle_id: 'cycle-stages', timing_instance_id: 'timing-stages', source_event_ids: ['e1'], reference_story_time: story(0), effective_min_story_days: 14, effective_max_story_days: 42}],
    windows: [{tracking_window_id: 'window-stages', subject_id: SUBJECT, mechanism_key: 'mechanism:implant', cycle_id: 'cycle-stages', status: 'open', source_event_ids: ['e1']}],
    aggregations: [{aggregation_id: 'aggregation-stages', subject_id: SUBJECT, mechanism_key: 'mechanism:implant', cycle_id: 'cycle-stages', pregnancy_id: null, status: 'succeeded', accepted_exposure_event_ids: ['e1']}],
  };
  const expected = new Map([
    [17, ['fatigue', 'breast_sensitivity', 'scent_food_change', 'no_reaction_early']],
    [23, ['nausea', 'odor_discomfort', 'mood_change', 'appetite_change']],
    [35, ['nausea_worsening', 'vomiting', 'persistent_fatigue', 'no_reaction_late']],
  ]);
  for (const [day, keys] of expected) {
    const result = evaluate({worldModel: {projection_rules: []}, currentStoryTime: story(day), preConfirmationTiming: timing});
    assert.deepEqual(
      result.decisions.filter(item => item.eligibility === 'eligible').map(item => item.development_concern_key.split(':').at(-1)).sort(),
      keys.sort(),
      `day ${day} should expose only its own observation stage`,
    );
  }
});
test('legacy built-in placeholder detection is exact and does not match user projections', () => {
  assert.equal(isLegacyBuiltInPreConfirmationProjection({
    development_concern_key: 'pre_confirmation_observation',
    development: {next_signal: LEGACY_BUILT_IN_PRE_CONFIRMATION_DESCRIPTION},
  }), true);
  assert.equal(isLegacyBuiltInPreConfirmationProjection({
    development_concern_key: 'pre_confirmation_observation:fatigue',
    development: {next_signal: LEGACY_BUILT_IN_PRE_CONFIRMATION_DESCRIPTION},
  }), false);
  assert.equal(isLegacyBuiltInPreConfirmationProjection({
    development_concern_key: 'pre_confirmation_observation:no_reaction',
    development: {next_signal: '旧版无明显反应候选'},
  }), true);
  assert.equal(isLegacyBuiltInPreConfirmationProjection({
    development_concern_key: 'user:observation',
    development: {next_signal: LEGACY_BUILT_IN_PRE_CONFIRMATION_DESCRIPTION},
  }), false);
});
test('Story Time eligibility does not create a BiologicalEvent or select a contributor', () => {
  const result = evaluate();
  assert.equal(Object.hasOwn(result, 'events'), false);
  assert.equal(result.decisions[0].source_event_ids.includes('event-char_000002'), true);
  assert.equal(result.decisions[0].source_event_ids.includes('event-char_000003'), true);
});
test('different concerns produce independent decisions', () => {
  const result = evaluate({worldModel: {projection_rules: [rule(), rule({projection_rule_id: 'rule:implant-detection-v1', development_concern_key: 'concern:detection', development_kind: 'possible_detection'})]}});
  assert.equal(result.decisions.length, 2);
  assert.notEqual(result.decisions[0].development_concern_key, result.decisions[1].development_concern_key);
});
test('sibling possibilities share basis without dedupe and resolve through later factual evidence', () => {
  const possible = rule({
    projection_rule_id: 'rule:implant-progress-v1',
    development_concern_key: 'concern:progress',
    development_kind: 'possible_biological_change',
    realization: {event_types: ['medical_event']},
    contradiction: {event_types: ['other_biological']},
  });
  const noProgress = rule({
    projection_rule_id: 'rule:implant-no-progress-v1',
    development_concern_key: 'concern:no-progress',
    development_kind: 'no_obvious_change',
    realization: {event_types: ['other_biological']},
    contradiction: {event_types: ['medical_event']},
  });
  const evaluated = evaluate({worldModel: {projection_rules: [possible, noProgress]}});
  assert.equal(evaluated.decisions.length, 2);
  assert.deepEqual(evaluated.decisions[0].source_event_ids, evaluated.decisions[1].source_event_ids);
  assert.notEqual(evaluated.decisions[0].projection_rule_id, evaluated.decisions[1].projection_rule_id);
  const base = {currentState: state(), currentStoryTime: story(10), currentView: {factual_status: 'active', deleted: false}};
  assert.equal(evaluateProjectionEvolution({
    ...base,
    projection: {projection_id: 'projection-progress', subject_id: SUBJECT, projection_rule_id: possible.projection_rule_id, development_concern_key: possible.development_concern_key},
    worldModel: {projection_rules: [possible, noProgress]},
    events: [],
  }).decision, 'keep_active');
  assert.equal(evaluateProjectionEvolution({
    ...base,
    projection: {projection_id: 'projection-progress', subject_id: SUBJECT, projection_rule_id: possible.projection_rule_id, development_concern_key: possible.development_concern_key},
    worldModel: {projection_rules: [possible, noProgress]},
    events: [factual('medical-1', 'medical_event')],
  }).decision, 'realized');
  assert.equal(evaluateProjectionEvolution({
    ...base,
    projection: {projection_id: 'projection-no-progress', subject_id: SUBJECT, projection_rule_id: noProgress.projection_rule_id, development_concern_key: noProgress.development_concern_key},
    worldModel: {projection_rules: [possible, noProgress]},
    events: [factual('medical-1', 'medical_event')],
  }).decision, 'contradicted');
});
test('all supported trigger kinds remain eligibility-only', () => {
  const immediate = rule({trigger: {kind: 'immediate_after_event', source_event_type: 'sexual_activity'}});
  const reached = rule({trigger: {kind: 'story_time_reached', target_story_time: story(5)}, development_concern_key: 'concern:reached'});
  const immediateResult = evaluate({worldModel: {projection_rules: [immediate]}, currentStoryTime: story(10)});
  const reachedResult = evaluate({worldModel: {projection_rules: [reached]}, currentStoryTime: story(5)});
  assert.equal(immediateResult.decisions[0].eligibility, 'eligible');
  assert.equal(reachedResult.decisions[0].eligibility, 'eligible');
  assert.equal(Object.hasOwn(reachedResult, 'event'), false);
});
test('exact duplicate rules and reordered inputs produce one deterministic decision', () => {
  const rules = [rule(), structuredClone(rule())];
  const first = evaluate({events: [exposure('e2', 1, SOURCE_C), exposure('e1', 0)], sourceCandidates: [candidate(SOURCE_C), candidate(SOURCE_B)], worldModel: {projection_rules: rules}});
  const second = evaluate({events: [exposure('e1', 0), exposure('e2', 1, SOURCE_C)], sourceCandidates: [candidate(SOURCE_B), candidate(SOURCE_C)], worldModel: {projection_rules: [rules[1], rules[0]]}});
  assert.deepEqual(first, second);
});
test('evolution keeps active without factual transition and realizes only matching confirmed evidence', () => {
  const projection = {projection_id: 'projection-x', subject_id: SUBJECT, projection_rule_id: 'rule:implant-change-v1', development_concern_key: 'concern:implant-change'};
  const base = {projection, currentView: {factual_status: 'active', deleted: false}, currentState: state(), worldModel: {projection_rules: [rule()]}, currentStoryTime: story(10)};
  assert.equal(evaluateProjectionEvolution({...base, events: []}).decision, 'keep_active');
  assert.equal(evaluateProjectionEvolution({...base, events: [factual('realized-1', 'medical_event')]}).decision, 'realized');
  assert.equal(evaluateProjectionEvolution({...base, events: [factual('uncertain-1', 'medical_event', 'ambiguous')]}).decision, 'keep_active');
});
test('evolution requires explicit contradiction and never treats silence or time as contradiction', () => {
  const projection = {projection_id: 'projection-x', subject_id: SUBJECT, projection_rule_id: 'rule:implant-change-v1', development_concern_key: 'concern:implant-change'};
  const base = {projection, currentView: {factual_status: 'active', deleted: false}, currentState: state(), worldModel: {projection_rules: [rule()]}, currentStoryTime: story(100)};
  assert.equal(evaluateProjectionEvolution({...base, events: []}).decision, 'keep_active');
  assert.equal(evaluateProjectionEvolution({...base, events: [factual('contradicted-1', 'other_biological')]}).decision, 'contradicted');
});
test('no_obvious_change remains a direction and never becomes a negative factual result', () => {
  const projection = {projection_id: 'projection-x', subject_id: SUBJECT, projection_rule_id: 'rule:implant-change-v1', development_concern_key: 'concern:implant-change'};
  const noChangeRule = rule({development_kind: 'no_obvious_change', realization: null, contradiction: null});
  const result = evaluateProjectionEvolution({projection, currentView: {factual_status: 'active', deleted: false}, currentState: state(), worldModel: {projection_rules: [noChangeRule]}, events: [], currentStoryTime: story(90)});
  assert.equal(result.decision, 'keep_active');
  assert.equal(Object.hasOwn(result, 'event'), false);
});
test('expiration requires an explicit rule and comparable Story Time', () => {
  const projection = {projection_id: 'projection-x', subject_id: SUBJECT, projection_rule_id: 'rule:implant-change-v1', development_concern_key: 'concern:implant-change'};
  const expiring = rule({expiration: {trigger: {kind: 'elapsed_after_event', source_event_type: 'sexual_activity', min_elapsed_story_days: 20}}});
  const base = {projection, currentView: {factual_status: 'active', deleted: false}, currentState: state(), events: [exposure('e1', 0)], worldModel: {projection_rules: [expiring]}};
  assert.equal(evaluateProjectionEvolution({...base, currentStoryTime: story(30)}).decision, 'expired');
  assert.equal(evaluateProjectionEvolution({...base, currentStoryTime: story(30, 'other')}).decision, 'unresolved');
  assert.equal(evaluateProjectionEvolution({...base, worldModel: {projection_rules: [rule()]}, currentStoryTime: story(30)}).decision, 'keep_active');
});
test('realization and contradiction conflict is unresolved and contributor conflict blocks required rule', () => {
  const projection = {projection_id: 'projection-x', subject_id: SUBJECT, projection_rule_id: 'rule:implant-change-v1', development_concern_key: 'concern:implant-change'};
  const both = {projection, currentView: {factual_status: 'active', deleted: false}, currentState: state(), worldModel: {projection_rules: [rule()]}, currentStoryTime: story(10), events: [factual('realized-1', 'medical_event'), factual('contradicted-1', 'other_biological')]};
  assert.equal(evaluateProjectionEvolution(both).decision, 'unresolved');
  const conflictState = state(true, {episodes: {p1: {contributors: {confirmed: [], excluded: [], conflicts: [{relationship_key: 'p1|char_000001|char_000002|genetic'}]}}}});
  const required = rule({requirements: {...rule().requirements, contributor_relationships: [{relationship_key: 'p1|char_000001|char_000002|genetic', attribution: 'confirmed'}]}});
  assert.equal(evaluateProjectionEvolution({...both, currentState: conflictState, worldModel: {projection_rules: [required]}, events: []}).decision, 'unresolved');
});
test('evolution preserves deleted and terminal views without creating lifecycle records', () => {
  const projection = {projection_id: 'projection-x', subject_id: SUBJECT, projection_rule_id: 'rule:implant-change-v1', development_concern_key: 'concern:implant-change'};
  const base = {projection, currentState: state(), worldModel: {projection_rules: [rule()]}, currentStoryTime: story(10), events: []};
  assert.equal(evaluateProjectionEvolution({...base, currentView: {factual_status: 'realized', deleted: false}}).decision, 'realized');
  assert.equal(evaluateProjectionEvolution({...base, currentView: {factual_status: 'active', deleted: true}}).decision, 'unresolved');
});
test('evolution inputs remain immutable and contains no RNG or factual Event output', () => {
  const projection = {projection_id: 'projection-x', subject_id: SUBJECT, projection_rule_id: 'rule:implant-change-v1', development_concern_key: 'concern:implant-change'};
  const input = {projection, currentView: {factual_status: 'active', deleted: false}, currentState: state(), events: [], worldModel: {projection_rules: [rule()]}, currentStoryTime: story(10)};
  const before = structuredClone(input); const result = evaluateProjectionEvolution(input);
  assert.deepEqual(input, before); assert.equal(Object.hasOwn(result, 'event'), false); assert.equal(Object.hasOwn(result, 'probability'), false);
});
