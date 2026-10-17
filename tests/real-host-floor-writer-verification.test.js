import test from "node:test";
import assert from "node:assert/strict";
import {
  SAVE_STATES,
  applySnapshotProbe,
  assertDedicatedTempChatTarget,
  buildProbeSnapshot,
  classifyPersistenceOutcome,
  createHostProbeRunner,
  createRequestRecorder,
  makeHostProbeSource,
  summarizeHostContext,
} from "./helpers/real-host-floor-writer-verification.js";

const version = {
  chat_id: "temp-chat-1",
  message_id: "message-1",
  floor: 3,
  swipe_id: 0,
  content_hash: "hash:秘密正文，不应进入摘要",
  message_version: 1,
};

function fixture() {
  const timing = {schema_version: 1, items: []};
  const message = {
    message_id: version.message_id,
    role: "assistant",
    is_user: false,
    floor: version.floor,
    content: "秘密正文，不应进入摘要",
    message_version: version.message_version,
    swipe_id: version.swipe_id,
    extra: {other: {keep: true}, bioweave: {projection_timing_snapshot: timing}},
    swipe_info: {
      0: {extra: {otherSwipe: {keep: true}, bioweave: {projection_timing_snapshot: timing}}},
      1: {extra: {bioweave: {projection_timing_snapshot: {schema_version: 1, items: []}}}},
    },
  };
  const context = {chatId: version.chat_id, epoch: 4, version: "test-host", chat: [message]};
  const target = {chatId: version.chat_id, dedicatedChatId: version.chat_id, targetToken: "target-token", messageIndex: 0, messageId: version.message_id, floor: 3, swipeId: 0, epoch: 4, version, messageRef: message};
  const proof = {dedicated: true, chatId: version.chat_id, createdChatId: version.chat_id, creationToken: "created-token", targetToken: "target-token"};
  return {context, target, proof, message};
}

test("context summary exposes structure and never exposes message正文", () => {
  const {context} = fixture();
  const summary = summarizeHostContext(context);
  assert.equal(summary.chatId, "temp-chat-1");
  assert.equal(summary.messageCount, 1);
  assert.deepEqual(summary.messages[0].bioweaveRoots, ["projection_timing_snapshot"]);
  assert.equal(JSON.stringify(summary).includes("秘密正文"), false);
});

test("dedicated temp Chat proof is mandatory and rejects an existing/current target", () => {
  const {target, proof} = fixture();
  assert.throws(() => assertDedicatedTempChatTarget(target, {...proof, dedicated: false}), /DEDICATED_TEMP_CHAT_PROOF_REQUIRED/);
  assert.throws(() => assertDedicatedTempChatTarget({...target, dedicatedChatId: "formal-chat"}, proof), /DEDICATED_TEMP_CHAT_ID_MISMATCH/);
  assert.throws(() => assertDedicatedTempChatTarget({...target, targetToken: "other"}, proof), /DEDICATED_TARGET_TOKEN_MISMATCH/);
  assert.equal(assertDedicatedTempChatTarget(target, proof), true);
});

test("probe snapshots use the two production collection roots and validate their shape", () => {
  const timing = buildProbeSnapshot(version, "timing");
  const aggregation = buildProbeSnapshot(version, "aggregation", [{aggregation_id: "a-1"}]);
  assert.deepEqual(Object.keys(timing), ["schema_version", "items"]);
  assert.equal(timing.schema_version, 1);
  assert.deepEqual(aggregation.items, [{aggregation_id: "a-1"}]);
  assert.throws(() => buildProbeSnapshot({...version, floor: null}, "timing"), /FLOOR_VERSION_INCOMPLETE/);
  assert.throws(() => buildProbeSnapshot(version, "invented"), /SNAPSHOT_KIND_INVALID/);
});

test("dry-run and authorized write protect message, active Swipe mirror, other fields, and inactive Swipes", () => {
  const {context, target, proof, message} = fixture();
  const next = buildProbeSnapshot(version, "timing", [{timing_instance_id: "t-1"}]);
  const before = structuredClone(context);
  const dry = applySnapshotProbe(context, {target, proof, kind: "timing", snapshot: next});
  assert.equal(dry.mode, "dry-run");
  assert.deepEqual(context, before);
  const written = applySnapshotProbe(context, {target, proof, kind: "timing", snapshot: next, allowWrite: true});
  assert.equal(written.mirrorEqual, true);
  assert.deepEqual(message.extra.bioweave.projection_timing_snapshot, next);
  assert.deepEqual(message.swipe_info[0].extra.bioweave.projection_timing_snapshot, next);
  assert.deepEqual(message.extra.other, {keep: true});
  assert.deepEqual(message.swipe_info[0].extra.otherSwipe, {keep: true});
  assert.deepEqual(message.swipe_info[1].extra.bioweave.projection_timing_snapshot, {schema_version: 1, items: []});
});

