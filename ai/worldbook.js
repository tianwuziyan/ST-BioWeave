export const ANALYSIS_SOURCE_TYPES = Object.freeze({
  CHARACTER_CARD: 'character_card',
  WORLDBOOK: 'worldbook',
  RECENT_STORY: 'recent_story',
});

const VALID_SOURCE_TYPES = new Set(Object.values(ANALYSIS_SOURCE_TYPES));
const WORLD_BOOK_LIST_ENDPOINT = '/api/worldinfo/list';
const WORLD_BOOK_GET_ENDPOINT = '/api/worldinfo/get';
const SOURCE_SELECTION_SEPARATOR = '\u0000';
const NORMALIZED_SOURCE_MARKER = Symbol('bioweaveNormalizedSource');

export const WORLD_BOOK_RUNTIME_GROUPS = Object.freeze({
  SELECTED_GLOBAL: 'selected_global',
  CHARACTER_CARD: 'character_card',
  CHARACTER: 'character',
  CHAT: 'chat',
  OTHER: 'other',
});

const RUNTIME_WORLD_BOOK_SCOPE_NAMES = Object.freeze([
  'selected_global_worldbook',
  'character_card_worldbook',
  'character_worldbook',
  'chat_worldbook',
  'other_worldbook',
]);

const CARD_FIELD_LABELS = Object.freeze({
  description: '角色描述',
});
const CHARACTER_CARD_OPENING_PREFIX = 'opening:';

const defaultWorldbookCaches = new WeakMap();
const fallbackWorldbookCache = {
  list: null,
  contents: new Map(),
  inFlight: new Map(),
  listInFlight: new Map(),
  generation: 0,
};

// 创建一次世界书缓存，列表和已解析内容共用同一个生命周期。
export function createWorldbookCache() {
  return {
    list: null,
    contents: new Map(),
    inFlight: new Map(),
    listInFlight: new Map(),
    generation: 0,
  };
}

function ensureWorldbookCache(cache) {
  if (!cache || typeof cache !== 'object') return fallbackWorldbookCache;
  if (!(cache.contents instanceof Map)) cache.contents = new Map();
  if (!(cache.inFlight instanceof Map)) cache.inFlight = new Map();
  if (!(cache.listInFlight instanceof Map)) cache.listInFlight = new Map();
  if (!Number.isFinite(cache.generation)) cache.generation = 0;
  return cache;
}

// 清除列表、内容和进行中的请求；旧请求完成时不会重新写回新一代缓存。
export function clearWorldbookCache(cache = fallbackWorldbookCache) {
  const target = ensureWorldbookCache(cache);
  target.list = null;
  target.contents.clear();
  target.inFlight.clear();
  target.listInFlight.clear();
  target.generation += 1;
  return target;
}

function worldbookCacheFor(options = {}) {
  if (options.cache) return ensureWorldbookCache(options.cache);
  const owner = typeof options.fetchRef === 'function'
    ? options.fetchRef
    : options.context && typeof options.context === 'object'
      ? options.context
      : null;
  if (!owner) return fallbackWorldbookCache;
  let cache = defaultWorldbookCaches.get(owner);
  if (!cache) {
    cache = createWorldbookCache();
    defaultWorldbookCaches.set(owner, cache);
  }
  return cache;
}

function timingNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function reportTiming(options, stage, startedAt, details = {}) {
  if (typeof options?.onTiming !== 'function') return;
  try {
    options.onTiming({
      stage,
      duration_ms: Math.max(0, Number((timingNow() - startedAt).toFixed(2))),
      ...details,
    });
  } catch {
    // 性能观测器失败不应影响世界书读取。
  }
}

// 标记内部已经完成归一化的来源，避免缓存命中和合并时重复遍历全部条目。
function markNormalizedSource(source) {
  if (source && !source[NORMALIZED_SOURCE_MARKER]) {
    Object.defineProperty(source, NORMALIZED_SOURCE_MARKER, {value: true});
  }
  return source;
}

function isNormalizedSource(source) {
  return Boolean(source?.[NORMALIZED_SOURCE_MARKER]);
}

function copyNormalizedSource(source, overrides = {}) {
  return markNormalizedSource({...source, ...overrides});
}

function textValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function encodeSourcePart(value) {
  return encodeURIComponent(textValue(value));
}

function sourceIdForWorldbook(hostKey) {
  const value = textValue(hostKey);
  return value ? `st-worldbook:${encodeSourcePart(value)}` : '';
}

function sourceIdForCharacterCard(characterKey) {
  const value = textValue(characterKey);
  return value ? `st-character-card:${encodeSourcePart(value)}` : '';
}

function runtimeReferenceText(value) {
  return typeof value === 'string' || typeof value === 'number' ? textValue(value) : '';
}

function firstRuntimeReferenceText(source, keys) {
  for (const key of keys) {
    const value = runtimeReferenceText(source?.[key]);
    if (value) return value;
  }
  return '';
}

function runtimeWorldbookReference(value) {
  const primitive = runtimeReferenceText(value);
  if (primitive) return {name: primitive, has_stable: false};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const sourceId = firstRuntimeReferenceText(value, ['source_id', 'sourceId', 'sourceID']);
  const hostKey = firstRuntimeReferenceText(value, [
    'host_key',
    'hostKey',
    'file_id',
    'fileId',
    'worldbook_id',
    'worldbookId',
    'lorebook_id',
    'lorebookId',
  ]) || (!sourceId ? firstRuntimeReferenceText(value, ['id', 'key']) : '');
  const name = firstRuntimeReferenceText(value, [
    'name',
    'label',
    'worldbook_name',
    'worldbookName',
    'lorebook_name',
    'lorebookName',
    'book_name',
    'bookName',
  ]) || (!sourceId && !hostKey ? firstRuntimeReferenceText(value, ['worldbook', 'lorebook', 'book', 'world']) : '');
  if (!sourceId && !hostKey && !name) return null;
  return {
    source_id: sourceId,
    host_key: hostKey,
    name,
    has_stable: Boolean(sourceId || hostKey),
  };
}

function runtimeWorldbookReferences(value) {
  if (Array.isArray(value)) return value.flatMap(item => runtimeWorldbookReferences(item));
  const direct = runtimeWorldbookReference(value);
  if (direct) return [direct];
  if (!value || typeof value !== 'object') return [];

  const references = [];
  for (const [key, nested] of Object.entries(value)) {
    if (['globalSelection', 'globalSelect', 'selected_global_lorebooks', 'selectedGlobalLorebooks'].includes(key)) continue;
    if (nested === true) {
      const name = textValue(key);
      if (name) references.push({name, has_stable: false});
      continue;
    }
    references.push(...runtimeWorldbookReferences(nested));
  }
  return references;
}

function runtimeReferenceIdentity(reference) {
  if (reference?.source_id) return `source:${reference.source_id}`;
  if (reference?.host_key) return `host:${reference.host_key}`;
  if (reference?.name) return `name:${reference.name.toLocaleLowerCase()}`;
  return '';
}

function uniqueRuntimeWorldbookReferences(values = []) {
  const seen = new Set();
  const references = [];
  for (const value of values) {
    const reference = value?.has_stable !== undefined ? value : runtimeWorldbookReference(value);
    const identity = runtimeReferenceIdentity(reference);
    if (!reference || !identity || seen.has(identity)) continue;
    seen.add(identity);
    references.push(reference);
  }
  return references;
}

