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
  let anonymousSequence = 0;
  const listeners = new Set();
  let lastResult = null;
  let lastError = null;

  function getActivityState() {
    return {
      busy: activeTasks.size > 0,
      active_tasks: [...activeTasks.values()].map(task => task.kind),
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

  function identityKey(identity) {
    if (!identity || typeof identity !== 'object') return null;
    const floor = identity.floor_version ?? identity.floorVersion ?? null;
    const fields = {
      chat_id: identity.chat_id ?? identity.chatId ?? null,
      floor_version: floor,
      attempt: identity.attempt ?? null,
      domain: identity.domain ?? 'event_analysis',
    };
    if (!fields.chat_id || !fields.floor_version || fields.attempt == null)
      return null;
    return JSON.stringify(fields);
  }

  function startActivity(kind, identity = null) {
    const normalized = normalizeKind(kind);
    if (!normalized) return false;
    const key = identityKey({ ...identity, domain: identity?.domain ?? normalized })
      ?? `${normalized}:anonymous:${++anonymousSequence}`;
    if (activeTasks.has(key)) return false;
    activeTasks.set(key, {kind: normalized, identity: identity ?? null});
    lastResult = null;
    lastError = null;
    notify();
    return true;
  }

  function finishActivity(kind, result = 'success', error = null, identity = null) {
    const normalized = normalizeKind(kind);
    if (!normalized) return false;
    const key = identityKey({ ...identity, domain: identity?.domain ?? normalized });
    const matchKey = key
      ? (activeTasks.has(key) ? key : null)
      : [...activeTasks.entries()].find(([, task]) => task.kind === normalized)?.[0];
    if (matchKey == null) return false;
    activeTasks.delete(matchKey);
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
    const identity = {
      chat_id: event.chatId ?? event.payload?.chat_id,
      floor_version: event.payload?.floor_version,
      attempt: event.payload?.attempt,
      domain: 'event_analysis',
    };
    if (state === 'running') return startActivity('event_analysis', identity);
    if (state === 'cancelled') return finishActivity('event_analysis', 'cancelled', null, identity);
    if (state === 'success') return finishActivity('event_analysis', 'success', null, identity);
    if (state === 'failed' || state === 'disabled') return finishActivity('event_analysis', 'error', event.payload, identity);
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
