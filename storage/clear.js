import { createStore } from './store.js';
import { cloneValue, emptyChat, emptyFloor } from './schema.js';
import {
  assertLifecycleRegistryCoverage,
  CHAT_FIELD_REGISTRY,
  FLOOR_FIELD_REGISTRY,
  getClearableFields,
  getFieldDefinition,
  LIFECYCLE_DOMAINS,
} from './lifecycle.js';

const OWNED_ROOT = 'bioweave';

function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function deepEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right) return false;
  if (left === null || right === null) return false;
  if (typeof left !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left)) {
    if (left.length !== right.length) return false;
    return left.every((value, index) => deepEqual(value, right[index]));
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key) => hasOwn(right, key) && deepEqual(left[key], right[key]),
  );
}

function errorWithCode(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function ownerChatId(owner) {
  const value =
    typeof owner === 'string'
      ? owner
      : owner?.chatId ??
        owner?.chat_id ??
        owner?.owner?.chatId ??
        owner?.owner?.chat_id;
  return typeof value === 'string' ? value.trim() : value ?? null;
}

function normalizeOwner(owner, { source = false } = {}) {
  const raw = owner && typeof owner === 'object' ? owner : {};
  const chatId = ownerChatId(owner);
  return {
    ...cloneValue(raw),
    chatId,
    chat_id: chatId,
    sourceTargeted:
      source ||
      raw.sourceTargeted === true ||
      raw.source_targeted === true ||
      raw.kind === 'source',
  };
}

function normalizeState(state, chatId) {
  const source = state && typeof state === 'object' ? state : {};
  const metadata = source.chatMetadata ?? source.metadata ?? {};
  const messages = source.messages ?? source.chat ?? [];
  if (!isRecord(metadata)) throw errorWithCode('CHAT_METADATA_INVALID');
  if (!Array.isArray(messages)) throw errorWithCode('CHAT_MESSAGES_INVALID');
  const stateChatId = source.chatId ?? source.chat_id ?? chatId;
  if (!stateChatId || String(stateChatId) !== String(chatId)) {
    throw errorWithCode('SOURCE_OWNER_IDENTITY_MISMATCH');
  }
  const root = hasOwn(metadata, OWNED_ROOT)
    ? metadata[OWNED_ROOT]
    : undefined;
  if (root !== undefined && !isRecord(root)) {
    throw errorWithCode('CHAT_ROOT_INVALID');
  }
  return {
    ...source,
    chatId,
    chat_id: chatId,
    revision:
      source.revision ??
      source.sourceRevision ??
      source.source_revision ??
      source.owner?.revision,
    chatMetadata: cloneValue(metadata),
    metadata: cloneValue(metadata),
    messages: cloneValue(messages),
    chat: cloneValue(messages),
    chatRoot: cloneValue(root),
  };
}

function messageIdOf(message, messageIndex) {
  return message?.message_id ?? message?.id ?? messageIndex;
}

function numericSwipeId(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0)
    return value;
  if (typeof value === 'string' && /^\d+$/u.test(value.trim()))
    return Number(value);
  return value;
}

function slotDescriptor({
  message,
  messageIndex,
  messageId,
  swipeId = null,
  value,
  includeEmpty,
}) {
  const isSwipe = swipeId !== null;
  const hasData = value !== undefined;
  if (!includeEmpty && !hasData) return null;
  return {
    slotId: isSwipe
      ? `${messageIndex}:swipe:${String(swipeId)}`
      : `${messageIndex}:message-extra`,
    kind: isSwipe ? 'swipe' : 'message_extra',
    messageIndex,
    messageId,
    swipeId: isSwipe ? numericSwipeId(swipeId) : null,
    path: isSwipe
      ? ['chat', messageIndex, 'swipe_info', String(swipeId), 'extra', OWNED_ROOT]
      : ['chat', messageIndex, 'extra', OWNED_ROOT],
    hasData,
    value: cloneValue(value),
    message: cloneValue(message),
  };
}

/**
 * Enumerate only exact BioWeave owner roots.  This is intentionally not a
 * recursive object walk: a message extra root and each concrete swipe_info
 * root are separate slots, including inactive and historical swipes.
 */
export function enumerateOwnedSlots(input, { includeEmpty = false } = {}) {
  const messages = Array.isArray(input)
    ? input
    : input?.messages ?? input?.chat ?? [];
  if (!Array.isArray(messages)) return [];
  const slots = [];
  messages.forEach((message, messageIndex) => {
    if (!message || typeof message !== 'object') return;
    const messageId = messageIdOf(message, messageIndex);
    const messageExtra =
      message.extra && typeof message.extra === 'object'
        ? message.extra
        : null;
    const messageRoot =
      messageExtra && hasOwn(messageExtra, OWNED_ROOT)
        ? messageExtra[OWNED_ROOT]
        : undefined;
    const ordinary = slotDescriptor({
      message,
      messageIndex,
      messageId,
      value: messageRoot,
      includeEmpty: includeEmpty && Boolean(messageExtra),
    });
    if (ordinary) slots.push(ordinary);

    const swipeInfo = message.swipe_info;
    if (!swipeInfo || typeof swipeInfo !== 'object') return;
    Object.keys(swipeInfo).forEach((rawSwipeId) => {
      const swipe = swipeInfo[rawSwipeId];
      if (!swipe || typeof swipe !== 'object') return;
      const extra = swipe.extra && typeof swipe.extra === 'object' ? swipe.extra : null;
      const root = extra && hasOwn(extra, OWNED_ROOT) ? extra[OWNED_ROOT] : undefined;
      const slot = slotDescriptor({
        message,
        messageIndex,
        messageId,
        swipeId: rawSwipeId,
        value: root,
        includeEmpty: includeEmpty && Boolean(extra),
      });
      if (slot) slots.push(slot);
    });
  });
  return slots;
}

