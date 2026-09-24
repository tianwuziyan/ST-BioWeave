import { redactSecrets } from './client.js'
import { tokenEstimate as estimateSourceTokens } from './worldbook.js'
import {
  normalizeExternalMemorySettings,
  normalizeRecentStoryGlobalSettings,
  normalizeRecentStorySettings,
  normalizeWorldbookSettings,
} from '../storage/schema.js'
import { normalizeStoryTime } from '../story/time.js'

const EXTERNAL_MEMORY_DEFINITIONS = Object.freeze([
  { key: 'anima', label: 'Anima' },
  { key: 'baobaoshu', label: '柏宝书' },
  { key: 'database_memory', label: '数据库记忆' },
])

// 所有进入预览的字符串都先经过已有的安全摘要处理，避免把正文中的凭据样式原样展示。
function safeText(value) {
  if (value === undefined || value === null) return ''
  return redactSecrets(String(value))
}

function safeId(value) {
  return String(value ?? '').trim()
}

const SENSITIVE_INPUT_KEY_PATTERN =
  /(?:^|_)(?:api[_-]?key|api[_-]?secret|authorization|access[_-]?token|refresh[_-]?token|bearer|password|credential|secret|token)(?:$|_)/iu

function isSensitiveInputKey(key) {
  return SENSITIVE_INPUT_KEY_PATTERN.test(String(key ?? ''))
}

// Event analysis receives a deliberately small, text-only boundary. Keep this
// sanitizer independent from storage sanitization so an input preview cannot
// accidentally carry a host response, profile, or Secret field into a prompt.
function safeStructuredValue(value, seen = new Set()) {
  if (value === undefined || value === null) return value ?? null
  if (typeof value === 'string') return safeText(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value !== 'object' || seen.has(value)) return null
  seen.add(value)
  if (Array.isArray(value))
    return value.map((item) => safeStructuredValue(item, seen))
  const result = {}
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveInputKey(key)) continue
    result[key] = safeStructuredValue(item, seen)
  }
  return result
}

function numericId(value, fallback = null) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback
}

export function normalizeEventFloorVersion(raw = {}, fallbackChatId = null) {
  const source =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const chatId = safeId(source.chat_id ?? source.chatId ?? fallbackChatId)
  return {
    chat_id: chatId || null,
    message_id: safeId(source.message_id ?? source.messageId) || null,
    floor: numericId(source.floor ?? source.floor_id),
    swipe_id: numericId(source.swipe_id ?? source.swipeId, null),
    content_hash: safeId(source.content_hash ?? source.contentHash) || null,
    message_version:
      safeId(source.message_version ?? source.messageVersion) || null,
  }
}

function normalizeEventCurrentFloor(raw, floorVersion) {
  if (typeof raw === 'string' || typeof raw === 'number') {
    return {
      floor: floorVersion.floor,
      message_id: floorVersion.message_id,
      swipe_id: floorVersion.swipe_id,
      narrative: safeContent(raw),
      role: null,
    }
  }
  const source =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const narrative = firstContent([
    source.narrative,
    source.content,
    source.text,
    source.mes,
    source.message,
  ])
  return {
    ...safeStructuredValue(source),
    floor: numericId(source.floor ?? source.floor_id, floorVersion.floor),
    message_id:
      safeId(
        source.message_id ?? source.messageId ?? floorVersion.message_id,
      ) || null,
    swipe_id: numericId(
      source.swipe_id ?? source.swipeId,
      floorVersion.swipe_id,
    ),
    narrative,
    role: safeText(source.role ?? '').trim() || null,
  }
}

function normalizeEventRecentContext(raw, fallbackStory) {
  const items = Array.isArray(raw)
    ? raw
    : Array.isArray(fallbackStory?.items)
      ? fallbackStory.items
      : []
  return items
    .map((item, index) => {
      if (typeof item === 'string' || typeof item === 'number') {
        return { floor: index, role: null, content: safeContent(item) }
      }
      const source =
        item && typeof item === 'object' && !Array.isArray(item) ? item : {}
      return {
        ...safeStructuredValue(source),
        floor: numericId(source.floor ?? source.floor_id, index),
        role: safeText(source.role ?? '').trim() || null,
        content: firstContent([
          source.content,
          source.text,
          source.mes,
          source.message,
        ]),
      }
    })
    .filter((item) => item.content || item.narrative)
}

// 外部扩展返回的对象只读取公开正文字段，不把响应对象、extra 或 Store 复制进 DTO。
function safeContent(value, seen = new Set()) {
  if (value === undefined || value === null) return ''
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return safeText(value)
  }
  if (typeof value !== 'object' || seen.has(value)) return ''
  seen.add(value)
  if (Array.isArray(value))
    return value
      .map((item) => safeContent(item, seen))
      .filter(Boolean)
      .join('\n')

  const parts = []
  for (const key of [
    'content',
    'text',
    'relativeText',
    'mes',
    'message',
    'summary',
    'description',
    'history',
  ]) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue
    const part = safeContent(value[key], seen)
    if (part) parts.push(part)
  }
  return parts.join('\n')
}

function tokenEstimate(text = '') {
  return estimateSourceTokens(safeText(text))
}

function normalizedSelections(selected) {
  return normalizeWorldbookSettings({ selected }).selected
}

