import {createRuntime} from './runtime/events.js';
import {createApp, notify} from './ui/app.js';
import {registerHostEntry} from './host-entry.js';
import {registerFloatingLauncher} from './floating-launcher.js';

let instance = null;

export async function init({
  runtimeFactory = createRuntime,
  appFactory = createApp,
  documentRef = globalThis.document,
  observerCtor = globalThis.MutationObserver,
} = {}) {
  if (instance) return instance;

  const runtime = runtimeFactory();
  let floatingLauncher = null;
  const app = appFactory(runtime, {
    onUiPreferencesChanged: preferences => floatingLauncher?.updatePreferences?.(preferences),
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
