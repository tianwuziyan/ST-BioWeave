import {emptyFloor} from "../../storage/schema.js";

export const SAVE_STATES = Object.freeze({
  CLEAN: "CLEAN",
  DIRTY: "DIRTY",
  SAVING: "SAVING",
  HOST_ACCEPTED: "HOST_ACCEPTED",
  CONFIRMED: "CONFIRMED",
  FAILED: "FAILED",
  UNKNOWN: "UNKNOWN",
  STALE: "STALE",
});

export const OWNER_ROOTS = Object.freeze({
  event: Object.freeze(["analysis", "events", "character_registry", "pregnancy_lifecycle_timeline"]),
  world: Object.freeze(["world_model", "world_model_meta"]),
  character: Object.freeze(["character_registry"]),
  tracking: Object.freeze(["tracking_window_timeline"]),
  projection: Object.freeze(["projection_timeline"]),
  timing: Object.freeze(["projection_timing_snapshot"]),
  aggregation: Object.freeze(["participant_aggregation_snapshot"]),
});

const clone = value => value === undefined ? undefined : structuredClone(value);
const hasOwn = (value, key) => Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function error(code, details = {}) {
  const cause = new Error(code);
  cause.code = code;
  Object.assign(cause, details);
  return cause;
}

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
  return `hash:${String(content)}`;
}

export function floorVersion({
  chatId = "chat-a",
  messageId = "message-a",
  floor = 7,
  swipeId = 0,
  content = "正文",
  contentHash = null,
  messageVersion = 1,
} = {}) {
  return {
    chat_id: chatId,
    message_id: messageId,
    floor,
    swipe_id: swipeId,
    content_hash: contentHash ?? hashContent(content),
    message_version: messageVersion,
  };
}

function sameVersion(left, right) {
  const fields = ["chat_id", "message_id", "floor", "swipe_id", "content_hash", "message_version"];
  return fields.every(field => String(left?.[field] ?? "") === String(right?.[field] ?? ""));
}

function snapshotRoot(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && value.schema_version === 1 && Array.isArray(value.items);
}

function validateOwnedRoot(root, value) {
  if (["projection_timing_snapshot", "participant_aggregation_snapshot"].includes(root)
      && !snapshotRoot(value)) {
    throw error("SNAPSHOT_ROOT_INVALID", {root});
  }
}

export function makeTimingItem({
  version,
  timingInstanceId = "timing-1",
  cycleId = "cycle-1",
  sampledOffset = 0.25,
  subjectId = "subject-1",
  sourceEventId = "event-1",
} = {}) {
  return {
    schema_version: 1,
    timing_instance_id: timingInstanceId,
    owner_type: "character",
    subject_id: subjectId,
    mechanism_key: "fertilization",
    cycle_id: cycleId,
    source_event_ids: [sourceEventId],
    source_basis_refs: {[sourceEventId]: {event_id: sourceEventId}},
    reference_story_time: null,
    config_snapshot: {
      schema_version: 1,
      config_version: 1,
      base_min_story_days: 1,
      base_max_story_days: 2,
      variance_ratio: 0.1,
      variance_cap_story_days: 1,
      total_adjustment_cap_story_days: 1,
    },
    base_min_story_days: 1,
    base_max_story_days: 2,
    variance_ratio: 0.1,
    variance_cap_story_days: 1,
    sampled_individual_offset_story_days: sampledOffset,
    state_modifier_story_days: 0,
    total_adjustment_story_days: sampledOffset,
    total_adjustment_cap_story_days: 1,
    effective_min_story_days: Math.max(0, 1 + sampledOffset),
    effective_max_story_days: 2 + sampledOffset,
    world_rule_binding: null,
    created_at_floor_version: clone(version),
    created_at: "2026-10-17T00:00:00.000Z",
  };
}