export const enumerateBioWeaveOwnedSlots = enumerateOwnedSlots;
export const enumerateFloorSlots = enumerateOwnedSlots;

function clearDefault(scope, field) {
  const definition = getFieldDefinition(scope, field);
  if (definition && hasOwn(definition, 'empty'))
    return cloneValue(definition.empty);
  if (scope === 'chat') return undefined;
  if (field === 'analysis') return null;
  if (field === 'events') return [];
  if (field === 'character_registry')
    return { schema_version: 1, entities: {} };
  if (field === 'floor_version') return null;
  return undefined;
}

function lastMessageBoundary(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== 'object') continue;
    return {
      message_id: messageIdOf(message, index),
      message_index: index,
      floor: message.floor ?? message.metadata?.floor ?? null,
    };
  }
  // `-1` is an explicit boundary before the first future message. Keeping
  // this distinct from an unknown/legacy marker lets a character reset made
  // in an empty Chat accept the first post-reset Floor without treating it as
  // historical data.
  return { message_id: null, message_index: -1, floor: null };
}

function markerBoundaryEqual(left, right) {
  return Boolean(
    left &&
      right &&
      String(left.chat_id ?? left.chatId) === String(right.chat_id) &&
      String(left.message_id) === String(right.message_id) &&
      Object.is(left.message_index ?? null, right.message_index ?? null) &&
      Object.is(left.floor ?? null, right.floor ?? null),
  );
}

function makeCharacterResetMarker(chatId, messages, now, previous) {
  const boundary = lastMessageBoundary(messages);
  const next = {
    schema_version: 1,
    chat_id: chatId,
    message_id: boundary.message_id,
    message_index: boundary.message_index,
    floor: boundary.floor,
    created_at: now(),
  };
  if (markerBoundaryEqual(previous, next)) return cloneValue(previous);
  return next;
}

function chatRootForState(state, chatId) {
  const root = state.chatRoot;
  return root === undefined ? undefined : cloneValue(root);
}

function applyChatClear(root, domain, chatId, messages, now) {
  const before = root === undefined ? undefined : cloneValue(root);
  if (before !== undefined && !isRecord(before))
    throw errorWithCode('CHAT_ROOT_INVALID');
  if (domain === 'all') {
    if (before === undefined) return { before, after: undefined, fields: [] };
    return {
      before,
      after: emptyChat(chatId),
      fields: Object.keys(before).filter((field) =>
        !deepEqual(before[field], emptyChat(chatId)[field]),
      ),
    };
  }

  const defaults = emptyChat(chatId);
  const clearableFields = getClearableFields('chat', domain);
  const hasChatData = Boolean(
    before &&
      clearableFields.some(
        (field) => hasOwn(before, field) && !deepEqual(before[field], defaults[field]),
      ),
  );
  const hasCharacterBoundary =
    domain === 'character' &&
    messages.some((message) =>
      enumerateOwnedSlots([message]).some((slot) => {
        const value = slot.value;
        if (!value || typeof value !== 'object') return false;
        if (Array.isArray(value.events) && value.events.length > 0) return true;
        return value.character_registry?.entities && Object.keys(value.character_registry.entities).length > 0;
      }),
    );
  if (!hasChatData && !hasCharacterBoundary && domain !== 'character') {
    return { before, after: undefined, fields: [] };
  }
  const after = before ? cloneValue(before) : emptyChat(chatId);
  const changedFields = [];
  for (const field of clearableFields) {
    if (!hasOwn(after, field)) continue;
    const next = hasOwn(defaults, field)
      ? cloneValue(defaults[field])
      : clearDefault('chat', field, chatId);
    if (!deepEqual(after[field], next)) changedFields.push(field);
    after[field] = next;
  }

  if (domain === 'character') {
    const lifecycle = isRecord(after.data_lifecycle)
      ? after.data_lifecycle
      : { character_reset: null };
    const marker = makeCharacterResetMarker(
      chatId,
      messages,
      now,
      lifecycle.character_reset,
    );
    if (!deepEqual(lifecycle.character_reset, marker)) {
      changedFields.push('data_lifecycle.character_reset');
      lifecycle.character_reset = marker;
    }
    after.data_lifecycle = lifecycle;
  }
  return { before, after, fields: [...new Set(changedFields)] };
}

function applyFloorClear(slot, domain) {
  const before = slot.value === undefined ? undefined : cloneValue(slot.value);
  if (before === undefined) return { before, after: undefined, fields: [] };
  if (!isRecord(before)) {
    if (domain === 'all') return { before, after: undefined, fields: ['<root>'] };
    throw errorWithCode('FLOOR_ROOT_INVALID', { slotId: slot.slotId });
  }
  if (domain === 'all') {
    return {
      before,
      after: undefined,
      fields: Object.keys(before),
    };
  }
  const after = cloneValue(before);
  const fields = [];
  for (const field of getClearableFields('floor', domain)) {
    const definition = getFieldDefinition('floor', field);
    if (!definition?.clearOn?.includes(domain)) continue;
    if (!hasOwn(after, field)) continue;
    const next = clearDefault('floor', field);
    if (!deepEqual(after[field], next)) fields.push(field);
    after[field] = next;
  }
  return { before, after, fields };
}

function dependenciesFor(domain) {
  if (domain === 'character') return ['character'];
  if (domain === 'world') return ['world'];
  return [
    'chat_settings',
    'world',
    'character',
    'events',
    'floor_analysis',
    'floor_identity',
  ];
}

