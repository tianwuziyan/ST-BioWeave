import {
  buildEventAnalysisInput,
  collectAnalysisContext,
  mergeRecentStorySettings,
  processNarrativeFloor,
} from "../ai/input-builder.js";
import {
  clearWorldbookCache,
  createWorldbookCache,
  loadAnalysisSources,
} from "../ai/worldbook.js";
import {
  safeErrorSummary as clientSafeErrorSummary,
  statusFromError as clientStatusFromError,
  traceApi,
} from "../ai/client.js";
import {
  CAPABILITY_KEYS,
  isPregnancyRelevantExposure,
  normalizeEvent,
  dedupeEvents,
  sortEvents,
  validateEventCollection,
} from "../core/events.js";
import { reduceState } from "../core/state.js";
import {
  hasCharacterId,
  isCompleteCharacterRegistrySnapshot,
  normalizeCharacterRegistry,
  resolveEventAnalysisIdentities,
} from "../core/identity.js";
import {
  explainTrackingDecision,
  rebuildTrackingRegistry,
} from "../core/tracking.js";
import { emptyFloor } from "../storage/schema.js";
import {
  hasSwipeSlot,
  hasSwipeStructure,
  isCharacterMessage,
} from "../storage/store.js";
import {
  differenceStoryTime,
  normalizeStoryTime,
} from "../story/time.js";
import {
  detectExternalMemoryProviders,
  probeExternalMemoryProviders,
} from "../story/seven-days-cal.js";
import {
  commitAnalysis,
  floorVersion,
  floorVersionFromData,
  hashText,
  isIntervalTarget,
  sameFloorVersion,
  shouldAnalyze,
} from "./floor.js";
const AUTO_ANALYSIS_EVENTS = new Set([
  "MESSAGE_RECEIVED",
  "GENERATION_ENDED",
  "MESSAGE_UPDATED",
  "MESSAGE_EDITED",
  "MESSAGE_SWIPED",
  "MESSAGE_SWIPE_DELETED",
]);
const LIFECYCLE_ONLY_EVENTS = new Set([
  // Deletion only invalidates the downstream active path; it never analyzes
  // the message collection after the owner has been removed.
  "MESSAGE_DELETED",
]);
const FORCED_LIFECYCLE_EVENTS = new Set([
  "MESSAGE_UPDATED",
  "MESSAGE_EDITED",
  "MESSAGE_SWIPED",
  "MESSAGE_SWIPE_DELETED",
]);
function scalar(value) {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}
function messagePartText(value) {
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  if (!value || typeof value !== "object") return "";
  return String(
    value.mes ?? value.content ?? value.message ?? value.text ?? "",
  );
}
function messageText(message, swipeId = 0) {
  if (typeof message === "string" || typeof message === "number")
    return String(message);
  if (!message || typeof message !== "object") return "";
  if (message.swipes || message.swipe_info) {
    if (!hasSwipeSlot(message, swipeId)) return "";
    if (
      message.swipes &&
      typeof message.swipes === "object" &&
      message.swipes[swipeId] !== undefined
    ) {
      return messagePartText(message.swipes[swipeId]);
    }
    return messagePartText(message.swipe_info?.[swipeId]);
  }
  return messagePartText(message.mes ?? message.content ?? message.message);
}
function messageRole(message) {
  const role = String(message?.role ?? "")
    .trim()
    .toLowerCase();
  if (["user", "assistant", "system"].includes(role)) return role;
  if (message?.is_system === true) return "system";
  if (message?.is_user === true) return "user";
  return "assistant";
}
function messageFloor(message, index, storedVersion = null) {
  for (const candidate of [
    message?.floor,
    message?.floor_id,
    message?.floorIndex,
    storedVersion?.floor,
    index,
  ]) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  return index;
}
function messageId(message, index, storedVersion = null) {
  for (const candidate of [
    message?.message_id,
    message?.messageId,
    message?.id,
    storedVersion?.message_id,
    index,
  ]) {
    const value = scalar(candidate);
    if (value !== null) return value;
  }
  return index;
}
function messageVersion(message, storedVersion = null) {
  return (
    scalar(
      message?.message_version ??
        message?.messageVersion ??
        message?.version ??
        storedVersion?.message_version,
    ) ?? undefined
  );
}
function defaultCharacterContext(_context, derivedState = {}, analysisInput = {}) {
  return {
    current_character: analysisInput.meta?.character_name ?? null,
    character_card: analysisInput.character ?? {},
    profiles: derivedState.character_profiles ?? {},
  };
}
function currentCharacterRegistryFromStates(states) {
  for (let index = states.length - 1; index >= 0; index -= 1) {
    const state = states[index];
    const analysis = state.floorData?.analysis;
    if (
      analysis?.status !== "success" ||
      !sameFloorVersion(floorVersionFromData(state.floorData), state.version)
    )
      continue;
    const snapshot = normalizedCharacterRegistrySnapshot(
      state.floorData.character_registry,
    );
    if (snapshot) return snapshot;
  }
  return normalizeCharacterRegistry(null);
}
function analysisTimestamp(analysis) {
  return (
    analysis?.last_success?.analyzed_at ??
    analysis?.last_success?.last_analyzed_at ??
    analysis?.analyzed_at ??
    analysis?.last_analyzed_at ??
    null
  );
}
function isRequestAborted(error) {
  const code = String(error?.code ?? "")
    .trim()
    .toUpperCase();
  return (
    error?.name === "AbortError" ||
    code === "REQUEST_ABORTED" ||
    code === "ABORTED" ||
    code === "ERR_ABORTED" ||
    code === "ABORT_ERR" ||
    code === "ERR_CANCELED" ||
    code === "ERR_CANCELLED"
  );
}
function isStaleChat(error) {
  return error?.message === "STALE_CHAT" || error?.code === "STALE_CHAT";
}
function requestAbortedError() {
  const error = new Error("REQUEST_ABORTED");
  error.code = "REQUEST_ABORTED";
  error.analysis_stage = "cancelled";
  return error;
}
function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}
function normalizedCharacterRegistrySnapshot(raw) {
  return isCompleteCharacterRegistrySnapshot(raw)
    ? normalizeCharacterRegistry(raw)
    : null;
}

function buildCharacterFacts(activeEvents, registry = null, characterRegistry = null) {
  const source = registry ?? {};
  const subjects = source.tracking_subjects ?? {};
  const candidates = source.tracking_candidates ?? {};
  const profiles = source.character_profiles ?? {};
  const entities = characterRegistry?.entities ?? {};
  const characterIds = new Set([
    ...Object.keys(subjects),
    ...Object.keys(candidates),
  ]);
  for (const event of activeEvents ?? []) {
    for (const characterId of event?.pregnancy_relevance?.gestational_subject_ids ?? [])
      characterIds.add(characterId);
    const subjectId = event?.state_fact?.subject_id;
    if (subjectId) characterIds.add(subjectId);
  }
  const result = {};
  for (const characterId of [...characterIds].sort()) {
    const profile = profiles[characterId] ?? {};
    const subject = subjects[characterId] ?? {};
    const candidate = candidates[characterId] ?? {};
    const identity = entities[characterId] ?? {};
    const capabilities = candidate.reproductive_capabilities
      ?? profile.reproductive_capabilities
      ?? {};
    result[characterId] = {
      identity: {
        character_id: characterId,
        display_name:
          profile.display_name
          ?? candidate.display_name
          ?? subject.display_name
          ?? identity.display_name
          ?? null,
        species: profile.species ?? candidate.species ?? null,
        biological_type: profile.biological_type ?? candidate.biological_type ?? null,
      },
      reproductive_capabilities: Object.fromEntries(
        CAPABILITY_KEYS.map((key) => [
          key,
          [true, false, null].includes(capabilities[key]) ? capabilities[key] : null,
        ]),
      ),
      resolved_mechanism_facts: [],
    };
  }
  return result;
}
function stableLifecycleValue(value) {
  if (Array.isArray(value)) return value.map(stableLifecycleValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableLifecycleValue(value[key])]),
  );
}
function diagnosticCode(error) {
  const code = String(
    error?.diagnostic_code ?? error?.error_code ?? error?.diagnosticCode ?? "",
  ).trim();
  if (code) return code;
  if (
    error?.code === "EVENT_ANALYSIS_INVALID" &&
    error?.message &&
    error.message !== error.code
  ) {
    return String(error.message);
  }
  return String(error?.code ?? error?.message ?? "EVENT_ANALYSIS_FAILED");
}
function safeDiagnosticSummary(error, stage = null) {
  const code = diagnosticCode(error);
  if (code === "REQUEST_ABORTED") return "用户取消";
  if (code === "API_PROFILE_NOT_CONFIGURED")
    return "事件分析任务没有解析到可用 API 配置";
  if (code === "EVENT_RESPONSE_EMPTY") return "AI 响应为空或未能提取正文";
  if (code === "EVENT_RESPONSE_JSON_INVALID") return "AI 响应不是有效 JSON";
  if (
    code === "EVENT_SCHEMA_INVALID" ||
    code === "domain_validation_failed" ||
    code === "unexpected_top_level_field" ||
    code === "unexpected_event_field" ||
    code === "missing_event_field" ||
    code === "invalid_event_role" ||
    code === "invalid_possible_conception" ||
    code === "invalid_evidence_shape" ||
    code === "participant_reference_invalid" ||
    code === "invalid_gestational_subject_cardinality" ||
    code === "invalid_counterpart_cardinality" ||
    code === "invalid_pregnancy_participants" ||
    code === "gestational_subject_counterpart_overlap" ||
    code === "duplicate_gestational_subject_event" ||
    code === "missing_pregnancy_relevant_exposure_evidence" ||
    code.startsWith("EVENT_ANALYSIS_")
  ) {
    return "AI 返回未通过 Event JSON Schema 校验";
  }
  if (code === "ST_CHAT_STORAGE_UNAVAILABLE")
    return "SillyTavern Chat 存储不可用";
  if (code === "ST_METADATA_STORAGE_UNAVAILABLE")
    return "SillyTavern Chat metadata 存储不可用";
  if (code === "ST_METADATA_UNAVAILABLE")
    return "SillyTavern Chat metadata 存储不可用";
  if (code === "ST_FLOOR_STORAGE_UNAVAILABLE")
    return "SillyTavern Floor 存储不可用";
  if (stage === "floor_resolution")
    return "当前 Floor 解析失败，未生成分析版本";
  if (stage === "floor_version")
    return "Floor Version 计算失败，未生成完整版本";
  if (stage === "request_build") return "Event Analysis 请求构建失败";
  if (stage === "identity_resolution")
    return "Event 中存在未解析或未经 Runtime 授权的人物身份";
  if (stage === "normalization") return "BiologicalEvent 归一化失败";
  if (stage === "registry_rebuild") return "Tracking Registry 重建失败";
  return clientSafeErrorSummary(error);
}
function floorExecutionKey(version) {
  return [
    version?.chat_id,
    version?.message_id,
    version?.floor,
    version?.swipe_id,
    version?.content_hash,
    version?.message_version,
  ]
    .map((value) => String(value ?? ""))
    .join("\u001f");
}
async function deterministicEventId(version, ordinal) {
  const material = [
    "bioweave-event-id-v1",
    version?.chat_id,
    version?.message_id,
    version?.floor,
    version?.swipe_id,
    version?.content_hash,
    version?.message_version,
    ordinal,
  ]
    .map((value) => String(value ?? ""))
    .join("\u001f");
  const digest = await hashText(material);
  return `evt_${digest.slice(0, 24)}_${ordinal + 1}`;
}

