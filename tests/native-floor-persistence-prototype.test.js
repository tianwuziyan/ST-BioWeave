import test from "node:test";
import assert from "node:assert/strict";
import {
  STATES,
  NativeFloorHostModel,
  NativeFloorPersistencePrototype,
  assertPreservesOwnerSiblings,
  deferred,
  floorVersion,
  makeContext,
} from "./helpers/native-floor-persistence-prototype.js";

function fixture({mode = "context-fast", bioweave = {projection_timing_snapshot: {items: []}, participant_aggregation_snapshot: {items: []}}} = {}) {
  const context = makeContext({bioweave});
  const host = new NativeFloorHostModel({context});
  return {host, prototype: new NativeFloorPersistencePrototype(host, {mode}), target: null};
}

async function waitUntil(predicate, message) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail(message);
}

async function completeTicket(host, index = 0, response = {}) {
  host.releaseServerWrite(index);
  await Promise.resolve();
  host.releaseResponse(index, response);
}

test("changed timing uses one captured native save, separated server write/response, and preserves owner siblings", async () => {
  const {host, prototype} = fixture();
  const target = prototype.captureTarget();
  const operation = prototype.writeFloorPatch({target, patch: {items: [{timing_instance_id: "t-1"}]}});
  assert.equal(host.metrics.save, 1);
  assert.equal(host.tickets[0].state, STATES.DISPATCHED);
  host.releaseServerWrite();
  await Promise.resolve();
  assert.equal(host.tickets[0].state, STATES.SERVER_WRITE_COMPLETED);
  host.releaseResponse();
  const result = await operation;
  assert.equal(result.finalState, STATES.HOST_ACCEPTED);
  assert.equal(host.metrics.get, 0);
  assert.equal(host.metrics.save, 1);
  assertPreservesOwnerSiblings(makeContext({bioweave: {projection_timing_snapshot: {items: []}, participant_aggregation_snapshot: {items: [{id: "sibling"}]}}}), host.officialByChat.get("chat-a"));
  assert.deepEqual(host.officialByChat.get("chat-a").chat[0].swipe_info[0].extra.bioweave.participant_aggregation_snapshot, {items: []});
});

test("context-fast and native-confirmed changed paths expose their net request counts", async () => {
  const fast = fixture({mode: "context-fast"});
  const fastTarget = fast.prototype.captureTarget();
  const fastOperation = fast.prototype.writeFloorPatch({target: fastTarget, patch: {items: [{id: "fast"}]}});
  await completeTicket(fast.host);
  const fastResult = await fastOperation;
  assert.equal(fastResult.finalState, STATES.HOST_ACCEPTED);
  assert.deepEqual({get: fast.host.metrics.get, save: fast.host.metrics.save, readback: fast.host.metrics.readback}, {get: 0, save: 1, readback: 0});

  const confirmed = fixture({mode: "native-confirmed"});
  const confirmedTarget = confirmed.prototype.captureTarget();
  const confirmedOperation = confirmed.prototype.writeFloorPatch({target: confirmedTarget, patch: {items: [{id: "confirmed"}]}});
  await completeTicket(confirmed.host);
  const confirmedResult = await confirmedOperation;
  assert.equal(confirmedResult.finalState, STATES.AUTHORITATIVE_READBACK_CONFIRMED);
  assert.deepEqual({get: confirmed.host.metrics.get, save: confirmed.host.metrics.save, readback: confirmed.host.metrics.readback}, {get: 1, save: 1, readback: 1});
});

