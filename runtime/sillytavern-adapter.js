import {cloneValue} from "../storage/schema.js";
import {hasSwipeSlot, hasSwipeStructure} from "../storage/store.js";
import {hashText} from "./floor.js";

const SOURCE_OWNER_LATEST_MERGE = true;

function ownerId(value) {
  const raw =
    typeof value === "string"
      ? value
      : value?.chatId ?? value?.chat_id ?? value?.owner?.chatId ?? value?.owner?.chat_id;
  return typeof raw === "string" ? raw.trim() : raw ?? null;
}

function chatIdKey(value) {
  const id = ownerId(value);
  return id == null ? null : String(id).replace(/\.jsonl$/iu, "");
}

function ownerKey(context, owner = {}) {
  const identity = ownerIdentityFromContext(context);
  const characterId = owner?.characterId ?? owner?.character_id ?? identity.characterId;
  const groupId = owner?.groupId ?? owner?.group_id ?? identity.groupId;
  const character = characterForOwner(context, owner);
  return `${groupId ?? ""}|${characterId ?? ""}|${character?.avatar_url ?? ""}`;
}

function ownerIdentityFromContext(context) {
  const custom = context?.getChatOwnerIdentity?.();
  const source = custom && typeof custom === "object" ? custom : context;
  return {
    characterId:
      source?.characterId ??
      source?.character_id ??
      source?.activeCharacterId ??
      source?.active_character_id ??
      null,
    groupId:
      source?.groupId ??
      source?.group_id ??
      source?.activeGroupId ??
      source?.active_group_id ??
      null,
  };
}

function characterForOwner(context, owner = {}) {
  const identity = ownerIdentityFromContext(context);
  const characterId = owner?.characterId ?? owner?.character_id ?? identity.characterId;
  const characters = context?.characters;
  const character =
    (characters && characterId != null ? characters[characterId] : null) ??
    context?.character ??
    context?.characterCard ??
    null;
  const name =
    owner?.characterName ??
    owner?.character_name ??
    character?.name ??
    (String(characterId) === String(identity.characterId) ? context?.name2 : null);
  const avatar =
    owner?.avatarUrl ??
    owner?.avatar_url ??
    character?.avatar ??
    context?.avatar_url ??
    context?.avatarUrl;
  if (typeof name !== "string" || !name.trim()) return null;
  if (typeof avatar !== "string" || !avatar.trim()) return null;
  return {
    characterId,
    groupId: identity.groupId,
    ch_name: name,
    avatar_url: avatar,
  };
}

function sourceRequestHeaders(context) {
  let headers = {};
  try {
    headers = context?.getRequestHeaders?.() ?? {};
  } catch {
    headers = {};
  }
  const contentType = Object.keys(headers).find(
    (key) => key.toLowerCase() === "content-type",
  );
  return contentType
    ? headers
    : { ...headers, "Content-Type": "application/json" };
}

function sourceError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function cloneOwnerValue(value) {
  return cloneValue(value);
}

function stableOwnerValue(value) {
  if (Array.isArray(value)) return value.map(stableOwnerValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableOwnerValue(value[key])]),
  );
}

function sourceDescriptor(context, owner = {}) {
  const chatId = ownerId(owner);
  if (!chatId) throw sourceError("SOURCE_OWNER_REQUIRED");
  const identity = ownerIdentityFromContext(context);
  const groupId = owner?.groupId ?? owner?.group_id ?? identity.groupId;
  const characterId = owner?.characterId ?? owner?.character_id;
  if (
    characterId != null &&
    identity.characterId != null &&
    String(characterId) !== String(identity.characterId)
  ) {
    throw sourceError("SOURCE_OWNER_IDENTITY_MISMATCH");
  }
  if (
    groupId != null &&
    identity.groupId != null &&
    String(groupId) !== String(identity.groupId)
  ) {
    throw sourceError("SOURCE_OWNER_IDENTITY_MISMATCH");
  }
  if (groupId != null && String(groupId).trim())
    throw sourceError("SOURCE_OWNER_GROUP_UNSUPPORTED");
  const character = characterForOwner(context, owner);
  if (!character) throw sourceError("SOURCE_OWNER_CHARACTER_UNAVAILABLE");
  return {
    chatId,
    apiFileName: String(chatId).replace(/\.jsonl$/iu, ""),
    characterId: character.characterId,
    groupId: null,
    ch_name: character.ch_name,
    avatar_url: character.avatar_url,
  };
}

