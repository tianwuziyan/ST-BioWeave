import {
  API_ASSIGNMENTS,
  BIOWEAVE_INDEPENDENT_API,
  DEFAULT_API_REQUEST_SETTINGS,
  DEFAULT_API_PROFILE,
  FOLLOW_DEFAULT_API,
  normalizeRecentStorySettings,
  normalizeAnalysisPrompt,
  SILLYTAVERN_CURRENT_API,
} from '../storage/schema.js';
import {DEFAULT_FLOATING_LAUNCHER_THEME, FLOATING_LAUNCHER_THEMES, normalizeFloatingLauncherTheme} from '../floating-launcher-theme.js';
import {
  characterOpeningSelectionState,
  isCharacterCardOpeningFieldKey,
  WORLD_BOOK_RUNTIME_GROUPS,
  worldbookSelectionState,
} from '../ai/worldbook.js';
import {buildEventAnalysisMessages, buildWorldModelMessages} from '../ai/prompts.js';

const ASSIGNMENT_LABELS = {
  world_analysis: '世界分析',
  event_analysis: '事件分析',
  projection: '推演',
  history_scan: '历史扫描',
};

export const DATA_MANAGEMENT_OPERATIONS = Object.freeze([
  {
    key: 'character',
    action: 'clear-character-data',
    method: 'clearCharacterData',
    title: '清除人物数据',
    description: '清除当前聊天的人物分析和事件数据。',
  },
  {
    key: 'world',
    action: 'clear-world-data',
    method: 'clearWorldData',
    title: '清除世界数据',
    description: '清除当前聊天的世界模型数据。',
  },
  {
    key: 'all',
    action: 'clear-all-bioweave-data',
    method: 'clearAllBioWeaveData',
    title: '清除全部分析数据',
    description: '清除当前聊天的全部 BioWeave 分析数据。',
  },
]);

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function profileOptions(profiles, selected, emptyLabel = '请选择配置') {
  return [
    `<option value=""${!selected ? ' selected' : ''}>${emptyLabel}</option>`,
    profiles.map(profile => `<option value="${escapeHtml(profile.profile_id)}"${profile.profile_id === selected ? ' selected' : ''}>${escapeHtml(profile.name || profile.model || profile.profile_id)}</option>`).join(''),
  ].join('');
}

function assignmentOptions(profiles, selected) {
  const normalizedSelected = selected ?? null;
  return [
    `<option value="${FOLLOW_DEFAULT_API}"${normalizedSelected === FOLLOW_DEFAULT_API ? ' selected' : ''}>跟随默认</option>`,
    `<option value="${SILLYTAVERN_CURRENT_API}"${normalizedSelected === SILLYTAVERN_CURRENT_API ? ' selected' : ''}>SillyTavern 当前 API</option>`,
    profiles.length ? `<optgroup label="BioWeave 独立配置">${profiles.map(profile => `<option value="${escapeHtml(profile.profile_id)}"${profile.profile_id === normalizedSelected ? ' selected' : ''}>${escapeHtml(profile.name || profile.model || profile.profile_id)}</option>`).join('')}</optgroup>` : '',
    `<option value=""${!normalizedSelected ? ' selected' : ''}>不使用 API</option>`,
  ].join('');
}

function field(label, name, value, type = 'text', extra = '') {
  return `<label class="bioweave-settings-field"><span>${label}</span><input class="bioweave-input" name="${name}" type="${type}" value="${escapeHtml(value)}"${extra}></label>`;
}

function modelDraftKey(profileId) {
  const id = String(profileId ?? '').trim();
  return id || '__new__';
}

function timeoutSecondsForDisplay(value) {
  if (value === '' || value === null || value === undefined) return '';
  const milliseconds = Number(value);
  return Number.isFinite(milliseconds) ? milliseconds / 1000 : '';
}

