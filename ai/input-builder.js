import {redactSecrets} from './client.js';
import {tokenEstimate as estimateSourceTokens} from './worldbook.js';
import {
  normalizeExternalMemorySettings,
  normalizeRecentStoryGlobalSettings,
  normalizeRecentStorySettings,
  normalizeWorldbookSettings,
} from '../storage/schema.js';
import {normalizeStoryTime} from '../story/time.js';

const EXTERNAL_MEMORY_DEFINITIONS = Object.freeze([
  {key: 'anima', label: 'Anima'},
  {key: 'baobaoshu', label: '柏宝书'},
  {key: 'database_memory', label: '数据库记忆'},
]);

// 所有进入预览的字符串都先经过已有的安全摘要处理，避免把正文中的凭据样式原样展示。
function safeText(value) {
  if (value === undefined || value === null) return '';
  return redactSecrets(String(value));
}

function safeId(value) {
  return String(value ?? '').trim();
}

const SENSITIVE_INPUT_KEY_PATTERN = /(?:^|_)(?:api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|password|secret)(?:$|_)/iu;

function isSensitiveInputKey(key) {
  return SENSITIVE_INPUT_KEY_PATTERN.test(String(key ?? ''));
}

// Event analysis receives a deliberately small, text-only boundary. Keep this
// sanitizer independent from storage sanitization so an input preview cannot
// accidentally carry a host response, profile, or Secret field into a prompt.
function safeStructuredValue(value, seen = new Set()) {
  if (value === undefined || value === null) return value ?? null;
  if (typeof value === 'string') return safeText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) return value.map(item => safeStructuredValue(item, seen));
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveInputKey(key)) continue;
    result[key] = safeStructuredValue(item, seen);
  }
  return result;
}

function numericId(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

export function normalizeEventFloorVersion(raw = {}, fallbackChatId = null) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const chatId = safeId(source.chat_id ?? source.chatId ?? fallbackChatId);
  return {
    chat_id: chatId || null,
    message_id: safeId(source.message_id ?? source.messageId) || null,
    floor: numericId(source.floor ?? source.floor_id),
    swipe_id: numericId(source.swipe_id ?? source.swipeId, null),
    content_hash: safeId(source.content_hash ?? source.contentHash) || null,
    message_version: safeId(source.message_version ?? source.messageVersion) || null,
  };
}

function normalizeEventCurrentFloor(raw, floorVersion) {
  if (typeof raw === 'string' || typeof raw === 'number') {
    return {
      floor: floorVersion.floor,
      message_id: floorVersion.message_id,
      swipe_id: floorVersion.swipe_id,
      narrative: safeContent(raw),
      role: null,
    };
  }
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const narrative = firstContent([
    source.narrative,
    source.content,
    source.text,
    source.mes,
    source.message,
  ]);
  return {
    ...safeStructuredValue(source),
    floor: numericId(source.floor ?? source.floor_id, floorVersion.floor),
    message_id: safeId(source.message_id ?? source.messageId ?? floorVersion.message_id) || null,
    swipe_id: numericId(source.swipe_id ?? source.swipeId, floorVersion.swipe_id),
    narrative,
    role: safeText(source.role ?? '').trim() || null,
  };
}

function normalizeEventRecentContext(raw, fallbackStory) {
  const items = Array.isArray(raw)
    ? raw
    : Array.isArray(fallbackStory?.items)
      ? fallbackStory.items
      : [];
  return items.map((item, index) => {
    if (typeof item === 'string' || typeof item === 'number') {
      return {floor: index, role: null, content: safeContent(item)};
    }
    const source = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
    return {
      ...safeStructuredValue(source),
      floor: numericId(source.floor ?? source.floor_id, index),
      role: safeText(source.role ?? '').trim() || null,
      content: firstContent([source.content, source.text, source.mes, source.message]),
    };
  }).filter(item => item.content || item.narrative);
}

// 外部扩展返回的对象只读取公开正文字段，不把响应对象、extra 或 Store 复制进 DTO。
function safeContent(value, seen = new Set()) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return safeText(value);
  }
  if (typeof value !== 'object' || seen.has(value)) return '';
  seen.add(value);
  if (Array.isArray(value)) return value.map(item => safeContent(item, seen)).filter(Boolean).join('\n');

  const parts = [];
  for (const key of ['content', 'text', 'relativeText', 'mes', 'message', 'summary', 'description', 'history']) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const part = safeContent(value[key], seen);
    if (part) parts.push(part);
  }
  return parts.join('\n');
}

