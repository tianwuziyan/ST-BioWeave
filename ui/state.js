function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

function displayValue(value, fallback = '未知') {
  if (value === null || value === undefined || value === '') return fallback
  if (typeof value === 'object') {
    try { return JSON.stringify(value) } catch { return fallback }
  }
  return String(value)
}

function storyTimeDisplay(value) {
  if (!value || typeof value !== 'object') return displayValue(value)
  return displayValue(value.display ?? value.normalized ?? value)
}

function statusMeta(status) {
  const value = String(status ?? '').trim().toLowerCase()
  if (value === 'success' || value === 'ready') return {label: '成功', tone: 'good'}
  if (value === 'running' || value === 'loading') return {label: '分析中', tone: 'warn'}
  if (value === 'failed' || value === 'error') return {label: '失败', tone: 'danger'}
  if (value === 'cancelled') return {label: '已取消', tone: 'warn'}
  return {label: '未启用', tone: ''}
}

function badge(status, fallback = '未启用') {
  const meta = statusMeta(status)
  return `<span class="bioweave-badge${meta.tone ? ` ${meta.tone}` : ''}">${escapeHtml(meta.label || fallback)}</span>`
}

function currentFloorText(currentFloor) {
  if (!currentFloor || typeof currentFloor !== 'object') return '暂无有效当前楼层'
  const floor = displayValue(currentFloor.floor)
  const swipe = displayValue(currentFloor.swipe_id)
  return `当前楼层 ${floor} · 当前 Swipe ${swipe}`
}

function floorVersionText(currentFloor) {
  const version = currentFloor?.version ?? currentFloor?.floor_version
  if (!version || typeof version !== 'object') return '楼层版本未加载'
  const messageVersion = version.message_version ?? '—'
  return `楼层版本 · 版本 ${messageVersion}`
}

function analysisStatusLabel(status) {
  const value = String(status?.state ?? '').trim().toLowerCase()
  if (value === 'success') return '最近分析成功'
  if (value === 'running') return '当前正在分析'
  if (value === 'failed') return '最近分析失败'
  if (value === 'cancelled') return '最近分析已取消'
  return '尚未完成分析'
}

function eventAnalysisDetail(status, currentFloor) {
  const count = status?.event_count
  const countText = count === undefined ? '事件数量未知' : `${count} 个事件`
  const error = status?.safe_error_summary || status?.error_code
  return `${analysisStatusLabel(status)} · ${currentFloorText(currentFloor)} · ${countText}${error ? ` · ${error}` : ''}`
}

function worldModelDetail(worldModelMeta) {
  if (!worldModelMeta || typeof worldModelMeta !== 'object') return '当前对话尚未加载世界模型'
  const owner = worldModelMeta.owner_floor ?? worldModelMeta.floor ?? worldModelMeta.ownerFloor
  return owner === undefined ? '当前对话已加载世界模型' : `所属楼层 ${owner}`
}

function renderTaskRow(title, detail, state) {
  return `<div class="bioweave-plugin-status-entity-row"><span class="bioweave-plugin-status-entity-copy"><b>${escapeHtml(title)}</b><small>${escapeHtml(detail)}</small></span>${badge(state)}</div>`
}

function renderSecurityRow(title, detail, value = '正常', tone = 'good') {
  return `<div class="bioweave-plugin-status-row"><div class="bioweave-plugin-status-row-main"><b>${escapeHtml(title)}</b><span>${escapeHtml(detail)}</span></div><span class="bioweave-plugin-status-row-value ${tone}">${escapeHtml(value)}</span></div>`
}

export function statePage({ chatName = null, chatId = null, currentFloor = null, analysisStatus = null, currentStoryTime = null, currentStoryTimeStatus = null, currentStateStatus = null, worldModelMeta = null } = {}) {
  const status = analysisStatus && typeof analysisStatus === 'object' ? analysisStatus : {}
  const storyStatus = statusMeta(currentStoryTimeStatus)
  const stateStatus = statusMeta(currentStateStatus)
  const error = status.safe_error_summary || status.error_code || status.diagnostic_code
  const analysisDetail = eventAnalysisDetail(status, currentFloor)
  return `<section class="bioweave-page bioweave-state-page" data-bioweave-page="state"><div class="bioweave-page-head bioweave-state-page-head"><div class="bioweave-page-head-copy"><h1>分析状态</h1><p>当前对话的分析任务状态和安全诊断</p></div></div><section class="bioweave-section bioweave-plugin-status-section"><div class="bioweave-plugin-status-section-head"><div><h2>任务队列</h2><p>运行状态由运行时提供；重新打开页面不会重复请求</p></div><span class="bioweave-badge ${status.busy ? 'warn' : 'good'}">${status.busy ? '运行中' : '空闲'}</span></div><div class="bioweave-plugin-status-task-list">${renderTaskRow('世界模型', worldModelDetail(worldModelMeta), worldModelMeta ? 'success' : 'not_enabled')}${renderTaskRow('事件分析', analysisDetail, status.state)}${renderTaskRow('生物状态', `当前状态 ${stateStatus.label} · ${floorVersionText(currentFloor)}`, currentStateStatus)} </div></section><section class="bioweave-section bioweave-plugin-status-section"><div class="bioweave-plugin-status-section-head"><div><h2>安全摘要</h2><p>仅展示脱敏后的错误分类和阶段信息</p></div></div>${renderSecurityRow('密钥存储', 'API 密钥不会写入对话元数据、楼层扩展数据或预览')}${renderSecurityRow('当前对话作用域', `${displayValue(chatName)} · ${displayValue(chatId)} · 异步结果仅允许写回当前对话`)}${renderSecurityRow('当前故事时间', `${storyTimeDisplay(currentStoryTime)} · ${storyStatus.label}`, storyStatus.label, storyStatus.tone || '')}${error ? renderSecurityRow('分析诊断', `${status.error_stage ? '分析阶段' : '运行时'} · ${error}`, '需关注', 'warn') : ''}</section></section>`
}
