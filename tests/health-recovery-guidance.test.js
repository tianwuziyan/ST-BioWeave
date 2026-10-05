import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHealthRecoveryGuidance,
  evaluateHealthRecoveryStage,
} from '../core/health-recovery-guidance.js';

function story(day, calendar_id = 'story') {
  return {display: `Day ${day}`, normalized: `story-${day}`, day_index: day, calendar_id, precision: 'day'};
}

function observation(overrides = {}) {
  return {
    source_event_id: 'event-a',
    factual_kind: 'pain',
    body_site: 'wrist',
    laterality: 'left',
    persistence: 'short_term',
    natural_recovery: 'eligible',
    reference_story_time: story(0),
    expected_recovery: {duration: {story_days: 9}, boundary: story(9)},
    ...overrides,
  };
}

test('recovery stages use deterministic elapsed Story Time thresholds', () => {
  const item = observation();
  assert.equal(evaluateHealthRecoveryStage(item, story(1)), 'early');
  assert.equal(evaluateHealthRecoveryStage(item, story(4)), 'recovering');
  assert.equal(evaluateHealthRecoveryStage(item, story(7)), 'near_recovery');
});

test('expected boundary and large Story Time jumps do not simulate intermediate days', () => {
  const result = buildHealthRecoveryGuidance({
    currentHealthState: {characters: {char_a: {active_observations: [observation()]}}},
    currentStoryTime: story(8),
  });
  assert.equal(result[0].stage, 'near_recovery');
  assert.match(result[0].guidance, /较高负荷|轻微不适/);
  assert.doesNotMatch(JSON.stringify(result), /remaining|deadline|day_index|story_days|event-a/);
});

test('incomparable Story Time produces no recovery guidance', () => {
  const result = buildHealthRecoveryGuidance({
    currentHealthState: {characters: {char_a: {active_observations: [observation()]}}},
    currentStoryTime: story(4, 'other-calendar'),
  });
  assert.deepEqual(result, []);
});

test('long-term, permanent, and earliest-only observations do not enter automatic stages', () => {
  const earliestOnly = observation({expected_recovery: null});
  const result = buildHealthRecoveryGuidance({
    currentHealthState: {
      characters: {
        char_a: {
          active_observations: [
            observation({persistence: 'long_term', natural_recovery: 'not_eligible'}),
            observation({persistence: 'permanent', natural_recovery: 'not_eligible', source_event_id: 'event-c'}),
            earliestOnly,
          ],
        },
      },
    },
    currentStoryTime: story(4),
  });
  assert.deepEqual(result, []);
});

test('independent observations keep their own stage while presentation compresses exact issues', () => {
  const result = buildHealthRecoveryGuidance({
    currentHealthState: {
      characters: {
        char_a: {
          active_observations: [
            observation({source_event_id: 'pain-a', expected_recovery: {duration: {story_days: 9}, boundary: story(9)}}),
            observation({source_event_id: 'pain-b', expected_recovery: {duration: {story_days: 15}, boundary: story(15)}}),
            observation({source_event_id: 'abrasion', factual_kind: 'abrasion', expected_recovery: {duration: {story_days: 15}, boundary: story(15)}}),
          ],
        },
      },
    },
    currentStoryTime: story(4),
  });
  assert.equal(result.length, 1);
  assert.match(result[0].guidance, /疼痛/);
  assert.doesNotMatch(result[0].guidance, /pain-a|pain-b|abrasion/);
  assert.equal(result[0].body_site, '左手腕');
});
