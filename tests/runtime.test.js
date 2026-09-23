import test from "node:test";
import assert from "node:assert/strict";
import { createChatBoundary, STALE_CHAT } from "../runtime/chat.js";
import { createRuntime, createSillyTavernAdapter } from "../runtime/events.js";
import { floorVersion } from "../runtime/floor.js";
import { createStore } from "../storage/store.js";
import { PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND } from "../core/events.js";

function createAdapter() {
  let chatId = "chat-a";
  let pendingSave = null;
  const metadata = {
    bioweave: { chat_scope: { chat_id: "chat-a" }, marker: "chat-a" },
  };
  const message = { swipes: ["zero", "one"], swipe_info: [{}, {}] };
  return {
    metadata,
    message,
    setChatId(value) {
      chatId = value;
    },
    holdNextChatSave() {
      return new Promise((resolve) => {
        pendingSave = resolve;
      });
    },
    releaseChatSave() {
      pendingSave?.();
      pendingSave = null;
    },
    getChatId() {
      return chatId;
    },
    getChatMetadata() {
      return metadata;
    },
    getMessage(index) {
      return index === 0 ? message : null;
    },
    async saveChatMetadata(key, value, expectedChatId) {
      assert.equal(expectedChatId, chatId);
      if (pendingSave)
        await new Promise((resolve) => {
          const release = pendingSave;
          pendingSave = () => {
            release();
            resolve();
          };
        });
      metadata[key] = value;
    },
    async saveFloorBioWeave(index, swipeId, value, expectedChatId) {
      assert.equal(expectedChatId, chatId);
      if (Array.isArray(message.swipes) || Array.isArray(message.swipe_info)) {
        message.swipe_info ??= [];
        message.swipe_info[swipeId] ??= {};
        message.swipe_info[swipeId].extra ??= {};
        message.swipe_info[swipeId].extra.bioweave = value;
      } else {
        message.extra ??= {};
        message.extra.bioweave = value;
      }
    },
  };
}

test("chat boundary rejects a token after chat switch", () => {
  let chatId = "chat-a";
  const boundary = createChatBoundary({ getChatId: () => chatId });
  const token = boundary.token();
  chatId = "chat-b";
  assert.throws(() => boundary.assert(token), new RegExp(STALE_CHAT));
  assert.equal(boundary.current(), "chat-b");
});

test("Runtime init survives missing or unavailable extension prompt adapters", async () => {
  for (const adapter of [createAdapter(), (() => {
    const value = createAdapter();
    value.setExtensionPrompt = () => {
      const error = new Error("prompt unavailable");
      error.code = "ST_EXTENSION_PROMPT_UNAVAILABLE";
      throw error;
    };
    return value;
  })()]) {
    const runtime = createRuntime({adapter});
    assert.equal(await runtime.init(), true);
    assert.doesNotThrow(() => runtime.destroy());
  }
});

test("Store rejects every BioWeave write targeting a User message", async () => {
  const message = { message_id: "user-only", role: "user", content: "用户正文" };
  const adapter = {
    getChatId: () => "chat-user-floor",
    getMessage: () => message,
    async saveFloorBioWeave() {
      throw new Error("ADAPTER_WRITE_MUST_NOT_BE_REACHED");
    },
  };
  const store = createStore(adapter, createChatBoundary(adapter));
  await assert.rejects(
    store.saveFloor(0, 0, { marker: "forbidden" }),
    /BIOWEAVE_USER_FLOOR_WRITE_FORBIDDEN/,
  );
});

test("Floor ownership isolates each Swipe slot without cross-Swipe fallback", async () => {
  const adapter = createAdapter();
  const store = createStore(adapter, createChatBoundary(adapter));
  await store.saveFloor(0, 0, {
    floor_version: { chat_id: "chat-a" },
    value: "zero",
  });
  await store.saveFloor(0, 1, {
    floor_version: { chat_id: "chat-a" },
    value: "one",
  });
  assert.equal(adapter.message.extra?.bioweave, undefined);
  assert.equal(store.getFloor(0, 0).value, "zero");
  assert.equal(store.getFloor(0, 1).value, "one");
  assert.equal(store.getFloor(0, 2).value, undefined);
});

test("Floor character snapshots round-trip independently per Swipe", async () => {
  const adapter = createAdapter();
  const store = createStore(adapter, createChatBoundary(adapter));
  const entry = (characterId, displayName) => ({
    character_id: characterId,
    display_name: displayName,
    aliases: [],
  });

  await store.saveFloor(0, 0, {
    analysis: { status: "success" },
    character_registry: {
      schema_version: 1,
      entities: { character_a: entry("character_a", "角色甲") },
    },
  });
  await store.saveFloor(0, 1, {
    analysis: { status: "success" },
    character_registry: {
      schema_version: 1,
      entities: { character_b: entry("character_b", "角色乙") },
    },
  });

  assert.deepEqual(store.getFloor(0, 0).character_registry.entities, {
    character_a: entry("character_a", "角色甲"),
  });
  assert.deepEqual(store.getFloor(0, 1).character_registry.entities, {
    character_b: entry("character_b", "角色乙"),
  });
  assert.deepEqual(store.getFloor(0, 2).character_registry, {
    schema_version: 1,
    entities: {},
  });
  assert.equal(adapter.message.extra?.bioweave, undefined);
});