async function deterministicStateFactId(version, ordinal, subjectId, kind) {
  const material = [
    'bioweave-state-fact-id-v1',
    kind,
    version?.chat_id,
    version?.message_id,
    version?.floor,
    version?.swipe_id,
    version?.content_hash,
    version?.message_version,
    subjectId,
    ordinal,
  ].map((value) => String(value ?? '')).join('\u001f');
  const digest = await hashText(material);
  return `${kind}_${digest.slice(0, 24)}_${ordinal + 1}`;
}

async function materializeStateFact(event, version, ordinal) {
  if (!event?.state_fact || typeof event.state_fact !== 'object') return event;
  const stateFact = structuredClone(event.state_fact);
  const payload = stateFact.payload && typeof stateFact.payload === 'object'
    ? stateFact.payload
    : {};
  const ref = payload.pregnancy_ref;
  if (ref?.kind === 'new') {
    payload.pregnancy_id = await deterministicStateFactId(
      version,
      ordinal,
      stateFact.subject_id,
      'preg',
    );
    delete payload.pregnancy_ref;
  } else if (ref?.kind === 'existing') {
    payload.pregnancy_id = ref.id;
    delete payload.pregnancy_ref;
  }
  for (const [referenceKey, idKey, kind] of [
    ['labor_ref', 'labor_id', 'labor'],
    ['delivery_ref', 'delivery_id', 'delivery'],
    ['postpartum_ref', 'postpartum_id', 'postpartum'],
  ]) {
    const reference = payload[referenceKey];
    if (!reference) continue;
    payload[idKey] = reference.kind === 'new'
      ? await deterministicStateFactId(version, ordinal, stateFact.subject_id, kind)
      : reference.id;
    delete payload[referenceKey];
  }
  stateFact.payload = payload;
  return { ...event, state_fact: stateFact };
}
function executionError(error, stage = null) {
  const code = diagnosticCode(error);
  const resolvedStage = error?.analysis_stage ?? stage ?? "analysis";
  const path = error?.diagnostic_path ?? error?.error_path ?? null;
  const diagnostic = String(
    error?.diagnostic_code ?? error?.diagnosticCode ?? "",
  ).trim();
  const status = clientStatusFromError(error);
  const result = {
    stage: resolvedStage,
    error_code: code,
    error_path: path,
    diagnostic_path: path,
    safe_error_summary: safeDiagnosticSummary(error, resolvedStage),
  };
  if (diagnostic) result.diagnostic_code = diagnostic;
  if (status !== null) result.http_status = status;
  if (error?.phase) result.phase = String(error.phase);
  if (error?.retryable !== undefined)
    result.retryable = error.retryable === true;
  if (Number.isInteger(error?.attempt) && error.attempt > 0)
    result.attempt = error.attempt;
  if (
    Number.isFinite(Number(error?.timeoutSec)) &&
    Number(error.timeoutSec) > 0
  ) {
    result.timeoutSec = Number(error.timeoutSec);
  }
  if (
    Number.isFinite(Number(error?.timeout_ms)) &&
    Number(error.timeout_ms) > 0
  ) {
    result.timeout_ms = Number(error.timeout_ms);
  }
  return result;
}
function pregnancyExposureSubjectId(event) {
  try {
    const normalized = normalizeEvent(event);
    const relevance = normalized?.pregnancy_relevance;
    if (
      relevance?.relevant !== true ||
      !Array.isArray(relevance.gestational_subject_ids)
    )
      return [];
    return relevance.gestational_subject_ids;
  } catch {
    return [];
  }
}
function domainValidationError(
  validation,
  message = "EVENT_DOMAIN_VALIDATION_FAILED",
  events = null,
) {
  const errors = Array.isArray(validation?.errors) ? validation.errors : [];
  const firstError = errors.find((error) => typeof error === "string") ?? null;
  const duplicateSubjectError = Array.isArray(events)
    ? errors.find((error) => {
        if (typeof error !== "string") return false;
        const match = error.match(
          /^events\[(\d+)\]\.pregnancy_relevance\.gestational_subject_ids\[(\d+)\]$/u,
        );
        if (!match) return false;
        const index = Number(match[1]);
        const subjectIndex = Number(match[2]);
        const subjectIds = pregnancyExposureSubjectId(events[index]);
        const subjectId = subjectIds[subjectIndex] ?? null;
        return subjectId !== null && events
          .slice(0, index)
          .some((event) => pregnancyExposureSubjectId(event).includes(subjectId));
      })
    : null;
  const diagnosticCode = duplicateSubjectError
    ? "duplicate_gestational_subject_event"
    : "domain_validation_failed";
  const diagnosticPath = duplicateSubjectError ?? firstError ?? "events";
  const error = new Error(message);
  error.code = message;
  error.diagnostic_code = diagnosticCode;
  error.error_code = diagnosticCode;
  error.diagnostic_path = `$.${diagnosticPath}`;
  error.error_path = error.diagnostic_path;
  return error;
}

function identityResolutionError(result) {
  const first = Array.isArray(result?.errors)
    ? result.errors.find((item) => item && typeof item === "object")
    : null;
  const code =
    String(first?.error_code ?? "identity_resolution_failed").trim() ||
    "identity_resolution_failed";
  const path = first?.path ?? null;
  const error = new Error("EVENT_IDENTITY_RESOLUTION_FAILED");
  error.code = "EVENT_IDENTITY_RESOLUTION_FAILED";
  error.analysis_stage = "identity_resolution";
  error.diagnostic_code = code;
  error.error_code = code;
  if (path) {
    error.diagnostic_path = path;
    error.error_path = path;
  }
  return error;
}

