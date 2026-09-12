import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONCEPTION_RELEVANT_EXPOSURE_EVIDENCE_KIND,
  EVENT_TYPES,
  normalizeEvent,
  sortEvents,
  validateEvent,
  validateEventCollection,
} from '../core/events.js';

test('legacy event types remain valid with the old minimal source shape', () => {
  assert.equal(validateEvent({
    event_id: 'e1',
    type: 'physical_symptom',
    status: 'confirmed',
    source: {chat_id: 'c'},
  }).ok, true);
});

test('normalizeEvent emits the fixed source, story time, participants, and relevance shapes', () => {
  const event = normalizeEvent({
    event_id: 'evt-1',
    type: 'sexual_activity',
    status: 'confirmed',
    location: 'room',
    source: {
      chat_id: 'chat-1',
      message_id: 'message-1',
      floor: 4,
      swipe_id: 0,
      content_hash: 'hash',
      message_version: 'v1',
    },
    story_time: {display: '模糊的夜晚', precision: 'unknown'},
    participants: [{
      character_id: 'char-a',
      display_name: 'A',
      event_role: 'potential_gestational_subject',
      biological_context: {species: 'human', biological_type: 'type-a'},
      reproductive_capabilities_used: {
        can_carry_pregnancy: true,
        can_produce_sperm: false,
        can_produce_ova: null,
      },
      evidence: [{kind: 'narrative', text: 'explicit exposure'}],
    }, {
      character_id: 'char-b',
      display_name: 'B',
      event_role: 'potential_conception_source',
      evidence: [{kind: 'narrative', text: 'actual source'}],
    }, {
      character_id: 'char-c',
      display_name: 'C',
      event_role: 'potential_conception_source',
      evidence: [{kind: 'narrative', text: 'actual source'}],
    }],
    pregnancy_relevance: {
      relevant: true,
      possible_conception: true,
      gestational_subject_ids: ['char-a', 'char-a'],
      counterpart_ids: ['char-b', 'char-c'],
    },
    source_evidence: [
      {kind: 'current_floor', text: 'current floor'},
      {kind: CONCEPTION_RELEVANT_EXPOSURE_EVIDENCE_KIND, text: 'explicit exposure'},
    ],
  });

  assert.equal(validateEvent(event).ok, true);
  assert.deepEqual(event.source, {
    chat_id: 'chat-1',
    message_id: 'message-1',
    floor: 4,
    swipe_id: 0,
    content_hash: 'hash',
    message_version: 'v1',
  });
  assert.equal(event.story_time.display, '模糊的夜晚');
  assert.equal(event.story_time.day_index, null);
  assert.deepEqual(event.pregnancy_relevance.gestational_subject_ids, ['char-a']);
  assert.deepEqual(event.pregnancy_relevance.counterpart_ids, ['char-b', 'char-c']);
  assert.equal(event.participants[0].reproductive_capabilities_used.can_carry_pregnancy, true);
  assert.equal(event.participants[0].reproductive_capabilities_used.can_produce_ova, null);
});

test('validateEvent rejects scalar participant references instead of treating names as IDs', () => {
  assert.equal(validateEvent({
    event_id: 'evt-invalid',
    type: 'sexual_activity',
    status: 'confirmed',
    source: {chat_id: 'chat-1'},
    pregnancy_relevance: {
      relevant: true,
      possible_conception: true,
      gestational_subject_ids: [],
      counterpart_ids: 'char-b,char-c',
    },
  }).ok, false);
});

test('validateEvent rejects malformed IDs inside reference arrays', () => {
  assert.equal(validateEvent({
    ...validExposureEvent(),
    pregnancy_relevance: {
      ...validExposureEvent().pregnancy_relevance,
      counterpart_ids: ['source-a', 'source-b,source-c'],
    },
  }).ok, false);
  assert.equal(validateEvent({
    ...validExposureEvent(),
    pregnancy_relevance: {
      ...validExposureEvent().pregnancy_relevance,
      gestational_subject_ids: ['subject', {}],
    },
  }).ok, false);
});

