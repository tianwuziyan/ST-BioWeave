import test from "node:test";
import assert from "node:assert/strict";

/*
 * This file is an isolated behavior model for the native SillyTavern host
 * path. It deliberately does not change or import the production persistence
 * implementation. The tests record what a proposed Context/message mutation
 * would need to guarantee; they are not real-host proof.
 */

const clone = value => value === undefined ? undefined : structuredClone(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {promise, resolve, reject};
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail(message);
}

function floor({chatId = "chat-a", messageId = "message-a", floor = 7, swipeId = 0, contentHash = "hash:正文", messageVersion = 1} = {}) {
  return {
    chat_id: chatId,
    message_id: messageId,
    floor,
    swipe_id: swipeId,
    content_hash: contentHash,
    message_version: messageVersion,
  };
}

function message({messageId = "message-a", floorVersion = floor(), content = "正文", swipeId = 0, bioweave = null} = {}) {
  const slot = {extra: {bioweave: clone(bioweave)}};
  return {
    message_id: messageId,
    role: "assistant",
    floor: floorVersion.floor,
    content,
    message_version: floorVersion.message_version,
    swipe_id: swipeId,
    swipes: [content],
    swipe_info: [slot],
    extra: {
      bioweave: clone(bioweave),
      other_extension: {must_survive: true},
    },
  };
}

function context({chatId = "chat-a", epoch = 1, floorVersion = floor({chatId}), bioweave = null, historical = false} = {}) {
  const target = message({
    messageId: floorVersion.message_id,
    floorVersion,
    bioweave,
  });
  const chat = historical
    ? [target, {message_id: "newer-message", role: "assistant", floor: floorVersion.floor + 1, content: "新楼", message_version: 1}]
    : [target];
  return {chatId, epoch, chat, chatMetadata: {chat_id: chatId}};
}

function targetFrom(host, index = 0) {
  const current = host.context.chat[index];
  return {
    index,
    chatId: host.context.chatId,
    epoch: host.context.epoch,
    messageId: current.message_id,
    floor: current.floor,
    swipeId: current.swipe_id,
    contentHash: `hash:${current.content}`,
    messageVersion: current.message_version,
  };
}

function targetFromFloor(host, index = 0, {contentHash = null} = {}) {
  const current = host.context.chat[index];
  const version = current.swipe_info?.[current.swipe_id]?.extra?.bioweave?.floor_version;
  return {
    index,
    chatId: host.context.chatId,
    epoch: host.context.epoch,
    messageId: version?.message_id ?? current.message_id,
    floor: version?.floor ?? current.floor,
    swipeId: version?.swipe_id ?? current.swipe_id,
    contentHash: contentHash ?? version?.content_hash ?? `hash:${current.content}`,
    messageVersion: version?.message_version ?? current.message_version,
  };
}

function slotOf(host, target) {
  return host.context.chat[target.index]?.swipe_info?.[target.swipeId]?.extra?.bioweave ?? null;
}

function mergeOwnFloor(current, patch, expected) {
  const next = clone(current ?? {});
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === undefined) delete next[key];
    else next[key] = clone(value);
  }
  next.floor_version = clone(expected.floorVersion ?? next.floor_version);
  return next;
}

function contextVersion(host, target) {
  const current = host.context.chat[target.index];
  return {
    chatId: host.context.chatId,
    epoch: host.context.epoch,
    messageId: current?.message_id,
    floor: current?.floor,
    swipeId: current?.swipe_id,
    contentHash: `hash:${current?.content}`,
    messageVersion: current?.message_version,
  };
}

function assertCurrentTarget(host, target, {allowHistorical = false} = {}) {
  const current = contextVersion(host, target);
  if (String(current.chatId) !== String(target.chatId)) throw new Error("STALE_CHAT");
  if (current.epoch !== target.epoch) throw new Error("STALE_EPOCH");
  if (String(current.messageId) !== String(target.messageId)) throw new Error("MESSAGE_OWNER_CHANGED");
  if (Number(current.floor) !== Number(target.floor)) throw new Error("FLOOR_CHANGED");
  if (Number(current.swipeId) !== Number(target.swipeId)) throw new Error("STALE_SWIPE");
  if (String(current.contentHash) !== String(target.contentHash)
      || Number(current.messageVersion) !== Number(target.messageVersion)) {
    throw new Error("FLOOR_VERSION_STALE");
  }
  if (!allowHistorical && target.index !== host.latestCharacterIndex()) {
    throw new Error("HISTORICAL_FLOOR_WRITE_FORBIDDEN");
  }
}

