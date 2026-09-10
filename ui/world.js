const CAPABILITY_LABELS = Object.freeze({
  can_produce_sperm: '可产生精子',
  can_produce_ova: '可产生卵子',
  can_be_fertilized: '可被受精',
  can_fertilize: '可使其受精',
  can_carry_pregnancy: '可承担妊娠',
});

const RULE_LABELS = Object.freeze({
  fertilization: '受精方式',
  pregnancy_or_carrying: '妊娠方式',
  cycle: '生理周期',
  ovulation: '排卵机制',
  gestation: '妊娠周期',
  labor: '分娩方式',
});

const LIFECYCLE_LABELS = Object.freeze({
  maturation: '成熟',
  aging: '衰老',
});

const MEDICAL_CONTEXT_LABELS = Object.freeze({
  childbirth_difficulty: '分娩难度',
  care_level: '照护水平',
  evidence: '判断依据',
});

const SECTION_LABELS = Object.freeze({
  capabilities: '生殖能力',
  reproduction_rules: '生殖规则',
  lifecycle: '生命周期',
  special_rules: '特殊规则',
  medical_context: '医疗与照护',
  exceptions: '特殊例外',
  unknowns: '尚未确定',
});

const SECTION_ICONS = Object.freeze({
  capabilities: 'fa-dna',
  reproduction_rules: 'fa-shuffle',
  lifecycle: 'fa-clock',
  special_rules: 'fa-star',
  medical_context: 'fa-briefcase-medical',
  exceptions: 'fa-triangle-exclamation',
  unknowns: 'fa-circle-question',
});

const TYPE_SECTION_KEYS = Object.freeze([
  'capabilities',
  'reproduction_rules',
  'lifecycle',
  'special_rules',
]);

const WORLD_SECTION_KEYS = Object.freeze([
  'medical_context',
  'exceptions',
  'unknowns',
]);

export const WORLD_MODEL_SECTION_KEYS = Object.freeze([
  ...TYPE_SECTION_KEYS,
  ...WORLD_SECTION_KEYS,
]);

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function cloneValue(value) {
  if (value === undefined) return undefined;
  if (typeof globalThis.structuredClone === 'function') {
    try {
      return globalThis.structuredClone(value);
    } catch {
      // 仅包含 JSON 数据的 World Model 会走下面的轻量复制路径。
    }
  }
  if (Array.isArray(value)) return value.map(item => cloneValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  }
  return value;
}

function displayText(value) {
  if (value === null || value === undefined || value === '') return '未知';
  return escapeHtml(value);
}

function displayBoolean(value) {
  if (value === true || value === 'true') return '是';
  if (value === false || value === 'false') return '否';
  return '未知';
}

function displayList(values) {
  const items = Array.isArray(values) ? values.filter(value => String(value ?? '').trim()) : [];
  if (!items.length) return '<span class="bioweave-world-model-unknown">未知</span>';
  return '<ul>' + items.map(value => '<li>' + displayText(value) + '</li>').join('') + '</ul>';
}

