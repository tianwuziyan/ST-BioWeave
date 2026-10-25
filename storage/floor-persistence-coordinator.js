import {cloneValue, emptyFloor} from "./schema.js";
import {
  floorVersionFromData,
  hasCompleteFloorVersion,
  normalizeFloorOwner,
  sameFloorVersion,
} from "../runtime/floor.js";
import {durationMs, monotonicNow} from "../runtime/diagnostics.js";

export const FLOOR_OWNER_FIELDS = Object.freeze({
  world: Object.freeze(["world_model", "world_model_meta"]),
  event: Object.freeze(["analysis", "events", "character_registry"]),
  projection: Object.freeze(["snapshot", "projection_timeline", "projection_timing_snapshot"]),
  tracking: Object.freeze(["tracking_window_timeline"]),
  participant_aggregation: Object.freeze(["participant_aggregation_snapshot"]),
  lifecycle: Object.freeze(["pregnancy_lifecycle_timeline", "events"]),
  health: Object.freeze(["health_assessment_timeline"]),
  // Terminal attempts persist only the analysis status record. Existing
  // Events/registry are latest-state siblings and are never terminal-owned.
  terminal: Object.freeze(["analysis"]),
});

const VERSION_FIELD = "floor_version";
const VERSION_FIELDS = Object.freeze([
  "chat_id", "message_id", "floor", "swipe_id",
]);
const SIBLING_FIELDS = Object.freeze(Object.values(FLOOR_OWNER_FIELDS)
  .flat().filter((field, index, fields) => fields.indexOf(field) === index));

function coordinatorError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function clone(value) {
  return cloneValue(value);
}

function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function ownerSelector(input = {}) {
  const owner = input.ownerFloor ?? input.owner ?? {};
  return owner.message_index ?? owner.messageIndex ?? owner.index ??
    input.messageIndex ?? input.message_index ?? input.selector;
}

function ownerSwipe(input = {}, version = {}) {
  const value = input.swipeId ?? input.swipe_id ??
    input.ownerFloor?.swipe_id ?? input.ownerFloor?.swipeId ?? version.swipe_id;
  return Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
}

function safeVersion(version) {
  if (!version || typeof version !== "object") return null;
  return Object.fromEntries(VERSION_FIELDS.map(field => [field, version[field] ?? null]));
}

function versionAudit(expected, actual) {
  const expectedValue = safeVersion(expected);
  const actualValue = safeVersion(actual);
  const mismatchFields = VERSION_FIELDS.filter(field => expectedValue?.[field] !== actualValue?.[field]);
  return {
    expected: expectedValue,
    actual: actualValue,
    mismatch_fields: mismatchFields,
  };
}

function transactionKey(version) {
  return VERSION_FIELDS.map(field => String(version?.[field] ?? "")).join("/");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function equalValue(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function serializeEventSnapshot(events, existingEvents) {
  if (!Array.isArray(events)) return events;
  const legacyDayIndexEventIds = new Set(
    (Array.isArray(existingEvents) ? existingEvents : [])
      .filter(event => Object.prototype.hasOwnProperty.call(event?.story_time ?? {}, "day_index"))
      .map(event => event?.event_id)
      .filter(eventId => eventId !== undefined && eventId !== null),
  );
  return events.map(event => {
    if (!event || typeof event !== "object" || Array.isArray(event)) return clone(event);
    const next = clone(event);
    const storyTime = next.story_time;
    if (!storyTime || typeof storyTime !== "object" || Array.isArray(storyTime)) return next;
    if (!legacyDayIndexEventIds.has(next.event_id)) {
      delete storyTime.day_index;
      delete storyTime.dayIndex;
    }
    return next;
  });
}

function preparePersistedPatch(owner, patch, latest) {
  if (!patch || !Array.isArray(patch.events) || !["event", "lifecycle"].includes(owner))
    return patch;
  return {
    ...patch,
    events: serializeEventSnapshot(patch.events, latest?.events),
  };
}

function presence(slot = {}) {
  return Object.fromEntries(SIBLING_FIELDS.map(field => [
    `${field}_present`, hasOwn(slot, field) && slot[field] !== undefined,
  ]));
}

function assertPatch(owner, patch, version, operationType) {
  if (!FLOOR_OWNER_FIELDS[owner]) throw coordinatorError("FLOOR_TX_OWNER_INVALID", {owner});
  if (owner === "terminal" && !String(operationType ?? "").toLowerCase().startsWith("terminal"))
    throw coordinatorError("FLOOR_TX_TERMINAL_OPERATION_REQUIRED");
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    throw coordinatorError("FLOOR_TX_PATCH_INVALID");
  const allowed = new Set(FLOOR_OWNER_FIELDS[owner]);
  const next = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === VERSION_FIELD) {
      if (!sameFloorVersion(value, version))
        throw coordinatorError("FLOOR_TX_VERSION_MISMATCH");
      continue;
    }
    if (!allowed.has(key)) throw coordinatorError("FLOOR_TX_PATCH_FORBIDDEN", {owner, field: key});
    next[key] = clone(value);
  }
  return next;
}

