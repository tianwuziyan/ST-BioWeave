/**
 * Canonical Prompt Context presentation port.
 *
 * This module is deliberately pure: it accepts already-collected DTOs and
 * returns readable blocks/messages. It must not read Host, Storage, Floor or
 * API configuration.
 */
const text = value =>
  String(value ?? '')
    .replace(/\u0000/g, '')
    .trim()
const namesOrDefault = names => ({ userName: text(names?.userName) || '用户', characterName: text(names?.characterName) || '角色' })

const PROMPT_CONTEXT_KINDS = Object.freeze([
  'character_card',
  'character_profile',
  'worldbooks',
  'plugin_world_model',
  'event_reference',
  'other_reference_data',
  'external_memory',
  'recent_story',
  'target_floor',
  'triggered_signals',
  'world_model_supplement',
  'world_species_archive_exclusions',
  'projection_generation_input',
  'event_identity_registry',
  'event_character_profiles',
  'event_existing_events',
  'pregnancy_knowledge',
])
const PROMPT_CONTEXT_VARIANTS = Object.freeze(['world', 'event', 'storyline_design', 'storyline_judge', 'comparison', 'generation'])
const INTERNAL_ID_KEYS = new Set([
  'subject_id',
  'character_id',
  'cycle_id',
  'pregnancy_id',
  'event_id',
  'tracking_window_id',
  'aggregation_id',
  'source_id',
  'entry_id',
  'worldbook_id',
  'file_id',
  'world_model_rule_refs',
])
const PROMPT_CONTEXT_LABELS = Object.freeze({
  schema_version: '架构版本',
  display_name: '显示名称',
  aliases: '昵称',
  known_characters: '已知人物',
  type: '事件类型',
  species: '物种',
  name: '名称',
  description: '描述',
  biological_types: '生理类型',
  biological_type: '生物类型',
  biological_context: '生物背景',
  role_identifier: '角色标识',
  subject_kind: '证据对象',
  identity_hint: '身份提示',
  profile_evidence: '资料证据',
  stable_biological_evidence: '稳定人物生理证据（不是当前 Floor Event）',
  evidence_source: '证据来源',
  canonical_candidates: '候选角色',
  role_profiles: '角色资料',
  capabilities: '生理能力',
  reproductive_capabilities: '已知生殖能力',
  reproductive_capabilities_used: '使用的生殖能力',
  reproduction_rules: '生殖规则',
  special_rules: '特殊规则',
  rules: '规则',
  reproductive_mechanisms: '生殖机制',
  key: '机制键',
  label: '标签',
  pathway: '作用路径',
  carrying_compatibility: '承载兼容性',
  tracking_window_horizon: '观察窗口上限',
  max_story_days: '最大剧情天数',
  can_produce_sperm: '可产生精子',
  can_produce_ova: '可产生卵子',
  can_be_fertilized: '可受精',
  can_fertilize: '可使他者受精',
  can_cause_pregnancy: '可导致妊娠',
  can_carry_pregnancy: '可承载妊娠',
  fertilization: '受精规则',
  pregnancy_or_carrying: '妊娠或承载规则',
  cycle: '生殖周期规则',
  ovulation: '排卵规则',
  gestation: '妊娠期规则',
  labor: '分娩规则',
  lifecycle: '生命周期',
  maturation: '性成熟',
  aging: '衰老过程',
  medical_context: '医疗背景',
  childbirth_difficulty: '分娩难度',
  care_level: '照护水平',
  exceptions: '特殊例外',
  statement: '说明',
  applies_to: '适用范围',
  unknowns: '未知事项',
  projection_rules: '推演规则',
  development_concern_key: '发展关注点',
  development_kind: '发展类型',
  trigger: '触发条件',
  requirements: '要求',
  realization: '实现条件',
  contradiction: '矛盾条件',
  expiration: '失效条件',
  evidence: '证据',
  setting: '设定',
  content: '正文内容',
  title: '标题',
  world_model: '世界观模型',
  worldbooks: '世界书',
  entries: '条目',
  story_time: '故事时间',
  time: '时间',
  display: '显示时间',
  normalized: '标准化时间',
  day_index: '连续日索引',
  precision: '时间精度',
  confidence: '置信度',
  location: '地点',
  participants: '涉及人物',
  subject_display_name: '观察对象',
  observation: '观察事实',
  source_evidence: '事实证据',
  text: '内容',
  body_site: '身体部位',
  laterality: '方向',
  continuation: '持续中',
  health_role: '健康角色',
  schema: '架构',
  mechanism: '机制',
  projection_rule: '推演规则',
  medical: '医疗',
  health: '健康',
  status: '状态',
  kind: '类型',
  request: '请求',
  mode: '模式',
  repair: '格式修复',
  reason_code: '原因代码',
  existing_reference: '现有世界观参考',
  archived_species_exclusions: '已归档物种排除项',
  existing_unknowns: '现有未知事项',
  coverage_targets: '覆盖检查目标',
  identity_review_subjects: '身份复核对象',
  target_id: '目标编号',
  unknown_id: '未知事项编号',
  subject_id: '复核编号',
  expected_scope: '预期范围',
  expected_resolution: '预期处理方式',
  scope: '范围',
  field: '字段',
  cardinality: '基数',
  known_biological_types: '已知生理类型',
  eligible_decision: '已通过资格判定的输入',
  rule: '推演规则',
  subject_state: '目标人物当前状态',
  source_candidates: '来源候选',
  current_story_time: '当前故事时间',
  story_context: '剧情上下文',
  projection_rule_id: '推演规则编号',
  source_event_ids: '来源事件编号',
  evidence_refs: '证据引用',
  mechanism_key: '机制键',
  value: '内容',
  event_id: '事件编号',
  continuation_of_event_id: '延续事件编号',
  continuation_update: '延续更新',
  physical_effect: '身体影响',
  pregnancy_relevance: '妊娠相关性',
  relevant: '相关',
  possible_conception: '可能受孕',
  reproductive_mechanism: '生殖机制',
  gestational_substance_intake: '妊娠相关物质摄入',
})
const stripIds = value => {
  if (Array.isArray(value)) return value.map(stripIds)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !INTERNAL_ID_KEYS.has(key) && !/(?:^|_)id$/i.test(key))
      .map(([key, item]) => [key, stripIds(item)]),
  )
}
const stripProfileEvidence = value => {
  if (Array.isArray(value)) return value.map(stripProfileEvidence)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'evidence')
      .map(([key, item]) => [key, stripProfileEvidence(item)]),
  )
}
const renderIndent = level => '  '.repeat(level)
const renderScalar = value => {
  if (value === null || value === undefined) return '未知'
  if (typeof value === 'string') return text(value) || '（空）'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'number') return String(value)
  return '（不支持的值）'
}
const renderValue = (value, level = 0, seen = new Set(), listItem = false) => {
  if (value === null || value === undefined || typeof value !== 'object') return renderScalar(value)
  if (seen.has(value)) return `${renderIndent(level)}（重复引用已省略）`
  seen.add(value)
  let lines
  if (Array.isArray(value)) {
    const items = value.filter(hasRenderableValue)
    lines = items.flatMap(item => {
      if (item && typeof item === 'object') return renderValue(item, level, seen, true).split('\n')
      return [`${renderIndent(level)}- ${renderScalar(item)}`]
    })
  } else {
    const entries = Object.entries(value).filter(([, item]) => hasRenderableValue(item))
    lines = entries.flatMap(([key, item], index) => {
      const label = PROMPT_CONTEXT_LABELS[key] ?? key
      const propertyLevel = listItem && index > 0 ? level + 1 : level
      const prefix = listItem && index === 0 ? '- ' : ''
      if (item && typeof item === 'object') {
        const children = renderValue(item, propertyLevel + 1, seen).split('\n')
        return [`${renderIndent(propertyLevel)}${prefix}${label}:`, ...children]
      }
      return [`${renderIndent(propertyLevel)}${prefix}${label}: ${renderScalar(item)}`]
    })
  }
  seen.delete(value)
  return lines.join('\n')
}
function hasRenderableValue(value) {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return Boolean(text(value))
  if (Array.isArray(value)) return value.some(hasRenderableValue)
  if (typeof value === 'object') return Object.values(value).some(hasRenderableValue)
  return true
}
const hasValue = hasRenderableValue
const expand = (value, names) =>
  text(value)
    .replace(/\{\{user\}\}|<user>/gi, namesOrDefault(names).userName)
    .replace(/\{\{char\}\}|<char>/gi, namesOrDefault(names).characterName)