function tokenEstimate(text = '') {
  return estimateSourceTokens(safeText(text));
}

function normalizedSelections(selected) {
  return normalizeWorldbookSettings({selected}).selected;
}

function selectedChildIds(selected, sourceId, key) {
  const ids = new Set();
  for (const item of selected) {
    if (item.source_id !== sourceId || !item[key]) continue;
    ids.add(safeId(item[key]));
  }
  return ids;
}

function sourceType(source) {
  return String(source?.source_type ?? '').trim();
}

function firstText(values) {
  for (const value of values) {
    if (value === undefined || value === null || typeof value === 'object') continue;
    const text = safeText(value).trim();
    if (text) return text;
  }
  return '';
}

function firstContent(values) {
  for (const value of values) {
    const content = safeContent(value).trim();
    if (content) return content;
  }
  return '';
}

// 读取当前 SillyTavern 的用户人物设定；参考 Anima 的公开上下文读取方式，不访问私有 Store。
function buildUserPersonaInput(context) {
  const powerUserSettings = context?.powerUserSettings && typeof context.powerUserSettings === 'object'
    ? context.powerUserSettings
    : {};
  const personaObject = context?.user_persona && typeof context.user_persona === 'object'
    ? context.user_persona
    : context?.persona && typeof context.persona === 'object'
      ? context.persona
      : {};
  return {
    name: firstText([
      powerUserSettings.persona_name,
      context?.persona_name,
      personaObject.name,
      context?.name1,
      context?.user_name,
      context?.userName,
    ]) || null,
    description: firstContent([
      powerUserSettings.persona_description,
      context?.persona_description,
      context?.user_persona_description,
      context?.user_persona,
      context?.userPersona,
      personaObject.description,
      personaObject.persona_description,
    ]) || null,
  };
}

function buildCharacterInput(sources, selected) {
  const character = {description: '', greetings: []};
  const seenGreetings = new Set();
  for (const source of Array.isArray(sources) ? sources : []) {
    if (sourceType(source) !== 'character_card') continue;
    const sourceId = safeId(source.source_id);
    if (!sourceId) continue;
    const fieldIds = selectedChildIds(selected, sourceId, 'field_key');
    for (const field of Array.isArray(source.fields) ? source.fields : []) {
      const fieldKey = safeId(field?.field_key);
      if (!fieldKey || !fieldIds.has(fieldKey)) continue;
      const content = safeContent(field?.content);
      if (fieldKey === 'description') {
        if (!character.description && content) character.description = content;
        continue;
      }
      if (!fieldKey.startsWith('opening:') || seenGreetings.has(fieldKey)) continue;
      seenGreetings.add(fieldKey);
      character.greetings.push({
        field_key: fieldKey,
        label: safeText(field?.label || fieldKey).trim(),
        content,
        is_current: field?.is_current === true,
      });
    }
  }
  return character;
}

function buildWorldbookInput(sources, selected) {
  const worldbooks = [];
  for (const source of Array.isArray(sources) ? sources : []) {
    if (sourceType(source) !== 'worldbook') continue;
    const sourceId = safeId(source.source_id);
    if (!sourceId) continue;
    const entryIds = selectedChildIds(selected, sourceId, 'entry_id');
    const entries = [];
    for (const entry of Array.isArray(source.entries) ? source.entries : []) {
      const entryId = safeId(entry?.entry_id);
      if (!entryId || !entryIds.has(entryId)) continue;
      const content = safeContent(entry?.content);
      entries.push({
        entry_id: entryId,
        label: safeText(entry?.label || entryId).trim(),
        content,
        token_estimate: tokenEstimate(content),
      });
    }
    if (!entries.length) continue;
    worldbooks.push({
      source_id: sourceId,
      name: safeText(source.label || source.name || sourceId).trim(),
      entries,
    });
  }
  return worldbooks;
}