function normalizeDomain(domain) {
  const normalized = String(domain ?? '').trim().toLowerCase();
  if (normalized === 'character' || normalized === 'world' || normalized === 'all')
    return normalized;
  throw errorWithCode('CLEAR_DOMAIN_INVALID');
}

function normalizePlanOptions(options, maybeState) {
  if (typeof options === 'string') {
    return { ...(maybeState ?? {}), domain: options };
  }
  return options && typeof options === 'object' ? options : {};
}

/**
 * Build a registry-driven, exact-field clear plan from one owner snapshot.
 * The snapshot is read-only; applying the plan never mutates it.
 */
export function buildClearPlan(options = {}, maybeState = null) {
  const input = normalizePlanOptions(options, maybeState);
  const domain = normalizeDomain(input.domain ?? input.operation);
  const state = input.state ?? input;
  const chatId =
    input.chatId ?? input.chat_id ?? state.chatId ?? state.chat_id ?? ownerChatId(input.owner);
  if (!chatId) throw errorWithCode('CHAT_OWNER_REQUIRED');
  assertLifecycleRegistryCoverage({
    chatKeys: Object.keys(emptyChat(chatId)),
    floorKeys: Object.keys(emptyFloor()),
  });
  const normalizedState = normalizeState(state, chatId);
  const messages = normalizedState.messages;
  const chat = applyChatClear(
    chatRootForState(normalizedState, chatId),
    domain,
    chatId,
    messages,
    typeof input.now === 'function' ? input.now : () => Date.now(),
  );
  const slots = enumerateOwnedSlots(messages).map((slot) => {
    const cleared = applyFloorClear(slot, domain);
    return {
      ...slot,
      before: cleared.before,
      after: cleared.after,
      fields: cleared.fields,
      changed: !deepEqual(cleared.before, cleared.after),
      value: undefined,
      message: undefined,
    };
  });
  const changedSlots = slots.filter((slot) => slot.changed);
  const changedChat = !deepEqual(chat.before, chat.after);
  const removed = {
    chatFields: chat.fields,
    floorSlots: changedSlots.length,
    swipeSlots: changedSlots.filter((slot) => slot.kind === 'swipe').length,
    messageExtraSlots: changedSlots.filter((slot) => slot.kind === 'message_extra').length,
    floorFields: [...new Set(changedSlots.flatMap((slot) => slot.fields))],
  };
  return {
    schema_version: 1,
    operation: domain,
    domain,
    chatId,
    owner: cloneValue(input.owner ?? { chatId }),
    sourceTargeted: input.sourceTargeted === true || input.source_targeted === true,
    token: cloneValue(input.token),
    revision: normalizedState.revision,
    changed: changedChat || changedSlots.length > 0,
    dependencies: dependenciesFor(domain),
    chat: {
      before: cloneValue(chat.before),
      after: cloneValue(chat.after),
      fields: chat.fields,
    },
    slots: slots.map((slot) => ({
      slotId: slot.slotId,
      kind: slot.kind,
      messageIndex: slot.messageIndex,
      messageId: slot.messageId,
      swipeId: slot.swipeId,
      path: slot.path,
      before: cloneValue(slot.before),
      after: cloneValue(slot.after),
      fields: slot.fields,
      changed: slot.changed,
    })),
    removed,
    previous: {
      chatRoot: cloneValue(chat.before),
      slots: slots.map((slot) => ({
        slotId: slot.slotId,
        kind: slot.kind,
        messageIndex: slot.messageIndex,
        messageId: slot.messageId,
        swipeId: slot.swipeId,
        value: cloneValue(slot.before),
      })),
    },
  };
}

export const createClearPlan = buildClearPlan;
export const planBioWeaveClear = buildClearPlan;

function applyPlanToState(state, plan) {
  const next = {
    ...cloneValue(state),
    chatId: plan.chatId,
    chat_id: plan.chatId,
    chatMetadata: cloneValue(state.chatMetadata ?? state.metadata ?? {}),
    messages: cloneValue(state.messages ?? state.chat ?? []),
  };
  if (plan.chat.after === undefined) delete next.chatMetadata[OWNED_ROOT];
  else next.chatMetadata[OWNED_ROOT] = cloneValue(plan.chat.after);
  for (const slot of plan.slots) {
    if (!slot.changed) continue;
    const message = next.messages[slot.messageIndex];
    if (!message || String(messageIdOf(message, slot.messageIndex)) !== String(slot.messageId))
      throw errorWithCode('MESSAGE_OWNER_CHANGED', { slotId: slot.slotId });
    if (slot.kind === 'message_extra') {
      if (slot.after === undefined) {
        if (message.extra && typeof message.extra === 'object')
          delete message.extra[OWNED_ROOT];
      } else {
        message.extra ??= {};
        message.extra[OWNED_ROOT] = cloneValue(slot.after);
      }
      continue;
    }
    const swipe = message.swipe_info?.[slot.swipeId];
    if (!swipe || typeof swipe !== 'object')
      throw errorWithCode('SWIPE_OWNER_CHANGED', { slotId: slot.slotId });
    if (slot.after === undefined) {
      if (swipe.extra && typeof swipe.extra === 'object')
        delete swipe.extra[OWNED_ROOT];
    } else {
      swipe.extra ??= {};
      swipe.extra[OWNED_ROOT] = cloneValue(slot.after);
    }
  }
  next.metadata = next.chatMetadata;
  next.chat = next.messages;
  next.bioweave = cloneValue(next.chatMetadata[OWNED_ROOT]);
  return next;
}

