import test from "node:test";
import assert from "node:assert/strict";
import { createChatBoundary, STALE_CHAT } from "../runtime/chat.js";
import { createRuntime, createSillyTavernAdapter, resolveAssignedApiProfile } from "../runtime/events.js";
import { floorVersion } from "../runtime/floor.js";
import { createStore } from "../storage/store.js";
import { createFloorPersistenceCoordinator } from "../storage/floor-persistence-coordinator.js";
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

test("storyline and event analysis resolve their own task assignments", () => {
  const profiles = {
    event: { profile_id: "event-profile" },
    projection: { profile_id: "projection-profile" },
  };
  const profileStore = {getProfile: id => profiles[id] ?? null};
  const settings = {
    api_source: "bioweave",
    default_profile_id: "event",
    assignments: {event_analysis: "event", projection: "projection"},
  };
  assert.equal(resolveAssignedApiProfile({settings, profileStore, assignmentKey: "event_analysis"}), profiles.event);
  assert.equal(resolveAssignedApiProfile({settings, profileStore, assignmentKey: "projection"}), profiles.projection);
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
    const initTrace = runtime.getPersistenceTrace().sequence;
    assert.equal(initTrace.some(item => item.stage === "RUNTIME_INIT_STARTED"), true);
    assert.equal(initTrace.some(item => item.stage === "RUNTIME_INIT_SETTLED" && item.status === "succeeded"), true);
    assert.equal(initTrace.some(item => item.stage === "RUNTIME_INIT_PHASE_SETTLED" && item.phase === "projection_context"), true);
    assert.doesNotThrow(() => runtime.destroy());
  }
});

test("Runtime init keeps fail-open follow-up phases after chat index and Floor preflight failures", async () => {
  const chatIndexFailureAdapter = createAdapter();
  let chatIndexReadCount = 0;
  chatIndexFailureAdapter.refreshChatIndex = async () => {
    throw Object.assign(new Error("CHAT_INDEX_TEMPORARY"), {code: "CHAT_INDEX_TEMPORARY"});
  };
  chatIndexFailureAdapter.getChatIndex = () => {
    chatIndexReadCount += 1;
    return ["chat-a"];
  };
  const ownerRuntime = createRuntime({adapter: chatIndexFailureAdapter});
  assert.equal(await ownerRuntime.init(), true);
  assert.ok(chatIndexReadCount > 0, "refreshActiveOwner should still read the chat index after fail-open refresh");
  const ownerPhase = ownerRuntime.getPersistenceTrace().sequence.find(item =>
    item.stage === "RUNTIME_INIT_PHASE_SETTLED" && item.phase === "chat_owner_preparation",
  );
  assert.equal(ownerPhase.status, "fail_open");
  ownerRuntime.destroy();

  const floorFailureAdapter = createAdapter();
  floorFailureAdapter.getChat = () => {
    throw Object.assign(new Error("FLOOR_VERSION_PREFLIGHT_FAILED"), {analysis_stage: "floor_version"});
  };
  const floorRuntime = createRuntime({adapter: floorFailureAdapter});
  assert.equal(await floorRuntime.init(), true);
  const trace = floorRuntime.getPersistenceTrace().sequence;
  assert.equal(trace.some(item =>
    item.stage === "RUNTIME_INIT_PHASE_SETTLED" &&
    item.phase === "lifecycle_snapshot_scheduler" &&
    item.status === "fail_open",
  ), true);
  assert.equal(trace.some(item =>
    item.stage === "RELOAD_FLOOR_SLOT_AUDIT" && item.reason === "runtime-init",
  ), true);
  floorRuntime.destroy();
});

test("runtime diagnostics records ordinary persistence traces once", () => {
  const runtime = createRuntime({adapter: createAdapter()});
  runtime.recordPersistenceTrace({stage: "DIAGNOSTIC_ONCE"});
  const entries = runtime.getPersistenceTrace().sequence.filter(item => item.stage === "DIAGNOSTIC_ONCE");
  assert.equal(entries.length, 1);
  runtime.destroy();
});