function validExposureEvent(overrides = {}) {
  return {
    event_id: 'evt-exposure',
    type: 'sexual_activity',
    status: 'confirmed',
    source: {chat_id: 'chat-1'},
    participants: [
      {character_id: 'subject', event_role: 'potential_gestational_subject'},
      {character_id: 'source-a', event_role: 'potential_conception_source'},
      {character_id: 'source-b', event_role: 'potential_conception_source'},
    ],
    pregnancy_relevance: {
      relevant: true,
      possible_conception: true,
      gestational_subject_ids: ['subject'],
      counterpart_ids: ['source-a', 'source-b'],
      confidence: 1,
    },
    source_evidence: [
      {kind: CONCEPTION_RELEVANT_EXPOSURE_EVIDENCE_KIND, text: 'actual exposure'},
    ],
    ...overrides,
  };
}

test('validateEvent requires actual exposure evidence and participant-backed subject/source references', () => {
  assert.equal(validateEvent(validExposureEvent()).ok, true);
  assert.equal(validateEvent(validExposureEvent({
    source_evidence: [{kind: 'narrative', text: 'barrier failed'}],
  })).ok, false);
  assert.equal(validateEvent(validExposureEvent({
    pregnancy_relevance: {
      ...validExposureEvent().pregnancy_relevance,
      counterpart_ids: [],
    },
  })).ok, false);
  assert.equal(validateEvent(validExposureEvent({
    pregnancy_relevance: {
      ...validExposureEvent().pregnancy_relevance,
      gestational_subject_ids: ['missing-subject'],
    },
  })).ok, false);
});

test('validateEvent excludes participants outside the actual exposure chain', () => {
  assert.equal(validateEvent(validExposureEvent({
    participants: [
      ...validExposureEvent().participants,
      {character_id: 'unrelated-participant', event_role: 'other_participant'},
    ],
  })).ok, false);
});

function actualExposureOutcome({sourceIds = [], possibleConception, evidenceText}) {
  const subjectId = 'character_subject';
  const participants = possibleConception
    ? [
      {character_id: subjectId, event_role: 'potential_gestational_subject'},
      ...sourceIds.map(characterId => ({character_id: characterId, event_role: 'potential_conception_source'})),
    ]
    : [];
  return validExposureEvent({
    participants,
    pregnancy_relevance: {
      relevant: possibleConception,
      possible_conception: possibleConception,
      gestational_subject_ids: possibleConception ? [subjectId] : [],
      counterpart_ids: sourceIds,
      confidence: null,
    },
    source_evidence: [{
      kind: possibleConception ? CONCEPTION_RELEVANT_EXPOSURE_EVIDENCE_KIND : 'narrative',
      text: evidenceText,
    }],
  });
}

test('actual exposure outcome beats protection action and excludes no-path cases', () => {
  const cases = [
    {label: 'no barrier with actual exposure', possibleConception: true, sourceIds: ['character_source'], evidenceText: 'actual reproductive substance entered the valid path'},
    {label: 'barrier break with actual exposure', possibleConception: true, sourceIds: ['character_source'], evidenceText: 'barrier broke before actual exposure entered the valid path'},
    {label: 'barrier removal with actual exposure', possibleConception: true, sourceIds: ['character_source'], evidenceText: 'barrier was removed and actual exposure entered the valid path'},
    {label: 'barrier slip with actual exposure', possibleConception: true, sourceIds: ['character_source'], evidenceText: 'barrier slipped and actual exposure entered the valid path'},
    {label: 'intact barrier without exposure', possibleConception: false, sourceIds: [], evidenceText: 'intact barrier kept the reproductive substance outside the valid path'},
    {label: 'external release without valid path', possibleConception: false, sourceIds: [], evidenceText: 'external release did not enter a valid conception path'},
    {label: 'insertion without reproductive exposure', possibleConception: false, sourceIds: [], evidenceText: 'insertion occurred without actual reproductive substance exposure'},
    {label: 'contact without reproductive exposure', possibleConception: false, sourceIds: [], evidenceText: 'physical contact did not form actual reproductive exposure'},
  ];
  for (const outcome of cases) {
    const event = actualExposureOutcome(outcome);
    assert.equal(validateEvent(event).ok, true, outcome.label);
    assert.equal(event.pregnancy_relevance.possible_conception, outcome.possibleConception, outcome.label);
    assert.deepEqual(event.pregnancy_relevance.counterpart_ids, outcome.sourceIds, outcome.label);
  }
});