export function makeAggregationItem({
  version,
  aggregationId = "aggregation-1",
  timingInstanceId = "timing-1",
  cycleId = "cycle-1",
  subjectId = "subject-1",
  sourceEventId = "event-1",
} = {}) {
  return {
    schema_version: 1,
    aggregation_id: aggregationId,
    owner_type: "character",
    subject_id: subjectId,
    pregnancy_id: null,
    mechanism_key: "fertilization",
    cycle_id: cycleId,
    timing_instance_id: timingInstanceId,
    aggregation_trigger_strategy: "at_effective_min",
    status: "succeeded",
    reference_story_time: null,
    aggregation_story_time: null,
    elapsed_story_days: 1,
    effective_min_story_days: 1,
    effective_max_story_days: 2,
    sampled_individual_offset_story_days: 0.25,
    config_snapshot: {
      schema_version: 1,
      config_version: 1,
      base_min_story_days: 1,
      base_max_story_days: 2,
      variance_ratio: 0.1,
      variance_cap_story_days: 1,
      total_adjustment_cap_story_days: 1,
    },
    accepted_exposure_event_ids: [sourceEventId],
    source_basis_refs: {[sourceEventId]: {event_id: sourceEventId}},
    created_at_floor_version: clone(version),
    created_at: "2026-10-17T00:00:00.000Z",
  };
}

export function makeFloor({version, roots = {}} = {}) {
  const floor = emptyFloor();
  floor.floor_version = clone(version);
  floor.analysis = {schema_version: 1, status: "seed"};
  floor.events = [{event_id: "event-seed"}];
  for (const [root, value] of Object.entries(roots)) floor[root] = clone(value);
  return floor;
}

export function makeContext({
  chatId = "chat-a",
  epoch = 1,
  floor = 7,
  messageId = "message-a",
  content = "正文",
  messageVersion = 1,
  swipeId = 0,
  roots = {},
} = {}) {
  const version = floorVersion({chatId, messageId, floor, swipeId, content, messageVersion});
  const floorData = makeFloor({version, roots});
  const swipeZero = {
    content,
    extra: {
      other_swipe_extension: {must_survive: true},
      bioweave: clone(floorData),
    },
  };
  const swipeOne = {
    content: "替代正文",
    extra: {
      other_swipe_extension: {swipe: 1},
      bioweave: makeFloor({
        version: floorVersion({chatId, messageId, floor, swipeId: 1, content: "替代正文", messageVersion}),
        roots: {projection_timing_snapshot: {schema_version: 1, items: []}},
      }),
    },
  };
  const message = {
    message_id: messageId,
    role: "assistant",
    is_user: false,
    floor,
    content,
    message_version: messageVersion,
    swipe_id: swipeId,
    swipes: [content, "替代正文"],
    swipe_info: {0: swipeZero, 1: swipeOne},
    extra: {
      other_extension: {must_survive: true},
      bioweave: clone(floorData),
    },
  };
  return {
    chatId,
    epoch,
    chat: [message],
    chatMetadata: {chat_id: chatId, unrelated: "preserve"},
  };
}

function latestCharacterIndex(context) {
  for (let index = context?.chat?.length - 1; index >= 0; index -= 1) {
    const message = context.chat[index];
    if (message?.is_user !== true && message?.role !== "user") return index;
  }
  return -1;
}

export function resolveFloorTarget(context, target, {allowHistorical = false, checkMessageRef = true} = {}) {
  if (!context || !Array.isArray(context.chat)) throw error("CHAT_CONTEXT_INVALID");
  if (context.chatId !== target?.chatId) throw error("CHAT_ID_STALE");
  if (context.epoch !== target?.epoch) throw error("EPOCH_STALE");
  const index = Number(target?.messageIndex);
  const message = Number.isInteger(index) ? context.chat[index] : null;
  if (!message) throw error("MESSAGE_DELETED");
  if (checkMessageRef && target?.messageRef && message !== target.messageRef) {
    throw error("MESSAGE_OBJECT_REPLACED");
  }
  if (message.is_user === true || message.role === "user") throw error("NON_CHARACTER_OWNER");
  if (!allowHistorical && index !== latestCharacterIndex(context)) {
    throw error("HISTORICAL_FLOOR_WRITE_FORBIDDEN");
  }
  const actualVersion = floorVersion({
    chatId: context.chatId,
    messageId: message.message_id,
    floor: message.floor,
    swipeId: message.swipe_id,
    content: message.content,
    messageVersion: message.message_version,
  });
  if (String(message.message_id) !== String(target.messageId)) throw error("MESSAGE_ID_STALE");
  if (Number(message.floor) !== Number(target.floor)) throw error("FLOOR_STALE");
  if (Number(message.swipe_id) !== Number(target.swipeId)) throw error("SWIPE_STALE");
  if (!sameVersion(actualVersion, target.version ?? target.expectedVersion)) throw error("FLOOR_VERSION_STALE");
  const swipe = message.swipe_info?.[String(target.swipeId)] ?? message.swipe_info?.[target.swipeId];
  if (!swipe || typeof swipe !== "object") throw error("SWIPE_SLOT_MISSING");
  return {index, message, swipe, version: actualVersion};
}

