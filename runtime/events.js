import { createChatBoundary } from "./chat.js";
import {
  createStore,
  hasSwipeSlot,
  hasSwipeStructure,
  isCharacterMessage,
} from "../storage/store.js";
import { createAnalyzer } from "../ai/analyzer.js";
import { compareStoryTime, createStoryTime, differenceStoryTime } from "../story/time.js";
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
import { floorVersion, hashText, hasCompleteFloorVersion, sameFloorVersion } from "./floor.js";
import { createStoryTimeCoordinator } from "../story/coordinator.js";
import { createCalendarResolver } from "../story/calendar.js";
import { createProjectionPersistence } from "../storage/projection.js";
import { createProjectionTimingPersistence } from "../storage/projection-timing.js";
import { createTrackingWindowPersistence } from "../storage/tracking-window.js";
import { createParticipantAggregationPersistence } from "../storage/participant-aggregation.js";
import { createPregnancyLifecyclePersistence } from "../storage/pregnancy-lifecycle.js";
import { createPregnancyKnowledgePersistence } from "../storage/pregnancy-knowledge.js";
import { createPregnancyKnowledgeRuntime } from "./pregnancy-knowledge-runtime.js";
import {
  buildProjectionTimingCycleId,
  evaluateProjectionTiming,
  normalizeProjectionTimingCycleStoryTime,
  resolveProjectionTimingInstance,
} from "../core/projection-timing.js";
import { isPregnancyRelevantExposure } from "../core/events.js";
import { buildParticipantAggregationEvidence, buildParticipantAggregationId, filterProjectionViewsByAggregationEvidence, resolveParticipantAggregationTrigger, upsertParticipantAggregation } from "../core/participant-aggregation.js";
import { normalizePregnancyLifecycleTimeline } from "../core/pregnancy-lifecycle.js";
import { derivePregnancyStatus } from "../core/pregnancy-status.js";
import { isExposureBlockedByParticipantAggregation } from "../core/tracking-window.js";
import { PARTICIPANT_AGGREGATION_LOCK_DISABLED, resolveCycleLocks } from "../core/participant-aggregation-lock.js";
import { BUILT_IN_PRE_CONFIRMATION_CONCERN, evaluateProjectionEligibility } from "../core/projection-eligibility.js";
import { readCharacterTimingConfig, resolveCharacterTimingConfig } from "../core/character-timing-config.js";
import { getHumanPreconfirmationTimingPreset, HUMAN_PRECONFIRMATION_TIMING_PRESET_VERSION } from "../core/human-timing-preset.js";
import { isCanonicalWorldHumanSpecies } from "../core/world-species-identity.js";
import { createFloorPersistenceCoordinator } from "../storage/floor-persistence-coordinator.js";
import { createCurrentStateAttributionResolver, createProjectionContextCoordinator } from "./projection-context.js";
import { createCharacterTimingConfigStore } from "../storage/character-timing.js";
import { createProjectionRuntime } from "./projection-runtime.js";
import { createProjectionStorylineRuntime } from "./projection-storyline-runtime.js";
import { createHealthAssessmentCoordinator } from "./health-assessment.js";
import { createHealthEvolutionRuntime } from "./health-evolution.js";
import { createRuntimeActivity } from "./activity.js";
import {
  buildVersionChainDiagnostic,
  createRuntimeDiagnostics,
  durationMs,
  monotonicNow,
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
  "STREAM_TOKEN_RECEIVED",
  "CHARACTER_MESSAGE_RENDERED",
];

const SOURCE_OWNER_LATEST_MERGE = true;

/**
 * Resolve one task's configured API without coupling unrelated task slots.
 * Projection/storyline requests use the `projection` assignment; event
 * analysis keeps its own `event_analysis` assignment.
 */
export function resolveAssignedApiProfile({settings = {}, profileStore = null, assignmentKey} = {}) {
  const assignment = settings?.assignments?.[assignmentKey] ?? null;
  if (assignment === SILLYTAVERN_CURRENT_API) return SILLYTAVERN_CURRENT_API;
  if (assignment === FOLLOW_DEFAULT_API) {
    if (settings?.api_source === SILLYTAVERN_CURRENT_API) return SILLYTAVERN_CURRENT_API;
    return settings?.default_profile_id
      ? (profileStore?.getProfile?.(settings.default_profile_id) ?? null)
      : null;
  }
  return assignment
    ? (profileStore?.getProfile?.(assignment) ?? null)
    : null;
}

function cycleStoryTimeEqual(left, right) {
  return JSON.stringify(normalizeProjectionTimingCycleStoryTime(left))
    === JSON.stringify(normalizeProjectionTimingCycleStoryTime(right));
}

function eventFloorVersion(event) {
  return event?.source ?? event?.version ?? event?.event_version ?? null;
}

function storedEventBasisChanged(stored, current) {
  if (!stored || !current) return false;
  return !sameFloorVersion(stored, current);
}

function resolveTrackingWindowFirstExposure({trackingWindow = null, candidateEvents = [], chatId, subjectId, mechanismKey} = {}) {
  const candidates = (Array.isArray(candidateEvents) ? candidateEvents : [])
    .filter(event => trackingWindow?.source_event_ids?.includes(event?.event_id));
  if (!trackingWindow) return candidates.length ? {event: candidates[0], source: "EXPOSURE_FIRST_EVENT"} : {event: null, reason_code: "EXPOSURE_FIRST_EVENT_UNAVAILABLE"};
  const cycleMatches = candidates.filter(event =>
    buildProjectionTimingCycleId({chatId, subjectId, mechanismKey, firstEvent: event}) === trackingWindow.cycle_id,
  );
  if (cycleMatches.length === 1) return {event: cycleMatches[0], source: "TRACKING_WINDOW"};
  if (cycleMatches.length > 1) return {event: null, reason_code: "CYCLE_FIRST_EXPOSURE_AMBIGUOUS"};
  const openedMatches = candidates.filter(event => cycleStoryTimeEqual(event?.story_time, trackingWindow.opened_story_time));
  if (openedMatches.length === 1) return {event: openedMatches[0], source: "TRACKING_WINDOW_OPENED_STORY_TIME"};
  if (openedMatches.length > 1) return {event: null, reason_code: "CYCLE_FIRST_EXPOSURE_AMBIGUOUS"};
  let first = null;
  for (const candidate of candidates) {
    if (!first) {
      first = candidate;
      continue;
    }
    const comparison = compareStoryTime(candidate?.story_time, first?.story_time);
    if (comparison === null) return {event: null, reason_code: "CYCLE_FIRST_EXPOSURE_STORY_TIME_UNRESOLVED"};
    if (comparison < 0) first = candidate;
    else if (comparison === 0) return {event: null, reason_code: "CYCLE_FIRST_EXPOSURE_AMBIGUOUS"};
  }
  return first
    ? {event: first, source: "TRACKING_WINDOW_CHRONOLOGY"}
    : {event: null, reason_code: "CYCLE_FIRST_EXPOSURE_UNAVAILABLE"};
}

function resolveCanonicalTimingInstance({timingInstances = [], subjectId, mechanismKey, candidate, canonicalCycleId} = {}) {
  const trackingWindowIds = new Set(candidate?.trackingWindow?.source_event_ids ?? []);
  const firstEventId = candidate?.firstEvent?.event_id ?? null;
  const firstEventVersion = eventFloorVersion(candidate?.firstEvent);
  const candidates = (Array.isArray(timingInstances) ? timingInstances : []).filter(instance => {
    if (instance?.subject_id !== subjectId || instance?.mechanism_key !== mechanismKey) return false;
    if (!canonicalCycleId || instance?.cycle_id !== canonicalCycleId) return false;
    if (!firstEventId || !(instance?.source_event_ids ?? []).includes(firstEventId)) return false;
    if (trackingWindowIds.size && !(instance?.source_event_ids ?? []).some(id => trackingWindowIds.has(id))) return false;
    const storedEventVersion = instance?.source_basis_refs?.[firstEventId]?.event_version
      ?? instance?.source_basis_refs?.[firstEventId]?.source
      ?? null;
    if (storedEventVersion && firstEventVersion && !sameFloorVersion(storedEventVersion, firstEventVersion)) return false;
    return cycleStoryTimeEqual(instance?.reference_story_time, candidate?.firstEvent?.story_time);
  });
  const unique = [...new Map(candidates.map(instance => [instance.timing_instance_id, instance])).values()];
  if (unique.length > 1) return {status: "ambiguous", candidates: unique};
  if (unique.length === 1) {
    const instance = unique[0];
    return {
      status: "matched",
      instance,
      source: "CANONICAL_CYCLE_ID",
    };
  }
  return {status: "unavailable", candidates: []};
}

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