function selectedChildIds(selected, sourceId, key) {
  const ids = new Set()
  for (const item of selected) {
    if (item.source_id !== sourceId || !item[key]) continue
    ids.add(safeId(item[key]))
  }
  return ids
}

function sourceType(source) {
  return String(source?.source_type ?? '').trim()
}

function firstText(values) {
  for (const value of values) {
    if (value === undefined || value === null || typeof value === 'object')
      continue
    const text = safeText(value).trim()
    if (text) return text
  }
  return ''
}

function firstContent(values) {
  for (const value of values) {
    const content = safeContent(value).trim()
    if (content) return content
  }
  return ''
}

// 读取当前 SillyTavern 的用户人物设定；参考 Anima 的公开上下文读取方式，不访问私有 Store。
export function buildUserPersonaInput(context) {
  const powerUserSettings =
    context?.powerUserSettings && typeof context.powerUserSettings === 'object'
      ? context.powerUserSettings
      : {}
  const personaObject =
    context?.user_persona && typeof context.user_persona === 'object'
      ? context.user_persona
      : context?.persona && typeof context.persona === 'object'
        ? context.persona
        : {}
  return {
    name:
      firstText([
        powerUserSettings.persona_name,
        context?.persona_name,
        personaObject.name,
        context?.name1,
        context?.user_name,
        context?.userName,
      ]) || null,
    description:
      firstContent([
        powerUserSettings.persona_description,
        context?.persona_description,
        context?.user_persona_description,
        context?.user_persona,
        context?.userPersona,
        personaObject.description,
        personaObject.persona_description,
      ]) || null,
  }
}

function buildCharacterInput(sources, selected) {
  const character = { description: '', greetings: [] }
  const seenGreetings = new Set()
  for (const source of Array.isArray(sources) ? sources : []) {
    if (sourceType(source) !== 'character_card') continue
    const sourceId = safeId(source.source_id)
    if (!sourceId) continue
    const fieldIds = selectedChildIds(selected, sourceId, 'field_key')
    for (const field of Array.isArray(source.fields) ? source.fields : []) {
      const fieldKey = safeId(field?.field_key)
      if (!fieldKey || !fieldIds.has(fieldKey)) continue
      const content = safeContent(field?.content)
      if (fieldKey === 'description') {
        if (!character.description && content) character.description = content
        continue
      }
      if (!fieldKey.startsWith('opening:') || seenGreetings.has(fieldKey))
        continue
      seenGreetings.add(fieldKey)
      character.greetings.push({
        field_key: fieldKey,
        label: safeText(field?.label || fieldKey).trim(),
        content,
        is_current: field?.is_current === true,
      })
    }
  }
  return character
}

function buildWorldbookInput(sources, settings) {
  const normalizedSettings = normalizeWorldbookSettings(settings)
  if (normalizedSettings.mode === 'none') return []
  const includeAll = normalizedSettings.mode === 'all'
  const selected = normalizedSettings.selected
  const worldbooks = []
  for (const source of Array.isArray(sources) ? sources : []) {
    if (sourceType(source) !== 'worldbook') continue
    const sourceId = safeId(source.source_id)
    if (!sourceId) continue
    const entryIds = includeAll
      ? null
      : selectedChildIds(selected, sourceId, 'entry_id')
    const entries = []
    for (const entry of Array.isArray(source.entries) ? source.entries : []) {
      const entryId = safeId(entry?.entry_id)
      if (!entryId || (!includeAll && !entryIds.has(entryId))) continue
      const content = safeContent(entry?.content)
      entries.push({
        entry_id: entryId,
        label: safeText(entry?.label || entryId).trim(),
        content,
        token_estimate: tokenEstimate(content),
      })
    }
    if (!entries.length) continue
    worldbooks.push({
      source_id: sourceId,
      name: safeText(source.label || source.name || sourceId).trim(),
      entries,
    })
  }
  return worldbooks
}

function numericFloor(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback
}

function messageContent(message, swipeIdOverride = undefined) {
  if (typeof message === 'string' || typeof message === 'number')
    return safeContent(message)
  if (!message || typeof message !== 'object') return ''
  const swipeId = Number.isInteger(swipeIdOverride)
    ? swipeIdOverride
    : Number.isInteger(message.swipe_id)
      ? message.swipe_id
      : 0
  const swipes =
    Array.isArray(message.swipes) ||
    (message.swipes && typeof message.swipes === 'object')
      ? message.swipes
      : null
  if (swipes && swipes[swipeId] !== undefined) {
    const swipeText = safeContent(swipes[swipeId])
    if (swipeText) return swipeText
  }
  return safeContent(message.mes ?? message.content ?? message.message ?? '')
}

function messageRole(message) {
  const explicitRole = String(message?.role ?? '')
    .trim()
    .toLowerCase()
  if (['user', 'assistant', 'system'].includes(explicitRole))
    return explicitRole
  if (message?.is_system === true) return 'system'
  if (message?.is_user === true) return 'user'
  return 'assistant'
}

function messageFloor(message, index) {
  const candidates = [
    message?.floor,
    message?.floor_id,
    message?.floorIndex,
    message?.index,
  ]
  for (const candidate of candidates) {
    const parsed = Number(candidate)
    if (Number.isFinite(parsed)) return Math.round(parsed)
  }
  return index
}

