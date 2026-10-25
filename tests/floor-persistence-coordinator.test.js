import test from "node:test";
import assert from "node:assert/strict";
import {createFloorPersistenceCoordinator} from "../storage/floor-persistence-coordinator.js";
import {createStore} from "../storage/store.js";
import {normalizeFloorOwner} from "../core/floor-owner.js";

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
  assert.ok(stages.includes("FLOOR_TX_CONTEXT_SLOT_RESOLVED"));
  assert.ok(stages.includes("FLOOR_TX_SIBLING_AUDIT"));
  assert.ok(stages.includes("FLOOR_TX_CONFIRMED"));
});

test("dispatch merges against the current Context slot and ignores official latest readers", async () => {
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
  assert.deepEqual(state.read().world_model, {old: true});
  assert.equal(state.read().events, undefined);
  assert.deepEqual(state.read().snapshot, {checkpoint: 1});
});

test("an owner patch normalizes a legacy Context owner before confirming the write", async () => {
  const state = fixture({initial: {
    floor_version: version(),
    world_model: {stable: true},
  }});
  let readbackCount = 0;
  state.store.readAuthoritativeFloor = async () => {
    readbackCount += 1;
    return state.read();
  };
  const coordinator = createFloorPersistenceCoordinator({store: state.store});
  const result = await coordinator.commitFloorPatch({
    owner: "world",
    chatId: "chat-a",
    ownerFloor: {message_index: 0},
    floorVersion: version(),
    patch: {world_model: {stable: true}},
  });
  assert.equal(result.status, "confirmed");
  assert.equal(result.commitState, "confirmed");
  assert.equal(result.authoritativeReadback, true);
  assert.equal(state.saves(), 1);
  assert.equal(readbackCount, 1);
  assert.deepEqual(state.read().floor_version, normalizeFloorOwner(version()));
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

test("dispatch does not acquire an official owner before applying the Context patch", async () => {
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
  assert.deepEqual(classifications, []);
  assert.deepEqual(state.read().world_model, {source: "bootstrapped"});
});

test("owner acquisition hooks are not used by the Context-first transaction", async () => {
  const state = fixture({initial: {floor_version: version()}});
  const coordinator = createFloorPersistenceCoordinator({
    store: state.store,
    acquireAuthoritativeFloorOwner: async () => ({
      classification: "TRUE_STALE_OWNER_CHANGE",
      confirmed: false,
    }),
  });
  await coordinator.commitFloorPatch({
    owner: "world", chatId: "chat-a", ownerFloor: {message_index: 0},
    floorVersion: version(), patch: {world_model: {must_not_write: true}},
  });
  assert.equal(state.saves(), 1);
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

test("performance stages expose queue wait, Coordinator execution, merge, store save, and readback per operation", async () => {
  const state = fixture({initial: {floor_version: version()}});
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const originalSave = state.store.saveFloor;
  state.store.saveFloor = async (...args) => {
    if (state.saves() === 0) await gate;
    return originalSave(...args);
  };
  const stages = [];
  const coordinator = createFloorPersistenceCoordinator({
    store: state.store,
    performanceStage: payload => stages.push(payload),
  });
  const first = coordinator.commitFloorPatch({
    owner: "world", chatId: "chat-a", ownerFloor: {message_index: 0}, floorVersion: version(),
    traceContext: {performance_operation_id: "op-1", persistence_kind: "TIMING_INSTANCE"},
    patch: {world_model: {source: "first"}},
  });
  const second = coordinator.commitFloorPatch({
    owner: "event", chatId: "chat-a", ownerFloor: {message_index: 0}, floorVersion: version(),
    traceContext: {performance_operation_id: "op-2", persistence_kind: "PARTICIPANT_AGGREGATION"},
    patch: {events: [{event_id: "second"}]},
  });
  await Promise.resolve();
  release();
  await Promise.all([first, second]);

  const byOperation = new Map();
  for (const stage of stages) {
    assert.ok(["op-1", "op-2"].includes(stage.operation_id));
    assert.ok(["TIMING_INSTANCE", "PARTICIPANT_AGGREGATION"].includes(stage.persistence_kind));
    assert.equal(stage.kind, "ASYNC");
    assert.ok(Number.isFinite(stage.duration_ms));
    byOperation.set(stage.operation_id, [...(byOperation.get(stage.operation_id) ?? []), stage]);
  }
  for (const operationId of ["op-1", "op-2"]) {
    const operationStages = byOperation.get(operationId) ?? [];
    const names = operationStages.map(stage => stage.stage);
    assert.ok(names.includes("COORDINATOR_QUEUE_WAIT"));
    assert.ok(names.includes("COORDINATOR_EXECUTION"));
    assert.ok(names.includes("SNAPSHOT_MERGE"));
    assert.ok(names.includes("STORE_SAVE_FLOOR"));
    assert.ok(names.includes("COORDINATOR_READBACK"));
  }
  const queuedSecond = (byOperation.get("op-2") ?? []).find(stage => stage.stage === "COORDINATOR_QUEUE_WAIT");
  assert.equal(queuedSecond.queue_depth_at_enqueue, 1);
  assert.ok(Number.isFinite(queuedSecond.queue_wait_ms));
  const executionSecond = (byOperation.get("op-2") ?? []).find(stage => stage.stage === "COORDINATOR_EXECUTION");
  assert.equal(executionSecond.execution_duration_ms, executionSecond.duration_ms);
  const storeSaveSecond = (byOperation.get("op-2") ?? []).find(stage => stage.stage === "STORE_SAVE_FLOOR");
  assert.equal(storeSaveSecond.store_save_duration_ms, storeSaveSecond.duration_ms);
  assert.equal(stages.some(stage => stage.stage === "HOST_SAVE_AWAIT"), false);
});

test("no-op performance stages expose owner waits and never claim a Floor or host save", async () => {
  const state = fixture({initial: {floor_version: version(), world_model: {stable: true}}});
  const stages = [];
  const readContexts = [];
  let assertCurrentCalls = 0;
  state.store.readAuthoritativeFloor = async (_index, _swipe, _expected, traceContext) => {
    readContexts.push(traceContext);
    return state.read();
  };
  const coordinator = createFloorPersistenceCoordinator({
    store: state.store,
    performanceStage: payload => stages.push(payload),
    acquireAuthoritativeFloorOwner: async () => ({
      classification: "AUTHORITATIVE_MATCH",
      confirmed: true,
    }),
  });
  const result = await coordinator.commitFloorPatch({
    owner: "world",
    chatId: "chat-a",
    ownerFloor: {message_index: 0},
    floorVersion: version(),
    traceContext: {performance_operation_id: "op-noop", persistence_kind: "TIMING_INSTANCE"},
    patchResolver: async () => ({__floor_tx_noop: true}),
    assertCurrent: async () => {
      assertCurrentCalls += 1;
      return true;
    },
  });

  assert.equal(result.status, "noop");
  assert.equal(result.commitState, "local-noop");
  assert.equal(result.authoritativeReadback, false);
  assert.equal(result.noWrite, true);
  assert.equal(state.saves(), 0);
  assert.equal(assertCurrentCalls, 2);
  const stage = name => stages.find(item => item.stage === name);
  assert.equal(stage("COORDINATOR_OWNER_GUARD")?.status, "SUCCEEDED");
  assert.equal(stage("COORDINATOR_OWNER_ACQUISITION"), undefined);
  assert.equal(stage("COORDINATOR_NOOP_GUARD")?.status, "SUCCEEDED");
  assert.equal(stage("COORDINATOR_NOOP_FINALIZATION")?.status, "SUCCEEDED");
  assert.equal(stage("STORE_SAVE_FLOOR")?.status, "NOT_APPLICABLE");
  assert.equal(stage("STORE_SAVE_FLOOR")?.duration_ms, null);
  assert.equal(stage("COORDINATOR_READBACK"), undefined);
  assert.equal(stages.some(item => item.stage === "HOST_SAVE_AWAIT"), false);
  assert.equal(readContexts.length, 0);
});

test("performance diagnostics are fail-open and never block a Floor commit", async () => {
  const state = fixture({initial: {floor_version: version()}});
  const coordinator = createFloorPersistenceCoordinator({
    store: state.store,
    performanceStage: () => { throw new Error("DIAGNOSTICS_BROKE"); },
  });
  const result = await coordinator.commitFloorPatch({
    owner: "world", chatId: "chat-a", ownerFloor: {message_index: 0}, floorVersion: version(),
    traceContext: {performance_operation_id: "op-fail-open", persistence_kind: "TIMING_INSTANCE"},
    patch: {world_model: {source: "diagnostic-failure"}},
  });
  assert.equal(result.ok, true);
  assert.equal(state.saves(), 1);
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

test("new Event snapshots omit derived day_index while retaining legacy fields", async () => {
  const legacyEvent = {
    event_id: "legacy-event",
    story_time: {
      display: "2026-01-01",
      normalized: "2026-01-01",
      day_index: 20454,
      calendar_id: "main",
      precision: "day",
      confidence: 1,
    },
  };
  const state = fixture({initial: {
    floor_version: version(),
    events: [legacyEvent],
  }});
  const coordinator = createFloorPersistenceCoordinator({store: state.store});
  await coordinator.commitFloorPatch({
    owner: "event", chatId: "chat-a", ownerFloor: {message_index: 0},
    floorVersion: version(),
    patch: {
      events: [
        legacyEvent,
        {
          event_id: "new-event",
          story_time: {
            display: "2026-04-01",
            normalized: "2026-04-01",
            day_index: 20544,
            calendar_id: "main",
            precision: "day",
            confidence: 1,
          },
        },
        {
          event_id: "new-era-event",
          story_time: {
            display: "羲和元年三月四日",
            normalized: null,
            day_index: null,
            calendar_id: null,
            precision: "day",
            confidence: null,
          },
        },
        {
          event_id: "new-custom-event",
          story_time: {
            display: "custom day",
            normalized: "custom-1-1-1",
            day_index: 77,
            calendar_id: "custom-story",
            precision: "day",
            confidence: null,
          },
        },
      ],
    },
  });
  const saved = state.read().events;
  assert.equal(saved[0].story_time.day_index, 20454);
  assert.equal(Object.hasOwn(saved[1].story_time, "day_index"), false);
  assert.equal(Object.hasOwn(saved[2].story_time, "day_index"), false);
  assert.equal(Object.hasOwn(saved[3].story_time, "day_index"), false);
});

test("legacy day-index-only Events survive a read and resave", async () => {
  const legacyEvent = {
    event_id: "legacy-day-only",
    story_time: {display: null, normalized: null, day_index: 20454, calendar_id: null, precision: "day"},
  };
  const state = fixture({initial: {
    floor_version: version(),
    events: [legacyEvent],
  }});
  const coordinator = createFloorPersistenceCoordinator({store: state.store});
  const readBack = state.read().events;
  await coordinator.commitFloorPatch({
    owner: "event", chatId: "chat-a", ownerFloor: {message_index: 0},
    floorVersion: version(),
    patch: {events: readBack},
  });
  assert.deepEqual(state.read().events[0].story_time, legacyEvent.story_time);
});

test("legacy Events with an explicit null day_index preserve the property on owner resave", async () => {
  const legacyEvent = {
    event_id: "legacy-null-day-index",
    source: {floor: 1, swipe_id: 0, version: version()},
    story_time: {
      display: "羲和元年三月四日",
      normalized: null,
      day_index: null,
      calendar_id: null,
      precision: "day",
      confidence: null,
    },
  };
  const state = fixture({initial: {
    floor_version: version(),
    events: [legacyEvent],
  }});
  const coordinator = createFloorPersistenceCoordinator({store: state.store});

  await coordinator.commitFloorPatch({
    owner: "event",
    chatId: "chat-a",
    ownerFloor: {message_index: 0},
    floorVersion: version(),
    patch: {events: state.read().events},
  });

  const saved = state.read().events[0];
  assert.equal(Object.hasOwn(saved.story_time, "day_index"), true);
  assert.equal(saved.story_time.day_index, null);
  assert.equal(saved.event_id, legacyEvent.event_id);
  assert.deepEqual(saved.source, legacyEvent.source);
  assert.deepEqual(state.read().floor_version, normalizeFloorOwner(version()));
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
    resolveCurrentFloorVersion: async () => ({...version(), message_id: "newer-message"}),
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
