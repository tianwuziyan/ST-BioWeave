import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateProjectionEligibility, evaluateProjectionEvolution, validateProjectionRule} from '../core/projection-eligibility.js';

const SUBJECT = 'char_000001';
const SOURCE_B = 'char_000002';
const SOURCE_C = 'char_000003';

function story(day, calendar_id = 'main') { return {display: `Day ${day}`, normalized: `day-${day}`, day_index: day, calendar_id, precision: 'day'}; }
function exposure(event_id, day, source = SOURCE_B, mechanism = 'mechanism:implant') { return {event_id, type: 'sexual_activity', status: 'confirmed', story_time: story(day), pregnancy_relevance: {relevant: true, gestational_subject_ids: [SUBJECT], counterpart_ids: [source], reproductive_mechanism: {kind: mechanism}}}; }
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
test('missing World Model rule is unresolved at the rule layer and does not create facts', () => {
  const events = [exposure('e1', 0)]; const before = structuredClone(events); const result = evaluateProjectionEligibility({currentState: state(), events, worldModel: {}, currentStoryTime: story(10)});
  assert.deepEqual(result.decisions, []);
  assert.equal(result.diagnostics[0].code, 'projection_rules_unavailable');
  assert.deepEqual(events, before);
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
