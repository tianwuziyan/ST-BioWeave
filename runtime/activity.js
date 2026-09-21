const ACTIVITY_KINDS = new Set(['event_analysis', 'world_analysis', 'projection_generation']);

function normalizeKind(kind) {
  const value = String(kind ?? '').trim();
  return ACTIVITY_KINDS.has(value) ? value : null;
}

function safeError(error) {
  if (!error) return null;
  const value = error?.safe_error_summary ?? error?.message ?? error?.code ?? error;
  const text = String(value ?? '').trim();
  return text || 'BIOWEAVE_ACTIVITY_FAILED';
}

export function createRuntimeActivity() {
  const activeTasks = new Map();
  const listeners = new Set();
  let lastResult = null;
  let lastError = null;

  function getActivityState() {
    return {
      busy: activeTasks.size > 0,
      active_tasks: [...activeTasks.keys()],
      last_result: lastResult,
      last_error: lastError,
    };
  }

  function notify() {
    const state = getActivityState();
    for (const listener of [...listeners]) {
      try {
        listener(state);
      } catch (error) {
        console.error('[BioWeave] activity subscriber failed', error);
      }
    }
  }

  function startActivity(kind) {
    const normalized = normalizeKind(kind);
    if (!normalized) return false;
    activeTasks.set(normalized, (activeTasks.get(normalized) ?? 0) + 1);
    lastResult = null;
    lastError = null;
    notify();
    return true;
  }

  function finishActivity(kind, result = 'success', error = null) {
    const normalized = normalizeKind(kind);
    if (!normalized) return false;
    const count = activeTasks.get(normalized) ?? 0;
    if (count <= 1) activeTasks.delete(normalized);
    else activeTasks.set(normalized, count - 1);
    if (result === 'error') {
      lastResult = 'error';
      lastError = safeError(error);
    } else if (result === 'success') {
      lastResult = 'success';
      lastError = null;
    }
    notify();
    return true;
  }

  function handleRuntimeEvent(event) {
    if (event?.type !== 'EVENT_ANALYSIS_STATUS_CHANGED') return false;
    const state = event.payload?.state;
    if (state === 'running') return startActivity('event_analysis');
    if (state === 'cancelled') return finishActivity('event_analysis', 'cancelled');
    if (state === 'success') return finishActivity('event_analysis', 'success');
    if (state === 'failed') return finishActivity('event_analysis', 'error', event.payload);
    return false;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('ACTIVITY_LISTENER_REQUIRED');
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function recordError(error) {
    lastResult = 'error';
    lastError = safeError(error);
    notify();
  }

  function destroy() {
    activeTasks.clear();
    listeners.clear();
  }

  return {
    getActivityState,
    subscribe,
    startActivity,
    finishActivity,
    handleRuntimeEvent,
    recordError,
    destroy,
  };
}
