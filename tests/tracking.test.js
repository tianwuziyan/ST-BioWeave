import test from 'node:test';
import assert from 'node:assert/strict';
import {
  eligibleGestationalSubjects,
  explainTrackingDecision,
  rebuildTrackingRegistry,
} from '../core/tracking.js';
import {CONCEPTION_RELEVANT_EXPOSURE_EVIDENCE_KIND} from '../core/events.js';

function event(overrides = {}) {
  return {
    event_id: 'evt-1',
    type: 'sexual_activity',
    status: 'confirmed',
    location: 'room',
    source: {
      chat_id: 'chat-1',
      message_id: 'message-1',
      floor: 1,
      swipe_id: 0,
      content_hash: 'hash-1',
      message_version: 'v1',
    },
    participants: [
      {
        character_id: 'char-a',
        display_name: 'A',
        event_role: 'potential_gestational_subject',
        biological_context: {species: 'human', biological_type: 'type-a'},
        reproductive_capabilities_used: {can_carry_pregnancy: true},
        evidence: [{kind: 'narrative', text: 'exposure'}],
      },
      {
        character_id: 'char-b',
        display_name: 'B',
        event_role: 'potential_conception_source',
        reproductive_capabilities_used: {can_cause_pregnancy: true},
        evidence: [{kind: 'narrative', text: 'source'}],
      },
    ],
    pregnancy_relevance: {
      relevant: true,
      possible_conception: true,
      gestational_subject_ids: ['char-a'],
      counterpart_ids: ['char-b'],
      confidence: 0.8,
    },
    source_evidence: [
      {kind: 'current_floor', text: 'event evidence'},
      {kind: CONCEPTION_RELEVANT_EXPOSURE_EVIDENCE_KIND, text: 'actual exposure evidence'},
    ],
    ...overrides,
  };
}

test('tracking requires sexual activity, both relevance flags, and explicit carrying capability', () => {
  assert.deepEqual(eligibleGestationalSubjects(event()), ['char-a']);
  assert.deepEqual(eligibleGestationalSubjects(event({type: 'physical_symptom'})), []);
  assert.deepEqual(eligibleGestationalSubjects(event({pregnancy_relevance: {
    ...event().pregnancy_relevance,
    relevant: false,
  }})), []);
  assert.deepEqual(eligibleGestationalSubjects(event({pregnancy_relevance: {
    ...event().pregnancy_relevance,
    possible_conception: false,
  }})), []);
  assert.deepEqual(eligibleGestationalSubjects(event({
    participants: event().participants.map(participant => ({
      ...participant,
      reproductive_capabilities_used: {
        ...participant.reproductive_capabilities_used,
        can_carry_pregnancy: null,
      },
    })),
  })), []);
  assert.deepEqual(eligibleGestationalSubjects(event({status: 'negated'})), []);
  assert.deepEqual(eligibleGestationalSubjects(event({status: 'fictional'})), []);
});

test('gender-like labels and event roles do not create a subject when capability is unknown', () => {
  const candidate = event({
    participants: [{
      ...event().participants[0],
      event_role: 'other_participant',
      gender: 'female',
      reproductive_capabilities_used: {can_carry_pregnancy: null},
    }],
  });
  assert.deepEqual(eligibleGestationalSubjects(candidate), []);
});

test('tracking diagnostics explain eligible and non-subject participants', () => {
  assert.deepEqual(explainTrackingDecision(event()), [
    {character_id: 'char-a', eligible: true, reasons: []},
    {character_id: 'char-b', eligible: false, reasons: ['NOT_GESTATIONAL_SUBJECT']},
  ]);
});

test('diagnostic sharing preserves subject-local eligibility across Events', () => {
  const base = event();
  const resultA = event({
    participants: [
      {...base.participants[0], character_id: 'char-a'},
      base.participants[1],
    ],
    pregnancy_relevance: {
      ...base.pregnancy_relevance,
      gestational_subject_ids: ['char-a'],
    },
  });
  const resultC = event({
    participants: [
      {...base.participants[0], character_id: 'char-c'},
      base.participants[1],
    ],
    pregnancy_relevance: {
      ...base.pregnancy_relevance,
      gestational_subject_ids: ['char-c'],
    },
  });
  assert.deepEqual([
    ...eligibleGestationalSubjects(resultC),
    ...eligibleGestationalSubjects(resultA),
  ], ['char-c', 'char-a']);
});