// Recent Story and the Event target use the same per-floor processing
// contract. The active swipe is resolved before regex is applied, and the
// caller may still process a target when Recent Story reading is disabled.
export function processNarrativeFloor({
  message = null,
  index = 0,
  floor = undefined,
  messageId = undefined,
  swipeId = undefined,
  role = undefined,
  settings = {},
} = {}) {
  const normalized = normalizeRecentStorySettings(settings)
  const fallbackFloor = messageFloor(message, index)
  const resolvedFloor =
    floor === undefined || floor === null
      ? fallbackFloor
      : numericFloor(floor, fallbackFloor)
  const resolvedRole = role ?? messageRole(message)
  const resolvedSwipeId = Number.isInteger(swipeId)
    ? swipeId
    : Number.isInteger(message?.swipe_id)
      ? message.swipe_id
      : null
  const originalContent = messageContent(message, resolvedSwipeId)
  const shouldApplyRegex =
    resolvedFloor !== 0 &&
    (resolvedRole !== 'user' || normalized.regex_user_enabled)
  const content = shouldApplyRegex
    ? applyRecentStoryRegex(originalContent, normalized.regex_rules)
    : originalContent
  if (!content.trim()) return null
  return {
    floor: resolvedFloor,
    message_id:
      safeId(
        messageId ?? message?.message_id ?? message?.messageId ?? message?.id,
      ) || null,
    swipe_id: resolvedSwipeId,
    role: resolvedRole,
    content,
  }
}

function parseRecentStoryRegex(pattern) {
  const text = String(pattern ?? '').trim()
  if (!text) return null
  let source = text
  let flags = 'g'
  if (text.startsWith('/')) {
    let closingSlash = -1
    for (let index = text.length - 1; index > 0; index -= 1) {
      if (text[index] !== '/') continue
      let backslashCount = 0
      for (
        let cursor = index - 1;
        cursor >= 0 && text[cursor] === '\\';
        cursor -= 1
      )
        backslashCount += 1
      if (backslashCount % 2 === 0) {
        closingSlash = index
        break
      }
    }
    if (closingSlash > 0) {
      source = text.slice(1, closingSlash)
      flags = text.slice(closingSlash + 1)
    }
  }
  try {
    // 参照 Anima 的规则语义，清洗和提取默认处理全部匹配结果。
    const normalizedFlags = flags.includes('g') ? flags : `${flags}g`
    const regex = new RegExp(source, normalizedFlags)
    return { regex, global: regex.global }
  } catch {
    return null
  }
}

function extractRecentStoryMatches(content, regex) {
  return [...content.matchAll(regex)].flatMap((match) => {
    if (match.length === 1) return [match[0].trim()]
    return match
      .slice(1)
      .map((value) => String(value ?? '').trim())
      .filter(Boolean)
  })
}

// 最近剧情先按配置顺序完成清洗，再让所有提取规则独立读取清洗后的原文。
export function applyRecentStoryRegex(content = '', rules = []) {
  let cleanedContent = String(content ?? '')
  const normalizedRules = normalizeRecentStorySettings({
    regex_rules: rules,
  }).regex_rules
  const activeRules = normalizedRules.filter(
    (rule) => rule.enabled !== false && rule.pattern,
  )
  if (!activeRules.length) return cleanedContent
  const extractRegexes = []
  for (const rule of activeRules) {
    const parsed = parseRecentStoryRegex(rule.pattern)
    if (!parsed) continue
    if (rule.type !== 'exclude') {
      extractRegexes.push(parsed.regex)
      continue
    }
    try {
      cleanedContent = cleanedContent.replace(parsed.regex, '')
    } catch {
      // 单条清洗规则异常时保留当前正文，避免中断本次分析。
    }
  }
  if (!extractRegexes.length) return cleanedContent.trim()

  const extractedBlocks = []
  for (const regex of extractRegexes) {
    try {
      extractedBlocks.push(...extractRecentStoryMatches(cleanedContent, regex))
    } catch {
      // 单条提取规则异常时跳过当前规则，继续处理其它规则。
    }
  }
  return extractedBlocks.join('\n')
}

// 全局规则不携带读取开关；合并时保留当前 Chat 的读取楼数和用户楼行为。
export function mergeRecentStorySettings(
  globalSettings = {},
  characterSettings = {},
) {
  const global = normalizeRecentStoryGlobalSettings(globalSettings)
  const character = normalizeRecentStorySettings(characterSettings)
  return {
    ...character,
    regex_rules: [...global.regex_rules, ...character.regex_rules],
  }
}

