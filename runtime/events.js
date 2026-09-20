import { createChatBoundary } from "./chat.js";
import {
  createStore,
  hasSwipeSlot,
  hasSwipeStructure,
  isCharacterMessage,
} from "../storage/store.js";
import { createAnalyzer } from "../ai/analyzer.js";
import { createStoryTime } from "../story/time.js";
import {
  FOLLOW_DEFAULT_API,
  SILLYTAVERN_CURRENT_API,
  cloneValue,
} from "../storage/schema.js";
import {
  applyClearPlanToState,
  buildClearPlan,
  createClearService,
} from "../storage/clear.js";
import { createEventAnalysisCoordinator } from "./event-analysis.js";
import { hashText } from "./floor.js";

const LIFECYCLE_EVENTS = [
  "CHAT_CHANGED",
  "CHAT_CREATED",
  "MESSAGE_UPDATED",
  "MESSAGE_EDITED",
  "MESSAGE_DELETED",
  "MESSAGE_SWIPED",
  "MESSAGE_SWIPE_DELETED",
  "MESSAGE_RECEIVED",
  "GENERATION_ENDED",
];

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
  const characterId =
    owner?.characterId ?? owner?.character_id ?? identity.characterId;
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
    (String(characterId) === String(identity.characterId)
      ? context?.name2
      : null);
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