export function mergeSnapshot({currentFloor, historicalFloor = null, owner, patch, inheritMissing = true} = {}) {
  const allowedRoots = OWNER_ROOTS[owner];
  if (!allowedRoots) throw error("SNAPSHOT_OWNER_UNKNOWN", {owner});
  const current = currentFloor && typeof currentFloor === "object" ? currentFloor : {};
  const next = clone(current);
  const patchRecord = patch && typeof patch === "object" ? patch : {};
  const patchRoots = {};
  const singleRoot = allowedRoots.length === 1 ? allowedRoots[0] : null;
  if (singleRoot && (snapshotRoot(patchRecord) || !Object.keys(patchRecord).some(key => allowedRoots.includes(key)))) {
    patchRoots[singleRoot] = patchRecord;
  } else {
    for (const key of Object.keys(patchRecord)) {
      if (!allowedRoots.includes(key)) throw error("SNAPSHOT_ROOT_NOT_ALLOWED", {owner, root: key});
      patchRoots[key] = patchRecord[key];
    }
  }
  if (inheritMissing && historicalFloor && typeof historicalFloor === "object") {
    for (const [root, value] of Object.entries(historicalFloor)) {
      if (!hasOwn(next, root)) next[root] = clone(value);
    }
  }
  for (const root of allowedRoots) {
    if (!hasOwn(next, root) && inheritMissing && hasOwn(historicalFloor, root)) next[root] = clone(historicalFloor[root]);
    if (hasOwn(patchRoots, root)) {
      validateOwnedRoot(root, patchRoots[root]);
      next[root] = clone(patchRoots[root]);
    }
  }
  const changedFields = Object.keys(next).filter(key => !equal(next[key], current[key]))
    .concat(Object.keys(current).filter(key => !hasOwn(next, key)));
  return {snapshot: next, changed: !equal(current, next), changedFields: [...new Set(changedFields)]};
}

function targetFromContext(context, index) {
  const message = context.chat[index];
  return {
    chatId: context.chatId,
    messageIndex: index,
    messageId: message.message_id,
    floor: message.floor,
    swipeId: message.swipe_id,
    epoch: context.epoch,
    version: floorVersion({
      chatId: context.chatId,
      messageId: message.message_id,
      floor: message.floor,
      swipeId: message.swipe_id,
      content: message.content,
      messageVersion: message.message_version,
    }),
    messageRef: message,
  };
}

function hostError(code, details = {}) { return error(code, details); }

export class ContextHostModel {
  constructor({context, officialByChat = null} = {}) {
    this.context = clone(context ?? makeContext());
    this.officialByChat = new Map([[this.context.chatId, clone(officialByChat ?? this.context)]]);
    this.tickets = [];
    this.readbackBarriers = [];
    this.metrics = {
      get: 0,
      save: 0,
      readback: 0,
      merge: 0,
      queueWait: 0,
      overwrites: [],
      waits: [],
      capturedTargets: [],
    };
  }

  latestCharacterIndex() { return latestCharacterIndex(this.context); }

  captureTarget(index = this.latestCharacterIndex()) {
    if (index < 0) throw error("NO_CHARACTER_FLOOR");
    return targetFromContext(this.context, index);
  }

  saveChat() {
    this.metrics.save += 1;
    const ticket = {
      chatId: this.context.chatId,
      snapshot: clone(this.context),
      serverWrite: deferred("server-write"),
      response: deferred("http-response"),
      serverWriteCompleted: false,
    };
    this.tickets.push(ticket);
    this.metrics.capturedTargets.push({chatId: ticket.chatId, epoch: ticket.snapshot.epoch});
    ticket.promise = (async () => {
      this.metrics.waits.push(ticket.serverWrite.label);
      const write = await ticket.serverWrite.promise;
      if (write?.error) throw hostError("HOST_SAVE_FAILED", {cause: write.error, serverWriteCompleted: false});
      if (write?.commit !== false) {
        const previous = this.officialByChat.get(ticket.chatId);
        this.officialByChat.set(ticket.chatId, clone(ticket.snapshot));
        if (previous && !equal(previous, ticket.snapshot)) this.metrics.overwrites.push({reason: "full-chat-save", chatId: ticket.chatId});
        ticket.serverWriteCompleted = true;
      }
      this.metrics.waits.push(ticket.response.label);
      const response = await ticket.response.promise;
      if (response?.lost || response?.unknown) {
        throw hostError("HOST_SAVE_UNKNOWN", {serverWriteCompleted: ticket.serverWriteCompleted});
      }
      if (response?.error) {
        if (response.uncertain || ticket.serverWriteCompleted) throw hostError("HOST_SAVE_UNKNOWN", {serverWriteCompleted: ticket.serverWriteCompleted, cause: response.error});
        throw hostError("HOST_SAVE_FAILED", {serverWriteCompleted: false, cause: response.error});
      }
      return {state: SAVE_STATES.HOST_ACCEPTED, serverWriteCompleted: ticket.serverWriteCompleted};
    })();
    return ticket.promise;
  }

