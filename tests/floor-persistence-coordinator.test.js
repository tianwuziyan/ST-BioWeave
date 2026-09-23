import test from "node:test";
import assert from "node:assert/strict";
import {createFloorPersistenceCoordinator} from "../storage/floor-persistence-coordinator.js";
import {createStore} from "../storage/store.js";

const version = (swipe_id = 0) => ({
  chat_id: "chat-a",
  message_id: "message-a",
  floor: 1,
  swipe_id,
  content_hash: "hash-a",
  message_version: "v1",
});

function fixture({structured = true, initial = {}} = {}) {
  let floor = structured ? {...initial} : {...initial};
  let saves = 0;
  const store = {
    getChatId: () => "chat-a",
    getFloor: () => structuredClone(floor),
    getFloorOwner: () => ({owner_type: "character", active_swipe_id: 0}),
    async saveFloor(_index, _swipe, next) {
      saves += 1;
      floor = structuredClone(next);
    },
  };
  return {store, read: () => structuredClone(floor), saves: () => saves};
}

test("owner patch keeps all sibling roots and confirms the authoritative readback", async () => {
  const current = {
    floor_version: version(),
    world_model: {species: []},
    analysis: {status: "success"},
    events: [{event_id: "event-a"}],
  };
  const state = fixture({initial: current});
  const stages = [];
  const coordinator = createFloorPersistenceCoordinator({
    store: state.store,
    trace: payload => stages.push(payload.stage),
  });
  const result = await coordinator.commitFloorPatch({
    owner: "projection",
    chatId: "chat-a",
    ownerFloor: {message_index: 0},
    floorVersion: version(),
    patch: {projection_timeline: {creations: [], evidence_records: [], lifecycle_records: []}},
  });
  assert.equal(result.status, "confirmed");
  assert.deepEqual(state.read().world_model, current.world_model);
  assert.deepEqual(state.read().analysis, current.analysis);
  assert.deepEqual(state.read().events, current.events);
  assert.ok(stages.includes("FLOOR_TX_LATEST_SLOT_RESOLVED"));
  assert.ok(stages.includes("FLOOR_TX_SIBLING_AUDIT"));
  assert.ok(stages.includes("FLOOR_TX_CONFIRMED"));
});

test("dispatch merges against the latest slot rather than the creation snapshot", async () => {
  const state = fixture({initial: {floor_version: version(), world_model: {old: true}}});
  const latest = {
    floor_version: version(),
    world_model: {newer: true},
    events: [{event_id: "newer-event"}],
  };
  const coordinator = createFloorPersistenceCoordinator({
    store: state.store,
    readLatestFloor: async () => latest,
  });
  await coordinator.commitFloorPatch({
    owner: "projection", chatId: "chat-a", ownerFloor: {message_index: 0},
    floorVersion: version(), patch: {snapshot: {checkpoint: 1}},
  });
  assert.deepEqual(state.read().world_model, latest.world_model);
  assert.deepEqual(state.read().events, latest.events);
  assert.deepEqual(state.read().snapshot, {checkpoint: 1});
});

test("missing readback is a structured failure, never a confirmed save", async () => {
  const state = fixture({initial: {floor_version: version()}});
  state.store.saveFloor = async () => {};
  const coordinator = createFloorPersistenceCoordinator({store: state.store});
  await assert.rejects(() => coordinator.commitFloorPatch({
    owner: "world", chatId: "chat-a", ownerFloor: {message_index: 0},
    floorVersion: version(), patch: {world_model: {species: []}},
  }), error => error.code === "FLOOR_TX_READBACK_FAILED");
});

test("confirmed readback uses the authoritative store reader when available", async () => {
  const state = fixture({initial: {floor_version: version()}});
  let authoritativeReads = 0;
  state.store.readAuthoritativeFloor = async () => {
    authoritativeReads += 1;
    return state.read();
  };
  const coordinator = createFloorPersistenceCoordinator({store: state.store});
  await coordinator.commitFloorPatch({
    owner: "world", chatId: "chat-a", ownerFloor: {message_index: 0},
    floorVersion: version(), patch: {world_model: {species: []}},
  });
  assert.equal(authoritativeReads, 1);
});