const expandPromptValue = (value, names) => {
  if (Array.isArray(value)) return value.map(item => expandPromptValue(item, names))
  if (!value || typeof value !== 'object') return typeof value === 'string' ? expand(value, names) : value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expandPromptValue(item, names)]))
}
const EVENT_CAPABILITY_KEYS = Object.freeze([
  'can_produce_sperm',
  'can_produce_ova',
  'can_be_fertilized',
  'can_fertilize',
  'can_cause_pregnancy',
  'can_carry_pregnancy',
])
const projectProfileEvidence = (items, names) => (Array.isArray(items) ? items : [])
  .map(item => {
    const source = expandPromptValue(item, names)
    if (source && typeof source === 'object' && !Array.isArray(source)) {
      const evidenceText = source.text ?? source.content
      return evidenceText ? {kind: source.kind, text: evidenceText} : null
    }
    return source ? {text: source} : null
  })
  .filter(Boolean)

const projectEventEvidence = items => (Array.isArray(items) ? items : [])
  .map(item => ({kind: item?.kind, text: item?.text ?? item?.content}))
  .filter(hasRenderableValue)

const projectEventBiologicalContext = context => {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return null
  return {
    species: context.species,
    biological_type: context.biological_type,
    reproductive_capabilities_used: context.reproductive_capabilities_used,
    evidence: projectEventEvidence(context.evidence),
  }
}