test("Floor storage does not normalize a missing or malformed Registry into an empty snapshot", async () => {
  const adapter = createAdapter();
  const store = createStore(adapter, createChatBoundary(adapter));
  await store.saveFloor(0, 0, {
    analysis: { status: "success" },
  });
  await store.saveFloor(0, 1, {
    analysis: { status: "success" },
    character_registry: { schema_version: 1, entities: [] },
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      store.getFloor(0, 0),
      "character_registry",
    ),
    false,
  );
  assert.deepEqual(store.getFloor(0, 1).character_registry, {
    schema_version: 1,
    entities: [],
  });

  await store.saveFloor(0, 0, {
    analysis: { status: "success" },
    character_registry: {
      schema_version: 1,
      entities: {
        char_000001: {
          display_name: "缺少正式字段",
          aliases: [],
        },
      },
    },
  });
  assert.deepEqual(store.getFloor(0, 0).character_registry, {
    schema_version: 1,
    entities: {
      char_000001: {
        display_name: "缺少正式字段",
        aliases: [],
      },
    },
  });
});

test("active Swipe selects only its Floor and a deleted message contributes no facts", async () => {
  const adapter = createAdapter();
  adapter.message.swipe_id = 0;
  const store = createStore(adapter, createChatBoundary(adapter));
  const versionA = {
    chat_id: "chat-a",
    message_id: 0,
    floor: 1,
    swipe_id: 0,
    content_hash: "hash-a",
    message_version: "v1",
  };
  const versionB = {
    ...versionA,
    swipe_id: 1,
    content_hash: "hash-b",
    message_version: "v2",
  };
  await store.saveFloor(0, 0, {
    analysis: { status: "success", floor_version: versionA },
    events: [{ event_id: "evt-a", source: versionA }],
  });
  await store.saveFloor(0, 1, {
    analysis: { status: "success", floor_version: versionB },
    events: [{ event_id: "evt-b", source: versionB }],
  });

  assert.equal(store.getActiveSwipeId(0), 0);
  assert.deepEqual(
    store.getActiveFloorEvents(0, versionA).map((event) => event.event_id),
    ["evt-a"],
  );
  adapter.message.swipe_id = 1;
  assert.equal(store.getActiveSwipeId(0), 1);
  assert.deepEqual(
    store.getActiveFloorEvents(0, versionB).map((event) => event.event_id),
    ["evt-b"],
  );
  assert.deepEqual(store.getActiveFloorEvents(0, versionA), []);

  adapter.getMessage = () => null;
  assert.equal(store.getActiveFloor(0), null);
  assert.deepEqual(store.getActiveFloorEvents(0, versionB), []);
});

test("deleted active Swipe fails closed without reading or creating its owner slot", async () => {
  const adapter = createAdapter();
  adapter.message.swipe_id = 1;
  delete adapter.message.swipes[1];
  delete adapter.message.swipe_info[1];
  const store = createStore(adapter, createChatBoundary(adapter));

  assert.equal(store.getActiveSwipeId(0), null);
  assert.equal(store.getActiveFloor(0), null);
  await assert.rejects(
    store.saveFloor(0, 1, { marker: "must-not-be-created" }),
    /SWIPE_NOT_FOUND/,
  );
  assert.equal(adapter.message.swipe_info[1], undefined);
});

test("ordinary floor storage uses message extra when no swipe structure exists", async () => {
  const adapter = createAdapter();
  delete adapter.message.swipes;
  delete adapter.message.swipe_info;
  adapter.message.extra = {};
  const store = createStore(adapter, createChatBoundary(adapter));
  await store.saveFloor(0, 0, {
    floor_version: { chat_id: "chat-a" },
    value: "ordinary",
  });
  assert.equal(adapter.message.extra.bioweave.value, "ordinary");
  assert.equal(store.getFloor(0, 0).value, "ordinary");
});

test("chat reads never return another chat metadata", () => {
  const adapter = createAdapter();
  const store = createStore(adapter, createChatBoundary(adapter));
  adapter.setChatId("chat-b");
  assert.deepEqual(store.getChat("chat-a").chat_scope, { chat_id: "chat-a" });
  assert.equal(store.getChat("chat-b").marker, undefined);
});