test("dispatch acquires a host-ahead owner before applying the Floor patch", async () => {
  const state = fixture({initial: {floor_version: version()}});
  const classifications = [];
  const coordinator = createFloorPersistenceCoordinator({
    store: state.store,
    acquireAuthoritativeFloorOwner: async () => {
      classifications.push("HOST_AHEAD_OF_OFFICIAL");
      return {classification: "HOST_AHEAD_OF_OFFICIAL", confirmed: true, commitState: "readback_confirmed"};
    },
  });
  await coordinator.commitFloorPatch({
    owner: "world", chatId: "chat-a", ownerFloor: {message_index: 0},
    floorVersion: version(), patch: {world_model: {source: "bootstrapped"}},
  });
  assert.deepEqual(classifications, ["HOST_AHEAD_OF_OFFICIAL"]);
  assert.deepEqual(state.read().world_model, {source: "bootstrapped"});
});

test("owner acquisition rejects a true stale owner before any Floor write", async () => {
  const state = fixture({initial: {floor_version: version()}});
  const coordinator = createFloorPersistenceCoordinator({
    store: state.store,
    acquireAuthoritativeFloorOwner: async () => ({
      classification: "TRUE_STALE_OWNER_CHANGE",
      confirmed: false,
    }),
  });
  await assert.rejects(() => coordinator.commitFloorPatch({
    owner: "world", chatId: "chat-a", ownerFloor: {message_index: 0},
    floorVersion: version(), patch: {world_model: {must_not_write: true}},
  }), error => error.code === "FLOOR_TX_STALE_VERSION");
  assert.equal(state.saves(), 0);
});

test("cross-owner fields and non-character owners fail closed", async () => {
  const state = fixture({initial: {floor_version: version(), world_model: {}}});
  const coordinator = createFloorPersistenceCoordinator({store: state.store});
  await assert.rejects(() => coordinator.commitFloorPatch({
    owner: "world",
    chatId: "chat-a",
    ownerFloor: {message_index: 0},
    floorVersion: version(),
    patch: {events: []},
  }), error => error.code === "FLOOR_TX_PATCH_FORBIDDEN");
  state.store.getFloorOwner = () => ({owner_type: "user", active_swipe_id: 0});
  await assert.rejects(() => coordinator.commitFloorPatch({
    owner: "world",
    chatId: "chat-a",
    ownerFloor: {message_index: 0},
    floorVersion: version(),
    patch: {world_model: {}},
  }), error => error.code === "BIOWEAVE_USER_FLOOR_WRITE_FORBIDDEN");
});

test("same Floor transactions serialize and a cancelled queued transaction never writes", async () => {
  const state = fixture({initial: {floor_version: version()}});
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const originalSave = state.store.saveFloor;
  state.store.saveFloor = async (...args) => {
    if (state.saves() === 0) await gate;
    return originalSave(...args);
  };
  const coordinator = createFloorPersistenceCoordinator({store: state.store});
  const execution = {cancelled: false};
  const first = coordinator.commitFloorPatch({
    owner: "world", chatId: "chat-a", ownerFloor: {message_index: 0}, floorVersion: version(),
    patch: {world_model: {source: "first"}},
  });
  const second = coordinator.commitFloorPatch({
    owner: "event", chatId: "chat-a", ownerFloor: {message_index: 0}, floorVersion: version(),
    execution, patch: {events: [{event_id: "late"}]},
  });
  execution.cancelled = true;
  release();
  await first;
  await assert.rejects(second, error => error.code === "FLOOR_TX_SUPERSEDED");
  assert.equal(state.saves(), 1);
  assert.deepEqual(state.read().world_model, {source: "first"});
  assert.equal(state.read().events, undefined);
});

test("a late terminal failure cannot overwrite confirmed Event success", async () => {
  const state = fixture({initial: {
    floor_version: version(),
    analysis: {status: "success", attempt: 2},
    events: [{event_id: "event-a"}],
  }});
  const coordinator = createFloorPersistenceCoordinator({store: state.store});
  await assert.rejects(() => coordinator.commitFloorPatch({
    owner: "terminal", chatId: "chat-a", ownerFloor: {message_index: 0},
    floorVersion: version(), operation_type: "terminal-analysis-patch",
    patch: {analysis: {status: "failed", attempt: 1}},
  }), error => error.code === "FLOOR_TX_TERMINAL_SUPERSEDED");
  assert.equal(state.read().analysis.status, "success");
  assert.deepEqual(state.read().events, [{event_id: "event-a"}]);
});

