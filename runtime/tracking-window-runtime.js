import {
  deriveTrackingWindows,
  evaluateTrackingWindowLifecycles,
} from '../core/tracking-window.js';

/**
 * Runtime boundary for the pure Window reducer. Persistence is deliberately
 * injected so this owner can enforce the same Floor/Swipe token checks as the
 * caller without making the domain core depend on storage or the host.
 */
export function createTrackingWindowRuntime({getChatId = () => null, persist = null, getPersisted = null} = {}) {
  function buildTrackingWindows({activeEvents = [], chatId = getChatId(), worldModel = {}, currentStoryTime = null, floorVersion = null, subjectProfiles = {}, persistedWindows = []} = {}) {
    const derived = deriveTrackingWindows(Array.isArray(activeEvents) ? activeEvents : [], {
      chatId,
      worldModel,
      subjectProfiles,
      currentStoryTime,
    });
    return evaluateTrackingWindowLifecycles(derived, {
      worldModel,
      currentStoryTime,
      floorVersion,
      subjectProfiles,
      subjectProfile: null,
    });
  }

  async function resolveTrackingWindows({activeEvents = [], chatId = getChatId(), worldModel = {}, currentStoryTime = null, floorVersion = null, subjectProfiles = {}, persistedWindows = null, assertCurrent = null} = {}) {
    // The current complete Event state is authoritative. Keep the injected
    // reader in the public constructor for older hosts, but do not read or
    // apply historical expired Windows during the deterministic calculation.
    void getPersisted;
    void persistedWindows;
    const windows = buildTrackingWindows({activeEvents, chatId, worldModel, currentStoryTime, floorVersion, subjectProfiles});
    if (typeof assertCurrent === 'function') await assertCurrent();
    if (typeof persist === 'function') await persist({chatId, windows, assertCurrent});
    if (typeof assertCurrent === 'function') await assertCurrent();
    return windows;
  }

  return {buildTrackingWindows, resolveTrackingWindows};
}