function numericFloor(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function messageContent(message) {
  if (typeof message === 'string' || typeof message === 'number') return safeContent(message);
  if (!message || typeof message !== 'object') return '';
  const swipeId = Number.isInteger(message.swipe_id) ? message.swipe_id : 0;
  if (Array.isArray(message.swipes) && message.swipes[swipeId] !== undefined) {
    const swipeText = safeContent(message.swipes[swipeId]);
    if (swipeText) return swipeText;
  }
  return safeContent(message.mes ?? message.content ?? message.message ?? '');
}

function messageRole(message) {
  const explicitRole = String(message?.role ?? '').trim().toLowerCase();
  if (['user', 'assistant', 'system'].includes(explicitRole)) return explicitRole;
  if (message?.is_system === true) return 'system';
  if (message?.is_user === true) return 'user';
  return 'assistant';
}

function messageFloor(message, index) {
  const candidates = [message?.floor, message?.floor_id, message?.floorIndex, message?.index];
  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  return index;
}

function parseRecentStoryRegex(pattern) {
  const text = String(pattern ?? '').trim();
  if (!text) return null;
  let source = text;
  let flags = 'g';
  if (text.startsWith('/')) {
    let closingSlash = -1;
    for (let index = text.length - 1; index > 0; index -= 1) {
      if (text[index] !== '/') continue;
      let backslashCount = 0;
      for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) backslashCount += 1;
      if (backslashCount % 2 === 0) {
        closingSlash = index;
        break;
      }
    }
    if (closingSlash > 0) {
      source = text.slice(1, closingSlash);
      flags = text.slice(closingSlash + 1);
    }
  }
  try {
    // 参照 Anima 的规则语义，清洗和提取默认处理全部匹配结果。
    const normalizedFlags = flags.includes('g') ? flags : `${flags}g`;
    const regex = new RegExp(source, normalizedFlags);
    return {regex, global: regex.global};
  } catch {
    return null;
  }
}

function extractRecentStoryMatches(content, regex) {
  return [...content.matchAll(regex)].flatMap(match => {
    if (match.length === 1) return [match[0].trim()];
    return match.slice(1)
      .map(value => String(value ?? '').trim())
      .filter(Boolean);
  });
}

// 最近剧情先按配置顺序完成清洗，再让所有提取规则独立读取清洗后的原文。
export function applyRecentStoryRegex(content = '', rules = []) {
  let cleanedContent = String(content ?? '');
  const normalizedRules = normalizeRecentStorySettings({regex_rules: rules}).regex_rules;
  const activeRules = normalizedRules.filter(rule => rule.enabled !== false && rule.pattern);
  if (!activeRules.length) return cleanedContent;
  const extractRegexes = [];
  for (const rule of activeRules) {
    const parsed = parseRecentStoryRegex(rule.pattern);
    if (!parsed) continue;
    if (rule.type !== 'exclude') {
      extractRegexes.push(parsed.regex);
      continue;
    }
    try {
      cleanedContent = cleanedContent.replace(parsed.regex, '');
    } catch {
      // 单条清洗规则异常时保留当前正文，避免中断本次分析。
    }
  }
  if (!extractRegexes.length) return cleanedContent.trim();

  const extractedBlocks = [];
  for (const regex of extractRegexes) {
    try {
      extractedBlocks.push(...extractRecentStoryMatches(cleanedContent, regex));
    } catch {
      // 单条提取规则异常时跳过当前规则，继续处理其它规则。
    }
  }
  return extractedBlocks.join('\n');
}

// 全局规则不携带读取开关；合并时保留当前 Chat 的读取楼数和用户楼行为。
export function mergeRecentStorySettings(globalSettings = {}, characterSettings = {}) {
  const global = normalizeRecentStoryGlobalSettings(globalSettings);
  const character = normalizeRecentStorySettings(characterSettings);
  return {
    ...character,
    regex_rules: [...global.regex_rules, ...character.regex_rules],
  };
}

