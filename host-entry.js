const MENU_ENTRY_ID = 'bioweave-extensions-menu-entry';
const MENU_HANDLER_PROPERTY = '__bioweaveMenuHandler';
const MENU_REGISTRATION_PROPERTY = '__bioweaveMenuRegistration';
const activeMenuRegistrations = new WeakMap();

function removeMenuHandler(entry) {
  const handler = entry?.[MENU_HANDLER_PROPERTY];
  if (!handler) return;
  entry.removeEventListener('click', handler);
  entry.removeEventListener('keydown', handler);
  delete entry[MENU_HANDLER_PROPERTY];
  delete entry[MENU_REGISTRATION_PROPERTY];
}

export function registerHostEntry(openBioWeave, documentRef = globalThis.document, observerCtor = globalThis.MutationObserver) {
  if (!documentRef || typeof openBioWeave !== 'function') return () => {};

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
      openBioWeave();
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
