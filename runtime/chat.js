const STALE_CHAT = 'STALE_CHAT';

function notify(listeners, payload) {
  for (const listener of [...listeners]) {
    try {
      listener(payload);
    } catch (error) {
      console.error('[BioWeave] chat boundary subscriber failed', error);
    }
  }
}

export function createChatBoundary(adapter) {
  if (typeof adapter?.getChatId !== 'function') {
    throw new TypeError('CHAT_ADAPTER_REQUIRED');
  }

  let activeChatId;
  let hasActiveChat = false;
  let epoch = 0;
  let destroyed = false;
  const listeners = new Set();

  function current() {
    if (destroyed) return activeChatId;
    const nextChatId = adapter.getChatId();
    if (!hasActiveChat || nextChatId !== activeChatId) {
      const previousChatId = activeChatId;
      activeChatId = nextChatId;
      hasActiveChat = true;
      epoch += 1;
      notify(listeners, {
        chatId: activeChatId,
        previousChatId,
        epoch,
        changed: true,
      });
    }
    return activeChatId;
  }

  function token() {
    return {chatId: current(), epoch};
  }

  function assert(tokenValue) {
    const chatId = current();
    if (!tokenValue || tokenValue.chatId !== chatId || tokenValue.epoch !== epoch) {
      throw new Error(STALE_CHAT);
    }
    return true;
  }

  function invalidate(reason = 'lifecycle', {checkCurrent = true} = {}) {
    if (checkCurrent) current();
    epoch += 1;
    notify(listeners, {
      chatId: activeChatId,
      epoch,
      invalidated: true,
      reason,
    });
    return epoch;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('CHAT_LISTENER_REQUIRED');
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function destroy() {
    destroyed = true;
    listeners.clear();
    epoch += 1;
  }

  return {
    current,
    token,
    assert,
    invalidate,
    subscribe,
    getEpoch: () => epoch,
    isCurrent: tokenValue => {
      try {
        assert(tokenValue);
        return true;
      } catch {
        return false;
      }
    },
    destroy,
  };
}

export {STALE_CHAT};