function runtimeTavernHelper(options = {}) {
  return options.globalRef?.TavernHelper ?? globalThis.TavernHelper;
}

async function readRuntimeHelperValue(helper, method) {
  if (typeof helper?.[method] !== 'function') return undefined;
  try {
    return await helper[method].call(helper);
  } catch {
    return undefined;
  }
}

function sourceContent(value, seen = new Set()) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value !== 'object' || seen.has(value)) return '';
  seen.add(value);
  if (Array.isArray(value)) return value.map(item => sourceContent(item, seen)).filter(Boolean).join('\n');

  const preferredKeys = [
    'content',
    'text',
    'description',
    'personality',
    'scenario',
    'first_mes',
    'mes_example',
    'comment',
    'key',
    'keys',
    'title',
    'name',
    'entries',
    'character_book',
  ];
  const parts = [];
  for (const key of preferredKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const part = sourceContent(value[key], seen);
    if (part) parts.push(part);
  }
  return parts.join('\n');
}

export function tokenEstimate(text = '') {
  return Math.ceil(String(text ?? '').length / 4);
}

export function sourceText(source) {
  return sourceContent(source?.content ?? source?.text ?? source ?? '');
}

function sourceChildText(value) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(sourceChildText).filter(Boolean).join('\n');
  return '';
}

function entryCandidates(rawEntries) {
  if (Array.isArray(rawEntries)) return rawEntries.map((value, index) => ({value, hostKey: '', index}));
  if (!rawEntries || typeof rawEntries !== 'object') return [];
  return Object.entries(rawEntries).map(([hostKey, value], index) => ({value, hostKey, index}));
}

function entryIdFrom(value, hostKey) {
  if (value && typeof value === 'object') {
    for (const key of ['entry_id', 'uid', 'id', 'uuid', 'key_id']) {
      const rawId = value[key];
      const candidate = typeof rawId === 'string' || typeof rawId === 'number'
        ? String(rawId).trim()
        : '';
      if (candidate) return candidate;
    }
  }
  return textValue(hostKey);
}

function entryLabelFrom(value, entryId, index) {
  if (!value || typeof value !== 'object') return `条目 ${index + 1}`;
  const comment = textValue(value.comment ?? value.title ?? value.name);
  if (comment) return comment;
  const keys = Array.isArray(value.key) ? value.key : Array.isArray(value.keys) ? value.keys : [];
  const keyLabel = keys.map(textValue).filter(Boolean).join('、');
  return keyLabel || `条目 ${entryId || index + 1}`;
}

export function normalizeWorldbookEntries(rawEntries) {
  const seen = new Set();
  return entryCandidates(rawEntries).map(({value, hostKey, index}) => {
    const entryId = entryIdFrom(value, hostKey);
    if (!entryId || seen.has(entryId)) return null;
    seen.add(entryId);
    const content = value && typeof value === 'object'
      ? value.content ?? value.text ?? ''
      : value;
    const contentText = sourceChildText(content);
    return {
      entry_id: entryId,
      label: entryLabelFrom(value, entryId, index),
      content: contentText,
      token_estimate: tokenEstimate(contentText),
      available: true,
    };
  }).filter(Boolean);
}

function characterCardData(character) {
  if (character?.data && typeof character.data === 'object') return {...character, ...character.data};
  return character && typeof character === 'object' ? character : {};
}

export function isCharacterCardOpeningFieldKey(fieldKey) {
  const key = textValue(fieldKey);
  return key === 'opening:main' || /^opening:alternate:\d+$/.test(key);
}

function characterCardFieldLabel(fieldKey) {
  const key = textValue(fieldKey);
  if (key === 'description') return CARD_FIELD_LABELS.description;
  if (key === 'opening:main') return '主开场白';
  const alternateMatch = key.match(/^opening:alternate:(\d+)$/);
  return alternateMatch ? `其他开场白 ${Number(alternateMatch[1]) + 1}` : '';
}

// 根据 SillyTavern 当前首条角色消息的 swipe_id 识别正在使用的开场白。
// 没有稳定的首条消息或 swipe 信息时返回空值，避免把相似正文误判为当前开场白。
export function detectCurrentCharacterGreetingField(character, context) {
  const card = characterCardData(character);
  const mainGreeting = sourceChildText(card.first_mes);
  const alternateGreetings = Array.isArray(card.alternate_greetings)
    ? card.alternate_greetings
    : [card.alternate_greetings];
  const hasAlternates = alternateGreetings.some(greeting => Boolean(sourceChildText(greeting)));
  const firstMessage = Array.isArray(context?.chat) ? context.chat[0] : null;
  if (!firstMessage || firstMessage.is_user === true || firstMessage.is_system === true) return '';

  const cardName = textValue(card.name ?? character?.name);
  const messageName = textValue(firstMessage.name);
  if (cardName && messageName && cardName !== messageName) return '';

  let swipeId;
  if (Number.isInteger(firstMessage.swipe_id)) {
    swipeId = firstMessage.swipe_id;
  } else if (!hasAlternates && mainGreeting) {
    swipeId = 0;
  } else {
    return '';
  }
  if (swipeId < 0 || (Array.isArray(firstMessage.swipes) && swipeId >= firstMessage.swipes.length)) return '';

  if (mainGreeting) {
    if (swipeId === 0) return 'opening:main';
    const alternateIndex = swipeId - 1;
    return sourceChildText(alternateGreetings[alternateIndex])
      ? `${CHARACTER_CARD_OPENING_PREFIX}alternate:${alternateIndex}`
      : '';
  }
  return sourceChildText(alternateGreetings[swipeId])
    ? `${CHARACTER_CARD_OPENING_PREFIX}alternate:${swipeId}`
    : '';
}

export function normalizeCharacterCardFields(character, options = {}) {
  const card = characterCardData(character);
  const currentGreetingField = textValue(options?.currentGreetingField);
  const fields = [];
  const seen = new Set();
  const addField = (fieldKey, value, label = '') => {
    const key = textValue(fieldKey);
    const content = sourceChildText(value);
    if (!key || !content || seen.has(key)) return;
    seen.add(key);
    fields.push({
      field_key: key,
      label: label || characterCardFieldLabel(key) || key,
      content,
      token_estimate: tokenEstimate(content),
      available: true,
      is_current: isCharacterCardOpeningFieldKey(key) && key === currentGreetingField,
    });
  };

  addField('description', card.description, CARD_FIELD_LABELS.description);
  const alternateGreetings = Array.isArray(card.alternate_greetings)
    ? card.alternate_greetings
    : [card.alternate_greetings];
  addField('opening:main', card.first_mes, '主开场白');
  alternateGreetings.forEach((greeting, index) => {
    addField(`${CHARACTER_CARD_OPENING_PREFIX}alternate:${index}`, greeting, `开场白 ${index + 2}`);
  });
  return fields;
}

