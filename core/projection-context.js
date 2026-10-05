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

function healthGuidanceDTO(guidance = []) {
  return list(guidance)
    .filter(item => text(item?.subject_id) && text(item?.body_site) && text(item?.guidance))
    .map(item => ({
      context_type: 'health_recovery_guidance',
      subject_id: item.subject_id,
      body_site: item.body_site,
      stage: text(item.stage) || null,
      guidance: item.guidance,
    }))
    .sort((left, right) =>
      String(left.subject_id).localeCompare(String(right.subject_id)) ||
      String(left.body_site).localeCompare(String(right.body_site)));
}

export function buildProjectionContextPrompt(context = []) {
  const entries = Array.isArray(context) ? context : [];
  if (!entries.length) return '';
  const projectionEntries = entries.filter(entry => entry?.context_type !== 'health_recovery_guidance');
  const healthEntries = entries.filter(entry => entry?.context_type === 'health_recovery_guidance');
  const lines = [];
  if (projectionEntries.length) {
    lines.push(
      'BioWeave 生物发展方向（仅供剧情参考，不是已经发生的事实）：',
      '以下内容描述未来可能的方向；本轮不要求兑现，也不得将其改写成已确认事实。',
    );
  }
  for (const entry of projectionEntries) {
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
  if (healthEntries.length) {
    lines.push(
      'BioWeave 恢复阶段身体表现指导（仅供剧情表现参考，不是新的事实）：',
      '这些信息只用于在当前动作、环境或剧情与相关身体问题有关时保持身体反应一致；无关场景可以完全不提。',
      '不要机械重复健康问题，也不要输出剩余天数、预计恢复日期、恢复百分比、deadline 或任何内部 Assessment 字段。',
    );
    for (const entry of healthEntries) {
      lines.push(`- 角色 ${entry.subject_id} 的${entry.body_site}：${entry.guidance}`);
    }
  }
  lines.push('Context 中的 Projection 与恢复指导都不是 Event evidence；只有正文真正写出的新内容，才由后续 Event Analysis 单独判断。');
  return lines.join('\n');
}

export function buildProjectionContext(views, options = {}) {
  const projectionDTO = buildProjectionContextDTO(views, options);
  const dto = [...projectionDTO, ...healthGuidanceDTO(options.healthGuidance)];
  return {dto: clone(dto), prompt: buildProjectionContextPrompt(dto)};
}
