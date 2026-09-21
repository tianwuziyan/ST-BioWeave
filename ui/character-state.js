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

function recordCount(value) {
  return Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.keys(value).length : 0
}

function stateSummary(character) {
  const exposure = character?.reproductive_exposure ?? {}
  const records = Array.isArray(exposure.records) ? exposure.records : []
  const confirmed = records.filter(record => record?.status === 'confirmed').length
  const conception = character?.conception ?? {}
  const pregnancy = character?.pregnancy ?? {}
  const pregnancyCount = recordCount(pregnancy.episodes) + recordCount(pregnancy.active_pregnancy_ids)
  const cycleCount = recordCount(character?.cycle?.factual_event_ids) + recordCount(character?.cycle?.uncertain_event_ids)
  const postpartumCount = recordCount(character?.postpartum?.factual_event_ids) + recordCount(character?.postpartum?.episodes)
  const symptomCount = recordCount(character?.symptoms?.records)
  const medicalCount = recordCount(character?.medical?.records)
  const hasOtherFacts = cycleCount || postpartumCount || symptomCount || medicalCount
  return {
    exposure: records.length ? `${confirmed || records.length} 条${confirmed ? '已确认' : ''}记录` : '暂无记录',
    conception: conception.status ? `当前状态${renderStatus(conception.status)}` : '当前状态未知',
    pregnancy: pregnancyCount ? `${pregnancyCount} 条记录` : '暂无记录',
    other: hasOtherFacts
      ? `周期 ${cycleCount} · 产后 ${postpartumCount} · 身体表现 ${symptomCount} · 医疗事实 ${medicalCount}`
      : '周期、产后、身体表现、医疗事实暂无记录',
  }
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
  if (message) return `<section class="bioweave-card bioweave-character-detail-section bioweave-character-state"><header class="bioweave-character-section-head"><h3>当前状态</h3></header><div class="bioweave-empty bioweave-character-state-empty"><b>${message[0]}</b><p>${message[1]}</p></div></section>`
  if (!characterState) return '<section class="bioweave-card bioweave-character-detail-section bioweave-character-state"><header class="bioweave-character-section-head"><h3>当前状态</h3></header><div class="bioweave-empty bioweave-character-state-empty">该人物当前暂无 Biological State。</div></section>'
  const summary = stateSummary(characterState)
  return `<section class="bioweave-card bioweave-character-detail-section bioweave-character-state" aria-label="当前 Biological State"><header class="bioweave-character-section-head"><h3>当前状态</h3><span class="bioweave-badge good">已就绪</span></header>${renderDiagnostics(currentState)}<div class="bioweave-character-state-strip"><div class="bioweave-character-state-cell"><span>生殖暴露</span><strong>${escapeHtml(summary.exposure)}</strong></div><div class="bioweave-character-state-cell"><span>受孕事实</span><strong>${escapeHtml(summary.conception)}</strong></div><div class="bioweave-character-state-cell"><span>妊娠状态</span><strong>${escapeHtml(summary.pregnancy)}</strong></div></div><p class="bioweave-character-state-empty-summary">${escapeHtml(summary.other)}</p></section>`
}
