import test from "node:test";
import assert from "node:assert/strict";
import { createRuntime, createSillyTavernAdapter } from "../runtime/events.js";
import { createAnalyzer, normalizeWorldModel } from "../ai/analyzer.js";
import { PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND } from "../core/events.js";
import { buildProjectionRuleId } from "../core/projection-eligibility.js";
import { floorVersion } from "../runtime/floor.js";
import { SILLYTAVERN_CURRENT_API, emptyChat, emptyFloor } from "../storage/schema.js";
import { buildWorldModelSupplementCoverageTargets } from "../ai/world-supplement-protocol.js";
import { archiveWorldModelSpecies } from "../core/world-species-archive.js";
import { healthObservationFingerprint } from "../core/health-assessment.js";
import { normalizeParticipantAggregation } from "../core/participant-aggregation.js";
import { buildParticipantAggregationId } from "../core/participant-aggregation.js";
import { resolveProjectionTimingInstance } from "../core/projection-timing.js";
import { createProjection } from "../core/projection.js";

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

const RELIABLE_FIXTURE_EVENT_STORY_TIME = Object.freeze({
  display: "羲和1年3月4日 巳时中",
  normalized: null,
  day_index: null,
  calendar_id: null,
  precision: "unknown",
  confidence: 0.6,
});

const RELIABLE_FIXTURE_CURRENT_STORY_TIME = Object.freeze({
  display: "羲和1年3月5日 巳时中",
  normalized: null,
  day_index: null,
  calendar_id: null,
  precision: "unknown",
  confidence: 1,
});

function createFixture({
  floor = 3,
  messages = null,
  analyzer = null,
  projectionTimingConfigResolver = null,
  projectionTimingBaselineResolver = null,
  projectionTimingRandom = null,
  storyTimeDebug = false,
  storyTimeTrace = null,
  characterContextResolver = null,
  rawApiResponse = null,
  setExtensionPromptHook = null,
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
  onWorldCandidate = null,
  healthRecoveryStabilityDelayMs = 2000,
  generationLeaseMs = undefined,
  generationStreamLeaseMs = undefined,
  generationHardWatchdogMs = undefined,
  participantAggregationLockCapability = false,
  reliableStoryTime = false,
  messageLookupById = false,
} = {}) {
  const listeners = new Map();
  const baseMessages = messages ?? [
    {
      message_id: "message-stable",
      floor,
      content: "当前剧情",
      role: "assistant",
    },
  ];
  const fixtureMessages = reliableStoryTime
    ? baseMessages.map(message => message?.role !== "user" && message?.is_user !== true
      ? {...message, story_time: {...RELIABLE_FIXTURE_CURRENT_STORY_TIME}}
      : message)
    : baseMessages;
  const context = {
    chatId: "chat-runtime",
    chat: fixtureMessages,
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
      STREAM_TOKEN_RECEIVED: "stream-token-received",
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
    getMessage: (index) => messageLookupById && typeof index === "string"
      ? context.chat.find(message => message?.message_id === index) ?? null
      : context.chat[index] ?? null,
    setExtensionPrompt(payload) {
      if (typeof setExtensionPromptHook === "function")
        return setExtensionPromptHook(payload);
      return true;
    },
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
  const analysisCalls = [];
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
    async analyzeFloor(input) {
      const version = input?.analysisInput?.floor_version ?? input?.floor_version ?? null;
      analysisCalls.push(version ? {
        chat_id: version.chat_id ?? null,
        message_id: version.message_id ?? null,
        floor: version.floor ?? null,
        swipe_id: version.swipe_id ?? null,
        content_hash: version.content_hash ?? null,
        message_version: version.message_version ?? null,
      } : null);
      if (!reliableStoryTime) return configuredAnalyzer.analyzeFloor(input);
      const result = await configuredAnalyzer.analyzeFloor(input);
      const normalizeEventStoryTime = event => {
        const storyTime = event?.story_time;
        const hasStructuredDate = storyTime && (
          storyTime.normalized ||
          storyTime.day_index !== null && storyTime.day_index !== undefined
        );
        if (hasStructuredDate) return event;
        return {
          ...event,
          story_time: {...RELIABLE_FIXTURE_EVENT_STORY_TIME},
        };
      };
      if (Array.isArray(result)) return result.map(normalizeEventStoryTime);
      if (!result || typeof result !== "object" || !Array.isArray(result.events)) return result;
      return {...result, events: result.events.map(normalizeEventStoryTime)};
    },
    // Existing Runtime fixtures focus on Character/Event behavior. Their
    // default World result is an explicit empty, validated model so those
    // tests can remain independent from an external World API response.
    analyzeWorldModel:
      analyzer?.analyzeWorldModel ??
      (rawApiResponse !== null
        ? async () => normalizeWorldModel({ schema_version: 1, species: [{ name: "人类", biological_types: [] }] })
        : configuredAnalyzer.analyzeWorldModel ??
          (async () => normalizeWorldModel({ schema_version: 1, species: [{ name: "人类", biological_types: [] }] }))),
    analyzeWorldModelPatchV2:
      analyzer?.analyzeWorldModelPatchV2 ??
      (async () => ({ patch: { schema_version: 2, operations: [] }, classified: [] })),
  };
  let runtime;
  const fixtureNotify = event => {
    notify?.(event);
    if (event?.type === "WORLD_CANONICAL_CANDIDATE_CREATED") {
      onWorldCandidate?.(event);
    }
  };
  runtime = createRuntime({
    adapter,
    ...(typeof characterContextResolver === "function"
      ? { characterContextResolver }
      : {}),
    analyzer: runtimeAnalyzer,
    ...(typeof projectionTimingConfigResolver === "function" ? {projectionTimingConfigResolver} : {}),
    ...(typeof projectionTimingBaselineResolver === "function" ? {projectionTimingBaselineResolver} : {}),
    ...(typeof projectionTimingRandom === "function" ? {projectionTimingRandom} : {}),
    notify: fixtureNotify,
    storyTimeDebug,
    storyTimeTrace,
    healthRecoveryStabilityDelayMs,
    ...(generationLeaseMs == null ? {} : {generationLeaseMs}),
    ...(generationStreamLeaseMs == null ? {} : {generationStreamLeaseMs}),
    ...(generationHardWatchdogMs == null ? {} : {generationHardWatchdogMs}),
    participantAggregationLockCapability,
  });
  runtime.subscribe(fixtureNotify);
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
    analysisCalls: () => structuredClone(analysisCalls),
    saveChatMetadataCalls: () => saveChatMetadataCalls,
    saveFloorCalls: () => saveFloorCalls,
    convergeFloorOwnerCalls: () => convergeFloorOwnerCalls,
    emit(type, payload) {
      return listeners.get(type)?.(payload);
    },
  };
}

test("GENERATION_STARTED refreshes health guidance read-only before prompt read", async () => {
  const order = [];
  const fixture = createFixture({
    setExtensionPromptHook: payload => {
      if (payload?.key === "bioweave_projection_context") order.push("projection-refresh");
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const callsBeforeGeneration = fixture.calls();
  const writesBeforeGeneration = fixture.saveFloorCalls();
  order.length = 0;

  const listener = fixture.listeners.get("generation-started");
  const lifecycle = listener({generation_type: "normal"});
  assert.equal(typeof lifecycle?.then, "function");
  await lifecycle;
  order.push("prompt-read");

  assert.deepEqual(order, ["projection-refresh", "prompt-read"]);
  assert.equal(fixture.calls(), callsBeforeGeneration);
  const sequence = fixture.runtime.getPersistenceTrace().sequence;
  assert.equal(sequence.some(item => item.stage === 'GENERATION_PROJECTION_REFRESH_STARTED'), true);
  assert.equal(sequence.some(item => item.stage === 'GENERATION_PROJECTION_REFRESH_SETTLED' && item.context_ready_before_prompt_read === true), true);
  assert.equal(sequence.some(item => item.stage === 'PROJECTION_PROCESS_STARTED'), false);
  assert.equal(fixture.saveFloorCalls(), writesBeforeGeneration);
  fixture.runtime.destroy();
});

test("real Runtime does not create a Projection submission receipt when setExtensionPrompt fails", async () => {
  const fixture = createFixture({setExtensionPromptHook: payload => payload?.key === "bioweave_projection_context" ? false : true});
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const floor = await fixture.runtime.resolveCurrentBioWeaveFloor({__messageIndex: true, index: 0});
  const event = (await fixture.runtime.getCurrentFloorEvents()).find(item => item.type === "sexual_activity");
  const subjectId = event.pregnancy_relevance.gestational_subject_ids[0];
  const aggregation = normalizeParticipantAggregation({
    aggregation_id: "agg-projection-receipt-failed",
    subject_id: subjectId,
    pregnancy_id: null,
    mechanism_key: "fertilization",
    cycle_id: "c1",
    timing_instance_id: "timing-projection-receipt-failed",
    reference_story_time: {day_index: 1},
    aggregation_story_time: {day_index: 14},
    elapsed_story_days: 13,
    effective_min_story_days: 14,
    effective_max_story_days: 42,
    sampled_individual_offset_story_days: 0,
    config_snapshot: {schema_version: 1, config_version: 1, base_min_story_days: 14, base_max_story_days: 42, variance_ratio: 0, variance_cap_story_days: 0, total_adjustment_cap_story_days: 0},
    accepted_exposure_event_ids: [event.event_id],
    source_basis_refs: {},
    created_at_floor_version: floor.version,
  });
  await fixture.runtime.upsertParticipantAggregation({chatId: "chat-runtime", ownerFloor: {message_index: floor.index}, floorVersion: floor.version, aggregation});
  const projection = createProjection({
    subject_id: subjectId,
    projection_rule_id: "rule:projection-receipt-failed",
    development_concern_key: "concern:pregnancy",
    mechanism: {key: "mechanism:implant", world_model_rule_refs: []},
    source_event_ids: [event.event_id],
    development: {kind: "possible_detection", current_basis: {event_ids: [event.event_id], state_refs: [], mechanism_rule_refs: []}, next_signal: "后续正文反馈"},
    timing: {trigger_kind: "immediate_after_event", reference_event_id: event.event_id, reference_story_time: null, current_story_time: null, elapsed_story_days: null},
    created_at_floor_version: floor.version,
    evidence_refs: [`event:${event.event_id}`],
    aggregation_path: "participant_aggregation",
    aggregation_evidence: {subject_id: subjectId, aggregation_id: aggregation.aggregation_id, pregnancy_id: null, cycle_id: aggregation.cycle_id, accepted_exposure_event_ids: aggregation.accepted_exposure_event_ids, participant_exposure_mapping: [{participant_id: event.pregnancy_relevance.counterpart_ids[0], exposure_event_ids: [event.event_id], exposure_count: 1}]},
  });
  const current = fixture.runtime.store.getFloor(floor.index, floor.swipeId);
  await fixture.runtime.store.saveFloor(floor.index, floor.swipeId, {...current, projection_timeline: {schema_version: 1, creations: [projection], evidence_records: [], lifecycle_records: [], delivery_records: []}});
  const result = await fixture.runtime.refreshProjectionContext();
  assert.equal(result.ok, false);
  assert.equal(fixture.runtime.store.getFloor(floor.index, floor.swipeId).projection_timeline.delivery_records.length, 0);
  fixture.runtime.destroy();
});

test("GENERATION_STARTED records a failed read-only Projection Context refresh", async () => {
  const fixture = createFixture({
    setExtensionPromptHook: () => {
      throw new Error("PROMPT_WRITE_FAILED");
    },
  });
  await fixture.runtime.init();
  const listener = fixture.listeners.get("generation-started");

  await assert.doesNotReject(() => listener({generation_type: "normal"}));
  assert.equal(fixture.calls(), 0);
  assert.equal(fixture.runtime.getPersistenceTrace().sequence.some(item => item.stage === 'GENERATION_PROJECTION_REFRESH_SETTLED'), true);
  fixture.runtime.destroy();
});

test("duplicate normal GENERATION_STARTED keeps the active gate and deferred Chat event", async () => {
  const fixture = createFixture({
    analyzer: {async analyzeFloor() { throw new Error("DUPLICATE_START_MUST_NOT_ANALYZE"); }},
  });
  await fixture.runtime.init();
  const listener = fixture.listeners.get("generation-started");
  const generation = {generation_type: "normal"};

  await listener(generation);
  fixture.emit("chat-changed", {chat_id: "chat-runtime"});
  await listener(generation);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(fixture.calls(), 0);
  assert.equal(fixture.analysisCalls().length, 0);
  assert.equal(fixture.saveFloorCalls(), 0);
  let sequence = fixture.runtime.getPersistenceTrace().sequence;
  const startForwardResults = sequence.filter(item =>
    item.stage === "HOST_EVENT_FORWARD_RESULT" &&
    item.host_event_key === "GENERATION_STARTED",
  );
  assert.equal(startForwardResults.length, 2);
  assert.equal(startForwardResults[0].forward_result?.reason, "generation-pending");
  assert.equal(startForwardResults[1].forward_result?.reason, "generation-intent-already-pending");
  assert.equal(
    sequence.filter(item => item.stage === "GENERATION_PROJECTION_REFRESH_STARTED").length,
    1,
  );
  assert.equal(sequence.some(item => item.stage === "GENERATION_DEFERRED_EVENT_REPLAY"), false);

  fixture.emit("generation-stopped", {generation_type: "normal"});
  await settle();

  sequence = fixture.runtime.getPersistenceTrace().sequence;
  const chatReplay = sequence.filter(item =>
    item.stage === "GENERATION_DEFERRED_EVENT_REPLAY" &&
    item.host_event_key === "CHAT_CHANGED",
  );
  assert.equal(chatReplay.length, 1);
  assert.equal(chatReplay[0].execution_status, "SUCCEEDED");
  fixture.runtime.destroy();
});

test("quiet repeated GENERATION_STARTED self-heals after the activity lease and reuses the gate", async () => {
  const promptWrites = [];
  const fixture = createFixture({
    generationLeaseMs: 25,
    generationStreamLeaseMs: 12,
    setExtensionPromptHook: payload => {
      if (payload?.key === "bioweave_projection_context") promptWrites.push(payload.content);
    },
    analyzer: {async analyzeFloor() { throw new Error("QUIET_START_MUST_NOT_ANALYZE"); }},
  });
  await fixture.runtime.init();
  const generation = {generation_type: "normal"};

  await fixture.emit("generation-started", generation);
  fixture.emit("chat-changed", {chat_id: "chat-runtime"});
  await fixture.emit("generation-started", generation);
  await new Promise(resolve => setTimeout(resolve, 45));
  await settle();

  let sequence = fixture.runtime.getPersistenceTrace().sequence;
  const expired = sequence.filter(item => item.stage === "GENERATION_GATE_LEASE_EXPIRED");
  const firstReplay = sequence.filter(item =>
    item.stage === "GENERATION_DEFERRED_EVENT_REPLAY" &&
    item.host_event_key === "CHAT_CHANGED",
  );
  assert.equal(expired.length, 1);
  assert.equal(firstReplay.length, 1);
  assert.equal(firstReplay[0].execution_status, "SUCCEEDED");
  assert.equal(fixture.calls(), 0);
  assert.equal(fixture.analysisCalls().length, 0);
  assert.equal(fixture.saveFloorCalls(), 0);
  assert.ok(promptWrites.length >= 2);
  assert.equal(promptWrites.at(-1), "");
  assert.equal(sequence.some(item => item.stage === "PROJECTION_PROCESS_STARTED"), false);
  assert.equal(sequence.some(item => item.stage === "LEGACY_PROJECTION_LIFECYCLE"), false);
  assert.equal(sequence.some(item => item.stage === "NSFW_LIFECYCLE_RECOVERY" && item.entered_recovery === true), false);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().pendingGeneration, null);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().pendingSwipeGeneration, null);

  await fixture.emit("generation-started", generation);
  const secondStartResult = fixture.runtime.getPersistenceTrace().sequence.filter(item =>
    item.stage === "HOST_EVENT_FORWARD_RESULT" && item.host_event_key === "GENERATION_STARTED",
  ).at(-1);
  assert.equal(secondStartResult?.forward_result?.reason, "generation-pending");
  fixture.emit("chat-changed", {chat_id: "chat-runtime"});
  fixture.emit("generation-stopped", generation);
  await settle();

  sequence = fixture.runtime.getPersistenceTrace().sequence;
  const allReplays = sequence.filter(item =>
    item.stage === "GENERATION_DEFERRED_EVENT_REPLAY" &&
    item.host_event_key === "CHAT_CHANGED",
  );
  assert.equal(allReplays.length, 2);
  assert.equal(sequence.filter(item => item.stage === "GENERATION_GATE_LEASE_EXPIRED").length, 1);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().pendingGeneration, null);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().pendingSwipeGeneration, null);
  assert.equal(fixture.calls(), 0);
  assert.equal(fixture.analysisCalls().length, 0);
  assert.equal(fixture.saveFloorCalls(), 0);
  fixture.runtime.destroy();
});

test("STREAM_TOKEN_RECEIVED renews the active generation lease when the host exposes it", async () => {
  const fixture = createFixture({generationLeaseMs: 25, generationStreamLeaseMs: 20});
  await fixture.runtime.init();
  await fixture.emit("generation-started", {generation_type: "normal"});
  await new Promise(resolve => setTimeout(resolve, 15));
  fixture.emit("stream-token-received", {text_length: 1});
  await new Promise(resolve => setTimeout(resolve, 10));

  const sequence = fixture.runtime.getPersistenceTrace().sequence;
  assert.equal(sequence.some(item => item.stage === "GENERATION_GATE_LEASE_EXPIRED"), false);
  assert.ok(sequence.some(item =>
    item.stage === "GENERATION_GATE_LEASE_RENEWED" &&
    item.reason === "stream-token-received",
  ));
  fixture.emit("generation-stopped", {generation_type: "normal"});
  await settle();
  fixture.runtime.destroy();
});

test("terminal signals after lease expiry cannot re-enter automatic business work", async () => {
  const fixture = createFixture({generationLeaseMs: 20});
  await fixture.runtime.init();
  await fixture.emit("generation-started", {generation_type: "normal"});
  await new Promise(resolve => setTimeout(resolve, 35));
  await settle();

  fixture.emit("generation-stopped", {generation_type: "normal"});
  fixture.emit("generation-ended", {generation_type: "normal"});
  await settle();

  const sequence = fixture.runtime.getPersistenceTrace().sequence;
  assert.equal(sequence.filter(item => item.stage === "GENERATION_LEASE_EXPIRED_EVENT_IGNORED").length, 2);
  assert.equal(sequence.some(item => item.stage === "PROJECTION_PROCESS_STARTED"), false);
  assert.equal(sequence.some(item => item.stage === "LEGACY_PROJECTION_LIFECYCLE"), false);
  assert.equal(sequence.some(item => item.stage === "NSFW_LIFECYCLE_RECOVERY" && item.entered_recovery === true), false);
  assert.equal(fixture.calls(), 0);
  assert.equal(fixture.saveFloorCalls(), 0);
  fixture.runtime.destroy();
});

test("post-lease final Character Floor waits for GENERATION_ENDED before one handoff", async () => {
  let analysisCalls = 0;
  const fixture = createFixture({
    generationLeaseMs: 20,
    messages: [{message_id: "quiet-final-floor", floor: 1, content: "旧正文", role: "assistant"}],
    analyzer: {
      async analyzeFloor() {
        analysisCalls += 1;
        return {events: []};
      },
    },
  });
  configureScheduler(fixture, {interval: 1});
  await fixture.runtime.init();
  analysisCalls = 0;
  const traceBeforeGeneration = fixture.runtime.getPersistenceTrace().sequence.length;

  await fixture.emit("generation-started", {generation_type: "normal", message_id: "quiet-final-floor"});
  await new Promise(resolve => setTimeout(resolve, 35));
  await settle();
  assert.equal(analysisCalls, 0);
  assert.equal(fixture.saveFloorCalls(), 0);

  fixture.context.chat[0].content = "最终正文";
  await fixture.emit("character-message-rendered", {message_id: "quiet-final-floor"});
  await settle();
  await settle();

  assert.equal(analysisCalls, 0);
  assert.equal(
    fixture.runtime.getPersistenceTrace().sequence.some(item => item.stage === "AUTO_HANDOFF_TO_SCHEDULER"),
    false,
  );

  await fixture.emit("generation-ended", {message_id: "quiet-final-floor"});
  await settle();
  await settle();

  assert.equal(analysisCalls, 1);
  const sequence = fixture.runtime.getPersistenceTrace().sequence.slice(traceBeforeGeneration);
  assert.equal(sequence.filter(item => item.stage === "AUTO_HANDOFF_TO_SCHEDULER").length, 1);
  assert.equal(sequence.filter(item => item.stage === "GENERATION_LEASE_EXPIRED_EVENT_IGNORED").length, 0);
  fixture.runtime.destroy();
});

test("post-lease stable final Character Floor recovers when host omits terminal events", async () => {
  let analysisCalls = 0;
  const fixture = createFixture({
    generationLeaseMs: 20,
    messages: [{floor: 1, content: "旧正文", role: "assistant"}],
    analyzer: {
      async analyzeFloor() {
        analysisCalls += 1;
        return {events: []};
      },
    },
  });
  configureScheduler(fixture, {interval: 1});
  await fixture.runtime.init();
  analysisCalls = 0;

  await fixture.emit("generation-started", {generation_type: "normal"});
  fixture.context.chat[0].content = "最终正文";
  await new Promise(resolve => setTimeout(resolve, 35));
  await settle();
  await settle();

  assert.equal(analysisCalls, 1);
  const sequence = fixture.runtime.getPersistenceTrace().sequence;
  assert.equal(
    sequence.some(item => item.stage === "GENERATION_FINAL_FLOOR_RECOVERED"),
    true,
  );
  assert.equal(sequence.filter(item => item.stage === "AUTO_HANDOFF_TO_SCHEDULER").length, 1);
  fixture.runtime.destroy();
});

test("post-lease MESSAGE_RECEIVED restores the gate and waits for the final Floor", async () => {
  let analysisCalls = 0;
  const fixture = createFixture({
    generationLeaseMs: 20,
    messages: [{message_id: "pre-lease-floor", floor: 1, content: "旧正文", role: "assistant"}],
    analyzer: {
      async analyzeFloor() {
        analysisCalls += 1;
        return {events: []};
      },
    },
  });
  configureScheduler(fixture, {interval: 1});
  await fixture.runtime.init();

  await fixture.emit("generation-started", {generation_type: "normal"});
  await new Promise(resolve => setTimeout(resolve, 35));
  await settle();

  fixture.context.chat.push({
    message_id: "late-final-floor",
    floor: 2,
    content: "新正文",
    role: "assistant",
  });
  await fixture.emit("message-received", {message_id: "late-final-floor"});
  await settle();
  assert.equal(analysisCalls, 0);

  await fixture.emit("character-message-rendered", {message_id: "late-final-floor"});
  await fixture.emit("generation-ended", {message_id: "late-final-floor"});
  await settle();
  await settle();

  assert.equal(analysisCalls, 1);
  const sequence = fixture.runtime.getPersistenceTrace().sequence;
  assert.equal(
    sequence.some(item => item.stage === "GENERATION_INTENT_RESTORED"),
    true,
  );
  assert.equal(
    sequence.some(item =>
      item.stage === "GENERATION_GATE_ACTIVITY_CONFIRMED" &&
      item.reason === "late-message-received",
    ),
    true,
  );
  assert.equal(sequence.filter(item => item.stage === "AUTO_HANDOFF_TO_SCHEDULER").length, 1);
  fixture.runtime.destroy();
});

test("post-lease render of the unchanged Floor stays quarantined", async () => {
  let analysisCalls = 0;
  const fixture = createFixture({
    generationLeaseMs: 20,
    messages: [{message_id: "unchanged-after-lease", floor: 1, content: "旧正文", role: "assistant"}],
    analyzer: {
      async analyzeFloor() {
        analysisCalls += 1;
        return {events: []};
      },
    },
  });
  configureScheduler(fixture, {interval: 1});
  await fixture.runtime.init();

  await fixture.emit("generation-started", {
    generation_type: "normal",
    message_id: "unchanged-after-lease",
  });
  await new Promise(resolve => setTimeout(resolve, 35));
  await fixture.emit("character-message-rendered", {message_id: "unchanged-after-lease"});
  await fixture.emit("generation-ended", {message_id: "unchanged-after-lease"});
  await settle();
  await settle();

  assert.equal(analysisCalls, 0);
  assert.equal(
    fixture.runtime.getPersistenceTrace().sequence.some(item =>
      item.stage === "GENERATION_LEASE_EXPIRED_EVENT_IGNORED" &&
      item.reason === "activity-lease-quarantine",
    ),
    true,
  );
  fixture.runtime.destroy();
});

test("real non-streaming generation keeps its lease after final-floor activity until ENDED", async () => {
  let analysisCalls = 0;
  const fixture = createFixture({
    generationLeaseMs: 20,
    messages: [{message_id: "long-generation-floor", floor: 1, content: "旧正文", role: "assistant"}],
    analyzer: {
      async analyzeFloor() {
        analysisCalls += 1;
        return {events: []};
      },
    },
  });
  configureScheduler(fixture, {interval: 1});
  await fixture.runtime.init();
  analysisCalls = 0;

  await fixture.emit("generation-started", {generation_type: "normal", message_id: "long-generation-floor"});
  await new Promise(resolve => setTimeout(resolve, 8));
  fixture.context.chat[0].content = "最终正文";
  await fixture.emit("character-message-rendered", {message_id: "long-generation-floor"});
  await new Promise(resolve => setTimeout(resolve, 35));
  await fixture.emit("generation-ended", {generation_type: "normal", message_id: "long-generation-floor"});
  await settle();
  await settle();

  const sequence = fixture.runtime.getPersistenceTrace().sequence;
  assert.equal(sequence.some(item => item.stage === "GENERATION_GATE_LEASE_EXPIRED"), false);
  assert.equal(analysisCalls, 1);
  assert.equal(fixture.saveFloorCalls() > 0, true);
  assert.equal(sequence.filter(item => item.stage === "AUTO_HANDOFF_TO_SCHEDULER").length, 1);
  fixture.runtime.destroy();
});

test("hard generation watchdog abandons an evidenced run without terminal event", async () => {
  let analysisCalls = 0;
  const fixture = createFixture({
    generationLeaseMs: 10,
    generationStreamLeaseMs: 10,
    generationHardWatchdogMs: 30,
    analyzer: {
      async analyzeFloor() {
        analysisCalls += 1;
        return {events: []};
      },
    },
  });
  await fixture.runtime.init();

  await fixture.emit("generation-started", {generation_type: "normal"});
  fixture.emit("stream-token-received", {text_length: 1});
  await new Promise(resolve => setTimeout(resolve, 45));
  await settle();

  fixture.emit("character-message-rendered", {message_id: "missing-terminal"});
  fixture.emit("generation-ended", {generation_type: "normal"});
  await settle();

  const sequence = fixture.runtime.getPersistenceTrace().sequence;
  assert.equal(sequence.filter(item => item.stage === "GENERATION_GATE_HARD_WATCHDOG_EXPIRED").length, 1);
  assert.equal(sequence.filter(item => item.stage === "GENERATION_LEASE_EXPIRED_EVENT_IGNORED").length, 2);
  assert.equal(analysisCalls, 0);
  assert.equal(fixture.saveFloorCalls(), 0);

  await fixture.emit("generation-started", {generation_type: "normal"});
  const restarted = fixture.runtime.getPersistenceTrace().sequence.filter(item =>
    item.stage === "HOST_EVENT_FORWARD_RESULT" && item.host_event_key === "GENERATION_STARTED",
  ).at(-1);
  assert.equal(restarted?.forward_result?.reason, "generation-pending");
  fixture.emit("generation-stopped", {generation_type: "normal"});
  await settle();
  fixture.runtime.destroy();
});

test("generation-time automatic triggers are deferred and the final Character Floor analyzes once", async () => {
  let eventCalls = 0;
  const fixture = createFixture({
    messages: [{message_id: "generation-gated-floor", floor: 1, content: "旧正文", role: "assistant"}],
    analyzer: {
      async analyzeFloor() {
        eventCalls += 1;
        return {events: []};
      },
    },
  });
  configureScheduler(fixture, {interval: 1});
  await fixture.runtime.init();

  fixture.emit("generation-started", {genType: "regenerate", message_id: "generation-gated-floor"});
  fixture.emit("message-received", {message_id: "generation-gated-floor"});
  await settle();
  assert.equal(eventCalls, 0);
  assert.equal(fixture.saveFloorCalls(), 0);

  fixture.context.chat[0].content = "最终正文";
  fixture.emit("generation-ended", {message_id: "generation-gated-floor"});
  fixture.emit("character-message-rendered", {message_id: "generation-gated-floor"});
  await settle();
  await settle();
  assert.equal(eventCalls, 1);
  assert.equal(
    fixture.runtime.getPersistenceTrace().sequence.filter(entry => entry.stage === "AUTO_ANALYSIS_TRIGGERED").length,
    1,
  );
  fixture.runtime.destroy();
});

test("a Chat boundary during generation cannot refresh or write the old Floor", async () => {
  let eventCalls = 0;
  const promptWrites = [];
  const fixture = createFixture({
    messages: [{message_id: "old-chat-floor", floor: 1, content: "旧 Chat 正文", role: "assistant"}],
    setExtensionPromptHook: payload => {
      if (payload?.key === "bioweave_projection_context") promptWrites.push(payload.content);
    },
    analyzer: {
      async analyzeFloor() {
        eventCalls += 1;
        return {events: []};
      },
    },
  });
  await fixture.runtime.init();
  promptWrites.length = 0;
  fixture.emit("generation-started", {genType: "normal", message_id: "old-chat-floor"});
  fixture.context.chatId = "new-chat";
  fixture.emit("chat-changed", {chat_id: "new-chat"});
  await settle();

  assert.equal(eventCalls, 0);
  assert.equal(fixture.saveFloorCalls(), 0);
  assert.equal(promptWrites.length, 2);
  assert.equal(promptWrites.every(prompt => prompt === ""), true);
  fixture.runtime.destroy();
});

test("ordinary CHAT_CHANGED only rebinds the Chat and restores read-only context", async () => {
  const promptWrites = [];
  const fixture = createFixture({
    setExtensionPromptHook: payload => {
      if (payload?.key === "bioweave_projection_context") promptWrites.push(payload.content);
    },
    analyzer: {
      async analyzeFloor() {
        throw new Error("CHAT_CHANGED_MUST_NOT_ANALYZE");
      },
    },
  });
  configureScheduler(fixture, {interval: 1});
  await fixture.runtime.init();
  const floor = await fixture.runtime.resolveCurrentBioWeaveFloor({__messageIndex: true, index: 0});
  const projection = createProjection({
    subject_id: "char_000001",
    projection_rule_id: "rule:chat-rebind",
    development_concern_key: "concern:chat-rebind",
    mechanism: {key: "mechanism:chat-rebind", world_model_rule_refs: []},
    source_event_ids: ["event:chat-rebind"],
    development: {
      kind: "possible_biological_change",
      current_basis: {event_ids: ["event:chat-rebind"], state_refs: [], mechanism_rule_refs: []},
      next_signal: "只读恢复内容",
    },
    timing: {
      trigger_kind: "immediate_after_event",
      reference_event_id: "event:chat-rebind",
      reference_story_time: null,
      current_story_time: null,
      elapsed_story_days: null,
    },
    created_at_floor_version: floor.version,
    evidence_refs: ["event:chat-rebind"],
  });
  const currentFloor = fixture.runtime.store.getFloor(floor.index, floor.swipeId);
  await fixture.runtime.store.saveFloor(floor.index, floor.swipeId, {
    ...currentFloor,
    floor_version: floor.version,
    projection_timeline: {
      schema_version: 1,
      creations: [projection],
      evidence_records: [],
      lifecycle_records: [],
      delivery_records: [],
    },
  });
  assert.equal((await fixture.runtime.getProjectionViews({chatId: "chat-runtime"})).all.length, 1);
  promptWrites.length = 0;
  const saveFloorCallsBefore = fixture.saveFloorCalls();
  const traceBefore = fixture.runtime.getPersistenceTrace().sequence.length;

  await fixture.emit("chat-changed", {chat_id: "chat-runtime"});
  await settle();

  assert.equal(fixture.calls(), 0);
  assert.equal(fixture.analysisCalls().length, 0);
  assert.equal(fixture.saveFloorCalls(), saveFloorCallsBefore);
  const trace = fixture.runtime.getPersistenceTrace().sequence.slice(traceBefore);
  assert.equal(trace.some(entry => entry.stage === "PROJECTION_PROCESS_STARTED"), false);
  assert.equal(trace.some(entry => entry.stage === "LEGACY_PROJECTION_LIFECYCLE"), false);
  assert.equal(trace.some(entry => entry.stage === "NSFW_LIFECYCLE_RECOVERY" && entry.entered_recovery === true), false);
  assert.equal(trace.some(entry => entry.stage === "PROJECTION_CONTEXT_REFRESH_STARTED"), true);
  assert.equal(promptWrites[0], "");
  assert.match(promptWrites.at(-1), /只读恢复内容/u);
  fixture.runtime.destroy();
});

test("generation gate replays deferred message and Swipe signals after stop", async () => {
  const message = {
    message_id: "deferred-lifecycle-target",
    floor: 1,
    swipe_id: 0,
    swipes: ["原 Swipe"],
    swipe_info: [{}],
    role: "assistant",
  };
  const fixture = createFixture({messages: [message]});
  await fixture.runtime.init();

  fixture.emit("generation-started", {
    genType: "normal",
    message_id: message.message_id,
  });
  message.swipes.push("新 Swipe");
  message.swipe_info.push({});
  message.swipe_id = 1;
  fixture.emit("message-updated", {message_id: message.message_id});
  fixture.emit("message-edited", {message_id: message.message_id});
  fixture.emit("message-swiped", {
    message_id: message.message_id,
    swipe_id: 1,
    pendingGeneration: true,
  });
  fixture.emit("generation-stopped", {message_id: message.message_id});
  await settle();

  const replayed = fixture.runtime.getPersistenceTrace().sequence
    .filter(entry => entry.stage === "GENERATION_DEFERRED_EVENT_REPLAY");
  assert.deepEqual(
    replayed
      .filter(entry => entry.execution_status === "SUCCEEDED")
      .map(entry => entry.host_event_key),
    ["MESSAGE_UPDATED", "MESSAGE_EDITED", "MESSAGE_SWIPED"],
  );
  assert.equal(replayed.some(entry => entry.execution_status !== "SUCCEEDED"), false);
  fixture.runtime.destroy();
});

test("generation gate replays a deferred deletion after the generation stops", async () => {
  const removed = {
    message_id: "deferred-deleted-floor",
    floor: 1,
    content: "生成期间删除的楼层",
    role: "assistant",
  };
  const survivor = {
    message_id: "deferred-surviving-floor",
    floor: 2,
    content: "仍然存在的楼层",
    role: "assistant",
  };
  const fixture = createFixture({messages: [removed, survivor]});
  await fixture.runtime.init();

  fixture.emit("generation-started", {
    genType: "normal",
    message_id: survivor.message_id,
  });
  fixture.context.chat.splice(0, 1);
  fixture.emit("message-deleted", {message_id: removed.message_id});
  fixture.emit("generation-stopped", {message_id: survivor.message_id});
  await settle();

  const replay = fixture.runtime.getPersistenceTrace().sequence.find(entry =>
    entry.stage === "GENERATION_DEFERRED_EVENT_REPLAY" &&
    entry.host_event_key === "MESSAGE_DELETED",
  );
  assert.equal(replay?.execution_status, "SUCCEEDED");
  fixture.runtime.destroy();
});

test("non-GENERATION_STARTED lifecycle remains background orchestration", async () => {
  const fixture = createFixture();
  await fixture.runtime.init();
  const listener = fixture.listeners.get("generation-ended");

  assert.equal(listener({generation_type: "normal"}), undefined);
  await new Promise(resolve => setImmediate(resolve));
  fixture.runtime.destroy();
});

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

test("Registry identity and alias edits inherit the nearest complete snapshot", async () => {
  const fixture = createFixture({
    reliableStoryTime: true,
    messages: [
      { message_id: "registry-source-floor", floor: 20, content: "人物来源", role: "assistant" },
      { message_id: "registry-edit-floor", floor: 26, content: "人物编辑", role: "assistant" },
    ],
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({ __messageIndex: true, index: 0 }, { force: true });

  const historicalRegistry = structuredClone(
    fixture.runtime.store.getFloor(0, 0).character_registry,
  );
  const characterId = Object.keys(historicalRegistry.entities)[0];
  const writesBeforeRead = fixture.saveFloorCalls();
  const inherited = await fixture.runtime.getCurrentCharacterIdentity(characterId);
  assert.equal(inherited.display_name, "Alice");
  assert.deepEqual(inherited.aliases, []);
  assert.equal(fixture.saveFloorCalls(), writesBeforeRead);

  const unchanged = await fixture.runtime.updateCharacterAliases({
    character_id: characterId,
    aliases: [],
  });
  assert.equal(unchanged.changed, false);
  assert.equal(fixture.saveFloorCalls(), writesBeforeRead);

  const changed = await fixture.runtime.updateCharacterAliases({
    character_id: characterId,
    aliases: ["新别名"],
  });
  assert.equal(changed.changed, undefined);
  assert.deepEqual(
    fixture.runtime.store.getFloor(1, 0).character_registry.entities[characterId].aliases,
    ["新别名"],
  );
  assert.deepEqual(
    fixture.runtime.store.getFloor(0, 0).character_registry,
    historicalRegistry,
  );
  assert.deepEqual(
    Object.keys(fixture.runtime.store.getFloor(1, 0).character_registry.entities).sort(),
    Object.keys(historicalRegistry.entities).sort(),
  );
  fixture.runtime.destroy();
});

test("An explicit empty Registry snapshot stops inheritance", async () => {
  const fixture = createFixture({
    messages: [
      { message_id: "registry-empty-source", floor: 20, content: "人物清空", role: "assistant" },
      { message_id: "registry-empty-target", floor: 35, content: "读取空人物状态", role: "assistant" },
    ],
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({ __messageIndex: true, index: 0 }, { force: true });
  const source = fixture.runtime.store.getFloor(0, 0);
  await fixture.runtime.store.saveFloor(0, 0, {
    ...source,
    character_registry: { schema_version: 1, entities: {} },
  });

  const target = await fixture.runtime.resolveCurrentBioWeaveFloor();
  const resolved = await fixture.runtime.resolveCharacterRegistryAtOrBefore(target);
  assert.equal(resolved.index, 0);
  assert.deepEqual(resolved.character_registry, {
    schema_version: 1,
    entities: {},
  });
  await assert.rejects(
    fixture.runtime.getCurrentCharacterIdentity("char_000001"),
    error => error.message === "CHARACTER_ID_NOT_FOUND",
  );
  fixture.runtime.destroy();
});

test("manual-refresh saves inherited Registry data when the target Floor has none", async () => {
  const fixture = createFixture({
    messages: [
      { message_id: "manual-registry-source", floor: 20, content: "已有完整人物", role: "assistant" },
      { message_id: "manual-registry-target", floor: 35, content: "手动刷新人物", role: "assistant" },
    ],
    analyzer: {
      async analyzeFloor({analysisInput}) {
        return {events: [eventResultForRegistry(analysisInput.character_registry)]};
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({ __messageIndex: true, index: 0 }, { force: true });
  const sourceRegistry = structuredClone(
    fixture.runtime.store.getFloor(0, 0).character_registry,
  );

  await fixture.runtime.refreshCurrentFloorAnalysis();

  assert.deepEqual(
    fixture.runtime.store.getFloor(1, 0).character_registry,
    sourceRegistry,
  );
  assert.deepEqual(
    Object.keys(fixture.runtime.store.getFloor(1, 0).character_registry.entities).sort(),
    Object.keys(sourceRegistry.entities).sort(),
  );
  fixture.runtime.destroy();
});

test("analysis input keeps its causal state without the discarded derived read", async () => {
  const fixture = createFixture({
    messages: [
      {message_id: "analysis-input-source", floor: 20, content: "来源楼层", role: "assistant"},
      {message_id: "analysis-input-target", floor: 26, content: "当前楼层", role: "assistant"},
    ],
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 0}, {force: true});
  const input = await fixture.runtime.getCurrentFloorAnalysisInput();
  assert.equal(input.floor_version.message_id, "analysis-input-target");
  assert.equal(input.existing_bioweave.events.length, 1);
  assert.equal(input.character_registry.schema_version, 1);
  assert.ok(input.world_model);
  fixture.runtime.destroy();
});

test("business data returns one stable target version without persistence side effects", async () => {
  const fixture = createFixture({
    messages: [{message_id: "business-stable-target", floor: 35, content: "稳定楼层", role: "assistant"}],
  });
  await fixture.runtime.init();
  const saveFloorCalls = fixture.saveFloorCalls();
  const business = await fixture.runtime.collectActiveBusinessData();
  assert.deepEqual(Object.keys(business.current_floor.version).sort(), [
    "chat_id",
    "content_hash",
    "floor",
    "message_id",
    "message_version",
    "swipe_id",
  ]);
  assert.equal(business.current_floor.version.message_id, "business-stable-target");
  assert.equal(fixture.saveFloorCalls(), saveFloorCalls);
  fixture.runtime.destroy();
});

test("current Floor Version does not reuse stored message_version after content edit", async () => {
  const message = {
    message_id: "message-version-fallback-target",
    floor: 35,
    content: "编辑后的当前正文",
    role: "assistant",
    extra: {
      bioweave: {
        floor_version: {
          chat_id: "chat-runtime",
          message_id: "message-version-fallback-target",
          floor: 35,
          swipe_id: 0,
          content_hash: "old-content-hash",
          message_version: "v1:old-content-hash",
        },
      },
    },
  };
  const fixture = createFixture({messages: [message]});
  await fixture.runtime.init();
  const current = await fixture.runtime.resolveCurrentBioWeaveFloor();
  const expected = await floorVersion({
    chatId: "chat-runtime",
    messageId: message.message_id,
    floor: message.floor,
    swipeId: 0,
    text: message.content,
  });
  assert.deepEqual(current.version, expected);
  assert.notEqual(current.version.content_hash, "old-content-hash");
  assert.notEqual(current.version.message_version, "v1:old-content-hash");
  message.message_version = "host-revision-7";
  const explicitHostVersion = await fixture.runtime.resolveCurrentBioWeaveFloor();
  assert.equal(explicitHostVersion.version.message_version, "host-revision-7");
  fixture.runtime.destroy();
});

test("business debug samples the current production states and provenance", async () => {
  const message = {
    message_id: "business-debug-target",
    floor: 35,
    content: "调试目标楼层",
    role: "assistant",
  };
  const fixture = createFixture({messages: [message]});
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  await fixture.runtime.refreshProjection();

  const beforeWrites = fixture.saveFloorCalls();
  const business = await fixture.runtime.collectActiveBusinessData({includeDebug: true});
  const debug = business.debug;

  assert.equal(fixture.saveFloorCalls(), beforeWrites);
  assert.equal(debug.target.floor, 35);
  assert.equal(debug.story_time_snapshot.target_floor_version.floor, 35);
  assert.equal(debug.story_time_snapshot.target_specific_read, true);
  assert.equal(debug.story_time_snapshot.canonical_build.snapshot_reused, true);
  assert.equal(debug.story_time_snapshot.resolver_source, "cache");
  assert.equal(debug.story_time_snapshot.resolution_source, "cache");
  assert.deepEqual(debug.story_time_snapshot.trace_summary, {
    entry_count: 1,
    sources: ["cache"],
    resolution_sources: ["cache"],
    candidate_sources: ["unknown"],
  });
  assert.equal(debug.story_time_snapshot.story_time_field_roles.event_story_time, "EVENT_OCCURRENCE");
  assert.equal(debug.tracking_window.story_time_source, "canonical_story_time_snapshot");
  assert.equal(debug.health_state.story_time_source, "canonical_story_time_snapshot");
  assert.equal(debug.target.source_type, "CURRENT_DERIVED");
  assert.equal(debug.event_state.source_type, "CURRENT_RESOLVED");
  assert.equal(debug.event_state.source.floor, 35);
  assert.equal(debug.event_state.count, 1);
  assert.match(debug.event_state.events[0].event_id, /^evt_/);
  assert.equal(debug.event_state.events[0].source.source_type, "CURRENT_DERIVED");
  assert.equal(debug.character_registry.source.floor, 35);
  assert.equal(debug.character_registry.count, 2);
  assert.equal(debug.tracking_window.source_type, "CURRENT_DERIVED");
  assert.equal(debug.tracking_registry.source_type, "CURRENT_DERIVED");
  assert.equal(debug.health_state.source_type, "CURRENT_DERIVED");
  assert.equal(debug.lifecycle_runtime.status, "ready");
  assert.equal(debug.lifecycle_runtime.target.swipe_id, 0);
  assert.equal(debug.lifecycle_runtime.participant_aggregation.count, 0);
  assert.equal(debug.lifecycle_runtime.projection_delivery.count, 0);
  assert.equal(debug.lifecycle_runtime.pregnancy_lifecycle.facts.length, 0);
  assert.equal(debug.lifecycle_runtime.nsfw_lock.gate, "disabled_until_lifecycle_archive_release");
  assert.equal(debug.diagnostic_metadata.diagnostics_schema_version, 1);
  assert.equal(debug.nsfw_pipeline_diagnostics.current_state.source_type, "CURRENT_STATE");
  assert.equal(debug.nsfw_pipeline_diagnostics.execution_trace.source_type, "EXECUTION_TRACE");
  assert.equal(debug.nsfw_pipeline_diagnostics.derived_diagnostic.source_type, "DERIVED_DIAGNOSTIC");
  assert.equal(debug.nsfw_pipeline_diagnostics.current_state.projection_rules_count, 0);
  assert.equal(
    debug.nsfw_pipeline_diagnostics.current_state.tracking_subject_count,
    Object.keys(debug.tracking_registry.tracking_subjects).length,
  );
  assert.ok(debug.nsfw_pipeline_diagnostics.execution_trace.stages.every(stage =>
    !(stage.stage === "TIMING_INSTANCE_CREATION" && stage.reason_code === "WORLD_RULE_UNAVAILABLE"),
  ));
  assert.ok(["TIMING_INSTANCE_MISSING", "TRACE_UNAVAILABLE"].includes(debug.nsfw_pipeline_diagnostics.derived_diagnostic.current_blocking_reason_code));
  assert.ok(Array.isArray(debug.timing_diagnostics));
  assert.ok(Array.isArray(debug.aggregation_diagnostics));
  const traceRunId = debug.nsfw_pipeline_diagnostics.execution_trace.current_run_id;
  const debugAgain = (await fixture.runtime.collectActiveBusinessData({includeDebug: true})).debug;
  assert.equal(fixture.saveFloorCalls(), beforeWrites);
  assert.equal(debugAgain.nsfw_pipeline_diagnostics.execution_trace.current_run_id, traceRunId);
  assert.equal(debugAgain.nsfw_pipeline_diagnostics.current_state.timing_instance_count, debug.nsfw_pipeline_diagnostics.current_state.timing_instance_count);
  assert.equal(debugAgain.nsfw_pipeline_diagnostics.current_state.participant_aggregation_count, debug.nsfw_pipeline_diagnostics.current_state.participant_aggregation_count);
  fixture.runtime.destroy();
});

test("NSFW pipeline diagnostics keep valid Tracking visible when projection rules are empty", async () => {
  let projectionAiCalls = 0;
  const exposure = eventResult("nsfw-empty-rules", {
    pregnancy_relevance: {
      ...eventResult("nsfw-empty-rules").pregnancy_relevance,
      reproductive_mechanism: {kind: "fertilization"},
    },
  });
  const fixture = createFixture({
    reliableStoryTime: true,
    projectionTimingConfigResolver: async () => ({
      schema_version: 1,
      config_version: 1,
      base_min_story_days: 0,
      base_max_story_days: 10,
      variance_ratio: 0,
      variance_cap_story_days: 0,
      total_adjustment_cap_story_days: 0,
    }),
    analyzer: {
      async analyzeWorldModel() {
        return normalizeWorldModel({
          schema_version: 1,
          species: [{name: "species-a", biological_types: [{name: "type-a", capabilities: {can_carry_pregnancy: true}}]}],
          projection_rules: [],
        });
      },
      async analyzeFloor() {
        return {events: [exposure]};
      },
      async generateProjection() {
        projectionAiCalls += 1;
        throw new Error("PROJECTION_AI_MUST_NOT_RUN_WITHOUT_RULES");
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  await fixture.runtime.refreshProjection();

  const debug = (await fixture.runtime.collectActiveBusinessData({includeDebug: true})).debug;
  assert.equal(debug.nsfw_pipeline_diagnostics.current_state.projection_rules_count, 0);
  assert.equal(debug.nsfw_pipeline_diagnostics.current_state.tracking_subject_count, 1);
  assert.ok(debug.nsfw_pipeline_diagnostics.current_state.tracking_window_count >= 1);
  assert.equal(debug.nsfw_pipeline_diagnostics.current_state.timing_instance_count, 1);
  assert.equal(debug.nsfw_pipeline_diagnostics.current_state.participant_aggregation_count, 1);
  assert.ok(debug.nsfw_pipeline_diagnostics.execution_trace.stages.some(stage =>
    stage.stage === "TIMING_CONFIGURATION_RESOLUTION" &&
    stage.execution_status === "SUCCEEDED" &&
    stage.reason_code === "TIMING_CONFIG_RESOLVED",
  ));
  assert.ok(debug.nsfw_pipeline_diagnostics.execution_trace.stages.every(stage => stage.reason_code !== "WORLD_RULE_UNAVAILABLE"));
  assert.equal(projectionAiCalls, 0);
  fixture.runtime.destroy();
});

function projectionDiagnosticsFixtureOptions({eventId, reliableStoryTime = true, saveFloorHook = null, events = null, projectionRules = null} = {}) {
  const exposure = eventResult(eventId, {
    pregnancy_relevance: {
      ...eventResult(eventId).pregnancy_relevance,
      reproductive_mechanism: {kind: "fertilization"},
    },
  });
  const ruleContent = {
    schema_version: 1,
    mechanism_key: "fertilization",
    development_concern_key: "participant-list",
    development_kind: "possible_detection",
    trigger: {kind: "immediate_after_event", source_event_type: "sexual_activity"},
    requirements: {capabilities: [], source_compatibility: "not_required", contributor_relationships: []},
    realization: null,
    contradiction: null,
    expiration: null,
  };
  const timingConfig = {
    schema_version: 1,
    config_version: 1,
    base_min_story_days: 0,
    base_max_story_days: 42,
    variance_ratio: 0,
    variance_cap_story_days: 0,
    total_adjustment_cap_story_days: 0,
  };
  return {
    reliableStoryTime,
    messageLookupById: true,
    messages: [{message_id: "0", floor: 3, content: "当前剧情", role: "assistant"}],
    saveFloorHook,
    projectionTimingBaselineResolver: async () => timingConfig,
    analyzer: {
      async analyzeWorldModel() {
        return normalizeWorldModel({
          schema_version: 1,
          species: [{name: "species-a", biological_types: [{name: "type-a", capabilities: {can_carry_pregnancy: true}}]}],
          projection_rules: projectionRules ?? [ruleContent],
        });
      },
      async analyzeFloor() {
        return {events: events ?? [exposure]};
      },
      async generateProjection() {
        return {development: {kind: "possible_detection", description: "诊断成功路径测试。"}};
      },
    },
  };
}

const LIFECYCLE_RECOVERY_TIMING_CONFIG = Object.freeze({
  schema_version: 1,
  config_version: 7,
  base_min_story_days: 10,
  base_max_story_days: 16,
  variance_ratio: 0,
  variance_cap_story_days: 0,
  total_adjustment_cap_story_days: 0,
});

async function seededLifecycleRecoveryFloor({eventId = "recovery-exposure", existingTiming = false, existingAggregation = false} = {}) {
  const message = {
    message_id: "0",
    floor: 20,
    content: "已经存在的有效 Exposure",
    role: "assistant",
    story_time: {
      display: "2026-01-21",
      normalized: "2026-01-21",
      calendar_id: null,
      precision: "day",
      confidence: 1,
    },
  };
  const version = await floorVersion({
    chatId: "chat-runtime",
    messageId: message.message_id,
    floor: message.floor,
    swipeId: 0,
    text: message.content,
  });
  const event = eventResult(eventId, {
    source: version,
    participants: [
      {
        ...eventResult(eventId).participants[0],
        identity_status: "existing",
        character_id: `${eventId}-subject`,
      },
      {
        ...eventResult(eventId).participants[1],
        identity_status: "existing",
        character_id: `${eventId}-source`,
      },
    ],
    story_time: {
      display: "2026-01-01",
      normalized: "2026-01-01",
      calendar_id: null,
      precision: "day",
      confidence: 1,
    },
    pregnancy_relevance: {
      ...eventResult(eventId).pregnancy_relevance,
      reproductive_mechanism: {kind: "fertilization"},
    },
  });
  const worldModel = normalizeWorldModel({
    schema_version: 1,
    species: [{
      name: "species-a",
      biological_types: [{
        name: "type-a",
        capabilities: {can_carry_pregnancy: true},
      }],
    }],
    projection_rules: [],
  });
  const floor = {
    ...emptyFloor(),
    floor_version: version,
    analysis: {
      status: "success",
      floor_version: version,
      analyzed_at: "2026-01-21T00:00:00.000Z",
      last_success: {analyzed_at: "2026-01-21T00:00:00.000Z"},
    },
    events: [event],
    world_model: worldModel,
  };
  let historicalTiming = null;
  if (existingTiming) {
    const canonicalTiming = resolveProjectionTimingInstance({
      chatId: version.chat_id,
      subjectId: event.pregnancy_relevance.gestational_subject_ids[0],
      mechanismKey: "fertilization",
      firstEvent: event,
      config: LIFECYCLE_RECOVERY_TIMING_CONFIG,
      floorVersion: version,
      rng: () => 1,
    });
    historicalTiming = {
      ...canonicalTiming,
    };
    floor.projection_timing_snapshot = {schema_version: 1, items: [historicalTiming]};
  }
  if (existingAggregation) {
    const timing = historicalTiming ?? resolveProjectionTimingInstance({
      chatId: version.chat_id,
      subjectId: event.pregnancy_relevance.gestational_subject_ids[0],
      mechanismKey: "fertilization",
      firstEvent: event,
      config: LIFECYCLE_RECOVERY_TIMING_CONFIG,
      floorVersion: version,
      rng: () => 1,
    });
    const aggregation = normalizeParticipantAggregation({
      aggregation_id: buildParticipantAggregationId({
        cycleId: timing.cycle_id,
        timingInstanceId: timing.timing_instance_id,
      }),
      subject_id: timing.subject_id,
      pregnancy_id: null,
      mechanism_key: timing.mechanism_key,
      cycle_id: timing.cycle_id,
      timing_instance_id: timing.timing_instance_id,
      aggregation_trigger_strategy: "at_effective_min",
      reference_story_time: timing.reference_story_time,
      aggregation_story_time: message.story_time,
      elapsed_story_days: 20,
      effective_min_story_days: timing.effective_min_story_days,
      effective_max_story_days: timing.effective_max_story_days,
      sampled_individual_offset_story_days: timing.sampled_individual_offset_story_days,
      config_snapshot: timing.config_snapshot,
      accepted_exposure_event_ids: [event.event_id],
      source_basis_refs: timing.source_basis_refs,
      created_at_floor_version: version,
      created_at: "2026-01-21T00:00:00.000Z",
    });
    floor.participant_aggregation_snapshot = {schema_version: 1, items: [aggregation]};
  }
  message.extra = {bioweave: floor};
  return {message, version, event, timing: historicalTiming};
}

test("runtime init recovers historical Exposure into Timing and overdue Aggregation without reanalysis", async () => {
  const seed = await seededLifecycleRecoveryFloor({eventId: "recovery-init-exposure"});
  let worldCalls = 0;
  const fixture = createFixture({
    reliableStoryTime: false,
    messageLookupById: true,
    messages: [seed.message],
    projectionTimingConfigResolver: async () => LIFECYCLE_RECOVERY_TIMING_CONFIG,
    analyzer: {
      async analyzeWorldModel() {
        worldCalls += 1;
        throw new Error("WORLD_AI_MUST_NOT_RUN_DURING_RECOVERY");
      },
      async analyzeFloor() {
        throw new Error("EVENT_AI_MUST_NOT_RUN_DURING_RECOVERY");
      },
      async generateProjection() {
        throw new Error("PROJECTION_AI_MUST_NOT_RUN_WITHOUT_RULES");
      },
    },
  });

  await fixture.runtime.init();
  const debug = (await fixture.runtime.collectActiveBusinessData({includeDebug: true})).debug;
  const pipeline = debug.nsfw_pipeline_diagnostics;
  const recoveryStage = pipeline.execution_trace.stages.find(stage =>
    stage.recovery_trigger === "lifecycle-runtime-init" && stage.recovery_status === "SUCCEEDED",
  );
  assert.equal(fixture.analysisCalls().length, 0);
  assert.equal(worldCalls, 0);
  assert.equal(pipeline.current_state.projection_rules_count, 0);
  assert.equal(pipeline.current_state.timing_instance_count, 1);
  assert.equal(pipeline.current_state.participant_aggregation_count, 1);
  assert.equal(recoveryStage?.recovery_status, "SUCCEEDED");
  assert.equal(recoveryStage?.tracking_window_found, true);
  assert.equal(recoveryStage?.timing_instance_created, true);
  assert.equal(recoveryStage?.aggregation_reused_or_created, true);
  assert.ok(pipeline.execution_trace.stages.some(stage =>
    stage.stage === "TIMING_INSTANCE_CREATION" &&
    stage.execution_status === "SUCCEEDED" &&
    stage.reason_code === "TIMING_INSTANCE_PERSISTED",
  ));
  assert.ok(pipeline.execution_trace.stages.some(stage =>
    stage.stage === "AGGREGATION_PERSISTENCE" &&
    stage.execution_status === "SUCCEEDED" &&
    stage.reason_code === "AGGREGATION_PERSISTED",
  ));
  assert.equal(pipeline.projection_diagnostics.projection_ai_request_started, false);
  fixture.runtime.destroy();
});

test("runtime init reuses a canonical Cycle ID Timing and Aggregation without resampling", async () => {
  const seed = await seededLifecycleRecoveryFloor({
    eventId: "recovery-legacy-cycle",
    existingTiming: true,
    existingAggregation: true,
  });
  const fixture = createFixture({
    reliableStoryTime: false,
    messageLookupById: true,
    messages: [seed.message],
    projectionTimingConfigResolver: async () => ({
      ...LIFECYCLE_RECOVERY_TIMING_CONFIG,
      config_version: 99,
      variance_ratio: 0.9,
      variance_cap_story_days: 9,
      total_adjustment_cap_story_days: 9,
    }),
    analyzer: {
      async analyzeWorldModel() {
        throw new Error("WORLD_AI_MUST_NOT_RUN_DURING_CANONICAL_REUSE");
      },
      async analyzeFloor() {
        throw new Error("EVENT_AI_MUST_NOT_RUN_DURING_CANONICAL_REUSE");
      },
      async generateProjection() {
        throw new Error("PROJECTION_AI_MUST_NOT_RUN_WITHOUT_RULES");
      },
    },
  });

  await fixture.runtime.init();
  const debug = (await fixture.runtime.collectActiveBusinessData({includeDebug: true})).debug;
  const timing = debug.lifecycle_runtime.projection_timing.timing_instances[0];
  const aggregation = debug.lifecycle_runtime.participant_aggregation.aggregations[0];
  const pipeline = debug.nsfw_pipeline_diagnostics;
  const currentRunId = pipeline.execution_trace.current_run_id;
  const runStages = pipeline.execution_trace.stages.filter(stage => stage.run_id === currentRunId);
  assert.ok(timing);
  assert.ok(aggregation);
  assert.equal(timing.timing_instance_id, seed.timing.timing_instance_id);
  assert.equal(timing.cycle_id, seed.timing.cycle_id);
  assert.equal(timing.sampled_individual_offset_story_days, seed.timing.sampled_individual_offset_story_days);
  assert.equal(aggregation.aggregation_id, buildParticipantAggregationId({
    cycleId: seed.timing.cycle_id,
    timingInstanceId: seed.timing.timing_instance_id,
  }));
  assert.ok(runStages.some(stage =>
    stage.stage === "TIMING_INSTANCE_CREATION" &&
    stage.reason_code === "TIMING_INSTANCE_EXISTS" &&
    stage.cycle_id_resolution_status === "CANONICAL_CYCLE_ID",
  ));
  const timingDiagnostic = pipeline.timing_diagnostics.find(item =>
    item.timing_instance_id === seed.timing.timing_instance_id,
  );
  assert.equal(timingDiagnostic?.cycle_id_source, "TRACKING_WINDOW");
  assert.equal(timingDiagnostic?.cycle_id_consistent, true);
  assert.equal(timingDiagnostic?.first_exposure_event_id, seed.event.event_id);
  const aggregationDiagnostic = pipeline.aggregation_diagnostics.find(item =>
    item.aggregation_id === aggregation.aggregation_id,
  );
  assert.equal(aggregationDiagnostic?.cycle_id_source, "TRACKING_WINDOW");
  assert.equal(aggregationDiagnostic?.first_exposure_event_id, seed.event.event_id);
  assert.equal(runStages.some(stage =>
    stage.stage === "AGGREGATION_PERSISTENCE" && stage.reason_code === "AGGREGATION_PERSISTED",
  ), false);
  fixture.runtime.destroy();
});

test("manual Timing Instance edit writes the current Floor and reevaluates only its Aggregation", async () => {
  const seed = await seededLifecycleRecoveryFloor({
    eventId: "manual-timing-edit",
    existingTiming: true,
    existingAggregation: true,
  });
  seed.message.story_time = {
    display: "2026-01-18",
    normalized: "2026-01-18",
    calendar_id: null,
    precision: "day",
    confidence: 1,
  };
  const fixture = createFixture({
    reliableStoryTime: false,
    messageLookupById: true,
    messages: [seed.message],
    analyzer: {
      async analyzeWorldModel() {
        throw new Error("WORLD_AI_MUST_NOT_RUN_DURING_MANUAL_TIMING_EDIT");
      },
      async analyzeFloor() {
        throw new Error("EVENT_AI_MUST_NOT_RUN_DURING_MANUAL_TIMING_EDIT");
      },
      async generateProjection() {
        throw new Error("PROJECTION_AI_MUST_NOT_RUN_WITHOUT_RULES");
      },
    },
  });

  await fixture.runtime.init();
  const subjectId = seed.event.pregnancy_relevance.gestational_subject_ids[0];
  const canonicalBuildsBeforeEdit = fixture.runtime.getPersistenceTrace().sequence
    .filter(item => item.stage === "CHARACTER_CANONICAL_PHASES").length;
  await fixture.runtime.saveCharacterTimingConfig({
    characterId: subjectId,
    config: {...LIFECYCLE_RECOVERY_TIMING_CONFIG, base_min_story_days: 18, base_max_story_days: 20},
  });
  const separated = await fixture.runtime.getCharacterTimingEditorData({characterId: subjectId});
  assert.equal(separated.config.base_min_story_days, 18);
  assert.equal(separated.config.base_max_story_days, 20);
  assert.equal(separated.timing_instance.base_min_story_days, 10);
  assert.equal(separated.timing_instance.base_max_story_days, 16);
  const performanceOperationId = fixture.runtime.startTimingPerformanceOperation({
    operation: "SAVE_TIMING_INSTANCE",
    character_id: subjectId,
    chat_id: "chat-runtime",
  });
  const result = await fixture.runtime.editCharacterTimingInstance({
    characterId: subjectId,
    timingInstanceId: seed.timing.timing_instance_id,
    baseMinStoryDays: 18,
    baseMaxStoryDays: 20,
    varianceRatio: 0.25,
    varianceCapStoryDays: 4,
    totalAdjustmentCapStoryDays: 2,
    performanceOperationId,
  });
  fixture.runtime.finishTimingPerformanceOperation({operation_id: performanceOperationId, status: "SUCCEEDED"});
  assert.equal(result.status, "succeeded");
  const canonicalBuildsAfterEdit = fixture.runtime.getPersistenceTrace().sequence
    .filter(item => item.stage === "CHARACTER_CANONICAL_PHASES").length;
  assert.equal(canonicalBuildsAfterEdit, canonicalBuildsBeforeEdit);
  assert.equal(result.timing_instance.cycle_id, seed.timing.cycle_id);
  assert.equal(result.timing_instance.sampled_individual_offset_story_days, seed.timing.sampled_individual_offset_story_days);
  assert.equal(result.timing_instance.base_min_story_days, 18);
  assert.equal(result.timing_instance.base_max_story_days, 20);
  assert.equal(result.timing_instance.variance_ratio, 0.25);
  assert.equal(result.timing_instance.variance_cap_story_days, 4);
  assert.equal(result.timing_instance.total_adjustment_cap_story_days, 2);
  assert.equal(result.aggregation_reevaluation.action, "removed_before_min");
  const performanceOperation = fixture.runtime.getTimingPerformanceDiagnostics().recent_operations.find(item =>
    item.operation_id === performanceOperationId,
  );
  assert.equal(performanceOperation?.status, "SUCCEEDED");
  assert.ok(performanceOperation?.total_duration_ms !== null);
  const performanceStageNames = new Set(performanceOperation?.stages.map(stage => stage.stage));
  for (const stage of [
    "TIMING_INSTANCE_RESOLUTION",
    "TIMING_INSTANCE_PERSISTENCE",
    "TIMING_INSTANCE_READBACK",
    "AGGREGATION_REEVALUATION_INPUT",
    "AGGREGATION_PERSISTENCE",
    "AGGREGATION_READBACK",
    "PERSISTENCE_REQUEST_PREPARE",
    "COORDINATOR_QUEUE_WAIT",
    "AUTHORITATIVE_FLOOR_RESOLVE",
    "FLOOR_VERSION_VALIDATION",
    "SNAPSHOT_MERGE",
    "COORDINATOR_PRE_SAVE_GUARD",
    "STORE_SAVE_FLOOR",
    "COORDINATOR_READBACK",
    "COORDINATOR_EXECUTION",
  ]) assert.ok(performanceStageNames.has(stage), stage);
  fixture.runtime.recordPersistenceTrace({
    stage: "BIOWEAVE_FULL_CHAT_SAVE_DISPATCHED",
    performance_operation_id: performanceOperationId,
    persistence_kind: "TIMING_INSTANCE",
  });
  fixture.runtime.recordPersistenceTrace({
    stage: "BIOWEAVE_FULL_CHAT_SAVE_RESOLVED",
    performance_operation_id: performanceOperationId,
    persistence_kind: "TIMING_INSTANCE",
    commit_state: "resolved",
    host_chat_save_duration_ms: 12.75,
  });
  fixture.runtime.recordPersistenceTrace({
    stage: "OFFICIAL_CHAT_IO",
    performance_operation_id: performanceOperationId,
    floor_transaction_id: "floor-tx-timing-test",
    persistence_kind: "TIMING_INSTANCE",
    io_call_id: "official-io-test",
    io_purpose: "SAVE_PREWRITE_READ",
    endpoint_kind: "CHAT_GET",
    actual_network_request: true,
    cache_status: "NOT_USED",
    status: "SUCCEEDED",
    total_duration_ms: 9.5,
    network_wait_duration_ms: 8.25,
    response_body_read_duration_ms: 0.75,
    json_parse_duration_ms: 0.15,
    response_parse_duration_ms: 0.5,
    response_normalize_duration_ms: 0.25,
    source_revision_duration_ms: 0.5,
  });
  fixture.runtime.recordPersistenceTrace({
    stage: "OFFICIAL_FLOOR_EXTRACT",
    performance_operation_id: performanceOperationId,
    floor_transaction_id: "floor-tx-timing-test",
    persistence_kind: "TIMING_INSTANCE",
    io_call_id: "official-io-test",
    io_purpose: "SAVE_PREWRITE_READ",
    floor_extract_duration_ms: 0.2,
    status: "SUCCEEDED",
  });
  const hostSaveStage = fixture.runtime.getTimingPerformanceDiagnostics().recent_operations
    .find(item => item.operation_id === performanceOperationId)?.stages.find(stage => stage.stage === "HOST_SAVE_AWAIT");
  const hostInvocationStage = fixture.runtime.getTimingPerformanceDiagnostics().recent_operations
    .find(item => item.operation_id === performanceOperationId)?.stages.find(stage => stage.stage === "HOST_SAVE_INVOCATION");
  assert.equal(hostInvocationStage?.status, "ATTEMPTED");
  assert.equal(hostInvocationStage?.duration_ms, null);
  assert.equal(hostSaveStage?.status, "SUCCEEDED");
  assert.equal(hostSaveStage?.host_save_duration_ms, 12.75);
  const officialIo = fixture.runtime.getTimingPerformanceDiagnostics().recent_operations
    .find(item => item.operation_id === performanceOperationId)?.official_io_calls;
  assert.equal(officialIo?.length, 1);
  assert.equal(officialIo?.[0].floor_transaction_id, "floor-tx-timing-test");
  assert.equal(officialIo?.[0].io_purpose, "SAVE_PREWRITE_READ");
  assert.equal(officialIo?.[0].endpoint_kind, "CHAT_GET");
  assert.equal(officialIo?.[0].actual_network_request, true);
  assert.equal(officialIo?.[0].network_wait_duration_ms, 8.25);
  assert.equal(officialIo?.[0].response_body_read_duration_ms, 0.75);
  assert.equal(officialIo?.[0].json_parse_duration_ms, 0.15);
  assert.equal(officialIo?.[0].floor_extract_duration_ms, 0.2);

  const timingDebug = await fixture.runtime.getProjectionTimingDebug();
  const timing = timingDebug.timing_instances.find(item =>
    item.timing_instance_id === seed.timing.timing_instance_id,
  );
  assert.ok(timing, JSON.stringify(timingDebug));
  assert.equal(timing.base_min_story_days, 18);
  assert.equal(timing.base_max_story_days, 20);
  assert.equal(timing.sampled_individual_offset_story_days, seed.timing.sampled_individual_offset_story_days);
  assert.equal(timing.variance_ratio, 0.25);
  assert.equal(timing.variance_cap_story_days, 4);
  assert.equal(timing.total_adjustment_cap_story_days, 2);
  assert.equal((await fixture.runtime.getParticipantAggregations({
    chatId: "chat-runtime",
    endpointFloor: seed.version.floor,
    endpointIndex: 0,
  })).items.length, 0);
  const trace = fixture.runtime.getPersistenceTrace();
  assert.ok(trace);
  const pipeline = (await fixture.runtime.collectActiveBusinessData({includeDebug: true})).debug.nsfw_pipeline_diagnostics;
  assert.ok(pipeline.execution_trace.runs.some(run => run.trigger === "manual-timing-instance-edit"));
  assert.ok(pipeline.execution_trace.stages.some(stage =>
    stage.stage === "TIMING_INSTANCE_MANUAL_EDIT"
    && stage.execution_status === "SUCCEEDED"
    && stage.sampled_individual_offset_story_days === seed.timing.sampled_individual_offset_story_days
    && stage.sampled_offset_source === "FROZEN_SNAPSHOT"
    && stage.frozen_offset_status === "PRESERVED",
  ));
  assert.ok(pipeline.timing_diagnostics.some(item =>
    item.timing_instance_id === seed.timing.timing_instance_id
    && item.manual_timing_edit?.succeeded === true
    && item.character_timing_config?.min_story_days === 18
    && item.variance_ratio === 0.25
    && item.active_timing_instance?.effective_min_story_days === 18,
  ));
  assert.ok(pipeline.aggregation_diagnostics.some(item =>
    item.timing_instance_id === seed.timing.timing_instance_id
    && item.aggregation_reevaluation?.action === "removed_before_min",
  ));

  const restored = await fixture.runtime.editCharacterTimingInstance({
    characterId: subjectId,
    baseMinStoryDays: 16,
    baseMaxStoryDays: 20,
    varianceRatio: 0.25,
    varianceCapStoryDays: 4,
    totalAdjustmentCapStoryDays: 4,
  });
  assert.equal(restored.status, "succeeded");
  assert.equal(restored.timing_instance.timing_instance_id, seed.timing.timing_instance_id);
  assert.equal(restored.timing_instance.cycle_id, seed.timing.cycle_id);
  assert.equal(restored.timing_instance.sampled_individual_offset_story_days, seed.timing.sampled_individual_offset_story_days);
  assert.equal(restored.timing_instance.variance_ratio, 0.25);
  assert.equal(restored.timing_instance.effective_min_story_days, 16);
  assert.equal(restored.timing_instance.effective_max_story_days, 20);
  assert.equal(restored.aggregation_reevaluation.action, "created_due");
  const restoredAggregations = await fixture.runtime.getParticipantAggregations({
    chatId: "chat-runtime",
    endpointFloor: seed.version.floor,
    endpointIndex: 0,
  });
  assert.equal(restoredAggregations.items.length, 1);
  assert.equal(restoredAggregations.items[0].subject_id, subjectId);
  assert.equal(restoredAggregations.items[0].cycle_id, seed.timing.cycle_id);

  fixture.runtime.destroy();
});

test("manual Timing Instance edit uses the chat-array owner index when host message_id is numeric", async () => {
  const seed = await seededLifecycleRecoveryFloor({
    eventId: "manual-timing-numeric-owner",
    existingTiming: true,
    existingAggregation: true,
  });
  seed.message.message_id = 72;
  seed.message.floor = 72;
  seed.message.story_time = {
    display: "2026-01-18",
    normalized: "2026-01-18",
    calendar_id: null,
    precision: "day",
    confidence: 1,
  };
  const currentVersion = await floorVersion({
    chatId: "chat-runtime",
    messageId: seed.message.message_id,
    floor: seed.message.floor,
    swipeId: 0,
    text: seed.message.content,
  });
  const floorData = seed.message.extra.bioweave;
  floorData.floor_version = currentVersion;
  floorData.analysis.floor_version = currentVersion;
  floorData.events = floorData.events.map(item => ({...item, source: currentVersion}));

  const fixture = createFixture({
    reliableStoryTime: false,
    messageLookupById: true,
    messages: [
      {message_id: "user-before-target", floor: 71, content: "用户上下文", role: "user"},
      seed.message,
    ],
    analyzer: {
      async analyzeWorldModel() {
        throw new Error("WORLD_AI_MUST_NOT_RUN_DURING_NUMERIC_OWNER_EDIT");
      },
      async analyzeFloor() {
        throw new Error("EVENT_AI_MUST_NOT_RUN_DURING_NUMERIC_OWNER_EDIT");
      },
      async generateProjection() {
        throw new Error("PROJECTION_AI_MUST_NOT_RUN_WITHOUT_RULES");
      },
    },
  });

  await fixture.runtime.init();
  const subjectId = seed.event.pregnancy_relevance.gestational_subject_ids[0];
  const result = await fixture.runtime.editCharacterTimingInstance({
    characterId: subjectId,
    timingInstanceId: seed.timing.timing_instance_id,
    baseMinStoryDays: 18,
    baseMaxStoryDays: 20,
  });

  assert.equal(result.status, "succeeded");
  assert.equal(result.timing_instance.base_min_story_days, 18);
  assert.equal(result.aggregation_reevaluation.action, "removed_before_min");
  assert.equal(fixture.context.chat[1].extra.bioweave.floor_version.message_id, 72);
  assert.equal(fixture.context.chat[1].extra.bioweave.projection_timing_snapshot.items[0].base_min_story_days, 18);
  assert.equal(fixture.context.chat[1].extra.bioweave.participant_aggregation_snapshot.items.length, 0);
  assert.equal(fixture.context.chat[0].extra, undefined);
  assert.equal(fixture.analysisCalls().length, 0);

  const pipeline = (await fixture.runtime.collectActiveBusinessData({includeDebug: true})).debug.nsfw_pipeline_diagnostics;
  const editStage = [...pipeline.execution_trace.stages].reverse().find(stage =>
    stage.stage === "TIMING_INSTANCE_MANUAL_EDIT" && stage.execution_status === "SUCCEEDED",
  );
  assert.equal(editStage.owner_message_index, 1);
  assert.equal(editStage.owner_message_id, 72);
  assert.equal(editStage.floor_version.message_id, currentVersion.message_id);
  assert.equal(editStage.floor_version.floor, currentVersion.floor);
  assert.equal(editStage.floor_version.content_hash, currentVersion.content_hash);
  assert.equal(editStage.version_classification, null);
  fixture.runtime.destroy();
});

test("manual Timing Instance edit preserves an explicit Floor 72 owner index through readback", async () => {
  const seed = await seededLifecycleRecoveryFloor({
    eventId: "manual-timing-floor-72-owner",
    existingTiming: true,
    existingAggregation: true,
  });
  seed.message.message_id = 72;
  seed.message.floor = 72;
  seed.message.story_time = {
    display: "2026-01-18",
    normalized: "2026-01-18",
    calendar_id: null,
    precision: "day",
    confidence: 1,
  };
  const currentVersion = await floorVersion({
    chatId: "chat-runtime",
    messageId: seed.message.message_id,
    floor: seed.message.floor,
    swipeId: 0,
    text: seed.message.content,
  });
  const floorData = seed.message.extra.bioweave;
  floorData.floor_version = currentVersion;
  floorData.analysis.floor_version = currentVersion;
  floorData.events = floorData.events.map(item => ({...item, source: currentVersion}));
  const messages = Array.from({length: 72}, (_, index) => ({
    message_id: index,
    floor: index,
    content: `历史消息 ${index}`,
    role: "user",
  }));
  messages.push(seed.message);
  const fixture = createFixture({
    reliableStoryTime: false,
    messageLookupById: true,
    messages,
    analyzer: {
      async analyzeWorldModel() {
        throw new Error("WORLD_AI_MUST_NOT_RUN_DURING_FLOOR_72_OWNER_EDIT");
      },
      async analyzeFloor() {
        throw new Error("EVENT_AI_MUST_NOT_RUN_DURING_FLOOR_72_OWNER_EDIT");
      },
      async generateProjection() {
        throw new Error("PROJECTION_AI_MUST_NOT_RUN_DURING_FLOOR_72_OWNER_EDIT");
      },
    },
  });

  await fixture.runtime.init();
  const subjectId = seed.event.pregnancy_relevance.gestational_subject_ids[0];
  const result = await fixture.runtime.editCharacterTimingInstance({
    characterId: subjectId,
    timingInstanceId: "stale-ui-timing-id",
    baseMinStoryDays: 18,
    baseMaxStoryDays: 20,
  });

  assert.equal(result.status, "succeeded");
  assert.equal(fixture.context.chat[72].extra.bioweave.floor_version.message_id, 72);
  assert.equal(fixture.context.chat[72].extra.bioweave.projection_timing_snapshot.items[0].base_min_story_days, 18);
  assert.equal(fixture.context.chat[72].extra.bioweave.participant_aggregation_snapshot.items.length, 0);
  assert.equal(fixture.context.chat[0].extra, undefined);
  const transactionTrace = fixture.runtime.getPersistenceTrace().sequence.filter(entry =>
    entry.operation_type === "manual-timing-instance-edit",
  );
  assert.ok(transactionTrace.some(entry => entry.stage === "FLOOR_TX_CREATED" && entry.message_index === 72));
  assert.ok(transactionTrace.some(entry => entry.stage === "FLOOR_TX_READBACK" && entry.message_index === 72));
  fixture.runtime.destroy();
});

test("manual Timing Instance edit rejects multiple current instances for one character", async () => {
  const seed = await seededLifecycleRecoveryFloor({
    eventId: "manual-timing-ambiguous-character",
    existingTiming: true,
    existingAggregation: true,
  });
  const duplicate = {
    ...structuredClone(seed.timing),
    timing_instance_id: "projection_timing_duplicate_current",
    cycle_id: "projection_timing_cycle_duplicate_current",
  };
  seed.message.extra.bioweave.projection_timing_snapshot.items.push(duplicate);
  const fixture = createFixture({
    messageLookupById: true,
    messages: [seed.message],
    analyzer: {
      async analyzeWorldModel() {
        throw new Error("WORLD_AI_MUST_NOT_RUN_DURING_AMBIGUOUS_TIMING_EDIT");
      },
      async analyzeFloor() {
        throw new Error("EVENT_AI_MUST_NOT_RUN_DURING_AMBIGUOUS_TIMING_EDIT");
      },
    },
  });

  await fixture.runtime.init();
  const savesBeforeEdit = fixture.saveFloorCalls();
  const subjectId = seed.event.pregnancy_relevance.gestational_subject_ids[0];
  await assert.rejects(
    fixture.runtime.editCharacterTimingInstance({
      characterId: subjectId,
      timingInstanceId: seed.timing.timing_instance_id,
      baseMinStoryDays: 18,
      baseMaxStoryDays: 20,
    }),
    error => error.code === "TIMING_INSTANCE_AMBIGUOUS",
  );
  assert.equal(fixture.saveFloorCalls(), savesBeforeEdit);
  fixture.runtime.destroy();
});

test("real Runtime manual Timing edit repairs a current owner slot with both stored version fields stale", async () => {
  const seed = await seededLifecycleRecoveryFloor({
    eventId: "manual-timing-stale-owner-slot",
    existingTiming: true,
    existingAggregation: true,
  });
  seed.message.story_time = {
    display: "2026-01-18",
    normalized: "2026-01-18",
    calendar_id: null,
    precision: "day",
    confidence: 1,
  };
  const fixture = createFixture({
    reliableStoryTime: false,
    messageLookupById: true,
    messages: [seed.message],
    analyzer: {
      async analyzeWorldModel() {
        throw new Error("WORLD_AI_MUST_NOT_RUN_DURING_STALE_OWNER_EDIT");
      },
      async analyzeFloor() {
        throw new Error("EVENT_AI_MUST_NOT_RUN_DURING_STALE_OWNER_EDIT");
      },
      async generateProjection() {
        throw new Error("PROJECTION_AI_MUST_NOT_RUN_DURING_STALE_OWNER_EDIT");
      },
    },
  });

  await fixture.runtime.init();
  const current = await fixture.runtime.resolveCurrentBioWeaveFloor({__messageIndex: true, index: 0});
  const stored = fixture.context.chat[0].extra.bioweave;
  const storedVersion = {
    ...current.version,
    content_hash: "a29ab3f742a62daf08bd70a5367f82f43c20b1e32406bea170ae528a9d5d4d40",
    message_version: "v1:a29ab3f742a62daf08bd70a5367f82f43c20b1e32406bea170ae528a9d5d4d40",
  };
  stored.floor_version = storedVersion;
  assert.notEqual(storedVersion.content_hash, current.version.content_hash);
  assert.notEqual(storedVersion.message_version, current.version.message_version);

  const subjectId = seed.event.pregnancy_relevance.gestational_subject_ids[0];
  const result = await fixture.runtime.editCharacterTimingInstance({
    characterId: subjectId,
    timingInstanceId: seed.timing.timing_instance_id,
    baseMinStoryDays: 18,
    baseMaxStoryDays: 20,
    editStartFloorVersion: current.version,
  });

  assert.equal(result.status, "succeeded");
  assert.equal(result.timing_instance.timing_instance_id, seed.timing.timing_instance_id);
  assert.equal(result.timing_instance.cycle_id, seed.timing.cycle_id);
  assert.equal(result.timing_instance.sampled_individual_offset_story_days, seed.timing.sampled_individual_offset_story_days);
  assert.equal(result.aggregation_reevaluation.action, "removed_before_min");
  assert.deepEqual(fixture.context.chat[0].extra.bioweave.floor_version, current.version);
  assert.equal(fixture.context.chat[0].extra.bioweave.projection_timing_snapshot.items[0].base_min_story_days, 18);
  assert.equal(fixture.context.chat[0].extra.bioweave.projection_timing_snapshot.items[0].base_max_story_days, 20);
  assert.deepEqual(fixture.context.chat[0].extra.bioweave.participant_aggregation_snapshot.items, []);
  assert.equal(fixture.analysisCalls().length, 0);
  fixture.runtime.destroy();
});

test("manual Timing edit repairs a stale owner slot even when the frozen values are unchanged", async () => {
  const seed = await seededLifecycleRecoveryFloor({
    eventId: "manual-timing-stale-owner-noop",
    existingTiming: true,
    existingAggregation: true,
  });
  seed.message.story_time = {
    display: "2026-01-18",
    normalized: "2026-01-18",
    calendar_id: null,
    precision: "day",
    confidence: 1,
  };
  const fixture = createFixture({
    reliableStoryTime: false,
    messageLookupById: true,
    messages: [seed.message],
    analyzer: {
      async analyzeWorldModel() {
        throw new Error("WORLD_AI_MUST_NOT_RUN_DURING_STALE_OWNER_NOOP_EDIT");
      },
      async analyzeFloor() {
        throw new Error("EVENT_AI_MUST_NOT_RUN_DURING_STALE_OWNER_NOOP_EDIT");
      },
    },
  });

  await fixture.runtime.init();
  const current = await fixture.runtime.resolveCurrentBioWeaveFloor({__messageIndex: true, index: 0});
  const stored = fixture.context.chat[0].extra.bioweave;
  stored.floor_version = {
    ...current.version,
    content_hash: "a29ab3f742a62daf08bd70a5367f82f43c20b1e32406bea170ae528a9d5d4d40",
    message_version: "v1:a29ab3f742a62daf08bd70a5367f82f43c20b1e32406bea170ae528a9d5d4d40",
  };
  const subjectId = seed.event.pregnancy_relevance.gestational_subject_ids[0];
  const result = await fixture.runtime.editCharacterTimingInstance({
    characterId: subjectId,
    timingInstanceId: "stale-ui-timing-id",
    baseMinStoryDays: 10,
    baseMaxStoryDays: 16,
    editStartFloorVersion: current.version,
  });

  assert.equal(result.status, "succeeded");
  assert.equal(result.timing_instance.base_min_story_days, 10);
  assert.equal(result.timing_instance.base_max_story_days, 16);
  assert.deepEqual(fixture.context.chat[0].extra.bioweave.floor_version, current.version);
  assert.equal(result.timing_instance.sampled_individual_offset_story_days, seed.timing.sampled_individual_offset_story_days);
  assert.equal(fixture.analysisCalls().length, 0);
  fixture.runtime.destroy();
});

test("real Runtime rejects a Timing edit when the Floor changes after edit start", async () => {
  const seed = await seededLifecycleRecoveryFloor({
    eventId: "manual-timing-edit-stale-context",
    existingTiming: true,
    existingAggregation: true,
  });
  seed.message.story_time = {
    display: "2026-01-18",
    normalized: "2026-01-18",
    calendar_id: null,
    precision: "day",
    confidence: 1,
  };
  const fixture = createFixture({
    reliableStoryTime: false,
    messageLookupById: true,
    messages: [seed.message],
    analyzer: {
      async analyzeWorldModel() {
        throw new Error("WORLD_AI_MUST_NOT_RUN_DURING_STALE_CONTEXT_EDIT");
      },
      async analyzeFloor() {
        throw new Error("EVENT_AI_MUST_NOT_RUN_DURING_STALE_CONTEXT_EDIT");
      },
      async generateProjection() {
        throw new Error("PROJECTION_AI_MUST_NOT_RUN_DURING_STALE_CONTEXT_EDIT");
      },
    },
  });

  await fixture.runtime.init();
  const editStart = await fixture.runtime.resolveCurrentBioWeaveFloor({__messageIndex: true, index: 0});
  const before = structuredClone(fixture.context.chat[0].extra.bioweave);
  fixture.context.chat[0].content = "编辑期间正文变化";

  await assert.rejects(
    fixture.runtime.editCharacterTimingInstance({
      characterId: seed.event.pregnancy_relevance.gestational_subject_ids[0],
      timingInstanceId: seed.timing.timing_instance_id,
      baseMinStoryDays: 18,
      baseMaxStoryDays: 20,
      editStartFloorVersion: editStart.version,
    }),
    error => error.code === "FLOOR_VERSION_STALE"
      && error.version_classification === "TRUE_CONTEXT_VERSION_CHANGE"
      && error.validation_source === "current_floor_resolver",
  );
  assert.deepEqual(fixture.context.chat[0].extra.bioweave, before);
  assert.equal(fixture.analysisCalls().length, 0);
  fixture.runtime.destroy();
});

test("manual Timing Instance edit preserves an existing successful Aggregation when still due", async () => {
  const seed = await seededLifecycleRecoveryFloor({
    eventId: "manual-timing-edit-preserve",
    existingTiming: true,
    existingAggregation: true,
  });
  const fixture = createFixture({
    reliableStoryTime: false,
    messageLookupById: true,
    messages: [seed.message],
    analyzer: {
      async analyzeWorldModel() {
        throw new Error("WORLD_AI_MUST_NOT_RUN_DURING_MANUAL_TIMING_EDIT_PRESERVE");
      },
      async analyzeFloor() {
        throw new Error("EVENT_AI_MUST_NOT_RUN_DURING_MANUAL_TIMING_EDIT_PRESERVE");
      },
      async generateProjection() {
        throw new Error("PROJECTION_AI_MUST_NOT_RUN_WITHOUT_RULES");
      },
    },
  });
  await fixture.runtime.init();
  const subjectId = seed.event.pregnancy_relevance.gestational_subject_ids[0];
  const result = await fixture.runtime.editCharacterTimingInstance({
    characterId: subjectId,
    timingInstanceId: seed.timing.timing_instance_id,
    baseMinStoryDays: 18,
    baseMaxStoryDays: 20,
  });
  assert.equal(result.aggregation_reevaluation.action, "preserved_due");
  const readback = await fixture.runtime.getParticipantAggregations({
    chatId: "chat-runtime",
    endpointFloor: seed.version.floor,
    endpointIndex: 0,
  });
  assert.equal(readback.items.length, 1);
  assert.equal(readback.items[0].aggregation_id, buildParticipantAggregationId({
    cycleId: seed.timing.cycle_id,
    timingInstanceId: seed.timing.timing_instance_id,
  }));
  assert.equal(readback.items[0].effective_min_story_days, 18);
  assert.equal(readback.items[0].effective_max_story_days, 20);
  fixture.runtime.destroy();
});

test("manual Timing reevaluation removes only the target Aggregation and preserves siblings", async () => {
  const seed = await seededLifecycleRecoveryFloor({
    eventId: "manual-timing-target-only",
    existingTiming: true,
    existingAggregation: true,
  });
  const fixture = createFixture({
    reliableStoryTime: false,
    messageLookupById: true,
    messages: [seed.message],
    analyzer: {
      async analyzeWorldModel() {
        throw new Error("WORLD_AI_MUST_NOT_RUN_DURING_TARGET_ONLY_EDIT");
      },
      async analyzeFloor() {
        throw new Error("EVENT_AI_MUST_NOT_RUN_DURING_TARGET_ONLY_EDIT");
      },
    },
  });

  await fixture.runtime.init();
  const targetSubjectId = seed.event.pregnancy_relevance.gestational_subject_ids[0];
  const sibling = normalizeParticipantAggregation({
    aggregation_id: "participant_aggregation_sibling",
    subject_id: "sibling-subject",
    pregnancy_id: null,
    mechanism_key: "fertilization",
    cycle_id: "sibling-cycle",
    timing_instance_id: "sibling-timing",
    reference_story_time: {day_index: 1},
    aggregation_story_time: {day_index: 20},
    elapsed_story_days: 19,
    effective_min_story_days: 14,
    effective_max_story_days: 42,
    sampled_individual_offset_story_days: 0,
    config_snapshot: LIFECYCLE_RECOVERY_TIMING_CONFIG,
    accepted_exposure_event_ids: [seed.event.event_id],
    source_basis_refs: {fixture: "sibling"},
    created_at_floor_version: seed.version,
  });
  await fixture.runtime.upsertParticipantAggregation({
    chatId: "chat-runtime",
    ownerFloor: {message_index: 0},
    floorVersion: seed.version,
    aggregation: sibling,
  });
  const siblingBefore = structuredClone((await fixture.runtime.getParticipantAggregations({
    chatId: "chat-runtime",
    endpointFloor: seed.version.floor,
    endpointIndex: 0,
  })).items.find(item => item.aggregation_id === sibling.aggregation_id));

  const result = await fixture.runtime.editCharacterTimingInstance({
    characterId: targetSubjectId,
    timingInstanceId: seed.timing.timing_instance_id,
    baseMinStoryDays: 40,
    baseMaxStoryDays: 50,
  });
  assert.equal(result.aggregation_reevaluation.action, "removed_before_min");

  const after = await fixture.runtime.getParticipantAggregations({
    chatId: "chat-runtime",
    endpointFloor: seed.version.floor,
    endpointIndex: 0,
  });
  assert.equal(after.items.some(item => item.subject_id === targetSubjectId), false);
  assert.deepEqual(
    after.items.find(item => item.aggregation_id === sibling.aggregation_id),
    siblingBefore,
  );
  fixture.runtime.destroy();
});

test("NSFW pipeline diagnostics expose successful Timing and Aggregation persistence", async () => {
  const fixture = createFixture(projectionDiagnosticsFixtureOptions({eventId: "nsfw-successful-aggregation"}));
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  await fixture.runtime.refreshProjection();

  const debug = (await fixture.runtime.collectActiveBusinessData({includeDebug: true})).debug;
  const pipeline = debug.nsfw_pipeline_diagnostics;
  assert.equal(pipeline.current_state.timing_instance_count, 1);
  assert.equal(pipeline.current_state.participant_aggregation_count, 1);
  assert.ok(pipeline.execution_trace.stages.some(stage =>
    stage.stage === "TIMING_INSTANCE_CREATION" && stage.execution_status === "SUCCEEDED",
  ));
  const creation = pipeline.execution_trace.stages.find(stage =>
    stage.stage === "TIMING_INSTANCE_CREATION"
    && stage.execution_status === "SUCCEEDED"
    && stage.reason_code === "TIMING_INSTANCE_PERSISTED",
  );
  assert.equal(creation.rng_source, "RUNTIME_DEFAULT_MATH_RANDOM");
  assert.equal(creation.sampled_offset_source, "INITIAL_RANDOM_SAMPLE");
  assert.equal(creation.frozen_offset_status, "FROZEN_ON_CREATION");

  assert.ok(pipeline.execution_trace.stages.some(stage =>
    stage.stage === "PARTICIPANT_AGGREGATION_EXECUTION" && stage.execution_status === "SUCCEEDED",
  ));
  assert.ok(pipeline.execution_trace.stages.some(stage =>
    stage.stage === "AGGREGATION_PERSISTENCE" && stage.execution_status === "SUCCEEDED",
  ));
  const aggregation = debug.aggregation_diagnostics.find(item => item.aggregation_status === "SUCCEEDED");
  assert.ok(aggregation);
  assert.equal(aggregation.readback_succeeded, true);
  const lifecycleAggregation = debug.lifecycle_runtime.observation_boundary.aggregations.find(item => item.aggregation_id === aggregation.aggregation_id);
  assert.ok(lifecycleAggregation);
  assert.equal(lifecycleAggregation.freeze_status, "FROZEN");
  assert.deepEqual(lifecycleAggregation.accepted_exposure_event_ids, aggregation.accepted_exposure_event_ids);
  assert.deepEqual(lifecycleAggregation.excluded_after_aggregation_event_ids, []);
  assert.equal(lifecycleAggregation.excluded_after_aggregation_reason, null);
  assert.equal(lifecycleAggregation.pregnancy_id, null);
  assert.equal(lifecycleAggregation.timeout_status, "waiting/not_due");
  fixture.runtime.destroy();
});

test("first Timing creation uses the runtime RNG and freezes its sampled offset", async () => {
  let rngCalls = 0;
  const fixture = createFixture({
    ...projectionDiagnosticsFixtureOptions({
      eventId: "nsfw-first-timing-rng-trace",
      projectionRules: [],
    }),
    projectionTimingBaselineResolver: async () => ({
      schema_version: 1,
      config_version: 1,
      base_min_story_days: 16,
      base_max_story_days: 20,
      variance_ratio: 0.1,
      variance_cap_story_days: 3,
      total_adjustment_cap_story_days: 3,
    }),
    projectionTimingRandom: () => {
      rngCalls += 1;
      return 1;
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  await fixture.runtime.refreshProjection();

  const debug = (await fixture.runtime.collectActiveBusinessData({includeDebug: true})).debug;
  const pipeline = debug.nsfw_pipeline_diagnostics;
  const creation = pipeline.execution_trace.stages.find(stage =>
    stage.stage === "TIMING_INSTANCE_CREATION"
    && stage.execution_status === "SUCCEEDED"
    && stage.reason_code === "TIMING_INSTANCE_PERSISTED",
  );
  assert.equal(rngCalls, 1);
  assert.ok(creation, JSON.stringify(pipeline.execution_trace.stages));
  assert.equal(creation.rng_source, "RUNTIME_INJECTED_RNG");
  assert.equal(creation.sampled_offset_source, "INITIAL_RANDOM_SAMPLE");
  assert.equal(creation.frozen_offset_status, "FROZEN_ON_CREATION");
  assert.equal(creation.sampled_individual_offset_story_days, 1.8);
  assert.equal(creation.total_adjustment_story_days, 1.8);
  assert.equal(creation.effective_min_story_days, 17.8);
  assert.equal(creation.effective_max_story_days, 21.8);
  assert.equal(pipeline.current_state.projection_rules_count, 0);
  assert.equal(pipeline.current_state.timing_instance_count, 1);
  fixture.runtime.destroy();
});

test("rules=[] still generate a built-in Projection without Projection AI", async () => {
  let projectionAiCalls = 0;
  const projectionFixtureOptions = projectionDiagnosticsFixtureOptions({
    eventId: "nsfw-empty-rules-success",
    projectionRules: [],
  });
  projectionFixtureOptions.reliableStoryTime = false;
  projectionFixtureOptions.messages = [{
    ...projectionFixtureOptions.messages[0],
    story_time: {
      display: "羲和1年3月30日 巳时中",
      normalized: "cn-1-3-30T09:00",
      day_index: 30,
      calendar_id: "main",
      precision: "minute",
      confidence: 1,
    },
  }];
  const fixture = createFixture({
    ...projectionFixtureOptions,
    analyzer: {
      async analyzeWorldModel() {
        return normalizeWorldModel({
          schema_version: 1,
          species: [{name: "species-a", biological_types: [{name: "type-a", capabilities: {can_carry_pregnancy: true}}]}],
          projection_rules: [],
        });
      },
      async analyzeFloor() {
        return {events: [eventResult("nsfw-empty-rules-success", {
          story_time: {
            display: "羲和1年3月1日 巳时中",
            normalized: "cn-1-3-1T09:00",
            day_index: 1,
            calendar_id: "main",
            precision: "minute",
            confidence: 1,
          },
          pregnancy_relevance: {
            ...eventResult("nsfw-empty-rules-success").pregnancy_relevance,
            reproductive_mechanism: {kind: "fertilization"},
          },
        })]};
      },
      async generateProjection() {
        projectionAiCalls += 1;
        throw new Error("PROJECTION_AI_MUST_NOT_RUN_WITHOUT_RULES");
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  await fixture.runtime.refreshProjection();

  const debug = (await fixture.runtime.collectActiveBusinessData({includeDebug: true})).debug;
  const pipeline = debug.nsfw_pipeline_diagnostics;
  const timingInstance = debug.lifecycle_runtime.projection_timing.timing_instances[0];
  const timingDiagnostic = debug.timing_diagnostics.find(item => item.timing_instance_id === timingInstance.timing_instance_id);
  const aggregationDiagnostic = debug.aggregation_diagnostics.find(item => item.aggregation_status === "SUCCEEDED");
  assert.equal(pipeline.current_state.projection_rules_count, 0);
  assert.equal(pipeline.current_state.timing_instance_count, 1);
  assert.equal(pipeline.current_state.participant_aggregation_count, 1);
  assert.equal(timingInstance.world_rule_binding, null);
  const trackingWindow = debug.tracking_window.windows.find(window => window.subject_id === timingInstance.subject_id && window.mechanism_key === timingInstance.mechanism_key);
  assert.equal(timingDiagnostic.tracking_window_cycle_id, trackingWindow.cycle_id);
  assert.equal(timingDiagnostic.final_cycle_id, timingInstance.cycle_id);
  assert.equal(timingDiagnostic.cycle_id_consistent, trackingWindow.cycle_id === timingInstance.cycle_id);
  assert.equal(timingDiagnostic.cycle_id_consistency_reason_code, trackingWindow.cycle_id === timingInstance.cycle_id ? "TRACKING_WINDOW_CYCLE_MATCH" : "TRACKING_WINDOW_CYCLE_MISMATCH");
  assert.equal(timingDiagnostic.first_exposure_event_id, timingInstance.source_event_ids[0]);
  assert.deepEqual(timingDiagnostic.candidate_exposure_event_ids, timingInstance.source_event_ids);
  assert.ok(["CREATED", "REUSED"].includes(timingDiagnostic.timing_instance_resolution));
  assert.equal(timingDiagnostic.timing_instance_readback_attempted, true);
  assert.equal(timingDiagnostic.timing_instance_readback_succeeded, true);
  assert.equal(timingDiagnostic.timing_instance_readback_result_present, true);
  assert.equal(aggregationDiagnostic.cycle_id, timingInstance.cycle_id);
  assert.equal(aggregationDiagnostic.aggregation_trigger_status, "already_succeeded");
  assert.equal(aggregationDiagnostic.aggregation_due, true);
  assert.equal(aggregationDiagnostic.aggregation_overdue, false);
  assert.equal(aggregationDiagnostic.readback_attempted, true);
  assert.equal(aggregationDiagnostic.readback_succeeded, true);
  assert.equal(aggregationDiagnostic.readback_result_present, true);
  assert.equal(pipeline.projection_diagnostics.projection_rules_available, false);
  assert.equal(pipeline.current_state.projection_count, 4);
  assert.equal(pipeline.projection_diagnostics.projection_candidate_status, "candidate_available");
  assert.equal(pipeline.projection_diagnostics.projection_candidate_source, "built_in_pre_confirmation");
  assert.equal(pipeline.projection_diagnostics.projection_ai_request_started, false);
  assert.equal(projectionAiCalls, 0);
  assert.ok(pipeline.execution_trace.stages.some(stage =>
    stage.stage === "TIMING_INSTANCE_CREATION" &&
    stage.execution_status === "SUCCEEDED" &&
    stage.reason_code === "TIMING_INSTANCE_PERSISTED",
  ));
  assert.ok(pipeline.execution_trace.stages.some(stage =>
    stage.stage === "AGGREGATION_PERSISTENCE" &&
    stage.execution_status === "SUCCEEDED" &&
    stage.reason_code === "AGGREGATION_PERSISTED",
  ));
  const successfulPersistenceStages = pipeline.execution_trace.stages.filter(stage =>
    ["TIMING_INSTANCE_CREATION", "AGGREGATION_PERSISTENCE"].includes(stage.stage) &&
    stage.execution_status === "SUCCEEDED" &&
    stage.reason_code.endsWith("PERSISTED"),
  );
  assert.equal(new Set(successfulPersistenceStages.map(stage => stage.run_id)).size, 1);
  assert.equal(pipeline.derived_diagnostic.projection_rules_effect, "NO_RULES_NO_TIMING_BLOCK");
  fixture.runtime.destroy();
});

test("numeric host message_id preserves the full Timing and Aggregation chain", async () => {
  const base = projectionDiagnosticsFixtureOptions({
    eventId: "nsfw-numeric-host-floor-version",
    projectionRules: [],
  });
  const messages = [
    ...Array.from({length: 70}, (_, index) => ({message_id: index, floor: index, content: `历史用户消息 ${index}`, role: "user"})),
    {message_id: 70, floor: 70, content: "当前剧情", role: "assistant"},
  ];
  const fixture = createFixture({...base, messages});
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  await fixture.runtime.refreshProjection();

  const debug = (await fixture.runtime.collectActiveBusinessData({includeDebug: true})).debug;
  const pipeline = debug.nsfw_pipeline_diagnostics;
  const timingInstance = debug.lifecycle_runtime.projection_timing.timing_instances[0];
  assert.equal(debug.target.floor_version.message_id, 70);
  assert.equal(timingInstance.created_at_floor_version.message_id, 70);
  assert.equal(pipeline.current_state.timing_instance_count, 1);
  assert.equal(pipeline.current_state.participant_aggregation_count, 1);
  assert.ok(pipeline.execution_trace.stages.some(stage =>
    stage.stage === "TIMING_INSTANCE_CREATION" &&
    stage.execution_status === "SUCCEEDED" &&
    stage.reason_code === "TIMING_INSTANCE_PERSISTED",
  ));
  assert.ok(pipeline.execution_trace.stages.some(stage =>
    stage.stage === "AGGREGATION_PERSISTENCE" &&
    stage.execution_status === "SUCCEEDED" &&
    stage.reason_code === "AGGREGATION_PERSISTED",
  ));
  fixture.runtime.destroy();
});

test("rules=[] with invalid character timing and no baseline does not create a Timing Instance", async () => {
  const fixture = createFixture({
    ...projectionDiagnosticsFixtureOptions({
      eventId: "nsfw-empty-rules-invalid-config",
      projectionRules: [],
    }),
    projectionTimingConfigResolver: async () => ({
      schema_version: 1,
      config_version: 1,
      base_min_story_days: 10,
      base_max_story_days: 16,
      variance_ratio: Infinity,
      variance_cap_story_days: 0,
      total_adjustment_cap_story_days: 0,
    }),
    projectionTimingBaselineResolver: async () => null,
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const result = await fixture.runtime.refreshProjection();

  assert.equal(result.status, "failed");
  const debug = (await fixture.runtime.collectActiveBusinessData({includeDebug: true})).debug;
  const pipeline = debug.nsfw_pipeline_diagnostics;
  assert.equal(pipeline.current_state.timing_instance_count, 0);
  assert.equal(pipeline.current_state.participant_aggregation_count, 0);
  assert.ok(pipeline.execution_trace.stages.some(stage =>
    stage.stage === "TIMING_CONFIGURATION_RESOLUTION" &&
    stage.execution_status === "FAILED" &&
    stage.reason_code === "TIMING_CONFIG_INVALID",
  ));
  assert.ok(pipeline.execution_trace.stages.every(stage =>
    stage.stage !== "TIMING_INSTANCE_CREATION" || stage.execution_status !== "SUCCEEDED",
  ));
  fixture.runtime.destroy();
});

test("NSFW timing diagnostics identify reuse without resampling a frozen instance", async () => {
  const fixture = createFixture(projectionDiagnosticsFixtureOptions({
    eventId: "nsfw-timing-reuse",
    projectionRules: [],
  }));
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  await fixture.runtime.refreshProjection();
  const firstDebug = (await fixture.runtime.collectActiveBusinessData({includeDebug: true})).debug;
  const firstInstance = firstDebug.lifecycle_runtime.projection_timing.timing_instances[0];
  assert.ok(firstInstance);

  await fixture.runtime.refreshProjection();
  const secondDebug = (await fixture.runtime.collectActiveBusinessData({includeDebug: true})).debug;
  const secondInstance = secondDebug.lifecycle_runtime.projection_timing.timing_instances[0];
  const secondTiming = secondDebug.timing_diagnostics.find(item => item.timing_instance_id === secondInstance.timing_instance_id);
  const currentRunId = secondDebug.nsfw_pipeline_diagnostics.execution_trace.current_run_id;
  const currentStages = secondDebug.nsfw_pipeline_diagnostics.execution_trace.stages.filter(stage => stage.run_id === currentRunId);
  assert.equal(secondInstance.timing_instance_id, firstInstance.timing_instance_id);
  assert.equal(secondInstance.sampled_individual_offset_story_days, firstInstance.sampled_individual_offset_story_days);
  assert.equal(secondTiming.timing_instance_resolution, "REUSED");
  const reuseStage = currentStages.find(stage =>
    stage.stage === "TIMING_INSTANCE_CREATION" && stage.reason_code === "TIMING_INSTANCE_EXISTS",
  );
  assert.ok(reuseStage);
  assert.equal(reuseStage.sampled_offset_source, "FROZEN_SNAPSHOT");
  assert.equal(reuseStage.frozen_offset_status, "PRESERVED");
  assert.equal(reuseStage.rng_source, null);
  fixture.runtime.destroy();
});

test("same-cycle Exposures share one Timing Instance and one Aggregation basis", async () => {
  const first = eventResult("nsfw-same-cycle-first", {
    pregnancy_relevance: {
      ...eventResult("nsfw-same-cycle-first").pregnancy_relevance,
      reproductive_mechanism: {kind: "fertilization"},
    },
  });
  const secondSource = eventResult("nsfw-same-cycle-second");
  const second = {
    ...secondSource,
    participants: [
      {...secondSource.participants[0], mention_id: first.pregnancy_relevance.gestational_subject_ids[0]},
      {...secondSource.participants[1], mention_id: "nsfw-same-cycle-source"},
    ],
    pregnancy_relevance: {
      ...first.pregnancy_relevance,
      counterpart_ids: ["nsfw-same-cycle-source"],
    },
  };
  const fixture = createFixture(projectionDiagnosticsFixtureOptions({
    events: [first, second],
    projectionRules: [],
    eventId: "nsfw-same-cycle-first",
  }));
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  await fixture.runtime.refreshProjection();

  const debug = (await fixture.runtime.collectActiveBusinessData({includeDebug: true})).debug;
  const timingInstances = debug.lifecycle_runtime.projection_timing.timing_instances;
  const aggregations = debug.lifecycle_runtime.participant_aggregation.aggregations;
  const currentEventIds = debug.event_state.events.map(item => item.event_id);
  assert.equal(timingInstances.length, 1);
  assert.equal(aggregations.length, 1);
  assert.equal(currentEventIds.length, 2);
  assert.deepEqual(timingInstances[0].source_event_ids.sort(), currentEventIds.sort());
  assert.deepEqual(aggregations[0].accepted_exposure_event_ids.sort(), currentEventIds.sort());
  const timingDiagnostic = debug.timing_diagnostics.find(item => item.timing_instance_id === timingInstances[0].timing_instance_id);
  const aggregationDiagnostic = debug.aggregation_diagnostics.find(item => item.aggregation_id === aggregations[0].aggregation_id);
  const trackingWindow = debug.tracking_window.windows.find(window => window.subject_id === timingInstances[0].subject_id && window.mechanism_key === timingInstances[0].mechanism_key);
  assert.equal(timingDiagnostic.tracking_window_cycle_id, trackingWindow.cycle_id);
  assert.equal(timingDiagnostic.final_cycle_id, timingInstances[0].cycle_id);
  assert.equal(timingDiagnostic.cycle_id_consistent, trackingWindow.cycle_id === timingInstances[0].cycle_id);
  assert.equal(timingDiagnostic.cycle_id_consistency_reason_code, trackingWindow.cycle_id === timingInstances[0].cycle_id ? "TRACKING_WINDOW_CYCLE_MATCH" : "TRACKING_WINDOW_CYCLE_MISMATCH");
  assert.ok(currentEventIds.includes(timingDiagnostic.first_exposure_event_id));
  assert.deepEqual(timingDiagnostic.candidate_exposure_event_ids.sort(), currentEventIds.sort());
  assert.deepEqual(aggregationDiagnostic.candidate_exposure_event_ids.sort(), currentEventIds.sort());
  assert.deepEqual(aggregationDiagnostic.accepted_exposure_event_ids.sort(), currentEventIds.sort());
  assert.equal(aggregationDiagnostic.cycle_id_consistent, trackingWindow.cycle_id === timingInstances[0].cycle_id);
  fixture.runtime.destroy();
});

test("successful Aggregation keeps later Exposure out of the frozen Timing and Aggregation basis", async () => {
  const seed = await seededLifecycleRecoveryFloor({
    eventId: "post-aggregation-frozen-source",
    existingTiming: true,
    existingAggregation: true,
  });
  const subjectId = "char_000001";
  const sourceId = "char_000002";
  const canonicalEvent = {
    ...seed.event,
    participants: seed.event.participants.map((participant, index) => ({
      ...participant,
      identity_status: "existing",
      character_id: index === 0 ? subjectId : sourceId,
      mention_id: null,
    })),
    pregnancy_relevance: {
      ...seed.event.pregnancy_relevance,
      gestational_subject_ids: [subjectId],
      counterpart_ids: [sourceId],
    },
  };
  const canonicalTiming = resolveProjectionTimingInstance({
    chatId: seed.version.chat_id,
    subjectId,
    mechanismKey: "fertilization",
    firstEvent: canonicalEvent,
    config: LIFECYCLE_RECOVERY_TIMING_CONFIG,
    floorVersion: seed.version,
    rng: () => 1,
  });
  const canonicalAggregation = normalizeParticipantAggregation({
    aggregation_id: buildParticipantAggregationId({
      cycleId: canonicalTiming.cycle_id,
      timingInstanceId: canonicalTiming.timing_instance_id,
    }),
    subject_id: subjectId,
    pregnancy_id: null,
    mechanism_key: "fertilization",
    cycle_id: canonicalTiming.cycle_id,
    timing_instance_id: canonicalTiming.timing_instance_id,
    aggregation_trigger_strategy: "at_effective_min",
    reference_story_time: canonicalTiming.reference_story_time,
    aggregation_story_time: seed.message.story_time,
    elapsed_story_days: 20,
    effective_min_story_days: canonicalTiming.effective_min_story_days,
    effective_max_story_days: canonicalTiming.effective_max_story_days,
    sampled_individual_offset_story_days: canonicalTiming.sampled_individual_offset_story_days,
    config_snapshot: canonicalTiming.config_snapshot,
    accepted_exposure_event_ids: [canonicalEvent.event_id],
    source_basis_refs: canonicalTiming.source_basis_refs,
    created_at_floor_version: seed.version,
    created_at: "2026-01-21T00:00:00.000Z",
  });
  seed.event = canonicalEvent;
  seed.timing = canonicalTiming;
  seed.message.extra.bioweave.events = [canonicalEvent];
  seed.message.extra.bioweave.projection_timing_snapshot = {schema_version: 1, items: [canonicalTiming]};
  seed.message.extra.bioweave.participant_aggregation_snapshot = {schema_version: 1, items: [canonicalAggregation]};
  seed.message.extra.bioweave.character_registry = {
    schema_version: 1,
    entities: {
      [subjectId]: {character_id: subjectId, display_name: "Alice", aliases: []},
      [sourceId]: {character_id: sourceId, display_name: "Bob", aliases: []},
    },
  };
  const laterSource = eventResult("post-aggregation-later-source");
  const later = {
    ...laterSource,
    source: seed.version,
    story_time: {
      display: "2026-01-08",
      normalized: "2026-01-08",
      calendar_id: null,
      precision: "day",
      confidence: 1,
    },
    participants: [
      {...laterSource.participants[0], identity_status: "existing", character_id: subjectId, mention_id: subjectId},
      {...laterSource.participants[1], identity_status: "existing", character_id: sourceId, mention_id: sourceId},
    ],
    pregnancy_relevance: {
      ...seed.event.pregnancy_relevance,
      counterpart_ids: [sourceId],
    },
  };
  const fixture = createFixture({
    messages: [seed.message, {message_id: "post-aggregation-target", floor: 21, content: "后续剧情", role: "assistant", story_time: {display: "2026-01-21", normalized: "2026-01-21", calendar_id: null, precision: "day", confidence: 1}}],
    analyzer: {
      async analyzeWorldModel() {
        return normalizeWorldModel({
          schema_version: 1,
          species: [{name: "species-a", biological_types: [{name: "type-a", capabilities: {can_carry_pregnancy: true}}]}],
          projection_rules: [],
        });
      },
      async analyzeFloor({analysisInput}) {
        return {events: [seed.event, later]};
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const debug = (await fixture.runtime.collectActiveBusinessData({includeDebug: true})).debug;
  const timing = debug.lifecycle_runtime.projection_timing.timing_instances.find(item => item.timing_instance_id === seed.timing.timing_instance_id);
  const aggregation = debug.lifecycle_runtime.participant_aggregation.aggregations.find(item => item.aggregation_id === buildParticipantAggregationId({cycleId: seed.timing.cycle_id, timingInstanceId: seed.timing.timing_instance_id}));
  const boundary = debug.lifecycle_runtime.observation_boundary.aggregations.find(item => item.aggregation_id === aggregation.aggregation_id);
  assert.deepEqual(timing.source_event_ids, [seed.event.event_id]);
  assert.deepEqual(aggregation.accepted_exposure_event_ids, [seed.event.event_id]);
  assert.equal((debug.tracking_window.windows.find(window => window.cycle_id === seed.timing.cycle_id)?.source_event_ids ?? []).includes(later.event_id), false);
  assert.equal(boundary.mechanism_key, "fertilization");
  assert.deepEqual(boundary.reference_story_time, seed.timing.reference_story_time);
  assert.equal(boundary.excluded_after_aggregation_event_ids.length, 1);
  assert.notEqual(boundary.excluded_after_aggregation_event_ids[0], seed.event.event_id);
  assert.equal(boundary.excluded_after_aggregation_reason, "POST_AGGREGATION_CYCLE_FROZEN");
  assert.equal(boundary.timeout_status, "due/overdue_not_released");
  fixture.runtime.destroy();
});

test("NSFW timing diagnostics preserve unresolved Story Time without inventing elapsed days", async () => {
  const fixture = createFixture(projectionDiagnosticsFixtureOptions({
    eventId: "nsfw-unresolved-story-time",
    reliableStoryTime: false,
  }));
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  await fixture.runtime.refreshProjection();

  const debug = (await fixture.runtime.collectActiveBusinessData({includeDebug: true})).debug;
  const timing = debug.timing_diagnostics.find(item => item.timing_instance_exists);
  assert.equal(timing.timing_instance_exists, true);
  assert.equal(Object.hasOwn(timing, 'elapsed_story_days'), false);
  assert.equal(timing.story_time_reason_code, "story_time_unresolved");
  assert.equal(debug.nsfw_pipeline_diagnostics.current_state.participant_aggregation_count, 0);
  assert.ok(debug.aggregation_diagnostics.every(item => item.aggregation_reason_code !== "TIMING_INSTANCE_MISSING"));
  fixture.runtime.destroy();
});

test("NSFW pipeline diagnostics distinguish Aggregation calculation from persistence failure", async () => {
  const fixture = createFixture(projectionDiagnosticsFixtureOptions({
    eventId: "nsfw-aggregation-persist-failure",
    saveFloorHook: async ({value}) => {
      if (value?.participant_aggregation_snapshot?.items?.length) {
        const error = new Error("AGGREGATION_STORAGE_UNAVAILABLE");
        error.code = "AGGREGATION_STORAGE_UNAVAILABLE";
        throw error;
      }
    },
  }));
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const result = await fixture.runtime.refreshProjection();
  assert.equal(result.status, "failed");

  const debug = (await fixture.runtime.collectActiveBusinessData({includeDebug: true})).debug;
  const pipeline = debug.nsfw_pipeline_diagnostics;
  const runId = pipeline.execution_trace.current_run_id;
  const stages = pipeline.execution_trace.stages.filter(stage => stage.run_id === runId);
  const aggregationPersistenceStage = [...pipeline.execution_trace.stages].reverse().find(stage =>
    stage.stage === "AGGREGATION_PERSISTENCE" && stage.error_code === "AGGREGATION_STORAGE_UNAVAILABLE",
  );
  assert.ok(stages.some(stage =>
    stage.stage === "PARTICIPANT_AGGREGATION_EXECUTION" && stage.execution_status === "SUCCEEDED",
  ));
  assert.equal(aggregationPersistenceStage?.execution_status, "PERSIST_FAILED");
  assert.equal(aggregationPersistenceStage?.error_code, "AGGREGATION_STORAGE_UNAVAILABLE");
  assert.equal(pipeline.derived_diagnostic.current_blocking_stage, "AGGREGATION_PERSISTENCE");
  assert.equal(pipeline.derived_diagnostic.current_blocking_reason_code, "AGGREGATION_PERSISTENCE_FAILED");
  assert.equal(debug.nsfw_pipeline_diagnostics.current_state.participant_aggregation_count, 0);
  const aggregationDiagnostic = debug.aggregation_diagnostics.find(item => item.aggregation_status === "PERSIST_FAILED");
  assert.equal(aggregationDiagnostic.aggregation_status, "PERSIST_FAILED");
  assert.equal(aggregationDiagnostic.persistence_attempted, true);
  assert.equal(aggregationDiagnostic.persistence_succeeded, false);
  assert.equal(aggregationDiagnostic.readback_succeeded, true);
  assert.equal(aggregationDiagnostic.readback_result_present, false);
  fixture.runtime.destroy();
});

test("NSFW pipeline diagnostics identify the first real Timing persistence blocker", async () => {
  const exposure = eventResult("nsfw-success-path", {
    pregnancy_relevance: {
      ...eventResult("nsfw-success-path").pregnancy_relevance,
      reproductive_mechanism: {kind: "fertilization"},
    },
  });
  const ruleContent = {
    schema_version: 1,
    mechanism_key: "fertilization",
    development_concern_key: "participant-list",
    development_kind: "possible_detection",
    trigger: {kind: "immediate_after_event", source_event_type: "sexual_activity"},
    requirements: {capabilities: [], source_compatibility: "not_required", contributor_relationships: []},
    realization: null,
    contradiction: null,
    expiration: null,
  };
  const timingConfig = {
    schema_version: 1,
    config_version: 1,
    base_min_story_days: 0,
    base_max_story_days: 42,
    variance_ratio: 0,
    variance_cap_story_days: 0,
    total_adjustment_cap_story_days: 0,
  };
  const fixture = createFixture({
    reliableStoryTime: true,
    projectionTimingBaselineResolver: async () => timingConfig,
    analyzer: {
      async analyzeWorldModel() {
        return normalizeWorldModel({
          schema_version: 1,
          species: [{name: "species-a", biological_types: [{name: "type-a", capabilities: {can_carry_pregnancy: true}}]}],
          projection_rules: [ruleContent],
        });
      },
      async analyzeFloor() {
        return {events: [exposure]};
      },
      async generateProjection() {
        return {development: {kind: "possible_detection", description: "诊断成功路径测试。"}};
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  await fixture.runtime.refreshProjection();

  const debug = (await fixture.runtime.collectActiveBusinessData({includeDebug: true})).debug;
  const pipeline = debug.nsfw_pipeline_diagnostics;
  assert.equal(pipeline.current_state.projection_rules_count, 1);
  assert.equal(pipeline.current_state.tracking_window_status_counts.open, 1);
  assert.equal(pipeline.current_state.timing_instance_count, 1);
  assert.equal(pipeline.current_state.participant_aggregation_count, 1);
  const runId = pipeline.execution_trace.current_run_id;
  const stages = pipeline.execution_trace.stages.filter(stage => stage.run_id === runId);
  assert.ok(stages.some(stage => stage.stage === "TIMING_CONFIGURATION_RESOLUTION" && stage.execution_status === "SUCCEEDED"));
  assert.ok(stages.some(stage => stage.stage === "TIMING_INSTANCE_CREATION" && stage.execution_status === "SUCCEEDED"));
  assert.ok(stages.some(stage => stage.stage === "AGGREGATION_PERSISTENCE" && stage.execution_status === "SUCCEEDED"));
  assert.notEqual(pipeline.derived_diagnostic.current_blocking_stage, "TIMING_INSTANCE_CREATION");
  assert.notEqual(pipeline.derived_diagnostic.current_blocking_reason_code, "TIMING_PERSISTENCE_FAILED");
  assert.notEqual(pipeline.derived_diagnostic.current_blocking_reason_code, "TIMING_INSTANCE_MISSING");
  fixture.runtime.destroy();
});

test("business data rejects a Swipe change during one refresh", async () => {
  let mutate;
  const fixture = createFixture({
    messages: [{
      message_id: "business-swipe-target",
      floor: 35,
      swipes: ["Swipe A", "Swipe B"],
      swipe_info: [{}, {}],
      swipe_id: 0,
      role: "assistant",
    }],
    storyTimeDebug: true,
    storyTimeTrace: () => mutate?.(),
  });
  let changed = false;
  let armed = false;
  mutate = () => {
    if (!armed || changed) return;
    changed = true;
    fixture.context.chat[0].swipe_id = 1;
  };
  await fixture.runtime.init();
  armed = true;
  await assert.rejects(
    fixture.runtime.collectActiveBusinessData(),
    error => error.code === "STALE_FLOOR_VERSION",
  );
  fixture.runtime.destroy();
});

test("business data rejects an edited target message during one refresh", async () => {
  let mutate;
  const fixture = createFixture({
    messages: [{message_id: "business-edit-target", floor: 35, content: "旧正文", role: "assistant"}],
    storyTimeDebug: true,
    storyTimeTrace: () => mutate?.(),
  });
  let changed = false;
  let armed = false;
  mutate = () => {
    if (!armed || changed) return;
    changed = true;
    fixture.context.chat[0].content = "新正文";
  };
  await fixture.runtime.init();
  armed = true;
  await assert.rejects(
    fixture.runtime.collectActiveBusinessData(),
    error => error.code === "STALE_FLOOR_VERSION",
  );
  fixture.runtime.destroy();
});

test("business data rejects a deleted target Floor during one refresh", async () => {
  let mutate;
  const fixture = createFixture({
    messages: [{message_id: "business-delete-target", floor: 35, content: "待删除楼层", role: "assistant"}],
    storyTimeDebug: true,
    storyTimeTrace: () => mutate?.(),
  });
  let changed = false;
  let armed = false;
  mutate = () => {
    if (!armed || changed) return;
    changed = true;
    fixture.context.chat.splice(0, 1);
  };
  await fixture.runtime.init();
  armed = true;
  await assert.rejects(
    fixture.runtime.collectActiveBusinessData(),
    error => error.code === "STALE_FLOOR_VERSION",
  );
  fixture.runtime.destroy();
});

test("business refresh reuses the target complete Event state for derived data", async () => {
  const message = {
    message_id: "event-state-reuse",
    floor: 0,
    content: "当前剧情",
    role: "assistant",
  };
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
      analysis: {status: "success", floor_version: version},
      events: [eventResult("reused-event", {source: version})],
    },
  };
  const fixture = createFixture({messages: [message]});
  const originalGetActiveFloorEvents = fixture.runtime.store.getActiveFloorEvents;
  let activeEventReads = 0;
  fixture.runtime.store.getActiveFloorEvents = (...args) => {
    activeEventReads += 1;
    return originalGetActiveFloorEvents(...args);
  };

  await fixture.runtime.collectActiveBusinessData();

  assert.equal(activeEventReads, 2);
  fixture.runtime.destroy();
});

test("concurrent business reads share one canonical build and isolate returned data", async () => {
  const rawTrace = [];
  const fixture = createFixture({
    notify: event => {
      if (event?.type === "BIOWEAVE_PERSISTENCE_TRACE") rawTrace.push(event.payload);
    },
    messages: Array.from({length: 24}, (_, index) => ({
      message_id: `canonical-build-concurrent-${index}`,
      floor: index,
      content: `当前剧情 ${index}`,
      role: "assistant",
    })),
  });
  await fixture.runtime.init();
  const traceStart = fixture.runtime.getPersistenceTrace().sequence.length;
  const rawTraceStart = rawTrace.length;

  const originalDigest = globalThis.crypto?.subtle?.digest;
  if (typeof originalDigest !== "function") {
    fixture.runtime.destroy();
    return;
  }
  globalThis.crypto.subtle.digest = async function delayedDigest(...args) {
    await new Promise(resolve => setTimeout(resolve, 2));
    return originalDigest.call(this, ...args);
  };
  let first;
  let second;
  try {
    [first, second] = await Promise.all([
      fixture.runtime.collectActiveBusinessData({reason: "manual-analysis", analysisPhase: "concurrent-read-test"}),
      fixture.runtime.collectActiveBusinessData({reason: "canonical-readiness", analysisPhase: "concurrent-read-test"}),
    ]);
  } finally {
    globalThis.crypto.subtle.digest = originalDigest;
  }
  const buildTrace = fixture.runtime.getPersistenceTrace().sequence.slice(traceStart).filter(item =>
    String(item.stage ?? "").startsWith("CHARACTER_CANONICAL_BUILD_"));

  assert.equal(buildTrace.filter(item => item.stage === "CHARACTER_CANONICAL_BUILD_STARTED").length, 1);
  assert.equal(buildTrace.filter(item => item.stage === "CHARACTER_CANONICAL_BUILD_JOINED_EXISTING").length, 1);
  assert.equal(buildTrace.filter(item => item.stage === "CHARACTER_CANONICAL_BUILD_COMPLETED").length, 1);
  assert.equal(buildTrace.filter(item => item.stage === "CHARACTER_CANONICAL_BUILD_JOIN_COMPLETED").length, 1);
  const rawBuildTrace = rawTrace.slice(rawTraceStart).filter(item =>
    String(item.stage ?? "").startsWith("CHARACTER_CANONICAL_BUILD_"));
  const observedGeneration = rawBuildTrace[0]?.canonical_generation;
  assert.ok(rawBuildTrace.every(item => item.canonical_generation === observedGeneration));
  assert.ok(buildTrace.some(item => Number.isFinite(item.join_wait_ms)));

  second.active_events.push({event_id: "caller-local-mutation"});
  assert.equal(first.active_events.some(event => event?.event_id === "caller-local-mutation"), false);
  fixture.runtime.destroy();
});

test("completed canonical reads reuse the exact Floor generation and invalidate after derived commits", async () => {
  const rawTrace = [];
  const seed = await seededLifecycleRecoveryFloor({eventId: "completed-canonical-cache"});
  const fixture = createFixture({
    reliableStoryTime: false,
    messageLookupById: true,
    messages: [seed.message],
    notify: event => {
      if (event?.type === "BIOWEAVE_PERSISTENCE_TRACE") rawTrace.push(event.payload);
    },
    analyzer: {
      async analyzeWorldModel() {
        throw new Error("WORLD_AI_MUST_NOT_RUN_DURING_CANONICAL_CACHE_TEST");
      },
      async analyzeFloor() {
        throw new Error("EVENT_AI_MUST_NOT_RUN_DURING_CANONICAL_CACHE_TEST");
      },
      async generateProjection() {
        throw new Error("PROJECTION_AI_MUST_NOT_RUN_DURING_CANONICAL_CACHE_TEST");
      },
    },
  });

  await fixture.runtime.init();
  const traceStart = rawTrace.length;
  await fixture.runtime.collectActiveBusinessData({reason: "completed-cache-first", analysisPhase: "completed-cache-test"});
  await fixture.runtime.collectActiveBusinessData({reason: "completed-cache-second", analysisPhase: "completed-cache-test"});

  const readsAfterReuse = rawTrace.slice(traceStart);
  assert.equal(readsAfterReuse.filter(item => item.stage === "CHARACTER_CANONICAL_PHASES").length, 1);
  assert.equal(readsAfterReuse.filter(item => item.stage === "CHARACTER_CANONICAL_BUILD_CACHE_HIT").length, 1);

  const beforeForcedRead = rawTrace.length;
  await fixture.runtime.collectActiveBusinessData({
    reason: "forced-boundary-read",
    analysisPhase: "completed-cache-test",
    force: true,
  });
  const forcedRead = rawTrace.slice(beforeForcedRead);
  assert.ok(forcedRead.some(item => item.stage === "CHARACTER_CANONICAL_PHASES"));
  assert.equal(forcedRead.filter(item => item.stage === "CHARACTER_CANONICAL_BUILD_CACHE_HIT").length, 0);

  const currentEvents = await fixture.runtime.getCurrentFloorEvents();
  await fixture.runtime.updateEvent(currentEvents[0].event_id, {location: "canonical-cache-generation-bump"});
  await fixture.runtime.collectActiveBusinessData({reason: "completed-cache-after-commit", analysisPhase: "completed-cache-test"});

  const readsAfterCommit = rawTrace.slice(traceStart);
  assert.ok(readsAfterCommit.filter(item => item.stage === "CHARACTER_CANONICAL_PHASES").length >= 2);
  fixture.runtime.destroy();
});

test("canonical generation changes only after a derived Floor commit, not a read-only Tracking refresh", async () => {
  const rawTrace = [];
  const fixture = createFixture({
    notify: event => {
      if (event?.type === "BIOWEAVE_PERSISTENCE_TRACE") rawTrace.push(event.payload);
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeCurrentFloor({force: true});

  const beforeReads = rawTrace.length;
  await fixture.runtime.collectActiveBusinessData({includeDebug: true});
  const afterFirstRead = rawTrace.slice(beforeReads).filter(item =>
    item.stage === "CHARACTER_CANONICAL_BUILD_COMPLETED");
  assert.ok(afterFirstRead.length >= 1);
  const generationBeforeTrackingRead = afterFirstRead.at(-1).canonical_generation;

  await fixture.runtime.refreshTrackingRegistry("diagnostic-read");
  await fixture.runtime.collectActiveBusinessData({includeDebug: true});
  const afterTrackingRead = rawTrace.slice(beforeReads).filter(item =>
    item.stage === "CHARACTER_CANONICAL_BUILD_COMPLETED");
  assert.equal(afterTrackingRead.at(-1).canonical_generation, generationBeforeTrackingRead);

  const currentEvents = await fixture.runtime.getCurrentFloorEvents();
  await fixture.runtime.updateEvent(currentEvents[0].event_id, {location: "generation-bump"});
  await fixture.runtime.collectActiveBusinessData({includeDebug: true});
  const afterCommit = rawTrace.slice(beforeReads).filter(item =>
    item.stage === "CHARACTER_CANONICAL_BUILD_COMPLETED");
  assert.ok(afterCommit.at(-1).canonical_generation > generationBeforeTrackingRead);
  fixture.runtime.destroy();
});

test("manual supplement preserves current Floor facts omitted by the new AI result", async () => {
  let analysisCount = 0;
  const fixture = createFixture({
    reliableStoryTime: true,
    analyzer: {
      async analyzeFloor({ analysisInput }) {
        analysisCount += 1;
        if (analysisCount === 1) {
          return {
            events: [
              identityEventForCharacters(
                analysisInput.character_registry,
                "角色A",
                "来源A",
                "a-first",
              ),
              identityEventForCharacters(
                analysisInput.character_registry,
                "角色B",
                "来源B",
                "b-first",
              ),
            ],
          };
        }
        return {
          events: [
            stableContinuationEventFromInput(analysisInput, "角色B") ?? identityEventForCharacters(
              analysisInput.character_registry,
              "角色B",
              "来源B",
              "b-supplement",
            ),
          ],
        };
      },
    },
  });

  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const firstFloorEvents = structuredClone(fixture.runtime.store.getFloor(0, 0).events);
  const firstEventIdsBySubject = new Map(
    firstFloorEvents.map((storedEvent) => [
      storedEvent.participants[0].display_name,
      storedEvent.event_id,
    ]),
  );
  await fixture.runtime.refreshCurrentFloorAnalysis();

  const floor = fixture.runtime.store.getFloor(0, 0);
  assert.equal(analysisCount, 2);
  assert.deepEqual(
    floor.events.map((event) => event.participants[0].display_name).sort(),
    ["角色A", "角色B"],
  );
  assert.equal(
    floor.events.find((event) => event.participants[0].display_name === "角色B").event_id,
    firstEventIdsBySubject.get("角色B"),
    "Supplement reuses the existing Event ID for the matched fact",
  );
  assert.equal(
    floor.events.find((event) => event.participants[0].display_name === "角色A").event_id,
    firstEventIdsBySubject.get("角色A"),
    "Supplement preserves the omitted existing Event ID",
  );
  assert.deepEqual(
    Object.values(floor.character_registry.entities)
      .map((entry) => entry.display_name)
      .sort(),
    ["来源A", "来源B", "角色A", "角色B"],
  );

  const business = await fixture.runtime.collectActiveBusinessData();
  assert.deepEqual(Object.keys(business.tracking_subjects).sort(), [
    "char_000001",
    "char_000003",
  ]);
  assert.deepEqual(
    business.active_events.map((event) => event.participants[0].display_name).sort(),
    ["角色A", "角色B"],
  );
  fixture.runtime.destroy();
});

test("Supplement continuity reuses Event ID when only legacy day_index presence changes", async () => {
  let analysisCount = 0;
  const fixture = createFixture({
    reliableStoryTime: true,
    analyzer: {
      async analyzeFloor({ analysisInput }) {
        analysisCount += 1;
        const continuingEvent = analysisCount === 1
          ? identityEventForCharacters(
            analysisInput.character_registry,
            "角色A",
            "来源A",
            "same-fact",
          )
          : stableContinuationEventFromInput(analysisInput, "角色A");
        continuingEvent.story_time = analysisCount === 1
          ? {
              display: "2026-01-01",
              normalized: "2026-01-01",
              day_index: 20454,
              calendar_id: "main",
              precision: "day",
              confidence: 1,
            }
          : {
              display: "2026-01-01",
              normalized: "2026-01-01",
              day_index: null,
              calendar_id: "main",
              precision: "day",
              confidence: 1,
            };
        if (analysisCount === 1) {
          return {events: [continuingEvent]};
        }

        const updatedContinuingEvent = stableContinuationEventFromInput(analysisInput, "角色A");
        updatedContinuingEvent.story_time = {
          display: "2026-01-01",
          normalized: "2026-01-01",
          day_index: null,
          calendar_id: "main",
          precision: "day",
          confidence: 1,
        };

        const newEvent = identityEventForCharacters(
          analysisInput.character_registry,
          "角色B",
          "来源B",
          "new-fact",
        );
        newEvent.story_time = {
          display: "2026-01-02",
          normalized: "2026-01-02",
          day_index: null,
          calendar_id: "main",
          precision: "day",
          confidence: 1,
        };
        return {events: [newEvent, updatedContinuingEvent]};
      },
    },
  });

  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const first = fixture.runtime.store.getFloor(0, 0).events[0];
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const secondEvents = fixture.runtime.store.getFloor(0, 0).events;
  const second = secondEvents.find(
    (event) => event.participants[0].display_name === "角色A",
  );

  assert.equal(analysisCount, 2);
  assert.equal(secondEvents.length, 2, JSON.stringify(secondEvents.map((event) => ({
    event_id: event.event_id,
    display: event.participants?.[0]?.display_name,
    story_time: event.story_time,
  }))));
  assert.equal(second.event_id, first.event_id);
  assert.equal(second.story_time.normalized, "2026-01-01");
  assert.equal(Object.hasOwn(second.story_time, "day_index"), false);
  fixture.runtime.destroy();
});

test("Supplement continuity keeps time and calendar conflicts separate", async () => {
  const scenarios = [
    {
      name: "day-index-only legacy event",
      initial: {display: "2026-01-01", normalized: null, day_index: 20454, calendar_id: "main", precision: "day", confidence: 1},
      next: {display: "2026-01-01", normalized: null, day_index: 20454, calendar_id: "main", precision: "day", confidence: 1},
      reuse: true,
    },
    {
      name: "display-only event",
      initial: {display: "羲和元年三月四日", normalized: null, day_index: null, calendar_id: null, precision: "day", confidence: 1},
      next: {display: "羲和元年三月四日", normalized: null, day_index: null, calendar_id: null, precision: "day", confidence: 1},
      reuse: true,
    },
    {
      name: "conflicting supplied day index does not override normalized identity",
      initial: {display: "2026-01-01", normalized: "2026-01-01", day_index: 20454, calendar_id: "main", precision: "day", confidence: 1},
      next: {display: "2026-01-01", normalized: "2026-01-01", day_index: 20455, calendar_id: "main", precision: "day", confidence: 1},
      reuse: true,
    },
    {
      name: "different display with the same normalized story time",
      initial: {display: "羲和元年三月四日", normalized: "cn-1-3-4", day_index: 20454, calendar_id: "main", precision: "day", confidence: 1},
      next: {display: "Xihe year 1, month 3 day 4", normalized: "cn-1-3-4", day_index: null, calendar_id: "main", precision: "day", confidence: 1},
      reuse: true,
    },
    {
      name: "different normalized date",
      initial: {display: "2026-01-01", normalized: "2026-01-01", day_index: 20454, calendar_id: "main", precision: "day", confidence: 1},
      next: {display: "2026-01-02", normalized: "2026-01-02", day_index: null, calendar_id: "main", precision: "day", confidence: 1},
      reuse: false,
    },
    {
      name: "different calendar domain",
      initial: {display: "2026-01-01", normalized: "2026-01-01", day_index: 20454, calendar_id: "main", precision: "day", confidence: 1},
      next: {display: "2026-01-01", normalized: "2026-01-01", day_index: null, calendar_id: "custom-story", precision: "day", confidence: 1},
      reuse: false,
    },
    {
      name: "same day different time",
      initial: {display: "2026-01-01 09:00", normalized: "2026-01-01T09:00", day_index: 20454, calendar_id: "main", precision: "minute", confidence: 1},
      next: {display: "2026-01-01 10:00", normalized: "2026-01-01T10:00", day_index: null, calendar_id: "main", precision: "minute", confidence: 1},
      reuse: false,
    },
    {
      name: "different mechanism pathway",
      initial: {display: "2026-01-01", normalized: "2026-01-01", day_index: 20454, calendar_id: "main", precision: "day", confidence: 1},
      next: {display: "2026-01-01", normalized: "2026-01-01", day_index: null, calendar_id: "main", precision: "day", confidence: 1},
      initialPathway: "pathway-a",
      nextPathway: "pathway-b",
      reuse: true,
    },
  ];

  for (const scenario of scenarios) {
    let analysisCount = 0;
    const fixture = createFixture({
      reliableStoryTime: true,
      analyzer: {
        async analyzeFloor({analysisInput}) {
          analysisCount += 1;
          const event = analysisCount === 1
            ? identityEventForCharacters(
              analysisInput.character_registry,
              "角色A",
              "来源A",
              `${scenario.name}-${analysisCount}`,
            )
            : stableContinuationEventFromInput(analysisInput, "角色A") ?? identityEventForCharacters(
              analysisInput.character_registry,
              "角色A",
              "来源A",
              `${scenario.name}-${analysisCount}`,
            );
          if (scenario.initialPathway !== undefined && analysisCount > 1) {
            delete event.continuation_of_event_id;
            delete event.continuation_update;
          }
          event.story_time = analysisCount === 1 ? scenario.initial : scenario.next;
          if (scenario.initialPathway !== undefined) {
            event.pregnancy_relevance.reproductive_mechanism = {
              ...(event.pregnancy_relevance.reproductive_mechanism ?? {}),
              kind: event.pregnancy_relevance.reproductive_mechanism?.kind ?? "intravaginal_exposure",
              pathway: analysisCount === 1
                ? scenario.initialPathway
                : scenario.nextPathway ?? scenario.initialPathway,
            };
          }
          if (analysisCount === 1) return {events: [event]};
          const newEvent = identityEventForCharacters(
            analysisInput.character_registry,
            "角色B",
            "来源B",
            `${scenario.name}-new`,
          );
          newEvent.story_time = {
            display: "2026-01-02",
            normalized: "2026-01-02",
            day_index: null,
            calendar_id: "main",
            precision: "day",
            confidence: 1,
          };
          return {events: [newEvent, event]};
        },
      },
    });
    await fixture.runtime.init();
    await fixture.runtime.refreshCurrentFloorAnalysis();
    const first = fixture.runtime.store.getFloor(0, 0).events[0];
    await fixture.runtime.refreshCurrentFloorAnalysis();
    const events = fixture.runtime.store.getFloor(0, 0).events;
    const subjectEvents = events.filter(
      (event) => event.participants[0].display_name === "角色A",
    );
    assert.equal(events.length, scenario.reuse ? 2 : 3, scenario.name);
    assert.equal(subjectEvents.length, scenario.reuse ? 1 : 2, scenario.name);
    if (scenario.reuse) assert.equal(subjectEvents[0].event_id, first.event_id, scenario.name);
    else assert.notEqual(subjectEvents[0].event_id, subjectEvents[1].event_id, scenario.name);
    fixture.runtime.destroy();
  }
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

function fixtureContinuationEvent(analysisInput, event) {
  const existing = analysisInput?.existing_events?.[0];
  if (!existing) return event;
  for (const participant of existing.participants ?? []) {
    const characterId = participant?.character_id;
    if (!characterId) continue;
    analysisInput.character_registry.entities[characterId] = {
      character_id: characterId,
      display_name: participant.display_name,
      aliases: [],
    };
  }
  const existingRelevance = existing.pregnancy_relevance ?? {};
  const eventRelevance = event.pregnancy_relevance ?? {};
  const existingMechanism = existingRelevance.reproductive_mechanism ?? {};
  const eventMechanism = eventRelevance.reproductive_mechanism ?? {};
  const mergedMechanism = {...eventMechanism};
  if (existingMechanism.kind !== undefined) {
    mergedMechanism.kind = existingMechanism.kind;
  }
  return {
    ...event,
    story_time: structuredClone(existing.story_time ?? event.story_time),
    participants: (event.participants ?? []).map((participant, index) => ({
      ...participant,
      character_id: existing.participants?.[index]?.character_id ?? participant.character_id,
      event_role: existing.participants?.[index]?.event_role ?? participant.event_role,
      identity_status: "existing",
      mention_id: null,
    })),
    pregnancy_relevance: {
      ...eventRelevance,
      gestational_subject_ids: existingRelevance.gestational_subject_ids ?? eventRelevance.gestational_subject_ids,
      counterpart_ids: existingRelevance.counterpart_ids ?? eventRelevance.counterpart_ids,
      reproductive_mechanism: mergedMechanism,
    },
    continuation_of_event_id: existing.event_id,
    continuation_update: true,
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

function stableContinuationEventFromInput(analysisInput, displayName, overrides = {}) {
  const existing = (analysisInput.existing_events ?? []).find(
    (event) => event.participants?.[0]?.display_name === displayName,
  ) ?? (analysisInput.existing_events ?? [])[0];
  if (!existing) return null;
  for (const participant of existing.participants ?? []) {
    const characterId = participant.character_id;
    if (!characterId) continue;
    analysisInput.character_registry.entities[characterId] = {
      character_id: characterId,
      display_name: participant.display_name,
      aliases: [],
    };
  }
  const candidate = structuredClone(existing);
  delete candidate.event_id;
  delete candidate.source;
  candidate.participants = candidate.participants.map((participant) => ({
    ...participant,
    identity_status: "existing",
    mention_id: null,
  }));
  candidate.continuation_of_event_id = existing.event_id;
  candidate.continuation_update = true;
  return {...candidate, ...overrides};
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 30));
}

function waitForAnalysisSuccess(fixture, swipeId) {
  return new Promise((resolve) => {
    let unsubscribe = () => {};
    unsubscribe = fixture.runtime.subscribe((event) => {
      const payload = event?.payload;
      if (
        event?.type === "EVENT_ANALYSIS_STATUS_CHANGED" &&
        payload?.state === "success" &&
        payload?.floor_version?.swipe_id === swipeId
      ) {
        unsubscribe();
        resolve(payload);
      }
    });
  });
}

function waitForLifecycleSettled(fixture, mutationType) {
  return new Promise((resolve) => {
    let unsubscribe = () => {};
    unsubscribe = fixture.runtime.subscribe((event) => {
      if (
        event?.type === "BIOWEAVE_LIFECYCLE_SETTLED" &&
        (!mutationType || event.mutationType === mutationType)
      ) {
        unsubscribe();
        resolve(event);
      }
    });
  });
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
    reliableStoryTime: true,
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

test("real SillyTavern hidden Character messages remain Floor owners across append and delete", async () => {
  const messages = [
    {
      message_id: "floor-58",
      floor: 58,
      content: "已保存 World Model 的角色正文",
      is_user: false,
      is_system: true,
      extra: {},
      swipe_id: 0,
      swipes: ["已保存 World Model 的角色正文"],
      swipe_info: [{ extra: {} }],
    },
  ];
  const fixture = createFixture({ messages });
  await fixture.runtime.init();
  const version = await floorVersion({
    chatId: "chat-runtime",
    messageId: "floor-58",
    floor: 58,
    text: messages[0].content,
  });
  const worldModel = { schema_version: 1, species: [{ name: "W" }] };
  await fixture.runtime.store.saveFloor(0, 0, {
    ...emptyFloor(),
    floor_version: version,
    world_model: worldModel,
  });

  assert.deepEqual(fixture.runtime.store.getFloor(0, 0).world_model, worldModel);
  assert.equal((await fixture.runtime.resolveCurrentBioWeaveFloor()).index, 0);
  assert.deepEqual(
    (await fixture.runtime.resolveWorldModelAtOrBefore()).model,
    worldModel,
  );

  messages.push({
    message_id: "floor-59",
    floor: 59,
    content: "新增角色正文",
    is_user: false,
    is_system: true,
    extra: {},
  });
  assert.deepEqual(
    (await fixture.runtime.resolveWorldModelAtOrBefore()).model,
    worldModel,
  );

  messages.push({
    message_id: "floor-60",
    floor: 60,
    content: "再次新增角色正文",
    is_user: false,
    is_system: true,
    extra: {},
  });
  assert.deepEqual(
    (await fixture.runtime.resolveWorldModelAtOrBefore()).model,
    worldModel,
  );

  messages.splice(1, 2);
  assert.equal((await fixture.runtime.resolveCurrentBioWeaveFloor()).index, 0);
  assert.deepEqual(
    (await fixture.runtime.resolveWorldModelAtOrBefore()).model,
    worldModel,
  );
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
    reliableStoryTime: true,
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
    reliableStoryTime: true,
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

test("AI Event writes reject comparable future Story Time without dropping legal Events", async () => {
  const fixture = createFixture({
    messages: [{
      message_id: "story-time-target",
      floor: 10,
      content: "当前剧情",
      story_time: {normalized: "2026-01-10", day_index: 10, calendar_id: "main", precision: "day"},
      role: "assistant",
    }],
    analyzer: {
      async analyzeFloor() {
        return {
          events: [
            eventResult("legal-event", {story_time: {normalized: "2026-01-05", day_index: 5, calendar_id: "main", precision: "day"}}),
            eventResult("future-event", {story_time: {normalized: "2026-01-20", day_index: 20, calendar_id: "main", precision: "day"}}),
          ],
        };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeCurrentFloor();
  const events = await fixture.runtime.getCurrentFloorEvents();
  assert.deepEqual(events.map(event => event.story_time.normalized), ["2026-01-05"]);
  assert.equal(Object.hasOwn(events[0].story_time, "day_index"), false);
  fixture.runtime.destroy();
});

test("manual Event Story Time edit rejects future time and allows equal target time", async () => {
  const fixture = createFixture({
    messages: [{
      message_id: "story-time-edit",
      floor: 10,
      content: "当前剧情",
      story_time: {normalized: "2026-01-10", day_index: 10, calendar_id: "main", precision: "day"},
      role: "assistant",
    }],
    analyzer: {
      async analyzeFloor() {
        return {events: [eventResult("editable-time", {story_time: {normalized: "2026-01-05", day_index: 5, calendar_id: "main", precision: "day"}})]};
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeCurrentFloor();
  const eventId = (await fixture.runtime.getCurrentFloorEvents())[0].event_id;
  await assert.rejects(
    fixture.runtime.updateEvent(eventId, {story_time: {normalized: "2026-01-20", day_index: 20, calendar_id: "main", precision: "day"}}),
    error => error?.code === "EVENT_STORY_TIME_AFTER_CURRENT",
  );
  assert.equal(Object.hasOwn((await fixture.runtime.getCurrentFloorEvents())[0].story_time, "day_index"), false);
  await fixture.runtime.updateEvent(eventId, {story_time: {normalized: "2026-01-10", day_index: 10, calendar_id: "main", precision: "day"}});
  assert.equal(Object.hasOwn((await fixture.runtime.getCurrentFloorEvents())[0].story_time, "day_index"), false);
  fixture.runtime.destroy();
});

test("manual Event Story Time display edits rebuild all derived fields instead of retaining the old object", async () => {
  const traces = [];
  const fixture = createFixture({
    notify(event) {
      if (event?.type === "BIOWEAVE_PERSISTENCE_TRACE") traces.push(event.payload);
    },
    messages: [{
      message_id: "story-time-display-edit",
      floor: 10,
      content: "当前剧情",
      story_time: {display: "羲和1年3月20日 酉时末"},
      role: "assistant",
    }],
    analyzer: {
      async analyzeFloor() {
        return {events: [eventResult("editable-display-time", {
          story_time: {
            display: "羲和1年3月15日 酉时末",
            normalized: "cn-1-3-15T19:00",
            day_index: 123,
            calendar_id: "old-calendar",
            precision: "minute",
            confidence: 1,
          },
        })]};
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeCurrentFloor();
  const eventId = (await fixture.runtime.getCurrentFloorEvents())[0].event_id;

  await fixture.runtime.updateEvent(eventId, {
    story_time: {
      display: "羲和1年3月18日 酉时末",
      normalized: "cn-1-3-15T19:00",
      day_index: 123,
      calendar_id: "old-calendar",
      precision: "minute",
      confidence: 1,
    },
  });

  const updated = (await fixture.runtime.getCurrentFloorEvents())[0];
  assert.equal(updated.event_id, eventId);
  assert.deepEqual(updated.source, fixture.runtime.store.getFloor(0).events[0].source);
  assert.equal(updated.story_time.display, "羲和1年3月18日 酉时末");
  assert.equal(updated.story_time.normalized, "cn-1-3-18T19:00");
  assert.equal(Object.hasOwn(updated.story_time, "day_index"), false);
  assert.equal(updated.story_time.calendar_id, null);
  assert.equal(updated.story_time.precision, "minute");
  assert.equal(updated.story_time.confidence, null);
  assert.ok(traces.some(trace => trace.stage === "EVENT_EDIT_SUBMITTED" && trace.event_id === eventId));
  assert.ok(traces.some(trace => trace.stage === "EVENT_EDIT_PERSISTENCE_CONFIRMED" && trace.persistence_confirmed === true));
  fixture.runtime.destroy();
});

test("manual edits of a legacy Event replace its persisted day_index without changing ownership", async () => {
  const fixture = createFixture({
    messages: [{
      message_id: "legacy-story-time-edit",
      floor: 10,
      content: "当前剧情",
      story_time: {display: "2026-01-10", normalized: "2026-01-10", day_index: 20463, calendar_id: "main", precision: "day"},
      role: "assistant",
    }],
    analyzer: {
      async analyzeFloor() {
        return {events: [eventResult("legacy-editable-time", {
          story_time: {display: "2026-01-01", normalized: "2026-01-01", day_index: 20454, calendar_id: "main", precision: "day", confidence: 1},
        })]};
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeCurrentFloor();
  const eventId = (await fixture.runtime.getCurrentFloorEvents())[0].event_id;
  const before = fixture.runtime.store.getFloor(0, 0);
  const legacyFloor = structuredClone(before);
  legacyFloor.events[0].story_time.day_index = 20454;
  await fixture.runtime.store.saveFloor(0, 0, legacyFloor);
  const legacySource = structuredClone(legacyFloor.events[0].source);
  const legacyVersion = structuredClone(legacyFloor.floor_version);

  await fixture.runtime.updateEvent(eventId, {story_time: {display: "2026-01-05"}});
  const afterEdit = (await fixture.runtime.getCurrentFloorEvents())[0];
  assert.equal(afterEdit.event_id, eventId);
  assert.deepEqual(afterEdit.source, legacySource);
  assert.deepEqual(fixture.runtime.store.getFloor(0, 0).floor_version, legacyVersion);
  assert.equal(afterEdit.story_time.display, "2026-01-05");
  assert.equal(afterEdit.story_time.normalized, "2026-01-05");
  assert.equal(afterEdit.story_time.day_index, 20458);
  assert.notEqual(afterEdit.story_time.day_index, 20454);

  await fixture.runtime.updateEvent(eventId, {story_time: {display: "2026-01-05"}});
  const afterResave = (await fixture.runtime.getCurrentFloorEvents())[0];
  assert.deepEqual(afterResave.story_time, afterEdit.story_time);
  assert.equal(afterResave.event_id, eventId);
  assert.deepEqual(afterResave.source, legacySource);
  assert.deepEqual(fixture.runtime.store.getFloor(0, 0).floor_version, legacyVersion);
  fixture.runtime.destroy();
});

test("manual Event Story Time display edits compare parsed same-era dates without saving contradictory fields", async () => {
  const traces = [];
  const fixture = createFixture({
    notify(event) {
      if (event?.type === "BIOWEAVE_PERSISTENCE_TRACE") traces.push(event.payload);
    },
    messages: [{
      message_id: "story-time-incomparable-edit",
      floor: 10,
      content: "当前剧情",
      story_time: {display: "羲和1年3月20日 酉时末"},
      role: "assistant",
    }],
    analyzer: {
      async analyzeFloor() {
        return {events: [eventResult("incomparable-display-time", {
          story_time: {display: "羲和1年3月15日 酉时末"},
        })]};
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeCurrentFloor();
  const eventId = (await fixture.runtime.getCurrentFloorEvents())[0].event_id;
  const beforeSaves = fixture.saveFloorCalls();

  await fixture.runtime.updateEvent(eventId, {
    story_time: {display: "羲和1年3月18日 酉时末"},
  });

  const updated = (await fixture.runtime.getCurrentFloorEvents())[0];
  assert.equal(updated.story_time.normalized, "cn-1-3-18T19:00");
  assert.equal(Object.hasOwn(updated.story_time, "day_index"), false);
  assert.equal(updated.story_time.calendar_id, null);
  assert.equal(fixture.saveFloorCalls(), beforeSaves + 1);
  assert.equal(traces.some(trace => trace.stage === "EVENT_STORY_TIME_INCOMPARABLE" && trace.event_ids.includes(eventId)), false);
  fixture.runtime.destroy();
});

test("manual display edit preserves an existing complex Event when its registry snapshot is unavailable", async () => {
  const fixture = createFixture({
    messages: [{
      message_id: "story-time-edit-missing-registry",
      floor: 64,
      content: "当前剧情",
      story_time: {display: "羲和1年3月20日 酉时末"},
      role: "assistant",
    }],
    analyzer: {
      async analyzeFloor() {
        return {events: [eventResult("complex-existing-event", {
          story_time: {display: "羲和1年3月15日 酉时末"},
          source_evidence: [
            {kind: "current_floor", text: "当前楼层"},
            {kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND, text: "实际暴露证据"},
          ],
        })]};
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeCurrentFloor();
  const before = structuredClone(fixture.runtime.store.getFloor(0));
  await fixture.runtime.store.saveFloor(0, 0, {
    ...before,
    character_registry: {schema_version: 1, entities: {}},
  });
  const eventId = before.events[0].event_id;

  await fixture.runtime.updateEvent(eventId, {
    story_time: {display: "羲和1年3月18日 酉时末"},
  });

  const updated = fixture.runtime.store.getFloor(0).events[0];
  assert.equal(updated.event_id, eventId);
  assert.equal(updated.story_time.display, "羲和1年3月18日 酉时末");
  assert.equal(updated.story_time.normalized, "cn-1-3-18T19:00");
  assert.deepEqual(updated.source, before.events[0].source);
  fixture.runtime.destroy();
});

test("invalid manual Event Story Time display rejects atomically", async () => {
  const fixture = createFixture();
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const before = structuredClone(await fixture.runtime.getCurrentFloorEvents());
  const beforeSaves = fixture.saveFloorCalls();
  await assert.rejects(
    fixture.runtime.updateEvent(before[0].event_id, {story_time: {display: "不是可识别日期"}}),
    error => error?.code === "EVENT_EDIT_STORY_TIME_INVALID",
  );
  assert.deepEqual(await fixture.runtime.getCurrentFloorEvents(), before);
  assert.equal(fixture.saveFloorCalls(), beforeSaves);
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
    reliableStoryTime: true,
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

test("complete Floor Event state inherits, deletes, and rolls back by position", async () => {
  const fixture = createFixture({
    messages: [
      {message_id: "floor-2", floor: 2, content: "A", role: "assistant"},
      {message_id: "floor-4", floor: 4, content: "无变化", role: "assistant"},
      {message_id: "floor-6", floor: 6, content: "B", role: "assistant"},
      {message_id: "floor-8", floor: 8, content: "删除 A", role: "assistant"},
    ],
    analyzer: {
      async analyzeFloor({analysisInput}) {
        const floor = analysisInput.current_floor.floor;
        return {
          events: floor === 2
            ? [eventResult("A")]
            : floor === 6
              ? [Object.assign(identityEventForCharacters(analysisInput.character_registry, "Alice", "Bob", "B"), {location: "楼上"})]
              : floor === 10
                ? [Object.assign(identityEventForCharacters(analysisInput.character_registry, "Alice", "Bob", "C"), {location: "楼下"})]
                : [],
        };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 0}, {force: true});
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 2}, {force: true});
  const aId = fixture.runtime.store.getFloor(0).events[0].event_id;
  const bId = fixture.runtime.store.getFloor(2).events.find(event => event.event_id !== aId).event_id;
  await fixture.runtime.deleteEvent(aId);
  await fixture.runtime.updateEvent(bId, {location: "B′"});
  await fixture.runtime.updateEvent(bId, {location: "B″"});
  fixture.context.chat.push({message_id: "floor-10", floor: 10, content: "C", role: "assistant"});
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 4}, {force: true});
  const cId = fixture.runtime.store.getFloor(4).events.find(event => event.event_id !== bId).event_id;

  assert.deepEqual(fixture.runtime.store.getFloor(0).events.map(event => event.event_id), [aId]);
  assert.deepEqual(fixture.runtime.store.getFloor(2).events.map(event => event.event_id), [aId, bId]);
  assert.equal(fixture.runtime.store.getFloor(2).events.find(event => event.event_id === bId).location, "楼上");
  assert.deepEqual(fixture.runtime.store.getFloor(3).events.map(event => event.event_id), [bId]);
  assert.equal(fixture.runtime.store.getFloor(3).events[0].location, "B″");
  assert.deepEqual(fixture.runtime.store.getFloor(4).events.map(event => event.event_id), [bId, cId]);
  fixture.runtime.destroy();
});

test("deleting the last Event stores an explicit empty complete state", async () => {
  const fixture = createFixture({
    messages: [
      {message_id: "empty-base", floor: 2, content: "A", role: "assistant"},
      {message_id: "empty-delete", floor: 8, content: "删除全部", role: "assistant"},
    ],
    analyzer: {async analyzeFloor() { return {events: [eventResult("only-event")]}; }},
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 0}, {force: true});
  const eventId = fixture.runtime.store.getFloor(0).events[0].event_id;
  await fixture.runtime.deleteEvent(eventId);
  assert.deepEqual(fixture.runtime.store.getFloor(1).events, []);
  assert.equal(fixture.runtime.store.getFloor(1).analysis.status, "success");
  assert.deepEqual(await fixture.runtime.getCurrentFloorEvents(), []);
  fixture.context.chat.push({message_id: "empty-next", floor: 10, content: "新增 C", role: "assistant"});
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 2}, {force: true});
  assert.equal(fixture.runtime.store.getFloor(2).events.length, 1);
  fixture.runtime.destroy();
});

test("all BiologicalEvent edits use one complete current-Floor collection and preserve history", async () => {
  const fixture = createFixture({
    messages: [
      {message_id: "complete-20", floor: 20, content: "A B", role: "assistant"},
      {message_id: "complete-26", floor: 26, content: "新增 C", role: "assistant"},
    ],
    analyzer: {
      async analyzeFloor({analysisInput}) {
        return analysisInput.current_floor.floor === 20
          ? {
              events: [
                identityEventForCharacters(analysisInput.character_registry, "A", "A-source", "a"),
                identityEventForCharacters(analysisInput.character_registry, "B", "B-source", "b"),
              ],
            }
          : {
              events: [
                identityEventForCharacters(analysisInput.character_registry, "C", "C-source", "c"),
              ],
            };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 0}, {force: true});
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 1}, {force: true});

  const floor20 = fixture.runtime.store.getFloor(0, 0);
  const floor26 = fixture.runtime.store.getFloor(1, 0);
  const aId = floor20.events[0].event_id;
  const bId = floor20.events[1].event_id;
  const cId = floor26.events.find(event => ![aId, bId].includes(event.event_id)).event_id;
  const originalASource = structuredClone(floor20.events.find(event => event.event_id === aId).source);

  assert.deepEqual(floor20.events.map(event => event.event_id), [aId, bId]);
  assert.deepEqual(floor26.events.map(event => event.event_id), [aId, bId, cId]);
  assert.deepEqual(floor26.events.find(event => event.event_id === aId).source, originalASource);

  const updatedA = await fixture.runtime.updateEvent(aId, {location: "A′"});
  assert.equal(updatedA.location, "A′");
  assert.deepEqual(fixture.runtime.store.getFloor(0, 0).events.map(event => event.event_id), [aId, bId]);
  assert.equal(fixture.runtime.store.getFloor(0, 0).events.find(event => event.event_id === aId).location, "传灯院");
  assert.deepEqual(fixture.runtime.store.getFloor(1, 0).events.map(event => event.event_id), [aId, bId, cId]);
  assert.equal(fixture.runtime.store.getFloor(1, 0).events.find(event => event.event_id === aId).location, "A′");

  fixture.context.chat.push({message_id: "complete-30", floor: 30, content: "删除 B", role: "assistant"});
  await fixture.runtime.deleteEvent(bId);
  assert.deepEqual(fixture.runtime.store.getFloor(2, 0).events.map(event => event.event_id), [aId, cId]);
  assert.equal(fixture.runtime.store.getFloor(2, 0).events.find(event => event.event_id === aId).source.floor, 20);
  assert.equal(fixture.runtime.store.getFloor(2, 0).events.find(event => event.event_id === cId).source.floor, 26);

  fixture.context.chat.push({message_id: "complete-34", floor: 34, content: "无变化", role: "assistant"});
  const current = await fixture.runtime.getCurrentFloorEvents();
  assert.deepEqual(current.map(event => event.event_id), [aId, cId]);
  assert.equal(current.some(event => event.event_id === bId), false);
  fixture.runtime.destroy();
});

test("Health Evolution recovery waits for analysis completion, stays read-only on UI reads, and updates current health snapshot once", async () => {
  let eventCalls = 0;
  const fixture = createFixture({
    floor: 4,
    messages: [{
      message_id: "health-recovery-floor",
      floor: 4,
      content: "第4日 当前剧情",
      story_time: {
        display: "第4日",
        normalized: null,
        day_index: 4,
        calendar_id: null,
        precision: "day",
      },
      role: "assistant",
    }],
    healthRecoveryStabilityDelayMs: 35,
    analyzer: {
      async analyzeWorldModel() {
        return normalizeWorldModel({schema_version: 1, species: [{name: "人类", biological_types: []}]});
      },
      async analyzeFloor() {
        eventCalls += 1;
        if (eventCalls === 1) {
          const fever = eventResult("fever", {
            type: "physical_symptom",
            story_time: {
              display: "第1日",
              normalized: null,
              day_index: 1,
              calendar_id: null,
              precision: "day",
            },
            pregnancy_relevance: {
              relevant: false,
              possible_conception: false,
              gestational_subject_ids: [],
              counterpart_ids: [],
            },
            state_fact: {
              subject_id: "fever-subject",
              payload: {
                symptom: {
                  kind: "fever",
                  description: "发热",
                  health_role: "observation",
                },
              },
            },
          });
          return {
            events: [fever, eventResult("persistent-non-health")],
          };
        }
        return {events: [eventResult("new-non-health", {type: "other_biological"})]};
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const floor = fixture.context.chat[0].extra.bioweave;
  const fever = floor.events[0];
  const persistentEventId = floor.events[1].event_id;
  floor.health_assessment_timeline = {
    schema_version: 1,
    assessments: [{
      assessment_id: "assessment-fever",
      source_event_id: fever.event_id,
      source_floor_version: structuredClone(floor.analysis.floor_version),
      source_observation_fingerprint: healthObservationFingerprint(fever),
      request_key: "assessment-fever-key",
      reference_story_time: structuredClone(fever.story_time),
      persistence: "short_term",
      natural_recovery: "eligible",
      expected_recovery: {
        duration: null,
        boundary: {
          display: "第3日",
          normalized: null,
          day_index: 3,
          calendar_id: null,
          precision: "day",
        },
      },
      earliest_recovery: {duration: null, boundary: null},
      recovery_stage_guidance: {early: "early", recovering: "recovering", near_recovery: "near"},
      assessment_source: "fixture",
    }],
  };
  await fixture.adapter.saveFloorBioWeave(0, 0, floor);

  const beforeRead = fixture.saveFloorCalls();
  const read = await fixture.runtime.collectActiveBusinessData();
  assert.equal(read.active_events.length, 2);
  assert.equal(fixture.saveFloorCalls(), beforeRead);

  const beforeAnalysis = fixture.saveFloorCalls();
  const startedAt = Date.now();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const elapsed = Date.now() - startedAt;
  const saved = fixture.context.chat[0].extra.bioweave;
  assert.ok(elapsed >= 25);
  assert.equal(saved.events.length, 2);
  assert.equal(saved.events.some(event => event.event_id === fever.event_id), false);
  assert.equal(saved.events.some(event => event.event_id === persistentEventId), true);
  assert.equal(fixture.saveFloorCalls(), beforeAnalysis + 2);
  assert.equal(saved.health_assessment_timeline.assessments.length, 0);
  assert.equal(eventCalls, 2);
  fixture.runtime.destroy();
});

test("an unchanged Floor retries a missing Health Assessment and reuses it after success", async () => {
  let eventCalls = 0;
  let healthCalls = 0;
  const healthEvent = eventResult("health-assessment-retry", {
    type: "physical_symptom",
    pregnancy_relevance: {
      relevant: false,
      possible_conception: false,
      gestational_subject_ids: [],
      counterpart_ids: [],
    },
    state_fact: {
      subject_id: "health-assessment-retry-subject",
      payload: {
        symptom: {
          kind: "nausea",
          description: "恶心",
          health_role: "observation",
        },
      },
    },
  });
  const fixture = createFixture({
    analyzer: {
      async analyzeWorldModel() {
        return normalizeWorldModel({schema_version: 1, species: [{name: "人类", biological_types: []}]});
      },
      async analyzeFloor() {
        eventCalls += 1;
        return {events: [structuredClone(healthEvent)]};
      },
      async analyzeHealthAssessment() {
        healthCalls += 1;
        if (healthCalls === 1) {
          const error = new Error("HEALTH_ASSESSMENT_INVALID_JSON");
          error.code = "HEALTH_ASSESSMENT_INVALID_JSON";
          throw error;
        }
        return {
          schema_version: 3,
          severity: "mild",
          persistence: "short_term",
          natural_recovery: "eligible",
          earliest_recovery: {duration: {story_days: 1}, boundary: null},
          expected_recovery: {duration: {story_days: 3}, boundary: null},
          assessment_source: "ai_derived_assessment",
          recovery_stage_guidance: {
            early: "早期指导",
            recovering: "恢复中指导",
            near_recovery: "接近恢复指导",
          },
        };
      },
    },
  });

  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  assert.equal(healthCalls, 1);
  assert.equal(
    fixture.context.chat[0].extra.bioweave.health_assessment_timeline?.assessments?.length ?? 0,
    0,
  );

  await fixture.runtime.refreshCurrentFloorAnalysis();
  assert.equal(eventCalls, 2);
  assert.equal(healthCalls, 2);
  assert.equal(
    fixture.context.chat[0].extra.bioweave.health_assessment_timeline.assessments.length,
    1,
  );

  await fixture.runtime.refreshCurrentFloorAnalysis();
  assert.equal(eventCalls, 3);
  assert.equal(healthCalls, 2);
  fixture.runtime.destroy();
});

test("explicit rendered Character target survives an earlier User snapshot change and cleans recovered health", async () => {
  let eventCalls = 0;
  const fixture = createFixture({
    messages: [
      {message_id: "user-before-render", floor: 3, content: "用户原文", role: "user"},
      {
        message_id: "health-render-target",
        floor: 4,
        content: "角色回复",
        role: "assistant",
        story_time: {
          display: "第4日",
          normalized: null,
          day_index: 4,
          calendar_id: null,
          precision: "day",
        },
      },
    ],
    healthRecoveryStabilityDelayMs: 0,
    analyzer: {
      async analyzeFloor({analysisInput} = {}) {
        eventCalls += 1;
        if (analysisInput?.existing_events?.length)
          return {events: structuredClone(analysisInput.existing_events)};
        return {
          events: [identityEventForCharacters({}, "Alice", "Bob", "recovered-fever")],
        };
      },
    },
  });
  configureScheduler(fixture, {interval: 1});
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const storedBeforeRender = fixture.runtime.store.getFloor(1, 0);
  const recoveredEvent = storedBeforeRender.events[0];
  recoveredEvent.type = "physical_symptom";
  recoveredEvent.state_fact = {
    subject_id: recoveredEvent.participants[0].character_id,
    payload: {symptom: {kind: "fever", description: "发热", health_role: "observation"}},
  };
  recoveredEvent.pregnancy_relevance = {
    relevant: false,
    possible_conception: false,
    gestational_subject_ids: [],
    counterpart_ids: [],
  };
  storedBeforeRender.health_assessment_timeline = {
    schema_version: 1,
    assessments: [{
      assessment_id: "assessment-recovered-fever",
      source_event_id: recoveredEvent.event_id,
      source_floor_version: structuredClone(storedBeforeRender.analysis.floor_version),
      source_observation_fingerprint: healthObservationFingerprint(recoveredEvent),
      request_key: "assessment-recovered-fever-key",
      reference_story_time: structuredClone(recoveredEvent.story_time),
      persistence: "short_term",
      natural_recovery: "eligible",
      expected_recovery: {
        duration: null,
        boundary: {display: "第3日", normalized: null, day_index: 3, calendar_id: null, precision: "day"},
      },
      earliest_recovery: {duration: null, boundary: null},
      recovery_stage_guidance: {early: "early", recovering: "recovering", near_recovery: "near"},
      assessment_source: "fixture",
    }],
  };
  await fixture.adapter.saveFloorBioWeave(1, 0, storedBeforeRender);
  const writesBeforeGeneration = fixture.saveFloorCalls();

  fixture.context.chat[0].content = "用户编辑后的无关快照";
  await fixture.emit("generation-started", {generation_type: "normal", message_id: "health-render-target"});
  await fixture.emit("generation-ended", {message_id: "health-render-target"});
  await fixture.emit("character-message-rendered", {message_id: "health-render-target"});
  await settle();
  await settle();

  const current = fixture.runtime.store.getFloor(1, 0);
  assert.equal(eventCalls, 1);
  assert.equal(current.events.some(event => event.event_id === recoveredEvent.event_id), false);
  assert.equal(fixture.saveFloorCalls() > writesBeforeGeneration, true);
  assert.equal(
    fixture.runtime.getPersistenceTrace().sequence.some(item =>
      item.stage === "GENERATION_FINAL_FLOOR_SEEN" && item.message_index === 1,
    ),
    true,
  );
  fixture.runtime.destroy();
});

test("settled Character Floor retries deferred health snapshot after the final Floor becomes complete", async () => {
  const fixture = createFixture({
    messages: [
      {message_id: "health-settle-previous", floor: 2, content: "第2日角色正文", role: "assistant"},
      {message_id: "health-settle-retry", floor: 4, content: "第4日角色正文", role: "assistant",
        story_time: {display: "第4日", normalized: null, day_index: 4, calendar_id: null, precision: "day"}},
    ],
    healthRecoveryStabilityDelayMs: 0,
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 0}, {force: true});
  const floor = fixture.runtime.store.getFloor(0, 0);
  const event = {
    ...eventResult("health-settle-event", {
      type: "physical_symptom",
      pregnancy_relevance: {relevant: false, possible_conception: false, gestational_subject_ids: [], counterpart_ids: []},
      state_fact: {subject_id: "health-settle-subject", payload: {symptom: {kind: "fever", description: "发热", health_role: "observation"}}},
      source: structuredClone(floor.analysis.floor_version),
    }),
  };
  floor.events = [event];
  floor.health_assessment_timeline = {
    schema_version: 1,
    assessments: [{
      assessment_id: "health-settle-assessment",
      source_event_id: event.event_id,
      source_floor_version: structuredClone(floor.analysis.floor_version),
      source_observation_fingerprint: healthObservationFingerprint(event),
      request_key: "health-settle-request",
      reference_story_time: structuredClone(event.story_time),
      persistence: "short_term",
      natural_recovery: "eligible",
      expected_recovery: {duration: null, boundary: null},
      earliest_recovery: {duration: null, boundary: null},
      recovery_stage_guidance: {early: "early", recovering: "recovering", near_recovery: "near"},
      assessment_source: "fixture",
    }],
  };
  await fixture.adapter.saveFloorBioWeave(0, 0, floor);

  const target = await fixture.runtime.resolveCurrentBioWeaveFloor({__messageIndex: true, index: 1});
  const incomplete = fixture.runtime.store.getFloor(1, 0) ?? {};
  incomplete.analysis = {status: "pending", floor_version: structuredClone(target.version)};
  incomplete.events = undefined;
  incomplete.character_registry = undefined;
  await fixture.adapter.saveFloorBioWeave(1, 0, incomplete);

  const writesBeforeSettle = fixture.saveFloorCalls();
  await fixture.emit("generation-started", {generation_type: "normal", message_id: "health-settle-retry"});
  await fixture.emit("generation-ended", {message_id: "health-settle-retry"});
  await fixture.emit("character-message-rendered", {message_id: "health-settle-retry"});
  await settle();

  const trace = fixture.runtime.getPersistenceTrace().sequence;
  const settledHealthTrace = trace
    .map((entry, index) => ({entry, index}))
    .filter(({entry}) => [
      "HEALTH_ASSESSMENT_SNAPSHOT_DEFERRED",
      "HEALTH_ASSESSMENT_SNAPSHOT_OWNER_REPAIR_ATTEMPT",
      "HEALTH_ASSESSMENT_SNAPSHOT_OWNER_REPAIR_RESULT",
      "HEALTH_ASSESSMENT_SNAPSHOT_PERSISTED",
      "HEALTH_ASSESSMENT_SNAPSHOT_SYNCED",
    ].includes(entry.stage));
  const settledDeferred = settledHealthTrace.find(({entry}) =>
    entry.stage === "HEALTH_ASSESSMENT_SNAPSHOT_DEFERRED" &&
    entry.reason?.startsWith("settled-floor:"),
  );
  assert.ok(settledDeferred);
  const orderedStages = [
    "HEALTH_ASSESSMENT_SNAPSHOT_DEFERRED",
    "HEALTH_ASSESSMENT_SNAPSHOT_OWNER_REPAIR_ATTEMPT",
    "HEALTH_ASSESSMENT_SNAPSHOT_OWNER_REPAIR_RESULT",
    "HEALTH_ASSESSMENT_SNAPSHOT_PERSISTED",
    "HEALTH_ASSESSMENT_SNAPSHOT_SYNCED",
  ];
  let previousIndex = settledDeferred.index;
  for (const stage of orderedStages.slice(1)) {
    const next = settledHealthTrace.find(({entry, index}) => entry.stage === stage && index > previousIndex);
    assert.ok(next, stage);
    previousIndex = next.index;
  }
  assert.equal(fixture.saveFloorCalls(), writesBeforeSettle + 2);
  const current = fixture.runtime.store.getFloor(1, 0);
  assert.equal(current.events.some(item => item.event_id === event.event_id), true);
  assert.deepEqual(current.character_registry, floor.character_registry);
  assert.equal(current.health_assessment_timeline.assessments.length, 1);
  const writesAfterSettle = fixture.saveFloorCalls();
  const syncedCount = trace.filter(entry => entry.stage === "HEALTH_ASSESSMENT_SNAPSHOT_SYNCED").length;
  await fixture.emit("character-message-rendered", {message_id: "health-settle-retry"});
  await settle();
  assert.equal(fixture.saveFloorCalls(), writesAfterSettle);
  assert.equal(
    fixture.runtime.getPersistenceTrace().sequence.filter(entry => entry.stage === "HEALTH_ASSESSMENT_SNAPSHOT_SYNCED").length,
    syncedCount,
  );
  assert.equal(fixture.calls(), 1);
  fixture.runtime.destroy();
});

test("deferred health snapshot refuses a stale final Floor owner without writing", async () => {
  const fixture = createFixture({
    messages: [{message_id: "health-stale-owner", floor: 4, content: "旧正文", role: "assistant"}],
    healthRecoveryStabilityDelayMs: 0,
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const target = await fixture.runtime.resolveCurrentBioWeaveFloor({__messageIndex: true, index: 0});
  const writesBefore = fixture.saveFloorCalls();
  fixture.context.chat[0].content = "新正文导致 Floor Version 变化";
  const result = await fixture.runtime.syncHealthRecoverySnapshot({target, reason: "test-stale-owner"});
  assert.equal(result.status, "stale");
  assert.equal(fixture.saveFloorCalls(), writesBefore);
  fixture.runtime.destroy();
});

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
    reliableStoryTime: true,
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
  abstractEvent.story_time = {
    display: "Day 1",
    normalized: "0001-01-01",
    day_index: 1,
    calendar_id: "main",
    precision: "day",
    confidence: 1,
  };
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
        if (analysisCount === 2) {
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
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const retainedAfterOlderEvidence = (await fixture.runtime.getCurrentFloorEvents())[0];
  assert.equal(
    retainedAfterOlderEvidence.participants[0].reproductive_capabilities_used
      .can_carry_pregnancy,
    true,
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
    calendar_id: null,
    precision: "minute",
    confidence: 1,
  });
  fixture.runtime.destroy();
});

test("production analyzer accepts multi-Event force refresh and keeps exposure tracking subject-local", async () => {
  let responseCount = 0;
  const fixture = createFixture({
    reliableStoryTime: true,
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
  const fixture = createFixture({
    reliableStoryTime: true,
    rawApiResponse: () => rawResponse,
  });

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
  let calls = 0;
  const fixture = createFixture({
    reliableStoryTime: true,
    analyzer: {
      async analyzeFloor({analysisInput} = {}) {
        calls += 1;
        return {events: [fixtureContinuationEvent(analysisInput, eventResult("fixture-event"))]};
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeCurrentFloor();
  const firstId = (await fixture.runtime.getCurrentFloorEvents())[0].event_id;
  await fixture.runtime.analyzeCurrentFloor();
  assert.equal(calls, 1);
  await fixture.runtime.refreshCurrentFloorAnalysis();
  assert.equal(calls, 2);
  assert.deepEqual(
    (await fixture.runtime.getCurrentFloorEvents()).map(
      (event) => event.event_id,
    ),
    [firstId],
  );
  fixture.runtime.destroy();
});

test("Event dedupe references every valid Floor inside the bounded Recent Story window", async () => {
  const inputs = [];
  const fixture = createFixture({
    messages: [
      {message_id: "message-1", floor: 1, content: "历史楼一", role: "assistant"},
      {message_id: "message-2", floor: 2, content: "历史楼二", role: "assistant"},
      {message_id: "message-3", floor: 3, content: "当前目标楼", role: "assistant"},
    ],
    analyzer: {
      async analyzeFloor({analysisInput}) {
        inputs.push(structuredClone(analysisInput));
        const result = eventResult(`window-${inputs.length}`);
        result.participants = result.participants.map((participant, index) => ({
          ...participant,
          display_name: `${participant.display_name}-${inputs.length}`,
          identity_evidence: [
            {kind: "explicit_distinct_entity", text: `window-${inputs.length}-${index}`},
          ],
        }));
        return {events: [result]};
      },
    },
  });
  fixture.context.chatMetadata.bioweave = {
    chat_scope: {chat_id: "chat-runtime"},
    settings: {recent_story: {enabled: true, floor_count: 3}},
  };
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 0}, {force: true});
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 1}, {force: true});
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 2}, {force: true});

  const targetInput = inputs.at(-1);
  assert.deepEqual(
    targetInput.existing_events.map((item) => item.source.floor).sort((a, b) => a - b),
    [1, 2],
  );
  assert.deepEqual(
    targetInput.existing_bioweave.events.map((item) => item.source.floor),
    [1, 2],
  );
  fixture.runtime.destroy();
});

test("semantic duplicate from Recent Story is not persisted a second time", async () => {
  let persisted = null;
  let calls = 0;
  const storyTime = {
    display: "寅时末",
    normalized: "cn-42-6-10T03:30",
    calendar_id: null,
    day_index: null,
    precision: "minute",
    confidence: null,
  };
  const fixture = createFixture({
    reliableStoryTime: true,
    messages: [
      {message_id: "message-history", floor: 1, content: "历史 exposure", role: "assistant"},
      {message_id: "message-target", floor: 2, content: "当前 physical symptom", role: "assistant"},
    ],
    analyzer: {
      async analyzeFloor() {
        if (calls++ === 0) {
          return {
            events: [eventResult("history-raw", {
              story_time: storyTime,
              source_evidence: [
                {kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND, text: "明确历史 exposure"},
              ],
            })],
          };
        }
        const duplicate = structuredClone(persisted);
        delete duplicate.event_id;
        delete duplicate.source;
        duplicate.participants = duplicate.participants.map((participant) => ({
          ...participant,
          identity_status: "existing",
          mention_id: null,
        }));
        return {events: [duplicate]};
      },
    },
  });
  fixture.context.chatMetadata.bioweave = {
    chat_scope: {chat_id: "chat-runtime"},
    settings: {recent_story: {enabled: true, floor_count: 2}},
  };
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 0}, {force: true});
  persisted = fixture.context.chat[0].extra.bioweave.events[0];
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 1}, {force: true});

  const currentEvents = await fixture.runtime.getCurrentFloorEvents();
  assert.equal(currentEvents.length, 1);
  assert.equal(currentEvents[0].event_id, persisted.event_id);
  assert.equal(currentEvents[0].source.message_id, "message-history");
  fixture.runtime.destroy();
});

test("Runtime persists a parser-normalized Event envelope without continuation metadata", async () => {
  const rawEvent = eventResult("raw-top-level", {
    continuation_of_event_id: "evt-not-visible",
    continuation_update: true,
  });
  rawEvent.participants = rawEvent.participants.map((participant) => ({
    ...participant,
    reproductive_capabilities_used: {
      can_produce_sperm: null,
      can_produce_ova: null,
      can_be_fertilized: null,
      can_fertilize: null,
      can_carry_pregnancy: participant.event_role === "potential_gestational_subject",
      can_cause_pregnancy: participant.event_role === "potential_conception_source",
    },
  }));
  const fixture = createFixture({
    rawApiResponse: JSON.stringify({schema_version: 1, events: [rawEvent]}),
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 0}, {force: true});

  const persisted = fixture.runtime.store.getFloor(0, 0).events;
  assert.equal(persisted.length, 1);
  assert.equal(Object.hasOwn(persisted[0], "continuation_of_event_id"), false);
  assert.equal(Object.hasOwn(persisted[0], "continuation_update"), false);
  assert.equal(persisted[0].source.floor, 3);
  fixture.runtime.destroy();
});

test("cross-Floor continuation with new evidence reuses the existing Event ID", async () => {
  const inputs = [];
  let persisted = null;
  const storyTime = {
    display: "羲和1年3月4日 巳时中",
    normalized: "cn-1-3-4T10:00",
    calendar_id: null,
    day_index: null,
    precision: "hour",
    confidence: 1,
  };
  const fixture = createFixture({
    messages: [
      {message_id: "floor-66", floor: 66, content: "持续互动开始", role: "assistant"},
      {message_id: "floor-68", floor: 68, content: "持续互动继续", role: "assistant"},
      {message_id: "floor-70", floor: 70, content: "持续互动出现新事实", role: "assistant"},
    ],
    analyzer: {
      async analyzeFloor({analysisInput}) {
        inputs.push(structuredClone(analysisInput));
        const candidate = identityEventForCharacters(
          analysisInput.character_registry,
          "祁鸢",
          "金文达",
          `ai-event-${inputs.length}`,
        );
        candidate.type = "sexual_activity";
        candidate.story_time = storyTime;
        candidate.location = "底舱";
        candidate.pregnancy_relevance.reproductive_mechanism = {
          kind: "intravaginal_exposure",
          label: "阴道内交合暴露",
          pathway: ["中文路径描述", "rewritten English pathway", "日本語の経路説明"][inputs.length - 1],
          world_model_rule_refs: [],
          evidence: [{
            kind: "pregnancy_relevant_exposure",
            text: `机制证据 ${["A", "B", "C"][inputs.length - 1]}`,
          }],
        };
        candidate.source_evidence = [{
          kind: "pregnancy_relevant_exposure",
          text: `证据 ${["A", "B", "C"][inputs.length - 1]}`,
        }];
        if (inputs.length > 1) {
          candidate.continuation_of_event_id = persisted?.event_id;
          candidate.continuation_update = true;
        }
        return {events: [candidate]};
      },
    },
  });
  fixture.context.chatMetadata.bioweave = {
    chat_scope: {chat_id: "chat-runtime"},
    settings: {recent_story: {enabled: true, floor_count: 2}},
  };

  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 0}, {force: true});
  persisted = structuredClone(fixture.runtime.store.getFloor(0, 0).events[0]);
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 1}, {force: true});
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 2}, {force: true});

  assert.deepEqual(
    inputs[1].existing_events.map((event) => event.event_id),
    [persisted.event_id],
  );
  assert.deepEqual(
    inputs[2].existing_events.map((event) => event.event_id),
    [persisted.event_id],
  );
  const currentEvents = await fixture.runtime.getCurrentFloorEvents();
  assert.equal(currentEvents.length, 1, "continuation should update the existing Event");
  assert.equal(currentEvents[0].event_id, persisted.event_id);
  assert.equal(currentEvents[0].source.floor, 66);
  assert.deepEqual(
    currentEvents[0].source_evidence.map((item) => item.text),
    ["证据 A", "证据 B", "证据 C"],
  );
  assert.equal(Object.hasOwn(currentEvents[0], "continuation_of_event_id"), false);
  assert.equal(Object.hasOwn(currentEvents[0], "continuation_update"), false);
  fixture.runtime.destroy();
});

test("unique licensed continuity merges across Floors when Story Time advances", async () => {
  let analysisCount = 0;
  const storyTime = {
    display: "羲和1年3月4日 巳时中",
    normalized: "cn-1-3-4T10:00",
    calendar_id: null,
    day_index: null,
    precision: "hour",
    confidence: 1,
  };
  const fixture = createFixture({
    reliableStoryTime: true,
    messages: [
      {message_id: "implicit-floor-66", floor: 66, content: "连续场景开始", role: "assistant"},
      {message_id: "implicit-floor-68", floor: 68, content: "连续场景继续", role: "assistant"},
    ],
    analyzer: {
      async analyzeFloor({analysisInput}) {
        analysisCount += 1;
        if (analysisCount === 1) {
          const event = identityEventForCharacters(
            analysisInput.character_registry,
            "祁鸢",
            "金文达",
            "implicit-source",
          );
          event.type = "sexual_activity";
          event.story_time = storyTime;
          event.location = "底舱";
          event.pregnancy_relevance.reproductive_mechanism = {
            kind: "intravaginal_exposure",
            label: "阴道内交合暴露",
            pathway: "稳定路径",
            world_model_rule_refs: [],
            evidence: [{kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND, text: "机制证据 A"}],
          };
          event.source_evidence = [{kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND, text: "来源证据 A"}];
          return {events: [event]};
        }
        const event = stableContinuationEventFromInput(analysisInput, "祁鸢");
        delete event.continuation_of_event_id;
        delete event.continuation_update;
        event.story_time = {...storyTime, normalized: "cn-1-3-4T12:00", display: "羲和1年3月4日 午时"};
        event.pregnancy_relevance.reproductive_mechanism.pathway = "剧烈改写的 pathway";
        event.source_evidence = [
          {kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND, text: "来源证据 A"},
          {kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND, text: "来源证据 B"},
        ];
        event.pregnancy_relevance.reproductive_mechanism.evidence = [
          {kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND, text: "机制证据 A"},
          {kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND, text: "机制证据 B"},
        ];
        event.participants = event.participants.map((participant) => ({
          ...participant,
          display_name: `重命名-${participant.character_id}`,
          evidence: [
            ...(participant.evidence ?? []),
            {kind: "participant", text: "参与者证据 B"},
          ],
        }));
        return {events: [event]};
      },
    },
  });
  fixture.context.chatMetadata.bioweave = {
    chat_scope: {chat_id: "chat-runtime"},
    settings: {recent_story: {enabled: true, floor_count: 2}},
  };

  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 0}, {force: true});
  const originalPersisted = structuredClone(fixture.runtime.store.getFloor(0, 0).events[0]);
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 1}, {force: true});
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 1}, {force: true});

  const events = fixture.runtime.store.getFloor(1, 0).events;
  assert.equal(events.length, 1);
  assert.equal(events[0].event_id, originalPersisted.event_id);
  assert.equal(events[0].source.floor, 66);
  assert.deepEqual(events[0].source_evidence.map(item => item.text), ["来源证据 A", "来源证据 B"]);
  fixture.runtime.destroy();
});

test("licensed continuity crosses midnight and unions a newly observed counterpart", async () => {
  let analysisCount = 0;
  const fixture = createFixture({
    messages: [
      {message_id: "cross-midnight-start", floor: 66, content: "跨午夜开始", role: "assistant"},
      {message_id: "cross-midnight-continue", floor: 68, content: "跨午夜新增对应方", role: "assistant"},
    ],
    analyzer: {
      async analyzeFloor({analysisInput}) {
        analysisCount += 1;
        const event = analysisCount === 1
          ? identityEventForCharacters(analysisInput.character_registry, "祁鸢", "金文达", "midnight")
          : identityEventForCharacters(analysisInput.character_registry, "祁鸢", "新来源", "midnight");
        event.type = "sexual_activity";
        event.story_time = analysisCount === 1
          ? {
              display: "羲和1年3月4日 子时末",
              normalized: "cn-1-3-4T23:00",
              calendar_id: null,
              day_index: null,
              precision: "hour",
              confidence: 1,
            }
          : {
              display: "羲和1年3月5日 丑时初",
              normalized: "cn-1-3-5T01:00",
              calendar_id: null,
              day_index: null,
              precision: "hour",
              confidence: 1,
            };
        event.location = "底舱";
        event.pregnancy_relevance.reproductive_mechanism = {
          kind: "intravaginal_exposure",
          label: "阴道内交合暴露",
          pathway: `跨午夜路径 ${analysisCount}`,
          world_model_rule_refs: [],
          evidence: [{kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND, text: `跨午夜证据 ${analysisCount}`}],
        };
        event.source_evidence = [{
          kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND,
          text: `跨午夜来源证据 ${analysisCount}`,
        }];
        if (analysisCount > 1) event.continuation_update = true;
        return {events: [event]};
      },
    },
  });
  fixture.context.chatMetadata.bioweave = {
    chat_scope: {chat_id: "chat-runtime"},
    settings: {recent_story: {enabled: true, floor_count: 2}},
  };

  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 0}, {force: true});
  const original = structuredClone(fixture.runtime.store.getFloor(0, 0).events[0]);
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 1}, {force: true});

  const events = fixture.runtime.store.getFloor(1, 0).events;
  assert.equal(events.length, 1);
  assert.equal(events[0].event_id, original.event_id);
  assert.equal(events[0].source.floor, 66);
  assert.ok(
    events[0].pregnancy_relevance.counterpart_ids.includes(
      original.pregnancy_relevance.counterpart_ids[0],
    ),
  );
  assert.equal(events[0].pregnancy_relevance.counterpart_ids.length, 2);
  assert.ok(events[0].participants.some(item => item.display_name === "新来源"));
  assert.equal(events[0].participants.length, 3);
  assert.equal(events[0].source_evidence.length, 2);
  fixture.runtime.destroy();
});

test("markerless continuity uses a six-hour window across midnight and then fails closed", async () => {
  let analysisCount = 0;
  const fixture = createFixture({
    reliableStoryTime: true,
    messages: [
      {message_id: "markerless-midnight-start", floor: 66, content: "23点开始", role: "assistant"},
      {message_id: "markerless-midnight-continue", floor: 68, content: "次日1点继续", role: "assistant"},
      {message_id: "markerless-too-late", floor: 70, content: "次日8点再次出现", role: "assistant"},
    ],
    analyzer: {
      async analyzeFloor({analysisInput}) {
        analysisCount += 1;
        const event = analysisCount === 1
          ? identityEventForCharacters(analysisInput.character_registry, "祁鸢", "金文达", "markerless-window")
          : stableContinuationEventFromInput(analysisInput, "祁鸢");
        event.type = "sexual_activity";
        event.story_time = [
          {display: "羲和1年3月4日 子时末", normalized: "cn-1-3-4T23:00", calendar_id: null, day_index: null, precision: "hour", confidence: 1},
          {display: "羲和1年3月5日 丑时初", normalized: "cn-1-3-5T01:00", calendar_id: null, day_index: null, precision: "hour", confidence: 1},
          {display: "羲和1年3月5日 辰时", normalized: "cn-1-3-5T08:00", calendar_id: null, day_index: null, precision: "hour", confidence: 1},
        ][analysisCount - 1];
        event.location = "底舱";
        event.pregnancy_relevance.reproductive_mechanism = {
          kind: "intravaginal_exposure",
          label: "同一机制",
          pathway: `路径 ${analysisCount}`,
          world_model_rule_refs: [],
          evidence: [{kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND, text: `机制证据 ${analysisCount}`}],
        };
        event.source_evidence = [{kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND, text: `来源证据 ${analysisCount}`}];
        delete event.continuation_of_event_id;
        delete event.continuation_update;
        return {events: [event]};
      },
    },
  });
  fixture.context.chatMetadata.bioweave = {
    chat_scope: {chat_id: "chat-runtime"},
    settings: {recent_story: {enabled: true, floor_count: 3}},
  };

  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 0}, {force: true});
  const original = structuredClone(fixture.runtime.store.getFloor(0, 0).events[0]);
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 1}, {force: true});
  assert.deepEqual(
    fixture.runtime.store.getFloor(1, 0).events.map(event => event.event_id),
    [original.event_id],
    "23:00 -> 01:00 should stay within the markerless six-hour window",
  );
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 2}, {force: true});
  const events = fixture.runtime.store.getFloor(2, 0).events;
  assert.equal(events.length, 2, "a seven-hour follow-up must create a new Event");
  assert.ok(events.some(event => event.event_id === original.event_id));
  assert.ok(events.some(event => event.event_id !== original.event_id));
  fixture.runtime.destroy();
});

test("markerless continuity fails closed when Story Time is missing", async () => {
  let analysisCount = 0;
  const fixture = createFixture({
    messages: [
      {message_id: "markerless-unknown-start", floor: 66, content: "未知时间开始", role: "assistant"},
      {message_id: "markerless-unknown-continue", floor: 70, content: "未知时间继续", role: "assistant"},
    ],
    analyzer: {
      async analyzeFloor({analysisInput}) {
        analysisCount += 1;
        const event = analysisCount === 1
          ? identityEventForCharacters(analysisInput.character_registry, "祁鸢", "金文达", "markerless-unknown")
          : stableContinuationEventFromInput(analysisInput, "祁鸢");
        event.type = "sexual_activity";
        event.story_time = {display: null, normalized: null, day_index: null, calendar_id: null, precision: "unknown", confidence: null};
        event.location = "底舱";
        event.pregnancy_relevance.reproductive_mechanism = {
          kind: "intravaginal_exposure",
          label: "同一机制",
          pathway: "未知时间路径",
          world_model_rule_refs: [],
          evidence: [{kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND, text: `未知时间证据 ${analysisCount}`}],
        };
        event.source_evidence = [{kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND, text: `未知时间来源 ${analysisCount}`}];
        delete event.continuation_of_event_id;
        delete event.continuation_update;
        return {events: [event]};
      },
    },
  });
  fixture.context.chatMetadata.bioweave = {
    chat_scope: {chat_id: "chat-runtime"},
    settings: {recent_story: {enabled: true, floor_count: 2}},
  };

  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 0}, {force: true});
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 1}, {force: true});
  assert.equal(fixture.runtime.store.getFloor(1, 0).events.length, 2);
  fixture.runtime.destroy();
});

test("same-Floor subject and mechanism similarity without continuation license stays independent", async () => {
  let analysisCount = 0;
  const fixture = createFixture({
    messages: [
      {message_id: "same-floor-restart", floor: 66, content: "同楼层独立重启", role: "assistant"},
    ],
    analyzer: {
      async analyzeFloor({analysisInput}) {
        analysisCount += 1;
        const event = identityEventForCharacters(
          analysisInput.character_registry,
          "祁鸢",
          "金文达",
          `same-floor-${analysisCount}`,
        );
        event.type = "sexual_activity";
        event.story_time = {
          display: analysisCount === 1 ? "羲和1年3月4日 巳时" : "羲和1年3月4日 午时",
          normalized: analysisCount === 1 ? "cn-1-3-4T10:00" : "cn-1-3-4T12:00",
          calendar_id: null,
          day_index: null,
          precision: "hour",
          confidence: 1,
        };
        event.location = "底舱";
        event.pregnancy_relevance.reproductive_mechanism = {
          kind: "intravaginal_exposure",
          label: "阴道内交合暴露",
          pathway: "同一机制",
          world_model_rule_refs: [],
          evidence: [{
            kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND,
            text: `独立轮次证据 ${analysisCount}`,
          }],
        };
        event.source_evidence = [{
          kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND,
          text: `独立轮次来源 ${analysisCount}`,
        }];
        return {events: [event]};
      },
    },
  });
  fixture.context.chatMetadata.bioweave = {
    chat_scope: {chat_id: "chat-runtime"},
    settings: {recent_story: {enabled: true, floor_count: 2}},
  };

  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 0}, {force: true});
  await fixture.runtime.analyzeCurrentCharacterEvents();

  const events = fixture.runtime.store.getFloor(0, 0).events;
  assert.equal(events.length, 2);
  assert.notEqual(events[0].event_id, events[1].event_id);
  fixture.runtime.destroy();
});

test("marker-free continuity converges two historical stable duplicates", async () => {
  let analysisCount = 0;
  const storyTime = index => ({
    display: `羲和1年3月4日 ${index === 1 ? "巳时" : index === 2 ? "午时" : "未时"}`,
    normalized: `cn-1-3-4T${index === 1 ? "10" : index === 2 ? "12" : "14"}:00`,
    calendar_id: null,
    day_index: null,
    precision: "hour",
    confidence: 1,
  });
  const fixture = createFixture({
    reliableStoryTime: true,
    messages: [
      {message_id: "ambiguous-floor-66", floor: 66, content: "第一轮", role: "assistant"},
      {message_id: "ambiguous-floor-68", floor: 68, content: "明确重启", role: "assistant"},
      {message_id: "ambiguous-floor-70", floor: 70, content: "无法判定归属", role: "assistant"},
    ],
    analyzer: {
      async analyzeFloor({analysisInput}) {
        analysisCount += 1;
        const event = analysisCount === 1
          ? identityEventForCharacters(analysisInput.character_registry, "祁鸢", "金文达", "ambiguous")
          : stableContinuationEventFromInput(analysisInput, "祁鸢");
        event.type = "sexual_activity";
        event.story_time = storyTime(analysisCount);
        event.location = "底舱";
        event.pregnancy_relevance.reproductive_mechanism = {
          kind: "intravaginal_exposure",
          label: "阴道内交合暴露",
          pathway: "同一机制",
          world_model_rule_refs: [],
          evidence: [{
            kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND,
            text: `机制证据 ${analysisCount}`,
          }],
        };
        event.source_evidence = [{
          kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND,
          text: `来源证据 ${analysisCount}`,
        }];
        if (analysisCount === 2) {
          delete event.continuation_of_event_id;
          event.continuation_update = false;
        } else if (analysisCount === 3) {
          delete event.continuation_of_event_id;
          delete event.continuation_update;
        }
        return {events: [event]};
      },
    },
  });
  fixture.context.chatMetadata.bioweave = {
    chat_scope: {chat_id: "chat-runtime"},
    settings: {recent_story: {enabled: true, floor_count: 3}},
  };

  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 0}, {force: true});
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 1}, {force: true});
  assert.equal(fixture.runtime.store.getFloor(1, 0).events.length, 2);
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 2}, {force: true});

  const events = fixture.runtime.store.getFloor(2, 0).events;
  assert.equal(events.length, 1);
  assert.equal(events[0].event_id, fixture.runtime.store.getFloor(0, 0).events[0].event_id);
  assert.equal(events[0].source.floor, 66);
  assert.deepEqual(
    events[0].source_evidence.map(item => item.text).sort(),
    ["来源证据 1", "来源证据 2", "来源证据 3"],
  );
  const reconciliation = fixture.runtime.getPersistenceTrace().sequence
    .filter(entry => entry.stage === "EVENT_RECONCILIATION_RESULT")
    .at(-1);
  assert.ok(reconciliation);
  assert.deepEqual(reconciliation.continuation_diagnostics.at(-1), {
    continuation_reference_present: false,
    continuation_reference_event_id: null,
    continuation_reference_target_exists: false,
    continuation_reference_valid: false,
    continuation_merge_executed: false,
    continuation_rejection_reason: null,
    continuation_reconciliation_reason: "stable_duplicate_converged",
    continuation_reconciliation_event_id: fixture.runtime.store.getFloor(0, 0).events[0].event_id,
    continuation_reconciliation_removed_event_ids: [fixture.runtime.store.getFloor(1, 0).events[1].event_id],
  });
  assert.deepEqual(reconciliation.removal_reasons, [{
    event_id: fixture.runtime.store.getFloor(1, 0).events[1].event_id,
    reason: "stable_duplicate_converged",
  }]);
  fixture.runtime.destroy();
});

test("historical stable duplicate convergence respects the six-hour window", async () => {
  let analysisCount = 0;
  const storyTimes = ["10:00", "12:00", "20:00"];
  const fixture = createFixture({
    reliableStoryTime: true,
    messages: [
      {message_id: "stable-window-66", floor: 66, content: "第一轮", role: "assistant"},
      {message_id: "stable-window-68", floor: 68, content: "独立重复", role: "assistant"},
      {message_id: "stable-window-70", floor: 70, content: "长时间后再次出现", role: "assistant"},
    ],
    analyzer: {
      async analyzeFloor({analysisInput}) {
        analysisCount += 1;
        const event = analysisCount === 1
          ? identityEventForCharacters(analysisInput.character_registry, "祁鸢", "金文达", "stable-window")
          : stableContinuationEventFromInput(analysisInput, "祁鸢");
        event.type = "sexual_activity";
        event.story_time = {
          display: `羲和1年3月4日 ${storyTimes[analysisCount - 1]}`,
          normalized: `cn-1-3-4T${storyTimes[analysisCount - 1]}`,
          calendar_id: null,
          day_index: null,
          precision: "hour",
          confidence: 1,
        };
        event.location = "底舱";
        event.pregnancy_relevance.reproductive_mechanism = {
          kind: "intravaginal_exposure",
          label: "同一机制",
          pathway: "稳定路径",
          world_model_rule_refs: [],
          evidence: [{kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND, text: `机制证据 ${analysisCount}`}],
        };
        event.source_evidence = [{kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND, text: `来源证据 ${analysisCount}`}];
        if (analysisCount === 2) event.continuation_update = false;
        else {
          delete event.continuation_of_event_id;
          delete event.continuation_update;
        }
        return {events: [event]};
      },
    },
  });
  fixture.context.chatMetadata.bioweave = {
    chat_scope: {chat_id: "chat-runtime"},
    settings: {recent_story: {enabled: true, floor_count: 3}},
  };

  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 0}, {force: true});
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 1}, {force: true});
  const duplicateFloor = fixture.runtime.store.getFloor(1, 0);
  const duplicate = structuredClone(duplicateFloor.events[0]);
  duplicate.event_id = "stable-window-historical-duplicate";
  duplicate.source_evidence = [{kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND, text: "历史重复证据"}];
  duplicate.story_time = {
    display: "羲和1年3月4日 午时",
    normalized: "cn-1-3-4T12:00",
    calendar_id: null,
    day_index: null,
    precision: "hour",
    confidence: 1,
  };
  await fixture.runtime.store.saveFloor(1, 0, {
    ...duplicateFloor,
    events: [...duplicateFloor.events, duplicate],
  });
  assert.equal(fixture.runtime.store.getFloor(1, 0).events.length, 2);
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 2}, {force: true});
  assert.equal(
    fixture.runtime.store.getFloor(2, 0).events.length,
    3,
    "a 20:00 candidate must not converge 10:00/12:00 historical duplicates",
  );
  fixture.runtime.destroy();
});

test("manual Character reanalysis converges an explicitly referenced current-Floor duplicate", async () => {
  let analysisCount = 0;
  let persistedA = null;
  let persistedB = null;
  const storyTime = {
    display: "羲和1年3月20日 午时",
    normalized: "cn-1-3-20T11:00",
    calendar_id: null,
    day_index: null,
    precision: "hour",
    confidence: 1,
  };
  const fixture = createFixture({
    messages: [
      {message_id: "floor-66-converge", floor: 66, content: "持续互动开始", role: "assistant"},
      {message_id: "floor-68-converge", floor: 68, content: "持续互动继续", role: "assistant"},
    ],
    analyzer: {
      async analyzeFloor({analysisInput}) {
        analysisCount += 1;
        if (analysisCount < 3) {
          const candidate = identityEventForCharacters(
            analysisInput.character_registry,
            "祁鸢",
            "金文达",
            `converge-${analysisCount}`,
          );
          candidate.type = "sexual_activity";
          candidate.story_time = storyTime;
          candidate.location = "底舱";
          candidate.source_evidence = [{
            kind: "pregnancy_relevant_exposure",
            text: analysisCount === 1 ? "连续场景 A" : "连续场景 B",
          }];
          return {events: [candidate]};
        }
        const continuation = structuredClone(persistedB);
        delete continuation.event_id;
        delete continuation.source;
        continuation.participants = continuation.participants.map(participant => ({
          ...participant,
          identity_status: "existing",
          mention_id: null,
        }));
        continuation.continuation_of_event_id = persistedA.event_id;
        continuation.continuation_update = true;
        return {events: [continuation]};
      },
    },
  });
  fixture.context.chatMetadata.bioweave = {
    chat_scope: {chat_id: "chat-runtime"},
    settings: {recent_story: {enabled: true, floor_count: 2}},
  };

  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 0}, {force: true});
  persistedA = structuredClone(fixture.runtime.store.getFloor(0, 0).events[0]);
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 1}, {force: true});
  const currentFloor = fixture.runtime.store.getFloor(1, 0);
  const targetFloor = await fixture.runtime.resolveCurrentBioWeaveFloor({__messageIndex: true, index: 1});
  persistedB = {
    ...structuredClone(persistedA),
    event_id: "evt_converge_duplicate_2",
    source: structuredClone(targetFloor.version),
    source_evidence: [{
      kind: "pregnancy_relevant_exposure",
      text: "连续场景 B",
    }],
  };
  await fixture.runtime.store.saveFloor(1, 0, {
    ...currentFloor,
    events: [persistedA, persistedB],
  });
  const before = fixture.runtime.store.getFloor(1, 0).events.map(event => event.event_id);
  assert.ok(before.includes(persistedA.event_id));
  assert.ok(before.includes(persistedB.event_id));

  await fixture.runtime.analyzeCurrentCharacterEvents();

  const after = fixture.runtime.store.getFloor(1, 0).events;
  assert.deepEqual(after.map(event => event.event_id), [persistedA.event_id]);
  assert.equal(after[0].source.floor, 66);
  assert.deepEqual(
    after[0].source_evidence.map(item => item.text).sort(),
    ["连续场景 A", "连续场景 B"],
  );
  assert.equal(Object.hasOwn(after[0], "continuation_of_event_id"), false);
  assert.equal(Object.hasOwn(after[0], "continuation_update"), false);
  fixture.runtime.destroy();
});

test("explicit historical continuation converges same stable duplicates into the referenced Event", async () => {
  let analysisCount = 0;
  let persistedA = null;
  let persistedB = null;
  const storyTime = index => ({
    display: `羲和1年3月4日 ${index === 1 ? "巳时" : index === 2 ? "午时" : "戌时"}`,
    normalized: `cn-1-3-4T${index === 1 ? "10:00" : index === 2 ? "12:00" : "20:00"}`,
    calendar_id: null,
    day_index: null,
    precision: "hour",
    confidence: 1,
  });
  const fixture = createFixture({
    reliableStoryTime: false,
    messages: [
      {message_id: "explicit-historical-66", floor: 66, content: "第一轮", role: "assistant"},
      {message_id: "explicit-historical-68", floor: 68, content: "重复记录", role: "assistant"},
      {message_id: "explicit-historical-70", floor: 70, content: "明确继续", role: "assistant"},
    ],
    analyzer: {
      async analyzeFloor({analysisInput}) {
        analysisCount += 1;
        if (analysisCount === 3) {
          const continuation = structuredClone(persistedB);
          delete continuation.event_id;
          delete continuation.source;
          continuation.participants = continuation.participants.map((participant) => ({
            ...participant,
            identity_status: "existing",
            mention_id: null,
          }));
          continuation.source_evidence = [{
            kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND,
            text: "明确继续证据",
          }];
          continuation.continuation_of_event_id = persistedB.event_id;
          continuation.continuation_update = true;
          return {events: [continuation]};
        }
        const event = identityEventForCharacters(
          analysisInput.character_registry,
          "祁鸢",
          "金文达",
          `explicit-historical-${analysisCount}`,
        );
        event.type = "sexual_activity";
        event.story_time = storyTime(analysisCount);
        event.location = "底舱";
        event.pregnancy_relevance.reproductive_mechanism = {
          kind: "intravaginal_exposure",
          label: "阴道内交合暴露",
          pathway: "同一机制",
          world_model_rule_refs: [],
          evidence: [{
            kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND,
            text: `机制证据 ${analysisCount}`,
          }],
        };
        event.source_evidence = [{
          kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND,
          text: `来源证据 ${analysisCount}`,
        }];
        if (analysisCount === 2) event.continuation_update = false;
        return {events: [event]};
      },
    },
  });
  fixture.context.chatMetadata.bioweave = {
    chat_scope: {chat_id: "chat-runtime"},
    settings: {recent_story: {enabled: true, floor_count: 3}},
  };

  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 0}, {force: true});
  persistedA = structuredClone(fixture.runtime.store.getFloor(0, 0).events[0]);
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 1}, {force: true});
  persistedB = structuredClone(
    fixture.runtime.store.getFloor(1, 0).events.find(event => event.event_id !== persistedA.event_id),
  );
  assert.ok(persistedB);
  assert.equal(fixture.runtime.store.getFloor(1, 0).events.length, 2);

  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 2}, {force: true});

  const events = fixture.runtime.store.getFloor(2, 0).events;
  assert.equal(events.length, 1);
  assert.equal(events[0].event_id, persistedB.event_id);
  assert.equal(events[0].source.floor, 68);
  assert.deepEqual(
    events[0].source_evidence.map(item => item.text).sort(),
    ["明确继续证据", "来源证据 1", "来源证据 2"].sort(),
  );
  const reconciliation = fixture.runtime.getPersistenceTrace().sequence
    .filter(entry => entry.stage === "EVENT_RECONCILIATION_RESULT")
    .at(-1);
  assert.deepEqual(reconciliation.removal_reasons, [{
    event_id: persistedA.event_id,
    reason: "stable_duplicate_converged",
  }]);
  fixture.runtime.destroy();
});

test("invalid continuation references do not force a cross-Floor merge", async () => {
  let analysisCount = 0;
  const storyTime = {
    display: "羲和1年3月20日 午时",
    normalized: "cn-1-3-20T11:00",
    calendar_id: null,
    day_index: null,
    precision: "hour",
    confidence: 1,
  };
  const fixture = createFixture({
    messages: [
      {message_id: "floor-66-invalid-ref", floor: 66, content: "持续互动开始", role: "assistant"},
      {message_id: "floor-68-invalid-ref", floor: 68, content: "另一件互动", role: "assistant"},
    ],
    analyzer: {
      async analyzeFloor({analysisInput}) {
        analysisCount += 1;
        const candidate = identityEventForCharacters(
          analysisInput.character_registry,
          "祁鸢",
          "金文达",
          `invalid-ref-${analysisCount}`,
        );
        candidate.type = "sexual_activity";
        candidate.story_time = storyTime;
        candidate.location = "底舱";
        candidate.pregnancy_relevance.reproductive_mechanism = {
          kind: "intravaginal_exposure",
          label: "阴道内交合暴露",
          pathway: `描述 ${analysisCount}`,
          world_model_rule_refs: [],
          evidence: [{kind: "pregnancy_relevant_exposure", text: `证据 ${analysisCount}`}],
        };
        candidate.source_evidence = [{
          kind: "pregnancy_relevant_exposure",
          text: `证据 ${analysisCount}`,
        }];
        if (analysisCount > 1) {
          candidate.continuation_of_event_id = "evt-not-visible-in-current-floor";
          candidate.continuation_update = true;
        }
        return {events: [candidate]};
      },
    },
  });
  fixture.context.chatMetadata.bioweave = {
    chat_scope: {chat_id: "chat-runtime"},
    settings: {recent_story: {enabled: true, floor_count: 2}},
  };

  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 0}, {force: true});
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 1}, {force: true});
  const currentEvents = await fixture.runtime.getCurrentFloorEvents();
  assert.equal(currentEvents.length, 2);
  assert.notEqual(currentEvents[0].event_id, currentEvents[1].event_id);
  fixture.runtime.destroy();
});

test("continuation with disjoint World Model rule references does not merge", async () => {
  let analysisCount = 0;
  const storyTime = {
    display: "羲和1年3月20日 午时",
    normalized: "cn-1-3-20T11:00",
    calendar_id: null,
    day_index: null,
    precision: "hour",
    confidence: 1,
  };
  const fixture = createFixture({
    messages: [
      {message_id: "floor-66-rule-a", floor: 66, content: "机制 A", role: "assistant"},
      {message_id: "floor-68-rule-b", floor: 68, content: "机制 B", role: "assistant"},
    ],
    analyzer: {
      async analyzeFloor({analysisInput}) {
        analysisCount += 1;
        const event = analysisCount === 1
          ? identityEventForCharacters(analysisInput.character_registry, "祁鸢", "金文达", "rule-conflict")
          : stableContinuationEventFromInput(analysisInput, "祁鸢");
        event.type = "sexual_activity";
        event.story_time = storyTime;
        event.location = "底舱";
        event.pregnancy_relevance.reproductive_mechanism = {
          kind: "intravaginal_exposure",
          pathway: "同一结构路径",
          world_model_rule_refs: [analysisCount === 1 ? "rule-a" : "rule-b"],
          evidence: [{kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND, text: `规则证据 ${analysisCount}`}],
        };
        event.source_evidence = [{
          kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND,
          text: `来源证据 ${analysisCount}`,
        }];
        return {events: [event]};
      },
    },
  });
  fixture.context.chatMetadata.bioweave = {
    chat_scope: {chat_id: "chat-runtime"},
    settings: {recent_story: {enabled: true, floor_count: 2}},
  };
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 0}, {force: true});
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 1}, {force: true});
  assert.equal(fixture.runtime.store.getFloor(1, 0).events.length, 2);
  fixture.runtime.destroy();
});

test("a validated continuation without a meaningful update preserves the existing Event", async () => {
  let analysisCount = 0;
  let persisted = null;
  const storyTime = {
    display: "羲和1年3月20日 午时",
    normalized: "cn-1-3-20T11:00",
    calendar_id: null,
    day_index: null,
    precision: "hour",
    confidence: 1,
  };
  const fixture = createFixture({
    messages: [
      {message_id: "floor-66-no-update", floor: 66, content: "持续互动开始", role: "assistant"},
      {message_id: "floor-68-no-update", floor: 68, content: "重复描述", role: "assistant"},
    ],
    analyzer: {
      async analyzeFloor({analysisInput}) {
        analysisCount += 1;
        const candidate = identityEventForCharacters(
          analysisInput.character_registry,
          "祁鸢",
          "金文达",
          `no-update-${analysisCount}`,
        );
        candidate.type = "sexual_activity";
        candidate.story_time = storyTime;
        candidate.location = "底舱";
        candidate.pregnancy_relevance.reproductive_mechanism = {
          kind: "intravaginal_exposure",
          label: "阴道内交合暴露",
          pathway: "描述 A",
          world_model_rule_refs: [],
          evidence: [{kind: "pregnancy_relevant_exposure", text: "证据 A"}],
        };
        candidate.source_evidence = [{
          kind: "pregnancy_relevant_exposure",
          text: "证据 A",
        }];
        if (analysisCount > 1) {
          candidate.continuation_of_event_id = persisted?.event_id;
          candidate.continuation_update = false;
        }
        return {events: [candidate]};
      },
    },
  });
  fixture.context.chatMetadata.bioweave = {
    chat_scope: {chat_id: "chat-runtime"},
    settings: {recent_story: {enabled: true, floor_count: 2}},
  };

  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 0}, {force: true});
  persisted = structuredClone(fixture.runtime.store.getFloor(0, 0).events[0]);
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 1}, {force: true});
  const currentEvents = await fixture.runtime.getCurrentFloorEvents();
  assert.deepEqual(currentEvents, [persisted]);
  fixture.runtime.destroy();
});

test("historical exposure and current symptom keep separate times under the current Floor owner", async () => {
  const exposure = eventResult("historical-exposure", {
    participants: eventResult("historical-exposure").participants.map((participant, index) => ({
      ...participant,
      display_name: index === 0 ? "沈祁鸢" : "实际 conception source",
    })),
    story_time: {
      display: "天河四十二年夏 六月初十 寅时末",
      normalized: "cn-42-6-10T03:30",
      calendar_id: null,
      day_index: null,
      precision: "minute",
      confidence: null,
    },
    source_evidence: [
      {kind: PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_KIND, text: "明确历史 exposure"},
    ],
  });
  const symptom = {
    type: "physical_symptom",
    status: "confirmed",
    story_time: {
      display: "天河四十二年夏 六月初十 辰时",
      normalized: "cn-42-6-10T07:00",
      calendar_id: null,
      day_index: null,
      precision: "hour",
      confidence: null,
    },
    location: "偏厅",
    participants: [{
      ...structuredClone(exposure.participants[0]),
      event_role: "other_participant",
    }],
    pregnancy_relevance: {
      relevant: false,
      possible_conception: false,
      gestational_subject_ids: [],
      counterpart_ids: [],
      reproductive_mechanism: {
        kind: "none",
        label: "无",
        pathway: "无",
        world_model_rule_refs: [],
        evidence: [],
      },
      confidence: null,
    },
    state_fact: {
      subject_id: "historical-exposure-subject",
      payload: {symptom: {kind: "soreness", description: "当前身体症状"}},
    },
    source_evidence: [{kind: "symptom_evidence", text: "当前 physical symptom"}],
  };
  const fixture = createFixture({
    messages: [
      {message_id: "message-history", floor: 1, content: "寅时末，沈祁鸢与实际 source 发生明确体内暴露", role: "assistant"},
      {message_id: "message-target", floor: 2, content: "辰时，沈祁鸢出现当前 physical symptom", role: "assistant"},
    ],
    analyzer: {
      async analyzeFloor() {
        return {events: [exposure, symptom]};
      },
    },
  });
  fixture.context.chatMetadata.bioweave = {
    chat_scope: {chat_id: "chat-runtime"},
    settings: {recent_story: {enabled: true, floor_count: 2}},
  };
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 1}, {force: true});

  const events = await fixture.runtime.getCurrentFloorEvents();
  const persistedExposure = events.find((item) => item.type === "sexual_activity");
  const persistedSymptom = events.find((item) => item.type === "physical_symptom");
  assert.equal(events.length, 2);
  assert.equal(persistedExposure.story_time.normalized, "cn-42-6-10T03:30");
  assert.equal(persistedSymptom.story_time.normalized, "cn-42-6-10T07:00");
  assert.equal(persistedExposure.source.floor, 2);
  assert.equal(persistedSymptom.source.floor, 2);
  assert.equal(persistedExposure.participants[0].display_name, "沈祁鸢");
  assert.equal(persistedSymptom.pregnancy_relevance.relevant, false);
  const business = await fixture.runtime.collectActiveBusinessData();
  assert.equal(Object.keys(business.tracking_subjects).length, 1);
  fixture.runtime.destroy();
});

test("API input uses the nearest valid previous Floor Version provenance", async () => {
  const inputs = [];
  const fixture = createFixture({
    reliableStoryTime: true,
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
          events: [fixtureContinuationEvent(
            request.analysisInput,
            eventResultForRegistry(request.analysisInput.character_registry),
          )],
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
    ["message-1"],
  );
  await fixture.runtime.analyzeFloor(
    { __messageIndex: true, index: 2 },
    { force: true },
  );
  const reanalysis = inputs.at(-1).existing_bioweave;
  assert.equal(reanalysis.analysis.floor_version.message_id, "message-2");
  assert.deepEqual(
    reanalysis.events.map((event) => event.source.message_id),
    ["message-1"],
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
    reliableStoryTime: true,
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
          events: [fixtureContinuationEvent(
            request.analysisInput,
            eventResultForRegistry(request.analysisInput.character_registry),
          )],
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
    ["message-3"],
  );
  assert.deepEqual(
    fixture.runtime.store.getFloor(2, 0).events.map((event) => event.source.message_id),
    ["message-3"],
  );
  fixture.runtime.destroy();
});

test("historical target analysis does not inherit a later complete Event or Registry state", async () => {
  const inputs = [];
  const fixture = createFixture({
    messages: [
      {message_id: "message-100", floor: 100, content: "基线楼层", role: "assistant"},
      {message_id: "message-250", floor: 250, content: "历史目标楼层", role: "assistant"},
      {message_id: "message-400", floor: 400, content: "未来楼层", role: "assistant"},
    ],
    analyzer: {
      async analyzeFloor({analysisInput}) {
        inputs.push(analysisInput);
        return {
          events: [eventResultForRegistry(
            analysisInput.character_registry,
            `event-${inputs.length}`,
          )],
        };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 0}, {force: true});
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 2}, {force: true});
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 1}, {force: true});

  const historicalInput = inputs.at(-1);
  assert.equal(historicalInput.current_floor.message_id, "message-250");
  assert.equal(historicalInput.existing_bioweave.analysis.floor_version.message_id, "message-100");
  assert.deepEqual(
    historicalInput.existing_bioweave.events.map(event => event.source.message_id),
    ["message-100"],
  );
  assert.doesNotMatch(JSON.stringify(historicalInput), /message-400/u);
  const stableHistoricalInput = JSON.stringify(historicalInput);
  fixture.context.chat[2].content = "未来楼层被编辑";
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 1}, {force: true});
  assert.equal(JSON.stringify(inputs.at(-1)), stableHistoricalInput);
  fixture.context.chat.splice(2, 1);
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 1}, {force: true});
  assert.equal(JSON.stringify(inputs.at(-1)), stableHistoricalInput);
  fixture.runtime.destroy();
});

test("deleted latest Floor falls back to the nearest remaining valid previous Floor", async () => {
  const inputs = [];
  const fixture = createFixture({
    reliableStoryTime: true,
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
          events: [fixtureContinuationEvent(
            request.analysisInput,
            eventResultForRegistry(
              request.analysisInput.character_registry,
              `event-${inputs.length}`,
            ),
          )],
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
    ["message-3"],
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
  const downstreamEventId = fixture.runtime.store.getFloor(2).events
    .find(event => event.source?.message_id === "message-downstream")?.event_id;

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
  const deletedEventId = fixture.runtime.store.getFloor(1).events
    .find(event => event.source?.message_id === "message-latest")?.event_id;
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
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(event => event.location), ["prior", "final"]);
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

test("World response validation failure stops without repeating the AI request", async () => {
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
  await assert.rejects(
    fixture.runtime.analyzeFloor({ __messageIndex: true, index: 0 }, { force: true }),
    /WORLD_MODEL_UNAVAILABLE|WORLD_SCHEMA_INVALID|WORLD_MODEL_INVALID/u,
  );
  assert.equal(worldCalls, 1);
  assert.equal(eventCalls, 0);
  const traces = fixture.runtime.getPersistenceTrace().sequence;
  assert.deepEqual(
    traces.filter(item => item.domain === "world" && item.stage === "WORLD_STAGE_ATTEMPT_BEGIN")
      .map(item => [item.attempt, item.retry_index]),
    [[1, 0]],
  );
  assert.ok(traces.some(item => item.stage === "WORLD_STAGE_ATTEMPT_FAILED" &&
    item.retryable === false && item.retry_decision === "stop"));
  fixture.runtime.destroy();
});

test("Event domain validation failure stops without repeating the AI request", async () => {
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
  await assert.rejects(
    fixture.runtime.analyzeFloor({ __messageIndex: true, index: 0 }, { force: true }),
    /EVENT_DOMAIN_VALIDATION_FAILED/u,
  );
  assert.equal(worldCalls, 1);
  assert.equal(eventCalls, 1);
  const failure = fixture.runtime.getPersistenceTrace().sequence.find(
    item => item.stage === "EVENT_STAGE_ATTEMPT_FAILED",
  );
  assert.equal(failure.retryable, false);
  assert.equal(failure.retry_decision, "stop");
  fixture.runtime.destroy();
});

test("Runtime retry_count does not repeat a failed World request", async () => {
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
  assert.equal(worldCalls, 1);
  assert.equal(eventCalls, 0);
  fixture.runtime.destroy();
});

test("manual World Patch response validation failure does not repeat the AI request", async () => {
  let patchCalls = 0;
  const fixture = createFixture({
    retryCount: 1,
    messages: [
      { message_id: "patch-owner-manual", floor: 1, content: "已有世界", role: "assistant" },
      { message_id: "patch-target-manual", floor: 2, content: "补充世界规则", role: "assistant" },
    ],
    analyzer: {
      async analyzeWorldModelPatchV2() {
        patchCalls += 1;
        if (patchCalls === 1) throw Object.assign(new Error("PATCH_SCHEMA"), {
          code: "WORLD_PATCH_SCHEMA_INVALID",
          analysis_stage: "schema_validation",
        });
        return {patch: {schema_version: 2, operations: []}, classified: []};
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
  await assert.rejects(
    fixture.runtime.analyzeCurrentWorldModelPatch({analysisInput: {}, trigger: "manual-patch"}),
    /PATCH_SCHEMA|WORLD_MODEL_PATCH/u,
  );
  assert.equal(patchCalls, 1);
  fixture.runtime.destroy();
});

test("incomplete World Supplement is diagnosed locally without a semantic retry", async () => {
  let patchCalls = 0;
  const fixture = createFixture({
    retryCount: 1,
    messages: [
      { message_id: "world-owner", floor: 3, content: "已有世界规则", role: "assistant" },
      { message_id: "current-floor", floor: 6, content: "补充世界规则", role: "assistant" },
    ],
    analyzer: {
      async analyzeWorldModelPatchV2() {
        patchCalls += 1;
        if (patchCalls === 1) throw Object.assign(new Error("WORLD_MODEL_SUPPLEMENT_INCOMPLETE"), {
          code: "WORLD_MODEL_SUPPLEMENT_INCOMPLETE",
          analysis_stage: "supplement_completeness",
          diagnostics: [{missing: [{target_id: "coverage-target-v1-0001"}], invalid: []}],
        });
        return {patch: {schema_version: 2, operations: []}, classified: []};
      },
    },
  });
  await fixture.runtime.init();
  await seedWorldOwner(fixture, normalizeWorldModel({schema_version: 1, species: [{name: "Species-A"}]}));
  await fixture.runtime.analyzeCurrentWorldModelPatch({trigger: "manual-patch"});
  assert.equal(patchCalls, 1);
  assert.deepEqual(
    fixture.runtime.getPersistenceTrace().sequence.filter(item => item.stage === "WORLD_STAGE_ATTEMPT_BEGIN").map(item => item.attempt),
    [1],
  );
  assert.equal(fixture.runtime.getPersistenceTrace().sequence.some(item => item.stage === "WORLD_PERSISTENCE_CONFIRMED"), false);
  assert.equal(fixture.runtime.getWorldModelDiagnosticState().latest_fact_delta.semantic_incomplete, true);
  fixture.runtime.destroy();
});

test("automatic Supplement semantic incompleteness does not consume the retry budget", async () => {
  let patchCalls = 0;
  const inputs = [];
  const fixture = createFixture({
    retryCount: 1,
    messages: [
      { message_id: "world-owner", floor: 3, content: "已有世界规则", role: "assistant" },
      { message_id: "current-floor", floor: 6, content: "补充世界规则", role: "assistant" },
    ],
    analyzer: {
      async analyzeWorldModelPatchV2(input) {
        patchCalls += 1;
        inputs.push(input);
        if (patchCalls === 1) throw Object.assign(new Error("WORLD_MODEL_SUPPLEMENT_INCOMPLETE"), {
          code: "WORLD_MODEL_SUPPLEMENT_INCOMPLETE",
          analysis_stage: "supplement_completeness",
          diagnostics: [{invalid: [{target_id: "coverage-target-v1-0001", reason: "emitted_fact_count_must_equal_one"}]}],
        });
        return {patch: {schema_version: 2, operations: []}, classified: []};
      },
    },
  });
  await fixture.runtime.init();
  await seedWorldOwner(fixture, normalizeWorldModel({schema_version: 1, species: [{name: "Species-A"}]}));
  await fixture.runtime.analyzeCurrentWorldModelPatch({trigger: "automatic-supplement"});
  assert.equal(patchCalls, 1);
  assert.equal(inputs[0].analysisInput.supplement_request_mode, "INITIAL");
  assert.equal(inputs.length, 1);
  fixture.runtime.destroy();
});

test("incomplete World Supplement with no mutation is a local no-change result", async () => {
  let patchCalls = 0;
  const fixture = createFixture({
    retryCount: 1,
    messages: [
      { message_id: "world-owner", floor: 3, content: "已有世界规则", role: "assistant" },
      { message_id: "current-floor", floor: 6, content: "补充世界规则", role: "assistant" },
    ],
    analyzer: {
      async analyzeWorldModelPatchV2() {
        patchCalls += 1;
        throw Object.assign(new Error("WORLD_MODEL_SUPPLEMENT_INCOMPLETE"), {
          code: "WORLD_MODEL_SUPPLEMENT_INCOMPLETE",
          analysis_stage: "supplement_completeness",
          diagnostics: [{missing: [{target_id: "coverage-target-v1-0001"}], invalid: []}],
        });
      },
    },
  });
  await fixture.runtime.init();
  await seedWorldOwner(fixture, normalizeWorldModel({schema_version: 1, species: [{name: "Species-A"}]}));
  const beforeWrites = fixture.saveFloorCalls();
  await fixture.runtime.analyzeCurrentWorldModelPatch({trigger: "manual-patch"});
  assert.equal(patchCalls, 1);
  assert.equal(fixture.saveFloorCalls(), beforeWrites);
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

test("interval counts only new Character Floors and ignores User lifecycle events", async () => {
  const fixture = createFixture({
    messages: [{ message_id: "interval-user-0", floor: 0, content: "用户", role: "user" }],
  });
  configureScheduler(fixture, { interval: 3 });
  await fixture.runtime.init();

  const assertCounter = expected => {
    assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().counter, expected);
  };

  fixture.emit("message-received", { message_id: "interval-user-0" });
  fixture.emit("generation-ended", { message_id: "interval-user-0" });
  await settle();
  assertCounter(0);

  appendCharacter(fixture, "interval-character-a", 1, "Character A");
  await settle();
  assertCounter(1);

  fixture.context.chat.push({ message_id: "interval-user-1", floor: 2, content: "用户 1", role: "user" });
  fixture.emit("message-received", { message_id: "interval-user-1" });
  fixture.emit("generation-ended", { message_id: "interval-user-1" });
  await settle();
  assertCounter(1);

  appendCharacter(fixture, "interval-character-b", 3, "Character B");
  await settle();
  assertCounter(2);

  fixture.context.chat.push({ message_id: "interval-user-2", floor: 4, content: "用户 2", role: "user" });
  fixture.emit("message-received", { message_id: "interval-user-2" });
  fixture.emit("generation-ended", { message_id: "interval-user-2" });
  await settle();
  assertCounter(2);

  appendCharacter(fixture, "interval-character-c", 5, "Character C");
  await settle();
  const state = fixture.runtime.getAutoAnalysisSchedulerState();
  assert.equal(state.counter, 3);
  assert.equal(fixture.calls(), 1);
  const decision = fixture.runtime.getPersistenceTrace().sequence
    .filter(entry => entry.stage === "AUTO_SCHEDULER_DECISION")
    .at(-1);
  assert.equal(decision.counter_before, 2);
  assert.equal(decision.counter_after, 3);
  assert.equal(decision.decision, "interval-due");
  fixture.runtime.destroy();
});

test("Character interval does not block internal built-in Projection stage advancement", async () => {
  let eventCalls = 0;
  const exposure = eventResult("internal-stage-exposure", {
    story_time: {
      display: "2026-01-01",
      normalized: "2026-01-01",
      day_index: null,
      calendar_id: null,
      precision: "day",
      confidence: 1,
    },
    pregnancy_relevance: {
      ...eventResult("internal-stage-exposure").pregnancy_relevance,
      reproductive_mechanism: {kind: "fertilization"},
    },
  });
  const worldModel = normalizeWorldModel({
    schema_version: 1,
    species: [{name: "species-a", biological_types: [{name: "type-a", capabilities: {can_carry_pregnancy: true}}]}],
    projection_rules: [],
  });
  const storyTime = day => ({
    display: `2026-01-${String(day + 1).padStart(2, "0")}`,
    normalized: `2026-01-${String(day + 1).padStart(2, "0")}`,
    day_index: null,
    calendar_id: null,
    precision: "day",
    confidence: 1,
  });
  const fixture = createFixture({
    messages: [{message_id: "internal-stage-17", floor: 17, content: "第 17 天正文", role: "assistant", story_time: storyTime(17)}],
    projectionTimingBaselineResolver: async () => ({
      schema_version: 1,
      config_version: 1,
      base_min_story_days: 0,
      base_max_story_days: 42,
      variance_ratio: 0,
      variance_cap_story_days: 0,
      total_adjustment_cap_story_days: 0,
    }),
    analyzer: {
      async analyzeWorldModel() {
        return worldModel;
      },
      async analyzeFloor() {
        eventCalls += 1;
        return {events: [exposure]};
      },
      async generateProjection() {
        throw new Error("INTERNAL_BUILT_IN_ROUTE_MUST_NOT_CALL_PROJECTION_API");
      },
    },
  });
  configureScheduler(fixture, {interval: 3});
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  await fixture.runtime.refreshProjection();

  fixture.context.chat.push({message_id: "internal-stage-23", floor: 23, content: "第 23 天正文", role: "assistant", story_time: storyTime(23)});
  fixture.emit("character-message-rendered", {message_id: "internal-stage-23"});
  await settle();
  await settle();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const completed = fixture.runtime.getPersistenceTrace().sequence.some(entry =>
      entry.stage === "PROJECTION_READBACK" && entry.floor === 23,
    );
    if (completed) break;
    await settle();
  }

  assert.equal(eventCalls, 1);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().counter, 1);
  const current = await fixture.runtime.getProjectionViews({chatId: "chat-runtime", endpointFloor: 23, endpointIndex: 1});
  assert.deepEqual(
    current.all.map(item => item.development_concern_key).sort(),
    [
      "pre_confirmation_observation:appetite_change",
      "pre_confirmation_observation:mood_change",
      "pre_confirmation_observation:nausea",
      "pre_confirmation_observation:odor_discomfort",
    ].sort(),
  );
  assert.ok(fixture.runtime.getPersistenceTrace().sequence.some(entry =>
    entry.stage === "AUTO_SCHEDULER_DECISION" && entry.decision === "character-interval",
  ));
  fixture.runtime.destroy();
});

test("scheduler rebases on the current valid timeline after a successful baseline", async () => {
  const fixture = createFixture({
    messages: [{ message_id: "timeline-58", floor: 58, content: "Floor 58", role: "assistant" }],
  });
  configureScheduler(fixture, { interval: 3 });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();

  const floor60Settled = waitForLifecycleSettled(fixture, "CHARACTER_MESSAGE_RENDERED");
  appendCharacter(fixture, "timeline-60", 60, "Floor 60");
  await floor60Settled;
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().counter, 1);
  const floor62Settled = waitForLifecycleSettled(fixture, "CHARACTER_MESSAGE_RENDERED");
  appendCharacter(fixture, "timeline-62", 62, "Floor 62");
  await floor62Settled;
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().counter, 2);
  const floor64Settled = waitForLifecycleSettled(fixture, "CHARACTER_MESSAGE_RENDERED");
  appendCharacter(fixture, "timeline-64", 64, "Floor 64");
  await floor64Settled;

  assert.equal(fixture.calls(), 2); // one baseline refresh + one automatic analysis
  const state = fixture.runtime.getAutoAnalysisSchedulerState();
  assert.equal(state.counter, 0);
  assert.equal(state.countedFloorKeys.length, 0);
  fixture.runtime.destroy();
});

test("reroll creates a normal timeline member instead of bypassing interval", async () => {
  const fixture = createFixture({
    messages: [{ message_id: "timeline-58-reroll", floor: 58, content: "Floor 58", role: "assistant" }],
  });
  configureScheduler(fixture, { interval: 3 });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();

  const floor60Settled = waitForLifecycleSettled(fixture, "CHARACTER_MESSAGE_RENDERED");
  appendCharacter(fixture, "timeline-60-reroll", 60, "Floor 60");
  await floor60Settled;
  fixture.context.chat.push({
    message_id: "timeline-62-reroll",
    floor: 62,
    content: "Floor 62 reroll",
    role: "assistant",
  });
  await fixture.emit("generation-started", {
    genType: "regenerate",
    message_id: "timeline-62-reroll",
  });
  await fixture.emit("generation-ended", { message_id: "timeline-62-reroll" });
  const rerollSettled = waitForLifecycleSettled(fixture, "CHARACTER_MESSAGE_RENDERED");
  await fixture.emit("character-message-rendered", { message_id: "timeline-62-reroll" });
  await rerollSettled;
  assert.equal(fixture.calls(), 1);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().counter, 2);

  const floor64Settled = waitForLifecycleSettled(fixture, "CHARACTER_MESSAGE_RENDERED");
  appendCharacter(fixture, "timeline-64-reroll", 64, "Floor 64");
  await floor64Settled;
  assert.equal(fixture.calls(), 2);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().counter, 0);
  const decision = fixture.runtime.getPersistenceTrace().sequence
    .filter(entry => entry.stage === "AUTO_SCHEDULER_DECISION")
    .find(entry => entry.message_id === "timeline-62-reroll");
  assert.equal(decision?.decision, "character-interval");
  assert.equal(decision?.force, false);
  fixture.runtime.destroy();
});

test("scheduler reconciliation removes deleted Floor keys and restores the interval", async () => {
  const fixture = createFixture({
    messages: [{ message_id: "rollback-58", floor: 58, content: "Floor 58", role: "assistant" }],
  });
  try {
    configureScheduler(fixture, { interval: 3 });
    await fixture.runtime.init();
    await fixture.runtime.refreshCurrentFloorAnalysis();

  for (const [messageId, floor] of [["rollback-60", 60], ["rollback-62", 62]]) {
    const rendered = waitForLifecycleSettled(fixture, "CHARACTER_MESSAGE_RENDERED");
    appendCharacter(fixture, messageId, floor, `Floor ${floor}`);
    await rendered;
  }
  const oldFloorAnalysis = waitForLifecycleSettled(fixture, "CHARACTER_MESSAGE_RENDERED");
  appendCharacter(fixture, "rollback-64", 64, "Floor 64");
  await oldFloorAnalysis;
  assert.deepEqual(
    fixture.analysisCalls().map(call => call?.message_id),
    ["rollback-58", "rollback-64"],
  );
  assert.deepEqual(Object.keys(fixture.analysisCalls()[1]).sort(), [
    "chat_id",
    "content_hash",
    "floor",
    "message_id",
    "message_version",
    "swipe_id",
  ]);
  assert.equal(fixture.analysisCalls()[1].chat_id, "chat-runtime");
  assert.equal(fixture.analysisCalls()[1].floor, 64);
  assert.equal(fixture.analysisCalls()[1].swipe_id, 0);
  assert.ok(fixture.analysisCalls()[1].content_hash);
  assert.ok(fixture.analysisCalls()[1].message_version);
  fixture.context.chat.push({ message_id: "rollback-66", floor: 66, content: "Floor 66", role: "assistant" });

  fixture.context.chat.splice(3, 2);
  const deletionSettled = waitForLifecycleSettled(fixture, "MESSAGE_DELETED");
  fixture.emit("message-deleted", { message_id: "rollback-64" });
  await deletionSettled;
  let state = fixture.runtime.getAutoAnalysisSchedulerState();
  assert.equal(state.counter, 2);
  assert.equal(state.countedFloorKeys.length, 2);
  assert.equal(state.observedFloorKeys.some(key => key.includes("rollback-64")), false);
  assert.equal(state.observedFloorKeys.some(key => key.includes("rollback-66")), false);

  const replacementAnalysis = waitForLifecycleSettled(fixture, "CHARACTER_MESSAGE_RENDERED");
  appendCharacter(fixture, "rollback-64-new", 64, "Floor 64 new");
  await replacementAnalysis;
  state = fixture.runtime.getAutoAnalysisSchedulerState();
  assert.equal(state.counter, 0);
  assert.equal(fixture.calls(), 3); // baseline + already-started deleted 64 + replacement
  assert.deepEqual(
    fixture.analysisCalls().map(call => call?.message_id),
    ["rollback-58", "rollback-64", "rollback-64-new"],
  );
  } finally {
    fixture.runtime.destroy();
  }
});

test("stale scheduled success cannot overwrite a reconciled scheduler state", async () => {
  let calls = 0;
  let release;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  const fixture = createFixture({
    analyzer: {
      async analyzeFloor() {
        calls += 1;
        if (calls === 1) return {events: []};
        markStarted();
        await pending;
        return {events: []};
      },
    },
    messages: [{ message_id: "stale-success-58", floor: 58, content: "Floor 58", role: "assistant" }],
  });
  configureScheduler(fixture, {interval: 2});
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();

  appendCharacter(fixture, "stale-success-60", 60, "Floor 60");
  appendCharacter(fixture, "stale-success-62", 62, "Floor 62");
  await started;

  await fixture.runtime.reconcileSchedulerState({reason: "test-reconciliation"});
  let state = fixture.runtime.getAutoAnalysisSchedulerState();
  assert.equal(state.counter, 2);
  assert.equal(state.countedFloorKeys.length, 2);

  release();
  await new Promise(resolve => setTimeout(resolve, 120));
  state = fixture.runtime.getAutoAnalysisSchedulerState();
  assert.equal(state.counter, 2);
  assert.equal(state.countedFloorKeys.length, 2);
  assert.equal(state.lastFailure, null);
  assert.equal(
    fixture.runtime.getPersistenceTrace().sequence.some(
      entry => entry.stage === "AUTO_SCHEDULER_COMPLETION_DISCARDED" &&
        entry.reason === "stale-scheduler-owner",
    ),
    true,
  );
  fixture.runtime.destroy();
});

test("authoritative scheduler MESSAGE_NOT_FOUND still enters the failure latch", async () => {
  const fixture = createFixture({
    analyzer: {
      async analyzeFloor() {
        throw new Error("MESSAGE_NOT_FOUND");
      },
    },
    messages: [{ message_id: "authoritative-failure-58", floor: 58, content: "Floor 58", role: "assistant" }],
  });
  configureScheduler(fixture, {interval: 1});
  await fixture.runtime.init();

  appendCharacter(fixture, "authoritative-failure-60", 60, "Floor 60");
  await new Promise(resolve => setTimeout(resolve, 30));
  const state = fixture.runtime.getAutoAnalysisSchedulerState();
  assert.equal(state.counter, 1);
  assert.equal(state.lastFailure?.code, "MESSAGE_NOT_FOUND");
  assert.equal(state.retryPaused, false);
  fixture.runtime.destroy();
});

test("scheduler rebase restores the baseline and count after runtime state is reset", async () => {
  const fixture = createFixture({
    messages: [
      { message_id: "reload-58", floor: 58, content: "Floor 58", role: "assistant" },
      { message_id: "reload-60", floor: 60, content: "Floor 60", role: "assistant" },
      { message_id: "reload-62", floor: 62, content: "Floor 62", role: "assistant" },
    ],
  });
  configureScheduler(fixture, { interval: 3 });
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({ __messageIndex: true, index: 0 }, { force: true });
  fixture.runtime.automaticAnalysis.reset("test-reload");

  const rebased = await fixture.runtime.reconcileSchedulerState({reason: "test-reload"});
  const state = fixture.runtime.getAutoAnalysisSchedulerState();
  assert.equal(rebased.baseline.index, 0);
  assert.equal(rebased.count, 2);
  assert.equal(state.counter, 2);
  assert.equal(state.countedFloorKeys.length, 2);
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

test("normal generation and regenerate both use the Character interval", async () => {
  const fixture = createFixture({
    messages: [{ message_id: "generation-character", floor: 1, content: "原文", role: "assistant" }],
  });
  configureScheduler(fixture, { interval: 3 });
  await fixture.runtime.init();
  fixture.emit("generation-started", "normal");
  await settle();
  fixture.context.chat[0].content = "普通生成正文";
  fixture.emit("character-message-rendered", { message_id: "generation-character" });
  await settle();
  fixture.emit("generation-ended", { message_id: "generation-character" });
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(fixture.calls(), 0);
  fixture.emit("generation-started", { genType: "regenerate", message_id: "generation-character" });
  await settle();
  fixture.emit("character-message-rendered", { message_id: "generation-character" });
  await settle();
  fixture.emit("generation-ended", { message_id: "generation-character" });
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(fixture.calls(), 0);
  fixture.emit("generation-started", { genType: "regenerate", message_id: "generation-character" });
  await settle();
  fixture.context.chat[0].content = "重新生成正文";
  fixture.emit("character-message-rendered", { message_id: "generation-character" });
  await settle();
  fixture.emit("generation-ended", { message_id: "generation-character" });
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(fixture.calls(), 0);
  appendCharacter(fixture, "generation-character-2", 2, "第二个 Character Floor");
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(fixture.calls(), 0);
  appendCharacter(fixture, "generation-character-3", 3, "第三个 Character Floor");
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(fixture.calls(), 1);
  fixture.runtime.destroy();
});

test("a completed normal generation hands one Floor to the scheduler only once", async () => {
  const fixture = createFixture({
    messages: [{ message_id: "normal-floor-66", floor: 66, content: "Floor 66", role: "assistant" }],
  });
  configureScheduler(fixture, { interval: 1 });
  await fixture.runtime.init();

  fixture.emit("generation-started", "normal");
  await settle();
  fixture.context.chat[0].content = "Floor 66 final reply";
  fixture.emit("character-message-rendered", { message_id: "normal-floor-66" });
  await new Promise(resolve => setTimeout(resolve, 120));
  fixture.emit("generation-ended", { message_id: "normal-floor-66" });
  await new Promise(resolve => setTimeout(resolve, 120));

  let state = fixture.runtime.getAutoAnalysisSchedulerState();
  assert.equal(fixture.calls(), 1);
  assert.equal(state.counter, 0);
  assert.equal(state.countedFloorKeys.length, 0);

  fixture.emit("character-message-rendered", { message_id: "normal-floor-66" });
  await new Promise(resolve => setTimeout(resolve, 120));
  state = fixture.runtime.getAutoAnalysisSchedulerState();
  assert.equal(fixture.calls(), 1);
  assert.equal(state.counter, 0);
  assert.equal(state.countedFloorKeys.length, 0);
  fixture.runtime.destroy();
});

test("automatic analysis trace exposes the Character handoff and scheduler decision", async () => {
  const fixture = createFixture({
    messages: [{ message_id: "trace-floor-66", floor: 66, content: "Floor 66", role: "assistant" }],
  });
  configureScheduler(fixture, { interval: 1 });
  await fixture.runtime.init();
  fixture.emit("character-message-rendered", { message_id: "trace-floor-66" });
  await settle();

  const entries = fixture.runtime.getPersistenceTrace().sequence;
  const received = entries.find(entry => entry.stage === "CHARACTER_MESSAGE_RENDERED_RECEIVED");
  const lifecycle = entries.find(entry => entry.stage === "GENERATION_LIFECYCLE_RESULT");
  const schedulerEnter = entries.find(entry => entry.stage === "AUTO_SCHEDULER_ENTER");
  const schedulerDecision = entries.find(entry => entry.stage === "AUTO_SCHEDULER_DECISION");
  assert.equal(received.message_index, 0);
  assert.equal(received.floor, 66);
  assert.equal(received.message_id, "trace-floor-66");
  assert.ok(received.floor_version_key);
  assert.equal(lifecycle.result, null);
  assert.ok(schedulerEnter);
  assert.equal(schedulerEnter.floor_version_key, received.floor_version_key);
  assert.equal(schedulerDecision.counter_before, 0);
  assert.equal(schedulerDecision.counter_after, 1);
  assert.equal(schedulerDecision.decision, "interval-due");
  const versionChain = entries.filter(entry => entry.stage === "VERSION_CHAIN");
  const versionChainBoundaries = new Set(versionChain.map(entry => entry.boundary));
  for (const boundary of [
    "CHARACTER_MESSAGE_RENDERED_RECEIVED",
    "GENERATION_LIFECYCLE_RESULT",
    "AUTO_HANDOFF_TO_SCHEDULER",
    "AUTO_SCHEDULER_ENTER",
    "AUTO_SCHEDULER_DECISION",
    "ANALYSIS_INPUT_READY",
    "API_REQUEST_STARTED",
    "API_RESULT_RECEIVED",
    "FLOOR_TX_CREATED",
    "CONTEXT_SOURCE_READ_BEFORE_WRITE",
  ]) {
    assert.equal(versionChainBoundaries.has(boundary), true, boundary);
  }
  assert.equal(new Set(versionChain.map(entry => entry.analysis_execution_id)).size, 1);
  assert.equal(new Set(versionChain.map(entry => entry.content_hash)).size, 1);
  assert.equal(entries.some(entry => entry.stage === "VERSION_CHAIN_TRANSITION"), false);
  fixture.runtime.destroy();
});

test("host event diagnostics export even when automatic analysis does not start", async () => {
  const fixture = createFixture();
  await fixture.runtime.init();
  fixture.emit("generation-started", { generation_type: "normal", message_id: "host-only" });
  await settle();

  const entries = fixture.runtime.getPersistenceTrace().sequence;
  const received = entries.find(entry => entry.stage === "HOST_EVENT_RECEIVED");
  const forwarded = entries.find(entry => entry.stage === "HOST_EVENT_FORWARD_RESULT");
  assert.ok(received);
  assert.equal(received.host_event_key, "GENERATION_STARTED");
  assert.equal(received.host_generation_type, "normal");
  assert.equal(received.runtime_handler_present, true);
  assert.ok(forwarded);
  assert.equal(forwarded.forwarded, true);
  assert.equal(forwarded.forward_result?.reason, "generation-pending");
  assert.equal(entries.some(entry => entry.stage === "AUTO_ANALYSIS_TRIGGERED"), false);
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

test("automatic factual success waits for generation settle and completes Projection once", async () => {
  const fixture = createFixture({
    messages: [{ message_id: "projection-settle-gate", floor: 100, content: "最终正文", role: "assistant" }],
    analyzer: { async analyzeFloor() { return { events: [] }; } },
  });
  await fixture.runtime.init();
  const traceBeforeGeneration = fixture.runtime.getPersistenceTrace().sequence.length;

  await fixture.emit("generation-started", { generation_type: "normal", message_id: "projection-settle-gate" });
  assert.ok(fixture.runtime.getAutoAnalysisSchedulerState().pendingGeneration);
  await fixture.runtime.analyzeFloor(null, { force: false, reason: "automatic" });
  assert.ok(fixture.runtime.getAutoAnalysisSchedulerState().pendingGeneration);
  await settle();
  let trace = fixture.runtime.getPersistenceTrace().sequence.slice(traceBeforeGeneration);
  assert.equal(trace.filter(entry => entry.stage === "PROJECTION_PROCESS_STARTED").length, 0);
  assert.equal(trace.filter(entry => entry.stage === "PROJECTION_POSTPROCESS_DEFERRED").length, 1);

  await fixture.emit("character-message-rendered", { message_id: "projection-settle-gate" });
  await fixture.emit("generation-ended", { message_id: "projection-settle-gate" });
  await settle();
  await settle();

  trace = fixture.runtime.getPersistenceTrace().sequence.slice(traceBeforeGeneration);
  assert.equal(trace.filter(entry => entry.stage === "PROJECTION_PROCESS_STARTED").length, 1);
  assert.equal(trace.filter(entry => entry.stage === "PROJECTION_POSTPROCESS_RELEASED").length, 1);
  fixture.runtime.destroy();
});

test("cleared generation intent releases deferred Projection post-processing once", async () => {
  const fixture = createFixture({
    messages: [{ message_id: "deferred-floor-98", floor: 98, content: "旧正文", role: "assistant" }],
    analyzer: { async analyzeFloor() { return { events: [] }; } },
  });
  configureScheduler(fixture, { interval: 1 });
  await fixture.runtime.init();

  await fixture.emit("generation-started", {
    genType: "regenerate",
    message_id: "deferred-floor-98",
  });
  await fixture.emit("character-message-rendered", { message_id: "deferred-floor-98" });

  fixture.context.chat.push({
    message_id: "deferred-floor-99",
    floor: 99,
    content: "新正文",
    role: "assistant",
  });
  await fixture.runtime.analyzeFloor(
    { __messageIndex: true, index: 1 },
    { force: false, reason: "automatic" },
  );
  await settle();
  assert.equal(
    fixture.runtime.getPersistenceTrace().sequence.filter(
      entry => entry.stage === "PROJECTION_POSTPROCESS_DEFERRED",
    ).length,
    1,
  );

  await fixture.emit("character-message-rendered", { message_id: "deferred-floor-99" });
  await fixture.emit("generation-ended", { message_id: "deferred-floor-99" });
  await settle();
  await settle();

  const sequence = fixture.runtime.getPersistenceTrace().sequence;
  assert.equal(
    sequence.filter(entry => entry.stage === "PROJECTION_POSTPROCESS_RELEASED").length,
    1,
  );
  assert.equal(
    sequence.filter(entry => entry.stage === "PROJECTION_PROCESS_STARTED").length,
    1,
  );
  fixture.emit("generation-ended", { message_id: "deferred-floor-99" });
  await settle();
  assert.equal(
    fixture.runtime.getPersistenceTrace().sequence.filter(
      entry => entry.stage === "PROJECTION_POSTPROCESS_RELEASED",
    ).length,
    1,
  );
  fixture.runtime.destroy();
});

test("deferred deletion of a replaced Character message does not clear the settled Floor", async () => {
  const fixture = createFixture({
    messages: [{ message_id: "replaced-floor-slot", floor: 98, content: "旧正文", role: "assistant" }],
    analyzer: { async analyzeFloor() { return { events: [] }; } },
  });
  configureScheduler(fixture, { interval: 1 });
  await fixture.runtime.init();

  fixture.emit("generation-started", {
    generation_type: "normal",
    message_id: "replaced-floor-slot",
  });
  await settle();
  fixture.context.chat.splice(0, 1);
  fixture.emit("message-deleted", {
    message_id: "replaced-floor-slot",
    messageIndex: 0,
  });
  fixture.context.chat.push({
    message_id: "replaced-floor-slot",
    floor: 98,
    content: "新正文",
    role: "assistant",
  });
  fixture.emit("message-received", {message_id: "replaced-floor-slot"});
  const rendered = waitForLifecycleSettled(fixture, "CHARACTER_MESSAGE_RENDERED");
  fixture.emit("character-message-rendered", {message_id: "replaced-floor-slot"});
  await rendered;
  await fixture.emit("generation-ended", {message_id: "replaced-floor-slot"});
  await settle();
  await settle();
  await fixture.emit("generation-ended", {message_id: "replaced-floor-slot"});
  await fixture.emit("generation-stopped", {message_id: "replaced-floor-slot"});
  await settle();

  const current = await fixture.runtime.resolveCurrentBioWeaveFloor();
  assert.equal(current.version.message_id, "replaced-floor-slot");
  assert.equal(fixture.runtime.store.getFloor(0).analysis?.status, "success");
  const sequence = fixture.runtime.getPersistenceTrace().sequence;
  assert.equal(sequence.some(entry =>
    entry.stage === "GENERATION_DEFERRED_EVENT_REPLAY" &&
    entry.host_event_key === "MESSAGE_DELETED" &&
    entry.reason === "REPLACED_BY_CURRENT_CHARACTER_FLOOR",
  ), true);
  fixture.runtime.destroy();
});

test("deferred deletion of another message in the same slot is still replayed", async () => {
  const fixture = createFixture({
    messages: [{ message_id: "same-slot-current", floor: 98, content: "旧正文", role: "assistant" }],
    analyzer: { async analyzeFloor() { return { events: [] }; } },
  });
  await fixture.runtime.init();

  fixture.emit("generation-started", {
    generation_type: "normal",
    message_id: "same-slot-current",
  });
  fixture.context.chat[0].content = "新正文";
  fixture.emit("message-deleted", {
    message_id: "different-old-message",
    messageIndex: 0,
  });
  fixture.emit("message-received", { message_id: "same-slot-current" });
  fixture.emit("character-message-rendered", { message_id: "same-slot-current" });
  await fixture.emit("generation-ended", { message_id: "same-slot-current" });
  await settle();
  await settle();

  const replay = fixture.runtime.getPersistenceTrace().sequence.find(entry =>
    entry.stage === "GENERATION_DEFERRED_EVENT_REPLAY" &&
    entry.host_event_key === "MESSAGE_DELETED",
  );
  assert.equal(replay?.execution_status, "SUCCEEDED");
  assert.notEqual(replay?.reason, "REPLACED_BY_CURRENT_CHARACTER_FLOOR");
  fixture.runtime.destroy();
});

test("a late GENERATION_STARTED continuation cannot dereference a released gate", async () => {
  const fixture = createFixture({
    messages: [{ message_id: "generation-race-floor", floor: 1, content: "正文", role: "assistant" }],
  });
  await fixture.runtime.init();

  await fixture.emit("generation-started", {
    generation_id: "generation-4",
    generation_type: "normal",
    message_id: "generation-race-floor",
  });
  await fixture.emit("generation-ended", {message_id: "generation-race-floor"});
  await fixture.emit("generation-started", {
    generation_id: "generation-5",
    generation_type: "normal",
    message_id: "generation-race-floor",
  });
  await settle();

  const sequence = fixture.runtime.getPersistenceTrace().sequence;
  assert.equal(sequence.some(entry =>
    entry.stage === "HOST_EVENT_FORWARD_RESULT" &&
    entry.host_event_key === "GENERATION_STARTED" &&
    entry.forward_error === "Cannot set properties of null (setting active)",
  ), false);
  fixture.runtime.destroy();
});

test("real SillyTavern assistant_message Character Floors enter automatic analysis", async () => {
  let eventCalls = 0;
  const fixture = createFixture({
    messages: [{
      message_id: "real-assistant-message",
      floor: 60,
      content: "真实 Character reply",
      is_user: false,
      is_system: false,
      extra: {type: "assistant_message", swipeable: true, gouhua_snapshot: {}},
    }],
    analyzer: {
      async analyzeFloor() {
        eventCalls += 1;
        return {events: []};
      },
    },
  });
  configureScheduler(fixture, {interval: 1});
  await fixture.runtime.init();
  fixture.emit("generation-started", "normal");
  fixture.context.chat[0].content = "真实 Character reply 已完成";
  fixture.emit("character-message-rendered", {message_id: "real-assistant-message"});
  await settle();
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().counter, 0);
  assert.equal(eventCalls, 0);
  fixture.emit("generation-ended", {message_id: "real-assistant-message"});
  await settle();
  assert.equal(eventCalls, 1);
  assert.ok(fixture.runtime.getPersistenceTrace().sequence.some(
    entry => entry.stage === "AUTO_ANALYSIS_TRIGGERED" && entry.message_id === "real-assistant-message",
  ));
  fixture.runtime.destroy();
});

test("real ST reroll order uses positional generation type and renders after GENERATION_ENDED", async () => {
  let eventCalls = 0;
  const fixture = createFixture({
    messages: [{ message_id: "real-reroll", floor: 1, content: "原文", role: "assistant" }],
    analyzer: {
      async analyzeFloor() {
        eventCalls += 1;
        return { events: [] };
      },
    },
  });
  configureScheduler(fixture, { interval: 99 });
  await fixture.runtime.init();

  fixture.emit("generation-started", "regenerate");
  fixture.emit("generation-ended", 1);
  await Promise.resolve();
  assert.equal(eventCalls, 0);
  fixture.context.chat[0].content = "真实重新生成后的正文";
  fixture.emit("character-message-rendered", 0, "regenerate");
  await new Promise(resolve => setTimeout(resolve, 120));

  assert.equal(eventCalls, 0);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().counter, 1);
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

test("a delayed reroll callback after Floor 66 cannot analyze Floor 56, while Floor 66 still analyzes", async () => {
  const inputs = [];
  const fixture = createFixture({
    messages: [
      { message_id: "floor-56", floor: 56, content: "Floor 56", role: "assistant" },
      { message_id: "floor-66", floor: 66, content: "Floor 66", role: "assistant" },
    ],
    analyzer: {
      async analyzeFloor({ analysisInput }) {
        inputs.push(analysisInput);
        return { events: [] };
      },
    },
  });
  configureScheduler(fixture, { interval: 1 });
  await fixture.runtime.init();

  fixture.emit("generation-started", {
    generation_type: "regenerate",
    message_id: "floor-56",
  });
  fixture.emit("character-message-rendered", { message_id: "floor-56" });
  await settle();
  assert.equal(inputs.length, 0);

  fixture.emit("character-message-rendered", { message_id: "floor-66" });
  await settle();
  fixture.emit("generation-ended", { message_id: "floor-56" });
  await settle();

  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].floor_version.message_id, "floor-66");
  assert.equal(inputs[0].current_floor.floor, 66);
  assert.equal(
    fixture.runtime.getPersistenceTrace().sequence.some(entry =>
      entry.stage === "AUTO_ANALYSIS_TRIGGERED" &&
      entry.message_id === "floor-56",
    ),
    false,
  );
  fixture.runtime.destroy();
});

test("automatic reroll uses the target slot as comparison state without treating it as previous Floor", async () => {
  const inputs = [];
  const fixture = createFixture({
    messages: [{ message_id: "reroll-context", floor: 1, content: "旧正文", role: "assistant" }],
    analyzer: {
      async analyzeFloor({ analysisInput }) {
        inputs.push(structuredClone(analysisInput));
        return inputs.length === 1 ? { events: [eventResult("reroll-history")] } : { events: [] };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({ __messageIndex: true, index: 0 }, { force: true });
  fixture.context.chat[0].content = "新正文";
  await fixture.runtime.analyzeFloor(
    { __messageIndex: true, index: 0 },
    { force: true, reason: "reroll" },
  );

  const rerollInput = inputs[1];
  assert.equal(rerollInput.current_floor.narrative, "新正文");
  assert.equal(rerollInput.existing_bioweave.events.length, 0);
  assert.equal(rerollInput.existing_events.length, 1);
  assert.equal(Object.keys(rerollInput.character_registry.entities).length, 2);
  assert.notEqual(
    rerollInput.existing_events[0].source.content_hash,
    rerollInput.floor_version.content_hash,
  );
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
  configureScheduler(fixture, { interval: 1 });
  await fixture.runtime.init();
  fixture.emit("generation-started", "regenerate");
  await settle();
  fixture.emit("generation-ended", 1);
  await settle();
  fixture.context.chat[0].content = "新正文";
  fixture.emit("character-message-rendered", { message_id: "trace-reroll" });
  fixture.emit("character-message-rendered", { message_id: "trace-reroll" });
  await new Promise(resolve => setTimeout(resolve, 120));
  const trace = fixture.runtime.getPersistenceTrace();
  assert.ok(trace);
  const stages = trace.sequence.map(entry => entry.stage);
  assert.ok(stages.indexOf("GENERATION_STARTED") >= 0);
  assert.ok(stages.indexOf("GENERATION_ENDED") >= 0);
  assert.ok(stages.indexOf("CHARACTER_MESSAGE_RENDERED") >= 0);
  assert.equal(stages.filter(stage => stage === "AUTO_ANALYSIS_TRIGGERED").length, 1);
  assert.equal(stages.filter(stage => stage === "WORLD_ACCEPTED").length, 1);
  assert.equal(
    trace.sequence.find(entry => entry.stage === "AUTO_SCHEDULER_DECISION")?.decision,
    "interval-due",
  );
  assert.ok(trace.sequence.every((entry, index, all) => index === 0 || entry.seq > all[index - 1].seq));
  fixture.runtime.destroy();
});

test("automatic failure trace separates scheduler trigger from the actual failure", async () => {
  const fixture = createFixture({saveFloorError: "ST_FLOOR_STORAGE_UNAVAILABLE"});
  configureScheduler(fixture, {interval: 1});
  await fixture.runtime.init();
  const analysisFailed = new Promise(resolve => {
    let unsubscribe = () => {};
    unsubscribe = fixture.runtime.subscribe(event => {
      if (event?.type === "EVENT_ANALYSIS_STATUS_CHANGED" && event.payload?.state === "failed") {
        unsubscribe();
        resolve();
      }
    });
  });
  fixture.emit("character-message-rendered", {message_id: "message-stable"});
  await analysisFailed;
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

  const firstAnalysisSuccess = waitForAnalysisSuccess(fixture, 0);
  fixture.emit("generation-started", "regenerate");
  fixture.context.chat[0].content = "重新生成中的正文";
  fixture.emit("generation-ended", 1);
  fixture.emit("character-message-rendered", 0, "regenerate");
  await firstAnalysisSuccess;
  assert.equal(worldCalls, 1);
  assert.equal(eventCalls, 1);

  fixture.context.chat[0].content = "重新生成最终正文";
  const duplicateRenderSettled = waitForLifecycleSettled(fixture);
  fixture.emit("character-message-rendered", 0, "regenerate");
  await duplicateRenderSettled;
  assert.equal(worldCalls, 1);
  assert.equal(eventCalls, 1);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().counter, 0);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().completedGeneration !== null, true);
  fixture.runtime.destroy();
});

test("real ST swipe generation enters the normal interval without force", async () => {
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

  assert.equal(fixture.calls(), 0);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().counter, 1);
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
  assert.equal(fixture.calls(), callsBeforeSwitch);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().counter, 1);
  appendCharacter(fixture, "swipe-scheduler-next", 2, "后续 Character Floor");
  await new Promise(resolve => setTimeout(resolve, 120));
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

test("stopped or cancelled lifecycle outcomes do not consume the next valid Floor Version", async () => {
  for (const terminalType of ["generation-stopped", "generation-cancelled"]) {
    const message = {
      message_id: `cancelled-owner-${terminalType}`,
      floor: 1,
      content: "旧版本",
      role: "assistant",
    };
    const fixture = createFixture({ messages: [message] });
    configureScheduler(fixture, { interval: 2 });
    await fixture.runtime.init();

    fixture.emit("generation-started", {
      genType: "regenerate",
      message_id: message.message_id,
    });
    await settle();
    fixture.emit(terminalType, { message_id: message.message_id });
    await settle();

    message.content = "新版本定型";
    fixture.emit("generation-started", {
      genType: "normal",
      message_id: message.message_id,
    });
    fixture.emit("generation-ended", { message_id: message.message_id });
    fixture.emit("character-message-rendered", { message_id: message.message_id });
    await settle();

    assert.equal(fixture.calls(), 0);
    assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().counter, 1);
    fixture.runtime.destroy();
  }
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
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().counter, 0);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().retryPaused, false);
  const secondLifecycleSettled = waitForLifecycleSettled(
    fixture,
    "CHARACTER_MESSAGE_RENDERED",
  );
  appendCharacter(fixture, "retry-2", 2);
  await secondLifecycleSettled;
  assert.equal(calls, 1);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().counter, 1);
  const thirdLifecycleSettled = waitForLifecycleSettled(
    fixture,
    "CHARACTER_MESSAGE_RENDERED",
  );
  appendCharacter(fixture, "retry-3", 3);
  await thirdLifecycleSettled;
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
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().counter, 0);
  fixture.context.chat[0].content = "普通编辑";
  fixture.emit("message-edited", { message_id: "paused-1" });
  const renderedSettled = waitForLifecycleSettled(fixture, "CHARACTER_MESSAGE_RENDERED");
  appendCharacter(fixture, "paused-2", 2);
  await renderedSettled;
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

test("reroll does not force a paused automatic cycle", async () => {
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
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().counter, 0);
  fixture.emit("generation-started", { genType: "regenerate", message_id: "paused-reroll" });
  await settle();
  fixture.context.chat[0].content = "重新生成";
  fixture.emit("character-message-rendered", { message_id: "paused-reroll" });
  await settle();
  fixture.emit("generation-ended", { message_id: "paused-reroll" });
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(calls, 1);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().counter, 1);
  assert.equal(fixture.runtime.getAutoAnalysisSchedulerState().retryPaused, true);
  fixture.runtime.destroy();
});

test("reroll failure remains paused without an extra force request", async () => {
  let calls = 0;
  const fixture = createFixture({
    analyzer: { async analyzeFloor() { calls += 1; throw new Error("REROLL_FAILED"); } },
    messages: [{ message_id: "paused-reroll-failed", floor: 1, content: "原文", role: "assistant" }],
  });
  configureScheduler(fixture, { interval: 1, retry: false });
  await fixture.runtime.init();
  fixture.emit("generation-started", { genType: "regenerate", message_id: "paused-reroll-failed" });
  await settle();
  fixture.context.chat[0].content = "重新生成失败";
  fixture.emit("character-message-rendered", { message_id: "paused-reroll-failed" });
  await settle();
  fixture.emit("generation-ended", { message_id: "paused-reroll-failed" });
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(calls, 1);
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
  appendCharacter(fixture, "paused-signals-trigger", 2, "触发失败");
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

test("World canonical UI readiness failure stops without repeating the AI request", async () => {
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
  await assert.rejects(fixture.runtime.refreshCurrentFloorAnalysis(), /WORLD_MODEL_UI_NOT_READY/u);
  assert.equal(worldCalls, 1);
  assert.equal(eventCalls, 0);
  const trace = fixture.runtime.getPersistenceTrace().sequence;
  assert.ok(trace.some(item => item.stage === "WORLD_STAGE_ATTEMPT_FAILED" &&
    ["world_readback", "world_view_model", "world_ui_ready"].includes(item.failure_stage)));
  assert.equal(trace.some(item => item.stage === "WORLD_STAGE_RETRY_SCHEDULED"), false);
  fixture.runtime.destroy();
});

test("World v2 validation failure trace preserves safe diagnostic fields", async () => {
  const failure = new Error("WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED: full evidence body must not be traced");
  failure.code = "WORLD_MODEL_PATCH_V2_INVALID";
  failure.path = "operation.exception.statement";
  failure.diagnosticCode = "WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED";
  failure.analysis_stage = "world_patch_v2_evidence_guard";
  failure.validation_stage = "evidence_guard";
  const messages = [
    { message_id: "world-diagnostic-base", floor: 3, content: "A", role: "assistant" },
    { message_id: "world-diagnostic-current", floor: 6, content: "新增世界规则：Species-A 的 biological type 有变化。", role: "assistant" },
  ];
  const fixture = createFixture({
    messages,
    retryCount: 0,
    analyzer: {
      async analyzeWorldModel() {
        throw failure;
      },
      async analyzeWorldModelPatchV2() {
        throw failure;
      },
      async analyzeFloor() {
        throw new Error("EVENT_SHOULD_NOT_RUN");
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.store.saveFloor(0, 0, {
    ...emptyFloor(),
    floor_version: await floorVersion({ chatId: "chat-runtime", messageId: "world-diagnostic-base", floor: 3, text: "A" }),
    world_model: normalizeWorldModel({ schema_version: 1, species: [{ name: "Species-A" }] }),
  });
  await assert.rejects(
    fixture.runtime.analyzeCurrentWorldModelPatch({ __messageIndex: true, index: 1 }),
    error => error?.code === "WORLD_MODEL_PATCH_V2_INVALID",
  );
  const trace = fixture.runtime.getPersistenceTrace().sequence;
  for (const stage of ["WORLD_AI_ATTEMPT_FAILED", "WORLD_STAGE_ATTEMPT_FAILED"]) {
    const entry = trace.find(item => item.stage === stage);
    assert.equal(entry?.failure_code, "WORLD_MODEL_PATCH_V2_INVALID");
    assert.equal(entry?.error_message, "WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED");
    assert.ok(!JSON.stringify(entry).includes("full evidence body"));
    assert.equal(entry?.error_path, "operation.exception.statement");
    assert.equal(entry?.diagnostic_code, "WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED");
    assert.equal(entry?.analysis_stage, "world_patch_v2_evidence_guard");
    assert.equal(entry?.validation_stage, "evidence_guard");
  }
  fixture.runtime.destroy();
});

test("World persistence failure stops without repeating the AI request", async () => {
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
  await assert.rejects(fixture.runtime.refreshCurrentFloorAnalysis(), /WORLD_MODEL_PERSISTENCE_PREWRITE_FAILED/u);
  assert.equal(worldCalls, 1);
  assert.equal(eventCalls, 0);
  const trace = fixture.runtime.getPersistenceTrace().sequence;
  assert.deepEqual(
    trace.filter(item => item.stage === "WORLD_STAGE_ATTEMPT_BEGIN")
      .map(item => [item.retry_index]),
    [[0]],
  );
  assert.equal(trace.some(item => item.stage === "WORLD_STAGE_RETRY_SCHEDULED"), false);
  fixture.runtime.destroy();
});

test("official version convergence mismatch stops after the AI response", async () => {
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
  await assert.rejects(fixture.runtime.refreshCurrentFloorAnalysis(), /WORLD_MODEL_PERSISTENCE_PREWRITE_FAILED/u);
  assert.equal(worldCalls, 1);
  assert.equal(eventCalls, 0);
  const sequence = fixture.runtime.getPersistenceTrace().sequence;
  assert.ok(sequence.some(item => item.stage === "WORLD_VERSION_MISMATCH_CLASSIFIED" &&
    item.classification === "temporary_server_convergence" && item.retryable === false));
  assert.deepEqual(
    sequence.filter(item => item.stage === "WORLD_AI_ATTEMPT_BEGIN").map(item => item.retry_index),
    [0],
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

test("automatic analysis input readiness does not start a second request for official lag", async () => {
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

test("World persistence failure never starts Character/Event or retries", async () => {
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
  assert.equal(worldCalls, 1);
  assert.equal(eventCalls, 0);
  fixture.runtime.destroy();
});

test("Event persistence failure stops without repeating the AI request", async () => {
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
  await assert.rejects(fixture.runtime.refreshCurrentFloorAnalysis(), /ST_FLOOR_STORAGE_UNAVAILABLE/u);
  assert.equal(worldCalls, 1);
  assert.equal(eventCalls, 1);
  assert.equal(fixture.runtime.getPersistenceTrace().sequence.some(
    item => item.stage === "EVENT_STAGE_RETRY_SCHEDULED",
  ), false);
  fixture.runtime.destroy();
});

test("Runtime does not re-request an analyzer timeout", async () => {
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
  await assert.rejects(fixture.runtime.refreshCurrentFloorAnalysis(), /REQUEST_TIMEOUT/u);
  assert.equal(worldCalls, 1);
  assert.equal(eventCalls, 1);
  const trace = fixture.runtime.getPersistenceTrace().sequence;
  assert.ok(trace.some(item => item.stage === "EVENT_STAGE_ATTEMPT_FAILED" &&
    item.retry_index === 0 && item.failure_code === "REQUEST_TIMEOUT" &&
    item.retryable === false && item.retry_decision === "stop"));
  assert.equal(trace.some(item => item.stage === "EVENT_STAGE_RETRY_SCHEDULED"), false);
  assert.equal(trace.filter(item => item.stage === "WORLD_SAVE_BEGIN").length, 1);
  fixture.runtime.destroy();
});

test("Runtime does not retry network or 5xx failures already returned by the client boundary", async () => {
  for (const failure of [
    Object.assign(new Error("NETWORK_FAILED"), {
      code: "NETWORK_ERROR",
      diagnosticCode: "network",
      analysis_stage: "api_request",
    }),
    Object.assign(new Error("HTTP_503"), {
      code: "HTTP_503",
      status: 503,
      diagnosticCode: "server",
      analysis_stage: "api_request",
    }),
    Object.assign(new Error("UPSTREAM_TIMEOUT"), {
      code: "UPSTREAM_TIMEOUT",
      diagnosticCode: "upstream-timeout",
      analysis_stage: "api_request",
    }),
  ]) {
    let eventCalls = 0;
    const fixture = createFixture({
      retryCount: 2,
      analyzer: {
        async analyzeWorldModel() {
          return normalizeWorldModel({ schema_version: 1, species: [{ name: "世界" }] });
        },
        async analyzeFloor() {
          eventCalls += 1;
          throw failure;
        },
      },
    });
    await fixture.runtime.init();
    await assert.rejects(fixture.runtime.refreshCurrentFloorAnalysis(), /NETWORK_FAILED|HTTP_503|UPSTREAM_TIMEOUT/u);
    assert.equal(eventCalls, 1);
    const trace = fixture.runtime.getPersistenceTrace().sequence;
    assert.equal(trace.filter(item => item.stage === "EVENT_STAGE_RETRY_SCHEDULED").length, 0);
    assert.ok(trace.some(item => item.stage === "EVENT_STAGE_ATTEMPT_FAILED" &&
      item.retryable === false && item.retry_decision === "stop"));
    fixture.runtime.destroy();
  }
});

test("Runtime timeout failures do not consume the request retry setting", async () => {
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
  assert.equal(eventCalls, 1);
  const status = await fixture.runtime.getCurrentFloorAnalysisStatus();
  assert.doesNotMatch(status.safe_error_summary, /已耗尽请求重试次数/u);
  const trace = fixture.runtime.getPersistenceTrace().sequence;
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

test("Runtime retry_count does not create additional Event request attempts", async () => {
  let eventCalls = 0;
  const fixture = createFixture({
    retryCount: 3,
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
  assert.deepEqual(
    fixture.runtime.getPersistenceTrace().sequence
      .filter(item => item.stage === "EVENT_STAGE_ATTEMPT_BEGIN")
      .map(item => item.retry_index),
    [0],
  );
  fixture.runtime.destroy();
});

test("request retry config prefers the current persisted global setting over a stale profile snapshot", async () => {
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
  assert.equal(worldCalls, 1);
  fixture.runtime.destroy();
});

test("Runtime leaves timeout retry ownership to the API Client", async () => {
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
  await assert.rejects(fixture.runtime.refreshCurrentFloorAnalysis(), /REQUEST_ABORTED/u);
  assert.equal(eventCalls, 1);
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

test("Event canonical readback failure stops without repeating the AI request", async () => {
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
  await assert.rejects(fixture.runtime.refreshCurrentFloorAnalysis(), /CHARACTER_CANONICAL_NOT_READY/u);
  assert.equal(worldCalls, 1);
  assert.equal(eventCalls, 1);
  const trace = fixture.runtime.getPersistenceTrace().sequence;
  assert.equal(trace.some(item => item.stage === "EVENT_STAGE_RETRY_SCHEDULED"), false);
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
      async analyzeWorldModelPatchV2() {
        patchCalls += 1;
        if (patchCalls === 1) throw new Error("PATCH_FAILED");
        return { patch: { schema_version: 2, operations: [] }, classified: [] };
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
  configureScheduler(fixture, { interval: 1 });
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

  const generationStarted = fixture.emit("generation-started", {
    genType: "regenerate",
    message_id: "unrelated-generation",
    generation_id: "generation-unrelated",
  });
  await settle();
  releaseWorld(normalizeWorldModel({
    schema_version: 1,
    species: [{ name: "人类", biological_types: [] }],
  }));
  await generationStarted;
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
  configureScheduler(fixture, { interval: 1 });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  await settle();
  const firstId = (await fixture.runtime.getCurrentFloorEvents())[0].event_id;
  message.swipe_id = 1;
  const analysisSettled = waitForAnalysisSuccess(fixture, 1);
  fixture.emit("generation-started", { message_id: "message-swipe", swipe_id: 1 });
  fixture.emit("message-swiped", { message_id: "message-swipe", swipe_id: 1, pendingGeneration: true });
  fixture.emit("generation-ended", { message_id: "message-swipe", swipe_id: 1 });
  fixture.emit("character-message-rendered", { message_id: "message-swipe", swipe_id: 1 });
  await analysisSettled;
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
      reliableStoryTime: true,
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

test("SillyTavern official Floor readback keeps message_index 72 and swipe 0 aligned", async () => {
  const previousFetch = globalThis.fetch;
  const previousSillyTavern = globalThis.SillyTavern;
  const target = {
    message_id: 72,
    floor: 72,
    content: "Floor 72 当前正文",
    role: "assistant",
  };
  const messages = Array.from({length: 72}, (_, index) => ({
    message_id: index,
    floor: index,
    content: `历史正文 ${index}`,
    role: "user",
  }));
  messages.push(target);
  const context = {
    chatId: "chat-official-owner",
    characterId: "character-official-owner",
    name2: "角色",
    avatar_url: "character.png",
    chat: messages,
    getRequestHeaders: () => ({}),
  };
  let remoteMessages = structuredClone(messages);
  const requests = [];
  globalThis.SillyTavern = {getContext: () => context};
  globalThis.fetch = async (endpoint, options) => {
    requests.push({endpoint, body: options?.body ? JSON.parse(options.body) : null});
    if (endpoint === "/api/chats/get") {
      return {
        ok: true,
        async json() {
          return [{chat_metadata: {}}, ...structuredClone(remoteMessages)];
        },
      };
    }
    if (endpoint === "/api/chats/save") {
      remoteMessages = structuredClone(JSON.parse(options.body).chat.slice(1));
      return {ok: true, status: 200};
    }
    throw new Error(`unexpected endpoint: ${endpoint}`);
  };
  context.saveChat = async () => {
    remoteMessages = structuredClone(context.chat);
    return {commitState: "host-accepted", status: "accepted"};
  };
  try {
    const adapter = createSillyTavernAdapter();
    const expected = await floorVersion({
      chatId: context.chatId,
      messageId: target.message_id,
      floor: target.floor,
      swipeId: 0,
      text: target.content,
    });
    const value = {
      ...emptyFloor(),
      floor_version: expected,
      projection_timing_snapshot: {schema_version: 1, items: []},
    };
    const result = await adapter.saveFloorSlot(
      72,
      0,
      value,
      context.chatId,
      expected,
      {coordinator_transaction: true, domain: "projection"},
    );
    assert.equal(result.commitState, "confirmed");
    assert.equal(remoteMessages[72].extra.bioweave.floor_version.message_id, 72);
    assert.equal(remoteMessages[72].extra.bioweave.projection_timing_snapshot.items.length, 0);
    assert.equal(remoteMessages[0].extra, undefined);
    assert.equal(requests.filter(request => request.endpoint === "/api/chats/save").length, 0);
    assert.equal(requests.filter(request => request.endpoint === "/api/chats/get").length, 1);
    const readback = await adapter.readOfficialFloorSlot({
      messageIndex: 72,
      swipeId: 0,
      expectedChatId: context.chatId,
      expectedVersion: expected,
    });
    assert.equal(readback.messageIndex, 72);
    assert.equal(readback.swipe_id, 0);
    assert.deepEqual(readback.floor, remoteMessages[72].extra.bioweave);
    assert.equal(requests.filter(request => request.endpoint === "/api/chats/get").length, 2);
  } finally {
    globalThis.fetch = previousFetch;
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
  configureScheduler(fixture, { interval: 1 });
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
      await fixture.runtime.analyzeFloor({ __messageIndex: true, index: 0 }, { force: true });
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
  const fixture = createFixture({ messages: [message], reliableStoryTime: true });
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
      async analyzeWorldModelPatchV2() {
        return { patch: { schema_version: 2, operations: [] }, classified: [] };
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
    reliableStoryTime: true,
    analyzer: {
      async analyzeFloor({ analysisInput }) {
        return {
          events: [fixtureContinuationEvent(
            analysisInput,
            identityEventForCharacters(
              analysisInput.character_registry,
              "Alice",
              "Bob",
              `analysis-event-${analysisInput.current_floor.floor}`,
            ),
          )],
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
  assert.equal(business.active_event_count, 1);
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

test("deleting an Event does not clear surviving later Floor Event slots", async () => {
  const fixture = createFixture({
    messages: [
      {
        message_id: "message-old-event",
        floor: 70,
        content: "旧测试事件所在楼层",
        role: "assistant",
      },
      {
        message_id: "message-later-event",
        floor: 75,
        content: "删除旧事件后仍应保留的楼层",
        role: "assistant",
      },
    ],
    analyzer: {
      async analyzeFloor({analysisInput}) {
        return {
          events: [
            eventResult(`event-floor-${analysisInput.current_floor.floor}`, {
              location: `地点-${analysisInput.current_floor.floor}`,
            }),
          ],
        };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 0}, {force: true});
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 1}, {force: true});

  const deletedEventId = fixture.runtime.store.getFloor(0).events[0].event_id;
  const survivingEventId = fixture.runtime.store.getFloor(1).events
    .find(event => event.event_id !== deletedEventId).event_id;
  await fixture.runtime.deleteEvent(deletedEventId);

  assert.deepEqual(
    fixture.runtime.store.getFloor(1).events.map(event => event.event_id),
    [survivingEventId],
  );
  assert.deepEqual(
    (await fixture.runtime.collectActiveBusinessData()).active_events.map(
      event => event.event_id,
    ),
    [survivingEventId],
  );
  fixture.runtime.destroy();
});

test("deleting one Event preserves same-Floor sibling Events", async () => {
  const fixture = createFixture({
    analyzer: {
      async analyzeFloor() {
        return {
          events: [eventResult("event-sibling-a"), eventResult("event-sibling-b")],
        };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const siblingEvents = fixture.runtime.store.getFloor(0).events;
  const siblingA = siblingEvents.find(event => event.event_id !== "event-sibling-b");
  const siblingB = siblingEvents.find(event => event.event_id !== siblingA?.event_id);
  await fixture.runtime.deleteEvent(siblingA.event_id);

  assert.deepEqual(
    fixture.runtime.store.getFloor(0).events.map(event => event.event_id),
    [siblingB.event_id],
  );
  assert.deepEqual(
    (await fixture.runtime.collectActiveBusinessData()).active_events.map(
      event => event.event_id,
    ),
    [siblingB.event_id],
  );
  fixture.runtime.destroy();
});

test("editing an Event writes only the current complete Floor state", async () => {
  const fixture = createFixture({
    reliableStoryTime: true,
    messages: [
      {
        message_id: "message-historical-edit",
        floor: 70,
        content: "待编辑的历史楼层",
        role: "assistant",
      },
      {
        message_id: "message-later-edit",
        floor: 75,
        content: "编辑历史事件后仍应保留的楼层",
        role: "assistant",
      },
    ],
    analyzer: {
      async analyzeFloor({analysisInput}) {
        return {events: [fixtureContinuationEvent(
          analysisInput,
          eventResultForRegistry(
            analysisInput.character_registry,
            `event-floor-${analysisInput.current_floor.floor}`,
          ),
        )]};
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 0}, {force: true});
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 1}, {force: true});

  const historicalEventId = fixture.runtime.store.getFloor(0).events[0].event_id;
  const laterEventId = fixture.runtime.store.getFloor(1).events[0].event_id;
  await fixture.runtime.updateEvent(laterEventId, {location: "编辑后的地点"});

  assert.equal(fixture.runtime.store.getFloor(0).events[0].location, "房间");
  assert.deepEqual(
    fixture.runtime.store.getFloor(1).events.map(event => event.event_id),
    [laterEventId],
  );
  assert.equal(fixture.runtime.store.getFloor(1).events[0].location, "编辑后的地点");
  assert.deepEqual(
    (await fixture.runtime.collectActiveBusinessData()).active_events.map(
      event => event.event_id,
    ),
    [laterEventId],
  );
  fixture.runtime.destroy();
});

test("Event edit correlates persistence stages with one operation and monotonic durations", async () => {
  const traces = [];
  const fixture = createFixture({
    notify(event) {
      if (event?.type === "BIOWEAVE_PERSISTENCE_TRACE") traces.push(event.payload);
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  traces.length = 0;

  const event = (await fixture.runtime.getCurrentFloorEvents())[0];
  const operationId = "event-edit-test-operation-1";
  await fixture.runtime.updateEvent(
    event.event_id,
    {location: "耗时诊断地点"},
    {event_edit_operation_id: operationId},
  );

  const operationTraces = traces.filter(
    trace => trace.event_edit_operation_id === operationId,
  );
  assert.ok(operationTraces.some(trace => trace.stage === "EVENT_EDIT_SUBMITTED"));
  assert.ok(operationTraces.some(trace => trace.stage === "FLOOR_TX_CREATED"));
  assert.ok(operationTraces.some(trace => trace.stage === "FLOOR_TX_CONFIRMED"));
  assert.ok(
    operationTraces.some(trace => trace.stage === "EVENT_EDIT_PERSISTENCE_CONFIRMED"),
  );
  assert.ok(
    operationTraces.some(trace => trace.stage === "EVENT_EDIT_TRACKING_REFRESH_COMPLETED"),
  );
  for (const trace of operationTraces) {
    if (trace.duration_ms !== null && trace.duration_ms !== undefined)
      assert.ok(Number.isFinite(trace.duration_ms) && trace.duration_ms >= 0);
  }
  const confirmed = operationTraces.find(
    trace => trace.stage === "EVENT_EDIT_PERSISTENCE_CONFIRMED",
  );
  assert.ok(Number.isFinite(confirmed.persistence_duration_ms));
  fixture.runtime.destroy();
});

test("Event edit changes only the active Floor and Swipe while preserving historical snapshots", async () => {
  const fixture = createFixture({
    messages: [
      {message_id: "floor-10", floor: 10, content: "Floor 10", role: "assistant"},
      {message_id: "floor-15", floor: 15, content: "Floor 15", role: "assistant"},
      {
        message_id: "floor-20",
        floor: 20,
        content: "Floor 20 Swipe 0",
        role: "assistant",
        swipes: ["Floor 20 Swipe 0", "Floor 20 Swipe 1"],
        swipe_info: [{}, {}],
        swipe_id: 0,
      },
    ],
    analyzer: {
      async analyzeFloor({analysisInput}) {
        const floor = analysisInput.current_floor.floor;
        if (floor === 10) return {events: [eventResult("event-a")]};
        if (floor === 15) return {events: [eventResult("event-b", {location: "Floor 15 地点"})]};
        return {events: []};
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 0}, {force: true});
  await fixture.runtime.analyzeFloor({__messageIndex: true, index: 1}, {force: true});
  const floor10Data = fixture.runtime.store.getFloor(0, 0);
  const floor15Data = fixture.runtime.store.getFloor(1, 0);
  const eventAId = "event-a-id";
  const eventBId = "event-b-id";
  await fixture.runtime.store.saveFloor(1, 0, {
    ...structuredClone(floor15Data),
    events: [
      {...structuredClone(floor10Data.events[0]), event_id: eventAId},
      {...structuredClone(floor15Data.events[0]), event_id: eventBId},
    ],
  });
  await fixture.runtime.store.saveFloor(2, 1, {
    ...structuredClone(floor15Data),
    floor_version: {
      ...floor15Data.floor_version,
      message_id: "floor-20",
      floor: 20,
      swipe_id: 1,
    },
  });
  const beforeSwipe1 = structuredClone(fixture.runtime.store.getFloor(2, 1));

  const beforeFloor10 = structuredClone(fixture.runtime.store.getFloor(0, 0));
  const beforeFloor15 = structuredClone(fixture.runtime.store.getFloor(1, 0));
  const beforeFloor20 = structuredClone(fixture.runtime.store.getFloor(2, 0));
  const currentEvents = await fixture.runtime.getCurrentFloorEvents();
  const eventA = currentEvents.find(event => event.event_id === eventAId);
  const eventB = currentEvents.find(event => event.event_id === eventBId);
  assert.ok(eventA, JSON.stringify(currentEvents.map(event => event.event_id)));
  assert.ok(eventB);

  await fixture.runtime.updateEvent(eventA.event_id, {
    type: eventA.type,
    status: eventA.status,
    story_time: {display: "羲和1年3月18日 酉时末"},
    location: "当前 Floor 修改地点",
    pregnancy_relevance: {
      ...eventA.pregnancy_relevance,
      gestational_subject_ids: [...eventA.pregnancy_relevance.gestational_subject_ids],
      counterpart_ids: [...eventA.pregnancy_relevance.counterpart_ids],
    },
  });

  const afterFloor10 = fixture.runtime.store.getFloor(0, 0);
  const afterFloor15 = fixture.runtime.store.getFloor(1, 0);
  const afterFloor20 = fixture.runtime.store.getFloor(2, 0);
  const afterSwipe1 = fixture.runtime.store.getFloor(2, 1);
  assert.deepEqual(afterFloor10, beforeFloor10);
  assert.deepEqual(afterFloor15, beforeFloor15);
  assert.deepEqual(afterSwipe1, beforeSwipe1);
  assert.deepEqual(
    afterFloor20.events.find(event => event.event_id === eventB.event_id),
    eventB,
  );
  const updatedEventA = afterFloor20.events.find(event => event.event_id === eventA.event_id);
  assert.equal(updatedEventA.location, "当前 Floor 修改地点");
  assert.equal(updatedEventA.event_id, eventA.event_id);
  assert.deepEqual(updatedEventA.source, eventA.source);
  assert.deepEqual(
    updatedEventA.pregnancy_relevance.gestational_subject_ids,
    eventA.pregnancy_relevance.gestational_subject_ids,
  );
  fixture.runtime.destroy();
});

test("event edit validates the complete Floor collection before saving or rebuilding Registry", async () => {
  const traces = [];
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
    notify(event) {
      if (event?.type === "BIOWEAVE_PERSISTENCE_TRACE") traces.push(event.payload);
    },
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
  await fixture.runtime.updateEvent(secondEvent.event_id, {
      participants: [
        { ...secondEvent.participants[0], character_id: firstSubjectId },
        { ...secondEvent.participants[1] },
      ],
      pregnancy_relevance: {
        ...secondEvent.pregnancy_relevance,
        gestational_subject_ids: [firstSubjectId],
      },
    });

  assert.ok(fixture.saveFloorCalls() > beforeFloorSaveCalls);
  assert.ok(fixture.saveChatMetadataCalls() >= beforeRegistrySaveCalls);
  assert.equal(traces.some(trace => trace.stage === "EVENT_EDIT_VALIDATION_FAILED"), false);
  assert.deepEqual(
    (await fixture.runtime.getCurrentFloorEvents()).map(
      (event) => event.pregnancy_relevance.gestational_subject_ids,
    ),
    [[firstSubjectId], [firstSubjectId]],
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
    reliableStoryTime: true,
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
  assert.equal(fixture.runtime.getActivityState().busy, false);
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

test("non-empty normalized Event result missing from canonical Floor state stops without retry", async () => {
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
  assert.equal(analyzeCalls, 1);
  const trace = fixture.runtime.getPersistenceTrace().sequence;
  assert.ok(trace.some(item =>
    item.stage === "CHARACTER_UI_READY" &&
    item.ready === false &&
    item.reason === "canonical_event_state_missing",
  ));
  assert.equal(trace.filter(item => item.stage === "EVENT_STAGE_RETRY_SCHEDULED").length, 0);
  fixture.runtime.destroy();
});

test("Domain collection allows the same subject in separate Events", async () => {
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
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const status = await fixture.runtime.getCurrentFloorAnalysisStatus();
  assert.equal(status.state, "success");
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
  // Event success schedules Projection post-processing asynchronously. Await
  // that existing runtime barrier before starting the cancellation scenario so
  // the assertion below covers the cancelled Event execution only.
  await fixture.runtime.refreshProjection();
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
  assert.equal(fixture.runtime.getActivityState().busy, false);
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

test("World Model archive creates a historical snapshot and deletion rolls back archive state", async () => {
  const messages = [
    { message_id: "m10-history", floor: 10, content: "F10", role: "assistant" },
    { message_id: "m18-history", floor: 18, content: "F18", role: "assistant" },
    { message_id: "m20-history", floor: 20, content: "F20", role: "assistant" },
    { message_id: "m21-history", floor: 21, content: "F21", role: "assistant" },
  ];
  const fixture = createFixture({ messages });
  await fixture.runtime.init();
  const modelA = {
    schema_version: 1,
    species: [{ name: "Species X", biological_types: [] }],
  };
  const metaA = { archived_species: [] };
  await fixture.runtime.saveWorldModel({
    model: modelA,
    meta: metaA,
    selector: { __messageIndex: true, index: 0 },
  });

  const archived = archiveWorldModelSpecies(modelA, metaA, "Species X", {
    archivedAt: "floor-20",
  });
  assert.equal(archived.changed, true);
  await fixture.runtime.saveWorldModel({
    model: archived.model,
    meta: archived.meta,
    selector: { __messageIndex: true, index: 2 },
  });

  assert.equal(
    (await fixture.runtime.resolveWorldModelAtOrBefore({ __messageIndex: true, index: 1 })).model.species[0].name,
    "Species X",
  );
  assert.deepEqual(fixture.runtime.store.getFloor(0).world_model.species.map(item => item.name), ["Species X"]);
  assert.deepEqual(fixture.runtime.store.getFloor(2).world_model.species, []);
  assert.equal(fixture.runtime.store.getFloor(2).world_model_meta.archived_species[0].species.name, "Species X");

  assert.deepEqual(
    (await fixture.runtime.resolveWorldModelAtOrBefore({ __messageIndex: true, index: 2 })).model.species,
    [],
  );
  assert.deepEqual(
    (await fixture.runtime.resolveWorldModelAtOrBefore({ __messageIndex: true, index: 3 })).model.species,
    [],
  );

  messages.splice(2);
  const rolledBack = await fixture.runtime.resolveWorldModelAtOrBefore();
  assert.deepEqual(rolledBack.model.species.map(item => item.name), ["Species X"]);
  assert.equal(rolledBack.meta.archived_species.length, 0);
  assert.deepEqual(fixture.runtime.store.getFloor(0).world_model.species.map(item => item.name), ["Species X"]);
  fixture.runtime.destroy();
});

test("World Model history preserves complete Supplement snapshots and Archive state across rollback", async () => {
  const messages = [
    { message_id: "m2-evolution", floor: 2, content: "Floor 2 full world", role: "assistant" },
  ];
  let patchCalls = 0;
  const modelA = normalizeWorldModel({
    schema_version: 1,
    species: [{ name: "Species-A", biological_types: [] }],
  });
  const fixture = createFixture({
    messages,
    analyzer: {
      async analyzeWorldModel() {
        return modelA;
      },
      async analyzeWorldModelPatchV2(input) {
        patchCalls += 1;
        const names = input.analysisInput.world_model.species.map(item => item.name);
        if (patchCalls === 1) {
          assert.deepEqual(names, ["Species-A"]);
          assert.deepEqual(input.analysisInput.world_model_meta.archived_species, []);
          return {
            patch: {
              schema_version: 2,
              operations: [{op: "ADD_SPECIES", species: {name: "Species-B", biological_types: []}}],
            },
            classified: [],
          };
        }
        assert.deepEqual(names, ["Species-B"]);
        assert.equal(input.analysisInput.world_model_meta.archived_species[0].species.name, "Species-A");
        return {
          patch: {
            schema_version: 2,
            operations: [{op: "ADD_SPECIES", species: {name: "Species-C", biological_types: []}}],
          },
          classified: [],
        };
      },
    },
  });

  await fixture.runtime.analyzeCurrentWorldModelFull({analysisInput: {character: {description: "Floor 2 evidence"}}});
  const floor2 = fixture.runtime.store.getFloor(0, 0);
  assert.deepEqual(floor2.world_model.species.map(item => item.name), ["Species-A"]);

  messages.push({message_id: "m4-evolution", floor: 4, content: "Floor 4 no world analysis", role: "assistant"});
  assert.deepEqual(
    (await fixture.runtime.resolveWorldModelAtOrBefore({__messageIndex: true, index: 1})).model.species.map(item => item.name),
    ["Species-A"],
  );
  assert.equal(fixture.runtime.store.getFloor(1, 0).world_model, null);

  messages.push({message_id: "m6-evolution", floor: 6, content: "Floor 6 discovers Species B", role: "assistant"});
  await fixture.runtime.analyzeCurrentWorldModelPatch({
    analysisInput: {
      worldbooks: [{entries: [{content: "Species: Species-B"}]}],
    },
    trigger: "history-supplement-b",
  });
  const floor6 = fixture.runtime.store.getFloor(2, 0);
  assert.deepEqual(floor6.world_model.species.map(item => item.name), ["Species-A", "Species-B"]);
  assert.deepEqual(fixture.runtime.store.getFloor(0, 0).world_model.species.map(item => item.name), ["Species-A"]);

  messages.push({message_id: "m8-evolution", floor: 8, content: "Floor 8 archives Species A", role: "assistant"});
  const floor6Model = await fixture.runtime.resolveWorldModelAtOrBefore({__messageIndex: true, index: 2});
  const archived = archiveWorldModelSpecies(floor6Model.model, floor6Model.meta, "Species-A", {
    archivedAt: "floor-8",
  });
  assert.equal(archived.changed, true);
  await fixture.runtime.saveWorldModel({model: archived.model, meta: archived.meta});
  const floor8 = fixture.runtime.store.getFloor(3, 0);
  assert.deepEqual(floor8.world_model.species.map(item => item.name), ["Species-B"]);
  assert.equal(floor8.world_model_meta.archived_species[0].species.name, "Species-A");
  assert.deepEqual(
    (await fixture.runtime.resolveWorldModelAtOrBefore({__messageIndex: true, index: 2})).model.species.map(item => item.name),
    ["Species-A", "Species-B"],
  );

  messages.push({message_id: "m10-evolution", floor: 10, content: "Floor 10 discovers Species C", role: "assistant"});
  await fixture.runtime.analyzeCurrentWorldModelPatch({
    analysisInput: {
      worldbooks: [{entries: [{content: "Species: Species-C"}]}],
    },
    trigger: "history-supplement-c",
  });
  const floor10 = fixture.runtime.store.getFloor(4, 0);
  assert.deepEqual(floor10.world_model.species.map(item => item.name), ["Species-B", "Species-C"]);
  assert.equal(floor10.world_model_meta.archived_species[0].species.name, "Species-A");
  assert.equal(floor10.world_model.species.some(item => item.name === "Species-A"), false);
  assert.deepEqual(fixture.runtime.store.getFloor(3, 0).world_model.species.map(item => item.name), ["Species-B"]);
  assert.equal(fixture.runtime.store.getFloor(3, 0).world_model_meta.archived_species[0].species.name, "Species-A");
  assert.equal(patchCalls, 2);

  assert.deepEqual(
    (await fixture.runtime.resolveWorldModelAtOrBefore({__messageIndex: true, index: 0})).model.species.map(item => item.name),
    ["Species-A"],
  );
  assert.deepEqual(
    (await fixture.runtime.resolveWorldModelAtOrBefore({__messageIndex: true, index: 1})).model.species.map(item => item.name),
    ["Species-A"],
  );
  assert.deepEqual(
    (await fixture.runtime.resolveWorldModelAtOrBefore({__messageIndex: true, index: 2})).model.species.map(item => item.name),
    ["Species-A", "Species-B"],
  );
  const resolved8 = await fixture.runtime.resolveWorldModelAtOrBefore({__messageIndex: true, index: 3});
  assert.deepEqual(resolved8.model.species.map(item => item.name), ["Species-B"]);
  assert.equal(resolved8.meta.archived_species[0].species.name, "Species-A");
  const resolved10 = await fixture.runtime.resolveWorldModelAtOrBefore({__messageIndex: true, index: 4});
  assert.deepEqual(resolved10.model.species.map(item => item.name), ["Species-B", "Species-C"]);
  assert.equal(resolved10.meta.archived_species[0].species.name, "Species-A");

  messages.splice(4);
  const rollback8 = await fixture.runtime.resolveWorldModelAtOrBefore();
  assert.deepEqual(rollback8.model.species.map(item => item.name), ["Species-B"]);
  assert.equal(rollback8.meta.archived_species[0].species.name, "Species-A");
  messages.splice(3);
  const rollback6 = await fixture.runtime.resolveWorldModelAtOrBefore();
  assert.deepEqual(rollback6.model.species.map(item => item.name), ["Species-A", "Species-B"]);
  assert.equal(rollback6.meta.archived_species.length, 0);
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
  assert.equal(trace.at(-1).source, "cache");
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
  assert.equal(debug.source, "cache");
  assert.equal(debug.candidate, "羲和元年五月初四 午时");
  assert.equal(debug.parsed_parts.era_label, "羲和");
  assert.equal(debug.parsed_parts.year, 1);
  assert.equal(debug.parsed_parts.month, 5);
  assert.equal(debug.parsed_parts.day, 4);
  assert.equal(debug.story_time.day_index, null);
  assert.equal(debug.candidate_source, "synopsis_block_time");
  assert.equal(debug.resolution_source, "cache");
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
  assert.deepEqual(
    restoredIds,
    latestSnapshot.state.processed_event_ids,
  );
  assert.equal(
    new Set(checkpointSnapshot.state.processed_event_ids).size,
    checkpointSnapshot.state.processed_event_ids.length,
  );

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
  assert.equal(Object.hasOwn(subject.reproductive_exposure, 'elapsed_story_days'), false);
  assert.deepEqual(fixture.runtime.store.getFloor(0, 0).snapshot, snapshotA);
  assert.equal(fixture.runtime.store.getFloor(1, 0).snapshot, null);
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

test("Full World Analysis does not receive an Existing baseline field", async () => {
  let receivedInput = null;
  const fixture = createFixture({
    messages: [{ message_id: "current-floor", floor: 6, content: "独立完整分析", role: "assistant" }],
    analyzer: {
      async analyzeWorldModel({ analysisInput }) {
        receivedInput = analysisInput;
        return normalizeWorldModel({ schema_version: 1, species: [{ name: "Species-A" }] });
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.analyzeCurrentWorldModelFull({
    analysisInput: { world_model: normalizeWorldModel({ schema_version: 1, species: [{ name: "Existing-only" }] }) },
  });
  assert.equal(Object.hasOwn(receivedInput, "world_model"), false);
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

test("automatic World update signal uses v2 Supplement while preserving Full routing", async () => {
  const messages = [
    { message_id: "world-owner", floor: 3, content: "已有世界规则", role: "assistant" },
    { message_id: "current-floor", floor: 6, content: "新增世界规则", role: "assistant" },
  ];
  const worldModel = normalizeWorldModel({ schema_version: 1, species: [{ name: "Species-A" }] });
  let patchCalls = 0;
  let fullCalls = 0;
  const fixture = createFixture({
    messages,
    analyzer: {
      async analyzeWorldModel() { fullCalls += 1; return worldModel; },
      async analyzeWorldModelPatchV2() {
        patchCalls += 1;
        return { patch: { schema_version: 2, operations: [] }, classified: [] };
      },
      async analyzeFloor() { return { events: [] }; },
    },
  });
  await seedWorldOwner(fixture, worldModel);
  await fixture.runtime.analyzeFloor({ __messageIndex: true, index: 1 }, { force: false });
  assert.equal(patchCalls, 1);
  assert.equal(fullCalls, 0);
  fixture.runtime.destroy();
});

test("Manual Character Analysis reuses a valid current World without World AI", async () => {
  const messages = [{ message_id: "current-floor", floor: 6, content: "当前剧情", role: "assistant" }];
  const worldModel = normalizeWorldModel({ schema_version: 1, species: [{ name: "当前世界" }] });
  let worldCalls = 0;
  let eventCalls = 0;
  let receivedWorld = null;
  const fixture = createFixture({
    messages,
    analyzer: {
      async analyzeWorldModel() {
        worldCalls += 1;
        return worldModel;
      },
      async analyzeFloor({ world_model }) {
        eventCalls += 1;
        receivedWorld = world_model;
        return { events: [] };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.store.saveFloor(0, 0, {
    ...emptyFloor(),
    floor_version: await floorVersion({ chatId: "chat-runtime", messageId: "current-floor", floor: 6, text: "当前剧情" }),
    world_model: worldModel,
  });

  const result = await fixture.runtime.analyzeCurrentCharacterEvents();

  assert.equal(result.status, "success");
  assert.equal(worldCalls, 0);
  assert.equal(eventCalls, 1);
  assert.deepEqual(receivedWorld, worldModel);
  assert.deepEqual(fixture.runtime.store.getFloor(0).world_model, worldModel);
  assert.equal(fixture.runtime.store.getFloor(0).analysis.status, "success");
  fixture.runtime.destroy();
});

test("Manual Character Analysis hands the committed Floor to Projection post-processing", async () => {
  const messages = [{ message_id: "manual-projection-floor", floor: 6, content: "当前剧情", role: "assistant" }];
  const worldModel = normalizeWorldModel({ schema_version: 1, species: [{ name: "当前世界" }] });
  const notifications = [];
  const fixture = createFixture({
    messages,
    notify: event => notifications.push(event),
    analyzer: {
      async analyzeFloor() { return { events: [] }; },
      async generateStoryline() { return JSON.stringify({branches: []}); },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.store.saveFloor(0, 0, {
    ...emptyFloor(),
    floor_version: await floorVersion({ chatId: "chat-runtime", messageId: "manual-projection-floor", floor: 6, text: "当前剧情" }),
    world_model: worldModel,
  });

  const result = await fixture.runtime.analyzeCurrentCharacterEvents();
  assert.equal(result.status, "success");
  const dispatch = fixture.runtime.getPersistenceTrace().sequence.find(entry => entry.stage === "PROJECTION_POSTPROCESS_DISPATCH");
  assert.equal(dispatch?.action, "run");
  assert.equal(dispatch?.is_manual_execution, true);
  assert.equal(
    fixture.runtime.getPersistenceTrace().sequence.some(entry => entry.stage === "PROJECTION_POSTPROCESS_COMPLETED"),
    true,
  );
  assert.equal(
    fixture.runtime.getPersistenceTrace().sequence.some(entry => entry.stage === "PROJECTION_PROCESS_STARTED"),
    true,
    `${JSON.stringify(fixture.runtime.getPersistenceTrace().sequence.map(entry => entry.stage))}\n${JSON.stringify(fixture.runtime.getPersistenceTrace().sequence.filter(entry => entry.stage === "PROJECTION_POSTPROCESS_DISPATCH"))}\n${JSON.stringify(notifications.filter(event => event?.type === "PROJECTION_ANALYSIS_STATUS_CHANGED"))}`,
  );
  fixture.runtime.destroy();
});

test("Manual Character Analysis reuses the nearest valid inherited World without World AI", async () => {
  const messages = [
    { message_id: "world-owner", floor: 3, content: "已有世界", role: "assistant" },
    { message_id: "current-floor", floor: 6, content: "当前剧情", role: "assistant" },
  ];
  const worldModel = normalizeWorldModel({ schema_version: 1, species: [{ name: "继承世界" }] });
  let worldCalls = 0;
  let eventCalls = 0;
  const fixture = createFixture({
    messages,
    analyzer: {
      async analyzeWorldModel() {
        worldCalls += 1;
        return worldModel;
      },
      async analyzeFloor({ world_model }) {
        eventCalls += 1;
        assert.deepEqual(world_model, worldModel);
        return { events: [] };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.store.saveFloor(0, 0, {
    ...emptyFloor(),
    floor_version: await floorVersion({ chatId: "chat-runtime", messageId: "world-owner", floor: 3, text: "已有世界" }),
    world_model: worldModel,
  });

  const result = await fixture.runtime.analyzeCurrentCharacterEvents();

  assert.equal(result.status, "success");
  assert.equal(worldCalls, 0);
  assert.equal(eventCalls, 1);
  assert.equal(fixture.runtime.store.getFloor(1).world_model, null);
  fixture.runtime.destroy();
});

test("Manual Character Analysis fails closed without a persisted World and writes no terminal failure", async () => {
  let worldCalls = 0;
  let eventCalls = 0;
  const fixture = createFixture({
    analyzer: {
      async analyzeWorldModel() {
        worldCalls += 1;
        throw new Error("WORLD_AI_MUST_NOT_BE_CALLED");
      },
      async analyzeFloor() {
        eventCalls += 1;
        throw new Error("EVENT_AI_MUST_NOT_BE_CALLED");
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.store.saveFloor(0, 0, {
    ...emptyFloor(),
    analysis: { status: "success", attempt: 3 },
  });
  const saveFloorCallsBefore = fixture.saveFloorCalls();

  await assert.rejects(
    fixture.runtime.analyzeCurrentCharacterEvents(),
    error => error?.code === "WORLD_MODEL_REQUIRED" && error?.prerequisite_failed === true,
  );

  assert.equal(worldCalls, 0);
  assert.equal(eventCalls, 0);
  assert.equal(fixture.saveFloorCalls(), saveFloorCallsBefore);
  assert.deepEqual(fixture.runtime.store.getFloor(0).analysis, { status: "success", attempt: 3 });
  fixture.runtime.destroy();
});

test("Manual Character Analysis skips a stale current World and reuses a valid inherited World", async () => {
  const messages = [
    { message_id: "world-owner", floor: 3, content: "已有世界", role: "assistant" },
    { message_id: "current-floor", floor: 6, content: "当前剧情", role: "assistant" },
  ];
  const worldModel = normalizeWorldModel({ schema_version: 1, species: [{ name: "合法继承世界" }] });
  let worldCalls = 0;
  let eventCalls = 0;
  const fixture = createFixture({
    messages,
    analyzer: {
      async analyzeWorldModel() {
        worldCalls += 1;
        return worldModel;
      },
      async analyzeFloor({ world_model }) {
        eventCalls += 1;
        assert.deepEqual(world_model, worldModel);
        return { events: [] };
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.store.saveFloor(0, 0, {
    ...emptyFloor(),
    floor_version: await floorVersion({ chatId: "chat-runtime", messageId: "world-owner", floor: 3, text: "已有世界" }),
    world_model: worldModel,
  });
  await fixture.runtime.store.saveFloor(1, 0, {
    ...emptyFloor(),
    floor_version: await floorVersion({ chatId: "chat-runtime", messageId: "current-floor", floor: 6, text: "旧版本剧情" }),
    world_model: normalizeWorldModel({ schema_version: 1, species: [{ name: "过期世界" }] }),
  });

  const result = await fixture.runtime.analyzeCurrentCharacterEvents();

  assert.equal(result.status, "success");
  assert.equal(worldCalls, 0);
  assert.equal(eventCalls, 1);
  fixture.runtime.destroy();
});

test("World Patch Analysis merges v2 sparsely and saves only the current Floor", async () => {
  const messages = [
    { message_id: "world-a-floor", floor: 3, content: "A", role: "assistant" },
    { message_id: "world-b-floor", floor: 6, content: "Species-A 中 Type-B 是少数但稳定存在的 biological type。", role: "assistant" },
  ];
  const worldA = normalizeWorldModel({ schema_version: 1, species: [{ name: "Species-A", biological_types: [{ name: "Type-A" }] }] });
  let patchCalls = 0;
  let receivedWorld = null;
  const fixture = createFixture({
    retryCount: 1,
    messages,
    analyzer: {
      async analyzeWorldModelPatchV2(input) {
        patchCalls += 1;
        return patchCalls === 1
          ? {
              patch: {
                schema_version: 2,
                operations: [{
                  op: "ADD_TYPE",
                  target: { kind: "species", species_name: "Species-A" },
                  type: { name: "Type-B" },
                }],
              },
              classified: [],
            }
          : {
              patch: {schema_version: 2, operations: []},
              classified: [],
              fact_delta_summary: {
                supplement_completeness_complete: true,
                coverage_dispositions: buildWorldModelSupplementCoverageTargets(input.analysisInput.world_model)
                  .map(target => ({target_id: target.target_id, disposition: "NO_EVIDENCE"})),
              },
            };
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
  assert.deepEqual(receivedWorld.species[0].biological_types.map(item => item.name), ["Type-A", "Type-B"]);
  assert.deepEqual(fixture.runtime.store.getFloor(0).world_model, worldA);
  assert.deepEqual(fixture.runtime.store.getFloor(1).world_model, receivedWorld);
  fixture.runtime.destroy();
});

test("World Patch persists a new identity without semantic continuation", async () => {
  let patchCalls = 0;
  const fixture = createFixture({
    retryCount: 1,
    messages: [
      worldFloorMessages()[0],
      {...worldFloorMessages()[1], content: "Species-A 中 Type-B 是少数但稳定存在的 biological type。Species-A 中 Type-C 是少数但稳定存在的 biological type。"},
    ],
    analyzer: {
      async analyzeWorldModelPatchV2(input) {
        patchCalls += 1;
        return {
          patch: {
            schema_version: 2,
            operations: [{op: "ADD_TYPE", target: {kind: "species", species_name: "Species-A"}, type: {name: "Type-B"}}],
          },
          classified: [],
        };
      },
    },
  });
  await seedWorldOwner(fixture, normalizeWorldModel({schema_version: 1, species: [{name: "Species-A", biological_types: [{name: "Type-A"}]}]}));
  const result = await fixture.runtime.analyzeCurrentWorldModelPatch({
    analysisInput: {character: {description: "Species-A 中 Type-B 是少数但稳定存在的 biological type。Species-A 中 Type-C 是少数但稳定存在的 biological type。"}},
    trigger: "manual-patch",
  });
  const persisted = fixture.runtime.store.getFloor(1).world_model;
  const summary = fixture.runtime.getWorldModelDiagnosticState().latest_fact_delta;
  assert.equal(patchCalls, 1);
  assert.deepEqual(persisted.species[0].biological_types.map(type => type.name), ["Type-A", "Type-B"]);
  assert.equal(summary.unaccounted_dynamic_target_count, summary.unaccounted_dynamic_target_ids.length);
  assert.ok(summary.dynamic_coverage_target_ids.includes(summary.unaccounted_dynamic_target_ids[0]));
  assert.equal(summary.derived_target_accounting_records.length, 1);
  assert.equal(summary.derived_target_accounting_records[0].record_index, 1);
  assert.equal(summary.derived_target_accounting_records[0].round, undefined);
  assert.equal(summary.dynamic_coverage_unaccounted_in_single_response, true);
  assert.equal(summary.derived_target_accounting_complete, false);
  assert.equal(summary.fact_delta_result, "NO_CHANGE");
  assert.equal(Object.hasOwn(summary, "persistence_occurred"), false);
  const liveState = fixture.runtime.getWorldModelDiagnosticState();
  assert.equal(liveState.execution_result, "UPDATED");
  assert.equal(liveState.persistence_confirmed, true);
  assert.equal(result.final_result, "UPDATED");
  fixture.runtime.destroy();
});

test("World Patch accepts multiple new identities in one response", async () => {
  let patchCalls = 0;
  const fixture = createFixture({
    retryCount: 2,
    messages: [
      worldFloorMessages()[0],
      {...worldFloorMessages()[1], content: "Species-A 中 Type-B 是少数但稳定存在的 biological type。Species-A 中 Type-C 是少数但稳定存在的 biological type。"},
    ],
    analyzer: {
      async analyzeWorldModelPatchV2(input) {
        patchCalls += 1;
        return {
          patch: {
            schema_version: 2,
            operations: [
              {op: "ADD_TYPE", target: {kind: "species", species_name: "Species-A"}, type: {name: "Type-B"}},
              {op: "ADD_TYPE", target: {kind: "species", species_name: "Species-A"}, type: {name: "Type-C"}},
            ],
          },
          classified: [],
        };
      },
    },
  });
  await seedWorldOwner(fixture, normalizeWorldModel({schema_version: 1, species: [{name: "Species-A", biological_types: [{name: "Type-A"}]}]}));
  await fixture.runtime.analyzeCurrentWorldModelPatch({
    analysisInput: {character: {description: "Species-A 中 Type-B 是少数但稳定存在的 biological type。Species-A 中 Type-C 是少数但稳定存在的 biological type。"}},
    trigger: "manual-patch",
  });
  const diagnostic = fixture.runtime.getWorldModelDiagnosticState();
  assert.equal(patchCalls, 1);
  assert.ok(fixture.saveFloorCalls() > 0);
  assert.deepEqual(fixture.runtime.store.getFloor(1).world_model.species[0].biological_types.map(type => type.name), ["Type-A", "Type-B", "Type-C"]);
  assert.equal(diagnostic.latest_fact_delta.failure_code, undefined);
  assert.equal(diagnostic.latest_fact_delta.dynamic_coverage_unaccounted_in_single_response, true);
  assert.equal(diagnostic.latest_fact_delta.derived_target_accounting_complete, false);
  fixture.runtime.destroy();
});

test("World Supplement keeps accepted siblings and excludes a rejected Fact from the final snapshot", async () => {
  const fixture = createFixture({
    messages: worldFloorMessages(),
    analyzer: {
      async analyzeWorldModelPatchV2() {
        return {
          patch: {
            schema_version: 2,
            operations: [
              {op: "SET_FIELD", target: {kind: "biological_type", species_name: "Species-A", type_name: "Type-A"}, path: ["lifecycle", "maturation"], value: "maturation-a"},
              {op: "SET_FIELD", target: {kind: "biological_type", species_name: "Species-A", type_name: "Type-A"}, path: ["lifecycle", "aging"], value: "aging-a"},
            ],
          },
          classified: [],
          fact_delta_summary: {
            accepted_fact_count: 2,
            rejected_fact_count: 1,
            accepted_operation_count: 2,
            evidence_guard_rejected_fact_count: 1,
            canonical_mutation_occurred: true,
          },
        };
      },
    },
  });
  await seedWorldOwner(fixture, normalizeWorldModel({schema_version: 1, species: [{name: "Species-A", biological_types: [{name: "Type-A"}]}]}));

  await fixture.runtime.analyzeCurrentWorldModelPatch({
    analysisInput: {character: {description: "Species-A 中 Type-B 是稳定存在的 biological type，Type-A 的 maturation 是 maturation-a，aging 是 aging-a。"}},
    trigger: "manual-patch",
  });
  const persisted = fixture.runtime.store.getFloor(1).world_model;
  assert.deepEqual(persisted.species[0].biological_types.map(type => type.name), ["Type-A"]);
  assert.equal(persisted.species[0].biological_types[0].lifecycle.maturation, "maturation-a");
  assert.equal(persisted.species[0].biological_types[0].lifecycle.aging, "aging-a");
  assert.equal(JSON.stringify(persisted).includes("rejected"), false);
  fixture.runtime.destroy();
});

test("Supplement Fact Delta diagnostic callbacks carry patch retry correlation without changing persistence", async () => {
  const received = [];
  const fixture = createFixture({
    messages: [
      { message_id: "world-owner", floor: 3, content: "已有世界规则", role: "assistant" },
      { message_id: "current-floor", floor: 6, content: "当前楼层新增世界规则", role: "assistant" },
    ],
    analyzer: {
      async analyzeWorldModelPatchV2(input) {
        received.push({
          attempt: input.fact_delta_attempt,
          retry_index: input.fact_delta_retry_index,
          hasCallback: typeof input.onFactDeltaTrace === "function",
        });
        input.onFactDeltaTrace?.({
          stage: "WORLD_FACT_DELTA_PARSED",
          fact_count: 0,
          fields: [],
          scope_summary: {},
          address_summary: [],
        });
        input.onFactDeltaTrace?.({
          stage: "WORLD_FACT_DELTA_RESOLVED",
          fact_count: 0,
          patch_operation_count: 0,
          analysis_stage_succeeded: true,
          accepted_fact_count: 0,
          rejected_fact_count: 0,
          accepted_operation_count: 0,
          canonical_mutation_occurred: false,
          fact_mappings: [],
        });
        return {
          patch: {schema_version: 2, operations: []},
          classified: [],
          fact_delta_summary: {
            analysis_stage_succeeded: true,
            accepted_fact_count: 0,
            rejected_fact_count: 0,
            accepted_operation_count: 0,
            canonical_mutation_occurred: false,
          },
        };
      },
    },
  });
  await fixture.runtime.init();
  const existing = normalizeWorldModel({schema_version: 1, species: [{name: "Species-A"}]});
  await seedWorldOwner(fixture, existing);
  await fixture.runtime.analyzeCurrentWorldModelPatch({trigger: "manual-patch"});

  assert.deepEqual(received, [{attempt: 1, retry_index: 0, hasCallback: true}]);
  const trace = fixture.runtime.getPersistenceTrace().sequence.filter(entry => (
    entry.stage === "WORLD_FACT_DELTA_PARSED" || entry.stage === "WORLD_FACT_DELTA_RESOLVED"
  ));
  assert.equal(trace.length, 2);
  assert.ok(trace[0].execution_id);
  assert.equal(trace[0].execution_id, trace[1].execution_id);
  assert.equal(trace[0].mode, "patch");
  assert.equal(trace[0].attempt, 1);
  assert.equal(trace[0].retry_index, 0);
  const accepted = fixture.runtime.getPersistenceTrace().sequence.find(entry => entry.stage === "WORLD_ACCEPTED");
  assert.equal(accepted.analysis_stage_succeeded, true);
  assert.equal(accepted.accepted_fact_count, 0);
  assert.equal(accepted.rejected_fact_count, 0);
  assert.equal(accepted.accepted_operation_count, 0);
  assert.equal(accepted.canonical_mutation_occurred, false);
  assert.equal(Object.hasOwn(accepted, 'persistence_occurred'), false);
  const skipped = fixture.runtime.getPersistenceTrace().sequence.find(entry => entry.stage === "WORLD_PERSISTENCE_SKIPPED");
  assert.equal(skipped.persistence_confirmed, false);
  assert.equal(fixture.runtime.store.getFloor(1).world_model, null);
  assert.deepEqual(fixture.runtime.store.getFloor(0).world_model, existing);
  assert.equal(JSON.stringify(fixture.runtime.store.getFloor(1)).includes("WORLD_FACT_DELTA_PARSED"), false);
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
      async analyzeWorldModelPatchV2() {
        return {
          patch: {
            schema_version: 2,
            operations: [{
              op: "ADD_TYPE",
              target: { kind: "species", species_name: "Missing-Species" },
              type: { name: "Type-B" },
            }],
          },
          classified: [],
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

test("World Patch v2 rejects legacy v1 responses without fallback or persistence", async () => {
  const fixture = createFixture({
    messages: [
      { message_id: "world-owner", floor: 3, content: "已有世界规则", role: "assistant" },
      { message_id: "current-floor", floor: 6, content: "新增世界规则", role: "assistant" },
    ],
    analyzer: {
      async analyzeWorldModelPatchV2() {
        return { patch: { schema_version: 1, add: {}, update: {} }, classified: [] };
      },
      async analyzeFloor() { throw new Error("EVENT_MUST_NOT_RUN"); },
    },
  });
  const existing = normalizeWorldModel({ schema_version: 1, species: [{ name: "Species-A" }] });
  await seedWorldOwner(fixture, existing);
  await assert.rejects(
    fixture.runtime.analyzeFloor({ __messageIndex: true, index: 1 }, { force: true }),
    error => error?.code === "WORLD_MODEL_UNAVAILABLE",
  );
  assert.equal(fixture.runtime.store.getFloor(1).world_model, null);
  assert.deepEqual(fixture.runtime.store.getFloor(0).world_model, existing);
  fixture.runtime.destroy();
});

test("World Patch v2 sparse SET_FIELD preserves untouched Existing data and writes one complete model", async () => {
  const fixture = createFixture({
    messages: [
      { message_id: "world-owner", floor: 3, content: "已有世界规则", role: "assistant" },
      { message_id: "current-floor", floor: 6, content: "Species-A 的 Type-A 可以孕育。", role: "assistant" },
    ],
    analyzer: {
      async analyzeWorldModelPatchV2() {
        return {
          patch: {
            schema_version: 2,
            operations: [{
              op: "SET_FIELD",
              target: { kind: "biological_type", species_name: "Species-A", type_name: "Type-A" },
              path: ["capabilities", "can_carry_pregnancy"],
              value: true,
            }],
          },
          classified: [],
        };
      },
    },
  });
  const existing = normalizeWorldModel({
    schema_version: 1,
    species: [{
      name: "Species-A",
      biological_types: [{
        name: "Type-A",
        capabilities: { can_carry_pregnancy: null, can_produce_ova: true },
        reproduction_rules: { gestation: "Existing gestation" },
        special_rules: ["Existing special rule"],
      }],
    }],
  });
  await seedWorldOwner(fixture, existing);
  const beforeWrites = fixture.saveFloorCalls();
  await fixture.runtime.analyzeCurrentWorldModelPatch({
    analysisInput: { character: { description: "Species-A 的 Type-A 可以孕育。" } },
    trigger: "manual-patch",
  });
  const persisted = fixture.runtime.store.getFloor(1).world_model;
  assert.equal(fixture.saveFloorCalls(), beforeWrites + 1);
  assert.equal(persisted.species[0].biological_types[0].capabilities.can_carry_pregnancy, true);
  assert.equal(persisted.species[0].biological_types[0].capabilities.can_produce_ova, true);
  assert.equal(persisted.species[0].biological_types[0].reproduction_rules.gestation, "Existing gestation");
  assert.deepEqual(persisted.species[0].biological_types[0].special_rules, ["Existing special rule"]);
  assert.equal(persisted.schema_version, 1);
  fixture.runtime.destroy();
});

test("World Patch v2 persists a guarded Cycle mutation at the canonical nested path", async () => {
  const fixture = createFixture({
    messages: [
      { message_id: "world-owner", floor: 3, content: "已有世界规则", role: "assistant" },
      { message_id: "current-floor", floor: 6, content: "Species-A 的稳定规则是 Species-A-Cycle-Rule-A", role: "assistant" },
    ],
    analyzer: {
      async analyzeWorldModelPatchV2() {
        return {
          patch: {
            schema_version: 2,
            operations: [{
              op: "SET_FIELD",
              target: { kind: "biological_type", species_name: "Species-A", type_name: "Type-A" },
              path: ["reproduction_rules", "cycle"],
              value: "Species-A-Cycle-Rule-A",
            }],
          },
          classified: [],
          fact_delta_summary: {
            raw_fact_block_count: 1,
            parsed_fact_count: 1,
            resolution_rejected_fact_count: 0,
            evidence_guard_rejected_fact_count: 0,
            accepted_fact_count: 1,
            accepted_operation_count: 1,
            canonical_mutation_occurred: true,
            fact_mappings: [{
              fact_index: 0,
              field: "Cycle",
              resolver_status: "resolved",
              guard_status: "accepted",
              patch_operation_type: "SET_FIELD",
            }],
          },
        };
      },
    },
  });
  const existing = normalizeWorldModel({
    schema_version: 1,
    species: [{ name: "Species-A", biological_types: [{ name: "Type-A" }] }],
  });
  await seedWorldOwner(fixture, existing);
  await fixture.runtime.analyzeCurrentWorldModelPatch({
    analysisInput: { character: { description: "Species-A 的稳定规则是 Species-A-Cycle-Rule-A" } },
    trigger: "manual-patch",
  });
  const persisted = fixture.runtime.store.getFloor(1).world_model;
  assert.equal(persisted.species[0].biological_types[0].reproduction_rules.cycle, "Species-A-Cycle-Rule-A");
  assert.equal(fixture.runtime.getWorldModelDiagnosticState().latest_fact_delta.fact_mappings[0].snapshot_applied, true);
  assert.equal(fixture.runtime.getPersistenceTrace().sequence.some(item => item.stage === "WORLD_PERSISTENCE_CONFIRMED"), true);
  fixture.runtime.destroy();
});

test("World Supplement snapshot applies collection append and Unknown resolution in one Floor commit", async () => {
  const existing = normalizeWorldModel({
    schema_version: 1,
    species: [{ name: "Species-A", biological_types: [{ name: "Type-A", special_rules: ["A"], reproduction_rules: { cycle: "old" } }] }],
    exceptions: [{ statement: "A", applies_to: "Species-A" }],
    unknowns: ["U1", "U2"],
  });
  const finalSnapshot = normalizeWorldModel({
    schema_version: 1,
    species: [{ name: "Species-A", biological_types: [{ name: "Type-A", special_rules: ["A", "B"], reproduction_rules: { cycle: "updated" } }] }],
    exceptions: [{ statement: "A", applies_to: "Species-A" }, { statement: "B", applies_to: "Species-A" }],
    unknowns: ["U2", "U3"],
  });
  let supplementCalls = 0;
  const fixture = createFixture({
    messages: worldFloorMessages(),
    analyzer: {
      async analyzeWorldModelPatchV2(input) {
        supplementCalls += 1;
        assert.deepEqual(input.analysisInput.world_model.unknowns, ["U1", "U2"]);
        return {
          patch: { schema_version: 2, operations: [{ op: "ADD_SPECIAL_RULE" }, { op: "ADD_EXCEPTION" }, { op: "SET_FIELD" }] },
          snapshot_model: finalSnapshot,
          classified: [],
          fact_delta_summary: {
            accepted_operation_count: 3,
            accepted_fact_count: 4,
            canonical_mutation_occurred: true,
            collection_lifecycle: {
              special_rule_appended_count: 1,
              exception_appended_count: 1,
              unknown_resolved_count: 1,
            },
          },
        };
      },
    },
  });
  await seedWorldOwner(fixture, existing);
  const beforeWrites = fixture.saveFloorCalls();
  await fixture.runtime.analyzeCurrentWorldModelPatch({
    analysisInput: { character: { description: "World Supplement evidence" } },
    trigger: "manual-patch",
  });
  const persisted = fixture.runtime.store.getFloor(1).world_model;
  assert.equal(supplementCalls, 1);
  assert.equal(fixture.saveFloorCalls(), beforeWrites + 1);
  assert.deepEqual(persisted.species[0].biological_types[0].special_rules, ["A", "B"]);
  assert.deepEqual(persisted.exceptions.map(item => item.statement), ["A", "B"]);
  assert.deepEqual(persisted.unknowns, ["U2", "U3"]);
  assert.equal(persisted.species[0].biological_types[0].reproduction_rules.cycle, "updated");
  assert.equal(
    fixture.runtime.getPersistenceTrace().sequence.filter(item => item.stage === "WORLD_PERSISTENCE_CONFIRMED").length,
    1,
  );
  fixture.runtime.destroy();
});

test("World Patch v2 empty operations preserve the complete Existing model", async () => {
  const fixture = createFixture({
    messages: [
      { message_id: "world-owner", floor: 3, content: "已有世界规则", role: "assistant" },
      { message_id: "current-floor", floor: 6, content: "新增世界规则但没有合法变化", role: "assistant" },
    ],
    analyzer: {
      async analyzeWorldModelPatchV2() {
        return { patch: { schema_version: 2, operations: [] }, classified: [] };
      },
    },
  });
  const existing = normalizeWorldModel({
    schema_version: 1,
    species: [{ name: "Species-A", biological_types: [{ name: "Type-A", special_rules: ["Keep me"] }] }],
    unknowns: ["Existing unknown"],
  });
  await seedWorldOwner(fixture, existing);
  const beforeWrites = fixture.saveFloorCalls();
  await fixture.runtime.analyzeCurrentWorldModelPatch({ analysisInput: {}, trigger: "manual-patch" });
  assert.equal(fixture.runtime.store.getFloor(1).world_model, null);
  assert.deepEqual(fixture.runtime.store.getFloor(0).world_model, existing);
  assert.equal(fixture.saveFloorCalls(), beforeWrites);
  fixture.runtime.destroy();
});

test("World Patch v2 canonical no-op skips the Floor transaction", async () => {
  const fixture = createFixture({
    messages: [{ message_id: "current-floor", floor: 6, content: "无变化", role: "assistant" }],
    analyzer: { async analyzeWorldModelPatchV2() { return {patch: {schema_version: 2, operations: []}, classified: []}; } },
  });
  const model = normalizeWorldModel({schema_version: 1, species: [{name: "Species-A", biological_types: [{name: "Type-A"}]}]});
  await fixture.runtime.init();
  await fixture.runtime.store.saveFloor(0, 0, {
    ...emptyFloor(),
    floor_version: await floorVersion({chatId: "chat-runtime", messageId: "current-floor", floor: 6, text: "无变化"}),
    world_model: model,
  });
  const beforeWrites = fixture.saveFloorCalls();
  await fixture.runtime.analyzeCurrentWorldModelPatch({analysisInput: {}, trigger: "manual-patch"});
  assert.equal(fixture.saveFloorCalls(), beforeWrites);
  assert.equal(fixture.runtime.getPersistenceTrace().sequence.some(item => item.stage === "WORLD_PERSISTENCE_SKIPPED" && item.reason === "canonical_noop"), true);
  assert.equal(fixture.runtime.getPersistenceTrace().sequence.some(item => item.stage === "WORLD_CANDIDATE_CREATED"), false);
  fixture.runtime.destroy();
});

test("World Patch distinguishes all Guard-rejected Facts from a true no-op", async () => {
  const fixture = createFixture({
    messages: [
      {message_id: "world-owner", floor: 3, content: "已有世界规则", role: "assistant"},
      {message_id: "all-rejected-floor", floor: 6, content: "Fact attempts", role: "assistant"},
    ],
    analyzer: {
      async analyzeWorldModelPatchV2() {
        return {
          patch: {schema_version: 2, operations: []},
          classified: [],
          fact_delta_summary: {
            raw_fact_block_count: 1,
            parsed_fact_count: 1,
            parse_rejected_fact_count: 0,
            resolution_rejected_fact_count: 0,
            evidence_guard_rejected_fact_count: 1,
            rejected_fact_count: 1,
            accepted_fact_count: 0,
            accepted_operation_count: 0,
            canonical_mutation_occurred: false,
          },
        };
      },
    },
  });
  await fixture.runtime.init();
  await seedWorldOwner(fixture, normalizeWorldModel({schema_version: 1, species: [{name: "Species-A", biological_types: [{name: "Type-A"}]}]}));
  await assert.rejects(
    fixture.runtime.analyzeCurrentWorldModelPatch({trigger: "manual-patch"}),
    error => error.code === "WORLD_MODEL_SUPPLEMENT_ALL_FACTS_REJECTED",
  );
  const diagnostic = fixture.runtime.getWorldModelDiagnosticState();
  assert.equal(diagnostic.execution_result, "ALL_FACTS_REJECTED");
  assert.equal(diagnostic.candidate_execution_id, undefined);
  assert.equal(diagnostic.latest_fact_delta.fact_delta_result, "ALL_FACTS_REJECTED");
  fixture.runtime.destroy();
});

test("World Fact Delta diagnostics retain the latest non-empty execution after an empty no-op", async () => {
  let patchCalls = 0;
  const fixture = createFixture({
    messages: [
      { message_id: "world-owner", floor: 3, content: "已有世界规则", role: "assistant" },
      { message_id: "current-floor", floor: 6, content: "重复补充", role: "assistant" },
    ],
    analyzer: {
      async analyzeWorldModelPatchV2() {
        patchCalls += 1;
        return patchCalls === 1
          ? {
              patch: {schema_version: 2, operations: []},
              classified: [],
              fact_delta_summary: {raw_fact_block_count: 1, parsed_fact_count: 1, parse_rejected_fact_count: 0, resolution_rejected_fact_count: 0, evidence_guard_rejected_fact_count: 0, accepted_fact_count: 1, accepted_operation_count: 1, canonical_mutation_occurred: true},
            }
          : {
              patch: {schema_version: 2, operations: []},
              classified: [],
              fact_delta_summary: {raw_fact_block_count: 0, parsed_fact_count: 0, resolution_rejected_fact_count: 0, evidence_guard_rejected_fact_count: 0, accepted_fact_count: 0, accepted_operation_count: 0, canonical_mutation_occurred: false},
            };
      },
    },
  });
  await fixture.runtime.init();
  await seedWorldOwner(fixture, normalizeWorldModel({schema_version: 1, species: [{name: "Species-A", biological_types: [{name: "Type-A"}]}]}));
  await fixture.runtime.analyzeCurrentWorldModelPatch({trigger: "manual-patch"});
  await fixture.runtime.analyzeCurrentWorldModelPatch({trigger: "manual-patch"});
  const diagnostic = fixture.runtime.getWorldModelDiagnosticState();
  assert.equal(patchCalls, 2);
  assert.equal(diagnostic.latest_fact_delta.raw_fact_block_count, 0);
  assert.equal(diagnostic.latest_nonempty_fact_delta.summary.raw_fact_block_count, 1);
  assert.equal(Object.hasOwn(diagnostic.latest_nonempty_fact_delta, "candidate_model"), false);
  assert.ok(Object.hasOwn(diagnostic.latest_nonempty_fact_delta, "candidate_reference"));
  assert.equal(diagnostic.recent_fact_delta_executions.length, 2);
  fixture.runtime.destroy();
});

test("World Patch v2 persists projection ADD with a generated canonical identity", async () => {
  const fixture = createFixture({
    messages: [
      { message_id: "world-owner", floor: 3, content: "已有世界规则", role: "assistant" },
      { message_id: "current-floor", floor: 6, content: "新增 projection rule", role: "assistant" },
    ],
    analyzer: {
      async analyzeWorldModelPatchV2() {
        return {
          patch: {
            schema_version: 2,
            operations: [{
              op: "ADD_PROJECTION_RULE",
              projection_rule: {
                schema_version: 1,
                mechanism_key: "mechanism-b",
                development_concern_key: "concern-b",
                development_kind: "possible_biological_change",
                trigger: { kind: "story_time_reached", target_story_time: { day_index: 10 } },
              },
            }],
          },
          classified: [],
        };
      },
    },
  });
  const existing = normalizeWorldModel({ schema_version: 1, species: [{ name: "Species-A" }] });
  await seedWorldOwner(fixture, existing);
  const evidence = "World rule mechanism-b supports concern-b possible_biological_change with story_time_reached target story day 10.";
  await fixture.runtime.analyzeCurrentWorldModelPatch({
    analysisInput: { character: { description: evidence } },
    trigger: "manual-patch",
  });
  const persisted = fixture.runtime.store.getFloor(1).world_model;
  assert.match(persisted.projection_rules[0].projection_rule_id, /^projection_rule_/u);
  assert.equal(Object.hasOwn(persisted.projection_rules[0], "raw_projection_rule_id"), false);
  assert.equal(persisted.schema_version, 1);
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
  let resolveEventStage;
  const eventStageStarted = new Promise(resolve => { resolveEventStage = resolve; });
  const fixture = createFixture({
    notify: event => {
      if (
        event?.type === "EVENT_ANALYSIS_STATUS_CHANGED" &&
        event?.payload?.state === "running" &&
        event?.payload?.phase === "event_analysis"
      ) resolveEventStage();
    },
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
  await eventStageStarted;
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

function deferredSignal() {
  let resolve;
  const promise = new Promise(value => { resolve = value; });
  return { promise, resolve };
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
      async analyzeWorldModelPatchV2() {
        patchCalls += 1;
        await gate.pending;
        return { patch: { schema_version: 2, operations: [] }, classified: [] };
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
  const worldStarted = deferredSignal();
  const worldModel = normalizeWorldModel({ schema_version: 1, species: [{ name: "手动完整世界" }] });
  let worldCalls = 0;
  const fixture = createFixture({
    messages: [{ message_id: "current-floor", floor: 6, content: "当前剧情", role: "assistant" }],
    analyzer: {
      async analyzeWorldModel() {
        worldCalls += 1;
        worldStarted.resolve();
        await gate.pending;
        return worldModel;
      },
      async analyzeFloor() { return { events: [] }; },
    },
  });
  await fixture.runtime.init();
  const manual = fixture.runtime.analyzeCurrentWorldModelFull({ analysisInput: {} });
  await worldStarted.promise;
  const automatic = fixture.runtime.analyzeFloor({ __messageIndex: true, index: 0 }, { force: true });
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
      async analyzeWorldModelPatchV2() {
        patchCalls += 1;
        await gate.pending;
        return { patch: { schema_version: 2, operations: [] }, classified: [] };
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
  const worldStarted = deferredSignal();
  const worldA = normalizeWorldModel({ schema_version: 1, species: [{ name: "已有世界" }] });
  const worldB = normalizeWorldModel({ schema_version: 1, species: [{ name: "完整新世界" }] });
  let fullCalls = 0;
  let patchCalls = 0;
  const fixture = createFixture({
    messages: worldFloorMessages(),
    analyzer: {
      async analyzeWorldModel() {
        fullCalls += 1;
        worldStarted.resolve();
        await gate.pending;
        return worldB;
      },
      async analyzeWorldModelPatchV2() {
        patchCalls += 1;
        await gate.pending;
        return { patch: { schema_version: 2, operations: [] }, classified: [] };
      },
    },
  });
  await seedWorldOwner(fixture, worldA);
  const full = fixture.runtime.analyzeCurrentWorldModelFull({ analysisInput: {} });
  await worldStarted.promise;
  const patch = fixture.runtime.analyzeCurrentWorldModelPatch({ analysisInput: {} });
  assert.equal(fullCalls, 1);
  assert.equal(patchCalls, 0);
  gate.release();
  await Promise.all([full, patch]);
  assert.deepEqual(fixture.runtime.store.getFloor(1).world_model, worldB);
  assert.deepEqual(fixture.runtime.store.getFloor(0).world_model, worldA);
  assert.equal(fixture.saveFloorCalls(), 2);
  fixture.runtime.destroy();
});

test("T1/T2/T3/T13 World persistence does not wait for UI ACK or subscriber presence", async () => {
  let candidate = null;
  const fixture = createFixture({
    onWorldCandidate: event => { candidate = event.payload; },
  });
  await fixture.runtime.init();
  const analysis = fixture.runtime.analyzeCurrentWorldModelFull({analysisInput: {}});
  for (let index = 0; index < 20 && !candidate; index += 1)
    await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(candidate);
  await analysis;
  assert.equal(fixture.saveFloorCalls(), 1);
  const stages = fixture.runtime.getPersistenceTrace().sequence.map(item => item.stage);
  assert.ok(stages.indexOf("WORLD_CANDIDATE_CREATED") < stages.indexOf("WORLD_PERSISTENCE_REQUESTED"));
  assert.ok(stages.indexOf("WORLD_PERSISTENCE_REQUESTED") < stages.indexOf("WORLD_PERSISTENCE_CONFIRMED"));
  assert.equal(stages.includes("WORLD_UI_PROJECTION_FAILED"), false);
  fixture.runtime.destroy();

  const absent = createFixture();
  await absent.runtime.init();
  await absent.runtime.analyzeCurrentWorldModelFull({analysisInput: {}});
  assert.equal(absent.saveFloorCalls(), 1);
  absent.runtime.destroy();
});

test("T6/T7/T8/T9/T10/T14 World candidate traces preserve no-op and coordinator readback boundaries", async () => {
  const fixture = createFixture();
  await fixture.runtime.init();
  await fixture.runtime.analyzeCurrentWorldModelFull({analysisInput: {}});
  const stages = fixture.runtime.getPersistenceTrace().sequence.map(item => item.stage);
  assert.ok(stages.indexOf("WORLD_CANDIDATE_CREATED") < stages.indexOf("WORLD_PERSISTENCE_REQUESTED"));
  assert.equal(stages.includes("WORLD_UI_PROJECTION_FAILED"), false);
  assert.ok(stages.indexOf("WORLD_PERSISTENCE_REQUESTED") < stages.indexOf("WORLD_PERSISTENCE_CONFIRMED"));
  assert.ok(stages.includes("WORLD_RECONCILIATION_CONFIRMED"));
  fixture.runtime.destroy();

  const noop = createFixture({
    messages: [{message_id: "noop-floor", floor: 3, content: "当前剧情", role: "assistant"}],
  });
  await noop.runtime.init();
  const current = normalizeWorldModel({schema_version: 1, species: [{name: "人类", biological_types: []}]});
  await noop.runtime.store.saveFloor(0, 0, {
    ...emptyFloor(),
    floor_version: await floorVersion({chatId: "chat-runtime", messageId: "noop-floor", floor: 3, text: "当前剧情"}),
    world_model: current,
  });
  await noop.runtime.analyzeCurrentWorldModelFull({analysisInput: {}});
  assert.equal(noop.runtime.getPersistenceTrace().sequence.some(item => item.stage === "WORLD_PERSISTENCE_SKIPPED" && item.reason === "canonical_noop"), true);
  noop.runtime.destroy();
});

test("T10 authoritative readback mismatch is explicit after the coordinator write", async () => {
  const fixture = createFixture({
    saveFloorHook: ({value}) => {
      value.world_model = normalizeWorldModel({
        schema_version: 1,
        species: [{name: "Species-B", biological_types: []}],
      });
    },
  });
  await fixture.runtime.init();
  await assert.rejects(
    fixture.runtime.analyzeCurrentWorldModelFull({analysisInput: {}}),
    error => error.code === "WORLD_MODEL_PERSISTENCE_PREWRITE_FAILED" &&
      error.cause?.code === "FLOOR_TX_READBACK_FAILED",
  );
  const stages = fixture.runtime.getPersistenceTrace().sequence;
  assert.equal(stages.some(item => item.stage === "WORLD_PERSISTENCE_CONFIRMED"), false);
  fixture.runtime.destroy();
});

test("participant aggregation lock remains disabled across the production Event save, edit, and delete paths", async () => {
  const fixture = createFixture({
    analyzer: {async analyzeFloor() { return {events: [eventResult("lock-disabled-event")]}; }},
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const saved = (await fixture.runtime.getCurrentFloorEvents())[0];
  await fixture.runtime.updateEvent(saved.event_id, {location: "edited-while-gate-disabled"});
  assert.equal((await fixture.runtime.getCurrentFloorEvents())[0].location, "edited-while-gate-disabled");
  await fixture.runtime.deleteEvent(saved.event_id);
  assert.deepEqual(await fixture.runtime.getCurrentFloorEvents(), []);
  fixture.runtime.destroy();
});

test("Event Analysis persists confirmed pregnancy_lifecycle facts and runtime release enables a new cycle snapshot", async () => {
  let analysisPass = 0;
  const lifecycleEvent = eventResult("c1-life", {
    type: "pregnancy_lifecycle",
    pregnancy_relevance: {
      relevant: false,
      possible_conception: false,
      gestational_subject_ids: [],
      counterpart_ids: [],
      confidence: 1,
    },
    state_fact: {
      subject_id: "c1-life-subject",
      payload: {status: "not_pregnant", cycle_id: "c1"},
    },
  });
  const fixture = createFixture({
    analyzer: {
      async analyzeFloor() {
        analysisPass += 1;
        return {events: analysisPass === 1 ? [eventResult("c1-exposure"), lifecycleEvent] : [eventResult("c2-exposure")]};
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const firstFloor = await fixture.runtime.resolveCurrentBioWeaveFloor();
  const firstEvents = await fixture.runtime.getCurrentFloorEvents();
  const lifecycle = firstEvents.find(event => event.type === "pregnancy_lifecycle");
  assert.ok(lifecycle);
  const persistedTimeline = await fixture.runtime.getPregnancyLifecycleTimeline({chatId: "chat-runtime"});
  assert.equal(persistedTimeline.facts.some(fact => fact.fact_id === lifecycle.event_id && fact.status === "not_pregnant"), true);
  const exposure = firstEvents.find(event => event.type === "sexual_activity");
  const aggregation = normalizeParticipantAggregation({
    aggregation_id: "agg-c1-runtime",
    subject_id: lifecycle.state_fact.subject_id,
    pregnancy_id: null,
    mechanism_key: "fertilization",
    cycle_id: "c1",
    timing_instance_id: "timing-c1-runtime",
    reference_story_time: {day_index: 1},
    aggregation_story_time: {day_index: 20},
    elapsed_story_days: 19,
    effective_min_story_days: 14,
    effective_max_story_days: 42,
    sampled_individual_offset_story_days: 0,
    config_snapshot: {schema_version: 1, config_version: 1, base_min_story_days: 14, base_max_story_days: 42, variance_ratio: 0, variance_cap_story_days: 0, total_adjustment_cap_story_days: 0},
    accepted_exposure_event_ids: [exposure.event_id],
    source_basis_refs: {},
    created_at_floor_version: firstFloor.version,
  });
  await fixture.runtime.upsertParticipantAggregation({chatId: "chat-runtime", ownerFloor: {message_index: firstFloor.index}, floorVersion: firstFloor.version, aggregation});
  await fixture.runtime.archiveAndReleasePregnancy({
    ownerFloor: {message_index: firstFloor.index},
    floorVersion: firstFloor.version,
    fact: {fact_id: lifecycle.event_id, subject_id: lifecycle.state_fact.subject_id, pregnancy_id: null, cycle_id: "c1", status: "not_pregnant", source_event_id: lifecycle.event_id},
    aggregation,
    operationKey: "runtime-c1-release",
  });
  assert.equal((await fixture.runtime.getCurrentFloorEvents()).some(event => event.event_id === exposure.event_id), false);
  fixture.context.chat[0].content = "C002 新周期";
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const c2Events = await fixture.runtime.getCurrentFloorEvents();
  assert.equal(c2Events.some(event => event.type === "sexual_activity"), true);
  fixture.runtime.destroy();
});

for (const terminalStatus of ["delivery", "miscarriage", "termination"]) {
  test(`Runtime ${terminalStatus} release deletes C001 Exposure and permits C002`, async () => {
    let analysisPass = 0;
    const lifecycleEvent = eventResult(`c1-${terminalStatus}`, {
      type: "pregnancy_lifecycle",
      pregnancy_relevance: {
        relevant: false,
        possible_conception: false,
        gestational_subject_ids: [],
        counterpart_ids: [],
        confidence: 1,
      },
      state_fact: {
        subject_id: `c1-${terminalStatus}-subject`,
        payload: {
          status: terminalStatus,
          pregnancy_id: `preg-${terminalStatus}`,
          cycle_id: "c1",
        },
      },
    });
    const fixture = createFixture({
      analyzer: {
        async analyzeFloor() {
          analysisPass += 1;
          return {events: analysisPass === 1
            ? [eventResult(`c1-${terminalStatus}-exposure`), lifecycleEvent]
            : [eventResult(`c2-${terminalStatus}-exposure`)]};
        },
      },
    });
    await fixture.runtime.init();
    await fixture.runtime.refreshCurrentFloorAnalysis();
    const firstFloor = await fixture.runtime.resolveCurrentBioWeaveFloor({__messageIndex: true, index: 0});
    const firstEvents = await fixture.runtime.getCurrentFloorEvents();
    const exposure = firstEvents.find(event => event.type === "sexual_activity");
    const aggregation = normalizeParticipantAggregation({
      aggregation_id: `agg-c1-${terminalStatus}`,
      subject_id: `c1-${terminalStatus}-subject`,
      pregnancy_id: `preg-${terminalStatus}`,
      mechanism_key: "fertilization",
      cycle_id: "c1",
      timing_instance_id: `timing-c1-${terminalStatus}`,
      reference_story_time: {day_index: 1},
      aggregation_story_time: {day_index: 20},
      elapsed_story_days: 19,
      effective_min_story_days: 14,
      effective_max_story_days: 42,
      sampled_individual_offset_story_days: 0,
      config_snapshot: {schema_version: 1, config_version: 1, base_min_story_days: 14, base_max_story_days: 42, variance_ratio: 0, variance_cap_story_days: 0, total_adjustment_cap_story_days: 0},
      accepted_exposure_event_ids: [exposure.event_id],
      source_basis_refs: {},
      created_at_floor_version: firstFloor.version,
    });
    await fixture.runtime.upsertParticipantAggregation({chatId: "chat-runtime", ownerFloor: {message_index: firstFloor.index}, floorVersion: firstFloor.version, aggregation});
    await fixture.runtime.archiveAndReleasePregnancy({
      ownerFloor: {message_index: firstFloor.index},
      floorVersion: firstFloor.version,
      fact: {fact_id: lifecycleEvent.event_id, subject_id: `c1-${terminalStatus}-subject`, pregnancy_id: `preg-${terminalStatus}`, cycle_id: "c1", status: terminalStatus, source_event_id: lifecycleEvent.event_id},
      aggregation,
      operationKey: `runtime-c1-${terminalStatus}`,
    });
    assert.equal((await fixture.runtime.getCurrentFloorEvents()).some(event => event.event_id === exposure.event_id), false);
    fixture.context.chat[0].content = `C002 after ${terminalStatus}`;
    await fixture.runtime.refreshCurrentFloorAnalysis();
    assert.equal((await fixture.runtime.getCurrentFloorEvents()).some(event => event.event_id.startsWith("evt_")), true);
    const timeline = await fixture.runtime.getPregnancyLifecycleTimeline({chatId: "chat-runtime"});
    assert.equal(timeline.release_records.some(record => record.action === "cycle-lock-released" && record.cycle_id === "c1"), true);
    fixture.runtime.destroy();
  });
}

test("real Runtime lock capability filters new NSFW Exposure and blocks edit while delete remains allowed", async () => {
  let analysisPass = 0;
  const fixture = createFixture({
    participantAggregationLockCapability: true,
    analyzer: {
      async analyzeFloor() {
        analysisPass += 1;
        return {events: [eventResult(`runtime-lock-${analysisPass}`, {location: analysisPass === 1 ? "C001" : "C001-new"})]};
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const firstFloor = await fixture.runtime.resolveCurrentBioWeaveFloor({__messageIndex: true, index: 0});
  const firstEvent = (await fixture.runtime.getCurrentFloorEvents()).find(event => event.type === "sexual_activity");
  const subjectId = firstEvent.pregnancy_relevance.gestational_subject_ids[0];
  const aggregation = normalizeParticipantAggregation({
    aggregation_id: "agg-runtime-lock",
    subject_id: subjectId,
    pregnancy_id: null,
    mechanism_key: "fertilization",
    cycle_id: "c1",
    timing_instance_id: "timing-runtime-lock",
    reference_story_time: {day_index: 1},
    aggregation_story_time: {day_index: 14},
    elapsed_story_days: 13,
    effective_min_story_days: 14,
    effective_max_story_days: 42,
    sampled_individual_offset_story_days: 0,
    config_snapshot: {schema_version: 1, config_version: 1, base_min_story_days: 14, base_max_story_days: 42, variance_ratio: 0, variance_cap_story_days: 0, total_adjustment_cap_story_days: 0},
    accepted_exposure_event_ids: [firstEvent.event_id],
    source_basis_refs: {},
    created_at_floor_version: firstFloor.version,
  });
  await fixture.runtime.upsertParticipantAggregation({chatId: "chat-runtime", ownerFloor: {message_index: 0}, floorVersion: firstFloor.version, aggregation});
  await assert.rejects(fixture.runtime.updateEvent(firstEvent.event_id, {location: "blocked-edit"}), error => error.code === "PARTICIPANT_AGGREGATION_EVENT_LOCKED");
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const afterAnalysis = await fixture.runtime.getCurrentFloorEvents();
  assert.equal(afterAnalysis.some(event => event.location === "C001-new"), false);
  assert.equal(afterAnalysis.some(event => event.location === "C001"), true);
  await fixture.runtime.deleteEvent(firstEvent.event_id);
  assert.equal((await fixture.runtime.getCurrentFloorEvents()).some(event => event.event_id === firstEvent.event_id), false);
  const releaseFloor = await fixture.runtime.resolveCurrentBioWeaveFloor({__messageIndex: true, index: 0});
  await fixture.runtime.archiveAndReleasePregnancy({
    ownerFloor: {message_index: releaseFloor.index},
    floorVersion: releaseFloor.version,
    fact: {fact_id: "runtime-lock-not-pregnant", subject_id: subjectId, pregnancy_id: null, cycle_id: "c1", status: "not_pregnant", source_event_id: "runtime-lock-not-pregnant"},
    aggregation,
    operationKey: "runtime-lock-release",
  });
  fixture.context.chat[0].content = "C002 after lock release";
  await fixture.runtime.refreshCurrentFloorAnalysis();
  assert.equal((await fixture.runtime.getCurrentFloorEvents()).some(event => event.location === "C001-new"), true);
  fixture.runtime.destroy();
});

test("real Runtime lock capability splits multi-subject output before cycle filtering", async () => {
  let analysisPass = 0;
  const makeSubjectEvent = (eventId, displayName, location) => {
    const source = eventResult(eventId, {location});
    const participants = source.participants.map((participant, index) => ({
      ...participant,
      display_name: index === 0 ? displayName : `${displayName}-source`,
      mention_id: `${displayName}-${index}`,
    }));
    return {
      ...source,
      participants,
      pregnancy_relevance: {
        ...source.pregnancy_relevance,
        gestational_subject_ids: [`${displayName}-0`],
        counterpart_ids: [`${displayName}-1`],
      },
    };
  };
  const fixture = createFixture({
    participantAggregationLockCapability: true,
    analyzer: {
      async analyzeFloor() {
        analysisPass += 1;
        const first = makeSubjectEvent("multi-lock-m", "Alice", analysisPass === 1 ? "M-C001" : "M-new");
        const second = makeSubjectEvent("multi-lock-n", "Carol", analysisPass === 1 ? "N-C001" : "N-new");
        return {events: [first, second]};
      },
    },
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const firstFloor = await fixture.runtime.resolveCurrentBioWeaveFloor({__messageIndex: true, index: 0});
  const firstEvent = (await fixture.runtime.getCurrentFloorEvents()).find(event => event.type === "sexual_activity" && event.location === "M-C001");
  const subjectId = firstEvent.pregnancy_relevance.gestational_subject_ids[0];
  const aggregation = normalizeParticipantAggregation({
    aggregation_id: "agg-runtime-multi-lock",
    subject_id: subjectId,
    pregnancy_id: null,
    mechanism_key: "fertilization",
    cycle_id: "c1",
    timing_instance_id: "timing-runtime-multi-lock",
    reference_story_time: {day_index: 1},
    aggregation_story_time: {day_index: 14},
    elapsed_story_days: 13,
    effective_min_story_days: 14,
    effective_max_story_days: 42,
    sampled_individual_offset_story_days: 0,
    config_snapshot: {schema_version: 1, config_version: 1, base_min_story_days: 14, base_max_story_days: 42, variance_ratio: 0, variance_cap_story_days: 0, total_adjustment_cap_story_days: 0},
    accepted_exposure_event_ids: [firstEvent.event_id],
    source_basis_refs: {},
    created_at_floor_version: firstFloor.version,
  });
  await fixture.runtime.upsertParticipantAggregation({chatId: "chat-runtime", ownerFloor: {message_index: 0}, floorVersion: firstFloor.version, aggregation});
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const events = await fixture.runtime.getCurrentFloorEvents();
  assert.equal(events.some(event => event.location === "M-new"), false);
  assert.equal(events.some(event => event.location === "N-new"), true);
  fixture.runtime.destroy();
});