// The source-owner adapter uses the same registry-built plan to merge a clear
// into the latest persisted source state. It is an application primitive, not
// a second clear implementation or a new field list.
export const applyClearPlanToState = applyPlanToState;

function commitStateFrom(value) {
  const source = value && typeof value === 'object' ? value : null;
  const state =
    source?.commitState ??
    source?.commit_state ??
    source?.persistence?.commitState ??
    source?.persistence?.commit_state;
  if (state === 'confirmed' || state === 'failed' || state === 'unknown') return state;
  if (source && source.ok === false) return 'failed';
  return 'confirmed';
}

function isUnknownError(error) {
  return Boolean(
    error?.commitState === 'unknown' ||
      error?.commit_state === 'unknown' ||
      error?.unknownCommit === true ||
      error?.unknown_commit === true ||
      error?.persistence?.commitState === 'unknown',
  );
}

function rollbackIsPartial(rollback) {
  return Boolean(
    rollback &&
      (rollback.state === 'failed' ||
        rollback.state === 'unknown' ||
        rollback.durable === 'partial' ||
        rollback.durable === 'not_confirmed'),
  );
}

function isAbortSignal(signal) {
  return Boolean(signal?.aborted);
}

function resultBase(plan, {
  ok,
  changed = plan.changed,
  commitState = 'confirmed',
  attempted = false,
  sourceTargeted = plan.sourceTargeted,
  invalidated = false,
  partial = false,
  previousSnapshot = plan.previous,
  error = null,
  rollback = null,
} = {}) {
  const result = {
    ok,
    changed,
    domain: plan.domain,
    operation: plan.operation,
    chatId: plan.chatId,
    owner: cloneValue(plan.owner),
    sourceTargeted: Boolean(sourceTargeted),
    removed: cloneValue(plan.removed),
    invalidated: {
      runtime: Boolean(invalidated),
      domains: [...plan.dependencies],
      slots: plan.slots.filter((slot) => slot.changed).map((slot) => slot.slotId),
    },
    persistence: {
      commitState,
      attempted,
      partial: Boolean(partial),
      ...(rollback ? { rollback: cloneValue(rollback) } : {}),
    },
    previousSnapshot: cloneValue(previousSnapshot),
  };
  if (error) {
    result.error = {
      code: error.code ?? error.message ?? 'CLEAR_FAILED',
      message: error.message ?? String(error),
    };
    result.error_code = result.error.code;
  }
  return result;
}

function targetNeedsSourceAdapter(target, currentId) {
  return Boolean(
    target.sourceTargeted ||
      target.source_targeted ||
      target.kind === 'source' ||
      (target.chatId && String(target.chatId) !== String(currentId)),
  );
}

function sourceIdentityFrom(owner, state) {
  const ownerValue = owner && typeof owner === 'object' ? owner : {};
  const stateOwner = state?.owner ?? {};
  return {
    chatId: state?.chatId ?? state?.chat_id,
    characterId:
      state?.characterId ?? state?.character_id ?? stateOwner.characterId ?? stateOwner.character_id ??
      ownerValue.characterId ?? ownerValue.character_id ?? null,
    groupId:
      state?.groupId ?? state?.group_id ?? stateOwner.groupId ?? stateOwner.group_id ??
      ownerValue.groupId ?? ownerValue.group_id ?? null,
  };
}

function identityMatches(owner, state) {
  const identity = sourceIdentityFrom(owner, state);
  if (!identity.chatId || String(identity.chatId) !== String(ownerChatId(owner))) return false;
  const expectedCharacter = owner?.characterId ?? owner?.character_id;
  const expectedGroup = owner?.groupId ?? owner?.group_id;
  if (expectedCharacter != null && String(expectedCharacter) !== String(identity.characterId))
    return false;
  if (expectedGroup != null && String(expectedGroup) !== String(identity.groupId)) return false;
  return true;
}

function revisionFromOwner(owner) {
  return owner?.revision ?? owner?.sourceRevision ?? owner?.source_revision ?? owner?.snapshot?.revision;
}

function sourceRevisionProven(state) {
  return state?.revision !== undefined && state?.revision !== null;
}

function currentIdOf(adapter, boundary) {
  return boundary?.current?.() ?? adapter?.getChatId?.() ?? null;
}

function safeCurrentToken(adapter, boundary) {
  if (typeof boundary?.token === 'function') return boundary.token();
  return { chatId: adapter?.getChatId?.() ?? null };
}

function assertCurrentToken(adapter, boundary, token, chatId) {
  if (typeof boundary?.assert === 'function') {
    boundary.assert(token);
    return;
  }
  if (String(adapter?.getChatId?.()) !== String(chatId))
    throw errorWithCode('STALE_CHAT');
}

function comparePlanApplied(state, plan) {
  const root = state.chatMetadata?.[OWNED_ROOT];
  if (!deepEqual(root, plan.chat.after)) return false;
  for (const slot of plan.slots) {
    if (!slot.changed) continue;
    const message = state.messages?.[slot.messageIndex];
    if (!message) return false;
    const value =
      slot.kind === 'message_extra'
        ? message.extra?.[OWNED_ROOT]
        : message.swipe_info?.[slot.swipeId]?.extra?.[OWNED_ROOT];
    if (!deepEqual(value, slot.after)) return false;
  }
  return true;
}