test("runtime registry refresh scans current Floor snapshots without requesting AI", async () => {
  const adapter = createAdapter();
  adapter.message.swipe_id = 0;
  adapter.message.swipes = ["story"];
  adapter.getChat = () => [adapter.message];
  const text = "story";
  const version = await floorVersion({
    chatId: "chat-a",
    messageId: 0,
    floor: 0,
    swipeId: 0,
    text,
  });
  await createStore(adapter, createChatBoundary(adapter)).saveFloor(0, 0, {
    analysis: { status: "success", floor_version: version },
    events: [
      {
        event_id: "evt-refresh",
        type: "sexual_activity",
        status: "confirmed",
        source: version,
        participants: [
          {
            character_id: "char_000001",
            display_name: "同名",
            event_role: "potential_gestational_subject",
            reproductive_capabilities_used: { can_carry_pregnancy: true },
          },
          {
            character_id: "char_000002",
            display_name: "同名",
            event_role: "potential_conception_source",
            reproductive_capabilities_used: { can_cause_pregnancy: true },
          },
        ],
        pregnancy_relevance: {
          relevant: true,
          possible_conception: true,
          gestational_subject_ids: ["char_000001"],
          counterpart_ids: ["char_000002"],
        },
        source_evidence: [
          {
            kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND,
            text: "actual exposure",
          },
        ],
      },
    ],
    character_registry: {
      schema_version: 1,
      entities: {
        char_000001: {
          character_id: "char_000001",
          display_name: "同名",
          aliases: [],
        },
        char_000002: {
          character_id: "char_000002",
          display_name: "同名",
          aliases: [],
        },
      },
    },
  });
  const runtime = createRuntime({ adapter });
  assert.equal(await runtime.init(), true);
  const registry = await runtime.refreshTrackingRegistry("focused-test");
  assert.equal(
    registry.tracking_subjects["char_000001"].created_from_event_id,
    "evt-refresh",
  );
  assert.deepEqual(registry.character_registry.entities.char_000001, {
    character_id: "char_000001",
    display_name: "同名",
    aliases: [],
  });
  assert.deepEqual(registry.character_registry.entities.char_000002, {
    character_id: "char_000002",
    display_name: "同名",
    aliases: [],
  });
  assert.deepEqual(Object.keys(registry.character_registry.entities).sort(), [
    "char_000001",
    "char_000002",
  ]);
  for (const field of [
    "character_profiles",
    "character_registry",
    "tracking_subjects",
    "tracking_candidates",
    "relationships",
    "index",
    "world_model",
    "world_model_meta",
  ]) assert.equal(Object.hasOwn(adapter.metadata.bioweave, field), false);
});

test("stale async chat save is rejected after chat switch", async () => {
  const adapter = createAdapter();
  adapter.holdNextChatSave();
  const store = createStore(adapter, createChatBoundary(adapter));
  const pending = store.saveChat("chat-a", {
    chat_scope: { chat_id: "chat-a" },
    marker: "old",
  });
  adapter.setChatId("chat-b");
  adapter.releaseChatSave();
  await assert.rejects(pending, new RegExp(STALE_CHAT));
});

test("chat storage removes secret values and global API configuration while preserving references", async () => {
  const adapter = createAdapter();
  const store = createStore(adapter, createChatBoundary(adapter));
  await store.saveChat("chat-a", {
    chat_scope: { chat_id: "chat-a" },
    api_key: "secret",
    nested: {
      apiKey: "nested-secret",
      api_profiles: { profile: { model: "must-not-persist" } },
      api_request_settings: { timeout: 1, retry_count: 0 },
    },
    secret_ref: "ref-1",
    api_profiles: { profile: { model: "must-not-persist" } },
    assignments: { world_analysis: "profile" },
    api_request_settings: { timeout: 1, retry_count: 0 },
  });
  assert.equal(adapter.metadata.bioweave.api_key, undefined);
  assert.equal(adapter.metadata.bioweave.nested.apiKey, undefined);
  assert.equal(adapter.metadata.bioweave.nested.api_profiles, undefined);
  assert.equal(adapter.metadata.bioweave.secret_ref, "ref-1");
  assert.equal(adapter.metadata.bioweave.api_profiles, undefined);
  assert.equal(adapter.metadata.bioweave.assignments, undefined);
  assert.equal(adapter.metadata.bioweave.api_request_settings, undefined);
  assert.equal(
    adapter.metadata.bioweave.nested.api_request_settings,
    undefined,
  );
});

test("SillyTavern global settings rollback keeps the prior profile on save failure", async () => {
  const previous = {
    api_profiles: { old: { profile_id: "old" } },
    assignments: {},
  };
  const context = {
    extensionSettings: { bioweave: previous },
    async saveSettingsDebounced() {
      throw new Error("SAVE_FAILED");
    },
  };
  globalThis.SillyTavern = { getContext: () => context };
  try {
    const adapter = createSillyTavernAdapter();
    await assert.rejects(
      adapter.saveGlobalSettings({
        api_profiles: { next: { profile_id: "next" } },
        assignments: {},
      }),
      /SAVE_FAILED/,
    );
    assert.equal(context.extensionSettings.bioweave, previous);
  } finally {
    delete globalThis.SillyTavern;
  }
});

test("runtime uses official eventTypes and removes listeners on destroy", async () => {
  const registered = new Map();
  const source = {
    on(type, listener) {
      registered.set(type, listener);
    },
    removeListener(type, listener) {
      assert.equal(registered.get(type), listener);
      registered.delete(type);
    },
  };
  const eventTypes = {
    CHAT_CHANGED: "chat",
    MESSAGE_UPDATED: "updated",
    MESSAGE_EDITED: "edited",
    MESSAGE_DELETED: "deleted",
    MESSAGE_SWIPED: "swiped",
    MESSAGE_SWIPE_DELETED: "swipe-deleted",
    MESSAGE_RECEIVED: "received",
    GENERATION_ENDED: "ended",
    GENERATION_STARTED: "started",
    CHARACTER_MESSAGE_RENDERED: "rendered",
  };
  const adapter = {
    getChatId: () => "chat-a",
    getContext: () => ({ eventSource: source, eventTypes }),
  };
  const runtime = createRuntime({ adapter });
  const events = [];
  runtime.subscribe((event) => events.push(event));
  assert.equal(await runtime.init(), true);
  assert.equal(registered.size, 10);
  registered.get("edited")({ message_id: 0 });
  assert.equal(events.at(-1).type, "MESSAGE_EDITED");
  runtime.destroy();
  assert.equal(registered.size, 0);
  assert.equal(await runtime.init(), false);
});

