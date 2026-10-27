import {differenceStoryTime} from '../story/time.js'
import {pregnancyStatusView, renderPregnancyKnowledgePopover} from './pregnancy-status.js'

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
      const stageTriggered = activeItems
        .filter(item => item?.observed_reaction?.matched === true && (!result.currentStage || stageOf(item)?.key !== result.currentStage.key))
        .map(item => ({subject_id: group.id, reaction_label: item?.rule?.label ?? '潜在生理变化', reaction_concept: item?.concern_key ?? item?.rule?.label}))
      result.historicalObservedReactions = [...historicalObservedReactions.filter(item => item?.subject_id === group.id), ...stageTriggered]
      result.triggeredCount = new Set([
        ...activeItems.filter(item => item?.observed_reaction?.matched === true).map(item => item?.rule?.label ?? item?.concern_key),
        ...result.historicalObservedReactions.map(item => item?.reaction_label ?? item?.reaction_concept),
      ].filter(Boolean)).size
      if (!result.currentItems.length && activeItems.length && !result.currentStage) result.currentItems = activeItems
      result.stageIndex = result.currentStage ? observationSchedule.findIndex(stage => stage.key === result.currentStage.key) : -1
      return result
    })
    .filter(Boolean)
}
function isBuiltInGroup(group) {
  return group.items.some(isBuiltInPreConfirmationItem)
}
function remainingObservationDays(group) {
  if (isBuiltInGroup(group)) {
    const currentDay = finiteDay(group.timing.day)
    const endDay = finiteDay(group.schedule.at(-1)?.max_elapsed_story_days)
    return currentDay !== null && endDay !== null ? Math.max(0, endDay - currentDay) : null
  }
  return group.timing.observationDaysUntilEnd
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
function personCard(group, selectedId, pregnancyStatuses = []) {
  const selected = group.id === selectedId
  const pregnancy = pregnancyStatusView(pregnancyStatuses, group.id)
  const personStatus = pregnancy.confirmed
    ? '已确认怀孕'
    : pregnancy.status === 'suspected'
      ? pregnancy.pregnancyLabel
      : projectionStatusLabel(group.status)
  const stageIndex = Math.max(0, group.stageIndex)
  const segments = [0, 1, 2].map(index => `<i class="${index < stageIndex ? 'done' : index === stageIndex ? 'current' : ''}"></i>`).join('')
  const remainingDays = remainingObservationDays(group)
  const settlement = remainingDays === null
    ? '观察期内'
    : `${remainingDays} 天`
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
    escapeHtml(personStatus) +
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
    (group.triggeredCount ? '<div class="bioweave-projection-person-triggered"><span class="bioweave-badge good">已触发 ' + escapeHtml(group.triggeredCount) + ' 条</span></div>' : '') +
    '</button>'
  )
}
function signalCard(item) {
  const label = item?.rule?.label || '潜在生理变化'
  const statement = displayStatement(item)
  const observedBadge = item?.observed_reaction?.matched === true
    ? '<span class="bioweave-badge good bioweave-projection-signal-observed">已触发</span>'
    : ''
  return (
    '<article class="bioweave-projection-signal"><div class="bioweave-projection-signal-head"><strong>' +
    escapeHtml(label) + '</strong>' + observedBadge + '</div>' +
    '<p>' +
    escapeHtml(statement) +
    '</p>' +
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
function storylineSnapshotList(value) {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') return Object.values(value)
  return []
}

function storylineNodeText(node) {
  return String(node?.objective ?? node?.title ?? node?.completion_signal ?? '').trim()
}

function storylineBranch(branch) {
  if (!branch || typeof branch !== 'object') return null
  const legacyConclusionGoal = String(branch.conclusion_goal ?? '').trim()
  const nodes = (Array.isArray(branch.nodes) ? branch.nodes : [])
    .map(node => ({
      node_id: typeof node?.node_id === 'string' ? node.node_id.trim() : '',
      title: String(node?.title ?? '').trim(),
      objective: String(node?.objective ?? '').trim(),
      completion_signal: String(node?.completion_signal ?? '').trim(),
      conclusion_goal: String(node?.conclusion_goal ?? '').trim() || legacyConclusionGoal,
    }))
    .filter(node => storylineNodeText(node))
  const title = String(branch.title ?? '').trim()
  const premise = String(branch.premise ?? '').trim()
  if (!title || !premise || !nodes.length) return null
  return {
    title,
    premise,
    nodes,
  }
}

function storylineSnapshotFor(group, snapshots) {
  const source = storylineSnapshotList(snapshots).find(item => String(item?.subject_id ?? '').trim() === group.id)
  if (!source || !['candidates', 'selected', 'terminated'].includes(source.status)) return null
  const branches = (Array.isArray(source.branches) ? source.branches : []).map(storylineBranch).filter(Boolean)
  if (source.status === 'candidates' && branches.length !== 3) return null
  if (source.status === 'selected' && branches.length !== 1) return null
  if (source.status === 'terminated' && branches.length !== 0) return null
  return {
    subjectId: group.id,
    status: source.status,
    branches,
    selectedNodeId: typeof source.selected_node_id === 'string' ? source.selected_node_id : null,
    selectedNodeStatus: source.selected_node_status === 'completed' ? 'completed' : 'active',
    currentNodeIndex: Number.isInteger(source.current_node_index) ? Math.max(0, source.current_node_index) : 0,
  }
}

function focusedNodeIndex(branch, focus, subjectId, branchIndex, fallbackIndex = 0) {
  const candidate = focus && focus.subjectId === subjectId && focus.branchIndex === branchIndex
    ? focus.nodeIndex
    : fallbackIndex
  return Number.isInteger(candidate) && candidate >= 0 && candidate < branch.nodes.length ? candidate : Math.max(0, Math.min(fallbackIndex, branch.nodes.length - 1))
}

function storylineNodeList(branch, {subjectId = '', branchIndex = 0, focusedNode = null, fallbackIndex = 0} = {}) {
  const selectedNodeIndex = focusedNodeIndex(branch, focusedNode, subjectId, branchIndex, fallbackIndex)
  return '<ul class="bioweave-projection-storyline-node-list">' + branch.nodes.map((node, nodeIndex) => {
    const label = [node.title, node.objective].filter(Boolean).join('：') || node.completion_signal
    return '<li' + (nodeIndex === selectedNodeIndex ? ' class="selected"' : '') + '><button type="button" class="bioweave-projection-storyline-node" data-bioweave-action="select-projection-storyline-node" data-projection-subject-id="' + escapeHtml(subjectId) + '" data-projection-branch-index="' + escapeHtml(branchIndex) + '" data-projection-node-index="' + escapeHtml(nodeIndex) + '" aria-pressed="' + String(nodeIndex === selectedNodeIndex) + '">' + escapeHtml(label) + '</button></li>'
  }).join('') + '</ul>'
}

function storylineGoal(node, label = '结论目标') {
  const goal = String(node?.conclusion_goal ?? '').trim()
  if (!goal) return ''
  return '<div class="bioweave-projection-storyline-goal"><span>' + escapeHtml(label) + '</span><p>' + escapeHtml(goal) + '</p></div>'
}

function storylineBranchCard(branch, index, subjectId, focusedNode) {
  const selectedNodeIndex = focusedNodeIndex(branch, focusedNode, subjectId, index, 0)
  return '<article class="bioweave-projection-storyline-route"><div class="bioweave-projection-storyline-route-head"><strong>' +
    escapeHtml(branch.title) +
    '</strong><span class="bioweave-badge accent">路线 ' + escapeHtml(index + 1) + '</span></div><p>' +
    escapeHtml(branch.premise) +
    '</p><div><span class="bioweave-projection-storyline-label">候选节点 · ' + escapeHtml(branch.nodes.length) + ' 个</span>' +
    storylineNodeList(branch, {subjectId, branchIndex: index, focusedNode}) +
    '</div>' + storylineGoal(branch.nodes[selectedNodeIndex]) + '</article>'
}

function storylineMetaBadge(snapshot, projectionStatus) {
  if (projectionStatus?.state === 'running') return '<span class="bioweave-badge">生成中</span>'
  if (projectionStatus?.state === 'failed') return '<span class="bioweave-badge">生成失败</span>'
  if (snapshot?.status === 'candidates') return '<span class="bioweave-badge">候选路线</span>'
  if (snapshot?.status === 'selected') return '<span class="bioweave-badge">已选支线</span>'
  if (snapshot?.status === 'terminated') return '<span class="bioweave-badge">本轮已结束</span>'
  return ''
}

function storylineCandidatesSection(snapshot, focusedNode = null) {
  return '<section class="bioweave-projection-detail-section bioweave-projection-storyline-section" aria-label="候选剧情支线"><div class="bioweave-projection-section-title"><div><h3>候选剧情支线</h3><p class="bioweave-projection-storyline-copy">API 已返回 3 条设计建议 · 候选，不是已发生事实</p></div><span class="bioweave-badge accent">等待正文推进</span></div><div class="bioweave-projection-storyline-callout"><span aria-hidden="true">✦</span><p>下一次正文生成时，引导 AI 从这些候选中推进一条支线；一旦选定，其他路线不再同时推进。</p></div><div class="bioweave-projection-storyline-routes">' +
    snapshot.branches.map((branch, index) => storylineBranchCard(branch, index, snapshot.subjectId, focusedNode)).join('') +
    '</div></section>'
}

function storylineSelectedSection(snapshot, focusedNode = null) {
  const branch = snapshot.branches[0]
  const fallbackIndex = Number.isInteger(snapshot.currentNodeIndex) ? snapshot.currentNodeIndex : 0
  const selectedNodeIndex = focusedNodeIndex(branch, focusedNode, snapshot.subjectId, 0, fallbackIndex)
  const node = branch.nodes.find(item => item.node_id === snapshot.selectedNodeId) || branch.nodes[selectedNodeIndex] || branch.nodes[0]
  const completed = snapshot.selectedNodeStatus === 'completed'
  return '<section class="bioweave-projection-detail-section bioweave-projection-storyline-section" aria-label="当前推进支线"><div class="bioweave-projection-section-title"><div><h3>当前推进支线</h3><p class="bioweave-projection-storyline-copy">已选定一个节点后只注入该节点，不会自动切换到其它节点</p></div><span class="bioweave-badge good">' + (completed ? '节点已完成' : '进行中') + '</span></div><article class="bioweave-projection-storyline-selected"><div class="bioweave-projection-storyline-selected-head"><div><strong>' + escapeHtml(branch.title) + '</strong><p>' + escapeHtml(branch.premise) + '</p></div><span class="bioweave-badge accent">单线推进</span></div><div class="bioweave-projection-storyline-timeline"><div class="bioweave-projection-storyline-timeline-item current"><span class="bioweave-projection-storyline-timeline-dot" aria-hidden="true"></span><span class="bioweave-projection-storyline-timeline-copy"><strong>已选节点 · ' + escapeHtml(storylineNodeText(node)) + '</strong><p>' + escapeHtml(completed ? '该节点已完成，等待事实结论。' : '正文生成时应主动创造能够推进该节点的条件。') + '</p>' + (node.completion_signal ? '<span class="bioweave-projection-storyline-completion">完成信号：' + escapeHtml(node.completion_signal) + '</span>' : '') + '</span></div></div>' + storylineGoal(node) + '</article></section>'
}

function storylineTerminatedSection() {
  return '<section class="bioweave-projection-detail-section bioweave-projection-storyline-section" aria-label="候选剧情支线已结束"><div class="bioweave-projection-section-title"><div><h3>候选剧情支线</h3><p class="bioweave-projection-storyline-copy">本轮支线区块</p></div><span class="bioweave-badge muted">已结束</span></div><div class="bioweave-projection-storyline-state"><span class="bioweave-projection-storyline-state-icon" aria-hidden="true">✓</span><strong>本轮剧情支线已结束</strong><p>当前观察窗口没有可继续推进的候选路线。</p></div></section>'
}

function storylineRunningSection() {
  return '<section class="bioweave-projection-detail-section bioweave-projection-storyline-section" aria-label="候选剧情支线生成中"><div class="bioweave-projection-section-title"><div><h3>候选剧情支线</h3><p class="bioweave-projection-storyline-copy">正在等待推演 API 返回非生理剧情支线</p></div><span class="bioweave-badge warn">生成中</span></div><div class="bioweave-projection-storyline-state bioweave-projection-storyline-state-running"><span class="bioweave-projection-storyline-spinner" aria-hidden="true"></span><strong>正在生成候选路线…</strong><p>正在将已触发生理信号、人物资料和近期正文发送给推演 API，返回后会在这里显示事件支线。</p><button type="button" class="bioweave-button bioweave-projection-stop" data-bioweave-action="stop-projection-storyline" aria-label="停止生成候选路线">停止生成</button></div></section>'
}

function storylineFailedSection() {
  return '<section class="bioweave-projection-detail-section bioweave-projection-storyline-section" aria-label="候选剧情支线生成失败"><div class="bioweave-projection-section-title"><div><h3>候选剧情支线</h3><p class="bioweave-projection-storyline-copy">本轮支线生成未完成</p></div><span class="bioweave-badge warn">生成失败</span></div><div class="bioweave-projection-storyline-state"><span class="bioweave-projection-storyline-state-icon" aria-hidden="true">!</span><strong>推演更新失败</strong><p>可重新读取推演页，再次生成候选路线。</p></div></section>'
}

function storylineSection(snapshot, projectionStatus = null, focusedNode = null) {
  if (projectionStatus?.state === 'running') return storylineRunningSection()
  if (projectionStatus?.state === 'failed') return storylineFailedSection()
  if (!snapshot) return ''
  if (snapshot.status === 'candidates') return storylineCandidatesSection(snapshot, focusedNode)
  if (snapshot.status === 'selected') return storylineSelectedSection(snapshot, focusedNode)
  return storylineTerminatedSection()
}

function detail(group, storylineSnapshots = [], projectionStatus = null, focusedNode = null, pregnancyStatuses = [], pregnancyKnowledge = [], pregnancyKnowledgePopoverOpen = false) {
  if (!group) return ''
  const activeItems = group.currentItems.length ? group.currentItems : group.activeItems.length ? group.activeItems : group.items
  const statusTone = group.status === 'active' ? 'good' : projectionStatusTone(group.status)
  const finalStage = group.schedule.at(-1)
  const remainingDays = remainingObservationDays(group)
  const settlement = remainingDays === null
    ? '以观察周期为准'
    : `${remainingDays} 天`
  const aggregatedCandidates = group.aggregatedCandidateCount === null ? '' : `${group.aggregatedCandidateCount} 人`
  const candidateSummary = aggregatedCandidates ? '<div><span>已聚合候选</span><strong>' + escapeHtml(aggregatedCandidates) + '</strong></div>' : ''
  const storylineSnapshot = storylineSnapshotFor(group, storylineSnapshots)
  const pregnancy = pregnancyStatusView(pregnancyStatuses, group.id)
  const pregnancyMeta = pregnancy.confirmed
    ? `<button type="button" class="bioweave-badge good bioweave-projection-pregnancy-button" data-bioweave-action="toggle-character-pregnancy-knowledge" data-character-id="${escapeHtml(group.id)}" aria-haspopup="dialog" aria-controls="bioweave-pregnancy-knowledge-popover" aria-expanded="${String(Boolean(pregnancyKnowledgePopoverOpen))}">已确认怀孕</button>`
    : pregnancy.status === 'suspected'
      ? `<span class="bioweave-badge ${statusTone}">${escapeHtml(pregnancy.pregnancyLabel)}</span>`
    : `<span class="bioweave-badge ${statusTone}">${escapeHtml(projectionStatusLabel(group.status))}</span>`
  return (
    '<section class="bioweave-projection-detail" aria-label="' +
    escapeHtml(group.name) +
    ' 的推演详情">' +
    '<header class="bioweave-projection-detail-head"><div><h2>' +
    escapeHtml(group.name) +
    '</h2><p>这条时间线只属于 ' +
    escapeHtml(group.name) +
    '，不与其他人物共用阶段。</p></div><div class="bioweave-projection-detail-meta">' +
    pregnancyMeta +
    '<span class="bioweave-badge accent">' +
    escapeHtml(dayLabel(group.timing.day)) +
    '</span>' + storylineMetaBadge(storylineSnapshot, projectionStatus) + '</div></header>' +
    renderPregnancyKnowledgePopover({knowledge: pregnancyKnowledge, characterId: group.id, open: pregnancyKnowledgePopoverOpen}) +
    '<div class="bioweave-projection-detail-summary"><div><span>当前阶段</span><strong>' +
    escapeHtml(`${stageLabel(group)} · ${stagePhase(group)}`) +
    '</strong></div>' +
    candidateSummary +
    '<div><span>距离本轮结算</span><strong>' +
    escapeHtml(settlement) +
    '</strong></div></div>' +
    '<section class="bioweave-projection-detail-section current"><div class="bioweave-projection-section-title"><h3>现在可能出现</h3><span class="bioweave-badge accent">' +
    escapeHtml(stagePhase(group)) +
    '</span></div><p class="bioweave-projection-section-copy">只展示这个人物当前时间段可以触发的路线；这些路线互相是备选，不会同时发生。</p><div class="bioweave-projection-signals">' +
    activeItems.map(signalCard).join('') +
    '</div></section>' +
    storylineSection(storylineSnapshot, projectionStatus, focusedNode) +
    (group.historicalObservedReactions?.length ? '<section class="bioweave-projection-detail-section bioweave-projection-triggered-section"><div class="bioweave-projection-section-title"><h3>已触发</h3><span>' + escapeHtml(group.triggeredCount) + ' 条 · 本轮曾经触发，此前出现过，不代表当前仍持续</span></div><div class="bioweave-projection-triggered-list">' + [...new Set(group.historicalObservedReactions.map(item => item.reaction_label).filter(Boolean))].map(label => '<span class="bioweave-badge good">' + escapeHtml(label) + '</span>').join('') + '</div></section>' : '') +
    '<section class="bioweave-projection-detail-section"><div class="bioweave-projection-section-title"><h3>之后可能出现</h3></div>' +
    laterSection(group) + '</section>' +
    '<section class="bioweave-projection-detail-section"><div class="bioweave-projection-section-title"><h3>最后怎么结束</h3><span>' +
    escapeHtml(finalStage?.label || '以观察周期为准') +
    '</span></div><div class="bioweave-projection-outcomes"><article class="good"><strong>正文明确确认怀孕</strong><p>正文出现明确的怀孕事实，才进入确认阶段。</p></article><article class="end"><strong>超过周期仍无确认</strong><p>本轮结束并按“未怀孕”处理，当前周期的亲密事件不再带入下一轮。</p></article></div></section>' +
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
  projectionStorylineNode = null,
  storylineSnapshots = [],
  pregnancyStatuses = [],
  pregnancyKnowledge = [],
  pregnancyKnowledgePopoverOpen = false,
} = {}) {
  const items = Array.isArray(projections) ? projections : []
  const summary = projectionSummary ?? { active_count: items.filter(item => item.status === 'active').length }
  const schedule = scheduleFor(summary, items)
  const groups = groupProjections(items, trackingSubjects, schedule, summary.historical_observed_reactions ?? [])
  const defaultGroup = groups.find(group => group.triggeredCount > 0) ?? groups[0] ?? null
  const selectedId = groups.some(group => group.id === projectionSubjectId) ? projectionSubjectId : (defaultGroup?.id ?? null)
  const people = groups.map(group => personCard(group, selectedId, pregnancyStatuses)).join('')
  const selectedGroup = groups.find(group => group.id === selectedId) ?? null
  const emptyState = projectionStatus?.state === 'running'
    ? storylineRunningSection()
    : projectionStatus?.state === 'failed'
      ? storylineFailedSection()
      : '<section class="bioweave-card bioweave-empty"><b>当前没有需要展示的推演</b><p>插件会在观察条件满足后自动生成候选路线；推演不是已发生事实。</p></section>'
  return (
    '<section class="bioweave-page bioweave-projection-page" data-bioweave-page="projection"><header class="bioweave-page-head"><div class="bioweave-page-head-copy"><h2>人物推演</h2><p>先选人物，再查看这个人物自己的潜在剧情时间线</p></div><div class="bioweave-page-actions"><span class="bioweave-badge accent">' +
    escapeHtml(groups.length) +
    ' 位人物观察中</span><button type="button" class="bioweave-button" data-bioweave-action="refresh-projection">重新读取</button></div></header>' +
    '<div class="bioweave-projection-notice"><span aria-hidden="true">✦</span><div><strong>每个人单独计算时间</strong><p>人物之间不共用第几天；只有正文明确写出某种表现，才会把它记为已观察到。</p></div></div>' +
    (groups.length
      ? '<div class="bioweave-projection-overview-line"><h2>观察人物</h2><span>点击人物查看详情</span></div><div class="bioweave-projection-workspace"><aside class="bioweave-projection-people-panel"><header class="bioweave-projection-panel-head"><h2>人物列表</h2><span>' +
        escapeHtml(groups.length) +
        ' 人</span></header><div class="bioweave-projection-people-list">' +
        people +
        '</div></aside>' +
        detail(selectedGroup, storylineSnapshots, projectionStatus, projectionStorylineNode, pregnancyStatuses, pregnancyKnowledge, pregnancyKnowledgePopoverOpen) +
        '</div>'
      : emptyState) +
    '</section>'
  )
}