test('actual exposure outcomes support one or multiple sources without retaining other participants', () => {
  const oneSource = actualExposureOutcome({
    sourceIds: ['character_source_a'],
    possibleConception: true,
    evidenceText: 'source a actual exposure entered the valid path',
  });
  const multipleSources = actualExposureOutcome({
    sourceIds: ['character_source_a', 'character_source_b'],
    possibleConception: true,
    evidenceText: 'both actual exposure sources entered the valid path',
  });
  assert.deepEqual(oneSource.participants.map(item => item.character_id), [
    'character_subject', 'character_source_a',
  ]);
  assert.deepEqual(oneSource.pregnancy_relevance.counterpart_ids, ['character_source_a']);
  assert.deepEqual(multipleSources.participants.map(item => item.character_id), [
    'character_subject', 'character_source_a', 'character_source_b',
  ]);
  assert.deepEqual(multipleSources.pregnancy_relevance.counterpart_ids, [
    'character_source_a', 'character_source_b',
  ]);
  assert.equal(validateEvent(oneSource).ok, true);
  assert.equal(validateEvent(multipleSources).ok, true);
});

test('validateEvent enforces one subject and an exact subject/source participant closure', () => {
  const duplicateIds = validExposureEvent({
    participants: [
      ...validExposureEvent().participants,
      {character_id: 'source-a', event_role: 'potential_conception_source'},
    ],
    pregnancy_relevance: {
      ...validExposureEvent().pregnancy_relevance,
      gestational_subject_ids: ['subject', 'subject'],
      counterpart_ids: ['source-a', 'source-b', 'source-a'],
    },
  });
  assert.equal(validateEvent(duplicateIds).ok, true);
  const normalizedDuplicateIds = normalizeEvent(duplicateIds);
  assert.deepEqual(normalizedDuplicateIds.pregnancy_relevance.gestational_subject_ids, ['subject']);
  assert.deepEqual(normalizedDuplicateIds.pregnancy_relevance.counterpart_ids, ['source-a', 'source-b']);
  assert.deepEqual(normalizedDuplicateIds.participants.map(item => item.character_id), [
    'subject', 'source-a', 'source-b',
  ]);
  assert.equal(validateEvent(validExposureEvent({
    participants: [
      {character_id: 'subject', event_role: 'potential_gestational_subject'},
      {character_id: 'subject-2', event_role: 'potential_gestational_subject'},
      {character_id: 'source-a', event_role: 'potential_conception_source'},
    ],
    pregnancy_relevance: {
      relevant: true,
      possible_conception: true,
      gestational_subject_ids: ['subject', 'subject-2'],
      counterpart_ids: ['source-a'],
      confidence: null,
    },
  })).ok, false);
  assert.equal(validateEvent(validExposureEvent({
    participants: [{character_id: 'subject', event_role: 'potential_gestational_subject'}],
    pregnancy_relevance: {
      relevant: true,
      possible_conception: true,
      gestational_subject_ids: ['subject'],
      counterpart_ids: ['subject'],
      confidence: null,
    },
  })).ok, false);
  assert.equal(validateEvent(validExposureEvent({
    pregnancy_relevance: {
      ...validExposureEvent().pregnancy_relevance,
      counterpart_ids: ['source-a', 'missing-source'],
    },
  })).ok, false);
  assert.equal(validateEvent(validExposureEvent({
    participants: [
      ...validExposureEvent().participants,
      {character_id: 'unrelated-participant', event_role: 'other_participant'},
    ],
  })).ok, false);
});

test('validateEvent checks raw duplicate participant records at their original indexes', () => {
  const baseParticipants = validExposureEvent().participants;
  const validation = validateEvent(validExposureEvent({
    participants: [
      ...baseParticipants,
      {
        ...baseParticipants[1],
        event_role: 'invalid_role',
        reproductive_capabilities_used: {can_cause_pregnancy: 'unknown'},
        evidence: [{kind: 'narrative'}],
      },
    ],
  }));

  assert.equal(validation.ok, false);
  assert.ok(validation.errors.includes('participants[3].event_role'));
  assert.ok(validation.errors.includes(
    'participants[3].reproductive_capabilities_used.can_cause_pregnancy',
  ));
  assert.ok(validation.errors.includes('participants[3].evidence[0].text'));
});

