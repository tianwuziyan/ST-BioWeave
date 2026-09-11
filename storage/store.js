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
  normalizeExtensionSettings,
  normalizeRecentStoryGlobalSettings,
  normalizeTrackingSubjects,
  normalizeWorldAnalysisPrompt,
  sanitizeSecrets,
} from './schema.js';
import {
  floorVersionFromData as floorVersionFromStoredData,
  getActiveFloorEvents as filterActiveFloorEvents,
} from '../runtime/floor.js';

function staleChatError() {
  return new Error('STALE_CHAT');
}

function currentChatId(adapter, boundary) {
  return boundary ? boundary.current() : adapter.getChatId();
}

function captureToken(adapter, boundary) {
  return boundary?.token?.() ?? {chatId: adapter.getChatId()};
}

function assertToken(adapter, boundary, token) {
  if (boundary?.assert) {
    boundary.assert(token);
    return;
  }
  if (adapter.getChatId() !== token.chatId) throw staleChatError();
}

const CHAT_PROFILE_CONFIGURATION_FIELDS = new Set([
  'api_profiles',
  'profile_assignments',
  'assignments',
  'api_request_settings',
]);

function stripChatProfileConfiguration(value) {
  if (Array.isArray(value)) return value.map(stripChatProfileConfiguration);
  if (!value || typeof value !== 'object') return value;
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
  const id = typeof value === 'string' ? value : value?.profile_id ?? value?.id;
  return typeof id === 'string' ? id.trim() : '';
}

function readGlobalSettings(adapter) {
  if (typeof adapter.getGlobalSettings === 'function') return adapter.getGlobalSettings() ?? {};
  const extensionSettings = adapter.getExtensionSettings?.();
  if (extensionSettings?.bioweave && typeof extensionSettings.bioweave === 'object') {
    return extensionSettings.bioweave;
  }
  return extensionSettings ?? {};
}

async function saveGlobalSettings(adapter, value) {
  if (typeof adapter.saveGlobalSettings === 'function') {
    await adapter.saveGlobalSettings(value);
    return;
  }
  if (typeof adapter.saveExtensionSettings === 'function') {
    await adapter.saveExtensionSettings(value);
    return;
  }
  throw new Error('ST_EXTENSION_SETTINGS_UNAVAILABLE');
}

function requestHeaders(getRequestHeaders) {
  let headers = {};
  try {
    headers = getRequestHeaders?.() ?? {};
  } catch {
    headers = {};
  }
  const contentType = Object.keys(headers).find(key => key.toLowerCase() === 'content-type');
  return contentType ? headers : {...headers, 'Content-Type': 'application/json'};
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
  secretKey = 'api_key_custom',
  endpoint = '/api/secrets',
} = {}) {
  async function write(value, label = 'BioWeave API Profile') {
    const secretValue = typeof value === 'string' ? value : '';
    if (!secretValue) return null;
    if (typeof fetchRef !== 'function') throw new Error('ST_SECRET_STORAGE_UNAVAILABLE');
    let response;
    try {
      response = await fetchRef(`${endpoint}/write`, {
        method: 'POST',
        headers: requestHeaders(getRequestHeaders),
        body: JSON.stringify({key: secretKey, value: secretValue, label: String(label || 'BioWeave API Profile').slice(0, 120)}),
      });
    } catch {
      throw new Error('ST_SECRET_WRITE_FAILED');
    }
    if (!response?.ok) throw statusError('ST_SECRET_WRITE_FAILED', response);
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error('ST_SECRET_WRITE_INVALID_RESPONSE');
    }
    const id = typeof result?.id === 'string' ? result.id.trim() : '';
    if (!id) throw new Error('ST_SECRET_WRITE_INVALID_RESPONSE');
    return id;
  }

  async function remove(secretRef) {
    const id = typeof secretRef === 'string' ? secretRef.trim() : '';
    if (!id) return false;
    if (typeof fetchRef !== 'function') throw new Error('ST_SECRET_STORAGE_UNAVAILABLE');
    let response;
    try {
      response = await fetchRef(`${endpoint}/delete`, {
        method: 'POST',
        headers: requestHeaders(getRequestHeaders),
        body: JSON.stringify({key: secretKey, id}),
      });
    } catch {
      throw new Error('ST_SECRET_DELETE_FAILED');
    }
    if (!response?.ok) throw statusError('ST_SECRET_DELETE_FAILED', response);
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
      throw new Error('ST_SECRET_READ_DISABLED');
    },
  };
}

