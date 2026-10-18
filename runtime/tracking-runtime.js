import {rebuildTrackingRegistry} from "../core/tracking.js";
import {deriveReproductiveSourceCandidates} from '../core/reproductive-attribution.js';
import {createTrackingWindowRuntime} from './tracking-window-runtime.js';
import {durationMs, monotonicNow} from './diagnostics.js';

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
  function buildTrackingWindows({activeEvents = [], chatId = null, worldModel = {}, currentStoryTime = null, floorVersion = null, subjectProfiles = {}, timingInstances = [], participantAggregations = [], lifecycleReleaseRecords = [], persistedWindows = [], onDiagnostics = null} = {}) {
    return trackingWindowRuntime?.buildTrackingWindows
      ? trackingWindowRuntime.buildTrackingWindows({activeEvents, chatId, worldModel, currentStoryTime, floorVersion, subjectProfiles, timingInstances, participantAggregations, lifecycleReleaseRecords, persistedWindows, onDiagnostics})
      : [];
  }

  function buildTrackingRegistry({activeEvents = [], worldModel = null, trackingWindows = null, chatId = null, currentStoryTime = null, floorVersion = null, subjectProfiles = {}, timingInstances = [], participantAggregations = [], lifecycleReleaseRecords = [], persistedWindows = []} = {}) {
    const buildStartedAt = monotonicNow();
    const inputEventCount = Array.isArray(activeEvents) ? activeEvents.length : 0;
    const uniqueEventCount = new Set(
      (Array.isArray(activeEvents) ? activeEvents : [])
        .map(event => typeof event?.event_id === 'string' ? event.event_id.trim() : '')
        .filter(Boolean),
    ).size;
    const windowStartedAt = monotonicNow();
    const shouldBuildWindows = trackingWindows == null && Boolean(chatId);
    let windowDiagnostics = null;
    const resolvedWindows = trackingWindows ?? (chatId ? buildTrackingWindows({activeEvents, chatId, worldModel, currentStoryTime, floorVersion, subjectProfiles, timingInstances, participantAggregations, lifecycleReleaseRecords, persistedWindows, onDiagnostics: value => { windowDiagnostics = value; }}) : null);
    const windowBuildMs = shouldBuildWindows ? durationMs(windowStartedAt) : 0;
    const registry = rebuildTrackingRegistry(activeEvents, {
      world_model: worldModel,
      trackingWindows: resolvedWindows,
    });
    if (resolvedWindows) Object.defineProperty(registry, 'tracking_windows', {enumerable: false, get: () => resolvedWindows});
    notify?.({
      type: 'BIOWEAVE_PERSISTENCE_TRACE',
      payload: {
        stage: 'TRACKING_REGISTRY_BUILD_PHASES',
        domain: 'tracking',
        input_event_count: inputEventCount,
        unique_event_count: uniqueEventCount,
        window_build_count: shouldBuildWindows ? 1 : 0,
        window_build_ms: Number(windowBuildMs.toFixed(3)),
        registry_rebuild_ms: Number(Math.max(0, durationMs(buildStartedAt) - windowBuildMs).toFixed(3)),
        ...(windowDiagnostics ?? {}),
      },
      chatId: chatId ?? null,
    });
    return registry;
  }

  function refreshTrackingRegistry(reason = "runtime") {
    const refresh = async () => {
      if (!isEnabled()) return {skipped: true, status: "disabled", reason};
      if (!hasMessageCollection()) return null;
      const token = getToken();
      const inputs = await collectTrackingInputs(token);
      const trackingWindows = inputs.trackingWindows ?? buildTrackingWindows({...inputs, activeEvents: inputs.activeEvents, chatId: token.chatId, floorVersion: inputs.floorVersion});
      const registry = buildTrackingRegistry({...inputs, trackingWindows, chatId: token.chatId, floorVersion: inputs.floorVersion});
      assertToken(token);
      notify({
        type: "TRACKING_REGISTRY_REFRESHED",
        payload: {reason, event_count: inputs.activeEvents.length},
        chatId: token.chatId,
      });
      return {
        ...registry,
        tracking_windows: trackingWindows,
        reproductive_source_candidates: deriveReproductiveSourceCandidates({
          trackingWindows,
          events: inputs.activeEvents,
        }),
        character_registry: inputs.characterRegistry,
        active_events: inputs.activeEvents,
      };
    };
    return enqueueRefresh(refresh);
  }

  return {buildTrackingWindows, buildTrackingRegistry, refreshTrackingRegistry};
}
