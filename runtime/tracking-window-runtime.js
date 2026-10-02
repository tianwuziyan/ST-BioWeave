import {
  deriveTrackingWindows,
  evaluateTrackingWindowLifecycles,
} from '../core/tracking-window.js';
import {compareStoryTime} from '../story/time.js';

/**
 * Runtime boundary for the pure Window reducer. Persistence is deliberately
 * injected so this owner can enforce the same Floor/Swipe token checks as the
 * caller without making the domain core depend on storage or the host.
 */
export function createTrackingWindowRuntime({getChatId = () => null, persist = null, getPersisted = null} = {}) {
  function buildTrackingWindows({activeEvents = [], chatId = getChatId(), worldModel = {}, currentStoryTime = null, subjectProfiles = {}, persistedWindows = []} = {}) {
    const previous = new Map((Array.isArray(persistedWindows) ? persistedWindows : []).map(window => [window.tracking_window_id, window]));
    const expired = [...previous.values()].filter(window => window.status === 'expired');
    const derivationEvents = (Array.isArray(activeEvents) ? activeEvents : []).filter(event => {
      if (!event?.pregnancy_relevance?.relevant) return true;
      const subjectId = event.pregnancy_relevance.gestational_subject_ids?.[0];
      const mechanism = event.pregnancy_relevance.reproductive_mechanism?.kind;
      return !expired.some(window => window.subject_id === subjectId
        && window.mechanism_key === String(mechanism ?? '').trim().toLowerCase()
        && compareStoryTime(event.story_time, window.terminal_story_time) !== null
        && compareStoryTime(event.story_time, window.terminal_story_time) <= 0);
    });
    const derived = deriveTrackingWindows(derivationEvents, {chatId});
    const survivingEventIds = new Set((Array.isArray(activeEvents) ? activeEvents : []).map(event => event?.event_id).filter(Boolean));
    const rebuilt = [...expired.filter(window => window.source_event_ids.some(eventId => survivingEventIds.has(eventId))), ...derived].filter((window, index, all) => all.findIndex(item => item.tracking_window_id === window.tracking_window_id) === index).map(window => {
      const stored = previous.get(window.tracking_window_id);
      return stored?.status === 'expired' ? {...window, status: stored.status, terminal_event_id: null, terminal_reason: stored.terminal_reason, terminal_story_time: stored.terminal_story_time, terminal_at_floor_version: stored.terminal_at_floor_version, updated_at: stored.updated_at} : window;
    });
    return evaluateTrackingWindowLifecycles(rebuilt, {worldModel, currentStoryTime, subjectProfiles, subjectProfile: null});
  }

  async function resolveTrackingWindows({activeEvents = [], chatId = getChatId(), worldModel = {}, currentStoryTime = null, subjectProfiles = {}, persistedWindows = null, assertCurrent = null} = {}) {
    let previous = persistedWindows;
    if (previous === null && typeof getPersisted === 'function') previous = await getPersisted({chatId});
    const windows = buildTrackingWindows({activeEvents, chatId, worldModel, currentStoryTime, subjectProfiles, persistedWindows: previous ?? []});
    if (typeof assertCurrent === 'function') await assertCurrent();
    if (typeof persist === 'function') await persist({chatId, windows, assertCurrent});
    if (typeof assertCurrent === 'function') await assertCurrent();
    return windows;
  }

  return {buildTrackingWindows, resolveTrackingWindows};
}