export function createSillyTavernAdapter() {
  const getContext = () => globalThis.SillyTavern?.getContext?.() ?? null;
  let chatIndexCache = null;
  let chatIndexOwnerKey = null;

  function ownerKey(context, owner = {}) {
    const identity = ownerIdentityFromContext(context);
    const characterId =
      owner?.characterId ?? owner?.character_id ?? identity.characterId;
    const groupId = owner?.groupId ?? owner?.group_id ?? identity.groupId;
    const character = characterForOwner(context, owner);
    return `${groupId ?? ""}|${characterId ?? ""}|${character?.avatar_url ?? ""}`;
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
    if (groupId != null && String(groupId).trim()) {
      throw sourceError("SOURCE_OWNER_GROUP_UNSUPPORTED");
    }
    const character = characterForOwner(context, owner);
    if (!character)
      throw sourceError("SOURCE_OWNER_CHARACTER_UNAVAILABLE");
    return {
      chatId,
      apiFileName: String(chatId).replace(/\.jsonl$/iu, ""),
      characterId: character.characterId,
      groupId: null,
      ch_name: character.ch_name,
      avatar_url: character.avatar_url,
    };
  }

  async function requestJson(endpoint, body, { signal = undefined, write = false } = {}) {
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
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      const wrapped = sourceError(
        write ? "SOURCE_OWNER_SAVE_UNKNOWN" : "SOURCE_OWNER_READ_FAILED",
        { cause: error },
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
        { status, statusText: response?.statusText },
      );
      if (write && status >= 500) error.commitState = "unknown";
      throw error;
    }
    if (write) return response;
    try {
      return await response.json();
    } catch (error) {
      throw sourceError("SOURCE_OWNER_READ_INVALID_RESPONSE", { cause: error });
    }
  }

  async function sourceRevision(state) {
    return hashText(
      JSON.stringify(
        stableOwnerValue({
          chatId: state.chatId,
          characterId: state.characterId,
          groupId: state.groupId,
          header: state.header,
          chatMetadata: state.chatMetadata,
          messages: state.messages,
        }),
      ),
    );
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
    };
  }

  async function readOfficialChatOwner(owner) {
    const context = getContext();
    const descriptor = sourceDescriptor(context, owner);
    const data = await requestJson(
      "/api/chats/get",
      {
        ch_name: descriptor.ch_name,
        file_name: descriptor.apiFileName,
        avatar_url: descriptor.avatar_url,
      },
      { signal: owner?.signal },
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

  async function saveOfficialChatOwner(payload) {
    const owner = payload?.owner ?? payload;
    const descriptor = sourceDescriptor(getContext(), owner);
    const latest = await readOfficialChatOwner(owner);
    if (payload?.signal?.aborted)
      throw sourceError("SOURCE_OWNER_SAVE_UNKNOWN", { commitState: "unknown" });
    const plan = buildClearPlan({
      domain: payload?.plan?.domain ?? payload?.plan?.operation ?? "all",
      owner,
      chatId: descriptor.chatId,
      state: latest,
      sourceTargeted: true,
    });
    const next = applyClearPlanToState(latest, plan);
    const header = {
      ...(next.header && typeof next.header === "object" ? cloneOwnerValue(next.header) : {}),
      chat_metadata: cloneOwnerValue(next.chatMetadata),
      user_name: next.header?.user_name ?? "unused",
      character_name: next.header?.character_name ?? "unused",
    };
    await requestJson(
      "/api/chats/save",
      {
        ch_name: descriptor.ch_name,
        file_name: descriptor.apiFileName,
        chat: [header, ...cloneOwnerValue(next.messages)],
        avatar_url: descriptor.avatar_url,
        force: false,
      },
      { signal: payload?.signal, write: true },
    );
    return {
      commitState: "confirmed",
      mergeMode: "latest-source",
      baseRevision: latest.revision,
      baseState: cloneOwnerValue(latest),
      plan,
    };
  }

  async function refreshOfficialChatIndex() {
    const context = getContext();
    const descriptor = sourceDescriptor(context, {
      chatId: context?.chatId,
      characterId: ownerIdentityFromContext(context).characterId,
    });
    const data = await requestJson(
      "/api/characters/chats",
      { avatar_url: descriptor.avatar_url },
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
    sourceOwnerLatestMerge: SOURCE_OWNER_LATEST_MERGE,
    getChat: () => getContext()?.chat ?? null,
    getExtensionSettings: () => getContext()?.extensionSettings ?? null,
    getGlobalSettings: () => getContext()?.extensionSettings?.bioweave ?? null,
    getRequestHeaders: () => getContext()?.getRequestHeaders?.() ?? {},
    fetch: (...args) => globalThis.fetch(...args),
    async saveGlobalSettings(value) {
      const context = getContext();
      if (
        !context?.extensionSettings ||
        typeof context.saveSettingsDebounced !== "function"
      ) {
        throw new Error("ST_EXTENSION_SETTINGS_UNAVAILABLE");
      }
      const hadPrevious = Object.prototype.hasOwnProperty.call(
        context.extensionSettings,
        "bioweave",
      );
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
      const value =
        context?.chatRevision ??
        context?.chat_revision ??
        context?.chatStateRevision ??
        context?.chat_state_revision;
      if (typeof context?.getChatRevision === "function")
        return context.getChatRevision(chatId);
      if (typeof context?.getRevision === "function")
        return context.getRevision(chatId);
      return value;
    },
    getChatOwnerIdentity: () => {
      const context = getContext();
      if (typeof context?.getChatOwnerIdentity === "function")
        return context.getChatOwnerIdentity();
      return {
        characterId:
          context?.characterId ??
          context?.character_id ??
          context?.activeCharacterId ??
          context?.active_character_id ??
          null,
        groupId:
          context?.groupId ??
          context?.group_id ??
          context?.activeGroupId ??
          context?.active_group_id ??
          null,
      };
    },
    getChatIndex: () => {
      const context = getContext();
      if (typeof context?.getChatIndex === "function")
        return context.getChatIndex();
      if (typeof context?.getKnownChatIds === "function")
        return context.getKnownChatIds();
      const contextIndex =
        context?.chatIndex ?? context?.chat_index ?? context?.chatIds ?? null;
      if (contextIndex !== null && contextIndex !== undefined)
        return contextIndex;
      return chatIndexOwnerKey === ownerKey(context)
        ? new Set(chatIndexCache ?? [])
        : null;
    },
    refreshChatIndex: refreshOfficialChatIndex,
    isFreshChat: (chatId) => {
      const context = getContext();
      if (typeof context?.isFreshChat === "function")
        return context.isFreshChat(chatId);
      if (typeof context?.getChatFreshness === "function")
        return context.getChatFreshness(chatId);
      return undefined;
    },
    hasSourceOwnerCapability: () => {
      const context = getContext();
      const reader = [
        "readChatOwner",
        "readChatSnapshot",
        "getChatOwnerSnapshot",
      ].some((name) => typeof context?.[name] === "function");
      const writer = [
        "compareAndSaveChatOwner",
        "compareAndSwapChatOwner",
        "saveChatOwnerCAS",
        "commitChatOwnerCAS",
        "saveChatOwner",
        "saveChatSnapshot",
        "saveChatStateByOwner",
      ].some((name) => typeof context?.[name] === "function");
      const cas =
        context?.sourceOwnerRevisionCAS === true ||
        context?.supportsSourceOwnerRevisionCAS === true ||
        context?.capabilities?.sourceOwnerRevisionCAS === true ||
        [
          "compareAndSaveChatOwner",
          "compareAndSwapChatOwner",
          "saveChatOwnerCAS",
          "commitChatOwnerCAS",
        ].some((name) => typeof context?.[name] === "function");
      const officialLatestMerge = Boolean(
        typeof globalThis.fetch === "function" &&
        context &&
        context?.chatId &&
        characterForOwner(context, { chatId: context.chatId }),
      );
      return Boolean(
        (reader && writer && cas) || officialLatestMerge,
      );
    },
    async compareAndSaveChatOwner(payload) {
      const context = getContext();
      const name = [
        "compareAndSaveChatOwner",
        "compareAndSwapChatOwner",
        "saveChatOwnerCAS",
        "commitChatOwnerCAS",
      ].find((candidate) => typeof context?.[candidate] === "function");
      if (name) return context[name].call(context, payload);
      if (
        context?.sourceOwnerRevisionCAS === true &&
        typeof context?.saveChatOwner === "function"
      )
        return context.saveChatOwner.call(context, payload);
      return saveOfficialChatOwner(payload);
    },
    async readChatOwner(owner) {
      const context = getContext();
      const customReader = [
        "readChatOwner",
        "readChatSnapshot",
        "getChatOwnerSnapshot",
      ].find((name) => typeof context?.[name] === "function");
      return customReader
        ? context[customReader].call(context, owner)
        : readOfficialChatOwner(owner);
    },
    async saveChatOwner(payload) {
      const context = getContext();
      const name = [
        "saveChatOwner",
        "saveChatSnapshot",
        "saveChatStateByOwner",
      ].find((candidate) => typeof context?.[candidate] === "function");
      return name
        ? context[name].call(context, payload)
        : saveOfficialChatOwner(payload);
    },
    async saveChat(options = {}) {
      const context = getContext();
      const expectedChatId = options?.expectedChatId ?? options?.chatId;
      if (
        expectedChatId !== undefined &&
        String(context?.chatId) !== String(expectedChatId)
      ) {
        throw sourceError("STALE_CHAT");
      }
      if (typeof context?.saveChat !== "function")
        throw sourceError("ST_CHAT_STORAGE_UNAVAILABLE");
      const response = await context.saveChat();
      if (
        expectedChatId !== undefined &&
        getContext()?.chatId !== expectedChatId
      ) {
        throw sourceError("STALE_CHAT");
      }
      return response ?? { commitState: "confirmed" };
    },
    async saveChatMetadata(key, value, expectedChatId) {
      const context = getContext();
      if (expectedChatId !== undefined && context?.chatId !== expectedChatId) {
        throw new Error("STALE_CHAT");
      }
      if (
        !context?.chatMetadata ||
        typeof context.saveMetadata !== "function"
      ) {
        throw new Error("ST_METADATA_UNAVAILABLE");
      }
      context.chatMetadata[key] = value;
      const response = await context.saveMetadata();
      if (
        expectedChatId !== undefined &&
        getContext()?.chatId !== expectedChatId
      ) {
        throw new Error("STALE_CHAT");
      }
      return response ?? { commitState: "confirmed" };
    },
    async saveFloorBioWeave(messageIndex, swipeId, value, expectedChatId) {
      const context = getContext();
      if (expectedChatId !== undefined && context?.chatId !== expectedChatId) {
        throw new Error("STALE_CHAT");
      }
      const message = context?.chat?.[messageIndex];
      if (!message) throw new Error("MESSAGE_NOT_FOUND");
      if (!isCharacterMessage(message))
        throw new Error("BIOWEAVE_USER_FLOOR_WRITE_FORBIDDEN");
      const targetSwipeId =
        Number.isInteger(swipeId) && swipeId >= 0 ? swipeId : 0;
      if (hasSwipeStructure(message)) {
        if (!hasSwipeSlot(message, targetSwipeId))
          throw new Error("SWIPE_NOT_FOUND");
        message.swipe_info ??= [];
        message.swipe_info[targetSwipeId] ??= {};
        message.swipe_info[targetSwipeId].extra ??= {};
        message.swipe_info[targetSwipeId].extra.bioweave = value;
      } else {
        message.extra ??= {};
        message.extra.bioweave = value;
      }
      const response = await this.saveChat({ expectedChatId });
      if (
        expectedChatId !== undefined &&
        getContext()?.chatId !== expectedChatId
      ) {
        throw new Error("STALE_CHAT");
      }
      return response;
    },
  };
}

export function createRuntime({
  adapter = createSillyTavernAdapter(),
  analyzer = null,
  storyTime = null,
  characterContextResolver = null,
  analysisContextCollector = null,
  analysisSourceLoader = null,
  analysisSourceLoaderOptions = {},
  externalMemoryProviderLoader = null,
  analysisSourceCache = null,
} = {}) {
  const st = adapter;
  const chat = createChatBoundary(st);
  const store = createStore(st, chat);
  const subscriptions = new Set();
  const unbind = [];
  let initialized = false;
  let destroyed = false;

  function notify(event) {
    for (const listener of [...subscriptions]) {
      try {
        listener(event);
      } catch (error) {
        console.error("[BioWeave] runtime subscriber failed", error);
      }
    }
  }

  function notifyLifecycleSettled(key, eventType, payload) {
    notify({
      type: "BIOWEAVE_LIFECYCLE_SETTLED",
      eventType,
      mutationType: key,
      payload,
      chatId: chat.current(),
      epoch: chat.getEpoch(),
    });
  }

  function resolveEventAnalysisProfile() {
    const settings = store.profileStore?.getSettings?.() ?? {};
    const assignment = settings.assignments?.event_analysis ?? null;
    if (assignment === SILLYTAVERN_CURRENT_API) return SILLYTAVERN_CURRENT_API;
    if (assignment === FOLLOW_DEFAULT_API) {
      if (settings.api_source === SILLYTAVERN_CURRENT_API)
        return SILLYTAVERN_CURRENT_API;
      return settings.default_profile_id
        ? (store.profileStore?.getProfile?.(settings.default_profile_id) ??
            null)
        : null;
    }
    return assignment
      ? (store.profileStore?.getProfile?.(assignment) ?? null)
      : null;
  }

  const eventAnalyzer =
    analyzer ??
    createAnalyzer({
      profileResolver: resolveEventAnalysisProfile,
      contextResolver: () => st.getContext?.() ?? null,
      requestSettingsResolver: () =>
        store.profileStore?.getApiRequestSettings?.() ?? {},
      analysisPromptResolver: () =>
        store.profileStore?.getAnalysisPrompt?.() ?? {},
    });
  const eventAnalysis = createEventAnalysisCoordinator({
    st,
    chat,
    store,
    analyzer: eventAnalyzer,
    storyTime: storyTime ?? createStoryTime(),
    ...(typeof characterContextResolver === "function"
      ? { characterContextResolver }
      : {}),
    ...(typeof analysisContextCollector === "function"
      ? { analysisContextCollector }
      : {}),
    ...(typeof analysisSourceLoader === "function"
      ? { analysisSourceLoader }
      : {}),
    analysisSourceLoaderOptions,
    ...(typeof externalMemoryProviderLoader === "function"
      ? { externalMemoryProviderLoader }
      : {}),
    ...(analysisSourceCache ? { analysisSourceCache } : {}),
    globalRecentStoryResolver: () =>
      store.profileStore?.getSettings?.()?.recent_story_global ?? {},
    notify,
  });

  const clearService = createClearService({
    adapter: st,
    store,
    boundary: chat,
    invalidate: (payload) => eventAnalysis.invalidateForClear?.(payload),
  });
  let lifecycleSequence = 0;
  let lifecycleTail = Promise.resolve();
  let activeOwner = null;
  let knownChatIds = null;
  let knownChatIdsEvidence = false;
  let pendingStartNewChat = null;
  const failedSourceClears = new Map();

  function cloneValue(value) {
    if (value === undefined || value === null) return value;
    if (typeof structuredClone === "function") return structuredClone(value);
    if (Array.isArray(value)) return value.map(cloneValue);
    if (typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, cloneValue(item)]),
      );
    return value;
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }

  function scalarId(value) {
    if (typeof value === "string") return value.trim() || null;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    return null;
  }

  function eventChatId(payload) {
    if (payload === undefined || payload === null) return null;
    if (typeof payload === "string" || typeof payload === "number")
      return scalarId(payload);
    if (typeof payload !== "object") return null;
    return scalarId(
      payload.chatId ??
        payload.chat_id ??
        payload.chat_id_name ??
        payload.id ??
        null,
    );
  }

  function ownerIdentity() {
    let raw = {};
    try {
      raw = st.getChatOwnerIdentity?.() ?? {};
    } catch {
      raw = {};
    }
    return {
      characterId:
        raw.characterId ?? raw.character_id ?? raw.character ?? null,
      groupId: raw.groupId ?? raw.group_id ?? raw.group ?? null,
    };
  }

  function ownerIdentityMatches(source, target) {
    const sourceValue = source ?? {};
    const targetValue = target ?? {};
    const keys = ["characterId", "groupId"];
    const known = keys.filter(
      (key) => sourceValue[key] !== null && sourceValue[key] !== undefined,
    );
    if (!known.length) return false;
    return known.every(
      (key) =>
        targetValue[key] !== null &&
        targetValue[key] !== undefined &&
        String(targetValue[key]) === String(sourceValue[key]),
    );
  }

  function normalizeChatIds(raw) {
    if (raw && typeof raw.then === "function") return null;
    const value = raw?.chatIds ?? raw?.chat_ids ?? raw?.ids ?? raw;
    const entries =
      value instanceof Set
        ? [...value]
        : Array.isArray(value)
          ? value
          : null;
    if (!entries) return null;
    const ids = new Set();
    for (const entry of entries) {
      const id =
        typeof entry === "object"
          ? scalarId(entry?.chatId ?? entry?.chat_id ?? entry?.id)
          : scalarId(entry);
      if (id !== null) ids.add(chatIdKey(id));
    }
    return ids;
  }

  function readChatIds() {
    try {
      return normalizeChatIds(st.getChatIndex?.());
    } catch {
      return null;
    }
  }

  function sourceOwnerCapabilityAvailable() {
    if (typeof st.hasSourceOwnerCapability === "function") {
      try {
        return st.hasSourceOwnerCapability() === true;
      } catch {
        return false;
      }
    }
    const cas =
      st.sourceOwnerRevisionCAS === true ||
      st.supportsSourceOwnerRevisionCAS === true ||
      st.sourceOwnerLatestMerge === true ||
      st.supportsSourceOwnerLatestMerge === true ||
      st.capabilities?.sourceOwnerRevisionCAS === true ||
      st.capabilities?.sourceOwnerLatestMerge === true ||
      [
        "compareAndSaveChatOwner",
        "compareAndSwapChatOwner",
        "saveChatOwnerCAS",
        "commitChatOwnerCAS",
      ].some((name) => typeof st[name] === "function");
    return (
      typeof st.readChatOwner === "function" &&
      typeof st.saveChatOwner === "function" &&
      cas
    );
  }

  function captureCurrentOwner(chatId = chat.current()) {
    try {
      const token = chat.token();
      const snapshot = store.getCurrentChatOwnerSnapshot?.(chatId);
      if (!snapshot) return null;
      return {
        chatId,
        chat_id: chatId,
        ...ownerIdentity(),
        revision:
          snapshot.revision ?? st.getChatRevision?.(chatId) ?? undefined,
        sourceRevision:
          snapshot.revision ?? st.getChatRevision?.(chatId) ?? undefined,
        epoch: token.epoch,
        snapshot,
      };
    } catch {
      return null;
    }
  }

  async function captureActiveOwner(chatId = chat.current()) {
    const owner = captureCurrentOwner(chatId);
    if (!owner) return null;
    owner.source_hash = await hashText(
      JSON.stringify(
        stableValue({
          chatId: owner.chatId,
          revision: owner.revision,
          header: owner.snapshot?.header,
          chatMetadata: owner.snapshot?.chatMetadata,
          messages: owner.snapshot?.messages,
        }),
      ),
    );
    if (owner.revision === undefined || owner.revision === null) {
      // The current ST release does not expose a server revision. A stable
      // digest of the captured owner is the revision token used by the
      // latest-read/source-merge adapter; it is never a permission to write
      // the captured snapshot back wholesale.
      owner.revision = owner.source_hash;
      owner.sourceRevision = owner.source_hash;
    }
    chat.assert({ chatId, epoch: owner.epoch });
    return owner;
  }

  async function refreshActiveOwner(chatId = chat.current()) {
    try {
      const owner = await captureActiveOwner(chatId);
      if (owner && chat.current() === chatId) activeOwner = owner;
      const ids = readChatIds();
      if (ids) {
        ids.add(chatIdKey(chatId));
        knownChatIds = ids;
        knownChatIdsEvidence = true;
      } else {
        // A Chat index that cannot be read is not evidence for a new-chat
        // transition. Do not carry another character's stale index forward.
        knownChatIds = null;
        knownChatIdsEvidence = false;
      }
      return owner;
    } catch (error) {
      if (error?.message !== "STALE_CHAT")
        console.error("[BioWeave] active Chat owner capture failed", error);
      return null;
    }
  }

  function clearNotification(result, operation) {
    const confirmed =
      result?.ok === true && result?.persistence?.commitState === "confirmed";
    notify({
      type: confirmed
        ? "BIOWEAVE_DATA_CLEARED"
        : "BIOWEAVE_DATA_CLEAR_FAILED",
      payload: { ...result, operation: result?.operation ?? operation },
      chatId: result?.chatId ?? chat.current(),
    });
  }

  async function runClear(operation, target, options = {}) {
    const method = clearService?.[operation];
    if (typeof method !== "function") {
      const result = {
        ok: false,
        changed: false,
        operation,
        error_code: "CLEAR_SERVICE_UNAVAILABLE",
        persistence: { commitState: "failed", attempted: false },
      };
      clearNotification(result, operation);
      return result;
    }
    const result = await method.call(clearService, target, options);
    try {
      await eventAnalysis.completeClear?.(result);
    } catch (error) {
      if (result.ok) console.error("[BioWeave] clear state refresh failed", error);
    }
    clearNotification(result, operation);
    return result;
  }

  function prepareStartNewChatTransition(
    sequence,
    epochBefore,
    previousOwner,
    targetChatId,
    payload,
  ) {
    const idsBefore = knownChatIds ? new Set(knownChatIds) : null;
    const targetOwner = captureCurrentOwner(targetChatId);
    const payloadChatId = eventChatId(payload);
    const eligible = Boolean(
      sourceOwnerCapabilityAvailable() &&
        previousOwner &&
        previousOwner.chatId !== targetChatId &&
        previousOwner.epoch === epochBefore &&
        previousOwner.snapshot &&
        previousOwner.source_hash &&
        previousOwner.revision !== undefined &&
        previousOwner.revision !== null &&
        idsBefore &&
        knownChatIdsEvidence &&
        !idsBefore.has(chatIdKey(targetChatId)) &&
        targetOwner &&
        ownerIdentityMatches(previousOwner, targetOwner) &&
        (payloadChatId === null ||
          String(payloadChatId) === String(targetChatId)),
    );
    pendingStartNewChat = eligible
      ? {
          token: `start-new-chat:${sequence}`,
          sequence,
          sourceChatId: previousOwner.chatId,
          sourceOwner: cloneValue(previousOwner),
          targetChatId,
          targetOwner: cloneValue(targetOwner),
          epoch: chat.getEpoch(),
          idsBefore: [...idsBefore],
          consumed: false,
        }
      : null;
    activeOwner = targetOwner ?? {
      chatId: targetChatId,
      chat_id: targetChatId,
      ...ownerIdentity(),
      epoch: chat.getEpoch(),
    };
    if (knownChatIds) knownChatIds.add(chatIdKey(targetChatId));
  }

  function consumeStartNewChatTransition(sequence, payload) {
    const candidate = pendingStartNewChat;
    const targetChatId = chat.current();
    const payloadChatId = eventChatId(payload);
    let freshness;
    try {
      freshness = st.isFreshChat?.(targetChatId);
    } catch {
      freshness = false;
    }
    const freshnessIsSynchronous =
      !(freshness && typeof freshness.then === "function");
    const valid = Boolean(
      candidate &&
        !candidate.consumed &&
        candidate.sequence === sequence - 1 &&
        candidate.epoch === chat.getEpoch() &&
        String(candidate.targetChatId) === String(targetChatId) &&
        (payloadChatId === null ||
          String(payloadChatId) === String(targetChatId)) &&
        ownerIdentityMatches(candidate.sourceOwner, ownerIdentity()) &&
        freshnessIsSynchronous && freshness !== false,
    );
    if (!valid) {
      if (candidate && candidate.sequence < sequence - 1)
        pendingStartNewChat = null;
      return null;
    }
    candidate.consumed = true;
    return candidate;
  }

  async function clearSourceAfterTransition(candidate) {
    const controller = new AbortController();
    const sourceOwner = {
      ...cloneValue(candidate.sourceOwner),
      sourceTargeted: true,
      source_targeted: true,
      transitionToken: candidate.token,
    };
    await eventAnalysis.invalidateForClear?.({
      reason: "start-new-chat-source",
      owner: sourceOwner,
      transitionToken: candidate.token,
    });
    let result;
    try {
      result = await clearService.clearSourceChatBioWeave(sourceOwner, {
        signal: controller.signal,
        source: true,
      });
    } catch (error) {
      result = {
        ok: false,
        changed: false,
        operation: "all",
        chatId: candidate.sourceChatId,
        sourceTargeted: true,
        error_code: error?.code ?? error?.message ?? "SOURCE_CLEAR_FAILED",
        persistence: { commitState: "failed", attempted: false },
      };
    }
    try {
      await eventAnalysis.completeClear?.(result);
    } catch (error) {
      if (result.ok) console.error("[BioWeave] source clear refresh failed", error);
    }
    if (
      result?.ok !== true ||
      result?.persistence?.commitState !== "confirmed"
    ) {
      failedSourceClears.set(candidate.sourceChatId, {
        owner: sourceOwner,
        result,
        transitionToken: candidate.token,
      });
    } else {
      failedSourceClears.delete(candidate.sourceChatId);
    }
    clearNotification(result, "clearSourceChatBioWeave");
    return result;
  }

  function handleLifecycleEvent(key, eventType, payload) {
    const sequence = ++lifecycleSequence;
    const epochBefore = chat.getEpoch();
    const previousOwner = activeOwner;
    const chatId = chat.current();
    const chatChanged = chat.getEpoch() !== epochBefore;
    let sourceTransition = null;
    if (key === "CHAT_CHANGED" && chatChanged) {
      prepareStartNewChatTransition(
        sequence,
        epochBefore,
        previousOwner,
        chatId,
        payload,
      );
    } else if (key === "CHAT_CREATED") {
      sourceTransition = consumeStartNewChatTransition(sequence, payload);
    } else if (chatChanged) {
      pendingStartNewChat = null;
      activeOwner = captureCurrentOwner(chatId) ?? activeOwner;
    }
    notify({
      type: key,
      eventType,
      payload,
      chatId,
      epoch: chat.getEpoch(),
      chatChanged,
    });
    const work = lifecycleTail.then(
      async () => {
        if (sourceTransition) await clearSourceAfterTransition(sourceTransition);
        try {
          await eventAnalysis.handleLifecycleEvent({
            type: key,
            eventType,
            payload,
            chatId,
          });
        } catch (error) {
          if (!["STALE_CHAT", "MESSAGE_NOT_FOUND"].includes(error?.message))
            console.error("[BioWeave] event analysis lifecycle failed", error);
        }
        await refreshActiveOwner(chat.current());
        notifyLifecycleSettled(key, eventType, payload);
      },
      async () => {
        if (sourceTransition) await clearSourceAfterTransition(sourceTransition);
        await refreshActiveOwner(chat.current());
        notifyLifecycleSettled(key, eventType, payload);
      },
    );
    lifecycleTail = work.catch(() => null);
  }

  function bindLifecycleEvents() {
    const context = st.getContext?.();
    const source = context?.eventSource;
    const types = context?.eventTypes;
    if (
      !source ||
      typeof source.on !== "function" ||
      typeof source.removeListener !== "function"
    ) {
      return;
    }
    const boundEventTypes = new Set();
    for (const key of LIFECYCLE_EVENTS) {
      const eventType = types?.[key];
      if (eventType == null || boundEventTypes.has(eventType)) continue;
      const listener = (payload) =>
        handleLifecycleEvent(key, eventType, payload);
      source.on(eventType, listener);
      boundEventTypes.add(eventType);
      unbind.push(() => source.removeListener(eventType, listener));
    }
  }

  async function init() {
    if (destroyed) return false;
    if (initialized) return true;
    const context = st.getContext?.();
    if (typeof st.getContext === "function" && !context) {
      console.error("[BioWeave] SillyTavern context unavailable");
      return false;
    }
    const currentChatId = chat.current();
    try {
      await st.refreshChatIndex?.(currentChatId);
    } catch (error) {
      // A missing chat index is intentionally fail-closed: without a
      // pre-boundary list, a later Chat change cannot prove Start New Chat.
      if (error?.code !== "SOURCE_OWNER_GROUP_UNSUPPORTED")
        console.warn("[BioWeave] Chat index unavailable; Start New Chat cleanup is disabled", error);
    }
    await refreshActiveOwner(currentChatId);
    await eventAnalysis.primeLifecycleSnapshot?.();
    bindLifecycleEvents();
    initialized = true;
    void eventAnalysis.refreshTrackingRegistry("init").catch((error) => {
      if (error?.message !== "STALE_CHAT") {
        console.error(
          "[BioWeave] initial tracking registry refresh failed",
          error,
        );
      }
    });
    return true;
  }

  function subscribe(listener) {
    if (typeof listener !== "function")
      throw new TypeError("RUNTIME_LISTENER_REQUIRED");
    subscriptions.add(listener);
    return () => subscriptions.delete(listener);
  }

  // These reads deliberately stay synchronous and side-effect free.  The UI
  // can ask for the current message/swipe facts after a lifecycle notification
  // without turning mount/open/reopen into an analysis request.
  function getActiveSwipeId(messageId) {
    return store.getActiveSwipeId?.(messageId) ?? null;
  }

  function getActiveFloor(messageId) {
    return store.getActiveFloor?.(messageId) ?? null;
  }

  function getActiveFloorEvents(messageId, version) {
    return store.getActiveFloorEvents?.(messageId, version) ?? [];
  }

  function clearCharacterData(target, options = {}) {
    return runClear("clearCharacterData", target, options);
  }

  function clearWorldData(target, options = {}) {
    return runClear("clearWorldData", target, options);
  }

  function clearAllBioWeaveData(target, options = {}) {
    return runClear("clearAllBioWeaveData", target, options);
  }

  function clearSourceChatBioWeave(target, options = {}) {
    return runClear("clearSourceChatBioWeave", target, {
      ...options,
      source: true,
    });
  }

  function clearBioWeaveData(domain = "all", target, options = {}) {
    if (domain && typeof domain === "object") {
      options = domain;
      domain = options.domain ?? options.operation ?? "all";
      target = options.target ?? options.owner;
    }
    const normalized = String(domain).toLowerCase();
    if (normalized === "character") return clearCharacterData(target, options);
    if (normalized === "world") return clearWorldData(target, options);
    return clearAllBioWeaveData(target, options);
  }

  const dataLifecycle = {
    clearCharacterData,
    clearWorldData,
    clearAllBioWeaveData,
    clearSourceChatBioWeave,
    clearBioWeaveData,
  };

  function destroy() {
    if (destroyed) return;
    eventAnalysis.destroy();
    while (unbind.length) unbind.pop()();
    subscriptions.clear();
    chat.destroy();
    destroyed = true;
    initialized = false;
  }

  return {
    st,
    chat,
    store,
    init,
    subscribe,
    analyzeCurrentFloor: eventAnalysis.analyzeCurrentFloor,
    resolveCurrentBioWeaveFloor: eventAnalysis.resolveCurrentBioWeaveFloor,
    analyzeFloor: eventAnalysis.analyzeFloor,
    refreshCurrentFloorAnalysis: eventAnalysis.refreshCurrentFloorAnalysis,
    requestAbortCurrentFloorAnalysis:
      eventAnalysis.requestAbortCurrentFloorAnalysis,
    getCurrentFloorAnalysisStatus: eventAnalysis.getCurrentFloorAnalysisStatus,
    getCurrentFloorAnalysisInput: eventAnalysis.getCurrentFloorAnalysisInput,
    getCurrentFloorEvents: eventAnalysis.getCurrentFloorEvents,
    resolveWorldModelAtOrBefore: eventAnalysis.resolveWorldModelAtOrBefore,
    resolveWorldModelStrictlyBefore: eventAnalysis.resolveWorldModelStrictlyBefore,
    saveWorldModel: eventAnalysis.saveWorldModel,
    getTrackingRegistry: eventAnalysis.getTrackingRegistry,
    collectActiveBusinessData: eventAnalysis.collectActiveBusinessData,
    refreshTrackingRegistry: eventAnalysis.refreshTrackingRegistry,
    updateEvent: eventAnalysis.updateEvent,
    deleteEvent: eventAnalysis.deleteEvent,
    clearCharacterData,
    clearWorldData,
    clearAllBioWeaveData,
    clearSourceChatBioWeave,
    clearBioWeaveData,
    clearData: clearBioWeaveData,
    dataLifecycle,
    lifecycle: dataLifecycle,
    getFailedSourceClear: (chatId) => failedSourceClears.get(chatId) ?? null,
    getActiveSwipeId,
    getActiveFloor,
    getActiveFloorEvents,
    destroy,
  };
}