// 最近剧情只读取当前 Chat 最后 N 条消息，并保留消息自带的真实 floor；缺失时才使用数组位置。
export function collectRecentStory({
  context = null,
  settings = {},
  items = null,
  upperBoundIndex = null,
} = {}) {
  const normalized = normalizeRecentStorySettings(settings)
  if (!normalized.enabled) {
    return {
      enabled: false,
      floor_count: normalized.floor_count,
      floor_start: null,
      floor_end: null,
      items: [],
    }
  }

  const providedItems = Array.isArray(items)
    ? items.filter((item) => {
        if (!Number.isInteger(upperBoundIndex) || upperBoundIndex < 0)
          return true
        const contextIndex = Array.isArray(context?.chat)
          ? context.chat.indexOf(item)
          : -1
        return contextIndex < 0 || contextIndex <= upperBoundIndex
      })
    : null
  const boundedChat = Array.isArray(context?.chat)
    ? context.chat.slice(
        0,
        Number.isInteger(upperBoundIndex) && upperBoundIndex >= 0
          ? upperBoundIndex + 1
          : undefined,
      )
    : null
  const rawItems = providedItems
    ? providedItems.slice(-normalized.floor_count)
    : boundedChat
      ? boundedChat.slice(-normalized.floor_count)
      : []
  const storyItems = rawItems
    .map((message, offset) => {
      const contextIndex = Array.isArray(context?.chat)
        ? context.chat.indexOf(message)
        : -1
      const providedIndex = providedItems ? providedItems.indexOf(message) : -1
      let originalIndex = providedIndex >= 0 ? providedIndex : offset
      if (contextIndex >= 0) originalIndex = contextIndex
      else if (!providedItems && Array.isArray(context?.chat)) {
        originalIndex =
          Math.max(0, context.chat.length - rawItems.length) + offset
      }
      const floor = messageFloor(message, originalIndex)
      const role = messageRole(message)
      return processNarrativeFloor({
        message,
        index: originalIndex,
        floor,
        messageId: message?.message_id ?? message?.messageId ?? message?.id,
        swipeId: Number.isInteger(message?.swipe_id)
          ? message.swipe_id
          : undefined,
        role,
        settings: normalized,
      })
    })
    .filter(Boolean)
  const floorStart = storyItems.length ? storyItems[0].floor : null
  const floorEnd = storyItems.length ? storyItems.at(-1).floor : null
  return {
    enabled: true,
    floor_count: normalized.floor_count,
    floor_start: floorStart,
    floor_end: floorEnd,
    items: storyItems,
  }
}

function providerItems(provider) {
  if (!provider || typeof provider !== 'object') return []
  if (Array.isArray(provider.items)) return provider.items
  const content = safeContent(provider.content)
  return content ? [{ label: provider.label, content }] : []
}

function buildExternalMemoryInput(settings, providers) {
  const normalized = normalizeExternalMemorySettings(settings)
  const providerByKey = new Map(
    (Array.isArray(providers) ? providers : [])
      .filter((provider) => provider && typeof provider === 'object')
      .map((provider) => [safeId(provider.key), provider]),
  )
  return EXTERNAL_MEMORY_DEFINITIONS.map((definition) => {
    const provider = providerByKey.get(definition.key) ?? {}
    const enabled = normalized[definition.key] === true
    const available = provider.available === true
    const providerStatus = safeText(provider.status || '').trim()
    const readableProvider =
      enabled &&
      available &&
      provider.content_available === true &&
      !/失败|error|failed/iu.test(providerStatus)
    const rawItems = readableProvider ? providerItems(provider) : []
    const items = rawItems
      .map((item, index) => {
        const content = safeContent(
          item?.content ?? item?.text ?? item?.message ?? item,
        )
        if (!content) return null
        return {
          label: safeText(
            item?.label ?? item?.name ?? `${definition.label}内容 ${index + 1}`,
          ).trim(),
          content,
        }
      })
      .filter(Boolean)
    const hasContent = items.length > 0
    const readStatus = !enabled
      ? 'disabled'
      : !available
        ? 'unavailable'
        : /失败/.test(providerStatus)
          ? 'error'
          : hasContent
            ? 'success'
            : 'empty'
    const status =
      readStatus === 'disabled'
        ? '未启用'
        : readStatus === 'unavailable'
          ? '未检测到'
          : readStatus === 'error'
            ? `读取失败${providerStatus ? ` · ${providerStatus}` : ''}`
            : readStatus === 'success'
              ? `读取成功${providerStatus ? ` · ${providerStatus}` : ''}`
              : `读取成功（当前无内容）${providerStatus ? ` · ${providerStatus}` : ''}`
    return {
      key: definition.key,
      label: definition.label,
      enabled,
      available,
      read_status: readStatus,
      status,
      content_available: hasContent,
      items,
    }
  })
}

export function estimateAnalysisTokens(
  input = {},
  { includePersona = true } = {},
) {
  let total =
    (includePersona ? tokenEstimate(input?.persona?.description) : 0) +
    tokenEstimate(input?.character?.description)
  for (const greeting of input?.character?.greetings ?? [])
    total += tokenEstimate(greeting?.content)
  for (const worldbook of input?.worldbooks ?? []) {
    for (const entry of worldbook?.entries ?? [])
      total += tokenEstimate(entry?.content)
  }
  for (const item of input?.recent_story?.items ?? [])
    total += tokenEstimate(item?.content)
  for (const provider of input?.external_memory ?? []) {
    for (const item of provider?.items ?? [])
      total += tokenEstimate(item?.content)
  }
  return total
}