export function createSillyTavernAdapter() {
  const getContext = () => globalThis.SillyTavern?.getContext?.() ?? null;
  let chatIndexCache = null;
  let chatIndexOwnerKey = null;
  let officialIoSequence = 0;

  const monotonicNow = () => typeof globalThis.performance?.now === "function"
    ? globalThis.performance.now()
    : Date.now();
  const elapsedMs = startedAt => Math.max(0, Math.round((monotonicNow() - startedAt) * 10) / 10);
  const nextOfficialIoCallId = () => `official-io-${++officialIoSequence}`;
  const emitOfficialIo = (owner, metric) => {
    try {
      owner?.officialIoTrace?.({
        ...(owner?.officialIoContext && typeof owner.officialIoContext === "object"
          ? owner.officialIoContext
          : {}),
        stage: "OFFICIAL_CHAT_IO",
        ...metric,
      });
    } catch {
      // Official I/O diagnostics are fail-open and never alter persistence.
    }
  };
  const createOfficialIoMetric = (owner, endpointKind, ioPurpose) => ({
    io_call_id: nextOfficialIoCallId(),
    io_purpose: ioPurpose ?? owner?.officialIoContext?.io_purpose ?? "UNSPECIFIED",
    endpoint_kind: endpointKind,
    actual_network_request: false,
    cache_status: "NOT_USED",
    request_prepare_duration_ms: null,
    network_wait_duration_ms: null,
    response_body_read_duration_ms: null,
    json_parse_duration_ms: null,
    response_parse_duration_ms: null,
    response_normalize_duration_ms: null,
    source_revision_duration_ms: null,
    total_duration_ms: null,
    status: "ATTEMPTED",
    reason_code: null,
    error_code: null,
  });

  function hostMessageAt(messageIndex) {
    const context = getContext();
    const message = context?.chat?.[messageIndex];
    if (!message) throw sourceError("MESSAGE_NOT_FOUND");
    return {context, message};
  }

  function readHostFloorSlot({messageIndex, swipeIndex = 0} = {}) {
    const {context, message} = hostMessageAt(messageIndex);
    const slot = hasSwipeStructure(message)
      ? message?.swipe_info?.[swipeIndex]?.extra?.bioweave
      : message?.extra?.bioweave;
    return {context, message, slot};
  }

  function writeHostFloorSlot({messageIndex, swipeIndex = 0, bioweave} = {}) {
    const {context, message} = hostMessageAt(messageIndex);
    if (hasSwipeStructure(message)) {
      const canCreateInitialSwipe = Number(swipeIndex) === 0
        && (Number.isInteger(message?.swipe_id) ? message.swipe_id : 0) === 0
        && Boolean(
          message?.swipes?.[0] ??
          message?.mes ??
          message?.content ??
          message?.swipe_info?.[0]?.mes,
        );
      if (!hasSwipeSlot(message, swipeIndex) && !canCreateInitialSwipe)
        throw sourceError("SWIPE_NOT_FOUND");
      message.swipe_info ??= [];
      message.swipe_info[swipeIndex] ??= {};
      message.swipe_info[swipeIndex].extra ??= {};
      message.swipe_info[swipeIndex].extra.bioweave = cloneValue(bioweave);
      // Keep the current message mirror in sync only for the active Swipe;
      // writing a non-active slot must not make it look current to readers.
      const activeSwipeId = Number.isInteger(message?.swipe_id) ? message.swipe_id : 0;
      if (Number(swipeIndex) === activeSwipeId) {
        message.extra ??= {};
        message.extra.bioweave = cloneValue(bioweave);
      }
    } else {
      message.extra ??= {};
      message.extra.bioweave = cloneValue(bioweave);
    }
    return {
      context,
      message,
      slot: hasSwipeStructure(message)
        ? message?.swipe_info?.[swipeIndex]?.extra?.bioweave
        : message?.extra?.bioweave,
      mutationApplied: true,
    };
  }

  function subscribeLifecycle({eventTypes, handlers, trace} = {}) {
    const context = getContext();
    const source = context?.eventSource;
    const types = eventTypes ?? context?.eventTypes;
    if (
      !source ||
      typeof source.on !== "function" ||
      typeof source.removeListener !== "function" ||
      !handlers ||
      typeof handlers !== "object"
    ) {
      return () => {};
    }
    const listeners = [];
    const boundEventTypes = new Set();
    for (const [key, handler] of Object.entries(handlers)) {
      const eventType = types?.[key];
      if (
        eventType == null ||
        boundEventTypes.has(eventType) ||
        typeof handler !== "function"
      ) continue;
      // SillyTavern invokes event listeners from its own lifecycle pipeline.
      // Do not return BioWeave's internal async work to that pipeline: a host
      // event emitter may await the listener and make the whole ST page wait
      // for API, persistence, or cancellation work. The runtime keeps its
      // own ordering in lifecycleTail; this adapter boundary is deliberately
      // fire-and-forget.
      const listener = (payload) => {
        const startedAt = monotonicNow();
        const generationIdentity = {
          generation_id: payload?.generation_id ?? payload?.generationId ?? null,
          generation_intent_id: payload?.generation_intent_id ?? payload?.generationIntentId ?? null,
          generation_type: payload?.generation_type ?? payload?.generationType ?? payload?.genType ?? null,
        };
        let handlerReturnedPromise = false;
        let dispatchStatus = "accepted";
        let errorCode = null;
        try {
          const result = handler(payload);
          handlerReturnedPromise = Boolean(result && typeof result.then === "function");
          if (handlerReturnedPromise) {
            Promise.resolve(result).catch((error) => {
              try {
                trace?.({
                  stage: "HOST_LIFECYCLE_HANDLER_REJECTED",
                  host_event_key: key,
                  host_event_type: eventType,
                  ...generationIdentity,
                  error_code: String(error?.code ?? error?.name ?? "LIFECYCLE_HANDLER_REJECTED").slice(0, 160),
                });
              } catch {
                // Rejection diagnostics are fail-open and never create a
                // host-facing unhandled rejection.
              }
              try {
                console.error("[BioWeave] lifecycle handler failed", error);
              } catch {
                // Diagnostics must never turn an event failure into an
                // unhandled rejection or another host-facing exception.
              }
            });
          }
        } catch (error) {
          dispatchStatus = "sync_failed";
          errorCode = String(error?.code ?? error?.name ?? "LIFECYCLE_HANDLER_FAILED").slice(0, 160);
          try {
            console.error("[BioWeave] lifecycle handler failed", error);
          } catch {
            // Keep the host event boundary fail-open.
          }
        }
        try {
          trace?.({
            stage: "HOST_LIFECYCLE_LISTENER_RETURNED",
            host_event_key: key,
            host_event_type: eventType,
            ...generationIdentity,
            host_listener_return_policy: "fire_and_forget",
            handler_returned_promise: handlerReturnedPromise,
            dispatch_status: dispatchStatus,
            host_listener_return_duration_ms: elapsedMs(startedAt),
            error_code: errorCode,
          });
        } catch {
          // Host-boundary diagnostics are fail-open and never alter the
          // listener return value or the host lifecycle.
        }
        return undefined;
      };
      source.on(eventType, listener);
      boundEventTypes.add(eventType);
      listeners.push([eventType, listener]);
    }
    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      while (listeners.length) {
        const [eventType, listener] = listeners.pop();
        source.removeListener(eventType, listener);
      }
    };
  }

  async function requestJson(endpoint, body, {
    signal = undefined,
    write = false,
    serializedBody = null,
    ioMetric = null,
  } = {}) {
    const context = getContext();
    const fetchRef = globalThis.fetch;
    if (typeof fetchRef !== "function")
      throw sourceError("SOURCE_OWNER_HTTP_UNAVAILABLE");
    const prepareStartedAt = monotonicNow();
    const requestBody = serializedBody ?? JSON.stringify(body);
    if (ioMetric && ioMetric.request_prepare_duration_ms === null)
      ioMetric.request_prepare_duration_ms = elapsedMs(prepareStartedAt);
    let response;
    const requestStartedAt = monotonicNow();
    try {
      if (ioMetric) ioMetric.actual_network_request = true;
      response = await fetchRef(endpoint, {
        method: "POST",
        headers: sourceRequestHeaders(context),
        body: requestBody,
        cache: "no-cache",
        ...(signal ? {signal} : {}),
      });
      if (ioMetric) ioMetric.network_wait_duration_ms = elapsedMs(requestStartedAt);
    } catch (error) {
      if (ioMetric) ioMetric.network_wait_duration_ms = elapsedMs(requestStartedAt);
      const wrapped = sourceError(
        write ? "SOURCE_OWNER_SAVE_UNKNOWN" : "SOURCE_OWNER_READ_FAILED",
        {cause: error},
      );
      if (write) wrapped.commitState = "unknown";
      throw wrapped;
    }
    if (!response?.ok) {
      const status = Number(response?.status) || 0;
      const error = sourceError(
        write && status >= 500
          ? "SOURCE_OWNER_SAVE_UNKNOWN"
          : write
            ? "SOURCE_OWNER_SAVE_FAILED"
            : "SOURCE_OWNER_READ_FAILED",
        {status, statusText: response?.statusText},
      );
      if (write && status >= 500) error.commitState = "unknown";
      throw error;
    }
    if (write) return response;
    const responseParseStartedAt = monotonicNow();
    const bodyReadStartedAt = responseParseStartedAt;
    const canSplitResponseTiming = typeof response.text === "function";
    let responseText;
    try {
      if (!canSplitResponseTiming) {
        // Keep the adapter usable with the minimal response doubles used by
        // older host/test integrations. This path is not split-measurable:
        // the host has already combined body consumption and JSON parsing.
        const data = await response.json();
        if (ioMetric) ioMetric.response_parse_duration_ms = elapsedMs(responseParseStartedAt);
        return data;
      }
      responseText = await response.text();
      if (ioMetric) ioMetric.response_body_read_duration_ms = elapsedMs(bodyReadStartedAt);
    } catch (error) {
      if (ioMetric) {
        if (canSplitResponseTiming)
          ioMetric.response_body_read_duration_ms = elapsedMs(bodyReadStartedAt);
        ioMetric.response_parse_duration_ms = elapsedMs(responseParseStartedAt);
      }
      throw sourceError("SOURCE_OWNER_READ_INVALID_RESPONSE", {cause: error});
    }
    const jsonParseStartedAt = monotonicNow();
    try {
      const data = JSON.parse(responseText);
      if (ioMetric) {
        ioMetric.json_parse_duration_ms = elapsedMs(jsonParseStartedAt);
        ioMetric.response_parse_duration_ms = elapsedMs(responseParseStartedAt);
      }
      return data;
    } catch (error) {
      if (ioMetric) {
        ioMetric.json_parse_duration_ms = elapsedMs(jsonParseStartedAt);
        ioMetric.response_parse_duration_ms = elapsedMs(responseParseStartedAt);
      }
      throw sourceError("SOURCE_OWNER_READ_INVALID_RESPONSE", {cause: error});
    }
  }

  async function sourceRevision(state) {
    return hashText(JSON.stringify(stableOwnerValue({
      chatId: state.chatId,
      characterId: state.characterId,
      groupId: state.groupId,
      header: state.header,
      chatMetadata: state.chatMetadata,
      messages: state.messages,
    })));
  }

  function parseSourceResponse(data, descriptor) {
    if (!Array.isArray(data))
      throw sourceError("SOURCE_OWNER_READ_INVALID_RESPONSE");
    const header = data.length > 0 && data[0] && typeof data[0] === "object"
      ? data[0]
      : {};
    const metadata = header.chat_metadata ?? {};
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
      throw sourceError("SOURCE_OWNER_METADATA_INVALID");
    return {
      chatId: descriptor.chatId,
      chat_id: descriptor.chatId,
      characterId: descriptor.characterId,
      groupId: descriptor.groupId,
      header: cloneOwnerValue(header),
      chatMetadata: cloneOwnerValue(metadata),
      metadata: cloneOwnerValue(metadata),
      messages: cloneOwnerValue(data.slice(data.length > 0 ? 1 : 0)),
      chat: cloneOwnerValue(data.slice(data.length > 0 ? 1 : 0)),
      response_shape: "json_array_jsonl",
    };
  }

  async function readOfficialChatOwner(owner = {}) {
    const operationStartedAt = monotonicNow();
    const ioMetric = createOfficialIoMetric(owner, "CHAT_GET", owner?.officialIoContext?.io_purpose);
    const context = getContext();
    const descriptor = sourceDescriptor(context, owner);
    try {
      const data = await requestJson(
        "/api/chats/get",
        {
          ch_name: descriptor.ch_name,
          file_name: descriptor.apiFileName,
          avatar_url: descriptor.avatar_url,
        },
        {signal: owner?.signal, ioMetric},
      );
      const normalizeStartedAt = monotonicNow();
      const state = parseSourceResponse(data, descriptor);
      ioMetric.response_normalize_duration_ms = elapsedMs(normalizeStartedAt);
      const revisionStartedAt = monotonicNow();
      state.revision = await sourceRevision(state);
      ioMetric.source_revision_duration_ms = elapsedMs(revisionStartedAt);
      state.sourceRevision = state.revision;
      state.owner = {
        chatId: descriptor.chatId,
        characterId: descriptor.characterId,
        groupId: descriptor.groupId,
        revision: state.revision,
      };
      Object.defineProperty(state, "__official_io_call_id", {
        value: ioMetric.io_call_id,
        enumerable: false,
      });
      ioMetric.status = "SUCCEEDED";
      ioMetric.reason_code = "OFFICIAL_CHAT_GET_COMPLETED";
      ioMetric.total_duration_ms = elapsedMs(operationStartedAt);
      emitOfficialIo(owner, ioMetric);
      return state;
    } catch (error) {
      ioMetric.status = "FAILED";
      ioMetric.reason_code = "OFFICIAL_CHAT_GET_FAILED";
      ioMetric.error_code = error?.code ?? error?.message ?? "OFFICIAL_CHAT_GET_FAILED";
      ioMetric.total_duration_ms = elapsedMs(operationStartedAt);
      emitOfficialIo(owner, ioMetric);
      throw error;
    }
  }

  async function requestOfficialChatSave({
    owner = {},
    descriptor = null,
    chat,
    signal,
    officialIoTrace = null,
    officialIoContext = null,
  } = {}) {
    const traceOwner = {officialIoTrace, officialIoContext};
    const operationStartedAt = monotonicNow();
    const ioMetric = createOfficialIoMetric(traceOwner, "CHAT_SAVE", officialIoContext?.io_purpose);
    const resolved = descriptor ?? sourceDescriptor(getContext(), owner);
    try {
      const prepareStartedAt = monotonicNow();
      const body = {
        ch_name: resolved.ch_name,
        file_name: resolved.apiFileName,
        chat: cloneOwnerValue(chat),
        avatar_url: resolved.avatar_url,
        force: false,
      };
      const serializedBody = JSON.stringify(body);
      ioMetric.request_prepare_duration_ms = elapsedMs(prepareStartedAt);
      const response = await requestJson(
        "/api/chats/save",
        body,
        {signal, write: true, serializedBody, ioMetric},
      );
      ioMetric.status = "SUCCEEDED";
      ioMetric.reason_code = "OFFICIAL_CHAT_SAVE_COMPLETED";
      ioMetric.total_duration_ms = elapsedMs(operationStartedAt);
      emitOfficialIo(traceOwner, ioMetric);
      return response;
    } catch (error) {
      ioMetric.status = "FAILED";
      ioMetric.reason_code = "OFFICIAL_CHAT_SAVE_FAILED";
      ioMetric.error_code = error?.code ?? error?.message ?? "OFFICIAL_CHAT_SAVE_FAILED";
      ioMetric.total_duration_ms = elapsedMs(operationStartedAt);
      emitOfficialIo(traceOwner, ioMetric);
      throw error;
    }
  }

  async function refreshOfficialChatIndex(owner = {}) {
    const context = getContext();
    const descriptor = sourceDescriptor(context, {
      chatId: owner?.chatId ?? context?.chatId,
      characterId: owner?.characterId ?? ownerIdentityFromContext(context).characterId,
    });
    const data = await requestJson(
      "/api/characters/chats",
      {avatar_url: descriptor.avatar_url},
    );
    if (!data || typeof data !== "object" || Array.isArray(data) || data.error === true)
      throw sourceError("CHAT_INDEX_INVALID");
    const ids = new Set();
    for (const entry of Object.values(data)) {
      const id = ownerId(entry?.file_name ?? entry?.chatId ?? entry?.chat_id ?? entry);
      if (id) ids.add(chatIdKey(id));
    }
    ids.add(chatIdKey(descriptor.chatId));
    chatIndexCache = ids;
    chatIndexOwnerKey = ownerKey(context, descriptor);
    return new Set(ids);
  }

  return {
    getContext,
    readHostFloorSlot,
    writeHostFloorSlot,
    subscribeLifecycle,
    sourceOwnerLatestMerge: SOURCE_OWNER_LATEST_MERGE,
    requestJson,
    getOwnerDescriptor: (owner = {}) => sourceDescriptor(getContext(), owner),
    getChat: () => getContext()?.chat ?? null,
    getExtensionSettings: () => getContext()?.extensionSettings ?? null,
    getGlobalSettings: () => getContext()?.extensionSettings?.bioweave ?? null,
    getRequestHeaders: () => getContext()?.getRequestHeaders?.() ?? {},
    fetch: (...args) => globalThis.fetch(...args),
    async saveGlobalSettings(value) {
      const context = getContext();
      if (!context?.extensionSettings || typeof context.saveSettingsDebounced !== "function")
        throw new Error("ST_EXTENSION_SETTINGS_UNAVAILABLE");
      const hadPrevious = Object.prototype.hasOwnProperty.call(context.extensionSettings, "bioweave");
      const previous = context.extensionSettings.bioweave;
      context.extensionSettings.bioweave = value;
      try {
        await context.saveSettingsDebounced();
      } catch (error) {
        if (hadPrevious) context.extensionSettings.bioweave = previous;
        else delete context.extensionSettings.bioweave;
        throw error;
      }
    },
    getChatId: () => getContext()?.chatId ?? null,
    getChatMetadata: () => getContext()?.chatMetadata ?? null,
    getMessage: (index) => getContext()?.chat?.[index] ?? null,
    getChatRevision: (chatId) => {
      const context = getContext();
      const value = context?.chatRevision ?? context?.chat_revision ??
        context?.chatStateRevision ?? context?.chat_state_revision;
      if (typeof context?.getChatRevision === "function") return context.getChatRevision(chatId);
      if (typeof context?.getRevision === "function") return context.getRevision(chatId);
      return value;
    },
    getChatOwnerIdentity: () => {
      const context = getContext();
      if (typeof context?.getChatOwnerIdentity === "function")
        return context.getChatOwnerIdentity();
      return ownerIdentityFromContext(context);
    },
    getChatIndex: () => {
      const context = getContext();
      if (typeof context?.getChatIndex === "function") return context.getChatIndex();
      if (typeof context?.getKnownChatIds === "function") return context.getKnownChatIds();
      const contextIndex = context?.chatIndex ?? context?.chat_index ?? context?.chatIds ?? null;
      if (contextIndex !== null && contextIndex !== undefined) return contextIndex;
      return chatIndexOwnerKey === ownerKey(context)
        ? new Set(chatIndexCache ?? [])
        : null;
    },
    refreshChatIndex: refreshOfficialChatIndex,
    isFreshChat: (chatId) => {
      const context = getContext();
      if (typeof context?.isFreshChat === "function") return context.isFreshChat(chatId);
      if (typeof context?.getChatFreshness === "function") return context.getChatFreshness(chatId);
      return undefined;
    },
    readOfficialChatOwner,
    readOfficialChat: readOfficialChatOwner,
    requestOfficialChatSave,
    async saveChat(options = {}) {
      const context = getContext();
      const expectedChatId = options?.expectedChatId ?? options?.chatId;
      if (expectedChatId !== undefined && String(context?.chatId) !== String(expectedChatId))
        throw sourceError("STALE_CHAT");
      if (typeof context?.saveChat !== "function")
        throw sourceError("ST_CHAT_STORAGE_UNAVAILABLE");
      const response = await context.saveChat();
      if (expectedChatId !== undefined && getContext()?.chatId !== expectedChatId)
        throw sourceError("STALE_CHAT");
      return response ?? {commitState: "unknown", status: "unknown"};
    },
    async saveChatMetadata(key, value, expectedChatId) {
      const context = getContext();
      if (expectedChatId !== undefined && context?.chatId !== expectedChatId)
        throw new Error("STALE_CHAT");
      if (!context?.chatMetadata || typeof context.saveMetadata !== "function")
        throw new Error("ST_METADATA_UNAVAILABLE");
      context.chatMetadata[key] = value;
      const response = await context.saveMetadata();
      if (expectedChatId !== undefined && getContext()?.chatId !== expectedChatId)
        throw new Error("STALE_CHAT");
      return response ?? {commitState: "confirmed"};
    },
    setExtensionPrompt({key, content, position, depth, scan = false, role} = {}) {
      const context = getContext();
      const setter = context?.setExtensionPrompt ?? globalThis.setExtensionPrompt;
      const metadata = {
        slot: key ?? null,
        position_argument: position ?? null,
        depth_argument: Number.isFinite(Number(depth)) ? Number(depth) : null,
        role_argument: role ?? null,
        adapter_available: true,
        set_extension_prompt_available: typeof setter === "function",
        setter_bound_to_context: Boolean(context?.setExtensionPrompt),
      };
      if (typeof setter !== "function") throw sourceError("ST_EXTENSION_PROMPT_UNAVAILABLE", metadata);
      const types = context?.extension_prompt_types ?? globalThis.extension_prompt_types ?? {};
      const roles = context?.extension_prompt_roles ?? globalThis.extension_prompt_roles ?? {};
      // SillyTavern exports these constants from its module, but they are not
      // guaranteed to be copied onto getContext() or globalThis. Keep the
      // official host values as a narrow adapter fallback.
      const resolvedPosition = position === "IN_CHAT" ? (types.IN_CHAT ?? 1) : position;
      const resolvedRole = role === "SYSTEM" ? (roles.SYSTEM ?? 0) : role;
      metadata.position_constant_available = position !== "IN_CHAT" || types.IN_CHAT !== undefined || globalThis.extension_prompt_types?.IN_CHAT !== undefined;
      metadata.role_constant_available = role !== "SYSTEM" || roles.SYSTEM !== undefined || globalThis.extension_prompt_roles?.SYSTEM !== undefined;
      if (resolvedPosition === undefined || resolvedRole === undefined)
        throw sourceError("ST_EXTENSION_PROMPT_API_INVALID", metadata);
      return context?.setExtensionPrompt
        ? setter.call(context, key, content, resolvedPosition, depth, scan, resolvedRole)
        : setter(key, content, resolvedPosition, depth, scan, resolvedRole);
    },
  };
}
