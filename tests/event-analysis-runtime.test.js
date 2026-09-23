import test from "node:test";
import assert from "node:assert/strict";
import { createRuntime, createSillyTavernAdapter } from "../runtime/events.js";
import { createAnalyzer, normalizeWorldModel } from "../ai/analyzer.js";
import { PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND } from "../core/events.js";
import { buildProjectionRuleId } from "../core/projection-eligibility.js";
import { floorVersion } from "../runtime/floor.js";
import { SILLYTAVERN_CURRENT_API, emptyChat, emptyFloor } from "../storage/schema.js";

function eventResult(eventId = "evt-1", overrides = {}) {
  return {
    event_id: eventId,
    type: "sexual_activity",
    status: "confirmed",
    story_time: {
      display: "第三日",
      normalized: null,
      day_index: null,
      calendar_id: null,
      precision: "unknown",
      confidence: 0.6,
    },
    location: "房间",
    participants: [
      {
        identity_status: "new",
        character_id: null,
        mention_id: `${eventId}-subject`,
        display_name: "Alice",
        event_role: "potential_gestational_subject",
        biological_context: { species: "species-a", biological_type: "type-a" },
        reproductive_capabilities_used: { can_carry_pregnancy: true },
        identity_evidence: [
          { kind: "explicit_distinct_entity", text: "fixture subject" },
        ],
        evidence: [{ kind: "narrative", text: "明确证据" }],
      },
      {
        identity_status: "new",
        character_id: null,
        mention_id: `${eventId}-source`,
        display_name: "Bob",
        event_role: "potential_conception_source",
        biological_context: { species: "species-b", biological_type: "type-b" },
        reproductive_capabilities_used: { can_cause_pregnancy: true },
        identity_evidence: [
          { kind: "explicit_distinct_entity", text: "fixture source" },
        ],
        evidence: [{ kind: "narrative", text: "实际来源证据" }],
      },
    ],
    pregnancy_relevance: {
      relevant: true,
      possible_conception: true,
      gestational_subject_ids: [`${eventId}-subject`],
      counterpart_ids: [`${eventId}-source`],
      confidence: 0.8,
    },
    source_evidence: [
      { kind: "current_floor", text: "当前楼层" },
      {
        kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND,
        text: "实际暴露证据",
      },
    ],
    ...overrides,
  };
}

function createFixture({
  floor = 3,
  messages = null,
  analyzer = null,
  storyTimeDebug = false,
  storyTimeTrace = null,
  characterContextResolver = null,
  rawApiResponse = null,
  saveFloorError = null,
  saveFloorHook = null,
  saveChatMetadataHook = null,
  saveChatMetadataError = null,
  saveChatMetadataErrorAt = 0,
  saveChatResponse = undefined,
  saveChatError = null,
  convergeFloorOwner = async () => ({converged: false, source: "fixture-authoritative-owner"}),
  retryCount = 0,
  notify = null,
} = {}) {
  const listeners = new Map();
  const context = {
    chatId: "chat-runtime",
    chat: messages ?? [
      {
        message_id: "message-stable",
        floor,
        content: "当前剧情",
        role: "assistant",
      },
    ],
    chatMetadata: {},
    extensionSettings: { bioweave: { api_request_settings: { retry_count: retryCount } } },
    eventTypes: {
      CHAT_CHANGED: "chat-changed",
      MESSAGE_UPDATED: "message-updated",
      MESSAGE_EDITED: "message-edited",
      MESSAGE_DELETED: "message-deleted",
      MESSAGE_SWIPED: "message-swiped",
      MESSAGE_SWIPE_DELETED: "message-swipe-deleted",
      MESSAGE_RECEIVED: "message-received",
      GENERATION_ENDED: "generation-ended",
      GENERATION_STOPPED: "generation-stopped",
      GENERATION_CANCELLED: "generation-cancelled",
      GENERATION_STARTED: "generation-started",
      CHARACTER_MESSAGE_RENDERED: "character-message-rendered",
    },
    eventSource: {
      on(type, listener) {
        listeners.set(type, listener);
      },
      removeListener(type, listener) {
        if (listeners.get(type) === listener) listeners.delete(type);
      },
    },
    async saveMetadata() {},
    async saveChat() {
      if (saveChatError) throw new Error(saveChatError);
      return saveChatResponse;
    },
  };
  let saveChatMetadataCalls = 0;
  let saveFloorCalls = 0;
  let convergeFloorOwnerCalls = 0;
  const apiRequests = [];
  const adapter = {
    getContext: () => context,
    getChat: () => context.chat,
    getChatId: () => context.chatId,
    getChatMetadata: () => context.chatMetadata,
    getExtensionSettings: () => context.extensionSettings,
    getGlobalSettings: () => context.extensionSettings.bioweave,
    getMessage: (index) => context.chat[index] ?? null,
    async saveChatMetadata(key, value) {
      saveChatMetadataCalls += 1;
      if (typeof saveChatMetadataHook === "function")
        await saveChatMetadataHook({ call: saveChatMetadataCalls, key, value });
      if (
        saveChatMetadataErrorAt &&
        saveChatMetadataCalls === saveChatMetadataErrorAt
      ) {
        throw new Error(
          saveChatMetadataError ?? "ST_METADATA_STORAGE_UNAVAILABLE",
        );
      }
      if (saveChatMetadataError) throw new Error(saveChatMetadataError);
      context.chatMetadata[key] = structuredClone(value);
    },
    async saveFloorBioWeave(index, swipeId, value) {
      saveFloorCalls += 1;
      if (saveFloorError) throw new Error(saveFloorError);
      if (typeof saveFloorHook === "function")
        await saveFloorHook({ index, swipeId, value });
      const message = context.chat[index];
      if (!message) throw new Error("MESSAGE_NOT_FOUND");
      if (message.swipes || message.swipe_info) {
        message.swipe_info ??= [];
        message.swipe_info[swipeId] ??= {};
        message.swipe_info[swipeId].extra ??= {};
        message.swipe_info[swipeId].extra.bioweave = structuredClone(value);
      } else {
        message.extra ??= {};
        message.extra.bioweave = structuredClone(value);
      }
    },
    ...(typeof convergeFloorOwner === "function"
      ? {
          async convergeFloorOwner(options) {
            convergeFloorOwnerCalls += 1;
            return convergeFloorOwner(options, convergeFloorOwnerCalls);
          },
        }
      : {}),
  };
  if (rawApiResponse !== null) {
    context.chatCompletionSettings = {
      chat_completion_source: "openai",
      model: "fixture-model",
    };
    context.getChatCompletionModel = () => "fixture-model";
    context.ChatCompletionService = {
      async processRequest(request) {
        apiRequests.push(request);
        return typeof rawApiResponse === "function"
          ? rawApiResponse(request, apiRequests.length)
          : rawApiResponse;
      },
    };
  }
  let calls = 0;
  const configuredAnalyzer =
    analyzer ??
    (rawApiResponse !== null
      ? createAnalyzer({
          profileResolver: () => SILLYTAVERN_CURRENT_API,
          contextResolver: () => context,
        })
      : {
          async analyzeFloor() {
            calls += 1;
            return { events: [eventResult(`evt-${calls}`)] };
          },
        });
  const runtimeAnalyzer = {
    ...configuredAnalyzer,
    // Existing Runtime fixtures focus on Character/Event behavior. Their
    // default World result is an explicit empty, validated model so those
    // tests can remain independent from an external World API response.
    analyzeWorldModel:
      analyzer?.analyzeWorldModel ??
      (rawApiResponse !== null
        ? async () => normalizeWorldModel({ schema_version: 1, species: [{ name: "人类", biological_types: [] }] })
        : configuredAnalyzer.analyzeWorldModel ??
          (async () => normalizeWorldModel({ schema_version: 1, species: [{ name: "人类", biological_types: [] }] }))),
    analyzeWorldModelPatch:
      analyzer?.analyzeWorldModelPatch ??
      (rawApiResponse !== null
        ? async () => ({ schema_version: 1, add: {}, update: {} })
        : configuredAnalyzer.analyzeWorldModelPatch ??
          (async () => ({ schema_version: 1, add: {}, update: {} }))),
  };
  const runtime = createRuntime({
    adapter,
    ...(typeof characterContextResolver === "function"
      ? { characterContextResolver }
      : {}),
    analyzer: runtimeAnalyzer,
    notify: notify ?? (() => {}),
    storyTimeDebug,
    storyTimeTrace,
  });
  runtime.store.profileStore.getApiRequestSettings = () => ({
    retry_count: retryCount,
  });
  return {
    runtime,
    adapter,
    context,
    listeners,
    apiRequests,
    calls: () => calls,
    saveChatMetadataCalls: () => saveChatMetadataCalls,
    saveFloorCalls: () => saveFloorCalls,
    convergeFloorOwnerCalls: () => convergeFloorOwnerCalls,
    emit(type, payload) {
      listeners.get(type)?.(payload);
    },
  };
}

test('Runtime updates aliases only in the current Character Floor without re-running analysis', async () => {
  const fixture = createFixture({
    messages: [{ message_id: 'character-floor', floor: 1, content: '当前楼层', role: 'assistant' }],
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({ __messageIndex: true, index: 0 }, { force: true });
  const registry = fixture.runtime.store.getFloor(0, 0).character_registry;
  const characterId = Object.keys(registry.entities)[0];
  const beforeCalls = fixture.calls();

  const identity = await fixture.runtime.getCurrentCharacterIdentity(characterId);
  assert.equal(identity.display_name, 'Alice');
  assert.deepEqual(identity.aliases, []);

  const result = await fixture.runtime.updateCharacterAliases({
    character_id: characterId,
    aliases: [' 如烟 ', '如烟', ''],
  });
  assert.deepEqual(result.character.aliases, ['如烟']);
  assert.equal(fixture.calls(), beforeCalls);
  assert.equal(fixture.runtime.store.getFloor(0, 0).character_registry.entities[characterId].display_name, 'Alice');
  assert.deepEqual(fixture.runtime.store.getFloor(0, 0).character_registry.entities[characterId].aliases, ['如烟']);
  await assert.rejects(
    fixture.runtime.updateCharacterAliases({ character_id: characterId, aliases: ['Bob'] }),
    error => error.code === 'alias_collision',
  );
  fixture.runtime.destroy();
});

function canonicalApiEvent({
  type = "sexual_activity",
  pregnancyRelevance,
  participants,
  subjectId = "character_subject",
  sourceId = "character_source",
} = {}) {
  return {
    event_id: "model-forged-event-id",
    type,
    status: "confirmed",
    story_time: {
      display: "fixture day",
      normalized: null,
      day_index: null,
      calendar_id: null,
      precision: "unknown",
      confidence: null,
    },
    location: "location_fixture",
    participants: participants ?? [
      {
        identity_status: "new",
        character_id: null,
        mention_id: `${subjectId}-mention`,
        display_name: `${subjectId}_display`,
        event_role: "potential_gestational_subject",
        biological_context: {
          species: "species-subject",
          biological_type: "type-subject",
        },
        reproductive_capabilities_used: {
          can_produce_sperm: false,
          can_produce_ova: true,
          can_be_fertilized: true,
        can_fertilize: null,
          can_carry_pregnancy: true,
          can_cause_pregnancy: false,
        },
        identity_evidence: [
          { kind: "explicit_distinct_entity", text: "fixture subject" },
        ],
        evidence: [
          {
            kind: "capability",
            text: "explicit gestational capability fixture evidence",
          },
        ],
      },
      {
        identity_status: "new",
        character_id: null,
        mention_id: `${sourceId}-mention`,
        display_name: `${sourceId}_display`,
        event_role: "potential_conception_source",
        biological_context: {
          species: "species-source",
          biological_type: "type-source",
        },
        reproductive_capabilities_used: {
          can_produce_sperm: true,
          can_produce_ova: false,
          can_be_fertilized: false,
        can_fertilize: null,
          can_carry_pregnancy: false,
          can_cause_pregnancy: true,
        },
        identity_evidence: [
          { kind: "explicit_distinct_entity", text: "fixture source" },
        ],
        evidence: [
          {
            kind: "capability",
            text: "explicit conception-source capability fixture evidence",
          },
        ],
      },
    ],
    pregnancy_relevance: pregnancyRelevance ?? {
      relevant: true,
      possible_conception: true,
      gestational_subject_ids: [`${subjectId}-mention`],
      counterpart_ids: [`${sourceId}-mention`],
      confidence: 0.9,
    },
    source_evidence: [
      {
        kind: "narrative",
        text: "explicit current-floor exposure fixture evidence",
      },
      {
        kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND,
        text: "abstract exposure entered the valid path",
      },
    ],
    source: {
      chat_id: "model-chat",
      message_id: "model-message",
      floor: 999,
      swipe_id: 9,
    },
  };
}

function canonicalApiEventForRegistry(registry, options = {}) {
  const event = canonicalApiEvent(options);
  const entries = Object.values(registry?.entities ?? {});
  event.participants = event.participants.map((participant) => {
    const entry = entries.find(
      (candidate) => candidate.display_name === participant.display_name,
    );
    return entry
      ? {
          ...participant,
          identity_status: "existing",
          character_id: entry.character_id,
        }
      : participant;
  });
  return event;
}

function eventResultForRegistry(registry, eventId = "evt-1", overrides = {}) {
  const event = eventResult(eventId, overrides);
  const entries = Object.values(registry?.entities ?? {});
  event.participants = event.participants.map((participant) => {
    const entry = entries.find(
      (candidate) => candidate.display_name === participant.display_name,
    );
    return entry
      ? {
          ...participant,
          identity_status: "existing",
          character_id: entry.character_id,
        }
      : participant;
  });
  return event;
}

function identityParticipant({
  identityStatus,
  characterId = null,
  mentionId,
  displayName,
  eventRole,
  capabilities,
  aliasCandidate = undefined,
  identityEvidence = undefined,
}) {
  const participant = {
    identity_status: identityStatus,
    character_id: identityStatus === "existing" ? characterId : null,
    mention_id: mentionId,
    display_name: displayName,
    event_role: eventRole,
    biological_context: {
      species: "species-fixture",
      biological_type: "type-fixture",
    },
    reproductive_capabilities_used: {
      can_produce_sperm: null,
      can_produce_ova: null,
      can_be_fertilized: null,
        can_fertilize: null,
      can_carry_pregnancy: null,
      can_cause_pregnancy: null,
      ...capabilities,
    },
    evidence: [
      { kind: "narrative", text: "identity lifecycle fixture evidence" },
    ],
  };
  if (aliasCandidate !== undefined)
    participant.alias_candidate = aliasCandidate;
  if (identityEvidence !== undefined)
    participant.identity_evidence = identityEvidence;
  return participant;
}

function identityLifecycleEvent({
  subject,
  source,
  location = "传灯院",
  subjectReference = subject.mention_id,
  sourceReference = source.mention_id,
} = {}) {
  const result = canonicalApiEvent({
    participants: [subject, source],
    pregnancyRelevance: {
      relevant: true,
      possible_conception: true,
      gestational_subject_ids: [subjectReference],
      counterpart_ids: [sourceReference],
      confidence: 0.9,
    },
  });
  result.location = location;
  return result;
}

function identityEventForCharacters(
  registry,
  subjectName,
  sourceName,
  eventId = "evt-1",
) {
  const knownEntry = (displayName) =>
    Object.values(registry?.entities ?? {}).find(
      (entry) => entry.display_name === displayName,
    );
  const participant = (displayName, eventRole, capabilities, mentionId) => {
    const entry = knownEntry(displayName);
    return identityParticipant({
      identityStatus: entry ? "existing" : "new",
      characterId: entry?.character_id ?? null,
      mentionId,
      displayName,
      eventRole,
      capabilities,
    });
  };
  return identityLifecycleEvent({
    subject: participant(
      subjectName,
      "potential_gestational_subject",
      { can_carry_pregnancy: true },
      `${subjectName}-${eventId}-subject`,
    ),
    source: participant(
      sourceName,
      "potential_conception_source",
      { can_cause_pregnancy: true },
      `${sourceName}-${eventId}-source`,
    ),
  });
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 30));
}

async function withGlobalCrypto(value, callback) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    enumerable: descriptor?.enumerable ?? true,
    value,
  });
  try {
    return await callback();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
    else delete globalThis.crypto;
  }
}

test("manual analysis targets the current Floor and exposes observable status", async () => {
  let input = null;
  const fixture = createFixture({
    analyzer: {
      async analyzeFloor(request) {
        input = request.analysisInput;
        return { events: [eventResult()] };
      },
    },
  });
  await fixture.runtime.init();
  const result = await fixture.runtime.refreshCurrentFloorAnalysis();
  assert.equal(result.status, "success");
  assert.equal(input.current_floor.message_id, "message-stable");
  const status = await fixture.runtime.getCurrentFloorAnalysisStatus();
  assert.equal(status.state, "success");
  assert.equal(status.event_count, 1);
  assert.equal(status.floor_version.message_id, "message-stable");
  const data = await fixture.runtime.collectActiveBusinessData();
  assert.equal(data.active_event_count, 1);
  assert.equal(data.tracking_subject_count, 1);
  assert.equal(data.tracking_decisions[0].eligibility, "eligible");
  fixture.runtime.destroy();
});

test("Character-only current Floor ignores a trailing User message and writes only the Character slot", async () => {
  let input = null;
  const fixture = createFixture({
    messages: [
      { message_id: "user-4", floor: 4, role: "user", content: "上一轮用户叙事" },
      { message_id: "char-5", floor: 5, role: "assistant", content: "角色回复" },
      { message_id: "user-6", floor: 6, role: "user", content: "尾部用户消息" },
    ],
    analyzer: {
      async analyzeFloor(request) {
        input = request.analysisInput;
        return { events: [] };
      },
    },
  });
  fixture.context.chatMetadata.bioweave = {
    chat_scope: { chat_id: "chat-runtime" },
    settings: { recent_story: { enabled: true, floor_count: 4 } },
  };
  await fixture.runtime.init();
  const current = await fixture.runtime.resolveCurrentBioWeaveFloor();
  assert.equal(current.version.message_id, "char-5");
  await fixture.runtime.refreshCurrentFloorAnalysis();
  assert.equal(input.current_floor.message_id, "char-5");
  assert.equal(input.current_floor.narrative, "角色回复");
  assert.deepEqual(input.recent_story.items.map((item) => item.floor), [4, 5]);
  assert.equal(fixture.context.chat[1].extra.bioweave.analysis.status, "success");
  assert.equal(fixture.context.chat[0].extra?.bioweave, undefined);
  assert.equal(fixture.context.chat[2].extra?.bioweave, undefined);
  assert.equal(fixture.context.chat[2].swipe_info?.[0]?.extra?.bioweave, undefined);
  fixture.runtime.destroy();
});

test("a Chat with only User messages returns NO_CHARACTER_FLOOR without AI or persistence", async () => {
  const fixture = createFixture({
    messages: [{ message_id: "user-0", floor: 0, role: "user", content: "只有用户正文" }],
    analyzer: {
      async analyzeFloor() {
        throw new Error("AI_MUST_NOT_BE_CALLED");
      },
    },
  });
  await fixture.runtime.init();
  await assert.rejects(
    fixture.runtime.refreshCurrentFloorAnalysis(),
    /NO_CHARACTER_FLOOR/,
  );
  assert.equal(fixture.calls(), 0);
  assert.equal(fixture.saveFloorCalls(), 0);
  assert.equal(fixture.context.chat[0].extra?.bioweave, undefined);
  assert.equal(fixture.context.chatMetadata.bioweave, undefined);
  fixture.runtime.destroy();
});

