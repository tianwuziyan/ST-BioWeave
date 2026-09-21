import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregateContributorAttribution, createContributorAttribution, createReproductiveSourceCandidate, validateContributorAttribution} from '../core/reproductive-attribution.js';
import {normalizeEvent, validateEvent} from '../core/events.js';

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