function secretWriter(secretStore) {
  return secretStore?.write ?? secretStore?.set ?? secretStore?.setSecret;
}

function secretRemover(secretStore) {
  return secretStore?.remove ?? secretStore?.deleteSecret ?? secretStore?.delete;
}

async function removeSecretOrThrow(secretStore, secretRef) {
  const remover = secretRemover(secretStore);
  if (typeof remover !== 'function') {
    throw new Error('ST_SECRET_DELETE_FAILED');
  }
  try {
    await remover.call(secretStore, secretRef);
  } catch (error) {
    if (error?.code === 'ST_SECRET_DELETE_FAILED') throw error;
    throw new Error('ST_SECRET_DELETE_FAILED');
  }
}

function secretRefUsed(settings, secretRef, exceptProfileId = '') {
  if (!secretRef) return false;
  return Object.values(settings.api_profiles ?? {}).some(profile =>
    profile.profile_id !== exceptProfileId && profile.secret_ref === secretRef);
}

function keyInput(raw) {
  if (hasOwn(raw, 'api_key')) return raw.api_key;
  if (hasOwn(raw, 'apiKey')) return raw.apiKey;
  return undefined;
}

function clearSecretRequested(raw) {
  return raw?.clear_secret === true || raw?.clearSecret === true;
}

