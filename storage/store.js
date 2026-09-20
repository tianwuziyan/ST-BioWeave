import {
  API_ASSIGNMENTS,
  normalizeApiRequestSettings,
  FOLLOW_DEFAULT_API,
  SILLYTAVERN_CURRENT_API,
  cloneValue,
  emptyChat,
  emptyFloor,
  normalizeApiProfile,
  normalizeApiSource,
  normalizeAnalysisPrompt,
  normalizeCharacterRegistry,
  normalizeExtensionSettings,
  normalizeModelListCache,
  normalizeRecentStoryGlobalSettings,
  normalizeTrackingCandidates,
  normalizeTrackingSubjects,
  isStableApiProfileId,
  sanitizeSecrets,
} from "./schema.js";
import {
  floorVersionFromData as floorVersionFromStoredData,
  getActiveFloorEvents as filterActiveFloorEvents,
} from "../runtime/floor.js";

function staleChatError() {
  return new Error("STALE_CHAT");
}

function currentChatId(adapter, boundary) {
  return boundary ? boundary.current() : adapter.getChatId();
}

function captureToken(adapter, boundary) {
  return boundary?.token?.() ?? { chatId: adapter.getChatId() };
}

function assertToken(adapter, boundary, token) {
  if (boundary?.assert) {
    boundary.assert(token);
    return;
  }
  if (adapter.getChatId() !== token.chatId) throw staleChatError();
}

const CHAT_PROFILE_CONFIGURATION_FIELDS = new Set([
  "api_profiles",
  "api_model_caches",
  "profile_assignments",
  "assignments",
  "api_request_settings",
]);

function stripChatProfileConfiguration(value) {
  if (Array.isArray(value)) return value.map(stripChatProfileConfiguration);
  if (!value || typeof value !== "object") return value;
  const safe = {};
  for (const [key, item] of Object.entries(value)) {
    if (CHAT_PROFILE_CONFIGURATION_FIELDS.has(key)) continue;
    safe[key] = stripChatProfileConfiguration(item);
  }
  return safe;
}

function cloneForStorage(value) {
  return stripChatProfileConfiguration(sanitizeSecrets(cloneValue(value)));
}

function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function profileIdFrom(value) {
  const id =
    typeof value === "string" ? value : (value?.profile_id ?? value?.id);
  return typeof id === "string" ? id.trim() : "";
}

function profileInputWithLegacyProvider(raw, existing) {
  const source = raw && typeof raw === "object" ? raw : {};
  const suppliedProvider =
    typeof source.provider === "string" ? source.provider.trim() : "";
  const existingProvider =
    typeof existing?.provider === "string" ? existing.provider.trim() : "";
  const provider = suppliedProvider || existingProvider;
  return provider ? { ...source, provider } : source;
}

function readGlobalSettings(adapter) {
  if (typeof adapter.getGlobalSettings === "function")
    return adapter.getGlobalSettings() ?? {};
  const extensionSettings = adapter.getExtensionSettings?.();
  if (
    extensionSettings?.bioweave &&
    typeof extensionSettings.bioweave === "object"
  ) {
    return extensionSettings.bioweave;
  }
  return extensionSettings ?? {};
}

async function saveGlobalSettings(adapter, value) {
  if (typeof adapter.saveGlobalSettings === "function") {
    await adapter.saveGlobalSettings(value);
    return;
  }
  if (typeof adapter.saveExtensionSettings === "function") {
    await adapter.saveExtensionSettings(value);
    return;
  }
  throw new Error("ST_EXTENSION_SETTINGS_UNAVAILABLE");
}

