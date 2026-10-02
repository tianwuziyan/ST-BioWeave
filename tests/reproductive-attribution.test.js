import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregateContributorAttribution, attributionBySubjectFromCurrentState, createContributorAttribution, createReproductiveSourceCandidate, deriveReproductiveSourceCandidates, validateContributorAttribution} from '../core/reproductive-attribution.js';
import {normalizeEvent, PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND, validateEvent} from '../core/events.js';

function candidate(source_character_id, compatibility = true, contribution_kind = 'genetic') { return createReproductiveSourceCandidate({subject_id: 'char_000001', source_character_id, source_event_ids: [`event-${source_character_id}`], mechanism_key: 'mechanism:a', contribution_kind, compatibility}); }

test('multiple source candidates remain derived and do not imply attribution', () => {
  const result = aggregateContributorAttribution({pregnancy_id: 'pregnancy-1', subject_id: 'char_000001', candidates: [candidate('char_000002'), candidate('char_000003'), candidate('char_000004', null)]});
  assert.deepEqual(result.confirmed, []);
  assert.equal(result.candidates.length, 3);
  assert.equal(result.unresolved, true);
});
test('false compatibility is excluded while null remains unresolved', () => {
  const result = aggregateContributorAttribution({pregnancy_id: 'p1', subject_id: 'char_000001', candidates: [candidate('char_000002', false), candidate('char_000003', null)]});
  assert.deepEqual(result.candidates.map(item => item.source_character_id), ['char_000003']);
  assert.equal(result.unresolved, true);
});
test('derived candidates aggregate multiple sources and mechanisms without inferring contribution kind', () => {
  const exposureEvent = (event_id, counterpart_ids, mechanism) => normalizeEvent({
    event_id, type: 'sexual_activity', status: 'confirmed', story_time: {day_index: Number(event_id.slice(-1))},
    source: {chat_id: 'chat-a', message_id: event_id, floor: 1, swipe_id: 0, content_hash: event_id, message_version: event_id},
    participants: [{character_id: 'char_000001', event_role: 'potential_gestational_subject'}],
    pregnancy_relevance: {relevant: true, possible_conception: true, gestational_subject_ids: ['char_000001'], counterpart_ids, reproductive_mechanism: {kind: mechanism}},
    source_evidence: [{kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND, text: 'exposure'}],
  });
  const events = [exposureEvent('event-1', ['char_000002', 'char_000003'], 'genetic'), exposureEvent('event-2', ['char_000002'], 'genetic'), exposureEvent('event-3', ['char_000002'], 'magical'), normalizeEvent({
    event_id: 'confirmation-1', type: 'pregnancy_confirmation', status: 'confirmed', story_time: {day_index: 4},
    source: {chat_id: 'chat-a', message_id: 'confirmation-1', floor: 4, swipe_id: 0, content_hash: 'confirmation-1', message_version: 'confirmation-1'},
    participants: [{character_id: 'char_000001', event_role: 'potential_gestational_subject'}],
    state_fact: {subject_id: 'char_000001', payload: {pregnancy_id: 'pregnancy-1'}},
  })];
  const windows = [{status: 'resolved_pregnant', terminal_reason: 'pregnancy_confirmation', terminal_event_id: 'confirmation-1', subject_id: 'char_000001', mechanism_key: 'genetic', source_event_ids: ['event-2', 'event-1']}, {status: 'resolved_pregnant', terminal_reason: 'pregnancy_confirmation', terminal_event_id: 'confirmation-1', subject_id: 'char_000001', mechanism_key: 'magical', source_event_ids: ['event-3']}];
  const result = deriveReproductiveSourceCandidates({trackingWindows: windows, events});
  assert.deepEqual(result.map(item => [item.pregnancy_id, item.candidate.source_character_id, item.candidate.mechanism_key, item.candidate.source_event_ids, item.candidate.contribution_kind]), [
    ['pregnancy-1', 'char_000002', 'genetic', ['event-1', 'event-2'], null],
    ['pregnancy-1', 'char_000002', 'magical', ['event-3'], null],
    ['pregnancy-1', 'char_000003', 'genetic', ['event-1'], null],
  ]);
  assert.equal(result.every(item => item.candidate.compatibility === null), true);
});