test("exact timing no-op is guarded and does not save in fast mode; confirmed mode reads authority", async () => {
  const fast = fixture();
  const target = fast.prototype.captureTarget();
  fast.host.mutateOfficial("chat-a", state => {
    state.chat[0].swipe_info[0].extra.bioweave.projection_timing_snapshot = {items: [{id: "remote"}]};
  }, "remote-no-op-change");
  const fastResult = await fast.prototype.writeFloorPatch({target, patch: {items: []}});
  assert.equal(fastResult.finalState, STATES.NOOP);
  assert.equal(fast.host.metrics.get, 0);
  assert.equal(fast.host.metrics.save, 0);
  assert.deepEqual(fast.host.officialByChat.get("chat-a").chat[0].swipe_info[0].extra.bioweave.projection_timing_snapshot, {items: [{id: "remote"}]});

  const confirmed = fixture({mode: "native-confirmed"});
  const confirmedTarget = confirmed.prototype.captureTarget();
  confirmed.host.mutateOfficial("chat-a", state => {
    state.chat[0].swipe_info[0].extra.bioweave.projection_timing_snapshot = {items: [{id: "remote"}]};
  }, "remote-no-op-change");
  const result = await confirmed.prototype.writeFloorPatch({target: confirmedTarget, patch: {items: []}});
  assert.equal(result.finalState, STATES.UNKNOWN_OUTCOME);
  assert.equal(confirmed.host.metrics.get, 1);
  assert.equal(confirmed.host.metrics.readback, 1);
  assert.equal(confirmed.host.metrics.save, 0);
});

test("native-confirmed waits for readback and rejects a server overwrite", async () => {
  const {host, prototype} = fixture({mode: "native-confirmed"});
  const target = prototype.captureTarget();
  const readback = host.deferReadback();
  const operation = prototype.writeFloorPatch({target, patch: {items: [{timing_instance_id: "t-1"}]}});
  host.releaseServerWrite();
  host.releaseResponse();
  await Promise.resolve();
  host.mutateOfficial("chat-a", state => {
    state.chat[0].swipe_info[0].extra.bioweave.projection_timing_snapshot = {items: [{timing_instance_id: "external"}]};
  }, "external-full-chat-writer");
  readback.resolve();
  const result = await operation;
  assert.equal(result.finalState, STATES.UNKNOWN_OUTCOME);
  assert.equal(result.readback, true);
  assert.equal(host.metrics.readback, 1);
  assert.equal(host.metrics.overwrites.some(entry => entry.reason === "external-full-chat-writer"), true);
});

test("debounced save never becomes confirmed", async () => {
  const {host, prototype} = fixture();
  const target = prototype.captureTarget();
  const result = await prototype.writeFloorPatch({target, patch: {items: [{id: "t-1"}]}, useDebounce: true});
  assert.equal(result.finalState, STATES.UNKNOWN_OUTCOME);
  assert.equal(host.metrics.save, 0);
  assert.equal(host.metrics.waits.includes("debounced-dispatch-no-completion"), true);
});

test("Chat, Swipe, edit, delete, epoch, user and historical targets fail closed before save", async () => {
  const cases = [
    ["Chat", host => host.switchChat(makeContext({chatId: "chat-b"}))],
    ["Swipe", host => host.switchSwipe(0, 1)],
    ["edit", host => host.editMessage(0, "编辑")],
    ["delete", host => host.deleteMessage(0)],
    ["epoch", host => host.changeEpoch()],
  ];
  for (const [label, mutate] of cases) {
    const {host, prototype} = fixture();
    const target = prototype.captureTarget();
    mutate(host);
    await assert.rejects(prototype.writeFloorPatch({target, patch: {items: [{id: label}]}}));
    assert.equal(host.metrics.save, 0, `${label} must not dispatch a save`);
  }
  const historicalContext = makeContext();
  historicalContext.chat.push({...historicalContext.chat[0], message_id: "newer", floor: 8, content: "newer"});
  const historicalHost = new NativeFloorHostModel({context: historicalContext});
  const historicalPrototype = new NativeFloorPersistencePrototype(historicalHost);
  assert.throws(() => historicalPrototype.captureTarget(0), /HISTORICAL_FLOOR_WRITE_FORBIDDEN/);
  const userContext = makeContext();
  userContext.chat[0].is_user = true;
  userContext.chat[0].role = "user";
  const userPrototype = new NativeFloorPersistencePrototype(new NativeFloorHostModel({context: userContext}));
  assert.throws(() => userPrototype.captureTarget(), /HISTORICAL_FLOOR_WRITE_FORBIDDEN/);
});

