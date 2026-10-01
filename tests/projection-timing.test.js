import test from 'node:test';
import assert from 'node:assert/strict';
import {resetCharacterTimingConfig, resolveCharacterTimingConfig, validateCharacterTimingConfig, withCharacterTimingConfig} from '../core/character-timing-config.js';
import {evaluateProjectionTiming, resolveProjectionTimingInstance} from '../core/projection-timing.js';
import {buildProjectionRuleId, evaluateProjectionEligibility} from '../core/projection-eligibility.js';

const config = {schema_version: 1, config_version: 1, base_min_story_days: 10, base_max_story_days: 20, variance_ratio: 0.2, variance_cap_story_days: 3, total_adjustment_cap_story_days: 2};
const floorVersion = {chat_id: 'chat-timing', message_id: 'message-1', floor: 1, swipe_id: 0, content_hash: 'hash', message_version: 'v1'};
const event = {event_id: 'event-1', type: 'sexual_activity', status: 'confirmed', story_time: {day_index: 100}, pregnancy_relevance: {relevant: true, gestational_subject_ids: ['char_000001'], reproductive_mechanism: {kind: 'fertilization'}}};

test('character timing config rejects invalid numeric values and preserves Chat-local override/reset semantics', () => {
  assert.equal(validateCharacterTimingConfig({...config, variance_ratio: Infinity}).ok, false);
  const chat = {settings: {character_timing_configs: {}}};
  const withOverride = withCharacterTimingConfig(chat, 'char_000001', config);
  assert.equal(resolveCharacterTimingConfig({override: withOverride.settings.character_timing_configs['char_000001']}).config.config_version, 1);
  assert.equal(withCharacterTimingConfig(withOverride, 'char_000001', config).settings.character_timing_configs['char_000001'].config_version, 2);
  assert.equal(resetCharacterTimingConfig(withOverride, 'char_000001').settings.character_timing_configs['char_000001'], undefined);
  assert.equal(resolveCharacterTimingConfig({baseline: config}).overridden, false);
});

test('timing instance samples once, freezes effective window, and remains stable on reread', () => {
  const first = resolveProjectionTimingInstance({chatId: floorVersion.chat_id, subjectId: 'char_000001', mechanismKey: 'fertilization', firstEvent: event, config, floorVersion, rng: () => 1});
  const second = resolveProjectionTimingInstance({chatId: floorVersion.chat_id, subjectId: 'char_000001', mechanismKey: 'fertilization', firstEvent: event, config, floorVersion, rng: () => 0});
  assert.equal(first.timing_instance_id, second.timing_instance_id);
  assert.equal(first.sampled_individual_offset_story_days, 3);
  assert.equal(second.sampled_individual_offset_story_days, -3);
  assert.equal(first.effective_min_story_days, 12);
  assert.equal(first.effective_max_story_days, 22);
});

test('timing window is before-min, inclusive-open at min/max, and missed after max', () => {
  const timing = resolveProjectionTimingInstance({chatId: floorVersion.chat_id, subjectId: 'char_000001', mechanismKey: 'fertilization', firstEvent: event, config, floorVersion, rng: () => 0.5});
  assert.equal(evaluateProjectionTiming({timingInstance: timing, currentStoryTime: {day_index: 109}, events: [event], subjectId: 'char_000001'}).status, 'before_min');
  assert.equal(evaluateProjectionTiming({timingInstance: timing, currentStoryTime: {day_index: 110}, events: [event], subjectId: 'char_000001'}).eligible, 'eligible');
  assert.equal(evaluateProjectionTiming({timingInstance: timing, currentStoryTime: {day_index: 120}, events: [event], subjectId: 'char_000001'}).eligible, 'eligible');
  assert.equal(evaluateProjectionTiming({timingInstance: timing, currentStoryTime: {day_index: 121}, events: [event], subjectId: 'char_000001'}).status, 'window_missed');
});

test('Projection eligibility composes World Rule eligibility with timing eligibility', () => {
  const content = {schema_version: 1, mechanism_key: 'fertilization', development_concern_key: 'detection', development_kind: 'possible_detection', trigger: {kind: 'immediate_after_event', source_event_type: 'sexual_activity'}, requirements: {capabilities: [], source_compatibility: 'not_required', contributor_relationships: []}, realization: null, contradiction: null, expiration: null};
  const rule = {...content, projection_rule_id: buildProjectionRuleId(content)};
  const timing = resolveProjectionTimingInstance({chatId: floorVersion.chat_id, subjectId: 'char_000001', mechanismKey: 'fertilization', firstEvent: event, config, floorVersion, rng: () => 0.5});
  const result = evaluateProjectionEligibility({events: [event], currentState: {characters: {'char_000001': {reproductive_capabilities: {}}}}, worldModel: {projection_rules: [rule]}, currentStoryTime: {day_index: 109}, preConfirmationTiming: {enabled: true, instances: [timing]}});
  assert.equal(result.decisions[0].eligibility, 'not_eligible');
  assert.equal(result.decisions[0].reason_code, 'before_min');
});
