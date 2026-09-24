import {rebuildTrackingRegistry} from "../core/tracking.js";

export function createTrackingRuntime({
  collectTrackingInputs,
  isEnabled = () => true,
  hasMessageCollection = () => true,
  getToken,
  assertToken,
  notify,
  enqueueRefresh,
} = {}) {
  function buildTrackingRegistry({activeEvents = [], worldModel = null} = {}) {
    return rebuildTrackingRegistry(activeEvents, {
      world_model: worldModel,
    });
  }

  function refreshTrackingRegistry(reason = "runtime") {
    const refresh = async () => {
      if (!isEnabled()) return {skipped: true, status: "disabled", reason};
      if (!hasMessageCollection()) return null;
      const token = getToken();
      const inputs = await collectTrackingInputs(token);
      const registry = buildTrackingRegistry(inputs);
      assertToken(token);
      notify({
        type: "TRACKING_REGISTRY_REFRESHED",
        payload: {reason, event_count: inputs.activeEvents.length},
        chatId: token.chatId,
      });
      return {
        ...registry,
        character_registry: inputs.characterRegistry,
        active_events: inputs.activeEvents,
      };
    };
    return enqueueRefresh(refresh);
  }

  return {buildTrackingRegistry, refreshTrackingRegistry};
}
