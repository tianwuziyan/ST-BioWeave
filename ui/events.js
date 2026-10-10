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

export function focusEventById(eventId, documentRef = globalThis.document) {
  const normalizedId = String(eventId ?? '').trim()
  if (!normalizedId || typeof documentRef?.querySelectorAll !== 'function') {
    return {ok: false, reason: 'INVALID_EVENT_ID'}
  }
  const target = [...documentRef.querySelectorAll('[data-bioweave-event-id]')].find(
    node => String(node?.dataset?.bioweaveEventId ?? '').trim() === normalizedId,
  )
  if (!target) return {ok: false, reason: 'EVENT_NOT_FOUND', event_id: normalizedId}
  if ('open' in target) target.open = true
  target.classList?.add?.('bioweave-event-source-focus')
  target.scrollIntoView?.({behavior: 'smooth', block: 'center'})
  const timer = documentRef?.defaultView?.setTimeout ?? globalThis.setTimeout
  if (typeof timer === 'function') timer(() => target.classList?.remove?.('bioweave-event-source-focus'), 1400)
  return {ok: true, event_id: normalizedId}
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

function stateFactSubjectId(event) {
  if (event?.pregnancy_relevance?.relevant === true) return ''
  return String(event?.state_fact?.subject_id ?? '').trim()
}

function stateFactSubjectName(event, currentState = null) {
  const subjectId = stateFactSubjectId(event)
  if (!subjectId) return ''
  const displayName = currentState?.characters?.[subjectId]?.identity?.display_name
  return typeof displayName === 'string' && displayName.trim() ? displayName.trim() : '未命名事实人物'
}

function eventTypeLabel(value) {
  return eventTypeLabels[value] ?? displayValue(value, '生理事件')
}

function eventStatusLabel(value) {
  return eventStatusLabels[value] ?? displayValue(value)
}

function eventReviewPeople(event, currentState = null) {
  const relevance = event?.pregnancy_relevance
  const ids = [
    ...(Array.isArray(relevance?.gestational_subject_ids) ? relevance.gestational_subject_ids : []),
    ...(Array.isArray(relevance?.counterpart_ids) ? relevance.counterpart_ids : []),
  ]
    .map(value => String(value ?? '').trim())
    .filter(Boolean)
  if (!ids.length) {
    const subjectName = stateFactSubjectName(event, currentState)
    return subjectName ? `事实归属：${subjectName}` : '未关联追踪人物'
  }
  const participants = new Map(
    (Array.isArray(event?.participants) ? event.participants : []).map(participant => [String(participant?.character_id ?? ''), participant]),
  )
  return [...new Set(ids)].map(id => displayValue(participants.get(id)?.display_name, '未命名对象')).join(' · ')
}

function eventReviewCount(event) {
  const ids = event?.pregnancy_relevance?.gestational_subject_ids
  return Array.isArray(ids) && ids.length ? `${ids.length} 个追踪对象` : '仅作事件索引'
}

function renderPregnancyRelevance(event, currentState = null, edit = null) {
  const relevance = event?.pregnancy_relevance
  if (!relevance || typeof relevance !== 'object') {
    return '<div class="bioweave-empty">—</div>'
  }
  const values = edit?.values?.pregnancy_relevance ?? relevance
  const personOptions = edit?.personOptions ?? []
  const valueOrControl = (field, value, control) => edit ? `__html__${control}` : `__html__${renderTriState(value)}`
  const rows = [
      ['与妊娠相关', valueOrControl('relevant', relevance.relevant, renderBooleanSelect('relevant', values.relevant))],
      ['存在受孕可能', valueOrControl('possible_conception', relevance.possible_conception, renderBooleanSelect('possible_conception', values.possible_conception))],
      ['妊娠追踪对象', edit ? `__html__${renderCharacterPicker('gestational_subject_ids', values.gestational_subject_ids, personOptions)}` : `__html__${participantNamesForIds(event, relevance.gestational_subject_ids)}`],
      ['相关对象', edit ? `__html__${renderCharacterPicker('counterpart_ids', values.counterpart_ids, personOptions)}` : `__html__${participantNamesForIds(event, relevance.counterpart_ids)}`],
      ['判断置信度', `__html__${renderValue(relevance.confidence)}`],
    ]
  const subjectName = stateFactSubjectName(event, currentState)
  if (subjectName) rows.unshift(['事实归属', `__html__${escapeHtml(subjectName)}`])
  return renderDefinitionList(
    rows,
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

function eventEditDraftFor(event, draft = null) {
  const relevance = draft?.pregnancy_relevance ?? event?.pregnancy_relevance ?? {}
  return {
    type: draft?.type ?? event?.type ?? '',
    status: draft?.status ?? event?.status ?? '',
    location: draft?.location ?? event?.location ?? '',
    story_time: draft?.story_time ?? event?.story_time?.display ?? '',
    pregnancy_relevance: {
      ...relevance,
      relevant: relevance.relevant ?? null,
      possible_conception: relevance.possible_conception ?? null,
      gestational_subject_ids: Array.isArray(relevance.gestational_subject_ids) ? relevance.gestational_subject_ids : [],
      counterpart_ids: Array.isArray(relevance.counterpart_ids) ? relevance.counterpart_ids : [],
    },
  }
}

function eventCharacterOptions(event, characterProfiles = {}, trackingSubjects = {}) {
  const options = new Map()
  for (const [id, profile] of Object.entries(characterProfiles ?? {})) {
    const identity = profile?.identity ?? profile
    options.set(String(id), displayValue(identity?.display_name ?? profile?.display_name, '未命名对象'))
  }
  for (const [id, subject] of Object.entries(trackingSubjects ?? {})) {
    options.set(String(id), displayValue(subject?.display_name, options.get(String(id)) ?? '未命名对象'))
  }
  for (const participant of Array.isArray(event?.participants) ? event.participants : []) {
    const id = String(participant?.character_id ?? '').trim()
    if (id && !options.has(id)) options.set(id, displayValue(participant?.display_name, '历史人物'))
  }
  return [...options.entries()].filter(([id]) => id)
}

function renderBooleanSelect(field, value) {
  const current = value === true ? 'true' : value === false ? 'false' : 'null'
  return '<select class="bioweave-select" data-bioweave-event-field="' + field + '" aria-label="' + escapeHtml(field) + '">' +
    [['true', '是'], ['false', '否'], ['null', '未知']].map(([key, label]) => '<option value="' + key + '"' + (current === key ? ' selected' : '') + '>' + label + '</option>').join('') +
    '</select>'
}

function renderCharacterPicker(field, selectedIds, options) {
  const selected = new Set((Array.isArray(selectedIds) ? selectedIds : []).map(id => String(id)))
  const normalizedOptions = [...options]
  for (const id of selected) {
    if (!normalizedOptions.some(([optionId]) => optionId === id)) normalizedOptions.push([id, '历史人物'])
  }
  const selectedLabels = normalizedOptions.filter(([id]) => selected.has(id)).map(([, label]) => label)
  const summary = selectedLabels.length > 1 ? `已选 ${selectedLabels.length} 人：${selectedLabels.join('、')}` : selectedLabels[0] ?? '未选择'
  return '<details class="bioweave-event-person-picker" data-bioweave-event-field="' + field + '"><summary class="bioweave-event-person-picker-summary"><span class="bioweave-event-person-picker-selected">' + escapeHtml(summary) + '</span><span aria-hidden="true">⌄</span></summary><div class="bioweave-event-person-picker-menu" role="listbox" aria-label="' + escapeHtml(field) + '">' +
    '<label class="bioweave-event-person-option"><input class="bioweave-checkbox" type="checkbox" data-bioweave-event-person-option="" value=""' + (!selected.size ? ' checked' : '') + ' /><span>未选择</span></label>' +
    normalizedOptions.map(([id, label]) => '<label class="bioweave-event-person-option"><input class="bioweave-checkbox" type="checkbox" data-bioweave-event-person-option="' + escapeHtml(id) + '" value="' + escapeHtml(id) + '"' + (selected.has(id) ? ' checked' : '') + ' /><span>' + escapeHtml(label) + '</span></label>').join('') +
    '</div></details>'
}

function renderEventFactStrip(event, mode = 'view', values = null) {
  const time = formatStoryTime(event?.story_time)
  const location = displayValue(event?.location)
  const confidence = event?.pregnancy_relevance?.confidence ?? event?.confidence
  const value = (label, content) => '<div class="bioweave-event-fact"><span>' + label + '</span>' + content + '</div>'
  return '<div class="bioweave-event-fact-strip">' +
    value('发生时间', mode === 'edit' ? '<input class="bioweave-input" data-bioweave-event-field="story_time" type="text" value="' + escapeHtml(values.story_time) + '" aria-label="发生时间" autocomplete="off" />' : '<strong>' + renderValue(time) + '</strong>') +
    value('地点', mode === 'edit' ? '<input class="bioweave-input" data-bioweave-event-field="location" type="text" value="' + escapeHtml(displayValue(values.location, '')) + '" aria-label="地点" />' : '<strong>' + renderValue(location) + '</strong>') +
    value('判断置信度', '<strong>' + renderValue(confidence) + '</strong>') +
    '</div>'
}

function renderEventDetailBody(event, mode = 'view', currentState = null, values = null, characterProfiles = {}, trackingSubjects = {}) {
  const edit = mode === 'edit'
  const personOptions = edit ? eventCharacterOptions(event, characterProfiles, trackingSubjects) : []
  return renderEventFactStrip(event, mode, values) +
    '<div class="bioweave-event-detail-grid"><section class="bioweave-event-detail-section" data-bioweave-event-field="pregnancy_relevance"><h4>妊娠相关性</h4>' +
    renderPregnancyRelevance(event, currentState, edit ? {values, personOptions} : null) +
    '</section><section class="bioweave-event-detail-section" data-bioweave-event-field="source_evidence"><h4>事件证据</h4>' +
    renderEvidence(event) + '</section></div>'
}

function renderEventEditDetails(event, values, currentState, characterProfiles, trackingSubjects) {
  return renderEventDetailBody(event, 'edit', currentState, values, characterProfiles, trackingSubjects)
}

function renderEventEditMetaControls(values) {
  const typeOptions = Object.entries(eventTypeLabels).map(([type, label]) => '<option value="' + type + '"' + (values.type === type ? ' selected' : '') + '>' + escapeHtml(label) + '</option>').join('')
  const statusOptions = eventStatuses.map(status => '<option value="' + status + '"' + (values.status === status ? ' selected' : '') + '>' + escapeHtml(eventStatusLabel(status)) + '</option>').join('')
  return '<label>事件类型<select class="bioweave-select" data-bioweave-event-field="type" aria-label="事件类型">' + typeOptions + '</select></label><label>事件状态<select class="bioweave-select" data-bioweave-event-field="status" aria-label="事件状态">' + statusOptions + '</select></label>'
}

function renderEventSummary(event, currentState = null, storyTimeDifferences = {}) {
  const time = formatStoryTime(event?.story_time)
  const relative = formatStoryTimeRelative(resolveStoryTimeDifference(storyTimeDifferences, eventIdOf(event)))
  return '<summary class="bioweave-event-review-row">' +
    '<span class="bioweave-event-review-time" title="' + escapeHtml(time) + '"><b class="bioweave-event-story-time">' + escapeHtml(time) + '</b>' + (relative ? '<small class="bioweave-event-relative-time bioweave-event-review-relative">' + escapeHtml(relative) + '</small>' : '') + '</span>' +
    '<span class="bioweave-event-review-main"><b class="bioweave-event-review-type">' + escapeHtml(eventTypeLabel(event.type)) + '</b><small class="bioweave-event-review-meta">' + escapeHtml(displayValue(event.location)) + ' · ' + escapeHtml(eventReviewPeople(event, currentState)) + '</small><span class="bioweave-event-review-detail">' + escapeHtml(eventReviewCount(event)) + '</span></span>' +
    '<span class="bioweave-badge ' + eventStatusTone(event.status) + '">' + escapeHtml(eventStatusLabel(event.status)) + '</span><span class="bioweave-event-review-chevron" aria-hidden="true">⌄</span></summary>'
}

function renderEventEditCard(event, draft = null, currentState = null, saving = false, characterProfiles = {}, trackingSubjects = {}, storyTimeDifferences = {}) {
  const eventId = eventIdOf(event)
  const values = eventEditDraftFor(event, draft)
  return (
    '<details class="bioweave-card bioweave-event-card bioweave-event-review-item bioweave-event-form" data-bioweave-event-form data-bioweave-event-id="' +
    escapeHtml(eventId) + '" open>' + renderEventSummary(event, currentState, storyTimeDifferences) + '<div class="bioweave-event-review-detail-panel bioweave-event-detail-panel-edit">' +
    renderEventEditDetails(event, values, currentState, characterProfiles, trackingSubjects) + '<div class="bioweave-event-detail-actions bioweave-event-detail-actions-edit"><div class="bioweave-event-edit-meta-controls" aria-label="事件类型和状态编辑">' + renderEventEditMetaControls(values) + '</div><div class="bioweave-event-edit-meta-actions"><button type="button" class="bioweave-primary-action" data-bioweave-action="save-event" data-bioweave-event-id="' +
    escapeHtml(eventId) +
    '"' + (saving ? ' disabled aria-busy="true"' : '') + '>保存</button><button type="button" class="bioweave-secondary-action" data-bioweave-action="cancel-event-edit" data-bioweave-event-id="' +
    escapeHtml(eventId) +
    '"' + (saving ? ' disabled' : '') + '>取消</button></div></div></div></details>'
  )
}

function renderEventCard(event, editingEventId, currentStoryTime = null, storyTimeDifferences = {}, currentState = null, eventEditDraft = null, eventEditSaving = false, characterProfiles = {}, trackingSubjects = {}) {
  const eventId = eventIdOf(event)
  const open = editingEventId === eventId
  if (open) return renderEventEditCard(event, eventEditDraft, currentState, eventEditSaving, characterProfiles, trackingSubjects, storyTimeDifferences)
  const type = eventTypeLabel(event.type)
  const time = formatStoryTime(event?.story_time)
  const relative = formatStoryTimeRelative(resolveStoryTimeDifference(storyTimeDifferences, eventId))
  const people = eventReviewPeople(event, currentState)
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
    '</summary><div class="bioweave-event-review-detail-panel">' +
    renderEventDetailBody(event, 'view', currentState) +
    '<div class="bioweave-event-detail-actions"><button type="button" class="bioweave-secondary-action" data-bioweave-action="edit-event" data-bioweave-event-id="' +
    escapeHtml(eventId) +
    '">编辑事件</button><button type="button" class="bioweave-danger-action" data-bioweave-action="delete-event" data-bioweave-event-id="' +
    escapeHtml(eventId) +
    '">删除事件</button></div>' +
    '</div></details>'
  )
}

export function eventsPage({ activeEvents, events, editingEventId = null, eventEditDraft = null, eventEditSaving = false, analysisStatus = null, currentStoryTime = null, currentStoryTimeDifferences = {}, currentState = null, characterProfiles = {}, trackingSubjects = {} } = {}) {
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
  const cards = visibleEvents.map(event => renderEventCard(event, editingEventId, currentStoryTime, currentStoryTimeDifferences, currentState, eventEditDraft, eventEditSaving, characterProfiles, trackingSubjects)).join('')
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
