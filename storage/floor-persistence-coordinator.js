import {cloneValue, emptyFloor} from "./schema.js";
import {
  floorVersionFromData,
  hasCompleteFloorVersion,
  sameFloorVersion,
} from "../runtime/floor.js";

export const FLOOR_OWNER_FIELDS = Object.freeze({
  world: Object.freeze(["world_model", "world_model_meta"]),
  event: Object.freeze(["analysis", "events", "character_registry"]),
  projection: Object.freeze(["snapshot", "projection_timeline"]),
  // Terminal attempts persist only the analysis status record. Existing
  // Events/registry are latest-state siblings and are never terminal-owned.
  terminal: Object.freeze(["analysis"]),
});

const VERSION_FIELD = "floor_version";
const VERSION_FIELDS = Object.freeze([
  "chat_id", "message_id", "floor", "swipe_id", "content_hash", "message_version",
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
    input.messageIndex ?? input.message_index ?? input.selector ??
    owner.message_id ?? owner.messageId ?? input.message_id;
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
  readLatestFloor = null,
  acquireAuthoritativeFloorOwner = null,
  trace = () => {},
  enabledResolver = () => true,
  isExecutionCurrent = null,
} = {}) {
  if (!store || typeof store.getFloor !== "function" || typeof store.saveFloor !== "function")
    throw new TypeError("FLOOR_TX_STORE_REQUIRED");
  const tails = new Map();
  let sequence = 0;

  function emit(stage, transaction, details = {}) {
    try {
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
        ...details,
      });
    } catch { /* diagnostics never change persistence */ }
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
    const live = await resolveLive(input, transaction);
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
    if (typeof input.assertCurrent === "function") {
      if ((await input.assertCurrent()) === false)
        throw coordinatorError("FLOOR_TX_SUPERSEDED", {failure_stage: "owner_check"});
    }
    if (!executionCurrent(input, isExecutionCurrent))
      throw coordinatorError("FLOOR_TX_SUPERSEDED", {failure_stage: "owner_check"});
    emit("FLOOR_TX_OWNER_CHECK", transaction, {
      owner_message_id: expected.message_id,
      owner_found: Boolean(owner),
      active_swipe_id: swipeId,
    });

    if (typeof acquireAuthoritativeFloorOwner === "function") {
      const acquisition = await acquireAuthoritativeFloorOwner({
        input,
        transaction,
        selector,
        swipeId,
        expectedVersion: expected,
        live,
      });
      const classification = acquisition?.classification ?? "AUTHORITATIVE_MATCH";
      emit("FLOOR_TX_OWNER_ACQUISITION", transaction, {
        classification,
        commit_state: acquisition?.commitState ?? "unknown",
        official_owner_found: acquisition?.officialOwnerFound ?? null,
        official_floor_version_match: acquisition?.officialFloorVersionMatch ?? null,
      });
      if (classification === "TRUE_STALE_OWNER_CHANGE")
        throw coordinatorError("FLOOR_TX_STALE_VERSION", {
          failure_stage: "owner_acquisition",
          classification,
          version_audit: acquisition?.versionAudit,
        });
      if (classification === "HOST_AHEAD_OF_OFFICIAL" && acquisition?.confirmed !== true)
        throw coordinatorError("FLOOR_TX_OWNER_ACQUISITION_FAILED", {
          failure_stage: "owner_acquisition",
          classification,
        });
    }

    let currentVersion = null;
    if (typeof resolveCurrentFloorVersion === "function") {
      currentVersion = await resolveCurrentFloorVersion({
        chatId: expected.chat_id,
        ownerFloor: {message_index: selector, message_id: expected.message_id},
        floorVersion: expected,
        swipeId,
      });
    }
    const latest = typeof readLatestFloor === "function"
      ? clone(await readLatestFloor({
        chatId: expected.chat_id,
        messageIndex: selector,
        swipeId,
        floorVersion: expected,
        transaction,
      })) ?? emptyFloor()
      : (live.floorData && typeof live.floorData === "object"
        ? clone(live.floorData)
        : store.getFloor(selector, swipeId) ?? emptyFloor());
    const storedVersion = floorVersionFromData(latest);
    currentVersion ??= live.version;
    if (currentVersion && hasCompleteFloorVersion(currentVersion) &&
        !sameFloorVersion(currentVersion, expected)) {
      throw coordinatorError("FLOOR_TX_STALE_VERSION", {
        expected_floor_version: safeVersion(expected),
        actual_floor_version: safeVersion(currentVersion),
      });
    }
    emit("FLOOR_TX_LATEST_SLOT_RESOLVED", transaction, {
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
    const patch = assertPatch(transaction.owner, transaction.patch, expected, transaction.operation_type);
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
    await store.saveFloor(selector, swipeId, merged, {
      floor_transaction_id: transaction.floor_transaction_id,
      transaction_key: transaction.transaction_key,
      owner: transaction.owner,
      domain: transaction.owner,
      operation_type: transaction.operation_type,
      ...transaction.traceContext,
    });
    emit("FLOOR_TX_HOST_SYNCED", transaction, {after_presence: presence(merged)});
    emit("FLOOR_TX_OFFICIAL_SAVE_RESOLVED", transaction, {commit_state: "resolved"});
    if (typeof input.assertCurrent === "function") await input.assertCurrent();
    const readback = typeof store.readAuthoritativeFloor === "function"
      ? await store.readAuthoritativeFloor(selector, swipeId, expected)
      : store.getFloor(selector, swipeId) ?? null;
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
    if (!readback || missingOwnerFields.length || missingSiblings.length || !versionMatches)
      throw coordinatorError("FLOOR_TX_READBACK_FAILED", {
        expected_floor_version: safeVersion(expected),
        actual_floor_version: safeVersion(floorVersionFromData(readback)),
        missing_owner_fields: missingOwnerFields,
        missing_siblings: missingSiblings,
      });
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
  }

  function commitFloorPatch(input = {}) {
    const floorVersion = input.floorVersion ?? input.floor_version;
    if (!hasCompleteFloorVersion(floorVersion))
      return Promise.reject(coordinatorError("FLOOR_TX_VERSION_REQUIRED"));
    const owner = String(input.owner ?? input.domain ?? "").trim().toLowerCase();
    const operationType = input.operation_type ?? input.operationType ?? "patch";
    let patch;
    try {
      patch = assertPatch(owner, input.patch, floorVersion, operationType);
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
      floorVersion: clone(floorVersion),
      operation_type: operationType,
      execution_attempt: input.execution_attempt ?? input.execution?.attempt ?? null,
      stage_attempt: input.stage_attempt ?? input.execution?.stage_attempt ?? null,
      retry_index: input.retry_index ?? input.execution?.retry_index ?? null,
      traceContext: input.traceContext ?? input.trace_context ?? {},
    };
    emit("FLOOR_TX_CREATED", transaction, {patch_fields: Object.keys(patch)});
    const prior = tails.get(transaction.transaction_key) ?? Promise.resolve();
    emit("FLOOR_TX_QUEUED", transaction, {queued: tails.has(transaction.transaction_key)});
    const run = prior.catch(() => null).then(() => dispatch(input, transaction));
    let settled;
    settled = run.finally(() => {
      if (tails.get(transaction.transaction_key) === settled) tails.delete(transaction.transaction_key);
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
      floorVersion: {chat_id: currentChatId ?? null, message_id: messageIndex, floor: null, swipe_id: swipeId, content_hash: null, message_version: null},
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