test("authorized write still fails closed when the target identity drifts", () => {
  const {context, target, proof} = fixture();
  context.epoch += 1;
  assert.throws(() => applySnapshotProbe(context, {target, proof, kind: "timing", snapshot: buildProbeSnapshot(version)}), /EPOCH_STALE/);
});

test("authorized write rejects a target whose active Swipe has changed", () => {
  const {context, target, proof} = fixture();
  target.swipeId = 1;
  assert.throws(() => applySnapshotProbe(context, {target, proof, kind: "timing", snapshot: buildProbeSnapshot(version)}), /ACTIVE_SWIPE_STALE/);
});

test("system-like messages cannot become Floor owners", () => {
  const {context, target, proof} = fixture();
  context.chat[0].is_system = true;
  assert.throws(() => applySnapshotProbe(context, {target, proof, kind: "timing", snapshot: buildProbeSnapshot(version)}), /NON_CHARACTER_OWNER/);
});

test("persistence outcome distinguishes accepted, confirmed, failed, unknown, and stale", () => {
  const {context, target} = fixture();
  const expected = {schema_version: 1, items: []};
  assert.equal(classifyPersistenceOutcome({saveReturned: true, expected}).status, SAVE_STATES.HOST_ACCEPTED);
  assert.equal(classifyPersistenceOutcome({saveReturned: true, readback: expected, refreshed: true, expected}).status, SAVE_STATES.CONFIRMED);
  assert.equal(classifyPersistenceOutcome({saveError: Object.assign(new Error("network"), {code: "HTTP_500"}), expected}).status, SAVE_STATES.FAILED);
  assert.equal(classifyPersistenceOutcome({saveError: Object.assign(new Error("lost"), {uncertain: true}), expected}).status, SAVE_STATES.UNKNOWN);
  assert.equal(classifyPersistenceOutcome({saveReturned: true, readback: {schema_version: 1, items: [{changed: true}]}, expected}).status, SAVE_STATES.UNKNOWN);
  context.epoch += 1;
  assert.equal(classifyPersistenceOutcome({saveReturned: true, readback: expected, refreshed: true, expected, target, currentContext: context}).status, SAVE_STATES.STALE);
});

test("runner records writer GET/SAVE counts and never calls save in dry-run", async () => {
  const {context, target, proof} = fixture();
  const recorder = createRequestRecorder();
  let saves = 0;
  const runner = createHostProbeRunner({
    getContext: () => context,
    saveChat: async () => { saves += 1; return {ok: true}; },
    readback: async () => ({schema_version: 1, items: []}),
    refresh: async () => true,
    recorder,
    proof,
  });
  const snapshot = buildProbeSnapshot(version, "timing");
  const dry = await runner.run({target, kind: "timing", snapshot});
  assert.equal(dry.status, "DRY_RUN");
  assert.equal(saves, 0);
  const result = await runner.run({target, kind: "timing", snapshot, allowWrite: true});
  assert.equal(result.status, SAVE_STATES.CONFIRMED);
  assert.deepEqual(result.requestCounts, {get: 1, save: 1});
  assert.equal(saves, 1);
  assert.equal(recorder.count("/api/chats/save", "writer"), 1);
});

test("missing readback or response cannot become CONFIRMED; debounced save remains unconfirmed", async () => {
  const {context, target, proof} = fixture();
  const runner = createHostProbeRunner({
    getContext: () => context,
    saveChat: async () => undefined,
    saveChatDebounced: () => undefined,
    proof,
  });
  const result = await runner.run({target, snapshot: buildProbeSnapshot(version), allowWrite: true});
  assert.equal(result.status, SAVE_STATES.HOST_ACCEPTED);
  assert.equal(result.confirmed, false);
  assert.equal(runner.dispatchDebounced(), undefined);
});

test("injected source is read-only by default and contains no remote/formal Chat target", () => {
  const source = makeHostProbeSource();
  assert.match(source, /DRY_RUN/);
  assert.doesNotMatch(source, /https?:\/\//);
  assert.doesNotMatch(source, /formal-chat|chat-a/);
});