test("SillyTavern adapter uses official extension prompt constants when context omits module exports", () => {
  const calls = [];
  const previous = globalThis.SillyTavern;
  globalThis.SillyTavern = {getContext: () => ({
    setExtensionPrompt: (...args) => calls.push(args),
  })};
  try {
    const adapter = createSillyTavernAdapter();
    const result = adapter.setExtensionPrompt({
      key: "bioweave_projection_context",
      content: "HEALTH_GUIDANCE",
      position: "IN_CHAT",
      depth: 4,
      role: "SYSTEM",
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], ["bioweave_projection_context", "HEALTH_GUIDANCE", 1, 4, false, 0]);
    assert.notEqual(result, false);
  } finally {
    if (previous === undefined) delete globalThis.SillyTavern;
    else globalThis.SillyTavern = previous;
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
  adapter.message.swipes = ["羲和1年3月5日 巳时中"];
  adapter.message.story_time = {
    display: "羲和1年3月5日 巳时中",
    normalized: null,
    day_index: null,
    calendar_id: null,
  };
  adapter.getChat = () => [adapter.message];
  const text = adapter.message.swipes[0];
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
        story_time: {
          display: "羲和1年3月4日 巳时中",
          normalized: null,
          day_index: null,
          calendar_id: null,
        },
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

test("SillyTavern lifecycle listeners do not return plugin promises to the host", async () => {
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
  const context = {
    eventSource: source,
    eventTypes: {GENERATION_STARTED: "started"},
  };
  globalThis.SillyTavern = {getContext: () => context};
  try {
    const adapter = createSillyTavernAdapter();
    let resolveHandler;
    const handlerPromise = new Promise((resolve) => {
      resolveHandler = resolve;
    });
    let received = null;
    const traces = [];
    const unsubscribe = adapter.subscribeLifecycle({
      trace: payload => traces.push(payload),
      handlers: {
        GENERATION_STARTED(payload) {
          received = payload;
          return handlerPromise;
        },
      },
    });
    const result = registered.get("started")({marker: "payload", generationId: "generation-1", generationType: "normal"});
    assert.equal(result, undefined);
    assert.deepEqual(received, {marker: "payload", generationId: "generation-1", generationType: "normal"});
    assert.equal(traces[0].stage, "HOST_LIFECYCLE_LISTENER_RETURNED");
    assert.equal(traces[0].host_event_key, "GENERATION_STARTED");
    assert.equal(traces[0].generation_id, "generation-1");
    assert.equal(traces[0].generation_type, "normal");
    assert.equal(traces[0].host_listener_return_policy, "fire_and_forget");
    assert.equal(traces[0].handler_returned_promise, true);
    assert.equal(traces[0].dispatch_status, "accepted");
    assert.equal(typeof traces[0].host_listener_return_duration_ms, "number");
    assert.equal(traces[0].error_code, null);
    resolveHandler();
    await handlerPromise;
    unsubscribe();
    assert.equal(registered.size, 0);
  } finally {
    delete globalThis.SillyTavern;
  }
});

test("SillyTavern lifecycle boundary remains fail-open for sync failures and trace failures", async () => {
  const registered = new Map();
  const source = {
    on(type, listener) { registered.set(type, listener); },
    removeListener(type, listener) { if (registered.get(type) === listener) registered.delete(type); },
  };
  const context = {eventSource: source, eventTypes: {GENERATION_STARTED: "started"}};
  globalThis.SillyTavern = {getContext: () => context};
  try {
    const adapter = createSillyTavernAdapter();
    const traces = [];
    const unsubscribe = adapter.subscribeLifecycle({
      trace: payload => {
        traces.push(payload);
        throw new Error("TRACE_MUST_BE_FAIL_OPEN");
      },
      handlers: {
        GENERATION_STARTED() {
          throw Object.assign(new Error("SYNC_HANDLER_FAILED"), {code: "SYNC_HANDLER_FAILED"});
        },
      },
    });
    assert.equal(registered.get("started")({}), undefined);
    await Promise.resolve();
    assert.equal(traces[0].dispatch_status, "sync_failed");
    assert.equal(traces[0].error_code, "SYNC_HANDLER_FAILED");
    unsubscribe();
  } finally {
    delete globalThis.SillyTavern;
  }
});

test("SillyTavern lifecycle records async handler rejection after immediate return", async () => {
  const registered = new Map();
  const source = {
    on(type, listener) { registered.set(type, listener); },
    removeListener(type, listener) { if (registered.get(type) === listener) registered.delete(type); },
  };
  const context = {eventSource: source, eventTypes: {GENERATION_STARTED: "started"}};
  globalThis.SillyTavern = {getContext: () => context};
  try {
    const adapter = createSillyTavernAdapter();
    const traces = [];
    const unsubscribe = adapter.subscribeLifecycle({
      trace: payload => traces.push(payload),
      handlers: {
        GENERATION_STARTED() {
          return Promise.reject(Object.assign(new Error("ASYNC_HANDLER_FAILED"), {code: "ASYNC_HANDLER_FAILED"}));
        },
      },
    });
    assert.equal(registered.get("started")({}), undefined);
    assert.equal(traces.some(item => item.stage === "HOST_LIFECYCLE_HANDLER_REJECTED"), false);
    await new Promise(resolve => setImmediate(resolve));
    const rejection = traces.find(item => item.stage === "HOST_LIFECYCLE_HANDLER_REJECTED");
    assert.equal(rejection.host_event_key, "GENERATION_STARTED");
    assert.equal(rejection.host_event_type, "started");
    assert.equal(rejection.error_code, "ASYNC_HANDLER_FAILED");
    assert.equal(traces.filter(item => item.stage === "HOST_LIFECYCLE_LISTENER_RETURNED").length, 1);
    unsubscribe();
  } finally {
    delete globalThis.SillyTavern;
  }
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
    assert.deepEqual(context.chat[0].extra?.bioweave, { marker: "zero" });
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

test("official Chat GET splits response-body read and JSON parse timing without a second read", async () => {
  const context = {
    chatId: "chat-response-timing",
    characterId: "character-1",
    name2: "角色甲",
    avatar_url: "role.png",
  };
  const trace = [];
  let bodyReadCount = 0;
  const previousFetch = globalThis.fetch;
  const previousSillyTavern = globalThis.SillyTavern;
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => {
      bodyReadCount += 1;
      return JSON.stringify([{chat_metadata: {}}, {message_id: "response-timing-floor", floor: 1, role: "assistant", content: "正文"}]);
    },
  });
  globalThis.SillyTavern = {getContext: () => context};
  try {
    const adapter = createSillyTavernAdapter();
    adapter.setPersistenceTraceSink(entry => trace.push(entry));
    const owner = await adapter.readOfficialChatOwner({
      chatId: context.chatId,
      characterId: context.characterId,
      officialIoContext: {
        performance_operation_id: "perf-response-timing",
        floor_transaction_id: "floor-tx-response-timing",
        persistence_kind: "TIMING_INSTANCE",
        io_purpose: "COORDINATOR_READBACK",
      },
      officialIoTrace: entry => trace.push(entry),
    });
    assert.equal(owner.messages.length, 1);
    assert.equal(bodyReadCount, 1);
    const io = trace.find(entry => entry.stage === "OFFICIAL_CHAT_IO");
    assert.equal(io.endpoint_kind, "CHAT_GET");
    assert.equal(io.actual_network_request, true);
    assert.equal(io.io_purpose, "COORDINATOR_READBACK");
    assert.ok(Number.isFinite(io.response_body_read_duration_ms));
    assert.ok(Number.isFinite(io.json_parse_duration_ms));
    assert.ok(Number.isFinite(io.response_parse_duration_ms));
    assert.ok(io.response_parse_duration_ms >= io.response_body_read_duration_ms);
    assert.equal(JSON.stringify(io).includes("response-timing-floor"), false);
    assert.equal(JSON.stringify(io).includes("正文"), false);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousSillyTavern === undefined) delete globalThis.SillyTavern;
    else globalThis.SillyTavern = previousSillyTavern;
  }
});

test("official Chat GET preserves failure semantics and nulls unmeasured split timing", async () => {
  const context = {
    chatId: "chat-response-failure-timing",
    characterId: "character-1",
    name2: "角色甲",
    avatar_url: "role.png",
  };
  const cases = [
    {
      name: "body read",
      response: {ok: true, text: async () => { throw new Error("BODY_READ_FAILED"); }},
      expected: {body: true, json: null},
    },
    {
      name: "json parse",
      response: {ok: true, text: async () => "not-json"},
      expected: {body: true, json: true},
    },
    {
      name: "http error",
      response: {ok: false, status: 503, statusText: "Unavailable"},
      expected: {body: null, json: null},
    },
  ];
  const previousFetch = globalThis.fetch;
  const previousSillyTavern = globalThis.SillyTavern;
  try {
    for (const item of cases) {
      const trace = [];
      globalThis.fetch = async () => item.response;
      globalThis.SillyTavern = {getContext: () => context};
      const adapter = createSillyTavernAdapter();
      adapter.setPersistenceTraceSink(entry => trace.push(entry));
      await assert.rejects(
        adapter.readOfficialChatOwner({
          chatId: context.chatId,
          characterId: context.characterId,
          officialIoContext: {io_purpose: "OWNER_ACQUISITION"},
          officialIoTrace: entry => trace.push(entry),
        }),
        /SOURCE_OWNER_READ_/,
        item.name,
      );
      const io = trace.find(entry => entry.stage === "OFFICIAL_CHAT_IO");
      assert.equal(io.status, "FAILED", item.name);
      assert.equal(Number.isFinite(io.response_body_read_duration_ms), item.expected.body !== null, item.name);
      assert.equal(Number.isFinite(io.json_parse_duration_ms), item.expected.json !== null, item.name);
      assert.ok(io.response_parse_duration_ms === null || Number.isFinite(io.response_parse_duration_ms), item.name);
    }
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
  const officialRequests = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    officialRequests.push(url);
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
      {
        domain: "world",
        chat_id: context.chatId,
        message_id: "trace-floor",
        swipe_id: 0,
        attempt: 1,
        trigger: "auto-full",
        performance_operation_id: "perf-official-io",
        floor_transaction_id: "floor-tx-official-io",
        persistence_kind: "TIMING_INSTANCE",
      },
    );
    assert.equal(trace.find(entry => entry.stage === "WORLD_SAVE_PATH_SELECTED")?.path, "official");
    assert.ok(trace.some(entry => entry.stage === "OFFICIAL_GET_BEFORE_SAVE_BEGIN"));
    assert.ok(trace.some(entry => entry.stage === "OFFICIAL_SAVE_BEGIN"));
    assert.equal(trace.find(entry => entry.stage === "WORLD_SLOT_AFTER_READBACK")?.present, true);
    assert.equal(officialRequests.filter(url => url === "/api/chats/get").length, 3);
    assert.equal(officialRequests.filter(url => url === "/api/chats/save").length, 1);
    const ioCalls = trace.filter(entry => entry.stage === "OFFICIAL_CHAT_IO");
    assert.equal(ioCalls.filter(entry => entry.endpoint_kind === "CHAT_GET").length, 3);
    assert.equal(ioCalls.filter(entry => entry.endpoint_kind === "CHAT_SAVE").length, 1);
    assert.equal(new Set(ioCalls.map(entry => entry.io_call_id)).size, 4);
    assert.equal(ioCalls.every(entry => entry.actual_network_request === true), true);
    assert.equal(ioCalls.every(entry => entry.cache_status === "NOT_USED"), true);
    assert.deepEqual(
      ioCalls.filter(entry => entry.endpoint_kind === "CHAT_GET").map(entry => entry.io_purpose),
      ["SAVE_PREWRITE_READ", "SAVE_AUTHORITATIVE_READBACK", "SAVE_FINAL_SLOT_AUDIT"],
    );
    assert.deepEqual(
      trace.filter(entry => entry.stage === "OFFICIAL_FLOOR_EXTRACT").map(entry => entry.io_purpose),
      ["SAVE_PREWRITE_READ", "SAVE_AUTHORITATIVE_READBACK", "SAVE_FINAL_SLOT_AUDIT"],
    );
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousSillyTavern === undefined) delete globalThis.SillyTavern;
    else globalThis.SillyTavern = previousSillyTavern;
  }
});

