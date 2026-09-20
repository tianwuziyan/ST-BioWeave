import test from "node:test";
import assert from "node:assert/strict";
import { createRuntime, createSillyTavernAdapter } from "../runtime/events.js";
import { buildClearPlan } from "../storage/clear.js";
import { cloneValue, emptyChat, emptyFloor } from "../storage/schema.js";

function floorRoot(marker, chatId = "chat-a") {
  const version = {
    chat_id: chatId,
    message_id: marker,
    floor: 1,
    swipe_id: 0,
    content_hash: `${marker}-hash`,
    message_version: `${marker}-version`,
  };
  return {
    ...emptyFloor(),
    floor_version: version,
    analysis: { status: "success", floor_version: version },
    events: [{ event_id: `${marker}-event`, source: version }],
  };
}

function sourceChat(chatId = "chat-a") {
  return {
    chatId,
    revision: 1,
    characterId: "character-1",
    groupId: null,
    chatMetadata: {
      unrelated_plugin_metadata: { keep: true },
      bioweave: {
        ...emptyChat(chatId),
      },
    },
    messages: [
      {
        message_id: "ordinary-message",
        floor: 1,
        mes: "Chat A 普通正文",
        extra: {
          unrelated_plugin: { keep: "message" },
          bioweave: floorRoot("ordinary"),
        },
      },
      {
        message_id: "swipe-message",
        floor: 2,
        swipes: ["Swipe A0 正文", "Swipe A1 正文", "Swipe A2 正文"],
        swipe_id: 1,
        extra: {
          unrelated_plugin: { keep: "mirror" },
          bioweave: floorRoot("mirror"),
        },
        swipe_info: [
          {
            content: "Swipe A0 正文",
            extra: {
              unrelated_plugin: { keep: 0 },
              bioweave: floorRoot("swipe-0"),
            },
          },
          {
            content: "Swipe A1 正文",
            extra: {
              unrelated_plugin: { keep: 1 },
              bioweave: floorRoot("swipe-1"),
            },
          },
          {
            content: "Swipe A2 正文",
            extra: {
              unrelated_plugin: { keep: 2 },
              bioweave: floorRoot("swipe-2"),
            },
          },
        ],
      },
    ],
  };
}

function cleanChat(chatId = "chat-b") {
  return {
    chatId,
    revision: 1,
    characterId: "character-1",
    groupId: null,
    chatMetadata: { unrelated_plugin_metadata: { keep: true } },
    messages: [
      {
        message_id: `${chatId}-message`,
        floor: 1,
        mes: `${chatId} 正文`,
        extra: { unrelated_plugin: { keep: true } },
      },
    ],
  };
}