class NativeHostModel {
  constructor({context: initialContext = context(), official = null, saveMode = "deferred"} = {}) {
    this.context = initialContext;
    this.official = new Map([[this.context.chatId, clone(official ?? this.context)]]);
    this.saveMode = saveMode;
    this.pending = [];
    this.getCount = 0;
    this.saveCount = 0;
    this.debouncedCount = 0;
  }

  latestCharacterIndex() {
    for (let index = this.context.chat.length - 1; index >= 0; index -= 1) {
      if (this.context.chat[index]?.role !== "system") return index;
    }
    return -1;
  }

  readOfficial(chatId = this.context.chatId) {
    this.getCount += 1;
    return clone(this.official.get(chatId));
  }

  mutateOfficial(chatId, mutate) {
    const next = clone(this.official.get(chatId));
    mutate(next);
    this.official.set(chatId, next);
  }

  commit(ticket) {
    this.official.set(ticket.chatId, clone(ticket.snapshot));
  }

  saveChat() {
    this.saveCount += 1;
    if (this.saveMode === "failure") return Promise.reject(new Error("HOST_SAVE_FAILED"));
    const ticket = {
      chatId: this.context.chatId,
      snapshot: clone(this.context),
      barrier: deferred(),
    };
    this.pending.push(ticket);
    if (this.saveMode === "immediate-confirmed") {
      this.commit(ticket);
      return Promise.resolve({commitState: "confirmed", status: "confirmed"});
    }
    if (this.saveMode === "unknown") return Promise.resolve(undefined);
    return ticket.barrier.promise.then(result => {
      if (result?.error) throw result.error;
      if (result?.commit !== false) this.commit(ticket);
      return result?.response ?? {commitState: "confirmed", status: "confirmed"};
    });
  }

  saveChatDebounced() {
    this.debouncedCount += 1;
    return undefined;
  }

  completeSave(index = 0, {commit = true, response = {commitState: "confirmed", status: "confirmed"}, error = null} = {}) {
    const ticket = this.pending[index];
    assert.ok(ticket, `pending native save ${index} exists`);
    ticket.barrier.resolve({commit, response, error});
  }

  switchChat(nextContext) {
    this.context = nextContext;
  }

  switchSwipe(index, swipeId) {
    this.context.chat[index].swipe_id = swipeId;
  }

  editMessage(index, content) {
    this.context.chat[index].content = content;
    this.context.chat[index].message_version += 1;
  }

  changeEpoch() {
    this.context.epoch += 1;
  }
}

async function nativeContextWrite(host, {target, patch, allowHistorical = false, useDebounce = false} = {}) {
  assertCurrentTarget(host, target, {allowHistorical});
  const current = slotOf(host, target);
  const expected = {
    ...target,
    floorVersion: current?.floor_version ?? floor({
      chatId: target.chatId,
      messageId: target.messageId,
      floor: target.floor,
      swipeId: target.swipeId,
      contentHash: target.contentHash,
      messageVersion: target.messageVersion,
    }),
  };
  const next = mergeOwnFloor(current, patch, expected);
  if (same(current, next)) {
    return {status: "noop", commitState: "confirmed", saveCount: 0, authoritativeReadback: false};
  }
  const targetMessage = host.context.chat[target.index];
  targetMessage.swipe_info[target.swipeId].extra.bioweave = clone(next);
  targetMessage.extra.other_extension = {must_survive: true};
  if (useDebounce) {
    host.saveChatDebounced();
    return {status: "unknown", commitState: "unknown", saveCount: 0, authoritativeReadback: false};
  }
  const response = await host.saveChat();
  assertCurrentTarget(host, target, {allowHistorical});
  if (response?.commitState !== "confirmed") {
    return {status: "unknown", commitState: "unknown", saveCount: 1, authoritativeReadback: false};
  }
  return {status: "confirmed", commitState: "confirmed", saveCount: 1, authoritativeReadback: false};
}

function queueNativeWrites(host) {
  let tail = Promise.resolve();
  return input => {
    const run = tail.catch(() => null).then(() => nativeContextWrite(host, input));
    tail = run.catch(() => null);
    return run;
  };
}

function applyPatchToAuthoritativeFloor(current, patch) {
  return {...clone(current), ...clone(patch)};
}

