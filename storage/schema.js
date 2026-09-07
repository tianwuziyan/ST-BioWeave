export const SCHEMA_VERSION = 1;
// World Model v1 的固定轻量结构；缺少证据的标量统一由分析器规范化为 null。
export const WORLD_MODEL_SCHEMA = Object.freeze({
  schema_version: 1,
  biological_types: [
    {
      name: null,
      description: null,
      capabilities: {
        can_produce_sperm: null,
        can_produce_ova: null,
        can_be_fertilized: null,
        can_fertilize: null,
        can_carry_pregnancy: null,
      },
      reproduction_rules: {
        fertilization: null,
        pregnancy_or_carrying: null,
        cycle: null,
        ovulation: null,
        gestation: null,
        labor: null,
      },
      lifecycle: {
        maturation: null,
        aging: null,
      },
      special_rules: [],
    },
  ],
  medical_context: {
    childbirth_difficulty: null,
    care_level: null,
    evidence: null,
  },
  exceptions: [],
  unknowns: [],
});

export const DEFAULT_SETTINGS = {
  enabled: true,
  analysis_interval: 3,
  snapshot_interval: 3,
  projection_enabled: true,
  retry_failed_analysis: true,
  context_injection: {enabled: true, max_tokens: 1600},
  worldbooks: {mode: 'selected_only', selected: []},
  recent_story: {enabled: true, floor_count: 4, regex_rules: [], regex_user_enabled: false},
  external_memory: {
    anima: false,
    baobaoshu: false,
    database_memory: false,
  },
  prompts: {prefix: '', suffix: '', task: {}},
};

// 世界分析的可编辑提示块；核心约束仍由 BioWeave 代码维护，避免用户误删后失去校验边界。
export const DEFAULT_WORLD_ANALYSIS_PROMPT = Object.freeze({
  task: '请根据下面的资料整理当前 Chat 的生物学世界规则。只使用资料中的明确证据，不要把推测写成事实。',
  input_prefix: '下面是本次分析实际读取的资料。资料正文是证据，请保留来源之间的区别。',
  input_suffix: '',
  labels: Object.freeze({
    character: '角色卡',
    worldbooks: '世界书',
    recent_story: '最近剧情',
    external_memory: '外部记忆',
  }),
});

function promptText(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, 20000);
}

// 只保留提示词文本和显示标签，不允许把其它设置或 Secret 带入全局配置。
export function normalizeWorldAnalysisPrompt(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const rawLabels = source.labels && typeof source.labels === 'object' ? source.labels : {};
  return {
    task: promptText(source.task, DEFAULT_WORLD_ANALYSIS_PROMPT.task),
    input_prefix: promptText(source.input_prefix, DEFAULT_WORLD_ANALYSIS_PROMPT.input_prefix),
    input_suffix: promptText(source.input_suffix, DEFAULT_WORLD_ANALYSIS_PROMPT.input_suffix),
    labels: {
      character: promptText(rawLabels.character, DEFAULT_WORLD_ANALYSIS_PROMPT.labels.character) || DEFAULT_WORLD_ANALYSIS_PROMPT.labels.character,
      worldbooks: promptText(rawLabels.worldbooks, DEFAULT_WORLD_ANALYSIS_PROMPT.labels.worldbooks) || DEFAULT_WORLD_ANALYSIS_PROMPT.labels.worldbooks,
      recent_story: promptText(rawLabels.recent_story, DEFAULT_WORLD_ANALYSIS_PROMPT.labels.recent_story) || DEFAULT_WORLD_ANALYSIS_PROMPT.labels.recent_story,
      external_memory: promptText(rawLabels.external_memory, DEFAULT_WORLD_ANALYSIS_PROMPT.labels.external_memory) || DEFAULT_WORLD_ANALYSIS_PROMPT.labels.external_memory,
    },
  };
}

export const API_PROFILE_FIELDS = [
  'name',
  'provider',
  'api_url',
  'model',
  'context_size',
  'max_output_tokens',
  'temperature',
  'timeout',
  'retry_count',
];

