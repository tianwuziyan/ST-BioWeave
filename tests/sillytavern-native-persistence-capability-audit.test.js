import test from "node:test";
import assert from "node:assert/strict";

/*
 * SOURCE_VERIFIED: this audit model follows the inspected SillyTavern
 * snapshot /tmp/bioweave-st-host.QAupuu at 06bde939fb1e9c4c8d8641d810f0a916b5bce127
 * (package 1.19.0), specifically public/script.js saveChat(),
 * saveChatDebounced(), saveChatConditional(), and src/endpoints/chats.js.
 *
 * ISOLATED_TEST_VERIFIED: the assertions below exercise a deterministic model
 * of those observable boundaries. They do not prove behavior of the currently
 * running host. HOST_RUNTIME_UNVERIFIED: the active page reports package
 * version 1.19.0, but does not expose a commit/branch identity. UNKNOWN is
 * used where a lost response prevents confirmation.
 */

const clone = value => value === undefined ? undefined : structuredClone(value);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function settled(promise) {
  return Promise.race([
    promise.then(value => ({state: "fulfilled", value}), error => ({state: "rejected", error})),
    Promise.resolve({state: "pending"}),
  ]);
}

function snapshot({chatId = "chat-a", epoch = 1, messageId = "message-1", swipeId = 0, messageVersion = 1, value = "A"} = {}) {
  return {chatId, epoch, messageId, swipeId, messageVersion, value};
}

class HostPersistenceModel {
  constructor(initial = snapshot()) {
    this.context = clone(initial);
    this.officialByChat = new Map([[initial.chatId, clone(initial)]]);
    this.pending = [];
    this.debounced = null;
    this.isChatSaving = false;
    this.conditionalWaiters = [];
    this.dispatchCount = 0;
  }

  saveChat(input = this.context) {
    const ticket = {
      id: ++this.dispatchCount,
      snapshot: clone(input),
      serverWrite: deferred(),
      httpResponse: deferred(),
      responseLost: false,
    };
    this.pending.push(ticket);

    // SOURCE_VERIFIED: saveChat awaits fetch and returns void for both an OK
    // response and caught errors. The model keeps the response boundary
    // explicit so tests cannot mistake dispatch or file write for confirmation.
    ticket.serverWrite.promise.then(result => {
      if (result?.error) return;
      this.officialByChat.set(ticket.snapshot.chatId, clone(ticket.snapshot));
    });
    return ticket.httpResponse.promise.then(result => {
      if (result?.error) return undefined;
      return result?.ok ? undefined : undefined;
    }, () => undefined);
  }

  completeServerWrite(index = 0, result = {ok: true}) {
    const ticket = this.pending[index];
    assert.ok(ticket, `pending save ${index} exists`);
    ticket.serverWrite.resolve(result);
  }

  completeHttpResponse(index = 0, result = {ok: true}) {
    const ticket = this.pending[index];
    assert.ok(ticket, `pending save ${index} exists`);
    ticket.httpResponse.resolve(result);
  }

  loseHttpResponse(index = 0) {
    const ticket = this.pending[index];
    assert.ok(ticket, `pending save ${index} exists`);
    ticket.responseLost = true;
  }

  saveChatDebounced(input = this.context) {
    // SOURCE_VERIFIED: the host returns no Promise from saveChatDebounced and
    // replaces/cancels the pending timeout before scheduling another one.
    this.debounced = {
      chatId: input.chatId,
      snapshot: clone(input),
    };
    return undefined;
  }

  cancelDebouncedChatSave() {
    this.debounced = null;
  }

  unload() {
    // HOST_RUNTIME_UNVERIFIED: this models the observable risk that a pending
    // browser timer is lost when the page is unloaded.
    this.debounced = null;
  }

  async fireDebounced() {
    const scheduled = this.debounced;
    this.debounced = null;
    if (!scheduled) return undefined;
    if (scheduled.chatId !== this.context.chatId) return undefined;
    return this.saveChatConditional();
  }

  switchChat(next) {
    this.context = clone(next);
    if (!this.officialByChat.has(next.chatId)) {
      this.officialByChat.set(next.chatId, clone(next));
    }
  }

  async saveChatConditional() {
    if (this.isChatSaving) {
      const waiting = deferred();
      this.conditionalWaiters.push(waiting);
      await waiting.promise;
    }
    this.isChatSaving = true;
    const save = this.saveChat(this.context);
    try {
      return await save;
    } finally {
      this.isChatSaving = false;
      const waiters = this.conditionalWaiters.splice(0);
      for (const waiting of waiters) waiting.resolve();
    }
  }

  get(chatId = this.context.chatId) {
    return clone(this.officialByChat.get(chatId));
  }
}

function assertOwnerUnchanged(before, after) {
  assert.equal(after.chatId, before.chatId, "Chat owner changed");
  assert.equal(after.epoch, before.epoch, "runtime epoch changed");
  assert.equal(after.messageId, before.messageId, "message owner changed");
  assert.equal(after.swipeId, before.swipeId, "active Swipe changed");
  assert.equal(after.messageVersion, before.messageVersion, "message version changed");
}

