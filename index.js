import {createRuntime} from './runtime/events.js';
import {createApp} from './ui/app.js';
import {registerHostEntry} from './host-entry.js';

let instance = null;

export async function init({
  runtimeFactory = createRuntime,
  appFactory = createApp,
  documentRef = globalThis.document,
  observerCtor = globalThis.MutationObserver,
} = {}) {
  if (instance) return instance;

  const runtime = runtimeFactory();
  const app = appFactory(runtime);
  app.mountBioWeave();
  const unregisterMenu = registerHostEntry(() => app.openBioWeave(), documentRef, observerCtor);
  const nextInstance = {
    runtime,
    app,
    destroy() {
      unregisterMenu();
      app.destroyBioWeave();
      runtime.destroy();
      if (instance?.runtime === runtime) instance = null;
    },
  };
  instance = nextInstance;

  try {
    const initialized = await runtime.init();
    if (!initialized) console.warn('[BioWeave] Runtime initialization did not complete');
  } catch (error) {
    console.error('[BioWeave] Runtime initialization failed', error);
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