function makeFixture({ chatIndex = ["chat-a"], sourceSave = null, analyzer = null } = {}) {
  const owners = {
    "chat-a": sourceChat("chat-a"),
    "chat-b": cleanChat("chat-b"),
    "chat-c": {
      ...cleanChat("chat-c"),
      chatMetadata: {
        unrelated_plugin_metadata: { keep: "chat-c" },
        bioweave: {
          ...emptyChat("chat-c"),
        },
      },
    },
  };
  let currentChatId = "chat-a";
  const listeners = new Map();
  const events = [];
  const sourceSaveCalls = [];
  const secretStoreCalls = [];
  const context = {
    get chatId() {
      return currentChatId;
    },
    get chatMetadata() {
      return owners[currentChatId].chatMetadata;
    },
    get chat() {
      return owners[currentChatId].messages;
    },
    eventTypes: {
      CHAT_CHANGED: "chat-changed",
      CHAT_CREATED: "chat-created",
      MESSAGE_UPDATED: "message-updated",
      MESSAGE_EDITED: "message-edited",
      MESSAGE_DELETED: "message-deleted",
      MESSAGE_SWIPED: "message-swiped",
      MESSAGE_SWIPE_DELETED: "message-swipe-deleted",
      MESSAGE_RECEIVED: "message-received",
      GENERATION_ENDED: "generation-ended",
    },
    eventSource: {
      on(type, listener) {
        listeners.set(type, listener);
      },
      removeListener(type, listener) {
        if (listeners.get(type) === listener) listeners.delete(type);
      },
    },
    extensionSettings: {
      bioweave: {
        api_source: "bioweave",
        api_profiles: {
          profile: { profile_id: "profile", secret_ref: "secret-ref" },
        },
        assignments: { event_analysis: "profile" },
        analysis_prompt: { task: "保留" },
      },
    },
  };
  const adapter = {
    sourceOwnerRevisionCAS: true,
    getContext: () => context,
    getChatId: () => currentChatId,
    getChat: () => owners[currentChatId].messages,
    getChatMetadata: () => owners[currentChatId].chatMetadata,
    getGlobalSettings: () => context.extensionSettings.bioweave,
    getMessage: (index) => owners[currentChatId].messages[index] ?? null,
    getChatRevision: () => owners[currentChatId].revision,
    getChatOwnerIdentity: () => ({
      characterId: owners[currentChatId].characterId,
      groupId: owners[currentChatId].groupId,
    }),
    getChatIndex: () => (chatIndex === null ? null : [...chatIndex]),
    getSecretStore: () => {
      secretStoreCalls.push("getSecretStore");
      return { get() {}, set() {}, delete() {} };
    },
    async saveChatMetadata(key, value, expectedChatId) {
      assert.equal(expectedChatId, currentChatId);
      owners[currentChatId].chatMetadata[key] = cloneValue(value);
      return { commitState: "confirmed" };
    },
    async saveChat() {
      return { commitState: "confirmed" };
    },
    async saveFloorBioWeave(index, swipeId, value, expectedChatId) {
      assert.equal(expectedChatId, currentChatId);
      const message = owners[currentChatId].messages[index];
      if (message.swipes || message.swipe_info) {
        message.swipe_info[swipeId] ??= {};
        message.swipe_info[swipeId].extra ??= {};
        message.swipe_info[swipeId].extra.bioweave = cloneValue(value);
      } else {
        message.extra ??= {};
        message.extra.bioweave = cloneValue(value);
      }
      return { commitState: "confirmed" };
    },
    async readChatOwner({ chatId }) {
      const owner = owners[chatId];
      if (!owner) throw new Error("CHAT_OWNER_NOT_FOUND");
      return {
        chatId,
        revision: owner.revision,
        characterId: owner.characterId,
        groupId: owner.groupId,
        chatMetadata: cloneValue(owner.chatMetadata),
        messages: cloneValue(owner.messages),
      };
    },
    async saveChatOwner(payload) {
      const owner = owners[payload.chatId];
      assert.ok(owner);
      assert.equal(payload.expectedRevision, owner.revision);
      sourceSaveCalls.push(payload.chatId);
      const response = typeof sourceSave === "function"
        ? await sourceSave(payload)
        : { commitState: "confirmed" };
      if (response?.commitState === "confirmed") {
        owners[payload.chatId] = {
          ...owner,
          revision: owner.revision + 1,
          chatMetadata: cloneValue(payload.state.chatMetadata),
          messages: cloneValue(payload.state.messages),
        };
      }
      return response;
    },
  };
  const runtime = createRuntime({
    adapter,
    analyzer: analyzer ?? {
      async analyzeFloor() {
        return { events: [] };
      },
    },
  });
  runtime.subscribe((event) => events.push(event));
  return {
    adapter,
    context,
    owners,
    events,
    sourceSaveCalls,
    secretStoreCalls,
    runtime,
    setCurrent(chatId, characterId = owners[chatId].characterId) {
      owners[chatId].characterId = characterId;
      currentChatId = chatId;
    },
    emit(type, payload) {
      return listeners.get(type)?.(payload);
    },
  };
}