test("SillyTavern adapter writes per-swipe data to the host message", async () => {
  const context = {
    chatId: "chat-a",
    chat: [{ swipes: ["zero", "one"], swipe_info: [{}, {}] }],
    saveChat: async () => {},
  };
  globalThis.SillyTavern = { getContext: () => context };
  try {
    const adapter = createSillyTavernAdapter();
    await adapter.saveFloorBioWeave(0, 0, { marker: "zero" }, "chat-a");
    await adapter.saveFloorBioWeave(0, 1, { marker: "one" }, "chat-a");
    assert.equal(context.chat[0].extra?.bioweave, undefined);
    assert.equal(context.chat[0].swipe_info[0].extra.bioweave.marker, "zero");
    assert.equal(context.chat[0].swipe_info[1].extra.bioweave.marker, "one");
  } finally {
    delete globalThis.SillyTavern;
  }
});

test("undefined host save result is not reported as confirmed", async () => {
  const context = {chatId: "chat-save-state", saveChat: async () => undefined};
  globalThis.SillyTavern = {getContext: () => context};
  try {
    const result = await createSillyTavernAdapter().saveChat({expectedChatId: context.chatId});
    assert.equal(result.commitState, "unknown");
    assert.equal(result.status, "unknown");
  } finally {
    delete globalThis.SillyTavern;
  }
});

test("SillyTavern adapter preserves object-indexed swipe_info storage", async () => {
  const context = {
    chatId: "chat-a",
    chat: [
      {
        swipes: { 0: { content: "zero" }, 1: { content: "one" } },
        swipe_info: {},
      },
    ],
    saveChat: async () => {},
  };
  globalThis.SillyTavern = { getContext: () => context };
  try {
    const adapter = createSillyTavernAdapter();
    await adapter.saveFloorBioWeave(0, 1, { marker: "one" }, "chat-a");
    assert.equal(context.chat[0].extra?.bioweave, undefined);
    assert.equal(context.chat[0].swipe_info[1].extra.bioweave.marker, "one");
  } finally {
    delete globalThis.SillyTavern;
  }
});

test("SillyTavern adapter rejects a deleted Swipe instead of recreating its slot", async () => {
  const context = {
    chatId: "chat-a",
    chat: [{ swipes: ["only"], swipe_info: [{}], swipe_id: 1 }],
    saveChat: async () => {},
  };
  globalThis.SillyTavern = { getContext: () => context };
  try {
    await assert.rejects(
      createSillyTavernAdapter().saveFloorBioWeave(
        0,
        1,
        { marker: "must-not-be-created" },
        "chat-a",
      ),
      /SWIPE_NOT_FOUND/,
    );
    assert.equal(context.chat[0].swipe_info[1], undefined);
  } finally {
    delete globalThis.SillyTavern;
  }
});

test("SillyTavern Floor writes merge the latest authoritative Chat and verify read-back", async () => {
  const context = {
    chatId: "chat-authoritative-floor",
    characterId: "character-1",
    name2: "角色甲",
    avatar_url: "role.png",
    chat: [{ message_id: "message-authoritative-floor", floor: 6, role: "assistant", content: "最新正文" }],
  };
  let authoritative = [
    { chat_metadata: { marker: "latest" } },
    { message_id: "message-authoritative-floor", floor: 6, role: "assistant", content: "最新正文", extra: { host_field: true } },
  ];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.chat) {
      authoritative = structuredClone(body.chat);
      return {ok: true, json: async () => ({})};
    }
    return {ok: true, json: async () => structuredClone(authoritative)};
  };
  const previousSillyTavern = globalThis.SillyTavern;
  globalThis.SillyTavern = {getContext: () => context};
  try {
    const adapter = createSillyTavernAdapter();
    const version = await floorVersion({
      chatId: context.chatId,
      messageId: context.chat[0].message_id,
      floor: 6,
      swipeId: 0,
      text: context.chat[0].content,
    });
    const value = {floor_version: version, world_model: {species: [{name: "人类"}]}};
    const result = await adapter.saveFloorBioWeave(0, 0, value, context.chatId, version);
    assert.equal(result.commitState, "confirmed");
    assert.equal(result.authoritativeReadback, true);
    assert.equal(authoritative[1].extra.host_field, true);
    assert.deepEqual(authoritative[1].extra.bioweave, value);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousSillyTavern === undefined) delete globalThis.SillyTavern;
    else globalThis.SillyTavern = previousSillyTavern;
  }
});

