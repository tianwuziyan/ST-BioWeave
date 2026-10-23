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
  dedupeEvents,
  isPregnancyRelevantExposure,
  normalizeEvent,
  sortEvents,
} from "../core/events.js";
import { reduceState } from "../core/state.js";
import {
  createSnapshot,
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
import {deriveReproductiveSourceCandidates} from "../core/reproductive-attribution.js";
import {normalizeHealthAssessmentTimeline} from "../core/health-assessment.js";
import {
  mergeTrackingSubjectsWithActivePregnancies,
  resolveTrackingWindowHorizon,
} from "../core/tracking-window.js";
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
import { normalizeHostMessageRole } from "../core/message-role.js";
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
  hasCompleteFloorVersion,
  hasCompleteEventState,
  hashText,
  sameFloorVersion,
  shouldAnalyze,
} from "./floor.js";
import { createRuntime as createRuntimeComposition } from "./runtime.js";
import { createAutomaticAnalysisPort } from "./automatic-analysis.js";
import { createAnalysisExecutionPort } from "./analysis-execution.js";
import { createManualAnalysisPort } from "./manual-analysis.js";
import { createTrackingWindowRuntime } from "./tracking-window-runtime.js";
import {
  buildVersionChainDiagnostic,
  durationMs,
  monotonicNow,
} from "./diagnostics.js";
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