function normalizeScopes(scopes, sourceType) {
  const values = Array.isArray(scopes) ? scopes : [];
  const normalized = [...new Set(values.map(value => textValue(value)).filter(Boolean))];
  if (sourceType === ANALYSIS_SOURCE_TYPES.CHARACTER_CARD && !normalized.includes('character_card')) normalized.push('character_card');
  if (sourceType === ANALYSIS_SOURCE_TYPES.WORLDBOOK && !normalized.includes('worldbook')) normalized.push('worldbook');
  if (sourceType === ANALYSIS_SOURCE_TYPES.RECENT_STORY && !normalized.includes('recent_story')) normalized.push('recent_story');
  return normalized;
}

function sourceLabel(value, sourceType, fallback) {
  const label = textValue(value);
  const labels = {
    'Character Card': '角色卡',
    'Recent Story Context': '最近剧情',
    Worldbook: '世界书',
  };
  return labels[label] || label || fallback;
}

function entriesFromSource(source, content) {
  if (Array.isArray(source?.entries)) return source.entries;
  if (content && typeof content === 'object') {
    return normalizeWorldbookEntries(content.entries ?? content.data?.entries ?? content);
  }
  return normalizeWorldbookEntries(source?.content?.entries ?? source?.content?.data?.entries);
}

function fieldsFromSource(source) {
  if (!Array.isArray(source?.fields)) return [];
  return source.fields.map(field => {
    const content = sourceChildText(field?.content);
    return {
      field_key: textValue(field?.field_key),
      label: characterCardFieldLabel(field?.field_key),
      content,
      token_estimate: tokenEstimate(content),
      available: field?.available !== false,
      is_current: field?.is_current === true,
    };
  }).filter(field => field.field_key && (field.field_key === 'description' || isCharacterCardOpeningFieldKey(field.field_key)) && field.label && field.content);
}

export function normalizeAnalysisSource(raw = {}, overrides = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const requestedSourceType = textValue(overrides.source_type ?? source.source_type);
  if (requestedSourceType && !VALID_SOURCE_TYPES.has(requestedSourceType)) return null;
  const sourceType = requestedSourceType || ANALYSIS_SOURCE_TYPES.WORLDBOOK;
  const hostKey = textValue(overrides.host_key ?? source.host_key ?? source.file_id ?? source.fileId ?? source.id);
  const sourceId = textValue(overrides.source_id ?? source.source_id)
    || (sourceType === ANALYSIS_SOURCE_TYPES.WORLDBOOK ? sourceIdForWorldbook(hostKey) : '');
  const content = overrides.content ?? source.content ?? source.text ?? '';
  const entries = sourceType === ANALYSIS_SOURCE_TYPES.WORLDBOOK
    ? entriesFromSource({...source, entries: overrides.entries ?? source.entries}, content)
    : [];
  const fields = sourceType === ANALYSIS_SOURCE_TYPES.CHARACTER_CARD
    ? fieldsFromSource({fields: Array.isArray(overrides.fields) ? overrides.fields : source.fields})
    : [];
  const contentTokenEstimate = sourceType === ANALYSIS_SOURCE_TYPES.WORLDBOOK
    ? entries.reduce((total, entry) => total + Number(entry.token_estimate || 0), 0)
    : sourceType === ANALYSIS_SOURCE_TYPES.CHARACTER_CARD
      ? fields.reduce((total, field) => total + Number(field.token_estimate || 0), 0)
      : tokenEstimate(sourceContent(content));
  return markNormalizedSource({
    source_id: sourceId,
    source_type: sourceType,
    kind: source.kind ?? (sourceType === ANALYSIS_SOURCE_TYPES.WORLDBOOK ? 'worldbook' : 'context'),
    label: sourceLabel(overrides.label ?? source.label ?? source.name, sourceType, hostKey || sourceId),
    host_key: hostKey || null,
    available: overrides.available ?? source.available !== false,
    content_available: overrides.content_available ?? source.content_available ?? Boolean(entries.length || fields.length || sourceText({content})),
    content,
    entries,
    fields,
    content_loaded: overrides.content_loaded ?? source.content_loaded ?? false,
    token_estimate: contentTokenEstimate,
    scopes: normalizeScopes(overrides.scopes ?? source.scopes, sourceType),
  });
}

function listCandidates(rawList) {
  if (Array.isArray(rawList)) return rawList;
  if (Array.isArray(rawList?.worldbooks)) return rawList.worldbooks;
  if (Array.isArray(rawList?.items)) return rawList.items;
  if (Array.isArray(rawList?.data)) return rawList.data;
  return [];
}

export function normalizeWorldbookList(rawList) {
  return listCandidates(rawList).map(item => {
    const source = item && typeof item === 'object' ? item : {name: item};
    const sourceId = textValue(source.source_id);
    const hostKey = textValue(source.file_id ?? source.fileId ?? source.host_key ?? source.id ?? sourceId);
    if (!hostKey && !sourceId) return null;
    const content = source.content ?? source.entries ?? source.data?.entries ?? '';
    const entries = normalizeWorldbookEntries(source.entries ?? source.data?.entries ?? source.content?.entries);
    return normalizeAnalysisSource(source, {
      source_id: sourceId || sourceIdForWorldbook(hostKey),
      source_type: ANALYSIS_SOURCE_TYPES.WORLDBOOK,
      host_key: hostKey,
      label: source.name ?? source.label ?? hostKey ?? sourceId,
      content,
      entries,
      available: true,
      content_available: Boolean(entries.length || (typeof content === 'string' && content.trim())),
      content_loaded: Boolean(entries.length || Array.isArray(source.entries) || Boolean(source.data?.entries || source.content?.entries)),
      scopes: ['global_worldbook'],
    });
  }).filter(Boolean);
}

function mergeChildren(existing = [], next = [], key) {
  if (existing === next) return existing;
  if (!existing.length) return next;
  if (!next.length) return existing;
  const merged = new Map();
  for (const child of [...existing, ...next]) {
    const id = textValue(child?.[key]);
    if (!id) continue;
    merged.set(id, merged.has(id) ? {...merged.get(id), ...child} : child);
  }
  return [...merged.values()];
}

function mergeSource(existing, next) {
  const content = existing.content_available || existing.content_loaded || existing.entries.length
    ? existing.content
    : next.content;
  const sameEntries = existing.entries === next.entries;
  const sameFields = existing.fields === next.fields;
  const entries = mergeChildren(existing.entries, next.entries, 'entry_id');
  const fields = mergeChildren(existing.fields, next.fields, 'field_key');
  const contentAvailable = existing.content_available || next.content_available || Boolean(entries.length || fields.length || sourceText({content}));
  const type = existing.source_type || next.source_type;
  const tokenEstimateValue = type === ANALYSIS_SOURCE_TYPES.WORLDBOOK
    ? sameEntries ? existing.token_estimate : entries.reduce((total, entry) => total + Number(entry.token_estimate || 0), 0)
    : type === ANALYSIS_SOURCE_TYPES.CHARACTER_CARD
      ? sameFields ? existing.token_estimate : fields.reduce((total, field) => total + Number(field.token_estimate || 0), 0)
      : tokenEstimate(sourceContent(content));
  return markNormalizedSource({
    ...existing,
    ...next,
    label: existing.label || next.label,
    host_key: existing.host_key || next.host_key,
    available: existing.available || next.available,
    content,
    entries,
    fields,
    content_available: contentAvailable,
    content_loaded: existing.content_loaded || next.content_loaded,
    token_estimate: tokenEstimateValue,
    scopes: [...new Set([...(existing.scopes ?? []), ...(next.scopes ?? [])])],
  });
}