test("SillyTavern Floor persistence trace records official path, read-back, and Swipe 0", async () => {
  const context = {
    chatId: "chat-trace-official",
    characterId: "character-1",
    name2: "角色甲",
    avatar_url: "role.png",
    chat: [{ message_id: "trace-floor", floor: 6, role: "assistant", content: "最新正文" }],
  };
  let authoritative = [
    { chat_metadata: {} },
    { message_id: "trace-floor", floor: 6, role: "assistant", content: "最新正文" },
  ];
  const trace = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.chat) {
      authoritative = structuredClone(body.chat);
      return {ok: true, json: async () => ({})};
    }
    return {ok: true, json: async () => structuredClone(authoritative)};
  };
  const previousSillyTavern = globalThis.SillyTavern;
  globalThis.SillyTavern = {getContext: () => context};
  try {
    const adapter = createSillyTavernAdapter();
    adapter.setPersistenceTraceSink((entry) => trace.push(entry));
    const version = await floorVersion({
      chatId: context.chatId,
      messageId: "trace-floor",
      floor: 6,
      swipeId: 0,
      text: "最新正文",
    });
    await adapter.saveFloorBioWeave(
      0,
      0,
      {floor_version: version, world_model: {species: [{name: "人类"}]}},
      context.chatId,
      version,
      {domain: "world", chat_id: context.chatId, message_id: "trace-floor", swipe_id: 0, attempt: 1, trigger: "auto-full"},
    );
    assert.equal(trace.find(entry => entry.stage === "WORLD_SAVE_PATH_SELECTED")?.path, "official");
    assert.ok(trace.some(entry => entry.stage === "OFFICIAL_GET_BEFORE_SAVE_BEGIN"));
    assert.ok(trace.some(entry => entry.stage === "OFFICIAL_SAVE_BEGIN"));
    assert.equal(trace.find(entry => entry.stage === "WORLD_SLOT_AFTER_READBACK")?.present, true);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousSillyTavern === undefined) delete globalThis.SillyTavern;
    else globalThis.SillyTavern = previousSillyTavern;
  }
});

test("SillyTavern official JSONL response resolves an index-owned Character Floor and Swipe 0", async () => {
  const context = {
    chatId: "chat-official-index-owner",
    characterId: "character-1",
    name2: "角色甲",
    avatar_url: "role.png",
    chat: [{floor: 6, role: "assistant", swipes: ["最新正文"], swipe_info: [{}], swipe_id: 0}],
  };
  let authoritative = [
    {chat_metadata: {}},
    {floor: 6, role: "assistant", swipes: ["最新正文"], swipe_info: [{}], swipe_id: 0},
  ];
  const trace = [];
  const previousFetch = globalThis.fetch;
  const previousSillyTavern = globalThis.SillyTavern;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.chat) {
      authoritative = structuredClone(body.chat);
      return {ok: true, json: async () => ({ok: true})};
    }
    return {ok: true, json: async () => structuredClone(authoritative)};
  };
  globalThis.SillyTavern = {getContext: () => context};
  try {
    const adapter = createSillyTavernAdapter();
    adapter.setPersistenceTraceSink(entry => trace.push(entry));
    const version = await floorVersion({
      chatId: context.chatId,
      messageId: 0,
      floor: 6,
      swipeId: 0,
      text: "最新正文",
    });
    await adapter.saveFloorBioWeave(
      0,
      0,
      {floor_version: version, world_model: {species: [{name: "人类"}]}},
      context.chatId,
      version,
      {domain: "world", chat_id: context.chatId, message_id: 0, swipe_id: 0, attempt: 1, trigger: "auto-full"},
    );
    assert.equal(trace.find(entry => entry.stage === "OFFICIAL_RESPONSE_SHAPE_RESOLVED")?.response_shape, "json_array_jsonl");
    assert.equal(trace.find(entry => entry.stage === "OFFICIAL_MESSAGES_RESOLVED")?.messages_count, 1);
    assert.equal(trace.find(entry => entry.stage === "OFFICIAL_OWNER_MESSAGE_RESOLVED")?.owner_found, true);
    assert.equal(trace.find(entry => entry.stage === "OFFICIAL_OWNER_SWIPE_RESOLVED")?.swipe_found, true);
    assert.equal(trace.some(entry => entry.stage === "OFFICIAL_SAVE_BEGIN"), true);
    assert.equal(trace.find(entry => entry.stage === "WORLD_SLOT_AFTER_READBACK")?.present, true);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousSillyTavern === undefined) delete globalThis.SillyTavern;
    else globalThis.SillyTavern = previousSillyTavern;
  }
});