test("Coordinator write diagnostics count actual official Chat I/O without adding requests", async () => {
  const context = {
    chatId: "chat-coordinator-official-io",
    characterId: "character-1",
    name2: "角色甲",
    avatar_url: "role.png",
    chat: [{message_id: "io-floor", floor: 9, role: "assistant", content: "权威正文", extra: {}}],
  };
  const version = await floorVersion({
    chatId: context.chatId,
    messageId: "io-floor",
    floor: 9,
    swipeId: 0,
    text: "权威正文",
  });
  const initialFloor = {floor_version: version, world_model: {revision: 1}};
  context.chat[0].extra.bioweave = structuredClone(initialFloor);
  context.saveChat = async () => {
    authoritative = [{chat_metadata: {}}, ...structuredClone(context.chat)];
  };
  let authoritative = [
    {chat_metadata: {}},
    structuredClone(context.chat[0]),
  ];
  const requests = [];
  const trace = [];
  const previousFetch = globalThis.fetch;
  const previousSillyTavern = globalThis.SillyTavern;
  globalThis.fetch = async (url, options) => {
    requests.push(url);
    const body = JSON.parse(options.body);
    if (url === "/api/chats/save") authoritative = structuredClone(body.chat);
    return {
      ok: true,
      json: async () => url === "/api/chats/get" ? structuredClone(authoritative) : {},
    };
  };
  globalThis.SillyTavern = {getContext: () => context};
  try {
    const adapter = createSillyTavernAdapter();
    adapter.setPersistenceTraceSink(entry => trace.push(entry));
    const boundary = createChatBoundary(adapter);
    const store = createStore(adapter, boundary);
    const coordinator = createFloorPersistenceCoordinator({
      store,
      resolveCurrentFloorVersion: async () => version,
    });
    const result = await coordinator.commitFloorPatch({
      owner: "world",
      chatId: context.chatId,
      ownerFloor: {message_index: 0, message_id: "io-floor"},
      swipeId: 0,
      floorVersion: version,
      patch: {world_model: {revision: 2}},
      traceContext: {
        performance_operation_id: "perf-full-official-io",
        persistence_kind: "TIMING_INSTANCE",
      },
    });
    assert.equal(result.status, "confirmed");
    assert.equal(requests.filter(url => url === "/api/chats/get").length, 1);
    assert.equal(requests.filter(url => url === "/api/chats/save").length, 0);
    const ioCalls = trace.filter(entry => entry.stage === "OFFICIAL_CHAT_IO");
    assert.equal(ioCalls.filter(entry => entry.endpoint_kind === "CHAT_GET").length, 1);
    assert.equal(ioCalls.filter(entry => entry.endpoint_kind === "CHAT_SAVE").length, 0);
    assert.deepEqual(
      ioCalls.filter(entry => entry.endpoint_kind === "CHAT_GET").map(entry => entry.io_purpose),
      ["SAVE_AUTHORITATIVE_READBACK"],
    );
    assert.equal(new Set(ioCalls.map(entry => entry.io_call_id)).size, 1);

    requests.length = 0;
    trace.length = 0;
    const noOp = await coordinator.commitFloorPatch({
      owner: "world",
      chatId: context.chatId,
      ownerFloor: {message_index: 0, message_id: "io-floor"},
      swipeId: 0,
      floorVersion: version,
      patchResolver: async () => ({__floor_tx_noop: true}),
      traceContext: {
        performance_operation_id: "perf-full-official-io-noop",
        persistence_kind: "TIMING_INSTANCE",
      },
    });
    assert.equal(noOp.status, "noop");
    assert.equal(requests.filter(url => url === "/api/chats/get").length, 0);
    assert.equal(requests.filter(url => url === "/api/chats/save").length, 0);
    assert.deepEqual(
      trace.filter(entry => entry.stage === "OFFICIAL_CHAT_IO").map(entry => entry.io_purpose),
      [],
    );
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousSillyTavern === undefined) delete globalThis.SillyTavern;
    else globalThis.SillyTavern = previousSillyTavern;
  }
});

