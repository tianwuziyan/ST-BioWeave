import {
  normalizeEvent,
  validateEventCollection,
  validateEventStoryTimesAtOrBefore,
} from "../core/events.js";
import {normalizeCharacterRegistry} from "../core/identity.js";
import {parseStoryTimeCandidate} from "../story/time.js";
import {durationMs, monotonicNow} from "./diagnostics.js";

let eventEditOperationSequence = 0;

function createEventEditOperationId() {
  eventEditOperationSequence += 1;
  return `event-edit-${Date.now()}-${eventEditOperationSequence}`;
}

export function createEventEditing({
  resolveCurrentEventState,
  invalidateMutation,
  commitFloorPatch,
  assertMutationToken,
  clearInvalidatedFloor,
  refreshTrackingRegistry,
  createCollectionValidationError,
  getCurrentStoryTime,
  storyTime,
  emitStoryTimeDiagnostic,
  emitEventEditTrace,
} = {}) {
  function traceEdit(stage, target, eventId, details = {}) {
    emitEventEditTrace?.(stage, target, {
      event_id: String(eventId ?? '').trim() || null,
      persistence_entered: ['EVENT_EDIT_PERSISTENCE_FAILED', 'EVENT_EDIT_PERSISTENCE_CONFIRMED', 'EVENT_EDIT_REFRESH_FAILED'].includes(stage),
      ...details,
    });
  }

  function errorDetails(error) {
    return {
      validation_stage: error?.validation_stage ?? error?.analysis_stage ?? null,
      error_code: error?.error_code ?? error?.diagnostic_code ?? error?.code ?? error?.message ?? 'EVENT_EDIT_FAILED',
      safe_error_summary: error?.safe_error_summary ?? error?.message ?? 'Event 编辑失败',
      error_path: error?.diagnostic_path ?? error?.error_path ?? error?.instancePath ?? error?.path ?? null,
      validation_error_path: error?.diagnostic_path ?? error?.error_path ?? error?.instancePath ?? error?.path ?? null,
      validator: error?.validator ?? null,
      keyword: error?.keyword ?? null,
    };
  }

  function isStaleError(error) {
    const code = String(error?.code ?? error?.message ?? '');
    return code === 'STALE_CHAT' || code.startsWith('FLOOR_TX_STALE') || code.startsWith('FLOOR_TX_SUPERSEDED') || code === 'STALE_FLOOR_VERSION';
  }

  function normalizeEditedStoryTime(rawStoryTime) {
    const display = typeof rawStoryTime?.display === "string"
      ? rawStoryTime.display.trim()
      : "";
    if (!display) {
      return typeof storyTime?.normalize === "function"
        ? storyTime.normalize(rawStoryTime)
        : rawStoryTime;
    }
    const calendar = typeof storyTime?.getCalendarFor === "function"
      ? storyTime.getCalendarFor(display)
      : null;
    const candidate = parseStoryTimeCandidate(display, {calendar});
    if (!candidate) {
      const error = new Error("EVENT_EDIT_STORY_TIME_INVALID");
      error.code = "EVENT_EDIT_STORY_TIME_INVALID";
      error.analysis_stage = "event_time_normalization";
      throw error;
    }
    const normalized = typeof storyTime?.normalize === "function"
      ? storyTime.normalize({display})
      : candidate;
    if (!normalized?.display) {
      const error = new Error("EVENT_EDIT_STORY_TIME_INVALID");
      error.code = "EVENT_EDIT_STORY_TIME_INVALID";
      error.analysis_stage = "event_time_normalization";
      throw error;
    }
    return normalized;
  }

  async function findActiveEvent(eventId) {
    const targetId = String(eventId ?? "").trim();
    if (!targetId) throw new Error("EVENT_NOT_FOUND");
    const target = await resolveCurrentEventState();
    const event = (target.events ?? []).find(
      (candidate) => String(candidate?.event_id) === targetId,
    );
    if (event) return {...target, event};
    throw new Error("EVENT_NOT_FOUND");
  }

  async function updateEvent(eventId, patch = {}, options = {}) {
    const operationId = String(options?.event_edit_operation_id ?? "").trim() || createEventEditOperationId();
    const runtimeStartedAt = monotonicNow();
    const floorResolutionStartedAt = monotonicNow();
    const target = await findActiveEvent(eventId);
    const floorResolutionDuration = durationMs(floorResolutionStartedAt);
    const trace = (stage, details = {}) => traceEdit(stage, target, eventId, {
      event_edit_operation_id: operationId,
      ...details,
    });
    trace('EVENT_EDIT_SUBMITTED', {
      fields: Object.keys(patch).filter(field => ['type', 'status', 'location', 'story_time'].includes(field)),
      floor_resolution_duration_ms: floorResolutionDuration,
      runtime_duration_ms: durationMs(runtimeStartedAt),
    });
    let nextEvent;
    const normalizationStartedAt = monotonicNow();
    try {
      const editedStoryTime = Object.prototype.hasOwnProperty.call(patch, "story_time")
        ? normalizeEditedStoryTime(patch.story_time)
        : target.event.story_time;
      nextEvent = normalizeEvent({
        ...target.event,
        ...patch,
        story_time: editedStoryTime,
        event_id: target.event.event_id,
        source: target.event.source,
      });
    } catch (error) {
      trace('EVENT_EDIT_NORMALIZATION_FAILED', {
        ...errorDetails(error),
        failure_stage: 'event_normalization',
        event_normalization_duration_ms: durationMs(normalizationStartedAt),
        runtime_duration_ms: durationMs(runtimeStartedAt),
      });
      throw error;
    }
    const eventNormalizationDuration = durationMs(normalizationStartedAt);
    trace('EVENT_EDIT_NORMALIZATION_COMPLETED', {
      event_normalization_duration_ms: eventNormalizationDuration,
      runtime_duration_ms: durationMs(runtimeStartedAt),
    });
    const characterRegistry = normalizeCharacterRegistry(
      target.inheritedCharacterRegistry ?? target.floorData.character_registry,
    );
    // A local edit does not change participant identity bindings. Keep the
    // authoritative Event as read, even when an older Floor lacks the
    // registry snapshot that originally accompanied it. The formal Event
    // collection validator still checks participant shape and references.
    const events = [...(Array.isArray(target.events) ? target.events : [])];
    const index = events.findIndex(
      (event) => String(event?.event_id) === String(eventId),
    );
    if (index < 0) throw new Error("EVENT_NOT_FOUND");
    events[index] = nextEvent;
    const validationStartedAt = monotonicNow();
    const storyTime = typeof getCurrentStoryTime === "function"
      ? await getCurrentStoryTime(target)
      : null;
    const storyTimeValidation = validateEventStoryTimesAtOrBefore([nextEvent], storyTime);
    if (!storyTimeValidation.ok) {
      const error = new Error("EVENT_STORY_TIME_AFTER_CURRENT");
      error.code = "EVENT_STORY_TIME_AFTER_CURRENT";
      error.analysis_stage = "event_time_validation";
      error.validation_stage = "event_time_validation";
      error.event_ids = storyTimeValidation.future_event_ids;
      trace('EVENT_EDIT_VALIDATION_FAILED', {
        ...errorDetails(error),
        failure_stage: 'event_time_validation',
        event_validation_duration_ms: durationMs(validationStartedAt),
        runtime_duration_ms: durationMs(runtimeStartedAt),
      });
      throw error;
    }
    if (storyTimeValidation.incomparable_event_ids.length && typeof emitStoryTimeDiagnostic === "function") {
      emitStoryTimeDiagnostic({
        code: "EVENT_STORY_TIME_INCOMPARABLE",
        event_ids: storyTimeValidation.incomparable_event_ids,
        target: target.version,
        event_edit_operation_id: operationId,
      });
    }
    const collectionValidation = validateEventCollection(events);
    if (!collectionValidation.ok) {
      const error = createCollectionValidationError(
        collectionValidation,
        "EVENT_ANALYSIS_INVALID",
        events,
      );
      error.validation_stage ??= "event_collection_validation";
      trace('EVENT_EDIT_VALIDATION_FAILED', {
        ...errorDetails(error),
        failure_stage: 'event_collection_validation',
        event_validation_duration_ms: durationMs(validationStartedAt),
        runtime_duration_ms: durationMs(runtimeStartedAt),
      });
      throw error;
    }
    trace('EVENT_EDIT_VALIDATION_COMPLETED', {
      event_validation_duration_ms: durationMs(validationStartedAt),
      runtime_duration_ms: durationMs(runtimeStartedAt),
    });
    let mutationToken;
    const staleGuardStartedAt = monotonicNow();
    try {
      mutationToken = await invalidateMutation(
        {type: "MESSAGE_EDITED", payload: {message_id: target.version.message_id}},
        target.index,
        {mutationScope: "target-local"},
      );
    } catch (error) {
      trace(isStaleError(error) ? 'EVENT_EDIT_STALE_REJECTED' : 'EVENT_EDIT_PERSISTENCE_FAILED', {
        ...errorDetails(error),
        failure_stage: isStaleError(error) ? 'stale_guard' : 'mutation_invalidation',
        stale_guard_duration_ms: durationMs(staleGuardStartedAt),
        runtime_duration_ms: durationMs(runtimeStartedAt),
      });
      throw error;
    }
    const analysis = {
      ...(target.floorData.analysis ?? target.inheritedAnalysis ?? {}),
      status: "success",
      floor_version: target.version,
      event_count: events.length,
    };
    const persistenceStartedAt = monotonicNow();
    try {
      await commitFloorPatch(target, "event", {analysis, events, character_registry: characterRegistry}, {
        operation_type: "event-edit-patch",
        assertCurrent: () => assertMutationToken(mutationToken),
        traceContext: {event_edit_operation_id: operationId},
      });
      assertMutationToken(mutationToken);
      trace('EVENT_EDIT_PERSISTENCE_CONFIRMED', {
        persistence_confirmed: true,
        success: true,
        persistence_duration_ms: durationMs(persistenceStartedAt),
        stale_guard_duration_ms: durationMs(staleGuardStartedAt),
        runtime_duration_ms: durationMs(runtimeStartedAt),
      });
    } catch (error) {
      trace(isStaleError(error) ? 'EVENT_EDIT_STALE_REJECTED' : 'EVENT_EDIT_PERSISTENCE_FAILED', {
        ...errorDetails(error),
        failure_stage: isStaleError(error) ? 'stale_guard' : 'persistence',
        persistence_duration_ms: durationMs(persistenceStartedAt),
        stale_guard_duration_ms: durationMs(staleGuardStartedAt),
        runtime_duration_ms: durationMs(runtimeStartedAt),
      });
      throw error;
    }
    clearInvalidatedFloor(target.version);
    const trackingRefreshStartedAt = monotonicNow();
    try {
      await refreshTrackingRegistry("event-edit");
      trace('EVENT_EDIT_TRACKING_REFRESH_COMPLETED', {
        success: true,
        persistence_confirmed: true,
        tracking_registry_refresh_duration_ms: durationMs(trackingRefreshStartedAt),
        post_save_refresh_duration_ms: durationMs(trackingRefreshStartedAt),
        runtime_duration_ms: durationMs(runtimeStartedAt),
      });
    } catch (error) {
      const refreshError = Object.assign(error instanceof Error ? error : new Error(String(error)), {
        code: 'EVENT_EDIT_REFRESH_FAILED',
        persistence_confirmed: true,
        original_code: error?.code ?? error?.message ?? 'REFRESH_FAILED',
      });
      trace('EVENT_EDIT_REFRESH_FAILED', {
        ...errorDetails(error),
        persistence_confirmed: true,
        failure_stage: 'post_save_refresh',
        tracking_registry_refresh_duration_ms: durationMs(trackingRefreshStartedAt),
        runtime_duration_ms: durationMs(runtimeStartedAt),
      });
      throw refreshError;
    }
    return nextEvent;
  }

  async function deleteEvent(eventId) {
    const target = await findActiveEvent(eventId);
    const events = (Array.isArray(target.events) ? target.events : [])
      .filter((event) => String(event?.event_id) !== String(eventId));
    const mutationToken = await invalidateMutation(
      {type: "MESSAGE_DELETED", payload: {message_id: target.version.message_id}},
      target.index,
      {mutationScope: "target-local"},
    );
    const analysis = {
      ...(target.floorData.analysis ?? target.inheritedAnalysis ?? {}),
      status: "success",
      floor_version: target.version,
      event_count: events.length,
    };
    const characterRegistry = normalizeCharacterRegistry(
      target.inheritedCharacterRegistry ?? target.floorData.character_registry,
    );
    await commitFloorPatch(target, "event", {analysis, events, character_registry: characterRegistry}, {
      operation_type: "event-delete-patch",
      assertCurrent: () => assertMutationToken(mutationToken),
    });
    assertMutationToken(mutationToken);
    clearInvalidatedFloor(target.version);
    await refreshTrackingRegistry("event-delete");
    return true;
  }

  return {updateEvent, deleteEvent};
}