  saveChatDebounced() {
    this.metrics.waits.push("debounced-dispatch-without-result");
    return undefined;
  }

  deferReadback(label = "readback") {
    const barrier = deferred(label);
    this.readbackBarriers.push(barrier);
    return barrier;
  }

  async readback(chatId = this.context.chatId) {
    this.metrics.get += 1;
    this.metrics.readback += 1;
    const barrier = this.readbackBarriers.shift();
    if (barrier) {
      this.metrics.waits.push(barrier.label);
      await barrier.promise;
    }
    return clone(this.officialByChat.get(chatId));
  }

  releaseServerWrite(index = 0, options = {}) { this.tickets[index].serverWrite.resolve(options); }
  releaseResponse(index = 0, options = {}) { this.tickets[index].response.resolve(options); }

  mutateOfficial(chatId, mutate, reason = "external-writer") {
    const current = clone(this.officialByChat.get(chatId));
    mutate(current);
    this.officialByChat.set(chatId, current);
    this.metrics.overwrites.push({reason, chatId});
  }

  replaceOfficial(chatId, snapshot, reason = "external-full-chat-writer") {
    this.officialByChat.set(chatId, clone(snapshot));
    this.metrics.overwrites.push({reason, chatId});
  }

  switchChat(nextContext) {
    this.context = clone(nextContext);
    if (!this.officialByChat.has(this.context.chatId)) this.officialByChat.set(this.context.chatId, clone(this.context));
  }

  switchSwipe(index, swipeId) { this.context.chat[index].swipe_id = swipeId; }

  editMessage(index, content) {
    const message = this.context.chat[index];
    message.content = content;
    message.message_version += 1;
  }

  deleteMessage(index) { this.context.chat.splice(index, 1); }
  changeEpoch() { this.context.epoch += 1; }
  replaceMessage(index, message) { this.context.chat[index] = clone(message); }
  mutateContextExtra(index, mutate) { mutate(this.context.chat[index].extra); }
  mutateContextFloor(index, mutate) { mutate(this.context.chat[index].swipe_info[this.context.chat[index].swipe_id].extra.bioweave); }
}

function operationDelta(metrics, start) {
  return {
    get: metrics.get - start.get,
    save: metrics.save - start.save,
    readback: metrics.readback - start.readback,
  };
}

function statusResult(status, start, host, details = {}) {
  return {
    status,
    ...details,
    requestCounts: operationDelta(host.metrics, start),
  };
}

function rootFor(owner) {
  const roots = OWNER_ROOTS[owner];
  return roots?.length === 1 ? roots[0] : null;
}

function asOwnerPatch(owner, value) {
  const root = rootFor(owner);
  if (!root) return value;
  return snapshotRoot(value) ? {[root]: value} : value;
}

function readCurrentFloor(target) {
  const root = target.swipe.extra?.bioweave;
  return root && typeof root === "object"
    ? clone(root)
    : {v: 1, floor_version: clone(target.version)};
}

function readbackMatches(snapshot, target, expectedFloor) {
  if (!snapshot) return {ok: false, reason: "READBACK_EMPTY"};
  let resolved;
  try {
    resolved = resolveFloorTarget(snapshot, target, {allowHistorical: true, checkMessageRef: false});
  } catch (cause) {
    return {ok: false, reason: cause.code ?? cause.message};
  }
  const actualFloor = resolved.swipe.extra?.bioweave;
  const actualMirror = resolved.message.extra?.bioweave;
  if (!equal(actualFloor, expectedFloor) || !equal(actualMirror, expectedFloor)) {
    return {ok: false, reason: "READBACK_PAYLOAD_MISMATCH"};
  }
  return {ok: true};
}

