import test from 'node:test';
import assert from 'node:assert/strict';
import { reduceState } from '../core/state.js';
import {
  createSnapshot,
  restoreFromSnapshot,
  shouldSnapshot,
  validateSnapshot,
} from '../core/snapshot.js';

const SUBJECT = 'char_000001';
const SOURCE = 'char_000002';

function storyTime(day) {
  return {
    display: `day ${day}`,
    normalized: `0001-01-${String(day).padStart(2, '0')}`,
    day_index: day,
    calendar_id: 'calendar-main',
    precision: 'day',
    confidence: 1,
  };
}

function facts() {
  return {
    [SUBJECT]: {
      identity: {
        character_id: SUBJECT,
        display_name: 'Subject',
        species: 'Species-A',
        biological_type: 'Type-A',
      },
      reproductive_capabilities: {
        can_carry_pregnancy: true,
        can_be_fertilized: true,
      },
    },
  };
}

function event(eventId, day) {
  return {
    event_id: eventId,
    type: 'physical_symptom',
    status: 'confirmed',
    source: {
      chat_id: 'chat-1',
      message_id: `message-${eventId}`,
      floor: day,
      swipe_id: 0,
      content_hash: `hash-${eventId}`,
      message_version: 'v1',
    },
    story_time: storyTime(day),
    participants: [{ character_id: SUBJECT, event_role: 'unknown' }],
    pregnancy_relevance: {
      relevant: false,
      possible_conception: false,
      gestational_subject_ids: [],
      counterpart_ids: [],
      confidence: null,
    },
    state_fact: {
      subject_id: SUBJECT,
      payload: { symptom: { kind: 'observed', description: eventId } },
    },
  };
}

function checkpoint({ floor = 1, swipe_id = 0 } = {}) {
  return {
    chat_id: 'chat-1',
    message_id: `message-${floor}`,
    floor,
    swipe_id,
    content_hash: `hash-${floor}`,
    message_version: `v${floor}`,
  };
}

function validSnapshot(options = {}) {
  return createSnapshot({
    checkpoint: checkpoint(options),
    state: reduceState({ characterFacts: facts() }),
  });
}

test('Snapshot replay through baseState matches full replay', () => {
  const first = [event('event-a', 1), event('event-b', 2)];
  const later = [event('event-c', 3)];
  const stateA = reduceState({ events: first, characterFacts: facts(), currentStoryTime: storyTime(4) });
  const snapshot = createSnapshot({ checkpoint: checkpoint({ floor: 2 }), state: stateA });
  const stateB = restoreFromSnapshot({
    snapshot,
    events: later,
    characterFacts: facts(),
    currentStoryTime: storyTime(4),
  });
  const stateC = reduceState({
    events: [...first, ...later],
    characterFacts: facts(),
    currentStoryTime: storyTime(4),
  });
  assert.deepEqual(stateB, stateC);
});

test('Snapshot creation and restore isolate Current State and Snapshot state', () => {
  const state = reduceState({ events: [event('event-a', 1)], characterFacts: facts() });
  const snapshot = createSnapshot({ checkpoint: checkpoint(), state });
  snapshot.state.characters[SUBJECT].symptoms.records[0].symptom.description = 'changed';
  assert.equal(state.characters[SUBJECT].symptoms.records[0].symptom.description, 'event-a');

  const beforeRestore = structuredClone(snapshot);
  restoreFromSnapshot({ snapshot, events: [], characterFacts: facts() });
  assert.deepEqual(snapshot, beforeRestore);
});

test('Snapshot validation rejects invalid State schema and forbidden projection data', () => {
  const snapshot = validSnapshot();
  const invalidState = structuredClone(snapshot);
  invalidState.state.schema_version = 2;
  assert.equal(validateSnapshot(invalidState).ok, false);

  const projectionState = structuredClone(snapshot);
  projectionState.state.projection = { pregnancy_probability: 0.5 };
  assert.equal(validateSnapshot(projectionState).ok, false);
  assert.equal(validateSnapshot({ ...snapshot, checkpoint: { ...snapshot.checkpoint, swipe_id: 0, message_version: null } }).ok, false);
});