export function mergeAnalysisSources(sources = []) {
  const merged = new Map();
  for (const source of sources) {
    const normalized = isNormalizedSource(source) ? source : normalizeAnalysisSource(source);
    if (!normalized?.source_id) continue;
    const mergeKey = normalized.source_type === ANALYSIS_SOURCE_TYPES.WORLDBOOK && normalized.host_key
      ? `worldbook:${normalized.host_key}`
      : normalized.source_id;
    if (!merged.has(mergeKey)) {
      merged.set(mergeKey, normalized);
      continue;
    }
    const existing = merged.get(mergeKey);
    const mergedSource = mergeSource(existing, normalized);
    if (existing.source_id !== normalized.source_id) mergedSource.source_id = existing.source_id;
    merged.set(mergeKey, mergedSource);
  }
  return [...merged.values()];
}

function childMatches(child, query, key) {
  return [child?.[key], child?.label, child?.content]
    .some(value => String(value ?? '').toLocaleLowerCase().includes(query));
}

export function searchAnalysisSources(sources = [], query = '') {
  const normalizedQuery = textValue(query).toLocaleLowerCase();
  if (!normalizedQuery) return [...sources];
  return sources.map(source => {
    const sourceMatches = [source.label, source.source_id, source.source_type, ...(source.scopes ?? [])]
      .some(value => String(value ?? '').toLocaleLowerCase().includes(normalizedQuery));
    if (sourceMatches) return source;
    const entries = Array.isArray(source.entries)
      ? source.entries.filter(entry => childMatches(entry, normalizedQuery, 'entry_id'))
      : [];
    const fields = Array.isArray(source.fields)
      ? source.fields.filter(field => childMatches(field, normalizedQuery, 'field_key'))
      : [];
    if (!entries.length && !fields.length) return null;
    return {...source, entries, fields};
  }).filter(Boolean);
}

function normalizedSelectionItem(item) {
  if (!item || typeof item !== 'object') return null;
  const sourceId = textValue(item.source_id);
  if (!sourceId || item.enabled === false || (item.entry_id && item.field_key)) return null;
  const entryId = textValue(item.entry_id);
  const fieldKey = textValue(item.field_key);
  const result = {source_id: sourceId};
  if (entryId) result.entry_id = entryId;
  else if (fieldKey) result.field_key = fieldKey;
  result.enabled = true;
  return result;
}

function selectionIdentity(item) {
  const normalized = typeof item === 'string'
    ? {source_id: textValue(item), enabled: true}
    : normalizedSelectionItem(item);
  if (!normalized?.source_id) return '';
  if (normalized.entry_id) return `${normalized.source_id}${SOURCE_SELECTION_SEPARATOR}entry${SOURCE_SELECTION_SEPARATOR}${normalized.entry_id}`;
  if (normalized.field_key) return `${normalized.source_id}${SOURCE_SELECTION_SEPARATOR}field${SOURCE_SELECTION_SEPARATOR}${normalized.field_key}`;
  return `${normalized.source_id}${SOURCE_SELECTION_SEPARATOR}source`;
}

function normalizedSelections(selected = []) {
  const result = [];
  const seen = new Set();
  for (const item of Array.isArray(selected) ? selected : []) {
    const normalized = typeof item === 'string'
      ? (textValue(item) ? {source_id: textValue(item), enabled: true} : null)
      : normalizedSelectionItem(item);
    const identity = selectionIdentity(normalized);
    if (!normalized || !identity || seen.has(identity)) continue;
    seen.add(identity);
    result.push(normalized);
  }
  return result;
}

function stableWorldbookEntryIds(source) {
  const ids = [];
  const seen = new Set();
  for (const entry of Array.isArray(source?.entries) ? source.entries : []) {
    const entryId = textValue(entry?.entry_id);
    if (!entryId || seen.has(entryId)) continue;
    seen.add(entryId);
    ids.push(entryId);
  }
  return ids;
}

function stableCharacterOpeningFieldKeys(source) {
  const keys = [];
  const seen = new Set();
  for (const field of Array.isArray(source?.fields) ? source.fields : []) {
    const fieldKey = textValue(field?.field_key);
    if (!isCharacterCardOpeningFieldKey(fieldKey) || seen.has(fieldKey)) continue;
    seen.add(fieldKey);
    keys.push(fieldKey);
  }
  return keys;
}

function selectionStateForChildren(sourceId, childIds, selected, childKey) {
  const ids = new Set(childIds);
  const selectedIds = new Set();
  for (const item of normalizedSelections(selected)) {
    if (item.source_id !== sourceId || !item[childKey] || !ids.has(item[childKey])) continue;
    selectedIds.add(item[childKey]);
  }
  const selectedCount = selectedIds.size;
  return {
    total_count: childIds.length,
    selected_count: selectedCount,
    checked: childIds.length > 0 && selectedCount === childIds.length,
    indeterminate: selectedCount > 0 && selectedCount < childIds.length,
  };
}

// 世界书父级状态只由当前书的稳定条目选择派生，不读取父级选择。
export function worldbookSelectionState(source = {}, selected = []) {
  const sourceId = textValue(source?.source_id);
  const entryIds = stableWorldbookEntryIds(source);
  return selectionStateForChildren(sourceId, entryIds, selected, 'entry_id');
}

export function setWorldbookEntriesSelection(selected = [], source = {}, enabled) {
  const normalized = normalizedSelections(selected);
  const sourceId = textValue(source?.source_id);
  if (!sourceId) return normalized;

  const next = normalized.filter(item => item.source_id !== sourceId || item.field_key);
  if (!enabled) return next;

  const seen = new Set(next.map(selectionIdentity));
  for (const entryId of stableWorldbookEntryIds(source)) {
    const item = {source_id: sourceId, entry_id: entryId, enabled: true};
    const identity = selectionIdentity(item);
    if (seen.has(identity)) continue;
    seen.add(identity);
    next.push(item);
  }
  return next;
}

// 开场白父级状态只由主开场白和备用开场白的逐条选择派生。
export function characterOpeningSelectionState(source = {}, selected = []) {
  const sourceId = textValue(source?.source_id);
  const fieldKeys = stableCharacterOpeningFieldKeys(source);
  return selectionStateForChildren(sourceId, fieldKeys, selected, 'field_key');
}

export function setCharacterCardOpeningsSelection(selected = [], source = {}, enabled) {
  const normalized = normalizedSelections(selected);
  const sourceId = textValue(source?.source_id);
  if (!sourceId) return normalized;

  const next = normalized.filter(item => {
    if (item.source_id !== sourceId) return true;
    if (item.field_key === 'description') return true;
    if (!item.field_key || item.field_key === 'opening' || isCharacterCardOpeningFieldKey(item.field_key)) return false;
    return true;
  });
  if (!enabled) return next;

  const seen = new Set(next.map(selectionIdentity));
  for (const fieldKey of stableCharacterOpeningFieldKeys(source)) {
    const item = {source_id: sourceId, field_key: fieldKey, enabled: true};
    const identity = selectionIdentity(item);
    if (seen.has(identity)) continue;
    seen.add(identity);
    next.push(item);
  }
  return next;
}

