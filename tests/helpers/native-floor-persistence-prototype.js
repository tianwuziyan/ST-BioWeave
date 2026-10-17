import assert from "node:assert/strict";

export const STATES = Object.freeze({
  DISPATCHED: "DISPATCHED",
  HOST_ACCEPTED: "HOST_ACCEPTED",
  SERVER_WRITE_COMPLETED: "SERVER_WRITE_COMPLETED",
  AUTHORITATIVE_READBACK_CONFIRMED: "AUTHORITATIVE_READBACK_CONFIRMED",
  FAILED: "FAILED",
  UNKNOWN_OUTCOME: "UNKNOWN_OUTCOME",
  NOOP: "NOOP",
});

const clone = value => value === undefined ? undefined : structuredClone(value);
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function deferred(label = "barrier") {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {label, promise, resolve, reject};
}

export function hashContent(content) {
  return `hash:${content}`;
}

function officialTargetMatches(official, target) {
  const message = official?.chat?.[target.messageIndex];
  return Boolean(message)
    && message.message_id === target.messageId
    && message.floor === target.floor
    && message.swipe_id === target.swipeId
    && message.message_version === target.messageVersion
    && hashContent(message.content) === target.contentHash;
}

export function floorVersion({chatId = "chat-a", messageId = "message-a", floor = 7, swipeId = 0, content = "正文", contentHash = null, messageVersion = 1} = {}) {
  return {
    chat_id: chatId,
    message_id: messageId,
    floor,
    swipe_id: swipeId,
    content_hash: contentHash ?? hashContent(content),
    message_version: messageVersion,
  };
}

export function makeContext({chatId = "chat-a", epoch = 1, floor = 7, content = "正文", messageVersion = 1, swipeId = 0, bioweave = {}} = {}) {
  const version = floorVersion({chatId, floor, content, messageVersion, swipeId});
  const swipes = ["正文", "替代正文"];
  const swipeInfo = swipes.map(() => ({extra: {bioweave: {}}}));
  const initialBioweave = clone(bioweave) ?? {};
  initialBioweave.floor_version ??= version;
  swipeInfo[swipeId].extra.bioweave = initialBioweave;
  return {
    chatId,
    epoch,
    chat: [{
      message_id: version.message_id,
      role: "assistant",
      is_user: false,
      floor,
      content,
      message_version: messageVersion,
      swipe_id: swipeId,
      swipes,
      swipe_info: swipeInfo,
      extra: {
        other_extension: {must_survive: true},
        host_marker: "live",
      },
    }],
    chatMetadata: {chat_id: chatId, unrelated: "preserve"},
  };
}

function currentTarget(context, index) {
  const message = context.chat[index];
  return {
    chatId: context.chatId,
    messageId: message.message_id,
    floor: message.floor,
    swipeId: message.swipe_id,
    messageVersion: message.message_version,
    contentHash: hashContent(message.content),
    epoch: context.epoch,
    messageIndex: index,
  };
}

function currentSlot(context, target) {
  return context.chat[target.messageIndex]?.swipe_info?.[target.swipeId]?.extra?.bioweave;
}

export class NativeFloorHostModel {
  constructor({context, officialByChat, responseMode = "deferred"} = {}) {
    this.context = clone(context ?? makeContext());
    this.officialByChat = new Map([[this.context.chatId, clone(officialByChat ?? this.context)]]);
    this.responseMode = responseMode;
    this.tickets = [];
    this.readbackBarriers = [];
    this.metrics = {
      get: 0,
      save: 0,
      readback: 0,
      waits: [],
      overwrites: [],
      capturedTargets: [],
      finalStates: [],
    };
  }

  latestCharacterIndex() {
    for (let index = this.context.chat.length - 1; index >= 0; index -= 1) {
      const message = this.context.chat[index];
      if (message?.is_user !== true && message?.role !== "user") return index;
    }
    return -1;
  }

  readOfficial(chatId = this.context.chatId) {
    this.metrics.get += 1;
    return clone(this.officialByChat.get(chatId));
  }

  deferReadback(label = "readback") {
    const barrier = deferred(label);
    this.readbackBarriers.push(barrier);
    return barrier;
  }

  async readbackOfficial(chatId = this.context.chatId) {
    this.metrics.get += 1;
    this.metrics.readback += 1;
    const barrier = this.readbackBarriers.shift();
    if (barrier) {
      this.metrics.waits.push(barrier.label);
      await barrier.promise;
    }
    return clone(this.officialByChat.get(chatId));
  }

  mutateOfficial(chatId, mutate, reason = "external-writer") {
    const next = clone(this.officialByChat.get(chatId));
    mutate(next);
    this.officialByChat.set(chatId, next);
    this.metrics.overwrites.push({reason, chatId});
  }

  replaceOfficial(chatId, snapshot, reason = "external-full-chat-writer") {
    this.officialByChat.set(chatId, clone(snapshot));
    this.metrics.overwrites.push({reason, chatId});
  }