test("Projection coordinator stops with unknown state after a native host save timeout", async () => {
  const context = {
    chatId: "chat-projection-official-transport",
    characterId: "character-1",
    name1: "用户甲",
    name2: "角色甲",
    avatar_url: "role.png",
    chat: [{
      message_id: "projection-floor",
      floor: 12,
      role: "assistant",
      content: "当前正文",
      extra: {},
    }],
  };
  const version = await floorVersion({
    chatId: context.chatId,
    messageId: "projection-floor",
    floor: 12,
    swipeId: 0,
    text: "当前正文",
  });
  context.chat[0].extra.bioweave = {floor_version: version};
  let hostSaveCount = 0;
  context.saveChat = async () => {
    hostSaveCount += 1;
    await new Promise(() => {});
  };
  let localWriteObserved = false;
  let authoritative = [
    {chat_metadata: {}, user_name: context.name1, character_name: context.name2},
    structuredClone(context.chat[0]),
  ];
  const requests = [];
  const trace = [];
  const previousFetch = globalThis.fetch;
  const previousSillyTavern = globalThis.SillyTavern;
  globalThis.fetch = async (url, options) => {
    requests.push(url);
    const body = JSON.parse(options.body);
    if (url === "/api/chats/save") {
      authoritative = structuredClone(body.chat);
      return {ok: true, json: async () => ({})};
    }
    return {ok: true, json: async () => structuredClone(authoritative)};
  };
  globalThis.SillyTavern = {getContext: () => context};
  try {
    const adapter = createSillyTavernAdapter();
    adapter.setPersistenceTraceSink(entry => trace.push(entry));
    await assert.rejects(
      adapter.saveFloorSlot(
        0,
        0,
        {
          floor_version: version,
          projection_timeline: {
            schema_version: 1,
            creations: [],
            evidence_records: [],
            lifecycle_records: [],
            delivery_records: [],
            observation_records: [],
            triggered_snapshots: [],
            storyline_snapshots: [],
            storyline_delivery_records: [],
          },
        },
        context.chatId,
        version,
        {
          coordinator_transaction: true,
          domain: "projection",
          floor_write_transport: "host_context",
          onLocalWrite: () => { localWriteObserved = true; },
        },
      ),
      error => error?.code === "FLOOR_HOST_SAVE_TIMEOUT" && error?.commitState === "unknown",
    );
    assert.equal(hostSaveCount, 1);
    assert.equal(localWriteObserved, true);
    assert.equal(requests.filter(url => url === "/api/chats/save").length, 0);
    assert.equal(
      trace.find(entry => entry.stage === "BIOWEAVE_FULL_CHAT_SAVE_DISPATCHED")?.floor_write_transport,
      "host_context",
    );
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousSillyTavern === undefined) delete globalThis.SillyTavern;
    else globalThis.SillyTavern = previousSillyTavern;
  }
});

