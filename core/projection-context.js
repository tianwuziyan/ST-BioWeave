import { builtInPreConfirmationBranchForConcern } from './projection-eligibility.js'

export const PROJECTION_CONTEXT_INJECTION_KEY = 'bioweave_projection_context'
export const PROJECTION_CONTEXT_POSITION = 'IN_CHAT'
export const PROJECTION_CONTEXT_DEPTH = 4
export const PROJECTION_CONTEXT_ROLE = 'SYSTEM'

function clone(value) {
  if (value === undefined || value === null || typeof value !== 'object') return value
  if (typeof structuredClone === 'function') return structuredClone(value)
  if (Array.isArray(value)) return value.map(clone)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]))
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function list(value) {
  return Array.isArray(value) ? value.slice() : []
}

const SAFE_SUBJECT_DISPLAY_NAME = '相关人物'
const BUILT_IN_DISCLAIMER = '这只是备选剧情方向，不是已确认怀孕事实。'

function subjectDisplayName(subjectId, displayNameBySubject = {}) {
  return text(displayNameBySubject?.[subjectId]) || SAFE_SUBJECT_DISPLAY_NAME
}

function promptDirection(entry) {
  const description = text(entry.description)
  const branch = builtInPreConfirmationBranchForConcern(entry.development_concern_key)
  if (!branch) return { title: '', content: description }
  return {
    title: branch.label,
    content: description.endsWith(`；${BUILT_IN_DISCLAIMER}`)
      ? description.slice(0, -`；${BUILT_IN_DISCLAIMER}`.length).trimEnd()
      : description.endsWith(BUILT_IN_DISCLAIMER)
        ? description.slice(0, -BUILT_IN_DISCLAIMER.length).trimEnd()
        : description,
  }
}

function sortViews(left, right) {
  const leftProjection = left?.projection ?? left ?? {}
  const rightProjection = right?.projection ?? right ?? {}
  const fields = [
    ['subject_id', ''],
    ['development_concern_key', ''],
    ['projection_rule_id', ''],
  ]
  for (const [field, fallback] of fields) {
    const comparison = String(leftProjection[field] ?? fallback).localeCompare(String(rightProjection[field] ?? fallback))
    if (comparison) return comparison
  }
  return String(leftProjection.created_at_floor_version?.message_id ?? '').localeCompare(
    String(rightProjection.created_at_floor_version?.message_id ?? ''),
  )
}

function normalizeAttribution(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (value.conflict === true || value.status === 'conflicted' || list(value.conflicts).length) {
    return { status: 'unresolved', conflict: true, candidates: [] }
  }
  const confirmed = list(value.confirmed)
    .filter(item => text(item?.source_character_id))
    .map(item => ({
      source_character_id: item.source_character_id,
      contribution_kind: text(item.contribution_kind) || null,
    }))
  const candidates = list(value.candidates)
    .filter(item => text(item?.source_character_id))
    .map(item => ({
      source_character_id: item.source_character_id,
      contribution_kind: text(item.contribution_kind) || null,
    }))
  return {
    status: value.unresolved === true || !confirmed.length ? 'unresolved' : 'confirmed',
    conflict: false,
    confirmed,
    candidates,
  }
}

export function buildProjectionContextDTO(views = [], { attributionBySubject = {} } = {}) {
  const seen = new Set()
  return list(views)
    .filter(view => view?.context_visible === true)
    .sort(sortViews)
    .filter(view => {
      const id = text(view?.projection_id)
      if (!id || seen.has(id)) return false
      seen.add(id)
      return true
    })
    .map(view => {
      const projection = view
      const attribution = normalizeAttribution(attributionBySubject?.[projection.subject_id])
      return {
        subject_id: projection.subject_id,
        development_kind: projection.development?.kind ?? null,
        description: projection.development?.next_signal ?? '',
        mechanism: text(projection.mechanism?.key) ? { key: projection.mechanism.key } : null,
        ...(attribution ? { attribution } : {}),
      }
    })
}

function healthGuidanceDTO(guidance = []) {
  return list(guidance)
    .filter(item => text(item?.subject_id) && text(item?.body_site) && text(item?.guidance))
    .map(item => ({
      context_type: 'health_recovery_guidance',
      subject_id: item.subject_id,
      body_site: item.body_site,
      stage: text(item.stage) || null,
      guidance: item.guidance,
    }))
    .sort(
      (left, right) =>
        String(left.subject_id).localeCompare(String(right.subject_id)) || String(left.body_site).localeCompare(String(right.body_site)),
    )
}