export function buildAnalysisInput({
  sources = [],
  selected = undefined,
  context = null,
  chatId = undefined,
  chatSettings = {},
  recentStory = undefined,
  globalRecentStory = undefined,
  recentStoryItems = null,
  externalMemory = undefined,
  externalMemoryProviders = [],
  includePersonaInTokenEstimate = false,
  upperBoundIndex = null,
} = {}) {
  const worldbookSettings = normalizeWorldbookSettings({
    ...(chatSettings?.worldbooks ?? {}),
    selected: selected ?? chatSettings?.worldbooks?.selected ?? [],
  })
  const normalizedSelected = worldbookSettings.selected
  const character = buildCharacterInput(sources, normalizedSelected)
  const worldbooks = buildWorldbookInput(sources, worldbookSettings)
  const recentSettings = mergeRecentStorySettings(
    globalRecentStory ?? {},
    recentStory ?? chatSettings?.recent_story ?? {},
  )
  const collectedRecentStory = collectRecentStory({
    context,
    settings: recentSettings,
    items: recentStoryItems ?? recentSettings?.items ?? null,
    upperBoundIndex,
  })
  const recent_story = collectedRecentStory
  const external_memory = buildExternalMemoryInput(
    externalMemory ?? chatSettings?.external_memory ?? {},
    externalMemoryProviders,
  )
  const persona = buildUserPersonaInput(context)
  const resolvedChatId =
    chatId !== undefined
      ? chatId
      : (context?.chatId ?? context?.chat_id ?? null)
  const meta = {
    chat_id:
      resolvedChatId === null || resolvedChatId === undefined
        ? null
        : safeId(resolvedChatId) || null,
    floor_start: recent_story.floor_start,
    floor_end: recent_story.floor_end,
    user_name:
      persona.name ||
      safeText(context?.name1 ?? context?.user_name ?? context?.userName) ||
      null,
    character_name:
      safeText(
        context?.name2 ?? context?.character_name ?? context?.characterName,
      ) || null,
  }
  const input = {
    persona,
    character,
    worldbooks,
    recent_story,
    external_memory,
    meta,
    token_estimate: 0,
  }
  input.token_estimate = estimateAnalysisTokens(input, {
    includePersona: includePersonaInTokenEstimate,
  })
  return input
}

function selectedSourceIdsForCollection(selected = []) {
  return [
    ...new Set(
      normalizedSelections(selected)
        .map((item) => safeId(item.source_id))
        .filter(Boolean),
    ),
  ]
}

function sourceListFromResult(result) {
  if (Array.isArray(result)) return result
  return Array.isArray(result?.sources) ? result.sources : []
}

// Shared host boundary for World/Event and future analyzers. The optional
// loaders are injected by Runtime/UI; all text selection and normalization
// still ends in the same synchronous buildAnalysisInput() path.
export async function collectAnalysisContext({
  sources = null,
  selected = undefined,
  context = null,
  chatId = undefined,
  chatSettings = {},
  recentStory = undefined,
  globalRecentStory = undefined,
  recentStoryItems = null,
  externalMemory = undefined,
  externalMemoryProviders = null,
  sourceLoader = null,
  sourceLoaderOptions = {},
  externalMemoryProviderLoader = null,
  includePersonaInTokenEstimate = false,
  upperBoundIndex = null,
} = {}) {
  const selectedItems = selected ?? chatSettings?.worldbooks?.selected ?? []
  const worldbookSettings = normalizeWorldbookSettings({
    ...(chatSettings?.worldbooks ?? {}),
    selected: selectedItems,
  })
  let collectedSources = Array.isArray(sources) ? sources : null
  if (collectedSources === null && typeof sourceLoader === 'function') {
    const sourceIds = selectedSourceIdsForCollection(selectedItems)
    const loadAllWorldbookContent = worldbookSettings.mode === 'all'
    if (
      loadAllWorldbookContent ||
      sourceIds.length > 0 ||
      sourceLoaderOptions.loadSourcesWhenNone === true
    ) {
      try {
        const result = await sourceLoader({
          ...sourceLoaderOptions,
          context,
          deferWorldbookContent: loadAllWorldbookContent
            ? false
            : (sourceLoaderOptions.deferWorldbookContent ?? true),
          loadContentForSourceIds: loadAllWorldbookContent
            ? []
            : (sourceLoaderOptions.loadContentForSourceIds ?? sourceIds),
        })
        collectedSources = sourceListFromResult(result)
      } catch {
        // Optional source failures never expose host error objects or raw
        // responses to the analyzer; unreadable sources contribute no正文。
        collectedSources = []
      }
    } else {
      collectedSources = []
    }
  }

  let collectedProviders = Array.isArray(externalMemoryProviders)
    ? externalMemoryProviders
    : null
  if (
    collectedProviders === null &&
    typeof externalMemoryProviderLoader === 'function'
  ) {
    try {
      const result = await externalMemoryProviderLoader({ context })
      collectedProviders = Array.isArray(result) ? result : []
    } catch {
      collectedProviders = []
    }
  }

  return buildAnalysisInput({
    sources: collectedSources ?? [],
    selected: selectedItems,
    context,
    chatId,
    chatSettings,
    recentStory,
    globalRecentStory,
    recentStoryItems,
    upperBoundIndex,
    externalMemory,
    externalMemoryProviders: collectedProviders ?? [],
    includePersonaInTokenEstimate,
  })
}