export function resolveStorylineBodyMessageIndex(messages, version) {
  if (!Array.isArray(messages)) return -1;
  const expectedMessageId = version?.message_id;
  if (expectedMessageId === null || expectedMessageId === undefined) return -1;
  const messageIdCandidates = (message, index) => [
    message?.message_id,
    message?.messageId,
    message?.id,
    // Some SillyTavern messages expose the Floor number but no host message
    // ID. Floor Version construction accepts the same fields before falling
    // back to the chat-array index.
    message?.floor,
    message?.floor_id,
    message?.floorIndex,
    index,
  ];
  const matches = messages
    .map((message, index) => ({message, index}))
    .filter(({message, index}) =>
      messageIdCandidates(message, index).some(candidate =>
        candidate !== null && candidate !== undefined
        && String(candidate) === String(expectedMessageId),
      ),
    );
  if (matches.length === 1) return matches[0].index;
  const floorIndex = Number(version?.floor);
  if (Number.isInteger(floorIndex) && floorIndex >= 0) {
    const candidate = messages[floorIndex];
    if (candidate && messageIdCandidates(candidate, floorIndex).some(value =>
      value !== null && value !== undefined && String(value) === String(expectedMessageId),
    )) {
      return floorIndex;
    }
  }
  return -1;
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
        "domain", "chat_id", "active_chat_id", "active_character_floor_message_id", "active_swipe_id", "message_id", "floor", "swipe_id", "world_model_debug_schema_version", "first_failed_stage", "type_identity_decisions", "canonical_generation", "build_duration_ms", "join_wait_ms", "invalidation_reason",
        "message_index", "floor_version_key", "attempt", "execution_attempt", "stage_attempt", "retry_index", "persistence_invocation_id", "performance_operation_id", "persistence_kind", "trigger", "stage", "boundary", "source_kind", "source_text_length", "host_save_state", "host_post_save_hook", "host_chat_save_duration_ms", "analysis_execution_id", "scheduler_revision", "final_floor_index", "final_floor_version", "from_boundary", "to_boundary", "from_swipe_id", "to_swipe_id", "from_source_kind", "to_source_kind", "path", "reason",
        "execution_id", "mode", "response_text_length", "raw_fact_block_count", "parsed_fact_count", "parse_rejected_fact_count", "resolution_rejected_fact_count", "evidence_guard_rejected_fact_count", "fact_count", "rejected_fact_count", "patch_operation_count", "accepted_fact_count", "accepted_operation_count", "initial_type_count", "initial_identity_search_performed", "sibling_search_seeded", "sibling_search_complete", "discovered_sibling_type_count", "discovered_sibling_type_names", "accepted_sibling_type_count", "accepted_sibling_type_names", "rejected_sibling_type_count", "rejected_sibling_type_names", "reported_distinct_type_count", "host_observed_distinct_type_count", "accepted_canonical_type_count", "new_type_identity_fact_count", "accepted_new_type_identity_count", "identity_diversity", "coverage_initial_target_count", "coverage_current_target_count", "dynamic_coverage_target_count", "dynamic_coverage_target_ids", "unaccounted_dynamic_target_count", "unaccounted_dynamic_target_ids", "derived_target_accounting_complete", "dynamic_coverage_unaccounted_in_single_response", "derived_target_accounting_records", "dynamic_coverage_targets", "coverage_dispositions", "analysis_stage_succeeded", "canonical_mutation_occurred", "completeness_required", "completeness_satisfied", "completeness_diagnostics", "semantic_incomplete", "semantic_failure_code", "semantic_diagnostics", "analysis_outcome", "coverage_fact_mappings", "coverage_target_count", "coverage_target_counts", "covered_target_count", "coverage_targets", "coverage_targets_truncated", "target_emitted", "target_not_emitted", "fields", "scope_summary", "address_summary", "facts", "rejected_facts", "fact_mappings", "fact_index", "failure_stage", "failure_code", "reason",
        "review_accounted", "mutation_rejected_count", "coverage_mutation_states", "request_envelope", "request_mode", "request_total_char_count", "permitted_evidence_char_count", "existing_reference_char_count", "retry_directive_char_count", "host_diagnostics_included", "permitted_evidence_fingerprint", "existing_reference_fingerprint", "coverage_target_set_fingerprint", "analysis_payload_fingerprint", "model_request_payload_fingerprint", "control_directive_fingerprint", "retry_reason", "configured_retry_count", "retry_target_ids", "retry_attempt", "previous_failure_code", "execution_result", "fact_delta_result",
        "comparison", "patch_operation_type", "patch_path", "rejected_operation_type", "rejected_semantic_path", "species", "biological_type", "field", "proposed_value", "classification", "evidence_guard_failure_code", "rejected_semantic_field", "evidence_binding", "decision", "candidate_value", "candidate_normalized_value", "scoped_evidence_unit_count", "matched_evidence_unit_count", "matched_evidence_unit_indices", "matched_evidence_excerpts", "support_strategy", "support_score_if_any", "required_threshold_if_any", "scope_binding_result", "value_support_result", "rejection_code", "rejection_detail",
        "generation_id", "generation_type", "generation_source", "generation_intent_id", "generation_final_floor_seen", "generation_ended", "generation_settled", "execution_active", "current_execution_id", "target_message_id", "target_swipe_id", "owner_changed", "supersede_decision", "supersede_reason", "result_reason", "pending_generation", "pending_swipe_generation", "completed_generation", "completed_swipe_generation", "event_type", "event_payload_type", "force", "counter_before", "counter_after", "interval", "retry_paused", "already_observed", "already_counted", "host_event_key", "host_event_type", "received_at", "host_chat_id", "host_message_id", "host_swipe_id", "host_generation_type", "forward_to_runtime", "runtime_handler_present", "forwarded", "forward_result", "forward_error", "forward_error_name",
        "cancel_stage", "cancel_reason", "cancel_code",
        "original_chat_id", "current_chat_id", "original_message_id", "current_owner_message_id",
        "original_swipe_id", "current_swipe_id",
        "chat_id_match", "message_id_match",
        "floor_match", "swipe_id_match",
        "active_chat_match", "message_owner_match", "host_floor_version_match",
        "official_floor_version_match", "generation_identity_match", "execution_superseded",
      "result", "classification", "retry_classification", "retryable", "retry_budget_consumed", "version_check_source", "expected_floor_version", "actual_floor_version", "present", "world_model_present", "species_count",
        "biological_type_count", "floor_version_match", "swipe_match", "commitState",
      "revision", "current_floor_present", "expected", "actual", "mismatch_fields", "authoritative",
      "response_shape", "messages_present", "messages_count", "owner_found",
      "message_summary", "request_fingerprint", "event_types", "not_pregnant_candidate_count", "pregnancy_knowledge_candidate_count", "accepted_count", "rejected_count", "reason_codes",
        "owner_message_id", "owner_message_found", "swipe_found", "swipe_structure", "active_swipe_id",
        "swipes_present", "swipes_count", "swipe_info_present", "swipe_info_count",
      "target_swipe_info_found", "target_extra_present", "target_bioweave_present",
      "message_index", "slot_present", "floor_version_match", "active_swipe_match",
      "host_memory_slot_present", "official_slot_present", "host_memory_world_present",
      "world_present", "analysis_present", "events_present", "character_registry_present",
      "snapshot_present", "projection_timeline_present", "participant_aggregation_count", "accepted_exposure_count", "aggregation_id", "projection_delivery_count", "delivery_id", "response_observed", "analysis_status", "lifecycle_status", "lifecycle_fact_id", "archive_id", "closure_reason", "release_action", "lock_key", "locked_cycle_keys", "production_gate", "lock_reason",
      "official_owner_found", "official_swipe_found", "host_memory_owner_found", "host_memory_swipe_found",
      "host_memory_analysis_present", "host_memory_events_present",
      "host_memory_character_registry_present", "host_memory_snapshot_present",
      "host_memory_projection_timeline_present", "official_world_present",
      "official_analysis_present", "official_events_present",
      "official_character_registry_present", "official_snapshot_present",
      "official_projection_timeline_present", "save_convergence", "host_convergence_attempted", "host_convergence_available",
        "retry_budget_consumed",
        "failure_stage", "error_name", "error_code", "error_message", "diagnostic_code",
        "retryable", "from_retry_index", "next_retry_index",
      "world_persisted", "event_persisted", "readback_valid", "canonical_world_present",
      "canonical_character_present", "ui_ready",
      "expected_swipe_id", "expected_floor_version", "actual_floor_version",
      "bioweave_present", "event_count", "character_count", "current_floor_included",
      "source", "ready", "ui_state_fingerprint", "rendered_field_count", "unrendered_canonical_field_count", "canonical_field_count",
      "persistence_transaction_id", "floor_transaction_id", "transaction_key", "owner", "operation_type", "patch_fields", "queue_key", "queued", "before_presence", "after_presence", "missing_owner_fields", "missing_siblings", "save_invocation_id", "commit_state", "save_state",
      "io_call_id", "io_purpose", "endpoint_kind", "actual_network_request", "cache_status",
      "request_prepare_duration_ms", "network_wait_duration_ms", "response_body_read_duration_ms",
      "json_parse_duration_ms", "response_parse_duration_ms",
      "response_normalize_duration_ms", "source_revision_duration_ms", "floor_extract_duration_ms",
      "total_duration_ms", "owner_message_index", "owner_swipe_id",
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

  function officialIoContext(traceContext = null, ioPurpose = null) {
    return {
      ...(traceContext && typeof traceContext === "object" ? traceContext : {}),
      ...(ioPurpose ? {io_purpose: ioPurpose} : {}),
    };
  }

  async function readOfficialChatOwner(owner = {}) {
    const context = owner?.officialIoContext ?? {};
    return io.readOfficialChatOwner({
      ...owner,
      officialIoContext: context,
      officialIoTrace: payload => emitPersistenceTrace({...context, ...payload}),
    });
  }

  function traceOfficialFloorExtract(state, traceContext, startedAt, details = {}) {
    emitPersistenceTrace({
      ...officialIoContext(traceContext),
      stage: "OFFICIAL_FLOOR_EXTRACT",
      io_call_id: state?.__official_io_call_id ?? null,
      floor_extract_duration_ms: durationMs(startedAt),
      status: "SUCCEEDED",
      reason_code: "OFFICIAL_FLOOR_EXTRACT_COMPLETED",
      ...details,
    });
  }

  function resolveOfficialOwnerMessage(messages, {messageIndex = null, expectedMessageId = null} = {}) {
    const requestedIndex = Number.isInteger(Number(messageIndex)) && Number(messageIndex) >= 0
      ? Number(messageIndex)
      : null;
    const expectedId = expectedMessageId == null ? null : String(expectedMessageId);
    if (requestedIndex !== null) {
      const message = messages?.[requestedIndex];
      if (!message) {
        throw sourceError("STALE_FLOOR_VERSION", {
          version_check_source: "official_owner",
          owner_message_found: false,
          owner_message_index: requestedIndex,
          owner_message_id: expectedMessageId ?? null,
          owner_resolution: "MESSAGE_INDEX_NOT_FOUND",
        });
      }
      const actualId = String(messageIdForFloor(message, requestedIndex));
      if (expectedId !== null && actualId !== expectedId) {
        throw sourceError("STALE_FLOOR_VERSION", {
          version_check_source: "official_owner",
          owner_message_found: false,
          owner_message_index: requestedIndex,
          owner_message_id: expectedMessageId ?? null,
          actual_owner_message_id: messageIdForFloor(message, requestedIndex),
          owner_resolution: "MESSAGE_INDEX_ID_MISMATCH",
        });
      }
      return {message, index: requestedIndex};
    }
    if (expectedId === null) {
      throw sourceError("FLOOR_OWNER_REQUIRED", {
        owner_resolution: "MESSAGE_INDEX_REQUIRED",
      });
    }
    const matches = (Array.isArray(messages) ? messages : [])
      .map((message, index) => ({message, index}))
      .filter(({message, index}) => String(messageIdForFloor(message, index)) === expectedId);
    if (matches.length !== 1) {
      throw sourceError("STALE_FLOOR_VERSION", {
        version_check_source: "official_owner",
        owner_message_found: matches.length === 1,
        owner_message_id: expectedMessageId,
        owner_resolution: matches.length > 1 ? "MESSAGE_ID_AMBIGUOUS" : "MESSAGE_ID_NOT_FOUND",
      });
    }
    return matches[0];
  }

  async function readOfficialFloorSlot({
    messageIndex,
    message_id,
    swipeId = 0,
    expectedChatId,
    expectedVersion,
    traceContext = null,
  } = {}) {
    const ioContext = officialIoContext(traceContext, traceContext?.io_purpose ?? "AUTHORITATIVE_FLOOR_READ");
    const state = await readOfficialChatOwner({chatId: expectedChatId, officialIoContext: ioContext});
    const extractStartedAt = monotonicNow();
    const expectedMessageId = expectedVersion?.message_id ?? message_id;
    const {message, index} = resolveOfficialOwnerMessage(state.messages, {
      messageIndex,
      expectedMessageId,
    });
    const targetSwipeId = Number.isInteger(Number(swipeId)) && Number(swipeId) >= 0
      ? Number(swipeId)
      : 0;
    if (!isCharacterMessage(message)) throw sourceError("BIOWEAVE_USER_FLOOR_WRITE_FORBIDDEN");
    const slot = readFloorSlot(message, targetSwipeId);
    traceOfficialFloorExtract(state, ioContext, extractStartedAt, {
      owner_message_index: index,
      owner_message_id: messageIdForFloor(message, index),
      owner_swipe_id: targetSwipeId,
    });
    return {
      floor: slot ? cloneOwnerValue(slot) : null,
      messageIndex: index,
      message_id: messageIdForFloor(message, index),
      swipe_id: targetSwipeId,
      revision: state.revision,
    };
  }

  async function inspectOfficialFloorOwner({
    messageIndex,
    swipeId = 0,
    expectedChatId,
    expectedVersion,
    traceContext = null,
  } = {}) {
    const context = getContext();
    if (String(context?.chatId) !== String(expectedChatId)) throw sourceError("STALE_CHAT");
    const liveMessages = context?.chat;
    const liveTarget = liveMessages?.[messageIndex];
    if (!Array.isArray(liveMessages) || !liveTarget || !isCharacterMessage(liveTarget))
      throw sourceError("FLOOR_OWNER_REQUIRED");
    const ioContext = officialIoContext(traceContext, traceContext?.io_purpose ?? "OWNER_ACQUISITION");
    const state = await readOfficialChatOwner({chatId: expectedChatId, officialIoContext: ioContext});
    const extractStartedAt = monotonicNow();
    const expectedMessageId = expectedVersion?.message_id ?? messageIdForFloor(liveTarget, messageIndex);
    const officialOwner = resolveOfficialOwnerMessage(state.messages, {
      messageIndex,
      expectedMessageId,
    });
    const officialIndex = officialOwner.index;
    const officialTarget = officialOwner.message;
    const currentContext = getContext();
    if (String(currentContext?.chatId) !== String(expectedChatId) ||
        currentContext?.chat?.[messageIndex] !== liveTarget)
      throw sourceError("STALE_FLOOR_VERSION");
    const officialSwipeId = officialTarget && hasSwipeStructure(officialTarget)
      ? Number.isInteger(officialTarget.swipe_id) ? officialTarget.swipe_id : 0
      : 0;
    traceOfficialFloorExtract(state, ioContext, extractStartedAt, {
      owner_message_index: officialIndex,
      owner_message_id: messageIdForFloor(officialTarget, officialIndex),
      owner_swipe_id: officialSwipeId,
    });
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
      });
    };
    const result = {
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
      officialSwipeId,
      requestedSwipeId: swipeId,
      expectedVersion,
    };
    return result;
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
    });
    if (!sameFloorVersion(currentVersion, expectedVersion))
      throw sourceError("STALE_FLOOR_VERSION");
    const next = cloneOwnerValue(state.messages);
    const target = officialTarget ? cloneOwnerValue(officialTarget) : cloneOwnerValue(liveTarget);
    if (officialTarget) {
      for (const key of ["message_id", "floor", "role", "is_user", "is_system", "mes", "content", "swipe_id"])
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
    return Number(left.floor ?? index) === Number(right.floor ?? index)
      && leftSwipe === rightSwipe;
  }

  async function acquireAuthoritativeFloorOwner({
    expectedVersion,
    messageIndex,
    swipeId = 0,
    generationSettled = false,
    traceContext = null,
  } = {}) {
    const inspection = await inspectOfficialFloorOwner({
      messageIndex,
      swipeId,
      expectedChatId: expectedVersion?.chat_id,
      expectedVersion,
      traceContext: officialIoContext(traceContext, "OWNER_ACQUISITION"),
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
      const activeSwipeId = Number.isInteger(message?.swipe_id) ? message.swipe_id : 0;
      if (Number(swipeId) === activeSwipeId) {
        message.extra ??= {};
        message.extra.bioweave = cloneOwnerValue(value);
      }
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
    const persistenceStartedAt = monotonicNow();
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
    const contextFirst = traceContext?.coordinator_transaction === true;
    let latest;
    if (contextFirst) {
      latest = {
        revision: null,
        header: {},
        chatMetadata: cloneOwnerValue(context?.chatMetadata ?? {}),
        messages: cloneOwnerValue(Array.isArray(context?.chat) ? context.chat : []),
        response_shape: "host_context",
      };
      trace("CONTEXT_FLOOR_SOURCE_RESOLVED", {
        source: "host_context",
        messages_count: latest.messages.length,
      });
    } else {
      const beforeSaveReadStartedAt = monotonicNow();
      trace("OFFICIAL_GET_BEFORE_SAVE_BEGIN");
      latest = await readOfficialChatOwner({
        chatId: expectedChatId,
        characterId: descriptor.characterId,
        officialIoContext: officialIoContext(traceContext, "SAVE_PREWRITE_READ"),
      });
      trace("OFFICIAL_GET_BEFORE_SAVE_END", {
        revision: latest.revision,
        official_get_before_save_duration_ms: durationMs(beforeSaveReadStartedAt),
      });
    }
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
      const prewriteExtractStartedAt = monotonicNow();
      const currentContextForOwner = getContext();
      expectedMessageId = expectedVersion?.message_id ??
        messageIdForFloor(currentContextForOwner?.chat?.[messageIndex], messageIndex);
      targetIndex = resolveOfficialOwnerMessage(latest.messages, {
        messageIndex,
        expectedMessageId,
      }).index;
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
      traceOfficialFloorExtract(
        latest,
        officialIoContext(traceContext, "SAVE_PREWRITE_READ"),
        prewriteExtractStartedAt,
        {
          owner_message_index: targetIndex,
          owner_message_id: messageIdForFloor(target, targetIndex),
          owner_swipe_id: targetSwipeId,
        },
      );
      if (expectedVersion) {
        failureStage = "official_owner_floor_version_check";
        const authoritativeVersion = await floorVersion({
          chatId: expectedChatId,
          messageId: messageIdForFloor(target, targetIndex),
          floor: target.floor ?? targetIndex,
          swipeId: targetSwipeId,
          text: messageTextForFloor(target, targetSwipeId),
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
    // dispatch-time Context slot. The adapter is only a low-level transport
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
    const hostChatSaveStartedAt = monotonicNow();
    trace("BIOWEAVE_FULL_CHAT_SAVE_DISPATCHED", {
      source: "official_clone",
      persistence_transaction_id: persistenceTransactionId,
      save_invocation_id: saveInvocationId,
      commit_state: "dispatched",
    });
    try {
      if (contextFirst) {
        await io.saveChat({
          expectedChatId,
          officialIoContext: officialIoContext(traceContext, "SAVE_WRITE"),
        });
      } else {
        await io.requestOfficialChatSave({
          descriptor,
          chat: [header, ...cloneOwnerValue(latest.messages)],
          officialIoContext: officialIoContext(traceContext, "SAVE_WRITE"),
          officialIoTrace: payload => emitPersistenceTrace({
            ...officialIoContext(traceContext, "SAVE_WRITE"),
            ...payload,
          }),
        });
      }
      trace("BIOWEAVE_FULL_CHAT_SAVE_RESOLVED", {
        source: "official_clone",
        persistence_transaction_id: persistenceTransactionId,
        save_invocation_id: saveInvocationId,
        commit_state: "resolved",
        host_chat_save_duration_ms: durationMs(hostChatSaveStartedAt),
      });
    } catch (error) {
      trace("BIOWEAVE_FULL_CHAT_SAVE_RESOLVED", {
        source: "official_clone",
        persistence_transaction_id: persistenceTransactionId,
        save_invocation_id: saveInvocationId,
        commit_state: "unknown",
        host_chat_save_duration_ms: durationMs(hostChatSaveStartedAt),
        ...persistenceTraceError(error, "official_save"),
      });
      throw error;
    }
    trace(traceStage("OFFICIAL_SAVE_END", "EVENT_SAVE_END"));
    const afterSaveReadStartedAt = monotonicNow();
    trace("OFFICIAL_GET_AFTER_SAVE_BEGIN");
    const committed = await readOfficialChatOwner({
      chatId: expectedChatId,
      characterId: descriptor.characterId,
      officialIoContext: officialIoContext(traceContext, "SAVE_AUTHORITATIVE_READBACK"),
    });
    const committedExtractStartedAt = monotonicNow();
    trace("OFFICIAL_GET_AFTER_SAVE_END", {
      revision: committed.revision,
      official_get_after_save_duration_ms: durationMs(afterSaveReadStartedAt),
    });
    const committedMessage = resolveOfficialOwnerMessage(committed.messages, {
      messageIndex,
      expectedMessageId,
    }).message;
    const committedActiveSwipe = committedMessage && hasSwipeStructure(committedMessage)
      ? Number.isInteger(committedMessage.swipe_id)
        ? committedMessage.swipe_id
        : targetSwipeId
      : targetSwipeId;
    const committedSlot = committedMessage
      ? readFloorSlot(committedMessage, targetSwipeId)
      : undefined;
    const committedMirror = committedMessage?.extra?.bioweave;
    const committedVersion = committedMessage
      ? await floorVersion({
        chatId: expectedChatId,
        messageId: messageIdForFloor(committedMessage, messageIndex),
        floor: committedMessage.floor ?? messageIndex,
        swipeId: committedActiveSwipe,
        text: messageTextForFloor(committedMessage, committedActiveSwipe),
      })
      : null;
    const readbackPresent = Boolean(
      committedMessage &&
      isCharacterMessage(committedMessage) &&
      String(messageIdForFloor(committedMessage, messageIndex)) === String(expectedMessageId) &&
      committedActiveSwipe === targetSwipeId &&
      sameFloorVersion(committedVersion, expectedVersion) &&
      JSON.stringify(committedSlot) === JSON.stringify(mergedValue) &&
      JSON.stringify(committedMirror) === JSON.stringify(mergedValue),
    );
    traceOfficialFloorExtract(
      committed,
      officialIoContext(traceContext, "SAVE_AUTHORITATIVE_READBACK"),
      committedExtractStartedAt,
      {
        owner_message_index: messageIndex,
        owner_message_id: expectedMessageId,
        owner_swipe_id: targetSwipeId,
      },
    );
    trace("BIOWEAVE_FULL_CHAT_SAVE_READBACK", {
      source: "official_clone",
      persistence_transaction_id: persistenceTransactionId,
      save_invocation_id: saveInvocationId,
      commit_state: readbackPresent ? "readback_confirmed" : "unknown",
      ...slotPresence(committedSlot),
      mirror_present: committedMirror !== undefined,
    });
    trace(traceStage("WORLD_SLOT_AFTER_READBACK", "EVENT_SLOT_AFTER_READBACK"), {
      present: readbackPresent,
      floor_version_match: Boolean(committedMessage),
      swipe_match: Boolean(committedMessage && (!hasSwipeStructure(committedMessage) || committedMessage.swipe_id === targetSwipeId)),
      persistence_duration_ms: durationMs(persistenceStartedAt),
    });
    if (!readbackPresent)
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
    if (contextFirst) {
      return {
        commitState: "confirmed",
        mergeMode: "context-floor-slot-and-host-memory",
        authoritativeReadback: true,
      };
    }
    const finalState = await readOfficialChatOwner({
      chatId: expectedChatId,
      characterId: descriptor.characterId,
      officialIoContext: officialIoContext(traceContext, "SAVE_FINAL_SLOT_AUDIT"),
    });
    const finalExtractStartedAt = monotonicNow();
    const finalMessage = resolveOfficialOwnerMessage(finalState.messages, {
      messageIndex,
      expectedMessageId,
    }).message;
    const finalServerSlot = finalMessage
      ? readFloorSlot(finalMessage, targetSwipeId)
      : undefined;
    traceOfficialFloorExtract(
      finalState,
      officialIoContext(traceContext, "SAVE_FINAL_SLOT_AUDIT"),
      finalExtractStartedAt,
      {
        owner_message_index: messageIndex,
        owner_message_id: expectedMessageId,
        owner_swipe_id: targetSwipeId,
      },
    );
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
      writeFloorSlot(message, targetSwipeId, value);
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
  projectionTimingRandom = Math.random,
  healthRecoveryStabilityDelayMs = 2000,
  generationLeaseMs = 3000,
  generationStreamLeaseMs = 1500,
  generationHardWatchdogMs = 120000,
  participantAggregationLockCapability = false,
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
  const timingRandom = typeof projectionTimingRandom === 'function' ? projectionTimingRandom : Math.random;
  const timingRandomSource = timingRandom === Math.random
    ? 'RUNTIME_DEFAULT_MATH_RANDOM'
    : 'RUNTIME_INJECTED_RNG';
  const generationLeaseDurationMs = Number.isFinite(generationLeaseMs) && generationLeaseMs > 0
    ? generationLeaseMs
    : 3000;
  const generationStreamLeaseDurationMs = Number.isFinite(generationStreamLeaseMs) && generationStreamLeaseMs > 0
    ? generationStreamLeaseMs
    : 1500;
  const generationHardWatchdogDurationMs = Number.isFinite(generationHardWatchdogMs) && generationHardWatchdogMs > 0
    ? generationHardWatchdogMs
    : 120000;

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

  function recordNsfwPipelineStage(payload = {}) {
    try {
      diagnostics.recordNsfwPipelineStage?.(payload);
    } catch {
      // Diagnostic collection is fail-open and must not affect business flow.
    }
  }

  function startNsfwPipelineRun(payload = {}) {
    try {
      return diagnostics.startNsfwPipelineRun?.(payload) ?? null;
    } catch {
      return null;
    }
  }

  function finishNsfwPipelineRun(runId, payload = {}) {
    try {
      diagnostics.finishNsfwPipelineRun?.({run_id: runId, ...payload});
    } catch {
      // Diagnostic collection is fail-open and must not affect business flow.
    }
  }

  function startTimingPerformanceOperation(payload = {}) {
    try {
      return diagnostics.startTimingPerformanceOperation?.(payload) ?? null;
    } catch {
      return null;
    }
  }

  function recordTimingPerformanceStage(payload = {}) {
    try {
      diagnostics.recordTimingPerformanceStage?.(payload);
    } catch {
      // Performance diagnostics are fail-open and must not affect business flow.
    }
  }

  function recordTimingOfficialIo(payload = {}) {
    try {
      diagnostics.recordTimingOfficialIo?.(payload);
    } catch {
      // Official I/O diagnostics are fail-open and must not affect persistence.
    }
  }

  function finishTimingPerformanceOperation(payload = {}) {
    try {
      diagnostics.finishTimingPerformanceOperation?.(payload);
    } catch {
      // Performance diagnostics are fail-open and must not affect business flow.
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
    if (!versionChain && payload?.stage === "FLOOR_TX_CONTEXT_SOURCE_READ" &&
        payload?.actual_floor_version && typeof payload.actual_floor_version === "object") {
      versionChain = buildVersionChainDiagnostic({
        boundary: "CONTEXT_SOURCE_READ_BEFORE_WRITE",
        source_kind: "host_context",
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
    if (payload?.performance_operation_id &&
        (payload?.stage === "OFFICIAL_CHAT_IO" || payload?.stage === "OFFICIAL_FLOOR_EXTRACT")) {
      recordTimingOfficialIo({
        operation_id: payload.performance_operation_id,
        ...payload,
      });
    }
    if (payload?.performance_operation_id && payload?.stage === "BIOWEAVE_FULL_CHAT_SAVE_DISPATCHED") {
      recordTimingPerformanceStage({
        operation_id: payload.performance_operation_id,
        stage: "HOST_SAVE_INVOCATION",
        kind: "ASYNC",
        status: "ATTEMPTED",
        duration_ms: null,
        persistence_kind: payload.persistence_kind ?? null,
        reason_code: "HOST_SAVE_DISPATCHED",
      });
    }
    if (payload?.performance_operation_id && payload?.stage === "BIOWEAVE_FULL_CHAT_SAVE_RESOLVED") {
      recordTimingPerformanceStage({
        operation_id: payload.performance_operation_id,
        stage: "HOST_SAVE_AWAIT",
        kind: "ASYNC",
        status: payload.commit_state === "resolved" ? "SUCCEEDED" : "FAILED",
        duration_ms: Number.isFinite(payload.host_chat_save_duration_ms)
          ? payload.host_chat_save_duration_ms
          : null,
        host_save_duration_ms: Number.isFinite(payload.host_chat_save_duration_ms)
          ? payload.host_chat_save_duration_ms
          : null,
        persistence_kind: payload.persistence_kind ?? null,
        reason_code: payload.commit_state === "resolved"
          ? "HOST_SAVE_RESOLVED"
          : "HOST_SAVE_FAILED",
        error_code: payload.error_code ?? null,
      });
    }
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

  function resolveAssignedProfile(assignmentKey) {
    const settings = store.profileStore?.getSettings?.() ?? {};
    return resolveAssignedApiProfile({settings, profileStore: store.profileStore, assignmentKey});
  }

  function resolveEventAnalysisProfile() {
    return resolveAssignedProfile('event_analysis');
  }

  function resolveProjectionProfile() {
    return resolveAssignedProfile('projection');
  }

  const eventAnalyzer =
    analyzer ??
    createAnalyzer({
      profileResolver: task => (task === 'storyline' || task === 'projection'
        ? resolveProjectionProfile()
        : resolveEventAnalysisProfile()),
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
    performanceStage: payload => recordTimingPerformanceStage(payload),
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
    commitFloorPatch: async (target, owner, patch, input = {}) => {
      const result = await floorPersistence.commitFloorPatch({
        owner,
        chatId: target?.version?.chat_id ?? chat.current(),
        ownerFloor: {message_index: target?.index, message_id: target?.version?.message_id},
        swipeId: target?.swipeId ?? target?.version?.swipe_id ?? 0,
        floorVersion: target?.version,
        patch,
        operation_type: input.operation_type ?? `${owner}-patch`,
        execution: input.execution,
        assertCurrent: input.assertCurrent,
      });
      if (owner === "health") {
        eventAnalysis?.invalidateCanonicalDerivedReads?.(
          `confirmed:health:${input.operation_type ?? "patch"}`,
          target,
        );
      }
      return result;
    },
    assertExecutionTargetCurrent: (...args) => eventAnalysis?.assertExecutionTargetCurrent?.(...args),
    getPreviousTimeline: target => eventAnalysis?.resolveHealthAssessmentTimelineAtOrBefore?.(target, {strictBefore: true}),
    trace: payload => recordPersistenceTrace(payload),
  });
  const healthEvolution = createHealthEvolutionRuntime();
  const pregnancyLifecyclePersistence = createPregnancyLifecyclePersistence({
    store,
    enabledResolver: isBioWeaveEnabled,
    floorPersistence,
    resolveCurrentFloorVersion: async ({ownerFloor}) => {
      const index = ownerFloor?.message_index ?? ownerFloor?.messageIndex ?? ownerFloor?.index;
      if (!Number.isInteger(Number(index)) || !eventAnalysis?.resolveCurrentBioWeaveFloor) return null;
      return (await eventAnalysis.resolveCurrentBioWeaveFloor({__messageIndex: true, index: Number(index)})).version;
    },
  });
  const pregnancyKnowledgePersistence = createPregnancyKnowledgePersistence({
    store,
    enabledResolver: isBioWeaveEnabled,
    floorPersistence,
    resolveCurrentFloorVersion: async ({ownerFloor}) => {
      const index = ownerFloor?.message_index ?? ownerFloor?.messageIndex ?? ownerFloor?.index;
      if (!Number.isInteger(Number(index)) || !eventAnalysis?.resolveCurrentBioWeaveFloor) return null;
      return (await eventAnalysis.resolveCurrentBioWeaveFloor({__messageIndex: true, index: Number(index)})).version;
    },
  });
  const pregnancyKnowledgeRuntime = createPregnancyKnowledgeRuntime({
    persistence: pregnancyKnowledgePersistence,
    trace: payload => recordPersistenceTrace(payload),
  });
  const resolvePregnancyKnowledgeProjectionAtFloor = async ({target, chatId = target?.version?.chat_id} = {}) => {
    if (!target?.version || !chatId) return [];
    const snapshot = await pregnancyKnowledgePersistence.getSnapshot({
      chatId,
      endpointIndex: target.index,
      endpointFloor: target.version.floor,
    });
    if (!snapshot) return [];
    const floorData = store.getFloor(target.index, target.swipeId) ?? null;
    const projection = await pregnancyKnowledgeRuntime.getPromptProjection({
      snapshot,
      registry: floorData?.character_registry,
      events: floorData?.events,
    });
    return projection.map(item => ({
      subject_id: item.subject_id,
      subject_display_name: item.subject.display_name,
      knower_display_names: item.knowers.map(knower => knower.display_name),
    })).filter(item => item.subject_id && item.subject_display_name && item.knower_display_names.length);
  };
  async function resolveLockedExposureState({target = null} = {}) {
    if (participantAggregationLockCapability !== true) {
      return {lifecycleArchiveReleaseReady: false, lockedCycleKeys: []};
    }
    const resolvedTarget = target ?? await eventAnalysis?.resolveCurrentBioWeaveFloor?.();
    if (!resolvedTarget?.version || !participantAggregationPersistence) {
      return {lifecycleArchiveReleaseReady: false, lockedCycleKeys: []};
    }
    const floor = store.getFloor(resolvedTarget.index, resolvedTarget.swipeId);
    let aggregationReadback;
    try {
      aggregationReadback = await participantAggregationPersistence.getParticipantAggregations({
        chatId: resolvedTarget.version.chat_id,
        endpointFloor: resolvedTarget.version.floor,
        endpointIndex: resolvedTarget.index,
      });
    } catch {
      return {lifecycleArchiveReleaseReady: false, lockedCycleKeys: []};
    }
    const lifecycleTimeline = normalizePregnancyLifecycleTimeline(floor?.pregnancy_lifecycle_timeline);
    return {
      lifecycleArchiveReleaseReady: true,
      lockedCycleKeys: [...resolveCycleLocks({
        aggregations: aggregationReadback?.items ?? [],
        lifecycleFacts: lifecycleTimeline.facts,
        releaseRecords: lifecycleTimeline.release_records,
        lifecycleArchiveReleaseReady: true,
      })],
    };
  }
  async function buildLifecycleDebugData() {
    let target;
    try {
      target = await eventAnalysis.resolveCurrentBioWeaveFloor();
    } catch (error) {
      return {status: 'unavailable', reason: error?.code ?? error?.message ?? 'NO_CHARACTER_FLOOR'};
    }
    const chatId = target.version.chat_id;
    const endpointFloor = target.version.floor;
    try {
      const [aggregations, lifecycle, deliveries, projections, lock, projectionTiming] = await Promise.all([
        participantAggregationPersistence.getParticipantAggregations({chatId, endpointFloor, endpointIndex: target.index}),
        pregnancyLifecyclePersistence.getTimeline({chatId, endpointFloor, endpointIndex: target.index}),
        projectionPersistence.getProjectionDeliveryRecords({chatId, endpointFloor, endpointIndex: target.index}),
        projectionPersistence.getProjectionViews({chatId, endpointFloor, endpointIndex: target.index}),
        resolveLockedExposureState({target}),
        getProjectionTimingDebug(),
      ]);
      const business = await eventAnalysis.collectActiveBusinessData();
      const activeEvents = Array.isArray(business?.active_events) ? business.active_events : [];
      const currentStoryTime = projectionTiming?.current_story_time ?? business?.current_story_time ?? null;
      const storyDays = (from, to) => {
        const difference = differenceStoryTime(to, from);
        return difference?.unit === 'day' && Number.isFinite(Number(difference.value)) ? Number(difference.value) : null;
      };
      const lifecycleReleaseFor = item => lifecycle.release_records.find(record =>
        record?.subject_id === item?.subject_id &&
        (record?.pregnancy_id ?? null) === (item?.pregnancy_id ?? null) &&
        record?.cycle_id === item?.cycle_id &&
        record?.action === 'cycle-lock-released',
      ) ?? null;
      const aggregationDiagnostics = Array.isArray(projectionTiming?.aggregation_diagnostics)
        ? projectionTiming.aggregation_diagnostics
        : [];
      const observationBoundary = aggregations.items.map(item => {
        const diagnostic = aggregationDiagnostics.find(entry => entry?.aggregation_id === item.aggregation_id) ?? null;
        const mechanismKey = item.mechanism_key ?? diagnostic?.mechanism_key ?? null;
        const acceptedIds = [...(item.accepted_exposure_event_ids ?? [])];
        const release = lifecycleReleaseFor(item);
        const referenceStoryTime = cloneValue(
          item.reference_story_time
            ?? diagnostic?.first_exposure_story_time
            ?? item.aggregation_story_time
            ?? null,
        );
        const currentExposureEventIds = activeEvents.filter(event => {
          try {
            return isPregnancyRelevantExposure(event) &&
              event?.pregnancy_relevance?.gestational_subject_ids?.includes(item.subject_id) &&
              Boolean(mechanismKey) && event?.pregnancy_relevance?.reproductive_mechanism?.kind === mechanismKey;
          } catch { return false; }
        }).map(event => event.event_id).filter(Boolean);
        const excludedAfterAggregationEventIds = item.status === 'succeeded' && !release
          ? currentExposureEventIds.filter(eventId => !acceptedIds.includes(eventId)).filter(eventId => {
              const event = activeEvents.find(candidate => candidate?.event_id === eventId);
              const elapsed = storyDays(referenceStoryTime, event?.story_time);
              return elapsed !== null && elapsed > 0 && isExposureBlockedByParticipantAggregation({
                event,
                subjectId: item.subject_id,
                mechanismKey,
                participantAggregations: [item],
                lifecycleReleaseRecords: lifecycle.release_records,
              });
            })
          : [];
        const deletion = lifecycle.release_records.find(record =>
          record?.subject_id === item?.subject_id &&
          (record?.pregnancy_id ?? null) === (item?.pregnancy_id ?? null) &&
          record?.cycle_id === item?.cycle_id &&
          record?.action === 'old-exposure-deleted',
        ) ?? null;
        const elapsedStoryDays = storyDays(referenceStoryTime, currentStoryTime);
        const effectiveMax = Number.isFinite(Number(item.effective_max_story_days)) ? Number(item.effective_max_story_days) : null;
        const timedOut = effectiveMax !== null && elapsedStoryDays !== null && elapsedStoryDays > effectiveMax;
        const timeoutStatus = release
          ? release.closure_reason === 'timeout_no_pregnancy'
            ? 'released/timeout_no_pregnancy'
            : 'released/terminal_lifecycle'
          : timedOut
            ? 'due/overdue_not_released'
            : 'waiting/not_due';
        return {
          aggregation_id: item.aggregation_id,
          subject_id: item.subject_id,
          mechanism_key: mechanismKey,
          cycle_id: item.cycle_id,
          pregnancy_id: item.pregnancy_id ?? null,
          floor_version: cloneValue(item.created_at_floor_version ?? target.version),
          freeze_status: release ? 'RELEASED' : item.status === 'succeeded' ? 'FROZEN' : 'NOT_FROZEN',
          reference_story_time: referenceStoryTime,
          accepted_exposure_event_ids: acceptedIds,
          current_exposure_event_ids: currentExposureEventIds,
          excluded_after_aggregation_event_ids: excludedAfterAggregationEventIds,
          excluded_after_aggregation_reason: excludedAfterAggregationEventIds.length ? 'POST_AGGREGATION_CYCLE_FROZEN' : null,
          effective_max_story_days: item.effective_max_story_days ?? null,
          timeout_status: timeoutStatus,
          closure_reason: release?.closure_reason ?? null,
          release_action: release?.action ?? null,
          deleted_event_count: deletion?.deleted_event_ids?.length ?? null,
        };
      });
      const projectionIds = new Set((projections?.all ?? []).map(item => item?.projection_id).filter(Boolean));
      return {
        status: 'ready',
        target: {chat_id: chatId, floor: target.version.floor, swipe_id: target.version.swipe_id, floor_version: cloneValue(target.version)},
        participant_aggregation: {
          count: aggregations.items.length,
          aggregations: aggregations.items.map(item => ({
            aggregation_id: item.aggregation_id,
            subject_id: item.subject_id,
            pregnancy_id: item.pregnancy_id ?? null,
            mechanism_key: item.mechanism_key,
            cycle_id: item.cycle_id,
            status: item.status,
            accepted_exposure_count: item.accepted_exposure_event_ids.length,
            accepted_exposure_event_ids: [...item.accepted_exposure_event_ids],
            aggregation_story_time: cloneValue(item.aggregation_story_time),
            effective_min_story_days: item.effective_min_story_days,
            effective_max_story_days: item.effective_max_story_days,
            aggregation_trigger_strategy: item.aggregation_trigger_strategy,
            freeze_status: lifecycleReleaseFor(item) ? 'RELEASED' : item.status === 'succeeded' ? 'FROZEN' : 'NOT_FROZEN',
            created_at_floor_version: cloneValue(item.created_at_floor_version ?? null),
          })),
        },
        observation_boundary: {
          floor_version: cloneValue(target.version),
          current_story_time: cloneValue(currentStoryTime),
          aggregations: observationBoundary,
        },
        projection_delivery: {
          count: deliveries.length,
          records: deliveries.map(item => ({
            delivery_id: item.delivery_id,
            projection_id: item.projection_id,
            projection_present: projectionIds.has(item.projection_id),
            aggregation_id: item.aggregation_id,
            subject_id: item.subject_id,
            pregnancy_id: item.pregnancy_id ?? null,
            cycle_id: item.cycle_id,
            status: item.status,
            submitted_floor_version: cloneValue(item.submitted_floor_version),
            response_floor_version: cloneValue(item.response_floor_version),
            response_id: item.response_id ?? null,
            analysis_status: item.analysis_status ?? null,
            explicit_lifecycle_fact_ids: [...(item.explicit_lifecycle_fact_ids ?? [])],
          })),
        },
        pregnancy_lifecycle: {
          facts: lifecycle.facts.map(item => ({
            fact_id: item.fact_id,
            subject_id: item.subject_id,
            pregnancy_id: item.pregnancy_id ?? null,
            cycle_id: item.cycle_id,
            status: item.status,
            source_event_id: item.source_event_id,
            source_floor_version: cloneValue(item.source_floor_version),
          })),
          archives: lifecycle.archives.map(item => ({
            archive_id: item.archive_id,
            subject_id: item.subject_id,
            pregnancy_id: item.pregnancy_id ?? null,
            cycle_id: item.cycle_id,
            terminal_status: item.terminal_status,
            closure_reason: item.closure_reason,
            accepted_exposure_count: item.accepted_exposure_event_ids.length,
            source_event_ids: [...item.source_event_ids],
          })),
          candidate_records: lifecycle.candidate_records.map(item => ({
            candidate_record_id: item.candidate_record_id,
            subject_id: item.subject_id,
            pregnancy_id: item.pregnancy_id ?? null,
            cycle_id: item.cycle_id,
            father_status: item.father_status,
            candidate_count: Array.isArray(item.candidates) ? item.candidates.length : 0,
            source_exposure_count: item.source_exposure_event_ids.length,
          })),
          release_records: lifecycle.release_records.map(item => ({
            operation_key: item.operation_key,
            action: item.action,
            subject_id: item.subject_id,
            pregnancy_id: item.pregnancy_id ?? null,
            cycle_id: item.cycle_id,
            closure_reason: item.closure_reason ?? null,
            deleted_event_count: Array.isArray(item.deleted_event_ids) ? item.deleted_event_ids.length : null,
          })),
        },
        nsfw_lock: {
          capability_enabled: participantAggregationLockCapability === true,
          gate: participantAggregationLockCapability === true ? 'test_or_isolated_capability' : PARTICIPANT_AGGREGATION_LOCK_DISABLED,
          locked_cycle_keys: [...(lock.lockedCycleKeys ?? [])],
          lifecycle_archive_release_ready: lock.lifecycleArchiveReleaseReady === true,
        },
        projection_timing: projectionTiming,
      };
    } catch (error) {
      return {status: 'unavailable', reason: error?.code ?? error?.message ?? 'LIFECYCLE_DEBUG_UNAVAILABLE'};
    }
  }
  function buildNsfwPipelineDiagnostics({business = {}, projection = {}, lifecycleRuntime = {}} = {}) {
    const floorVersion = business?.current_floor?.version
      ?? lifecycleRuntime?.target?.floor_version
      ?? null;
    const chatId = floorVersion?.chat_id ?? chat.current();
    const projectionTiming = lifecycleRuntime?.projection_timing ?? {};
    let executionTrace = projectionTiming.execution_trace ?? null;
    if (!executionTrace || typeof executionTrace !== 'object') {
      try {
        executionTrace = diagnostics.getNsfwPipelineDiagnostics({
          chat_id: chatId,
          ...(floorVersion ? {floor_version: floorVersion} : {}),
        });
      } catch {
        executionTrace = {
          source_type: 'EXECUTION_TRACE',
          collection_status: 'FAILED',
          trace_truncated: null,
          trace_buffer_status: 'UNKNOWN',
          current_run_id: null,
          runs: [],
          stages: [],
        };
      }
    }
    const stages = Array.isArray(executionTrace?.stages) ? [...executionTrace.stages] : [];
    const runs = Array.isArray(executionTrace?.runs) ? [...executionTrace.runs] : [];
    const currentRunId = executionTrace?.current_run_id ?? runs.at(-1)?.run_id ?? null;
    const currentRunStages = stages
      .filter(stage => currentRunId ? stage?.run_id === currentRunId : !stage?.run_id)
      .sort((left, right) => Number(left?.sequence ?? 0) - Number(right?.sequence ?? 0));
    const latestRun = runs.find(run => run?.run_id === currentRunId) ?? runs.at(-1) ?? null;
    const readbackDiagnostic = projectionTiming?.readback_diagnostic ?? null;
    const blockingStatuses = new Set(['BLOCKED', 'FAILED', 'PERSIST_FAILED', 'READBACK_FAILED']);
    const nonProgressReasons = new Set(['READBACK_DEFERRED_TO_CURRENT_STATE']);
    const nonBlockingNotInvokedReasons = new Set(['TIMING_INSTANCE_EXISTS', 'READBACK_DEFERRED_TO_CURRENT_STATE']);
    const isBlockingStage = stage =>
      !nonProgressReasons.has(stage?.reason_code) &&
      (blockingStatuses.has(stage?.execution_status) ||
        (stage?.execution_status === 'NOT_INVOKED' && stage?.invoked === false && !nonBlockingNotInvokedReasons.has(stage?.reason_code)) ||
        (stage?.execution_status === 'SKIPPED' && stage?.invoked === true));
    const currentBlockingStage = currentRunStages.find(isBlockingStage);
    // A refresh can expose a newer ATTEMPTED run while its post-processing
    // stage is still being recorded. Keep the latest run as the current
    // execution identity, but do not hide the last concrete blocker already
    // recorded for this Floor in that short diagnostic window.
    const priorBlockingStage = !currentBlockingStage && latestRun?.execution_status === 'ATTEMPTED'
      ? (() => {
        for (const run of [...runs].reverse()) {
          if (!run?.run_id || run.run_id === currentRunId) continue;
          const stage = stages
            .filter(item => item?.run_id === run.run_id)
            .sort((left, right) => Number(left?.sequence ?? 0) - Number(right?.sequence ?? 0))
            .find(isBlockingStage);
          if (stage) return stage;
        }
        return [...stages].reverse().find(stage => stage?.run_id !== currentRunId && isBlockingStage(stage)) ?? null;
      })()
      : null;
    const blockingStage = currentBlockingStage
      ?? priorBlockingStage
      ?? (blockingStatuses.has(readbackDiagnostic?.execution_status) ? readbackDiagnostic : null);
    const timingDiagnostics = Array.isArray(projectionTiming.timing_diagnostics)
      ? projectionTiming.timing_diagnostics
      : [];
    const aggregationDiagnostics = Array.isArray(projectionTiming.aggregation_diagnostics)
      ? projectionTiming.aggregation_diagnostics
      : [];
    const lock = lifecycleRuntime?.nsfw_lock ?? {};
    const trackingWindows = Array.isArray(business?.tracking_windows) ? business.tracking_windows : [];
    const activeEvents = Array.isArray(business?.active_events) ? business.active_events : [];
    const validExposureEvents = activeEvents.filter(event => {
      try { return isPregnancyRelevantExposure(event); } catch { return false; }
    });
    const eventCount = Array.isArray(business?.active_events) ? business.active_events.length : null;
    const timingCount = Number.isFinite(projectionTiming?.authoritative_readback?.timing_instance_count)
      ? projectionTiming.authoritative_readback.timing_instance_count
      : null;
    const aggregationCount = Number.isFinite(projectionTiming?.authoritative_readback?.aggregation_count)
      ? projectionTiming.authoritative_readback.aggregation_count
      : Number.isFinite(lifecycleRuntime?.participant_aggregation?.count)
        ? lifecycleRuntime.participant_aggregation.count
        : null;
    const projectionCount = Array.isArray(projection?.projections)
      ? projection.projections.length
      : null;
    const currentState = {
      source_type: 'CURRENT_STATE',
      plugin_enabled: (() => {
        try { return isBioWeaveEnabled() === true; } catch { return null; }
      })(),
      chat_id: chatId,
      floor_version: cloneValue(floorVersion),
      event_count: eventCount,
      authoritative_exposure_count: validExposureEvents.length,
      pregnancy_relevant_exposure_count: validExposureEvents.length,
      candidate_subject_ids: [...new Set(validExposureEvents.flatMap(event => event?.pregnancy_relevance?.gestational_subject_ids ?? []))].sort(),
      candidate_mechanism_keys: [...new Set(validExposureEvents.map(event => event?.pregnancy_relevance?.reproductive_mechanism?.kind).filter(Boolean))].sort(),
      tracking_subject_count: Object.keys(business?.tracking_subjects ?? {}).length,
      tracking_window_count: trackingWindows.length,
      tracking_window_status_counts: Object.fromEntries(
        [...new Set(trackingWindows.map(window => window?.status).filter(Boolean))]
          .map(status => [status, trackingWindows.filter(window => window?.status === status).length]),
      ),
      timing_instance_count: timingCount,
      participant_aggregation_count: aggregationCount,
      projection_count: projectionCount,
      projection_rules_count: projectionTiming?.timing_runtime?.projection_rules_count ?? null,
      projection_rules_available: projectionTiming?.timing_runtime?.projection_rules_available ?? null,
      nsfw_lock: {
        capability_enabled: lock.capability_enabled ?? null,
        gate: lock.gate ?? null,
        lifecycle_archive_release_ready: lock.lifecycle_archive_release_ready ?? null,
      },
    };
    const derived = {
      source_type: 'DERIVED_DIAGNOSTIC',
      current_run_id: currentRunId,
      current_execution_status: latestRun?.execution_status
        ?? blockingStage?.execution_status
        ?? (stages.length ? 'UNKNOWN' : 'TRACE_UNAVAILABLE'),
      current_blocking_stage: blockingStage?.stage ?? (stages.length ? null : 'UNKNOWN'),
      current_blocking_reason_code: blockingStage?.reason_code ?? (stages.length ? null : 'TRACE_UNAVAILABLE'),
      current_blocking_error_code: blockingStage?.error_code ?? null,
      first_blocking_node_source: blockingStage
        ? blockingStage.source_type ?? (readbackDiagnostic ? 'DERIVED_DIAGNOSTIC' : 'EXECUTION_TRACE')
        : stages.length ? 'DERIVED_DIAGNOSTIC' : 'TRACE_UNAVAILABLE',
      trace_truncated: executionTrace?.trace_truncated ?? null,
      confidence: blockingStage
        ? blockingStage === readbackDiagnostic ? 'CONFIRMED_BY_READBACK_FAILURE' : 'CONFIRMED_BY_EXECUTION_TRACE'
        : executionTrace?.trace_truncated === true || !stages.length
          ? 'UNKNOWN'
          : 'NO_BLOCKING_STAGE_OBSERVED',
      latest_aggregation_attempt: [...aggregationDiagnostics]
        .filter(item => item?.last_attempt_at)
        .sort((left, right) => String(left.last_attempt_at).localeCompare(String(right.last_attempt_at)))
        .at(-1) ?? null,
      projection_rules_effect: projectionTiming?.timing_runtime?.projection_rules_effect ?? null,
      capability_flag_effect: {
        participant_aggregation_lock: lock.gate ?? null,
        aggregation_creation_control: 'NOT_CONTROLLED_BY_PARTICIPANT_AGGREGATION_LOCK',
        explanation: 'PARTICIPANT_AGGREGATION_LOCK_DISABLED 只影响周期锁定过滤，不决定名单聚合函数是否创建或保存结果。',
      },
    };
    return {
      diagnostics_schema_version: 1,
      diagnostic_sources: ['CURRENT_STATE', 'EXECUTION_TRACE', 'DERIVED_DIAGNOSTIC'],
      current_state: currentState,
      execution_trace: executionTrace,
      derived_diagnostic: derived,
      timing_diagnostics: timingDiagnostics,
      aggregation_diagnostics: aggregationDiagnostics,
      projection_diagnostics: projectionTiming?.projection_diagnostics ?? null,
      automatic_execution: {
        plugin_enabled: currentState.plugin_enabled,
        entry_registered: typeof eventAnalysis?.automaticAnalysis?.observeSettledCharacterFloor === 'function',
        latest_trigger: latestRun?.trigger ?? null,
        latest_run_id: currentRunId,
        current_chat_id: chatId,
        current_floor: Number.isFinite(floorVersion?.floor) ? floorVersion.floor : null,
        active_swipe_id: Number.isFinite(floorVersion?.swipe_id) ? floorVersion.swipe_id : null,
        current_floor_version: cloneValue(floorVersion),
        execution_status: latestRun?.execution_status ?? null,
        scheduling_stage: currentRunStages.find(stage => stage?.stage === 'PIPELINE_SCHEDULING') ?? null,
      },
    };
  }
  let projectionTimingPersistence = null;
  let participantAggregationPersistence = null;
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
    runtimeDiagnostics: diagnostics,
    globalRecentStoryResolver: () =>
      store.profileStore?.getSettings?.()?.recent_story_global ?? {},
    enabledResolver: isBioWeaveEnabled,
    notify,
    floorPersistence,
    healthAssessment,
    healthEvolution,
    healthRecoveryStabilityDelayMs,
    resolveLockedExposureState,
    getTrackingTimingInstances: ({chatId, endpointFloor, endpointIndex}) => projectionTimingPersistence?.getTimingInstances({chatId, endpointFloor, endpointIndex}),
    getTrackingParticipantAggregations: ({chatId, endpointFloor, endpointIndex}) => participantAggregationPersistence?.getParticipantAggregations({chatId, endpointFloor, endpointIndex}),
    getTrackingLifecycleTimeline: ({chatId, endpointFloor, endpointIndex}) => pregnancyLifecyclePersistence?.getTimeline({chatId, endpointFloor, endpointIndex}),
    pregnancyKnowledgeResolver: ({target}) => resolvePregnancyKnowledgeProjectionAtFloor({target}),
    persistPregnancyLifecycleFacts: async ({target, events}) => {
      const lifecycleFacts = [];
      for (const event of Array.isArray(events) ? events : []) {
        if (event?.type !== 'pregnancy_lifecycle' || event.status !== 'confirmed') continue;
        const payload = event?.state_fact?.payload ?? {};
        const fact = {
          fact_id: event.event_id,
          subject_id: event.state_fact?.subject_id,
          pregnancy_id: payload.status === 'not_pregnant' ? null : payload.pregnancy_id ?? null,
          cycle_id: payload.cycle_id,
          status: payload.status,
          source_event_id: event.event_id,
          evidence_refs: [event.event_id],
          source_floor_version: target.version,
        };
        await pregnancyLifecyclePersistence.appendFact({
          ownerFloor: {message_index: target.index, message_id: target.version.message_id},
          floorVersion: target.version,
          fact,
        });
        lifecycleFacts.push(fact);
      }
      for (const fact of lifecycleFacts) {
        if (!['not_pregnant', 'miscarriage', 'termination', 'delivery'].includes(fact.status)) continue;
        const aggregations = (await participantAggregationPersistence.getParticipantAggregations({chatId: target.version.chat_id, endpointFloor: target.version.floor, endpointIndex: target.index})).items;
        const aggregation = aggregations.find(item => item.subject_id === fact.subject_id && item.cycle_id === fact.cycle_id && (item.pregnancy_id ?? null) === (fact.pregnancy_id ?? null));
        if (!aggregation) continue;
        const evidence = buildParticipantAggregationEvidence({aggregation, events, subjectId: fact.subject_id});
        const candidateRecord = pregnancyLifecyclePersistence.buildCandidateRecord({
          subjectId: fact.subject_id,
          pregnancyId: fact.pregnancy_id,
          cycleId: fact.cycle_id,
          candidates: evidence?.participant_exposure_mapping ?? [],
          sourceExposureEventIds: aggregation.accepted_exposure_event_ids,
          participantMapping: evidence?.participant_exposure_mapping ?? [],
          projectionEvidence: [],
        });
        await pregnancyLifecyclePersistence.saveCandidateRecord({
          ownerFloor: {message_index: target.index, message_id: target.version.message_id},
          floorVersion: target.version,
          candidateRecord,
        });
        await pregnancyLifecyclePersistence.archiveAndRelease({
          ownerFloor: {message_index: target.index, message_id: target.version.message_id},
          floorVersion: target.version,
          fact,
          aggregation,
          candidateRecord,
          operationKey: `lifecycle:${fact.fact_id}`,
        });
      }
    },
    persistPregnancyKnowledgeCandidates: ({target, analysisInput, candidates, events, execution, token}) => pregnancyKnowledgeRuntime.processCandidates({target, analysisInput, candidates, events, execution, token}),
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
  projectionTimingPersistence = createProjectionTimingPersistence({
    store,
    enabledResolver: isBioWeaveEnabled,
    floorPersistence,
    performanceStage: payload => recordTimingPerformanceStage(payload),
    resolveCurrentFloorVersion: async ({ownerFloor}) => {
      const index = ownerFloor?.message_index ?? ownerFloor?.messageIndex ?? ownerFloor?.index;
      if (!Number.isInteger(Number(index))) return null;
      return (await eventAnalysis.resolveCurrentBioWeaveFloor({__messageIndex: true, index: Number(index)})).version;
    },
  });
  participantAggregationPersistence = createParticipantAggregationPersistence({
    store,
    enabledResolver: isBioWeaveEnabled,
    floorPersistence,
    performanceStage: payload => recordTimingPerformanceStage(payload),
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
    trace: payload => recordPersistenceTrace(payload),
    enabledResolver: isBioWeaveEnabled,
    collectActiveBusinessData: () => eventAnalysis.collectActiveBusinessData(),
    attributionResolver: createCurrentStateAttributionResolver({
      collectActiveBusinessData: () => eventAnalysis.collectActiveBusinessData(),
    }),
    recordStorylineSubmission: async payload => projectionStorylineRuntime?.recordSubmission?.(payload),
    projectionEvidenceResolver: async ({chatId, floor, views, businessData, businessDataError, businessDataResolved = false}) => {
      const projectionViews = Array.isArray(views?.all) ? views.all : (Array.isArray(views) ? views : []);
      const uniqueIds = values => [...new Set((Array.isArray(values) ? values : [])
        .map(value => typeof value === 'string' ? value.trim() : value == null ? null : String(value))
        .filter(Boolean))].slice(0, 128);
      const inputProjectionIds = uniqueIds(projectionViews.map(view => view?.projection_id));
      const inputSubjectIds = uniqueIds(projectionViews.map(view => view?.subject_id));
      const inputAggregationIds = uniqueIds(projectionViews.map(view => view?.aggregation_evidence?.aggregation_id));
      const aggregationProjection = projectionViews.some(view => view?.aggregation_path === 'participant_aggregation' || view?.aggregation_evidence);
      const recordResolution = ({status, reasonCode = null, decisions = [], aggregationIds = inputAggregationIds} = {}) => {
        const safeDecisions = decisions.map(decision => {
          const nonAggregation = decision?.reason_code === 'NON_AGGREGATION_PROJECTION';
          const resolvedReasonCode = reasonCode && !nonAggregation ? reasonCode : decision?.reason_code ?? null;
          return {
            projection_id: decision?.projection_id ?? null,
            subject_id: decision?.subject_id ?? null,
            aggregation_id: decision?.aggregation_id ?? null,
            status: decision?.valid === true ? 'VALID' : 'FILTERED',
            reason_code: resolvedReasonCode,
          };
        });
        const validIds = uniqueIds(safeDecisions.filter(item => item.status === 'VALID').map(item => item.projection_id));
        const filteredIds = uniqueIds(safeDecisions.filter(item => item.status === 'FILTERED').map(item => item.projection_id));
        try {
          recordPersistenceTrace({
            stage: 'PROJECTION_EVIDENCE_RESOLVED',
            chat_id: chatId,
            projection_evidence_status: status,
            projection_evidence_reason_code: reasonCode,
            projection_evidence_input_count: inputProjectionIds.length,
            projection_evidence_valid_count: validIds.length,
            projection_evidence_filtered_count: filteredIds.length,
            projection_evidence_input_ids: inputProjectionIds,
            projection_evidence_subject_ids: inputSubjectIds,
            projection_evidence_aggregation_ids: uniqueIds(aggregationIds),
            projection_evidence_valid_ids: validIds,
            projection_evidence_filtered_ids: filteredIds,
            projection_evidence_decisions: safeDecisions,
          });
        } catch {
          // Diagnostic collection is fail-open and must not affect context filtering.
        }
      };
      if (!aggregationProjection) {
        recordResolution({
          status: 'NO_AGGREGATION_PROJECTIONS',
          decisions: projectionViews.map(view => ({
            projection_id: view?.projection_id ?? null,
            subject_id: view?.subject_id ?? null,
            aggregation_id: null,
            valid: true,
            reason_code: 'NON_AGGREGATION_PROJECTION',
          })),
        });
        return views;
      }
      const filterWithDiagnostics = ({aggregations = [], events = [], status = 'VALIDATED', reasonCode = null} = {}) => {
        const decisions = [];
        const filtered = filterProjectionViewsByAggregationEvidence({
          views,
          aggregations,
          events,
          diagnosticCollector: decision => decisions.push(decision),
        });
        recordResolution({
          status: status === 'VALIDATED'
            ? decisions.some(decision => decision.valid !== true) ? 'FILTERED' : status
            : status,
          reasonCode,
          decisions,
          aggregationIds: [
            ...inputAggregationIds,
            ...(Array.isArray(aggregations) ? aggregations.map(item => item?.aggregation_id) : []),
          ],
        });
        return filtered;
      };
      try {
        const aggregationTimeline = await participantAggregationPersistence.getParticipantAggregations({chatId, endpointFloor: floor.version.floor, endpointIndex: floor.index});
        if (businessDataError) throw businessDataError;
        const business = businessDataResolved ? businessData : await eventAnalysis.collectActiveBusinessData();
        if (!business?.current_floor?.version || !sameFloorVersion(business.current_floor.version, floor.version)) {
          return filterWithDiagnostics({
            aggregations: [],
            events: [],
            status: 'FLOOR_VERSION_MISMATCH',
            reasonCode: 'CURRENT_EVIDENCE_UNAVAILABLE',
          });
        }
        return filterWithDiagnostics({
          aggregations: aggregationTimeline.items,
          events: business.active_events ?? [],
        });
      } catch {
        const decisions = projectionViews.map(view => ({
          projection_id: view?.projection_id ?? null,
          subject_id: view?.subject_id ?? null,
          aggregation_id: view?.aggregation_evidence?.aggregation_id ?? null,
          valid: !(view?.aggregation_path === 'participant_aggregation' || view?.aggregation_evidence),
          reason_code: view?.aggregation_path === 'participant_aggregation' || view?.aggregation_evidence
            ? 'CURRENT_EVIDENCE_UNAVAILABLE'
            : 'NON_AGGREGATION_PROJECTION',
        }));
        recordResolution({
          status: 'FAIL_CLOSED',
          reasonCode: 'RESOLVER_EXCEPTION_FAIL_CLOSED',
          decisions,
          aggregationIds: inputAggregationIds,
        });
        return filterProjectionViewsByAggregationEvidence({views, aggregations: [], events: []});
      }
    },
    recordProjectionSubmission: async ({chatId, floor, views, contextFingerprint, generation, performanceRunId = null}) => {
      const deliveryRecords = [];
      for (const view of (Array.isArray(views?.all) ? views.all : []).filter(item => item?.context_visible === true && item?.aggregation_evidence)) {
        const evidence = view.aggregation_evidence;
        deliveryRecords.push({
            projection_id: view.projection_id,
            aggregation_id: evidence.aggregation_id,
            subject_id: evidence.subject_id,
            pregnancy_id: evidence.pregnancy_id ?? null,
            cycle_id: evidence.cycle_id,
            submitted_floor_version: floor.version,
            created_at_floor_version: floor.version,
            context_fingerprint: contextFingerprint,
            generation_id: generation?.generation_id ?? generation?.generationId ?? null,
            generation_intent_id: generation?.generation_intent_id ?? generation?.generationIntentId ?? null,
        });
      }
      if (!deliveryRecords.length) return {status: 'readback_verified', records: []};
      const started = Date.now();
      try {
        const result = await projectionPersistence.saveProjectionDeliverySubmissionBatch({
          chatId,
          ownerFloor: {message_index: floor.index, message_id: floor.version.message_id},
          floorVersion: floor.version,
          records: deliveryRecords,
          traceContext: {context_fingerprint: contextFingerprint},
        });
        try {
          diagnostics.recordAutomaticProjectionStage?.({
            run_id: performanceRunId,
            stage: 'DELIVERY_SUBMISSION',
            status: 'SUCCEEDED',
            duration_ms: Math.max(0, Date.now() - started),
            call_count: 1,
            output_count: deliveryRecords.length,
          });
        } catch { /* fail-open */ }
        return {status: 'readback_verified', records: deliveryRecords.map(record => ({projection_id: record.projection_id, status: result.status}))};
      } catch (error) {
        try {
          diagnostics.recordAutomaticProjectionStage?.({
            run_id: performanceRunId,
            stage: 'DELIVERY_SUBMISSION',
            status: 'FAILED',
            duration_ms: Math.max(0, Date.now() - started),
            call_count: 1,
            output_count: deliveryRecords.length,
            error_code: error?.code ?? error?.message ?? 'DELIVERY_SUBMISSION_FAILED',
          });
        } catch { /* fail-open */ }
        throw error;
      }
    },
    healthGuidanceResolver: async ({chatId, floor, businessData, businessDataError, businessDataResolved = false}) => {
      if (businessDataError) throw businessDataError;
      const business = businessDataResolved ? businessData : await eventAnalysis.collectActiveBusinessData();
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
    pregnancyKnowledgeResolver: async ({chatId, floor}) => {
      return resolvePregnancyKnowledgeProjectionAtFloor({target: floor, chatId});
    },
    trace: recordPersistenceTrace,
  });
  const projectionStorylineRuntime = typeof eventAnalyzer.generateStoryline === 'function' ? createProjectionStorylineRuntime({
    analyzer: eventAnalyzer,
    getProjectionViews: projectionPersistence.getProjectionViews,
    saveProjectionStorylineSnapshotBatch: projectionPersistence.saveProjectionStorylineSnapshotBatch,
    saveProjectionStorylineDelivery: projectionPersistence.saveProjectionStorylineDelivery,
    archiveAndReleasePregnancy: pregnancyLifecyclePersistence.archiveAndRelease,
    readStoryBodyByFloorVersion: async version => {
      const snapshot = store.getCurrentChatOwnerSnapshot(version?.chat_id);
      // SillyTavern messages do not always carry a host message_id.  In that
      // shape the Floor version uses the chat-array index as its canonical
      // message_id (the same fallback used by messageIdForFloor()).  Looking
      // only at message.message_id/message.id therefore made every historical
      // response body look inactive and prevented the Judge API from ever
      // being reached.
      const index = resolveStorylineBodyMessageIndex(snapshot.messages, version);
      if (index < 0 || store.getActiveSwipeId?.(index) !== Number(version?.swipe_id)) throw new Error('STORYLINE_BODY_FLOOR_NOT_ACTIVE');
      const swipeId = Number(version.swipe_id);
      const floorData = store.getFloor(index, swipeId);
      const storedVersion = floorData?.floor_version;
      if (!storedVersion || ['chat_id', 'message_id', 'floor', 'swipe_id'].some(field => String(storedVersion[field]) !== String(version[field]))) throw new Error('STORYLINE_BODY_FLOOR_STALE');
      const message = snapshot.messages[index];
      if (hasSwipeStructure(message)) {
        const activeSwipeId = Number.isInteger(message?.swipe_id) ? message.swipe_id : 0;
        return message?.swipes?.[swipeId]
          ?? message?.swipe_info?.[swipeId]?.mes
          ?? (swipeId === activeSwipeId ? message?.mes ?? message?.content ?? '' : '');
      }
      return message?.mes ?? message?.content ?? '';
    },
    resolveCurrentFloor: eventAnalysis.resolveCurrentBioWeaveFloor,
    getChatId: () => chat.current(),
    enabledResolver: isBioWeaveEnabled,
    requestSettingsResolver: () => store.profileStore?.getApiRequestSettings?.() ?? {},
    diagnostics,
    trace: payload => recordPersistenceTrace(payload),
  }) : null;
  const projectionRuntime = createProjectionRuntime({
    analyzer: eventAnalyzer,
    enabledResolver: isBioWeaveEnabled,
    getChatId: () => chat.current(),
    collectInputs: async () => {
      const floor = await eventAnalysis.resolveCurrentBioWeaveFloor();
      const business = await eventAnalysis.collectActiveBusinessData();
      const storylineContext = await eventAnalysis.getStorylineContext();
      const storylineReferenceCharacters = Object.values(storylineContext?.character_registry?.entities ?? {})
        .map(entity => ({
          display_name: typeof entity?.display_name === 'string' ? entity.display_name : '',
          aliases: Array.isArray(entity?.aliases) ? entity.aliases : [],
        }))
        .filter(entity => entity.display_name || entity.aliases.length);
      const world = await eventAnalysis.resolveWorldModelAtOrBefore({
        __messageIndex: true,
        index: floor.index,
      });
      return {
        floor,
        businessData: business,
        currentState: business.current_state,
        characterProfiles: business.character_profiles,
        currentStateStatus: business.current_state_status,
        events: business.active_events ?? [],
        sourceCandidates: Object.values(business.tracking_candidates ?? {}),
        trackingWindows: business.tracking_windows ?? [],
        worldModel: world?.model ?? {},
        worldbooks: storylineContext?.worldbooks ?? [],
        externalMemory: storylineContext?.external_memory ?? [],
        otherReferenceData: {
          known_characters: storylineReferenceCharacters,
        },
        currentStoryTime: business.current_story_time ?? null,
        // Keep the current Character Floor and bounded history structured until
        // the Prompt Context port renders them. Only presentation-safe fields
        // cross this boundary; host message/swipe identifiers stay internal.
        // `recent_story.items` is already bounded and processed by the shared
        // recent-story port according to Settings -> 最近剧情.floor_count.
        // Do not prepend current_floor here: that would make the storyline
        // prompt exceed the configured count and would duplicate the endpoint
        // floor when it is already included in the bounded collection.
        storyContext: (storylineContext?.recent_story?.items ?? []).map(item => ({
            floor: item?.floor,
            role: item?.role ?? 'assistant',
            content: item?.content ?? item?.narrative ?? '',
          })).filter(item => item?.content),
        storyContextFloorCount: Number.isFinite(Number(storylineContext?.recent_story?.floor_count))
          ? Math.max(0, Math.trunc(Number(storylineContext.recent_story.floor_count)))
          : null,
        participantAggregations: (await participantAggregationPersistence.getParticipantAggregations({chatId: floor.version.chat_id, endpointFloor: floor.version.floor, endpointIndex: floor.index})).items,
        pregnancyLifecycleTimeline: await pregnancyLifecyclePersistence.getTimeline({chatId: floor.version.chat_id, endpointFloor: floor.version.floor, endpointIndex: floor.index}),
        deleteProjection: projectionPersistence.deleteProjection,
      };
    },
    resolveCurrentFloor: eventAnalysis.resolveCurrentBioWeaveFloor,
    getProjectionViews: projectionPersistence.getProjectionViews,
    saveProjectionBatch: projectionPersistence.saveProjectionBatch,
    saveProjectionObservationBatch: projectionPersistence.saveProjectionObservationBatch,
    saveProjectionTriggeredSnapshotBatch: projectionPersistence.saveProjectionTriggeredSnapshotBatch,
    ensureProjectionFloorOwner: ({target, reason, trigger}) =>
      eventAnalysis.ensureCurrentProjectionFloorOwner({target, reason, trigger}),
    saveProjectionLifecycleBatch: projectionPersistence.saveProjectionLifecycleBatch,
    saveProjectionDeliveryResponseBatch: projectionPersistence.saveProjectionDeliveryResponseBatch,
    saveProjectionDeliveryResponse: projectionPersistence.saveProjectionDeliveryResponse,
    getProjectionDeliveryRecords: projectionPersistence.getProjectionDeliveryRecords,
    archiveAndReleasePregnancy: pregnancyLifecyclePersistence.archiveAndRelease,
    storylineRuntime: projectionStorylineRuntime,
    diagnostics,
    saveEvolutionDecision: projectionPersistence.saveEvolutionDecision,
    resolvePreConfirmationTiming: async ({inputs, run_id: pipelineRunId = null}) => {
      const timeline = await projectionTimingPersistence.getTimingInstances({chatId: inputs.floor.version.chat_id, endpointFloor: inputs.floor.version.floor, endpointIndex: inputs.floor.index});
      const aggregationTimeline = await participantAggregationPersistence.getParticipantAggregations({chatId: inputs.floor.version.chat_id, endpointFloor: inputs.floor.version.floor, endpointIndex: inputs.floor.index});
      const lifecycleReleaseRecords = Array.isArray(inputs.pregnancyLifecycleTimeline?.release_records)
        ? inputs.pregnancyLifecycleTimeline.release_records
        : [];
      const rules = Array.isArray(inputs.worldModel?.projection_rules) ? inputs.worldModel.projection_rules : [];
      const events = Array.isArray(inputs.events) ? inputs.events : [];
      const timingInstances = [...timeline.items];
      let timingEnabled = timingInstances.length > 0;
      const floorVersion = inputs.floor?.version ?? null;
      // Timing is anchored by factual Exposure, while World Model rules remain
      // authoritative only for Projection Eligibility/AI.  In particular, an
      // empty rules collection must not erase a valid pre-confirmation cycle.
      const relevantExposureEvents = events.filter(event => {
        try {
          return isPregnancyRelevantExposure(event)
            && Array.isArray(event?.pregnancy_relevance?.gestational_subject_ids)
            && event.pregnancy_relevance.gestational_subject_ids.every(subjectId => typeof subjectId === "string" && subjectId.trim() !== '')
            && typeof event?.pregnancy_relevance?.reproductive_mechanism?.kind === "string"
            && event.pregnancy_relevance.reproductive_mechanism.kind.trim() !== ''
            && event.pregnancy_relevance.gestational_subject_ids.every(subjectId => !isExposureBlockedByParticipantAggregation({
              event,
              subjectId,
              mechanismKey: event.pregnancy_relevance.reproductive_mechanism.kind,
              participantAggregations: aggregationTimeline.items,
              lifecycleReleaseRecords,
            }));
        } catch {
          return false;
        }
      });
      const timingCandidateTargets = new Set();
      const timingTargetKey = (subjectId, mechanismKey, trackingWindowId = null) =>
        [subjectId, mechanismKey, trackingWindowId ?? ""].map(value => String(value ?? "")).join("\u001f");
      recordNsfwPipelineStage({
        stage: "EVENT_SNAPSHOT_RESOLUTION",
        execution_status: "SUCCEEDED",
        reason_code: "CURRENT_FLOOR_SNAPSHOT_RESOLVED",
        invoked: true,
        run_id: pipelineRunId,
        chat_id: floorVersion?.chat_id ?? null,
        floor_version: floorVersion,
        input_count: events.length,
        output_count: events.length,
        candidate_exposure_event_ids: relevantExposureEvents.map(event => event.event_id),
        source_type: "EXECUTION_TRACE",
      });
      const excludedExposureReasons = events.map(event => {
        if (!event?.event_id || relevantExposureEvents.includes(event)) return null;
        const relevance = event?.pregnancy_relevance;
        const reasonCode = relevance?.relevant !== true
          ? "PREGNANCY_RELEVANCE_FALSE"
          : !Array.isArray(relevance?.gestational_subject_ids) || !relevance.gestational_subject_ids.length
            ? "GESTATIONAL_SUBJECT_ID_INVALID"
            : typeof relevance?.reproductive_mechanism?.kind !== "string" || !relevance.reproductive_mechanism.kind.trim()
              ? "REPRODUCTIVE_MECHANISM_INVALID"
              : "EXPOSURE_VALIDATION_FAILED";
        return {event_id: event.event_id, reason_code: reasonCode};
      }).filter(Boolean);
      recordNsfwPipelineStage({
        stage: "EXPOSURE_CLASSIFICATION",
        execution_status: "SUCCEEDED",
        reason_code: "EXPOSURE_INPUTS_CLASSIFIED",
        invoked: true,
        run_id: pipelineRunId,
        chat_id: floorVersion?.chat_id ?? null,
        floor_version: floorVersion,
        input_count: events.length,
        output_count: relevantExposureEvents.length,
        candidate_exposure_event_ids: relevantExposureEvents.map(event => event.event_id),
        candidate_subject_ids: [...new Set(relevantExposureEvents.flatMap(event => event?.pregnancy_relevance?.gestational_subject_ids ?? []))],
        candidate_mechanism_keys: [...new Set(relevantExposureEvents.map(event => event?.pregnancy_relevance?.reproductive_mechanism?.kind).filter(Boolean))],
        excluded_candidate_reasons: excludedExposureReasons,
        source_type: "EXECUTION_TRACE",
      });
      recordNsfwPipelineStage({
        stage: "TRACKING_WINDOW_RESOLUTION",
        execution_status: "SUCCEEDED",
        reason_code: "TRACKING_WINDOW_INPUTS_RESOLVED",
        invoked: true,
        run_id: pipelineRunId,
        chat_id: floorVersion?.chat_id ?? null,
        floor_version: floorVersion,
        input_count: Array.isArray(inputs.trackingWindows) ? inputs.trackingWindows.length : 0,
        output_count: Array.isArray(inputs.trackingWindows) ? inputs.trackingWindows.length : 0,
        source_type: "EXECUTION_TRACE",
      });
      const confirmedSubjects = events.filter(event => event?.type === 'pregnancy_confirmation' && event.status === 'confirmed').flatMap(event => event?.state_fact?.subject_id ? [event.state_fact.subject_id] : (event?.pregnancy_relevance?.gestational_subject_ids ?? []));
      const terminatedSubjects = events.filter(event => ['pregnancy_loss', 'abortion'].includes(event?.type) && event.status === 'confirmed').flatMap(event => event?.state_fact?.subject_id ? [event.state_fact.subject_id] : (event?.pregnancy_relevance?.gestational_subject_ids ?? []));
      const ownerFloor = floorOwnerForProjection(inputs.floor);
      const ruleByMechanism = new Map(
        rules
          .filter(rule => typeof rule?.mechanism_key === "string" && rule.mechanism_key.trim() !== '')
          .map(rule => [rule.mechanism_key, rule]),
      );
      const timingCandidates = new Map();
      const cycleResolutionDiagnostics = new Set();
      for (const event of relevantExposureEvents) {
        const mechanismKey = event?.pregnancy_relevance?.reproductive_mechanism?.kind;
        for (const subjectId of event?.pregnancy_relevance?.gestational_subject_ids ?? []) {
          const trackingWindow = (inputs.trackingWindows ?? []).find(window =>
            window?.subject_id === subjectId
            && window?.mechanism_key === mechanismKey
            && (window?.source_event_ids ?? []).includes(event.event_id),
          ) ?? null;
          const windowBasis = trackingWindow
            ? relevantExposureEvents.filter(candidate =>
                (trackingWindow.source_event_ids ?? []).includes(candidate.event_id)
                && candidate?.pregnancy_relevance?.gestational_subject_ids?.includes(subjectId)
                && candidate?.pregnancy_relevance?.reproductive_mechanism?.kind === mechanismKey,
              )
            : [];
          const firstExposure = resolveTrackingWindowFirstExposure({
            trackingWindow,
            candidateEvents: windowBasis,
            chatId: floorVersion?.chat_id,
            subjectId,
            mechanismKey,
          });
          if (trackingWindow && !firstExposure.event) {
            const diagnosticKey = timingTargetKey(subjectId, mechanismKey, trackingWindow.tracking_window_id);
            if (!cycleResolutionDiagnostics.has(diagnosticKey)) {
              cycleResolutionDiagnostics.add(diagnosticKey);
              recordNsfwPipelineStage({
                stage: "TIMING_INSTANCE_CREATION",
                execution_status: "BLOCKED",
                reason_code: firstExposure.reason_code ?? "CYCLE_FIRST_EXPOSURE_UNAVAILABLE",
                invoked: false,
                run_id: pipelineRunId,
                chat_id: floorVersion?.chat_id ?? null,
                subject_id: subjectId,
                mechanism_key: mechanismKey,
                tracking_window_id: trackingWindow.tracking_window_id ?? null,
                tracking_window_cycle_id: trackingWindow.cycle_id ?? null,
                floor_version: floorVersion,
                input_count: windowBasis.length,
                output_count: 0,
                source_type: "EXECUTION_TRACE",
              });
            }
            continue;
          }
          const firstEvent = firstExposure.event ?? event;
          const canonicalCycleId = buildProjectionTimingCycleId({
            chatId: floorVersion?.chat_id,
            subjectId,
            mechanismKey,
            firstEvent,
          });
          const cycleId = canonicalCycleId;
          const key = timingTargetKey(subjectId, mechanismKey, cycleId);
          const candidate = timingCandidates.get(key) ?? {
            subjectId,
            mechanismKey,
            firstEvent,
            cycleId,
            canonicalCycleId,
            cycleIdSource: trackingWindow
              ? trackingWindow.cycle_id === canonicalCycleId
                ? firstExposure.source
                : "CANONICAL_CYCLE_ID"
              : "EXPOSURE_FIRST_EVENT",
            trackingWindow,
            events: [],
          };
          candidate.events.push(event);
          if (!candidate.trackingWindow && trackingWindow) candidate.trackingWindow = trackingWindow;
          timingCandidates.set(key, candidate);
        }
      }
      for (const candidate of timingCandidates.values()) {
        const {subjectId, mechanismKey, firstEvent: event, trackingWindow, events: candidateEvents} = candidate;
        const rule = ruleByMechanism.get(mechanismKey) ?? null;
        const worldRuleBinding = typeof rule?.projection_rule_id === "string" && rule.projection_rule_id.trim() !== ''
          ? {projection_rule_id: rule.projection_rule_id, mechanism_key: mechanismKey}
          : null;
        timingCandidateTargets.add(timingTargetKey(subjectId, mechanismKey, trackingWindow?.tracking_window_id));
        const candidateCycleId = candidate.cycleId;
        const candidateDiagnostic = {
          tracking_window_cycle_id: trackingWindow?.cycle_id ?? null,
          first_exposure_event_id: event?.event_id ?? null,
          first_exposure_story_time: event?.story_time ?? null,
          candidate_exposure_event_ids: candidateEvents.map(item => item.event_id),
          accepted_exposure_event_ids: candidateEvents.map(item => item.event_id),
          final_cycle_id: candidateCycleId,
          canonical_cycle_id: candidate.canonicalCycleId ?? null,
          cycle_id_source: candidate.cycleIdSource ?? (trackingWindow ? "TRACKING_WINDOW" : "EXPOSURE_FIRST_EVENT"),
          cycle_id_consistent: trackingWindow?.cycle_id && candidateCycleId
            ? trackingWindow.cycle_id === candidateCycleId
            : null,
          cycle_id_consistency_reason_code: trackingWindow?.cycle_id && candidateCycleId
            ? trackingWindow.cycle_id === candidateCycleId
              ? "TRACKING_WINDOW_CYCLE_MATCH"
              : "TRACKING_WINDOW_CYCLE_MISMATCH"
            : "TRACKING_WINDOW_CYCLE_UNAVAILABLE",
        };
        const canonicalResolution = resolveCanonicalTimingInstance({
          timingInstances,
          subjectId,
          mechanismKey,
          candidate,
          canonicalCycleId: candidate.canonicalCycleId,
        });
        if (canonicalResolution.status === "ambiguous") {
          recordNsfwPipelineStage({
            stage: "TIMING_INSTANCE_CREATION",
            execution_status: "BLOCKED",
            reason_code: "CYCLE_ID_CANONICAL_AMBIGUOUS",
            invoked: false,
            run_id: pipelineRunId,
            chat_id: floorVersion?.chat_id ?? null,
            subject_id: subjectId,
            mechanism_key: mechanismKey,
            tracking_window_id: trackingWindow?.tracking_window_id ?? null,
            cycle_id: candidateCycleId,
            resolution_candidate_count: canonicalResolution.candidates.length,
            cycle_id_resolution_status: "AMBIGUOUS",
            cycle_id_resolution_reason_code: "MULTIPLE_CANONICAL_TIMING_INSTANCES",
            ...candidateDiagnostic,
            floor_version: floorVersion,
            input_count: canonicalResolution.candidates.length,
            output_count: 0,
            source_type: "EXECUTION_TRACE",
          });
          continue;
        }
        const existing = canonicalResolution.status === "matched" ? canonicalResolution.instance : null;
        const changedHistoricalBasis = timingInstances.some(item =>
          item.subject_id === subjectId
          && item.mechanism_key === mechanismKey
          && item.timing_instance_id === existing?.timing_instance_id
          && candidateEvents.some(basisEvent =>
            item.source_event_ids.includes(basisEvent.event_id)
            && storedEventBasisChanged(
              item.source_basis_refs?.[basisEvent.event_id]?.event_version
                ?? item.source_basis_refs?.[basisEvent.event_id]?.source
                ?? null,
              eventFloorVersion(basisEvent),
            ),
          ),
        );
        if (changedHistoricalBasis) {
          recordNsfwPipelineStage({
            stage: "TIMING_INSTANCE_CREATION",
            execution_status: "BLOCKED",
            reason_code: "HISTORICAL_BASIS_CHANGED",
            invoked: false,
            run_id: pipelineRunId,
            chat_id: floorVersion?.chat_id ?? null,
            subject_id: subjectId,
            mechanism_key: mechanismKey,
            tracking_window_id: trackingWindow?.tracking_window_id ?? null,
            cycle_id: existing?.cycle_id ?? null,
            ...candidateDiagnostic,
            floor_version: floorVersion,
            input_count: 1,
            output_count: 0,
            source_type: "EXECUTION_TRACE",
          });
          continue;
        }
        if (existing) {
          recordNsfwPipelineStage({
            stage: "TIMING_CONFIGURATION_RESOLUTION",
            execution_status: "NOT_INVOKED",
            reason_code: "TIMING_INSTANCE_EXISTS",
            invoked: false,
            run_id: pipelineRunId,
            chat_id: floorVersion?.chat_id ?? null,
            subject_id: subjectId,
            mechanism_key: mechanismKey,
            tracking_window_id: trackingWindow?.tracking_window_id ?? null,
            cycle_id: existing.cycle_id,
            ...candidateDiagnostic,
            floor_version: floorVersion,
            input_count: 0,
            output_count: 1,
            timing_config_available: true,
            timing_config_source: "TIMING_INSTANCE_SNAPSHOT",
            cycle_id_resolution_status: canonicalResolution.status === "matched" ? "CANONICAL_CYCLE_ID" : "UNAVAILABLE",
            cycle_id_resolution_reason_code: canonicalResolution.status === "matched" ? "CANONICAL_TIMING_REUSED" : "CANONICAL_TIMING_NOT_FOUND",
            base_min_story_days: existing.base_min_story_days,
            base_max_story_days: existing.base_max_story_days,
            variance_ratio: existing.variance_ratio,
            variance_cap_story_days: existing.variance_cap_story_days,
            sampled_individual_offset_story_days: existing.sampled_individual_offset_story_days,
            sampled_offset_source: "FROZEN_SNAPSHOT",
            frozen_offset_status: "PRESERVED",
            state_modifier_story_days: existing.state_modifier_story_days,
            total_adjustment_story_days: existing.total_adjustment_story_days,
            total_adjustment_cap_story_days: existing.total_adjustment_cap_story_days,
            effective_min_story_days: existing.effective_min_story_days,
            effective_max_story_days: existing.effective_max_story_days,
            world_rule_binding: existing.world_rule_binding ?? null,
            source_type: "EXECUTION_TRACE",
          });
          recordNsfwPipelineStage({
            stage: "TIMING_INSTANCE_CREATION",
            execution_status: "SKIPPED",
            reason_code: "TIMING_INSTANCE_EXISTS",
            invoked: false,
            run_id: pipelineRunId,
            chat_id: floorVersion?.chat_id ?? null,
            subject_id: subjectId,
            mechanism_key: mechanismKey,
            tracking_window_id: trackingWindow?.tracking_window_id ?? null,
            cycle_id: existing.cycle_id,
            floor_version: floorVersion,
            input_count: 1,
            output_count: 1,
            timing_instance_id: existing.timing_instance_id,
            cycle_id_resolution_status: canonicalResolution.status === "matched" ? "CANONICAL_CYCLE_ID" : "UNAVAILABLE",
            cycle_id_resolution_reason_code: canonicalResolution.status === "matched" ? "CANONICAL_TIMING_REUSED" : "CANONICAL_TIMING_NOT_FOUND",
            base_min_story_days: existing.base_min_story_days,
            base_max_story_days: existing.base_max_story_days,
            variance_ratio: existing.variance_ratio,
            variance_cap_story_days: existing.variance_cap_story_days,
            sampled_individual_offset_story_days: existing.sampled_individual_offset_story_days,
            sampled_offset_source: "FROZEN_SNAPSHOT",
            frozen_offset_status: "PRESERVED",
            state_modifier_story_days: existing.state_modifier_story_days,
            total_adjustment_story_days: existing.total_adjustment_story_days,
            total_adjustment_cap_story_days: existing.total_adjustment_cap_story_days,
            effective_min_story_days: existing.effective_min_story_days,
            effective_max_story_days: existing.effective_max_story_days,
            world_rule_binding: existing.world_rule_binding ?? null,
            source_type: "EXECUTION_TRACE",
          });
          const nextSourceEventIds = [...new Set([
            ...(existing.source_event_ids ?? []),
            ...candidateEvents.map(basisEvent => basisEvent.event_id),
          ])].sort();
          const nextSourceBasisRefs = {...(existing.source_basis_refs ?? {})};
          for (const basisEvent of candidateEvents) {
            nextSourceBasisRefs[basisEvent.event_id] = {
              ...(nextSourceBasisRefs[basisEvent.event_id] ?? {}),
              event_id: basisEvent.event_id,
              story_time: basisEvent.story_time ?? null,
              event_version: eventFloorVersion(basisEvent),
            };
          }
          if (JSON.stringify(nextSourceEventIds) !== JSON.stringify(existing.source_event_ids ?? [])
              || JSON.stringify(nextSourceBasisRefs) !== JSON.stringify(existing.source_basis_refs ?? {})) {
            const nextExisting = {
              ...existing,
              source_event_ids: nextSourceEventIds,
              source_basis_refs: nextSourceBasisRefs,
            };
            try {
              await projectionTimingPersistence.saveTimingInstance({
                chatId: inputs.floor.version.chat_id,
                ownerFloor,
                floorVersion: inputs.floor.version,
                timingInstance: nextExisting,
              });
              Object.assign(existing, nextExisting);
            } catch (error) {
              recordNsfwPipelineStage({
                stage: "TIMING_INSTANCE_CREATION",
                execution_status: "PERSIST_FAILED",
                reason_code: "TIMING_SNAPSHOT_UPDATE_FAILED",
                invoked: true,
                run_id: pipelineRunId,
                chat_id: floorVersion?.chat_id ?? null,
                subject_id: subjectId,
                mechanism_key: mechanismKey,
                tracking_window_id: trackingWindow?.tracking_window_id ?? null,
                cycle_id: existing.cycle_id,
                timing_instance_id: existing.timing_instance_id,
                floor_version: floorVersion,
                input_count: nextSourceEventIds.length,
                output_count: 0,
                error_code: error?.code ?? error?.message ?? "TIMING_SNAPSHOT_UPDATE_FAILED",
                source_type: "EXECUTION_TRACE",
              });
              throw error;
            }
          }
          continue;
        }
        let override = null;
        let baseline = null;
        let resolvedConfig;
        try {
          override = typeof projectionTimingConfigResolver === 'function'
            ? await projectionTimingConfigResolver({subjectId, inputs, rule, event})
            : readCharacterTimingConfig(store.getChat(inputs.floor.version.chat_id), subjectId).config;
          baseline = typeof humanTimingBaselineResolver === 'function'
            ? await humanTimingBaselineResolver({subjectId, inputs, rule, event})
            : null;
          resolvedConfig = resolveCharacterTimingConfig({override, baseline});
        } catch (error) {
          recordNsfwPipelineStage({
            stage: "TIMING_CONFIGURATION_RESOLUTION",
            execution_status: "FAILED",
            reason_code: "TIMING_CONFIG_INVALID",
            invoked: true,
            run_id: pipelineRunId,
            chat_id: floorVersion?.chat_id ?? null,
            subject_id: subjectId,
            mechanism_key: mechanismKey,
            tracking_window_id: trackingWindow?.tracking_window_id ?? null,
            cycle_id: null,
            ...candidateDiagnostic,
            floor_version: floorVersion,
            input_count: 1,
            output_count: 0,
            error_code: error?.code ?? error?.message ?? "TIMING_CONFIG_INVALID",
            timing_config_available: false,
            timing_config_source: null,
            source_type: "EXECUTION_TRACE",
          });
          throw error;
        }
        const timingConfigSource = override ? "CHARACTER_OVERRIDE" : baseline ? "HUMAN_BASELINE" : null;
        recordNsfwPipelineStage({
          stage: "TIMING_CONFIGURATION_RESOLUTION",
          execution_status: resolvedConfig.config ? "SUCCEEDED" : "BLOCKED",
          reason_code: resolvedConfig.config ? "TIMING_CONFIG_RESOLVED" : "TIMING_CONFIG_UNAVAILABLE",
          invoked: true,
          run_id: pipelineRunId,
          chat_id: floorVersion?.chat_id ?? null,
          subject_id: subjectId,
          mechanism_key: mechanismKey,
          tracking_window_id: trackingWindow?.tracking_window_id ?? null,
          cycle_id: null,
          ...candidateDiagnostic,
          floor_version: floorVersion,
          input_count: 1,
          output_count: resolvedConfig.config ? 1 : 0,
          timing_config_available: Boolean(resolvedConfig.config),
          timing_config_source: timingConfigSource,
          base_min_story_days: resolvedConfig.config?.base_min_story_days ?? null,
          base_max_story_days: resolvedConfig.config?.base_max_story_days ?? null,
          variance_ratio: resolvedConfig.config?.variance_ratio ?? null,
          variance_cap_story_days: resolvedConfig.config?.variance_cap_story_days ?? null,
          total_adjustment_cap_story_days: resolvedConfig.config?.total_adjustment_cap_story_days ?? null,
          source_type: "EXECUTION_TRACE",
        });
        if (!resolvedConfig.config) {
          recordNsfwPipelineStage({
            stage: "TIMING_INSTANCE_CREATION",
            execution_status: "BLOCKED",
            reason_code: "TIMING_CONFIG_UNAVAILABLE",
            invoked: false,
            run_id: pipelineRunId,
            chat_id: floorVersion?.chat_id ?? null,
            subject_id: subjectId,
            mechanism_key: mechanismKey,
            tracking_window_id: trackingWindow?.tracking_window_id ?? null,
            cycle_id: null,
            ...candidateDiagnostic,
            floor_version: floorVersion,
            input_count: 1,
            output_count: 0,
            source_type: "EXECUTION_TRACE",
          });
          continue;
        }
        timingEnabled = true;
        let instance;
        try {
          instance = resolveProjectionTimingInstance({
            chatId: inputs.floor.version.chat_id,
            subjectId,
            mechanismKey,
            firstEvent: event,
            config: resolvedConfig.config,
            floorVersion: inputs.floor.version,
            worldRuleBinding,
            rng: timingRandom,
          });
        } catch (error) {
          recordNsfwPipelineStage({
            stage: "TIMING_INSTANCE_CREATION",
            execution_status: "FAILED",
            reason_code: "TIMING_INSTANCE_CREATION_FAILED",
            invoked: true,
            run_id: pipelineRunId,
            chat_id: floorVersion?.chat_id ?? null,
            subject_id: subjectId,
            mechanism_key: mechanismKey,
            tracking_window_id: trackingWindow?.tracking_window_id ?? null,
          cycle_id: null,
          ...candidateDiagnostic,
          floor_version: floorVersion,
            input_count: 1,
            output_count: 0,
            error_code: error?.code ?? error?.message ?? "TIMING_INSTANCE_CREATION_FAILED",
            rng_source: timingRandomSource,
            frozen_offset_status: "NOT_CREATED",
            source_type: "EXECUTION_TRACE",
          });
          throw error;
        }
        if (instance.cycle_id !== candidateCycleId) {
          recordNsfwPipelineStage({
            stage: "TIMING_INSTANCE_CREATION",
            execution_status: "BLOCKED",
            reason_code: "TRACKING_WINDOW_CYCLE_MISMATCH",
            invoked: true,
            run_id: pipelineRunId,
            chat_id: floorVersion?.chat_id ?? null,
            subject_id: subjectId,
            mechanism_key: mechanismKey,
            tracking_window_id: trackingWindow?.tracking_window_id ?? null,
            cycle_id: instance.cycle_id,
            ...candidateDiagnostic,
            cycle_id_resolution_status: "CANONICAL_CYCLE_ID_MISMATCH",
            cycle_id_resolution_reason_code: "TIMING_RESOLVER_RETURNED_DIFFERENT_CYCLE",
            floor_version: floorVersion,
            input_count: 1,
            output_count: 0,
            timing_instance_id: instance.timing_instance_id,
            sampled_individual_offset_story_days: instance.sampled_individual_offset_story_days,
            sampled_offset_source: "INITIAL_RANDOM_SAMPLE",
            frozen_offset_status: "NOT_PERSISTED",
            rng_source: timingRandomSource,
            source_type: "EXECUTION_TRACE",
          });
          continue;
        }
        const sourceEventIds = [...new Set([
          ...(instance.source_event_ids ?? []),
          ...candidateEvents.map(basisEvent => basisEvent.event_id),
        ])].sort();
        const sourceBasisRefs = {...(instance.source_basis_refs ?? {})};
        for (const basisEvent of candidateEvents) {
          sourceBasisRefs[basisEvent.event_id] = {
            ...(sourceBasisRefs[basisEvent.event_id] ?? {}),
            event_id: basisEvent.event_id,
            story_time: basisEvent.story_time ?? null,
            event_version: eventFloorVersion(basisEvent),
          };
        }
        instance = {...instance, source_event_ids: sourceEventIds, source_basis_refs: sourceBasisRefs};
        recordNsfwPipelineStage({
          stage: "TIMING_INSTANCE_CREATION",
          execution_status: "ATTEMPTED",
          reason_code: "TIMING_INSTANCE_CREATED_IN_MEMORY",
          invoked: true,
          run_id: pipelineRunId,
          chat_id: floorVersion?.chat_id ?? null,
          subject_id: subjectId,
          mechanism_key: mechanismKey,
          tracking_window_id: trackingWindow?.tracking_window_id ?? null,
          cycle_id: instance.cycle_id,
          floor_version: floorVersion,
          input_count: 1,
          output_count: 1,
          timing_instance_id: instance.timing_instance_id,
          ...candidateDiagnostic,
          cycle_id_resolution_status: "CANONICAL_CYCLE_ID_CREATED",
          cycle_id_resolution_reason_code: "CANONICAL_CYCLE_ID",
          base_min_story_days: instance.base_min_story_days,
          base_max_story_days: instance.base_max_story_days,
          variance_ratio: instance.variance_ratio,
          variance_cap_story_days: instance.variance_cap_story_days,
          sampled_individual_offset_story_days: instance.sampled_individual_offset_story_days,
          sampled_offset_source: "INITIAL_RANDOM_SAMPLE",
          frozen_offset_status: "FROZEN_ON_CREATION",
          rng_source: timingRandomSource,
          state_modifier_story_days: instance.state_modifier_story_days,
          total_adjustment_story_days: instance.total_adjustment_story_days,
          total_adjustment_cap_story_days: instance.total_adjustment_cap_story_days,
          effective_min_story_days: instance.effective_min_story_days,
          effective_max_story_days: instance.effective_max_story_days,
          world_rule_binding: instance.world_rule_binding ?? null,
          source_type: "EXECUTION_TRACE",
        });
        let persisted;
        try {
          persisted = await projectionTimingPersistence.saveTimingInstance({chatId: inputs.floor.version.chat_id, ownerFloor, floorVersion: inputs.floor.version, timingInstance: instance});
        } catch (error) {
          recordNsfwPipelineStage({
            stage: "TIMING_INSTANCE_CREATION",
            execution_status: "PERSIST_FAILED",
            reason_code: "TIMING_PERSISTENCE_FAILED",
            invoked: true,
            run_id: pipelineRunId,
            chat_id: floorVersion?.chat_id ?? null,
            subject_id: subjectId,
            mechanism_key: mechanismKey,
            tracking_window_id: trackingWindow?.tracking_window_id ?? null,
            cycle_id: instance.cycle_id,
            floor_version: floorVersion,
            input_count: 1,
            output_count: 0,
            timing_instance_id: instance.timing_instance_id,
            ...candidateDiagnostic,
            base_min_story_days: instance.base_min_story_days,
            base_max_story_days: instance.base_max_story_days,
            variance_ratio: instance.variance_ratio,
            variance_cap_story_days: instance.variance_cap_story_days,
            sampled_individual_offset_story_days: instance.sampled_individual_offset_story_days,
            sampled_offset_source: "INITIAL_RANDOM_SAMPLE",
            frozen_offset_status: "FROZEN_ON_CREATION",
            rng_source: timingRandomSource,
            state_modifier_story_days: instance.state_modifier_story_days,
            total_adjustment_story_days: instance.total_adjustment_story_days,
            total_adjustment_cap_story_days: instance.total_adjustment_cap_story_days,
            error_code: error?.code ?? error?.message ?? "TIMING_PERSISTENCE_FAILED",
            world_rule_binding: instance.world_rule_binding ?? null,
            source_type: "EXECUTION_TRACE",
          });
          throw error;
        }
        recordNsfwPipelineStage({
          stage: "TIMING_INSTANCE_CREATION",
          execution_status: "SUCCEEDED",
          reason_code: persisted?.status === "deduped" ? "TIMING_INSTANCE_DEDUPED" : "TIMING_INSTANCE_PERSISTED",
          invoked: true,
          run_id: pipelineRunId,
          chat_id: floorVersion?.chat_id ?? null,
          subject_id: subjectId,
          mechanism_key: mechanismKey,
          tracking_window_id: trackingWindow?.tracking_window_id ?? null,
          cycle_id: instance.cycle_id,
          floor_version: floorVersion,
          input_count: 1,
          output_count: 1,
          timing_instance_id: instance.timing_instance_id,
          ...candidateDiagnostic,
          base_min_story_days: instance.base_min_story_days,
          base_max_story_days: instance.base_max_story_days,
          variance_ratio: instance.variance_ratio,
          variance_cap_story_days: instance.variance_cap_story_days,
          sampled_individual_offset_story_days: instance.sampled_individual_offset_story_days,
          sampled_offset_source: "INITIAL_RANDOM_SAMPLE",
          frozen_offset_status: "FROZEN_ON_CREATION",
          rng_source: timingRandomSource,
          state_modifier_story_days: instance.state_modifier_story_days,
          total_adjustment_story_days: instance.total_adjustment_story_days,
          total_adjustment_cap_story_days: instance.total_adjustment_cap_story_days,
          effective_min_story_days: instance.effective_min_story_days,
          effective_max_story_days: instance.effective_max_story_days,
          world_rule_binding: instance.world_rule_binding ?? null,
          source_type: "EXECUTION_TRACE",
        });
        recordNsfwPipelineStage({
          stage: "TIMING_INSTANCE_READBACK",
          execution_status: "NOT_INVOKED",
          reason_code: "READBACK_DEFERRED_TO_CURRENT_STATE",
          invoked: false,
          run_id: pipelineRunId,
          chat_id: floorVersion?.chat_id ?? null,
          subject_id: subjectId,
          mechanism_key: mechanismKey,
          tracking_window_id: trackingWindow?.tracking_window_id ?? null,
          cycle_id: instance.cycle_id,
          floor_version: floorVersion,
          input_count: 0,
          output_count: 0,
          timing_instance_id: instance.timing_instance_id,
          ...candidateDiagnostic,
          sampled_offset_source: "INITIAL_RANDOM_SAMPLE",
          frozen_offset_status: "FROZEN_ON_CREATION",
          rng_source: timingRandomSource,
          source_type: "EXECUTION_TRACE",
        });
        timingInstances.push(instance);
      }
      for (const trackingWindow of inputs.trackingWindows ?? []) {
        const subjectId = trackingWindow?.subject_id ?? null;
        const mechanismKey = trackingWindow?.mechanism_key ?? null;
        if (!subjectId || !mechanismKey) continue;
        const hasTimingInstance = timingInstances.some(instance =>
          instance?.subject_id === subjectId &&
          instance?.mechanism_key === mechanismKey &&
          (!trackingWindow.cycle_id || instance?.cycle_id === trackingWindow.cycle_id ||
            (instance?.source_event_ids ?? []).some(eventId => (trackingWindow.source_event_ids ?? []).includes(eventId))),
        );
        if (hasTimingInstance || timingCandidateTargets.has(timingTargetKey(subjectId, mechanismKey, trackingWindow.tracking_window_id))) continue;
        const candidateExposureCount = relevantExposureEvents.filter(event =>
          event?.pregnancy_relevance?.gestational_subject_ids?.includes(subjectId)
          && event?.pregnancy_relevance?.reproductive_mechanism?.kind === mechanismKey,
        ).length;
        const candidateReason = candidateExposureCount === 0
          ? "EXPOSURE_CANDIDATE_NOT_FOUND"
          : "TIMING_ENTRY_NOT_REACHED";
        const diagnosticTarget = {
          run_id: pipelineRunId,
          chat_id: floorVersion?.chat_id ?? null,
          subject_id: subjectId,
          mechanism_key: mechanismKey,
          tracking_window_id: trackingWindow.tracking_window_id ?? null,
          cycle_id: trackingWindow.cycle_id ?? null,
          floor_version: floorVersion,
          input_count: candidateExposureCount,
          output_count: 0,
          source_type: "EXECUTION_TRACE",
        };
        recordNsfwPipelineStage({stage: "TIMING_CONFIGURATION_RESOLUTION", execution_status: "NOT_INVOKED", reason_code: candidateReason, invoked: false, ...diagnosticTarget});
        recordNsfwPipelineStage({stage: "TIMING_INSTANCE_CREATION", execution_status: "NOT_INVOKED", reason_code: candidateReason, invoked: false, ...diagnosticTarget});
        recordNsfwPipelineStage({stage: "TIMING_ELIGIBILITY_EVALUATION", execution_status: "NOT_INVOKED", reason_code: candidateReason, invoked: false, ...diagnosticTarget});
        recordNsfwPipelineStage({stage: "AGGREGATION_ELIGIBILITY_EVALUATION", execution_status: "NOT_INVOKED", reason_code: candidateReason, invoked: false, aggregation_due: null, aggregation_attempted: false, ...diagnosticTarget});
        recordNsfwPipelineStage({stage: "PARTICIPANT_AGGREGATION_EXECUTION", execution_status: "NOT_INVOKED", reason_code: candidateReason, invoked: false, aggregation_due: null, aggregation_attempted: false, ...diagnosticTarget});
      }
      const aggregations = [...aggregationTimeline.items];
      if (!timingInstances.length) {
        recordNsfwPipelineStage({
          stage: "AGGREGATION_ELIGIBILITY_EVALUATION",
          execution_status: "NOT_INVOKED",
          reason_code: "TIMING_INSTANCE_MISSING",
          invoked: false,
          run_id: pipelineRunId,
          chat_id: floorVersion?.chat_id ?? null,
          floor_version: floorVersion,
          input_count: 0,
          output_count: 0,
          source_type: "EXECUTION_TRACE",
        });
        recordNsfwPipelineStage({
          stage: "PARTICIPANT_AGGREGATION_EXECUTION",
          execution_status: "NOT_INVOKED",
          reason_code: "TIMING_INSTANCE_MISSING",
          invoked: false,
          run_id: pipelineRunId,
          chat_id: floorVersion?.chat_id ?? null,
          floor_version: floorVersion,
          input_count: 0,
          output_count: 0,
          source_type: "EXECUTION_TRACE",
        });
      }
      const currentEvents = Array.isArray(inputs.events) ? inputs.events : [];
      for (const instance of timingInstances) {
        const existing = aggregations.find(item => item.timing_instance_id === instance.timing_instance_id && item.cycle_id === instance.cycle_id);
        const trackingWindow = (inputs.trackingWindows ?? []).find(window =>
          window?.cycle_id === instance.cycle_id
          && window?.subject_id === instance.subject_id
          && window?.mechanism_key === instance.mechanism_key,
        ) ?? (inputs.trackingWindows ?? []).find(window =>
          window?.subject_id === instance.subject_id
          && window?.mechanism_key === instance.mechanism_key
          && (instance.source_event_ids ?? []).some(eventId => (window?.source_event_ids ?? []).includes(eventId)),
        ) ?? null;
        const candidateExposureEvents = currentEvents.filter(event => {
          try {
            return isPregnancyRelevantExposure(event)
              && event?.pregnancy_relevance?.gestational_subject_ids?.includes(instance.subject_id)
              && event?.pregnancy_relevance?.reproductive_mechanism?.kind === instance.mechanism_key;
          } catch {
            return false;
          }
        });
        const candidateExposureEventIds = candidateExposureEvents.map(event => event.event_id);
        const acceptedExposureEventIds = instance.source_event_ids.filter(eventId => candidateExposureEventIds.includes(eventId));
        const firstExposureEvent = candidateExposureEvents.find(event =>
          buildProjectionTimingCycleId({
            chatId: floorVersion?.chat_id,
            subjectId: instance.subject_id,
            mechanismKey: instance.mechanism_key,
            firstEvent: event,
          }) === instance.cycle_id,
        ) ?? candidateExposureEvents.find(event =>
          (instance.source_event_ids ?? []).includes(event?.event_id)
          && cycleStoryTimeEqual(event?.story_time, instance.reference_story_time),
        ) ?? null;
        const cycleIdSource = trackingWindow?.cycle_id === instance.cycle_id
          ? "TRACKING_WINDOW"
          : firstExposureEvent ? "TIMING_INSTANCE_CYCLE_ID" : "UNAVAILABLE";
        const trigger = resolveParticipantAggregationTrigger({timingInstance: instance, currentStoryTime: inputs.currentStoryTime, aggregation: existing});
        const triggerReason = existing
          ? "AGGREGATION_ALREADY_SUCCEEDED"
          : trigger.eligible
            ? "AGGREGATION_DUE"
            : String(trigger.reason_code ?? trigger.status ?? "AGGREGATION_NOT_DUE").toUpperCase();
        const aggregationDiagnostic = {
          tracking_window_cycle_id: trackingWindow?.cycle_id ?? null,
          first_exposure_event_id: firstExposureEvent?.event_id ?? null,
          first_exposure_story_time: firstExposureEvent?.story_time ?? instance.reference_story_time ?? null,
          candidate_exposure_event_ids: candidateExposureEventIds,
          accepted_exposure_event_ids: acceptedExposureEventIds,
          final_cycle_id: instance.cycle_id,
          cycle_id_source: cycleIdSource,
          cycle_id_consistent: trackingWindow?.cycle_id && instance.cycle_id
            ? trackingWindow.cycle_id === instance.cycle_id
            : null,
          cycle_id_consistency_reason_code: trackingWindow?.cycle_id && instance.cycle_id
            ? trackingWindow.cycle_id === instance.cycle_id
              ? "TRACKING_WINDOW_CYCLE_MATCH"
              : "TRACKING_WINDOW_CYCLE_MISMATCH"
            : "TRACKING_WINDOW_CYCLE_UNAVAILABLE",
          base_min_story_days: instance.base_min_story_days,
          base_max_story_days: instance.base_max_story_days,
          variance_ratio: instance.variance_ratio,
          variance_cap_story_days: instance.variance_cap_story_days,
          sampled_individual_offset_story_days: instance.sampled_individual_offset_story_days,
          state_modifier_story_days: instance.state_modifier_story_days,
          total_adjustment_story_days: instance.total_adjustment_story_days,
          total_adjustment_cap_story_days: instance.total_adjustment_cap_story_days,
          aggregation_trigger_status: existing ? "already_succeeded" : trigger.status ?? null,
          aggregation_reason_code: triggerReason,
          aggregation_overdue: trigger.status === "aggregate_due_overdue",
          existing_aggregation_succeeded: existing?.status === "succeeded",
          accepted_exposure_count: acceptedExposureEventIds.length,
          world_rule_binding: instance.world_rule_binding ?? null,
        };
        recordNsfwPipelineStage({
          stage: "TIMING_ELIGIBILITY_EVALUATION",
          execution_status: "SUCCEEDED",
          reason_code: trigger.eligible ? "TIMING_WINDOW_EVALUATED" : triggerReason,
          invoked: true,
          run_id: pipelineRunId,
          chat_id: floorVersion?.chat_id ?? null,
          subject_id: instance.subject_id,
          mechanism_key: instance.mechanism_key,
          tracking_window_id: trackingWindow?.tracking_window_id ?? null,
          cycle_id: instance.cycle_id,
          ...aggregationDiagnostic,
          floor_version: floorVersion,
          input_count: 1,
          output_count: trigger.eligible ? 1 : 0,
          timing_instance_id: instance.timing_instance_id,
          effective_min_story_days: instance.effective_min_story_days,
          effective_max_story_days: instance.effective_max_story_days,
          source_type: "EXECUTION_TRACE",
        });
        recordNsfwPipelineStage({
          stage: "AGGREGATION_ELIGIBILITY_EVALUATION",
          execution_status: existing ? "SKIPPED" : trigger.eligible ? "SUCCEEDED" : "BLOCKED",
          reason_code: triggerReason,
          invoked: true,
          run_id: pipelineRunId,
          chat_id: floorVersion?.chat_id ?? null,
          subject_id: instance.subject_id,
          mechanism_key: instance.mechanism_key,
          tracking_window_id: trackingWindow?.tracking_window_id ?? null,
          cycle_id: instance.cycle_id,
          ...aggregationDiagnostic,
          floor_version: floorVersion,
          input_count: 1,
          output_count: trigger.eligible && !existing ? 1 : 0,
          timing_instance_id: instance.timing_instance_id,
          aggregation_id: existing?.aggregation_id ?? null,
          aggregation_due: existing?.status === "succeeded" || trigger.eligible,
          aggregation_attempted: false,
          source_type: "EXECUTION_TRACE",
        });
        if (!trigger.eligible || existing) continue;
        const acceptedIds = instance.source_event_ids.filter(eventId => currentEvents.some(event => event?.event_id === eventId));
        if (!acceptedIds.length) {
          recordNsfwPipelineStage({
            stage: "AGGREGATION_ELIGIBILITY_EVALUATION",
            execution_status: "BLOCKED",
            reason_code: "ACCEPTED_EXPOSURE_MISSING",
            invoked: true,
            run_id: pipelineRunId,
            chat_id: floorVersion?.chat_id ?? null,
            subject_id: instance.subject_id,
            mechanism_key: instance.mechanism_key,
            tracking_window_id: trackingWindow?.tracking_window_id ?? null,
            cycle_id: instance.cycle_id,
            ...aggregationDiagnostic,
            floor_version: floorVersion,
            input_count: instance.source_event_ids.length,
            output_count: 0,
            timing_instance_id: instance.timing_instance_id,
            aggregation_due: true,
            aggregation_attempted: false,
            source_type: "EXECUTION_TRACE",
          });
          continue;
        }
        let aggregation;
        try {
          aggregation = upsertParticipantAggregation({
            aggregation_id: buildParticipantAggregationId({cycleId: instance.cycle_id, timingInstanceId: instance.timing_instance_id}),
            pregnancy_id: instance.pregnancy_id ?? null,
            subject_id: instance.subject_id,
            mechanism_key: instance.mechanism_key,
            cycle_id: instance.cycle_id,
            timing_instance_id: instance.timing_instance_id,
            aggregation_trigger_strategy: 'at_effective_min',
            reference_story_time: instance.reference_story_time,
            aggregation_story_time: inputs.currentStoryTime,
            effective_min_story_days: instance.effective_min_story_days,
            effective_max_story_days: instance.effective_max_story_days,
            sampled_individual_offset_story_days: instance.sampled_individual_offset_story_days,
            config_snapshot: instance.config_snapshot,
            accepted_exposure_event_ids: acceptedIds,
            source_basis_refs: instance.source_basis_refs,
            created_at_floor_version: inputs.floor.version,
            created_at: new Date().toISOString(),
          }, {snapshot: {schema_version: 1, items: []}, expectedChatId: inputs.floor.version.chat_id});
        } catch (error) {
          recordNsfwPipelineStage({
            stage: "PARTICIPANT_AGGREGATION_EXECUTION",
            execution_status: "FAILED",
            reason_code: "AGGREGATION_EXECUTION_FAILED",
            invoked: true,
            run_id: pipelineRunId,
            chat_id: floorVersion?.chat_id ?? null,
            subject_id: instance.subject_id,
            mechanism_key: instance.mechanism_key,
            tracking_window_id: trackingWindow?.tracking_window_id ?? null,
            cycle_id: instance.cycle_id,
            floor_version: floorVersion,
            input_count: acceptedIds.length,
            output_count: 0,
            timing_instance_id: instance.timing_instance_id,
            aggregation_due: true,
            aggregation_attempted: true,
            error_code: error?.code ?? error?.message ?? "AGGREGATION_EXECUTION_FAILED",
            source_type: "EXECUTION_TRACE",
          });
          throw error;
        }
        const aggregationRecord = aggregation.snapshot.items[0];
        recordNsfwPipelineStage({
          stage: "PARTICIPANT_AGGREGATION_EXECUTION",
          execution_status: "SUCCEEDED",
          reason_code: "AGGREGATION_RESULT_BUILT",
          invoked: true,
          run_id: pipelineRunId,
          chat_id: floorVersion?.chat_id ?? null,
          subject_id: instance.subject_id,
          mechanism_key: instance.mechanism_key,
          tracking_window_id: trackingWindow?.tracking_window_id ?? null,
          cycle_id: instance.cycle_id,
          ...aggregationDiagnostic,
          floor_version: floorVersion,
          input_count: acceptedIds.length,
          output_count: 1,
          timing_instance_id: instance.timing_instance_id,
          aggregation_id: aggregationRecord?.aggregation_id ?? null,
          aggregation_due: true,
          aggregation_attempted: true,
          accepted_exposure_count: acceptedIds.length,
          source_type: "EXECUTION_TRACE",
        });
        let persisted;
        try {
          persisted = await participantAggregationPersistence.upsertAggregation({chatId: inputs.floor.version.chat_id, ownerFloor, floorVersion: inputs.floor.version, aggregation: aggregationRecord});
        } catch (error) {
          recordNsfwPipelineStage({
            stage: "AGGREGATION_PERSISTENCE",
            execution_status: "PERSIST_FAILED",
            reason_code: "AGGREGATION_PERSISTENCE_FAILED",
            invoked: true,
            run_id: pipelineRunId,
            chat_id: floorVersion?.chat_id ?? null,
            subject_id: instance.subject_id,
            mechanism_key: instance.mechanism_key,
            tracking_window_id: trackingWindow?.tracking_window_id ?? null,
            cycle_id: instance.cycle_id,
            ...aggregationDiagnostic,
            floor_version: floorVersion,
            input_count: 1,
            output_count: 0,
            timing_instance_id: instance.timing_instance_id,
            aggregation_id: aggregationRecord?.aggregation_id ?? null,
            aggregation_due: true,
            aggregation_attempted: true,
            persistence_attempted: true,
            persistence_succeeded: false,
            error_code: error?.code ?? error?.message ?? "AGGREGATION_PERSISTENCE_FAILED",
            source_type: "EXECUTION_TRACE",
          });
          throw error;
        }
        recordNsfwPipelineStage({
          stage: "AGGREGATION_PERSISTENCE",
          execution_status: ["created", "updated", "deduped"].includes(persisted?.status) ? "SUCCEEDED" : "ATTEMPTED",
          reason_code: persisted?.status === "deduped" ? "AGGREGATION_DEDUPED" : "AGGREGATION_PERSISTED",
          invoked: true,
          run_id: pipelineRunId,
          chat_id: floorVersion?.chat_id ?? null,
          subject_id: instance.subject_id,
          mechanism_key: instance.mechanism_key,
          tracking_window_id: trackingWindow?.tracking_window_id ?? null,
          cycle_id: instance.cycle_id,
          ...aggregationDiagnostic,
          floor_version: floorVersion,
          input_count: 1,
          output_count: 1,
          timing_instance_id: instance.timing_instance_id,
          aggregation_id: aggregationRecord?.aggregation_id ?? null,
          aggregation_due: true,
          aggregation_attempted: true,
          persistence_attempted: true,
          persistence_succeeded: ["created", "updated", "deduped"].includes(persisted?.status),
          source_type: "EXECUTION_TRACE",
        });
        recordNsfwPipelineStage({
          stage: "AGGREGATION_READBACK",
          execution_status: "NOT_INVOKED",
          reason_code: "READBACK_DEFERRED_TO_CURRENT_STATE",
          invoked: false,
          run_id: pipelineRunId,
          chat_id: floorVersion?.chat_id ?? null,
          subject_id: instance.subject_id,
          mechanism_key: instance.mechanism_key,
          tracking_window_id: trackingWindow?.tracking_window_id ?? null,
          cycle_id: instance.cycle_id,
          ...aggregationDiagnostic,
          floor_version: floorVersion,
          input_count: 0,
          output_count: 0,
          timing_instance_id: instance.timing_instance_id,
          aggregation_id: aggregationRecord?.aggregation_id ?? null,
          persistence_attempted: true,
          persistence_succeeded: ["created", "updated", "deduped"].includes(persisted?.status),
          readback_succeeded: null,
          source_type: "EXECUTION_TRACE",
        });
        if (["created", "updated", "deduped"].includes(persisted.status)) aggregations.push(aggregationRecord);
      }
      return {enabled: timingEnabled, instances: timingInstances, windows: inputs.trackingWindows ?? [], confirmedSubjects, terminatedSubjects, aggregations};
    },
    refreshProjectionContext: projectionContext.refreshProjectionContext,
    notify,
    activity,
  });
  eventAnalysis.setProjectionPostProcessor?.(({target, execution}) => projectionRuntime.handleAnalysisSuccess({target, execution}));
  eventAnalysis.setSettledProjectionProcessor?.(async ({target, reason, generation, analysisExecutionId, schedulerDecision}) => {
    const snapshot = await eventAnalysis.syncHealthRecoverySnapshot?.({
      target,
      reason: `settled-floor:${reason}`,
      force: false,
    });
    let settledTarget = target;
    if (snapshot?.status === "deferred") {
      recordPersistenceTrace({
        stage: "HEALTH_ASSESSMENT_SNAPSHOT_OWNER_REPAIR_ATTEMPT",
        reason: `settled-final-floor:${reason}`,
        floor_version: target?.version ?? null,
      });
      try {
        const ownerRepair = await eventAnalysis.ensureCurrentProjectionFloorOwner?.({
          target,
          reason: `settled-floor:${reason}`,
          trigger: schedulerDecision ?? "automatic-internal",
        });
        recordPersistenceTrace({
          stage: "HEALTH_ASSESSMENT_SNAPSHOT_OWNER_REPAIR_RESULT",
          reason: `settled-final-floor:${reason}`,
          status: ownerRepair?.status ?? "unsupported",
          wrote: ownerRepair?.wrote ?? null,
        });
        settledTarget = await eventAnalysis.resolveCurrentBioWeaveFloor?.({
          __messageIndex: true,
          index: target?.index,
        });
        if (!settledTarget?.version || !sameFloorVersion(settledTarget.version, target.version)) {
          recordPersistenceTrace({
            stage: "HEALTH_ASSESSMENT_SNAPSHOT_SYNC_FAILED",
            reason: `settled-final-floor:${reason}`,
            error_code: "FLOOR_VERSION_STALE",
          });
          return {status: "stale", reason: "settled-floor-version-changed"};
        }
      } catch (error) {
        recordPersistenceTrace({
          stage: "HEALTH_ASSESSMENT_SNAPSHOT_SYNC_FAILED",
          reason: `settled-final-floor:${reason}`,
          error_code: error?.code ?? error?.message ?? "PROJECTION_FLOOR_OWNER_SEED_FAILED",
          target_index: target?.index ?? null,
          target_version: target?.version ?? null,
        });
        return {status: "failed", reason: "settled-floor-owner-seed-failed"};
      }
      await eventAnalysis.syncHealthRecoverySnapshot?.({
        target: settledTarget,
        reason: `settled-final-floor:${reason}`,
        force: false,
      });
    }
    const result = await projectionRuntime.processInternal({
      reason: `settled-floor:${reason}`,
      trigger: schedulerDecision ?? "automatic-internal",
      generation,
      analysisExecutionId,
    });
    return result;
  });

  async function updateEventWithProjection(...args) {
    const result = await eventAnalysis.updateEvent(...args);
    await eventAnalysis.syncHealthRecoverySnapshot?.({
      reason: "event-edit",
      force: true,
    });
    void projectionRuntime.process({reason: "event-edit"}).catch(() => null);
    return result;
  }

  async function deleteEventWithProjection(...args) {
    const result = await eventAnalysis.deleteEvent(...args);
    await eventAnalysis.syncHealthRecoverySnapshot?.({
      reason: "event-delete",
      force: true,
    });
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
      await runLifecycleRecovery({
        trigger: "lifecycle-plugin-reenabled",
        reason: "plugin-reenabled",
      });
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
  const lifecycleRecoveryInFlight = new Map();
  let activeOwner = null;
  let knownChatIds = null;
  let knownChatIdsEvidence = false;
  let pendingStartNewChat = null;
  const failedSourceClears = new Map();
  let generationGate = null;
  let generationLeaseExpiredBoundary = null;

  const generationBoundaryEvents = new Set([
    "GENERATION_STARTED",
    "GENERATION_ENDED",
    "GENERATION_STOPPED",
    "GENERATION_CANCELLED",
    "STREAM_TOKEN_RECEIVED",
    "CHARACTER_MESSAGE_RENDERED",
  ]);

  function generationAutomaticWorkIsDeferred(key) {
    return Boolean(generationGate?.active || generationGate?.startPending) &&
      !generationBoundaryEvents.has(key);
  }

  function createGenerationGate({
    generationIntentId = null,
    pendingEvents = new Map(),
    active = false,
    startPending = false,
    actualGenerationEvidence = false,
  } = {}) {
    return {
      active,
      startPending,
      pending: pendingEvents.size > 0,
      pendingEvents: new Map(pendingEvents),
      leaseTimer: null,
      leaseToken: 0,
      hardWatchdogTimer: null,
      hardWatchdogToken: 0,
      streamConfirmed: false,
      actualGenerationEvidence,
      generationIntentId,
    };
  }

  function markGenerationPending(key, eventType, payload, chatId) {
    if (!generationGate?.active && !generationGate?.startPending) return;
    generationGate.pending = true;
    generationGate.pendingEvents.set(key, {eventType, payload, chatId});
  }

  async function replayDeferredGenerationEvents(pendingEvents, {safeOnly = false} = {}) {
    const entries = [...pendingEvents.entries()];
    const replayableEntries = safeOnly
      ? entries.filter(([key]) => key === "CHAT_CHANGED")
      : entries;
    if (safeOnly) {
      for (const [key, deferredEvent] of entries.filter(([eventKey]) => eventKey !== "CHAT_CHANGED")) {
        recordPersistenceTrace({
          stage: "GENERATION_DEFERRED_EVENT_REPLAY",
          host_event_key: key,
          execution_status: "SKIPPED",
          reason: "LEASE_EXPIRED_UNSAFE_EVENT",
          deferred_chat_id: deferredEvent?.chatId ?? null,
          active_chat_id: chat.current(),
        });
      }
    }
    const chatChanges = replayableEntries.filter(([key]) => key === "CHAT_CHANGED");
    const otherEvents = replayableEntries.filter(([key]) => key !== "CHAT_CHANGED");
    for (const [key, deferredEvent] of [...chatChanges, ...otherEvents]) {
      // A Chat switch invalidates events captured from the old Chat. Only
      // replay an event when its captured Chat is still the active owner.
      if (deferredEvent?.chatId !== null &&
          deferredEvent?.chatId !== undefined &&
          String(deferredEvent.chatId) !== String(chat.current())) {
        recordPersistenceTrace({
          stage: "GENERATION_DEFERRED_EVENT_REPLAY",
          host_event_key: key,
          execution_status: "SKIPPED",
          reason: "STALE_CHAT",
          deferred_chat_id: deferredEvent.chatId,
          active_chat_id: chat.current(),
        });
        continue;
      }
      if (key === "MESSAGE_DELETED" &&
          (pendingEvents.has("MESSAGE_RECEIVED") || pendingEvents.has("CHARACTER_MESSAGE_RENDERED"))) {
        const payload = deferredEvent?.payload;
        const deletedMessageId = payload && typeof payload === "object"
          ? payload.message_id ?? payload.messageId
          : payload;
        const requestedIndex = payload && typeof payload === "object"
          ? payload.messageIndex ?? payload.message_index ?? payload.index
          : null;
        const receivedPayload = pendingEvents.get("MESSAGE_RECEIVED")?.payload ??
          pendingEvents.get("CHARACTER_MESSAGE_RENDERED")?.payload;
        const receivedMessageId = receivedPayload && typeof receivedPayload === "object"
          ? receivedPayload.message_id ?? receivedPayload.messageId
          : receivedPayload;
        const currentTarget = await eventAnalysis.resolveCurrentBioWeaveFloor().catch(() => null);
        const currentMessageId = currentTarget?.version?.message_id ?? null;
        const sameCurrentSlot = requestedIndex != null &&
          Number.isInteger(Number(requestedIndex)) &&
          Number(currentTarget?.index) === Number(requestedIndex);
        const currentIsReceivedReplacement = receivedMessageId != null &&
          currentMessageId !== null &&
          String(receivedMessageId) === String(currentMessageId);
        const replacementMessageIdMatches = deletedMessageId == null ||
          (receivedMessageId != null &&
            String(deletedMessageId) === String(receivedMessageId));
        const sameCurrentReplacement = (sameCurrentSlot && replacementMessageIdMatches) ||
          (requestedIndex == null && currentIsReceivedReplacement &&
            (deletedMessageId == null || String(deletedMessageId) === String(receivedMessageId)));
        if (sameCurrentReplacement && currentMessageId !== null) {
          recordPersistenceTrace({
            stage: "GENERATION_DEFERRED_EVENT_REPLAY",
            host_event_key: key,
            execution_status: "SKIPPED",
            reason: "REPLACED_BY_CURRENT_CHARACTER_FLOOR",
            deferred_message_id: deletedMessageId ?? null,
            current_message_id: currentMessageId,
            deferred_chat_id: deferredEvent?.chatId ?? null,
            active_chat_id: chat.current(),
          });
          continue;
        }
      }
      try {
        await eventAnalysis.handleLifecycleEvent({
          type: key,
          eventType: deferredEvent?.eventType ?? null,
          payload: deferredEvent?.payload,
          chatId: chat.current(),
          deferAutomaticWork: false,
        });
        recordPersistenceTrace({
          stage: "GENERATION_DEFERRED_EVENT_REPLAY",
          host_event_key: key,
          execution_status: "SUCCEEDED",
          deferred_chat_id: deferredEvent?.chatId ?? null,
          active_chat_id: chat.current(),
        });
      } catch (error) {
        recordPersistenceTrace({
          stage: "GENERATION_DEFERRED_EVENT_REPLAY",
          host_event_key: key,
          execution_status: "FAILED",
          reason: error?.code ?? error?.message ?? "DEFERRED_EVENT_REPLAY_FAILED",
          deferred_chat_id: deferredEvent?.chatId ?? null,
          active_chat_id: chat.current(),
        });
        if (![
          "STALE_CHAT",
          "MESSAGE_NOT_FOUND",
          "SWIPE_NOT_FOUND",
        ].includes(error?.message)) throw error;
      }
    }
  }

  function clearGenerationLeaseTimer(gate) {
    if (!gate) return;
    if (gate.leaseTimer != null) {
      clearTimeout(gate.leaseTimer);
      gate.leaseTimer = null;
    }
    if (gate.hardWatchdogTimer != null) {
      clearTimeout(gate.hardWatchdogTimer);
      gate.hardWatchdogTimer = null;
    }
  }

  function clearGenerationActivityLease(gate) {
    if (gate?.leaseTimer == null) return;
    clearTimeout(gate.leaseTimer);
    gate.leaseTimer = null;
  }

  function expireGenerationGate(gate, {reason, hardStale = false} = {}) {
    if (destroyed || generationGate !== gate) return;
    const expired = lifecycleTail.then(async () => {
      if (destroyed || generationGate !== gate) return;
      clearGenerationLeaseTimer(gate);
      const deferredEvents = new Map(gate.pendingEvents);
      const pendingEventsAfterSafeReplay = new Map(
        [...deferredEvents].filter(([key]) => key !== "CHAT_CHANGED"),
      );
      const generationState = eventAnalysis.getAutoAnalysisSchedulerState?.() ?? {};
      const pendingGeneration = cloneValue(generationState.pendingGeneration);
      const pendingSwipeGeneration = cloneValue(generationState.pendingSwipeGeneration);
      const cancelledGeneration = eventAnalysis.cancelPendingGeneration?.(reason);
      generationLeaseExpiredBoundary = {
        chatId: chat.current(),
        epoch: chat.getEpoch(),
        generationIntentId: gate.generationIntentId ?? null,
        hardStale,
        pendingEvents: pendingEventsAfterSafeReplay,
        pendingGeneration,
        pendingSwipeGeneration,
        terminalKind: null,
      };
      generationGate = null;
      eventAnalysis.setGenerationAutomaticWorkDeferred?.(false);
      recordPersistenceTrace({
        stage: hardStale ? "GENERATION_GATE_HARD_WATCHDOG_EXPIRED" : "GENERATION_GATE_LEASE_EXPIRED",
        reason,
        generation_intent_id: gate.generationIntentId ?? null,
        deferred_event_count: deferredEvents.size,
        cancelled_generation_count: cancelledGeneration?.cancelled_count ?? 0,
        pending_generation_preserved: Boolean(pendingGeneration || pendingSwipeGeneration),
      });
      // A timer is only evidence that the START signal went stale. It is
      // safe to restore a read-only Chat binding, but never to authorize
      // analysis, lifecycle persistence, or Projection processing.
      await replayDeferredGenerationEvents(deferredEvents, {safeOnly: true});
      await recoverExpiredGenerationFromStableFloor(generationLeaseExpiredBoundary);
      const deferredChatChange = deferredEvents.get("CHAT_CHANGED");
      if (!hardStale && deferredChatChange &&
          (deferredChatChange.chatId == null ||
            String(deferredChatChange.chatId) === String(chat.current()))) {
        await projectionContext.refreshProjectionContext({
          chatId: chat.current(),
          readOnly: true,
        });
      }
    }).catch(error => {
      if (!destroyed) console.error("[BioWeave] generation lease recovery failed", error);
    });
    lifecycleTail = expired;
  }

  function armGenerationLease(gate, {reason, streamConfirmed = false} = {}) {
    if (!gate || generationGate !== gate || destroyed) return;
    clearGenerationActivityLease(gate);
    if (streamConfirmed) {
      gate.streamConfirmed = true;
      gate.actualGenerationEvidence = true;
    }
    const leaseToken = ++gate.leaseToken;
    const durationMs = gate.streamConfirmed
      ? generationStreamLeaseDurationMs
      : generationLeaseDurationMs;
    recordPersistenceTrace({
      stage: "GENERATION_GATE_LEASE_RENEWED",
      reason,
      lease_ms: gate.actualGenerationEvidence ? null : durationMs,
      expiry_disabled: false,
      hard_watchdog_ms: gate.hardWatchdogTimer == null ? generationHardWatchdogDurationMs : null,
      generation_intent_id: gate.generationIntentId ?? null,
    });
    if (!gate.actualGenerationEvidence) {
      gate.leaseTimer = setTimeout(() => {
        if (destroyed || generationGate !== gate || gate.leaseToken !== leaseToken) return;
        expireGenerationGate(gate, {reason: "generation-activity-lease-expired"});
      }, durationMs);
      gate.leaseTimer.unref?.();
    }
    if (gate.hardWatchdogTimer == null) {
      const hardWatchdogToken = gate.hardWatchdogToken;
      gate.hardWatchdogTimer = setTimeout(() => {
        if (destroyed || generationGate !== gate || gate.hardWatchdogToken !== hardWatchdogToken) return;
        expireGenerationGate(gate, {
          reason: "generation-hard-watchdog-expired",
          hardStale: true,
        });
      }, generationHardWatchdogDurationMs);
      gate.hardWatchdogTimer.unref?.();
    }
  }

  function generationHasSettled() {
    const state = eventAnalysis.getAutoAnalysisSchedulerState?.() ?? {};
    return !state.pendingGeneration && !state.pendingSwipeGeneration &&
      Boolean(state.completedGeneration || state.completedSwipeGeneration);
  }

  function generationEventSelector(payload) {
    if (Number.isInteger(payload))
      return {__messageIndex: true, index: payload};
    if (!payload || typeof payload !== "object") return null;
    const index = payload.message_index ?? payload.messageIndex ?? payload.index;
    if (Number.isInteger(index)) return {__messageIndex: true, index};
    const messageId = payload.message_id ?? payload.messageId;
    return messageId == null ? null : {message_id: messageId};
  }

  function generationIntentOwnsTarget(intent, target) {
    if (!intent || !target?.version) return false;
    if (intent.chatId != null && String(intent.chatId) !== String(chat.current()))
      return false;
    if (intent.messageId != null &&
        String(intent.messageId) !== String(target.version.message_id))
      return false;
    if (intent.swipeId != null &&
        String(intent.swipeId) !== String(target.version.swipe_id))
      return false;
    return true;
  }

  async function lateGenerationActivityConfirmed(boundary, key, payload) {
    if (!boundary || boundary.hardStale === true) return false;
    if (["GENERATION_STOPPED", "GENERATION_CANCELLED"].includes(boundary.terminalKind))
      return false;
    const intent = boundary.pendingGeneration ?? boundary.pendingSwipeGeneration;
    if (!intent) return false;
    if (key === "CHARACTER_MESSAGE_RENDERED" &&
        boundary.pendingEvents?.has("MESSAGE_RECEIVED"))
      return true;
    let target;
    try {
      target = await eventAnalysis.resolveCurrentBioWeaveFloor?.(
        generationEventSelector(payload),
      );
    } catch {
      return false;
    }
    if (!generationIntentOwnsTarget(intent, target)) return false;
    // A host generation token is an explicit operation identity. It proves
    // that the late render belongs to the pending generation even when the
    // logical Floor owner remains the same after a body edit.
    if (intent.generation_id != null) return true;
    if (!intent.baselineVersion) {
      return intent.messageId != null &&
        String(intent.messageId) === String(target.version.message_id);
    }
    return !sameFloorVersion(intent.baselineVersion, target.version);
  }

  async function reviveExpiredGeneration(boundary, key, payload) {
    if (boundary?.recovered === true) return false;
    if (!await lateGenerationActivityConfirmed(boundary, key, payload))
      return false;
    const restored = eventAnalysis.restorePendingGeneration?.(
      boundary.pendingGeneration ?? boundary.pendingSwipeGeneration,
      {ended: boundary.terminalKind === "GENERATION_ENDED"},
    );
    if (restored?.reason !== "generation-restored")
      return false;
    generationGate = createGenerationGate({
      generationIntentId: boundary.generationIntentId,
      pendingEvents: boundary.pendingEvents,
      active: true,
      actualGenerationEvidence: true,
    });
    generationLeaseExpiredBoundary = null;
    eventAnalysis.setGenerationAutomaticWorkDeferred?.(true);
    armGenerationLease(generationGate, {reason: "late-generation-activity"});
    recordPersistenceTrace({
      stage: "GENERATION_GATE_ACTIVITY_CONFIRMED",
      reason: key === "MESSAGE_RECEIVED"
        ? "late-message-received"
        : "late-character-message-rendered",
      generation_intent_id: generationGate.generationIntentId ?? null,
      restored_after_lease_expiry: true,
    });
    return true;
  }

  async function recoverExpiredGenerationFromStableFloor(boundary) {
    if (!boundary || boundary.hardStale === true || boundary.recovered === true)
      return false;
    const intent = boundary.pendingGeneration ?? boundary.pendingSwipeGeneration;
    if (!intent) return false;
    let target;
    let confirmed;
    try {
      target = await eventAnalysis.resolveCurrentBioWeaveFloor?.();
      if (!target?.version || !generationIntentOwnsTarget(intent, target)) return false;
      if (intent.baselineVersion && sameFloorVersion(intent.baselineVersion, target.version)) return false;
      // Read the owner twice. A stable complete Floor is required here; a
      // single changed read could still be an in-progress streaming update.
      confirmed = await eventAnalysis.resolveCurrentBioWeaveFloor?.({
        __messageIndex: true,
        index: target.index,
      });
      if (!confirmed?.version || !sameFloorVersion(confirmed.version, target.version)) return false;
      if (!confirmed.message || !isCharacterMessage(confirmed.message)) return false;
      if (!String(confirmed.message.content ?? confirmed.message.mes ?? "").trim()) return false;
    } catch {
      return false;
    }
    const restored = eventAnalysis.restorePendingGeneration?.(intent, {ended: true});
    if (restored?.reason !== "generation-restored") return false;
    const settled = await eventAnalysis.settleRecoveredGeneration?.(confirmed);
    if (settled?.skipped === true) return false;
    boundary.recovered = true;
    recordPersistenceTrace({
      stage: "GENERATION_FINAL_FLOOR_RECOVERED",
      reason: "stable-final-floor-after-activity-lease",
      generation_intent_id: boundary.generationIntentId ?? null,
      target_floor: confirmed.version.floor ?? null,
      target_message_id: confirmed.version.message_id ?? null,
    });
    return true;
  }

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

  function lifecycleRecoveryKey(target) {
    return JSON.stringify(stableValue({
      chat_id: target?.version?.chat_id ?? chat.current(),
      floor_version: target?.version ?? null,
      active_swipe_id: target?.swipeId ?? target?.version?.swipe_id ?? null,
    }));
  }

  function recordLifecycleRecoveryTrace({
    status,
    trigger,
    reasonCode,
    target = null,
    runId = null,
    errorCode = null,
    contextReady = null,
    enteredRecovery = null,
    trackingWindowFound = null,
    timingInstanceReused = null,
    timingInstanceCreated = null,
    aggregationReusedOrCreated = null,
    staleContextCancelled = null,
  } = {}) {
    const floorVersion = target?.version ?? null;
    const payload = {
      stage: "NSFW_LIFECYCLE_RECOVERY",
      recovery_status: status,
      recovery_trigger: trigger,
      execution_status: status,
      reason_code: reasonCode,
      run_id: runId,
      chat_id: floorVersion?.chat_id ?? chat.current(),
      floor_version: floorVersion,
      floor: Number.isFinite(floorVersion?.floor) ? floorVersion.floor : null,
      active_swipe_id: Number.isFinite(floorVersion?.swipe_id) ? floorVersion.swipe_id : null,
      error_code: errorCode,
      context_ready: contextReady,
      entered_recovery: enteredRecovery,
      tracking_window_found: trackingWindowFound,
      timing_instance_reused: timingInstanceReused,
      timing_instance_created: timingInstanceCreated,
      aggregation_reused_or_created: aggregationReusedOrCreated,
      stale_context_cancelled: staleContextCancelled,
      source_type: "EXECUTION_TRACE",
    };
    recordNsfwPipelineStage({stage: "PIPELINE_SCHEDULING", ...payload});
    try {
      recordPersistenceTrace(payload);
    } catch {
      // Recovery diagnostics are fail-open and must never alter lifecycle work.
    }
  }

  async function runLifecycleRecovery({trigger = "lifecycle-recovery", reason = "lifecycle-recovery", processTrigger = trigger, requireCandidate = true} = {}) {
    const initialChatId = chat.current();
    const initialEpoch = chat.getEpoch();
    if (!isBioWeaveEnabled()) {
      recordLifecycleRecoveryTrace({
        status: "SKIPPED",
        trigger,
        reasonCode: "PLUGIN_DISABLED",
        contextReady: false,
        enteredRecovery: false,
      });
      return {status: "disabled", reason: "PLUGIN_DISABLED"};
    }
    let target;
    try {
      target = await eventAnalysis.resolveCurrentBioWeaveFloor();
    } catch (error) {
      recordLifecycleRecoveryTrace({
        status: "DEFERRED_CONTEXT_NOT_READY",
        trigger,
        reasonCode: error?.code ?? error?.message ?? "CURRENT_FLOOR_UNAVAILABLE",
        errorCode: error?.code ?? error?.message ?? "CURRENT_FLOOR_UNAVAILABLE",
        contextReady: false,
        enteredRecovery: false,
      });
      return {status: "deferred", reason: error?.code ?? error?.message ?? "CURRENT_FLOOR_UNAVAILABLE"};
    }
    if (!target?.version) {
      recordLifecycleRecoveryTrace({
        status: "DEFERRED_CONTEXT_NOT_READY",
        trigger,
        reasonCode: "CURRENT_FLOOR_UNAVAILABLE",
        contextReady: false,
        enteredRecovery: false,
      });
      return {status: "deferred", reason: "CURRENT_FLOOR_UNAVAILABLE"};
    }
    if (chat.current() !== initialChatId || chat.getEpoch() !== initialEpoch) {
      recordLifecycleRecoveryTrace({
        status: "CANCELLED_STALE_CONTEXT",
        trigger,
        reasonCode: "CHAT_OR_EPOCH_CHANGED_BEFORE_RECOVERY",
        target,
        contextReady: false,
        enteredRecovery: false,
        staleContextCancelled: true,
      });
      return {status: "cancelled", reason: "CHAT_OR_EPOCH_CHANGED_BEFORE_RECOVERY"};
    }
    let activeEvents;
    try {
      activeEvents = await eventAnalysis.getCurrentFloorEvents();
    } catch (error) {
      recordLifecycleRecoveryTrace({
        status: "DEFERRED_CONTEXT_NOT_READY",
        trigger,
        reasonCode: error?.code ?? error?.message ?? "BUSINESS_STATE_UNAVAILABLE",
        target,
        errorCode: error?.code ?? error?.message ?? "BUSINESS_STATE_UNAVAILABLE",
        contextReady: false,
        enteredRecovery: false,
      });
      return {status: "deferred", reason: error?.code ?? error?.message ?? "BUSINESS_STATE_UNAVAILABLE"};
    }
    if (chat.current() !== initialChatId || chat.getEpoch() !== initialEpoch) {
      recordLifecycleRecoveryTrace({
        status: "CANCELLED_STALE_CONTEXT",
        trigger,
        reasonCode: "CHAT_OR_EPOCH_CHANGED_DURING_PREFLIGHT",
        target,
        contextReady: false,
        enteredRecovery: false,
        staleContextCancelled: true,
      });
      return {status: "cancelled", reason: "CHAT_OR_EPOCH_CHANGED_DURING_PREFLIGHT"};
    }
    const currentTarget = await eventAnalysis.resolveCurrentBioWeaveFloor().catch(() => null);
    if (!currentTarget?.version || !sameFloorVersion(currentTarget.version, target.version)) {
      recordLifecycleRecoveryTrace({
        status: "CANCELLED_STALE_CONTEXT",
        trigger,
        reasonCode: "FLOOR_VERSION_CHANGED_DURING_PREFLIGHT",
        target,
        contextReady: false,
        enteredRecovery: false,
        staleContextCancelled: true,
      });
      return {status: "cancelled", reason: "FLOOR_VERSION_CHANGED_DURING_PREFLIGHT"};
    }
    activeEvents = Array.isArray(activeEvents) ? activeEvents : [];
    const validExposureFound = activeEvents.some(event => {
      try { return isPregnancyRelevantExposure(event); } catch { return false; }
    });
    // Tracking Windows are derived from the same authoritative Event snapshot
    // consumed by projectionRuntime.process(). Do not rebuild a second
    // business DTO here merely to decide whether to schedule recovery.
    const trackingWindowFound = validExposureFound ? null : false;
    if (requireCandidate && !validExposureFound && !trackingWindowFound) {
      recordLifecycleRecoveryTrace({
        status: "NOT_TRIGGERED",
        trigger,
        reasonCode: "NO_VALID_EXPOSURE_OR_TRACKING_WINDOW",
        target,
        contextReady: true,
        enteredRecovery: false,
        trackingWindowFound: false,
      });
      return {status: "skipped", reason: "NO_VALID_EXPOSURE_OR_TRACKING_WINDOW"};
    }
    const key = lifecycleRecoveryKey(target);
    if (lifecycleRecoveryInFlight.has(key)) {
      recordLifecycleRecoveryTrace({
        status: "SKIPPED",
        trigger,
        reasonCode: "LIFECYCLE_RECOVERY_ALREADY_IN_FLIGHT",
        target,
        contextReady: true,
        enteredRecovery: false,
        trackingWindowFound,
      });
      return lifecycleRecoveryInFlight.get(key);
    }
    const work = (async () => {
      recordLifecycleRecoveryTrace({
        status: "ATTEMPTED",
        trigger,
        reasonCode: "LIFECYCLE_RECOVERY_STARTED",
        target,
        contextReady: true,
        enteredRecovery: true,
        trackingWindowFound,
      });
      let result;
      try {
        result = await projectionRuntime.process({
          reason,
          trigger: processTrigger,
          dedupeCompleted: true,
        });
      } catch (error) {
        recordLifecycleRecoveryTrace({
          status: "FAILED",
          trigger,
          reasonCode: "LIFECYCLE_RECOVERY_FAILED",
          target,
          errorCode: error?.code ?? error?.message ?? "LIFECYCLE_RECOVERY_FAILED",
          contextReady: true,
          enteredRecovery: true,
          trackingWindowFound,
        });
        return {status: "failed", reason: error?.code ?? error?.message ?? "LIFECYCLE_RECOVERY_FAILED"};
      }
      const finalTarget = await eventAnalysis.resolveCurrentBioWeaveFloor().catch(() => null);
      if (chat.current() !== initialChatId || chat.getEpoch() !== initialEpoch || !finalTarget?.version || !sameFloorVersion(finalTarget.version, target.version)) {
        recordLifecycleRecoveryTrace({
          status: "CANCELLED_STALE_CONTEXT",
          trigger,
          reasonCode: "FLOOR_VERSION_CHANGED_AFTER_RECOVERY",
          target,
          runId: result?.run_id ?? null,
          contextReady: true,
          enteredRecovery: true,
          trackingWindowFound,
          staleContextCancelled: true,
        });
        return {...(result ?? {}), status: "cancelled", reason: "FLOOR_VERSION_CHANGED_AFTER_RECOVERY"};
      }
      let recoveryOutcome = {};
      try {
        if (!result?.run_id) throw new Error("RECOVERY_TRACE_RUN_UNAVAILABLE");
        const trace = diagnostics.getNsfwPipelineDiagnostics?.({
          run_id: result.run_id,
          floor_version: target.version,
        });
        const stages = (trace?.stages ?? []).filter(stage =>
          stage?.run_id === result.run_id,
        );
        const timingStages = stages.filter(stage => stage?.stage === "TIMING_INSTANCE_CREATION");
        const aggregationEligibilityStages = stages.filter(stage => stage?.stage === "AGGREGATION_ELIGIBILITY_EVALUATION");
        const aggregationExecutionStages = stages.filter(stage => stage?.stage === "PARTICIPANT_AGGREGATION_EXECUTION");
        const aggregationPersistenceStages = stages.filter(stage => stage?.stage === "AGGREGATION_PERSISTENCE");
        const trackingStages = stages.filter(stage => stage?.stage === "TRACKING_WINDOW_RESOLUTION");
        const hasReason = (items, reasons) => items.some(item => reasons.has(item?.reason_code));
        recoveryOutcome = {
          trackingWindowFound: trackingStages.length
            ? trackingStages.some(stage => Number(stage?.output_count ?? 0) > 0)
            : null,
          timingInstanceReused: timingStages.length
            ? hasReason(timingStages, new Set(["TIMING_INSTANCE_EXISTS", "TIMING_INSTANCE_DEDUPED"]))
            : null,
          timingInstanceCreated: timingStages.length
            ? hasReason(timingStages, new Set(["TIMING_INSTANCE_PERSISTED"]))
            : null,
          aggregationReusedOrCreated: [
            ...aggregationEligibilityStages,
            ...aggregationExecutionStages,
            ...aggregationPersistenceStages,
          ].length
            ? hasReason(aggregationEligibilityStages, new Set(["AGGREGATION_ALREADY_SUCCEEDED"]))
              || hasReason(aggregationExecutionStages, new Set(["AGGREGATION_RESULT_BUILT"]))
              || hasReason(aggregationPersistenceStages, new Set(["AGGREGATION_PERSISTED", "AGGREGATION_DEDUPED"]))
            : null,
        };
      } catch {
        // The execution result remains authoritative when the optional trace
        // summary cannot be collected.
      }
      const resultStatus = result?.status === "success"
        ? "SUCCEEDED"
        : result?.status === "stale"
          ? "CANCELLED_STALE_CONTEXT"
          : result?.status === "partial"
            ? "ATTEMPTED"
            : "FAILED";
      recordLifecycleRecoveryTrace({
        status: resultStatus,
        trigger,
        reasonCode: result?.reason ?? (resultStatus === "SUCCEEDED" ? "LIFECYCLE_RECOVERY_COMPLETED" : "LIFECYCLE_RECOVERY_RESULT_NOT_SUCCESS"),
        target,
        runId: result?.run_id ?? null,
        errorCode: result?.errors?.[0]?.reason ?? null,
        contextReady: true,
        enteredRecovery: true,
        ...recoveryOutcome,
        trackingWindowFound: recoveryOutcome.trackingWindowFound ?? trackingWindowFound,
        staleContextCancelled: resultStatus === "CANCELLED_STALE_CONTEXT",
      });
      return result;
    })();
    lifecycleRecoveryInFlight.set(key, work);
    try {
      return await work;
    } finally {
      lifecycleRecoveryInFlight.delete(key);
    }
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
    if (key === "CHAT_CHANGED") {
      generationLeaseExpiredBoundary = null;
      projectionRuntime.clearCompletedAutomaticExecutions?.();
    }
    if (key === "GENERATION_STARTED" && !generationGate?.active && !generationGate?.startPending) {
      // Reserve the non-blocking gate synchronously so a Chat/message event
      // arriving before this listener's promise runs is still coalesced. The
      // gate becomes active only after Generation Lifecycle accepts the
      // payload, and is discarded for an unrecognized start signal.
      generationGate = createGenerationGate({
        startPending: true,
        generationIntentId: payload?.generation_id ?? payload?.generationId ?? null,
      });
      generationLeaseExpiredBoundary = null;
      armGenerationLease(generationGate, {reason: "generation-started-provisional"});
    }
    if (generationAutomaticWorkIsDeferred(key)) {
      markGenerationPending(key, eventType, payload, chatId);
      if (key === "CHAT_CHANGED") projectionContext.clearProjectionContext();
    }
    const ordinaryChatRebind = key === "CHAT_CHANGED" && !generationAutomaticWorkIsDeferred(key);
    if (ordinaryChatRebind) projectionContext.clearProjectionContext();
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
          readOnly: ordinaryChatRebind || key === "GENERATION_STARTED",
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
        if (key === "STREAM_TOKEN_RECEIVED") {
          if (generationGate?.active) {
            armGenerationLease(generationGate, {
              reason: "stream-token-received",
              streamConfirmed: true,
            });
          }
          notifyLifecycleSettled(key, eventType, payload);
          return;
        }
        const expiredBoundary = generationLeaseExpiredBoundary;
        const expiredBoundaryMatches = expiredBoundary &&
          String(expiredBoundary.chatId) === String(chat.current()) &&
          expiredBoundary.epoch === chat.getEpoch();
        let revivedExpiredGeneration = false;
        if (expiredBoundaryMatches && !expiredBoundary.hardStale && [
          "MESSAGE_RECEIVED",
          "CHARACTER_MESSAGE_RENDERED",
        ].includes(key)) {
          revivedExpiredGeneration = await reviveExpiredGeneration(
            expiredBoundary,
            key,
            payload,
          );
          if (revivedExpiredGeneration && key === "MESSAGE_RECEIVED")
            markGenerationPending(key, eventType, payload, chatId);
        }
        const leaseExpiredTerminal = expiredBoundaryMatches && [
          "GENERATION_ENDED",
          "GENERATION_STOPPED",
          "GENERATION_CANCELLED",
        ].includes(key);
        const hardWatchdogCharacterRender = expiredBoundaryMatches &&
          expiredBoundary.hardStale === true && key === "CHARACTER_MESSAGE_RENDERED";
        if (leaseExpiredTerminal) {
          if (!expiredBoundary.hardStale)
            expiredBoundary.terminalKind = key;
          eventAnalysis.cancelPendingGeneration?.("generation-lease-expired-terminal");
          recordPersistenceTrace({
            stage: "GENERATION_LEASE_EXPIRED_EVENT_IGNORED",
            host_event_key: key,
            reason: "activity-lease-expired",
            generation_intent_id: expiredBoundary.generationIntentId,
            deferred_chat_id: expiredBoundary.chatId,
            active_chat_id: chat.current(),
          });
          notifyLifecycleSettled(key, eventType, payload);
          return;
        }
        if (hardWatchdogCharacterRender ||
            (expiredBoundaryMatches && !revivedExpiredGeneration)) {
          recordPersistenceTrace({
            stage: "GENERATION_LEASE_EXPIRED_EVENT_IGNORED",
            host_event_key: key,
            reason: hardWatchdogCharacterRender
              ? "activity-lease-expired"
              : "activity-lease-quarantine",
            generation_intent_id: expiredBoundary.generationIntentId,
            deferred_chat_id: expiredBoundary.chatId,
            active_chat_id: chat.current(),
          });
          notifyLifecycleSettled(key, eventType, payload);
          return;
        }
        let runtimeResult = null;
        if (!runtimeHandlerPresent) {
          recordPersistenceTrace({
            stage: "HOST_EVENT_FORWARD_RESULT",
            ...hostEventDiagnostic,
            forwarded: false,
            forward_result: "runtime-handler-missing",
          });
        } else {
          try {
            runtimeResult = await eventAnalysis.handleLifecycleEvent({
              type: key,
              eventType,
              payload,
              chatId,
              deferAutomaticWork: generationAutomaticWorkIsDeferred(key),
            });
            if (key === "CHARACTER_MESSAGE_RENDERED" && generationGate?.active &&
                ["generation-awaiting-end", "generation-already-settled"].includes(runtimeResult?.reason)) {
              generationGate.actualGenerationEvidence = true;
              clearGenerationActivityLease(generationGate);
              recordPersistenceTrace({
                stage: "GENERATION_GATE_ACTIVITY_CONFIRMED",
                reason: "character-message-rendered",
                generation_intent_id: generationGate.generationIntentId ?? null,
              });
            }
            if (key === "GENERATION_STARTED" &&
                runtimeResult?.reason === "generation-pending") {
              // A previous terminal event may have released the provisional
              // gate while this async START continuation was awaiting the
              // lifecycle coordinator. Recreate the gate only when no newer
              // gate exists; never dereference the released global value.
              if (!generationGate) {
                generationGate = createGenerationGate({
                  generationIntentId: payload?.generation_id ?? payload?.generationId ?? null,
                });
              }
              generationGate.active = true;
              generationGate.startPending = false;
              armGenerationLease(generationGate, {reason: "generation-started"});
              eventAnalysis.setGenerationAutomaticWorkDeferred?.(true);
            } else if (key === "GENERATION_STARTED" &&
                runtimeResult?.reason === "generation-intent-already-pending") {
              armGenerationLease(generationGate, {reason: "generation-started-duplicate"});
            } else if (key === "GENERATION_STARTED") {
              clearGenerationLeaseTimer(generationGate);
              generationGate = null;
              eventAnalysis.setGenerationAutomaticWorkDeferred?.(false);
            }
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
        const generationEndedWithoutIntent = key === "GENERATION_ENDED" &&
          runtimeResult?.reason === "generation-ended-without-intent";
        const generationLifecycleIntentCleared = generationEndedWithoutIntent && (() => {
          const state = eventAnalysis.getAutoAnalysisSchedulerState?.() ?? {};
          return !state.pendingGeneration && !state.pendingSwipeGeneration &&
            !state.completedGeneration && !state.completedSwipeGeneration;
        })();
        let generationReleased = false;
        if (generationGate?.active) {
          const canRelease = key === "GENERATION_STOPPED" ||
            key === "GENERATION_CANCELLED" ||
            ((key === "GENERATION_ENDED" || key === "CHARACTER_MESSAGE_RENDERED") &&
              (generationHasSettled() || generationLifecycleIntentCleared));
          if (!canRelease) {
            if (key === "GENERATION_STARTED" &&
                runtimeResult?.reason === "generation-pending")
              await refreshGenerationProjectionContext();
            notifyLifecycleSettled(key, eventType, payload);
            return;
          }
          const deferredEvents = generationGate.pendingEvents;
          clearGenerationLeaseTimer(generationGate);
          recordPersistenceTrace({
            stage: "GENERATION_GATE_RELEASED",
            reason: key,
            generation_intent_id: generationGate.generationIntentId ?? null,
          });
          generationGate.active = false;
          generationGate = null;
          eventAnalysis.setGenerationAutomaticWorkDeferred?.(false);
          // Deferred Chat/message/Swipe events are intentionally not processed
          // while generation is active. Rebind and invalidate only after the
          // generation boundary settles, so an old Chat/Floor cannot refresh
          // state during the host request.
          await replayDeferredGenerationEvents(deferredEvents);
          if (key === "GENERATION_ENDED" || key === "CHARACTER_MESSAGE_RENDERED") {
            const finalTarget = await eventAnalysis.resolveCurrentBioWeaveFloor(
              key === "CHARACTER_MESSAGE_RENDERED" ? generationEventSelector(payload) : null,
            ).catch(() => null);
            if (finalTarget?.version) {
              const state = eventAnalysis.getAutoAnalysisSchedulerState?.() ?? {};
              await eventAnalysis.handoffSettledCharacterFloor(finalTarget, {
                reason: key,
                generation: state.completedGeneration ?? state.completedSwipeGeneration ?? null,
                lifecycleOutcome: {status: "generation-settled"},
              });
              await eventAnalysis.flushDeferredProjectionPostProcessor?.({target: finalTarget});
              generationReleased = true;
            } else {
              eventAnalysis.clearDeferredProjectionPostProcessor?.();
            }
          } else {
            eventAnalysis.clearDeferredProjectionPostProcessor?.();
          }
        }
        if (!generationReleased && generationLifecycleIntentCleared) {
          const finalTarget = await eventAnalysis.resolveCurrentBioWeaveFloor(
            key === "CHARACTER_MESSAGE_RENDERED" ? generationEventSelector(payload) : null,
          ).catch(() => null);
          if (finalTarget?.version) {
            const flushResult = await eventAnalysis.flushDeferredProjectionPostProcessor?.({target: finalTarget});
            generationReleased = flushResult?.status === "released";
          }
        }
        if (!ordinaryChatRebind) {
          try {
            await projectionRuntime.tickLifecycleOnly({reason: `story-time:${key}`});
          } catch (error) {
            if (!["STALE_CHAT", "MESSAGE_NOT_FOUND"].includes(error?.message))
              console.error("[BioWeave] projection lifecycle tick failed", error);
          }
        }
        if (key === "CHAT_CHANGED") await recordReloadFloorSlotAudit("chat-changed");
        await refreshActiveOwner(chat.current());
        if (!ordinaryChatRebind && ["CHAT_CHANGED", "CHAT_CREATED", "MESSAGE_RECEIVED", "GENERATION_ENDED", "GENERATION_STOPPED", "GENERATION_CANCELLED", "CHARACTER_MESSAGE_RENDERED"].includes(key) && !generationReleased) {
          const recovery = runLifecycleRecovery({
            trigger: `lifecycle-${key.toLowerCase()}`,
            reason: key === "MESSAGE_RECEIVED"
              ? "story-time:MESSAGE_RECEIVED"
              : `lifecycle-recovery:${key.toLowerCase()}`,
            processTrigger: key === "MESSAGE_RECEIVED" ? "story-time-progression" : `lifecycle-${key.toLowerCase()}`,
            requireCandidate: key !== "MESSAGE_RECEIVED",
          });
          if (["CHAT_CHANGED", "CHAT_CREATED", "MESSAGE_RECEIVED"].includes(key)) await recovery;
          else void recovery.catch(() => null);
        }
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
    try {
      await eventAnalysis.reconcileSchedulerState?.({reason: "runtime-init"});
    } catch (error) {
      // Floor Version hashing is a read preflight. A temporary hashing or
      // version failure must not abort runtime initialization or prevent the
      // status/business DTO paths from returning their safe diagnostics.
      if (error?.analysis_stage !== "floor_version") throw error;
    }
    await recordReloadFloorSlotAudit("runtime-init");
    try {
      await projectionContext.refreshProjectionContext({chatId: currentChatId});
    } catch (error) {
      console.error("[BioWeave] initial projection context refresh failed", error);
    }
    bindLifecycleEvents();
    initialized = true;
    try {
      await eventAnalysis.refreshTrackingRegistry("init");
    } catch (error) {
      if (error?.message !== "STALE_CHAT") {
        console.error(
          "[BioWeave] initial tracking registry refresh failed",
          error,
        );
      }
    }
    await runLifecycleRecovery({
      trigger: "lifecycle-runtime-init",
      reason: "runtime-init-recovery",
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

  async function getProjectionTimingDebugInternal() {
    const chatId = chat.current();
    const floor = await eventAnalysis.resolveCurrentBioWeaveFloor();
    if (!floor?.version || String(floor.version.chat_id) !== String(chatId)) {
      return {
        status: "unavailable",
        reason: "NO_CHARACTER_FLOOR",
        chat_id: chatId,
        timing_instances: [],
        timing_diagnostics: [],
        aggregation_diagnostics: [],
        authoritative_readback: {
          timing_snapshot_present: false,
          timing_instance_count: 0,
          timing_readback_succeeded: false,
          aggregation_readback_succeeded: false,
        },
      };
    }
    const timeline = await projectionTimingPersistence.getTimingInstances({chatId, endpointFloor: floor.version.floor, endpointIndex: floor.index});
    const business = await eventAnalysis.collectActiveBusinessData();
    const world = await eventAnalysis.resolveWorldModelAtOrBefore({__messageIndex: true, index: floor.index});
    const events = business.active_events ?? [];
    const confirmedSubjects = events.filter(event => event?.type === "pregnancy_confirmation" && event.status === "confirmed").flatMap(event => event?.state_fact?.subject_id ? [event.state_fact.subject_id] : (event?.pregnancy_relevance?.gestational_subject_ids ?? []));
    const terminatedSubjects = events.filter(event => ["pregnancy_loss", "abortion"].includes(event?.type) && event.status === "confirmed").flatMap(event => event?.state_fact?.subject_id ? [event.state_fact.subject_id] : (event?.pregnancy_relevance?.gestational_subject_ids ?? []));
    const rules = Array.isArray(world?.model?.projection_rules) ? world.model.projection_rules : [];
    const projections = await projectionPersistence.getProjectionViews({chatId, endpointFloor: floor.version.floor, endpointIndex: floor.index});
    const aggregations = await participantAggregationPersistence.getParticipantAggregations({chatId, endpointFloor: floor.version.floor, endpointIndex: floor.index});
    let executionTrace;
    try {
      executionTrace = diagnostics.getNsfwPipelineDiagnostics({chat_id: chatId, floor_version: floor.version});
    } catch {
      executionTrace = {
        source_type: "EXECUTION_TRACE",
        collection_status: "FAILED",
        trace_truncated: null,
        trace_buffer_status: "UNKNOWN",
        current_run_id: null,
        runs: [],
        stages: [],
      };
    }
    const traceStages = Array.isArray(executionTrace?.stages) ? executionTrace.stages : [];
    const traceRuns = Array.isArray(executionTrace?.runs) ? executionTrace.runs : [];
    const traceAvailable = traceStages.length > 0 || traceRuns.length > 0;
    const currentTraceRunId = executionTrace?.current_run_id ?? traceRuns.at(-1)?.run_id ?? null;
    const currentTraceRun = traceRuns.find(run => run?.run_id === currentTraceRunId) ?? null;
    const currentRunHasAggregationPersistence = traceStages.some(stage =>
      stage?.run_id === currentTraceRunId && stage?.stage === "AGGREGATION_PERSISTENCE",
    );
    const diagnosticTraceRunId = currentTraceRun?.execution_status === "ATTEMPTED" && !currentRunHasAggregationPersistence
      ? [...traceRuns].reverse().find(run =>
          run?.run_id !== currentTraceRunId && traceStages.some(stage =>
            stage?.run_id === run?.run_id && stage?.stage === "AGGREGATION_PERSISTENCE",
          ),
        )?.run_id ?? currentTraceRunId
      : currentTraceRunId;
    const currentStoryTime = business.current_story_time ?? null;
    const trackingWindows = Array.isArray(business.tracking_windows) ? business.tracking_windows : [];
    const scalarMatches = (actual, expected) =>
      expected === null || expected === undefined || actual === null || actual === undefined
        ? true
        : String(actual) === String(expected);
    const stageMatches = (stage, target = {}) =>
      scalarMatches(stage?.subject_id, target.subject_id) &&
      scalarMatches(stage?.mechanism_key, target.mechanism_key) &&
      scalarMatches(stage?.cycle_id, target.cycle_id) &&
      scalarMatches(stage?.tracking_window_id, target.tracking_window_id);
    const stagesFor = (stageName, target = {}) => traceStages
      .filter(stage => stage?.stage === stageName && stageMatches(stage, target) &&
        (diagnosticTraceRunId ? stage?.run_id === diagnosticTraceRunId : !stage?.run_id))
      .sort((left, right) => Number(left?.sequence ?? 0) - Number(right?.sequence ?? 0));
    const latestStage = (stageName, target = {}) => stagesFor(stageName, target).at(-1) ?? null;
    const stageForTarget = (stageName, target = {}) => latestStage(stageName, target);
    const eventById = new Map(events.map(event => [event?.event_id, event]));
    const exposureIdsFor = ({subjectId, mechanismKey, sourceEventIds = []} = {}) =>
      [...new Set(sourceEventIds)].filter(eventId => {
        const event = eventById.get(eventId);
        return event?.pregnancy_relevance?.relevant === true &&
          (event.pregnancy_relevance?.gestational_subject_ids ?? []).includes(subjectId) &&
          (!mechanismKey || event.pregnancy_relevance?.reproductive_mechanism?.kind === mechanismKey);
      });
    const storyElapsedDays = (referenceStoryTime) => {
      const difference = differenceStoryTime(currentStoryTime, referenceStoryTime);
      return difference?.unit === "day" && Number.isFinite(Number(difference.value))
        ? Number(difference.value)
        : null;
    };
    const sourceEventsFor = (subjectId, mechanismKey, sourceEventIds) =>
      exposureIdsFor({subjectId, mechanismKey, sourceEventIds});
    const candidateExposureInfoFor = ({subjectId, mechanismKey, sourceEventIds = []} = {}) => {
      const relevant = events.filter(event => {
        try {
          return isPregnancyRelevantExposure(event)
            && event?.pregnancy_relevance?.gestational_subject_ids?.includes(subjectId)
            && event?.pregnancy_relevance?.reproductive_mechanism?.kind === mechanismKey;
        } catch {
          return false;
        }
      });
      const sourceIds = new Set(sourceEventIds);
      const candidate = sourceIds.size
        ? relevant.filter(event => sourceIds.has(event.event_id))
        : relevant;
      const excludedCandidateReasons = sourceIds.size
        ? relevant
          .filter(event => !sourceIds.has(event.event_id))
          .map(event => ({event_id: event.event_id, reason_code: "EXPOSURE_NOT_IN_TIMING_BASIS"}))
        : [];
      return {
        relevant,
        candidate,
        candidate_exposure_event_ids: candidate.map(event => event.event_id),
        excluded_candidate_reasons: excludedCandidateReasons,
      };
    };
    const firstExposureFor = ({subjectId, mechanismKey, cycleId, candidateEvents = [], referenceStoryTime = null, sourceEventIds = []} = {}) => {
      const canonicalMatches = candidateEvents.filter(event => buildProjectionTimingCycleId({
        chatId,
        subjectId,
        mechanismKey,
        firstEvent: event,
      }) === cycleId);
      if (canonicalMatches.length === 1) return canonicalMatches[0];
      const sourceMatches = candidateEvents.filter(event =>
        sourceEventIds.includes(event?.event_id)
        && cycleStoryTimeEqual(event?.story_time, referenceStoryTime),
      );
      return sourceMatches.length === 1 ? sourceMatches[0] : null;
    };
    const windowMatchesInstance = (window, instance) =>
      window?.cycle_id === instance?.cycle_id &&
      window?.subject_id === instance?.subject_id &&
      window?.mechanism_key === instance?.mechanism_key
      || (
        window?.subject_id === instance?.subject_id
        && window?.mechanism_key === instance?.mechanism_key
        && (instance?.source_event_ids ?? []).some(eventId => (window?.source_event_ids ?? []).includes(eventId))
      );
    const findWindowForInstance = instance => trackingWindows.find(window => windowMatchesInstance(window, instance));
    const timingInstanceByTarget = (subjectId, mechanismKey, cycleId, window = null) => timeline.items.find(instance =>
      instance?.subject_id === subjectId &&
      instance?.mechanism_key === mechanismKey &&
      (!cycleId || instance?.cycle_id === cycleId),
    ) ?? (window
      ? timeline.items.find(instance =>
          instance?.subject_id === subjectId
          && instance?.mechanism_key === mechanismKey
          && (instance?.source_event_ids ?? []).some(eventId => (window?.source_event_ids ?? []).includes(eventId)),
        )
      : null);
    const diagnosticTargets = trackingWindows.map(window => ({
      window,
      instance: timingInstanceByTarget(window.subject_id, window.mechanism_key, window.cycle_id, window),
    }));
    for (const instance of timeline.items) {
      if (diagnosticTargets.some(target => target.instance?.timing_instance_id === instance?.timing_instance_id)) continue;
      diagnosticTargets.push({window: findWindowForInstance(instance), instance});
    }
    const instances = timeline.items.map(instance => ({
      ...instance,
      derived_timing: evaluateProjectionTiming({timingInstance: instance, currentStoryTime, events, subjectId: instance.subject_id, pregnancyConfirmed: confirmedSubjects.includes(instance.subject_id), terminated: terminatedSubjects.includes(instance.subject_id)}),
      aggregation: (() => {
        const aggregation = aggregations.items.find(item => item.timing_instance_id === instance.timing_instance_id && item.cycle_id === instance.cycle_id) ?? null;
        const trigger = resolveParticipantAggregationTrigger({timingInstance: instance, currentStoryTime, aggregation});
        return {
          aggregation_id: aggregation?.aggregation_id ?? null,
          succeeded: aggregation?.status === 'succeeded',
          due: aggregation?.status === 'succeeded' || trigger.eligible === true,
          status: aggregation?.status === 'succeeded' ? 'succeeded' : trigger.status,
          reason_code: aggregation?.status === 'succeeded' ? null : trigger.reason_code ?? null,
        };
      })(),
    }));
    const timingDiagnostics = diagnosticTargets.map(({window, instance}) => {
      const subjectId = instance?.subject_id ?? window?.subject_id ?? null;
      const mechanismKey = instance?.mechanism_key ?? window?.mechanism_key ?? null;
      const cycleId = instance?.cycle_id ?? window?.cycle_id ?? null;
      const trackingWindowId = window?.tracking_window_id ?? null;
      const sourceEventIds = [...new Set(instance?.source_event_ids ?? window?.source_event_ids ?? [])];
      const acceptedExposureEventIds = sourceEventsFor(subjectId, mechanismKey, sourceEventIds);
      const candidateExposureInfo = candidateExposureInfoFor({subjectId, mechanismKey, sourceEventIds});
      const firstExposureEvent = firstExposureFor({
        subjectId,
        mechanismKey,
        cycleId,
        candidateEvents: candidateExposureInfo.candidate,
        referenceStoryTime: instance?.reference_story_time ?? window?.opened_story_time ?? null,
        sourceEventIds,
      });
      const referenceStoryTime = firstExposureEvent?.story_time
        ?? instance?.reference_story_time
        ?? window?.opened_story_time
        ?? null;
      const cycleIdSource = window?.cycle_id === cycleId
        ? "TRACKING_WINDOW"
        : instance?.cycle_id === cycleId
          ? "TIMING_INSTANCE"
          : "UNAVAILABLE";
      const elapsedStoryDays = storyElapsedDays(referenceStoryTime);
      const target = {subject_id: subjectId, mechanism_key: mechanismKey, cycle_id: cycleId, tracking_window_id: trackingWindowId};
      const configurationStage = stageForTarget("TIMING_CONFIGURATION_RESOLUTION", target);
      const creationStage = stageForTarget("TIMING_INSTANCE_CREATION", target);
      const timingEvaluationStage = stageForTarget("TIMING_ELIGIBILITY_EVALUATION", target);
      const timingState = instance
        ? evaluateProjectionTiming({timingInstance: instance, currentStoryTime, events, subjectId, pregnancyConfirmed: confirmedSubjects.includes(subjectId), terminated: terminatedSubjects.includes(subjectId)})
        : null;
      const timingEvidence = instance
        ? {
            status: timingState?.status ?? "UNKNOWN",
            reason_code: timingState?.reason_code ?? "UNKNOWN",
            source_type: "CURRENT_STATE",
          }
        : creationStage
          ? {
              status: creationStage.execution_status ?? "UNKNOWN",
              reason_code: creationStage.reason_code ?? "UNKNOWN",
              source_type: "EXECUTION_TRACE",
            }
          : {
                status: "UNKNOWN",
                reason_code: "TRACE_UNAVAILABLE",
                source_type: "DERIVED_DIAGNOSTIC",
              };
      const aggregation = instance
        ? aggregations.items.find(item => item.timing_instance_id === instance.timing_instance_id && item.cycle_id === instance.cycle_id) ?? null
        : null;
      const trigger = instance
        ? resolveParticipantAggregationTrigger({timingInstance: instance, currentStoryTime, aggregation})
        : null;
      const aggregationStage = stageForTarget("AGGREGATION_ELIGIBILITY_EVALUATION", target);
      const aggregationExecutionStage = stageForTarget("PARTICIPANT_AGGREGATION_EXECUTION", target);
      const aggregationPersistenceStage = stageForTarget("AGGREGATION_PERSISTENCE", target);
      const aggregationReadbackStage = stageForTarget("AGGREGATION_READBACK", target);
      const manualTimingEditStage = stageForTarget("TIMING_INSTANCE_MANUAL_EDIT", target);
      const aggregationReevaluationStage = stageForTarget("AGGREGATION_REEVALUATION", target);
      let characterTimingConfig = null;
      try {
        characterTimingConfig = readCharacterTimingConfig(store.getChat(chatId), subjectId).config;
      } catch {
        characterTimingConfig = null;
      }
      const characterTimingConfigSource = characterTimingConfig
        ? "CHARACTER_OVERRIDE"
        : configurationStage?.timing_config_source === "HUMAN_BASELINE"
          ? "HUMAN_BASELINE"
          : null;
      const aggregationDue = aggregation
        ? aggregation.status === "succeeded" || trigger?.eligible === true
        : trigger?.eligible ?? null;
      const aggregationAttempted = aggregationExecutionStage
        ? aggregationExecutionStage.invoked
        : null;
      const aggregationBlockReason = aggregation
        ? null
        : aggregationStage?.reason_code
          ?? aggregationExecutionStage?.reason_code
          ?? (trigger && trigger.eligible !== true ? trigger.reason_code ?? trigger.status : null)
          ?? (traceAvailable ? "TRACE_UNAVAILABLE" : "TRACE_UNAVAILABLE");
      return {
        source_type: "DERIVED_DIAGNOSTIC",
        subject_id: subjectId,
        mechanism_key: mechanismKey,
        cycle_id: cycleId,
        tracking_window_id: trackingWindowId,
        tracking_window_status: window?.status ?? null,
        source_event_ids: sourceEventIds,
        tracking_window_cycle_id: window?.cycle_id ?? null,
        first_exposure_event_id: firstExposureEvent?.event_id ?? null,
        first_exposure_story_time_source: firstExposureEvent
          ? "CURRENT_EVENT_SNAPSHOT"
          : instance?.reference_story_time
            ? "TIMING_INSTANCE_SNAPSHOT"
            : window?.opened_story_time ? "TRACKING_WINDOW_SNAPSHOT" : "UNAVAILABLE",
        candidate_exposure_event_ids: candidateExposureInfo.candidate_exposure_event_ids,
        accepted_exposure_event_ids: acceptedExposureEventIds,
        excluded_candidate_reasons: candidateExposureInfo.excluded_candidate_reasons,
        final_cycle_id: cycleId,
        cycle_id_source: cycleIdSource,
        cycle_id_consistent: window?.cycle_id && cycleId
          ? window.cycle_id === cycleId
          : null,
        cycle_id_consistency_reason_code: window?.cycle_id && cycleId
          ? window.cycle_id === cycleId
            ? "TRACKING_WINDOW_CYCLE_MATCH"
            : "TRACKING_WINDOW_CYCLE_MISMATCH"
          : "TRACKING_WINDOW_CYCLE_UNAVAILABLE",
        first_exposure_story_time: cloneValue(referenceStoryTime),
        current_story_time: cloneValue(currentStoryTime),
        story_time_reason_code: elapsedStoryDays === null ? "story_time_unresolved" : null,
        timing_config_available: instance?.config_snapshot
          ? true
          : typeof configurationStage?.timing_config_available === "boolean"
            ? configurationStage.timing_config_available
            : null,
        timing_config_source: configurationStage?.timing_config_source
          ?? (instance?.config_snapshot ? "TIMING_INSTANCE_SNAPSHOT" : null),
        timing_instance_exists: Boolean(instance),
        timing_instance_id: instance?.timing_instance_id ?? null,
        timing_instance_readback_attempted: true,
        timing_instance_readback_succeeded: true,
        timing_instance_readback_result_present: Boolean(instance),
        timing_instance_readback_reason_code: instance ? "TIMING_INSTANCE_READBACK_PRESENT" : "TIMING_INSTANCE_READBACK_NOT_FOUND",
        base_min_story_days: instance?.base_min_story_days ?? null,
        base_max_story_days: instance?.base_max_story_days ?? null,
        variance_ratio: instance?.variance_ratio ?? null,
        variance_cap_story_days: instance?.variance_cap_story_days ?? null,
        sampled_individual_offset_story_days: instance?.sampled_individual_offset_story_days ?? null,
        state_modifier_story_days: instance?.state_modifier_story_days ?? null,
        total_adjustment_story_days: instance?.total_adjustment_story_days ?? null,
        total_adjustment_cap_story_days: instance?.total_adjustment_cap_story_days ?? null,
        effective_min_story_days: instance?.effective_min_story_days ?? null,
        effective_max_story_days: instance?.effective_max_story_days ?? null,
        world_rule_binding: instance?.world_rule_binding ?? null,
        timing_instance_resolution: manualTimingEditStage?.execution_status === "SUCCEEDED"
          ? "MANUALLY_EDITED"
          : creationStage?.reason_code === "TIMING_INSTANCE_EXISTS"
          ? "REUSED"
          : creationStage?.reason_code === "TIMING_INSTANCE_PERSISTED"
            ? "CREATED"
            : instance ? "CURRENT_STATE_PRESENT" : "UNKNOWN",
        timing_status: timingEvidence.status,
        timing_reason_code: timingEvidence.reason_code,
        timing_evidence_source: timingEvidence.source_type,
        timing_execution_status: creationStage?.execution_status ?? null,
        timing_configuration_execution_status: configurationStage?.execution_status ?? null,
        timing_eligibility_execution_status: timingEvaluationStage?.execution_status ?? null,
        character_timing_config: {
          min_story_days: characterTimingConfig?.base_min_story_days
            ?? (characterTimingConfigSource === "HUMAN_BASELINE" ? configurationStage?.base_min_story_days : null),
          max_story_days: characterTimingConfig?.base_max_story_days
            ?? (characterTimingConfigSource === "HUMAN_BASELINE" ? configurationStage?.base_max_story_days : null),
          source: characterTimingConfigSource,
        },
        active_timing_instance: instance
          ? {
              timing_instance_id: instance.timing_instance_id,
              cycle_id: instance.cycle_id,
              base_min_story_days: instance.base_min_story_days,
              base_max_story_days: instance.base_max_story_days,
              sampled_offset_story_days: instance.sampled_individual_offset_story_days,
              effective_min_story_days: instance.effective_min_story_days,
              effective_max_story_days: instance.effective_max_story_days,
              source_floor: cloneValue(instance.created_at_floor_version ?? null),
              readback_status: "PRESENT",
            }
          : null,
        manual_timing_edit: manualTimingEditStage?.manual_timing_edit ?? {
          attempted: false,
          succeeded: null,
          target_cycle_id: cycleId,
          persisted_floor: null,
          readback_status: "NOT_ATTEMPTED",
        },
        aggregation_reevaluation: aggregationReevaluationStage?.aggregation_reevaluation ?? {
          attempted: false,
          previous_status: aggregation?.status ?? null,
          new_trigger_status: trigger?.status ?? null,
          action: "NOT_ATTEMPTED",
          readback_status: "NOT_ATTEMPTED",
        },
        aggregation_due: aggregationDue,
        aggregation_attempted: aggregationAttempted,
        aggregation_block_reason: aggregationBlockReason,
        aggregation_id: aggregation?.aggregation_id ?? aggregationExecutionStage?.aggregation_id ?? null,
        aggregation_execution_status: aggregationExecutionStage?.execution_status ?? null,
        aggregation_persistence_status: aggregationPersistenceStage?.execution_status ?? null,
        aggregation_readback_status: aggregationReadbackStage?.execution_status ?? null,
        run_id: creationStage?.run_id ?? aggregationStage?.run_id ?? executionTrace?.current_run_id ?? null,
      };
    });
    const aggregationDiagnostics = diagnosticTargets.map(({window, instance}) => {
      const subjectId = instance?.subject_id ?? window?.subject_id ?? null;
      const mechanismKey = instance?.mechanism_key ?? window?.mechanism_key ?? null;
      const cycleId = instance?.cycle_id ?? window?.cycle_id ?? null;
      const timingDiagnostic = timingDiagnostics.find(item => item.subject_id === subjectId && item.mechanism_key === mechanismKey && item.cycle_id === cycleId) ?? null;
      const candidateExposureInfo = candidateExposureInfoFor({
        subjectId,
        mechanismKey,
        sourceEventIds: instance?.source_event_ids ?? window?.source_event_ids ?? [],
      });
      const target = {subject_id: subjectId, mechanism_key: mechanismKey, cycle_id: cycleId, tracking_window_id: window?.tracking_window_id ?? null};
      const eligibilityStage = stageForTarget("AGGREGATION_ELIGIBILITY_EVALUATION", target);
      const executionStages = stagesFor("PARTICIPANT_AGGREGATION_EXECUTION", target);
      const executionStage = executionStages.at(-1) ?? null;
      const persistenceStage = stageForTarget("AGGREGATION_PERSISTENCE", target);
      const readbackStage = stageForTarget("AGGREGATION_READBACK", target);
      const aggregationReevaluationStage = stageForTarget("AGGREGATION_REEVALUATION", target);
      const aggregation = instance
        ? aggregations.items.find(item => item.timing_instance_id === instance.timing_instance_id && item.cycle_id === instance.cycle_id) ?? null
        : null;
      const currentStatePresent = aggregation?.status === "succeeded";
      const manualReevaluationAction = aggregationReevaluationStage?.aggregation_reevaluation?.action ?? null;
      const persistenceSucceeded = persistenceStage?.execution_status === "SUCCEEDED"
        && persistenceStage?.persistence_succeeded !== false;
      const trigger = instance
        ? resolveParticipantAggregationTrigger({timingInstance: instance, currentStoryTime, aggregation})
        : null;
      const status = currentStatePresent
        ? "SUCCEEDED"
        : manualReevaluationAction === "removed_before_min"
          ? "REMOVED"
          : manualReevaluationAction
            ? "REEVALUATED"
        : persistenceStage?.execution_status === "PERSIST_FAILED"
          ? "PERSIST_FAILED"
          : persistenceSucceeded
            ? "READBACK_FAILED"
          : executionStage?.execution_status ?? eligibilityStage?.execution_status ?? "UNKNOWN";
      const reasonCode = currentStatePresent
        ? "AGGREGATION_CURRENT_STATE_PRESENT"
          : manualReevaluationAction
            ? `AGGREGATION_REEVALUATION_${manualReevaluationAction.toUpperCase()}`
          : persistenceStage?.reason_code
          ?? executionStage?.reason_code
          ?? eligibilityStage?.reason_code
          ?? "TRACE_UNAVAILABLE";
      const finalReasonCode = currentStatePresent
        ? reasonCode
        : persistenceSucceeded
          ? "AGGREGATION_READBACK_NOT_FOUND"
          : reasonCode;
      const upstreamTimingReason = timingDiagnostic?.timing_reason_code ?? null;
      const resolvedReasonCode = finalReasonCode === "TIMING_INSTANCE_MISSING"
        ? upstreamTimingReason && upstreamTimingReason !== "TIMING_INSTANCE_MISSING"
          ? upstreamTimingReason
          : "TRACE_UNAVAILABLE"
        : finalReasonCode;
      return {
        source_type: "DERIVED_DIAGNOSTIC",
        subject_id: subjectId,
        cycle_id: cycleId,
        final_cycle_id: cycleId,
        cycle_id_source: timingDiagnostic?.cycle_id_source ?? (window?.cycle_id === cycleId ? "TRACKING_WINDOW" : instance ? "TIMING_INSTANCE" : "UNAVAILABLE"),
        cycle_id_consistent: window?.cycle_id && cycleId
          ? window.cycle_id === cycleId
          : null,
        cycle_id_consistency_reason_code: window?.cycle_id && cycleId
          ? window.cycle_id === cycleId
            ? "TRACKING_WINDOW_CYCLE_MATCH"
            : "TRACKING_WINDOW_CYCLE_MISMATCH"
          : "TRACKING_WINDOW_CYCLE_UNAVAILABLE",
        mechanism_key: mechanismKey,
        tracking_window_cycle_id: window?.cycle_id ?? null,
        first_exposure_event_id: timingDiagnostic?.first_exposure_event_id ?? null,
        first_exposure_story_time: timingDiagnostic?.first_exposure_story_time ?? null,
        current_story_time: cloneValue(currentStoryTime),
        candidate_exposure_event_ids: timingDiagnostic?.candidate_exposure_event_ids ?? candidateExposureInfo.candidate_exposure_event_ids,
        accepted_exposure_event_ids: timingDiagnostic?.accepted_exposure_event_ids ?? sourceEventsFor(subjectId, mechanismKey, instance?.source_event_ids ?? window?.source_event_ids ?? []),
        excluded_candidate_reasons: timingDiagnostic?.excluded_candidate_reasons ?? candidateExposureInfo.excluded_candidate_reasons,
        candidate_exposure_count: timingDiagnostic?.candidate_exposure_event_ids?.length ?? candidateExposureInfo.candidate_exposure_event_ids.length,
        accepted_exposure_count: timingDiagnostic?.accepted_exposure_event_ids?.length
          ?? sourceEventsFor(subjectId, mechanismKey, instance?.source_event_ids ?? window?.source_event_ids ?? []).length,
        effective_min_story_days: instance?.effective_min_story_days ?? null,
        effective_max_story_days: instance?.effective_max_story_days ?? null,
        aggregation_trigger_status: instance ? (currentStatePresent ? "already_succeeded" : trigger?.status ?? null) : null,
        aggregation_due: instance ? (currentStatePresent || trigger?.eligible === true) : null,
        aggregation_overdue: trigger?.status === "aggregate_due_overdue",
        existing_aggregation_succeeded: currentStatePresent,
        aggregation_status: status,
        aggregation_reason_code: resolvedReasonCode,
        aggregation_immediate_block_reason: reasonCode,
        upstream_timing_reason_code: upstreamTimingReason,
        aggregation_invoked: executionStage?.invoked ?? null,
        aggregation_attempt_count: executionStages.length ? executionStages.filter(stage => stage?.invoked === true).length : null,
        aggregation_id: aggregation?.aggregation_id ?? executionStage?.aggregation_id ?? aggregationReevaluationStage?.aggregation_id ?? null,
        aggregation_execution_result: executionStage?.reason_code ?? null,
        persistence_attempted: persistenceStage?.persistence_attempted ?? aggregationReevaluationStage?.persistence_attempted ?? null,
        persistence_succeeded: persistenceStage?.persistence_succeeded
          ?? aggregationReevaluationStage?.persistence_succeeded
          ?? (currentStatePresent ? true : null),
        readback_attempted: true,
        readback_succeeded: true,
        readback_result_present: currentStatePresent,
        readback_reason_code: currentStatePresent ? "AGGREGATION_READBACK_PRESENT" : "AGGREGATION_READBACK_NOT_FOUND",
        last_attempt_at: persistenceStage?.completed_at ?? executionStage?.completed_at ?? executionStage?.started_at ?? aggregation?.created_at ?? null,
        aggregation_reevaluation: aggregationReevaluationStage?.aggregation_reevaluation ?? {
          attempted: false,
          previous_status: aggregation?.status ?? null,
          new_trigger_status: trigger?.status ?? null,
          action: "NOT_ATTEMPTED",
          readback_status: "NOT_ATTEMPTED",
        },
        timing_instance_id: instance?.timing_instance_id ?? null,
        tracking_window_id: window?.tracking_window_id ?? null,
        run_id: executionStage?.run_id ?? eligibilityStage?.run_id ?? executionTrace?.current_run_id ?? null,
      };
    });
    const eligibility = instances.length ? evaluateProjectionEligibility({
      currentState: business.current_state ?? {},
      events,
      sourceCandidates: Object.values(business.tracking_candidates ?? {}),
      worldModel: world?.model ?? {},
      currentStoryTime: business.current_story_time ?? null,
      existingProjections: projections?.all ?? [],
      preConfirmationTiming: {enabled: true, instances, windows: business.tracking_windows ?? [], confirmedSubjects, terminatedSubjects, aggregations: aggregations.items},
    }) : {decisions: [], diagnostics: []};
    const projectionEligibilityStage = stageForTarget("PROJECTION_ELIGIBILITY");
    const projectionAiSchedulingStage = stageForTarget("PROJECTION_AI_SCHEDULING");
    const generationCandidates = eligibility.decisions.filter(decision =>
      decision.eligibility === "eligible" && !decision.existing_projection_id,
    );
    const builtInCandidate = generationCandidates.some(decision =>
      decision.projection_source === "built_in_pre_confirmation",
    ) || (projections?.all ?? []).some(projection =>
      projection?.context_visible === true
      && projection?.aggregation_path === "participant_aggregation"
      && (projection?.development_concern_key === BUILT_IN_PRE_CONFIRMATION_CONCERN
        || projection?.development_concern_key?.startsWith(`${BUILT_IN_PRE_CONFIRMATION_CONCERN}:`)),
    );
    const worldRuleCandidate = generationCandidates.some(decision =>
      decision.projection_source === "world_model_rule",
    );
    let persistenceTrace = null;
    try { persistenceTrace = diagnostics.getPersistenceTrace?.() ?? null; } catch { persistenceTrace = null; }
    const projectionTraceFloorMatches = entry => {
      const entryFloor = entry?.floor_version;
      if (!entryFloor || !floor?.version) return false;
      return ['chat_id', 'message_id', 'floor', 'swipe_id']
        .every(field => String(entryFloor[field] ?? '') === String(floor.version[field] ?? ''));
    };
    const projectionAiRequestEntries = (persistenceTrace?.sequence ?? []).filter(entry =>
      entry?.stage === "PROJECTION_AI_REQUEST_STARTED"
      && projectionTraceFloorMatches(entry)
      && (!currentTraceRunId || entry?.run_id === currentTraceRunId),
    );
    const projectionStatusStages = new Set([
      'PROJECTION_INTERNAL_TRIGGERED', 'PROJECTION_FLOOR_OWNER_READY',
      'PROJECTION_PROCESS_STARTED', 'PROJECTION_PROCESS_FAILED',
      'PROJECTION_TIMING_EVALUATED', 'PROJECTION_ELIGIBILITY',
      'PROJECTION_STAGE_REUSED', 'PROJECTION_AI_PLAN', 'PROJECTION_AI_SKIPPED',
      'PROJECTION_BUILT_IN_CANDIDATE', 'PROJECTION_BUILT_IN_CANDIDATE_COMPLETED',
      'PROJECTION_AI_REQUEST_STARTED', 'PROJECTION_AI_REQUEST_COMPLETED',
      'PROJECTION_STAGE_SNAPSHOT', 'PROJECTION_PERSISTENCE', 'PROJECTION_READBACK',
    ]);
    const projectionStatusTrace = (persistenceTrace?.sequence ?? [])
      .filter(entry => projectionStatusStages.has(entry?.stage) && projectionTraceFloorMatches(entry))
      .slice(-16);
    const latestProjectionStatus = projectionStatusTrace.at(-1) ?? null;
    const latestProjectionRoute = [...projectionStatusTrace]
      .reverse()
      .find(entry => entry?.projection_route != null || entry?.external_api_allowed != null)
      ?? projectionAiSchedulingStage
      ?? null;
    const latestInternalTrigger = [...projectionStatusTrace]
      .reverse()
      .find(entry => entry?.stage === 'PROJECTION_INTERNAL_TRIGGERED')
      ?? null;
    const latestStageReuse = [...projectionStatusTrace]
      .reverse()
      .find(entry => entry?.stage === 'PROJECTION_STAGE_REUSED')
      ?? null;
    const latestStageSnapshot = [...projectionStatusTrace]
      .reverse()
      .find(entry => entry?.stage === 'PROJECTION_STAGE_SNAPSHOT')
      ?? null;
    return {
      status: "ok",
      chat_id: chatId,
      floor_version: floor.version,
      current_story_time: business.current_story_time ?? null,
      timing_instances: instances,
      timing_diagnostics: timingDiagnostics,
      aggregation_diagnostics: aggregationDiagnostics,
      execution_trace: executionTrace,
      readback_diagnostic: null,
      timing_runtime: {
        creation_policy: 'exposure_based',
        projection_rules_available: rules.length > 0,
        projection_rules_count: rules.length,
        projection_rules_source: 'CURRENT_STATE',
        projection_rules_effect: rules.length > 0
          ? 'PROJECTION_ELIGIBILITY_ONLY'
          : 'NO_RULES_NO_TIMING_BLOCK',
        status: instances.length > 0 ? 'ready' : 'no_timing_instance',
        reason_code: instances.length > 0 ? null : 'no_valid_timing_instance',
      },
      projection_rule_ids: rules.map(rule => rule.projection_rule_id).filter(Boolean),
      projection_eligibility: eligibility.decisions.map(decision => ({subject_id: decision.subject_id, development_concern_key: decision.development_concern_key, projection_source: decision.projection_source ?? null, timing_instance_id: decision.timing_instance_id ?? null, effective_min_story_days: decision.effective_min_story_days ?? null, effective_max_story_days: decision.effective_max_story_days ?? null, reason_code: decision.reason_code, eligibility: decision.eligibility, timing_status: decision.timing_status ?? null, projection_id: decision.existing_projection_id ?? null, aggregation_evidence_invalid_event_ids: decision.aggregation_evidence_invalid_event_ids ?? []})),
      projection_diagnostics: {
        source_type: "DERIVED_DIAGNOSTIC",
        projection_rules_available: rules.length > 0,
        projection_rules_count: rules.length,
        eligibility_status: projectionEligibilityStage?.execution_status ?? (traceAvailable ? "UNKNOWN" : "TRACE_UNAVAILABLE"),
        eligibility_reason_code: projectionEligibilityStage?.reason_code ?? (rules.length ? "TRACE_UNAVAILABLE" : "projection_rules_unavailable"),
        timing_window_entered: eligibility.decisions.some(decision => decision.timing_status === "window_open"),
        timing_window_statuses: [...new Set(eligibility.decisions.map(decision => decision.timing_status).filter(Boolean))],
        projection_candidate_status: builtInCandidate || worldRuleCandidate ? "candidate_available" : "no_candidate",
        projection_candidate_source: builtInCandidate
          ? "built_in_pre_confirmation"
          : worldRuleCandidate ? "world_model_rule" : null,
        ai_scheduling_status: projectionAiSchedulingStage?.execution_status ?? (traceAvailable ? "UNKNOWN" : "TRACE_UNAVAILABLE"),
        ai_scheduling_reason_code: projectionAiSchedulingStage?.reason_code ?? (rules.length ? "TRACE_UNAVAILABLE" : "NO_ELIGIBLE_PROJECTION"),
        projection_ai_request_started: projectionAiRequestEntries.length > 0,
        projection_ai_request_count: projectionAiRequestEntries.length,
        last_projection_route: latestProjectionRoute?.projection_route ?? null,
        last_external_api_allowed: typeof latestProjectionRoute?.external_api_allowed === 'boolean'
          ? latestProjectionRoute.external_api_allowed
          : null,
        last_status_stage: latestProjectionStatus?.stage ?? null,
        last_status_state: latestProjectionStatus?.state ?? null,
        last_internal_trigger: latestInternalTrigger
          ? {
              reason: latestInternalTrigger.reason ?? null,
              analysis_execution_id: latestInternalTrigger.analysis_execution_id ?? null,
            }
          : null,
        scheduler_decision: latestInternalTrigger?.scheduler_decision ?? null,
        stage_reuse: latestStageReuse
          ? {
              subject_count: latestStageReuse.subject_count ?? null,
              reused_candidate_count: latestStageReuse.reused_candidate_count ?? null,
              stage_keys: latestStageReuse.stage_keys ?? [],
            }
          : null,
        stage_snapshot: latestStageSnapshot
          ? {
              status: latestStageSnapshot.snapshot_status ?? null,
              candidate_count: latestStageSnapshot.candidate_count ?? null,
              subject_count: latestStageSnapshot.subject_count ?? null,
              stage_keys: latestStageSnapshot.stage_keys ?? [],
              failure_reason: latestStageSnapshot.failure_reason ?? null,
            }
          : null,
        status_trace: projectionStatusTrace.map(entry => ({
          stage: entry.stage ?? null,
          state: entry.state ?? null,
          phase: entry.phase ?? null,
          reason: entry.reason ?? null,
          projection_route: entry.projection_route ?? null,
          external_api_allowed: typeof entry.external_api_allowed === 'boolean'
            ? entry.external_api_allowed
            : null,
          scheduler_decision: entry.scheduler_decision ?? null,
          analysis_execution_id: entry.analysis_execution_id ?? null,
          snapshot_status: entry.snapshot_status ?? null,
          candidate_count: entry.candidate_count ?? null,
          subject_count: entry.subject_count ?? null,
          reused_candidate_count: entry.reused_candidate_count ?? null,
          deferred_external_api_candidate_count: entry.deferred_external_api_candidate_count ?? null,
          failure_reason: entry.failure_reason ?? null,
        })),
      },
      projection_ids: (projections?.all ?? []).map(item => item.projection_id).filter(Boolean),
      authoritative_readback: {
        timing_readback_attempted: true,
        timing_snapshot_present: timeline.items.length > 0,
        timing_instance_count: timeline.items.length,
        timing_readback_succeeded: true,
        timing_readback_result_present: timeline.items.length > 0,
        aggregation_readback_attempted: true,
        aggregation_count: aggregations.items.length,
        aggregation_readback_succeeded: true,
        aggregation_readback_result_present: aggregations.items.length > 0,
        basis_record_count: 0,
      },
    };
  }

  async function getProjectionTimingDebug() {
    try {
      return await getProjectionTimingDebugInternal();
    } catch (error) {
      let executionTrace;
      try {
        executionTrace = diagnostics.getNsfwPipelineDiagnostics({chat_id: chat.current()});
      } catch {
        executionTrace = {
          source_type: "EXECUTION_TRACE",
          collection_status: "FAILED",
          trace_truncated: null,
          trace_buffer_status: "UNKNOWN",
          current_run_id: null,
          runs: [],
          stages: [],
        };
      }
      return {
        status: "unavailable",
        reason: "READBACK_FAILED",
        readback_error_code: error?.code ?? error?.message ?? "PROJECTION_TIMING_READBACK_FAILED",
        timing_instances: [],
        timing_diagnostics: [],
        aggregation_diagnostics: [],
        projection_diagnostics: {
          source_type: "DERIVED_DIAGNOSTIC",
          projection_rules_available: null,
          projection_rules_count: null,
          eligibility_status: "READBACK_FAILED",
          eligibility_reason_code: "READBACK_FAILED",
          timing_window_entered: null,
          timing_window_statuses: [],
          projection_candidate_status: null,
          projection_candidate_source: null,
          ai_scheduling_status: "READBACK_FAILED",
          ai_scheduling_reason_code: "READBACK_FAILED",
          projection_ai_request_started: null,
          projection_ai_request_count: null,
        },
        execution_trace: executionTrace,
        readback_diagnostic: {
          stage: "CURRENT_STATE_READBACK",
          execution_status: "READBACK_FAILED",
          source_type: "DERIVED_DIAGNOSTIC",
          reason_code: "READBACK_FAILED",
          invoked: true,
          error_code: error?.code ?? error?.message ?? "PROJECTION_TIMING_READBACK_FAILED",
        },
        timing_runtime: {
          creation_policy: "exposure_based",
          projection_rules_available: null,
          projection_rules_count: null,
          projection_rules_source: "CURRENT_STATE_UNAVAILABLE",
          projection_rules_effect: "UNKNOWN",
          status: "unavailable",
          reason_code: "READBACK_FAILED",
        },
        authoritative_readback: {
          timing_readback_attempted: true,
          timing_snapshot_present: false,
          timing_instance_count: 0,
          timing_readback_succeeded: false,
          timing_readback_result_present: false,
          aggregation_readback_attempted: true,
          aggregation_count: 0,
          aggregation_readback_succeeded: false,
          aggregation_readback_result_present: false,
          basis_record_count: 0,
        },
      };
    }
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
      projectionTimingPersistence.getTimingInstances({
        chatId,
        endpointFloor: floor?.version?.floor,
        endpointIndex: floor?.index,
        // Opening the editor establishes the edit-start boundary. This lets
        // the read path inspect a stale current owner slot only after the
        // current authoritative version has been captured; ordinary reads
        // remain exact-match only.
        editStartFloorVersion: floor?.version ?? null,
      }),
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
    const subjectTimingInstances = (timeline?.items ?? []).filter(instance => instance.subject_id === id);
    if (subjectTimingInstances.length > 1) {
      throw Object.assign(new Error('TIMING_INSTANCE_AMBIGUOUS'), {
        code: 'TIMING_INSTANCE_AMBIGUOUS',
        subject_id: id,
        candidate_timing_instance_ids: subjectTimingInstances.map(instance => instance.timing_instance_id),
      });
    }
    const timingInstance = subjectTimingInstances[0] ?? null;
    return {
      character_id: id,
      config: resolved.config,
      overridden: Boolean(override),
      human_preset_applicable: humanApplicable,
      human_preset_version: HUMAN_PRECONFIRMATION_TIMING_PRESET_VERSION,
      timing_instance: timingInstance,
      floor_version: cloneValue(floor?.version ?? null),
      chat_id: chatId,
    };
  }

  async function editCharacterTimingInstance({characterId, timingInstanceId, baseMinStoryDays, baseMaxStoryDays, varianceRatio, varianceCapStoryDays, totalAdjustmentCapStoryDays, editStartFloorVersion = null, performanceOperationId = null} = {}) {
    assertBioWeaveEnabled();
    const subjectId = String(characterId ?? '').trim();
    if (!subjectId) throw Object.assign(new TypeError('character_id:required'), {code: 'CHARACTER_ID_REQUIRED'});

    const floor = await eventAnalysis.resolveCurrentBioWeaveFloor();
    const chatId = chat.current();
    if (!floor?.version || String(floor.version.chat_id) !== String(chatId)) {
      throw Object.assign(new Error('NO_CHARACTER_FLOOR'), {code: 'NO_CHARACTER_FLOOR'});
    }
    const floorVersion = floor.version;
    const editStartVersion = editStartFloorVersion ?? floorVersion;
    const ownerFloor = floorOwnerForProjection(floor);
    const runId = startNsfwPipelineRun({
      trigger: 'manual-timing-instance-edit',
      chat_id: chatId,
      floor_version: floorVersion,
      edit_start_floor_version: editStartVersion,
      reason_code: 'MANUAL_TIMING_INSTANCE_EDIT',
    });
    async function measureTimingPerformanceStage(stage, callback, {kind = 'ASYNC', ...fields} = {}) {
      if (!performanceOperationId) return callback();
      const startedAt = monotonicNow();
      try {
        const result = await callback();
        recordTimingPerformanceStage({
          operation_id: performanceOperationId,
          stage,
          kind,
          status: 'SUCCEEDED',
          duration_ms: durationMs(startedAt),
          ...fields,
        });
        return result;
      } catch (error) {
        recordTimingPerformanceStage({
          operation_id: performanceOperationId,
          stage,
          kind,
          status: 'FAILED',
          duration_ms: durationMs(startedAt),
          reason_code: fields.reason_code ?? 'TIMING_PERFORMANCE_STAGE_FAILED',
          error_code: error?.code ?? error?.message ?? 'TIMING_PERFORMANCE_STAGE_FAILED',
          ...fields,
        });
        throw error;
      }
    }
    let runFinished = false;
    const finish = payload => {
      if (runFinished) return;
      runFinished = true;
      finishNsfwPipelineRun(runId, payload);
    };
    const stageBase = {
      run_id: runId,
      chat_id: chatId,
      floor_version: floorVersion,
      owner_message_index: Number.isInteger(Number(floor.index)) ? Number(floor.index) : null,
      owner_message_id: floorVersion.message_id ?? null,
      subject_id: subjectId,
      timing_instance_id: null,
      source_type: 'EXECUTION_TRACE',
      operation_type: 'manual-timing-instance-edit',
      performance_operation_id: performanceOperationId,
    };
    const fail = (error, {stage = null, execution_status = 'FAILED', reason_code = 'TIMING_INSTANCE_MANUAL_EDIT_FAILED', ...details} = {}) => {
      if (stage) recordNsfwPipelineStage({
        ...stageBase,
        stage,
        execution_status,
        reason_code,
        invoked: true,
        error_code: error?.code ?? error?.message ?? reason_code,
        version_validation_layer: error?.validation_layer ?? null,
        version_validation_source: error?.validation_source ?? null,
        owner_message_index: error?.owner_message_index ?? null,
        owner_message_id: error?.owner_message_id ?? null,
        expected_floor_version: error?.expected_floor_version ?? error?.version_audit?.expected ?? null,
        actual_floor_version: error?.actual_floor_version ?? error?.version_audit?.actual ?? null,
        stored_floor_version: error?.stored_floor_version ?? null,
        version_mismatch_fields: error?.version_audit?.mismatch_fields ?? [],
        stored_version_audit: error?.stored_version_audit ?? null,
        version_classification: error?.version_classification ?? null,
        ...details,
      });
      finish({execution_status, reason_code, error_code: error?.code ?? error?.message ?? reason_code});
      throw error;
    };

    try {
      let before;
      try {
        before = await measureTimingPerformanceStage('TIMING_INSTANCE_RESOLUTION', () => projectionTimingPersistence.getTimingInstances({
          chatId,
          endpointFloor: floorVersion.floor,
          endpointIndex: floor.index,
          editStartFloorVersion: editStartVersion,
        }), {persistence_attempted: false, readback_attempted: true, readback_succeeded: true});
      } catch (error) {
        return fail(error, {
          stage: 'TIMING_INSTANCE_MANUAL_EDIT',
          execution_status: 'BLOCKED',
          reason_code: error?.code === 'FLOOR_VERSION_STALE'
            ? 'TIMING_INSTANCE_EDIT_STALE_CONTEXT'
            : 'TIMING_INSTANCE_READ_FAILED',
          persistence_attempted: false,
          persistence_succeeded: false,
          readback_attempted: false,
          readback_succeeded: false,
          manual_timing_edit: {
            attempted: false,
            succeeded: false,
            target_cycle_id: null,
            persisted_floor: null,
            readback_status: 'NOT_ATTEMPTED',
          },
        });
      }
      const subjectInstances = before.items.filter(item => item?.subject_id === subjectId);
      if (subjectInstances.length > 1) {
        const error = Object.assign(new Error('TIMING_INSTANCE_AMBIGUOUS'), {
          code: 'TIMING_INSTANCE_AMBIGUOUS',
          timing_instance_ids: subjectInstances.map(item => item.timing_instance_id),
        });
        return fail(error, {
          stage: 'TIMING_INSTANCE_MANUAL_EDIT',
          execution_status: 'BLOCKED',
          reason_code: 'TIMING_INSTANCE_AMBIGUOUS',
          manual_timing_edit: {
            attempted: false,
            succeeded: false,
            target_cycle_id: null,
            persisted_floor: null,
            readback_status: 'AMBIGUOUS',
          },
        });
      }
      const current = subjectInstances[0] ?? null;
      if (!current) {
        const error = Object.assign(new Error('TIMING_INSTANCE_NOT_FOUND'), {code: 'TIMING_INSTANCE_NOT_FOUND'});
        return fail(error, {
          stage: 'TIMING_INSTANCE_MANUAL_EDIT',
          execution_status: 'BLOCKED',
          reason_code: 'TIMING_INSTANCE_NOT_FOUND',
          manual_timing_edit: {
            attempted: false,
            succeeded: false,
            target_cycle_id: null,
            persisted_floor: null,
            readback_status: 'NOT_FOUND',
          },
        });
      }
      // The current character instance is the authoritative edit target. The
      // UI may send a stale timing_instance_id, but it must not override the
      // current-floor character lookup or make a valid edit fail.
      const requestedTimingInstanceId = current.timing_instance_id;
      const editVarianceRatio = varianceRatio ?? current.variance_ratio;
      const editVarianceCap = varianceCapStoryDays ?? current.variance_cap_story_days;
      const editTotalCap = totalAdjustmentCapStoryDays ?? current.total_adjustment_cap_story_days;
      stageBase.timing_instance_id = requestedTimingInstanceId;
      stageBase.mechanism_key = current.mechanism_key;
      const manualTimingEdit = {
        attempted: true,
        succeeded: false,
        source: 'manual_ui',
        submitted_values: {
          base_min_story_days: Number(baseMinStoryDays),
          base_max_story_days: Number(baseMaxStoryDays),
          variance_ratio: Number(editVarianceRatio),
          variance_cap_story_days: Number(editVarianceCap),
          total_adjustment_cap_story_days: Number(editTotalCap),
        },
        frozen_offset_status: 'PRESERVED',
        sampled_offset_source: 'FROZEN_SNAPSHOT',
        target_cycle_id: current.cycle_id,
        persisted_floor: floorVersion,
        readback_status: 'NOT_ATTEMPTED',
      };
      recordNsfwPipelineStage({
        ...stageBase,
        stage: 'TIMING_INSTANCE_MANUAL_EDIT',
        execution_status: 'ATTEMPTED',
        reason_code: 'TIMING_INSTANCE_EDIT_STARTED',
        invoked: true,
        cycle_id: current.cycle_id,
        base_min_story_days: Number(baseMinStoryDays),
        base_max_story_days: Number(baseMaxStoryDays),
        variance_ratio: Number(editVarianceRatio),
        variance_cap_story_days: Number(editVarianceCap),
        total_adjustment_cap_story_days: Number(editTotalCap),
        sampled_individual_offset_story_days: Number(current.sampled_individual_offset_story_days),
        frozen_offset_status: 'PRESERVED',
        sampled_offset_source: 'FROZEN_SNAPSHOT',
        manual_edit_source: 'manual_ui',
        effective_min_story_days: current.effective_min_story_days,
        effective_max_story_days: current.effective_max_story_days,
        manual_timing_edit: manualTimingEdit,
      });

      let persistedTiming;
      try {
        persistedTiming = await measureTimingPerformanceStage('TIMING_INSTANCE_PERSISTENCE', () => projectionTimingPersistence.editTimingInstance({
          chatId,
          ownerFloor,
          floorVersion,
          timingInstanceId: requestedTimingInstanceId,
          baseMinStoryDays,
          baseMaxStoryDays,
          varianceRatio: editVarianceRatio,
          varianceCapStoryDays: editVarianceCap,
          totalAdjustmentCapStoryDays: editTotalCap,
          operation_type: 'manual-timing-instance-edit',
          editStartFloorVersion: editStartVersion,
          performanceOperationId,
        }), {persistence_attempted: true});
      } catch (error) {
        manualTimingEdit.readback_status = 'NOT_ATTEMPTED';
        const validationFailure = String(error?.message ?? error?.code ?? '').startsWith('projection_timing.');
        manualTimingEdit.frozen_offset_status = String(error?.message ?? '').includes('sampled_offset:outside_allowed_range')
          || String(error?.message ?? '').includes('sampled_offset:outside_variance_cap')
          ? 'REJECTED_OUTSIDE_NEW_ALLOWED_RANGE'
          : 'NOT_EVALUATED';
        return fail(error, {
          stage: 'TIMING_INSTANCE_MANUAL_EDIT',
          execution_status: validationFailure ? 'FAILED' : 'PERSIST_FAILED',
          reason_code: validationFailure ? 'TIMING_INSTANCE_EDIT_INVALID' : 'TIMING_INSTANCE_PERSISTENCE_FAILED',
          cycle_id: current.cycle_id,
          sampled_individual_offset_story_days: current.sampled_individual_offset_story_days,
          persistence_attempted: !validationFailure,
          persistence_succeeded: false,
          manual_timing_edit: manualTimingEdit,
        });
      }

      let timingReadback;
      try {
      timingReadback = await measureTimingPerformanceStage('TIMING_INSTANCE_READBACK', () => projectionTimingPersistence.getTimingInstances({
          chatId,
          endpointFloor: floorVersion.floor,
          endpointIndex: floor.index,
          editStartFloorVersion: editStartVersion,
        }), {readback_attempted: true});
      } catch (error) {
        manualTimingEdit.readback_status = 'FAILED';
        return fail(error, {
          stage: 'TIMING_INSTANCE_MANUAL_EDIT',
          execution_status: 'READBACK_FAILED',
          reason_code: 'TIMING_INSTANCE_READBACK_FAILED',
          cycle_id: current.cycle_id,
          sampled_individual_offset_story_days: current.sampled_individual_offset_story_days,
          persistence_attempted: true,
          persistence_succeeded: ['created', 'updated', 'deduped'].includes(persistedTiming?.status),
          readback_attempted: true,
          readback_succeeded: false,
          readback_result_present: false,
          manual_timing_edit: manualTimingEdit,
        });
      }
      const editedTiming = timingReadback.items.find(item => item.timing_instance_id === requestedTimingInstanceId && item.subject_id === subjectId) ?? null;
      if (!editedTiming
        || editedTiming.cycle_id !== current.cycle_id
        || editedTiming.base_min_story_days !== Number(baseMinStoryDays)
        || editedTiming.base_max_story_days !== Number(baseMaxStoryDays)
        || editedTiming.variance_ratio !== Number(editVarianceRatio)
        || editedTiming.sampled_individual_offset_story_days !== Number(current.sampled_individual_offset_story_days)
        || editedTiming.variance_cap_story_days !== Number(editVarianceCap)
        || editedTiming.total_adjustment_cap_story_days !== Number(editTotalCap)) {
        const error = Object.assign(new Error('TIMING_INSTANCE_READBACK_FAILED'), {code: 'TIMING_INSTANCE_READBACK_FAILED'});
        manualTimingEdit.readback_status = 'FAILED';
        return fail(error, {
          stage: 'TIMING_INSTANCE_MANUAL_EDIT',
          execution_status: 'READBACK_FAILED',
          reason_code: 'TIMING_INSTANCE_READBACK_FAILED',
          cycle_id: current.cycle_id,
          sampled_individual_offset_story_days: current.sampled_individual_offset_story_days,
          persistence_attempted: true,
          persistence_succeeded: ['created', 'updated', 'deduped'].includes(persistedTiming?.status),
          readback_attempted: true,
          readback_succeeded: false,
          readback_result_present: Boolean(editedTiming),
          manual_timing_edit: manualTimingEdit,
        });
      }
      manualTimingEdit.succeeded = true;
      manualTimingEdit.readback_status = 'SUCCEEDED';
      recordNsfwPipelineStage({
        ...stageBase,
        stage: 'TIMING_INSTANCE_MANUAL_EDIT',
        execution_status: 'SUCCEEDED',
        reason_code: 'TIMING_INSTANCE_EDIT_PERSISTED',
        invoked: true,
        cycle_id: editedTiming.cycle_id,
        timing_instance_id: editedTiming.timing_instance_id,
        base_min_story_days: editedTiming.base_min_story_days,
        base_max_story_days: editedTiming.base_max_story_days,
        variance_ratio: editedTiming.variance_ratio,
        variance_cap_story_days: editedTiming.variance_cap_story_days,
        total_adjustment_cap_story_days: editedTiming.total_adjustment_cap_story_days,
        sampled_individual_offset_story_days: editedTiming.sampled_individual_offset_story_days,
        frozen_offset_status: 'PRESERVED',
        sampled_offset_source: 'FROZEN_SNAPSHOT',
        manual_edit_source: 'manual_ui',
        effective_min_story_days: editedTiming.effective_min_story_days,
        effective_max_story_days: editedTiming.effective_max_story_days,
        persistence_attempted: true,
        persistence_succeeded: ['created', 'updated', 'deduped'].includes(persistedTiming?.status),
        readback_attempted: true,
        readback_succeeded: true,
        readback_result_present: true,
        readback_reason_code: 'TIMING_INSTANCE_READBACK_PRESENT',
        manual_timing_edit: manualTimingEdit,
      });

      const aggregationInputs = await measureTimingPerformanceStage('AGGREGATION_REEVALUATION_INPUT', async () => ({
        business: await eventAnalysis.getParticipantAggregationInputs({
          subjectId,
          mechanismKey: editedTiming.mechanism_key,
          target: floor,
        }),
        aggregationSnapshot: await participantAggregationPersistence.getParticipantAggregations({
          chatId,
          endpointFloor: floorVersion.floor,
          endpointIndex: floor.index,
          editStartFloorVersion: editStartVersion,
        }),
      }), {aggregation_reevaluation_attempted: true});
      const business = aggregationInputs.business;
      const currentEvents = Array.isArray(business.active_events) ? business.active_events : [];
      const aggregationSnapshot = aggregationInputs.aggregationSnapshot;
      const existing = aggregationSnapshot.items.find(item =>
        item.timing_instance_id === editedTiming.timing_instance_id && item.cycle_id === editedTiming.cycle_id,
      ) ?? null;
      const trackingWindow = (business.tracking_windows ?? []).find(window =>
        window?.subject_id === subjectId
        && window?.mechanism_key === editedTiming.mechanism_key
        && (window?.cycle_id === editedTiming.cycle_id
          || (editedTiming.source_event_ids ?? []).some(eventId => (window?.source_event_ids ?? []).includes(eventId))),
      ) ?? null;
      const trigger = resolveParticipantAggregationTrigger({
        timingInstance: editedTiming,
        currentStoryTime: business.current_story_time ?? null,
        // A manual edit must reevaluate the frozen Timing rather than taking
        // the automatic already_succeeded shortcut before timing is checked.
        aggregation: null,
      });
      const candidateExposureEvents = currentEvents.filter(event => {
        try {
          return isPregnancyRelevantExposure(event)
            && event?.pregnancy_relevance?.gestational_subject_ids?.includes(subjectId)
            && event?.pregnancy_relevance?.reproductive_mechanism?.kind === editedTiming.mechanism_key;
        } catch {
          return false;
        }
      });
      const candidateExposureEventIds = candidateExposureEvents.map(event => event.event_id);
      const acceptedExposureEventIds = editedTiming.source_event_ids.filter(eventId => candidateExposureEventIds.includes(eventId));
      const reevaluation = {
        attempted: true,
        previous_status: existing?.status ?? null,
        new_trigger_status: trigger.status ?? null,
        action: 'NOT_ATTEMPTED',
        readback_status: 'NOT_ATTEMPTED',
      };
      const aggregationBase = {
        ...stageBase,
        stage: 'AGGREGATION_REEVALUATION',
        tracking_window_id: trackingWindow?.tracking_window_id ?? null,
        tracking_window_cycle_id: trackingWindow?.cycle_id ?? null,
        cycle_id: editedTiming.cycle_id,
        aggregation_id: existing?.aggregation_id ?? buildParticipantAggregationId({
          cycleId: editedTiming.cycle_id,
          timingInstanceId: editedTiming.timing_instance_id,
        }),
        effective_min_story_days: editedTiming.effective_min_story_days,
        effective_max_story_days: editedTiming.effective_max_story_days,
        aggregation_trigger_status: trigger.status ?? null,
        aggregation_due: trigger.eligible === true,
        existing_aggregation_succeeded: existing?.status === 'succeeded',
        accepted_exposure_count: acceptedExposureEventIds.length,
        aggregation_reevaluation: reevaluation,
      };

      if (trigger.status === 'before_min') {
        if (existing) {
          let removed;
          try {
            removed = await measureTimingPerformanceStage('AGGREGATION_PERSISTENCE', () => participantAggregationPersistence.removeAggregation({
              chatId,
              ownerFloor,
              floorVersion,
              editStartFloorVersion: editStartVersion,
              aggregationId: existing.aggregation_id,
              operation_type: 'manual-timing-aggregation-reevaluation',
              performanceOperationId,
            }), {persistence_attempted: true});
          } catch (error) {
            reevaluation.action = 'remove_failed';
            reevaluation.readback_status = 'NOT_ATTEMPTED';
            return fail(error, {
              ...aggregationBase,
              execution_status: 'PERSIST_FAILED',
              reason_code: 'AGGREGATION_PERSISTENCE_FAILED',
              persistence_attempted: true,
              persistence_succeeded: false,
            });
          }
          const afterRemoval = await measureTimingPerformanceStage('AGGREGATION_READBACK', () => participantAggregationPersistence.getParticipantAggregations({
            chatId,
            endpointFloor: floorVersion.floor,
            endpointIndex: floor.index,
            editStartFloorVersion: editStartVersion,
          }), {readback_attempted: true, aggregation_reevaluation_succeeded: true});
          const stillPresent = afterRemoval.items.some(item => item.aggregation_id === existing.aggregation_id);
          if (stillPresent) {
            reevaluation.action = 'remove_readback_failed';
            reevaluation.readback_status = 'FAILED';
            const error = Object.assign(new Error('AGGREGATION_READBACK_FAILED'), {code: 'AGGREGATION_READBACK_FAILED'});
            return fail(error, {
              ...aggregationBase,
              execution_status: 'READBACK_FAILED',
              reason_code: 'AGGREGATION_READBACK_FAILED',
              persistence_attempted: true,
              persistence_succeeded: ['removed', 'deduped'].includes(removed?.status),
              readback_attempted: true,
              readback_succeeded: false,
              readback_result_present: true,
            });
          }
          reevaluation.action = 'removed_before_min';
          reevaluation.readback_status = 'SUCCEEDED';
        } else {
          reevaluation.action = 'not_due_before_min';
        }
      } else if (trigger.eligible === true) {
        if (!existing && !acceptedExposureEventIds.length) {
          reevaluation.action = 'blocked_missing_exposure';
        } else {
          const aggregationRecord = existing
            ? {
                ...existing,
                reference_story_time: editedTiming.reference_story_time,
                effective_min_story_days: editedTiming.effective_min_story_days,
                effective_max_story_days: editedTiming.effective_max_story_days,
                sampled_individual_offset_story_days: editedTiming.sampled_individual_offset_story_days,
                config_snapshot: editedTiming.config_snapshot,
                source_basis_refs: editedTiming.source_basis_refs,
                accepted_exposure_event_ids: acceptedExposureEventIds.length
                  ? acceptedExposureEventIds
                  : existing.accepted_exposure_event_ids,
              }
            : upsertParticipantAggregation({
                aggregation_id: buildParticipantAggregationId({
                  cycleId: editedTiming.cycle_id,
                  timingInstanceId: editedTiming.timing_instance_id,
                }),
                pregnancy_id: editedTiming.pregnancy_id ?? null,
                subject_id: editedTiming.subject_id,
                mechanism_key: editedTiming.mechanism_key,
                cycle_id: editedTiming.cycle_id,
                timing_instance_id: editedTiming.timing_instance_id,
                aggregation_trigger_strategy: 'at_effective_min',
                reference_story_time: editedTiming.reference_story_time,
                aggregation_story_time: business.current_story_time ?? null,
                effective_min_story_days: editedTiming.effective_min_story_days,
                effective_max_story_days: editedTiming.effective_max_story_days,
                sampled_individual_offset_story_days: editedTiming.sampled_individual_offset_story_days,
                config_snapshot: editedTiming.config_snapshot,
                accepted_exposure_event_ids: acceptedExposureEventIds,
                source_basis_refs: editedTiming.source_basis_refs,
                created_at_floor_version: floorVersion,
                created_at: new Date().toISOString(),
              }, {snapshot: {schema_version: 1, items: []}, expectedChatId: chatId}).snapshot.items[0];
          let persistedAggregation;
          try {
            persistedAggregation = await measureTimingPerformanceStage('AGGREGATION_PERSISTENCE', () => participantAggregationPersistence.upsertAggregation({
              chatId,
              ownerFloor,
              floorVersion,
              aggregation: aggregationRecord,
              operation_type: 'manual-timing-aggregation-reevaluation',
              editStartFloorVersion: editStartVersion,
              performanceOperationId,
            }), {persistence_attempted: true});
          } catch (error) {
            reevaluation.action = existing ? 'preserve_update_failed' : 'create_failed';
            reevaluation.readback_status = 'NOT_ATTEMPTED';
            const wrapped = Object.assign(new Error('AGGREGATION_REEVALUATION_FAILED'), {
              code: 'AGGREGATION_REEVALUATION_FAILED',
              cause: error,
              timing_persisted: true,
              aggregation_persistence_succeeded: false,
            });
            return fail(wrapped, {
              ...aggregationBase,
              execution_status: 'PERSIST_FAILED',
              reason_code: 'AGGREGATION_PERSISTENCE_FAILED',
              aggregation_id: aggregationRecord.aggregation_id,
              persistence_attempted: true,
              persistence_succeeded: false,
            });
          }
          const aggregationReadback = await measureTimingPerformanceStage('AGGREGATION_READBACK', () => participantAggregationPersistence.getParticipantAggregations({
            chatId,
            endpointFloor: floorVersion.floor,
            endpointIndex: floor.index,
            editStartFloorVersion: editStartVersion,
          }), {readback_attempted: true, aggregation_reevaluation_succeeded: true});
          const confirmedAggregation = aggregationReadback.items.find(item => item.aggregation_id === aggregationRecord.aggregation_id) ?? null;
          if (!confirmedAggregation || confirmedAggregation.cycle_id !== editedTiming.cycle_id) {
            reevaluation.action = existing ? 'preserve_readback_failed' : 'create_readback_failed';
            reevaluation.readback_status = 'FAILED';
            const error = Object.assign(new Error('AGGREGATION_READBACK_FAILED'), {code: 'AGGREGATION_READBACK_FAILED'});
            return fail(error, {
              ...aggregationBase,
              execution_status: 'READBACK_FAILED',
              reason_code: 'AGGREGATION_READBACK_FAILED',
              aggregation_id: aggregationRecord.aggregation_id,
              persistence_attempted: true,
              persistence_succeeded: ['created', 'updated', 'deduped'].includes(persistedAggregation?.status),
              readback_attempted: true,
              readback_succeeded: false,
              readback_result_present: Boolean(confirmedAggregation),
            });
          }
          reevaluation.action = existing ? 'preserved_due' : 'created_due';
          reevaluation.readback_status = 'SUCCEEDED';
          aggregationBase.aggregation_id = confirmedAggregation.aggregation_id;
        }
      } else {
        reevaluation.action = trigger.status === 'unresolved' ? 'unresolved' : 'not_due';
      }

      recordNsfwPipelineStage({
        ...aggregationBase,
        execution_status: reevaluation.action === 'blocked_missing_exposure' ? 'BLOCKED' : 'SUCCEEDED',
        reason_code: reevaluation.action === 'blocked_missing_exposure'
          ? 'ACCEPTED_EXPOSURE_MISSING'
          : `AGGREGATION_REEVALUATION_${reevaluation.action.toUpperCase()}`,
        invoked: true,
        persistence_attempted: reevaluation.readback_status !== 'NOT_ATTEMPTED',
        persistence_succeeded: reevaluation.readback_status === 'SUCCEEDED',
        readback_attempted: reevaluation.readback_status !== 'NOT_ATTEMPTED',
        readback_succeeded: reevaluation.readback_status === 'SUCCEEDED',
        readback_result_present: reevaluation.action === 'preserved_due' || reevaluation.action === 'created_due',
      });
      finish({execution_status: 'SUCCEEDED', reason_code: 'MANUAL_TIMING_INSTANCE_EDIT_COMPLETED'});
      return {
        status: 'succeeded',
        timing_instance: editedTiming,
        timing_persistence: persistedTiming,
        timing_readback: {succeeded: true, present: true},
        aggregation_reevaluation: reevaluation,
      };
    } catch (error) {
      if (!runFinished) finish({execution_status: 'FAILED', reason_code: 'MANUAL_TIMING_INSTANCE_EDIT_FAILED', error_code: error?.code ?? error?.message ?? 'MANUAL_TIMING_INSTANCE_EDIT_FAILED'});
      throw error;
    }
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
    clearGenerationLeaseTimer(generationGate);
    generationGate = null;
    generationLeaseExpiredBoundary = null;
    versionChainByExecution.clear();
    projectionRuntime.destroy();
  projectionStorylineRuntime?.destroy?.();
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
    startTimingPerformanceOperation,
    recordTimingPerformanceStage,
    finishTimingPerformanceOperation,
    getTimingPerformanceDiagnostics: diagnostics.getTimingPerformanceDiagnostics,
    getCurrentFloorAnalysisInput: eventAnalysis.getCurrentFloorAnalysisInput,
    getCurrentFloorEvents: eventAnalysis.getCurrentFloorEvents,
    syncHealthRecoverySnapshot: eventAnalysis.syncHealthRecoverySnapshot,
    resolveCharacterRegistryAtOrBefore: eventAnalysis.resolveCharacterRegistryAtOrBefore,
    getCurrentCharacterIdentity: eventAnalysis.getCurrentCharacterIdentity,
    updateCharacterAliases: eventAnalysis.updateCharacterAliases,
    getCurrentStoryTime: storyTimeCoordinator.getCurrentStoryTime,
    getCurrentStoryTimeInfo: storyTimeCoordinator.getCurrentStoryTimeInfo,
    getStoryTimeDebugTrace: storyTimeCoordinator.getDebugTrace,
    getStoryTimeDebugInfo,
    getProjectionTimingDebug,
    getCharacterTimingEditorData,
    editCharacterTimingInstance,
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
    collectActiveBusinessData: async (...args) => {
      const options = args[0] ?? {};
      const business = await eventAnalysis.collectActiveBusinessData(...args);
      const projection = await projectionRuntime.getBusinessData({
        businessData: business,
        includeDebug: options.includeDebug === true,
      });
      let pregnancyStatus = [];
      let pregnancyKnowledge = [];
      try {
        pregnancyStatus = derivePregnancyStatus({
          currentState: business?.current_state,
          events: business?.active_events,
          currentStoryTime: business?.current_story_time,
        });
      } catch {
        pregnancyStatus = [];
      }
      try {
        pregnancyKnowledge = await resolvePregnancyKnowledgeProjectionAtFloor({
          target: business?.current_floor,
          chatId: business?.current_floor?.version?.chat_id ?? chat.current(),
        });
      } catch {
        pregnancyKnowledge = [];
      }
      const derivedPregnancy = {pregnancy_status: pregnancyStatus, pregnancy_knowledge: pregnancyKnowledge};
      if (options.includeDebug !== true) return {...business, ...projection, ...derivedPregnancy};
      const pregnancyStatusDebug = pregnancyStatus.map(item => ({
        subject_id: item?.subject_id ?? null,
        display_name: business?.current_state?.characters?.[item?.subject_id]?.identity?.display_name
          ?? business?.tracking_subjects?.[item?.subject_id]?.display_name
          ?? null,
        status: item?.status ?? 'unknown',
        gestational_weeks: item?.gestational_weeks ?? null,
      }));
      const {
        projection_observed_reaction_debug: projectionObservedReactionDebug,
        projection_observed_reaction_history: projectionObservedReactionHistory,
        projection_triggered_snapshots: projectionTriggeredSnapshots,
        storyline_snapshots: projectionStorylineSnapshots,
        ...projectionBusiness
      } = projection;
      const lifecycleRuntime = await buildLifecycleDebugData();
      const projectionObservationPersistence = (Array.isArray(lifecycleRuntime?.projection_timing?.execution_trace?.stages)
        ? lifecycleRuntime.projection_timing.execution_trace.stages
        : [])
        .filter(stage => ['PROJECTION_OBSERVATION_PERSISTENCE', 'PROJECTION_OBSERVATION_READBACK'].includes(stage?.stage))
        .slice(-8)
        .map(stage => ({
          execution_status: stage.execution_status ?? null,
          reason_code: stage.reason_code ?? null,
          persistence_attempted: stage.persistence_attempted ?? null,
          persistence_succeeded: stage.persistence_succeeded ?? null,
          readback_attempted: stage.readback_attempted ?? null,
          readback_succeeded: stage.readback_succeeded ?? null,
          record_count: stage.output_count ?? null,
          error_code: stage.error_code ?? null,
          run_id: stage.run_id ?? null,
          owner_floor_version: stage.floor_version ?? null,
        }));
      const projectionTriggeredSnapshotPersistence = (Array.isArray(lifecycleRuntime?.projection_timing?.execution_trace?.stages)
        ? lifecycleRuntime.projection_timing.execution_trace.stages
        : [])
        .filter(stage => ['PROJECTION_TRIGGERED_SNAPSHOT_PERSISTENCE', 'PROJECTION_TRIGGERED_SNAPSHOT_READBACK'].includes(stage?.stage))
        .slice(-8)
        .map(stage => ({
          stage: stage.stage ?? null,
          execution_status: stage.execution_status ?? null,
          reason_code: stage.reason_code ?? null,
          result_status: stage.result_status ?? null,
          persistence_attempted: stage.persistence_attempted ?? null,
          persistence_succeeded: stage.persistence_succeeded ?? null,
          snapshot_count: stage.snapshot_count ?? null,
          readback_attempted: stage.readback_attempted ?? null,
          readback_succeeded: stage.readback_succeeded ?? null,
          error_code: stage.error_code ?? null,
          subject_summaries: Array.isArray(stage.subject_summaries) ? stage.subject_summaries : [],
          run_id: stage.run_id ?? null,
          owner_floor_version: stage.floor_version ?? null,
        }));
      const floorVersion = business?.current_floor?.version ?? lifecycleRuntime?.target?.floor_version ?? null;
      let diagnosticMetadata;
      try {
        const traceForMetadata = lifecycleRuntime?.projection_timing?.execution_trace
          ?? diagnostics.getNsfwPipelineDiagnostics({
            chat_id: floorVersion?.chat_id ?? null,
            ...(floorVersion ? {floor_version: floorVersion} : {}),
          });
        diagnosticMetadata = diagnostics.getDiagnosticMetadata({
          current_run_id: traceForMetadata?.current_run_id ?? null,
          current_floor_version: floorVersion,
        });
      } catch {
        diagnosticMetadata = {
          diagnostics_schema_version: 1,
          collected_at: null,
          collection_status: 'FAILED',
          trace_buffer_status: 'UNKNOWN',
          trace_truncated: null,
          current_run_id: null,
          current_floor_version: cloneValue(floorVersion),
        };
      }
      let timingPerformanceDiagnostics;
      try {
        timingPerformanceDiagnostics = diagnostics.getTimingPerformanceDiagnostics?.() ?? {
          schema_version: 1,
          source_type: 'EXECUTION_TRACE',
          collection_status: 'UNAVAILABLE',
          diagnostic_error_code: 'TIMING_PERFORMANCE_DIAGNOSTICS_UNAVAILABLE',
          trace_buffer_status: 'UNKNOWN',
          trace_truncated: null,
          recent_operations: [],
        };
      } catch {
        timingPerformanceDiagnostics = {
          schema_version: 1,
          source_type: 'EXECUTION_TRACE',
          collection_status: 'FAILED',
          diagnostic_error_code: 'TIMING_PERFORMANCE_DIAGNOSTICS_FAILED',
          trace_buffer_status: 'UNKNOWN',
          trace_truncated: null,
          recent_operations: [],
        };
      }
      let storylineDebug;
      try {
        const debugFloor = await eventAnalysis.resolveCurrentBioWeaveFloor();
        const storylineViews = await projectionPersistence.getProjectionViews({
          chatId: floorVersion?.chat_id ?? chat.current(),
          endpointFloor: floorVersion?.floor,
          endpointIndex: debugFloor?.index,
        });
        const snapshots = Array.isArray(storylineViews?.storyline_snapshots) ? storylineViews.storyline_snapshots : [];
        const currentReadFloorVersion = debugFloor?.version ?? floorVersion ?? null;
        const versionMismatches = snapshots.slice(0, 32).map(snapshot => {
          const snapshotVersion = snapshot?.created_at_floor_version ?? null;
          const matches = hasCompleteFloorVersion(currentReadFloorVersion)
            && hasCompleteFloorVersion(snapshotVersion)
            && sameFloorVersion(snapshotVersion, currentReadFloorVersion);
          return matches ? null : {
            subject_id: snapshot?.subject_id ?? null,
            snapshot_floor_version: snapshotVersion,
            current_read_floor_version: currentReadFloorVersion,
            reason: hasCompleteFloorVersion(snapshotVersion) && hasCompleteFloorVersion(currentReadFloorVersion)
              ? 'STALE_FLOOR_VERSION'
              : 'FLOOR_VERSION_UNAVAILABLE',
          };
        }).filter(Boolean);
        const safeSnapshot = snapshot => ({
          subject_id: snapshot?.subject_id ?? null,
          display_name: snapshot?.display_name ?? null,
          status: snapshot?.status ?? null,
          selected_branch_id: snapshot?.selected_branch_id ?? null,
          selected_node_id: snapshot?.selected_node_id ?? null,
          selected_node_status: snapshot?.selected_node_status ?? null,
          created_at_floor_version: snapshot?.created_at_floor_version ?? null,
          current_node_index: snapshot?.current_node_index ?? null,
          valid_body_count: snapshot?.valid_body_count ?? null,
          counted_response_count: Array.isArray(snapshot?.counted_response_ids) ? snapshot.counted_response_ids.length : 0,
          due_attempt_id: snapshot?.due_attempt_id ?? null,
          branches: (snapshot?.branches ?? []).slice(0, 3).map(branch => {
            const legacyConclusionGoal = branch?.conclusion_goal ?? null;
            return {
              branch_id: branch?.branch_id ?? null,
              title: branch?.title ?? null,
              premise: branch?.premise ?? null,
              node_count: Array.isArray(branch?.nodes) ? branch.nodes.length : 0,
              node_goals: (branch?.nodes ?? []).slice(0, 5).map(node => node?.objective ?? null),
              node_conclusion_goals: (branch?.nodes ?? []).slice(0, 5).map(node => node?.conclusion_goal ?? legacyConclusionGoal),
            };
          }),
        });
        storylineDebug = {
          source_type: 'CURRENT_RESOLVED',
          snapshot_complete: storylineViews?.storyline_snapshot_complete === true,
          current_read_floor_version: currentReadFloorVersion,
          version_consistency: {
            status: versionMismatches.length ? 'MISMATCH' : 'MATCHED',
            checked_snapshot_count: Math.min(snapshots.length, 32),
            mismatch_count: versionMismatches.length,
            mismatches: versionMismatches,
          },
          snapshots: snapshots.map(safeSnapshot),
          delivery_records: (Array.isArray(storylineViews?.storyline_delivery_records) ? storylineViews.storyline_delivery_records : []).slice(-32).map(record => ({
            delivery_record_id: record?.delivery_record_id ?? null,
            kind: record?.kind ?? null,
            subject_id: record?.subject_id ?? null,
            response_id: record?.response_id ?? null,
            context_fingerprint: record?.context_fingerprint ?? null,
            floor_version: record?.floor_version ?? null,
            created_at_floor_version: record?.created_at_floor_version ?? null,
          })),
          // Storyline execution spans multiple Character Floors (design,
          // submission, response and judge). Keep the bounded chat trace here
          // so Debug does not hide the earlier stages merely because the
          // current endpoint Floor changed.
          execution_trace: diagnostics.getStorylineDiagnostics?.({chat_id: floorVersion?.chat_id ?? chat.current()}) ?? null,
        };
      } catch (error) {
        storylineDebug = {source_type: 'CURRENT_RESOLVED', status: 'unavailable', reason: error?.code ?? error?.message ?? 'STORYLINE_DEBUG_READBACK_FAILED', snapshots: [], delivery_records: [], execution_trace: diagnostics.getStorylineDiagnostics?.() ?? null};
      }
      let nsfwPipelineDiagnostics;
      try {
        nsfwPipelineDiagnostics = buildNsfwPipelineDiagnostics({business, projection, lifecycleRuntime});
      } catch (error) {
        nsfwPipelineDiagnostics = {
          diagnostics_schema_version: 1,
          diagnostic_sources: ['CURRENT_STATE', 'EXECUTION_TRACE', 'DERIVED_DIAGNOSTIC'],
          current_state: {
            source_type: 'CURRENT_STATE',
            plugin_enabled: null,
            chat_id: floorVersion?.chat_id ?? null,
            floor_version: cloneValue(floorVersion),
          },
          execution_trace: {
            source_type: 'EXECUTION_TRACE',
            collection_status: 'FAILED',
            trace_buffer_status: 'UNKNOWN',
            trace_truncated: null,
            current_run_id: null,
            runs: [],
            stages: [],
          },
          derived_diagnostic: {
            source_type: 'DERIVED_DIAGNOSTIC',
            current_execution_status: 'UNKNOWN',
            current_blocking_stage: 'UNKNOWN',
            current_blocking_reason_code: 'TRACE_UNAVAILABLE',
            first_blocking_node_source: 'TRACE_UNAVAILABLE',
            confidence: 'UNKNOWN',
            diagnostic_error_code: error?.code ?? error?.message ?? 'NSFW_DIAGNOSTICS_FAILED',
          },
          timing_diagnostics: [],
          aggregation_diagnostics: [],
          timing_performance_diagnostics: timingPerformanceDiagnostics,
          projection_diagnostics: {
            source_type: 'DERIVED_DIAGNOSTIC',
            projection_rules_available: null,
            projection_rules_count: null,
            eligibility_status: 'READBACK_FAILED',
            eligibility_reason_code: 'READBACK_FAILED',
            timing_window_entered: null,
            timing_window_statuses: [],
            projection_candidate_status: null,
            projection_candidate_source: null,
            ai_scheduling_status: 'READBACK_FAILED',
            ai_scheduling_reason_code: 'READBACK_FAILED',
            projection_ai_request_started: null,
            projection_ai_request_count: null,
          },
          automatic_execution: {plugin_enabled: null, entry_registered: null, latest_trigger: null, latest_run_id: null, scheduling_stage: null},
        };
      }
      let pregnancyKnowledgeDebug;
      try {
        const knowledgeSnapshot = await pregnancyKnowledgePersistence.getSnapshot({
          chatId: floorVersion?.chat_id ?? chat.current(),
          endpointFloor: floorVersion?.floor,
          endpointIndex: business?.current_floor?.index,
        });
        const currentRegistry = store.getFloor(business?.current_floor?.index, business?.current_floor?.version?.swipe_id ?? 0)?.character_registry;
        pregnancyKnowledgeDebug = {
          source_type: 'CURRENT_FLOOR_READ',
          root_present: Boolean(knowledgeSnapshot),
          entry_count: knowledgeSnapshot?.entries?.length ?? 0,
          entries: (knowledgeSnapshot?.entries ?? []).map(entry => ({
            subject_id: entry.subject_id,
            pregnancy_id: entry.pregnancy_id,
            knower_count: entry.knowers.length,
            knower_ids: entry.knowers.map(item => item.character_id),
            source_floor_version: entry.updated_at_floor_version,
          })),
          registry_present: Boolean(currentRegistry),
        };
      } catch (error) {
        pregnancyKnowledgeDebug = {source_type: 'CURRENT_FLOOR_READ', root_present: null, entry_count: null, entries: [], read_error_code: error?.code ?? error?.message ?? 'PREGNANCY_KNOWLEDGE_READ_FAILED'};
      }
      return {
        ...business,
        ...projectionBusiness,
        ...derivedPregnancy,
        debug: {
          ...(business.debug ?? {}),
          diagnostic_metadata: diagnosticMetadata,
          nsfw_pipeline_diagnostics: nsfwPipelineDiagnostics,
          timing_diagnostics: lifecycleRuntime?.projection_timing?.timing_diagnostics ?? [],
          aggregation_diagnostics: lifecycleRuntime?.projection_timing?.aggregation_diagnostics ?? [],
          timing_performance_diagnostics: timingPerformanceDiagnostics,
          projection_observed_reaction_links: projectionObservedReactionDebug ?? [],
          projection_observed_reaction_history: projectionObservedReactionHistory ?? [],
          projection_observation_persistence: projectionObservationPersistence,
          projection_triggered_snapshots: projectionTriggeredSnapshots ?? [],
          projection_triggered_snapshot_persistence: projectionTriggeredSnapshotPersistence,
          lifecycle_runtime: lifecycleRuntime,
          storyline: storylineDebug,
          pregnancy_status: pregnancyStatusDebug,
          pregnancy_knowledge: pregnancyKnowledgeDebug,
        },
      };
    },
    getCurrentBiologicalState: eventAnalysis.getCurrentBiologicalState,
    getProjectionViews: projectionPersistence.getProjectionViews,
    refreshProjectionContext: projectionContext.refreshProjectionContext,
    clearProjectionContext: projectionContext.clearProjectionContext,
    refreshProjection: projectionRuntime.refreshProjection,
    deleteProjection: projectionRuntime.deleteProjection,
    cancelStoryline: projectionRuntime.cancelStoryline,
    refreshTrackingRegistry: eventAnalysis.refreshTrackingRegistry,
    updateEvent: updateEventWithProjection,
    deleteEvent: deleteEventWithProjection,
    appendPregnancyLifecycleFact: pregnancyLifecyclePersistence.appendFact,
    savePregnancyCandidateRecord: pregnancyLifecyclePersistence.saveCandidateRecord,
    confirmPregnancyFather: pregnancyLifecyclePersistence.confirmFather,
    archiveAndReleasePregnancy: pregnancyLifecyclePersistence.archiveAndRelease,
    getPregnancyLifecycleTimeline: pregnancyLifecyclePersistence.getTimeline,
    getPregnancyKnowledgeSnapshot: pregnancyKnowledgePersistence.getSnapshot,
    upsertParticipantAggregation: participantAggregationPersistence.upsertAggregation,
    getParticipantAggregations: participantAggregationPersistence.getParticipantAggregations,
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
