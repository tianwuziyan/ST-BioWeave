import test from "node:test";
import assert from "node:assert/strict";
import {normalizeParticipantAggregationSnapshot} from "../core/participant-aggregation.js";
import {normalizeProjectionTimingSnapshot} from "../core/projection-timing-persistence.js";
import {
  ContextFloorWriter,
  ContextHostModel,
  OWNER_ROOTS,
  SAVE_STATES,
  deferred,
  floorVersion,
  makeAggregationItem,
  makeContext,
  makeTimingItem,
  mergeSnapshot,
} from "./helpers/context-first-floor-writer-prototype.js";

const clone = value => structuredClone(value);

function timingSnapshot(version, id = "timing-1", sampledOffset = 0.25) {
  return {schema_version: 1, items: [makeTimingItem({version, timingInstanceId: id, sampledOffset})]};
}

function aggregationSnapshot(version, id = "aggregation-1", timingInstanceId = "timing-1") {
  return {schema_version: 1, items: [makeAggregationItem({version, aggregationId: id, timingInstanceId})]};
}

function fixture({mode = "context-fast", roots = {}, contextOptions = {}} = {}) {
  const host = new ContextHostModel({context: makeContext({...contextOptions, roots})});
  const writer = new ContextFloorWriter(host, {mode});
  return {host, writer, target: writer.captureTarget()};
}

async function nextTurn() {
  await Promise.resolve();
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (predicate()) return;
    await nextTurn();
  }
  assert.fail(message);
}

async function completeTicket(host, index = 0, response = {}) {
  host.releaseServerWrite(index);
  await nextTurn();
  host.releaseResponse(index, response);
}

test("context-fast writes the exact production roots with zero GET, but only HOST_ACCEPTED", async () => {
  const {host, writer, target} = fixture();
  const nextTiming = timingSnapshot(target.version, "timing-1", 0.5);
  const operation = writer.write({target, owner: "timing", patch: nextTiming});
  await waitFor(() => host.tickets.length === 1, "native save must be dispatched");
  await completeTicket(host);
  const result = await operation;

  assert.equal(result.status, SAVE_STATES.HOST_ACCEPTED);
  assert.equal(result.confirmed, false);
  assert.deepEqual(result.requestCounts, {get: 0, save: 1, readback: 0});
  assert.deepEqual(host.context.chat[0].extra.bioweave.projection_timing_snapshot, nextTiming);
  assert.deepEqual(host.context.chat[0].swipe_info[0].extra.bioweave.projection_timing_snapshot, nextTiming);
  assert.deepEqual(host.context.chat[0].extra.other_extension, {must_survive: true});
  assert.deepEqual(host.context.chat[0].swipe_info[0].extra.other_swipe_extension, {must_survive: true});
  assert.equal(normalizeProjectionTimingSnapshot(nextTiming, {expectedChatId: "chat-a"}).invalid, false);
});

test("context-fast no-op does not mutate or save, while native-confirmed no-op spends one explicit GET", async () => {
  const fast = fixture();
  const currentTiming = fast.host.context.chat[0].swipe_info[0].extra.bioweave.projection_timing_snapshot;
  const before = clone(fast.host.context);
  const fastResult = await fast.writer.write({target: fast.target, owner: "timing", patch: currentTiming});
  assert.equal(fastResult.status, SAVE_STATES.CLEAN);
  assert.deepEqual(fastResult.requestCounts, {get: 0, save: 0, readback: 0});
  assert.deepEqual(fast.host.context, before);

  const confirmed = fixture({mode: "native-confirmed"});
  const confirmedTiming = confirmed.host.context.chat[0].swipe_info[0].extra.bioweave.projection_timing_snapshot;
  const confirmedResult = await confirmed.writer.write({target: confirmed.target, owner: "timing", patch: confirmedTiming});
  assert.equal(confirmedResult.status, SAVE_STATES.CONFIRMED);
  assert.deepEqual(confirmedResult.requestCounts, {get: 1, save: 0, readback: 1});
});