test('validateEventCollection rejects duplicate pregnancy subjects without merging Events', () => {
  const exposure = ({eventId, subjectId, counterpartIds}) => ({
    ...validExposureEvent({event_id: eventId}),
    participants: [
      {character_id: subjectId, event_role: 'potential_gestational_subject'},
      ...counterpartIds.map(characterId => ({
        character_id: characterId,
        event_role: 'potential_conception_source',
      })),
    ],
    pregnancy_relevance: {
      relevant: true,
      possible_conception: true,
      gestational_subject_ids: [subjectId],
      counterpart_ids: counterpartIds,
      confidence: null,
    },
  });
  const subjectA = exposure({eventId: 'evt-a', subjectId: 'subject-a', counterpartIds: ['source-a']});
  const subjectB = exposure({eventId: 'evt-b', subjectId: 'subject-b', counterpartIds: ['source-b', 'source-c']});
  assert.deepEqual(validateEventCollection([subjectA, subjectB]), {ok: true, errors: []});
  const duplicate = validateEventCollection([subjectA, exposure({
    eventId: 'evt-a-duplicate',
    subjectId: 'subject-a',
    counterpartIds: ['source-z'],
  })]);
  assert.equal(duplicate.ok, false);
  assert.ok(duplicate.errors.includes('events[1].pregnancy_relevance.gestational_subject_ids[0]'));

  const mutualExposure = validateEventCollection([
    exposure({eventId: 'evt-mutual-a', subjectId: 'subject-a', counterpartIds: ['subject-b']}),
    exposure({eventId: 'evt-mutual-b', subjectId: 'subject-b', counterpartIds: ['subject-a']}),
  ]);
  assert.deepEqual(mutualExposure, {ok: true, errors: []});
});

test('validateEvent represents sexual activity without exposure as unrelated and empty', () => {
  assert.equal(validateEvent(validExposureEvent({
    participants: [],
    pregnancy_relevance: {
      relevant: false,
      possible_conception: false,
      gestational_subject_ids: [],
      counterpart_ids: [],
      confidence: null,
    },
    source_evidence: [{kind: 'narrative', text: 'no valid exposure path'}],
  })).ok, true);
  assert.equal(validateEvent(validExposureEvent({
    pregnancy_relevance: {
      relevant: false,
      possible_conception: false,
      gestational_subject_ids: [],
      counterpart_ids: [],
      confidence: null,
    },
    source_evidence: [{kind: 'narrative', text: 'no valid exposure path'}],
  })).ok, false);
  assert.equal(validateEvent(validExposureEvent({
    pregnancy_relevance: {
      ...validExposureEvent().pregnancy_relevance,
      possible_conception: false,
    },
  })).ok, false);
  assert.equal(validateEvent(validExposureEvent({
    pregnancy_relevance: {
      relevant: false,
      possible_conception: false,
      gestational_subject_ids: ['subject'],
      counterpart_ids: [],
      confidence: null,
    },
  })).ok, false);
});

test('validateEvent checks the typed gestational substance effect without choosing a mechanism', () => {
  assert.equal(validateEvent(validExposureEvent({
    physical_effect: {gestational_substance_intake: true},
  })).ok, true);
  assert.equal(validateEvent(validExposureEvent({
    physical_effect: {gestational_substance_intake: null},
  })).ok, true);
  assert.equal(validateEvent(validExposureEvent({
    source_evidence: [{kind: 'narrative', text: 'untyped claim'}],
    physical_effect: {gestational_substance_intake: true},
  })).ok, false);
  assert.equal(validateEvent(validExposureEvent({
    physical_effect: {gestational_substance_intake: 'true'},
  })).ok, false);
});

test('all existing biological event types remain accepted by the shared validator', () => {
  for (const [index, type] of EVENT_TYPES.entries()) {
    assert.equal(validateEvent({
      event_id: `event-${index}`,
      type,
      status: 'ambiguous',
      source: {chat_id: 'chat-1'},
    }).ok, true, type);
  }
});

test('sortEvents uses source floor and canonical day index without parsing display text', () => {
  const events = [
    {event_id: 'b', source: {floor: 2}, story_time: {display: 'later', day_index: 3}},
    {event_id: 'a', source: {floor: 1}, story_time: {display: 'earlier', day_index: 2}},
  ];
  const sorted = sortEvents(events);
  assert.deepEqual(sorted.map(event => event.event_id), ['a', 'b']);
  assert.deepEqual(events.map(event => event.event_id), ['b', 'a']);
});
