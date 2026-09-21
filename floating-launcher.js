export const FLOATING_LAUNCHER_ID = 'bioweave-floating-launcher';
export const FLOATING_LAUNCHER_POSITION_KEY = 'bioweave-floating-launcher-position';
import {DEFAULT_FLOATING_LAUNCHER_THEME, normalizeFloatingLauncherTheme} from './floating-launcher-theme.js';

const DEFAULT_PREFERENCES = Object.freeze({
  show_floating_launcher: true,
  floating_launcher_theme: DEFAULT_FLOATING_LAUNCHER_THEME,
});
const DRAG_THRESHOLD = 5;
const SAFE_MARGIN = 8;
const SUCCESS_FEEDBACK_MS = 1100;
const activeRegistrations = new WeakMap();

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizePreferences(raw = {}) {
  return {
    show_floating_launcher: raw?.show_floating_launcher !== false,
    floating_launcher_theme: normalizeFloatingLauncherTheme(raw?.floating_launcher_theme),
  };
}

function normalizePosition(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const x = finiteNumber(raw.x ?? raw.left);
  const y = finiteNumber(raw.y ?? raw.top);
  return x === null || y === null ? null : {x, y};
}

function readPosition(storageRef) {
  try {
    return normalizePosition(JSON.parse(storageRef?.getItem?.(FLOATING_LAUNCHER_POSITION_KEY) ?? 'null'));
  } catch {
    return null;
  }
}

function writePosition(storageRef, position) {
  try {
    storageRef?.setItem?.(FLOATING_LAUNCHER_POSITION_KEY, JSON.stringify(position));
  } catch {
    // Device-local preferences are best effort and must never block the UI.
  }
}

function viewport(windowRef) {
  const visual = windowRef?.visualViewport;
  const width = finiteNumber(visual?.width) ?? finiteNumber(windowRef?.innerWidth) ?? 0;
  const height = finiteNumber(visual?.height) ?? finiteNumber(windowRef?.innerHeight) ?? 0;
  return {width, height};
}

function activityState(raw) {
  return {
    busy: raw?.busy === true,
    active_tasks: Array.isArray(raw?.active_tasks) ? raw.active_tasks : [],
    last_result: raw?.last_result === 'success' || raw?.last_result === 'error' ? raw.last_result : null,
    last_error: raw?.last_error ? String(raw.last_error) : null,
  };
}

function createFallbackHandle() {
  return {updatePreferences() {}, destroy() {}};
}