function requestHeaders(getRequestHeaders) {
  let headers = {};
  try {
    headers = getRequestHeaders?.() ?? {};
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

function statusError(prefix, response) {
  return new Error(`${prefix}_${Number(response?.status) || 0}`);
}

/**
 * Secret 值刻意限制为只写入/删除。宿主在发起请求时解析不透明 ID，
 * 因此浏览器不会调用 /find。
 */
export function createSecretStore({
  fetchRef = globalThis.fetch,
  getRequestHeaders,
  // 与 SillyTavern SECRET_KEYS.CUSTOM 保持一致；后端 custom source 会用同一 key 解析 secret_id。
  secretKey = "api_key_custom",
  endpoint = "/api/secrets",
} = {}) {
  async function write(value, label = "BioWeave API Profile") {
    const secretValue = typeof value === "string" ? value : "";
    if (!secretValue) return null;
    if (typeof fetchRef !== "function")
      throw new Error("ST_SECRET_STORAGE_UNAVAILABLE");
    let response;
    try {
      response = await fetchRef(`${endpoint}/write`, {
        method: "POST",
        headers: requestHeaders(getRequestHeaders),
        body: JSON.stringify({
          key: secretKey,
          value: secretValue,
          label: String(label || "BioWeave API Profile").slice(0, 120),
        }),
      });
    } catch {
      throw new Error("ST_SECRET_WRITE_FAILED");
    }
    if (!response?.ok) throw statusError("ST_SECRET_WRITE_FAILED", response);
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("ST_SECRET_WRITE_INVALID_RESPONSE");
    }
    const id = typeof result?.id === "string" ? result.id.trim() : "";
    if (!id) throw new Error("ST_SECRET_WRITE_INVALID_RESPONSE");
    return id;
  }

  async function remove(secretRef) {
    const id = typeof secretRef === "string" ? secretRef.trim() : "";
    if (!id) return false;
    if (typeof fetchRef !== "function")
      throw new Error("ST_SECRET_STORAGE_UNAVAILABLE");
    let response;
    try {
      response = await fetchRef(`${endpoint}/delete`, {
        method: "POST",
        headers: requestHeaders(getRequestHeaders),
        body: JSON.stringify({ key: secretKey, id }),
      });
    } catch {
      throw new Error("ST_SECRET_DELETE_FAILED");
    }
    if (!response?.ok) throw statusError("ST_SECRET_DELETE_FAILED", response);
    return true;
  }

  return {
    write,
    set: write,
    setSecret: write,
    remove,
    delete: remove,
    deleteSecret: remove,
    get() {
      throw new Error("ST_SECRET_READ_DISABLED");
    },
  };
}

function secretWriter(secretStore) {
  return secretStore?.write ?? secretStore?.set ?? secretStore?.setSecret;
}

function secretRemover(secretStore) {
  return (
    secretStore?.remove ?? secretStore?.deleteSecret ?? secretStore?.delete
  );
}

async function removeSecretOrThrow(secretStore, secretRef) {
  const remover = secretRemover(secretStore);
  if (typeof remover !== "function") {
    throw new Error("ST_SECRET_DELETE_FAILED");
  }
  try {
    await remover.call(secretStore, secretRef);
  } catch (error) {
    if (error?.code === "ST_SECRET_DELETE_FAILED") throw error;
    throw new Error("ST_SECRET_DELETE_FAILED");
  }
}

function secretRefUsed(settings, secretRef, exceptProfileId = "") {
  if (!secretRef) return false;
  return Object.values(settings.api_profiles ?? {}).some(
    (profile) =>
      profile.profile_id !== exceptProfileId &&
      profile.secret_ref === secretRef,
  );
}

function keyInput(raw) {
  if (hasOwn(raw, "api_key")) return raw.api_key;
  if (hasOwn(raw, "apiKey")) return raw.apiKey;
  return undefined;
}

function clearSecretRequested(raw) {
  return raw?.clear_secret === true || raw?.clearSecret === true;
}

export function createApiProfileStore(adapter, { secretStore = null } = {}) {
  if (!adapter || typeof adapter !== "object")
    throw new TypeError("PROFILE_ADAPTER_REQUIRED");
  const secrets =
    secretStore ??
    createSecretStore({
      fetchRef: adapter.fetch ?? globalThis.fetch,
      getRequestHeaders: adapter.getRequestHeaders,
    });

  function read() {
    return normalizeExtensionSettings(readGlobalSettings(adapter));
  }

  async function write(settings) {
    await saveGlobalSettings(adapter, normalizeExtensionSettings(settings));
  }

  function getSettings() {
    return cloneValue(read());
  }

  function listProfiles() {
    return Object.values(read().api_profiles).map(cloneValue);
  }

  function getProfile(profileId) {
    const id = profileIdFrom(profileId);
    const profile = read().api_profiles[id];
    return profile ? cloneValue(profile) : null;
  }

  function getModelListCache(profileId) {
    const id = profileIdFrom(profileId);
    if (!isStableApiProfileId(id)) return null;
    const settings = read();
    if (!settings.api_profiles[id]) return null;
    const cache = settings.api_model_caches?.[id];
    return cache ? cloneValue(cache) : null;
  }

  async function saveModelListCache(profileId, rawCache = {}) {
    const id = profileIdFrom(profileId);
    const settings = read();
    if (!isStableApiProfileId(id) || !settings.api_profiles[id])
      throw new Error("API_PROFILE_NOT_FOUND");
    const source =
      rawCache && typeof rawCache === "object" && !Array.isArray(rawCache)
        ? rawCache
        : {};
    const fallbackRefreshedAt = Object.prototype.hasOwnProperty.call(
      source,
      "refreshed_at",
    )
      ? 0
      : Date.now();
    const cache = normalizeModelListCache(source, {
      profileId: id,
      fallbackRefreshedAt,
    });
    await write({
      ...settings,
      api_model_caches: {
        ...settings.api_model_caches,
        [id]: cache,
      },
    });
    return cloneValue(cache);
  }

  async function saveProfile(raw = {}) {
    const settings = read();
    const requestedId = profileIdFrom(raw);
    const existing = requestedId ? settings.api_profiles[requestedId] : null;
    const profileInput = profileInputWithLegacyProvider(raw, existing);
    const profile = normalizeApiProfile(profileInput, {
      profileId: requestedId || null,
    });
    if (!profile.api_url || !profile.model)
      throw new Error("API_PROFILE_INVALID");
    const oldSecretRef = existing?.secret_ref ?? null;
    const suppliedKey = keyInput(raw);
    const hasNewKey =
      typeof suppliedKey === "string" && suppliedKey.trim().length > 0;
    const shouldClear = clearSecretRequested(raw);
    let nextSecretRef = oldSecretRef;
    let newlyWrittenRef = null;

    if (hasNewKey) {
      const writeSecret = secretWriter(secrets);
      if (typeof writeSecret !== "function")
        throw new Error("ST_SECRET_STORAGE_UNAVAILABLE");
      // 不把用户可编辑的 Profile 名称传给 Secret Store，避免误把 Key 写进 label。
      newlyWrittenRef = await writeSecret.call(secrets, suppliedKey.trim());
      if (!newlyWrittenRef) throw new Error("ST_SECRET_WRITE_INVALID_RESPONSE");
      nextSecretRef = newlyWrittenRef;
    } else if (shouldClear) {
      nextSecretRef = null;
    }

    const nextSettings = {
      ...settings,
      api_profiles: {
        ...settings.api_profiles,
        [profile.profile_id]: { ...profile, secret_ref: nextSecretRef },
      },
    };

    try {
      await write(nextSettings);
    } catch (error) {
      if (newlyWrittenRef && newlyWrittenRef !== oldSecretRef) {
        try {
          await secretRemover(secrets)?.call(secrets, newlyWrittenRef);
        } catch {
          // 持久化失败时保留旧 Profile/引用，确保原配置仍可使用。
        }
      }
      throw error;
    }

    if (
      oldSecretRef &&
      oldSecretRef !== nextSecretRef &&
      !secretRefUsed(nextSettings, oldSecretRef, profile.profile_id)
    ) {
      try {
        await removeSecretOrThrow(secrets, oldSecretRef);
      } catch (error) {
        // Profile 已经指向新引用；不要回滚并重新暴露旧 Secret，但必须让 UI
        // 知道清理失败，便于用户重试或在宿主 Secret Store 中处理残留。
        throw error;
      }
    }
    return cloneValue(nextSettings.api_profiles[profile.profile_id]);
  }

  function getApiRequestSettings() {
    return cloneValue(read().api_request_settings);
  }

  async function saveApiRequestSettings(raw = {}) {
    const settings = read();
    const requestSettings = normalizeApiRequestSettings(raw);
    await write({ ...settings, api_request_settings: requestSettings });
    return cloneValue(requestSettings);
  }

  async function withTestProfile(raw = {}, callback, options = {}) {
    if (typeof callback !== "function")
      throw new TypeError("PROFILE_TEST_CALLBACK_REQUIRED");
    const settings = read();
    const requestedId = profileIdFrom(raw);
    const existing = requestedId ? settings.api_profiles[requestedId] : null;
    const profileInput = profileInputWithLegacyProvider(raw, existing);
    const profile = normalizeApiProfile(profileInput, {
      profileId: requestedId || null,
      secretRef: existing?.secret_ref ?? null,
    });
    const requireModel = options?.requireModel !== false;
    if (!profile.api_url || (requireModel && !profile.model))
      throw new Error("API_PROFILE_INVALID");

    const suppliedKey = keyInput(raw);
    const hasNewKey =
      typeof suppliedKey === "string" && suppliedKey.trim().length > 0;
    const shouldClear = clearSecretRequested(raw);
    let temporarySecretRef = null;

    if (hasNewKey) {
      const writeSecret = secretWriter(secrets);
      if (typeof writeSecret !== "function")
        throw new Error("ST_SECRET_STORAGE_UNAVAILABLE");
      temporarySecretRef = await writeSecret.call(secrets, suppliedKey.trim());
      if (!temporarySecretRef)
        throw new Error("ST_SECRET_WRITE_INVALID_RESPONSE");
      profile.secret_ref = temporarySecretRef;
    } else if (shouldClear) {
      profile.secret_ref = null;
    }

    try {
      return await callback(cloneValue(profile));
    } finally {
      if (temporarySecretRef)
        await removeSecretOrThrow(secrets, temporarySecretRef);
    }
  }

  async function deleteProfile(profileId) {
    const id = profileIdFrom(profileId);
    if (!id) return false;
    const settings = read();
    const existing = settings.api_profiles[id];
    if (!existing) return false;
    const profiles = { ...settings.api_profiles };
    delete profiles[id];
    const assignments = { ...settings.assignments };
    for (const slot of API_ASSIGNMENTS) {
      if (assignments[slot] === id) assignments[slot] = null;
    }
    const apiModelCaches = { ...settings.api_model_caches };
    delete apiModelCaches[id];
    const nextSettings = {
      ...settings,
      api_profiles: profiles,
      assignments,
      api_model_caches: apiModelCaches,
    };
    await write(nextSettings);
    if (
      existing.secret_ref &&
      !secretRefUsed(nextSettings, existing.secret_ref)
    ) {
      await removeSecretOrThrow(secrets, existing.secret_ref);
    }
    return true;
  }

  async function setAssignment(slot, value) {
    if (!API_ASSIGNMENTS.includes(slot))
      throw new Error("API_ASSIGNMENT_INVALID");
    const settings = read();
    let nextValue = typeof value === "string" ? value.trim() : "";
    if (!nextValue) nextValue = null;
    else if (
      nextValue.toLowerCase() === FOLLOW_DEFAULT_API ||
      nextValue.toLowerCase() === "follow_default" ||
      nextValue.toLowerCase() === "default_api"
    ) {
      nextValue = FOLLOW_DEFAULT_API;
    } else if (
      nextValue.toLowerCase() === SILLYTAVERN_CURRENT_API ||
      nextValue.toLowerCase() === "current"
    ) {
      nextValue = SILLYTAVERN_CURRENT_API;
    } else if (!settings.api_profiles[nextValue]) {
      throw new Error("API_PROFILE_NOT_FOUND");
    }
    const nextSettings = {
      ...settings,
      assignments: { ...settings.assignments, [slot]: nextValue },
    };
    await write(nextSettings);
    return nextValue;
  }

  async function setApiSource(value) {
    const nextValue = normalizeApiSource(value);
    const settings = read();
    await write({ ...settings, api_source: nextValue });
    return nextValue;
  }

  async function setDefaultProfile(profileId) {
    const settings = read();
    const nextValue = profileIdFrom(profileId) || null;
    if (nextValue && !settings.api_profiles[nextValue])
      throw new Error("API_PROFILE_NOT_FOUND");
    await write({ ...settings, default_profile_id: nextValue });
    return nextValue;
  }

  function getAnalysisPrompt() {
    return cloneValue(read().analysis_prompt);
  }

  async function saveAnalysisPrompt(raw = {}) {
    const settings = read();
    const source = raw && typeof raw === "object" ? raw : {};
    const merged = { ...settings.analysis_prompt };
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined) merged[key] = value;
    }
    if (
      source.labels &&
      typeof source.labels === "object" &&
      !Array.isArray(source.labels)
    ) {
      merged.labels = { ...settings.analysis_prompt.labels, ...source.labels };
    }
    const prompt = normalizeAnalysisPrompt(merged);
    const nextSettings = { ...settings, analysis_prompt: prompt };
    delete nextSettings.world_analysis_prompt;
    await write(nextSettings);
    return cloneValue(prompt);
  }

  // 旧调用方兼容别名；实际读写已经迁移到 analysis_prompt。
  const getWorldAnalysisPrompt = getAnalysisPrompt;
  const saveWorldAnalysisPrompt = saveAnalysisPrompt;

  function getRecentStoryGlobal() {
    return cloneValue(read().recent_story_global);
  }

  async function saveRecentStoryGlobal(raw = {}) {
    const settings = read();
    const recentStoryGlobal = normalizeRecentStoryGlobalSettings(raw);
    await write({ ...settings, recent_story_global: recentStoryGlobal });
    return cloneValue(recentStoryGlobal);
  }

  return {
    getSettings,
    listProfiles,
    getProfile,
    getModelListCache,
    saveModelListCache,
    saveProfile,
    upsertProfile: saveProfile,
    getApiRequestSettings,
    saveApiRequestSettings,
    withTestProfile,
    deleteProfile,
    removeProfile: deleteProfile,
    setAssignment,
    setApiSource,
    setDefaultProfile,
    getAnalysisPrompt,
    saveAnalysisPrompt,
    getWorldAnalysisPrompt,
    saveWorldAnalysisPrompt,
    getRecentStoryGlobal,
    saveRecentStoryGlobal,
    getAssignment(slot) {
      if (!API_ASSIGNMENTS.includes(slot)) return null;
      return read().assignments[slot] ?? null;
    },
  };
}