test("Projection native save observes cancellation without an official API write", async () => {
  const context = {
    chatId: "chat-projection-cancelled-fallback",
    characterId: "character-1",
    name1: "用户甲",
    name2: "角色甲",
    avatar_url: "role.png",
    chat: [{message_id: "projection-cancel-floor", floor: 12, role: "assistant", content: "当前正文", extra: {}}],
  };
  const version = await floorVersion({chatId: context.chatId, messageId: "projection-cancel-floor", floor: 12, swipeId: 0, text: "当前正文"});
  context.chat[0].extra.bioweave = {floor_version: version};
  context.saveChat = async () => new Promise(() => {});
  const previousFetch = globalThis.fetch;
  const previousSillyTavern = globalThis.SillyTavern;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push(url);
    if (url === "/api/chats/get") return {ok: true, json: async () => [
      {chat_metadata: {}, user_name: context.name1, character_name: context.name2},
      structuredClone(context.chat[0]),
    ]};
    if (url === "/api/chats/save") await new Promise((_, reject) => {
      options.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), {name: "AbortError"})), {once: true});
    });
    return {ok: true, json: async () => ({})};
  };
  globalThis.SillyTavern = {getContext: () => context};
  const controller = new AbortController();
  try {
    const adapter = createSillyTavernAdapter();
    const pending = adapter.saveFloorSlot(0, 0, {floor_version: version, projection_timeline: {schema_version: 1, creations: [], evidence_records: [], lifecycle_records: [], delivery_records: [], observation_records: [], triggered_snapshots: [], storyline_snapshots: [], storyline_delivery_records: []}}, context.chatId, version, {coordinator_transaction: true, domain: "projection", floor_write_transport: "host_context", signal: controller.signal});
    const assertion = assert.rejects(pending, error => error?.name === "AbortError"
      || error?.code === "FLOOR_PERSISTENCE_CANCELLED"
      || error?.code === "FLOOR_HOST_SAVE_TIMEOUT"
      || error?.cause?.name === "AbortError");
    await new Promise(resolve => setTimeout(resolve, 1050));
    controller.abort();
    await assertion;
    assert.equal(requests.filter(url => url === "/api/chats/save").length, 0);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousSillyTavern === undefined) delete globalThis.SillyTavern;
    else globalThis.SillyTavern = previousSillyTavern;
  }
});

test("Projection coordinator keeps the native host save fast path when it resolves promptly", async () => {
  const context = {
    chatId: "chat-projection-native-transport",
    characterId: "character-1",
    name1: "用户甲",
    name2: "角色甲",
    avatar_url: "role.png",
    chat: [{
      message_id: "projection-native-floor",
      floor: 12,
      role: "assistant",
      content: "当前正文",
      extra: {},
    }],
  };
  const version = await floorVersion({
    chatId: context.chatId,
    messageId: "projection-native-floor",
    floor: 12,
    swipeId: 0,
    text: "当前正文",
  });
  context.chat[0].extra.bioweave = {floor_version: version};
  let hostSaveCount = 0;
  let authoritative = [
    {chat_metadata: {}, user_name: context.name1, character_name: context.name2},
    structuredClone(context.chat[0]),
  ];
  const requests = [];
  const trace = [];
  context.saveChat = async () => {
    hostSaveCount += 1;
    await new Promise(resolve => setTimeout(resolve, 1100));
    authoritative = [
      {chat_metadata: {}, user_name: context.name1, character_name: context.name2},
      structuredClone(context.chat[0]),
    ];
  };
  const previousFetch = globalThis.fetch;
  const previousSillyTavern = globalThis.SillyTavern;
  globalThis.fetch = async (url, options) => {
    requests.push(url);
    const body = JSON.parse(options.body);
    if (url === "/api/chats/save") authoritative = structuredClone(body.chat);
    return {ok: true, json: async () => structuredClone(authoritative)};
  };
  globalThis.SillyTavern = {getContext: () => context};
  try {
    const adapter = createSillyTavernAdapter();
    adapter.setPersistenceTraceSink(entry => trace.push(entry));
    const result = await adapter.saveFloorSlot(
      0,
      0,
      {
        floor_version: version,
        projection_timeline: {
          schema_version: 1,
          creations: [],
          evidence_records: [],
          lifecycle_records: [],
          delivery_records: [],
          observation_records: [],
          triggered_snapshots: [],
          storyline_snapshots: [],
          storyline_delivery_records: [],
        },
      },
      context.chatId,
      version,
      {
        coordinator_transaction: true,
        domain: "projection",
        floor_write_transport: "host_context",
      },
    );
    assert.equal(result.commitState, "confirmed");
    assert.equal(hostSaveCount, 1);
    assert.equal(requests.filter(url => url === "/api/chats/save").length, 0);
    assert.equal(requests.filter(url => url === "/api/chats/get").length, 1);
    assert.equal(
      trace.find(entry => entry.stage === "BIOWEAVE_FULL_CHAT_SAVE_DISPATCHED")?.floor_write_transport,
      "host_context",
    );
    assert.equal(trace.some(entry => entry.stage === "PROJECTION_HOST_SAVE_FALLBACK"), false);
    assert.deepEqual(
      authoritative[1].extra.bioweave.projection_timeline,
      {
        schema_version: 1,
        creations: [],
        evidence_records: [],
        lifecycle_records: [],
        delivery_records: [],
        observation_records: [],
        triggered_snapshots: [],
        storyline_snapshots: [],
        storyline_delivery_records: [],
      },
    );
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousSillyTavern === undefined) delete globalThis.SillyTavern;
    else globalThis.SillyTavern = previousSillyTavern;
  }
});

