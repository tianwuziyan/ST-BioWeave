import {
  normalizeEvent,
  validateEventCollection,
  validateEventStoryTimesAtOrBefore,
} from "../core/events.js";
import {hasCharacterId, normalizeCharacterRegistry} from "../core/identity.js";

export function createEventEditing({
  resolveCurrentEventState,
  invalidateMutation,
  commitFloorPatch,
  assertMutationToken,
  clearInvalidatedFloor,
  refreshTrackingRegistry,
  createCollectionValidationError,
  getCurrentStoryTime,
  emitStoryTimeDiagnostic,
} = {}) {
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

  async function updateEvent(eventId, patch = {}) {
    const target = await findActiveEvent(eventId);
    const nextEvent = normalizeEvent({
      ...target.event,
      ...patch,
      event_id: target.event.event_id,
      source: target.event.source,
    });
    const characterRegistry = normalizeCharacterRegistry(
      target.inheritedCharacterRegistry ?? target.floorData.character_registry,
    );
    for (const [participantIndex, participant] of nextEvent.participants.entries()) {
      if (hasCharacterId(characterRegistry, participant.character_id)) continue;
      const error = new Error("EVENT_IDENTITY_RESOLUTION_FAILED");
      error.code = "EVENT_IDENTITY_RESOLUTION_FAILED";
      error.analysis_stage = "identity_resolution";
      error.diagnostic_code = "unknown_character_id";
      error.error_code = "unknown_character_id";
      error.diagnostic_path = `participants[${participantIndex}].character_id`;
      error.error_path = error.diagnostic_path;
      throw error;
    }
    const events = [...(Array.isArray(target.events) ? target.events : [])];
    const index = events.findIndex(
      (event) => String(event?.event_id) === String(eventId),
    );
    if (index < 0) throw new Error("EVENT_NOT_FOUND");
    events[index] = nextEvent;
    const storyTime = typeof getCurrentStoryTime === "function"
      ? await getCurrentStoryTime(target)
      : null;
    const storyTimeValidation = validateEventStoryTimesAtOrBefore([nextEvent], storyTime);
    if (!storyTimeValidation.ok) {
      const error = new Error("EVENT_STORY_TIME_AFTER_CURRENT");
      error.code = "EVENT_STORY_TIME_AFTER_CURRENT";
      error.analysis_stage = "event_time_validation";
      error.event_ids = storyTimeValidation.future_event_ids;
      throw error;
    }
    if (storyTimeValidation.incomparable_event_ids.length && typeof emitStoryTimeDiagnostic === "function") {
      emitStoryTimeDiagnostic({
        code: "EVENT_STORY_TIME_INCOMPARABLE",
        event_ids: storyTimeValidation.incomparable_event_ids,
        target: target.version,
      });
    }
    const collectionValidation = validateEventCollection(events);
    if (!collectionValidation.ok) {
      throw createCollectionValidationError(
        collectionValidation,
        "EVENT_ANALYSIS_INVALID",
        events,
      );
    }
    const mutationToken = await invalidateMutation(
      {type: "MESSAGE_EDITED", payload: {message_id: target.version.message_id}},
      target.index,
      {mutationScope: "target-local"},
    );
    const analysis = {
      ...(target.floorData.analysis ?? target.inheritedAnalysis ?? {}),
      status: "success",
      floor_version: target.version,
      event_count: events.length,
    };
    await commitFloorPatch(target, "event", {analysis, events, character_registry: characterRegistry}, {
      operation_type: "event-edit-patch",
      assertCurrent: () => assertMutationToken(mutationToken),
    });
    assertMutationToken(mutationToken);
    clearInvalidatedFloor(target.version);
    await refreshTrackingRegistry("event-edit");
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
