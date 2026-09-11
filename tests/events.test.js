import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_TYPES,
  normalizeEvent,
  sortEvents,
  validateEvent,
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
    }],
    pregnancy_relevance: {
      relevant: true,
      possible_conception: true,
      gestational_subject_ids: ['char-a', 'char-a'],
      counterpart_ids: ['char-b', 'char-c'],
    },
    source_evidence: [{kind: 'current_floor', text: 'current floor'}],
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