test("Projection Floor readback confirms the canonical Swipe slot without requiring its mirror", async () => {
  const context = {
    chatId: "chat-projection-swipe-canonical-readback",
    characterId: "character-1",
    name1: "用户甲",
    name2: "角色甲",
    avatar_url: "role.png",
    chat: [{
      message_id: "projection-swipe-canonical-floor",
      floor: 12,
      role: "assistant",
      swipes: ["当前正文"],
      swipe_info: [{extra: {}}],
      swipe_id: 0,
      extra: {},
    }],
  };
  const version = await floorVersion({
    chatId: context.chatId,
    messageId: "projection-swipe-canonical-floor",
    floor: 12,
    swipeId: 0,
    text: "当前正文",
  });
  context.chat[0].swipe_info[0].extra.bioweave = {floor_version: version};
  context.chat[0].extra.bioweave = {floor_version: version};
  let authoritative = [
    {chat_metadata: {}, user_name: context.name1, character_name: context.name2},
    structuredClone(context.chat[0]),
  ];
  let saveCount = 0;
  context.saveChat = async () => {
    saveCount += 1;
    authoritative = [{chat_metadata: {}, user_name: context.name1, character_name: context.name2}, ...structuredClone(context.chat)];
    // The canonical active Swipe slot persisted, while the compatibility
    // mirror is stale. The mirror must not be a second readback fact source.
    authoritative[1].extra.bioweave = {floor_version: version};
  };
  const previousFetch = globalThis.fetch;
  const previousSillyTavern = globalThis.SillyTavern;
  const trace = [];
  globalThis.fetch = async (_url) => ({ok: true, json: async () => structuredClone(authoritative)});
  globalThis.SillyTavern = {getContext: () => context};
  try {
    const adapter = createSillyTavernAdapter();
    adapter.setPersistenceTraceSink(entry => trace.push(entry));
    const result = await adapter.saveFloorSlot(
      0,
      0,
      {
        floor_version: version,
        projection_timeline: {
          schema_version: 1,
          creations: [{projection_id: "canonical-swipe-readback"}],
          evidence_records: [], lifecycle_records: [], delivery_records: [], observation_records: [],
          triggered_snapshots: [], storyline_snapshots: [], storyline_delivery_records: [],
        },
      },
      context.chatId,
      version,
      {coordinator_transaction: true, domain: "projection", floor_write_transport: "host_context"},
    );
    assert.equal(result.commitState, "confirmed");
    assert.equal(saveCount, 1);
    const readback = trace.find(entry => entry.stage === "BIOWEAVE_FULL_CHAT_SAVE_READBACK");
    assert.equal(readback?.slot_readback_match, true);
    assert.equal(readback?.mirror_readback_match, false);
    const afterReadback = trace.find(entry => entry.stage === "ANALYSIS_SLOT_AFTER_READBACK");
    assert.equal(afterReadback?.slot_readback_match, true);
    assert.equal(afterReadback?.mirror_readback_match, false);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousSillyTavern === undefined) delete globalThis.SillyTavern;
    else globalThis.SillyTavern = previousSillyTavern;
  }
});