test("a later Event success may replace an earlier terminal failure", async () => {
  const state = fixture({initial: {
    floor_version: version(),
    analysis: {status: "failed", attempt: 1},
  }});
  const coordinator = createFloorPersistenceCoordinator({store: state.store});
  await coordinator.commitFloorPatch({
    owner: "event", chatId: "chat-a", ownerFloor: {message_index: 0},
    floorVersion: version(),
    patch: {analysis: {status: "success", attempt: 2}, events: [{event_id: "event-b"}]},
  });
  assert.equal(state.read().analysis.status, "success");
  assert.deepEqual(state.read().events, [{event_id: "event-b"}]);
});

test("a queued terminal transaction is cancelled when its execution is superseded", async () => {
  const state = fixture({initial: {floor_version: version()}});
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const originalSave = state.store.saveFloor;
  state.store.saveFloor = async (...args) => {
    if (state.saves() === 0) await gate;
    return originalSave(...args);
  };
  const coordinator = createFloorPersistenceCoordinator({store: state.store});
  const first = coordinator.commitFloorPatch({
    owner: "world", chatId: "chat-a", ownerFloor: {message_index: 0}, floorVersion: version(),
    patch: {world_model: {source: "first"}},
  });
  const execution = {superseded: false};
  const terminal = coordinator.commitFloorPatch({
    owner: "terminal", chatId: "chat-a", ownerFloor: {message_index: 0}, floorVersion: version(),
    operation_type: "terminal-analysis-patch", execution,
    patch: {analysis: {status: "failed", attempt: 1}},
  });
  execution.superseded = true;
  release();
  await first;
  await assert.rejects(terminal, error => error.code === "FLOOR_TX_SUPERSEDED");
  assert.equal(state.saves(), 1);
});

test("a terminal transaction with a stale current Floor Version fails closed", async () => {
  const state = fixture({initial: {floor_version: version()}});
  const coordinator = createFloorPersistenceCoordinator({
    store: state.store,
    resolveCurrentFloorVersion: async () => ({...version(), content_hash: "newer-hash", message_version: "v2"}),
  });
  await assert.rejects(() => coordinator.commitFloorPatch({
    owner: "terminal", chatId: "chat-a", ownerFloor: {message_index: 0},
    floorVersion: version(), operation_type: "terminal-analysis-patch",
    patch: {analysis: {status: "failed", attempt: 1}},
  }), error => error.code === "FLOOR_TX_STALE_VERSION");
  assert.equal(state.saves(), 0);
});

test("Swipe 0 and no-Swipe canonical owners both use the same slot contract", async () => {
  for (const structured of [true, false]) {
    const state = fixture({structured, initial: {floor_version: version()}});
    const coordinator = createFloorPersistenceCoordinator({store: state.store});
    await coordinator.commitFloorPatch({
      owner: "world", chatId: "chat-a", ownerFloor: {message_index: 0}, swipeId: 0,
      floorVersion: version(), patch: {world_model_meta: {source: structured ? "swipe-0" : "plain"}},
    });
    assert.deepEqual(state.read().world_model_meta, {source: structured ? "swipe-0" : "plain"});
  }
});

test("the storage boundary prefers the coordinator's generic slot writer over the legacy alias", async () => {
  const message = {role: "assistant", swipe_id: 0, swipe_info: [{extra: {}}]};
  let genericCalls = 0;
  let legacyCalls = 0;
  const store = createStore({
    getChatId: () => "chat-a",
    getMessage: () => message,
    saveFloorSlot: async () => { genericCalls += 1; },
    saveFloorBioWeave: async () => { legacyCalls += 1; },
  });
  await store.saveFloor(0, 0, {floor_version: version(), world_model: {}});
  assert.equal(genericCalls, 1);
  assert.equal(legacyCalls, 0);
});
