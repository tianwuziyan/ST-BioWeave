import {renderAnalysisInputPreview} from './settings.js';

const CAPABILITY_LABELS = Object.freeze({
  can_produce_sperm: '可产生精子',
  can_produce_ova: '可产生卵细胞',
  can_be_fertilized: '可被受精',
  can_fertilize: '可使其他生物受精',
  can_carry_pregnancy: '可承担妊娠',
});

const RULE_LABELS = Object.freeze({
  ovulation: '排卵规则',
  fertilization: '受精规则',
  pregnancy_or_carrying: '妊娠 / 孕育规则',
  gestation: '妊娠周期',
  labor: '产程周期',
  cycle: '周期规则',
});

const MEDICAL_CONTEXT_LABELS = Object.freeze({
  childbirth_difficulty: '生育难易度',
  care_level: '医疗支持水平',
  evidence: '医疗条件依据',
});

const LIFECYCLE_LABELS = Object.freeze({
  maturation: '成熟规则',
  aging: '衰老规则',
});

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function displayText(value) {
  if (value === null || value === undefined || value === '') return '未知';
  return escapeHtml(value);
}

function displayBoolean(value) {
  if (value === true) return '是';
  if (value === false) return '否';
  return '未知';
}

function displayList(values) {
  const items = Array.isArray(values) ? values.filter(value => String(value ?? '').trim()) : [];
  if (!items.length) return '<span class="bioweave-world-model-unknown">未知</span>';
  return '<ul>' + items.map(value => '<li>' + displayText(value) + '</li>').join('') + '</ul>';
}

function formatTime(value) {
  if (!value) return '未知';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '未知' : escapeHtml(date.toLocaleString('zh-CN'));
}

function renderSourceSummary(meta = {}) {
  const summary = meta?.source_summary ?? {};
  const recent = summary.recent_story ?? {};
  const external = Array.isArray(summary.external_memory) ? summary.external_memory : [];
  const externalText = external.length
    ? external.map(item => {
      const rawStatus = String(item.status ?? '').trim().toLowerCase();
      const status = ['unknown', 'null', 'undefined', 'n/a', ''].includes(rawStatus)
        ? '未知'
        : item.status;
      return `${item.label || item.key || '外部来源'}：${status}`;
    }).join('；')
    : '无外部记忆来源';
  const recentText = recent.enabled
    ? `最近剧情 ${recent.floor_start ?? '未知'}-${recent.floor_end ?? '未知'} 楼`
    : '最近剧情未启用';
  return [
    `角色卡 ${Number(summary.character_fields) || 0} 项`,
    `世界书 ${Number(summary.worldbooks) || 0} 本 / ${Number(summary.worldbook_entries) || 0} 条目`,
    recentText,
    externalText,
    `约 ${Number(summary.token_estimate) || 0} 个 Token`,
  ].map(escapeHtml).join(' · ');
}

function renderCapabilityRows(capabilities = {}) {
  return Object.entries(CAPABILITY_LABELS).map(([key, label]) => [
    '<div class="bioweave-world-model-property">',
    '<dt>' + label + '</dt>',
    '<dd>' + displayBoolean(capabilities?.[key]) + '</dd>',
    '</div>',
  ].join('')).join('');
}

function renderRuleRows(rules = {}, labels = {}) {
  const source = rules && typeof rules === 'object' ? rules : {};
  return Object.entries(labels).map(([key, label]) => [
    '<div class="bioweave-world-model-property">',
    '<dt>' + label + '</dt>',
    '<dd>' + displayText(source[key]) + '</dd>',
    '</div>',
  ].join('')).join('');
}

function renderBiologicalTypeView(type, index) {
  return [
    '<article class="bioweave-world-model-type">',
    '<header><h5>' + (type?.name ? displayText(type.name) : '性别 / 生殖类型 ' + (index + 1)) + '</h5></header>',
    '<p class="bioweave-world-model-description">' + displayText(type?.description) + '</p>',
    '<h6>生殖能力</h6>',
    '<dl class="bioweave-world-model-properties">' + renderCapabilityRows(type?.capabilities) + '</dl>',
    '<h6>生殖与周期规则</h6>',
    '<dl class="bioweave-world-model-properties">' + renderRuleRows(type?.reproduction_rules, RULE_LABELS) + '</dl>',
    '<h6>成熟与衰老</h6>',
    '<dl class="bioweave-world-model-properties">' + renderRuleRows(type?.lifecycle, LIFECYCLE_LABELS) + '</dl>',
    '<h6>特殊生物规则</h6>',
    displayList(type?.special_rules),
    '</article>',
  ].join('');
}

