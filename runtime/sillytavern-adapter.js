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

  function subscribeLifecycle({eventTypes, handlers} = {}) {
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
      const listener = (payload) => handler(payload);
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

  async function requestJson(endpoint, body, {signal = undefined, write = false} = {}) {
    const context = getContext();
    const fetchRef = globalThis.fetch;
    if (typeof fetchRef !== "function")
      throw sourceError("SOURCE_OWNER_HTTP_UNAVAILABLE");
    let response;
    try {
      response = await fetchRef(endpoint, {
        method: "POST",
        headers: sourceRequestHeaders(context),
        body: JSON.stringify(body),
        cache: "no-cache",
        ...(signal ? {signal} : {}),
      });
    } catch (error) {
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
    try {
      return await response.json();
    } catch (error) {
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
    const context = getContext();
    const descriptor = sourceDescriptor(context, owner);
    const data = await requestJson(
      "/api/chats/get",
      {
        ch_name: descriptor.ch_name,
        file_name: descriptor.apiFileName,
        avatar_url: descriptor.avatar_url,
      },
      {signal: owner?.signal},
    );
    const state = parseSourceResponse(data, descriptor);
    state.revision = await sourceRevision(state);
    state.sourceRevision = state.revision;
    state.owner = {
      chatId: descriptor.chatId,
      characterId: descriptor.characterId,
      groupId: descriptor.groupId,
      revision: state.revision,
    };
    return state;
  }

  async function requestOfficialChatSave({owner = {}, descriptor = null, chat, signal} = {}) {
    const resolved = descriptor ?? sourceDescriptor(getContext(), owner);
    return requestJson(
      "/api/chats/save",
      {
        ch_name: resolved.ch_name,
        file_name: resolved.apiFileName,
        chat: cloneOwnerValue(chat),
        avatar_url: resolved.avatar_url,
        force: false,
      },
      {signal, write: true},
    );
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
      if (typeof setter !== "function") throw sourceError("ST_EXTENSION_PROMPT_UNAVAILABLE");
      const types = context?.extension_prompt_types ?? globalThis.extension_prompt_types ?? {};
      const roles = context?.extension_prompt_roles ?? globalThis.extension_prompt_roles ?? {};
      const resolvedPosition = position === "IN_CHAT" ? types.IN_CHAT : position;
      const resolvedRole = role === "SYSTEM" ? roles.SYSTEM : role;
      if (resolvedPosition === undefined || resolvedRole === undefined)
        throw sourceError("ST_EXTENSION_PROMPT_API_INVALID");
      return context?.setExtensionPrompt
        ? setter.call(context, key, content, resolvedPosition, depth, scan, resolvedRole)
        : setter(key, content, resolvedPosition, depth, scan, resolvedRole);
    },
  };
}