// Event extraction has a narrower contract than the World Model input. It is
// intentionally built from the current Floor boundary and never copies host
// context or API settings wholesale.
export function normalizeEventAnalysisInput(options = {}) {
  const source = options && typeof options === 'object' ? options : {}
  const nested =
    source.analysisInput && typeof source.analysisInput === 'object'
      ? source.analysisInput
      : source
  const requestedScope =
    source.chat_scope ??
    nested.chat_scope ??
    source.chatScope ??
    nested.chatScope
  const requestedVersion =
    source.floor_version ??
    nested.floor_version ??
    source.floorVersion ??
    nested.floorVersion ??
    {}
  const fallbackChatId =
    source.chatId ??
    source.chat_id ??
    nested.chatId ??
    nested.chat_id ??
    requestedScope?.chat_id ??
    requestedScope?.chatId ??
    null
  const floor_version = normalizeEventFloorVersion(
    requestedVersion,
    fallbackChatId,
  )
  const chat_id = floor_version.chat_id || safeId(fallbackChatId) || null
  const currentFloor = source.current_floor ??
    nested.current_floor ??
    source.currentFloor ??
    nested.currentFloor ?? {
      floor: source.floor ?? nested.floor,
      message_id: source.message_id ?? nested.message_id,
      swipe_id: source.swipe_id ?? nested.swipe_id,
      narrative:
        source.narrative ??
        nested.narrative ??
        source.content ??
        nested.content,
      role: source.role ?? nested.role,
    }
  const worldModel =
    source.world_model ??
    nested.world_model ??
    source.worldModel ??
    nested.worldModel ??
    null
  const storyTime =
    source.story_time ??
    nested.story_time ??
    source.storyTime ??
    nested.storyTime ??
    null
  const characterContext =
    source.character_context ??
    nested.character_context ??
    source.characterContext ??
    nested.characterContext ??
    nested.character ??
    null
  const existingBioWeave =
    source.existing_bioweave ??
    nested.existing_bioweave ??
    source.existingBioWeave ??
    nested.existingBioWeave ??
    null
  const characterRegistry =
    source.character_registry ??
    nested.character_registry ??
    source.characterRegistry ??
    nested.characterRegistry ??
    null
  const recentStory =
    source.recent_story ??
    nested.recent_story ??
    source.recent_context ??
    source.recentContext ??
    nested.recentContext ??
    null
  const meta = source.meta ?? nested.meta ?? {}
  const tokenEstimate = Number(source.token_estimate ?? nested.token_estimate)
  const identityContext =
    source.identity_context ??
    nested.identity_context ??
    projectEventIdentityContext(characterRegistry)
  const individualEvidence =
    source.individual_evidence ??
    nested.individual_evidence ??
    projectEventIndividualEvidence(characterContext, {
      character: source.character ?? nested.character,
      persona: source.persona ?? nested.persona,
      worldbooks: source.worldbooks ?? nested.worldbooks,
      externalMemory: source.external_memory ?? nested.external_memory,
      meta,
      chatId: chat_id,
      floorVersion: floor_version,
    })
  const existingEvents =
    source.existing_events ??
    nested.existing_events ??
    projectEventExistingEvents(existingBioWeave, source, nested)
  const recentStoryItems = normalizeEventRecentContext(recentStory, nested.recent_story)
  const normalizedRecentStory = {
    ...(recentStory && typeof recentStory === 'object' && !Array.isArray(recentStory)
      ? safeStructuredValue(recentStory)
      : {}),
    items: recentStoryItems,
  }

  return {
    chat_scope: { chat_id },
    floor_version,
    current_floor: normalizeEventCurrentFloor(currentFloor, floor_version),
    recent_story: normalizedRecentStory,
    meta: safeStructuredValue(meta),
    token_estimate: Number.isFinite(tokenEstimate) ? tokenEstimate : 0,
    world_model: safeStructuredValue(worldModel),
    story_time: safeStructuredValue(normalizeStoryTime(storyTime)),
    identity_context: safeStructuredValue(identityContext),
    individual_evidence: safeStructuredValue(individualEvidence),
    existing_events: safeStructuredValue(existingEvents),
  }
}

function projectEventIdentityContext(registry) {
  const entities = registry && typeof registry === 'object' && !Array.isArray(registry)
    ? registry.entities
    : null
  const canonicalCandidates = Object.entries(
    entities && typeof entities === 'object' && !Array.isArray(entities) ? entities : {},
  )
    .map(([fallbackId, rawEntity]) => {
      const entity = rawEntity && typeof rawEntity === 'object' && !Array.isArray(rawEntity)
        ? rawEntity
        : {}
      const characterId = safeText(entity.character_id ?? fallbackId).trim()
      if (!characterId) return null
      return {
        character_id: characterId,
        display_name: safeText(entity.display_name).trim() || null,
        aliases: Array.isArray(entity.aliases)
          ? entity.aliases.map(alias => safeText(alias).trim()).filter(Boolean)
          : [],
      }
    })
    .filter(Boolean)
  return {canonical_candidates: canonicalCandidates}
}

const STABLE_BIOLOGICAL_EVIDENCE_KINDS = Object.freeze([
  'biological_sex',
  'species',
  'biological_type',
  'stable_physiology',
  'explicit_capability',
  'other_stable_biological',
])

