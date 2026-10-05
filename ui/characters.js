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
  can_produce_sperm: '产生精子',
  can_produce_ova: '产生卵子',
  can_fertilize: '使对方受精',
  can_be_fertilized: '自身可受精',
  can_cause_pregnancy: '使对方妊娠',
  can_carry_pregnancy: '可承载妊娠',
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
const WORLD_ANALYSIS_PHASES = new Set(['world_full', 'world_patch', 'world_readback', 'world_ui_ready'])
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
    '</dl></div></details>'
  )
}
function renderCapabilities(profile) {
  const capabilities = profile?.reproductive_capabilities
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) {
    return '<div class="bioweave-empty bioweave-character-empty">尚无可显示的生殖能力资料。</div>'
  }
  const keys = Object.keys(capabilityLabels).filter(key => Object.prototype.hasOwnProperty.call(capabilities, key))
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
    exposureIds.map((eventId, index) => renderExposureEvent(events.get(eventId), eventId, index, currentStoryTime, storyTimeDifferences)).join('') +
    '</div>'
  )
}
function renderAliasEditor(aliasEditor, displayName) {
  if (!aliasEditor?.open) return ''
  if (aliasEditor.loading)
    return '<section class="bioweave-card bioweave-character-alias-editor bioweave-character-editor-popover bioweave-compact-popup" id="bioweave-character-alias-popover" role="dialog" aria-modal="true" aria-label="昵称 / 别名编辑器"><div class="bioweave-character-alias-head"><h3>昵称 / 别名</h3><button type="button" class="bioweave-button bioweave-character-alias-close" data-bioweave-action="cancel-character-alias" aria-label="关闭昵称 / 别名编辑器">×</button></div><p class="bioweave-muted">正在读取当前 Floor 昵称…</p></section>'
  const aliases = Array.isArray(aliasEditor.draftAliases) ? aliasEditor.draftAliases : []
  return (
    '<section class="bioweave-card bioweave-character-alias-editor bioweave-character-editor-popover bioweave-compact-popup" id="bioweave-character-alias-popover" role="dialog" aria-modal="true" aria-label="昵称 / 别名编辑器">' +
    '<div class="bioweave-character-alias-head"><div><h3>昵称 / 别名</h3><p>仅用于识别，不改变正式名称</p></div><div class="bioweave-character-alias-head-actions"><span class="bioweave-badge good" aria-live="polite">' +
    aliases.length +
    ' 个</span><button type="button" class="bioweave-button bioweave-character-alias-close" data-bioweave-action="cancel-character-alias" aria-label="关闭昵称 / 别名编辑器">×</button></div></div>' +
    '<div class="bioweave-character-alias-fields">' +
    (aliases.length
      ? aliases
          .map(
            (alias, index) =>
              '<label class="bioweave-character-alias-field"><span>别名</span><input class="bioweave-input" type="text" value="' +
              escapeHtml(alias) +
              '" data-bioweave-alias-input="' +
              index +
              '" aria-label="昵称 ' +
              (index + 1) +
              '"><button type="button" data-bioweave-action="remove-character-alias" data-bioweave-alias-index="' +
              index +
              '" aria-label="删除昵称' +
              escapeHtml(alias) +
              '" title="删除"' +
              (aliasEditor.saving ? ' disabled' : '') +
              '>×</button></label>',
          )
          .join('')
      : '<p class="bioweave-muted">暂无昵称/别名</p>') +
    '</div><div class="bioweave-character-alias-actions"><button type="button" class="bioweave-button bioweave-character-alias-add" data-bioweave-action="add-character-alias"' +
    (aliasEditor.saving ? ' disabled' : '') +
    '>＋ 添加昵称</button><div class="right"><button type="button" class="bioweave-button" data-bioweave-action="cancel-character-alias"' +
    (aliasEditor.saving ? ' disabled' : '') +
    '>取消</button><button type="button" class="bioweave-button primary" data-bioweave-action="save-character-aliases"' +
    (aliasEditor.saving ? ' disabled' : '') +
    '>保存</button></div></div>' +
    (aliasEditor.error ? '<p class="bioweave-form-error">' + escapeHtml(aliasEditor.error) + '</p>' : '') +
    '</section>'
  )
}
function timingNumber(value, digits = 1) {
  if (!Number.isFinite(Number(value))) return '—'
  return Number(value).toFixed(digits).replace(/\.0+$/u, '')
}
function timingRange(instance, minKey, maxKey, fallback = '—') {
  if (!instance || !Number.isFinite(Number(instance[minKey])) || !Number.isFinite(Number(instance[maxKey]))) return fallback
  return `${timingNumber(instance[minKey])} ～ ${timingNumber(instance[maxKey])} 天`
}
function renderTimingInstanceSummary(instance) {
  if (!instance) return '<p class="bioweave-muted">尚未建立观察周期。</p>'
  const offset = Number(instance.sampled_individual_offset_story_days)
  const offsetText = Number.isFinite(offset) ? `${offset >= 0 ? '+' : ''}${timingNumber(offset)} 天` : '—'
  return (
    '<dl class="bioweave-data-list bioweave-character-timing-current-list">' +
    '<div><dt>基础周期</dt><dd>' + escapeHtml(timingRange(instance, 'base_min_story_days', 'base_max_story_days')) + '</dd></div>' +
    '<div><dt>本次偏移</dt><dd>' + escapeHtml(offsetText) + '</dd></div>' +
    '<div><dt>实际周期</dt><dd>' + escapeHtml(timingRange(instance, 'effective_min_story_days', 'effective_max_story_days')) + '</dd></div>' +
    '</dl>'
  )
}
function renderCharacterTimingEditor(editor, characterId) {
  if (!editor?.open || editor.characterId !== characterId) return ''
  if (editor.loading) return '<section class="bioweave-card bioweave-character-timing-editor bioweave-character-timing-popover bioweave-character-editor-popover bioweave-compact-popup" id="bioweave-character-timing-popover" role="dialog" aria-modal="true" aria-label="未确认妊娠推演周期"><p class="bioweave-muted">正在读取当前推演周期设置…</p></section>'
  const config = editor.draft ?? editor.config ?? {}
  const presetLabel = editor.humanPresetApplicable ? '恢复人类默认' : '恢复默认'
  const current = editor.timingInstance
  return (
    '<section class="bioweave-card bioweave-character-timing-editor bioweave-character-timing-popover bioweave-character-editor-popover bioweave-compact-popup" id="bioweave-character-timing-popover" role="dialog" aria-modal="true" aria-label="未确认妊娠推演周期">' +
    '<header class="bioweave-character-timing-editor-head"><div><h3>未确认妊娠推演周期</h3><p>只影响之后新建立的观察周期，不重新计算当前周期。</p></div><button type="button" class="bioweave-button bioweave-character-timing-close" data-bioweave-action="cancel-character-timing" aria-label="关闭未确认妊娠推演周期">×</button></header>' +
    '<div class="bioweave-character-timing-section"><h4>之后新周期的设置</h4><div class="bioweave-character-timing-fields">' +
    '<label><span>最短时间</span><input class="bioweave-input" type="number" min="0" step="0.1" data-bioweave-timing-field="base_min_story_days" value="' + escapeHtml(config.base_min_story_days) + '"> <em>天</em></label>' +
    '<label><span>最大时间</span><input class="bioweave-input" type="number" min="0" step="0.1" data-bioweave-timing-field="base_max_story_days" value="' + escapeHtml(config.base_max_story_days) + '"> <em>天</em></label>' +
    '<label><span>个体浮动</span><input class="bioweave-input" type="number" min="0" step="0.01" data-bioweave-timing-field="variance_ratio" value="' + escapeHtml(Number(config.variance_ratio) * 100) + '"> <em>%</em></label>' +
    '<label><span>最大浮动</span><input class="bioweave-input" type="number" min="0" step="0.1" data-bioweave-timing-field="variance_cap_story_days" value="' + escapeHtml(config.variance_cap_story_days) + '"> <em>天</em></label>' +
    '<label><span>总调整上限</span><input class="bioweave-input" type="number" min="0" step="0.1" data-bioweave-timing-field="total_adjustment_cap_story_days" value="' + escapeHtml(config.total_adjustment_cap_story_days) + '"> <em>天</em></label>' +
    '</div></div>' +
    '<div class="bioweave-character-timing-section"><h4>当前已经采用的周期</h4>' + renderTimingInstanceSummary(current) + '</div>' +
    '<div class="bioweave-character-timing-actions"><button type="button" class="bioweave-button" data-bioweave-action="restore-human-timing-preset">' + presetLabel + '</button><span class="bioweave-spacer"></span><button type="button" class="bioweave-button" data-bioweave-action="cancel-character-timing">取消</button><button type="button" class="bioweave-button primary" data-bioweave-action="save-character-timing"' + (editor.saving ? ' disabled' : '') + '>保存</button></div>' +
    (editor.error ? '<p class="bioweave-form-error">' + escapeHtml(editor.error) + '</p>' : '') +
    '</section>'
  )
}
function renderExposuresSection(subject, activeEvents, currentStoryTime = null, storyTimeDifferences = {}) {
  const exposureCount = Array.isArray(subject?.exposure_event_ids) ? new Set(subject.exposure_event_ids).size : 0
  return (
    '<section class="bioweave-card bioweave-character-detail-section bioweave-character-exposure-section"><header class="bioweave-character-section-head"><div><h3>事件记录</h3><small>按时间顺序</small></div><strong>' +
    exposureCount +
    ' 条</strong></header>' +
    renderExposures(subject, activeEvents, currentStoryTime, storyTimeDifferences) +
    '</section>'
  )
}
function renderOtherSection() {
  return (
    '<section class="bioweave-card bioweave-character-detail-section bioweave-character-other-section"><header class="bioweave-character-section-head"><h3>其他信息</h3><small>未接入内容保持明确空状态</small></header>' +
    '<div class="bioweave-character-other-list"><div class="bioweave-character-other-item"><strong>推演</strong><span>暂无</span></div><div class="bioweave-character-other-item"><strong>关系</strong><span>暂无</span></div><div class="bioweave-character-other-item"><strong>备注</strong><span>暂无</span></div></div></section>'
  )
}
const healthSiteLabels = {
  wrist: '手腕',
  ankle: '脚踝',
  hand: '手',
  arm: '手臂',
  leg: '腿',
  head: '头部',
  chest: '胸部',
  abdomen: '腹部',
}
const healthLateralityLabels = { left: '左', right: '右', bilateral: '双侧', midline: '中线' }