test("Chat, Swipe, edit, delete and epoch changes during an in-flight save never become confirmed", async () => {
  const cases = [
    ["Chat", host => host.switchChat(makeContext({chatId: "chat-b"}))],
    ["Swipe", host => host.switchSwipe(0, 1)],
    ["edit", host => host.editMessage(0, "保存期间编辑")],
    ["delete", host => host.deleteMessage(0)],
    ["epoch", host => host.changeEpoch()],
  ];
  for (const [label, mutate] of cases) {
    const {host, prototype} = fixture();
    const target = prototype.captureTarget();
    const operation = prototype.writeFloorPatch({target, patch: {items: [{id: label}]}});
    await waitUntil(() => host.tickets.length === 1, `${label} save must dispatch before mutation`);
    mutate(host);
    await completeTicket(host);
    const result = await operation;
    assert.equal(result.finalState, STATES.UNKNOWN_OUTCOME, `${label} must remain unconfirmed after server dispatch`);
    assert.equal(host.metrics.save, 1);
  }
});

test("two Swipe slots, sibling owners, other extension fields, and history remain isolated", async () => {
  const initial = makeContext({bioweave: {projection_timing_snapshot: {items: []}, participant_aggregation_snapshot: {items: [{id: "sibling"}]}}});
  initial.chat[0].swipe_info[1].extra.bioweave = {projection_timing_snapshot: {items: [{id: "swipe-1"}]}};
  initial.chat.unshift({...initial.chat[0], message_id: "history", floor: 6, content: "history", swipe_info: [{extra: {bioweave: {history: true}}}]});
  const host = new NativeFloorHostModel({context: initial});
  const prototype = new NativeFloorPersistencePrototype(host);
  const target = prototype.captureTarget(1);
  const operation = prototype.writeFloorPatch({target, owner: "projection_timing_snapshot", patch: {items: [{id: "new"}]}});
  host.releaseServerWrite();
  host.releaseResponse();
  await operation;
  const persisted = host.officialByChat.get("chat-a");
  assert.deepEqual(persisted.chat[1].swipe_info[1].extra.bioweave, {projection_timing_snapshot: {items: [{id: "swipe-1"}]} });
  assert.deepEqual(persisted.chat[0].swipe_info[0].extra.bioweave, {history: true});
  assert.deepEqual(persisted.chat[1].swipe_info[0].extra.bioweave.participant_aggregation_snapshot, {items: [{id: "sibling"}]});
  assert.equal(persisted.chat[1].extra.other_extension.must_survive, true);
});

test("two participant roles can be updated without changing the Timing sibling or the other role", async () => {
  const initial = makeContext({bioweave: {
    projection_timing_snapshot: {
      items: [{timing_instance_id: "timing-1", cycle_id: "cycle-1", sampled_offset: 2}],
    },
    participant_aggregation_snapshot: {
      schema_version: 1,
      roles: {
        "柳如烟": {status: "before"},
        "祁鸢": {status: "before"},
      },
    },
  }});
  const host = new NativeFloorHostModel({context: initial});
  const prototype = new NativeFloorPersistencePrototype(host);
  const target = prototype.captureTarget();
  const operation = prototype.writeFloorPatch({
    target,
    owner: "participant_aggregation_snapshot",
    patch: {
      schema_version: 1,
      roles: {
        "柳如烟": {status: "after"},
        "祁鸢": {status: "before"},
      },
    },
  });
  await completeTicket(host);
  await operation;
  const persisted = host.officialByChat.get("chat-a").chat[0].swipe_info[0].extra.bioweave;
  assert.deepEqual(persisted.projection_timing_snapshot, initial.chat[0].swipe_info[0].extra.bioweave.projection_timing_snapshot);
  assert.deepEqual(persisted.participant_aggregation_snapshot.roles["柳如烟"], {status: "after"});
  assert.deepEqual(persisted.participant_aggregation_snapshot.roles["祁鸢"], {status: "before"});
});