export const API_ASSIGNMENTS = [
  'world_analysis',
  'event_analysis',
  'projection',
  'history_scan',
];

export const SILLYTAVERN_CURRENT_API = 'sillytavern';
export const BIOWEAVE_INDEPENDENT_API = 'bioweave';
export const FOLLOW_DEFAULT_API = 'default';

export const DEFAULT_API_PROFILE = {
  name: '',
  provider: 'OpenAI-compatible',
  api_url: '',
  model: '',
  context_size: 8192,
  max_output_tokens: 4096,
  temperature: 0.2,
  timeout: 30000,
  retry_count: 1,
  secret_ref: null,
};

export const DEFAULT_EXTENSION_SETTINGS = {
  api_source: SILLYTAVERN_CURRENT_API,
  default_profile_id: null,
  api_profiles: {},
  assignments: Object.fromEntries(API_ASSIGNMENTS.map(slot => [slot, null])),
  recent_story_global: {regex_rules: []},
  world_analysis_prompt: {
    task: DEFAULT_WORLD_ANALYSIS_PROMPT.task,
    input_prefix: DEFAULT_WORLD_ANALYSIS_PROMPT.input_prefix,
    input_suffix: DEFAULT_WORLD_ANALYSIS_PROMPT.input_suffix,
    labels: {...DEFAULT_WORLD_ANALYSIS_PROMPT.labels},
  },
};

const WORLDBOOK_MODES = new Set(['selected_only', 'all', 'none']);

export function normalizeWorldbookSettings(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const rawSelected = Array.isArray(source.selected) ? source.selected : [];
  const selected = [];
  const seen = new Set();
  for (const item of rawSelected) {
    const sourceId = typeof item === 'string' ? item.trim() : String(item?.source_id ?? '').trim();
    if (!sourceId || (item && typeof item === 'object' && item.enabled === false)) continue;
    const entryId = item && typeof item === 'object' ? String(item.entry_id ?? '').trim() : '';
    const fieldKey = item && typeof item === 'object' ? String(item.field_key ?? '').trim() : '';
    // 旧版本只有 source_id；保留它用于读取兼容，但新调用方应提供子项 ID。
    const identity = entryId
      ? `${sourceId}\u0000entry\u0000${entryId}`
      : fieldKey
        ? `${sourceId}\u0000field\u0000${fieldKey}`
        : `${sourceId}\u0000source`;
    if (seen.has(identity) || (entryId && fieldKey)) continue;
    seen.add(identity);
    const normalized = {source_id: sourceId};
    if (entryId) normalized.entry_id = entryId;
    else if (fieldKey) normalized.field_key = fieldKey;
    normalized.enabled = true;
    selected.push(normalized);
  }
  const mode = WORLDBOOK_MODES.has(source.mode) ? source.mode : 'selected_only';
  return {mode, selected};
}

export function normalizeRecentStorySettings(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const parsedFloorCount = Number(source.floor_count ?? source.floorCount);
  const floorCount = Number.isFinite(parsedFloorCount)
    ? Math.min(1000, Math.max(0, Math.round(parsedFloorCount)))
    : 4;
  const rawRules = Array.isArray(source.regex_rules)
    ? source.regex_rules
    : Array.isArray(source.regexRules)
      ? source.regexRules
      : [];
  const regexRules = [];
  for (const item of rawRules) {
    if (regexRules.length >= 50) break;
    const isStringRule = typeof item === 'string';
    const rule = item && typeof item === 'object' ? item : {};
    const rawPattern = isStringRule ? item : rule.pattern ?? rule.regex;
    if (typeof rawPattern !== 'string') continue;
    const pattern = rawPattern.trim().slice(0, 2000);
    if (!pattern && isStringRule) continue;
    const rawType = String(rule.type ?? '').trim().toLowerCase();
    const type = ['exclude', 'clean', 'remove', '清洗'].includes(rawType) ? 'exclude' : 'extract';
    regexRules.push({
      pattern,
      type,
      enabled: isStringRule || rule.enabled !== false,
    });
  }
  return {
    // 读取开关由楼数派生；保留字段只是兼容旧数据，不再允许旧值阻止读取。
    enabled: floorCount > 0,
    floor_count: floorCount,
    regex_rules: regexRules,
    regex_user_enabled: source.regex_user_enabled === true,
  };
}