test("a timed-out native save remains a per-chat barrier before the next Floor write", async () => {
  const context = {
    chatId: "chat-projection-save-barrier",
    characterId: "character-1",
    name1: "用户甲",
    name2: "角色甲",
    avatar_url: "role.png",
    chat: [{message_id: "projection-barrier-floor", floor: 12, role: "assistant", content: "当前正文", extra: {}}],
  };
  const version = await floorVersion({chatId: context.chatId, messageId: "projection-barrier-floor", floor: 12, swipeId: 0, text: "当前正文"});
  context.chat[0].extra.bioweave = {floor_version: version};
  let authoritative = [{chat_metadata: {}, user_name: context.name1, character_name: context.name2}, structuredClone(context.chat[0])];
  let saveCalls = 0;
  let activeSaves = 0;
  let maxActiveSaves = 0;
  context.saveChat = async () => {
    saveCalls += 1;
    activeSaves += 1;
    maxActiveSaves = Math.max(maxActiveSaves, activeSaves);
    await new Promise(resolve => setTimeout(resolve, saveCalls === 1 ? 8050 : 10));
    authoritative = [{chat_metadata: {}, user_name: context.name1, character_name: context.name2}, ...structuredClone(context.chat)];
    activeSaves -= 1;
  };
  const previousFetch = globalThis.fetch;
  const previousSillyTavern = globalThis.SillyTavern;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (_url === "/api/chats/save") authoritative = structuredClone(body.chat);
    return {ok: true, json: async () => structuredClone(authoritative)};
  };
  globalThis.SillyTavern = {getContext: () => context};
  const floorPayload = marker => ({
    floor_version: version,
    projection_timeline: {
      schema_version: 1,
      creations: [{projection_id: marker}],
      evidence_records: [], lifecycle_records: [], delivery_records: [], observation_records: [],
      triggered_snapshots: [], storyline_snapshots: [], storyline_delivery_records: [],
    },
  });
  try {
    const adapter = createSillyTavernAdapter();
    await assert.rejects(
      adapter.saveFloorSlot(0, 0, floorPayload("timed-out-write"), context.chatId, version, {
        coordinator_transaction: true,
        domain: "projection",
        floor_write_transport: "host_context",
      }),
      error => error?.code === "FLOOR_HOST_SAVE_TIMEOUT" && error?.commitState === "unknown",
    );
    const result = await adapter.saveFloorSlot(0, 0, floorPayload("second-write"), context.chatId, version, {
      coordinator_transaction: true,
      domain: "projection",
      floor_write_transport: "host_context",
    });
    assert.equal(result.commitState, "confirmed");
    assert.equal(saveCalls, 2);
    assert.equal(maxActiveSaves, 1);
    assert.equal(authoritative[1].extra.bioweave.projection_timeline.creations[0].projection_id, "second-write");
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousSillyTavern === undefined) delete globalThis.SillyTavern;
    else globalThis.SillyTavern = previousSillyTavern;
  }
});

test("Floor readback retries when the first authoritative GET still has the previous revision", async () => {
  const context = {
    chatId: "chat-projection-readback-retry",
    characterId: "character-1",
    name1: "用户甲",
    name2: "角色甲",
    avatar_url: "role.png",
    chat: [{message_id: "projection-readback-floor", floor: 12, role: "assistant", content: "当前正文", extra: {}}],
  };
  const version = await floorVersion({chatId: context.chatId, messageId: "projection-readback-floor", floor: 12, swipeId: 0, text: "当前正文"});
  context.chat[0].extra.bioweave = {floor_version: version};
  let authoritative = [{chat_metadata: {}, user_name: context.name1, character_name: context.name2}, structuredClone(context.chat[0])];
  let readCount = 0;
  let saveCount = 0;
  context.saveChat = async () => {
    saveCount += 1;
    authoritative = [{chat_metadata: {}, user_name: context.name1, character_name: context.name2}, ...structuredClone(context.chat)];
  };
  const previousFetch = globalThis.fetch;
  const previousSillyTavern = globalThis.SillyTavern;
  globalThis.fetch = async (_url, options) => {
    if (_url === "/api/chats/save") return {ok: true, json: async () => ({})};
    readCount += 1;
    if (readCount <= 2) {
      return {ok: true, json: async () => [{chat_metadata: {}, user_name: context.name1, character_name: context.name2}, {message_id: "projection-readback-floor", floor: 12, role: "assistant", content: "当前正文", extra: {bioweave: {floor_version: version}}}]};
    }
    return {ok: true, json: async () => structuredClone(authoritative)};
  };
  globalThis.SillyTavern = {getContext: () => context};
  try {
    const adapter = createSillyTavernAdapter();
    const trace = [];
    adapter.setPersistenceTraceSink(entry => trace.push(entry));
    const result = await adapter.saveFloorSlot(0, 0, {
      floor_version: version,
      projection_timeline: {
        schema_version: 1,
        creations: [{projection_id: "readback-retry"}],
        evidence_records: [], lifecycle_records: [], delivery_records: [], observation_records: [],
        triggered_snapshots: [], storyline_snapshots: [], storyline_delivery_records: [],
      },
    }, context.chatId, version, {
      coordinator_transaction: true,
      domain: "projection",
      floor_write_transport: "host_context",
    });
    assert.equal(result.commitState, "confirmed");
    assert.equal(readCount, 3);
    assert.equal(saveCount, 2);
    assert.equal(trace.some(entry => entry.stage === "OFFICIAL_GET_AFTER_SAVE_RETRY" && entry.readback_retry_count === 1), true);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousSillyTavern === undefined) delete globalThis.SillyTavern;
    else globalThis.SillyTavern = previousSillyTavern;
  }
});

