import {createRuntime} from './runtime/events.js';
import {createApp, notify} from './ui/app.js';
import {registerHostEntry} from './host-entry.js';
import {registerFloatingLauncher} from './floating-launcher.js';
import {createDeviceLocalPreferences} from './core/device-local-preferences.js';
import {hasCharacterId, isCanonicalCharacterId} from './core/identity.js';

let instance = null;

async function assertKnownCanonicalCharacter(runtime, characterId) {
  if (!isCanonicalCharacterId(characterId)) throw new TypeError('CANONICAL_CHARACTER_ID_REQUIRED');
  const registry = await runtime.getTrackingRegistry?.();
  if (!hasCharacterId(registry?.character_registry, characterId)) throw new Error('UNKNOWN_CHARACTER_ID');
}

function assertCurrentChatFixtureArgs(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new TypeError('CHARACTER_TIMING_ARGS_REQUIRED');
  if (args.chatId !== undefined && args.chatId !== null) throw new TypeError('DEBUG_TIMING_CHAT_OVERRIDE_NOT_ALLOWED');
}

/**
 * Build the intentionally narrow diagnostic/fixture surface.
 * Reads are non-mutating; config writes still use the official current-Chat
 * service and are never generic storage, Floor, World, or Timing writes.
 */
export function createDebugHandle(runtime) {
  return Object.freeze({
    getProjectionTimingDebug: () => runtime.getProjectionTimingDebug?.(),
    getCharacterTimingConfig: (...args) => runtime.getCharacterTimingConfig?.(...args),
    saveCharacterTimingConfig: async ({characterId, config, ...args} = {}) => {
      assertCurrentChatFixtureArgs({characterId, config, ...args});
      await assertKnownCanonicalCharacter(runtime, characterId);
      return runtime.saveCharacterTimingConfig?.({characterId, config});
    },
    resetCharacterTimingConfig: async ({characterId, ...args} = {}) => {
      assertCurrentChatFixtureArgs({characterId, ...args});
      await assertKnownCanonicalCharacter(runtime, characterId);
      return runtime.resetCharacterTimingConfig?.({characterId});
    },
  });
}

export async function init({
  runtimeFactory = createRuntime,
  appFactory = createApp,
  documentRef = globalThis.document,
  observerCtor = globalThis.MutationObserver,
  storageRef,
} = {}) {
  if (instance) return instance;

  const runtime = runtimeFactory();
  const windowRef = documentRef?.defaultView ?? globalThis;
  const preferences = createDeviceLocalPreferences({documentRef, windowRef, storageRef});
  let floatingLauncher = null;
  const app = appFactory(runtime, {
    onUiPreferencesChanged: preferences => floatingLauncher?.updatePreferences?.(preferences),
    documentRef,
    windowRef,
    preferences,
  });
  app.mountBioWeave();
  const unregisterMenu = registerHostEntry(() => app.openBioWeave(), documentRef, observerCtor);
  const profileStore = runtime.store?.profileStore;
  floatingLauncher = registerFloatingLauncher({
    openBioWeave: () => app.openBioWeave(),
    getActivityState: () => runtime.getActivityState?.() ?? {},
    subscribeActivity: listener => runtime.subscribeActivity?.(listener) ?? (() => {}),
    getPreferences: () => profileStore?.getUiPreferences?.() ?? {},
    documentRef,
    windowRef,
    preferences,
  });
  const nextInstance = {
    runtime,
    app,
    floatingLauncher,
    destroy() {
      unregisterMenu();
      floatingLauncher?.destroy?.();
      app.destroyBioWeave();
      runtime.destroy();
      if (instance?.runtime === runtime) instance = null;
    },
  };
  const debugHandle = createDebugHandle(runtime);
  globalThis.__BIOWEAVE_DEBUG__ = debugHandle;
  const destroyInstance = nextInstance.destroy.bind(nextInstance);
  nextInstance.destroy = () => {
    destroyInstance();
    if (globalThis.__BIOWEAVE_DEBUG__ === debugHandle) delete globalThis.__BIOWEAVE_DEBUG__;
  };
  instance = nextInstance;

  try {
    const initialized = await runtime.init();
    if (!initialized) {
      runtime.recordActivityError?.('BIOWEAVE_RUNTIME_INIT_INCOMPLETE');
      console.warn('[BioWeave] Runtime initialization did not complete');
      notify('BioWeave 初始化失败，请重新加载。', 'error', documentRef);
    }
  } catch (error) {
    runtime.recordActivityError?.(error);
    console.error('[BioWeave] Runtime initialization failed', error);
    notify('BioWeave 初始化失败，请重新加载。', 'error', documentRef);
  }
  return instance;
}

export async function onActivate() {
  return init();
}

export function onDisable() {
  instance?.destroy();
}

export function onDelete() {
  instance?.destroy();
}

export function onInstall() {}

export function onUpdate() {}

export function onEnable() {
  return init();
}

export function getInstance() {
  return instance;
}
