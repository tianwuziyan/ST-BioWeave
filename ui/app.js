import {overviewPage} from './overview.js';
import {charactersPage} from './characters.js';
import {eventsPage} from './events.js';
import {projectionPage} from './projection.js';
import {genealogyPage} from './genealogy.js';
import {
  applyWorldModelSection,
  extractWorldModelSection,
  getWorldModelSection,
  resolveWorldModelSelection,
  worldPage,
  WORLD_MODEL_SECTION_KEYS,
} from './world.js';
import {normalizeModelList, renderAnalysisDebugPopupContent, settingsPage} from './settings.js';
import {statePage} from './state.js';
import {createApiProfileStore} from '../storage/store.js';
import * as defaultApiClient from '../ai/client.js';
import {createAnalyzer, normalizeWorldModel, summarizeAnalysisInput} from '../ai/analyzer.js';
import {buildAnalysisInput} from '../ai/input-builder.js';
import {
  characterOpeningSelectionState,
  createWorldbookCache,
  selectAllSources,
  selectNoneSources,
  searchAnalysisSources,
  loadAnalysisSources,
  loadWorldbookSource,
  setCharacterCardOpeningsSelection,
  setWorldbookEntriesSelection,
  sourceSelectionStats,
  updateSourceSelection,
  worldbookSelectionState,
} from '../ai/worldbook.js';
import {detectExternalMemoryProviders, probeExternalMemoryProviders} from '../story/seven-days-cal.js';
import {
  DEFAULT_API_REQUEST_SETTINGS,
  DEFAULT_API_PROFILE,
  FOLLOW_DEFAULT_API,
  normalizeExternalMemorySettings,
  normalizeApiRequestSettings,
  normalizeRecentStoryGlobalSettings,
  normalizeRecentStorySettings,
  normalizeWorldAnalysisPrompt,
  normalizeWorldbookSettings,
  SILLYTAVERN_CURRENT_API,
} from '../storage/schema.js';

const pages = {
  overview: ['总览', 'fa-house', overviewPage],
  characters: ['人物列表', 'fa-user-group', charactersPage],
  events: ['历史事件', 'fa-calendar-days', eventsPage],
  projection: ['推演预测', 'fa-wand-magic-sparkles', projectionPage],
  genealogy: ['家系图谱', 'fa-diagram-project', genealogyPage],
  world: ['世界模型', 'fa-shapes', worldPage],
  settings: ['设置', 'fa-gear', settingsPage],
  state: ['分析状态', 'fa-chart-line', statePage],
};

const desktopRoutes = ['overview', 'characters', 'events', 'projection', 'genealogy', 'world', 'settings'];
const bottomRoutes = ['overview', 'characters', 'events', 'projection'];
const moreRoutes = ['genealogy', 'world', 'settings', 'state'];
const THEME_KEY = 'bioweave_ui_theme';
const APP_TEARDOWN_PROPERTY = '__bioweaveAppTeardown';
const APP_RUNTIME_UNSUBSCRIBE_PROPERTY = '__bioweaveRuntimeUnsubscribe';
const APP_RUNTIME_DESTROY_PROPERTY = '__bioweaveRuntimeDestroy';
const THEME_VALUES = new Set(['tavern', 'light', 'dark']);
const ANALYSIS_SELECTION_SEPARATOR = '\u0000';
const analysisParentDisclosureStates = new WeakMap();
const RENDER_SCROLL_SELECTORS = Object.freeze([
  '.bioweave-main',
  '[data-bioweave-analysis-source-list]',
]);

export function notify(message, type = 'info', documentRef = globalThis.document) {
  const text = String(message ?? '').trim();
  if (!text) return;

  const method = typeof type === 'string' && type.trim() ? type.trim() : 'info';
  const toastrRefs = [...new Set([documentRef?.defaultView?.toastr, globalThis.toastr])];
  for (const toastr of toastrRefs) {
    try {
      const handler = toastr?.[method];
      if (typeof handler !== 'function') continue;
      handler.call(toastr, text);
      return;
    } catch {
      // Toast 宿主异常时继续使用安全的 console 回退。
    }
  }

  const consoleMethod = method === 'error' ? 'error' : method === 'warning' ? 'warn' : 'log';
  const fallbackText = `[BioWeave] ${text}`;
  try {
    globalThis.console?.[consoleMethod]?.(fallbackText);
  } catch {
    // 控制台被宿主禁用时，通知仍不能影响设置操作。
  }
}

// render 会重建设置页子树，按稳定选择器保存并恢复可滚动容器的位置。
export function captureScrollPositions(root, selectors = RENDER_SCROLL_SELECTORS) {
  return (Array.isArray(selectors) ? selectors : []).map(selector => {
    const node = root?.querySelector?.(selector);
    if (!node) return null;
    return {
      selector,
      scrollTop: Number.isFinite(node.scrollTop) ? node.scrollTop : 0,
      scrollLeft: Number.isFinite(node.scrollLeft) ? node.scrollLeft : 0,
    };
  }).filter(Boolean);
}

export function restoreScrollPositions(root, positions) {
  for (const position of Array.isArray(positions) ? positions : []) {
    const node = root?.querySelector?.(position?.selector);
    if (!node) continue;
    node.scrollTop = position.scrollTop;
    node.scrollLeft = position.scrollLeft;
  }
}

function analysisCharacterGroupKey(sourceId) {
  return String(sourceId ?? '').trim() + ':opening';
}

function createAnalysisSourcesState() {
  return {
    loaded: false,
    loading: false,
    refreshBusy: false,
    sources: [],
    search: '',
    selected: [],
    selectedCount: 0,
    selectedWorldbookCount: 0,
    selectedTokenEstimate: 0,
    notice: null,
    chatId: null,
    openWorldbooks: [],
    loadingWorldbookIds: [],
    openCharacterGroups: [],
    openAnalysisSections: [],
    openSettingsSections: [],
    recentStory: normalizeRecentStorySettings(),
    externalMemory: normalizeExternalMemorySettings(),
    externalMemoryProviders: [],
  };
}

function createAnalysisPreviewState() {
  return {
    busy: false,
    mode: 'structure',
    input: null,
    chatId: null,
    error: null,
    worldModelTrace: null,
  };
}

function createWorldModelState() {
  return {
    loaded: false,
    loading: false,
    busy: false,
    chatId: null,
    model: null,
    meta: null,
    selectedSpeciesIndex: null,
    selectedTypeIndex: null,
    editingSection: null,
    sectionDraft: null,
    sectionDirty: false,
    notice: null,
  };
}

function themeLabel(value) {
  return value === 'light' ? '日' : value === 'dark' ? '夜' : '跟随酒馆';
}

function readTheme(storageRef) {
  try {
    const value = storageRef?.getItem?.(THEME_KEY);
    return THEME_VALUES.has(value) ? value : 'tavern';
  } catch {
    return 'tavern';
  }
}

function writeTheme(storageRef, value) {
  try {
    storageRef?.setItem?.(THEME_KEY, value);
  } catch {
    // 隐私模式或宿主禁用 localStorage 时仍允许本次会话切换主题。
  }
}

export function closeModelPicker(target) {
  const picker = target?.closest?.('[data-bioweave-model-picker]')
    ?? (target?.matches?.('[data-bioweave-model-picker]') ? target : null);
  if (!picker) return false;
  const dropdown = picker.querySelector?.('[data-bioweave-model-dropdown]');
  const trigger = picker.querySelector?.('[data-bioweave-model-trigger]');
  if (dropdown) dropdown.hidden = true;
  trigger?.setAttribute?.('aria-expanded', 'false');
  return true;
}

// 父级 checkbox 位于 summary 内时，只拦截事件冒泡，保留浏览器原生勾选和 change 事件。
// details 的默认展开状态在当前事件结束后恢复，避免选择和折叠互相影响。
export function handleAnalysisParentToggleClick(event) {
  const target = event?.target?.closest?.('[data-bioweave-analysis-worldbook-toggle], [data-bioweave-analysis-character-opening-toggle]');
  if (!target) return false;
  event.stopPropagation?.();
  if (!target.disabled) {
    const details = target.closest?.('details');
    const openBeforeClick = details?.open;
    if (details && typeof openBeforeClick === 'boolean') {
      analysisParentDisclosureStates.set(details, openBeforeClick);
      const restoreDisclosure = () => {
        if (isConnectedToDocument(details)) details.open = openBeforeClick;
        analysisParentDisclosureStates.delete(details);
      };
      if (typeof globalThis.queueMicrotask === 'function') globalThis.queueMicrotask(restoreDisclosure);
      else Promise.resolve().then(restoreDisclosure);
    }
  }
  return true;
}

export function isConnectedToDocument(node, documentRef = globalThis.document) {
  if (!node) return false;
  if (typeof node.isConnected === 'boolean') return node.isConnected;
  if (typeof documentRef?.documentElement?.contains === 'function') {
    return documentRef.documentElement.contains(node);
  }
  return Boolean(documentRef?.body?.contains?.(node));
}

function connectedNodesById(documentRef, id) {
  if (!documentRef) return [];
  const nodes = typeof documentRef.querySelectorAll === 'function'
    ? [...documentRef.querySelectorAll('#' + id)]
    : [documentRef.getElementById?.(id)].filter(Boolean);
  return nodes.filter(node => isConnectedToDocument(node, documentRef));
}

function createNavigationButton(documentRef, id, compact = false) {
  const [label, icon] = pages[id];
  const button = documentRef.createElement('button');
  button.type = 'button';
  button.className = 'bioweave-nav-item';
  button.dataset.route = id;
  const compactLabel = label.replace('列表', '').replace('历史', '').replace('预测', '');
  button.innerHTML = '<i class="fa-solid ' + icon + '" aria-hidden="true"></i><span>' + (compact ? compactLabel : label) + '</span>';
  return button;
}

/**
 * 只负责稳定 overlay/panel 的 DOM 生命周期，业务状态仍由 createApp 持有。
 * 这样可以用最小 fake DOM 覆盖 detached root、重复 open 和 destroy 边界。
 */
export function createOverlayLifecycle({
  documentRef = globalThis.document,
  overlayId = 'bioweave-overlay',
  rootId = 'bioweave-panel',
  createOverlay,
  createRoot,
  initializeRoot,
  teardownRoot,
}) {
  let overlay = null;
  let root = null;
  let initialized = false;

  const cleanupRoot = node => {
    if (node && typeof teardownRoot === 'function') teardownRoot(node, overlay);
  };

  const removeDuplicateNodes = (nodes, keep, cleanup) => {
    for (const node of nodes) {
      if (node === keep) continue;
      cleanup?.(node);
      node.remove?.();
    }
  };

  function discardDisconnectedNodes() {
    if (overlay && !isConnectedToDocument(overlay, documentRef)) {
      cleanupRoot(root);
      root = null;
      overlay = null;
      initialized = false;
      return;
    }
    if (root && !isConnectedToDocument(root, documentRef)) {
      cleanupRoot(root);
      root = null;
      initialized = false;
    }
  }

  function mount() {
    const host = documentRef?.documentElement ?? documentRef?.body;
    if (!host) return null;
    discardDisconnectedNodes();

    if (!overlay) {
      const overlays = connectedNodesById(documentRef, overlayId);
      overlay = overlays[0] ?? null;
      removeDuplicateNodes(overlays, overlay, extraOverlay => {
        for (const extraRoot of extraOverlay.querySelectorAll?.('#' + rootId) ?? []) cleanupRoot(extraRoot);
      });
    }
    if (!overlay) {
      overlay = createOverlay(documentRef);
      overlay.id = overlayId;
      host.append(overlay);
    } else if (overlay.parentElement !== host) {
      host.append(overlay);
    }

    if (!root) {
      const roots = connectedNodesById(documentRef, rootId);
      root = roots[0] ?? null;
      removeDuplicateNodes(roots, root, cleanupRoot);
    }
    if (!root) root = createRoot(documentRef, overlay);
    root.id = rootId;
    if (root.parentElement !== overlay) overlay.append(root);

    if (!initialized) {
      initializeRoot(root, overlay);
      initialized = true;
    }
    return {overlay, root};
  }

  function open() {
    const mounted = mount();
    if (!mounted) return null;
    mounted.overlay.hidden = false;
    mounted.overlay.dataset.open = 'true';
    mounted.overlay.setAttribute('aria-hidden', 'false');
    mounted.root.dataset.open = 'true';
    mounted.root.setAttribute('aria-hidden', 'false');
    return mounted;
  }

  function close() {
    if (!overlay || !root) return;
    overlay.hidden = true;
    overlay.dataset.open = 'false';
    overlay.setAttribute('aria-hidden', 'true');
    root.dataset.open = 'false';
    root.setAttribute('aria-hidden', 'true');
  }

  function destroy() {
    if (root) cleanupRoot(root);
    if (overlay) overlay.remove?.();
    else root?.remove?.();
    overlay = null;
    root = null;
    initialized = false;
  }

  return {
    mount,
    open,
    close,
    destroy,
    getRoot: () => root,
    getOverlay: () => overlay,
  };
}