async function ownerLatestBaseline(state, {pauseAfterOwner = null, mutateAfterOwner = null, mutateAfterLatest = null} = {}) {
  const owner = state.read();
  if (pauseAfterOwner) await pauseAfterOwner.promise;
  mutateAfterOwner?.(state);
  const latest = state.read();
  mutateAfterLatest?.(state);
  state.save(applyPatchToAuthoritativeFloor(latest, state.patch));
  const readback = state.read();
  return {floor: readback, reads: state.reads, saves: state.saves};
}

async function ownerLatestReuseCandidate(state, {pauseAfterOwner = null} = {}) {
  const owner = state.read();
  if (pauseAfterOwner) await pauseAfterOwner.promise;
  state.save(applyPatchToAuthoritativeFloor(owner, state.patch));
  const readback = state.read();
  return {floor: readback, reads: state.reads, saves: state.saves};
}

async function latestReadbackBaseline(state, {pauseAfterLatest = null} = {}) {
  const latest = state.read();
  if (pauseAfterLatest) await pauseAfterLatest.promise;
  const readback = state.read();
  if (readback.floor_version !== state.expectedVersion) throw new Error("FLOOR_TX_READBACK_FAILED");
  return {status: "noop", floor: readback, reads: state.reads, saves: state.saves};
}

async function latestReadbackReuseCandidate(state, {pauseAfterLatest = null} = {}) {
  const latest = state.read();
  if (pauseAfterLatest) await pauseAfterLatest.promise;
  if (latest.floor_version !== state.expectedVersion) throw new Error("FLOOR_TX_READBACK_FAILED");
  return {status: "noop", floor: latest, reads: state.reads, saves: state.saves};
}

function authoritativeState(initialFloor, patch) {
  return {
    current: clone(initialFloor),
    patch: clone(patch),
    expectedVersion: initialFloor.floor_version,
    reads: 0,
    saves: 0,
    read() {
      this.reads += 1;
      return clone(this.current);
    },
    save(next) {
      this.saves += 1;
      this.current = clone(next);
    },
  };
}

function nativeBatch(host, {target, timingPatch, aggregationPatch, aggregationFails = false} = {}) {
  assertCurrentTarget(host, target);
  const current = slotOf(host, target);
  const next = mergeOwnFloor(current, timingPatch, {floorVersion: current.floor_version, ...target});
  if (aggregationFails) throw new Error("AGGREGATION_REEVALUATION_FAILED");
  next.participant_aggregation_snapshot = clone(aggregationPatch);
  host.context.chat[target.index].swipe_info[target.swipeId].extra.bioweave = next;
  return host.saveChat();
}

test("native Context write model: changed Floor preserves unrelated extra fields and uses one native save", async () => {
  const initialFloor = {floor_version: floor(), projection_timing_snapshot: {items: [{timing_instance_id: "t-1", base_min_story_days: 2}]}};
  const host = new NativeHostModel({
    context: context({bioweave: initialFloor}),
    saveMode: "immediate-confirmed",
  });
  const target = targetFromFloor(host);
  const result = await nativeContextWrite(host, {
    target,
    patch: {projection_timing_snapshot: {items: [{timing_instance_id: "t-1", base_min_story_days: 3}]}},
  });

  assert.equal(result.status, "confirmed");
  assert.equal(host.getCount, 0, "Context path performs no official Chat GET in the model");
  assert.equal(host.saveCount, 1);
  assert.equal(host.official.get("chat-a").chat[0].extra.other_extension.must_survive, true);
  assert.equal(host.official.get("chat-a").chat[0].swipe_info[0].extra.bioweave.projection_timing_snapshot.items[0].base_min_story_days, 3);
});

test("native Context write model: exact no-op does not save, but only after current target guards", async () => {
  const snapshot = {floor_version: floor(), projection_timing_snapshot: {items: [{timing_instance_id: "t-1", base_min_story_days: 2}]}};
  const host = new NativeHostModel({context: context({bioweave: snapshot}), saveMode: "immediate-confirmed"});
  const target = targetFromFloor(host);
  const result = await nativeContextWrite(host, {
    target,
    patch: {projection_timing_snapshot: clone(snapshot.projection_timing_snapshot)},
  });

  assert.equal(result.status, "noop");
  assert.equal(host.getCount, 0);
  assert.equal(host.saveCount, 0);
});