function unownedStateEqual(before, after) {
  const beforeMetadata = cloneValue(before?.chatMetadata ?? before?.metadata ?? {});
  const afterMetadata = cloneValue(after?.chatMetadata ?? after?.metadata ?? {});
  delete beforeMetadata[OWNED_ROOT];
  delete afterMetadata[OWNED_ROOT];

  const unownedHeader = (value) => {
    const header = cloneValue(value && typeof value === 'object' ? value : {});
    delete header.chat_metadata;
    return header;
  };

  const stripOwnedRoots = (messages) =>
    (Array.isArray(messages) ? messages : []).map((message) => {
      const copy = cloneValue(message);
      if (copy?.extra && typeof copy.extra === 'object')
        delete copy.extra[OWNED_ROOT];
      if (copy?.swipe_info && typeof copy.swipe_info === 'object') {
        for (const swipe of Object.values(copy.swipe_info)) {
          if (swipe?.extra && typeof swipe.extra === 'object')
            delete swipe.extra[OWNED_ROOT];
        }
      }
      return copy;
    });

  return (
    deepEqual(unownedHeader(before?.header), unownedHeader(after?.header)) &&
    deepEqual(beforeMetadata, afterMetadata) &&
    deepEqual(
      stripOwnedRoots(before?.messages ?? before?.chat),
      stripOwnedRoots(after?.messages ?? after?.chat),
    )
  );
}

function adapterAtomicWriter(adapter) {
  return [
    'commitBioWeaveMutation',
    'saveBioWeaveState',
    'saveChatBioWeaveState',
  ].find((name) => typeof adapter?.[name] === 'function');
}

/**
 * Create the one storage clear engine used by both settings actions and the
 * future Start New Chat coordinator.  The engine owns domain selection,
 * exact-slot planning, snapshots and persistence status; callers only select
 * the target owner and domain.
 */
