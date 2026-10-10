import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveTrackingWindows } from '../core/tracking-window.js';
import { createTrackingWindowPersistence } from '../storage/tracking-window.js';
import { emptyFloor } from '../storage/schema.js';

const version = {chat_id: 'chat-window', message_id: 'message-1', floor: 1, swipe_id: 0, content_hash: 'hash-1', message_version: 'v1'};

function fixture() {
  let floor = {...emptyFloor(), floor_version: version};
  let activeSwipe = 0;
  const store = {
    getActiveSwipeId: () => activeSwipe,
    getFloorOwner: () => ({owner_type: 'character', active_swipe_id: 0}),
    getFloor: () => structuredClone(floor),
    getCurrentChatOwnerSnapshot: () => ({messages: [{}]}),
    async saveFloor(_index, _swipe, next) { floor = structuredClone(next); },
  };
  return {store, read: () => structuredClone(floor), setSwipe: value => { activeSwipe = value; }};
}

const windowRecord = deriveTrackingWindows([{
  event_id: 'exposure-1',
  type: 'sexual_activity',
  status: 'confirmed',
  story_time: {day_index: 1},
  source: version,
  participants: [
    {character_id: 'char-subject', event_role: 'potential_gestational_subject', reproductive_capabilities_used: {can_carry_pregnancy: true}},
    {character_id: 'char-source', event_role: 'potential_conception_source', reproductive_capabilities_used: {can_cause_pregnancy: true}},
  ],
  pregnancy_relevance: {relevant: true, possible_conception: true, gestational_subject_ids: ['char-subject'], counterpart_ids: ['char-source'], reproductive_mechanism: {kind: 'fertilization'}},
  source_evidence: [{kind: 'pregnancy_relevant_exposure', text: 'factual'}],
}], {chatId: 'chat-window'})[0];

test('Tracking Window persistence is Floor-owned, readback-confirmed, and deduped', async () => {
  const state = fixture();
  const persistence = createTrackingWindowPersistence({
    store: state.store,
    resolveCurrentFloorVersion: async () => version,
  });
  const first = await persistence.appendTrackingWindow({chatId: 'chat-window', ownerFloor: {message_index: 0}, floorVersion: version, window: windowRecord});
  assert.equal(first.status, 'appended');
  assert.equal(state.read().tracking_window_timeline.creations.length, 1);
  const second = await persistence.appendTrackingWindow({chatId: 'chat-window', ownerFloor: {message_index: 0}, floorVersion: version, window: windowRecord});
  assert.equal(second.status, 'deduped');
  const attached = await persistence.appendTrackingWindow({chatId: 'chat-window', ownerFloor: {message_index: 0}, floorVersion: version, window: {...windowRecord, source_event_ids: ['exposure-1', 'exposure-2'], source_basis_refs: {...windowRecord.source_basis_refs, 'exposure-2': {event_id: 'exposure-2', story_time: {day_index: 2}, source: version}}}});
  assert.equal(attached.status, 'appended');
  assert.deepEqual(state.read().tracking_window_timeline.creations[0].source_event_ids, ['exposure-1', 'exposure-2']);
  const readback = await persistence.getTrackingWindowTimeline({chatId: 'chat-window'});
  assert.equal(readback.creations[0].tracking_window_id, windowRecord.tracking_window_id);
});

test('Tracking Window persistence fails closed for stale active Swipe', async () => {
  const state = fixture();
  state.setSwipe(1);
  const persistence = createTrackingWindowPersistence({store: state.store, resolveCurrentFloorVersion: async () => version});
  await assert.rejects(
    persistence.appendTrackingWindow({chatId: 'chat-window', ownerFloor: {message_index: 0}, floorVersion: version, window: windowRecord}),
    error => error.code === 'FLOOR_SWIPE_STALE',
  );
});

test('Tracking Window history respects both message and Floor endpoints', async () => {
  const current = {
    chat_id: 'chat-window',
    message_id: 'message-current',
    floor: 250,
    swipe_id: 0,
    content_hash: 'hash-current',
    message_version: 'v-current',
  };
  const future = {
    chat_id: 'chat-window',
    message_id: 'message-future',
    floor: 400,
    swipe_id: 0,
    content_hash: 'hash-future',
    message_version: 'v-future',
  };
  const messages = [{}, {}];
  const floors = [
    {...emptyFloor(), floor_version: current, tracking_window_timeline: {
      schema_version: 1,
      creations: [{...windowRecord, tracking_window_id: 'window-current', created_at_floor_version: current}],
      lifecycle_records: [],
    }},
    {...emptyFloor(), floor_version: future, tracking_window_timeline: {
      schema_version: 1,
      creations: [{...windowRecord, tracking_window_id: 'window-future', created_at_floor_version: future}],
      lifecycle_records: [],
    }},
  ];
  const persistence = createTrackingWindowPersistence({
    store: {
      getActiveSwipeId: () => 0,
      getFloor: index => floors[index],
      getCurrentChatOwnerSnapshot: () => ({messages}),
    },
    floorPersistence: {commitFloorPatch: async () => ({commitState: 'confirmed'})},
  });

  const bounded = await persistence.getTrackingWindowTimeline({
    chatId: 'chat-window',
    endpointIndex: 0,
    endpointFloor: 250,
  });
  assert.deepEqual(bounded.creations.map(item => item.tracking_window_id), ['window-current']);
});