test("native Context write model: saveChatDebounced is not a persistence confirmation", async () => {
  const snapshot = {floor_version: floor(), projection_timing_snapshot: {items: []}};
  const host = new NativeHostModel({context: context({bioweave: snapshot}), saveMode: "unknown"});
  const target = targetFromFloor(host);
  const result = await nativeContextWrite(host, {
    target,
    patch: {projection_timing_snapshot: {items: [{timing_instance_id: "t-1"}]}},
    useDebounce: true,
  });

  assert.equal(result.commitState, "unknown");
  assert.equal(result.status, "unknown");
  assert.equal(host.debouncedCount, 1);
  assert.equal(host.saveCount, 0);
});

test("native Context write model: deferred save cannot report success after Chat switch", async () => {
  const snapshot = {floor_version: floor(), projection_timing_snapshot: {items: []}};
  const host = new NativeHostModel({context: context({bioweave: snapshot}), saveMode: "deferred"});
  const target = targetFromFloor(host);
  const operation = nativeContextWrite(host, {
    target,
    patch: {projection_timing_snapshot: {items: [{timing_instance_id: "t-1"}]}},
  });
  assert.equal(host.pending.length, 1);
  host.switchChat(context({chatId: "chat-b", floorVersion: floor({chatId: "chat-b", messageId: "message-b", contentHash: "hash-b"})}));
  host.completeSave(0);
  await assert.rejects(operation, /STALE_CHAT/);
  assert.equal(host.official.get("chat-a").chat[0].swipe_info[0].extra.bioweave.projection_timing_snapshot.items[0].timing_instance_id, "t-1");
});

test("native Context write model: deferred save rejects Swipe, message, and epoch changes at the post-save guard", async () => {
  for (const change of [
    host => host.switchSwipe(0, 1),
    host => host.editMessage(0, "编辑后的正文"),
    host => host.changeEpoch(),
  ]) {
    const snapshot = {floor_version: floor(), projection_timing_snapshot: {items: []}};
    const host = new NativeHostModel({context: context({bioweave: snapshot}), saveMode: "deferred"});
    const target = targetFromFloor(host);
    const operation = nativeContextWrite(host, {
      target,
      patch: {projection_timing_snapshot: {items: [{timing_instance_id: "t-1"}]}},
    });
    change(host);
    host.completeSave(0);
    await assert.rejects(operation, error => ["STALE_SWIPE", "FLOOR_VERSION_STALE", "STALE_EPOCH"].includes(error.message));
  }
});

test("native Context write model: page refresh before deferred save settles is stale, even with the same Chat ID", async () => {
  const snapshot = {floor_version: floor(), projection_timing_snapshot: {items: []}};
  const host = new NativeHostModel({context: context({bioweave: snapshot}), saveMode: "deferred"});
  const target = targetFromFloor(host);
  const operation = nativeContextWrite(host, {
    target,
    patch: {projection_timing_snapshot: {items: [{timing_instance_id: "t-1"}]}},
  });
  host.changeEpoch();
  host.context = context({bioweave: snapshot, epoch: 2});
  host.completeSave(0);
  await assert.rejects(operation, /STALE_EPOCH/);
});

test("native Context write model: historical Floor mutation is rejected before native save", async () => {
  const snapshot = {floor_version: floor(), projection_timing_snapshot: {items: []}};
  const host = new NativeHostModel({context: context({bioweave: snapshot, historical: true}), saveMode: "immediate-confirmed"});
  const target = targetFromFloor(host);
  await assert.rejects(
    nativeContextWrite(host, {target, patch: {projection_timing_snapshot: {items: [{timing_instance_id: "t-1"}]}}}),
    /HISTORICAL_FLOOR_WRITE_FORBIDDEN/,
  );
  assert.equal(host.saveCount, 0);
});

test("native Context write model: independent writes require a queue; out-of-order native completion loses a sibling", async () => {
  const snapshot = {floor_version: floor(), projection_timing_snapshot: {items: []}, participant_aggregation_snapshot: {items: []}};
  const host = new NativeHostModel({context: context({bioweave: snapshot}), saveMode: "deferred"});
  const target = targetFromFloor(host);
  const timing = nativeContextWrite(host, {target, patch: {projection_timing_snapshot: {items: [{timing_instance_id: "t-1"}]}}});
  const aggregation = nativeContextWrite(host, {target, patch: {participant_aggregation_snapshot: {items: [{aggregation_id: "a-1"}]}}});
  assert.equal(host.pending.length, 2);
  host.completeSave(1);
  host.completeSave(0);
  await Promise.all([timing, aggregation]);
  const persisted = host.official.get("chat-a").chat[0].swipe_info[0].extra.bioweave;
  assert.equal(persisted.projection_timing_snapshot.items[0].timing_instance_id, "t-1");
  assert.deepEqual(persisted.participant_aggregation_snapshot, {items: []}, "the older completion overwrote the sibling");
});