export function createApiProfileStore(adapter, {secretStore = null} = {}) {
  if (!adapter || typeof adapter !== 'object') throw new TypeError('PROFILE_ADAPTER_REQUIRED');
  const secrets = secretStore ?? createSecretStore({
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

  async function saveProfile(raw = {}) {
    const settings = read();
    const requestedId = profileIdFrom(raw);
    const existing = requestedId ? settings.api_profiles[requestedId] : null;
    const profile = normalizeApiProfile(raw, {profileId: requestedId || null});
    if (!profile.api_url || !profile.model) throw new Error('API_PROFILE_INVALID');
    const oldSecretRef = existing?.secret_ref ?? null;
    const suppliedKey = keyInput(raw);
    const hasNewKey = typeof suppliedKey === 'string' && suppliedKey.trim().length > 0;
    const shouldClear = clearSecretRequested(raw);
    let nextSecretRef = oldSecretRef;
    let newlyWrittenRef = null;

    if (hasNewKey) {
      const writeSecret = secretWriter(secrets);
      if (typeof writeSecret !== 'function') throw new Error('ST_SECRET_STORAGE_UNAVAILABLE');
      // 不把用户可编辑的 Profile 名称传给 Secret Store，避免误把 Key 写进 label。
      newlyWrittenRef = await writeSecret.call(secrets, suppliedKey.trim());
      if (!newlyWrittenRef) throw new Error('ST_SECRET_WRITE_INVALID_RESPONSE');
      nextSecretRef = newlyWrittenRef;
    } else if (shouldClear) {
      nextSecretRef = null;
    }

    const nextSettings = {
      ...settings,
      api_profiles: {
        ...settings.api_profiles,
        [profile.profile_id]: {...profile, secret_ref: nextSecretRef},
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

    if (oldSecretRef && oldSecretRef !== nextSecretRef && !secretRefUsed(nextSettings, oldSecretRef, profile.profile_id)) {
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
    await write({...settings, api_request_settings: requestSettings});
    return cloneValue(requestSettings);
  }

  async function withTestProfile(raw = {}, callback, options = {}) {
    if (typeof callback !== 'function') throw new TypeError('PROFILE_TEST_CALLBACK_REQUIRED');
    const settings = read();
    const requestedId = profileIdFrom(raw);
    const existing = requestedId ? settings.api_profiles[requestedId] : null;
    const profile = normalizeApiProfile(raw, {
      profileId: requestedId || null,
      secretRef: existing?.secret_ref ?? null,
    });
    const requireModel = options?.requireModel !== false;
    if (!profile.api_url || (requireModel && !profile.model)) throw new Error('API_PROFILE_INVALID');

    const suppliedKey = keyInput(raw);
    const hasNewKey = typeof suppliedKey === 'string' && suppliedKey.trim().length > 0;
    const shouldClear = clearSecretRequested(raw);
    let temporarySecretRef = null;

    if (hasNewKey) {
      const writeSecret = secretWriter(secrets);
      if (typeof writeSecret !== 'function') throw new Error('ST_SECRET_STORAGE_UNAVAILABLE');
      temporarySecretRef = await writeSecret.call(secrets, suppliedKey.trim());
      if (!temporarySecretRef) throw new Error('ST_SECRET_WRITE_INVALID_RESPONSE');
      profile.secret_ref = temporarySecretRef;
    } else if (shouldClear) {
      profile.secret_ref = null;
    }

    try {
      return await callback(cloneValue(profile));
    } finally {
      if (temporarySecretRef) await removeSecretOrThrow(secrets, temporarySecretRef);
    }
  }

  async function deleteProfile(profileId) {
    const id = profileIdFrom(profileId);
    if (!id) return false;
    const settings = read();
    const existing = settings.api_profiles[id];
    if (!existing) return false;
    const profiles = {...settings.api_profiles};
    delete profiles[id];
    const assignments = {...settings.assignments};
    for (const slot of API_ASSIGNMENTS) {
      if (assignments[slot] === id) assignments[slot] = null;
    }
    const nextSettings = {...settings, api_profiles: profiles, assignments};
    await write(nextSettings);
    if (existing.secret_ref && !secretRefUsed(nextSettings, existing.secret_ref)) {
      await removeSecretOrThrow(secrets, existing.secret_ref);
    }
    return true;
  }

  async function setAssignment(slot, value) {
    if (!API_ASSIGNMENTS.includes(slot)) throw new Error('API_ASSIGNMENT_INVALID');
    const settings = read();
    let nextValue = typeof value === 'string' ? value.trim() : '';
    if (!nextValue) nextValue = null;
    else if (nextValue.toLowerCase() === FOLLOW_DEFAULT_API || nextValue.toLowerCase() === 'follow_default' || nextValue.toLowerCase() === 'default_api') {
      nextValue = FOLLOW_DEFAULT_API;
    } else if (nextValue.toLowerCase() === SILLYTAVERN_CURRENT_API || nextValue.toLowerCase() === 'current') {
      nextValue = SILLYTAVERN_CURRENT_API;
    } else if (!settings.api_profiles[nextValue]) {
      throw new Error('API_PROFILE_NOT_FOUND');
    }
    const nextSettings = {
      ...settings,
      assignments: {...settings.assignments, [slot]: nextValue},
    };
    await write(nextSettings);
    return nextValue;
  }

  async function setApiSource(value) {
    const nextValue = normalizeApiSource(value);
    const settings = read();
    await write({...settings, api_source: nextValue});
    return nextValue;
  }

  async function setDefaultProfile(profileId) {
    const settings = read();
    const nextValue = profileIdFrom(profileId) || null;
    if (nextValue && !settings.api_profiles[nextValue]) throw new Error('API_PROFILE_NOT_FOUND');
    await write({...settings, default_profile_id: nextValue});
    return nextValue;
  }

  function getWorldAnalysisPrompt() {
    return cloneValue(read().world_analysis_prompt);
  }

  async function saveWorldAnalysisPrompt(raw = {}) {
    const settings = read();
    const source = raw && typeof raw === 'object' ? raw : {};
    const merged = {...settings.world_analysis_prompt};
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined) merged[key] = value;
    }
    if (source.labels && typeof source.labels === 'object' && !Array.isArray(source.labels)) {
      merged.labels = {...settings.world_analysis_prompt.labels, ...source.labels};
    }
    const prompt = normalizeWorldAnalysisPrompt(merged);
    await write({...settings, world_analysis_prompt: prompt});
    return cloneValue(prompt);
  }

  function getRecentStoryGlobal() {
    return cloneValue(read().recent_story_global);
  }

  async function saveRecentStoryGlobal(raw = {}) {
    const settings = read();
    const recentStoryGlobal = normalizeRecentStoryGlobalSettings(raw);
    await write({...settings, recent_story_global: recentStoryGlobal});
    return cloneValue(recentStoryGlobal);
  }

  return {
    getSettings,
    listProfiles,
    getProfile,
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

export function hasSwipeStructure(message) {
  return Array.isArray(message?.swipes)
    || Boolean(message?.swipe_info && typeof message.swipe_info === 'object');
}

function normalizedSwipeId(swipeId) {
  if (Number.isInteger(swipeId) && swipeId >= 0) return swipeId;
  if (typeof swipeId === 'string' && /^\d+$/u.test(swipeId.trim())) return Number(swipeId);
  return null;
}

export function activeSwipeId(message, fallback = 0) {
  if (!hasSwipeStructure(message)) return 0;
  return normalizedSwipeId(message.swipe_id)
    ?? normalizedSwipeId(fallback)
    ?? 0;
}

export const getActiveSwipeId = activeSwipeId;

function validSwipeId(swipeId) {
  return normalizedSwipeId(swipeId) ?? 0;
}

export function createStore(adapter, boundary = null) {
  if (!adapter || typeof adapter.getChatId !== 'function') {
    throw new TypeError('STORAGE_ADAPTER_REQUIRED');
  }

  function getChat(chatId) {
    if (currentChatId(adapter, boundary) !== chatId) return emptyChat(chatId);
    const metadata = adapter.getChatMetadata?.();
    const stored = metadata?.bioweave;
    if (stored?.chat_scope?.chat_id !== chatId) return emptyChat(chatId);
    return cloneForStorage({
      ...stored,
      tracking_subjects: normalizeTrackingSubjects(stored.tracking_subjects),
    });
  }

  async function saveChat(chatId, data) {
    if (data?.chat_scope?.chat_id !== chatId) throw new Error('CHAT_SCOPE_MISMATCH');
    if (typeof adapter.saveChatMetadata !== 'function') throw new Error('ST_METADATA_STORAGE_UNAVAILABLE');
    const token = captureToken(adapter, boundary);
    if (token.chatId !== chatId) throw staleChatError();
    const safeData = cloneForStorage({
      ...data,
      tracking_subjects: normalizeTrackingSubjects(data?.tracking_subjects),
    });
    await adapter.saveChatMetadata('bioweave', safeData, token.chatId);
    assertToken(adapter, boundary, token);
  }

  function getFloor(messageId, swipeId = 0) {
    const message = adapter.getMessage?.(messageId);
    if (!message) return null;
    const targetSwipeId = validSwipeId(swipeId);
    const stored = hasSwipeStructure(message)
      ? message.swipe_info?.[targetSwipeId]?.extra?.bioweave
      : message.extra?.bioweave;
    if (!stored || !hasMatchingFloorScope(stored, currentChatId(adapter, boundary))) {
      return emptyFloor();
    }
    return cloneForStorage(stored);
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
    return cloneValue(normalizeTrackingSubjects(getChat(chatId).tracking_subjects));
  }

  async function saveTrackingSubjects(chatId, registry) {
    const chat = getChat(chatId);
    const trackingSubjects = normalizeTrackingSubjects(
      registry?.tracking_subjects ?? registry,
    );
    const nextChat = {...chat, tracking_subjects: trackingSubjects};
    if (registry && typeof registry === 'object'
      && Object.prototype.hasOwnProperty.call(registry, 'character_profiles')) {
      nextChat.character_profiles = cloneValue(registry.character_profiles);
    }
    await saveChat(chatId, nextChat);
    return cloneValue(trackingSubjects);
  }

  async function saveFloor(messageId, swipeId, data) {
    const targetSwipeId = validSwipeId(swipeId);
    const token = captureToken(adapter, boundary);
    const version = floorVersionFromStoredData(data);
    if (version?.chat_id && version.chat_id !== token.chatId) throw new Error('CHAT_SCOPE_MISMATCH');
    const safeData = cloneForStorage(data);
    if (typeof adapter.saveFloorBioWeave !== 'function') {
      throw new Error('ST_FLOOR_STORAGE_UNAVAILABLE');
    }
    await adapter.saveFloorBioWeave(messageId, targetSwipeId, safeData, token.chatId);
    assertToken(adapter, boundary, token);
  }

  const profileStore = createApiProfileStore(adapter);
  return {
    getChat,
    saveChat,
    getFloor,
    getActiveSwipeId: getActiveSwipe,
    getActiveFloor,
    getActiveFloorEvents,
    getTrackingSubjects,
    saveTrackingSubjects,
    saveFloor,
    profileStore,
    ...profileStore,
  };
}