test("SOURCE_VERIFIED: saveChat separates server write, HTTP response, and readback", async () => {
  const host = new HostPersistenceModel();
  const response = host.saveChat();

  assert.equal(host.dispatchCount, 1);
  assert.deepEqual(host.get(), snapshot(), "dispatch alone does not change official storage");
  assert.deepEqual(await settled(response), {state: "pending"});

  host.context.value = "local mutation after dispatch";
  host.completeServerWrite();
  await Promise.resolve();
  assert.equal(host.get().value, "A", "the captured request snapshot is what the server writes");
  assert.deepEqual(await settled(response), {state: "pending"}, "write completion is not HTTP completion");

  host.completeHttpResponse();
  assert.deepEqual(await response, undefined, "saveChat resolves without a durable revision");
  assert.equal(host.get().value, "A", "only an explicit GET/readback observes the committed value");
  assert.equal(host.get().value, "A");
});

test("SOURCE_VERIFIED: saveChat errors are fulfilled undefined, so failure and success share an ambiguous API result", async () => {
  const host = new HostPersistenceModel();
  const failed = host.saveChat();
  host.completeHttpResponse(0, {ok: false, status: 500});
  assert.equal(await failed, undefined, "the modeled caught error boundary is fulfilled");
  assert.deepEqual(host.get(), snapshot(), "failed response does not imply a write");

  const unknown = host.saveChat();
  host.loseHttpResponse(1);
  assert.deepEqual(await settled(unknown), {state: "pending"}, "lost transport stays unconfirmed");
  host.completeServerWrite(1);
  await Promise.resolve();
  assert.equal(host.get().value, "A", "a server write may have happened before the response was lost");
  assert.equal(host.pending[1].responseLost, true);
});

test("SOURCE_VERIFIED: saveChatDebounced is cancellable and has no awaitable completion", async () => {
  const host = new HostPersistenceModel();
  const result = host.saveChatDebounced();
  assert.equal(result, undefined);
  assert.ok(host.debounced);
  host.cancelDebouncedChatSave();
  assert.equal(host.debounced, null);
  assert.equal(host.dispatchCount, 0);

  host.saveChatDebounced();
  host.unload();
  assert.equal(host.debounced, null, "pending debounce can be lost at unload");
});

test("SOURCE_VERIFIED: same-tab saveChatConditional serializes through isChatSaving", async () => {
  const host = new HostPersistenceModel();
  host.context.value = "first";
  const first = host.saveChatConditional();
  host.context.value = "second";
  const second = host.saveChatConditional();
  assert.equal(host.dispatchCount, 1, "the second conditional save waits for the first");
  host.completeServerWrite(0);
  host.completeHttpResponse(0);
  await first;
  await Promise.resolve();
  assert.equal(host.dispatchCount, 2, "the waiting conditional save starts after the first completes");
  host.completeServerWrite(1);
  host.completeHttpResponse(1);
  await second;
  assert.equal(host.get().value, "second");
  assert.equal(host.isChatSaving, false);
});

test("SOURCE_VERIFIED: consecutive debounced saves coalesce to the latest live Chat snapshot", async () => {
  const host = new HostPersistenceModel();
  host.context.value = "first";
  assert.equal(host.saveChatDebounced(), undefined);
  host.context.value = "second";
  assert.equal(host.saveChatDebounced(), undefined);
  assert.ok(host.debounced);

  const pending = host.fireDebounced();
  assert.equal(host.dispatchCount, 1);
  host.completeServerWrite();
  host.completeHttpResponse();
  await pending;
  assert.equal(host.get().value, "second");
});

test("ISOLATED_TEST_VERIFIED: two full-chat writers have last-write-wins and cannot merge siblings", async () => {
  const host = new HostPersistenceModel();
  const first = host.saveChat(snapshot({value: "writer-A"}));
  const second = host.saveChat(snapshot({value: "writer-B"}));

  host.completeServerWrite(1);
  host.completeHttpResponse(1);
  await second;
  host.completeServerWrite(0);
  host.completeHttpResponse(0);
  await first;
  assert.equal(host.get().value, "writer-A", "out-of-order full snapshots overwrite rather than merge");
});

test("ISOLATED_TEST_VERIFIED: full-chat saves from two extensions lose an unrelated extra-field update", async () => {
  const host = new HostPersistenceModel(snapshot({value: "base"}));
  const writerA = snapshot({value: "base"});
  writerA.extra = {fromA: true};
  const writerB = snapshot({value: "base"});
  writerB.extra = {fromB: true};

  const saveA = host.saveChat(writerA);
  const saveB = host.saveChat(writerB);
  host.completeServerWrite(0);
  host.completeHttpResponse(0);
  await saveA;
  host.completeServerWrite(1);
  host.completeHttpResponse(1);
  await saveB;

  assert.deepEqual(host.get().extra, {fromB: true}, "the host does not merge unrelated extra fields");
  assert.equal(host.get().extra.fromA, undefined);
});

