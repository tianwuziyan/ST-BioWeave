import { differenceStoryTime } from '../story/time.js'
import { builtInPreConfirmationBranchForConcern, getBuiltInPreConfirmationSchedule } from './projection-eligibility.js'
import { resolveProjectionObservationRecords } from './projection.js'
import {buildStorylineContextPrompt, buildStorylineTimingContext} from './projection-storyline.js'

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

function reactionLabel(concept) {
  return builtInPreConfirmationBranchForConcern(`pre_confirmation_observation:${concept}`)?.label || null
}

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

function elapsedStoryDays(view, currentStoryTime) {
  if (!currentStoryTime || !view?.timing?.reference_story_time) return null
  const elapsed = differenceStoryTime(currentStoryTime, view.timing.reference_story_time)
  if (!elapsed || !Number.isFinite(Number(elapsed.value))) return null
  return elapsed.unit === 'minute' ? Number(elapsed.value) / 1440 : Number(elapsed.value)
}

function builtInSnapshotIdentity(view) {
  const evidence = view?.aggregation_evidence ?? {}
  return JSON.stringify([text(view?.subject_id), evidence.pregnancy_id ?? null, evidence.cycle_id ?? null])
}

function completeBuiltInStage(views, stageKey) {
  const branchKeys = new Set(
    getBuiltInPreConfirmationSchedule()
      .find(stage => stage.key === stageKey)
      ?.branches.map(branch => branch.key) ?? [],
  )
  const present = new Set(
    list(views)
      .filter(view => view?.context_visible === true && view?.deleted !== true)
      .map(view => builtInPreConfirmationBranchForConcern(view?.development_concern_key)?.key)
      .filter(branchKey => branchKeys.has(branchKey)),
  )
  return branchKeys.size > 0 && present.size === branchKeys.size
}