function classifyStableBiologicalEvidence(text) {
  const value = safeText(text).trim()
  if (!value) return null
  if (/(?:生理性别|biological\s+sex|女性|男性|雌性|雄性|female|male)/iu.test(value))
    return 'biological_sex'
  if (/(?:biological[_\s-]?type|生物类型|生殖类型)/iu.test(value))
    return 'biological_type'
  if (/(?:物种|species|种族|human|人类|nonhuman|非人类)/iu.test(value))
    return 'species'
  if (/(?:can_[a-z_]+|明确能力|生殖能力|可承载|可导致受孕|可被受精|可产生精子|可产生卵子|capability)/iu.test(value))
    return 'explicit_capability'
  if (/(?:生理|physiology|解剖|anatomy|身体结构|reproductive|生殖)/iu.test(value))
    return 'stable_physiology'
  if (/(?:稳定|先天|发育|妊娠史|曾经怀孕|pregnan|fertil)/iu.test(value))
    return 'other_stable_biological'
  return null
}

function projectStableBiologicalEvidence(text) {
  const parts = safeText(text)
    .split(/(?<=[。！？!?，,;；\n])\s*/u)
    .map(item => item.trim())
    .filter(Boolean)
  return parts
    .map(item => {
      const kind = classifyStableBiologicalEvidence(item)
      return kind ? {kind, text: item} : null
    })
    .filter(Boolean)
}

function normalizeEvidenceItems(items) {
  return (Array.isArray(items) ? items : [])
    .map(item => {
      const text = safeText(
        item && typeof item === 'object' && !Array.isArray(item)
          ? item.text ?? item.content
          : item,
      ).trim()
      if (!text) return null
      const requestedKind = safeText(item?.kind).trim()
      const kind = STABLE_BIOLOGICAL_EVIDENCE_KINDS.includes(requestedKind)
        ? requestedKind
        : classifyStableBiologicalEvidence(text)
      return kind ? {kind, text} : null
    })
    .filter(Boolean)
}

function eventEvidenceProvenance(sourceKind, sourceId, itemId, options) {
  return {
    source_kind: sourceKind,
    source_id: safeText(sourceId).trim() || null,
    item_id: safeText(itemId).trim() || null,
    chat_id: safeId(options?.chatId) || null,
    floor_version: safeStructuredValue(options?.floorVersion ?? null),
  }
}

function projectSourceEvidence({
  subjectKind,
  characterId = null,
  displayName = null,
  identityHint = null,
  sourceKind,
  sourceId = null,
  itemId = null,
  text,
  options,
}) {
  const stableBiologicalEvidence = projectStableBiologicalEvidence(text)
  if (!stableBiologicalEvidence.length) return null
  return {
    character_id: safeText(characterId).trim() || null,
    display_name: safeText(displayName).trim() || null,
    subject_kind: subjectKind,
    identity_hint: safeText(identityHint).trim() || null,
    species: null,
    biological_type: null,
    capabilities: {},
    evidence: [],
    stable_biological_evidence: stableBiologicalEvidence,
    provenance: eventEvidenceProvenance(sourceKind, sourceId, itemId, options),
  }
}

function explicitSubjectBinding(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidates = [
    value.character_id,
    value.subject_character_id,
    value.target_character_id,
    value.subject_id,
    value.character?.character_id,
    value.subject?.character_id,
  ]
  return candidates.map(item => safeText(item).trim()).find(Boolean) || null
}

function projectBoundSourceItems(worldbooks, externalMemory, options) {
  const projected = []
  for (const worldbook of Array.isArray(worldbooks) ? worldbooks : []) {
    const sourceId = safeId(worldbook?.source_id)
    for (const entry of Array.isArray(worldbook?.entries) ? worldbook.entries : []) {
      const characterId = explicitSubjectBinding(entry)
      if (!characterId) continue
      const item = projectSourceEvidence({
        subjectKind: 'canonical_character',
        characterId,
        identityHint: characterId,
        sourceKind: 'worldbook',
        sourceId,
        itemId: entry?.entry_id,
        text: entry?.content,
        options,
      })
      if (item) projected.push(item)
    }
  }
  for (const provider of Array.isArray(externalMemory) ? externalMemory : []) {
    for (const item of Array.isArray(provider?.items) ? provider.items : []) {
      const characterId = explicitSubjectBinding(item)
      if (!characterId) continue
      const projectedItem = projectSourceEvidence({
        subjectKind: 'canonical_character',
        characterId,
        identityHint: characterId,
        sourceKind: 'external_memory',
        sourceId: provider?.key,
        itemId: item?.item_id ?? item?.id,
        text: item?.content ?? item?.text,
        options,
      })
      if (projectedItem) projected.push(projectedItem)
    }
  }
  return projected
}