test("official Swipe 0 creates missing swipe metadata when the Character body owns the active text", async () => {
  const context = {
    chatId: "chat-official-swipe-zero-metadata",
    characterId: "character-1",
    name2: "角色甲",
    avatar_url: "role.png",
    chat: [{floor: 6, role: "assistant", mes: "最新正文", swipes: ["最新正文"], swipe_id: 0}],
  };
  let authoritative = [
    {chat_metadata: {}},
    {floor: 6, role: "assistant", mes: "最新正文", swipes: ["最新正文"], swipe_id: 0},
  ];
  const trace = [];
  const previousFetch = globalThis.fetch;
  const previousSillyTavern = globalThis.SillyTavern;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.chat) {
      authoritative = structuredClone(body.chat);
      return {ok: true, json: async () => ({ok: true})};
    }
    return {ok: true, json: async () => structuredClone(authoritative)};
  };
  globalThis.SillyTavern = {getContext: () => context};
  try {
    const adapter = createSillyTavernAdapter();
    adapter.setPersistenceTraceSink(entry => trace.push(entry));
    const version = await floorVersion({chatId: context.chatId, messageId: 0, floor: 6, swipeId: 0, text: "最新正文"});
    await adapter.saveFloorBioWeave(
      0,
      0,
      {floor_version: version, world_model: {species: [{name: "人类"}]}},
      context.chatId,
      version,
      {domain: "world", chat_id: context.chatId, message_id: 0, swipe_id: 0, attempt: 1, trigger: "reroll"},
    );
    assert.equal(trace.find(entry => entry.stage === "OFFICIAL_OWNER_SWIPE_RESOLVED")?.swipe_found, true);
    assert.equal(trace.find(entry => entry.stage === "OFFICIAL_OWNER_SWIPE_RESOLVED")?.target_swipe_info_found, false);
    assert.equal(trace.some(entry => entry.stage === "OFFICIAL_SAVE_BEGIN"), true);
    assert.deepEqual(authoritative[1].swipe_info[0].extra.bioweave.world_model.species, [{name: "人类"}]);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousSillyTavern === undefined) delete globalThis.SillyTavern;
    else globalThis.SillyTavern = previousSillyTavern;
  }
});

test("official GET to merge failure records the concrete pre-write diagnostic", async () => {
  const context = {
    chatId: "chat-official-prewrite-failure",
    characterId: "character-1",
    name2: "角色甲",
    avatar_url: "role.png",
    chat: [{floor: 6, role: "assistant", content: "正文"}],
  };
  const trace = [];
  const previousFetch = globalThis.fetch;
  const previousSillyTavern = globalThis.SillyTavern;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.chat) throw new Error("SAVE_MUST_NOT_START");
    return {ok: true, json: async () => [{chat_metadata: {}}, {floor: 6, role: "assistant", content: "不同正文"}]};
  };
  globalThis.SillyTavern = {getContext: () => context};
  try {
    const adapter = createSillyTavernAdapter();
    adapter.setPersistenceTraceSink(entry => trace.push(entry));
    const expected = await floorVersion({chatId: context.chatId, messageId: 0, floor: 6, swipeId: 0, text: "正文"});
    await assert.rejects(
      adapter.saveFloorBioWeave(0, 0, {floor_version: expected, world_model: {}}, context.chatId, expected, {
        domain: "world", chat_id: context.chatId, message_id: 0, swipe_id: 0, attempt: 1, trigger: "auto-full",
      }),
      /STALE_FLOOR_VERSION/,
    );
    const failure = trace.find(entry => entry.stage === "OFFICIAL_PREWRITE_FAILED");
    assert.equal(failure?.failure_stage, "official_owner_floor_version_check");
    assert.equal(failure?.error_code, "STALE_FLOOR_VERSION");
    assert.equal(failure?.owner_message_found, true);
    assert.equal(failure?.swipe_id, 0);
    assert.equal(failure?.swipe_found, true);
    assert.equal(trace.some(entry => entry.stage === "OFFICIAL_SAVE_BEGIN"), false);
    assert.equal(trace.some(entry => entry.stage === "WORLD_PERSISTENCE_CONFIRMED"), false);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousSillyTavern === undefined) delete globalThis.SillyTavern;
    else globalThis.SillyTavern = previousSillyTavern;
  }
});

test("SillyTavern Floor persistence trace records fallback reason without secrets", async () => {
  const previousFetch = globalThis.fetch;
  const previousSillyTavern = globalThis.SillyTavern;
  delete globalThis.fetch;
  const context = {
    chatId: "chat-trace-fallback",
    chat: [{message_id: "trace-fallback", floor: 1, role: "assistant", content: "正文"}],
    async saveChat() {},
  };
  globalThis.SillyTavern = {getContext: () => context};
  const trace = [];
  try {
    const adapter = createSillyTavernAdapter();
    adapter.setPersistenceTraceSink((entry) => trace.push(entry));
    await adapter.saveFloorBioWeave(
      0,
      0,
      {floor_version: {chat_id: context.chatId, message_id: "trace-fallback", swipe_id: 0}, world_model: {species: []}},
      context.chatId,
      null,
      {domain: "world", chat_id: context.chatId, message_id: "trace-fallback", swipe_id: 0, attempt: 2, trigger: "auto-full", api_key: "must-not-enter"},
    );
    assert.equal(trace.find(entry => entry.stage === "WORLD_SAVE_PATH_SELECTED")?.path, "context_fallback");
    assert.equal(trace.find(entry => entry.stage === "WORLD_SAVE_PATH_SELECTED")?.reason, "fetch unavailable");
    assert.doesNotMatch(JSON.stringify(trace), /must-not-enter|api_key|authorization/i);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousSillyTavern === undefined) delete globalThis.SillyTavern;
    else globalThis.SillyTavern = previousSillyTavern;
  }
});