function healthDisplayLabel(value, fallback = '当前健康问题') {
  const text = String(value ?? '').trim()
  if (!text) return fallback
  return text
}

function healthDisplaySite(issue) {
  const site = String(issue?.display_site ?? issue?.body_site ?? '').trim()
  if (!site || site === 'general') return '未标明部位'
  const laterality = healthLateralityLabels[String(issue?.laterality ?? '').trim().toLowerCase()] ?? ''
  return laterality + (healthSiteLabels[site.toLowerCase()] ?? healthDisplayLabel(site, '相关部位'))
}

function healthSourceEventIds(issue, activeEvents, characterId) {
  const sourceIds = Array.isArray(issue?.source_observation_ids)
    ? [...new Set(issue.source_observation_ids.map(value => String(value ?? '').trim()).filter(Boolean))]
    : []
  if (!sourceIds.length || !Array.isArray(activeEvents)) return []
  const validEventIds = new Set(
    activeEvents
      .filter(event => String(event?.state_fact?.subject_id ?? '').trim() === String(characterId ?? '').trim())
      .map(event => String(event?.event_id ?? '').trim())
      .filter(Boolean),
  )
  return sourceIds.filter(eventId => validEventIds.has(eventId))
}

function renderHealthSourceActions(sourceEventIds) {
  if (!sourceEventIds.length) return ''
  if (sourceEventIds.length === 1) {
    return '<button type="button" class="bioweave-text-button bioweave-character-health-source-action" data-bioweave-action="view-health-source-event" data-bioweave-event-id="' + escapeHtml(sourceEventIds[0]) + '">查看来源事件</button>'
  }
  return '<details class="bioweave-character-health-sources"><summary class="bioweave-text-button">查看 ' + sourceEventIds.length + ' 条来源事件</summary><div class="bioweave-character-health-source-list">' +
    sourceEventIds.map(eventId => '<button type="button" class="bioweave-text-button bioweave-character-health-source-action" data-bioweave-action="view-health-source-event" data-bioweave-event-id="' + escapeHtml(eventId) + '">定位来源事件</button>').join('') +
    '</div></details>'
}