export const createProfileStore = createApiProfileStore;

function hasMatchingFloorScope(data, chatId) {
  const version = floorVersionFromStoredData(data);
  return !version?.chat_id || version.chat_id === chatId;
}

function normalizeFloorData(data) {
  const source =
    data && typeof data === "object" && !Array.isArray(data) ? data : {};
  return {
    ...source,
    character_registry: normalizeCharacterRegistry(source.character_registry),
  };
}

export function hasSwipeStructure(message) {
  return (
    Array.isArray(message?.swipes) ||
    Boolean(message?.swipe_info && typeof message.swipe_info === "object")
  );
}

function normalizedSwipeId(swipeId) {
  if (Number.isInteger(swipeId) && swipeId >= 0) return swipeId;
  if (typeof swipeId === "string" && /^\d+$/u.test(swipeId.trim()))
    return Number(swipeId);
  return null;
}

function hasIndexedValue(container, swipeId) {
  return Boolean(
    container &&
    typeof container === "object" &&
    Object.prototype.hasOwnProperty.call(container, swipeId) &&
    container[swipeId] !== undefined &&
    container[swipeId] !== null,
  );
}

export function hasSwipeSlot(message, swipeId) {
  if (!hasSwipeStructure(message)) return true;
  const targetSwipeId = normalizedSwipeId(swipeId);
  if (targetSwipeId === null) return false;
  if (message?.swipes && typeof message.swipes === "object")
    return hasIndexedValue(message.swipes, targetSwipeId);
  return hasIndexedValue(message?.swipe_info, targetSwipeId);
}

