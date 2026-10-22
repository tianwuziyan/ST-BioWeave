import {differenceStoryTime} from '../story/time.js'

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
function entriesOf(value) {
  if (Array.isArray(value)) return value.map((item, index) => ({ key: index, value: item }))
  if (value && typeof value === 'object') return Object.entries(value).map(([key, item]) => ({ key, value: item }))
  return []
}
function projectionStatusLabel(status) {
  return { active: '观察中', realized: '已出现', contradicted: '已否定', expired: '已过期', deleted: '已删除' }[status] ?? '未确认'
}
function projectionStatusTone(status) {
  if (status === 'realized') return 'good'
  if (['contradicted', 'expired', 'deleted'].includes(status)) return 'warn'
  return 'accent'
}
function projectionCandidateStatus(item) {
  if (item?.status !== 'active') return projectionStatusLabel(item?.status)
  const concernKey = String(item?.concern_key ?? item?.rule?.concern_key ?? '').trim()
  return concernKey.endsWith('no_reaction_early') || concernKey.endsWith('no_reaction_late') ? '始终可能' : '当前可能出现'
}
function isBuiltInPreConfirmationItem(item) {
  const concernKey = String(item?.concern_key ?? item?.rule?.concern_key ?? '').trim()
  return concernKey.startsWith('pre_confirmation_observation:')
}
function normalizeDisplayStatement(value) {
  return String(value ?? '')
    .trim()
    .replace(/[；;。.]?\s*(?:这)?只是备选剧情方向(?:，不是已确认怀孕事实)?[。.]?\s*$/u, '')
    .trim()
}
function displayStatement(item) {
  const source = item?.rule?.description || item?.generated_statement
  return normalizeDisplayStatement(source) || '正文继续推进后，这条路线才可能出现具体表现。'
}
function subjectIdOf(item) {
  return String(item?.subject?.id ?? item?.subject?.subject_id ?? '').trim()
}
function subjectNameOf(subjectId, item, trackingSubjects) {
  const subject = entriesOf(trackingSubjects).find(({ key, value }) => String(value?.character_id ?? value?.id ?? key) === subjectId)?.value
  return subject?.display_name ?? item?.subject?.display_name ?? '未命名人物'
}
function finiteDay(value) {
  if (value === null || value === undefined || value === '') return null
  const day = Number(value)
  return Number.isFinite(day) && day >= 0 ? Math.floor(day) : null
}
function normalizeStage(stage) {
  if (!stage || typeof stage !== 'object') return null
  return {
    key: String(stage.key ?? '').trim(),
    label: String(stage.label ?? '').trim(),
    phase: String(stage.phase ?? '').trim(),
    min_elapsed_story_days: finiteDay(stage.min_elapsed_story_days),
    max_elapsed_story_days: finiteDay(stage.max_elapsed_story_days),
    branches: Array.isArray(stage.branches)
      ? stage.branches
          .map(branch => ({
            key: String(branch?.key ?? '').trim(),
            label: String(branch?.label ?? '').trim(),
            description: String(branch?.description ?? '').trim(),
          }))
          .filter(branch => branch.key && branch.label)
      : [],
  }
}
function scheduleFor(summary, items) {
  const stages = new Map()
  const add = stage => {
    const normalized = normalizeStage(stage)
    if (!normalized?.key) return
    const existing = stages.get(normalized.key)
    stages.set(
      normalized.key,
      existing ? { ...existing, ...normalized, branches: normalized.branches.length ? normalized.branches : existing.branches } : normalized,
    )
  }
  for (const stage of summary?.observation_schedule ?? []) add(stage)
  for (const item of items) add(item?.rule?.observation_stage)
  return [...stages.values()].sort((left, right) => (left.min_elapsed_story_days ?? 0) - (right.min_elapsed_story_days ?? 0))
}
function stageOf(item) {
  const stage = item?.rule?.observation_stage
  return stage && typeof stage === 'object' ? stage : null
}
function timingFor(items) {
  const latest = items.find(item => item?.timing && typeof item.timing === 'object')?.timing ?? null
  let day = null
  if (latest?.current_story_time && latest?.reference_story_time) {
    try {
      const difference = differenceStoryTime(latest.current_story_time, latest.reference_story_time)
      if (difference?.unit === 'day') day = Math.floor(Number(difference.value))
      else if (difference?.unit === 'minute') day = Math.floor(Number(difference.value) / 1440)
      if (!Number.isFinite(day)) day = null
    } catch {
      day = null
    }
  }
  return {
    day,
    referenceStoryTime: latest?.reference_story_time ?? null,
    currentStoryTime: latest?.current_story_time ?? null,
    observationStageKey: latest?.observation_stage_key ?? null,
    observationDaysUntilEnd: Number.isFinite(Number(latest?.observation_days_until_end))
      ? Math.max(0, Math.floor(Number(latest.observation_days_until_end)))
      : null,
  }
}
function currentStageFor(group, schedule) {
  const currentDay = finiteDay(group.timing.day)
  if (currentDay !== null) {
    return schedule.find(stage => currentDay >= stage.min_elapsed_story_days && currentDay <= stage.max_elapsed_story_days) ?? null
  }
  if (group.timing.observationStageKey) {
    const byKey = schedule.find(stage => stage.key === group.timing.observationStageKey)
    if (byKey) return byKey
  }
  const itemStage = group.items
    .map(stageOf)
    .filter(Boolean)
    .sort((left, right) => (right.min_elapsed_story_days ?? 0) - (left.min_elapsed_story_days ?? 0))[0]
  return schedule.find(stage => stage.key === itemStage?.key) ?? normalizeStage(itemStage)
}
function groupProjections(items, trackingSubjects, observationSchedule = [], historicalObservedReactions = []) {
  const groups = new Map()
  for (const item of items) {
    const subjectId = subjectIdOf(item) || '__unknown_subject__'
    const group = groups.get(subjectId) ?? {
      id: subjectId,
      name: subjectNameOf(subjectId, item, trackingSubjects),
      items: [],
      labels: [],
      sourceCount: 0,
      aggregatedCandidateCount: null,
    }
    group.items.push(item)
    const label = item?.rule?.label || '潜在生理变化'
    if (!group.labels.includes(label)) group.labels.push(label)
    groups.set(subjectId, group)
  }
  return [...groups.values()]
    .map(group => {
      const builtInItems = group.items.filter(isBuiltInPreConfirmationItem)
      const builtInCandidateCounts = builtInItems.map(item => item?.aggregated_candidate_count)
      const hasConsistentBuiltInCandidateCount =
        builtInItems.length === 0 ||
        (builtInCandidateCounts.length > 0 &&
          builtInCandidateCounts.every(count => Number.isSafeInteger(count) && count >= 0 && count === builtInCandidateCounts[0]))
      if (!hasConsistentBuiltInCandidateCount) return null
      const activeItems = group.items.filter(item => item?.status === 'active')
      const sourceRefs = new Set(group.items.flatMap(item => (Array.isArray(item?.source_refs) ? item.source_refs : [])))
      const timing = timingFor(group.items)
      const candidateCounts = builtInItems.length
        ? builtInCandidateCounts
        : group.items.map(item => item?.aggregated_candidate_count).filter(count => Number.isSafeInteger(count) && count >= 0)
      const aggregatedCandidateCount =
        candidateCounts.length && candidateCounts.every(count => count === candidateCounts[0]) ? candidateCounts[0] : null
      const result = {
        ...group,
        activeItems,
        activeCount: activeItems.length,
        sourceCount: sourceRefs.size,
        aggregatedCandidateCount,
        timing,
        status: activeItems.length ? 'active' : (group.items.at(-1)?.status ?? 'active'),
        schedule: observationSchedule,
      }
      result.currentStage = currentStageFor(result, observationSchedule)
      result.currentItems = result.currentStage ? activeItems.filter(item => stageOf(item)?.key === result.currentStage.key) : activeItems
      result.historicalObservedReactions = historicalObservedReactions.filter(item => item?.subject_id === group.id)
      if (!result.currentItems.length && activeItems.length && !result.currentStage) result.currentItems = activeItems
      result.stageIndex = result.currentStage ? observationSchedule.findIndex(stage => stage.key === result.currentStage.key) : -1
      return result
    })
    .filter(Boolean)
}
function isBuiltInGroup(group) {
  return group.items.some(isBuiltInPreConfirmationItem)
}
function dayLabel(day) {
  return day === null ? '时间待推进' : `第 ${day} 天`
}
function stageLabel(group) {
  if (group.currentStage?.label) return group.currentStage.label
  return isBuiltInGroup(group) ? '观察阶段待解析' : dayLabel(group.timing.day)
}
function stagePhase(group) {
  return group.currentStage?.phase || '观察中'
}
function routeLabels(group) {
  const labels = group.currentItems.map(item => item?.rule?.label).filter(Boolean)
  if (labels.length) return [...new Set(labels)].join(' · ')
  return (
    group.currentStage?.branches
      ?.map(branch => branch.label)
      .filter(Boolean)
      .join(' · ') || '等待候选路线'
  )
}
function personCard(group, selectedId) {
  const selected = group.id === selectedId
  const stageIndex = Math.max(0, group.stageIndex)
  const segments = [0, 1, 2].map(index => `<i class="${index < stageIndex ? 'done' : index === stageIndex ? 'current' : ''}"></i>`).join('')
  const settlement = isBuiltInGroup(group) || group.timing.observationDaysUntilEnd === null
    ? '观察期内'
    : `${group.timing.observationDaysUntilEnd} 天`
  return (
    '<button type="button" class="bioweave-projection-person-card' +
    (selected ? ' selected' : '') +
    '" data-bioweave-action="select-projection-subject" data-projection-subject-id="' +
    escapeHtml(group.id) +
    '" aria-pressed="' +
    String(selected) +
    '">' +
    '<div class="bioweave-projection-person-top"><div><div class="bioweave-projection-person-name">' +
    escapeHtml(group.name) +
    '</div><div class="bioweave-projection-person-status">' +
    escapeHtml(projectionStatusLabel(group.status)) +
    ' · 名单已完成</div></div><span class="bioweave-badge ' +
    projectionStatusTone(group.status) +
    '">' +
    escapeHtml(dayLabel(group.timing.day)) +
    '</span></div>' +
    '<div class="bioweave-projection-person-stats"><div><span>当前阶段</span><strong>' +
    escapeHtml(stagePhase(group)) +
    '</strong></div><div><span>距离本轮结算</span><strong>' +
    escapeHtml(settlement) +
    '</strong></div></div>' +
    '<div class="bioweave-projection-person-progress" aria-hidden="true">' +
    segments +
    '</div>' +
    '<div class="bioweave-projection-person-route"><b>可能：</b>' +
    escapeHtml(routeLabels(group)) +
    '</div>' +
    '</button>'
  )
}
function signalCard(item) {
  const label = item?.rule?.label || '潜在生理变化'
  const statement = displayStatement(item)
  const status = projectionCandidateStatus(item)
  const statusCopy = item?.status === 'active' ? `${status}` : status
  const observedBadge = item?.observed_reaction?.matched === true
    ? '<span class="bioweave-badge good bioweave-projection-signal-observed">已触发</span>'
    : ''
  return (
    '<article class="bioweave-projection-signal"><div class="bioweave-projection-signal-head"><strong>' +
    escapeHtml(label) + '</strong>' + observedBadge + '</div>' +
    '<p>' +
    escapeHtml(statement) +
    '</p><em>' +
    escapeHtml(statusCopy) +
    '</em>' +
    '<div class="bioweave-projection-signal-foot">' +
    (item?.id
      ? '<button type="button" class="bioweave-text-button" data-bioweave-action="delete-projection" data-projection-id="' +
        escapeHtml(item.id) +
        '">删除</button>'
      : '') +
    '</div></article>'
  )
}
function laterSection(group) {
  const futureStages = group.schedule.filter((stage, index) => index > group.stageIndex)
  if (futureStages.length) {
    return futureStages
      .map(
        stage =>
          '<div class="bioweave-projection-route-row"><div class="bioweave-projection-route-day">' +
          escapeHtml(stage.label) +
          '</div><div><strong>' +
          escapeHtml(stage.branches.map(branch => branch.label).join(' / ')) +
          '</strong><p>时间推进到这一段后才开放这些方向；正文没有写出，就不会把候选路线记成已经发生。</p></div></div>',
      )
      .join('')
  }
  return '<div class="bioweave-projection-route-row"><div class="bioweave-projection-route-day">观察期结束</div><div><strong>没有确认怀孕 → 本轮结束</strong><p>如果正文一直没有明确确认，当前周期按未怀孕处理，本周期的亲密事件不再带入下一轮。</p></div></div>'
}
function detail(group) {
  if (!group) return ''
  const activeItems = group.currentItems.length ? group.currentItems : group.activeItems.length ? group.activeItems : group.items
  const statusTone = group.status === 'active' ? 'good' : projectionStatusTone(group.status)
  const finalStage = group.schedule.at(-1)
  const settlement = isBuiltInGroup(group) || group.timing.observationDaysUntilEnd === null
    ? '以观察周期为准'
    : `${group.timing.observationDaysUntilEnd} 天`
  const aggregatedCandidates = group.aggregatedCandidateCount === null ? '' : `${group.aggregatedCandidateCount} 人`
  const candidateSummary = aggregatedCandidates ? '<div><span>已聚合候选</span><strong>' + escapeHtml(aggregatedCandidates) + '</strong></div>' : ''
  return (
    '<section class="bioweave-projection-detail" aria-label="' +
    escapeHtml(group.name) +
    ' 的推演详情">' +
    '<header class="bioweave-projection-detail-head"><div><h2>' +
    escapeHtml(group.name) +
    '</h2><p>这条时间线只属于 ' +
    escapeHtml(group.name) +
    '，不与其他人物共用阶段。</p></div><div class="bioweave-projection-detail-meta"><span class="bioweave-badge ' +
    statusTone +
    '">' +
    escapeHtml(projectionStatusLabel(group.status)) +
    '</span><span class="bioweave-badge accent">' +
    escapeHtml(dayLabel(group.timing.day)) +
    '</span></div></header>' +
    '<div class="bioweave-projection-detail-summary"><div><span>当前阶段</span><strong>' +
    escapeHtml(`${stageLabel(group)} · ${stagePhase(group)}`) +
    '</strong></div>' +
    candidateSummary +
    '<div><span>距离本轮结算</span><strong>' +
    escapeHtml(settlement) +
    '</strong></div></div>' +
    '<section class="bioweave-projection-detail-section current"><div class="bioweave-projection-section-title"><h3>现在可能出现</h3><span>' +
    escapeHtml(stageLabel(group)) +
    '</span></div><p class="bioweave-projection-section-copy">只展示这个人物当前时间段可以触发的路线；这些路线互相是备选，不会同时发生。</p><div class="bioweave-projection-signals">' +
    activeItems.map(signalCard).join('') +
    '</div></section>' +
    (group.historicalObservedReactions?.length ? '<section class="bioweave-projection-detail-section"><div class="bioweave-projection-section-title"><h3>本轮曾经触发</h3><span>此前出现过，不代表当前仍持续</span></div><p class="bioweave-projection-section-copy">' + escapeHtml([...new Set(group.historicalObservedReactions.map(item => item.reaction_label).filter(Boolean))].join('、')) + '</p></section>' : '') +
    '<section class="bioweave-projection-detail-section"><div class="bioweave-projection-section-title"><h3>之后可能出现</h3><span>跟着 ' +
    escapeHtml(group.name) +
    ' 自己的时间走</span></div>' +
    laterSection(group) +
    '</section>' +
    '<section class="bioweave-projection-detail-section"><div class="bioweave-projection-section-title"><h3>最后怎么结束</h3><span>' +
    escapeHtml(finalStage?.label || '以观察周期为准') +
    '</span></div><div class="bioweave-projection-outcomes"><article><strong>正文明确确认怀孕</strong><p>正文出现明确的怀孕事实，才进入确认阶段。</p></article><article class="end"><strong>超过周期仍无确认</strong><p>本轮结束并按“未怀孕”处理，当前周期的亲密事件不再带入下一轮。</p></article></div></section>' +
    '<footer class="bioweave-projection-detail-foot">插件自动生成候选路线；正文没有写出，就不会把路线记成已经发生。</footer>' +
    '</section>'
  )
}
export function projectionPage({
  projections = [],
  projectionSummary = null,
  projectionStatus = null,
  trackingSubjects = {},
  projectionSubjectId = null,
} = {}) {
  const items = Array.isArray(projections) ? projections : []
  const summary = projectionSummary ?? { active_count: items.filter(item => item.status === 'active').length }
  const schedule = scheduleFor(summary, items)
  const groups = groupProjections(items, trackingSubjects, schedule, summary.historical_observed_reactions ?? [])
  const selectedId = groups.some(group => group.id === projectionSubjectId) ? projectionSubjectId : (groups[0]?.id ?? null)
  const people = groups.map(group => personCard(group, selectedId)).join('')
  const selectedGroup = groups.find(group => group.id === selectedId) ?? null
  const statusNotice =
    projectionStatus?.state === 'running'
      ? '<div class="bioweave-card bioweave-projection-status"><span class="bioweave-muted">正在生成候选路线…</span></div>'
      : projectionStatus?.state === 'failed'
        ? '<div class="bioweave-card bioweave-projection-status"><span class="bioweave-error">推演更新失败，可重新读取。</span></div>'
        : ''
  const emptyState =
    '<section class="bioweave-card bioweave-empty"><b>当前没有需要展示的推演</b><p>插件会在观察条件满足后自动生成候选路线；推演不是已发生事实。</p></section>'
  return (
    '<section class="bioweave-page bioweave-projection-page" data-bioweave-page="projection"><header class="bioweave-page-head"><div class="bioweave-page-head-copy"><h2>人物推演</h2><p>先选人物，再查看这个人物自己的潜在剧情时间线</p></div><div class="bioweave-page-actions"><span class="bioweave-badge accent">' +
    escapeHtml(groups.length) +
    ' 位人物观察中</span><button type="button" class="bioweave-button" data-bioweave-action="refresh-projection">重新读取</button></div></header>' +
    '<div class="bioweave-projection-notice"><span aria-hidden="true">✦</span><div><strong>每个人单独计算时间</strong><p>人物之间不共用第几天；只有正文明确写出某种表现，才会把它记为已观察到。</p></div></div>' +
    statusNotice +
    (groups.length
      ? '<div class="bioweave-projection-overview-line"><h2>观察人物</h2><span>点击人物查看详情</span></div><div class="bioweave-projection-workspace"><aside class="bioweave-projection-people-panel"><header class="bioweave-projection-panel-head"><h2>人物列表</h2><span>' +
        escapeHtml(groups.length) +
        ' 人</span></header><div class="bioweave-projection-people-list">' +
        people +
        '</div></aside>' +
        detail(selectedGroup) +
        '</div>'
      : emptyState) +
    '</section>'
  )
}