export function createClearService({
  adapter = null,
  store: suppliedStore = null,
  boundary = null,
  now = () => Date.now(),
  signal = null,
  invalidate = null,
  onInvalidate = null,
  autoInvalidate = true,
} = {}) {
  const store = suppliedStore ?? (adapter ? createStore(adapter, boundary) : null);
  const host = adapter ?? store?.adapter ?? null;
  if (!store || !host) throw new TypeError('CLEAR_STORAGE_REQUIRED');
  const inFlight = new Map();

  async function readOwner(owner, source) {
    if (source) {
      const state = await store.readChatOwnerSnapshot(owner, { source: true });
      if (!identityMatches(owner, state))
        throw errorWithCode('SOURCE_OWNER_IDENTITY_MISMATCH');
      if (!sourceRevisionProven(state))
        throw errorWithCode('SOURCE_REVISION_UNVERIFIED');
      return normalizeState(state, ownerChatId(owner));
    }
    const state = store.getCurrentChatOwnerSnapshot(ownerChatId(owner));
    return normalizeState(state, ownerChatId(owner));
  }

  async function invokeInvalidation(payload) {
    let didInvalidate = false;
    const callbacks = [invalidate, onInvalidate];
    for (const callback of callbacks) {
      if (typeof callback !== 'function') continue;
      await callback(payload);
      didInvalidate = true;
    }
    return didInvalidate;
  }

  function currentChatSaver() {
    return typeof host.saveChat === 'function'
      ? host.saveChat.bind(host)
      : host.getContext?.()?.saveChat;
  }

  async function compensateLegacyCurrent(plan, commit) {
    // A known failed metadata response is treated as non-persisted.  Once a
    // metadata phase was confirmed, however, a later message save failure
    // requires a compensating metadata save as well.
    const metadataAttempted = Boolean(commit?.metadata?.persisted);
    const messagesAttempted = Boolean(commit?.messages?.attempted);
    const rollback = {
      state: 'not_attempted',
      durable: 'not_attempted',
      steps: [],
    };
    if (!metadataAttempted && !messagesAttempted) {
      rollback.state = 'memory_only';
      rollback.durable = 'not_required';
      return rollback;
    }

    try {
      if (metadataAttempted) {
        if (plan.chat.before === undefined) {
          if (typeof host.deleteChatMetadata === 'function') {
            const response = await host.deleteChatMetadata(
              OWNED_ROOT,
              plan.chatId,
            );
            const state = commitStateFrom(response);
            if (state !== 'confirmed') {
              throw errorWithCode(
                state === 'unknown'
                  ? 'CLEAR_ROLLBACK_METADATA_UNKNOWN'
                  : 'CLEAR_ROLLBACK_METADATA_FAILED',
              );
            }
          } else {
            throw errorWithCode('CLEAR_ROLLBACK_METADATA_DELETE_UNAVAILABLE');
          }
        } else {
          if (typeof host.saveChatMetadata !== 'function')
            throw errorWithCode('CLEAR_ROLLBACK_METADATA_UNAVAILABLE');
          const response = await host.saveChatMetadata(
            OWNED_ROOT,
            cloneValue(plan.chat.before),
            plan.chatId,
          );
          const state = commitStateFrom(response);
          if (state !== 'confirmed') {
            throw errorWithCode(
              state === 'unknown'
                ? 'CLEAR_ROLLBACK_METADATA_UNKNOWN'
                : 'CLEAR_ROLLBACK_METADATA_FAILED',
            );
          }
        }
        rollback.steps.push('metadata');
      }

      if (messagesAttempted) {
        const saveChat = currentChatSaver();
        if (typeof saveChat !== 'function')
          throw errorWithCode('CLEAR_ROLLBACK_CHAT_UNAVAILABLE');
        const response = await saveChat();
        const state = commitStateFrom(response);
        if (state !== 'confirmed') {
          throw errorWithCode(
            state === 'unknown'
              ? 'CLEAR_ROLLBACK_CHAT_UNKNOWN'
              : 'CLEAR_ROLLBACK_CHAT_FAILED',
          );
        }
        rollback.steps.push('messages');
      }
      rollback.state = 'confirmed';
      rollback.durable = 'confirmed';
    } catch (rollbackError) {
      rollback.state =
        rollbackError.code?.endsWith('_UNKNOWN') ? 'unknown' : 'failed';
      rollback.durable =
        rollback.steps.length > 0 ? 'partial' : 'not_confirmed';
      rollback.error = rollbackError.code ?? rollbackError.message;
    }
    return rollback;
  }

  async function restoreCurrent(plan, error, commit = {}) {
    const rollback = { state: 'not_attempted' };
    if (commit.memoryApplied !== false) {
      try {
        store.restoreBioWeavePlanToCurrent(plan);
        rollback.state = 'memory_confirmed';
      } catch (restoreError) {
        rollback.state = 'memory_failed';
        rollback.error = restoreError.code ?? restoreError.message;
        return rollback;
      }
    } else {
      rollback.state = 'memory_not_modified';
    }

    const explicitRollbackWriter =
      host.rollbackBioWeaveMutation ?? host.restoreBioWeaveState;
    if (typeof explicitRollbackWriter === 'function') {
      try {
        const response = await explicitRollbackWriter.call(host, {
          owner: { chatId: plan.chatId },
          chatId: plan.chatId,
          expectedRevision: plan.revision,
          previous: cloneValue(plan.previous),
          plan: cloneValue(plan),
          cause: error?.code ?? error?.message,
        });
        const commitState = commitStateFrom(response);
        if (commitState !== 'confirmed') {
          const rollbackError = errorWithCode(
            commitState === 'unknown'
              ? 'CLEAR_ROLLBACK_UNKNOWN'
              : 'CLEAR_ROLLBACK_FAILED',
          );
          rollback.state = commitState;
          rollback.durable = 'not_confirmed';
          rollback.error = rollbackError.code;
          return rollback;
        }
        rollback.state = 'confirmed';
        rollback.durable = 'confirmed';
      } catch (rollbackError) {
        rollback.state = isUnknownError(rollbackError) ? 'unknown' : 'failed';
        rollback.durable = 'not_confirmed';
        rollback.error = rollbackError.code ?? rollbackError.message;
      }
      return rollback;
    }

    if (commit.path === 'legacy') {
      const durable = await compensateLegacyCurrent(plan, commit);
      const combined = {
        ...rollback,
        durable: durable.durable,
        steps: durable.steps,
      };
      if (durable.state === 'confirmed') combined.state = 'confirmed';
      else if (durable.state === 'failed' || durable.state === 'unknown') {
        combined.state = durable.state;
        combined.durableState = durable.state;
        combined.error = durable.error;
      }
      return combined;
    }
    return rollback;
  }

  async function commitCurrent(plan, state, token, signalValue) {
    assertCurrentToken(host, boundary, token, plan.chatId);
    const nextState = applyPlanToState(state, plan);
    const atomicName = adapterAtomicWriter(host);
    let attempted = false;
    if (atomicName) {
      attempted = true;
      const response = await host[atomicName].call(host, {
        owner: { chatId: plan.chatId },
        chatId: plan.chatId,
        expectedRevision: state.revision,
        previous: cloneValue(state),
        next: cloneValue(nextState),
        state: cloneValue(nextState),
        plan: cloneValue(plan),
        sourceTargeted: false,
      });
      const commitState = commitStateFrom(response);
      if (commitState !== 'confirmed')
        return {
          commitState,
          attempted,
          path: 'atomic',
          memoryApplied: false,
        };
      if (isAbortSignal(signalValue))
        return {
          commitState: 'unknown',
          attempted,
          path: 'atomic',
          memoryApplied: false,
        };
      assertCurrentToken(host, boundary, token, plan.chatId);
      return {
        commitState: 'confirmed',
        attempted,
        path: 'atomic',
        memoryApplied: false,
      };
    }

    // The legacy host adapter has separate metadata/chat save calls.  Apply
    // only exact roots, then save through those existing boundaries.  A host
    // that wants atomicity can implement the writer above.
    store.applyBioWeavePlanToCurrent(plan);
    const result = {
      commitState: 'confirmed',
      attempted: false,
      path: 'legacy',
      memoryApplied: true,
      metadata: { attempted: false, commitState: 'not_attempted' },
      messages: { attempted: false, commitState: 'not_attempted' },
    };
    try {
      if (!deepEqual(plan.chat.before, plan.chat.after)) {
        if (typeof host.saveChatMetadata !== 'function')
          throw errorWithCode('ST_METADATA_STORAGE_UNAVAILABLE');
        attempted = true;
        result.attempted = true;
        result.metadata.attempted = true;
        const response = await host.saveChatMetadata(
          OWNED_ROOT,
          cloneValue(plan.chat.after),
          plan.chatId,
        );
        const commitState = commitStateFrom(response);
        result.metadata.commitState = commitState;
        if (commitState !== 'confirmed') {
          result.commitState = commitState;
          result.error = errorWithCode(
            commitState === 'unknown'
              ? 'CLEAR_METADATA_COMMIT_UNKNOWN'
              : 'CLEAR_METADATA_COMMIT_FAILED',
          );
          return result;
        }
        result.metadata.persisted = true;
      }
      if (plan.slots.some((slot) => slot.changed)) {
        const saveChat = currentChatSaver();
        if (typeof saveChat !== 'function')
          throw errorWithCode('ST_CHAT_STORAGE_UNAVAILABLE');
        attempted = true;
        result.attempted = true;
        result.messages.attempted = true;
        const response = await saveChat();
        const commitState = commitStateFrom(response);
        result.messages.commitState = commitState;
        if (commitState !== 'confirmed') {
          result.commitState = commitState;
          result.error = errorWithCode(
            commitState === 'unknown'
              ? 'CLEAR_CHAT_COMMIT_UNKNOWN'
              : 'CLEAR_CHAT_COMMIT_FAILED',
          );
          return result;
        }
        result.messages.persisted = true;
      }
      if (isAbortSignal(signalValue)) {
        result.commitState = 'unknown';
        result.error = errorWithCode('CLEAR_COMMIT_UNKNOWN');
        return result;
      }
      assertCurrentToken(host, boundary, token, plan.chatId);
      return result;
    } catch (error) {
      if (isUnknownError(error) || (attempted && error?.code === 'STALE_CHAT'))
        result.commitState = 'unknown';
      else result.commitState = 'failed';
      result.attempted = attempted;
      result.error = error;
      return result;
    }
  }

  async function commitSource(plan, state, owner, signalValue) {
    let attempted = false;
    let saveResolved = false;
    try {
      attempted = true;
      const nextState = applyPlanToState(state, plan);
      const response = await store.saveSourceChatOwner(owner, nextState, {
        expectedRevision: state.revision,
        previous: state,
        plan,
        signal: signalValue,
      });
      const commitState = commitStateFrom(response);
      if (commitState !== 'confirmed') return { commitState, attempted };
      saveResolved = true;
      if (isAbortSignal(signalValue)) return { commitState: 'unknown', attempted };
      const appliedPlan =
        response?.plan?.chat && Array.isArray(response?.plan?.slots)
          ? response.plan
          : plan;
      // A source write is confirmed only when the source adapter can read the
      // same immutable owner again and expose the resulting revision/state.
      const verified = await store.readChatOwnerSnapshot(owner, { source: true });
      if (!identityMatches(owner, verified) || !sourceRevisionProven(verified))
        return {
          commitState: 'unknown',
          attempted,
          error: errorWithCode('SOURCE_OWNER_UNVERIFIED_AFTER_SAVE'),
        };
      if (!comparePlanApplied(verified, appliedPlan))
        return {
          commitState: 'unknown',
          attempted,
          error: errorWithCode('SOURCE_CLEAR_NOT_CONFIRMED'),
        };
      const unownedBaseline =
        response?.mergeMode === 'latest-source' && response?.baseState
          ? response.baseState
          : state;
      if (!unownedStateEqual(unownedBaseline, verified))
        return {
          commitState: 'unknown',
          attempted,
          error: errorWithCode('SOURCE_UNOWNED_STATE_CHANGED'),
        };
      return {
        commitState: 'confirmed',
        attempted,
        revision: verified.revision,
        plan: appliedPlan,
      };
    } catch (error) {
      if (saveResolved || isUnknownError(error))
        return { commitState: 'unknown', attempted, error };
      return { commitState: 'failed', attempted, error };
    }
  }

  async function execute(domain, rawTarget, { source = false, signal: operationSignal = signal } = {}) {
    let target;
    let plan;
    let state;
    let token;
    let invalidated = false;
    let commitStarted = false;
    const signalValue = operationSignal;
    try {
      if (isAbortSignal(signalValue)) throw errorWithCode('CLEAR_ABORTED');
      const currentId = currentIdOf(host, boundary);
      target = normalizeOwner(rawTarget ?? { chatId: currentId }, { source });
      if (!target.chatId) throw errorWithCode('CHAT_OWNER_REQUIRED');
      const sourceTargeted = targetNeedsSourceAdapter(target, currentId);
      target.sourceTargeted = sourceTargeted;
      if (!sourceTargeted && String(target.chatId) !== String(currentId))
        throw errorWithCode('CLEAR_OWNER_MISMATCH');
      if (sourceTargeted && rawTarget?.snapshot) {
        const snapshotId = ownerChatId(rawTarget.snapshot);
        if (snapshotId && String(snapshotId) !== String(target.chatId))
          throw errorWithCode('SOURCE_SNAPSHOT_IDENTITY_MISMATCH');
      }
      const ownerRevision = revisionFromOwner(target);
      state = await readOwner(target, sourceTargeted);
      if (sourceTargeted) {
        // The transition snapshot is only an owner hint.  Re-read immediately
        // before planning so boundary-time changes are included; the source
        // writer still must enforce the expected revision as a CAS because a
        // read/write pair cannot close a race by itself.
        state = await readOwner(target, true);
      }
      if (sourceTargeted && ownerRevision !== undefined && ownerRevision !== null) {
        // A changed revision is allowed: the plan is rebuilt from the latest
        // source state.  The captured revision is evidence for the boundary,
        // not permission to overwrite the captured snapshot.
        target.capturedRevision = ownerRevision;
      }
      plan = buildClearPlan({
        domain,
        owner: target,
        chatId: target.chatId,
        state,
        now,
        sourceTargeted,
      });
      if (!plan.changed) {
        return resultBase(plan, {
          ok: true,
          changed: false,
          commitState: 'confirmed',
          sourceTargeted,
          previousSnapshot: plan.previous,
        });
      }
      if (isAbortSignal(signalValue)) throw errorWithCode('CLEAR_ABORTED');

      if (autoInvalidate && typeof boundary?.invalidate === 'function') {
        boundary.invalidate(`clear:${domain}`, { checkCurrent: !sourceTargeted });
        invalidated = true;
      }
      const beforeInvalidationToken = safeCurrentToken(host, boundary);
      invalidated =
        (await invokeInvalidation({
          phase: 'before-commit',
          domain,
          owner: cloneValue(target),
          token: cloneValue(beforeInvalidationToken),
          plan: cloneValue(plan),
        })) || invalidated;
      token = safeCurrentToken(host, boundary);
      if (!sourceTargeted) assertCurrentToken(host, boundary, token, target.chatId);

      commitStarted = true;
      const commit = sourceTargeted
        ? await commitSource(plan, state, target, signalValue)
        : await commitCurrent(plan, state, token, signalValue);
      if (commit?.plan?.chat && Array.isArray(commit?.plan?.slots))
        plan = commit.plan;
      if (commit.commitState === 'confirmed') {
        return resultBase(plan, {
          ok: true,
          changed: true,
          commitState: 'confirmed',
          attempted: commit.attempted,
          sourceTargeted,
          invalidated,
        });
      }
      if (commit.commitState === 'unknown') {
        return resultBase(plan, {
          ok: false,
          changed: true,
          commitState: 'unknown',
          attempted: commit.attempted,
          sourceTargeted,
          invalidated,
          error: commit.error ?? errorWithCode('CLEAR_COMMIT_UNKNOWN'),
        });
      }
      const rollback = sourceTargeted
        ? { state: 'not_required_source_adapter_failed' }
        : await restoreCurrent(plan, commit.error, commit);
      const partial = rollbackIsPartial(rollback);
      return resultBase(plan, {
        ok: false,
        changed: partial,
        commitState: 'failed',
        attempted: commit.attempted,
        sourceTargeted,
        invalidated,
        partial,
        error: commit.error ?? errorWithCode('CLEAR_COMMIT_FAILED'),
        rollback,
      });
    } catch (error) {
      if (!plan) {
        const fallbackPlan = {
          domain,
          operation: domain,
          chatId: target?.chatId ?? ownerChatId(rawTarget) ?? currentIdOf(host, boundary),
          owner: target ?? normalizeOwner(rawTarget ?? { chatId: currentIdOf(host, boundary) }),
          sourceTargeted: Boolean(target?.sourceTargeted),
          dependencies: dependenciesFor(domain),
          changed: false,
          slots: [],
          removed: { chatFields: [], floorSlots: 0, swipeSlots: 0, messageExtraSlots: 0, floorFields: [] },
          previous: { chatRoot: undefined, slots: [] },
          chat: { before: undefined, after: undefined, fields: [] },
        };
        return resultBase(fallbackPlan, {
          ok: false,
          changed: false,
          commitState: 'failed',
          sourceTargeted: Boolean(target?.sourceTargeted),
          invalidated,
          error,
        });
      }
      const rollback =
        commitStarted &&
        !target?.sourceTargeted &&
        error?.code !== 'CLEAR_ABORTED' &&
        !isUnknownError(error)
          ? await restoreCurrent(plan, error)
          : target?.sourceTargeted
            ? { state: 'not_required_source_adapter_failed' }
            : null;
      const partial = rollbackIsPartial(rollback);
      return resultBase(plan, {
        ok: false,
        changed: partial,
        commitState: isUnknownError(error) ? 'unknown' : 'failed',
        attempted: false,
        sourceTargeted: Boolean(target?.sourceTargeted),
        invalidated,
        partial,
        error,
        rollback,
      });
    }
  }

  function run(domain, target, options = {}) {
    const normalized = normalizeOwner(target ?? { chatId: currentIdOf(host, boundary) }, options);
    const key = `${domain}:${ownerChatId(normalized)}:${
      targetNeedsSourceAdapter(normalized, currentIdOf(host, boundary)) ? 'source' : 'current'
    }`;
    const existing = inFlight.get(key);
    if (existing) return existing;
    const promise = execute(domain, target, options).finally(() => {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    });
    inFlight.set(key, promise);
    return promise;
  }

  function clearCharacterData(target = undefined, options = {}) {
    return run('character', target, options);
  }

  function clearWorldData(target = undefined, options = {}) {
    return run('world', target, options);
  }

  function clearAllBioWeaveData(target = undefined, options = {}) {
    return run('all', target, options);
  }

  function clearSourceChatBioWeave(sourceOwner, options = {}) {
    if (!sourceOwner) {
      return Promise.resolve(
        resultBase(
          {
            domain: 'all',
            operation: 'all',
            chatId: null,
            owner: null,
            sourceTargeted: true,
            dependencies: dependenciesFor('all'),
            changed: false,
            slots: [],
            removed: { chatFields: [], floorSlots: 0, swipeSlots: 0, messageExtraSlots: 0, floorFields: [] },
            previous: { chatRoot: undefined, slots: [] },
          },
          { ok: false, changed: false, commitState: 'failed', error: errorWithCode('SOURCE_OWNER_REQUIRED') },
        ),
      );
    }
    return run(
      'all',
      { ...cloneValue(sourceOwner), sourceTargeted: true, source_targeted: true },
      { ...options, source: true },
    );
  }

  return {
    store,
    registry: {
      chat: CHAT_FIELD_REGISTRY,
      floor: FLOOR_FIELD_REGISTRY,
      domains: LIFECYCLE_DOMAINS,
    },
    clearCharacterData,
    clearWorldData,
    clearAllBioWeaveData,
    clearSourceChatBioWeave,
    clearSourceChatData: clearSourceChatBioWeave,
    clearChatOwnerBioWeave: clearSourceChatBioWeave,
    enumerateOwnedSlots,
    enumerateBioWeaveOwnedSlots,
    buildClearPlan,
    createClearPlan: buildClearPlan,
    getInFlightCount: () => inFlight.size,
  };
}

export const createClearEngine = createClearService;
