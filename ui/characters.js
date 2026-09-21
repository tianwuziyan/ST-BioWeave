import { formatStoryTime } from '../story/time.js'
import {
  analysisStatusCount,
  analysisStatusEvents,
  eventStatusTone,
  normalizeAnalysisStatus,
  renderAnalysisActionButton,
  trackingSubjectTone,
} from './overview.js'
import { formatStoryTimeRelative, resolveStoryTimeDifference } from './story-time.js'
import { renderCharacterState } from './character-state.js'
const capabilityLabels = {
  can_produce_sperm: '可产生精子',
  can_produce_ova: '可产生卵子',
  can_be_fertilized: '可受精',
  can_fertilize: '可使对方受精',
  can_carry_pregnancy: '可承载妊娠',
  can_cause_pregnancy: '可导致受孕',
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
  if (Array.isArray(value)) return value.map((item, index) => ({ key: index, value: item }))
  if (value && typeof value === 'object') {
    return Object.entries(value).map(([key, item]) => ({ key, value: item }))
  }
  return []
}
function characterIdOf(value, fallback = '') {
  const id = value?.character_id ?? value?.id ?? fallback
  return String(id ?? '').trim()
}
function subjectEntries(trackingSubjects) {
  return entriesOf(trackingSubjects)
    .map(({ key, value }) => ({ key: characterIdOf(value, key), value }))
    .filter(({ key, value }) => Boolean(key) && value && typeof value === 'object')
}
function profileFor(characterProfiles, characterId) {
  return (
    entriesOf(characterProfiles)
      .map(({ key, value }) => ({ key: characterIdOf(value, key), value }))
      .find(({ key }) => key === characterId)?.value ?? null
  )
}
function eventIdOf(event, fallback = '') {
  return String(event?.event_id ?? fallback ?? '').trim()
}
function eventEntries(activeEvents) {
  return entriesOf(activeEvents)
    .map(({ key, value }) => ({ key: eventIdOf(value, key), value }))
    .filter(({ key, value }) => Boolean(key) && value && typeof value === 'object')
}
function counterpartSummary(event) {
  const ids = Array.isArray(event?.pregnancy_relevance?.counterpart_ids) ? event.pregnancy_relevance.counterpart_ids : []
  if (!ids.length) return '—'
  const participants = new Map(
    (Array.isArray(event?.participants) ? event.participants : []).map(participant => [characterIdOf(participant), participant]),
  )
  return ids
    .map(id => {
      const participant = participants.get(String(id))
      return displayValue(participant?.display_name, '未命名相关对象')
    })
    .join('、')
}
function eventTypeLabel(value) {
  return eventTypeLabels[value] ?? displayValue(value, '生理事件')
}
function eventStatusLabel(value) {
  return eventStatusLabels[value] ?? displayValue(value)
}
function subjectStatusLabel(value) {
  if (value === 'active') return '追踪中'
  if (value === 'inactive') return '已结束'
  return displayValue(value, '追踪中')
}
function renderExposureEvent(event, fallbackEventId, index = 0, currentStoryTime = null, storyTimeDifferences = {}) {
  const eventId = eventIdOf(event, fallbackEventId)
  if (!event) {
    return (
      '<article class="bioweave-card bioweave-character-exposure bioweave-character-exposure-missing" data-bioweave-event-id="' +
      escapeHtml(eventId) +
      '"><div class="bioweave-character-exposure-missing-copy"><b>相关事件</b><span>当前有效事件中未找到该引用。</span></div></article>'
    )
  }
  const type = eventTypeLabel(event.type)
  const date = formatStoryTime(event?.story_time)
  const relative = formatStoryTimeRelative(resolveStoryTimeDifference(storyTimeDifferences, eventId))
  const location = displayValue(event.location)
  const counterpart = counterpartSummary(event)
  const meta = [location, counterpart !== '—' ? counterpart : ''].filter(Boolean).join(' · ') || '—'
  return (
    '<details class="bioweave-card bioweave-character-exposure" data-bioweave-event-id="' +
    escapeHtml(eventId) +
    '" name="bioweave-character-exposures"' +
    (index === 0 ? ' open' : '') +
    '>' +
    '<summary class="bioweave-character-exposure-summary">' +
    '<span class="bioweave-character-exposure-date" title="' +
    escapeHtml(date) +
    '"><span class="bioweave-event-story-time">' +
    escapeHtml(date) +
    '</span>' +
    '</span>' +
    (relative ? '<small class="bioweave-event-relative-time bioweave-character-exposure-relative">' + escapeHtml(relative) + '</small>' : '') +
    '<b class="bioweave-character-exposure-type" title="' +
    escapeHtml(type) +
    '">' +
    escapeHtml(type) +
    '</b>' +
    '<span class="bioweave-character-exposure-meta" title="' +
    escapeHtml(meta) +
    '">' +
    escapeHtml(meta) +
    '</span>' +
    '<span class="bioweave-badge ' +
    eventStatusTone(event.status) +
    '">' +
    escapeHtml(eventStatusLabel(event.status)) +
    '</span>' +
    '<span class="bioweave-character-exposure-chevron" aria-hidden="true">⌄</span></summary>' +
    '<div class="bioweave-character-exposure-detail"><dl class="bioweave-character-exposure-fields">' +
    '<div><dt>日期</dt><dd><span>' +
    escapeHtml(date) +
    '</span>' +
    (relative ? '<small class="bioweave-event-relative-time bioweave-character-exposure-age-inline">' + escapeHtml(relative) + '</small>' : '') +
    '</dd></div>' +
    '<div><dt>地点</dt><dd>' +
    renderValue(event.location) +
    '</dd></div>' +
    '<div><dt>相关对象</dt><dd>' +
    escapeHtml(counterpart) +
    '</dd></div>' +
    '</dl><p class="bioweave-character-exposure-source">完整事实仍来自当前 Event Registry；这里只在人物内展开查看。</p></div></details>'
  )
}
function renderCapabilities(profile) {
  const capabilities = profile?.reproductive_capabilities
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) {
    return '<div class="bioweave-empty bioweave-character-empty">尚无可显示的生殖能力资料。</div>'
  }
  const keys = Object.keys(capabilities).filter(key => Object.prototype.hasOwnProperty.call(capabilityLabels, key))
  if (!keys.length) return '<div class="bioweave-empty bioweave-character-empty">尚无可显示的生殖能力资料。</div>'
  return (
    '<dl class="bioweave-data-list bioweave-capabilities bioweave-character-capabilities">' +
    keys
      .map(
        key =>
          '<div><dt>' +
          escapeHtml(capabilityLabels[key] ?? key) +
          '</dt><dd class="' +
          (capabilities[key] === true ? 'row-value good' : capabilities[key] === null ? 'character-capability-unknown' : '') +
          '">' +
          renderTriState(capabilities[key]) +
          '</dd></div>',
      )
      .join('') +
    '</dl>'
  )
}
function renderCharacterFacts(profile) {
  const biologicalContext = profile?.biological_context ?? {}
  const species = profile?.species ?? biologicalContext.species
  const type = profile?.biological_type ?? profile?.type ?? biologicalContext.biological_type
  return (
    '<div class="bioweave-character-summary-facts" aria-label="人物物种与生理类型">' +
    '<span title="' +
    escapeHtml(displayValue(species)) +
    '">' +
    renderValue(species) +
    '</span>' +
    '<span aria-hidden="true">·</span>' +
    '<span title="' +
    escapeHtml(displayValue(type)) +
    '">' +
    renderValue(type) +
    '</span></div>'
  )
}
function renderExposures(subject, activeEvents, currentStoryTime = null, storyTimeDifferences = {}) {
  const exposureIds = Array.isArray(subject?.exposure_event_ids)
    ? [...new Set(subject.exposure_event_ids.map(value => String(value ?? '').trim()).filter(Boolean))]
    : []
  if (!exposureIds.length) return '<div class="bioweave-empty bioweave-character-empty">当前没有可显示的相关事件。</div>'
  const events = new Map(eventEntries(activeEvents).map(({ key, value }) => [key, value]))
  return (
    '<div class="bioweave-character-exposure-list" aria-label="事件追踪列表">' +
    '<div class="bioweave-character-exposure-list-head"><span>按时间引用顺序</span><strong>' +
    exposureIds.length +
    ' 条记录</strong></div>' +
    exposureIds.map((eventId, index) => renderExposureEvent(events.get(eventId), eventId, index, currentStoryTime, storyTimeDifferences)).join('') +
    '</div>'
  )
}
function renderCharacterSummary({ subject, profile }) {
  const displayName = profile?.display_name ?? subject?.display_name ?? '未命名角色'
  return (
    '<section class="bioweave-card bioweave-character-summary"><header class="bioweave-character-summary-head"><b>' +
    escapeHtml(displayValue(displayName)) +
    '</b><span class="bioweave-character-summary-actions"><button type="button" class="bioweave-button" data-bioweave-action="open-character-aliases" data-character-id="' +
    escapeHtml(characterIdOf(subject)) +
    '">昵称</button><span class="bioweave-badge good">事件追踪</span></span></header>' +
    renderCharacterFacts(profile) +
    '</section>'
  )
}
function renderAliasEditor(aliasEditor, displayName) {
  if (!aliasEditor?.open) return ''
  if (aliasEditor.loading) return '<div class="bioweave-character-alias-editor" role="dialog" aria-label="昵称 / 别名编辑器"><p class="bioweave-muted">正在读取当前 Floor 昵称…</p></div>'
  const aliases = Array.isArray(aliasEditor.draftAliases) ? aliasEditor.draftAliases : []
  return (
    '<div class="bioweave-character-alias-editor" role="dialog" aria-label="昵称 / 别名编辑器">' +
    '<div class="bioweave-character-alias-editor-head"><div><h3>昵称 / 别名</h3><p>用于识别同一人物，不会改变正式名称“' +
    escapeHtml(displayValue(displayName)) +
    '”。</p></div><span class="bioweave-character-alias-count" aria-live="polite">' +
    aliases.length +
    ' 个</span></div>' +
    '<div class="bioweave-character-alias-list">' +
    (aliases.length
      ? aliases.map((alias, index) => '<div class="bioweave-character-alias-row"><label class="bioweave-character-alias-field"><input class="bioweave-input" type="text" value="' + escapeHtml(alias) + '" data-bioweave-alias-input="' + index + '" aria-label="昵称 ' + (index + 1) + '"></label><button type="button" class="bioweave-button bioweave-character-alias-remove" data-bioweave-action="remove-character-alias" data-bioweave-alias-index="' + index + '" aria-label="删除昵称' + escapeHtml(alias) + '" title="删除"' + (aliasEditor.saving ? ' disabled' : '') + '>×</button></div>').join('')
      : '<p class="bioweave-muted">暂无昵称/别名</p>') +
    '</div><div class="bioweave-character-alias-actions"><button type="button" class="bioweave-button bioweave-character-alias-add" data-bioweave-action="add-character-alias"' + (aliasEditor.saving ? ' disabled' : '') + '>＋ 添加昵称</button><span class="bioweave-spacer"></span><button type="button" class="bioweave-button" data-bioweave-action="cancel-character-alias"' + (aliasEditor.saving ? ' disabled' : '') + '>取消</button><button type="button" class="bioweave-button primary" data-bioweave-action="save-character-aliases"' + (aliasEditor.saving ? ' disabled' : '') + '>保存</button></div>' +
    (aliasEditor.error ? '<p class="bioweave-form-error">' + escapeHtml(aliasEditor.error) + '</p>' : '') +
    '</div>'
  )
}
function renderExposuresSection(subject, activeEvents, currentStoryTime = null, storyTimeDifferences = {}) {
  return (
    '<section class="bioweave-card bioweave-character-detail-section bioweave-character-exposure-section"><h3>事件追踪</h3>' +
    '<p class="bioweave-muted">仅显示当前仍在跟进的相关记录。</p>' +
    renderExposures(subject, activeEvents, currentStoryTime, storyTimeDifferences) +
    '</section>'
  )
}
function renderProjectionSection() {
  return (
    '<section class="bioweave-card bioweave-character-detail-section"><h3>推演</h3>' +
    '<div class="bioweave-empty bioweave-character-empty">当前没有可显示的生理推演。推演并非已发生事实。</div></section>'
  )
}
function renderRelationsSection() {
  return (
    '<section class="bioweave-card bioweave-character-detail-section"><h3>关系</h3>' +
    '<div class="bioweave-empty bioweave-character-empty">尚未建立已确认的亲子或其他关系。</div></section>'
  )
}
function renderNotesSection() {
  return (
    '<section class="bioweave-card bioweave-character-detail-section"><h3>备注</h3>' +
    '<div class="bioweave-empty bioweave-character-empty">当前没有可显示的人物备注。</div></section>'
  )
}
function detailPage({ subject, profile, activeEvents, currentStoryTime, storyTimeDifferences, aliasEditor, currentState, currentStateStatus }) {
  const displayName = profile?.display_name ?? subject?.display_name ?? '未命名角色'
  const selectedCharacterId = characterIdOf(subject)
  const characterState = currentState?.characters?.[selectedCharacterId] ?? null
  return (
    '<section class="bioweave-card bioweave-character-detail-pane bioweave-character-detail-enter" data-character-detail-id="' +
    escapeHtml(characterIdOf(subject)) +
    '"><header class="bioweave-character-detail-head"><div><h2>人物详情</h2>' +
    '<p>当前 Chat · 事件追踪</p></div></header>' +
    renderCharacterSummary({ subject, profile }) +
    renderAliasEditor(aliasEditor?.characterId === characterIdOf(subject) ? aliasEditor : null, aliasEditor?.canonicalName ?? displayName) +
    '<div class="bioweave-character-detail-sections"><section class="bioweave-card bioweave-character-detail-section"><h3>生殖能力</h3>' +
    renderCapabilities(profile) +
    '</section>' +
    renderCharacterState({ characterState, currentState, currentStateStatus }) +
    renderExposuresSection(subject, activeEvents, currentStoryTime, storyTimeDifferences) +
    renderProjectionSection() +
    renderRelationsSection() +
    renderNotesSection() +
    '</div></section>'
  )
}
function unavailableDetailPage() {
  return (
    '<section class="bioweave-card bioweave-character-detail-pane bioweave-character-detail-placeholder">' +
    '<div><strong>当前没有可追踪的角色详情。</strong><p>请从当前 Chat 的人物列表进入可追踪角色。</p></div>' +
    '</section>'
  )
}
export function charactersPage({ characterId = null, trackingSubjects = [], characterProfiles = {}, activeEvents = [], analysisStatus = null, currentState = null, currentStateStatus = 'NO_CHARACTER_FLOOR', currentStoryTime = null, currentStoryTimeDifferences = {}, aliasEditor = null } = {}) {
  const status = normalizeAnalysisStatus(analysisStatus)
  const subjects = subjectEntries(trackingSubjects)
  const effectiveEvents = analysisStatusEvents(status, activeEvents, 'active_events')
  const rows = subjects
    .map(({ key, value: subject }) => {
      const displayName = subject.display_name ?? '未命名角色'
      const exposureCount = Array.isArray(subject.exposure_event_ids) ? subject.exposure_event_ids.length : 0
      const selected = String(characterId ?? '') === key
      return (
        '<button type="button" class="bioweave-card bioweave-character-row' +
        (selected ? ' selected' : '') +
        '" data-character-id="' +
        escapeHtml(key) +
        '"><span class="bioweave-character-row-main"><b>' +
        escapeHtml(displayValue(displayName)) +
        '</b></span><span class="bioweave-character-row-state"><span class="bioweave-badge ' +
        trackingSubjectTone(subject.status) +
        '">' +
        escapeHtml(subjectStatusLabel(subject.status)) +
        '</span><span>' +
        exposureCount +
        ' 次相关事件</span><span class="bioweave-character-row-chevron" aria-hidden="true">›</span></span></button>'
      )
    })
    .join('')
  const emptyState =
    status.state === 'not_analyzed'
      ? '<div class="bioweave-card bioweave-empty"><b>尚未完成事件分析。</b>' + '<p>完成当前楼层分析后，符合追踪条件的角色会显示在这里。</p></div>'
      : status.state === 'running'
        ? '<div class="bioweave-card bioweave-empty"><b>当前楼层正在分析中。</b>' +
          '<p>分析完成后将更新 BiologicalEvent 与 Tracking Subject。</p></div>'
        : status.state === 'cancelled'
          ? '<div class="bioweave-card bioweave-empty"><b>本次事件分析已取消。</b>' +
            '<p>现有 Tracking Subject 与历史事件仍然保留，可重新分析当前楼层。</p></div>'
          : status.state === 'failed'
            ? '<div class="bioweave-card bioweave-empty"><b>当前楼层事件分析失败。</b>' + '<p>请稍后重试。如有旧的成功事件，它们仍然有效。</p></div>'
            : '<div class="bioweave-card bioweave-empty"><b>当前没有需要事件追踪的角色。</b>' +
              '<p>当前没有进入 Tracking Subject Registry 的角色。</p>' +
              '<dl class="bioweave-data-list bioweave-tracking-counts">' +
              '<div><dt>当前有效事件</dt><dd>' +
              analysisStatusCount(status, 'active_event_count', 0) +
              '</dd></div>' +
              '<div><dt>亲密互动事件</dt><dd>' +
              analysisStatusCount(status, 'sexual_activity_count', 0) +
              '</dd></div>' +
              '<div><dt>事件追踪人物</dt><dd>' +
              analysisStatusCount(status, 'tracking_subject_count', 0) +
              '</dd></div>' +
              '</dl></div>'
  const selectedId = String(characterId ?? '').trim()
  const selectedSubject = subjects.find(item => item.key === selectedId)?.value
  const detail = selectedId
    ? selectedSubject
      ? detailPage({ subject: selectedSubject, profile: profileFor(characterProfiles, selectedId), activeEvents: effectiveEvents, currentStoryTime, storyTimeDifferences: currentStoryTimeDifferences, aliasEditor, currentState, currentStateStatus })
      : unavailableDetailPage()
    : '<section class="bioweave-card bioweave-character-detail-pane bioweave-character-detail-placeholder"><div><strong>选择一个人物查看详情</strong><p>详情会在当前页面展开，不需要离开人物列表。</p></div></section>'
  if (selectedId && !subjects.length) {
    return (
      '<section class="bioweave-page bioweave-characters-page" data-bioweave-page="characters"><div class="bioweave-page-title bioweave-page-head"><div><h2>人物列表</h2>' +
      '<p class="bioweave-muted">当前 Chat 中已进入事件追踪流程的角色</p></div></div>' +
      detail +
      '</section>'
    )
  }
  return (
    '<section class="bioweave-page bioweave-characters-page" data-bioweave-page="characters"><div class="bioweave-page-title bioweave-page-head"><div><h2>人物列表</h2>' +
    '<p class="bioweave-muted">当前 Chat 中已进入事件追踪流程的角色</p></div>' +
    '<div class="bioweave-page-actions">' +
    renderAnalysisActionButton(status) +
    '</div></div>' +
    (subjects.length
      ? '<div class="bioweave-toolbar"><input class="bioweave-input" placeholder="搜索人物……" aria-label="搜索人物">' +
        '<button class="bioweave-button" type="button">全部状态 ▾</button></div>' +
        '<div class="bioweave-character-workspace"><section class="bioweave-character-list-pane"><div class="bioweave-character-pane-head"><strong>追踪人物</strong><span>' +
        subjects.length +
        ' 人</span></div><div class="bioweave-character-list">' +
        rows +
        '</div></section>' +
        detail +
        '</div>'
      : emptyState) +
    '</section>'
  )
}
