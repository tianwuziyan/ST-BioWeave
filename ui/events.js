import { formatStoryTime } from '../story/time.js'
import { analysisStatusCount, analysisStatusEvents, eventStatusTone, normalizeAnalysisStatus, renderAnalysisActionButton } from './overview.js'
import { formatStoryTimeRelative, resolveStoryTimeDifference } from './story-time.js'

const eventStatuses = ['confirmed', 'probable', 'ambiguous', 'negated', 'fictional']
let eventFilter = 'all'

export function setEventFilter(value = 'all') {
  eventFilter = eventStatuses.includes(String(value)) ? String(value) : 'all'
}

const eventTypeLabels = {
  sexual_activity: '亲密互动',
  conception: '受孕事件',
  pregnancy_suspicion: '妊娠疑似',
  pregnancy_confirmation: '妊娠确认',
  pregnancy_loss: '妊娠终止',
  abortion: '人工流产',
  labor: '分娩过程',
  delivery: '分娩',
  postpartum: '产后事件',
  menstrual_event: '月经事件',
  ovulation_event: '排卵事件',
  fertility_change: '生育能力变化',
  physical_symptom: '身体症状',
  medical_event: '医疗事件',
  other_biological: '其他生理事件',
}

const eventStatusLabels = {
  confirmed: '已确认',
  probable: '较可能',
  ambiguous: '有歧义',
  negated: '已否定',
  fictional: '虚构',
}

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    character =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character],
  )
}

function displayValue(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback
  if (typeof value === 'object') {
    if (typeof value.name === 'string' && value.name) return value.name
    try {
      return JSON.stringify(value)
    } catch {
      return fallback
    }
  }
  return String(value)
}

function renderValue(value, fallback = '—') {
  return escapeHtml(displayValue(value, fallback))
}

function renderTriState(value) {
  if (value === true) return '是'
  if (value === false) return '否'
  if (value === null) return '未知'
  return renderValue(value)
}

function entriesOf(value) {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') return Object.values(value)
  return []
}

function eventIdOf(event, fallback = '') {
  return String(event?.event_id ?? fallback ?? '').trim()
}

function renderDefinitionList(rows, className = '') {
  return (
    '<dl class="bioweave-data-list ' +
    escapeHtml(className) +
    '">' +
    rows
      .map(
        ([label, value]) =>
          '<div><dt>' +
          escapeHtml(label) +
          '</dt><dd>' +
          (typeof value === 'string' && value.startsWith('__html__') ? value.slice(8) : renderValue(value)) +
          '</dd></div>',
      )
      .join('') +
    '</dl>'
  )
}

function participantNamesForIds(event, value) {
  if (!Array.isArray(value) || !value.length) return '—'
  const participants = new Map(
    (Array.isArray(event?.participants) ? event.participants : []).map(participant => [String(participant?.character_id ?? ''), participant]),
  )
  return value.map(id => escapeHtml(displayValue(participants.get(String(id))?.display_name, '未命名对象'))).join('、')
}

function eventTypeLabel(value) {
  return eventTypeLabels[value] ?? displayValue(value, '生理事件')
}

function eventStatusLabel(value) {
  return eventStatusLabels[value] ?? displayValue(value)
}

function eventReviewPeople(event) {
  const relevance = event?.pregnancy_relevance
  const ids = [
    ...(Array.isArray(relevance?.gestational_subject_ids) ? relevance.gestational_subject_ids : []),
    ...(Array.isArray(relevance?.counterpart_ids) ? relevance.counterpart_ids : []),
  ]
    .map(value => String(value ?? '').trim())
    .filter(Boolean)
  if (!ids.length) return '未关联追踪人物'
  const participants = new Map(
    (Array.isArray(event?.participants) ? event.participants : []).map(participant => [String(participant?.character_id ?? ''), participant]),
  )
  return [...new Set(ids)].map(id => displayValue(participants.get(id)?.display_name, '未命名对象')).join(' · ')
}