export function selectedSourceIds(selected = []) {
  return [...new Set(normalizedSelections(selected).map(item => item.source_id).filter(Boolean))];
}

export function sourceSelectionStats(sources = [], selected = []) {
  const selectedItems = normalizedSelections(selected);
  const selectedSet = new Set(selectedItems.map(selectionIdentity));
  const selectedSources = new Set();
  let count = 0;
  let tokenEstimateValue = 0;
  for (const source of Array.isArray(sources) ? sources : []) {
    if (source.available === false) continue;
    const children = source.source_type === ANALYSIS_SOURCE_TYPES.WORLDBOOK
      ? source.entries ?? []
      : source.source_type === ANALYSIS_SOURCE_TYPES.CHARACTER_CARD
        ? source.fields ?? []
        : [];
    const childKey = source.source_type === ANALYSIS_SOURCE_TYPES.WORLDBOOK ? 'entry_id' : 'field_key';
    for (const child of children) {
      const item = {source_id: source.source_id, [childKey]: child[childKey], enabled: true};
      if (!selectedSet.has(selectionIdentity(item))) continue;
      count += 1;
      tokenEstimateValue += Number(child.token_estimate || 0);
      selectedSources.add(source.source_id);
    }
  }
  return {
    count,
    source_count: selectedSources.size,
    worldbook_count: [...selectedSources].filter(sourceId => sources.some(source => source.source_id === sourceId && source.source_type === ANALYSIS_SOURCE_TYPES.WORLDBOOK)).length,
    token_estimate: tokenEstimateValue,
    selected_items: selectedItems,
  };
}

export function selectAllSources(sources = []) {
  const selected = [];
  for (const source of Array.isArray(sources) ? sources : []) {
    if (!source?.source_id || source.available === false) continue;
    const children = source.source_type === ANALYSIS_SOURCE_TYPES.WORLDBOOK
      ? source.entries ?? []
      : source.source_type === ANALYSIS_SOURCE_TYPES.CHARACTER_CARD
        ? source.fields ?? []
        : [];
    const childKey = source.source_type === ANALYSIS_SOURCE_TYPES.WORLDBOOK ? 'entry_id' : 'field_key';
    for (const child of children) {
      const childId = textValue(child?.[childKey]);
      if (!childId) continue;
      selected.push({source_id: source.source_id, [childKey]: childId, enabled: true});
    }
  }
  return selected;
}

export function selectNoneSources() {
  return [];
}

export function updateSourceSelection(selected = [], target, enabled) {
  const current = new Map(normalizedSelections(selected).map(item => [selectionIdentity(item), item]));
  const item = typeof target === 'string'
    ? {source_id: textValue(target), enabled: true}
    : normalizedSelectionItem({...target, enabled: true});
  const identity = selectionIdentity(item);
  if (!identity) return [...current.values()];
  if (enabled) current.set(identity, item);
  else current.delete(identity);
  return [...current.values()];
}

function requestHeaders(getRequestHeaders) {
  let headers = {};
  try {
    headers = getRequestHeaders?.() ?? {};
  } catch {
    headers = {};
  }
  const contentType = Object.keys(headers).find(key => key.toLowerCase() === 'content-type');
  return contentType ? {...headers} : {...headers, 'Content-Type': 'application/json'};
}

async function responseJson(response, errorCode) {
  if (!response?.ok) throw new Error(`${errorCode}_${Number(response?.status) || 0}`);
  try {
    return await response.json();
  } catch {
    throw new Error(`${errorCode}_INVALID_RESPONSE`);
  }
}

async function fetchWorldbookList({fetchRef, getRequestHeaders}) {
  if (typeof fetchRef !== 'function') throw new Error('ST_WORLDBOOK_LIST_UNAVAILABLE');
  const response = await fetchRef(WORLD_BOOK_LIST_ENDPOINT, {
    method: 'POST',
    headers: requestHeaders(getRequestHeaders),
  });
  return responseJson(response, 'ST_WORLDBOOK_LIST_FAILED');
}

async function fetchWorldbookContent(hostKey, {fetchRef, getRequestHeaders}) {
  if (typeof fetchRef !== 'function') throw new Error('ST_WORLDBOOK_CONTENT_UNAVAILABLE');
  const response = await fetchRef(WORLD_BOOK_GET_ENDPOINT, {
    method: 'POST',
    headers: requestHeaders(getRequestHeaders),
    body: JSON.stringify({name: hostKey}),
  });
  return responseJson(response, 'ST_WORLDBOOK_CONTENT_FAILED');
}

function loadedEntries(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') return payload.entries ?? payload.data?.entries ?? [];
  return [];
}

async function loadWorldbookContentUncached(source, options) {
  const fetchStartedAt = timingNow();
  const context = options.context;
  if (typeof context?.loadWorldInfo === 'function' && source.host_key) {
    try {
      const loaded = await context.loadWorldInfo(source.host_key);
      if (loaded) {
        const normalizeStartedAt = timingNow();
        const result = normalizeAnalysisSource(source, {
          available: true,
          content: loaded,
          entries: normalizeWorldbookEntries(loadedEntries(loaded)),
          content_available: true,
          content_loaded: true,
        });
        reportTiming(options, 'normalize_content', normalizeStartedAt, {host_key: source.host_key});
        reportTiming(options, 'content_fetch', fetchStartedAt, {host_key: source.host_key, method: 'context'});
        return result;
      }
    } catch {
      // 公开加载能力失败时继续尝试官方 endpoint。
    }
  }
  try {
    const loaded = await fetchWorldbookContent(source.host_key, options);
    const normalizeStartedAt = timingNow();
    const result = normalizeAnalysisSource(source, {
      available: true,
      content: loaded,
      entries: normalizeWorldbookEntries(loadedEntries(loaded)),
      content_available: true,
      content_loaded: true,
    });
    reportTiming(options, 'normalize_content', normalizeStartedAt, {host_key: source.host_key});
    reportTiming(options, 'content_fetch', fetchStartedAt, {host_key: source.host_key, method: 'endpoint'});
    return result;
  } catch {
    reportTiming(options, 'content_fetch', fetchStartedAt, {host_key: source.host_key, method: 'failed'});
    return normalizeAnalysisSource(source, {
      content: '',
      entries: [],
      content_available: false,
      content_loaded: false,
    });
  }
}

function worldbookSourceMatches(source, sourceIds) {
  const ids = sourceIds instanceof Set ? sourceIds : new Set(Array.isArray(sourceIds) ? sourceIds : []);
  return ids.has(source.source_id) || ids.has(source.host_key);
}

function sourceRuntimeStableKeys(source) {
  const keys = new Set();
  const sourceId = textValue(source?.source_id);
  const hostKey = textValue(source?.host_key);
  if (sourceId) keys.add(sourceId);
  if (hostKey) {
    keys.add(hostKey);
    keys.add(sourceIdForWorldbook(hostKey));
  }
  return keys;
}

function referenceRuntimeStableKeys(reference) {
  const keys = new Set();
  const sourceId = textValue(reference?.source_id);
  const hostKey = textValue(reference?.host_key);
  if (sourceId) keys.add(sourceId);
  if (hostKey) {
    keys.add(hostKey);
    keys.add(sourceIdForWorldbook(hostKey));
  }
  return keys;
}