function analysisNarrative(input = {}) {
  const current = input?.current_floor?.narrative ?? "";
  const recent = Array.isArray(input?.recent_context)
    ? input.recent_context
        .map((item) => item?.content ?? item?.narrative ?? "")
        .filter(Boolean)
    : [];
  return [current, ...recent].join("\n");
}
function withAnalysisStage(error, stage) {
  if (error && typeof error === "object") {
    error.analysis_stage ??= stage;
    return error;
  }
  const wrapped = new Error(String(error ?? "EVENT_ANALYSIS_FAILED"));
  wrapped.analysis_stage = stage;
  return wrapped;
}
function isFloorPreflightStage(stage) {
  return stage === "floor_resolution" || stage === "floor_version";
}
function safeFloorPreflightStatus(error, trackingSubjectCount = 0) {
  const diagnostic = executionError(
    error,
    error?.analysis_stage ?? "floor_resolution",
  );
  return {
    state: "failed",
    busy: false,
    current_floor: null,
    floor_version: null,
    attempt: null,
    last_success: null,
    last_error: diagnostic.error_code,
    error_stage: diagnostic.stage,
    error_code: diagnostic.error_code,
    error_path: diagnostic.error_path,
    diagnostic_path: diagnostic.diagnostic_path,
    safe_error_summary: diagnostic.safe_error_summary,
    started_at: null,
    finished_at: null,
    event_count: 0,
    active_event_count: 0,
    tracking_subject_count: trackingSubjectCount,
    current_floor_events: [],
  };
}
export function createEventAnalysisCoordinator({
  st,
  chat,
  store,
  analyzer,
  storyTime = null,
  storyTimeCoordinator = null,
  characterContextResolver = defaultCharacterContext,
  analysisContextCollector = collectAnalysisContext,
  analysisSourceLoader = loadAnalysisSources,
  analysisSourceLoaderOptions = {},
  externalMemoryProviderLoader = null,
  globalRecentStoryResolver = () => ({}),
  analysisSourceCache = null,
  notify = () => {},
} = {}) {
  if (!st || !chat || !store)
    throw new TypeError("EVENT_ANALYSIS_DEPENDENCIES_REQUIRED");
  const inFlight = new Map();
  const lastTerminal = new Map();
  let attemptSequence = 0;
  let registryRefreshChain = Promise.resolve();
  let lifecycleMutationChain = Promise.resolve();
  let destroyed = false;
  let removeChatBoundaryListener = null;
  const sourceCache = analysisSourceCache ?? createWorldbookCache();
  const invalidatedFloors = new Map();
  let lifecycleSnapshot = null;

  function floorRootExists(index, swipeId) {
    const message = messages()[index];
    if (!message || !hasSwipeSlot(message, swipeId)) return false;
    if (hasSwipeStructure(message))
      return hasOwn(message.swipe_info?.[swipeId]?.extra, "bioweave");
    return hasOwn(message.extra, "bioweave");
  }

  async function captureLifecycleSnapshot(token = chat.token()) {
    const all = messages();
    const entries = [];
    for (let index = 0; index < all.length; index += 1) {
      const swipeId = store.getActiveSwipeId?.(index);
      if (swipeId === null || swipeId === undefined) continue;
      if (!isCharacterMessage(all[index])) {
        entries.push({
          index,
          message_id: messageId(all[index], index),
          role: messageRole(all[index]),
        });
        continue;
      }
      const version = await floorVersion({
        chatId: token.chatId,
        messageId: messageId(all[index], index),
        floor: messageFloor(all[index], index),
        swipeId,
        text: messageText(all[index], swipeId),
        messageVersion: messageVersion(all[index]),
      });
      chat.assert(token);
      entries.push({
        index,
        message_id: version.message_id,
        floor: version.floor,
        swipe_id: version.swipe_id,
        role: messageRole(all[index]),
        content_hash: version.content_hash,
        message_version: version.message_version,
      });
    }
    return { chat_id: token.chatId, epoch: token.epoch, entries };
  }

  async function primeLifecycleSnapshot() {
    try {
      lifecycleSnapshot = await captureLifecycleSnapshot();
      return lifecycleSnapshot;
    } catch {
      lifecycleSnapshot = null;
      return null;
    }
  }

  function lifecycleEntryEqual(left, right) {
    return [
      "message_id",
      "floor",
      "swipe_id",
      "role",
      "content_hash",
      "message_version",
    ].every((field) => left?.[field] === right?.[field]);
  }

  function lifecycleMutationIndex(event, currentSnapshot) {
    const payload = event?.payload;
    const requestedIndex = Number(
      typeof payload === "object"
        ? (payload?.messageIndex ?? payload?.index)
        : NaN,
    );
    let index = Number.isInteger(requestedIndex) && requestedIndex >= 0
      ? requestedIndex
      : null;
    const requestedId =
      typeof payload === "object"
        ? (payload?.message_id ?? payload?.messageId)
        : payload;
    if (index === null && requestedId !== undefined && requestedId !== null) {
      index = currentSnapshot.entries.findIndex(
        (entry) => String(entry.message_id) === String(requestedId),
      );
      if (index < 0)
        index = lifecycleSnapshot?.entries.findIndex(
          (entry) => String(entry.message_id) === String(requestedId),
        );
      if (index < 0) index = null;
    }
    const previous = lifecycleSnapshot?.entries ?? [];
    const current = currentSnapshot?.entries ?? [];
    const changedIndex = Math.min(previous.length, current.length);
    const firstDifference = Array.from(
      { length: Math.max(previous.length, current.length) },
      (_, candidate) => candidate,
    ).find(
      (candidate) => !lifecycleEntryEqual(previous[candidate], current[candidate]),
    );
    if (firstDifference !== undefined)
      index = index === null ? firstDifference : Math.min(index, firstDifference);
    if (index === null && event?.type === "MESSAGE_DELETED") return changedIndex;
    return index;
  }

  function isFloorInvalidated(state) {
    return invalidatedFloors.has(floorExecutionKey(state.version));
  }

  function currentFloorDataIsReusable(index, swipeId, version) {
    const floorData = store.getFloor?.(index, swipeId);
    return Boolean(
      floorData?.analysis?.status === "success" &&
        sameFloorVersion(floorVersionFromData(floorData), version),
    );
  }

  async function invalidateMutation(
    event,
    targetIndex,
    { preserveTarget = false, clearRoots = true } = {},
  ) {
    if (typeof chat.invalidate === "function")
      chat.invalidate(`mutation:${event?.type ?? "unknown"}`, { checkCurrent: false });
    invalidateInFlightExecutions();
    lastTerminal.clear();
    invalidatedFloors.clear();
    clearWorldbookCache(sourceCache);
    const token = chat.token();
    if (!clearRoots) return chat.token();
    const all = messages();
    const start = Number.isInteger(targetIndex) && targetIndex >= 0 ? targetIndex : 0;
    for (let index = start; index < all.length; index += 1) {
      if (!isCharacterMessage(all[index])) continue;
      const swipeId = store.getActiveSwipeId?.(index);
      if (swipeId === null || swipeId === undefined) continue;
      let version;
      try {
        const target = await resolveFloorAtIndex({ __messageIndex: true, index });
        version = target.version;
      } catch {
        continue;
      }
      const key = floorExecutionKey(version);
      if (preserveTarget && index === targetIndex) {
        if (currentFloorDataIsReusable(index, swipeId, version))
          invalidatedFloors.delete(key);
        else invalidatedFloors.set(key, true);
        continue;
      }
      invalidatedFloors.set(key, true);
      if (floorRootExists(index, swipeId)) {
        await store.saveFloor(index, swipeId, emptyFloor());
        chat.assert(token);
      }
    }
    return token;
  }

  async function dependencyHashForTarget(target, token) {
    const states = await collectCurrentFloorStates(token);
    const dependencies = states
      .filter(
        (state) =>
          state.index < target.index &&
          state.version.floor < target.version.floor &&
          !isFloorInvalidated(state) &&
          state.floorData?.analysis?.status === "success" &&
          sameFloorVersion(floorVersionFromData(state.floorData), state.version),
      )
      .map((state) => state.version);
    return hashText(
      JSON.stringify(
        stableLifecycleValue({ target: target.version, dependencies }),
      ),
    );
  }
  async function collectExternalMemoryProviders(context) {
    if (typeof externalMemoryProviderLoader === "function") {
      return externalMemoryProviderLoader({ context });
    }
    try {
      return await probeExternalMemoryProviders({ context });
    } catch {
      return detectExternalMemoryProviders({ context });
    }
  }
  function messageCollection() {
    const context = st.getContext?.();
    const value = st.getChat?.() ?? context?.chat;
    return Array.isArray(value) ? value : null;
  }
  function messages() {
    return messageCollection() ?? [];
  }
  function recentStoryItemsThrough(targetIndex) {
    return messages()
      .slice(0, Math.max(0, targetIndex + 1))
      .map((message, index) => {
        const swipeId = store.getActiveSwipeId?.(index);
        if (swipeId === null || swipeId === undefined) return null;
        return {
          ...message,
          floor: messageFloor(message, index),
          message_id: messageId(message, index),
          swipe_id: swipeId,
          role: messageRole(message),
        };
      })
      .filter(Boolean);
  }
  function resolveMessage(selector = null) {
    const all = messages();
    if (!all.length) throw new Error("MESSAGE_NOT_FOUND");
    if (selector === null || selector === undefined) {
      const index = all.length - 1;
      return { index, message: all[index] };
    }
    if (
      typeof selector === "object" &&
      (selector.__messageIndex === true ||
        selector.messageIndex !== undefined ||
        selector.index !== undefined) &&
      selector.message_id === undefined &&
      selector.messageId === undefined
    ) {
      const index = Number(selector.messageIndex ?? selector.index);
      if (Number.isInteger(index) && index >= 0 && index < all.length)
        return { index, message: all[index] };
      throw new Error("MESSAGE_NOT_FOUND");
    }
    const requested =
      typeof selector === "object"
        ? (selector.message_id ?? selector.messageId)
        : selector;
    if (requested === null || requested === undefined || requested === "") {
      const index = all.length - 1;
      return { index, message: all[index] };
    }
    for (let index = 0; index < all.length; index += 1) {
      const stored = floorVersionFromData(store.getActiveFloor?.(index));
      if (String(messageId(all[index], index, stored)) === String(requested))
        return { index, message: all[index] };
    }
    const index = Number(requested);
    if (Number.isInteger(index) && index >= 0 && index < all.length)
      return { index, message: all[index] };
    throw new Error("MESSAGE_NOT_FOUND");
  }
  async function resolveFloorAtIndex(selector = null) {
    let resolved;
    try {
      resolved = resolveMessage(selector);
    } catch (error) {
      throw withAnalysisStage(error, "floor_resolution");
    }
    const { index, message } = resolved;
    if (!isCharacterMessage(message))
      throw withAnalysisStage(new Error("NO_CHARACTER_FLOOR"), "floor_resolution");
    let swipeId;
    let floorData;
    let storedVersion;
    let chatId;
    try {
      swipeId = store.getActiveSwipeId?.(index);
      if (swipeId === null || swipeId === undefined)
        throw new Error("SWIPE_NOT_FOUND");
      if (!hasSwipeSlot(message, swipeId)) throw new Error("SWIPE_NOT_FOUND");
      floorData = store.getFloor?.(index, swipeId) ?? {};
      storedVersion = floorVersionFromData(floorData);
      chatId = chat.current();
    } catch (error) {
      throw withAnalysisStage(error, "floor_resolution");
    }
    let version;
    try {
      version = await floorVersion({
        chatId,
        messageId: messageId(message, index, storedVersion),
        floor: messageFloor(message, index, storedVersion),
        swipeId,
        text: messageText(message, swipeId),
        messageVersion: messageVersion(message, storedVersion),
      });
    } catch (error) {
      throw withAnalysisStage(error, "floor_version");
    }
    return { index, message, swipeId, floorData, version, chatId };
  }
  async function resolveCurrentBioWeaveFloor(selector = null) {
    const resolved = resolveMessage(selector);
    for (let index = resolved.index; index >= 0; index -= 1) {
      const message = messages()[index];
      if (!isCharacterMessage(message)) continue;
      return resolveFloorAtIndex({ __messageIndex: true, index });
    }
    throw withAnalysisStage(new Error("NO_CHARACTER_FLOOR"), "floor_resolution");
  }
  async function resolveFloor(selector = null) {
    return resolveCurrentBioWeaveFloor(selector);
  }
  async function findPreviousSuccessfulBioWeave(target) {
    // Previous/API history comes only from an older current valid Floor; see .trellis/spec/domain/floor-state.md.
    for (let index = target.index - 1; index >= 0; index -= 1) {
      if (!isCharacterMessage(messages()[index])) continue;
      const swipeId = store.getActiveSwipeId?.(index);
      if (swipeId === null || swipeId === undefined) continue;
      const floorData = store.getFloor?.(index, swipeId);
      const analysis = floorData?.analysis;
      if (analysis?.status !== "success") continue;
      const candidate = await resolveFloorAtIndex({ __messageIndex: true, index });
      if (candidate.version.floor >= target.version.floor) continue;
      if (isFloorInvalidated(candidate)) continue;
      if (!sameFloorVersion(floorVersionFromData(floorData), candidate.version))
        continue;
      const characterRegistry = normalizedCharacterRegistrySnapshot(
        floorData.character_registry,
      );
      if (!characterRegistry) continue;
      return {
        analysis,
        events: store.getActiveFloorEvents?.(index, candidate.version) ?? [],
        character_registry: characterRegistry,
      };
    }
    return {
      analysis: null,
      events: [],
      character_registry: normalizeCharacterRegistry(null),
    };
  }
  function cloneWorldValue(value) {
    if (value === undefined || value === null) return value;
    if (typeof structuredClone === "function") return structuredClone(value);
    if (Array.isArray(value)) return value.map(cloneWorldValue);
    if (typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneWorldValue(item)]));
    return value;
  }
  async function resolveWorldModelAtOrBefore(selector = null, { strictBefore = false } = {}) {
    const target = await resolveFloor(selector);
    for (let index = target.index - (strictBefore ? 1 : 0); index >= 0; index -= 1) {
      if (!isCharacterMessage(messages()[index])) continue;
      const swipeId = store.getActiveSwipeId?.(index);
      if (swipeId === null || swipeId === undefined) continue;
      let candidate;
      try {
        candidate = await resolveFloorAtIndex({ __messageIndex: true, index });
      } catch {
        continue;
      }
      if (candidate.version.floor > target.version.floor) continue;
      if (!strictBefore && index === target.index && !sameFloorVersion(candidate.version, target.version)) continue;
      if (isFloorInvalidated(candidate)) continue;
      const floorData = store.getFloor?.(index, swipeId) ?? {};
      if (!sameFloorVersion(floorVersionFromData(floorData), candidate.version)) continue;
      if (floorData.world_model === null || floorData.world_model === undefined) continue;
      return {
        model: cloneWorldValue(floorData.world_model),
        meta: cloneWorldValue(floorData.world_model_meta),
        floor_version: cloneWorldValue(candidate.version),
      };
    }
    return null;
  }
  async function saveWorldModel({ model, meta = null, selector = null } = {}) {
    const token = chat.token();
    const target = await resolveFloor(selector);
    chat.assert(token);
    const current = store.getFloor?.(target.index, target.swipeId) ?? emptyFloor();
    const currentTarget = await resolveFloorAtIndex({ __messageIndex: true, index: target.index });
    if (!sameFloorVersion(currentTarget.version, target.version)) throw requestAbortedError();
    await store.saveFloor(target.index, target.swipeId, {
      ...current,
      floor_version: target.version,
      world_model: cloneWorldValue(model),
      world_model_meta: cloneWorldValue(meta),
    });
    chat.assert(token);
    return {
      model: cloneWorldValue(model),
      meta: cloneWorldValue(meta),
      floor_version: cloneWorldValue(target.version),
    };
  }
  async function collectCurrentFloorStates(token = chat.token()) {
    const states = [];
    const all = messages();
    for (let index = 0; index < all.length; index += 1) {
      if (!isCharacterMessage(all[index])) continue;
      const swipeId = store.getActiveSwipeId?.(index);
      if (swipeId === null || swipeId === undefined) continue;
      const floorData = store.getFloor?.(index, swipeId);
      if (!floorData) continue;
      const storedVersion = floorVersionFromData(floorData);
      let version;
      try {
        version = await floorVersion({
          chatId: token.chatId,
          messageId: messageId(all[index], index, storedVersion),
          floor: messageFloor(all[index], index, storedVersion),
          swipeId,
          text: messageText(all[index], swipeId),
          messageVersion: messageVersion(all[index], storedVersion),
        });
      } catch (error) {
        throw withAnalysisStage(error, "floor_version");
      }
      chat.assert(token);
      states.push({
        index,
        message: all[index],
        swipeId,
        floorData,
        version,
        events: store.getActiveFloorEvents?.(index, version) ?? [],
      });
    }
    return states;
  }
  async function collectActiveEvents(token = chat.token()) {
    const states = await collectCurrentFloorStates(token);
    return sortEvents(states.flatMap((state) => state.events));
  }
  function lastProcessedFloorFromStates(states) {
    let lastFloor = null;
    for (const state of states) {
      const analysis = state.floorData?.analysis;
      if (
        analysis?.status !== "success" ||
        !sameFloorVersion(floorVersionFromData(state.floorData), state.version)
      )
        continue;
      lastFloor =
        lastFloor === null
          ? state.version.floor
          : Math.max(lastFloor, state.version.floor);
    }
    return lastFloor;
  }
  async function recomputeLastProcessedFloor(token = chat.token()) {
    return lastProcessedFloorFromStates(await collectCurrentFloorStates(token));
  }
  function currentStoryTimeDifferences(activeEvents, currentStoryTime) {
    const differences = {};
    for (const event of Array.isArray(activeEvents) ? activeEvents : []) {
      const eventId = String(event?.event_id ?? '').trim();
      if (!eventId) continue;
      const normalizedEventStoryTime = storyTimeCoordinator?.normalizeStoryTimeForRead?.(event.story_time)
        ?? storyTime?.normalize?.(event.story_time)
        ?? event.story_time;
      const calculatedDifference = storyTime?.getDateDifference?.(
        currentStoryTime,
        normalizedEventStoryTime,
      );
      const difference = calculatedDifference === undefined || calculatedDifference === null
        ? differenceStoryTime(currentStoryTime, event.story_time)
        : typeof calculatedDifference === 'number'
          ? {value: calculatedDifference, unit: 'day'}
          : calculatedDifference;
      storyTimeCoordinator?.traceHistoricalDifference?.(
        eventId,
        normalizedEventStoryTime,
        currentStoryTime,
        difference,
      );
      if (difference && Number.isFinite(Number(difference.value))) differences[eventId] = difference;
    }
    return differences;
  }
  function stateErrorState(error) {
    const state = reduceState({});
    state.diagnostics = [{
      code: "STATE_REDUCE_ERROR",
      event_id: null,
      subject_id: null,
      pregnancy_id: null,
      detail: String(error?.code ?? error?.message ?? "STATE_REDUCE_FAILED"),
    }];
    return state;
  }
  async function collectCurrentDerivedState(token, chatData = null) {
    const states = await collectCurrentFloorStates(token);
    const currentChat = chatData ?? store.getChat(token.chatId);
    const validStates = states.filter(
      (state) => !isFloorInvalidated(state),
    );
    const activeEvents = sortEvents(
      validStates
        .flatMap((state) => state.events),
    );
    let world = null;
    try {
      world = await resolveWorldModelAtOrBefore();
    } catch {
      // An empty Chat has no target Floor and therefore no World Model.
    }
    const registry = rebuildTrackingRegistry(
      activeEvents,
      { world_model: world?.model ?? null },
    );
    const characterRegistry = currentCharacterRegistryFromStates(validStates);
    let currentFloor = null;
    try {
      currentFloor = await resolveCurrentBioWeaveFloor();
    } catch (error) {
      if (error?.message !== "NO_CHARACTER_FLOOR" && error?.message !== "MESSAGE_NOT_FOUND") throw error;
    }
    const storyTimeInfo = storyTimeCoordinator
      ? await storyTimeCoordinator.getCurrentStoryTimeInfo()
      : {story_time: normalizeStoryTime(null), status: "NO_CHARACTER_FLOOR"};
    const currentStoryTime = storyTimeInfo.story_time;
    const characterFacts = buildCharacterFacts(
      activeEvents,
      registry,
      characterRegistry,
    );
    let currentState;
    let currentStateStatus = currentFloor ? "ready" : "NO_CHARACTER_FLOOR";
    try {
      currentState = reduceState({
        events: activeEvents,
        currentStoryTime,
        characterFacts,
      });
    } catch (error) {
      currentState = stateErrorState(error);
      currentStateStatus = "STATE_ERROR";
    }
    chat.assert(token);
    return {
      states: validStates,
      activeEvents,
      registry,
      characterRegistry,
      characterFacts,
      currentFloor,
      currentStoryTime,
      currentStoryTimeStatus: storyTimeInfo.status,
      currentStoryTimeDifferences: currentStoryTimeDifferences(activeEvents, currentStoryTime),
      currentState,
      currentStateStatus,
      chatData: currentChat,
      lastProcessedFloor: lastProcessedFloorFromStates(validStates),
    };
  }
  function refreshTrackingRegistry(reason = "runtime") {
    const refresh = async () => {
      if (!messageCollection()) return null;
      const token = chat.token();
      const derived = await collectCurrentDerivedState(token);
      const { activeEvents, registry, characterRegistry } = derived;
      chat.assert(token);
      notify({
        type: "TRACKING_REGISTRY_REFRESHED",
        payload: { reason, event_count: activeEvents.length },
        chatId: token.chatId,
      });
      return {
        ...registry,
        character_registry: characterRegistry,
        active_events: activeEvents,
      };
    };
    const result = registryRefreshChain.then(refresh, refresh);
    registryRefreshChain = result.catch(() => null);
    return result;
  }
  async function statusForCurrentFloor() {
    let target;
    try {
      target = await resolveFloor();
    } catch (error) {
      if (
        error?.message !== "MESSAGE_NOT_FOUND" &&
        isFloorPreflightStage(error?.analysis_stage)
      ) {
        return safeFloorPreflightStatus(error, 0);
      }
      if (error?.message !== "MESSAGE_NOT_FOUND") throw error;
      return {
        state: "not_analyzed",
        busy: false,
        current_floor: null,
        floor_version: null,
        attempt: null,
        last_success: null,
        last_error: null,
        event_count: 0,
        tracking_subject_count: 0,
        current_floor_events: [],
      };
    }
    const analysis = target.floorData?.analysis ?? null;
    const matchesCurrent = sameFloorVersion(
      analysis?.floor_version,
      target.version,
    );
    const currentAnalysis = matchesCurrent ? analysis : null;
    const key = floorExecutionKey(target.version);
    const activeAttempt = inFlight.get(key);
    const terminal = lastTerminal.get(key);
    const persistedState =
      matchesCurrent &&
      ["success", "failed", "cancelled"].includes(currentAnalysis?.status)
        ? currentAnalysis.status
        : "not_analyzed";
    const state =
      activeAttempt && !activeAttempt.cancelRequested
        ? "running"
        : (terminal?.state ?? persistedState);
    const busy = Boolean(activeAttempt && !activeAttempt.cancelRequested);
    const currentFloorEvents =
      store.getActiveFloorEvents?.(target.index, target.version) ?? [];
    const diagnostic =
      terminal?.diagnostic ??
      (currentAnalysis?.last_attempt &&
      currentAnalysis.last_attempt.status !== "success"
        ? {
            stage:
              currentAnalysis.error_stage ??
              currentAnalysis.last_attempt.stage ??
              null,
            error_code:
              currentAnalysis.error_code ??
              currentAnalysis.last_attempt.error_code ??
              currentAnalysis.last_error ??
              null,
            diagnostic_code:
              currentAnalysis.diagnostic_code ??
              currentAnalysis.last_attempt.diagnostic_code ??
              null,
            error_path:
              currentAnalysis.error_path ??
              currentAnalysis.last_attempt.error_path ??
              null,
            diagnostic_path:
              currentAnalysis.diagnostic_path ??
              currentAnalysis.last_attempt.diagnostic_path ??
              currentAnalysis.last_attempt.error_path ??
              null,
            safe_error_summary:
              currentAnalysis.safe_error_summary ??
              currentAnalysis.last_attempt.safe_error_summary ??
              null,
            http_status:
              currentAnalysis.http_status ??
              currentAnalysis.last_attempt.http_status ??
              null,
            phase:
              currentAnalysis.phase ??
              currentAnalysis.last_attempt.phase ??
              null,
            timeoutSec:
              currentAnalysis.timeoutSec ??
              currentAnalysis.last_attempt.timeoutSec ??
              null,
            timeout_ms:
              currentAnalysis.timeout_ms ??
              currentAnalysis.last_attempt.timeout_ms ??
              null,
          }
        : null);
    return {
      state,
      busy,
      current_floor: {
        floor: target.version.floor,
        message_id: target.version.message_id,
        swipe_id: target.swipeId,
        version: target.version,
      },
      floor_version: target.version,
      attempt:
        activeAttempt?.attempt ??
        terminal?.attempt ??
        currentAnalysis?.last_attempt ??
        (currentAnalysis
          ? {
              status: currentAnalysis.status,
              analyzed_at:
                currentAnalysis.analyzed_at ??
                currentAnalysis.attempted_at ??
                null,
            }
          : null),
      last_success: analysisTimestamp(currentAnalysis),
      last_error:
        diagnostic?.error_code ??
        currentAnalysis?.last_error ??
        currentAnalysis?.last_attempt?.error ??
        null,
      error_stage: diagnostic?.stage ?? currentAnalysis?.error_stage ?? null,
      error_code: diagnostic?.error_code ?? currentAnalysis?.error_code ?? null,
      diagnostic_code:
        diagnostic?.diagnostic_code ??
        currentAnalysis?.diagnostic_code ??
        currentAnalysis?.last_attempt?.diagnostic_code ??
        null,
      http_status:
        diagnostic?.http_status ??
        currentAnalysis?.http_status ??
        currentAnalysis?.last_attempt?.http_status ??
        null,
      phase:
        diagnostic?.phase ??
        currentAnalysis?.phase ??
        currentAnalysis?.last_attempt?.phase ??
        null,
      timeoutSec:
        diagnostic?.timeoutSec ??
        currentAnalysis?.timeoutSec ??
        currentAnalysis?.last_attempt?.timeoutSec ??
        null,
      timeout_ms:
        diagnostic?.timeout_ms ??
        currentAnalysis?.timeout_ms ??
        currentAnalysis?.last_attempt?.timeout_ms ??
        null,
      error_path:
        diagnostic?.error_path ??
        currentAnalysis?.error_path ??
        currentAnalysis?.last_attempt?.error_path ??
        null,
      diagnostic_path:
        diagnostic?.diagnostic_path ??
        currentAnalysis?.diagnostic_path ??
        currentAnalysis?.last_attempt?.diagnostic_path ??
        currentAnalysis?.last_attempt?.error_path ??
        null,
      safe_error_summary:
        diagnostic?.safe_error_summary ??
        currentAnalysis?.safe_error_summary ??
        null,
      started_at:
        activeAttempt?.started_at ??
        terminal?.started_at ??
        currentAnalysis?.last_attempt?.started_at ??
        null,
      finished_at:
        activeAttempt?.finished_at ??
        terminal?.finished_at ??
        currentAnalysis?.last_attempt?.finished_at ??
        null,
      event_count: currentFloorEvents.length,
      current_floor_events: currentFloorEvents,
    };
  }
  async function collectActiveBusinessData() {
    const token = chat.token();
    const status = await statusForCurrentFloor();
    chat.assert(token);
    const chatData = store.getChat(token.chatId);
    if (isFloorPreflightStage(status.error_stage)) {
      return buildBusinessData(status, [], chatData, null, {
        current_state: reduceState({}),
        current_state_status: status.current_floor === null ? "NO_CHARACTER_FLOOR" : "STATE_ERROR",
        current_story_time: null,
        current_story_time_status: "NO_CHARACTER_FLOOR",
        current_story_time_differences: {},
      });
    }
    let derived;
    try {
      derived = await collectCurrentDerivedState(token, chatData);
    } catch (error) {
      if (!isFloorPreflightStage(error?.analysis_stage)) throw error;
      return buildBusinessData(
        safeFloorPreflightStatus(error, 0),
        [],
        chatData,
        null,
        {
          current_state: reduceState({}),
          current_state_status: "STATE_ERROR",
          current_story_time: null,
          current_story_time_status: "STATE_ERROR",
          current_story_time_differences: {},
        },
      );
    }
    chat.assert(token);
    return buildBusinessData(
      status,
      derived.activeEvents,
      derived.chatData,
      derived.registry,
      {
        current_state: derived.currentState,
        current_state_status: derived.currentStateStatus,
        current_story_time: derived.currentStoryTime,
        current_story_time_status: derived.currentStoryTimeStatus,
        current_story_time_differences: derived.currentStoryTimeDifferences,
      },
    );
  }
  async function getCurrentBiologicalState() {
    const token = chat.token();
    try {
      const derived = await collectCurrentDerivedState(token);
      chat.assert(token);
      return {
        current_state: derived.currentState,
        current_story_time: derived.currentStoryTime,
        current_story_time_status: derived.currentStoryTimeStatus,
        current_story_time_differences: derived.currentStoryTimeDifferences,
        status: derived.currentStateStatus,
      };
    } catch (error) {
      if (!isFloorPreflightStage(error?.analysis_stage) && error?.message !== "NO_CHARACTER_FLOOR" && error?.message !== "MESSAGE_NOT_FOUND") {
        throw error;
      }
      return {
        current_state: reduceState({}),
        current_story_time: null,
        current_story_time_status: "NO_CHARACTER_FLOOR",
        current_story_time_differences: {},
        status: "NO_CHARACTER_FLOOR",
      };
    }
  }
  function buildBusinessData(
    status,
    activeEvents,
    chatData,
    registry = null,
    stateInfo = null,
  ) {
    const trackingSubjects = registry?.tracking_subjects ?? {};
    const trackingCandidates = registry?.tracking_candidates ?? {};
    const characterProfiles = registry?.character_profiles ?? {};
    const trackingDecisions = activeEvents.flatMap((event) =>
      explainTrackingDecision(event, { ...chatData, ...registry }).map(
        (decision) => ({
          event_id: event.event_id,
          ...decision,
        }),
      ),
    );
    const sexualActivityCount = activeEvents.filter(
      (event) => event.type === "sexual_activity",
    ).length;
    const pregnancyRelevantExposureCount = activeEvents.filter((event) =>
      isPregnancyRelevantExposure(event),
    ).length;
    const exposureEventCount = Object.values(trackingSubjects).reduce(
      (total, subject) =>
        total +
        (Array.isArray(subject?.exposure_event_ids)
          ? subject.exposure_event_ids.length
          : 0),
      0,
    );
    const pendingExposureEventCount = Object.values(trackingCandidates).reduce(
      (total, candidate) =>
        total +
        (Array.isArray(candidate?.exposure_event_ids)
          ? candidate.exposure_event_ids.length
          : 0),
      0,
    );
    const analysisStatus = {
      ...status,
      active_event_count: activeEvents.length,
      sexual_activity_count: sexualActivityCount,
      pregnancy_relevant_exposure_count: pregnancyRelevantExposureCount,
      tracking_subject_count: Object.keys(trackingSubjects).length,
      tracking_candidate_count: Object.keys(trackingCandidates).length,
      pending_tracking_candidate_count: Object.keys(trackingCandidates).length,
      active_events: activeEvents,
      tracking_decisions: trackingDecisions,
      registry_summary: {
        tracking_subject_count: Object.keys(trackingSubjects).length,
        tracking_candidate_count: Object.keys(trackingCandidates).length,
        character_ids: Object.keys(trackingSubjects),
        exposure_event_count: exposureEventCount,
        pending_exposure_event_count: pendingExposureEventCount,
      },
    };
    return {
      tracking_subjects: trackingSubjects,
      tracking_candidates: trackingCandidates,
      character_profiles: characterProfiles,
      active_events: activeEvents,
      current_state: stateInfo?.current_state ?? reduceState({}),
      current_state_status: stateInfo?.current_state_status ?? "NO_CHARACTER_FLOOR",
      current_story_time: stateInfo?.current_story_time ?? null,
      current_story_time_status: stateInfo?.current_story_time_status ?? "NO_CHARACTER_FLOOR",
      current_story_time_differences: stateInfo?.current_story_time_differences ?? {},
      current_floor: status.current_floor,
      last_success: status.last_success,
      analysis_status: analysisStatus,
      ...analysisStatus,
    };
  }
  function executionIsCurrent(execution) {
    return (
      !destroyed &&
      !execution.cancelRequested &&
      !execution.released &&
      inFlight.get(execution.key) === execution &&
      !execution.controller?.signal.aborted
    );
  }
  function assertExecutionCurrent(execution, token) {
    if (!executionIsCurrent(execution)) throw requestAbortedError();
    chat.assert(token);
  }
  function finalizeExecution(execution, state, error = null) {
    if (execution.released) return execution.terminal;
    if (inFlight.get(execution.key) === execution)
      inFlight.delete(execution.key);
    execution.released = true;
    execution.finished_at = new Date().toISOString();
    const diagnostic = error
      ? executionError(error, execution.stage)
      : (execution.diagnostic ?? null);
    const terminal = {
      state,
      attempt: execution.attempt,
      started_at: execution.started_at,
      finished_at: execution.finished_at,
      floor_version: execution.version,
      diagnostic,
    };
    execution.terminal = terminal;
    lastTerminal.set(execution.key, terminal);
    execution.controller = null;
    notify({
      type: "EVENT_ANALYSIS_STATUS_CHANGED",
      payload: {
        state,
        attempt: execution.attempt,
        started_at: execution.started_at,
        finished_at: execution.finished_at,
        floor_version: execution.version,
        ...(diagnostic ?? {}),
      },
      chatId: execution.version.chat_id,
    });
    if (state === "success") {
      notify({
        type: "EVENT_ANALYSIS_COMMITTED",
        payload: {
          state,
          attempt: execution.attempt,
          event_count: execution.event_count ?? 0,
          floor_version: execution.version,
        },
        chatId: execution.version.chat_id,
      });
    }
    return terminal;
  }
  function invalidateExecution(execution) {
    if (execution.released) return;
    execution.cancelRequested = true;
    execution.invalidated = true;
    execution.controller?.abort?.();
    const error = requestAbortedError();
    execution.diagnostic = executionError(error, "cancelled");
    finalizeExecution(execution, "cancelled", error);
  }
  function invalidateInFlightExecutions() {
    for (const execution of [...inFlight.values()])
      invalidateExecution(execution);
  }
  async function persistTerminalAttempt(
    execution,
    target,
    savedAnalysis,
    status,
    diagnostic = null,
  ) {
    if (!(await targetVersionIsCurrent(target))) return null;
    const currentFloorData =
      store.getFloor?.(target.index, target.swipeId) ?? target.floorData ?? {};
    const previousAnalysis = currentFloorData.analysis ?? savedAnalysis;
    const events = Array.isArray(currentFloorData.events)
      ? currentFloorData.events
      : Array.isArray(target.floorData?.events)
        ? target.floorData.events
        : [];
    const finishedAt = new Date().toISOString();
    const attemptRecord = {
      status,
      attempted_at: finishedAt,
      started_at: execution.started_at,
      finished_at: finishedAt,
      reason: execution.reason,
      attempt: execution.attempt,
      ...(execution.dependency_hash
        ? { dependency_hash: execution.dependency_hash }
        : {}),
      ...(diagnostic ?? {}),
    };
    const analysis = commitAnalysis(
      previousAnalysis,
      attemptRecord,
      target.version,
    );
    await store.saveFloor(target.index, target.swipeId, {
      ...currentFloorData,
      analysis,
      events,
    });
    return analysis;
  }
  async function targetVersionIsCurrent(target) {
    try {
      const current = await resolveFloorAtIndex({
        __messageIndex: true,
        index: target.index,
      });
      return sameFloorVersion(current.version, target.version);
    } catch {
      return false;
    }
  }
  async function rollbackLateFloorCommit(execution, target) {
    if (!execution.floorSaveStarted || !store.getFloor) return;
    if (!(await targetVersionIsCurrent(target))) return;
    const current = store.getFloor(target.index, target.swipeId);
    if (
      current?.analysis?.attempt !== execution.attempt ||
      current?.analysis?.status !== "success"
    )
      return;
    try {
      await store.saveFloor(target.index, target.swipeId, target.floorData);
    } catch {
      // The terminal cancellation state is still authoritative in memory; a
      // newer execution is protected by the attempt guard above.
    }
  }
  async function assertExecutionTargetCurrent(execution, target, token) {
    assertExecutionCurrent(execution, token);
    let current;
    try {
      current = await resolveFloorAtIndex({
        __messageIndex: true,
        index: target.index,
      });
    } catch (error) {
      if (
        error?.message === "MESSAGE_NOT_FOUND" ||
        error?.message === "SWIPE_NOT_FOUND" ||
        error?.analysis_stage === "floor_resolution"
      ) {
        invalidateExecution(execution);
        throw requestAbortedError();
      }
      throw error;
    }
    if (!sameFloorVersion(current.version, target.version)) {
      invalidateExecution(execution);
      throw requestAbortedError();
    }
    if (
      execution.source_provenance &&
      !sameFloorVersion(execution.source_provenance, current.version)
    ) {
      invalidateExecution(execution);
      throw requestAbortedError();
    }
    return current;
  }
  async function buildFloorAnalysisInput(target, token) {
    const chatData = store.getChat(token.chatId);
    const derived = await collectCurrentDerivedState(token, chatData);
    const previous = await findPreviousSuccessfulBioWeave(target);
    const existingBioWeave = {
      analysis: previous.analysis,
      events: previous.events,
    };
    const characterRegistry = normalizeCharacterRegistry(
      previous.character_registry,
    );
    const causalEvents = sortEvents(
      derived.states
        .filter(
          (state) =>
            state.index < target.index &&
            state.version.floor < target.version.floor &&
            state.floorData?.analysis?.status === "success" &&
            sameFloorVersion(
              floorVersionFromData(state.floorData),
              state.version,
            ),
        )
        .flatMap((state) => state.events),
    );
    const causalWorld = await resolveWorldModelAtOrBefore(target, { strictBefore: true });
    const causalRegistry = rebuildTrackingRegistry(
      causalEvents,
      { world_model: causalWorld?.model ?? null },
    );
    const derivedState = {
      ...causalRegistry,
      character_registry: characterRegistry,
    };
    const context = st.getContext?.() ?? {};
    const globalRecentStory = globalRecentStoryResolver?.() ?? {};
    const recentStorySettings = mergeRecentStorySettings(
      globalRecentStory,
      chatData.settings?.recent_story ?? {},
    );
    const storyTimeValue = storyTimeCoordinator
      ? await storyTimeCoordinator.resolveFloorStoryTime(target)
      : normalizeStoryTime(null);
    const commonInput = await analysisContextCollector({
      context,
      chatId: token.chatId,
      chatSettings: chatData.settings ?? {},
      globalRecentStory,
      // The shared collector owns floor_count and regex processing. Runtime
      // only supplies the causal prefix of the Chat so a specified target
      // Floor can never pull future narrative into its context.
      recentStoryItems: recentStoryItemsThrough(target.index),
      sourceLoader: analysisSourceLoader,
      sourceLoaderOptions: {
        ...analysisSourceLoaderOptions,
        context,
        fetchRef: analysisSourceLoaderOptions.fetchRef ?? st.fetch,
        getRequestHeaders:
          analysisSourceLoaderOptions.getRequestHeaders ?? st.getRequestHeaders,
        cache: analysisSourceLoaderOptions.cache ?? sourceCache,
      },
      externalMemoryProviderLoader: collectExternalMemoryProviders,
      includePersonaInTokenEstimate: true,
    });
    const characterContext = characterContextResolver(
      context,
      derivedState,
      commonInput,
    );
    const targetMessage =
      target.message &&
      typeof target.message === "object" &&
      !Array.isArray(target.message)
        ? {
            ...target.message,
            floor: target.version.floor,
            message_id: target.version.message_id,
            swipe_id: target.swipeId,
            role: messageRole(target.message),
          }
        : {
            content: messageText(target.message, target.swipeId),
            floor: target.version.floor,
            message_id: target.version.message_id,
            swipe_id: target.swipeId,
            role: messageRole(target.message),
          };
    const processedTarget = processNarrativeFloor({
      message: targetMessage,
      floor: target.version.floor,
      messageId: target.version.message_id,
      swipeId: target.swipeId,
      role: messageRole(target.message),
      settings: recentStorySettings,
    });
    // Input history is provenance-checked before the API boundary; see .trellis/spec/domain/floor-state.md.
    chat.assert(token);
    return buildEventAnalysisInput({
      ...commonInput,
      chatId: token.chatId,
      floorVersion: target.version,
      currentFloor: {
        floor: target.version.floor,
        message_id: target.version.message_id,
        swipe_id: target.swipeId,
        narrative: processedTarget?.content ?? "",
        role: messageRole(target.message),
      },
      worldModel: (await resolveWorldModelAtOrBefore(target, { strictBefore: true }))?.model ?? null,
      storyTime: storyTimeValue,
      characterContext,
      characterRegistry,
      existingBioWeave,
    });
  }
  async function runAnalysis(execution, target, savedAnalysis) {
    let token = null;
    let terminalState = "failed";
    let terminalError = null;
    try {
      token = chat.token();
      execution.stage = "request_build";
      const analysisInput = await buildFloorAnalysisInput(target, token);
      execution.source_provenance = { ...target.version };
      execution.dependency_hash = await dependencyHashForTarget(target, token);
      await assertExecutionTargetCurrent(execution, target, token);
      if (typeof analyzer?.analyzeFloor !== "function")
        throw new Error("EVENT_ANALYZER_UNAVAILABLE");
      execution.stage = "api_request";
      const result = await analyzer.analyzeFloor({
        analysisInput,
        floor_version: target.version,
        authoritative_floor_version: target.version,
        signal: execution.controller.signal,
      });
      assertExecutionCurrent(execution, token);
      execution.stage = "identity_resolution";
      const identityResult = resolveEventAnalysisIdentities(result, {
        registry: normalizeCharacterRegistry(analysisInput.character_registry),
        persistAliases: true,
        narrative: analysisNarrative(analysisInput),
      });
      if (!identityResult.ok) throw identityResolutionError(identityResult);
      execution.stage = "normalization";
      const enrichedEvents = await Promise.all(
        (Array.isArray(identityResult.events) ? identityResult.events : []).map(
          async (event, ordinal) => {
            const facts =
              event && typeof event === "object" && !Array.isArray(event)
                ? Object.fromEntries(
                    Object.entries(event).filter(
                      ([key]) => key !== "event_id" && key !== "source",
                    ),
                  )
                : event;
            if (!facts || typeof facts !== "object" || Array.isArray(facts))
              return facts;
            const enriched = {
              ...facts,
              event_id: await deterministicEventId(target.version, ordinal),
              source: target.version,
            };
            return materializeStateFact(enriched, target.version, ordinal);
          },
        ),
      );
      execution.stage = "schema_validation";
      const collectionValidation = validateEventCollection(enrichedEvents, {
        strictCanonicalParticipants: true,
      });
      if (!collectionValidation.ok) {
        throw domainValidationError(
          collectionValidation,
          "EVENT_DOMAIN_VALIDATION_FAILED",
          enrichedEvents,
        );
      }
      const events = dedupeEvents(enrichedEvents).map((event) => normalizeEvent(event));
      const analyzedAt = new Date().toISOString();
      const analysis = commitAnalysis(
        savedAnalysis,
        {
          status: "success",
          analyzed_at: analyzedAt,
          last_analyzed_at: analyzedAt,
          started_at: execution.started_at,
          finished_at: analyzedAt,
          event_count: events.length,
          reason: execution.reason,
          attempt: execution.attempt,
        },
        target.version,
      );
      analysis.dependency_hash = execution.dependency_hash;
      analysis.source_provenance = { ...target.version };
      await assertExecutionTargetCurrent(execution, target, token);
      const currentDependencyHash = await dependencyHashForTarget(target, token);
      if (currentDependencyHash !== execution.dependency_hash) {
        invalidateExecution(execution);
        throw requestAbortedError();
      }
      execution.stage = "floor_save";
      await assertExecutionTargetCurrent(execution, target, token);
      execution.floorSaveStarted = true;
      await store.saveFloor(target.index, target.swipeId, {
        ...target.floorData,
        analysis,
        events,
        character_registry: identityResult.character_registry,
      });
      execution.floorSaved = true;
      await assertExecutionTargetCurrent(execution, target, token);
      invalidatedFloors.delete(floorExecutionKey(target.version));
      execution.stage = "registry_rebuild";
      assertExecutionCurrent(execution, token);
      await refreshTrackingRegistry(execution.reason);
      assertExecutionCurrent(execution, token);
      execution.event_count = events.length;
      traceApi("runtime-success", {
        state: "success",
        phase: execution.stage,
        attempt: execution.attempt,
        eventCount: events.length,
        floorSaved: execution.floorSaved === true,
        persistenceComplete: true,
        registryComplete: true,
      });
      terminalState = "success";
      return {
        events,
        version: target.version,
        status: "success",
        attempt: execution.attempt,
      };
    } catch (error) {
      const cancelled =
        execution.cancelRequested ||
        isRequestAborted(error) ||
        error?.code === "REQUEST_ABORTED";
      traceApi("runtime-error", {
        error,
        phase: execution.stage,
        attempt: execution.attempt,
        cancelled,
        staleChat: isStaleChat(error),
      });
      if (cancelled) {
        terminalState = "cancelled";
        terminalError = requestAbortedError();
        execution.diagnostic = executionError(terminalError, "cancelled");
        await rollbackLateFloorCommit(execution, target);
        if (!execution.released) {
          try {
            await persistTerminalAttempt(
              execution,
              target,
              savedAnalysis,
              "cancelled",
              execution.diagnostic,
            );
          } catch {
            // Cancellation must remain an informational terminal state even if
            // the host cannot persist the diagnostic metadata.
          }
        }
        throw terminalError;
      }
      terminalState = "failed";
      terminalError = error;
      execution.diagnostic = executionError(error, execution.stage);
      error.analysis_stage ??= execution.diagnostic.stage;
      error.error_code ??= execution.diagnostic.error_code;
      error.safe_error_summary ??= execution.diagnostic.safe_error_summary;
      // Chat epoch 变化后的结果不属于当前作用域；释放执行即可，不能把旧
      // Floor 的失败元数据写回当前 Chat/Swipe。
      if (!execution.released && !isStaleChat(error) && !execution.floorSaved) {
        try {
          await persistTerminalAttempt(
            execution,
            target,
            savedAnalysis,
            "failed",
            execution.diagnostic,
          );
          try {
            await refreshTrackingRegistry("analysis-failed");
          } catch (registryError) {
            if (registryError?.message === "STALE_CHAT") throw registryError;
          }
        } catch (saveError) {
          if (saveError?.message === "STALE_CHAT") throw saveError;
        }
      }
      throw error;
    } finally {
      if (!execution.released)
        finalizeExecution(execution, terminalState, terminalError);
    }
  }
  async function analyzeFloor(
    selector = null,
    { force = false, reason = "automatic" } = {},
  ) {
    const target = await resolveFloor(selector);
    const requestKey = floorExecutionKey(target.version);
    if (inFlight.has(requestKey)) return inFlight.get(requestKey).promise;
    const savedAnalysis = target.floorData?.analysis ?? null;
    const dependencyInvalidated = invalidatedFloors.has(requestKey);
    if (
      !dependencyInvalidated &&
      !shouldAnalyze(savedAnalysis, { version: target.version, manual: force })
    ) {
      return { skipped: true, version: target.version, status: "success" };
    }
    const attempt = ++attemptSequence;
    const controller = new AbortController();
    const execution = {
      key: requestKey,
      version: target.version,
      attempt,
      reason,
      controller,
      started_at: new Date().toISOString(),
      stage: "request_build",
      cancelRequested: false,
      released: false,
      floorSaved: false,
      floorSaveStarted: false,
      source_provenance: null,
      dependency_hash: null,
      promise: null,
    };
    inFlight.set(requestKey, execution);
    execution.promise = runAnalysis(execution, target, savedAnalysis);
    notify({
      type: "EVENT_ANALYSIS_STATUS_CHANGED",
      payload: {
        state: "running",
        attempt,
        started_at: execution.started_at,
        floor_version: target.version,
      },
      chatId: target.chatId,
    });
    return execution.promise;
  }
  function analyzeCurrentFloor(options = {}) {
    return analyzeFloor(null, options);
  }
  function refreshCurrentFloorAnalysis() {
    return analyzeCurrentFloor({ force: true, reason: "manual-refresh" });
  }
  async function getCurrentFloorAnalysisInput() {
    const target = await resolveFloor();
    const token = chat.token();
    chat.assert(token);
    return buildFloorAnalysisInput(target, token);
  }
  async function requestAbortCurrentFloorAnalysis() {
    let target;
    try {
      target = await resolveFloor();
    } catch (error) {
      if (error?.message === "MESSAGE_NOT_FOUND") return false;
      throw error;
    }
    const execution = inFlight.get(floorExecutionKey(target.version));
    if (!execution || execution.cancelRequested || execution.released)
      return false;
    execution.cancelRequested = true;
    const controller = execution.controller;
    controller?.abort?.();
    const terminalError = requestAbortedError();
    execution.diagnostic = executionError(terminalError, "cancelled");
    finalizeExecution(execution, "cancelled", terminalError);
    try {
      await persistTerminalAttempt(
        execution,
        target,
        target.floorData?.analysis ?? null,
        "cancelled",
        execution.diagnostic,
      );
    } catch {
      // The in-memory terminal state remains visible; persistence failure must
      // not turn an intentional cancellation into an error notification.
    }
    return true;
  }
  async function handleLifecycleEvent(event) {
    const work = async () => {
      const type = event?.type;
      if (type === "CHAT_CHANGED") {
        await primeLifecycleSnapshot();
        await refreshTrackingRegistry(type);
        return { skipped: true, reason: type };
      }
      if (type === "CHAT_CREATED")
        return { skipped: true, reason: "unsupported-event" };
      if (
        !AUTO_ANALYSIS_EVENTS.has(type) &&
        !LIFECYCLE_ONLY_EVENTS.has(type)
      )
        return { skipped: true, reason: "unsupported-event" };

      let currentSnapshot;
      try {
        currentSnapshot = await captureLifecycleSnapshot();
      } catch {
        currentSnapshot = { entries: [] };
      }
      const targetIndex = lifecycleMutationIndex(event, currentSnapshot);
      const prefersPreviousMutationEntry =
        type === "MESSAGE_DELETED" || type === "MESSAGE_SWIPE_DELETED";
      const mutationEntry =
        (targetIndex !== null && targetIndex !== undefined
          ? prefersPreviousMutationEntry
            ? lifecycleSnapshot?.entries?.[targetIndex] ??
              currentSnapshot.entries[targetIndex]
            : currentSnapshot.entries[targetIndex] ??
              lifecycleSnapshot?.entries?.[targetIndex]
          : null) ?? null;
      const latestMessage = messages().at(-1) ?? null;
      const mutationIsUserOnly =
        (mutationEntry && mutationEntry.role === "user") ||
        (!mutationEntry && latestMessage && !isCharacterMessage(latestMessage));
      if (mutationIsUserOnly) {
        return { skipped: true, reason: "user-message-not-a-bioweave-floor" };
      }
      const isSwipeBoundaryEvent =
        type === "MESSAGE_SWIPED" || type === "MESSAGE_SWIPE_DELETED";
      const isSourceMutation = [
        "MESSAGE_UPDATED",
        "MESSAGE_EDITED",
        "MESSAGE_DELETED",
        "MESSAGE_SWIPED",
        "MESSAGE_SWIPE_DELETED",
      ].includes(type);
      await invalidateMutation(event, targetIndex, {
        preserveTarget: isSwipeBoundaryEvent,
        clearRoots: isSourceMutation,
      });
      lifecycleSnapshot = await primeLifecycleSnapshot();
      if (isSwipeBoundaryEvent) await refreshTrackingRegistry(type);
      if (LIFECYCLE_ONLY_EVENTS.has(type)) {
        await refreshTrackingRegistry(type);
        return { skipped: true, reason: type };
      }
      let target;
      try {
        target = resolveMessage(event?.payload ?? null);
      } catch (error) {
        if (isSwipeBoundaryEvent && error?.message === "MESSAGE_NOT_FOUND")
          return { skipped: true, reason: "swipe-not-found" };
        throw error;
      }
      const floor = messageFloor(target.message, target.index);
      const chatData = store.getChat(chat.current());
      const interval = Number(chatData.settings?.analysis_interval ?? 3);
      const lastProcessedFloor = FORCED_LIFECYCLE_EVENTS.has(type)
        ? null
        : await recomputeLastProcessedFloor(chat.token());
      if (
        !FORCED_LIFECYCLE_EVENTS.has(type) &&
        !isIntervalTarget(floor, lastProcessedFloor, interval)
      ) {
        return { skipped: true, reason: "interval" };
      }
      try {
        return await analyzeFloor(
          { __messageIndex: true, index: target.index },
          { force: false, reason: type },
        );
      } catch (error) {
        if (isSwipeBoundaryEvent && error?.message === "SWIPE_NOT_FOUND")
          return { skipped: true, reason: "swipe-not-found" };
        throw error;
      }
    };
    const result = lifecycleMutationChain.then(work, work);
    lifecycleMutationChain = result.catch(() => null);
    return result;
  }
  async function findActiveEvent(eventId) {
    const targetId = String(eventId ?? "").trim();
    if (!targetId) throw new Error("EVENT_NOT_FOUND");
    const all = messages();
    for (let index = 0; index < all.length; index += 1) {
      if (!isCharacterMessage(all[index])) continue;
      const target = await resolveFloorAtIndex({ __messageIndex: true, index });
      const events = store.getActiveFloorEvents?.(index, target.version) ?? [];
      const eventIndex = events.findIndex(
        (event) => String(event?.event_id) === targetId,
      );
      if (eventIndex >= 0) return { ...target, event: events[eventIndex] };
    }
    throw new Error("EVENT_NOT_FOUND");
  }
  async function updateEvent(eventId, patch = {}) {
    const target = await findActiveEvent(eventId);
    const nextEvent = normalizeEvent({
      ...target.event,
      ...patch,
      event_id: target.event.event_id,
      source: target.event.source,
    });
    const characterRegistry = normalizeCharacterRegistry(
      target.floorData.character_registry,
    );
    for (const [
      participantIndex,
      participant,
    ] of nextEvent.participants.entries()) {
      if (hasCharacterId(characterRegistry, participant.character_id)) continue;
      const error = new Error("EVENT_IDENTITY_RESOLUTION_FAILED");
      error.code = "EVENT_IDENTITY_RESOLUTION_FAILED";
      error.analysis_stage = "identity_resolution";
      error.diagnostic_code = "unknown_character_id";
      error.error_code = "unknown_character_id";
      error.diagnostic_path = `participants[${participantIndex}].character_id`;
      error.error_path = error.diagnostic_path;
      throw error;
    }
    const events = [
      ...(Array.isArray(target.floorData.events)
        ? target.floorData.events
        : []),
    ];
    const index = events.findIndex(
      (event) => String(event?.event_id) === String(eventId),
    );
    if (index < 0) throw new Error("EVENT_NOT_FOUND");
    events[index] = nextEvent;
    const collectionValidation = validateEventCollection(events);
    if (!collectionValidation.ok) {
      throw domainValidationError(
        collectionValidation,
        "EVENT_ANALYSIS_INVALID",
        events,
      );
    }
    const mutationToken = await invalidateMutation(
      { type: "MESSAGE_EDITED", payload: { message_id: target.version.message_id } },
      target.index,
      { preserveTarget: true },
    );
    await store.saveFloor(target.index, target.swipeId, {
      ...target.floorData,
      events,
    });
    chat.assert(mutationToken);
    invalidatedFloors.delete(floorExecutionKey(target.version));
    await refreshTrackingRegistry("event-edit");
    return nextEvent;
  }
  async function deleteEvent(eventId) {
    const target = await findActiveEvent(eventId);
    const events = (
      Array.isArray(target.floorData.events) ? target.floorData.events : []
    ).filter((event) => String(event?.event_id) !== String(eventId));
    const mutationToken = await invalidateMutation(
      { type: "MESSAGE_DELETED", payload: { message_id: target.version.message_id } },
      target.index,
      { preserveTarget: true },
    );
    await store.saveFloor(target.index, target.swipeId, {
      ...target.floorData,
      events,
    });
    chat.assert(mutationToken);
    invalidatedFloors.delete(floorExecutionKey(target.version));
    await refreshTrackingRegistry("event-delete");
    return true;
  }
  async function invalidateForClear(payload = {}) {
    if (typeof chat.invalidate === "function")
      chat.invalidate(`clear:${payload.reason ?? payload.domain ?? "unknown"}`, {
        checkCurrent: false,
      });
    invalidateInFlightExecutions();
    lastTerminal.clear();
    invalidatedFloors.clear();
    clearWorldbookCache(sourceCache);
    // A registry rebuild may already be between its derived read and Chat
    // save. Invalidate first, then wait for that old writer to settle before
    // the Clear Service applies its plan; otherwise its late Chat save could
    // repopulate a projection immediately after a successful clear.
    const barriers = [lifecycleMutationChain, registryRefreshChain];
    await Promise.all(
      barriers.map((barrier) => Promise.resolve(barrier).catch(() => null)),
    );
    return {
      invalidated: true,
      reason: payload.reason ?? payload.domain ?? "clear",
    };
  }
  async function completeClear(result) {
    if (!result) return result;
    try {
      await invalidateForClear({ reason: `clear:${result.domain ?? "unknown"}` });
      // A failed or unknown current-Chat clear has already invalidated the
      // runtime before its commit. Rebuild from the post-rollback/current
      // Floor state as well, otherwise a failed clear leaves the runtime in a
      // permanently invalidated half-state. Source-targeted clears belong to
      // another Chat and must not refresh the current Chat's registry.
      if (result.sourceTargeted !== true) {
        await primeLifecycleSnapshot();
        await refreshTrackingRegistry(`clear:${result.domain ?? "unknown"}`);
      }
    } catch (error) {
      // The persistence result remains authoritative. A failed/unknown clear
      // must still reach its caller as such, while a confirmed clear keeps
      // the existing runtime-refresh failure reporting behavior.
      if (result.ok === true) throw error;
      console.error("[BioWeave] failed clear state recovery failed", error);
    }
    return result;
  }
  function handleChatBoundarySignal(signal) {
    invalidateInFlightExecutions();
    clearWorldbookCache(sourceCache);
    if (signal?.changed) {
      lastTerminal.clear();
      invalidatedFloors.clear();
      lifecycleSnapshot = null;
    }
  }
  function destroy() {
    destroyed = true;
    removeChatBoundaryListener?.();
    removeChatBoundaryListener = null;
    for (const execution of inFlight.values()) {
      execution.cancelRequested = true;
      execution.invalidated = true;
      execution.controller?.abort?.();
      execution.released = true;
      execution.controller = null;
    }
    inFlight.clear();
  }
  if (typeof chat.subscribe === "function")
    removeChatBoundaryListener = chat.subscribe(handleChatBoundarySignal);
  return {
    resolveCurrentBioWeaveFloor,
    analyzeCurrentFloor,
    analyzeFloor,
    refreshCurrentFloorAnalysis,
    getCurrentFloorAnalysisInput,
    requestAbortCurrentFloorAnalysis,
    getCurrentFloorAnalysisStatus: statusForCurrentFloor,
    getCurrentFloorEvents: async () =>
      (await statusForCurrentFloor()).current_floor_events,
    resolveWorldModelAtOrBefore,
    resolveWorldModelStrictlyBefore: (selector) =>
      resolveWorldModelAtOrBefore(selector, { strictBefore: true }),
    saveWorldModel,
    getTrackingRegistry: async () => {
      const token = chat.token();
      const chatData = store.getChat(token.chatId);
      let derived;
      try {
        derived = await collectCurrentDerivedState(token, chatData);
      } catch (error) {
        if (!isFloorPreflightStage(error?.analysis_stage)) throw error;
        return {
          tracking_subjects: {},
          tracking_candidates: {},
          character_profiles: {},
          character_registry: normalizeCharacterRegistry(null),
        };
      }
      return {
        ...derived.registry,
        character_registry: derived.characterRegistry,
      };
    },
    collectActiveBusinessData,
    getCurrentBiologicalState,
    handleLifecycleEvent,
    primeLifecycleSnapshot,
    getLifecycleSnapshot: () => lifecycleSnapshot,
    invalidateForClear,
    completeClear,
    refreshTrackingRegistry,
    updateEvent,
    deleteEvent,
    destroy,
  };
}