export function normalizeModelList(rawModels) {
  const candidates = Array.isArray(rawModels)
    ? rawModels
    : Array.isArray(rawModels?.models)
      ? rawModels.models
      : Array.isArray(rawModels?.data)
        ? rawModels.data
        : [];
  return [...new Set(candidates.map(model => {
    if (typeof model === 'string') return model.trim();
    return String(model?.id ?? model?.name ?? '').trim();
  }).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function renderModelPicker(source, rawModelList, modelListProfileKey, modelSearch, modelRefreshBusy) {
  const models = modelListProfileKey === modelDraftKey(source.profile_id)
    ? normalizeModelList(rawModelList)
    : [];
  const query = String(modelSearch ?? '').trim().toLocaleLowerCase();
  const visibleModels = models.filter(model => model.toLocaleLowerCase().includes(query));
  const hasModels = models.length > 0;
  const hasVisibleModels = visibleModels.length > 0;
  const emptyText = hasModels && !hasVisibleModels
    ? '没有匹配的模型。'
    : '尚未加载模型列表；请点击刷新模型。';
  const listMarkup = visibleModels.map(model => {
    const selected = model === source.model;
    return `<button type="button" class="bioweave-model-item${selected ? ' is-selected' : ''}" data-bioweave-model-item data-model-value="${escapeHtml(model)}" role="option" aria-selected="${selected}"><span>${escapeHtml(model)}</span>${selected ? '<small>当前选择</small>' : ''}</button>`;
  }).join('');
  return [
    '<div class="bioweave-model-picker" data-bioweave-model-picker>',
    `<input type="hidden" name="model" value="${escapeHtml(source.model)}" data-bioweave-model-input required>`,
    '<div class="bioweave-model-control-row">',
    '<span class="bioweave-model-label">模型</span>',
    `<button type="button" class="bioweave-model-trigger" data-bioweave-model-trigger aria-expanded="false" aria-controls="bioweave-model-dropdown"><span data-bioweave-model-trigger-label>${escapeHtml(source.model || '请选择模型')}</span><span aria-hidden="true">▼</span></button>`,
    `<button type="button" class="bioweave-secondary-action bioweave-model-refresh-action" data-bioweave-action="refresh-models"${modelRefreshBusy ? ' disabled' : ''} aria-busy="${modelRefreshBusy}">${modelRefreshBusy ? '刷新中…' : '刷新模型'}</button>`,
    '</div>',
    '<div id="bioweave-model-dropdown" class="bioweave-model-dropdown" data-bioweave-model-dropdown hidden>',
    '<div class="bioweave-model-toolbar">',
    '<label class="bioweave-model-search-field"><span>模型列表</span><input class="bioweave-input bioweave-model-search" type="search" data-bioweave-model-search value="',
    escapeHtml(modelSearch),
    '" placeholder="搜索模型" autocomplete="off" spellcheck="false"></label>',
    '</div>',
    '<p class="bioweave-model-hint bioweave-muted">从 API 获取模型后点击列表项选择。</p>',
    `<div class="bioweave-model-list" data-bioweave-model-list role="listbox" aria-label="可选模型" aria-busy="${modelRefreshBusy}">${listMarkup}<p class="bioweave-model-empty" data-bioweave-model-empty${hasVisibleModels ? ' hidden' : ''}>${emptyText}</p></div>`,
    '</div>',
    '</div>',
  ].join('');
}

function profileValues(profile, draft) {
  const saved = profile ? normalizeApiProfileForDisplay(profile) : {...DEFAULT_API_PROFILE, profile_id: ''};
  const source = draft && typeof draft === 'object' ? draft : {};
  const value = name => Object.prototype.hasOwnProperty.call(source, name) ? source[name] : saved[name];
  return {
    profile_id: value('profile_id') || saved.profile_id,
    name: value('name') ?? '',
    api_url: value('api_url') ?? '',
    model: value('model') ?? '',
    context_size: value('context_size') ?? DEFAULT_API_PROFILE.context_size,
    max_output_tokens: value('max_output_tokens') ?? DEFAULT_API_PROFILE.max_output_tokens,
    temperature: value('temperature') ?? DEFAULT_API_PROFILE.temperature,
    api_key: typeof source.api_key === 'string' ? source.api_key : '',
    clear_secret: source.clear_secret === true,
    secret_ref: saved.secret_ref,
  };
}

function normalizeApiProfileForDisplay(profile) {
  const source = profile && typeof profile === 'object' ? profile : {};
  return {
    profile_id: String(source.profile_id ?? ''),
    name: source.name ?? '',
    api_url: source.api_url ?? '',
    model: source.model ?? '',
    context_size: source.context_size ?? DEFAULT_API_PROFILE.context_size,
    max_output_tokens: source.max_output_tokens ?? DEFAULT_API_PROFILE.max_output_tokens,
    temperature: source.temperature ?? DEFAULT_API_PROFILE.temperature,
    secret_ref: source.secret_ref ?? null,
  };
}

function renderSettingsStatusBadge(status = null) {
  if (!status) return '';
  const normalized = typeof status === 'string' ? {label: status} : status;
  const label = String(normalized?.label ?? '').trim();
  if (!label) return '';
  const tone = ['good', 'warn', 'danger'].includes(normalized?.tone) ? ' ' + normalized.tone : '';
  return '<span class="bioweave-badge bioweave-settings-summary-status' + tone + '">' + escapeHtml(label) + '</span>';
}

function renderSettingsSummary(title, hint, action = null, status = null, extraClass = '') {
  const actionMarkup = action?.action
    ? `<button type="button" class="${escapeHtml(action.className || 'bioweave-secondary-action')}" data-bioweave-action="${escapeHtml(action.action)}"${action.ariaLabel ? ` aria-label="${escapeHtml(action.ariaLabel)}"` : ''}>${escapeHtml(action.label || '')}</button>`
    : '';
  const summaryClass = ['bioweave-settings-summary', extraClass].filter(Boolean).join(' ');
  return [
    '<summary class="' + summaryClass + '">',
    '<span class="bioweave-settings-summary-arrow" aria-hidden="true"><i class="fa-solid fa-chevron-down"></i><i class="fa-solid fa-chevron-up"></i></span>',
    '<span class="bioweave-settings-summary-copy"><strong>' + escapeHtml(title) + '</strong><small>' + escapeHtml(hint) + '</small></span>',
    actionMarkup,
    renderSettingsStatusBadge(status),
    '</summary>',
  ].join('');
}

function renderApiSource(
  apiSource,
  defaultProfileId,
  profiles,
  {
    loading = false,
    editingProfile = undefined,
    editingDraft = undefined,
    modelList = [],
    modelListProfileKey = null,
    modelSearch = '',
    modelRefreshBusy = false,
    testResult = null,
    busy = false,
    apiRequestSettings = DEFAULT_API_REQUEST_SETTINGS,
    openSettingsSections = [],
  } = {},
) {
  const independent = apiSource === BIOWEAVE_INDEPENDENT_API;
  const defaultProfile = profiles.find(profile => profile.profile_id === defaultProfileId);
  const apiDisclosureOpen = editingProfile !== undefined || openSettingsSections.includes('api');
  const requestSource = apiRequestSettings && typeof apiRequestSettings === 'object'
    ? apiRequestSettings
    : DEFAULT_API_REQUEST_SETTINGS;
  const requestSettings = [
    '<div class="bioweave-api-request-settings" data-bioweave-api-request-settings>',
    '<div class="bioweave-settings-fields">',
    field('超时（秒）', 'timeout', timeoutSecondsForDisplay(requestSource.timeout ?? DEFAULT_API_REQUEST_SETTINGS.timeout), 'number', ' min="0.25" step="0.25" inputmode="decimal" data-bioweave-api-timeout'),
    field('重试次数', 'retry_count', requestSource.retry_count ?? DEFAULT_API_REQUEST_SETTINGS.retry_count, 'number', ' min="0" max="3" step="1" inputmode="numeric" data-bioweave-api-retry-count'),
    '</div>',
    '</div>',
  ].join('');
  const profilePanel = independent ? [
    '<section class="bioweave-api-profiles">',
    '<header class="bioweave-api-profiles-header"><div><h3>独立 API 配置</h3><p class="bioweave-muted">配置名称不是唯一标识；删除会清理未被其它配置复用的 Secret。</p></div>',
    '<button type="button" class="bioweave-primary-action" data-bioweave-action="new-profile">新建 API 配置</button></header>',
    '<label class="bioweave-assignment-field bioweave-default-profile"><span>默认 API 配置</span>',
    `<select class="bioweave-select" data-bioweave-default-profile>${profileOptions(profiles, defaultProfileId, profiles.length ? '请选择默认配置' : '请先新建 API 配置')}</select>`,
    '</label>',
    `<p class="bioweave-muted bioweave-source-hint">${defaultProfile ? `跟随默认的任务将使用「${escapeHtml(defaultProfile.name || defaultProfile.model)}」。` : '请选择一个独立 API 配置，或让任务单独指定 API。'}</p>`,
    '<section class="bioweave-card bioweave-profile-list"><header><div><h4>已保存的 API 配置</h4></div></header>',
    renderProfileList(profiles, loading),
    '</section>',
    editingProfile !== undefined ? renderProfileEditor(editingProfile, editingDraft, testResult, busy, modelList, modelListProfileKey, modelSearch, modelRefreshBusy) : '',
    '</section>',
  ].join('') : '';
  return [
    `<details class="bioweave-settings-disclosure bioweave-settings-group bioweave-api-source-disclosure" data-bioweave-settings-disclosure="api"${apiDisclosureOpen ? ' open' : ''}>`,
    renderSettingsSummary('API 来源', '选择酒馆当前 API 或 BioWeave 独立 API', null, {
      label: independent ? '独立 API' : '当前 API',
      tone: 'good',
    }),
    '<section class="bioweave-card bioweave-api-source">',
    '<div class="bioweave-source-options">',
    `<label class="bioweave-source-option${!independent ? ' is-selected' : ''}"><input type="radio" name="api_source" value="${SILLYTAVERN_CURRENT_API}" data-bioweave-api-source${!independent ? ' checked' : ''}><span><strong>使用 SillyTavern 当前 API</strong><small>沿用酒馆当前连接，不复制或读取 API Key。</small></span></label>`,
    `<label class="bioweave-source-option${independent ? ' is-selected' : ''}"><input type="radio" name="api_source" value="${BIOWEAVE_INDEPENDENT_API}" data-bioweave-api-source${independent ? ' checked' : ''}><span><strong>使用 BioWeave 独立 API</strong><small>为“跟随默认”的任务提供独立连接。</small></span></label>`,
    '</div>',
    requestSettings,
    profilePanel,
    '<p class="bioweave-api-security-note bioweave-muted">安全：独立 API Key 只写入 SillyTavern Secret Store；BioWeave 不读取、复制或显示 SillyTavern 当前 API 的密钥。</p>',
    '</section>',
    '</details>',
  ].join('');
}

function renderProfileConnectionSummary(existingSecret) {
  return [
    '<div class="bioweave-api-profile-summary" aria-label="独立 API 连接摘要">',
    '<div class="bioweave-api-profile-summary-row"><span>连接模式</span><strong>独立 API</strong></div>',
    `<div class="bioweave-api-profile-summary-row"><span>密钥状态</span><span class="bioweave-badge${existingSecret ? ' good' : ''}">${existingSecret ? '已保存' : '未设置'}</span></div>`,
    '<small>密钥只写入 Secret Store；留空表示保留已保存密钥。</small>',
    '</div>',
  ].join('');
}

function renderProfileEditor(profile, draft, testResult, busy, modelList, modelListProfileKey, modelSearch, modelRefreshBusy) {
  const source = profileValues(profile, draft);
  const existingSecret = Boolean(source.secret_ref);
  const result = testResult
    ? `<div class="bioweave-test-result ${testResult.ok ? 'is-success' : 'is-error'}" data-bioweave-test-result role="status">${testResult.ok
      ? `连接成功 · ${escapeHtml(testResult.model || source.model || '已连接')} · ${escapeHtml(testResult.latency_ms ?? 0)} ms`
      : `连接失败 · ${escapeHtml(testResult.error || '安全错误摘要')}`}</div>`
    : '';
  return [
    '<section class="bioweave-card bioweave-settings-editor">',
    '<header><div><h3>基本设置</h3><p class="bioweave-muted">API 密钥只写入 SillyTavern Secret Store，不会回填到本页。</p></div></header>',
    '<form data-bioweave-settings-form novalidate>',
    `<input type="hidden" name="profile_id" value="${escapeHtml(source.profile_id)}">`,
    '<div class="bioweave-settings-fields bioweave-settings-basic-fields">',
    field('配置名称', 'name', source.name),
    field('API 地址（不含 /chat/completions）', 'api_url', source.api_url, 'url', ' autocomplete="url" required'),
    field('API 密钥', 'api_key', source.api_key, 'password', ' autocomplete="new-password" placeholder="不显示已保存密钥"'),
    renderProfileConnectionSummary(existingSecret),
    renderModelPicker(source, modelList, modelListProfileKey, modelSearch, modelRefreshBusy),
    '</div>',
    existingSecret ? `<label class="bioweave-check"><input class="bioweave-checkbox" type="checkbox" name="clear_secret"${source.clear_secret ? ' checked' : ''}> 清除已保存 API 密钥</label>` : '',
    '<div class="bioweave-settings-actions">',
    `<button type="button" class="bioweave-primary-action" data-bioweave-action="save-profile"${busy ? ' disabled' : ''}>保存 API 配置</button>`,
    `<button type="button" class="bioweave-secondary-action" data-bioweave-action="test-profile"${busy ? ' disabled' : ''}>测试连接</button>`,
    '<button type="button" class="bioweave-secondary-action" data-bioweave-action="cancel-profile">取消</button>',
    '</div>',
    result,
    '</form>',
    '</section>',
  ].join('');
}

function renderProfileList(profiles, loading) {
  if (loading) return '<div class="bioweave-empty">正在读取全局设置…</div>';
  if (!profiles.length) return '<div class="bioweave-empty">尚未创建独立 API 配置。需要时点击“新建 API 配置”。</div>';
  return profiles.map(profile => [
    '<article class="bioweave-profile-row">',
    '<div class="bioweave-profile-summary">',
    `<strong>${escapeHtml(profile.name || '未命名配置')}</strong>`,
    '</div>',
    '<div class="bioweave-profile-actions">',
    `<button type="button" class="bioweave-secondary-action" data-bioweave-action="edit-profile" data-profile-id="${escapeHtml(profile.profile_id)}">编辑</button>`,
    `<button type="button" class="bioweave-danger-action" data-bioweave-action="delete-profile" data-profile-id="${escapeHtml(profile.profile_id)}">删除</button>`,
    '</div>',
    '</article>',
  ].join('')).join('');
}

function worldbookGroupForSource(source) {
  if (source?.source_type !== 'worldbook') return '';
  const runtimeGroup = String(source?.worldbook_group ?? '').trim();
  if (Object.values(WORLD_BOOK_RUNTIME_GROUPS).includes(runtimeGroup)) return runtimeGroup;
  const scopes = new Set(source?.scopes ?? []);
  if (scopes.has('selected_global_worldbook')) return WORLD_BOOK_RUNTIME_GROUPS.SELECTED_GLOBAL;
  if (scopes.has('character_card_worldbook')) return WORLD_BOOK_RUNTIME_GROUPS.CHARACTER_CARD;
  if (scopes.has('character_worldbook')) return WORLD_BOOK_RUNTIME_GROUPS.CHARACTER;
  if (scopes.has('chat_worldbook')) return WORLD_BOOK_RUNTIME_GROUPS.CHAT;
  // 兼容尚未带运行时分组字段的旧目录：旧 global scope 表示全局选择器中的书。
  if (scopes.has('global_worldbook')) return WORLD_BOOK_RUNTIME_GROUPS.SELECTED_GLOBAL;
  return WORLD_BOOK_RUNTIME_GROUPS.OTHER;
}

function analysisSourceScopeLabel(source) {
  const group = worldbookGroupForSource(source);
  if (group === WORLD_BOOK_RUNTIME_GROUPS.SELECTED_GLOBAL) return '全局世界书';
  if (group === WORLD_BOOK_RUNTIME_GROUPS.CHARACTER_CARD) return '角色卡本身的世界书';
  if (group === WORLD_BOOK_RUNTIME_GROUPS.CHARACTER) return '附加角色世界书';
  if (group === WORLD_BOOK_RUNTIME_GROUPS.OTHER) return '其他世界书';
  return '';
}

const CHARACTER_CARD_UI_FIELDS = Object.freeze({
  description: '角色描述',
});

function characterCardFieldLabel(fieldKey) {
  const key = String(fieldKey ?? '').trim();
  if (key === 'description') return CHARACTER_CARD_UI_FIELDS.description;
  if (key === 'opening:main') return '主开场白';
  const alternateMatch = key.match(/^opening:alternate:(\d+)$/);
  return alternateMatch ? `其他开场白 ${Number(alternateMatch[1]) + 1}` : '';
}

function characterOpeningGroupKey(sourceId) {
  return String(sourceId ?? '').trim() + ':opening';
}

function analysisSelectionKey(sourceId, childType, childId) {
  const source = String(sourceId ?? '').trim();
  const id = String(childId ?? '').trim();
  return source && id ? source + '\u0000' + childType + '\u0000' + id : '';
}

function analysisSourceChildren(source) {
  if (source?.source_type === 'worldbook') {
    return (Array.isArray(source.entries) ? source.entries : [])
      .map(entry => ({type: 'entry', id: entry?.entry_id, value: entry}));
  }
  if (source?.source_type === 'character_card') {
    return (Array.isArray(source.fields) ? source.fields : [])
      .filter(field => Object.prototype.hasOwnProperty.call(CHARACTER_CARD_UI_FIELDS, field?.field_key)
        || isCharacterCardOpeningFieldKey(field?.field_key))
      .map(field => ({type: 'field', id: field?.field_key, value: field}));
  }
  return [];
}

function analysisSourceSelectionState(source, selectedSet) {
  const children = analysisSourceChildren(source)
    .filter(child => String(child.id ?? '').trim());
  const selectedCount = children.filter(child => selectedSet.has(analysisSelectionKey(source?.source_id, child.type, child.id))).length;
  return {
    total_count: children.length,
    selected_count: selectedCount,
    checked: children.length > 0 && selectedCount === children.length,
    indeterminate: selectedCount > 0 && selectedCount < children.length,
  };
}

function analysisSourcesSelectionState(sources, selectedSet) {
  const state = (Array.isArray(sources) ? sources : []).reduce((total, source) => {
    const state = analysisSourceSelectionState(source, selectedSet);
    total.total_count += state.total_count;
    total.selected_count += state.selected_count;
    return total;
  }, {total_count: 0, selected_count: 0});
  return {
    ...state,
    checked: state.total_count > 0 && state.selected_count === state.total_count,
    indeterminate: state.selected_count > 0 && state.selected_count < state.total_count,
  };
}

function selectionBadgeMarkup(state = {}, extraClass = '') {
  const total = Number(state.total_count || 0);
  const selected = Number(state.selected_count || 0);
  const label = selected <= 0
    ? '未选'
    : selected >= total && total > 0
      ? '已选 ' + selected + '/' + total
      : selected + '/' + total + ' 项';
  const tone = selected > 0 ? ' good' : '';
  return '<span class="bioweave-badge' + tone + (extraClass ? ' ' + extraClass : '') + '">' + label + '</span>';
}

function selectedAnalysisItems(selected) {
  return new Set((Array.isArray(selected) ? selected : []).map(item => {
    if (!item || typeof item !== 'object') return '';
    return analysisSelectionKey(
      item.source_id,
      item.entry_id ? 'entry' : item.field_key ? 'field' : 'source',
      item.entry_id || item.field_key || 'source',
    );
  }).filter(Boolean));
}

function childStatus(child) {
  const tokenEstimate = Number(child?.token_estimate || 0);
  return tokenEstimate > 0 ? '约 ' + tokenEstimate + ' tokens' : '无可估算内容';
}

function renderAnalysisChildRow(source, child, childType, selectedSet) {
  const childId = childType === 'entry' ? child?.entry_id : child?.field_key;
  const selectionKey = analysisSelectionKey(source.source_id, childType, childId);
  const unavailable = source.available === false || child?.available === false;
  const checked = selectedSet.has(selectionKey);
  const childAttribute = childType === 'entry'
    ? 'data-bioweave-analysis-entry="' + escapeHtml(childId) + '"'
    : 'data-bioweave-analysis-field="' + escapeHtml(childId) + '"';
  const currentBadge = childType === 'field' && child?.is_current
    ? '<small class="bioweave-analysis-current-badge">当前开场白</small>'
    : '';
  const selectedBadge = '<span class="bioweave-badge bioweave-analysis-child-status' + (checked ? ' good' : '') + '">' + (checked ? '已选' : '未选') + '</span>';
  return [
    '<label class="bioweave-analysis-source-child' + (unavailable ? ' is-unavailable' : '') + '" data-bioweave-analysis-source-row="' + escapeHtml(source.source_id) + '" data-bioweave-analysis-source-child-key="' + escapeHtml(selectionKey) + '">',
    '<input class="bioweave-checkbox" type="checkbox" data-bioweave-analysis-source="' + escapeHtml(source.source_id) + '" ' + childAttribute + (checked ? ' checked' : '') + (unavailable ? ' disabled' : '') + '>',
    '<span class="bioweave-analysis-source-copy">',
    '<strong>' + escapeHtml(child?.label || childId) + '</strong>',
    '<small>' + childStatus(child) + '</small>',
    '</span>',
    '<span class="bioweave-analysis-child-tools">' + currentBadge + selectedBadge + '</span>',
    '</label>',
  ].join('');
}

function renderCharacterCardSource(source, selectedSet, openWorldbooks = new Set(), selected = [], allSources = [], openCharacterGroups = new Set()) {
  if (source?.source_type === 'worldbook') {
    return renderWorldbookSource(source, selectedSet, openWorldbooks, selected, allSources);
  }
  const completeSource = allSources.find(item => item.source_id === source?.source_id) ?? source;
  const visibleFields = (Array.isArray(source?.fields) ? source.fields : [])
    .filter(field => Object.prototype.hasOwnProperty.call(CHARACTER_CARD_UI_FIELDS, field?.field_key) || isCharacterCardOpeningFieldKey(field?.field_key))
    .map(field => ({...field, label: characterCardFieldLabel(field.field_key)}));
  const allFields = (Array.isArray(completeSource?.fields) ? completeSource.fields : [])
    .filter(field => Object.prototype.hasOwnProperty.call(CHARACTER_CARD_UI_FIELDS, field?.field_key) || isCharacterCardOpeningFieldKey(field?.field_key))
    .map(field => ({...field, label: characterCardFieldLabel(field.field_key)}));
  const descriptionFields = visibleFields.filter(field => field.field_key === 'description');
  const openingFields = visibleFields.filter(field => isCharacterCardOpeningFieldKey(field.field_key));
  const allOpeningFields = allFields.filter(field => isCharacterCardOpeningFieldKey(field.field_key));
  const openingState = characterOpeningSelectionState(completeSource, selected);
  const openingIsOpen = openCharacterGroups.has(characterOpeningGroupKey(completeSource.source_id));
  const openingGroup = allOpeningFields.length && openingFields.length
    ? [
      '<details class="bioweave-analysis-character-group bioweave-source-branch" data-bioweave-analysis-character-group="opening" data-bioweave-analysis-character-group-source="' + escapeHtml(completeSource.source_id) + '"' + (openingIsOpen ? ' open' : '') + '>',
      '<summary class="bioweave-analysis-character-group-summary">',
      '<input class="bioweave-checkbox bioweave-analysis-parent-toggle" type="checkbox" data-bioweave-analysis-character-opening-toggle="' + escapeHtml(completeSource.source_id) + '" aria-label="选择全部开场白" aria-checked="' + (openingState.indeterminate ? 'mixed' : String(openingState.checked)) + '"' + (openingState.checked ? ' checked' : '') + (completeSource.available === false ? ' disabled' : '') + '>',
      '<span class="bioweave-analysis-character-group-copy"><strong>开场白</strong><small>' + openingState.selected_count + '/' + openingState.total_count + '</small></span>',
      '<span class="bioweave-analysis-character-group-tools">' + selectionBadgeMarkup(openingState),
      '<button type="button" class="bioweave-analysis-disclosure-marker" data-bioweave-analysis-character-expand="' + escapeHtml(completeSource.source_id) + '" aria-expanded="' + String(openingIsOpen) + '" aria-label="' + (openingIsOpen ? '收起' : '展开') + '开场白">',
      '</button></span>',
      '</summary>',
      '<div class="bioweave-analysis-character-group-entries">',
      openingFields.map(field => renderAnalysisChildRow(source, field, 'field', selectedSet)).join(''),
      '</div>',
      '</details>',
    ].join('')
    : '';
  const descriptionRows = descriptionFields.map(field => renderAnalysisChildRow(source, field, 'field', selectedSet)).join('');
  const rows = descriptionRows + openingGroup;
  return [
    '<div class="bioweave-analysis-source-card" data-bioweave-analysis-source-row="' + escapeHtml(source.source_id) + '">',
    rows || '<p class="bioweave-empty">当前没有可读取的角色卡字段。</p>',
    '</div>',
  ].join('');
}

function renderWorldbookSource(source, selectedSet, openWorldbooks = new Set(), selected = [], allSources = []) {
  const completeSource = allSources.find(item => item.source_id === source?.source_id) ?? source;
  const contentLoaded = completeSource?.content_loaded === true || Array.isArray(completeSource?.entries) && completeSource.entries.length > 0;
  const contentLoading = source?.loading === true || completeSource?.loading === true;
  const entries = Array.isArray(source?.entries) ? source.entries : [];
  const allEntries = Array.isArray(completeSource?.entries) ? completeSource.entries : entries;
  const scopeLabel = analysisSourceScopeLabel(completeSource);
  const parentState = worldbookSelectionState(completeSource, selected);
  const worldbookIsOpen = openWorldbooks.has(source.source_id);
  const rows = contentLoaded
    ? entries.map(entry => renderAnalysisChildRow(source, entry, 'entry', selectedSet)).join('')
    : '';
  const metadata = contentLoading
    ? '正在读取条目…'
    : contentLoaded
      ? (scopeLabel || '世界书') + ' · ' + allEntries.length + ' 个条目'
      : (scopeLabel || '世界书') + ' · 展开后读取条目';
  const body = contentLoaded
    ? rows || '<p class="bioweave-empty">当前没有可读取的世界书条目。</p>'
    : '<p class="bioweave-muted bioweave-analysis-worldbook-deferred">展开后读取这本世界书的条目。</p>';
  const selectionBadge = selectionBadgeMarkup(parentState, 'bioweave-analysis-source-status');
  return [
    '<details class="bioweave-analysis-worldbook bioweave-source-branch" data-bioweave-analysis-source-row="' + escapeHtml(source.source_id) + '"' + (worldbookIsOpen ? ' open' : '') + '>',
    '<summary class="bioweave-analysis-worldbook-summary">',
    '<input class="bioweave-checkbox bioweave-analysis-parent-toggle" type="checkbox" data-bioweave-analysis-worldbook-toggle="' + escapeHtml(source.source_id) + '" aria-label="选择整本世界书" aria-checked="' + (parentState.indeterminate ? 'mixed' : String(parentState.checked)) + '"' + (parentState.checked ? ' checked' : '') + (source.available === false || contentLoading ? ' disabled' : '') + '>',
    '<span class="bioweave-analysis-worldbook-title"><strong>' + escapeHtml(source.label || '世界书') + '</strong></span>',
    '<span class="bioweave-analysis-worldbook-tools">' + selectionBadge,
    '<button type="button" class="bioweave-analysis-disclosure-marker" data-bioweave-analysis-worldbook-expand="' + escapeHtml(source.source_id) + '" aria-expanded="' + String(worldbookIsOpen) + '" aria-label="' + (worldbookIsOpen ? '收起' : '展开') + '世界书条目">',
    '</button></span>',
    '</summary>',
    '<div class="bioweave-analysis-worldbook-meta">' + escapeHtml(metadata) + '</div>',
    '<div class="bioweave-analysis-worldbook-entries">',
    body,
    '</div>',
    '</details>',
  ].join('');
}

function renderAnalysisSourceRows(sources, allSources, selectedSet, renderer, openWorldbooks = new Set(), selected = [], openCharacterGroups = new Set()) {
  const rows = sources.map(source => renderer(source, selectedSet, openWorldbooks, selected, allSources, openCharacterGroups)).join('');
  return rows || '<p class="bioweave-empty">' + (allSources.length ? '当前搜索没有匹配项。' : '当前 Chat 暂无可用来源。') + '</p>';
}

function renderAnalysisSourceSection({
  key,
  label,
  state,
  open = false,
  sources = [],
  allSources = [],
  selectedSet,
  renderer,
  content = null,
  sourceIds = [],
  openWorldbooks = new Set(),
  selected = [],
  openCharacterGroups = new Set(),
} = {}) {
  return [
    '<details class="bioweave-analysis-section bioweave-source-branch" data-bioweave-analysis-section="' + escapeHtml(key) + '" data-bioweave-analysis-section-source-ids="' + escapeHtml(JSON.stringify(Array.isArray(sourceIds) ? sourceIds : [])) + '"' + (open ? ' open' : '') + '>',
    '<summary class="bioweave-analysis-section-summary">',
    '<span class="bioweave-analysis-section-select">',
    '<input class="bioweave-checkbox bioweave-analysis-section-toggle" type="checkbox" data-bioweave-analysis-section-toggle="' + escapeHtml(key) + '" aria-label="选择' + escapeHtml(label) + '" aria-checked="' + (state.indeterminate ? 'mixed' : String(Boolean(state.checked))) + '"' + (state.checked ? ' checked' : '') + (sourceIds.length > 0 ? '' : ' disabled') + '>',
    '<span class="bioweave-analysis-section-title">' + escapeHtml(label) + '</span>',
    '</span>',
    '<span class="bioweave-analysis-section-tools">',
    selectionBadgeMarkup(state),
    '<span class="bioweave-analysis-section-chevron" aria-hidden="true">' + (open ? '−' : '+') + '</span>',
    '</span>',
    '</summary>',
    '<div class="bioweave-analysis-section-content">',
    content ?? renderAnalysisSourceRows(sources, allSources, selectedSet, renderer, openWorldbooks, selected, openCharacterGroups),
    '</div>',
    '</details>',
  ].join('');
}

function renderWorldbookSources(worldbookSources = {}) {
  const loadingWorldbookIds = new Set(Array.isArray(worldbookSources.loadingWorldbookIds) ? worldbookSources.loadingWorldbookIds : []);
  const decorateLoading = source => loadingWorldbookIds.has(source?.source_id) ? {...source, loading: true} : source;
  const sources = (Array.isArray(worldbookSources.sources) ? worldbookSources.sources : []).map(decorateLoading);
  const visibleSources = (Array.isArray(worldbookSources.visibleSources)
    ? worldbookSources.visibleSources
    : sources).map(decorateLoading);
  const selectedSet = selectedAnalysisItems(worldbookSources.selected);
  const worldbookSourcesList = sources.filter(source => source.source_type === 'worldbook');
  const visibleWorldbooks = visibleSources.filter(source => source.source_type === 'worldbook');
  const openWorldbooks = new Set(Array.isArray(worldbookSources.openWorldbooks) ? worldbookSources.openWorldbooks : []);
  const openCharacterGroups = new Set(Array.isArray(worldbookSources.openCharacterGroups) ? worldbookSources.openCharacterGroups : []);
  const openSections = new Set(Array.isArray(worldbookSources.openAnalysisSections) ? worldbookSources.openAnalysisSections : []);
  const openSettingsSections = new Set(Array.isArray(worldbookSources.openSettingsSections) ? worldbookSources.openSettingsSections : []);
  const isCharacterCardOwnedWorldbook = source => worldbookGroupForSource(source) === WORLD_BOOK_RUNTIME_GROUPS.CHARACTER_CARD;
  const cardSources = sources.filter(source => source.source_type === 'character_card' || isCharacterCardOwnedWorldbook(source));
  const visibleCards = visibleSources.filter(source => source.source_type === 'character_card' || isCharacterCardOwnedWorldbook(source));
  const characterCardSources = cardSources.filter(source => source.source_type === 'character_card');
  const visibleCharacterCards = visibleCards.filter(source => source.source_type === 'character_card');
  const characterCardWorldbooks = cardSources.filter(source => source.source_type === 'worldbook');
  const visibleCharacterCardWorldbooks = visibleCards.filter(source => source.source_type === 'worldbook');
  const visibleWorldbookSources = visibleWorldbooks.filter(source => {
    const group = worldbookGroupForSource(source);
    return group !== WORLD_BOOK_RUNTIME_GROUPS.CHAT && group !== WORLD_BOOK_RUNTIME_GROUPS.CHARACTER_CARD;
  });
  const selectableWorldbooks = worldbookSourcesList.filter(source => {
    const group = worldbookGroupForSource(source);
    return group !== WORLD_BOOK_RUNTIME_GROUPS.CHAT && group !== WORLD_BOOK_RUNTIME_GROUPS.CHARACTER_CARD;
  });
  const groupedWorldbooks = group => selectableWorldbooks.filter(source => worldbookGroupForSource(source) === group);
  const visibleGroupedWorldbooks = group => visibleWorldbookSources.filter(source => worldbookGroupForSource(source) === group);
  const cardSelectionState = analysisSourcesSelectionState(cardSources, selectedSet);
  const sectionIsOpen = key => openSections.has(key)
    || (key !== 'character_card' && openSections.has('worldbook'));
  const cardVisibleRows = [
    visibleCharacterCards.length
      ? renderAnalysisSourceRows(visibleCharacterCards, characterCardSources, selectedSet, renderCharacterCardSource, openWorldbooks, worldbookSources.selected, openCharacterGroups)
      : '',
    visibleCharacterCardWorldbooks.length
      ? renderAnalysisSourceRows(visibleCharacterCardWorldbooks, characterCardWorldbooks, selectedSet, renderWorldbookSource, openWorldbooks, worldbookSources.selected, openCharacterGroups)
      : '',
  ].join('');
  const cardRows = cardVisibleRows || (cardSources.length
    ? '<p class="bioweave-empty">当前搜索没有匹配项。</p>'
    : '<p class="bioweave-empty">当前 Chat 暂无可用角色卡来源。</p>');
  const groups = [
    renderAnalysisSourceSection({
      key: 'character_card',
      label: '角色卡',
      state: cardSelectionState,
      open: sectionIsOpen('character_card'),
      sources: cardSources,
      allSources: cardSources,
      selectedSet,
      content: cardRows,
      sourceIds: cardSources.map(source => source.source_id),
      openWorldbooks,
      selected: worldbookSources.selected,
      openCharacterGroups,
    }),
    renderAnalysisSourceSection({
      key: 'selected_global',
      label: '全局世界书',
      state: analysisSourcesSelectionState(groupedWorldbooks(WORLD_BOOK_RUNTIME_GROUPS.SELECTED_GLOBAL), selectedSet),
      open: sectionIsOpen('selected_global'),
      sources: visibleGroupedWorldbooks(WORLD_BOOK_RUNTIME_GROUPS.SELECTED_GLOBAL),
      allSources: groupedWorldbooks(WORLD_BOOK_RUNTIME_GROUPS.SELECTED_GLOBAL),
      selectedSet,
      renderer: renderWorldbookSource,
      sourceIds: groupedWorldbooks(WORLD_BOOK_RUNTIME_GROUPS.SELECTED_GLOBAL).map(source => source.source_id),
      openWorldbooks,
      selected: worldbookSources.selected,
      openCharacterGroups,
    }),
    renderAnalysisSourceSection({
      key: 'character',
      label: '附加角色世界书',
      state: analysisSourcesSelectionState(groupedWorldbooks(WORLD_BOOK_RUNTIME_GROUPS.CHARACTER), selectedSet),
      open: sectionIsOpen('character'),
      sources: visibleGroupedWorldbooks(WORLD_BOOK_RUNTIME_GROUPS.CHARACTER),
      allSources: groupedWorldbooks(WORLD_BOOK_RUNTIME_GROUPS.CHARACTER),
      selectedSet,
      renderer: renderWorldbookSource,
      sourceIds: groupedWorldbooks(WORLD_BOOK_RUNTIME_GROUPS.CHARACTER).map(source => source.source_id),
      openWorldbooks,
      selected: worldbookSources.selected,
      openCharacterGroups,
    }),
    renderAnalysisSourceSection({
      key: 'other',
      label: '其他世界书',
      state: analysisSourcesSelectionState(groupedWorldbooks(WORLD_BOOK_RUNTIME_GROUPS.OTHER), selectedSet),
      open: sectionIsOpen('other'),
      sources: visibleGroupedWorldbooks(WORLD_BOOK_RUNTIME_GROUPS.OTHER),
      allSources: groupedWorldbooks(WORLD_BOOK_RUNTIME_GROUPS.OTHER),
      selectedSet,
      renderer: renderWorldbookSource,
      sourceIds: groupedWorldbooks(WORLD_BOOK_RUNTIME_GROUPS.OTHER).map(source => source.source_id),
      openWorldbooks,
      selected: worldbookSources.selected,
      openCharacterGroups,
    }),
  ].join('');
  const loading = worldbookSources.loading ? '<p class="bioweave-muted">正在读取世界书来源…</p>' : '';
  const selectedCount = Number(worldbookSources.selectedCount || 0);
  const selectedWorldbookCount = Number(worldbookSources.selectedWorldbookCount || 0);
  const tokenEstimate = Number(worldbookSources.selectedTokenEstimate || 0);
  return [
    `<details class="bioweave-settings-disclosure bioweave-settings-group bioweave-worldbook-source-disclosure" data-bioweave-settings-disclosure="worldbook"${openSettingsSections.has('worldbook') ? ' open' : ''}>`,
    renderSettingsSummary('世界书来源', '选择角色卡字段和世界书条目作为分析输入', null, {
      label: selectedCount > 0 ? selectedCount + ' 项已选' : '未选',
      tone: selectedCount > 0 ? 'good' : '',
    }),
    '<section class="bioweave-card bioweave-analysis-sources" data-bioweave-analysis-sources>',
    '<div class="bioweave-analysis-source-summary">',
    '<strong>已选项目 ' + selectedCount + ' 个</strong>',
    '<span>世界书 ' + selectedWorldbookCount + ' 本 · 约 ' + tokenEstimate + ' tokens</span>',
    '</div>',
    '<div class="bioweave-analysis-source-toolbar">',
    '<label class="bioweave-analysis-source-search"><span>搜索来源和条目</span><input class="bioweave-input" type="search" data-bioweave-analysis-source-search value="',
    escapeHtml(worldbookSources.search ?? ''),
    '" placeholder="搜索角色卡字段或世界书条目" autocomplete="off" spellcheck="false"></label>',
    '<div class="bioweave-analysis-source-actions">',
    '<button type="button" class="bioweave-secondary-action" data-bioweave-action="refresh-analysis-sources"' + (worldbookSources.refreshBusy ? ' disabled' : '') + '>' + (worldbookSources.refreshBusy ? '刷新中…' : '刷新') + '</button>',
    '<button type="button" class="bioweave-secondary-action" data-bioweave-action="select-all-analysis-sources">全选</button>',
    '<button type="button" class="bioweave-secondary-action" data-bioweave-action="select-none-analysis-sources">全不选</button>',
    '</div>',
    '</div>',
    loading,
    '<div class="bioweave-analysis-source-list" data-bioweave-analysis-source-list>',
    groups,
    '</div>',
    '</section>',
    '</details>',
  ].join('');
}

function renderRecentStorySwitch({className = '', inputAttributes = '', checked = false, label = '', description = '', compact = false}) {
  const copy = compact ? '' : [
    '<span class="bioweave-switch-copy">',
    label ? '<strong>' + escapeHtml(label) + '</strong>' : '',
    description ? '<small>' + escapeHtml(description) + '</small>' : '',
    '</span>',
  ].join('');
  return [
    '<label class="bioweave-switch' + (compact ? ' bioweave-switch-compact' : '') + (className ? ' ' + className : '') + '">',
    '<input class="bioweave-switch-input" type="checkbox" ' + inputAttributes + (checked ? ' checked' : '') + ' role="switch" aria-checked="' + String(checked) + '">',
    '<span class="bioweave-switch-track" aria-hidden="true"><span class="bioweave-switch-thumb"></span></span>',
    copy,
    '</label>',
  ].join('');
}

function renderFloatingLauncherSettings({show = true, theme = DEFAULT_FLOATING_LAUNCHER_THEME, open = false} = {}) {
  const selectedTheme = normalizeFloatingLauncherTheme(theme);
  return [
    '<details class="bioweave-settings-disclosure bioweave-settings-group bioweave-floating-launcher-settings" data-bioweave-settings-disclosure="floating_launcher"' + (open ? ' open' : '') + '>',
    renderSettingsSummary('悬浮图标', '页面内 BioWeave 入口', null, {label: show ? '已启用' : '已关闭', tone: show ? 'good' : ''}),
    '<section class="bioweave-card bioweave-floating-launcher-settings-card">',
    '<div class="bioweave-floating-launcher-settings-controls">',
    '<label class="bioweave-settings-field bioweave-floating-launcher-theme-field"><span>颜色主题</span><select class="bioweave-select" data-bioweave-floating-launcher-theme aria-label="悬浮图标颜色主题">',
    '<option value="' + FLOATING_LAUNCHER_THEMES.MIDNIGHT_INDIGO + '"' + (selectedTheme === FLOATING_LAUNCHER_THEMES.MIDNIGHT_INDIGO ? ' selected' : '') + '>夜幕靛</option>',
    '<option value="' + FLOATING_LAUNCHER_THEMES.MIST_VIOLET + '"' + (selectedTheme === FLOATING_LAUNCHER_THEMES.MIST_VIOLET ? ' selected' : '') + '>雾境紫</option>',
    '<option value="' + FLOATING_LAUNCHER_THEMES.DEEP_TEAL + '"' + (selectedTheme === FLOATING_LAUNCHER_THEMES.DEEP_TEAL ? ' selected' : '') + '>深海青</option>',
    '</select></label>',
    renderRecentStorySwitch({
      checked: show,
      className: 'bioweave-floating-launcher-visibility',
      label: '显示悬浮图标',
      description: '',
      inputAttributes: 'data-bioweave-ui-preference="show_floating_launcher" aria-label="显示悬浮图标"',
    }),
    '</div>',
    '</section>',
    '</details>',
  ].join('');
}

function renderRecentStoryRegexRow(rule, index, allRules, scope) {
  const scopeLabel = scope === 'global' ? '全局' : '当前角色卡';
  const scopeAttribute = ' data-bioweave-recent-story-regex-scope="' + scope + '"';
  const rowAttribute = scope === 'global'
    ? 'data-bioweave-recent-story-global-regex-row'
    : 'data-bioweave-recent-story-regex-row';
  return [
    '<div class="bioweave-regex-row bioweave-recent-story-regex-row" role="row" ' + rowAttribute + ' data-bioweave-recent-story-regex-index="' + index + '"' + scopeAttribute + '>',
    '<div class="bioweave-recent-story-regex-cell bioweave-recent-story-regex-index" role="cell" data-label="#">' + (index + 1) + '</div>',
    '<div class="bioweave-recent-story-regex-cell bioweave-recent-story-regex-type" role="cell" data-label="类型">',
    '<select class="bioweave-select" aria-label="' + scopeLabel + '正则类型" data-bioweave-recent-story-regex-type data-bioweave-recent-story-regex-index="' + index + '"' + scopeAttribute + '>',
    '<option value="extract"' + (rule.type === 'extract' ? ' selected' : '') + '>提取</option>',
    '<option value="exclude"' + (rule.type === 'exclude' ? ' selected' : '') + '>清洗</option>',
    '</select>',
    '</div>',
    '<div class="bioweave-recent-story-regex-cell bioweave-recent-story-regex-pattern" role="cell" data-label="正则表达式">',
    '<input class="bioweave-input" type="text" aria-label="' + scopeLabel + '正则表达式" data-bioweave-recent-story-regex-pattern data-bioweave-recent-story-regex-index="' + index + '"' + scopeAttribute + ' value="' + escapeHtml(rule.pattern) + '" placeholder="/内容(.*?)内容/g 或普通写法" autocomplete="off" spellcheck="false">',
    '</div>',
    '<div class="bioweave-recent-story-regex-cell bioweave-recent-story-regex-enabled" role="cell" data-label="启用">',
    renderRecentStorySwitch({
      className: 'bioweave-recent-story-regex-switch',
      compact: true,
      checked: rule.enabled,
      inputAttributes: 'aria-label="启用' + scopeLabel + '规则" data-bioweave-recent-story-regex-enabled data-bioweave-recent-story-regex-index="' + index + '"' + scopeAttribute,
    }),
    '</div>',
    '<div class="bioweave-regex-move bioweave-recent-story-regex-order" role="cell" data-label="执行顺序">',
    '<button type="button" class="bioweave-button bioweave-secondary-action bioweave-recent-story-order-action" aria-label="上移' + scopeLabel + '第 ' + (index + 1) + ' 条规则" data-bioweave-action="move-recent-story-regex-up" data-bioweave-recent-story-regex-index="' + index + '"' + scopeAttribute + (index === 0 ? ' disabled' : '') + '><i class="fa-solid fa-chevron-up" aria-hidden="true"></i><span>上移</span></button>',
    '<button type="button" class="bioweave-button bioweave-secondary-action bioweave-recent-story-order-action" aria-label="下移' + scopeLabel + '第 ' + (index + 1) + ' 条规则" data-bioweave-action="move-recent-story-regex-down" data-bioweave-recent-story-regex-index="' + index + '"' + scopeAttribute + (index === allRules.length - 1 ? ' disabled' : '') + '><i class="fa-solid fa-chevron-down" aria-hidden="true"></i><span>下移</span></button>',
    '</div>',
    '<div class="bioweave-recent-story-regex-cell bioweave-recent-story-regex-operation" role="cell" data-label="操作">',
    '<button type="button" class="bioweave-button bioweave-recent-story-delete-action" aria-label="删除' + scopeLabel + '第 ' + (index + 1) + ' 条规则" data-bioweave-action="remove-recent-story-regex" data-bioweave-recent-story-regex-index="' + index + '"' + scopeAttribute + '><i class="fa-solid fa-trash-can" aria-hidden="true"></i><span>删除</span></button>',
    '</div>',
    '</div>',
  ].join('');
}

function renderRecentStoryRegexTable(scope, rules) {
  return [
    '<div class="bioweave-recent-story-regex-table" role="table" data-bioweave-recent-story-regex-table="' + scope + '">',
    '<div class="bioweave-recent-story-regex-list" data-bioweave-recent-story-regex-list="' + scope + '">',
    rules.map((rule, index, allRules) => renderRecentStoryRegexRow(rule, index, allRules, scope)).join('') || '<p class="bioweave-empty">暂无规则。</p>',
    '</div>',
    '</div>',
  ].join('');
}

function renderRecentStoryRegexScope({scope, title, description, settings}) {
  return [
    '<section class="bioweave-recent-story-regex-scope" data-bioweave-recent-story-regex-scope="' + scope + '" data-bioweave-recent-story-regex-section>',
    '<header class="bioweave-recent-story-regex-scope-header"><div><h4>' + title + '</h4><p class="bioweave-muted">' + description + '</p></div>',
    '<button type="button" class="bioweave-button bioweave-recent-story-add-action" data-bioweave-action="add-recent-story-regex" data-bioweave-recent-story-regex-scope="' + scope + '"><i class="fa-solid fa-plus" aria-hidden="true"></i><span>新增规则</span></button></header>',
    renderRecentStoryRegexTable(scope, settings.regex_rules),
    '</section>',
  ].join('');
}

function renderRecentStorySettings(recentStory = {}, openSettingsSections = [], globalRecentStory = {}) {
  const settings = normalizeRecentStorySettings(recentStory);
  const globalSettings = {regex_rules: normalizeRecentStorySettings(globalRecentStory).regex_rules};
  const open = Array.isArray(openSettingsSections) && openSettingsSections.includes('recent_story');
  return [
    '<details class="bioweave-settings-disclosure bioweave-settings-group bioweave-recent-story-disclosure" data-bioweave-settings-disclosure="recent_story"' + (open ? ' open' : '') + '>',
    renderSettingsSummary('最近剧情', '读取当前 Chat 的最近楼层，并按规则提取与清洗', null, {
      label: settings.floor_count + ' 楼',
      tone: Number(settings.floor_count) > 0 ? 'good' : '',
    }, 'bioweave-recent-story-summary'),
    '<section class="bioweave-recent-story-settings" data-bioweave-recent-story-settings>',
    '<div class="bioweave-recent-story-read-options" data-bioweave-recent-story-read-settings>',
    '<label class="bioweave-recent-story-count"><span class="bioweave-recent-story-count-copy"><strong>读取最近楼层</strong></span>',
    '<input class="bioweave-input" type="number" min="0" max="1000" step="1" inputmode="numeric" data-bioweave-recent-story-floor-count value="' + escapeHtml(settings.floor_count) + '">',
    '<span class="bioweave-recent-story-count-unit">楼</span></label>',
    renderRecentStorySwitch({
      className: 'bioweave-recent-story-user-regex',
      label: '对用户楼应用正则',
      description: '开场楼（0 楼）始终保留原文。',
      checked: settings.regex_user_enabled,
      inputAttributes: 'aria-label="对用户楼应用正则" data-bioweave-recent-story-user-regex',
    }),
    '</div>',
    '<div class="bioweave-recent-story-regex-sections" data-bioweave-recent-story-regex-settings>',
    renderRecentStoryRegexScope({
      scope: 'global',
      title: '全局正则',
      description: '适用于所有角色卡；执行时先于当前角色卡规则。',
      settings: globalSettings,
    }),
    renderRecentStoryRegexScope({
      scope: 'character',
      title: '当前角色卡正则',
      description: '只作用于当前 Chat 与当前角色卡；现有规则继续保存在 Chat。',
      settings,
    }),
    '</div>',
    '<p class="bioweave-setting-note" data-bioweave-recent-story-tip>规则按从上到下依次处理；0 楼（开场楼）始终保留原文。</p>',
    '</section>',
    '</details>',
  ].join('');
}

const EXTERNAL_MEMORY_OPTIONS = [
  ['anima', '读取 Anima'],
  ['baobaoshu', '读取柏宝书'],
  ['database_memory', '读取数据库记忆'],
];

function renderExternalMemorySettings(externalMemory = {}, providers = [], openSettingsSections = []) {
  const open = Array.isArray(openSettingsSections) && openSettingsSections.includes('external_memory');
  const providerByKey = new Map((Array.isArray(providers) ? providers : []).map(provider => [provider.key, provider]));
  const availableCount = EXTERNAL_MEMORY_OPTIONS.filter(([key]) => providerByKey.get(key)?.available === true).length;
  const rows = EXTERNAL_MEMORY_OPTIONS.map(([key, label]) => {
    const provider = providerByKey.get(key);
    const available = provider?.available === true;
    const checked = externalMemory[key] === true;
    const unavailable = !available;
    const status = provider?.status || '未检测到公开接口';
    const detail = available ? status || '已检测到，可在后续分析中读取。' : status;
    return [
      '<label class="bioweave-external-memory-option' + (unavailable ? ' is-unavailable' : '') + '">',
      '<input class="bioweave-checkbox" type="checkbox" data-bioweave-external-memory="' + key + '"' + (checked ? ' checked' : '') + (!available && !checked ? ' disabled' : '') + '>',
      '<span class="bioweave-external-memory-copy">',
      '<strong>' + label + '</strong>',
      '<small>' + escapeHtml(detail) + '</small>',
      '</span>',
      '<span class="bioweave-badge bioweave-external-memory-status' + (available ? ' good' : '') + '">' + (available ? '可用' : '不可用') + '</span>',
      '</label>',
    ].join('');
  }).join('');
  return [
    '<details class="bioweave-settings-disclosure bioweave-settings-group bioweave-external-memory-disclosure" data-bioweave-settings-disclosure="external_memory"' + (open ? ' open' : '') + '>',
    renderSettingsSummary('外部记忆来源', '选择可用于分析输入的外部记忆来源', null, {
      label: availableCount + '/' + EXTERNAL_MEMORY_OPTIONS.length + ' 可用',
      tone: availableCount > 0 ? 'good' : '',
    }),
    '<section class="bioweave-card bioweave-external-memory-settings" data-bioweave-external-memory-settings>',
    '<div class="bioweave-external-memory-list">',
    rows,
    '</div>',
    '</section>',
    '</details>',
  ].join('');
}

function renderAnalysisPromptSettings(prompt = {}, openSettingsSections = []) {
  const open = Array.isArray(openSettingsSections)
    && (openSettingsSections.includes('analysis_prompt') || openSettingsSections.includes('world_analysis_prompt'));
  const settings = normalizeAnalysisPrompt(prompt);
  const textArea = (label, key, value, hint = '') => [
    '<label class="bioweave-settings-field bioweave-analysis-prompt-field">',
    '<span>' + label + (hint ? '<small>' + hint + '</small>' : '') + '</span>',
    '<textarea class="bioweave-input" data-bioweave-analysis-prompt-field="' + key + '" rows="4">' + escapeHtml(value) + '</textarea>',
    '</label>',
  ].join('');
  return [
    '<details class="bioweave-settings-disclosure bioweave-settings-group bioweave-analysis-prompt-disclosure" data-bioweave-settings-disclosure="analysis_prompt"' + (open ? ' open' : '') + '>',
    renderSettingsSummary('分析提示词', '可修改发送给模型的补充内容', null, {
      label: '核心约束保留',
      tone: 'good',
    }),
    '<section class="bioweave-card bioweave-analysis-prompt-settings" data-bioweave-analysis-prompt-settings>',
    textArea('顶部 SYSTEM', 'system_top', settings.system_top),
    textArea('分析任务补充', 'task', settings.task),
    textArea('输入前说明', 'input_prefix', settings.input_prefix),
    textArea('输入后说明', 'input_suffix', settings.input_suffix),
    textArea('尾部 SYSTEM', 'system_bottom', settings.system_bottom),
    '<div class="bioweave-settings-actions">',
    '<button type="button" class="bioweave-primary-action" data-bioweave-action="save-analysis-prompt">保存提示词设置</button>',
    '</div>',
    '</section>',
    '</details>',
  ].join('');
}

function renderDataManagementSettings(dataManagement = {}, openSettingsSections = []) {
  const open = Array.isArray(openSettingsSections) && openSettingsSections.includes('data_management');
  const busy = dataManagement?.busy === true;
  const activeOperation = String(dataManagement?.operation ?? '').trim();
  const operations = DATA_MANAGEMENT_OPERATIONS.map(operation => {
    const active = busy && activeOperation === operation.key;
    return [
      '<article class="bioweave-data-management-operation" data-bioweave-clear-operation="' + operation.key + '">',
      '<div class="bioweave-data-management-operation-copy"><h3>' + operation.title + '</h3><p class="bioweave-muted">' + operation.description + '</p></div>',
      '<button type="button" class="bioweave-danger-action" data-bioweave-action="' + operation.action + '" data-bioweave-clear-operation="' + operation.key + '"' + (busy ? ' disabled' : '') + ' aria-busy="' + active + '">' + (active ? '清除中…' : operation.title) + '</button>',
      '</article>',
    ].join('');
  }).join('');
  return [
    '<details class="bioweave-settings-disclosure bioweave-settings-group bioweave-data-management-disclosure" data-bioweave-settings-disclosure="data_management"' + (open ? ' open' : '') + '>',
    renderSettingsSummary('数据管理', '管理当前聊天的 BioWeave 分析数据。不会影响 API、世界书、角色卡、插件设置或聊天内容。', null, {label: '仅当前聊天'}),
    '<section class="bioweave-card bioweave-data-management" data-bioweave-data-management>',
    '<header class="bioweave-settings-card-header"><div><h3>数据管理</h3><p class="bioweave-muted">管理当前聊天的 BioWeave 分析数据。不会影响 API、世界书、角色卡、插件设置或聊天内容。</p></div></header>',
    '<div class="bioweave-data-management-list">',
    operations,
    '</div>',
    '</section>',
    '</details>',
  ].join('');
}

function renderAnalysisMessagePreview(messages = [], mode = 'structure', analysisType = 'world') {
  const roleLabels = {system: 'SYSTEM', assistant: 'ASSISTANT', user: 'USER'};
  const typeLabel = analysisType === 'event' ? 'Event Analysis' : 'World Analysis';
  if (mode === 'raw') {
    return [
      '<section class="bioweave-analysis-message-preview' + (analysisType === 'world' ? ' bioweave-world-model-message-preview' : '') + '" data-bioweave-analysis-message-preview data-bioweave-analysis-type="' + analysisType + '"' + (analysisType === 'world' ? ' data-bioweave-world-model-message-preview' : '') + ' data-bioweave-analysis-message-preview-mode="raw">',
      '<h4>' + typeLabel + ' 实际发送消息</h4>',
      '<p class="bioweave-muted">以下是本次请求实际使用的 messages 原始 JSON；与结构预览来自同一份请求数据。</p>',
      '<pre class="bioweave-analysis-message-raw bioweave-analysis-preview-raw" data-bioweave-analysis-message-raw>' + escapeHtml(JSON.stringify(messages, null, 2)) + '</pre>',
      '</section>',
    ].join('');
  }
  return [
    '<section class="bioweave-analysis-message-preview' + (analysisType === 'world' ? ' bioweave-world-model-message-preview' : '') + '" data-bioweave-analysis-message-preview data-bioweave-analysis-type="' + analysisType + '"' + (analysisType === 'world' ? ' data-bioweave-world-model-message-preview' : '') + ' data-bioweave-analysis-message-preview-mode="structure">',
    '<h4>' + typeLabel + ' 实际发送消息</h4>',
    '<p class="bioweave-muted">以下是本次请求实际使用的消息分层；这里只读，不包含 API Key。</p>',
    '<div class="bioweave-analysis-message-list bioweave-world-model-message-list">',
    messages.map((message, index) => [
      '<details class="' + (analysisType === 'world' ? 'bioweave-world-model-message' : 'bioweave-analysis-message') + '"' + (analysisType === 'world' ? ' data-bioweave-world-model-message-index="' + index + '" data-bioweave-world-model-message-role="' + escapeHtml(message.role) + '"' : '') + ' data-bioweave-analysis-message-index="' + index + '" data-bioweave-analysis-message-role="' + escapeHtml(message.role) + '">',
      '<summary><strong>' + escapeHtml(roleLabels[message.role] || message.role) + '</strong><small>第 ' + (index + 1) + ' 段</small></summary>',
      '<pre class="' + (analysisType === 'world' ? 'bioweave-world-model-message-content' : 'bioweave-analysis-message-content') + '"' + (analysisType === 'world' ? ' data-bioweave-world-model-message-content' : ' data-bioweave-analysis-message-content') + '>' + escapeHtml(message.content) + '</pre>',
      '</details>',
    ].join('')).join(''),
    '</div>',
    '</section>',
  ].join('');
}

function traceValueText(value, emptyText = '暂无') {
  if (value === null || value === undefined || value === '') return emptyText;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function renderWorldModelTrace(preview = {}) {
  const trace = preview?.worldModelTrace;
  if (!trace || typeof trace !== 'object') return '';
  const rawResponse = trace.rawResponse ?? null;
  const canonicalModel = trace.canonicalModel ?? null;
  return [
    '<section class="bioweave-world-model-trace" data-bioweave-world-model-trace>',
    '<header><h4>世界模型调试信息</h4><p class="bioweave-muted">仅存在当前页面内存，不写入 Chat，也不进入普通世界模型页面。</p></header>',
    '<div class="bioweave-world-model-trace-grid">',
    '<section class="bioweave-world-model-trace-pane" data-bioweave-world-model-trace-raw>',
    '<h5>AI 原始返回</h5>',
    '<pre>' + escapeHtml(traceValueText(rawResponse)) + '</pre>',
    '</section>',
    '<section class="bioweave-world-model-trace-pane" data-bioweave-world-model-trace-canonical>',
    '<h5>规范化后的世界模型</h5>',
    '<pre>' + escapeHtml(traceValueText(canonicalModel)) + '</pre>',
    '</section>',
    '</div>',
    '</section>',
  ].join('');
}

export function renderAnalysisInputPreview(preview = {}) {
  const analysisType = preview?.analysisType === 'event' ? 'event' : 'world';
  const input = analysisType === 'event' ? preview?.eventInput : preview?.input;
  const mode = preview?.mode === 'raw' ? 'raw' : 'structure';
  const standalone = preview?.standalone === true;
  const messages = input && preview?.messagePreview === true
    ? analysisType === 'event'
      ? buildEventAnalysisMessages(input, preview.promptSettings)
      : buildWorldModelMessages(input, preview.promptSettings)
    : null;
  const messagePreview = messages
    ? renderAnalysisMessagePreview(messages, mode, analysisType)
    : '';
  const worldModelTrace = renderWorldModelTrace(preview);
  const open = Array.isArray(preview?.openSettingsSections)
    && preview.openSettingsSections.includes('analysis_preview');
  const content = input
    ? messagePreview || '<p class="bioweave-analysis-preview-message-hint">当前未启用实际分析 messages 预览。</p>'
    : '<p class="bioweave-empty">点击“刷新预览”后，临时读取当前 Chat 的已选分析输入。</p>';
  const error = preview?.error
    ? '<p class="bioweave-settings-notice" role="status">' + escapeHtml(preview.error) + '</p>'
    : '';
  const busy = preview?.busy === true;
  const card = [
    '<section class="bioweave-card bioweave-analysis-preview" data-bioweave-analysis-preview>',
    '<header><div><h3>分析输入预览</h3><p class="bioweave-muted">只读当前 Chat 的已选来源，不保存正文，不调用 AI。</p></div>',
    '<button type="button" class="bioweave-secondary-action" data-bioweave-action="refresh-analysis-preview"' + (busy ? ' disabled' : '') + '>' + (busy ? '读取中…' : '刷新预览') + '</button></header>',
    error,
    input ? '<div class="bioweave-analysis-preview-toolbar"><strong>预计 ' + escapeHtml(input.token_estimate ?? 0) + ' tokens</strong><span class="bioweave-muted">预览内容只存在于当前页面内存</span><div class="bioweave-analysis-preview-type" role="group" aria-label="分析类型">' +
      '<button type="button" class="bioweave-secondary-action' + (analysisType === 'world' ? ' is-selected' : '') + '" data-bioweave-action="analysis-preview-type" data-bioweave-preview-type="world" aria-pressed="' + (analysisType === 'world') + '">World Analysis</button>' +
      '<button type="button" class="bioweave-secondary-action' + (analysisType === 'event' ? ' is-selected' : '') + '" data-bioweave-action="analysis-preview-type" data-bioweave-preview-type="event" aria-pressed="' + (analysisType === 'event') + '">Event Analysis</button>' +
      '</div><div class="bioweave-analysis-preview-mode" role="group" aria-label="预览模式">' +
      '<button type="button" class="bioweave-secondary-action' + (mode === 'structure' ? ' is-selected' : '') + '" data-bioweave-action="analysis-preview-mode" data-bioweave-preview-mode="structure" aria-pressed="' + (mode === 'structure') + '">结构预览</button>' +
      '<button type="button" class="bioweave-secondary-action' + (mode === 'raw' ? ' is-selected' : '') + '" data-bioweave-action="analysis-preview-mode" data-bioweave-preview-mode="raw" aria-pressed="' + (mode === 'raw') + '">原始内容</button>' +
      '</div></div>' : '',
    '<div class="bioweave-debug-preview-scroll bioweave-analysis-preview-content">',
    worldModelTrace,
    content,
    '</div>',
    '</section>',
  ].join('');
  if (standalone) return card;
  return [
    '<details class="bioweave-settings-disclosure bioweave-settings-group bioweave-analysis-preview-disclosure" data-bioweave-settings-disclosure="analysis_preview"' + (open ? ' open' : '') + '>',
    renderSettingsSummary('高级 / 调试', '临时检查本次分析实际读取的内容'),
    card,
    '</details>',
  ].join('');
}

function renderPersistenceTrace(trace = null) {
  if (!trace || typeof trace !== 'object') {
    return '<section class="bioweave-card bioweave-persistence-trace" data-bioweave-persistence-trace><header class="bioweave-debug-section-header"><div><h4>最近一次运行诊断</h4><p class="bioweave-muted">包含 Story Time、Projection、Floor persistence、Projection Context 与 generation boundary 的安全阶段数据；不包含完整输入、提示词或凭据。</p></div><button type="button" class="bioweave-secondary-action" data-bioweave-action="export-debug-txt">导出调试信息（TXT）</button></header><div class="bioweave-debug-preview-scroll"><p class="bioweave-muted">尚未收到分析或 Projection persistence trace。</p></div></section>';
  }
  return [
    '<section class="bioweave-card bioweave-persistence-trace" data-bioweave-persistence-trace>',
    '<header class="bioweave-debug-section-header"><div><h4>最近一次运行诊断</h4><p class="bioweave-muted">包含 Story Time、Projection、Floor persistence、Projection Context 与 generation boundary 的安全阶段数据；不包含完整输入、提示词或凭据。</p></div><button type="button" class="bioweave-secondary-action" data-bioweave-action="export-debug-txt">导出调试信息（TXT）</button></header>',
    '<pre class="bioweave-debug-preview-scroll" data-bioweave-persistence-trace-content>' + escapeHtml(traceValueText(trace)) + '</pre>',
    '</section>',
  ].join('');
}

function renderWorldModelLiveState(liveState = null) {
  const latestFactDelta = liveState?.latest_fact_delta;
  const funnelFields = [
    ['Raw Fact Blocks', 'raw_fact_block_count'],
    ['Parsed Facts', 'parsed_fact_count'],
    ['Parse Rejected', 'parse_rejected_fact_count'],
    ['Resolution Rejected', 'resolution_rejected_fact_count'],
    ['Evidence Guard Rejected', 'evidence_guard_rejected_fact_count'],
    ['Accepted Facts', 'accepted_fact_count'],
    ['Accepted Operations', 'accepted_operation_count'],
  ];
  const funnel = latestFactDelta && typeof latestFactDelta === 'object' && funnelFields.some(([, key]) => Object.hasOwn(latestFactDelta, key))
    ? '<section class="bioweave-world-model-fact-funnel" data-bioweave-world-model-fact-funnel><h5>Fact Delta Funnel</h5><dl>' + funnelFields.map(([label, key]) => '<div><dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(String(latestFactDelta[key] ?? 0)) + '</dd></div>').join('') + '</dl></section>'
    : '';
  const completenessFields = [
    ['Identity Reviews', 'identity_review_completed_count', 'identity_review_count'],
    ['Coverage Dispositions', 'coverage_disposition_count', 'coverage_target_count'],
  ];
  const completeness = latestFactDelta && typeof latestFactDelta === 'object' && completenessFields.some(([, completed]) => Object.hasOwn(latestFactDelta, completed))
    ? '<section class="bioweave-world-model-completeness" data-bioweave-world-model-completeness><h5>Supplement Completeness</h5><dl>' + completenessFields.map(([label, completed, total]) => '<div><dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(`${latestFactDelta[completed] ?? 0} / ${latestFactDelta[total] ?? 0}`) + '</dd></div>').join('') + '<div><dt>Complete</dt><dd>' + escapeHtml(String(latestFactDelta.supplement_completeness_complete ?? latestFactDelta.completeness_satisfied ?? false)) + '</dd></div></dl></section>'
    : '';
  const latestNonempty = liveState?.latest_nonempty_fact_delta;
  const latestNonemptySummary = latestNonempty?.summary ?? latestNonempty;
  const nonempty = latestNonemptySummary && typeof latestNonemptySummary === 'object'
    ? '<section class="bioweave-world-model-latest-nonempty" data-bioweave-world-model-latest-nonempty><h5>Latest Non-empty Fact Delta</h5><dl><div><dt>Execution</dt><dd>' + escapeHtml(String(latestNonempty.execution_id ?? '')) + '</dd></div><div><dt>Raw Fact Blocks</dt><dd>' + escapeHtml(String(latestNonemptySummary.raw_fact_block_count ?? 0)) + '</dd></div><div><dt>Parsed Facts</dt><dd>' + escapeHtml(String(latestNonemptySummary.parsed_fact_count ?? 0)) + '</dd></div><div><dt>Guard Rejected</dt><dd>' + escapeHtml(String(latestNonemptySummary.evidence_guard_rejected_fact_count ?? 0)) + '</dd></div><div><dt>Accepted Facts</dt><dd>' + escapeHtml(String(latestNonemptySummary.accepted_fact_count ?? 0)) + '</dd></div></dl></section>'
    : '';
  const displayLiveState = latestFactDelta && typeof latestFactDelta === 'object'
    ? {
        ...liveState,
        latest_fact_delta: Object.fromEntries(Object.entries(latestFactDelta).filter(([key]) => key !== 'fact_count' && key !== 'rejected_fact_count')),
      }
    : liveState;
  return [
    '<section class="bioweave-card bioweave-world-model-live-state" data-bioweave-world-model-live-state>',
    '<header><div><h4>WORLD MODEL LIVE STATE</h4><p class="bioweave-muted">在查看或导出动作触发时重新采样；只读，不触发分析或修复。</p></div></header>',
    funnel,
    completeness,
    nonempty,
    '<pre data-bioweave-world-model-live-state-content>' + escapeHtml(traceValueText(displayLiveState, '尚未采样 LIVE STATE')) + '</pre>',
    '</section>',
  ].join('');
}

function renderWorldModelLastExecution(liveState = null) {
  const fact = liveState?.latest_fact_delta ?? {};
  const debugSchemaVersion = Number(fact?.world_model_debug_schema_version ?? 0);
  const rows = [
    ['Debug Schema Version', fact?.world_model_debug_schema_version],
    ['Execution ID', liveState?.active_world_execution_id ?? liveState?.latest_world_fact_delta_execution_id],
    ['First Failed Stage', fact?.first_failed_stage],
    ['Request Mode', fact?.request_envelope?.request_mode ?? fact?.request_mode],
    ['Raw Facts', fact?.raw_fact_block_count],
    ['Parsed Facts', fact?.parsed_fact_count],
    ['Resolver Rejected', fact?.resolution_rejected_fact_count],
    ['Guard Rejected', fact?.evidence_guard_rejected_fact_count],
    ['Accepted Operations', fact?.accepted_operation_count],
    ['Canonical Mutation', fact?.canonical_mutation_occurred],
    ['Candidate', liveState?.candidate_execution_id ?? liveState?.candidate_state],
    ['Current Execution Candidate', liveState?.current_execution_candidate_id],
    ['Candidate Belongs to Previous Execution', liveState?.candidate_belongs_to_previous_execution],
    ['Candidate Fingerprint', liveState?.candidate_fingerprint],
    ['UI Projection', liveState?.ui_projection_state],
    ['UI Fingerprint', liveState?.ui_state_fingerprint],
    ['Execution Result', liveState?.execution_result],
    ['Fact Delta Result', fact?.fact_delta_result],
    ['Fact Delta Analysis Result', fact?.analysis_outcome],
    ['Derived Target Accounting', fact?.derived_target_accounting_complete],
    ['Persistence Confirmed', liveState?.persistence_confirmed],
    ['Persisted Fingerprint', liveState?.persisted_fingerprint],
  ];
  const transition = Array.isArray(liveState?.request_transitions) ? liveState.request_transitions.at(-1) : null;
  const transitionMarkup = transition
    ? '<h5>WORLD MODEL REQUEST TRANSITION</h5><pre data-bioweave-world-model-request-transition>' + escapeHtml(traceValueText(transition)) + '</pre>'
    : '';
  const identityMarkup = Array.isArray(fact?.type_identity_decisions)
    ? '<h5>TYPE IDENTITY DECISIONS</h5><pre data-bioweave-world-model-type-identity-decisions>' + escapeHtml(traceValueText(fact.type_identity_decisions.slice(0, 32))) + '</pre>'
    : '';
  const schemaMismatchMarkup = debugSchemaVersion > 0 && debugSchemaVersion !== 3
    ? '<p class="bioweave-status-error" data-bioweave-world-model-debug-schema-mismatch>DEBUG_SCHEMA_MISMATCH</p>'
    : '';
  return [
    '<section class="bioweave-card bioweave-world-model-last-execution" data-bioweave-world-model-last-execution>',
    '<header><div><h4>WORLD MODEL LAST EXECUTION</h4><p class="bioweave-muted">按阶段显示最近一次 World Model execution 的真实断点；不包含完整 prompt。</p></div></header>',
    schemaMismatchMarkup,
    '<dl class="bioweave-data-list">' + rows.map(([label, value]) => '<div><dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(String(value ?? '—')) + '</dd></div>').join('') + '</dl>',
    transitionMarkup,
    identityMarkup,
    '</section>',
  ].join('');
}

function renderBusinessDebugSource(source) {
  if (!source) return '<p class="bioweave-muted">来源不可用</p>'
  const version = source.floor_version ?? null
  return '<dl class="bioweave-data-list">' + [
    ['来源类型', source.source_type],
    ['来源 Floor', source.floor ?? source.index],
    ['来源 Swipe', source.swipe_id],
    ['Chat', version?.chat_id],
    ['message id', version?.message_id],
    ['floor', version?.floor],
    ['swipe id', version?.swipe_id],
    ['content hash', version?.content_hash],
    ['message version', version?.message_version],
  ].map(([label, value]) => '<div><dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(traceValueText(value)) + '</dd></div>').join('') + '</dl>'
}

function renderBusinessDebugRows(rows = []) {
  return '<dl class="bioweave-data-list">' + rows.map(([label, value]) => '<div><dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(traceValueText(value)) + '</dd></div>').join('') + '</dl>';
}

function renderNsfwPipelineDiagnostics(debug = {}) {
  const pipeline = debug?.nsfw_pipeline_diagnostics ?? {};
  const current = pipeline.current_state ?? {};
  const derived = pipeline.derived_diagnostic ?? {};
  const trace = pipeline.execution_trace ?? {};
  const timingDiagnostics = Array.isArray(pipeline.timing_diagnostics)
    ? pipeline.timing_diagnostics
    : Array.isArray(debug?.timing_diagnostics) ? debug.timing_diagnostics : [];
  const aggregationDiagnostics = Array.isArray(pipeline.aggregation_diagnostics)
    ? pipeline.aggregation_diagnostics
    : Array.isArray(debug?.aggregation_diagnostics) ? debug.aggregation_diagnostics : [];
  const projectionDiagnostics = pipeline.projection_diagnostics ?? {};
  const traceStages = Array.isArray(trace.stages) ? trace.stages : [];
  const projectionStatusCards = (Array.isArray(projectionDiagnostics.status_trace)
    ? projectionDiagnostics.status_trace
    : []).slice(-16).map(item => '<article class="bioweave-business-debug-window"><h5>' + escapeHtml(item.stage ?? 'UNKNOWN') + '</h5>' + renderBusinessDebugRows([
    ['state / phase', [item.state, item.phase]], ['reason', item.reason],
    ['Projection 路线 / 外部 API', [item.projection_route, item.external_api_allowed]],
    ['scheduler 判定 / analysis execution', [item.scheduler_decision, item.analysis_execution_id]],
    ['阶段快照 / 候选数', [item.snapshot_status, item.candidate_count]],
    ['阶段人物 / 复用候选数', [item.subject_count, item.reused_candidate_count]],
    ['延后 API 候选数', item.deferred_external_api_candidate_count], ['failure_reason', item.failure_reason],
  ]) + '</article>').join('') || '<p class="bioweave-muted">当前没有 Projection 状态 Trace。</p>';
  const stageCards = traceStages.slice(-16).map(stage => '<article class="bioweave-business-debug-window"><h5>' + escapeHtml(stage.stage ?? 'UNKNOWN') + '</h5>' + renderBusinessDebugRows([
    ['execution_status', stage.execution_status], ['reason_code', stage.reason_code], ['invoked', stage.invoked],
    ['Projection 路线 / 外部 API', [stage.projection_route, stage.external_api_allowed]], ['phase', stage.phase],
    ['scheduler 判定', stage.scheduler_decision], ['阶段快照状态', stage.snapshot_status],
    ['阶段人物 / 阶段键', [stage.subject_count, stage.stage_keys]], ['复用候选数', stage.reused_candidate_count],
    ['内置候选 / 延后 API 候选', [stage.built_in_candidate_count, stage.deferred_external_api_candidate_count]],
    ['候选数 / 失败原因', [stage.candidate_count, stage.failure_reason]],
    ['run_id', stage.run_id], ['Chat', stage.chat_id], ['Floor / Swipe', [stage.floor, stage.active_swipe_id]],
    ['subject_id', stage.subject_id], ['mechanism_key', stage.mechanism_key], ['Tracking Window', stage.tracking_window_id],
    ['Tracking Window Cycle', stage.tracking_window_cycle_id], ['final cycle_id', stage.final_cycle_id ?? stage.cycle_id], ['cycle_id 来源', stage.cycle_id_source], ['Cycle 一致性', [stage.cycle_id_consistent, stage.cycle_id_consistency_reason_code]],
    ['first Exposure', stage.first_exposure_event_id], ['候选 Exposure', stage.candidate_exposure_event_ids], ['accepted Exposure', stage.accepted_exposure_event_ids],
    ['input_count', stage.input_count], ['output_count', stage.output_count], ['配置 base min/max', [stage.base_min_story_days, stage.base_max_story_days]],
    ['variance_ratio', stage.variance_ratio], ['variance_cap_story_days', stage.variance_cap_story_days],
    ['sampled_individual_offset_story_days', stage.sampled_individual_offset_story_days], ['偏移来源 / 状态', [stage.sampled_offset_source, stage.frozen_offset_status]], ['RNG 来源', stage.rng_source],
    ['state_modifier_story_days', stage.state_modifier_story_days], ['total_adjustment_story_days', stage.total_adjustment_story_days],
    ['total_adjustment_cap_story_days', stage.total_adjustment_cap_story_days], ['effective min/max', [stage.effective_min_story_days, stage.effective_max_story_days]],
    ['world_rule_binding', stage.world_rule_binding], ['aggregation trigger', stage.aggregation_trigger_status], ['aggregation overdue', stage.aggregation_overdue],
    ['readback attempted/succeeded/present', [stage.readback_attempted, stage.readback_succeeded, stage.readback_result_present]],
    ['readback reason', stage.readback_reason_code], ['Projection Rules', [stage.projection_rules_available, stage.projection_rules_count]],
    ['Projection Eligibility / AI', [stage.projection_eligibility, stage.projection_ai_request_started]], ['Projection candidate status', stage.projection_candidate_status], ['Projection candidate source', stage.projection_candidate_source], ['人工修改 Timing', stage.manual_timing_edit], ['Aggregation 重新评估', stage.aggregation_reevaluation], ['error_code', stage.error_code],
  ]) + '</article>').join('') || '<p class="bioweave-muted">当前 Floor 没有可用的 NSFW 执行阶段记录。</p>';
  const aggregationByKey = new Map(aggregationDiagnostics.map(item => [
    [item.subject_id, item.mechanism_key, item.cycle_id, item.tracking_window_id].map(value => String(value ?? '')).join('\u001f'),
    item,
  ]));
  const personCards = timingDiagnostics.map(item => {
    const key = [item.subject_id, item.mechanism_key, item.cycle_id, item.tracking_window_id].map(value => String(value ?? '')).join('\u001f');
    const aggregation = aggregationByKey.get(key) ?? null;
    return '<details class="bioweave-business-debug-window"><summary>' + escapeHtml([item.subject_id, item.mechanism_key, item.cycle_id].filter(Boolean).join(' · ') || '未知 Tracking Subject') + '</summary>' + renderBusinessDebugRows([
      ['Tracking Window', item.tracking_window_id], ['Tracking Window Cycle', item.tracking_window_cycle_id], ['Tracking 状态', item.tracking_window_status], ['cycle_id 来源', item.cycle_id_source], ['Cycle 一致性', [item.cycle_id_consistent, item.cycle_id_consistency_reason_code]],
      ['first Exposure Event', item.first_exposure_event_id], ['候选 Exposure IDs', item.candidate_exposure_event_ids], ['source_event_ids', item.source_event_ids],
      ['accepted_exposure_event_ids', item.accepted_exposure_event_ids], ['排除候选原因', item.excluded_candidate_reasons], ['首次 Exposure Story Time', item.first_exposure_story_time],
      ['当前 Story Time', item.current_story_time], ['Story Time 原因', item.story_time_reason_code],
      ['Timing config available', item.timing_config_available], ['Timing config source', item.timing_config_source],
      ['人物默认配置', item.character_timing_config],
      ['Timing Instance', item.timing_instance_id], ['Timing Instance 解析', item.timing_instance_resolution], ['Timing Instance 存在', item.timing_instance_exists],
      ['Timing readback attempted/succeeded/present', [item.timing_instance_readback_attempted, item.timing_instance_readback_succeeded, item.timing_instance_readback_result_present]],
      ['Timing readback reason', item.timing_instance_readback_reason_code], ['配置 base min/max', [item.base_min_story_days, item.base_max_story_days]],
      ['variance_ratio', item.variance_ratio], ['variance_cap_story_days', item.variance_cap_story_days],
      ['sampled_individual_offset_story_days', item.sampled_individual_offset_story_days],
      ['state_modifier_story_days', item.state_modifier_story_days], ['total_adjustment_story_days', item.total_adjustment_story_days],
      ['total_adjustment_cap_story_days', item.total_adjustment_cap_story_days], ['world_rule_binding', item.world_rule_binding],
      ['effective_min_story_days', item.effective_min_story_days], ['effective_max_story_days', item.effective_max_story_days],
      ['当前 Timing 快照', item.active_timing_instance], ['人工修改 Timing', item.manual_timing_edit],
      ['Timing 状态', item.timing_status], ['Timing 原因', item.timing_reason_code], ['Timing 证据来源', item.timing_evidence_source],
      ['aggregation_due', item.aggregation_due], ['aggregation_trigger_status', aggregation?.aggregation_trigger_status], ['overdue', aggregation?.aggregation_overdue],
      ['aggregation_attempted', item.aggregation_attempted], ['aggregation block reason', item.aggregation_block_reason],
      ['Aggregation 状态', aggregation?.aggregation_status], ['Aggregation 原因', aggregation?.aggregation_reason_code],
      ['Aggregation 重新评估', aggregation?.aggregation_reevaluation],
      ['Aggregation invoked', aggregation?.aggregation_invoked], ['Aggregation attempts', aggregation?.aggregation_attempt_count],
      ['Aggregation ID', aggregation?.aggregation_id], ['Aggregation persistence', aggregation?.persistence_succeeded],
      ['Aggregation readback attempted/succeeded/present', [aggregation?.readback_attempted, aggregation?.readback_succeeded, aggregation?.readback_result_present]],
      ['Aggregation readback reason', aggregation?.readback_reason_code],
    ]) + '</details>';
  }).join('') || '<p class="bioweave-muted">当前没有可展开的人物级 Timing 诊断。</p>';
  return [
    '<section class="bioweave-business-debug-lifecycle" data-bioweave-nsfw-pipeline-diagnostics><h5>NSFW Pipeline Diagnostics</h5>',
    '<p class="bioweave-muted">CURRENT_STATE、EXECUTION_TRACE、DERIVED_DIAGNOSTIC 分开显示；缺少历史记录时不推断为未调用。</p>',
    '<h6>当前执行状态</h6>' + renderBusinessDebugRows([
      ['执行状态', derived.current_execution_status], ['当前阻断阶段', derived.current_blocking_stage], ['当前阻断原因', derived.current_blocking_reason_code],
      ['诊断置信度', derived.confidence], ['current_run_id', derived.current_run_id], ['trace_buffer_status', trace.trace_buffer_status], ['trace_truncated', trace.trace_truncated],
      ['当前 Chat / Floor / Swipe', [pipeline.automatic_execution?.current_chat_id, pipeline.automatic_execution?.current_floor, pipeline.automatic_execution?.active_swipe_id]],
      ['插件启用', current.plugin_enabled], ['自动入口已注册', pipeline.automatic_execution?.entry_registered], ['最近触发', pipeline.automatic_execution?.latest_trigger],
      ['Event 数量', current.event_count], ['有效 Exposure 数量', current.authoritative_exposure_count], ['pregnancy-relevant Exposure 数量', current.pregnancy_relevant_exposure_count],
      ['Exposure 候选 Subject / mechanism', [current.candidate_subject_ids, current.candidate_mechanism_keys]], ['Tracking 人物数量', current.tracking_subject_count], ['Tracking Window 数量', current.tracking_window_count], ['Timing Instance 数量', current.timing_instance_count],
      ['Participant Aggregation 数量', current.participant_aggregation_count], ['Projection 数量', current.projection_count], ['Projection Rule 数量', current.projection_rules_count],
      ['Projection 路线 / 外部 API', [projectionDiagnostics.last_projection_route, projectionDiagnostics.last_external_api_allowed]],
      ['Projection 最近状态', [projectionDiagnostics.last_status_stage, projectionDiagnostics.last_status_state]],
      ['内部触发 / scheduler 判定', [projectionDiagnostics.last_internal_trigger, projectionDiagnostics.scheduler_decision]],
      ['阶段复用', projectionDiagnostics.stage_reuse], ['阶段快照', projectionDiagnostics.stage_snapshot],
      ['Projection Eligibility / AI', [projectionDiagnostics.eligibility_status, projectionDiagnostics.ai_scheduling_status, projectionDiagnostics.projection_ai_request_count]],
      ['NSFW Lock Gate', current.nsfw_lock?.gate], ['Lock 对聚合创建的影响', derived.capability_flag_effect?.aggregation_creation_control],
    ]) +
    '<h6>最近一次聚合尝试</h6>' + renderBusinessDebugRows([
      ['状态', derived.latest_aggregation_attempt?.aggregation_status], ['原因', derived.latest_aggregation_attempt?.aggregation_reason_code],
      ['aggregation_id', derived.latest_aggregation_attempt?.aggregation_id], ['last_attempt_at', derived.latest_aggregation_attempt?.last_attempt_at],
    ]) +
    '<h6>Projection 路由与阶段状态（最近 16 条）</h6>' + projectionStatusCards +
    '<h6>人物级 Timing / Aggregation</h6>' + personCards +
    '<h6>执行阶段（最近 16 条）</h6>' + stageCards +
    '</section>',
  ].join('');
}

function renderLifecycleRuntimeDebug(debug = {}) {
  if (debug?.status === 'unavailable') return '<section><h5>Pregnancy Lifecycle Runtime</h5><p class="bioweave-status-error">读取失败：' + escapeHtml(debug.reason ?? 'LIFECYCLE_DEBUG_UNAVAILABLE') + '</p></section>';
  const aggregation = debug.participant_aggregation ?? {};
  const delivery = debug.projection_delivery ?? {};
  const lifecycle = debug.pregnancy_lifecycle ?? {};
  const lock = debug.nsfw_lock ?? {};
  const projectionTiming = debug.projection_timing ?? {};
  const timingRuntime = projectionTiming.timing_runtime ?? {};
  const timingCards = (projectionTiming.timing_instances ?? []).map(item => '<article class="bioweave-business-debug-window"><h5>' + escapeHtml(item.timing_instance_id ?? '未知 timing instance') + '</h5>' + renderBusinessDebugRows([
    ['subject_id', item.subject_id], ['cycle_id', item.cycle_id], ['首次 Exposure Story Time', item.reference_story_time],
    ['首次 Exposure Floor Version', item.created_at_floor_version], ['冻结 effective_min', item.effective_min_story_days],
    ['冻结 effective_max', item.effective_max_story_days], ['当前 Story Time', projectionTiming.current_story_time],
    ['Timing 状态', item.derived_timing?.status],
    ['Timing 原因', item.derived_timing?.reason_code], ['当前是否 due', item.aggregation?.due],
    ['aggregation 状态', item.aggregation?.status], ['aggregation 成功', item.aggregation?.succeeded],
    ['aggregation 未执行原因', item.aggregation?.reason_code],
  ]) + '</article>').join('') || '<p class="bioweave-muted">当前没有 Timing Instance。</p>';
  const aggregationCards = (aggregation.aggregations ?? []).map(item => '<article class="bioweave-business-debug-window"><h5>' + escapeHtml(item.aggregation_id ?? '未知 aggregation') + '</h5>' + renderBusinessDebugRows([
    ['subject_id', item.subject_id], ['pregnancy_id（观察阶段可为 null）', item.pregnancy_id], ['cycle_id', item.cycle_id], ['状态', item.status], ['冻结状态', item.freeze_status],
    ['accepted Exposure 数量', item.accepted_exposure_count], ['aggregation Story Time', item.aggregation_story_time],
    ['accepted_exposure_event_ids', item.accepted_exposure_event_ids], ['effective_min', item.effective_min_story_days], ['effective_max', item.effective_max_story_days], ['触发策略', item.aggregation_trigger_strategy],
  ]) + '</article>').join('') || '<p class="bioweave-muted">当前没有 aggregation。</p>';
  const observationBoundary = debug.observation_boundary ?? {};
  const observationBoundaryCards = (observationBoundary.aggregations ?? []).map(item => '<article class="bioweave-business-debug-window"><h5>' + escapeHtml(item.aggregation_id ?? '未知 aggregation') + '</h5>' + renderBusinessDebugRows([
    ['Floor / Swipe 边界', item.floor_version], ['subject / mechanism', [item.subject_id, item.mechanism_key]], ['pregnancy_id（观察阶段可为 null）', item.pregnancy_id], ['冻结状态', item.freeze_status],
    ['accepted_exposure_event_ids', item.accepted_exposure_event_ids], ['当前有效 pregnancy-relevant Exposure IDs', item.current_exposure_event_ids],
    ['聚合后排除的 Exposure IDs', item.excluded_after_aggregation_event_ids], ['排除 reason_code', item.excluded_after_aggregation_reason],
    ['本轮起点 Story Time', item.reference_story_time], ['effective_max_story_days', item.effective_max_story_days], ['timeout_status', item.timeout_status],
    ['closure_reason', item.closure_reason], ['release_action', item.release_action], ['deleted_event_count', item.deleted_event_count],
  ]) + '</article>').join('') || '<p class="bioweave-muted">当前没有成功 aggregation 的观察轮次快照。</p>';
  const deliveryCards = (delivery.records ?? []).map(item => '<article class="bioweave-business-debug-window"><h5>' + escapeHtml(item.delivery_id ?? '未知 delivery') + '</h5>' + renderBusinessDebugRows([
    ['projection_id', item.projection_id], ['projection 是否存在', item.projection_present], ['aggregation_id', item.aggregation_id],
    ['subject_id', item.subject_id], ['cycle_id', item.cycle_id], ['提交状态', item.status], ['提交 Floor Version', item.submitted_floor_version],
    ['响应 Floor Version', item.response_floor_version], ['response_id', item.response_id], ['Event Analysis', item.analysis_status],
    ['明确 lifecycle fact IDs', item.explicit_lifecycle_fact_ids],
  ]) + '</article>').join('') || '<p class="bioweave-muted">当前没有 Projection delivery receipt。</p>';
  const lifecycleRows = [...(lifecycle.facts ?? []), ...(lifecycle.archives ?? []), ...(lifecycle.release_records ?? [])];
  return [
    '<section class="bioweave-business-debug-lifecycle"><h5>Projection Timing Runtime</h5>' + renderBusinessDebugRows([
      ['创建策略', timingRuntime.creation_policy], ['Projection Rule 可用', timingRuntime.projection_rules_available],
      ['运行状态', timingRuntime.status], ['未执行原因', timingRuntime.reason_code],
      ['Projection candidate status', projectionTiming.projection_diagnostics?.projection_candidate_status],
      ['Projection candidate source', projectionTiming.projection_diagnostics?.projection_candidate_source],
      ['Projection Rule IDs', projectionTiming.projection_rule_ids],
    ]) + timingCards + '</section>',
    '<section class="bioweave-business-debug-lifecycle"><h5>Participant Aggregation · ' + escapeHtml(String(aggregation.count ?? 0)) + '</h5>' + aggregationCards + '</section>',
    '<section class="bioweave-business-debug-lifecycle"><h5>观察轮次边界 · 当前轮次冻结诊断</h5>' + renderBusinessDebugRows([['当前 Floor / Swipe', observationBoundary.floor_version], ['当前 Story Time', observationBoundary.current_story_time]]) + observationBoundaryCards + '</section>',
    '<section class="bioweave-business-debug-lifecycle"><h5>Projection Delivery · ' + escapeHtml(String(delivery.count ?? 0)) + '</h5>' + deliveryCards + '</section>',
    '<section class="bioweave-business-debug-lifecycle"><h5>Pregnancy Lifecycle</h5>' + renderBusinessDebugRows([
      ['facts', lifecycle.facts?.length ?? 0], ['archives', lifecycle.archives?.length ?? 0], ['candidate records', lifecycle.candidate_records?.length ?? 0],
      ['release records', lifecycle.release_records?.length ?? 0], ['最近状态记录', lifecycleRows.at(-1) ?? null],
    ]) + '</section>',
    '<section class="bioweave-business-debug-lifecycle"><h5>NSFW Cycle Lock</h5>' + renderBusinessDebugRows([
      ['Capability enabled', lock.capability_enabled], ['Gate', lock.gate], ['Lifecycle archive/release ready', lock.lifecycle_archive_release_ready],
      ['Locked cycle keys', lock.locked_cycle_keys],
    ]) + '</section>',
  ].join('');
}

function renderTimingPerformanceDiagnostics(debug = {}) {
  const diagnostics = debug?.timing_performance_diagnostics ?? {}
  const operations = Array.isArray(diagnostics.recent_operations) ? diagnostics.recent_operations : []
  const cards = operations.slice(-8).reverse().map(operation => '<article class="bioweave-business-debug-window"><h5>' + escapeHtml(operation.operation ?? 'UNKNOWN') + '</h5>' + renderBusinessDebugRows([
    ['operation_id', operation.operation_id], ['character_id', operation.character_id], ['status', operation.status],
    ['character_count', operation.character_count],
    ['total_duration_ms', operation.total_duration_ms], ['render_count / scope', [operation.render_count, operation.render_scope]],
    ['persistence attempted/succeeded', [operation.persistence_attempted, operation.persistence_succeeded]],
    ['readback attempted/succeeded', [operation.readback_attempted, operation.readback_succeeded]],
    ['Aggregation reevaluation', [operation.aggregation_reevaluation_attempted, operation.aggregation_reevaluation_succeeded]],
    ['reason_code', operation.reason_code],
    ['stages', (operation.stages ?? []).map(stage => [stage.stage, stage.kind, stage.status, stage.duration_ms])],
  ]) + '</article>').join('')
  return '<section class="bioweave-business-debug-window" data-bioweave-timing-performance-diagnostics><h5>Timing 操作性能</h5>' + renderBusinessDebugRows([
    ['collection_status', diagnostics.collection_status],
    ['trace_buffer_status', diagnostics.trace_buffer_status],
    ['trace_truncated', diagnostics.trace_truncated],
    ['recent_operations', operations.length],
  ]) + (cards || '<p class="bioweave-muted">暂无 Timing 操作性能记录。</p>') + '</section>'
}

function renderStorylineDiagnostics(debug = {}) {
  const storyline = debug?.storyline ?? {};
  const snapshots = Array.isArray(storyline.snapshots) ? storyline.snapshots : [];
  const deliveries = Array.isArray(storyline.delivery_records) ? storyline.delivery_records : [];
  const trace = Array.isArray(storyline.execution_trace?.sequence) ? storyline.execution_trace.sequence : [];
  const snapshotCards = snapshots.map(snapshot => '<article class="bioweave-business-debug-window"><h5>' + escapeHtml(snapshot.display_name ?? snapshot.subject_id ?? '未知人物') + '</h5>' + renderBusinessDebugRows([
    ['subject_id / status', [snapshot.subject_id, snapshot.status]], ['snapshot_id', snapshot.snapshot_id], ['selected_branch_id', snapshot.selected_branch_id],
    ['current node / body count', [snapshot.current_node_index, snapshot.valid_body_count]], ['due_attempt_id', snapshot.due_attempt_id],
    ['branches', (snapshot.branches ?? []).map(branch => ({branch_id: branch.branch_id, title: branch.title, premise: branch.premise, node_count: branch.node_count, node_goals: branch.node_goals, conclusion_goal: branch.conclusion_goal}))],
  ]) + '</article>').join('') || '<p class="bioweave-muted">当前没有 storyline 快照。</p>';
  const deliveryCards = deliveries.slice(-16).map(item => '<article class="bioweave-business-debug-window"><h5>' + escapeHtml(item.delivery_record_id ?? item.response_id ?? 'receipt') + '</h5>' + renderBusinessDebugRows([
    ['kind / subject', [item.kind, item.subject_id]], ['response_id', item.response_id], ['context fingerprint', item.context_fingerprint], ['Floor Version', item.floor_version], ['created Floor Version', item.created_at_floor_version],
  ]) + '</article>').join('') || '<p class="bioweave-muted">当前没有 delivery receipt。</p>';
  const traceCards = trace.slice(-24).map(item => '<article class="bioweave-business-debug-window"><h5>' + escapeHtml(String(item.sequence ?? '') + ' · ' + (item.stage ?? 'UNKNOWN')) + '</h5>' + renderBusinessDebugRows([
    ['timestamp / phase / status', [item.timestamp, item.phase, item.status]], ['Chat / Floor Version', [item.chat_id, item.floor_version]], ['subject / display_name', [item.subject_id, item.display_name]],
    ['attempt / due', [item.attempt_id, item.due_attempt_id]], ['result / reason / error', [item.result, item.reason, item.error_code]], ['counts', item.counts], ['I/O summary', item.io], ['snapshot summary', item.snapshot], ['delivery summary', item.delivery],
  ]) + '</article>').join('') || '<p class="bioweave-muted">当前没有 storyline 执行 Trace。</p>';
  return '<section class="bioweave-business-debug-lifecycle" data-bioweave-storyline-debug><h5>Storyline Debug · 内容、读写与顺序</h5>' + renderBusinessDebugRows([
    ['状态来源', storyline.source_type], ['完整快照标记', storyline.snapshot_complete], ['快照数量', snapshots.length], ['Receipt 数量', deliveries.length], ['Trace 状态 / 截断', [storyline.execution_trace?.trace_buffer_status, storyline.execution_trace?.trace_truncated]],
  ]) + '<h6>当前完整 storyline 快照</h6>' + snapshotCards + '<h6>Delivery Submission / Response Receipts</h6>' + deliveryCards + '<h6>最近有界执行顺序</h6>' + traceCards + '<p class="bioweave-muted">正文只显示 Floor 引用、数量、fingerprint 和长度；不导出完整正文、prompt、原始 API response 或凭据。</p></section>';
}

function renderBusinessDebugState(debugState = null) {
  if (debugState?.status === 'error') {
    return '<section class="bioweave-card bioweave-business-debug" data-bioweave-business-debug><header class="bioweave-debug-section-header"><div><h4>当前生产业务状态</h4></div><button type="button" class="bioweave-secondary-action" data-bioweave-action="refresh-business-debug">刷新业务状态</button></header><div class="bioweave-debug-preview-scroll bioweave-business-debug-content"><p class="bioweave-status-error">读取失败：' + escapeHtml(debugState.reason ?? 'BUSINESS_DEBUG_FAILED') + '</p></div></section>'
  }
  const debug = debugState?.data ?? debugState
  if (!debug || typeof debug !== 'object') {
    return '<section class="bioweave-card bioweave-business-debug" data-bioweave-business-debug><header class="bioweave-debug-section-header"><div><h4>当前生产业务状态</h4></div><button type="button" class="bioweave-secondary-action" data-bioweave-action="refresh-business-debug">刷新业务状态</button></header><div class="bioweave-debug-preview-scroll bioweave-business-debug-content"><p class="bioweave-muted">点击“刷新业务状态”后读取。</p></div></section>'
  }
  const target = debug.target ?? {}
  const eventState = debug.event_state ?? {}
  const world = debug.world_model ?? {}
  const registry = debug.character_registry ?? {}
  const windows = debug.tracking_window ?? {}
  const trackingRegistry = debug.tracking_registry ?? {}
  const healthState = debug.health_state ?? {}
  const lifecycleRuntime = debug.lifecycle_runtime ?? {status: 'unavailable', reason: 'LIFECYCLE_DEBUG_NOT_INCLUDED'}
  const stale = debugState?.status === 'stale'
  const status = stale
    ? '<p class="bioweave-status-error" data-bioweave-business-debug-stale>调试采样已过期：' + escapeHtml(debugState.reason ?? '目标已变化，请刷新') + '</p>'
    : '<p class="bioweave-status-success" data-bioweave-business-debug-current>调试采样对应当前目标。</p>'
  const eventCards = (eventState.events ?? []).map(event => '<article class="bioweave-business-debug-event"><h5>' + escapeHtml(event.event_id ?? '未知 Event') + '</h5><dl class="bioweave-data-list">' + [
    ['类型', event.event_type],
    ['subject', event.subject_ids],
    ['participants', event.participant_ids],
    ['Story Time', event.story_time],
  ].map(([label, value]) => '<div><dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(traceValueText(value)) + '</dd></div>').join('') + '</dl>' + renderBusinessDebugSource(event.source) + '</article>').join('') || '<p class="bioweave-muted">当前没有有效 Event。</p>'
  const windowCards = (windows.windows ?? []).map(window => '<article class="bioweave-business-debug-window"><h5>' + escapeHtml(window.tracking_window_id ?? '未知 Window') + '</h5><dl class="bioweave-data-list">' + [
    ['cycle_id', window.cycle_id], ['subject_id', window.subject_id], ['mechanism_key', window.mechanism_key],
    ['source_event_ids', window.source_event_ids], ['source_basis_refs', window.source_basis_refs],
    ['opened_story_time', window.opened_story_time], ['opened_at_floor_version', window.opened_at_floor_version],
    ['status', window.status], ['terminal_event_id', window.terminal_event_id], ['terminal_reason', window.terminal_reason],
    ['terminal_story_time', window.terminal_story_time], ['terminal_at_floor_version', window.terminal_at_floor_version],
    ['horizon', windows.horizons?.[window.tracking_window_id]],
  ].map(([label, value]) => '<div><dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(traceValueText(value)) + '</dd></div>').join('') + '</dl></article>').join('') || '<p class="bioweave-muted">当前没有派生 Tracking Window。</p>'
  return [
    '<section class="bioweave-card bioweave-business-debug" data-bioweave-business-debug>',
    '<header class="bioweave-debug-section-header"><div><h4>当前生产业务状态</h4><p class="bioweave-muted">仅显示本次 Runtime 业务刷新产生的只读结果，不读取旧 Tracking Window Timeline。</p></div><button type="button" class="bioweave-secondary-action" data-bioweave-action="refresh-business-debug">刷新业务状态</button></header>',
    '<div class="bioweave-debug-preview-scroll bioweave-business-debug-content">',
    status,
    '<dl class="bioweave-data-list">' + [
      ['采样时间', debug.sampled_at], ['Chat', target.chat_id], ['目标 Floor', target.floor], ['Active Swipe', target.swipe_id],
      ['目标 Floor Version', target.floor_version], ['目标来源类型', target.source_type],
    ].map(([label, value]) => '<div><dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(traceValueText(value)) + '</dd></div>').join('') + '</dl>',
    '<section><h5>BiologicalEvent 完整状态 · ' + escapeHtml(String(eventState.count ?? 0)) + '</h5>' + renderBusinessDebugSource(eventState.source) + eventCards + '</section>',
    '<section><h5>World Model 当前有效状态</h5>' + renderBusinessDebugSource(world.source) + '<pre>' + escapeHtml(traceValueText(world.model)) + '</pre></section>',
    '<section><h5>Character Registry 当前有效状态 · ' + escapeHtml(String(registry.count ?? 0)) + '</h5>' + renderBusinessDebugSource(registry.source) + '<pre>' + escapeHtml(traceValueText(registry.registry)) + '</pre></section>',
    '<section><h5>Tracking Window · 当前 Story Time</h5><dl class="bioweave-data-list">' + [
      ['Story Time', windows.current_story_time], ['Window 数量', windows.count], ['状态统计', windows.status_counts],
    ].map(([label, value]) => '<div><dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(traceValueText(value)) + '</dd></div>').join('') + '</dl>' + windowCards + '</section>',
    '<section><h5>Tracking Registry · CURRENT_DERIVED</h5><pre>' + escapeHtml(traceValueText(trackingRegistry)) + '</pre></section>',
    '<section><h5>Health Evolution · CURRENT_DERIVED</h5><pre>' + escapeHtml(traceValueText(healthState.state)) + '</pre></section>',
    renderNsfwPipelineDiagnostics(debug),
    renderTimingPerformanceDiagnostics(debug),
    renderStorylineDiagnostics(debug),
    renderLifecycleRuntimeDebug(lifecycleRuntime),
    '</div>',
    '</section>',
  ].join('')
}

function storyTimeDebugValue(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'boolean') return value ? '是' : '否';
  return escapeHtml(value);
}

function renderStoryTimeDebugRow(label, value, fallback = '—') {
  return '<div><dt>' + escapeHtml(label) + '</dt><dd>' + storyTimeDebugValue(value, fallback) + '</dd></div>';
}

function renderStoryTimeDebugSettings(storyTimeDebug = {}, openSettingsSections = [], standalone = false) {
  const open = Array.isArray(openSettingsSections) && openSettingsSections.includes('story_time_debug');
  const enabled = storyTimeDebug.enabled === true;
  const loading = storyTimeDebug.loading === true;
  const info = storyTimeDebug.info ?? null;
  const floor = info?.floor ?? null;
  const storyTime = info?.story_time ?? null;
  const parsed = info?.parsed_parts ?? null;
  const calendar = info?.calendar ?? null;
  const event = info?.recent_event ?? null;
  const eventStoryTime = event?.story_time ?? null;
  const difference = event?.difference ?? info?.difference ?? null;
  const error = storyTimeDebug.error ? '<p class="bioweave-settings-notice" role="status">' + escapeHtml(storyTimeDebug.error) + '</p>' : '';
  const body = !enabled
    ? '<p class="bioweave-muted">默认关闭。开启后只读取当前 Character Floor 的 Story Time 解析结果，不调用 AI，也不保存调试内容。</p>'
    : [
      error,
      loading ? '<p class="bioweave-muted">正在读取当前 Floor…</p>' : '',
      info ? '<section class="bioweave-card bioweave-story-time-debug-card"><h3>Floor Detection</h3><dl class="bioweave-data-list">' + [
        renderStoryTimeDebugRow('状态', info.status), renderStoryTimeDebugRow('Chat', info.chat_id),
        renderStoryTimeDebugRow('Floor', floor?.floor), renderStoryTimeDebugRow('message id', floor?.message_id),
        renderStoryTimeDebugRow('Active Swipe', floor?.swipe_id), renderStoryTimeDebugRow('content hash', floor?.content_hash),
        renderStoryTimeDebugRow('message version', floor?.message_version), renderStoryTimeDebugRow('Resolution Source', info.resolution_source ?? info.source),
        renderStoryTimeDebugRow('Candidate Source', info.candidate_source ?? info.source),
        renderStoryTimeDebugRow('候选文本', info.candidate), renderStoryTimeDebugRow('Parsed Display', storyTime?.display),
        renderStoryTimeDebugRow('Normalized', storyTime?.normalized), renderStoryTimeDebugRow('Precision', storyTime?.precision),
        renderStoryTimeDebugRow('Persisted Structured', info.persisted_structured), renderStoryTimeDebugRow('Parseable', info.parseable),
        renderStoryTimeDebugRow('Era', parsed?.era_label), renderStoryTimeDebugRow('Year', parsed?.year),
        renderStoryTimeDebugRow('Month', parsed?.month), renderStoryTimeDebugRow('Day', parsed?.day),
        renderStoryTimeDebugRow('Hour', parsed?.hour), renderStoryTimeDebugRow('Minute', parsed?.minute),
      ].join('') + '</dl></section>' : '',
      info ? '<section class="bioweave-card bioweave-story-time-debug-card"><h3>Calendar Resolution</h3><dl class="bioweave-data-list">' + [
        renderStoryTimeDebugRow('Calendar ID', calendar?.calendar_id), renderStoryTimeDebugRow('Era', calendar?.era_label),
        renderStoryTimeDebugRow('Calculation Level', calendar?.calculation_level),
        renderStoryTimeDebugRow('Ordinal In Year', calendar?.ordinal_in_year), renderStoryTimeDebugRow('Day Index', calendar?.day_index),
      ].join('') + '</dl></section>' : '',
      info ? '<section class="bioweave-card bioweave-story-time-debug-card"><h3>最近可比较事件</h3><dl class="bioweave-data-list">' + [
        renderStoryTimeDebugRow('event id', event?.event_id), renderStoryTimeDebugRow('Event Story Time', eventStoryTime?.display),
        renderStoryTimeDebugRow('Event Normalized', eventStoryTime?.normalized), renderStoryTimeDebugRow('Event Calendar ID', eventStoryTime?.calendar_id),
        renderStoryTimeDebugRow('Event Day Index', eventStoryTime?.day_index), renderStoryTimeDebugRow('Current Story Time', storyTime?.display),
        renderStoryTimeDebugRow('Current Calendar ID', storyTime?.calendar_id), renderStoryTimeDebugRow('Current Day Index', storyTime?.day_index),
        renderStoryTimeDebugRow('Comparable', info.comparable), renderStoryTimeDebugRow('Event Persisted Structured', event?.persisted_structured),
        renderStoryTimeDebugRow('Event Parseable', event?.parseable),
        renderStoryTimeDebugRow('Difference', difference ? `${difference.value} ${difference.unit}` : null), renderStoryTimeDebugRow('Failure Reason', info.failure_reason),
      ].join('') + '</dl></section>' : '',
    ].join('');
  const card = '<section class="bioweave-card bioweave-story-time-debug-settings"><div class="bioweave-debug-section-header"><div><h3>Story Time 调试</h3><p class="bioweave-muted">不调用 Event Analyzer，不读取完整剧情正文。</p></div><div class="bioweave-debug-section-actions"><label class="bioweave-checkbox-label"><input type="checkbox" class="bioweave-checkbox" data-bioweave-action="toggle-story-time-debug"' + (enabled ? ' checked' : '') + '>开启 Story Time 调试</label><button type="button" class="bioweave-secondary-action" data-bioweave-action="refresh-story-time-debug"' + (!enabled || loading ? ' disabled' : '') + '>' + (loading ? '读取中…' : '刷新') + '</button><button type="button" class="bioweave-secondary-action" data-bioweave-action="copy-story-time-debug"' + (!enabled || !info ? ' disabled' : '') + '>复制调试信息</button><button type="button" class="bioweave-secondary-action" data-bioweave-action="export-story-time-debug"' + (!info ? ' disabled' : '') + '>导出 TXT</button></div></div><div class="bioweave-debug-preview-scroll bioweave-story-time-debug-content">' + body + '</div></section>';
  if (standalone) return card;
  return '<details class="bioweave-settings-disclosure bioweave-settings-group bioweave-story-time-debug-disclosure" data-bioweave-settings-disclosure="story_time_debug"' + (open ? ' open' : '') + '>' +
    renderSettingsSummary('Story Time 调试', '只读检查当前 Character Floor 的 Story Time 解析链', null, {label: enabled ? '已开启' : '已关闭', tone: enabled ? 'good' : ''}) +
    card + '</details>';
}

function renderAnalysisDebugSettings({analysisPreview = {}, persistenceTrace = null, businessDebug = null, storyTimeDebug = {}, analysisPrompt = {}, openSettingsSections = []} = {}) {
  const open = Array.isArray(openSettingsSections) && openSettingsSections.includes('analysis_debug');
  return [
    '<details class="bioweave-settings-disclosure bioweave-settings-group bioweave-analysis-debug-disclosure" data-bioweave-settings-disclosure="analysis_debug"' + (open ? ' open' : '') + '>',
    renderSettingsSummary('高级 / 调试', '分析输入、执行诊断与 Story Time 调试'),
    renderAnalysisInputPreview({...analysisPreview, standalone: true, messagePreview: true, promptSettings: analysisPrompt, openSettingsSections}),
    renderBusinessDebugState(businessDebug),
    renderPersistenceTrace(persistenceTrace),
    renderStoryTimeDebugSettings(storyTimeDebug, openSettingsSections, true),
    '</details>',
  ].join('');
}

export function settingsPage({
  profiles: rawProfiles = {},
  assignments = {},
  apiSource = SILLYTAVERN_CURRENT_API,
  defaultProfileId = null,
  apiRequestSettings = DEFAULT_API_REQUEST_SETTINGS,
  apiRequestDraft = null,
  editingProfile = undefined,
  editingDraft = undefined,
  modelList = [],
  modelListProfileKey = null,
  modelSearch = '',
  modelRefreshBusy = false,
  loading = false,
  testResult = null,
  busy = false,
  worldbookSources = {},
  analysisPrompt = null,
  analysisPromptDraft = null,
  worldAnalysisPrompt = null,
  worldAnalysisPromptDraft = null,
  dataManagement = {},
  storyTimeDebug = {},
  analysisPreview = {},
  businessDebug = null,
  persistenceTrace = null,
  show_floating_launcher = true,
  floating_launcher_theme = DEFAULT_FLOATING_LAUNCHER_THEME,
} = {}) {
  const profiles = Array.isArray(rawProfiles)
    ? rawProfiles.map(profile => normalizeApiProfileForDisplay(profile))
    : Object.entries(rawProfiles ?? {}).map(([profileId, profile]) => normalizeApiProfileForDisplay({...profile, profile_id: profile?.profile_id ?? profileId}));
  const openSettingsSections = new Set(Array.isArray(worldbookSources.openSettingsSections) ? worldbookSources.openSettingsSections : []);
  const assignmentsMarkup = API_ASSIGNMENTS.map(slot => `<label class="bioweave-assignment-field"><span>${ASSIGNMENT_LABELS[slot]}</span><select class="bioweave-select" data-bioweave-assignment="${slot}">${assignmentOptions(profiles, assignments[slot] ?? null)}</select></label>`).join('');
  const assignedCount = API_ASSIGNMENTS.filter(slot => assignments[slot] !== undefined && assignments[slot] !== null && assignments[slot] !== '').length;
  return [
    '<section class="bioweave-page bioweave-settings-page" data-bioweave-page="settings" data-bioweave-settings>',
    '<div class="bioweave-page-title bioweave-page-head"><div><h2>设置</h2><p class="bioweave-muted">连接参数是全局配置；任务数据仍属于当前 Chat。</p></div></div>',
    renderWorldbookSources(worldbookSources),
    renderRecentStorySettings(worldbookSources.recentStory, worldbookSources.openSettingsSections, worldbookSources.globalRecentStory),
    renderExternalMemorySettings(worldbookSources.externalMemory, worldbookSources.externalMemoryProviders, worldbookSources.openSettingsSections),
    renderAnalysisPromptSettings(
      analysisPromptDraft ?? analysisPrompt ?? worldAnalysisPromptDraft ?? worldAnalysisPrompt ?? {},
      worldbookSources.openSettingsSections,
    ),
    renderDataManagementSettings(dataManagement, worldbookSources.openSettingsSections),
    renderApiSource(apiSource, defaultProfileId, profiles, {
      loading,
      editingProfile,
      editingDraft,
      modelList,
      modelListProfileKey,
      modelSearch,
      modelRefreshBusy,
      testResult,
      busy,
      apiRequestSettings: apiRequestDraft ?? apiRequestSettings,
      openSettingsSections: worldbookSources.openSettingsSections,
    }),
    '<details class="bioweave-settings-disclosure bioweave-settings-group bioweave-assignments-disclosure" data-bioweave-settings-disclosure="assignments"' + (openSettingsSections.has('assignments') ? ' open' : '') + '>',
    renderSettingsSummary('任务分配', '为不同分析任务选择默认或指定 API', null, {
      label: assignedCount + '/' + API_ASSIGNMENTS.length,
      tone: assignedCount > 0 ? 'good' : '',
    }),
    '<section class="bioweave-card bioweave-assignments"><header class="bioweave-settings-card-header"><div><h3>分配设置</h3><p class="bioweave-muted">每项可跟随默认、指定 API、暂时禁用；这里只保存选择，不触发分析。</p></div></header>',
    `<div class="bioweave-assignment-grid">${assignmentsMarkup}</div>`,
    '</section>',
    '</details>',
    renderFloatingLauncherSettings({
      show: show_floating_launcher,
      theme: floating_launcher_theme,
      open: openSettingsSections.has('floating_launcher'),
    }),
    renderAnalysisDebugSettings({
      analysisPreview,
      persistenceTrace,
      businessDebug,
      storyTimeDebug,
      analysisPrompt: analysisPromptDraft ?? analysisPrompt ?? worldAnalysisPromptDraft ?? worldAnalysisPrompt ?? {},
      openSettingsSections: worldbookSources.openSettingsSections,
    }),
    '</section>',
  ].join('');
}