test("native-confirmed requires a matching readback and preserves sibling roots, Swipe data, and extension fields", async () => {
  const {host, writer, target} = fixture({mode: "native-confirmed"});
  const nextTiming = timingSnapshot(target.version, "timing-1", 0.75);
  const operation = writer.write({target, owner: "timing", patch: nextTiming});
  await waitFor(() => host.tickets.length === 1, "save must dispatch");
  await completeTicket(host);
  const result = await operation;

  assert.equal(result.status, SAVE_STATES.CONFIRMED);
  assert.deepEqual(result.requestCounts, {get: 1, save: 1, readback: 1});
  const persisted = host.officialByChat.get("chat-a").chat[0];
  assert.deepEqual(persisted.extra.bioweave.projection_timing_snapshot, nextTiming);
  assert.deepEqual(persisted.swipe_info[0].extra.bioweave.projection_timing_snapshot, nextTiming);
  assert.deepEqual(persisted.swipe_info[1].extra.bioweave.projection_timing_snapshot.items, []);
  assert.deepEqual(persisted.extra.other_extension, {must_survive: true});
  assert.equal(normalizeProjectionTimingSnapshot(persisted.extra.bioweave.projection_timing_snapshot, {expectedChatId: "chat-a"}).rejected.length, 0);
});

test("mergeSnapshot supports all module owners without inventing the two production collection roots", () => {
  const version = floorVersion();
  const current = {
    floor_version: version,
    analysis: {old: true},
    events: [{event_id: "old"}],
    world_model: {old: true},
    world_model_meta: {old: true},
    character_registry: {old: true},
    tracking_window_timeline: {schema_version: 1, creations: [], lifecycle_records: []},
    projection_timeline: {schema_version: 1, creations: [], evidence_records: [], lifecycle_records: [], delivery_records: []},
    projection_timing_snapshot: {schema_version: 1, items: []},
    participant_aggregation_snapshot: {schema_version: 1, items: []},
  };
  for (const owner of Object.keys(OWNER_ROOTS)) {
    const root = OWNER_ROOTS[owner][0];
    const patch = owner === "timing"
      ? timingSnapshot(version)
      : owner === "aggregation"
        ? aggregationSnapshot(version)
        : {[root]: root === "analysis"
          ? {status: "success"}
          : root === "events"
            ? [{event_id: "new"}]
            : root === "character_registry"
              ? {schema_version: 1, entities: {}}
              : root === "tracking_window_timeline"
                ? {schema_version: 1, creations: [], lifecycle_records: [{tracking_window_id: "new"}]}
                : root === "projection_timeline"
                  ? {schema_version: 1, creations: [{projection_id: "new"}], evidence_records: [], lifecycle_records: [], delivery_records: []}
                  : {updated: owner}};
    const result = mergeSnapshot({currentFloor: current, owner, patch});
    assert.equal(result.changed, true, `${owner} must have a whitelisted merge`);
  }
  assert.deepEqual(OWNER_ROOTS.timing, ["projection_timing_snapshot"]);
  assert.deepEqual(OWNER_ROOTS.aggregation, ["participant_aggregation_snapshot"]);
});

test("missing roots inherit from the nearest supplied Floor, while explicit empty items clear instead of inheriting", () => {
  const version = floorVersion();
  const inheritedTiming = timingSnapshot(version, "historic-timing");
  const current = {floor_version: version, world_model: {current: true}};
  const historical = {floor_version: version, projection_timing_snapshot: inheritedTiming, participant_aggregation_snapshot: aggregationSnapshot(version)};
  const inherited = mergeSnapshot({currentFloor: current, historicalFloor: historical, owner: "world", patch: {world_model: {current: false}}});
  assert.deepEqual(inherited.snapshot.projection_timing_snapshot, inheritedTiming);

  const cleared = mergeSnapshot({
    currentFloor: {floor_version: version, participant_aggregation_snapshot: aggregationSnapshot(version)},
    historicalFloor: historical,
    owner: "aggregation",
    patch: {schema_version: 1, items: []},
  });
  assert.deepEqual(cleared.snapshot.participant_aggregation_snapshot, {schema_version: 1, items: []});
});

