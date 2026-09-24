function sameOwner(pending, target, chatId) {
  if (!pending || !target || pending.chatId !== chatId) return false;
  if (pending.messageId != null &&
      String(pending.messageId) !== String(target.version.message_id)) return false;
  if (pending.swipeId != null &&
      String(pending.swipeId) !== String(target.version.swipe_id)) return false;
  return true;
}

export function createGenerationLifecycle({
  getChatId,
  baselineVersionForPayload,
  resolveEndedTarget,
  resolveExistingSwipe,
  isReusableFloor,
  isTargetNew,
  floorExecutionKey,
  rememberObservedKey,
  emitTrace,
  getCurrentExecutionId,
  onGenerationSettled,
} = {}) {
  const state = {
    pendingGeneration: null,
    pendingSwipeGeneration: null,
    completedGeneration: null,
    completedSwipeGeneration: null,
  };
  let generationIntentSequence = 0;

  function generationKind(pending) {
    return pending === state.pendingSwipeGeneration ? "swipe" : "generation";
  }

  function trace(stage, pending, target = null, details = {}) {
    emitTrace?.(stage, pending, target, details);
  }

  function pendingMatchesTarget(pending, target) {
    return sameOwner(pending, target, getChatId?.());
  }

  function pendingIsNewFloor(pending, target) {
    if (!pending || !target || pending.chatId !== target.chatId) return false;
    if (pending.messageId != null &&
        String(pending.messageId) !== String(target.version.message_id)) return false;
    if (pending.swipeId != null &&
        String(pending.swipeId) !== String(target.version.swipe_id)) return false;
    if (pending.baselineVersion &&
        !isTargetNew?.(pending.baselineVersion, target.version)) return false;
    return true;
  }

  function markCompleted(kind, pending, target = null) {
    if (!pending) return;
    const marker = {
      ...pending,
      floorVersion: target?.version ? { ...target.version } : null,
    };
    if (kind === "swipe") state.completedSwipeGeneration = marker;
    else state.completedGeneration = marker;
  }

  function clearCompleted() {
    state.completedGeneration = null;
    state.completedSwipeGeneration = null;
  }

  function clearPending(payload = null, currentEntry = null) {
    const messageId = typeof payload === "object"
      ? payload?.message_id ?? payload?.messageId
      : payload;
    const swipeId = typeof payload === "object"
      ? payload?.swipe_id ?? payload?.swipeId
      : null;
    const matches = pending =>
      pending &&
      pending.chatId === getChatId?.() &&
      (messageId == null || pending.messageId == null ||
        String(messageId) === String(pending.messageId)) &&
      (swipeId == null || pending.swipeId == null ||
        String(swipeId) === String(pending.swipeId));
    for (const key of ["pendingGeneration", "pendingSwipeGeneration"]) {
      const pending = state[key];
      if (!matches(pending)) continue;
      if (pending.baselineVersion)
        rememberObservedKey?.(floorExecutionKey(pending.baselineVersion));
      if (currentEntry?.content_hash != null && currentEntry?.message_version != null)
        rememberObservedKey?.(floorExecutionKey({
          chat_id: getChatId?.(),
          message_id: currentEntry.message_id,
          floor: currentEntry.floor,
          swipe_id: currentEntry.swipe_id ?? 0,
          content_hash: currentEntry.content_hash,
          message_version: currentEntry.message_version,
        }));
      state[key] = null;
    }
  }

  async function settle(pending, target) {
    if (!pending || !target)
      return {skipped: true, reason: "generation-awaiting-target"};
    const kind = generationKind(pending);
    if (!pending.finalFloorSeen) {
      pending.finalFloorSeen = true;
      pending.finalFloorVersion = { ...target.version };
      pending.finalFloorIndex = target.index;
      trace("GENERATION_FINAL_FLOOR_SEEN", pending, target);
    }
    if (!pending.ended) {
      trace("GENERATION_SETTLE_WAITING", pending, target, {
        waiting_for: "generation-ended",
      });
      return {skipped: true, reason: "generation-awaiting-end"};
    }
    if (pending.settled)
      return {skipped: true, reason: "generation-already-settled"};
    pending.settled = true;
    trace("GENERATION_SETTLED", pending, target);
    const force = pending.force === true;
    const isNewFloor = pendingIsNewFloor(pending, target);
    state.pendingGeneration = null;
    state.pendingSwipeGeneration = null;
    markCompleted(kind, pending, target);
    if (force && !isNewFloor) {
      rememberObservedKey?.(floorExecutionKey(target.version));
      return {skipped: true, reason: "generation-without-new-floor"};
    }
    return onGenerationSettled?.(target, {
      force,
      reason: force ? "reroll" : "automatic",
      generation: pending,
    });
  }

  function onGenerationStarted(payload) {
    const hasSignal = typeof payload === "string" ||
      (payload && typeof payload === "object" &&
        (payload.genType != null || payload.generation_type != null ||
          payload.type != null || payload.reroll === true ||
          payload.regenerate === true || payload.new_swipe === true ||
          payload.isNewSwipe === true));
    if (!hasSignal)
      return {skipped: true, reason: "generation-type-unavailable"};
    const generationType = typeof payload === "object"
      ? payload?.genType ?? payload?.generation_type ?? payload?.type
      : payload;
    const normalizedType = String(generationType ?? "").toLowerCase();
    const isReroll = payload?.reroll === true ||
      payload?.regenerate === true || normalizedType === "regenerate";
    const isSwipeGeneration = normalizedType === "swipe";
    const generationTypeName = isSwipeGeneration
      ? "swipe"
      : isReroll ? "regenerate" : "normal";
    const previousPending = state.pendingSwipeGeneration ?? state.pendingGeneration;
    const payloadMessageId = typeof payload === "object"
      ? payload?.message_id ?? payload?.messageId ?? null
      : null;
    const payloadSwipeId = typeof payload === "object"
      ? payload?.swipe_id ?? payload?.swipeId ?? null
      : null;
    const ownerChanged = previousPending
      ? (payloadMessageId != null && previousPending.messageId != null
          ? String(payloadMessageId) !== String(previousPending.messageId)
          : payloadSwipeId != null && previousPending.swipeId != null
            ? String(payloadSwipeId) !== String(previousPending.swipeId)
            : null)
      : null;
    trace("GENERATION_SOURCE_OBSERVED", previousPending, null, {
      generation_id: typeof payload === "object"
        ? payload?.generation_id ?? payload?.generationId ?? payload?.request_id ?? null
        : null,
      generation_type: generationTypeName,
      generation_source: typeof payload === "object"
        ? payload?.source ?? payload?.generation_source ?? payload?.reason ?? "unknown"
        : "unknown",
      current_execution_id: getCurrentExecutionId?.() ?? null,
      target_message_id: payloadMessageId,
      target_swipe_id: payloadSwipeId,
      owner_changed: ownerChanged,
      supersede_decision: previousPending ? "pending_intent_reviewed" : "none",
      supersede_reason: previousPending
        ? ownerChanged === true ? "target_owner_changed" : "target_owner_not_proven_changed"
        : "no_pending_intent",
    });
    if (!isReroll && !isSwipeGeneration &&
        (state.pendingGeneration || state.pendingSwipeGeneration))
      return {skipped: true, reason: "generation-intent-already-pending"};
    const kind = isSwipeGeneration ? "swipe" : "generation";
    if (previousPending) {
      previousPending.superseded = true;
      trace("GENERATION_INTENT_SUPERSEDED", previousPending, null, {
        superseded_by_generation_type: kind,
      });
    }
    state.pendingGeneration = null;
    state.pendingSwipeGeneration = null;
    clearCompleted();
    const pending = {
      chatId: getChatId?.(),
      messageId: typeof payload === "object"
        ? payload?.message_id ?? payload?.messageId
        : null,
      swipeId: typeof payload === "object"
        ? payload?.swipe_id ?? payload?.swipeId
        : null,
      baselineVersion: baselineVersionForPayload?.(payload) ?? null,
      generation_id: typeof payload === "object"
        ? payload?.generation_id ?? payload?.generationId ?? payload?.request_id ?? null
        : null,
      generation_type: generationTypeName,
      force: isReroll || isSwipeGeneration,
      ended: false,
      finalFloorSeen: false,
      settled: false,
      intent_id: `generation-${++generationIntentSequence}`,
    };
    if (isSwipeGeneration) state.pendingSwipeGeneration = pending;
    else state.pendingGeneration = pending;
    trace("GENERATION_INTENT_CREATED", pending);
    return {skipped: true, reason: "generation-pending"};
  }

  async function onGenerationEnded() {
    const pending = state.pendingSwipeGeneration ?? state.pendingGeneration;
    if (!pending) return {skipped: true, reason: "generation-ended-without-intent"};
    if (!pending.ended) {
      pending.ended = true;
      trace("GENERATION_END_SEEN", pending);
    }
    if (pending.finalFloorSeen && Number.isInteger(pending.finalFloorIndex)) {
      try {
        const target = await resolveEndedTarget?.(pending.finalFloorIndex);
        return settle(pending, target);
      } catch {
        // The next Character render resolves the owner again and fails closed.
      }
    }
    return {skipped: true, reason: "generation-ended-awaiting-render"};
  }

  async function onCharacterMessageRendered(target) {
    const pending = [state.pendingGeneration, state.pendingSwipeGeneration]
      .find(item => pendingMatchesTarget(item, target));
    const completed = [state.completedGeneration, state.completedSwipeGeneration]
      .find(item => sameOwner(item, target, getChatId?.()));
    if (completed) {
      rememberObservedKey?.(floorExecutionKey(target.version));
      return {skipped: true, reason: "generation-already-consumed"};
    }
    if (pending) return settle(pending, target);
    return null;
  }

  async function onSwipe(payload, previousLifecycleEntry) {
    const pendingGeneration = typeof payload === "object" && (
      payload?.pendingGeneration === true ||
      payload?.pending_generation === true ||
      payload?.isNewSwipe === true ||
      payload?.new_swipe === true
    );
    if (!pendingGeneration) {
      try {
        const existing = await resolveExistingSwipe?.(payload);
        rememberObservedKey?.(floorExecutionKey(existing.version));
        if (isReusableFloor?.(existing.index, existing.swipeId, existing.version))
          return {skipped: true, reason: "existing-swipe-reused"};
        return {skipped: true, reason: "existing-swipe-unavailable"};
      } catch (error) {
        if (error?.message === "SWIPE_NOT_FOUND")
          return {skipped: true, reason: "swipe-not-found"};
        throw error;
      }
    }
    const previousPending = state.pendingSwipeGeneration;
    if (previousPending) {
      previousPending.superseded = true;
      trace("GENERATION_INTENT_SUPERSEDED", previousPending);
    }
    const pending = {
      chatId: getChatId?.(),
      messageId: typeof payload === "object"
        ? payload?.message_id ?? payload?.messageId
        : payload,
      swipeId: typeof payload === "object"
        ? payload?.swipe_id ?? payload?.swipeId
        : null,
      baselineVersion: previousLifecycleEntry
        ? {
            chat_id: getChatId?.(),
            message_id: previousLifecycleEntry.message_id,
            floor: previousLifecycleEntry.floor,
            swipe_id: previousLifecycleEntry.swipe_id ?? 0,
            content_hash: previousLifecycleEntry.content_hash,
            message_version: previousLifecycleEntry.message_version,
          }
        : null,
      ended: false,
      finalFloorSeen: false,
      settled: false,
      force: true,
      generation_type: "swipe",
      intent_id: `generation-${++generationIntentSequence}`,
    };
    state.pendingSwipeGeneration = pending;
    trace("GENERATION_INTENT_CREATED", pending);
    return {skipped: true, reason: "swipe-generation-pending"};
  }

  function getState() {
    return {
      pendingGeneration: state.pendingGeneration ? { ...state.pendingGeneration } : null,
      pendingSwipeGeneration: state.pendingSwipeGeneration ? { ...state.pendingSwipeGeneration } : null,
      completedGeneration: state.completedGeneration ? { ...state.completedGeneration } : null,
      completedSwipeGeneration: state.completedSwipeGeneration ? { ...state.completedSwipeGeneration } : null,
    };
  }

  function clear() {
    state.pendingGeneration = null;
    state.pendingSwipeGeneration = null;
    clearCompleted();
  }

  function destroy() {
    clear();
  }

  return {
    onGenerationStarted,
    onGenerationEnded,
    onCharacterMessageRendered,
    onSwipe,
    onGenerationStopped(payload, currentEntry) {
      const pending = state.pendingSwipeGeneration ?? state.pendingGeneration;
      if (pending) markCompleted(generationKind(pending), pending);
      clearPending(payload, currentEntry);
      return {skipped: true, reason: "generation-not-rendered"};
    },
    getState,
    clear,
    destroy,
  };
}