const projectEventPregnancyRelevance = relevance => {
  if (!relevance || typeof relevance !== 'object' || Array.isArray(relevance)) return null
  const mechanism = relevance.reproductive_mechanism
  return {
    relevant: relevance.relevant,
    possible_conception: relevance.possible_conception,
    confidence: relevance.confidence,
    reproductive_mechanism: mechanism && typeof mechanism === 'object' && !Array.isArray(mechanism)
      ? {
          kind: mechanism.kind,
          label: mechanism.label,
          pathway: mechanism.pathway,
          evidence: projectEventEvidence(mechanism.evidence),
        }
      : null,
  }
}

const projectEventPhysicalEffect = effect => {
  if (!effect || typeof effect !== 'object' || Array.isArray(effect)) return null
  return {gestational_substance_intake: effect.gestational_substance_intake}
}

const eventSubjectIds = event => {
  const ids = []
  const add = value => {
    if (typeof value === 'string' && value.trim()) ids.push(value.trim())
  }
  add(event?.subject_id)
  add(event?.state_fact?.subject_id)
  for (const key of ['gestational_subject_ids', 'counterpart_ids']) {
    const values = event?.pregnancy_relevance?.[key]
    if (Array.isArray(values)) values.forEach(add)
  }
  if (Array.isArray(event?.participants)) event.participants.forEach(participant => add(participant?.character_id))
  return [...new Set(ids)]
}