export function createApp(runtime, options = {}) {
  if (!runtime?.chat?.current) throw new TypeError('BIOWEAVE_RUNTIME_REQUIRED');

  const documentRef = options.documentRef ?? globalThis.document;
  const storageRef = options.storageRef ?? globalThis.localStorage;
  const profileStore = options.profileStore ?? runtime.store?.profileStore ?? createApiProfileStore(runtime.st ?? {});
  const apiClient = options.apiClient ?? defaultApiClient;
  let root = null;
  let overlay = null;
  let route = 'overview';
  let focusedCharacterId = null;
  let characterDetailTab = 'state';
  let moreMenuOpen = false;
  let unsubscribeRuntime = null;
  let modelRefreshSequence = 0;
  let analysisSourceRequestSequence = 0;
  let analysisSourceSaveSequence = 0;
  let analysisPreviewSequence = 0;
  let analysisSourceSaveChain = Promise.resolve();
  let worldbookCache = createWorldbookCache();
  let analysisSourcesState = createAnalysisSourcesState();
  let analysisPreviewState = createAnalysisPreviewState();
  let worldModelState = createWorldModelState();
  let worldModelAbortController = null;
  let worldModelAbortConfirmOpen = false;
  let globalRecentStory = normalizeRecentStoryGlobalSettings();
  let globalRecentStoryLoaded = false;
  let globalRecentStorySaveSequence = 0;
  let globalRecentStorySaveChain = Promise.resolve();
  let recentStorySaveTimer = null;
  let globalRecentStorySaveTimer = null;
  let settingsState = {
    loaded: false,
    loading: false,
    profiles: {},
    assignments: {},
    apiSource: SILLYTAVERN_CURRENT_API,
    defaultProfileId: null,
    apiRequestSettings: {...DEFAULT_API_REQUEST_SETTINGS},
    apiRequestDraft: null,
    editingProfile: undefined,
    editingDraft: undefined,
    drafts: {},
    modelList: [],
    modelListProfileKey: null,
    modelSearch: '',
    modelRefreshBusy: false,
    notice: null,
    testResult: null,
    busy: false,
    worldAnalysisPrompt: {},
    worldAnalysisPromptDraft: null,
  };

  let worldModelTraceChatId = null;

  function receiveWorldModelTrace(trace) {
    if (!trace || typeof trace !== 'object') return;
    const currentChatId = runtime.chat.current();
    if (worldModelTraceChatId !== null
      && String(worldModelTraceChatId) !== String(currentChatId)) return;
    const rawResponse = trace.raw_output ?? null;
    const canonicalModel = trace.canonical_model ?? null;
    if (rawResponse === null && canonicalModel === null) return;
    analysisPreviewState = {
      ...analysisPreviewState,
      chatId: currentChatId,
      error: null,
      worldModelTrace: {rawResponse, canonicalModel},
    };
    if (route === 'settings') render();
  }

  function resolveWorldAnalysisProfile() {
    const settings = profileStore.getSettings?.() ?? {};
    const assignment = settings.assignments?.world_analysis ?? null;
    if (assignment === SILLYTAVERN_CURRENT_API) return SILLYTAVERN_CURRENT_API;
    if (assignment === FOLLOW_DEFAULT_API) {
      if (settings.api_source === SILLYTAVERN_CURRENT_API) return SILLYTAVERN_CURRENT_API;
      const defaultProfileId = settings.default_profile_id;
      return defaultProfileId ? profileStore.getProfile?.(defaultProfileId) : null;
    }
    return assignment ? profileStore.getProfile?.(assignment) : null;
  }

  const analyzer = options.analyzer ?? createAnalyzer({
    profileResolver: resolveWorldAnalysisProfile,
    contextResolver: () => runtime.st?.getContext?.() ?? hostContextForApp(),
    requestSettingsResolver: () => settingsState.apiRequestDraft
      ?? profileStore.getApiRequestSettings?.()
      ?? settingsState.apiRequestSettings,
    worldModelPromptResolver: () => settingsState.worldAnalysisPromptDraft
      ?? profileStore.getWorldAnalysisPrompt?.()
      ?? settingsState.worldAnalysisPrompt,
    onWorldModelTrace: receiveWorldModelTrace,
  });

  function loadGlobalRecentStoryState() {
    const settings = profileStore.getSettings?.() ?? {};
    const saved = typeof profileStore.getRecentStoryGlobal === 'function'
      ? profileStore.getRecentStoryGlobal() ?? settings.recent_story_global
      : settings.recent_story_global;
    globalRecentStory = normalizeRecentStoryGlobalSettings(saved);
    globalRecentStoryLoaded = true;
    return globalRecentStory;
  }

  function updateSettingsState() {
    const settings = profileStore.getSettings?.() ?? {};
    loadGlobalRecentStoryState();
    settingsState = {
      ...settingsState,
      profiles: settings.api_profiles ?? {},
      assignments: settings.assignments ?? {},
      apiSource: settings.api_source ?? SILLYTAVERN_CURRENT_API,
      defaultProfileId: settings.default_profile_id ?? null,
      apiRequestSettings: normalizeApiRequestSettings(
        typeof profileStore.getApiRequestSettings === 'function'
          ? profileStore.getApiRequestSettings()
          : settings.api_request_settings,
      ),
      apiRequestDraft: settingsState.apiRequestDraft,
      worldAnalysisPrompt: normalizeWorldAnalysisPrompt(settings.world_analysis_prompt),
      worldAnalysisPromptDraft: settingsState.worldAnalysisPromptDraft,
      loaded: true,
    };
    return settings;
  }

  async function loadSettings() {
    if (settingsState.loaded || settingsState.loading) return;
    settingsState.loading = true;
    if (route === 'settings') render();
    try {
      updateSettingsState();
    } catch {
      notify('无法读取全局设置，请确认 SillyTavern extensionSettings 可用。', 'error', documentRef);
      settingsState = {
        ...settingsState,
        loaded: true,
        notice: null,
      };
    } finally {
      settingsState.loading = false;
      if (route === 'settings') render();
    }
  }

  function analysisSourceSelectedItems(selected) {
    return normalizeWorldbookSettings({selected}).selected;
  }

  function syncAnalysisSourcesState(patch = {}) {
    const next = {...analysisSourcesState, ...patch};
    const selected = analysisSourceSelectedItems(next.selected);
    const stats = sourceSelectionStats(next.sources, selected);
    return {
      ...next,
      selected,
      selectedCount: stats.count,
      selectedWorldbookCount: stats.worldbook_count,
      selectedTokenEstimate: stats.token_estimate,
    };
  }

  function currentAnalysisChatToken() {
    const chatId = runtime.chat.current();
    const token = typeof runtime.chat.token === 'function'
      ? runtime.chat.token()
      : {chatId};
    return {chatId, token};
  }

  function assertAnalysisChatToken(token) {
    if (typeof runtime.chat.assert === 'function') {
      runtime.chat.assert(token);
      return;
    }
    if (runtime.chat.current() !== token.chatId) throw new Error('STALE_CHAT');
  }

  function ensureAnalysisSourcesChat() {
    const chatId = runtime.chat.current();
    if (analysisSourcesState.chatId !== null && analysisSourcesState.chatId !== chatId) {
      analysisSourceRequestSequence += 1;
      analysisSourceSaveSequence += 1;
      analysisSourcesState = createAnalysisSourcesState();
      worldModelState = createWorldModelState();
      clearAnalysisPreview();
    }
    return chatId;
  }

  function clearAnalysisPreview() {
    analysisPreviewSequence += 1;
    analysisPreviewState = createAnalysisPreviewState();
  }

  function hostPopupContext() {
    try {
      return runtime.st?.getContext?.() ?? globalThis.SillyTavern?.getContext?.() ?? null;
    } catch {
      return null;
    }
  }

  function isPopupContentElement(value) {
    return Boolean(value
      && typeof value === 'object'
      && typeof value.addEventListener === 'function'
      && 'innerHTML' in value);
  }

  function renderDebugPopupContent(content, promptSettings = settingsState.worldAnalysisPrompt) {
    const nextContent = renderAnalysisDebugPopupContent({
      analysisPreview: analysisPreviewState,
      worldAnalysisPrompt: promptSettings,
      openSettingsSections: analysisSourcesState.openSettingsSections,
      theme: root?.dataset?.theme ?? 'tavern',
      documentRef,
    });
    if (isPopupContentElement(content)) {
      content.innerHTML = isPopupContentElement(nextContent) ? nextContent.innerHTML : String(nextContent ?? '');
    }
    return nextContent;
  }

  function readStoredWorldAnalysisPrompt() {
    try {
      return profileStore.getWorldAnalysisPrompt?.() ?? settingsState.worldAnalysisPrompt;
    } catch {
      return settingsState.worldAnalysisPrompt;
    }
  }

  async function openAnalysisDebugPopup({usePromptDraft = false} = {}) {
    if (usePromptDraft) captureWorldAnalysisPromptDraft();
    const promptSettings = usePromptDraft
      ? settingsState.worldAnalysisPromptDraft ?? settingsState.worldAnalysisPrompt
      : readStoredWorldAnalysisPrompt();
    const context = hostPopupContext();
    const Popup = context?.Popup;
    const popupType = context?.POPUP_TYPE?.DISPLAY;
    if (typeof Popup !== 'function' || popupType === undefined) {
      notify('高级 / 调试窗口暂不可用，请确认 SillyTavern Popup 已加载。', 'error', documentRef);
      return false;
    }

    const content = renderDebugPopupContent(null, promptSettings);
    const localContent = isPopupContentElement(content) ? content : null;
    const handlePopupClick = async event => {
      const target = event?.target?.closest?.('[data-bioweave-action]');
      if (!target) return;
      if (typeof localContent?.contains === 'function' && !localContent.contains(target)) return;
      const action = target.dataset?.bioweaveAction;
      if (action === 'refresh-analysis-preview') {
        event.preventDefault?.();
        const pending = refreshAnalysisPreview();
        renderDebugPopupContent(localContent, promptSettings);
        await pending;
        renderDebugPopupContent(localContent, promptSettings);
        return;
      }
      if (action === 'analysis-preview-mode') {
        event.preventDefault?.();
        setAnalysisPreviewMode(target.dataset.bioweavePreviewMode);
        renderDebugPopupContent(localContent, promptSettings);
      }
    };

    if (localContent) localContent.addEventListener('click', handlePopupClick);
    try {
      const popup = new Popup(content, popupType, '', {
        wide: true,
        allowVerticalScrolling: true,
      });
      await popup.show();
      return true;
    } catch {
      notify('高级 / 调试窗口打开失败，请确认 SillyTavern Popup 可用。', 'error', documentRef);
      return false;
    } finally {
      localContent?.removeEventListener?.('click', handlePopupClick);
    }
  }

  // 预览需要等待同一 Chat 的来源初次加载完成，不另起一套请求或固定超时。
  async function waitForAnalysisSourcesIdle() {
    while (analysisSourcesState.loading) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }

  function readAnalysisSettings(chatId) {
    const chatData = runtime.store?.getChat?.(chatId);
    return {
      worldbooks: normalizeWorldbookSettings(chatData?.settings?.worldbooks),
      recentStory: normalizeRecentStorySettings(chatData?.settings?.recent_story),
      externalMemory: normalizeExternalMemorySettings(chatData?.settings?.external_memory),
    };
  }

  // 重新读取当前 Chat 的小型设置，避免跨端打开时沿用旧的页面内存。
  function refreshAnalysisChatSettings() {
    if (recentStorySaveTimer !== null || globalRecentStorySaveTimer !== null) return false;
    const chatId = runtime.chat.current();
    if (analysisSourcesState.chatId !== chatId) return false;
    const chatSettings = readAnalysisSettings(chatId);
    analysisSourcesState = syncAnalysisSourcesState({
      chatId,
      selected: chatSettings.worldbooks.selected,
      recentStory: chatSettings.recentStory,
      externalMemory: chatSettings.externalMemory,
      notice: null,
    });
    return true;
  }

  async function loadAnalysisSourcesState({forceRefresh = false} = {}) {
    if (analysisSourcesState.loading) return;
    captureAnalysisSourceDisclosure();
    const {chatId, token} = currentAnalysisChatToken();
    const requestId = ++analysisSourceRequestSequence;
    const context = runtime.st?.getContext?.() ?? hostContextForApp();
    const chatSettings = readAnalysisSettings(chatId);
    const externalMemoryProbe = probeExternalMemoryProviders({context}).catch(() => (
      detectExternalMemoryProviders({context})
    ));
    const selected = analysisSourcesState.chatId === chatId
      ? analysisSourceSelectedItems(analysisSourcesState.selected)
      : chatSettings.worldbooks.selected;
    analysisSourcesState = syncAnalysisSourcesState({
      loading: true,
      refreshBusy: true,
      loadingWorldbookIds: [],
      chatId,
      selected,
      recentStory: analysisSourcesState.chatId === chatId ? analysisSourcesState.recentStory : chatSettings.recentStory,
      externalMemory: analysisSourcesState.chatId === chatId ? analysisSourcesState.externalMemory : chatSettings.externalMemory,
      externalMemoryProviders: detectExternalMemoryProviders({context}),
      notice: null,
    });
    if (route === 'settings') render();
    void externalMemoryProbe.then(providers => {
      try {
        assertAnalysisChatToken(token);
      } catch {
        return;
      }
      if (requestId !== analysisSourceRequestSequence || analysisSourcesState.chatId !== chatId) return;
      analysisSourcesState = {...analysisSourcesState, externalMemoryProviders: providers};
      if (route === 'settings') render();
    }).catch(() => {
      // 外部来源探测失败时保留同步能力检测结果，不影响世界书目录。
    });
    try {
      await analysisSourceSaveChain;
      assertAnalysisChatToken(token);
      if (requestId !== analysisSourceRequestSequence) return;
      const sources = await loadAnalysisSources({
        context,
        fetchRef: runtime.st?.fetch,
        getRequestHeaders: runtime.st?.getRequestHeaders,
        cache: worldbookCache,
        forceRefresh,
        deferWorldbookContent: true,
        loadContentForSourceIds: [
          ...analysisSourcesState.openWorldbooks,
          ...selected.map(item => item.source_id),
        ],
      });
      assertAnalysisChatToken(token);
      if (requestId !== analysisSourceRequestSequence) return;
      const sourceList = Array.isArray(sources) ? sources : sources.sources;
      const sourceWarning = Array.isArray(sources) ? null : sources.warning;
      const keepExistingSources = sourceWarning === 'ST_WORLDBOOK_LIST_FAILED' && analysisSourcesState.sources.length > 0;
      const safeSources = keepExistingSources ? analysisSourcesState.sources : (sourceList ?? []);
      if (sourceWarning === 'ST_WORLDBOOK_LIST_FAILED') {
        notify('世界书列表刷新失败，已保留之前的列表和选择。', 'error', documentRef);
      } else if (sourceWarning === 'ST_WORLDBOOK_LIST_FALLBACK') {
        notify('世界书列表接口不可用，已使用 SillyTavern 公共名称列表。', 'warning', documentRef);
      } else if (forceRefresh) {
        notify('分析来源已刷新。', 'info', documentRef);
      }
      analysisSourcesState = syncAnalysisSourcesState({
        loaded: true,
        loading: false,
        refreshBusy: false,
        sources: safeSources,
        selected,
        chatId,
        notice: null,
      });
    } catch {
      if (requestId !== analysisSourceRequestSequence) return;
      try {
        assertAnalysisChatToken(token);
      } catch {
        return;
      }
      analysisSourcesState = syncAnalysisSourcesState({
        loaded: true,
        loading: false,
        refreshBusy: false,
        selected,
        chatId,
        notice: null,
      });
      notify('分析来源刷新失败，已保留之前的列表和选择。', 'error', documentRef);
    } finally {
      if (requestId !== analysisSourceRequestSequence) return;
      analysisSourcesState = {
        ...analysisSourcesState,
        loading: false,
        refreshBusy: false,
      };
      if (route === 'settings') render();
    }
  }

  async function persistAnalysisSettings({
    selected = analysisSourcesState.selected,
    recentStory = analysisSourcesState.recentStory,
    externalMemory = analysisSourcesState.externalMemory,
    renderAfterSave = true,
  } = {}) {
    const normalizedWorldbooks = normalizeWorldbookSettings({
      mode: 'selected_only',
      selected,
    });
    const normalizedRecentStory = normalizeRecentStorySettings(recentStory);
    const normalizedExternalMemory = normalizeExternalMemorySettings(externalMemory);
    const {chatId, token} = currentAnalysisChatToken();
    const requestId = ++analysisSourceSaveSequence;
    analysisSourceSaveChain = analysisSourceSaveChain
      .catch(() => {})
      .then(async () => {
        assertAnalysisChatToken(token);
        const currentChat = runtime.store?.getChat?.(chatId);
        if (!currentChat || typeof runtime.store?.saveChat !== 'function') {
          throw new Error('ST_METADATA_STORAGE_UNAVAILABLE');
        }
        await runtime.store.saveChat(chatId, {
          ...currentChat,
          settings: {
            ...(currentChat.settings ?? {}),
            worldbooks: normalizedWorldbooks,
            recent_story: normalizedRecentStory,
            external_memory: normalizedExternalMemory,
          },
        });
        assertAnalysisChatToken(token);
        if (requestId === analysisSourceSaveSequence && analysisSourcesState.chatId === chatId) {
          analysisSourcesState = {...analysisSourcesState, notice: null};
          notify('分析来源与最近剧情设置已保存到当前 Chat。', 'success', documentRef);
          if (renderAfterSave && route === 'settings') render();
        }
      })
      .catch(error => {
        try {
          assertAnalysisChatToken(token);
        } catch {
          return;
        }
        if (requestId === analysisSourceSaveSequence && analysisSourcesState.chatId === chatId) {
          analysisSourcesState = {...analysisSourcesState, notice: null};
          notify('世界书来源保存失败，当前选择仍保留。', 'error', documentRef);
          if (renderAfterSave && route === 'settings') render();
        }
        void error;
      });
    return analysisSourceSaveChain;
  }

  function clearPendingRecentStorySaves() {
    if (recentStorySaveTimer !== null) {
      clearTimeout(recentStorySaveTimer);
      recentStorySaveTimer = null;
    }
    if (globalRecentStorySaveTimer !== null) {
      clearTimeout(globalRecentStorySaveTimer);
      globalRecentStorySaveTimer = null;
    }
  }

  function queueRecentStorySettingsSave(settings) {
    const snapshot = normalizeRecentStorySettings(settings);
    if (recentStorySaveTimer !== null) clearTimeout(recentStorySaveTimer);
    recentStorySaveTimer = setTimeout(() => {
      recentStorySaveTimer = null;
      void persistAnalysisSettings({recentStory: snapshot, renderAfterSave: false});
    }, 250);
  }

  function queueRecentStoryGlobalSettingsSave(settings) {
    const snapshot = normalizeRecentStoryGlobalSettings(settings);
    if (globalRecentStorySaveTimer !== null) clearTimeout(globalRecentStorySaveTimer);
    globalRecentStorySaveTimer = setTimeout(() => {
      globalRecentStorySaveTimer = null;
      void persistRecentStoryGlobalSettings(snapshot, {renderAfterSave: false});
    }, 250);
  }

  async function persistRecentStoryGlobalSettings(settings, {renderAfterSave = true} = {}) {
    const next = normalizeRecentStorySettings(settings);
    globalRecentStory = {regex_rules: next.regex_rules};
    globalRecentStoryLoaded = true;
    if (renderAfterSave) render();
    if (typeof profileStore.saveRecentStoryGlobal !== 'function') {
      settingsState = {...settingsState, notice: null};
      notify('当前宿主不支持保存全局正则。', 'error', documentRef);
      if (renderAfterSave) render();
      return;
    }
    const requestId = ++globalRecentStorySaveSequence;
    const snapshot = {regex_rules: [...next.regex_rules]};
    globalRecentStorySaveChain = globalRecentStorySaveChain
      .catch(() => {})
      .then(async () => {
        const saved = await profileStore.saveRecentStoryGlobal(snapshot);
        if (requestId !== globalRecentStorySaveSequence) return;
        globalRecentStory = {
          // 保存规范化结果时不带入 Secret；空白规则仍由当前页面状态保留以便继续编辑。
          regex_rules: normalizeRecentStorySettings(globalRecentStory).regex_rules,
        };
        settingsState = {...settingsState, notice: null};
        notify('全局正则已保存。', 'success', documentRef);
        void saved;
        if (renderAfterSave) render();
      })
      .catch(error => {
        if (requestId !== globalRecentStorySaveSequence) return;
        settingsState = {...settingsState, notice: null};
        notify(settingsOperationError(error), 'error', documentRef);
        if (renderAfterSave) render();
      });
    return globalRecentStorySaveChain;
  }

  function applyAnalysisSourceSearch(query) {
    if (!root) return;
    const visibleSources = searchAnalysisSources(analysisSourcesState.sources, query);
    const visibleIds = new Set(visibleSources.map(source => source.source_id));
    const visibleChildren = new Set();
    for (const source of visibleSources) {
      for (const entry of source.entries ?? []) visibleChildren.add(`${source.source_id}${ANALYSIS_SELECTION_SEPARATOR}entry${ANALYSIS_SELECTION_SEPARATOR}${entry.entry_id}`);
      for (const field of source.fields ?? []) visibleChildren.add(`${source.source_id}${ANALYSIS_SELECTION_SEPARATOR}field${ANALYSIS_SELECTION_SEPARATOR}${field.field_key}`);
    }
    root.querySelectorAll?.('[data-bioweave-analysis-source-row]').forEach(row => {
      const sourceId = row.dataset?.bioweaveAnalysisSourceRow;
      const childKey = row.dataset?.bioweaveAnalysisSourceChildKey;
      const visible = visibleIds.has(sourceId) && (!childKey || visibleChildren.has(childKey));
      row.hidden = !visible;
      if (visible && query.trim() && row.tagName === 'DETAILS') row.open = true;
    });
    root.querySelectorAll?.('[data-bioweave-analysis-character-group]').forEach(group => {
      const visibleChild = [...group.querySelectorAll?.('[data-bioweave-analysis-source-child-key]') ?? []]
        .some(row => !row.hidden);
      if (query.trim() && visibleChild) group.open = true;
    });
    root.querySelectorAll?.('[data-bioweave-analysis-section]').forEach(section => {
      const hasVisibleRow = [...section.querySelectorAll?.('[data-bioweave-analysis-source-row]') ?? []]
        .some(row => !row.hidden);
      section.hidden = Boolean(query.trim()) && !hasVisibleRow;
      if (query.trim() && hasVisibleRow) section.open = true;
    });
  }

  function captureAnalysisSourceDisclosure() {
    if (!root) return;
    const openAnalysisSections = [...root.querySelectorAll?.('[data-bioweave-analysis-section][open]') ?? []]
      .map(node => String(node.dataset?.bioweaveAnalysisSection ?? '').trim())
      .filter(Boolean);
    const openWorldbooks = [...root.querySelectorAll?.('.bioweave-analysis-worldbook') ?? []]
      .filter(node => analysisParentDisclosureStates.has(node)
        ? analysisParentDisclosureStates.get(node)
        : node.open)
      .map(node => String(node.dataset?.bioweaveAnalysisSourceRow ?? '').trim())
      .filter(Boolean);
    const openCharacterGroups = [...root.querySelectorAll?.('[data-bioweave-analysis-character-group]') ?? []]
      .filter(node => analysisParentDisclosureStates.has(node)
        ? analysisParentDisclosureStates.get(node)
        : node.open)
      .map(node => analysisCharacterGroupKey(node.dataset?.bioweaveAnalysisCharacterGroupSource))
      .filter(key => key !== ':opening');
    const openSettingsSections = [...root.querySelectorAll?.('[data-bioweave-settings-disclosure][open]') ?? []]
      .map(node => String(node.dataset?.bioweaveSettingsDisclosure ?? '').trim())
      .filter(Boolean);
    analysisSourcesState = {
      ...analysisSourcesState,
      openAnalysisSections,
      openWorldbooks,
      openCharacterGroups,
      openSettingsSections,
    };
  }

  async function toggleAnalysisSource(target) {
    const sourceId = target?.dataset?.bioweaveAnalysisSource;
    if (!sourceId || target.disabled) return;
    captureAnalysisSourceDisclosure();
    const selection = {
      source_id: sourceId,
      entry_id: target.dataset?.bioweaveAnalysisEntry,
      field_key: target.dataset?.bioweaveAnalysisField,
    };
    const selected = updateSourceSelection(analysisSourcesState.selected, selection, Boolean(target.checked));
    analysisSourcesState = syncAnalysisSourcesState({selected, notice: null});
    render();
    await persistAnalysisSettings({selected, renderAfterSave: false});
  }

  async function loadWorldbookSourceForUi(sourceId, {selectAll = null, forceRefresh = false} = {}) {
    const id = String(sourceId ?? '').trim();
    const source = analysisSourcesState.sources.find(item => item.source_id === id);
    if (!source) return null;
    if (source.content_loaded && selectAll === null) return source;
    if ((analysisSourcesState.loadingWorldbookIds ?? []).includes(id)) return null;

    const {chatId, token} = currentAnalysisChatToken();
    const requestId = analysisSourceRequestSequence;
    const loadingWorldbookIds = [...new Set([...(analysisSourcesState.loadingWorldbookIds ?? []), id])];
    analysisSourcesState = syncAnalysisSourcesState({
      loading: true,
      loadingWorldbookIds,
      chatId,
      notice: null,
    });
    render();
    try {
      const context = runtime.st?.getContext?.() ?? hostContextForApp();
      const loaded = await loadWorldbookSource(source, {
        context,
        fetchRef: runtime.st?.fetch ?? globalThis.fetch,
        getRequestHeaders: runtime.st?.getRequestHeaders,
        cache: worldbookCache,
        forceRefresh,
      });
      assertAnalysisChatToken(token);
      if (requestId !== analysisSourceRequestSequence) return null;
      if (!loaded?.content_loaded) throw new Error('ST_WORLDBOOK_CONTENT_FAILED');
      const sources = analysisSourcesState.sources.map(item => item.source_id === id
        ? {
          ...item,
          ...loaded,
          scopes: [...new Set([...(item.scopes ?? []), ...(loaded.scopes ?? [])])],
        }
        : item);
      const selected = selectAll === null
        ? analysisSourcesState.selected
        : setWorldbookEntriesSelection(analysisSourcesState.selected, loaded, selectAll);
      analysisSourcesState = syncAnalysisSourcesState({
        loaded: true,
        loading: false,
        loadingWorldbookIds: (analysisSourcesState.loadingWorldbookIds ?? []).filter(value => value !== id),
        sources,
        selected,
        chatId,
        notice: null,
      });
      render();
      if (selectAll !== null) await persistAnalysisSettings({selected, renderAfterSave: false});
      return loaded;
    } catch {
      if (requestId !== analysisSourceRequestSequence) return null;
      try {
        assertAnalysisChatToken(token);
      } catch {
        return null;
      }
      analysisSourcesState = syncAnalysisSourcesState({
        loading: false,
        loadingWorldbookIds: (analysisSourcesState.loadingWorldbookIds ?? []).filter(value => value !== id),
        chatId,
        notice: null,
      });
      notify('世界书条目读取失败，请稍后重试。', 'error', documentRef);
      render();
      return null;
    }
  }

  async function toggleWorldbookEntries(target) {
    const sourceId = String(target?.dataset?.bioweaveAnalysisWorldbookToggle ?? '').trim();
    if (!sourceId || target.disabled) return;
    const source = analysisSourcesState.sources.find(item => item.source_id === sourceId);
    if (!source) return;
    captureAnalysisSourceDisclosure();
    if (!source.content_loaded) {
      await loadWorldbookSourceForUi(sourceId, {selectAll: Boolean(target.checked)});
      return;
    }
    const selected = setWorldbookEntriesSelection(
      analysisSourcesState.selected,
      source,
      Boolean(target.checked),
    );
    analysisSourcesState = syncAnalysisSourcesState({selected, notice: null});
    render();
    await persistAnalysisSettings({selected, renderAfterSave: false});
  }

  async function toggleCharacterCardOpenings(target) {
    const sourceId = String(target?.dataset?.bioweaveAnalysisCharacterOpeningToggle ?? '').trim();
    if (!sourceId || target.disabled) return;
    const source = analysisSourcesState.sources.find(item => item.source_id === sourceId);
    if (!source) return;
    captureAnalysisSourceDisclosure();
    const selected = setCharacterCardOpeningsSelection(
      analysisSourcesState.selected,
      source,
      Boolean(target.checked),
    );
    analysisSourcesState = syncAnalysisSourcesState({selected, notice: null});
    render();
    await persistAnalysisSettings({selected, renderAfterSave: false});
  }

  function syncAnalysisWorldbookToggles() {
    if (!root) return;
    root.querySelectorAll?.('[data-bioweave-analysis-worldbook-toggle]').forEach(toggle => {
      const sourceId = String(toggle.dataset?.bioweaveAnalysisWorldbookToggle ?? '').trim();
      const source = analysisSourcesState.sources.find(item => item.source_id === sourceId);
      const state = worldbookSelectionState(source, analysisSourcesState.selected);
      toggle.checked = state.checked;
      toggle.indeterminate = state.indeterminate;
      toggle.setAttribute('aria-checked', state.indeterminate ? 'mixed' : String(state.checked));
    });
  }

  function syncAnalysisCharacterOpeningToggles() {
    if (!root) return;
    root.querySelectorAll?.('[data-bioweave-analysis-character-opening-toggle]').forEach(toggle => {
      const sourceId = String(toggle.dataset?.bioweaveAnalysisCharacterOpeningToggle ?? '').trim();
      const source = analysisSourcesState.sources.find(item => item.source_id === sourceId);
      const state = characterOpeningSelectionState(source, analysisSourcesState.selected);
      toggle.checked = state.checked;
      toggle.indeterminate = state.indeterminate;
      toggle.setAttribute('aria-checked', state.indeterminate ? 'mixed' : String(state.checked));
    });
  }

  async function loadAllWorldbooksForSelection({sourceIds = null} = {}) {
    const requestedSourceIds = sourceIds instanceof Set
      ? sourceIds
      : Array.isArray(sourceIds)
        ? new Set(sourceIds)
        : null;
    const unloaded = analysisSourcesState.sources.filter(source => source.source_type === 'worldbook'
      && !source.content_loaded
      && source.host_key
      && (!requestedSourceIds || requestedSourceIds.has(source.source_id)));
    if (!unloaded.length) return analysisSourcesState.sources;

    const {chatId, token} = currentAnalysisChatToken();
    const requestId = analysisSourceRequestSequence;
    const loadingWorldbookIds = [...new Set([
      ...(analysisSourcesState.loadingWorldbookIds ?? []),
      ...unloaded.map(source => source.source_id),
    ])];
    analysisSourcesState = syncAnalysisSourcesState({
      loading: true,
      loadingWorldbookIds,
      chatId,
      notice: null,
    });
    render();
    try {
      const context = runtime.st?.getContext?.() ?? hostContextForApp();
      const loaded = await Promise.all(unloaded.map(source => loadWorldbookSource(source, {
        context,
        fetchRef: runtime.st?.fetch ?? globalThis.fetch,
        getRequestHeaders: runtime.st?.getRequestHeaders,
        cache: worldbookCache,
      })));
      assertAnalysisChatToken(token);
      if (requestId !== analysisSourceRequestSequence) return null;
      const loadedById = new Map(loaded.map(source => [source.source_id, source]));
      const sources = analysisSourcesState.sources.map(source => {
        const next = loadedById.get(source.source_id);
        return next
          ? {...source, ...next, scopes: [...new Set([...(source.scopes ?? []), ...(next.scopes ?? [])])]}
          : source;
      });
      const failed = loaded.some(source => !source?.content_loaded);
      analysisSourcesState = syncAnalysisSourcesState({
        loaded: true,
        loading: false,
        loadingWorldbookIds: (analysisSourcesState.loadingWorldbookIds ?? [])
          .filter(value => !loadingWorldbookIds.includes(value)),
        sources,
        chatId,
        notice: null,
      });
      if (failed) notify('部分世界书条目读取失败，已选择成功读取的内容。', 'warning', documentRef);
      render();
      return sources;
    } catch {
      if (requestId !== analysisSourceRequestSequence) return null;
      try {
        assertAnalysisChatToken(token);
      } catch {
        return null;
      }
      analysisSourcesState = syncAnalysisSourcesState({
        loading: false,
        loadingWorldbookIds: (analysisSourcesState.loadingWorldbookIds ?? [])
          .filter(value => !loadingWorldbookIds.includes(value)),
        chatId,
        notice: null,
      });
      notify('世界书条目读取失败，当前选择仍保留。', 'error', documentRef);
      render();
      return analysisSourcesState.sources;
    }
  }

  // World Model 与分析输入预览共用同一份临时 AnalysisInput 收集流程。
  async function collectCurrentAnalysisInput() {
    const {chatId, token} = currentAnalysisChatToken();
    if (!analysisSourcesState.loaded || analysisSourcesState.chatId !== chatId) {
      await loadAnalysisSourcesState();
    }
    await waitForAnalysisSourcesIdle();
    assertAnalysisChatToken(token);
    const selectedWorldbookIds = new Set(
      analysisSourcesState.selected
        .filter(item => item?.entry_id)
        .map(item => item.source_id),
    );
    await loadAllWorldbooksForSelection({sourceIds: selectedWorldbookIds});
    assertAnalysisChatToken(token);
    const context = runtime.st?.getContext?.() ?? hostContextForApp();
    const externalMemoryProviders = await probeExternalMemoryProviders({context}).catch(() => (
      detectExternalMemoryProviders({context})
    ));
    assertAnalysisChatToken(token);
    if (!globalRecentStoryLoaded) loadGlobalRecentStoryState();
    return {
      input: buildAnalysisInput({
        sources: analysisSourcesState.sources,
        selected: analysisSourcesState.selected,
        context,
        chatId,
        recentStory: analysisSourcesState.recentStory,
        globalRecentStory,
        externalMemory: analysisSourcesState.externalMemory,
        externalMemoryProviders,
      }),
      chatId,
      token,
    };
  }

  async function refreshAnalysisPreview() {
    if (analysisPreviewState.busy) return;
    captureAnalysisSourceDisclosure();
    const {chatId, token} = currentAnalysisChatToken();
    const requestId = ++analysisPreviewSequence;
    analysisPreviewState = {
      ...analysisPreviewState,
      busy: true,
      chatId,
      error: null,
      worldModelTrace: null,
    };
    if (route === 'settings' || route === 'world') render();
    try {
      const collected = await collectCurrentAnalysisInput();
      assertAnalysisChatToken(token);
      if (requestId !== analysisPreviewSequence) return;
      analysisPreviewState = {
        busy: false,
        mode: analysisPreviewState.mode,
        input: collected.input,
        chatId: collected.chatId,
        error: null,
        worldModelTrace: null,
      };
    } catch (error) {
      if (requestId !== analysisPreviewSequence) return;
      try {
        assertAnalysisChatToken(token);
      } catch {
        return;
      }
      analysisPreviewState = {
        ...analysisPreviewState,
        busy: false,
        chatId,
        error: '分析输入预览读取失败，请检查当前 Chat 的来源设置。',
      };
    }
    if (requestId === analysisPreviewSequence && (route === 'settings' || route === 'world')) render();
  }

  function loadWorldModelState() {
    const chatId = runtime.chat.current();
    if (worldModelState.loaded && worldModelState.chatId === chatId) return;
    const chatData = runtime.store?.getChat?.(chatId);
    let model = null;
    let notice = null;
    if (chatData?.world_model) {
      try {
        model = normalizeWorldModel(chatData.world_model);
      } catch {
        notice = '已保存的世界模型格式无效，请重新分析。';
      }
    }
    const selection = resolveWorldModelSelection(model);
    worldModelState = {
      ...createWorldModelState(),
      loaded: true,
      chatId,
      model,
      meta: chatData?.world_model_meta ?? null,
      selectedSpeciesIndex: selection.speciesIndex,
      selectedTypeIndex: selection.typeIndex,
      notice,
    };
  }

  function worldModelOperationError(error) {
    const code = String(error?.code ?? error?.message ?? '');
    const messages = {
      API_PROFILE_NOT_CONFIGURED: '世界分析尚未配置 API，请在设置的任务分配中选择可用配置。',
      API_PROFILE_INVALID: '世界分析 API 配置无效，请检查 URL 和模型。',
      ST_CURRENT_API_UNAVAILABLE: 'SillyTavern 当前 API 不可用。',
      ST_CHAT_COMPLETION_UNAVAILABLE: '独立 API 服务不可用，请检查 API 来源设置。',
      WORLD_ANALYZER_UNAVAILABLE: '世界分析功能暂不可用，请重新加载 BioWeave。',
      WORLD_MODEL_INVALID: 'AI 返回的世界模型无法通过 JSON 校验，上一份模型已保留。',
      ST_METADATA_STORAGE_UNAVAILABLE: '当前 Chat 存储不可用，当前模块草稿仍保留。',
      STALE_CHAT: 'Chat 已切换，本次世界模型结果未保存。',
      WORLD_MODEL_SAVE_FAILED: '保存失败，当前模块草稿仍保留。',
      SAVE_FAILED: '保存失败，当前模块草稿仍保留。',
      ST_SAVE_CHAT_FAILED: '保存失败，当前模块草稿仍保留。',
      ST_CHAT_SAVE_FAILED: '保存失败，当前模块草稿仍保留。',
      REQUEST_TIMEOUT: '世界模型分析请求超时，上一份模型已保留。',
      REQUEST_ABORTED: '世界模型分析请求已取消，上一份模型已保留。',
    };
    const matchedCode = Object.keys(messages).find(key => code === key || code.startsWith(`${key}_`));
    return messages[matchedCode] ?? '世界模型操作失败，上一份模型已保留。';
  }

  function currentWorldModelSelection() {
    return resolveWorldModelSelection(
      worldModelState.model,
      worldModelState.selectedSpeciesIndex,
      worldModelState.selectedTypeIndex,
    );
  }

  function captureWorldModelSectionDraft() {
    const section = worldModelState.editingSection;
    if (!section) return worldModelState.sectionDraft;
    const form = root?.querySelector?.('[data-bioweave-world-section-form]');
    if (!form) return worldModelState.sectionDraft;
    const draft = extractWorldModelSection(form, section);
    if (draft === null) return worldModelState.sectionDraft;
    const original = getWorldModelSection(
      worldModelState.model,
      section,
      currentWorldModelSelection(),
    );
    worldModelState = {
      ...worldModelState,
      sectionDraft: draft,
      sectionDirty: JSON.stringify(draft) !== JSON.stringify(original),
    };
    return draft;
  }

  async function confirmWithPopup(title, message) {
    const context = hostPopupContext();
    const confirm = context?.Popup?.show?.confirm;
    const affirmative = context?.POPUP_RESULT?.AFFIRMATIVE;
    if (typeof confirm !== 'function' || affirmative === undefined) {
      notify('当前宿主不支持确认弹窗，操作已取消。', 'error', documentRef);
      return false;
    }
    try {
      const result = await confirm.call(context.Popup.show, title, message);
      return result === affirmative;
    } catch {
      notify('确认弹窗打开失败，操作已取消。', 'error', documentRef);
      return false;
    }
  }

  async function canDiscardWorldModelSectionDraft() {
    if (!worldModelState.editingSection || !worldModelState.sectionDirty) return true;
    return confirmWithPopup('放弃未保存修改', '当前修改尚未保存，是否放弃？');
  }

  async function requestAbortWorldModelAnalysis() {
    const controller = worldModelAbortController;
    if (!worldModelState.busy || !controller || worldModelAbortConfirmOpen) return false;
    worldModelAbortConfirmOpen = true;
    try {
      const confirmed = await confirmWithPopup(
        '终止世界模型分析',
        '当前分析仍在进行，是否终止本次分析？',
      );
      if (!confirmed) return false;
      if (!worldModelState.busy || worldModelAbortController !== controller || controller.signal.aborted) {
        return false;
      }
      controller.abort();
      return true;
    } finally {
      worldModelAbortConfirmOpen = false;
    }
  }

  function clearWorldModelSectionDraft() {
    worldModelState = {
      ...worldModelState,
      editingSection: null,
      sectionDraft: null,
      sectionDirty: false,
    };
  }

  async function beginWorldModelSectionEdit(section) {
    if (!worldModelState.model || !WORLD_MODEL_SECTION_KEYS.includes(section)) return false;
    if (worldModelState.editingSection === section) return true;
    if (worldModelState.sectionDirty) captureWorldModelSectionDraft();
    if (!await canDiscardWorldModelSectionDraft()) return false;
    const selection = currentWorldModelSelection();
    worldModelState = {
      ...worldModelState,
      selectedSpeciesIndex: selection.speciesIndex,
      selectedTypeIndex: selection.typeIndex,
      editingSection: section,
      sectionDraft: getWorldModelSection(worldModelState.model, section, selection),
      sectionDirty: false,
      notice: null,
    };
    render();
    return true;
  }

  function cancelWorldModelSectionEdit() {
    clearWorldModelSectionDraft();
    worldModelState = {...worldModelState, notice: null};
    render();
  }

  async function selectWorldModelType(speciesIndex, typeIndex = null) {
    if (!worldModelState.model) return false;
    if (worldModelState.sectionDirty) captureWorldModelSectionDraft();
    if (!await canDiscardWorldModelSectionDraft()) return false;
    const selection = resolveWorldModelSelection(worldModelState.model, speciesIndex, typeIndex);
    worldModelState = {
      ...worldModelState,
      selectedSpeciesIndex: selection.speciesIndex,
      selectedTypeIndex: selection.typeIndex,
      editingSection: null,
      sectionDraft: null,
      sectionDirty: false,
      notice: null,
    };
    render();
    return true;
  }

  function updateWorldModelSectionDraft(mutator) {
    if (!worldModelState.editingSection) return;
    captureWorldModelSectionDraft();
    const current = worldModelState.sectionDraft ?? getWorldModelSection(
      worldModelState.model,
      worldModelState.editingSection,
      currentWorldModelSelection(),
    );
    const next = mutator(current);
    worldModelState = {
      ...worldModelState,
      sectionDraft: next,
      sectionDirty: true,
      notice: null,
    };
    render();
  }

  async function saveWorldModelSection() {
    const section = worldModelState.editingSection;
    if (!section || !worldModelState.model) return;
    captureWorldModelSectionDraft();
    const selection = currentWorldModelSelection();
    let model;
    try {
      const base = normalizeWorldModel(worldModelState.model);
      const patched = applyWorldModelSection(base, section, worldModelState.sectionDraft, {
        selectedSpeciesIndex: selection.speciesIndex,
        selectedTypeIndex: selection.typeIndex,
      });
      model = normalizeWorldModel(patched);
    } catch (error) {
      worldModelState = {...worldModelState, notice: worldModelOperationError(error)};
      render();
      return;
    }
    const {chatId, token} = currentAnalysisChatToken();
    worldModelState = {...worldModelState, busy: true, notice: null};
    render();
    try {
      const currentChat = runtime.store?.getChat?.(chatId);
      if (!currentChat || typeof runtime.store?.saveChat !== 'function') throw new Error('ST_METADATA_STORAGE_UNAVAILABLE');
      const hasPersistedMeta = Object.prototype.hasOwnProperty.call(currentChat, 'world_model_meta');
      const currentMeta = hasPersistedMeta ? currentChat.world_model_meta : worldModelState.meta;
      const existingMeta = currentMeta && typeof currentMeta === 'object'
        ? currentMeta
        : null;
      const nextMeta = existingMeta ? {...existingMeta} : null;
      let metadataChanged = false;
      if (nextMeta && Object.prototype.hasOwnProperty.call(nextMeta, 'last_saved_at')) {
        nextMeta.last_saved_at = new Date().toISOString();
        metadataChanged = true;
      }
      if (nextMeta && Object.prototype.hasOwnProperty.call(nextMeta, 'last_saved_by')) {
        nextMeta.last_saved_by = 'manual';
        metadataChanged = true;
      }
      const nextChat = {...currentChat, world_model: model};
      if (metadataChanged && hasPersistedMeta) {
        nextChat.world_model_meta = nextMeta;
      }
      await runtime.store.saveChat(chatId, nextChat);
      assertAnalysisChatToken(token);
      worldModelState = {
        ...worldModelState,
        busy: false,
        model,
        meta: metadataChanged && hasPersistedMeta ? nextMeta : worldModelState.meta,
        editingSection: null,
        sectionDraft: null,
        sectionDirty: false,
        notice: '当前模块已保存。',
      };
    } catch (error) {
      try {
        assertAnalysisChatToken(token);
      } catch {
        return;
      }
      worldModelState = {
        ...worldModelState,
        busy: false,
        notice: worldModelOperationError(error),
      };
    }
    render();
  }

  async function analyzeWorldModel() {
    if (worldModelState.busy) return;
    if (worldModelState.sectionDirty) captureWorldModelSectionDraft();
    if (!await canDiscardWorldModelSectionDraft()) return;
    if (worldModelState.editingSection) clearWorldModelSectionDraft();
    const {chatId, token} = currentAnalysisChatToken();
    const controller = new AbortController();
    worldModelAbortController = controller;
    worldModelTraceChatId = chatId;
    analysisPreviewState = {
      ...analysisPreviewState,
      chatId,
      error: null,
      worldModelTrace: null,
    };
    worldModelState = {...worldModelState, busy: true, notice: null};
    if (route === 'world') render();
    try {
      const collected = await collectCurrentAnalysisInput();
      assertAnalysisChatToken(token);
      const analyze = analyzer?.analyzeWorldModel ?? analyzer?.analyzeWorld;
      if (typeof analyze !== 'function') throw new Error('WORLD_ANALYZER_UNAVAILABLE');
      const result = await analyze({analysisInput: collected.input, signal: controller.signal});
      const model = normalizeWorldModel(result);
      assertAnalysisChatToken(token);
      const currentChat = runtime.store?.getChat?.(chatId);
      if (!currentChat || typeof runtime.store?.saveChat !== 'function') throw new Error('ST_METADATA_STORAGE_UNAVAILABLE');
      const analyzedAt = new Date().toISOString();
      const meta = {
        last_analyzed_at: analyzedAt,
        last_saved_at: analyzedAt,
        last_saved_by: 'ai',
        source_summary: summarizeAnalysisInput(collected.input),
      };
      await runtime.store.saveChat(chatId, {
        ...currentChat,
        world_model: model,
        world_model_meta: meta,
      });
      assertAnalysisChatToken(token);
      analysisPreviewState = {
        ...analysisPreviewState,
        busy: false,
        input: collected.input,
        chatId,
        error: null,
      };
      worldModelState = {
        ...worldModelState,
        loaded: true,
        busy: false,
        model,
        meta,
        chatId,
        ...resolveWorldModelSelection(model),
        editingSection: null,
        sectionDraft: null,
        sectionDirty: false,
        notice: '世界模型分析成功并已保存。',
      };
    } catch (error) {
      try {
        assertAnalysisChatToken(token);
      } catch {
        return;
      }
      worldModelState = {...worldModelState, busy: false, notice: worldModelOperationError(error)};
    } finally {
      if (worldModelAbortController === controller) worldModelAbortController = null;
    }
    if (route === 'world') render();
  }

  function setAnalysisPreviewMode(mode) {
    const nextMode = mode === 'raw' ? 'raw' : 'structure';
    if (analysisPreviewState.mode === nextMode) return;
    analysisPreviewState = {...analysisPreviewState, mode: nextMode};
    if (route === 'settings') render();
  }

  async function setAllAnalysisSources(selectAll) {
    captureAnalysisSourceDisclosure();
    const sources = selectAll ? await loadAllWorldbooksForSelection() : analysisSourcesState.sources;
    if (!sources) return;
    const selected = selectAll ? selectAllSources(sources) : selectNoneSources();
    analysisSourcesState = syncAnalysisSourcesState({selected, notice: null});
    render();
    await persistAnalysisSettings({selected, renderAfterSave: false});
  }

  function updateRecentStoryState(target) {
    const current = normalizeRecentStorySettings(analysisSourcesState.recentStory);
    const next = target?.dataset?.bioweaveRecentStoryUserRegex !== undefined
      ? normalizeRecentStorySettings({...current, regex_user_enabled: Boolean(target.checked)})
      : normalizeRecentStorySettings({...current, floor_count: target?.value});
    analysisSourcesState = {...analysisSourcesState, recentStory: next, notice: null};
    return next;
  }

  function readRecentStoryRegexSettings(scope = 'character') {
    const isGlobal = scope === 'global';
    const current = isGlobal
      ? normalizeRecentStorySettings(globalRecentStory)
      : normalizeRecentStorySettings(analysisSourcesState.recentStory);
    const rows = [...(root?.querySelectorAll?.('[data-bioweave-recent-story-regex-row], [data-bioweave-recent-story-global-regex-row]') ?? [])]
      .filter(row => String(row.dataset?.bioweaveRecentStoryRegexScope ?? '').trim() === scope);
    if (!rows.length) return isGlobal ? {regex_rules: current.regex_rules} : current;
    const regexRules = rows.map(row => ({
      pattern: row.querySelector?.('[data-bioweave-recent-story-regex-pattern]')?.value ?? '',
      type: row.querySelector?.('[data-bioweave-recent-story-regex-type]')?.value ?? 'extract',
      enabled: row.querySelector?.('[data-bioweave-recent-story-regex-enabled]')?.checked !== false,
    }));
    return isGlobal
      ? {regex_rules: normalizeRecentStorySettings({regex_rules: regexRules}).regex_rules}
      : normalizeRecentStorySettings({...current, regex_rules: regexRules});
  }

  function updateRecentStoryRegexState(scope = 'character') {
    const recentStory = readRecentStoryRegexSettings(scope);
    if (scope === 'global') {
      globalRecentStory = recentStory;
      globalRecentStoryLoaded = true;
      return recentStory;
    }
    analysisSourcesState = {...analysisSourcesState, recentStory, notice: null};
    return recentStory;
  }

  async function persistRecentStorySettings(target) {
    clearPendingRecentStorySaves();
    const recentStory = updateRecentStoryState(target);
    render();
    await persistAnalysisSettings({recentStory});
  }

  async function persistRecentStoryRegexSettings(scope = 'character') {
    clearPendingRecentStorySaves();
    const recentStory = updateRecentStoryRegexState(scope);
    if (scope === 'global') {
      await persistRecentStoryGlobalSettings(recentStory);
      return;
    }
    render();
    await persistAnalysisSettings({recentStory});
  }

  async function addRecentStoryRegexRule(scope = 'character') {
    const current = readRecentStoryRegexSettings(scope);
    if (current.regex_rules.length >= 50) {
      if (scope === 'global') settingsState = {...settingsState, notice: null};
      else analysisSourcesState = {...analysisSourcesState, notice: null};
      notify(scope === 'global' ? '最多保存 50 条全局正则。' : '最多保存 50 条最近剧情规则。', 'warning', documentRef);
      render();
      return;
    }
    const next = normalizeRecentStorySettings({
      ...current,
      regex_rules: [...current.regex_rules, {pattern: '', type: 'extract', enabled: true}],
    });
    const recentStory = scope === 'global' ? {regex_rules: next.regex_rules} : next;
    if (scope === 'global') {
      globalRecentStory = recentStory;
      globalRecentStoryLoaded = true;
      analysisSourcesState = {...analysisSourcesState, notice: null};
    } else {
      analysisSourcesState = {...analysisSourcesState, recentStory, notice: null};
    }
    render();
    if (scope === 'global') await persistRecentStoryGlobalSettings(recentStory);
    else await persistAnalysisSettings({recentStory});
  }

  async function moveRecentStoryRegexRule(target, direction, scope = null) {
    const resolvedScope = scope ?? (String(target?.dataset?.bioweaveRecentStoryRegexScope ?? 'character').trim() === 'global'
      ? 'global'
      : 'character');
    const index = Number(target?.dataset?.bioweaveRecentStoryRegexIndex);
    if (!Number.isInteger(index)) return;
    const current = readRecentStoryRegexSettings(resolvedScope);
    const nextIndex = index + direction;
    if (index < 0 || index >= current.regex_rules.length || nextIndex < 0 || nextIndex >= current.regex_rules.length) return;
    const regexRules = [...current.regex_rules];
    [regexRules[index], regexRules[nextIndex]] = [regexRules[nextIndex], regexRules[index]];
    const normalized = normalizeRecentStorySettings({...current, regex_rules: regexRules});
    const recentStory = resolvedScope === 'global' ? {regex_rules: normalized.regex_rules} : normalized;
    if (resolvedScope === 'global') globalRecentStory = recentStory;
    else analysisSourcesState = {...analysisSourcesState, recentStory, notice: null};
    render();
    if (resolvedScope === 'global') await persistRecentStoryGlobalSettings(recentStory);
    else await persistAnalysisSettings({recentStory});
  }

  async function removeRecentStoryRegexRule(target, scope = null) {
    const resolvedScope = scope ?? (String(target?.dataset?.bioweaveRecentStoryRegexScope ?? 'character').trim() === 'global'
      ? 'global'
      : 'character');
    const index = Number(target?.dataset?.bioweaveRecentStoryRegexIndex);
    if (!Number.isInteger(index)) return;
    const current = readRecentStoryRegexSettings(resolvedScope);
    if (index < 0 || index >= current.regex_rules.length) return;
    const normalized = normalizeRecentStorySettings({
      ...current,
      regex_rules: current.regex_rules.filter((_, itemIndex) => itemIndex !== index),
    });
    const recentStory = resolvedScope === 'global' ? {regex_rules: normalized.regex_rules} : normalized;
    if (resolvedScope === 'global') globalRecentStory = recentStory;
    else analysisSourcesState = {...analysisSourcesState, recentStory, notice: null};
    render();
    if (resolvedScope === 'global') await persistRecentStoryGlobalSettings(recentStory);
    else await persistAnalysisSettings({recentStory});
  }

  async function toggleExternalMemory(target) {
    const key = String(target?.dataset?.bioweaveExternalMemory ?? '').trim();
    if (!key || target.disabled) return;
    const externalMemory = normalizeExternalMemorySettings({
      ...analysisSourcesState.externalMemory,
      [key]: Boolean(target.checked),
    });
    analysisSourcesState = {...analysisSourcesState, externalMemory, notice: null};
    render();
    await persistAnalysisSettings({externalMemory});
  }

  function setTheme(value) {
    const nextTheme = THEME_VALUES.has(value) ? value : 'tavern';
    writeTheme(storageRef, nextTheme);
    if (!root) return nextTheme;

    root.dataset.theme = nextTheme;
    root.querySelectorAll('[data-theme-choice]').forEach(button => {
      const active = button.dataset.themeChoice === nextTheme;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const label = root.querySelector('.bioweave-theme-label');
    if (label) label.textContent = themeLabel(nextTheme);
    return nextTheme;
  }

  function currentChatLabel() {
    try {
      return runtime.chat.current() ?? '当前 Chat';
    } catch {
      return '当前 Chat';
    }
  }

  function syncMoreMenu() {
    if (!root) return;
    const menu = root.querySelector('.bioweave-more-menu');
    if (menu) {
      menu.dataset.open = String(moreMenuOpen);
      menu.setAttribute('aria-hidden', String(!moreMenuOpen));
    }
    root.querySelectorAll('[data-bioweave-action="more"]').forEach(button => {
      button.setAttribute('aria-expanded', String(moreMenuOpen));
      button.setAttribute('aria-controls', 'bioweave-more-menu');
    });
  }

  function setMoreMenu(open) {
    moreMenuOpen = Boolean(open);
    syncMoreMenu();
  }

  function render() {
    if (!root || !isConnectedToDocument(root, documentRef)) return;
    if (route === 'settings') captureAnalysisSourceDisclosure();
    const page = pages[route] ?? pages.overview;
    if (!pages[route]) route = 'overview';
    if (route === 'settings') ensureAnalysisSourcesChat();
    if (route === 'world') loadWorldModelState();
    const main = root.querySelector('.bioweave-main');
    if (!main) return;
    const scrollPositions = captureScrollPositions(root);
    main.innerHTML = page[2]({
      characterId: focusedCharacterId,
      characterDetailTab,
      ...(route === 'settings' ? settingsState : {}),
      ...(route === 'settings' ? {
        worldbookSources: {
          ...analysisSourcesState,
          globalRecentStory,
          visibleSources: searchAnalysisSources(analysisSourcesState.sources, analysisSourcesState.search),
          selected: analysisSourcesState.selected,
        },
      } : {}),
      ...(route === 'world' ? {
        worldModel: worldModelState.model,
        worldModelMeta: worldModelState.meta,
        worldModelBusy: worldModelState.busy,
        selectedSpeciesIndex: worldModelState.selectedSpeciesIndex,
        selectedTypeIndex: worldModelState.selectedTypeIndex,
        editingSection: worldModelState.editingSection,
        sectionDraft: worldModelState.sectionDraft,
        worldModelNotice: worldModelState.notice,
      } : {}),
    });
    restoreScrollPositions(root, scrollPositions);
    root.querySelectorAll('.bioweave-chat-scope').forEach(node => {
      node.textContent = currentChatLabel();
    });
    root.querySelectorAll('[data-route]').forEach(button => {
      const active = button.dataset.route === route && !focusedCharacterId;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    syncAnalysisWorldbookToggles();
    syncAnalysisCharacterOpeningToggles();
    syncMoreMenu();
    if (route === 'settings' && !settingsState.loaded && !settingsState.loading) void loadSettings();
    if (route === 'settings' && !analysisSourcesState.loaded && !analysisSourcesState.loading) void loadAnalysisSourcesState();
  }

  function go(nextRoute) {
    if (!pages[nextRoute]) return false;
    if (nextRoute === 'settings' && route !== 'settings') refreshAnalysisChatSettings();
    captureAnalysisSourceDisclosure();
    route = nextRoute;
    focusedCharacterId = null;
    characterDetailTab = 'state';
    setMoreMenu(false);
    render();
    return true;
  }

  function openCharacter(characterId) {
    const nextId = String(characterId ?? '').trim();
    if (!nextId) return;
    route = 'characters';
    focusedCharacterId = nextId;
    characterDetailTab = 'state';
    setMoreMenu(false);
    render();
  }

  function setCharacterTab(tab) {
    const allowedTabs = new Set(['state', 'events', 'projection', 'relations', 'notes']);
    if (!focusedCharacterId || !allowedTabs.has(tab)) return;
    characterDetailTab = tab;
    render();
  }

  function settingsOperationError(error) {
    const errorCode = String(error?.code ?? error?.message ?? '');
    const messages = {
      ST_EXTENSION_SETTINGS_UNAVAILABLE: '全局设置不可用，请确认 SillyTavern extensionSettings 已加载。',
      ST_SECRET_STORAGE_UNAVAILABLE: 'Secret Store 不可用，API Key 未保存。',
      ST_SECRET_WRITE_FAILED: 'Secret Store 写入失败，原有配置保持不变。',
      ST_SECRET_WRITE_INVALID_RESPONSE: 'Secret Store 返回无效引用，API Key 未保存。',
      ST_SECRET_DELETE_FAILED: 'Secret 清理失败，但 API 配置引用已安全移除。',
      API_PROFILE_NOT_FOUND: '找不到该 API 配置。',
      API_PROFILE_INVALID: '请填写有效的 API URL 和 Model。',
      API_MODELS_EMPTY: '未找到可用模型，请检查 API 是否提供 /models 接口。',
      API_MODELS_RESPONSE_INVALID: '模型列表响应无效，请检查 API 地址。',
      API_MODELS_HTTP_ERROR: '模型列表请求失败，请检查 URL、Key 和权限。',
      API_MODELS_FETCH_FAILED: '模型列表请求失败，请检查网络和 API 地址。',
      API_MODELS_FETCH_UNAVAILABLE: '模型列表请求不可用，请确认 SillyTavern API 已加载。',
      WORLD_ANALYSIS_PROMPT_SAVE_FAILED: '世界分析提示词保存失败，当前内容仍保留。',
      API_SOURCE_INVALID: 'API 来源无效。',
      API_ASSIGNMENT_INVALID: '任务分配无效。',
      ST_METADATA_STORAGE_UNAVAILABLE: '全局设置不可用，请稍后重试。',
      ST_MODEL_FETCH_UNAVAILABLE: '模型列表接口不可用，请确认 AI Client 已加载。',
      API_MODELS_EMPTY: '未找到可用模型；仍可手动填写 Model。',
      API_MODELS_RESPONSE_INVALID: '模型列表响应无效，请检查 API 地址。',
      API_MODELS_FETCH_UNAVAILABLE: '模型列表请求不可用，请确认网络或宿主 API。',
      API_MODELS_HTTP_ERROR: '模型列表请求失败，请检查地址和权限。',
      API_MODELS_FETCH_FAILED: '模型列表请求失败，请检查地址和权限。',
      REQUEST_TIMEOUT: '模型列表请求超时，请检查地址或延长超时设置。',
      REQUEST_ABORTED: '模型列表请求已取消。',
    };
    const matchedCode = Object.keys(messages).find(code => errorCode === code || errorCode.startsWith(`${code}_`));
    return messages[matchedCode] ?? '设置操作失败，请检查 SillyTavern 状态后重试。';
  }

  function profileDraftKey(profileId) {
    const id = String(profileId ?? '').trim();
    return id || '__new__';
  }

  function profileDraftFrom(profile) {
    return {
      profile_id: profile?.profile_id ?? '',
      name: profile?.name ?? '',
      provider: profile?.provider ?? DEFAULT_API_PROFILE.provider,
      api_url: profile?.api_url ?? '',
      model: profile?.model ?? '',
      context_size: profile?.context_size ?? DEFAULT_API_PROFILE.context_size,
      max_output_tokens: profile?.max_output_tokens ?? DEFAULT_API_PROFILE.max_output_tokens,
      temperature: profile?.temperature ?? DEFAULT_API_PROFILE.temperature,
      api_key: '',
      clear_secret: false,
    };
  }

  function currentDraft(profile) {
    const key = profileDraftKey(profile?.profile_id);
    return settingsState.drafts?.[key] ?? profileDraftFrom(profile);
  }

  function latestDraftFor(key, fallback) {
    const draft = settingsState.drafts?.[key];
    return draft && typeof draft === 'object' ? draft : fallback;
  }

  function resetModelPickerState() {
    modelRefreshSequence += 1;
    return {
      modelList: [],
      modelListProfileKey: null,
      modelSearch: '',
      modelRefreshBusy: false,
    };
  }

  function formField(form, name) {
    return form?.elements?.namedItem?.(name)
      ?? form?.querySelector?.(`[name="${name}"]`)
      ?? null;
  }

  function readSettingsForm(form) {
    const value = name => formField(form, name)?.value ?? '';
    return {
      profile_id: value('profile_id'),
      name: value('name'),
      provider: value('provider'),
      api_url: value('api_url'),
      model: value('model'),
      api_key: value('api_key'),
      clear_secret: Boolean(formField(form, 'clear_secret')?.checked),
    };
  }

  function captureSettingsDraft(form = root?.querySelector?.('[data-bioweave-settings-form]')) {
    if (!form) return null;
    const draft = readSettingsForm(form);
    const key = profileDraftKey(draft.profile_id || settingsState.editingProfile?.profile_id);
    settingsState = {
      ...settingsState,
      editingDraft: draft,
      drafts: {...settingsState.drafts, [key]: draft},
    };
    return draft;
  }

  function readApiRequestSettingsForm() {
    const timeoutField = root?.querySelector?.('[data-bioweave-api-timeout]');
    const retryField = root?.querySelector?.('[data-bioweave-api-retry-count]');
    const timeoutSeconds = String(timeoutField?.value ?? '').trim();
    const retryCount = String(retryField?.value ?? '').trim();
    return normalizeApiRequestSettings({
      timeout: timeoutSeconds === '' ? undefined : Number(timeoutSeconds) * 1000,
      retry_count: retryCount === '' ? undefined : Number(retryCount),
    });
  }

  function captureApiRequestSettingsDraft() {
    const hasFields = root?.querySelector?.('[data-bioweave-api-timeout], [data-bioweave-api-retry-count]');
    if (!hasFields) return settingsState.apiRequestDraft ?? settingsState.apiRequestSettings;
    const draft = readApiRequestSettingsForm();
    settingsState = {...settingsState, apiRequestDraft: draft};
    return draft;
  }

  async function saveApiRequestSettings() {
    const draft = captureApiRequestSettingsDraft();
    if (typeof profileStore.saveApiRequestSettings !== 'function') {
      settingsState = {...settingsState, notice: null};
      notify('当前宿主不支持保存全局请求设置。', 'error', documentRef);
      render();
      return;
    }
    settingsState = {...settingsState, notice: null};
    try {
      const saved = await profileStore.saveApiRequestSettings(draft);
      settingsState = {
        ...settingsState,
        apiRequestSettings: normalizeApiRequestSettings(saved),
        apiRequestDraft: null,
        notice: null,
      };
      notify('请求设置已即时保存。', 'success', documentRef);
    } catch (error) {
      settingsState = {
        ...settingsState,
        apiRequestDraft: draft,
        notice: null,
      };
      notify(settingsOperationError(error), 'error', documentRef);
    }
    render();
  }

  function readWorldAnalysisPromptForm() {
    const field = key => root?.querySelector?.(`[data-bioweave-world-analysis-prompt-field="${key}"]`);
    return normalizeWorldAnalysisPrompt({
      system_top: field('system_top')?.value ?? settingsState.worldAnalysisPrompt?.system_top,
      task: field('task')?.value ?? settingsState.worldAnalysisPrompt?.task,
      input_prefix: field('input_prefix')?.value ?? settingsState.worldAnalysisPrompt?.input_prefix,
      input_suffix: field('input_suffix')?.value ?? settingsState.worldAnalysisPrompt?.input_suffix,
      system_bottom: field('system_bottom')?.value ?? settingsState.worldAnalysisPrompt?.system_bottom,
      // 保留旧设置中的内部标签兼容性，但不再向用户展示或提供编辑入口。
      labels: settingsState.worldAnalysisPrompt?.labels,
    });
  }

  function captureWorldAnalysisPromptDraft() {
    const hasForm = root?.querySelector?.('[data-bioweave-world-analysis-prompt-settings]');
    if (!hasForm) return settingsState.worldAnalysisPromptDraft ?? settingsState.worldAnalysisPrompt;
    const draft = readWorldAnalysisPromptForm();
    settingsState = {...settingsState, worldAnalysisPromptDraft: draft};
    return draft;
  }

  async function saveWorldAnalysisPrompt() {
    const draft = captureWorldAnalysisPromptDraft();
    if (typeof profileStore.saveWorldAnalysisPrompt !== 'function') {
      settingsState = {...settingsState, notice: null};
      notify('当前宿主不支持保存世界分析提示词。', 'error', documentRef);
      render();
      return;
    }
    settingsState = {...settingsState, busy: true, notice: null};
    try {
      const saved = await profileStore.saveWorldAnalysisPrompt(draft);
      settingsState = {
        ...settingsState,
        busy: false,
        worldAnalysisPrompt: normalizeWorldAnalysisPrompt(saved),
        worldAnalysisPromptDraft: null,
        notice: null,
      };
      notify('世界分析提示词设置已保存。', 'success', documentRef);
    } catch (error) {
      settingsState = {
        ...settingsState,
        busy: false,
        worldAnalysisPromptDraft: draft,
        notice: null,
      };
      notify(settingsOperationError(error), 'error', documentRef);
    }
    render();
  }

  function editProfile(profileId) {
    captureSettingsDraft();
    const id = String(profileId ?? '').trim();
    const profile = profileStore.getProfile?.(id) ?? settingsState.profiles?.[id] ?? null;
    if (!profile) {
      settingsState = {...settingsState, notice: null};
      notify('找不到该 API 配置。', 'error', documentRef);
      render();
      return;
    }
    route = 'settings';
    focusedCharacterId = null;
    settingsState = {
      ...settingsState,
      ...resetModelPickerState(),
      editingProfile: profile,
      editingDraft: currentDraft(profile),
      testResult: null,
      notice: null,
    };
    render();
  }

  function startNewProfile() {
    captureSettingsDraft();
    route = 'settings';
    focusedCharacterId = null;
    settingsState = {
      ...settingsState,
      ...resetModelPickerState(),
      editingProfile: null,
      editingDraft: currentDraft(null),
      testResult: null,
      notice: null,
    };
    render();
  }

  function cancelProfileEdit() {
    const drafts = {...settingsState.drafts};
    delete drafts[profileDraftKey(settingsState.editingProfile?.profile_id)];
    settingsState = {
      ...settingsState,
      ...resetModelPickerState(),
      editingProfile: undefined,
      editingDraft: undefined,
      drafts,
      testResult: null,
      notice: null,
      busy: false,
    };
    render();
  }

  async function saveSettingsForm() {
    const form = root?.querySelector?.('[data-bioweave-settings-form]');
    if (!form) return;
    if (typeof profileStore.saveProfile !== 'function') {
      settingsState = {...settingsState, notice: null};
      notify('当前宿主不支持保存 API 配置。', 'error', documentRef);
      render();
      return;
    }
    const raw = captureSettingsDraft(form);
    const draftKey = profileDraftKey(raw.profile_id);
    settingsState = {...settingsState, busy: true, notice: null};
    try {
      const saved = await profileStore.saveProfile(raw);
      updateSettingsState();
      const savedDraft = profileDraftFrom(saved);
      const drafts = {...settingsState.drafts, [saved.profile_id]: savedDraft};
      delete drafts.__new__;
      const modelPickerState = settingsState.modelListProfileKey === draftKey
        ? {modelListProfileKey: saved.profile_id}
        : {};
      settingsState = {
        ...settingsState,
        ...modelPickerState,
        editingProfile: saved,
        editingDraft: savedDraft,
        drafts,
        testResult: null,
        notice: null,
      };
      notify('API 配置已保存；API 密钥仅保存在 Secret Store。', 'success', documentRef);
      render();
    } catch (error) {
      const latestDraft = latestDraftFor(draftKey, raw);
      settingsState = {
        ...settingsState,
        editingDraft: latestDraft,
        drafts: {...settingsState.drafts, [draftKey]: latestDraft},
        notice: null,
      };
      notify(settingsOperationError(error), 'error', documentRef);
    } finally {
      settingsState = {...settingsState, busy: false};
      render();
    }
  }

  async function testSettingsForm() {
    const form = root?.querySelector?.('[data-bioweave-settings-form]');
    if (!form) return;
    const raw = captureSettingsDraft(form);
    const draftKey = profileDraftKey(raw.profile_id);
    const runTest = typeof apiClient === 'function' ? apiClient : apiClient.testProfile;
    if (typeof runTest !== 'function') {
      const errorMessage = '测试连接不可用，请确认 SillyTavern API 已加载。';
      settingsState = {...settingsState, notice: null, testResult: {ok: false, error: errorMessage}};
      notify(errorMessage, 'error', documentRef);
      render();
      return;
    }

    settingsState = {...settingsState, busy: true, notice: null, testResult: null};
    try {
      const context = runtime.st?.getContext?.() ?? hostContextForApp();
      const requestSettings = settingsState.apiRequestDraft ?? settingsState.apiRequestSettings;
      const result = typeof profileStore.withTestProfile === 'function'
        ? await profileStore.withTestProfile(raw, profile => runTest(profile, {context, requestSettings}))
        : await runTest(raw, {context, requestSettings});
      settingsState = {
        ...settingsState,
        editingDraft: latestDraftFor(draftKey, raw),
        drafts: {...settingsState.drafts, [draftKey]: latestDraftFor(draftKey, raw)},
        testResult: result,
        notice: null,
      };
    } catch (error) {
      settingsState = {
        ...settingsState,
        editingDraft: latestDraftFor(draftKey, raw),
        drafts: {...settingsState.drafts, [draftKey]: latestDraftFor(draftKey, raw)},
        testResult: {ok: false, error: settingsOperationError(error)},
        notice: null,
      };
      notify(settingsOperationError(error), 'error', documentRef);
    } finally {
      settingsState = {...settingsState, busy: false};
      render();
    }
  }

  function activeSettingsDraftKey() {
    return profileDraftKey(settingsState.editingDraft?.profile_id || settingsState.editingProfile?.profile_id);
  }

  function applyModelSearch(query) {
    if (!root) return;
    const normalizedQuery = String(query ?? '').trim().toLocaleLowerCase();
    const items = [...(root.querySelectorAll?.('[data-bioweave-model-item]') ?? [])];
    let visibleCount = 0;
    for (const item of items) {
      const model = String(item.dataset?.modelValue ?? item.textContent ?? '').toLocaleLowerCase();
      const visible = model.includes(normalizedQuery);
      item.hidden = !visible;
      item.setAttribute?.('aria-hidden', String(!visible));
      if (visible) visibleCount += 1;
    }
    const empty = root.querySelector?.('[data-bioweave-model-empty]');
    if (empty) empty.hidden = items.length > 0 && visibleCount > 0;
  }

  function toggleModelPicker(target) {
    const picker = target?.closest?.('[data-bioweave-model-picker]');
    const dropdown = picker?.querySelector?.('[data-bioweave-model-dropdown]');
    if (!picker || !dropdown) return false;
    const open = dropdown.hidden;
    dropdown.hidden = !open;
    target.setAttribute?.('aria-expanded', String(open));
    return true;
  }

  function closeModelPickers(target = root) {
    const pickers = target?.querySelectorAll?.('[data-bioweave-model-picker]') ?? [];
    for (const picker of pickers) closeModelPicker(picker);
  }

  function selectModel(target) {
    const model = String(target?.dataset?.modelValue ?? '').trim();
    if (!model) return;
    const form = root?.querySelector?.('[data-bioweave-settings-form]');
    const input = formField(form, 'model');
    if (!input) return;
    input.value = model;
    captureSettingsDraft(form);
    root.querySelectorAll?.('[data-bioweave-model-item]').forEach(item => {
      const selected = item.dataset?.modelValue === model;
      item.classList?.toggle('is-selected', selected);
      item.setAttribute?.('aria-selected', String(selected));
      const marker = item.querySelector?.('small');
      if (marker) marker.textContent = selected ? '当前选择' : '';
    });
    const picker = target.closest?.('[data-bioweave-model-picker]');
    const triggerLabel = picker?.querySelector?.('[data-bioweave-model-trigger-label]');
    if (triggerLabel) triggerLabel.textContent = model;
    else picker?.querySelector?.('[data-bioweave-model-trigger]')?.replaceChildren?.(model);
    closeModelPicker(target);
  }

  async function refreshModels() {
    if (settingsState.modelRefreshBusy) return;
    const form = root?.querySelector?.('[data-bioweave-settings-form]');
    if (!form) return;
    const raw = captureSettingsDraft(form);
    const fetchModels = typeof apiClient === 'function' ? apiClient.fetchModels : apiClient?.fetchModels;
    if (typeof fetchModels !== 'function') {
      settingsState = {...settingsState, notice: null};
      notify('模型列表接口不可用，请确认 AI Client 已加载。', 'error', documentRef);
      render();
      return;
    }

    const draftKey = profileDraftKey(raw.profile_id || settingsState.editingProfile?.profile_id);
    const requestId = ++modelRefreshSequence;
    const existingModels = settingsState.modelListProfileKey === draftKey ? settingsState.modelList : [];
    settingsState = {
      ...settingsState,
      modelList: existingModels,
      modelListProfileKey: draftKey,
      modelRefreshBusy: true,
      notice: null,
    };
    render();

    try {
      const context = runtime.st?.getContext?.() ?? hostContextForApp();
      if (typeof profileStore.withTestProfile !== 'function') throw new Error('ST_MODEL_FETCH_UNAVAILABLE');
      const models = await profileStore.withTestProfile(
        raw,
        profile => fetchModels.call(apiClient, profile, {
          context,
          requestSettings: settingsState.apiRequestDraft ?? settingsState.apiRequestSettings,
        }),
        {requireModel: false},
      );
      if (requestId !== modelRefreshSequence || activeSettingsDraftKey() !== draftKey) return;
      const nextModels = normalizeModelList(models);
      const latestDraft = latestDraftFor(draftKey, raw);
      settingsState = {
        ...settingsState,
        modelList: nextModels,
        modelListProfileKey: draftKey,
        editingDraft: latestDraft,
        drafts: {...settingsState.drafts, [draftKey]: latestDraft},
        notice: null,
      };
      notify(
        nextModels.length ? '模型列表已刷新。' : '未找到可用模型；仍可手动填写 Model。',
        nextModels.length ? 'info' : 'warning',
        documentRef,
      );
    } catch (error) {
      if (requestId !== modelRefreshSequence || activeSettingsDraftKey() !== draftKey) return;
      const latestDraft = latestDraftFor(draftKey, raw);
      settingsState = {
        ...settingsState,
        editingDraft: latestDraft,
        drafts: {...settingsState.drafts, [draftKey]: latestDraft},
        notice: null,
      };
      notify(settingsOperationError(error), 'error', documentRef);
    } finally {
      if (requestId !== modelRefreshSequence || activeSettingsDraftKey() !== draftKey) return;
      settingsState = {...settingsState, modelRefreshBusy: false};
      render();
    }
  }

  function hostContextForApp() {
    return hostPopupContext();
  }

  async function removeProfile(profileId) {
    const id = String(profileId ?? '').trim();
    if (!id) return;
    if (typeof profileStore.deleteProfile !== 'function') {
      settingsState = {...settingsState, notice: null};
      notify('当前宿主不支持删除 API 配置。', 'error', documentRef);
      render();
      return;
    }
    if (!await confirmWithPopup('删除 API 配置', '确定删除此 API 配置并清理关联 Secret 引用吗？')) return;
    settingsState.busy = true;
    try {
      await profileStore.deleteProfile(id);
      updateSettingsState();
      const drafts = {...settingsState.drafts};
      delete drafts[id];
      const deletedCurrentProfile = settingsState.editingProfile?.profile_id === id;
      settingsState = {
        ...settingsState,
        editingProfile: deletedCurrentProfile ? undefined : settingsState.editingProfile,
        editingDraft: deletedCurrentProfile ? undefined : settingsState.editingDraft,
        drafts,
        testResult: null,
        notice: null,
      };
      notify('API 配置已删除；关联 Secret 引用已清理。', 'success', documentRef);
    } catch (error) {
      settingsState = {...settingsState, notice: null};
      notify(settingsOperationError(error), 'error', documentRef);
    } finally {
      settingsState.busy = false;
      render();
    }
  }

  async function changeAssignment(target) {
    const slot = target?.dataset?.bioweaveAssignment;
    if (!slot) return;
    if (typeof profileStore.setAssignment !== 'function') {
      settingsState = {...settingsState, notice: null};
      notify('当前宿主不支持保存任务 API 分配。', 'error', documentRef);
      render();
      return;
    }
    try {
      const value = await profileStore.setAssignment(slot, target.value);
      settingsState = {
        ...settingsState,
        assignments: {...settingsState.assignments, [slot]: value},
        notice: null,
      };
      notify('任务 API 分配已保存。', 'success', documentRef);
    } catch (error) {
      settingsState = {...settingsState, notice: null};
      notify(settingsOperationError(error), 'error', documentRef);
    }
    render();
  }

  async function changeApiSource(target) {
    const value = target?.value;
    try {
      const saved = typeof profileStore.setApiSource === 'function'
        ? await profileStore.setApiSource(value)
        : value;
      settingsState = {...settingsState, apiSource: saved, notice: null};
      notify('默认 API 来源已保存。', 'success', documentRef);
    } catch (error) {
      settingsState = {...settingsState, notice: null};
      notify(settingsOperationError(error), 'error', documentRef);
    }
    render();
  }

  async function changeDefaultProfile(target) {
    try {
      const saved = typeof profileStore.setDefaultProfile === 'function'
        ? await profileStore.setDefaultProfile(target?.value)
        : target?.value || null;
      settingsState = {...settingsState, defaultProfileId: saved, notice: null};
      notify('默认 API 配置已保存。', 'success', documentRef);
    } catch (error) {
      settingsState = {...settingsState, notice: null};
      notify(settingsOperationError(error), 'error', documentRef);
    }
    render();
  }

  function handleSettingsInput(event) {
    if (!root?.contains(event.target)) return;
    const target = event.target;
    if (target.closest?.('[data-bioweave-world-section-form]')) {
      captureWorldModelSectionDraft();
      return;
    }
    if (target?.dataset?.bioweaveAnalysisSourceSearch !== undefined) {
      analysisSourcesState = {
        ...analysisSourcesState,
        search: String(target.value ?? ''),
      };
      applyAnalysisSourceSearch(target.value);
      return;
    }
    if (target?.dataset?.bioweaveRecentStoryRegexPattern !== undefined) {
      const scope = target?.dataset?.bioweaveRecentStoryRegexScope === 'global' ? 'global' : 'character';
      const recentStory = updateRecentStoryRegexState(scope);
      if (scope === 'global') queueRecentStoryGlobalSettingsSave(recentStory);
      else queueRecentStorySettingsSave(recentStory);
      return;
    }
    if (target?.dataset?.bioweaveRecentStoryFloorCount !== undefined) {
      queueRecentStorySettingsSave(updateRecentStoryState(target));
      return;
    }
    if (target?.dataset?.bioweaveWorldAnalysisPromptField !== undefined
      || target?.dataset?.bioweaveWorldAnalysisLabel !== undefined) {
      captureWorldAnalysisPromptDraft();
      return;
    }
    if (target?.dataset?.bioweaveModelSearch !== undefined) {
      captureSettingsDraft();
      settingsState = {...settingsState, modelSearch: String(target.value ?? '')};
      applyModelSearch(target.value);
      return;
    }
    if (target?.dataset?.bioweaveApiTimeout !== undefined
      || target?.dataset?.bioweaveApiRetryCount !== undefined) {
      captureApiRequestSettingsDraft();
      return;
    }
    if (target.closest?.('[data-bioweave-settings-form]')) captureSettingsDraft();
  }

  function handleRuntimeEvent(event) {
    if (event?.chatChanged || event?.type === 'CHAT_CHANGED') {
      clearPendingRecentStorySaves();
      analysisSourceRequestSequence += 1;
      analysisSourceSaveSequence += 1;
      analysisSourcesState = createAnalysisSourcesState();
      worldModelState = createWorldModelState();
      clearAnalysisPreview();
      route = 'overview';
      focusedCharacterId = null;
      characterDetailTab = 'state';
      setMoreMenu(false);
    }
    if (root?.dataset.open === 'true') render();
  }

  async function handleClick(event) {
    if (!root?.contains(event.target)) return;
    captureAnalysisSourceDisclosure();
    if (handleAnalysisParentToggleClick(event)) return;
    if (event.target.closest?.('[data-bioweave-world-analysis-prompt-settings]')) {
      captureWorldAnalysisPromptDraft();
    }
    const analysisDisclosure = event.target.closest?.('[data-bioweave-analysis-worldbook-expand], [data-bioweave-analysis-character-expand]');
    if (analysisDisclosure) {
      // 展开按钮只切换对应 details，不改变任何来源选择。
      event.preventDefault();
      event.stopPropagation();
      const details = analysisDisclosure.closest?.('details');
      if (details) {
        details.open = !details.open;
        analysisDisclosure.setAttribute('aria-expanded', String(details.open));
        const prefix = details.open ? '收起' : '展开';
        analysisDisclosure.setAttribute('aria-label', analysisDisclosure.dataset.bioweaveAnalysisWorldbookExpand !== undefined
          ? prefix + '世界书条目'
          : prefix + '开场白');
        captureAnalysisSourceDisclosure();
        if (details.open && analysisDisclosure.dataset.bioweaveAnalysisWorldbookExpand !== undefined) {
          const sourceId = String(analysisDisclosure.dataset.bioweaveAnalysisWorldbookExpand ?? '').trim();
          const source = analysisSourcesState.sources.find(item => item.source_id === sourceId);
          if (source && !source.content_loaded) void loadWorldbookSourceForUi(sourceId);
        }
      }
      return;
    }
    const clickedPicker = event.target.closest?.('[data-bioweave-model-picker]');
    const clickedDropdown = event.target.closest?.('[data-bioweave-model-dropdown]');
    const target = event.target.closest?.('[data-route], [data-theme-choice], [data-character-id], [data-character-tab], [data-back-to-characters], [data-bioweave-action], [data-bioweave-model-item], [data-bioweave-model-trigger]');
    if (!target) {
      if (!clickedPicker || !clickedDropdown) closeModelPickers();
      if (moreMenuOpen) setMoreMenu(false);
      return;
    }
    if (!target.closest?.('[data-bioweave-model-picker]')) closeModelPickers();

    if (target.dataset.bioweaveModelTrigger !== undefined) {
      event.preventDefault();
      toggleModelPicker(target);
      return;
    }

    if (target.dataset.bioweaveModelItem !== undefined) {
      event.preventDefault();
      selectModel(target);
      return;
    }

    const action = target.dataset.bioweaveAction;
    if (action === 'open-analysis-debug') {
      event.preventDefault();
      await openAnalysisDebugPopup({usePromptDraft: true});
      return;
    }
    if (action === 'new-profile') {
      event.preventDefault();
      startNewProfile();
      return;
    }
    if (action === 'edit-profile') {
      event.preventDefault();
      editProfile(target.dataset.profileId);
      return;
    }
    if (action === 'delete-profile') {
      event.preventDefault();
      await removeProfile(target.dataset.profileId);
      return;
    }
    if (action === 'cancel-profile') {
      event.preventDefault();
      cancelProfileEdit();
      return;
    }
    if (action === 'save-profile') {
      event.preventDefault();
      await saveSettingsForm(false);
      return;
    }
    if (action === 'test-profile') {
      event.preventDefault();
      await testSettingsForm();
      return;
    }
    if (action === 'save-world-analysis-prompt') {
      event.preventDefault();
      await saveWorldAnalysisPrompt();
      return;
    }
    if (action === 'refresh-models') {
      event.preventDefault();
      await refreshModels();
      return;
    }
    if (action === 'refresh-analysis-sources') {
      event.preventDefault();
      await loadAnalysisSourcesState({forceRefresh: true});
      return;
    }
    if (action === 'world-model-reanalyze') {
      event.preventDefault();
      if (worldModelState.busy) await requestAbortWorldModelAnalysis();
      else await analyzeWorldModel();
      return;
    }
    if (action === 'world-model-view-input') {
      event.preventDefault();
      await openAnalysisDebugPopup();
      return;
    }
    if (action === 'world-model-select-species') {
      event.preventDefault();
      await selectWorldModelType(Number(target.dataset.bioweaveWorldSpeciesIndex), null);
      return;
    }
    if (action === 'world-model-select-type') {
      event.preventDefault();
      await selectWorldModelType(
        Number(target.dataset.bioweaveWorldSpeciesIndex),
        Number(target.dataset.bioweaveWorldTypeIndex),
      );
      return;
    }
    if (action === 'world-model-focus-selector') {
      event.preventDefault();
      const selector = root?.querySelector?.('.bioweave-world-model-species-selector');
      selector?.scrollIntoView?.({behavior: 'smooth', block: 'nearest'});
      selector?.querySelector?.('[aria-pressed="true"]')?.focus?.({preventScroll: true});
      return;
    }
    if (action === 'world-model-edit-section') {
      event.preventDefault();
      await beginWorldModelSectionEdit(String(target.dataset.bioweaveWorldSection ?? ''));
      return;
    }
    if (action === 'world-model-cancel-section') {
      event.preventDefault();
      cancelWorldModelSectionEdit();
      return;
    }
    if (action === 'world-model-save-section') {
      event.preventDefault();
      await saveWorldModelSection();
      return;
    }
    if (action === 'world-model-add-row') {
      event.preventDefault();
      const section = String(target.dataset.bioweaveWorldSection ?? '');
      if (section === 'exceptions') {
        updateWorldModelSectionDraft(value => [...(Array.isArray(value) ? value : []), {
          statement: null,
          applies_to: null,
          evidence: null,
        }]);
      } else if (section === 'special_rules' || section === 'unknowns') {
        updateWorldModelSectionDraft(value => [...(Array.isArray(value) ? value : []), '']);
      }
      return;
    }
    if (action === 'world-model-remove-row') {
      event.preventDefault();
      const section = String(target.dataset.bioweaveWorldSection ?? '');
      const index = Number(target.dataset.bioweaveWorldRowIndex);
      if (!Number.isInteger(index) || index < 0) return;
      updateWorldModelSectionDraft(value => (Array.isArray(value) ? value.filter((_, itemIndex) => itemIndex !== index) : value));
      return;
    }
    if (action === 'select-all-analysis-sources') {
      event.preventDefault();
      await setAllAnalysisSources(true);
      return;
    }
    if (action === 'select-none-analysis-sources') {
      event.preventDefault();
      await setAllAnalysisSources(false);
      return;
    }
    if (action === 'add-recent-story-regex') {
      event.preventDefault();
      await addRecentStoryRegexRule(target.dataset.bioweaveRecentStoryRegexScope === 'global' ? 'global' : 'character');
      return;
    }
    if (action === 'move-recent-story-regex-up') {
      event.preventDefault();
      await moveRecentStoryRegexRule(target, -1, target.dataset.bioweaveRecentStoryRegexScope === 'global' ? 'global' : 'character');
      return;
    }
    if (action === 'move-recent-story-regex-down') {
      event.preventDefault();
      await moveRecentStoryRegexRule(target, 1, target.dataset.bioweaveRecentStoryRegexScope === 'global' ? 'global' : 'character');
      return;
    }
    if (action === 'remove-recent-story-regex') {
      event.preventDefault();
      await removeRecentStoryRegexRule(target, target.dataset.bioweaveRecentStoryRegexScope === 'global' ? 'global' : 'character');
      return;
    }

    if (target.dataset.characterId) {
      event.preventDefault();
      openCharacter(target.dataset.characterId);
      return;
    }
    if (target.dataset.characterTab) {
      event.preventDefault();
      setCharacterTab(target.dataset.characterTab);
      return;
    }
    if (target.dataset.backToCharacters !== undefined) {
      event.preventDefault();
      focusedCharacterId = null;
      characterDetailTab = 'state';
      route = 'characters';
      render();
      return;
    }
    if (target.dataset.route) {
      event.preventDefault();
      go(target.dataset.route);
      return;
    }
    if (target.dataset.themeChoice) {
      event.preventDefault();
      setTheme(target.dataset.themeChoice);
      return;
    }
    if (target.dataset.bioweaveAction === 'close') {
      event.preventDefault();
      closeBioWeave();
      return;
    }
    if (target.dataset.bioweaveAction === 'more') {
      event.preventDefault();
      setMoreMenu(!moreMenuOpen);
    }
  }

  async function handleChange(event) {
    if (!root?.contains(event.target)) return;
    captureAnalysisSourceDisclosure();
    if (event.target.closest?.('[data-bioweave-world-section-form]')) {
      captureWorldModelSectionDraft();
      return;
    }
    const characterOpeningToggle = event.target.closest?.('[data-bioweave-analysis-character-opening-toggle]');
    if (characterOpeningToggle) {
      await toggleCharacterCardOpenings(characterOpeningToggle);
      return;
    }
    const worldbookToggle = event.target.closest?.('[data-bioweave-analysis-worldbook-toggle]');
    if (worldbookToggle) {
      await toggleWorldbookEntries(worldbookToggle);
      return;
    }
    const analysisSource = event.target.closest?.('[data-bioweave-analysis-source]');
    if (analysisSource) {
      await toggleAnalysisSource(analysisSource);
      return;
    }
    if (event.target?.dataset?.bioweaveRecentStoryFloorCount !== undefined
      || event.target?.dataset?.bioweaveRecentStoryUserRegex !== undefined) {
      await persistRecentStorySettings(event.target);
      return;
    }
    if (event.target?.dataset?.bioweaveRecentStoryRegexPattern !== undefined
      || event.target?.dataset?.bioweaveRecentStoryRegexType !== undefined
      || event.target?.dataset?.bioweaveRecentStoryRegexEnabled !== undefined) {
      await persistRecentStoryRegexSettings(event.target?.dataset?.bioweaveRecentStoryRegexScope === 'global' ? 'global' : 'character');
      return;
    }
    if (event.target?.dataset?.bioweaveExternalMemory !== undefined) {
      await toggleExternalMemory(event.target);
      return;
    }
    if (event.target?.dataset?.bioweaveApiTimeout !== undefined
      || event.target?.dataset?.bioweaveApiRetryCount !== undefined) {
      await saveApiRequestSettings();
      return;
    }
    if (event.target.closest?.('[data-bioweave-settings-form]')) captureSettingsDraft();
    const source = event.target.closest?.('[data-bioweave-api-source]');
    if (source) {
      await changeApiSource(source);
      return;
    }
    const defaultProfile = event.target.closest?.('[data-bioweave-default-profile]');
    if (defaultProfile) {
      await changeDefaultProfile(defaultProfile);
      return;
    }
    const target = event.target.closest?.('[data-bioweave-assignment]');
    if (!target) return;
    await changeAssignment(target);
  }

  function handleSubmit(event) {
    if (event.target?.closest?.('[data-bioweave-world-section-form]')) {
      event.preventDefault();
    }
  }

  function handleOverlayClick(event) {
    if (event.target === overlay) closeBioWeave();
  }

  function handleKeydown(event) {
    if (event.key !== 'Escape' || root?.dataset.open !== 'true') return;
    event.preventDefault();
    if (moreMenuOpen) {
      setMoreMenu(false);
    } else {
      closeBioWeave();
    }
  }

  function teardownRootListeners(node) {
    if (!node) return;
    node.removeEventListener?.('click', handleClick);
    node.removeEventListener?.('input', handleSettingsInput);
    node.removeEventListener?.('change', handleChange);
    node.removeEventListener?.('submit', handleSubmit);
    node.removeEventListener?.('keydown', handleKeydown);
    const surface = overlay;
    surface?.removeEventListener?.('click', handleOverlayClick);
    const registeredUnsubscribe = node[APP_RUNTIME_UNSUBSCRIBE_PROPERTY];
    if (typeof registeredUnsubscribe === 'function') {
      registeredUnsubscribe();
      if (registeredUnsubscribe === unsubscribeRuntime) unsubscribeRuntime = null;
    }
    delete node[APP_RUNTIME_UNSUBSCRIBE_PROPERTY];
    delete node[APP_RUNTIME_DESTROY_PROPERTY];
    if (node[APP_TEARDOWN_PROPERTY] === teardownRootListeners) delete node[APP_TEARDOWN_PROPERTY];
  }

  function clearExistingRootBindings(node) {
    const oldTeardown = node?.[APP_TEARDOWN_PROPERTY];
    if (typeof oldTeardown === 'function' && oldTeardown !== teardownRootListeners) oldTeardown();
    else teardownRootListeners(node);

    const oldUnsubscribe = node?.[APP_RUNTIME_UNSUBSCRIBE_PROPERTY];
    if (typeof oldUnsubscribe === 'function') oldUnsubscribe();
    if (node) delete node[APP_RUNTIME_UNSUBSCRIBE_PROPERTY];

    const oldDestroy = node?.[APP_RUNTIME_DESTROY_PROPERTY];
    if (typeof oldDestroy === 'function' && oldDestroy !== runtime.destroy) oldDestroy();
    if (node) delete node[APP_RUNTIME_DESTROY_PROPERTY];
  }

  function initializeRoot(node, surface) {
    const wasOpen = node.dataset.open === 'true';
    clearExistingRootBindings(node);
    root = node;
    overlay = surface;
    root.id = 'bioweave-panel';
    root.className = 'bioweave-root bioweave-panel';
    root.dataset.open = String(wasOpen);
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-hidden', String(!wasOpen));
    surface.id = 'bioweave-overlay';
    surface.className = 'bioweave-overlay';
    surface.dataset.open = String(wasOpen);
    surface.hidden = !wasOpen;
    surface.setAttribute('aria-hidden', String(!wasOpen));
    root.innerHTML = [
      '<header class="bioweave-head">',
      '<button class="bioweave-mobile-menu" type="button" data-bioweave-action="more" aria-label="打开更多页面" aria-expanded="false">☰</button>',
      '<strong class="bioweave-brand">BioWeave</strong>',
      '<span class="bioweave-chat-scope bioweave-muted">当前 Chat</span>',
      '<span class="bioweave-spacer"></span>',
      '<div class="bioweave-theme-switch" title="主题配色" role="group" aria-label="主题配色">',
      '<button type="button" data-theme-choice="tavern" aria-pressed="false">跟随酒馆</button>',
      '<button type="button" data-theme-choice="light" aria-pressed="false">日</button>',
      '<button type="button" data-theme-choice="dark" aria-pressed="false">夜</button>',
      '</div>',
      '<span class="bioweave-theme-label" aria-live="polite"></span>',
      '<button class="bioweave-close" type="button" data-bioweave-action="close" aria-label="关闭 BioWeave">×</button>',
      '</header>',
      '<aside class="bioweave-nav">',
      '<nav aria-label="BioWeave 主导航"></nav>',
      '<footer>',
      '<small>当前聊天</small>',
      '<b class="bioweave-chat-scope">当前 Chat</b>',
      '<span class="bioweave-enabled">● 已启用</span>',
      '<small>UI Foundation</small>',
      '</footer>',
      '</aside>',
      '<main class="bioweave-main"></main>',
      '<nav class="bioweave-bottom" aria-label="BioWeave 移动导航"></nav>',
      '<div id="bioweave-more-menu" class="bioweave-more-menu" role="menu" aria-label="更多 BioWeave 页面" aria-hidden="true"></div>',
    ].join('');

    const desktopNav = root.querySelector('.bioweave-nav nav');
    desktopRoutes.forEach(id => desktopNav.append(createNavigationButton(documentRef, id)));
    const bottomNav = root.querySelector('.bioweave-bottom');
    bottomRoutes.forEach(id => bottomNav.append(createNavigationButton(documentRef, id, true)));
    const moreButton = createNavigationButton(documentRef, 'state', true);
    moreButton.dataset.bioweaveAction = 'more';
    moreButton.dataset.route = '';
    moreButton.innerHTML = '<i class="fa-solid fa-ellipsis" aria-hidden="true"></i><span>更多</span>';
    bottomNav.append(moreButton);

    const moreMenu = root.querySelector('.bioweave-more-menu');
    moreRoutes.forEach(id => {
      const button = createNavigationButton(documentRef, id);
      button.setAttribute('role', 'menuitem');
      moreMenu.append(button);
    });

    root.addEventListener('click', handleClick);
    root.addEventListener('input', handleSettingsInput);
    root.addEventListener('change', handleChange);
    root.addEventListener('submit', handleSubmit);
    root.addEventListener('keydown', handleKeydown);
    surface.addEventListener('click', handleOverlayClick);
    root[APP_TEARDOWN_PROPERTY] = teardownRootListeners;
    if (typeof runtime.subscribe === 'function') {
      unsubscribeRuntime = runtime.subscribe(handleRuntimeEvent);
      if (typeof unsubscribeRuntime === 'function') root[APP_RUNTIME_UNSUBSCRIBE_PROPERTY] = unsubscribeRuntime;
    }
    setTheme(readTheme(storageRef));
    setMoreMenu(false);
    render();
  }

  const lifecycle = createOverlayLifecycle({
    documentRef,
    createOverlay: documentRefRef => {
      const node = documentRefRef.createElement('div');
      node.className = 'bioweave-overlay';
      node.hidden = true;
      node.dataset.open = 'false';
      node.setAttribute('aria-hidden', 'true');
      return node;
    },
    createRoot: documentRefRef => {
      const node = documentRefRef.createElement('section');
      node.className = 'bioweave-root bioweave-panel';
      node.dataset.open = 'false';
      return node;
    },
    initializeRoot,
    teardownRoot: teardownRootListeners,
  });

  function mountBioWeave() {
    const mounted = lifecycle.mount();
    if (!mounted) return null;
    overlay = mounted.overlay;
    root = mounted.root;
    return root;
  }

  function openBioWeave() {
    const opened = lifecycle.open();
    if (!opened) return null;
    overlay = opened.overlay;
    root = opened.root;
    if (route === 'settings') refreshAnalysisChatSettings();
    render();
    return root;
  }

  function closeBioWeave() {
    clearAnalysisPreview();
    lifecycle.close();
    setMoreMenu(false);
  }

  function destroyBioWeave() {
    clearPendingRecentStorySaves();
    modelRefreshSequence += 1;
    analysisSourceRequestSequence += 1;
    analysisSourceSaveSequence += 1;
    worldbookCache = createWorldbookCache();
    worldModelTraceChatId = null;
    lifecycle.destroy();
    root = null;
    overlay = null;
    unsubscribeRuntime = null;
    route = 'overview';
    focusedCharacterId = null;
    characterDetailTab = 'state';
    moreMenuOpen = false;
    analysisSourcesState = createAnalysisSourcesState();
    worldModelState = createWorldModelState();
    globalRecentStory = normalizeRecentStoryGlobalSettings();
    globalRecentStoryLoaded = false;
    globalRecentStorySaveSequence += 1;
    globalRecentStorySaveChain = Promise.resolve();
    clearAnalysisPreview();
    settingsState = {
      loaded: false,
      loading: false,
      profiles: {},
      assignments: {},
      editingProfile: undefined,
      editingDraft: undefined,
      drafts: {},
      modelList: [],
      modelListProfileKey: null,
      modelSearch: '',
      modelRefreshBusy: false,
      apiSource: SILLYTAVERN_CURRENT_API,
      defaultProfileId: null,
      apiRequestSettings: {...DEFAULT_API_REQUEST_SETTINGS},
      apiRequestDraft: null,
      notice: null,
      testResult: null,
      busy: false,
    };
  }

  return {
    mountBioWeave,
    openBioWeave,
    closeBioWeave,
    destroyBioWeave,
    go,
    openCharacter,
    setTheme,
    render,
    getRoot: () => lifecycle.getRoot(),
    getOverlay: () => lifecycle.getOverlay(),
    getRoute: () => route,
    getFocusedCharacterId: () => focusedCharacterId,
    getSettingsState: () => ({
      ...settingsState,
      profiles: {...settingsState.profiles},
      assignments: {...settingsState.assignments},
      globalRecentStory: {
        regex_rules: [...(globalRecentStory.regex_rules ?? [])],
      },
      modelList: [...(settingsState.modelList ?? [])],
      editingDraft: settingsState.editingDraft
        ? {...settingsState.editingDraft, api_key: ''}
        : settingsState.editingDraft,
      drafts: Object.fromEntries(Object.entries(settingsState.drafts ?? {}).map(([key, draft]) => [
        key,
        draft ? {...draft, api_key: ''} : draft,
      ])),
    }),
  };
}
