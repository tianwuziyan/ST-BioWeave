import {rebuildTrackingRegistry} from "../core/tracking.js";
import {createTrackingWindowRuntime} from './tracking-window-runtime.js';

export function createTrackingRuntime({
  collectTrackingInputs,
  isEnabled = () => true,
  hasMessageCollection = () => true,
  getToken,
  assertToken,
  notify,
  enqueueRefresh,
  trackingWindowRuntime = createTrackingWindowRuntime(),
} = {}) {
  function buildTrackingWindows({activeEvents = [], chatId = null, worldModel = {}, currentStoryTime = null, subjectProfiles = {}, persistedWindows = []} = {}) {
    return trackingWindowRuntime?.buildTrackingWindows
      ? trackingWindowRuntime.buildTrackingWindows({activeEvents, chatId, worldModel, currentStoryTime, subjectProfiles, persistedWindows})
      : [];
  }

  function buildTrackingRegistry({activeEvents = [], worldModel = null, trackingWindows = null, chatId = null, currentStoryTime = null, subjectProfiles = {}, persistedWindows = []} = {}) {
    const registry = rebuildTrackingRegistry(activeEvents, {
      world_model: worldModel,
      trackingWindows: trackingWindows ?? (chatId ? buildTrackingWindows({activeEvents, chatId, worldModel, currentStoryTime, subjectProfiles, persistedWindows}) : null),
    });
    const resolvedWindows = trackingWindows ?? (chatId ? buildTrackingWindows({activeEvents, chatId, worldModel, currentStoryTime, subjectProfiles, persistedWindows}) : null);
    if (resolvedWindows) Object.defineProperty(registry, 'tracking_windows', {enumerable: false, get: () => resolvedWindows});
    return registry;
  }

  function refreshTrackingRegistry(reason = "runtime") {
    const refresh = async () => {
      if (!isEnabled()) return {skipped: true, status: "disabled", reason};
      if (!hasMessageCollection()) return null;
      const token = getToken();
      const inputs = await collectTrackingInputs(token);
      const trackingWindows = inputs.trackingWindows ?? buildTrackingWindows({...inputs, activeEvents: inputs.activeEvents, chatId: token.chatId});
      const registry = buildTrackingRegistry({...inputs, trackingWindows, chatId: token.chatId});
      assertToken(token);
      notify({
        type: "TRACKING_REGISTRY_REFRESHED",
        payload: {reason, event_count: inputs.activeEvents.length},
        chatId: token.chatId,
      });
      return {
        ...registry,
        tracking_windows: trackingWindows,
        character_registry: inputs.characterRegistry,
        active_events: inputs.activeEvents,
      };
    };
    return enqueueRefresh(refresh);
  }

  return {buildTrackingWindows, buildTrackingRegistry, refreshTrackingRegistry};
}