function eventReviewCount(event) {
  const ids = event?.pregnancy_relevance?.gestational_subject_ids
  return Array.isArray(ids) && ids.length ? `${ids.length} 个追踪对象` : '仅作事件索引'
}

function renderPregnancyRelevance(event) {
  const relevance = event?.pregnancy_relevance
  if (!relevance || typeof relevance !== 'object') {
    return '<div class="bioweave-empty">—</div>'
  }
  return renderDefinitionList(
    [
      ['与妊娠相关', `__html__${renderTriState(relevance.relevant)}`],
      ['存在受孕可能', `__html__${renderTriState(relevance.possible_conception)}`],
      ['妊娠追踪对象', `__html__${participantNamesForIds(event, relevance.gestational_subject_ids)}`],
      ['相关对象', `__html__${participantNamesForIds(event, relevance.counterpart_ids)}`],
      ['判断置信度', `__html__${renderValue(relevance.confidence)}`],
    ],
    'bioweave-pregnancy-relevance',
  )
}

function renderEvidence(event) {
  const evidence = Array.isArray(event?.source_evidence) ? event.source_evidence : []
  if (!evidence.length) return '<div class="bioweave-empty">无事件证据。</div>'
  return (
    '<ul class="bioweave-event-evidence">' +
    evidence.map(item => '<li>' + escapeHtml(displayValue(typeof item === 'string' ? item : item?.text, '未提供证据文本')) + '</li>').join('') +
    '</ul>'
  )
}

function renderEditForm(event) {
  const eventId = eventIdOf(event)
  const jsonValue = value => escapeHtml(JSON.stringify(value ?? null, null, 2))
  return (
    '<form class="bioweave-card bioweave-event-form" data-bioweave-event-form data-bioweave-event-id="' +
    escapeHtml(eventId) +
    '"><h3>编辑当前有效事件</h3>' +
    '<p class="bioweave-muted">事件 ID 为只读；保存由当前页面处理。</p>' +
    '<div class="bioweave-event-form-grid"><label>事件 ID<input class="bioweave-input" data-bioweave-event-field="event_id" value="' +
    escapeHtml(eventId) +
    '" readonly></label>' +
    '<label>类型<input class="bioweave-input" data-bioweave-event-field="type" value="' +
    escapeHtml(displayValue(event.type, '')) +
    '" /></label>' +
    '<label>状态<select class="bioweave-select" data-bioweave-event-field="status">' +
    eventStatuses
      .map(status => '<option value="' + status + '"' + (event.status === status ? ' selected' : '') + '>' + status + '</option>')
      .join('') +
    '</select></label>' +
    '<label>地点<input class="bioweave-input" data-bioweave-event-field="location" value="' +
    escapeHtml(displayValue(event.location, '')) +
    '" /></label>' +
    '<label class="full">剧情时间<textarea class="bioweave-input" data-bioweave-event-field="story_time">' +
    jsonValue(event.story_time) +
    '</textarea></label>' +
    '<label class="full">参与者 / 角色<textarea class="bioweave-input" data-bioweave-event-field="participants">' +
    jsonValue(event.participants) +
    '</textarea></label>' +
    '<label class="full">妊娠相关性<textarea class="bioweave-input" data-bioweave-event-field="pregnancy_relevance">' +
    jsonValue(event.pregnancy_relevance) +
    '</textarea></label>' +
    '<label class="full">事件证据<textarea class="bioweave-input" data-bioweave-event-field="source_evidence">' +
    jsonValue(event.source_evidence) +
    '</textarea></label></div><div class="bioweave-event-detail-actions"><button type="button" class="bioweave-primary-action" data-bioweave-action="save-event" data-bioweave-event-id="' +
    escapeHtml(eventId) +
    '">保存事件</button><button type="button" class="bioweave-secondary-action" data-bioweave-action="cancel-event-edit" data-bioweave-event-id="' +
    escapeHtml(eventId) +
    '">取消</button></div></form>'
  )
}

