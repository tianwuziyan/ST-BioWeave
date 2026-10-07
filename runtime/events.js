import { createChatBoundary } from "./chat.js";
import {
  createStore,
  hasSwipeSlot,
  hasSwipeStructure,
  isCharacterMessage,
} from "../storage/store.js";
import { createAnalyzer } from "../ai/analyzer.js";
import { createStoryTime } from "../story/time.js";
import {
  FOLLOW_DEFAULT_API,
  SILLYTAVERN_CURRENT_API,
  cloneValue,
} from "../storage/schema.js";
import {
  applyClearPlanToState,
  buildClearPlan,
  createClearService,
} from "../storage/clear.js";
import { createEventAnalysisCoordinator } from "./event-analysis.js";
import { floorVersion, hashText, sameFloorVersion } from "./floor.js";
import { createStoryTimeCoordinator } from "../story/coordinator.js";
import { createCalendarResolver } from "../story/calendar.js";
import { createProjectionPersistence } from "../storage/projection.js";
import { createProjectionTimingPersistence } from "../storage/projection-timing.js";
import { createTrackingWindowPersistence } from "../storage/tracking-window.js";
import { evaluateProjectionTiming, resolveProjectionTimingInstance } from "../core/projection-timing.js";
import { evaluateProjectionEligibility } from "../core/projection-eligibility.js";
import { readCharacterTimingConfig, resolveCharacterTimingConfig } from "../core/character-timing-config.js";
import { getHumanPreconfirmationTimingPreset, HUMAN_PRECONFIRMATION_TIMING_PRESET_VERSION } from "../core/human-timing-preset.js";
import { isCanonicalWorldHumanSpecies } from "../core/world-species-identity.js";
import { createFloorPersistenceCoordinator } from "../storage/floor-persistence-coordinator.js";
import { createCurrentStateAttributionResolver, createProjectionContextCoordinator } from "./projection-context.js";
import { createCharacterTimingConfigStore } from "../storage/character-timing.js";
import { createProjectionRuntime } from "./projection-runtime.js";
import { createHealthAssessmentCoordinator } from "./health-assessment.js";
import { createHealthEvolutionRuntime } from "./health-evolution.js";
import { createRuntimeActivity } from "./activity.js";
import {
  buildVersionChainDiagnostic,
  createRuntimeDiagnostics,
  versionChainTransition,
} from "./diagnostics.js";
import { createSillyTavernAdapter as createSillyTavernIoAdapter } from "./sillytavern-adapter.js";

const LIFECYCLE_EVENTS = [
  "CHAT_CHANGED",
  "CHAT_CREATED",
  "MESSAGE_UPDATED",
  "MESSAGE_EDITED",
  "MESSAGE_DELETED",
  "MESSAGE_SWIPED",
  "MESSAGE_SWIPE_DELETED",
  "MESSAGE_RECEIVED",
  "GENERATION_ENDED",
  "GENERATION_STOPPED",
  "GENERATION_CANCELLED",
  "GENERATION_STARTED",
  "CHARACTER_MESSAGE_RENDERED",
];

const SOURCE_OWNER_LATEST_MERGE = true;

function ownerId(value) {
  const raw =
    typeof value === "string"
      ? value
      : value?.chatId ?? value?.chat_id ?? value?.owner?.chatId ?? value?.owner?.chat_id;
  return typeof raw === "string" ? raw.trim() : raw ?? null;
}

function chatIdKey(value) {
  const id = ownerId(value);
  return id == null ? null : String(id).replace(/\.jsonl$/iu, "");
}

function cloneOwnerValue(value) {
  return cloneValue(value);
}

function floorOwnerForProjection(floor) {
  return {
    message_index: floor?.index ?? floor?.message_index,
    message_id: floor?.version?.message_id ?? floor?.message_id,
    swipe_id: floor?.swipeId ?? floor?.version?.swipe_id,
  };
}

function stableOwnerValue(value) {
  if (Array.isArray(value)) return value.map(stableOwnerValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableOwnerValue(value[key])]),
  );
}

function ownerIdentityFromContext(context) {
  const custom = context?.getChatOwnerIdentity?.();
  const source = custom && typeof custom === "object" ? custom : context;
  return {
    characterId:
      source?.characterId ??
      source?.character_id ??
      source?.activeCharacterId ??
      source?.active_character_id ??
      null,
    groupId:
      source?.groupId ??
      source?.group_id ??
      source?.activeGroupId ??
      source?.active_group_id ??
      null,
  };
}

function characterForOwner(context, owner = {}) {
  const identity = ownerIdentityFromContext(context);
  const characterId =
    owner?.characterId ?? owner?.character_id ?? identity.characterId;
  const characters = context?.characters;
  const character =
    (characters && characterId != null ? characters[characterId] : null) ??
    context?.character ??
    context?.characterCard ??
    null;
  const name =
    owner?.characterName ??
    owner?.character_name ??
    character?.name ??
    (String(characterId) === String(identity.characterId)
      ? context?.name2
      : null);
  const avatar =
    owner?.avatarUrl ??
    owner?.avatar_url ??
    character?.avatar ??
    context?.avatar_url ??
    context?.avatarUrl;
  if (typeof name !== "string" || !name.trim()) return null;
  if (typeof avatar !== "string" || !avatar.trim()) return null;
  return {
    characterId,
    groupId: identity.groupId,
    ch_name: name,
    avatar_url: avatar,
  };
}

function sourceRequestHeaders(context) {
  let headers = {};
  try {
    headers = context?.getRequestHeaders?.() ?? {};
  } catch {
    headers = {};
  }
  const contentType = Object.keys(headers).find(
    (key) => key.toLowerCase() === "content-type",
  );
  return contentType
    ? headers
    : { ...headers, "Content-Type": "application/json" };
}

function sourceError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function floorVersionAudit(expected, actual) {
  const fields = [
    "chat_id",
    "message_id",
    "floor",
    "swipe_id",
    "content_hash",
    "message_version",
  ];
  const expectedValue = {};
  const actualValue = {};
  const comparison = {};
  const mismatchFields = [];
  for (const field of fields) {
    expectedValue[field] = expected?.[field] ?? null;
    actualValue[field] = actual?.[field] ?? null;
    const matches = String(expectedValue[field] ?? "") === String(actualValue[field] ?? "");
    comparison[`${field}_match`] = matches;
    if (!matches) mismatchFields.push(field);
  }
  return {
    expected: expectedValue,
    actual: actualValue,
    ...comparison,
    mismatch_fields: mismatchFields,
  };
}

