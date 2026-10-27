function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
}

function statusFor(statuses, characterId) {
  const priority = {confirmed: 3, suspected: 2, ended: 1, unknown: 0};
  return (Array.isArray(statuses) ? statuses : [])
    .filter(item => String(item?.subject_id ?? '') === String(characterId ?? ''))
    .sort((left, right) => (priority[right?.status] ?? 0) - (priority[left?.status] ?? 0))[0] ?? null;
}

function knowledgeFor(knowledge, characterId) {
  return (Array.isArray(knowledge) ? knowledge : []).find(item => String(item?.subject_id ?? '') === String(characterId ?? '')) ?? null;
}

export function pregnancyStatusView(statuses, characterId) {
  const item = statusFor(statuses, characterId);
  const status = item?.status ?? 'unknown';
  const pregnancyLabel = status === 'confirmed'
    ? item?.gestational_weeks === null || item?.gestational_weeks === undefined ? '孕周待时间' : `孕 ${item.gestational_weeks} 周`
    : status === 'suspected' ? '疑似 / 观察中' : status === 'ended' ? '已结束' : '暂无结论';
  return {item, status, pregnancyLabel, confirmed: status === 'confirmed'};
}

export function renderPregnancyKnowledgeButton({statuses = [], characterId = '', className = '', open = false} = {}) {
  const view = pregnancyStatusView(statuses, characterId);
  if (!view.confirmed) return '';
  return `<button type="button" class="bioweave-button bioweave-pregnancy-knowledge-button${className ? ` ${className}` : ''}" data-bioweave-action="toggle-character-pregnancy-knowledge" data-character-id="${escapeHtml(characterId)}" aria-haspopup="dialog" aria-controls="bioweave-pregnancy-knowledge-popover" aria-expanded="${String(Boolean(open))}">知情名单</button>`;
}

export function renderPregnancyKnowledgePopover({knowledge = [], characterId = '', open = false, title = '知情名单'} = {}) {
  if (!open) return '';
  const item = knowledgeFor(knowledge, characterId);
  const names = Array.isArray(item?.knower_display_names) ? item.knower_display_names.filter(Boolean) : [];
  const content = names.length
    ? `<ul class="bioweave-pregnancy-knowledge-list">${names.map(name => `<li>${escapeHtml(name)}</li>`).join('')}</ul>`
    : '<div class="bioweave-empty bioweave-pregnancy-knowledge-empty">暂无已记录知情人。未列入名单的人默认视为不知道。</div>';
  return `<section id="bioweave-pregnancy-knowledge-popover" class="bioweave-card bioweave-character-alias-editor bioweave-character-editor-popover bioweave-compact-popup bioweave-pregnancy-knowledge-popover" role="dialog" aria-modal="true" aria-labelledby="bioweave-pregnancy-knowledge-title"><header class="bioweave-character-alias-head"><div><h3 id="bioweave-pregnancy-knowledge-title">${escapeHtml(title)}</h3><p>仅显示当前人物本次妊娠的已记录知情人</p></div><button type="button" class="bioweave-button bioweave-character-alias-close" data-bioweave-action="close-character-pregnancy-knowledge" aria-label="关闭知情名单">×</button></header><div class="bioweave-pregnancy-knowledge-body">${content}</div></section>`;
}

export {escapeHtml};
