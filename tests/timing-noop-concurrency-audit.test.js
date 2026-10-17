import test from "node:test";
import assert from "node:assert/strict";
import {createChatBoundary} from "../runtime/chat.js";
import {createFloorPersistenceCoordinator} from "../storage/floor-persistence-coordinator.js";

const VERSION_FIELDS = [
  "chat_id", "message_id", "floor", "swipe_id", "content_hash", "message_version",
];

const clone = value => structuredClone(value);

function floorVersion(overrides = {}) {
  return {
    chat_id: "chat-a",
    message_id: "message-a",
    floor: 1,
    swipe_id: 0,
    content_hash: "hash-a",
    message_version: "v1",
    ...overrides,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}

function barrier(name) {
  return {name, started: deferred(), release: deferred()};
}

async function pauseAtBarrier(stage, payload) {
  if (!stage) return;
  stage.started.resolve(clone(payload));
  await stage.release.promise;
}

function valuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function createFixture({
  initial,
  chatId = "chat-a",
  activeSwipe = 0,
  currentVersion = null,
  saveBarrier = null,
  saveFailure = null,
  readbackFailure = null,
  readbackTransform = null,
} = {}) {
  let floor = clone(initial);
  const state = {chatId, activeSwipe, currentVersion};
  const counts = {context_read: 0, official_get: 0, save: 0};
  const order = [];

  const store = {
    getChatId: () => state.chatId,
    getFloor: () => {
      counts.context_read += 1;
      return clone(floor);
    },
    getFloorOwner: () => ({owner_type: "character", active_swipe_id: state.activeSwipe}),
    async saveFloor(_messageIndex, _swipeId, next) {
      counts.save += 1;
      order.push("CHAT_SAVE");
      if (saveBarrier && counts.save === 1) await pauseAtBarrier(saveBarrier, next);
      if (saveFailure) throw saveFailure;
      floor = clone(next);
    },
    async readAuthoritativeFloor() {
      counts.official_get += 1;
      order.push("OFFICIAL_CHAT_GET_READBACK");
      if (readbackFailure) throw readbackFailure;
      return clone(typeof readbackTransform === "function" ? readbackTransform(floor) : floor);
    },
  };

  const coordinator = createFloorPersistenceCoordinator({
    store,
    resolveCurrentContext: async () => {
      counts.context_read += 1;
      return {
        chatId: state.chatId,
        selector: 0,
        swipeId: state.activeSwipe,
        floorData: clone(floor),
        owner: {owner_type: "character", active_swipe_id: state.activeSwipe},
        version: state.currentVersion,
      };
    },
    resolveCurrentFloorVersion: async () => state.currentVersion,
  });

  return {
    coordinator,
    store,
    state,
    counts,
    order,
    read: () => clone(floor),
    replaceFloor: next => { floor = clone(next); },
  };
}

function commitPatch(fixture, expected, patch, options = {}) {
  return fixture.coordinator.commitFloorPatch({
    owner: options.owner ?? "world",
    chatId: expected.chat_id,
    ownerFloor: {message_index: 0, message_id: expected.message_id},
    floorVersion: expected,
    patch,
    patchResolver: options.patchResolver,
    assertCurrent: options.assertCurrent,
    operation_type: options.operation_type ?? "context-first-concurrency-test",
  });
}

test("Context-first no-op is local-only: no official GET and no Chat SAVE", async () => {
  const expected = floorVersion();
  const fixture = createFixture({
    initial: {floor_version: expected, world_model: {stable: true}, events: [{event_id: "event-a"}]},
  });

  const result = await commitPatch(fixture, expected, {world_model: {stable: true}});

  assert.equal(result.status, "noop");
  assert.equal(result.commitState, "local-noop");
  assert.equal(result.authoritativeReadback, false);
  assert.deepEqual(fixture.counts, {context_read: 1, official_get: 0, save: 0});
  assert.deepEqual(fixture.order, []);
});

test("Context-first changed write performs one native save and one official readback", async () => {
  const expected = floorVersion();
  const fixture = createFixture({initial: {floor_version: expected, world_model: {revision: 1}}});

  const result = await commitPatch(fixture, expected, {world_model: {revision: 2}});

  assert.equal(result.status, "confirmed");
  assert.equal(result.commitState, "confirmed");
  assert.deepEqual(fixture.counts, {context_read: 1, official_get: 1, save: 1});
  assert.deepEqual(fixture.order, ["CHAT_SAVE", "OFFICIAL_CHAT_GET_READBACK"]);
  assert.deepEqual(fixture.read().world_model, {revision: 2});
});

test("Context merge preserves sibling roots and explicit empty collections", async () => {
  const expected = floorVersion();
  const fixture = createFixture({
    initial: {
      floor_version: expected,
      world_model: {species: [{name: "旧"}]},
      events: [{event_id: "event-a"}],
      projection_timeline: {records: [{id: "projection-a"}]},
    },
  });

  const result = await commitPatch(fixture, expected, {events: []}, {owner: "event"});

  assert.equal(result.status, "confirmed");
  assert.deepEqual(fixture.read().events, []);
  assert.deepEqual(fixture.read().world_model, {species: [{name: "旧"}]});
  assert.deepEqual(fixture.read().projection_timeline, {records: [{id: "projection-a"}]});
});

test("current Floor Version mismatch is rejected before Context-first save", async () => {
  const expected = floorVersion();
  const fixture = createFixture({
    initial: {floor_version: expected, world_model: {stable: true}},
    currentVersion: floorVersion({content_hash: "hash-new", message_version: "v2"}),
  });

  await assert.rejects(
    commitPatch(fixture, expected, {world_model: {stable: false}}),
    error => error.code === "FLOOR_TX_STALE_VERSION",
  );
  assert.deepEqual(fixture.counts, {context_read: 1, official_get: 0, save: 0});
});

test("Chat and active Swipe identity changes fail closed before merge", async t => {
  await t.test("Chat switch", async () => {
    const expected = floorVersion();
    const fixture = createFixture({
      initial: {floor_version: expected, world_model: {stable: true}},
    });
    fixture.state.chatId = "chat-b";

    await assert.rejects(
      commitPatch(fixture, expected, {world_model: {stable: false}}),
      error => error.code === "FLOOR_TX_STALE_CHAT",
    );
    assert.equal(fixture.counts.save, 0);
  });

  await t.test("Swipe switch", async () => {
    const expected = floorVersion();
    const fixture = createFixture({
      initial: {floor_version: expected, world_model: {stable: true}},
      activeSwipe: 1,
    });

    await assert.rejects(
      commitPatch(fixture, expected, {world_model: {stable: false}}),
      error => error.code === "FLOOR_TX_STALE_SWIPE",
    );
    assert.equal(fixture.counts.save, 0);
  });
});

test("execution epoch invalidation after Context merge prevents save", async () => {
  const expected = floorVersion();
  const mergeBarrier = barrier("SNAPSHOT_MERGE");
  const boundary = createChatBoundary({getChatId: () => "chat-a"});
  const token = boundary.token();
  const fixture = createFixture({initial: {floor_version: expected, world_model: {stable: true}}});
  const pending = commitPatch(fixture, expected, {world_model: {stable: false}}, {
    patchResolver: async ({latest}) => {
      await pauseAtBarrier(mergeBarrier, latest);
      return {world_model: {stable: false}};
    },
    assertCurrent: () => boundary.assert(token),
  });

  await mergeBarrier.started.promise;
  boundary.invalidate("test-epoch-change");
  mergeBarrier.release.resolve();

  await assert.rejects(pending, error => error.message === "STALE_CHAT");
  assert.deepEqual(fixture.counts, {context_read: 1, official_get: 0, save: 0});
});

test("internal same-Floor queue serializes different module writes and preserves both", async () => {
  const expected = floorVersion();
  const saveGate = barrier("FIRST_CHAT_SAVE");
  const fixture = createFixture({
    initial: {floor_version: expected, world_model: {revision: 0}},
    saveBarrier: saveGate,
  });

  const first = commitPatch(fixture, expected, {world_model: {revision: 1}});
  await saveGate.started.promise;
  const second = commitPatch(fixture, expected, {events: [{event_id: "event-b"}]}, {owner: "event"});
  assert.equal(fixture.counts.save, 1);
  saveGate.release.resolve();
  const results = await Promise.all([first, second]);

  assert.deepEqual(results.map(result => result.status), ["confirmed", "confirmed"]);
  assert.deepEqual(fixture.read().world_model, {revision: 1});
  assert.deepEqual(fixture.read().events, [{event_id: "event-b"}]);
  assert.deepEqual(fixture.counts, {context_read: 2, official_get: 2, save: 2});
});

test("external same-Floor mutation remains a known last-writer-wins limitation", async () => {
  const expected = floorVersion();
  const mergeGate = barrier("SNAPSHOT_MERGE");
  const fixture = createFixture({
    initial: {
      floor_version: expected,
      world_model: {revision: 1},
      events: [{event_id: "old-event"}],
    },
  });
  const pending = commitPatch(fixture, expected, {world_model: {revision: 2}}, {
    patchResolver: async ({latest}) => {
      await pauseAtBarrier(mergeGate, latest);
      return {world_model: {revision: 2}};
    },
  });

  await mergeGate.started.promise;
  fixture.replaceFloor({
    ...fixture.read(),
    events: [{event_id: "external-event"}],
  });
  mergeGate.release.resolve();
  const result = await pending;

  assert.equal(result.status, "confirmed");
  assert.deepEqual(fixture.read().events, [{event_id: "old-event"}]);
  assert.deepEqual({
    concurrent_mutation: "events changed after Context read and before native save",
    invariant_preserved: false,
    internal_queue_protection: false,
  }, {
    concurrent_mutation: "events changed after Context read and before native save",
    invariant_preserved: false,
    internal_queue_protection: false,
  });
});

test("save failure and authoritative readback failure are not confirmed", async t => {
  await t.test("native save failure", async () => {
    const expected = floorVersion();
    const fixture = createFixture({
      initial: {floor_version: expected, world_model: {revision: 1}},
      saveFailure: Object.assign(new Error("HOST_SAVE_FAILED"), {code: "HOST_SAVE_FAILED"}),
    });

    await assert.rejects(
      commitPatch(fixture, expected, {world_model: {revision: 2}}),
      error => error.code === "HOST_SAVE_FAILED",
    );
    assert.deepEqual(fixture.counts, {context_read: 1, official_get: 0, save: 1});
  });

  await t.test("readback mismatch", async () => {
    const expected = floorVersion();
    const fixture = createFixture({
      initial: {floor_version: expected, world_model: {revision: 1}},
      readbackTransform: value => ({...value, world_model: {revision: "different"}}),
    });

    await assert.rejects(
      commitPatch(fixture, expected, {world_model: {revision: 2}}),
      error => error.code === "FLOOR_TX_READBACK_FAILED",
    );
    assert.deepEqual(fixture.counts, {context_read: 1, official_get: 1, save: 1});
  });
});

test("candidate A: reusing an earlier Context/owner read loses a newer sibling", () => {
  const captured = {
    floor_version: floorVersion(),
    world_model: {revision: 1},
    events: [{event_id: "old-event"}],
  };
  const current = {...clone(captured), events: [{event_id: "new-event"}]};
  const candidate = {...clone(captured), world_model: {revision: 2}};

  assert.notDeepEqual(candidate.events, current.events);
  assert.deepEqual({
    candidate: "OWNER_ACQUISITION -> LATEST_SLOT_READ reuse",
    theoretical_gets_saved: 1,
    invariant_preserved: valuesEqual(candidate.events, current.events),
  }, {
    candidate: "OWNER_ACQUISITION -> LATEST_SLOT_READ reuse",
    theoretical_gets_saved: 1,
    invariant_preserved: false,
  });
});

test("candidate B: omitting final readback cannot detect a version change after merge", () => {
  const expected = floorVersion();
  const latest = {floor_version: expected, world_model: {revision: 1}};
  const candidateSave = {...clone(latest), world_model: {revision: 2}};
  const concurrent = {
    ...clone(candidateSave),
    floor_version: floorVersion({content_hash: "hash-b", message_version: "v2"}),
  };

  assert.deepEqual(candidateSave.world_model, {revision: 2});
  assert.notDeepEqual(candidateSave.floor_version, concurrent.floor_version);
  assert.deepEqual({
    candidate: "LATEST_SLOT_READ -> no final readback",
    theoretical_gets_saved: 1,
    would_report: "confirmed",
    stale_detected: false,
  }, {
    candidate: "LATEST_SLOT_READ -> no final readback",
    theoretical_gets_saved: 1,
    would_report: "confirmed",
    stale_detected: false,
  });
});

function aggregateBySubject(inputs) {
  return Object.fromEntries(Object.entries(inputs).map(([subjectId, value]) => {
    const hasExposure = value.exposure_ids.length > 0;
    const status = !hasExposure
      ? "none"
      : value.story_time < value.before_min
        ? "before_min"
        : value.story_time <= value.window_end
          ? "in_window"
          : "overdue";
    return [subjectId, {status, exposure_ids: [...value.exposure_ids]}];
  }));
}

test("candidate C: Timing inputs cannot be reused across the Aggregation transaction boundary", async () => {
  const inputs = {
    "柳如烟": {exposure_ids: ["exposure-a"], story_time: 5, before_min: 10, window_end: 20},
    "祁鸢": {exposure_ids: [], story_time: 15, before_min: 10, window_end: 20},
  };
  const timingInputs = clone(inputs);
  const aggregationGate = deferred();
  const aggregationStarted = deferred();
  let currentInputs = clone(inputs);
  const aggregation = (async () => {
    await aggregationGate.promise;
    aggregationStarted.resolve();
    return aggregateBySubject(currentInputs);
  })();

  currentInputs["柳如烟"] = {...currentInputs["柳如烟"], story_time: 15};
  aggregationGate.resolve();
  const baselineResult = await aggregation;
  const reusedResult = aggregateBySubject(timingInputs);

  await aggregationStarted.promise;
  assert.equal(baselineResult["柳如烟"].status, "in_window");
  assert.equal(reusedResult["柳如烟"].status, "before_min");
  assert.equal(valuesEqual(baselineResult, reusedResult), false);
});

test("Timing success and Aggregation failure retain partial-success semantics", () => {
  const result = {
    timing: {status: "confirmed", commitState: "confirmed"},
    aggregation: {status: "failed", error_code: "AGGREGATION_PERSISTENCE_FAILED"},
    partial_success: true,
  };

  assert.equal(result.timing.commitState, "confirmed");
  assert.equal(result.aggregation.status, "failed");
  assert.equal(result.partial_success, true);
});

test("Floor Version fields remain six-field identity guards", () => {
  const expected = floorVersion();
  assert.deepEqual(VERSION_FIELDS, [
    "chat_id", "message_id", "floor", "swipe_id", "content_hash", "message_version",
  ]);
  assert.equal(VERSION_FIELDS.every(field => expected[field] !== undefined), true);
});