test("same-Floor Timing and Aggregation writes serialize and merge against the live Context", async () => {
  const {host, writer, target} = fixture();
  const timing = timingSnapshot(target.version, "timing-1", 0.5);
  const aggregation = aggregationSnapshot(target.version);
  const first = writer.write({target, owner: "timing", patch: timing});
  const second = writer.write({target, owner: "aggregation", patch: aggregation});
  await waitFor(() => host.tickets.length === 1, "first write must dispatch");
  await completeTicket(host, 0);
  await waitFor(() => host.tickets.length === 2, "queued second write must dispatch");
  await completeTicket(host, 1);
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(firstResult.status, SAVE_STATES.HOST_ACCEPTED);
  assert.equal(secondResult.status, SAVE_STATES.HOST_ACCEPTED);
  assert.equal(host.metrics.queueWait, 1);
  assert.equal(host.metrics.save, 2);
  const floor = host.officialByChat.get("chat-a").chat[0].extra.bioweave;
  assert.deepEqual(floor.projection_timing_snapshot, timing);
  assert.deepEqual(floor.participant_aggregation_snapshot, aggregation);
});

test("duplicate same-Snapshot work is idempotent after the first queued save", async () => {
  const {host, writer, target} = fixture();
  const timing = timingSnapshot(target.version, "timing-1", 0.5);
  const first = writer.write({target, owner: "timing", patch: timing});
  const second = writer.write({target, owner: "timing", patch: timing});
  await waitFor(() => host.tickets.length === 1, "first write must dispatch");
  await completeTicket(host);
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.status, SAVE_STATES.HOST_ACCEPTED);
  assert.equal(secondResult.status, SAVE_STATES.CLEAN);
  assert.equal(host.metrics.save, 1);
});

test("an extension changed before the merge survives because the writer never replaces the whole message", async () => {
  const {host, writer, target} = fixture();
  host.mutateContextExtra(0, extra => { extra.other_extension.concurrent = "before-merge"; });
  const operation = writer.write({target, owner: "timing", patch: timingSnapshot(target.version)});
  await waitFor(() => host.tickets.length === 1, "save must dispatch");
  await completeTicket(host);
  await operation;
  assert.equal(host.context.chat[0].extra.other_extension.concurrent, "before-merge");
  assert.equal(host.officialByChat.get("chat-a").chat[0].extra.other_extension.concurrent, "before-merge");
});

test("replacing the target message object before the write fails closed even when identity fields are unchanged", async () => {
  const {host, writer, target} = fixture();
  host.replaceMessage(0, clone(host.context.chat[0]));
  const result = await writer.write({target, owner: "timing", patch: timingSnapshot(target.version)});
  assert.equal(result.status, SAVE_STATES.STALE);
  assert.equal(result.errorCode, "MESSAGE_OBJECT_REPLACED");
  assert.equal(host.metrics.save, 0);
});

test("Chat, Swipe, content, deletion, epoch, and historical changes are rejected before save", async () => {
  const cases = [
    ["chat", host => host.switchChat(makeContext({chatId: "chat-b"}))],
    ["swipe", host => host.switchSwipe(0, 1)],
    ["content", host => host.editMessage(0, "编辑后正文")],
    ["delete", host => host.deleteMessage(0)],
    ["epoch", host => host.changeEpoch()],
  ];
  for (const [label, mutate] of cases) {
    const {host, writer, target} = fixture();
    mutate(host);
    const result = await writer.write({target, owner: "timing", patch: timingSnapshot(target.version, label)});
    assert.equal(result.status, SAVE_STATES.STALE, label);
    assert.equal(host.metrics.save, 0, `${label} must not save`);
  }

  const historical = makeContext({floor: 6, messageId: "history", content: "历史"});
  historical.chat.push(makeContext({floor: 7, messageId: "current"}).chat[0]);
  const historicalHost = new ContextHostModel({context: historical});
  const historicalWriter = new ContextFloorWriter(historicalHost);
  const historicalTarget = historicalHost.captureTarget(0);
  const historicalResult = await historicalWriter.write({target: historicalTarget, owner: "timing", patch: timingSnapshot(historicalTarget.version)});
  assert.equal(historicalResult.status, SAVE_STATES.STALE);
  assert.equal(historicalResult.errorCode, "HISTORICAL_FLOOR_WRITE_FORBIDDEN");
});