function executionCurrent(input, isExecutionCurrent) {
  const execution = input?.execution;
  if (input?.assertCurrent === false) return false;
  if (execution?.signal?.aborted || execution?.cancelRequested || execution?.cancelled ||
      execution?.invalidated || execution?.released || execution?.superseded ||
      execution?.active === false || execution?.valid === false) return false;
  if (typeof isExecutionCurrent === "function" && isExecutionCurrent(execution) === false)
    return false;
  if (typeof execution?.isCurrent === "function" && execution.isCurrent() === false)
    return false;
  return true;
}

export function createFloorPersistenceCoordinator({
  store,
  resolveCurrentContext = null,
  resolveCurrentFloorVersion = null,
  trace = () => {},
  performanceStage = null,
  enabledResolver = () => true,
  isExecutionCurrent = null,
} = {}) {
  if (!store || typeof store.getFloor !== "function" || typeof store.saveFloor !== "function")
    throw new TypeError("FLOOR_TX_STORE_REQUIRED");
  const tails = new Map();
  const queueDepths = new Map();
  let sequence = 0;

  function emit(stage, transaction, details = {}) {
    try {
      const traceContext = transaction.traceContext ?? {};
      trace({
        type: "FLOOR_TX_TRACE",
        stage,
        floor_transaction_id: transaction.floor_transaction_id,
        transaction_key: transaction.transaction_key,
        owner: transaction.owner,
        operation_type: transaction.operation_type,
        ...safeVersion(transaction.floorVersion),
        execution_attempt: transaction.execution_attempt ?? null,
        stage_attempt: transaction.stage_attempt ?? null,
        retry_index: transaction.retry_index ?? null,
        analysis_execution_id: traceContext.analysis_execution_id ?? null,
        generation_id: traceContext.generation_id ?? null,
        generation_intent_id: traceContext.generation_intent_id ?? null,
        generation_type: traceContext.generation_type ?? null,
        generation_ended: traceContext.generation_ended ?? null,
        generation_settled: traceContext.generation_settled ?? null,
        event_edit_operation_id: traceContext.event_edit_operation_id ?? null,
        performance_operation_id: traceContext.performance_operation_id ?? null,
        persistence_kind: traceContext.persistence_kind ?? null,
        scheduler_revision: traceContext.scheduler_revision ?? null,
        source_text_length: traceContext.source_text_length ?? null,
        message_index: traceContext.message_index ?? transaction.ownerFloor?.message_index ?? null,
        ...(traceContext.event_edit_operation_id
          ? {duration_ms: durationMs(transaction.started_at)}
          : {}),
        ...details,
      });
    } catch { /* diagnostics never change persistence */ }
  }

  function emitPerformanceStage(transaction, stage, details = {}) {
    const operationId = transaction?.traceContext?.performance_operation_id;
    if (!operationId || typeof performanceStage !== "function") return;
    try {
      performanceStage({
        operation_id: operationId,
        stage,
        kind: "ASYNC",
        persistence_kind: transaction.traceContext?.persistence_kind ?? null,
        ...details,
      });
    } catch { /* performance diagnostics never change persistence */ }
  }

  function authoritativeReadTraceContext(transaction, ioPurpose) {
    return {
      ...transaction.traceContext,
      floor_transaction_id: transaction.floor_transaction_id,
      transaction_key: transaction.transaction_key,
      persistence_kind: transaction.traceContext?.persistence_kind ?? null,
      io_purpose: ioPurpose,
    };
  }

  async function measurePerformanceStage(transaction, stage, callback, details = {}) {
    const startedAt = monotonicNow();
    try {
      const result = await callback();
      const elapsed = durationMs(startedAt);
      emitPerformanceStage(transaction, stage, {
        status: "SUCCEEDED",
        duration_ms: elapsed,
        ...(stage === "STORE_SAVE_FLOOR" ? {store_save_duration_ms: elapsed} : {}),
        ...details,
      });
      return result;
    } catch (cause) {
      const elapsed = durationMs(startedAt);
      emitPerformanceStage(transaction, stage, {
        status: "FAILED",
        duration_ms: elapsed,
        ...(stage === "STORE_SAVE_FLOOR" ? {store_save_duration_ms: elapsed} : {}),
        reason_code: details.reason_code ?? "FLOOR_PERSISTENCE_STAGE_FAILED",
        error_code: cause?.code ?? cause?.message ?? "FLOOR_PERSISTENCE_STAGE_FAILED",
        ...details,
      });
      throw cause;
    }
  }

  async function resolveLive(input, transaction) {
    const fallbackSelector = ownerSelector(input);
    const fallbackSwipe = ownerSwipe(input, transaction.floorVersion);
    if (typeof resolveCurrentContext === "function") {
      const resolved = await resolveCurrentContext({input, transaction});
      if (resolved) return {
        ...resolved,
        selector: resolved.selector ?? fallbackSelector,
        swipeId: resolved.swipeId ?? fallbackSwipe,
      };
    }
    const floorData = store.getFloor(fallbackSelector, fallbackSwipe) ?? emptyFloor();
    return {
      chatId: transaction.floorVersion.chat_id,
      selector: fallbackSelector,
      swipeId: fallbackSwipe,
      owner: store.getFloorOwner?.(fallbackSelector, fallbackSwipe),
      floorData,
      // A stored slot may intentionally contain the previous version during
      // edit/regeneration. The live owner version is resolved at dispatch;
      // never treat the stale stored payload as current context.
      version: null,
    };
  }

  async function dispatch(input, transaction) {
    if (enabledResolver() === false) throw coordinatorError("BIOWEAVE_DISABLED");
    if (!executionCurrent(input, isExecutionCurrent))
      throw coordinatorError("FLOOR_TX_SUPERSEDED", {failure_stage: "dispatch"});
    emit("FLOOR_TX_DISPATCH_BEGIN", transaction);
    const live = await measurePerformanceStage(
      transaction,
      "AUTHORITATIVE_FLOOR_RESOLVE",
      () => resolveLive(input, transaction),
      {reason_code: "AUTHORITATIVE_FLOOR_CONTEXT_RESOLVED"},
    );
    const selector = live.selector ?? ownerSelector(input);
    const swipeId = Number(live.swipeId ?? ownerSwipe(input, transaction.floorVersion));
    const expected = transaction.floorVersion;
    const owner = live.owner ?? store.getFloorOwner?.(selector, swipeId);
    const currentChatId = live.chatId ?? expected.chat_id;
    if (String(currentChatId) !== String(expected.chat_id))
      throw coordinatorError("FLOOR_TX_STALE_CHAT", {current_chat_id: currentChatId});
    if (!owner) throw coordinatorError("FLOOR_OWNER_REQUIRED");
    if (owner && owner.owner_type !== "character")
      throw coordinatorError("BIOWEAVE_USER_FLOOR_WRITE_FORBIDDEN");
    if (owner && owner.active_swipe_id !== undefined && Number(owner.active_swipe_id) !== swipeId)
      throw coordinatorError("FLOOR_TX_STALE_SWIPE", {active_swipe_id: owner.active_swipe_id});
    if (swipeId !== Number(expected.swipe_id)) throw coordinatorError("FLOOR_TX_STALE_SWIPE");
    await measurePerformanceStage(
      transaction,
      "COORDINATOR_OWNER_GUARD",
      async () => {
        if (typeof input.assertCurrent === "function" && (await input.assertCurrent()) === false)
          throw coordinatorError("FLOOR_TX_SUPERSEDED", {failure_stage: "owner_check"});
        if (!executionCurrent(input, isExecutionCurrent))
          throw coordinatorError("FLOOR_TX_SUPERSEDED", {failure_stage: "owner_check"});
      },
      {reason_code: "COORDINATOR_OWNER_GUARD_COMPLETED"},
    );
    emit("FLOOR_TX_OWNER_CHECK", transaction, {
      owner_message_id: expected.message_id,
      owner_found: Boolean(owner),
      active_swipe_id: swipeId,
    });

    let currentVersion = null;
    if (typeof resolveCurrentFloorVersion === "function") {
      currentVersion = await measurePerformanceStage(
        transaction,
        "FLOOR_VERSION_VALIDATION",
        () => resolveCurrentFloorVersion({
          chatId: expected.chat_id,
          ownerFloor: {message_index: selector, message_id: expected.message_id},
          floorVersion: expected,
          swipeId,
        }),
        {reason_code: "CURRENT_FLOOR_VERSION_RESOLVED"},
      );
    }
    const latest = live.floorData && typeof live.floorData === "object"
      ? clone(live.floorData)
      : store.getFloor(selector, swipeId) ?? emptyFloor();
    const storedVersion = floorVersionFromData(latest);
    currentVersion ??= live.version;
    if (currentVersion && hasCompleteFloorVersion(currentVersion) &&
        !sameFloorVersion(currentVersion, expected)) {
      const audit = versionAudit(expected, currentVersion);
      throw coordinatorError("FLOOR_TX_STALE_VERSION", {
        expected_floor_version: safeVersion(expected),
        actual_floor_version: safeVersion(currentVersion),
        version_audit: audit,
        validation_layer: "floor_persistence_coordinator.dispatch",
        validation_source: "current_floor_resolver",
        version_classification: "TRUE_CONTEXT_VERSION_CHANGE",
      });
    }
    emit("FLOOR_TX_CONTEXT_SOURCE_READ", transaction, {
      actual_floor_version: safeVersion(currentVersion ?? storedVersion),
      version_check_source: "current_context",
    });
    emit("FLOOR_TX_CONTEXT_SLOT_RESOLVED", transaction, {
      before_presence: presence(latest),
      actual_floor_version: safeVersion(storedVersion),
    });
    const existingAnalysisAttempt = Number(latest?.analysis?.attempt);
    const terminalAnalysisAttempt = Number(
      transaction.patch?.analysis?.last_attempt?.attempt ??
        transaction.patch?.analysis?.attempt,
    );
    const terminalWouldOverwriteCurrentSuccess =
      latest?.analysis?.status === "success" &&
      transaction.patch?.analysis?.status !== "success" &&
      (!Number.isFinite(existingAnalysisAttempt) ||
        !Number.isFinite(terminalAnalysisAttempt) ||
        existingAnalysisAttempt >= terminalAnalysisAttempt);
    if (transaction.owner === "terminal" && terminalWouldOverwriteCurrentSuccess) {
      throw coordinatorError("FLOOR_TX_TERMINAL_SUPERSEDED", {
        failure_stage: "terminal_analysis_guard",
      });
    }
    const snapshotResult = await measurePerformanceStage(
      transaction,
      "SNAPSHOT_MERGE",
      async () => {
        const resolvedPatch = typeof input.patchResolver === "function"
          ? await input.patchResolver({latest: clone(latest), expected: clone(expected), transaction})
          : transaction.patch;
        if (resolvedPatch?.__floor_tx_noop === true) return {noOp: true};
        const patch = preparePersistedPatch(
          transaction.owner,
          assertPatch(transaction.owner, resolvedPatch, expected, transaction.operation_type),
          latest,
        );
        emit("FLOOR_TX_PATCH_VALIDATED", transaction, {patch_fields: Object.keys(patch)});
        const merged = {
          ...clone(latest),
          floor_version: clone(expected),
          ...clone(patch),
        };
        const before = presence(latest);
        for (const [field, wasPresent] of Object.entries(before)) {
          if (wasPresent && !presence(merged)[field])
            throw coordinatorError("FLOOR_TX_SIBLING_LOST", {field});
        }
        return {
          patch,
          merged,
          before,
          noOp: equalValue(merged, latest),
        };
      },
      {reason_code: "SNAPSHOT_MERGED"},
    );
    if (snapshotResult.noOp) {
      await measurePerformanceStage(
        transaction,
        "COORDINATOR_NOOP_GUARD",
        async () => {
          if (typeof input.assertCurrent === "function" && (await input.assertCurrent()) === false)
            throw coordinatorError("FLOOR_TX_SUPERSEDED", {failure_stage: "no_op_owner_check"});
          if (!executionCurrent(input, isExecutionCurrent))
            throw coordinatorError("FLOOR_TX_SUPERSEDED", {failure_stage: "no_op_owner_check"});
        },
        {reason_code: "COORDINATOR_NOOP_GUARD_COMPLETED"},
      );
      emitPerformanceStage(transaction, "STORE_SAVE_FLOOR", {
        status: "NOT_APPLICABLE",
        duration_ms: null,
        reason_code: "FLOOR_TX_NOOP",
      });
      return await measurePerformanceStage(
        transaction,
        "COORDINATOR_NOOP_FINALIZATION",
        () => {
          emit("FLOOR_TX_NOOP", transaction, {
            commit_state: "local-noop",
            after_presence: presence(latest),
          });
          return {
            ok: true,
            status: "noop",
            commitState: "local-noop",
            floor_transaction_id: transaction.floor_transaction_id,
            transaction_key: transaction.transaction_key,
            owner: transaction.owner,
            floor_version: clone(expected),
            floor: clone(latest),
            authoritativeReadback: false,
            noWrite: true,
          };
        },
        {reason_code: "FLOOR_TX_NOOP_LOCAL_ONLY"},
      );
    }
    const {patch, merged, before} = snapshotResult;
    await measurePerformanceStage(
      transaction,
      "COORDINATOR_PRE_SAVE_GUARD",
      async () => {
        if (typeof input.assertCurrent === "function" && (await input.assertCurrent()) === false)
          throw coordinatorError("FLOOR_TX_SUPERSEDED", {failure_stage: "pre_save_guard"});
        if (!executionCurrent(input, isExecutionCurrent))
          throw coordinatorError("FLOOR_TX_SUPERSEDED", {failure_stage: "pre_save_guard"});
      },
      {reason_code: "COORDINATOR_PRE_SAVE_GUARD_COMPLETED"},
    );
    const persistenceResult = await measurePerformanceStage(
      transaction,
      "STORE_SAVE_FLOOR",
      () => store.saveFloor(selector, swipeId, merged, {
        floor_transaction_id: transaction.floor_transaction_id,
        transaction_key: transaction.transaction_key,
        owner: transaction.owner,
        domain: transaction.owner,
        operation_type: transaction.operation_type,
        ...transaction.traceContext,
      }),
      {reason_code: "STORE_SAVE_FLOOR_COMPLETED"},
    );
    emit("FLOOR_TX_HOST_SYNCED", transaction, {after_presence: presence(merged)});
    emit("FLOOR_TX_OFFICIAL_SAVE_RESOLVED", transaction, {commit_state: "resolved"});
    if (typeof input.assertCurrent === "function") {
      await measurePerformanceStage(
        transaction,
        "COORDINATOR_POST_SAVE_GUARD",
        () => input.assertCurrent(),
        {reason_code: "COORDINATOR_POST_SAVE_GUARD_COMPLETED"},
      );
    }
    const readback = await measurePerformanceStage(
      transaction,
      "COORDINATOR_READBACK",
      () => persistenceResult?.authoritativeReadback === true
        ? clone(merged)
        : typeof store.readAuthoritativeFloor === "function"
        ? store.readAuthoritativeFloor(
          selector,
          swipeId,
          expected,
          authoritativeReadTraceContext(transaction, "COORDINATOR_READBACK"),
        )
          : store.getFloor(selector, swipeId) ?? null,
      {reason_code: "AUTHORITATIVE_READBACK_COMPLETED"},
    );
    return await measurePerformanceStage(
      transaction,
      "COORDINATOR_RESULT_FINALIZATION",
      () => {
        emit("FLOOR_TX_READBACK", transaction, {
          after_presence: presence(readback ?? {}),
          actual_floor_version: safeVersion(floorVersionFromData(readback)),
        });
        const missingOwnerFields = Object.keys(patch).filter(key => !equalValue(readback?.[key], patch[key]));
        const readbackPresence = presence(readback ?? {});
        const missingSiblings = Object.entries(before)
          .filter(([field, wasPresent]) => wasPresent && !readbackPresence[field])
          .map(([field]) => field);
        const versionMatches = Boolean(readback && sameFloorVersion(floorVersionFromData(readback), expected));
        emit("FLOOR_TX_SIBLING_AUDIT", transaction, {
          preserved: missingSiblings.length === 0,
          missing_owner_fields: missingOwnerFields,
          missing_siblings: missingSiblings,
          before_presence: before,
          after_presence: readbackPresence,
          floor_version_match: versionMatches,
        });
        if (!readback || missingOwnerFields.length || missingSiblings.length || !versionMatches) {
          const actualVersion = floorVersionFromData(readback);
          throw coordinatorError("FLOOR_TX_READBACK_FAILED", {
            expected_floor_version: safeVersion(expected),
            actual_floor_version: safeVersion(actualVersion),
            ...(versionMatches ? {} : {
              version_audit: versionAudit(expected, actualVersion),
              validation_layer: "floor_persistence_coordinator.readback",
              validation_source: "authoritative_readback",
              version_classification: "READBACK_VERSION_MISMATCH",
            }),
            missing_owner_fields: missingOwnerFields,
            missing_siblings: missingSiblings,
            owner_message_index: selector,
            owner_message_id: expected.message_id,
            owner_swipe_id: swipeId,
          });
        }
        emit("FLOOR_TX_CONFIRMED", transaction, {commit_state: "confirmed", after_presence: readbackPresence});
        return {
          ok: true,
          status: "confirmed",
          commitState: "confirmed",
          floor_transaction_id: transaction.floor_transaction_id,
          transaction_key: transaction.transaction_key,
          owner: transaction.owner,
          floor_version: clone(expected),
          floor: clone(readback),
          authoritativeReadback: true,
        };
      },
      {reason_code: "FLOOR_TX_RESULT_FINALIZED"},
    );
  }

  function commitFloorPatch(input = {}) {
    const suppliedFloorVersion = input.floorVersion ?? input.floor_version;
    const floorVersion = normalizeFloorOwner(suppliedFloorVersion);
    if (!hasCompleteFloorVersion(floorVersion))
      return Promise.reject(coordinatorError("FLOOR_TX_VERSION_REQUIRED"));
    const owner = String(input.owner ?? input.domain ?? "").trim().toLowerCase();
    const operationType = input.operation_type ?? input.operationType ?? "patch";
    let patch = null;
    try {
      if (typeof input.patchResolver === "function") {
        if (!FLOOR_OWNER_FIELDS[owner]) throw coordinatorError("FLOOR_TX_OWNER_INVALID", {owner});
      } else {
        patch = assertPatch(owner, input.patch, floorVersion, operationType);
      }
    } catch (cause) {
      return Promise.reject(cause);
    }
    const suppliedChat = input.chatId ?? input.chat_id ?? floorVersion.chat_id;
    if (String(floorVersion.chat_id) !== String(suppliedChat))
      return Promise.reject(coordinatorError("FLOOR_TX_CHAT_SCOPE_MISMATCH"));
    const transaction = {
      floor_transaction_id: `floor-tx-${++sequence}`,
      transaction_key: transactionKey(floorVersion),
      owner,
      patch,
      patch_resolver: typeof input.patchResolver === "function",
      floorVersion: clone(floorVersion),
      ownerFloor: clone(input.ownerFloor ?? input.owner ?? {}),
      operation_type: operationType,
      execution_attempt: input.execution_attempt ?? input.execution?.attempt ?? null,
      stage_attempt: input.stage_attempt ?? input.execution?.stage_attempt ?? null,
      retry_index: input.retry_index ?? input.execution?.retry_index ?? null,
      traceContext: input.traceContext ?? input.trace_context ?? {},
      started_at: monotonicNow(),
    };
    emit("FLOOR_TX_CREATED", transaction, {patch_fields: Object.keys(patch ?? {})});
    const queueDepthAtEnqueue = queueDepths.get(transaction.transaction_key) ?? 0;
    const queued = queueDepthAtEnqueue > 0;
    const enqueuedAt = monotonicNow();
    transaction.queue_depth_at_enqueue = queueDepthAtEnqueue;
    transaction.enqueued_at = enqueuedAt;
    queueDepths.set(transaction.transaction_key, queueDepthAtEnqueue + 1);
    const prior = tails.get(transaction.transaction_key) ?? Promise.resolve();
    emit("FLOOR_TX_QUEUED", transaction, {
      queued,
      queue_depth_at_enqueue: queueDepthAtEnqueue,
    });
    const run = prior.catch(() => null).then(async () => {
      const queueWait = durationMs(enqueuedAt);
      emitPerformanceStage(transaction, "COORDINATOR_QUEUE_WAIT", {
        status: "SUCCEEDED",
        duration_ms: queueWait,
        queue_depth_at_enqueue: queueDepthAtEnqueue,
        queue_wait_ms: queueWait,
        reason_code: queued ? "COORDINATOR_QUEUE_SETTLED" : "COORDINATOR_DISPATCHED_IMMEDIATELY",
      });
      const executionStartedAt = monotonicNow();
      try {
        const result = await dispatch(input, transaction);
        const executionDuration = durationMs(executionStartedAt);
        emitPerformanceStage(transaction, "COORDINATOR_EXECUTION", {
          status: "SUCCEEDED",
          duration_ms: executionDuration,
          execution_duration_ms: executionDuration,
          queue_depth_at_enqueue: queueDepthAtEnqueue,
          reason_code: "COORDINATOR_EXECUTION_CONFIRMED",
        });
        return result;
      } catch (cause) {
        const executionDuration = durationMs(executionStartedAt);
        emitPerformanceStage(transaction, "COORDINATOR_EXECUTION", {
          status: "FAILED",
          duration_ms: executionDuration,
          execution_duration_ms: executionDuration,
          queue_depth_at_enqueue: queueDepthAtEnqueue,
          reason_code: "COORDINATOR_EXECUTION_FAILED",
          error_code: cause?.code ?? cause?.message ?? "FLOOR_TX_FAILED",
        });
        throw cause;
      }
    });
    let settled;
    settled = run.finally(() => {
      if (tails.get(transaction.transaction_key) === settled) tails.delete(transaction.transaction_key);
      const pending = queueDepths.get(transaction.transaction_key) ?? 1;
      if (pending <= 1) queueDepths.delete(transaction.transaction_key);
      else queueDepths.set(transaction.transaction_key, pending - 1);
    });
    tails.set(transaction.transaction_key, settled);
    return settled.catch(cause => {
      emit(cause?.code === "FLOOR_TX_SUPERSEDED" ? "FLOOR_TX_SUPERSEDED" : "FLOOR_TX_FAILED", transaction, {
        error_code: cause?.code ?? cause?.message ?? "FLOOR_TX_FAILED",
        commit_state: cause?.commitState ?? "failed",
      });
      throw cause;
    });
  }

  async function clearFloorSlot({messageIndex, selector, swipeId = 0, chatId, assertCurrent = null, reason = "lifecycle-invalidation"} = {}) {
    const index = messageIndex ?? selector;
    const currentChatId = chatId ?? store.adapter?.getChatId?.() ?? store.getChatId?.();
    if (index === undefined || index === null) throw coordinatorError("FLOOR_OWNER_REQUIRED");
    if (chatId != null && currentChatId != null && String(currentChatId) !== String(chatId))
      throw coordinatorError("STALE_CHAT");
    const owner = store.getFloorOwner?.(index, swipeId);
    if (owner && owner.owner_type !== "character")
      throw coordinatorError("BIOWEAVE_USER_FLOOR_WRITE_FORBIDDEN");
    if (owner && Number(owner.active_swipe_id) !== Number(swipeId))
      throw coordinatorError("FLOOR_TX_STALE_SWIPE");
    if (typeof assertCurrent === "function" && (await assertCurrent()) === false)
      throw coordinatorError("FLOOR_TX_SUPERSEDED");
    if (enabledResolver() === false) throw coordinatorError("BIOWEAVE_DISABLED");
    const transaction = {
      floor_transaction_id: `floor-tx-${++sequence}`,
      transaction_key: `${currentChatId ?? ""}/${index}/${swipeId}/clear`,
      owner: "terminal",
      operation_type: "clear-floor-slot",
      floorVersion: {chat_id: currentChatId ?? null, message_id: messageIndex, floor: null, swipe_id: swipeId},
    };
    emit("FLOOR_TX_CREATED", transaction, {reason});
    await store.saveFloor(index, swipeId, emptyFloor(), {
      floor_transaction_id: transaction.floor_transaction_id,
      operation_type: transaction.operation_type,
      reason,
    });
    emit("FLOOR_TX_CONFIRMED", transaction, {commit_state: "confirmed", reason});
    return {ok: true, status: "confirmed", commitState: "confirmed", floor_transaction_id: transaction.floor_transaction_id};
  }

  return {
    commitFloorPatch,
    commitPatch: commitFloorPatch,
    saveFloorPatch: commitFloorPatch,
    clearFloorSlot,
    getOwnerFields: owner => FLOOR_OWNER_FIELDS[String(owner ?? "").toLowerCase()] ?? null,
    getPendingTransactionKeys: () => [...tails.keys()],
  };
}