test('candidate handoff rebuild drops deleted source or confirmation facts', () => {
  const exposureEvent = normalizeEvent({
    event_id: 'surviving-exposure', type: 'sexual_activity', status: 'confirmed', story_time: {day_index: 1},
    source: {chat_id: 'chat-a', message_id: 'm1', floor: 1, swipe_id: 0, content_hash: 'h1', message_version: 'v1'},
    participants: [{character_id: 'char_000001', event_role: 'potential_gestational_subject'}],
    pregnancy_relevance: {relevant: true, possible_conception: true, gestational_subject_ids: ['char_000001'], counterpart_ids: ['char_000002'], reproductive_mechanism: {kind: 'fertilization'}},
    source_evidence: [{kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND, text: 'exposure'}],
  });
  const confirmationEvent = normalizeEvent({
    event_id: 'surviving-confirmation', type: 'pregnancy_confirmation', status: 'confirmed', story_time: {day_index: 2},
    source: {chat_id: 'chat-a', message_id: 'm2', floor: 2, swipe_id: 0, content_hash: 'h2', message_version: 'v2'},
    participants: [{character_id: 'char_000001', event_role: 'potential_gestational_subject'}],
    state_fact: {subject_id: 'char_000001', payload: {pregnancy_id: 'pregnancy-1'}},
  });
  const window = {status: 'resolved_pregnant', terminal_reason: 'pregnancy_confirmation', terminal_event_id: 'surviving-confirmation', subject_id: 'char_000001', mechanism_key: 'fertilization', source_event_ids: ['surviving-exposure']};
  assert.equal(deriveReproductiveSourceCandidates({trackingWindows: [window], events: [exposureEvent, confirmationEvent]}).length, 1);
  assert.equal(deriveReproductiveSourceCandidates({trackingWindows: [window], events: [confirmationEvent]}).length, 0);
  assert.equal(deriveReproductiveSourceCandidates({trackingWindows: [window], events: [exposureEvent]}).length, 0);
});
test('confirmed and excluded relationships are factual event inputs and support multiple contributors', () => {
  const result = aggregateContributorAttribution({pregnancy_id: 'p1', subject_id: 'char_000001', candidates: [candidate('char_000002', true, 'genetic'), candidate('char_000003', true, 'magical')], attributionEvents: [
    {pregnancy_id: 'p1', subject_id: 'char_000001', source_character_id: 'char_000002', contribution_kind: 'genetic', attribution: 'confirmed'},
    {pregnancy_id: 'p1', subject_id: 'char_000001', source_character_id: 'char_000003', contribution_kind: 'magical', attribution: 'confirmed'},
    {pregnancy_id: 'p1', subject_id: 'char_000001', source_character_id: 'char_000004', contribution_kind: 'genetic', attribution: 'excluded'},
  ]});
  assert.equal(result.confirmed.length, 2);
  assert.equal(result.excluded.length, 1);
});
test('same source with different contribution kinds has distinct relationship identity', () => {
  const result = createContributorAttribution({pregnancy_id: 'p1', subject_id: 'char_000001', confirmed: [{subject_id: 'char_000001', source_character_id: 'char_000002', contribution_kind: 'genetic'}, {subject_id: 'char_000001', source_character_id: 'char_000002', contribution_kind: 'magical'}], excluded: [], candidates: [], unresolved: false, conflicts: []});
  assert.notEqual(result.confirmed[0].relationship_key, result.confirmed[1].relationship_key);
});
test('confirmed and excluded for one relationship fail closed', () => {
  const result = aggregateContributorAttribution({pregnancy_id: 'p1', subject_id: 'char_000001', attributionEvents: [
    {pregnancy_id: 'p1', subject_id: 'char_000001', source_character_id: 'char_000002', contribution_kind: 'genetic', attribution: 'confirmed'},
    {pregnancy_id: 'p1', subject_id: 'char_000001', source_character_id: 'char_000002', contribution_kind: 'genetic', attribution: 'excluded'},
  ]});
  assert.equal(result.unresolved, true);
  assert.equal(result.conflicts[0].code, 'attribution_conflict');
});
test('candidate and attribution DTOs reject single father fields and remain immutable', () => {
  const value = {subject_id: 'char_000001', source_character_id: 'char_000002', source_event_ids: ['e1'], mechanism_key: 'm', contribution_kind: 'genetic', compatibility: true};
  const before = structuredClone(value); createReproductiveSourceCandidate(value); assert.deepEqual(value, before);
  assert.equal(validateContributorAttribution({schema_version: 1, pregnancy_id: 'p1', subject_id: 'char_000001', father_id: 'char_000002', confirmed: [], excluded: [], candidates: [], unresolved: true, conflicts: []}).ok, false);
});