test("context changes during the save never become a false success", async () => {
  const mutations = [
    ["chat", host => host.switchChat(makeContext({chatId: "chat-b"}))],
    ["swipe", host => host.switchSwipe(0, 1)],
    ["content", host => host.editMessage(0, "保存期间编辑")],
    ["delete", host => host.deleteMessage(0)],
    ["epoch", host => host.changeEpoch()],
  ];
  for (const [label, mutate] of mutations) {
    const {host, writer, target} = fixture();
    const operation = writer.write({target, owner: "timing", patch: timingSnapshot(target.version, label)});
    await waitFor(() => host.tickets.length === 1, `${label} must dispatch`);
    mutate(host);
    await completeTicket(host);
    const result = await operation;
    assert.equal(result.status, SAVE_STATES.STALE, `${label} must not report accepted`);
    assert.equal(result.confirmed, false);
  }
});

test("explicit server failure rolls the still-owned local Context back and reports FAILED", async () => {
  const {host, writer, target} = fixture();
  const before = clone(host.context);
  const operation = writer.write({target, owner: "timing", patch: timingSnapshot(target.version)});
  await waitFor(() => host.tickets.length === 1, "save must dispatch");
  host.releaseServerWrite(0, {error: new Error("disk failure")});
  const result = await operation;
  assert.equal(result.status, SAVE_STATES.FAILED);
  assert.equal(result.confirmed, false);
  assert.deepEqual(host.context, before);
});

test("server commit followed by a lost response is UNKNOWN, not CONFIRMED", async () => {
  const {host, writer, target} = fixture();
  const operation = writer.write({target, owner: "timing", patch: timingSnapshot(target.version)});
  await waitFor(() => host.tickets.length === 1, "save must dispatch");
  await completeTicket(host, 0, {lost: true});
  const result = await operation;
  assert.equal(result.status, SAVE_STATES.UNKNOWN);
  assert.equal(result.confirmed, false);
  assert.equal(result.requestCounts.get, 0);
  assert.deepEqual(host.officialByChat.get("chat-a").chat[0].extra.bioweave.projection_timing_snapshot, timingSnapshot(target.version));
});

test("native-confirmed reports UNKNOWN when readback disagrees with the saved root", async () => {
  const {host, writer, target} = fixture({mode: "native-confirmed"});
  const barrier = host.deferReadback("mismatch-readback");
  const operation = writer.write({target, owner: "timing", patch: timingSnapshot(target.version)});
  await waitFor(() => host.tickets.length === 1, "save must dispatch");
  await completeTicket(host);
  await waitFor(() => host.metrics.readback === 1, "readback must start");
  host.mutateOfficial("chat-a", state => {
    state.chat[0].swipe_info[0].extra.bioweave.projection_timing_snapshot = {schema_version: 1, items: []};
  }, "external-overwrite");
  barrier.resolve();
  const result = await operation;
  assert.equal(result.status, SAVE_STATES.UNKNOWN);
  assert.equal(result.errorCode, "READBACK_PAYLOAD_MISMATCH");
  assert.equal(result.requestCounts.get, 1);
});