test("pregnancy-relevant mechanism facts persist on the owning Floor only", async () => {
  const fixture = createFixture({
    analyzer: {
      async analyzeFloor() {
        return {
          events: [eventResult("evt-medical", {
            type: "medical_event",
            pregnancy_relevance: {
              ...eventResult().pregnancy_relevance,
              possible_conception: false,
              gestational_subject_ids: ["evt-medical-subject"],
              counterpart_ids: ["evt-medical-source"],
              reproductive_mechanism: {
                kind: "world_defined_implant_path",
                label: "直接植入胚胎",
                pathway: "implantation",
                world_model_rule_refs: ["rule-implant-1"],
                evidence: [{ kind: "world_model", text: "世界规则支持直接植入" }],
              },
            },
          })],
        };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const floor = fixture.runtime.store.getFloor(0);
  assert.equal(fixture.context.chatMetadata.biological_events, undefined);
  assert.equal(floor.events[0].type, "medical_event");
  assert.equal(
    floor.events[0].pregnancy_relevance.reproductive_mechanism.kind,
    "world_defined_implant_path",
  );
  assert.equal(fixture.runtime.store.getActiveFloor(0).events.length, 1);
  fixture.runtime.destroy();
});

test("two new mechanism exposures canonicalize on Swipe 0 and rebuild eligible subjects", async () => {
  const messages = [{
    message_id: "message-floor-58",
    floor: 58,
    content: "当前剧情",
    role: "assistant",
    swipes: ["当前剧情"],
    swipe_info: [{}],
    swipe_id: 0,
  }];
  const makeExposure = (eventId, subjectName, sourceName) => {
    const value = eventResult(eventId, {
      type: "medical_event",
      participants: eventResult(eventId).participants.map((participant, index) => ({
        ...participant,
        display_name: index === 0 ? subjectName : sourceName,
      })),
      pregnancy_relevance: {
        ...eventResult(eventId).pregnancy_relevance,
        possible_conception: false,
        reproductive_mechanism: {
          kind: "world_defined_implant_path",
          label: "直接植入胚胎",
          pathway: "implantation",
          world_model_rule_refs: ["rule-implant"],
          evidence: [{ kind: "world_model", text: "明确机制规则" }],
        },
      },
    });
    return value;
  };
  const fixture = createFixture({
    messages,
    analyzer: {
      async analyzeFloor() {
        return {
          events: [
            makeExposure("evt-q", "祁鸢", "觉心"),
            makeExposure("evt-l", "柳如烟", "孙大壮"),
          ],
        };
      },
    },
  });

  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();

  const floor = fixture.runtime.store.getFloor(0, 0);
  assert.equal(fixture.context.chat[0].extra?.bioweave, undefined);
  assert.equal(floor.events.length, 2);
  assert.deepEqual(
    floor.events.map((item) => item.participants.map((participant) => participant.character_id)),
    [["char_000001", "char_000002"], ["char_000003", "char_000004"]],
  );
  assert.deepEqual(
    floor.events.map((item) => item.pregnancy_relevance.gestational_subject_ids),
    [["char_000001"], ["char_000003"]],
  );
  assert.deepEqual(
    floor.events.map((item) => item.pregnancy_relevance.counterpart_ids),
    [["char_000002"], ["char_000004"]],
  );
  assert.equal(fixture.context.chatMetadata.bioweave?.events, undefined);
  assert.equal(fixture.context.chatMetadata.bioweave?.tracking_subjects, undefined);

  const data = await fixture.runtime.collectActiveBusinessData();
  assert.deepEqual(Object.keys(data.tracking_subjects).sort(), [
    "char_000001",
    "char_000003",
  ]);
  assert.deepEqual(data.tracking_candidates, {});
  assert.deepEqual(Object.keys(data.character_profiles).sort(), [
    "char_000001",
    "char_000003",
  ]);
  assert.equal(data.tracking_subjects.char_000002, undefined);
  assert.equal(data.tracking_subjects.char_000004, undefined);

  fixture.runtime.destroy();
});

test("Runtime owns canonical Event IDs and Floor provenance", async () => {
  const fixture = createFixture({
    analyzer: {
      async analyzeFloor() {
        const {
          event_id: ignoredEventId,
          source: ignoredSource,
          ...facts
        } = eventResult("model-forged-id");
        return {
          events: [
            {
              ...facts,
              event_id: ignoredEventId,
              source: {
                chat_id: "model-chat",
                message_id: "model-message",
                floor: 999,
                swipe_id: 9,
              },
            },
          ],
        };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const first = (await fixture.runtime.getCurrentFloorEvents())[0];
  assert.notEqual(first.event_id, "model-forged-id");
  assert.deepEqual(first.source, {
    chat_id: "chat-runtime",
    message_id: "message-stable",
    floor: 3,
    swipe_id: 0,
    content_hash: first.source.content_hash,
    message_version: first.source.message_version,
  });
  const firstId = first.event_id;
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const second = (await fixture.runtime.getCurrentFloorEvents())[0];
  assert.equal(second.event_id, firstId);
  const registry = await fixture.runtime.getTrackingRegistry();
  assert.deepEqual(registry.tracking_subjects["char_000001"].exposure_event_ids, [
    firstId,
  ]);
  await fixture.runtime.updateEvent(firstId, { location: "updated-location" });
  assert.equal(
    (await fixture.runtime.getCurrentFloorEvents())[0].location,
    "updated-location",
  );
  await fixture.runtime.deleteEvent(firstId);
  assert.deepEqual(await fixture.runtime.getCurrentFloorEvents(), []);
  fixture.runtime.destroy();
});

test(
  "Runtime registers a new identity before pregnancy closure validation and reuses it on the next Floor",
  { concurrency: false },
  async () => {
    let analysisCount = 0;
    let subjectId = null;
    let sourceId = null;
    const inputRegistries = [];
    const fixture = createFixture({
      messages: [
        {
          message_id: "identity-first-floor",
          floor: 1,
          content: "首次出现人物的楼层",
          role: "assistant",
        },
        {
          message_id: "identity-second-floor",
          floor: 2,
          content: "后续复用人物的楼层",
          role: "assistant",
        },
      ],
      analyzer: {
        async analyzeFloor({ analysisInput }) {
          inputRegistries.push(
            structuredClone(analysisInput.character_registry),
          );
          analysisCount += 1;
          if (analysisCount === 1) {
            return {
              events: [
                identityLifecycleEvent({
                  subject: identityParticipant({
                    identityStatus: "new",
                    mentionId: "subject-first",
                    displayName: "苏晚",
                    eventRole: "potential_gestational_subject",
                    capabilities: { can_carry_pregnancy: true },
                    aliasCandidate: {
                      value: "晚儿",
                      kind: "nickname",
                      confidence: 0.97,
                    },
                    identityEvidence: [
                      {
                        kind: "explicit_alias",
                        text: "她名叫苏晚，朋友都叫她晚儿。",
                      },
                    ],
                  }),
                  source: identityParticipant({
                    identityStatus: "new",
                    mentionId: "source-first",
                    displayName: "陆行",
                    eventRole: "potential_conception_source",
                    capabilities: { can_cause_pregnancy: true },
                  }),
                }),
              ],
            };
          }
          return {
            events: [
              identityLifecycleEvent({
                subject: identityParticipant({
                  identityStatus: "existing",
                  characterId: subjectId,
                  mentionId: "subject-second",
                  displayName: "晚儿",
                  eventRole: "potential_gestational_subject",
                  capabilities: { can_carry_pregnancy: true },
                }),
                source: identityParticipant({
                  identityStatus: "existing",
                  characterId: sourceId,
                  mentionId: "source-second",
                  displayName: "陆行",
                  eventRole: "potential_conception_source",
                  capabilities: { can_cause_pregnancy: true },
                }),
              }),
            ],
          };
        },
      },
    });

    await fixture.runtime.init();
    await settle();
    await fixture.runtime.analyzeFloor(
      { __messageIndex: true, index: 0 },
      { force: true },
    );

    const firstEvent = fixture.runtime.store.getFloor(0).events[0];
    subjectId = firstEvent.participants[0].character_id;
    sourceId = firstEvent.participants[1].character_id;
    const firstRegistry = (await fixture.runtime.getTrackingRegistry())
      .character_registry;
    assert.deepEqual(inputRegistries[0], {
      schema_version: 1,
      entities: {},
    });
    assert.deepEqual(firstEvent.pregnancy_relevance, {
      relevant: true,
      possible_conception: true,
      gestational_subject_ids: [subjectId],
      counterpart_ids: [sourceId],
      confidence: 0.9,
      reproductive_mechanism: {
        kind: null,
        label: null,
        pathway: null,
        world_model_rule_refs: [],
        evidence: [],
      },
    });
    assert.equal(firstEvent.location, "传灯院");
    assert.equal("mention_id" in firstEvent.participants[0], false);
    assert.deepEqual(firstRegistry.entities[subjectId], {
      character_id: subjectId,
      display_name: "苏晚",
      aliases: ["晚儿"],
    });
    assert.deepEqual(firstRegistry.entities[sourceId], {
      character_id: sourceId,
      display_name: "陆行",
      aliases: [],
    });
    assert.deepEqual(
      fixture.runtime.store.getFloor(0).character_registry,
      firstRegistry,
    );

    await fixture.runtime.analyzeFloor(
      { __messageIndex: true, index: 1 },
      { force: true },
    );
    const secondEvent = (await fixture.runtime.getCurrentFloorEvents())[0];
    const secondRegistry = (await fixture.runtime.getTrackingRegistry())
      .character_registry;
    assert.equal(analysisCount, 2);
    assert.equal(inputRegistries[1].entities[subjectId].display_name, "苏晚");
    assert.deepEqual(inputRegistries[1].entities[subjectId].aliases, ["晚儿"]);
    assert.deepEqual(
      secondEvent.participants.map((participant) => participant.character_id),
      [subjectId, sourceId],
    );
    assert.equal(Object.keys(secondRegistry.entities).length, 2);
    assert.deepEqual(
      fixture.runtime.store.getFloor(1).character_registry,
      secondRegistry,
    );
    fixture.runtime.destroy();
  },
);

test("unresolved identity aborts the whole Event batch without registry or Floor pollution", async () => {
  const fixture = createFixture({
    analyzer: {
      async analyzeFloor() {
        return {
          events: [
            identityLifecycleEvent({
              subject: identityParticipant({
                identityStatus: "unresolved",
                mentionId: "unresolved-subject",
                displayName: "沈姑娘",
                eventRole: "potential_gestational_subject",
              }),
              source: identityParticipant({
                identityStatus: "new",
                mentionId: "new-source",
                displayName: "未知来源",
                eventRole: "potential_conception_source",
                capabilities: { can_cause_pregnancy: true },
              }),
            }),
          ],
        };
      },
    },
  });
  await fixture.runtime.init();
  await assert.rejects(
    fixture.runtime.refreshCurrentFloorAnalysis(),
    (error) =>
      error?.code === "EVENT_IDENTITY_RESOLUTION_FAILED" &&
      error?.analysis_stage === "identity_resolution",
  );
  const status = await fixture.runtime.getCurrentFloorAnalysisStatus();
  assert.equal(status.error_stage, "identity_resolution");
  assert.deepEqual(await fixture.runtime.getCurrentFloorEvents(), []);
  assert.deepEqual(
    (await fixture.runtime.getTrackingRegistry()).character_registry,
    { schema_version: 1, entities: {} },
  );
  fixture.runtime.destroy();
});

test("strict Runtime rejects a hallucinated existing character ID", async () => {
  const forged = canonicalApiEvent();
  forged.participants = forged.participants.map((participant, index) => ({
    ...participant,
    identity_status: "existing",
    mention_id: `forged-${index}`,
    character_id: index === 0 ? "shen_qi_yuan" : "other-forged-id",
  }));
  const fixture = createFixture({
    analyzer: {
      async analyzeFloor() {
        return { events: [forged] };
      },
    },
  });
  await fixture.runtime.init();
  await assert.rejects(
    fixture.runtime.refreshCurrentFloorAnalysis(),
    (error) =>
      error?.code === "EVENT_IDENTITY_RESOLUTION_FAILED" &&
      error?.diagnostic_code === "unknown_existing_character_id",
  );
  assert.deepEqual(await fixture.runtime.getCurrentFloorEvents(), []);
  fixture.runtime.destroy();
});

test("generic API response with legacy source reaches Floor save, Registry, and business DTOs", async () => {
  const eventA = canonicalApiEvent();
  const fixture = createFixture({
    rawApiResponse: JSON.stringify({
      schema_version: 1,
      events: [eventA],
      source: {
        chat_id: "legacy-chat",
        message_id: "legacy-message",
        floor: 999,
      },
    }),
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();

  assert.equal(fixture.apiRequests.length, 1);
  const events = await fixture.runtime.getCurrentFloorEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "sexual_activity");
  assert.equal(events[0].participants.length, 2);
  assert.equal(events[0].participants[1].character_id, "char_000002");
  assert.equal(
    events[0].participants[1].reproductive_capabilities_used
      .can_carry_pregnancy,
    false,
  );
  assert.notEqual(events[0].event_id, "model-forged-event-id");
  assert.equal(events[0].source.chat_id, "chat-runtime");
  assert.equal(events[0].source.message_id, "message-stable");
  assert.equal(events[0].source.floor, 3);

  const data = await fixture.runtime.collectActiveBusinessData();
  assert.equal(data.active_event_count, 1);
  assert.equal(data.tracking_subject_count, 1);
  assert.deepEqual(
    data.tracking_subjects.char_000001.exposure_event_ids,
    [events[0].event_id],
  );
  assert.equal(data.tracking_subjects.char_000002, undefined);
  fixture.runtime.destroy();
});

test(
  "successful analysis saves the complete identity result only to Floor",
  { concurrency: false },
  async () => {
    const saveOrder = [];
    const fixture = createFixture({
      saveFloorHook: async ({ value }) => {
        saveOrder.push({ kind: "floor", value: structuredClone(value) });
      },
      analyzer: {
        async analyzeFloor({ analysisInput }) {
          return {
            events: [
              identityEventForCharacters(
                analysisInput.character_registry,
                "原子角色",
                "原子来源",
                "atomic-save",
              ),
            ],
          };
        },
      },
    });

    await fixture.runtime.init();
    await fixture.runtime.refreshTrackingRegistry("before-analysis");
    saveOrder.length = 0;

    await fixture.runtime.refreshCurrentFloorAnalysis();

    assert.deepEqual(
      saveOrder.map(({ kind }) => kind),
      ["floor", "floor"],
    );
    const eventSave = saveOrder.at(-1).value;
    assert.equal(eventSave.analysis.status, "success");
    assert.equal(eventSave.events.length, 1);
    assert.equal(Object.hasOwn(fixture.context.chatMetadata.bioweave ?? {}, "character_registry"), false);
    fixture.runtime.destroy();
  },
);

test("Runtime persists pending candidates and re-evaluates them after a World Model update", async () => {
  const abstractEvent = canonicalApiEvent({
    subjectId: "subject_a",
    sourceId: "source_a",
  });
  abstractEvent.participants = abstractEvent.participants.map(
    (participant, index) => ({
      ...participant,
      biological_context: {
        species: "species_alpha",
        biological_type: index === 0 ? "type_a" : "type_b",
      },
      reproductive_capabilities_used:
        index === 0
          ? {
              ...participant.reproductive_capabilities_used,
              can_carry_pregnancy: null,
            }
          : participant.reproductive_capabilities_used,
    }),
  );
  const fixture = createFixture({
    analyzer: {
      async analyzeFloor() {
        return { events: [abstractEvent] };
      },
    },
  });
  await fixture.runtime.init();
  await settle();
  await fixture.runtime.refreshCurrentFloorAnalysis();

  const pendingRegistry = await fixture.runtime.getTrackingRegistry();
  assert.equal(pendingRegistry.tracking_subjects.char_000001, undefined);
  assert.equal(
    pendingRegistry.tracking_candidates.char_000001.eligibility,
    "pending",
  );
  const storedEvent = (await fixture.runtime.getCurrentFloorEvents())[0];
  const pendingRecord =
    pendingRegistry.tracking_candidates.char_000001.exposure_records[0];
  assert.equal(pendingRecord.event_id, storedEvent.event_id);
  assert.equal(pendingRecord.source.floor, 3);
  assert.equal(
    pendingRecord.story_time.display,
    storedEvent.story_time.display,
  );

  const currentFloor = fixture.runtime.store.getFloor(0, 0);
  await fixture.runtime.store.saveFloor(0, 0, {
    ...currentFloor,
    world_model: {
      schema_version: 1,
      species: [
        {
          name: "species_alpha",
          biological_types: [
            { name: "type_a", capabilities: { can_carry_pregnancy: true } },
            { name: "type_b", capabilities: { can_carry_pregnancy: false } },
          ],
        },
      ],
    },
  });
  await fixture.runtime.refreshTrackingRegistry("world-model-update");

  const resolvedRegistry = await fixture.runtime.getTrackingRegistry();
  assert.ok(resolvedRegistry.tracking_subjects.char_000001);
  assert.equal(
    resolvedRegistry.tracking_subjects.char_000001.created_from_event_id,
    storedEvent.event_id,
  );
  assert.deepEqual(resolvedRegistry.tracking_candidates, {});
  assert.equal(
    "pregnant" in resolvedRegistry.tracking_subjects.char_000001,
    false,
  );
  assert.equal(
    "conception_confirmed" in resolvedRegistry.tracking_subjects.char_000001,
    false,
  );
  assert.equal(
    (await fixture.runtime.getCurrentFloorEvents())[0].event_id,
    storedEvent.event_id,
  );
  fixture.runtime.destroy();
});

test("Runtime re-evaluates a pending candidate after Event evidence updates its profile", async () => {
  const abstractEvent = canonicalApiEvent({
    subjectId: "subject_profile",
    sourceId: "source_profile",
  });
  abstractEvent.participants = abstractEvent.participants.map(
    (participant, index) => ({
      ...participant,
      biological_context: {
        species: "species_alpha",
        biological_type: index === 0 ? "type_a" : "type_b",
      },
      reproductive_capabilities_used:
        index === 0
          ? {
              ...participant.reproductive_capabilities_used,
              can_carry_pregnancy: null,
            }
          : participant.reproductive_capabilities_used,
    }),
  );
  let analysisCount = 0;
  const fixture = createFixture({
    analyzer: {
      async analyzeFloor() {
        analysisCount += 1;
        const event = structuredClone(abstractEvent);
        if (analysisCount > 1) {
          event.participants[0].reproductive_capabilities_used.can_carry_pregnancy = true;
          event.participants[0].evidence.push({
            kind: "profile",
            text: "trusted profile capability fixture evidence",
          });
        }
        return { events: [event] };
      },
    },
  });
  await fixture.runtime.init();
  await settle();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  assert.equal(
    (await fixture.runtime.getTrackingRegistry()).tracking_candidates
      .char_000001.eligibility,
    "pending",
  );

  const firstEvent = (await fixture.runtime.getCurrentFloorEvents())[0];
  await fixture.runtime.refreshCurrentFloorAnalysis();

  const resolvedRegistry = await fixture.runtime.getTrackingRegistry();
  assert.ok(resolvedRegistry.tracking_subjects.char_000001);
  assert.deepEqual(resolvedRegistry.tracking_candidates, {});
  assert.equal(
    resolvedRegistry.tracking_subjects.char_000001.created_from_event_id,
    firstEvent.event_id,
  );
  assert.equal(
    resolvedRegistry.character_profiles.char_000001.reproductive_capabilities
      .can_carry_pregnancy,
    true,
  );
  assert.equal(
    (await fixture.runtime.getCurrentFloorEvents())[0].event_id,
    firstEvent.event_id,
  );
  fixture.runtime.destroy();
});

test("narrative StoryTime keeps structured fields when persisted through Runtime", async () => {
  const event = {
    ...canonicalApiEvent(),
    story_time: {
      display: "天河四十二年三月十八日午时至未时",
      normalized: "0042-03-18T12:45:00",
      day_index: 42,
      calendar_id: "tianhe",
      precision: "hour",
      confidence: 0.73,
    },
  };
  const fixture = createFixture({
    rawApiResponse: JSON.stringify({ schema_version: 1, events: [event] }),
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();

  const [persisted] = await fixture.runtime.getCurrentFloorEvents();
  assert.deepEqual(persisted.story_time, {
    display: "天河42年3月18日 午时至未时",
    normalized: "0042-03-18T12:45:00",
    day_index: 42,
    calendar_id: "tianhe",
    precision: "hour",
    confidence: 0.73,
  });
  fixture.runtime.destroy();
});

test("narrative StoryTime persists a formatted first-year display when time remains unresolved", async () => {
  const event = {
    ...canonicalApiEvent(),
    story_time: {
      display: "羲和元年三月四日 巳时末",
      normalized: null,
      day_index: null,
      calendar_id: null,
      precision: "minute",
      confidence: 1,
    },
  };
  const fixture = createFixture({
    rawApiResponse: JSON.stringify({ schema_version: 1, events: [event] }),
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();

  const [persisted] = await fixture.runtime.getCurrentFloorEvents();
  assert.deepEqual(persisted.story_time, {
    display: "羲和1年3月4日 巳时末",
    normalized: null,
    day_index: null,
    calendar_id: null,
    precision: "minute",
    confidence: 1,
  });
  fixture.runtime.destroy();
});

test("production analyzer accepts multi-Event force refresh and keeps exposure tracking subject-local", async () => {
  let responseCount = 0;
  const fixture = createFixture({
    rawApiResponse: () => {
      const registry = { schema_version: 1, entities: {} };
      const firstEvent = canonicalApiEventForRegistry(registry);
      firstEvent.location = "location_alpha";
      const events = [firstEvent];
      if (responseCount++ > 0) {
        const secondEvent = canonicalApiEventForRegistry(registry, {
          subjectId: "character_subject_b",
          sourceId: "character_source_b",
        });
        secondEvent.location = "location_beta";
        events.push(secondEvent);
      }
      return JSON.stringify({
        schema_version: 1,
        events,
        source: {
          chat_id: "legacy-chat",
          message_id: "legacy-message",
          floor: 999,
        },
      });
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();

  const previousEvents = await fixture.runtime.getCurrentFloorEvents();
  const previousId = previousEvents[0].event_id;

  const result = await fixture.runtime.refreshCurrentFloorAnalysis();

  assert.equal(fixture.apiRequests.length, 2);
  const status = await fixture.runtime.getCurrentFloorAnalysisStatus();
  assert.equal(result.status, "success");
  assert.equal(status.state, "success");
  assert.equal(status.event_count, 2);
  const events = await fixture.runtime.getCurrentFloorEvents();
  assert.equal(events.length, 2);
  const subjectAEvent = events.find(
    (event) =>
      event.pregnancy_relevance.gestational_subject_ids[0] ===
      "char_000001",
  );
  const subjectBEvent = events.find(
    (event) =>
      event.pregnancy_relevance.gestational_subject_ids[0] ===
      "char_000003",
  );
  assert.ok(subjectAEvent);
  assert.ok(subjectBEvent);
  assert.equal(subjectAEvent.event_id, previousId);
  assert.notEqual(subjectBEvent.event_id, subjectAEvent.event_id);
  assert.equal(subjectAEvent.location, "location_alpha");
  assert.equal(subjectBEvent.location, "location_beta");
  assert.deepEqual(subjectAEvent.pregnancy_relevance.counterpart_ids, [
    "char_000002",
  ]);
  assert.deepEqual(subjectBEvent.pregnancy_relevance.counterpart_ids, [
    "char_000004",
  ]);
  assert.deepEqual(
    subjectAEvent.participants.map((item) => item.character_id),
    ["char_000001", "char_000002"],
  );
  assert.deepEqual(
    subjectBEvent.participants.map((item) => item.character_id),
    ["char_000003", "char_000004"],
  );

  const data = await fixture.runtime.collectActiveBusinessData();
  assert.equal(data.active_event_count, 2);
  assert.equal(data.tracking_subject_count, 2);
  assert.deepEqual(Object.keys(data.tracking_subjects).sort(), [
    "char_000001",
    "char_000003",
  ]);
  assert.deepEqual(Object.keys(data.character_profiles).sort(), [
    "char_000001",
    "char_000003",
  ]);
  assert.deepEqual(
    data.tracking_subjects.char_000001.exposure_event_ids,
    [subjectAEvent.event_id],
  );
  assert.deepEqual(
    data.tracking_subjects.char_000003.exposure_event_ids,
    [subjectBEvent.event_id],
  );
  fixture.runtime.destroy();
});

test("invalid raw location response preserves the previous successful Event and Registry batch", async () => {
  const firstEvent = canonicalApiEvent({
    subjectId: "subject_a",
    sourceId: "source_a",
  });
  firstEvent.location = "location_alpha";
  const secondEvent = canonicalApiEvent({
    subjectId: "subject_b",
    sourceId: "source_b",
  });
  secondEvent.location = { display: "location_alpha" };
  let rawResponse = JSON.stringify({ schema_version: 1, events: [firstEvent] });
  const fixture = createFixture({ rawApiResponse: () => rawResponse });

  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const previousEvent = (await fixture.runtime.getCurrentFloorEvents())[0];

  rawResponse = JSON.stringify({
    schema_version: 1,
    events: [firstEvent, secondEvent],
  });
  await assert.rejects(
    fixture.runtime.refreshCurrentFloorAnalysis(),
    (error) =>
      error?.code === "EVENT_ANALYSIS_INVALID" &&
      error?.message === "EVENT_ANALYSIS_LOCATION_INVALID",
  );

  const status = await fixture.runtime.getCurrentFloorAnalysisStatus();
  assert.equal(status.state, "failed");
  assert.equal(status.last_error, "EVENT_ANALYSIS_LOCATION_INVALID");
  assert.equal(status.error_code, "EVENT_ANALYSIS_LOCATION_INVALID");
  assert.deepEqual(
    status.current_floor_events.map((event) => event.event_id),
    [previousEvent.event_id],
  );

  const events = await fixture.runtime.getCurrentFloorEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].event_id, previousEvent.event_id);
  assert.equal(events[0].location, "location_alpha");
  assert.deepEqual(events[0].pregnancy_relevance.gestational_subject_ids, [
    "char_000001",
  ]);

  const data = await fixture.runtime.collectActiveBusinessData();
  assert.deepEqual(Object.keys(data.tracking_subjects), ["char_000001"]);
  assert.deepEqual(Object.keys(data.character_profiles), ["char_000001"]);
  assert.equal(data.tracking_subjects.char_000003, undefined);
  assert.equal(data.character_profiles.char_000003, undefined);
  fixture.runtime.destroy();
});

test(
  "HTTP-like crypto without subtle still reaches analyzer and persists a complete Floor Version",
  { concurrency: false },
  async () => {
    let analyzed = 0;
    const fixture = createFixture({
      analyzer: {
        async analyzeFloor(request) {
          analyzed += 1;
          assert.equal(request.floor_version.content_hash.length, 64);
          return { events: [] };
        },
      },
    });
    await withGlobalCrypto({ subtle: undefined }, async () => {
      await fixture.runtime.init();
      const result = await fixture.runtime.refreshCurrentFloorAnalysis();
      assert.equal(result.status, "success");
      assert.equal(analyzed, 1);
      const stored = fixture.runtime.store.getFloor(0);
      assert.equal(stored.analysis.floor_version.content_hash.length, 64);
      assert.deepEqual(Object.keys(stored.analysis.floor_version), [
        "chat_id",
        "message_id",
        "floor",
        "swipe_id",
        "content_hash",
        "message_version",
      ]);
    });
    fixture.runtime.destroy();
  },
);

test("Runtime sends the target floor through the shared per-floor regex pipeline", async () => {
  let analysisInput = null;
  const fixture = createFixture({
    messages: [
      {
        message_id: "message-target",
        floor: 3,
        role: "assistant",
        content: "<target>TARGET_PROCESSED</target>",
      },
    ],
    analyzer: {
      async analyzeFloor(request) {
        analysisInput = request.analysisInput;
        return { events: [] };
      },
    },
  });
  fixture.context.chatMetadata.bioweave = {
    chat_scope: { chat_id: "chat-runtime" },
    settings: {
      recent_story: {
        enabled: true,
        floor_count: 4,
        regex_user_enabled: false,
        regex_rules: [
          {
            pattern: "/<target>(.*?)<\\/target>/",
            type: "extract",
            enabled: true,
          },
        ],
      },
    },
    tracking_subjects: {},
  };
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  assert.equal(analysisInput.current_floor.narrative, "TARGET_PROCESSED");
  fixture.runtime.destroy();
});

test(
  "Floor Version preflight failures expose safe diagnostics without throwing status or business DTO reads",
  { concurrency: false },
  async () => {
    const digestError = new Error("DIGEST_BROKE");
    digestError.code = "DIGEST_BROKE";
    const fixture = createFixture();
    await withGlobalCrypto(
      {
        subtle: {
          async digest() {
            throw digestError;
          },
        },
      },
      async () => {
        await fixture.runtime.init();
        const status = await fixture.runtime.getCurrentFloorAnalysisStatus();
        assert.equal(status.state, "failed");
        assert.equal(status.busy, false);
        assert.equal(status.error_stage, "floor_version");
        assert.equal(status.error_code, "DIGEST_BROKE");
        assert.match(status.safe_error_summary, /Floor Version/);
        assert.doesNotMatch(status.safe_error_summary, /DIGEST_BROKE/);
        assert.equal(status.floor_version, null);
        assert.deepEqual(status.current_floor_events, []);

        const data = await fixture.runtime.collectActiveBusinessData();
        assert.equal(data.analysis_status.error_stage, "floor_version");
        assert.equal(data.analysis_status.error_code, "DIGEST_BROKE");
        assert.equal(data.floor_version, null);
        assert.deepEqual(data.active_events, []);
        assert.equal(fixture.runtime.store.getFloor(0).analysis, null);
        await assert.rejects(
          fixture.runtime.refreshCurrentFloorAnalysis(),
          /DIGEST_BROKE/,
        );
      },
    );
    fixture.runtime.destroy();
  },
);

test("analysis status exposes running state and attempt while the analyzer is busy", async () => {
  let release;
  let startedResolve;
  const started = new Promise((resolve) => {
    startedResolve = resolve;
  });
  const fixture = createFixture({
    analyzer: {
      analyzeFloor: () =>
        new Promise((resolve) => {
          release = () => resolve({ events: [] });
          startedResolve();
        }),
    },
  });
  await fixture.runtime.init();
  const pending = fixture.runtime.refreshCurrentFloorAnalysis();
  await started;
  const running = await fixture.runtime.getCurrentFloorAnalysisStatus();
  assert.equal(running.state, "running");
  assert.equal(running.busy, true);
  assert.equal(running.attempt, 1);
  release();
  await pending;
  fixture.runtime.destroy();
});

test("World-first analysis publishes explicit World and Event UI phases", async () => {
  const statuses = [];
  const fixture = createFixture();
  fixture.runtime.subscribe(event => statuses.push(event));
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 0}, {force: true, reason: "automatic"});
  const worldPhases = statuses
    .filter(event => event.type === "WORLD_ANALYSIS_STATUS_CHANGED" && event.payload?.state === "running")
    .map(event => event.payload.phase);
  const eventPhases = statuses
    .filter(event => event.type === "EVENT_ANALYSIS_STATUS_CHANGED" && event.payload?.state === "running")
    .map(event => event.payload.phase ?? null);
  assert.deepEqual(worldPhases, ["world_full", "world_readback", "world_ui_ready"]);
  assert.deepEqual(eventPhases, [null, "event_analysis"]);
  assert.equal(
    statuses.filter(event => event.type === "EVENT_ANALYSIS_STATUS_CHANGED" && event.payload?.state === "success").length,
    1,
  );
  fixture.runtime.destroy();
});

test("World-first runtime execution is independent of UI subscriber presence", async () => {
  async function runWithUiSubscriber(uiMounted) {
    const statuses = [];
    const fixture = createFixture();
    if (uiMounted) fixture.runtime.subscribe(event => statuses.push(event));
    await fixture.runtime.init();
    await fixture.runtime.analyzeFloor(
      {__messageIndex: true, index: 0},
      {force: true, reason: "automatic"},
    );
    const floor = fixture.runtime.store.getFloor(0, 0);
    fixture.runtime.destroy();
    return {floor, statuses};
  }

  const closed = await runWithUiSubscriber(false);
  const open = await runWithUiSubscriber(true);
  assert.equal(closed.floor.world_model?.schema_version, 1);
  assert.equal(open.floor.world_model?.schema_version, 1);
  assert.equal(closed.floor.analysis?.status, "success");
  assert.equal(open.floor.analysis?.status, "success");
  assert.deepEqual(
    closed.statuses.filter(event => event.type === "WORLD_ANALYSIS_STATUS_CHANGED").length,
    0,
  );
  assert.ok(
    open.statuses.some(event => event.type === "WORLD_ANALYSIS_STATUS_CHANGED"),
  );
});

test("successful Floor skips non-force analysis and force success replaces Events", async () => {
  const fixture = createFixture();
  await fixture.runtime.init();
  await fixture.runtime.analyzeCurrentFloor();
  const firstId = (await fixture.runtime.getCurrentFloorEvents())[0].event_id;
  await fixture.runtime.analyzeCurrentFloor();
  assert.equal(fixture.calls(), 1);
  await fixture.runtime.refreshCurrentFloorAnalysis();
  assert.equal(fixture.calls(), 2);
  assert.deepEqual(
    (await fixture.runtime.getCurrentFloorEvents()).map(
      (event) => event.event_id,
    ),
    [firstId],
  );
  fixture.runtime.destroy();
});

test("API input uses the nearest valid previous Floor Version provenance", async () => {
  const inputs = [];
  const fixture = createFixture({
    messages: [
      {
        message_id: "message-1",
        floor: 3,
        content: "第一楼层",
        role: "assistant",
      },
      {
        message_id: "message-2",
        floor: 6,
        content: "第二楼层",
        role: "assistant",
      },
      {
        message_id: "message-3",
        floor: 9,
        content: "第三楼层",
        role: "assistant",
      },
    ],
    analyzer: {
      async analyzeFloor(request) {
        inputs.push(request.analysisInput);
        return {
          events: [eventResultForRegistry(request.analysisInput.character_registry)],
        };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor(
    { __messageIndex: true, index: 0 },
    { force: true },
  );
  await fixture.runtime.analyzeFloor(
    { __messageIndex: true, index: 1 },
    { force: true },
  );
  await fixture.runtime.analyzeFloor(
    { __messageIndex: true, index: 2 },
    { force: true },
  );

  const baseline = inputs[2].existing_bioweave;
  assert.equal(baseline.analysis.status, "success");
  assert.equal(baseline.analysis.floor_version.message_id, "message-2");
  assert.deepEqual(
    baseline.events.map((event) => event.source.message_id),
    ["message-2"],
  );
  await fixture.runtime.analyzeFloor(
    { __messageIndex: true, index: 2 },
    { force: true },
  );
  const reanalysis = inputs.at(-1).existing_bioweave;
  assert.equal(reanalysis.analysis.floor_version.message_id, "message-2");
  assert.deepEqual(
    reanalysis.events.map((event) => event.source.message_id),
    ["message-2"],
  );
  assert.doesNotMatch(JSON.stringify(reanalysis), /message-3/u);
  fixture.runtime.destroy();
});

test("Floor character snapshots accumulate from the nearest previous Floor", async () => {
  const inputs = [];
  const fixture = createFixture({
    messages: [
      {
        message_id: "message-2",
        floor: 2,
        content: "第二楼层",
        role: "assistant",
      },
      {
        message_id: "message-5",
        floor: 5,
        content: "第五楼层",
        role: "assistant",
      },
      {
        message_id: "message-9",
        floor: 9,
        content: "第九楼层",
        role: "assistant",
      },
    ],
    analyzer: {
      async analyzeFloor({ analysisInput }) {
        inputs.push(analysisInput);
        const names = {
          2: ["角色A", "来源A"],
          5: ["角色B", "来源B"],
          9: ["角色C", "来源C"],
        }[analysisInput.current_floor.floor];
        const resolvedNames =
          analysisInput.current_floor.floor === 9 && inputs.length > 3
            ? ["角色D", "来源D"]
            : names;
        return {
          events: resolvedNames
            ? [
                identityEventForCharacters(
                  analysisInput.character_registry,
                  resolvedNames[0],
                  resolvedNames[1],
                  `floor-${analysisInput.current_floor.floor}-${inputs.length}`,
                ),
              ]
            : [],
        };
      },
    },
  });

  await fixture.runtime.init();
      for (const index of [0, 1, 2]) {
        await fixture.runtime.analyzeFloor(
          { __messageIndex: true, index },
          { force: true },
        );
      }

      const entityIds = (registry) => Object.keys(registry.entities).sort();
      assert.deepEqual(entityIds(inputs[0].character_registry), []);
      assert.deepEqual(entityIds(inputs[1].character_registry), [
        "char_000001",
        "char_000002",
      ]);
      assert.deepEqual(entityIds(inputs[2].character_registry), [
        "char_000001",
        "char_000002",
        "char_000003",
        "char_000004",
      ]);
      assert.deepEqual(
        entityIds(fixture.runtime.store.getFloor(1).character_registry),
        ["char_000001", "char_000002", "char_000003", "char_000004"],
      );
      assert.deepEqual(
        entityIds(fixture.runtime.store.getFloor(2).character_registry),
        [
          "char_000001",
          "char_000002",
          "char_000003",
          "char_000004",
          "char_000005",
          "char_000006",
        ],
      );

      await fixture.runtime.analyzeFloor(
        { __messageIndex: true, index: 2 },
        { force: true },
      );
      assert.doesNotMatch(
        JSON.stringify(inputs[3].character_context),
        /角色C|来源C|char_000005|char_000006/u,
      );
      assert.deepEqual(entityIds(inputs[3].character_registry), [
        "char_000001",
        "char_000002",
        "char_000003",
        "char_000004",
      ]);
      assert.equal(
        inputs[3].character_registry.entities.char_000005,
        undefined,
      );
      assert.deepEqual(
        entityIds(fixture.runtime.store.getFloor(2).character_registry),
        [
          "char_000001",
          "char_000002",
          "char_000003",
          "char_000004",
          "char_000005",
          "char_000006",
        ],
      );
  fixture.runtime.destroy();
});

test("API input uses 6F when the unanalysed target is 9F", async () => {
  let input;
  const fixture = createFixture({
    messages: [
      {
        message_id: "message-3",
        floor: 3,
        content: "第三楼层",
        role: "assistant",
      },
      {
        message_id: "message-6",
        floor: 6,
        content: "第六楼层",
        role: "assistant",
      },
      {
        message_id: "message-9",
        floor: 9,
        content: "第九楼层",
        role: "assistant",
      },
    ],
    analyzer: {
      async analyzeFloor(request) {
        input = request.analysisInput;
        return {
          events: [eventResultForRegistry(request.analysisInput.character_registry)],
        };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor(
    { __messageIndex: true, index: 0 },
    { force: true },
  );
  await fixture.runtime.analyzeFloor(
    { __messageIndex: true, index: 1 },
    { force: true },
  );
  await fixture.runtime.analyzeFloor(
    { __messageIndex: true, index: 2 },
    { force: true },
  );

  assert.equal(
    input.existing_bioweave.analysis.floor_version.message_id,
    "message-6",
  );
  assert.deepEqual(
    input.existing_bioweave.events.map((event) => event.source.message_id),
    ["message-6"],
  );
  fixture.runtime.destroy();
});

test("deleted latest Floor falls back to the nearest remaining valid previous Floor", async () => {
  const inputs = [];
  const fixture = createFixture({
    messages: [
      {
        message_id: "message-3",
        floor: 3,
        content: "第三楼层",
        role: "assistant",
      },
      {
        message_id: "message-6",
        floor: 6,
        content: "第六楼层",
        role: "assistant",
      },
      {
        message_id: "message-9",
        floor: 9,
        content: "第九楼层",
        role: "assistant",
      },
      {
        message_id: "message-target",
        floor: 10,
        content: "目标楼层",
        role: "assistant",
      },
    ],
    analyzer: {
      async analyzeFloor(request) {
        inputs.push(request.analysisInput);
        return {
          events: [
            eventResultForRegistry(
              request.analysisInput.character_registry,
              `event-${inputs.length}`,
            ),
          ],
        };
      },
    },
  });
  await fixture.runtime.init();
  for (const index of [0, 1, 2]) {
    await fixture.runtime.analyzeFloor(
      { __messageIndex: true, index },
      { force: true },
    );
  }
  fixture.context.chat.splice(2, 1);
  await fixture.runtime.analyzeFloor("message-target", { force: true });

  assert.equal(
    inputs.at(-1).existing_bioweave.analysis.floor_version.message_id,
    "message-6",
  );
  assert.deepEqual(
    inputs
      .at(-1)
      .existing_bioweave.events.map((event) => event.source.message_id),
    ["message-6"],
  );
  assert.doesNotMatch(
    JSON.stringify(inputs.at(-1).existing_bioweave),
    /message-9/u,
  );
  await fixture.runtime.analyzeFloor("message-target", { force: true });
  assert.equal(
    inputs.at(-1).existing_bioweave.analysis.floor_version.message_id,
    "message-6",
  );
  assert.doesNotMatch(
    JSON.stringify(inputs.at(-1).existing_bioweave),
    /message-9/u,
  );
  fixture.runtime.destroy();
});

test("MESSAGE_DELETED invalidates the downstream active path without analyzing", async () => {
  let analyzerCalls = 0;
  const namesByFloor = {
    3: ["雾港编录员", "青砾引路人"],
    6: ["折线观测者", "石榴守门人"],
    9: ["潮汐记录者", "银杉信使"],
  };
  const fixture = createFixture({
    messages: [
      {
        message_id: "message-owner",
        floor: 3,
        content: "保留的旧楼层",
        role: "assistant",
      },
      {
        message_id: "message-middle",
        floor: 6,
        content: "将被删除的中间楼层",
        role: "assistant",
      },
      {
        message_id: "message-downstream",
        floor: 9,
        content: "需要失效的下游楼层",
        role: "assistant",
      },
    ],
    analyzer: {
      async analyzeFloor({ analysisInput }) {
        analyzerCalls += 1;
        const names = namesByFloor[analysisInput.current_floor.floor];
        return {
          events: [
            identityEventForCharacters(
              analysisInput.character_registry,
              names[0],
              names[1],
              `message-deleted-${analyzerCalls}`,
            ),
          ],
        };
      },
    },
  });

  await fixture.runtime.init();
  for (const index of [0, 1, 2]) {
    await fixture.runtime.analyzeFloor(
      { __messageIndex: true, index },
      { force: true },
    );
  }
  const downstreamEventId = fixture.runtime.store.getFloor(2).events[0].event_id;

  fixture.context.chat.splice(1, 1);
  fixture.emit("message-deleted", fixture.context.chat.length);
  await settle();

  assert.equal(analyzerCalls, 3);
  assert.equal(fixture.runtime.store.getFloor(1).analysis, null);
  assert.deepEqual(fixture.runtime.store.getFloor(1).events, []);
  const businessData = await fixture.runtime.collectActiveBusinessData();
  assert.deepEqual(
    businessData.active_events.map((event) => event.source.message_id),
    ["message-owner"],
  );
  assert.equal(JSON.stringify(businessData).includes(downstreamEventId), false);
  assert.deepEqual(
    Object.values(
      (await fixture.runtime.getTrackingRegistry()).character_registry.entities,
    )
      .map((entry) => entry.display_name)
      .sort(),
    ["青砾引路人", "雾港编录员"].sort(),
  );
  fixture.runtime.destroy();
});

test("latest MESSAGE_DELETED lets the next analysis use the surviving snapshot", async () => {
  const inputs = [];
  let analyzerCalls = 0;
  const fixture = createFixture({
    messages: [
      {
        message_id: "message-survivor",
        floor: 3,
        content: "删除后仍存活的楼层",
        role: "assistant",
      },
      {
        message_id: "message-latest",
        floor: 6,
        content: "删除的最新已分析楼层",
        role: "assistant",
      },
      {
        message_id: "message-target",
        floor: 9,
        content: "删除后的下一分析楼层",
        role: "assistant",
      },
    ],
    analyzer: {
      async analyzeFloor({ analysisInput }) {
        analyzerCalls += 1;
        inputs.push(analysisInput);
        if (analysisInput.current_floor.message_id === "message-target")
          return { events: [] };
        const names =
          analysisInput.current_floor.message_id === "message-survivor"
            ? ["灰阶航标员", "琥珀采集者"]
            : ["被删观测员", "被删守门人"];
        return {
          events: [
            identityEventForCharacters(
              analysisInput.character_registry,
              names[0],
              names[1],
              `latest-deleted-${analyzerCalls}`,
            ),
          ],
        };
      },
    },
  });

  await fixture.runtime.init();
  for (const index of [0, 1]) {
    await fixture.runtime.analyzeFloor(
      { __messageIndex: true, index },
      { force: true },
    );
  }
  const deletedEventId = fixture.runtime.store.getFloor(1).events[0].event_id;
  fixture.context.chat.splice(1, 1);
  fixture.emit("message-deleted", fixture.context.chat.length);
  await settle();

  assert.equal(analyzerCalls, 2);
  assert.equal(
    JSON.stringify(await fixture.runtime.collectActiveBusinessData()).includes(
      deletedEventId,
    ),
    false,
  );
  await fixture.runtime.analyzeFloor("message-target", { force: true });
  assert.equal(analyzerCalls, 3);
  const previous = inputs.at(-1).existing_bioweave;
  assert.equal(previous.analysis.floor_version.message_id, "message-survivor");
  assert.deepEqual(
    previous.events.map((event) => event.source.message_id),
    ["message-survivor"],
  );
  assert.deepEqual(
    Object.values(inputs.at(-1).character_registry.entities)
      .map((entry) => entry.display_name)
      .sort(),
    ["灰阶航标员", "琥珀采集者"].sort(),
  );
  assert.doesNotMatch(
    JSON.stringify(inputs.at(-1)),
    /被删观测员|被删守门人/u,
  );
  fixture.runtime.destroy();
});

test("deleting analyzed Floors rolls identity snapshots back to older owners", async () => {
  const inputs = [];
  const fixture = createFixture({
    messages: [
      {
        message_id: "message-3",
        floor: 3,
        content: "第三楼层",
        role: "assistant",
      },
      {
        message_id: "message-6",
        floor: 6,
        content: "第六楼层",
        role: "assistant",
      },
      {
        message_id: "message-9",
        floor: 9,
        content: "第九楼层",
        role: "assistant",
      },
      {
        message_id: "message-target",
        floor: 10,
        content: "目标楼层",
        role: "assistant",
      },
    ],
    analyzer: {
      async analyzeFloor({ analysisInput }) {
        inputs.push(analysisInput);
        const names = {
          3: ["角色A", "来源A"],
          6: ["角色B", "来源B"],
          9: ["角色C", "来源C"],
          10: ["角色D", "来源D"],
        }[analysisInput.current_floor.floor];
        return {
          events: names
            ? [
                identityEventForCharacters(
                  analysisInput.character_registry,
                  names[0],
                  names[1],
                  `deletion-${inputs.length}`,
                ),
              ]
            : [],
        };
      },
    },
  });
  await fixture.runtime.init();
  for (const index of [0, 1, 2]) {
    await fixture.runtime.analyzeFloor(
      { __messageIndex: true, index },
      { force: true },
    );
  }

  fixture.context.chat.splice(2, 1);
  await fixture.runtime.analyzeFloor("message-target", { force: true });
  assert.deepEqual(
    Object.values(inputs.at(-1).character_registry.entities)
      .map((entry) => entry.display_name)
      .sort(),
    ["来源A", "来源B", "角色A", "角色B"],
  );
  assert.deepEqual(Object.keys(inputs.at(-1).character_registry.entities).sort(), [
    "char_000001",
    "char_000002",
    "char_000003",
    "char_000004",
  ]);
  assert.deepEqual(
    Object.keys(fixture.runtime.store.getFloor(2).character_registry.entities).sort(),
    [
      "char_000001",
      "char_000002",
      "char_000003",
      "char_000004",
      "char_000005",
      "char_000006",
    ],
  );

  fixture.context.chat.splice(1, 1);
  await fixture.runtime.analyzeFloor("message-target", { force: true });
  assert.deepEqual(
    Object.values(inputs.at(-1).character_registry.entities).map(
      (entry) => entry.display_name,
    ),
    ["角色A", "来源A"],
  );
  assert.deepEqual(Object.keys(inputs.at(-1).character_registry.entities).sort(), [
    "char_000001",
    "char_000002",
  ]);
  assert.deepEqual(
    Object.keys(fixture.runtime.store.getFloor(1).character_registry.entities).sort(),
    ["char_000001", "char_000002", "char_000003", "char_000004"],
  );
  fixture.runtime.destroy();
});

test("API input is empty when no valid previous Floor exists", async () => {
  let input;
  const fixture = createFixture({
    analyzer: {
      async analyzeFloor(request) {
        input = request.analysisInput;
        return { events: [] };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  assert.deepEqual(input.existing_bioweave, { analysis: null, events: [] });
  fixture.runtime.destroy();
});

test("first analysis does not inherit an orphan Chat character registry", async () => {
  let input;
  const fixture = createFixture({
    characterContextResolver: (_context, chatData) => ({
      profiles: Object.fromEntries(
        Object.entries(chatData.character_registry?.entities ?? {}).map(
          ([characterId, entry]) => [characterId, entry],
        ),
      ),
    }),
    rawApiResponse: JSON.stringify({ schema_version: 1, events: [] }),
  });
  fixture.context.chatMetadata.bioweave = {
    chat_scope: { chat_id: "chat-runtime" },
    character_registry: {
      schema_version: 1,
      entities: {
        orphan_id_a: {
          character_id: "orphan_id_a",
          display_name: "孤立角色甲",
          aliases: [],
        },
        orphan_id_b: {
          character_id: "orphan_id_b",
          display_name: "孤立角色乙",
          aliases: [],
        },
        orphan_id_c: {
          character_id: "orphan_id_c",
          display_name: "孤立角色丙",
          aliases: [],
        },
      },
    },
  };

  await fixture.runtime.init();
  await settle();
  input = await fixture.runtime.getCurrentFloorAnalysisInput();
  assert.deepEqual(input.existing_bioweave, { analysis: null, events: [] });
  assert.deepEqual(input.character_registry, {
    schema_version: 1,
    entities: {},
  });

  await fixture.runtime.refreshCurrentFloorAnalysis();
  assert.equal(fixture.apiRequests.length, 1);
  const requestText = JSON.stringify(fixture.apiRequests[0]);
  for (const value of [
    "orphan_id_a",
    "orphan_id_b",
    "orphan_id_c",
    "孤立角色甲",
    "孤立角色乙",
    "孤立角色丙",
  ]) {
    assert.doesNotMatch(requestText, new RegExp(value, "u"));
  }
  fixture.runtime.destroy();
});

test("deleted Floor and Swipe owners cannot contribute previous API state", async () => {
  async function assertEmptyPrevious(messages, removeOwner) {
    const inputs = [];
    const fixture = createFixture({
      messages,
      analyzer: {
        async analyzeFloor(request) {
          inputs.push(request.analysisInput);
          return { events: [eventResult("event-" + inputs.length)] };
        },
      },
    });
    await fixture.runtime.init();
    await fixture.runtime.analyzeFloor(
      { __messageIndex: true, index: 0 },
      { force: true },
    );
    removeOwner(fixture.context.chat);
    await fixture.runtime.analyzeFloor("message-target", { force: true });
    assert.deepEqual(inputs[1].existing_bioweave, {
      analysis: null,
      events: [],
    });
    fixture.runtime.destroy();
  }

  await assertEmptyPrevious(
    [
      {
        message_id: "message-owner",
        floor: 9,
        content: "被删除的 Floor",
        role: "assistant",
      },
      {
        message_id: "message-target",
        floor: 10,
        content: "目标 Floor",
        role: "assistant",
      },
    ],
    (chat) => chat.splice(0, 1),
  );

  await assertEmptyPrevious(
    [
      {
        message_id: "message-owner",
        floor: 9,
        swipes: ["版本 A", "版本 B"],
        swipe_info: [{}, {}],
        swipe_id: 1,
        role: "assistant",
      },
      {
        message_id: "message-target",
        floor: 10,
        content: "目标 Floor",
        role: "assistant",
      },
    ],
    (chat) => {
      delete chat[0].swipe_info[1];
    },
  );
});

test("reanalyzing a Floor never uses that Floor as its own previous state", async () => {
  const inputs = [];
  const fixture = createFixture({
    messages: [
      {
        message_id: "message-1",
        floor: 1,
        content: "第一楼层",
        role: "assistant",
      },
      {
        message_id: "message-2",
        floor: 2,
        content: "第二楼层",
        role: "assistant",
      },
    ],
    analyzer: {
      async analyzeFloor(request) {
        inputs.push(request.analysisInput);
        return {
          events: [
            eventResult("ignored-model-id", {
              location: `run-${inputs.length}`,
            }),
          ],
        };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor(
    { __messageIndex: true, index: 0 },
    { force: true },
  );
  await fixture.runtime.analyzeFloor(
    { __messageIndex: true, index: 1 },
    { force: true },
  );
  await fixture.runtime.analyzeFloor(
    { __messageIndex: true, index: 1 },
    { force: true },
  );
  assert.equal(inputs.length, 3);
  for (const input of inputs.slice(1)) {
    assert.equal(
      input.existing_bioweave.analysis.floor_version.message_id,
      "message-1",
    );
    assert.deepEqual(
      input.existing_bioweave.events.map((event) => event.location),
      ["run-1"],
    );
  }
  fixture.runtime.destroy();
});

test("formal identity reanalysis excludes the target's own Registry and Events", async () => {
  const inputs = [];
  const fixture = createFixture({
    messages: [
      {
        message_id: "formal-history-owner",
        floor: 1,
        content: "正式身份历史楼层",
        role: "assistant",
      },
      {
        message_id: "formal-history-target",
        floor: 2,
        content: "正式身份重分析目标",
        role: "assistant",
      },
    ],
    analyzer: {
      async analyzeFloor({ analysisInput }) {
        inputs.push(analysisInput);
        const names =
          analysisInput.current_floor.message_id === "formal-history-owner"
            ? ["墨蓝航标员", "白砾守门人"]
            : ["回声观测员", "赤陶引路人"];
        return {
          events: [
            identityEventForCharacters(
              analysisInput.character_registry,
              names[0],
              names[1],
              `formal-reanalysis-${inputs.length}`,
            ),
          ],
        };
      },
    },
  });

  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor(
    { __messageIndex: true, index: 0 },
    { force: true },
  );
  await fixture.runtime.analyzeFloor(
    { __messageIndex: true, index: 1 },
    { force: true },
  );
  await fixture.runtime.analyzeFloor(
    { __messageIndex: true, index: 1 },
    { force: true },
  );

  assert.equal(inputs.length, 3);
  for (const input of inputs.slice(1)) {
    assert.equal(
      input.existing_bioweave.analysis.floor_version.message_id,
      "formal-history-owner",
    );
    assert.deepEqual(
      input.existing_bioweave.events.map((event) => event.source.message_id),
      ["formal-history-owner"],
    );
    assert.doesNotMatch(
      JSON.stringify(input.character_registry),
      /回声观测员|赤陶引路人/u,
    );
  }
  fixture.runtime.destroy();
});

test("stale Floor Version is skipped during previous-state resolution", async () => {
  const inputs = [];
  const fixture = createFixture({
    messages: [
      {
        message_id: "message-1",
        floor: 1,
        content: "第一楼层",
        role: "assistant",
      },
      {
        message_id: "message-2",
        floor: 2,
        content: "第二楼层",
        role: "assistant",
        message_version: "v1",
      },
      {
        message_id: "message-3",
        floor: 3,
        content: "第三楼层",
        role: "assistant",
      },
    ],
    analyzer: {
      async analyzeFloor(request) {
        inputs.push(request.analysisInput);
        return { events: [eventResult()] };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor(
    { __messageIndex: true, index: 0 },
    { force: true },
  );
  await fixture.runtime.analyzeFloor(
    { __messageIndex: true, index: 1 },
    { force: true },
  );
  fixture.context.chat[1].message_version = "v2";
  await fixture.runtime.analyzeFloor(
    { __messageIndex: true, index: 2 },
    { force: true },
  );

  const baseline = inputs[2].existing_bioweave;
  assert.equal(baseline.analysis.floor_version.message_id, "message-1");
  assert.deepEqual(
    baseline.events.map((event) => event.source.message_id),
    ["message-1"],
  );
  fixture.runtime.destroy();
});

test("stale Floor identity snapshots cannot become previous state", async () => {
  const inputs = [];
  const fixture = createFixture({
    messages: [
      {
        message_id: "message-1",
        floor: 1,
        content: "第一楼层",
        role: "assistant",
      },
      {
        message_id: "message-2",
        floor: 2,
        content: "第二楼层",
        role: "assistant",
        message_version: "v1",
      },
      {
        message_id: "message-3",
        floor: 3,
        content: "第三楼层",
        role: "assistant",
      },
    ],
    analyzer: {
      async analyzeFloor({ analysisInput }) {
        inputs.push(analysisInput);
        return {
          events:
            analysisInput.current_floor.floor === 2
              ? [
                  identityEventForCharacters(
                    analysisInput.character_registry,
                    "版本角色A",
                    "版本来源A",
                    "versioned-floor",
                  ),
                ]
              : [],
        };
      },
    },
  });

  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor(
    { __messageIndex: true, index: 1 },
    { force: true },
  );

  fixture.context.chat[1].message_version = "v2";
  await fixture.runtime.analyzeFloor(
    { __messageIndex: true, index: 2 },
    { force: true },
  );

  assert.deepEqual(inputs.at(-1).existing_bioweave, {
    analysis: null,
    events: [],
  });
  assert.deepEqual(inputs.at(-1).character_registry, {
    schema_version: 1,
    entities: {},
  });
  assert.doesNotMatch(
    JSON.stringify(inputs.at(-1)),
    /版本角色A|版本来源A|char_versioned/u,
  );
  fixture.runtime.destroy();
});

test("previous lookup skips successful Floors without a complete Registry snapshot", async () => {
  const inputs = [];
  let invalidRegistryMode = "missing";
  const fixture = createFixture({
    messages: [
      {
        message_id: "registry-owner",
        floor: 1,
        content: "合法 Registry 所属楼层",
        role: "assistant",
      },
      {
        message_id: "registry-invalid",
        floor: 2,
        content: "缺少 Registry 的楼层",
        role: "assistant",
      },
      {
        message_id: "registry-target",
        floor: 3,
        content: "读取 previous 的目标楼层",
        role: "assistant",
      },
    ],
    analyzer: {
      async analyzeFloor({ analysisInput }) {
        inputs.push(analysisInput);
        if (analysisInput.current_floor.message_id === "registry-target")
          return { events: [] };
        const names =
          analysisInput.current_floor.message_id === "registry-owner"
            ? ["砂砾档案员", "青铜引路人"]
            : ["无册观测员", "雾线守门人"];
        return {
          events: [
            identityEventForCharacters(
              analysisInput.character_registry,
              names[0],
              names[1],
              `registry-snapshot-${inputs.length}`,
            ),
          ],
        };
      },
    },
  });

  await fixture.runtime.init();
  for (const index of [0, 1]) {
    await fixture.runtime.analyzeFloor(
      { __messageIndex: true, index },
      { force: true },
    );
  }

  const originalGetFloor = fixture.runtime.store.getFloor;
  fixture.runtime.store.getFloor = (index, swipeId) => {
    const floorData = originalGetFloor.call(fixture.runtime.store, index, swipeId);
    if (index !== 1 || !floorData) return floorData;
    const invalid = structuredClone(floorData);
    if (invalidRegistryMode === "missing") delete invalid.character_registry;
    else invalid.character_registry = { schema_version: 1, entities: [] };
    return invalid;
  };

  for (const mode of ["missing", "invalid"]) {
    invalidRegistryMode = mode;
    await fixture.runtime.analyzeFloor("registry-target", { force: true });
    const previous = inputs.at(-1).existing_bioweave;
    assert.equal(
      previous.analysis.floor_version.message_id,
      "registry-owner",
    );
    assert.deepEqual(
      previous.events.map((event) => event.source.message_id),
      ["registry-owner"],
    );
    assert.deepEqual(
      Object.values(inputs.at(-1).character_registry.entities)
        .map((entry) => entry.display_name)
        .sort(),
      ["砂砾档案员", "青铜引路人"].sort(),
    );
    assert.doesNotMatch(
      JSON.stringify(previous),
      /无册观测员|雾线守门人/u,
    );
  }
  fixture.runtime.destroy();
});

test("repeated force analysis leaves only the final successful Event result", async () => {
  let calls = 0;
  const inputs = [];
  const fixture = createFixture({
    messages: [
      {
        message_id: "message-1",
        floor: 1,
        content: "第一楼层",
        role: "assistant",
      },
      {
        message_id: "message-2",
        floor: 2,
        content: "第二楼层",
        role: "assistant",
      },
    ],
    analyzer: {
      async analyzeFloor(request) {
        calls += 1;
        inputs.push(request.analysisInput);
        if (calls === 2) return { events: [] };
        return {
          events: [
            eventResult(`model-${calls}`, {
              location: calls === 1 ? "prior" : "final",
            }),
          ],
        };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor(
    { __messageIndex: true, index: 0 },
    { force: true },
  );
  await fixture.runtime.analyzeFloor(
    { __messageIndex: true, index: 1 },
    { force: true },
  );
  assert.deepEqual(
    await fixture.runtime.getActiveFloorEvents(1, inputs[1].floor_version),
    [],
  );
  await fixture.runtime.analyzeFloor(
    { __messageIndex: true, index: 1 },
    { force: true },
  );
  assert.equal(inputs.length, 3);
  for (const input of inputs.slice(1)) {
    assert.equal(
      input.existing_bioweave.analysis.floor_version.message_id,
      "message-1",
    );
    assert.deepEqual(
      input.existing_bioweave.events.map((event) => event.location),
      ["prior"],
    );
  }
  const events = await fixture.runtime.getCurrentFloorEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].location, "final");
  fixture.runtime.destroy();
});

test("reanalyzing an edited Floor never uses its stale own result as previous state", async () => {
  const inputs = [];
  const fixture = createFixture({
    messages: [
      {
        message_id: "message-1",
        floor: 1,
        content: "第一楼层",
        role: "assistant",
      },
      {
        message_id: "message-2",
        floor: 2,
        content: "第二楼层",
        role: "assistant",
      },
    ],
    analyzer: {
      async analyzeFloor(request) {
        inputs.push(request.analysisInput);
        return {
          events: [
            eventResult(`model-${inputs.length}`, {
              location: `run-${inputs.length}`,
            }),
          ],
        };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor(
    { __messageIndex: true, index: 0 },
    { force: true },
  );
  await fixture.runtime.analyzeFloor(
    { __messageIndex: true, index: 1 },
    { force: true },
  );
  fixture.context.chat[1].content = "第二楼层已编辑";
  await fixture.runtime.analyzeFloor(
    { __messageIndex: true, index: 1 },
    { force: true },
  );

  assert.equal(inputs.length, 3);
  assert.equal(
    inputs[2].existing_bioweave.analysis.floor_version.message_id,
    "message-1",
  );
  assert.deepEqual(
    inputs[2].existing_bioweave.events.map((event) => event.location),
    ["run-1"],
  );
  fixture.runtime.destroy();
});

test("failed force refresh preserves the previous successful Events and records failure", async () => {
  let calls = 0;
  const fixture = createFixture({
    retryCount: 0,
    analyzer: {
      async analyzeFloor() {
        calls += 1;
        if (calls === 2) throw new Error("JSON_SCHEMA_INVALID");
        return { events: [eventResult("evt-success")] };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const firstId = (await fixture.runtime.getCurrentFloorEvents())[0].event_id;
  await assert.rejects(
    fixture.runtime.refreshCurrentFloorAnalysis(),
    /JSON_SCHEMA_INVALID/,
  );
  const status = await fixture.runtime.getCurrentFloorAnalysisStatus();
  assert.equal(status.state, "failed");
  assert.equal(status.last_error, "JSON_SCHEMA_INVALID");
  assert.deepEqual(
    status.current_floor_events.map((event) => event.event_id),
    [firstId],
  );
  fixture.runtime.destroy();
});

test("failed formal reanalysis preserves the prior successful Registry snapshot", async () => {
  let analyzerCalls = 0;
  const fixture = createFixture({
    analyzer: {
      async analyzeFloor({ analysisInput }) {
        analyzerCalls += 1;
        if (analyzerCalls === 2) throw new Error("FORMAL_REANALYSIS_FAILED");
        return {
          events: [
            identityEventForCharacters(
              analysisInput.character_registry,
              "琥珀档案员",
              "灰岩引路人",
              "formal-failure-event",
            ),
          ],
        };
      },
    },
  });

  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const before = fixture.runtime.store.getFloor(0);
  await assert.rejects(
    fixture.runtime.refreshCurrentFloorAnalysis(),
    /FORMAL_REANALYSIS_FAILED/u,
  );

  const after = fixture.runtime.store.getFloor(0);
  assert.equal(after.analysis.status, "failed");
  assert.equal(after.analysis.last_success.status, "success");
  assert.deepEqual(after.events, before.events);
  assert.deepEqual(after.character_registry, before.character_registry);
  assert.deepEqual(
    (await fixture.runtime.getCurrentFloorEvents()).map(
      (event) => event.event_id,
    ),
    before.events.map((event) => event.event_id),
  );
  fixture.runtime.destroy();
});

test("stale Floor Version removes old Events from the derived Registry", async () => {
  let calls = 0;
  const fixture = createFixture({
    analyzer: {
      async analyzeFloor() {
        calls += 1;
        if (calls === 2) throw new Error("REQUEST_TIMEOUT");
        return { events: [eventResult("evt-old-version")] };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  fixture.context.chat[0].content = "编辑后的当前剧情";
  await assert.rejects(
    fixture.runtime.analyzeCurrentFloor(),
    /REQUEST_TIMEOUT/,
  );
  const data = await fixture.runtime.collectActiveBusinessData();
  assert.equal(data.state, "failed");
  assert.equal(data.active_event_count, 0);
  assert.equal(data.tracking_subject_count, 0);
  fixture.runtime.destroy();
});

test("stale Floor Version does not expose old analysis status metadata", async () => {
  const fixture = createFixture();
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  fixture.context.chat[0].content = "编辑后的当前剧情";

  const status = await fixture.runtime.getCurrentFloorAnalysisStatus();
  assert.equal(status.state, "not_analyzed");
  assert.equal(status.last_success, null);
  assert.equal(status.attempt, null);
  assert.equal(status.last_error, null);
  assert.equal(status.error_code, null);
  assert.deepEqual(status.current_floor_events, []);
  fixture.runtime.destroy();
});

test("Runtime lifecycle counts only rendered Character Floors", async () => {
  const fixture = createFixture({ floor: 3 });
  await fixture.runtime.init();
  fixture.context.chat[0].content = "角色回复 1";
  fixture.emit("character-message-rendered", { message_id: "message-stable" });
  await settle();
  assert.equal(fixture.calls(), 0);
  fixture.context.chat.push({ message_id: "message-next", floor: 4, content: "角色回复 2", role: "assistant" });
  fixture.emit("character-message-rendered", { message_id: "message-next" });
  await settle();
  assert.equal(fixture.calls(), 0);
  fixture.context.chat.push({ message_id: "message-third", floor: 5, content: "角色回复 3", role: "assistant" });
  fixture.emit("character-message-rendered", { message_id: "message-third" });
  await settle();
  assert.equal(fixture.calls(), 1);
  fixture.emit("message-received", { message_id: "message-next" });
  fixture.emit("generation-ended", { message_id: "message-next" });
  await settle();
  assert.equal(fixture.calls(), 1);
  fixture.runtime.destroy();
});

function configureScheduler(fixture, { interval = 2, retry = true } = {}) {
  fixture.context.chatMetadata.bioweave = {
    chat_scope: { chat_id: "chat-runtime" },
    settings: {
      analysis_interval: interval,
      retry_failed_analysis: retry,
    },
  };
}

function appendCharacter(fixture, messageId, floor, content = messageId) {
  fixture.context.chat.push({
    message_id: messageId,
    floor,
    content,
    role: "assistant",
  });
  fixture.emit("character-message-rendered", { message_id: messageId });
}

test("World stage retries AI failure within one execution and then permits Event", async () => {
  let worldCalls = 0;
  let eventCalls = 0;
  const fixture = createFixture({
    retryCount: 2,
    analyzer: {
      async analyzeWorldModel() {
        worldCalls += 1;
        if (worldCalls === 1) throw Object.assign(new Error("WORLD_SCHEMA"), {
          code: "WORLD_SCHEMA_INVALID",
          analysis_stage: "schema_validation",
        });
        return normalizeWorldModel({ schema_version: 1, species: [{ name: "人类", biological_types: [] }] });
      },
      async analyzeFloor() {
        eventCalls += 1;
        return { events: [] };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({ __messageIndex: true, index: 0 }, { force: true });
  assert.equal(worldCalls, 2);
  assert.equal(eventCalls, 1);
  const traces = fixture.runtime.getPersistenceTrace().sequence;
  assert.deepEqual(
    traces.filter(item => item.domain === "world" && item.stage === "WORLD_STAGE_ATTEMPT_BEGIN")
      .map(item => [item.attempt, item.retry_index, item.max_retries]),
    [[1, 0, 2], [2, 1, 2]],
  );
  fixture.runtime.destroy();
});

test("Event domain validation failure retries the Event stage without repeating World", async () => {
  let worldCalls = 0;
  let eventCalls = 0;
  const fixture = createFixture({
    retryCount: 2,
    analyzer: {
      async analyzeWorldModel() {
        worldCalls += 1;
        return normalizeWorldModel({ schema_version: 1, species: [{ name: "人类", biological_types: [] }] });
      },
      async analyzeFloor() {
        eventCalls += 1;
        if (eventCalls === 1) {
          const error = new Error("EVENT_DOMAIN_VALIDATION_FAILED");
          error.code = "EVENT_DOMAIN_VALIDATION_FAILED";
          error.analysis_stage = "schema_validation";
          throw error;
        }
        return { events: [] };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({ __messageIndex: true, index: 0 }, { force: true });
  assert.equal(worldCalls, 1);
  assert.equal(eventCalls, 2);
  fixture.runtime.destroy();
});

test("retry_count is an additional retry limit and exhaustion blocks Event", async () => {
  let worldCalls = 0;
  let eventCalls = 0;
  const fixture = createFixture({
    retryCount: 2,
    analyzer: {
      async analyzeWorldModel() {
        worldCalls += 1;
        throw Object.assign(new Error("WORLD_REQUEST_FAILED"), {
          code: "REQUEST_TIMEOUT",
          analysis_stage: "api_request",
        });
      },
      async analyzeFloor() {
        eventCalls += 1;
        return { events: [] };
      },
    },
  });
  await fixture.runtime.init();
  await assert.rejects(
    fixture.runtime.analyzeFloor({ __messageIndex: true, index: 0 }, { force: true }),
    /WORLD_MODEL_UNAVAILABLE/u,
  );
  assert.equal(worldCalls, 3);
  assert.equal(eventCalls, 0);
  fixture.runtime.destroy();
});

test("manual World Patch uses the same additional retry policy", async () => {
  let patchCalls = 0;
  const fixture = createFixture({
    retryCount: 1,
    messages: [
      { message_id: "patch-owner-manual", floor: 1, content: "已有世界", role: "assistant" },
      { message_id: "patch-target-manual", floor: 2, content: "补充世界规则", role: "assistant" },
    ],
    analyzer: {
      async analyzeWorldModelPatch() {
        patchCalls += 1;
        if (patchCalls === 1) throw Object.assign(new Error("PATCH_SCHEMA"), {
          code: "WORLD_PATCH_SCHEMA_INVALID",
          analysis_stage: "schema_validation",
        });
        return {schema_version: 1, add: {}, update: {}};
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.store.saveFloor(0, 0, {
    ...emptyFloor(),
    floor_version: await floorVersion({
      chatId: "chat-runtime",
      messageId: "patch-owner-manual",
      floor: 1,
      text: "已有世界",
    }),
    world_model: normalizeWorldModel({schema_version: 1, species: [{name: "已有世界"}]}),
  });
  await fixture.runtime.analyzeCurrentWorldModelPatch({analysisInput: {}, trigger: "manual-patch"});
  assert.equal(patchCalls, 2);
  fixture.runtime.destroy();
});

test("Character counter ignores User Floors and ordinary edits", async () => {
  const fixture = createFixture({
    messages: [{ message_id: "character-1", floor: 2, content: "一", role: "assistant" }],
  });
  configureScheduler(fixture, { interval: 2 });
  await fixture.runtime.init();
  fixture.emit("character-message-rendered", { message_id: "character-1" });
  await settle();
  assert.equal(fixture.calls(), 0);
  const before = fixture.runtime.getAutoAnalysisSchedulerState();
  fixture.context.chat.push({ message_id: "user-1", floor: 3, content: "用户", role: "user" });
  fixture.emit("message-received", { message_id: "user-1" });
  fixture.context.chat[0].content = "一（编辑）";
  fixture.emit("message-edited", { message_id: "character-1" });
  await settle();
  assert.equal(fixture.calls(), 0);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().counter, before.counter);
  fixture.runtime.destroy();
});

test("ordinary MESSAGE_UPDATED never forces analysis", async () => {
  const fixture = createFixture({
    messages: [{ message_id: "updated-character", floor: 1, content: "原文", role: "assistant" }],
  });
  configureScheduler(fixture, { interval: 1 });
  await fixture.runtime.init();
  fixture.context.chat[0].content = "更新正文";
  fixture.emit("message-updated", { message_id: "updated-character" });
  await settle();
  assert.equal(fixture.calls(), 0);
  fixture.runtime.destroy();
});

test("normal generation uses Character counter, while regenerate forces once", async () => {
  const fixture = createFixture({
    messages: [{ message_id: "generation-character", floor: 1, content: "原文", role: "assistant" }],
  });
  configureScheduler(fixture, { interval: 2 });
  await fixture.runtime.init();
  fixture.emit("generation-started", "normal");
  fixture.context.chat[0].content = "普通生成正文";
  fixture.emit("character-message-rendered", { message_id: "generation-character" });
  await settle();
  assert.equal(fixture.calls(), 0);
  fixture.emit("generation-started", { genType: "regenerate", message_id: "generation-character" });
  fixture.emit("generation-ended", { message_id: "generation-character" });
  fixture.emit("character-message-rendered", { message_id: "generation-character" });
  await settle();
  assert.equal(fixture.calls(), 0);
  fixture.emit("generation-started", { genType: "regenerate", message_id: "generation-character" });
  fixture.context.chat[0].content = "重新生成正文";
  fixture.emit("generation-ended", { message_id: "generation-character" });
  fixture.emit("character-message-rendered", { message_id: "generation-character" });
  await settle();
  assert.equal(fixture.calls(), 1);
  fixture.runtime.destroy();
});

test("normal generation also waits for the settle barrier", async () => {
  let calls = 0;
  const fixture = createFixture({
    messages: [{ message_id: "normal-barrier", floor: 1, content: "原文", role: "assistant" }],
    analyzer: {
      async analyzeWorldModel() {
        calls += 1;
        return normalizeWorldModel({ schema_version: 1, species: [{ name: "世界" }] });
      },
      async analyzeFloor() {
        return { events: [] };
      },
    },
  });
  configureScheduler(fixture, { interval: 1 });
  await fixture.runtime.init();
  fixture.emit("generation-started", "normal");
  fixture.context.chat[0].content = "普通生成最终正文";
  fixture.emit("character-message-rendered", { message_id: "normal-barrier" });
  await settle();
  assert.equal(calls, 0);
  fixture.emit("generation-ended", { message_id: "normal-barrier" });
  await settle();
  assert.equal(calls, 1);
  fixture.runtime.destroy();
});

test("real ST reroll order uses positional generation type and renders after GENERATION_ENDED", async () => {
  const fixture = createFixture({
    messages: [{ message_id: "real-reroll", floor: 1, content: "原文", role: "assistant" }],
  });
  configureScheduler(fixture, { interval: 99 });
  await fixture.runtime.init();

  fixture.emit("generation-started", "regenerate");
  fixture.emit("generation-ended", 1);
  await settle();
  assert.equal(fixture.calls(), 0);
  fixture.context.chat[0].content = "真实重新生成后的正文";
  fixture.emit("character-message-rendered", 0, "regenerate");
  await settle();

  assert.equal(fixture.calls(), 1);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().pendingGeneration, null);
  fixture.runtime.destroy();
});

test("generation settle barrier supports CMR before ENDED without World AI or terminal persistence", async () => {
  let worldCalls = 0;
  let eventCalls = 0;
  const fixture = createFixture({
    messages: [{ message_id: "barrier-cmr-first", floor: 1, content: "原文", role: "assistant" }],
    analyzer: {
      async analyzeWorldModel() {
        worldCalls += 1;
        return normalizeWorldModel({ schema_version: 1, species: [{ name: "人类", biological_types: [] }] });
      },
      async analyzeFloor() {
        eventCalls += 1;
        return { events: [] };
      },
    },
  });
  configureScheduler(fixture, { interval: 1 });
  await fixture.runtime.init();
  fixture.emit("generation-started", { genType: "regenerate", message_id: "barrier-cmr-first" });
  fixture.context.chat[0].content = "最终正文";
  fixture.emit("character-message-rendered", { message_id: "barrier-cmr-first" });
  await settle();
  assert.equal(worldCalls, 0);
  assert.equal(eventCalls, 0);
  assert.equal(fixture.saveFloorCalls(), 0);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().pendingGeneration.finalFloorSeen, true);
  fixture.emit("generation-ended", { message_id: "barrier-cmr-first" });
  await settle();
  assert.equal(worldCalls, 1);
  assert.equal(eventCalls, 1);
  const stages = fixture.runtime.getPersistenceTrace().sequence.map(entry => entry.stage);
  for (const stage of [
    "GENERATION_INTENT_CREATED",
    "GENERATION_FINAL_FLOOR_SEEN",
    "GENERATION_SETTLE_WAITING",
    "GENERATION_END_SEEN",
    "GENERATION_SETTLED",
  ]) assert.ok(stages.includes(stage), stage);
  fixture.runtime.destroy();
});

test("settled generation consumes duplicate lifecycle events once and supersedes an older intent", async () => {
  let calls = 0;
  const fixture = createFixture({
    messages: [{ message_id: "barrier-supersede", floor: 1, content: "原文", role: "assistant" }],
    analyzer: {
      async analyzeFloor() {
        calls += 1;
        return { events: [] };
      },
    },
  });
  configureScheduler(fixture, { interval: 1 });
  await fixture.runtime.init();
  fixture.emit("generation-started", { genType: "regenerate", message_id: "barrier-supersede", generation_id: "old" });
  fixture.emit("generation-started", { genType: "regenerate", message_id: "barrier-supersede", generation_id: "new" });
  fixture.context.chat[0].content = "新正文";
  fixture.emit("generation-ended", { message_id: "barrier-supersede", generation_id: "new" });
  fixture.emit("character-message-rendered", { message_id: "barrier-supersede" });
  await settle();
  fixture.emit("generation-ended", { message_id: "barrier-supersede", generation_id: "new" });
  fixture.emit("character-message-rendered", { message_id: "barrier-supersede" });
  await settle();
  assert.equal(calls, 1);
  const stages = fixture.runtime.getPersistenceTrace().sequence.map(entry => entry.stage);
  assert.equal(stages.filter(stage => stage === "GENERATION_SETTLED").length, 1);
  assert.ok(stages.includes("GENERATION_INTENT_SUPERSEDED"));
  fixture.runtime.destroy();
});

test("automatic analysis trace preserves real lifecycle order and one execution trigger", async () => {
  const fixture = createFixture({
    messages: [{ message_id: "trace-reroll", floor: 1, content: "原文", role: "assistant" }],
  });
  configureScheduler(fixture, { interval: 99 });
  await fixture.runtime.init();
  fixture.emit("generation-started", "regenerate");
  fixture.emit("generation-ended", 1);
  fixture.context.chat[0].content = "新正文";
  fixture.emit("character-message-rendered", { message_id: "trace-reroll" });
  fixture.emit("character-message-rendered", { message_id: "trace-reroll" });
  await settle();
  const trace = fixture.runtime.getPersistenceTrace();
  assert.ok(trace);
  const stages = trace.sequence.map(entry => entry.stage);
  assert.ok(stages.indexOf("GENERATION_STARTED") >= 0);
  assert.ok(stages.indexOf("GENERATION_ENDED") >= 0);
  assert.ok(stages.indexOf("CHARACTER_MESSAGE_RENDERED") >= 0);
  assert.equal(stages.filter(stage => stage === "AUTO_ANALYSIS_TRIGGERED").length, 1);
  assert.equal(stages.filter(stage => stage === "WORLD_ACCEPTED").length, 1);
  assert.ok(trace.sequence.every((entry, index, all) => index === 0 || entry.seq > all[index - 1].seq));
  fixture.runtime.destroy();
});

test("automatic failure trace separates reroll trigger from the actual failure", async () => {
  const fixture = createFixture({saveFloorError: "ST_FLOOR_STORAGE_UNAVAILABLE"});
  configureScheduler(fixture, {interval: 1});
  await fixture.runtime.init();
  fixture.emit("character-message-rendered", {message_id: "message-stable"});
  await settle();
  const trace = fixture.runtime.getPersistenceTrace();
  const failure = trace?.sequence.find(entry => entry.stage === "ANALYSIS_FAILED");
  assert.ok(failure);
  assert.equal(failure.trigger, "CHARACTER_MESSAGE_RENDERED");
  assert.ok(failure.failure_stage);
  assert.ok(failure.error_code);
  assert.ok(failure.error_message);
  assert.ok(failure.diagnostic_code);
  fixture.runtime.destroy();
});

test("one reroll lifecycle consumes later duplicate CMRs even when streaming changes the Floor Version", async () => {
  let worldCalls = 0;
  let eventCalls = 0;
  const fixture = createFixture({
    messages: [{ message_id: "streaming-reroll", floor: 1, content: "原文", role: "assistant" }],
    analyzer: {
      async analyzeWorldModel() {
        worldCalls += 1;
        return normalizeWorldModel({ schema_version: 1, species: [{ name: "人类", biological_types: [] }] });
      },
      async analyzeFloor() {
        eventCalls += 1;
        return { events: [] };
      },
    },
  });
  configureScheduler(fixture, { interval: 1, retry: true });
  await fixture.runtime.init();

  fixture.emit("generation-started", "regenerate");
  fixture.context.chat[0].content = "重新生成中的正文";
  fixture.emit("generation-ended", 1);
  fixture.emit("character-message-rendered", 0, "regenerate");
  await settle();
  assert.equal(worldCalls, 1);
  assert.equal(eventCalls, 1);

  fixture.context.chat[0].content = "重新生成最终正文";
  fixture.emit("character-message-rendered", 0, "regenerate");
  await settle();
  assert.equal(worldCalls, 1);
  assert.equal(eventCalls, 1);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().counter, 0);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().completedGeneration !== null, true);
  fixture.runtime.destroy();
});

test("real ST swipe generation waits for the new Swipe Floor Version", async () => {
  const message = {
    message_id: "real-swipe",
    floor: 1,
    swipe_id: 0,
    swipes: ["原 Swipe"],
    swipe_info: [{}],
    role: "assistant",
  };
  const fixture = createFixture({ messages: [message] });
  configureScheduler(fixture, { interval: 99 });
  await fixture.runtime.init();

  message.swipe_id = 1;
  message.swipes.push("...");
  message.swipe_info.push({});
  fixture.emit("message-swiped", 0);
  await settle();
  fixture.emit("generation-started", "swipe");
  await settle();
  assert.ok(fixture.runtime.getAutoAnalysisSchedulerState().pendingSwipeGeneration);
  fixture.emit("generation-ended", 1);
  await settle();
  message.swipes[1] = "新 Swipe 正文";
  fixture.emit("character-message-rendered", 0);
  await settle();

  assert.equal(fixture.calls(), 1);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().pendingSwipeGeneration, null);
  fixture.runtime.destroy();
});

test("generation intent without a new Floor Version is consumed without analysis", async () => {
  const fixture = createFixture({
    messages: [{ message_id: "unchanged-reroll", floor: 1, content: "原文", role: "assistant" }],
  });
  configureScheduler(fixture, { interval: 99 });
  await fixture.runtime.init();
  fixture.emit("generation-started", "regenerate");
  fixture.emit("generation-ended", 1);
  fixture.emit("character-message-rendered", 0);
  await settle();
  assert.equal(fixture.calls(), 0);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().pendingGeneration, null);
  fixture.runtime.destroy();
});

test("existing Swipe reuse makes no API call, pending Swipe generation analyzes once", async () => {
  const message = {
    message_id: "swipe-scheduler",
    floor: 1,
    swipe_id: 0,
    swipes: ["已分析", "新生成"],
    swipe_info: [{}, {}],
    role: "assistant",
  };
  const fixture = createFixture({ messages: [message] });
  configureScheduler(fixture, { interval: 2 });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const callsBeforeSwitch = fixture.calls();
  message.swipe_id = 0;
  fixture.emit("message-swiped", { message_id: message.message_id, swipe_id: 0 });
  await settle();
  assert.equal(fixture.calls(), callsBeforeSwitch);
  message.swipe_id = 1;
  fixture.emit("message-swiped", { message_id: message.message_id, swipe_id: 1 });
  await settle();
  assert.equal(fixture.calls(), callsBeforeSwitch);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().counter, 0);
  fixture.emit("message-swiped", { message_id: message.message_id, swipe_id: 1, pendingGeneration: true });
  fixture.context.chat[0].swipes[1] = "新生成定型";
  fixture.emit("generation-ended", { message_id: message.message_id, swipe_id: 1 });
  fixture.emit("character-message-rendered", { message_id: message.message_id, swipe_id: 1 });
  await settle();
  assert.equal(fixture.calls(), callsBeforeSwitch + 1);
  fixture.runtime.destroy();
});

test("stopped or cancelled generation clears an unrendered reroll intent", async () => {
  const fixture = createFixture({
    messages: [{ message_id: "cancelled-reroll", floor: 1, content: "原文", role: "assistant" }],
  });
  configureScheduler(fixture, { interval: 1 });
  await fixture.runtime.init();
  for (const terminalType of ["generation-stopped", "generation-cancelled"]) {
    fixture.emit("generation-started", {
      genType: "regenerate",
      message_id: "cancelled-reroll",
    });
    await settle();
    assert.ok(fixture.runtime.getAutoAnalysisSchedulerState().pendingGeneration);
    fixture.emit(terminalType, { message_id: "cancelled-reroll" });
    await settle();
    assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().pendingGeneration, null);
    fixture.emit("character-message-rendered", { message_id: "cancelled-reroll" });
    await settle();
    assert.equal(fixture.calls(), 0);
  }
  fixture.runtime.destroy();

  const swipeMessage = {
    message_id: "cancelled-swipe",
    floor: 1,
    swipe_id: 0,
    swipes: ["已有 Swipe", "未定型 Swipe"],
    swipe_info: [{}, {}],
    role: "assistant",
  };
  const swipeFixture = createFixture({ messages: [swipeMessage] });
  configureScheduler(swipeFixture, { interval: 1 });
  await swipeFixture.runtime.init();
  swipeMessage.swipe_id = 1;
  swipeFixture.emit("message-swiped", {
    message_id: "cancelled-swipe",
    swipe_id: 1,
    pendingGeneration: true,
  });
  await settle();
  assert.ok(swipeFixture.runtime.getAutoAnalysisSchedulerState().pendingSwipeGeneration);
  swipeFixture.emit("generation-cancelled", { message_id: "cancelled-swipe", swipe_id: 1 });
  await settle();
  assert.equal(swipeFixture.runtime.getAutoAnalysisSchedulerState().pendingSwipeGeneration, null);
  swipeFixture.emit("character-message-rendered", { message_id: "cancelled-swipe", swipe_id: 1 });
  await settle();
  assert.equal(swipeFixture.calls(), 0);
  swipeFixture.runtime.destroy();
});

test("retry=true keeps counter full and retries on the next Character Floor", async () => {
  let calls = 0;
  const fixture = createFixture({
    analyzer: {
      async analyzeFloor() {
        calls += 1;
        if (calls === 1) throw new Error("AUTO_FAILED");
        return { events: [] };
      },
    },
    messages: [{ message_id: "retry-1", floor: 1, content: "一", role: "assistant" }],
  });
  configureScheduler(fixture, { interval: 1, retry: true });
  await fixture.runtime.init();
  fixture.emit("character-message-rendered", { message_id: "retry-1" });
  await settle();
  assert.equal(calls, 1);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().counter, 1);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().retryPaused, false);
  appendCharacter(fixture, "retry-2", 2);
  await settle();
  assert.equal(calls, 2);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().counter, 0);
  fixture.runtime.destroy();
});

test("retry=false pauses automatic retry until Manual Refresh succeeds", async () => {
  let calls = 0;
  const fixture = createFixture({
    analyzer: {
      async analyzeFloor() {
        calls += 1;
        if (calls < 3) throw new Error("AUTO_FAILED");
        return { events: [] };
      },
    },
    messages: [{ message_id: "paused-1", floor: 1, content: "一", role: "assistant" }],
  });
  configureScheduler(fixture, { interval: 1, retry: false });
  await fixture.runtime.init();
  fixture.emit("character-message-rendered", { message_id: "paused-1" });
  await settle();
  assert.equal(calls, 1);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().retryPaused, true);
  fixture.context.chat[0].content = "普通编辑";
  fixture.emit("message-edited", { message_id: "paused-1" });
  appendCharacter(fixture, "paused-2", 2);
  await settle();
  assert.equal(calls, 1);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().retryPaused, true);
  await assert.rejects(fixture.runtime.refreshCurrentFloorAnalysis(), /AUTO_FAILED/u);
  assert.equal(calls, 2);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().retryPaused, true);
  await fixture.runtime.refreshCurrentFloorAnalysis();
  assert.equal(calls, 3);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().counter, 0);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().retryPaused, false);
  fixture.runtime.destroy();
});

test("paused reroll success clears the due state", async () => {
  let calls = 0;
  const fixture = createFixture({
    analyzer: {
      async analyzeFloor() {
        calls += 1;
        if (calls === 1) throw new Error("AUTO_FAILED");
        return { events: [] };
      },
    },
    messages: [{ message_id: "paused-reroll", floor: 1, content: "原文", role: "assistant" }],
  });
  configureScheduler(fixture, { interval: 1, retry: false });
  await fixture.runtime.init();
  fixture.emit("character-message-rendered", { message_id: "paused-reroll" });
  await settle();
  fixture.emit("generation-started", { genType: "regenerate", message_id: "paused-reroll" });
  fixture.emit("generation-ended", { message_id: "paused-reroll" });
  fixture.context.chat[0].content = "重新生成";
  fixture.emit("character-message-rendered", { message_id: "paused-reroll" });
  await settle();
  assert.equal(calls, 2);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().counter, 0);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().retryPaused, false);
  fixture.runtime.destroy();
});

test("paused reroll failure remains paused", async () => {
  let calls = 0;
  const fixture = createFixture({
    analyzer: { async analyzeFloor() { calls += 1; throw new Error("REROLL_FAILED"); } },
    messages: [{ message_id: "paused-reroll-failed", floor: 1, content: "原文", role: "assistant" }],
  });
  configureScheduler(fixture, { interval: 1, retry: false });
  await fixture.runtime.init();
  fixture.emit("character-message-rendered", { message_id: "paused-reroll-failed" });
  await settle();
  fixture.emit("generation-started", { genType: "regenerate", message_id: "paused-reroll-failed" });
  fixture.emit("generation-ended", { message_id: "paused-reroll-failed" });
  fixture.context.chat[0].content = "重新生成失败";
  fixture.emit("character-message-rendered", { message_id: "paused-reroll-failed" });
  await settle();
  assert.equal(calls, 2);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().counter, 1);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().retryPaused, true);
  fixture.runtime.destroy();
});

test("retryPaused ignores User, edit, update, and delete lifecycle signals", async () => {
  let calls = 0;
  const fixture = createFixture({
    analyzer: { async analyzeFloor() { calls += 1; throw new Error("PAUSED_FAILED"); } },
    messages: [{ message_id: "paused-signals", floor: 1, content: "原文", role: "assistant" }],
  });
  configureScheduler(fixture, { interval: 1, retry: false });
  await fixture.runtime.init();
  fixture.emit("character-message-rendered", { message_id: "paused-signals" });
  await settle();
  fixture.context.chat[0].content = "编辑正文";
  fixture.emit("message-edited", { message_id: "paused-signals" });
  fixture.emit("message-updated", { message_id: "paused-signals" });
  fixture.context.chat.push({ message_id: "paused-user", floor: 2, content: "用户", role: "user" });
  fixture.emit("message-received", { message_id: "paused-user" });
  fixture.emit("message-deleted", { message_id: "paused-user" });
  await settle();
  assert.equal(calls, 1);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().counter, 1);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().retryPaused, true);
  fixture.runtime.destroy();
});

test("World failure makes zero Character/Event API calls and retries the full World chain", async () => {
  let worldCalls = 0;
  let eventCalls = 0;
  const fixture = createFixture({
    analyzer: {
      async analyzeWorldModel() {
        worldCalls += 1;
        if (worldCalls === 1) throw new Error("WORLD_FAILED");
        return normalizeWorldModel({ schema_version: 1, species: [{ name: "人类", biological_types: [] }] });
      },
      async analyzeFloor() {
        eventCalls += 1;
        return { events: [] };
      },
    },
    messages: [{ message_id: "world-retry-1", floor: 1, content: "一", role: "assistant" }],
  });
  configureScheduler(fixture, { interval: 1, retry: true });
  await fixture.runtime.init();
  fixture.emit("character-message-rendered", { message_id: "world-retry-1" });
  await settle();
  assert.equal(worldCalls, 1);
  assert.equal(eventCalls, 0);
  appendCharacter(fixture, "world-retry-2", 2);
  await settle();
  assert.equal(worldCalls, 2);
  assert.equal(eventCalls, 1);
  fixture.runtime.destroy();
});

test("World persistence without a renderable UI model blocks Character/Event analysis", async () => {
  let worldCalls = 0;
  let eventCalls = 0;
  const fixture = createFixture({
    analyzer: {
      async analyzeWorldModel() {
        worldCalls += 1;
        return normalizeWorldModel({ schema_version: 1, species: [] });
      },
      async analyzeFloor() {
        eventCalls += 1;
        return { events: [] };
      },
    },
    messages: [{ message_id: "world-ui-not-ready", floor: 1, content: "空世界", role: "assistant" }],
  });
  configureScheduler(fixture, { interval: 1, retry: false });
  await fixture.runtime.init();
  await assert.rejects(
    fixture.runtime.analyzeFloor({ __messageIndex: true, index: 0 }, { force: true }),
    error => error?.code === "WORLD_MODEL_UI_NOT_READY",
  );
  assert.equal(worldCalls, 1);
  assert.equal(eventCalls, 0);
  assert.equal(fixture.runtime.store.getFloor(0).world_model.species.length, 0);
  fixture.runtime.destroy();
});

test("World canonical UI readiness failure retries the complete World stage", async () => {
  let worldCalls = 0;
  let eventCalls = 0;
  const fixture = createFixture({
    retryCount: 1,
    analyzer: {
      async analyzeWorldModel() {
        worldCalls += 1;
        return normalizeWorldModel({
          schema_version: 1,
          species: worldCalls === 1 ? [] : [{ name: "可显示世界" }],
        });
      },
      async analyzeFloor() {
        eventCalls += 1;
        return { events: [] };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  assert.equal(worldCalls, 2);
  assert.equal(eventCalls, 1);
  const trace = fixture.runtime.getPersistenceTrace().sequence;
  assert.ok(trace.some(item => item.stage === "WORLD_STAGE_ATTEMPT_FAILED" &&
    ["world_readback", "world_view_model", "world_ui_ready"].includes(item.failure_stage)));
  assert.ok(trace.some(item => item.stage === "WORLD_STAGE_ATTEMPT_SUCCEEDED" && item.retry_index === 1));
  fixture.runtime.destroy();
});

test("World stage retry repeats the complete AI-to-ready chain after persistence failure", async () => {
  let worldCalls = 0;
  let eventCalls = 0;
  let saveCalls = 0;
  const fixture = createFixture({
    retryCount: 1,
    saveFloorHook: async () => {
      saveCalls += 1;
      if (saveCalls === 1) throw new Error("ST_FLOOR_STORAGE_UNAVAILABLE");
    },
    analyzer: {
      async analyzeWorldModel() {
        worldCalls += 1;
        return normalizeWorldModel({ schema_version: 1, species: [{ name: `世界-${worldCalls}` }] });
      },
      async analyzeFloor() {
        eventCalls += 1;
        return { events: [] };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  assert.equal(worldCalls, 2);
  assert.equal(eventCalls, 1);
  const trace = fixture.runtime.getPersistenceTrace().sequence;
  assert.deepEqual(
    trace.filter(item => item.stage === "WORLD_STAGE_ATTEMPT_BEGIN")
      .map(item => [item.retry_index, item.max_retries]),
    [[0, 1], [1, 1]],
  );
  assert.ok(trace.some(item => item.stage === "WORLD_STAGE_RETRY_SCHEDULED"));
  assert.ok(trace.some(item => item.stage === "WORLD_STAGE_ATTEMPT_SUCCEEDED" && item.retry_index === 1));
  fixture.runtime.destroy();
});

test("official version convergence mismatch retries the complete World stage", async () => {
  let worldCalls = 0;
  let eventCalls = 0;
  let saveCalls = 0;
  const fixture = createFixture({
    retryCount: 1,
    saveFloorHook: async ({ value }) => {
      saveCalls += 1;
      if (saveCalls !== 1) return;
      const actual = { ...value.floor_version, content_hash: "server-not-yet-converged" };
      const error = new Error("STALE_FLOOR_VERSION");
      error.code = "STALE_FLOOR_VERSION";
      error.version_check_source = "official_owner";
      error.version_audit = {
        expected: value.floor_version,
        actual,
        content_hash_match: false,
        mismatch_fields: ["content_hash"],
      };
      throw error;
    },
    analyzer: {
      async analyzeWorldModel() {
        worldCalls += 1;
        return normalizeWorldModel({ schema_version: 1, species: [{ name: `世界-${worldCalls}` }] });
      },
      async analyzeFloor() {
        eventCalls += 1;
        return { events: [] };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  assert.equal(worldCalls, 2);
  assert.equal(eventCalls, 1);
  const sequence = fixture.runtime.getPersistenceTrace().sequence;
  assert.ok(sequence.some(item => item.stage === "WORLD_VERSION_MISMATCH_CLASSIFIED" &&
    item.classification === "temporary_server_convergence" && item.retryable === true));
  assert.deepEqual(
    sequence.filter(item => item.stage === "WORLD_AI_ATTEMPT_BEGIN").map(item => item.retry_index),
    [0, 1],
  );
  fixture.runtime.destroy();
});

test("automatic analysis does not use saveChat convergence before World AI", async () => {
  const order = [];
  let worldCalls = 0;
  let eventCalls = 0;
  const fixture = createFixture({
    convergeFloorOwner: async () => {
      order.push("converge");
      return {converged: true};
    },
    analyzer: {
      async analyzeWorldModel() {
        order.push("world");
        worldCalls += 1;
        return normalizeWorldModel({ schema_version: 1, species: [{ name: "世界" }] });
      },
      async analyzeFloor() {
        order.push("event");
        eventCalls += 1;
        return {events: []};
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor(
    {__messageIndex: true, index: 0},
    {force: true, reason: "automatic"},
  );
  assert.deepEqual(order, ["world", "event"]);
  assert.equal(fixture.convergeFloorOwnerCalls(), 0);
  assert.equal(worldCalls, 1);
  assert.equal(eventCalls, 1);
  fixture.runtime.destroy();
});

test("automatic analysis input readiness does not consume a Stage retry for official lag", async () => {
  let worldCalls = 0;
  const fixture = createFixture({
    retryCount: 3,
    convergeFloorOwner: async () => {
      throw new Error("OLD_CONVERGENCE_PATH_MUST_NOT_RUN");
    },
    analyzer: {
      async analyzeWorldModel() {
        worldCalls += 1;
        return normalizeWorldModel({ schema_version: 1, species: [{ name: "不应请求" }] });
      },
      async analyzeFloor() { return {events: []}; },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor(
    {__messageIndex: true, index: 0},
    {force: true, reason: "automatic"},
  );
  assert.equal(worldCalls, 1);
  assert.equal(fixture.convergeFloorOwnerCalls(), 0);
  fixture.runtime.destroy();
});

test("true owner change after an official version mismatch stops without another World persistence path", async () => {
  let worldCalls = 0;
  let eventCalls = 0;
  let saveCalls = 0;
  const fixture = createFixture({
    retryCount: 1,
    saveFloorHook: async ({ value }) => {
      saveCalls += 1;
      if (saveCalls !== 1) return;
      fixture.context.chat[0].content = "正文已真正变化";
      const error = new Error("STALE_FLOOR_VERSION");
      error.code = "STALE_FLOOR_VERSION";
      error.version_check_source = "official_owner";
      error.version_audit = {
        expected: value.floor_version,
        actual: { ...value.floor_version, content_hash: "old-server-version" },
        content_hash_match: false,
        mismatch_fields: ["content_hash"],
      };
      throw error;
    },
    analyzer: {
      async analyzeWorldModel() {
        worldCalls += 1;
        return normalizeWorldModel({ schema_version: 1, species: [{ name: "世界" }] });
      },
      async analyzeFloor() {
        eventCalls += 1;
        return { events: [] };
      },
    },
  });
  await fixture.runtime.init();
  await assert.rejects(
    fixture.runtime.refreshCurrentFloorAnalysis(),
    error => error?.code === "WORLD_MODEL_PERSISTENCE_PREWRITE_FAILED" &&
      error?.cause?.code === "STALE_FLOOR_VERSION",
  );
  assert.equal(worldCalls, 1);
  assert.equal(eventCalls, 0);
  assert.equal(saveCalls, 1);
  const sequence = fixture.runtime.getPersistenceTrace().sequence;
  assert.ok(sequence.some(item => item.stage === "WORLD_VERSION_MISMATCH_CLASSIFIED" &&
    item.classification === "true_owner_change" && item.retryable === false));
  assert.deepEqual(
    sequence.filter(item => item.stage === "WORLD_STAGE_ATTEMPT_BEGIN").map(item => item.retry_index),
    [0],
  );
  fixture.runtime.destroy();
});

test("World stage retry exhaustion never starts Character/Event", async () => {
  let worldCalls = 0;
  let eventCalls = 0;
  const fixture = createFixture({
    retryCount: 1,
    saveFloorError: "ST_FLOOR_STORAGE_UNAVAILABLE",
    analyzer: {
      async analyzeWorldModel() {
        worldCalls += 1;
        return normalizeWorldModel({ schema_version: 1, species: [{ name: "世界" }] });
      },
      async analyzeFloor() {
        eventCalls += 1;
        return { events: [] };
      },
    },
  });
  await fixture.runtime.init();
  await assert.rejects(fixture.runtime.refreshCurrentFloorAnalysis(), error =>
    error?.code === "WORLD_MODEL_PERSISTENCE_PREWRITE_FAILED");
  assert.equal(worldCalls, 2);
  assert.equal(eventCalls, 0);
  assert.ok(fixture.runtime.getPersistenceTrace().sequence.some(
    item => item.stage === "WORLD_STAGE_RETRY_EXHAUSTED" && item.retry_index === 1,
  ));
  fixture.runtime.destroy();
});

test("Event stage retry repeats Event only after World is ready", async () => {
  let worldCalls = 0;
  let eventCalls = 0;
  let eventSaveFailed = false;
  const fixture = createFixture({
    retryCount: 1,
    saveFloorHook: async ({ value }) => {
      if (value?.analysis && !eventSaveFailed) {
        eventSaveFailed = true;
        throw new Error("ST_FLOOR_STORAGE_UNAVAILABLE");
      }
    },
    analyzer: {
      async analyzeWorldModel() {
        worldCalls += 1;
        return normalizeWorldModel({ schema_version: 1, species: [{ name: "世界" }] });
      },
      async analyzeFloor() {
        eventCalls += 1;
        return { events: [] };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  assert.equal(worldCalls, 1);
  assert.equal(eventCalls, 2);
  assert.ok(fixture.runtime.getPersistenceTrace().sequence.some(
    item => item.stage === "EVENT_STAGE_RETRY_SCHEDULED",
  ));
  fixture.runtime.destroy();
});

test("Event REQUEST_TIMEOUT retries the complete Event stage without rerunning World", async () => {
  let worldCalls = 0;
  let eventCalls = 0;
  const fixture = createFixture({
    retryCount: 1,
    analyzer: {
      async analyzeWorldModel() {
        worldCalls += 1;
        return normalizeWorldModel({ schema_version: 1, species: [{ name: "世界" }] });
      },
      async analyzeFloor() {
        eventCalls += 1;
        if (eventCalls === 1) {
          throw Object.assign(new Error("REQUEST_TIMEOUT"), {
            code: "REQUEST_TIMEOUT",
            diagnosticCode: "timeout",
            retryable: false,
            analysis_stage: "api_request",
          });
        }
        return { events: [] };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  assert.equal(worldCalls, 1);
  assert.equal(eventCalls, 2);
  const trace = fixture.runtime.getPersistenceTrace().sequence;
  assert.ok(trace.some(item => item.stage === "EVENT_STAGE_ATTEMPT_FAILED" &&
    item.retry_index === 0 && item.failure_code === "REQUEST_TIMEOUT" &&
    item.retryable === true && item.retry_decision === "retry"));
  assert.ok(trace.some(item => item.stage === "EVENT_STAGE_RETRY_SCHEDULED" &&
    item.next_retry_index === 1));
  assert.ok(trace.some(item => item.stage === "EVENT_AI_ATTEMPT_BEGIN" &&
    item.retry_index === 1));
  assert.equal(trace.filter(item => item.stage === "WORLD_SAVE_BEGIN").length, 1);
  fixture.runtime.destroy();
});

test("Event timeout retry exhausts at the configured additional retry limit", async () => {
  let eventCalls = 0;
  const fixture = createFixture({
    retryCount: 1,
    analyzer: {
      async analyzeWorldModel() {
        return normalizeWorldModel({ schema_version: 1, species: [{ name: "世界" }] });
      },
      async analyzeFloor() {
        eventCalls += 1;
        throw Object.assign(new Error("REQUEST_TIMEOUT"), {
          code: "REQUEST_TIMEOUT",
          diagnosticCode: "timeout",
          retryable: false,
          analysis_stage: "api_request",
        });
      },
    },
  });
  await fixture.runtime.init();
  await assert.rejects(fixture.runtime.refreshCurrentFloorAnalysis(), /REQUEST_TIMEOUT/u);
  assert.equal(eventCalls, 2);
  const status = await fixture.runtime.getCurrentFloorAnalysisStatus();
  assert.match(status.safe_error_summary, /已耗尽本阶段重试次数/u);
  const trace = fixture.runtime.getPersistenceTrace().sequence;
  assert.ok(trace.some(item => item.stage === "EVENT_STAGE_RETRY_EXHAUSTED" &&
    item.retry_index === 1));
  const exhausted = trace.find(item => item.stage === "EVENT_STAGE_RETRY_EXHAUSTED");
  assert.equal(trace.filter(item => item.seq > exhausted.seq && item.stage === "WORLD_SAVE_BEGIN").length, 0);
  fixture.runtime.destroy();
});

test("retry_count zero does not retry an Event timeout", async () => {
  let eventCalls = 0;
  const fixture = createFixture({
    retryCount: 0,
    analyzer: {
      async analyzeWorldModel() {
        return normalizeWorldModel({ schema_version: 1, species: [{ name: "世界" }] });
      },
      async analyzeFloor() {
        eventCalls += 1;
        throw Object.assign(new Error("REQUEST_TIMEOUT"), {
          code: "REQUEST_TIMEOUT",
          diagnosticCode: "timeout",
          retryable: false,
          analysis_stage: "api_request",
        });
      },
    },
  });
  await fixture.runtime.init();
  await assert.rejects(fixture.runtime.refreshCurrentFloorAnalysis(), /REQUEST_TIMEOUT/u);
  assert.equal(eventCalls, 1);
  assert.equal(
    fixture.runtime.getPersistenceTrace().sequence
      .filter(item => item.stage === "EVENT_STAGE_RETRY_SCHEDULED").length,
    0,
  );
  fixture.runtime.destroy();
});

test("retry_count three permits four complete Event stage attempts", async () => {
  let eventCalls = 0;
  const fixture = createFixture({
    retryCount: 3,
    analyzer: {
      async analyzeWorldModel() {
        return normalizeWorldModel({ schema_version: 1, species: [{ name: "世界" }] });
      },
      async analyzeFloor() {
        eventCalls += 1;
        if (eventCalls <= 3) {
          throw Object.assign(new Error("REQUEST_TIMEOUT"), {
            code: "REQUEST_TIMEOUT",
            diagnosticCode: "timeout",
            retryable: false,
            analysis_stage: "api_request",
          });
        }
        return { events: [] };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  assert.equal(eventCalls, 4);
  assert.deepEqual(
    fixture.runtime.getPersistenceTrace().sequence
      .filter(item => item.stage === "EVENT_STAGE_ATTEMPT_BEGIN")
      .map(item => item.retry_index),
    [0, 1, 2, 3],
  );
  fixture.runtime.destroy();
});

test("stage retry config prefers the current persisted global setting over a stale profile snapshot", async () => {
  let worldCalls = 0;
  const fixture = createFixture({
    retryCount: 3,
    analyzer: {
      async analyzeWorldModel() {
        worldCalls += 1;
        throw Object.assign(new Error("REQUEST_TIMEOUT"), {
          code: "REQUEST_TIMEOUT",
          analysis_stage: "api_request",
        });
      },
      async analyzeFloor() {
        return {events: []};
      },
    },
  });
  fixture.runtime.store.profileStore.getApiRequestSettings = () => ({retry_count: 1});
  await fixture.runtime.init();
  await assert.rejects(
    fixture.runtime.refreshCurrentFloorAnalysis(),
    /REQUEST_TIMEOUT|WORLD_MODEL_UNAVAILABLE/u,
  );
  assert.equal(worldCalls, 4);
  const config = fixture.runtime.getPersistenceTrace().sequence.find(
    item => item.stage === "ANALYSIS_RETRY_CONFIG_RESOLVED",
  );
  assert.deepEqual(
    {
      configured_retry_count: config.configured_retry_count,
      normalized_retry_count: config.normalized_retry_count,
      world_max_retries: config.world_max_retries,
      event_max_retries: config.event_max_retries,
    },
    {
      configured_retry_count: 3,
      normalized_retry_count: 3,
      world_max_retries: 3,
      event_max_retries: 3,
    },
  );
  fixture.runtime.destroy();
});

test("AbortError marked by the timeout controller retries, while explicit cancellation remains terminal", async () => {
  let eventCalls = 0;
  const fixture = createFixture({
    retryCount: 1,
    analyzer: {
      async analyzeWorldModel() {
        return normalizeWorldModel({ schema_version: 1, species: [{ name: "世界" }] });
      },
      async analyzeFloor() {
        eventCalls += 1;
        if (eventCalls === 1) {
          throw Object.assign(new Error("aborted by timeout controller"), {
            name: "AbortError",
            timedOut: true,
            analysis_stage: "api_request",
          });
        }
        return { events: [] };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  assert.equal(eventCalls, 2);
  fixture.runtime.destroy();

  let release;
  let startedResolve;
  const started = new Promise(resolve => { startedResolve = resolve; });
  const cancelledFixture = createFixture({
    retryCount: 1,
    analyzer: {
      async analyzeWorldModel() {
        return normalizeWorldModel({ schema_version: 1, species: [{ name: "世界" }] });
      },
      analyzeFloor() {
        startedResolve();
        return new Promise(resolve => { release = resolve; });
      },
    },
  });
  await cancelledFixture.runtime.init();
  const pending = cancelledFixture.runtime.refreshCurrentFloorAnalysis();
  await started;
  assert.equal(await cancelledFixture.runtime.requestAbortCurrentFloorAnalysis(), true);
  release({ events: [] });
  await assert.rejects(pending, /REQUEST_ABORTED/u);
  assert.equal(cancelledFixture.runtime.getPersistenceTrace().sequence
    .filter(item => item.stage === "EVENT_AI_ATTEMPT_BEGIN").length, 1);
  cancelledFixture.runtime.destroy();
});

test("Event stage persistence/readback failure retries Event without rerunning World", async () => {
  let worldCalls = 0;
  let eventCalls = 0;
  let corruptFirstEventSlot = true;
  const fixture = createFixture({
    retryCount: 1,
    saveFloorHook: async ({ value }) => {
      if (value?.analysis && corruptFirstEventSlot) {
        corruptFirstEventSlot = false;
        delete value.character_registry;
      }
    },
    analyzer: {
      async analyzeWorldModel() {
        worldCalls += 1;
        return normalizeWorldModel({ schema_version: 1, species: [{ name: "世界" }] });
      },
      async analyzeFloor() {
        eventCalls += 1;
        return { events: [] };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  assert.equal(worldCalls, 1);
  assert.equal(eventCalls, 2);
  const trace = fixture.runtime.getPersistenceTrace().sequence;
  assert.ok(trace.some(item => item.stage === "EVENT_STAGE_RETRY_SCHEDULED"));
  assert.ok(trace.some(item => item.stage === "EVENT_STAGE_ATTEMPT_SUCCEEDED" && item.retry_index === 1));
  fixture.runtime.destroy();
});

test("Character/Event failure preserves the prior World and retries with World reuse", async () => {
  let worldCalls = 0;
  let eventCalls = 0;
  const fixture = createFixture({
    analyzer: {
      async analyzeWorldModel() {
        worldCalls += 1;
        return normalizeWorldModel({ schema_version: 1, species: [{ name: "World A" }] });
      },
      async analyzeFloor() {
        eventCalls += 1;
        if (eventCalls === 1) throw new Error("EVENT_FAILED");
        return { events: [] };
      },
    },
    messages: [{ message_id: "event-retry-1", floor: 1, content: "一", role: "assistant" }],
  });
  configureScheduler(fixture, { interval: 1, retry: true });
  await fixture.runtime.init();
  fixture.emit("character-message-rendered", { message_id: "event-retry-1" });
  await settle();
  const firstWorld = fixture.runtime.store.getFloor(0).world_model;
  appendCharacter(fixture, "event-retry-2", 2);
  await settle();
  assert.equal(worldCalls, 1);
  assert.equal(eventCalls, 2);
  assert.deepEqual(fixture.runtime.store.getFloor(0).world_model, firstWorld);
  assert.deepEqual(
    (await fixture.runtime.resolveWorldModelAtOrBefore({ __messageIndex: true, index: 1 })).model,
    firstWorld,
  );
  fixture.runtime.destroy();
});

test("World Patch failure retries Patch resolution on the next Character Floor", async () => {
  let patchCalls = 0;
  let eventCalls = 0;
  const worldA = normalizeWorldModel({ schema_version: 1, species: [{ name: "World A" }] });
  const fixture = createFixture({
    messages: [
      { message_id: "patch-owner", floor: 1, content: "已有世界", role: "assistant" },
      { message_id: "patch-failed", floor: 2, content: "新增世界规则：失败一次", role: "assistant" },
    ],
    analyzer: {
      async analyzeWorldModelPatch() {
        patchCalls += 1;
        if (patchCalls === 1) throw new Error("PATCH_FAILED");
        return { schema_version: 1, add: {}, update: {} };
      },
      async analyzeFloor() {
        eventCalls += 1;
        return { events: [] };
      },
    },
  });
  configureScheduler(fixture, { interval: 1, retry: true });
  await fixture.runtime.init();
  await fixture.runtime.store.saveFloor(0, 0, {
    ...emptyFloor(),
    floor_version: await floorVersion({
      chatId: "chat-runtime",
      messageId: "patch-owner",
      floor: 1,
      text: "已有世界",
    }),
    world_model: worldA,
  });
  fixture.emit("character-message-rendered", { message_id: "patch-failed" });
  await settle();
  assert.equal(patchCalls, 1);
  assert.equal(eventCalls, 0);
  appendCharacter(fixture, "patch-retry", 3, "新增世界规则：再次尝试");
  await settle();
  assert.equal(patchCalls, 2);
  assert.equal(eventCalls, 1);
  assert.deepEqual(fixture.runtime.store.getFloor(0).world_model, worldA);
  fixture.runtime.destroy();
});

test("scheduler dedupe state stays bounded and resets at Chat/destroy boundaries", async () => {
  const fixture = createFixture({
    messages: [{ message_id: "bounded-scheduler-0", floor: 0, content: "零", role: "assistant" }],
  });
  configureScheduler(fixture, { interval: 1000 });
  await fixture.runtime.init();
  let state = fixture.runtime.getAutoAnalysisSchedulerState();
  assert.equal(state.counter, 0);
  assert.equal(state.countedFloorKeys.length, 0);
  assert.equal(state.observedFloorKeys.length, 0);
  fixture.emit("character-message-rendered", { message_id: "bounded-scheduler-0" });
  for (let index = 1; index <= 200; index += 1)
    appendCharacter(fixture, `bounded-scheduler-${index}`, index, `内容${index}`);
  await settle();
  state = fixture.runtime.getAutoAnalysisSchedulerState();
  assert.equal(fixture.calls(), 0);
  assert.ok(state.countedFloorKeys.length <= 128);
  assert.ok(state.observedFloorKeys.length <= 128);
  fixture.context.chatId = "chat-runtime-b";
  fixture.context.chat = [{ message_id: "chat-b-floor", floor: 1, content: "B", role: "assistant" }];
  fixture.emit("chat-changed", { chatId: "chat-runtime-b" });
  await settle();
  state = fixture.runtime.getAutoAnalysisSchedulerState();
  assert.equal(state.counter, 0);
  assert.equal(state.countedFloorKeys.length, 0);
  assert.equal(state.observedFloorKeys.length, 0);
  fixture.runtime.destroy();
  state = fixture.runtime.getAutoAnalysisSchedulerState();
  assert.equal(state.counter, 0);
  assert.equal(state.countedFloorKeys.length, 0);
  assert.equal(state.observedFloorKeys.length, 0);
});

test("repeated lifecycle notifications share one World-first analysis Job", async () => {
  const order = [];
  let releaseWorld;
  let worldStartedResolve;
  const worldStarted = new Promise(resolve => {
    worldStartedResolve = resolve;
  });
  const worldDone = new Promise(resolve => {
    releaseWorld = resolve;
  });
  let worldCalls = 0;
  let eventCalls = 0;
  const worldModel = normalizeWorldModel({ schema_version: 1, species: [{ name: "人类", biological_types: [] }] });
  const fixture = createFixture({
    analyzer: {
      async analyzeWorldModel() {
        worldCalls += 1;
        order.push("world-start");
        worldStartedResolve();
        await worldDone;
        order.push("world-resolved");
        return worldModel;
      },
      async analyzeFloor({ world_model }) {
        eventCalls += 1;
        order.push("character-start");
        assert.deepEqual(world_model, worldModel);
        return { events: [] };
      },
    },
  });
  await fixture.runtime.init();

  fixture.emit("generation-started", { genType: "regenerate", message_id: "message-stable" });
  fixture.context.chat[0].content = "重新生成后的正文";
  fixture.emit("character-message-rendered", { message_id: "message-stable" });
  fixture.emit("generation-ended", { message_id: "message-stable" });
  await worldStarted;
  fixture.emit("message-updated", { message_id: "message-stable" });
  releaseWorld();
  await settle();

  assert.equal(worldCalls, 1);
  assert.equal(eventCalls, 1);
  assert.deepEqual(order, ["world-start", "world-resolved", "character-start"]);
  fixture.runtime.destroy();
});

test("unrelated GENERATION_STARTED does not cancel the bound Floor execution", async () => {
  let releaseWorld;
  let worldStartedResolve;
  const worldStarted = new Promise(resolve => { worldStartedResolve = resolve; });
  const fixture = createFixture({
    analyzer: {
      async analyzeWorldModel() {
        worldStartedResolve();
        return new Promise(resolve => { releaseWorld = resolve; });
      },
      async analyzeFloor() { return { events: [] }; },
    },
  });
  configureScheduler(fixture, {interval: 1});
  await fixture.runtime.init();
  fixture.emit("character-message-rendered", {message_id: "message-stable"});
  await worldStarted;

  fixture.emit("generation-started", {
    genType: "regenerate",
    message_id: "unrelated-generation",
    generation_id: "generation-unrelated",
  });
  await settle();
  releaseWorld(normalizeWorldModel({
    schema_version: 1,
    species: [{ name: "人类", biological_types: [] }],
  }));
  await settle();

  const trace = fixture.runtime.getPersistenceTrace();
  assert.equal(trace.sequence.some(entry => entry.stage === "ANALYSIS_CANCELLED"), false);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().pendingGeneration?.generation_id,
    "generation-unrelated");
  fixture.runtime.destroy();
});

test("Floor Version mutation cancels with bounded cancellation diagnostics", async () => {
  let releaseWorld;
  let worldStartedResolve;
  const worldStarted = new Promise(resolve => { worldStartedResolve = resolve; });
  const fixture = createFixture({
    analyzer: {
      async analyzeWorldModel() {
        worldStartedResolve();
        return new Promise(resolve => { releaseWorld = resolve; });
      },
    },
  });
  configureScheduler(fixture, {interval: 1});
  await fixture.runtime.init();
  fixture.emit("character-message-rendered", {message_id: "message-stable"});
  await worldStarted;
  fixture.context.chat[0].content = "版本已变化";
  fixture.emit("message-updated", { message_id: "message-stable" });
  await settle();
  releaseWorld(normalizeWorldModel({
    schema_version: 1,
    species: [{ name: "人类", biological_types: [] }],
  }));
  await settle();

  const cancelled = fixture.runtime.getPersistenceTrace()?.sequence
    .find(entry => entry.stage === "ANALYSIS_CANCELLED");
  assert.equal(cancelled.cancel_stage, "world_post_accept_floor_version_guard");
  assert.equal(cancelled.cancel_reason, "floor-version-changed-after-world-accepted");
  assert.equal(cancelled.cancel_code, "STALE_FLOOR_VERSION");
  assert.equal(cancelled.floor_version_match, false);
  assert.equal(cancelled.execution_active, false);
  fixture.runtime.destroy();
});

test("a User message lifecycle does not re-analyze the previous Character Floor", async () => {
  const fixture = createFixture({
    messages: [
      { message_id: "character-floor", floor: 5, content: "角色楼层", role: "assistant" },
    ],
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({ __messageIndex: true, index: 0 }, { force: true });
  const callsBeforeUserMessage = fixture.calls();
  const worldBeforeUserMessage = fixture.apiRequests.length;

  fixture.context.chat.push({
    message_id: "user-message",
    floor: 6,
    content: "用户消息",
    role: "user",
  });
  fixture.emit("message-received", { message_id: "user-message" });
  await settle();

  assert.equal(fixture.calls(), callsBeforeUserMessage);
  assert.equal(fixture.apiRequests.length, worldBeforeUserMessage);
  fixture.runtime.destroy();
});

test("active Swipe switching selects isolated authoritative Floor Versions", async () => {
  const message = {
    message_id: "message-swipe",
    floor: 3,
    swipe_id: 0,
    swipes: ["版本 A", "版本 B"],
    swipe_info: [{}, {}],
    role: "assistant",
  };
  const fixture = createFixture({ messages: [message] });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  await settle();
  const firstId = (await fixture.runtime.getCurrentFloorEvents())[0].event_id;
  message.swipe_id = 1;
  fixture.emit("generation-started", { message_id: "message-swipe", swipe_id: 1 });
  fixture.emit("message-swiped", { message_id: "message-swipe", swipe_id: 1, pendingGeneration: true });
  fixture.emit("generation-ended", { message_id: "message-swipe", swipe_id: 1 });
  fixture.emit("character-message-rendered", { message_id: "message-swipe", swipe_id: 1 });
  await settle();
  const events = await fixture.runtime.getCurrentFloorEvents();
  assert.equal(events.length, 1);
  assert.notEqual(events[0].event_id, firstId);
  assert.equal(events[0].source.swipe_id, 1);
  fixture.runtime.destroy();
});

test("character clear removes Floor character facts without changing Chat configuration", async () => {
  const messages = [
    { message_id: "old-message-0", content: "旧剧情 0", role: "assistant" },
    { message_id: "old-message-1", content: "旧剧情 1", role: "assistant" },
  ];
  const oldFloors = [];
  for (let index = 0; index < messages.length; index += 1) {
    const version = await floorVersion({
      chatId: "chat-runtime",
      messageId: messages[index].message_id,
      floor: index,
      swipeId: 0,
      text: messages[index].content,
    });
    oldFloors.push({
      ...emptyFloor(),
      floor_version: version,
      analysis: { status: "success", floor_version: version },
      events: [eventResult(`old-event-${index}`, { source: version })],
      character_registry: {
        schema_version: 1,
        entities: {
          [`old-character-${index}`]: {
            character_id: `old-character-${index}`,
            display_name: `旧人物 ${index}`,
            aliases: [],
          },
        },
      },
    });
    messages[index].extra = { bioweave: oldFloors[index] };
  }
  const fixture = createFixture({ messages });
  fixture.context.chatMetadata.bioweave = emptyChat("chat-runtime");
  const settingsBefore = structuredClone(fixture.context.chatMetadata.bioweave.settings);

  await fixture.runtime.init();
  const result = await fixture.runtime.clearCharacterData();
  assert.equal(result.ok, true);
  assert.equal(result.persistence.commitState, "confirmed");
  assert.deepEqual(fixture.context.chatMetadata.bioweave.settings, settingsBefore);
  assert.deepEqual(fixture.context.chatMetadata.bioweave.data_lifecycle, {});
  for (const message of fixture.context.chat)
    assert.equal(message.extra.bioweave.events.length, 0);
  for (const message of fixture.context.chat)
    assert.deepEqual(message.extra.bioweave.character_registry, { schema_version: 1, entities: {} });
  for (const message of fixture.context.chat)
    assert.equal(message.extra.bioweave.analysis, null);
  assert.deepEqual(await fixture.runtime.getTrackingRegistry(), {
    tracking_subjects: {},
    tracking_candidates: {},
    character_profiles: {},
    character_registry: { schema_version: 1, entities: {} },
  });

  fixture.runtime.destroy();
  const reloaded = createRuntime({ adapter: fixture.adapter });
  await reloaded.init();
  assert.deepEqual(await reloaded.getTrackingRegistry(), {
    tracking_subjects: {}, tracking_candidates: {}, character_profiles: {},
    character_registry: { schema_version: 1, entities: {} },
  });
  reloaded.destroy();
});

test("character clear in an empty Chat is an idempotent no-op", async () => {
  const fixture = createFixture({ messages: [] });
  fixture.context.chatMetadata.bioweave = emptyChat("chat-runtime");

  await fixture.runtime.init();
  const result = await fixture.runtime.clearCharacterData();
  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
  assert.deepEqual(fixture.context.chatMetadata.bioweave.data_lifecycle, {});
  fixture.runtime.destroy();
});

test(
  "character clear allows explicit reanalysis without restoring deleted Floors",
  async () => {
    const messages = [
      { message_id: "reset-old-floor", floor: 3, content: "旧楼层", role: "assistant" },
      { message_id: "reset-boundary-floor", floor: 6, content: "边界楼层", role: "assistant" },
    ];
    const fixture = createFixture({
      messages,
      analyzer: {
        async analyzeFloor() {
          return { events: [eventResult("reset-boundary-event")] };
        },
      },
    });

    await fixture.runtime.init();
    await fixture.runtime.analyzeFloor(
      { __messageIndex: true, index: 0 },
      { force: true },
    );
    await fixture.runtime.analyzeFloor(
      { __messageIndex: true, index: 1 },
      { force: true },
    );
    const cleared = await fixture.runtime.clearCharacterData();
    assert.equal(cleared.ok, true);
    assert.equal(fixture.runtime.store.getFloor(0).events.length, 0);
    assert.equal(fixture.runtime.store.getFloor(1).events.length, 0);

    await fixture.runtime.analyzeFloor(
      { __messageIndex: true, index: 1 },
      { force: true },
    );

    const stored = fixture.runtime.store.getFloor(1);
    const status = await fixture.runtime.getCurrentFloorAnalysisStatus();
    const businessData = await fixture.runtime.collectActiveBusinessData();

    assert.equal(stored.analysis.status, "success");
    assert.equal(stored.events.length, 1);
    assert.equal(status.current_floor_events.length, 1);
    assert.equal(businessData.active_events.length, 1);
    assert.deepEqual(
      businessData.active_events.map((event) => event.event_id),
      [stored.events[0].event_id],
    );
    assert.equal(Object.keys(businessData.tracking_subjects).length, 1);
    assert.equal(
      Object.keys((await fixture.runtime.getTrackingRegistry()).character_registry.entities).length,
      2,
    );
    fixture.runtime.destroy();
  },
);

test("world and all clear survive Runtime reload without reviving deleted Floor facts", async () => {
  const message = { message_id: "clear-reload-floor", floor: 2, content: "可重载楼层", role: "assistant" };
  const version = await floorVersion({
    chatId: "chat-runtime",
    messageId: message.message_id,
    floor: message.floor,
    swipeId: 0,
    text: message.content,
  });
  message.extra = {
    bioweave: {
      ...emptyFloor(),
      floor_version: version,
      analysis: { status: "success", floor_version: version },
      events: [eventResult("clear-reload-event", { source: version })],
      character_registry: {
        schema_version: 1,
        entities: { "character-1": { character_id: "character-1", display_name: "Alice" } },
      },
      world_model: { species: [{ name: "世界 A" }] },
      world_model_meta: { saved_at: "fixture" },
    },
  };
  const fixture = createFixture({ messages: [message] });
  await fixture.runtime.init();

  const worldResult = await fixture.runtime.clearWorldData();
  assert.equal(worldResult.ok, true);
  assert.equal(fixture.context.chat[0].extra.bioweave.world_model, null);
  assert.equal(fixture.context.chat[0].extra.bioweave.world_model_meta, null);
  assert.equal(fixture.context.chat[0].extra.bioweave.events.length, 1);

  fixture.runtime.destroy();
  const reloadedAfterWorld = createRuntime({ adapter: fixture.adapter });
  await reloadedAfterWorld.init();
  assert.equal((await reloadedAfterWorld.collectActiveBusinessData()).active_events.length, 1);
  assert.equal(await reloadedAfterWorld.resolveWorldModelAtOrBefore(), null);

  const allResult = await reloadedAfterWorld.clearAllBioWeaveData();
  assert.equal(allResult.ok, true);
  reloadedAfterWorld.destroy();
  const reloadedAfterAll = createRuntime({ adapter: fixture.adapter });
  await reloadedAfterAll.init();
  const businessData = await reloadedAfterAll.collectActiveBusinessData();
  assert.deepEqual(businessData.active_events, []);
  assert.deepEqual(businessData.tracking_subjects, {});
  assert.equal(await reloadedAfterAll.resolveWorldModelAtOrBefore(), null);
  reloadedAfterAll.destroy();
});

test("failed World clear rebuilds Runtime and permits a subsequent World Model save", async () => {
  const message = { message_id: "world-clear-failure-recovery", floor: 2, content: "世界模型重试", role: "assistant" };
  const version = await floorVersion({
    chatId: "chat-runtime",
    messageId: message.message_id,
    floor: message.floor,
    swipeId: 0,
    text: message.content,
  });
  message.extra = {
    bioweave: {
      ...emptyFloor(),
      floor_version: version,
      analysis: { status: "success", floor_version: version },
      world_model: { species: [{ name: "旧世界" }] },
      world_model_meta: { saved_at: "fixture" },
    },
  };
  const fixture = createFixture({
    messages: [message],
    saveChatResponse: { commitState: "failed" },
  });
  await fixture.runtime.init();

  const clearResult = await fixture.runtime.clearWorldData();
  assert.equal(clearResult.ok, false);
  assert.equal(clearResult.persistence.commitState, "failed");
  assert.deepEqual(fixture.context.chat[0].extra.bioweave.world_model, { species: [{ name: "旧世界" }] });

  fixture.context.saveChat = async () => undefined;
  const nextModel = { species: [{ name: "新世界" }] };
  await fixture.runtime.saveWorldModel({ model: nextModel, meta: { saved_by: "retry" } });
  assert.deepEqual(fixture.context.chat[0].extra.bioweave.world_model, normalizeWorldModel(nextModel));
  assert.deepEqual(fixture.context.chat[0].extra.bioweave.world_model_meta, { saved_by: "retry" });
  fixture.runtime.destroy();
});

test("unknown World clear recovers Runtime without treating the commit as success", async () => {
  const message = { message_id: "world-clear-unknown-recovery", floor: 2, content: "世界模型未知提交", role: "assistant" };
  const version = await floorVersion({
    chatId: "chat-runtime",
    messageId: message.message_id,
    floor: message.floor,
    swipeId: 0,
    text: message.content,
  });
  message.extra = {
    bioweave: {
      ...emptyFloor(),
      floor_version: version,
      analysis: { status: "success", floor_version: version },
      world_model: { species: [{ name: "旧世界" }] },
      world_model_meta: { saved_at: "fixture" },
    },
  };
  const fixture = createFixture({
    messages: [message],
    saveChatResponse: { commitState: "unknown" },
  });
  await fixture.runtime.init();

  const clearResult = await fixture.runtime.clearWorldData();
  assert.equal(clearResult.ok, false);
  assert.equal(clearResult.persistence.commitState, "unknown");

  fixture.context.saveChat = async () => undefined;
  await fixture.runtime.saveWorldModel({
    model: { species: [{ name: "重试世界" }] },
    meta: { saved_by: "retry" },
  });
  assert.equal(fixture.context.chat[0].extra.bioweave.world_model.species[0].name, "重试世界");
  fixture.runtime.destroy();
});

test("SillyTavern adapter does not treat a normal void saveChat as confirmed", async () => {
  const context = {
    chatId: "chat-sillytavern-adapter",
    chat: [{ message_id: "message-adapter", extra: {} }],
    async saveChat() {},
  };
  const previousSillyTavern = globalThis.SillyTavern;
  globalThis.SillyTavern = { getContext: () => context };
  try {
    const adapter = createSillyTavernAdapter();
    assert.deepEqual(
      await adapter.saveChat({ expectedChatId: context.chatId }),
      { commitState: "unknown", status: "unknown" },
    );
    const result = await adapter.saveFloorBioWeave(
      0,
      0,
      { ...emptyFloor(), future_field: { must_survive: true } },
      context.chatId,
    );
    assert.deepEqual(result, {commitState: "unknown", status: "unknown"});
    assert.deepEqual(context.chat[0].extra.bioweave.future_field, { must_survive: true });
  } finally {
    if (previousSillyTavern === undefined) delete globalThis.SillyTavern;
    else globalThis.SillyTavern = previousSillyTavern;
  }
});

test("Swipe switch reuses a still-valid target Swipe analysis", async () => {
  const message = {
    message_id: "message-reusable-swipe",
    floor: 3,
    swipe_id: 0,
    swipes: ["版本 A", "版本 B"],
    swipe_info: [{}, {}],
    role: "assistant",
  };
  const fixture = createFixture({ messages: [message] });
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor(
    { __messageIndex: true, index: 0 },
    { force: true },
  );
  const targetVersion = await floorVersion({
    chatId: "chat-runtime",
    messageId: message.message_id,
    floor: 3,
    swipeId: 1,
    text: "版本 B",
  });
  message.swipe_info[1].extra = {
    bioweave: {
      ...emptyFloor(),
      floor_version: targetVersion,
      analysis: { status: "success", floor_version: targetVersion },
      events: [],
    },
  };
  const callsBeforeSwitch = fixture.calls();
  message.swipe_id = 1;
  fixture.emit("message-swiped", { message_id: message.message_id });
  await settle();
  assert.equal(fixture.calls(), callsBeforeSwitch);
  assert.equal(
    fixture.runtime.store.getFloor(0, 1).analysis.status,
    "success",
  );
  fixture.runtime.destroy();
});

test("previous API state follows the active Swipe owner after switching", async () => {
  const inputs = [];
  const message = {
    message_id: "message-swipe-history",
    floor: 3,
    swipe_id: 0,
    swipes: ["版本 A", "版本 B"],
    swipe_info: [{}, {}],
    role: "assistant",
  };
  const fixture = createFixture({
    messages: [
      message,
      {
        message_id: "message-target",
        floor: 4,
        content: "目标楼层",
        role: "assistant",
      },
    ],
    analyzer: {
      async analyzeFloor({ analysisInput }) {
        inputs.push(analysisInput);
        const names =
          analysisInput.current_floor.floor === 3
            ? analysisInput.floor_version.swipe_id === 0
              ? ["Swipe角色A", "Swipe来源A"]
              : ["Swipe角色B", "Swipe来源B"]
            : null;
        return {
          events: names
            ? [
                identityEventForCharacters(
                  analysisInput.character_registry,
                  names[0],
                  names[1],
                  `swipe-${inputs.length}`,
                ),
              ]
            : [],
        };
      },
    },
  });
  await fixture.runtime.init();
      await fixture.runtime.analyzeFloor(
        { __messageIndex: true, index: 0 },
        { force: true },
      );
      assert.equal(fixture.runtime.store.getActiveSwipeId(0), 0);
      assert.ok(fixture.runtime.store.getFloor(0, 0).analysis);
      const swipeAEventId =
        fixture.runtime.store.getActiveFloor(0).events[0].event_id;

      message.swipe_id = 1;
      fixture.emit("generation-started", { message_id: message.message_id, swipe_id: 1 });
      fixture.emit("message-swiped", { message_id: message.message_id, swipe_id: 1, pendingGeneration: true });
      fixture.emit("generation-ended", { message_id: message.message_id, swipe_id: 1 });
      fixture.emit("character-message-rendered", { message_id: message.message_id, swipe_id: 1 });
      await settle();
      const swipeBEvents = fixture.runtime.store.getActiveFloor(0).events;
      assert.equal(swipeBEvents.length, 1);
      assert.notEqual(swipeBEvents[0].event_id, swipeAEventId);
      assert.equal(swipeBEvents[0].source.swipe_id, 1);
      assert.deepEqual(
        Object.values(
          fixture.runtime.store.getFloor(0, 0).character_registry.entities,
        ).map((entry) => entry.display_name),
        ["Swipe角色A", "Swipe来源A"],
      );
      assert.deepEqual(
        Object.values(
          fixture.runtime.store.getFloor(0, 1).character_registry.entities,
        ).map((entry) => entry.display_name),
        ["Swipe角色B", "Swipe来源B"],
      );

      await fixture.runtime.analyzeFloor("message-target", { force: true });
      const previous = inputs.at(-1).existing_bioweave;
      assert.equal(previous.analysis.floor_version.swipe_id, 1);
      assert.deepEqual(
        previous.events.map((event) => event.source.swipe_id),
        [1],
      );
      assert.deepEqual(
        Object.values(inputs.at(-1).character_registry.entities).map(
          (entry) => entry.display_name,
        ),
        ["Swipe角色B", "Swipe来源B"],
      );
      assert.doesNotMatch(
        JSON.stringify(inputs.at(-1).character_registry),
        /Swipe角色A|Swipe来源A/u,
      );

      fixture.context.chat.splice(1, 1);
      delete message.swipes[1];
      delete message.swipe_info[1];
      fixture.emit("message-swipe-deleted", { message_id: message.message_id });
      await settle();
      assert.deepEqual(
        (await fixture.runtime.getTrackingRegistry()).character_registry,
        { schema_version: 1, entities: {} },
      );

      message.swipe_id = 0;
      await fixture.runtime.refreshTrackingRegistry("swipe-delete");
      fixture.context.chat.push({
        message_id: "message-after-swipe-delete",
        floor: 4,
        content: "删除 Swipe 后的新楼层",
        role: "assistant",
      });
      await fixture.runtime.analyzeFloor("message-after-swipe-delete", {
        force: true,
      });
      assert.deepEqual(
        Object.values(inputs.at(-1).character_registry.entities).map(
          (entry) => entry.display_name,
        ),
        ["Swipe角色A", "Swipe来源A"],
      );
  fixture.runtime.destroy();
});

test("active Swipe deletion rebuilds the registry and fails closed without a slot", async () => {
  const message = {
    message_id: "message-swipe-delete",
    floor: 3,
    swipe_id: 0,
    swipes: ["版本 A"],
    swipe_info: [{}],
    role: "assistant",
  };
  const fixture = createFixture({ messages: [message] });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  assert.equal(
    (await fixture.runtime.getTrackingRegistry()).tracking_subjects[
      "char_000001"
    ]
      .status,
    "active",
  );

  delete message.swipes[0];
  delete message.swipe_info[0];
  fixture.emit("message-swipe-deleted", { message_id: message.message_id });
  await settle();

  for (const field of [
    "character_profiles",
    "character_registry",
    "tracking_subjects",
    "tracking_candidates",
    "relationships",
    "index",
  ]) assert.equal(Object.hasOwn(fixture.context.chatMetadata.bioweave ?? {}, field), false);
  assert.deepEqual(await fixture.runtime.getCurrentFloorEvents(), []);
  fixture.runtime.destroy();
});

test("plugin reload rebuilds empty derived state before analyzing a new Floor", async () => {
  let input;
  const fixture = createFixture({
    messages: [
      {
        message_id: "message-owner",
        floor: 1,
        content: "已删除的历史楼",
        role: "assistant",
      },
      {
        message_id: "message-new",
        floor: 10,
        content: "重载后的新楼",
        role: "assistant",
      },
    ],
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor(
    { __messageIndex: true, index: 0 },
    { force: true },
  );
  const deletedEventId = fixture.runtime.store.getFloor(0).events[0].event_id;
  fixture.runtime.destroy();
  fixture.context.chat.splice(0, 1);

  const reloaded = createRuntime({
    adapter: fixture.runtime.st,
    analyzer: {
      async analyzeWorldModel() {
        return normalizeWorldModel({ schema_version: 1, species: [{ name: "人类", biological_types: [] }] });
      },
      async analyzeWorldModelPatch() {
        return { schema_version: 1, add: {}, update: {} };
      },
      async analyzeFloor(request) {
        input = request.analysisInput;
        return { events: [] };
      },
    },
  });
  await reloaded.init();
  await settle();

  assert.deepEqual(
    (await reloaded.getTrackingRegistry()).tracking_subjects,
    {},
  );
  assert.deepEqual((await reloaded.getTrackingRegistry()).character_registry, {
    schema_version: 1,
    entities: {},
  });
  for (const field of [
    "character_profiles",
    "character_registry",
    "tracking_subjects",
    "tracking_candidates",
    "relationships",
    "index",
    "world_model",
    "world_model_meta",
  ]) assert.equal(Object.hasOwn(fixture.context.chatMetadata.bioweave ?? {}, field), false);
  await reloaded.refreshCurrentFloorAnalysis();
  assert.deepEqual(input.existing_bioweave, { analysis: null, events: [] });
  assert.deepEqual(input.character_registry, {
    schema_version: 1,
    entities: {},
  });
  assert.deepEqual(input.character_context.profiles, {});
  assert.doesNotMatch(JSON.stringify(input), new RegExp(deletedEventId, "u"));
  reloaded.destroy();
});

test("reload restores all business state from three Floor facts without Chat mirrors", async () => {
  const messages = [
    { message_id: "floor-1", floor: 1, content: "F1", role: "assistant" },
    { message_id: "floor-2", floor: 2, content: "F2", role: "assistant" },
    { message_id: "floor-3", floor: 3, content: "F3", role: "assistant" },
  ];
  const fixture = createFixture({
    messages,
    analyzer: {
      async analyzeFloor({ analysisInput }) {
        return {
          events: [
            identityEventForCharacters(
              analysisInput.character_registry,
              "Alice",
              "Bob",
              `analysis-event-${analysisInput.current_floor.floor}`,
            ),
          ],
        };
      },
    },
  });
  await fixture.runtime.init();
  for (const [index, worldName] of ["W1", "W2", "W3"].entries()) {
    const message = messages[index];
    await fixture.runtime.analyzeFloor({ __messageIndex: true, index }, { force: true });
    const current = fixture.runtime.store.getFloor(index, 0);
    await fixture.runtime.store.saveFloor(index, 0, {
      ...current,
      world_model: {
        schema_version: 1,
        species: [
          {
            name: "species-fixture",
            biological_types: [
              { name: "type-fixture", capabilities: { can_carry_pregnancy: true } },
            ],
          },
          { name: worldName },
        ],
      },
      world_model_meta: { source_floor: message.floor },
    });
  }
  const canonicalRegistry = fixture.runtime.store.getFloor(2, 0).character_registry;
  fixture.runtime.destroy();

  const reloaded = createRuntime({ adapter: fixture.adapter });
  await reloaded.init();
  const business = await reloaded.collectActiveBusinessData();
  const rebuilt = await reloaded.getTrackingRegistry();
  assert.equal(business.active_event_count, 3);
  assert.equal(business.tracking_subject_count, 1);
  const subjectId = Object.keys(rebuilt.tracking_subjects)[0];
  assert.ok(rebuilt.tracking_subjects[subjectId]);
  assert.deepEqual(rebuilt.tracking_candidates, {});
  assert.equal(rebuilt.character_profiles[subjectId].display_name, "Alice");
  assert.deepEqual(rebuilt.character_registry, canonicalRegistry);
  assert.equal(
    (await reloaded.resolveWorldModelAtOrBefore()).model.species.at(-1).name,
    "W3",
  );
  const input = await reloaded.getCurrentFloorAnalysisInput();
  assert.equal(input.world_model.species.at(-1).name, "W2");
  assert.equal(
    Object.values(input.character_registry.entities).find(
      (entry) => entry.display_name === "Alice",
    ).display_name,
    "Alice",
  );

  const forbidden = [
    "character_profiles",
    "character_registry",
    "tracking_subjects",
    "tracking_candidates",
    "relationships",
    "index",
    "world_model",
    "world_model_meta",
  ];
  for (const field of forbidden)
    assert.equal(Object.hasOwn(fixture.context.chatMetadata.bioweave ?? {}, field), false, field);
  await reloaded.refreshTrackingRegistry("reload-proof");
  for (const field of forbidden)
    assert.equal(Object.hasOwn(fixture.context.chatMetadata.bioweave ?? {}, field), false, field);
  reloaded.destroy();
});

test("stable lifecycle message IDs are not confused with array indexes", async () => {
  const fixture = createFixture({
    messages: [
      { message_id: "0", floor: 3, content: "楼层三", role: "assistant" },
      { message_id: "1", floor: 1, content: "楼层一", role: "assistant" },
    ],
  });
  await fixture.runtime.init();
  configureScheduler(fixture, { interval: 1 });
  fixture.emit("generation-started", { message_id: "0" });
  fixture.emit("character-message-rendered", { message_id: "0" });
  await settle();
  assert.equal(
    fixture.runtime.store.getFloor(0).analysis.floor_version.message_id,
    "0",
  );
  assert.equal(
    fixture.runtime.store.getFloor(0).analysis.floor_version.floor,
    3,
  );
  assert.equal(fixture.runtime.store.getFloor(1).analysis, null);
  fixture.runtime.destroy();
});

test("event edit updates the Floor fact and delete rebuilds Registry without dangling refs", async () => {
  const fixture = createFixture();
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const eventId = (await fixture.runtime.getCurrentFloorEvents())[0].event_id;
  await fixture.runtime.updateEvent(eventId, { location: "新地点" });
  assert.equal(
    (await fixture.runtime.getCurrentFloorEvents())[0].location,
    "新地点",
  );
  await fixture.runtime.deleteEvent(eventId);
  const data = await fixture.runtime.collectActiveBusinessData();
  assert.equal(data.active_event_count, 0);
  assert.equal(data.tracking_subject_count, 0);
  fixture.runtime.destroy();
});

test("event edit validates the complete Floor collection before saving or rebuilding Registry", async () => {
  const subjectEvent = (eventId, subjectId, sourceId) =>
    eventResult(eventId, {
      participants: [
        identityParticipant({
          identityStatus: "new",
          mentionId: `${eventId}-subject`,
          displayName: `${subjectId} display`,
          eventRole: "potential_gestational_subject",
          capabilities: { can_carry_pregnancy: true },
        }),
        identityParticipant({
          identityStatus: "new",
          mentionId: `${eventId}-source`,
          displayName: `${sourceId} display`,
          eventRole: "potential_conception_source",
          capabilities: { can_cause_pregnancy: true },
        }),
      ],
      pregnancy_relevance: {
        relevant: true,
        possible_conception: true,
        gestational_subject_ids: [`${eventId}-subject`],
        counterpart_ids: [`${eventId}-source`],
        confidence: 0.8,
      },
    });
  const fixture = createFixture({
    analyzer: {
      async analyzeFloor() {
        return {
          events: [
            subjectEvent("event-a", "subject-a", "source-a"),
            subjectEvent("event-b", "subject-b", "source-b"),
          ],
        };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();

  const beforeEvents = await fixture.runtime.getCurrentFloorEvents();
  const beforeFloorSaveCalls = fixture.saveFloorCalls();
  const beforeRegistrySaveCalls = fixture.saveChatMetadataCalls();
  const firstEvent = beforeEvents[0];
  const secondEvent = beforeEvents.find(
    (event) =>
      event.pregnancy_relevance.gestational_subject_ids[0] ===
      "char_000003",
  );
  const firstSubjectId =
    firstEvent.pregnancy_relevance.gestational_subject_ids[0];
  const secondSubjectId =
    secondEvent.pregnancy_relevance.gestational_subject_ids[0];
  await assert.rejects(
    fixture.runtime.updateEvent(secondEvent.event_id, {
      participants: [
        { ...secondEvent.participants[0], character_id: firstSubjectId },
        { ...secondEvent.participants[1] },
      ],
      pregnancy_relevance: {
        ...secondEvent.pregnancy_relevance,
        gestational_subject_ids: [firstSubjectId],
      },
    }),
    (error) =>
      error?.code === "EVENT_ANALYSIS_INVALID" &&
      error?.diagnostic_code === "duplicate_gestational_subject_event" &&
      error?.error_path ===
        "$.events[1].pregnancy_relevance.gestational_subject_ids[0]",
  );

  assert.equal(fixture.saveFloorCalls(), beforeFloorSaveCalls);
  assert.equal(fixture.saveChatMetadataCalls(), beforeRegistrySaveCalls);
  assert.deepEqual(
    (await fixture.runtime.getCurrentFloorEvents()).map(
      (event) => event.pregnancy_relevance.gestational_subject_ids,
    ),
    [[firstSubjectId], [secondSubjectId]],
  );
  fixture.runtime.destroy();
});

test("deleted Floor facts leave no orphan derived references", async () => {
  const fixture = createFixture();
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const eventId = (await fixture.runtime.getCurrentFloorEvents())[0].event_id;
  assert.equal(
    (await fixture.runtime.collectActiveBusinessData()).active_event_count,
    1,
  );
  fixture.context.chat.splice(0, 1);
  fixture.emit("message-deleted", { message_id: "message-stable" });
  await settle();
  const data = await fixture.runtime.collectActiveBusinessData();
  assert.equal(data.active_event_count, 0);
  assert.equal(data.tracking_subject_count, 0);
  assert.deepEqual(data.tracking_subjects, {});
  assert.deepEqual(data.tracking_candidates, {});
  assert.deepEqual(data.active_events, []);
  assert.deepEqual(data.tracking_decisions, []);
  assert.equal(JSON.stringify(data).includes(eventId), false);
  fixture.runtime.destroy();
});

test("current-derived reads ignore deleted Floor metadata without a lifecycle callback", async () => {
  const fixture = createFixture({
    messages: [
      {
        message_id: "message-owner",
        floor: 1,
        content: "被删除的 owner",
        role: "assistant",
      },
      {
        message_id: "message-target",
        floor: 2,
        content: "当前目标",
        role: "assistant",
      },
    ],
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor(
    { __messageIndex: true, index: 0 },
    { force: true },
  );
  assert.equal(
    (await fixture.runtime.getTrackingRegistry()).tracking_subjects[
      "char_000001"
    ]
      .status,
    "active",
  );

  fixture.context.chat.splice(0, 1);
  const registry = await fixture.runtime.getTrackingRegistry();
  assert.deepEqual(registry.tracking_subjects, {});
  assert.deepEqual(registry.tracking_candidates, {});
  assert.deepEqual(registry.character_profiles, {});

  const data = await fixture.runtime.collectActiveBusinessData();
  assert.deepEqual(data.active_events, []);
  assert.deepEqual(data.tracking_subjects, {});
  assert.deepEqual(data.tracking_candidates, {});
  assert.deepEqual(data.character_profiles, {});
  assert.equal(data.tracking_subject_count, 0);
  fixture.runtime.destroy();
});

test("deleted derived profiles and candidates do not enter Event API input or request messages", async () => {
  const fixture = createFixture({
    rawApiResponse: JSON.stringify({ schema_version: 1, events: [] }),
  });
  await fixture.runtime.init();
  await settle();
  fixture.context.chatMetadata.bioweave = {
    chat_scope: { chat_id: "chat-runtime" },
    character_profiles: {
      stale_character: {
        character_id: "stale_character",
        display_name: "旧人物",
        species: "stale_species",
        biological_type: "stale_type",
        reproductive_capabilities: { can_carry_pregnancy: true },
        evidence: ["STALE_PROFILE_EVIDENCE"],
      },
    },
    tracking_candidates: {
      stale_character: {
        character_id: "stale_character",
        display_name: "旧人物",
        reproductive_capabilities: { can_carry_pregnancy: true },
        evidence: ["STALE_CANDIDATE_EVIDENCE"],
      },
    },
  };

  const input = await fixture.runtime.getCurrentFloorAnalysisInput();
  assert.deepEqual(input.character_context.profiles, {});
  assert.equal(input.character_registry.entities.stale_character, undefined);

  await fixture.runtime.refreshCurrentFloorAnalysis();
  const requestText = JSON.stringify(fixture.apiRequests[0]);
  assert.doesNotMatch(requestText, /STALE_PROFILE_EVIDENCE/u);
  assert.doesNotMatch(requestText, /STALE_CANDIDATE_EVIDENCE/u);
  assert.doesNotMatch(requestText, /stale_character/u);
  fixture.runtime.destroy();
});

test("Floor save rechecks the current target Version before committing an old result", async () => {
  let fixture;
  fixture = createFixture({
    analyzer: {
      async analyzeFloor() {
        fixture.context.chat[0].content = "分析期间被编辑的正文";
        return { events: [] };
      },
    },
  });
  await fixture.runtime.init();
  await assert.rejects(
    fixture.runtime.refreshCurrentFloorAnalysis(),
    /REQUEST_ABORTED/u,
  );
  assert.equal(fixture.saveFloorCalls(), 1);
  assert.equal(fixture.runtime.store.getFloor(0).analysis, null);
  fixture.runtime.destroy();
});

test("target Version changes during request build prevent the API call", async () => {
  let fixture;
  let analyzerCalls = 0;
  fixture = createFixture({
    characterContextResolver: () => {
      fixture.context.chat[0].content = "请求构建期间被编辑的正文";
      return {};
    },
    analyzer: {
      async analyzeFloor() {
        analyzerCalls += 1;
        return { events: [] };
      },
    },
  });
  await fixture.runtime.init();
  await assert.rejects(
    fixture.runtime.refreshCurrentFloorAnalysis(),
    /REQUEST_ABORTED/u,
  );
  assert.equal(analyzerCalls, 0);
  assert.equal(fixture.saveFloorCalls(), 0);
  fixture.runtime.destroy();
});

test("cancelled Floor save rolls back a late result for the same owner", async () => {
  let releaseSave;
  let saveStartedResolve;
  let saveInvocations = 0;
  const saveStarted = new Promise((resolve) => {
    saveStartedResolve = resolve;
  });
  const fixture = createFixture({
    saveFloorHook: async () => {
      saveInvocations += 1;
      if (saveInvocations > 1) return;
      saveStartedResolve();
      await new Promise((resolve) => {
        releaseSave = resolve;
      });
    },
  });
  await fixture.runtime.init();
  const pending = fixture.runtime.refreshCurrentFloorAnalysis();
  await saveStarted;
  fixture.runtime.chat.invalidate("during-floor-save");
  releaseSave();
  await assert.rejects(pending, /REQUEST_ABORTED/u);
  assert.equal(fixture.runtime.store.getFloor(0).analysis, null);
  assert.deepEqual(await fixture.runtime.getCurrentFloorEvents(), []);
  fixture.runtime.destroy();
});

test("failed analysis does not write terminal metadata into a shifted message", async () => {
  let fixture;
  fixture = createFixture({
    messages: [
      {
        message_id: "message-owner",
        floor: 1,
        content: "被删除的 owner",
        role: "assistant",
      },
      {
        message_id: "message-target",
        floor: 2,
        content: "当前目标",
        role: "assistant",
      },
    ],
    analyzer: {
      async analyzeFloor() {
        fixture.context.chat.splice(0, 1);
        throw new Error("REQUEST_TIMEOUT");
      },
    },
  });
  await fixture.runtime.init();
  await assert.rejects(
    fixture.runtime.analyzeFloor(
      { __messageIndex: true, index: 0 },
      { force: true },
    ),
    /REQUEST_TIMEOUT/u,
  );
  assert.equal(fixture.context.chat[0].message_id, "message-target");
  assert.equal(fixture.runtime.store.getFloor(0).analysis, null);
  fixture.runtime.destroy();
});

test("chat invalidation aborts in-flight Event analysis before a stale request can retry", async () => {
  let signal;
  let release;
  let startedResolve;
  const started = new Promise((resolve) => {
    startedResolve = resolve;
  });
  let calls = 0;
  const fixture = createFixture({
    retryCount: 2,
    analyzer: {
      analyzeFloor(request) {
        calls += 1;
        signal = request.signal;
        startedResolve();
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    },
  });
  await fixture.runtime.init();
  const pending = fixture.runtime.refreshCurrentFloorAnalysis();
  await started;
  fixture.runtime.chat.invalidate("direct-owner-delete");
  assert.equal(signal.aborted, true);
  release({ events: [] });
  await assert.rejects(pending, /REQUEST_ABORTED/u);
  assert.equal(calls, 1);
  assert.equal(fixture.runtime.store.getFloor(0).analysis, null);
  fixture.runtime.destroy();
});

test("automatic scheduling uses the Runtime Character counter instead of physical Floor hints", async () => {
  const fixture = createFixture({
    messages: [
      { message_id: "message-3", floor: 3, content: "角色一", role: "assistant" },
      { message_id: "message-4", floor: 4, content: "角色二", role: "assistant" },
      { message_id: "message-6", floor: 6, content: "角色三", role: "assistant" },
    ],
  });
  await fixture.runtime.init();
  fixture.emit("character-message-rendered", { message_id: "message-3" });
  await settle();
  fixture.emit("character-message-rendered", { message_id: "message-4" });
  await settle();
  fixture.emit("character-message-rendered", { message_id: "message-6" });
  await settle();
  assert.equal(fixture.calls(), 1);
  fixture.runtime.destroy();
});

test("API failure exits running and exposes the real request diagnostic", async () => {
  const fixture = createFixture({
    analyzer: {
      async analyzeFloor() {
        const error = new Error("REQUEST_TIMEOUT");
        error.code = "REQUEST_TIMEOUT";
        throw error;
      },
    },
  });
  await fixture.runtime.init();
  await assert.rejects(
    fixture.runtime.refreshCurrentFloorAnalysis(),
    /REQUEST_TIMEOUT/,
  );
  const status = await fixture.runtime.getCurrentFloorAnalysisStatus();
  assert.equal(status.busy, false);
  assert.equal(status.state, "failed");
  assert.equal(status.error_stage, "api_request");
  assert.equal(status.error_code, "REQUEST_TIMEOUT");
  assert.match(status.safe_error_summary, /超时/);
  fixture.runtime.destroy();
});

test("API HTTP diagnostics preserve status and metadata in Runtime status", async () => {
  const fixture = createFixture({
    analyzer: {
      async analyzeFloor() {
        const error = new Error("host timeout-like failure");
        Object.assign(error, {
          code: "REQUEST_TIMEOUT",
          diagnosticCode: "server",
          diagnostic_code: "server",
          error_code: "server",
          status: 503,
          phase: "response",
          attempt: 2,
          timeoutSec: 15,
          timeout_ms: 15000,
        });
        throw error;
      },
    },
  });
  await fixture.runtime.init();
  await assert.rejects(
    fixture.runtime.refreshCurrentFloorAnalysis(),
    /host timeout-like failure/,
  );
  const status = await fixture.runtime.getCurrentFloorAnalysisStatus();
  assert.equal(status.state, "failed");
  assert.equal(status.error_code, "server");
  assert.equal(status.diagnostic_code, "server");
  assert.equal(status.http_status, 503);
  assert.equal(status.phase, "response");
  assert.equal(status.attempt, 1);
  assert.equal(status.timeoutSec, 15);
  assert.equal(status.timeout_ms, 15000);
  assert.match(status.safe_error_summary, /HTTP 503/);
  assert.doesNotMatch(status.safe_error_summary, /超时/);
  const persistedAttempt =
    fixture.context.chat[0].extra.bioweave.analysis.last_attempt;
  assert.equal(persistedAttempt.attempt, 2);
  assert.equal(persistedAttempt.http_status, 503);
  fixture.runtime.destroy();
});

test("Domain validation failure keeps a specific diagnostic code and path", async () => {
  const fixture = createFixture({
    analyzer: {
      async analyzeFloor() {
        return {
          events: [
            eventResult("ignored-by-runtime", {
              type: "not_a_biological_event_type",
            }),
          ],
        };
      },
    },
  });
  await fixture.runtime.init();
  await assert.rejects(
    fixture.runtime.refreshCurrentFloorAnalysis(),
    /EVENT_DOMAIN_VALIDATION_FAILED/,
  );
  const status = await fixture.runtime.getCurrentFloorAnalysisStatus();
  assert.equal(status.busy, false);
  assert.equal(status.state, "failed");
  assert.equal(status.error_code, "domain_validation_failed");
  assert.equal(status.error_path, "$.events[0].type");
  assert.match(status.safe_error_summary, /Event JSON Schema/);
  fixture.runtime.destroy();
});

test("valid empty Event result completes without retry and records an explicit empty classification", async () => {
  const fixture = createFixture({
    retryCount: 1,
    analyzer: {
      async analyzeFloor() {
        return { events: [] };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const status = await fixture.runtime.getCurrentFloorAnalysisStatus();
  assert.equal(status.state, "success");
  assert.equal(status.event_count, 0);
  const trace = fixture.runtime.getPersistenceTrace().sequence;
  assert.equal(trace.filter(item => item.stage === "EVENT_AI_ATTEMPT_BEGIN").length, 1);
  assert.ok(trace.some(item =>
    item.stage === "EVENT_EMPTY_RESULT_CLASSIFIED" &&
    item.valid_empty === true &&
    item.reason === "persisted_current_floor_events_empty",
  ));
  assert.ok(trace.some(item =>
    item.stage === "CHARACTER_UI_READY" &&
    item.ready === true &&
    item.reason === "valid_empty_event_result",
  ));
  fixture.runtime.destroy();
});

test("non-empty normalized Event result missing from canonical Floor state retries the Event stage", async () => {
  let analyzeCalls = 0;
  const fixture = createFixture({
    retryCount: 1,
    saveFloorHook({ value }) {
      if (value?.analysis && Array.isArray(value.events)) value.events = [];
    },
    analyzer: {
      async analyzeFloor() {
        analyzeCalls += 1;
        return { events: [eventResult(`canonical-missing-${analyzeCalls}`)] };
      },
    },
  });
  await fixture.runtime.init();
  await assert.rejects(
    fixture.runtime.refreshCurrentFloorAnalysis(),
    /CHARACTER_CANONICAL_NOT_READY/,
  );
  assert.equal(analyzeCalls, 2);
  const trace = fixture.runtime.getPersistenceTrace().sequence;
  assert.ok(trace.some(item =>
    item.stage === "CHARACTER_UI_READY" &&
    item.ready === false &&
    item.reason === "canonical_event_state_missing",
  ));
  assert.equal(trace.filter(item => item.stage === "EVENT_STAGE_RETRY_SCHEDULED").length, 1);
  fixture.runtime.destroy();
});

test("Domain collection duplicate subject keeps its stable diagnostic code and path", async () => {
  const fixture = createFixture({
    analyzer: {
      async analyzeFloor() {
        const firstEvent = eventResult("duplicate-a");
        const secondEvent = structuredClone(firstEvent);
        secondEvent.event_id = "duplicate-b";
        return {
          events: [firstEvent, secondEvent],
        };
      },
    },
  });
  await fixture.runtime.init();
  await assert.rejects(
    fixture.runtime.refreshCurrentFloorAnalysis(),
    (error) =>
      error?.code === "EVENT_DOMAIN_VALIDATION_FAILED" &&
      error?.diagnostic_code === "duplicate_gestational_subject_event" &&
      error?.error_path ===
        "$.events[1].pregnancy_relevance.gestational_subject_ids[0]",
  );
  const status = await fixture.runtime.getCurrentFloorAnalysisStatus();
  assert.equal(status.state, "failed");
  assert.equal(status.error_code, "duplicate_gestational_subject_event");
  assert.equal(
    status.error_path,
    "$.events[1].pregnancy_relevance.gestational_subject_ids[0]",
  );
  fixture.runtime.destroy();
});

test("Runtime rejects a possible conception Event without the canonical exposure evidence marker", async () => {
  const fixture = createFixture({
    analyzer: {
      async analyzeFloor() {
        return {
          events: [
            eventResult("missing-exposure-marker", {
              source_evidence: [
                {
                  kind: "narrative",
                  text: "barrier outcome without typed marker",
                },
              ],
            }),
          ],
        };
      },
    },
  });
  await fixture.runtime.init();
  await assert.rejects(
    fixture.runtime.refreshCurrentFloorAnalysis(),
    /EVENT_DOMAIN_VALIDATION_FAILED/,
  );
  const status = await fixture.runtime.getCurrentFloorAnalysisStatus();
  assert.equal(status.error_code, "domain_validation_failed");
  assert.equal(
    status.error_path,
    "$.events[0].source_evidence.pregnancy_relevant_exposure",
  );
  fixture.runtime.destroy();
});

test("response parse failure exits running with a response_parse diagnostic", async () => {
  const fixture = createFixture({
    analyzer: {
      async analyzeFloor() {
        const error = new Error("EVENT_RESPONSE_JSON_INVALID");
        error.code = "EVENT_ANALYSIS_INVALID";
        error.analysis_stage = "response_parse";
        throw error;
      },
    },
  });
  await fixture.runtime.init();
  await assert.rejects(
    fixture.runtime.refreshCurrentFloorAnalysis(),
    /EVENT_RESPONSE_JSON_INVALID/,
  );
  const status = await fixture.runtime.getCurrentFloorAnalysisStatus();
  assert.equal(status.busy, false);
  assert.equal(status.state, "failed");
  assert.equal(status.error_stage, "response_parse");
  assert.equal(status.error_code, "EVENT_RESPONSE_JSON_INVALID");
  fixture.runtime.destroy();
});

test("Floor save failure exits running even when failure metadata cannot be saved", async () => {
  const fixture = createFixture({
    saveFloorError: "ST_FLOOR_STORAGE_UNAVAILABLE",
  });
  await fixture.runtime.init();
  await assert.rejects(
    fixture.runtime.refreshCurrentFloorAnalysis(),
    error => error?.code === "WORLD_MODEL_PERSISTENCE_PREWRITE_FAILED" && error?.cause?.message === "ST_FLOOR_STORAGE_UNAVAILABLE",
  );
  const status = await fixture.runtime.getCurrentFloorAnalysisStatus();
  assert.equal(status.busy, false);
  assert.equal(status.state, "failed");
  assert.equal(status.error_stage, "world_persistence_prewrite");
  assert.equal(status.error_code, "WORLD_MODEL_PERSISTENCE_PREWRITE_FAILED");
  fixture.runtime.destroy();
});

test("Registry refresh leaves the authoritative Floor result available without Chat persistence", async () => {
  const fixture = createFixture({ saveChatMetadataErrorAt: 2 });
  await fixture.runtime.init();
  await settle();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const status = await fixture.runtime.getCurrentFloorAnalysisStatus();
  assert.equal(status.busy, false);
  assert.equal(status.state, "success");
  assert.equal(status.current_floor_events.length, 1);
  assert.equal(fixture.runtime.store.getFloor(0).analysis.status, "success");
  fixture.runtime.destroy();
});

test("confirmed cancellation releases execution and preserves the previous successful Events", async () => {
  let release;
  let startedResolve;
  const started = new Promise((resolve) => {
    startedResolve = resolve;
  });
  let calls = 0;
  const fixture = createFixture({
    analyzer: {
      analyzeFloor: () => {
        calls += 1;
        if (calls === 1)
          return Promise.resolve({ events: [eventResult("prior-event")] });
        return new Promise((resolve) => {
          release = resolve;
          startedResolve();
        });
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const previousId = (await fixture.runtime.getCurrentFloorEvents())[0]
    .event_id;
  const pending = fixture.runtime.refreshCurrentFloorAnalysis();
  await started;
  const running = await fixture.runtime.getCurrentFloorAnalysisStatus();
  assert.equal(running.state, "running");
  assert.equal(await fixture.runtime.requestAbortCurrentFloorAnalysis(), true);
  const cancelled = await fixture.runtime.getCurrentFloorAnalysisStatus();
  assert.equal(cancelled.state, "cancelled");
  assert.equal(cancelled.busy, false);
  assert.equal(cancelled.error_code, "REQUEST_ABORTED");
  assert.deepEqual(
    cancelled.current_floor_events.map((event) => event.event_id),
    [previousId],
  );
  release({ events: [eventResult("late-event")] });
  await assert.rejects(pending, /REQUEST_ABORTED/);
  assert.deepEqual(
    (await fixture.runtime.getCurrentFloorEvents()).map(
      (event) => event.event_id,
    ),
    [previousId],
  );
  fixture.runtime.destroy();
});

test("late result from an aborted execution cannot overwrite a newer execution", async () => {
  let firstRelease;
  let firstStartedResolve;
  const firstStarted = new Promise((resolve) => {
    firstStartedResolve = resolve;
  });
  let calls = 0;
  const fixture = createFixture({
    analyzer: {
      analyzeFloor: () => {
        calls += 1;
        if (calls === 1) {
          firstStartedResolve();
          return new Promise((resolve) => {
            firstRelease = resolve;
          });
        }
        return Promise.resolve({ events: [eventResult("new-event")] });
      },
    },
  });
  await fixture.runtime.init();
  const first = fixture.runtime.refreshCurrentFloorAnalysis();
  await firstStarted;
  await fixture.runtime.requestAbortCurrentFloorAnalysis();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const newId = (await fixture.runtime.getCurrentFloorEvents())[0].event_id;
  assert.notEqual(newId, "new-event");
  firstRelease({ events: [eventResult("old-event")] });
  await assert.rejects(first, /REQUEST_ABORTED/);
  assert.deepEqual(
    (await fixture.runtime.getCurrentFloorEvents()).map(
      (event) => event.event_id,
    ),
    [newId],
  );
  fixture.runtime.destroy();
});

test("stale Chat completion releases execution without writing stale failure metadata", async () => {
  let release;
  let startedResolve;
  const started = new Promise((resolve) => {
    startedResolve = resolve;
  });
  const fixture = createFixture({
    analyzer: {
      analyzeFloor: () =>
        new Promise((resolve) => {
          release = resolve;
          startedResolve();
        }),
    },
  });
  await fixture.runtime.init();
  const pending = fixture.runtime.refreshCurrentFloorAnalysis();
  await started;
  fixture.runtime.chat.invalidate("test-stale-chat");
  release({ events: [eventResult("stale-event")] });
  await assert.rejects(pending, /REQUEST_ABORTED/);
  const status = await fixture.runtime.getCurrentFloorAnalysisStatus();
  assert.equal(status.busy, false);
  assert.equal(status.state, "cancelled");
  assert.equal(fixture.runtime.store.getFloor(0).analysis, null);
  assert.deepEqual(await fixture.runtime.getCurrentFloorEvents(), []);
  fixture.runtime.destroy();
});

test("World Model save writes only the current Floor and preserves Event-owned fields", async () => {
  const fixture = createFixture();
  await fixture.runtime.init();
  await fixture.runtime.store.saveFloor(0, 0, {
    ...emptyFloor(),
    analysis: { status: "success", marker: "analysis" },
    events: [{ event_id: "event-1" }],
    character_registry: {
      schema_version: 1,
      entities: {
        char_000001: {
          character_id: "char_000001",
          display_name: null,
          aliases: [],
        },
      },
    },
  });
  const rawProjectionRule = {
    schema_version: 1,
    mechanism_key: "mechanism:floor",
    development_concern_key: "concern:floor",
    development_kind: "monitoring_signal",
    trigger: { kind: "story_time_reached", target_story_time: { day_index: 20, calendar_id: "main" } },
    requirements: { capabilities: [], source_compatibility: "not_required", contributor_relationships: [] },
    realization: null,
    contradiction: null,
    expiration: null,
  };
  const model = { schema_version: 1, species: [{ name: "Floor World" }], projection_rules: [rawProjectionRule] };
  const meta = { last_saved_by: "manual" };
  await fixture.runtime.saveWorldModel({ model, meta });
  const floor = fixture.runtime.store.getFloor(0, 0);
  assert.deepEqual(floor.world_model, normalizeWorldModel(model));
  assert.equal(floor.world_model.projection_rules[0].projection_rule_id, buildProjectionRuleId(rawProjectionRule));
  assert.deepEqual(floor.world_model_meta, meta);
  assert.deepEqual(floor.analysis, { status: "success", marker: "analysis" });
  assert.deepEqual(floor.events, [{ event_id: "event-1" }]);
  assert.deepEqual(floor.character_registry.entities.char_000001, {
    character_id: "char_000001",
    display_name: null,
    aliases: [],
  });
  assert.equal(fixture.saveChatMetadataCalls(), 0);
  assert.equal(fixture.runtime.store.getChat("chat-runtime").world_model, undefined);
  fixture.runtime.destroy();
});

test("World Model resolver follows the nearest valid Floor and naturally rolls back after deletion", async () => {
  const messages = [
    { message_id: "m10", floor: 10, content: "F10", role: "assistant" },
    { message_id: "m20", floor: 20, content: "F20", role: "assistant" },
    { message_id: "m30", floor: 30, content: "F30", role: "assistant" },
  ];
  const fixture = createFixture({ messages });
  await fixture.runtime.init();
  for (const [index, model] of [[0, "W10"], [1, "W20"]]) {
    const message = messages[index];
    const version = await floorVersion({
      chatId: "chat-runtime",
      messageId: message.message_id,
      floor: message.floor,
      text: message.content,
    });
    await fixture.runtime.store.saveFloor(index, 0, {
      ...emptyFloor(),
      floor_version: version,
      world_model: { schema_version: 1, species: [{ name: model }] },
      world_model_meta: { source: model },
    });
  }
  assert.equal((await fixture.runtime.resolveWorldModelAtOrBefore()).model.species[0].name, "W20");
  messages.splice(1, 1);
  assert.equal((await fixture.runtime.resolveWorldModelAtOrBefore()).model.species[0].name, "W10");
  fixture.runtime.destroy();
});

test("World Model resolver skips an edited Floor with a stale Version", async () => {
  const messages = [
    { message_id: "m10-stale", floor: 10, content: "F10", role: "assistant" },
    { message_id: "m20-stale", floor: 20, content: "F20", role: "assistant" },
    { message_id: "m30-stale", floor: 30, content: "F30", role: "assistant" },
  ];
  const fixture = createFixture({ messages });
  await fixture.runtime.init();
  for (const [index, model] of [[0, "W10"], [1, "W20"]]) {
    const message = messages[index];
    await fixture.runtime.store.saveFloor(index, 0, {
      ...emptyFloor(),
      floor_version: await floorVersion({
        chatId: "chat-runtime",
        messageId: message.message_id,
        floor: message.floor,
        text: message.content,
      }),
      world_model: { schema_version: 1, species: [{ name: model }] },
    });
  }
  messages[1].content = "F20 已编辑";
  assert.equal(
    (await fixture.runtime.resolveWorldModelAtOrBefore()).model.species[0].name,
    "W10",
  );
  fixture.runtime.destroy();
});

test("World Model resolver isolates Swipe owners and ignores a deleted Swipe", async () => {
  const message = {
    message_id: "m-swipe-world",
    floor: 10,
    content: "镜像 A",
    role: "assistant",
    swipe_id: 0,
    swipes: ["镜像 A", "镜像 B"],
    swipe_info: [{}, {}],
  };
  const fixture = createFixture({ messages: [message] });
  await fixture.runtime.init();
  for (const [swipeId, textValue, model] of [[0, "镜像 A", "W_A"], [1, "镜像 B", "W_B"]]) {
    const version = await floorVersion({
      chatId: "chat-runtime",
      messageId: message.message_id,
      floor: 10,
      swipeId,
      text: textValue,
    });
    await fixture.runtime.store.saveFloor(0, swipeId, {
      ...emptyFloor(),
      floor_version: version,
      world_model: { schema_version: 1, species: [{ name: model }] },
    });
  }
  message.swipe_id = 1;
  assert.equal((await fixture.runtime.resolveWorldModelAtOrBefore()).model.species[0].name, "W_B");
  message.swipe_id = 0;
  assert.equal((await fixture.runtime.resolveWorldModelAtOrBefore()).model.species[0].name, "W_A");
  delete message.swipes[1];
  delete message.swipe_info[1];
  fixture.runtime.destroy();
});

test("Event Analysis consumes the current valid Floor World Model and never Chat legacy state", async () => {
  const inputs = [];
  const messages = [
    { message_id: "m10", floor: 10, content: "F10", role: "assistant" },
    { message_id: "m20", floor: 20, content: "F20", role: "assistant" },
    { message_id: "m30", floor: 30, content: "F30", role: "assistant" },
  ];
  const fixture = createFixture({
    messages,
    analyzer: {
      async analyzeFloor({ analysisInput }) {
        inputs.push(analysisInput);
        return { events: [] };
      },
    },
  });
  fixture.context.chatMetadata.bioweave = {
    ...emptyChat("chat-runtime"),
    world_model: { schema_version: 1, species: [{ name: "CHAT-FUTURE" }] },
  };
  await fixture.runtime.init();
  for (const [index, model] of [[0, "W10"], [1, "W20"], [2, "W30"]]) {
    const message = messages[index];
    const version = await floorVersion({
      chatId: "chat-runtime",
      messageId: message.message_id,
      floor: message.floor,
      text: message.content,
    });
    await fixture.runtime.store.saveFloor(index, 0, {
      ...emptyFloor(),
      floor_version: version,
      world_model: { schema_version: 1, species: [{ name: model }] },
    });
  }
  await fixture.runtime.analyzeFloor({ __messageIndex: true, index: 2 }, { force: true });
  assert.equal(inputs.at(-1).world_model.species[0].name, "W30");
  await fixture.runtime.analyzeFloor({ __messageIndex: true, index: 0 }, { force: true });
  assert.equal(inputs.at(-1).world_model.species[0].name, "W10");
  fixture.runtime.destroy();
});

test("Runtime State read replays all surviving Character Floors and ignores a trailing User Floor", async () => {
  const messages = [
    { message_id: "state-floor-3", floor: 3, content: "F3", role: "assistant" },
    { message_id: "state-floor-6", floor: 6, content: "F6", role: "assistant" },
    { message_id: "state-user-7", floor: 7, content: "U7", role: "user" },
  ];
  let call = 0;
  const fixture = createFixture({
    messages,
    analyzer: {
      async analyzeFloor() {
        call += 1;
        return {
          events: [eventResult(`state-event-${call}`, {
            story_time: {
              display: `第${call}日`, normalized: null, day_index: call,
              calendar_id: "gregorian",
              precision: "day", confidence: 1,
            },
          })],
        };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({ __messageIndex: true, index: 0 }, { force: true });
  await fixture.runtime.analyzeFloor({ __messageIndex: true, index: 1 }, { force: true });

  const state = await fixture.runtime.getCurrentBiologicalState();
  assert.equal(state.status, "ready");
  assert.equal(
    Object.values(state.current_state.characters)
      .flatMap((character) => character.reproductive_exposure.records).length,
    2,
  );
  assert.equal((await fixture.runtime.collectActiveBusinessData()).current_floor.message_id, "state-floor-6");
  assert.equal(state.current_story_time.day_index, null);
  assert.equal(state.current_story_time.calendar_id, null);
  assert.deepEqual(state.current_story_time_differences, {});
  assert.equal(state.current_state.diagnostics.length, 0);
  fixture.runtime.destroy();
});

test("Runtime uses BioWeave standard month arithmetic for raw era Floor/Event Story Time", async () => {
  const fixture = createFixture({
    messages: [{
      message_id: "state-xihe-floor",
      floor: 5,
      content: "羲和元年五月初四 未时\n当前剧情",
      role: "assistant",
    }],
    analyzer: {
      async analyzeFloor() {
        return {events: [eventResult("xihe-exposure", {
          story_time: {
            display: "羲和元年三月四日 巳时中",
            normalized: null,
            day_index: null,
            calendar_id: null,
            precision: "minute",
            confidence: 1,
          },
        })]};
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 0}, {force: true});
  const state = await fixture.runtime.getCurrentBiologicalState();
  assert.equal(state.current_story_time.calendar_id, null);
  assert.equal(state.current_story_time.day_index, null);
  assert.deepEqual(Object.values(state.current_story_time_differences), [{value: 61, unit: "day"}]);
  fixture.runtime.destroy();
});

test("events=[] does not block current Character Floor Story Time progression", async () => {
  let analysisCount = 0;
  const analysisInputs = [];
  const storyTimeTrace = [];
  const fixture = createFixture({
    storyTimeDebug: true,
    storyTimeTrace: entry => storyTimeTrace.push(entry),
    messages: [
      {
        message_id: "story-floor-58",
        floor: 58,
        content: "羲和元年三月四日 巳时中\n历史剧情",
        role: "assistant",
      },
      {
        message_id: "story-floor-60",
        floor: 60,
        content: "羲和元年五月初四 午时\n她回忆羲和元年三月四日发生的事情",
        role: "assistant",
      },
      {
        message_id: "story-user-61",
        floor: 61,
        content: "羲和元年六月初四 用户文本",
        role: "user",
      },
    ],
    analyzer: {
      async analyzeFloor({analysisInput}) {
        analysisCount += 1;
        analysisInputs.push(analysisInput);
        return analysisCount === 1
          ? {events: [eventResult("story-exposure", {
              story_time: {
                display: "羲和元年三月四日 巳时中",
                normalized: null,
                day_index: null,
                calendar_id: null,
                precision: "minute",
                confidence: 1,
              },
            })]}
          : {events: []};
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 0}, {force: true});
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 1}, {force: true});

  assert.equal(analysisInputs[1].story_time.display, "羲和元年五月初四 午时");
  assert.equal(analysisInputs[1].story_time.calendar_id, null);
  assert.equal(analysisInputs[1].story_time.day_index, null);
  const state = await fixture.runtime.getCurrentBiologicalState();
  assert.equal(state.current_story_time.display, "羲和元年五月初四 午时");
  assert.equal(state.current_story_time.calendar_id, null);
  assert.equal(state.current_story_time.day_index, null);
  assert.deepEqual(Object.values(state.current_story_time_differences), [{value: 61, unit: "day"}]);
  assert.equal(storyTimeTrace.some(entry => entry.source === "historical_event_difference" && entry.difference?.value === 61), true);
  assert.equal((await fixture.runtime.collectActiveBusinessData()).current_floor.message_id, "story-floor-60");
  fixture.runtime.destroy();
});

test("StoryTimeCoordinator resolves surviving Character Floors without Event Analyzer", async () => {
  let analyzerCalls = 0;
  const trace = [];
  const fixture = createFixture({
    messages: [
      {
        message_id: "coordinator-floor-58",
        floor: 58,
        content: "羲和元年三月四日 巳时中",
        role: "assistant",
      },
      {
        message_id: "coordinator-floor-60",
        floor: 60,
        content: "羲和元年五月初四 午时",
        role: "assistant",
      },
    ],
    storyTimeDebug: true,
    storyTimeTrace: entry => trace.push(entry),
    analyzer: {
      async analyzeFloor() {
        analyzerCalls += 1;
        throw new Error("ANALYZER_MUST_NOT_RUN");
      },
    },
  });
  await fixture.runtime.init();
  const info = await fixture.runtime.getCurrentStoryTimeInfo();
  assert.equal(analyzerCalls, 0);
  assert.equal(info.floor.version.message_id, "coordinator-floor-60");
  assert.equal(info.story_time.calendar_id, null);
  assert.equal(info.story_time.day_index, null);
  assert.equal(trace.at(-1).raw_header, "羲和元年五月初四 午时");
  assert.equal(trace.at(-1).source, "header");
  fixture.runtime.destroy();
});

test("Story Time debug DTO reads the current Floor without invoking Event Analyzer", async () => {
  let analyzerCalls = 0;
  const fixture = createFixture({
    messages: [{
      message_id: "debug-floor-60",
      floor: 60,
      content: "[SYNOPSIS_BLOCK]\nTIME: 羲和元年五月初四 午时\n[/SYNOPSIS_BLOCK]\n正文",
      role: "assistant",
    }],
    analyzer: {async analyzeFloor() { analyzerCalls += 1; throw new Error("ANALYZER_MUST_NOT_RUN"); }},
  });
  await fixture.runtime.init();
  const debug = await fixture.runtime.getStoryTimeDebugInfo();
  assert.equal(analyzerCalls, 0);
  assert.equal(debug.floor.message_id, "debug-floor-60");
  assert.equal(debug.source, "synopsis_block_time");
  assert.equal(debug.candidate, "羲和元年五月初四 午时");
  assert.equal(debug.parsed_parts.era_label, "羲和");
  assert.equal(debug.parsed_parts.year, 1);
  assert.equal(debug.parsed_parts.month, 5);
  assert.equal(debug.parsed_parts.day, 4);
  assert.equal(debug.story_time.day_index, null);
  assert.equal(debug.candidate_source, "synopsis_block_time");
  assert.equal(debug.resolution_source, "fresh");
  const cached = await fixture.runtime.getStoryTimeDebugInfo();
  assert.equal(cached.candidate_source, "synopsis_block_time");
  assert.equal(cached.resolution_source, "cache");
  fixture.runtime.destroy();
});

test("Story Time debug normalizes persisted display-only Event time without mutating the Floor", async () => {
  const fixture = createFixture({
    messages: [{
      message_id: "legacy-story-time-floor",
      floor: 60,
      content: "[SYNOPSIS_BLOCK]\nTIME: 羲和元年五月初四 午时\n[/SYNOPSIS_BLOCK]",
      role: "assistant",
    }],
    analyzer: {
      async analyzeFloor() {
        return {events: [eventResult("legacy-display-event", {
          story_time: {
            display: "羲和1年3月4日 巳时中",
            normalized: null,
            day_index: null,
            calendar_id: null,
            precision: "hour",
            confidence: 1,
          },
        })]};
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeCurrentFloor();
  const persisted = structuredClone(fixture.context.chat[0].extra.bioweave.events[0].story_time);
  const debug = await fixture.runtime.getStoryTimeDebugInfo();
  const transient = debug.recent_event.story_time;
  assert.deepEqual(fixture.context.chat[0].extra.bioweave.events[0].story_time, persisted);
  assert.equal(transient.display, "羲和1年3月4日 巳时中");
  assert.equal(transient.normalized, "cn-1-3-4T10:00");
  assert.equal(transient.day_index, null);
  assert.equal(transient.calendar_id, null);
  assert.deepEqual(debug.difference, {value: 61, unit: "day"});
  assert.equal(debug.failure_reason, null);
  fixture.runtime.destroy();
});

test("StoryTimeCoordinator supports explicit tags and rebuilds after deletion", async () => {
  const fixture = createFixture({
    messages: [
      {
        message_id: "tagged-floor-58",
        floor: 58,
        content: "【时间】羲和元年三月四日 巳时中\n历史文本",
        role: "assistant",
      },
      {
        message_id: "tagged-floor-60",
        floor: 60,
        content: "正文\n<story_time>羲和元年五月初四 午时</story_time>\n她想起羲和元年三月四日",
        role: "assistant",
      },
      {
        message_id: "tagged-user-61",
        floor: 61,
        content: "羲和元年六月初四",
        role: "user",
      },
    ],
    analyzer: {async analyzeFloor() { return {events: []}; }},
  });
  await fixture.runtime.init();
  assert.equal((await fixture.runtime.getCurrentStoryTime()).day_index, null);
  fixture.context.chat[1].content = "羲和元年五月初五 午时";
  fixture.emit("message-updated", {message_id: "tagged-floor-60"});
  await settle();
  assert.equal((await fixture.runtime.getCurrentStoryTime()).day_index, null);
  fixture.context.chat.splice(1, 1);
  fixture.emit("message-deleted", {message_id: "tagged-floor-60"});
  await settle();
  assert.equal((await fixture.runtime.getCurrentStoryTime()).day_index, null);
  fixture.runtime.destroy();
});

test("StoryTimeCoordinator extracts bounded affinity and synopsis Floor time without scanning narrative", async () => {
  const fixture = createFixture({
    messages: [
      {
        message_id: "bounded-floor-58",
        floor: 58,
        content: "羲和元年三月四日 巳时中\n旧楼",
        role: "assistant",
      },
      {
        message_id: "bounded-floor-60",
        floor: 60,
        content: [
          "[affinity_status]",
          "『羲和元年五月初四 · 周二 · 午时｜📍藏书阁』",
          "[/affinity_status]",
          "<content>",
          "她想起羲和元年三月四日发生的事情。",
          "</content>",
          "[SYNOPSIS_BLOCK]",
          "TIME: 羲和元年五月初四 午时",
          "LOCATION: 藏书阁",
          "[/SYNOPSIS_BLOCK]",
        ].join("\n"),
        role: "assistant",
      },
      {
        message_id: "bounded-user-61",
        floor: 61,
        content: "到了羲和元年六月初一。",
        role: "user",
      },
    ],
    analyzer: {async analyzeFloor() { throw new Error("ANALYZER_MUST_NOT_RUN"); }},
  });
  await fixture.runtime.init();
  const info = await fixture.runtime.getCurrentStoryTimeInfo();
  assert.equal(info.floor.version.message_id, "bounded-floor-60");
  assert.equal(info.story_time.display, "羲和元年五月初四 午时");
  assert.equal(info.story_time.calendar_id, null);
  assert.equal(info.story_time.day_index, null);
  fixture.runtime.destroy();
});

test("StoryTimeCoordinator keeps Chat-local Floor Story Time isolated", async () => {
  const fixture = createFixture({
    messages: [{message_id: "chat-a-floor", floor: 1, content: "羲和元年五月初四", role: "assistant"}],
    analyzer: {async analyzeFloor() { throw new Error("ANALYZER_MUST_NOT_RUN"); }},
  });
  await fixture.runtime.init();
  assert.equal((await fixture.runtime.getCurrentStoryTime()).day_index, null);
  fixture.context.chatId = "chat-runtime-b";
  fixture.context.chat = [{message_id: "chat-b-floor", floor: 1, content: "羲和元年九月初九", role: "assistant"}];
  fixture.emit("chat-changed", {chatId: "chat-runtime-b"});
  await settle();
  assert.equal((await fixture.runtime.getCurrentStoryTime()).day_index, null);
  fixture.runtime.destroy();
});

test("active Swipe Story Time is resolved from the active Character Floor only", async () => {
  const message = {
    message_id: "story-swipe-time",
    floor: 60,
    role: "assistant",
    swipe_id: 0,
    swipes: ["羲和元年五月初四 午时", "羲和元年六月初四 午时"],
    swipe_info: [{}, {}],
  };
  const fixture = createFixture({
    messages: [message],
    analyzer: {async analyzeFloor() { return {events: []}; }},
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  assert.equal((await fixture.runtime.getCurrentBiologicalState()).current_story_time.day_index, null);
  message.swipe_id = 1;
  fixture.emit("generation-started", {message_id: message.message_id, swipe_id: 1});
  fixture.emit("message-swiped", {message_id: message.message_id, swipe_id: 1, pendingGeneration: true});
  fixture.emit("character-message-rendered", {message_id: message.message_id, swipe_id: 1});
  await settle();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  assert.equal((await fixture.runtime.getCurrentBiologicalState()).current_story_time.day_index, null);
  fixture.runtime.destroy();
});

test("Runtime State read follows the active Swipe and never persists Current State", async () => {
  const message = {
    message_id: "state-swipe",
    floor: 3,
    swipe_id: 0,
    swipes: ["A", "B"],
    swipe_info: [{}, {}],
    role: "assistant",
  };
  let call = 0;
  const fixture = createFixture({
    messages: [message],
    analyzer: {
      async analyzeFloor() {
        call += 1;
        return { events: [eventResult(`swipe-state-${call}`)] };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const stateA = await fixture.runtime.getCurrentBiologicalState();
  assert.equal(stateA.current_state.processed_event_ids.length, 1);

  message.swipe_id = 1;
  await fixture.runtime.analyzeFloor({ __messageIndex: true, index: 0 }, { force: true });
  const stateB = await fixture.runtime.getCurrentBiologicalState();
  assert.equal(stateB.current_state.processed_event_ids.length, 1);
  assert.notDeepEqual(
    stateB.current_state.processed_event_ids,
    stateA.current_state.processed_event_ids,
  );
  assert.equal(message.extra?.bioweave?.current_state, undefined);
  assert.equal(message.swipe_info[0].extra?.bioweave?.current_state, undefined);
  assert.equal(message.swipe_info[1].extra?.bioweave?.current_state, undefined);
  assert.equal(fixture.context.chatMetadata.bioweave?.current_state, undefined);
  assert.deepEqual(stateB, await fixture.runtime.getCurrentBiologicalState());
  fixture.runtime.destroy();
});

test("Runtime State read preserves unknown capabilities and does not infer identity from display names", async () => {
  const fixture = createFixture({
    analyzer: {
      async analyzeFloor() {
        const original = eventResult();
        return {
          events: [eventResult("state-capability-unknown", {
            participants: original.participants.map((participant) => ({
              ...participant,
              biological_context: {},
              reproductive_capabilities_used: {},
            })),
            pregnancy_relevance: {
              ...original.pregnancy_relevance,
              possible_conception: true,
            },
          })],
        };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const result = await fixture.runtime.getCurrentBiologicalState();
  const characters = Object.values(result.current_state.characters);
  assert.equal(characters.length, 1);
  assert.equal(characters[0].reproductive_capabilities.can_cause_pregnancy, null);
  assert.equal(characters[0].reproductive_capabilities.can_carry_pregnancy, null);
  assert.equal(result.current_state.characters.Bob, undefined);
  assert.equal(characters[0].conception.status, "unknown");
  fixture.runtime.destroy();
});

test("Runtime creates a Floor-owned Snapshot after three Character Floors", async () => {
  const fixture = createFixture({
    messages: [
      { message_id: "snapshot-floor-1", floor: 1, content: "一", role: "assistant" },
      { message_id: "snapshot-user-2", floor: 2, content: "用户", role: "user" },
      { message_id: "snapshot-floor-3", floor: 3, content: "三", role: "assistant" },
      { message_id: "snapshot-user-4", floor: 4, content: "用户", role: "user" },
      { message_id: "snapshot-floor-5", floor: 5, content: "五", role: "assistant" },
    ],
    analyzer: {
      async analyzeFloor({ analysisInput }) {
        return { events: [eventResultForRegistry(analysisInput.character_registry)] };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({ __messageIndex: true, index: 0 }, { force: true });
  await fixture.runtime.analyzeFloor({ __messageIndex: true, index: 2 }, { force: true });
  await fixture.runtime.analyzeFloor({ __messageIndex: true, index: 4 }, { force: true });

  const snapshot = fixture.runtime.store.getFloor(4, 0).snapshot;
  assert.ok(snapshot);
  assert.equal(snapshot.checkpoint.message_id, "snapshot-floor-5");
  assert.equal(snapshot.checkpoint.swipe_id, 0);
  assert.equal(fixture.context.chat[1].extra?.bioweave?.snapshot, undefined);
  assert.equal(fixture.context.chat[3].extra?.bioweave?.snapshot, undefined);
  assert.equal(fixture.context.chatMetadata.bioweave?.snapshot, undefined);
  assert.equal(Object.hasOwn(snapshot, "projection"), false);
  assert.equal(Object.hasOwn(snapshot, "probability"), false);
  assert.equal(Object.hasOwn(snapshot, "ui"), false);
  fixture.runtime.destroy();
});

test("Runtime Snapshot restore uses a strict post-checkpoint Event boundary and falls back from corruption", async () => {
  const messages = Array.from({ length: 3 }, (_, index) => ({
    message_id: `snapshot-history-${index}`,
    floor: index + 1,
    content: `历史 ${index}`,
    role: "assistant",
  }));
  let analysisCount = 0;
  const fixture = createFixture({
    messages,
    analyzer: {
      async analyzeFloor({ analysisInput }) {
        analysisCount += 1;
        return {
          events: [eventResultForRegistry(
            analysisInput.character_registry,
            `snapshot-history-event-${analysisCount}`,
          )],
        };
      },
    },
  });
  await fixture.runtime.init();
  for (let index = 0; index < messages.length; index += 1)
    await fixture.runtime.analyzeFloor({ __messageIndex: true, index }, { force: true });

  fixture.context.chat.push(
    ...Array.from({ length: 3 }, (_, offset) => {
      const index = offset + 3;
      return {
        message_id: `snapshot-history-${index}`,
        floor: index + 1,
        content: `历史 ${index}`,
        role: "assistant",
      };
    }),
  );
  for (let index = 3; index < 6; index += 1)
    await fixture.runtime.analyzeFloor({ __messageIndex: true, index }, { force: true });

  const latestSnapshot = structuredClone(fixture.runtime.store.getFloor(5, 0).snapshot);
  const checkpointSnapshot = fixture.runtime.store.getFloor(2, 0).snapshot;
  assert.ok(checkpointSnapshot);
  assert.ok(latestSnapshot);
  const restored = await fixture.runtime.getCurrentBiologicalState();
  const restoredIds = restored.current_state.processed_event_ids;
  assert.equal(new Set(restoredIds).size, restoredIds.length);
  assert.equal(checkpointSnapshot.state.processed_event_ids.length, 3);
  assert.equal(restoredIds.length, 6);

  fixture.context.chat[5].extra.bioweave.snapshot = {
    ...latestSnapshot,
    state: { ...latestSnapshot.state, processed_event_ids: "corrupt" },
  };
  const fallback = await fixture.runtime.getCurrentBiologicalState();
  assert.deepEqual(fallback.current_state, restored.current_state);

  for (const message of fixture.context.chat)
    if (message.extra?.bioweave) message.extra.bioweave.snapshot = null;
  const fullReplay = await fixture.runtime.getCurrentBiologicalState();
  assert.deepEqual(fallback.current_state, fullReplay.current_state);
  fixture.runtime.destroy();
});

test("Runtime State reads never create or rewrite a Snapshot", async () => {
  const fixture = createFixture({
    messages: [
      { message_id: "readonly-snapshot-1", floor: 1, content: "一", role: "assistant" },
      { message_id: "readonly-snapshot-2", floor: 2, content: "二", role: "assistant" },
      { message_id: "readonly-snapshot-3", floor: 3, content: "三", role: "assistant" },
    ],
    analyzer: {
      async analyzeFloor({ analysisInput }) {
        return { events: [eventResultForRegistry(analysisInput.character_registry)] };
      },
    },
  });
  await fixture.runtime.init();
  for (let index = 0; index < 3; index += 1)
    await fixture.runtime.analyzeFloor({ __messageIndex: true, index }, { force: true });
  const writesAfterAnalysis = fixture.saveFloorCalls();
  const snapshotBefore = structuredClone(fixture.runtime.store.getFloor(2, 0).snapshot);
  await fixture.runtime.getCurrentBiologicalState();
  await fixture.runtime.getCurrentBiologicalState();
  assert.equal(fixture.saveFloorCalls(), writesAfterAnalysis);
  assert.deepEqual(fixture.runtime.store.getFloor(2, 0).snapshot, snapshotBefore);
  fixture.runtime.destroy();
});

test("Story Time-only advancement restores from an unchanged earlier Snapshot", async () => {
  let analysisCount = 0;
  const fixture = createFixture({
    messages: [{
      message_id: "story-snapshot-a",
      floor: 10,
      content: "2026-01-01\nDay 0",
      role: "assistant",
    }],
    analyzer: {
      async analyzeFloor({ analysisInput }) {
        analysisCount += 1;
        return analysisCount === 1
          ? {
              events: [eventResultForRegistry(
                analysisInput.character_registry,
                "story-snapshot-exposure",
                {
                  story_time: {
                    display: "2026-01-01",
                    normalized: "2026-01-01",
                    day_index: 20454,
                    calendar_id: "main",
                    precision: "day",
                    confidence: 1,
                  },
                },
              )],
            }
          : { events: [] };
      },
    },
  });
  fixture.context.chatMetadata.bioweave = emptyChat("chat-runtime");
  fixture.context.chatMetadata.bioweave.settings.snapshot_interval = 1;
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({ __messageIndex: true, index: 0 }, { force: true });
  const snapshotA = structuredClone(fixture.runtime.store.getFloor(0, 0).snapshot);
  assert.ok(snapshotA);

  fixture.context.chat.push({
    message_id: "story-snapshot-b",
    floor: 13,
    content: "2026-04-01\nDay 90",
    role: "assistant",
  });
  await fixture.runtime.analyzeFloor({ __messageIndex: true, index: 1 }, { force: true });

  const current = await fixture.runtime.getCurrentBiologicalState();
  const subject = Object.values(current.current_state.characters)[0];
  assert.equal(current.current_story_time.day_index, 20544);
  assert.equal(subject.reproductive_exposure.elapsed_story_days, 90);
  assert.deepEqual(fixture.runtime.store.getFloor(0, 0).snapshot, snapshotA);
  assert.equal(fixture.runtime.store.getFloor(1, 0).snapshot.checkpoint.message_id, "story-snapshot-b");
  fixture.runtime.destroy();
});

test("automatic analysis runs Initial World Analysis before Character/Event Analysis", async () => {
  const order = [];
  const worldModel = normalizeWorldModel({ schema_version: 1, species: [{ name: "世界 A" }] });
  const fixture = createFixture({
    analyzer: {
      async analyzeWorldModel() {
        order.push("world");
        return worldModel;
      },
      async analyzeFloor({ world_model }) {
        order.push("event");
        assert.deepEqual(world_model, worldModel);
        return { events: [] };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({ __messageIndex: true, index: 0 }, { force: true });
  assert.deepEqual(order, ["world", "event"]);
  assert.deepEqual(fixture.runtime.store.getFloor(0).world_model, worldModel);
  fixture.runtime.destroy();
});

test("World Analysis failure is fail-closed and does not run Character/Event Analysis", async () => {
  let eventCalls = 0;
  const fixture = createFixture({
    analyzer: {
      async analyzeWorldModel() {
        throw new Error("WORLD_API_FAILED");
      },
      async analyzeFloor() {
        eventCalls += 1;
        return { events: [] };
      },
    },
  });
  await fixture.runtime.init();
  await assert.rejects(
    fixture.runtime.analyzeFloor({ __messageIndex: true, index: 0 }, { force: true }),
    error => error?.code === "WORLD_MODEL_UNAVAILABLE",
  );
  assert.equal(eventCalls, 0);
  assert.equal(fixture.runtime.store.getFloor(0).analysis, null);
  assert.equal(fixture.runtime.store.getFloor(0).events.length, 0);
  fixture.runtime.destroy();
});

test("existing World Model is reused without an extra World AI request", async () => {
  const messages = [
    { message_id: "world-a-floor", floor: 3, content: "A", role: "assistant" },
    { message_id: "event-floor", floor: 6, content: "普通剧情", role: "assistant" },
  ];
  const worldModel = normalizeWorldModel({ schema_version: 1, species: [{ name: "世界 A" }] });
  let worldCalls = 0;
  let receivedWorld = null;
  const fixture = createFixture({
    messages,
    analyzer: {
      async analyzeWorldModel() { worldCalls += 1; return worldModel; },
      async analyzeFloor({ world_model }) { receivedWorld = world_model; return { events: [] }; },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.store.saveFloor(0, 0, {
    ...emptyFloor(),
    floor_version: await floorVersion({ chatId: "chat-runtime", messageId: "world-a-floor", floor: 3, text: "A" }),
    world_model: worldModel,
  });
  await fixture.runtime.analyzeFloor({ __messageIndex: true, index: 1 }, { force: false });
  assert.equal(worldCalls, 0);
  assert.deepEqual(receivedWorld, worldModel);
  fixture.runtime.destroy();
});

test("World Patch Analysis merges deterministically and saves only the current Floor", async () => {
  const messages = [
    { message_id: "world-a-floor", floor: 3, content: "A", role: "assistant" },
    { message_id: "world-b-floor", floor: 6, content: "新增世界规则：出现新物种。", role: "assistant" },
  ];
  const worldA = normalizeWorldModel({ schema_version: 1, species: [{ name: "世界 A" }] });
  const worldBSpecies = { name: "世界 B", description: "新增物种" };
  let patchCalls = 0;
  let receivedWorld = null;
  const fixture = createFixture({
    messages,
    analyzer: {
      async analyzeWorldModelPatch() {
        patchCalls += 1;
        return { schema_version: 1, add: { species: [worldBSpecies] }, update: {} };
      },
      async analyzeFloor({ world_model }) { receivedWorld = world_model; return { events: [] }; },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.store.saveFloor(0, 0, {
    ...emptyFloor(),
    floor_version: await floorVersion({ chatId: "chat-runtime", messageId: "world-a-floor", floor: 3, text: "A" }),
    world_model: worldA,
  });
  await fixture.runtime.analyzeFloor({ __messageIndex: true, index: 1 }, { force: true });
  assert.equal(patchCalls, 1);
  assert.deepEqual(receivedWorld.species.map(item => item.name), ["世界 A", "世界 B"]);
  assert.deepEqual(fixture.runtime.store.getFloor(0).world_model, worldA);
  assert.deepEqual(fixture.runtime.store.getFloor(1).world_model, receivedWorld);
  fixture.runtime.destroy();
});

test("invalid World Patch fails closed without replacing the existing World Model", async () => {
  const messages = [
    { message_id: "world-a-floor", floor: 3, content: "A", role: "assistant" },
    { message_id: "world-b-floor", floor: 6, content: "新增世界规则：出现新物种。", role: "assistant" },
  ];
  const worldA = normalizeWorldModel({ schema_version: 1, species: [{ name: "世界 A" }] });
  let eventCalls = 0;
  const fixture = createFixture({
    messages,
    analyzer: {
      async analyzeWorldModelPatch() {
        return {
          schema_version: 1,
          add: {},
          update: { species: [{ name: "不存在的旧物种", description: "不能静默替换" }] },
        };
      },
      async analyzeFloor() {
        eventCalls += 1;
        return { events: [] };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.store.saveFloor(0, 0, {
    ...emptyFloor(),
    floor_version: await floorVersion({ chatId: "chat-runtime", messageId: "world-a-floor", floor: 3, text: "A" }),
    world_model: worldA,
  });
  await assert.rejects(
    fixture.runtime.analyzeFloor({ __messageIndex: true, index: 1 }, { force: true }),
    error => error?.code === "WORLD_MODEL_UNAVAILABLE",
  );
  assert.equal(eventCalls, 0);
  assert.deepEqual(fixture.runtime.store.getFloor(0).world_model, worldA);
  assert.equal(fixture.runtime.store.getFloor(1).world_model, null);
  fixture.runtime.destroy();
});

test("stale World Analysis completion is discarded before Character/Event Analysis", async () => {
  let release;
  let eventCalls = 0;
  const started = new Promise(resolve => {
    release = resolve;
  });
  const fixture = createFixture({
    analyzer: {
      async analyzeWorldModel() {
        await started;
        return normalizeWorldModel({ schema_version: 1, species: [{ name: "STALE" }] });
      },
      async analyzeFloor() {
        eventCalls += 1;
        return { events: [] };
      },
    },
  });
  await fixture.runtime.init();
  const pending = fixture.runtime.analyzeFloor({ __messageIndex: true, index: 0 }, { force: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  fixture.runtime.chat.invalidate("stale-world");
  release();
  await assert.rejects(pending, /REQUEST_ABORTED|STALE_CHAT/);
  assert.equal(eventCalls, 0);
  assert.equal(fixture.runtime.store.getFloor(0).world_model, null);
  fixture.runtime.destroy();
});

test("Chat-local enabled defaults true, pauses automatic analysis, preserves history, and resumes without backlog", async () => {
  const fixture = createFixture();
  await fixture.runtime.init();
  assert.equal(fixture.runtime.getBioWeaveEnabled(), true);

  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 0}, {force: true});
  const beforePause = structuredClone(fixture.runtime.store.getFloor(0));
  const callsBeforePause = fixture.calls();

  await fixture.runtime.setBioWeaveEnabled(false);
  assert.equal(fixture.runtime.getBioWeaveEnabled(), false);
  assert.deepEqual(fixture.runtime.store.getFloor(0), beforePause);
  const skipped = await fixture.runtime.refreshCurrentFloorAnalysis();
  assert.equal(skipped.status, "disabled");
  assert.equal(fixture.calls(), callsBeforePause);
  assert.equal(fixture.runtime.store.getFloor(0).analysis.status, "success");

  await fixture.runtime.setBioWeaveEnabled(true);
  assert.equal(fixture.runtime.getBioWeaveEnabled(), true);
  assert.equal(fixture.calls(), callsBeforePause);
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 0}, {force: true});
  assert.ok(fixture.calls() > callsBeforePause);
  fixture.runtime.destroy();
});

test("disabling an in-flight analysis prevents its late response from committing", async () => {
  let release;
  const started = new Promise(resolve => { release = resolve; });
  const fixture = createFixture({
    analyzer: {
      async analyzeWorldModel() {
        return normalizeWorldModel({schema_version: 1, species: [{ name: "人类", biological_types: [] }]});
      },
      async analyzeFloor() {
        await started;
        return {events: [eventResult("late-event")]};
      },
    },
  });
  await fixture.runtime.init();
  const pending = fixture.runtime.analyzeFloor({__messageIndex: true, index: 0}, {force: true});
  await new Promise(resolve => setTimeout(resolve, 0));
  await fixture.runtime.setBioWeaveEnabled(false);
  release();
  const result = await pending;
  assert.equal(result.status, "disabled");
  assert.equal(fixture.runtime.store.getFloor(0).analysis, null);
  assert.deepEqual(fixture.runtime.store.getFloor(0).events, []);
  fixture.runtime.destroy();
});

function deferredWorldRequest() {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  return { pending, release };
}

function worldFloorMessages() {
  return [
    { message_id: "world-owner", floor: 3, content: "已有世界规则", role: "assistant" },
    { message_id: "current-floor", floor: 6, content: "当前楼层新增世界规则", role: "assistant" },
  ];
}

async function seedWorldOwner(fixture, worldModel) {
  await fixture.runtime.init();
  await fixture.runtime.store.saveFloor(0, 0, {
    ...emptyFloor(),
    floor_version: await floorVersion({
      chatId: "chat-runtime",
      messageId: "world-owner",
      floor: 3,
      text: "已有世界规则",
    }),
    world_model: worldModel,
  });
}

test("World single-flight deduplicates Auto World and Manual Full API requests", async () => {
  const gate = deferredWorldRequest();
  const worldModel = normalizeWorldModel({ schema_version: 1, species: [{ name: "完整世界" }] });
  let worldCalls = 0;
  let eventCalls = 0;
  const fixture = createFixture({
    messages: [{ message_id: "current-floor", floor: 6, content: "当前剧情", role: "assistant" }],
    analyzer: {
      async analyzeWorldModel() {
        worldCalls += 1;
        await gate.pending;
        return worldModel;
      },
      async analyzeFloor() {
        eventCalls += 1;
        return { events: [] };
      },
    },
  });
  await fixture.runtime.init();
  const manual = fixture.runtime.analyzeCurrentWorldModelFull({ analysisInput: {} });
  await new Promise(resolve => setTimeout(resolve, 0));
  const automatic = fixture.runtime.analyzeFloor({ __messageIndex: true, index: 0 }, { force: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(worldCalls, 1);
  gate.release();
  await Promise.all([manual, automatic]);
  assert.equal(eventCalls, 1);
  fixture.runtime.destroy();
});

test("World single-flight deduplicates Auto World and Manual Patch API requests", async () => {
  const gate = deferredWorldRequest();
  const worldA = normalizeWorldModel({ schema_version: 1, species: [{ name: "已有世界" }] });
  let patchCalls = 0;
  let eventCalls = 0;
  const fixture = createFixture({
    messages: worldFloorMessages(),
    analyzer: {
      async analyzeWorldModelPatch() {
        patchCalls += 1;
        await gate.pending;
        return { schema_version: 1, add: {}, update: {} };
      },
      async analyzeFloor() {
        eventCalls += 1;
        return { events: [] };
      },
    },
  });
  await seedWorldOwner(fixture, worldA);
  const manual = fixture.runtime.analyzeCurrentWorldModelPatch({ analysisInput: {} });
  await new Promise(resolve => setTimeout(resolve, 10));
  const automatic = fixture.runtime.analyzeFloor({ __messageIndex: true, index: 1 }, { force: true });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(patchCalls, 1);
  gate.release();
  await Promise.all([manual, automatic]);
  assert.equal(eventCalls, 1);
  assert.deepEqual(fixture.runtime.store.getFloor(0).world_model, worldA);
  fixture.runtime.destroy();
});

test("Auto Analysis reuses an in-flight Manual Full request without a second World API call", async () => {
  const gate = deferredWorldRequest();
  const worldModel = normalizeWorldModel({ schema_version: 1, species: [{ name: "手动完整世界" }] });
  let worldCalls = 0;
  const fixture = createFixture({
    messages: [{ message_id: "current-floor", floor: 6, content: "当前剧情", role: "assistant" }],
    analyzer: {
      async analyzeWorldModel() {
        worldCalls += 1;
        await gate.pending;
        return worldModel;
      },
      async analyzeFloor() { return { events: [] }; },
    },
  });
  await fixture.runtime.init();
  const manual = fixture.runtime.analyzeCurrentWorldModelFull({ analysisInput: {} });
  await new Promise(resolve => setTimeout(resolve, 0));
  const automatic = fixture.runtime.analyzeFloor({ __messageIndex: true, index: 0 }, { force: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(worldCalls, 1);
  gate.release();
  await Promise.all([manual, automatic]);
  fixture.runtime.destroy();
});

test("Auto Analysis reuses an in-flight Manual Patch request without a second World API call", async () => {
  const gate = deferredWorldRequest();
  const worldA = normalizeWorldModel({ schema_version: 1, species: [{ name: "已有世界" }] });
  let patchCalls = 0;
  const fixture = createFixture({
    messages: worldFloorMessages(),
    analyzer: {
      async analyzeWorldModelPatch() {
        patchCalls += 1;
        await gate.pending;
        return { schema_version: 1, add: {}, update: {} };
      },
      async analyzeFloor() { return { events: [] }; },
    },
  });
  await seedWorldOwner(fixture, worldA);
  const manual = fixture.runtime.analyzeCurrentWorldModelPatch({ analysisInput: {} });
  await new Promise(resolve => setTimeout(resolve, 10));
  const automatic = fixture.runtime.analyzeFloor({ __messageIndex: true, index: 1 }, { force: true });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(patchCalls, 1);
  gate.release();
  await Promise.all([manual, automatic]);
  fixture.runtime.destroy();
});

test("Manual Full and Manual Patch share one World persistence job", async () => {
  const gate = deferredWorldRequest();
  const worldA = normalizeWorldModel({ schema_version: 1, species: [{ name: "已有世界" }] });
  const worldB = normalizeWorldModel({ schema_version: 1, species: [{ name: "完整新世界" }] });
  let fullCalls = 0;
  let patchCalls = 0;
  const fixture = createFixture({
    messages: worldFloorMessages(),
    analyzer: {
      async analyzeWorldModel() {
        fullCalls += 1;
        await gate.pending;
        return worldB;
      },
      async analyzeWorldModelPatch() {
        patchCalls += 1;
        await gate.pending;
        return { schema_version: 1, add: {}, update: {} };
      },
    },
  });
  await seedWorldOwner(fixture, worldA);
  const full = fixture.runtime.analyzeCurrentWorldModelFull({ analysisInput: {} });
  await new Promise(resolve => setTimeout(resolve, 0));
  const patch = fixture.runtime.analyzeCurrentWorldModelPatch({ analysisInput: {} });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(fullCalls, 1);
  assert.equal(patchCalls, 0);
  gate.release();
  await Promise.all([full, patch]);
  assert.deepEqual(fixture.runtime.store.getFloor(1).world_model, worldB);
  assert.deepEqual(fixture.runtime.store.getFloor(0).world_model, worldA);
  assert.equal(fixture.saveFloorCalls(), 2);
  fixture.runtime.destroy();
});