function renderEventCard(event, editingEventId, currentStoryTime = null, storyTimeDifferences = {}) {
  const eventId = eventIdOf(event)
  const confidence = event?.pregnancy_relevance?.confidence ?? event?.confidence
  const open = editingEventId === eventId
  const type = eventTypeLabel(event.type)
  const time = formatStoryTime(event?.story_time)
  const relative = formatStoryTimeRelative(resolveStoryTimeDifference(storyTimeDifferences, eventId))
  const people = eventReviewPeople(event)
  return (
    '<details class="bioweave-card bioweave-event-card bioweave-event-review-item" data-bioweave-event-id="' +
    escapeHtml(eventId) +
    '"' +
    (open ? ' open' : '') +
    '><summary class="bioweave-event-review-row">' +
    '<span class="bioweave-event-review-time" title="' +
    escapeHtml(time) +
    '"><b class="bioweave-event-story-time">' +
    escapeHtml(time) +
    '</b>' +
    (relative ? '<small class="bioweave-event-relative-time bioweave-event-review-relative">' + escapeHtml(relative) + '</small>' : '') +
    '</span>' +
    '<span class="bioweave-event-review-main"><b class="bioweave-event-review-type">' +
    escapeHtml(type) +
    '</b><small class="bioweave-event-review-meta">' +
    escapeHtml(displayValue(event.location)) +
    ' · ' +
    escapeHtml(people) +
    '</small><span class="bioweave-event-review-detail">' +
    escapeHtml(eventReviewCount(event)) +
    '</span></span>' +
    '<span class="bioweave-badge ' +
    eventStatusTone(event.status) +
    '">' +
    escapeHtml(eventStatusLabel(event.status)) +
    '</span><span class="bioweave-event-review-chevron" aria-hidden="true">⌄</span>' +
    '</summary><div class="bioweave-event-review-detail-panel"><div class="bioweave-event-fact-strip">' +
    '<div class="bioweave-event-fact"><span>发生时间</span><strong>' + renderValue(time) + '</strong></div>' +
    '<div class="bioweave-event-fact"><span>地点</span><strong>' + renderValue(event.location) + '</strong></div>' +
    '<div class="bioweave-event-fact"><span>判断置信度</span><strong>' + renderValue(confidence) + '</strong></div>' +
    '</div><div class="bioweave-event-detail-grid"><section class="bioweave-event-detail-section"><h4>妊娠相关性</h4>' +
    renderPregnancyRelevance(event) +
    '</section><section class="bioweave-event-detail-section"><h4>事件证据</h4>' +
    renderEvidence(event) +
    '</section></div>' +
    '<div class="bioweave-event-detail-actions"><button type="button" class="bioweave-secondary-action" data-bioweave-action="edit-event" data-bioweave-event-id="' +
    escapeHtml(eventId) +
    '">编辑事件</button><button type="button" class="bioweave-danger-action" data-bioweave-action="delete-event" data-bioweave-event-id="' +
    escapeHtml(eventId) +
    '">删除事件</button></div>' +
    (open ? renderEditForm(event) : '') +
    '</div></details>'
  )
}