function renderHealthStateSection(currentHealthState, characterId, activeEvents = []) {
  const characterHealth = currentHealthState?.characters?.[characterId] ?? null
  const groupedIssues = Array.isArray(characterHealth?.grouped_issues) ? characterHealth.grouped_issues : []
  const summary = typeof characterHealth?.current_health_summary === 'string' && characterHealth.current_health_summary.trim()
    ? characterHealth.current_health_summary.trim()
    : groupedIssues.length
      ? '当前有健康问题'
      : '当前无记录的健康问题'
  const validIssues = groupedIssues
    .map(issue => ({
      ...issue,
      source_event_ids: healthSourceEventIds(issue, activeEvents, characterId),
      display_description: Array.isArray(issue?.descriptions) && issue.descriptions.length
        ? issue.descriptions.join('；')
        : issue?.description,
    }))
    .filter(issue => String(issue?.display_description ?? issue?.factual_kind ?? '').trim())
  const content = validIssues.length
    ? '<div class="bioweave-character-health-issues" aria-label="当前健康问题">' +
      validIssues
        .map(issue => '<article class="bioweave-character-health-issue"><header><strong>' + escapeHtml(healthDisplaySite(issue)) + '</strong></header><p>' + escapeHtml(healthDisplayLabel(issue.display_description, '当前健康问题')) + '</p>' + renderHealthSourceActions(issue.source_event_ids) + '</article>')
        .join('') +
      '</div>'
    : '<div class="bioweave-empty bioweave-character-health-empty">当前没有可显示的健康问题。</div>'
  return '<section class="bioweave-card bioweave-character-detail-section bioweave-character-health" aria-label="人物健康状态"><header class="bioweave-character-section-head"><div><h3>健康状态</h3><small>当前身体问题</small></div><strong>' + escapeHtml(summary) + '</strong></header>' + content + '</section>'
}

