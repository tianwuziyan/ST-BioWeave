import {
  API_ASSIGNMENTS,
  BIOWEAVE_INDEPENDENT_API,
  DEFAULT_API_PROFILE,
  FOLLOW_DEFAULT_API,
  normalizeRecentStorySettings,
  normalizeWorldAnalysisPrompt,
  SILLYTAVERN_CURRENT_API,
} from '../storage/schema.js';
import {
  characterOpeningSelectionState,
  isCharacterCardOpeningFieldKey,
  WORLD_BOOK_RUNTIME_GROUPS,
  worldbookSelectionState,
} from '../ai/worldbook.js';
import {buildWorldModelMessages} from '../ai/prompts.js';

const ASSIGNMENT_LABELS = {
  world_analysis: '世界分析',
  event_analysis: '事件分析',
  projection: '推演',
  history_scan: '历史扫描',
};

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
    provider: value('provider') ?? DEFAULT_API_PROFILE.provider,
    api_url: value('api_url') ?? '',
    model: value('model') ?? '',
    context_size: value('context_size') ?? DEFAULT_API_PROFILE.context_size,
    max_output_tokens: value('max_output_tokens') ?? DEFAULT_API_PROFILE.max_output_tokens,
    temperature: value('temperature') ?? DEFAULT_API_PROFILE.temperature,
    timeout_seconds: timeoutSecondsForDisplay(value('timeout') ?? DEFAULT_API_PROFILE.timeout),
    retry_count: value('retry_count') ?? DEFAULT_API_PROFILE.retry_count,
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
    provider: source.provider ?? DEFAULT_API_PROFILE.provider,
    api_url: source.api_url ?? '',
    model: source.model ?? '',
    context_size: source.context_size ?? DEFAULT_API_PROFILE.context_size,
    max_output_tokens: source.max_output_tokens ?? DEFAULT_API_PROFILE.max_output_tokens,
    temperature: source.temperature ?? DEFAULT_API_PROFILE.temperature,
    timeout: source.timeout ?? DEFAULT_API_PROFILE.timeout,
    retry_count: source.retry_count ?? DEFAULT_API_PROFILE.retry_count,
    secret_ref: source.secret_ref ?? null,
  };
}