test("an external full-chat writer can overwrite a context-first save; fast mode cannot observe it", async () => {
  const {host, writer, target} = fixture();
  const oldSnapshot = clone(host.officialByChat.get("chat-a"));
  oldSnapshot.chat[0].extra.old_tab = true;
  const operation = writer.write({target, owner: "timing", patch: timingSnapshot(target.version)});
  await waitFor(() => host.tickets.length === 1, "save must dispatch");
  await completeTicket(host);
  host.replaceOfficial("chat-a", oldSnapshot, "old-tab-full-chat-writer");
  const result = await operation;
  assert.equal(result.status, SAVE_STATES.HOST_ACCEPTED);
  assert.equal(host.officialByChat.get("chat-a").chat[0].extra.old_tab, true);
  assert.equal(host.metrics.overwrites.some(entry => entry.reason === "old-tab-full-chat-writer"), true);
});

test("a context extension update after save dispatch is a deterministic lost-update counterexample", async () => {
  const {host, writer, target} = fixture();
  const operation = writer.write({target, owner: "timing", patch: timingSnapshot(target.version)});
  await waitFor(() => host.tickets.length === 1, "save must capture a snapshot");
  host.mutateContextExtra(0, extra => { extra.external_during_save = true; });
  await completeTicket(host);
  const result = await operation;
  assert.equal(result.status, SAVE_STATES.HOST_ACCEPTED);
  assert.equal(host.context.chat[0].extra.external_during_save, true);
  assert.equal(host.officialByChat.get("chat-a").chat[0].extra.external_during_save, undefined);
  assert.equal(host.metrics.overwrites.some(entry => entry.reason === "full-chat-save"), true);
});

test("Timing and Aggregation remain two independent confirmed logical transactions", async () => {
  const {host, writer, target} = fixture({mode: "native-confirmed"});
  const timing = timingSnapshot(target.version, "timing-1", 0.5);
  const aggregation = aggregationSnapshot(target.version);
  const operation = writer.runTimingAggregation({target, timingPatch: timing, aggregationPatch: aggregation});
  await waitFor(() => host.tickets.length === 1, "Timing must dispatch first");
  await completeTicket(host, 0);
  await waitFor(() => host.tickets.length === 2, "Aggregation must dispatch independently");
  await completeTicket(host, 1);
  const result = await operation;

  assert.equal(result.timing.status, SAVE_STATES.CONFIRMED);
  assert.equal(result.aggregation.status, SAVE_STATES.CONFIRMED);
  assert.equal(host.metrics.save, 2);
  assert.equal(host.metrics.get, 2);
  assert.equal(result.timing.serverWriteCompleted, true);
  assert.equal(result.aggregation.serverWriteCompleted, true);
  const persisted = host.officialByChat.get("chat-a").chat[0].extra.bioweave;
  assert.equal(persisted.projection_timing_snapshot.items[0].timing_instance_id, "timing-1");
  assert.equal(persisted.projection_timing_snapshot.items[0].cycle_id, "cycle-1");
  assert.equal(persisted.projection_timing_snapshot.items[0].sampled_individual_offset_story_days, 0.5);
  assert.equal(normalizeParticipantAggregationSnapshot(persisted.participant_aggregation_snapshot, {expectedChatId: "chat-a"}).rejected.length, 0);
});

test("native-confirmed Timing/Aggregation no-op combinations each retain their own confirmation", async () => {
  const cases = [
    ["both-no-op", {}, {}, 0, 2],
    ["timing-changed", {timing: true}, {}, 1, 2],
    ["aggregation-changed", {}, {aggregation: true}, 1, 2],
  ];
  for (const [label, timingChange, aggregationChange, saves, gets] of cases) {
    const {host, writer, target} = fixture({mode: "native-confirmed"});
    const timing = timingChange.timing ? timingSnapshot(target.version, `${label}-timing`, 0.5) : host.context.chat[0].swipe_info[0].extra.bioweave.projection_timing_snapshot;
    const aggregation = aggregationChange.aggregation ? aggregationSnapshot(target.version, `${label}-aggregation`) : host.context.chat[0].swipe_info[0].extra.bioweave.participant_aggregation_snapshot;
    const operation = writer.runTimingAggregation({target, timingPatch: timing, aggregationPatch: aggregation});
    if (saves > 0) {
      await waitFor(() => host.tickets.length === 1, `${label} must dispatch Timing`);
      await completeTicket(host, 0);
      if (saves === 2) {
        await waitFor(() => host.tickets.length === 2, `${label} must dispatch Aggregation`);
        await completeTicket(host, 1);
      }
    }
    const result = await operation;
    assert.equal(result.timing.status, SAVE_STATES.CONFIRMED, label);
    assert.equal(result.aggregation.status, SAVE_STATES.CONFIRMED, label);
    assert.deepEqual({save: host.metrics.save, get: host.metrics.get}, {save: saves, get: gets}, label);
  }
});