test("native full-Chat save can overwrite an external extension change made after dispatch", async () => {
  const snapshot = {floor_version: floor(), projection_timing_snapshot: {items: []}};
  const host = new NativeHostModel({context: context({bioweave: snapshot}), saveMode: "deferred"});
  const target = targetFromFloor(host);
  const operation = nativeContextWrite(host, {
    target,
    patch: {projection_timing_snapshot: {items: [{timing_instance_id: "t-1"}]}},
  });
  host.mutateOfficial("chat-a", state => {
    state.chat[0].extra.other_extension = {remote_revision: 2};
  });
  host.completeSave(0);
  await operation;
  assert.deepEqual(host.official.get("chat-a").chat[0].extra.other_extension, {must_survive: true});
});

test("native Context queue serializes plugin writes but does not itself provide external CAS", async () => {
  const snapshot = {floor_version: floor(), projection_timing_snapshot: {items: []}, participant_aggregation_snapshot: {items: []}};
  const host = new NativeHostModel({context: context({bioweave: snapshot}), saveMode: "deferred"});
  const target = targetFromFloor(host);
  const queued = queueNativeWrites(host);
  const timing = queued({target, patch: {projection_timing_snapshot: {items: [{timing_instance_id: "t-1"}]}}});
  const aggregation = queued({target, patch: {participant_aggregation_snapshot: {items: [{aggregation_id: "a-1"}]}}});
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(host.pending.length, 1);
  host.completeSave(0);
  await timing;
  await waitFor(() => host.pending.length === 2, "queued aggregation save must start after timing settles");
  assert.equal(host.pending.length, 2);
  host.completeSave(1);
  await aggregation;
  const persisted = host.official.get("chat-a").chat[0].swipe_info[0].extra.bioweave;
  assert.equal(persisted.projection_timing_snapshot.items[0].timing_instance_id, "t-1");
  assert.equal(persisted.participant_aggregation_snapshot.items[0].aggregation_id, "a-1");

  const external = clone(host.official.get("chat-a"));
  external.chat[0].swipe_info[0].extra.bioweave.external_snapshot = {revision: 2};
  host.official.set("chat-a", external);
  assert.equal(host.official.get("chat-a").chat[0].swipe_info[0].extra.bioweave.external_snapshot.revision, 2);
  assert.equal(host.context.chat[0].swipe_info[0].extra.bioweave.external_snapshot, undefined);
});

test("candidate A: reusing Owner Acquisition as Latest Slot Read loses a same-Floor sibling mutation", async () => {
  const initial = {
    floor_version: "v1",
    projection_timing_snapshot: {items: []},
    participant_aggregation_snapshot: {items: []},
  };
  const pause = deferred();
  const candidateState = authoritativeState(initial, {projection_timing_snapshot: {items: [{timing_instance_id: "t-1"}]}});
  const candidate = ownerLatestReuseCandidate(candidateState, {pauseAfterOwner: pause});
  candidateState.current.participant_aggregation_snapshot = {items: [{aggregation_id: "external-a"}]};
  pause.resolve();
  const candidateResult = await candidate;

  const baselineState = authoritativeState(initial, {projection_timing_snapshot: {items: [{timing_instance_id: "t-1"}]}});
  const baselineResult = await ownerLatestBaseline(baselineState, {
    mutateAfterOwner: state => { state.current.participant_aggregation_snapshot = {items: [{aggregation_id: "external-a"}]}; },
  });

  assert.deepEqual(candidateResult.floor.participant_aggregation_snapshot, {items: []});
  assert.deepEqual(baselineResult.floor.participant_aggregation_snapshot, {items: [{aggregation_id: "external-a"}]});
  assert.equal(candidateResult.reads, 2, "candidate A keeps final readback but removes one pre-merge read");
  assert.equal(baselineResult.reads, 3);
});

test("candidate B: reusing Latest Slot Read as no-op readback misses a version change in the release window", async () => {
  const pause = deferred();
  const candidateState = authoritativeState({floor_version: "v1", projection_timing_snapshot: {items: []}}, null);
  const candidate = latestReadbackReuseCandidate(candidateState, {pauseAfterLatest: pause});
  candidateState.current.floor_version = "v2";
  pause.resolve();
  const candidateResult = await candidate;
  assert.equal(candidateResult.status, "noop", "candidate B reports the stale no-op as confirmed");

  const baselineState = authoritativeState({floor_version: "v1", projection_timing_snapshot: {items: []}}, null);
  const baseline = latestReadbackBaseline(baselineState, {pauseAfterLatest: (() => {
    const barrier = deferred();
    baselineState.onLatest = () => {
      baselineState.current.floor_version = "v2";
      barrier.resolve();
    };
    return barrier;
  })()});
  baselineState.onLatest?.();
  await assert.rejects(baseline, /FLOOR_TX_READBACK_FAILED/);
  assert.equal(candidateResult.reads, 1);
});