function sourceRuntimeNames(source) {
  return [source?.label, source?.name, source?.host_key]
    .map(value => textValue(value).toLocaleLowerCase())
    .filter(Boolean);
}

function sourceMatchesRuntimeReference(source, reference, sourceNameCounts = new Map()) {
  if (!source || !reference) return false;
  const sourceKeys = sourceRuntimeStableKeys(source);
  const referenceKeys = referenceRuntimeStableKeys(reference);
  if ([...referenceKeys].some(key => sourceKeys.has(key))) return true;
  if (reference.has_stable || !reference.name) return false;

  const name = textValue(reference.name).toLocaleLowerCase();
  return sourceRuntimeNames(source).includes(name) && sourceNameCounts.get(name) === 1;
}

function sourceNameCounts(sources = []) {
  const counts = new Map();
  for (const source of sources) {
    for (const name of new Set(sourceRuntimeNames(source))) counts.set(name, (counts.get(name) || 0) + 1);
  }
  return counts;
}

function sourceMatchesAnyRuntimeReference(source, references, nameCounts) {
  return (Array.isArray(references) ? references : [])
    .some(reference => sourceMatchesRuntimeReference(source, reference, nameCounts));
}

function characterExtensionWorldbookReferences(character) {
  const extensions = character?.data?.extensions ?? character?.extensions ?? {};
  const additional = extensions.additional_worldbooks
    ?? extensions.additionalWorldbooks
    ?? extensions.additional_world_info
    ?? extensions.additionalWorldInfo
    ?? extensions.extraBooks
    ?? extensions.extra_books
    ?? extensions.worldbooks;
  return runtimeWorldbookReferences(additional);
}

async function resolveCharacterWorldbookReferences(character, context, options = {}) {
  const helper = runtimeTavernHelper(options);
  const helperLorebooks = await readRuntimeHelperValue(helper, 'getCharLorebooks');
  if (helperLorebooks && typeof helperLorebooks === 'object') {
    const primary = uniqueRuntimeWorldbookReferences(runtimeWorldbookReferences(helperLorebooks.primary));
    const additional = uniqueRuntimeWorldbookReferences(runtimeWorldbookReferences(helperLorebooks.additional));
    if (primary.length || additional.length) return {primary, additional};
  }

  const primary = uniqueRuntimeWorldbookReferences(runtimeWorldbookReferences(characterWorldbookValue(character)));
  const additional = uniqueRuntimeWorldbookReferences(characterExtensionWorldbookReferences(character));
  return {primary, additional};
}

async function resolveGlobalWorldbookReferences(context, options = {}) {
  const helper = runtimeTavernHelper(options);
  if (typeof helper?.getLorebookSettings === 'function') {
    const settings = await readRuntimeHelperValue(helper, 'getLorebookSettings');
    if (Array.isArray(settings?.selected_global_lorebooks)) {
      return uniqueRuntimeWorldbookReferences(runtimeWorldbookReferences(settings.selected_global_lorebooks));
    }
  }

  const chatWorldInfoSelection = context?.chatWorldInfo?.globalSelection;
  if (chatWorldInfoSelection !== undefined && chatWorldInfoSelection !== null) {
    const references = uniqueRuntimeWorldbookReferences(runtimeWorldbookReferences(chatWorldInfoSelection));
    if (references.length || Array.isArray(chatWorldInfoSelection)) return references;
  }
  return [];
}

function chatWorldbookReferences(context) {
  const metadataValues = [context?.chatMetadata, context?.chat_metadata]
    .map(metadata => metadata?.world_info ?? metadata?.worldInfo)
    .filter(value => value !== undefined && value !== null);
  const references = [];
  for (const value of metadataValues) {
    if (Array.isArray(value) || typeof value === 'string' || typeof value === 'number') {
      references.push(...runtimeWorldbookReferences(value));
      continue;
    }
    const chatValues = value?.chat
      ?? value?.chat_worldbooks
      ?? value?.chatWorldbooks
      ?? value?.names
      ?? value?.worldbooks
      ?? value?.books;
    if (chatValues !== undefined) {
      references.push(...runtimeWorldbookReferences(chatValues));
      continue;
    }
    const direct = runtimeWorldbookReference(value);
    if (direct) references.push(direct);
  }
  return uniqueRuntimeWorldbookReferences(references);
}

async function resolveWorldbookRuntimeReferences(context, options = {}) {
  const character = currentCharacter(context);
  const characterWorldbooks = await resolveCharacterWorldbookReferences(character, context, options);
  return {
    global: await resolveGlobalWorldbookReferences(context, options),
    character_primary: characterWorldbooks.primary,
    character_additional: characterWorldbooks.additional,
    character: uniqueRuntimeWorldbookReferences([
      ...characterWorldbooks.primary,
      ...characterWorldbooks.additional,
    ]),
    chat: chatWorldbookReferences(context),
  };
}

function runtimeWorldbookGroupForSource(source, references, nameCounts) {
  const scopes = new Set(Array.isArray(source?.scopes) ? source.scopes : []);
  const selectedGlobal = sourceMatchesAnyRuntimeReference(source, references?.global, nameCounts)
    || scopes.has('selected_global_worldbook');
  const characterCard = sourceMatchesAnyRuntimeReference(source, references?.character_primary, nameCounts)
    || scopes.has('character_card_worldbook');
  const character = sourceMatchesAnyRuntimeReference(source, references?.character_additional, nameCounts)
    || scopes.has('character_worldbook');
  const chat = sourceMatchesAnyRuntimeReference(source, references?.chat, nameCounts)
    || scopes.has('chat_worldbook');
  if (selectedGlobal) return WORLD_BOOK_RUNTIME_GROUPS.SELECTED_GLOBAL;
  if (characterCard) return WORLD_BOOK_RUNTIME_GROUPS.CHARACTER_CARD;
  if (character) return WORLD_BOOK_RUNTIME_GROUPS.CHARACTER;
  if (chat) return WORLD_BOOK_RUNTIME_GROUPS.CHAT;
  return WORLD_BOOK_RUNTIME_GROUPS.OTHER;
}

function classifyWorldbookSource(source, references, nameCounts) {
  if (source?.source_type !== ANALYSIS_SOURCE_TYPES.WORLDBOOK) return source;
  const group = runtimeWorldbookGroupForSource(source, references, nameCounts);
  const scopes = new Set(Array.isArray(source.scopes) ? source.scopes : []);
  const characterCardMatch = sourceMatchesAnyRuntimeReference(source, references?.character_primary, nameCounts)
    || scopes.has('character_card_worldbook');
  const characterMatch = sourceMatchesAnyRuntimeReference(source, references?.character_additional, nameCounts)
    || scopes.has('character_worldbook');
  const chatMatch = sourceMatchesAnyRuntimeReference(source, references?.chat, nameCounts)
    || scopes.has('chat_worldbook');
  RUNTIME_WORLD_BOOK_SCOPE_NAMES.forEach(scope => scopes.delete(scope));
  if (group === WORLD_BOOK_RUNTIME_GROUPS.SELECTED_GLOBAL) {
    scopes.add('global_worldbook');
    scopes.add('selected_global_worldbook');
  }
  if (characterCardMatch) {
    scopes.add('character_card_worldbook');
  }
  if (characterMatch) {
    scopes.add('character_worldbook');
  }
  if (chatMatch) {
    scopes.add('chat_worldbook');
  }
  scopes.add(`${group}_worldbook`);
  return copyNormalizedSource(source, {
    worldbook_group: group,
    scopes: [...scopes],
  });
}