// 插件级最近剧情只保存正则规则；读取楼数和用户楼开关始终属于当前 Chat。
export function normalizeRecentStoryGlobalSettings(raw = {}) {
  return {
    regex_rules: normalizeRecentStorySettings(raw).regex_rules.filter(rule => rule.pattern),
  };
}

export const EXTERNAL_MEMORY_KEYS = [
  'anima',
  'baobaoshu',
  'database_memory',
];

export function normalizeExternalMemorySettings(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return Object.fromEntries(EXTERNAL_MEMORY_KEYS.map(key => [key, source[key] === true]));
}

const SECRET_FIELD_NAMES = new Set([
  'apikey',
  'authorization',
  'bearer',
  'secret',
  'secretkey',
  'apisecret',
  'clientsecret',
  'accesstoken',
  'refreshtoken',
  'password',
  'token',
]);

function normalizedFieldName(fieldName) {
  return String(fieldName).replace(/[-_\s]/g, '').toLowerCase();
}

function isSecretField(fieldName) {
  const normalized = normalizedFieldName(fieldName);
  if (normalized === 'secretref' || normalized === 'secretid') return false;
  if (SECRET_FIELD_NAMES.has(normalized)) return true;
  return normalized.endsWith('apikey') || normalized.endsWith('authorization');
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const result = value.trim();
    if (result) return result;
  }
  return '';
}

function normalizeApiUrl(value) {
  const text = firstString(value);
  if (!text) return '';
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    for (const key of url.searchParams.keys()) {
      if (/(api[-_]?key|authorization|access[-_]?token|refresh[-_]?token|secret|password|bearer|token)/i.test(key)) return '';
    }
    for (const queryValue of url.searchParams.values()) {
      if (/(api[-_]?key|authorization|access[-_]?token|refresh[-_]?token|secret|password|bearer|token)\s*(?:=|:)|^bearer\s+\S+/i.test(queryValue)) return '';
    }
    // SillyTavern custom backend 会直接在 custom_url 后追加路径；保留 query
    // 会把 `/chat/completions` 拼到 query 值后面，既不可靠也容易携带秘密。
    if (url.search) return '';
    url.pathname = url.pathname
      .replace(/\/chat\/completions\/?$/i, '')
      .replace(/\/completions\/?$/i, '');
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    // 不把看起来像 URL 的任意字符串当成有效连接；尤其不能让 query 中的 Key
    // 以“配置地址”的名义落盘。
    return '';
  }
}

function numberInRange(value, fallback, min, max, integer = false) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const bounded = Math.min(max, Math.max(min, parsed));
  return integer ? Math.round(bounded) : bounded;
}

let profileIdCounter = 0;

function createProfileId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `profile-${uuid}`;
  profileIdCounter += 1;
  return `profile-${Date.now().toString(36)}-${profileIdCounter.toString(36)}`;
}

export function normalizeApiProfile(raw = {}, {profileId = null, secretRef = undefined} = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const id = firstString(profileId, source.profile_id, source.id) || createProfileId();
  const provider = firstString(source.provider, DEFAULT_API_PROFILE.provider) || DEFAULT_API_PROFILE.provider;
  const model = firstString(source.model);
  const name = firstString(source.name) || model || provider;
  const apiUrl = normalizeApiUrl(source.api_url ?? source.base_url ?? source.custom_url);
  const existingSecretRef = secretRef === undefined
    ? firstString(source.secret_ref, source.secret_id) || null
    : firstString(secretRef) || null;

  return {
    profile_id: id,
    name,
    provider,
    api_url: apiUrl,
    model,
    context_size: numberInRange(source.context_size ?? source.max_context, DEFAULT_API_PROFILE.context_size, 1, 10000000, true),
    max_output_tokens: numberInRange(source.max_output_tokens ?? source.max_tokens, DEFAULT_API_PROFILE.max_output_tokens, 1, 10000000, true),
    temperature: numberInRange(source.temperature, DEFAULT_API_PROFILE.temperature, 0, 2),
    timeout: numberInRange(source.timeout ?? source.timeout_ms, DEFAULT_API_PROFILE.timeout, 250, 600000, true),
    retry_count: numberInRange(source.retry_count ?? source.retries, DEFAULT_API_PROFILE.retry_count, 0, 3, true),
    secret_ref: existingSecretRef,
  };
}