test("SillyTavern Floor persistence trace records a Floor Version mismatch before write", async () => {
  const context = {
    chatId: "chat-trace-mismatch",
    characterId: "character-1",
    name2: "角色甲",
    avatar_url: "role.png",
    chat: [{message_id: "trace-mismatch", floor: 1, role: "assistant", content: "正文"}],
  };
  const trace = [];
  const previousFetch = globalThis.fetch;
  const previousSillyTavern = globalThis.SillyTavern;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.chat) return {ok: true, json: async () => ({})};
    return {ok: true, json: async () => [
      {chat_metadata: {}},
      {message_id: "trace-mismatch", floor: 1, role: "assistant", content: "宿主里的另一版正文"},
    ]};
  };
  globalThis.SillyTavern = {getContext: () => context};
  try {
    const adapter = createSillyTavernAdapter();
    adapter.setPersistenceTraceSink((entry) => trace.push(entry));
    const expected = await floorVersion({
      chatId: context.chatId,
      messageId: "trace-mismatch",
      floor: 1,
      swipeId: 0,
      text: "正文",
    });
    await assert.rejects(
      adapter.saveFloorBioWeave(0, 0, {floor_version: expected, world_model: {}}, context.chatId, expected, {
        domain: "world", chat_id: context.chatId, message_id: "trace-mismatch", swipe_id: 0, attempt: 3, trigger: "auto-full",
      }),
      /STALE_FLOOR_VERSION/,
    );
    assert.equal(trace.some(entry => entry.stage === "WORLD_OWNER_VERSION_CHECK" && entry.result === "mismatch"), true);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousSillyTavern === undefined) delete globalThis.SillyTavern;
    else globalThis.SillyTavern = previousSillyTavern;
  }
});

test("official owner convergence saves the current host chat before the Floor write", async () => {
  const context = {
    chatId: "chat-prewrite-convergence",
    characterId: "character-1",
    name2: "角色甲",
    avatar_url: "role.png",
    chat: [{
      message_id: "convergence-floor",
      floor: 6,
      role: "assistant",
      content: "新正文",
    }],
  };
  let authoritative = [
    {chat_metadata: {}},
    {...structuredClone(context.chat[0]), content: "旧正文"},
  ];
  let hostSaveCalls = 0;
  context.saveChat = async () => {
    hostSaveCalls += 1;
    authoritative = [{chat_metadata: {}}, ...structuredClone(context.chat)];
  };
  const previousFetch = globalThis.fetch;
  const previousSillyTavern = globalThis.SillyTavern;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.chat) {
      authoritative = structuredClone(body.chat);
      return {ok: true, json: async () => ({})};
    }
    return {ok: true, json: async () => structuredClone(authoritative)};
  };
  globalThis.SillyTavern = {getContext: () => context};
  try {
    const adapter = createSillyTavernAdapter();
    const trace = [];
    adapter.setPersistenceTraceSink(entry => trace.push(entry));
    const version = await floorVersion({
      chatId: context.chatId,
      messageId: "convergence-floor",
      floor: 6,
      swipeId: 0,
      text: "新正文",
    });
    const value = {
      floor_version: version,
      world_model: {species: [{name: "人类"}]},
    };
    await adapter.saveFloorBioWeave(0, 0, value, context.chatId, version, {
      domain: "world",
      chat_id: context.chatId,
      message_id: "convergence-floor",
      swipe_id: 0,
      trigger: "reroll",
      generation_settled: true,
    });
    assert.equal(hostSaveCalls, 0);
    assert.equal(trace.filter(entry => entry.stage === "HOST_AUTHORITATIVE_SAVE_BEGIN").length, 0);
    assert.equal(trace.filter(entry => entry.stage === "OFFICIAL_SAVE_BEGIN").length, 1);
    assert.equal(authoritative[1].extra.bioweave.world_model.species[0].name, "人类");
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousSillyTavern === undefined) delete globalThis.SillyTavern;
    else globalThis.SillyTavern = previousSillyTavern;
  }
});

test("official Floor writes do not use saveChatConditional as convergence proof", async () => {
  const context = {
    chatId: "chat-host-convergence",
    characterId: "character-1",
    name2: "角色甲",
    avatar_url: "role.png",
    chat: [{message_id: "host-convergence-floor", floor: 6, role: "assistant", mes: "最终正文", swipes: ["最终正文"], swipe_id: 0, swipe_info: [{}]}],
    async saveChat() { throw new Error("HOST_SAVE_MUST_NOT_BE_USED"); },
  };
  let authoritative = [{chat_metadata: {}}, structuredClone(context.chat[0])];
  const previousFetch = globalThis.fetch;
  const previousSillyTavern = globalThis.SillyTavern;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.chat) {
      authoritative = structuredClone(body.chat);
      return {ok: true, json: async () => ({})};
    }
    return {ok: true, json: async () => structuredClone(authoritative)};
  };
  globalThis.SillyTavern = {getContext: () => context};
  try {
    const adapter = createSillyTavernAdapter();
    const version = await floorVersion({chatId: context.chatId, messageId: "host-convergence-floor", floor: 6, swipeId: 0, text: "最终正文"});
    await adapter.saveFloorBioWeave(0, 0, {floor_version: version, world_model: {species: [{name: "人类"}]}}, context.chatId, version, {
      domain: "world", chat_id: context.chatId, message_id: "host-convergence-floor", swipe_id: 0, generation_settled: true,
    });
    assert.equal(authoritative[1].swipe_info[0].extra.bioweave.world_model.species[0].name, "人类");
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousSillyTavern === undefined) delete globalThis.SillyTavern;
    else globalThis.SillyTavern = previousSillyTavern;
  }
});