export function buildProjectionContextPrompt(context = []) {
  const entries = Array.isArray(context) ? context : []
  if (!entries.length) return ''
  const projectionEntries = entries.filter(entry => entry?.context_type !== 'health_recovery_guidance')
  const healthEntries = entries.filter(entry => entry?.context_type === 'health_recovery_guidance')
  const lines = []
  if (projectionEntries.length) {
    lines.push(
      'BioWeave 生物发展方向（仅供剧情参考，不是已经发生的事实）：',
      '本模块属于主动推演参考，与既有伤势及恢复状态独立处理。以下内容为各角色可能出现的身体状态。请将其纳入后续剧情推演，从备选方向中为各角色选择适合的状态，并通过日常行为、身体感受、人物互动或自然衍生的小情节逐步呈现。允许围绕这些状态设计合理情节，使其融入正文，而非仅作为背景信息。',
    )
  }
  const groupedProjections = new Map()
  for (const entry of projectionEntries) {
    const subjectId = text(entry.subject_id)
    if (!groupedProjections.has(subjectId)) groupedProjections.set(subjectId, [])
    groupedProjections.get(subjectId).push(entry)
  }
  for (const entries of groupedProjections.values()) {
    const firstEntry = entries[0]
    lines.push(`- 角色 ${text(firstEntry.display_name) || SAFE_SUBJECT_DISPLAY_NAME}：`)
    let directionIndex = 1
    for (const entry of entries) {
      const direction = promptDirection(entry)
      if (direction.content) {
        const title = direction.title ? `${direction.title}；` : ''
        lines.push(`  - 可能的发展方向${directionIndex}：${title}${direction.content}`)
        directionIndex += 1
      }
    }
    const attribution = entries.find(entry => entry.attribution)?.attribution
    if (attribution?.conflict) {
      lines.push('  - 生殖来源归因存在冲突，保持未确认，不要把任何来源写成已确认事实。')
    } else if (attribution?.candidates?.length) {
      lines.push('  - 存在多个尚未确认的来源候选；不要选择、排序或赋予概率。')
    } else if (attribution?.status === 'unresolved') {
      lines.push('  - 生殖来源归因仍未确认；不要自行选择来源。')
    } else if (attribution?.confirmed?.length) {
      lines.push('  - 已确认的生殖贡献者是当前事实背景；不要据此新增未确认归因。')
    }
  }
  if (projectionEntries.length) {
    lines.push(
      '推演规则：',
      '1. 各角色独立推演，从各自备选方向中选择合适的状态。',
      '2. 主动寻找或设计自然的剧情契机，通过行为、感受、互动或小情节等表现选定状态，使身体变化成为剧情的一部分，而非孤立描述。',
      '3. 本模块仅提供潜在表现，不得据此确认特定生理原因，也不得与其他身体问题擅自建立因果关系。',
      '4. 角色不在当前场景时，可通过独立分镜、视角切换、通讯、听闻或后续相遇等方式推进其状态，无须强行安排登场。',
      '',
    )
  }
  if (healthEntries.length) {
    lines.push(
      'BioWeave 恢复阶段身体表现指导（既有伤势的当前恢复状态）：',
      '本模块属于身体表现一致性约束，不是需要主动触发的新剧情事件，与潜在生物发展方向独立处理。',
      '以下信息用于在动作、环境或剧情涉及相关身体部位时，保持角色身体反应与当前恢复程度一致。无关场景无需主动提及，也不得为了表现伤势而刻意制造疼痛或不适。',
      '不要机械重复健康问题，也不要输出剩余天数、预计恢复日期、恢复百分比、deadline 或任何内部 Assessment 字段。',
    )
    for (const entry of healthEntries) {
      lines.push(`- 角色 ${text(entry.display_name) || SAFE_SUBJECT_DISPLAY_NAME} 的${entry.body_site}：${entry.guidance}`)
    }
  }
  return `\n<bioweave>\n${lines.join('\n')}\n</bioweave>\n`
}

export function buildProjectionContext(views, options = {}) {
  const projectionDTO = buildProjectionContextDTO(views, options)
  const dto = [...projectionDTO, ...healthGuidanceDTO(options.healthGuidance)]
  const displayNameBySubject = options.displayNameBySubject ?? {}
  const seen = new Set()
  const promptProjectionMetadata = list(views)
    .filter(view => view?.context_visible === true)
    .sort(sortViews)
    .filter(view => {
      const id = text(view?.projection_id)
      if (!id || seen.has(id)) return false
      seen.add(id)
      return true
    })
  const promptContext = dto.map(entry => ({
    ...entry,
    display_name: subjectDisplayName(entry.subject_id, displayNameBySubject),
    ...(entry.context_type === undefined
      ? { development_concern_key: promptProjectionMetadata[projectionDTO.indexOf(entry)]?.development_concern_key }
      : {}),
  }))
  return { dto: clone(dto), prompt: buildProjectionContextPrompt(promptContext) }
}
