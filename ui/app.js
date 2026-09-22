import { overviewPage } from './overview.js'
import { charactersPage } from './characters.js'
import { eventsPage, setEventFilter } from './events.js'
import { projectionPage } from './projection.js'
import { genealogyPage } from './genealogy.js'
import {
  applyWorldModelSection,
  extractWorldModelSection,
  getWorldModelSection,
  applyWorldModelCollectionEdit,
  createWorldModelBiologicalTypeSelection,
  createWorldModelSpeciesSelection,
  normalizeWorldModelBiologicalTypeSelection,
  normalizeWorldModelSpeciesSelection,
  worldPage,
  WORLD_MODEL_SECTION_KEYS,
} from './world.js'
import { DATA_MANAGEMENT_OPERATIONS, normalizeModelList, renderAnalysisDebugPopupContent, settingsPage } from './settings.js'
import { statePage } from './state.js'
import { DEFAULT_FLOATING_LAUNCHER_THEME } from '../floating-launcher-theme.js'
import { createApiProfileStore } from '../storage/store.js'
import * as defaultApiClient from '../ai/client.js'
import {
  diagnosticMessage as sharedDiagnosticMessage,
  isTransportDiagnostic,
  statusFromError as sharedStatusFromError,
  traceApi,
} from '../ai/client.js'
import { createAnalyzer, normalizeStoredWorldModel, summarizeAnalysisInput } from '../ai/analyzer.js'
import { collectAnalysisContext } from '../ai/input-builder.js'
import {
  characterOpeningSelectionState,
  clearWorldbookCache,
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
} from '../ai/worldbook.js'
import { detectExternalMemoryProviders, probeExternalMemoryProviders } from '../story/seven-days-cal.js'
import {
  DEFAULT_API_REQUEST_SETTINGS,
  DEFAULT_API_PROFILE,
  FOLLOW_DEFAULT_API,
  normalizeExternalMemorySettings,
  normalizeApiRequestSettings,
  normalizeModelListCache,
  normalizeModelListCaches,
  isStableApiProfileId,
  normalizeRecentStoryGlobalSettings,
  normalizeRecentStorySettings,
  normalizeAnalysisPrompt,
  normalizeWorldbookSettings,
  SILLYTAVERN_CURRENT_API,
} from '../storage/schema.js'
const pages = {
  overview: ['总览', 'fa-house', overviewPage],
  characters: ['人物', 'fa-user-group', charactersPage],
  events: ['事件', 'fa-calendar-days', eventsPage],
  projection: ['推演', 'fa-wand-magic-sparkles', projectionPage],
  genealogy: ['家系', 'fa-diagram-project', genealogyPage],
  world: ['世界', 'fa-shapes', worldPage],
  settings: ['设置', 'fa-gear', settingsPage],
  state: ['状态', 'fa-chart-line', statePage],
}
const desktopRoutes = ['overview', 'characters', 'events', 'projection', 'genealogy', 'world', 'settings', 'state']
const WORLD_MODEL_OWNER_MUTATIONS = new Set([
  'CHAT_CHANGED',
  'MESSAGE_DELETED',
  'MESSAGE_SWIPED',
  'MESSAGE_SWIPE_DELETED',
  'MESSAGE_EDITED',
  'MESSAGE_UPDATED',
  'MESSAGE_RECEIVED',
  'GENERATION_ENDED',
])
const THEME_KEY = 'bioweave_ui_theme'
const APP_TEARDOWN_PROPERTY = '__bioweaveAppTeardown'
const APP_RUNTIME_UNSUBSCRIBE_PROPERTY = '__bioweaveRuntimeUnsubscribe'
const APP_RUNTIME_DESTROY_PROPERTY = '__bioweaveRuntimeDestroy'
const THEME_VALUES = new Set(['tavern', 'light', 'dark'])
const ANALYSIS_SELECTION_SEPARATOR = '\u0000'
const analysisParentDisclosureStates = new WeakMap()
const RENDER_SCROLL_SELECTORS = Object.freeze(['.bioweave-main', '[data-bioweave-analysis-source-list]'])
export function notify(message, type = 'info', documentRef = globalThis.document) {
  const text = String(message ?? '').trim()
  if (!text) return
  const method = typeof type === 'string' && type.trim() ? type.trim() : 'info'
  const toastrRefs = [...new Set([documentRef?.defaultView?.toastr, globalThis.toastr])]
  for (const toastr of toastrRefs) {
    try {
      const handler = toastr?.[method]
      if (typeof handler !== 'function') continue
      handler.call(toastr, text)
      return
    } catch {
      // Toast 宿主异常时继续使用安全的 console 回退。
    }
  }
  const consoleMethod = method === 'error' ? 'error' : method === 'warning' ? 'warn' : 'log'
  const fallbackText = `[BioWeave] ${text}`
  try {
    globalThis.console?.[consoleMethod]?.(fallbackText)
  } catch {
    // 控制台被宿主禁用时，通知仍不能影响设置操作。
  }
}
function sharedTransportErrorMessage(error) {
  const status = sharedStatusFromError(error)
  if (!isTransportDiagnostic(error, { status })) return ''
  return sharedDiagnosticMessage(error, { status })
}
// render 会重建设置页子树，按稳定选择器保存并恢复可滚动容器的位置。
export function captureScrollPositions(root, selectors = RENDER_SCROLL_SELECTORS) {
  return (Array.isArray(selectors) ? selectors : [])
    .map(selector => {
      const node = root?.querySelector?.(selector)
      if (!node) return null
      return {
        selector,
        scrollTop: Number.isFinite(node.scrollTop) ? node.scrollTop : 0,
        scrollLeft: Number.isFinite(node.scrollLeft) ? node.scrollLeft : 0,
      }
    })
    .filter(Boolean)
}
export function restoreScrollPositions(root, positions) {
  for (const position of Array.isArray(positions) ? positions : []) {
    const node = root?.querySelector?.(position?.selector)
    if (!node) continue
    node.scrollTop = position.scrollTop
    node.scrollLeft = position.scrollLeft
  }
}
const PANEL_DRAG_EXCLUDED_SELECTOR = 'button, a, input, select, textarea, [data-bioweave-no-drag]'
function panelDragRect(node) {
  const rect = node?.getBoundingClientRect?.()
  if (!rect) return null
  const left = Number(rect.left)
  const top = Number(rect.top)
  const width = Number(rect.width)
  const height = Number(rect.height)
  if (![left, top, width, height].every(Number.isFinite)) return null
  return {
    left,
    top,
    width,
    height,
    right: Number.isFinite(Number(rect.right)) ? Number(rect.right) : left + width,
    bottom: Number.isFinite(Number(rect.bottom)) ? Number(rect.bottom) : top + height,
  }
}
export function createPanelDragController({ root, handle, documentRef = globalThis.document } = {}) {
  if (!root || !handle) return { destroy() {} }
  let drag = null
  const removeDocumentListeners = () => {
    documentRef?.removeEventListener?.('pointermove', handlePointerMove)
    documentRef?.removeEventListener?.('pointerup', handlePointerEnd)
    documentRef?.removeEventListener?.('pointercancel', handlePointerEnd)
  }
  const finishDrag = () => {
    if (!drag) return
    const pointerId = drag.pointerId
    removeDocumentListeners()
    if (pointerId !== null) handle.releasePointerCapture?.(pointerId)
    drag = null
    if (root.dataset) delete root.dataset.dragging
  }
  function handlePointerMove(event) {
    if (!drag) return
    if (drag.pointerId !== null && event.pointerId !== drag.pointerId) return
    const clientX = Number(event.clientX)
    const clientY = Number(event.clientY)
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return
    let nextLeft = drag.startLeft + clientX - drag.startX
    let nextTop = drag.startTop + clientY - drag.startY
    if (drag.hostRect && drag.panelBase) {
      const minLeft = drag.hostRect.left - drag.panelBase.left
      const maxLeft = drag.hostRect.right - drag.panelBase.left - drag.panelRect.width
      const minTop = drag.hostRect.top - drag.panelBase.top
      const maxTop = drag.hostRect.bottom - drag.panelBase.top - drag.panelRect.height
      nextLeft = Math.min(Math.max(nextLeft, minLeft), Math.max(minLeft, maxLeft))
      nextTop = Math.min(Math.max(nextTop, minTop), Math.max(minTop, maxTop))
    }
    root.style.left = Math.round(nextLeft) + 'px'
    root.style.top = Math.round(nextTop) + 'px'
  }
  function handlePointerEnd(event) {
    if (!drag) return
    if (drag.pointerId !== null && event.pointerId !== drag.pointerId) return
    finishDrag()
  }
  function handlePointerDown(event) {
    if (drag || event?.isPrimary === false) return
    if (event?.button !== undefined && event.button !== 0) return
    const target = event.target
    const interactiveTarget = target?.closest?.(PANEL_DRAG_EXCLUDED_SELECTOR) ?? (target?.matches?.(PANEL_DRAG_EXCLUDED_SELECTOR) ? target : null)
    if (interactiveTarget) return
    const startX = Number(event.clientX)
    const startY = Number(event.clientY)
    if (!Number.isFinite(startX) || !Number.isFinite(startY)) return
    const startLeftValue = Number.parseFloat(root.style?.left)
    const startTopValue = Number.parseFloat(root.style?.top)
    const startLeft = Number.isFinite(startLeftValue) ? startLeftValue : 0
    const startTop = Number.isFinite(startTopValue) ? startTopValue : 0
    const panelRect = panelDragRect(root)
    const hostRect = panelDragRect(root.parentElement) ?? panelDragRect(documentRef?.documentElement)
    const panelBase = panelRect ? { left: panelRect.left - startLeft, top: panelRect.top - startTop } : null
    drag = {
      pointerId: event.pointerId ?? null,
      startX,
      startY,
      startLeft,
      startTop,
      panelRect,
      panelBase,
      hostRect,
    }
    root.dataset.dragging = 'true'
    if (drag.pointerId !== null) handle.setPointerCapture?.(drag.pointerId)
    documentRef?.addEventListener?.('pointermove', handlePointerMove)
    documentRef?.addEventListener?.('pointerup', handlePointerEnd)
    documentRef?.addEventListener?.('pointercancel', handlePointerEnd)
    event.preventDefault?.()
  }
  handle.addEventListener?.('pointerdown', handlePointerDown)
  return {
    destroy() {
      handle.removeEventListener?.('pointerdown', handlePointerDown)
      finishDrag()
    },
  }
}
function analysisCharacterGroupKey(sourceId) {
  return String(sourceId ?? '').trim() + ':opening'
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
  }
}
function createAnalysisPreviewState() {
  return {
    busy: false,
    mode: 'structure',
    analysisType: 'world',
    input: null,
    eventInput: null,
    chatId: null,
    error: null,
    worldModelTrace: null,
  }
}
function createWorldModelState() {
  return {
    loaded: false,
    reloadPending: false,
    loading: false,
    busy: false,
    chatId: null,
    model: null,
    meta: null,
    selectedSpecies: null,
    selectedBiologicalType: null,
    editingSection: null,
    sectionDraft: null,
    sectionDirty: false,
    collectionEditor: null,
    notice: null,
  }
}
function createDataManagementState() {
  return {
    busy: false,
    operation: null,
    chatId: null,
  }
}
function themeLabel(value) {
  return value === 'light' ? '日' : value === 'dark' ? '夜' : '跟随酒馆'
}
function themeIcon(value) {
  return value === 'light' ? 'fa-solid fa-sun' : value === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-circle-half-stroke'
}
function readTheme(storageRef) {
  try {
    const value = storageRef?.getItem?.(THEME_KEY)
    return THEME_VALUES.has(value) ? value : 'tavern'
  } catch {
    return 'tavern'
  }
}
function writeTheme(storageRef, value) {
  try {
    storageRef?.setItem?.(THEME_KEY, value)
  } catch {
    // 隐私模式或宿主禁用 localStorage 时仍允许本次会话切换主题。
  }
}
export function closeModelPicker(target) {
  const picker = target?.closest?.('[data-bioweave-model-picker]') ?? (target?.matches?.('[data-bioweave-model-picker]') ? target : null)
  if (!picker) return false
  const dropdown = picker.querySelector?.('[data-bioweave-model-dropdown]')
  const trigger = picker.querySelector?.('[data-bioweave-model-trigger]')
  if (dropdown) dropdown.hidden = true
  trigger?.setAttribute?.('aria-expanded', 'false')
  return true
}
// 父级 checkbox 位于 summary 内时，只拦截事件冒泡，保留浏览器原生勾选和 change 事件。
// details 的默认展开状态在当前事件结束后恢复，避免选择和折叠互相影响。
export function handleAnalysisParentToggleClick(event) {
  const target = event?.target?.closest?.(
    '[data-bioweave-analysis-section-toggle], [data-bioweave-analysis-worldbook-toggle], [data-bioweave-analysis-character-opening-toggle]',
  )
  if (!target) return false
  event.stopPropagation?.()
  if (!target.disabled) {
    const details = target.closest?.('details')
    const openBeforeClick = details?.open
    if (details && typeof openBeforeClick === 'boolean') {
      analysisParentDisclosureStates.set(details, openBeforeClick)
      const restoreDisclosure = () => {
        if (isConnectedToDocument(details)) details.open = openBeforeClick
        analysisParentDisclosureStates.delete(details)
      }
      if (typeof globalThis.queueMicrotask === 'function') globalThis.queueMicrotask(restoreDisclosure)
      else Promise.resolve().then(restoreDisclosure)
    }
  }
  return true
}
export function isConnectedToDocument(node, documentRef = globalThis.document) {
  if (!node) return false
  if (typeof node.isConnected === 'boolean') return node.isConnected
  if (typeof documentRef?.documentElement?.contains === 'function') {
    return documentRef.documentElement.contains(node)
  }
  return Boolean(documentRef?.body?.contains?.(node))
}
function connectedNodesById(documentRef, id) {
  if (!documentRef) return []
  const nodes =
    typeof documentRef.querySelectorAll === 'function'
      ? [...documentRef.querySelectorAll('#' + id)]
      : [documentRef.getElementById?.(id)].filter(Boolean)
  return nodes.filter(node => isConnectedToDocument(node, documentRef))
}
function createNavigationButton(documentRef, id, compact = false) {
  const [label, icon] = pages[id]
  const button = documentRef.createElement('button')
  button.type = 'button'
  button.className = 'bioweave-route-item'
  button.dataset.route = id
  const compactLabel = label.replace('列表', '').replace('历史', '').replace('预测', '')
  button.innerHTML = '<i class="fa-solid ' + icon + '" aria-hidden="true"></i><span>' + (compact ? compactLabel : label) + '</span>'
  return button
}
function syncWorldModelCapabilityInputs(root) {
  const inputs = root?.querySelectorAll?.('[data-bioweave-world-capability-input]') ?? []
  for (const input of inputs) {
    const state = input.dataset?.bioweaveWorldCapabilityState
    input.indeterminate = state === 'unknown'
    input.setAttribute?.('aria-checked', input.indeterminate ? 'mixed' : String(Boolean(input.checked)))
  }
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
  let overlay = null
  let root = null
  let initialized = false
  const cleanupRoot = node => {
    if (node && typeof teardownRoot === 'function') teardownRoot(node, overlay)
  }
  const removeDuplicateNodes = (nodes, keep, cleanup) => {
    for (const node of nodes) {
      if (node === keep) continue
      cleanup?.(node)
      node.remove?.()
    }
  }
  function discardDisconnectedNodes() {
    if (overlay && !isConnectedToDocument(overlay, documentRef)) {
      cleanupRoot(root)
      root = null
      overlay = null
      initialized = false
      return
    }
    if (root && !isConnectedToDocument(root, documentRef)) {
      cleanupRoot(root)
      root = null
      initialized = false
    }
  }
  function mount() {
    const host = documentRef?.documentElement ?? documentRef?.body
    if (!host) return null
    discardDisconnectedNodes()
    if (!overlay) {
      const overlays = connectedNodesById(documentRef, overlayId)
      overlay = overlays[0] ?? null
      removeDuplicateNodes(overlays, overlay, extraOverlay => {
        for (const extraRoot of extraOverlay.querySelectorAll?.('#' + rootId) ?? []) cleanupRoot(extraRoot)
      })
    }
    if (!overlay) {
      overlay = createOverlay(documentRef)
      overlay.id = overlayId
      host.append(overlay)
    } else if (overlay.parentElement !== host) {
      host.append(overlay)
    }
    if (!root) {
      const roots = connectedNodesById(documentRef, rootId)
      root = roots[0] ?? null
      removeDuplicateNodes(roots, root, cleanupRoot)
    }
    if (!root) root = createRoot(documentRef, overlay)
    root.id = rootId
    if (root.parentElement !== overlay) overlay.append(root)
    if (!initialized) {
      initializeRoot(root, overlay)
      initialized = true
    }
    return { overlay, root }
  }
  function open() {
    const mounted = mount()
    if (!mounted) return null
    mounted.overlay.hidden = false
    mounted.overlay.dataset.open = 'true'
    mounted.overlay.setAttribute('aria-hidden', 'false')
    mounted.root.dataset.open = 'true'
    mounted.root.setAttribute('aria-hidden', 'false')
    return mounted
  }
  function close() {
    if (!overlay || !root) return
    overlay.hidden = true
    overlay.dataset.open = 'false'
    overlay.setAttribute('aria-hidden', 'true')
    root.dataset.open = 'false'
    root.setAttribute('aria-hidden', 'true')
  }
  function destroy() {
    if (root) cleanupRoot(root)
    if (overlay) overlay.remove?.()
    else root?.remove?.()
    overlay = null
    root = null
    initialized = false
  }
  return {
    mount,
    open,
    close,
    destroy,
    getRoot: () => root,
    getOverlay: () => overlay,
  }
}
export function createApp(runtime, options = {}) {
  if (!runtime?.chat?.current) throw new TypeError('BIOWEAVE_RUNTIME_REQUIRED')
  const documentRef = options.documentRef ?? globalThis.document
  const storageRef = options.storageRef ?? globalThis.localStorage
  const onUiPreferencesChanged = options.onUiPreferencesChanged ?? (() => {})
  const profileStore = options.profileStore ?? runtime.store?.profileStore ?? createApiProfileStore(runtime.st ?? {})
  const apiClient = options.apiClient ?? defaultApiClient
  let root = null
  let overlay = null
  let panelDragController = null
  let route = 'overview'
  let focusedCharacterId = null
  let unsubscribeRuntime = null
  let modelRefreshSequence = 0
  let analysisSourceRequestSequence = 0
  let analysisSourceSaveSequence = 0
  let analysisPreviewSequence = 0
  let analysisSourceSaveChain = Promise.resolve()
  let worldbookCache = createWorldbookCache()
  let analysisSourcesState = createAnalysisSourcesState()
  let analysisPreviewState = createAnalysisPreviewState()
  let worldModelState = createWorldModelState()
  let worldModelLoadGeneration = 0
  let dataManagementState = createDataManagementState()
  let worldModelAbortController = null
  let worldModelAbortConfirmOpen = false
  let eventAnalysisAbortConfirmOpen = false
  let globalRecentStory = normalizeRecentStoryGlobalSettings()
  let globalRecentStoryLoaded = false
  let globalRecentStorySaveSequence = 0
  let globalRecentStorySaveChain = Promise.resolve()
  let recentStorySaveTimer = null
  let globalRecentStorySaveTimer = null
  let settingsState = {
    loaded: false,
    loading: false,
    profiles: {},
    assignments: {},
    apiSource: SILLYTAVERN_CURRENT_API,
    defaultProfileId: null,
    apiRequestSettings: { ...DEFAULT_API_REQUEST_SETTINGS },
    apiRequestDraft: null,
    editingProfile: undefined,
    editingDraft: undefined,
    drafts: {},
    modelList: [],
    modelListProfileKey: null,
    modelListCaches: {},
    modelListRefreshedAt: null,
    modelSearch: '',
    modelRefreshBusy: false,
    notice: null,
    testResult: null,
    busy: false,
    analysisPrompt: {},
    analysisPromptDraft: null,
    show_floating_launcher: true,
    floating_launcher_theme: DEFAULT_FLOATING_LAUNCHER_THEME,
  }
  let storyTimeDebugState = {
    enabled: false,
    loading: false,
    info: null,
    error: null,
  }
  let storyTimeDebugSequence = 0
  let worldModelTraceChatId = null
  let businessState = {
    loaded: false,
    loading: false,
    chatId: null,
    trackingSubjects: {},
    characterProfiles: {},
    activeEvents: [],
    currentFloor: null,
    currentState: null,
    currentStateStatus: 'NO_CHARACTER_FLOOR',
    currentStoryTime: null,
    currentStoryTimeStatus: null,
    currentStoryTimeDifferences: {},
    lastAnalysis: null,
    analysisStatus: { state: 'not_analyzed', busy: false },
    error: null,
  }
  let aliasEditorState = {
    open: false,
    loading: false,
    saving: false,
    characterId: null,
    canonicalName: null,
    draftAliases: [],
    error: null,
  }
  let businessRefreshSequence = 0
  let eventEditingId = null
  function receiveWorldModelTrace(trace) {
    if (!trace || typeof trace !== 'object') return
    const currentChatId = runtime.chat.current()
    if (worldModelTraceChatId !== null && String(worldModelTraceChatId) !== String(currentChatId)) return
    const rawResponse = trace.raw_output ?? null
    const canonicalModel = trace.canonical_model ?? null
    if (rawResponse === null && canonicalModel === null) return
    analysisPreviewState = {
      ...analysisPreviewState,
      chatId: currentChatId,
      error: null,
      worldModelTrace: { rawResponse, canonicalModel },
    }
    if (route === 'settings') render()
  }
  function resolveAnalysisProfile(task = 'world_analysis') {
    const settings = profileStore.getSettings?.() ?? {}
    const assignment = settings.assignments?.[task] ?? null
    if (assignment === SILLYTAVERN_CURRENT_API) return SILLYTAVERN_CURRENT_API
    if (assignment === FOLLOW_DEFAULT_API) {
      if (settings.api_source === SILLYTAVERN_CURRENT_API) return SILLYTAVERN_CURRENT_API
      const defaultProfileId = settings.default_profile_id
      return defaultProfileId ? profileStore.getProfile?.(defaultProfileId) : null
    }
    return assignment ? profileStore.getProfile?.(assignment) : null
  }
  const analyzer =
    options.analyzer ??
    createAnalyzer({
      profileResolver: resolveAnalysisProfile,
      contextResolver: () => runtime.st?.getContext?.() ?? hostContextForApp(),
      requestSettingsResolver: () => settingsState.apiRequestDraft ?? profileStore.getApiRequestSettings?.() ?? settingsState.apiRequestSettings,
      analysisPromptResolver: () => profileStore.getAnalysisPrompt?.() ?? profileStore.getWorldAnalysisPrompt?.() ?? settingsState.analysisPrompt,
      onWorldModelTrace: receiveWorldModelTrace,
    })
  function loadGlobalRecentStoryState() {
    const settings = profileStore.getSettings?.() ?? {}
    const saved =
      typeof profileStore.getRecentStoryGlobal === 'function'
        ? (profileStore.getRecentStoryGlobal() ?? settings.recent_story_global)
        : settings.recent_story_global
    globalRecentStory = normalizeRecentStoryGlobalSettings(saved)
    globalRecentStoryLoaded = true
    return globalRecentStory
  }
  function updateSettingsState() {
    const settings = profileStore.getSettings?.() ?? {}
    loadGlobalRecentStoryState()
    const profiles = settings.api_profiles ?? {}
    settingsState = {
      ...settingsState,
      profiles,
      assignments: settings.assignments ?? {},
      apiSource: settings.api_source ?? SILLYTAVERN_CURRENT_API,
      defaultProfileId: settings.default_profile_id ?? null,
      modelListCaches: normalizeModelListCaches(settings.api_model_caches, profiles),
      apiRequestSettings: normalizeApiRequestSettings(
        typeof profileStore.getApiRequestSettings === 'function' ? profileStore.getApiRequestSettings() : settings.api_request_settings,
      ),
      apiRequestDraft: settingsState.apiRequestDraft,
      analysisPrompt: normalizeAnalysisPrompt(
        settings.analysis_prompt ?? settings.world_analysis_prompt ?? profileStore.getAnalysisPrompt?.() ?? profileStore.getWorldAnalysisPrompt?.(),
      ),
      analysisPromptDraft: settingsState.analysisPromptDraft,
      show_floating_launcher: settings.show_floating_launcher !== false,
      floating_launcher_theme: settings.floating_launcher_theme ?? DEFAULT_FLOATING_LAUNCHER_THEME,
      loaded: true,
    }
    return settings
  }
  async function loadSettings() {
    if (settingsState.loaded || settingsState.loading) return
    settingsState.loading = true
    if (route === 'settings') render()
    try {
      updateSettingsState()
    } catch {
      notify('无法读取全局设置，请确认 SillyTavern extensionSettings 可用。', 'error', documentRef)
      settingsState = {
        ...settingsState,
        loaded: true,
        notice: null,
      }
    } finally {
      settingsState.loading = false
      if (route === 'settings') render()
    }
  }
  function analysisSourceSelectedItems(selected) {
    return normalizeWorldbookSettings({ selected }).selected
  }
  function syncAnalysisSourcesState(patch = {}) {
    const next = { ...analysisSourcesState, ...patch }
    const selected = analysisSourceSelectedItems(next.selected)
    const stats = sourceSelectionStats(next.sources, selected)
    return {
      ...next,
      selected,
      selectedCount: stats.count,
      selectedWorldbookCount: stats.worldbook_count,
      selectedTokenEstimate: stats.token_estimate,
    }
  }
  function currentAnalysisChatToken() {
    const chatId = runtime.chat.current()
    const token = typeof runtime.chat.token === 'function' ? runtime.chat.token() : { chatId }
    return { chatId, token }
  }
  function assertAnalysisChatToken(token) {
    if (typeof runtime.chat.assert === 'function') {
      runtime.chat.assert(token)
      return
    }
    if (runtime.chat.current() !== token.chatId) throw new Error('STALE_CHAT')
  }
  function ensureAnalysisSourcesChat() {
    const chatId = runtime.chat.current()
    if (analysisSourcesState.chatId !== null && analysisSourcesState.chatId !== chatId) {
      analysisSourceRequestSequence += 1
      analysisSourceSaveSequence += 1
      abortUiWorldModelRequest()
      worldbookCache = clearWorldbookCache(worldbookCache)
      analysisSourcesState = createAnalysisSourcesState()
      invalidateWorldModelView({ deferReload: false })
      clearAnalysisPreview()
    }
    return chatId
  }
  function clearAnalysisPreview() {
    analysisPreviewSequence += 1
    analysisPreviewState = createAnalysisPreviewState()
  }
  function hostPopupContext() {
    try {
      return runtime.st?.getContext?.() ?? globalThis.SillyTavern?.getContext?.() ?? null
    } catch {
      return null
    }
  }
  function isPopupContentElement(value) {
    return Boolean(value && typeof value === 'object' && typeof value.addEventListener === 'function' && 'innerHTML' in value)
  }
  function renderDebugPopupContent(content, promptSettings = settingsState.analysisPrompt) {
    const nextContent = renderAnalysisDebugPopupContent({
      analysisPreview: analysisPreviewState,
      analysisPrompt: promptSettings,
      openSettingsSections: analysisSourcesState.openSettingsSections,
      theme: root?.dataset?.theme ?? 'tavern',
      documentRef,
    })
    if (isPopupContentElement(content)) {
      content.innerHTML = isPopupContentElement(nextContent) ? nextContent.innerHTML : String(nextContent ?? '')
    }
    return nextContent
  }
  function readStoredAnalysisPrompt() {
    try {
      return profileStore.getAnalysisPrompt?.() ?? profileStore.getWorldAnalysisPrompt?.() ?? settingsState.analysisPrompt
    } catch {
      return settingsState.analysisPrompt
    }
  }
  async function openAnalysisDebugPopup() {
    // Preview uses the persisted settings because those are the settings read
    // by both the UI World analyzer and the Runtime Event analyzer. Unsaved
    // form drafts remain local until the user explicitly saves them.
    const promptSettings = readStoredAnalysisPrompt()
    const context = hostPopupContext()
    const Popup = context?.Popup
    const popupType = context?.POPUP_TYPE?.DISPLAY
    if (typeof Popup !== 'function' || popupType === undefined) {
      notify('高级 / 调试窗口暂不可用，请确认 SillyTavern Popup 已加载。', 'error', documentRef)
      return false
    }
    const content = renderDebugPopupContent(null, promptSettings)
    const localContent = isPopupContentElement(content) ? content : null
    const handlePopupClick = async event => {
      const target = event?.target?.closest?.('[data-bioweave-action]')
      if (!target) return
      if (typeof localContent?.contains === 'function' && !localContent.contains(target)) return
      const action = target.dataset?.bioweaveAction
      if (action === 'refresh-analysis-preview') {
        event.preventDefault?.()
        const pending = refreshAnalysisPreview()
        renderDebugPopupContent(localContent, promptSettings)
        await pending
        renderDebugPopupContent(localContent, promptSettings)
        return
      }
      if (action === 'analysis-preview-mode') {
        event.preventDefault?.()
        setAnalysisPreviewMode(target.dataset.bioweavePreviewMode)
        renderDebugPopupContent(localContent, promptSettings)
        return
      }
      if (action === 'analysis-preview-type') {
        event.preventDefault?.()
        setAnalysisPreviewType(target.dataset.bioweavePreviewType)
        renderDebugPopupContent(localContent, promptSettings)
      }
    }
    if (localContent) localContent.addEventListener('click', handlePopupClick)
    try {
      const popup = new Popup(content, popupType, '', {
        wide: true,
        allowVerticalScrolling: true,
      })
      await popup.show()
      return true
    } catch {
      notify('高级 / 调试窗口打开失败，请确认 SillyTavern Popup 可用。', 'error', documentRef)
      return false
    } finally {
      localContent?.removeEventListener?.('click', handlePopupClick)
    }
  }
  // 预览需要等待同一 Chat 的来源初次加载完成，不另起一套请求或固定超时。
  async function waitForAnalysisSourcesIdle() {
    while (analysisSourcesState.loading) {
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  function readAnalysisSettings(chatId) {
    const chatData = runtime.store?.getChat?.(chatId)
    return {
      worldbooks: normalizeWorldbookSettings(chatData?.settings?.worldbooks),
      recentStory: normalizeRecentStorySettings(chatData?.settings?.recent_story),
      externalMemory: normalizeExternalMemorySettings(chatData?.settings?.external_memory),
    }
  }
  // 重新读取当前 Chat 的小型设置，避免跨端打开时沿用旧的页面内存。
  function refreshAnalysisChatSettings() {
    if (recentStorySaveTimer !== null || globalRecentStorySaveTimer !== null) return false
    const chatId = runtime.chat.current()
    if (analysisSourcesState.chatId !== chatId) return false
    const chatSettings = readAnalysisSettings(chatId)
    analysisSourcesState = syncAnalysisSourcesState({
      chatId,
      selected: chatSettings.worldbooks.selected,
      recentStory: chatSettings.recentStory,
      externalMemory: chatSettings.externalMemory,
      notice: null,
    })
    return true
  }
  async function loadAnalysisSourcesState({ forceRefresh = false } = {}) {
    if (analysisSourcesState.loading) return
    captureAnalysisSourceDisclosure()
    const { chatId, token } = currentAnalysisChatToken()
    const requestId = ++analysisSourceRequestSequence
    const context = runtime.st?.getContext?.() ?? hostContextForApp()
    const chatSettings = readAnalysisSettings(chatId)
    const externalMemoryProbe = probeExternalMemoryProviders({ context }).catch(() => detectExternalMemoryProviders({ context }))
    const selected =
      analysisSourcesState.chatId === chatId ? analysisSourceSelectedItems(analysisSourcesState.selected) : chatSettings.worldbooks.selected
    analysisSourcesState = syncAnalysisSourcesState({
      loading: true,
      refreshBusy: true,
      loadingWorldbookIds: [],
      chatId,
      selected,
      recentStory: analysisSourcesState.chatId === chatId ? analysisSourcesState.recentStory : chatSettings.recentStory,
      externalMemory: analysisSourcesState.chatId === chatId ? analysisSourcesState.externalMemory : chatSettings.externalMemory,
      externalMemoryProviders: detectExternalMemoryProviders({ context }),
      notice: null,
    })
    if (route === 'settings') render()
    void externalMemoryProbe
      .then(providers => {
        try {
          assertAnalysisChatToken(token)
        } catch {
          return
        }
        if (requestId !== analysisSourceRequestSequence || analysisSourcesState.chatId !== chatId) return
        analysisSourcesState = {
          ...analysisSourcesState,
          externalMemoryProviders: providers,
        }
        if (route === 'settings') render()
      })
      .catch(() => {
        // 外部来源探测失败时保留同步能力检测结果，不影响世界书目录。
      })
    try {
      await analysisSourceSaveChain
      assertAnalysisChatToken(token)
      if (requestId !== analysisSourceRequestSequence) return
      const sources = await loadAnalysisSources({
        context,
        fetchRef: runtime.st?.fetch,
        getRequestHeaders: runtime.st?.getRequestHeaders,
        cache: worldbookCache,
        forceRefresh,
        deferWorldbookContent: chatSettings.worldbooks.mode !== 'all',
        loadContentForSourceIds: [...analysisSourcesState.openWorldbooks, ...selected.map(item => item.source_id)],
      })
      assertAnalysisChatToken(token)
      if (requestId !== analysisSourceRequestSequence) return
      const sourceList = Array.isArray(sources) ? sources : sources.sources
      const sourceWarning = Array.isArray(sources) ? null : sources.warning
      const keepExistingSources = sourceWarning === 'ST_WORLDBOOK_LIST_FAILED' && analysisSourcesState.sources.length > 0
      const safeSources = keepExistingSources ? analysisSourcesState.sources : (sourceList ?? [])
      if (sourceWarning === 'ST_WORLDBOOK_LIST_FAILED') {
        notify('世界书列表刷新失败，已保留之前的列表和选择。', 'error', documentRef)
      } else if (sourceWarning === 'ST_WORLDBOOK_LIST_FALLBACK') {
        notify('世界书列表接口不可用，已使用 SillyTavern 公共名称列表。', 'warning', documentRef)
      } else if (forceRefresh) {
        notify('分析来源已刷新。', 'info', documentRef)
      }
      analysisSourcesState = syncAnalysisSourcesState({
        loaded: true,
        loading: false,
        refreshBusy: false,
        sources: safeSources,
        selected,
        chatId,
        notice: null,
      })
    } catch {
      if (requestId !== analysisSourceRequestSequence) return
      try {
        assertAnalysisChatToken(token)
      } catch {
        return
      }
      analysisSourcesState = syncAnalysisSourcesState({
        loaded: true,
        loading: false,
        refreshBusy: false,
        selected,
        chatId,
        notice: null,
      })
      notify('分析来源刷新失败，已保留之前的列表和选择。', 'error', documentRef)
    } finally {
      if (requestId !== analysisSourceRequestSequence) return
      analysisSourcesState = {
        ...analysisSourcesState,
        loading: false,
        refreshBusy: false,
      }
      if (route === 'settings') render()
    }
  }
  async function persistAnalysisSettings({
    selected = analysisSourcesState.selected,
    recentStory = analysisSourcesState.recentStory,
    externalMemory = analysisSourcesState.externalMemory,
    renderAfterSave = true,
  } = {}) {
    const { chatId, token } = currentAnalysisChatToken()
    const currentChat = runtime.store?.getChat?.(chatId)
    const normalizedWorldbooks = normalizeWorldbookSettings({
      ...(currentChat?.settings?.worldbooks ?? {}),
      selected,
    })
    const normalizedRecentStory = normalizeRecentStorySettings(recentStory)
    const normalizedExternalMemory = normalizeExternalMemorySettings(externalMemory)
    const requestId = ++analysisSourceSaveSequence
    analysisSourceSaveChain = analysisSourceSaveChain
      .catch(() => {})
      .then(async () => {
        assertAnalysisChatToken(token)
        const chat = runtime.store?.getChat?.(chatId)
        if (!chat || typeof runtime.store?.saveChat !== 'function') {
          throw new Error('ST_METADATA_STORAGE_UNAVAILABLE')
        }
        await runtime.store.saveChat(chatId, {
          ...chat,
          settings: {
            ...(chat.settings ?? {}),
            worldbooks: normalizedWorldbooks,
            recent_story: normalizedRecentStory,
            external_memory: normalizedExternalMemory,
          },
        })
        assertAnalysisChatToken(token)
        if (requestId === analysisSourceSaveSequence && analysisSourcesState.chatId === chatId) {
          analysisSourcesState = { ...analysisSourcesState, notice: null }
          notify('分析来源与最近剧情设置已保存到当前 Chat。', 'success', documentRef)
          if (renderAfterSave && route === 'settings') render()
        }
      })
      .catch(error => {
        try {
          assertAnalysisChatToken(token)
        } catch {
          return
        }
        if (requestId === analysisSourceSaveSequence && analysisSourcesState.chatId === chatId) {
          analysisSourcesState = { ...analysisSourcesState, notice: null }
          notify('世界书来源保存失败，当前选择仍保留。', 'error', documentRef)
          if (renderAfterSave && route === 'settings') render()
        }
        void error
      })
    return analysisSourceSaveChain
  }
  function clearPendingRecentStorySaves() {
    if (recentStorySaveTimer !== null) {
      clearTimeout(recentStorySaveTimer)
      recentStorySaveTimer = null
    }
    if (globalRecentStorySaveTimer !== null) {
      clearTimeout(globalRecentStorySaveTimer)
      globalRecentStorySaveTimer = null
    }
  }
  function queueRecentStorySettingsSave(settings) {
    const snapshot = normalizeRecentStorySettings(settings)
    if (recentStorySaveTimer !== null) clearTimeout(recentStorySaveTimer)
    recentStorySaveTimer = setTimeout(() => {
      recentStorySaveTimer = null
      void persistAnalysisSettings({
        recentStory: snapshot,
        renderAfterSave: false,
      })
    }, 250)
  }
  function queueRecentStoryGlobalSettingsSave(settings) {
    const snapshot = normalizeRecentStoryGlobalSettings(settings)
    if (globalRecentStorySaveTimer !== null) clearTimeout(globalRecentStorySaveTimer)
    globalRecentStorySaveTimer = setTimeout(() => {
      globalRecentStorySaveTimer = null
      void persistRecentStoryGlobalSettings(snapshot, {
        renderAfterSave: false,
      })
    }, 250)
  }
  async function persistRecentStoryGlobalSettings(settings, { renderAfterSave = true } = {}) {
    const next = normalizeRecentStorySettings(settings)
    globalRecentStory = { regex_rules: next.regex_rules }
    globalRecentStoryLoaded = true
    if (renderAfterSave) render()
    if (typeof profileStore.saveRecentStoryGlobal !== 'function') {
      settingsState = { ...settingsState, notice: null }
      notify('当前宿主不支持保存全局正则。', 'error', documentRef)
      if (renderAfterSave) render()
      return
    }
    const requestId = ++globalRecentStorySaveSequence
    const snapshot = { regex_rules: [...next.regex_rules] }
    globalRecentStorySaveChain = globalRecentStorySaveChain
      .catch(() => {})
      .then(async () => {
        const saved = await profileStore.saveRecentStoryGlobal(snapshot)
        if (requestId !== globalRecentStorySaveSequence) return
        globalRecentStory = {
          // 保存规范化结果时不带入 Secret；空白规则仍由当前页面状态保留以便继续编辑。
          regex_rules: normalizeRecentStorySettings(globalRecentStory).regex_rules,
        }
        settingsState = { ...settingsState, notice: null }
        notify('全局正则已保存。', 'success', documentRef)
        void saved
        if (renderAfterSave) render()
      })
      .catch(error => {
        if (requestId !== globalRecentStorySaveSequence) return
        settingsState = { ...settingsState, notice: null }
        notify(settingsOperationError(error), 'error', documentRef)
        if (renderAfterSave) render()
      })
    return globalRecentStorySaveChain
  }
  function applyAnalysisSourceSearch(query) {
    if (!root) return
    const visibleSources = searchAnalysisSources(analysisSourcesState.sources, query)
    const visibleIds = new Set(visibleSources.map(source => source.source_id))
    const visibleChildren = new Set()
    for (const source of visibleSources) {
      for (const entry of source.entries ?? [])
        visibleChildren.add(`${source.source_id}${ANALYSIS_SELECTION_SEPARATOR}entry${ANALYSIS_SELECTION_SEPARATOR}${entry.entry_id}`)
      for (const field of source.fields ?? [])
        visibleChildren.add(`${source.source_id}${ANALYSIS_SELECTION_SEPARATOR}field${ANALYSIS_SELECTION_SEPARATOR}${field.field_key}`)
    }
    root.querySelectorAll?.('[data-bioweave-analysis-source-row]').forEach(row => {
      const sourceId = row.dataset?.bioweaveAnalysisSourceRow
      const childKey = row.dataset?.bioweaveAnalysisSourceChildKey
      const visible = visibleIds.has(sourceId) && (!childKey || visibleChildren.has(childKey))
      row.hidden = !visible
      if (visible && query.trim() && row.tagName === 'DETAILS') row.open = true
    })
    root.querySelectorAll?.('[data-bioweave-analysis-character-group]').forEach(group => {
      const visibleChild = [...(group.querySelectorAll?.('[data-bioweave-analysis-source-child-key]') ?? [])].some(row => !row.hidden)
      if (query.trim() && visibleChild) group.open = true
    })
    root.querySelectorAll?.('[data-bioweave-analysis-section]').forEach(section => {
      const hasVisibleRow = [...(section.querySelectorAll?.('[data-bioweave-analysis-source-row]') ?? [])].some(row => !row.hidden)
      section.hidden = Boolean(query.trim()) && !hasVisibleRow
      if (query.trim() && hasVisibleRow) section.open = true
    })
  }
  function captureAnalysisSourceDisclosure() {
    if (!root) return
    const openAnalysisSections = [...(root.querySelectorAll?.('[data-bioweave-analysis-section][open]') ?? [])]
      .map(node => String(node.dataset?.bioweaveAnalysisSection ?? '').trim())
      .filter(Boolean)
    const openWorldbooks = [...(root.querySelectorAll?.('.bioweave-analysis-worldbook') ?? [])]
      .filter(node => (analysisParentDisclosureStates.has(node) ? analysisParentDisclosureStates.get(node) : node.open))
      .map(node => String(node.dataset?.bioweaveAnalysisSourceRow ?? '').trim())
      .filter(Boolean)
    const openCharacterGroups = [...(root.querySelectorAll?.('[data-bioweave-analysis-character-group]') ?? [])]
      .filter(node => (analysisParentDisclosureStates.has(node) ? analysisParentDisclosureStates.get(node) : node.open))
      .map(node => analysisCharacterGroupKey(node.dataset?.bioweaveAnalysisCharacterGroupSource))
      .filter(key => key !== ':opening')
    const openSettingsSections = [...(root.querySelectorAll?.('[data-bioweave-settings-disclosure][open]') ?? [])]
      .map(node => String(node.dataset?.bioweaveSettingsDisclosure ?? '').trim())
      .filter(Boolean)
    analysisSourcesState = {
      ...analysisSourcesState,
      openAnalysisSections,
      openWorldbooks,
      openCharacterGroups,
      openSettingsSections,
    }
  }
  async function toggleAnalysisSource(target) {
    const sourceId = target?.dataset?.bioweaveAnalysisSource
    if (!sourceId || target.disabled) return
    captureAnalysisSourceDisclosure()
    const selection = {
      source_id: sourceId,
      entry_id: target.dataset?.bioweaveAnalysisEntry,
      field_key: target.dataset?.bioweaveAnalysisField,
    }
    const selected = updateSourceSelection(analysisSourcesState.selected, selection, Boolean(target.checked))
    analysisSourcesState = syncAnalysisSourcesState({ selected, notice: null })
    render()
    await persistAnalysisSettings({ selected, renderAfterSave: false })
  }
  async function loadWorldbookSourceForUi(sourceId, { selectAll = null, forceRefresh = false } = {}) {
    const id = String(sourceId ?? '').trim()
    const source = analysisSourcesState.sources.find(item => item.source_id === id)
    if (!source) return null
    if (source.content_loaded && selectAll === null) return source
    if ((analysisSourcesState.loadingWorldbookIds ?? []).includes(id)) return null
    const { chatId, token } = currentAnalysisChatToken()
    const requestId = analysisSourceRequestSequence
    const loadingWorldbookIds = [...new Set([...(analysisSourcesState.loadingWorldbookIds ?? []), id])]
    analysisSourcesState = syncAnalysisSourcesState({
      loading: true,
      loadingWorldbookIds,
      chatId,
      notice: null,
    })
    render()
    try {
      const context = runtime.st?.getContext?.() ?? hostContextForApp()
      const loaded = await loadWorldbookSource(source, {
        context,
        fetchRef: runtime.st?.fetch ?? globalThis.fetch,
        getRequestHeaders: runtime.st?.getRequestHeaders,
        cache: worldbookCache,
        forceRefresh,
      })
      assertAnalysisChatToken(token)
      if (requestId !== analysisSourceRequestSequence) return null
      if (!loaded?.content_loaded) throw new Error('ST_WORLDBOOK_CONTENT_FAILED')
      const sources = analysisSourcesState.sources.map(item =>
        item.source_id === id
          ? {
              ...item,
              ...loaded,
              scopes: [...new Set([...(item.scopes ?? []), ...(loaded.scopes ?? [])])],
            }
          : item,
      )
      const selected =
        selectAll === null ? analysisSourcesState.selected : setWorldbookEntriesSelection(analysisSourcesState.selected, loaded, selectAll)
      analysisSourcesState = syncAnalysisSourcesState({
        loaded: true,
        loading: false,
        loadingWorldbookIds: (analysisSourcesState.loadingWorldbookIds ?? []).filter(value => value !== id),
        sources,
        selected,
        chatId,
        notice: null,
      })
      render()
      if (selectAll !== null) await persistAnalysisSettings({ selected, renderAfterSave: false })
      return loaded
    } catch {
      if (requestId !== analysisSourceRequestSequence) return null
      try {
        assertAnalysisChatToken(token)
      } catch {
        return null
      }
      analysisSourcesState = syncAnalysisSourcesState({
        loading: false,
        loadingWorldbookIds: (analysisSourcesState.loadingWorldbookIds ?? []).filter(value => value !== id),
        chatId,
        notice: null,
      })
      notify('世界书条目读取失败，请稍后重试。', 'error', documentRef)
      render()
      return null
    }
  }
  async function toggleWorldbookEntries(target) {
    const sourceId = String(target?.dataset?.bioweaveAnalysisWorldbookToggle ?? '').trim()
    if (!sourceId || target.disabled) return
    const source = analysisSourcesState.sources.find(item => item.source_id === sourceId)
    if (!source) return
    captureAnalysisSourceDisclosure()
    if (!source.content_loaded) {
      await loadWorldbookSourceForUi(sourceId, {
        selectAll: Boolean(target.checked),
      })
      return
    }
    const selected = setWorldbookEntriesSelection(analysisSourcesState.selected, source, Boolean(target.checked))
    analysisSourcesState = syncAnalysisSourcesState({ selected, notice: null })
    render()
    await persistAnalysisSettings({ selected, renderAfterSave: false })
  }
  async function toggleCharacterCardOpenings(target) {
    const sourceId = String(target?.dataset?.bioweaveAnalysisCharacterOpeningToggle ?? '').trim()
    if (!sourceId || target.disabled) return
    const source = analysisSourcesState.sources.find(item => item.source_id === sourceId)
    if (!source) return
    captureAnalysisSourceDisclosure()
    const selected = setCharacterCardOpeningsSelection(analysisSourcesState.selected, source, Boolean(target.checked))
    analysisSourcesState = syncAnalysisSourcesState({ selected, notice: null })
    render()
    await persistAnalysisSettings({ selected, renderAfterSave: false })
  }
  function analysisSectionSourceIds(target) {
    try {
      const value = JSON.parse(target?.closest?.('[data-bioweave-analysis-section]')?.dataset?.bioweaveAnalysisSectionSourceIds ?? '[]')
      return Array.isArray(value) ? [...new Set(value.map(item => String(item ?? '').trim()).filter(Boolean))] : []
    } catch {
      return []
    }
  }
  async function toggleAnalysisSection(target) {
    if (!target || target.disabled) return
    const sourceIds = analysisSectionSourceIds(target)
    if (!sourceIds.length) return
    captureAnalysisSourceDisclosure()
    let selected = analysisSourcesState.selected
    const pendingWorldbooks = []
    for (const sourceId of sourceIds) {
      const source = analysisSourcesState.sources.find(item => item.source_id === sourceId)
      if (!source || source.available === false) continue
      if (source.source_type === 'worldbook') {
        if (target.checked && !source.content_loaded) {
          pendingWorldbooks.push(sourceId)
        } else {
          selected = setWorldbookEntriesSelection(selected, source, Boolean(target.checked))
        }
        continue
      }
      for (const field of Array.isArray(source.fields) ? source.fields : []) {
        const fieldKey = String(field?.field_key ?? '').trim()
        const selectable = fieldKey === 'description' || fieldKey === 'opening:main' || /^opening:alternate:\d+$/.test(fieldKey)
        if (!selectable || field?.available === false) continue
        selected = updateSourceSelection(
          selected,
          {
            source_id: sourceId,
            field_key: fieldKey,
          },
          Boolean(target.checked),
        )
      }
    }
    analysisSourcesState = syncAnalysisSourcesState({ selected, notice: null })
    render()
    await persistAnalysisSettings({ selected, renderAfterSave: false })
    for (const sourceId of pendingWorldbooks) {
      await loadWorldbookSourceForUi(sourceId, { selectAll: true })
    }
  }
  function syncAnalysisWorldbookToggles() {
    if (!root) return
    root.querySelectorAll?.('[data-bioweave-analysis-worldbook-toggle]').forEach(toggle => {
      const sourceId = String(toggle.dataset?.bioweaveAnalysisWorldbookToggle ?? '').trim()
      const source = analysisSourcesState.sources.find(item => item.source_id === sourceId)
      const state = worldbookSelectionState(source, analysisSourcesState.selected)
      toggle.checked = state.checked
      toggle.indeterminate = state.indeterminate
      toggle.setAttribute('aria-checked', state.indeterminate ? 'mixed' : String(state.checked))
    })
  }
  function syncAnalysisCharacterOpeningToggles() {
    if (!root) return
    root.querySelectorAll?.('[data-bioweave-analysis-character-opening-toggle]').forEach(toggle => {
      const sourceId = String(toggle.dataset?.bioweaveAnalysisCharacterOpeningToggle ?? '').trim()
      const source = analysisSourcesState.sources.find(item => item.source_id === sourceId)
      const state = characterOpeningSelectionState(source, analysisSourcesState.selected)
      toggle.checked = state.checked
      toggle.indeterminate = state.indeterminate
      toggle.setAttribute('aria-checked', state.indeterminate ? 'mixed' : String(state.checked))
    })
  }
  function syncAnalysisSectionToggles() {
    if (!root) return
    root.querySelectorAll?.('[data-bioweave-analysis-section-toggle]').forEach(toggle => {
      toggle.indeterminate = toggle.getAttribute('aria-checked') === 'mixed'
    })
  }
  async function loadAllWorldbooksForSelection({ sourceIds = null } = {}) {
    const requestedSourceIds = sourceIds instanceof Set ? sourceIds : Array.isArray(sourceIds) ? new Set(sourceIds) : null
    const unloaded = analysisSourcesState.sources.filter(
      source =>
        source.source_type === 'worldbook' &&
        !source.content_loaded &&
        source.host_key &&
        (!requestedSourceIds || requestedSourceIds.has(source.source_id)),
    )
    if (!unloaded.length) return analysisSourcesState.sources
    const { chatId, token } = currentAnalysisChatToken()
    const requestId = analysisSourceRequestSequence
    const loadingWorldbookIds = [...new Set([...(analysisSourcesState.loadingWorldbookIds ?? []), ...unloaded.map(source => source.source_id)])]
    analysisSourcesState = syncAnalysisSourcesState({
      loading: true,
      loadingWorldbookIds,
      chatId,
      notice: null,
    })
    render()
    try {
      const context = runtime.st?.getContext?.() ?? hostContextForApp()
      const loaded = await Promise.all(
        unloaded.map(source =>
          loadWorldbookSource(source, {
            context,
            fetchRef: runtime.st?.fetch ?? globalThis.fetch,
            getRequestHeaders: runtime.st?.getRequestHeaders,
            cache: worldbookCache,
          }),
        ),
      )
      assertAnalysisChatToken(token)
      if (requestId !== analysisSourceRequestSequence) return null
      const loadedById = new Map(loaded.map(source => [source.source_id, source]))
      const sources = analysisSourcesState.sources.map(source => {
        const next = loadedById.get(source.source_id)
        return next
          ? {
              ...source,
              ...next,
              scopes: [...new Set([...(source.scopes ?? []), ...(next.scopes ?? [])])],
            }
          : source
      })
      const failed = loaded.some(source => !source?.content_loaded)
      analysisSourcesState = syncAnalysisSourcesState({
        loaded: true,
        loading: false,
        loadingWorldbookIds: (analysisSourcesState.loadingWorldbookIds ?? []).filter(value => !loadingWorldbookIds.includes(value)),
        sources,
        chatId,
        notice: null,
      })
      if (failed) notify('部分世界书条目读取失败，已选择成功读取的内容。', 'warning', documentRef)
      render()
      return sources
    } catch {
      if (requestId !== analysisSourceRequestSequence) return null
      try {
        assertAnalysisChatToken(token)
      } catch {
        return null
      }
      analysisSourcesState = syncAnalysisSourcesState({
        loading: false,
        loadingWorldbookIds: (analysisSourcesState.loadingWorldbookIds ?? []).filter(value => !loadingWorldbookIds.includes(value)),
        chatId,
        notice: null,
      })
      notify('世界书条目读取失败，当前选择仍保留。', 'error', documentRef)
      render()
      return analysisSourcesState.sources
    }
  }
  // World Model 与分析输入预览共用同一份临时 AnalysisInput 收集流程。
  async function collectCurrentAnalysisInput() {
    const { chatId, token } = currentAnalysisChatToken()
    if (!analysisSourcesState.loaded || analysisSourcesState.chatId !== chatId) {
      await loadAnalysisSourcesState()
    }
    await waitForAnalysisSourcesIdle()
    assertAnalysisChatToken(token)
    const currentAnalysisSettings = readAnalysisSettings(chatId)
    if (currentAnalysisSettings.worldbooks.mode === 'all') {
      await loadAllWorldbooksForSelection()
    } else {
      const selectedWorldbookIds = new Set(analysisSourcesState.selected.filter(item => item?.entry_id).map(item => item.source_id))
      await loadAllWorldbooksForSelection({ sourceIds: selectedWorldbookIds })
    }
    assertAnalysisChatToken(token)
    const context = runtime.st?.getContext?.() ?? hostContextForApp()
    const currentBioWeaveFloor =
      typeof runtime.resolveCurrentBioWeaveFloor === 'function'
        ? await runtime.resolveCurrentBioWeaveFloor()
        : null
    const externalMemoryProviders = await probeExternalMemoryProviders({
      context,
    }).catch(() => detectExternalMemoryProviders({ context }))
    assertAnalysisChatToken(token)
    if (!globalRecentStoryLoaded) loadGlobalRecentStoryState()
    const input = await collectAnalysisContext({
      sources: analysisSourcesState.sources,
      selected: analysisSourcesState.selected,
      context,
      chatId,
      recentStory: analysisSourcesState.recentStory,
      globalRecentStory,
      externalMemory: analysisSourcesState.externalMemory,
      externalMemoryProviders,
      upperBoundIndex: currentBioWeaveFloor?.index ?? null,
      includePersonaInTokenEstimate: false,
    })
    let eventInput = null
    if (typeof runtime.getCurrentFloorAnalysisInput === 'function') {
      eventInput = await runtime.getCurrentFloorAnalysisInput()
    }
    return {
      input,
      eventInput,
      chatId,
      token,
    }
  }
  async function refreshAnalysisPreview() {
    if (analysisPreviewState.busy) return
    captureAnalysisSourceDisclosure()
    const { chatId, token } = currentAnalysisChatToken()
    const requestId = ++analysisPreviewSequence
    analysisPreviewState = {
      ...analysisPreviewState,
      busy: true,
      chatId,
      error: null,
      worldModelTrace: null,
    }
    if (route === 'settings' || route === 'world') render()
    try {
      const collected = await collectCurrentAnalysisInput()
      assertAnalysisChatToken(token)
      if (requestId !== analysisPreviewSequence) return
      analysisPreviewState = {
        busy: false,
        mode: analysisPreviewState.mode,
        analysisType: analysisPreviewState.analysisType,
        input: collected.input,
        eventInput: collected.eventInput,
        chatId: collected.chatId,
        error: null,
        worldModelTrace: null,
      }
    } catch (error) {
      if (requestId !== analysisPreviewSequence) return
      try {
        assertAnalysisChatToken(token)
      } catch {
        return
      }
      analysisPreviewState = {
        ...analysisPreviewState,
        busy: false,
        chatId,
        error: '分析输入预览读取失败，请检查当前 Chat 的来源设置。',
      }
    }
    if (requestId === analysisPreviewSequence && (route === 'settings' || route === 'world')) render()
  }
  function invalidateWorldModelView({ deferReload = true, renderView = true } = {}) {
    worldModelLoadGeneration += 1
    worldModelState = {
      ...createWorldModelState(),
      chatId: runtime.chat.current(),
      reloadPending: deferReload,
    }
    if (renderView && route === 'world') render()
  }
  function reloadWorldModelFromRuntime() {
    const chatId = runtime.chat.current()
    const token = runtime.chat.token?.()
    const generation = ++worldModelLoadGeneration
    const resolver = runtime.resolveWorldModelAtOrBefore
    worldModelState = {
      ...createWorldModelState(),
      loading: true,
      chatId,
    }
    if (typeof resolver !== 'function') {
      worldModelState = {
        ...worldModelState,
        loaded: true,
        loading: false,
      }
      return
    }
    void resolver().then((resolved) => {
      if (generation !== worldModelLoadGeneration) return
      if (runtime.chat.current() !== chatId) return
      try {
        runtime.chat.assert?.(token)
      } catch {
        return
      }
      let model = null
      let notice = null
      try {
        model = resolved?.model ? normalizeStoredWorldModel(resolved.model) : null
      } catch {
        notice = '已保存的世界模型格式无效，请重新分析。'
      }
      worldModelState = {
        ...createWorldModelState(),
        loaded: true,
        chatId,
        model,
        meta: resolved?.meta ?? null,
        notice,
      }
      if (route === 'world') render()
    }).catch(() => {
      if (generation !== worldModelLoadGeneration) return
      if (runtime.chat.current() !== chatId) return
      try {
        runtime.chat.assert?.(token)
      } catch {
        return
      }
      worldModelState = {
        ...createWorldModelState(),
        loaded: true,
        chatId,
        notice: '世界模型读取失败，请重试。',
      }
      if (route === 'world') render()
    })
  }
  function loadWorldModelState() {
    const chatId = runtime.chat.current()
    if (worldModelState.reloadPending) return
    if (worldModelState.loading && worldModelState.chatId === chatId) return
    if (worldModelState.loaded && worldModelState.chatId === chatId) return
    reloadWorldModelFromRuntime()
  }
  function worldModelOperationError(error) {
    const code = String(error?.code ?? error?.message ?? '')
    const diagnostic = String(error?.diagnostic_code ?? error?.diagnosticCode ?? error?.error_code ?? '')
      .trim()
      .toLowerCase()
    const status = sharedStatusFromError(error)
    const preservesLegacyTransportCopy =
      status === null &&
      (code === 'REQUEST_TIMEOUT' ||
        code.startsWith('REQUEST_TIMEOUT_') ||
        code === 'REQUEST_ABORTED' ||
        code.startsWith('REQUEST_ABORTED_') ||
        diagnostic === 'timeout' ||
        diagnostic === 'aborted' ||
        diagnostic === 'request_timeout' ||
        diagnostic === 'request_aborted')
    const transportMessage = preservesLegacyTransportCopy ? '' : sharedTransportErrorMessage(error)
    if (transportMessage) return `${transportMessage} 上一份模型已保留。`
    const messages = {
      API_PROFILE_NOT_CONFIGURED: '世界分析尚未配置 API，请在设置的任务分配中选择可用配置。',
      API_PROFILE_INVALID: '世界分析 API 配置无效，请检查 URL 和模型。',
      ST_CURRENT_API_UNAVAILABLE: 'SillyTavern 当前 API 不可用。',
      ST_CHAT_COMPLETION_UNAVAILABLE: '独立 API 服务不可用，请检查 API 来源设置。',
      WORLD_ANALYZER_UNAVAILABLE: '世界分析功能暂不可用，请重新加载 BioWeave。',
      WORLD_MODEL_INVALID: 'AI 返回的世界模型格式不符合要求，上一份模型已保留。',
      ST_METADATA_STORAGE_UNAVAILABLE: '当前 Chat 存储不可用，当前模块草稿仍保留。',
      STALE_CHAT: 'Chat 已切换，本次世界模型结果未保存。',
      WORLD_MODEL_SAVE_FAILED: '保存失败，当前模块草稿仍保留。',
      SAVE_FAILED: '保存失败，当前模块草稿仍保留。',
      ST_SAVE_CHAT_FAILED: '保存失败，当前模块草稿仍保留。',
      ST_CHAT_SAVE_FAILED: '保存失败，当前模块草稿仍保留。',
      NO_CHARACTER_FLOOR: '当前没有可分析的 Character Floor，分析结果未保存。',
      BIOWEAVE_USER_FLOOR_WRITE_FORBIDDEN: '当前目标不是 Character Floor，BioWeave 数据未保存。',
      REQUEST_TIMEOUT: '世界模型分析请求超时，上一份模型已保留。',
      REQUEST_ABORTED: '世界模型分析请求已取消，上一份模型已保留。',
    }
    const matchedCode = Object.keys(messages).find(key => code === key || code.startsWith(`${key}_`))
    return messages[matchedCode] ?? '世界模型操作失败，上一份模型已保留。'
  }
  function currentWorldModelSelection() {
    const species = normalizeWorldModelSpeciesSelection(worldModelState.model, worldModelState.selectedSpecies)
    const type = normalizeWorldModelBiologicalTypeSelection(worldModelState.model, worldModelState.selectedBiologicalType)
    return {
      speciesIndex: species?.speciesIndex ?? null,
      typeIndex: type?.typeIndex ?? null,
    }
  }
  function captureWorldModelSectionDraft() {
    const section = worldModelState.editingSection
    if (!section) return worldModelState.sectionDraft
    const form = root?.querySelector?.('[data-bioweave-world-section-form]')
    if (!form) return worldModelState.sectionDraft
    const draft = extractWorldModelSection(form, section)
    if (draft === null) return worldModelState.sectionDraft
    const original = getWorldModelSection(worldModelState.model, section, currentWorldModelSelection())
    worldModelState = {
      ...worldModelState,
      sectionDraft: draft,
      sectionDirty: JSON.stringify(draft) !== JSON.stringify(original),
    }
    return draft
  }
  async function confirmWithPopup(title, message) {
    const context = hostPopupContext()
    const confirm = context?.Popup?.show?.confirm
    const affirmative = context?.POPUP_RESULT?.AFFIRMATIVE
    if (typeof confirm !== 'function' || affirmative === undefined) {
      notify('当前宿主不支持确认弹窗，操作已取消。', 'error', documentRef)
      return false
    }
    try {
      const result = await confirm.call(context.Popup.show, title, message)
      return result === affirmative
    } catch {
      notify('确认弹窗打开失败，操作已取消。', 'error', documentRef)
      return false
    }
  }
  async function canDiscardWorldModelSectionDraft() {
    if (!worldModelState.editingSection || !worldModelState.sectionDirty) return true
    return confirmWithPopup('放弃未保存修改', '当前修改尚未保存，是否放弃？')
  }
  async function requestAbortWorldModelAnalysis() {
    const controller = worldModelAbortController
    if (!worldModelState.busy || !controller || worldModelAbortConfirmOpen) return false
    worldModelAbortConfirmOpen = true
    try {
      const confirmed = await confirmWithPopup('终止世界模型分析', '当前分析仍在进行，是否终止本次分析？')
      if (!confirmed) return false
      if (!worldModelState.busy || worldModelAbortController !== controller || controller.signal.aborted) {
        return false
      }
      controller.abort()
      return true
    } finally {
      worldModelAbortConfirmOpen = false
    }
  }
  function clearWorldModelSectionDraft() {
    worldModelState = {
      ...worldModelState,
      editingSection: null,
      sectionDraft: null,
      sectionDirty: false,
    }
  }
  async function beginWorldModelSectionEdit(section) {
    if (!worldModelState.model || !WORLD_MODEL_SECTION_KEYS.includes(section)) return false
    if (worldModelState.editingSection === section) return true
    if (worldModelState.sectionDirty) captureWorldModelSectionDraft()
    if (!(await canDiscardWorldModelSectionDraft())) return false
    const selection = currentWorldModelSelection()
    worldModelState = {
      ...worldModelState,
      editingSection: section,
      sectionDraft: getWorldModelSection(worldModelState.model, section, selection),
      sectionDirty: false,
      notice: null,
    }
    render()
    return true
  }
  function cancelWorldModelSectionEdit() {
    clearWorldModelSectionDraft()
    worldModelState = { ...worldModelState, notice: null }
    render()
  }
  async function selectWorldModelType(speciesIndex, typeIndex = null) {
    if (!worldModelState.model) return false
    if (worldModelState.sectionDirty) captureWorldModelSectionDraft()
    if (!(await canDiscardWorldModelSectionDraft())) return false
    const species = createWorldModelSpeciesSelection(worldModelState.model, speciesIndex)
    const biologicalType = typeIndex === null || typeIndex === undefined
      ? null
      : createWorldModelBiologicalTypeSelection(worldModelState.model, speciesIndex, typeIndex)
    if (!species || (typeIndex !== null && typeIndex !== undefined && !biologicalType)) return false
    worldModelState = {
      ...worldModelState,
      selectedSpecies: species,
      selectedBiologicalType: biologicalType,
      editingSection: null,
      sectionDraft: null,
      sectionDirty: false,
      notice: null,
    }
    render()
    return true
  }
  function updateWorldModelSectionDraft(mutator) {
    if (!worldModelState.editingSection) return
    captureWorldModelSectionDraft()
    const current =
      worldModelState.sectionDraft ?? getWorldModelSection(worldModelState.model, worldModelState.editingSection, currentWorldModelSelection())
    const next = mutator(current)
    worldModelState = {
      ...worldModelState,
      sectionDraft: next,
      sectionDirty: true,
      notice: null,
    }
    render()
  }
  async function refreshTrackingAfterWorldModelSave(reason) {
    if (typeof runtime.refreshTrackingRegistry !== 'function') return
    try {
      await runtime.refreshTrackingRegistry(reason)
    } catch (error) {
      // World Model 已经成功保存；Registry 会在下一次 Runtime 生命周期事件中重试。
      traceApi('tracking-registry-refresh-after-world-model-save-error', {
        error,
        reason,
      })
    }
  }
  async function saveWorldModelSection() {
    const section = worldModelState.editingSection
    if (!section || !worldModelState.model) return
    captureWorldModelSectionDraft()
    const selection = currentWorldModelSelection()
    let model
    try {
      const base = normalizeStoredWorldModel(worldModelState.model)
      const patched = applyWorldModelSection(base, section, worldModelState.sectionDraft, {
        selectedSpeciesIndex: selection.speciesIndex,
        selectedTypeIndex: selection.typeIndex,
      })
      model = normalizeStoredWorldModel(patched)
    } catch (error) {
      worldModelState = { ...worldModelState, notice: null }
      notify(worldModelOperationError(error), 'error', documentRef)
      render()
      return
    }
    const { chatId, token } = currentAnalysisChatToken()
    worldModelState = { ...worldModelState, busy: true, notice: null }
    render()
    try {
      if (typeof runtime.saveWorldModel !== 'function') throw new Error('ST_FLOOR_STORAGE_UNAVAILABLE')
      const existingMeta = worldModelState.meta && typeof worldModelState.meta === 'object' ? worldModelState.meta : null
      const nextMeta = existingMeta ? { ...existingMeta } : null
      let metadataChanged = false
      if (nextMeta && Object.prototype.hasOwnProperty.call(nextMeta, 'last_saved_at')) {
        nextMeta.last_saved_at = new Date().toISOString()
        metadataChanged = true
      }
      if (nextMeta && Object.prototype.hasOwnProperty.call(nextMeta, 'last_saved_by')) {
        nextMeta.last_saved_by = 'manual'
        metadataChanged = true
      }
      await runtime.saveWorldModel({ model, meta: metadataChanged ? nextMeta : worldModelState.meta })
      assertAnalysisChatToken(token)
      await refreshTrackingAfterWorldModelSave('world-model-manual-save')
      worldModelState = {
        ...worldModelState,
        busy: false,
        model,
        meta: metadataChanged ? nextMeta : worldModelState.meta,
        editingSection: null,
        sectionDraft: null,
        sectionDirty: false,
        notice: null,
      }
      notify('当前模块已保存。', 'success', documentRef)
    } catch (error) {
      try {
        assertAnalysisChatToken(token)
      } catch {
        return
      }
      worldModelState = {
        ...worldModelState,
        busy: false,
        notice: null,
      }
      notify(worldModelOperationError(error), 'error', documentRef)
    }
    render()
  }
  async function beginWorldModelCollectionAdd(kind, speciesIndex = null) {
    if (worldModelState.busy) return
    if (worldModelState.sectionDirty) captureWorldModelSectionDraft()
    if (!(await canDiscardWorldModelSectionDraft())) return
    worldModelState = {
      ...worldModelState,
      collectionEditor: {kind, speciesIndex},
      notice: null,
    }
    render()
    const input = root?.querySelector?.('[data-bioweave-world-model-collection-input]')
    input?.focus?.()
  }
  function cancelWorldModelCollectionAdd() {
    if (!worldModelState.collectionEditor) return
    worldModelState = {...worldModelState, collectionEditor: null, notice: null}
    render()
  }
  async function beginWorldModelCollectionEdit(kind) {
    if (worldModelState.busy) return
    const base = normalizeStoredWorldModel(worldModelState.model)
    const selectedSpecies = normalizeWorldModelSpeciesSelection(base, worldModelState.selectedSpecies)
    const selectedBiologicalType = normalizeWorldModelBiologicalTypeSelection(base, worldModelState.selectedBiologicalType)
    if (kind === 'species' && selectedSpecies) {
      worldModelState = {
        ...worldModelState,
        collectionEditor: {
          kind,
          mode: 'edit',
          speciesIndex: selectedSpecies.speciesIndex,
          typeIndex: null,
          initialName: selectedSpecies.speciesName,
        },
        notice: null,
      }
    } else if (kind === 'biological-type' && selectedSpecies && selectedBiologicalType && selectedBiologicalType.speciesIndex === selectedSpecies.speciesIndex) {
      worldModelState = {
        ...worldModelState,
        collectionEditor: {
          kind,
          mode: 'edit',
          speciesIndex: selectedBiologicalType.speciesIndex,
          typeIndex: selectedBiologicalType.typeIndex,
          initialName: selectedBiologicalType.typeName,
        },
        notice: null,
      }
    } else {
      return
    }
    render()
    const input = root?.querySelector?.('[data-bioweave-world-model-collection-input]')
    input?.focus?.()
    input?.select?.()
  }
  async function saveWorldModelCollectionEdit(operation, {speciesIndex = null, typeIndex = null, name = ''} = {}) {
    if (worldModelState.busy) return
    if (worldModelState.sectionDirty) captureWorldModelSectionDraft()
    if (!(await canDiscardWorldModelSectionDraft())) return
    const base = normalizeStoredWorldModel(worldModelState.model ?? {schema_version: 1, species: [], medical_context: {}, exceptions: [], unknowns: []})
    const selectedSpecies = normalizeWorldModelSpeciesSelection(base, worldModelState.selectedSpecies)
    const selectedBiologicalType = normalizeWorldModelBiologicalTypeSelection(base, worldModelState.selectedBiologicalType)
    if (operation === 'delete-species-selection') {
      if (!selectedSpecies) {
        worldModelState = {...worldModelState, selectedSpecies: null, selectedBiologicalType: null}
        render()
        return
      }
      speciesIndex = selectedSpecies.speciesIndex
      operation = 'remove-species'
    }
    if (operation === 'delete-biological-type-selection') {
      if (!selectedSpecies || !selectedBiologicalType || selectedBiologicalType.speciesIndex !== selectedSpecies.speciesIndex) {
        worldModelState = {...worldModelState, selectedBiologicalType: null}
        render()
        return
      }
      speciesIndex = selectedBiologicalType.speciesIndex
      typeIndex = selectedBiologicalType.typeIndex
      operation = 'remove-biological-type'
    }
    if (operation === 'rename-species-selection') {
      if (!selectedSpecies) return
      speciesIndex = selectedSpecies.speciesIndex
      operation = 'rename-species'
    }
    if (operation === 'rename-biological-type-selection') {
      if (!selectedSpecies || !selectedBiologicalType || selectedBiologicalType.speciesIndex !== selectedSpecies.speciesIndex) return
      speciesIndex = selectedBiologicalType.speciesIndex
      typeIndex = selectedBiologicalType.typeIndex
      operation = 'rename-biological-type'
    }
    const result = applyWorldModelCollectionEdit(base, {operation, speciesIndex, typeIndex, name})
    if (!result.changed) {
      if (operation.startsWith('add-') && String(name ?? '').trim()) notify('该名称已存在。', 'warning', documentRef)
      worldModelState = {...worldModelState, collectionEditor: null, notice: null}
      render()
      return
    }
    let model
    try {
      model = normalizeStoredWorldModel(result.model)
    } catch (error) {
      notify(worldModelOperationError(error), 'error', documentRef)
      return
    }
    const {token} = currentAnalysisChatToken()
    worldModelState = {...worldModelState, busy: true, collectionEditor: null, notice: null}
    render()
    try {
      if (typeof runtime.saveWorldModel !== 'function') throw new Error('ST_FLOOR_STORAGE_UNAVAILABLE')
      await runtime.saveWorldModel({model, meta: worldModelState.meta})
      assertAnalysisChatToken(token)
      await refreshTrackingAfterWorldModelSave('world-model-manual-collection-save')
      let nextSpecies = selectedSpecies
      let nextBiologicalType = selectedBiologicalType
      if (operation === 'add-species') {
        nextSpecies = createWorldModelSpeciesSelection(model, model.species.length - 1)
        nextBiologicalType = null
      }
      if (operation === 'add-biological-type') {
        const nextSpeciesIndex = speciesIndex
        const nextTypes = model.species?.[nextSpeciesIndex]?.biological_types ?? []
        nextSpecies = createWorldModelSpeciesSelection(model, nextSpeciesIndex)
        nextBiologicalType = createWorldModelBiologicalTypeSelection(model, nextSpeciesIndex, nextTypes.length - 1)
      }
      if (operation === 'remove-species') {
        nextSpecies = null
        nextBiologicalType = null
      }
      if (operation === 'remove-biological-type') nextBiologicalType = null
      if (operation === 'rename-species') {
        nextSpecies = createWorldModelSpeciesSelection(model, speciesIndex)
        nextBiologicalType = selectedBiologicalType
          ? createWorldModelBiologicalTypeSelection(model, speciesIndex, selectedBiologicalType.typeIndex)
          : null
      }
      if (operation === 'rename-biological-type') {
        nextSpecies = createWorldModelSpeciesSelection(model, speciesIndex)
        nextBiologicalType = createWorldModelBiologicalTypeSelection(model, speciesIndex, typeIndex)
      }
      worldModelState = {
        ...worldModelState,
        loaded: true,
        busy: false,
        model,
        selectedSpecies: nextSpecies,
        selectedBiologicalType: nextBiologicalType,
        notice: null,
      }
      notify('世界模型集合已保存。', 'success', documentRef)
    } catch (error) {
      try {
        assertAnalysisChatToken(token)
      } catch {
        return
      }
      worldModelState = {...worldModelState, busy: false, collectionEditor: null, notice: null}
      notify(worldModelOperationError(error), 'error', documentRef)
    }
    render()
  }
  async function saveWorldModelCollectionInput(actionTarget) {
    const form = actionTarget.closest?.('[data-bioweave-world-model-collection-form]')
    const name = form?.querySelector?.('[data-bioweave-world-model-collection-input]')?.value ?? ''
    const kind = form?.dataset?.bioweaveWorldModelCollectionKind
    const mode = form?.dataset?.bioweaveWorldModelCollectionMode ?? 'add'
    const speciesIndex = Number.isInteger(Number(form?.dataset?.bioweaveWorldSpeciesIndex))
      ? Number(form?.dataset?.bioweaveWorldSpeciesIndex)
      : null
    if (kind === 'species') return saveWorldModelCollectionEdit(mode === 'edit' ? 'rename-species-selection' : 'add-species', {name})
    if (kind === 'biological-type') return saveWorldModelCollectionEdit(mode === 'edit' ? 'rename-biological-type-selection' : 'add-biological-type', {speciesIndex, name})
    return undefined
  }
  async function analyzeWorldModel() {
    if (worldModelState.busy) return
    try {
      runtime.assertBioWeaveEnabled?.()
    } catch (error) {
      if (error?.code === 'BIOWEAVE_DISABLED') {
        notify('BioWeave 当前已暂停，请先启用。', 'info', documentRef)
        return
      }
      throw error
    }
    if (worldModelState.sectionDirty) captureWorldModelSectionDraft()
    if (!(await canDiscardWorldModelSectionDraft())) return
    if (worldModelState.editingSection) clearWorldModelSectionDraft()
    const { chatId, token } = currentAnalysisChatToken()
    const controller = new AbortController()
    worldModelAbortController = controller
    worldModelTraceChatId = chatId
    analysisPreviewState = {
      ...analysisPreviewState,
      chatId,
      error: null,
      worldModelTrace: null,
    }
    worldModelState = { ...worldModelState, busy: true, notice: null }
    let activityResult = 'cancelled'
    let activityError = null
    runtime.startActivity?.('world_analysis')
    if (route === 'world') render()
    try {
      const collected = await collectCurrentAnalysisInput()
      assertAnalysisChatToken(token)
      runtime.assertBioWeaveEnabled?.()
      const analyze = analyzer?.analyzeWorldModel ?? analyzer?.analyzeWorld
      if (typeof analyze !== 'function') throw new Error('WORLD_ANALYZER_UNAVAILABLE')
      let result
      try {
        result = await analyze({
          analysisInput: collected.input,
          signal: controller.signal,
        })
        traceApi('world-model-analyzer-success', {
          phase: 'analyzer',
          resultType: typeof result,
          speciesCount: Array.isArray(result?.species) ? result.species.length : 0,
        })
      } catch (error) {
        traceApi('world-model-analyzer-error', { error, phase: 'analyzer' })
        throw error
      }
      const model = normalizeStoredWorldModel(result)
      assertAnalysisChatToken(token)
      runtime.assertBioWeaveEnabled?.()
      const analyzedAt = new Date().toISOString()
      const meta = {
        last_analyzed_at: analyzedAt,
        last_saved_at: analyzedAt,
        last_saved_by: 'ai',
        source_summary: summarizeAnalysisInput(collected.input),
      }
      if (typeof runtime.saveWorldModel !== 'function') throw new Error('ST_FLOOR_STORAGE_UNAVAILABLE')
      await runtime.saveWorldModel({ model, meta, automatic: true })
      assertAnalysisChatToken(token)
      await refreshTrackingAfterWorldModelSave('world-model-ai-save')
      analysisPreviewState = {
        ...analysisPreviewState,
        busy: false,
        input: collected.input,
        chatId,
        error: null,
      }
      worldModelState = {
        ...worldModelState,
        loaded: true,
        busy: false,
        model,
        meta,
        chatId,
        selectedSpecies: null,
        selectedBiologicalType: null,
        editingSection: null,
        sectionDraft: null,
        sectionDirty: false,
        notice: null,
      }
      activityResult = 'success'
      traceApi('world-model-ui-success', {
        phase: 'world-model-ui',
        speciesCount: Array.isArray(model.species) ? model.species.length : 0,
        modelSaved: true,
      })
      notify('世界模型分析成功并已保存。', 'success', documentRef)
    } catch (error) {
      activityError = error
      const activityCode = String(error?.code ?? error?.message ?? '')
      activityResult = activityCode === 'REQUEST_ABORTED' || activityCode.startsWith('REQUEST_ABORTED_') || activityCode === 'STALE_CHAT'
        ? 'cancelled'
        : 'error'
      traceApi('world-model-ui-error', {
        error,
        phase: 'world-model-ui',
        state: 'error',
      })
      try {
        assertAnalysisChatToken(token)
      } catch {
        return
      }
      const code = String(error?.code ?? error?.message ?? '')
      const feedbackType = code === 'REQUEST_ABORTED' || code.startsWith('REQUEST_ABORTED_') ? 'info' : 'error'
      worldModelState = { ...worldModelState, busy: false, notice: null }
      notify(worldModelOperationError(error), feedbackType, documentRef)
    } finally {
      if (worldModelAbortController === controller) worldModelAbortController = null
      runtime.finishActivity?.('world_analysis', activityResult, activityError)
    }
    if (route === 'world') render()
  }
  function setAnalysisPreviewMode(mode) {
    const nextMode = mode === 'raw' ? 'raw' : 'structure'
    if (analysisPreviewState.mode === nextMode) return
    analysisPreviewState = { ...analysisPreviewState, mode: nextMode }
    if (route === 'settings') render()
  }
  function setAnalysisPreviewType(type) {
    const nextType = type === 'event' ? 'event' : 'world'
    if (analysisPreviewState.analysisType === nextType) return
    analysisPreviewState = { ...analysisPreviewState, analysisType: nextType }
    if (route === 'settings') render()
  }
  async function setAllAnalysisSources(selectAll) {
    captureAnalysisSourceDisclosure()
    const sources = selectAll ? await loadAllWorldbooksForSelection() : analysisSourcesState.sources
    if (!sources) return
    const selected = selectAll ? selectAllSources(sources) : selectNoneSources()
    analysisSourcesState = syncAnalysisSourcesState({ selected, notice: null })
    render()
    await persistAnalysisSettings({ selected, renderAfterSave: false })
  }
  function updateRecentStoryState(target) {
    const current = normalizeRecentStorySettings(analysisSourcesState.recentStory)
    const next =
      target?.dataset?.bioweaveRecentStoryUserRegex !== undefined
        ? normalizeRecentStorySettings({
            ...current,
            regex_user_enabled: Boolean(target.checked),
          })
        : normalizeRecentStorySettings({
            ...current,
            floor_count: target?.value,
          })
    analysisSourcesState = {
      ...analysisSourcesState,
      recentStory: next,
      notice: null,
    }
    return next
  }
  function readRecentStoryRegexSettings(scope = 'character') {
    const isGlobal = scope === 'global'
    const current = isGlobal ? normalizeRecentStorySettings(globalRecentStory) : normalizeRecentStorySettings(analysisSourcesState.recentStory)
    const rows = [
      ...(root?.querySelectorAll?.('[data-bioweave-recent-story-regex-row], [data-bioweave-recent-story-global-regex-row]') ?? []),
    ].filter(row => String(row.dataset?.bioweaveRecentStoryRegexScope ?? '').trim() === scope)
    if (!rows.length) return isGlobal ? { regex_rules: current.regex_rules } : current
    const regexRules = rows.map(row => ({
      pattern: row.querySelector?.('[data-bioweave-recent-story-regex-pattern]')?.value ?? '',
      type: row.querySelector?.('[data-bioweave-recent-story-regex-type]')?.value ?? 'extract',
      enabled: row.querySelector?.('[data-bioweave-recent-story-regex-enabled]')?.checked !== false,
    }))
    return isGlobal
      ? {
          regex_rules: normalizeRecentStorySettings({ regex_rules: regexRules }).regex_rules,
        }
      : normalizeRecentStorySettings({ ...current, regex_rules: regexRules })
  }
  function updateRecentStoryRegexState(scope = 'character') {
    const recentStory = readRecentStoryRegexSettings(scope)
    if (scope === 'global') {
      globalRecentStory = recentStory
      globalRecentStoryLoaded = true
      return recentStory
    }
    analysisSourcesState = {
      ...analysisSourcesState,
      recentStory,
      notice: null,
    }
    return recentStory
  }
  async function persistRecentStorySettings(target) {
    clearPendingRecentStorySaves()
    const recentStory = updateRecentStoryState(target)
    render()
    await persistAnalysisSettings({ recentStory })
  }
  async function persistRecentStoryRegexSettings(scope = 'character') {
    clearPendingRecentStorySaves()
    const recentStory = updateRecentStoryRegexState(scope)
    if (scope === 'global') {
      await persistRecentStoryGlobalSettings(recentStory)
      return
    }
    render()
    await persistAnalysisSettings({ recentStory })
  }
  async function addRecentStoryRegexRule(scope = 'character') {
    const current = readRecentStoryRegexSettings(scope)
    if (current.regex_rules.length >= 50) {
      if (scope === 'global') settingsState = { ...settingsState, notice: null }
      else analysisSourcesState = { ...analysisSourcesState, notice: null }
      notify(scope === 'global' ? '最多保存 50 条全局正则。' : '最多保存 50 条最近剧情规则。', 'warning', documentRef)
      render()
      return
    }
    const next = normalizeRecentStorySettings({
      ...current,
      regex_rules: [...current.regex_rules, { pattern: '', type: 'extract', enabled: true }],
    })
    const recentStory = scope === 'global' ? { regex_rules: next.regex_rules } : next
    if (scope === 'global') {
      globalRecentStory = recentStory
      globalRecentStoryLoaded = true
      analysisSourcesState = { ...analysisSourcesState, notice: null }
    } else {
      analysisSourcesState = {
        ...analysisSourcesState,
        recentStory,
        notice: null,
      }
    }
    render()
    if (scope === 'global') await persistRecentStoryGlobalSettings(recentStory)
    else await persistAnalysisSettings({ recentStory })
  }
  async function moveRecentStoryRegexRule(target, direction, scope = null) {
    const resolvedScope =
      scope ?? (String(target?.dataset?.bioweaveRecentStoryRegexScope ?? 'character').trim() === 'global' ? 'global' : 'character')
    const index = Number(target?.dataset?.bioweaveRecentStoryRegexIndex)
    if (!Number.isInteger(index)) return
    const current = readRecentStoryRegexSettings(resolvedScope)
    const nextIndex = index + direction
    if (index < 0 || index >= current.regex_rules.length || nextIndex < 0 || nextIndex >= current.regex_rules.length) return
    const regexRules = [...current.regex_rules]
    ;[regexRules[index], regexRules[nextIndex]] = [regexRules[nextIndex], regexRules[index]]
    const normalized = normalizeRecentStorySettings({
      ...current,
      regex_rules: regexRules,
    })
    const recentStory = resolvedScope === 'global' ? { regex_rules: normalized.regex_rules } : normalized
    if (resolvedScope === 'global') globalRecentStory = recentStory
    else
      analysisSourcesState = {
        ...analysisSourcesState,
        recentStory,
        notice: null,
      }
    render()
    if (resolvedScope === 'global') await persistRecentStoryGlobalSettings(recentStory)
    else await persistAnalysisSettings({ recentStory })
  }
  async function removeRecentStoryRegexRule(target, scope = null) {
    const resolvedScope =
      scope ?? (String(target?.dataset?.bioweaveRecentStoryRegexScope ?? 'character').trim() === 'global' ? 'global' : 'character')
    const index = Number(target?.dataset?.bioweaveRecentStoryRegexIndex)
    if (!Number.isInteger(index)) return
    const current = readRecentStoryRegexSettings(resolvedScope)
    if (index < 0 || index >= current.regex_rules.length) return
    const normalized = normalizeRecentStorySettings({
      ...current,
      regex_rules: current.regex_rules.filter((_, itemIndex) => itemIndex !== index),
    })
    const recentStory = resolvedScope === 'global' ? { regex_rules: normalized.regex_rules } : normalized
    if (resolvedScope === 'global') globalRecentStory = recentStory
    else
      analysisSourcesState = {
        ...analysisSourcesState,
        recentStory,
        notice: null,
      }
    render()
    if (resolvedScope === 'global') await persistRecentStoryGlobalSettings(recentStory)
    else await persistAnalysisSettings({ recentStory })
  }
  async function toggleExternalMemory(target) {
    const key = String(target?.dataset?.bioweaveExternalMemory ?? '').trim()
    if (!key || target.disabled) return
    const externalMemory = normalizeExternalMemorySettings({
      ...analysisSourcesState.externalMemory,
      [key]: Boolean(target.checked),
    })
    analysisSourcesState = {
      ...analysisSourcesState,
      externalMemory,
      notice: null,
    }
    render()
    await persistAnalysisSettings({ externalMemory })
  }
  function setTheme(value) {
    const nextTheme = THEME_VALUES.has(value) ? value : 'tavern'
    writeTheme(storageRef, nextTheme)
    if (!root) return nextTheme
    root.dataset.theme = nextTheme
    const button = root.querySelector('[data-bioweave-theme-button]')
    if (button) {
      const icon = button.querySelector('[data-bioweave-theme-icon]')
      if (icon) icon.className = themeIcon(nextTheme)
      button.setAttribute('title', '切换皮肤：' + themeLabel(nextTheme))
      button.setAttribute('aria-label', '切换皮肤：' + themeLabel(nextTheme))
      button.dataset.bioweaveTooltip = '切换皮肤：' + themeLabel(nextTheme)
      const tooltip = button.querySelector?.('[data-bioweave-header-tooltip]')
      if (tooltip) tooltip.textContent = '切换皮肤：' + themeLabel(nextTheme)
    }
    return nextTheme
  }
  function cycleTheme() {
    const values = ['tavern', 'light', 'dark']
    const current = root?.dataset?.theme ?? readTheme(storageRef)
    const index = values.indexOf(current)
    return setTheme(values[(index + 1) % values.length])
  }
  function currentChatLabel() {
    try {
      return runtime.chat.current() ?? '当前 Chat'
    } catch {
      return '当前 Chat'
    }
  }
  function currentBioWeaveEnabled() {
    try {
      return runtime.getBioWeaveEnabled?.() !== false
    } catch {
      return true
    }
  }
  function syncBioWeaveEnabledControl(enabled = currentBioWeaveEnabled()) {
    const active = enabled !== false
    const label = active ? '暂停 BioWeave' : '启用 BioWeave'
    const controls = root?.querySelectorAll?.('[data-bioweave-enabled-toggle]') ?? []
    controls.forEach(control => {
      const input = control.querySelector?.('input[type="checkbox"]')
      const text = control.querySelector?.('[data-bioweave-enabled-label]')
      if (!input || !text) return
      input.checked = active
      input.setAttribute('aria-label', label)
      text.textContent = active ? '已开启' : '已暂停'
      control.setAttribute('aria-label', label)
      control.setAttribute('title', label)
      control.dataset.bioweaveTooltip = label
      const tooltip = control.querySelector?.('[data-bioweave-header-tooltip]')
      if (tooltip) tooltip.textContent = label
    })
  }
  async function toggleBioWeaveEnabled() {
    const current = currentBioWeaveEnabled()
    if (current && !(await confirmWithPopup('暂停 BioWeave？', '当前聊天将停止 BioWeave 自动分析、追踪和上下文注入。已有数据仍会保留。'))) return
    if (typeof runtime.setBioWeaveEnabled !== 'function') {
      notify('当前 Runtime 不支持 BioWeave 总开关。', 'error', documentRef)
      return
    }
    try {
      await runtime.setBioWeaveEnabled(!current)
      notify(current ? 'BioWeave 已暂停。' : 'BioWeave 已启用。', 'info', documentRef)
    } catch (error) {
      notify(error?.message === 'STALE_CHAT' ? '当前 Chat 已变化，请重新操作。' : 'BioWeave 总开关保存失败。', 'error', documentRef)
    }
    render()
  }
  function abortUiWorldModelRequest() {
    const controller = worldModelAbortController
    worldModelAbortController = null
    worldModelAbortConfirmOpen = false
    if (controller && !controller.signal?.aborted) controller.abort()
    // Clear operations deliberately abort an in-flight request before
    // touching Floor data. Its stale-token catch exits before the normal
    // World Model error handler can release `busy`; release it here so a
    // failed/unknown clear cannot block the next analysis forever.
    if (worldModelState.busy) worldModelState = { ...worldModelState, busy: false }
  }
  function dataManagementOperationForKey(value) {
    const key = String(value ?? '').trim()
    return DATA_MANAGEMENT_OPERATIONS.find(operation => operation.key === key) ?? null
  }
  function dataManagementOperationForAction(value) {
    const action = String(value ?? '').trim()
    return DATA_MANAGEMENT_OPERATIONS.find(operation => operation.action === action) ?? null
  }
  function dataManagementOperationForEvent(event) {
    const type = String(event?.type ?? '').trim().toUpperCase()
    const payload = event?.payload ?? {}
    const explicitValues = [payload?.operation, payload?.operation_key, payload?.domain, payload?.scope, event?.operation]
    for (const explicit of explicitValues) {
      const byExplicit = dataManagementOperationForKey(explicit) ?? dataManagementOperationForAction(explicit)
      if (byExplicit) return byExplicit
    }
    if (type.includes('CHARACTER')) return dataManagementOperationForKey('character')
    if (type.includes('WORLD')) return dataManagementOperationForKey('world')
    return dataManagementOperationForKey('all')
  }
  function isRuntimeDataClearEvent(event) {
    const type = String(event?.type ?? '').trim().toUpperCase()
    if (!type) return false
    if (['BIOWEAVE_DATA_CLEARED', 'BIOWEAVE_CLEAR_COMPLETED', 'BIOWEAVE_CLEAR_SUCCEEDED', 'BIOWEAVE_CHAT_DATA_CLEARED', 'DATA_CLEARED', 'CLEAR_COMPLETED', 'CLEAR_SUCCEEDED'].includes(type)) return true
    return type.includes('CLEAR') && (type.includes('BIOWEAVE') || type.includes('DATA')) && !type.includes('FAIL') && !type.includes('ERROR')
  }
  function dataClearConfirmation(operation) {
    const chatLabel = currentChatLabel()
    const messages = {
      character: `当前聊天「${chatLabel}」的人物分析数据将被永久删除且不可撤销：清除人物相关 Floor 分析、事件和 canonical identity；API / Secret / 全局设置、世界书、角色卡、插件设置、Chat settings、聊天正文、Swipe 正文和其它插件数据均保留。确定继续吗？`,
      world: `当前聊天「${chatLabel}」的 World Model 分析数据将被永久删除且不可撤销：清除 Floor-owned World Model 及其 metadata；人物事件、identity、API / Secret / 全局设置、世界书、角色卡、插件设置、Chat settings、聊天正文、Swipe 正文和其它插件数据均保留。确定继续吗？`,
      all: `当前聊天「${chatLabel}」的全部分析数据将被永久删除且不可撤销：仅清除 BioWeave 明确允许清除的 Floor 分析数据；API / Secret / 全局设置、世界书、角色卡、插件设置、Chat settings、聊天正文、Swipe 正文和其它插件数据均保留。确定继续吗？`,
    }
    return messages[operation.key] ?? messages.all
  }
  function dataClearErrorMessage(error) {
    const code = String(error?.code ?? error?.error_code ?? error?.message ?? '').trim().toUpperCase()
    const messages = {
      CLEAR_RUNTIME_UNAVAILABLE: '当前宿主尚未提供 BioWeave 数据清除接口。',
      CLEAR_FAILED: '当前 Chat 数据清除失败，未报告成功。',
      CLEAR_SAVE_FAILED: '当前 Chat 数据保存失败，清除未完成。',
      CLEAR_PERSISTENCE_UNKNOWN: '当前 Chat 清除保存状态未知，未报告成功。',
      PERSISTENCE_UNKNOWN: '当前 Chat 清除保存状态未知，未报告成功。',
      STALE_CHAT: 'Chat 已切换，本次清除未执行。',
      CHAT_SCOPE_MISMATCH: 'Chat 已切换，本次清除未执行。',
      CLEAR_ABORTED: '当前 Chat 数据清除已取消。',
    }
    const matchedCode = Object.keys(messages).find(key => code === key || code.startsWith(`${key}_`))
    return messages[matchedCode] ?? '当前 Chat 的 BioWeave 数据清除失败，未报告成功。'
  }
  function dataClearFailureFromResult(result) {
    if (!result || typeof result !== 'object') return Object.assign(new Error('CLEAR_FAILED'), {code: 'CLEAR_FAILED'})
    const persistence = result.persistence ?? result.persisted ?? {}
    const state = String(result.commitState ?? result.commit_state ?? result.persistence_state ?? persistence.commitState ?? persistence.commit_state ?? persistence.state ?? '').trim().toLowerCase()
    if (result.ok !== true || result.success === false || result.error || state !== 'confirmed') {
      const failureCode = result.error_code ?? result.code ?? (state === 'unknown' || state === 'unconfirmed' ? 'CLEAR_PERSISTENCE_UNKNOWN' : state === 'failed' ? 'CLEAR_FAILED' : 'CLEAR_PERSISTENCE_UNKNOWN')
      const error = new Error(String(failureCode))
      error.code = String(failureCode)
      return error
    }
    return null
  }
  function resolveDataClearInvoker(operation) {
    const direct = runtime?.[operation.method]
    if (typeof direct === 'function') return () => direct.call(runtime)
    const unified = runtime?.clearBioWeaveData ?? runtime?.clearData
    if (typeof unified === 'function') return () => unified.call(runtime, operation.key)
    const nestedFacade = runtime?.dataLifecycle ?? runtime?.lifecycle
    const nested = nestedFacade?.[operation.method]
    if (typeof nested === 'function') return () => nested.call(nestedFacade)
    return null
  }
  function resetBusinessStateAfterDataClear(operation) {
    const all = operation.key === 'all'
    const character = operation.key === 'character' || all
    businessRefreshSequence += 1
    businessState = {
      ...businessState,
      loaded: false,
      loading: false,
      error: null,
      ...(character ? {trackingSubjects: {}, characterProfiles: {}} : {}),
      ...(all
        ? {
            activeEvents: [],
            currentFloor: null,
            currentState: null,
            currentStateStatus: 'NO_CHARACTER_FLOOR',
            currentStoryTime: null,
            currentStoryTimeStatus: null,
            currentStoryTimeDifferences: {},
            lastAnalysis: null,
            analysisStatus: {state: 'not_analyzed', busy: false},
          }
        : {}),
      ...(operation.key === 'character' || operation.key === 'world'
        ? {currentState: null, currentStateStatus: 'NO_CHARACTER_FLOOR'}
        : {}),
    }
  }
  function refreshUiAfterDataClear(operation) {
    analysisSourceRequestSequence += 1
    analysisSourceSaveSequence += 1
    clearAnalysisPreview()
    worldModelTraceChatId = null
    worldbookCache = clearWorldbookCache(worldbookCache)
    resetBusinessStateAfterDataClear(operation)
    if (operation.key === 'world' || operation.key === 'all') {
      invalidateWorldModelView({ deferReload: false })
    }
    if (operation.key === 'all') {
      const openSettingsSections = [...(analysisSourcesState.openSettingsSections ?? [])]
      analysisSourcesState = {...createAnalysisSourcesState(), openSettingsSections}
    }
  }
  async function clearDataManagement(action) {
    const operation = dataManagementOperationForAction(action) ?? dataManagementOperationForKey(action)
    if (!operation || dataManagementState.busy) return false
    const chatId = runtime.chat.current()
    dataManagementState = {
      busy: true,
      operation: operation.key,
      chatId,
    }
    render()
    try {
      if (!(await confirmWithPopup(operation.title, dataClearConfirmation(operation)))) return false
      if (runtime.chat.current() !== chatId) throw Object.assign(new Error('STALE_CHAT'), {code: 'STALE_CHAT'})
      abortUiWorldModelRequest()
      const invoke = resolveDataClearInvoker(operation)
      if (!invoke) throw Object.assign(new Error('CLEAR_RUNTIME_UNAVAILABLE'), {code: 'CLEAR_RUNTIME_UNAVAILABLE'})
      const result = await invoke()
      if (runtime.chat.current() !== chatId) throw Object.assign(new Error('STALE_CHAT'), {code: 'STALE_CHAT'})
      const failure = dataClearFailureFromResult(result)
      if (failure) throw failure
      refreshUiAfterDataClear(operation)
      const noOp = result?.changed === false || result?.changed === 0 || result?.noOp === true || result?.no_op === true || ['noop', 'no_op', 'already_empty'].includes(String(result?.status ?? result?.outcome ?? '').trim().toLowerCase())
      notify(
        noOp ? `当前 Chat 的${operation.title.replace(/^清除/, '')}已经是空状态，无需清除。` : `当前 Chat 的${operation.title}已完成。`,
        noOp ? 'info' : 'success',
        documentRef,
      )
      const refresh = refreshBusinessState({reason: `data-clear-${operation.key}`, force: true})
      if (root?.dataset.open === 'true') render()
      await refresh
      return true
    } catch (error) {
      notify(dataClearErrorMessage(error), 'error', documentRef)
      return false
    } finally {
      if (dataManagementState.operation === operation.key) dataManagementState = createDataManagementState()
      if (root?.dataset.open === 'true') render()
    }
  }
  async function refreshBusinessState({ reason = 'ui-read', force = false } = {}) {
    if (businessState.loading && !force) return
    const requestId = ++businessRefreshSequence
    const chatId = runtime.chat.current()
    businessState = { ...businessState, loading: true, chatId, error: null }
    try {
      if (typeof runtime.collectActiveBusinessData !== 'function') {
        throw new Error('EVENT_ANALYSIS_RUNTIME_UNAVAILABLE')
      }
      const collected = await runtime.collectActiveBusinessData({ reason })
      if (requestId !== businessRefreshSequence) return
      businessState = {
        loaded: true,
        loading: false,
        chatId,
        trackingSubjects: collected.tracking_subjects ?? collected.trackingSubjects ?? {},
        characterProfiles: collected.character_profiles ?? collected.characterProfiles ?? {},
        activeEvents: collected.active_events ?? collected.activeEvents ?? [],
        currentFloor: collected.current_floor ?? collected.currentFloor ?? null,
        currentState: collected.current_state ?? collected.currentState ?? null,
        currentStateStatus: collected.current_state_status ?? collected.currentStateStatus ?? 'NO_CHARACTER_FLOOR',
        currentStoryTime: collected.current_story_time ?? collected.currentStoryTime ?? null,
        currentStoryTimeStatus: collected.current_story_time_status ?? collected.currentStoryTimeStatus ?? null,
        currentStoryTimeDifferences: collected.current_story_time_differences ?? collected.currentStoryTimeDifferences ?? {},
        lastAnalysis: collected.last_success ?? collected.lastAnalysis ?? null,
        analysisStatus: collected.analysis_status ?? collected.analysisStatus ?? collected,
        error: null,
      }
      if (root?.dataset.open === 'true') render()
      if (storyTimeDebugState.enabled) void refreshStoryTimeDebug({renderAfter: true})
    } catch (error) {
      if (requestId !== businessRefreshSequence) return
      businessState = {
        ...businessState,
        loaded: true,
        loading: false,
        chatId,
        currentState: null,
        currentStateStatus: 'STATE_ERROR',
        currentStoryTime: null,
        currentStoryTimeStatus: 'error',
        currentStoryTimeDifferences: {},
        error: error?.message ?? 'BUSINESS_DATA_REFRESH_FAILED',
      }
      if (root?.dataset.open === 'true') render()
    }
  }
  function aliasErrorMessage(error) {
    const code = String(error?.code ?? error?.message ?? '').toLowerCase()
    if (code === 'no_character_floor' || code === 'message_not_found') return '当前没有可编辑的 Character Floor。'
    if (code === 'character_id_not_found' || code === 'unknown_character_id') return '当前人物不在有效 Floor 身份快照中。'
    if (code === 'swipe_not_found') return '当前 Swipe 已不可用，请重新读取人物信息。'
    if (code === 'floor_version_stale') return '当前楼层已变化，请重新打开昵称编辑器。'
    if (code === 'alias_collision') return '该昵称已属于其他人物，不能重复绑定。'
    if (code === 'alias_matches_display_name') return '昵称不能与人物 canonical name 相同。'
    if (code === 'alias_not_persistable') return '该称呼不能作为稳定昵称保存。'
    if (code === 'alias_invalid' || code === 'aliases_required') return '昵称格式无效。'
    if (code === 'bioweave_user_floor_write_forbidden') return '当前不是可写入的 Character Floor。'
    return '昵称保存失败，请重新读取当前人物信息。'
  }
  async function openCharacterAliases(characterId) {
    const id = String(characterId ?? '').trim()
    if (!id || typeof runtime.getCurrentCharacterIdentity !== 'function') return
    aliasEditorState = { ...aliasEditorState, open: true, loading: true, saving: false, characterId: id, canonicalName: null, draftAliases: [], error: null }
    render()
    try {
      const identity = await runtime.getCurrentCharacterIdentity(id)
      if (String(focusedCharacterId ?? '') !== id) return
      aliasEditorState = { ...aliasEditorState, open: true, loading: false, characterId: id, canonicalName: identity.display_name, draftAliases: [...(identity.aliases ?? [])], error: null }
    } catch (error) {
      aliasEditorState = { ...aliasEditorState, loading: false, error: aliasErrorMessage(error) }
    }
    render()
  }
  function closeCharacterAliases() {
    aliasEditorState = { open: false, loading: false, saving: false, characterId: null, canonicalName: null, draftAliases: [], error: null }
    render()
  }
  function addCharacterAlias() {
    aliasEditorState = { ...aliasEditorState, draftAliases: [...aliasEditorState.draftAliases, ''], error: null }
    render()
  }
  function removeCharacterAlias(index) {
    if (!Number.isInteger(index) || index < 0) return
    aliasEditorState = { ...aliasEditorState, draftAliases: aliasEditorState.draftAliases.filter((_, itemIndex) => itemIndex !== index), error: null }
    render()
  }
  function updateCharacterAliasDraft(target) {
    const index = Number(target?.dataset?.bioweaveAliasInput)
    if (!Number.isInteger(index) || index < 0) return
    const draftAliases = [...aliasEditorState.draftAliases]
    draftAliases[index] = String(target.value ?? '')
    aliasEditorState = { ...aliasEditorState, draftAliases, error: null }
  }
  async function saveCharacterAliases() {
    if (aliasEditorState.saving || !aliasEditorState.characterId || typeof runtime.updateCharacterAliases !== 'function') return
    aliasEditorState = { ...aliasEditorState, saving: true, error: null }
    render()
    try {
      const result = await runtime.updateCharacterAliases({ character_id: aliasEditorState.characterId, aliases: aliasEditorState.draftAliases })
      await refreshBusinessState({ reason: 'character-alias-update', force: true })
      const identity = result?.character ?? await runtime.getCurrentCharacterIdentity(aliasEditorState.characterId)
      aliasEditorState = { ...aliasEditorState, saving: false, loading: false, canonicalName: identity.display_name, draftAliases: [...(identity.aliases ?? [])], error: null }
      notify('昵称已保存。', 'success', documentRef)
    } catch (error) {
      aliasEditorState = { ...aliasEditorState, saving: false, error: aliasErrorMessage(error) }
      await refreshBusinessState({ reason: 'character-alias-update-failed', force: true }).catch(() => {})
      notify(aliasErrorMessage(error), 'error', documentRef)
    }
    render()
  }
  async function refreshStoryTimeDebug({renderAfter = true} = {}) {
    if (!storyTimeDebugState.enabled || typeof runtime.getStoryTimeDebugInfo !== 'function') return null
    const requestId = ++storyTimeDebugSequence
    storyTimeDebugState = {...storyTimeDebugState, loading: true, error: null}
    if (renderAfter && route === 'settings') render()
    try {
      const info = await runtime.getStoryTimeDebugInfo()
      if (requestId !== storyTimeDebugSequence) return null
      storyTimeDebugState = {...storyTimeDebugState, loading: false, info, error: null}
      if (renderAfter && route === 'settings') render()
      return info
    } catch (error) {
      if (requestId !== storyTimeDebugSequence) return null
      storyTimeDebugState = {...storyTimeDebugState, loading: false, info: null, error: error?.message ?? 'STORY_TIME_DEBUG_FAILED'}
      if (renderAfter && route === 'settings') render()
      return null
    }
  }
  async function copyStoryTimeDebug() {
    const info = storyTimeDebugState.info
    if (!info) return false
    const {trace: _trace, ...safeInfo} = info
    const text = JSON.stringify(safeInfo, null, 2)
    const clipboard = documentRef?.defaultView?.navigator?.clipboard ?? globalThis.navigator?.clipboard
    try {
      if (typeof clipboard?.writeText === 'function') {
        await clipboard.writeText(text)
      } else {
        const textarea = documentRef?.createElement?.('textarea')
        if (!textarea || typeof documentRef?.execCommand !== 'function') throw new Error('CLIPBOARD_UNAVAILABLE')
        textarea.value = text
        textarea.setAttribute('readonly', '')
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        documentRef.body?.append?.(textarea)
        textarea.select?.()
        if (!documentRef.execCommand('copy')) throw new Error('CLIPBOARD_COPY_FAILED')
        textarea.remove?.()
      }
      notify('Story Time 调试信息已复制。', 'success', documentRef)
      return true
    } catch {
      notify('无法复制 Story Time 调试信息。', 'error', documentRef)
      return false
    }
  }
  function activeEventById(eventId) {
    return businessState.activeEvents.find(event => String(event?.event_id) === String(eventId)) ?? null
  }
  function eventAnalysisError(error) {
    const transportMessage = sharedTransportErrorMessage(error)
    if (transportMessage) return `事件分析失败（${transportMessage}），上一份有效事件已保留。`
    const code = String(
      error?.error_code ??
        (error?.code === 'EVENT_ANALYSIS_INVALID' && error?.message && error.message !== error.code
          ? error.message
          : (error?.code ?? error?.message ?? '')),
    )
    const messages = {
      API_PROFILE_NOT_CONFIGURED: '事件分析尚未配置 API，请在设置的任务分配中选择可用配置。',
      EVENT_ANALYSIS_INVALID: 'AI 返回的事件结果无法通过固定 JSON 校验，上一份有效事件已保留。',
      EVENT_RESPONSE_EMPTY: 'AI 响应为空或未能提取正文，上一份有效事件已保留。',
      EVENT_RESPONSE_JSON_INVALID: 'AI 响应不是有效 JSON，上一份有效事件已保留。',
      EVENT_SCHEMA_INVALID: 'AI 返回未通过 Event JSON Schema 校验，上一份有效事件已保留。',
      ST_METADATA_STORAGE_UNAVAILABLE: '当前 Chat 存储不可用，事件结果未保存。',
      ST_METADATA_UNAVAILABLE: '当前 Chat 存储不可用，事件结果未保存。',
      ST_CHAT_STORAGE_UNAVAILABLE: '当前 Floor 存储不可用，事件结果未保存。',
      ST_FLOOR_STORAGE_UNAVAILABLE: '当前 Floor 存储不可用，事件结果未保存。',
      ST_CHAT_COMPLETION_UNAVAILABLE: 'SillyTavern ChatCompletionService 不可用。',
      ST_CURRENT_API_UNAVAILABLE: 'SillyTavern 当前 API 不可用。',
      API_PROFILE_INVALID: '事件分析 API 配置不完整。',
      REQUEST_TIMEOUT: '事件分析请求超时，上一份有效事件已保留。',
      STALE_CHAT: 'Chat 已切换，本次事件结果未保存。',
      MESSAGE_NOT_FOUND: '产生事件的楼层已不存在，当前事件未保存。',
      EVENT_NOT_FOUND: '当前有效事件已不存在，请刷新页面。',
      EVENT_ANALYSIS_RUNTIME_UNAVAILABLE: 'Event Analysis Runtime 当前不可用。',
    }
    const matched = Object.keys(messages).find(key => code === key || code.startsWith(`${key}_`))
    if (messages[matched]) return messages[matched]
    const stage = String(error?.analysis_stage ?? '').trim()
    const safeSummary = String(error?.safe_error_summary ?? '').trim()
    if (stage || safeSummary) {
      return `事件分析失败（${stage || 'analysis'} / ${safeSummary || code || 'EVENT_ANALYSIS_FAILED'}），上一份有效事件已保留。`
    }
    return '事件分析或保存失败，上一份有效事件已保留。'
  }
  function eventFormField(form, field) {
    return form?.querySelector?.(`[data-bioweave-event-field="${field}"]`)
  }
  function parseEventFormValue(form, field, fallback) {
    const node = eventFormField(form, field)
    if (!node) return fallback
    if (field === 'story_time' || field === 'participants' || field === 'pregnancy_relevance' || field === 'source_evidence') {
      try {
        return JSON.parse(String(node.value ?? ''))
      } catch {
        throw new Error(`EVENT_EDIT_${field.toUpperCase()}_INVALID`)
      }
    }
    return node.value
  }
  async function saveEventEdit() {
    const form = root?.querySelector?.('[data-bioweave-event-form]')
    const eventId = String(form?.dataset?.bioweaveEventId ?? eventEditingId ?? '').trim()
    const currentEvent = activeEventById(eventId)
    if (!currentEvent) throw new Error('EVENT_NOT_FOUND')
    const rawNextEvent = {
      ...currentEvent,
      type: parseEventFormValue(form, 'type', currentEvent.type),
      status: parseEventFormValue(form, 'status', currentEvent.status),
      location: parseEventFormValue(form, 'location', currentEvent.location),
      story_time: parseEventFormValue(form, 'story_time', currentEvent.story_time),
      participants: parseEventFormValue(form, 'participants', currentEvent.participants),
      pregnancy_relevance: parseEventFormValue(form, 'pregnancy_relevance', currentEvent.pregnancy_relevance),
      source_evidence: parseEventFormValue(form, 'source_evidence', currentEvent.source_evidence),
      source: currentEvent.source,
    }
    if (typeof runtime.updateEvent !== 'function') throw new Error('EVENT_ANALYSIS_RUNTIME_UNAVAILABLE')
    await runtime.updateEvent(eventId, rawNextEvent)
    eventEditingId = null
    notify('Event 已更新。', 'success', documentRef)
    await refreshBusinessState({ reason: 'event-edit' })
  }
  async function deleteEvent(eventId) {
    const currentEvent = activeEventById(eventId)
    if (!currentEvent) throw new Error('EVENT_NOT_FOUND')
    if (!(await confirmWithPopup('删除 BiologicalEvent', `确定删除 Event ${eventId} 吗？删除后该事实不再参与当前追踪。`))) return
    if (typeof runtime.deleteEvent !== 'function') throw new Error('EVENT_ANALYSIS_RUNTIME_UNAVAILABLE')
    await runtime.deleteEvent(eventId)
    if (eventEditingId === eventId) eventEditingId = null
    notify('Event 已删除。', 'success', documentRef)
    await refreshBusinessState({ reason: 'event-delete' })
  }
  async function manualRefreshEventAnalysis() {
    try {
      runtime.assertBioWeaveEnabled?.()
      if (typeof runtime.refreshCurrentFloorAnalysis !== 'function') {
        throw new Error('EVENT_ANALYSIS_RUNTIME_UNAVAILABLE')
      }
      render()
      const result = await runtime.refreshCurrentFloorAnalysis()
      notify('当前楼层事件分析成功并已保存。', 'success', documentRef)
      return result
    } catch (error) {
      notify(eventAnalysisError(error), 'error', documentRef)
      throw error
    } finally {
      await refreshBusinessState({ reason: 'manual-analysis', force: true })
    }
  }
  async function requestAbortEventAnalysis() {
    if (eventAnalysisAbortConfirmOpen) return false
    eventAnalysisAbortConfirmOpen = true
    const getStatus = runtime.getCurrentFloorAnalysisStatus
    try {
      let status = businessState.analysisStatus
      if (typeof getStatus === 'function') {
        try {
          status = await getStatus()
        } catch {
          // The Runtime subscriber will publish the terminal status; keep the
          // last rendered DTO for this confirmation decision.
        }
      }
      if (!status?.busy && status?.state !== 'running') return false
      if (typeof runtime.requestAbortCurrentFloorAnalysis !== 'function') {
        throw new Error('EVENT_ANALYSIS_RUNTIME_UNAVAILABLE')
      }
      const confirmed = await confirmWithPopup('终止事件分析', '当前事件分析仍在进行，是否终止本次分析？')
      if (!confirmed) return false
      return await runtime.requestAbortCurrentFloorAnalysis()
    } finally {
      eventAnalysisAbortConfirmOpen = false
    }
  }
  function render() {
    if (!root || !isConnectedToDocument(root, documentRef)) return
    if (route === 'settings') captureAnalysisSourceDisclosure()
    const page = pages[route] ?? pages.overview
    if (!pages[route]) route = 'overview'
    if (route === 'settings') ensureAnalysisSourcesChat()
    if (route === 'world') loadWorldModelState()
    const main = root.querySelector('.bioweave-main')
    if (!main) return
    const scrollPositions = captureScrollPositions(root)
    main.innerHTML = page[2]({
      characterId: focusedCharacterId,
      trackingSubjects: businessState.trackingSubjects,
      characterProfiles: businessState.characterProfiles,
      activeEvents: businessState.activeEvents,
      currentFloor: businessState.currentFloor,
      currentState: businessState.currentState,
      currentStateStatus: businessState.currentStateStatus,
      currentStoryTime: businessState.currentStoryTime,
      currentStoryTimeStatus: businessState.currentStoryTimeStatus,
      currentStoryTimeDifferences: businessState.currentStoryTimeDifferences,
      chatId: businessState.chatId,
      worldModelMeta: route === 'state' ? worldModelState.meta : null,
      aliasEditor: aliasEditorState,
      lastAnalysis: businessState.lastAnalysis,
      analysisStatus: businessState.analysisStatus,
      editingEventId: eventEditingId,
      chatName: currentChatLabel(),
      ...(route === 'settings' ? settingsState : {}),
      ...(route === 'settings' ? {enabled: currentBioWeaveEnabled()} : {}),
      ...(route === 'settings' ? {storyTimeDebug: storyTimeDebugState} : {}),
      ...(route === 'settings' ? {dataManagement: dataManagementState} : {}),
      ...(route === 'settings'
        ? {
            worldbookSources: {
              ...analysisSourcesState,
              globalRecentStory,
              visibleSources: searchAnalysisSources(analysisSourcesState.sources, analysisSourcesState.search),
              selected: analysisSourcesState.selected,
            },
          }
        : {}),
      ...(route === 'world'
        ? {
            worldModel: worldModelState.model,
            worldModelMeta: worldModelState.meta,
            worldModelBusy: worldModelState.busy,
            selectedSpecies: worldModelState.selectedSpecies,
            selectedBiologicalType: worldModelState.selectedBiologicalType,
            editingSection: worldModelState.editingSection,
            sectionDraft: worldModelState.sectionDraft,
            collectionEditor: worldModelState.collectionEditor,
            worldModelNotice: worldModelState.notice,
          }
        : {}),
    })
    restoreScrollPositions(root, scrollPositions)
    syncWorldModelCapabilityInputs(root)
    syncBioWeaveEnabledControl()
    root.querySelectorAll('.bioweave-chat-scope').forEach(node => {
      node.textContent = currentChatLabel()
    })
    root.querySelectorAll('[data-route]').forEach(button => {
      const active = button.dataset.route === route && !focusedCharacterId
      button.classList.toggle('active', active)
      button.setAttribute('aria-current', active ? 'page' : 'false')
    })
    syncAnalysisWorldbookToggles()
    syncAnalysisCharacterOpeningToggles()
    syncAnalysisSectionToggles()
    const currentChatId = runtime.chat.current()
    if (!businessState.loaded && !businessState.loading) {
      void refreshBusinessState({ reason: 'ui-read' })
    } else if (businessState.chatId !== currentChatId && !businessState.loading) {
      void refreshBusinessState({ reason: 'chat-read' })
    }
    if (route === 'settings' && !settingsState.loaded && !settingsState.loading) void loadSettings()
    if (route === 'settings' && !analysisSourcesState.loaded && !analysisSourcesState.loading) void loadAnalysisSourcesState()
  }
  function go(nextRoute) {
    if (!pages[nextRoute]) return false
    if (nextRoute === 'settings' && route !== 'settings') refreshAnalysisChatSettings()
    if (nextRoute === 'world' && route !== 'world') {
      worldModelState = {
        ...worldModelState,
        selectedSpecies: null,
        selectedBiologicalType: null,
        collectionEditor: null,
      }
    }
    captureAnalysisSourceDisclosure()
    route = nextRoute
    focusedCharacterId = null
    if (nextRoute !== 'characters') aliasEditorState = { open: false, loading: false, saving: false, characterId: null, canonicalName: null, draftAliases: [], error: null }
    if (nextRoute !== 'events') setEventFilter()
    render()
    return true
  }
  function openCharacter(characterId) {
    const nextId = String(characterId ?? '').trim()
    if (!nextId) return
    route = 'characters'
    focusedCharacterId = nextId
    if (aliasEditorState.characterId !== nextId) aliasEditorState = { open: false, loading: false, saving: false, characterId: null, canonicalName: null, draftAliases: [], error: null }
    render()
  }
  function settingsOperationError(error) {
    const transportMessage = sharedTransportErrorMessage(error)
    if (transportMessage) return transportMessage
    const errorCode = String(error?.code ?? error?.message ?? '')
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
      WORLD_ANALYSIS_PROMPT_SAVE_FAILED: '分析提示词保存失败，当前内容仍保留。',
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
    }
    const matchedCode = Object.keys(messages).find(code => errorCode === code || errorCode.startsWith(`${code}_`))
    return messages[matchedCode] ?? '设置操作失败，请检查 SillyTavern 状态后重试。'
  }
  function profileDraftKey(profileId) {
    const id = String(profileId ?? '').trim()
    return id || '__new__'
  }
  function profileDraftFrom(profile) {
    return {
      profile_id: profile?.profile_id ?? '',
      name: profile?.name ?? '',
      api_url: profile?.api_url ?? '',
      model: profile?.model ?? '',
      context_size: profile?.context_size ?? DEFAULT_API_PROFILE.context_size,
      max_output_tokens: profile?.max_output_tokens ?? DEFAULT_API_PROFILE.max_output_tokens,
      temperature: profile?.temperature ?? DEFAULT_API_PROFILE.temperature,
      api_key: '',
      clear_secret: false,
    }
  }
  function currentDraft(profile) {
    const key = profileDraftKey(profile?.profile_id)
    return settingsState.drafts?.[key] ?? profileDraftFrom(profile)
  }
  function latestDraftFor(key, fallback) {
    const draft = settingsState.drafts?.[key]
    return draft && typeof draft === 'object' ? draft : fallback
  }
  function resetModelPickerState() {
    modelRefreshSequence += 1
    return {
      modelList: [],
      modelListProfileKey: null,
      modelListRefreshedAt: null,
      modelSearch: '',
      modelRefreshBusy: false,
    }
  }
  function modelPickerStateForProfile(profileId) {
    const id = profileDraftKey(profileId)
    const next = resetModelPickerState()
    if (!isStableApiProfileId(id)) return next
    let cache = settingsState.modelListCaches?.[id] ?? null
    if (!cache && typeof profileStore.getModelListCache === 'function') {
      try {
        cache = profileStore.getModelListCache(id)
      } catch {
        cache = null
      }
    }
    if (!cache) return next
    const normalized = normalizeModelListCache(cache, { profileId: id })
    return {
      ...next,
      modelList: [...normalized.models],
      modelListProfileKey: id,
      modelListRefreshedAt: normalized.refreshed_at,
    }
  }
  function formField(form, name) {
    return form?.elements?.namedItem?.(name) ?? form?.querySelector?.(`[name="${name}"]`) ?? null
  }
  function readSettingsForm(form) {
    const value = name => formField(form, name)?.value ?? ''
    return {
      profile_id: value('profile_id'),
      name: value('name'),
      api_url: value('api_url'),
      model: value('model'),
      api_key: value('api_key'),
      clear_secret: Boolean(formField(form, 'clear_secret')?.checked),
    }
  }
  function captureSettingsDraft(form = root?.querySelector?.('[data-bioweave-settings-form]')) {
    if (!form) return null
    const draft = readSettingsForm(form)
    const key = profileDraftKey(draft.profile_id || settingsState.editingProfile?.profile_id)
    settingsState = {
      ...settingsState,
      editingDraft: draft,
      drafts: { ...settingsState.drafts, [key]: draft },
    }
    return draft
  }
  function readApiRequestSettingsForm() {
    const timeoutField = root?.querySelector?.('[data-bioweave-api-timeout]')
    const retryField = root?.querySelector?.('[data-bioweave-api-retry-count]')
    const timeoutSeconds = String(timeoutField?.value ?? '').trim()
    const retryCount = String(retryField?.value ?? '').trim()
    return normalizeApiRequestSettings({
      timeout: timeoutSeconds === '' ? undefined : Number(timeoutSeconds) * 1000,
      retry_count: retryCount === '' ? undefined : Number(retryCount),
    })
  }
  function captureApiRequestSettingsDraft() {
    const hasFields = root?.querySelector?.('[data-bioweave-api-timeout], [data-bioweave-api-retry-count]')
    if (!hasFields) return settingsState.apiRequestDraft ?? settingsState.apiRequestSettings
    const draft = readApiRequestSettingsForm()
    settingsState = { ...settingsState, apiRequestDraft: draft }
    return draft
  }
  async function saveApiRequestSettings() {
    const draft = captureApiRequestSettingsDraft()
    if (typeof profileStore.saveApiRequestSettings !== 'function') {
      settingsState = { ...settingsState, notice: null }
      notify('当前宿主不支持保存全局请求设置。', 'error', documentRef)
      render()
      return
    }
    settingsState = { ...settingsState, notice: null }
    try {
      const saved = await profileStore.saveApiRequestSettings(draft)
      settingsState = {
        ...settingsState,
        apiRequestSettings: normalizeApiRequestSettings(saved),
        apiRequestDraft: null,
        notice: null,
      }
      notify('请求设置已即时保存。', 'success', documentRef)
    } catch (error) {
      settingsState = {
        ...settingsState,
        apiRequestDraft: draft,
        notice: null,
      }
      notify(settingsOperationError(error), 'error', documentRef)
    }
    render()
  }
  function readAnalysisPromptForm() {
    const field = key =>
      root?.querySelector?.(`[data-bioweave-analysis-prompt-field="${key}"]`) ??
      root?.querySelector?.(`[data-bioweave-world-analysis-prompt-field="${key}"]`)
    return normalizeAnalysisPrompt({
      system_top: field('system_top')?.value ?? settingsState.analysisPrompt?.system_top,
      task: field('task')?.value ?? settingsState.analysisPrompt?.task,
      input_prefix: field('input_prefix')?.value ?? settingsState.analysisPrompt?.input_prefix,
      input_suffix: field('input_suffix')?.value ?? settingsState.analysisPrompt?.input_suffix,
      system_bottom: field('system_bottom')?.value ?? settingsState.analysisPrompt?.system_bottom,
      // 保留旧设置中的内部标签兼容性，但不再向用户展示或提供编辑入口。
      labels: settingsState.analysisPrompt?.labels,
    })
  }
  function captureAnalysisPromptDraft() {
    const hasForm =
      root?.querySelector?.('[data-bioweave-analysis-prompt-settings]') ?? root?.querySelector?.('[data-bioweave-world-analysis-prompt-settings]')
    if (!hasForm) return settingsState.analysisPromptDraft ?? settingsState.analysisPrompt
    const draft = readAnalysisPromptForm()
    settingsState = { ...settingsState, analysisPromptDraft: draft }
    return draft
  }
  async function saveAnalysisPrompt() {
    const draft = captureAnalysisPromptDraft()
    const savePrompt = profileStore.saveAnalysisPrompt ?? profileStore.saveWorldAnalysisPrompt
    if (typeof savePrompt !== 'function') {
      settingsState = { ...settingsState, notice: null }
      notify('当前宿主不支持保存分析提示词。', 'error', documentRef)
      render()
      return
    }
    settingsState = { ...settingsState, busy: true, notice: null }
    try {
      const saved = await savePrompt(draft)
      settingsState = {
        ...settingsState,
        busy: false,
        analysisPrompt: normalizeAnalysisPrompt(saved),
        analysisPromptDraft: null,
        notice: null,
      }
      notify('分析提示词设置已保存。', 'success', documentRef)
    } catch (error) {
      settingsState = {
        ...settingsState,
        busy: false,
        analysisPromptDraft: draft,
        notice: null,
      }
      notify(settingsOperationError(error), 'error', documentRef)
    }
    render()
  }
  function editProfile(profileId) {
    if (settingsState.busy) return
    captureSettingsDraft()
    const id = String(profileId ?? '').trim()
    const profile = profileStore.getProfile?.(id) ?? settingsState.profiles?.[id] ?? null
    if (!profile) {
      settingsState = { ...settingsState, notice: null }
      notify('找不到该 API 配置。', 'error', documentRef)
      render()
      return
    }
    route = 'settings'
    focusedCharacterId = null
    settingsState = {
      ...settingsState,
      ...modelPickerStateForProfile(id),
      editingProfile: profile,
      editingDraft: currentDraft(profile),
      testResult: null,
      notice: null,
    }
    render()
  }
  function startNewProfile() {
    if (settingsState.busy) return
    captureSettingsDraft()
    route = 'settings'
    focusedCharacterId = null
    settingsState = {
      ...settingsState,
      ...resetModelPickerState(),
      editingProfile: null,
      editingDraft: currentDraft(null),
      testResult: null,
      notice: null,
    }
    render()
  }
  function cancelProfileEdit() {
    if (settingsState.busy) return
    const drafts = { ...settingsState.drafts }
    delete drafts[profileDraftKey(settingsState.editingProfile?.profile_id)]
    settingsState = {
      ...settingsState,
      ...resetModelPickerState(),
      editingProfile: undefined,
      editingDraft: undefined,
      drafts,
      testResult: null,
      notice: null,
      busy: false,
    }
    render()
  }
  async function saveSettingsForm() {
    if (settingsState.busy) return
    const form = root?.querySelector?.('[data-bioweave-settings-form]')
    if (!form) return
    if (typeof profileStore.saveProfile !== 'function') {
      settingsState = { ...settingsState, notice: null }
      notify('当前宿主不支持保存 API 配置。', 'error', documentRef)
      render()
      return
    }
    const raw = captureSettingsDraft(form)
    const draftKey = profileDraftKey(raw.profile_id)
    const unsavedModelCache =
      !isStableApiProfileId(draftKey) && settingsState.modelListProfileKey === draftKey && Number.isInteger(settingsState.modelListRefreshedAt)
        ? {
            models: [...(settingsState.modelList ?? [])],
            refreshed_at: settingsState.modelListRefreshedAt,
          }
        : null
    settingsState = { ...settingsState, busy: true, notice: null }
    render()
    try {
      const saved = await profileStore.saveProfile(raw)
      updateSettingsState()
      const savedDraft = profileDraftFrom(saved)
      const drafts = {
        ...settingsState.drafts,
        [saved.profile_id]: savedDraft,
      }
      delete drafts.__new__
      let migratedModelCache = null
      let modelCacheMigrationError = null
      if (unsavedModelCache && typeof profileStore.saveModelListCache === 'function') {
        try {
          migratedModelCache = await profileStore.saveModelListCache(saved.profile_id, unsavedModelCache)
        } catch (error) {
          modelCacheMigrationError = error
        }
      }
      if (migratedModelCache) {
        migratedModelCache = normalizeModelListCache(migratedModelCache, {
          profileId: saved.profile_id,
        })
        settingsState = {
          ...settingsState,
          modelListCaches: {
            ...settingsState.modelListCaches,
            [saved.profile_id]: migratedModelCache,
          },
        }
      }
      const modelPickerState = settingsState.modelListProfileKey === draftKey ? { modelListProfileKey: saved.profile_id } : {}
      const editorState = modelCacheMigrationError
        ? {
            editingProfile: saved,
            editingDraft: savedDraft,
          }
        : {
            editingProfile: undefined,
            editingDraft: undefined,
          }
      settingsState = {
        ...settingsState,
        ...modelPickerState,
        ...editorState,
        drafts,
        testResult: null,
        notice: null,
      }
      notify(
        modelCacheMigrationError ? settingsOperationError(modelCacheMigrationError) : 'API 配置已保存；API 密钥仅保存在 Secret Store。',
        modelCacheMigrationError ? 'warning' : 'success',
        documentRef,
      )
      render()
    } catch (error) {
      const latestDraft = latestDraftFor(draftKey, raw)
      settingsState = {
        ...settingsState,
        editingDraft: latestDraft,
        drafts: { ...settingsState.drafts, [draftKey]: latestDraft },
        notice: null,
      }
      notify(settingsOperationError(error), 'error', documentRef)
    } finally {
      settingsState = { ...settingsState, busy: false }
      render()
    }
  }
  async function testSettingsForm() {
    const form = root?.querySelector?.('[data-bioweave-settings-form]')
    if (!form) return
    const raw = captureSettingsDraft(form)
    const draftKey = profileDraftKey(raw.profile_id)
    const runTest = typeof apiClient === 'function' ? apiClient : apiClient.testProfile
    if (typeof runTest !== 'function') {
      const errorMessage = '测试连接不可用，请确认 SillyTavern API 已加载。'
      settingsState = {
        ...settingsState,
        notice: null,
        testResult: { ok: false, error: errorMessage },
      }
      notify(errorMessage, 'error', documentRef)
      render()
      return
    }
    settingsState = {
      ...settingsState,
      busy: true,
      notice: null,
      testResult: null,
    }
    try {
      const context = runtime.st?.getContext?.() ?? hostContextForApp()
      const requestSettings = settingsState.apiRequestDraft ?? settingsState.apiRequestSettings
      const result =
        typeof profileStore.withTestProfile === 'function'
          ? await profileStore.withTestProfile(raw, profile => runTest(profile, { context, requestSettings }))
          : await runTest(raw, { context, requestSettings })
      settingsState = {
        ...settingsState,
        editingDraft: latestDraftFor(draftKey, raw),
        drafts: {
          ...settingsState.drafts,
          [draftKey]: latestDraftFor(draftKey, raw),
        },
        testResult: result,
        notice: null,
      }
    } catch (error) {
      settingsState = {
        ...settingsState,
        editingDraft: latestDraftFor(draftKey, raw),
        drafts: {
          ...settingsState.drafts,
          [draftKey]: latestDraftFor(draftKey, raw),
        },
        testResult: { ok: false, error: settingsOperationError(error) },
        notice: null,
      }
      notify(settingsOperationError(error), 'error', documentRef)
    } finally {
      settingsState = { ...settingsState, busy: false }
      render()
    }
  }
  function activeSettingsDraftKey() {
    return profileDraftKey(settingsState.editingDraft?.profile_id || settingsState.editingProfile?.profile_id)
  }
  function applyModelSearch(query) {
    if (!root) return
    const normalizedQuery = String(query ?? '')
      .trim()
      .toLocaleLowerCase()
    const items = [...(root.querySelectorAll?.('[data-bioweave-model-item]') ?? [])]
    let visibleCount = 0
    for (const item of items) {
      const model = String(item.dataset?.modelValue ?? item.textContent ?? '').toLocaleLowerCase()
      const visible = model.includes(normalizedQuery)
      item.hidden = !visible
      item.setAttribute?.('aria-hidden', String(!visible))
      if (visible) visibleCount += 1
    }
    const empty = root.querySelector?.('[data-bioweave-model-empty]')
    if (empty) empty.hidden = items.length > 0 && visibleCount > 0
  }
  function toggleModelPicker(target) {
    const picker = target?.closest?.('[data-bioweave-model-picker]')
    const dropdown = picker?.querySelector?.('[data-bioweave-model-dropdown]')
    if (!picker || !dropdown) return false
    const open = dropdown.hidden
    dropdown.hidden = !open
    target.setAttribute?.('aria-expanded', String(open))
    return true
  }
  function closeModelPickers(target = root) {
    const pickers = target?.querySelectorAll?.('[data-bioweave-model-picker]') ?? []
    for (const picker of pickers) closeModelPicker(picker)
  }
  function selectModel(target) {
    const model = String(target?.dataset?.modelValue ?? '').trim()
    if (!model) return
    const form = root?.querySelector?.('[data-bioweave-settings-form]')
    const input = formField(form, 'model')
    if (!input) return
    input.value = model
    captureSettingsDraft(form)
    root.querySelectorAll?.('[data-bioweave-model-item]').forEach(item => {
      const selected = item.dataset?.modelValue === model
      item.classList?.toggle('is-selected', selected)
      item.setAttribute?.('aria-selected', String(selected))
      const marker = item.querySelector?.('small')
      if (marker) marker.textContent = selected ? '当前选择' : ''
    })
    const picker = target.closest?.('[data-bioweave-model-picker]')
    const triggerLabel = picker?.querySelector?.('[data-bioweave-model-trigger-label]')
    if (triggerLabel) triggerLabel.textContent = model
    else picker?.querySelector?.('[data-bioweave-model-trigger]')?.replaceChildren?.(model)
    closeModelPicker(target)
  }
  async function refreshModels() {
    if (settingsState.modelRefreshBusy) return
    const form = root?.querySelector?.('[data-bioweave-settings-form]')
    if (!form) return
    const raw = captureSettingsDraft(form)
    const fetchModels = typeof apiClient === 'function' ? apiClient.fetchModels : apiClient?.fetchModels
    if (typeof fetchModels !== 'function') {
      settingsState = { ...settingsState, notice: null }
      notify('模型列表接口不可用，请确认 AI Client 已加载。', 'error', documentRef)
      render()
      return
    }
    const draftKey = profileDraftKey(raw.profile_id || settingsState.editingProfile?.profile_id)
    const requestId = ++modelRefreshSequence
    const existingModels = settingsState.modelListProfileKey === draftKey ? settingsState.modelList : []
    const existingRefreshedAt = settingsState.modelListProfileKey === draftKey ? settingsState.modelListRefreshedAt : null
    settingsState = {
      ...settingsState,
      modelList: existingModels,
      modelListProfileKey: draftKey,
      modelListRefreshedAt: existingRefreshedAt,
      modelRefreshBusy: true,
      notice: null,
    }
    render()
    try {
      const context = runtime.st?.getContext?.() ?? hostContextForApp()
      if (typeof profileStore.withTestProfile !== 'function') throw new Error('ST_MODEL_FETCH_UNAVAILABLE')
      const models = await profileStore.withTestProfile(
        raw,
        profile =>
          fetchModels.call(apiClient, profile, {
            context,
            requestSettings: settingsState.apiRequestDraft ?? settingsState.apiRequestSettings,
          }),
        { requireModel: false },
      )
      if (requestId !== modelRefreshSequence || activeSettingsDraftKey() !== draftKey) return
      const nextModels = normalizeModelList(models)
      const refreshedAt = Date.now()
      let savedModelCache = null
      if (isStableApiProfileId(draftKey) && typeof profileStore.saveModelListCache === 'function') {
        savedModelCache = await profileStore.saveModelListCache(draftKey, {
          models: nextModels,
          refreshed_at: refreshedAt,
        })
        if (requestId !== modelRefreshSequence || activeSettingsDraftKey() !== draftKey) return
      }
      const latestDraft = latestDraftFor(draftKey, raw)
      const normalizedCache = isStableApiProfileId(draftKey)
        ? normalizeModelListCache(
            savedModelCache ?? {
              models: nextModels,
              refreshed_at: refreshedAt,
            },
            { profileId: draftKey },
          )
        : null
      settingsState = {
        ...settingsState,
        modelList: nextModels,
        modelListProfileKey: draftKey,
        modelListRefreshedAt: normalizedCache?.refreshed_at ?? refreshedAt,
        modelListCaches: normalizedCache ? { ...settingsState.modelListCaches, [draftKey]: normalizedCache } : settingsState.modelListCaches,
        editingDraft: latestDraft,
        drafts: { ...settingsState.drafts, [draftKey]: latestDraft },
        notice: null,
      }
      notify(nextModels.length ? '模型列表已刷新。' : '未找到可用模型；仍可手动填写 Model。', nextModels.length ? 'info' : 'warning', documentRef)
    } catch (error) {
      if (requestId !== modelRefreshSequence || activeSettingsDraftKey() !== draftKey) return
      const latestDraft = latestDraftFor(draftKey, raw)
      settingsState = {
        ...settingsState,
        editingDraft: latestDraft,
        drafts: { ...settingsState.drafts, [draftKey]: latestDraft },
        notice: null,
      }
      notify(settingsOperationError(error), 'error', documentRef)
    } finally {
      if (requestId !== modelRefreshSequence || activeSettingsDraftKey() !== draftKey) return
      settingsState = { ...settingsState, modelRefreshBusy: false }
      render()
    }
  }
  function hostContextForApp() {
    return hostPopupContext()
  }
  async function removeProfile(profileId) {
    const id = String(profileId ?? '').trim()
    if (!id) return
    if (typeof profileStore.deleteProfile !== 'function') {
      settingsState = { ...settingsState, notice: null }
      notify('当前宿主不支持删除 API 配置。', 'error', documentRef)
      render()
      return
    }
    if (!(await confirmWithPopup('删除 API 配置', '确定删除此 API 配置并清理关联 Secret 引用吗？'))) return
    settingsState.busy = true
    try {
      await profileStore.deleteProfile(id)
      updateSettingsState()
      const drafts = { ...settingsState.drafts }
      delete drafts[id]
      const deletedCurrentProfile = settingsState.editingProfile?.profile_id === id
      settingsState = {
        ...settingsState,
        editingProfile: deletedCurrentProfile ? undefined : settingsState.editingProfile,
        editingDraft: deletedCurrentProfile ? undefined : settingsState.editingDraft,
        drafts,
        testResult: null,
        notice: null,
      }
      notify('API 配置已删除；关联 Secret 引用已清理。', 'success', documentRef)
    } catch (error) {
      settingsState = { ...settingsState, notice: null }
      notify(settingsOperationError(error), 'error', documentRef)
    } finally {
      settingsState.busy = false
      render()
    }
  }
  async function changeAssignment(target) {
    const slot = target?.dataset?.bioweaveAssignment
    if (!slot) return
    if (typeof profileStore.setAssignment !== 'function') {
      settingsState = { ...settingsState, notice: null }
      notify('当前宿主不支持保存任务 API 分配。', 'error', documentRef)
      render()
      return
    }
    try {
      const value = await profileStore.setAssignment(slot, target.value)
      settingsState = {
        ...settingsState,
        assignments: { ...settingsState.assignments, [slot]: value },
        notice: null,
      }
      notify('任务 API 分配已保存。', 'success', documentRef)
    } catch (error) {
      settingsState = { ...settingsState, notice: null }
      notify(settingsOperationError(error), 'error', documentRef)
    }
    render()
  }
  function assignmentControlForEvent(target) {
    // Assignment selectors share the root event delegation, but never belong to the profile editor flow.
    return target?.closest?.('[data-bioweave-assignment]') ?? null
  }
  async function changeApiSource(target) {
    const value = target?.value
    try {
      const saved = typeof profileStore.setApiSource === 'function' ? await profileStore.setApiSource(value) : value
      settingsState = { ...settingsState, apiSource: saved, notice: null }
      notify('默认 API 来源已保存。', 'success', documentRef)
    } catch (error) {
      settingsState = { ...settingsState, notice: null }
      notify(settingsOperationError(error), 'error', documentRef)
    }
    render()
  }
  async function changeDefaultProfile(target) {
    try {
      const saved = typeof profileStore.setDefaultProfile === 'function' ? await profileStore.setDefaultProfile(target?.value) : target?.value || null
      settingsState = {
        ...settingsState,
        defaultProfileId: saved,
        notice: null,
      }
      notify('默认 API 配置已保存。', 'success', documentRef)
    } catch (error) {
      settingsState = { ...settingsState, notice: null }
      notify(settingsOperationError(error), 'error', documentRef)
    }
    render()
  }
  async function changeUiPreference(target) {
    const themeTarget = target?.dataset?.bioweaveFloatingLauncherTheme !== undefined
    const key = themeTarget ? 'floating_launcher_theme' : target?.dataset?.bioweaveUiPreference
    if (!key || typeof profileStore.setUiPreference !== 'function') return
    try {
      const value = themeTarget ? target.value : target.checked === true
      const preferences = await profileStore.setUiPreference(key, value)
      settingsState = {...settingsState, ...preferences, notice: null}
      onUiPreferencesChanged(preferences)
      syncFloatingLauncherToggle(preferences.show_floating_launcher)
      notify('悬浮图标设置已保存。', 'success', documentRef)
    } catch (error) {
      settingsState = {...settingsState, notice: null}
      notify(settingsOperationError(error), 'error', documentRef)
    }
    render()
  }
  function floatingLauncherVisible() {
    try {
      return profileStore.getUiPreferences?.().show_floating_launcher !== false
    } catch {
      return settingsState.show_floating_launcher !== false
    }
  }
  function syncFloatingLauncherToggle(visible = floatingLauncherVisible()) {
    const button = root?.querySelector?.('[data-bioweave-floating-toggle]')
    if (!button) return
    const label = visible ? '关闭悬浮窗' : '打开悬浮窗'
    button.classList.toggle('is-disabled', !visible)
    button.setAttribute('aria-pressed', String(visible))
    button.dataset.bioweaveTooltip = label
    const tooltip = button.querySelector?.('[data-bioweave-header-tooltip]')
    if (tooltip) tooltip.textContent = label
    button.setAttribute('title', label)
    button.setAttribute('aria-label', label)
  }
  async function toggleFloatingLauncher() {
    const target = {
      checked: !floatingLauncherVisible(),
      dataset: {bioweaveUiPreference: 'show_floating_launcher'},
    }
    await changeUiPreference(target)
  }
  function handleSettingsInput(event) {
    if (!root?.contains(event.target)) return
    const target = event.target
    if (target?.dataset?.bioweaveAliasInput !== undefined) {
      updateCharacterAliasDraft(target)
      return
    }
    if (assignmentControlForEvent(target)) return
    if (target.closest?.('[data-bioweave-world-section-form]')) {
      captureWorldModelSectionDraft()
      return
    }
    if (target?.dataset?.bioweaveAnalysisSourceSearch !== undefined) {
      analysisSourcesState = {
        ...analysisSourcesState,
        search: String(target.value ?? ''),
      }
      applyAnalysisSourceSearch(target.value)
      return
    }
    if (target?.dataset?.bioweaveRecentStoryRegexPattern !== undefined) {
      const scope = target?.dataset?.bioweaveRecentStoryRegexScope === 'global' ? 'global' : 'character'
      const recentStory = updateRecentStoryRegexState(scope)
      if (scope === 'global') queueRecentStoryGlobalSettingsSave(recentStory)
      else queueRecentStorySettingsSave(recentStory)
      return
    }
    if (target?.dataset?.bioweaveRecentStoryFloorCount !== undefined) {
      queueRecentStorySettingsSave(updateRecentStoryState(target))
      return
    }
    if (
      target?.dataset?.bioweaveAnalysisPromptField !== undefined ||
      target?.dataset?.bioweaveAnalysisLabel !== undefined ||
      target?.dataset?.bioweaveWorldAnalysisPromptField !== undefined ||
      target?.dataset?.bioweaveWorldAnalysisLabel !== undefined
    ) {
      captureAnalysisPromptDraft()
      return
    }
    if (target?.dataset?.bioweaveModelSearch !== undefined) {
      captureSettingsDraft()
      settingsState = {
        ...settingsState,
        modelSearch: String(target.value ?? ''),
      }
      applyModelSearch(target.value)
      return
    }
    if (target?.dataset?.bioweaveApiTimeout !== undefined || target?.dataset?.bioweaveApiRetryCount !== undefined) {
      captureApiRequestSettingsDraft()
      return
    }
    if (target.closest?.('[data-bioweave-settings-form]')) captureSettingsDraft()
  }
  function handleRuntimeEvent(event) {
    if (event?.chatChanged || event?.type === 'CHAT_CHANGED') {
      clearPendingRecentStorySaves()
      analysisSourceRequestSequence += 1
      analysisSourceSaveSequence += 1
      abortUiWorldModelRequest()
      worldbookCache = clearWorldbookCache(worldbookCache)
      dataManagementState = createDataManagementState()
      analysisSourcesState = createAnalysisSourcesState()
      invalidateWorldModelView({ deferReload: false, renderView: false })
      clearAnalysisPreview()
      storyTimeDebugSequence += 1
      storyTimeDebugState = {...storyTimeDebugState, loading: false, info: null, error: null}
      aliasEditorState = { open: false, loading: false, saving: false, characterId: null, canonicalName: null, draftAliases: [], error: null }
      route = 'overview'
      focusedCharacterId = null
      businessRefreshSequence += 1
      businessState = {
        ...businessState,
        loaded: false,
        loading: false,
        chatId: null,
        trackingSubjects: {},
        characterProfiles: {},
        activeEvents: [],
        currentFloor: null,
        currentState: null,
        currentStateStatus: 'NO_CHARACTER_FLOOR',
        currentStoryTime: null,
        currentStoryTimeStatus: null,
        currentStoryTimeDifferences: {},
        lastAnalysis: null,
        analysisStatus: { state: 'not_analyzed', busy: false },
        error: null,
      }
    }
    if (isRuntimeDataClearEvent(event)) {
      const eventChatId = event?.chatId ?? event?.payload?.chatId ?? event?.payload?.result?.chatId
      if (eventChatId === undefined || String(eventChatId) === String(runtime.chat.current())) {
        const operation = dataManagementOperationForEvent(event)
        abortUiWorldModelRequest()
        refreshUiAfterDataClear(operation)
        void refreshBusinessState({reason: event.type, force: true})
      }
    }
    const lifecycleMutationType =
      event?.type === 'BIOWEAVE_LIFECYCLE_SETTLED'
        ? event?.mutationType
        : event?.type
    if (WORLD_MODEL_OWNER_MUTATIONS.has(lifecycleMutationType)) {
      if (event?.type === 'BIOWEAVE_LIFECYCLE_SETTLED') {
        if (route === 'world') reloadWorldModelFromRuntime()
        else worldModelState = { ...worldModelState, reloadPending: false }
      } else if (event?.type !== 'CHAT_CHANGED') {
        invalidateWorldModelView()
      }
    }
    if (event?.type === 'EVENT_ANALYSIS_STATUS_CHANGED') {
      const payload = event.payload ?? {}
      const terminal = payload.state !== 'running'
      businessState = {
        ...businessState,
        loaded: false,
        loading: false,
        analysisStatus: {
          ...businessState.analysisStatus,
          ...payload,
          state: payload.state ?? businessState.analysisStatus?.state ?? 'not_analyzed',
          busy: !terminal,
          error_stage:
            payload.stage ?? payload.error_stage ?? (payload.state === 'success' ? null : (businessState.analysisStatus?.error_stage ?? null)),
          error_code: payload.error_code ?? (payload.state === 'success' ? null : (businessState.analysisStatus?.error_code ?? null)),
          error_path: payload.error_path ?? (payload.state === 'success' ? null : (businessState.analysisStatus?.error_path ?? null)),
          diagnostic_path: payload.diagnostic_path ?? (payload.state === 'success' ? null : (businessState.analysisStatus?.diagnostic_path ?? null)),
          safe_error_summary:
            payload.safe_error_summary ?? (payload.state === 'success' ? null : (businessState.analysisStatus?.safe_error_summary ?? null)),
          last_error: payload.state === 'success' ? null : (payload.error_code ?? businessState.analysisStatus?.last_error ?? null),
        },
      }
    }
    if (
      event?.type === 'TRACKING_REGISTRY_REFRESHED' ||
      event?.type === 'EVENT_ANALYSIS_STATUS_CHANGED' ||
      event?.type === 'EVENT_ANALYSIS_COMMITTED' ||
      event?.type === 'MESSAGE_DELETED' ||
      event?.type === 'MESSAGE_RECEIVED' ||
      event?.type === 'GENERATION_ENDED' ||
      event?.type === 'MESSAGE_UPDATED' ||
      event?.type === 'MESSAGE_EDITED' ||
      event?.type === 'MESSAGE_SWIPED' ||
      event?.type === 'MESSAGE_SWIPE_DELETED'
    ) {
      if (['MESSAGE_DELETED', 'MESSAGE_RECEIVED', 'GENERATION_ENDED', 'MESSAGE_UPDATED', 'MESSAGE_EDITED', 'MESSAGE_SWIPED', 'MESSAGE_SWIPE_DELETED'].includes(event?.type)) {
        aliasEditorState = { open: false, loading: false, saving: false, characterId: null, canonicalName: null, draftAliases: [], error: null }
      }
      businessState = { ...businessState, loaded: false, loading: false, currentState: null, currentStateStatus: 'loading', currentStoryTime: null, currentStoryTimeStatus: 'loading', currentStoryTimeDifferences: {} }
      void refreshBusinessState({ reason: event.type })
    }
    if (event?.type === 'EVENT_ANALYSIS_STATUS_CHANGED' && event.payload?.state === 'cancelled') {
      notify('本次事件分析已取消。', 'info', documentRef)
    }
    if (root?.dataset.open === 'true') render()
  }
  async function handleClick(event) {
    if (!root?.contains(event.target)) return
    if (assignmentControlForEvent(event.target)) return
    captureAnalysisSourceDisclosure()
    if (handleAnalysisParentToggleClick(event)) return
    if (event.target.closest?.('[data-bioweave-analysis-prompt-settings], [data-bioweave-world-analysis-prompt-settings]')) {
      captureAnalysisPromptDraft()
    }
    const analysisDisclosure = event.target.closest?.('[data-bioweave-analysis-worldbook-expand], [data-bioweave-analysis-character-expand]')
    if (analysisDisclosure) {
      // 展开按钮只切换对应 details，不改变任何来源选择。
      event.preventDefault()
      event.stopPropagation()
      const details = analysisDisclosure.closest?.('details')
      if (details) {
        details.open = !details.open
        analysisDisclosure.setAttribute('aria-expanded', String(details.open))
        const prefix = details.open ? '收起' : '展开'
        analysisDisclosure.setAttribute(
          'aria-label',
          analysisDisclosure.dataset.bioweaveAnalysisWorldbookExpand !== undefined ? prefix + '世界书条目' : prefix + '开场白',
        )
        captureAnalysisSourceDisclosure()
        if (details.open && analysisDisclosure.dataset.bioweaveAnalysisWorldbookExpand !== undefined) {
          const sourceId = String(analysisDisclosure.dataset.bioweaveAnalysisWorldbookExpand ?? '').trim()
          const source = analysisSourcesState.sources.find(item => item.source_id === sourceId)
          if (source && !source.content_loaded) void loadWorldbookSourceForUi(sourceId)
        }
      }
      return
    }
    const clickedPicker = event.target.closest?.('[data-bioweave-model-picker]')
    const clickedDropdown = event.target.closest?.('[data-bioweave-model-dropdown]')
    const target = event.target.closest?.(
      '[data-route], [data-character-id], [data-back-to-characters], [data-bioweave-action], [data-bioweave-model-item], [data-bioweave-model-trigger]',
    )
    if (!target) {
      if (!clickedPicker || !clickedDropdown) closeModelPickers()
      return
    }
    if (!target.closest?.('[data-bioweave-model-picker]')) closeModelPickers()
    if (target.dataset.bioweaveModelTrigger !== undefined) {
      event.preventDefault()
      toggleModelPicker(target)
      return
    }
    if (target.dataset.bioweaveModelItem !== undefined) {
      event.preventDefault()
      selectModel(target)
      return
    }
    const action = target.dataset.bioweaveAction
    if (action === 'toggle-bioweave-enabled') {
      event.preventDefault()
      await toggleBioWeaveEnabled()
      return
    }
    if (action === 'toggle-story-time-debug') {
      event.preventDefault()
      storyTimeDebugState = {
        ...storyTimeDebugState,
        enabled: target.checked === true,
        info: target.checked === true ? storyTimeDebugState.info : null,
        error: null,
      }
      render()
      if (storyTimeDebugState.enabled) await refreshStoryTimeDebug()
      return
    }
    if (action === 'refresh-story-time-debug') {
      event.preventDefault()
      await refreshStoryTimeDebug()
      return
    }
    if (action === 'copy-story-time-debug') {
      event.preventDefault()
      await copyStoryTimeDebug()
      return
    }
    if (action === 'open-character-aliases') {
      event.preventDefault()
      await openCharacterAliases(target.dataset.characterId)
      return
    }
    if (action === 'add-character-alias') {
      event.preventDefault()
      addCharacterAlias()
      return
    }
    if (action === 'remove-character-alias') {
      event.preventDefault()
      removeCharacterAlias(Number(target.dataset.bioweaveAliasIndex))
      return
    }
    if (action === 'cancel-character-alias') {
      event.preventDefault()
      closeCharacterAliases()
      return
    }
    if (action === 'save-character-aliases') {
      event.preventDefault()
      await saveCharacterAliases()
      return
    }
    if (action === 'open-analysis-debug') {
      event.preventDefault()
      await openAnalysisDebugPopup()
      return
    }
    if (action === 'new-profile') {
      event.preventDefault()
      startNewProfile()
      return
    }
    if (action === 'edit-profile') {
      event.preventDefault()
      editProfile(target.dataset.profileId)
      return
    }
    if (action === 'delete-profile') {
      event.preventDefault()
      await removeProfile(target.dataset.profileId)
      return
    }
    if (action === 'cancel-profile') {
      event.preventDefault()
      cancelProfileEdit()
      return
    }
    if (action === 'save-profile') {
      event.preventDefault()
      await saveSettingsForm(false)
      return
    }
    if (action === 'test-profile') {
      event.preventDefault()
      await testSettingsForm()
      return
    }
    if (action === 'save-analysis-prompt' || action === 'save-world-analysis-prompt') {
      event.preventDefault()
      await saveAnalysisPrompt()
      return
    }
    if (action === 'refresh-models') {
      event.preventDefault()
      await refreshModels()
      return
    }
    if (action === 'refresh-analysis-sources') {
      event.preventDefault()
      await loadAnalysisSourcesState({ forceRefresh: true })
      return
    }
    if (dataManagementOperationForAction(action)) {
      event.preventDefault()
      await clearDataManagement(action)
      return
    }
    if (action === 'analyze-current-floor' || action === 'refresh') {
      event.preventDefault()
      let manualAnalysisRequested = false
      try {
        const status =
          typeof runtime.getCurrentFloorAnalysisStatus === 'function'
            ? await runtime.getCurrentFloorAnalysisStatus().catch(() => businessState.analysisStatus)
            : businessState.analysisStatus
        if (status?.busy || status?.state === 'running') await requestAbortEventAnalysis()
        else {
          manualAnalysisRequested = true
          await manualRefreshEventAnalysis()
        }
      } catch (error) {
        if (!manualAnalysisRequested && error?.message !== 'REQUEST_ABORTED' && error?.code !== 'REQUEST_ABORTED') {
          notify(eventAnalysisError(error), 'error', documentRef)
        }
      }
      return
    }
    if (action === 'edit-event') {
      event.preventDefault()
      eventEditingId = String(target.dataset.bioweaveEventId ?? '').trim() || null
      render()
      return
    }
    if (action === 'cancel-event-edit') {
      event.preventDefault()
      eventEditingId = null
      render()
      return
    }
    if (action === 'save-event') {
      event.preventDefault()
      try {
        await saveEventEdit()
      } catch (error) {
        notify(eventAnalysisError(error), 'error', documentRef)
        render()
      }
      return
    }
    if (action === 'delete-event') {
      event.preventDefault()
      try {
        await deleteEvent(String(target.dataset.bioweaveEventId ?? '').trim())
      } catch (error) {
        notify(eventAnalysisError(error), 'error', documentRef)
        render()
      }
      return
    }
    if (action === 'world-model-reanalyze') {
      event.preventDefault()
      if (worldModelState.busy) await requestAbortWorldModelAnalysis()
      else await analyzeWorldModel()
      return
    }
    if (action === 'world-model-add-species') {
      event.preventDefault()
      await beginWorldModelCollectionAdd('species')
      return
    }
    if (action === 'world-model-add-biological-type') {
      event.preventDefault()
      const selected = normalizeWorldModelSpeciesSelection(worldModelState.model, worldModelState.selectedSpecies)
      if (!selected) return
      await beginWorldModelCollectionAdd('biological-type', selected.speciesIndex)
      return
    }
    if (action === 'world-model-edit-species') {
      event.preventDefault()
      await beginWorldModelCollectionEdit('species')
      return
    }
    if (action === 'world-model-edit-biological-type') {
      event.preventDefault()
      await beginWorldModelCollectionEdit('biological-type')
      return
    }
    if (action === 'world-model-delete-species') {
      event.preventDefault()
      await saveWorldModelCollectionEdit('delete-species-selection')
      return
    }
    if (action === 'world-model-cancel-collection-add') {
      event.preventDefault()
      cancelWorldModelCollectionAdd()
      return
    }
    if (action === 'world-model-save-species' || action === 'world-model-save-biological-type') {
      event.preventDefault()
      await saveWorldModelCollectionInput(target)
      return
    }
    if (action === 'world-model-delete-biological-type') {
      event.preventDefault()
      await saveWorldModelCollectionEdit('delete-biological-type-selection')
      return
    }
    if (action === 'world-model-select-species') {
      event.preventDefault()
      await selectWorldModelType(Number(target.dataset.bioweaveWorldSpeciesIndex), null)
      return
    }
    if (action === 'world-model-select-type') {
      event.preventDefault()
      await selectWorldModelType(Number(target.dataset.bioweaveWorldSpeciesIndex), Number(target.dataset.bioweaveWorldTypeIndex))
      return
    }
    if (action === 'world-model-edit-section') {
      event.preventDefault()
      await beginWorldModelSectionEdit(String(target.dataset.bioweaveWorldSection ?? ''))
      return
    }
    if (action === 'world-model-cancel-section') {
      event.preventDefault()
      cancelWorldModelSectionEdit()
      return
    }
    if (action === 'world-model-save-section') {
      event.preventDefault()
      await saveWorldModelSection()
      return
    }
    if (action === 'world-model-add-row') {
      event.preventDefault()
      const section = String(target.dataset.bioweaveWorldSection ?? '')
      if (section === 'exceptions') {
        updateWorldModelSectionDraft(value => [
          ...(Array.isArray(value) ? value : []),
          {
            statement: null,
            applies_to: null,
            evidence: null,
          },
        ])
      } else if (section === 'special_rules' || section === 'unknowns') {
        updateWorldModelSectionDraft(value => [...(Array.isArray(value) ? value : []), ''])
      }
      return
    }
    if (action === 'world-model-remove-row') {
      event.preventDefault()
      const section = String(target.dataset.bioweaveWorldSection ?? '')
      const index = Number(target.dataset.bioweaveWorldRowIndex)
      if (!Number.isInteger(index) || index < 0) return
      updateWorldModelSectionDraft(value => (Array.isArray(value) ? value.filter((_, itemIndex) => itemIndex !== index) : value))
      return
    }
    if (action === 'select-all-analysis-sources') {
      event.preventDefault()
      await setAllAnalysisSources(true)
      return
    }
    if (action === 'select-none-analysis-sources') {
      event.preventDefault()
      await setAllAnalysisSources(false)
      return
    }
    if (action === 'add-recent-story-regex') {
      event.preventDefault()
      await addRecentStoryRegexRule(target.dataset.bioweaveRecentStoryRegexScope === 'global' ? 'global' : 'character')
      return
    }
    if (action === 'move-recent-story-regex-up') {
      event.preventDefault()
      await moveRecentStoryRegexRule(target, -1, target.dataset.bioweaveRecentStoryRegexScope === 'global' ? 'global' : 'character')
      return
    }
    if (action === 'move-recent-story-regex-down') {
      event.preventDefault()
      await moveRecentStoryRegexRule(target, 1, target.dataset.bioweaveRecentStoryRegexScope === 'global' ? 'global' : 'character')
      return
    }
    if (action === 'remove-recent-story-regex') {
      event.preventDefault()
      await removeRecentStoryRegexRule(target, target.dataset.bioweaveRecentStoryRegexScope === 'global' ? 'global' : 'character')
      return
    }
    if (target.dataset.characterId) {
      event.preventDefault()
      openCharacter(target.dataset.characterId)
      return
    }
    if (target.dataset.backToCharacters !== undefined) {
      event.preventDefault()
      focusedCharacterId = null
      route = 'characters'
      render()
      return
    }
    if (target.dataset.route) {
      event.preventDefault()
      go(target.dataset.route)
      return
    }
    if (target.dataset.bioweaveAction === 'cycle-theme') {
      event.preventDefault()
      cycleTheme()
      return
    }
    if (target.dataset.bioweaveAction === 'toggle-floating-launcher') {
      event.preventDefault()
      await toggleFloatingLauncher()
      return
    }
    if (target.dataset.bioweaveAction === 'close') {
      event.preventDefault()
      closeBioWeave()
      return
    }
  }
  async function handleChange(event) {
    if (!root?.contains(event.target)) return
    const floatingLauncherTheme = event.target.closest?.('[data-bioweave-floating-launcher-theme]')
    if (floatingLauncherTheme) {
      await changeUiPreference(floatingLauncherTheme)
      return
    }
    const uiPreference = event.target.closest?.('[data-bioweave-ui-preference]')
    if (uiPreference) {
      await changeUiPreference(uiPreference)
      return
    }
    const assignment = assignmentControlForEvent(event.target)
    if (assignment) {
      await changeAssignment(assignment)
      return
    }
    captureAnalysisSourceDisclosure()
    const eventFilterControl = event.target.closest?.('[data-bioweave-event-filter]')
    if (eventFilterControl) {
      const allowed = ['all', 'confirmed', 'probable', 'ambiguous', 'negated', 'fictional']
      setEventFilter(allowed.includes(String(eventFilterControl.value ?? '')) ? String(eventFilterControl.value) : 'all')
      render()
      return
    }
    if (event.target.closest?.('[data-bioweave-world-section-form]')) {
      if (event.target?.dataset?.bioweaveWorldCapabilityInput !== undefined) {
        event.target.dataset.bioweaveWorldCapabilityState = event.target.checked ? 'true' : 'false'
        event.target.indeterminate = false
        event.target.setAttribute?.('aria-checked', String(Boolean(event.target.checked)))
      }
      captureWorldModelSectionDraft()
      return
    }
    const characterOpeningToggle = event.target.closest?.('[data-bioweave-analysis-character-opening-toggle]')
    if (characterOpeningToggle) {
      await toggleCharacterCardOpenings(characterOpeningToggle)
      return
    }
    const analysisSectionToggle = event.target.closest?.('[data-bioweave-analysis-section-toggle]')
    if (analysisSectionToggle) {
      await toggleAnalysisSection(analysisSectionToggle)
      return
    }
    const worldbookToggle = event.target.closest?.('[data-bioweave-analysis-worldbook-toggle]')
    if (worldbookToggle) {
      await toggleWorldbookEntries(worldbookToggle)
      return
    }
    const analysisSource = event.target.closest?.('[data-bioweave-analysis-source]')
    if (analysisSource) {
      await toggleAnalysisSource(analysisSource)
      return
    }
    if (event.target?.dataset?.bioweaveRecentStoryFloorCount !== undefined || event.target?.dataset?.bioweaveRecentStoryUserRegex !== undefined) {
      await persistRecentStorySettings(event.target)
      return
    }
    if (
      event.target?.dataset?.bioweaveRecentStoryRegexPattern !== undefined ||
      event.target?.dataset?.bioweaveRecentStoryRegexType !== undefined ||
      event.target?.dataset?.bioweaveRecentStoryRegexEnabled !== undefined
    ) {
      await persistRecentStoryRegexSettings(event.target?.dataset?.bioweaveRecentStoryRegexScope === 'global' ? 'global' : 'character')
      return
    }
    if (event.target?.dataset?.bioweaveExternalMemory !== undefined) {
      await toggleExternalMemory(event.target)
      return
    }
    if (event.target?.dataset?.bioweaveApiTimeout !== undefined || event.target?.dataset?.bioweaveApiRetryCount !== undefined) {
      await saveApiRequestSettings()
      return
    }
    if (event.target.closest?.('[data-bioweave-settings-form]')) captureSettingsDraft()
    const source = event.target.closest?.('[data-bioweave-api-source]')
    if (source) {
      await changeApiSource(source)
      return
    }
    const defaultProfile = event.target.closest?.('[data-bioweave-default-profile]')
    if (defaultProfile) {
      await changeDefaultProfile(defaultProfile)
      return
    }
  }
  function handleSubmit(event) {
    if (event.target?.closest?.('[data-bioweave-world-section-form]')) {
      event.preventDefault()
    }
  }
  function handleOverlayClick(event) {
    if (event.target === overlay) closeBioWeave()
  }
  function handleKeydown(event) {
    if (event.key !== 'Escape' || root?.dataset.open !== 'true') return
    event.preventDefault()
    closeBioWeave()
  }
  function teardownRootListeners(node) {
    if (!node) return
    panelDragController?.destroy?.()
    panelDragController = null
    node.removeEventListener?.('click', handleClick)
    node.removeEventListener?.('input', handleSettingsInput)
    node.removeEventListener?.('change', handleChange)
    node.removeEventListener?.('submit', handleSubmit)
    node.removeEventListener?.('keydown', handleKeydown)
    const surface = overlay
    surface?.removeEventListener?.('click', handleOverlayClick)
    const registeredUnsubscribe = node[APP_RUNTIME_UNSUBSCRIBE_PROPERTY]
    if (typeof registeredUnsubscribe === 'function') {
      registeredUnsubscribe()
      if (registeredUnsubscribe === unsubscribeRuntime) unsubscribeRuntime = null
    }
    delete node[APP_RUNTIME_UNSUBSCRIBE_PROPERTY]
    delete node[APP_RUNTIME_DESTROY_PROPERTY]
    if (node[APP_TEARDOWN_PROPERTY] === teardownRootListeners) delete node[APP_TEARDOWN_PROPERTY]
  }
  function clearExistingRootBindings(node) {
    const oldTeardown = node?.[APP_TEARDOWN_PROPERTY]
    if (typeof oldTeardown === 'function' && oldTeardown !== teardownRootListeners) oldTeardown()
    else teardownRootListeners(node)
    const oldUnsubscribe = node?.[APP_RUNTIME_UNSUBSCRIBE_PROPERTY]
    if (typeof oldUnsubscribe === 'function') oldUnsubscribe()
    if (node) delete node[APP_RUNTIME_UNSUBSCRIBE_PROPERTY]
    const oldDestroy = node?.[APP_RUNTIME_DESTROY_PROPERTY]
    if (typeof oldDestroy === 'function' && oldDestroy !== runtime.destroy) oldDestroy()
    if (node) delete node[APP_RUNTIME_DESTROY_PROPERTY]
  }
  function initializeRoot(node, surface) {
    const wasOpen = node.dataset.open === 'true'
    clearExistingRootBindings(node)
    root = node
    overlay = surface
    root.id = 'bioweave-panel'
    root.className = 'bioweave-root bioweave-panel'
    root.dataset.open = String(wasOpen)
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-modal', 'true')
    root.setAttribute('aria-hidden', String(!wasOpen))
    surface.id = 'bioweave-overlay'
    surface.className = 'bioweave-overlay'
    surface.dataset.open = String(wasOpen)
    surface.hidden = !wasOpen
    surface.setAttribute('aria-hidden', String(!wasOpen))
    root.innerHTML = [
      '<header class="bioweave-app-header" data-bioweave-drag-handle>',
      '<strong class="bioweave-brand">BioWeave</strong>',
      '<span class="bioweave-chat-scope bioweave-muted">当前 Chat</span>',
      '<span class="bioweave-spacer"></span>',
      '<label class="bioweave-theme-button bioweave-enabled-control" data-bioweave-action="toggle-bioweave-enabled" data-bioweave-enabled-toggle data-bioweave-tooltip="暂停 BioWeave" title="暂停 BioWeave" aria-label="暂停 BioWeave"><input class="bioweave-checkbox" type="checkbox" data-bioweave-enabled-input checked aria-label="暂停 BioWeave"><span data-bioweave-enabled-label>已开启</span><span class="bioweave-header-tooltip" data-bioweave-header-tooltip role="tooltip">暂停 BioWeave</span></label>',
      '<button class="bioweave-theme-button" type="button" data-bioweave-action="cycle-theme" data-bioweave-theme-button data-bioweave-tooltip="切换皮肤：跟随酒馆" title="切换皮肤：跟随酒馆" aria-label="切换皮肤：跟随酒馆"><i class="fa-solid fa-circle-half-stroke" data-bioweave-theme-icon aria-hidden="true"></i><span class="bioweave-header-tooltip" data-bioweave-header-tooltip role="tooltip">切换皮肤：跟随酒馆</span></button>',
      '<button class="bioweave-floating-toggle" type="button" data-bioweave-action="toggle-floating-launcher" data-bioweave-floating-toggle data-bioweave-tooltip="关闭悬浮窗"><svg class="bioweave-floating-toggle-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><circle cx="24" cy="24" r="6"></circle><path d="M 10 27 A 15 15 0 0 1 30 10"></path><path d="M 38 21 A 15 15 0 0 1 18 38"></path><circle cx="34" cy="14" r="3.5"></circle><circle cx="14" cy="34" r="3.5"></circle></svg><span class="bioweave-header-tooltip" data-bioweave-header-tooltip role="tooltip">关闭悬浮窗</span></button>',
      '<button class="bioweave-close" type="button" data-bioweave-action="close" aria-label="关闭 BioWeave">×</button>',
      '</header>',
      '<nav class="bioweave-routebar" aria-label="BioWeave 页面导航"><div class="bioweave-route-items"></div></nav>',
      '<main class="bioweave-main"></main>',
    ].join('')
    syncFloatingLauncherToggle()
    panelDragController = createPanelDragController({
      root,
      handle: root.querySelector('[data-bioweave-drag-handle]'),
      documentRef,
    })
    const routebar = root.querySelector('.bioweave-route-items')
    desktopRoutes.forEach(id => routebar.append(createNavigationButton(documentRef, id)))
    root.addEventListener('click', handleClick)
    root.addEventListener('input', handleSettingsInput)
    root.addEventListener('change', handleChange)
    root.addEventListener('submit', handleSubmit)
    root.addEventListener('keydown', handleKeydown)
    surface.addEventListener('click', handleOverlayClick)
    root[APP_TEARDOWN_PROPERTY] = teardownRootListeners
    if (typeof runtime.subscribe === 'function') {
      unsubscribeRuntime = runtime.subscribe(handleRuntimeEvent)
      if (typeof unsubscribeRuntime === 'function') root[APP_RUNTIME_UNSUBSCRIBE_PROPERTY] = unsubscribeRuntime
    }
    setTheme(readTheme(storageRef))
    render()
  }
  const lifecycle = createOverlayLifecycle({
    documentRef,
    createOverlay: documentRefRef => {
      const node = documentRefRef.createElement('div')
      node.className = 'bioweave-overlay'
      node.hidden = true
      node.dataset.open = 'false'
      node.setAttribute('aria-hidden', 'true')
      return node
    },
    createRoot: documentRefRef => {
      const node = documentRefRef.createElement('section')
      node.className = 'bioweave-root bioweave-panel'
      node.dataset.open = 'false'
      return node
    },
    initializeRoot,
    teardownRoot: teardownRootListeners,
  })
  function mountBioWeave() {
    const mounted = lifecycle.mount()
    if (!mounted) return null
    overlay = mounted.overlay
    root = mounted.root
    return root
  }
  function openBioWeave() {
    const opened = lifecycle.open()
    if (!opened) return null
    overlay = opened.overlay
    root = opened.root
    if (route === 'settings') refreshAnalysisChatSettings()
    render()
    return root
  }
  function closeBioWeave() {
    clearAnalysisPreview()
    lifecycle.close()
  }
  function destroyBioWeave() {
    clearPendingRecentStorySaves()
    abortUiWorldModelRequest()
    worldModelLoadGeneration += 1
    modelRefreshSequence += 1
    analysisSourceRequestSequence += 1
    analysisSourceSaveSequence += 1
    businessRefreshSequence += 1
    worldbookCache = createWorldbookCache()
    worldModelTraceChatId = null
    lifecycle.destroy()
    root = null
    overlay = null
    unsubscribeRuntime = null
    route = 'overview'
    focusedCharacterId = null
    analysisSourcesState = createAnalysisSourcesState()
    worldModelState = createWorldModelState()
    dataManagementState = createDataManagementState()
    businessState = {
      loaded: false,
      loading: false,
      chatId: null,
      trackingSubjects: {},
      characterProfiles: {},
      activeEvents: [],
      currentFloor: null,
      currentState: null,
      currentStateStatus: 'NO_CHARACTER_FLOOR',
      currentStoryTime: null,
      currentStoryTimeStatus: null,
      currentStoryTimeDifferences: {},
      lastAnalysis: null,
      analysisStatus: { state: 'not_analyzed', busy: false },
      error: null,
    }
    eventEditingId = null
    setEventFilter()
    globalRecentStory = normalizeRecentStoryGlobalSettings()
    globalRecentStoryLoaded = false
    globalRecentStorySaveSequence += 1
    globalRecentStorySaveChain = Promise.resolve()
    clearAnalysisPreview()
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
      modelListCaches: {},
      modelListRefreshedAt: null,
      modelSearch: '',
      modelRefreshBusy: false,
      apiSource: SILLYTAVERN_CURRENT_API,
      defaultProfileId: null,
      apiRequestSettings: { ...DEFAULT_API_REQUEST_SETTINGS },
      apiRequestDraft: null,
      notice: null,
      testResult: null,
      busy: false,
    }
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
      dataManagement: {...dataManagementState},
      profiles: { ...settingsState.profiles },
      assignments: { ...settingsState.assignments },
      modelListCaches: Object.fromEntries(
        Object.entries(settingsState.modelListCaches ?? {}).map(([profileId, cache]) => [profileId, normalizeModelListCache(cache, { profileId })]),
      ),
      globalRecentStory: {
        regex_rules: [...(globalRecentStory.regex_rules ?? [])],
      },
      modelList: [...(settingsState.modelList ?? [])],
      editingDraft: settingsState.editingDraft ? { ...settingsState.editingDraft, api_key: '' } : settingsState.editingDraft,
      drafts: Object.fromEntries(Object.entries(settingsState.drafts ?? {}).map(([key, draft]) => [key, draft ? { ...draft, api_key: '' } : draft])),
    }),
  }
}