test('current State attribution read model preserves subject isolation and unresolved conflicts', () => {
  const state = {
    characters: {
      char_000001: {
        pregnancy: {
          episodes: {
            pregnancy_a: {
              pregnancy_id: 'pregnancy_a',
              contributors: {
                confirmed: [{relationship_key: 'pregnancy_a|char_000001|char_000002|genetic', subject_id: 'char_000001', source_character_id: 'char_000002', contribution_kind: 'genetic'}],
                excluded: [{relationship_key: 'pregnancy_a|char_000001|char_000003|genetic', subject_id: 'char_000001', source_character_id: 'char_000003', contribution_kind: 'genetic'}],
                conflicts: [],
              },
            },
            pregnancy_b: {
              pregnancy_id: 'pregnancy_b',
              contributors: {confirmed: [], excluded: [], conflicts: [{relationship_key: 'conflict'}]},
            },
          },
        },
      },
      char_000004: {
        pregnancy: {episodes: {pregnancy_c: {pregnancy_id: 'pregnancy_c', contributors: {confirmed: [], excluded: [], conflicts: []}}}},
      },
    },
  };
  const before = structuredClone(state);
  const result = attributionBySubjectFromCurrentState(state);
  assert.deepEqual(result.char_000001.confirmed.map(item => item.source_character_id), ['char_000002']);
  assert.deepEqual(result.char_000001.excluded.map(item => item.source_character_id), ['char_000003']);
  assert.equal(result.char_000001.unresolved, true);
  assert.equal(result.char_000004, undefined);
  assert.deepEqual(state, before);
});

test('factual attribution Event accepts confirmed/excluded relationships but not candidates', () => {
  const event = normalizeEvent({
    event_id: 'event-attribution-1', type: 'reproductive_source_attribution', status: 'confirmed',
    participants: [
      {character_id: 'char_000001', event_role: 'potential_gestational_subject'},
      {character_id: 'char_000002', event_role: 'potential_conception_source'},
    ],
    state_fact: {subject_id: 'char_000001', payload: {pregnancy_id: 'p1', source_character_id: 'char_000002', contribution_kind: 'genetic', attribution: 'confirmed'}},
    source: {chat_id: 'chat-a', message_id: 'm1', floor: 1, swipe_id: 0, content_hash: 'hash', message_version: 'v1'},
    story_time: {day_index: 1, calendar_id: 'main', precision: 'day'},
  });
  assert.equal(validateEvent(event, {strictCanonicalParticipants: true}).ok, true);
  assert.equal(validateEvent({...event, state_fact: {...event.state_fact, payload: {...event.state_fact.payload, attribution: 'candidate'}}}).ok, false);
  assert.equal(validateEvent({...event, status: 'ambiguous'}).ok, true);
});