function withoutWorldbookContent(source) {
  return copyNormalizedSource(source, {
    content: '',
    entries: [],
    content_available: false,
    content_loaded: false,
    token_estimate: 0,
  });
}

// 读取单本世界书，优先复用已解析内容并合并同一时刻的重复请求。
export async function loadWorldbookSource(source, options = {}) {
  const normalized = isNormalizedSource(source) ? source : normalizeAnalysisSource(source);
  if (!normalized?.source_id) return normalized;
  const cache = worldbookCacheFor(options);
  const hostKey = textValue(normalized.host_key);
  const forceRefresh = options.forceRefresh === true;
  if (normalized.content_loaded && !forceRefresh) {
    if (hostKey) {
      cache.contents.set(hostKey, {source: normalized});
    }
    reportTiming(options, 'content_cache', timingNow(), {host_key: hostKey, cache_hit: false, source_loaded: true});
    return normalized;
  }
  if (!hostKey) return normalized;

  const cached = cache.contents.get(hostKey);
  if (!forceRefresh && cached?.source) {
    const cacheStartedAt = timingNow();
    const result = copyNormalizedSource(normalized, {
      available: cached.source.available,
      content: cached.source.content,
      entries: cached.source.entries,
      fields: cached.source.fields,
      content_available: cached.source.content_available,
      content_loaded: cached.source.content_loaded,
      token_estimate: cached.source.token_estimate,
    });
    reportTiming(options, 'content_cache', cacheStartedAt, {host_key: hostKey, cache_hit: true});
    return result;
  }

  const generation = cache.generation;
  const inFlightKey = `${forceRefresh ? 'force:' : 'normal:'}${hostKey}`;
  const existingRequest = cache.inFlight.get(inFlightKey);
  if (existingRequest) {
    const result = await existingRequest;
    return copyNormalizedSource(normalized, {
      available: result.available,
      content: result.content,
      entries: result.entries,
      fields: result.fields,
      content_available: result.content_available,
      content_loaded: result.content_loaded,
      token_estimate: result.token_estimate,
    });
  }

  const request = loadWorldbookContentUncached(normalized, options);
  cache.inFlight.set(inFlightKey, request);
  try {
    const result = await request;
    if (result.content_loaded && generation === cache.generation) {
      cache.contents.set(hostKey, {source: result});
    }
    return result;
  } finally {
    if (cache.inFlight.get(inFlightKey) === request) cache.inFlight.delete(inFlightKey);
  }
}

function worldbookNameEntries(values) {
  if (!Array.isArray(values)) return [];
  return values.map(value => {
    if (typeof value === 'string') return {file_id: value, name: value};
    return value;
  }).filter(Boolean);
}

async function readPublicWorldbookNames(options) {
  const {context} = options;
  const forceRefresh = options.forceRefresh === true;
  const readContextNames = async () => {
    try {
      const names = await context?.getWorldInfoNames?.();
      return worldbookNameEntries(names);
    } catch {
      return [];
    }
  };
  const readHelperNames = async () => {
    const helper = options.globalRef?.TavernHelper ?? globalThis.TavernHelper;
    const reader = helper?.getWorldbookNames ?? helper?.getLorebooks;
    if (typeof reader !== 'function') return [];
    try {
      return worldbookNameEntries(await reader.call(helper));
    } catch {
      return [];
    }
  };

  if (forceRefresh && typeof context?.updateWorldInfoList === 'function') {
    try {
      await context.updateWorldInfoList();
    } catch {
      // 公共刷新能力不可用时继续尝试 endpoint。
    }
  }
  const contextNames = await readContextNames();
  if (contextNames.length) return {items: contextNames, method: 'context'};
  const helperNames = await readHelperNames();
  if (helperNames.length) return {items: helperNames, method: 'tavern_helper'};
  if (!forceRefresh && typeof context?.updateWorldInfoList === 'function') {
    try {
      await context.updateWorldInfoList();
    } catch {
      // 更新失败后让官方 endpoint 负责最终兜底。
    }
    const refreshedNames = await readContextNames();
    if (refreshedNames.length) return {items: refreshedNames, method: 'context_refresh'};
  }
  return null;
}

async function readWorldbookCatalog(options) {
  const cache = worldbookCacheFor(options);
  const generation = cache.generation;
  const listStartedAt = timingNow();
  let rawList;
  let warning = null;
  let method = 'endpoint';
  const publicNames = await readPublicWorldbookNames(options);
  if (publicNames?.items?.length) {
    rawList = publicNames.items;
    method = publicNames.method;
  } else {
    try {
      rawList = await fetchWorldbookList(options);
    } catch {
      reportTiming(options, 'list', listStartedAt, {cache_hit: false, source_count: 0, method: 'failed'});
      return {sources: [], warning: 'ST_WORLDBOOK_LIST_FAILED'};
    }
  }
  const normalizeStartedAt = timingNow();
  const sources = normalizeWorldbookList(rawList);
  reportTiming(options, 'normalize_list', normalizeStartedAt, {source_count: sources.length});
  const catalog = {
    sources,
    warning,
  };
  if (cache.generation === generation) cache.list = catalog;
  reportTiming(options, 'list', listStartedAt, {cache_hit: false, source_count: sources.length, method});

  return catalog;
}

async function readGlobalWorldbooks(options) {
  const cache = worldbookCacheFor(options);
  const forceRefresh = options.forceRefresh === true;
  const cachedList = cache.list;
  let catalog;
  if (!forceRefresh && cachedList) {
    catalog = cachedList;
    reportTiming(options, 'list', timingNow(), {cache_hit: true, source_count: cachedList.sources.length, method: 'cache'});
  } else {
    const requestKey = forceRefresh ? 'force' : 'normal';
    let listRequest = cache.listInFlight.get(requestKey);
    if (!listRequest) {
      listRequest = readWorldbookCatalog(options);
      cache.listInFlight.set(requestKey, listRequest);
    }
    try {
      catalog = await listRequest;
    } finally {
      if (cache.listInFlight.get(requestKey) === listRequest) cache.listInFlight.delete(requestKey);
    }
  }

  const nameCounts = sourceNameCounts(catalog.sources);
  const runtimeReferences = options.runtimeWorldbookReferences ?? {};
  const scopedSources = catalog.sources.map(source => classifyWorldbookSource(source, runtimeReferences, nameCounts));
  const selectedIds = new Set(options.loadContentForSourceIds ?? []);
  const loadedSources = options.deferWorldbookContent !== true || selectedIds.size > 0
    ? await Promise.all(scopedSources.map(source => source.worldbook_group === WORLD_BOOK_RUNTIME_GROUPS.CHAT
      ? withoutWorldbookContent(source)
      : options.deferWorldbookContent !== true || worldbookSourceMatches(source, selectedIds)
        ? loadWorldbookSource(source, options)
        : source))
    : scopedSources.map(source => source.worldbook_group === WORLD_BOOK_RUNTIME_GROUPS.CHAT
      ? withoutWorldbookContent(source)
      : source);
  return {sources: loadedSources, warning: catalog.warning};
}

