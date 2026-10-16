import {
  safeErrorSummary as clientSafeErrorSummary,
  statusFromError as clientStatusFromError,
} from "../ai/client.js";
import {diagnoseStoryTime} from "../story/time.js";

export const VERSION_CHAIN_FIELDS = Object.freeze([
  "chat_id",
  "message_id",
  "floor",
  "message_index",
  "swipe_id",
  "content_hash",
  "message_version",
]);

const NSFW_PIPELINE_RUN_LIMIT = 64;
const NSFW_PIPELINE_STAGE_LIMIT = 256;
const NSFW_PIPELINE_STATUSES = new Set([
  "NOT_INVOKED",
  "SKIPPED",
  "BLOCKED",
  "ATTEMPTED",
  "FAILED",
  "PERSIST_FAILED",
  "SUCCEEDED",
  "READBACK_FAILED",
  "NOT_TRIGGERED",
  "DEFERRED_CONTEXT_NOT_READY",
  "CANCELLED_STALE_CONTEXT",
  "UNKNOWN",
]);
const DIAGNOSTIC_SOURCE_TYPES = new Set([
  "CURRENT_STATE",
  "EXECUTION_TRACE",
  "DERIVED_DIAGNOSTIC",
]);

function diagnosticScalar(value, maxLength = 160) {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return value;
  if (typeof value !== "string") return null;
  return value.slice(0, maxLength);
}

function normalizeFloorVersion(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const version = Object.fromEntries(VERSION_CHAIN_FIELDS.map(field => [
      field,
      diagnosticScalar(value[field]),
    ]));
    return VERSION_CHAIN_FIELDS.some(field => version[field] !== null) ? version : null;
  } catch {
    return null;
  }
}

function diagnosticFloorKey(value) {
  const version = normalizeFloorVersion(value);
  return version ? JSON.stringify(version) : null;
}

function diagnosticTimestamp(value) {
  return diagnosticScalar(value, 64);
}

function diagnosticIdArray(value, maxLength = 64) {
  if (!Array.isArray(value)) return null;
  return [...new Set(value
    .map(item => diagnosticScalar(item, 160))
    .filter(Boolean))].slice(0, maxLength);
}

function diagnosticReasonArray(value, maxLength = 64) {
  if (!Array.isArray(value)) return null;
  return value.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const eventId = diagnosticScalar(item.event_id, 160);
    const reasonCode = diagnosticScalar(item.reason_code, 160);
    return eventId || reasonCode ? {event_id: eventId, reason_code: reasonCode} : null;
  }).filter(Boolean).slice(0, maxLength);
}

function diagnosticNow() {
  try {
    return new Date().toISOString();
  } catch {
    return null;
  }
}

export function monotonicNow() {
  return typeof globalThis.performance?.now === "function"
    ? globalThis.performance.now()
    : null;
}

export function durationMs(start, end = monotonicNow()) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Number((end - start).toFixed(3)));
}

function versionChainValue(value) {
  return value === undefined || value === null ? null : value;
}

export function buildVersionChainDiagnostic({
  boundary = null,
  source_kind: sourceKind = null,
  version = null,
  message_index: messageIndex = null,
  generation_id: generationId = null,
  generation_intent_id: generationIntentId = null,
  generation_type: generationType = null,
  generation_ended: generationEnded = null,
  generation_settled: generationSettled = null,
  final_floor_index: finalFloorIndex = null,
  final_floor_version: finalFloorVersion = null,
  scheduler_revision: schedulerRevision = null,
  analysis_execution_id: analysisExecutionId = null,
  source_text_length: sourceTextLength = null,
  host_save_state: hostSaveState = "unavailable",
} = {}) {
  const normalizedVersion = version && typeof version === "object" ? version : {};
  const normalizeVersion = value => {
    const source = value && typeof value === "object" ? value : {};
    return Object.fromEntries(VERSION_CHAIN_FIELDS
      .filter(field => field !== "message_index")
      .map(field => [field, versionChainValue(source[field])]));
  };
  return {
    stage: "VERSION_CHAIN",
    boundary: versionChainValue(boundary),
    source_kind: versionChainValue(sourceKind),
    chat_id: versionChainValue(normalizedVersion.chat_id),
    message_id: versionChainValue(normalizedVersion.message_id),
    floor: versionChainValue(normalizedVersion.floor),
    message_index: Number.isInteger(messageIndex) ? messageIndex : null,
    swipe_id: versionChainValue(normalizedVersion.swipe_id),
    content_hash: versionChainValue(normalizedVersion.content_hash),
    message_version: versionChainValue(normalizedVersion.message_version),
    generation_id: versionChainValue(generationId),
    generation_intent_id: versionChainValue(generationIntentId),
    generation_type: versionChainValue(generationType),
    generation_ended: generationEnded === null ? null : generationEnded === true,
    generation_settled: generationSettled === null ? null : generationSettled === true,
    final_floor_index: Number.isInteger(finalFloorIndex) ? finalFloorIndex : null,
    final_floor_version: finalFloorVersion ? normalizeVersion(finalFloorVersion) : null,
    scheduler_revision: Number.isFinite(Number(schedulerRevision)) ? Number(schedulerRevision) : null,
    analysis_execution_id: versionChainValue(analysisExecutionId),
    source_text_length: Number.isFinite(Number(sourceTextLength)) ? Number(sourceTextLength) : null,
    host_save_state: versionChainValue(hostSaveState) ?? "unavailable",
    host_post_save_hook: "NO_PUBLIC_POST_SAVE_HOOK",
  };
}

export function versionChainTransition(previous, current) {
  if (!previous || !current || previous.analysis_execution_id !== current.analysis_execution_id)
    return null;
  if (previous.content_hash === current.content_hash) return null;
  return {
    stage: "VERSION_CHAIN_TRANSITION",
    analysis_execution_id: current.analysis_execution_id,
    from_boundary: previous.boundary ?? null,
    to_boundary: current.boundary ?? null,
    from_content_hash: previous.content_hash ?? null,
    to_content_hash: current.content_hash ?? null,
    from_swipe_id: previous.swipe_id ?? null,
    to_swipe_id: current.swipe_id ?? null,
    from_message_version: previous.message_version ?? null,
    to_message_version: current.message_version ?? null,
    from_source_kind: previous.source_kind ?? null,
    to_source_kind: current.source_kind ?? null,
  };
}

export const FAILURE_CATEGORIES = Object.freeze({
  STALE_FLOOR_OWNER: "stale_floor_owner",
});

const STALE_FLOOR_OWNER_CODES = new Set([
  "FLOOR_TX_STALE_VERSION",
  "STALE_FLOOR_VERSION",
]);
const STALE_FLOOR_OWNER_CLASSIFICATIONS = new Set([
  "TRUE_STALE_OWNER_CHANGE",
  "TRUE_OWNER_CHANGE",
  "STALE_OWNER_CHANGE",
]);

function normalizedDiagnosticToken(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

export function canonicalFailureCategory(error = {}) {
  const code = normalizedDiagnosticToken(
    error?.code ?? error?.error_code ?? error?.diagnostic_code ?? error?.diagnosticCode,
  );
  if (STALE_FLOOR_OWNER_CODES.has(code)) return FAILURE_CATEGORIES.STALE_FLOOR_OWNER;
  const classifications = [
    error?.classification,
    error?.retry_classification,
    error?.cause?.classification,
    error?.cause?.retry_classification,
  ].map(normalizedDiagnosticToken);
  if (classifications.some(value => STALE_FLOOR_OWNER_CLASSIFICATIONS.has(value))) {
    return FAILURE_CATEGORIES.STALE_FLOOR_OWNER;
  }
  return null;
}

function cloneSafeTraceValue(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(cloneSafeTraceValue);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, cloneSafeTraceValue(item)]),
  );
}

function stableDiagnosticValue(value) {
  if (Array.isArray(value)) return value.map(stableDiagnosticValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableDiagnosticValue(value[key])]));
}