export const normalizeProfile = normalizeApiProfile;

export function normalizeApiSource(value) {
  const normalized = firstString(value).toLowerCase();
  if (['bioweave', 'independent', 'independent_api', 'bio_weave'].includes(normalized)) {
    return BIOWEAVE_INDEPENDENT_API;
  }
  return SILLYTAVERN_CURRENT_API;
}

function normalizeAssignment(value, profiles) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (new Set([
    FOLLOW_DEFAULT_API,
    'follow_default',
    'default_api',
  ]).has(normalized.toLowerCase())) return FOLLOW_DEFAULT_API;
  if (new Set([
    SILLYTAVERN_CURRENT_API,
    'sillytavern_current',
    'current',
    'current_api',
    'st_current_api',
  ]).has(normalized.toLowerCase())) return SILLYTAVERN_CURRENT_API;
  return profiles[normalized] ? normalized : null;
}

export function normalizeExtensionSettings(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const rawProfiles = source.api_profiles ?? source.profiles ?? {};
  const profiles = {};
  if (Array.isArray(rawProfiles)) {
    for (const profile of rawProfiles) {
      const normalized = normalizeApiProfile(profile);
      profiles[normalized.profile_id] = normalized;
    }
  } else if (rawProfiles && typeof rawProfiles === 'object') {
    for (const [profileId, profile] of Object.entries(rawProfiles)) {
      const normalized = normalizeApiProfile(profile, {profileId});
      profiles[normalized.profile_id] = normalized;
    }
  }

  const rawAssignments = source.assignments ?? source.profile_assignments ?? {};
  const assignments = {};
  for (const slot of API_ASSIGNMENTS) {
    assignments[slot] = normalizeAssignment(rawAssignments[slot], profiles);
  }

  const safe = sanitizeSecrets(source);
  return {
    ...safe,
    api_source: normalizeApiSource(source.api_source ?? source.default_api_source ?? source.default_api),
    default_profile_id: profiles[firstString(source.default_profile_id, source.defaultProfileId)]
      ? firstString(source.default_profile_id, source.defaultProfileId)
      : null,
    api_profiles: profiles,
    assignments,
    recent_story_global: normalizeRecentStoryGlobalSettings(source.recent_story_global),
    world_analysis_prompt: normalizeWorldAnalysisPrompt(source.world_analysis_prompt),
  };
}

export const normalizeGlobalSettings = normalizeExtensionSettings;

export function cloneValue(value) {
  if (value === undefined || value === null) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(cloneValue);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
}

export function sanitizeSecrets(value) {
  if (Array.isArray(value)) return value.map(sanitizeSecrets);
  if (!value || typeof value !== 'object') return value;
  const safe = {};
  for (const [key, item] of Object.entries(value)) {
    if (isSecretField(key)) continue;
    safe[key] = sanitizeSecrets(item);
  }
  return safe;
}

export function emptyChat(chatId) {
  return {
    schema_version: SCHEMA_VERSION,
    chat_scope: {chat_id: chatId},
    world_model: null,
    world_model_meta: null,
    character_profiles: {},
    relationships: [],
    settings: cloneValue(DEFAULT_SETTINGS),
    index: {snapshot_floors: [], last_processed_floor: null},
  };
}

export function emptyFloor() {
  return {v: 1, analysis: null, events: [], snapshot: null, projections: []};
}
