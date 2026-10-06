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
    recovery_stage_guidance: {
      early: 'EARLY_OBSERVATION_GUIDANCE',
      recovering: 'RECOVERING_OBSERVATION_GUIDANCE',
      near_recovery: 'NEAR_RECOVERY_OBSERVATION_GUIDANCE',
    },
    ...overrides,
  };
}

test('recovery stages use deterministic elapsed Story Time thresholds', () => {
  const item = observation();
  assert.equal(evaluateHealthRecoveryStage(item, story(1)), 'early');
  assert.equal(evaluateHealthRecoveryStage(item, story(4)), 'recovering');
  assert.equal(evaluateHealthRecoveryStage(item, story(7)), 'near_recovery');
});

test('guidance reads the persisted string for each deterministic stage', () => {
  for (const [day, expected] of [
    [1, 'EARLY_OBSERVATION_GUIDANCE'],
    [4, 'RECOVERING_OBSERVATION_GUIDANCE'],
    [7, 'NEAR_RECOVERY_OBSERVATION_GUIDANCE'],
  ]) {
    const result = buildHealthRecoveryGuidance({
      currentHealthState: {characters: {char_a: {active_observations: [observation()]}}},
      currentStoryTime: story(day),
    });
    assert.equal(result[0].guidance, expected);
  }
  assert.deepEqual(buildHealthRecoveryGuidance({
    currentHealthState: {characters: {char_a: {active_observations: [observation()]}}},
    currentStoryTime: story(9),
  }), []);
});

test('guidance diagnostics observe deterministic stage and persisted profile selection', () => {
  const diagnostics = [];
  const result = buildHealthRecoveryGuidance({
    currentHealthState: {characters: {char_a: {active_observations: [observation()]}}},
    currentStoryTime: story(4),
    trace: item => diagnostics.push(item),
  });
  assert.equal(result[0].guidance, 'RECOVERING_OBSERVATION_GUIDANCE');
  assert.deepEqual(
    diagnostics.map(item => item.stage),
    ['HEALTH_RECOVERY_STAGE_SELECTED', 'HEALTH_RECOVERY_GUIDANCE_SELECTED'],
  );
  assert.equal(diagnostics[0].recovery_stage, 'recovering');
  assert.equal(diagnostics[1].guidance_present, true);
  assert.match(diagnostics[1].guidance_fingerprint, /^guidance_/);
});

test('expected boundary and large Story Time jumps do not simulate intermediate days', () => {
  const result = buildHealthRecoveryGuidance({
    currentHealthState: {characters: {char_a: {active_observations: [observation()]}}},
    currentStoryTime: story(8),
  });
  assert.equal(result[0].stage, 'near_recovery');
  assert.equal(result[0].guidance, 'NEAR_RECOVERY_OBSERVATION_GUIDANCE');
  assert.doesNotMatch(JSON.stringify(result), /remaining|deadline|day_index|story_days|event-a/);
});

test('incomparable Story Time produces no recovery guidance', () => {
  const result = buildHealthRecoveryGuidance({
    currentHealthState: {characters: {char_a: {active_observations: [observation()]}}},
    currentStoryTime: story(4, 'other-calendar'),
  });
  assert.deepEqual(result, []);
});

test('intervention-only Current Health state produces no recovery guidance', () => {
  const result = buildHealthRecoveryGuidance({
    currentHealthState: {
      characters: {
        char_a: {
          active_observations: [],
        },
      },
    },
    currentStoryTime: story(4),
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

test('missing recovery profile produces no guidance without generic fallback', () => {
  const diagnostics = [];
  const result = buildHealthRecoveryGuidance({
    currentHealthState: {characters: {char_a: {active_observations: [observation({recovery_stage_guidance: null})]}}},
    currentStoryTime: story(1),
    trace: item => diagnostics.push(item),
  });
  assert.deepEqual(result, []);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].stage, 'HEALTH_RECOVERY_STAGE_SELECTED');
  assert.equal(diagnostics[0].recovery_stage, 'early');
  assert.equal(diagnostics[0].profile_available, false);
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
  assert.match(result[0].guidance, /EARLY_OBSERVATION_GUIDANCE|RECOVERING_OBSERVATION_GUIDANCE/);
  assert.doesNotMatch(result[0].guidance, /pain-a|pain-b|abrasion/);
  assert.equal(result[0].body_site, '左手腕');
});

test('same presentation group preserves distinct persisted guidance strings', () => {
  const result = buildHealthRecoveryGuidance({
    currentHealthState: {
      characters: {
        char_a: {
          active_observations: [
            observation({source_event_id: 'one'}),
            observation({source_event_id: 'two', recovery_stage_guidance: {
              early: 'SECOND_EARLY',
              recovering: 'SECOND_RECOVERING',
              near_recovery: 'SECOND_NEAR',
            }}),
          ],
        },
      },
    },
    currentStoryTime: story(1),
  });
  assert.equal(result.length, 1);
  assert.match(result[0].guidance, /EARLY_OBSERVATION_GUIDANCE/);
  assert.match(result[0].guidance, /SECOND_EARLY/);
});
