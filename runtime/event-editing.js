import {normalizeEvent, validateEventCollection} from "../core/events.js";
import {hasCharacterId, normalizeCharacterRegistry} from "../core/identity.js";

export function createEventEditing({
  getMessages = () => [],
  isCharacterMessage = () => false,
  resolveFloorAtIndex,
  getActiveFloorEvents,
  invalidateMutation,
  commitFloorPatch,
  assertMutationToken,
  clearInvalidatedFloor,
  refreshTrackingRegistry,
  createCollectionValidationError,
} = {}) {
  async function findActiveEvent(eventId) {
    const targetId = String(eventId ?? "").trim();
    if (!targetId) throw new Error("EVENT_NOT_FOUND");
    const all = getMessages();
    for (let index = 0; index < all.length; index += 1) {
      if (!isCharacterMessage(all[index])) continue;
      const target = await resolveFloorAtIndex({__messageIndex: true, index});
      const events = getActiveFloorEvents(index, target.version) ?? [];
      const event = events.find(
        (candidate) => String(candidate?.event_id) === targetId,
      );
      if (event) return {...target, event};
    }
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
      target.floorData.character_registry,
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
    const events = [
      ...(Array.isArray(target.floorData.events) ? target.floorData.events : []),
    ];
    const index = events.findIndex(
      (event) => String(event?.event_id) === String(eventId),
    );
    if (index < 0) throw new Error("EVENT_NOT_FOUND");
    events[index] = nextEvent;
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
      {preserveTarget: true},
    );
    await commitFloorPatch(target, "event", {events}, {
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
    const events = (
      Array.isArray(target.floorData.events) ? target.floorData.events : []
    ).filter((event) => String(event?.event_id) !== String(eventId));
    const mutationToken = await invalidateMutation(
      {type: "MESSAGE_DELETED", payload: {message_id: target.version.message_id}},
      target.index,
      {preserveTarget: true},
    );
    await commitFloorPatch(target, "event", {events}, {
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
