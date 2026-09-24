import {
  buildWorldModelViewModel,
  mergeWorldModelPatch,
  normalizeStoredWorldModel,
  summarizeAnalysisInput,
} from "../ai/analyzer.js";
import { emptyFloor } from "../storage/schema.js";
import {
  floorVersionFromData,
  sameFloorVersion,
} from "./floor.js";

const WORLD_MODEL_UPDATE_SIGNAL = /(?:世界规则|世界设定|物种规则|生物类型|biological[_\s-]*type|species\s*(?:rule|type)|生殖机制|受精机制|妊娠规则|怀孕规则|生殖能力|受孕能力|投影规则|projection[_\s-]*rule|can_(?:produce|be_fertilized|fertilize|cause_pregnancy|carry_pregnancy))/iu;

function worldModelUnavailableError(cause, target = null) {
  const error = new Error("WORLD_MODEL_UNAVAILABLE");
  error.code = "WORLD_MODEL_UNAVAILABLE";
  error.analysis_stage = "world_model_preflight";
  error.floor_version = target?.version ? { ...target.version } : null;
  if (cause) error.cause = cause;
  return error;
}

function worldModelPersistenceError(cause, target = null) {
  const code = String(cause?.code ?? cause?.message ?? "");
  const error = new Error(
    code === "FLOOR_PERSISTENCE_READBACK_FAILED"
      ? "WORLD_MODEL_PERSISTENCE_READBACK_FAILED"
      : "WORLD_MODEL_PERSISTENCE_PREWRITE_FAILED",
  );
  error.code = error.message;
  error.analysis_stage = code === "FLOOR_PERSISTENCE_READBACK_FAILED"
    ? "world_persistence_readback"
    : "world_persistence_prewrite";
  error.floor_version = target?.version ? { ...target.version } : null;
  error.cause = cause;
  if (cause?.version_check_source) error.version_check_source = cause.version_check_source;
  if (cause?.version_audit) error.version_audit = cause.version_audit;
  if (cause?.retry_classification) error.retry_classification = cause.retry_classification;
  if (cause?.retryable !== undefined) error.retryable = cause.retryable;
  return error;
}

function worldModelUiNotReadyError(stage, cause = null, target = null) {
  const error = new Error("WORLD_MODEL_UI_NOT_READY");
  error.code = "WORLD_MODEL_UI_NOT_READY";
  error.analysis_stage = stage;
  error.floor_version = target?.version ? { ...target.version } : null;
  if (cause) error.cause = cause;
  return error;
}

function cloneWorldValue(value) {
  if (value === undefined || value === null) return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  if (Array.isArray(value)) return value.map(cloneWorldValue);
  if (typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneWorldValue(item)]));
  return value;
}

