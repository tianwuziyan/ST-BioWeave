const CAPABILITY_LABELS = Object.freeze({
  can_produce_sperm: '可产生精子',
  can_produce_ova: '可产生卵子',
  can_fertilize: '可使对方受精',
  can_be_fertilized: '可受精',
  can_cause_pregnancy: '可导致受孕',
  can_carry_pregnancy: '可承载妊娠',
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

function trimmedCollectionName(value) {
  const name = String(value ?? '').trim();
  return name || null;
}

export function createWorldModelSpecies(name) {
  return {
    name: trimmedCollectionName(name),
    description: null,
    biological_types: [],
  };
}

export function createWorldModelBiologicalType(name) {
  return {
    name: trimmedCollectionName(name),
    description: null,
    capabilities: {
      can_produce_sperm: null,
      can_produce_ova: null,
      can_be_fertilized: null,
      can_fertilize: null,
      can_cause_pregnancy: null,
      can_carry_pregnancy: null,
    },
    reproduction_rules: {
      fertilization: null,
      pregnancy_or_carrying: null,
      cycle: null,
      ovulation: null,
      gestation: null,
      labor: null,
    },
    lifecycle: {maturation: null, aging: null},
    special_rules: [],
  };
}

export function applyWorldModelCollectionEdit(model, {
  operation,
  speciesIndex = null,
  typeIndex = null,
  name = '',
} = {}) {
  const next = cloneValue(model ?? {});
  const species = Array.isArray(next.species) ? next.species : [];
  next.species = species;
  const trimmedName = trimmedCollectionName(name);
  if (operation === 'add-species') {
    if (!trimmedName || species.some(item => String(item?.name ?? '').trim() === trimmedName)) return {model: next, changed: false};
    next.species.push(createWorldModelSpecies(trimmedName));
    return {model: next, changed: true};
  }
  if (!Number.isInteger(speciesIndex) || speciesIndex < 0 || speciesIndex >= species.length) return {model: next, changed: false};
  if (operation === 'remove-species') {
    next.species.splice(speciesIndex, 1);
    return {model: next, changed: true};
  }
  const selectedSpecies = species[speciesIndex];
  if (operation === 'rename-species') {
    if (!trimmedName || String(selectedSpecies?.name ?? '').trim() === trimmedName || species.some((item, index) => index !== speciesIndex && String(item?.name ?? '').trim() === trimmedName)) {
      return {model: next, changed: false};
    }
    next.species[speciesIndex] = {...selectedSpecies, name: trimmedName};
    return {model: next, changed: true};
  }
  const types = Array.isArray(selectedSpecies?.biological_types) ? selectedSpecies.biological_types : [];
  next.species[speciesIndex] = {...selectedSpecies, biological_types: types};
  if (operation === 'add-biological-type') {
    if (!trimmedName || types.some(item => String(item?.name ?? '').trim() === trimmedName)) return {model: next, changed: false};
    next.species[speciesIndex].biological_types.push(createWorldModelBiologicalType(trimmedName));
    return {model: next, changed: true};
  }
  if (operation === 'remove-biological-type' && Number.isInteger(typeIndex) && typeIndex >= 0 && typeIndex < types.length) {
    next.species[speciesIndex].biological_types.splice(typeIndex, 1);
    return {model: next, changed: true};
  }
  if (operation === 'rename-biological-type' && Number.isInteger(typeIndex) && typeIndex >= 0 && typeIndex < types.length) {
    if (!trimmedName || String(types[typeIndex]?.name ?? '').trim() === trimmedName || types.some((item, index) => index !== typeIndex && String(item?.name ?? '').trim() === trimmedName)) {
      return {model: next, changed: false};
    }
    next.species[speciesIndex].biological_types[typeIndex] = {...types[typeIndex], name: trimmedName};
    return {model: next, changed: true};
  }
  return {model: next, changed: false};
}

function displayText(value) {
  if (value === null || value === undefined || value === '') return '未知';
  return escapeHtml(value);
}

function displayBooleanState(value) {
  if (value === true || value === 'true') {
    return {text: '是', className: 'bioweave-world-model-value-good'};
  }
  if (value === false || value === 'false') {
    return {text: '否', className: 'bioweave-world-model-value-no'};
  }
  return {text: '未知', className: 'bioweave-world-model-value-warn'};
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
  return Object.entries(CAPABILITY_LABELS).map(([key, label]) => {
    const value = displayBooleanState(capabilities?.[key]);
    return [
      '<div class="bioweave-world-model-property bioweave-world-model-kv-row">',
      '<dt>' + label + '</dt>',
      '<dd class="' + value.className + '">' + value.text + '</dd>',
      '</div>',
    ].join('');
  }).join('');
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

export function createWorldModelSelection(model, speciesIndex, typeIndex = null) {
  const species = Array.isArray(model?.species) ? model.species : [];
  const speciesItem = species[speciesIndex];
  if (!speciesItem) return null;
  const speciesName = String(speciesItem.name ?? '').trim();
  if (typeIndex === null || typeIndex === undefined) {
    return {kind: 'species', speciesIndex, typeIndex: null, speciesName};
  }
  const type = Array.isArray(speciesItem.biological_types) ? speciesItem.biological_types[typeIndex] : null;
  if (!type) return null;
  return {
    kind: 'biological_type',
    speciesIndex,
    typeIndex,
    speciesName,
    typeName: String(type.name ?? '').trim(),
  };
}

export function normalizeWorldModelSelection(model, selection) {
  if (!selection || !['species', 'biological_type'].includes(selection.kind)) return null;
  const speciesIndex = Number(selection.speciesIndex);
  const species = Array.isArray(model?.species) ? model.species : [];
  const speciesItem = Number.isInteger(speciesIndex) ? species[speciesIndex] : null;
  if (!speciesItem) return null;
  if (selection.speciesName !== undefined && String(speciesItem.name ?? '').trim() !== String(selection.speciesName ?? '').trim()) return null;
  if (selection.kind === 'species') return createWorldModelSelection(model, speciesIndex);
  const typeIndex = Number(selection.typeIndex);
  const type = Array.isArray(speciesItem.biological_types) ? speciesItem.biological_types[typeIndex] : null;
  if (!Number.isInteger(typeIndex) || !type) return null;
  if (selection.typeName !== undefined && String(type.name ?? '').trim() !== String(selection.typeName ?? '').trim()) return null;
  return createWorldModelSelection(model, speciesIndex, typeIndex);
}

export function createWorldModelSpeciesSelection(model, speciesIndex) {
  const species = Array.isArray(model?.species) ? model.species : [];
  const item = species[speciesIndex];
  if (!item) return null;
  return {
    speciesIndex,
    speciesName: String(item.name ?? '').trim(),
  };
}

export function createWorldModelBiologicalTypeSelection(model, speciesIndex, typeIndex) {
  const speciesSelection = createWorldModelSpeciesSelection(model, speciesIndex);
  const type = Array.isArray(model?.species?.[speciesIndex]?.biological_types)
    ? model.species[speciesIndex].biological_types[typeIndex]
    : null;
  if (!speciesSelection || !type) return null;
  return {
    speciesIndex,
    typeIndex,
    speciesName: speciesSelection.speciesName,
    typeName: String(type.name ?? '').trim(),
  };
}

export function normalizeWorldModelSpeciesSelection(model, selection) {
  if (!selection) return null;
  const speciesIndex = Number(selection.speciesIndex);
  const current = createWorldModelSpeciesSelection(model, speciesIndex);
  if (!current) return null;
  if (selection.speciesName !== undefined && current.speciesName !== String(selection.speciesName ?? '').trim()) return null;
  return current;
}

export function normalizeWorldModelBiologicalTypeSelection(model, selection) {
  if (!selection) return null;
  const typeIndex = Number(selection.typeIndex);
  const current = createWorldModelBiologicalTypeSelection(model, Number(selection.speciesIndex), typeIndex);
  if (!current) return null;
  if (selection.speciesName !== undefined && current.speciesName !== String(selection.speciesName ?? '').trim()) return null;
  if (selection.typeName !== undefined && current.typeName !== String(selection.typeName ?? '').trim()) return null;
  return current;
}

function emptySectionValue(section) {
  if (section === 'capabilities') return Object.fromEntries(Object.keys(CAPABILITY_LABELS).map(key => [key, null]));
  if (section === 'reproduction_rules') return Object.fromEntries(Object.keys(RULE_LABELS).map(key => [key, null]));
  if (section === 'lifecycle') return Object.fromEntries(Object.keys(LIFECYCLE_LABELS).map(key => [key, null]));
  if (section === 'medical_context') return Object.fromEntries(Object.keys(MEDICAL_CONTEXT_LABELS).map(key => [key, null]));
  return [];
}

export function getWorldModelSection(model, section, options = {}) {
  const {
    selectedSpeciesIndex = null,
    selectedTypeIndex = null,
    speciesIndex = null,
    typeIndex = null,
  } = options ?? {};
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

function readCapabilityFormValue(node) {
  if (!node) return null;
  if (node.dataset?.bioweaveWorldCapabilityState === 'unknown') return null;
  if (typeof node.checked === 'boolean') return node.checked;
  const value = readFormText(node);
  return value === 'true' ? true : value === 'false' ? false : null;
}

export function extractWorldModelSection(formOrSection, sectionOrForm) {
  const form = typeof formOrSection === 'string' ? sectionOrForm : formOrSection;
  const section = typeof formOrSection === 'string'
    ? formOrSection
    : String(sectionOrForm ?? form?.dataset?.bioweaveWorldSection ?? '');
  if (!WORLD_MODEL_SECTION_KEYS.includes(section)) return null;
  if (section === 'capabilities') {
    return normalizeCapabilities(Object.fromEntries(Object.keys(CAPABILITY_LABELS).map(key => {
      return [key, readCapabilityFormValue(getSectionField(form, key))];
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
      const state = current === true ? 'true' : current === false ? 'false' : 'unknown';
      const checked = current === true ? ' checked' : '';
      const ariaChecked = state === 'unknown' ? 'mixed' : state;
      return [
        '<label class="bioweave-world-model-capability-check bioweave-world-model-field">',
        '<span class="bioweave-world-model-capability-copy"><strong>' + label + '</strong><small>勾选表示是；未勾选表示否。</small></span>',
        `<input class="bioweave-checkbox bioweave-world-model-capability-input" type="checkbox" data-bioweave-world-section-field="${key}" data-bioweave-world-capability-input data-bioweave-world-capability-state="${state}" aria-checked="${ariaChecked}"${checked}>`,
        '</label>',
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
    `<section class="bioweave-world-model-section bioweave-world-model-module bioweave-world-module${isEditing ? ' active' : ''}" data-bioweave-world-section="${section}">`,
    '<header class="bioweave-world-model-module-header">',
    '<div class="bioweave-world-model-module-heading"><span class="bioweave-world-model-module-icon"><i class="fa-solid ' + SECTION_ICONS[section] + '" aria-hidden="true"></i></span><h3 class="bioweave-world-model-module-title">' + label + '</h3></div>',
    '<span class="bioweave-world-model-module-spacer" aria-hidden="true"></span>',
    isEditing ? '' : renderSectionEditButton(section, busy),
    '</header>',
    content,
    '</section>',
  ].join('');
}

// World selection is a projection of the normalized Runtime DTO. Keep names,
// count, order, and pregnancy state data-driven; never introduce a UI gender enum.
function renderSpeciesCardSummary(species) {
  const types = Array.isArray(species?.biological_types) ? species.biological_types : [];
  const names = types.map((type, typeIndex) => displayText(type?.name || `生物类型 ${typeIndex + 1}`));
  return `${types.length} 个类型 · ${names.length ? names.join(' / ') : '未知'}`;
}

function renderTypeCardSummary(type) {
  const capabilities = type?.capabilities && typeof type.capabilities === 'object'
    ? type.capabilities
    : {};
  const capabilityKeys = Object.keys(CAPABILITY_LABELS);
  const knownCount = capabilityKeys.filter(key => capabilities[key] === true || capabilities[key] === false).length;
  const pregnancy = capabilities.can_carry_pregnancy === true
    ? '可承载妊娠'
    : capabilities.can_carry_pregnancy === false
      ? '不可承载妊娠'
      : '妊娠未知';
  return `${knownCount}/${capabilityKeys.length} 项能力已知 · ${pregnancy}`;
}

function renderCollectionAddForm(kind, speciesIndex, busy, {mode = 'add', typeIndex = null, initialName = ''} = {}) {
  const isType = kind === 'biological-type';
  const label = isType ? '性别 / 生物类型' : '种族';
  const action = isType ? 'world-model-save-biological-type' : 'world-model-save-species';
  return [
    `<form class="bioweave-world-model-collection-add" data-bioweave-world-model-collection-form data-bioweave-world-model-collection-kind="${kind}" data-bioweave-world-model-collection-mode="${mode}" data-bioweave-world-species-index="${speciesIndex ?? ''}" data-bioweave-world-type-index="${typeIndex ?? ''}">`,
    `<input class="bioweave-input" type="text" data-bioweave-world-model-collection-input value="${escapeHtml(initialName)}" placeholder="输入${label}名称" aria-label="输入${label}名称" autocomplete="off"${busy ? ' disabled' : ''}>`,
    `<button type="button" class="bioweave-world-model-icon-button" data-bioweave-action="${action}" title="保存${label}" aria-label="保存${label}"${busy ? ' disabled' : ''}><i class="fa-solid fa-check" aria-hidden="true"></i></button>`,
    `<button type="button" class="bioweave-world-model-icon-button" data-bioweave-action="world-model-cancel-collection-add" title="取消新增${label}" aria-label="取消新增${label}"${busy ? ' disabled' : ''}><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>`,
    '</form>',
  ].join('');
}

function renderCollectionActions({scope, addEnabled = true, editEnabled = false, removeEnabled = false, busy, label}) {
  const actionLabel = scope === 'species' ? '种族' : '性别 / 生物类型';
  const addAction = scope === 'species' ? 'world-model-add-species' : 'world-model-add-biological-type';
  const editAction = scope === 'species' ? 'world-model-edit-species' : 'world-model-edit-biological-type';
  const removeAction = scope === 'species' ? 'world-model-delete-species' : 'world-model-delete-biological-type';
  return [
    '<div class="bioweave-world-model-section-actions">',
    '<button type="button" class="bioweave-world-model-icon-button" data-bioweave-action="' + addAction + '" title="新增' + actionLabel + '" aria-label="新增' + actionLabel + '"' + ((!addEnabled || busy) ? ' disabled' : '') + '><i class="fa-solid fa-plus" aria-hidden="true"></i></button>',
    '<button type="button" class="bioweave-world-model-icon-button" data-bioweave-action="' + editAction + '" title="编辑' + actionLabel + (editEnabled ? '：' + label : '') + '" aria-label="编辑' + actionLabel + (editEnabled ? '：' + label : '') + '"' + ((!editEnabled || busy) ? ' disabled' : '') + '><i class="fa-solid fa-pen" aria-hidden="true"></i></button>',
    '<button type="button" class="bioweave-world-model-icon-button" data-bioweave-action="' + removeAction + '" title="' + (removeEnabled ? '删除' + actionLabel + '：' + label : '删除' + actionLabel) + '" aria-label="' + (removeEnabled ? '删除' + actionLabel + '：' + label : '删除' + actionLabel) + '"' + ((!removeEnabled || busy) ? ' disabled' : '') + '><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>',
    '</div>',
  ].join('');
}

function renderSpeciesSelector(model, speciesSelection, biologicalTypeSelection, collectionEditor = null, busy = false) {
  const species = Array.isArray(model?.species) ? model.species : [];
  const selectedSpecies = speciesSelection ? species[speciesSelection.speciesIndex] : null;
  const selectedTypes = Array.isArray(selectedSpecies?.biological_types) ? selectedSpecies.biological_types : [];
  const selectedType = biologicalTypeSelection
    ? selectedTypes[biologicalTypeSelection.typeIndex]
    : null;
  const selectedSpeciesName = displayText(selectedSpecies?.name || '当前物种');
  const selectedTypeName = displayText(selectedType?.name || biologicalTypeSelection?.typeName || '当前类型');
  const cards = species.map((item, speciesIndex) => {
    const selected = speciesSelection?.speciesIndex === speciesIndex;
    const name = item?.name || `物种 ${speciesIndex + 1}`;
    return [
      `<button type="button" class="bioweave-world-model-species-card bioweave-world-card${selected ? ' active' : ''}" data-bioweave-action="world-model-select-species" data-bioweave-world-species-index="${speciesIndex}" aria-pressed="${selected}">`,
      '<span class="bioweave-world-model-card-head">',
      '<span class="bioweave-world-model-card-title"><svg class="bioweave-world-model-species-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 21a8 8 0 0 0-16 0"></path><circle cx="10" cy="8" r="5"></circle><path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"></path></svg><b>' + displayText(name) + '</b></span>',
      `<span class="bioweave-world-model-card-mark">${selected ? '已选' : '选择'}</span>`,
      '</span>',
      `<small class="bioweave-world-model-card-summary">${renderSpeciesCardSummary(item)}</small>`,
      '</button>',
    ].join('');
  }).join('');
  const typeCards = selectedSpecies
    ? (selectedTypes.length
      ? selectedTypes.map((type, typeIndex) => {
        const selected = biologicalTypeSelection?.speciesIndex === speciesSelection.speciesIndex && biologicalTypeSelection?.typeIndex === typeIndex;
        return [
          `<button type="button" class="bioweave-world-model-type-button bioweave-type-card${selected ? ' active' : ''}" data-bioweave-action="world-model-select-type" data-bioweave-world-species-index="${speciesSelection.speciesIndex}" data-bioweave-world-type-index="${typeIndex}" aria-pressed="${selected}">`,
          '<span class="bioweave-world-model-type-card-head">',
          `<b>${displayText(type?.name || `生物类型 ${typeIndex + 1}`)}</b>`,
          `<span class="bioweave-world-model-card-mark">${selected ? '当前' : ''}</span>`,
          '</span>',
          `<small class="bioweave-world-model-type-card-summary">${renderTypeCardSummary(type)}</small>`,
          '</button>',
        ].join('');
      }).join('')
      : '<p class="bioweave-empty">尚未识别出生物类型。</p>')
    : '<p class="bioweave-empty">请先选择一个种族。</p>';
  return [
    '<section class="bioweave-world-model-section bioweave-world-model-species-selector">',
    '<div class="bioweave-world-model-section-heading"><div><h3>种族</h3><p>当前世界中已识别的种族。</p></div>' + renderCollectionActions({scope: 'species', addEnabled: true, editEnabled: Boolean(speciesSelection), removeEnabled: Boolean(speciesSelection), busy, label: displayText(speciesSelection?.speciesName || '')}) + '</div>',
    collectionEditor?.kind === 'species' ? renderCollectionAddForm('species', null, busy, collectionEditor) : '',
    species.length ? '<div class="bioweave-world-model-species-grid">' + cards + '</div>' : '<p class="bioweave-empty">当前没有足够信息建立物种规则。</p>',
    '<div class="bioweave-world-model-type-picker-head"><div><h3>性别 / 生物类型</h3><p>' + (selectedSpecies ? selectedSpeciesName + ' 的类型' : '选中种族后显示其所属类型。') + '</p></div>' + renderCollectionActions({scope: 'biological-type', addEnabled: Boolean(selectedSpecies), editEnabled: Boolean(selectedSpecies && biologicalTypeSelection && selectedType), removeEnabled: Boolean(selectedSpecies && biologicalTypeSelection && selectedType), busy, label: selectedTypeName}) + '</div>',
    collectionEditor?.kind === 'biological-type' ? renderCollectionAddForm('biological-type', speciesSelection?.speciesIndex, busy, collectionEditor) : '',
    '<div class="bioweave-world-model-type-grid" aria-label="' + selectedSpeciesName + ' 生物类型">' + typeCards + '</div>',
    '</section>',
  ].join('');
}

function renderSelectedTypeDetail(model, speciesSelection, biologicalTypeSelection, editingSection, sectionDraft, busy) {
  if (!speciesSelection || !biologicalTypeSelection) {
    return '<section class="bioweave-world-model-section bioweave-world-model-type-detail bioweave-world-model-frame"><header class="bioweave-world-model-detail-header"><div><h3>生物类型详情</h3><p>当前选择：<strong>未选择</strong></p></div></header><p class="bioweave-empty">请选择一个种族或其性别 / 生物类型。</p></section>';
  }
  const species = model?.species?.[biologicalTypeSelection.speciesIndex];
  const type = species?.biological_types?.[biologicalTypeSelection.typeIndex];
  if (!species) {
    return '<section class="bioweave-world-model-section bioweave-world-model-type-detail bioweave-world-model-frame"><header class="bioweave-world-model-detail-header"><div><h3>生物类型详情</h3><p>当前选择：<strong>未知</strong></p></div></header><p class="bioweave-empty">暂无可展示的生物类型。</p></section>';
  }
  if (!type) {
    return [
      '<section class="bioweave-world-model-section bioweave-world-model-type-detail bioweave-world-model-frame">',
      '<header class="bioweave-world-model-detail-header"><div><h3>生物类型详情</h3><p>当前选择：<strong>' + displayText(species.name || `物种 ${speciesSelection.speciesIndex + 1}`) + '</strong></p></div></header>',
      '<p class="bioweave-empty">尚未识别出生物类型。</p>',
      '</section>',
    ].join('');
  }
  const sectionValue = section => getWorldModelSection(model, section, biologicalTypeSelection ?? {});
  return [
    '<section class="bioweave-world-model-section bioweave-world-model-type-detail bioweave-world-model-frame">',
    '<header class="bioweave-world-model-detail-header"><div><h3>生物类型详情</h3><p>当前选择：<strong>' + displayText(species.name || `物种 ${speciesSelection.speciesIndex + 1}`) + ' / ' + displayText(type.name || `生物类型 ${biologicalTypeSelection.typeIndex + 1}`) + '</strong></p></div></header>',
    '<p class="bioweave-world-model-description">' + displayText(type.description) + '</p>',
    '<div class="bioweave-world-model-type-sections bioweave-world-model-module-grid">',
    TYPE_SECTION_KEYS.map(section => renderWorldSection(section, sectionValue(section), editingSection, editingSection === section ? sectionDraft : null, busy)).join(''),
    '</div>',
    '</section>',
  ].join('');
}

export function renderWorldModelView(model, {
  selectedSpecies = null,
  selectedBiologicalType = null,
  selectedSpeciesIndex = null,
  selectedTypeIndex = null,
  editingSection = null,
  sectionDraft = null,
  collectionEditor = null,
  busy = false,
} = {}) {
  const speciesSelection = selectedSpecies
    ? normalizeWorldModelSpeciesSelection(model, selectedSpecies)
    : (selectedSpeciesIndex === null ? null : createWorldModelSpeciesSelection(model, selectedSpeciesIndex));
  const biologicalTypeSelection = selectedBiologicalType
    ? normalizeWorldModelBiologicalTypeSelection(model, selectedBiologicalType)
    : (selectedTypeIndex === null ? null : createWorldModelBiologicalTypeSelection(model, selectedSpeciesIndex, selectedTypeIndex));
  const sectionValue = section => getWorldModelSection(model, section, biologicalTypeSelection ?? {});
  return [
    renderSpeciesSelector(model, speciesSelection, biologicalTypeSelection, collectionEditor, busy),
    '<div class="bioweave-world-model-content-grid">',
    '<div class="bioweave-world-model-detail-column">',
    renderSelectedTypeDetail(model, speciesSelection, biologicalTypeSelection, editingSection, sectionDraft, busy),
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
  worldModelOperation = null,
  selectedSpecies = null,
  selectedBiologicalType = null,
  selectedSpeciesIndex = null,
  selectedTypeIndex = null,
  editingSection = null,
  sectionDraft = null,
  collectionEditor = null,
  worldModelNotice = null,
} = {}) {
  const model = worldModel ?? null;
  const notice = worldModelNotice
    ? '<p class="bioweave-settings-notice" role="status">' + escapeHtml(worldModelNotice) + '</p>'
    : '';
  const actions = [
    '<button type="button" class="bioweave-primary-action" data-bioweave-action="world-model-full" title="重新分析当前上下文，构建完整的世界模型。" aria-label="重新分析当前上下文，构建完整的世界模型。"' + (worldModelBusy ? ' disabled' : '') + '>' + (worldModelOperation === 'full' ? '分析中…' : '开始分析') + '</button>',
    '<button type="button" class="bioweave-secondary-action" data-bioweave-action="world-model-patch" title="' + (model ? '基于现有世界模型查漏补缺，补充或修正遗漏的世界信息。' : '需要先建立世界模型后才能进行补充分析。') + '" aria-label="' + (model ? '基于现有世界模型查漏补缺，补充或修正遗漏的世界信息。' : '需要先建立世界模型后才能进行补充分析。') + '"' + ((!model || worldModelBusy) ? ' disabled' : '') + '>' + (worldModelOperation === 'patch' ? '补充中…' : '补充分析') + '</button>',
  ].join('');
  const metadata = model ? [
    '<div class="bioweave-world-model-meta" aria-label="世界模型摘要">',
    '<span><strong>最后分析：</strong>' + formatAnalysisTime(worldModelMeta?.last_analyzed_at) + '</span>',
    '<span class="bioweave-world-model-meta-source"><strong>来源：</strong>' + renderSourceSummary(worldModelMeta) + '</span>',
    '</div>',
  ].join('') : '';
  const body = model
    ? renderWorldModelView(model, {
      selectedSpecies,
      selectedBiologicalType,
      selectedSpeciesIndex,
      selectedTypeIndex,
      editingSection,
      sectionDraft,
      collectionEditor,
      busy: worldModelBusy,
    })
    : '<section class="bioweave-card bioweave-empty"><b>世界模型尚未建立</b><p>点击“开始分析”，使用当前已选择的分析来源生成 Chat 独立的生物学规则。</p></section>' + renderSpeciesSelector({species: []}, null, null, collectionEditor, worldModelBusy);
  return [
    '<section class="bioweave-page bioweave-world-model-page" data-bioweave-page="world">',
    '<header class="bioweave-page-title bioweave-page-head bioweave-world-model-titlebar bioweave-world-model-top' + (model ? '' : ' bioweave-world-model-top-empty') + '"><div class="bioweave-world-model-title-copy"><h2>世界模型</h2><p class="bioweave-muted">探索并管理当前聊天的世界观设定与生物规则</p></div>' + metadata + '<div class="bioweave-page-actions">' + actions + '</div></header>',
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