test("Timing confirmation gates Aggregation in context-fast mode instead of pretending the two-stage operation succeeded", async () => {
  const {host, writer, target} = fixture({mode: "context-fast"});
  const operation = writer.runTimingAggregation({
    target,
    timingPatch: timingSnapshot(target.version),
    aggregationPatch: aggregationSnapshot(target.version),
  });
  await waitFor(() => host.tickets.length === 1, "Timing must dispatch");
  await completeTicket(host);
  const result = await operation;
  assert.equal(result.timing.status, SAVE_STATES.HOST_ACCEPTED);
  assert.equal(result.aggregation.status, SAVE_STATES.STALE);
  assert.equal(result.aggregation.skipped, true);
  assert.equal(result.finalStatus, SAVE_STATES.STALE);
  assert.deepEqual({get: host.metrics.get, save: host.metrics.save}, {get: 0, save: 1});
});

test("Timing confirmation followed by aggregation computation failure preserves partial success", async () => {
  const {host, writer, target} = fixture({mode: "native-confirmed"});
  const operation = writer.runTimingAggregation({
    target,
    timingPatch: timingSnapshot(target.version),
    aggregationPatch: aggregationSnapshot(target.version),
    aggregationError: Object.assign(new Error("AGGREGATION_FAILED"), {code: "AGGREGATION_FAILED"}),
  });
  await waitFor(() => host.tickets.length === 1, "Timing must dispatch");
  await completeTicket(host);
  const result = await operation;
  assert.equal(result.timing.status, SAVE_STATES.CONFIRMED);
  assert.equal(result.aggregation.status, SAVE_STATES.FAILED);
  assert.equal(result.partialSuccess, true);
  assert.equal(host.metrics.save, 1);
  assert.equal(host.metrics.get, 1);
});

test("a later queued write starts from current Floor data and keeps the first module's root", async () => {
  const {host, writer, target} = fixture();
  const timing = timingSnapshot(target.version, "timing-1", 0.5);
  const aggregation = aggregationSnapshot(target.version, "aggregation-1");
  const first = writer.write({target, owner: "timing", patch: timing});
  const second = writer.write({target, owner: "aggregation", patch: aggregation});
  await waitFor(() => host.tickets.length === 1, "first write must dispatch");
  host.mutateContextFloor(0, floor => { floor.world_model = {external_module: true}; });
  await completeTicket(host);
  await waitFor(() => host.tickets.length === 2, "second write must dispatch");
  await completeTicket(host, 1);
  await Promise.all([first, second]);
  const finalFloor = host.officialByChat.get("chat-a").chat[0].extra.bioweave;
  assert.deepEqual(finalFloor.projection_timing_snapshot, timing);
  assert.deepEqual(finalFloor.participant_aggregation_snapshot, aggregation);
  assert.deepEqual(finalFloor.world_model, {external_module: true});
});

test("saveChatDebounced has no completion result and is never treated as confirmation", () => {
  const {host} = fixture();
  const result = host.saveChatDebounced();
  assert.equal(result, undefined);
  assert.equal(host.metrics.save, 0);
  assert.equal(host.metrics.waits.includes("debounced-dispatch-without-result"), true);
});

test("all concurrency controls use explicit Deferred barriers rather than timing", async () => {
  const barrier = deferred("explicit-barrier");
  let released = false;
  barrier.promise.then(() => { released = true; });
  assert.equal(released, false);
  barrier.resolve();
  await barrier.promise;
  assert.equal(released, true);
});