export function registerFloatingLauncher({
  openBioWeave,
  getActivityState = () => ({}),
  subscribeActivity = () => () => {},
  getPreferences = () => DEFAULT_PREFERENCES,
  documentRef = globalThis.document,
  windowRef = documentRef?.defaultView ?? globalThis,
  storageRef = windowRef?.localStorage ?? globalThis.localStorage,
} = {}) {
  if (typeof openBioWeave !== 'function') throw new TypeError('FLOATING_LAUNCHER_OPEN_REQUIRED');
  if (!documentRef || !documentRef.body) return createFallbackHandle();
  activeRegistrations.get(documentRef)?.destroy?.();

  let node = null;
  let preferences = DEFAULT_PREFERENCES;
  let activity = activityState({});
  try {
    preferences = normalizePreferences(getPreferences?.());
  } catch {
    preferences = DEFAULT_PREFERENCES;
  }
  try {
    activity = activityState(getActivityState?.());
  } catch {
    activity = activityState({last_result: 'error', last_error: 'BIOWEAVE_ACTIVITY_UNAVAILABLE'});
  }
  let successTimer = null;
  let unsubscribeActivity = null;
  let destroyed = false;
  let dragging = false;
  let dragged = false;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let originalX = 0;
  let originalY = 0;

  function removeListeners() {
    node?.removeEventListener?.('pointerdown', onPointerDown);
    node?.removeEventListener?.('pointermove', onPointerMove);
    node?.removeEventListener?.('pointerup', onPointerUp);
    node?.removeEventListener?.('pointercancel', onPointerCancel);
    node?.removeEventListener?.('click', onClick);
    node?.removeEventListener?.('keydown', onKeydown);
    windowRef?.removeEventListener?.('resize', reclamp);
    windowRef?.visualViewport?.removeEventListener?.('resize', reclamp);
  }

  function clampPosition(x, y) {
    if (!node) return {x: SAFE_MARGIN, y: SAFE_MARGIN};
    const {width, height} = viewport(windowRef);
    const maxX = Math.max(SAFE_MARGIN, width - (node.offsetWidth || 48) - SAFE_MARGIN);
    const maxY = Math.max(SAFE_MARGIN, height - (node.offsetHeight || 48) - SAFE_MARGIN);
    return {
      x: Math.min(Math.max(SAFE_MARGIN, finiteNumber(x) ?? SAFE_MARGIN), maxX),
      y: Math.min(Math.max(SAFE_MARGIN, finiteNumber(y) ?? SAFE_MARGIN), maxY),
    };
  }

  function applyPosition(position, save = false) {
    if (!node) return;
    const clamped = clampPosition(position?.x, position?.y);
    node.style.left = `${clamped.x}px`;
    node.style.top = `${clamped.y}px`;
    node.style.right = 'auto';
    node.style.bottom = 'auto';
    if (save) writePosition(storageRef, clamped);
  }

  function defaultPosition() {
    const {width, height} = viewport(windowRef);
    return {
      x: Math.max(SAFE_MARGIN, width - 56),
      y: Math.max(SAFE_MARGIN, height - 136),
    };
  }

  function setVisualState(nextState) {
    if (!node) return;
    const state = nextState === 'running' || nextState === 'success' || nextState === 'error' ? nextState : 'idle';
    node.dataset.state = state;
    node.classList.toggle('is-running', state === 'running');
    node.classList.toggle('is-success', state === 'success');
    node.classList.toggle('is-error', state === 'error');
    const labels = {
      idle: 'BioWeave',
      running: 'BioWeave 正在分析',
      success: 'BioWeave 分析完成',
      error: 'BioWeave 分析失败',
    };
    const label = labels[state];
    node.title = label;
    node.setAttribute('aria-label', label);
    node.setAttribute('aria-busy', String(state === 'running'));
  }

  function renderActivity(next = activity) {
    activity = activityState(next);
    if (activity.busy) {
      if (successTimer !== null) windowRef?.clearTimeout?.(successTimer);
      successTimer = null;
      setVisualState('running');
      return;
    }
    if (activity.last_result === 'error') {
      if (successTimer !== null) windowRef?.clearTimeout?.(successTimer);
      successTimer = null;
      setVisualState('error');
      return;
    }
    if (activity.last_result === 'success') {
      if (successTimer !== null) windowRef?.clearTimeout?.(successTimer);
      setVisualState('success');
      successTimer = windowRef?.setTimeout?.(() => {
        successTimer = null;
        if (!destroyed && !activity.busy) setVisualState('idle');
      }, SUCCESS_FEEDBACK_MS) ?? null;
      return;
    }
    setVisualState('idle');
  }

  function onPointerDown(event) {
    if (event?.isPrimary === false || event?.button !== undefined && event.button !== 0 || dragging) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    const rect = node.getBoundingClientRect();
    originalX = rect.left;
    originalY = rect.top;
    dragging = false;
    dragged = false;
    node.setPointerCapture?.(pointerId);
    event.preventDefault?.();
  }

  function onPointerMove(event) {
    if (pointerId === null || event.pointerId !== pointerId) return;
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    if (!dragging && Math.hypot(deltaX, deltaY) > DRAG_THRESHOLD) {
      dragging = true;
      dragged = true;
      node.classList.add('is-dragging');
    }
    if (!dragging) return;
    applyPosition({x: originalX + deltaX, y: originalY + deltaY});
    event.preventDefault?.();
  }

  function finishPointer(event, cancelled = false) {
    if (pointerId === null || event?.pointerId !== pointerId) return;
    if (dragging && !cancelled) {
      const rect = node.getBoundingClientRect();
      applyPosition({x: rect.left, y: rect.top}, true);
    }
    node.releasePointerCapture?.(pointerId);
    pointerId = null;
    dragging = false;
    node.classList.remove('is-dragging');
  }

  function onPointerUp(event) {
    finishPointer(event);
  }

  function onPointerCancel(event) {
    finishPointer(event, true);
  }

  function onClick(event) {
    if (dragged) {
      dragged = false;
      event.preventDefault?.();
      return;
    }
    openBioWeave();
  }

  function onKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault?.();
    openBioWeave();
  }

  function reclamp() {
    if (!node) return;
    applyPosition({x: node.getBoundingClientRect().left, y: node.getBoundingClientRect().top}, true);
  }

  function mount() {
    if (destroyed || !preferences.show_floating_launcher || node?.isConnected) return;
    const stale = documentRef.getElementById?.(FLOATING_LAUNCHER_ID);
    stale?.remove?.();
    node = documentRef.createElement('button');
    node.style ??= {};
    node.classList ??= {toggle() {}, add() {}, remove() {}};
    node.id = FLOATING_LAUNCHER_ID;
    node.type = 'button';
    node.className = 'bioweave-floating-launcher';
    node.setAttribute('role', 'button');
    node.tabIndex = 0;
    node.innerHTML = '<svg class="bioweave-floating-launcher-icon" data-bioweave-floating-icon viewBox="0 0 48 48" aria-hidden="true" focusable="false"><circle class="bioweave-floating-launcher-icon-center" cx="24" cy="24" r="6"></circle><path class="bioweave-floating-launcher-icon-arc" d="M 10 27 A 15 15 0 0 1 30 10"></path><path class="bioweave-floating-launcher-icon-arc" d="M 38 21 A 15 15 0 0 1 18 38"></path><circle class="bioweave-floating-launcher-icon-dot" cx="34" cy="14" r="3.5"></circle><circle class="bioweave-floating-launcher-icon-dot" cx="14" cy="34" r="3.5"></circle></svg><span class="bioweave-floating-launcher-status" aria-hidden="true"></span>';
    node.dataset.theme = preferences.floating_launcher_theme;
    documentRef.body.append(node);
    const stored = readPosition(storageRef);
    applyPosition(stored ?? defaultPosition(), false);
    node.addEventListener('pointerdown', onPointerDown);
    node.addEventListener('pointermove', onPointerMove);
    node.addEventListener('pointerup', onPointerUp);
    node.addEventListener('pointercancel', onPointerCancel);
    node.addEventListener('click', onClick);
    node.addEventListener('keydown', onKeydown);
    windowRef?.addEventListener?.('resize', reclamp);
    windowRef?.visualViewport?.addEventListener?.('resize', reclamp);
    renderActivity(activity);
  }

  function unmount() {
    if (!node) return;
    removeListeners();
    if (successTimer !== null) windowRef?.clearTimeout?.(successTimer);
    successTimer = null;
    if (pointerId !== null) node.releasePointerCapture?.(pointerId);
    pointerId = null;
    dragging = false;
    dragged = false;
    node.remove?.();
    node = null;
  }

  function updatePreferences(next) {
    preferences = normalizePreferences({...preferences, ...(next ?? {})});
    if (node) node.dataset.theme = preferences.floating_launcher_theme;
    if (preferences.show_floating_launcher) mount();
    else unmount();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    unsubscribeActivity?.();
    unsubscribeActivity = null;
    unmount();
    if (activeRegistrations.get(documentRef)?.destroy === destroy) activeRegistrations.delete(documentRef);
  }

  try {
    unsubscribeActivity = subscribeActivity?.(renderActivity) ?? null;
  } catch {
    unsubscribeActivity = null;
  }
  mount();
  const handle = {updatePreferences, destroy};
  activeRegistrations.set(documentRef, handle);
  return handle;
}