export class ContextFloorWriter {
  constructor(host, {mode = "context-fast", queue = true} = {}) {
    if (!["context-fast", "native-confirmed"].includes(mode)) throw new TypeError("WRITER_MODE_INVALID");
    this.host = host;
    this.mode = mode;
    this.queue = queue;
    this.queues = new Map();
    this.metrics = {mergeCount: 0, queueWait: 0, states: []};
  }

  captureTarget(index = this.host.latestCharacterIndex()) { return this.host.captureTarget(index); }

  write({target, owner, patch, historicalFloor = null, inheritMissing = true} = {}) {
    const key = [target?.chatId, target?.messageId, target?.floor, target?.swipeId].join("/");
    const execute = () => this.#writeNow({target, owner, patch, historicalFloor, inheritMissing});
    if (!this.queue) return execute();
    const previous = this.queues.get(key);
    if (previous) {
      this.metrics.queueWait += 1;
      this.host.metrics.queueWait += 1;
    }
    const current = (previous ?? Promise.resolve()).catch(() => undefined).then(execute);
    this.queues.set(key, current);
    current.then(
      () => { if (this.queues.get(key) === current) this.queues.delete(key); },
      () => { if (this.queues.get(key) === current) this.queues.delete(key); },
    );
    return current;
  }

  async #writeNow({target, owner, patch, historicalFloor, inheritMissing}) {
    const start = {get: this.host.metrics.get, save: this.host.metrics.save, readback: this.host.metrics.readback};
    let resolved;
    try {
      resolved = resolveFloorTarget(this.host.context, target);
    } catch (cause) {
      this.metrics.states.push(SAVE_STATES.STALE);
      return statusResult(SAVE_STATES.STALE, start, this.host, {errorCode: cause.code ?? cause.message, changed: false, confirmed: false});
    }
    const currentFloor = readCurrentFloor(resolved);
    if (currentFloor.floor_version && !sameVersion(currentFloor.floor_version, target.version)) {
      this.metrics.states.push(SAVE_STATES.STALE);
      return statusResult(SAVE_STATES.STALE, start, this.host, {errorCode: "FLOOR_VERSION_STALE", changed: false, confirmed: false});
    }
    let merged;
    try {
      merged = mergeSnapshot({currentFloor, historicalFloor, owner, patch: asOwnerPatch(owner, patch), inheritMissing});
    } catch (cause) {
      this.metrics.states.push(SAVE_STATES.STALE);
      return statusResult(SAVE_STATES.STALE, start, this.host, {errorCode: cause.code ?? cause.message, changed: false, confirmed: false});
    }
    this.host.metrics.merge += 1;
    this.metrics.mergeCount += 1;
    const mirrorMismatch = !equal(resolved.message.extra?.bioweave, currentFloor);
    if (!merged.changed && !mirrorMismatch) {
      if (this.mode === "context-fast") {
        this.metrics.states.push(SAVE_STATES.CLEAN);
        return statusResult(SAVE_STATES.CLEAN, start, this.host, {changed: false, confirmed: false, readbackRequired: false});
      }
      return this.#confirm(target, merged.snapshot, start, {changed: false});
    }
    const beforeFloor = clone(currentFloor);
    const beforeMirror = clone(resolved.message.extra?.bioweave);
    resolved.message.extra ??= {};
    resolved.message.extra.bioweave = clone(merged.snapshot);
    resolved.swipe.extra ??= {};
    resolved.swipe.extra.bioweave = clone(merged.snapshot);
    this.metrics.states.push(SAVE_STATES.DIRTY, SAVE_STATES.SAVING);
    let saveObservation;
    try {
      saveObservation = await this.host.saveChat();
    } catch (cause) {
      if (cause.code === "HOST_SAVE_UNKNOWN") {
        this.metrics.states.push(SAVE_STATES.UNKNOWN);
        return statusResult(SAVE_STATES.UNKNOWN, start, this.host, {changed: true, confirmed: false, errorCode: cause.code, persistenceOutcome: "UNKNOWN", readbackRequired: true});
      }
      let canRestore = true;
      try {
        const live = resolveFloorTarget(this.host.context, target);
        canRestore = equal(live.swipe.extra?.bioweave, merged.snapshot);
        if (canRestore) {
          live.swipe.extra.bioweave = clone(beforeFloor);
          live.message.extra ??= {};
          if (beforeMirror === undefined) delete live.message.extra.bioweave;
          else live.message.extra.bioweave = clone(beforeMirror);
        }
      } catch { canRestore = false; }
      this.metrics.states.push(canRestore ? SAVE_STATES.FAILED : SAVE_STATES.STALE);
      return statusResult(canRestore ? SAVE_STATES.FAILED : SAVE_STATES.STALE, start, this.host, {changed: true, confirmed: false, errorCode: cause.code ?? cause.message, persistenceOutcome: "FAILED", readbackRequired: false});
    }
    try {
      resolveFloorTarget(this.host.context, target);
    } catch (cause) {
      this.metrics.states.push(SAVE_STATES.STALE);
      return statusResult(SAVE_STATES.STALE, start, this.host, {changed: true, confirmed: false, errorCode: cause.code ?? cause.message, persistenceOutcome: "UNKNOWN", readbackRequired: true});
    }
    this.metrics.states.push(SAVE_STATES.HOST_ACCEPTED);
    if (this.mode === "context-fast") {
      return statusResult(SAVE_STATES.HOST_ACCEPTED, start, this.host, {changed: true, confirmed: false, readbackRequired: true, serverWriteCompleted: saveObservation?.serverWriteCompleted === true});
    }
    return this.#confirm(target, merged.snapshot, start, {changed: true, serverWriteCompleted: saveObservation?.serverWriteCompleted === true});
  }

  async #confirm(target, expectedFloor, start, details = {}) {
    let official;
    try {
      official = await this.host.readback(target.chatId);
    } catch (cause) {
      this.metrics.states.push(SAVE_STATES.UNKNOWN);
      return statusResult(SAVE_STATES.UNKNOWN, start, this.host, {...details, confirmed: false, errorCode: cause.code ?? cause.message, persistenceOutcome: "UNKNOWN", readbackRequired: true});
    }
    const comparison = readbackMatches(official, target, expectedFloor);
    if (!comparison.ok) {
      this.metrics.states.push(SAVE_STATES.UNKNOWN);
      return statusResult(SAVE_STATES.UNKNOWN, start, this.host, {...details, confirmed: false, errorCode: comparison.reason, persistenceOutcome: "UNKNOWN", readbackRequired: true, readbackMismatch: comparison.reason});
    }
    try {
      resolveFloorTarget(this.host.context, target);
    } catch (cause) {
      this.metrics.states.push(SAVE_STATES.STALE);
      return statusResult(SAVE_STATES.STALE, start, this.host, {...details, confirmed: false, errorCode: cause.code ?? cause.message, persistenceOutcome: "UNKNOWN", readbackRequired: true});
    }
    this.metrics.states.push(SAVE_STATES.CONFIRMED);
    return statusResult(SAVE_STATES.CONFIRMED, start, this.host, {...details, confirmed: true, persistenceOutcome: "CONFIRMED", readbackRequired: true});
  }

  async runTimingAggregation({target, timingPatch, aggregationPatch, inputs = () => ({}), aggregationError = null} = {}) {
    const timing = await this.write({target, owner: "timing", patch: timingPatch});
    if (![SAVE_STATES.CONFIRMED, SAVE_STATES.CLEAN].includes(timing.status)) {
      return {
        timing,
        aggregation: {status: SAVE_STATES.STALE, errorCode: "TIMING_NOT_CONFIRMED", skipped: true},
        partialSuccess: false,
        finalStatus: timing.status === SAVE_STATES.UNKNOWN ? SAVE_STATES.UNKNOWN : SAVE_STATES.STALE,
      };
    }
    let currentInputs;
    try {
      currentInputs = inputs(this.host.context);
    } catch (cause) {
      return {
        timing,
        aggregation: {status: SAVE_STATES.FAILED, errorCode: cause.code ?? cause.message, skipped: true},
        partialSuccess: true,
        finalStatus: SAVE_STATES.FAILED,
      };
    }
    if (aggregationError) {
      return {
        timing,
        aggregation: {status: SAVE_STATES.FAILED, errorCode: aggregationError.code ?? aggregationError.message, skipped: true},
        currentInputs,
        partialSuccess: true,
        finalStatus: SAVE_STATES.FAILED,
      };
    }
    const aggregation = await this.write({target, owner: "aggregation", patch: typeof aggregationPatch === "function" ? aggregationPatch(currentInputs) : aggregationPatch});
    return {
      timing,
      aggregation,
      currentInputs,
      partialSuccess: timing.status === SAVE_STATES.CONFIRMED && aggregation.status === SAVE_STATES.FAILED,
      finalStatus: aggregation.status,
    };
  }
}