function sameDerivedValue(left, right) {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== typeof right) return false;
  if (!left || typeof left !== "object") return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left)) {
    return left.length === right.length && left.every((value, index) =>
      sameDerivedValue(value, right[index]));
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every(key =>
    Object.prototype.hasOwnProperty.call(right, key) &&
    sameDerivedValue(left[key], right[key]));
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

function stableEventReferenceFingerprint(value) {
  if (Array.isArray(value)) return `[${value.map(stableEventReferenceFingerprint).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableEventReferenceFingerprint(value[key])}`).join(",")}}`;
}

function mergeEventReferenceEvidence(previousEvent, currentEvent) {
  if (!previousEvent || !currentEvent || typeof currentEvent !== "object") return currentEvent;
  const previousSourceFloor = Number(previousEvent.source?.floor);
  const currentSourceFloor = Number(currentEvent.source?.floor);
  if (!Number.isFinite(previousSourceFloor) || !Number.isFinite(currentSourceFloor) ||
      previousSourceFloor >= currentSourceFloor) return currentEvent;
  const seen = new Set();
  const sourceEvidence = [
    ...(Array.isArray(previousEvent.source_evidence) ? previousEvent.source_evidence : []),
    ...(Array.isArray(currentEvent.source_evidence) ? currentEvent.source_evidence : []),
  ].filter(item => {
    const key = stableEventReferenceFingerprint(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    ...currentEvent,
    source: previousEvent.source,
    source_evidence: sourceEvidence,
  };
}

function selectAnalysisExistingEvents({previousEvents = [], currentFloorEvents = [], targetVersion = null} = {}) {
  const selected = new Map();
  const unkeyed = [];
  let inputTotalCount = 0;
  let conflictEventCount = 0;
  let unresolvedConflictCount = 0;
  const selectedSourceCounts = {
    current_floor_target_version: 0,
    current_floor_resolved: 0,
    previous_resolved: 0,
  };

  function consider(event, sourceCategory, priority) {
    inputTotalCount += 1;
    const eventId = typeof event?.event_id === "string" ? event.event_id.trim() : "";
    if (!eventId) {
      unkeyed.push(event);
      return;
    }
    const fingerprint = stableEventReferenceFingerprint(event);
    const existing = selected.get(eventId);
    if (!existing) {
      selected.set(eventId, {event, fingerprint, priority, sourceCategory});
      return;
    }
    if (existing.fingerprint === fingerprint) return;
    conflictEventCount += 1;
    if (priority > existing.priority) {
      selected.set(eventId, {
        event: mergeEventReferenceEvidence(existing.event, event),
        fingerprint,
        priority,
        sourceCategory,
      });
      return;
    }
    if (priority === existing.priority) {
      unresolvedConflictCount += 1;
      if (fingerprint < existing.fingerprint)
        selected.set(eventId, {event, fingerprint, priority, sourceCategory});
    }
  }

  for (const event of Array.isArray(currentFloorEvents) ? currentFloorEvents : []) {
    const sourceCategory = sameFloorVersion(event?.source, targetVersion)
      ? "current_floor_target_version"
      : "current_floor_resolved";
    consider(event, sourceCategory, sourceCategory === "current_floor_target_version" ? 3 : 2);
  }
  for (const event of Array.isArray(previousEvents) ? previousEvents : [])
    consider(event, "previous_resolved", 1);

  for (const {sourceCategory} of selected.values()) selectedSourceCounts[sourceCategory] += 1;
  return {
    events: [
      ...[...selected.values()].map(item => item.event),
      ...unkeyed,
    ],
    diagnostics: {
      input_total_count: inputTotalCount,
      unique_event_id_count: selected.size,
      conflict_event_id_count: conflictEventCount,
      selected_version_source_counts: selectedSourceCounts,
      unresolved_conflict_count: unresolvedConflictCount,
    },
  };
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
  const role = normalizeHostMessageRole(message);
  if (role === "user") return "user";
  if (role === "system") return "system";
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
function messageVersion(message) {
  return (
    scalar(
      message?.message_version ??
        message?.messageVersion ??
        message?.version,
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
function currentCharacterRegistryResolutionFromStates(states) {
  for (let index = states.length - 1; index >= 0; index -= 1) {
    const state = states[index];
    if (!sameFloorVersion(floorVersionFromData(state.floorData), state.version))
      continue;
    const snapshot = normalizedCharacterRegistrySnapshot(
      state.floorData.character_registry,
    );
    if (snapshot) return {registry: snapshot, state};
  }
  return {registry: normalizeCharacterRegistry(null), state: null};
}
function debugFloorSource(state, sourceType = "CURRENT_RESOLVED") {
  if (!state?.version) return null;
  return {
    source_type: sourceType,
    index: state.index ?? null,
    floor: state.version.floor ?? null,
    swipe_id: state.version.swipe_id ?? state.swipeId ?? null,
    floor_version: cloneValue(state.version),
  };
}
function debugEventSource(event, targetVersion) {
  const source = event?.source && typeof event.source === "object"
    ? cloneValue(event.source)
    : null;
  if (!source) return null;
  return {
    source_type: targetVersion && sameFloorVersion(source, targetVersion)
      ? "CURRENT_DERIVED"
      : "HISTORICAL_PERSISTED",
    floor: source.floor ?? null,
    swipe_id: source.swipe_id ?? null,
    floor_version: source,
  };
}
function isStateWithinTargetBoundary(index, version, target) {
  if (target === undefined || target === null) return true;
  if (!Number.isInteger(target.index) || !hasCompleteFloorVersion(target.version)) return false;
  if (!hasCompleteFloorVersion(version)) return false;
  if (String(version.chat_id) !== String(target.version.chat_id)) return false;
  if (index > target.index || Number(version.floor) > Number(target.version.floor)) return false;
  return index !== target.index || sameFloorVersion(version, target.version);
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
function domainValidationError(
  validation,
  message = "EVENT_DOMAIN_VALIDATION_FAILED",
  events = null,
) {
  const errors = Array.isArray(validation?.errors) ? validation.errors : [];
  const firstError = errors.find((error) => typeof error === "string") ?? null;
  const duplicateSubjectError = errors.find(
    (error) => typeof error === "string" && /^events\[\d+\]\.pregnancy_relevance\.gestational_subject_ids\[\d+\]$/u.test(error),
  ) ?? null;
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
  runtimeDiagnostics = null,
  enabledResolver = () => true,
  notify = () => {},
  floorPersistence = null,
  trackingWindowPersistence = null,
  healthAssessment = null,
  healthEvolution = null,
  healthRecoveryStabilityDelayMs = 2000,
  persistPregnancyLifecycleFacts = null,
  resolveLockedExposureState = null,
  getTrackingTimingInstances = null,
  getTrackingParticipantAggregations = null,
  getTrackingLifecycleTimeline = null,
} = {}) {
  if (!st || !chat || !store)
    throw new TypeError("EVENT_ANALYSIS_DEPENDENCIES_REQUIRED");
  const inFlight = new Map();
  const canonicalBuilds = new Map();
  // Completed canonical state is reusable only while the exact Floor
  // identity and canonical generation remain unchanged.  This is a
  // per-runtime read cache, not a second Floor source of truth.
  const completedCanonicalBuilds = new Map();
  const lastTerminal = new Map();
  let attemptSequence = 0;
  let analysisExecutionSequence = 0;
  let canonicalGeneration = 0;
  let registryRefreshChain = Promise.resolve();
  let lifecycleMutationChain = Promise.resolve();
  let destroyed = false;
  let removeChatBoundaryListener = null;
  const pendingHealthRecoveryChecks = new Map();
  let healthRecoveryScheduleRevision = 0;
  const sourceCache = analysisSourceCache ?? createWorldbookCache();
  let diagnostics;
  let trackingRefresh;
  let generationLifecycle;
  let generationAutomaticWorkDeferred = false;
  let projectionPostProcessor = null;
  let settledProjectionProcessor = null;
  const deferredProjectionPostProcesses = new Map();
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
    schedulerRevision: 0,
  };

  function canonicalBuildKey(target, analysisPhase = null) {
    return [
      floorExecutionKey(target?.version),
      canonicalGeneration,
      analysisPhase ?? "default",
    ].map(value => String(value ?? "")).join("\u001f");
  }

  function cloneCanonicalDerived(derived) {
    const trackingWindows = derived?.registry?.tracking_windows;
    const cloned = cloneValue(derived);
    // Tracking Runtime intentionally exposes this collection through a
    // non-enumerable getter. Reattach it after cloning so a cache copy keeps
    // the same business DTO shape as a freshly built registry.
    if (cloned?.registry && trackingWindows !== undefined) {
      Object.defineProperty(cloned.registry, "tracking_windows", {
        configurable: true,
        enumerable: false,
        value: cloneValue(trackingWindows),
        writable: false,
      });
    }
    return cloned;
  }

  function emitCanonicalBuildTrace(stage, target, details = {}) {
    emitPersistenceTrace(`CHARACTER_CANONICAL_BUILD_${stage}`, null, target, {
      canonical_generation: canonicalGeneration,
      ...details,
    }, "ui");
  }

  function advanceCanonicalGeneration(reason, target = null) {
    canonicalGeneration += 1;
    completedCanonicalBuilds.clear();
    emitCanonicalBuildTrace("INVALIDATED", target, {
      invalidation_reason: reason,
    });
    return canonicalGeneration;
  }

  // Health Assessment commits are wired directly to the shared persistence
  // coordinator by the Runtime composition. Expose the same invalidation
  // boundary so those confirmed writes cannot leave a completed canonical
  // read cache stale.
  function invalidateCanonicalDerivedReads(reason = "external-derived-commit", target = null) {
    return advanceCanonicalGeneration(reason, target);
  }

  function derivedPatchFields(owner) {
    switch (String(owner ?? "").toLowerCase()) {
      case "event":
        return ["analysis", "events", "character_registry"];
      case "terminal":
        return ["analysis"];
      case "world":
        return ["world_model", "world_model_meta"];
      case "health":
        return ["health_assessment_timeline"];
      default:
        return [];
    }
  }

  function patchChangesDerivedState(owner, before, after) {
    return derivedPatchFields(owner).some(field =>
      !sameDerivedValue(before?.[field], after?.[field]));
  }

  function cancelPendingHealthRecoveryChecks() {
    healthRecoveryScheduleRevision += 1;
    for (const pending of pendingHealthRecoveryChecks.values()) {
      clearTimeout(pending.timer);
    }
    pendingHealthRecoveryChecks.clear();
  }

  async function waitForHealthRecoveryStability({target, execution, token} = {}) {
    const delay = Number.isFinite(Number(healthRecoveryStabilityDelayMs))
      ? Math.max(0, Number(healthRecoveryStabilityDelayMs))
      : 2000;
    if (delay > 0) {
      await new Promise((resolve, reject) => {
        const signal = execution?.controller?.signal;
        let timer = setTimeout(done, delay);
        function cleanup() {
          clearTimeout(timer);
          signal?.removeEventListener("abort", aborted);
        }
        function done() {
          cleanup();
          resolve();
        }
        function aborted() {
          cleanup();
          reject(requestAbortedError());
        }
        if (signal?.aborted) {
          aborted();
          return;
        }
        signal?.addEventListener("abort", aborted, {once: true});
      });
    }
    await assertExecutionTargetCurrent(execution, target, token);
  }

  function scheduleHealthRecoveryCheck(target, { reason = "story-time-update" } = {}) {
    if (!target?.version || destroyed) return false;
    const key = floorExecutionKey(target.version);
    const previous = pendingHealthRecoveryChecks.get(key);
    if (previous) clearTimeout(previous.timer);
    const revision = ++healthRecoveryScheduleRevision;
    const delay = Number.isFinite(Number(healthRecoveryStabilityDelayMs))
      ? Math.max(0, Number(healthRecoveryStabilityDelayMs))
      : 2000;
    const timer = setTimeout(() => {
      pendingHealthRecoveryChecks.delete(key);
      void (async () => {
        if (destroyed || revision !== healthRecoveryScheduleRevision) return;
        const token = chat.token();
        try {
          const running = inFlight.get(key);
          if (running && !running.released) await running.promise;
          if (destroyed || revision !== healthRecoveryScheduleRevision) return;
          chat.assert(token);
          if (invalidatedFloors.has(key)) return;
          const current = await resolveFloorAtIndex({__messageIndex: true, index: target.index});
          if (!sameFloorVersion(current.version, target.version)) return;
          const currentData = store.getFloor?.(current.index, current.swipeId) ?? {};
          if (currentData.analysis?.status !== "success") return;
          const trackingInputs = await collectTrackingInputs(token);
          await expireRecoveredEvents({
            target: {...current, floorData: currentData},
            states: trackingInputs.states,
            activeState: trackingInputs.activeState,
            currentEvents: trackingInputs.activeEvents,
            currentStoryTime: trackingInputs.currentStoryTime,
            token,
          });
          emitPersistenceTrace("HEALTH_RECOVERY_CHECK_COMPLETED", null, current, {
            trigger: reason,
            delayed_ms: delay,
          }, "health");
        } catch (error) {
          if (!isStaleChat(error) && error?.code !== "REQUEST_ABORTED") {
            emitPersistenceTrace("HEALTH_RECOVERY_CHECK_SKIPPED", null, target, {
              trigger: reason,
              code: error?.code ?? error?.message ?? "HEALTH_RECOVERY_CHECK_FAILED",
            }, "health");
          }
        }
      })();
    }, delay);
    pendingHealthRecoveryChecks.set(key, {timer, revision});
    emitPersistenceTrace("HEALTH_RECOVERY_CHECK_SCHEDULED", null, target, {
      trigger: reason,
      delayed_ms: delay,
    }, "health");
    return true;
  }

  function createAnalysisExecutionId() {
    return `analysis-${chat.current() ?? "unknown"}-${++analysisExecutionSequence}`;
  }

  function analysisExecutionIdFor(generation = null) {
    const identity = generation?.analysis_execution_id ?? generation?.intent_id;
    return identity ? `analysis-${identity}` : createAnalysisExecutionId();
  }

  function versionChainSourceTextLength(target) {
    if (!target?.message) return null;
    return messageText(target.message, target.swipeId).length;
  }

  function emitVersionChain(boundary, {
    execution = null,
    target = null,
    version = null,
    sourceKind = null,
    analysisExecutionId = null,
    finalFloorIndex = null,
    finalFloorVersion = null,
    schedulerRevision = null,
  } = {}) {
    emitPersistenceTrace("VERSION_CHAIN", execution, target, buildVersionChainDiagnostic({
      boundary,
      source_kind: sourceKind,
      version: version ?? target?.version,
      message_index: target?.index ?? null,
      generation_id: execution?.generation_id ?? null,
      generation_intent_id: execution?.generation?.intent_id ?? null,
      generation_type: execution?.generation_type ?? execution?.generation?.generation_type ?? null,
      generation_ended: execution?.generation?.ended ?? null,
      generation_settled: execution?.generation?.settled ?? null,
      final_floor_index: finalFloorIndex ?? execution?.generation?.finalFloorIndex ?? null,
      final_floor_version: finalFloorVersion ?? execution?.generation?.finalFloorVersion ?? null,
      scheduler_revision: schedulerRevision ?? execution?.scheduler_revision ?? schedulerState.schedulerRevision,
      analysis_execution_id: analysisExecutionId ?? execution?.analysis_execution_id ?? null,
      source_text_length: version ? null : versionChainSourceTextLength(target),
    }));
  }

  function persistenceTraceContext(execution, target, domain) {
    return {
      domain,
      chat_id: target?.version?.chat_id ?? target?.chatId ?? chat.current(),
      active_chat_id: chat.current(),
      active_character_floor_message_id: target?.version?.message_id ?? null,
      active_swipe_id: target?.version?.swipe_id ?? target?.swipeId ?? 0,
      message_id: target?.version?.message_id ?? null,
      message_index: Number.isInteger(target?.index) ? target.index : null,
      floor: target?.version?.floor ?? null,
      swipe_id: target?.version?.swipe_id ?? target?.swipeId ?? 0,
      content_hash: target?.version?.content_hash ?? null,
      message_version: target?.version?.message_version ?? null,
      floor_version_key: target?.version ? floorExecutionKey(target.version) : null,
      attempt: execution?.attempt ?? null,
      execution_attempt: execution?.attempt ?? null,
      stage_attempt: execution?.stage_attempt ?? null,
      retry_index: execution?.retry_index ?? null,
      persistence_invocation_id: execution?.persistence_invocation_id ?? null,
      trigger: execution?.reason ?? null,
      generation_id: execution?.generation_id ?? null,
      generation_type: execution?.generation_type ?? null,
      generation_settled: execution?.generation_settled ?? null,
      analysis_execution_id: execution?.analysis_execution_id ?? null,
      run_id: execution?.pipeline_run_id ?? null,
      scheduler_revision: execution?.scheduler_revision ?? schedulerState.schedulerRevision,
      source_text_length: execution?.source_text_length ?? null,
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
    const before = store.getFloor?.(target?.index, target?.swipeId) ?? target?.floorData ?? {};
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
      patchResolver: input.patchResolver,
      operation_type: input.operation_type ?? `${owner}-patch`,
      execution: input.execution,
      execution_attempt: input.execution_attempt,
      stage_attempt: input.stage_attempt,
      retry_index: input.retry_index,
      traceContext,
      assertCurrent,
    }).then(result => {
      if (patchChangesDerivedState(owner, before, result?.floor))
        advanceCanonicalGeneration(`confirmed:${owner}:${input.operation_type ?? "patch"}`, target);
      return result;
    });
  }

  async function ensureCurrentProjectionFloorOwner({
    target: suppliedTarget = null,
    reason = "projection-internal",
    trigger = null,
  } = {}) {
    const target = suppliedTarget?.version && Number.isInteger(suppliedTarget.index)
      ? suppliedTarget
      : await resolveCurrentBioWeaveFloor();
    const token = chat.token();
    const current = await resolveFloorAtIndex({
      __messageIndex: true,
      index: target.index,
    });
    if (!sameFloorVersion(current.version, target.version)) {
      const error = new Error("FLOOR_VERSION_STALE");
      error.code = "FLOOR_VERSION_STALE";
      throw error;
    }
    const currentData = store.getFloor?.(current.index, current.swipeId) ?? {};
    const currentVersion = floorVersionFromData(currentData);
    const currentRegistry = normalizedCharacterRegistrySnapshot(currentData.character_registry);
    if (sameFloorVersion(currentVersion, current.version) &&
        hasCompleteEventState(currentData, current.version) &&
        currentRegistry) {
      emitPersistenceTrace("PROJECTION_FLOOR_OWNER_READY", null, current, {
        reason,
        trigger,
        source: "CURRENT_FLOOR",
        slot_present: true,
        floor_version_match: true,
      }, "projection");
      return {status: "existing", wrote: false, floor: currentData};
    }
    if (hasCompleteFloorVersion(currentVersion) &&
        !sameFloorVersion(currentVersion, current.version)) {
      const error = new Error("FLOOR_VERSION_STALE");
      error.code = "FLOOR_VERSION_STALE";
      throw error;
    }

    const inheritedState = await resolveCompleteEventStateAtOrBefore(current, {
      strictBefore: true,
    });
    const inheritedEvents = sortEvents(inheritedState?.events ?? []);
    const inheritedRegistry = normalizedCharacterRegistrySnapshot(
      inheritedState?.floorData?.character_registry,
    ) ?? normalizeCharacterRegistry(null);
    const inheritedPatch = {
      events: inheritedEvents,
      character_registry: inheritedRegistry,
    };
    const result = await commitFloorPatch(current, "event", null, {
      operation_type: "projection-internal-floor-owner-seed",
      patchResolver: ({latest}) => {
        const latestVersion = floorVersionFromData(latest);
        const latestRegistry = normalizedCharacterRegistrySnapshot(latest?.character_registry);
        if (sameFloorVersion(latestVersion, current.version) &&
            hasCompleteEventState(latest, current.version) && latestRegistry) {
          return {__floor_tx_noop: true};
        }
        if (hasCompleteFloorVersion(latestVersion) &&
            !sameFloorVersion(latestVersion, current.version)) {
          const error = new Error("FLOOR_VERSION_STALE");
          error.code = "FLOOR_VERSION_STALE";
          throw error;
        }
        return inheritedPatch;
      },
      assertCurrent: async () => {
        chat.assert(token);
        const latestTarget = await resolveFloorAtIndex({
          __messageIndex: true,
          index: current.index,
        });
        return sameFloorVersion(latestTarget.version, current.version);
      },
      traceContext: {
        persistence_kind: "projection_internal_floor_owner_seed",
        reason,
        trigger,
      },
    });
    chat.assert(token);
    emitPersistenceTrace("PROJECTION_FLOOR_OWNER_READY", null, current, {
      reason,
      trigger,
      source: result?.status === "noop" ? "CONCURRENT_CURRENT_FLOOR" : "INHERITED_EVENT_SNAPSHOT",
      slot_present: true,
      floor_version_match: true,
      commitState: result?.commitState ?? null,
    }, "projection");
    return {
      status: result?.status ?? "confirmed",
      wrote: result?.status !== "noop",
      floor: result?.floor ?? store.getFloor?.(current.index, current.swipeId) ?? null,
    };
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
    schedulerState.schedulerRevision += 1;
    schedulerState.counter = 0;
    schedulerState.retryPaused = false;
    schedulerState.countedFloorKeys.clear();
    schedulerState.observedFloorKeys.clear();
    generationLifecycle?.clear();
    schedulerState.lastFailure = null;
  }

  function getSchedulerState() {
    return {
      counter: schedulerState.counter,
      retryPaused: schedulerState.retryPaused,
      countedFloorKeys: [...schedulerState.countedFloorKeys],
      observedFloorKeys: [...schedulerState.observedFloorKeys],
      ...generationLifecycle.getState(),
      lastFailure: schedulerState.lastFailure
        ? { ...schedulerState.lastFailure }
        : null,
    };
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
    if (error?.format_retry_exhausted === true) return false;
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
    assertBeforeInvoke = null,
  }) {
    const failureDiagnostics = (error) => ({
      error_message: (() => {
        const code = typeof error?.diagnostic_code === "string"
          ? error.diagnostic_code
          : typeof error?.diagnosticCode === "string"
            ? error.diagnosticCode
            : typeof error?.code === "string"
              ? error.code
              : null;
        return code ? code.slice(0, 240) : null;
      })(),
      error_path: (() => {
        const path = typeof error?.path === "string"
          ? error.path
          : typeof error?.error_path === "string"
            ? error.error_path
            : typeof error?.diagnostic_path === "string"
              ? error.diagnostic_path
              : null;
        return path && /^[A-Za-z0-9_$.[\]-]+$/.test(path) ? path : null;
      })(),
      diagnostic_code: typeof error?.diagnostic_code === "string"
        ? error.diagnostic_code
        : typeof error?.diagnosticCode === "string"
          ? error.diagnosticCode
          : null,
      failure_code: (() => {
        const code = typeof error?.code === "string"
          ? error.code
          : typeof error?.error_code === "string"
            ? error.error_code
            : typeof error?.diagnostic_code === "string"
              ? error.diagnostic_code
              : typeof error?.diagnosticCode === "string"
                ? error.diagnosticCode
                : null;
        return code ?? null;
      })(),
      analysis_stage: typeof error?.analysis_stage === "string" ? error.analysis_stage : null,
      validation_stage: typeof error?.validation_stage === "string" ? error.validation_stage : null,
    });
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
    let previousError = null;
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
        if (typeof assertBeforeInvoke === "function")
          await assertBeforeInvoke();
        emitPersistenceTrace(`${domain.toUpperCase()}_AI_ATTEMPT_BEGIN`, execution, target, {
          domain,
          attempt,
          retry_index: retryIndex,
          max_retries: maxRetries,
          trigger,
        }, domain === "world" ? "world" : "analysis");
        const result = await invoke({ attempt, retryIndex, previousError });
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
        previousError = error;
        if (!aiSucceeded) {
          emitPersistenceTrace(`${domain.toUpperCase()}_AI_ATTEMPT_FAILED`, execution, target, {
            domain,
            attempt,
            retry_index: retryIndex,
            max_retries: maxRetries,
            failure_stage: error?.analysis_stage ?? domain,
            failure_code: failureDiagnostics(error).failure_code ?? "ANALYSIS_FAILED",
            ...failureDiagnostics(error),
          }, domain === "world" ? "world" : "analysis");
        }
        const retryable = await retryableStageFailure(error, { domain, target, execution, token });
        const formatRetry = error?.retry_kind === "format_retry" && error?.format_retry_exhausted !== true;
        const canRetry = formatRetry || (retryable && retryIndex < maxRetries);
        const failureStage = error?.analysis_stage ?? domain;
        const failureCode = failureDiagnostics(error).failure_code ?? "ANALYSIS_FAILED";
        emitPersistenceTrace(`${domain.toUpperCase()}_STAGE_ATTEMPT_FAILED`, execution, target, {
          domain,
          attempt,
          retry_index: retryIndex,
          max_retries: maxRetries,
          failure_stage: failureStage,
          failure_code: failureCode,
          ...failureDiagnostics(error),
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
              ...failureDiagnostics(error),
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
          ...failureDiagnostics(error),
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

  function applySchedulerLifecycleOutcome(outcome) {
    const versions = outcome?.non_countable_floor_versions;
    if (!Array.isArray(versions)) return outcome;
    for (const version of versions) {
      if (!version || version.chat_id == null || version.message_id == null ||
          version.content_hash == null || version.message_version == null) continue;
      rememberSchedulerKey(
        schedulerState.observedFloorKeys,
        floorExecutionKey(version),
      );
    }
    return outcome;
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
    schedulerState.countedFloorKeys.clear();
  }

  async function reconcileSchedulerState({
    target = null,
    excludeTarget = false,
    reason = "boundary",
  } = {}) {
    schedulerState.schedulerRevision += 1;
    const token = chat.token();
    const states = await collectCurrentFloorStates(token, {includeEmpty: true});
    chat.assert(token);
    const validStates = states
      .filter(state => !isFloorInvalidated(state))
      .sort((left, right) => left.index - right.index);
    const excludedKey = excludeTarget && target?.version
      ? floorExecutionKey(target.version)
      : null;
    const baseline = validStates
      .filter(state =>
        state.floorData?.analysis?.status === "success" &&
        persistedValidFloorState(state),
      )
      .at(-1) ?? null;
    const baselineIndex = baseline?.index ?? -1;
    const currentStates = validStates.filter(state =>
      !excludedKey || floorExecutionKey(state.version) !== excludedKey,
    );
    const countedStates = currentStates.filter(state => state.index > baselineIndex);
    const deferUnbaselinedExistingFloors =
      !baseline && (reason === "runtime-init" || reason === "chat-changed");
    const observedStates = deferUnbaselinedExistingFloors ? [] : currentStates;
    const rebasedCountedStates = deferUnbaselinedExistingFloors ? [] : countedStates;

    schedulerState.observedFloorKeys.clear();
    schedulerState.countedFloorKeys.clear();
    for (const state of observedStates)
      rememberSchedulerKey(schedulerState.observedFloorKeys, floorExecutionKey(state.version));
    for (const state of rebasedCountedStates)
      rememberSchedulerKey(schedulerState.countedFloorKeys, floorExecutionKey(state.version));

    const { interval } = schedulerSettings();
    const timelineCount = rebasedCountedStates.length;
    schedulerState.counter = schedulerState.lastFailure
      ? interval
      : Math.min(interval, timelineCount);
    return {
      reason,
      baseline: baseline
        ? {index: baseline.index, version: {...baseline.version}}
        : null,
      count: timelineCount,
      due: schedulerState.counter >= interval,
      interval,
      countedFloorKeys: [...schedulerState.countedFloorKeys],
      observedFloorKeys: [...schedulerState.observedFloorKeys],
    };
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
    if (event?.type === "CHARACTER_MESSAGE_RENDERED" &&
        ((requestedId !== undefined && requestedId !== null) || index !== null)) {
      const entries = currentSnapshot?.entries ?? [];
      const idMatches = requestedId === undefined || requestedId === null
        ? []
        : entries.filter(entry => String(entry.message_id) === String(requestedId));
      const idIndex = idMatches.length === 1 ? entries.indexOf(idMatches[0]) : null;
      if (requestedId !== undefined && requestedId !== null &&
          (idIndex === null || (index !== null && index !== idIndex))) return -1;
      const explicitIndex = idIndex ?? index;
      const explicitEntry = Number.isInteger(explicitIndex) && explicitIndex >= 0
        ? entries[explicitIndex]
        : null;
      if (explicitEntry?.role === "assistant") return explicitIndex;
      return -1;
    }
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
    {
      preserveTarget = false,
      clearRoots = true,
      currentSnapshot = null,
      mutationScope = "downstream-destructive",
    } = {},
  ) {
    cancelPendingHealthRecoveryChecks();
    const targetLocalMutation = mutationScope === "target-local";
    const affectedExecutions = invalidateInFlightExecutions({
      fromIndex: targetLocalMutation ? null : targetIndex,
      exactIndex: targetLocalMutation ? targetIndex : null,
      currentSnapshot,
      reason: `mutation:${event?.type ?? "unknown"}`,
    });
    if (affectedExecutions > 0 && typeof chat.invalidate === "function")
      chat.invalidate(`mutation:${event?.type ?? "unknown"}`, { checkCurrent: false });
    lastTerminal.clear();
    invalidatedFloors.clear();
    clearWorldbookCache(sourceCache);
    const token = chat.token();
    if (!clearRoots || targetLocalMutation) return chat.token();
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
        advanceCanonicalGeneration(`confirmed:floor-clear:${event?.type ?? "unknown"}`);
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
        // A stored Floor Version is historical state, not a revision source
        // for the current message. Only an explicit host revision may bind
        // message_version; otherwise floorVersion derives the v1 hash from
        // the current active-Swipe content.
        messageVersion: messageVersion(message),
      });
    } catch (error) {
      throw withAnalysisStage(error, "floor_version");
    }
    return { index, message, swipeId, floorData, version, chatId };
  }
  async function resolveCharacterRegistryAtOrBefore(target, {strictBefore = false} = {}) {
    if (!target?.version || !Number.isInteger(target.index)) return null;
    const endIndex = target.index - (strictBefore ? 1 : 0);
    for (let index = endIndex; index >= 0; index -= 1) {
      if (!isCharacterMessage(messages()[index])) continue;
      const swipeId = store.getActiveSwipeId?.(index);
      if (swipeId === null || swipeId === undefined) continue;
      let candidate;
      try {
        candidate = await resolveFloorAtIndex({__messageIndex: true, index});
      } catch {
        continue;
      }
      if (candidate.version.floor > target.version.floor) continue;
      if (!strictBefore && index === target.index &&
          !sameFloorVersion(candidate.version, target.version)) continue;
      if (isFloorInvalidated(candidate)) continue;
      const floorData = store.getFloor?.(index, swipeId) ?? candidate.floorData;
      if (!sameFloorVersion(floorVersionFromData(floorData), candidate.version)) continue;
      const characterRegistry = normalizedCharacterRegistrySnapshot(
        floorData?.character_registry,
      );
      if (!characterRegistry) continue;
      return {
        index,
        swipeId,
        floorData,
        version: candidate.version,
        character_registry: characterRegistry,
      };
    }
    return null;
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
    const resolved = await resolveCharacterRegistryAtOrBefore(target);
    chat.assert(token);
    const registry = resolved?.character_registry ?? normalizeCharacterRegistry(null);
    const id = typeof characterId === "string" ? characterId.trim() : "";
    const entry = id ? registry.entities[id] : null;
    if (!entry) throw new Error("CHARACTER_ID_NOT_FOUND");
    return cloneValue(entry);
  }

  async function updateCharacterAliases({ character_id: characterId, aliases } = {}) {
    const token = chat.token();
    const target = await resolveCurrentBioWeaveFloor();
    chat.assert(token);
    const resolved = await resolveCharacterRegistryAtOrBefore(target);
    chat.assert(token);
    const registry = resolved?.character_registry ?? normalizeCharacterRegistry(null);
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
    const currentAliases = registry.entities[String(characterId).trim()].aliases ?? [];
    if (JSON.stringify(currentAliases) === JSON.stringify(validation.aliases)) {
      return {
        ok: true,
        changed: false,
        character: cloneValue(registry.entities[String(characterId).trim()]),
      };
    }
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
  async function resolveCompleteEventStateAtOrBefore(target, {strictBefore = false} = {}) {
    // A complete Event state is authoritative for its slot. Missing analysis
    // means "no state here"; a successful analysis with events=[] is an
    // explicit empty state and therefore stops the search.
    const endIndex = target.index - (strictBefore ? 1 : 0);
    for (let index = endIndex; index >= 0; index -= 1) {
      if (!isCharacterMessage(messages()[index])) continue;
      const swipeId = store.getActiveSwipeId?.(index);
      if (swipeId === null || swipeId === undefined) continue;
      const floorData = store.getFloor?.(index, swipeId);
      const candidate = await resolveFloorAtIndex({ __messageIndex: true, index });
      if (candidate.version.floor > target.version.floor ||
          (strictBefore && candidate.version.floor >= target.version.floor)) continue;
      if (isFloorInvalidated(candidate)) continue;
      if (!sameFloorVersion(floorVersionFromData(floorData), candidate.version))
        continue;
      if (!hasCompleteEventState(floorData, candidate.version)) continue;
      return {
        index,
        swipeId,
        floorData,
        version: candidate.version,
        events: store.getActiveFloorEvents?.(index, candidate.version) ?? [],
      };
    }
    return null;
  }

  async function resolveHealthAssessmentTimelineAtOrBefore(target, {strictBefore = true} = {}) {
    if (!target?.version || !Number.isInteger(target.index)) return null;
    const endIndex = target.index - (strictBefore ? 1 : 0);
    for (let index = endIndex; index >= 0; index -= 1) {
      if (!isCharacterMessage(messages()[index])) continue;
      const swipeId = store.getActiveSwipeId?.(index);
      if (swipeId === null || swipeId === undefined) continue;
      let candidate;
      try {
        candidate = await resolveFloorAtIndex({__messageIndex: true, index});
      } catch {
        continue;
      }
      if (candidate.version.floor > target.version.floor || isFloorInvalidated(candidate)) continue;
      const floorData = store.getFloor?.(index, swipeId) ?? candidate.floorData;
      if (!sameFloorVersion(floorVersionFromData(floorData), candidate.version)) continue;
      const timeline = normalizeHealthAssessmentTimeline(floorData?.health_assessment_timeline);
      if (timeline.assessments.length) return timeline;
    }
    return null;
  }

  async function syncHealthRecoverySnapshot({target: suppliedTarget = null, force = false, reason = 'health-snapshot'} = {}) {
    if (typeof healthAssessment?.syncFloorSnapshot !== 'function')
      return {status: 'unsupported'};
    let target = suppliedTarget;
    try {
      target = target?.version && Number.isInteger(target.index)
        ? target
        : await resolveCurrentBioWeaveFloor();
      if (!target?.version) return {status: 'unavailable'};
      const authoritative = await resolveFloorAtIndex({
        __messageIndex: true,
        index: target.index,
      });
      if (!sameFloorVersion(authoritative.version, target.version) ||
          authoritative.swipeId !== target.swipeId) {
        emitPersistenceTrace('HEALTH_ASSESSMENT_SNAPSHOT_SYNC_FAILED', null, target, {
          reason,
          code: 'FLOOR_VERSION_STALE',
        }, 'health');
        return {status: 'stale', code: 'FLOOR_VERSION_STALE'};
      }
      const token = chat.token();
      const floorData = store.getFloor?.(target.index, target.swipeId) ?? target.floorData ?? {};
      // A Projection owner seed deliberately does not fabricate
      // analysis.status=success. For this snapshot boundary, a version-valid
      // Event collection is the required input; Health Assessment performs
      // the source-event validity checks itself.
      const hasCurrentEventCollection = sameFloorVersion(
        floorVersionFromData(floorData),
        target.version,
      ) && Array.isArray(floorData.events);
      if (!hasCurrentEventCollection) {
        emitPersistenceTrace('HEALTH_ASSESSMENT_SNAPSHOT_DEFERRED', null, target, {
          reason,
          floor_state: 'incomplete_event_state',
        }, 'health');
        return {status: 'deferred', reason: 'incomplete_event_state'};
      }
      const storyTimeInfo = storyTimeCoordinator
        ? typeof storyTimeCoordinator.resolveFloorStoryTimeInfo === "function"
          ? await storyTimeCoordinator.resolveFloorStoryTimeInfo(target)
          : {story_time: await storyTimeCoordinator.resolveFloorStoryTime(target)}
        : {story_time: null};
      const result = await healthAssessment.syncFloorSnapshot({
        target,
        token,
        events: Array.isArray(floorData.events) ? floorData.events : [],
        currentStoryTime: storyTimeInfo.story_time,
        force,
        reason,
      });
      emitPersistenceTrace('HEALTH_ASSESSMENT_SNAPSHOT_SYNCED', null, target, {
        reason,
        status: result?.status ?? null,
        copied: result?.copied === true,
        assessment_count: result?.timeline?.assessments?.length ?? null,
      }, 'health');
      return result;
    } catch (error) {
      emitPersistenceTrace('HEALTH_ASSESSMENT_SNAPSHOT_SYNC_FAILED', null, target, {
        reason,
        code: error?.code ?? error?.message ?? 'HEALTH_ASSESSMENT_SNAPSHOT_FAILED',
      }, 'health');
      return {status: 'failed', code: error?.code ?? error?.message ?? 'HEALTH_ASSESSMENT_SNAPSHOT_FAILED'};
    }
  }

  async function findPreviousSuccessfulBioWeave(target) {
    let boundary = target;
    while (boundary) {
      const state = await resolveCompleteEventStateAtOrBefore(boundary, {strictBefore: true});
      if (!state) break;
      const {floorData, events} = state;
      const characterRegistry = normalizedCharacterRegistrySnapshot(
        floorData.character_registry,
      );
      if (characterRegistry) {
        return {
          analysis: floorData.analysis,
          events,
          character_registry: characterRegistry,
        };
      }
      boundary = {...target, index: state.index, version: state.version};
    }
    return {
      analysis: null,
      events: [],
      character_registry: normalizeCharacterRegistry(null),
    };
  }

  async function collectCurrentFloorStates(token = chat.token(), {
    includeEmpty = false,
    target = undefined,
    validOnly = false,
  } = {}) {
    const states = [];
    let floorVersionCallCount = 0;
    let floorVersionWallMs = 0;
    const all = messages();
    for (let index = 0; index < all.length; index += 1) {
      if (target && Number.isInteger(target.index) && index > target.index) continue;
      if (!isCharacterMessage(all[index])) continue;
      const swipeId = store.getActiveSwipeId?.(index);
      if (swipeId === null || swipeId === undefined) continue;
      const floorData = store.getFloor?.(index, swipeId);
      if (!floorData && !includeEmpty) continue;
      const storedVersion = floorVersionFromData(floorData);
      let version;
      try {
        const floorVersionStartedAt = monotonicNow();
        floorVersionCallCount += 1;
        version = await floorVersion({
          chatId: token.chatId,
          messageId: messageId(all[index], index, storedVersion),
          floor: messageFloor(all[index], index, storedVersion),
          swipeId,
          text: messageText(all[index], swipeId),
          // Do not revive a historical stored revision after an edit. An
          // explicit host message_version remains authoritative.
          messageVersion: messageVersion(all[index]),
        });
        floorVersionWallMs += durationMs(floorVersionStartedAt) ?? 0;
      } catch (error) {
        throw withAnalysisStage(error, "floor_version");
      }
      chat.assert(token);
      if (!isStateWithinTargetBoundary(index, version, target)) continue;
      const state = {
        index,
        message: all[index],
        swipeId,
        floorData: floorData ?? {},
        version,
        events: store.getActiveFloorEvents?.(index, version) ?? [],
      };
      if (validOnly && isFloorInvalidated(state)) continue;
      states.push(state);
    }
    Object.defineProperty(states, "__timing", {
      enumerable: false,
      value: {
        floor_version_call_count: floorVersionCallCount,
        floor_version_wall_ms: Number(floorVersionWallMs.toFixed(3)),
      },
    });
    return states;
  }
  async function resolveTrackingTimingInstances(current) {
    if (!current?.version || typeof getTrackingTimingInstances !== 'function') return [];
    try {
      const result = await getTrackingTimingInstances({
        chatId: current.version.chat_id,
        endpointFloor: current.version.floor,
        endpointIndex: current.index,
        floor: current,
      });
      return Array.isArray(result?.items) ? result.items : Array.isArray(result) ? result : [];
    } catch {
      return [];
    }
  }
  async function resolveTrackingAggregationState(current) {
    if (!current?.version) return {participantAggregations: [], lifecycleReleaseRecords: []};
    const read = async (reader, payload) => {
      if (typeof reader !== 'function') return null;
      try {
        return await reader(payload);
      } catch {
        return null;
      }
    };
    const [aggregationResult, lifecycleResult] = await Promise.all([
      read(getTrackingParticipantAggregations, {
        chatId: current.version.chat_id,
        endpointFloor: current.version.floor,
        endpointIndex: current.index,
        floor: current,
      }),
      read(getTrackingLifecycleTimeline, {
        chatId: current.version.chat_id,
        endpointFloor: current.version.floor,
        endpointIndex: current.index,
        floor: current,
      }),
    ]);
    return {
      participantAggregations: Array.isArray(aggregationResult?.items)
        ? aggregationResult.items
        : Array.isArray(aggregationResult) ? aggregationResult : [],
      lifecycleReleaseRecords: Array.isArray(lifecycleResult?.release_records)
        ? lifecycleResult.release_records
        : [],
    };
  }

  async function collectTrackingInputs(token = chat.token(), {
    target = undefined,
    currentEventState = undefined,
    currentEventStateVersion = undefined,
  } = {}) {
    const boundedTarget = target?.version && Number.isInteger(target.index)
      ? target
      : undefined;
    const trackingInputsStartedAt = monotonicNow();
    const states = await collectCurrentFloorStates(token, {target: boundedTarget});
    const floorStateTiming = states.__timing ?? {};
    const validStates = states.filter(
      (state) => !isFloorInvalidated(state),
    );
    let activeEvents = [];
    let activeState = null;
    let current = null;
    try {
      current = target === undefined ? await resolveCurrentBioWeaveFloor() : target;
      if (current) {
        const reusableEventState = currentEventStateVersion &&
          sameFloorVersion(currentEventStateVersion, current.version)
          ? currentEventState
          : undefined;
        activeState = reusableEventState === undefined
          ? await resolveCompleteEventStateAtOrBefore(current)
          : reusableEventState;
        activeEvents = sortEvents(activeState?.events ?? []);
      }
    } catch (error) {
      if (![
        "NO_CHARACTER_FLOOR",
        "MESSAGE_NOT_FOUND",
        "SWIPE_NOT_FOUND",
      ].includes(error?.message))
        throw error;
    }
    let world = null;
    try {
      const current = target === undefined ? undefined : target;
      world = current === null
        ? null
        : await resolveWorldModelAtOrBefore(current);
    } catch {
      // An empty Chat has no target Floor and therefore no World Model.
    }
    const characterRegistryResolution = currentCharacterRegistryResolutionFromStates(validStates);
    const timingInstances = await resolveTrackingTimingInstances(current);
    const trackingAggregationState = await resolveTrackingAggregationState(current);
    const storyTimeStartedAt = monotonicNow();
    const storyTimeTarget = current ?? target ?? validStates.at(-1) ?? null;
    const currentStoryTimeInfo = storyTimeCoordinator && storyTimeTarget
      ? typeof storyTimeCoordinator.resolveFloorStoryTimeInfo === "function"
        ? await storyTimeCoordinator.resolveFloorStoryTimeInfo(storyTimeTarget)
        : {floor: storyTimeTarget, story_time: await storyTimeCoordinator.resolveFloorStoryTime(storyTimeTarget), status: "ready"}
      : {floor: null, story_time: normalizeStoryTime(null), status: "NO_CHARACTER_FLOOR"};
    const currentStoryTime = currentStoryTimeInfo?.story_time ?? normalizeStoryTime(null);
    return {
      states: validStates,
      activeEvents,
      activeState,
      worldModel: world?.model ?? null,
      worldState: world,
      currentFloor: current,
      floorVersion: current?.version ?? null,
      characterRegistry: characterRegistryResolution.registry,
      characterRegistryState: characterRegistryResolution.state,
      ...trackingAggregationState,
      timingInstances,
      currentStoryTime,
      currentStoryTimeInfo,
      subjectProfiles: Object.fromEntries(activeEvents.flatMap(event => (event.participants ?? []).map(participant => [
        participant.character_id,
        {
          species: participant.biological_context?.species ?? null,
          biological_type: participant.biological_context?.biological_type ?? null,
        },
      ]))),
      diagnostics: {
        tracking_inputs_wall_ms: durationMs(trackingInputsStartedAt),
        floor_version_call_count: floorStateTiming.floor_version_call_count ?? 0,
        floor_version_wall_ms: floorStateTiming.floor_version_wall_ms ?? 0,
        story_time_wall_ms: durationMs(storyTimeStartedAt),
      },
    };
  }
  async function collectActiveEvents(token = chat.token()) {
    const current = await resolveCurrentBioWeaveFloor();
    const state = await resolveCompleteEventStateAtOrBefore(current);
    return sortEvents(state?.events ?? []);
  }

  async function getParticipantAggregationInputs({subjectId, mechanismKey, target = null} = {}) {
    const token = chat.token();
    const current = target ?? await resolveCurrentBioWeaveFloor();
    if (!current?.version || String(current.version.chat_id) !== String(token.chatId)) {
      const error = new Error("NO_CHARACTER_FLOOR");
      error.code = "NO_CHARACTER_FLOOR";
      throw error;
    }
    const eventState = await resolveCompleteEventStateAtOrBefore(current);
    const activeEvents = sortEvents(eventState?.events ?? []);
    const world = await resolveWorldModelAtOrBefore(current);
    const currentStoryTimeInfo = storyTimeCoordinator?.resolveFloorStoryTimeInfo
      ? await storyTimeCoordinator.resolveFloorStoryTimeInfo(current)
      : {floor: current, story_time: normalizeStoryTime(null), status: "NO_STORY_TIME_COORDINATOR"};
    const currentStoryTime = currentStoryTimeInfo?.story_time ?? normalizeStoryTime(null);
    const timingInstances = await resolveTrackingTimingInstances(current);
    const trackingAggregationState = await resolveTrackingAggregationState(current);
    const subjectProfiles = Object.fromEntries(activeEvents.flatMap(event => (event.participants ?? []).map(participant => [
      participant.character_id,
      {
        species: participant.biological_context?.species ?? null,
        biological_type: participant.biological_context?.biological_type ?? null,
      },
    ])));
    const trackingWindows = trackingRuntime.buildTrackingWindows({
      activeEvents,
      chatId: token.chatId,
      worldModel: world?.model ?? {},
      currentStoryTime,
      floorVersion: current.version,
      subjectProfiles,
      ...trackingAggregationState,
      timingInstances,
    }).filter(window => window?.subject_id === subjectId
      && (!mechanismKey || window?.mechanism_key === mechanismKey));
    const relevantEvents = activeEvents.filter(event => {
      try {
        return isPregnancyRelevantExposure(event)
          && event?.pregnancy_relevance?.gestational_subject_ids?.includes(subjectId)
          && (!mechanismKey || event?.pregnancy_relevance?.reproductive_mechanism?.kind === mechanismKey);
      } catch {
        return false;
      }
    });
    chat.assert(token);
    return {
      active_events: relevantEvents,
      tracking_windows: trackingWindows,
      current_story_time: currentStoryTime,
      floor_version: current.version,
    };
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

  function sameEventCollection(left, right) {
    return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
  }

  async function expireRecoveredEvents({
    target,
    states = [],
    activeState = null,
    currentEvents = [],
    currentStoryTime = null,
    token,
    protectedEventIds = [],
  } = {}) {
    if (!target || !healthEvolution?.findExpiredEventIds || !Array.isArray(currentEvents)) {
      return {events: currentEvents, expiredEventIds: [], floorData: target?.floorData ?? null};
    }
    const expiredEventIds = healthEvolution.findExpiredEventIds({
      states,
      currentEvents,
      currentStoryTime,
      protectedEventIds,
    });
    if (!expiredEventIds.length) {
      return {events: currentEvents, expiredEventIds: [], floorData: target.floorData ?? null};
    }

    const expired = new Set(expiredEventIds);
    const nextEvents = currentEvents.filter(event => !expired.has(event?.event_id));
    const currentFloorData = store.getFloor?.(target.index, target.swipeId) ?? target.floorData ?? {};
    const priorAnalysis = currentFloorData.analysis ?? activeState?.floorData?.analysis ?? null;
    const analyzedAt = new Date().toISOString();
    const analysis = commitAnalysis(priorAnalysis, {
      status: "success",
      analyzed_at: analyzedAt,
      last_analyzed_at: analyzedAt,
      finished_at: analyzedAt,
      event_count: nextEvents.length,
      reason: "health-recovery-expiration",
    }, target.version);
    analysis.source_provenance = {...target.version};
    const characterRegistry = normalizeCharacterRegistry(
      currentFloorData.character_registry ?? activeState?.floorData?.character_registry,
    );
    const expectedBefore = Array.isArray(currentFloorData.events)
      ? currentFloorData.events
      : currentEvents;

    const assertCurrent = async () => {
      chat.assert(token);
      const current = await resolveFloorAtIndex({__messageIndex: true, index: target.index});
      if (!sameFloorVersion(current.version, target.version)) return false;
      const latest = store.getFloor?.(target.index, target.swipeId) ?? {};
      const latestEvents = Array.isArray(latest.events) ? latest.events : expectedBefore;
      return sameEventCollection(latestEvents, expectedBefore) ||
        sameEventCollection(latestEvents, nextEvents);
    };

    let result;
    try {
      result = await commitFloorPatch(target, "event", {
        analysis,
        events: nextEvents,
        character_registry: characterRegistry,
      }, {
        operation_type: "health-recovery-expiration",
        assertCurrent,
      });
    } catch (error) {
      if (["FLOOR_TX_SUPERSEDED", "FLOOR_TX_STALE_VERSION", "FLOOR_TX_STALE_SWIPE"].includes(error?.code)) {
        const latest = store.getFloor?.(target.index, target.swipeId) ?? null;
        return {
          events: Array.isArray(latest?.events) ? latest.events : currentEvents,
          expiredEventIds: [],
          floorData: latest,
        };
      }
      throw error;
    }
    chat.assert(token);
    await syncHealthRecoverySnapshot({
      target,
      force: true,
      reason: 'health-recovery-expiration',
    });
    return {
      events: nextEvents,
      expiredEventIds,
      floorData: result?.floor ?? store.getFloor?.(target.index, target.swipeId) ?? null,
    };
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
      .filter((state) =>
        state.index <= currentFloor.index &&
        state.version.floor <= currentFloor.version.floor,
      )
      .sort((left, right) => right.index - left.index);
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
  async function collectCurrentDerivedState(token, chatData = null, {
    target = undefined,
    currentEventState = undefined,
    currentEventStateVersion = undefined,
  } = {}) {
    const canonicalStartedAt = monotonicNow();
    const trackingInputs = await collectTrackingInputs(token, {
      target,
      currentEventState,
      currentEventStateVersion,
    });
    const currentChat = chatData ?? store.getChat(token.chatId);
    let validStates = trackingInputs.states;
    let activeEvents = trackingInputs.activeEvents;
    let characterRegistry = trackingInputs.characterRegistry;
    let currentFloor = trackingInputs.currentFloor ?? target;
    if (target === undefined && !currentFloor) {
      try {
        currentFloor = await resolveCurrentBioWeaveFloor();
      } catch (error) {
        if (error?.message !== "NO_CHARACTER_FLOOR" && error?.message !== "MESSAGE_NOT_FOUND") throw error;
      }
    }
    const storyTimeInfo = trackingInputs.currentStoryTimeInfo ?? (target === null
      ? {story_time: normalizeStoryTime(null), status: "NO_CHARACTER_FLOOR"}
      : {story_time: normalizeStoryTime(null), status: "NO_STORY_TIME_INFO"});
    const currentStoryTime = storyTimeInfo.story_time;
    const registryStartedAt = monotonicNow();
    const registry = trackingRuntime.buildTrackingRegistry({
      ...trackingInputs,
      states: validStates,
      activeEvents,
      characterRegistry,
      chatId: token.chatId,
    });
    const trackingRegistrySyncMs = durationMs(registryStartedAt);
    const characterFactsStartedAt = monotonicNow();
    const characterFacts = buildCharacterFacts(
      activeEvents,
      registry,
      characterRegistry,
    );
    const characterFactsSyncMs = durationMs(characterFactsStartedAt);
    const healthStartedAt = monotonicNow();
    const currentHealthState = healthEvolution?.deriveFromFloorStates
      ? healthEvolution.deriveFromFloorStates({
          states: validStates,
          currentEvents: activeEvents,
          currentStoryTime,
        })
      : {schema_version: 1, characters: {}};
    const healthDeriveSyncMs = durationMs(healthStartedAt);
    let currentState;
    let currentStateStatus = currentFloor ? "ready" : "NO_CHARACTER_FLOOR";
    const reduceStartedAt = monotonicNow();
    try {
      // floor.events is already the complete current Event state. Replaying
      // every later Floor on top of a Snapshot would apply unchanged Events
      // more than once, so Snapshot remains a checkpoint artifact but is not
      // an Event replay source for this model.
      currentState = reduceState({
        events: activeEvents,
        currentStoryTime,
        characterFacts,
      });
    } catch (error) {
      currentState = stateErrorState(error);
      currentStateStatus = "STATE_ERROR";
    }
    const reduceStateSyncMs = durationMs(reduceStartedAt);
    emitPersistenceTrace("CHARACTER_CANONICAL_PHASES", null, currentFloor, {
      canonical_build_wall_ms: durationMs(canonicalStartedAt),
      tracking_inputs_wall_ms: trackingInputs.diagnostics?.tracking_inputs_wall_ms ?? null,
      floor_version_call_count: trackingInputs.diagnostics?.floor_version_call_count ?? 0,
      floor_version_wall_ms: trackingInputs.diagnostics?.floor_version_wall_ms ?? 0,
      story_time_wall_ms: trackingInputs.diagnostics?.story_time_wall_ms ?? null,
      tracking_registry_sync_ms: trackingRegistrySyncMs,
      character_facts_sync_ms: characterFactsSyncMs,
      health_derive_sync_ms: healthDeriveSyncMs,
      reduce_state_sync_ms: reduceStateSyncMs,
    }, "ui");
    chat.assert(token);
    return {
      states: validStates,
      activeEvents,
      registry,
      characterRegistry,
      characterFacts,
      eventState: trackingInputs.activeState,
      worldState: trackingInputs.worldState,
      characterRegistryState: trackingInputs.characterRegistryState,
      subjectProfiles: trackingInputs.subjectProfiles,
      currentFloor,
      currentStoryTime,
      currentStoryTimeInfo: storyTimeInfo,
      currentStoryTimeStatus: storyTimeInfo.status,
      currentStoryTimeDifferences: currentStoryTimeDifferences(activeEvents, currentStoryTime),
      currentState,
      currentStateStatus,
      currentHealthState,
      chatData: currentChat,
    };
  }

  async function collectCanonicalDerivedState(token, chatData, {
    target,
    currentEventState,
    currentEventStateVersion,
    analysisPhase = null,
    useCompletedCache = true,
  } = {}) {
    const key = canonicalBuildKey(target, analysisPhase);
    const existing = canonicalBuilds.get(key);
    if (existing) {
      const joinedAt = monotonicNow();
      emitCanonicalBuildTrace("JOINED_EXISTING", target, {
        join_wait_ms: null,
      });
      try {
        const derived = await existing.promise;
        emitCanonicalBuildTrace("JOIN_COMPLETED", target, {
          join_wait_ms: durationMs(joinedAt),
        });
        return {derived, joined: true};
      } catch (error) {
        emitCanonicalBuildTrace("JOIN_FAILED", target, {
          join_wait_ms: durationMs(joinedAt),
          error_code: error?.code ?? error?.message ?? "CANONICAL_BUILD_FAILED",
        });
        throw error;
      }
    }
    const completed = useCompletedCache && hasCompleteFloorVersion(target?.version)
      ? completedCanonicalBuilds.get(key)
      : null;
    if (completed) {
      emitCanonicalBuildTrace("CACHE_HIT", target, {
        cache_scope: "same-floor-version-and-canonical-generation",
      });
      const derived = cloneCanonicalDerived(completed.derived);
      // Chat-local settings are consumed while building the DTO. Keep that
      // small input current without rebuilding Floor-derived state.
      derived.chatData = chatData;
      derived.currentFloor = target;
      // Preserve the normal Floor/Chat stale window on cache hits. This is a
      // local story-time read (normally served by the coordinator cache), not
      // a second canonical rebuild; the final target assertion below remains
      // authoritative for Chat/Floor/Swipe changes.
      if (typeof storyTimeCoordinator?.resolveFloorStoryTime === "function")
        await storyTimeCoordinator.resolveFloorStoryTime(target);
      chat.assert(token);
      return {derived, joined: false};
    }

    const entry = {
      key,
      startedAt: monotonicNow(),
      promise: null,
    };
    emitCanonicalBuildTrace("STARTED", target);
    entry.promise = (async () => {
      try {
        const derived = await collectCurrentDerivedState(token, chatData, {
          target,
          currentEventState,
          currentEventStateVersion,
        });
        if (
          useCompletedCache
          && hasCompleteFloorVersion(target?.version)
          && derived?.currentStateStatus !== "STATE_ERROR"
        ) {
          completedCanonicalBuilds.set(key, {derived: cloneCanonicalDerived(derived)});
        }
        emitCanonicalBuildTrace("COMPLETED", target, {
          build_duration_ms: durationMs(entry.startedAt),
        });
        return derived;
      } catch (error) {
        emitCanonicalBuildTrace("FAILED", target, {
          build_duration_ms: durationMs(entry.startedAt),
          error_code: error?.code ?? error?.message ?? "CANONICAL_BUILD_FAILED",
        });
        throw error;
      } finally {
        if (canonicalBuilds.get(key) === entry)
          canonicalBuilds.delete(key);
      }
    })();
    canonicalBuilds.set(key, entry);
    return {derived: await entry.promise, joined: false};
  }
  const featureComposition = createRuntimeComposition({
    diagnostics: runtimeDiagnostics,
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
      isSettledTargetCurrent: async (pending, target) => {
        if (!pending || !target || pending.chatId !== chat.current()) return false;
        try {
          const current = await resolveFloorAtIndex({
            __messageIndex: true,
            index: target.index,
          });
          return current.swipeId === target.swipeId &&
            sameFloorVersion(current.version, target.version);
        } catch {
          return false;
        }
      },
      onGenerationSettled: (target, options) =>
        generationAutomaticWorkDeferred
          ? {
              skipped: true,
              reason: "generation-post-processing-deferred",
              target,
              generation: options?.generation ?? null,
            }
          : handoffSettledCharacterFloor(target, {
              ...options,
              lifecycleOutcome: {status: "generation-settled"},
            }),
    },
    tracking: {
      collectTrackingInputs,
      isEnabled,
      hasMessageCollection: () => Boolean(messageCollection()),
      getToken: () => chat.token(),
      assertToken: token => chat.assert(token),
      notify,
      ...(trackingWindowPersistence ? {
        trackingWindowRuntime: createTrackingWindowRuntime({
          getChatId: () => chat.current(),
          getPersisted: async ({chatId}) => (await trackingWindowPersistence.getTrackingWindowTimeline({chatId})).creations,
          persist: async ({chatId, windows, assertCurrent}) => {
            const target = await resolveCurrentBioWeaveFloor();
            if (typeof assertCurrent === "function") await assertCurrent();
            await trackingWindowPersistence.saveTrackingWindowTimeline({
              chatId,
              ownerFloor: {message_index: target.index, message_id: target.version.message_id},
              floorVersion: target.version,
            timeline: {schema_version: 1, creations: windows, lifecycle_records: windows.filter(window => window.status === 'expired').map(window => ({tracking_window_id: window.tracking_window_id, action: 'expired', reason: window.terminal_reason, terminal_story_time: window.terminal_story_time, terminal_at_floor_version: window.terminal_at_floor_version}))},
            });
            if (typeof assertCurrent === "function") await assertCurrent();
          },
        }),
      } : {}),
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
      resolveCharacterRegistryAtOrBefore,
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
      healthAssessment,
      healthEvolution,
      persistPregnancyLifecycleFacts,
      resolveLockedExposureState,
      getCurrentStoryTime: async target => {
        const current = await resolveCurrentBioWeaveFloor();
        if (!sameFloorVersion(current?.version, target?.version)) return null;
        return storyTimeCoordinator.resolveFloorStoryTime(target);
      },
      waitForHealthRecoveryStability,
    },
    eventEditing: {
      resolveCurrentEventState: async () => {
        const target = await resolveCurrentBioWeaveFloor();
        const state = await resolveCompleteEventStateAtOrBefore(target);
        return {
          ...target,
          events: state?.events ?? [],
          inheritedAnalysis: state?.floorData?.analysis ?? null,
          inheritedCharacterRegistry: state?.floorData?.character_registry ?? null,
        };
      },
      invalidateMutation,
      commitFloorPatch,
      assertMutationToken: token => chat.assert(token),
      clearInvalidatedFloor: version => invalidatedFloors.delete(floorExecutionKey(version)),
      refreshTrackingRegistry: (...args) => trackingRefresh(...args),
      createCollectionValidationError: domainValidationError,
      storyTime,
      getCurrentStoryTime: async target => {
        const current = await resolveCurrentBioWeaveFloor();
        if (!sameFloorVersion(current?.version, target?.version)) return null;
        return storyTimeCoordinator?.resolveFloorStoryTime?.(target) ?? null;
      },
      emitStoryTimeDiagnostic: details => emitPersistenceTrace(
        details?.code ?? "EVENT_STORY_TIME_DIAGNOSTIC",
        null,
        {version: details?.target ?? null},
        details,
        "event",
      ),
      emitEventEditTrace: (stage, target, details = {}) => emitPersistenceTrace(
        stage,
        null,
        target,
        details,
        "event-edit",
      ),
      resolveLockedExposureState,
    },
  });
  diagnostics = featureComposition.diagnostics;
  function recordPipelineDiagnostic(payload = {}) {
    try {
      diagnostics?.recordNsfwPipelineStage?.(payload);
    } catch {
      // Diagnostics are fail-open and must never change analysis scheduling.
    }
  }
  function startPipelineDiagnostic(payload = {}) {
    try {
      return diagnostics?.startNsfwPipelineRun?.(payload) ?? null;
    } catch {
      return null;
    }
  }
  function finishPipelineDiagnostic(payload = {}) {
    try {
      diagnostics?.finishNsfwPipelineRun?.(payload);
    } catch {
      // Diagnostics are fail-open and must never change analysis completion.
    }
  }
  generationLifecycle = featureComposition.generationLifecycle;
  const trackingRuntime = featureComposition.trackingRuntime;
  trackingRefresh = featureComposition.trackingRuntime.refreshTrackingRegistry;
  const refreshTrackingRegistry = trackingRefresh;
  const worldAnalysis = featureComposition.worldAnalysis;
  const resolveWorldModelAtOrBefore = worldAnalysis.resolveWorldModelAtOrBefore;
  const resolveWorldModelStrictlyBefore = worldAnalysis.resolveWorldModelStrictlyBefore;
  const resolvePersistedWorldModelForAnalysis = worldAnalysis.resolvePersistedWorldModelForAnalysis;
  const getWorldModelDiagnosticState = worldAnalysis.getWorldModelDiagnosticState;
  const saveWorldModel = worldAnalysis.saveWorldModel;
  const analyzeCurrentWorldModelFull = worldAnalysis.analyzeCurrentWorldModelFull;
  const analyzeCurrentWorldModelPatch = worldAnalysis.analyzeCurrentWorldModelPatch;
  const resolveFinalWorldModelForAnalysis = worldAnalysis.resolveFinalWorldModelForAnalysis;
  const characterEventAnalysis = featureComposition.characterEventAnalysis;
  const eventEditing = featureComposition.eventEditing;
  function emptyCurrentFloorStatus() {
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
  async function statusForCurrentFloor({
    target: suppliedTarget = undefined,
    resolutionError = null,
    eventStateCache = null,
  } = {}) {
    let target = suppliedTarget;
    if (suppliedTarget === undefined) {
      try {
        target = await resolveFloor();
      } catch (error) {
        resolutionError = error;
      }
    }
    if (!target) {
      const error = resolutionError;
      if (
        error && error.message !== "MESSAGE_NOT_FOUND" &&
        isFloorPreflightStage(error?.analysis_stage)
      ) {
        return diagnostics.buildFloorPreflightStatus(error, 0);
      }
      if (error && error.message !== "MESSAGE_NOT_FOUND") throw error;
      return emptyCurrentFloorStatus();
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
    const currentState = await resolveCompleteEventStateAtOrBefore(target);
    if (eventStateCache && typeof eventStateCache === "object") {
      eventStateCache.targetVersion = target.version;
      eventStateCache.state = currentState;
    }
    const currentFloorEvents = currentState?.events ?? [];
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
  async function assertBusinessTargetCurrent(target, token) {
    chat.assert(token);
    if (!target) return null;
    let current;
    try {
      current = await resolveCurrentBioWeaveFloor();
    } catch (cause) {
      const error = new Error("STALE_FLOOR_VERSION");
      error.code = "STALE_FLOOR_VERSION";
      error.analysis_stage = "business_state_target";
      error.cause = cause;
      throw error;
    }
    if (
      current.index !== target.index ||
      current.swipeId !== target.swipeId ||
      !sameFloorVersion(current.version, target.version)
    ) {
      const error = new Error("STALE_FLOOR_VERSION");
      error.code = "STALE_FLOOR_VERSION";
      error.analysis_stage = "business_state_target";
      error.floor_version = target.version;
      error.current_floor_version = current.version;
      throw error;
    }
    return current;
  }
  async function collectActiveBusinessData({
    includeDebug = false,
    reason = "unknown",
    route = null,
    analysisPhase = null,
    force = false,
  } = {}) {
    const withDebug = (data, statusValue, stateInfo = null) => includeDebug
      ? {
          ...data,
          debug: buildBusinessDebugData({
            status: statusValue,
            activeEvents: data.active_events ?? [],
            registry: stateInfo?.registry ?? null,
            stateInfo,
          }),
        }
      : data;
    const token = chat.token();
    let target = null;
    let targetError = null;
    try {
      target = await resolveCurrentBioWeaveFloor();
    } catch (error) {
      targetError = error;
    }
    const eventStateCache = {};
    const status = await statusForCurrentFloor({
      target,
      resolutionError: targetError,
      eventStateCache,
    });
    chat.assert(token);
    const chatData = store.getChat(token.chatId);
    if (isFloorPreflightStage(status.error_stage)) {
      return withDebug(buildBusinessData(status, [], chatData, null, {
        current_state: reduceState({}),
        current_state_status: status.current_floor === null ? "NO_CHARACTER_FLOOR" : "STATE_ERROR",
        current_story_time: null,
        current_story_time_status: "NO_CHARACTER_FLOOR",
        current_story_time_differences: {},
        current_health_state: {schema_version: 1, characters: {}},
      }), status);
    }
    let derived;
    let joinedCanonicalBuild = false;
    const canonicalBuildStartedAt = monotonicNow();
    try {
      const canonical = await collectCanonicalDerivedState(token, chatData, {
        target,
        currentEventState: eventStateCache.state,
        currentEventStateVersion: eventStateCache.targetVersion,
        analysisPhase,
        useCompletedCache: includeDebug !== true && force !== true,
      });
      derived = canonical.derived;
      joinedCanonicalBuild = canonical.joined;
    } catch (error) {
      if (!isFloorPreflightStage(error?.analysis_stage)) throw error;
      return withDebug(buildBusinessData(
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
          current_health_state: {schema_version: 1, characters: {}},
        },
      ), diagnostics.buildFloorPreflightStatus(error, 0));
    }
    const canonicalBuildMs = durationMs(canonicalBuildStartedAt);
    await assertBusinessTargetCurrent(target, token);
    const dtoBuildStartedAt = monotonicNow();
    const businessData = buildBusinessData(
      status,
      derived.activeEvents,
      derived.chatData,
      derived.registry,
      {
        states: derived.states,
        eventState: derived.eventState,
        worldState: derived.worldState,
        characterRegistryState: derived.characterRegistryState,
        characterRegistry: derived.characterRegistry,
        registry: derived.registry,
        subjectProfiles: derived.subjectProfiles,
        current_state: derived.currentState,
        current_state_status: derived.currentStateStatus,
        currentStoryTime: derived.currentStoryTime,
        currentStoryTimeInfo: derived.currentStoryTimeInfo,
        current_story_time: derived.currentStoryTime,
        current_story_time_status: derived.currentStoryTimeStatus,
        current_story_time_differences: derived.currentStoryTimeDifferences,
        current_health_state: derived.currentHealthState,
      },
    );
    const isolatedBusinessData = joinedCanonicalBuild
      ? cloneBusinessDataForConsumer(businessData)
      : businessData;
    const dtoBuildMs = durationMs(dtoBuildStartedAt);
    emitPersistenceTrace("CHARACTER_UI_PERFORMANCE", null, target, {
      operation: "business-read",
      request_source: reason,
      route,
      canonical_build_ms: canonicalBuildMs,
      dto_build_ms: dtoBuildMs,
    }, "ui");
    return withDebug(isolatedBusinessData, status, derived);
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
        current_health_state: derived.currentHealthState,
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
        current_health_state: {schema_version: 1, characters: {}},
        status: "NO_CHARACTER_FLOOR",
      };
    }
  }
  function buildBusinessDebugData({status, activeEvents, registry, stateInfo}) {
    const targetVersion = status?.floor_version ?? null;
    const states = Array.isArray(stateInfo?.states) ? stateInfo.states : [];
    const sourceForVersion = version => {
      if (!version) return null;
      const state = states.find(candidate => sameFloorVersion(candidate.version, version));
      return debugFloorSource(state);
    };
    const trackingWindows = Array.isArray(registry?.tracking_windows)
      ? registry.tracking_windows
      : [];
    const subjectProfiles = stateInfo?.subjectProfiles ?? {};
    const trackingWindowHorizons = Object.fromEntries(
      trackingWindows.map(window => [
        window.tracking_window_id,
        resolveTrackingWindowHorizon({
          worldModel: stateInfo?.worldState?.model ?? {},
          subjectProfile: subjectProfiles?.[window.subject_id] ?? null,
          mechanismKey: window.mechanism_key,
        }),
      ]),
    );
    const statusCounts = Object.fromEntries(
      ["open", "expired", "terminated", "resolved_pregnant"].map(statusName => [
        statusName,
        trackingWindows.filter(window => window.status === statusName).length,
      ]),
    );
    const storyTimeInfo = stateInfo?.currentStoryTimeInfo ?? null;
    const storyTimeFloor = storyTimeInfo?.floor?.version ?? targetVersion;
    const hasStoryTimeSnapshot = Boolean(storyTimeInfo?.floor?.version);
    const storyTimeTrace = Array.isArray(storyTimeInfo?.trace) ? storyTimeInfo.trace : [];
    const latestStoryTimeTrace = storyTimeTrace.at(-1) ?? {};
    const storyTimeSnapshot = {
      schema_version: 1,
      status: storyTimeInfo?.status ?? stateInfo?.currentStoryTimeStatus ?? "NO_STORY_TIME_INFO",
      current_story_time: cloneValue(
        storyTimeInfo?.story_time ?? stateInfo?.currentStoryTime ?? stateInfo?.current_story_time ?? null,
      ),
      target_floor_version: cloneValue(storyTimeFloor),
      target_specific_read: hasStoryTimeSnapshot,
      resolver_source: latestStoryTimeTrace.source ?? latestStoryTimeTrace.source_kind ?? null,
      resolution_source: latestStoryTimeTrace.resolution_source ?? null,
      candidate_source: latestStoryTimeTrace.candidate_source ?? null,
      trace_summary: cloneValue(storyTimeInfo?.trace_summary ?? {
        entry_count: storyTimeTrace.length,
        sources: [...new Set(storyTimeTrace.map(entry => entry?.source).filter(Boolean))],
        resolution_sources: [...new Set(storyTimeTrace.map(entry => entry?.resolution_source).filter(Boolean))],
        candidate_sources: [...new Set(storyTimeTrace.map(entry => entry?.candidate_source).filter(Boolean))],
      }),
      canonical_build: {
        read_mode: "target_specific_coordinator",
        snapshot_reused: hasStoryTimeSnapshot,
        note: "本次 canonical build 复用同一份目标 Floor Story Time 快照；未重新扫描当前 Chat。",
      },
      other_story_time_fields_are_historical_or_reference: true,
      story_time_field_roles: {
        current_story_time: "CURRENT_CANONICAL",
        event_story_time: "EVENT_OCCURRENCE",
        reference_story_time: "EXPOSURE_REFERENCE",
        aggregation_story_time: "AGGREGATION_REFERENCE",
      },
    };
    return {
      sampled_at: new Date().toISOString(),
      target: {
        chat_id: targetVersion?.chat_id ?? null,
        floor: targetVersion?.floor ?? null,
        message_id: targetVersion?.message_id ?? null,
        swipe_id: targetVersion?.swipe_id ?? null,
        floor_version: cloneValue(targetVersion),
        source_type: "CURRENT_DERIVED",
      },
      event_state: {
        source_type: stateInfo?.eventState ? "CURRENT_RESOLVED" : "CURRENT_DERIVED",
        source: debugFloorSource(stateInfo?.eventState),
        count: activeEvents.length,
        events: activeEvents.map(event => ({
          event_id: event?.event_id ?? null,
          event_type: event?.type ?? null,
          subject_ids: (event?.pregnancy_relevance?.gestational_subject_ids ?? []).map(String),
          participant_ids: (event?.participants ?? []).map(participant => participant?.character_id).filter(Boolean),
          story_time: cloneValue(event?.story_time ?? null),
          source: debugEventSource(event, targetVersion),
          event: cloneValue(event),
        })),
      },
      world_model: {
        source_type: stateInfo?.worldState ? "CURRENT_RESOLVED" : "CURRENT_DERIVED",
        source: sourceForVersion(stateInfo?.worldState?.floor_version),
        floor_version: cloneValue(stateInfo?.worldState?.floor_version ?? null),
        model: cloneValue(stateInfo?.worldState?.model ?? null),
      },
      character_registry: {
        source_type: stateInfo?.characterRegistryState ? "CURRENT_RESOLVED" : "CURRENT_DERIVED",
        source: debugFloorSource(stateInfo?.characterRegistryState),
        count: Object.keys(stateInfo?.characterRegistry?.entities ?? {}).length,
        registry: cloneValue(stateInfo?.characterRegistry ?? normalizeCharacterRegistry(null)),
      },
      tracking_window: {
        source_type: "CURRENT_DERIVED",
        story_time_source: "canonical_story_time_snapshot",
        current_story_time: cloneValue(
          stateInfo?.currentStoryTime ?? stateInfo?.current_story_time ?? null,
        ),
        windows: cloneValue(trackingWindows),
        count: trackingWindows.length,
        status_counts: statusCounts,
        horizons: trackingWindowHorizons,
      },
      tracking_registry: {
        source_type: "CURRENT_DERIVED",
        tracking_subjects: cloneValue(registry?.tracking_subjects ?? {}),
        tracking_candidates: cloneValue(registry?.tracking_candidates ?? {}),
        character_profiles: cloneValue(registry?.character_profiles ?? {}),
      },
      health_state: {
        source_type: "CURRENT_DERIVED",
        story_time_source: "canonical_story_time_snapshot",
        current_story_time: cloneValue(stateInfo?.currentStoryTime ?? stateInfo?.current_story_time ?? null),
        state: cloneValue(stateInfo?.current_health_state ?? stateInfo?.currentHealthState ?? {schema_version: 1, characters: {}}),
      },
      story_time_snapshot: storyTimeSnapshot,
    };
  }

  function buildBusinessData(
    status,
    activeEvents,
    chatData,
    registry = null,
    stateInfo = null,
  ) {
    const trackingSubjects = mergeTrackingSubjectsWithActivePregnancies(
      registry?.tracking_subjects ?? {},
      stateInfo?.current_state ?? {},
    );
    const trackingCandidates = registry?.tracking_candidates ?? {};
    const trackingWindows = registry?.tracking_windows ?? [];
    const reproductiveSourceCandidates = deriveReproductiveSourceCandidates({
      trackingWindows,
      events: activeEvents,
    });
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
      tracking_windows: trackingWindows,
      reproductive_source_candidates: reproductiveSourceCandidates,
      character_profiles: characterProfiles,
      active_events: activeEvents,
      current_state: stateInfo?.current_state ?? reduceState({}),
      current_state_status: stateInfo?.current_state_status ?? "NO_CHARACTER_FLOOR",
      current_story_time: stateInfo?.current_story_time ?? null,
      current_story_time_status: stateInfo?.current_story_time_status ?? "NO_CHARACTER_FLOOR",
      current_story_time_differences: stateInfo?.current_story_time_differences ?? {},
      current_health_state: stateInfo?.current_health_state ?? {schema_version: 1, characters: {}},
      current_floor: status.current_floor,
      last_success: status.last_success,
      analysis_status: analysisStatus,
      ...analysisStatus,
    };
  }

  function cloneBusinessDataForConsumer(data) {
    return cloneValue(data);
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
      run_id: execution.pipeline_run_id ?? null,
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
        run_id: execution.pipeline_run_id ?? null,
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
      if (typeof projectionPostProcessor === "function") {
        const isManualExecution = execution.analysis_intent === "manual-character" ||
          execution.analysis_intent === "manual-refresh" ||
          execution.reason === "manual-refresh";
        const generationState = generationLifecycle?.getState?.() ?? {};
        const generationActive = generationAutomaticWorkDeferred ||
          generationState.pendingGeneration || generationState.pendingSwipeGeneration;
        if (generationActive && !isManualExecution) {
          deferredProjectionPostProcesses.clear();
          deferredProjectionPostProcesses.set(execution.key, execution);
          emitPersistenceTrace("PROJECTION_POSTPROCESS_DEFERRED", null, execution.target, {
            reason: "generation-active",
            analysis_execution_id: execution.analysis_execution_id,
          }, "scheduler");
        } else {
          void runProjectionPostProcessor(execution);
        }
      }
    }
    return terminal;
  }
  async function runProjectionPostProcessor(execution) {
    try {
      return await projectionPostProcessor({
        target: execution.target,
        execution,
        run_id: execution.pipeline_run_id ?? null,
      });
    } catch (error) {
      notify({
        type: "PROJECTION_ANALYSIS_STATUS_CHANGED",
        payload: {
          state: "failed",
          phase: "post_processing",
          error_code: error?.code ?? error?.message ?? "PROJECTION_FAILED",
          floor_version: execution.version,
          run_id: execution.pipeline_run_id ?? null,
        },
        chatId: execution.version.chat_id,
      });
      return null;
    }
  }
  async function runSettledProjectionProcessor({target, reason, generation = null, analysisExecutionId = null, schedulerDecision = null} = {}) {
    if (typeof settledProjectionProcessor !== "function") return null;
    emitPersistenceTrace("PROJECTION_INTERNAL_TRIGGERED", null, target, {
      reason,
      scheduler_decision: schedulerDecision,
      analysis_execution_id: analysisExecutionId,
    }, "scheduler");
    try {
      return await settledProjectionProcessor({
        target,
        reason,
        generation,
        analysisExecutionId,
        schedulerDecision,
      });
    } catch (error) {
      notify({
        type: "PROJECTION_ANALYSIS_STATUS_CHANGED",
        payload: {
          state: "failed",
          phase: "automatic_internal",
          error_code: error?.code ?? error?.message ?? "PROJECTION_INTERNAL_FAILED",
          floor_version: target?.version ?? null,
        },
        chatId: target?.version?.chat_id ?? target?.chatId ?? null,
      });
      return null;
    }
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
    exactIndex = null,
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
      if (
        Number.isInteger(exactIndex) &&
        execution.index !== exactIndex
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
  async function schedulerRunIsCurrent(run, target) {
    if (!run || !target?.version) return false;
    try {
      chat.assert(run.token);
      if (invalidatedFloors.has(floorExecutionKey(run.floorVersion))) return false;
      const current = await resolveFloorAtIndex({
        __messageIndex: true,
        index: target.index,
      });
      const streamingReroll = run.generation?.rerollIntent === true ||
        String(run.generation?.generation_type ?? '').toLowerCase() === 'regenerate';
      if (schedulerState.schedulerRevision === run.revision && sameFloorVersion(current.version, run.floorVersion)) return true;
      if (streamingReroll &&
          String(current.version.chat_id) === String(run.floorVersion.chat_id) &&
          String(current.version.message_id) === String(run.floorVersion.message_id) &&
          Number(current.version.floor) === Number(run.floorVersion.floor) &&
          Number(current.version.swipe_id) === Number(run.floorVersion.swipe_id)) return true;
      return false;
    } catch {
      return false;
    }
  }
  function recordStaleSchedulerCompletion(target, run, outcome, error = null) {
    emitPersistenceTrace("AUTO_SCHEDULER_COMPLETION_DISCARDED", null, target, {
      completion: outcome,
      reason: "stale-scheduler-owner",
      scheduler_revision: run?.revision ?? null,
      current_scheduler_revision: schedulerState.schedulerRevision,
      error_code: error?.code ?? error?.message ?? null,
      analysis_stage: error?.analysis_stage ?? null,
    }, "scheduler");
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
  async function assertAnalysisOwnerCurrent(execution, target, token) {
    const targetCurrent = await assertExecutionTargetCurrent(execution, target, token);
    const isManual = execution.analysis_intent === "manual-character" ||
      execution.analysis_intent === "manual-refresh" ||
      execution.reason === "manual-refresh";
    if (isManual) return targetCurrent;
    // A render-triggered execution is already owned by the rendered Floor.
    // The additional live-owner check is required for generation-bound work:
    // that is the only path where a delayed callback can carry an older intent
    // after a newer Character Floor has become the owner.
    if (!execution.generation) return targetCurrent;
    let current;
    try {
      current = await resolveCurrentBioWeaveFloor();
    } catch {
      invalidateExecution(execution, {
        reason: "analysis-owner-unavailable",
        code: "STALE_ANALYSIS_OWNER",
      });
      throw requestAbortedError();
    }
    if (current.index !== target.index || !sameFloorVersion(current.version, target.version)) {
      invalidateExecution(execution, {
        reason: "analysis-owner-changed",
        code: "STALE_ANALYSIS_OWNER",
        currentVersion: current.version,
      });
      throw requestAbortedError();
    }
    if (execution.generation &&
        !generationLifecycle?.isGenerationOwnerCurrent(execution.generation, target)) {
      invalidateExecution(execution, {
        reason: "generation-owner-changed",
        code: "STALE_GENERATION_OWNER",
        currentVersion: current.version,
        generation_intent_id: execution.generation.intent_id ?? null,
      });
      throw requestAbortedError();
    }
    return current;
  }
  async function buildFloorAnalysisInput(
    target,
    token,
    {
      execution = null,
      preserveCurrentFloorState = false,
      useCurrentCharacterRegistry = false,
      includeCurrentFloorComparison = false,
      includeCurrentFloorHistory = false,
    } = {},
  ) {
    const chatData = store.getChat(token.chatId);
    const previous = await findPreviousSuccessfulBioWeave(target);
    const existingBioWeave = {
      analysis: previous.analysis,
      events: previous.events,
    };
    const currentFloorData = preserveCurrentFloorState
      ? store.getFloor?.(target.index, target.swipeId)
      : null;
    const currentFloorVersion = floorVersionFromData(currentFloorData);
    const currentFloorMatches = Boolean(
      currentFloorData &&
      sameFloorVersion(currentFloorVersion, target.version),
    );
    const currentFloorIsComparisonReference = Boolean(
      currentFloorData &&
      (currentFloorMatches || includeCurrentFloorComparison),
    );
    const previousRegistry = await resolveCharacterRegistryAtOrBefore(target, {
      strictBefore: true,
    });
    const characterRegistry = normalizeCharacterRegistry(
      useCurrentCharacterRegistry && currentFloorIsComparisonReference
        ? currentFloorData.character_registry
        : previousRegistry?.character_registry ?? previous.character_registry,
    );
    const causalEvents = sortEvents(previous.events);
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
    // `existing_bioweave` and event dedupe both use the nearest complete state;
    // complete states must never be replayed by flattening older Floors.
    const existingEventsSelection = currentFloorIsComparisonReference
      ? selectAnalysisExistingEvents({
          previousEvents: includeCurrentFloorHistory ? previous.events : [],
          currentFloorEvents: currentFloorData?.events,
          targetVersion: target.version,
        })
      : selectAnalysisExistingEvents({
          previousEvents: previous.events,
          currentFloorEvents: [],
          targetVersion: target.version,
        });
    const existingEvents = existingEventsSelection.events;
    emitPersistenceTrace("EVENT_ANALYSIS_INPUT_EVENTS", execution, target, {
      ...existingEventsSelection.diagnostics,
    }, "event");
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
      existing_events: existingEvents,
      participant_aggregations: currentFloorData?.participant_aggregation_snapshot?.items ?? [],
      tracking_windows: Array.isArray(characterRegistry?.tracking_windows)
        ? characterRegistry.tracking_windows
        : [],
      pregnancy_lifecycle_timeline: currentFloorData?.pregnancy_lifecycle_timeline ?? null,
    });
  }
  async function getStorylineContext() {
    const token = chat.token();
    const target = await resolveCurrentBioWeaveFloor();
    if (!target?.version) return {recent_story: {items: []}, current_floor: null};
    const input = await buildFloorAnalysisInput(target, token, {
      preserveCurrentFloorState: true,
      useCurrentCharacterRegistry: true,
    });
    return {
      recent_story: input.recent_story,
      current_floor: input.current_floor,
      world_model: input.world_model,
      worldbooks: input.worldbooks,
      external_memory: input.external_memory,
      character_registry: input.character_registry,
    };
  }
  async function runAnalysis(execution, target, savedAnalysis) {
    let token = null;
    let terminalState = "failed";
    let terminalError = null;
    try {
      token = chat.token();
      execution.stage = "request_build";
      execution.source_provenance = { ...target.version };
      await assertAnalysisOwnerCurrent(execution, target, token);
      const manualCharacter = execution.analysis_intent === "manual-character";
      const persistedWorld = manualCharacter
        ? await resolvePersistedWorldModelForAnalysis(target)
        : null;
      const preserveCurrentFloorState = execution.reason === "reroll" ||
        execution.reason === "manual-refresh" ||
        execution.analysis_intent === "manual-character";
      const preWorldInput = await buildFloorAnalysisInput(target, token, {
        execution,
        preserveCurrentFloorState,
        useCurrentCharacterRegistry: execution.reason === "reroll",
        includeCurrentFloorComparison: execution.reason === "reroll",
        includeCurrentFloorHistory: execution.analysis_intent === "manual-character",
      });
      await assertAnalysisOwnerCurrent(execution, target, token);
      if (execution.reason !== "manual-refresh") {
        emitPersistenceTrace("ANALYSIS_INPUT_READY", execution, target, {
          generation_settled: execution.generation_settled,
          host_floor_version_match: true,
          active_swipe_match: true,
        }, "analysis");
        emitVersionChain("ANALYSIS_INPUT_READY", {
          execution,
          target,
          sourceKind: "analysis_target",
        });
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
      await assertAnalysisOwnerCurrent(execution, target, token);
      const analysisInput = await buildFloorAnalysisInput(target, token, {
        execution,
        preserveCurrentFloorState,
        useCurrentCharacterRegistry: execution.reason === "reroll",
        includeCurrentFloorComparison: execution.reason === "reroll",
        includeCurrentFloorHistory: execution.analysis_intent === "manual-character",
      });
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
      await assertAnalysisOwnerCurrent(execution, target, token);
      if (typeof analyzer?.analyzeFloor !== "function")
        throw new Error("EVENT_ANALYZER_UNAVAILABLE");
      const eventStage = await runAnalysisStageWithRetry({
        domain: "event",
        target,
        token,
        execution,
        signal: execution.controller.signal,
        trigger: execution.reason,
        assertBeforeInvoke: () => assertAnalysisOwnerCurrent(execution, target, token),
        invoke: async ({previousError = null} = {}) => {
          execution.stage = "api_request";
          return characterEventAnalysis.runEventAttempt({
            target,
            token,
            execution,
            analysisInput,
            finalWorldModel,
            savedAnalysis,
            dependencyHash: execution.dependency_hash,
            previousError,
          });
        },
      });
      if (eventStage.unchanged === true) {
        terminalState = "success";
        scheduleHealthRecoveryCheck(target, {reason: "event-analysis-complete"});
        return {
          events: eventStage.events,
          version: target.version,
          status: "success",
          unchanged: true,
          attempt: execution.attempt,
        };
      }
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
    { force = false, reason = "automatic", generation = null, analysisExecutionId = null, pipelineRunId = null, intent = null } = {},
  ) {
    if (!isEnabled())
      return { skipped: true, status: "disabled", reason: "disabled" };
    const target = await resolveFloor(selector);
    const requestKey = floorExecutionKey(target.version);
    if (inFlight.has(requestKey)) {
      recordPipelineDiagnostic({
        stage: "PIPELINE_SCHEDULING",
        execution_status: "SKIPPED",
        reason_code: "ANALYSIS_ALREADY_IN_FLIGHT",
        invoked: true,
        run_id: pipelineRunId,
        chat_id: target?.version?.chat_id ?? target?.chatId ?? null,
        floor_version: target?.version ?? null,
        input_count: 1,
        output_count: 0,
        source_type: "EXECUTION_TRACE",
      });
      finishPipelineDiagnostic({
        run_id: pipelineRunId,
        execution_status: "SKIPPED",
        reason_code: "ANALYSIS_ALREADY_IN_FLIGHT",
      });
      return inFlight.get(requestKey).promise;
    }
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
      analysis_execution_id: analysisExecutionId ?? analysisExecutionIdFor(generation),
      pipeline_run_id: pipelineRunId,
      scheduler_revision: schedulerState.schedulerRevision,
      source_text_length: messageText(target.message, target.swipeId).length,
      generation: generation ?? null,
      target,
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
        run_id: execution.pipeline_run_id ?? null,
        ...(reason === "manual-refresh" || intent === "manual-character"
          ? { phase: "event_analysis" }
          : {}),
      },
      chatId: target.chatId,
    });
    return execution.promise;
  }
  async function runScheduledAnalysis(target, { reason, generation = null, analysisExecutionId = null, pipelineRunId = null }) {
    const settings = schedulerSettings();
    const resolvedAnalysisExecutionId = analysisExecutionId ?? analysisExecutionIdFor(generation);
    const schedulerRun = {
      revision: schedulerState.schedulerRevision,
      token: chat.token(),
      floorVersion: target?.version ?? null,
      analysisExecutionId: resolvedAnalysisExecutionId,
      generation,
    };
    try {
      const result = await analysisExecution.run(
        {
          target: { __messageIndex: true, index: target.index },
          force: false,
          reason,
          generation,
          analysisExecutionId: resolvedAnalysisExecutionId,
          pipelineRunId,
          trigger: "automatic",
        },
      );
      if (!(await schedulerRunIsCurrent(schedulerRun, target))) {
        finishPipelineDiagnostic({run_id: pipelineRunId,
          execution_status: "BLOCKED",
          reason_code: "FLOOR_VERSION_CHANGED",
        });
        recordStaleSchedulerCompletion(target, schedulerRun, "success");
        return {skipped: true, reason: "stale-scheduler-completion"};
      }
      if (result?.status === "success") recordSchedulerSuccess();
      if (result?.skipped) {
        finishPipelineDiagnostic({run_id: pipelineRunId,
          execution_status: "SKIPPED",
          reason_code: result?.reason ?? "ANALYSIS_ALREADY_CURRENT",
        });
      } else if (result?.status !== "success") {
        finishPipelineDiagnostic({run_id: pipelineRunId,
          execution_status: result?.status === "disabled" ? "SKIPPED" : "FAILED",
          reason_code: result?.reason ?? result?.status ?? "ANALYSIS_NOT_SUCCEEDED",
        });
      }
      return result;
    } catch (error) {
      if (!(await schedulerRunIsCurrent(schedulerRun, target))) {
        finishPipelineDiagnostic({run_id: pipelineRunId,
          execution_status: "BLOCKED",
          reason_code: "FLOOR_VERSION_CHANGED",
          error_code: error?.code ?? error?.message ?? "STALE_SCHEDULER_COMPLETION",
        });
        recordStaleSchedulerCompletion(target, schedulerRun, "failure", error);
        return {skipped: true, reason: "stale-scheduler-completion"};
      }
      recordSchedulerFailure(error, settings.retryFailed);
      finishPipelineDiagnostic({run_id: pipelineRunId,
        execution_status: "FAILED",
        reason_code: "EVENT_ANALYSIS_FAILED",
        error_code: error?.code ?? error?.message ?? "EVENT_ANALYSIS_FAILED",
      });
      throw error;
    }
  }
  const analysisExecution = createAnalysisExecutionPort({run: analyzeFloor});
  function analyzeCurrentFloor(options = {}) {
    const result = analysisExecution.run({...options, target: null});
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
    return analysisExecution.run({
      target: null,
      force: false,
      reason: "manual-character",
      intent: "manual-character",
      trigger: "manual-character",
    });
  }
  async function scheduleRenderedCharacter(
    target,
    {
      reason = "automatic",
      generation = null,
      analysisExecutionId = null,
      lifecycleOutcome = null,
    } = {},
  ) {
    const resolvedAnalysisExecutionId = analysisExecutionId ?? analysisExecutionIdFor(generation);
    if (lifecycleOutcome?.status === "generation-settled") {
      const settledVersion = generation?.finalFloorVersion ?? target?.version ?? null;
      const settledIndex = generation?.finalFloorIndex ?? target?.index ?? null;
      emitPersistenceTrace("GENERATION_LIFECYCLE_RESULT", null, target, {
        result_reason: "generation-settled",
        generation_id: generation?.generation_id ?? null,
        generation_type: generation?.generation_type ?? null,
        generation_intent_id: generation?.intent_id ?? null,
        generation_ended: generation?.ended === true,
        generation_settled: generation?.settled === true,
        analysis_execution_id: resolvedAnalysisExecutionId,
      }, "scheduler");
      emitVersionChain("GENERATION_LIFECYCLE_RESULT", {
        target,
        version: settledVersion,
        sourceKind: "generation_final_floor",
        analysisExecutionId: resolvedAnalysisExecutionId,
        finalFloorIndex: settledIndex,
        finalFloorVersion: settledVersion,
      });
      emitPersistenceTrace("AUTO_HANDOFF_TO_SCHEDULER", null, target, {
        floor_version_key: target?.version ? floorExecutionKey(target.version) : null,
        analysis_execution_id: resolvedAnalysisExecutionId,
      }, "scheduler");
      emitVersionChain("AUTO_HANDOFF_TO_SCHEDULER", {
        target,
        version: settledVersion,
        sourceKind: "scheduler_target",
        analysisExecutionId: resolvedAnalysisExecutionId,
        finalFloorIndex: settledIndex,
        finalFloorVersion: settledVersion,
      });
    }
    const generationReplacedVersion = Boolean(
      generation?.baselineVersion &&
      generation?.finalFloorVersion &&
      !sameFloorVersion(generation.baselineVersion, generation.finalFloorVersion),
    );
    if (generation?.rerollIntent === true || generationReplacedVersion) {
      try {
        await reconcileSchedulerState({
          target,
          excludeTarget: true,
          reason: "generation-floor-version-boundary",
        });
      } catch {
        // Preserve the existing incremental path if a boundary read cannot be
        // completed; the next lifecycle boundary can reconcile again.
      }
    }
    const key = floorExecutionKey(target.version);
    const counterBefore = schedulerState.counter;
    const alreadyObserved = schedulerState.observedFloorKeys.has(key);
    const alreadyCounted = schedulerState.countedFloorKeys.has(key);
    const { interval } = schedulerSettings();
    emitPersistenceTrace("AUTO_SCHEDULER_ENTER", null, target, {
      floor_version_key: key,
      force: false,
      counter_before: counterBefore,
      counter_after: counterBefore,
      interval,
      retry_paused: schedulerState.retryPaused,
      already_observed: alreadyObserved,
      already_counted: alreadyCounted,
      reason,
      lifecycle_outcome: lifecycleOutcome,
      analysis_execution_id: resolvedAnalysisExecutionId,
    }, "scheduler");
    emitVersionChain("AUTO_SCHEDULER_ENTER", {
      target,
      sourceKind: "scheduler_target",
      analysisExecutionId: resolvedAnalysisExecutionId,
    });
    if (lifecycleOutcome?.status === "generation-settled") {
      scheduleHealthRecoveryCheck(target, {reason: "generation-settled"});
    }
    if (alreadyObserved) {
      recordPipelineDiagnostic({
        stage: "PIPELINE_SCHEDULING",
        execution_status: "SKIPPED",
        reason_code: "FLOOR_ALREADY_OBSERVED",
        invoked: true,
        floor_version: target?.version ?? null,
        chat_id: target?.version?.chat_id ?? target?.chatId ?? null,
        input_count: 1,
        output_count: 0,
        source_type: "EXECUTION_TRACE",
      });
      emitPersistenceTrace("AUTO_SCHEDULER_DECISION", null, target, {
        floor_version_key: key,
        force: false,
        counter_before: counterBefore,
        counter_after: schedulerState.counter,
        interval,
        retry_paused: schedulerState.retryPaused,
        already_observed: alreadyObserved,
        already_counted: alreadyCounted,
        decision: "floor-already-observed",
        reason,
        analysis_execution_id: resolvedAnalysisExecutionId,
      }, "scheduler");
      return { skipped: true, reason: "floor-already-observed" };
    }
    rememberSchedulerKey(schedulerState.observedFloorKeys, key);
    if (schedulerState.retryPaused) {
      recordPipelineDiagnostic({
        stage: "PIPELINE_SCHEDULING",
        execution_status: "SKIPPED",
        reason_code: "RETRY_PAUSED",
        invoked: true,
        floor_version: target?.version ?? null,
        chat_id: target?.version?.chat_id ?? target?.chatId ?? null,
        input_count: 1,
        output_count: 0,
        source_type: "EXECUTION_TRACE",
      });
      emitPersistenceTrace("AUTO_SCHEDULER_DECISION", null, target, {
        floor_version_key: key,
        force: false,
        counter_before: counterBefore,
        counter_after: schedulerState.counter,
        interval,
        retry_paused: schedulerState.retryPaused,
        already_observed: alreadyObserved,
        already_counted: alreadyCounted,
        decision: "retry-paused",
        reason,
        analysis_execution_id: resolvedAnalysisExecutionId,
      }, "scheduler");
      await runSettledProjectionProcessor({
        target,
        reason,
        generation,
        analysisExecutionId: resolvedAnalysisExecutionId,
        schedulerDecision: "retry-paused",
      });
      return { skipped: true, reason: "retry-paused" };
    }
    schedulerState.counter = Math.min(interval, schedulerState.counter + 1);
    rememberSchedulerKey(schedulerState.countedFloorKeys, key);
    if (schedulerState.counter < interval) {
      recordPipelineDiagnostic({
        stage: "PIPELINE_SCHEDULING",
        execution_status: "SKIPPED",
        reason_code: "CHARACTER_INTERVAL",
        invoked: true,
        floor_version: target?.version ?? null,
        chat_id: target?.version?.chat_id ?? target?.chatId ?? null,
        input_count: 1,
        output_count: schedulerState.counter,
        source_type: "EXECUTION_TRACE",
      });
      emitPersistenceTrace("AUTO_SCHEDULER_DECISION", null, target, {
        floor_version_key: key,
        force: false,
        counter_before: counterBefore,
        counter_after: schedulerState.counter,
        interval,
        retry_paused: schedulerState.retryPaused,
        already_observed: alreadyObserved,
        already_counted: alreadyCounted,
        decision: "character-interval",
        reason,
        analysis_execution_id: resolvedAnalysisExecutionId,
      }, "scheduler");
      await runSettledProjectionProcessor({
        target,
        reason,
        generation,
        analysisExecutionId: resolvedAnalysisExecutionId,
        schedulerDecision: "character-interval",
      });
      return {
        skipped: true,
        reason: "character-interval",
        counter: schedulerState.counter,
      };
    }
    emitPersistenceTrace("AUTO_SCHEDULER_DECISION", null, target, {
      floor_version_key: key,
      force: false,
      counter_before: counterBefore,
      counter_after: schedulerState.counter,
      interval,
      retry_paused: schedulerState.retryPaused,
      already_observed: alreadyObserved,
      already_counted: alreadyCounted,
      decision: "interval-due",
      reason,
      analysis_execution_id: resolvedAnalysisExecutionId,
    }, "scheduler");
    emitVersionChain("AUTO_SCHEDULER_DECISION", {
      target,
      sourceKind: "scheduler_target",
      analysisExecutionId: resolvedAnalysisExecutionId,
    });
    const pipelineRunId = startPipelineDiagnostic({
      kind: "automatic",
      trigger: reason,
      reason,
      chat_id: target?.version?.chat_id ?? target?.chatId ?? null,
      floor_version: target?.version ?? null,
    }) ?? null;
    recordPipelineDiagnostic({
      stage: "PIPELINE_SCHEDULING",
      execution_status: "ATTEMPTED",
      reason_code: "INTERVAL_DUE",
      invoked: true,
      run_id: pipelineRunId,
      floor_version: target?.version ?? null,
      chat_id: target?.version?.chat_id ?? target?.chatId ?? null,
      input_count: 1,
      output_count: 1,
      source_type: "EXECUTION_TRACE",
    });
    try {
      const result = await runScheduledAnalysis(target, { reason, generation, analysisExecutionId: resolvedAnalysisExecutionId, pipelineRunId });
      if (result?.status !== "success" && result?.reason !== "stale-scheduler-completion") {
        await runSettledProjectionProcessor({
          target,
          reason,
          generation,
          analysisExecutionId: resolvedAnalysisExecutionId,
          schedulerDecision: "interval-due-external-analysis-incomplete",
        });
      }
      return result;
    } catch (error) {
      await runSettledProjectionProcessor({
        target,
        reason,
        generation,
        analysisExecutionId: resolvedAnalysisExecutionId,
        schedulerDecision: "interval-due-external-analysis-failed",
      });
      throw error;
    }
  }
  function handoffSettledCharacterFloor(
    target,
    {reason = "automatic", generation = null, analysisExecutionId = null, lifecycleOutcome = null} = {},
  ) {
    return automaticAnalysis.observeSettledCharacterFloor(target, {
      force: false,
      reason,
      generation,
      analysisExecutionId,
      lifecycleOutcome,
    });
  }
  const automaticAnalysis = createAutomaticAnalysisPort({
    observeSettledCharacterFloor: scheduleRenderedCharacter,
    getState: getSchedulerState,
    reset: resetSchedulerState,
  });
  const manualAnalysis = createManualAnalysisPort({
    refreshCurrentFloor: refreshCurrentFloorAnalysis,
    analyzeCurrentCharacterEvents,
    analyzeCurrentFloor,
  });
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
      if (!isEnabled()) {
        recordPipelineDiagnostic({
          stage: "PIPELINE_SCHEDULING",
          execution_status: "SKIPPED",
          reason_code: "PLUGIN_DISABLED",
          invoked: true,
          input_count: 1,
          output_count: 0,
          source_type: "EXECUTION_TRACE",
        });
        return { skipped: true, status: "disabled", reason: event?.type };
      }
      const type = event?.type;
      if (event?.deferAutomaticWork === true && type !== "GENERATION_STARTED" &&
          type !== "GENERATION_ENDED" && type !== "GENERATION_STOPPED" &&
          type !== "GENERATION_CANCELLED" && type !== "CHARACTER_MESSAGE_RENDERED") {
        return {skipped: true, reason: "generation-post-processing-deferred", event: type};
      }
      if (type === "CHAT_CHANGED") {
        await primeLifecycleSnapshot();
        await reconcileSchedulerState({reason: "chat-changed"});
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
      const hasExplicitCharacterRenderTarget = type === "CHARACTER_MESSAGE_RENDERED" &&
        event?.payload != null &&
        (typeof event.payload !== "object" ||
          event.payload.message_id != null || event.payload.messageId != null ||
          event.payload.messageIndex != null || event.payload.index != null);
      const mutationIsUserOnly =
        (mutationEntry && mutationEntry.role === "user") ||
        (!hasExplicitCharacterRenderTarget && !mutationEntry && latestMessage && !isCharacterMessage(latestMessage));
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
      const requiresSchedulerReconciliation =
        isSourceMutation &&
        (mutationChanged || type === "MESSAGE_DELETED" ||
          type === "MESSAGE_SWIPE_DELETED");
      if (requiresSchedulerReconciliation) {
        await invalidateMutation(event, targetIndex, {
          preserveTarget: isSwipeBoundaryEvent,
          clearRoots: true,
          currentSnapshot,
        });
        await reconcileSchedulerState({reason: `mutation:${type}`});
      }
      lifecycleSnapshot = await primeLifecycleSnapshot();
      if (isSwipeBoundaryEvent) await refreshTrackingRegistry(type);
      if (LIFECYCLE_ONLY_EVENTS.has(type)) {
        await refreshTrackingRegistry(type);
        return { skipped: true, reason: type };
      }
      if (type === "GENERATION_STOPPED" || type === "GENERATION_CANCELLED") {
        const result = generationLifecycle.onGenerationStopped(
          event?.payload ?? null,
          currentSnapshot.entries[targetIndex] ?? null,
        );
        return applySchedulerLifecycleOutcome(result);
      }
      if (type === "GENERATION_ENDED") {
        const result = await generationLifecycle.onGenerationEnded();
        return applySchedulerLifecycleOutcome(result);
      }
      if (type === "MESSAGE_UPDATED" || type === "MESSAGE_EDITED" ||
          type === "MESSAGE_RECEIVED") {
        if (type !== "MESSAGE_RECEIVED") {
          try {
            const current = await resolveCurrentBioWeaveFloor();
            const key = floorExecutionKey(current.version);
            const currentData = store.getFloor?.(current.index, current.swipeId) ?? {};
            if (!invalidatedFloors.has(key) && currentData.analysis?.status === "success") {
              scheduleHealthRecoveryCheck(current, {reason: `story-time-update:${type}`});
            }
          } catch {
            // A changed or deleted owner will be handled by the existing
            // analysis lifecycle; it must not create a recovery write here.
          }
        }
        return { skipped: true, reason: "lifecycle-baseline-only" };
      }
      if (type === "MESSAGE_SWIPED") {
        const result = await generationLifecycle.onSwipe(
          event?.payload,
          previousLifecycleEntry,
        );
        return applySchedulerLifecycleOutcome(result);
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
      const lifecycleStateBefore = generationLifecycle.getState();
      const lifecycleGeneration = lifecycleStateBefore.pendingGeneration
        ?? lifecycleStateBefore.pendingSwipeGeneration
        ?? lifecycleStateBefore.completedGeneration
        ?? lifecycleStateBefore.completedSwipeGeneration
        ?? null;
      const analysisExecutionId = analysisExecutionIdFor(lifecycleGeneration);
      emitPersistenceTrace("CHARACTER_MESSAGE_RENDERED_RECEIVED", null, target, {
        event_type: type,
        event_payload_type: typeof event?.payload,
        floor_version_key: floorExecutionKey(target.version),
      }, "scheduler");
      emitVersionChain("CHARACTER_MESSAGE_RENDERED_RECEIVED", {
        target,
        sourceKind: "runtime_chat",
        analysisExecutionId,
        finalFloorIndex: lifecycleGeneration?.finalFloorIndex ?? target.index,
        finalFloorVersion: lifecycleGeneration?.finalFloorVersion ?? target.version,
      });
      const generationResult = await generationLifecycle.onCharacterMessageRendered(target);
      applySchedulerLifecycleOutcome(generationResult);
      const generationState = generationLifecycle.getState();
      emitPersistenceTrace("GENERATION_LIFECYCLE_RESULT", null, target, {
        result: generationResult,
        result_reason: generationResult?.reason ?? null,
        pending_generation: generationState.pendingGeneration ?? null,
        pending_swipe_generation: generationState.pendingSwipeGeneration ?? null,
        completed_generation: generationState.completedGeneration ?? null,
        completed_swipe_generation: generationState.completedSwipeGeneration ?? null,
        analysis_execution_id: analysisExecutionId,
      }, "scheduler");
      emitVersionChain("GENERATION_LIFECYCLE_RESULT", {
        target,
        sourceKind: "generation_final_floor",
        analysisExecutionId,
        finalFloorIndex: generationState.completedGeneration?.finalFloorIndex
          ?? generationState.completedSwipeGeneration?.finalFloorIndex
          ?? target.index,
        finalFloorVersion: generationState.completedGeneration?.finalFloorVersion
          ?? generationState.completedSwipeGeneration?.finalFloorVersion
          ?? target.version,
      });
      if (generationResult) {
        emitPersistenceTrace("AUTO_HANDOFF_BLOCKED", null, target, {
          reason: generationResult.reason ?? "generation-lifecycle-result",
          generation_result: generationResult,
          pending_generation: generationState.pendingGeneration ?? null,
          pending_swipe_generation: generationState.pendingSwipeGeneration ?? null,
          completed_generation: generationState.completedGeneration ?? null,
          completed_swipe_generation: generationState.completedSwipeGeneration ?? null,
        }, "scheduler");
        return generationResult;
      }
      emitPersistenceTrace("AUTO_HANDOFF_TO_SCHEDULER", null, target, {
        floor_version_key: floorExecutionKey(target.version),
        analysis_execution_id: analysisExecutionId,
      }, "scheduler");
      emitVersionChain("AUTO_HANDOFF_TO_SCHEDULER", {
        target,
        sourceKind: "scheduler_target",
        analysisExecutionId,
      });
      try {
        return await handoffSettledCharacterFloor(target, {
          reason: type,
          analysisExecutionId,
          lifecycleOutcome: {status: "rendered"},
        });
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
    cancelPendingHealthRecoveryChecks();
    clearWorldbookCache(sourceCache);
    if (signal?.changed) {
      deferredProjectionPostProcesses.clear();
      advanceCanonicalGeneration(`chat-boundary:${signal?.reason ?? "changed"}`);
      lastTerminal.clear();
      invalidatedFloors.clear();
      lifecycleSnapshot = null;
      automaticAnalysis.reset(signal?.reason ?? "chat-boundary");
    }
  }
  function destroy() {
    destroyed = true;
    cancelPendingHealthRecoveryChecks();
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
    canonicalBuilds.clear();
    completedCanonicalBuilds.clear();
    deferredProjectionPostProcesses.clear();
    settledProjectionProcessor = null;
    worldAnalysis.clear();
    automaticAnalysis.reset("destroy");
  }
  if (typeof chat.subscribe === "function")
    removeChatBoundaryListener = chat.subscribe(handleChatBoundarySignal);
  return {
    resolveCurrentBioWeaveFloor,
    resolveHealthAssessmentTimelineAtOrBefore,
    syncHealthRecoverySnapshot,
    resolveCharacterRegistryAtOrBefore,
    getCurrentCharacterIdentity,
    updateCharacterAliases,
    analyzeCurrentFloor,
    analyzeFloor,
    refreshCurrentFloorAnalysis,
    analyzeCurrentCharacterEvents,
    getCurrentFloorAnalysisInput,
    requestAbortCurrentFloorAnalysis,
    assertExecutionTargetCurrent,
    getCurrentFloorAnalysisStatus: statusForCurrentFloor,
    automaticAnalysis,
    analysisExecution,
    manualAnalysis,
    ensureCurrentProjectionFloorOwner,
    getAutoAnalysisSchedulerState: automaticAnalysis.getState,
    reconcileSchedulerState,
    setProjectionPostProcessor: handler => {
      projectionPostProcessor = typeof handler === "function" ? handler : null;
    },
    setSettledProjectionProcessor: handler => {
      settledProjectionProcessor = typeof handler === "function" ? handler : null;
    },
    flushDeferredProjectionPostProcessor: async ({target = null} = {}) => {
      if (!target?.version) return {status: "skipped", reason: "target-unavailable"};
      const key = floorExecutionKey(target.version);
      const execution = deferredProjectionPostProcesses.get(key);
      if (!execution) return {status: "skipped", reason: "none-deferred"};
      deferredProjectionPostProcesses.delete(key);
      if (!sameFloorVersion(execution.version, target.version) ||
          execution.version.chat_id !== chat.current()) {
        deferredProjectionPostProcesses.clear();
        return {status: "skipped", reason: "stale-floor"};
      }
      emitPersistenceTrace("PROJECTION_POSTPROCESS_RELEASED", null, target, {
        reason: "generation-settled",
        analysis_execution_id: execution.analysis_execution_id,
      }, "scheduler");
      await runProjectionPostProcessor(execution);
      return {status: "released"};
    },
    clearDeferredProjectionPostProcessor: () => {
      const count = deferredProjectionPostProcesses.size;
      deferredProjectionPostProcesses.clear();
      return count;
    },
    getCurrentFloorEvents: async () =>
      (await statusForCurrentFloor()).current_floor_events,
    getParticipantAggregationInputs,
    resolveWorldModelAtOrBefore,
    resolveWorldModelStrictlyBefore,
    resolvePersistedWorldModelForAnalysis,
    invalidateCanonicalDerivedReads,
    getWorldModelDiagnosticState,
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
    getStorylineContext,
    getCurrentBiologicalState,
    handleLifecycleEvent,
    primeLifecycleSnapshot,
    getLifecycleSnapshot: () => lifecycleSnapshot,
    setGenerationAutomaticWorkDeferred: deferred => {
      generationAutomaticWorkDeferred = deferred === true;
    },
    cancelPendingGeneration: reason => generationLifecycle.cancelPendingGeneration?.(reason),
    restorePendingGeneration: (snapshot, options) =>
      generationLifecycle.restorePendingGeneration?.(snapshot, options),
    handoffSettledCharacterFloor,
    invalidateForClear,
    completeClear,
    refreshTrackingRegistry,
    pause,
    updateEvent: eventEditing.updateEvent,
    deleteEvent: eventEditing.deleteEvent,
    destroy,
  };
}