export function createSillyTavernAdapter() {
  const io = createSillyTavernIoAdapter();
  const getContext = io.getContext;
  let chatIndexCache = null;
  let chatIndexOwnerKey = null;
  let persistenceTraceSink = null;
  let saveInvocationSequence = 0;

  function emitPersistenceTrace(payload = {}) {
    try {
      const allowed = new Set([
        "domain", "chat_id", "active_chat_id", "active_character_floor_message_id", "active_swipe_id", "message_id", "floor", "swipe_id", "content_hash", "world_model_debug_schema_version", "first_failed_stage", "type_identity_decisions",
        "message_version", "message_index", "floor_version_key", "attempt", "execution_attempt", "stage_attempt", "retry_index", "persistence_invocation_id", "trigger", "stage", "boundary", "source_kind", "source_text_length", "host_save_state", "host_post_save_hook", "analysis_execution_id", "scheduler_revision", "final_floor_index", "final_floor_version", "from_boundary", "to_boundary", "from_content_hash", "to_content_hash", "from_swipe_id", "to_swipe_id", "from_message_version", "to_message_version", "from_source_kind", "to_source_kind", "path", "reason",
        "execution_id", "mode", "response_text_length", "raw_fact_block_count", "parsed_fact_count", "parse_rejected_fact_count", "resolution_rejected_fact_count", "evidence_guard_rejected_fact_count", "fact_count", "rejected_fact_count", "patch_operation_count", "accepted_fact_count", "accepted_operation_count", "initial_type_count", "initial_identity_search_performed", "sibling_search_seeded", "sibling_search_complete", "discovered_sibling_type_count", "discovered_sibling_type_names", "accepted_sibling_type_count", "accepted_sibling_type_names", "rejected_sibling_type_count", "rejected_sibling_type_names", "reported_distinct_type_count", "host_observed_distinct_type_count", "accepted_canonical_type_count", "new_type_identity_fact_count", "accepted_new_type_identity_count", "identity_diversity", "coverage_initial_target_count", "coverage_current_target_count", "dynamic_coverage_target_count", "dynamic_coverage_target_ids", "unaccounted_dynamic_target_count", "unaccounted_dynamic_target_ids", "derived_target_accounting_complete", "dynamic_coverage_unaccounted_in_single_response", "derived_target_accounting_records", "dynamic_coverage_targets", "coverage_dispositions", "analysis_stage_succeeded", "canonical_mutation_occurred", "completeness_required", "completeness_satisfied", "completeness_diagnostics", "semantic_incomplete", "semantic_failure_code", "semantic_diagnostics", "analysis_outcome", "coverage_fact_mappings", "coverage_target_count", "coverage_target_counts", "covered_target_count", "coverage_targets", "coverage_targets_truncated", "target_emitted", "target_not_emitted", "fields", "scope_summary", "address_summary", "facts", "rejected_facts", "fact_mappings", "fact_index", "failure_stage", "failure_code", "reason",
        "review_accounted", "mutation_rejected_count", "coverage_mutation_states", "request_envelope", "request_mode", "request_total_char_count", "permitted_evidence_char_count", "existing_reference_char_count", "retry_directive_char_count", "host_diagnostics_included", "permitted_evidence_fingerprint", "existing_reference_fingerprint", "coverage_target_set_fingerprint", "analysis_payload_fingerprint", "model_request_payload_fingerprint", "control_directive_fingerprint", "retry_reason", "retry_target_ids", "retry_attempt", "previous_failure_code", "execution_result", "fact_delta_result",
        "comparison", "patch_operation_type", "patch_path", "rejected_operation_type", "rejected_semantic_path", "species", "biological_type", "field", "proposed_value", "classification", "evidence_guard_failure_code", "rejected_semantic_field", "evidence_binding", "decision", "candidate_value", "candidate_normalized_value", "scoped_evidence_unit_count", "matched_evidence_unit_count", "matched_evidence_unit_indices", "matched_evidence_excerpts", "support_strategy", "support_score_if_any", "required_threshold_if_any", "scope_binding_result", "value_support_result", "rejection_code", "rejection_detail",
        "generation_id", "generation_type", "generation_source", "generation_intent_id", "generation_final_floor_seen", "generation_ended", "generation_settled", "execution_active", "current_execution_id", "target_message_id", "target_swipe_id", "owner_changed", "supersede_decision", "supersede_reason", "result_reason", "pending_generation", "pending_swipe_generation", "completed_generation", "completed_swipe_generation", "event_type", "event_payload_type", "force", "counter_before", "counter_after", "interval", "retry_paused", "already_observed", "already_counted", "host_event_key", "host_event_type", "received_at", "host_chat_id", "host_message_id", "host_swipe_id", "host_generation_type", "forward_to_runtime", "runtime_handler_present", "forwarded", "forward_result", "forward_error", "forward_error_name",
        "cancel_stage", "cancel_reason", "cancel_code",
        "original_chat_id", "current_chat_id", "original_message_id", "current_owner_message_id",
        "original_swipe_id", "current_swipe_id", "original_content_hash", "current_content_hash",
        "original_message_version", "current_message_version", "chat_id_match", "message_id_match",
        "floor_match", "swipe_id_match", "content_hash_match", "message_version_match",
        "active_chat_match", "message_owner_match", "host_content_hash_match", "host_floor_version_match",
        "official_content_hash_match", "official_floor_version_match", "generation_identity_match", "execution_superseded",
      "result", "classification", "retry_classification", "retryable", "retry_budget_consumed", "version_check_source", "expected_floor_version", "actual_floor_version", "expected_content_hash", "actual_content_hash", "present", "world_model_present", "species_count",
        "biological_type_count", "floor_version_match", "swipe_match", "commitState",
      "revision", "current_floor_present", "expected", "actual", "mismatch_fields", "authoritative",
      "response_shape", "messages_present", "messages_count", "owner_found",
        "owner_message_id", "owner_message_found", "swipe_found", "swipe_structure", "active_swipe_id",
        "swipes_present", "swipes_count", "swipe_info_present", "swipe_info_count",
      "target_swipe_info_found", "target_extra_present", "target_bioweave_present",
      "message_index", "slot_present", "floor_version_match", "active_swipe_match",
      "host_memory_slot_present", "official_slot_present", "host_memory_world_present",
      "world_present", "analysis_present", "events_present", "character_registry_present",
      "snapshot_present", "projection_timeline_present",
      "official_owner_found", "official_swipe_found", "host_memory_owner_found", "host_memory_swipe_found",
      "host_memory_analysis_present", "host_memory_events_present",
      "host_memory_character_registry_present", "host_memory_snapshot_present",
      "host_memory_projection_timeline_present", "official_world_present",
      "official_analysis_present", "official_events_present",
      "official_character_registry_present", "official_snapshot_present",
      "official_projection_timeline_present", "save_convergence", "host_convergence_attempted", "host_convergence_available",
        "configured_retry_count", "normalized_retry_count", "world_max_retries", "event_max_retries", "retry_budget_consumed",
        "failure_stage", "error_name", "error_code", "error_message", "diagnostic_code",
        "retryable", "retries_remaining", "from_retry_index", "next_retry_index",
      "world_persisted", "event_persisted", "readback_valid", "canonical_world_present",
      "canonical_character_present", "ui_ready",
      "expected_swipe_id", "expected_floor_version", "actual_floor_version",
      "bioweave_present", "event_count", "character_count", "current_floor_included",
      "source", "ready", "ui_state_fingerprint", "rendered_field_count", "unrendered_canonical_field_count", "canonical_field_count",
      "persistence_transaction_id", "floor_transaction_id", "transaction_key", "owner", "operation_type", "patch_fields", "queue_key", "queued", "before_presence", "after_presence", "missing_owner_fields", "missing_siblings", "save_invocation_id", "commit_state", "save_state",
      "resolution_reason", "request_source", "panel_open", "active_tab",
      "refresh_cycle_in_flight", "queued_refresh", "business_refresh_sequence",
      "error_name", "error_message", "diagnostic_code",
      "response_shape", "extraction_mode", "parsed", "events_present",
      "schema_valid", "domain_valid", "validation_error_path",
      "valid_empty", "empty_reason", "expected_event_count",
      "expected_character_count", "expected_character_ids", "actual_event_count",
      "actual_character_count", "actual_registry_character_count",
      "source_event_id", "source_floor_version", "source_observation_fingerprint_hash", "request_key", "assessment_id", "assessment_valid", "assessment_present", "invocation_id", "response_schema_version", "profile_available", "recovery_stage", "stage_selection_outcome", "stage_selection_reason", "active", "guidance_present", "guidance_fingerprint", "character_id", "health_guidance_count", "selected_stage_summary", "guidance_fingerprints", "projection_contribution_count", "context_nonempty", "context_fingerprint", "slot", "slot_nonempty", "clear_reason", "settled_before_listener_resolve", "refresh_outcome", "listener_resolve_policy", "generation_id", "generation_intent_id", "generation_source", "generation_type", "context_ready_before_prompt_read", "ai_request_started_count", "ai_request_completed_count", "reuse_count", "inflight_reuse_count", "adapter_available", "set_extension_prompt_available", "setter_bound_to_context", "position_argument", "depth_argument", "role_argument", "position_constant_available", "role_constant_available",
      "status", "phase",
      ]);
      const safe = Object.fromEntries(
        Object.entries(payload).filter(([key]) => allowed.has(key)),
      );
      persistenceTraceSink?.(safe);
    } catch {
      // Diagnostics must never change the persistence result.
    }
  }

  function persistenceTraceError(error, failureStage) {
    const code = String(
      error?.code ?? error?.error_code ?? error?.diagnostic_code ?? error?.name ?? "ERROR",
    ).slice(0, 160);
    const rawMessage = String(
      error?.safe_error_summary ?? error?.message ?? code,
    );
    const message = rawMessage
      .replace(/authorization\s*[:=]\s*\S+/giu, "authorization:[redacted]")
      .replace(/api[_-]?key\s*[:=]\s*\S+/giu, "api_key:[redacted]")
      .slice(0, 240);
    return {
      failure_stage: failureStage,
      error_name: String(error?.name ?? "Error").slice(0, 80),
      error_code: code,
      error_message: message,
      diagnostic_code: String(error?.diagnostic_code ?? error?.diagnosticCode ?? code).slice(0, 160),
      ...(error?.status !== undefined ? {status: Number(error.status) || String(error.status)} : {}),
    };
  }

  function ownerKey(context, owner = {}) {
    const identity = ownerIdentityFromContext(context);
    const characterId =
      owner?.characterId ?? owner?.character_id ?? identity.characterId;
    const groupId = owner?.groupId ?? owner?.group_id ?? identity.groupId;
    const character = characterForOwner(context, owner);
    return `${groupId ?? ""}|${characterId ?? ""}|${character?.avatar_url ?? ""}`;
  }

  function sourceDescriptor(context, owner = {}) {
    return io.getOwnerDescriptor(owner);
  }

  async function readOfficialChatOwner(owner) {
    return io.readOfficialChatOwner(owner);
  }

  async function readOfficialFloorSlot({messageIndex, message_id, swipeId = 0, expectedChatId, expectedVersion} = {}) {
    const state = await readOfficialChatOwner({chatId: expectedChatId});
    const expectedMessageId = expectedVersion?.message_id ?? message_id;
    const index = state.messages.findIndex((message, candidateIndex) => {
      if (expectedMessageId == null && Number(candidateIndex) === Number(messageIndex)) return true;
      return String(messageIdForFloor(message, candidateIndex)) === String(expectedMessageId);
    });
    if (index < 0) throw sourceError("STALE_FLOOR_VERSION", {
      version_check_source: "official_owner",
      owner_message_found: false,
    });
    const message = state.messages[index];
    const targetSwipeId = Number.isInteger(Number(swipeId)) && Number(swipeId) >= 0
      ? Number(swipeId)
      : 0;
    if (!isCharacterMessage(message)) throw sourceError("BIOWEAVE_USER_FLOOR_WRITE_FORBIDDEN");
    const slot = readFloorSlot(message, targetSwipeId);
    return {
      floor: slot ? cloneOwnerValue(slot) : null,
      messageIndex: index,
      message_id: messageIdForFloor(message, index),
      swipe_id: targetSwipeId,
      revision: state.revision,
    };
  }

  async function inspectOfficialFloorOwner({messageIndex, swipeId = 0, expectedChatId, expectedVersion} = {}) {
    const context = getContext();
    if (String(context?.chatId) !== String(expectedChatId)) throw sourceError("STALE_CHAT");
    const liveMessages = context?.chat;
    const liveTarget = liveMessages?.[messageIndex];
    if (!Array.isArray(liveMessages) || !liveTarget || !isCharacterMessage(liveTarget))
      throw sourceError("FLOOR_OWNER_REQUIRED");
    const state = await readOfficialChatOwner({chatId: expectedChatId});
    const expectedMessageId = expectedVersion?.message_id ?? messageIdForFloor(liveTarget, messageIndex);
    const officialIndex = state.messages.findIndex((message, index) =>
      String(messageIdForFloor(message, index)) === String(expectedMessageId));
    const officialTarget = officialIndex >= 0 ? state.messages[officialIndex] : null;
    const currentContext = getContext();
    if (String(currentContext?.chatId) !== String(expectedChatId) ||
        currentContext?.chat?.[messageIndex] !== liveTarget)
      throw sourceError("STALE_FLOOR_VERSION");
    const versionOf = async (message, index) => {
      if (!message || !isCharacterMessage(message)) return null;
      const activeSwipe = hasSwipeStructure(message)
        ? Number.isInteger(message.swipe_id) ? message.swipe_id : 0
        : 0;
      return floorVersion({
        chatId: expectedChatId,
        messageId: messageIdForFloor(message, index),
        floor: message.floor ?? index,
        swipeId: activeSwipe,
        text: messageTextForFloor(message, activeSwipe),
        messageVersion: message.message_version ?? message.messageVersion,
      });
    };
    return {
      state,
      liveTarget,
      officialTarget,
      officialIndex,
      liveTargetVersion: await versionOf(liveTarget, messageIndex),
      officialTargetVersion: await versionOf(officialTarget, officialIndex),
      livePredecessorVersion: messageIndex > 0
        ? await versionOf(liveMessages[messageIndex - 1], messageIndex - 1) : null,
      officialPredecessorVersion: officialIndex > 0
        ? await versionOf(state.messages[officialIndex - 1], officialIndex - 1) : null,
      liveMessageCount: liveMessages.length,
      officialMessageCount: state.messages.length,
      targetIndex: messageIndex,
      activeSwipeId: hasSwipeStructure(liveTarget)
        ? Number.isInteger(liveTarget.swipe_id) ? liveTarget.swipe_id : 0 : 0,
      officialSwipeId: officialTarget && hasSwipeStructure(officialTarget)
        ? Number.isInteger(officialTarget.swipe_id) ? officialTarget.swipe_id : 0 : 0,
      requestedSwipeId: swipeId,
      expectedVersion,
    };
  }

  async function bootstrapOfficialFloorOwner({inspection, expectedVersion} = {}) {
    const {state, liveTarget, officialTarget, targetIndex} = inspection ?? {};
    if (!state || !liveTarget || !Number.isInteger(targetIndex))
      throw sourceError("FLOOR_TX_BOOTSTRAP_INVALID");
    const context = getContext();
    if (String(context?.chatId) !== String(expectedVersion?.chat_id) ||
        context?.chat?.[targetIndex] !== liveTarget)
      throw sourceError("STALE_FLOOR_VERSION");
    const activeSwipe = Number(expectedVersion.swipe_id);
    const currentVersion = await floorVersion({
      chatId: expectedVersion.chat_id,
      messageId: messageIdForFloor(liveTarget, targetIndex),
      floor: liveTarget.floor ?? targetIndex,
      swipeId: activeSwipe,
      text: messageTextForFloor(liveTarget, activeSwipe),
      messageVersion: liveTarget.message_version ?? liveTarget.messageVersion,
    });
    if (!sameFloorVersion(currentVersion, expectedVersion))
      throw sourceError("STALE_FLOOR_VERSION");
    const next = cloneOwnerValue(state.messages);
    const target = officialTarget ? cloneOwnerValue(officialTarget) : cloneOwnerValue(liveTarget);
    if (officialTarget) {
      for (const key of ["message_id", "floor", "role", "is_user", "is_system", "mes", "content", "message_version", "messageVersion", "swipe_id"])
        if (Object.prototype.hasOwnProperty.call(liveTarget, key)) target[key] = cloneOwnerValue(liveTarget[key]);
      if (hasSwipeStructure(liveTarget)) {
        target.swipes = cloneOwnerValue(officialTarget.swipes ?? []);
        target.swipes[activeSwipe] = cloneOwnerValue(liveTarget.swipes?.[activeSwipe] ?? messageTextForFloor(liveTarget, activeSwipe));
        target.swipe_info = cloneOwnerValue(officialTarget.swipe_info ?? []);
        target.swipe_info[activeSwipe] = {
          ...cloneOwnerValue(officialTarget.swipe_info?.[activeSwipe] ?? {}),
          ...cloneOwnerValue(liveTarget.swipe_info?.[activeSwipe] ?? {}),
          extra: cloneOwnerValue(officialTarget.swipe_info?.[activeSwipe]?.extra ?? {}),
        };
      } else {
        target.extra = cloneOwnerValue(officialTarget.extra ?? {});
      }
    }
    next[targetIndex] = target;
    const descriptor = sourceDescriptor(context, {chatId: expectedVersion.chat_id});
    const header = {
      ...(state.header && typeof state.header === "object" ? cloneOwnerValue(state.header) : {}),
      chat_metadata: cloneOwnerValue(state.chatMetadata),
      user_name: state.header?.user_name ?? "unused",
      character_name: state.header?.character_name ?? "unused",
    };
    await io.requestOfficialChatSave({
      descriptor,
      chat: [header, ...next],
    });
    const readback = await inspectOfficialFloorOwner({
      messageIndex: targetIndex,
      swipeId: activeSwipe,
      expectedChatId: expectedVersion.chat_id,
      expectedVersion,
    });
    if (!sameFloorVersion(readback.officialTargetVersion, expectedVersion))
      throw sourceError("FLOOR_TX_BOOTSTRAP_READBACK_FAILED");
    return readback;
  }

  function sameMessageIdentityAndBody(left, right, index) {
    if (!left || !right) return false;
    if (String(messageIdForFloor(left, index)) !== String(messageIdForFloor(right, index))) return false;
    const leftSwipe = Number.isInteger(left.swipe_id) ? left.swipe_id : 0;
    const rightSwipe = Number.isInteger(right.swipe_id) ? right.swipe_id : 0;
    return messageTextForFloor(left, leftSwipe) === messageTextForFloor(right, rightSwipe) &&
      JSON.stringify(stableOwnerValue({
        floor: left.floor ?? index,
        swipe_id: leftSwipe,
        message_version: left.message_version ?? left.messageVersion ?? null,
      })) === JSON.stringify(stableOwnerValue({
        floor: right.floor ?? index,
        swipe_id: rightSwipe,
        message_version: right.message_version ?? right.messageVersion ?? null,
      }));
  }

  async function acquireAuthoritativeFloorOwner({
    expectedVersion,
    messageIndex,
    swipeId = 0,
    generationSettled = false,
  } = {}) {
    const inspection = await inspectOfficialFloorOwner({
      messageIndex,
      swipeId,
      expectedChatId: expectedVersion?.chat_id,
      expectedVersion,
    });
    if (inspection.officialTargetVersion &&
        sameFloorVersion(inspection.officialTargetVersion, expectedVersion)) {
      return {
        classification: "AUTHORITATIVE_MATCH",
        officialOwnerFound: true,
        officialFloorVersionMatch: true,
        confirmed: true,
        commitState: "readback_confirmed",
      };
    }
    const context = getContext();
    const liveVersion = inspection.liveTargetVersion;
    const activeSwipeMatch = inspection.activeSwipeId === Number(expectedVersion?.swipe_id);
    const ownerIdentityMatch = String(messageIdForFloor(inspection.liveTarget, messageIndex)) ===
      String(expectedVersion?.message_id);
    const predecessorMatch = inspection.targetIndex === 0 ||
      sameFloorVersion(inspection.livePredecessorVersion, inspection.officialPredecessorVersion);
    const officialTargetIdentityMatch = !inspection.officialTarget || (
      inspection.officialIndex === inspection.targetIndex &&
      String(messageIdForFloor(inspection.officialTarget, inspection.officialIndex)) ===
      String(expectedVersion?.message_id) &&
      (Number.isInteger(inspection.officialTarget.swipe_id)
        ? inspection.officialTarget.swipe_id : 0) === Number(expectedVersion?.swipe_id) &&
      (inspection.officialTarget.floor ?? inspection.officialIndex) === expectedVersion?.floor
    );
    const unrelatedMessagesMatch = inspection.officialMessageCount <= inspection.liveMessageCount &&
      inspection.state.messages.every((message, index) => {
        if (index === inspection.officialIndex) return true;
        return sameMessageIdentityAndBody(message, context?.chat?.[index], index);
      });
    const targetCanBeBootstrapped = generationSettled &&
      liveVersion && sameFloorVersion(liveVersion, expectedVersion) &&
      String(context?.chatId) === String(expectedVersion?.chat_id) &&
      ownerIdentityMatch && activeSwipeMatch && predecessorMatch &&
      officialTargetIdentityMatch && unrelatedMessagesMatch &&
      inspection.officialMessageCount <= inspection.liveMessageCount &&
      (inspection.officialTarget || inspection.officialMessageCount === inspection.targetIndex);
    if (!targetCanBeBootstrapped) {
      return {
        classification: "TRUE_STALE_OWNER_CHANGE",
        officialOwnerFound: Boolean(inspection.officialTarget),
        officialFloorVersionMatch: false,
        confirmed: false,
        versionAudit: {
          expected: expectedVersion,
          actual: inspection.officialTargetVersion,
          owner_identity_match: ownerIdentityMatch,
          active_swipe_match: activeSwipeMatch,
          predecessor_match: predecessorMatch,
        },
      };
    }
    const bootstrapped = await bootstrapOfficialFloorOwner({inspection, expectedVersion});
    return {
      classification: "HOST_AHEAD_OF_OFFICIAL",
      officialOwnerFound: true,
      officialFloorVersionMatch: sameFloorVersion(bootstrapped.officialTargetVersion, expectedVersion),
      confirmed: sameFloorVersion(bootstrapped.officialTargetVersion, expectedVersion),
      commitState: "readback_confirmed",
    };
  }

  async function saveOfficialChatOwner(payload) {
    const owner = payload?.owner ?? payload;
    const descriptor = sourceDescriptor(getContext(), owner);
    const latest = await readOfficialChatOwner(owner);
    if (payload?.signal?.aborted)
      throw sourceError("SOURCE_OWNER_SAVE_UNKNOWN", { commitState: "unknown" });
    const plan = buildClearPlan({
      domain: payload?.plan?.domain ?? payload?.plan?.operation ?? "all",
      owner,
      chatId: descriptor.chatId,
      state: latest,
      sourceTargeted: true,
    });
    const next = applyClearPlanToState(latest, plan);
    const header = {
      ...(next.header && typeof next.header === "object" ? cloneOwnerValue(next.header) : {}),
      chat_metadata: cloneOwnerValue(next.chatMetadata),
      user_name: next.header?.user_name ?? "unused",
      character_name: next.header?.character_name ?? "unused",
    };
    await io.requestOfficialChatSave({
      descriptor,
      chat: [header, ...cloneOwnerValue(next.messages)],
      signal: payload?.signal,
    });
    return {
      commitState: "confirmed",
      mergeMode: "latest-source",
      baseRevision: latest.revision,
      baseState: cloneOwnerValue(latest),
      plan,
    };
  }

  function messageTextForFloor(message, swipeId) {
    if (hasSwipeStructure(message)) {
      const active = Number.isInteger(message?.swipe_id) ? message.swipe_id : 0;
      return message?.swipes?.[swipeId]
        ?? message?.swipe_info?.[swipeId]?.mes
        ?? (Number(swipeId) === active ? message?.mes ?? message?.content ?? "" : "");
    }
    return message?.mes ?? message?.content ?? "";
  }

  function messageIdForFloor(message, fallback) {
    return message?.message_id ?? message?.messageId ?? message?.id ?? fallback;
  }

  function writeFloorSlot(message, swipeId, value) {
    if (hasSwipeStructure(message)) {
      const canCreateInitialSwipe = Number(swipeId) === 0
        && (Number.isInteger(message?.swipe_id) ? message.swipe_id : 0) === 0
        && Boolean(
          message?.swipes?.[0] ??
          message?.mes ??
          message?.content ??
          message?.swipe_info?.[0]?.mes,
        );
      if (!hasSwipeSlot(message, swipeId) && !canCreateInitialSwipe)
        throw sourceError("SWIPE_NOT_FOUND");
      message.swipe_info ??= [];
      message.swipe_info[swipeId] ??= {};
      message.swipe_info[swipeId].extra ??= {};
      message.swipe_info[swipeId].extra.bioweave = cloneOwnerValue(value);
      return;
    }
    message.extra ??= {};
    message.extra.bioweave = cloneOwnerValue(value);
  }

  function readFloorSlot(message, swipeId) {
    if (hasSwipeStructure(message))
      return message?.swipe_info?.[swipeId]?.extra?.bioweave;
    return message?.extra?.bioweave;
  }

  function mergeFloorSlot(latestSlot, incomingSlot, domain) {
    const latest = latestSlot && typeof latestSlot === "object" && !Array.isArray(latestSlot)
      ? latestSlot
      : {};
    const incoming = incomingSlot && typeof incomingSlot === "object" && !Array.isArray(incomingSlot)
      ? incomingSlot
      : {};
    if (domain === "world") {
      return {
        ...cloneOwnerValue(latest),
        floor_version: cloneOwnerValue(incoming.floor_version ?? latest.floor_version),
        world_model: cloneOwnerValue(incoming.world_model),
        world_model_meta: cloneOwnerValue(incoming.world_model_meta),
      };
    }
    if (domain === "event") {
      return {
        ...cloneOwnerValue(latest),
        floor_version: cloneOwnerValue(incoming.floor_version ?? latest.floor_version),
        analysis: cloneOwnerValue(incoming.analysis),
        events: cloneOwnerValue(incoming.events),
        character_registry: cloneOwnerValue(incoming.character_registry),
      };
    }
    if (domain === "projection") {
      return {
        ...cloneOwnerValue(latest),
        floor_version: cloneOwnerValue(incoming.floor_version ?? latest.floor_version),
        snapshot: cloneOwnerValue(incoming.snapshot),
        projection_timeline: cloneOwnerValue(incoming.projection_timeline),
      };
    }
    return cloneOwnerValue(incoming);
  }

  function slotPresence(slot) {
    return {
      slot_present: slot !== undefined && slot !== null,
      world_present: slot?.world_model !== undefined && slot?.world_model !== null,
      analysis_present: slot?.analysis !== undefined && slot?.analysis !== null,
      events_present: Array.isArray(slot?.events),
      character_registry_present: slot?.character_registry !== undefined && slot?.character_registry !== null,
      snapshot_present: slot?.snapshot !== undefined && slot?.snapshot !== null,
      projection_timeline_present: slot?.projection_timeline !== undefined && slot?.projection_timeline !== null,
    };
  }

  async function syncHostMemoryFloorSlot({
    messageIndex,
    swipeId,
    value,
    expectedChatId,
    expectedVersion,
    trace,
    beforeStage,
    afterStage,
  }) {
    const context = getContext();
    if (String(context?.chatId) !== String(expectedChatId))
      throw sourceError("STALE_CHAT");
    const message = context?.chat?.[messageIndex];
    if (!message) throw sourceError("MESSAGE_NOT_FOUND");
    const expectedMessageId = expectedVersion?.message_id ?? messageIdForFloor(message, messageIndex);
    const actualMessageId = messageIdForFloor(message, messageIndex);
    const activeSwipe = hasSwipeStructure(message)
      ? Number.isInteger(message.swipe_id) ? message.swipe_id : swipeId
      : swipeId;
    if (String(actualMessageId) !== String(expectedMessageId))
      throw sourceError("STALE_FLOOR_VERSION");
    if (hasSwipeStructure(message) && activeSwipe !== swipeId)
      throw sourceError("STALE_SWIPE");
    if (expectedVersion) {
      const currentVersion = await floorVersion({
        chatId: expectedChatId,
        messageId: actualMessageId,
        floor: message.floor ?? messageIndex,
        swipeId,
        text: messageTextForFloor(message, swipeId),
        messageVersion: message.message_version ?? message.messageVersion,
      });
      if (!sameFloorVersion(currentVersion, expectedVersion))
        throw sourceError("STALE_FLOOR_VERSION");
    }
    const beforeResult = io.readHostFloorSlot({
      messageIndex,
      swipeIndex: swipeId,
    });
    const before = beforeResult.slot;
    trace(beforeStage, {
      message_index: messageIndex,
      swipe_id: swipeId,
      slot_present: before !== undefined,
      host_memory_slot_present: before !== undefined,
      ...slotPresence(before),
    });
    const afterResult = io.writeHostFloorSlot({
      messageIndex,
      swipeIndex: swipeId,
      bioweave: value,
    });
    const after = afterResult.slot;
    trace(afterStage, {
      message_index: messageIndex,
      swipe_id: swipeId,
      slot_present: after !== undefined,
      host_memory_slot_present: after !== undefined,
      ...slotPresence(after),
      floor_version_match: Boolean(after?.floor_version && expectedVersion && sameFloorVersion(after.floor_version, expectedVersion)),
      active_swipe_match: !hasSwipeStructure(message) || activeSwipe === swipeId,
    });
    return {context, message, slot: after};
  }

  // Low-level host/official Floor adapter used by the storage boundary. The
  // business modules submit owner patches to FloorPersistenceCoordinator;
  // this function only performs host compatibility, official save, readback,
  // and convergence checks for the already-merged slot.
  async function saveOfficialFloorSlot(
    messageIndex,
    swipeId,
    value,
    expectedChatId,
    expectedVersion,
    traceContext = null,
  ) {
    const traceStage = (worldStage, eventStage = worldStage) => {
      if (traceContext?.domain === "event") return eventStage;
      if (traceContext?.domain === "world") return worldStage;
      return String(worldStage).replace(/^WORLD_/, "ANALYSIS_");
    };
    const trace = (stage, details = {}) => emitPersistenceTrace({
      ...traceContext,
      stage,
      ...details,
    });
    if (typeof globalThis.fetch !== "function") {
      if (traceContext?.coordinator_transaction === true)
        throw sourceError("ST_OFFICIAL_FLOOR_STORAGE_UNAVAILABLE");
      trace(traceStage("WORLD_SAVE_PATH_SELECTED", "EVENT_SAVE_PATH_SELECTED"), {
        path: "context_fallback",
        reason: "fetch unavailable",
      });
      return null;
    }
    const context = getContext();
    let descriptor;
    try {
      descriptor = sourceDescriptor(context, { chatId: expectedChatId });
    } catch (error) {
      if ([
        "SOURCE_OWNER_CHARACTER_UNAVAILABLE",
        "SOURCE_OWNER_IDENTITY_MISMATCH",
        "SOURCE_OWNER_GROUP_UNSUPPORTED",
      ].includes(error?.code)) {
        if (traceContext?.coordinator_transaction === true) throw error;
        trace(traceStage("WORLD_SAVE_PATH_SELECTED", "EVENT_SAVE_PATH_SELECTED"), {
          path: "context_fallback",
          reason:
            error?.code === "SOURCE_OWNER_CHARACTER_UNAVAILABLE"
              ? "sourceDescriptor unavailable"
              : error?.code === "SOURCE_OWNER_GROUP_UNSUPPORTED"
                ? "unsupported chat source"
                : "owner unresolved",
        });
        return null;
      }
      throw error;
    }
    trace(traceStage("WORLD_SAVE_PATH_SELECTED", "EVENT_SAVE_PATH_SELECTED"), {path: "official"});
    const liveMessage = context?.chat?.[messageIndex];
    if (expectedVersion && liveMessage) {
      const liveSwipeId = hasSwipeStructure(liveMessage)
        ? Number.isInteger(liveMessage.swipe_id) ? liveMessage.swipe_id : swipeId
        : swipeId;
      const liveVersion = await floorVersion({
        chatId: expectedChatId,
        messageId: messageIdForFloor(liveMessage, messageIndex),
        floor: liveMessage.floor ?? messageIndex,
        swipeId: liveSwipeId,
        text: messageTextForFloor(liveMessage, liveSwipeId),
        messageVersion: liveMessage.message_version ?? liveMessage.messageVersion,
      });
      const liveMatches = sameFloorVersion(liveVersion, expectedVersion);
      trace(traceStage("WORLD_OWNER_VERSION_CHECK", "EVENT_OWNER_VERSION_CHECK"), {
        result: liveMatches ? "match" : "mismatch",
        version_check_source: "host_live",
        ...floorVersionAudit(expectedVersion, liveVersion),
      });
      if (!liveMatches)
        throw sourceError("STALE_FLOOR_VERSION", {
          version_check_source: "host_live",
          version_audit: floorVersionAudit(expectedVersion, liveVersion),
        });
    }
    trace("OFFICIAL_GET_BEFORE_SAVE_BEGIN");
    const latest = await readOfficialChatOwner({
      chatId: expectedChatId,
      characterId: descriptor.characterId,
    });
    trace("OFFICIAL_GET_BEFORE_SAVE_END", {revision: latest.revision});
    let target;
    let targetIndex;
    let targetSwipeId;
    let expectedMessageId;
    let failureStage = "official_owner_resolution";
    let prewriteContext = {
      owner_message_found: false,
      swipe_id: Number.isInteger(swipeId) && swipeId >= 0 ? swipeId : 0,
      swipes_present: false,
      swipes_count: 0,
      swipe_info_present: false,
      swipe_info_count: 0,
      swipe_found: false,
      target_swipe_info_found: false,
      target_extra_present: false,
      target_bioweave_present: false,
    };
    try {
      trace("OFFICIAL_RESPONSE_SHAPE_RESOLVED", {
        response_shape: latest.response_shape ?? "json_array_jsonl",
        messages_present: Array.isArray(latest.messages),
        messages_count: Array.isArray(latest.messages) ? latest.messages.length : 0,
      });
      if (!Array.isArray(latest.messages))
        throw sourceError("SOURCE_OWNER_MESSAGES_INVALID");
      trace("OFFICIAL_MESSAGES_RESOLVED", {
        messages_present: true,
        messages_count: latest.messages.length,
      });
      const currentContextForOwner = getContext();
      expectedMessageId = expectedVersion?.message_id ??
        messageIdForFloor(currentContextForOwner?.chat?.[messageIndex], messageIndex);
      targetIndex = latest.messages.findIndex((message, index) =>
        String(messageIdForFloor(message, index)) === String(expectedMessageId));
      trace("OFFICIAL_OWNER_MESSAGE_RESOLVED", {
        owner_found: targetIndex >= 0,
        owner_message_id: targetIndex >= 0
          ? messageIdForFloor(latest.messages[targetIndex], targetIndex)
          : expectedMessageId,
      });
      if (targetIndex < 0) throw sourceError("STALE_FLOOR_VERSION");
      target = latest.messages[targetIndex];
      prewriteContext = {
        ...prewriteContext,
        owner_message_found: true,
        swipes_present: Array.isArray(target?.swipes),
        swipes_count: Array.isArray(target?.swipes) ? target.swipes.length : 0,
        swipe_info_present: Boolean(target?.swipe_info && typeof target.swipe_info === "object"),
        swipe_info_count: Array.isArray(target?.swipe_info)
          ? target.swipe_info.length
          : target?.swipe_info && typeof target.swipe_info === "object"
            ? Object.keys(target.swipe_info).length
            : 0,
      };
      if (!isCharacterMessage(target)) {
        trace("OFFICIAL_OWNER_MESSAGE_RESOLVED", {
          owner_found: false,
          owner_message_id: messageIdForFloor(target, targetIndex),
        });
        throw sourceError("BIOWEAVE_USER_FLOOR_WRITE_FORBIDDEN");
      }
      failureStage = "official_owner_swipe_resolution";
      targetSwipeId = Number.isInteger(swipeId) && swipeId >= 0 ? swipeId : 0;
      const targetSwipeInfo = target?.swipe_info?.[targetSwipeId];
      const canCreateInitialSwipe = targetSwipeId === 0
        && (Number.isInteger(target?.swipe_id) ? target.swipe_id : 0) === 0
        && Boolean(
          target?.swipes?.[0] ??
          target?.mes ??
          target?.content ??
          target?.swipe_info?.[0]?.mes,
        );
      const swipeFound = !hasSwipeStructure(target) || hasSwipeSlot(target, targetSwipeId) || canCreateInitialSwipe;
      prewriteContext = {
        ...prewriteContext,
        swipe_id: targetSwipeId,
        swipe_found: swipeFound,
        target_swipe_info_found: targetSwipeInfo !== undefined && targetSwipeInfo !== null,
        target_extra_present: Boolean(targetSwipeInfo?.extra && typeof targetSwipeInfo.extra === "object"),
        target_bioweave_present: targetSwipeInfo?.extra?.bioweave !== undefined,
      };
      trace("OFFICIAL_OWNER_SWIPE_RESOLVED", {
        swipe_found: swipeFound,
        swipe_structure: hasSwipeStructure(target),
        active_swipe_id: Number.isInteger(target.swipe_id) ? target.swipe_id : targetSwipeId,
        swipe_id: targetSwipeId,
        swipes_present: Array.isArray(target?.swipes),
        swipes_count: Array.isArray(target?.swipes) ? target.swipes.length : 0,
        swipe_info_present: Boolean(target?.swipe_info && typeof target.swipe_info === "object"),
        swipe_info_count: Array.isArray(target?.swipe_info)
          ? target.swipe_info.length
          : target?.swipe_info && typeof target.swipe_info === "object"
            ? Object.keys(target.swipe_info).length
            : 0,
        target_swipe_info_found: targetSwipeInfo !== undefined && targetSwipeInfo !== null,
        target_extra_present: Boolean(targetSwipeInfo?.extra && typeof targetSwipeInfo.extra === "object"),
        target_bioweave_present: targetSwipeInfo?.extra?.bioweave !== undefined,
      });
      if (!swipeFound || (hasSwipeStructure(target) &&
        Number.isInteger(target.swipe_id) && target.swipe_id !== targetSwipeId))
        throw sourceError("STALE_FLOOR_VERSION");
      if (expectedVersion) {
        failureStage = "official_owner_floor_version_check";
        const authoritativeVersion = await floorVersion({
          chatId: expectedChatId,
          messageId: messageIdForFloor(target, targetIndex),
          floor: target.floor ?? targetIndex,
          swipeId: targetSwipeId,
          text: messageTextForFloor(target, targetSwipeId),
          messageVersion: target.message_version ?? target.messageVersion,
        });
        const versionMatches = sameFloorVersion(authoritativeVersion, expectedVersion);
        const audit = floorVersionAudit(expectedVersion, authoritativeVersion);
        trace(traceStage("WORLD_OWNER_VERSION_CHECK", "EVENT_OWNER_VERSION_CHECK"), {
          result: versionMatches ? "match" : "mismatch",
          version_check_source: "official_owner",
          ...audit,
        });
        if (!versionMatches) {
          const hostConvergenceAttempted = traceContext?.host_convergence_attempted === true;
          const currentContextForConvergence = getContext();
          const currentMessageForConvergence = currentContextForConvergence?.chat?.[messageIndex];
          const currentSwipeIdForConvergence = hasSwipeStructure(currentMessageForConvergence)
            ? Number.isInteger(currentMessageForConvergence?.swipe_id)
              ? currentMessageForConvergence.swipe_id
              : swipeId
            : swipeId;
          let currentVersionForConvergence = null;
          if (expectedVersion && currentMessageForConvergence) {
            currentVersionForConvergence = await floorVersion({
              chatId: expectedChatId,
              messageId: messageIdForFloor(currentMessageForConvergence, messageIndex),
              floor: currentMessageForConvergence.floor ?? messageIndex,
              swipeId: currentSwipeIdForConvergence,
              text: messageTextForFloor(currentMessageForConvergence, currentSwipeIdForConvergence),
              messageVersion: currentMessageForConvergence.message_version ?? currentMessageForConvergence.messageVersion,
            });
          }
          const liveStillMatches = Boolean(
            currentContextForConvergence &&
            String(currentContextForConvergence.chatId) === String(expectedChatId) &&
            currentVersionForConvergence &&
            sameFloorVersion(currentVersionForConvergence, expectedVersion),
          );
          if (traceContext?.coordinator_transaction !== true && !hostConvergenceAttempted && liveStillMatches) {
            const acquisition = await acquireAuthoritativeFloorOwner({
              expectedVersion,
              messageIndex,
              swipeId,
              generationSettled: traceContext?.generation_settled === true,
            });
            if (acquisition?.confirmed !== true)
              throw sourceError("STALE_FLOOR_VERSION", {
                version_check_source: "official_owner",
                classification: acquisition?.classification ?? "TRUE_STALE_OWNER_CHANGE",
                version_audit: audit,
              });
            return saveOfficialFloorSlot(
              messageIndex,
              swipeId,
              value,
              expectedChatId,
              expectedVersion,
              {...traceContext, host_convergence_attempted: true, coordinator_transaction: true},
            );
          }
          const convergenceError = sourceError("STALE_FLOOR_VERSION", {
            version_check_source: "official_owner",
            version_audit: audit,
          });
          convergenceError.host_convergence_attempted = hostConvergenceAttempted;
          convergenceError.host_convergence_available = typeof currentContextForConvergence?.saveChat === "function";
          throw convergenceError;
        }
      }
      const currentContextForLive = getContext();
      if (expectedVersion && currentContextForLive?.chat?.[messageIndex]) {
        failureStage = "official_owner_live_version_check";
        const current = currentContextForLive.chat[messageIndex];
        const currentSwipeId = hasSwipeStructure(current)
          ? Number.isInteger(current.swipe_id) ? current.swipe_id : swipeId
          : swipeId;
        const currentVersion = await floorVersion({
          chatId: expectedChatId,
          messageId: messageIdForFloor(current, messageIndex),
          floor: current.floor ?? messageIndex,
          swipeId: currentSwipeId,
          text: messageTextForFloor(current, currentSwipeId),
          messageVersion: current.message_version ?? current.messageVersion,
        });
        const currentMatches = sameFloorVersion(currentVersion, expectedVersion);
        if (!currentMatches) {
          const audit = floorVersionAudit(expectedVersion, currentVersion);
          trace(traceStage("WORLD_OWNER_VERSION_CHECK", "EVENT_OWNER_VERSION_CHECK"), {
            result: "mismatch",
            version_check_source: "host_live_after_official_get",
            ...audit,
          });
          throw sourceError("STALE_FLOOR_VERSION", {
            version_check_source: "host_live_after_official_get",
            version_audit: audit,
          });
        }
      }
      // The slot marker is deliberately emitted only after all owner and
      // Floor Version guards pass.
    } catch (error) {
      error.analysis_stage ??= failureStage;
      trace("OFFICIAL_PREWRITE_FAILED", {
        ...persistenceTraceError(error, failureStage),
        ...prewriteContext,
      });
      throw error;
    }
    trace(traceStage("WORLD_SLOT_BEFORE_WRITE", "EVENT_SLOT_BEFORE_WRITE"), {
      present: readFloorSlot(target, targetSwipeId) !== undefined,
    });
    if (traceContext?.domain === "event") {
      const existing = readFloorSlot(target, targetSwipeId);
      trace("EVENT_SOURCE_WORLD_PRESENT", {
        present: existing?.world_model !== undefined && existing?.world_model !== null,
      });
    }
    // The coordinator has already merged the owner-scoped patch against its
    // dispatch-time latest slot. The adapter is only a low-level transport
    // boundary in that path and must never apply a second domain merge.
    const mergedValue = traceContext?.coordinator_transaction === true
      ? cloneOwnerValue(value)
      : mergeFloorSlot(
        readFloorSlot(target, targetSwipeId),
        value,
        traceContext?.domain,
      );
    writeFloorSlot(target, targetSwipeId, mergedValue);
    trace(traceStage("WORLD_SLOT_AFTER_MERGE", "EVENT_SLOT_AFTER_MERGE"), {
      present: readFloorSlot(target, targetSwipeId) !== undefined,
    });
    await syncHostMemoryFloorSlot({
      messageIndex,
      swipeId: targetSwipeId,
      value: mergedValue,
      expectedChatId,
      expectedVersion,
      trace,
      beforeStage: traceStage("HOST_MEMORY_SLOT_BEFORE_SYNC", "EVENT_HOST_MEMORY_SLOT_BEFORE_SYNC"),
      afterStage: traceStage("HOST_MEMORY_SLOT_AFTER_SYNC", "EVENT_HOST_MEMORY_SLOT_AFTER_SYNC"),
    });
    const header = {
      ...(latest.header && typeof latest.header === "object" ? cloneOwnerValue(latest.header) : {}),
      chat_metadata: cloneOwnerValue(latest.chatMetadata),
      user_name: latest.header?.user_name ?? "unused",
      character_name: latest.header?.character_name ?? "unused",
    };
    const persistenceTransactionId = `bw-${Date.now()}-${++saveInvocationSequence}`;
    const saveInvocationId = `${persistenceTransactionId}-official`;
    const capturedPresence = slotPresence(mergedValue);
    trace("BIOWEAVE_FULL_CHAT_SAVE_CAPTURED", {
      source: "official_clone",
      persistence_transaction_id: persistenceTransactionId,
      save_invocation_id: saveInvocationId,
      commit_state: "not-dispatched",
      ...capturedPresence,
    });
    trace(traceStage("OFFICIAL_SAVE_BEGIN", "EVENT_SAVE_BEGIN"));
    trace("BIOWEAVE_FULL_CHAT_SAVE_DISPATCHED", {
      source: "official_clone",
      persistence_transaction_id: persistenceTransactionId,
      save_invocation_id: saveInvocationId,
      commit_state: "dispatched",
    });
    try {
      await io.requestOfficialChatSave({
        descriptor,
        chat: [header, ...cloneOwnerValue(latest.messages)],
      });
      trace("BIOWEAVE_FULL_CHAT_SAVE_RESOLVED", {
        source: "official_clone",
        persistence_transaction_id: persistenceTransactionId,
        save_invocation_id: saveInvocationId,
        commit_state: "resolved",
      });
    } catch (error) {
      trace("BIOWEAVE_FULL_CHAT_SAVE_RESOLVED", {
        source: "official_clone",
        persistence_transaction_id: persistenceTransactionId,
        save_invocation_id: saveInvocationId,
        commit_state: "unknown",
        ...persistenceTraceError(error, "official_save"),
      });
      throw error;
    }
    trace(traceStage("OFFICIAL_SAVE_END", "EVENT_SAVE_END"));
    trace("OFFICIAL_GET_AFTER_SAVE_BEGIN");
    const committed = await readOfficialChatOwner({
      chatId: expectedChatId,
      characterId: descriptor.characterId,
    });
    trace("OFFICIAL_GET_AFTER_SAVE_END", {revision: committed.revision});
    const committedMessage = committed.messages.find((message, index) =>
      String(messageIdForFloor(message, index)) === String(expectedMessageId));
    const readbackPresent = Boolean(committedMessage && readFloorSlot(committedMessage, targetSwipeId) !== undefined);
    trace("BIOWEAVE_FULL_CHAT_SAVE_READBACK", {
      source: "official_clone",
      persistence_transaction_id: persistenceTransactionId,
      save_invocation_id: saveInvocationId,
      commit_state: readbackPresent ? "readback_confirmed" : "unknown",
      ...slotPresence(committedMessage ? readFloorSlot(committedMessage, targetSwipeId) : undefined),
    });
    trace(traceStage("WORLD_SLOT_AFTER_READBACK", "EVENT_SLOT_AFTER_READBACK"), {
      present: readbackPresent,
      floor_version_match: Boolean(committedMessage),
      swipe_match: Boolean(committedMessage && (!hasSwipeStructure(committedMessage) || committedMessage.swipe_id === targetSwipeId)),
    });
    if (!committedMessage || JSON.stringify(readFloorSlot(committedMessage, targetSwipeId)) !== JSON.stringify(mergedValue))
      throw sourceError("FLOOR_PERSISTENCE_READBACK_FAILED");
    await syncHostMemoryFloorSlot({
      messageIndex,
      swipeId: targetSwipeId,
      value: mergedValue,
      expectedChatId,
      expectedVersion,
      trace,
      beforeStage: traceStage("HOST_MEMORY_SLOT_BEFORE_SYNC", "EVENT_HOST_MEMORY_SLOT_BEFORE_SYNC"),
      afterStage: traceStage("HOST_MEMORY_SLOT_AFTER_SYNC", "EVENT_HOST_MEMORY_SLOT_AFTER_SYNC"),
    });
    const finalState = await readOfficialChatOwner({
      chatId: expectedChatId,
      characterId: descriptor.characterId,
    });
    const finalMessage = finalState.messages.find((message, index) =>
      String(messageIdForFloor(message, index)) === String(expectedMessageId));
    const finalServerSlot = finalMessage
      ? readFloorSlot(finalMessage, targetSwipeId)
      : undefined;
    const finalLiveContext = getContext();
    const finalLiveMessage = finalLiveContext?.chat?.[messageIndex];
    const finalHostSlot = finalLiveMessage
      ? readFloorSlot(finalLiveMessage, targetSwipeId)
      : undefined;
    const finalServerPresence = slotPresence(finalServerSlot);
    const finalHostPresence = slotPresence(finalHostSlot);
    trace("FINAL_FLOOR_SLOT_AUDIT", {
      message_index: messageIndex,
      swipe_id: targetSwipeId,
      official_owner_found: Boolean(finalMessage),
      official_swipe_found: Boolean(finalMessage && (!hasSwipeStructure(finalMessage) || hasSwipeSlot(finalMessage, targetSwipeId))),
      official_bioweave_present: finalServerPresence.slot_present,
      official_world_present: finalServerPresence.world_present,
      official_analysis_present: finalServerPresence.analysis_present,
      official_events_present: finalServerPresence.events_present,
      official_character_registry_present: finalServerPresence.character_registry_present,
      official_snapshot_present: finalServerPresence.snapshot_present,
      official_projection_timeline_present: finalServerPresence.projection_timeline_present,
      host_memory_owner_found: Boolean(finalLiveMessage),
      host_memory_swipe_found: Boolean(finalLiveMessage && (!hasSwipeStructure(finalLiveMessage) || hasSwipeSlot(finalLiveMessage, targetSwipeId))),
      host_memory_bioweave_present: finalHostPresence.slot_present,
      host_memory_world_present: finalHostPresence.world_present,
      host_memory_analysis_present: finalHostPresence.analysis_present,
      host_memory_events_present: finalHostPresence.events_present,
      host_memory_character_registry_present: finalHostPresence.character_registry_present,
      host_memory_snapshot_present: finalHostPresence.snapshot_present,
      host_memory_projection_timeline_present: finalHostPresence.projection_timeline_present,
      floor_version_match: Boolean(finalServerSlot?.floor_version && expectedVersion && sameFloorVersion(finalServerSlot.floor_version, expectedVersion)),
      active_swipe_match: Boolean(finalMessage && (!hasSwipeStructure(finalMessage) || finalMessage.swipe_id === targetSwipeId)),
    });
    if (JSON.stringify(finalServerSlot) !== JSON.stringify(mergedValue))
      throw sourceError("FLOOR_PERSISTENCE_READBACK_FAILED");
    return {
      commitState: "confirmed",
      mergeMode: "latest-source-floor-slot-and-host-memory",
      authoritativeReadback: true,
    };
  }

  async function refreshOfficialChatIndex() {
    return io.refreshChatIndex();
  }

  return {
    getContext,
    sourceOwnerLatestMerge: SOURCE_OWNER_LATEST_MERGE,
    getChat: () => getContext()?.chat ?? null,
    getExtensionSettings: () => getContext()?.extensionSettings ?? null,
    getGlobalSettings: () => getContext()?.extensionSettings?.bioweave ?? null,
    getRequestHeaders: () => getContext()?.getRequestHeaders?.() ?? {},
    fetch: (...args) => globalThis.fetch(...args),
    async saveGlobalSettings(value) {
      const context = getContext();
      if (
        !context?.extensionSettings ||
        typeof context.saveSettingsDebounced !== "function"
      ) {
        throw new Error("ST_EXTENSION_SETTINGS_UNAVAILABLE");
      }
      const hadPrevious = Object.prototype.hasOwnProperty.call(
        context.extensionSettings,
        "bioweave",
      );
      const previous = context.extensionSettings.bioweave;
      context.extensionSettings.bioweave = value;
      try {
        await context.saveSettingsDebounced();
      } catch (error) {
        if (hadPrevious) context.extensionSettings.bioweave = previous;
        else delete context.extensionSettings.bioweave;
        throw error;
      }
    },
    getChatId: () => getContext()?.chatId ?? null,
    getChatMetadata: () => getContext()?.chatMetadata ?? null,
    getMessage: (index) => getContext()?.chat?.[index] ?? null,
    getChatRevision: (chatId) => {
      const context = getContext();
      const value =
        context?.chatRevision ??
        context?.chat_revision ??
        context?.chatStateRevision ??
        context?.chat_state_revision;
      if (typeof context?.getChatRevision === "function")
        return context.getChatRevision(chatId);
      if (typeof context?.getRevision === "function")
        return context.getRevision(chatId);
      return value;
    },
    getChatOwnerIdentity: () => {
      const context = getContext();
      if (typeof context?.getChatOwnerIdentity === "function")
        return context.getChatOwnerIdentity();
      return {
        characterId:
          context?.characterId ??
          context?.character_id ??
          context?.activeCharacterId ??
          context?.active_character_id ??
          null,
        groupId:
          context?.groupId ??
          context?.group_id ??
          context?.activeGroupId ??
          context?.active_group_id ??
          null,
      };
    },
    getChatIndex: () => {
      const context = getContext();
      if (typeof context?.getChatIndex === "function")
        return context.getChatIndex();
      if (typeof context?.getKnownChatIds === "function")
        return context.getKnownChatIds();
      const contextIndex =
        context?.chatIndex ?? context?.chat_index ?? context?.chatIds ?? null;
      if (contextIndex !== null && contextIndex !== undefined)
        return contextIndex;
      return chatIndexOwnerKey === ownerKey(context)
        ? new Set(chatIndexCache ?? [])
        : null;
    },
    refreshChatIndex: refreshOfficialChatIndex,
    isFreshChat: (chatId) => {
      const context = getContext();
      if (typeof context?.isFreshChat === "function")
        return context.isFreshChat(chatId);
      if (typeof context?.getChatFreshness === "function")
        return context.getChatFreshness(chatId);
      return undefined;
    },
    hasSourceOwnerCapability: () => {
      const context = getContext();
      const reader = [
        "readChatOwner",
        "readChatSnapshot",
        "getChatOwnerSnapshot",
      ].some((name) => typeof context?.[name] === "function");
      const writer = [
        "compareAndSaveChatOwner",
        "compareAndSwapChatOwner",
        "saveChatOwnerCAS",
        "commitChatOwnerCAS",
        "saveChatOwner",
        "saveChatSnapshot",
        "saveChatStateByOwner",
      ].some((name) => typeof context?.[name] === "function");
      const cas =
        context?.sourceOwnerRevisionCAS === true ||
        context?.supportsSourceOwnerRevisionCAS === true ||
        context?.capabilities?.sourceOwnerRevisionCAS === true ||
        [
          "compareAndSaveChatOwner",
          "compareAndSwapChatOwner",
          "saveChatOwnerCAS",
          "commitChatOwnerCAS",
        ].some((name) => typeof context?.[name] === "function");
      const officialLatestMerge = Boolean(
        typeof globalThis.fetch === "function" &&
        context &&
        context?.chatId &&
        characterForOwner(context, { chatId: context.chatId }),
      );
      return Boolean(
        (reader && writer && cas) || officialLatestMerge,
      );
    },
    async compareAndSaveChatOwner(payload) {
      const context = getContext();
      const name = [
        "compareAndSaveChatOwner",
        "compareAndSwapChatOwner",
        "saveChatOwnerCAS",
        "commitChatOwnerCAS",
      ].find((candidate) => typeof context?.[candidate] === "function");
      if (name) return context[name].call(context, payload);
      if (
        context?.sourceOwnerRevisionCAS === true &&
        typeof context?.saveChatOwner === "function"
      )
        return context.saveChatOwner.call(context, payload);
      return saveOfficialChatOwner(payload);
    },
    async readChatOwner(owner) {
      const context = getContext();
      const customReader = [
        "readChatOwner",
        "readChatSnapshot",
        "getChatOwnerSnapshot",
      ].find((name) => typeof context?.[name] === "function");
      return customReader
        ? context[customReader].call(context, owner)
        : readOfficialChatOwner(owner);
    },
    async readOfficialFloorSlot(options = {}) {
      return readOfficialFloorSlot(options);
    },
    async saveChatOwner(payload) {
      const context = getContext();
      const name = [
        "saveChatOwner",
        "saveChatSnapshot",
        "saveChatStateByOwner",
      ].find((candidate) => typeof context?.[candidate] === "function");
      return name
        ? context[name].call(context, payload)
        : saveOfficialChatOwner(payload);
    },
    async saveChat(options = {}) {
      const context = getContext();
      const expectedChatId = options?.expectedChatId ?? options?.chatId;
      if (
        expectedChatId !== undefined &&
        String(context?.chatId) !== String(expectedChatId)
      ) {
        throw sourceError("STALE_CHAT");
      }
      if (typeof context?.saveChat !== "function")
        throw sourceError("ST_CHAT_STORAGE_UNAVAILABLE");
      const response = await context.saveChat();
      if (
        expectedChatId !== undefined &&
        getContext()?.chatId !== expectedChatId
      ) {
        throw sourceError("STALE_CHAT");
      }
      return response ?? {commitState: "unknown", status: "unknown"};
    },
    inspectOfficialFloorOwner,
    bootstrapOfficialFloorOwner,
    acquireAuthoritativeFloorOwner,
    async saveChatMetadata(key, value, expectedChatId) {
      const context = getContext();
      if (expectedChatId !== undefined && context?.chatId !== expectedChatId) {
        throw new Error("STALE_CHAT");
      }
      if (
        !context?.chatMetadata ||
        typeof context.saveMetadata !== "function"
      ) {
        throw new Error("ST_METADATA_UNAVAILABLE");
      }
      context.chatMetadata[key] = value;
      const response = await context.saveMetadata();
      if (
        expectedChatId !== undefined &&
        getContext()?.chatId !== expectedChatId
      ) {
        throw new Error("STALE_CHAT");
      }
      return response ?? { commitState: "confirmed" };
    },
    // Storage-boundary primitive: ordinary callers must use the coordinator;
    // this method remains for the adapter's exact message/Swipe host write.
    async saveFloorBioWeave(messageIndex, swipeId, value, expectedChatId, expectedVersion, traceContext = null) {
      const context = getContext();
      if (expectedChatId !== undefined && context?.chatId !== expectedChatId) {
        throw new Error("STALE_CHAT");
      }
      const message = context?.chat?.[messageIndex];
      if (!message) throw new Error("MESSAGE_NOT_FOUND");
      if (!isCharacterMessage(message))
        throw new Error("BIOWEAVE_USER_FLOOR_WRITE_FORBIDDEN");
      const targetSwipeId =
        Number.isInteger(swipeId) && swipeId >= 0 ? swipeId : 0;
      const authoritative = await saveOfficialFloorSlot(
        messageIndex,
        targetSwipeId,
        value,
        expectedChatId,
        expectedVersion,
        traceContext,
      );
      if (authoritative) return authoritative;
      const trace = (stage, details = {}) => emitPersistenceTrace({
        ...traceContext,
        stage,
        ...details,
      });
      traceContext?.domain === "world"
        ? trace("WORLD_SLOT_BEFORE_WRITE", {present: Boolean(message?.extra?.bioweave || message?.swipe_info?.[targetSwipeId]?.extra?.bioweave)})
        : trace("EVENT_SOURCE_WORLD_PRESENT", {present: Boolean(message?.extra?.bioweave?.world_model || message?.swipe_info?.[targetSwipeId]?.extra?.bioweave?.world_model)});
      if (hasSwipeStructure(message)) {
        if (!hasSwipeSlot(message, targetSwipeId))
          throw new Error("SWIPE_NOT_FOUND");
        message.swipe_info ??= [];
        message.swipe_info[targetSwipeId] ??= {};
        message.swipe_info[targetSwipeId].extra ??= {};
        message.swipe_info[targetSwipeId].extra.bioweave = value;
      } else {
        message.extra ??= {};
        message.extra.bioweave = value;
      }
      trace(traceContext?.domain === "world" ? "WORLD_SLOT_AFTER_MERGE" : "EVENT_SLOT_AFTER_MERGE", {
        present: true,
      });
      if (traceContext?.domain === "event") trace("EVENT_SAVE_BEGIN");
      const response = await this.saveChat({ expectedChatId });
      trace(traceContext?.domain === "world" ? "WORLD_SLOT_AFTER_READBACK" : "EVENT_SLOT_AFTER_READBACK", {
        present: true,
        authoritative: false,
      });
      trace(traceContext?.domain === "world" ? "WORLD_PERSISTENCE_UNCONFIRMED" : "EVENT_SAVE_UNCONFIRMED", {
        commitState: response?.commitState ?? "unknown",
      });
      if (
        expectedChatId !== undefined &&
        getContext()?.chatId !== expectedChatId
      ) {
        throw new Error("STALE_CHAT");
      }
      return response?.commitState
        ? response
        : {commitState: "unknown", status: "unknown"};
    },
    async saveFloorSlot(messageIndex, swipeId, value, expectedChatId, expectedVersion, traceContext = null) {
      return saveOfficialFloorSlot(
        messageIndex,
        swipeId,
        value,
        expectedChatId,
        expectedVersion,
        {...(traceContext ?? {}), coordinator_transaction: true},
      );
    },
    setPersistenceTraceSink(sink) {
      persistenceTraceSink = typeof sink === "function" ? sink : null;
    },
    setExtensionPrompt({key, content, position, depth, scan = false, role} = {}) {
      const context = getContext();
      const setter = context?.setExtensionPrompt ?? globalThis.setExtensionPrompt;
      if (typeof setter !== "function") throw sourceError("ST_EXTENSION_PROMPT_UNAVAILABLE");
      const types = context?.extension_prompt_types ?? globalThis.extension_prompt_types ?? {};
      const roles = context?.extension_prompt_roles ?? globalThis.extension_prompt_roles ?? {};
      const resolvedPosition = position === "IN_CHAT" ? types.IN_CHAT : position;
      const resolvedRole = role === "SYSTEM" ? roles.SYSTEM : role;
      if (resolvedPosition === undefined || resolvedRole === undefined)
        throw sourceError("ST_EXTENSION_PROMPT_API_INVALID");
      return context?.setExtensionPrompt
        ? setter.call(context, key, content, resolvedPosition, depth, scan, resolvedRole)
        : setter(key, content, resolvedPosition, depth, scan, resolvedRole);
    },
    ...io,
  };
}

