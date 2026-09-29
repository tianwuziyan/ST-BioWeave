import {
  buildWorldModelViewModel,
  mergeWorldModelSupplementPatch,
  normalizeStoredWorldModel,
  summarizeAnalysisInput,
} from "../ai/analyzer.js";
import {buildWorldModelSupplementCoverageTargets} from "../ai/world-supplement-protocol.js";
import {fingerprintWorldModel} from "../utils/world-model-debug.js";
import { emptyFloor } from "../storage/schema.js";
import {
  floorVersionFromData,
  sameFloorVersion,
} from "./floor.js";

const WORLD_MODEL_UPDATE_SIGNAL = /(?:世界规则|世界设定|物种规则|生物类型|biological[_\s-]*type|species\s*(?:rule|type)|生殖机制|受精机制|妊娠规则|怀孕规则|生殖能力|受孕能力|投影规则|projection[_\s-]*rule|can_(?:produce|be_fertilized|fertilize|cause_pregnancy|carry_pregnancy))/iu;
let worldFactDeltaDiagnosticSequence = 0;

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
  const completedWorldCandidates = new Map();
  let worldCandidateSequence = 0;
  let latestWorldModelDiagnostic = null;
  let recentFactDeltaExecutions = [];
  let recentWorldRequestTransitions = [];
  let lastIndependentWorldRequest = null;

  function canonicalWorldEqual(left, right) {
    if (left === null || left === undefined || right === null || right === undefined) return left === right;
    try {
      return JSON.stringify(normalizeStoredWorldModel(left)) === JSON.stringify(normalizeStoredWorldModel(right));
    } catch {
      return false;
    }
  }

  function classifyWorldModelFinalResult({summary = null, canonicalNoop = false, error = null, persistenceConfirmed = false} = {}) {
    const parsed = Number(summary?.parsed_fact_count ?? summary?.fact_count ?? 0);
    const acceptedOperations = Number(summary?.accepted_operation_count ?? 0);
    const rejected = Number(summary?.rejected_fact_count ?? 0);
    const attemptedFacts = parsed > 0;
    const allFactsRejected = attemptedFacts
      && acceptedOperations === 0
      && rejected >= parsed
      && Number(summary?.accepted_fact_count ?? 0) === 0;
    if (allFactsRejected) return 'ALL_FACTS_REJECTED';
    if (error) {
      const code = String(error.code ?? error.diagnostic_code ?? error.message ?? '');
      if (/ALL_FACTS_REJECTED/u.test(code)) return 'ALL_FACTS_REJECTED';
      if (/PERSIST|FLOOR|READBACK|RECONCILIATION/u.test(code)) return 'PERSISTENCE_FAILED';
      return 'ANALYSIS_FAILED';
    }
    if (canonicalNoop || (acceptedOperations === 0 && !attemptedFacts)) return 'NO_CHANGE';
    if (acceptedOperations > 0 && persistenceConfirmed) return 'UPDATED';
    return 'NO_CHANGE';
  }

  function normalizeFactDeltaDiagnostic(summary) {
    if (!summary || typeof summary !== 'object') return summary;
    const normalized = cloneWorldValue(summary);
    if (normalized.fact_delta_result === undefined && normalized.final_result !== undefined)
      normalized.fact_delta_result = normalized.final_result;
    delete normalized.final_result;
    delete normalized.persistence_occurred;
    return normalized;
  }

  function rememberFactDeltaExecution(executionId, target, mode, summary) {
    if (!executionId || !summary) return;
    const normalizedSummary = normalizeFactDeltaDiagnostic(summary);
    const entry = {
      execution_id: executionId,
      mode,
      floor_version: cloneWorldValue(target?.version),
      summary: normalizedSummary,
      candidate_reference: {
        execution_id: executionId,
        fingerprint: normalizedSummary?.mutation_source_candidate_fingerprint ?? null,
      },
      updated_at: new Date().toISOString(),
    };
    recentFactDeltaExecutions = [
      ...recentFactDeltaExecutions.filter(item => item.execution_id !== executionId),
      entry,
    ].slice(-8);
  }

  function worldModelAddressSet(model) {
    const addresses = new Set();
    for (const species of Array.isArray(model?.species) ? model.species : []) {
      addresses.add(`species.${species.name}`);
      for (const type of Array.isArray(species?.biological_types) ? species.biological_types : []) {
        const base = `species.${species.name}.biological_types.${type.name}`;
        addresses.add(base);
        for (const group of ['capabilities', 'reproduction_rules', 'lifecycle']) {
          for (const key of Object.keys(type?.[group] ?? {})) addresses.add(`${base}.${group}.${key}`);
        }
        for (const value of Array.isArray(type?.special_rules) ? type.special_rules : []) addresses.add(`${base}.special_rules.${String(value).slice(0, 80)}`);
        for (const mechanism of Array.isArray(type?.reproductive_mechanisms) ? type.reproductive_mechanisms : []) addresses.add(`${base}.reproductive_mechanisms.${mechanism.key ?? ''}`);
      }
    }
    for (const exception of Array.isArray(model?.exceptions) ? model.exceptions : []) addresses.add(`world.exceptions.${String(exception?.statement ?? '').slice(0, 80)}`);
    for (const value of Array.isArray(model?.unknowns) ? model.unknowns : []) addresses.add(`world.unknowns.${String(value).slice(0, 80)}`);
    for (const rule of Array.isArray(model?.projection_rules) ? model.projection_rules : []) addresses.add(`world.projection_rules.${rule.projection_rule_id ?? ''}`);
    return addresses;
  }

  function buildWorldRequestTransition(current) {
    const previous = lastIndependentWorldRequest;
    if (!previous) return null;
    const diff = (left, right) => [...new Set([...left].filter(value => !right.has(value)))].slice(0, 64);
    const previousAddresses = worldModelAddressSet(previous.model);
    const currentAddresses = worldModelAddressSet(current.model);
    const previousTargets = new Set(previous.target_ids ?? []);
    const currentTargets = new Set(current.target_ids ?? []);
    return {
      previous_execution_id: previous.execution_id,
      current_execution_id: current.execution_id,
      permitted_evidence: previous.evidence_fingerprint === current.evidence_fingerprint ? 'SAME' : 'CHANGED',
      existing_reference: previous.existing_fingerprint === current.existing_fingerprint ? 'SAME' : 'CHANGED',
      coverage_targets: previous.target_fingerprint === current.target_fingerprint ? 'SAME' : 'CHANGED',
      added_existing_addresses: diff(currentAddresses, previousAddresses),
      removed_existing_addresses: diff(previousAddresses, currentAddresses),
      added_target_ids: diff(currentTargets, previousTargets),
      removed_target_ids: diff(previousTargets, currentTargets),
      baseline_source: current.baseline_source,
      baseline_fingerprint: current.existing_fingerprint,
      mutation_source_execution_id: current.mutation_source_execution_id ?? null,
      mutation_source_candidate_fingerprint: current.mutation_source_candidate_fingerprint ?? null,
      mutation_persisted: current.mutation_persisted ?? null,
    };
  }

  function candidateError(code, details = {}) {
    const error = new Error(code);
    error.code = code;
    Object.assign(error, details);
    return error;
  }

  async function publishWorldModelCandidate({model, meta, target, execution, mode, trigger, executionId}) {
    const fingerprint = await fingerprintWorldModel(model);
    const candidate = {
      execution_id: executionId ?? `world-candidate-${Date.now()}-${++worldCandidateSequence}`,
      candidate_fingerprint: fingerprint.fingerprint,
      candidate_full_hash: fingerprint.full_hash,
      chat_id: target?.version?.chat_id ?? target?.chatId ?? null,
      floor_version: cloneWorldValue(target?.version ?? null),
      model: cloneWorldValue(model),
      meta: cloneWorldValue(meta),
      mode: mode ?? null,
      trigger: trigger ?? null,
      created_at: new Date().toISOString(),
    state: "VALIDATED",
    };
    for (const older of completedWorldCandidates.values()) {
      if (older.state !== "PERSISTING" && older.state !== "VALIDATED") continue;
      older.state = "SUPERSEDED";
      emitPersistenceTrace("WORLD_CANDIDATE_SUPERSEDED", execution, target, {
        execution_id: older.execution_id,
        candidate_fingerprint: older.candidate_fingerprint,
        superseded_by: candidate.execution_id,
      }, "world");
    }
    emitPersistenceTrace("WORLD_CANDIDATE_CREATED", execution, target, {
      execution_id: candidate.execution_id,
      candidate_fingerprint: candidate.candidate_fingerprint,
      candidate_full_hash: candidate.candidate_full_hash,
      candidate_state: candidate.state,
      candidate_created_at: candidate.created_at,
    }, "world");
    completedWorldCandidates.set(candidate.execution_id, candidate);
    while (completedWorldCandidates.size > 32)
      completedWorldCandidates.delete(completedWorldCandidates.keys().next().value);
    notify({
      type: "WORLD_CANONICAL_CANDIDATE_CREATED",
      payload: {
        state: "candidate_ready",
        execution_id: candidate.execution_id,
        candidate_fingerprint: candidate.candidate_fingerprint,
        candidate_full_hash: candidate.candidate_full_hash,
        candidate_created_at: candidate.created_at,
        chat_id: candidate.chat_id,
        floor_version: candidate.floor_version,
        model: candidate.model,
        meta: candidate.meta,
        mode: candidate.mode,
        trigger: candidate.trigger,
      },
      chatId: candidate.chat_id,
    });
    return candidate;
  }

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
    const job = {
      key,
      target,
      mode,
      trigger,
      signal,
      released: false,
      promise: null,
      diagnostic_execution_id: `world-fact-delta-${Date.now()}-${++worldFactDeltaDiagnosticSequence}`,
    };
    const persistenceOwner = {key, domain: "world", attempt: null, retryIndex: null, claimed: false};
    let formatRetryUsed = false;
    let supplementExecutionState = null;
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
      if (mode === "patch" && typeof analyzer?.analyzeWorldModelPatchV2 !== "function")
        throw worldModelUnavailableError(new Error("WORLD_PATCH_ANALYZER_UNAVAILABLE"), target);
      const completeWorldAnalysis = async ({model, meta, fact_delta_summary: factDeltaSummary, fact_delta_execution_id: factDeltaExecutionId}, {attempt, retryIndex}) => {
        factDeltaSummary = normalizeFactDeltaDiagnostic(factDeltaSummary);
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
          ...(factDeltaSummary ?? {}),
          execution_snapshot_present: mode === "patch" && Boolean(supplementExecutionState),
          execution_snapshot_mutated: mode === "patch" && Boolean(supplementExecutionState?.hasAcceptedMutation),
          execution_snapshot_accepted_operation_count: supplementExecutionState?.acceptedOperationCount ?? 0,
          execution_snapshot_successful_round_count: supplementExecutionState?.successfulRoundCount ?? 0,
          execution_snapshot_last_successful_round: supplementExecutionState?.lastSuccessfulRound ?? null,
          execution_snapshot_persistence_eligible: mode === "patch"
            ? Boolean(supplementExecutionState?.hasAcceptedMutation)
            : true,
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
          if (execution) {
            invalidateExecution(execution, {
              stage: "world_post_accept_floor_version_guard",
              reason: "floor-version-changed-after-world-accepted",
              code: "STALE_FLOOR_VERSION",
              currentVersion: currentAfterWorld.version,
            });
          }
          const error = requestAbortedError();
          error.analysis_stage = "world_post_accept_floor_version_guard";
          throw error;
        }
        const analyzedAt = new Date().toISOString();
        if (factDeltaSummary) {
          rememberFactDeltaExecution(
            factDeltaExecutionId ?? `${job.diagnostic_execution_id}-attempt-${attempt}`,
            target,
            mode,
            factDeltaSummary,
          );
        }
        if (factDeltaSummary?.fact_delta_result === 'ALL_FACTS_REJECTED' && !supplementExecutionState?.hasAcceptedMutation) {
          throw candidateError('WORLD_MODEL_SUPPLEMENT_ALL_FACTS_REJECTED', {
            analysis_stage: 'world_patch_v2_evidence_guard',
            retryable: false,
          });
        }
        const currentFloorData = getFloor(target.index, target.swipeId) ?? emptyFloor();
        const baselineModel = mode === "patch" && supplementExecutionState
          ? supplementExecutionState.baselineModel
          : currentFloorData.world_model;
        const canonicalNoop = canonicalWorldEqual(baselineModel, model)
          && (mode !== "patch" || Boolean(supplementExecutionState));
        if (canonicalNoop) {
          const noopFingerprint = await fingerprintWorldModel(model);
          emitPersistenceTrace("WORLD_PERSISTENCE_SKIPPED", execution, target, {
            reason: "canonical_noop",
            persistence_confirmed: false,
            canonical_mutation_occurred: false,
            accepted_operation_count: Number(factDeltaSummary?.accepted_operation_count) || 0,
            candidate_fingerprint: noopFingerprint.fingerprint,
            world_model_present: true,
          }, "world");
          emitPersistenceTrace("WORLD_RECONCILIATION_CONFIRMED", execution, target, {
            execution_id: null,
            candidate_fingerprint: noopFingerprint.fingerprint,
            reconciliation_status: "confirmed",
            reconciliation_fingerprint: noopFingerprint.fingerprint,
            persistence_confirmed: false,
          }, "world");
          latestWorldModelDiagnostic = {
            execution_id: execution?.diagnostic_execution_id ?? null,
            candidate_execution_id: null,
            candidate_fingerprint: noopFingerprint.fingerprint,
            candidate_state: "CANONICAL_NOOP",
            execution_result: classifyWorldModelFinalResult({summary: factDeltaSummary, canonicalNoop: true}),
            candidate_created_at: null,
            ui_projection_state: "NOT_REQUIRED",
            persistence_requested: false,
            persistence_confirmed: false,
            persisted_fingerprint: noopFingerprint.fingerprint,
            reconciliation_status: "confirmed",
            reconciliation_fingerprint: noopFingerprint.fingerprint,
            latest_world_fact_delta_execution_id: factDeltaSummary ? (factDeltaExecutionId ?? `${job.diagnostic_execution_id}-attempt-${attempt}`) : null,
            execution_snapshot_present: mode === "patch" && Boolean(supplementExecutionState),
            execution_snapshot_mutated: mode === "patch" && Boolean(supplementExecutionState?.hasAcceptedMutation),
            execution_snapshot_accepted_operation_count: supplementExecutionState?.acceptedOperationCount ?? 0,
            execution_snapshot_successful_round_count: supplementExecutionState?.successfulRoundCount ?? 0,
            execution_snapshot_last_successful_round: supplementExecutionState?.lastSuccessfulRound ?? null,
            execution_snapshot_persistence_eligible: false,
            latest_fact_delta: factDeltaSummary ? cloneWorldValue(factDeltaSummary) : null,
            latest_nonempty_fact_delta: [...recentFactDeltaExecutions].reverse().find(item => Number(item.summary?.parsed_fact_count ?? item.summary?.fact_count ?? 0) > 0) ?? null,
            recent_fact_delta_executions: cloneWorldValue(recentFactDeltaExecutions),
            request_transitions: cloneWorldValue(recentWorldRequestTransitions),
            mode,
            trigger,
            floor_version: cloneWorldValue(target.version),
            candidate_model: cloneWorldValue(model),
            runtime_model: cloneWorldValue(model),
            updated_at: new Date().toISOString(),
          };
          return {
            model: cloneWorldValue(model),
            view_model: buildWorldModelViewModel(model),
            floor_version: cloneWorldValue(target.version),
            persistence_skipped: true,
            candidate_execution_id: null,
            candidate_fingerprint: noopFingerprint.fingerprint,
            candidate_full_hash: noopFingerprint.full_hash,
            canonical_noop: true,
            execution_result: classifyWorldModelFinalResult({summary: factDeltaSummary, canonicalNoop: true}),
          };
        }
        const candidate = await publishWorldModelCandidate({
          model,
          meta,
          target,
          execution,
          mode,
          trigger,
          executionId: `${job.diagnostic_execution_id}-candidate-${attempt}`,
        });
        candidate.state = "PERSISTING";
        supplementExecutionState && (supplementExecutionState.persistenceRequested = true);
        emitPersistenceTrace("WORLD_PERSISTENCE_REQUESTED", execution, target, {
          execution_id: candidate.execution_id,
          candidate_fingerprint: candidate.candidate_fingerprint,
          persistence_requested: true,
        }, "world");
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
        const persistedFingerprint = await fingerprintWorldModel(ready?.model);
        const reconciliationStatus = persistedFingerprint.full_hash === candidate.candidate_full_hash
          ? "confirmed"
          : "mismatch";
        latestWorldModelDiagnostic = {
          execution_id: candidate.execution_id,
          candidate_execution_id: candidate.execution_id,
          candidate_fingerprint: candidate.candidate_fingerprint,
          candidate_state: candidate.state,
          execution_result: 'UPDATED',
          candidate_created_at: candidate.created_at,
          ui_projection_state: "PENDING",
          committed_fingerprint: persistedFingerprint.fingerprint,
          persistence_requested: true,
          persistence_confirmed: true,
          persisted_fingerprint: persistedFingerprint.fingerprint,
          reconciliation_status: reconciliationStatus,
          reconciliation_fingerprint: persistedFingerprint.fingerprint,
          latest_world_fact_delta_execution_id: factDeltaSummary ? (factDeltaExecutionId ?? `${job.diagnostic_execution_id}-attempt-${attempt}`) : null,
          execution_snapshot_present: mode === "patch" && Boolean(supplementExecutionState),
          execution_snapshot_mutated: mode === "patch" && Boolean(supplementExecutionState?.hasAcceptedMutation),
          execution_snapshot_accepted_operation_count: supplementExecutionState?.acceptedOperationCount ?? 0,
          execution_snapshot_successful_round_count: supplementExecutionState?.successfulRoundCount ?? 0,
          execution_snapshot_last_successful_round: supplementExecutionState?.lastSuccessfulRound ?? null,
          execution_snapshot_persistence_eligible: mode === "patch"
            ? Boolean(supplementExecutionState?.hasAcceptedMutation)
            : true,
          mode,
          trigger,
          floor_version: cloneWorldValue(target.version),
          candidate_model: cloneWorldValue(model),
          runtime_model: cloneWorldValue(ready?.model),
          fact_delta_summary: cloneWorldValue(factDeltaSummary ?? null),
          latest_fact_delta: factDeltaSummary ? cloneWorldValue(factDeltaSummary) : null,
          latest_nonempty_fact_delta: [...recentFactDeltaExecutions].reverse().find(item => Number(item.summary?.parsed_fact_count ?? item.summary?.fact_count ?? 0) > 0) ?? null,
          recent_fact_delta_executions: cloneWorldValue(recentFactDeltaExecutions),
          request_transitions: cloneWorldValue(recentWorldRequestTransitions),
          updated_at: new Date().toISOString(),
        };
        emitPersistenceTrace("WORLD_READBACK_FOUND", execution, target, {world_model_present: Boolean(ready?.model)}, "world");
        emitPersistenceTrace("WORLD_READBACK_VALIDATED", execution, target, {floor_version_match: true, world_model_present: Boolean(ready?.model)}, "world");
        emitPersistenceTrace("WORLD_RUNTIME_STATE_UPDATED", execution, target, {world_model_present: Boolean(ready?.model)}, "world");
        emitPersistenceTrace(
          reconciliationStatus === "confirmed" ? "WORLD_RECONCILIATION_CONFIRMED" : "WORLD_RECONCILIATION_MISMATCH",
          execution,
          target,
          {
            execution_id: candidate.execution_id,
            candidate_fingerprint: candidate.candidate_fingerprint,
            reconciliation_status: reconciliationStatus,
            reconciliation_fingerprint: persistedFingerprint.fingerprint,
            persisted_fingerprint: persistedFingerprint.fingerprint,
          },
          "world",
        );
        if (reconciliationStatus !== "confirmed") {
          const error = candidateError("WORLD_UI_FLOOR_RECONCILIATION_MISMATCH", {
            analysis_stage: "world_reconciliation",
            candidate_fingerprint: candidate.candidate_fingerprint,
            persisted_fingerprint: persistedFingerprint.fingerprint,
          });
          throw error;
        }
        emitPersistenceTrace("WORLD_PERSISTENCE_CONFIRMED", execution, target, {
          execution_id: candidate.execution_id,
          candidate_fingerprint: candidate.candidate_fingerprint,
          world_model_present: Boolean(ready?.model),
          species_count: Array.isArray(ready?.model?.species) ? ready.model.species.length : 0,
          ...(factDeltaSummary ?? {}),
          persistence_confirmed: true,
        }, "world");
        if (supplementExecutionState) supplementExecutionState.persistenceConfirmed = true;
        candidate.state = "PERSISTED";
        notify({
          type: "WORLD_PERSISTENCE_CONFIRMED",
          payload: {
            execution_id: candidate.execution_id,
            candidate_fingerprint: candidate.candidate_fingerprint,
            candidate_full_hash: candidate.candidate_full_hash,
            model: cloneWorldValue(ready?.model),
            meta: cloneWorldValue(ready?.meta ?? saved?.meta ?? null),
            floor_version: cloneWorldValue(ready?.floor_version ?? target.version),
            persistence_confirmed: true,
            authoritative: true,
          },
          chatId: target.chatId,
        });
        if (lastIndependentWorldRequest?.execution_id === job.diagnostic_execution_id) {
          lastIndependentWorldRequest = {
            ...lastIndependentWorldRequest,
            mutation_persisted: true,
            mutation_source_candidate_fingerprint: candidate.candidate_fingerprint,
          };
        }
        return {
          ...saved,
          model: ready.view_model.model,
          view_model: ready.view_model,
          candidate_execution_id: candidate.execution_id,
          candidate_fingerprint: candidate.candidate_fingerprint,
          candidate_full_hash: candidate.candidate_full_hash,
          final_result: 'UPDATED',
        };
      };
      try {
        return await runAnalysisStageWithRetry({
        domain: "world",
        target,
        token,
        execution,
        signal,
        trigger,
        invoke: async ({attempt, retryIndex}) => {
          let meta;
          let model;
          if (mode === "full") {
            const fullAnalysisInput = {...(analysisInput ?? {})};
            delete fullAnalysisInput.world_model;
            model = normalizeStoredWorldModel(await analyzer.analyzeWorldModel({
              analysisInput: fullAnalysisInput,
              floor_version: target.version,
              authoritative_floor_version: target.version,
              signal,
            }));
            meta = {source: "world-full-analysis", source_summary: summarizeAnalysisInput(analysisInput)};
          } else {
            const factDeltaExecutionId = `${job.diagnostic_execution_id}-attempt-${attempt}`;
            const resolved = supplementExecutionState
              ? {
                  model: supplementExecutionState.transientModel,
                  meta: supplementExecutionState.meta,
                }
              : await resolveWorldModelAtOrBefore(target);
            if (!resolved) {
              const error = new Error("WORLD_MODEL_REQUIRED_FOR_PATCH");
              error.code = "WORLD_MODEL_REQUIRED_FOR_PATCH";
              error.analysis_stage = "world_preflight";
              throw error;
            }
            if (!supplementExecutionState) {
              const initialTargets = buildWorldModelSupplementCoverageTargets(resolved.model);
              supplementExecutionState = {
                baselineModel: cloneWorldValue(resolved.model),
                transientModel: cloneWorldValue(resolved.model),
                meta: cloneWorldValue(resolved.meta ?? {}),
                rounds: [],
                initialTargetCount: initialTargets.length,
                hasAcceptedMutation: false,
                acceptedOperationCount: 0,
                successfulRoundCount: 0,
                lastSuccessfulRound: null,
                snapshotFingerprint: null,
                lastFactDeltaSummary: null,
                lastAttemptFailed: false,
                persistenceRequested: false,
                persistenceConfirmed: false,
              };
            }
            const baselineFingerprint = await fingerprintWorldModel(resolved.model);
            const baselineSource = "AUTHORITATIVE_FLOOR";
            const patchAnalysisInput = {
              ...(analysisInput ?? {}),
              world_model: cloneWorldValue(resolved.model),
              supplement_candidate: cloneWorldValue(resolved.model),
              supplement_request_mode: "INITIAL",
              ...(formatRetryUsed
                ? {supplement_retry_directive: {kind: "format_retry", items: []}}
                : {}),
            };
            const inputTargets = buildWorldModelSupplementCoverageTargets(resolved.model);
            const initialTargetKeys = new Set(inputTargets.map(target => [
              target.scope ?? '',
              target.species ?? '',
              target.biological_type ?? '',
              target.field ?? '',
            ].join('\u001f')));
            const mergeAcceptedSupplementPatch = async (patch, summary, snapshotModel = null) => {
              const previousSnapshot = supplementExecutionState.transientModel;
              const candidateModel = snapshotModel
                ? cloneWorldValue(snapshotModel)
                : mergeWorldModelSupplementPatch(
                    previousSnapshot,
                    patch,
                    patchAnalysisInput,
                  );
              const snapshotChanged = !canonicalWorldEqual(previousSnapshot, candidateModel);
              supplementExecutionState.transientModel = cloneWorldValue(candidateModel);
              const snapshotSummary = summary && typeof summary === "object"
                ? {
                    ...summary,
                    ...(Array.isArray(summary.fact_mappings)
                      ? {
                          fact_mappings: summary.fact_mappings.map(mapping => ({
                            ...mapping,
                            snapshot_applied: snapshotChanged && mapping.guard_status === "accepted",
                          })),
                        }
                      : {}),
                  }
                : summary;
              supplementExecutionState.lastFactDeltaSummary = cloneWorldValue(snapshotSummary ?? null);
              if (snapshotChanged) {
                supplementExecutionState.hasAcceptedMutation = true;
                supplementExecutionState.acceptedOperationCount += Number(summary?.accepted_operation_count)
                  || Number(patch?.operations?.length)
                  || 0;
                supplementExecutionState.successfulRoundCount += 1;
                supplementExecutionState.lastSuccessfulRound = supplementExecutionState.rounds.length + 1;
                supplementExecutionState.snapshotFingerprint = (await fingerprintWorldModel(candidateModel)).fingerprint;
              }
              return {candidateModel, snapshotChanged, snapshotSummary};
            };
            let patchResult;
            let factDeltaSummary = null;
            try {
              patchResult = await analyzer.analyzeWorldModelPatchV2({
                analysisInput: patchAnalysisInput,
                // Coverage/identity metadata is diagnostic only. Supplement
                // accepts one response; semantic incompleteness is not a
                // continuation request or a second model call.
                require_supplement_completeness: false,
                floor_version: target.version,
                authoritative_floor_version: target.version,
                signal,
                fact_delta_attempt: attempt,
                fact_delta_retry_index: retryIndex,
                onFactDeltaTrace: details => {
                  if (details.stage === "WORLD_FACT_DELTA_RESOLVED") {
                    factDeltaSummary = cloneWorldValue(details);
                  }
                  emitPersistenceTrace(details.stage, execution, target, {
                    ...details,
                    execution_id: factDeltaExecutionId,
                    attempt,
                    retry_index: retryIndex,
                    mode: "patch",
                  }, "world");
                  },
                });
              const baseSummary = patchResult
                ? {
                    ...cloneWorldValue(patchResult.fact_delta_summary ?? {}),
                    fact_count: Array.isArray(patchResult.facts) ? patchResult.facts.length : null,
                    ...(Array.isArray(factDeltaSummary?.fact_mappings)
                      ? {fact_mappings: cloneWorldValue(factDeltaSummary.fact_mappings)}
                      : {}),
                  }
                : {};
              const {candidateModel, snapshotSummary} = await mergeAcceptedSupplementPatch(
                patchResult?.patch ?? patchResult,
                baseSummary,
                patchResult?.snapshot_model ?? null,
              );
              if (Array.isArray(snapshotSummary?.fact_mappings))
                baseSummary.fact_mappings = cloneWorldValue(snapshotSummary.fact_mappings);
              const candidateFingerprint = await fingerprintWorldModel(candidateModel);
              const requestEnvelope = baseSummary.request_envelope ?? {};
              const requestSnapshot = {
                execution_id: job.diagnostic_execution_id,
                model: cloneWorldValue(resolved.model),
                evidence_fingerprint: requestEnvelope.permitted_evidence_fingerprint ?? null,
                existing_fingerprint: requestEnvelope.existing_reference_fingerprint ?? baselineFingerprint.fingerprint,
                target_fingerprint: requestEnvelope.coverage_target_set_fingerprint ?? null,
                target_ids: inputTargets.map(item => item.target_id),
                baseline_source: baselineSource,
                mutation_source_execution_id: Number(baseSummary.accepted_operation_count) > 0 ? factDeltaExecutionId : null,
                mutation_source_candidate_fingerprint: Number(baseSummary.accepted_operation_count) > 0 ? candidateFingerprint.fingerprint : null,
                mutation_persisted: null,
              };
              const requestTransition = baselineSource === "AUTHORITATIVE_FLOOR"
                ? buildWorldRequestTransition(requestSnapshot)
                : null;
              if (baselineSource === "AUTHORITATIVE_FLOOR") {
                lastIndependentWorldRequest = requestSnapshot;
                if (requestTransition) recentWorldRequestTransitions = [...recentWorldRequestTransitions, requestTransition].slice(-8);
              }
              const dispositionById = new Map(
                (Array.isArray(baseSummary.coverage_dispositions) ? baseSummary.coverage_dispositions : [])
                  .map(item => [item.target_id, item.disposition]),
              );
              const candidateTargets = buildWorldModelSupplementCoverageTargets(candidateModel);
              const dynamicTargets = candidateTargets.filter(target => !initialTargetKeys.has([
                target.scope ?? '',
                target.species ?? '',
                target.biological_type ?? '',
                target.field ?? '',
              ].join('\u001f')));
              const unresolvedDynamicTargets = dynamicTargets;
              const acceptedNewIdentityCount = Number(baseSummary.accepted_new_type_identity_count) || 0;
              const roundSummary = {
                record_index: supplementExecutionState.rounds.length + 1,
                input_target_count: inputTargets.length,
                reviewed_target_count: dispositionById.size,
                emitted_count: [...dispositionById.values()].filter(value => value === 'EMITTED').length,
                no_evidence_count: [...dispositionById.values()].filter(value => value === 'NO_EVIDENCE').length,
                accepted_fact_count: Number(baseSummary.accepted_fact_count) || 0,
                accepted_operation_count: Number(baseSummary.accepted_operation_count) || 0,
                new_identity_count: acceptedNewIdentityCount,
                expanded_target_count: dynamicTargets.length,
                unaccounted_target_count: unresolvedDynamicTargets.length,
              };
              supplementExecutionState.rounds.push(roundSummary);
              factDeltaSummary = {
                ...baseSummary,
                baseline_source: baselineSource,
                baseline_execution_id: baselineSource === "TRANSIENT_CANDIDATE" ? job.diagnostic_execution_id : null,
                baseline_fingerprint: baselineFingerprint.fingerprint,
                request_transition: requestTransition,
                mutation_source_execution_id: requestSnapshot.mutation_source_execution_id,
                mutation_source_candidate_fingerprint: requestSnapshot.mutation_source_candidate_fingerprint,
                coverage_initial_target_count: supplementExecutionState.initialTargetCount,
                coverage_current_target_count: candidateTargets.length,
                dynamic_coverage_target_count: dynamicTargets.length,
                dynamic_coverage_target_ids: dynamicTargets.slice(0, 64).map(item => item.target_id),
                unaccounted_dynamic_target_count: unresolvedDynamicTargets.length,
                unaccounted_dynamic_target_ids: unresolvedDynamicTargets.slice(0, 64).map(item => item.target_id),
                derived_target_accounting_records: cloneWorldValue(supplementExecutionState.rounds.slice(-16)),
                derived_target_accounting_complete: unresolvedDynamicTargets.length === 0,
                dynamic_coverage_unaccounted_in_single_response: unresolvedDynamicTargets.length > 0,
              };
              factDeltaSummary.fact_delta_result = classifyWorldModelFinalResult({summary: factDeltaSummary});
              supplementExecutionState.lastFactDeltaSummary = cloneWorldValue(factDeltaSummary);
            } catch (error) {
              if (error?.accepted_patch?.operations?.length) {
                factDeltaSummary = cloneWorldValue(error.accepted_fact_delta_summary ?? {
                  accepted_operation_count: error.accepted_patch.operations.length,
                  canonical_mutation_occurred: true,
                  completeness_required: true,
                  completeness_satisfied: false,
                });
                const {candidateModel, snapshotSummary} = await mergeAcceptedSupplementPatch(
                  error.accepted_patch,
                  factDeltaSummary,
                );
                if (Array.isArray(snapshotSummary?.fact_mappings))
                  factDeltaSummary.fact_mappings = cloneWorldValue(snapshotSummary.fact_mappings);
                supplementExecutionState.lastFactDeltaSummary = cloneWorldValue(factDeltaSummary);
                supplementExecutionState.rounds.push({
                  record_index: supplementExecutionState.rounds.length + 1,
                  input_target_count: inputTargets.length,
                  reviewed_target_count: 0,
                  emitted_count: 0,
                  no_evidence_count: 0,
                  accepted_fact_count: Number(factDeltaSummary.accepted_fact_count) || 0,
                  accepted_operation_count: Number(factDeltaSummary.accepted_operation_count) || error.accepted_patch.operations.length,
                  new_identity_count: Number(factDeltaSummary.accepted_new_type_identity_count) || 0,
                  expanded_target_count: buildWorldModelSupplementCoverageTargets(candidateModel).length,
                  unaccounted_target_count: 0,
                });
              }
              if (error?.code === "WORLD_MODEL_SUPPLEMENT_INCOMPLETE") {
                const semanticFailureSummary = {
                  ...(factDeltaSummary ?? {
                    analysis_stage_succeeded: false,
                    completeness_required: true,
                    completeness_satisfied: false,
                  }),
                  completeness_satisfied: false,
                  semantic_incomplete: true,
                  semantic_failure_code: error?.diagnostic_code ?? error?.code ?? "WORLD_MODEL_SUPPLEMENT_INCOMPLETE",
                  semantic_diagnostics: error?.diagnostics ? cloneWorldValue(error.diagnostics) : [],
                  analysis_outcome: "COMPLETED_WITH_SEMANTIC_DIAGNOSTICS",
                };
                semanticFailureSummary.fact_delta_result = classifyWorldModelFinalResult({summary: semanticFailureSummary});
                rememberFactDeltaExecution(
                  factDeltaExecutionId,
                  target,
                  mode,
                  semanticFailureSummary,
                );
                supplementExecutionState.lastFactDeltaSummary = cloneWorldValue(semanticFailureSummary);
                factDeltaSummary = semanticFailureSummary;
              } else if (error?.format_retryable === true) {
                if (!formatRetryUsed) {
                  formatRetryUsed = true;
                  error.retry_kind = "format_retry";
                  error.analysis_stage = "supplement_format";
                } else {
                  error.format_retry_exhausted = true;
                  error.analysis_stage = "supplement_format";
                }
              }
              const failureSummary = {
                ...(factDeltaSummary ?? {
                  analysis_stage_succeeded: false,
                  completeness_required: true,
                  completeness_satisfied: false,
                }),
                completeness_satisfied: false,
                failure_stage: error?.analysis_stage ?? "supplement_completeness",
                failure_code: error?.diagnostic_code ?? error?.code ?? error?.message ?? "WORLD_MODEL_SUPPLEMENT_FAILED",
                ...(error?.diagnostic_code ? {diagnostic_code: error.diagnostic_code} : {}),
                ...(error?.diagnostics ? {completeness_diagnostics: cloneWorldValue(error.diagnostics)} : {}),
              };
              if (error?.code !== "WORLD_MODEL_SUPPLEMENT_INCOMPLETE") {
                failureSummary.fact_delta_result = classifyWorldModelFinalResult({summary: failureSummary, error});
                rememberFactDeltaExecution(
                  factDeltaExecutionId,
                  target,
                  mode,
                  failureSummary,
                );
                supplementExecutionState.lastFactDeltaSummary = cloneWorldValue(failureSummary);
                throw error;
              }
            }
            model = cloneWorldValue(supplementExecutionState.transientModel);
            meta = {
              ...cloneWorldValue(resolved.meta ?? {}),
              source: "world-patch-analysis",
              source_summary: summarizeAnalysisInput(analysisInput),
            };
            return {
              model,
              meta,
              fact_delta_summary: factDeltaSummary,
              fact_delta_execution_id: factDeltaExecutionId,
              require_supplement_completeness: false,
            };
          }
          return {model, meta};
        },
        complete: completeWorldAnalysis,
      });
      } catch (error) {
        const snapshot = supplementExecutionState;
        const canPersistSnapshot = mode === "patch"
          && snapshot?.hasAcceptedMutation
          && !snapshot.persistenceRequested
          && !isRequestAborted(error)
          && error?.code !== "STALE_FLOOR_VERSION"
          && error?.code !== "STALE_SWIPE"
          && error?.code !== "SWIPE_NOT_FOUND"
          && error?.code !== "BIOWEAVE_USER_FLOOR_WRITE_FORBIDDEN"
          && (!execution || executionIsCurrent(execution));
        if (canPersistSnapshot) {
          snapshot.lastAttemptFailed = true;
          const failureAttempt = Number(execution?.stage_attempt) || snapshot.rounds.length + 1;
          const failureRetryIndex = Math.max(0, failureAttempt - 1);
          try {
            const recovered = await completeWorldAnalysis({
              model: cloneWorldValue(snapshot.transientModel),
              meta: cloneWorldValue(snapshot.meta),
              fact_delta_summary: cloneWorldValue(snapshot.lastFactDeltaSummary),
              fact_delta_execution_id: `${job.diagnostic_execution_id}-snapshot-recovery`,
            }, {attempt: failureAttempt, retryIndex: failureRetryIndex});
            latestWorldModelDiagnostic = {
              ...(latestWorldModelDiagnostic ?? {}),
              execution_id: job.diagnostic_execution_id,
              last_attempt_failed: true,
              snapshot_preserved: true,
              execution_snapshot_present: true,
              execution_snapshot_mutated: true,
              execution_snapshot_accepted_operation_count: snapshot.acceptedOperationCount,
              execution_snapshot_successful_round_count: snapshot.successfulRoundCount,
              execution_snapshot_last_successful_round: snapshot.lastSuccessfulRound,
              execution_snapshot_persistence_eligible: true,
              persistence_requested: true,
              persistence_confirmed: snapshot.persistenceConfirmed,
              execution_result: snapshot.persistenceConfirmed ? "UPDATED_AFTER_RETRY_FAILURE" : "PERSISTENCE_FAILED",
              last_attempt_failure_code: error?.code ?? error?.message ?? "ANALYSIS_FAILED",
              candidate_model: cloneWorldValue(snapshot.transientModel),
              runtime_model: cloneWorldValue(recovered?.model ?? snapshot.transientModel),
              updated_at: new Date().toISOString(),
            };
            emitPersistenceTrace("WORLD_SNAPSHOT_PERSISTED_AFTER_ATTEMPT_FAILURE", execution, target, {
              last_attempt_failed: true,
              snapshot_preserved: true,
              execution_snapshot_present: true,
              execution_snapshot_mutated: true,
              execution_snapshot_accepted_operation_count: snapshot.acceptedOperationCount,
              execution_snapshot_successful_round_count: snapshot.successfulRoundCount,
              execution_snapshot_last_successful_round: snapshot.lastSuccessfulRound,
              execution_snapshot_persistence_eligible: true,
              persistence_requested: true,
              persistence_confirmed: snapshot.persistenceConfirmed,
              failure_code: error?.code ?? error?.message ?? "ANALYSIS_FAILED",
            }, "world");
            return {
              ...recovered,
              final_result: "UPDATED",
              last_attempt_failed: true,
              snapshot_preserved: true,
              user_visible_outcome: "SUCCESS",
            };
          } catch (persistenceError) {
            persistenceError.cause = error;
            throw persistenceError;
          }
        }
        throw error;
      }
    })();
    job.promise = work.then(
      result => {
        notify({
          type: "WORLD_ANALYSIS_STATUS_CHANGED",
          payload: {
            state: "success",
            mode,
            trigger,
            world_ready: true,
            floor_version: target.version,
            execution_id: result?.candidate_execution_id ?? job.diagnostic_execution_id,
            candidate_fingerprint: result?.candidate_fingerprint ?? null,
            persistence_confirmed: result?.persistence_skipped !== true,
            final_result: result?.final_result ?? null,
          },
          chatId: target.chatId,
        });
        return result;
      },
      error => {
        const latestFactDelta = recentFactDeltaExecutions.at(-1) ?? null;
        if (latestFactDelta) {
          latestWorldModelDiagnostic = {
            ...(latestWorldModelDiagnostic?.snapshot_preserved ? latestWorldModelDiagnostic : {}),
            execution_id: job.diagnostic_execution_id,
            latest_world_fact_delta_execution_id: latestFactDelta.execution_id,
            latest_fact_delta: cloneWorldValue(latestFactDelta.summary),
            execution_result: classifyWorldModelFinalResult({summary: latestFactDelta.summary, error}),
            latest_nonempty_fact_delta: [...recentFactDeltaExecutions].reverse().find(item => Number(item.summary?.parsed_fact_count ?? item.summary?.fact_count ?? 0) > 0) ?? null,
            recent_fact_delta_executions: cloneWorldValue(recentFactDeltaExecutions),
            request_transitions: cloneWorldValue(recentWorldRequestTransitions),
            mode,
            trigger,
            floor_version: cloneWorldValue(target.version),
            candidate_model: latestWorldModelDiagnostic?.snapshot_preserved
              ? latestWorldModelDiagnostic.candidate_model
              : null,
            runtime_model: latestWorldModelDiagnostic?.snapshot_preserved
              ? latestWorldModelDiagnostic.runtime_model
              : null,
            updated_at: new Date().toISOString(),
          };
        }
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
    getWorldModelDiagnosticState: () => cloneWorldValue(latestWorldModelDiagnostic),
    clear: () => {
      worldInFlight.clear();
      completedWorldCandidates.clear();
      latestWorldModelDiagnostic = null;
      recentFactDeltaExecutions = [];
      recentWorldRequestTransitions = [];
      lastIndependentWorldRequest = null;
    },
  };
}
