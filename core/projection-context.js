export const PROJECTION_CONTEXT_INJECTION_KEY = 'bioweave_projection_context';
export const PROJECTION_CONTEXT_POSITION = 'IN_CHAT';
export const PROJECTION_CONTEXT_DEPTH = 4;
export const PROJECTION_CONTEXT_ROLE = 'SYSTEM';

function clone(value) {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  if (Array.isArray(value)) return value.map(clone);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function list(value) {
  return Array.isArray(value) ? value.slice() : [];
}

function sortViews(left, right) {
  const leftProjection = left?.projection ?? left ?? {};
  const rightProjection = right?.projection ?? right ?? {};
  const fields = [
    ['subject_id', ''],
    ['development_concern_key', ''],
    ['projection_rule_id', ''],
  ];
  for (const [field, fallback] of fields) {
    const comparison = String(leftProjection[field] ?? fallback).localeCompare(
      String(rightProjection[field] ?? fallback),
    );
    if (comparison) return comparison;
  }
  return String(leftProjection.created_at_floor_version?.message_id ?? '').localeCompare(
    String(rightProjection.created_at_floor_version?.message_id ?? ''),
  );
}

function normalizeAttribution(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.conflict === true || value.status === 'conflicted' || list(value.conflicts).length) {
    return {status: 'unresolved', conflict: true, candidates: []};
  }
  const confirmed = list(value.confirmed)
    .filter(item => text(item?.source_character_id))
    .map(item => ({
      source_character_id: item.source_character_id,
      contribution_kind: text(item.contribution_kind) || null,
    }));
  const candidates = list(value.candidates)
    .filter(item => text(item?.source_character_id))
    .map(item => ({
      source_character_id: item.source_character_id,
      contribution_kind: text(item.contribution_kind) || null,
    }));
  return {
    status: value.unresolved === true || !confirmed.length ? 'unresolved' : 'confirmed',
    conflict: false,
    confirmed,
    candidates,
  };
}

export function buildProjectionContextDTO(views = [], {attributionBySubject = {}} = {}) {
  const seen = new Set();
  return list(views)
    .filter(view => view?.context_visible === true)
    .sort(sortViews)
    .filter(view => {
      const id = text(view?.projection_id);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map(view => {
      const projection = view;
      const attribution = normalizeAttribution(attributionBySubject?.[projection.subject_id]);
      return {
        subject_id: projection.subject_id,
        development_kind: projection.development?.kind ?? null,
        description: projection.development?.next_signal ?? '',
        mechanism: text(projection.mechanism?.key) ? {key: projection.mechanism.key} : null,
        ...(attribution ? {attribution} : {}),
      };
    });
}

export function buildProjectionContextPrompt(context = []) {
  const entries = Array.isArray(context) ? context : [];
  if (!entries.length) return '';
  const lines = [
    'BioWeave 生物发展方向（仅供剧情参考，不是已经发生的事实）：',
    '以下内容描述未来可能的方向；本轮不要求兑现，也不得将其改写成已确认事实。',
  ];
  for (const entry of entries) {
    lines.push(`- 角色 ${entry.subject_id}：`);
    if (entry.development_kind) lines.push(`  - 发展类型：${entry.development_kind}`);
    if (entry.mechanism?.key) lines.push(`  - 机制背景：${entry.mechanism.key}`);
    if (entry.description) lines.push(`  - 可能的发展方向：${entry.description}`);
    const attribution = entry.attribution;
    if (attribution?.conflict) {
      lines.push('  - 生殖来源归因存在冲突，保持未确认，不要把任何来源写成已确认事实。');
    } else if (attribution?.candidates?.length) {
      lines.push('  - 存在多个尚未确认的来源候选；不要选择、排序或赋予概率。');
    } else if (attribution?.status === 'unresolved') {
      lines.push('  - 生殖来源归因仍未确认；不要自行选择来源。');
    } else if (attribution?.confirmed?.length) {
      lines.push('  - 已确认的生殖贡献者是当前事实背景；不要据此新增未确认归因。');
    }
  }
  lines.push('如果正文自然写出新的生物事实，BioWeave 将在后续 Event Analysis 中单独判断；Projection 注入本身不会产生 Event。');
  return lines.join('\n');
}

export function buildProjectionContext(views, options = {}) {
  const dto = buildProjectionContextDTO(views, options);
  return {dto: clone(dto), prompt: buildProjectionContextPrompt(dto)};
}