function renderWorldModelView(model) {
  const species = Array.isArray(model?.species) ? model.species : [];
  const speciesMarkup = species.length
    ? species.map((item, speciesIndex) => {
      const types = Array.isArray(item?.biological_types) ? item.biological_types : [];
      const typeMarkup = types.length
        ? types.map(renderBiologicalTypeView).join('')
        : '<p class="bioweave-empty">本次资料只识别出该物种，尚未识别出具体性别 / 生殖类型。</p>';
      return [
        '<article class="bioweave-world-model-species">',
        '<header><h3>' + (item?.name ? displayText(item.name) : '物种 ' + (speciesIndex + 1)) + '</h3></header>',
        '<p class="bioweave-world-model-description">' + displayText(item?.description) + '</p>',
        '<h4>性别 / 生殖类型</h4>',
        typeMarkup,
        '</article>',
      ].join('');
    }).join('')
    : '<p class="bioweave-empty">当前没有足够信息建立物种规则。</p>';
  return [
    '<section class="bioweave-world-model-section">',
    '<h3>物种</h3>',
    speciesMarkup,
    '</section>',
    '<section class="bioweave-world-model-section">',
    '<h3>世界医疗条件</h3>',
    '<dl class="bioweave-world-model-properties">' + renderRuleRows(model?.medical_context, MEDICAL_CONTEXT_LABELS) + '</dl>',
    '</section>',
    '<section class="bioweave-world-model-section">',
    '<h3>明确例外</h3>',
    (Array.isArray(model?.exceptions) && model.exceptions.length
      ? '<ul>' + model.exceptions.map(item => '<li><strong>' + displayText(item?.statement) + '</strong><small>' + displayText(item?.applies_to || item?.evidence) + '</small></li>').join('') + '</ul>'
      : '<p class="bioweave-empty">未知</p>'),
    '</section>',
    '<section class="bioweave-world-model-section">',
    '<h3>未知 / 不确定信息</h3>',
    displayList(model?.unknowns),
    '</section>',
  ].join('');
}

function emptyWorldModelType() {
  return {
    name: null,
    description: null,
    capabilities: Object.fromEntries(Object.keys(CAPABILITY_LABELS).map(key => [key, null])),
    reproduction_rules: Object.fromEntries(Object.keys(RULE_LABELS).map(key => [key, null])),
    lifecycle: Object.fromEntries(Object.keys(LIFECYCLE_LABELS).map(key => [key, null])),
    special_rules: [],
  };
}

function emptyWorldModelSpecies() {
  return {
    name: null,
    description: null,
    biological_types: [],
  };
}

function option(value, label, selected) {
  return `<option value="${value}"${selected ? ' selected' : ''}>${label}</option>`;
}

function triStateSelect(key, value) {
  return [
    `<select class="bioweave-select" data-bioweave-world-capability="${key}">`,
    option('', '未知', value !== true && value !== false),
    option('true', '是', value === true),
    option('false', '否', value === false),
    '</select>',
  ].join('');
}

