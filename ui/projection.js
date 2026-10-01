function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

function projectionStatusLabel(status) {
  return {active: '进行中', realized: '已实现', contradicted: '已否定', expired: '已过期', deleted: '已删除'}[status] ?? status ?? '未确认'
}

export function projectionPage({projections = [], projectionSummary = null, projectionStatus = null} = {}) {
  const items = Array.isArray(projections) ? projections : []
  const summary = projectionSummary ?? {active_count: items.filter(item => item.status === 'active').length}
  const cards = items.map(item => '<article class="bioweave-card bioweave-projection-card" data-projection-id="' + escapeHtml(item.id) + '"><header><b>' + escapeHtml(item.subject?.display_name ?? item.subject?.id ?? '未知人物') + '</b><span class="bioweave-badge">' + escapeHtml(projectionStatusLabel(item.status)) + '</span></header><p class="bioweave-muted">' + escapeHtml(item.rule?.label ?? item.concern_key ?? '未命名推演') + '</p><p>' + escapeHtml(item.generated_statement) + '</p><small class="bioweave-muted">Story Time：' + escapeHtml(item.created_story_time?.display ?? item.created_story_time?.text ?? item.created_story_time ?? '未知') + ' · 来源 Event：' + escapeHtml((item.source_refs ?? []).join('、') || '无') + '</small><div class="bioweave-page-actions"><button type="button" class="bioweave-text-button" data-bioweave-action="delete-projection" data-projection-id="' + escapeHtml(item.id) + '">删除</button></div></article>').join('')
  return '<section class="bioweave-page" data-bioweave-page="projection"><div class="bioweave-page-title bioweave-page-head"><div><h2>推演预测</h2><p class="bioweave-muted">未来可能发生的生理推演，不是事实账本</p></div><div class="bioweave-page-actions"><span class="bioweave-muted">当前推演：' + escapeHtml(summary.active_count ?? 0) + '</span><button type="button" class="bioweave-text-button" data-bioweave-action="refresh-projection">刷新推演</button></div></div>' + (projectionStatus?.state === 'running' ? '<div class="bioweave-card"><span class="bioweave-muted">正在更新推演…</span></div>' : '') + (projectionStatus?.state === 'failed' ? '<div class="bioweave-card"><span class="bioweave-error">推演更新失败，可重新刷新。</span></div>' : '') + (cards || '<section class="bioweave-card bioweave-empty"><b>当前没有需要展示的推演</b><p>推演并非已发生事实，也不会自动成为 confirmed Event。</p></section>') + '</section>'
}