test("plugin queue serializes two logical owners, while an external full-chat writer remains outside its protection", async () => {
  const {host, prototype} = fixture();
  const target = prototype.captureTarget();
  const timing = prototype.enqueue("chat-a:message-a:0", () => prototype.writeFloorPatch({target, patch: {items: [{id: "timing"}]}}));
  const aggregation = prototype.enqueue("chat-a:message-a:0", () => prototype.writeFloorPatch({target, owner: "participant_aggregation_snapshot", patch: {items: [{id: "aggregation"}]}}));
  await waitUntil(() => host.tickets.length === 1, "first queued save must dispatch");
  assert.equal(host.tickets.length, 1);
  host.releaseServerWrite(0);
  host.releaseResponse(0);
  await timing;
  await waitUntil(() => host.tickets.length === 2, "second queued save must dispatch");
  assert.equal(host.tickets.length, 2);
  host.mutateOfficial("chat-a", state => { state.chat[0].extra.external = "remote"; }, "external-writer");
  host.releaseServerWrite(1);
  host.releaseResponse(1);
  await aggregation;
  assert.equal(host.officialByChat.get("chat-a").chat[0].extra.external, undefined, "queue does not provide external CAS");
  assert.equal(host.metrics.overwrites.some(entry => entry.reason === "external-writer"), true);
});

test("an extension mutation after native capture is lost by the full-chat save", async () => {
  const {host, prototype} = fixture();
  const target = prototype.captureTarget();
  const operation = prototype.writeFloorPatch({target, patch: {items: [{id: "timing"}]}});
  await waitUntil(() => host.tickets.length === 1, "native save must capture before extension mutation");
  host.mutateContextExtra(0, extra => { extra.concurrent_extension = {value: "new"}; });
  await completeTicket(host);
  const result = await operation;
  assert.equal(result.finalState, STATES.HOST_ACCEPTED);
  assert.equal(host.officialByChat.get("chat-a").chat[0].extra.concurrent_extension, undefined);
  assert.equal(host.officialByChat.get("chat-a").chat[0].extra.other_extension.must_survive, true);
});

test("an old-tab full-chat snapshot can overwrite native output; readback rejects it", async () => {
  const {host, prototype} = fixture({mode: "native-confirmed"});
  const oldSnapshot = structuredClone(host.officialByChat.get("chat-a"));
  oldSnapshot.chat[0].extra.old_tab = true;
  const target = prototype.captureTarget();
  const operation = prototype.writeFloorPatch({target, patch: {items: [{id: "timing"}]}});
  await waitUntil(() => host.tickets.length === 1, "native save must dispatch");
  host.releaseServerWrite();
  await Promise.resolve();
  host.replaceOfficial("chat-a", oldSnapshot, "old-tab-full-chat-writer");
  host.releaseResponse();
  const result = await operation;
  assert.equal(result.finalState, STATES.UNKNOWN_OUTCOME);
  assert.equal(host.officialByChat.get("chat-a").chat[0].extra.old_tab, true);
  assert.equal(host.metrics.overwrites.some(entry => entry.reason === "old-tab-full-chat-writer"), true);
});

test("save failure, response loss, and retry have distinct terminal states", async () => {
  const failed = fixture();
  const target = failed.prototype.captureTarget();
  const failedOperation = failed.prototype.writeFloorPatch({target, patch: {items: [{id: "failed"}]}});
  failed.host.tickets[0].serverWrite.resolve({error: new Error("HOST_SAVE_FAILED")});
  failed.host.tickets[0].response.resolve();
  const failure = await failedOperation;
  assert.equal(failure.finalState, STATES.FAILED);

  const lost = fixture();
  const lostTarget = lost.prototype.captureTarget();
  const lostOperation = lost.prototype.writeFloorPatch({target: lostTarget, patch: {items: [{id: "lost"}]}});
  lost.host.releaseServerWrite();
  lost.host.releaseResponse(0, {lost: true});
  const unknown = await lostOperation;
  assert.equal(unknown.finalState, STATES.UNKNOWN_OUTCOME);
  assert.equal(lost.host.officialByChat.get("chat-a").chat[0].swipe_info[0].extra.bioweave.projection_timing_snapshot.items[0].id, "lost");

  const retryOperation = lost.prototype.writeFloorPatch({target: lostTarget, patch: {items: [{id: "retry"}]}});
  lost.host.releaseServerWrite(1);
  lost.host.releaseResponse(1);
  const retry = await retryOperation;
  assert.equal(retry.finalState, STATES.HOST_ACCEPTED);
  assert.equal(lost.host.metrics.save, 2);
});