test('Snapshot validation rejects wrong Chat, Swipe, Floor Version, and User owner', () => {
  const snapshot = validSnapshot({ swipe_id: 0 });
  const version = snapshot.checkpoint;
  assert.equal(validateSnapshot(snapshot, { expectedChatId: 'chat-other' }).ok, false);
  assert.equal(validateSnapshot(snapshot, { expectedFloorVersion: { ...version, content_hash: 'wrong' } }).ok, false);
  assert.equal(validateSnapshot(snapshot, { owner: { role: 'assistant', swipe_id: 1, floor_version: version } }).ok, false);
  assert.equal(validateSnapshot(snapshot, { owner: { role: 'user', swipe_id: 0, floor_version: version } }).ok, false);
  assert.equal(validateSnapshot(snapshot, { owner: { role: 'assistant', swipe_id: 0, floor_version: version } }).ok, true);
});

test('Swipe 0 is a real owner and User entries never count as Character Floors', () => {
  const floors = [
    { role: 'assistant', checkpoint: checkpoint({ floor: 1, swipe_id: 0 }) },
    { role: 'user', checkpoint: checkpoint({ floor: 2, swipe_id: 0 }) },
    { role: 'user', checkpoint: checkpoint({ floor: 3, swipe_id: 0 }) },
    { role: 'assistant', checkpoint: checkpoint({ floor: 4, swipe_id: 0 }) },
    { role: 'user', checkpoint: checkpoint({ floor: 5, swipe_id: 0 }) },
    { role: 'assistant', checkpoint: checkpoint({ floor: 6, swipe_id: 0 }) },
  ];
  assert.equal(shouldSnapshot({ characterFloors: floors, interval: 3 }), true);
  assert.equal(shouldSnapshot({ characterFloors: floors.slice(0, 5), interval: 3 }), false);
  assert.equal(shouldSnapshot({ characterFloors: floors, lastSnapshotCheckpoint: floors[0], interval: 3 }), false);
  assert.equal(shouldSnapshot({ characterFloors: floors, lastSnapshotCheckpoint: floors[1], interval: 3 }), true);
});

test('shouldSnapshot counts valid Character Floor progression instead of message floor gaps', () => {
  const floors = [
    { role: 'assistant', checkpoint: checkpoint({ floor: 10 }) },
    { role: 'user', checkpoint: checkpoint({ floor: 11 }) },
    { role: 'user', checkpoint: checkpoint({ floor: 12 }) },
    { role: 'assistant', checkpoint: checkpoint({ floor: 20 }) },
    { role: 'user', checkpoint: checkpoint({ floor: 21 }) },
    { role: 'assistant', checkpoint: checkpoint({ floor: 30 }) },
  ];
  assert.equal(shouldSnapshot({ characterFloors: floors, interval: 3 }), true);
  assert.equal(shouldSnapshot({ characterFloors: floors.slice(0, 2), interval: 3 }), false);
  assert.equal(shouldSnapshot({ characterFloors: floors, interval: 3, majorEvent: true }), true);
});

test('restore uses baseState and rejects a missing Snapshot so full replay remains available', () => {
  const snapshot = validSnapshot();
  let received;
  const result = restoreFromSnapshot({
    snapshot,
    events: ['later-event'],
    currentStoryTime: 'story-time',
    characterFacts: { fact: true },
    reducer: (input) => {
      received = input;
      return 'reduced';
    },
  });
  assert.equal(result, 'reduced');
  assert.deepEqual(received.baseState, snapshot.state);
  assert.deepEqual(received.events, ['later-event']);
  assert.equal(received.snapshot, undefined);
  assert.throws(() => restoreFromSnapshot({ snapshot: null }), /SNAPSHOT_INVALID/);
});