function filterViewsForCurrentBuiltInStage(views, { currentStoryTime = null } = {}) {
  const source = list(views)
  if (!currentStoryTime) return source
  const builtIn = source.filter(view => builtInPreConfirmationBranchForConcern(view?.development_concern_key))
  const groups = new Map()
  for (const view of builtIn) {
    const identity = builtInSnapshotIdentity(view)
    if (!groups.has(identity)) groups.set(identity, [])
    groups.get(identity).push(view)
  }
  const retained = new Set()
  for (const group of groups.values()) {
    const timedView = group.find(view => elapsedStoryDays(view, currentStoryTime) !== null)
    if (!timedView) {
      group.forEach(view => retained.add(view))
      continue
    }
    const elapsedDays = elapsedStoryDays(timedView, currentStoryTime)
    const schedule = getBuiltInPreConfirmationSchedule()
    const currentStage = schedule.find(stage => elapsedDays >= stage.min_elapsed_story_days && elapsedDays <= stage.max_elapsed_story_days)
    if (!currentStage) continue
    const completeStages = schedule.filter(stage => completeBuiltInStage(group, stage.key)).map(stage => stage.key)
    const selectedStage = completeStages.includes(currentStage.key)
      ? currentStage.key
      : completeStages.filter(stageKey => schedule.findIndex(stage => stage.key === stageKey) < schedule.indexOf(currentStage)).at(-1)
    if (selectedStage) {
      group
        .filter(view => builtInPreConfirmationBranchForConcern(view?.development_concern_key)?.stage_key === selectedStage)
        .forEach(view => retained.add(view))
    }
  }
  return source.filter(view => {
    const branch = builtInPreConfirmationBranchForConcern(view?.development_concern_key)
    if (!branch) return true
    return retained.has(view)
  })
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

export function buildProjectionContextDTO(views = [], { attributionBySubject = {}, currentStoryTime = null } = {}) {
  const seen = new Set()
  return filterViewsForCurrentBuiltInStage(views, { currentStoryTime })
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
  const projectionEntries = entries.filter(entry => !['health_recovery_guidance', 'pregnancy_knowledge'].includes(entry?.context_type))
  const historicalEntries = entries.filter(entry => entry?.context_type === 'historical_observed_reaction')
  const currentEntries = projectionEntries.filter(entry => entry?.context_type !== 'historical_observed_reaction')
  const healthEntries = entries.filter(entry => entry?.context_type === 'health_recovery_guidance')
  const lines = []
  const knowledgeEntries = entries.filter(entry => entry?.context_type === 'pregnancy_knowledge')
  if (knowledgeEntries.length) {
    lines.push(
      '【已确认怀孕与知情范围】',
      '以下只表示正文已确认的事实及明确知情边界；除列出的角色外，其他人物默认不知道，不得使用全知视角直接掌握结果。',
      ...knowledgeEntries.map(entry => `- 怀孕人物：${text(entry.subject_display_name) || SAFE_SUBJECT_DISPLAY_NAME}\n  - 明确知情：${list(entry.knower_display_names).join('、')}\n  - 其他人物：默认不知道`),
    )
  }
  if (currentEntries.length) {
    lines.push(
      'BioWeave 生物发展方向（仅供剧情参考，不是已经发生的事实）：',
      '本模块属于间歇性主动推演参考，与既有伤势及恢复状态独立处理。以下内容为各角色可能出现的身体状态。请结合近期剧情中已有的身体表现，适时选择生理反应，通过日常行为、身体感受、人物互动或自然衍生的小情节逐步呈现，使其成为剧情中偶尔浮现的细节，而非每个楼层都要出现的固定内容。',
    )
  }
  const groupedProjections = new Map()
  for (const entry of currentEntries) {
    const subjectId = text(entry.subject_id)
    if (!groupedProjections.has(subjectId)) groupedProjections.set(subjectId, [])
    groupedProjections.get(subjectId).push(entry)
  }
  if (historicalEntries.length) {
    lines.push('此前出现过的推演反应（不代表当前仍持续）：')
    const historicalBySubject = new Map()
    for (const entry of historicalEntries) {
      const key = text(entry.subject_id)
      if (!historicalBySubject.has(key)) historicalBySubject.set(key, [])
      historicalBySubject.get(key).push(entry.reaction_label)
    }
    for (const [subjectId, concepts] of historicalBySubject)
      lines.push(
        `- 角色 ${text(entries.find(entry => entry.subject_id === subjectId)?.display_name) || SAFE_SUBJECT_DISPLAY_NAME}：${[...new Set(concepts)].join('、')}`,
      )
  }
  for (const entries of groupedProjections.values()) {
    const firstEntry = entries[0]
    lines.push(`- 角色 ${text(firstEntry.display_name) || SAFE_SUBJECT_DISPLAY_NAME}：`)
    let directionIndex = 1
    for (const entry of entries) {
      const direction = promptDirection(entry)
      if (direction.content) {
        const title = direction.title ? `${direction.title}；` : ''
        lines.push(`  - 生理反应${directionIndex}：${title}${direction.content}`)
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
  if (currentEntries.length) {
    lines.push(
      '推演规则：',
      '1. 各角色独立推演，参考近期上下文判断表现时机。若近期已有相关身体反应，则适当留出叙事间隔，避免连续多个楼层反复提及；若近期一直没有相关表现，则主动寻找或设计自然的剧情契机，使潜在变化得到适度体现。',
      '2. 每个楼层中，同一角色最多表现1～2种生理反应，不得将所有备选反应集中写入同一楼层。',
      '3. 生理反应应作为偶发的生活细节融入剧情，不必每次都成为情节焦点。未表现的反应可在后续楼层自然呈现，已出现的反应也可延续、减轻或变化，不要求逐条兑现。',
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
  const filteredViews = filterViewsForCurrentBuiltInStage(views, options)
  const projectionDTO = buildProjectionContextDTO(filteredViews, { ...options, currentStoryTime: null })
  const seen = new Set()
  const promptProjectionMetadata = list(filteredViews)
    .filter(view => view?.context_visible === true)
    .sort(sortViews)
    .filter(view => {
      const id = text(view?.projection_id)
      if (!id || seen.has(id)) return false
      seen.add(id)
      return true
    })
  const currentProjectionIds = new Set(promptProjectionMetadata.map(item => item?.projection_id).filter(Boolean))
  const currentObservationSubjects = new Set(
    promptProjectionMetadata
      .filter(item => builtInPreConfirmationBranchForConcern(item?.development_concern_key))
      .map(item => text(item?.subject_id))
      .filter(Boolean),
  )
  const historyBySubject = new Map()
  const snapshotRecords = list(options.historicalTriggeredSnapshots).flatMap(snapshot => snapshot?.status === 'active'
    ? list(snapshot.triggered).map(item => ({...item, subject_id: snapshot.subject_id, action: 'triggered'}))
    : []);
  const snapshotSubjects = new Set(list(options.historicalTriggeredSnapshots).map(snapshot => text(snapshot?.subject_id)).filter(Boolean));
  const legacyRecords = resolveProjectionObservationRecords(list(options.historicalObservations))
    .filter(record => !snapshotSubjects.has(text(record?.subject_id)));
  const historyRecords = [...snapshotRecords, ...legacyRecords];
  for (const record of historyRecords) {
    const label = reactionLabel(record.reaction_concept)
    if (
      record?.action !== 'triggered' ||
      !currentObservationSubjects.has(record.subject_id) ||
      currentProjectionIds.has(record.projection_id) ||
      !text(record.subject_id) ||
      !label
    )
      continue
    const key = `${record.subject_id}\u001f${record.reaction_concept}`
    historyBySubject.set(key, { context_type: 'historical_observed_reaction', subject_id: record.subject_id, reaction_label: label })
  }
  const knowledgeDTO = list(options.pregnancyKnowledge).map(item => ({
    context_type: 'pregnancy_knowledge',
    subject_id: text(item.subject_id),
    subject_display_name: text(item.subject_display_name) || SAFE_SUBJECT_DISPLAY_NAME,
    knower_display_names: list(item.knower_display_names).filter(Boolean),
  })).filter(item => item.subject_id && item.knower_display_names.length)
  const dto = [...projectionDTO, ...historyBySubject.values(), ...healthGuidanceDTO(options.healthGuidance), ...knowledgeDTO]
  const displayNameBySubject = options.displayNameBySubject ?? {}
  const promptContext = dto.map(entry => ({
    ...entry,
    display_name: subjectDisplayName(entry.subject_id, displayNameBySubject),
    ...(entry.context_type === undefined
      ? { development_concern_key: promptProjectionMetadata[projectionDTO.indexOf(entry)]?.development_concern_key }
      : {}),
  }))
  const storylineReferenceCandidates = filteredViews.map(view => ({
    subject_id: view?.subject_id,
    tracking_window_id: view?.tracking_window_id,
    aggregation_evidence: view?.aggregation_evidence,
    timing: view?.timing,
  }))
  const storylinePrompt = list(options.storylineSnapshots)
    .map(snapshot => buildStorylineContextPrompt(snapshot, {
      storylineTiming: buildStorylineTimingContext({
        currentStoryTime: options.currentStoryTime,
        subjectId: snapshot?.subject_id,
        participantAggregations: options.participantAggregations,
        trackingWindows: options.trackingWindows,
        referenceCandidates: storylineReferenceCandidates,
      }),
    }))
    .filter(Boolean)
    .join('\n')
  return {
    dto: clone(dto),
    prompt: [buildProjectionContextPrompt(promptContext), storylinePrompt].filter(Boolean).join('\n'),
    contextVisibleProjectionIds: filteredViews
      .filter(view => view?.context_visible === true)
      .map(view => view?.projection_id)
      .filter(Boolean),
  }
}
