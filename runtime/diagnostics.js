import {
  safeErrorSummary as clientSafeErrorSummary,
  statusFromError as clientStatusFromError,
} from "../ai/client.js";

function cloneSafeTraceValue(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(cloneSafeTraceValue);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, cloneSafeTraceValue(item)]),
  );
}

function sanitizePersistenceTracePayload(payload = {}) {
  const allowed = [
    "chat_id", "active_chat_id", "active_character_floor_message_id", "active_swipe_id", "message_id", "floor", "swipe_id", "content_hash",
    "message_version", "attempt", "execution_attempt", "stage_attempt", "retry_index", "persistence_invocation_id", "trigger", "domain", "state", "path",
    "retry_index", "max_retries", "failure_stage", "failure_code",
    "retry_decision", "retry_reason",
    "generation_id", "generation_type", "generation_source", "generation_intent_id", "generation_final_floor_seen", "generation_ended", "generation_settled", "execution_active", "current_execution_id", "target_message_id", "target_swipe_id", "owner_changed", "supersede_decision", "supersede_reason",
    "cancel_stage", "cancel_reason", "cancel_code",
    "classification", "retry_classification", "retryable", "version_check_source",
    "expected_floor_version", "actual_floor_version", "expected_content_hash", "actual_content_hash",
    "mismatch_fields", "active_chat_match", "message_owner_match", "floor_match",
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
    "source", "ready",
    "persistence_transaction_id", "floor_transaction_id", "transaction_key", "owner", "operation_type", "patch_fields", "queue_key", "queued", "before_presence", "after_presence", "missing_owner_fields", "missing_siblings", "save_invocation_id", "commit_state", "save_state",
    "resolution_reason", "request_source", "panel_open", "active_tab",
    "refresh_cycle_in_flight", "queued_refresh", "business_refresh_sequence",
    "error_name", "error_message", "error_path", "diagnostic_code", "analysis_stage", "validation_stage",
    "response_shape", "extraction_mode", "parsed", "events_present",
    "schema_valid", "domain_valid", "validation_error_path",
    "valid_empty", "empty_reason", "expected_event_count",
    "expected_character_count", "expected_character_ids", "actual_event_count",
    "actual_character_count", "actual_registry_character_count",
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

function safeDiagnosticSummary(error, stage = null) {
  const code = diagnosticCode(error);
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
  if (retryClassification === "true_owner_change")
    return "当前楼层状态发生变化，本次世界分析结果未写入。";
  if (error?.analysis_stage === "floor_owner_convergence" ||
      code === "AUTO_ANALYSIS_FLOOR_PREREQUISITE_UNAVAILABLE" ||
      code === "HOST_CONVERGENCE_FAILED" ||
      code === "HOST_CONVERGENCE_UNAVAILABLE") {
    if (code === "HOST_CONVERGENCE_FAILED" || error?.version_check_source === "host_authoritative_save")
      return "宿主聊天保存失败，自动分析未开始。";
    if (retryClassification === "true_owner_change")
      return "当前楼层状态已变化，本次分析已取消。";
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
  const currentStoryTimeParsed = Boolean(currentStoryTime?.normalized || currentStoryTime?.day_index !== null);
  const eventStoryTimeParsed = Boolean(eventStoryTime?.normalized || eventStoryTime?.day_index !== null);
  const failureReason = difference
    ? null
    : info.status === "NO_CHARACTER_FLOOR"
      ? "CURRENT_STORY_TIME_UNKNOWN"
      : !currentStoryTimeParsed
        ? "CURRENT_STORY_TIME_PARSE_FAILED"
        : event && !eventStoryTimeParsed
          ? "HISTORICAL_STORY_TIME_PARSE_FAILED"
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
    recent_event: event ? {event_id: eventId, story_time: eventStoryTime, difference} : null,
    difference,
    failure_reason: difference ? null : failureReason,
    trace,
  };
}

export function createRuntimeDiagnostics({getChatId = () => null} = {}) {
  let persistenceTrace = null;
  let traceSequence = 0;
  const recentLifecycleTrace = [];

  function observe(event) {
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
          sequence: mergedSequence.slice(-64),
          terminal: null,
          host_post_save_hook: "NO_PUBLIC_POST_SAVE_HOOK",
        };
      }
      if (!persistenceTrace) persistenceTrace = {execution: null, sequence: [], terminal: null};
      persistenceTrace.sequence.push({seq: ++traceSequence, stage: payload.stage ?? "UNKNOWN", ...sanitizePersistenceTracePayload(payload)});
    }
    if (event?.type === "EVENT_ANALYSIS_STATUS_CHANGED" && persistenceTrace && event.payload?.state !== "running") {
      persistenceTrace.terminal = event.payload?.state ?? null;
      const diagnostic = event.payload?.diagnostic ?? event.payload ?? {};
      const terminalStage = event.payload?.state === "failed"
        ? "ANALYSIS_FAILED"
        : `ANALYSIS_${String(event.payload?.state ?? "unknown").toUpperCase()}`;
      persistenceTrace.sequence.push({
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
  }

  function recordLifecycleTrace(stage, payload, chatId) {
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
    while (recentLifecycleTrace.length > 64) recentLifecycleTrace.shift();
    if (persistenceTrace) persistenceTrace.sequence.push({...entry, ...safe});
  }

  function getPersistenceTrace() {
    if (!persistenceTrace) return null;
    const bySequence = new Map();
    for (const entry of persistenceTrace.sequence ?? []) {
      if (!Number.isFinite(Number(entry?.seq))) continue;
      bySequence.set(entry.seq, entry);
    }
    return cloneSafeTraceValue({
      ...persistenceTrace,
      sequence: [...bySequence.values()].sort((left, right) => left.seq - right.seq),
    });
  }

  return {
    observe,
    recordLifecycleTrace,
    getPersistenceTrace,
    sanitizePersistenceTracePayload,
    cloneSafeTraceValue,
    formatExecutionDiagnostic: executionError,
    buildFloorPreflightStatus,
    buildReloadFloorSlotAudit,
    buildStoryTimeDebugInfo,
  };
}
