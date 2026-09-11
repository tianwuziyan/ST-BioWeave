import {createChatBoundary} from './chat.js';
import {activeSwipeId, createStore, hasSwipeStructure} from '../storage/store.js';
import {floorVersion, floorVersionFromData} from './floor.js';
import {rebuildTrackingRegistry} from '../core/tracking.js';

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
    getChat: () => getContext()?.chat ?? null,
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
        message.swipe_info ??= [];
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
  let registryRefreshSequence = 0;

  function scalarMessageValue(value) {
    if (typeof value === 'string') return value.trim() || null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    return null;
  }

  function messageText(message) {
    if (typeof message === 'string' || typeof message === 'number') return String(message);
    if (!message || typeof message !== 'object') return '';
    const partText = value => {
      if (typeof value === 'string' || typeof value === 'number') return String(value);
      if (!value || typeof value !== 'object') return '';
      return String(value.mes ?? value.content ?? value.message ?? value.text ?? '');
    };
    const swipeId = activeSwipeId(message);
    if (message.swipes && typeof message.swipes === 'object' && message.swipes[swipeId] !== undefined) {
      return partText(message.swipes[swipeId]);
    }
    return partText(message.mes ?? message.content ?? message.message);
  }

  function messageFloor(message, index, storedVersion) {
    const candidates = [message?.floor, message?.floor_id, message?.floorIndex, storedVersion?.floor, index];
    for (const candidate of candidates) {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) return Math.round(parsed);
    }
    return index;
  }

  function messageId(message, index, storedVersion) {
    const candidates = [
      message?.message_id,
      message?.messageId,
      message?.id,
      storedVersion?.message_id,
      index,
    ];
    for (const candidate of candidates) {
      const value = scalarMessageValue(candidate);
      if (value !== null) return value;
    }
    return index;
  }

  function messageVersion(message, storedVersion) {
    return scalarMessageValue(
      message?.message_version
      ?? message?.messageVersion
      ?? message?.version
      ?? storedVersion?.message_version,
    ) ?? undefined;
  }

  async function currentMessageFloorVersion(chatId, message, index, floorData) {
    const storedVersion = floorVersionFromData(floorData);
    return floorVersion({
      chatId,
      messageId: messageId(message, index, storedVersion),
      floor: messageFloor(message, index, storedVersion),
      swipeId: activeSwipeId(message),
      text: messageText(message),
      messageVersion: messageVersion(message, storedVersion),
    });
  }

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
    void refreshTrackingRegistry(key).catch(error => {
      if (error?.message !== 'STALE_CHAT') {
        console.error('[BioWeave] tracking registry refresh failed', error);
      }
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
    void refreshTrackingRegistry('init').catch(error => {
      if (error?.message !== 'STALE_CHAT') {
        console.error('[BioWeave] initial tracking registry refresh failed', error);
      }
    });
    return true;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('RUNTIME_LISTENER_REQUIRED');
    subscriptions.add(listener);
    return () => subscriptions.delete(listener);
  }

  async function refreshTrackingRegistry(reason = 'lifecycle') {
    const requestId = ++registryRefreshSequence;
    const token = chat.token();
    const context = st.getContext?.();
    const messages = st.getChat?.() ?? context?.chat;
    if (!Array.isArray(messages)) return null;

    const activeEvents = [];
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      const floorData = store.getActiveFloor?.(index);
      if (!floorData) continue;
      const version = await currentMessageFloorVersion(token.chatId, message, index, floorData);
      chat.assert(token);
      if (requestId !== registryRefreshSequence) return null;
      activeEvents.push(...(store.getActiveFloorEvents?.(index, version) ?? []));
    }

    chat.assert(token);
    if (requestId !== registryRefreshSequence) return null;
    const previousChat = store.getChat(token.chatId);
    const registry = rebuildTrackingRegistry(activeEvents, previousChat);
    chat.assert(token);
    if (requestId !== registryRefreshSequence) return null;
    await store.saveChat(token.chatId, {...previousChat, ...registry});
    chat.assert(token);
    if (requestId !== registryRefreshSequence) return null;
    notify({
      type: 'TRACKING_REGISTRY_REFRESHED',
      eventType: null,
      payload: {reason, event_count: activeEvents.length},
      chatId: token.chatId,
      epoch: chat.getEpoch(),
      chatChanged: false,
    });
    return registry;
  }

  // These reads deliberately stay synchronous and side-effect free.  The UI
  // can ask for the current message/swipe facts after a lifecycle notification
  // without turning mount/open/reopen into an analysis request.
  function getActiveSwipeId(messageId) {
    return store.getActiveSwipeId?.(messageId) ?? null;
  }

  function getActiveFloor(messageId) {
    return store.getActiveFloor?.(messageId) ?? null;
  }

  function getActiveFloorEvents(messageId, version) {
    return store.getActiveFloorEvents?.(messageId, version) ?? [];
  }

  function destroy() {
    if (destroyed) return;
    registryRefreshSequence += 1;
    while (unbind.length) unbind.pop()();
    subscriptions.clear();
    chat.destroy();
    destroyed = true;
    initialized = false;
  }

  return {
    st,
    chat,
    store,
    init,
    subscribe,
    refreshTrackingRegistry,
    getActiveSwipeId,
    getActiveFloor,
    getActiveFloorEvents,
    destroy,
  };
}