  saveChat() {
    this.metrics.save += 1;
    const ticket = {
      chatId: this.context.chatId,
      snapshot: clone(this.context),
      state: STATES.DISPATCHED,
      serverWriteCompleted: false,
      failurePhase: null,
      serverWrite: deferred("server-write"),
      response: deferred("http-response"),
    };
    this.tickets.push(ticket);
    this.metrics.capturedTargets.push({chatId: ticket.chatId, epoch: ticket.snapshot.epoch});
    const result = (async () => {
      this.metrics.waits.push(ticket.serverWrite.label);
      const write = await ticket.serverWrite.promise;
      if (write?.error) {
        ticket.failurePhase = "server-write";
        ticket.state = STATES.FAILED;
        throw write.error;
      }
      if (write?.commit !== false) {
        const previous = this.officialByChat.get(ticket.chatId);
        this.officialByChat.set(ticket.chatId, clone(ticket.snapshot));
        if (previous && !equal(previous, ticket.snapshot)) {
          this.metrics.overwrites.push({reason: "full-chat-save", chatId: ticket.chatId});
        }
        ticket.serverWriteCompleted = true;
        ticket.state = STATES.SERVER_WRITE_COMPLETED;
      }
      this.metrics.waits.push(ticket.response.label);
      const response = await ticket.response.promise;
      if (response?.error) {
        ticket.failurePhase = "response";
        ticket.state = STATES.FAILED;
        throw response.error;
      }
      if (response?.lost) {
        ticket.state = STATES.UNKNOWN_OUTCOME;
        return {state: STATES.UNKNOWN_OUTCOME, ticket};
      }
      ticket.state = STATES.HOST_ACCEPTED;
      return {state: STATES.HOST_ACCEPTED, ticket};
    })();
    ticket.promise = result;
    return result;
  }

  saveChatDebounced() {
    this.metrics.waits.push("debounced-dispatch-no-completion");
    return undefined;
  }

  releaseServerWrite(index = 0, options = {}) {
    const ticket = this.tickets[index];
    assert.ok(ticket, `save ticket ${index} exists`);
    ticket.serverWrite.resolve(options);
  }

  releaseResponse(index = 0, options = {}) {
    const ticket = this.tickets[index];
    assert.ok(ticket, `save ticket ${index} exists`);
    ticket.response.resolve(options);
  }

  switchChat(nextContext) { this.context = clone(nextContext); }
  switchSwipe(index, swipeId) { this.context.chat[index].swipe_id = swipeId; }
  editMessage(index, content) {
    const message = this.context.chat[index];
    message.content = content;
    message.message_version += 1;
  }
  deleteMessage(index) { this.context.chat.splice(index, 1); }
  changeEpoch() { this.context.epoch += 1; }
  mutateContextExtra(index, mutate) { mutate(this.context.chat[index].extra); }
}