export function diagnosticFingerprint(value) {
  const text = JSON.stringify(stableDiagnosticValue(value ?? null));
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `diag_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function sanitizePersistenceTracePayload(payload = {}) {
  const allowed = [
    "chat_id", "active_chat_id", "active_character_floor_message_id", "active_swipe_id", "message_id", "floor", "swipe_id", "content_hash", "world_model_debug_schema_version", "first_failed_stage", "type_identity_decisions",
    "run_id", "floor_version", "floor", "active_swipe_id", "source_type", "execution_status", "invoked", "reason_code", "started_at", "completed_at", "input_count", "output_count", "subject_id", "mechanism_key", "tracking_window_id", "tracking_window_cycle_id", "event_id", "first_exposure_event_id", "first_exposure_story_time", "candidate_subject_ids", "candidate_mechanism_keys", "candidate_exposure_event_ids", "accepted_exposure_event_ids", "excluded_candidate_reasons", "cycle_id", "final_cycle_id", "canonical_cycle_id", "cycle_id_source", "cycle_id_consistent", "cycle_id_consistency_reason_code", "cycle_id_resolution_status", "cycle_id_resolution_reason_code", "resolution_candidate_count", "timing_instance_id", "base_min_story_days", "base_max_story_days", "variance_ratio", "variance_cap_story_days", "sampled_individual_offset_story_days", "sampled_offset_source", "frozen_offset_status", "rng_source", "state_modifier_story_days", "total_adjustment_story_days", "total_adjustment_cap_story_days", "effective_min_story_days", "effective_max_story_days", "elapsed_story_days", "timing_config_available", "timing_config_source", "world_rule_binding", "aggregation_due", "aggregation_attempted", "aggregation_trigger_status", "aggregation_reason_code", "aggregation_overdue", "existing_aggregation_succeeded", "accepted_exposure_count", "persistence_attempted", "persistence_succeeded", "readback_attempted", "readback_succeeded", "readback_result_present", "readback_reason_code", "run_context_available", "run_floor_match", "persistence_trace_sequences",
    "message_version", "message_index", "floor_version_key", "attempt", "execution_attempt", "stage_attempt", "retry_index", "persistence_invocation_id", "trigger", "domain", "state", "boundary", "source_kind", "source_text_length", "host_save_state", "host_post_save_hook", "analysis_execution_id", "scheduler_revision", "final_floor_index", "final_floor_version", "from_boundary", "to_boundary", "from_content_hash", "to_content_hash", "from_swipe_id", "to_swipe_id", "from_message_version", "to_message_version", "from_source_kind", "to_source_kind", "path",
    "execution_id", "mode", "response_text_length", "raw_fact_block_count", "parsed_fact_count", "parse_rejected_fact_count", "resolution_rejected_fact_count", "evidence_guard_rejected_fact_count", "fact_count", "rejected_fact_count", "patch_operation_count", "accepted_fact_count", "accepted_operation_count", "initial_type_count", "initial_identity_search_performed", "sibling_search_seeded", "sibling_search_complete", "discovered_sibling_type_count", "discovered_sibling_type_names", "accepted_sibling_type_count", "accepted_sibling_type_names", "rejected_sibling_type_count", "rejected_sibling_type_names", "reported_distinct_type_count", "host_observed_distinct_type_count", "accepted_canonical_type_count", "new_type_identity_fact_count", "accepted_new_type_identity_count", "identity_diversity", "coverage_initial_target_count", "coverage_current_target_count", "dynamic_coverage_target_count", "dynamic_coverage_target_ids", "unaccounted_dynamic_target_count", "unaccounted_dynamic_target_ids", "derived_target_accounting_complete", "dynamic_coverage_unaccounted_in_single_response", "derived_target_accounting_records", "dynamic_coverage_targets", "coverage_dispositions", "analysis_stage_succeeded", "canonical_mutation_occurred", "completeness_required", "completeness_satisfied", "completeness_diagnostics", "semantic_incomplete", "semantic_failure_code", "semantic_diagnostics", "analysis_outcome", "coverage_fact_mappings", "coverage_target_count", "coverage_target_counts", "covered_target_count", "coverage_targets", "coverage_targets_truncated", "target_emitted", "target_not_emitted", "fields", "scope_summary", "address_summary", "facts", "rejected_facts", "fact_mappings", "fact_index", "failure_stage", "failure_code", "reason",
    "comparison", "patch_operation_type", "patch_path", "rejected_operation_type", "rejected_semantic_path", "species", "biological_type", "field", "proposed_value", "classification", "evidence_guard_failure_code", "rejected_semantic_field", "evidence_binding", "decision", "candidate_value", "candidate_normalized_value", "scoped_evidence_unit_count", "matched_evidence_unit_count", "matched_evidence_unit_indices", "matched_evidence_excerpts", "support_strategy", "support_score_if_any", "required_threshold_if_any", "scope_binding_result", "value_support_result", "rejection_code", "rejection_detail",
    "retry_index", "max_retries", "failure_stage", "failure_code",
    "retry_decision", "retry_reason",
    "generation_id", "generation_type", "generation_source", "generation_intent_id", "generation_final_floor_seen", "generation_ended", "generation_settled", "execution_active", "current_execution_id", "target_message_id", "target_swipe_id", "owner_changed", "supersede_decision", "supersede_reason", "result_reason", "pending_generation", "pending_swipe_generation", "completed_generation", "completed_swipe_generation", "event_type", "event_payload_type", "force", "counter_before", "counter_after", "interval", "retry_paused", "already_observed", "already_counted", "host_event_key", "host_event_type", "received_at", "host_chat_id", "host_message_id", "host_swipe_id", "host_generation_type", "forward_to_runtime", "runtime_handler_present", "forwarded", "forward_result", "forward_error", "forward_error_name", "recovery_trigger", "recovery_status", "context_ready", "entered_recovery", "tracking_window_found", "timing_instance_reused", "timing_instance_created", "aggregation_reused_or_created", "stale_context_cancelled",
    "current_story_time", "previous_timing_state", "timing_state", "timing_transition", "anchor_story_time", "elapsed_story_days", "elapsed_story_value", "effective_min_story_days", "effective_max_story_days", "reproductive_cycle_id", "cycle_id", "timing_instance_id", "timing_evaluations", "compatible_exposure_count", "compatible_exposure_event_ids", "source_participant_ids", "source_identity_ids", "multiple_compatible_exposures", "projection_id", "projection_rule_id", "development_concern_key", "eligibility", "ai_call_will_start", "existing_projection_id", "existing_projection_view_count", "existing_projection_ids", "candidate_count", "candidate_validation_result", "validation_errors", "rejection_reason", "generated_projection_ids", "projection_ids", "active_projection_count", "active_projection_ids", "context_visible_projection_count", "context_visible_projection_ids", "projection_view_count", "projection_contribution_count", "ai_request_started", "ai_request_completed", "ai_request_failed", "generation_status", "participant_aggregation_count", "accepted_exposure_count", "aggregation_id", "projection_delivery_count", "delivery_id", "response_observed", "analysis_status", "lifecycle_status", "lifecycle_fact_id", "archive_id", "closure_reason", "release_action", "lock_key", "locked_cycle_keys", "production_gate", "lock_reason",
    "cancel_stage", "cancel_reason", "cancel_code",
    "classification", "retry_classification", "retryable", "version_check_source",
    "expected_floor_version", "actual_floor_version", "stored_floor_version", "expected_content_hash", "actual_content_hash",
    "mismatch_fields", "version_mismatch_fields", "stored_version_audit", "version_classification", "version_validation_layer", "version_validation_source", "owner_message_index", "owner_message_id", "active_chat_match", "message_owner_match", "floor_match",
    "host_content_hash_match", "host_floor_version_match", "official_content_hash_match",
    "official_floor_version_match", "execution_superseded",
    "original_chat_id", "current_chat_id", "original_message_id", "current_owner_message_id",
    "original_floor", "current_floor", "original_swipe_id", "current_swipe_id", "original_content_hash", "current_content_hash",
    "original_message_version", "current_message_version", "chat_id_match", "message_id_match",
    "swipe_id_match", "content_hash_match", "message_version_match", "generation_identity_match",
    "retries_remaining", "from_retry_index", "next_retry_index", "configured_retry_count", "normalized_retry_count", "world_max_retries", "event_max_retries",
    "reason", "result", "present", "slot_present", "world_model_present", "species_count",
    "biological_type_count", "floor_version_match", "swipe_match", "commitState",
    "revision", "current_floor_present",
    "validator", "keyword", "instance_path", "schema_path", "validator_params",
    "event_index", "event_type",
    "expected_swipe_id", "expected_floor_version", "actual_floor_version",
    "bioweave_present", "event_count", "character_count", "current_floor_included",
    "source", "ready", "candidate_execution_id", "candidate_fingerprint", "candidate_full_hash", "candidate_state", "candidate_created_at", "ui_state_fingerprint", "ui_projection_state", "committed_fingerprint", "persistence_requested", "persistence_started", "persistence_confirmed", "persisted_fingerprint", "reconciliation_status", "reconciliation_fingerprint", "authoritative_reload_generation", "reload_skipped_reason", "reload_suppressed_by_newer_committed_revision", "rendered_field_count", "unrendered_canonical_field_count", "canonical_field_count",
    "review_accounted", "mutation_rejected_count", "coverage_mutation_states", "request_envelope", "request_mode", "request_total_char_count", "permitted_evidence_char_count", "existing_reference_char_count", "retry_directive_char_count", "host_diagnostics_included", "permitted_evidence_fingerprint", "existing_reference_fingerprint", "coverage_target_set_fingerprint", "analysis_payload_fingerprint", "model_request_payload_fingerprint", "control_directive_fingerprint", "retry_reason", "retry_target_ids", "retry_attempt", "previous_failure_code", "execution_result", "fact_delta_result", "baseline_source", "baseline_execution_id", "baseline_fingerprint", "request_transition", "request_transitions", "mutation_source_execution_id", "mutation_source_candidate_fingerprint",
    "persistence_transaction_id", "floor_transaction_id", "transaction_key", "owner", "operation_type", "patch_fields", "queue_key", "queued", "before_presence", "after_presence", "missing_owner_fields", "missing_siblings", "save_invocation_id", "commit_state", "save_state", "execution_snapshot_present", "execution_snapshot_mutated", "execution_snapshot_accepted_operation_count", "execution_snapshot_successful_round_count", "execution_snapshot_last_successful_round", "execution_snapshot_persistence_eligible", "snapshot_preserved", "last_attempt_failed", "last_attempt_failure_code", "character_timing_config", "manual_timing_edit", "aggregation_reevaluation",
    "resolution_reason", "request_source", "panel_open", "active_tab", "route", "operation", "from_route", "to_route", "initialized_before_open",
    "refresh_cycle_in_flight", "queued_refresh", "business_refresh_sequence",
    "event_id", "event_edit_operation_id", "error_code", "safe_error_summary", "error_name", "error_message", "error_path", "diagnostic_path", "diagnostic_code", "analysis_stage", "validation_stage", "validator", "keyword", "persistence_entered", "persistence_confirmed", "success", "duration_ms", "failure_stage", "runtime_duration_ms", "floor_resolution_duration_ms", "event_normalization_duration_ms", "event_validation_duration_ms", "stale_guard_duration_ms", "persistence_duration_ms", "tracking_registry_refresh_duration_ms", "post_save_refresh_duration_ms", "ui_runtime_call_duration_ms", "ui_visible_completion_duration_ms", "official_get_before_save_duration_ms", "official_get_after_save_duration_ms", "host_chat_save_duration_ms", "ui_open_total_ms", "ui_initialization_ms", "business_read_ms", "canonical_build_ms", "canonical_generation", "build_duration_ms", "join_wait_ms", "invalidation_reason", "dto_build_ms", "render_ms", "route_switch_total_ms", "canonical_build_wall_ms", "tracking_inputs_wall_ms", "floor_version_call_count", "floor_version_wall_ms", "story_time_wall_ms", "tracking_registry_sync_ms", "character_facts_sync_ms", "health_derive_sync_ms", "reduce_state_sync_ms",
    "response_shape", "extraction_mode", "parsed", "events_present",
    "schema_valid", "domain_valid", "validation_error_path",
    "valid_empty", "empty_reason", "expected_event_count",
    "expected_character_count", "expected_character_ids", "actual_event_count",
    "actual_character_count", "actual_registry_character_count",
    "pre_analysis_event_ids", "pre_analysis_current_floor_event_ids", "candidate_event_count",
    "post_analysis_event_ids", "added_event_ids", "updated_event_ids", "retained_event_ids",
    "removed_event_ids", "removal_reasons", "continuation_diagnostics",
    "continuation_reference_present", "continuation_reference_event_id",
    "continuation_reference_target_exists", "continuation_reference_valid",
    "continuation_merge_executed", "continuation_rejection_reason",
    "input_total_count", "unique_event_id_count", "conflict_event_id_count",
    "selected_version_source_counts", "unresolved_conflict_count",
    "window_build_count", "window_build_ms", "registry_rebuild_ms",
    "input_event_count", "unique_event_count",
    "normalize_validate_count", "normalize_validate_ms", "sort_compare_count", "sort_ms",
    "story_time_compare_count", "story_time_compare_ms", "story_time_compare_cache_hit_count", "fast_story_time_compare_count", "window_create_count", "window_create_ms",
    "window_binding_ms", "clone_count", "digest_count", "digest_ms", "output_ms", "total_ms",
    "source_event_id", "source_floor_version", "source_observation_fingerprint_hash", "request_key", "assessment_id", "assessment_valid", "assessment_present", "invocation_id", "response_schema_version", "profile_available", "recovery_stage", "stage_selection_outcome", "stage_selection_reason", "active", "guidance_present", "guidance_fingerprint", "character_id", "health_guidance_count", "selected_stage_summary", "guidance_fingerprints", "projection_contribution_count", "context_nonempty", "context_fingerprint", "slot", "slot_nonempty", "clear_reason", "generation_identity", "settled_before_listener_resolve", "refresh_outcome", "listener_resolve_policy", "generation_id", "generation_intent_id", "generation_source", "generation_type", "context_ready_before_prompt_read", "ai_request_started_count", "ai_request_completed_count", "reuse_count", "inflight_reuse_count", "adapter_available", "set_extension_prompt_available", "setter_bound_to_context", "position_argument", "depth_argument", "role_argument", "position_constant_available", "role_constant_available",
  ];
  return Object.fromEntries(
    allowed
      .filter(key => payload[key] !== undefined)
      .map(key => [key, cloneSafeTraceValue(payload[key])]),
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

export function safeDiagnosticSummary(error, stage = null) {
  const code = diagnosticCode(error);
  if (canonicalFailureCategory(error) === FAILURE_CATEGORIES.STALE_FLOOR_OWNER)
    return "当前楼层状态已发生变化，本次分析结果未写入。";
  const timeoutCode = code === "REQUEST_TIMEOUT" || code === "timeout" ||
    error?.code === "REQUEST_TIMEOUT";
  const httpStatus = Number(error?.status ?? error?.http_status);
  const hasNonSuccessHttpStatus = Number.isFinite(httpStatus) &&
    (httpStatus < 200 || httpStatus >= 300);
  if (timeoutCode && error?.stage_retry_exhausted === true && !hasNonSuccessHttpStatus) {
    const seconds = Number(error?.timeoutSec ?? error?.timeout_ms / 1000);
    const wait = Number.isFinite(seconds) && seconds > 0
      ? `等待 ${Math.max(1, Math.min(600, Math.round(seconds)))} 秒后`
      : "等待超时后";
    return `请求超时：${wait}已在本地终止，已耗尽本阶段重试次数。`;
  }
  const retryClassification = String(
    error?.retry_classification ?? error?.cause?.retry_classification ?? "",
  ).toLowerCase();
  if (retryClassification === "temporary_server_convergence")
    return "当前楼层数据暂未与宿主保存状态同步，本次世界分析未能完成。";
  if (error?.analysis_stage === "floor_owner_convergence" ||
      code === "AUTO_ANALYSIS_FLOOR_PREREQUISITE_UNAVAILABLE" ||
      code === "HOST_CONVERGENCE_FAILED" ||
      code === "HOST_CONVERGENCE_UNAVAILABLE") {
    if (code === "HOST_CONVERGENCE_FAILED" || error?.version_check_source === "host_authoritative_save")
      return "宿主聊天保存失败，自动分析未开始。";
    return "当前楼层尚未完成宿主保存，自动分析未开始。";
  }
  if (code === "WORLD_MODEL_PERSISTENCE_PREWRITE_FAILED")
    return "世界数据保存失败，已停止人物分析。";
  if (code === "WORLD_MODEL_PERSISTENCE_READBACK_FAILED" || code === "FLOOR_PERSISTENCE_READBACK_FAILED")
    return "世界数据保存后校验失败，已停止人物分析。";
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
    error_name: String(error?.name ?? "Error").slice(0, 80),
    error_message: safeDiagnosticSummary(error, resolvedStage),
  };
  result.diagnostic_code = diagnostic || code;
  result.validator = typeof error?.validator === "string" ? error.validator : null;
  result.keyword = typeof error?.keyword === "string" ? error.keyword : null;
  result.instance_path = typeof error?.instancePath === "string" ? error.instancePath : path;
  result.schema_path = typeof error?.schemaPath === "string" ? error.schemaPath : null;
  result.validator_params = error?.params && typeof error.params === "object" ? error.params : null;
  if (status !== null) result.http_status = status;
  if (error?.phase) result.phase = String(error.phase);
  const versionAudit = error?.version_audit ?? error?.cause?.version_audit;
  if (versionAudit && typeof versionAudit === "object") {
    result.version_check_source = error?.version_check_source
      ?? error?.cause?.version_check_source
      ?? null;
    result.mismatch_fields = Array.isArray(versionAudit.mismatch_fields)
      ? [...versionAudit.mismatch_fields]
      : [];
    result.expected_floor_version = versionAudit.expected ?? null;
    result.actual_floor_version = versionAudit.actual ?? null;
  }
  if (error?.retry_classification || error?.cause?.retry_classification)
    result.retry_classification = error.retry_classification ?? error.cause.retry_classification;
  if (error?.retryable !== undefined)
    result.retryable = error.retryable === true;
  if (Number.isInteger(error?.attempt) && error.attempt > 0)
    result.attempt = error.attempt;
  if (Number.isFinite(Number(error?.timeoutSec)) && Number(error.timeoutSec) > 0)
    result.timeoutSec = Number(error.timeoutSec);
  if (Number.isFinite(Number(error?.timeout_ms)) && Number(error.timeout_ms) > 0)
    result.timeout_ms = Number(error.timeout_ms);
  return result;
}

function buildFloorPreflightStatus(error, trackingSubjectCount = 0) {
  const diagnostic = executionError(error, error?.analysis_stage ?? "floor_resolution");
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

function buildReloadFloorSlotAudit({reason = "runtime-init", chatId = null, target = null, floorData = null, error = null} = {}) {
  if (error) {
    return {
      stage: "RELOAD_FLOOR_SLOT_AUDIT",
      reason,
      chat_id: chatId,
      bioweave_present: false,
      resolution_reason: error?.code ?? error?.message ?? "resolver_failed",
    };
  }
  return {
    stage: "RELOAD_FLOOR_SLOT_AUDIT",
    reason,
    chat_id: chatId,
    message_id: target?.version?.message_id ?? null,
    floor: target?.version?.floor ?? null,
    swipe_id: target?.swipeId ?? null,
    content_hash: target?.version?.content_hash ?? null,
    message_version: target?.version?.message_version ?? null,
    bioweave_present: Boolean(floorData),
    world_model_present: Boolean(floorData?.world_model),
    analysis_present: Boolean(floorData?.analysis),
    events_present: Array.isArray(floorData?.events),
    character_registry_present: Boolean(floorData?.character_registry),
    snapshot_present: Boolean(floorData?.snapshot),
    projection_timeline_present: Boolean(floorData?.projection_timeline),
    resolution_reason: floorData ? "resolved" : "slot_missing",
  };
}

function buildStoryTimeDebugInfo({info = {}, business = null, trace = [], chatId = null, normalizeStoryTimeForRead = value => value} = {}) {
  const resolutionTrace = Array.isArray(info.trace) ? info.trace : [];
  const latestResolution = [...resolutionTrace].reverse().find(entry => entry?.source !== "historical_event_difference" && (entry?.story_time || entry?.source)) ?? null;
  const currentStoryTime = info.story_time ?? null;
  const differences = business?.current_story_time_differences ?? {};
  const events = Array.isArray(business?.active_events) ? business.active_events : [];
  const event = events.find(item => Object.prototype.hasOwnProperty.call(differences, String(item?.event_id ?? ""))) ?? events[0] ?? null;
  const eventId = event?.event_id ? String(event.event_id) : null;
  const difference = eventId ? (differences[eventId] ?? null) : null;
  const eventStoryTime = event
    ? (normalizeStoryTimeForRead(event.story_time) ?? event.story_time ?? null)
    : null;
  const calendar = latestResolution?.calendar ?? null;
  const normalizeCandidateSource = source => source === "synopsis_time" ? "synopsis_block_time" : (source ?? "unknown");
  const debugSource = normalizeCandidateSource(latestResolution?.source);
  const candidateSource = normalizeCandidateSource(latestResolution?.candidate_source ?? debugSource);
  const currentInterpretation = diagnoseStoryTime(currentStoryTime);
  const eventInterpretation = eventStoryTime ? diagnoseStoryTime(eventStoryTime) : null;
  const currentStoryTimeParsed = currentInterpretation.parseable;
  const eventStoryTimeParsed = eventInterpretation?.parseable === true;
  const failureReason = difference
    ? null
    : info.status === "NO_CHARACTER_FLOOR"
      ? "CURRENT_STORY_TIME_UNKNOWN"
      : !currentStoryTimeParsed
        ? currentInterpretation.failure_reason === "STORY_TIME_FIELD_CONFLICT"
          ? "STORY_TIME_FIELD_CONFLICT"
          : "CURRENT_STORY_TIME_PARSE_FAILED"
        : event && !eventStoryTimeParsed
          ? eventInterpretation?.failure_reason === "STORY_TIME_FIELD_CONFLICT"
            ? "HISTORICAL_STORY_TIME_FIELD_CONFLICT"
            : "HISTORICAL_STORY_TIME_PARSE_FAILED"
          : !event
            ? "COMPARISON_NOT_EVALUATED"
          : (calendar?.failure_reason ?? "STORY_TIME_NOT_COMPARABLE");
  return {
    status: info.status ?? "unknown",
    chat_id: chatId === undefined || chatId === null ? null : String(chatId),
    floor: info.floor?.version ? {
      floor: info.floor.version.floor ?? null,
      message_id: info.floor.version.message_id ?? null,
      swipe_id: info.floor.version.swipe_id ?? info.floor.swipeId ?? null,
      content_hash: info.floor.version.content_hash ?? null,
      message_version: info.floor.version.message_version ?? null,
    } : null,
    source: debugSource,
    resolution_source: latestResolution?.resolution_source ?? (latestResolution?.source === "cache" ? "cache" : "fresh"),
    candidate_source: candidateSource,
    candidate: latestResolution?.candidate ?? null,
    story_time: currentStoryTime,
    persisted_structured: currentInterpretation.persisted_structured,
    parseable: currentInterpretation.parseable,
    comparable: event ? difference !== null : "not_evaluated",
    parsed_parts: latestResolution?.parsed_parts ?? null,
    calendar: calendar ? {
      calendar_id: calendar.calendar_id ?? currentStoryTime?.calendar_id ?? null,
      era_label: calendar.era_label ?? latestResolution?.parsed_parts?.era_label ?? null,
      calculation_level: calendar.calculation_level ?? null,
      ordinal_in_year: latestResolution?.ordinal_in_year ?? null,
      day_index: currentStoryTime?.day_index ?? null,
      failure_reason: calendar.failure_reason ?? null,
    } : {
      calendar_id: currentStoryTime?.calendar_id ?? null,
      era_label: latestResolution?.parsed_parts?.era_label ?? null,
      calculation_level: null,
      ordinal_in_year: null,
      day_index: currentStoryTime?.day_index ?? null,
      failure_reason: info.status === "NO_CHARACTER_FLOOR" ? "CURRENT_STORY_TIME_UNKNOWN" : "NO_CALENDAR_MAPPING",
    },
    recent_event: event ? {
      event_id: eventId,
      story_time: eventStoryTime,
      persisted_structured: eventInterpretation?.persisted_structured ?? false,
      parseable: eventInterpretation?.parseable ?? false,
      difference,
    } : null,
    difference,
    failure_reason: difference ? null : failureReason,
    trace,
  };
}

export function createRuntimeDiagnostics({
  getChatId = () => null,
  maxNsfwPipelineRuns = NSFW_PIPELINE_RUN_LIMIT,
  maxNsfwPipelineStages = NSFW_PIPELINE_STAGE_LIMIT,
} = {}) {
  let persistenceTrace = null;
  let traceSequence = 0;
  const recentLifecycleTrace = [];
  const nsfwPipelineRuns = [];
  const nsfwPipelineStages = [];
  const maxRunCount = Number.isInteger(maxNsfwPipelineRuns) && maxNsfwPipelineRuns > 0
    ? maxNsfwPipelineRuns
    : NSFW_PIPELINE_RUN_LIMIT;
  const maxStageCount = Number.isInteger(maxNsfwPipelineStages) && maxNsfwPipelineStages > 0
    ? maxNsfwPipelineStages
    : NSFW_PIPELINE_STAGE_LIMIT;
  let runSequence = 0;
  let stageSequence = 0;
  let persistenceTraceTruncated = false;
  let lifecycleTraceTruncated = false;
  let nsfwPipelineTruncated = false;
  let recorderFailed = false;

  function appendPersistenceTraceEntry(entry) {
    if (!persistenceTrace) persistenceTrace = {execution: null, sequence: [], terminal: null};
    persistenceTrace.sequence.push(entry);
    while (persistenceTrace.sequence.length > 256) {
      persistenceTrace.sequence.shift();
      persistenceTraceTruncated = true;
    }
  }

  function safeCall(callback, fallback = null) {
    try {
      return callback();
    } catch {
      recorderFailed = true;
      return fallback;
    }
  }

  function createSafeRunId() {
    runSequence += 1;
    return `nsfw_run_${Date.now().toString(36)}_${runSequence.toString(36)}`;
  }

  function normalizePipelineRun(input = {}) {
    const suppliedId = diagnosticScalar(input.run_id, 120);
    const existingIds = new Set(nsfwPipelineRuns.map(run => run.run_id));
    let runId = suppliedId || createSafeRunId();
    let suffix = 1;
    while (existingIds.has(runId)) {
      suffix += 1;
      runId = `${suppliedId || "nsfw_run"}_${suffix}`.slice(0, 120);
    }
    const floorVersion = normalizeFloorVersion(input.floor_version);
    let chatId = diagnosticScalar(input.chat_id);
    if (chatId === null) chatId = safeCall(() => diagnosticScalar(getChatId()));
    return {
      run_id: runId,
      chat_id: chatId,
      floor_version: floorVersion,
      trigger: diagnosticScalar(input.trigger),
      started_at: diagnosticTimestamp(input.started_at) ?? diagnosticNow(),
      completed_at: null,
      execution_status: "ATTEMPTED",
      source_type: "EXECUTION_TRACE",
      reason_code: diagnosticScalar(input.reason_code, 120),
    };
  }

  function startNsfwPipelineRun(input = {}) {
    return safeCall(() => {
      const run = normalizePipelineRun(input);
      nsfwPipelineRuns.push(run);
      while (nsfwPipelineRuns.length > maxRunCount) {
        const removed = nsfwPipelineRuns.shift();
        for (let index = nsfwPipelineStages.length - 1; index >= 0; index -= 1) {
          if (nsfwPipelineStages[index].run_id === removed.run_id) nsfwPipelineStages.splice(index, 1);
        }
        nsfwPipelineTruncated = true;
      }
      return run.run_id;
    });
  }

  function recordNsfwPipelineStage(input = {}) {
    return safeCall(() => {
      const runId = diagnosticScalar(input.run_id, 120);
      const run = runId ? [...nsfwPipelineRuns].reverse().find(item => item.run_id === runId) : null;
      const explicitFloorVersion = normalizeFloorVersion(input.floor_version);
      const floorVersion = explicitFloorVersion ?? run?.floor_version ?? null;
      const floorMatches = !run || !explicitFloorVersion ||
        diagnosticFloorKey(explicitFloorVersion) === diagnosticFloorKey(run.floor_version);
      const status = String(input.execution_status ?? "UNKNOWN").toUpperCase();
      const sourceType = String(input.source_type ?? "EXECUTION_TRACE").toUpperCase();
      const stage = {
        stage: diagnosticScalar(input.stage, 100) ?? "UNKNOWN",
        execution_status: NSFW_PIPELINE_STATUSES.has(status) ? status : "UNKNOWN",
        source_type: DIAGNOSTIC_SOURCE_TYPES.has(sourceType) ? sourceType : "UNKNOWN",
        reason_code: diagnosticScalar(input.reason_code, 120),
        invoked: typeof input.invoked === "boolean" ? input.invoked : null,
        started_at: diagnosticTimestamp(input.started_at),
        completed_at: diagnosticTimestamp(input.completed_at),
        duration_ms: Number.isFinite(input.duration_ms) ? Math.max(0, input.duration_ms) : null,
        input_count: Number.isFinite(input.input_count) ? Math.max(0, input.input_count) : null,
        output_count: Number.isFinite(input.output_count) ? Math.max(0, input.output_count) : null,
        error_code: diagnosticScalar(input.error_code, 120),
        run_id: runId,
        chat_id: diagnosticScalar(input.chat_id) ?? run?.chat_id ?? null,
        floor: Number.isFinite(input.floor)
          ? input.floor
          : Number.isFinite(floorVersion?.floor) ? floorVersion.floor : null,
        active_swipe_id: Number.isFinite(input.active_swipe_id)
          ? input.active_swipe_id
          : Number.isFinite(floorVersion?.swipe_id) ? floorVersion.swipe_id : null,
        subject_id: diagnosticScalar(input.subject_id),
        mechanism_key: diagnosticScalar(input.mechanism_key),
        cycle_id: diagnosticScalar(input.cycle_id),
        final_cycle_id: diagnosticScalar(input.final_cycle_id ?? input.cycle_id),
        canonical_cycle_id: diagnosticScalar(input.canonical_cycle_id),
        cycle_id_source: diagnosticScalar(input.cycle_id_source),
        cycle_id_consistent: typeof input.cycle_id_consistent === "boolean"
          ? input.cycle_id_consistent
          : null,
        cycle_id_consistency_reason_code: diagnosticScalar(input.cycle_id_consistency_reason_code),
        cycle_id_resolution_status: diagnosticScalar(input.cycle_id_resolution_status),
        cycle_id_resolution_reason_code: diagnosticScalar(input.cycle_id_resolution_reason_code),
        resolution_candidate_count: Number.isFinite(input.resolution_candidate_count)
          ? Math.max(0, input.resolution_candidate_count)
          : null,
        tracking_window_id: diagnosticScalar(input.tracking_window_id),
        tracking_window_cycle_id: diagnosticScalar(input.tracking_window_cycle_id),
        event_id: diagnosticScalar(input.event_id),
        first_exposure_event_id: diagnosticScalar(input.first_exposure_event_id),
        first_exposure_story_time: cloneSafeTraceValue(input.first_exposure_story_time ?? null),
        candidate_subject_ids: diagnosticIdArray(input.candidate_subject_ids),
        candidate_mechanism_keys: diagnosticIdArray(input.candidate_mechanism_keys),
        candidate_exposure_event_ids: diagnosticIdArray(input.candidate_exposure_event_ids),
        accepted_exposure_event_ids: diagnosticIdArray(input.accepted_exposure_event_ids),
        excluded_candidate_reasons: diagnosticReasonArray(input.excluded_candidate_reasons),
        aggregation_id: diagnosticScalar(input.aggregation_id),
        timing_instance_id: diagnosticScalar(input.timing_instance_id),
        base_min_story_days: Number.isFinite(input.base_min_story_days) ? input.base_min_story_days : null,
        base_max_story_days: Number.isFinite(input.base_max_story_days) ? input.base_max_story_days : null,
        variance_ratio: Number.isFinite(input.variance_ratio) ? input.variance_ratio : null,
        variance_cap_story_days: Number.isFinite(input.variance_cap_story_days) ? input.variance_cap_story_days : null,
        sampled_individual_offset_story_days: Number.isFinite(input.sampled_individual_offset_story_days)
          ? input.sampled_individual_offset_story_days
          : null,
        sampled_offset_source: diagnosticScalar(input.sampled_offset_source),
        frozen_offset_status: diagnosticScalar(input.frozen_offset_status),
        rng_source: diagnosticScalar(input.rng_source),
        state_modifier_story_days: Number.isFinite(input.state_modifier_story_days) ? input.state_modifier_story_days : null,
        total_adjustment_story_days: Number.isFinite(input.total_adjustment_story_days)
          ? input.total_adjustment_story_days
          : null,
        total_adjustment_cap_story_days: Number.isFinite(input.total_adjustment_cap_story_days)
          ? input.total_adjustment_cap_story_days
          : null,
        effective_min_story_days: Number.isFinite(input.effective_min_story_days)
          ? input.effective_min_story_days
          : null,
        effective_max_story_days: Number.isFinite(input.effective_max_story_days)
          ? input.effective_max_story_days
          : null,
        elapsed_story_days: Number.isFinite(input.elapsed_story_days)
          ? input.elapsed_story_days
          : null,
        timing_config_available: typeof input.timing_config_available === "boolean"
          ? input.timing_config_available
          : null,
        timing_config_source: diagnosticScalar(input.timing_config_source),
        world_rule_binding: cloneSafeTraceValue(input.world_rule_binding ?? null),
        aggregation_due: typeof input.aggregation_due === "boolean"
          ? input.aggregation_due
          : null,
        aggregation_attempted: typeof input.aggregation_attempted === "boolean"
          ? input.aggregation_attempted
          : null,
        aggregation_trigger_status: diagnosticScalar(input.aggregation_trigger_status),
        aggregation_reason_code: diagnosticScalar(input.aggregation_reason_code),
        aggregation_overdue: typeof input.aggregation_overdue === "boolean"
          ? input.aggregation_overdue
          : null,
        existing_aggregation_succeeded: typeof input.existing_aggregation_succeeded === "boolean"
          ? input.existing_aggregation_succeeded
          : null,
        accepted_exposure_count: Number.isFinite(input.accepted_exposure_count)
          ? Math.max(0, input.accepted_exposure_count)
          : null,
        persistence_attempted: typeof input.persistence_attempted === "boolean"
          ? input.persistence_attempted
          : null,
        persistence_succeeded: typeof input.persistence_succeeded === "boolean"
          ? input.persistence_succeeded
          : null,
        readback_attempted: typeof input.readback_attempted === "boolean"
          ? input.readback_attempted
          : null,
        readback_succeeded: typeof input.readback_succeeded === "boolean"
          ? input.readback_succeeded
          : null,
        readback_result_present: typeof input.readback_result_present === "boolean"
          ? input.readback_result_present
          : null,
        readback_reason_code: diagnosticScalar(input.readback_reason_code),
        operation_type: diagnosticScalar(input.operation_type),
        version_validation_layer: diagnosticScalar(input.version_validation_layer),
        version_validation_source: diagnosticScalar(input.version_validation_source),
        owner_message_index: Number.isInteger(Number(input.owner_message_index))
          ? Number(input.owner_message_index)
          : null,
        owner_message_id: diagnosticScalar(input.owner_message_id),
        expected_floor_version: cloneSafeTraceValue(input.expected_floor_version ?? null),
        actual_floor_version: cloneSafeTraceValue(input.actual_floor_version ?? null),
        stored_floor_version: cloneSafeTraceValue(input.stored_floor_version ?? null),
        stored_version_audit: cloneSafeTraceValue(input.stored_version_audit ?? null),
        version_mismatch_fields: diagnosticIdArray(input.version_mismatch_fields),
        version_classification: diagnosticScalar(input.version_classification),
        character_timing_config: cloneSafeTraceValue(input.character_timing_config ?? null),
        manual_timing_edit: cloneSafeTraceValue(input.manual_timing_edit ?? null),
        aggregation_reevaluation: cloneSafeTraceValue(input.aggregation_reevaluation ?? null),
        projection_rules_available: typeof input.projection_rules_available === "boolean"
          ? input.projection_rules_available
          : null,
        projection_rules_count: Number.isFinite(input.projection_rules_count)
          ? Math.max(0, input.projection_rules_count)
          : null,
        projection_eligibility: diagnosticScalar(input.projection_eligibility),
        timing_window_status: diagnosticScalar(input.timing_window_status),
        projection_ai_request_started: typeof input.projection_ai_request_started === "boolean"
          ? input.projection_ai_request_started
          : null,
        recovery_trigger: diagnosticScalar(input.recovery_trigger),
        recovery_status: diagnosticScalar(input.recovery_status),
        context_ready: typeof input.context_ready === "boolean" ? input.context_ready : null,
        entered_recovery: typeof input.entered_recovery === "boolean" ? input.entered_recovery : null,
        tracking_window_found: typeof input.tracking_window_found === "boolean" ? input.tracking_window_found : null,
        timing_instance_reused: typeof input.timing_instance_reused === "boolean" ? input.timing_instance_reused : null,
        timing_instance_created: typeof input.timing_instance_created === "boolean" ? input.timing_instance_created : null,
        aggregation_reused_or_created: typeof input.aggregation_reused_or_created === "boolean" ? input.aggregation_reused_or_created : null,
        stale_context_cancelled: typeof input.stale_context_cancelled === "boolean" ? input.stale_context_cancelled : null,
        floor_version: floorVersion,
        run_context_available: Boolean(run && floorMatches),
        run_floor_match: run ? floorMatches : null,
        sequence: ++stageSequence,
      };
      if (run && !floorMatches) {
        stage.reason_code ??= "RUN_FLOOR_VERSION_MISMATCH";
        stage.floor_version = explicitFloorVersion;
      }
      nsfwPipelineStages.push(stage);
      while (nsfwPipelineStages.length > maxStageCount) {
        nsfwPipelineStages.shift();
        nsfwPipelineTruncated = true;
      }
      return true;
    }, false);
  }

  function finishNsfwPipelineRun(input = {}) {
    return safeCall(() => {
      const runId = diagnosticScalar(input.run_id, 120);
      const floorKey = diagnosticFloorKey(input.floor_version);
      const run = [...nsfwPipelineRuns].reverse().find(item =>
        item.run_id === runId && (!floorKey || diagnosticFloorKey(item.floor_version) === floorKey),
      );
      if (!run) return false;
      const status = String(input.execution_status ?? "SUCCEEDED").toUpperCase();
      run.execution_status = NSFW_PIPELINE_STATUSES.has(status) ? status : "UNKNOWN";
      run.reason_code = diagnosticScalar(input.reason_code, 120);
      run.completed_at = diagnosticTimestamp(input.completed_at) ?? diagnosticNow();
      run.error_code = diagnosticScalar(input.error_code, 120);
      return true;
    }, false);
  }

  function traceCorrelationFor(stage) {
    if (!stage.run_id || !stage.run_context_available || !persistenceTrace) return [];
    const floorKey = diagnosticFloorKey(stage.floor_version);
    return (persistenceTrace.sequence ?? [])
      .filter(entry => {
        if (entry.run_id !== stage.run_id) return false;
        const entryFloor = normalizeFloorVersion(entry.floor_version);
        if (floorKey && (!entryFloor || diagnosticFloorKey(entryFloor) !== floorKey)) return false;
        if (stage.chat_id && entry.chat_id && stage.chat_id !== entry.chat_id) return false;
        return true;
      })
      .map(entry => entry.seq)
      .filter(Number.isFinite);
  }

  function getNsfwPipelineDiagnostics(filters = {}) {
    return safeCall(() => {
      const requestedRunId = diagnosticScalar(filters.run_id, 120);
      const requestedChatId = diagnosticScalar(filters.chat_id);
      const requestedFloorKey = diagnosticFloorKey(filters.floor_version);
      const matches = item =>
        (!requestedRunId || item.run_id === requestedRunId) &&
        (!requestedChatId || item.chat_id === requestedChatId) &&
        (!requestedFloorKey || diagnosticFloorKey(item.floor_version) === requestedFloorKey);
      const runs = nsfwPipelineRuns.filter(matches).map(cloneSafeTraceValue);
      const stages = nsfwPipelineStages.filter(matches).map(stage => ({
        ...cloneSafeTraceValue(stage),
        persistence_trace_sequences: traceCorrelationFor(stage),
      }));
      const historyKnown = Boolean(persistenceTrace || recentLifecycleTrace.length || nsfwPipelineRuns.length);
      // A single-flight caller may create a short-lived SKIPPED run while the
      // real execution is still running. That scheduling record is useful in
      // the trace, but it must not hide the latest actual run (including an
      // in-progress ATTEMPTED run) from the debug reader.
      const currentRun = [...runs].reverse().find(run => run?.execution_status !== "SKIPPED")
        ?? runs.at(-1)
        ?? null;
      return {
        source_type: "EXECUTION_TRACE",
        collection_status: recorderFailed ? "PARTIAL" : "OK",
        diagnostic_error_code: recorderFailed ? "DIAGNOSTIC_RECORDER_FAILED" : null,
        trace_truncated: nsfwPipelineTruncated || lifecycleTraceTruncated || persistenceTraceTruncated
          ? true
          : historyKnown ? false : null,
        trace_buffer_status: persistenceTrace ? "AVAILABLE" : historyKnown ? "SESSION_ONLY" : "EMPTY",
        current_run_id: currentRun?.run_id ?? null,
        runs,
        stages,
      };
    }, {
      source_type: "EXECUTION_TRACE",
      collection_status: "FAILED",
      diagnostic_error_code: "DIAGNOSTIC_COLLECTION_FAILED",
      trace_truncated: null,
      trace_buffer_status: "UNKNOWN",
      current_run_id: null,
      runs: [],
      stages: [],
    });
  }

  function getDiagnosticMetadata({current_run_id = null, current_floor_version = null} = {}) {
    return safeCall(() => {
      const currentFloorKey = diagnosticFloorKey(current_floor_version);
      const currentRun = current_run_id
        ? [...nsfwPipelineRuns].reverse().find(run => run.run_id === current_run_id &&
          (!currentFloorKey || diagnosticFloorKey(run.floor_version) === currentFloorKey))
        : [...nsfwPipelineRuns].reverse().find(run =>
          !currentFloorKey || diagnosticFloorKey(run.floor_version) === currentFloorKey,
        ) ?? null;
      const historyKnown = Boolean(persistenceTrace || recentLifecycleTrace.length || nsfwPipelineRuns.length);
      return {
        diagnostics_schema_version: 1,
        collected_at: diagnosticNow(),
        collection_status: recorderFailed ? "PARTIAL" : "OK",
        diagnostic_error_code: recorderFailed ? "DIAGNOSTIC_RECORDER_FAILED" : null,
        trace_buffer_status: persistenceTrace ? "AVAILABLE" : historyKnown ? "SESSION_ONLY" : "EMPTY",
        trace_truncated: nsfwPipelineTruncated || lifecycleTraceTruncated || persistenceTraceTruncated
          ? true
          : historyKnown ? false : null,
        current_run_id: currentRun?.run_id ?? null,
        current_floor_version: normalizeFloorVersion(current_floor_version),
      };
    }, {
      diagnostics_schema_version: 1,
      collected_at: null,
      collection_status: "FAILED",
      diagnostic_error_code: "DIAGNOSTIC_COLLECTION_FAILED",
      trace_buffer_status: "UNKNOWN",
      trace_truncated: null,
      current_run_id: null,
      current_floor_version: null,
    });
  }

  function observe(event) {
    return safeCall(() => {
      if (event?.type === "BIOWEAVE_PERSISTENCE_TRACE") {
        const payload = event.payload ?? {};
        if (payload.stage === "AUTO_ANALYSIS_TRIGGERED") {
          const priorSequence = persistenceTrace?.sequence ?? [];
          const mergedSequence = [...recentLifecycleTrace, ...priorSequence]
            .filter((entry, index, all) => all.findIndex(candidate => candidate?.seq === entry?.seq) === index)
            .sort((left, right) => Number(left?.seq ?? 0) - Number(right?.seq ?? 0));
          persistenceTrace = {
            execution: {
              chat_id: payload.chat_id ?? getChatId(),
              message_id: payload.message_id ?? null,
              floor: payload.floor ?? null,
              swipe_id: payload.swipe_id ?? 0,
              content_hash: payload.content_hash ?? null,
              message_version: payload.message_version ?? null,
              attempt: payload.attempt ?? null,
              trigger: payload.trigger ?? null,
            },
            // Canonical and tracking diagnostics can add more than 64 entries
            // before analysis settles. Preserve the lifecycle boundary in the
            // exported trace instead of silently dropping GENERATION_* entries.
            sequence: mergedSequence.slice(-256),
            terminal: null,
            host_post_save_hook: "NO_PUBLIC_POST_SAVE_HOOK",
          };
          if (mergedSequence.length > 256) persistenceTraceTruncated = true;
        }
        appendPersistenceTraceEntry({seq: ++traceSequence, stage: payload.stage ?? "UNKNOWN", ...sanitizePersistenceTracePayload(payload)});
      }
      if (event?.type === "EVENT_ANALYSIS_STATUS_CHANGED" && persistenceTrace && event.payload?.state !== "running") {
        persistenceTrace.terminal = event.payload?.state ?? null;
        const diagnostic = event.payload?.diagnostic ?? event.payload ?? {};
        const terminalStage = event.payload?.state === "failed"
          ? "ANALYSIS_FAILED"
          : `ANALYSIS_${String(event.payload?.state ?? "unknown").toUpperCase()}`;
        appendPersistenceTraceEntry({
          seq: ++traceSequence,
          ...sanitizePersistenceTracePayload(event.payload),
          stage: terminalStage,
          trigger: event.payload?.reason ?? persistenceTrace.execution?.trigger ?? null,
          failure_stage: event.payload?.state === "failed" ? diagnostic.stage ?? event.payload?.analysis_stage ?? null : undefined,
          error_name: event.payload?.state === "failed" ? diagnostic.error_name ?? null : undefined,
          error_code: event.payload?.state === "failed" ? diagnostic.error_code ?? event.payload?.error_code ?? null : undefined,
          error_message: event.payload?.state === "failed" ? diagnostic.error_message ?? diagnostic.safe_error_summary ?? null : undefined,
          diagnostic_code: event.payload?.state === "failed" ? diagnostic.diagnostic_code ?? event.payload?.diagnostic_code ?? null : undefined,
        });
      }
      if (event?.type === "PROJECTION_ANALYSIS_STATUS_CHANGED") {
        const payload = event.payload ?? {};
        if (!persistenceTrace) {
          persistenceTrace = {
            execution: {
              chat_id: payload.chat_id ?? getChatId(),
              message_id: payload.floor_version?.message_id ?? null,
              floor: payload.floor_version?.floor ?? null,
              swipe_id: payload.floor_version?.swipe_id ?? null,
              content_hash: payload.floor_version?.content_hash ?? null,
              message_version: payload.floor_version?.message_version ?? null,
              attempt: payload.execution_id ?? null,
              trigger: payload.trigger ?? payload.reason ?? null,
            },
            sequence: [],
            terminal: null,
            host_post_save_hook: "NO_PUBLIC_POST_SAVE_HOOK",
          };
        }
        appendPersistenceTraceEntry({
          seq: ++traceSequence,
          stage: payload.stage ?? `PROJECTION_${String(payload.phase ?? "STATUS").toUpperCase()}`,
          ...sanitizePersistenceTracePayload(payload),
        });
        if (payload.state && payload.state !== "running") persistenceTrace.terminal = payload.state;
      }
      return true;
    }, false);
  }

  function recordLifecycleTrace(stage, payload, chatId) {
    return safeCall(() => {
      const generationType = typeof payload === "object"
        ? payload?.genType ?? payload?.generation_type ?? payload?.type ?? null
        : payload;
      const generationSource = typeof payload === "object"
        ? payload?.source ?? payload?.generation_source ?? payload?.reason ?? null
        : null;
      const entry = {seq: ++traceSequence, stage, chat_id: chatId ?? getChatId()};
      const safe = sanitizePersistenceTracePayload({
        ...(payload && typeof payload === "object" ? payload : {}),
        ...(generationType != null ? {generation_type: String(generationType).slice(0, 40)} : {}),
        ...(generationSource != null ? {generation_source: String(generationSource).slice(0, 80)} : {}),
      });
      recentLifecycleTrace.push({...entry, ...safe});
      while (recentLifecycleTrace.length > 64) {
        recentLifecycleTrace.shift();
        lifecycleTraceTruncated = true;
        if (persistenceTrace) persistenceTraceTruncated = true;
      }
      if (persistenceTrace) appendPersistenceTraceEntry({...entry, ...safe});
      return true;
    }, false);
  }

  function getPersistenceTrace() {
    if (!persistenceTrace) return null;
    const bySequence = new Map();
    for (const entry of persistenceTrace.sequence ?? []) {
      if (!Number.isFinite(Number(entry?.seq))) continue;
      bySequence.set(entry.seq, entry);
    }
    const sequence = [...bySequence.values()].sort((left, right) => left.seq - right.seq);
    const assessmentGroups = new Map();
    for (const entry of sequence) {
      if (!String(entry.stage ?? '').startsWith('HEALTH_ASSESSMENT_')) continue;
      const key = entry.request_key ?? entry.source_event_id ?? 'unknown';
      const current = assessmentGroups.get(key) ?? {
        source_event_id: entry.source_event_id ?? null,
        request_key: entry.request_key ?? null,
        lookup_count: 0,
        ai_request_started_count: 0,
        ai_request_completed_count: 0,
        ai_request_failed_count: 0,
        reuse_count: 0,
        inflight_reuse_count: 0,
      };
      if (entry.stage === 'HEALTH_ASSESSMENT_LOOKUP') current.lookup_count += 1;
      if (entry.stage === 'HEALTH_ASSESSMENT_REQUEST_STARTED') current.ai_request_started_count += 1;
      if (entry.stage === 'HEALTH_ASSESSMENT_REQUEST_COMPLETED') current.ai_request_completed_count += 1;
      if (entry.stage === 'HEALTH_ASSESSMENT_REQUEST_FAILED') current.ai_request_failed_count += 1;
      if (entry.stage === 'HEALTH_ASSESSMENT_REUSED') current.reuse_count += 1;
      if (entry.stage === 'HEALTH_ASSESSMENT_INFLIGHT_REUSED') current.inflight_reuse_count += 1;
      assessmentGroups.set(key, current);
    }
    const latestGeneration = [...sequence].reverse().find(entry => entry.stage === 'GENERATION_PROJECTION_REFRESH_SETTLED') ?? null;
    const latestSlot = [...sequence].reverse().find(entry => entry.stage === 'PROJECTION_CONTEXT_SLOT_WRITTEN' || entry.stage === 'PROJECTION_CONTEXT_SLOT_CLEARED') ?? null;
    return cloneSafeTraceValue({
      ...persistenceTrace,
      trace_truncated: persistenceTraceTruncated || lifecycleTraceTruncated || persistenceTrace.trace_truncated === true,
      sequence,
      summary: {
        health_assessments: [...assessmentGroups.values()],
        projection_context: latestSlot ? {
          slot: latestSlot.slot ?? 'bioweave_projection_context',
          context_nonempty: latestSlot.context_nonempty ?? latestSlot.slot_nonempty ?? false,
          context_fingerprint: latestSlot.context_fingerprint ?? null,
          health_guidance_count: latestSlot.health_guidance_count ?? 0,
          projection_ids: latestSlot.context_visible_projection_ids ?? latestSlot.projection_ids ?? [],
        } : null,
        generation: latestGeneration ? {
          generation_id: latestGeneration.generation_id ?? null,
          generation_intent_id: latestGeneration.generation_intent_id ?? null,
          projection_refresh_awaited: latestGeneration.settled_before_listener_resolve === true,
          context_ready_before_listener_resolve: latestGeneration.context_ready_before_prompt_read === true,
          refresh_outcome: latestGeneration.refresh_outcome ?? null,
        } : null,
        projection: {
          ai_request_started_count: sequence.filter(entry => entry.stage === 'PROJECTION_AI_REQUEST_STARTED').length,
          ai_request_completed_count: sequence.filter(entry => entry.stage === 'PROJECTION_AI_REQUEST_COMPLETED').length,
          ai_request_failed_count: sequence.filter(entry => entry.stage === 'PROJECTION_AI_REQUEST_COMPLETED' && entry.ai_request_failed === true).length,
          generated_projection_ids: [...new Set(sequence.flatMap(entry => entry.generated_projection_ids ?? []))],
          latest_view_count: [...sequence].reverse().find(entry => entry.stage === 'PROJECTION_READBACK')?.projection_view_count ?? null,
          latest_context_visible_count: [...sequence].reverse().find(entry => entry.stage === 'PROJECTION_READBACK')?.context_visible_projection_count ?? null,
        },
      },
    });
  }

  return {
    observe,
    recordLifecycleTrace,
    getPersistenceTrace,
    startNsfwPipelineRun,
    recordNsfwPipelineStage,
    finishNsfwPipelineRun,
    getNsfwPipelineDiagnostics,
    getDiagnosticMetadata,
    sanitizePersistenceTracePayload,
    cloneSafeTraceValue,
    diagnosticFingerprint,
    formatExecutionDiagnostic: executionError,
    buildFloorPreflightStatus,
    buildReloadFloorSlotAudit,
    buildStoryTimeDebugInfo,
  };
}