export function eventsPage({ activeEvents, events, editingEventId = null, analysisStatus = null, currentStoryTime = null, currentStoryTimeDifferences = {} } = {}) {
  const status = normalizeAnalysisStatus(analysisStatus)
  const fallbackEvents = Array.isArray(activeEvents) ? activeEvents : entriesOf(events)
  const biologicalEvents = analysisStatusEvents(status, fallbackEvents, 'active_events')
  const normalizedFilter = eventStatuses.includes(eventFilter) ? eventFilter : 'all'
  const visibleEvents = normalizedFilter === 'all' ? biologicalEvents : biologicalEvents.filter(event => event?.status === normalizedFilter)
  const emptyCopy =
    status.state === 'success'
      ? '当前楼层已完成分析，但没有识别到 BiologicalEvent。'
      : status.state === 'running'
        ? '当前楼层正在分析，暂时没有可显示的 BiologicalEvent。'
        : status.state === 'cancelled'
          ? '本次楼层分析已取消；现有历史事件仍然保留。'
          : status.state === 'failed'
            ? '当前楼层分析失败，尚无可显示的 BiologicalEvent。'
            : '当前 Chat 尚无 BiologicalEvent。'
  const filteredEmptyCopy = biologicalEvents.length && !visibleEvents.length ? '当前筛选条件下没有可显示的 BiologicalEvent。' : emptyCopy
  const currentFloorNotice =
    status.state === 'success' && analysisStatusCount(status, 'event_count', biologicalEvents.length) === 0
      ? '<p class="bioweave-muted">当前楼层已完成分析，但没有识别到 BiologicalEvent。下方保留当前 Chat 的历史事件。</p>'
      : status.state === 'cancelled' && biologicalEvents.length
        ? '<p class="bioweave-muted">本次楼层分析已取消；下方保留当前 Chat 的历史事件。</p>'
        : status.state === 'not_analyzed' && biologicalEvents.length
          ? '<p class="bioweave-muted">当前楼层尚未完成分析；下方为当前 Chat 已保存的历史事件。</p>'
          : ''
  const cards = visibleEvents.map(event => renderEventCard(event, editingEventId, currentStoryTime, currentStoryTimeDifferences)).join('')
  const firstSubjectId =
    visibleEvents
      .flatMap(event => (Array.isArray(event?.pregnancy_relevance?.gestational_subject_ids) ? event.pregnancy_relevance.gestational_subject_ids : []))
      .map(value => String(value ?? '').trim())
      .find(Boolean) ?? ''
  const filterOptions = ['all', ...eventStatuses]
    .map(
      value =>
        '<option value="' +
        value +
        '"' +
        (value === normalizedFilter ? ' selected' : '') +
        '>' +
        escapeHtml(value === 'all' ? '全部' : eventStatusLabel(value)) +
        '</option>',
    )
    .join('')
  return (
    '<section class="bioweave-page bioweave-events-page" data-bioweave-page="events"><div class="bioweave-page-title bioweave-page-head"><div><h2>事件审阅</h2>' +
    '<p class="bioweave-muted">全局只保留快速索引；完整记录在对应人物内查看</p></div>' +
    '<div class="bioweave-page-actions">' +
    renderAnalysisActionButton(status) +
    '</div></div>' +
    currentFloorNotice +
    '<section class="bioweave-card bioweave-event-review-panel"><div class="bioweave-section-head"><div><h3>当前事件索引</h3><p>按日期快速定位；不在这里堆叠所有人物上下文</p></div><label class="bioweave-field-inline">状态<select class="bioweave-select" data-bioweave-event-filter>' +
    filterOptions +
    '</select></label></div>' +
    '<div class="bioweave-event-review-summary"><strong>' +
    visibleEvents.length +
    ' 条</strong><span>当前筛选结果 · 详情按人物归属展开</span></div>' +
    (visibleEvents.length
      ? '<div class="bioweave-event-review-list" aria-label="当前事件索引">' + cards + '</div>'
      : '<section class="bioweave-card bioweave-empty"><b>' +
        filteredEmptyCopy +
        '</b>' +
        '<p>完成当前楼层分析后，已解析的事件详情会显示在这里。</p></section>') +
    '<div class="bioweave-event-review-foot"><span>事件会在对应人物卡的事件追踪内按引用顺序展开，失效后由业务层移除。</span>' +
    (firstSubjectId
      ? '<button class="bioweave-text-button" type="button" data-character-id="' + escapeHtml(firstSubjectId) + '">查看人物记录 →</button>'
      : '') +
    '</div></section></section>'
  )
}