test("World and Event official writes preserve sibling fields in host and server Swipe 0 slots", async () => {
  const context = {
    chatId: "chat-sibling-preservation",
    characterId: "character-1",
    name2: "角色甲",
    avatar_url: "role.png",
    chat: [{
      message_id: "sibling-floor",
      floor: 6,
      role: "assistant",
      mes: "正文",
      swipes: ["正文"],
      swipe_id: 0,
      swipe_info: [{extra: {
        bioweave: {
          analysis: {status: "success"},
          events: [{id: "event-1"}],
        },
      }}],
    }],
    async saveChat() {
      authoritative = [{chat_metadata: {}}, ...structuredClone(context.chat)];
    },
  };
  let authoritative = [
    {chat_metadata: {}},
    {
      ...structuredClone(context.chat[0]),
      swipe_info: [{extra: {
        floor_version: null,
        bioweave: {
          floor_version: null,
          analysis: {status: "success"},
          events: [{id: "event-1"}],
        },
      }}],
    },
  ];
  const previousFetch = globalThis.fetch;
  const previousSillyTavern = globalThis.SillyTavern;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.chat) {
      authoritative = structuredClone(body.chat);
      return {ok: true, json: async () => ({})};
    }
    return {ok: true, json: async () => structuredClone(authoritative)};
  };
  globalThis.SillyTavern = {getContext: () => context};
  try {
    const adapter = createSillyTavernAdapter();
    const trace = [];
    adapter.setPersistenceTraceSink(entry => trace.push(entry));
    const version = await floorVersion({
      chatId: context.chatId,
      messageId: "sibling-floor",
      floor: 6,
      swipeId: 0,
      text: "正文",
    });
    await adapter.saveFloorBioWeave(
      0,
      0,
      {floor_version: version, world_model: {species: [{name: "人类"}]}, world_model_meta: {source: "world"}},
      context.chatId,
      version,
      {domain: "world", chat_id: context.chatId, message_id: "sibling-floor", swipe_id: 0},
    );
    const worldSlot = context.chat[0].swipe_info[0].extra.bioweave;
    assert.equal(worldSlot.analysis.status, "success");
    await adapter.saveFloorBioWeave(
      0,
      0,
      {
        floor_version: version,
        analysis: {status: "success", source: "event"},
        events: [{id: "event-2"}],
        character_registry: {schema_version: 1, entities: {}},
      },
      context.chatId,
      version,
      {domain: "event", chat_id: context.chatId, message_id: "sibling-floor", swipe_id: 0},
    );
    const slot = authoritative[1].swipe_info[0].extra.bioweave;
    assert.deepEqual(slot.world_model, {species: [{name: "人类"}]});
    assert.deepEqual(slot.events, [{id: "event-2"}]);
    assert.deepEqual(context.chat[0].swipe_info[0].extra.bioweave.world_model, slot.world_model);
    assert.deepEqual(context.chat[0].swipe_info[0].extra.bioweave.events, slot.events);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousSillyTavern === undefined) delete globalThis.SillyTavern;
    else globalThis.SillyTavern = previousSillyTavern;
  }
});

test("SillyTavern adapter persists Chat settings through host metadata for another endpoint", async () => {
  let metadataSaveCount = 0;
  const context = {
    chatId: "chat-a",
    chatMetadata: {},
    async saveMetadata() {
      metadataSaveCount += 1;
    },
  };
  globalThis.SillyTavern = { getContext: () => context };
  try {
    const firstStore = createStore(
      createSillyTavernAdapter(),
      createChatBoundary({
        getChatId: () => context.chatId,
        getChatMetadata: () => context.chatMetadata,
        saveChatMetadata: async (...args) =>
          createSillyTavernAdapter().saveChatMetadata(...args),
      }),
    );
    await firstStore.saveChat("chat-a", {
      chat_scope: { chat_id: "chat-a" },
      settings: {
        recent_story: {
          floor_count: 12,
          regex_user_enabled: true,
          regex_rules: [],
        },
        external_memory: {
          anima: true,
          baobaoshu: false,
          database_memory: false,
        },
      },
    });

    const secondAdapter = createSillyTavernAdapter();
    const secondStore = createStore(
      secondAdapter,
      createChatBoundary(secondAdapter),
    );
    const restored = secondStore.getChat("chat-a");
    assert.equal(restored.settings.recent_story.floor_count, 12);
    assert.equal(restored.settings.recent_story.regex_user_enabled, true);
    assert.equal(restored.settings.external_memory.anima, true);
    assert.equal(metadataSaveCount, 1);
  } finally {
    delete globalThis.SillyTavern;
  }
});