const projectStorylineEvent = event => {
  const storyTime = event?.story_time && typeof event.story_time === 'object'
    ? event.story_time.display
    : null
  const participants = Array.isArray(event?.participants)
    ? event.participants.map(participant => ({
        display_name: participant?.display_name,
        species: participant?.biological_context?.species,
        biological_type: participant?.biological_context?.biological_type,
      })).filter(hasRenderableValue)
    : []
  const sourceEvidence = Array.isArray(event?.source_evidence)
    ? [...new Set(event.source_evidence.map(item => item?.text ?? item?.content).map(text).filter(Boolean))]
    : []
  const observation = event?.state_fact?.payload?.symptom ?? event?.state_fact?.payload?.fact
  const observationTexts = []
  const observationText = typeof observation === 'string'
    ? observation
    : observation && typeof observation === 'object'
      ? observation.description ?? observation.text ?? observation.content
      : null
  if (text(observationText)) observationTexts.push(text(observationText))
  return {
    type: event?.type,
    status: event?.status,
    time: storyTime,
    location: event?.location,
    participants,
    observation: [...new Set(observationTexts)],
    source_evidence: sourceEvidence,
  }
}

const projectStorylineEvents = (events, targetSubjectId) => {
  const normalizedTarget = typeof targetSubjectId === 'string' ? targetSubjectId.trim() : ''
  return events
    .filter(event => !normalizedTarget || eventSubjectIds(event).includes(normalizedTarget))
    .map(projectStorylineEvent)
    .filter(hasRenderableValue)
}

function eventReferenceProjection(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const storyTime = source.story_time && typeof source.story_time === 'object'
    ? {
        display: source.story_time.display,
        normalized: source.story_time.normalized,
        calendar_id: source.story_time.calendar_id,
        day_index: source.story_time.day_index,
        precision: source.story_time.precision,
        confidence: source.story_time.confidence,
      }
    : null
  const participants = (Array.isArray(source.participants) ? source.participants : [])
    .map(participant => ({
      display_name: participant?.display_name,
      biological_context: participant?.biological_context,
    }))
    .filter(hasRenderableValue)
  const subjectId = source.state_fact?.subject_id
  const subject = (Array.isArray(source.participants) ? source.participants : [])
    .find(participant => subjectId && participant?.character_id === subjectId)
  const evidence = (Array.isArray(source.source_evidence) ? source.source_evidence : [])
    .map(item => ({kind: item?.kind, text: item?.text}))
    .filter(hasRenderableValue)
  const payload = source.state_fact?.payload
  const observation = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload.symptom ?? payload.fact ?? null
    : null
  return {
    type: source.type,
    status: source.status,
    story_time: storyTime,
    location: source.location,
    subject_display_name: subject?.display_name,
    participants,
    observation,
    physical_effect: source.physical_effect,
    source_evidence: evidence,
  }
}
const PROMPT_CONTEXT_ALLOWED_VARIANTS = Object.freeze({
  character_card: new Set(['world']),
  character_profile: new Set(['storyline_design', 'storyline_judge', 'comparison']),
  worldbooks: new Set(['world']),
  plugin_world_model: new Set(['world', 'event', 'storyline_design', 'storyline_judge', 'comparison']),
  event_reference: new Set(['event']),
  other_reference_data: new Set(['storyline_design', 'storyline_judge', 'comparison']),
  external_memory: new Set(['world', 'event', 'storyline_design', 'storyline_judge', 'comparison']),
  recent_story: new Set(['world', 'event', 'storyline_design', 'storyline_judge', 'comparison']),
  target_floor: new Set(['event', 'comparison']),
  triggered_signals: new Set(['storyline_design', 'storyline_judge']),
  world_model_supplement: new Set(['comparison']),
  world_species_archive_exclusions: new Set(['world', 'comparison']),
  projection_generation_input: new Set(['generation']),
  event_identity_registry: new Set(['event']),
  event_character_profiles: new Set(['event']),
  event_existing_events: new Set(['event', 'storyline_design', 'storyline_judge']),
  pregnancy_knowledge: new Set(['event', 'generation']),
})