// 最近剧情只读取当前 Chat 最后 N 条消息，并保留消息自带的真实 floor；缺失时才使用数组位置。
export function collectRecentStory({context = null, settings = {}, items = null} = {}) {
  const normalized = normalizeRecentStorySettings(settings);
  if (!normalized.enabled) {
    return {
      enabled: false,
      floor_count: normalized.floor_count,
      floor_start: null,
      floor_end: null,
      items: [],
    };
  }

  const rawItems = Array.isArray(items)
    ? items
    : Array.isArray(context?.chat)
      ? context.chat.slice(-normalized.floor_count)
      : [];
  const storyItems = rawItems.map((message, offset) => {
    const originalIndex = Array.isArray(context?.chat)
      ? Math.max(0, context.chat.length - rawItems.length) + offset
      : offset;
    const originalContent = message?.content !== undefined && message?.floor !== undefined && !message?.mes
      ? safeContent(message.content)
      : messageContent(message);
    const floor = messageFloor(message, originalIndex);
    const role = messageRole(message);
    // 开场白保留原文；用户楼只有显式开启时才参与正则处理。
    const shouldApplyRegex = floor !== 0 && (role !== 'user' || normalized.regex_user_enabled);
    const content = shouldApplyRegex
      ? applyRecentStoryRegex(originalContent, normalized.regex_rules)
      : originalContent;
    if (!content.trim()) return null;
    return {
      floor,
      role,
      content,
    };
  }).filter(Boolean);
  const floorStart = storyItems.length ? storyItems[0].floor : null;
  const floorEnd = storyItems.length ? storyItems.at(-1).floor : null;
  return {
    enabled: true,
    floor_count: normalized.floor_count,
    floor_start: floorStart,
    floor_end: floorEnd,
    items: storyItems,
  };
}

function providerItems(provider) {
  if (!provider || typeof provider !== 'object') return [];
  if (Array.isArray(provider.items)) return provider.items;
  const content = safeContent(provider.content);
  return content ? [{label: provider.label, content}] : [];
}

function buildExternalMemoryInput(settings, providers) {
  const normalized = normalizeExternalMemorySettings(settings);
  const providerByKey = new Map((Array.isArray(providers) ? providers : [])
    .filter(provider => provider && typeof provider === 'object')
    .map(provider => [safeId(provider.key), provider]));
  return EXTERNAL_MEMORY_DEFINITIONS.map(definition => {
    const provider = providerByKey.get(definition.key) ?? {};
    const enabled = normalized[definition.key] === true;
    const available = provider.available === true;
    const rawItems = enabled && provider.content_available === true ? providerItems(provider) : [];
    const items = rawItems.map((item, index) => {
      const content = safeContent(item?.content ?? item?.text ?? item?.message ?? item);
      if (!content) return null;
      return {
        label: safeText(item?.label ?? item?.name ?? `${definition.label}内容 ${index + 1}`).trim(),
        content,
      };
    }).filter(Boolean);
    const hasContent = items.length > 0;
    const providerStatus = safeText(provider.status || '').trim();
    const readStatus = !enabled
      ? 'disabled'
      : !available
        ? 'unavailable'
        : /失败/.test(providerStatus)
          ? 'error'
          : hasContent
            ? 'success'
            : 'empty';
    const status = readStatus === 'disabled'
      ? '未启用'
      : readStatus === 'unavailable'
        ? '未检测到'
        : readStatus === 'error'
          ? `读取失败${providerStatus ? ` · ${providerStatus}` : ''}`
          : readStatus === 'success'
            ? `读取成功${providerStatus ? ` · ${providerStatus}` : ''}`
            : `读取成功（当前无内容）${providerStatus ? ` · ${providerStatus}` : ''}`;
    return {
      key: definition.key,
      label: definition.label,
      enabled,
      available,
      read_status: readStatus,
      status,
      content_available: hasContent,
      items,
    };
  });
}

export function estimateAnalysisTokens(input = {}) {
  let total = tokenEstimate(input?.persona?.description) + tokenEstimate(input?.character?.description);
  for (const greeting of input?.character?.greetings ?? []) total += tokenEstimate(greeting?.content);
  for (const worldbook of input?.worldbooks ?? []) {
    for (const entry of worldbook?.entries ?? []) total += tokenEstimate(entry?.content);
  }
  for (const item of input?.recent_story?.items ?? []) total += tokenEstimate(item?.content);
  for (const provider of input?.external_memory ?? []) {
    for (const item of provider?.items ?? []) total += tokenEstimate(item?.content);
  }
  return total;
}

