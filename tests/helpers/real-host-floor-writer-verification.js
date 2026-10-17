// Test-only seams for Phase A host verification. Do not import this from production code.

export const SAVE_STATES = Object.freeze({
  DISPATCHED: "DISPATCHED",
  HOST_ACCEPTED: "HOST_ACCEPTED",
  CONFIRMED: "CONFIRMED",
  FAILED: "FAILED",
  UNKNOWN: "UNKNOWN",
  STALE: "STALE",
});

export const SNAPSHOT_ROOTS = Object.freeze({
  timing: "projection_timing_snapshot",
  aggregation: "participant_aggregation_snapshot",
});

const VERSION_FIELDS = ["chat_id", "message_id", "floor", "swipe_id", "content_hash", "message_version"];
const clone = value => value === undefined ? undefined : structuredClone(value);
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function failure(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function contextChatId(context) {
  return context?.chatId ?? context?.chat_id ?? context?.chatMetadata?.chat_id ?? null;
}

function messageVersion(message) {
  return {
    chat_id: message?.chat_id ?? null,
    message_id: message?.message_id ?? message?.id ?? null,
    floor: message?.floor ?? null,
    swipe_id: message?.swipe_id ?? 0,
    content_hash: message?.content_hash ?? `hash:${String(message?.content ?? "")}`,
    message_version: message?.message_version ?? 1,
  };
}

function sameVersion(left, right) {
  return VERSION_FIELDS.every(field => String(left?.[field] ?? "") === String(right?.[field] ?? ""));
}

function isCharacter(message) {
  if (!message || message.is_user === true || message.role === "user" || message.extra?.type === "user") return false;
  if (message.is_system === true) return false;
  if (["narrator", "comment", "system"].includes(message.extra?.type)) return false;
  return !message.role || ["assistant", "character"].includes(message.role);
}

function currentSwipe(message) {
  const id = message?.swipe_id ?? 0;
  return message?.swipe_info?.[id] ?? message?.swipe_info?.[String(id)] ?? null;
}

function validRoot(root) {
  return Boolean(root) && typeof root === "object" && !Array.isArray(root)
    && root.schema_version === 1 && Array.isArray(root.items);
}

export function summarizeHostContext(context) {
  const messages = Array.isArray(context?.chat) ? context.chat : [];
  return {
    hostUrl: context?.hostUrl ?? context?.url ?? null,
    hostVersion: context?.version ?? context?.buildVersion ?? null,
    chatId: contextChatId(context),
    epoch: context?.epoch ?? null,
    messageCount: messages.length,
    messages: messages.map((message, index) => ({
      index,
      messageId: message?.message_id ?? message?.id ?? null,
      floor: message?.floor ?? null,
      role: message?.is_user === true ? "user" : message?.extra?.type ?? message?.role ?? "unknown",
      isUser: message?.is_user === true,
      swipeId: message?.swipe_id ?? null,
      hasExtra: Boolean(message?.extra),
      hasSwipeInfo: Boolean(message?.swipe_info),
      bioweaveRoots: Object.keys(message?.extra?.bioweave ?? {}),
      activeSwipeBioweaveRoots: Object.keys(currentSwipe(message)?.extra?.bioweave ?? {}),
    })),
    interfaces: {
      getContext: typeof context?.getContext === "function",
      saveChat: typeof context?.saveChat === "function",
      saveChatDebounced: typeof context?.saveChatDebounced === "function",
    },
  };
}

export function assertDedicatedTempChatTarget(target, proof) {
  if (!proof?.dedicated || proof.chatId !== proof.createdChatId || !proof.creationToken) {
    throw failure("DEDICATED_TEMP_CHAT_PROOF_REQUIRED");
  }
  if (!target?.chatId || target.chatId !== proof.chatId || target.chatId !== target.dedicatedChatId) {
    throw failure("DEDICATED_TEMP_CHAT_ID_MISMATCH");
  }
  if (target.targetToken !== proof.targetToken || !target.targetToken) {
    throw failure("DEDICATED_TARGET_TOKEN_MISMATCH");
  }
  return true;
}

export function assertTargetCurrent(context, target) {
  const chatId = contextChatId(context);
  const index = Number(target?.messageIndex);
  const message = Number.isInteger(index) ? context?.chat?.[index] : null;
  if (!message) throw failure("MESSAGE_MISSING");
  if (chatId !== target.chatId) throw failure("CHAT_ID_STALE");
  if (context?.epoch !== target.epoch) throw failure("EPOCH_STALE");
  if (!isCharacter(message)) throw failure("NON_CHARACTER_OWNER");
  if (message !== target.messageRef) throw failure("MESSAGE_OBJECT_REPLACED");
  const activeSwipeId = message?.swipe_id ?? 0;
  const targetSwipeId = target?.swipeId ?? target?.version?.swipe_id;
  if (String(activeSwipeId) !== String(targetSwipeId)) throw failure("ACTIVE_SWIPE_STALE");
  const actual = {...messageVersion(message), chat_id: chatId};
  if (!sameVersion(actual, target.version)) throw failure("FLOOR_VERSION_STALE");
  const swipe = currentSwipe(message);
  if (!swipe) throw failure("ACTIVE_SWIPE_SLOT_MISSING");
  return {index, message, swipe, version: actual};
}

export function buildProbeSnapshot(version, kind = "timing", items = []) {
  if (!SNAPSHOT_ROOTS[kind]) throw failure("SNAPSHOT_KIND_INVALID");
  if (!version || !VERSION_FIELDS.every(field => version[field] !== undefined && version[field] !== null)) {
    throw failure("FLOOR_VERSION_INCOMPLETE");
  }
  return {schema_version: 1, items: clone(items)};
}

export function createRequestRecorder() {
  const events = [];
  return {
    record(event) { events.push({at: event?.at ?? "injected", ...clone(event)}); },
    count(path, initiator) {
      return events.filter(event => event.path === path && (initiator === undefined || event.initiator === initiator)).length;
    },
    snapshot() { return clone(events); },
    counts() {
      return events.reduce((result, event) => {
        if (event.path === "/api/chats/get") result.get += 1;
        else if (event.path === "/api/chats/save") result.save += 1;
        return result;
      }, {get: 0, save: 0});
    },
  };
}

function readOwnedRoot(context, target, kind) {
  const resolved = assertTargetCurrent(context, target);
  const root = SNAPSHOT_ROOTS[kind];
  return resolved.swipe.extra?.bioweave?.[root];
}

export function applySnapshotProbe(context, {target, proof, kind, snapshot, allowWrite = false} = {}) {
  assertDedicatedTempChatTarget(target, proof);
  const resolved = assertTargetCurrent(context, target);
  const root = SNAPSHOT_ROOTS[kind];
  if (!root || !validRoot(snapshot)) throw failure("SNAPSHOT_ROOT_INVALID", {root});
  if (!allowWrite) return {mode: "dry-run", root, current: clone(readOwnedRoot(context, target, kind)), changed: true};
  const nextFloor = {...(resolved.swipe.extra?.bioweave ?? {}), [root]: clone(snapshot)};
  const nextMirror = {...(resolved.message.extra?.bioweave ?? {}), [root]: clone(snapshot)};
  resolved.swipe.extra = {...(resolved.swipe.extra ?? {}), bioweave: nextFloor};
  resolved.message.extra = {...(resolved.message.extra ?? {}), bioweave: nextMirror};
  return {mode: "write", root, payload: clone(snapshot), mirrorEqual: equal(nextFloor[root], nextMirror[root])};
}

export function classifyPersistenceOutcome({saveError = null, saveReturned = false, readback, refreshed, target, expected, currentContext} = {}) {
  if (currentContext && target) {
    try { assertTargetCurrent(currentContext, target); } catch (error) {
      return {status: SAVE_STATES.STALE, confirmed: false, errorCode: error.code};
    }
  }
  if (saveError) return {status: saveError.uncertain ? SAVE_STATES.UNKNOWN : SAVE_STATES.FAILED, confirmed: false, errorCode: saveError.code ?? "HOST_SAVE_FAILED"};
  if (!saveReturned) return {status: SAVE_STATES.UNKNOWN, confirmed: false, errorCode: "SAVE_RESPONSE_MISSING"};
  if (!readback) return {status: SAVE_STATES.HOST_ACCEPTED, confirmed: false, readbackRequired: true};
  if (!equal(readback, expected)) return {status: SAVE_STATES.UNKNOWN, confirmed: false, errorCode: "READBACK_PAYLOAD_MISMATCH"};
  if (refreshed !== true) return {status: SAVE_STATES.HOST_ACCEPTED, confirmed: false, errorCode: "REFRESH_NOT_VERIFIED"};
  return {status: SAVE_STATES.CONFIRMED, confirmed: true};
}

export function createHostProbeRunner({getContext, saveChat, saveChatDebounced, readback, refresh, recorder = createRequestRecorder(), proof} = {}) {
  return {
    inspect() {
      const context = getContext?.();
      recorder.record({kind: "context", initiator: "writer"});
      return summarizeHostContext(context);
    },
    async run({target, kind = "timing", snapshot, allowWrite = false} = {}) {
      const context = getContext?.();
      assertDedicatedTempChatTarget(target, proof);
      assertTargetCurrent(context, target);
      const probe = applySnapshotProbe(context, {target, proof, kind, snapshot, allowWrite});
      if (!allowWrite) return {status: "DRY_RUN", probe, requestCounts: recorder.counts()};
      recorder.record({path: "/api/chats/save", initiator: "writer"});
      let saveReturned = false;
      let saveError = null;
      try {
        const result = await saveChat?.();
        saveReturned = result !== undefined || typeof saveChat === "function";
      } catch (error) { saveError = error; }
      if (saveError) return {status: classifyPersistenceOutcome({saveError, target, currentContext: getContext?.()}).status, errorCode: saveError.code};
      if (typeof readback !== "function") {
        const result = classifyPersistenceOutcome({saveReturned, target, currentContext: getContext?.()});
        return {...result, requestCounts: recorder.counts()};
      }
      recorder.record({path: "/api/chats/get", initiator: "writer"});
      const official = await readback(target.chatId);
      const refreshedValue = typeof refresh === "function" ? await refresh() : false;
      const result = classifyPersistenceOutcome({saveReturned, readback: official, refreshed: refreshedValue, target, expected: snapshot, currentContext: getContext?.()});
      return {...result, requestCounts: recorder.counts()};
    },
    dispatchDebounced() {
      recorder.record({kind: "debounced-save", initiator: "writer"});
      return saveChatDebounced?.();
    },
    recorder,
  };
}

export function makeHostProbeSource({allowWrite = false} = {}) {
  return `(async function (input) {\n`+
    `  const context = globalThis.SillyTavern?.getContext?.();\n`+
    `  if (!context) return { status: "HOST_CONTEXT_UNAVAILABLE" };\n`+
    `  if (!${allowWrite ? "true" : "false"} || input?.allowWrite !== true || input?.proof?.dedicated !== true || input?.proof?.chatId !== input?.proof?.createdChatId || !input?.proof?.creationToken || input?.target?.chatId !== input?.proof?.chatId || input?.target?.dedicatedChatId !== input?.proof?.chatId || !input?.target?.targetToken || input?.target?.targetToken !== input?.proof?.targetToken) return { status: "DRY_RUN", messageCount: context.chat?.length ?? 0 };\n`+
    `  return { status: "WRITE_REQUIRES_INJECTED_RUNNER", allowWrite: true };\n`+
    `})(globalThis.__BIOWEAVE_HOST_PROBE_INPUT__);`;
}