test('tracking diagnostics explain unknown and false carrying capability', () => {
  const unknown = explainTrackingDecision(event({
    participants: event().participants.map(participant => participant.character_id === 'char-a'
      ? {...participant, reproductive_capabilities_used: {can_carry_pregnancy: null}}
      : participant),
  }));
  assert.deepEqual(unknown.find(decision => decision.character_id === 'char-a'), {
    character_id: 'char-a',
    eligible: false,
    reasons: ['CAN_CARRY_PREGNANCY_UNKNOWN'],
  });

  const falseCapability = explainTrackingDecision(event({
    participants: event().participants.map(participant => participant.character_id === 'char-a'
      ? {...participant, reproductive_capabilities_used: {can_carry_pregnancy: false}}
      : participant),
  }));
  assert.deepEqual(falseCapability.find(decision => decision.character_id === 'char-a'), {
    character_id: 'char-a',
    eligible: false,
    reasons: ['CAN_CARRY_PREGNANCY_FALSE'],
  });
});

test('tracking diagnostics explain absent conception exposure and missing participants', () => {
  const irrelevant = explainTrackingDecision(event({
    pregnancy_relevance: {
      relevant: false,
      possible_conception: false,
      gestational_subject_ids: [],
      counterpart_ids: [],
    },
  }));
  assert.deepEqual(irrelevant.find(decision => decision.character_id === 'char-a'), {
    character_id: 'char-a',
    eligible: false,
    reasons: ['INVALID_EVENT', 'NOT_GESTATIONAL_SUBJECT'],
  });

  const noExposure = explainTrackingDecision(event({
    pregnancy_relevance: {
      relevant: false,
      possible_conception: false,
      gestational_subject_ids: [],
      counterpart_ids: [],
    },
  }));
  assert.deepEqual(noExposure.find(decision => decision.character_id === 'char-a'), {
    character_id: 'char-a',
    eligible: false,
    reasons: ['INVALID_EVENT', 'NOT_GESTATIONAL_SUBJECT'],
  });

  const missingParticipant = explainTrackingDecision(event({
    participants: [event().participants[1]],
    pregnancy_relevance: {
      ...event().pregnancy_relevance,
      gestational_subject_ids: ['char-a'],
    },
  }));
  assert.deepEqual(missingParticipant.find(decision => decision.character_id === 'char-a'), {
    character_id: 'char-a',
    eligible: false,
    reasons: ['INVALID_EVENT', 'PARTICIPANT_NOT_FOUND'],
  });
});

test('no-exposure sexual activity cannot create a tracking subject', () => {
  const noExposure = event({
    participants: [],
    pregnancy_relevance: {
      relevant: false,
      possible_conception: false,
      gestational_subject_ids: [],
      counterpart_ids: [],
    },
  });
  assert.deepEqual(eligibleGestationalSubjects(noExposure), []);
  assert.deepEqual(rebuildTrackingRegistry([noExposure]).tracking_subjects, {});
});

test('tracking diagnostics explain nonsexual, excluded, and invalid events', () => {
  const nonsexual = explainTrackingDecision(event({type: 'physical_symptom'}));
  assert.deepEqual(nonsexual.find(decision => decision.character_id === 'char-a'), {
    character_id: 'char-a',
    eligible: false,
    reasons: ['NOT_SEXUAL_ACTIVITY'],
  });

  const excluded = explainTrackingDecision(event({status: 'negated'}));
  assert.deepEqual(excluded.find(decision => decision.character_id === 'char-a'), {
    character_id: 'char-a',
    eligible: false,
    reasons: ['EVENT_STATUS_EXCLUDED'],
  });

  assert.deepEqual(explainTrackingDecision({}), [
    {character_id: null, eligible: false, reasons: ['INVALID_EVENT']},
  ]);
});

