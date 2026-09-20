import test from "node:test";
import assert from "node:assert/strict";
import { createRuntime } from "../runtime/events.js";
import { createAnalyzer } from "../ai/analyzer.js";
import { CONCEPTION_RELEVANT_EXPOSURE_EVIDENCE_KIND } from "../core/events.js";
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
      provider: "bioweave_fallback",
      precision: "unknown",
      confidence: 0.6,
    },
    location: "房间",
    participants: [
      {
        character_id: "char-a",
        display_name: "Alice",
        event_role: "potential_gestational_subject",
        biological_context: { species: "species-a", biological_type: "type-a" },
        reproductive_capabilities_used: { can_carry_pregnancy: true },
        evidence: [{ kind: "narrative", text: "明确证据" }],
      },
      {
        character_id: "char-b",
        display_name: "Bob",
        event_role: "potential_conception_source",
        biological_context: { species: "species-b", biological_type: "type-b" },
        reproductive_capabilities_used: { can_cause_pregnancy: true },
        evidence: [{ kind: "narrative", text: "实际来源证据" }],
      },
    ],
    pregnancy_relevance: {
      relevant: true,
      possible_conception: true,
      gestational_subject_ids: ["char-a"],
      counterpart_ids: ["char-b"],
      confidence: 0.8,
    },
    source_evidence: [
      { kind: "current_floor", text: "当前楼层" },
      {
        kind: CONCEPTION_RELEVANT_EXPOSURE_EVIDENCE_KIND,
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
  characterContextResolver = null,
  rawApiResponse = null,
  saveFloorError = null,
  saveFloorHook = null,
  saveChatMetadataHook = null,
  saveChatMetadataError = null,
  saveChatMetadataErrorAt = 0,
  allowLegacyIdentity = true,
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
    extensionSettings: { bioweave: {} },
    eventTypes: {
      CHAT_CHANGED: "chat-changed",
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
    async saveMetadata() {},
    async saveChat() {},
  };
  let saveChatMetadataCalls = 0;
  let saveFloorCalls = 0;
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
  const runtime = createRuntime({
    adapter,
    allowLegacyIdentity,
    ...(typeof characterContextResolver === "function"
      ? { characterContextResolver }
      : {}),
    analyzer:
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
          }),
  });
  return {
    runtime,
    context,
    listeners,
    apiRequests,
    calls: () => calls,
    saveChatMetadataCalls: () => saveChatMetadataCalls,
    saveFloorCalls: () => saveFloorCalls,
    emit(type, payload) {
      listeners.get(type)?.(payload);
    },
  };
}

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
      provider: null,
      precision: "unknown",
      confidence: null,
    },
    location: "location_fixture",
    participants: participants ?? [
      {
        character_id: subjectId,
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
          can_carry_pregnancy: true,
          can_cause_pregnancy: false,
        },
        evidence: [
          {
            kind: "capability",
            text: "explicit gestational capability fixture evidence",
          },
        ],
      },
      {
        character_id: sourceId,
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
          can_carry_pregnancy: false,
          can_cause_pregnancy: true,
        },
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
      gestational_subject_ids: [subjectId],
      counterpart_ids: [sourceId],
      confidence: 0.9,
    },
    source_evidence: [
      {
        kind: "narrative",
        text: "explicit current-floor exposure fixture evidence",
      },
      {
        kind: CONCEPTION_RELEVANT_EXPOSURE_EVIDENCE_KIND,
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
  assert.deepEqual(registry.tracking_subjects["char-a"].exposure_event_ids, [
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
      allowLegacyIdentity: false,
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

    await withGlobalCrypto(
      {
        randomUUID: (() => {
          const ids = ["char_runtime_subject_001", "char_runtime_source_001"];
          return () => ids.shift();
        })(),
      },
      async () => {
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
        assert.equal(
          inputRegistries[1].entities[subjectId].display_name,
          "苏晚",
        );
        assert.deepEqual(inputRegistries[1].entities[subjectId].aliases, [
          "晚儿",
        ]);
        assert.deepEqual(
          secondEvent.participants.map(
            (participant) => participant.character_id,
          ),
          [subjectId, sourceId],
        );
        assert.equal(Object.keys(secondRegistry.entities).length, 2);
        assert.deepEqual(
          fixture.runtime.store.getFloor(1).character_registry,
          secondRegistry,
        );
      },
    );
    fixture.runtime.destroy();
  },
);

test("unresolved identity aborts the whole Event batch without registry or Floor pollution", async () => {
  const fixture = createFixture({
    allowLegacyIdentity: false,
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
    allowLegacyIdentity: false,
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
  assert.equal(events[0].participants[1].character_id, "character_source");
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
    data.tracking_subjects.character_subject.exposure_event_ids,
    [events[0].event_id],
  );
  assert.equal(data.tracking_subjects.character_source, undefined);
  fixture.runtime.destroy();
});

test(
  "successful analysis saves the complete identity result to Floor before Chat projection",
  { concurrency: false },
  async () => {
    const saveOrder = [];
    const fixture = createFixture({
      allowLegacyIdentity: false,
      saveFloorHook: async ({ value }) => {
        saveOrder.push({ kind: "floor", value: structuredClone(value) });
      },
      saveChatMetadataHook: async ({ value }) => {
        saveOrder.push({ kind: "chat", value: structuredClone(value) });
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

    await withGlobalCrypto(
      {
        randomUUID: (() => {
          const ids = ["char_atomic", "char_atomic_source"];
          return () => ids.shift();
        })(),
      },
      async () => {
        await fixture.runtime.init();
        await fixture.runtime.refreshTrackingRegistry("before-analysis");
        saveOrder.length = 0;

        await fixture.runtime.refreshCurrentFloorAnalysis();
      },
    );

    assert.deepEqual(
      saveOrder.map(({ kind }) => kind),
      ["floor", "chat"],
    );
    assert.equal(saveOrder[0].value.analysis.status, "success");
    assert.equal(saveOrder[0].value.events.length, 1);
    assert.deepEqual(
      saveOrder[1].value.character_registry,
      saveOrder[0].value.character_registry,
    );
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
  assert.equal(pendingRegistry.tracking_subjects.subject_a, undefined);
  assert.equal(
    pendingRegistry.tracking_candidates.subject_a.eligibility,
    "pending",
  );
  const storedEvent = (await fixture.runtime.getCurrentFloorEvents())[0];
  const pendingRecord =
    pendingRegistry.tracking_candidates.subject_a.exposure_records[0];
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
  assert.ok(resolvedRegistry.tracking_subjects.subject_a);
  assert.equal(
    resolvedRegistry.tracking_subjects.subject_a.created_from_event_id,
    storedEvent.event_id,
  );
  assert.deepEqual(resolvedRegistry.tracking_candidates, {});
  assert.equal(
    "pregnant" in resolvedRegistry.tracking_subjects.subject_a,
    false,
  );
  assert.equal(
    "conception_confirmed" in resolvedRegistry.tracking_subjects.subject_a,
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
      .subject_profile.eligibility,
    "pending",
  );

  const firstEvent = (await fixture.runtime.getCurrentFloorEvents())[0];
  await fixture.runtime.refreshCurrentFloorAnalysis();

  const resolvedRegistry = await fixture.runtime.getTrackingRegistry();
  assert.ok(resolvedRegistry.tracking_subjects.subject_profile);
  assert.deepEqual(resolvedRegistry.tracking_candidates, {});
  assert.equal(
    resolvedRegistry.tracking_subjects.subject_profile.created_from_event_id,
    firstEvent.event_id,
  );
  assert.equal(
    fixture.runtime.store.getChat("chat-runtime").character_profiles
      .subject_profile.reproductive_capabilities.can_carry_pregnancy,
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
      provider: "narrative",
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
    provider: "narrative",
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
      provider: "narrative",
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
    provider: "narrative",
    precision: "minute",
    confidence: 1,
  });
  fixture.runtime.destroy();
});

test("production analyzer accepts multi-Event force refresh and keeps exposure tracking subject-local", async () => {
  const firstEvent = canonicalApiEvent();
  firstEvent.location = "location_alpha";
  const secondEvent = canonicalApiEvent({
    subjectId: "character_subject_b",
    sourceId: "character_source_b",
  });
  secondEvent.location = "location_beta";
  let rawResponse = JSON.stringify({
    schema_version: 1,
    events: [firstEvent],
    source: {
      chat_id: "legacy-chat",
      message_id: "legacy-message",
      floor: 999,
    },
  });
  const fixture = createFixture({ rawApiResponse: () => rawResponse });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();

  const previousEvents = await fixture.runtime.getCurrentFloorEvents();
  const previousId = previousEvents[0].event_id;

  rawResponse = JSON.stringify({
    schema_version: 1,
    events: [firstEvent, secondEvent],
    source: {
      chat_id: "legacy-chat",
      message_id: "legacy-message",
      floor: 999,
    },
  });
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
      "character_subject",
  );
  const subjectBEvent = events.find(
    (event) =>
      event.pregnancy_relevance.gestational_subject_ids[0] ===
      "character_subject_b",
  );
  assert.ok(subjectAEvent);
  assert.ok(subjectBEvent);
  assert.equal(subjectAEvent.event_id, previousId);
  assert.notEqual(subjectBEvent.event_id, subjectAEvent.event_id);
  assert.equal(subjectAEvent.location, "location_alpha");
  assert.equal(subjectBEvent.location, "location_beta");
  assert.deepEqual(subjectAEvent.pregnancy_relevance.counterpart_ids, [
    "character_source",
  ]);
  assert.deepEqual(subjectBEvent.pregnancy_relevance.counterpart_ids, [
    "character_source_b",
  ]);
  assert.deepEqual(
    subjectAEvent.participants.map((item) => item.character_id),
    ["character_subject", "character_source"],
  );
  assert.deepEqual(
    subjectBEvent.participants.map((item) => item.character_id),
    ["character_subject_b", "character_source_b"],
  );

  const data = await fixture.runtime.collectActiveBusinessData();
  assert.equal(data.active_event_count, 2);
  assert.equal(data.tracking_subject_count, 2);
  assert.deepEqual(Object.keys(data.tracking_subjects).sort(), [
    "character_subject",
    "character_subject_b",
  ]);
  assert.deepEqual(Object.keys(data.character_profiles).sort(), [
    "character_subject",
    "character_subject_b",
  ]);
  assert.deepEqual(
    data.tracking_subjects.character_subject.exposure_event_ids,
    [subjectAEvent.event_id],
  );
  assert.deepEqual(
    data.tracking_subjects.character_subject_b.exposure_event_ids,
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
    "subject_a",
  ]);

  const data = await fixture.runtime.collectActiveBusinessData();
  assert.deepEqual(Object.keys(data.tracking_subjects), ["subject_a"]);
  assert.deepEqual(Object.keys(data.character_profiles), ["subject_a"]);
  assert.equal(data.tracking_subjects.subject_b, undefined);
  assert.equal(data.character_profiles.subject_b, undefined);
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
    allowLegacyIdentity: false,
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

  await withGlobalCrypto(
    {
      randomUUID: (() => {
        const ids = [
          "char_a",
          "char_source_a",
          "char_b",
          "char_source_b",
          "char_c",
          "char_source_c",
          "char_d",
          "char_source_d",
        ];
        return () => ids.shift();
      })(),
    },
    async () => {
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
        "char_a",
        "char_source_a",
      ]);
      assert.deepEqual(entityIds(inputs[2].character_registry), [
        "char_a",
        "char_b",
        "char_source_a",
        "char_source_b",
      ]);
      assert.deepEqual(
        entityIds(fixture.runtime.store.getFloor(1).character_registry),
        ["char_a", "char_b", "char_source_a", "char_source_b"],
      );
      assert.deepEqual(
        entityIds(fixture.runtime.store.getFloor(2).character_registry),
        [
          "char_a",
          "char_b",
          "char_c",
          "char_source_a",
          "char_source_b",
          "char_source_c",
        ],
      );

      await fixture.runtime.analyzeFloor(
        { __messageIndex: true, index: 2 },
        { force: true },
      );
      assert.doesNotMatch(
        JSON.stringify(inputs[3].character_context),
        /角色C|来源C|char_c|char_source_c/u,
      );
      assert.deepEqual(entityIds(inputs[3].character_registry), [
        "char_a",
        "char_b",
        "char_source_a",
        "char_source_b",
      ]);
      assert.equal(inputs[3].character_registry.entities.char_c, undefined);
      assert.deepEqual(
        entityIds(fixture.runtime.store.getFloor(2).character_registry),
        [
          "char_a",
          "char_b",
          "char_d",
          "char_source_a",
          "char_source_b",
          "char_source_d",
        ],
      );
    },
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
        return { events: [eventResult(`event-${inputs.length}`)] };
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
    allowLegacyIdentity: false,
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
  const ids = [
    "char_a",
    "char_source_a",
    "char_b",
    "char_source_b",
    "char_c",
    "char_source_c",
    "char_d",
    "char_source_d",
    "char_e",
    "char_source_e",
  ];

  await withGlobalCrypto({ randomUUID: () => ids.shift() }, async () => {
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
    assert.equal(inputs.at(-1).character_registry.entities.char_c, undefined);

    fixture.context.chat.splice(1, 1);
    await fixture.runtime.analyzeFloor("message-target", { force: true });
    assert.deepEqual(
      Object.values(inputs.at(-1).character_registry.entities).map(
        (entry) => entry.display_name,
      ),
      ["角色A", "来源A"],
    );
  });
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
    allowLegacyIdentity: false,
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
    allowLegacyIdentity: false,
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

  await withGlobalCrypto(
    {
      randomUUID: (() => {
        const ids = ["char_versioned_a", "char_versioned_source_a"];
        return () => ids.shift();
      })(),
    },
    async () => {
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
    },
  );
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

test("Runtime lifecycle performs interval analysis without any UI subscriber", async () => {
  const fixture = createFixture({ floor: 3 });
  await fixture.runtime.init();
  fixture.emit("message-received", { message_id: "message-stable" });
  await settle();
  assert.equal(fixture.calls(), 1);
  fixture.emit("generation-ended", { message_id: "message-stable" });
  await settle();
  assert.equal(fixture.calls(), 1);
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
  fixture.emit("message-received", { message_id: "message-swipe" });
  await settle();
  const firstId = (await fixture.runtime.getCurrentFloorEvents())[0].event_id;
  message.swipe_id = 1;
  fixture.emit("message-swiped", { message_id: "message-swipe" });
  await settle();
  const events = await fixture.runtime.getCurrentFloorEvents();
  assert.equal(events.length, 1);
  assert.notEqual(events[0].event_id, firstId);
  assert.equal(events[0].source.swipe_id, 1);
  fixture.runtime.destroy();
});

test("character clear boundary suppresses historical character facts without deleting Floor facts", async () => {
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
  const inputs = [];
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
    character_profiles: { old: { display_name: "旧人物" } },
    tracking_subjects: { old: { character_id: "old" } },
  };

  await fixture.runtime.init();
  const result = await fixture.runtime.clearCharacterData();
  assert.equal(result.ok, true);
  assert.equal(result.persistence.commitState, "confirmed");
  assert.equal(
    fixture.context.chatMetadata.bioweave.data_lifecycle.character_reset.message_index,
    1,
  );
  assert.deepEqual(fixture.context.chatMetadata.bioweave.tracking_subjects, {});
  assert.deepEqual(fixture.context.chatMetadata.bioweave.character_profiles, {});
  assert.equal(fixture.context.chat[0].extra.bioweave.events.length, 1);
  assert.equal(fixture.context.chat[1].extra.bioweave.events.length, 1);
  assert.deepEqual(await fixture.runtime.getTrackingRegistry(), {
    tracking_subjects: {},
    tracking_candidates: {},
    character_profiles: {},
    character_registry: { schema_version: 1, entities: {} },
  });

  fixture.context.chat.push({
    message_id: "new-message",
    content: "清除后的新剧情",
    role: "assistant",
  });
  await fixture.runtime.analyzeFloor(
    { __messageIndex: true, index: 2 },
    { force: true },
  );
  assert.deepEqual(inputs.at(-1).existing_bioweave, {
    analysis: null,
    events: [],
  });
  fixture.runtime.destroy();
});

test("character reset made in an empty Chat accepts the first post-reset Floor", async () => {
  const fixture = createFixture({ messages: [] });
  fixture.context.chatMetadata.bioweave = {
    ...emptyChat("chat-runtime"),
    character_profiles: { old: { display_name: "旧人物" } },
  };

  await fixture.runtime.init();
  const result = await fixture.runtime.clearCharacterData();
  assert.equal(result.ok, true);
  assert.equal(
    fixture.context.chatMetadata.bioweave.data_lifecycle.character_reset.message_index,
    -1,
  );

  const message = {
    message_id: "post-reset-message",
    floor: 1,
    content: "清除后第一层",
    role: "assistant",
  };
  fixture.context.chat.push(message);
  const version = await floorVersion({
    chatId: "chat-runtime",
    messageId: message.message_id,
    floor: message.floor,
    swipeId: 0,
    text: message.content,
  });
  await fixture.runtime.store.saveFloor(0, 0, {
    ...emptyFloor(),
    floor_version: version,
    analysis: { status: "success", floor_version: version },
    events: [eventResult("post-reset-event", { source: version })],
    character_registry: {
      schema_version: 1,
      entities: {
        "char-a": { character_id: "char-a", display_name: "Alice", aliases: [] },
        "char-b": { character_id: "char-b", display_name: "Bob", aliases: [] },
      },
    },
  });

  const businessData = await fixture.runtime.collectActiveBusinessData();
  assert.equal(businessData.active_events?.[0]?.event_id, "post-reset-event");
  fixture.runtime.destroy();
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
    allowLegacyIdentity: false,
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
  await withGlobalCrypto(
    {
      randomUUID: (() => {
        const ids = [
          "char_swipe_a",
          "char_swipe_source_a",
          "char_swipe_b",
          "char_swipe_source_b",
        ];
        return () => ids.shift();
      })(),
    },
    async () => {
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
      fixture.emit("message-swiped", { message_id: message.message_id });
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
    },
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
    (await fixture.runtime.getTrackingRegistry()).tracking_subjects["char-a"]
      .status,
    "active",
  );

  delete message.swipes[0];
  delete message.swipe_info[0];
  fixture.emit("message-swipe-deleted", { message_id: message.message_id });
  await settle();

  assert.deepEqual(fixture.context.chatMetadata.bioweave.tracking_subjects, {});
  assert.deepEqual(
    fixture.context.chatMetadata.bioweave.tracking_candidates,
    {},
  );
  assert.deepEqual(
    fixture.context.chatMetadata.bioweave.character_profiles,
    {},
  );
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
  assert.deepEqual(fixture.context.chatMetadata.bioweave.tracking_subjects, {});
  assert.deepEqual(fixture.context.chatMetadata.bioweave.character_registry, {
    schema_version: 1,
    entities: {},
  });
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

test("stable lifecycle message IDs are not confused with array indexes", async () => {
  const fixture = createFixture({
    messages: [
      { message_id: "0", floor: 3, content: "楼层三", role: "assistant" },
      { message_id: "1", floor: 1, content: "楼层一", role: "assistant" },
    ],
  });
  await fixture.runtime.init();
  fixture.emit("message-received", { message_id: "0" });
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
        {
          character_id: subjectId,
          display_name: `${subjectId} display`,
          event_role: "potential_gestational_subject",
          reproductive_capabilities_used: { can_carry_pregnancy: true },
          evidence: [{ kind: "narrative", text: "subject evidence" }],
        },
        {
          character_id: sourceId,
          display_name: `${sourceId} display`,
          event_role: "potential_conception_source",
          reproductive_capabilities_used: { can_cause_pregnancy: true },
          evidence: [{ kind: "narrative", text: "source evidence" }],
        },
      ],
      pregnancy_relevance: {
        relevant: true,
        possible_conception: true,
        gestational_subject_ids: [subjectId],
        counterpart_ids: [sourceId],
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
  const secondEvent = beforeEvents.find(
    (event) =>
      event.pregnancy_relevance.gestational_subject_ids[0] === "subject-b",
  );
  await assert.rejects(
    fixture.runtime.updateEvent(secondEvent.event_id, {
      participants: [
        { ...secondEvent.participants[0], character_id: "subject-a" },
        { ...secondEvent.participants[1] },
      ],
      pregnancy_relevance: {
        ...secondEvent.pregnancy_relevance,
        gestational_subject_ids: ["subject-a"],
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
    [["subject-a"], ["subject-b"]],
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
    (await fixture.runtime.getTrackingRegistry()).tracking_subjects["char-a"]
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
  assert.equal(fixture.saveFloorCalls(), 0);
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

test("automatic interval scheduling recomputes a stale last_processed_floor hint", async () => {
  const fixture = createFixture({
    messages: [
      {
        message_id: "message-3",
        floor: 3,
        content: "已有分析楼层",
        role: "assistant",
      },
      {
        message_id: "message-6",
        floor: 6,
        content: "需要分析楼层",
        role: "assistant",
      },
    ],
  });
  await fixture.runtime.init();
  await settle();
  const ownerVersion = await floorVersion({
    chatId: "chat-runtime",
    messageId: "message-3",
    floor: 3,
    swipeId: 0,
    text: "已有分析楼层",
  });
  await fixture.runtime.store.saveFloor(0, 0, {
    analysis: { status: "success", floor_version: ownerVersion },
    events: [],
  });
  const chat = fixture.runtime.store.getChat("chat-runtime");
  await fixture.runtime.store.saveChat("chat-runtime", {
    ...chat,
    index: { ...(chat.index ?? {}), last_processed_floor: 999 },
  });

  fixture.emit("message-received", { message_id: "message-6" });
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

test("Domain collection duplicate subject keeps its stable diagnostic code and path", async () => {
  const fixture = createFixture({
    analyzer: {
      async analyzeFloor() {
        return {
          events: [eventResult("duplicate-a"), eventResult("duplicate-b")],
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
    "$.events[0].source_evidence.conception_relevant_exposure",
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
    /ST_FLOOR_STORAGE_UNAVAILABLE/,
  );
  const status = await fixture.runtime.getCurrentFloorAnalysisStatus();
  assert.equal(status.busy, false);
  assert.equal(status.state, "failed");
  assert.equal(status.error_stage, "floor_save");
  assert.equal(status.error_code, "ST_FLOOR_STORAGE_UNAVAILABLE");
  fixture.runtime.destroy();
});

test("Registry rebuild failure leaves the authoritative Floor result available", async () => {
  const fixture = createFixture({ saveChatMetadataErrorAt: 2 });
  await fixture.runtime.init();
  await settle();
  await assert.rejects(
    fixture.runtime.refreshCurrentFloorAnalysis(),
    /ST_METADATA_STORAGE_UNAVAILABLE/,
  );
  const status = await fixture.runtime.getCurrentFloorAnalysisStatus();
  assert.equal(status.busy, false);
  assert.equal(status.state, "failed");
  assert.equal(status.error_stage, "registry_rebuild");
  assert.equal(status.error_code, "ST_METADATA_STORAGE_UNAVAILABLE");
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
      entities: { char_a: { character_id: "char_a" } },
    },
  });
  const model = { schema_version: 1, species: [{ name: "Floor World" }] };
  const meta = { last_saved_by: "manual" };
  await fixture.runtime.saveWorldModel({ model, meta });
  const floor = fixture.runtime.store.getFloor(0, 0);
  assert.deepEqual(floor.world_model, model);
  assert.deepEqual(floor.world_model_meta, meta);
  assert.deepEqual(floor.analysis, { status: "success", marker: "analysis" });
  assert.deepEqual(floor.events, [{ event_id: "event-1" }]);
  assert.deepEqual(floor.character_registry.entities.char_a, {
    character_id: "char_a",
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

test("Event Analysis consumes only the strictly previous Floor World Model and never Chat legacy state", async () => {
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
  assert.equal(inputs.at(-1).world_model.species[0].name, "W20");
  await fixture.runtime.analyzeFloor({ __messageIndex: true, index: 0 }, { force: true });
  assert.equal(inputs.at(-1).world_model, null);
  fixture.runtime.destroy();
});