function staleError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export class NativeFloorPersistencePrototype {
  constructor(host, {mode = "context-fast", queue = true} = {}) {
    assert.ok(["context-fast", "native-confirmed"].includes(mode));
    this.host = host;
    this.mode = mode;
    this.queue = queue;
    this.queues = new Map();
  }

  captureTarget(index = this.host.latestCharacterIndex()) {
    if (index < 0 || index !== this.host.latestCharacterIndex()) throw staleError("HISTORICAL_FLOOR_WRITE_FORBIDDEN");
    const message = this.host.context.chat[index];
    if (!message || message.is_user === true || message.role === "user") throw staleError("NON_CHARACTER_OWNER");
    const target = currentTarget(this.host.context, index);
    this.host.metrics.capturedTargets.push(clone(target));
    return target;
  }

  assertTarget(target, {allowHistorical = false} = {}) {
    const index = target.messageIndex;
    const actual = this.host.context.chat[index];
    if (this.host.context.chatId !== target.chatId) throw staleError("STALE_CHAT");
    if (this.host.context.epoch !== target.epoch) throw staleError("STALE_EPOCH");
    if (!actual) throw staleError("MESSAGE_DELETED");
    if (actual.message_id !== target.messageId) throw staleError("MESSAGE_OWNER_CHANGED");
    if (actual.floor !== target.floor) throw staleError("FLOOR_CHANGED");
    if (actual.swipe_id !== target.swipeId) throw staleError("STALE_SWIPE");
    if (actual.message_version !== target.messageVersion || hashContent(actual.content) !== target.contentHash) {
      throw staleError("FLOOR_VERSION_STALE");
    }
    if (!allowHistorical && index !== this.host.latestCharacterIndex()) throw staleError("HISTORICAL_FLOOR_WRITE_FORBIDDEN");
  }

  mergeOwnedSnapshot(current, patch, owner = "projection_timing_snapshot") {
    const allowed = ["projection_timing_snapshot", "participant_aggregation_snapshot"];
    if (!allowed.includes(owner)) throw staleError("OWNER_NOT_ALLOWED");
    const next = clone(current ?? {});
    if (patch !== undefined) next[owner] = clone(patch);
    return next;
  }

  async writeFloorPatch({target, owner = "projection_timing_snapshot", patch, allowHistorical = false, useDebounce = false} = {}) {
    this.assertTarget(target, {allowHistorical});
    const message = this.host.context.chat[target.messageIndex];
    const slot = currentSlot(this.host.context, target);
    const next = this.mergeOwnedSnapshot(slot, patch, owner);
    const changed = !equal(slot?.[owner], next[owner]);
    const result = {
      mode: this.mode,
      owner,
      changed,
      getCount: 0,
      saveCount: 0,
      readback: false,
      overwrote: false,
      waits: [],
      state: changed ? STATES.DISPATCHED : STATES.NOOP,
      finalState: changed ? STATES.DISPATCHED : STATES.NOOP,
    };
    if (!changed) {
      if (this.mode === "native-confirmed") {
        const official = await this.host.readbackOfficial(target.chatId);
        result.getCount = 1;
        result.readback = true;
        const officialSlot = official?.chat?.[target.messageIndex]?.swipe_info?.[target.swipeId]?.extra?.bioweave;
        result.finalState = officialTargetMatches(official, target)
          && equal(officialSlot?.[owner], slot?.[owner])
          ? STATES.AUTHORITATIVE_READBACK_CONFIRMED
          : STATES.UNKNOWN_OUTCOME;
        result.state = result.finalState;
      }
      this.host.metrics.finalStates.push(result.finalState);
      return result;
    }
    message.swipe_info[target.swipeId].extra.bioweave = next;
    if (useDebounce) {
      this.host.saveChatDebounced();
      result.state = STATES.UNKNOWN_OUTCOME;
      result.finalState = STATES.UNKNOWN_OUTCOME;
      this.host.metrics.finalStates.push(result.finalState);
      return result;
    }
    const savePromise = this.host.saveChat();
    result.saveCount = 1;
    try {
      const save = await savePromise;
      result.state = save.state;
      if (this.mode === "context-fast") {
        this.assertTarget(target, {allowHistorical});
        result.finalState = save.state;
      } else {
        const official = await this.host.readbackOfficial(target.chatId);
        result.getCount = 1;
        result.readback = true;
        const officialMessage = official?.chat?.[target.messageIndex];
        const officialSlot = officialMessage?.swipe_info?.[target.swipeId]?.extra?.bioweave;
        this.assertTarget(target, {allowHistorical});
        result.finalState = [STATES.HOST_ACCEPTED, STATES.UNKNOWN_OUTCOME].includes(save.state)
          && officialTargetMatches(official, target)
          && equal(officialSlot?.[owner], patch)
          ? STATES.AUTHORITATIVE_READBACK_CONFIRMED
          : STATES.UNKNOWN_OUTCOME;
      }
    } catch (error) {
      const ticket = this.host.tickets.at(-1);
      const outcomeUnknown = ticket?.serverWriteCompleted === true || ticket?.failurePhase === "response";
      result.state = outcomeUnknown ? STATES.UNKNOWN_OUTCOME : STATES.FAILED;
      result.finalState = result.state;
      result.error = error;
    }
    this.host.metrics.finalStates.push(result.finalState);
    if (result.finalState === STATES.FAILED || result.finalState === STATES.UNKNOWN_OUTCOME) return result;
    return result;
  }

  enqueue(key, task) {
    if (!this.queue) return task();
    const previous = this.queues.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    this.queues.set(key, run.catch(() => undefined));
    return run;
  }

  async runTimingAggregation({target, timingPatch, aggregationPatch, aggregationError = null, inputs = null} = {}) {
    const key = `${target.chatId}:${target.messageId}:${target.swipeId}`;
    return this.enqueue(key, async () => {
      const timing = await this.writeFloorPatch({target, owner: "projection_timing_snapshot", patch: timingPatch});
      if (![STATES.HOST_ACCEPTED, STATES.AUTHORITATIVE_READBACK_CONFIRMED, STATES.NOOP].includes(timing.finalState)) {
        return {timing, aggregation: {finalState: STATES.UNKNOWN_OUTCOME}, partialSuccess: false, inputsRead: false};
      }
      const currentInputs = inputs ? clone(inputs()) : null;
      if (aggregationError) {
        return {
          timing,
          aggregation: {owner: "participant_aggregation_snapshot", finalState: STATES.FAILED, error: aggregationError},
          partialSuccess: timing.finalState !== STATES.NOOP,
          inputsRead: true,
          currentInputs,
        };
      }
      const aggregation = await this.writeFloorPatch({target, owner: "participant_aggregation_snapshot", patch: aggregationPatch});
      return {
        timing,
        aggregation,
        partialSuccess: timing.finalState !== STATES.NOOP && aggregation.finalState === STATES.FAILED,
        inputsRead: true,
        currentInputs,
      };
    });
  }
}

export function assertPreservesOwnerSiblings(before, after, {messageIndex = 0, swipeId = 0} = {}) {
  const beforeMessage = before.chat[messageIndex];
  const afterMessage = after.chat[messageIndex];
  assert.deepEqual(afterMessage.extra, beforeMessage.extra);
  for (let index = 0; index < beforeMessage.swipe_info.length; index += 1) {
    if (index === swipeId) continue;
    assert.deepEqual(afterMessage.swipe_info[index], beforeMessage.swipe_info[index]);
  }
}
