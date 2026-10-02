import { deriveTrackingWindows } from '../core/tracking-window.js';

/**
 * Runtime boundary for the pure Window reducer. Persistence is deliberately
 * injected so this owner can enforce the same Floor/Swipe token checks as the
 * caller without making the domain core depend on storage or the host.
 */
export function createTrackingWindowRuntime({getChatId = () => null, persist = null} = {}) {
  function buildTrackingWindows({activeEvents = [], chatId = getChatId()} = {}) {
    return deriveTrackingWindows(activeEvents, {chatId});
  }

  async function resolveTrackingWindows({activeEvents = [], chatId = getChatId(), assertCurrent = null} = {}) {
    const windows = buildTrackingWindows({activeEvents, chatId});
    if (typeof assertCurrent === 'function') await assertCurrent();
    if (typeof persist === 'function') await persist({chatId, windows, assertCurrent});
    if (typeof assertCurrent === 'function') await assertCurrent();
    return windows;
  }

  return {buildTrackingWindows, resolveTrackingWindows};
}