function currentCharacter(context) {
  const characterId = context?.characterId;
  if (characterId === undefined || characterId === null) return null;
  return context?.characters?.[characterId] ?? null;
}

function stableCharacterKey(character, context) {
  return textValue(
    character?.avatar
      ?? character?.data?.avatar
      ?? character?.data?.extensions?.character_id
      ?? character?.data?.extensions?.id
      ?? context?.characterId,
  );
}

function characterWorldbookValue(character) {
  return character?.data?.extensions?.world ?? character?.extensions?.world ?? '';
}

function characterWorldbookKey(character) {
  const value = characterWorldbookValue(character);
  if (typeof value === 'string') return value.trim();
  const reference = runtimeWorldbookReference(value);
  return reference?.host_key || reference?.source_id || '';
}

function characterCardSource(character, context) {
  const characterKey = stableCharacterKey(character, context);
  const sourceId = sourceIdForCharacterCard(characterKey);
  const currentGreetingField = detectCurrentCharacterGreetingField(character, context);
  const fields = normalizeCharacterCardFields(character, {currentGreetingField});
  if (!sourceId || !fields.length) return null;
  return normalizeAnalysisSource({
    source_id: sourceId,
    source_type: ANALYSIS_SOURCE_TYPES.CHARACTER_CARD,
    kind: 'context',
    label: '角色卡',
    fields,
    available: true,
    content_available: true,
    scopes: ['character_card'],
  }, {fields});
}

function characterEmbeddedWorldbookSource(character, context, hasPrimaryWorldbook = false) {
  // SillyTavern 已有主世界书挂载时，角色卡内嵌数据不再生成重复来源。
  if (hasPrimaryWorldbook || characterWorldbookKey(character)) return null;
  const book = character?.data?.character_book ?? character?.character_book;
  const characterKey = stableCharacterKey(character, context);
  const entries = normalizeWorldbookEntries(book?.entries);
  if (!characterKey || !entries.length) return null;
  return normalizeAnalysisSource({
    source_id: `${sourceIdForCharacterCard(characterKey)}:embedded-worldbook`,
    source_type: ANALYSIS_SOURCE_TYPES.WORLDBOOK,
    kind: 'worldbook',
    label: '角色卡内嵌世界书',
    entries,
    available: true,
    content_available: true,
    content_loaded: true,
    scopes: ['character_card_worldbook'],
  }, {entries});
}

function mergeCharacterWorldbookSources(globalSources, characterReferences = {}) {
  const sources = Array.isArray(globalSources) ? globalSources : [];
  const nameCounts = sourceNameCounts(sources);
  const merged = new Map();
  const referenceGroups = [
    ['primary', 'character_card_worldbook'],
    ['additional', 'character_worldbook'],
  ];
  for (const [referenceKey, scope] of referenceGroups) {
    const references = Array.isArray(characterReferences[referenceKey]) ? characterReferences[referenceKey] : [];
    for (const reference of references) {
      const existing = sources.find(source => sourceMatchesRuntimeReference(source, reference, nameCounts));
      const hostKey = textValue(reference?.host_key) || textValue(existing?.host_key);
      const sourceId = textValue(existing?.source_id)
        || textValue(reference?.source_id)
        || sourceIdForWorldbook(hostKey);
      // 名称引用只能匹配已有的稳定目录项，不能据此创建持久 source_id。
      if (!existing && !reference?.has_stable) continue;
      if (!sourceId) continue;

      const mergeKey = existing?.source_id || existing?.host_key || sourceId;
      const current = merged.get(mergeKey);
      const base = current || existing || {
        source_id: sourceId,
        source_type: ANALYSIS_SOURCE_TYPES.WORLDBOOK,
        kind: 'worldbook',
        label: textValue(reference?.name) || hostKey || sourceId,
        host_key: hostKey || null,
        available: false,
        content: '',
        entries: [],
        content_available: false,
        content_loaded: false,
        scopes: [],
      };
      const scopes = [...new Set([...(base.scopes ?? []), scope])];
      const normalized = isNormalizedSource(base)
        ? copyNormalizedSource(base, {source_id: sourceId, source_type: ANALYSIS_SOURCE_TYPES.WORLDBOOK, host_key: hostKey || base.host_key || null, scopes})
        : normalizeAnalysisSource(base, {
          source_id: sourceId,
          source_type: ANALYSIS_SOURCE_TYPES.WORLDBOOK,
          host_key: hostKey || base.host_key || '',
          scopes,
        });
      merged.set(mergeKey, normalized);
    }
  }
  return [...merged.values()];
}

export async function loadAnalysisSources(options = {}) {
  const context = options.context ?? globalThis.SillyTavern?.getContext?.() ?? null;
  const sourceOptions = {
    ...options,
    context,
    fetchRef: options.fetchRef ?? globalThis.fetch,
    getRequestHeaders: options.getRequestHeaders ?? context?.getRequestHeaders?.bind(context),
  };
  const cache = worldbookCacheFor(sourceOptions);
  if (options.forceRefresh === true) clearWorldbookCache(cache);
  sourceOptions.cache = cache;
  const runtimeReferences = await resolveWorldbookRuntimeReferences(context, sourceOptions);
  sourceOptions.runtimeWorldbookReferences = runtimeReferences;
  const globalResult = await readGlobalWorldbooks(sourceOptions);
  const character = currentCharacter(context);
  const globalSources = globalResult.sources;
  const selectedIds = new Set(options.loadContentForSourceIds ?? []);
  const characterWorldbookSources = await Promise.all(mergeCharacterWorldbookSources(globalSources, {
    primary: runtimeReferences.character_primary,
    additional: runtimeReferences.character_additional,
  })
    .map(source => options.deferWorldbookContent !== true || worldbookSourceMatches(source, selectedIds)
      ? loadWorldbookSource(source, sourceOptions)
      : source));
  const mergeStartedAt = timingNow();
  const preliminarySources = [
    ...globalSources,
    characterCardSource(character, context),
    characterEmbeddedWorldbookSource(character, context, runtimeReferences.character_primary.length > 0),
    ...characterWorldbookSources,
  ].filter(Boolean);
  const mergedPreliminarySources = mergeAnalysisSources(preliminarySources);
  const nameCounts = sourceNameCounts(mergedPreliminarySources);
  const mergedSources = mergedPreliminarySources
    .map(source => classifyWorldbookSource(source, runtimeReferences, nameCounts))
    .filter(source => source.source_type !== ANALYSIS_SOURCE_TYPES.WORLDBOOK
      || source.worldbook_group !== WORLD_BOOK_RUNTIME_GROUPS.CHAT);
  reportTiming(sourceOptions, 'merge', mergeStartedAt, {source_count: mergedSources.length});
  return {
    sources: mergedSources,
    warning: globalResult.warning,
  };
}

export function filterSources(items = [], settings = {}) {
  const ids = new Set(selectedSourceIds(settings.selected));
  if (settings.mode === 'all') return items;
  if (settings.mode === 'none') return [];
  return items.filter(item => ids.has(item.source_id) || (settings.include_character_bound && item.character_bound));
}
