import { formatStoryTime } from '../story/time.js'

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
function renderStatus(value) { return escapeHtml(STATUS_LABELS[value] ?? displayValue(value)) }
function renderStoryTime(value) { return escapeHtml(formatStoryTime(value)) }

function renderIdList(values) {
  const ids = Array.isArray(values) ? values.filter(Boolean) : []
  return ids.length ? ids.map(value => `<code>${escapeHtml(value)}</code>`).join('、') : '暂无记录'
}

function renderDataList(rows) {
  return `<dl class="bioweave-character-state-data-list">${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`).join('')}</dl>`
}

function renderSection(title, content, className = '') {
  return `<section class="bioweave-card bioweave-character-state-section${className ? ` ${className}` : ''}"><header class="bioweave-section-head"><div><h3>${escapeHtml(title)}</h3></div></header>${content}</section>`
}

function episodeRows(episodes) {
  return Object.entries(episodes && typeof episodes === 'object' ? episodes : {}).map(([id, episode], index) => `<article class="bioweave-character-state-episode"><header><strong>妊娠记录 ${index + 1}</strong><span class="bioweave-badge">${renderStatus(episode?.status)}</span></header>${renderDataList([
    ['记录标识', `<code>${escapeHtml(id)}</code>`],
    ['确认事实', renderIdList(episode?.confirmation_event_ids)],
    ['终止事实', renderIdList(episode?.termination_event_ids)],
    ['分娩事实', renderIdList(episode?.delivery_event_ids)],
    ['分娩过程', renderIdList(episode?.labor_event_ids)],
  ])}</article>`).join('')
}

function renderExposure(character) {
  const exposure = character?.reproductive_exposure ?? {}
  const records = Array.isArray(exposure.records) ? exposure.records : []
  const recordsMarkup = records.length
    ? `<div class="bioweave-character-state-record-list">${records.map(record => `<article class="bioweave-character-state-record"><div><strong>暴露事实</strong><span class="bioweave-badge">${escapeHtml(renderStatus(record.status))}</span></div>${renderDataList([
      ['Story Time', renderStoryTime(record.story_time)],
      ['相关对象', renderIdList(record.counterpart_ids)],
      ['机制', renderValue(record.reproductive_mechanism?.label ?? record.reproductive_mechanism?.kind ?? record.reproductive_mechanism?.pathway)],
    ])}</article>`).join('')}</div>`
    : '<div class="bioweave-empty bioweave-character-state-empty">暂无记录</div>'
  return renderSection('生殖暴露', `${renderDataList([
    ['最近暴露', renderValue(exposure.last_exposure_event_id)],
    ['最近 Story Time', renderStoryTime(exposure.last_exposure_story_time)],
    ['经过 Story Time 天数', renderValue(exposure.elapsed_story_days)],
  ])}${recordsMarkup}<p class="bioweave-character-state-note">暴露事实不等于受孕确认。</p>`)
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

function renderPregnancy(character) {
  const pregnancy = character?.pregnancy ?? {}
  const episodes = episodeRows(pregnancy.episodes)
  return renderSection('妊娠状态', `${renderDataList([
    ['当前状态', renderStatus(pregnancy.current_status)],
    ['当前妊娠记录', renderIdList(pregnancy.active_pregnancy_ids)],
  ])}${episodes ? `<div class="bioweave-character-state-record-list">${episodes}</div>` : '<div class="bioweave-empty bioweave-character-state-empty">暂无妊娠记录</div>'}`)
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
  return renderSection('产后', `${renderDataList([['明确产后事实', renderIdList(postpartum.factual_event_ids)]])}${episodes.length ? `<div class="bioweave-character-state-record-list">${episodes.map(id => `<article class="bioweave-character-state-record"><strong>妊娠记录</strong> <code>${escapeHtml(id)}</code></article>`).join('')}</div>` : '<div class="bioweave-empty bioweave-character-state-empty">暂无记录</div>'}`)
}

function renderSymptoms(character) {
  const records = Array.isArray(character?.symptoms?.records) ? character.symptoms.records : []
  return renderSection('身体表现', records.length ? `<div class="bioweave-character-state-record-list">${records.map(record => `<article class="bioweave-character-state-record">${renderDataList([
    ['类型', renderValue(record.symptom?.kind)], ['描述', renderValue(record.symptom?.description)],
    ['Story Time', renderStoryTime(record.story_time)], ['状态', renderStatus(record.status)],
  ])}</article>`).join('')}</div>` : '<div class="bioweave-empty bioweave-character-state-empty">暂无记录</div>')
}

function renderMedical(character) {
  const records = Array.isArray(character?.medical?.records) ? character.medical.records : []
  return renderSection('医疗事实', records.length ? `<div class="bioweave-character-state-record-list">${records.map(record => `<article class="bioweave-character-state-record">${renderDataList([
    ['事实类型', renderValue(record.fact?.kind)], ['描述', renderValue(record.fact?.description)],
    ['Story Time', renderStoryTime(record.story_time)], ['状态', renderStatus(record.status)],
  ])}</article>`).join('')}</div>` : '<div class="bioweave-empty bioweave-character-state-empty">暂无记录</div>')
}

function renderActivity(character) {
  const ids = character?.activity_chain?.event_ids ?? []
  return renderSection('活动链', `<p class="bioweave-character-state-note">相关事实记录 ${Array.isArray(ids) ? ids.length : 0} 条</p><details class="bioweave-character-state-debug"><summary>展开事实引用</summary><div class="bioweave-character-state-id-list">${renderIdList(ids)}</div></details>`)
}

function renderDiagnostics(state) {
  const diagnostics = Array.isArray(state?.diagnostics) ? state.diagnostics : []
  if (!diagnostics.length) return ''
  return `<aside class="bioweave-character-state-diagnostics" role="status"><strong>部分状态存在事实冲突或信息不完整</strong><details><summary>查看诊断</summary><ul>${diagnostics.map(diagnostic => `<li><code>${escapeHtml(diagnostic.code)}</code>${diagnostic.detail ? `：${escapeHtml(diagnostic.detail)}` : ''}</li>`).join('')}</ul></details></aside>`
}

function stateMessage(status) {
  if (status === 'NO_CHARACTER_FLOOR' || status === 'no_character_floor') return ['暂无可分析的角色楼层', '当前 Chat 尚未提供有效的 Character Floor。']
  if (status === 'STATE_ERROR' || status === 'error') return ['当前状态暂不可读取', '状态归约发生错误；已有 Event 与 Tracking 事实未被清除。']
  if (status === 'loading' || status === 'running') return ['正在读取当前生物状态', '请稍候，页面会在 Runtime 数据更新后刷新。']
  return null
}

export function renderCharacterState({ characterState = null, currentState = null, currentStateStatus = 'NO_CHARACTER_FLOOR' } = {}) {
  const message = stateMessage(currentStateStatus)
  if (message) return `<section class="bioweave-card bioweave-character-detail-section bioweave-character-state"><h3>当前状态</h3><div class="bioweave-empty bioweave-character-state-empty"><b>${message[0]}</b><p>${message[1]}</p></div></section>`
  if (!characterState) return '<section class="bioweave-card bioweave-character-detail-section bioweave-character-state"><h3>当前状态</h3><div class="bioweave-empty bioweave-character-state-empty">该人物当前暂无 Biological State。</div></section>'
  return `<section class="bioweave-character-state" aria-label="当前 Biological State"><header class="bioweave-character-state-head"><h3>当前 Biological State</h3><span class="bioweave-badge good">已就绪</span></header>${renderDiagnostics(currentState)}<div class="bioweave-character-state-grid">${renderExposure(characterState)}${renderConception(characterState)}${renderPregnancy(characterState)}${renderCycle(characterState)}${renderPostpartum(characterState)}${renderSymptoms(characterState)}${renderMedical(characterState)}${renderActivity(characterState)}</div></section>`
}