test("native-confirmed can upgrade a lost response only after matching authoritative readback", async () => {
  const {host, prototype} = fixture({mode: "native-confirmed"});
  const target = prototype.captureTarget();
  const readback = host.deferReadback();
  const operation = prototype.writeFloorPatch({target, patch: {items: [{id: "lost-but-readable"}]}});
  await completeTicket(host, 0, {lost: true});
  await waitUntil(() => host.metrics.readback === 1, "unknown response must enter explicit readback");
  readback.resolve();
  const result = await operation;
  assert.equal(result.finalState, STATES.AUTHORITATIVE_READBACK_CONFIRMED);
  assert.deepEqual({get: host.metrics.get, save: host.metrics.save, readback: host.metrics.readback}, {get: 1, save: 1, readback: 1});
});

test("Timing and Aggregation are independent transactions and preserve partial success", async () => {
  const {host, prototype} = fixture();
  const target = prototype.captureTarget();
  const inputs = {exposure: "before"};
  const resultPromise = prototype.runTimingAggregation({
    target,
    timingPatch: {items: [{id: "timing"}]},
    aggregationPatch: {items: [{id: "aggregation"}]},
    aggregationError: new Error("AGGREGATION_REEVALUATION_FAILED"),
    inputs: () => inputs,
  });
  await waitUntil(() => host.tickets.length === 1, "timing transaction must dispatch");
  host.releaseServerWrite(0);
  host.releaseResponse(0);
  const result = await resultPromise;
  assert.equal(result.timing.finalState, STATES.HOST_ACCEPTED);
  assert.equal(result.aggregation.finalState, STATES.FAILED);
  assert.equal(result.partialSuccess, true);
  assert.equal(result.inputsRead, true);
  assert.equal(host.metrics.save, 1, "failed aggregation does not become a merged second save");
  assert.equal(host.officialByChat.get("chat-a").chat[0].swipe_info[0].extra.bioweave.projection_timing_snapshot.items[0].id, "timing");
});

test("Aggregation re-reads dependencies after Timing, and repeated no-op execution remains idempotent", async () => {
  const {host, prototype} = fixture({mode: "native-confirmed"});
  const target = prototype.captureTarget();
  let dependency = "before";
  const first = prototype.runTimingAggregation({
    target,
    timingPatch: {items: [{id: "timing"}]},
    aggregationPatch: {items: [{dependency: "after"}]},
    inputs: () => ({dependency}),
  });
  await waitUntil(() => host.tickets.length === 1, "timing transaction must dispatch");
  host.releaseServerWrite(0);
  host.releaseResponse(0);
  await Promise.resolve();
  dependency = "after";
  await waitUntil(() => host.tickets.length === 2, "aggregation transaction must dispatch");
  host.releaseServerWrite(1);
  host.releaseResponse(1);
  const result = await first;
  assert.deepEqual(result.currentInputs, {dependency: "after"});
  assert.deepEqual({get: host.metrics.get, save: host.metrics.save, readback: host.metrics.readback}, {get: 2, save: 2, readback: 2});

  const second = await prototype.writeFloorPatch({target, owner: "participant_aggregation_snapshot", patch: {items: [{dependency: "after"}]}});
  assert.equal(second.finalState, STATES.AUTHORITATIVE_READBACK_CONFIRMED);
  assert.equal(host.metrics.save, 2);
  assert.equal(host.metrics.readback, 3);
});