export function createRuntime({
  adapter = createSillyTavernAdapter(),
  analyzer = null,
  storyTimeDebug = false,
  storyTimeTrace = null,
  characterContextResolver = null,
  analysisContextCollector = null,
  analysisSourceLoader = null,
  analysisSourceLoaderOptions = {},
  externalMemoryProviderLoader = null,
  analysisSourceCache = null,
  projectionTimingConfigResolver = null,
  projectionTimingBaselineResolver = null,
} = {}) {
  const st = adapter;
  const chat = createChatBoundary(st);
  const store = createStore(st, chat);
  const diagnostics = createRuntimeDiagnostics({
    getChatId: () => chat.current(),
  });
  const subscriptions = new Set();
  const unbind = [];
  const versionChainByExecution = new Map();
  const activity = createRuntimeActivity();
  let initialized = false;
  let destroyed = false;

  function isBioWeaveEnabled() {
    return store.getChat(chat.current()).settings?.enabled !== false;
  }

  function assertBioWeaveEnabled() {
    if (isBioWeaveEnabled()) return true;
    const error = new Error("BIOWEAVE_DISABLED");
    error.code = "BIOWEAVE_DISABLED";
    error.status = "disabled";
    throw error;
  }

  function notify(event) {
    diagnostics.observe(event);
    activity.handleRuntimeEvent(event);
    for (const listener of [...subscriptions]) {
      try {
        listener(event);
      } catch (error) {
        console.error("[BioWeave] runtime subscriber failed", error);
      }
    }
  }

  function recordPersistenceTrace(payload = {}) {
    let versionChain = payload?.stage === "VERSION_CHAIN"
      ? buildVersionChainDiagnostic(payload)
      : null;
    if (!versionChain && payload?.stage === "FLOOR_TX_CREATED") {
      versionChain = buildVersionChainDiagnostic({
        boundary: "FLOOR_TX_CREATED",
        source_kind: "floor_transaction_expected",
        version: payload,
        message_index: payload.message_index,
        generation_id: payload.generation_id,
        generation_intent_id: payload.generation_intent_id,
        generation_type: payload.generation_type,
        generation_ended: payload.generation_ended,
        generation_settled: payload.generation_settled,
        scheduler_revision: payload.scheduler_revision,
        analysis_execution_id: payload.analysis_execution_id,
      });
    }
    if (!versionChain && payload?.stage === "FLOOR_TX_AUTHORITATIVE_SOURCE_READ" &&
        payload?.actual_floor_version && typeof payload.actual_floor_version === "object") {
      versionChain = buildVersionChainDiagnostic({
        boundary: "AUTHORITATIVE_SOURCE_READ_BEFORE_WRITE",
        source_kind: "official_chat_read",
        version: payload.actual_floor_version,
        message_index: payload.message_index,
        generation_id: payload.generation_id,
        generation_intent_id: payload.generation_intent_id,
        generation_type: payload.generation_type,
        generation_ended: payload.generation_ended,
        generation_settled: payload.generation_settled,
        scheduler_revision: payload.scheduler_revision,
        analysis_execution_id: payload.analysis_execution_id,
        source_text_length: payload.source_text_length,
      });
    }
    if (!versionChain && payload?.stage === "FLOOR_TX_LATEST_SLOT_RESOLVED" &&
        payload?.actual_floor_version && typeof payload.actual_floor_version === "object") {
      versionChain = buildVersionChainDiagnostic({
        boundary: "FLOOR_TX_LATEST_SLOT_RESOLVED",
        source_kind: "store",
        version: payload.actual_floor_version,
        message_index: payload.message_index,
        generation_id: payload.generation_id,
        generation_intent_id: payload.generation_intent_id,
        generation_type: payload.generation_type,
        generation_ended: payload.generation_ended,
        generation_settled: payload.generation_settled,
        scheduler_revision: payload.scheduler_revision,
        analysis_execution_id: payload.analysis_execution_id,
        source_text_length: payload.source_text_length,
      });
    }
    if (!versionChain &&
        (payload?.stage === "EVENT_OWNER_VERSION_CHECK" || payload?.stage === "WORLD_OWNER_VERSION_CHECK") &&
        payload?.version_check_source === "official_owner" &&
        payload?.actual && typeof payload.actual === "object") {
      versionChain = buildVersionChainDiagnostic({
        boundary: "AUTHORITATIVE_SOURCE_READ_BEFORE_WRITE",
        source_kind: "official_chat_read",
        version: payload.actual,
        message_index: payload.message_index,
        generation_id: payload.generation_id,
        generation_intent_id: payload.generation_intent_id,
        generation_type: payload.generation_type,
        generation_ended: payload.generation_ended,
        generation_settled: payload.generation_settled,
        scheduler_revision: payload.scheduler_revision,
        analysis_execution_id: payload.analysis_execution_id,
      });
    }
    versionChain ??= payload;
    const emitTrace = tracePayload => notify({
      type: "BIOWEAVE_PERSISTENCE_TRACE",
      payload: tracePayload,
      chatId: tracePayload?.chat_id ?? chat.current(),
    });
    if (payload?.stage !== "VERSION_CHAIN")
      emitTrace(payload);
    if (versionChain !== payload)
      emitTrace(versionChain);
    if (versionChain?.stage !== "VERSION_CHAIN" || !versionChain.analysis_execution_id) return;
    const previous = versionChainByExecution.get(versionChain.analysis_execution_id) ?? null;
    versionChainByExecution.set(versionChain.analysis_execution_id, versionChain);
    const transition = versionChainTransition(previous, versionChain);
    if (transition) {
      notify({
        type: "BIOWEAVE_PERSISTENCE_TRACE",
        payload: transition,
        chatId: versionChain.chat_id ?? chat.current(),
      });
    }
  }

  async function recordReloadFloorSlotAudit(reason = "runtime-init") {
    const chatId = chat.current();
    try {
      const target = await eventAnalysis.resolveCurrentBioWeaveFloor?.();
      const floorData = target
        ? store.getFloor?.(target.index, target.swipeId) ?? null
        : null;
      recordPersistenceTrace(diagnostics.buildReloadFloorSlotAudit({
        reason,
        chatId,
        target,
        floorData,
      }));
    } catch (error) {
      recordPersistenceTrace(diagnostics.buildReloadFloorSlotAudit({
        reason,
        chatId,
        error,
      }));
    }
  }

  function notifyLifecycleSettled(key, eventType, payload) {
    notify({
      type: "BIOWEAVE_LIFECYCLE_SETTLED",
      eventType,
      mutationType: key,
      payload,
      chatId: chat.current(),
      epoch: chat.getEpoch(),
    });
  }

  st.setPersistenceTraceSink?.((payload) => recordPersistenceTrace(payload));

  function resolveEventAnalysisProfile() {
    const settings = store.profileStore?.getSettings?.() ?? {};
    const assignment = settings.assignments?.event_analysis ?? null;
    if (assignment === SILLYTAVERN_CURRENT_API) return SILLYTAVERN_CURRENT_API;
    if (assignment === FOLLOW_DEFAULT_API) {
      if (settings.api_source === SILLYTAVERN_CURRENT_API)
        return SILLYTAVERN_CURRENT_API;
      return settings.default_profile_id
        ? (store.profileStore?.getProfile?.(settings.default_profile_id) ??
            null)
        : null;
    }
    return assignment
      ? (store.profileStore?.getProfile?.(assignment) ?? null)
      : null;
  }

  const eventAnalyzer =
    analyzer ??
    createAnalyzer({
      profileResolver: resolveEventAnalysisProfile,
      contextResolver: () => st.getContext?.() ?? null,
      requestSettingsResolver: () =>
        store.profileStore?.getApiRequestSettings?.() ?? {},
      analysisPromptResolver: () =>
        store.profileStore?.getAnalysisPrompt?.() ?? {},
    });
  const calendarResolver = createCalendarResolver();
  const resolvedStoryTime = createStoryTime({calendarResolver});
  const storyTimeCoordinator = createStoryTimeCoordinator({
    st,
    chat,
    store,
    storyTime: resolvedStoryTime,
    debug: storyTimeDebug,
    trace: storyTimeTrace,
  });
  let eventAnalysis = null;
  const floorPersistence = createFloorPersistenceCoordinator({
    store,
    enabledResolver: isBioWeaveEnabled,
    trace: recordPersistenceTrace,
    readLatestFloor: async ({messageIndex, swipeId, floorVersion, chatId}) => {
      const authoritative = await store.readAuthoritativeFloor?.(
        messageIndex,
        swipeId,
        floorVersion ?? {chat_id: chatId},
      );
      return authoritative ?? store.getFloor(messageIndex, swipeId);
    },
    acquireAuthoritativeFloorOwner: typeof st.acquireAuthoritativeFloorOwner === "function"
      ? async ({selector, swipeId, expectedVersion, execution}) =>
        st.acquireAuthoritativeFloorOwner({
          messageIndex: selector,
          swipeId,
          expectedVersion,
          generationSettled: execution?.generation_settled === true,
        })
      : null,
    resolveCurrentFloorVersion: async ({ownerFloor}) => {
      const index = ownerFloor?.message_index ?? ownerFloor?.messageIndex ?? ownerFloor?.index;
      if (!Number.isInteger(Number(index)) || !eventAnalysis?.resolveCurrentBioWeaveFloor)
        return null;
      return (await eventAnalysis.resolveCurrentBioWeaveFloor({
        __messageIndex: true,
        index: Number(index),
      })).version;
    },
  });
  const healthAssessment = createHealthAssessmentCoordinator({
    analyzer: eventAnalyzer,
    getFloor: (index, swipeId) => store.getFloor?.(index, swipeId),
    commitFloorPatch: (target, owner, patch, input = {}) => floorPersistence.commitFloorPatch({
      owner,
      chatId: target?.version?.chat_id ?? chat.current(),
      ownerFloor: {message_index: target?.index, message_id: target?.version?.message_id},
      swipeId: target?.swipeId ?? target?.version?.swipe_id ?? 0,
      floorVersion: target?.version,
      patch,
      operation_type: input.operation_type ?? `${owner}-patch`,
      execution: input.execution,
      assertCurrent: input.assertCurrent,
    }),
    assertExecutionTargetCurrent: (...args) => eventAnalysis?.assertExecutionTargetCurrent?.(...args),
    trace: payload => recordPersistenceTrace(payload),
  });
  const healthEvolution = createHealthEvolutionRuntime();
  eventAnalysis = createEventAnalysisCoordinator({
    st,
    chat,
    store,
    analyzer: eventAnalyzer,
    storyTime: resolvedStoryTime,
    storyTimeCoordinator,
    ...(typeof characterContextResolver === "function"
      ? { characterContextResolver }
      : {}),
    ...(typeof analysisContextCollector === "function"
      ? { analysisContextCollector }
      : {}),
    ...(typeof analysisSourceLoader === "function"
      ? { analysisSourceLoader }
      : {}),
    analysisSourceLoaderOptions,
    ...(typeof externalMemoryProviderLoader === "function"
      ? { externalMemoryProviderLoader }
      : {}),
    ...(analysisSourceCache ? { analysisSourceCache } : {}),
    globalRecentStoryResolver: () =>
      store.profileStore?.getSettings?.()?.recent_story_global ?? {},
    enabledResolver: isBioWeaveEnabled,
    notify,
    floorPersistence,
    healthAssessment,
    healthEvolution,
    trackingWindowPersistence: createTrackingWindowPersistence({
      store,
      enabledResolver: isBioWeaveEnabled,
      floorPersistence,
      resolveCurrentFloorVersion: async ({ownerFloor}) => {
        const index = ownerFloor?.message_index ?? ownerFloor?.messageIndex ?? ownerFloor?.index;
        if (!Number.isInteger(Number(index)) || !eventAnalysis?.resolveCurrentBioWeaveFloor) return null;
        return (await eventAnalysis.resolveCurrentBioWeaveFloor({__messageIndex: true, index: Number(index)})).version;
      },
    }),
  });
  const projectionPersistence = createProjectionPersistence({
    store,
    enabledResolver: isBioWeaveEnabled,
    floorPersistence,
    emit: recordPersistenceTrace,
    resolveCurrentFloorVersion: async ({ownerFloor}) => {
      const index = ownerFloor?.message_index ?? ownerFloor?.messageIndex ?? ownerFloor?.index;
      if (!Number.isInteger(Number(index))) return null;
      return (await eventAnalysis.resolveCurrentBioWeaveFloor({
        __messageIndex: true,
        index: Number(index),
      })).version;
    },
  });
  const projectionTimingPersistence = createProjectionTimingPersistence({
    store,
    enabledResolver: isBioWeaveEnabled,
    floorPersistence,
    resolveCurrentFloorVersion: async ({ownerFloor}) => {
      const index = ownerFloor?.message_index ?? ownerFloor?.messageIndex ?? ownerFloor?.index;
      if (!Number.isInteger(Number(index))) return null;
      return (await eventAnalysis.resolveCurrentBioWeaveFloor({__messageIndex: true, index: Number(index)})).version;
    },
  });
  const characterTimingConfigStore = createCharacterTimingConfigStore({
    store,
    getChatId: () => chat.current(),
  });
  const humanTimingBaselineResolver = projectionTimingBaselineResolver ?? (async ({subjectId, inputs}) => {
    const character = inputs?.currentState?.characters?.[subjectId];
    const profile = inputs?.characterProfiles?.[subjectId] ?? inputs?.character_profiles?.[subjectId];
    const characterSpecies = profile?.biological_context?.species
      ?? profile?.species
      ?? character?.biological_context?.species
      ?? character?.species;
    const worldSpecies = Array.isArray(inputs?.worldModel?.species) ? inputs.worldModel.species : [];
    const humanWorld = worldSpecies.some(species => isCanonicalWorldHumanSpecies(species?.name));
    return humanWorld && isCanonicalWorldHumanSpecies(characterSpecies)
      ? getHumanPreconfirmationTimingPreset()
      : null;
  });
  const projectionContext = createProjectionContextCoordinator({
    getProjectionViews: projectionPersistence.getProjectionViews,
    resolveCurrentFloor: () => eventAnalysis.resolveCurrentBioWeaveFloor(),
    getChatId: () => chat.current(),
    setExtensionPrompt: st.setExtensionPrompt,
    enabledResolver: isBioWeaveEnabled,
    attributionResolver: createCurrentStateAttributionResolver({
      collectActiveBusinessData: () => eventAnalysis.collectActiveBusinessData(),
    }),
    healthGuidanceResolver: async ({chatId, floor}) => {
      const business = await eventAnalysis.collectActiveBusinessData();
      if (
        business?.current_state_status === "STATE_ERROR" ||
        !business?.current_floor?.version ||
        !sameFloorVersion(business.current_floor.version, floor?.version)
      ) return [];
      return healthEvolution.buildRecoveryGuidance({
        currentHealthState: business.current_health_state,
        currentStoryTime: business.current_story_time,
        trace: payload => recordPersistenceTrace({
          ...payload,
          chat_id: chatId,
          floor: floor?.version?.floor ?? null,
          message_id: floor?.version?.message_id ?? null,
          swipe_id: floor?.version?.swipe_id ?? floor?.swipeId ?? null,
        }),
      });
    },
    trace: recordPersistenceTrace,
  });
  const projectionRuntime = createProjectionRuntime({
    analyzer: eventAnalyzer,
    enabledResolver: isBioWeaveEnabled,
    getChatId: () => chat.current(),
    collectInputs: async () => {
      const floor = await eventAnalysis.resolveCurrentBioWeaveFloor();
      const business = await eventAnalysis.collectActiveBusinessData();
      const world = await eventAnalysis.resolveWorldModelAtOrBefore({
        __messageIndex: true,
        index: floor.index,
      });
      return {
        floor,
        currentState: business.current_state,
        characterProfiles: business.character_profiles,
        currentStateStatus: business.current_state_status,
        events: business.active_events ?? [],
        sourceCandidates: Object.values(business.tracking_candidates ?? {}),
        trackingWindows: business.tracking_windows ?? [],
        worldModel: world?.model ?? {},
        currentStoryTime: business.current_story_time ?? null,
        storyContext: [],
        deleteProjection: projectionPersistence.deleteProjection,
      };
    },
    resolveCurrentFloor: eventAnalysis.resolveCurrentBioWeaveFloor,
    getProjectionViews: projectionPersistence.getProjectionViews,
    saveGeneratedProjection: projectionPersistence.saveGeneratedProjection,
    saveProjectionEvidence: projectionPersistence.saveProjectionEvidence,
    saveEvolutionDecision: projectionPersistence.saveEvolutionDecision,
    resolvePreConfirmationTiming: async ({inputs}) => {
      const timeline = await projectionTimingPersistence.getTimingInstances({chatId: inputs.floor.version.chat_id, endpointFloor: inputs.floor.version.floor});
      const rules = Array.isArray(inputs.worldModel?.projection_rules) ? inputs.worldModel.projection_rules : [];
      const events = Array.isArray(inputs.events) ? inputs.events : [];
      const timingInstances = [...timeline.creations];
      let timingEnabled = timingInstances.length > 0;
      const confirmedSubjects = events.filter(event => event?.type === 'pregnancy_confirmation' && event.status === 'confirmed').flatMap(event => event?.state_fact?.subject_id ? [event.state_fact.subject_id] : (event?.pregnancy_relevance?.gestational_subject_ids ?? []));
      const terminatedSubjects = events.filter(event => ['pregnancy_loss', 'abortion'].includes(event?.type) && event.status === 'confirmed').flatMap(event => event?.state_fact?.subject_id ? [event.state_fact.subject_id] : (event?.pregnancy_relevance?.gestational_subject_ids ?? []));
      const ownerFloor = floorOwnerForProjection(inputs.floor);
      for (const rule of rules) {
        for (const event of events) {
          const subjectIds = event?.pregnancy_relevance?.gestational_subject_ids ?? [];
          if (!event?.pregnancy_relevance?.relevant || event?.pregnancy_relevance?.reproductive_mechanism?.kind !== rule.mechanism_key) continue;
          for (const subjectId of subjectIds) {
            const existing = timingInstances.find(item => item.subject_id === subjectId && item.mechanism_key === rule.mechanism_key && !confirmedSubjects.includes(subjectId) && !terminatedSubjects.includes(subjectId) && item.source_event_ids.some(sourceId => events.some(candidate => candidate.event_id === sourceId && candidate.pregnancy_relevance?.relevant === true && candidate.pregnancy_relevance?.gestational_subject_ids?.includes(subjectId) && candidate.pregnancy_relevance?.reproductive_mechanism?.kind === rule.mechanism_key)));
            const changedHistoricalBasis = timingInstances.some(item => item.subject_id === subjectId && item.mechanism_key === rule.mechanism_key && item.source_event_ids.includes(event.event_id) && JSON.stringify(item.source_basis_refs?.[event.event_id]?.event_version ?? null) !== JSON.stringify(event.version ?? event.event_version ?? null));
            if (changedHistoricalBasis) continue;
            if (existing) {
              if (!existing.source_event_ids.includes(event.event_id)) {
                await projectionTimingPersistence.appendTimingBasis({
                  chatId: inputs.floor.version.chat_id,
                  ownerFloor,
                  floorVersion: inputs.floor.version,
                  timingInstanceId: existing.timing_instance_id,
                  sourceEventIds: [event.event_id],
                  sourceBasisRefs: {[event.event_id]: {event_id: event.event_id, story_time: event.story_time ?? null}},
                });
                existing.source_event_ids = [...new Set([...existing.source_event_ids, event.event_id])].sort();
              }
              continue;
            }
            const override = typeof projectionTimingConfigResolver === 'function'
              ? await projectionTimingConfigResolver({subjectId, inputs, rule, event})
              : readCharacterTimingConfig(store.getChat(inputs.floor.version.chat_id), subjectId).config;
            const baseline = typeof humanTimingBaselineResolver === 'function'
              ? await humanTimingBaselineResolver({subjectId, inputs, rule, event})
              : null;
            const resolvedConfig = resolveCharacterTimingConfig({override, baseline});
            if (!resolvedConfig.config) continue;
            timingEnabled = true;
            const instance = resolveProjectionTimingInstance({
              chatId: inputs.floor.version.chat_id,
              subjectId,
              mechanismKey: rule.mechanism_key,
              firstEvent: event,
              config: resolvedConfig.config,
              floorVersion: inputs.floor.version,
              worldRuleBinding: {projection_rule_id: rule.projection_rule_id, mechanism_key: rule.mechanism_key},
            });
            await projectionTimingPersistence.saveTimingInstance({chatId: inputs.floor.version.chat_id, ownerFloor, floorVersion: inputs.floor.version, timingInstance: instance});
            timingInstances.push(instance);
          }
        }
      }
      return {enabled: timingEnabled, instances: timingInstances, windows: inputs.trackingWindows ?? [], confirmedSubjects, terminatedSubjects};
    },
    refreshProjectionContext: projectionContext.refreshProjectionContext,
    notify,
    activity,
  });
  eventAnalysis.setProjectionPostProcessor?.(({target}) => projectionRuntime.process({
    reason: "factual-success",
    target,
  }));

  async function updateEventWithProjection(...args) {
    const result = await eventAnalysis.updateEvent(...args);
    void projectionRuntime.process({reason: "event-edit"}).catch(() => null);
    return result;
  }

  async function deleteEventWithProjection(...args) {
    const result = await eventAnalysis.deleteEvent(...args);
    void projectionRuntime.process({reason: "event-delete"}).catch(() => null);
    return result;
  }

  async function setBioWeaveEnabled(enabled) {
    const chatId = chat.current();
    const current = store.getChat(chatId);
    const next = enabled !== false;
    if (current.settings?.enabled === next) {
      if (!next) {
        eventAnalysis.pause?.();
        projectionContext.clearProjectionContext();
      }
      return next;
    }
    if (!next) {
      eventAnalysis.pause?.();
      projectionContext.clearProjectionContext();
    }
    await store.saveChat(chatId, {
      ...current,
      settings: {...(current.settings ?? {}), enabled: next},
    });
    if (next) {
      // Rebase the lifecycle hint at re-enable time so disabled-period Floors
      // are not interpreted as an automatic backlog.
      await eventAnalysis.primeLifecycleSnapshot?.();
      await projectionContext.refreshProjectionContext({chatId});
    }
    notify({
      type: "BIOWEAVE_ENABLED_CHANGED",
      payload: {enabled: next},
      chatId,
      epoch: chat.getEpoch(),
    });
    return next;
  }

  const clearService = createClearService({
    adapter: st,
    store,
    boundary: chat,
    invalidate: (payload) => eventAnalysis.invalidateForClear?.(payload),
  });
  let lifecycleSequence = 0;
  let lifecycleTail = Promise.resolve();
  let activeOwner = null;
  let knownChatIds = null;
  let knownChatIdsEvidence = false;
  let pendingStartNewChat = null;
  const failedSourceClears = new Map();

  function cloneValue(value) {
    if (value === undefined || value === null) return value;
    if (typeof structuredClone === "function") return structuredClone(value);
    if (Array.isArray(value)) return value.map(cloneValue);
    if (typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, cloneValue(item)]),
      );
    return value;
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }

  function scalarId(value) {
    if (typeof value === "string") return value.trim() || null;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    return null;
  }

  function eventChatId(payload) {
    if (payload === undefined || payload === null) return null;
    if (typeof payload === "string" || typeof payload === "number")
      return scalarId(payload);
    if (typeof payload !== "object") return null;
    return scalarId(
      payload.chatId ??
        payload.chat_id ??
        payload.chat_id_name ??
        payload.id ??
        null,
    );
  }

  function ownerIdentity() {
    let raw = {};
    try {
      raw = st.getChatOwnerIdentity?.() ?? {};
    } catch {
      raw = {};
    }
    return {
      characterId:
        raw.characterId ?? raw.character_id ?? raw.character ?? null,
      groupId: raw.groupId ?? raw.group_id ?? raw.group ?? null,
    };
  }

  function ownerIdentityMatches(source, target) {
    const sourceValue = source ?? {};
    const targetValue = target ?? {};
    const keys = ["characterId", "groupId"];
    const known = keys.filter(
      (key) => sourceValue[key] !== null && sourceValue[key] !== undefined,
    );
    if (!known.length) return false;
    return known.every(
      (key) =>
        targetValue[key] !== null &&
        targetValue[key] !== undefined &&
        String(targetValue[key]) === String(sourceValue[key]),
    );
  }

  function normalizeChatIds(raw) {
    if (raw && typeof raw.then === "function") return null;
    const value = raw?.chatIds ?? raw?.chat_ids ?? raw?.ids ?? raw;
    const entries =
      value instanceof Set
        ? [...value]
        : Array.isArray(value)
          ? value
          : null;
    if (!entries) return null;
    const ids = new Set();
    for (const entry of entries) {
      const id =
        typeof entry === "object"
          ? scalarId(entry?.chatId ?? entry?.chat_id ?? entry?.id)
          : scalarId(entry);
      if (id !== null) ids.add(chatIdKey(id));
    }
    return ids;
  }

  function readChatIds() {
    try {
      return normalizeChatIds(st.getChatIndex?.());
    } catch {
      return null;
    }
  }

  function sourceOwnerCapabilityAvailable() {
    if (typeof st.hasSourceOwnerCapability === "function") {
      try {
        return st.hasSourceOwnerCapability() === true;
      } catch {
        return false;
      }
    }
    const cas =
      st.sourceOwnerRevisionCAS === true ||
      st.supportsSourceOwnerRevisionCAS === true ||
      st.sourceOwnerLatestMerge === true ||
      st.supportsSourceOwnerLatestMerge === true ||
      st.capabilities?.sourceOwnerRevisionCAS === true ||
      st.capabilities?.sourceOwnerLatestMerge === true ||
      [
        "compareAndSaveChatOwner",
        "compareAndSwapChatOwner",
        "saveChatOwnerCAS",
        "commitChatOwnerCAS",
      ].some((name) => typeof st[name] === "function");
    return (
      typeof st.readChatOwner === "function" &&
      typeof st.saveChatOwner === "function" &&
      cas
    );
  }

  function captureCurrentOwner(chatId = chat.current()) {
    try {
      const token = chat.token();
      const snapshot = store.getCurrentChatOwnerSnapshot?.(chatId);
      if (!snapshot) return null;
      return {
        chatId,
        chat_id: chatId,
        ...ownerIdentity(),
        revision:
          snapshot.revision ?? st.getChatRevision?.(chatId) ?? undefined,
        sourceRevision:
          snapshot.revision ?? st.getChatRevision?.(chatId) ?? undefined,
        epoch: token.epoch,
        snapshot,
      };
    } catch {
      return null;
    }
  }

  async function captureActiveOwner(chatId = chat.current()) {
    const owner = captureCurrentOwner(chatId);
    if (!owner) return null;
    owner.source_hash = await hashText(
      JSON.stringify(
        stableValue({
          chatId: owner.chatId,
          revision: owner.revision,
          header: owner.snapshot?.header,
          chatMetadata: owner.snapshot?.chatMetadata,
          messages: owner.snapshot?.messages,
        }),
      ),
    );
    if (owner.revision === undefined || owner.revision === null) {
      // The current ST release does not expose a server revision. A stable
      // digest of the captured owner is the revision token used by the
      // latest-read/source-merge adapter; it is never a permission to write
      // the captured snapshot back wholesale.
      owner.revision = owner.source_hash;
      owner.sourceRevision = owner.source_hash;
    }
    chat.assert({ chatId, epoch: owner.epoch });
    return owner;
  }

  async function refreshActiveOwner(chatId = chat.current()) {
    try {
      const owner = await captureActiveOwner(chatId);
      if (owner && chat.current() === chatId) activeOwner = owner;
      const ids = readChatIds();
      if (ids) {
        ids.add(chatIdKey(chatId));
        knownChatIds = ids;
        knownChatIdsEvidence = true;
      } else {
        // A Chat index that cannot be read is not evidence for a new-chat
        // transition. Do not carry another character's stale index forward.
        knownChatIds = null;
        knownChatIdsEvidence = false;
      }
      return owner;
    } catch (error) {
      if (error?.message !== "STALE_CHAT")
        console.error("[BioWeave] active Chat owner capture failed", error);
      return null;
    }
  }

  function clearNotification(result, operation) {
    const confirmed =
      result?.ok === true && result?.persistence?.commitState === "confirmed";
    notify({
      type: confirmed
        ? "BIOWEAVE_DATA_CLEARED"
        : "BIOWEAVE_DATA_CLEAR_FAILED",
      payload: { ...result, operation: result?.operation ?? operation },
      chatId: result?.chatId ?? chat.current(),
    });
  }

  async function runClear(operation, target, options = {}) {
    const method = clearService?.[operation];
    if (typeof method !== "function") {
      const result = {
        ok: false,
        changed: false,
        operation,
        error_code: "CLEAR_SERVICE_UNAVAILABLE",
        persistence: { commitState: "failed", attempted: false },
      };
      clearNotification(result, operation);
      return result;
    }
    const result = await method.call(clearService, target, options);
    try {
      await eventAnalysis.completeClear?.(result);
    } catch (error) {
      if (result.ok) console.error("[BioWeave] clear state refresh failed", error);
    }
    clearNotification(result, operation);
    return result;
  }

  function prepareStartNewChatTransition(
    sequence,
    epochBefore,
    previousOwner,
    targetChatId,
    payload,
  ) {
    const idsBefore = knownChatIds ? new Set(knownChatIds) : null;
    const targetOwner = captureCurrentOwner(targetChatId);
    const payloadChatId = eventChatId(payload);
    const eligible = Boolean(
      sourceOwnerCapabilityAvailable() &&
        previousOwner &&
        previousOwner.chatId !== targetChatId &&
        previousOwner.epoch === epochBefore &&
        previousOwner.snapshot &&
        previousOwner.source_hash &&
        previousOwner.revision !== undefined &&
        previousOwner.revision !== null &&
        idsBefore &&
        knownChatIdsEvidence &&
        !idsBefore.has(chatIdKey(targetChatId)) &&
        targetOwner &&
        ownerIdentityMatches(previousOwner, targetOwner) &&
        (payloadChatId === null ||
          String(payloadChatId) === String(targetChatId)),
    );
    pendingStartNewChat = eligible
      ? {
          token: `start-new-chat:${sequence}`,
          sequence,
          sourceChatId: previousOwner.chatId,
          sourceOwner: cloneValue(previousOwner),
          targetChatId,
          targetOwner: cloneValue(targetOwner),
          epoch: chat.getEpoch(),
          idsBefore: [...idsBefore],
          consumed: false,
        }
      : null;
    activeOwner = targetOwner ?? {
      chatId: targetChatId,
      chat_id: targetChatId,
      ...ownerIdentity(),
      epoch: chat.getEpoch(),
    };
    if (knownChatIds) knownChatIds.add(chatIdKey(targetChatId));
  }

  function consumeStartNewChatTransition(sequence, payload) {
    const candidate = pendingStartNewChat;
    const targetChatId = chat.current();
    const payloadChatId = eventChatId(payload);
    let freshness;
    try {
      freshness = st.isFreshChat?.(targetChatId);
    } catch {
      freshness = false;
    }
    const freshnessIsSynchronous =
      !(freshness && typeof freshness.then === "function");
    const valid = Boolean(
      candidate &&
        !candidate.consumed &&
        candidate.sequence === sequence - 1 &&
        candidate.epoch === chat.getEpoch() &&
        String(candidate.targetChatId) === String(targetChatId) &&
        (payloadChatId === null ||
          String(payloadChatId) === String(targetChatId)) &&
        ownerIdentityMatches(candidate.sourceOwner, ownerIdentity()) &&
        freshnessIsSynchronous && freshness !== false,
    );
    if (!valid) {
      if (candidate && candidate.sequence < sequence - 1)
        pendingStartNewChat = null;
      return null;
    }
    candidate.consumed = true;
    return candidate;
  }

  async function clearSourceAfterTransition(candidate) {
    const controller = new AbortController();
    const sourceOwner = {
      ...cloneValue(candidate.sourceOwner),
      sourceTargeted: true,
      source_targeted: true,
      transitionToken: candidate.token,
    };
    await eventAnalysis.invalidateForClear?.({
      reason: "start-new-chat-source",
      owner: sourceOwner,
      transitionToken: candidate.token,
    });
    let result;
    try {
      result = await clearService.clearSourceChatBioWeave(sourceOwner, {
        signal: controller.signal,
        source: true,
      });
    } catch (error) {
      result = {
        ok: false,
        changed: false,
        operation: "all",
        chatId: candidate.sourceChatId,
        sourceTargeted: true,
        error_code: error?.code ?? error?.message ?? "SOURCE_CLEAR_FAILED",
        persistence: { commitState: "failed", attempted: false },
      };
    }
    try {
      await eventAnalysis.completeClear?.(result);
    } catch (error) {
      if (result.ok) console.error("[BioWeave] source clear refresh failed", error);
    }
    if (
      result?.ok !== true ||
      result?.persistence?.commitState !== "confirmed"
    ) {
      failedSourceClears.set(candidate.sourceChatId, {
        owner: sourceOwner,
        result,
        transitionToken: candidate.token,
      });
    } else {
      failedSourceClears.delete(candidate.sourceChatId);
    }
    clearNotification(result, "clearSourceChatBioWeave");
    return result;
  }

  function hostEventDiagnosticPayload(key, eventType, payload, chatId, runtimeHandlerPresent) {
    const objectPayload = payload && typeof payload === "object" ? payload : null;
    const messageIndex = Number.isInteger(payload)
      ? payload
      : objectPayload?.message_index ?? objectPayload?.messageIndex ?? objectPayload?.index ?? null;
    return {
      host_event_key: key,
      host_event_type: eventType,
      received_at: new Date().toISOString(),
      host_chat_id: chatId,
      message_index: Number.isInteger(messageIndex) ? messageIndex : null,
      host_message_id: objectPayload?.message_id ?? objectPayload?.messageId ?? null,
      host_swipe_id: objectPayload?.swipe_id ?? objectPayload?.swipeId ?? null,
      host_generation_type: typeof payload === "string"
        ? payload
        : objectPayload?.generation_type ?? objectPayload?.generationType ?? objectPayload?.genType ?? null,
      forward_to_runtime: true,
      runtime_handler_present: runtimeHandlerPresent,
    };
  }

  function handleLifecycleEvent(key, eventType, payload) {
    if (key === "CHAT_CHANGED") versionChainByExecution.clear();
    const sequence = ++lifecycleSequence;
    const epochBefore = chat.getEpoch();
    const previousOwner = activeOwner;
    const chatId = chat.current();
    const runtimeHandlerPresent = typeof eventAnalysis?.handleLifecycleEvent === "function";
    const hostEventDiagnostic = hostEventDiagnosticPayload(
      key,
      eventType,
      payload,
      chatId,
      runtimeHandlerPresent,
    );
    recordPersistenceTrace({stage: "HOST_EVENT_RECEIVED", ...hostEventDiagnostic});
    const lifecycleTraceStage = {
      GENERATION_STARTED: "GENERATION_STARTED",
      GENERATION_ENDED: "GENERATION_ENDED",
      GENERATION_STOPPED: "GENERATION_STOPPED",
      GENERATION_CANCELLED: "GENERATION_CANCELLED",
      MESSAGE_RECEIVED: "MESSAGE_RECEIVED",
      CHARACTER_MESSAGE_RENDERED: "CHARACTER_MESSAGE_RENDERED",
    }[key];
    if (lifecycleTraceStage) diagnostics.recordLifecycleTrace(lifecycleTraceStage, payload, chatId);
    const chatChanged = chat.getEpoch() !== epochBefore;
    let sourceTransition = null;
    if (key === "CHAT_CHANGED" && chatChanged) {
      prepareStartNewChatTransition(
        sequence,
        epochBefore,
        previousOwner,
        chatId,
        payload,
      );
    } else if (key === "CHAT_CREATED") {
      sourceTransition = consumeStartNewChatTransition(sequence, payload);
    } else if (chatChanged) {
      pendingStartNewChat = null;
      activeOwner = captureCurrentOwner(chatId) ?? activeOwner;
    }
    notify({
      type: key,
      eventType,
      payload,
      chatId,
      epoch: chat.getEpoch(),
      chatChanged,
    });
    const generationIdentity = {
      generation_id: payload?.generation_id ?? payload?.generationId ?? null,
      generation_intent_id: payload?.generation_intent_id ?? payload?.generationIntentId ?? null,
      generation_type: payload?.generation_type ?? payload?.generationType ?? payload?.genType ?? null,
    };
    const isStoryTimeProjectionTrigger = key === "MESSAGE_RECEIVED";
    const refreshGenerationProjectionContext = async () => {
      if (key === "GENERATION_STARTED") {
        recordPersistenceTrace({
          stage: "GENERATION_PROJECTION_REFRESH_STARTED",
          ...generationIdentity,
          listener_resolve_policy: "awaited",
        });
      }
      try {
        const result = await projectionContext.refreshProjectionContext({
          chatId: chat.current(),
          generation: key === "GENERATION_STARTED" ? payload : null,
        });
        if (key === "GENERATION_STARTED") {
          const refreshSucceeded = result?.ok !== false && !["unavailable", "failed"].includes(result?.status);
          recordPersistenceTrace({
            stage: "GENERATION_PROJECTION_REFRESH_SETTLED",
            ...generationIdentity,
            refresh_outcome: result?.status ?? null,
            slot_nonempty: result?.slot_nonempty ?? Boolean(result?.prompt),
            context_nonempty: result?.context_nonempty ?? Boolean(result?.prompt),
            context_fingerprint: result?.context_fingerprint ?? null,
            health_guidance_count: result?.health_guidance_count ?? 0,
            selected_stage_summary: result?.selected_stage_summary ?? null,
            settled_before_listener_resolve: true,
            context_ready_before_prompt_read: refreshSucceeded,
          });
        }
        return result;
      } catch (error) {
        if (key === "GENERATION_STARTED") {
          recordPersistenceTrace({
            stage: "GENERATION_PROJECTION_REFRESH_SETTLED",
            ...generationIdentity,
            refresh_outcome: "failed_open",
            context_nonempty: null,
            slot_nonempty: null,
            context_fingerprint: null,
            health_guidance_count: null,
            settled_before_listener_resolve: true,
            context_ready_before_prompt_read: false,
            reason: error?.code ?? error?.message ?? "PROJECTION_REFRESH_FAILED",
          });
        }
        throw error;
      }
    };
    const work = lifecycleTail.then(
      async () => {
        storyTimeCoordinator.handleLifecycleEvent({
          type: key,
          eventType,
          payload,
          chatId,
        });
        if (sourceTransition) await clearSourceAfterTransition(sourceTransition);
        if (!runtimeHandlerPresent) {
          recordPersistenceTrace({
            stage: "HOST_EVENT_FORWARD_RESULT",
            ...hostEventDiagnostic,
            forwarded: false,
            forward_result: "runtime-handler-missing",
          });
        } else {
          try {
            const runtimeResult = await eventAnalysis.handleLifecycleEvent({
              type: key,
              eventType,
              payload,
              chatId,
            });
            recordPersistenceTrace({
              stage: "HOST_EVENT_FORWARD_RESULT",
              ...hostEventDiagnostic,
              forwarded: true,
              forward_result: runtimeResult ?? null,
            });
          } catch (error) {
            recordPersistenceTrace({
              stage: "HOST_EVENT_FORWARD_RESULT",
              ...hostEventDiagnostic,
              forwarded: true,
              forward_result: "runtime-handler-error",
              forward_error: error?.message ?? String(error),
              forward_error_name: error?.name ?? "Error",
            });
            if (!["STALE_CHAT", "MESSAGE_NOT_FOUND"].includes(error?.message))
              console.error("[BioWeave] event analysis lifecycle failed", error);
          }
        }
        try {
          await projectionRuntime.tickLifecycleOnly({reason: `story-time:${key}`});
        } catch (error) {
          if (!["STALE_CHAT", "MESSAGE_NOT_FOUND"].includes(error?.message))
            console.error("[BioWeave] projection lifecycle tick failed", error);
        }
        if (isStoryTimeProjectionTrigger) {
          try {
            await projectionRuntime.process({
              reason: `story-time:${key}`,
              trigger: "story-time-progression",
            });
          } catch (error) {
            if (!["STALE_CHAT", "MESSAGE_NOT_FOUND"].includes(error?.message))
              console.error("[BioWeave] story-time projection processing failed", error);
          }
        }
        if (key === "CHAT_CHANGED") await recordReloadFloorSlotAudit("chat-changed");
        await refreshActiveOwner(chat.current());
        await refreshGenerationProjectionContext();
        notifyLifecycleSettled(key, eventType, payload);
      },
      async () => {
        if (sourceTransition) await clearSourceAfterTransition(sourceTransition);
        await refreshActiveOwner(chat.current());
        await refreshGenerationProjectionContext();
        notifyLifecycleSettled(key, eventType, payload);
      },
    );
    const settledWork = work.catch((error) => {
      if (
        key === "GENERATION_STARTED" &&
        !["STALE_CHAT", "MESSAGE_NOT_FOUND"].includes(error?.message)
      ) {
        console.error("[BioWeave] generation-boundary projection refresh failed", error);
      }
      return null;
    });
    lifecycleTail = settledWork;
    // SillyTavern awaits eventSource listeners. Return this lifecycle promise
    // only for the pre-generation boundary; other lifecycle events retain the
    // existing background orchestration semantics.
    if (key === "GENERATION_STARTED") return settledWork;
  }

  function bindLifecycleEvents() {
    const context = st.getContext?.();
    const source = context?.eventSource;
    const types = context?.eventTypes;
    const handlers = {};
    for (const key of LIFECYCLE_EVENTS) {
      const eventType = types?.[key];
      if (eventType == null || handlers[key]) continue;
      handlers[key] = (payload) =>
        handleLifecycleEvent(key, eventType, payload);
    }
    if (typeof st.subscribeLifecycle === "function") {
      const unsubscribe = st.subscribeLifecycle({
        eventTypes: types,
        handlers,
      });
      if (typeof unsubscribe === "function") unbind.push(unsubscribe);
      return;
    }
    // Compatibility path for injected legacy adapters that expose only the
    // raw SillyTavern eventSource. The production adapter uses the seam above.
    if (
      !source ||
      typeof source.on !== "function" ||
      typeof source.removeListener !== "function"
    ) {
      return;
    }
    const boundEventTypes = new Set();
    for (const key of Object.keys(handlers)) {
      const eventType = types?.[key];
      if (eventType == null || boundEventTypes.has(eventType)) continue;
      const listener = handlers[key];
      source.on(eventType, listener);
      boundEventTypes.add(eventType);
      unbind.push(() => source.removeListener(eventType, listener));
    }
  }

  async function init() {
    if (destroyed) return false;
    if (initialized) return true;
    const context = st.getContext?.();
    if (typeof st.getContext === "function" && !context) {
      console.error("[BioWeave] SillyTavern context unavailable");
      return false;
    }
    const currentChatId = chat.current();
    try {
      await st.refreshChatIndex?.(currentChatId);
    } catch (error) {
      // A missing chat index is intentionally fail-closed: without a
      // pre-boundary list, a later Chat change cannot prove Start New Chat.
      if (error?.code !== "SOURCE_OWNER_GROUP_UNSUPPORTED")
        console.warn("[BioWeave] Chat index unavailable; Start New Chat cleanup is disabled", error);
    }
    await refreshActiveOwner(currentChatId);
    storyTimeCoordinator.handleLifecycleEvent({type: "RUNTIME_INIT"});
    await eventAnalysis.primeLifecycleSnapshot?.();
    await eventAnalysis.reconcileSchedulerState?.({reason: "runtime-init"});
    await recordReloadFloorSlotAudit("runtime-init");
    try {
      await projectionContext.refreshProjectionContext({chatId: currentChatId});
    } catch (error) {
      console.error("[BioWeave] initial projection context refresh failed", error);
    }
    bindLifecycleEvents();
    initialized = true;
    void eventAnalysis.refreshTrackingRegistry("init").catch((error) => {
      if (error?.message !== "STALE_CHAT") {
        console.error(
          "[BioWeave] initial tracking registry refresh failed",
          error,
        );
      }
    });
    return true;
  }

  function subscribe(listener) {
    if (typeof listener !== "function")
      throw new TypeError("RUNTIME_LISTENER_REQUIRED");
    subscriptions.add(listener);
    return () => subscriptions.delete(listener);
  }

  // These reads deliberately stay synchronous and side-effect free.  The UI
  // can ask for the current message/swipe facts after a lifecycle notification
  // without turning mount/open/reopen into an analysis request.
  function getActiveSwipeId(messageId) {
    return store.getActiveSwipeId?.(messageId) ?? null;
  }

  function getActiveFloor(messageId) {
    return store.getActiveFloor?.(messageId) ?? null;
  }

  function getActiveFloorEvents(messageId, version) {
    return store.getActiveFloorEvents?.(messageId, version) ?? [];
  }

  function clearCharacterData(target, options = {}) {
    return runClear("clearCharacterData", target, options);
  }

  function clearWorldData(target, options = {}) {
    return runClear("clearWorldData", target, options);
  }

  function clearAllBioWeaveData(target, options = {}) {
    return runClear("clearAllBioWeaveData", target, options);
  }

  function clearSourceChatBioWeave(target, options = {}) {
    return runClear("clearSourceChatBioWeave", target, {
      ...options,
      source: true,
    });
  }

  function clearBioWeaveData(domain = "all", target, options = {}) {
    if (domain && typeof domain === "object") {
      options = domain;
      domain = options.domain ?? options.operation ?? "all";
      target = options.target ?? options.owner;
    }
    const normalized = String(domain).toLowerCase();
    if (normalized === "character") return clearCharacterData(target, options);
    if (normalized === "world") return clearWorldData(target, options);
    return clearAllBioWeaveData(target, options);
  }

  async function getStoryTimeDebugInfo() {
    const info = await storyTimeCoordinator.getCurrentStoryTimeInfo();
    let business = null;
    try {
      // This is a read-only derived-data read. It does not invoke Event Analyzer.
      business = await eventAnalysis.collectActiveBusinessData();
    } catch {
      business = null;
    }
    return diagnostics.buildStoryTimeDebugInfo({
      info,
      business,
      trace: storyTimeCoordinator.getDebugTrace(),
      chatId: chat.current(),
      normalizeStoryTimeForRead: value => storyTimeCoordinator.normalizeStoryTimeForRead?.(value),
    });
  }

  async function getProjectionTimingDebug() {
    const chatId = chat.current();
    const floor = await eventAnalysis.resolveCurrentBioWeaveFloor();
    if (!floor?.version || String(floor.version.chat_id) !== String(chatId)) {
      return {status: "unavailable", reason: "NO_CHARACTER_FLOOR", chat_id: chatId, timing_instances: [], authoritative_readback: {timing_timeline_present: false, timing_instance_count: 0}};
    }
    const timeline = await projectionTimingPersistence.getTimingInstances({chatId, endpointFloor: floor.version.floor});
    const business = await eventAnalysis.collectActiveBusinessData();
    const world = await eventAnalysis.resolveWorldModelAtOrBefore({__messageIndex: true, index: floor.index});
    const events = business.active_events ?? [];
    const confirmedSubjects = events.filter(event => event?.type === "pregnancy_confirmation" && event.status === "confirmed").flatMap(event => event?.state_fact?.subject_id ? [event.state_fact.subject_id] : (event?.pregnancy_relevance?.gestational_subject_ids ?? []));
    const terminatedSubjects = events.filter(event => ["pregnancy_loss", "abortion"].includes(event?.type) && event.status === "confirmed").flatMap(event => event?.state_fact?.subject_id ? [event.state_fact.subject_id] : (event?.pregnancy_relevance?.gestational_subject_ids ?? []));
    const instances = timeline.creations.map(instance => ({
      ...instance,
      derived_timing: evaluateProjectionTiming({timingInstance: instance, currentStoryTime: business.current_story_time ?? null, events, subjectId: instance.subject_id, pregnancyConfirmed: confirmedSubjects.includes(instance.subject_id), terminated: terminatedSubjects.includes(instance.subject_id)}),
    }));
    const projections = await projectionPersistence.getProjectionViews({chatId, endpointFloor: floor.version.floor});
    const eligibility = instances.length ? evaluateProjectionEligibility({
      currentState: business.current_state ?? {},
      events,
      sourceCandidates: Object.values(business.tracking_candidates ?? {}),
      worldModel: world?.model ?? {},
      currentStoryTime: business.current_story_time ?? null,
      existingProjections: projections?.all ?? [],
      preConfirmationTiming: {enabled: true, instances, windows: business.tracking_windows ?? [], confirmedSubjects, terminatedSubjects},
    }) : {decisions: [], diagnostics: []};
    return {
      status: "ok",
      chat_id: chatId,
      floor_version: floor.version,
      current_story_time: business.current_story_time ?? null,
      timing_instances: instances,
      projection_rule_ids: (world?.model?.projection_rules ?? []).map(rule => rule.projection_rule_id).filter(Boolean),
      projection_eligibility: eligibility.decisions.map(decision => ({subject_id: decision.subject_id, timing_instance_id: decision.timing_instance_id ?? null, reason_code: decision.reason_code, eligibility: decision.eligibility, timing_status: decision.timing_status ?? null, projection_id: decision.existing_projection_id ?? null})),
      projection_ids: (projections?.all ?? []).map(item => item.projection_id).filter(Boolean),
      authoritative_readback: {timing_timeline_present: timeline.creations.length > 0, timing_instance_count: timeline.creations.length, basis_record_count: timeline.basis_records?.length ?? 0},
    };
  }

  async function getCharacterTimingEditorData({characterId, characterProfile = null} = {}) {
    const id = String(characterId ?? '').trim();
    if (!id) throw Object.assign(new TypeError('character_id:required'), {code: 'CHARACTER_ID_REQUIRED'});
    const chatId = chat.current();
    const floor = await eventAnalysis.resolveCurrentBioWeaveFloor();
    const [world, timeline] = await Promise.all([
      floor?.index === undefined
        ? Promise.resolve(null)
        : eventAnalysis.resolveWorldModelAtOrBefore({__messageIndex: true, index: floor.index}),
      projectionTimingPersistence.getTimingInstances({chatId, endpointFloor: floor?.version?.floor}),
    ]);
    const worldSpecies = Array.isArray(world?.model?.species) ? world.model.species : [];
    const profileSpecies = characterProfile?.biological_context?.species ?? characterProfile?.species;
    const humanApplicable = worldSpecies.some(species => isCanonicalWorldHumanSpecies(species?.name))
      && isCanonicalWorldHumanSpecies(profileSpecies);
    const override = readCharacterTimingConfig(store.getChat(chatId), id).config;
    const resolved = resolveCharacterTimingConfig({
      override,
      baseline: humanApplicable ? getHumanPreconfirmationTimingPreset() : null,
    });
    const timingInstance = [...(timeline?.creations ?? [])].reverse().find(instance => instance.subject_id === id) ?? null;
    return {
      character_id: id,
      config: resolved.config,
      overridden: Boolean(override),
      human_preset_applicable: humanApplicable,
      human_preset_version: HUMAN_PRECONFIRMATION_TIMING_PRESET_VERSION,
      timing_instance: timingInstance,
      chat_id: chatId,
    };
  }

  const dataLifecycle = {
    clearCharacterData,
    clearWorldData,
    clearAllBioWeaveData,
    clearSourceChatBioWeave,
    clearBioWeaveData,
  };

  function destroy() {
    if (destroyed) return;
    versionChainByExecution.clear();
    projectionRuntime.destroy();
    projectionContext.destroy();
    storyTimeCoordinator.destroy();
    eventAnalysis.destroy();
    while (unbind.length) unbind.pop()();
    subscriptions.clear();
    activity.destroy();
    chat.destroy();
    destroyed = true;
    initialized = false;
  }

  return {
    st,
    chat,
    store,
    init,
    subscribe,
    getActivityState: activity.getActivityState,
    subscribeActivity: activity.subscribe,
    startActivity: activity.startActivity,
    finishActivity: activity.finishActivity,
    recordActivityError: activity.recordError,
    analyzeCurrentFloor: eventAnalysis.analyzeCurrentFloor,
    resolveCurrentBioWeaveFloor: eventAnalysis.resolveCurrentBioWeaveFloor,
    analyzeFloor: eventAnalysis.analyzeFloor,
    refreshCurrentFloorAnalysis: eventAnalysis.refreshCurrentFloorAnalysis,
    analyzeCurrentCharacterEvents: eventAnalysis.analyzeCurrentCharacterEvents,
    requestAbortCurrentFloorAnalysis:
      eventAnalysis.requestAbortCurrentFloorAnalysis,
    getBioWeaveEnabled: isBioWeaveEnabled,
    assertBioWeaveEnabled,
    setBioWeaveEnabled,
    getCurrentFloorAnalysisStatus: eventAnalysis.getCurrentFloorAnalysisStatus,
    automaticAnalysis: eventAnalysis.automaticAnalysis,
    analysisExecution: eventAnalysis.analysisExecution,
    manualAnalysis: eventAnalysis.manualAnalysis,
    getAutoAnalysisSchedulerState: eventAnalysis.getAutoAnalysisSchedulerState,
    reconcileSchedulerState: eventAnalysis.reconcileSchedulerState,
    getPersistenceTrace: diagnostics.getPersistenceTrace,
    recordPersistenceTrace,
    getCurrentFloorAnalysisInput: eventAnalysis.getCurrentFloorAnalysisInput,
    getCurrentFloorEvents: eventAnalysis.getCurrentFloorEvents,
    getCurrentCharacterIdentity: eventAnalysis.getCurrentCharacterIdentity,
    updateCharacterAliases: eventAnalysis.updateCharacterAliases,
    getCurrentStoryTime: storyTimeCoordinator.getCurrentStoryTime,
    getCurrentStoryTimeInfo: storyTimeCoordinator.getCurrentStoryTimeInfo,
    getStoryTimeDebugTrace: storyTimeCoordinator.getDebugTrace,
    getStoryTimeDebugInfo,
    getProjectionTimingDebug,
    getCharacterTimingEditorData,
    getCharacterTimingConfig: characterTimingConfigStore.getConfig,
    saveCharacterTimingConfig: characterTimingConfigStore.saveConfig,
    resetCharacterTimingConfig: characterTimingConfigStore.resetConfig,
    resolveWorldModelAtOrBefore: eventAnalysis.resolveWorldModelAtOrBefore,
    resolveWorldModelStrictlyBefore: eventAnalysis.resolveWorldModelStrictlyBefore,
    saveWorldModel: eventAnalysis.saveWorldModel,
    getWorldModelDiagnosticState: eventAnalysis.getWorldModelDiagnosticState,
    analyzeCurrentWorldModelFull: eventAnalysis.analyzeCurrentWorldModelFull,
    analyzeCurrentWorldModelPatch: eventAnalysis.analyzeCurrentWorldModelPatch,
    getTrackingRegistry: eventAnalysis.getTrackingRegistry,
    collectActiveBusinessData: async (...args) => ({
      ...(await eventAnalysis.collectActiveBusinessData(...args)),
      ...(await projectionRuntime.getBusinessData()),
    }),
    getCurrentBiologicalState: eventAnalysis.getCurrentBiologicalState,
    getProjectionViews: projectionPersistence.getProjectionViews,
    refreshProjectionContext: projectionContext.refreshProjectionContext,
    clearProjectionContext: projectionContext.clearProjectionContext,
    refreshProjection: projectionRuntime.refreshProjection,
    deleteProjection: projectionRuntime.deleteProjection,
    refreshTrackingRegistry: eventAnalysis.refreshTrackingRegistry,
    updateEvent: updateEventWithProjection,
    deleteEvent: deleteEventWithProjection,
    clearCharacterData,
    clearWorldData,
    clearAllBioWeaveData,
    clearSourceChatBioWeave,
    clearBioWeaveData,
    clearData: clearBioWeaveData,
    dataLifecycle,
    lifecycle: dataLifecycle,
    getFailedSourceClear: (chatId) => failedSourceClears.get(chatId) ?? null,
    getActiveSwipeId,
    getActiveFloor,
    getActiveFloorEvents,
    destroy,
  };
}