test('registry supports multiple subjects, counterpart references, repeated exposure, and dangling cleanup', () => {
  const first = event();
  const second = event({
    event_id: 'evt-2',
    source: {...first.source, message_id: 'message-2', floor: 2, content_hash: 'hash-2', message_version: 'v2'},
    participants: [
      {
        ...first.participants[0],
        character_id: 'char-a',
      },
      {
        ...first.participants[1],
        character_id: 'char-d',
        display_name: 'D',
        reproductive_capabilities_used: {can_cause_pregnancy: true},
        evidence: [{kind: 'narrative', text: 'second source'}],
      },
    ],
    pregnancy_relevance: {
      relevant: true,
      possible_conception: true,
      gestational_subject_ids: ['char-a'],
      counterpart_ids: ['char-d'],
    },
  });
  const third = event({
    event_id: 'evt-3',
    source: {...first.source, message_id: 'message-3', floor: 3, content_hash: 'hash-3', message_version: 'v3'},
    participants: [
      {
        ...first.participants[0],
        character_id: 'char-c',
        display_name: 'C',
        reproductive_capabilities_used: {can_carry_pregnancy: true},
        evidence: [{kind: 'narrative', text: 'third exposure'}],
      },
      {
        ...first.participants[1],
        character_id: 'char-d',
        display_name: 'D',
        reproductive_capabilities_used: {can_cause_pregnancy: true},
        evidence: [{kind: 'narrative', text: 'third source'}],
      },
    ],
    pregnancy_relevance: {
      relevant: true,
      possible_conception: true,
      gestational_subject_ids: ['char-c'],
      counterpart_ids: ['char-d'],
    },
  });
  const registry = rebuildTrackingRegistry([first, second, third, first], {
    tracking_subjects: {
      'char-a': {
        character_id: 'char-a',
        display_name: 'A',
        created_from_event_id: 'deleted-event',
        exposure_event_ids: ['deleted-event'],
        status: 'active',
      },
      'char-z': {
        character_id: 'char-z',
        display_name: 'Z',
        created_from_event_id: 'deleted-event',
        exposure_event_ids: ['deleted-event'],
        status: 'active',
      },
    },
    character_profiles: {
      'char-z': {character_id: 'char-z', display_name: 'Z'},
    },
  });

  assert.deepEqual(registry.tracking_subjects['char-a'].exposure_event_ids, ['evt-1', 'evt-2']);
  assert.equal(registry.tracking_subjects['char-a'].created_from_event_id, 'evt-1');
  assert.deepEqual(registry.tracking_subjects['char-c'].exposure_event_ids, ['evt-3']);
  assert.equal(registry.tracking_subjects['char-z'], undefined);
  assert.deepEqual(registry.subjects, registry.tracking_subjects);
  assert.equal(registry.tracking_subjects['char-a'].counterpart_ids, undefined);
  assert.equal(registry.tracking_subjects['char-a'].event, undefined);
  assert.ok(registry.character_profiles['char-z']);
});

test('empty current events remove active subjects while retaining sanitized historical profiles', () => {
  const registry = rebuildTrackingRegistry([], {
    tracking_subjects: {
      'char-a': {
        character_id: 'char-a',
        display_name: 'A',
        created_from_event_id: 'evt-old',
        exposure_event_ids: ['evt-old'],
        status: 'active',
      },
    },
    character_profiles: {
      'char-a': {
        character_id: 'char-a',
        display_name: 'A',
        event: {event_id: 'evt-old', participants: []},
      },
    },
  });
  assert.deepEqual(registry.tracking_subjects, {});
  assert.deepEqual(registry.character_profiles['char-a'], {
    character_id: 'char-a',
    display_name: 'A',
    species: null,
    biological_type: null,
    reproductive_capabilities: {
      can_produce_sperm: null,
      can_produce_ova: null,
      can_be_fertilized: null,
      can_carry_pregnancy: null,
      can_cause_pregnancy: null,
    },
    evidence: [],
  });
});