async function settleLifecycle() {
  for (let index = 0; index < 12; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function bioWeaveRoots(owner) {
  return owner.messages.flatMap((message) => [
    message.extra?.bioweave,
    ...(message.swipe_info ?? []).map((slot) => slot?.extra?.bioweave),
  ]);
}

function assertClearedFloorRoots(roots) {
  assert.equal(roots.length, 5);
  for (const root of roots) {
    assert.equal(root.analysis, null);
    assert.deepEqual(root.events, []);
    assert.deepEqual(root.character_registry, { schema_version: 1, entities: {} });
    assert.equal(root.world_model, null);
    assert.equal(root.world_model_meta, null);
    assert.ok(root.v);
    assert.ok(root.floor_version);
  }
}

test("Start New Chat clears source A through the same source owner while B stays clean", async () => {
  let releaseSave;
  let sourceSaveStarted;
  const sourceSaveReady = new Promise((resolve) => {
    sourceSaveStarted = resolve;
  });
  const saveGate = new Promise((resolve) => {
    releaseSave = resolve;
  });
  const fixture = makeFixture({
    sourceSave: async () => {
      sourceSaveStarted();
      await saveGate;
      return { commitState: "confirmed" };
    },
  });
  const globalBefore = cloneValue(fixture.context.extensionSettings.bioweave);
  const sourceTextBefore = fixture.owners["chat-a"].messages.map((message) => ({
    mes: message.mes,
    swipes: cloneValue(message.swipes),
    swipeInfo: message.swipe_info?.map((slot) => slot.content),
  }));

  assert.equal(await fixture.runtime.init(), true);
  await settleLifecycle();
  fixture.setCurrent("chat-b");
  fixture.emit("chat-changed", "chat-b");
  fixture.emit("chat-created");
  await sourceSaveReady;

  assert.equal(fixture.context.chatId, "chat-b");
  assert.deepEqual(fixture.owners["chat-b"].messages[0].extra, {
    unrelated_plugin: { keep: true },
  });
  assert.deepEqual(fixture.owners["chat-a"].messages[0].extra.unrelated_plugin, {
    keep: "message",
  });

  releaseSave();
  await settleLifecycle();

  assert.deepEqual(fixture.owners["chat-a"].chatMetadata.bioweave, emptyChat("chat-a"));
  assertClearedFloorRoots(bioWeaveRoots(fixture.owners["chat-a"]));
  assert.deepEqual(
    fixture.owners["chat-a"].messages.map((message) => ({
      mes: message.mes,
      swipes: message.swipes,
      swipeInfo: message.swipe_info?.map((slot) => slot.content),
    })),
    sourceTextBefore,
  );
  assert.deepEqual(fixture.owners["chat-a"].messages[0].extra.unrelated_plugin, {
    keep: "message",
  });
  assert.deepEqual(
    fixture.owners["chat-a"].messages[1].swipe_info.map(
      (slot) => slot.extra.unrelated_plugin,
    ),
    [{ keep: 0 }, { keep: 1 }, { keep: 2 }],
  );
  assert.deepEqual(fixture.context.extensionSettings.bioweave, globalBefore);
  assert.deepEqual(fixture.secretStoreCalls, []);
  assert.equal(fixture.events.filter((event) => event.type === "BIOWEAVE_DATA_CLEARED").length, 1);

  // Reopening A is an ordinary existing-Chat change. It must show the
  // preserved host content with the already-cleared BioWeave namespace.
  fixture.setCurrent("chat-a");
  fixture.emit("chat-changed", "chat-a");
  await settleLifecycle();
  assert.deepEqual(fixture.owners["chat-a"].chatMetadata.bioweave, emptyChat("chat-a"));
  assert.deepEqual(fixture.owners["chat-a"].messages.map((message) => message.mes), [
    "Chat A 普通正文",
    undefined,
  ]);
  assert.deepEqual(
    fixture.owners["chat-a"].messages[1].swipe_info.map((slot) => slot.content),
    ["Swipe A0 正文", "Swipe A1 正文", "Swipe A2 正文"],
  );
  assert.equal(fixture.sourceSaveCalls.length, 1);
});

test("ordinary Chat switches and CHAT_CREATED alone never perform source cleanup", async () => {
  const fixture = makeFixture({ chatIndex: ["chat-a", "chat-c"] });
  assert.equal(await fixture.runtime.init(), true);
  await settleLifecycle();
  const before = cloneValue(fixture.owners["chat-a"]);

  fixture.emit("chat-created");
  await settleLifecycle();
  assert.deepEqual(fixture.owners["chat-a"], before);

  fixture.setCurrent("chat-c");
  fixture.emit("chat-changed", "chat-c");
  await settleLifecycle();
  assert.deepEqual(fixture.owners["chat-a"], before);
  assert.equal(fixture.events.some((event) => event.type === "BIOWEAVE_DATA_CLEARED"), false);
});

test("initialization, reinitialization, and character switching never become destructive transitions", async () => {
  const fixture = makeFixture({ chatIndex: ["chat-a", "chat-c"] });
  assert.equal(await fixture.runtime.init(), true);
  await settleLifecycle();
  const sourceAfterInit = cloneValue(fixture.owners["chat-a"]);

  fixture.runtime.destroy();
  fixture.runtime = createRuntime({
    adapter: fixture.adapter,
    analyzer: { async analyzeFloor() { return { events: [] }; } },
  });
  fixture.runtime.subscribe((event) => fixture.events.push(event));
  assert.equal(await fixture.runtime.init(), true);
  await settleLifecycle();
  assert.deepEqual(fixture.owners["chat-a"], sourceAfterInit);

  fixture.setCurrent("chat-b", "character-2");
  fixture.emit("chat-changed", "chat-b");
  await settleLifecycle();
  assert.deepEqual(fixture.owners["chat-a"], sourceAfterInit);
  assert.equal(fixture.sourceSaveCalls.length, 0);
  assert.equal(fixture.events.some((event) => event.type === "BIOWEAVE_DATA_CLEARED"), false);
});

test("the Start New Chat transition is one-shot and duplicate creation events do not clear twice", async () => {
  const fixture = makeFixture();
  assert.equal(await fixture.runtime.init(), true);
  await settleLifecycle();
  const sourceBefore = cloneValue(fixture.owners["chat-a"]);

  fixture.setCurrent("chat-b");
  fixture.emit("chat-changed", "chat-b");
  fixture.emit("chat-created", "chat-b");
  await settleLifecycle();
  fixture.emit("chat-created", "chat-b");
  await settleLifecycle();

  assert.deepEqual(fixture.owners["chat-a"].chatMetadata.bioweave, emptyChat("chat-a"));
  assert.equal(fixture.sourceSaveCalls.filter((chatId) => chatId === "chat-a").length, 1);
  assert.equal(fixture.events.filter((event) => event.type === "BIOWEAVE_DATA_CLEARED").length, 1);
});

test("missing pre-boundary Chat index fails closed for source cleanup", async () => {
  const fixture = makeFixture({ chatIndex: null });
  assert.equal(await fixture.runtime.init(), true);
  await settleLifecycle();
  const sourceBefore = cloneValue(fixture.owners["chat-a"]);

  fixture.setCurrent("chat-b");
  fixture.emit("chat-changed", "chat-b");
  fixture.emit("chat-created", "chat-b");
  await settleLifecycle();

  assert.deepEqual(fixture.owners["chat-a"], sourceBefore);
  assert.equal(fixture.sourceSaveCalls.length, 0);
  assert.equal(fixture.events.some((event) => event.type === "BIOWEAVE_DATA_CLEARED"), false);
});

test("an explicit non-fresh target rejects the destructive transition", async () => {
  const fixture = makeFixture();
  fixture.adapter.isFreshChat = () => false;
  assert.equal(await fixture.runtime.init(), true);
  await settleLifecycle();
  const sourceBefore = cloneValue(fixture.owners["chat-a"]);

  fixture.setCurrent("chat-b");
  fixture.emit("chat-changed", "chat-b");
  fixture.emit("chat-created", "chat-b");
  await settleLifecycle();

  assert.deepEqual(fixture.owners["chat-a"], sourceBefore);
  assert.equal(fixture.sourceSaveCalls.length, 0);
  assert.equal(fixture.events.some((event) => event.type === "BIOWEAVE_DATA_CLEARED"), false);
});

test("a Start New Chat transition fails closed if the active character changes before creation confirmation", async () => {
  const fixture = makeFixture();
  assert.equal(await fixture.runtime.init(), true);
  await settleLifecycle();
  const sourceBefore = cloneValue(fixture.owners["chat-a"]);

  fixture.setCurrent("chat-b");
  fixture.emit("chat-changed", "chat-b");
  fixture.adapter.getChatOwnerIdentity = () => ({
    characterId: "character-2",
    groupId: null,
  });
  fixture.emit("chat-created", "chat-b");
  await settleLifecycle();

  assert.deepEqual(fixture.owners["chat-a"], sourceBefore);
  assert.equal(fixture.sourceSaveCalls.length, 0);
  assert.equal(fixture.events.some((event) => event.type === "BIOWEAVE_DATA_CLEARED"), false);
});

test("a character switch fails closed, and a late analysis response cannot revive source A", async () => {
  let resolveAnalysis;
  const analysis = new Promise((resolve) => {
    resolveAnalysis = resolve;
  });
  const fixture = makeFixture();
  fixture.runtime.destroy();
  const runtime = createRuntime({
    adapter: fixture.adapter,
    analyzer: { analyzeFloor: () => analysis },
  });
  fixture.runtime = runtime;
  runtime.subscribe((event) => fixture.events.push(event));
  assert.equal(await runtime.init(), true);
  await settleLifecycle();

  const pendingAnalysis = runtime.refreshCurrentFloorAnalysis();
  const safePendingAnalysis = pendingAnalysis.catch(() => null);
  fixture.setCurrent("chat-b", "character-2");
  fixture.emit("chat-changed", "chat-b");
  await settleLifecycle();
  resolveAnalysis({ events: [] });
  await safePendingAnalysis;
  await settleLifecycle();

  assert.equal(
    Object.hasOwn(fixture.owners["chat-a"].chatMetadata.bioweave, "character_profiles"),
    false,
  );
  assert.equal(fixture.events.some((event) => event.type === "BIOWEAVE_DATA_CLEARED"), false);
});

test("a pending source-A analysis cannot revive A after Start New Chat cleanup", async () => {
  let resolveAnalysis;
  const analysis = new Promise((resolve) => {
    resolveAnalysis = resolve;
  });
  const fixture = makeFixture({
    analyzer: { analyzeFloor: () => analysis },
  });
  assert.equal(await fixture.runtime.init(), true);
  await settleLifecycle();

  const pending = fixture.runtime.refreshCurrentFloorAnalysis().catch(() => null);
  fixture.setCurrent("chat-b");
  fixture.emit("chat-changed", "chat-b");
  fixture.emit("chat-created", "chat-b");
  await settleLifecycle();
  resolveAnalysis({ events: [] });
  await pending;
  await settleLifecycle();

  assert.deepEqual(fixture.owners["chat-a"].chatMetadata.bioweave, emptyChat("chat-a"));
  assertClearedFloorRoots(bioWeaveRoots(fixture.owners["chat-a"]));
  assert.deepEqual(fixture.owners["chat-b"].chatMetadata, {
    unrelated_plugin_metadata: { keep: true },
  });
  assert.equal(fixture.owners["chat-b"].messages[0].extra.bioweave, undefined);
});

test("a confirmed source-A persistence failure is surfaced without touching Chat B", async () => {
  const fixture = makeFixture({
    sourceSave: async () => ({ commitState: "failed" }),
  });
  assert.equal(await fixture.runtime.init(), true);
  await settleLifecycle();
  const sourceBefore = cloneValue(fixture.owners["chat-a"]);

  fixture.setCurrent("chat-b");
  fixture.emit("chat-changed", "chat-b");
  await settleLifecycle();
  const bBefore = cloneValue(fixture.owners["chat-b"]);
  fixture.emit("chat-created", "chat-b");
  await settleLifecycle();

  assert.deepEqual(fixture.owners["chat-a"], sourceBefore);
  assert.deepEqual(fixture.owners["chat-b"], bBefore);
  assert.ok(fixture.runtime.getFailedSourceClear("chat-a"));
  assert.equal(fixture.events.some((event) => event.type === "BIOWEAVE_DATA_CLEARED"), false);
});

test("an unknown source save is reported as failure and never redirected to Chat B", async () => {
  const fixture = makeFixture({
    sourceSave: async () => ({ commitState: "unknown" }),
  });
  const globalBefore = cloneValue(fixture.context.extensionSettings.bioweave);
  assert.equal(await fixture.runtime.init(), true);
  await settleLifecycle();
  const sourceBefore = cloneValue(fixture.owners["chat-a"]);
  fixture.setCurrent("chat-b");
  fixture.emit("chat-changed", "chat-b");
  fixture.emit("chat-created");
  await settleLifecycle();

  assert.ok(fixture.runtime.getFailedSourceClear("chat-a"));
  assert.deepEqual(fixture.owners["chat-a"], sourceBefore);
  assert.deepEqual(fixture.context.extensionSettings.bioweave, globalBefore);
  assert.equal(fixture.events.some((event) => event.type === "BIOWEAVE_DATA_CLEARED"), false);
  assert.equal(fixture.owners["chat-b"].messages[0].mes, "chat-b 正文");
});

test("the official ST adapter reads the latest source and merges only the registry plan", async () => {
  const previousFetch = globalThis.fetch;
  const previousST = globalThis.SillyTavern;
  const remote = sourceChat("chat-a");
  remote.header = { boundary_plugin_header: { keep: "latest" } };
  const requests = [];
  const context = {
    chatId: "chat-b",
    characterId: 0,
    groupId: null,
    characters: [{ name: "角色", avatar: "character.png" }],
    getRequestHeaders: () => ({ "X-CSRF-Token": "test-token" }),
  };
  globalThis.SillyTavern = { getContext: () => context };
  globalThis.fetch = async (endpoint, options) => {
    const body = JSON.parse(options.body);
    requests.push({ endpoint, body });
    if (endpoint === "/api/characters/chats") {
      return {
        ok: true,
        async json() {
          return {
            old: { file_name: "chat-a.jsonl" },
            other: { file_name: "chat-c.jsonl" },
          };
        },
      };
    }
    if (endpoint === "/api/chats/get") {
      return {
        ok: true,
        async json() {
          return [
            {
              ...cloneValue(remote.header),
              chat_metadata: cloneValue(remote.chatMetadata),
              user_name: "unused",
              character_name: "unused",
            },
            ...cloneValue(remote.messages),
          ];
        },
      };
    }
    if (endpoint === "/api/chats/save") {
      remote.header = cloneValue(body.chat[0]);
      remote.chatMetadata = cloneValue(body.chat[0].chat_metadata);
      remote.messages = cloneValue(body.chat.slice(1));
      return { ok: true, status: 200 };
    }
    throw new Error(`unexpected endpoint: ${endpoint}`);
  };
  try {
    const adapter = createSillyTavernAdapter();
    assert.equal(adapter.hasSourceOwnerCapability(), true);
    await adapter.refreshChatIndex();
    assert.deepEqual(adapter.getChatIndex(), new Set(["chat-a", "chat-b", "chat-c"]));

    const before = await adapter.readChatOwner({
      chatId: "chat-a",
      characterId: 0,
    });
    const planState = {
      ...before,
      chatMetadata: cloneValue(before.chatMetadata),
      messages: cloneValue(before.messages),
    };
    const plan = buildClearPlan({
      domain: "all",
      owner: { chatId: "chat-a", characterId: 0 },
      chatId: "chat-a",
      state: planState,
      sourceTargeted: true,
    });
    remote.chatMetadata.boundary_plugin_update = { keep: "latest" };
    remote.messages[0].extra.boundary_plugin_update = { keep: "latest" };
    const result = await adapter.saveChatOwner({
      owner: { chatId: "chat-a", characterId: 0 },
      plan,
      state: planState,
      expectedRevision: before.revision,
    });

    assert.equal(result.commitState, "confirmed");
    assert.equal(result.mergeMode, "latest-source");
    assert.equal(requests.at(-1).endpoint, "/api/chats/save");
    assert.deepEqual(remote.chatMetadata.bioweave, emptyChat("chat-a"));
    assertClearedFloorRoots(bioWeaveRoots(remote));
    assert.equal(remote.messages[0].mes, "Chat A 普通正文");
    assert.deepEqual(remote.chatMetadata.boundary_plugin_update, { keep: "latest" });
    assert.deepEqual(remote.messages[0].extra.boundary_plugin_update, { keep: "latest" });
    assert.deepEqual(remote.header.boundary_plugin_header, { keep: "latest" });
    assert.deepEqual(remote.messages[1].swipes, [
      "Swipe A0 正文",
      "Swipe A1 正文",
      "Swipe A2 正文",
    ]);
    assert.deepEqual(remote.messages[1].swipe_info.map((slot) => slot.content), [
      "Swipe A0 正文",
      "Swipe A1 正文",
      "Swipe A2 正文",
    ]);
    assert.equal(requests.at(-1).body.ch_name, "角色");
    assert.equal(requests.at(-1).body.file_name, "chat-a");
    assert.equal(requests.at(-1).body.avatar_url, "character.png");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousST === undefined) delete globalThis.SillyTavern;
    else globalThis.SillyTavern = previousST;
  }
});
