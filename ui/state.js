import { formatStoryTime } from '../story/time.js'

const CAPABILITY_LABELS = {
  can_produce_sperm: '可产生精子',
  can_produce_ova: '可产生卵子',
  can_be_fertilized: '可受精',
  can_fertilize: '可使对方受精',
  can_carry_pregnancy: '可承载妊娠',
  can_cause_pregnancy: '可导致受孕',
}

const STATUS_LABELS = {
  unknown: '未知', suspected: '疑似 / 观察', confirmed: '已确认', ended: '已结束',
  probable: '较可能', ambiguous: '有歧义', negated: '已否定', fictional: '虚构',
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

function displayValue(value) {
  if (value === null || value === undefined || value === '') return '未知'
  if (typeof value === 'object') {
    try { return JSON.stringify(value) } catch { return '未知' }
  }
  return String(value)
}

function renderValue(value) { return escapeHtml(displayValue(value)) }

function renderTriState(value) {
  const label = value === true ? '是' : value === false ? '否' : '未知'
  const tone = value === true ? ' good' : value === null || value === undefined ? ' unknown' : ''
  return `<span class="bioweave-state-value${tone}">${label}</span>`
}

function renderStatus(value) { return escapeHtml(STATUS_LABELS[value] ?? displayValue(value)) }

function renderStoryTime(value) { return escapeHtml(formatStoryTime(value)) }

function renderIdList(values) {
  const ids = Array.isArray(values) ? values.filter(Boolean) : []
  return ids.length ? ids.map(value => `<code>${escapeHtml(value)}</code>`).join('、') : '暂无记录'
}

function renderDataList(rows) {
  return `<dl class="bioweave-state-data-list">${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`).join('')}</dl>`
}

function renderSection(title, content, className = '') {
  return `<section class="bioweave-card bioweave-state-section${className ? ` ${className}` : ''}"><header class="bioweave-section-head"><div><h3>${escapeHtml(title)}</h3></div></header>${content}</section>`
}

function renderCharacterSelector(subjects, selectedId) {
  if (!subjects.length) return ''
  return `<section class="bioweave-card bioweave-state-character-selector"><div class="bioweave-state-selector-head"><strong>当前角色</strong><span>${subjects.length} 人</span></div><div class="bioweave-state-character-list">${subjects.map(({ id, subject }) => {
    const selected = id === selectedId
    return `<button type="button" class="bioweave-state-character-button${selected ? ' selected' : ''}" data-bioweave-state-character-id="${escapeHtml(id)}" aria-pressed="${selected}"><span>${escapeHtml(displayValue(subject?.display_name))}</span><small>${escapeHtml(subject?.status === 'active' ? '追踪中' : '相关事实')}</small></button>`
  }).join('')}</div></section>`
}

function renderIdentity(character) {
  const identity = character?.identity ?? {}
  return renderSection('基础', renderDataList([
    ['名称', renderValue(identity.display_name)],
    ['物种', renderValue(identity.species)],
    ['生物类型', renderValue(identity.biological_type)],
  ]))
}

function renderCapabilities(character) {
  const capabilities = character?.reproductive_capabilities ?? {}
  return renderSection('生殖能力', renderDataList(Object.entries(CAPABILITY_LABELS).map(([key, label]) => [label, renderTriState(capabilities[key])])), 'bioweave-state-capabilities')
}

function renderExposure(character) {
  const exposure = character?.reproductive_exposure ?? {}
  const records = Array.isArray(exposure.records) ? exposure.records : []
  const recordsMarkup = records.length
    ? `<div class="bioweave-state-record-list">${records.map(record => `<article class="bioweave-state-record"><div><strong>暴露事实</strong><span class="bioweave-badge">${escapeHtml(renderStatus(record.status))}</span></div>${renderDataList([
      ['Story Time', renderStoryTime(record.story_time)],
      ['相关对象', renderIdList(record.counterpart_ids)],
      ['机制', renderValue(record.reproductive_mechanism?.label ?? record.reproductive_mechanism?.kind ?? record.reproductive_mechanism?.pathway)],
    ])}</article>`).join('')}</div>`
    : '<div class="bioweave-empty bioweave-state-empty">暂无记录</div>'
  return renderSection('生殖暴露', `${renderDataList([
    ['最近暴露', renderValue(exposure.last_exposure_event_id)],
    ['最近 Story Time', renderStoryTime(exposure.last_exposure_story_time)],
    ['经过 Story Time 天数', renderValue(exposure.elapsed_story_days)],
  ])}${recordsMarkup}<p class="bioweave-state-note">暴露事实不等于受孕确认。</p>`)
}

function renderConception(character) {
  const conception = character?.conception ?? {}
  return renderSection('受孕事实', renderDataList([
    ['当前事实状态', renderStatus(conception.status)],
    ['关联妊娠记录', renderIdList(conception.pregnancy_ids)],
    ['已确认事实', renderIdList(conception.confirmed_event_ids)],
    ['不确定证据', renderIdList(conception.uncertain_event_ids)],
  ]))
}

function episodeRows(episodes) {
  return Object.entries(episodes && typeof episodes === 'object' ? episodes : {}).map(([id, episode], index) => `<article class="bioweave-state-episode"><header><strong>妊娠记录 ${index + 1}</strong><span class="bioweave-badge">${renderStatus(episode?.status)}</span></header>${renderDataList([
    ['记录标识', `<code>${escapeHtml(id)}</code>`],
    ['确认事实', renderIdList(episode?.confirmation_event_ids)],
    ['终止事实', renderIdList(episode?.termination_event_ids)],
    ['分娩事实', renderIdList(episode?.delivery_event_ids)],
    ['分娩过程', renderIdList(episode?.labor_event_ids)],
  ])}</article>`).join('')
}

function renderPregnancy(character) {
  const pregnancy = character?.pregnancy ?? {}
  const episodes = episodeRows(pregnancy.episodes)
  return renderSection('妊娠状态', `${renderDataList([
    ['当前状态', renderStatus(pregnancy.current_status)],
    ['当前妊娠记录', renderIdList(pregnancy.active_pregnancy_ids)],
  ])}${episodes ? `<div class="bioweave-state-record-list">${episodes}</div>` : '<div class="bioweave-empty bioweave-state-empty">暂无妊娠记录</div>'}`)
}

function renderCycle(character) {
  const cycle = character?.cycle ?? {}
  return renderSection('周期', renderDataList([
    ['明确周期事实', renderIdList(cycle.factual_event_ids)],
    ['不确定周期证据', renderIdList(cycle.uncertain_event_ids)],
  ]))
}

function renderPostpartum(character) {
  const postpartum = character?.postpartum ?? {}
  const episodes = Object.keys(postpartum.episodes ?? {})
  return renderSection('产后', `${renderDataList([['明确产后事实', renderIdList(postpartum.factual_event_ids)]])}${episodes.length ? `<div class="bioweave-state-record-list">${episodes.map(id => `<article class="bioweave-state-record"><strong>妊娠记录</strong> <code>${escapeHtml(id)}</code></article>`).join('')}</div>` : '<div class="bioweave-empty bioweave-state-empty">暂无记录</div>'}`)
}

function renderSymptoms(character) {
  const records = Array.isArray(character?.symptoms?.records) ? character.symptoms.records : []
  return renderSection('身体表现', records.length ? `<div class="bioweave-state-record-list">${records.map(record => `<article class="bioweave-state-record">${renderDataList([
    ['类型', renderValue(record.symptom?.kind)], ['描述', renderValue(record.symptom?.description)],
    ['Story Time', renderStoryTime(record.story_time)], ['状态', renderStatus(record.status)],
  ])}</article>`).join('')}</div>` : '<div class="bioweave-empty bioweave-state-empty">暂无记录</div>')
}

function renderMedical(character) {
  const records = Array.isArray(character?.medical?.records) ? character.medical.records : []
  return renderSection('医疗事实', records.length ? `<div class="bioweave-state-record-list">${records.map(record => `<article class="bioweave-state-record">${renderDataList([
    ['事实类型', renderValue(record.fact?.kind)], ['描述', renderValue(record.fact?.description)],
    ['Story Time', renderStoryTime(record.story_time)], ['状态', renderStatus(record.status)],
  ])}</article>`).join('')}</div>` : '<div class="bioweave-empty bioweave-state-empty">暂无记录</div>')
}

function renderActivity(character) {
  const ids = character?.activity_chain?.event_ids ?? []
  return renderSection('活动链', `<p class="bioweave-state-note">相关事实记录 ${Array.isArray(ids) ? ids.length : 0} 条</p><details class="bioweave-state-debug"><summary>展开事实引用</summary><div class="bioweave-state-id-list">${renderIdList(ids)}</div></details>`)
}

function renderDiagnostics(state) {
  const diagnostics = Array.isArray(state?.diagnostics) ? state.diagnostics : []
  if (!diagnostics.length) return ''
  return `<aside class="bioweave-state-diagnostics" role="status"><strong>部分状态存在事实冲突或信息不完整</strong><details><summary>查看诊断</summary><ul>${diagnostics.map(diagnostic => `<li><code>${escapeHtml(diagnostic.code)}</code>${diagnostic.detail ? `：${escapeHtml(diagnostic.detail)}` : ''}</li>`).join('')}</ul></details></aside>`
}

function statusMessage(status) {
  if (status === 'NO_CHARACTER_FLOOR' || status === 'no_character_floor') return ['暂无可分析的角色楼层', '当前 Chat 尚未提供有效的 Character Floor。']
  if (status === 'STATE_ERROR' || status === 'error') return ['当前状态暂不可读取', '状态归约发生错误；已有 Event 与 Tracking 事实未被清除。']
  if (status === 'loading' || status === 'running') return ['正在读取当前生物状态', '请稍候，页面会在 Runtime 数据更新后刷新。']
  return null
}

function stateStatusLabel(status) {
  return {
    ready: '已就绪',
    loading: '读取中',
    running: '读取中',
    NO_CHARACTER_FLOOR: '无角色楼层',
    no_character_floor: '无角色楼层',
    STATE_ERROR: '读取错误',
    error: '读取错误',
  }[status] ?? '未知'
}

export function statePage({ focusedCharacterId = null, trackingSubjects = {}, currentState = null, currentStateStatus = 'NO_CHARACTER_FLOOR' } = {}) {
  const state = currentState && typeof currentState === 'object' ? currentState : { characters: {}, diagnostics: [] }
  const characters = state.characters && typeof state.characters === 'object' ? state.characters : {}
  const subjects = Object.entries(trackingSubjects && typeof trackingSubjects === 'object' ? trackingSubjects : {})
    .map(([key, subject]) => ({ id: String(subject?.character_id ?? key), subject }))
    .filter(item => item.id && item.subject && typeof item.subject === 'object')
    .sort((a, b) => a.id.localeCompare(b.id))
  const message = statusMessage(currentStateStatus)
  const selectedId = String(focusedCharacterId ?? '').trim() || subjects[0]?.id || ''
  const character = selectedId ? characters[selectedId] : null
  const unavailableFocus = Boolean(String(focusedCharacterId ?? '').trim()) && !subjects.some(subject => subject.id === selectedId)
  let body
  if (message) body = `<section class="bioweave-card bioweave-empty"><b>${message[0]}</b><p>${message[1]}</p></section>`
  else if (!Object.keys(characters).length) body = '<section class="bioweave-card bioweave-empty"><b>暂无生物状态数据</b><p>当前有效事实尚未形成可显示的 Character State。</p></section>'
  else if (!subjects.length) body = '<section class="bioweave-card bioweave-empty"><b>暂无可展示的角色 State</b><p>当前状态存在事实，但 Character Registry 暂无可用的展示角色。</p></section>'
  else if (unavailableFocus || !character) body = '<section class="bioweave-card bioweave-empty"><b>该角色当前无可用 State</b><p>请从当前角色列表选择一个可展示角色。</p></section>'
  else body = `${renderDiagnostics(state)}<div class="bioweave-state-grid">${renderIdentity(character)}${renderCapabilities(character)}${renderExposure(character)}${renderConception(character)}${renderPregnancy(character)}${renderCycle(character)}${renderPostpartum(character)}${renderSymptoms(character)}${renderMedical(character)}${renderActivity(character)}</div>`
  return `<section class="bioweave-page bioweave-state-page" data-bioweave-page="state"><div class="bioweave-page-title bioweave-page-head"><div><h2>生物状态</h2><p class="bioweave-muted">只读显示当前 Runtime Current Biological State</p></div><span class="bioweave-badge">${escapeHtml(stateStatusLabel(currentStateStatus))}</span></div>${renderCharacterSelector(subjects, selectedId)}${body}</section>`
}