const supplementSemanticIds = value => {
  if (Array.isArray(value)) return value.map(supplementSemanticIds)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (key === 'subject_id') return ['subject_id', item]
    if (key === 'target_id') return ['target_id', item]
    if (key === 'unknown_id') return ['unknown_id', item]
    if (key === 'existing_reference') return ['existing_reference', stripIds(item)]
    if (key === 'archived_species_exclusions') return ['archived_species_exclusions', stripIds(item)]
    return [key, supplementSemanticIds(item)]
  }))
}

const projectionInputProjection = value => {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return {
    eligible_decision: stripIds(source.eligible_decision ?? {}),
    rule: stripIds(source.rule ?? {}),
    subject_state: stripIds(source.subject_state ?? {}),
    source_candidates: stripIds(source.source_candidates ?? []),
    current_story_time: stripIds(source.current_story_time ?? null),
    story_context: stripIds(source.story_context ?? []),
  }
}

export function formatPromptContextContent({ kind, value, names = {}, variant = 'world', empty = '', targetSubjectId = '' } = {}) {
  if (!PROMPT_CONTEXT_KINDS.includes(kind)) throw new TypeError('PROMPT_CONTEXT_KIND_UNSUPPORTED')
  if (!PROMPT_CONTEXT_VARIANTS.includes(variant)) throw new TypeError('PROMPT_CONTEXT_VARIANT_UNSUPPORTED')
  if (!PROMPT_CONTEXT_ALLOWED_VARIANTS[kind]?.has(variant)) throw new TypeError('PROMPT_CONTEXT_VARIANT_UNSUPPORTED')
  const n = namesOrDefault(names)
  switch (kind) {
    case 'worldbooks': {
      const entries = (Array.isArray(value) ? value : [])
        .flatMap(book => (Array.isArray(book?.entries) ? book.entries : []))
        .map(entry => ({ label: expand(entry?.label || '未命名条目', n), content: expand(entry?.content, n) }))
        .filter(item => item.content)
      return entries.map(item => `【条目：${item.label}】\n${item.content}`).join('\n\n') || empty
    }
    case 'character_card': {
      const character = value?.character && typeof value.character === 'object' ? value.character : value
      return character?.description ? `角色背景\n${expand(character.description, n)}` : empty
    }
    case 'character_profile': {
      if (!hasValue(value)) return empty
      const rendered = renderValue(stripIds(stripProfileEvidence(value)))
      return rendered || empty
    }
    case 'plugin_world_model': {
      return hasValue(value) ? renderValue(stripIds(value)) : empty
    }
    case 'event_reference':
      return hasValue(value) ? renderValue(stripIds(eventReferenceProjection(value))) : empty
    case 'event_identity_registry': {
      const candidates = Array.isArray(value?.canonical_candidates) ? value.canonical_candidates : []
      const projected = candidates.map(candidate => ({
        role_identifier: candidate?.character_id,
        display_name: candidate?.display_name,
        aliases: Array.isArray(candidate?.aliases) ? candidate.aliases : [],
      })).filter(hasRenderableValue)
      return projected.length ? renderValue({canonical_candidates: projected}) : empty
    }
    case 'event_character_profiles': {
      const profiles = Array.isArray(value) ? value : []
      const projected = profiles.map(profile => {
        const source = expandPromptValue(profile, names)
        const capabilities = source?.capabilities ?? source?.reproductive_capabilities
        const item = {
          role_identifier: source?.character_id || '未分配 canonical character_id（仅使用本次 transient subject evidence）',
          subject_kind: source?.subject_kind,
          identity_hint: source?.identity_hint,
          display_name: source?.display_name,
          species: source?.species,
          biological_type: source?.biological_type,
          reproductive_capabilities: capabilities && typeof capabilities === 'object' && !Array.isArray(capabilities)
            ? Object.fromEntries(EVENT_CAPABILITY_KEYS.map(key => [key, capabilities[key] === true || capabilities[key] === false ? capabilities[key] : null]))
            : null,
          profile_evidence: projectProfileEvidence(source?.evidence, names),
          stable_biological_evidence: projectProfileEvidence(source?.stable_biological_evidence, names),
          evidence_source: source?.provenance?.source_kind,
        }
        if (item.reproductive_capabilities && typeof item.reproductive_capabilities === 'object' && !Array.isArray(item.reproductive_capabilities)) {
          item.reproductive_capabilities = Object.fromEntries(Object.entries(item.reproductive_capabilities).map(([key, itemValue]) => [
            key,
            itemValue === true ? '是' : itemValue === false ? '否' : '未知',
          ]))
        }
        return item
      }).filter(hasRenderableValue)
      return projected.length ? renderValue({role_profiles: projected}) : empty
    }
    case 'event_existing_events':
      {
        const events = Array.isArray(value) ? value : []
        const includeIdentityReferences = variant === 'event'
        if (!includeIdentityReferences) {
          const projected = projectStorylineEvents(events, targetSubjectId)
          return projected.length ? renderValue(projected) : empty
        }
        const projected = events.map(event => {
          const storyTime = event?.story_time && typeof event.story_time === 'object'
            ? {
                display: event.story_time.display,
                normalized: event.story_time.normalized,
                day_index: event.story_time.day_index,
                precision: event.story_time.precision,
                confidence: event.story_time.confidence,
              }
            : null
          const participants = Array.isArray(event?.participants)
            ? event.participants.map(participant => ({
                display_name: participant?.display_name,
                biological_context: projectEventBiologicalContext(participant?.biological_context),
              })).filter(hasRenderableValue)
            : []
          const sourceEvidence = Array.isArray(event?.source_evidence)
            ? event.source_evidence.map(item => ({kind: item?.kind, text: item?.text})).filter(hasRenderableValue)
            : []
          return {
            ...(includeIdentityReferences ? {event_id: event?.event_id} : {}),
            type: event?.type,
            status: event?.status,
            story_time: storyTime,
            location: event?.location,
            participants,
            observation: event?.state_fact?.payload?.symptom ?? event?.state_fact?.payload?.fact ?? null,
            physical_effect: projectEventPhysicalEffect(event?.physical_effect),
            pregnancy_relevance: projectEventPregnancyRelevance(event?.pregnancy_relevance),
            source_evidence: sourceEvidence,
            ...(includeIdentityReferences ? {continuation_of_event_id: event?.continuation_of_event_id} : {}),
            continuation_update: event?.continuation_update,
          }
        }).filter(hasRenderableValue)
        return projected.length ? renderValue(projected) : empty
      }
    case 'pregnancy_knowledge': {
      const groups = Array.isArray(value) ? value : []
      const projected = groups.map(group => ({
        '怀孕人物': group?.subject?.display_name,
        '已知情人物': Array.isArray(group?.knowers) ? group.knowers.map(item => item?.display_name).filter(Boolean) : [],
        '其他人物': '默认不知道',
      })).filter(item => item['怀孕人物'] && item['已知情人物'].length)
      return projected.length ? renderValue(projected) : empty
    }
    case 'other_reference_data': {
      if (typeof value === 'string')
        return value
            .split('\n')
            .map(line => text(line))
            .filter(Boolean)
            .map(line => (line.startsWith('- ') ? line : `- ${line}`))
            .join('\n') || empty
      const entries = Array.isArray(value)
        ? value
        : Object.entries(value || {}).map(([key, content]) => ({ key, label: PROMPT_CONTEXT_LABELS[key] ?? key, content }))
      const projectItem = item => {
        if (item?.key === 'known_characters' || item?.label === '已知人物') {
          const chars = Array.isArray(item.content) ? item.content : []
          const named = chars
            .map(char => ({
              name: text(char?.display_name ?? char?.name ?? char?.character_name),
              aliases: (Array.isArray(char?.aliases) ? char.aliases : [char?.aliases]).map(text).filter(Boolean),
            }))
            .filter(char => char.name)
          return named.length && named.some(char => char.aliases.length)
            ? {已知人物: named.filter(char => char.aliases.length).map(char => ({角色名: char.name, 昵称: char.aliases.join('、')}))}
            : null
        }
        const label = text(item?.label ?? item?.name ?? item?.title)
        const content = item?.content ?? item?.value ?? item
        if (typeof content === 'object') return hasRenderableValue(content) ? {[label || '内容']: stripIds(content)} : null
        return text(content) ? {[label || '内容']: text(content)} : null
      }
      if (Array.isArray(value)) {
        const projectedEntries = entries.map(projectItem).filter(Boolean)
        return projectedEntries.length ? renderValue(projectedEntries) : empty
      }
      const projectedObject = Object.assign({}, ...entries.map(projectItem).filter(Boolean))
      return hasRenderableValue(projectedObject) ? renderValue(projectedObject) : empty
    }
    case 'external_memory': {
      if (typeof value === 'string') return text(value)
      const lines = (Array.isArray(value) ? value : []).flatMap(provider => {
        if (
          provider?.enabled !== true ||
          provider?.available !== true ||
          provider?.content_available !== true ||
          ['disabled', 'unavailable', 'error'].includes(provider?.read_status)
        )
          return []
        return (Array.isArray(provider.items) ? provider.items : [])
          .map(item => ({ label: expand(item?.label || provider?.label || '历史记录', n), content: expand(item?.content, n) }))
          .filter(item => item.content)
          .map(item => `【${item.label}】\n${item.content}`)
      })
      return lines.join('\n\n') || empty
    }
    case 'recent_story':
    case 'target_floor': {
      const items = Array.isArray(value) ? value : value ? [value] : []
      const body = items
        .map(item => expand(item?.content ?? item?.narrative ?? item, n))
        .filter(Boolean)
        .join('\n\n')
      return body || empty
    }
    case 'triggered_signals': {
      const labels = {
        fatigue: '嗜睡或疲倦',
        nausea: '恶心',
        appetite_change: '食欲变化',
        vomiting: '可能出现孕吐',
        breast_sensitivity: '乳房敏感',
        mood_change: '情绪变化',
      }
      const projected = (Array.isArray(value) ? value : [])
        .map(signal => {
          const concept = typeof signal === 'string' ? signal : (signal?.reaction_concept ?? signal?.signal)
          const evidence = Array.isArray(signal?.evidence) ? signal.evidence.map(text).filter(Boolean) : []
          return {信号: labels[text(concept)] ?? (text(concept) || '未知'), 证据: evidence}
        })
      const body = renderValue(projected)
      return body || empty
    }
    case 'world_model_supplement': {
      const projected = supplementSemanticIds(value)
      return hasValue(projected) ? renderValue(projected) : empty
    }
    case 'world_species_archive_exclusions': {
      const entries = Array.isArray(value) ? value : []
      const projected = entries.map(item => ({name: item?.name})).filter(hasRenderableValue)
      return projected.length ? renderValue(projected) : empty
    }
    case 'projection_generation_input': {
      const projected = projectionInputProjection(value)
      return hasValue(projected) ? renderValue(projected) : empty
    }
    default:
      return ''
  }
}

export function composePromptMessages({ systemTop = '', groups = [], user = '', systemBottom = '' } = {}) {
  const validRoles = new Set(['system', 'assistant', 'user'])
  const messages = []
  const add = (role, content) => {
    if (!validRoles.has(role)) throw new TypeError('PROMPT_CONTEXT_LAYOUT_INVALID')
    const value = text(content)
    if (value) messages.push({ role, content: value })
  }
  add('system', systemTop)
  for (const group of Array.isArray(groups) ? groups : []) {
    if (!group || !validRoles.has(group.role)) throw new TypeError('PROMPT_CONTEXT_LAYOUT_INVALID')
    const contents = (Array.isArray(group.blocks) ? group.blocks : [group.content]).map(text).filter(Boolean)
    add(group.role, contents.join('\n\n'))
  }
  add('user', user)
  add('system', systemBottom)
  return messages
}