export function createWorldAnalysis({
  analyzer,
  isEnabled,
  getToken,
  assertToken,
  resolveCurrentFloor,
  resolveFloorAtIndex,
  getMessages,
  getActiveSwipeId,
  getFloor,
  getMessageText,
  isCharacterMessage,
  hasSwipeSlot,
  isFloorInvalidated,
  floorExecutionKey,
  nextAttemptSequence,
  commitFloorPatch,
  runAnalysisStageWithRetry,
  targetVersionIsCurrent,
  executionIsCurrent,
  assertExecutionCurrent,
  invalidateExecution,
  clearInvalidatedFloor,
  setExecutionStage,
  setExecutionPhase,
  getExecutionSignal,
  setExecutionCancellationMetadata,
  setExecutionDiagnostic,
  formatExecutionDiagnostic,
  floorVersionComparison,
  emitPersistenceTrace,
  persistenceTraceContext,
  notify,
  disabledError,
  requestAbortedError,
  isRequestAborted,
} = {}) {
  if (
    typeof isEnabled !== "function" ||
    typeof getToken !== "function" ||
    typeof assertToken !== "function" ||
    typeof resolveCurrentFloor !== "function" ||
    typeof resolveFloorAtIndex !== "function" ||
    typeof getMessages !== "function" ||
    typeof getActiveSwipeId !== "function" ||
    typeof getFloor !== "function" ||
    typeof getMessageText !== "function" ||
    typeof isCharacterMessage !== "function" ||
    typeof hasSwipeSlot !== "function" ||
    typeof isFloorInvalidated !== "function" ||
    typeof floorExecutionKey !== "function" ||
    typeof nextAttemptSequence !== "function" ||
    typeof commitFloorPatch !== "function" ||
    typeof runAnalysisStageWithRetry !== "function" ||
    typeof targetVersionIsCurrent !== "function" ||
    typeof executionIsCurrent !== "function" ||
    typeof assertExecutionCurrent !== "function" ||
    typeof invalidateExecution !== "function" ||
    typeof clearInvalidatedFloor !== "function" ||
    typeof setExecutionStage !== "function" ||
    typeof setExecutionPhase !== "function" ||
    typeof getExecutionSignal !== "function" ||
    typeof setExecutionCancellationMetadata !== "function" ||
    typeof setExecutionDiagnostic !== "function" ||
    typeof formatExecutionDiagnostic !== "function" ||
    typeof floorVersionComparison !== "function" ||
    typeof emitPersistenceTrace !== "function" ||
    typeof persistenceTraceContext !== "function" ||
    typeof notify !== "function" ||
    typeof disabledError !== "function" ||
    typeof requestAbortedError !== "function" ||
    typeof isRequestAborted !== "function"
  ) throw new TypeError("WORLD_ANALYSIS_DEPENDENCIES_REQUIRED");

  const worldInFlight = new Map();

  function hasWorldModelUpdateSignal(target) {
    return WORLD_MODEL_UPDATE_SIGNAL.test(getMessageText(target?.message, target?.swipeId));
  }

  async function resolveWorldModelAtOrBefore(selector = null, { strictBefore = false } = {}) {
    const target = await resolveCurrentFloor(selector);
    for (let index = target.index - (strictBefore ? 1 : 0); index >= 0; index -= 1) {
      const all = getMessages();
      if (!isCharacterMessage(all[index])) continue;
      const swipeId = getActiveSwipeId(index);
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
      const floorData = getFloor(index, swipeId) ?? {};
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

  async function saveWorldModel({
    model,
    meta = null,
    selector = null,
    automatic = false,
    traceExecution = null,
    persistenceOwner = null,
  } = {}) {
    if (automatic && !isEnabled()) throw disabledError();
    const normalizedModel = normalizeStoredWorldModel(model);
    const token = getToken();
    const target = await resolveCurrentFloor(selector);
    if (automatic && (!persistenceOwner || persistenceOwner.claimed !== false)) {
      const error = new Error("WORLD_STAGE_PERSISTENCE_OWNER_INVALID");
      error.code = "WORLD_STAGE_PERSISTENCE_OWNER_INVALID";
      error.analysis_stage = "world_persistence_owner";
      error.retryable = false;
      throw error;
    }
    if (automatic) persistenceOwner.claimed = true;
    if (traceExecution) {
      traceExecution.persistence_invocation_id ??= `world-${Date.now()}-${nextAttemptSequence()}`;
    }
    emitPersistenceTrace("WORLD_SAVE_BEGIN", traceExecution, target, {}, "world");
    assertToken(token);
    const current = getFloor(target.index, target.swipeId) ?? emptyFloor();
    const currentTarget = await resolveFloorAtIndex({ __messageIndex: true, index: target.index });
    if (!sameFloorVersion(currentTarget.version, target.version)) throw requestAbortedError();
    emitPersistenceTrace("WORLD_SAVE_SOURCE_RESOLVED", traceExecution, target, {
      current_floor_present: Boolean(current && Object.keys(current).length),
    }, "world");
    if (automatic && !isEnabled()) throw disabledError();
    try {
      await commitFloorPatch(target, "world", {
        world_model: cloneWorldValue(normalizedModel),
        world_model_meta: cloneWorldValue(meta),
      }, {
        operation_type: automatic ? "world-auto-patch" : "world-manual-patch",
        execution: traceExecution,
        traceContext: persistenceTraceContext(traceExecution, target, "world"),
        assertCurrent: () => assertToken(token),
      });
    } catch (cause) {
      if (cause?.code === "BIOWEAVE_USER_FLOOR_WRITE_FORBIDDEN" ||
          cause?.code === "SWIPE_NOT_FOUND" ||
          cause?.code === "STALE_FLOOR_VERSION" ||
          cause?.code === "STALE_SWIPE") throw cause;
      if (cause?.code === "WORLD_MODEL_PERSISTENCE_PREWRITE_FAILED" ||
          cause?.code === "WORLD_MODEL_PERSISTENCE_READBACK_FAILED") throw cause;
      throw worldModelPersistenceError(cause, target);
    }
    assertToken(token);
    return {
      model: cloneWorldValue(normalizedModel),
      meta: cloneWorldValue(meta),
      floor_version: cloneWorldValue(target.version),
    };
  }

  async function resolveWorldModelUiReady(target, { requireCurrentFloor = true } = {}) {
    let resolved;
    try {
      if (requireCurrentFloor) {
        const floorData = getFloor(target.index, target.swipeId) ?? null;
        const storedVersion = floorData?.floor_version ?? null;
        resolved = floorData && sameFloorVersion(storedVersion, target.version)
          ? {
              model: cloneWorldValue(floorData.world_model),
              meta: cloneWorldValue(floorData.world_model_meta),
              floor_version: cloneWorldValue(storedVersion),
            }
          : null;
      } else {
        resolved = await resolveWorldModelAtOrBefore(target);
      }
    } catch (cause) {
      throw worldModelUiNotReadyError("world_readback", cause, target);
    }
    if (!resolved || (requireCurrentFloor && !sameFloorVersion(resolved.floor_version, target.version)))
      throw worldModelUiNotReadyError("world_readback", null, target);
    try {
      return {
        ...resolved,
        view_model: buildWorldModelViewModel(resolved.model),
      };
    } catch (cause) {
      throw worldModelUiNotReadyError(cause?.analysis_stage ?? "world_view_model", cause, target);
    }
  }

  // Read-only prerequisite for Event/Character analysis. This deliberately
  // reuses the existing at-or-before resolver and canonical World view-model
  // gate; it must never enter the World AI or persistence workflow.
  async function resolvePersistedWorldModelForAnalysis(target) {
    try {
      const ready = await resolveWorldModelUiReady(target, {requireCurrentFloor: false});
      return {
        model: cloneWorldValue(ready.view_model.model),
        meta: cloneWorldValue(ready.meta),
        floor_version: cloneWorldValue(ready.floor_version),
      };
    } catch (cause) {
      const error = new Error("WORLD_MODEL_REQUIRED");
      error.code = "WORLD_MODEL_REQUIRED";
      error.analysis_stage = "character_world_preflight";
      error.prerequisite_failed = true;
      error.retryable = false;
      error.floor_version = target?.version ? cloneWorldValue(target.version) : null;
      error.cause = cause;
      throw error;
    }
  }

  async function runWorldAnalysisJob(
    target,
    token,
    {
      mode,
      analysisInput,
      signal = null,
      trigger = "automatic",
      onPhase = null,
      execution = null,
    } = {},
  ) {
    const key = floorExecutionKey(target.version);
    const existing = worldInFlight.get(key);
    if (existing) return existing.promise;
    if (mode !== "full" && mode !== "patch") throw new Error("WORLD_ANALYSIS_MODE_INVALID");
    const job = {key, target, mode, trigger, signal, released: false, promise: null};
    const persistenceOwner = {key, domain: "world", attempt: null, retryIndex: null, claimed: false};
    const publishPhase = phase => {
      onPhase?.(phase);
      notify({
        type: "WORLD_ANALYSIS_STATUS_CHANGED",
        payload: {state: "running", phase, mode, trigger, floor_version: target.version},
        chatId: target.chatId,
      });
    };
    worldInFlight.set(key, job);
    publishPhase(mode === "patch" ? "world_patch" : "world_full");
    const work = (async () => {
      assertToken(token);
      if (!(await targetVersionIsCurrent(target))) throw requestAbortedError();
      if (mode === "full" && typeof analyzer?.analyzeWorldModel !== "function")
        throw worldModelUnavailableError(new Error("WORLD_ANALYZER_UNAVAILABLE"), target);
      if (mode === "patch" && typeof analyzer?.analyzeWorldModelPatch !== "function")
        throw worldModelUnavailableError(new Error("WORLD_PATCH_ANALYZER_UNAVAILABLE"), target);
      return runAnalysisStageWithRetry({
        domain: "world",
        target,
        token,
        execution,
        signal,
        trigger,
        invoke: async () => {
          let meta;
          let model;
          if (mode === "full") {
            model = normalizeStoredWorldModel(await analyzer.analyzeWorldModel({
              analysisInput,
              floor_version: target.version,
              authoritative_floor_version: target.version,
              signal,
            }));
            meta = {source: "world-full-analysis", source_summary: summarizeAnalysisInput(analysisInput)};
          } else {
            const resolved = await resolveWorldModelAtOrBefore(target);
            if (!resolved) {
              const error = new Error("WORLD_MODEL_REQUIRED_FOR_PATCH");
              error.code = "WORLD_MODEL_REQUIRED_FOR_PATCH";
              error.analysis_stage = "world_preflight";
              throw error;
            }
            model = mergeWorldModelPatch(resolved.model, await analyzer.analyzeWorldModelPatch({
              analysisInput: {...(analysisInput ?? {}), world_model: cloneWorldValue(resolved.model)},
              floor_version: target.version,
              authoritative_floor_version: target.version,
              signal,
            }));
            meta = {
              ...cloneWorldValue(resolved.meta ?? {}),
              source: "world-patch-analysis",
              source_summary: summarizeAnalysisInput(analysisInput),
            };
          }
          return {model, meta};
        },
        complete: async ({model, meta}, {attempt, retryIndex}) => {
          const ownerKey = `${key}:${attempt}:${retryIndex}`;
          if (persistenceOwner.attempt !== ownerKey) {
            persistenceOwner.attempt = ownerKey;
            persistenceOwner.retryIndex = retryIndex;
            persistenceOwner.claimed = false;
          }
          if (persistenceOwner.claimed) {
            const error = new Error("WORLD_STAGE_PERSISTENCE_DUPLICATE");
            error.code = "WORLD_STAGE_PERSISTENCE_DUPLICATE";
            error.analysis_stage = "world_persistence_owner";
            error.retryable = false;
            throw error;
          }
          emitPersistenceTrace("WORLD_ACCEPTED", execution, target, {
            world_model_present: true,
            species_count: Array.isArray(model?.species) ? model.species.length : 0,
            biological_type_count: Array.isArray(model?.species)
              ? model.species.reduce((count, species) => count + (Array.isArray(species?.biological_types) ? species.biological_types.length : 0), 0)
              : 0,
          }, "world");
          assertToken(token);
          if (execution && !executionIsCurrent(execution)) {
            const error = requestAbortedError();
            error.analysis_stage = "world_post_accept_execution_guard";
            setExecutionCancellationMetadata(execution, {
              stage: "world_post_accept_execution_guard",
              reason: execution.cancel_reason ?? "execution-invalidated",
              code: execution.cancel_code ?? "REQUEST_ABORTED",
            });
            setExecutionDiagnostic(execution, {
              ...formatExecutionDiagnostic(error, error.analysis_stage),
              cancel_stage: execution.cancel_stage,
              cancel_reason: execution.cancel_reason,
              cancel_code: execution.cancel_code,
              execution_active: false,
              ...floorVersionComparison(execution.version, null),
              generation_id: execution.generation_id ?? null,
              generation_type: execution.generation_type ?? null,
              generation_identity_match: null,
            });
            throw error;
          }
          let currentAfterWorld;
          try {
            currentAfterWorld = await resolveFloorAtIndex({__messageIndex: true, index: target.index});
          } catch (cause) {
            if (!execution) throw cause;
            const error = requestAbortedError();
            error.analysis_stage = "world_post_accept_owner_guard";
            setExecutionCancellationMetadata(execution, {
              stage: "world_post_accept_owner_guard",
              reason: "floor-owner-unavailable",
              code: cause?.code ?? cause?.message ?? "REQUEST_ABORTED",
            });
            setExecutionDiagnostic(execution, {
              ...formatExecutionDiagnostic(error, error.analysis_stage),
              cancel_stage: execution.cancel_stage,
              cancel_reason: execution.cancel_reason,
              cancel_code: execution.cancel_code,
              execution_active: executionIsCurrent(execution),
              ...floorVersionComparison(execution.version, null),
            });
            throw error;
          }
          if (!sameFloorVersion(currentAfterWorld.version, target.version)) {
            invalidateExecution(execution, {
              stage: "world_post_accept_floor_version_guard",
              reason: "floor-version-changed-after-world-accepted",
              code: "STALE_FLOOR_VERSION",
              currentVersion: currentAfterWorld.version,
            });
            throw requestAbortedError();
          }
          const analyzedAt = new Date().toISOString();
          const saved = await saveWorldModel({
            model,
            meta: {...meta, last_analyzed_at: analyzedAt, last_saved_at: analyzedAt, last_saved_by: "ai", floor_version: {...target.version}},
            selector: target,
            automatic: true,
            traceExecution: execution,
            persistenceOwner,
          });
          assertToken(token);
          emitPersistenceTrace("WORLD_READBACK_BEGIN", execution, target, {}, "world");
          publishPhase("world_readback");
          publishPhase("world_ui_ready");
          const ready = await resolveWorldModelUiReady(target);
          emitPersistenceTrace("WORLD_READBACK_FOUND", execution, target, {world_model_present: Boolean(ready?.model)}, "world");
          emitPersistenceTrace("WORLD_READBACK_VALIDATED", execution, target, {floor_version_match: true, world_model_present: Boolean(ready?.model)}, "world");
          emitPersistenceTrace("WORLD_RUNTIME_STATE_UPDATED", execution, target, {world_model_present: Boolean(ready?.model)}, "world");
          emitPersistenceTrace("WORLD_PERSISTENCE_CONFIRMED", execution, target, {
            world_model_present: Boolean(ready?.model),
            species_count: Array.isArray(ready?.model?.species) ? ready.model.species.length : 0,
          }, "world");
          return {...saved, model: ready.view_model.model, view_model: ready.view_model};
        },
      });
    })();
    job.promise = work.then(
      result => {
        notify({
          type: "WORLD_ANALYSIS_STATUS_CHANGED",
          payload: {state: "success", mode, trigger, world_ready: true, floor_version: target.version},
          chatId: target.chatId,
        });
        return result;
      },
      error => {
        notify({
          type: "WORLD_ANALYSIS_STATUS_CHANGED",
          payload: {
            state: "failed",
            mode,
            trigger,
            floor_version: target.version,
            error_code: error?.code ?? error?.message ?? null,
            error_stage: error?.analysis_stage ?? null,
            diagnostic_code: error?.diagnostic_code ?? null,
          },
          chatId: target.chatId,
        });
        throw error;
      },
    ).finally(() => {
      job.released = true;
      if (worldInFlight.get(key) === job) worldInFlight.delete(key);
    });
    return job.promise;
  }

  async function analyzeCurrentWorldModelFull({analysisInput = {}, signal, trigger = "manual-full"} = {}) {
    if (!isEnabled()) throw disabledError();
    const token = getToken();
    const target = await resolveCurrentFloor();
    assertToken(token);
    return runWorldAnalysisJob(target, token, {mode: "full", analysisInput, signal, trigger});
  }

  async function analyzeCurrentWorldModelPatch({analysisInput = {}, signal, trigger = "manual-patch"} = {}) {
    if (!isEnabled()) throw disabledError();
    const token = getToken();
    const target = await resolveCurrentFloor();
    assertToken(token);
    const resolved = await resolveWorldModelAtOrBefore(target);
    if (!resolved) {
      const error = new Error("WORLD_MODEL_REQUIRED_FOR_PATCH");
      error.code = "WORLD_MODEL_REQUIRED_FOR_PATCH";
      throw error;
    }
    return runWorldAnalysisJob(target, token, {mode: "patch", analysisInput, signal, trigger});
  }

  async function resolveFinalWorldModelForAnalysis(target, token, execution, analysisInput, {force = false} = {}) {
    let resolved = await resolveWorldModelAtOrBefore(target);
    if (resolved && !force && !hasWorldModelUpdateSignal(target)) {
      try {
        setExecutionPhase(execution, "event_analysis");
        return (await resolveWorldModelUiReady(target, {requireCurrentFloor: false})).view_model.model;
      } catch (cause) {
        if (cause?.code === "WORLD_MODEL_UI_NOT_READY") throw cause;
        throw worldModelUnavailableError(cause, target);
      }
    }
    try {
      assertExecutionCurrent(execution, token);
      if (!resolved) setExecutionStage(execution, "world_analysis");
      else if (force || hasWorldModelUpdateSignal(target)) setExecutionStage(execution, "world_patch_analysis");
      else return normalizeStoredWorldModel(resolved.model);
      const result = await runWorldAnalysisJob(target, token, {
        mode: resolved ? "patch" : "full",
        analysisInput,
        signal: getExecutionSignal(execution),
        trigger: resolved ? "auto-patch" : "auto-full",
        execution,
        onPhase: phase => setExecutionPhase(execution, phase),
      });
      await assertExecutionCurrent(execution, token);
      clearInvalidatedFloor(target.version);
      setExecutionPhase(execution, "event_analysis");
      return buildWorldModelViewModel(result.model).model;
    } catch (cause) {
      if (cause?.code === "BIOWEAVE_DISABLED") throw cause;
      if (cause?.code === "WORLD_MODEL_UI_NOT_READY") throw cause;
      if (cause?.code === "WORLD_MODEL_PERSISTENCE_PREWRITE_FAILED" || cause?.code === "WORLD_MODEL_PERSISTENCE_READBACK_FAILED") throw cause;
      if (isRequestAborted(cause) || cause?.code === "REQUEST_ABORTED") throw cause;
      if (cause?.code === "SWIPE_NOT_FOUND" || cause?.code === "STALE_FLOOR_VERSION" || cause?.code === "BIOWEAVE_USER_FLOOR_WRITE_FORBIDDEN" || cause?.code === "FLOOR_PERSISTENCE_READBACK_FAILED")
        throw worldModelPersistenceError(cause, target);
      throw worldModelUnavailableError(cause, target);
    }
  }

  return {
    resolveWorldModelAtOrBefore,
    resolveWorldModelStrictlyBefore: selector => resolveWorldModelAtOrBefore(selector, {strictBefore: true}),
    resolvePersistedWorldModelForAnalysis,
    saveWorldModel,
    analyzeCurrentWorldModelFull,
    analyzeCurrentWorldModelPatch,
    resolveFinalWorldModelForAnalysis,
    clear: () => worldInFlight.clear(),
  };
}