function renderWorldModelEditor(model = {}) {
  const species = Array.isArray(model.species) ? model.species : [];
  const exceptions = Array.isArray(model.exceptions) ? model.exceptions : [];
  const speciesMarkup = species.map((item, speciesIndex) => {
    const types = Array.isArray(item?.biological_types) ? item.biological_types : [];
    const typeMarkup = types.map((type, typeIndex) => [
      '<article class="bioweave-world-model-edit-type" data-bioweave-world-type>',
      '<header><h4>性别 / 生殖类型 ' + (typeIndex + 1) + '</h4>',
      '<button type="button" class="bioweave-danger-action" data-bioweave-action="world-model-remove-type">删除</button></header>',
      '<label class="bioweave-settings-field"><span>名称</span><input class="bioweave-input" data-bioweave-world-field="name" value="' + escapeHtml(type?.name ?? '') + '"></label>',
      '<label class="bioweave-settings-field"><span>说明</span><textarea class="bioweave-input" data-bioweave-world-field="description">' + escapeHtml(type?.description ?? '') + '</textarea></label>',
      '<h5>生殖能力</h5>',
      '<div class="bioweave-world-model-capability-edit">',
      Object.entries(CAPABILITY_LABELS).map(([key, label]) => '<label class="bioweave-settings-field"><span>' + label + '</span>' + triStateSelect(key, type?.capabilities?.[key]) + '</label>').join(''),
      '</div>',
      '<h5>生殖与周期规则</h5>',
      Object.entries(RULE_LABELS).map(([key, label]) => '<label class="bioweave-settings-field"><span>' + label + '</span><textarea class="bioweave-input" data-bioweave-world-rule="' + key + '">' + escapeHtml(type?.reproduction_rules?.[key] ?? '') + '</textarea></label>').join(''),
      '<h5>成熟与衰老</h5>',
      Object.entries(LIFECYCLE_LABELS).map(([key, label]) => '<label class="bioweave-settings-field"><span>' + label + '</span><textarea class="bioweave-input" data-bioweave-world-lifecycle="' + key + '">' + escapeHtml(type?.lifecycle?.[key] ?? '') + '</textarea></label>').join(''),
      '<label class="bioweave-settings-field"><span>特殊生物规则（每行一条）</span><textarea class="bioweave-input" data-bioweave-world-special-rules>' + escapeHtml((type?.special_rules ?? []).join('\n')) + '</textarea></label>',
      '</article>',
    ].join('')).join('');
    return [
      '<article class="bioweave-world-model-edit-species" data-bioweave-world-species>',
      '<header><h3>物种 ' + (speciesIndex + 1) + '</h3>',
      '<button type="button" class="bioweave-danger-action" data-bioweave-action="world-model-remove-species">删除物种</button></header>',
      '<label class="bioweave-settings-field"><span>物种名称</span><input class="bioweave-input" data-bioweave-world-species-field="name" value="' + escapeHtml(item?.name ?? '') + '"></label>',
      '<label class="bioweave-settings-field"><span>物种说明</span><textarea class="bioweave-input" data-bioweave-world-species-field="description">' + escapeHtml(item?.description ?? '') + '</textarea></label>',
      '<h4>性别 / 生殖类型</h4>',
      typeMarkup || '<p class="bioweave-empty">暂无性别 / 生殖类型，请只在资料有证据时添加。</p>',
      '<button type="button" class="bioweave-secondary-action" data-bioweave-action="world-model-add-type">添加性别 / 生殖类型</button>',
      '</article>',
    ].join('');
  }).join('');
  const medicalContext = model?.medical_context ?? {};
  const medicalMarkup = [
    '<section class="bioweave-world-model-edit-section" data-bioweave-world-medical-context><h3>世界医疗条件</h3>',
    Object.entries(MEDICAL_CONTEXT_LABELS).map(([key, label]) => '<label class="bioweave-settings-field"><span>' + label + '</span><textarea class="bioweave-input" data-bioweave-world-medical="' + key + '">' + escapeHtml(medicalContext[key] ?? '') + '</textarea></label>').join(''),
    '</section>',
  ].join('');
  const exceptionMarkup = exceptions.map(item => [
    '<article class="bioweave-world-model-edit-exception" data-bioweave-world-exception>',
    '<label class="bioweave-settings-field"><span>例外说明</span><input class="bioweave-input" data-bioweave-world-exception-field="statement" value="' + escapeHtml(item?.statement ?? '') + '"></label>',
    '<label class="bioweave-settings-field"><span>适用对象</span><input class="bioweave-input" data-bioweave-world-exception-field="applies_to" value="' + escapeHtml(item?.applies_to ?? '') + '"></label>',
    '<label class="bioweave-settings-field"><span>依据</span><textarea class="bioweave-input" data-bioweave-world-exception-field="evidence">' + escapeHtml(item?.evidence ?? '') + '</textarea></label>',
    '<button type="button" class="bioweave-danger-action" data-bioweave-action="world-model-remove-exception">删除此例外</button>',
    '</article>',
  ].join('')).join('');
  return [
    '<form class="bioweave-world-model-editor" data-bioweave-world-model-form>',
    speciesMarkup || '<p class="bioweave-empty">暂无物种，请点击“添加物种”。</p>',
    '<button type="button" class="bioweave-secondary-action" data-bioweave-action="world-model-add-species">添加物种</button>',
    medicalMarkup,
    '<section class="bioweave-world-model-edit-section"><h3>明确例外</h3>',
    exceptionMarkup || '<p class="bioweave-empty">暂无明确例外。</p>',
    '<button type="button" class="bioweave-secondary-action" data-bioweave-action="world-model-add-exception">添加明确例外</button>',
    '</section>',
    '<label class="bioweave-settings-field"><span>未知 / 不确定信息（每行一条）</span><textarea class="bioweave-input" data-bioweave-world-unknowns>' + escapeHtml((model.unknowns ?? []).join('\n')) + '</textarea></label>',
    '<div class="bioweave-settings-actions">',
    '<button type="button" class="bioweave-primary-action" data-bioweave-action="world-model-save">保存世界模型</button>',
    '<button type="button" class="bioweave-secondary-action" data-bioweave-action="world-model-cancel">取消</button>',
    '</div>',
    '</form>',
  ].join('');
}