export function activeSwipeId(message, fallback = 0) {
  if (!hasSwipeStructure(message)) return 0;
  const targetSwipeId =
    normalizedSwipeId(message.swipe_id) ?? normalizedSwipeId(fallback);
  return targetSwipeId !== null && hasSwipeSlot(message, targetSwipeId)
    ? targetSwipeId
    : null;
}

export const getActiveSwipeId = activeSwipeId;

function validSwipeId(swipeId) {
  return normalizedSwipeId(swipeId) ?? 0;
}

function readAdapterRevision(adapter, chatId) {
  const readers = [
    adapter?.getChatRevision,
    adapter?.getRevision,
    adapter?.getChatStateRevision,
  ];
  for (const reader of readers) {
    if (typeof reader !== "function") continue;
    const value = reader.call(adapter, chatId);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function sourceReader(adapter) {
  return [
    "readChatOwner",
    "readChatSnapshot",
    "readChatState",
    "getChatOwnerSnapshot",
    "getChatSnapshot",
    "getChatStateByOwner",
  ].find((name) => typeof adapter?.[name] === "function");
}

function sourceWriter(adapter) {
  return [
    "compareAndSaveChatOwner",
    "compareAndSwapChatOwner",
    "saveChatOwnerCAS",
    "commitChatOwnerCAS",
    "saveChatOwner",
    "saveChatSnapshot",
    "saveChatStateByOwner",
    "commitChatOwner",
  ].find((name) => typeof adapter?.[name] === "function");
}

function sourceWriterSupportsRevisionCAS(adapter, writerName) {
  const canonicalCASWriters = new Set([
    "compareAndSaveChatOwner",
    "compareAndSwapChatOwner",
    "saveChatOwnerCAS",
    "commitChatOwnerCAS",
  ]);
  return Boolean(
    canonicalCASWriters.has(writerName) ||
      adapter?.sourceOwnerRevisionCAS === true ||
      adapter?.supportsSourceOwnerRevisionCAS === true ||
      adapter?.capabilities?.sourceOwnerRevisionCAS === true ||
      adapter?.sourceOwnerLatestMerge === true ||
      adapter?.supportsSourceOwnerLatestMerge === true ||
      adapter?.capabilities?.sourceOwnerLatestMerge === true ||
      adapter?.[writerName]?.supportsRevisionCAS === true,
  );
}

function atomicBioWeaveWriter(adapter) {
  return [
    "commitBioWeaveMutation",
    "saveBioWeaveState",
    "saveChatBioWeaveState",
  ].find((name) => typeof adapter?.[name] === "function");
}

function normalizeOwnerId(owner) {
  const value =
    typeof owner === "string"
      ? owner
      : owner?.chatId ?? owner?.chat_id ?? owner?.owner?.chatId ?? owner?.owner?.chat_id;
  return typeof value === "string" ? value.trim() : value ?? null;
}

function normalizeOwnerState(raw, owner, { requireRevision = false } = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const chatId = normalizeOwnerId(source) ?? normalizeOwnerId(owner);
  const revision =
    source.revision ??
    source.sourceRevision ??
    source.source_revision ??
    source.owner?.revision;
  const metadata = source.chatMetadata ?? source.metadata ?? {};
  const messages = source.messages ?? source.chat ?? [];
  if (!chatId) throw new Error("CHAT_OWNER_REQUIRED");
  if (!metadata || typeof metadata !== "object")
    throw new Error("CHAT_METADATA_INVALID");
  if (!Array.isArray(messages)) throw new Error("CHAT_MESSAGES_INVALID");
  if (requireRevision && (revision === undefined || revision === null)) {
    throw new Error("SOURCE_REVISION_UNVERIFIED");
  }
  return {
    owner: {
      chatId,
      characterId:
        source.characterId ?? source.character_id ?? source.owner?.characterId ?? null,
      groupId: source.groupId ?? source.group_id ?? source.owner?.groupId ?? null,
      revision,
    },
    chatId,
    revision,
    header: cloneValue(source.header),
    chatMetadata: cloneValue(metadata),
    metadata: cloneValue(metadata),
    chat: cloneValue(messages),
    messages: cloneValue(messages),
    bioweave: cloneValue(metadata.bioweave),
  };
}

export function createStore(adapter, boundary = null) {
  if (!adapter || typeof adapter.getChatId !== "function") {
    throw new TypeError("STORAGE_ADAPTER_REQUIRED");
  }

  function getChat(chatId) {
    if (currentChatId(adapter, boundary) !== chatId) return emptyChat(chatId);
    const metadata = adapter.getChatMetadata?.();
    const stored = metadata?.bioweave;
    if (stored?.chat_scope?.chat_id !== chatId) return emptyChat(chatId);
    const normalized = {
      ...stored,
      character_registry: normalizeCharacterRegistry(stored.character_registry),
      tracking_subjects: normalizeTrackingSubjects(stored.tracking_subjects),
      tracking_candidates: normalizeTrackingCandidates(
        stored.tracking_candidates,
      ),
    };
    // Legacy Chat-level World Model fields remain ignored compatibility
    // residue. They are deliberately not exposed as runtime state.
    delete normalized.world_model;
    delete normalized.world_model_meta;
    return cloneForStorage(normalized);
  }

  async function saveChat(chatId, data) {
    if (data?.chat_scope?.chat_id !== chatId)
      throw new Error("CHAT_SCOPE_MISMATCH");
    if (typeof adapter.saveChatMetadata !== "function")
      throw new Error("ST_METADATA_STORAGE_UNAVAILABLE");
    const token = captureToken(adapter, boundary);
    if (token.chatId !== chatId) throw staleChatError();
    const safeData = {
      ...data,
      character_registry: normalizeCharacterRegistry(data?.character_registry),
      tracking_subjects: normalizeTrackingSubjects(data?.tracking_subjects),
      tracking_candidates: normalizeTrackingCandidates(
        data?.tracking_candidates,
      ),
    };
    delete safeData.world_model;
    delete safeData.world_model_meta;
    await adapter.saveChatMetadata("bioweave", cloneForStorage(safeData), token.chatId);
    assertToken(adapter, boundary, token);
  }

  function getFloor(messageId, swipeId = 0) {
    const message = adapter.getMessage?.(messageId);
    if (!message) return null;
    const targetSwipeId = validSwipeId(swipeId);
    if (hasSwipeStructure(message) && !hasSwipeSlot(message, targetSwipeId))
      return emptyFloor();
    // The message/per-Swipe slot owns Floor facts; active reads select one slot. See .trellis/spec/domain/floor-state.md.
    const stored = hasSwipeStructure(message)
      ? message.swipe_info?.[targetSwipeId]?.extra?.bioweave
      : message.extra?.bioweave;
    if (
      !stored ||
      !hasMatchingFloorScope(stored, currentChatId(adapter, boundary))
    ) {
      return emptyFloor();
    }
    return cloneForStorage(normalizeFloorData(stored));
  }

  function getActiveSwipe(messageId) {
    const message = adapter.getMessage?.(messageId);
    return message ? activeSwipeId(message) : null;
  }

  function getActiveFloor(messageId) {
    const swipeId = getActiveSwipe(messageId);
    return swipeId === null ? null : getFloor(messageId, swipeId);
  }

  function getActiveFloorEvents(messageId, version) {
    return filterActiveFloorEvents(getActiveFloor(messageId), version);
  }

  function getTrackingSubjects(chatId) {
    return cloneValue(
      normalizeTrackingSubjects(getChat(chatId).tracking_subjects),
    );
  }

  function getTrackingCandidates(chatId) {
    return cloneValue(
      normalizeTrackingCandidates(getChat(chatId).tracking_candidates),
    );
  }

  async function saveTrackingSubjects(chatId, registry) {
    const chat = getChat(chatId);
    const trackingSubjects = normalizeTrackingSubjects(
      registry?.tracking_subjects ?? registry,
    );
    const nextChat = { ...chat, tracking_subjects: trackingSubjects };
    if (
      registry &&
      typeof registry === "object" &&
      Object.prototype.hasOwnProperty.call(registry, "tracking_candidates")
    ) {
      nextChat.tracking_candidates = cloneValue(
        normalizeTrackingCandidates(registry.tracking_candidates),
      );
    }
    if (
      registry &&
      typeof registry === "object" &&
      Object.prototype.hasOwnProperty.call(registry, "character_profiles")
    ) {
      nextChat.character_profiles = cloneValue(registry.character_profiles);
    }
    if (
      registry &&
      typeof registry === "object" &&
      Object.prototype.hasOwnProperty.call(registry, "character_registry")
    ) {
      nextChat.character_registry = normalizeCharacterRegistry(
        registry.character_registry,
      );
    }
    await saveChat(chatId, nextChat);
    return cloneValue(trackingSubjects);
  }

  async function saveTrackingCandidates(chatId, registry) {
    const chat = getChat(chatId);
    const trackingCandidates = normalizeTrackingCandidates(
      registry?.tracking_candidates ?? registry,
    );
    const nextChat = { ...chat, tracking_candidates: trackingCandidates };
    if (
      registry &&
      typeof registry === "object" &&
      Object.prototype.hasOwnProperty.call(registry, "tracking_subjects")
    ) {
      nextChat.tracking_subjects = cloneValue(
        normalizeTrackingSubjects(registry.tracking_subjects),
      );
    }
    if (
      registry &&
      typeof registry === "object" &&
      Object.prototype.hasOwnProperty.call(registry, "character_profiles")
    ) {
      nextChat.character_profiles = cloneValue(registry.character_profiles);
    }
    if (
      registry &&
      typeof registry === "object" &&
      Object.prototype.hasOwnProperty.call(registry, "character_registry")
    ) {
      nextChat.character_registry = normalizeCharacterRegistry(
        registry.character_registry,
      );
    }
    await saveChat(chatId, nextChat);
    return cloneValue(trackingCandidates);
  }

  async function saveFloor(messageId, swipeId, data) {
    const targetSwipeId = validSwipeId(swipeId);
    const message = adapter.getMessage?.(messageId);
    if (
      message &&
      hasSwipeStructure(message) &&
      !hasSwipeSlot(message, targetSwipeId)
    )
      throw new Error("SWIPE_NOT_FOUND");
    const token = captureToken(adapter, boundary);
    const version = floorVersionFromStoredData(data);
    if (version?.chat_id && version.chat_id !== token.chatId)
      throw new Error("CHAT_SCOPE_MISMATCH");
    const safeData = cloneForStorage(normalizeFloorData(data));
    if (typeof adapter.saveFloorBioWeave !== "function") {
      throw new Error("ST_FLOOR_STORAGE_UNAVAILABLE");
    }
    await adapter.saveFloorBioWeave(
      messageId,
      targetSwipeId,
      safeData,
      token.chatId,
    );
    assertToken(adapter, boundary, token);
  }

  function getCurrentChatOwnerSnapshot(chatId = currentChatId(adapter, boundary)) {
    if (currentChatId(adapter, boundary) !== chatId) throw staleChatError();
    const metadata = adapter.getChatMetadata?.() ?? {};
    const messages = adapter.getChat?.() ?? [];
    if (!Array.isArray(messages)) throw new Error("CHAT_MESSAGES_INVALID");
    return normalizeOwnerState(
      {
        chatId,
        revision: readAdapterRevision(adapter, chatId),
        chatMetadata: metadata,
        messages,
      },
      { chatId },
    );
  }

  // Source-targeted reads are intentionally separate from getChatMetadata()
  // and getChat().  A source clear must never fall back to the mutable current
  // host context after a Chat boundary.
  async function readChatOwnerSnapshot(owner, { source = true } = {}) {
    const chatId = normalizeOwnerId(owner);
    if (!chatId) throw new Error("CHAT_OWNER_REQUIRED");
    if (!source) return getCurrentChatOwnerSnapshot(chatId);
    const readerName = sourceReader(adapter);
    if (!readerName) throw new Error("SOURCE_OWNER_ADAPTER_UNAVAILABLE");
    const raw = await adapter[readerName].call(adapter, {
      chatId,
      chat_id: chatId,
      owner: cloneValue(owner),
    });
    return normalizeOwnerState(raw, owner, { requireRevision: true });
  }

  function applyBioWeavePlanToCurrent(plan, { restore = false } = {}) {
    const chatId = plan?.chatId ?? normalizeOwnerId(plan?.owner);
    if (!chatId || currentChatId(adapter, boundary) !== chatId)
      throw staleChatError();
    const metadata = adapter.getChatMetadata?.();
    const liveMessages = adapter.getChat?.();
    if (!metadata || !Array.isArray(liveMessages))
      throw new Error("ST_CHAT_STORAGE_UNAVAILABLE");
    const chatRoot = restore ? plan.previous?.chatRoot : plan.chat?.after;
    const previousRoot = restore ? plan.chat?.after : plan.chat?.before;
    if (chatRoot === undefined) {
      delete metadata.bioweave;
    } else if (previousRoot === undefined) {
      metadata.bioweave = cloneValue(chatRoot);
    } else if (!plan.chat?.fields?.length) {
      // No Chat-root operation is part of this plan.  In particular, do not
      // overwrite a concurrent metadata update merely because a Floor slot is
      // being cleared.
    } else {
      const liveRoot = metadata.bioweave;
      if (!liveRoot || typeof liveRoot !== "object")
        throw new Error("CHAT_ROOT_CHANGED");
      for (const field of plan.chat.fields) {
        if (field === "data_lifecycle.character_reset") {
          const marker = chatRoot?.data_lifecycle?.character_reset;
          liveRoot.data_lifecycle ??= {};
          if (marker === undefined) delete liveRoot.data_lifecycle.character_reset;
          else liveRoot.data_lifecycle.character_reset = cloneValue(marker);
          continue;
        }
        if (Object.prototype.hasOwnProperty.call(chatRoot, field))
          liveRoot[field] = cloneValue(chatRoot[field]);
        else delete liveRoot[field];
      }
    }
    for (const slot of plan.slots ?? []) {
      if (!slot.changed) continue;
      const message = liveMessages[slot.messageIndex];
      if (!message || String(message.message_id ?? slot.messageId) !== String(slot.messageId))
        throw new Error("MESSAGE_OWNER_CHANGED");
      const next = restore ? slot.before : slot.after;
      if (slot.kind === "message_extra") {
        if (next === undefined) delete message.extra?.bioweave;
        else {
          message.extra ??= {};
          message.extra.bioweave = cloneValue(next);
        }
        continue;
      }
      const swipeInfo = message.swipe_info;
      if (!swipeInfo || typeof swipeInfo !== "object")
        throw new Error("SWIPE_OWNER_CHANGED");
      const swipe = swipeInfo[slot.swipeId];
      if (!swipe || typeof swipe !== "object")
        throw new Error("SWIPE_OWNER_CHANGED");
      if (next === undefined) delete swipe.extra?.bioweave;
      else {
        swipe.extra ??= {};
        swipe.extra.bioweave = cloneValue(next);
      }
    }
  }

  function restoreBioWeavePlanToCurrent(plan) {
    return applyBioWeavePlanToCurrent(plan, { restore: true });
  }

  async function saveSourceChatOwner(owner, state, options = {}) {
    const writerName = sourceWriter(adapter);
    if (!writerName) throw new Error("SOURCE_OWNER_ADAPTER_UNAVAILABLE");
    const chatId = normalizeOwnerId(owner);
    if (!chatId) throw new Error("CHAT_OWNER_REQUIRED");
    if (!sourceWriterSupportsRevisionCAS(adapter, writerName)) {
      const error = new Error("SOURCE_REVISION_CAS_UNVERIFIED");
      error.code = "SOURCE_REVISION_CAS_UNVERIFIED";
      throw error;
    }
    if (options.expectedRevision === undefined || options.expectedRevision === null) {
      const error = new Error("SOURCE_REVISION_UNVERIFIED");
      error.code = "SOURCE_REVISION_UNVERIFIED";
      throw error;
    }
    const payload = {
      owner: cloneValue(owner),
      chatId,
      chat_id: chatId,
      state: cloneValue(state),
      expectedRevision: options.expectedRevision,
      expected_revision: options.expectedRevision,
      plan: options.plan ? cloneValue(options.plan) : undefined,
      previous: options.previous ? cloneValue(options.previous) : undefined,
      signal: options.signal,
    };
    if (adapter[writerName].length >= 2)
      return adapter[writerName].call(adapter, cloneValue(owner), cloneValue(state), payload);
    return adapter[writerName].call(adapter, payload);
  }

  async function commitAtomicBioWeaveMutation(payload) {
    const writerName = atomicBioWeaveWriter(adapter);
    if (!writerName) throw new Error("ATOMIC_BIOWEAVE_ADAPTER_UNAVAILABLE");
    return adapter[writerName].call(adapter, cloneValue(payload));
  }

  const profileStore = createApiProfileStore(adapter);
  return {
    // Exposed only so storage services can share the same host boundary.  New
    // business code should still use the methods below rather than mutating
    // the adapter's message objects directly.
    adapter,
    getChat,
    saveChat,
    getFloor,
    getActiveSwipeId: getActiveSwipe,
    getActiveFloor,
    getActiveFloorEvents,
    getTrackingSubjects,
    getTrackingCandidates,
    saveTrackingSubjects,
    saveTrackingCandidates,
    saveFloor,
    getCurrentChatOwnerSnapshot,
    readChatOwnerSnapshot,
    applyBioWeavePlanToCurrent,
    restoreBioWeavePlanToCurrent,
    saveSourceChatOwner,
    commitAtomicBioWeaveMutation,
    profileStore,
    ...profileStore,
  };
}
