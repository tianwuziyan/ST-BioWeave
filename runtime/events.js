import {createChatBoundary} from './chat.js';
import {createStore, hasSwipeStructure} from '../storage/store.js';

const LIFECYCLE_EVENTS = [
  'CHAT_CHANGED',
  'MESSAGE_UPDATED',
  'MESSAGE_EDITED',
  'MESSAGE_DELETED',
  'MESSAGE_SWIPED',
  'MESSAGE_SWIPE_DELETED',
  'MESSAGE_RECEIVED',
  'GENERATION_ENDED',
];

export function createSillyTavernAdapter() {
  const getContext = () => globalThis.SillyTavern?.getContext?.() ?? null;

  return {
    getContext,
    getExtensionSettings: () => getContext()?.extensionSettings ?? null,
    getGlobalSettings: () => getContext()?.extensionSettings?.bioweave ?? null,
    getRequestHeaders: () => getContext()?.getRequestHeaders?.() ?? {},
    fetch: (...args) => globalThis.fetch(...args),
    async saveGlobalSettings(value) {
      const context = getContext();
      if (!context?.extensionSettings || typeof context.saveSettingsDebounced !== 'function') {
        throw new Error('ST_EXTENSION_SETTINGS_UNAVAILABLE');
      }
      const hadPrevious = Object.prototype.hasOwnProperty.call(context.extensionSettings, 'bioweave');
      const previous = context.extensionSettings.bioweave;
      context.extensionSettings.bioweave = value;
      try {
        await context.saveSettingsDebounced();
      } catch (error) {
        if (hadPrevious) context.extensionSettings.bioweave = previous;
        else delete context.extensionSettings.bioweave;
        throw error;
      }
    },
    getChatId: () => getContext()?.chatId ?? null,
    getChatMetadata: () => getContext()?.chatMetadata ?? null,
    getMessage: index => getContext()?.chat?.[index] ?? null,
    async saveChatMetadata(key, value, expectedChatId) {
      const context = getContext();
      if (expectedChatId !== undefined && context?.chatId !== expectedChatId) {
        throw new Error('STALE_CHAT');
      }
      if (!context?.chatMetadata || typeof context.saveMetadata !== 'function') {
        throw new Error('ST_METADATA_UNAVAILABLE');
      }
      context.chatMetadata[key] = value;
      await context.saveMetadata();
      if (expectedChatId !== undefined && getContext()?.chatId !== expectedChatId) {
        throw new Error('STALE_CHAT');
      }
    },
    async saveFloorBioWeave(messageIndex, swipeId, value, expectedChatId) {
      const context = getContext();
      if (expectedChatId !== undefined && context?.chatId !== expectedChatId) {
        throw new Error('STALE_CHAT');
      }
      const message = context?.chat?.[messageIndex];
      if (!message) throw new Error('MESSAGE_NOT_FOUND');
      const targetSwipeId = Number.isInteger(swipeId) && swipeId >= 0 ? swipeId : 0;
      if (hasSwipeStructure(message)) {
        if (!Array.isArray(message.swipe_info)) message.swipe_info = [];
        message.swipe_info[targetSwipeId] ??= {};
        message.swipe_info[targetSwipeId].extra ??= {};
        message.swipe_info[targetSwipeId].extra.bioweave = value;
      } else {
        message.extra ??= {};
        message.extra.bioweave = value;
      }
      if (typeof context.saveChat !== 'function') throw new Error('ST_CHAT_STORAGE_UNAVAILABLE');
      await context.saveChat();
      if (expectedChatId !== undefined && getContext()?.chatId !== expectedChatId) {
        throw new Error('STALE_CHAT');
      }
    },
  };
}

export function createRuntime({adapter = createSillyTavernAdapter()} = {}) {
  const st = adapter;
  const chat = createChatBoundary(st);
  const store = createStore(st, chat);
  const subscriptions = new Set();
  const unbind = [];
  let initialized = false;
  let destroyed = false;

  function notify(event) {
    for (const listener of [...subscriptions]) {
      try {
        listener(event);
      } catch (error) {
        console.error('[BioWeave] runtime subscriber failed', error);
      }
    }
  }

  function handleLifecycleEvent(key, eventType, payload) {
    const epochBefore = chat.getEpoch();
    const chatId = chat.current();
    const chatChanged = chat.getEpoch() !== epochBefore;
    if (!chatChanged) chat.invalidate(key, {checkCurrent: false});
    notify({
      type: key,
      eventType,
      payload,
      chatId,
      epoch: chat.getEpoch(),
      chatChanged,
    });
  }

  function bindLifecycleEvents() {
    const context = st.getContext?.();
    const source = context?.eventSource;
    const types = context?.eventTypes;
    if (!source || typeof source.on !== 'function' || typeof source.removeListener !== 'function') {
      return;
    }
    const boundEventTypes = new Set();
    for (const key of LIFECYCLE_EVENTS) {
      const eventType = types?.[key];
      if (eventType == null || boundEventTypes.has(eventType)) continue;
      const listener = payload => handleLifecycleEvent(key, eventType, payload);
      source.on(eventType, listener);
      boundEventTypes.add(eventType);
      unbind.push(() => source.removeListener(eventType, listener));
    }
  }

  async function init() {
    if (destroyed) return false;
    if (initialized) return true;
    const context = st.getContext?.();
    if (typeof st.getContext === 'function' && !context) {
      console.error('[BioWeave] SillyTavern context unavailable');
      return false;
    }
    chat.current();
    bindLifecycleEvents();
    initialized = true;
    return true;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('RUNTIME_LISTENER_REQUIRED');
    subscriptions.add(listener);
    return () => subscriptions.delete(listener);
  }

  function destroy() {
    if (destroyed) return;
    while (unbind.length) unbind.pop()();
    subscriptions.clear();
    chat.destroy();
    destroyed = true;
    initialized = false;
  }

  return {st, chat, store, init, subscribe, destroy};
}