export function worldPage({
  worldModel = null,
  worldModelMeta = null,
  worldModelBusy = false,
  worldModelEditing = false,
  worldModelDraft = null,
  worldModelNotice = null,
  showAnalysisInput = false,
  analysisPreview = {},
} = {}) {
  const model = worldModel ?? null;
  const notice = worldModelNotice
    ? '<p class="bioweave-settings-notice" role="status">' + escapeHtml(worldModelNotice) + '</p>'
    : '';
  const actions = worldModelEditing
    ? ''
    : [
      '<button type="button" class="bioweave-secondary-action" data-bioweave-action="world-model-view-input">',
      showAnalysisInput ? '收起本次分析输入' : '查看本次分析输入',
      '</button>',
      '<button type="button" class="bioweave-secondary-action" data-bioweave-action="world-model-edit"' + (!model ? ' disabled' : '') + '>编辑</button>',
      '<button type="button" class="bioweave-primary-action" data-bioweave-action="world-model-reanalyze"' + (worldModelBusy ? ' disabled' : '') + '>' + (worldModelBusy ? '分析中…' : (model ? '重新分析' : '开始分析')) + '</button>',
    ].join('');
  const metadata = model ? [
    '<section class="bioweave-world-model-meta bioweave-card">',
    '<strong>最后分析：' + formatTime(worldModelMeta?.last_analyzed_at) + '</strong>',
    '<span>最后保存：' + formatTime(worldModelMeta?.last_saved_at) + ' · ' + (worldModelMeta?.last_saved_by === 'manual' ? '手动编辑' : 'AI 分析') + '</span>',
    '<p>数据来源：' + renderSourceSummary(worldModelMeta) + '</p>',
    '</section>',
  ].join('') : '';
  const body = worldModelEditing
    ? renderWorldModelEditor(worldModelDraft ?? model ?? {schema_version: 1, species: [], exceptions: [], unknowns: []})
    : model
      ? renderWorldModelView(model)
      : '<section class="bioweave-card bioweave-empty"><b>世界模型尚未建立</b><p>点击“开始分析”，使用当前已选择的分析来源生成 Chat 独立的生物学规则。</p></section>';
  const inputPreview = showAnalysisInput
    ? renderAnalysisInputPreview({...analysisPreview, standalone: true, messagePreview: true})
    : '';
  return [
    '<section class="bioweave-page bioweave-world-model-page">',
    '<div class="bioweave-page-title"><div><h2>世界模型</h2><p class="bioweave-muted">当前 Chat 独立的生物学能力和规则定义</p></div><div class="bioweave-page-actions">' + actions + '</div></div>',
    notice,
    metadata,
    body,
    inputPreview,
    '</section>',
  ].join('');
}

export {emptyWorldModelSpecies, emptyWorldModelType};