function detailPage({ subject, profile, activeEvents, currentStoryTime, storyTimeDifferences, aliasEditor, timingEditor, currentState, currentStateStatus, currentHealthState }) {
  const displayName = profile?.display_name ?? subject?.display_name ?? '未命名角色'
  const selectedCharacterId = characterIdOf(subject)
  const characterState = currentState?.characters?.[selectedCharacterId] ?? null
  const exposureCount = Array.isArray(subject?.exposure_event_ids) ? new Set(subject.exposure_event_ids).size : 0
  const biologicalContext = profile?.biological_context ?? {}
  const species = profile?.species ?? biologicalContext.species
  const type = profile?.biological_type ?? profile?.type ?? biologicalContext.biological_type
  const stateReady = currentStateStatus === 'ready' && characterState
  const timingOpen = timingEditor?.open && timingEditor.characterId === selectedCharacterId
  return (
    '<section class="bioweave-card bioweave-character-detail-pane bioweave-character-detail-enter" data-character-detail-id="' +
    escapeHtml(characterIdOf(subject)) +
    '"><header class="bioweave-character-detail-head"><div><div class="bioweave-character-detail-title"><h2>' +
    escapeHtml(displayValue(displayName)) +
    '</h2><span>' +
    escapeHtml(displayValue(species)) +
    ' · ' +
    escapeHtml(displayValue(type)) +
    '</span></div><p>' +
    exposureCount +
    ' 条相关事件 · 当前状态' +
    (stateReady ? '已就绪' : '待读取') +
    '</p></div><div class="bioweave-character-detail-actions"><button type="button" class="bioweave-button" data-bioweave-action="open-character-timing" data-character-id="' +
    escapeHtml(characterIdOf(subject)) +
    '" aria-expanded="' + String(Boolean(timingOpen)) + '"' + (timingOpen ? ' aria-controls="bioweave-character-timing-popover"' : '') + '>推演周期</button><button type="button" class="bioweave-button" data-bioweave-action="open-character-aliases" data-character-id="' +
    escapeHtml(characterIdOf(subject)) +
    '">编辑昵称</button></div></header>' +
    renderAliasEditor(aliasEditor?.characterId === characterIdOf(subject) ? aliasEditor : null, aliasEditor?.canonicalName ?? displayName) +
    renderCharacterTimingEditor(timingEditor, characterIdOf(subject)) +
    '<div class="bioweave-character-detail-sections"><section class="bioweave-card bioweave-character-detail-section"><header class="bioweave-character-section-head"><h3>生殖能力</h3><small>6 项</small></header>' +
    renderCapabilities(profile) +
    '</section>' +
    renderHealthStateSection(currentHealthState, selectedCharacterId, activeEvents) +
    renderCharacterState({ characterState, currentState, currentStateStatus }) +
    renderExposuresSection(subject, activeEvents, currentStoryTime, storyTimeDifferences) +
    renderOtherSection() +
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
export function charactersPage({
  characterId = null,
  trackingSubjects = [],
  characterProfiles = {},
  activeEvents = [],
  analysisStatus = null,
  currentState = null,
  currentStateStatus = 'NO_CHARACTER_FLOOR',
  currentHealthState = null,
  currentStoryTime = null,
  currentStoryTimeDifferences = {},
  aliasEditor = null,
  timingEditor = null,
} = {}) {
  const status = normalizeAnalysisStatus(analysisStatus)
  const subjects = subjectEntries(trackingSubjects)
  const effectiveEvents = analysisStatusEvents(status, activeEvents, 'active_events')
  const rows = subjects
    .map(({ key, value: subject }) => {
      const displayName = subject.display_name ?? '未命名角色'
      const exposureCount = Array.isArray(subject.exposure_event_ids) ? subject.exposure_event_ids.length : 0
      const selected = String(characterId ?? '') === key
      const statusMarkup =
        subject.status && subject.status !== 'active'
          ? '<span class="bioweave-badge ' + trackingSubjectTone(subject.status) + '">' + escapeHtml(subjectStatusLabel(subject.status)) + '</span>'
          : ''
      return (
        '<button type="button" class="bioweave-card bioweave-character-row' +
        (selected ? ' selected' : '') +
        '" data-character-id="' +
        escapeHtml(key) +
        '"><span class="bioweave-character-row-main"><b>' +
        escapeHtml(displayValue(displayName)) +
        '</b></span><span class="bioweave-character-row-state">' +
        statusMarkup +
        '<span>' +
        exposureCount +
        ' 条事件</span><span class="bioweave-character-row-chevron" aria-hidden="true">›</span></span></button>'
      )
    })
    .join('')
  const emptyState =
    status.state === 'not_analyzed'
      ? '<div class="bioweave-card bioweave-empty"><b>尚未完成事件分析。</b>' + '<p>完成当前楼层分析后，符合追踪条件的角色会显示在这里。</p></div>'
      : status.state === 'running' && WORLD_ANALYSIS_PHASES.has(status.phase)
        ? '<div class="bioweave-card bioweave-empty"><b>等待世界分析完成…</b>' + '<p>世界模型就绪后才会开始人物与事件分析。</p></div>'
        : status.state === 'running'
          ? '<div class="bioweave-card bioweave-empty"><b>当前楼层正在分析中。</b>' +
            '<p>分析完成后将更新 BiologicalEvent 与 Tracking Subject。</p></div>'
          : status.state === 'cancelled'
            ? '<div class="bioweave-card bioweave-empty"><b>本次事件分析已取消。</b>' +
              '<p>现有 Tracking Subject 与历史事件仍然保留，可重新分析当前楼层。</p></div>'
            : status.state === 'failed'
              ? '<div class="bioweave-card bioweave-empty"><b>当前楼层事件分析失败。</b>' +
                '<p>请稍后重试。如有旧的成功事件，它们仍然有效。</p></div>'
              : status.state === 'success' && Number(status.event_count) === 0
                ? '<div class="bioweave-card bioweave-empty"><b>本楼分析完成，未发现 Biological Event。</b>' +
                  '<p>这是当前楼层的有效空结果；已有的历史人物资料仍按当前有效 Floor 数据显示。</p></div>'
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
      ? detailPage({
          subject: selectedSubject,
          profile: profileFor(characterProfiles, selectedId),
          activeEvents: effectiveEvents,
          currentStoryTime,
          storyTimeDifferences: currentStoryTimeDifferences,
          aliasEditor,
          timingEditor,
          currentState,
          currentStateStatus,
          currentHealthState,
        })
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