function formatAnalysisTime(value) {
  if (!value) return '未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知';
  const pad = part => String(part).padStart(2, '0');
  return escapeHtml([
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('/') + ` ${pad(date.getHours())}:${pad(date.getMinutes())}`);
}

function renderSourceSummary(meta = {}) {
  const summary = meta?.source_summary ?? {};
  const recent = summary.recent_story ?? {};
  const external = Array.isArray(summary.external_memory) ? summary.external_memory : [];
  const sources = [];
  if (Number(summary.character_fields) > 0) sources.push('角色卡');
  if (Number(summary.worldbooks) > 0) sources.push(`${Number(summary.worldbooks)} 本世界书`);

  const toFloorNumber = value => (
    value === null || value === undefined || value === ''
      ? null
      : (Number.isFinite(Number(value)) ? Number(value) : null)
  );
  const floorStart = toFloorNumber(recent.floor_start);
  const floorEnd = toFloorNumber(recent.floor_end);
  const floorsRead = Number(recent.floors_read) || (
    floorStart !== null && floorEnd !== null
      ? Math.max(0, floorEnd - floorStart + 1)
      : 0
  );
  if (recent.enabled === true && (floorsRead > 0 || (floorStart !== null && floorEnd !== null))) {
    const recentText = floorStart !== null && floorEnd !== null && floorStart !== floorEnd
      ? `最近剧情 F${floorStart}-F${floorEnd}`
      : `最近剧情 ${floorsRead} 楼`;
    sources.push(recentText);
  }

  external
    .filter(item => item?.enabled === true && item?.read_status === 'success')
    .forEach(item => sources.push(item.label || item.key || '外部来源'));

  return sources.length
    ? sources.map(escapeHtml).join(' · ')
    : '暂无已记录来源';
}

function renderPropertyRows(values, labels) {
  const source = values && typeof values === 'object' ? values : {};
  return Object.entries(labels).map(([key, label]) => [
    '<div class="bioweave-world-model-property bioweave-world-model-kv-row">',
    '<dt>' + label + '</dt>',
    '<dd>' + displayText(source[key]) + '</dd>',
    '</div>',
  ].join('')).join('');
}

function renderCapabilityRows(capabilities = {}) {
  return Object.entries(CAPABILITY_LABELS).map(([key, label]) => [
    '<div class="bioweave-world-model-property bioweave-world-model-kv-row">',
    '<dt>' + label + '</dt>',
    '<dd>' + displayBoolean(capabilities?.[key]) + '</dd>',
    '</div>',
  ].join('')).join('');
}

function renderExceptions(exceptions) {
  const items = Array.isArray(exceptions) ? exceptions : [];
  if (!items.length) return '<p class="bioweave-empty">未知</p>';
  return '<ul>' + items.map(item => {
    const details = [
      ['适用对象', item?.applies_to],
      ['依据', item?.evidence],
    ]
      .filter(([, value]) => String(value ?? '').trim())
      .map(([label, value]) => '<small>' + label + '：' + displayText(value) + '</small>')
      .join('');
    return '<li><strong>' + displayText(item?.statement) + '</strong>' + details + '</li>';
  }).join('') + '</ul>';
}

export function resolveWorldModelSelection(model, requestedSpeciesIndex = null, requestedTypeIndex = null) {
  const species = Array.isArray(model?.species) ? model.species : [];
  if (!species.length) return {speciesIndex: null, typeIndex: null};
  const requestedSpecies = Number.isInteger(requestedSpeciesIndex)
    && requestedSpeciesIndex >= 0
    && requestedSpeciesIndex < species.length
    ? requestedSpeciesIndex
    : null;
  const firstTypedSpecies = species.findIndex(item => Array.isArray(item?.biological_types) && item.biological_types.length);
  const speciesIndex = requestedSpecies ?? (firstTypedSpecies >= 0 ? firstTypedSpecies : 0);
  const types = Array.isArray(species[speciesIndex]?.biological_types)
    ? species[speciesIndex].biological_types
    : [];
  const typeIndex = Number.isInteger(requestedTypeIndex)
    && requestedTypeIndex >= 0
    && requestedTypeIndex < types.length
    ? requestedTypeIndex
    : (types.length ? 0 : null);
  return {speciesIndex, typeIndex};
}

function emptySectionValue(section) {
  if (section === 'capabilities') return Object.fromEntries(Object.keys(CAPABILITY_LABELS).map(key => [key, null]));
  if (section === 'reproduction_rules') return Object.fromEntries(Object.keys(RULE_LABELS).map(key => [key, null]));
  if (section === 'lifecycle') return Object.fromEntries(Object.keys(LIFECYCLE_LABELS).map(key => [key, null]));
  if (section === 'medical_context') return Object.fromEntries(Object.keys(MEDICAL_CONTEXT_LABELS).map(key => [key, null]));
  return [];
}

export function getWorldModelSection(model, section, {
  selectedSpeciesIndex = null,
  selectedTypeIndex = null,
  speciesIndex = null,
  typeIndex = null,
} = {}) {
  if (!WORLD_MODEL_SECTION_KEYS.includes(section)) return null;
  if (WORLD_SECTION_KEYS.includes(section)) return cloneValue(model?.[section] ?? emptySectionValue(section));
  const selection = resolveWorldModelSelection(
    model,
    selectedSpeciesIndex ?? speciesIndex,
    selectedTypeIndex ?? typeIndex,
  );
  const type = selection.speciesIndex === null || selection.typeIndex === null
    ? null
    : model?.species?.[selection.speciesIndex]?.biological_types?.[selection.typeIndex];
  return cloneValue(type?.[section] ?? emptySectionValue(section));
}

function textOrNull(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizeTextRecord(value, labels) {
  const source = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(Object.keys(labels).map(key => [key, textOrNull(source[key])]));
}

function normalizeCapabilities(value) {
  const source = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(Object.keys(CAPABILITY_LABELS).map(key => {
    if (source[key] === true || source[key] === 'true') return [key, true];
    if (source[key] === false || source[key] === 'false') return [key, false];
    return [key, null];
  }));
}

function normalizeStringList(value) {
  return (Array.isArray(value) ? value : [])
    .map(item => String(item ?? '').trim())
    .filter(Boolean);
}

function normalizeExceptions(value) {
  return (Array.isArray(value) ? value : []).map(item => {
    const source = typeof item === 'string'
      ? {statement: item}
      : item && typeof item === 'object' && !Array.isArray(item)
        ? item
        : {};
    return {
      statement: textOrNull(source.statement ?? source.description),
      applies_to: textOrNull(source.applies_to),
      evidence: textOrNull(source.evidence),
    };
  });
}

function normalizeSectionValue(section, value) {
  if (section === 'capabilities') return normalizeCapabilities(value);
  if (section === 'reproduction_rules') return normalizeTextRecord(value, RULE_LABELS);
  if (section === 'lifecycle') return normalizeTextRecord(value, LIFECYCLE_LABELS);
  if (section === 'medical_context') return normalizeTextRecord(value, MEDICAL_CONTEXT_LABELS);
  if (section === 'exceptions') return normalizeExceptions(value);
  return normalizeStringList(value);
}

export function applyWorldModelSection(model, section, value, {
  selectedSpeciesIndex = null,
  selectedTypeIndex = null,
  speciesIndex = null,
  typeIndex = null,
} = {}) {
  const next = cloneValue(model ?? {});
  if (!WORLD_MODEL_SECTION_KEYS.includes(section)) return next;
  const normalizedValue = normalizeSectionValue(section, value);
  if (WORLD_SECTION_KEYS.includes(section)) {
    next[section] = normalizedValue;
    return next;
  }
  const selection = resolveWorldModelSelection(
    next,
    selectedSpeciesIndex ?? speciesIndex,
    selectedTypeIndex ?? typeIndex,
  );
  if (selection.speciesIndex === null || selection.typeIndex === null) return next;
  const species = Array.isArray(next.species) ? next.species : [];
  const selectedSpecies = species[selection.speciesIndex];
  const types = Array.isArray(selectedSpecies?.biological_types) ? selectedSpecies.biological_types : [];
  if (!types[selection.typeIndex]) return next;
  next.species[selection.speciesIndex].biological_types[selection.typeIndex] = {
    ...types[selection.typeIndex],
    [section]: normalizedValue,
  };
  return next;
}

function getSectionField(form, key) {
  return form?.querySelector?.(`[data-bioweave-world-section-field="${key}"]`);
}

function readFormText(node) {
  return String(node?.value ?? '').trim();
}

export function extractWorldModelSection(formOrSection, sectionOrForm) {
  const form = typeof formOrSection === 'string' ? sectionOrForm : formOrSection;
  const section = typeof formOrSection === 'string'
    ? formOrSection
    : String(sectionOrForm ?? form?.dataset?.bioweaveWorldSection ?? '');
  if (!WORLD_MODEL_SECTION_KEYS.includes(section)) return null;
  if (section === 'capabilities') {
    return normalizeCapabilities(Object.fromEntries(Object.keys(CAPABILITY_LABELS).map(key => {
      const value = readFormText(getSectionField(form, key));
      return [key, value === 'true' ? true : value === 'false' ? false : null];
    })));
  }
  if (section === 'reproduction_rules') {
    return normalizeTextRecord(Object.fromEntries(Object.keys(RULE_LABELS).map(key => [key, readFormText(getSectionField(form, key))])), RULE_LABELS);
  }
  if (section === 'lifecycle') {
    return normalizeTextRecord(Object.fromEntries(Object.keys(LIFECYCLE_LABELS).map(key => [key, readFormText(getSectionField(form, key))])), LIFECYCLE_LABELS);
  }
  if (section === 'medical_context') {
    return normalizeTextRecord(Object.fromEntries(Object.keys(MEDICAL_CONTEXT_LABELS).map(key => [key, readFormText(getSectionField(form, key))])), MEDICAL_CONTEXT_LABELS);
  }
  if (section === 'exceptions') {
    const rows = [...(form?.querySelectorAll?.('[data-bioweave-world-section-row="exceptions"]') ?? [])];
    return normalizeExceptions(rows.map(row => ({
      statement: readFormText(getSectionField(row, 'statement')),
      applies_to: readFormText(getSectionField(row, 'applies_to')),
      evidence: readFormText(getSectionField(row, 'evidence')),
    })));
  }
  const rows = [...(form?.querySelectorAll?.(`[data-bioweave-world-section-row="${section}"]`) ?? [])];
  return normalizeStringList(rows.map(row => readFormText(getSectionField(row, 'value'))));
}

function renderPropertyList(values, labels) {
  return '<dl class="bioweave-world-model-properties bioweave-world-model-kv">' + renderPropertyRows(values, labels) + '</dl>';
}

function renderSectionEditButton(section, busy) {
  return `<button type="button" class="bioweave-secondary-action bioweave-world-model-edit-button" data-bioweave-action="world-model-edit-section" data-bioweave-world-section="${section}"${busy ? ' disabled' : ''}><i class="fa-solid fa-pen" aria-hidden="true"></i><span>编辑</span></button>`;
}

function renderTextEditorField(key, label, value, multiline = true) {
  const text = escapeHtml(value ?? '');
  return multiline
    ? `<label class="bioweave-settings-field bioweave-world-model-field"><span>${label}</span><textarea class="bioweave-input" data-bioweave-world-section-field="${key}">${text}</textarea></label>`
    : `<label class="bioweave-settings-field bioweave-world-model-field"><span>${label}</span><input class="bioweave-input" data-bioweave-world-section-field="${key}" value="${text}"></label>`;
}

function renderSectionEditor(section, value, busy) {
  if (section === 'capabilities') {
    const fields = Object.entries(CAPABILITY_LABELS).map(([key, label]) => {
      const current = value?.[key];
      return [
        '<label class="bioweave-settings-field bioweave-world-model-field bioweave-world-model-tristate-field"><span>' + label + '</span>',
        `<select class="bioweave-select" data-bioweave-world-section-field="${key}">`,
        `<option value="true"${current === true ? ' selected' : ''}>是</option>`,
        `<option value="false"${current === false ? ' selected' : ''}>否</option>`,
        `<option value=""${current !== true && current !== false ? ' selected' : ''}>未知</option>`,
        '</select></label>',
      ].join('');
    }).join('');
    return `<div class="bioweave-world-model-section-editor bioweave-world-model-editor bioweave-world-model-capability-edit">${fields}${renderSectionEditorActions(busy)}</div>`;
  }
  if (section === 'reproduction_rules') {
    return `<div class="bioweave-world-model-section-editor bioweave-world-model-editor">${Object.entries(RULE_LABELS).map(([key, label]) => renderTextEditorField(key, label, value?.[key])).join('')}${renderSectionEditorActions(busy)}</div>`;
  }
  if (section === 'lifecycle') {
    return `<div class="bioweave-world-model-section-editor bioweave-world-model-editor">${Object.entries(LIFECYCLE_LABELS).map(([key, label]) => renderTextEditorField(key, label, value?.[key])).join('')}${renderSectionEditorActions(busy)}</div>`;
  }
  if (section === 'medical_context') {
    return `<div class="bioweave-world-model-section-editor bioweave-world-model-editor">${Object.entries(MEDICAL_CONTEXT_LABELS).map(([key, label]) => renderTextEditorField(key, label, value?.[key])).join('')}${renderSectionEditorActions(busy)}</div>`;
  }
  if (section === 'special_rules' || section === 'unknowns') {
    const rows = (Array.isArray(value) ? value : []).map((item, index) => [
      `<div class="bioweave-world-model-list-editor-row" data-bioweave-world-section-row="${section}">`,
      `<input class="bioweave-input" data-bioweave-world-section-field="value" value="${escapeHtml(item)}">`,
      `<button type="button" class="bioweave-danger-action" data-bioweave-action="world-model-remove-row" data-bioweave-world-section="${section}" data-bioweave-world-row-index="${index}">删除</button>`,
      '</div>',
    ].join('')).join('');
    return [
      '<div class="bioweave-world-model-section-editor bioweave-world-model-editor">',
      rows || '<p class="bioweave-empty">暂无内容。</p>',
      `<button type="button" class="bioweave-secondary-action" data-bioweave-action="world-model-add-row" data-bioweave-world-section="${section}">添加</button>`,
      renderSectionEditorActions(busy),
      '</div>',
    ].join('');
  }
  const rows = (Array.isArray(value) ? value : []).map((item, index) => [
    '<fieldset class="bioweave-world-model-exception-editor" data-bioweave-world-section-row="exceptions">',
    '<legend>例外 ' + (index + 1) + '</legend>',
    renderTextEditorField('statement', '例外说明', item?.statement, false),
    renderTextEditorField('applies_to', '适用对象', item?.applies_to, false),
    renderTextEditorField('evidence', '依据', item?.evidence),
    `<button type="button" class="bioweave-danger-action" data-bioweave-action="world-model-remove-row" data-bioweave-world-section="exceptions" data-bioweave-world-row-index="${index}">删除</button>`,
    '</fieldset>',
  ].join('')).join('');
  return [
    '<div class="bioweave-world-model-section-editor bioweave-world-model-editor">',
    rows || '<p class="bioweave-empty">暂无特殊例外。</p>',
    '<button type="button" class="bioweave-secondary-action" data-bioweave-action="world-model-add-row" data-bioweave-world-section="exceptions">添加例外</button>',
    renderSectionEditorActions(busy),
    '</div>',
  ].join('');
}

function renderSectionEditorActions(busy) {
  return [
    '<div class="bioweave-settings-actions bioweave-world-model-section-actions bioweave-world-model-editor-actions">',
    '<button type="button" class="bioweave-secondary-action" data-bioweave-action="world-model-cancel-section"' + (busy ? ' disabled' : '') + '>取消</button>',
    '<button type="button" class="bioweave-primary-action" data-bioweave-action="world-model-save-section"' + (busy ? ' disabled' : '') + '>保存</button>',
    '</div>',
  ].join('');
}

function renderSectionEditorForm(section, value, busy) {
  return `<form class="bioweave-world-model-section-form" data-bioweave-world-section-form data-bioweave-world-section="${section}">${renderSectionEditor(section, value, busy)}</form>`;
}

function renderWorldSection(section, value, editingSection, sectionDraft, busy) {
  const label = SECTION_LABELS[section];
  const isEditing = editingSection === section;
  const content = isEditing
    ? renderSectionEditorForm(section, sectionDraft ?? value, busy)
    : section === 'medical_context'
      ? renderPropertyList(value, MEDICAL_CONTEXT_LABELS)
      : section === 'exceptions'
        ? renderExceptions(value)
        : section === 'unknowns'
          ? displayList(value)
          : section === 'capabilities'
            ? '<dl class="bioweave-world-model-properties">' + renderCapabilityRows(value) + '</dl>'
            : section === 'reproduction_rules'
              ? renderPropertyList(value, RULE_LABELS)
              : section === 'lifecycle'
                ? renderPropertyList(value, LIFECYCLE_LABELS)
                : displayList(value);
  return [
    `<section class="bioweave-world-model-section bioweave-world-model-module${isEditing ? ' active' : ''}" data-bioweave-world-section="${section}">`,
    '<header class="bioweave-world-model-module-header">',
    '<div class="bioweave-world-model-module-heading"><span class="bioweave-world-model-module-icon"><i class="fa-solid ' + SECTION_ICONS[section] + '" aria-hidden="true"></i></span><h3 class="bioweave-world-model-module-title">' + label + '</h3></div>',
    '<span class="bioweave-world-model-module-spacer" aria-hidden="true"></span>',
    isEditing ? '' : renderSectionEditButton(section, busy),
    '</header>',
    content,
    '</section>',
  ].join('');
}

function renderSpeciesSelector(model, selection) {
  const species = Array.isArray(model?.species) ? model.species : [];
  if (!species.length) {
    return [
      '<section class="bioweave-world-model-section bioweave-world-model-species-selector">',
      '<div class="bioweave-world-model-section-heading"><div><h3>物种与生物类型</h3><p>当前世界中已识别的物种及其生物类型；点击类型查看详细规则。</p></div></div>',
      '<p class="bioweave-empty">当前没有足够信息建立物种规则。</p>',
      '</section>',
    ].join('');
  }
  const cards = species.map((item, speciesIndex) => {
    const types = Array.isArray(item?.biological_types) ? item.biological_types : [];
    const selectedSpecies = selection.speciesIndex === speciesIndex;
    const typeButtons = types.length
      ? types.map((type, typeIndex) => [
        `<button type="button" class="bioweave-world-model-type-button${selectedSpecies && selection.typeIndex === typeIndex ? ' active' : ''}" data-bioweave-action="world-model-select-type" data-bioweave-world-species-index="${speciesIndex}" data-bioweave-world-type-index="${typeIndex}" aria-pressed="${selectedSpecies && selection.typeIndex === typeIndex}">`,
        displayText(type?.name || `生物类型 ${typeIndex + 1}`),
        '</button>',
      ].join('')).join('')
      : '<p class="bioweave-empty">尚未识别出生物类型。</p>';
    return [
      `<article class="bioweave-world-model-species-card${selectedSpecies ? ' active' : ''}" data-bioweave-world-species-index="${speciesIndex}">`,
      '<header>',
      `<button type="button" class="bioweave-world-model-species-button" data-bioweave-action="world-model-select-species" data-bioweave-world-species-index="${speciesIndex}" aria-pressed="${selectedSpecies}"><i class="fa-solid fa-dna" aria-hidden="true"></i><span>${displayText(item?.name || `物种 ${speciesIndex + 1}`)}</span></button>`,
      '</header>',
      '<p class="bioweave-world-model-description">' + displayText(item?.description) + '</p>',
      '<div class="bioweave-world-model-type-selector" aria-label="' + displayText(item?.name || '生物类型') + '分类">',
      typeButtons,
      '</div>',
      '</article>',
    ].join('');
  }).join('');
  return [
    '<section class="bioweave-world-model-section bioweave-world-model-species-selector">',
    '<div class="bioweave-world-model-section-heading"><div><h3>物种与生物类型</h3><p>当前世界中已识别的物种及其生物类型；点击类型查看详细规则。</p></div></div>',
    '<div class="bioweave-world-model-species-grid">' + cards + '</div>',
    '</section>',
  ].join('');
}

function renderSelectedTypeDetail(model, selection, editingSection, sectionDraft, busy) {
  const species = model?.species?.[selection.speciesIndex];
  const type = species?.biological_types?.[selection.typeIndex];
  if (!species) {
    return '<section class="bioweave-world-model-section bioweave-world-model-type-detail bioweave-world-model-frame"><header class="bioweave-world-model-detail-header"><div><h3>生物类型详情</h3><p>当前选择：<strong>未知</strong></p></div></header><p class="bioweave-empty">暂无可展示的生物类型。</p></section>';
  }
  if (!type) {
    return [
      '<section class="bioweave-world-model-section bioweave-world-model-type-detail bioweave-world-model-frame">',
      '<header class="bioweave-world-model-detail-header"><div><h3>生物类型详情</h3><p>当前选择：<strong>' + displayText(species.name || `物种 ${selection.speciesIndex + 1}`) + '</strong></p></div><span class="bioweave-world-model-detail-spacer" aria-hidden="true"></span><button type="button" class="bioweave-secondary-action bioweave-world-model-switch-button" data-bioweave-action="world-model-focus-selector">切换类型</button></header>',
      '<p class="bioweave-empty">尚未识别出生物类型。</p>',
      '</section>',
    ].join('');
  }
  const sectionValue = section => getWorldModelSection(model, section, selection);
  return [
    '<section class="bioweave-world-model-section bioweave-world-model-type-detail bioweave-world-model-frame">',
    '<header class="bioweave-world-model-detail-header"><div><h3>生物类型详情</h3><p>当前选择：<strong>' + displayText(species.name || `物种 ${selection.speciesIndex + 1}`) + ' / ' + displayText(type.name || `生物类型 ${selection.typeIndex + 1}`) + '</strong></p></div><span class="bioweave-world-model-detail-spacer" aria-hidden="true"></span><button type="button" class="bioweave-secondary-action bioweave-world-model-switch-button" data-bioweave-action="world-model-focus-selector">切换类型</button></header>',
    '<p class="bioweave-world-model-description">' + displayText(type.description) + '</p>',
    '<div class="bioweave-world-model-type-sections bioweave-world-model-module-grid">',
    TYPE_SECTION_KEYS.map(section => renderWorldSection(section, sectionValue(section), editingSection, editingSection === section ? sectionDraft : null, busy)).join(''),
    '</div>',
    '</section>',
  ].join('');
}

export function renderWorldModelView(model, {
  selectedSpeciesIndex = null,
  selectedTypeIndex = null,
  editingSection = null,
  sectionDraft = null,
  busy = false,
} = {}) {
  const selection = resolveWorldModelSelection(model, selectedSpeciesIndex, selectedTypeIndex);
  const sectionValue = section => getWorldModelSection(model, section, selection);
  return [
    renderSpeciesSelector(model, selection),
    '<div class="bioweave-world-model-content-grid">',
    '<div class="bioweave-world-model-detail-column">',
    renderSelectedTypeDetail(model, selection, editingSection, sectionDraft, busy),
    '</div>',
    '<aside class="bioweave-world-model-world-column">',
    '<section class="bioweave-world-model-section bioweave-world-model-world-rules bioweave-world-model-frame">',
    '<header class="bioweave-world-model-world-title"><h3>世界级规则</h3></header>',
    '<div class="bioweave-world-model-world-stack">',
    WORLD_SECTION_KEYS.map(section => renderWorldSection(section, sectionValue(section), editingSection, editingSection === section ? sectionDraft : null, busy)).join(''),
    '</div>',
    '</section>',
    '</aside>',
    '</div>',
  ].join('');
}

export function worldPage({
  worldModel = null,
  worldModelMeta = null,
  worldModelBusy = false,
  selectedSpeciesIndex = null,
  selectedTypeIndex = null,
  editingSection = null,
  sectionDraft = null,
  worldModelNotice = null,
} = {}) {
  const model = worldModel ?? null;
  const notice = worldModelNotice
    ? '<p class="bioweave-settings-notice" role="status">' + escapeHtml(worldModelNotice) + '</p>'
    : '';
  const actions = [
    '<button type="button" class="bioweave-primary-action" data-bioweave-action="world-model-reanalyze">' + (worldModelBusy ? '分析中…' : (model ? '重新分析' : '开始分析')) + '</button>',
    '<button type="button" class="bioweave-secondary-action" data-bioweave-action="world-model-view-input">查看本次分析输入</button>',
  ].join('');
  const metadata = model ? [
    '<div class="bioweave-world-model-meta" aria-label="世界模型摘要">',
    '<span><strong>最后分析：</strong>' + formatAnalysisTime(worldModelMeta?.last_analyzed_at) + '</span>',
    '<span class="bioweave-world-model-meta-source"><strong>来源：</strong>' + renderSourceSummary(worldModelMeta) + '</span>',
    '</div>',
  ].join('') : '';
  const body = model
    ? renderWorldModelView(model, {
      selectedSpeciesIndex,
      selectedTypeIndex,
      editingSection,
      sectionDraft,
      busy: worldModelBusy,
    })
    : '<section class="bioweave-card bioweave-empty"><b>世界模型尚未建立</b><p>点击“开始分析”，使用当前已选择的分析来源生成 Chat 独立的生物学规则。</p></section>';
  return [
    '<section class="bioweave-page bioweave-world-model-page">',
    '<header class="bioweave-page-title bioweave-world-model-titlebar bioweave-world-model-top' + (model ? '' : ' bioweave-world-model-top-empty') + '"><div class="bioweave-world-model-title-copy"><h2>世界模型</h2><p class="bioweave-muted">探索并管理当前聊天的世界观设定与生物规则</p></div>' + metadata + '<div class="bioweave-page-actions">' + actions + '</div></header>',
    notice,
    body,
    '</section>',
  ].join('');
}

export {
  CAPABILITY_LABELS,
  RULE_LABELS,
  LIFECYCLE_LABELS,
  MEDICAL_CONTEXT_LABELS,
  SECTION_LABELS,
};
