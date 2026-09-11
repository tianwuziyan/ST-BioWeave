import {createChatBoundary} from './chat.js';
import {createStore, hasSwipeStructure} from '../storage/store.js';
import {createAnalyzer} from '../ai/analyzer.js';
import {createStoryTime} from '../story/time.js';
import {FOLLOW_DEFAULT_API, SILLYTAVERN_CURRENT_API} from '../storage/schema.js';
import {createEventAnalysisCoordinator} from './event-analysis.js';

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

export function createRuntime({
  adapter = createSillyTavernAdapter(),
  analyzer = null,
  storyTime = null,
  characterContextResolver = null,
} = {}) {
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

  function resolveEventAnalysisProfile() {
    const settings = store.profileStore?.getSettings?.() ?? {};
    const assignment = settings.assignments?.event_analysis ?? null;
    if (assignment === SILLYTAVERN_CURRENT_API) return SILLYTAVERN_CURRENT_API;
    if (assignment === FOLLOW_DEFAULT_API) {
      if (settings.api_source === SILLYTAVERN_CURRENT_API) return SILLYTAVERN_CURRENT_API;
      return settings.default_profile_id
        ? store.profileStore?.getProfile?.(settings.default_profile_id) ?? null
        : null;
    }
    return assignment ? store.profileStore?.getProfile?.(assignment) ?? null : null;
  }

  const eventAnalyzer = analyzer ?? createAnalyzer({
    profileResolver: resolveEventAnalysisProfile,
    contextResolver: () => st.getContext?.() ?? null,
    requestSettingsResolver: () => store.profileStore?.getApiRequestSettings?.() ?? {},
  });
  const eventAnalysis = createEventAnalysisCoordinator({
    st,
    chat,
    store,
    analyzer: eventAnalyzer,
    storyTime: storyTime ?? createStoryTime(),
    ...(typeof characterContextResolver === 'function' ? {characterContextResolver} : {}),
    notify,
  });

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
    void eventAnalysis.handleLifecycleEvent({type: key, eventType, payload, chatId}).catch(error => {
      if (!['STALE_CHAT', 'MESSAGE_NOT_FOUND'].includes(error?.message)) {
        console.error('[BioWeave] event analysis lifecycle failed', error);
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
    void eventAnalysis.refreshTrackingRegistry('init').catch(error => {
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
    eventAnalysis.destroy();
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
    analyzeCurrentFloor: eventAnalysis.analyzeCurrentFloor,
    analyzeFloor: eventAnalysis.analyzeFloor,
    refreshCurrentFloorAnalysis: eventAnalysis.refreshCurrentFloorAnalysis,
    requestAbortCurrentFloorAnalysis: eventAnalysis.requestAbortCurrentFloorAnalysis,
    getCurrentFloorAnalysisStatus: eventAnalysis.getCurrentFloorAnalysisStatus,
    getCurrentFloorEvents: eventAnalysis.getCurrentFloorEvents,
    getTrackingRegistry: eventAnalysis.getTrackingRegistry,
    collectActiveBusinessData: eventAnalysis.collectActiveBusinessData,
    refreshTrackingRegistry: eventAnalysis.refreshTrackingRegistry,
    updateEvent: eventAnalysis.updateEvent,
    deleteEvent: eventAnalysis.deleteEvent,
    getActiveSwipeId,
    getActiveFloor,
    getActiveFloorEvents,
    destroy,
  };
}
