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
import { traceApi } from "../ai/client.js";
import {
  CAPABILITY_KEYS,
  isPregnancyRelevantExposure,
  normalizeEvent,
  sortEvents,
} from "../core/events.js";
import { reduceState } from "../core/state.js";
import {
  createSnapshot,
  restoreFromSnapshot,
  shouldSnapshot,
  validateSnapshot,
} from "../core/snapshot.js";
import {
  isCompleteCharacterRegistrySnapshot,
  normalizeCharacterRegistry,
  validateCharacterAliases,
} from "../core/identity.js";
import {
  explainTrackingDecision,
} from "../core/tracking.js";
import {
  cloneValue,
  DEFAULT_API_REQUEST_SETTINGS,
} from "../storage/schema.js";
import { createFloorPersistenceCoordinator } from "./floor-persistence.js";
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
  sameFloorVersion,
  shouldAnalyze,
} from "./floor.js";
import { createRuntime as createRuntimeComposition } from "./runtime.js";
const LIFECYCLE_ONLY_EVENTS = new Set([
  // Deletion only invalidates the downstream active path; it never analyzes
  // the message collection after the owner has been removed.
  "MESSAGE_DELETED",
]);
const SCHEDULER_DEDUPE_LIMIT = 128;
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
function cloneWorldValue(value) {
  if (value === undefined || value === null) return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  if (Array.isArray(value)) return value.map(cloneWorldValue);
  if (typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneWorldValue(item)]));
  return value;
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
function isTimeoutFailure(error) {
  const candidates = [error, error?.cause];
  return candidates.some((candidate) => {
    const code = String(candidate?.code ?? candidate?.error_code ?? "")
      .trim()
      .toUpperCase();
    const diagnosticCode = String(
      candidate?.diagnosticCode ?? candidate?.diagnostic_code ?? "",
    )
      .trim()
      .toLowerCase();
    return (
      code === "REQUEST_TIMEOUT" ||
      diagnosticCode === "timeout" ||
      diagnosticCode === "upstream-timeout" ||
      candidate?.timedOut === true ||
      candidate?.bioweaveTimeout === true ||
      candidate?.localTimeout === true
    );
  });
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
function floorVersionComparison(expected, actual) {
  const fields = [
    ["chat_id", "original_chat_id", "current_chat_id"],
    ["message_id", "original_message_id", "current_owner_message_id"],
    ["floor", "original_floor", "current_floor"],
    ["swipe_id", "original_swipe_id", "current_swipe_id"],
    ["content_hash", "original_content_hash", "current_content_hash"],
    ["message_version", "original_message_version", "current_message_version"],
  ];
  const result = {};
  for (const [field, originalKey, currentKey] of fields) {
    result[originalKey] = expected?.[field] ?? null;
    result[currentKey] = actual?.[field] ?? null;
    result[`${field}_match`] = String(expected?.[field] ?? "") === String(actual?.[field] ?? "");
  }
  result.floor_version_match = fields.every(([, originalKey, currentKey]) =>
    result[`${originalKey.replace("original_", "")}_match`] !== false &&
    String(result[originalKey] ?? "") === String(result[currentKey] ?? ""),
  );
  return result;
}

function versionMismatchFields(expected, actual) {
  return [
    "chat_id",
    "message_id",
    "floor",
    "swipe_id",
    "content_hash",
    "message_version",
  ].filter(field => String(expected?.[field] ?? "") !== String(actual?.[field] ?? ""));
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
  error.validator = "core/events.validateEventCollection";
  error.keyword = diagnosticCode;
  error.instancePath = `$.${diagnosticPath}`;
  error.schemaPath = null;
  error.params = {};
  error.diagnostic_code = diagnosticCode;
  error.error_code = diagnosticCode;
  error.diagnostic_path = `$.${diagnosticPath}`;
  error.error_path = error.diagnostic_path;
  return error;
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
  enabledResolver = () => true,
  notify = () => {},
  floorPersistence = null,
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
  let diagnostics;
  let trackingRefresh;
  let generationLifecycle;
  const persistence = floorPersistence ?? createFloorPersistenceCoordinator({
    store,
    enabledResolver,
    emit: payload => notify(payload),
  });
  const invalidatedFloors = new Map();
  let lifecycleSnapshot = null;
  const schedulerState = {
    counter: 0,
    retryPaused: false,
    countedFloorKeys: new Set(),
    observedFloorKeys: new Set(),
    lastFailure: null,
  };

  function persistenceTraceContext(execution, target, domain) {
    return {
      domain,
      chat_id: target?.version?.chat_id ?? target?.chatId ?? chat.current(),
      active_chat_id: chat.current(),
      active_character_floor_message_id: target?.version?.message_id ?? null,
      active_swipe_id: target?.version?.swipe_id ?? target?.swipeId ?? 0,
      message_id: target?.version?.message_id ?? null,
      floor: target?.version?.floor ?? null,
      swipe_id: target?.version?.swipe_id ?? target?.swipeId ?? 0,
      content_hash: target?.version?.content_hash ?? null,
      message_version: target?.version?.message_version ?? null,
      attempt: execution?.attempt ?? null,
      execution_attempt: execution?.attempt ?? null,
      stage_attempt: execution?.stage_attempt ?? null,
      retry_index: execution?.retry_index ?? null,
      persistence_invocation_id: execution?.persistence_invocation_id ?? null,
      trigger: execution?.reason ?? null,
      generation_id: execution?.generation_id ?? null,
      generation_type: execution?.generation_type ?? null,
      generation_settled: execution?.generation_settled ?? null,
      execution_active: execution ? !execution.released && !execution.cancelRequested : null,
      cancel_stage: execution?.cancel_stage ?? null,
      cancel_reason: execution?.cancel_reason ?? null,
      cancel_code: execution?.cancel_code ?? null,
    };
  }

  function commitFloorPatch(target, owner, patch, input = {}) {
    const traceContext = input.traceContext ?? {};
    const callerGuard = input.assertCurrent;
    const assertCurrent = async () => {
      if (typeof callerGuard === "function") await callerGuard();
      const current = await resolveFloorAtIndex({
        __messageIndex: true,
        index: target?.index,
      });
      return sameFloorVersion(current.version, target.version);
    };
    return persistence.commitFloorPatch({
      owner,
      chatId: target?.version?.chat_id ?? target?.chatId ?? chat.current(),
      ownerFloor: {
        message_index: target?.index,
        message_id: target?.version?.message_id,
      },
      swipeId: target?.swipeId ?? target?.version?.swipe_id ?? 0,
      floorVersion: target?.version,
      patch,
      operation_type: input.operation_type ?? `${owner}-patch`,
      execution: input.execution,
      execution_attempt: input.execution_attempt,
      stage_attempt: input.stage_attempt,
      retry_index: input.retry_index,
      traceContext,
      assertCurrent,
    });
  }

  function emitPersistenceTrace(stage, execution, target, details = {}, domain = "analysis") {
    notify({
      type: "BIOWEAVE_PERSISTENCE_TRACE",
      payload: {
        ...persistenceTraceContext(execution, target, domain),
        stage,
        ...details,
      },
      chatId: target?.version?.chat_id ?? target?.chatId ?? chat.current(),
    });
  }

  function resetSchedulerState() {
    schedulerState.counter = 0;
    schedulerState.retryPaused = false;
    schedulerState.countedFloorKeys.clear();
    schedulerState.observedFloorKeys.clear();
    generationLifecycle?.clear();
    schedulerState.lastFailure = null;
  }

  function schedulerSettings() {
    const settings = store.getChat(chat.current())?.settings ?? {};
    const parsedInterval = Number(settings.analysis_interval ?? 3);
    return {
      interval: Number.isInteger(parsedInterval) && parsedInterval > 0
        ? parsedInterval
        : 3,
      retryFailed: settings.retry_failed_analysis !== false,
    };
  }

  function analysisRetryConfig() {
    const globalSettings = store.getSettings?.() ?? {};
    const globalRequestSettings = globalSettings?.api_request_settings;
    const profileRequestSettings = store.profileStore?.getApiRequestSettings?.()
      ?? store.getApiRequestSettings?.()
      ?? {};
    const hasGlobalRetryCount = globalRequestSettings &&
      Object.prototype.hasOwnProperty.call(globalRequestSettings, "retry_count");
    const configuredRetryCount = hasGlobalRetryCount
      ? globalRequestSettings.retry_count
      : profileRequestSettings.retry_count;
    const hasConfiguredValue = configuredRetryCount !== null &&
      configuredRetryCount !== undefined &&
      String(configuredRetryCount).trim() !== "";
    const parsed = hasConfiguredValue ? Number(configuredRetryCount) : Number.NaN;
    const normalized = Number.isInteger(parsed) && parsed >= 0
      ? Math.min(parsed, 3)
      : DEFAULT_API_REQUEST_SETTINGS.retry_count;
    return {
      configured_retry_count: configuredRetryCount ?? null,
      normalized_retry_count: normalized,
      source: hasGlobalRetryCount
        ? "extensionSettings.bioweave.api_request_settings"
        : "profileStore.getApiRequestSettings",
      world_max_retries: normalized,
      event_max_retries: normalized,
    };
  }

  async function classifyFloorVersionFailure(error, { domain, target, execution, token } = {}) {
    const source = error?.version_check_source
      ?? error?.cause?.version_check_source
      ?? null;
    const audit = error?.version_audit ?? error?.cause?.version_audit ?? null;
    const executionActive = execution ? executionIsCurrent(execution) : !destroyed;
    let currentVersion = null;
    let hostMatches = false;
    let activeChatMatch = false;
    try {
      chat.assert(token);
      activeChatMatch = String(chat.current()) === String(target?.version?.chat_id);
      if (target) {
        currentVersion = (await resolveFloorAtIndex({
          __messageIndex: true,
          index: target.index,
        }))?.version ?? null;
        hostMatches = sameFloorVersion(currentVersion, target.version);
      }
    } catch {
      activeChatMatch = false;
      hostMatches = false;
    }
    const officialOwnerIsUnknown = audit &&
      ["chat_id", "message_id", "floor", "swipe_id", "content_hash", "message_version"]
        .every(field => audit.actual?.[field] == null);
    const temporaryConvergence = executionActive && activeChatMatch &&
      hostMatches && source === "official_owner" &&
      (officialOwnerIsUnknown || Boolean(audit));
    const trueOwnerChange = !temporaryConvergence;
    const classification = trueOwnerChange
      ? "true_owner_change"
      : "temporary_server_convergence";
    const retryable = !trueOwnerChange;
    const currentComparison = floorVersionComparison(target?.version, currentVersion);
    error.retry_classification = classification;
    error.retryable = retryable;
    emitPersistenceTrace(
      domain === "world" ? "WORLD_VERSION_MISMATCH_CLASSIFIED" : "EVENT_VERSION_MISMATCH_CLASSIFIED",
      execution,
      target,
      {
        classification,
        version_check_source: source,
        expected_floor_version: target?.version ?? audit?.expected ?? null,
        actual_floor_version: audit?.actual ?? null,
        expected_content_hash: target?.version?.content_hash ?? audit?.expected?.content_hash ?? null,
        actual_content_hash: audit?.actual?.content_hash ?? null,
        mismatch_fields: Array.isArray(audit?.mismatch_fields)
          ? [...audit.mismatch_fields]
          : versionMismatchFields(audit?.expected, audit?.actual),
        active_chat_match: activeChatMatch,
        message_owner_match: currentComparison.message_id_match,
        floor_match: currentComparison.floor_match,
        swipe_match: currentComparison.swipe_id_match,
        host_content_hash_match: currentComparison.content_hash_match,
        host_floor_version_match: currentComparison.floor_version_match,
        official_content_hash_match: audit?.content_hash_match ?? null,
        official_floor_version_match: audit
          ? ["chat_id", "message_id", "floor", "swipe_id", "content_hash", "message_version"]
              .every(field => audit[`${field}_match`] === true)
          : null,
        execution_active: executionActive,
        execution_superseded: Boolean(execution?.superseded),
        retryable,
      },
      domain === "world" ? "world" : "analysis",
    );
    return retryable;
  }

  async function retryableStageFailure(error, { domain, target, execution, token } = {}) {
    const code = String(error?.code ?? error?.error_code ?? "").toUpperCase();
    const causeCode = String(error?.cause?.code ?? error?.cause?.error_code ?? "").toUpperCase();
    const stage = String(error?.analysis_stage ?? "").toLowerCase();
    if (code === "STALE_FLOOR_VERSION" || causeCode === "STALE_FLOOR_VERSION") {
      const versionError = code === "STALE_FLOOR_VERSION" ? error : error.cause;
      const retryable = await classifyFloorVersionFailure(
        versionError,
        { domain, target, execution, token },
      );
      error.retry_classification = versionError.retry_classification;
      error.retryable = retryable;
      error.version_check_source = versionError.version_check_source;
      error.version_audit = versionError.version_audit;
      return retryable;
    }
    // A caller cancellation invalidates the execution even when the transport
    // reports the cancellation as AbortError. A timeout controller is a
    // transport boundary, however, and remains a recoverable Stage failure.
    if (execution?.cancelRequested || execution?.invalidated) return false;
    const timeoutFailure = isTimeoutFailure(error);
    if (timeoutFailure) {
      try {
        chat.assert(token);
        return Boolean(target && await targetVersionIsCurrent(target));
      } catch {
        return false;
      }
    }
    if (
      isRequestAborted(error) ||
      code === "BIOWEAVE_DISABLED" ||
      code === "STALE_CHAT" ||
      code === "STALE_SWIPE" ||
      code === "SWIPE_NOT_FOUND" ||
      code === "BIOWEAVE_USER_FLOOR_WRITE_FORBIDDEN"
    ) return false;
    if (
      code === "WORLD_ANALYZER_UNAVAILABLE" ||
      code === "WORLD_PATCH_ANALYZER_UNAVAILABLE" ||
      code === "EVENT_ANALYZER_UNAVAILABLE" ||
      code === "WORLD_MODEL_REQUIRED_FOR_PATCH" ||
      causeCode === "WORLD_ANALYZER_UNAVAILABLE" ||
      causeCode === "WORLD_PATCH_ANALYZER_UNAVAILABLE" ||
      causeCode === "EVENT_ANALYZER_UNAVAILABLE" ||
      causeCode === "WORLD_MODEL_REQUIRED_FOR_PATCH" ||
      code === "WORLD_STAGE_PERSISTENCE_OWNER_INVALID" ||
      code === "WORLD_STAGE_PERSISTENCE_DUPLICATE" ||
      causeCode === "WORLD_STAGE_PERSISTENCE_OWNER_INVALID" ||
      causeCode === "WORLD_STAGE_PERSISTENCE_DUPLICATE" ||
      code === "CHAT_SCOPE_MISMATCH"
    ) return false;
    const isStageCompletionFailure =
      code === "WORLD_MODEL_PERSISTENCE_PREWRITE_FAILED" ||
      code === "WORLD_MODEL_PERSISTENCE_READBACK_FAILED" ||
      code === "FLOOR_PERSISTENCE_READBACK_FAILED" ||
      code === "WORLD_MODEL_UI_NOT_READY" ||
      code === "CHARACTER_CANONICAL_NOT_READY" ||
      code === "CHARACTER_UI_NOT_READY" ||
      stage.includes("persistence") ||
      stage.includes("floor_save") ||
      stage.includes("readback") ||
      stage.includes("ui_ready") ||
      stage.includes("canonical");
    if (isStageCompletionFailure) {
      if (execution ? !executionIsCurrent(execution) : false) return false;
      try {
        chat.assert(token);
        return Boolean(target && await targetVersionIsCurrent(target));
      } catch {
        return false;
      }
    }
    // Transport-level `retryable` is not the business Stage decision. Once
    // ownership is still valid, all other Stage failures remain eligible for
    // the configured complete-Stage retry budget.
    if (execution && !executionIsCurrent(execution)) return false;
    try {
      chat.assert(token);
      return Boolean(target && await targetVersionIsCurrent(target));
    } catch {
      return false;
    }
  }

  async function runAnalysisStageWithRetry({
    domain,
    target,
    token,
    execution = null,
    signal = null,
    trigger = "automatic",
    invoke,
    complete = null,
  }) {
    const retryConfig = analysisRetryConfig();
    const maxRetries = retryConfig.normalized_retry_count;
    if (!execution || !execution.retryConfigEmitted) {
      emitPersistenceTrace("ANALYSIS_RETRY_CONFIG_RESOLVED", execution, target, {
        configured_retry_count: retryConfig.configured_retry_count,
        normalized_retry_count: retryConfig.normalized_retry_count,
        source: retryConfig.source,
        world_max_retries: retryConfig.world_max_retries,
        event_max_retries: retryConfig.event_max_retries,
      }, domain === "world" ? "world" : "analysis");
      if (execution) execution.retryConfigEmitted = true;
    }
    for (let retryIndex = 0; ; retryIndex += 1) {
      const attempt = retryIndex + 1;
      if (execution) {
        execution.stage_attempt = attempt;
        execution.retry_index = retryIndex;
      }
      if (signal?.aborted) throw requestAbortedError();
      if (execution) {
        assertExecutionCurrent(execution, token);
      } else {
        chat.assert(token);
        if (!(await targetVersionIsCurrent(target))) throw requestAbortedError();
      }
      emitPersistenceTrace(`${domain.toUpperCase()}_STAGE_ATTEMPT_BEGIN`, execution, target, {
        domain,
        attempt,
        retry_index: retryIndex,
        max_retries: maxRetries,
        trigger,
      }, domain === "world" ? "world" : "analysis");
      let aiSucceeded = false;
      try {
        emitPersistenceTrace(`${domain.toUpperCase()}_AI_ATTEMPT_BEGIN`, execution, target, {
          domain,
          attempt,
          retry_index: retryIndex,
          max_retries: maxRetries,
          trigger,
        }, domain === "world" ? "world" : "analysis");
        const result = await invoke({ attempt, retryIndex });
        emitPersistenceTrace(`${domain.toUpperCase()}_AI_ATTEMPT_SUCCEEDED`, execution, target, {
          domain,
          attempt,
          retry_index: retryIndex,
          max_retries: maxRetries,
          trigger,
        }, domain === "world" ? "world" : "analysis");
        aiSucceeded = true;
        const completed = complete ? await complete(result, { attempt, retryIndex }) : result;
        emitPersistenceTrace(`${domain.toUpperCase()}_STAGE_ATTEMPT_SUCCEEDED`, execution, target, {
          domain,
          attempt,
          retry_index: retryIndex,
          max_retries: maxRetries,
          world_persisted: domain === "world" ? true : undefined,
          event_persisted: domain === "event" ? true : undefined,
          readback_valid: true,
          floor_version_match: true,
          canonical_world_present: domain === "world" ? true : undefined,
          canonical_character_present: domain === "event" ? true : undefined,
          ui_ready: true,
        }, domain === "world" ? "world" : "analysis");
        return completed;
      } catch (error) {
        if (!aiSucceeded) {
          emitPersistenceTrace(`${domain.toUpperCase()}_AI_ATTEMPT_FAILED`, execution, target, {
            domain,
            attempt,
            retry_index: retryIndex,
            max_retries: maxRetries,
            failure_stage: error?.analysis_stage ?? domain,
            failure_code: error?.code ?? error?.error_code ?? error?.message ?? "ANALYSIS_FAILED",
          }, domain === "world" ? "world" : "analysis");
        }
        const retryable = await retryableStageFailure(error, { domain, target, execution, token });
        const canRetry = retryable && retryIndex < maxRetries;
        const failureStage = error?.analysis_stage ?? domain;
        const failureCode = error?.code ?? error?.error_code ?? error?.message ?? "ANALYSIS_FAILED";
        emitPersistenceTrace(`${domain.toUpperCase()}_STAGE_ATTEMPT_FAILED`, execution, target, {
          domain,
          attempt,
          retry_index: retryIndex,
          max_retries: maxRetries,
          failure_stage: failureStage,
          failure_code: failureCode,
          retryable,
          retries_remaining: Math.max(0, maxRetries - retryIndex),
          retry_decision: canRetry ? "retry" : "stop",
          retry_reason: retryable ? (canRetry ? "retry-limit-available" : "retry-limit-exhausted") : "non-retryable-failure",
        }, domain === "world" ? "world" : "analysis");
        if (!canRetry) {
          if (retryable && retryIndex >= maxRetries) {
            try {
              error.stage_retry_exhausted = true;
              error.stage_retry_index = retryIndex;
              error.stage_max_retries = maxRetries;
            } catch {
              // Frozen provider errors still retain the terminal trace below.
            }
            emitPersistenceTrace(`${domain.toUpperCase()}_STAGE_RETRY_EXHAUSTED`, execution, target, {
              domain,
              attempt,
              retry_index: retryIndex,
              max_retries: maxRetries,
              failure_stage: failureStage,
              failure_code: failureCode,
              retryable,
              retries_remaining: 0,
              retry_decision: "stop",
              retry_reason: "retry-limit-exhausted",
            }, domain === "world" ? "world" : "analysis");
          }
          throw error;
        }
        emitPersistenceTrace(`${domain.toUpperCase()}_STAGE_RETRY_SCHEDULED`, execution, target, {
          from_retry_index: retryIndex,
          next_retry_index: retryIndex + 1,
          domain,
          attempt: attempt + 1,
          retry_index: retryIndex + 1,
          max_retries: maxRetries,
          failure_stage: failureStage,
          failure_code: failureCode,
          retry_decision: "retry",
          retry_reason: "retry-limit-available",
        }, domain === "world" ? "world" : "analysis");
      }
    }
  }

  function rememberSchedulerKey(set, key) {
    set.delete(key);
    set.add(key);
    while (set.size > SCHEDULER_DEDUPE_LIMIT)
      set.delete(set.values().next().value);
  }

  function lifecycleVersionForPayload(payload, entries = lifecycleSnapshot?.entries) {
    const messageId = typeof payload === "object"
      ? payload?.message_id ?? payload?.messageId
      : null;
    const swipeId = typeof payload === "object"
      ? payload?.swipe_id ?? payload?.swipeId
      : null;
    const requestedEntry = entries?.find(item =>
      String(item?.message_id) === String(messageId) &&
      (swipeId == null || String(item?.swipe_id) === String(swipeId)),
    );
    const entry = requestedEntry ?? (messageId == null
      ? [...(entries ?? [])].reverse().find(item =>
          isCharacterMessage(messages()[item?.index]),
        )
      : null);
    if (!entry || entry.content_hash == null || entry.message_version == null)
      return null;
    return {
      chat_id: lifecycleSnapshot?.chat_id ?? chat.current(),
      message_id: entry.message_id,
      floor: entry.floor,
      swipe_id: entry.swipe_id ?? 0,
      content_hash: entry.content_hash,
      message_version: entry.message_version,
    };
  }

  function recordSchedulerFailure(error, retryFailed) {
    const { interval } = schedulerSettings();
    schedulerState.counter = interval;
    schedulerState.retryPaused = !retryFailed;
    schedulerState.lastFailure = {
      code: error?.code ?? error?.message ?? "ANALYSIS_FAILED",
      stage: error?.analysis_stage ?? null,
    };
  }

  function recordSchedulerSuccess() {
    schedulerState.counter = 0;
    schedulerState.retryPaused = false;
    schedulerState.lastFailure = null;
  }

  function isEnabled() {
    try {
      return enabledResolver() !== false;
    } catch {
      return false;
    }
  }

  function disabledError() {
    const error = new Error("BIOWEAVE_DISABLED");
    error.code = "BIOWEAVE_DISABLED";
    error.status = "disabled";
    return error;
  }

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

  function lifecycleSnapshotChanged(previous, current) {
    if (!previous || !current) return true;
    if (previous.entries.length !== current.entries.length) return true;
    return previous.entries.some(
      (entry, index) => !lifecycleEntryEqual(entry, current.entries[index]),
    );
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
    { preserveTarget = false, clearRoots = true, currentSnapshot = null } = {},
  ) {
    const affectedExecutions = invalidateInFlightExecutions({
      fromIndex: targetIndex,
      currentSnapshot,
      reason: `mutation:${event?.type ?? "unknown"}`,
    });
    if (affectedExecutions > 0 && typeof chat.invalidate === "function")
      chat.invalidate(`mutation:${event?.type ?? "unknown"}`, { checkCurrent: false });
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
        await persistence.clearFloorSlot({
          messageIndex: index,
          swipeId,
          chatId: token.chatId,
          assertCurrent: () => chat.assert(token),
          reason: `mutation:${event?.type ?? "unknown"}`,
        });
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

  async function getCurrentCharacterIdentity(characterId) {
    const token = chat.token();
    const target = await resolveCurrentBioWeaveFloor();
    chat.assert(token);
    const registry = normalizeCharacterRegistry(target.floorData?.character_registry);
    const id = typeof characterId === "string" ? characterId.trim() : "";
    const entry = id ? registry.entities[id] : null;
    if (!entry) throw new Error("CHARACTER_ID_NOT_FOUND");
    return cloneValue(entry);
  }

  async function updateCharacterAliases({ character_id: characterId, aliases } = {}) {
    const token = chat.token();
    const target = await resolveCurrentBioWeaveFloor();
    chat.assert(token);
    const current = store.getFloor?.(target.index, target.swipeId) ?? target.floorData ?? {};
    if (!sameFloorVersion(floorVersionFromData(current), target.version))
      throw new Error("FLOOR_VERSION_STALE");
    const registry = normalizeCharacterRegistry(current.character_registry);
    const validation = validateCharacterAliases(registry, characterId, aliases);
    if (!validation.ok) {
      const error = new Error(validation.reason ?? "ALIAS_INVALID");
      error.code = validation.reason ?? "ALIAS_INVALID";
      error.alias = validation.alias ?? null;
      error.conflicting_character_ids = validation.conflicting_character_ids ?? [];
      throw error;
    }
    const nextRegistry = cloneValue(registry);
    nextRegistry.entities[String(characterId).trim()].aliases = validation.aliases;

    const latest = await resolveCurrentBioWeaveFloor();
    if (!sameFloorVersion(latest.version, target.version))
      throw new Error("FLOOR_VERSION_STALE");
    chat.assert(token);
    await commitFloorPatch(target, "event", {
      character_registry: nextRegistry,
    }, {operation_type: "character-alias-patch", assertCurrent: () => chat.assert(token)});
    chat.assert(token);
    await refreshTrackingRegistry("character-alias-update");
    return {
      ok: true,
      character: cloneValue(nextRegistry.entities[String(characterId).trim()]),
    };
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
  async function collectTrackingInputs(token = chat.token()) {
    const states = await collectCurrentFloorStates(token);
    const validStates = states.filter(
      (state) => !isFloorInvalidated(state),
    );
    const activeEvents = sortEvents(
      validStates.flatMap((state) => state.events),
    );
    let world = null;
    try {
      world = await resolveWorldModelAtOrBefore();
    } catch {
      // An empty Chat has no target Floor and therefore no World Model.
    }
    return {
      states: validStates,
      activeEvents,
      worldModel: world?.model ?? null,
      characterRegistry: currentCharacterRegistryFromStates(validStates),
    };
  }
  async function collectActiveEvents(token = chat.token()) {
    const states = await collectCurrentFloorStates(token);
    return sortEvents(states.flatMap((state) => state.events));
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

  function persistedValidFloorState(state) {
    return Boolean(
      state &&
      floorRootExists(state.index, state.swipeId) &&
      sameFloorVersion(floorVersionFromData(state.floorData), state.version),
    );
  }

  function snapshotOwner(state) {
    return {
      message: state.message,
      activeSwipeId: state.swipeId,
      floorVersion: state.version,
    };
  }

  function validSnapshotForState(state, currentVersion) {
    if (!persistedValidFloorState(state) || !state.floorData?.snapshot) return null;
    const validation = validateSnapshot(state.floorData.snapshot, {
      owner: snapshotOwner(state),
      expectedChatId: currentVersion.chat_id,
      currentFloorVersion: currentVersion,
    });
    return validation.ok ? state.floorData.snapshot : null;
  }

  function snapshotCandidates(states, currentFloor) {
    return states
      .filter(
        (state) =>
          state.index <= currentFloor.index &&
          state.version.floor <= currentFloor.version.floor,
      )
      .sort((left, right) => right.index - left.index);
  }

  function restoreStateFromNearestSnapshot(states, currentFloor, currentStoryTime, characterFacts) {
    const candidates = snapshotCandidates(states, currentFloor);
    for (const candidate of candidates) {
      const snapshot = validSnapshotForState(candidate, currentFloor.version);
      if (!snapshot) continue;
      const laterEvents = sortEvents(
        states
          .filter(
            (state) =>
              state.index > candidate.index &&
              state.index <= currentFloor.index,
          )
          .flatMap((state) => state.events),
      );
      return {
        snapshot,
        checkpoint: candidate,
        events: laterEvents,
        state: restoreFromSnapshot({
          snapshot,
          events: laterEvents,
          currentStoryTime,
          characterFacts,
        }),
      };
    }
    return null;
  }

  function validFloorProgression(states, currentFloor) {
    return states
      .filter(
        (state) =>
          state.index <= currentFloor.index &&
          state.version.floor <= currentFloor.version.floor &&
          persistedValidFloorState(state),
      )
      .sort((left, right) => left.index - right.index)
      .map((state) => ({
        role: messageRole(state.message),
        checkpoint: state.version,
      }));
  }

  async function maybeCreateSnapshot(target, token) {
    const currentFloor = await resolveCurrentBioWeaveFloor();
    if (!sameFloorVersion(currentFloor.version, target.version)) return null;
    chat.assert(token);
    const currentData = store.getFloor?.(target.index, target.swipeId) ?? target.floorData ?? {};
    const existing = validSnapshotForState(
      { ...target, floorData: currentData },
      currentFloor.version,
    );
    if (existing) return existing;

    const derived = await collectCurrentDerivedState(token);
    if (derived.currentStateStatus !== "ready") return null;
    const states = derived.states.filter((state) => !isFloorInvalidated(state));
    const latestSnapshot = snapshotCandidates(states, currentFloor)
      .map((state) => ({ state, snapshot: validSnapshotForState(state, currentFloor.version) }))
      .find((entry) => entry.snapshot)?.snapshot ?? null;
    const chatData = store.getChat(token.chatId);
    const interval = Number(chatData.settings?.snapshot_interval ?? 3);
    if (!shouldSnapshot({
      characterFloors: validFloorProgression(states, currentFloor),
      lastSnapshotCheckpoint: latestSnapshot?.checkpoint ?? null,
      interval: Number.isInteger(interval) ? interval : 3,
    })) return null;

    const snapshot = createSnapshot({
      checkpoint: currentFloor.version,
      state: derived.currentState,
      owner: snapshotOwner({ ...target, ...currentFloor }),
      expectedChatId: token.chatId,
      expectedFloorVersion: currentFloor.version,
    });
    chat.assert(token);
    const latestTarget = await resolveFloorAtIndex({ __messageIndex: true, index: target.index });
    if (!sameFloorVersion(latestTarget.version, target.version)) return null;
    const latestData = store.getFloor?.(target.index, target.swipeId) ?? {};
    const latestExisting = validSnapshotForState(
      { ...latestTarget, floorData: latestData },
      currentFloor.version,
    );
    if (latestExisting) return latestExisting;
    await commitFloorPatch(target, "projection", {
      snapshot,
    }, {operation_type: "snapshot-patch", assertCurrent: () => chat.assert(token)});
    chat.assert(token);
    return snapshot;
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
    const trackingInputs = await collectTrackingInputs(token);
    const currentChat = chatData ?? store.getChat(token.chatId);
    const {
      states: validStates,
      activeEvents,
      characterRegistry,
    } = trackingInputs;
    const registry = trackingRuntime.buildTrackingRegistry(trackingInputs);
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
      const restored = currentFloor
        ? restoreStateFromNearestSnapshot(
          validStates,
          currentFloor,
          currentStoryTime,
          characterFacts,
        )
        : null;
      currentState = restored?.state ?? reduceState({
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
    };
  }
  const featureComposition = createRuntimeComposition({
    generation: {
      getChatId: () => chat.current(),
      baselineVersionForPayload: payload => lifecycleVersionForPayload(payload),
      resolveEndedTarget: index => resolveFloorAtIndex({
        __messageIndex: true,
        index,
      }),
      resolveExistingSwipe: payload => resolveFloor(payload),
      isReusableFloor: currentFloorDataIsReusable,
      isTargetNew: (baseline, target) => !sameFloorVersion(baseline, target),
      floorExecutionKey,
      rememberObservedKey: key =>
        rememberSchedulerKey(schedulerState.observedFloorKeys, key),
      emitTrace: (stage, pending, target, details = {}) =>
        emitPersistenceTrace(stage, null, target, {
          generation_id: pending?.generation_id ?? null,
          generation_type: pending?.generation_type ?? null,
          generation_intent_id: pending?.intent_id ?? null,
          generation_final_floor_seen: pending?.finalFloorSeen === true,
          generation_ended: pending?.ended === true,
          generation_settled: pending?.settled === true,
          ...details,
        }, "scheduler"),
      getCurrentExecutionId: () => [...inFlight.values()].find(execution =>
        execution?.version?.chat_id === chat.current() && !execution.released
      )?.attempt ?? null,
      onGenerationSettled: (target, options) =>
        scheduleRenderedCharacter(target, options),
    },
    tracking: {
      collectTrackingInputs,
      isEnabled,
      hasMessageCollection: () => Boolean(messageCollection()),
      getToken: () => chat.token(),
      assertToken: token => chat.assert(token),
      notify,
      enqueueRefresh: refresh => {
        const result = registryRefreshChain.then(refresh, refresh);
        registryRefreshChain = result.catch(() => null);
        return result;
      },
    },
    world: {
      analyzer,
      isEnabled,
      getToken: () => chat.token(),
      assertToken: token => chat.assert(token),
      resolveCurrentFloor: resolveFloor,
      resolveFloorAtIndex,
      getMessages: messages,
      getActiveSwipeId: index => store.getActiveSwipeId?.(index),
      getFloor: (index, swipeId) => store.getFloor?.(index, swipeId),
      getMessageText: messageText,
      isCharacterMessage,
      hasSwipeSlot,
      isFloorInvalidated,
      floorExecutionKey,
      nextAttemptSequence: () => ++attemptSequence,
      commitFloorPatch,
      runAnalysisStageWithRetry,
      targetVersionIsCurrent,
      executionIsCurrent,
      assertExecutionCurrent,
      invalidateExecution,
      clearInvalidatedFloor: version => invalidatedFloors.delete(floorExecutionKey(version)),
      setExecutionStage: (execution, stage) => { execution.stage = stage; },
      setExecutionPhase: (execution, phase) => { execution.phase = phase; },
      getExecutionSignal: execution => execution.controller.signal,
      setExecutionCancellationMetadata: (execution, {stage, reason, code}) => {
        execution.cancel_stage = stage;
        execution.cancel_reason = reason;
        execution.cancel_code = code;
      },
      setExecutionDiagnostic: (execution, diagnostic) => { execution.diagnostic = diagnostic; },
      emitPersistenceTrace,
      persistenceTraceContext,
      notify,
      disabledError,
      requestAbortedError,
      isRequestAborted,
      floorVersionComparison,
    },
    characterEvent: {
      analyzer,
      commitAnalysis,
      commitFloorPatch,
      assertExecutionTargetCurrent,
      assertExecutionCurrent,
      dependencyHashForTarget,
      invalidateExecution,
      requestAbortedError,
      getFloor: (index, swipeId) => store.getFloor?.(index, swipeId),
      resolveFloorAtIndex,
      resolveCurrentBioWeaveFloor,
      collectActiveBusinessData,
      collectCurrentFloorStates,
      assertToken: token => chat.assert(token),
      maybeCreateSnapshot,
      refreshTrackingRegistry: (...args) => trackingRefresh(...args),
      emitPersistenceTrace,
      persistenceTraceContext,
      clearInvalidatedFloor: version => invalidatedFloors.delete(floorExecutionKey(version)),
      trace: traceApi,
      nextPersistenceInvocationId: domain => `${domain}-${Date.now()}-${++attemptSequence}`,
      domainValidationError,
      isStaleChat,
    },
    eventEditing: {
      getMessages: messages,
      isCharacterMessage,
      resolveFloorAtIndex,
      getActiveFloorEvents: (index, version) =>
        store.getActiveFloorEvents?.(index, version) ?? [],
      invalidateMutation,
      commitFloorPatch,
      assertMutationToken: token => chat.assert(token),
      clearInvalidatedFloor: version => invalidatedFloors.delete(floorExecutionKey(version)),
      refreshTrackingRegistry: (...args) => trackingRefresh(...args),
      createCollectionValidationError: domainValidationError,
    },
  });
  diagnostics = featureComposition.diagnostics;
  generationLifecycle = featureComposition.generationLifecycle;
  const trackingRuntime = featureComposition.trackingRuntime;
  trackingRefresh = featureComposition.trackingRuntime.refreshTrackingRegistry;
  const refreshTrackingRegistry = trackingRefresh;
  const worldAnalysis = featureComposition.worldAnalysis;
  const resolveWorldModelAtOrBefore = worldAnalysis.resolveWorldModelAtOrBefore;
  const resolveWorldModelStrictlyBefore = worldAnalysis.resolveWorldModelStrictlyBefore;
  const resolvePersistedWorldModelForAnalysis = worldAnalysis.resolvePersistedWorldModelForAnalysis;
  const saveWorldModel = worldAnalysis.saveWorldModel;
  const analyzeCurrentWorldModelFull = worldAnalysis.analyzeCurrentWorldModelFull;
  const analyzeCurrentWorldModelPatch = worldAnalysis.analyzeCurrentWorldModelPatch;
  const resolveFinalWorldModelForAnalysis = worldAnalysis.resolveFinalWorldModelForAnalysis;
  const characterEventAnalysis = featureComposition.characterEventAnalysis;
  const eventEditing = featureComposition.eventEditing;
  async function statusForCurrentFloor() {
    let target;
    try {
      target = await resolveFloor();
    } catch (error) {
      if (
        error?.message !== "MESSAGE_NOT_FOUND" &&
        isFloorPreflightStage(error?.analysis_stage)
      ) {
        return diagnostics.buildFloorPreflightStatus(error, 0);
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
    const activePhase = activeAttempt?.phase ?? null;
    const busy = Boolean(
      activeAttempt &&
      !activeAttempt.cancelRequested &&
      activePhase === "event_analysis",
    );
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
      validator: diagnostic?.validator ?? currentAnalysis?.validator ?? null,
      keyword: diagnostic?.keyword ?? currentAnalysis?.keyword ?? null,
      instance_path: diagnostic?.instance_path ?? currentAnalysis?.instance_path ?? null,
      schema_path: diagnostic?.schema_path ?? currentAnalysis?.schema_path ?? null,
      validator_params: diagnostic?.validator_params ?? currentAnalysis?.validator_params ?? null,
      http_status:
        diagnostic?.http_status ??
        currentAnalysis?.http_status ??
        currentAnalysis?.last_attempt?.http_status ??
        null,
      phase:
        activePhase ??
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
        diagnostics.buildFloorPreflightStatus(error, 0),
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

  async function verifyCharacterCanonicalReady(
    target,
    execution,
    token,
    expectedEvents,
  ) {
    emitPersistenceTrace("CHARACTER_CANONICAL_READ_BEGIN", execution, target, {
      domain: "event",
    }, "event");
    let currentTarget;
    let floorData;
    try {
      currentTarget = await resolveFloorAtIndex({
        __messageIndex: true,
        index: target.index,
      });
      floorData = store.getFloor?.(target.index, target.swipeId) ?? null;
    } catch (cause) {
      const error = new Error("CHARACTER_CANONICAL_NOT_READY");
      error.code = "CHARACTER_CANONICAL_NOT_READY";
      error.analysis_stage = "character_canonical_read";
      error.cause = cause;
      throw error;
    }
    const actualVersion = currentTarget?.version ?? floorVersionFromData(floorData);
    const floorVersionMatch = Boolean(
      actualVersion && sameFloorVersion(actualVersion, target.version),
    );
    const slotAudit = {
      analysis_present: Boolean(floorData?.analysis),
      events_present: Array.isArray(floorData?.events),
      event_count: Array.isArray(floorData?.events) ? floorData.events.length : 0,
      character_registry_present: Boolean(floorData?.character_registry),
      character_count: floorData?.character_registry?.entities
        ? Object.keys(floorData.character_registry.entities).length
        : 0,
      snapshot_present: Boolean(floorData?.snapshot),
      projection_timeline_present: Boolean(floorData?.projection_timeline),
      world_model_present: Boolean(floorData?.world_model),
    };
    const expectedEventCount = Array.isArray(expectedEvents)
      ? expectedEvents.length
      : null;
    const actualFloorEvents = Array.isArray(floorData?.events)
      ? floorData.events
      : [];
    const expectedEventIds = new Set(
      (Array.isArray(expectedEvents) ? expectedEvents : [])
        .map(event => event?.event_id)
        .filter(Boolean),
    );
    emitPersistenceTrace("CHARACTER_FLOOR_SOURCE_RESOLVED", execution, target, {
      chat_id: target.version.chat_id,
      message_id: target.version.message_id,
      floor: target.version.floor,
      active_swipe_id: currentTarget?.swipeId ?? target.swipeId,
      expected_swipe_id: target.swipeId,
      expected_floor_version: target.version,
      actual_floor_version: actualVersion,
      floor_version_match: floorVersionMatch,
      bioweave_present: Boolean(floorData),
    }, "event");
    emitPersistenceTrace("CHARACTER_SLOT_AUDIT", execution, target, slotAudit, "event");
    if (!floorVersionMatch || !slotAudit.analysis_present || !slotAudit.events_present || !slotAudit.character_registry_present) {
      const error = new Error("CHARACTER_CANONICAL_NOT_READY");
      error.code = "CHARACTER_CANONICAL_NOT_READY";
      error.analysis_stage = "character_canonical_read";
      error.floor_version_match = floorVersionMatch;
      throw error;
    }
    chat.assert(token);
    let business = null;
    let currentFloorIncluded = false;
    try {
      const current = await resolveCurrentBioWeaveFloor();
      if (current?.version && sameFloorVersion(current.version, target.version)) {
        business = await collectActiveBusinessData();
        currentFloorIncluded = Boolean(
          business?.current_floor?.version &&
          sameFloorVersion(business.current_floor.version, target.version),
        );
      } else {
        // A targeted/manual analysis may intentionally address a historical
        // Character Floor. In that case the canonical source is still the
        // target Floor slot; the current-page projection must not make a
        // valid historical attempt look unready.
        const states = await collectCurrentFloorStates(token);
        currentFloorIncluded = states.some(
          state => state.index === target.index && sameFloorVersion(state.version, target.version),
        );
      }
    } catch (cause) {
      const error = new Error("CHARACTER_CANONICAL_NOT_READY");
      error.code = "CHARACTER_CANONICAL_NOT_READY";
      error.analysis_stage = "character_canonical_rebuild";
      error.cause = cause;
      throw error;
    }
    const eventCount = Array.isArray(business?.active_events)
      ? business.active_events.length
      : slotAudit.event_count;
    const characterCount = Object.keys(business?.tracking_subjects ?? {}).length;
    const canonicalEventCountMatches = expectedEventCount === null
      ? true
      : actualFloorEvents.length === expectedEventCount;
    const actualEventIds = new Set(
      actualFloorEvents.map(event => event?.event_id).filter(Boolean),
    );
    const canonicalEventIdsMatch = expectedEventCount === null
      ? true
      : expectedEventIds.size === actualEventIds.size &&
        [...expectedEventIds].every(id => actualEventIds.has(id));
    const validEmptyEventResult = expectedEventCount === 0 && actualFloorEvents.length === 0;
    emitPersistenceTrace("CHARACTER_CANONICAL_ACTUAL", execution, target, {
      actual_event_count: actualFloorEvents.length,
      actual_character_count: characterCount,
      actual_registry_character_count: slotAudit.character_count,
    }, "event");
    emitPersistenceTrace("EVENT_EMPTY_RESULT_CLASSIFIED", execution, target, {
      valid_empty: validEmptyEventResult,
      reason: validEmptyEventResult
        ? "persisted_current_floor_events_empty"
        : expectedEventCount === 0
          ? "persisted_current_floor_events_unexpected"
          : "nonempty_result_requires_canonical_events",
    }, "event");
    emitPersistenceTrace("CHARACTER_CANONICAL_STATE_BUILT", execution, target, {
      character_count: characterCount,
      event_count: eventCount,
      current_floor_included: currentFloorIncluded,
      source: "authoritative_floor",
    }, "event");
    const ready = currentFloorIncluded &&
      business?.current_state_status !== "STATE_ERROR" &&
      canonicalEventCountMatches &&
      canonicalEventIdsMatch;
    emitPersistenceTrace("CHARACTER_UI_READY", execution, target, {
      ready,
      reason: ready
        ? validEmptyEventResult
          ? "valid_empty_event_result"
          : "canonical_business_state_ready"
        : !canonicalEventCountMatches || !canonicalEventIdsMatch
          ? "canonical_event_state_missing"
          : "canonical_business_state_invalid",
    }, "event");
    if (!ready) {
      const error = new Error("CHARACTER_CANONICAL_NOT_READY");
      error.code = "CHARACTER_CANONICAL_NOT_READY";
      error.analysis_stage = "character_ui_ready";
      throw error;
    }
    return { business, slotAudit, expectedEvents };
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
      Boolean(execution) &&
      !destroyed &&
      !execution.cancelRequested &&
      !execution.released &&
      inFlight.get(execution.key) === execution &&
      !execution.controller?.signal.aborted
    );
  }
  function assertExecutionCurrent(execution, token) {
    if (!isEnabled()) {
      execution.disabled = true;
      throw disabledError();
    }
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
      ? {
          ...diagnostics.formatExecutionDiagnostic(error, execution.stage),
          ...(execution.diagnostic ?? {}),
        }
      : (execution.diagnostic ?? null);
    const terminal = {
      state,
      attempt: execution.attempt,
      reason: execution.reason,
      world_resolution: execution.world_resolution,
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
        reason: execution.reason,
        world_resolution: execution.world_resolution,
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
  function invalidateExecution(
    execution,
    {
      stage = "cancelled",
      reason = "stale-floor-version",
      code = "REQUEST_ABORTED",
      currentVersion = null,
      generation = null,
    } = {},
  ) {
    if (execution.released) return;
    execution.cancelRequested = true;
    execution.invalidated = true;
    execution.controller?.abort?.();
    const error = requestAbortedError();
    error.code = code;
    error.analysis_stage = stage;
    execution.cancel_stage = stage;
    execution.cancel_reason = reason;
    execution.cancel_code = code;
    execution.diagnostic = {
      ...diagnostics.formatExecutionDiagnostic(error, stage),
      cancel_stage: stage,
      cancel_reason: reason,
      cancel_code: code,
      floor_version_match: currentVersion
        ? sameFloorVersion(execution.version, currentVersion)
        : null,
      generation_id: generation?.generation_id ?? execution.generation_id ?? null,
      generation_type: generation?.generation_type ?? execution.generation_type ?? null,
      execution_active: false,
      ...floorVersionComparison(execution.version, currentVersion),
      generation_identity_match: generation
        ? String(generation.generation_id ?? "") === String(execution.generation_id ?? "") &&
          String(generation.generation_type ?? "") === String(execution.generation_type ?? "")
        : execution.generation_id == null ? null : true,
    };
    finalizeExecution(execution, "cancelled", error);
  }
  function invalidateInFlightExecutions({
    fromIndex = null,
    currentSnapshot = null,
    reason = "stale-floor-version",
  } = {}) {
    let affected = 0;
    for (const execution of [...inFlight.values()]) {
      if (
        Number.isInteger(fromIndex) &&
        Number.isInteger(execution.index) &&
        execution.index < fromIndex
      ) {
        continue;
      }
      const entry = currentSnapshot?.entries?.find(
        item => Number(item?.index) === Number(execution.index),
      );
      const currentVersion = entry && entry.content_hash != null && entry.message_version != null
        ? {
            chat_id: currentSnapshot.chat_id ?? chat.current(),
            message_id: entry.message_id,
            floor: entry.floor,
            swipe_id: entry.swipe_id ?? 0,
            content_hash: entry.content_hash,
            message_version: entry.message_version,
          }
        : null;
      if (
        Number.isInteger(fromIndex) &&
        execution.index === fromIndex &&
        currentVersion &&
        sameFloorVersion(execution.version, currentVersion)
      ) continue;
      affected += 1;
      invalidateExecution(execution, {
        reason,
        code: currentVersion && !sameFloorVersion(execution.version, currentVersion)
          ? "STALE_FLOOR_VERSION"
          : "REQUEST_ABORTED",
        currentVersion,
      });
    }
    return affected;
  }
  function pause() {
    invalidateInFlightExecutions();
    return {status: "disabled"};
  }
  async function persistTerminalAttempt(
    execution,
    target,
    savedAnalysis,
    status,
    diagnostic = null,
  ) {
    if (!(await targetVersionIsCurrent(target))) return null;
    execution.persistence_invocation_id = `terminal-${Date.now()}-${++attemptSequence}`;
    const currentFloorData =
      store.getFloor?.(target.index, target.swipeId) ?? target.floorData ?? {};
    const previousAnalysis = currentFloorData.analysis ?? savedAnalysis;
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
    await commitFloorPatch(target, "terminal", {
      analysis,
    }, {
      operation_type: "terminal-analysis-patch",
      execution,
      traceContext: persistenceTraceContext(execution, target, "analysis"),
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
      await commitFloorPatch(target, "event", {
        analysis: target.floorData?.analysis,
        events: target.floorData?.events,
        character_registry: target.floorData?.character_registry,
      }, {operation_type: "late-analysis-rollback"});
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
      invalidateExecution(execution, {
        reason: "floor-version-changed",
        code: "STALE_FLOOR_VERSION",
        currentVersion: current.version,
      });
      throw requestAbortedError();
    }
    if (
      execution.source_provenance &&
      !sameFloorVersion(execution.source_provenance, current.version)
    ) {
      invalidateExecution(execution, {
        reason: "source-provenance-changed",
        code: "STALE_FLOOR_VERSION",
        currentVersion: current.version,
      });
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
    const causalRegistry = trackingRuntime.buildTrackingRegistry({
      activeEvents: causalEvents,
      worldModel: causalWorld?.model ?? null,
    });
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
      execution.source_provenance = { ...target.version };
      await assertExecutionTargetCurrent(execution, target, token);
      const manualCharacter = execution.analysis_intent === "manual-character";
      const persistedWorld = manualCharacter
        ? await resolvePersistedWorldModelForAnalysis(target)
        : null;
      const preWorldInput = await buildFloorAnalysisInput(target, token);
      await assertExecutionTargetCurrent(execution, target, token);
      if (execution.reason !== "manual-refresh") {
        emitPersistenceTrace("ANALYSIS_INPUT_READY", execution, target, {
          generation_settled: execution.generation_settled,
          host_floor_version_match: true,
          active_swipe_match: true,
        }, "analysis");
        emitPersistenceTrace("AUTO_ANALYSIS_TRIGGERED", execution, target, {
          prerequisite: "analysis_input_ready",
        }, "analysis");
      }
      const finalWorldModel = manualCharacter
        ? (() => {
            execution.world_resolution = "persisted-reuse";
            execution.stage = "event_analysis";
            return cloneWorldValue(persistedWorld.model);
          })()
        : await resolveFinalWorldModelForAnalysis(
            target,
            token,
            execution,
            preWorldInput,
            { force: execution.reason === "manual-refresh" },
          );
      execution.world_resolution = execution.stage === "world_analysis"
        ? "full"
        : execution.stage === "world_patch_analysis"
          ? "patch"
          : execution.world_resolution === "persisted-reuse"
            ? "persisted-reuse"
            : "reuse";
      await assertExecutionTargetCurrent(execution, target, token);
      const analysisInput = await buildFloorAnalysisInput(target, token);
      analysisInput.world_model = cloneWorldValue(finalWorldModel);
      notify({
        type: "EVENT_ANALYSIS_STATUS_CHANGED",
        payload: {
          state: "running",
          phase: "event_analysis",
          attempt: execution.attempt,
          started_at: execution.started_at,
          floor_version: execution.version,
        },
        chatId: execution.version.chat_id,
      });
      execution.dependency_hash = await dependencyHashForTarget(target, token);
      await assertExecutionTargetCurrent(execution, target, token);
      if (typeof analyzer?.analyzeFloor !== "function")
        throw new Error("EVENT_ANALYZER_UNAVAILABLE");
      const eventStage = await runAnalysisStageWithRetry({
        domain: "event",
        target,
        token,
        execution,
        signal: execution.controller.signal,
        trigger: execution.reason,
        invoke: async () => {
          execution.stage = "api_request";
          return characterEventAnalysis.runEventAttempt({
            target,
            token,
            execution,
            analysisInput,
            finalWorldModel,
            savedAnalysis,
            dependencyHash: execution.dependency_hash,
          });
        },
      });
      terminalState = "success";
      return {
        events: eventStage.events,
        version: target.version,
        status: "success",
        attempt: execution.attempt,
      };
    } catch (error) {
      if (error?.code === "BIOWEAVE_DISABLED") {
        terminalState = "disabled";
        terminalError = null;
        return {
          skipped: true,
          status: "disabled",
          version: target.version,
          attempt: execution.attempt,
        };
      }
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
        execution.diagnostic = diagnostics.formatExecutionDiagnostic(terminalError, "cancelled");
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
      execution.diagnostic = diagnostics.formatExecutionDiagnostic(error, execution.stage);
      error.analysis_stage ??= execution.diagnostic.stage;
      error.error_code ??= execution.diagnostic.error_code;
      error.safe_error_summary ??= execution.diagnostic.safe_error_summary;
      // Chat epoch 变化后的结果不属于当前作用域；释放执行即可，不能把旧
      // Floor 的失败元数据写回当前 Chat/Swipe。
      if (
        !execution.released &&
        !isStaleChat(error) &&
        !execution.floorSaved &&
        !error?.prerequisite_failed &&
        error?.analysis_stage !== "floor_owner_convergence" &&
        error?.code !== "WORLD_MODEL_UNAVAILABLE" &&
        error?.code !== "AUTO_ANALYSIS_FLOOR_PREREQUISITE_UNAVAILABLE"
      ) {
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
    { force = false, reason = "automatic", generation = null, intent = null } = {},
  ) {
    if (!isEnabled())
      return { skipped: true, status: "disabled", reason: "disabled" };
    const target = await resolveFloor(selector);
    const requestKey = floorExecutionKey(target.version);
    if (inFlight.has(requestKey)) return inFlight.get(requestKey).promise;
    const savedAnalysis = target.floorData?.analysis ?? null;
    const dependencyInvalidated = invalidatedFloors.has(requestKey);
    if (
      !dependencyInvalidated &&
      !shouldAnalyze(savedAnalysis, {
        version: target.version,
        manual: force || intent === "manual-character",
      })
    ) {
      return { skipped: true, version: target.version, status: "success" };
    }
    const attempt = ++attemptSequence;
    const controller = new AbortController();
    const execution = {
      key: requestKey,
      index: target.index,
      version: target.version,
      attempt,
      reason,
      analysis_intent: intent ?? (force ? "manual-refresh" : reason),
      controller,
      started_at: new Date().toISOString(),
      stage: "request_build",
      cancelRequested: false,
      released: false,
      floorSaved: false,
      floorSaveStarted: false,
      source_provenance: null,
      dependency_hash: null,
      phase: reason === "manual-refresh" || intent === "manual-character"
        ? "event_analysis"
        : null,
      generation_id: generation?.generation_id ?? null,
      generation_type: generation?.generation_type ?? null,
      generation_settled: generation ? generation.settled === true : null,
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
        ...(reason === "manual-refresh" || intent === "manual-character"
          ? { phase: "event_analysis" }
          : {}),
      },
      chatId: target.chatId,
    });
    return execution.promise;
  }
  async function runScheduledAnalysis(target, { force, reason, generation = null }) {
    const settings = schedulerSettings();
    try {
      const result = await analyzeFloor(
        { __messageIndex: true, index: target.index },
        { force, reason, generation },
      );
      if (result?.status === "success") recordSchedulerSuccess();
      return result;
    } catch (error) {
      recordSchedulerFailure(error, settings.retryFailed);
      throw error;
    }
  }
  function analyzeCurrentFloor(options = {}) {
    const result = analyzeFloor(null, options);
    if (options.force !== true) return result;
    const settings = schedulerSettings();
    return result.then((value) => {
      if (value?.status === "success") recordSchedulerSuccess();
      return value;
    }).catch((error) => {
      recordSchedulerFailure(error, settings.retryFailed);
      throw error;
    });
  }
  function refreshCurrentFloorAnalysis() {
    return analyzeCurrentFloor({ force: true, reason: "manual-refresh" });
  }

  function analyzeCurrentCharacterEvents() {
    return analyzeFloor(null, {
      force: false,
      reason: "manual-character",
      intent: "manual-character",
    });
  }
  async function scheduleRenderedCharacter(
    target,
    { force = false, reason = "automatic", generation = null } = {},
  ) {
    const key = floorExecutionKey(target.version);
    if (schedulerState.observedFloorKeys.has(key) && !force)
      return { skipped: true, reason: "floor-already-observed" };
    rememberSchedulerKey(schedulerState.observedFloorKeys, key);
    if (force)
      return runScheduledAnalysis(target, { force: true, reason, generation });

    const { interval } = schedulerSettings();
    if (schedulerState.retryPaused)
      return { skipped: true, reason: "retry-paused" };
    schedulerState.counter = Math.min(interval, schedulerState.counter + 1);
    rememberSchedulerKey(schedulerState.countedFloorKeys, key);
    if (schedulerState.counter < interval)
      return {
        skipped: true,
        reason: "character-interval",
        counter: schedulerState.counter,
      };
    return runScheduledAnalysis(target, { force: false, reason, generation });
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
    invalidateExecution(execution, {
      stage: "cancelled",
      reason: "manual-abort",
      code: "REQUEST_ABORTED",
    });
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
      if (!isEnabled())
        return { skipped: true, status: "disabled", reason: event?.type };
      const type = event?.type;
      if (type === "CHAT_CHANGED") {
        await primeLifecycleSnapshot();
        await refreshTrackingRegistry(type);
        return { skipped: true, reason: type };
      }
      if (type === "CHAT_CREATED")
        return { skipped: true, reason: "unsupported-event" };
      const supported = new Set([
        "CHARACTER_MESSAGE_RENDERED",
        "GENERATION_STARTED",
        "MESSAGE_RECEIVED",
        "GENERATION_ENDED",
        "GENERATION_STOPPED",
        "GENERATION_CANCELLED",
        "MESSAGE_UPDATED",
        "MESSAGE_EDITED",
        "MESSAGE_DELETED",
        "MESSAGE_SWIPED",
        "MESSAGE_SWIPE_DELETED",
      ]);
      if (!supported.has(type))
        return { skipped: true, reason: "unsupported-event" };
      if (type === "GENERATION_STARTED")
        return generationLifecycle.onGenerationStarted(event?.payload);

      let currentSnapshot;
      try {
        currentSnapshot = await captureLifecycleSnapshot();
      } catch {
        currentSnapshot = { entries: [] };
      }
      const targetIndex = lifecycleMutationIndex(event, currentSnapshot);
      const previousLifecycleEntry =
        targetIndex !== null && targetIndex !== undefined
          ? lifecycleSnapshot?.entries?.[targetIndex] ?? null
          : null;
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
        lifecycleSnapshot = currentSnapshot;
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
      const mutationChanged = lifecycleSnapshotChanged(
        lifecycleSnapshot,
        currentSnapshot,
      );
      if (isSourceMutation && mutationChanged) {
        await invalidateMutation(event, targetIndex, {
          preserveTarget: isSwipeBoundaryEvent,
          clearRoots: true,
          currentSnapshot,
        });
      }
      lifecycleSnapshot = await primeLifecycleSnapshot();
      if (isSwipeBoundaryEvent) await refreshTrackingRegistry(type);
      if (LIFECYCLE_ONLY_EVENTS.has(type)) {
        await refreshTrackingRegistry(type);
        return { skipped: true, reason: type };
      }
      if (type === "GENERATION_STOPPED" || type === "GENERATION_CANCELLED") {
        return generationLifecycle.onGenerationStopped(
          event?.payload ?? null,
          currentSnapshot.entries[targetIndex] ?? null,
        );
      }
      if (type === "GENERATION_ENDED") {
        return generationLifecycle.onGenerationEnded();
      }
      if (type === "MESSAGE_UPDATED" || type === "MESSAGE_EDITED" ||
          type === "MESSAGE_RECEIVED") {
        return { skipped: true, reason: "lifecycle-baseline-only" };
      }
      if (type === "MESSAGE_SWIPED") {
        return generationLifecycle.onSwipe(event?.payload, previousLifecycleEntry);
      }
      let target;
      try {
        const resolved = resolveMessage(event?.payload ?? null);
        target = await resolveFloorAtIndex({ __messageIndex: true, index: resolved.index });
      } catch (error) {
        if (isSwipeBoundaryEvent && error?.message === "MESSAGE_NOT_FOUND")
          return { skipped: true, reason: "swipe-not-found" };
        throw error;
      }
      if (type !== "CHARACTER_MESSAGE_RENDERED")
        return { skipped: true, reason: "not-a-character-render" };
      const generationResult = await generationLifecycle.onCharacterMessageRendered(target);
      if (generationResult) return generationResult;
      try {
        return await scheduleRenderedCharacter(target, { reason: type });
      } catch (error) {
        if (error?.message === "SWIPE_NOT_FOUND")
          return { skipped: true, reason: "swipe-not-found" };
        throw error;
      }
    };
    const result = lifecycleMutationChain.then(work, work);
    lifecycleMutationChain = result.catch(() => null);
    return result;
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
      resetSchedulerState();
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
    worldAnalysis.clear();
    resetSchedulerState();
  }
  if (typeof chat.subscribe === "function")
    removeChatBoundaryListener = chat.subscribe(handleChatBoundarySignal);
  return {
    resolveCurrentBioWeaveFloor,
    getCurrentCharacterIdentity,
    updateCharacterAliases,
    analyzeCurrentFloor,
    analyzeFloor,
    refreshCurrentFloorAnalysis,
    analyzeCurrentCharacterEvents,
    getCurrentFloorAnalysisInput,
    requestAbortCurrentFloorAnalysis,
    getCurrentFloorAnalysisStatus: statusForCurrentFloor,
    getAutoAnalysisSchedulerState: () => ({
      counter: schedulerState.counter,
      retryPaused: schedulerState.retryPaused,
      countedFloorKeys: [...schedulerState.countedFloorKeys],
      observedFloorKeys: [...schedulerState.observedFloorKeys],
      ...generationLifecycle.getState(),
      lastFailure: schedulerState.lastFailure
        ? { ...schedulerState.lastFailure }
        : null,
    }),
    getCurrentFloorEvents: async () =>
      (await statusForCurrentFloor()).current_floor_events,
    resolveWorldModelAtOrBefore,
    resolveWorldModelStrictlyBefore,
    resolvePersistedWorldModelForAnalysis,
    saveWorldModel,
    analyzeCurrentWorldModelFull,
    analyzeCurrentWorldModelPatch,
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
    pause,
    updateEvent: eventEditing.updateEvent,
    deleteEvent: eventEditing.deleteEvent,
    destroy,
  };
}