test("Floor readback convergence retry revalidates the current owner before native save", async () => {
  const context = {
    chatId: "chat-projection-readback-owner-change",
    characterId: "character-1",
    name1: "用户甲",
    name2: "角色甲",
    avatar_url: "role.png",
    chat: [{message_id: "projection-owner-change-floor", floor: 12, role: "assistant", content: "当前正文", extra: {}}],
  };
  const version = await floorVersion({chatId: context.chatId, messageId: "projection-owner-change-floor", floor: 12, swipeId: 0, text: "当前正文"});
  context.chat[0].extra.bioweave = {floor_version: version};
  let authoritative = [{chat_metadata: {}, user_name: context.name1, character_name: context.name2}, structuredClone(context.chat[0])];
  let readCount = 0;
  let saveCount = 0;
  context.saveChat = async () => {
    saveCount += 1;
    authoritative = [{chat_metadata: {}, user_name: context.name1, character_name: context.name2}, ...structuredClone(context.chat)];
  };
  const previousFetch = globalThis.fetch;
  const previousSillyTavern = globalThis.SillyTavern;
  globalThis.fetch = async (_url) => {
    readCount += 1;
    if (readCount === 1) {
      context.chat[0].message_id = "edited-floor-owner";
      return {ok: true, json: async () => [{chat_metadata: {}, user_name: context.name1, character_name: context.name2}, {message_id: "projection-owner-change-floor", floor: 12, role: "assistant", content: "当前正文", extra: {bioweave: {floor_version: version}}}]};
    }
    return {ok: true, json: async () => structuredClone(authoritative)};
  };
  globalThis.SillyTavern = {getContext: () => context};
  try {
    const adapter = createSillyTavernAdapter();
    await assert.rejects(
      adapter.saveFloorSlot(0, 0, {
        floor_version: version,
        projection_timeline: {
          schema_version: 1,
          creations: [{projection_id: "owner-change-retry"}],
          evidence_records: [], lifecycle_records: [], delivery_records: [], observation_records: [],
          triggered_snapshots: [], storyline_snapshots: [], storyline_delivery_records: [],
        },
      }, context.chatId, version, {
        coordinator_transaction: true,
        domain: "projection",
        floor_write_transport: "host_context",
      }),
      error => error?.code === "STALE_FLOOR_VERSION",
    );
    assert.equal(saveCount, 1);
    assert.equal(readCount, 1);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousSillyTavern === undefined) delete globalThis.SillyTavern;
    else globalThis.SillyTavern = previousSillyTavern;
  }
});

test("Coordinator Context-first writes mirror the active Swipe into message extra", async () => {
  const context = {
    chatId: "chat-coordinator-context-swipe",
    characterId: "character-1",
    name2: "角色甲",
    avatar_url: "role.png",
    chat: [{
      message_id: "context-swipe-floor",
      floor: 4,
      role: "assistant",
      mes: "保持正文",
      swipes: ["保持正文", "其他 Swipe"],
      swipe_id: 0,
      extra: {other_extension: {keep: true}},
      swipe_info: [
        {extra: {bioweave: {analysis: {status: "success"}}}},
        {extra: {bioweave: {world_model: {species: [{name: "旧 Swipe"}]}}}},
      ],
    }],
  };
  const version = await floorVersion({
    chatId: context.chatId,
    messageId: "context-swipe-floor",
    floor: 4,
    swipeId: 0,
    text: "保持正文",
  });
  context.chat[0].swipe_info[0].extra.bioweave.floor_version = version;
  context.chat[0].swipe_info[0].extra.bioweave.analysis = {status: "success"};
  let hostSaveCount = 0;
  let authoritative = [{chat_metadata: {}}, structuredClone(context.chat[0])];
  context.saveChat = async () => {
    hostSaveCount += 1;
    authoritative = [{chat_metadata: {}}, ...structuredClone(context.chat)];
  };
  const requests = [];
  const previousFetch = globalThis.fetch;
  const previousSillyTavern = globalThis.SillyTavern;
  globalThis.fetch = async (url, options) => {
    requests.push(url);
    assert.equal(options?.method, "POST");
    return {
      ok: true,
      json: async () => url === "/api/chats/get" ? structuredClone(authoritative) : {},
    };
  };
  globalThis.SillyTavern = {getContext: () => context};
  try {
    const adapter = createSillyTavernAdapter();
    const store = createStore(adapter, createChatBoundary(adapter));
    const coordinator = createFloorPersistenceCoordinator({store});
    const result = await coordinator.commitFloorPatch({
      owner: "world",
      chatId: context.chatId,
      ownerFloor: {message_index: 0, message_id: version.message_id},
      swipeId: 0,
      floorVersion: version,
      patch: {world_model: {species: [{name: "新世界"}]}},
    });

    assert.equal(result.status, "confirmed");
    assert.equal(hostSaveCount, 1);
    assert.equal(requests.filter(url => url === "/api/chats/get").length, 1);
    assert.equal(requests.filter(url => url === "/api/chats/save").length, 0);
    assert.deepEqual(context.chat[0].extra.other_extension, {keep: true});
    assert.deepEqual(
      context.chat[0].extra.bioweave,
      context.chat[0].swipe_info[0].extra.bioweave,
    );
    assert.deepEqual(context.chat[0].swipe_info[0].extra.bioweave.world_model, {species: [{name: "新世界"}]});
    assert.deepEqual(context.chat[0].swipe_info[0].extra.bioweave.analysis, {status: "success"});
    assert.deepEqual(context.chat[0].swipe_info[1].extra.bioweave, {world_model: {species: [{name: "旧 Swipe"}]} });
    assert.equal(context.chat[0].mes, "保持正文");
    assert.deepEqual(authoritative[1].extra.bioweave, authoritative[1].swipe_info[0].extra.bioweave);
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
    return {ok: true, json: async () => [{chat_metadata: {}}, {message_id: "0", floor: 7, role: "assistant", content: "不同正文"}]};
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
      {message_id: "trace-mismatch", floor: 2, role: "assistant", content: "宿主里的另一版正文"},
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