test("ISOLATED_TEST_VERIFIED: direct API-style save bypasses same-tab queue and has no CAS", async () => {
  const host = new HostPersistenceModel();
  host.context.value = "queued";
  const queued = host.saveChatConditional();
  const direct = host.saveChat(snapshot({value: "direct"}));
  assert.equal(host.dispatchCount, 2, "direct save is not serialized by isChatSaving");
  host.completeServerWrite(1);
  host.completeHttpResponse(1);
  await direct;
  host.completeServerWrite(0);
  host.completeHttpResponse(0);
  await queued;
  assert.equal(host.get().value, "queued", "there is no expected-revision conflict rejection");
});

test("ISOLATED_TEST_VERIFIED: full-chat atomic write is not an atomic CAS", async () => {
  const host = new HostPersistenceModel(snapshot({value: "base"}));
  const stale = host.saveChat(snapshot({value: "stale"}));
  host.context.value = "newer local state";
  const newer = host.saveChat(host.context);
  host.completeServerWrite(1);
  host.completeHttpResponse(1);
  await newer;
  host.completeServerWrite(0);
  host.completeHttpResponse(0);
  await stale;
  assert.equal(host.get().value, "stale", "atomic replacement still permits stale last-write-wins");
});

test("UNKNOWN: save response lost after server write requires authoritative GET before claiming success", async () => {
  const host = new HostPersistenceModel();
  const save = host.saveChat(snapshot({value: "persisted"}));
  host.completeServerWrite();
  await Promise.resolve();
  host.loseHttpResponse();
  assert.deepEqual(await settled(save), {state: "pending"});
  assert.equal(host.pending[0].responseLost, true);
  assert.equal(host.get().value, "persisted", "this test-only GET can confirm after the fact");
  // The save Promise itself remains unresolved; a caller must not convert it
  // into confirmed merely because the model's later readback happens to match.
});

test("ISOLATED_TEST_VERIFIED: a failed save can be retried, but the first result is not success", async () => {
  const host = new HostPersistenceModel();
  const failed = host.saveChat(snapshot({value: "failed"}));
  host.completeHttpResponse(0, {ok: false, status: 500});
  assert.equal(await failed, undefined);
  assert.equal(host.get().value, "A");

  const retry = host.saveChat(snapshot({value: "retry"}));
  host.completeServerWrite(1);
  host.completeHttpResponse(1);
  await retry;
  assert.equal(host.get().value, "retry");
});

for (const [name, change] of [
  ["Chat", state => { state.chatId = "chat-b"; }],
  ["Swipe", state => { state.swipeId = 1; }],
  ["message", state => { state.messageId = "message-2"; }],
  ["epoch", state => { state.epoch += 1; }],
]) {
  test(`ISOLATED_TEST_VERIFIED: ${name} changes invalidate an async save owner`, async () => {
    const host = new HostPersistenceModel();
    const captured = clone(host.context);
    const save = host.saveChat(captured);
    change(host.context);
    assert.throws(() => assertOwnerUnchanged(captured, host.context));
    host.completeServerWrite();
    host.completeHttpResponse();
    await save;
    assert.notDeepEqual(host.get(), host.context, "the old captured request cannot be treated as current owner state");
  });
}

test("ISOLATED_TEST_VERIFIED: save then GET can be invalidated by a later overwrite", async () => {
  const host = new HostPersistenceModel();
  const save = host.saveChat(snapshot({value: "first"}));
  host.completeServerWrite();
  host.completeHttpResponse();
  await save;
  const readAfterSave = host.get();
  assert.equal(readAfterSave.value, "first");

  const later = host.saveChat(snapshot({value: "later"}));
  host.completeServerWrite(1);
  host.completeHttpResponse(1);
  await later;
  assert.equal(host.get().value, "later", "a prior GET is only a point-in-time observation");
});

test("ISOLATED_TEST_VERIFIED: a save dispatched before Chat switch writes its captured target, not the new current Chat", async () => {
  const host = new HostPersistenceModel();
  const save = host.saveChat(snapshot({chatId: "chat-a", value: "old-chat"}));
  host.switchChat(snapshot({chatId: "chat-b", value: "new-chat"}));

  host.completeServerWrite();
  host.completeHttpResponse();
  await save;

  assert.equal(host.get("chat-a").value, "old-chat");
  assert.equal(host.get("chat-b").value, "new-chat");
  assert.equal(host.get().chatId, "chat-b");
});

test("ISOLATED_TEST_VERIFIED: Context-only no-op detection is unsafe when official storage has diverged", () => {
  const host = new HostPersistenceModel(snapshot({value: "official"}));
  host.context.value = "local-but-stale";
  assert.notEqual(host.context.value, host.get().value);
  assert.notDeepEqual(host.context, host.get(), "live Context is not an authoritative revision");
});