function renderSettingsSummary(title, hint) {
  return [
    '<summary class="bioweave-settings-summary">',
    '<span class="bioweave-settings-summary-copy"><strong>' + escapeHtml(title) + '</strong><small>' + escapeHtml(hint) + '</small></span>',
    '<span class="bioweave-settings-summary-arrow" aria-hidden="true"><i class="fa-solid fa-chevron-down"></i><i class="fa-solid fa-chevron-up"></i></span>',
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
    openSettingsSections = [],
  } = {},
) {
  const independent = apiSource === BIOWEAVE_INDEPENDENT_API;
  const defaultProfile = profiles.find(profile => profile.profile_id === defaultProfileId);
  const apiDisclosureOpen = editingProfile !== undefined || openSettingsSections.includes('api');
  const profileSource = profileValues(editingProfile ?? defaultProfile, editingDraft);
  const requestSettings = [
    '<section class="bioweave-api-source-module bioweave-api-request-settings" data-bioweave-api-request-settings>',
    '<header class="bioweave-api-module-header"><div><h3>请求设置</h3><p class="bioweave-muted">控制分析请求的等待时间和失败重试。</p></div></header>',
    '<div class="bioweave-settings-fields">',
    field('超时（秒）', 'timeout', profileSource.timeout_seconds, 'number', ' min="0.25" step="0.25" inputmode="decimal" data-bioweave-api-timeout'),
    field('重试次数', 'retry_count', profileSource.retry_count, 'number', ' min="0" max="3" step="1" inputmode="numeric" data-bioweave-api-retry-count'),
    '</div>',
    '</section>',
  ].join('');
  const profileDetails = [
    '<details class="bioweave-api-profiles"' + (editingProfile !== undefined ? ' open' : '') + '>',
    '<summary>独立 API 配置</summary>',
    '<div class="bioweave-api-profiles-content">',
    '<header class="bioweave-api-profiles-header"><div><p class="bioweave-muted">配置名称不是唯一标识；删除会清理未被其它配置复用的 Secret。</p></div>',
    '<button type="button" class="bioweave-primary-action" data-bioweave-action="new-profile">新建 API 配置</button></header>',
    '<section class="bioweave-card bioweave-profile-list"><header><div><h4>已保存的 API 配置</h4></div></header>',
    renderProfileList(profiles, loading),
    '</section>',
    editingProfile !== undefined ? renderProfileEditor(editingProfile, editingDraft, testResult, busy, modelList, modelListProfileKey, modelSearch, modelRefreshBusy) : '',
    '</div>',
    '</details>',
  ].join('');
  return [
    `<details class="bioweave-settings-disclosure bioweave-api-source-disclosure" data-bioweave-settings-disclosure="api"${apiDisclosureOpen ? ' open' : ''}>`,
    renderSettingsSummary('API 来源', '选择酒馆当前 API 或 BioWeave 独立 API'),
    '<section class="bioweave-card bioweave-api-source">',
    requestSettings,
    '<section class="bioweave-api-source-module bioweave-api-connection-settings">',
    '<header class="bioweave-api-module-header"><div><h3>连接设置</h3><p class="bioweave-muted">默认只使用 SillyTavern 当前 API；独立 API 仅在需要时配置。</p></div></header>',
    '<p class="bioweave-api-security-note bioweave-muted">安全：独立 API Key 只写入 SillyTavern Secret Store；BioWeave 不读取、复制或显示 SillyTavern 当前 API 的密钥。</p>',
    '<div class="bioweave-source-options">',
    `<label class="bioweave-source-option${!independent ? ' is-selected' : ''}"><input type="radio" name="api_source" value="${SILLYTAVERN_CURRENT_API}" data-bioweave-api-source${!independent ? ' checked' : ''}><span><strong>使用 SillyTavern 当前 API</strong><small>沿用酒馆当前连接，不复制或读取 API Key。</small></span></label>`,
    `<label class="bioweave-source-option${independent ? ' is-selected' : ''}"><input type="radio" name="api_source" value="${BIOWEAVE_INDEPENDENT_API}" data-bioweave-api-source${independent ? ' checked' : ''}><span><strong>使用 BioWeave 独立 API</strong><small>使用下方独立配置，为选择“跟随默认”的任务提供连接。</small></span></label>`,
    '</div>',
    independent ? [
      '<label class="bioweave-assignment-field bioweave-default-profile"><span>默认 API 配置</span>',
      `<select class="bioweave-select" data-bioweave-default-profile>${profileOptions(profiles, defaultProfileId, profiles.length ? '请选择默认配置' : '请先新建 API 配置')}</select>`,
      '</label>',
      `<p class="bioweave-muted bioweave-source-hint">${defaultProfile ? `跟随默认的任务将使用「${escapeHtml(defaultProfile.name || defaultProfile.model)}」。` : '请选择一个独立 API 配置，或让任务单独指定 API。'}</p>`,
    ].join('') : '',
    '</section>',
    profileDetails,
    '</section>',
    '</details>',
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
    field('服务商', 'provider', source.provider),
    field('API 地址（不含 /chat/completions）', 'api_url', source.api_url, 'url', ' autocomplete="url" required'),
    field('API 密钥', 'api_key', source.api_key, 'password', ' autocomplete="new-password" placeholder="不显示已保存密钥"'),
    renderModelPicker(source, modelList, modelListProfileKey, modelSearch, modelRefreshBusy),
    '</div>',
    `<p class="bioweave-secret-status bioweave-muted">${existingSecret ? '已保存 API 密钥；留空表示保留。' : '尚未设置 API 密钥；留空将以无密钥配置保存。'}</p>`,
    existingSecret ? `<label class="bioweave-check"><input type="checkbox" name="clear_secret"${source.clear_secret ? ' checked' : ''}> 清除已保存 API 密钥</label>` : '',
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
    `<strong>${escapeHtml(profile.name || profile.model || '未命名配置')}</strong>`,
    `<span class="bioweave-muted">${escapeHtml(profile.provider)} · ${escapeHtml(profile.model || '未设置模型')}</span>`,
    `<small class="bioweave-muted">${profile.secret_ref ? 'API 密钥已保存（Secret Store）' : '未设置 API 密钥'} · ${escapeHtml(profile.api_url || '未设置地址')}</small>`,
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
  if (group === WORLD_BOOK_RUNTIME_GROUPS.SELECTED_GLOBAL) return '当前开启的全局世界书';
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
  return [
    '<label class="bioweave-analysis-source-child' + (unavailable ? ' is-unavailable' : '') + '" data-bioweave-analysis-source-row="' + escapeHtml(source.source_id) + '" data-bioweave-analysis-source-child-key="' + escapeHtml(selectionKey) + '">',
    '<input type="checkbox" data-bioweave-analysis-source="' + escapeHtml(source.source_id) + '" ' + childAttribute + (checked ? ' checked' : '') + (unavailable ? ' disabled' : '') + '>',
    '<span class="bioweave-analysis-source-copy">',
    '<strong>' + escapeHtml(child?.label || childId) + '</strong>',
    '<small>' + childStatus(child) + '</small>',
    '</span>',
    currentBadge,
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
      '<details class="bioweave-analysis-character-group" data-bioweave-analysis-character-group="opening" data-bioweave-analysis-character-group-source="' + escapeHtml(completeSource.source_id) + '"' + (openingIsOpen ? ' open' : '') + '>',
      '<summary class="bioweave-analysis-character-group-summary">',
      '<button type="button" class="bioweave-analysis-disclosure-marker" data-bioweave-analysis-character-expand="' + escapeHtml(completeSource.source_id) + '" aria-expanded="' + String(openingIsOpen) + '" aria-label="' + (openingIsOpen ? '收起' : '展开') + '开场白">',
      '</button>',
      '<input class="bioweave-analysis-parent-toggle" type="checkbox" data-bioweave-analysis-character-opening-toggle="' + escapeHtml(completeSource.source_id) + '" aria-label="选择全部开场白" aria-checked="' + (openingState.indeterminate ? 'mixed' : String(openingState.checked)) + '"' + (openingState.checked ? ' checked' : '') + (completeSource.available === false ? ' disabled' : '') + '>',
      '<span class="bioweave-analysis-character-group-copy"><strong>开场白</strong><small>' + openingState.selected_count + '/' + openingState.total_count + '</small></span>',
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
  return [
    '<details class="bioweave-analysis-worldbook" data-bioweave-analysis-source-row="' + escapeHtml(source.source_id) + '"' + (worldbookIsOpen ? ' open' : '') + '>',
    '<summary class="bioweave-analysis-worldbook-summary">',
    '<button type="button" class="bioweave-analysis-disclosure-marker" data-bioweave-analysis-worldbook-expand="' + escapeHtml(source.source_id) + '" aria-expanded="' + String(worldbookIsOpen) + '" aria-label="' + (worldbookIsOpen ? '收起' : '展开') + '世界书条目">',
    '</button>',
    '<input class="bioweave-analysis-parent-toggle" type="checkbox" data-bioweave-analysis-worldbook-toggle="' + escapeHtml(source.source_id) + '" aria-label="选择整本世界书" aria-checked="' + (parentState.indeterminate ? 'mixed' : String(parentState.checked)) + '"' + (parentState.checked ? ' checked' : '') + (source.available === false || contentLoading ? ' disabled' : '') + '>',
    '<span class="bioweave-analysis-worldbook-title"><strong>' + escapeHtml(source.label || '世界书') + '</strong></span>',
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

function renderAnalysisSourceGroup(label, sources, allSources, selectedSet, renderer, openWorldbooks = new Set(), selected = [], openCharacterGroups = new Set()) {
  return [
    '<section class="bioweave-analysis-source-group">',
    '<h4>' + label + '</h4>',
    renderAnalysisSourceRows(sources, allSources, selectedSet, renderer, openWorldbooks, selected, openCharacterGroups),
    '</section>',
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
  const cardSection = [
    '<details class="bioweave-analysis-section" data-bioweave-analysis-section="character_card"' + (openSections.has('character_card') ? ' open' : '') + '>',
    '<summary>角色卡</summary>',
    '<div class="bioweave-analysis-section-content">',
    visibleCharacterCards.length
      ? renderAnalysisSourceRows(visibleCharacterCards, characterCardSources, selectedSet, renderCharacterCardSource, openWorldbooks, worldbookSources.selected, openCharacterGroups)
      : '',
    visibleCharacterCardWorldbooks.length
      ? renderAnalysisSourceRows(visibleCharacterCardWorldbooks, characterCardWorldbooks, selectedSet, renderWorldbookSource, openWorldbooks, worldbookSources.selected, openCharacterGroups)
      : (!visibleCharacterCards.length && cardSources.length ? '<p class="bioweave-empty">当前搜索没有匹配项。</p>' : (!cardSources.length ? '<p class="bioweave-empty">当前 Chat 暂无可用角色卡来源。</p>' : '')),
    '</div>',
    '</details>',
  ].join('');
  const worldbookSection = [
    '<details class="bioweave-analysis-section" data-bioweave-analysis-section="worldbook"' + (openSections.has('worldbook') ? ' open' : '') + '>',
    '<summary>世界书</summary>',
    '<div class="bioweave-analysis-section-content">',
    renderAnalysisSourceGroup('当前开启的全局世界书', visibleGroupedWorldbooks(WORLD_BOOK_RUNTIME_GROUPS.SELECTED_GLOBAL), groupedWorldbooks(WORLD_BOOK_RUNTIME_GROUPS.SELECTED_GLOBAL), selectedSet, renderWorldbookSource, openWorldbooks, worldbookSources.selected, openCharacterGroups),
    renderAnalysisSourceGroup('附加角色世界书', visibleGroupedWorldbooks(WORLD_BOOK_RUNTIME_GROUPS.CHARACTER), groupedWorldbooks(WORLD_BOOK_RUNTIME_GROUPS.CHARACTER), selectedSet, renderWorldbookSource, openWorldbooks, worldbookSources.selected, openCharacterGroups),
    renderAnalysisSourceGroup('其他世界书', visibleGroupedWorldbooks(WORLD_BOOK_RUNTIME_GROUPS.OTHER), groupedWorldbooks(WORLD_BOOK_RUNTIME_GROUPS.OTHER), selectedSet, renderWorldbookSource, openWorldbooks, worldbookSources.selected, openCharacterGroups),
    '</div>',
    '</details>',
  ].join('');
  const groups = cardSection + worldbookSection;
  const notice = worldbookSources.notice
    ? '<p class="bioweave-settings-notice" role="status">' + escapeHtml(worldbookSources.notice) + '</p>'
    : '';
  const loading = worldbookSources.loading ? '<p class="bioweave-muted">正在读取世界书来源…</p>' : '';
  const selectedCount = Number(worldbookSources.selectedCount || 0);
  const selectedWorldbookCount = Number(worldbookSources.selectedWorldbookCount || 0);
  const tokenEstimate = Number(worldbookSources.selectedTokenEstimate || 0);
  return [
    `<details class="bioweave-settings-disclosure bioweave-worldbook-source-disclosure" data-bioweave-settings-disclosure="worldbook"${openSettingsSections.has('worldbook') ? ' open' : ''}>`,
    renderSettingsSummary('世界书来源', '选择角色卡字段和世界书条目作为分析输入'),
    '<section class="bioweave-card bioweave-analysis-sources" data-bioweave-analysis-sources>',
    '<header class="bioweave-settings-card-header"><div><h3>来源选择</h3><p class="bioweave-muted">不会直接变成最终注入上下文。</p></div></header>',
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
    notice,
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

function renderRecentStoryRegexRow(rule, index, allRules, scope) {
  const scopeLabel = scope === 'global' ? '全局' : '当前角色卡';
  const scopeAttribute = ' data-bioweave-recent-story-regex-scope="' + scope + '"';
  const rowAttribute = scope === 'global'
    ? 'data-bioweave-recent-story-global-regex-row'
    : 'data-bioweave-recent-story-regex-row';
  return [
    '<div class="bioweave-recent-story-regex-row" role="row" ' + rowAttribute + ' data-bioweave-recent-story-regex-index="' + index + '"' + scopeAttribute + '>',
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
    '<div class="bioweave-recent-story-regex-cell bioweave-recent-story-regex-order" role="cell" data-label="执行顺序">',
    '<button type="button" class="bioweave-secondary-action bioweave-recent-story-order-action" aria-label="上移' + scopeLabel + '第 ' + (index + 1) + ' 条规则" data-bioweave-action="move-recent-story-regex-up" data-bioweave-recent-story-regex-index="' + index + '"' + scopeAttribute + (index === 0 ? ' disabled' : '') + '><i class="fa-solid fa-chevron-up" aria-hidden="true"></i><span>上移</span></button>',
    '<button type="button" class="bioweave-secondary-action bioweave-recent-story-order-action" aria-label="下移' + scopeLabel + '第 ' + (index + 1) + ' 条规则" data-bioweave-action="move-recent-story-regex-down" data-bioweave-recent-story-regex-index="' + index + '"' + scopeAttribute + (index === allRules.length - 1 ? ' disabled' : '') + '><i class="fa-solid fa-chevron-down" aria-hidden="true"></i><span>下移</span></button>',
    '</div>',
    '<div class="bioweave-recent-story-regex-cell bioweave-recent-story-regex-operation" role="cell" data-label="操作">',
    '<button type="button" class="bioweave-danger-action bioweave-recent-story-delete-action" aria-label="删除' + scopeLabel + '第 ' + (index + 1) + ' 条规则" data-bioweave-action="remove-recent-story-regex" data-bioweave-recent-story-regex-index="' + index + '"' + scopeAttribute + '><i class="fa-solid fa-trash-can" aria-hidden="true"></i><span>删除</span></button>',
    '</div>',
    '</div>',
  ].join('');
}

function renderRecentStoryRegexTable(scope, rules) {
  return [
    '<div class="bioweave-recent-story-regex-table" role="table" data-bioweave-recent-story-regex-table="' + scope + '">',
    '<div class="bioweave-recent-story-regex-table-head" role="row">',
    '<span role="columnheader">#</span>',
    '<span role="columnheader">类型</span>',
    '<span role="columnheader">正则表达式</span>',
    '<span role="columnheader">启用</span>',
    '<span role="columnheader">执行顺序</span>',
    '<span role="columnheader">操作</span>',
    '</div>',
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
    '<button type="button" class="bioweave-primary-action bioweave-recent-story-add-action" data-bioweave-action="add-recent-story-regex" data-bioweave-recent-story-regex-scope="' + scope + '"><i class="fa-solid fa-plus" aria-hidden="true"></i><span>新增规则</span></button></header>',
    renderRecentStoryRegexTable(scope, settings.regex_rules),
    '</section>',
  ].join('');
}

function renderRecentStorySettings(recentStory = {}, openSettingsSections = [], globalRecentStory = {}) {
  const settings = normalizeRecentStorySettings(recentStory);
  const globalSettings = {regex_rules: normalizeRecentStorySettings(globalRecentStory).regex_rules};
  const open = Array.isArray(openSettingsSections) && openSettingsSections.includes('recent_story');
  return [
    '<details class="bioweave-settings-disclosure bioweave-recent-story-disclosure" data-bioweave-settings-disclosure="recent_story"' + (open ? ' open' : '') + '>',
    '<summary class="bioweave-recent-story-summary">',
    '<span class="bioweave-recent-story-summary-copy"><strong>最近剧情</strong><small>读取当前 Chat 的最近楼层，并按规则提取与清洗</small></span>',
    '<span class="bioweave-recent-story-summary-arrow" aria-hidden="true"><i class="fa-solid fa-chevron-down"></i><i class="fa-solid fa-chevron-up"></i></span>',
    '</summary>',
    '<section class="bioweave-recent-story-settings" data-bioweave-recent-story-settings>',
    '<section class="bioweave-card bioweave-recent-story-read-card" data-bioweave-recent-story-read-settings>',
    '<header class="bioweave-recent-story-card-header"><div><h3>读取设置</h3><p class="bioweave-muted">按当前 Chat 读取最近楼层；填写 0 表示不读取。</p></div></header>',
    '<div class="bioweave-recent-story-read-options">',
    '<label class="bioweave-recent-story-count"><span class="bioweave-recent-story-count-copy"><strong>读取最近</strong></span>',
    '<input class="bioweave-input" type="number" min="0" max="1000" step="1" inputmode="numeric" data-bioweave-recent-story-floor-count value="' + escapeHtml(settings.floor_count) + '">',
    '<span class="bioweave-recent-story-count-unit">楼</span><small class="bioweave-recent-story-count-hint"><i class="fa-solid fa-circle-info" aria-hidden="true"></i>开场楼（0 楼）始终保留原文，不受正则影响。</small></label>',
    renderRecentStorySwitch({
      className: 'bioweave-recent-story-user-regex',
      label: '对用户楼应用正则',
      description: '默认关闭；开场楼（0 楼）始终保留原文。',
      checked: settings.regex_user_enabled,
      inputAttributes: 'aria-label="对用户楼应用正则" data-bioweave-recent-story-user-regex',
    }),
    '</div>',
    '</section>',
    '<section class="bioweave-card bioweave-recent-story-regex-card" data-bioweave-recent-story-regex-settings>',
    '<header class="bioweave-recent-story-card-header bioweave-recent-story-regex-card-header"><div><h3>正则提取与清洗</h3><p class="bioweave-muted">按列表顺序逐条处理每条楼层正文；无效规则会跳过。</p></div></header>',
    '<div class="bioweave-recent-story-regex-sections">',
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
    '</section>',
    '<section class="bioweave-card bioweave-recent-story-tip-card" data-bioweave-recent-story-tip>',
    '<header class="bioweave-recent-story-tip-header"><span class="bioweave-recent-story-tip-icon" aria-hidden="true"><i class="fa-regular fa-lightbulb"></i></span><h3>使用提示</h3></header>',
    '<ul class="bioweave-recent-story-tip-list"><li>规则按从上到下的顺序依次处理，每条规则作用于上一步的结果。</li><li>0 楼（开场楼）始终保留原文，不受任何规则影响。</li></ul>',
    '</section>',
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
  const rows = EXTERNAL_MEMORY_OPTIONS.map(([key, label]) => {
    const provider = providerByKey.get(key);
    const available = provider?.available === true;
    const checked = externalMemory[key] === true;
    const unavailable = !available;
    const status = provider?.status || '未检测到公开接口';
    const detail = available ? status || '已检测到，可在后续分析中读取。' : status;
    return [
      '<label class="bioweave-external-memory-option' + (unavailable ? ' is-unavailable' : '') + '">',
      '<input type="checkbox" data-bioweave-external-memory="' + key + '"' + (checked ? ' checked' : '') + (!available && !checked ? ' disabled' : '') + '>',
      '<span>',
      '<strong>' + label + '</strong>',
      '<small>' + escapeHtml(detail) + '</small>',
      '</span>',
      '</label>',
    ].join('');
  }).join('');
  return [
    '<details class="bioweave-settings-disclosure bioweave-external-memory-disclosure" data-bioweave-settings-disclosure="external_memory"' + (open ? ' open' : '') + '>',
    renderSettingsSummary('外部记忆来源', '选择可用于分析输入的外部记忆来源'),
    '<section class="bioweave-card bioweave-external-memory-settings" data-bioweave-external-memory-settings>',
    '<header class="bioweave-settings-card-header"><div><h3>读取选项</h3><p class="bioweave-muted">仅保存是否读取的配置；未检测到公开接口的来源会标记为不可用。</p></div></header>',
    '<div class="bioweave-external-memory-list">',
    rows,
    '</div>',
    '</section>',
    '</details>',
  ].join('');
}

function renderWorldAnalysisPromptSettings(prompt = {}, openSettingsSections = []) {
  const open = Array.isArray(openSettingsSections) && openSettingsSections.includes('world_analysis_prompt');
  const settings = normalizeWorldAnalysisPrompt(prompt);
  const textArea = (label, key, value, hint = '') => [
    '<label class="bioweave-settings-field bioweave-world-analysis-prompt-field">',
    '<span>' + label + (hint ? '<small>' + hint + '</small>' : '') + '</span>',
    '<textarea class="bioweave-input" data-bioweave-world-analysis-prompt-field="' + key + '" rows="4">' + escapeHtml(value) + '</textarea>',
    '</label>',
  ].join('');
  return [
    '<details class="bioweave-settings-disclosure bioweave-world-analysis-prompt-disclosure" data-bioweave-settings-disclosure="world_analysis_prompt"' + (open ? ' open' : '') + '>',
    renderSettingsSummary('世界分析提示词', '可修改发送给模型的补充内容'),
    '<section class="bioweave-card bioweave-world-analysis-prompt-settings" data-bioweave-world-analysis-prompt-settings>',
    '<header class="bioweave-settings-card-header"><div><h3>提示词设置</h3><p class="bioweave-muted">BioWeave 的核心约束和结果校验始终保留；下面的提示内容可以留空或修改。这里不会保存角色正文、世界书正文或 API Key。</p></div></header>',
    textArea('分析任务补充', 'task', settings.task, '用于说明本次世界分析要关注什么。'),
    textArea('输入前说明', 'input_prefix', settings.input_prefix, '放在实际 AnalysisInput 之前。'),
    textArea('输入后说明', 'input_suffix', settings.input_suffix, '放在实际 AnalysisInput 之后，可留空。'),
    '<div class="bioweave-settings-actions">',
    '<button type="button" class="bioweave-primary-action" data-bioweave-action="save-world-analysis-prompt">保存提示词设置</button>',
    '</div>',
    '</section>',
    '</details>',
  ].join('');
}

function renderWorldModelMessagePreview(input, promptSettings) {
  const messages = buildWorldModelMessages(input, promptSettings);
  const roleLabels = {system: 'SYSTEM', assistant: 'ASSISTANT', user: 'USER'};
  return [
    '<section class="bioweave-world-model-message-preview" data-bioweave-world-model-message-preview>',
    '<h4>实际发送消息</h4>',
    '<p class="bioweave-muted">以下是 World Model 本次请求的消息分层；这里只读，不包含 API Key。</p>',
    '<div class="bioweave-world-model-message-list">',
    messages.map((message, index) => [
      '<details class="bioweave-world-model-message" data-bioweave-world-model-message-role="' + escapeHtml(message.role) + '">',
      '<summary><strong>' + escapeHtml(roleLabels[message.role] || message.role) + '</strong><small>第 ' + (index + 1) + ' 段</small></summary>',
      '<pre>' + escapeHtml(message.content) + '</pre>',
      '</details>',
    ].join('')).join(''),
    '</div>',
    '</section>',
  ].join('');
}

export function renderAnalysisInputPreview(preview = {}) {
  const input = preview?.input;
  const mode = preview?.mode === 'raw' ? 'raw' : 'structure';
  const standalone = preview?.standalone === true;
  const messagePreview = input && preview?.messagePreview === true
    ? renderWorldModelMessagePreview(input, preview.promptSettings)
    : '';
  const open = Array.isArray(preview?.openSettingsSections)
    && preview.openSettingsSections.includes('analysis_preview');
  const content = input
    ? mode === 'raw'
      ? '<pre class="bioweave-analysis-preview-raw">' + escapeHtml(JSON.stringify(input, null, 2)) + '</pre>'
      : '<p class="bioweave-analysis-preview-message-hint">结构预览已按实际发送消息分段显示，请展开上方消息查看本次请求内容。</p>'
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
    input ? '<div class="bioweave-analysis-preview-toolbar"><strong>预计 ' + escapeHtml(input.token_estimate ?? 0) + ' tokens</strong><span class="bioweave-muted">预览内容只存在于当前页面内存</span><div class="bioweave-analysis-preview-mode" role="group" aria-label="预览模式">' +
      '<button type="button" class="bioweave-secondary-action' + (mode === 'structure' ? ' is-selected' : '') + '" data-bioweave-action="analysis-preview-mode" data-bioweave-preview-mode="structure" aria-pressed="' + (mode === 'structure') + '">结构预览</button>' +
      '<button type="button" class="bioweave-secondary-action' + (mode === 'raw' ? ' is-selected' : '') + '" data-bioweave-action="analysis-preview-mode" data-bioweave-preview-mode="raw" aria-pressed="' + (mode === 'raw') + '">原始内容</button>' +
      '</div></div>' : '',
    messagePreview,
    '<div class="bioweave-analysis-preview-content">',
    content,
    '</div>',
    '</section>',
  ].join('');
  if (standalone) return card;
  return [
    '<details class="bioweave-settings-disclosure bioweave-analysis-preview-disclosure" data-bioweave-settings-disclosure="analysis_preview"' + (open ? ' open' : '') + '>',
    renderSettingsSummary('高级 / 调试', '临时检查本次分析实际读取的内容'),
    card,
    '</details>',
  ].join('');
}

export function settingsPage({
  profiles: rawProfiles = {},
  assignments = {},
  apiSource = SILLYTAVERN_CURRENT_API,
  defaultProfileId = null,
  editingProfile = undefined,
  editingDraft = undefined,
  modelList = [],
  modelListProfileKey = null,
  modelSearch = '',
  modelRefreshBusy = false,
  loading = false,
  notice = null,
  testResult = null,
  busy = false,
  worldbookSources = {},
  analysisPreview = {},
  worldAnalysisPrompt = {},
  worldAnalysisPromptDraft = null,
} = {}) {
  const profiles = Array.isArray(rawProfiles)
    ? rawProfiles.map(profile => normalizeApiProfileForDisplay(profile))
    : Object.entries(rawProfiles ?? {}).map(([profileId, profile]) => normalizeApiProfileForDisplay({...profile, profile_id: profile?.profile_id ?? profileId}));
  const openSettingsSections = new Set(Array.isArray(worldbookSources.openSettingsSections) ? worldbookSources.openSettingsSections : []);
  const safeNotice = notice ? `<p class="bioweave-settings-notice" role="status">${escapeHtml(notice)}</p>` : '';
  const assignmentsMarkup = API_ASSIGNMENTS.map(slot => `<label class="bioweave-assignment-field"><span>${ASSIGNMENT_LABELS[slot]}</span><select class="bioweave-select" data-bioweave-assignment="${slot}">${assignmentOptions(profiles, assignments[slot] ?? null)}</select></label>`).join('');
  return [
    '<section class="bioweave-page bioweave-settings-page" data-bioweave-settings>',
    '<div class="bioweave-page-title"><div><h2>设置</h2><p class="bioweave-muted">连接参数是全局配置；任务数据仍属于当前 Chat。</p></div></div>',
    safeNotice,
    renderWorldbookSources(worldbookSources),
    renderRecentStorySettings(worldbookSources.recentStory, worldbookSources.openSettingsSections, worldbookSources.globalRecentStory),
    renderExternalMemorySettings(worldbookSources.externalMemory, worldbookSources.externalMemoryProviders, worldbookSources.openSettingsSections),
    renderAnalysisInputPreview({
      ...analysisPreview,
      messagePreview: true,
      promptSettings: worldAnalysisPromptDraft ?? worldAnalysisPrompt,
      openSettingsSections: worldbookSources.openSettingsSections,
    }),
    renderWorldAnalysisPromptSettings(worldAnalysisPromptDraft ?? worldAnalysisPrompt, worldbookSources.openSettingsSections),
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
      openSettingsSections: worldbookSources.openSettingsSections,
    }),
    '<details class="bioweave-settings-disclosure bioweave-assignments-disclosure" data-bioweave-settings-disclosure="assignments"' + (openSettingsSections.has('assignments') ? ' open' : '') + '>',
    renderSettingsSummary('任务分配', '为不同分析任务选择默认或指定 API'),
    '<section class="bioweave-card bioweave-assignments"><header class="bioweave-settings-card-header"><div><h3>分配设置</h3><p class="bioweave-muted">每项可跟随默认、指定 API、暂时禁用；这里只保存选择，不触发分析。</p></div></header>',
    `<div class="bioweave-assignment-grid">${assignmentsMarkup}</div>`,
    '</section>',
    '</details>',
    '</section>',
  ].join('');
}