export function buildAnalysisInput({
  sources = [],
  selected = [],
  context = null,
  chatId = undefined,
  chatSettings = {},
  recentStory = undefined,
  globalRecentStory = undefined,
  recentStoryItems = null,
  externalMemory = undefined,
  externalMemoryProviders = [],
} = {}) {
  const normalizedSelected = normalizedSelections(selected ?? chatSettings?.worldbooks?.selected);
  const character = buildCharacterInput(sources, normalizedSelected);
  const worldbooks = buildWorldbookInput(sources, normalizedSelected);
  const recentSettings = mergeRecentStorySettings(
    globalRecentStory ?? {},
    recentStory ?? chatSettings?.recent_story ?? {},
  );
  const recent_story = collectRecentStory({
    context,
    settings: recentSettings,
    items: recentStoryItems ?? recentSettings?.items ?? null,
  });
  const external_memory = buildExternalMemoryInput(
    externalMemory ?? chatSettings?.external_memory ?? {},
    externalMemoryProviders,
  );
  const persona = buildUserPersonaInput(context);
  const resolvedChatId = chatId !== undefined
    ? chatId
    : context?.chatId ?? context?.chat_id ?? null;
  const meta = {
    chat_id: resolvedChatId === null || resolvedChatId === undefined ? null : safeId(resolvedChatId) || null,
    floor_start: recent_story.floor_start,
    floor_end: recent_story.floor_end,
    user_name: persona.name || safeText(context?.name1 ?? context?.user_name ?? context?.userName) || null,
    character_name: safeText(context?.name2 ?? context?.character_name ?? context?.characterName) || null,
  };
  const input = {
    persona,
    character,
    worldbooks,
    recent_story,
    external_memory,
    meta,
    token_estimate: 0,
  };
  input.token_estimate = estimateAnalysisTokens(input);
  return input;
}

// Event extraction has a narrower contract than the World Model input. It is
// intentionally built from the current Floor boundary and never copies host
// context or API settings wholesale.
export function normalizeEventAnalysisInput(options = {}) {
  const source = options && typeof options === 'object' ? options : {};
  const nested = source.analysisInput && typeof source.analysisInput === 'object'
    ? source.analysisInput
    : source;
  const requestedScope = source.chat_scope ?? nested.chat_scope ?? source.chatScope ?? nested.chatScope;
  const requestedVersion = source.floor_version
    ?? nested.floor_version
    ?? source.floorVersion
    ?? nested.floorVersion
    ?? {};
  const context = source.context ?? nested.context;
  const fallbackChatId = source.chatId
    ?? source.chat_id
    ?? nested.chatId
    ?? nested.chat_id
    ?? context?.chatId
    ?? context?.chat_id
    ?? requestedScope?.chat_id
    ?? requestedScope?.chatId
    ?? null;
  const floor_version = normalizeEventFloorVersion(requestedVersion, fallbackChatId);
  const chat_id = floor_version.chat_id || safeId(fallbackChatId) || null;
  const currentFloor = source.current_floor
    ?? nested.current_floor
    ?? source.currentFloor
    ?? nested.currentFloor
    ?? {
      floor: source.floor ?? nested.floor,
      message_id: source.message_id ?? nested.message_id,
      swipe_id: source.swipe_id ?? nested.swipe_id,
      narrative: source.narrative ?? nested.narrative ?? source.content ?? nested.content,
      role: source.role ?? nested.role,
    };
  const recentContext = source.recent_context
    ?? nested.recent_context
    ?? source.recentContext
    ?? nested.recentContext;
  const worldModel = source.world_model
    ?? nested.world_model
    ?? source.worldModel
    ?? nested.worldModel
    ?? null;
  const storyTime = source.story_time
    ?? nested.story_time
    ?? source.storyTime
    ?? nested.storyTime
    ?? null;
  const characterContext = source.character_context
    ?? nested.character_context
    ?? source.characterContext
    ?? nested.characterContext
    ?? nested.character
    ?? null;

  return {
    chat_scope: {chat_id},
    floor_version,
    current_floor: normalizeEventCurrentFloor(currentFloor, floor_version),
    recent_context: normalizeEventRecentContext(recentContext, nested.recent_story),
    world_model: safeStructuredValue(worldModel),
    story_time: safeStructuredValue(normalizeStoryTime(storyTime)),
    character_context: safeStructuredValue(characterContext),
  };
}

export const buildEventAnalysisInput = normalizeEventAnalysisInput;

export const createAnalysisInput = buildAnalysisInput;
export const buildRecentStoryInput = collectRecentStory;
export {EXTERNAL_MEMORY_DEFINITIONS, tokenEstimate};