function projectEventIndividualEvidence(characterContext, options = {}) {
  const value = characterContext && typeof characterContext === 'object' && !Array.isArray(characterContext)
    ? characterContext
    : {}
  const profiles = value.profiles && typeof value.profiles === 'object' && !Array.isArray(value.profiles)
    ? value.profiles
    : {}
  const projectedProfiles = Object.entries(profiles)
    .map(([fallbackId, rawProfile]) => {
      const profile = rawProfile && typeof rawProfile === 'object' && !Array.isArray(rawProfile)
        ? rawProfile
        : {}
      const characterId = safeText(profile.character_id ?? fallbackId).trim()
      if (!characterId) return null
      const capabilities = profile.reproductive_capabilities ?? profile.reproductive_capabilities_used
      return {
        character_id: characterId,
        subject_kind: 'canonical_character',
        identity_hint: safeText(profile.display_name).trim() || characterId,
        display_name: safeText(profile.display_name).trim() || null,
        species: safeText(profile.species).trim() || null,
        biological_type: safeText(profile.biological_type).trim() || null,
        capabilities: capabilities && typeof capabilities === 'object' && !Array.isArray(capabilities)
          ? safeStructuredValue(capabilities)
          : {},
        evidence: Array.isArray(profile.evidence) ? safeStructuredValue(profile.evidence) : [],
        stable_biological_evidence: normalizeEvidenceItems(profile.stable_biological_evidence),
        provenance: eventEvidenceProvenance(
          'existing_profile',
          profile.source_id,
          null,
          options,
        ),
      }
    })
    .filter(Boolean)
  const character = value.character_card && typeof value.character_card === 'object'
    ? value.character_card
    : options.character
  const currentCharacter = safeText(
    value.current_character ?? value.currentCharacter ?? options.meta?.character_name,
  ).trim()
  const persona = options.persona && typeof options.persona === 'object'
    ? options.persona
    : null
  const projectedSources = []
  const characterEvidence = projectSourceEvidence({
    subjectKind: 'current_character',
    displayName: currentCharacter,
    identityHint: currentCharacter,
    sourceKind: 'character_card',
    text: character?.description,
    options,
  })
  if (characterEvidence) projectedSources.push(characterEvidence)
  const personaEvidence = projectSourceEvidence({
    subjectKind: 'persona',
    displayName: persona?.name ?? options.meta?.user_name,
    identityHint: persona?.name ?? options.meta?.user_name,
    sourceKind: 'persona',
    text: persona?.description,
    options,
  })
  if (personaEvidence) projectedSources.push(personaEvidence)
  return [
    ...projectedProfiles,
    ...projectedSources,
    ...projectBoundSourceItems(options.worldbooks, options.externalMemory, options),
  ]
}

function projectEventExistingEvents(existingBioWeave, source, nested) {
  const explicit = source.existing_events ?? nested.existing_events
  const events = explicit ?? existingBioWeave?.events
  return Array.isArray(events) ? safeStructuredValue(events) : []
}

// Collection-facing Event input builder. Prompt builders only call the pure
// normalizeEventAnalysisInput() above and therefore never read host context.
export function buildEventAnalysisInput(options = {}) {
  const source = options && typeof options === 'object' ? options : {}
  const nested =
    source.analysisInput && typeof source.analysisInput === 'object'
      ? source.analysisInput
      : source
  const shouldCollectSharedInput =
    Array.isArray(source.sources) ||
    source.chatSettings !== undefined ||
    source.recentStory !== undefined ||
    source.globalRecentStory !== undefined ||
    source.externalMemory !== undefined ||
    source.selected !== undefined
  const shared = shouldCollectSharedInput
    ? buildAnalysisInput({
        ...source,
        includePersonaInTokenEstimate:
          source.includePersonaInTokenEstimate ?? true,
      })
    : null
  const normalized = normalizeEventAnalysisInput({
    ...(shared ?? {}),
    ...source,
    recent_story:
      source.recent_story ??
      nested.recent_story ??
      source.recent_context ??
      source.recentContext ??
      nested.recentContext ??
      shared?.recent_story,
    meta: source.meta ?? nested.meta ?? shared?.meta,
    token_estimate:
      source.token_estimate ?? nested.token_estimate ?? shared?.token_estimate,
  })
  // Runtime keeps this wide DTO for deterministic identity resolution and
  // derived-state orchestration. Prompt builders immediately normalize it to
  // the narrow Event semantic projection above, so these host/raw fields are
  // never serialized into Event messages.
  return {
    ...normalized,
    recent_context: normalizeEventRecentContext(
      source.recent_context ??
        nested.recent_context ??
        source.recentContext ??
        nested.recentContext,
      nested.recent_story,
    ),
    character: safeStructuredValue(
      source.character ?? nested.character ?? shared?.character,
    ),
    persona: safeStructuredValue(
      source.persona ??
        nested.persona ??
        shared?.persona ??
        (source.context ? buildUserPersonaInput(source.context) : null),
    ),
    worldbooks: safeStructuredValue(
      source.worldbooks ?? nested.worldbooks ?? shared?.worldbooks ?? [],
    ),
    external_memory: safeStructuredValue(
      source.external_memory ??
        nested.external_memory ??
        shared?.external_memory ??
        [],
    ),
    character_context: safeStructuredValue(
      source.character_context ??
        nested.character_context ??
        source.characterContext ??
        nested.characterContext ??
        nested.character ??
        null,
    ),
    character_registry: safeStructuredValue(
      source.character_registry ??
        nested.character_registry ??
        source.characterRegistry ??
        nested.characterRegistry ??
        {schema_version: 1, entities: {}},
    ),
    existing_bioweave: safeStructuredValue(
      source.existing_bioweave ??
        nested.existing_bioweave ??
        source.existingBioWeave ??
        nested.existingBioWeave ??
        null,
    ),
  }
}

export const createAnalysisInput = buildAnalysisInput
export const buildRecentStoryInput = collectRecentStory
export { EXTERNAL_MEMORY_DEFINITIONS, tokenEstimate }