test("candidate C: UI/Context no-op cannot prove Aggregation no-op when authoritative dependency state changed", () => {
  const timing = {timing_instance_id: "t-1", base_min_story_days: 2};
  const contextFloor = {floor_version: floor(), projection_timing_snapshot: {items: [timing]}, participant_aggregation_snapshot: {items: []}};
  const officialFloor = clone(contextFloor);
  officialFloor.participant_aggregation_snapshot = {items: [{aggregation_id: "a-1", status: "succeeded"}]};
  const host = new NativeHostModel({context: context({bioweave: contextFloor}), official: context({bioweave: officialFloor}), saveMode: "immediate-confirmed"});
  const target = targetFromFloor(host);
  const result = nativeContextWrite(host, {target, patch: {projection_timing_snapshot: {items: [timing]}}});

  return result.then(value => {
    assert.equal(value.status, "noop");
    assert.equal(host.saveCount, 0);
    assert.deepEqual(host.readOfficial("chat-a").chat[0].swipe_info[0].extra.bioweave.participant_aggregation_snapshot.items, [{aggregation_id: "a-1", status: "succeeded"}]);
    assert.equal(host.getCount, 1);
  });
});

test("candidate B batching: one native save is not equivalent to current Timing-success/Aggregation-failure semantics", async () => {
  const timing = {timing_instance_id: "t-1", base_min_story_days: 3};
  const snapshot = {floor_version: floor(), projection_timing_snapshot: {items: [{timing_instance_id: "t-1", base_min_story_days: 2}]}, participant_aggregation_snapshot: {items: []}};
  const host = new NativeHostModel({context: context({bioweave: snapshot}), saveMode: "immediate-confirmed"});
  const target = targetFromFloor(host);
  await assert.rejects(
    Promise.resolve().then(() => nativeBatch(host, {
      target,
      timingPatch: {projection_timing_snapshot: {items: [timing]}},
      aggregationPatch: {items: [{aggregation_id: "a-1"}]},
      aggregationFails: true,
    })),
    /AGGREGATION_REEVALUATION_FAILED/,
  );
  assert.equal(host.saveCount, 0, "atomic batch would not preserve the already-successful Timing write");
});

test("native Context fallback: save failure and unavailable host save never become a confirmed UI result", async () => {
  const snapshot = {floor_version: floor(), projection_timing_snapshot: {items: []}};
  const failedHost = new NativeHostModel({context: context({bioweave: snapshot}), saveMode: "failure"});
  const target = targetFromFloor(failedHost);
  await assert.rejects(
    nativeContextWrite(failedHost, {target, patch: {projection_timing_snapshot: {items: [{timing_instance_id: "t-1"}]}}}),
    /HOST_SAVE_FAILED/,
  );
  assert.equal(failedHost.saveCount, 1);

  const unavailableHost = new NativeHostModel({context: context({bioweave: snapshot}), saveMode: "unknown"});
  unavailableHost.saveChat = undefined;
  assert.equal(typeof unavailableHost.saveChat, "undefined");
});

test("native Context write model: current Context can be ahead of official archive, so no-op based only on Context is not authoritative", async () => {
  const current = {floor_version: floor(), projection_timing_snapshot: {items: [{timing_instance_id: "t-1", base_min_story_days: 3}]}};
  const persisted = {floor_version: floor(), projection_timing_snapshot: {items: [{timing_instance_id: "t-1", base_min_story_days: 2}]}};
  const host = new NativeHostModel({context: context({bioweave: current}), official: context({bioweave: persisted}), saveMode: "immediate-confirmed"});
  const target = targetFromFloor(host);
  const result = await nativeContextWrite(host, {
    target,
    patch: {projection_timing_snapshot: clone(current.projection_timing_snapshot)},
  });
  assert.equal(result.status, "noop");
  assert.equal(host.saveCount, 0);
  assert.equal(host.readOfficial("chat-a").chat[0].swipe_info[0].extra.bioweave.projection_timing_snapshot.items[0].base_min_story_days, 2);
});
