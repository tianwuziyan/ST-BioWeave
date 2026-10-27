import test from 'node:test';
import assert from 'node:assert/strict';
import {derivePregnancyStatus} from '../core/pregnancy-status.js';

test('confirmed pregnancy derives integer gestational weeks from conception time', () => {
  const result = derivePregnancyStatus({
    currentState: {
      characters: {
        subject: {
          pregnancy: {
            current_status: 'confirmed',
            episodes: {pregnancy: {pregnancy_id: 'pregnancy', status: 'confirmed', conception_event_ids: ['conception']}},
          },
        },
      },
    },
    events: [{event_id: 'conception', story_time: {day_index: 2}}],
    currentStoryTime: {day_index: 16},
  });
  assert.deepEqual(result, [{subject_id: 'subject', status: 'confirmed', pregnancy_id: 'pregnancy', gestational_weeks: 2}]);
});

test('confirmed pregnancy uses the earliest comparable conception anchor', () => {
  const result = derivePregnancyStatus({
    currentState: {
      characters: {
        subject: {
          pregnancy: {
            current_status: 'confirmed',
            episodes: {pregnancy: {pregnancy_id: 'pregnancy', status: 'confirmed', conception_event_ids: ['late', 'early']}},
          },
        },
      },
    },
    events: [
      {event_id: 'late', story_time: {day_index: 10}},
      {event_id: 'early', story_time: {day_index: 2}},
    ],
    currentStoryTime: {day_index: 16},
  });
  assert.equal(result[0].gestational_weeks, 2);
});

test('minute-level anchors remain valid but do not invent a full week', () => {
  const result = derivePregnancyStatus({
    currentState: {
      characters: {
        subject: {
          pregnancy: {
            current_status: 'confirmed',
            episodes: {pregnancy: {pregnancy_id: 'pregnancy', status: 'confirmed', conception_event_ids: ['conception']}},
          },
        },
      },
    },
    events: [{event_id: 'conception', story_time: {normalized: '2026-05-04T11:00', day_index: 20577, calendar_id: 'main', precision: 'minute'}}],
    currentStoryTime: {normalized: '2026-05-04T12:00', day_index: 20577, calendar_id: 'main', precision: 'minute'},
  });
  assert.equal(result[0].gestational_weeks, 0);
});

test('an anchor after the current story time leaves gestational weeks unknown', () => {
  const result = derivePregnancyStatus({
    currentState: {
      characters: {
        subject: {
          pregnancy: {
            current_status: 'confirmed',
            episodes: {pregnancy: {pregnancy_id: 'pregnancy', status: 'confirmed', conception_event_ids: ['conception']}},
          },
        },
      },
    },
    events: [{event_id: 'conception', story_time: {day_index: 2}}],
    currentStoryTime: {day_index: 1},
  });
  assert.equal(result[0].gestational_weeks, null);
});

test('incomparable calendars leave gestational weeks unknown', () => {
  const result = derivePregnancyStatus({
    currentState: {
      characters: {
        subject: {
          pregnancy: {
            current_status: 'confirmed',
            episodes: {pregnancy: {pregnancy_id: 'pregnancy', status: 'confirmed', conception_event_ids: ['conception']}},
          },
        },
      },
    },
    events: [{event_id: 'conception', story_time: {display: '2026-05-03', calendar_id: 'world-b'}}],
    currentStoryTime: {display: '2026-05-04', calendar_id: 'world-a'},
  });
  assert.equal(result[0].gestational_weeks, null);
});

test('suspected and confirmed pregnancies without comparable anchor do not invent weeks', () => {
  const result = derivePregnancyStatus({
    currentState: {characters: {
      suspected: {pregnancy: {current_status: 'suspected', episodes: {}}},
      confirmed: {pregnancy: {current_status: 'confirmed', episodes: {pregnancy: {pregnancy_id: 'p', status: 'confirmed', conception_event_ids: ['missing']}}}},
    }},
    currentStoryTime: {day_index: 2},
  });
  assert.equal(result.find(item => item.subject_id === 'suspected').status, 'suspected');
  assert.equal(result.find(item => item.subject_id === 'confirmed').gestational_weeks, null);
});

test('confirmed suspicion without pregnancy id still projects suspected status by subject', () => {
  const result = derivePregnancyStatus({
    currentState: {characters: {
      subject: {pregnancy: {current_status: 'unknown', episodes: {}}},
    }},
    events: [{
      event_id: 'suspicion-without-id',
      type: 'pregnancy_suspicion',
      status: 'confirmed',
      state_fact: {
        subject_id: 'subject',
        payload: {observation: {kind: 'medical_check', description: '待调查线索'}},
      },
    }],
  });
  assert.deepEqual(result, [{
    subject_id: 'subject',
    status: 'suspected',
    pregnancy_id: null,
    gestational_weeks: null,
  }]);
});

test('probable and ambiguous suspicion without pregnancy id project suspected status', () => {
  const result = derivePregnancyStatus({
    currentState: {characters: {
      probable: {pregnancy: {current_status: 'unknown', episodes: {}}},
      ambiguous: {pregnancy: {current_status: 'unknown', episodes: {}}},
      negated: {pregnancy: {current_status: 'unknown', episodes: {}}},
      fictional: {pregnancy: {current_status: 'unknown', episodes: {}}},
    }},
    events: [
      {
        event_id: 'probable-suspicion',
        type: 'pregnancy_suspicion',
        status: 'probable',
        state_fact: {subject_id: 'probable', payload: {observation: {kind: 'test'}}},
      },
      {
        event_id: 'ambiguous-suspicion',
        type: 'pregnancy_suspicion',
        status: 'ambiguous',
        state_fact: {subject_id: 'ambiguous', payload: {observation: {kind: 'test'}}},
      },
      {
        event_id: 'negated-suspicion',
        type: 'pregnancy_suspicion',
        status: 'negated',
        state_fact: {subject_id: 'negated', payload: {observation: {kind: 'test'}}},
      },
      {
        event_id: 'fictional-suspicion',
        type: 'pregnancy_suspicion',
        status: 'fictional',
        state_fact: {subject_id: 'fictional', payload: {observation: {kind: 'test'}}},
      },
    ],
  });
  assert.equal(result.find(item => item.subject_id === 'probable').status, 'suspected');
  assert.equal(result.find(item => item.subject_id === 'ambiguous').status, 'suspected');
  assert.equal(result.find(item => item.subject_id === 'negated').status, 'unknown');
  assert.equal(result.find(item => item.subject_id === 'fictional').status, 'unknown');
});

test('confirmed and ended state remain authoritative over unresolved suspicion fallback', () => {
  const result = derivePregnancyStatus({
    currentState: {characters: {
      confirmed: {pregnancy: {current_status: 'confirmed', episodes: {p: {pregnancy_id: 'p', status: 'confirmed'}}}},
      ended: {pregnancy: {current_status: 'ended', episodes: {}}},
    }},
    events: [
      {type: 'pregnancy_suspicion', status: 'confirmed', state_fact: {subject_id: 'confirmed', payload: {observation: {kind: 'test'}}}},
      {type: 'pregnancy_suspicion', status: 'confirmed', state_fact: {subject_id: 'ended', payload: {observation: {kind: 'test'}}}},
    ],
  });
  assert.equal(result.find(item => item.subject_id === 'confirmed').status, 'confirmed');
  assert.equal(result.find(item => item.subject_id === 'ended').status, 'ended');
});