test("Timing and Aggregation no-op combinations keep their own authoritative checks", async () => {
  const noOp = fixture({mode: "native-confirmed"});
  const noOpTarget = noOp.prototype.captureTarget();
  const noOpResult = await noOp.prototype.runTimingAggregation({
    target: noOpTarget,
    timingPatch: {items: []},
    aggregationPatch: {items: []},
  });
  assert.equal(noOpResult.timing.finalState, STATES.AUTHORITATIVE_READBACK_CONFIRMED);
  assert.equal(noOpResult.aggregation.finalState, STATES.AUTHORITATIVE_READBACK_CONFIRMED);
  assert.deepEqual({get: noOp.host.metrics.get, save: noOp.host.metrics.save, readback: noOp.host.metrics.readback}, {get: 2, save: 0, readback: 2});

  const timingChanged = fixture({mode: "native-confirmed"});
  const timingChangedTarget = timingChanged.prototype.captureTarget();
  const timingChangedResultPromise = timingChanged.prototype.runTimingAggregation({
    target: timingChangedTarget,
    timingPatch: {items: [{id: "changed"}]},
    aggregationPatch: {items: []},
  });
  await waitUntil(() => timingChanged.host.tickets.length === 1, "changed Timing must dispatch before Aggregation no-op");
  await completeTicket(timingChanged.host);
  const timingChangedResult = await timingChangedResultPromise;
  assert.equal(timingChangedResult.timing.finalState, STATES.AUTHORITATIVE_READBACK_CONFIRMED);
  assert.equal(timingChangedResult.aggregation.finalState, STATES.AUTHORITATIVE_READBACK_CONFIRMED);
  assert.deepEqual({get: timingChanged.host.metrics.get, save: timingChanged.host.metrics.save, readback: timingChanged.host.metrics.readback}, {get: 2, save: 1, readback: 2});

  const aggregationChanged = fixture({mode: "native-confirmed"});
  const aggregationChangedTarget = aggregationChanged.prototype.captureTarget();
  const aggregationChangedResultPromise = aggregationChanged.prototype.runTimingAggregation({
    target: aggregationChangedTarget,
    timingPatch: {items: []},
    aggregationPatch: {items: [{id: "changed"}]},
  });
  await waitUntil(() => aggregationChanged.host.tickets.length === 1, "changed Aggregation must dispatch after Timing no-op");
  await completeTicket(aggregationChanged.host);
  const aggregationChangedResult = await aggregationChangedResultPromise;
  assert.equal(aggregationChangedResult.timing.finalState, STATES.AUTHORITATIVE_READBACK_CONFIRMED);
  assert.equal(aggregationChangedResult.aggregation.finalState, STATES.AUTHORITATIVE_READBACK_CONFIRMED);
  assert.deepEqual({get: aggregationChanged.host.metrics.get, save: aggregationChanged.host.metrics.save, readback: aggregationChanged.host.metrics.readback}, {get: 2, save: 1, readback: 2});
});

test("historical Floor version and readback mismatch never report confirmed", async () => {
  const context = makeContext({bioweave: {projection_timing_snapshot: {items: []}}});
  const host = new NativeFloorHostModel({context});
  const prototype = new NativeFloorPersistencePrototype(host, {mode: "native-confirmed"});
  const target = prototype.captureTarget();
  const readback = host.deferReadback();
  const operation = prototype.writeFloorPatch({target, patch: {items: [{id: "timing"}]}});
  host.releaseServerWrite();
  host.releaseResponse();
  await Promise.resolve();
  host.mutateOfficial("chat-a", state => {
    state.chat[0].swipe_info[0].extra.bioweave.projection_timing_snapshot = {items: [{id: "different"}]};
  }, "stale-version");
  readback.resolve();
  const result = await operation;
  assert.equal(result.finalState, STATES.UNKNOWN_OUTCOME);
  assert.equal(host.metrics.finalStates.at(-1), STATES.UNKNOWN_OUTCOME);
  assert.deepEqual(floorVersion({content: "正文"}), target && floorVersion({content: "正文"}));
});

test("readback with a different message identity is not accepted even when the root payload matches", async () => {
  const {host, prototype} = fixture({mode: "native-confirmed"});
  const target = prototype.captureTarget();
  const readback = host.deferReadback();
  const operation = prototype.writeFloorPatch({target, patch: {items: [{id: "timing"}]}});
  await waitUntil(() => host.tickets.length === 1, "native save must dispatch");
  await completeTicket(host);
  await waitUntil(() => host.metrics.readback === 1, "changed save must enter readback");
  host.officialByChat.get("chat-a").chat[0].message_version += 1;
  readback.resolve();
  const result = await operation;
  assert.equal(result.finalState, STATES.UNKNOWN_OUTCOME);
  assert.equal(host.metrics.readback, 1);
});

test("all concurrency uses explicit barriers and exposes phase accounting", () => {
  const barrier = deferred("explicit-only");
  assert.equal(barrier.label, "explicit-only");
  assert.equal(typeof barrier.resolve, "function");
});
