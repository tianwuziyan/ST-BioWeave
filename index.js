import {createRuntime} from './runtime/events.js';
import {createApp} from './ui/app.js';

const MENU_ENTRY_ID = 'bioweave-extensions-menu-entry';
const MENU_HANDLER_PROPERTY = '__bioweaveMenuHandler';
const MENU_REGISTRATION_PROPERTY = '__bioweaveMenuRegistration';
const activeMenuRegistrations = new WeakMap();

let instance = null;

function removeMenuHandler(entry) {
  const handler = entry?.[MENU_HANDLER_PROPERTY];
  if (!handler) return;
  entry.removeEventListener('click', handler);
  entry.removeEventListener('keydown', handler);
  delete entry[MENU_HANDLER_PROPERTY];
  delete entry[MENU_REGISTRATION_PROPERTY];
}

export function registerExtensionsMenuEntry(app, documentRef = globalThis.document, observerCtor = globalThis.MutationObserver) {
  if (!documentRef) return () => {};

  // 插件重复初始化时，先退休旧 observer；否则后续 DOM 变化会把旧 handler 抢回来。
  activeMenuRegistrations.get(documentRef)?.();

  let observer = null;
  let entry = null;
  let disposed = false;
  const registration = {};

  const attach = () => {
    if (disposed) return true;
    const menu = documentRef.querySelector('#extensionsMenu');
    if (!menu) return false;

    const entries = [...documentRef.querySelectorAll(`#${MENU_ENTRY_ID}`)];
    entry = entries.find(candidate => candidate.parentElement === menu) ?? entries[0] ?? null;
    if (!entry) {
      entry = documentRef.createElement('div');
      entry.id = MENU_ENTRY_ID;
      entry.className = 'bioweave-menu-entry list-group-item flex-container flexGap5';
      entry.setAttribute('role', 'menuitem');
      entry.setAttribute('tabindex', '0');
      entry.innerHTML = '<i class="fa-solid fa-dna extensionsMenuExtensionButton" aria-hidden="true"></i><span>BioWeave</span>';
    }

    for (const duplicate of entries) {
      if (duplicate === entry) continue;
      removeMenuHandler(duplicate);
      duplicate.remove();
    }
    entry.dataset.bioweaveOwned = 'true';
    if (entry.parentElement !== menu) menu.append(entry);

    if (entry[MENU_HANDLER_PROPERTY] && entry[MENU_REGISTRATION_PROPERTY] !== registration) removeMenuHandler(entry);
    if (entry[MENU_HANDLER_PROPERTY]) return true;
    const handler = event => {
      if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
      app.openBioWeave();
    };
    entry.addEventListener('click', handler);
    entry.addEventListener('keydown', handler);
    entry[MENU_HANDLER_PROPERTY] = handler;
    entry[MENU_REGISTRATION_PROPERTY] = registration;
    return true;
  };

  attach();
  const observerRoot = documentRef.body ?? documentRef.documentElement;
  if (observerRoot && typeof observerCtor === 'function') {
    observer = new observerCtor(attach);
    observer.observe(observerRoot, {childList: true, subtree: true});
  }

  const unregister = () => {
    if (disposed) return;
    disposed = true;
    observer?.disconnect();
    observer = null;
    for (const registeredEntry of documentRef.querySelectorAll(`#${MENU_ENTRY_ID}`)) {
      if (registeredEntry[MENU_HANDLER_PROPERTY] && registeredEntry[MENU_REGISTRATION_PROPERTY] !== registration) continue;
      removeMenuHandler(registeredEntry);
      if (registeredEntry.dataset.bioweaveOwned === 'true') registeredEntry.remove();
    }
    entry = null;
    if (activeMenuRegistrations.get(documentRef) === unregister) activeMenuRegistrations.delete(documentRef);
  };
  activeMenuRegistrations.set(documentRef, unregister);
  return unregister;
}

export async function init() {
  if (instance) return instance;

  const runtime = createRuntime();
  if (!await runtime.init()) return null;

  const app = createApp(runtime);
  app.mountBioWeave();
  const unregisterMenu = registerExtensionsMenuEntry(app);
  instance = {
    runtime,
    app,
    destroy() {
      unregisterMenu();
      app.destroyBioWeave();
      runtime.destroy();
      if (instance?.runtime === runtime) instance = null;
    },
  };
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
