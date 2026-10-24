import test from 'node:test'
import assert from 'node:assert/strict'
import { init, onActivate, onDisable } from '../index.js'
import { registerHostEntry } from '../host-entry.js'
import fs from 'node:fs'
import {
  captureScrollPositions,
  createOverlayLifecycle,
  createApp as createAppWithPreferences,
  createPanelDragController,
  buildDebugExportText,
  buildStoryTimeDebugExportText,
  debugExportFilename,
  handleAnalysisParentToggleClick,
  isConnectedToDocument,
  notify,
  restoreScrollPositions,
} from '../ui/app.js'
import { createApiProfileStore } from '../storage/store.js'
import { settingsPage } from '../ui/settings.js'
import { normalizeWorldModel } from '../ai/analyzer.js'
import { charactersPage } from '../ui/characters.js'
import { projectionPage } from '../ui/projection.js'
import { createDeviceLocalPreferences } from '../core/device-local-preferences.js'
const STYLE_SOURCE = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8')
const FINAL_STYLE_SOURCE = STYLE_SOURCE.slice(STYLE_SOURCE.lastIndexOf('/* Last cascade layer:'))
const FINAL_RESPONSIVE_STYLE_SOURCE = STYLE_SOURCE.slice(STYLE_SOURCE.lastIndexOf('/* Final responsive correction:'))
const APP_SOURCE = fs.readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8')
const RUNTIME_EVENTS_SOURCE = fs.readFileSync(new URL('../runtime/events.js', import.meta.url), 'utf8')
const SETTINGS_SOURCE = fs.readFileSync(new URL('../ui/settings.js', import.meta.url), 'utf8')
const WORLD_SOURCE = fs.readFileSync(new URL('../ui/world.js', import.meta.url), 'utf8')
const HOST_ENTRY_SOURCE = fs.readFileSync(new URL('../host-entry.js', import.meta.url), 'utf8')
const UI_SOURCE = [
  APP_SOURCE,
  fs.readFileSync(new URL('../ui/overview.js', import.meta.url), 'utf8'),
  fs.readFileSync(new URL('../ui/characters.js', import.meta.url), 'utf8'),
  fs.readFileSync(new URL('../ui/events.js', import.meta.url), 'utf8'),
  fs.readFileSync(new URL('../ui/world.js', import.meta.url), 'utf8'),
  fs.readFileSync(new URL('../ui/settings.js', import.meta.url), 'utf8'),
  fs.readFileSync(new URL('../ui/state.js', import.meta.url), 'utf8'),
].join('\n')
const CUSTOM_ABORT_UI_PATTERN =
  /(?:showAbortConfirmDialog|openAbortModal|renderAbortConfirm|worldModelAbortDialogOpen|worldModelAbortModalOpen|worldModelAbortOverlayOpen|bioweave[-_]abort[-_](?:modal|dialog|overlay)|bioweave[-_]world[-_]model[-_](?:abort|confirm)[-_](?:modal|dialog|overlay)|world[-_]model[-_]confirm[-_]modal)/i

function createApp(runtime, options = {}) {
  const {storageRef, ...rest} = options
  return createAppWithPreferences(runtime, {
    ...rest,
    preferences: options.preferences ?? createDeviceLocalPreferences({
      documentRef: options.documentRef,
      windowRef: options.windowRef,
      storageRef,
    }),
  })
}

test('Character UI distinguishes a successful empty Event result from an unanalyzed state', () => {
  const html = charactersPage({
    trackingSubjects: {},
    activeEvents: [],
    analysisStatus: {
      state: 'success',
      event_count: 0,
      active_event_count: 0,
      tracking_subject_count: 0,
    },
  })
  assert.match(html, /本楼分析完成，未发现 Biological Event/u)
  assert.doesNotMatch(html, /尚未完成事件分析/u)
})

test('Character detail uses one timing form for the current Timing Instance', () => {
  const html = charactersPage({
    characterId: 'char-a',
    trackingSubjects: { 'char-a': {character_id: 'char-a', display_name: 'Alice', exposure_event_ids: []} },
    characterProfiles: { 'char-a': {character_id: 'char-a', display_name: 'Alice', biological_context: {species: '人类', biological_type: '女性'}} },
    activeEvents: [],
    analysisStatus: {state: 'success', event_count: 0},
    timingEditor: {
      open: true,
      characterId: 'char-a',
      humanPresetApplicable: true,
      draft: {base_min_story_days: 14, base_max_story_days: 42, variance_ratio: 0.1, variance_cap_story_days: 3, total_adjustment_cap_story_days: 3},
      timingInstance: {base_min_story_days: 10, base_max_story_days: 20, variance_ratio: 0.12, variance_cap_story_days: 4, total_adjustment_cap_story_days: 2, sampled_individual_offset_story_days: 1.2, effective_min_story_days: 11.2, effective_max_story_days: 21.2},
    },
  })
  assert.ok(html.indexOf('推演周期') < html.indexOf('编辑昵称'))
  assert.match(html, /推演周期设置/u)
  assert.doesNotMatch(html, /之后新周期的设置/u)
  assert.match(html, /当前已经采用的周期/u)
  assert.match(html, /bioweave-character-timing-popover/u)
  assert.match(html, /aria-modal="true"/u)
  assert.match(html, /data-bioweave-action="cancel-character-timing"/u)
  assert.match(html, /data-bioweave-timing-field="base_min_story_days" value="14"/)
  assert.match(html, /data-bioweave-timing-field="base_max_story_days" value="42"/)
  assert.match(html, /data-bioweave-timing-field="variance_ratio" value="10"/)
  assert.doesNotMatch(html, /data-bioweave-timing-field="sampled_individual_offset_story_days"/)
  assert.match(html, /data-bioweave-timing-field="variance_cap_story_days" value="3"/)
  assert.match(html, /data-bioweave-timing-field="total_adjustment_cap_story_days" value="3"/)
  assert.match(html, /data-bioweave-action="restore-human-timing-preset"/)
  assert.match(html, />天<\/em>/)
  assert.match(html, /\+1\.2 天/u)
  assert.match(html, /11\.2 ～ 21\.2 天/u)
  assert.equal((html.match(/data-bioweave-action="save-character-timing"/g) ?? []).length, 1)
  assert.doesNotMatch(html, /save-current-character-timing/u)
  assert.doesNotMatch(html, /data-bioweave-current-timing-field/u)
  assert.match(html, /当前已采用周期可直接在此修改/u)
  assert.match(html, /个体浮动为百分比配置/u)
  assert.doesNotMatch(UI_SOURCE, /__BIOWEAVE_DEBUG__/u)
  assert.match(FINAL_STYLE_SOURCE, /bioweave-character-timing-popover[\s\S]*width: min\(320px/u)
  assert.match(FINAL_STYLE_SOURCE, /character-timing-fields input[\s\S]*width: 8ch/u)
  assert.match(APP_SOURCE, /const editingCurrent = Boolean\(state\.timingInstance\)/u)
  assert.match(APP_SOURCE, /runtime\.editCharacterTimingInstance\(/u)
  assert.match(APP_SOURCE, /varianceRatio: state\.draft\.variance_ratio/u)
  assert.doesNotMatch(APP_SOURCE, /sampledIndividualOffsetStoryDays: state\.draft/u)
  const restoreStart = APP_SOURCE.indexOf('function restoreHumanTimingPreset(')
  const saveStart = APP_SOURCE.indexOf('async function saveCharacterTiming(', restoreStart)
  const restoreSource = APP_SOURCE.slice(restoreStart, saveStart)
  assert.match(restoreSource, /const preset = getHumanPreconfirmationTimingPreset\(\)/u)
  for (const field of ['base_min_story_days', 'base_max_story_days', 'variance_ratio', 'variance_cap_story_days', 'total_adjustment_cap_story_days']) {
    assert.match(restoreSource, new RegExp(`${field}: preset\\.${field}`, 'u'))
  }
  assert.doesNotMatch(restoreSource, /saveCharacterTiming|runtime\./u)
  assert.match(APP_SOURCE, /runtime\.saveCharacterTimingConfig\(/u)
  assert.match(APP_SOURCE, /if \(!timingEditorState\.humanPresetApplicable \|\| !timingEditorState\.draft\) return/u)
  assert.match(APP_SOURCE, /if \(!editingCurrent && typeof runtime\.saveCharacterTimingConfig !== 'function'\) return/u)
  assert.match(APP_SOURCE, /if \(editingCurrent\) \{[\s\S]*runtime\.editCharacterTimingInstance\(/u)
  assert.match(APP_SOURCE, /\} else \{[\s\S]*await runtime\.saveCharacterTimingConfig\(/u)
  assert.match(APP_SOURCE, /当前周期已保存，但 Aggregation 重新评估失败/u)
  assert.match(APP_SOURCE, /当前周期保存结果无法从权威 Floor 读回/u)
  assert.match(APP_SOURCE, /timing_persisted === true/u)
  assert.doesNotMatch(APP_SOURCE, /saveCurrentCharacterTiming/u)
  assert.doesNotMatch(APP_SOURCE, /save-current-character-timing/u)
})

test('Character timing editor shows no current cycle before a Timing Instance exists', () => {
  const html = charactersPage({
    characterId: 'char-a',
    trackingSubjects: { 'char-a': {character_id: 'char-a', display_name: 'Alice', exposure_event_ids: []} },
    characterProfiles: { 'char-a': {character_id: 'char-a', display_name: 'Alice', biological_context: {species: '人类', biological_type: '女性'}} },
    analysisStatus: {state: 'success', event_count: 0},
    timingEditor: {
      open: true,
      characterId: 'char-a',
      humanPresetApplicable: true,
      draft: {base_min_story_days: 14, base_max_story_days: 42, variance_ratio: 0.1, variance_cap_story_days: 3, total_adjustment_cap_story_days: 3},
      timingInstance: null,
    },
  })
  assert.match(html, /尚未建立观察周期/u)
  assert.match(html, /data-bioweave-timing-field="variance_ratio" value="10"/)
  assert.match(html, />%<\/em>/)
  assert.doesNotMatch(html, /本次偏移/u)
  assert.match(html, /data-bioweave-action="restore-human-timing-preset"/)
  assert.equal((html.match(/data-bioweave-action="save-character-timing"/g) ?? []).length, 1)
})

test('Character timing editor keeps non-Human draft values without applying the preset', () => {
  const html = charactersPage({
    characterId: 'char-a',
    trackingSubjects: {'char-a': {character_id: 'char-a', display_name: 'Alice', exposure_event_ids: []}},
    characterProfiles: {'char-a': {character_id: 'char-a', display_name: 'Alice', biological_context: {species: '精灵', biological_type: '非人类'}}},
    analysisStatus: {state: 'success', event_count: 0},
    timingEditor: {
      open: true,
      characterId: 'char-a',
      humanPresetApplicable: false,
      draft: {base_min_story_days: 8, base_max_story_days: 30, variance_ratio: 0.2, variance_cap_story_days: 5, total_adjustment_cap_story_days: 4},
      timingInstance: null,
    },
  })
  assert.match(html, /data-bioweave-timing-field="base_min_story_days" value="8"/)
  assert.match(html, /data-bioweave-timing-field="base_max_story_days" value="30"/)
  assert.match(html, /data-bioweave-timing-field="variance_ratio" value="20"/)
  assert.match(html, /data-bioweave-timing-field="variance_cap_story_days" value="5"/)
  assert.match(html, /data-bioweave-timing-field="total_adjustment_cap_story_days" value="4"/)
  assert.match(html, />恢复默认<\/button>/u)
  assert.doesNotMatch(html, />恢复人类默认<\/button>/u)
})

test('clicking restore updates the current timing draft without persisting it', async () => {
  const documentRef = new AppFakeDocument()
  const timing = {
    character_id: 'char-a',
    timing_instance_id: 'timing-a',
    base_min_story_days: 10,
    base_max_story_days: 16,
    variance_ratio: 0.2,
    variance_cap_story_days: 5,
    total_adjustment_cap_story_days: 4,
    sampled_individual_offset_story_days: 1,
    effective_min_story_days: 11,
    effective_max_story_days: 17,
  }
  let editCalls = 0
  let configSaveCalls = 0
  let editorReads = 0
  const timingPerformanceOperations = []
  const runtime = {
    ...apiProfileRuntime('chat-timing-restore'),
    collectActiveBusinessData: async () => ({
      tracking_subjects: {
        'char-a': {character_id: 'char-a', display_name: 'Alice', exposure_event_ids: []},
      },
      character_profiles: {
        'char-a': {character_id: 'char-a', display_name: 'Alice', biological_context: {species: '人类', biological_type: '女性'}},
      },
      active_events: [],
      analysis_status: {state: 'success', event_count: 0},
      current_state_status: 'NO_CHARACTER_FLOOR',
    }),
    getCharacterTimingEditorData: async () => {
      editorReads += 1
      return {
      config: {schema_version: 1, config_version: 1, base_min_story_days: 14, base_max_story_days: 42, variance_ratio: 0.1, variance_cap_story_days: 3, total_adjustment_cap_story_days: 3},
      human_preset_applicable: true,
      timing_instance: structuredClone(timing),
      floor_version: null,
      }
    },
    startTimingPerformanceOperation: input => {
      const operationId = `timing-perf-${timingPerformanceOperations.length + 1}`
      timingPerformanceOperations.push({operationId, ...input, stages: [], finished: null})
      return operationId
    },
    recordTimingPerformanceStage: input => {
      timingPerformanceOperations.find(item => item.operationId === input.operation_id)?.stages.push(input)
    },
    finishTimingPerformanceOperation: input => {
      const operation = timingPerformanceOperations.find(item => item.operationId === input.operation_id)
      if (operation) operation.finished = input
    },
    editCharacterTimingInstance: async input => {
      editCalls += 1
      return {
        status: 'succeeded',
        timing_instance: {
          ...timing,
          base_min_story_days: input.baseMinStoryDays,
          base_max_story_days: input.baseMaxStoryDays,
          variance_ratio: input.varianceRatio,
          variance_cap_story_days: input.varianceCapStoryDays,
          total_adjustment_cap_story_days: input.totalAdjustmentCapStoryDays,
        },
        floor_version: null,
        timing_readback: {succeeded: true, present: true},
        aggregation_reevaluation: {attempted: true, readback_status: 'SUCCEEDED', action: 'not_due_before_min'},
      }
    },
    saveCharacterTimingConfig: async () => { configSaveCalls += 1 },
  }
  const app = createApp(runtime, {
    documentRef,
    storageRef: {},
    profileStore: {getSettings: () => ({})},
  })
  const root = app.openBioWeave()
  await new Promise(resolve => setTimeout(resolve, 0))
  app.go('characters')
  app.openCharacter('char-a')
  const click = [...root.listeners.get('click')][0]
  const timingActionTarget = dataset => ({
    __root: root,
    dataset,
    closest(selector) {
      return selector.includes('[data-bioweave-action') ? this : null
    },
  })
  await click({
    target: timingActionTarget({bioweaveAction: 'open-character-timing', characterId: 'char-a'}),
    preventDefault() {},
  })
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(editorReads, 1)
  let html = root.querySelector('.bioweave-main').innerHTML
  assert.match(html, /data-bioweave-timing-field="base_min_story_days" value="10"/)

  await click({
    target: timingActionTarget({bioweaveAction: 'restore-human-timing-preset'}),
    preventDefault() {},
  })
  html = root.querySelector('.bioweave-main').innerHTML
  assert.match(html, /data-bioweave-timing-field="base_min_story_days" value="14"/)
  assert.match(html, /data-bioweave-timing-field="base_max_story_days" value="42"/)
  assert.match(html, /data-bioweave-timing-field="variance_ratio" value="10"/)
  assert.match(html, /data-bioweave-timing-field="variance_cap_story_days" value="3"/)
  assert.match(html, /data-bioweave-timing-field="total_adjustment_cap_story_days" value="3"/)
  assert.equal(editCalls, 0)
  assert.equal(configSaveCalls, 0)

  await click({
    target: timingActionTarget({bioweaveAction: 'save-character-timing'}),
    preventDefault() {},
  })
  assert.equal(editCalls, 1)
  assert.equal(editorReads, 1)
  assert.ok(timingPerformanceOperations.some(item => item.operation === 'OPEN_TIMING_EDITOR'))
  assert.ok(timingPerformanceOperations.some(item => item.operation === 'RESTORE_TIMING_DEFAULTS'))
  assert.ok(timingPerformanceOperations.some(item => item.operation === 'SAVE_TIMING_INSTANCE'))
  app.destroyBioWeave()
})

test('restoring timing defaults updates the editor controls without rebuilding the characters page when mounted', async () => {
  const documentRef = new AppFakeDocument()
  const runtime = {
    ...apiProfileRuntime('chat-timing-restore-local'),
    collectActiveBusinessData: async () => ({
      tracking_subjects: {'char-a': {character_id: 'char-a', display_name: 'Alice', exposure_event_ids: []}},
      character_profiles: {'char-a': {character_id: 'char-a', display_name: 'Alice', biological_context: {species: '人类', biological_type: '女性'}}},
      active_events: [],
      analysis_status: {state: 'success', event_count: 0},
      current_state_status: 'NO_CHARACTER_FLOOR',
    }),
    getCharacterTimingEditorData: async () => ({
      config: {schema_version: 1, config_version: 1, base_min_story_days: 14, base_max_story_days: 42, variance_ratio: 0.1, variance_cap_story_days: 3, total_adjustment_cap_story_days: 3},
      human_preset_applicable: true,
      timing_instance: null,
      floor_version: null,
    }),
  }
  const app = createApp(runtime, {documentRef, storageRef: {}, profileStore: {getSettings: () => ({})}})
  const root = app.openBioWeave()
  await new Promise(resolve => setTimeout(resolve, 0))
  app.go('characters')
  app.openCharacter('char-a')
  const click = [...root.listeners.get('click')][0]
  const target = dataset => ({
    __root: root,
    dataset,
    closest(selector) { return selector.includes('[data-bioweave-action') ? this : null },
  })
  await click({target: target({bioweaveAction: 'open-character-timing', characterId: 'char-a'}), preventDefault() {}})
  await new Promise(resolve => setTimeout(resolve, 10))

  const fields = Object.fromEntries([
    'base_min_story_days', 'base_max_story_days', 'variance_ratio', 'variance_cap_story_days', 'total_adjustment_cap_story_days',
  ].map(field => [field, {value: 'unchanged'}]))
  const editor = {
    querySelector(selector) {
      const field = selector.match(/data-bioweave-timing-field="([^"]+)"/)?.[1]
      return fields[field] ?? null
    },
  }
  const originalQuerySelector = root.querySelector.bind(root)
  root.querySelector = selector => selector === '#bioweave-character-timing-popover' ? editor : originalQuerySelector(selector)
  const pageBeforeRestore = root.querySelector('.bioweave-main').innerHTML
  await click({target: target({bioweaveAction: 'restore-human-timing-preset'}), preventDefault() {}})

  assert.deepEqual(Object.fromEntries(Object.entries(fields).map(([field, input]) => [field, input.value])), {
    base_min_story_days: '14',
    base_max_story_days: '42',
    variance_ratio: '10',
    variance_cap_story_days: '3',
    total_adjustment_cap_story_days: '3',
  })
  assert.equal(root.querySelector('.bioweave-main').innerHTML, pageBeforeRestore)
  app.destroyBioWeave()
})

test('character selection preserves the mounted list, replaces only details, and records fail-open performance operations', async () => {
  const documentRef = new AppFakeDocument()
  const performanceOperations = []
  const runtime = {
    ...apiProfileRuntime('chat-character-selection'),
    collectActiveBusinessData: async () => ({
      tracking_subjects: {
        'char-a': {character_id: 'char-a', display_name: 'Alice', exposure_event_ids: []},
        'char-b': {character_id: 'char-b', display_name: 'Bob', exposure_event_ids: []},
      },
      character_profiles: {
        'char-a': {character_id: 'char-a', display_name: 'Alice', biological_context: {species: '人类', biological_type: '女性'}},
        'char-b': {character_id: 'char-b', display_name: 'Bob', biological_context: {species: '人类', biological_type: '男性'}},
      },
      active_events: [],
      analysis_status: {state: 'success', event_count: 0},
      current_state_status: 'NO_CHARACTER_FLOOR',
    }),
    startTimingPerformanceOperation: input => {
      const operation = {operationId: `selection-${performanceOperations.length + 1}`, ...input, stages: [], finished: null}
      performanceOperations.push(operation)
      return operation.operationId
    },
    recordTimingPerformanceStage: input => {
      performanceOperations.find(operation => operation.operationId === input.operation_id)?.stages.push(input)
    },
    finishTimingPerformanceOperation: input => {
      const operation = performanceOperations.find(item => item.operationId === input.operation_id)
      if (operation) operation.finished = input
    },
  }
  const app = createApp(runtime, {documentRef})
  const root = app.openBioWeave()
  app.go('characters')
  await new Promise(resolve => setTimeout(resolve, 0))

  const main = root.querySelector('.bioweave-main')
  const pageRoot = {}
  const rows = ['char-a', 'char-b'].map(characterId => {
    const classNames = new Set(['bioweave-character-row'])
    return {
      dataset: {characterId},
      classList: {toggle(name, force) { force ? classNames.add(name) : classNames.delete(name) }},
      setAttribute(name, value) { this[name] = value },
      hasSelectedClass() { return classNames.has('selected') },
    }
  })
  const list = {querySelectorAll: () => rows}
  let detailMarkup = ''
  let detailReplacements = 0
  const detail = {}
  Object.defineProperty(detail, 'outerHTML', {
    get: () => detailMarkup,
    set: value => {
      detailMarkup = String(value)
      detailReplacements += 1
    },
  })
  main.selectorNodes.set('.bioweave-characters-page', [pageRoot])
  main.selectorNodes.set('.bioweave-character-list', [list])
  main.selectorNodes.set('.bioweave-character-detail-pane', [detail])
  const pageMarkupBeforeSelection = main.innerHTML

  assert.doesNotThrow(() => app.openCharacter('char-a'))
  assert.equal(main.innerHTML, pageMarkupBeforeSelection)
  assert.equal(detailReplacements, 1)
  assert.match(detailMarkup, />Alice</u)
  assert.equal(rows[0].hasSelectedClass(), true)
  assert.equal(rows[1].hasSelectedClass(), false)

  app.openCharacter('char-b')
  assert.equal(main.innerHTML, pageMarkupBeforeSelection)
  assert.equal(detailReplacements, 2)
  assert.match(detailMarkup, />Bob</u)
  assert.equal(rows[0].hasSelectedClass(), false)
  assert.equal(rows[1].hasSelectedClass(), true)
  assert.equal(app.getFocusedCharacterId(), 'char-b')
  const openCharactersOperation = performanceOperations.find(item => item.operation === 'OPEN_CHARACTERS_PAGE')
  assert.ok(openCharactersOperation)
  assert.equal(openCharactersOperation.character_count, 0)
  assert.deepEqual(openCharactersOperation.stages.map(stage => stage.stage), ['CHARACTERS_PAGE_FULL_RENDER'])
  assert.equal(openCharactersOperation.stages[0].render_scope, 'characters_page_full')
  assert.equal(performanceOperations.find(item => item.operation === 'SELECT_CHARACTER')?.character_count, 2)
  assert.ok(performanceOperations.find(item => item.operation === 'RENDER_CHARACTER_LIST')?.stages.some(stage => stage.stage === 'CHARACTER_LIST_SELECTION_UPDATE'))
  assert.ok(performanceOperations.find(item => item.operation === 'RENDER_CHARACTER_DETAILS')?.stages.some(stage => stage.stage === 'CHARACTER_DETAIL_HTML_BUILD'))
  assert.ok(performanceOperations.find(item => item.operation === 'RENDER_CHARACTER_DETAILS')?.stages.some(stage => stage.stage === 'CHARACTER_DETAIL_DOM_COMMIT'))
  assert.deepEqual(
    ['SELECT_CHARACTER', 'RENDER_CHARACTER_LIST', 'RENDER_CHARACTER_DETAILS'],
    ['SELECT_CHARACTER', 'RENDER_CHARACTER_LIST', 'RENDER_CHARACTER_DETAILS'].filter(operation => performanceOperations.some(item => item.operation === operation)),
  )
  assert.ok(performanceOperations.every(operation => operation.finished?.status === 'SUCCEEDED'))

  runtime.startTimingPerformanceOperation = () => { throw new Error('DIAGNOSTICS_DISABLED') }
  runtime.recordTimingPerformanceStage = () => { throw new Error('DIAGNOSTICS_DISABLED') }
  runtime.finishTimingPerformanceOperation = () => { throw new Error('DIAGNOSTICS_DISABLED') }
  assert.doesNotThrow(() => app.openCharacter('char-a'))
  assert.equal(detailReplacements, 3)
  assert.equal(app.getFocusedCharacterId(), 'char-a')
  app.destroyBioWeave()
})

test('Character Health popover keeps the A-variant interaction contract', () => {
  const keydownStart = APP_SOURCE.indexOf('function handleKeydown(')
  const keydownEnd = APP_SOURCE.indexOf('function teardownRootListeners(', keydownStart)
  const keydownSource = APP_SOURCE.slice(keydownStart, keydownEnd)
  const outsideStart = APP_SOURCE.indexOf('healthPopoverState.open &&', APP_SOURCE.indexOf('async function handleClick('))
  const outsideEnd = APP_SOURCE.indexOf('captureAnalysisSourceDisclosure()', outsideStart)
  const outsideSource = APP_SOURCE.slice(outsideStart, outsideEnd)
  assert.ok(keydownStart >= 0)
  assert.ok(outsideStart >= 0)
  assert.ok(keydownSource.indexOf('healthPopoverState.open') < keydownSource.indexOf('aliasEditorState.open'))
  assert.match(keydownSource, /closeCharacterHealth\(\)[\s\S]*return/u)
  assert.match(outsideSource, /\.bioweave-character-health-popover, \[data-bioweave-action="toggle-character-health"\]/u)
  assert.match(APP_SOURCE, /healthPopoverState = \{open: false, characterId: null\}/u)
  assert.match(APP_SOURCE, /healthPopoverState\.open && healthPopoverState\.characterId === focusedCharacterId/u)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-character-health-issue \{[\s\S]*border: 0 !important;[\s\S]*background: transparent !important;/u)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-character-health-overview \{[\s\S]*gap: 10px !important;[\s\S]*min-height: 30px !important;[\s\S]*align-items: center !important;/u)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-character-health-overview \.bioweave-badge \{[\s\S]*padding: 3px 9px !important;[\s\S]*line-height: 1\.5 !important;/u)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-character-health-body \{[\s\S]*padding: 0 14px 6px !important;/u)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-character-health-scope-note \{[\s\S]*margin: 4px 0 0 !important;[\s\S]*padding-top: 6px !important;/u)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-character-health-button\.warning \{[\s\S]*border-color: color-mix\(in srgb, var\(--bioweave-warn\) 48%, var\(--bioweave-border\)\) !important;[\s\S]*background: var\(--bioweave-warn-soft\) !important;/u)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-character-health-overview\[data-health-state="warning"\] \.bioweave-badge \{[\s\S]*border-color: color-mix\(in srgb, var\(--bioweave-warn\) 48%, var\(--bioweave-border\)\) !important;[\s\S]*background: var\(--bioweave-warn-soft\) !important;/u)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-character-health-issue-severity \{[\s\S]*justify-self: end !important;[\s\S]*border: 1px solid color-mix\(in srgb, var\(--bioweave-warn\) 48%, var\(--bioweave-border\)\) !important;/u)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-character-health-popover \{[\s\S]*border: 1px solid var\(--bioweave-border\) !important;[\s\S]*background: var\(--bioweave-surface-soft\) !important;/u)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-character-health-issue-source \.bioweave-text-button \{[\s\S]*text-decoration: underline !important;[\s\S]*text-underline-offset: 3px !important;/u)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-character-health-recovery-labels span:first-child \{[\s\S]*text-align: left !important;/u)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-character-health-recovery-labels span:last-child \{[\s\S]*text-align: right !important;/u)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-character-health-recovery \{[\s\S]*margin-top: 6px !important;[\s\S]*padding-top: 6px !important;/u)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-main \.bioweave-character-health-close:hover[\s\S]*border-color: transparent !important;/u)
})

test('Character timing open renders before async data and avoids debug aggregation', () => {
  const openStart = APP_SOURCE.indexOf('function openCharacterTiming(')
  const loadStart = APP_SOURCE.indexOf('async function loadCharacterTimingData(')
  const closeStart = APP_SOURCE.indexOf('function closeCharacterTiming(')
  const detailPatchStart = APP_SOURCE.indexOf('function renderCharacterDetailOrFallback(')
  const detailPatchEnd = APP_SOURCE.indexOf('\n  function syncTimingEditorDraftInputs', detailPatchStart)
  const openSource = APP_SOURCE.slice(openStart, loadStart)
  const loadSource = APP_SOURCE.slice(loadStart, APP_SOURCE.indexOf('\n  function updateCharacterTimingDraft', loadStart))
  const closeSource = APP_SOURCE.slice(closeStart, openStart)
  const detailPatchSource = APP_SOURCE.slice(detailPatchStart, detailPatchEnd)
  const editorStart = RUNTIME_EVENTS_SOURCE.indexOf('async function getCharacterTimingEditorData(')
  const editorSource = RUNTIME_EVENTS_SOURCE.slice(editorStart, RUNTIME_EVENTS_SOURCE.indexOf('\n  const dataLifecycle', editorStart))
  assert.ok(openStart >= 0)
  assert.ok(loadStart > openStart)
  assert.ok(closeStart >= 0)
  assert.ok(detailPatchStart >= 0)
  assert.doesNotMatch(detailPatchSource, /renderCharacterSelection\(\)/u)
  assert.match(detailPatchSource, /detail\.outerHTML = renderCharacterDetailPane\(characterPageOptions\(\)\)/u)
  assert.match(detailPatchSource, /if \(!detail\) \{[\s\S]*render\(\)/u)
  assert.match(APP_SOURCE, /detail\.outerHTML = detailMarkup/u)
  assert.match(openSource, /timingEditorState = \{[\s\S]*open: true[\s\S]*loading: true/u)
  assert.match(openSource, /renderCharacterDetailOrFallback\(\)[\s\S]*void loadCharacterTimingData/u)
  assert.match(openSource, /stage: 'OPEN_EDITOR_SHELL_RENDER'[\s\S]*render_scope: 'character_detail'/u)
  assert.doesNotMatch(openSource, /await\s+runtime\.getCharacterTimingEditorData/u)
  assert.match(loadSource, /renderCharacterDetailOrFallback\(\)/u)
  assert.match(loadSource, /stage: 'OPEN_EDITOR_DATA_RENDER'[\s\S]*render_scope: 'character_detail'/u)
  assert.doesNotMatch(loadSource, /\.bioweave-main[\s\S]*innerHTML/u)
  assert.match(closeSource, /timingEditorRequestSequence \+= 1[\s\S]*renderCharacterDetailOrFallback\(\)/u)
  assert.match(loadSource, /requestId !== timingEditorRequestSequence/u)
  assert.match(loadSource, /!timingEditorState\.open/u)
  assert.match(loadSource, /route !== 'characters'/u)
  assert.doesNotMatch(editorSource, /getProjectionTimingDebug/u)
  assert.match(editorSource, /Promise\.all\(\[/u)
})

test('closed Timing editor drops a deferred result without replacing the mounted main pane', async () => {
  const documentRef = new AppFakeDocument()
  let releaseTimingRead
  let timingReadStarted = false
  const timingRead = new Promise(resolve => { releaseTimingRead = resolve })
  const runtime = {
    ...apiProfileRuntime('chat-timing-deferred-close'),
    collectActiveBusinessData: async () => ({
      tracking_subjects: {'char-a': {character_id: 'char-a', display_name: 'Alice', exposure_event_ids: []}},
      character_profiles: {'char-a': {character_id: 'char-a', display_name: 'Alice'}},
      active_events: [],
      analysis_status: {state: 'success', event_count: 0},
      current_state_status: 'NO_CHARACTER_FLOOR',
    }),
    getCharacterTimingEditorData: () => {
      timingReadStarted = true
      return timingRead
    },
  }
  const app = createApp(runtime, {documentRef, storageRef: {}, profileStore: {getSettings: () => ({})}})
  const root = app.openBioWeave()
  app.go('characters')
  await Promise.resolve()
  await Promise.resolve()

  const main = root.querySelector('.bioweave-main')
  const pageRoot = {}
  const list = {querySelectorAll: () => []}
  let detailMarkup = ''
  const detail = {}
  Object.defineProperty(detail, 'outerHTML', {
    get: () => detailMarkup,
    set: value => { detailMarkup = String(value) },
  })
  main.selectorNodes.set('.bioweave-characters-page', [pageRoot])
  main.selectorNodes.set('.bioweave-character-list', [list])
  main.selectorNodes.set('.bioweave-character-detail-pane', [detail])
  let fullRenderCount = 0
  let mainMarkup = main.innerHTML
  Object.defineProperty(main, 'innerHTML', {
    configurable: true,
    get: () => mainMarkup,
    set: value => {
      fullRenderCount += 1
      mainMarkup = String(value)
    },
  })

  app.openCharacter('char-a')
  const click = [...root.listeners.get('click')][0]
  const target = dataset => ({
    __root: root,
    dataset,
    closest(selector) { return selector.includes('[data-bioweave-action') ? this : null },
  })
  await click({target: target({bioweaveAction: 'open-character-timing', characterId: 'char-a'}), preventDefault() {}})
  assert.equal(timingReadStarted, true)
  assert.match(detailMarkup, /bioweave-character-timing-popover/u)
  const mountedMain = root.querySelector('.bioweave-main')

  await click({target: target({bioweaveAction: 'cancel-character-timing'}), preventDefault() {}})
  assert.doesNotMatch(detailMarkup, /bioweave-character-timing-popover/u)
  releaseTimingRead({config: null, timing_instance: null, floor_version: null})
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(root.querySelector('.bioweave-main'), mountedMain)
  assert.equal(fullRenderCount, 0)
  assert.doesNotMatch(detailMarkup, /bioweave-character-timing-popover/u)
  app.destroyBioWeave()
})

test('business debug renders existing Projection Timing diagnostics in lifecycle runtime', () => {
  const renderStart = SETTINGS_SOURCE.indexOf('function renderLifecycleRuntimeDebug(')
  const renderEnd = SETTINGS_SOURCE.indexOf('\nfunction renderBusinessDebugState(', renderStart)
  const source = SETTINGS_SOURCE.slice(renderStart, renderEnd)
  assert.match(source, /projection_timing/u)
  assert.match(source, /observation_boundary/u)
  assert.match(source, /excluded_after_aggregation_event_ids/u)
  assert.match(source, /排除 reason_code/u)
  assert.match(source, /timeout_status/u)
  assert.match(source, /Projection candidate status/u)
  assert.match(source, /effective_min/u)
  assert.match(source, /aggregation 未执行原因/u)
  assert.doesNotMatch(source, /getProjectionTimingDebug/u)
  assert.match(SETTINGS_SOURCE, /data-bioweave-nsfw-pipeline-diagnostics/u)
  assert.match(SETTINGS_SOURCE, /\['variance_ratio', (?:stage|item)\.variance_ratio\]/u)
  assert.match(SETTINGS_SOURCE, /\['variance_cap_story_days', (?:stage|item)\.variance_cap_story_days\]/u)
  assert.match(SETTINGS_SOURCE, /\['sampled_individual_offset_story_days', (?:stage|item)\.sampled_individual_offset_story_days\]/u)
  assert.match(SETTINGS_SOURCE, /\['RNG 来源', stage\.rng_source\]/u)
  assert.match(SETTINGS_SOURCE, /\['total_adjustment_cap_story_days', (?:stage|item)\.total_adjustment_cap_story_days\]/u)
  assert.doesNotMatch(SETTINGS_SOURCE, /\['variance \/ offset'/u)
  assert.match(SETTINGS_SOURCE, /trace_buffer_status/u)
  assert.match(SETTINGS_SOURCE, /诊断置信度/u)
  assert.match(SETTINGS_SOURCE, /Projection 路线 \/ 外部 API/u)
  assert.match(SETTINGS_SOURCE, /阶段快照状态/u)
  assert.match(SETTINGS_SOURCE, /Projection 路由与阶段状态/u)
  assert.match(SETTINGS_SOURCE, /status_trace/u)
  assert.match(SETTINGS_SOURCE, /timing_performance_diagnostics/u)
  assert.match(SETTINGS_SOURCE, /data-bioweave-timing-performance-diagnostics/u)
})

test('Nickname editor uses the compact shell-first popup path', () => {
  const html = charactersPage({
    characterId: 'char-a',
    trackingSubjects: {'char-a': {character_id: 'char-a', display_name: 'Alice', exposure_event_ids: []}},
    characterProfiles: {'char-a': {character_id: 'char-a', display_name: 'Alice'}},
    aliasEditor: {open: true, loading: true, characterId: 'char-a', draftAliases: [], saving: false},
  })
  const openStart = APP_SOURCE.indexOf('function openCharacterAliases(')
  const loadStart = APP_SOURCE.indexOf('function loadCharacterAliases(')
  const closeStart = APP_SOURCE.indexOf('function closeCharacterAliases(', openStart)
  const openSource = APP_SOURCE.slice(openStart, closeStart)
  assert.match(html, /bioweave-character-editor-popover/u)
  assert.match(html, /aria-modal="true"/u)
  assert.match(html, /正在读取当前 Floor 昵称/u)
  assert.match(html, /data-bioweave-action="cancel-character-alias"/u)
  assert.ok(openStart >= 0)
  assert.ok(loadStart >= 0)
  assert.ok(closeStart > openStart)
  assert.match(openSource, /aliasEditorState = \{[\s\S]*open: true[\s\S]*loading: true/u)
  assert.match(openSource, /render\(\)[\s\S]*loadCharacterAliases/u)
  assert.doesNotMatch(openSource, /await\s+runtime\.getCurrentCharacterIdentity/u)
  assert.doesNotMatch(UI_SOURCE, /__BIOWEAVE_DEBUG__/u)
  assert.match(FINAL_STYLE_SOURCE, /bioweave-character-editor-popover[\s\S]*width: min\(320px/u)
})

test('World archive uses the shared compact popup family and synchronous open path', () => {
  const toggleStart = APP_SOURCE.indexOf("if (action === 'world-model-toggle-archive')")
  const toggleEnd = APP_SOURCE.indexOf("if (action === 'world-model-restore-species')", toggleStart)
  const toggleSource = APP_SOURCE.slice(toggleStart, toggleEnd)
  assert.match(WORLD_SOURCE, /bioweave-world-model-archive-popover bioweave-compact-popup/u)
  assert.match(toggleSource, /archiveOpen: !worldModelState\.archiveOpen/u)
  assert.match(toggleSource, /render\(\)/u)
  assert.doesNotMatch(toggleSource, /await\s+/u)
  assert.match(FINAL_STYLE_SOURCE, /bioweave-compact-popup[\s\S]*max-width: calc\(100vw - 32px\)/u)
})
test('BioWeave overlay stays between ordinary host UI and host modal layers', () => {
  const match = STYLE_SOURCE.match(/\.bioweave-overlay\s*\{[\s\S]*?z-index:\s*(\d+)\s*;/)
  assert.ok(match, 'expected the BioWeave overlay to declare a numeric z-index')
  const zIndex = Number(match[1])
  assert.ok(zIndex > 4100, 'BioWeave must stay above ordinary SillyTavern overlays')
  assert.ok(zIndex < 9999, 'BioWeave must stay below SillyTavern Popup/backdrop')
  assert.ok(zIndex < 999999, 'BioWeave must stay below SillyTavern Toast')
  assert.doesNotMatch(STYLE_SOURCE, /(?:#shadow_popup|#dialogue_popup|#toast-container|dialog\.popup|\.popup-backdrop)\s*\{/)
})

test('Host Entry has no business-layer imports or dependencies', () => {
  assert.doesNotMatch(HOST_ENTRY_SOURCE, /\bimport\s/)
  assert.doesNotMatch(HOST_ENTRY_SOURCE, /from\s+['"].*(?:runtime|storage|projection|world|event-analysis|floor|snapshot|state|api|ai|tracking|swipe)/i)
})

test('Story Time debug settings stay inside Advanced / Debug and render only the supplied Runtime DTO when enabled', () => {
  const closed = settingsPage({});
  assert.match(closed, /Story Time 调试/);
  assert.match(closed, /默认关闭/);
  assert.doesNotMatch(closed, /羲和元年五月初四/);
  const open = settingsPage({storyTimeDebug: {
    enabled: true,
    info: {
      status: 'ready',
      chat_id: 'chat-debug',
      floor: {floor: 60, message_id: 'message-60', swipe_id: 0},
      source: 'synopsis_time',
      candidate: '羲和元年五月初四 午时',
      story_time: {display: '羲和元年五月初四 午时', normalized: 'cn-1-5-4T11:00', calendar_id: null, day_index: null, precision: 'hour'},
      parsed_parts: {era_label: '羲和', year: 1, month: 5, day: 4},
      calendar: {calendar_id: null, era_label: '羲和', calculation_level: 2, day_index: null},
      persisted_structured: false,
      parseable: true,
      comparable: 'not_evaluated',
      recent_event: null,
      failure_reason: null,
    },
  }});
  assert.match(open, /synopsis_time/);
  assert.match(open, /羲和元年五月初四 午时/);
  assert.match(open, /Persisted Structured/);
  assert.match(open, /Parseable/);
  assert.match(open, /Comparable/);
  assert.match(open, /Calendar ID/);
  assert.match(open, /Day Index/);
  assert.match(open, /Difference/);
  assert.match(open, /Failure Reason/);
  assert.match(open, /data-bioweave-action="refresh-story-time-debug"/);
  assert.match(open, /data-bioweave-action="copy-story-time-debug"/);
  assert.match(open, /data-bioweave-action="export-story-time-debug"/);
  assert.match(open, /class="bioweave-debug-section-header"[\s\S]*?Story Time 调试[\s\S]*?class="bioweave-debug-section-actions"[\s\S]*?data-bioweave-action="toggle-story-time-debug"[\s\S]*?data-bioweave-action="refresh-story-time-debug"[\s\S]*?data-bioweave-action="copy-story-time-debug"[\s\S]*?data-bioweave-action="export-story-time-debug"/);
  assert.equal((open.match(/data-bioweave-action="toggle-story-time-debug"/g) ?? []).length, 1);
  assert.ok(open.indexOf('data-bioweave-action="toggle-story-time-debug"') < open.indexOf('data-bioweave-action="refresh-story-time-debug"'));
  assert.ok(open.indexOf('data-bioweave-action="refresh-story-time-debug"') < open.indexOf('data-bioweave-action="copy-story-time-debug"'));
  assert.ok(open.indexOf('data-bioweave-action="copy-story-time-debug"') < open.indexOf('data-bioweave-action="export-story-time-debug"'));
  assert.match(STYLE_SOURCE, /\.bioweave-debug-preview-scroll\s*\{[\s\S]*?height:\s*240px[\s\S]*?overflow-y:\s*auto/);
  assert.match(STYLE_SOURCE, /\.bioweave-story-time-debug-content\s*\{[\s\S]*?padding:/);
  assert.match(STYLE_SOURCE, /\.bioweave-debug-section-actions\s*\{[\s\S]*?display:\s*flex[\s\S]*?gap:\s*8px/);
  assert.match(STYLE_SOURCE, /\.bioweave-debug-section-actions \.bioweave-checkbox-label\s*\{[\s\S]*?display:\s*inline-flex[\s\S]*?align-items:\s*center[\s\S]*?gap:\s*6px/);
  assert.doesNotMatch(open, /她回忆/);
  const disclosureNames = [...open.matchAll(/data-bioweave-settings-disclosure="([^"]+)"/g)].map(match => match[1]);
  assert.ok(disclosureNames.includes('analysis_debug'));
  assert.doesNotMatch(open, /data-bioweave-settings-disclosure="story_time_debug"/);
  assert.equal(disclosureNames.at(-1), 'analysis_debug');
  const advancedStart = open.indexOf('data-bioweave-settings-disclosure="analysis_debug"');
  assert.ok(advancedStart >= 0);
});
test('top app header drag moves only the panel and ignores header controls', () => {
  const createPointerTarget = rect => {
    const listeners = new Map()
    return {
      style: { left: '', top: '' },
      dataset: {},
      parentElement: null,
      addEventListener(type, listener) {
        const registered = listeners.get(type) ?? new Set()
        registered.add(listener)
        listeners.set(type, registered)
      },
      removeEventListener(type, listener) {
        listeners.get(type)?.delete(listener)
      },
      dispatch(type, event = {}) {
        const dispatched = {
          ...event,
          type,
          target: event.target ?? this,
          defaultPrevented: false,
          preventDefault() {
            this.defaultPrevented = true
          },
        }
        for (const listener of listeners.get(type) ?? []) listener(dispatched)
        return dispatched
      },
      closest() {
        return null
      },
      setPointerCapture(pointerId) {
        this.capturedPointerId = pointerId
      },
      releasePointerCapture(pointerId) {
        if (this.capturedPointerId === pointerId) delete this.capturedPointerId
      },
      getBoundingClientRect() {
        return rect
      },
    }
  }
  const documentRef = createPointerTarget(null)
  const overlay = createPointerTarget({
    left: 0,
    top: 0,
    width: 800,
    height: 600,
    right: 800,
    bottom: 600,
  })
  const root = createPointerTarget({
    left: 200,
    top: 150,
    width: 400,
    height: 300,
    right: 600,
    bottom: 450,
  })
  const handle = createPointerTarget(null)
  root.parentElement = overlay
  const controller = createPanelDragController({ root, handle, documentRef })
  const down = handle.dispatch('pointerdown', {
    clientX: 100,
    clientY: 100,
    pointerId: 7,
    button: 0,
  })
  assert.equal(down.defaultPrevented, true)
  assert.equal(handle.capturedPointerId, 7)
  documentRef.dispatch('pointermove', {
    clientX: 140,
    clientY: 130,
    pointerId: 7,
  })
  assert.equal(root.style.left, '40px')
  assert.equal(root.style.top, '30px')
  assert.equal(root.dataset.dragging, 'true')
  documentRef.dispatch('pointerup', { pointerId: 7 })
  assert.equal(root.dataset.dragging, undefined)
  assert.equal(handle.capturedPointerId, undefined)
  const blockedTarget = { closest: () => ({}) }
  handle.dispatch('pointerdown', {
    clientX: 100,
    clientY: 100,
    pointerId: 8,
    button: 0,
    target: blockedTarget,
  })
  documentRef.dispatch('pointermove', {
    clientX: 180,
    clientY: 180,
    pointerId: 8,
  })
  assert.equal(root.style.left, '40px')
  assert.equal(root.style.top, '30px')
  controller.destroy()
})
test('production panel owns paragraph rhythm before page-specific spacing', () => {
  assert.match(STYLE_SOURCE, /\.bioweave-panel h1,[\s\S]*?\.bioweave-panel h4,[\s\S]*?\.bioweave-panel p\s*\{\s*margin:\s*0;/)
  assert.match(STYLE_SOURCE, /\.bioweave-character-exposure-list\s*\{[\s\S]*?margin-top:\s*5px/)
  assert.match(STYLE_SOURCE, /\.bioweave-event-review-summary\s*\{[\s\S]*?margin:\s*2px 0 5px/)
})
test('production shell uses the unified top routebar on every viewport', () => {
  assert.match(APP_SOURCE, /class="bioweave-app-header"/)
  assert.match(APP_SOURCE, /class="bioweave-app-header" data-bioweave-drag-handle/)
  assert.match(APP_SOURCE, /createPanelDragController/)
  assert.match(APP_SOURCE, /class="bioweave-routebar"/)
  assert.match(APP_SOURCE, /class="bioweave-route-items"/)
  assert.match(APP_SOURCE, /data-bioweave-action="cycle-theme"/)
  assert.match(
    APP_SOURCE,
    /const desktopRoutes = \[\s*["']overview["'],\s*["']characters["'],\s*["']events["'],\s*["']projection["'],\s*["']genealogy["'],\s*["']world["'],\s*["']settings["'],\s*["']state["']\s*,?\s*\]/,
  )
  assert.doesNotMatch(APP_SOURCE, /bioweave-bottom|bioweave-more-menu|data-bioweave-action="more"/)
  assert.doesNotMatch(STYLE_SOURCE, /\.bioweave-bottom|\.bioweave-more-menu|\.bioweave-nav-item/)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-routebar\s*\{[\s\S]*?display:\s*flex !important;[\s\S]*?gap:\s*2px !important;/)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-route-items\s*\{[\s\S]*?display:\s*flex !important;[\s\S]*?min-width:\s*100% !important;/)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-route-item\s*\{[\s\S]*?min-width:\s*72px !important;[\s\S]*?padding:\s*0 11px !important;/)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-route-item\s*\{[\s\S]*?font-size:\s*14px !important;/)
  assert.match(FINAL_STYLE_SOURCE, /@media \(max-width: 767px\)[\s\S]*?\.bioweave-route-item\s*\{[\s\S]*?font-size:\s*13px !important;/)
  assert.match(
    FINAL_STYLE_SOURCE,
    /@media \(max-width: 767px\)[\s\S]*?\.bioweave-routebar\s*\{[\s\S]*?display:\s*block !important;[\s\S]*?overflow:\s*hidden !important;[\s\S]*?\.bioweave-route-items\s*\{[\s\S]*?repeat\(4, minmax\(0, 1fr\)\) !important;/,
  )
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-text-button\s*\{[\s\S]*?color:\s*var\(--bioweave-accent\) !important;/)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-panel \.bioweave-app-header\[data-bioweave-drag-handle\][\s\S]*?touch-action:\s*none !important;/)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-panel\s*\{[\s\S]*?position:\s*relative !important;/)
  assert.match(
    FINAL_STYLE_SOURCE,
    /\.bioweave-panel input\.bioweave-checkbox,[\s\S]*?appearance:\s*auto !important;[\s\S]*?-webkit-appearance:\s*checkbox !important;/,
  )
  assert.match(FINAL_STYLE_SOURCE, /input\.bioweave-checkbox:indeterminate[\s\S]*?accent-color:\s*var\(--bioweave-warn\) !important;/)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-settings-page > \.bioweave-settings-disclosure\s*\{[\s\S]*?margin-inline:\s*0 !important;/)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-settings-page\s*\{[\s\S]*?gap:\s*3px !important;/)
  assert.match(
    FINAL_STYLE_SOURCE,
    /\.bioweave-settings-page > \.bioweave-settings-disclosure \+ \.bioweave-settings-disclosure\s*\{[\s\S]*?margin-top:\s*0 !important;/,
  )
  assert.match(
    FINAL_STYLE_SOURCE,
    /\.bioweave-settings-page > \.bioweave-settings-disclosure:not\(\[open\]\)[\s\S]*?\.bioweave-settings-summary-status\.good[\s\S]*?color:\s*var\(--bioweave-text-secondary\) !important;/,
  )
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-settings-page \.bioweave-settings-summary-arrow,[\s\S]*?margin-left:\s*0 !important;/)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-settings-page \.bioweave-settings-summary-status\s*\{[\s\S]*?margin-left:\s*auto !important;/)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-settings-page \.bioweave-analysis-source-list\s*\{[\s\S]*?gap:\s*4px !important;/)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-external-memory-list\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) !important;/)
  assert.match(
    FINAL_STYLE_SOURCE,
    /\.bioweave-settings-page \.bioweave-recent-story-regex-row,[\s\S]*?grid-template-columns:\s*auto 72px minmax\(150px, 1\.7fr\) auto auto auto !important;/,
  )
  assert.match(
    FINAL_STYLE_SOURCE,
    /\.bioweave-settings-page \.bioweave-recent-story-order-action\s*\{[\s\S]*?width:\s*20px !important;[\s\S]*?padding:\s*0 !important;/,
  )
  assert.match(
    FINAL_STYLE_SOURCE,
    /\.bioweave-settings-page \.bioweave-analysis-prompt-settings\s*\{[\s\S]*?display:\s*grid !important;[\s\S]*?gap:\s*9px !important;/,
  )
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-settings-page \.bioweave-analysis-prompt-field > span\s*\{[\s\S]*?white-space:\s*normal !important;/)
  assert.match(
    FINAL_STYLE_SOURCE,
    /\.bioweave-settings-page \.bioweave-profile-summary\s*\{[\s\S]*?display:\s*flex !important;[\s\S]*?white-space:\s*nowrap !important;/,
  )
  assert.match(
    FINAL_STYLE_SOURCE,
    /\.bioweave-settings-page \.bioweave-select,[\s\S]*?appearance:\s*auto !important;[\s\S]*?-webkit-appearance:\s*menulist !important;/,
  )
  assert.match(
    FINAL_STYLE_SOURCE,
    /@media \(max-width: 767px\)[\s\S]*?grid-template-columns:\s*18px 60px minmax\(0, 1fr\) 28px 20px 28px !important;[\s\S]*?align-items:\s*stretch !important;/,
  )
  assert.match(FINAL_RESPONSIVE_STYLE_SOURCE, /grid-template-columns:\s*auto 72px minmax\(150px, 1\.7fr\) auto auto auto !important;/)
  assert.match(FINAL_RESPONSIVE_STYLE_SOURCE, /grid-template-columns:\s*18px 60px minmax\(0, 1fr\) 28px 20px 28px !important;/)
  assert.match(
    FINAL_RESPONSIVE_STYLE_SOURCE,
    /\.bioweave-recent-story-regex-row,[\s\S]*?height:\s*32px !important;[\s\S]*?overflow:\s*visible !important;/,
  )
  assert.match(
    FINAL_RESPONSIVE_STYLE_SOURCE,
    /\.bioweave-recent-story-regex-switch \.bioweave-switch-track\s*\{[\s\S]*?position:\s*relative !important;[\s\S]*?overflow:\s*hidden !important;/,
  )
  assert.match(
    FINAL_RESPONSIVE_STYLE_SOURCE,
    /\.bioweave-recent-story-regex-switch \.bioweave-switch-input:checked \+ \.bioweave-switch-track \.bioweave-switch-thumb\s*\{[\s\S]*?left:\s*auto !important;[\s\S]*?right:\s*2px !important;[\s\S]*?transform:\s*none !important;/,
  )
  assert.match(
    FINAL_RESPONSIVE_STYLE_SOURCE,
    /\.bioweave-recent-story-read-options\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1\.15fr\) minmax\(0, \.85fr\) !important;[\s\S]*?gap:\s*4px !important;/,
  )
  assert.match(
    STYLE_SOURCE,
    /\.bioweave-world-model-page \.bioweave-world-model-species-grid\s*\{[\s\S]*?display:\s*grid\s*!important[\s\S]*?overflow:\s*visible\s*!important/,
  )
})

test('Theme persists across App destroy and remount through the host Window storage', () => {
  const storage = new Map()
  const hostWindow = {
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
    },
  }
  const createThemeApp = documentRef => createApp(apiProfileRuntime('chat-theme-persistence'), {
    documentRef,
    windowRef: hostWindow,
    profileStore: {getSettings: () => ({})},
  })
  const firstDocument = new AppFakeDocument()
  firstDocument.defaultView = hostWindow
  const firstApp = createThemeApp(firstDocument)
  firstApp.openBioWeave()
  firstApp.setTheme('dark')
  assert.equal(storage.get('bioweave_ui_theme'), 'dark')
  firstApp.destroyBioWeave()
  const secondDocument = new AppFakeDocument()
  secondDocument.defaultView = hostWindow
  const secondApp = createThemeApp(secondDocument)
  const root = secondApp.openBioWeave()
  assert.equal(root.dataset.theme, 'dark')
  secondApp.destroyBioWeave()
})

test('Theme storage failures do not roll back the current UI theme', () => {
  const documentRef = new AppFakeDocument()
  const storageRef = {
    getItem: () => { throw new Error('STORAGE_DISABLED') },
    setItem: () => { throw new Error('STORAGE_DISABLED') },
  }
  const app = createApp(apiProfileRuntime('chat-theme-failure'), {documentRef, storageRef})
  const root = app.openBioWeave()
  assert.doesNotThrow(() => app.setTheme('dark'))
  assert.equal(root.dataset.theme, 'dark')
  app.destroyBioWeave()
})
test('App consumes the preference port for Theme persistence', () => {
  const calls = []
  const preferences = {
    readTheme: () => 'tavern',
    writeTheme: value => calls.push(value),
  }
  const app = createApp(apiProfileRuntime('chat-theme-preference-port'), {documentRef: new AppFakeDocument(), preferences})
  const root = app.openBioWeave()
  calls.length = 0
  app.setTheme('dark')
  assert.deepEqual(calls, ['dark'])
  assert.equal(root.dataset.theme, 'dark')
  app.destroyBioWeave()
})
test('theme control is icon-only and keeps the configured day and Tavern palettes', () => {
  assert.match(APP_SOURCE, /data-bioweave-theme-icon/)
  assert.match(APP_SOURCE, /fa-solid fa-circle-half-stroke/)
  assert.match(APP_SOURCE, /fa-solid fa-sun/)
  assert.match(APP_SOURCE, /fa-solid fa-moon/)
  assert.doesNotMatch(APP_SOURCE, /data-bioweave-theme-button[^>]*>跟随酒馆<\/button>/)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-theme-button\s*\{[\s\S]*?display:\s*grid !important;/)
  assert.match(
    FINAL_STYLE_SOURCE,
    /\.bioweave-panel\[data-theme="light"\]\s*\{[\s\S]*?--bioweave-bg:\s*#cbd6db !important;[\s\S]*?--bioweave-surface:\s*#dbe4e8 !important;/,
  )
  assert.match(
    FINAL_STYLE_SOURCE,
    /\.bioweave-panel\[data-theme="tavern"\]\s*\{[\s\S]*?--bioweave-bg:\s*var\(--SmartThemeBlurTintColor, #202a31\) !important;[\s\S]*?--bioweave-accent:\s*var\(--SmartThemeQuoteColor, #4f91b6\) !important;/,
  )
  assert.match(FINAL_STYLE_SOURCE, /@media \(max-width: 767px\)[\s\S]*?\.bioweave-theme-button\s*\{[\s\S]*?display:\s*grid !important;/)
})
test('settings disclosure surfaces use theme tokens instead of fixed night colors', () => {
  assert.match(
    FINAL_STYLE_SOURCE,
    /\.bioweave-settings-page > \.bioweave-settings-disclosure > \.bioweave-settings-summary,[\s\S]*?background:\s*var\(--bioweave-header\) !important;/,
  )
  assert.match(
    FINAL_STYLE_SOURCE,
    /\.bioweave-settings-page > \.bioweave-settings-disclosure\[open\] > \.bioweave-settings-summary,[\s\S]*?background:\s*var\(--bioweave-card-selected\) !important;/,
  )
  assert.match(
    FINAL_STYLE_SOURCE,
    /\.bioweave-settings-page \.bioweave-settings-disclosure > \.bioweave-card,[\s\S]*?border-top:\s*1px solid var\(--bioweave-border\) !important;[\s\S]*?background:\s*var\(--bioweave-surface-raised\) !important;/,
  )
  assert.match(
    FINAL_STYLE_SOURCE,
    /\.bioweave-settings-page \.bioweave-analysis-worldbook > summary,[\s\S]*?background:\s*var\(--bioweave-surface-soft\) !important;/,
  )
  assert.match(
    FINAL_STYLE_SOURCE,
    /\.bioweave-settings-page \.bioweave-analysis-source-child\s*\{[\s\S]*?background:\s*var\(--bioweave-surface\) !important;/,
  )
})
test('production settings controls use the canonical checkbox, memory, and regex classes', () => {
  const checkboxTags = [...UI_SOURCE.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)].map(match => match[0])
  assert.ok(checkboxTags.length > 0, 'expected production settings to render checkbox controls')
  assert.ok(
    checkboxTags.every(tag => /bioweave-checkbox|bioweave-switch-input/.test(tag)),
    'every checkbox must use the native checkbox or switch contract',
  )
  assert.match(UI_SOURCE, /bioweave-external-memory-list/)
  assert.match(UI_SOURCE, /bioweave-external-memory-status/)
  assert.match(UI_SOURCE, /bioweave-regex-row bioweave-recent-story-regex-row/)
  assert.match(UI_SOURCE, /bioweave-regex-move bioweave-recent-story-regex-order/)
  assert.match(UI_SOURCE, /bioweave-analysis-child-status/)
  assert.match(UI_SOURCE, /bioweave-analysis-section-chevron/)
  assert.match(UI_SOURCE, /data-bioweave-analysis-section-toggle/)
  assert.match(UI_SOURCE, /data-bioweave-analysis-section-source-ids/)
  assert.match(UI_SOURCE, /bioweave-recent-story-read-options/)
  assert.match(UI_SOURCE, /bioweave-world-model-species-grid/)
  assert.match(UI_SOURCE, /bioweave-world-model-type-grid/)
  assert.match(UI_SOURCE, /bioweave-world-model-card-summary/)
  assert.match(UI_SOURCE, /bioweave-world-model-type-card-summary/)
  assert.doesNotMatch(UI_SOURCE, /bioweave-world-model-type-selector/)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-main \.bioweave-badge\s*\{[\s\S]*?border-radius:\s*999px !important;/)
  assert.match(
    FINAL_STYLE_SOURCE,
    /\.bioweave-settings-page > \.bioweave-settings-disclosure > \.bioweave-settings-summary,[\s\S]*?min-height:\s*56px !important/,
  )
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-analysis-section-chevron::before\s*\{[\s\S]*?content:\s*'\+';/)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-settings-page \.bioweave-analysis-section-chevron\s*\{[\s\S]*?font-size:\s*13px !important;/)
  assert.match(
    FINAL_STYLE_SOURCE,
    /\.bioweave-settings-page \.bioweave-analysis-worldbook-title strong,[\s\S]*?font-size:\s*13px !important;[\s\S]*?font-weight:\s*700 !important;/,
  )
})
test('settings dropdown surfaces are not clipped by compact disclosure cards', () => {
  assert.match(UI_SOURCE, /bioweave-api-source-disclosure/)
  assert.match(UI_SOURCE, /bioweave-model-picker/)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-settings-page > \.bioweave-api-source-disclosure\s*\{[\s\S]*?overflow:\s*visible !important;/)
  assert.match(
    FINAL_STYLE_SOURCE,
    /\.bioweave-settings-page \.bioweave-api-source-disclosure \.bioweave-model-picker\s*\{[\s\S]*?position:\s*relative !important;[\s\S]*?overflow:\s*visible !important;/,
  )
  assert.match(
    FINAL_STYLE_SOURCE,
    /\.bioweave-settings-page \.bioweave-api-source-disclosure \.bioweave-model-dropdown\s*\{[\s\S]*?z-index:\s*30 !important;[\s\S]*?max-width:\s*100% !important;/,
  )
  assert.match(
    FINAL_STYLE_SOURCE,
    /\.bioweave-settings-page \.bioweave-select\s*\{[\s\S]*?width:\s*100% !important;[\s\S]*?min-width:\s*0 !important;[\s\S]*?max-width:\s*100% !important;/,
  )
})
class FakeElement {
  constructor(documentRef, tagName = 'div') {
    this.ownerDocument = documentRef
    this.tagName = tagName.toUpperCase()
    this.children = []
    this.parentElement = null
    this.dataset = {}
    this.attributes = new Map()
    this.listeners = new Map()
    this.hidden = false
    this.id = ''
    this.className = ''
  }
  get isConnected() {
    let node = this
    while (node.parentElement) node = node.parentElement
    return node === this.ownerDocument.documentElement
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parentElement?.removeChild(node)
      node.parentElement = this
      this.children.push(node)
    }
  }
  removeChild(node) {
    const index = this.children.indexOf(node)
    if (index >= 0) this.children.splice(index, 1)
    node.parentElement = null
  }
  remove() {
    this.parentElement?.removeChild(this)
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value))
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }
  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener)
  }
  dispatch(type, extra = {}) {
    const event = {
      type,
      target: this,
      key: extra.key,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true
      },
    }
    for (const listener of this.listeners.get(type) ?? []) listener(event)
    return event
  }
  querySelectorAll(selector) {
    const matches = []
    const visit = node => {
      for (const child of node.children) {
        if (selector.startsWith('#') && child.id === selector.slice(1)) matches.push(child)
        visit(child)
      }
    }
    visit(this)
    return matches
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null
  }
}
class FakeDocument {
  constructor() {
    this.documentElement = new FakeElement(this, 'html')
    this.body = new FakeElement(this, 'body')
    this.documentElement.append(this.body)
    this.body.clickCount = 0
    this.body.click = () => {
      this.body.clickCount += 1
    }
    this.listeners = new Map()
  }
  createElement(tagName) {
    return new FakeElement(this, tagName)
  }
  querySelectorAll(selector) {
    return this.documentElement.querySelectorAll(selector)
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null
  }
  getElementById(id) {
    return this.querySelector('#' + id)
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }
  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener)
  }
}
class AppFakeElement extends FakeElement {
  constructor(documentRef, tagName = 'div') {
    super(documentRef, tagName)
    this._innerHTML = ''
    this.selectorNodes = new Map()
    this.classList = {
      toggle: (name, force) => {
        const names = new Set(this.className.split(/\s+/).filter(Boolean))
        if (force) names.add(name)
        else names.delete(name)
        this.className = [...names].join(' ')
      },
    }
  }
  set innerHTML(value) {
    this._innerHTML = String(value)
    if (this.className.includes('bioweave-root') && this._innerHTML.includes('bioweave-main')) this.buildAppShell()
  }
  get innerHTML() {
    return this._innerHTML
  }
  buildAppShell() {
    if (this.children.length) return
    const add = (selector, tagName) => {
      const node = new AppFakeElement(this.ownerDocument, tagName)
      this.append(node)
      this.selectorNodes.set(selector, [node])
      return node
    }
    add('.bioweave-route-items', 'div')
    add('.bioweave-main', 'main')
  }
  querySelectorAll(selector) {
    return this.selectorNodes.get(selector) ?? []
  }
  querySelector(selector) {
    return this.selectorNodes.get(selector)?.[0] ?? null
  }
  contains(node) {
    if (node === this || node?.__root === this) return true
    let current = node
    while (current?.parentElement) {
      if (current.parentElement === this) return true
      current = current.parentElement
    }
    return false
  }
}
class AppFakeDocument extends FakeDocument {
  constructor() {
    super()
    this.defaultView = {}
  }
  createElement(tagName) {
    return new AppFakeElement(this, tagName)
  }
}
class FakeMutationObserver {
  static latest = null
  constructor(callback) {
    this.callback = callback
    this.disconnected = false
    FakeMutationObserver.latest = this
  }
  observe() {}
  disconnect() {
    this.disconnected = true
  }
  trigger() {
    if (!this.disconnected) this.callback([])
  }
}
function createSettingsForm(values = {}) {
  const fields = Object.fromEntries(
    Object.entries({
      profile_id: '',
      name: '',
      api_url: 'https://api.example/v1',
      model: '',
      api_key: '',
      clear_secret: false,
      ...values,
    }).map(([name, value]) => [name, name === 'clear_secret' ? { checked: Boolean(value), value: '' } : { value: String(value ?? '') }]),
  )
  return {
    fields,
    elements: {
      namedItem(name) {
        return fields[name] ?? null
      },
    },
  }
}
function attachSettingsForm(root, form) {
  root.selectorNodes.set('[data-bioweave-settings-form]', [form])
  return form
}
function actionTarget(root, dataset) {
  return {
    __root: root,
    dataset,
    closest(selector) {
      return selector.includes('[data-bioweave-action]') ? this : null
    },
  }
}
function assignmentTarget(root, value, { slot = 'world_analysis', form = null, action = '', profileId = '' } = {}) {
  const target = {
    __root: root,
    value,
    dataset: {
      bioweaveAssignment: slot,
      ...(action ? { bioweaveAction: action } : {}),
      ...(profileId ? { profileId } : {}),
    },
    closest(selector) {
      if (selector === '[data-bioweave-assignment]') return this
      if (form && selector === '[data-bioweave-settings-form]') return form
      if (action && selector.includes('[data-bioweave-action]')) return this
      return null
    },
  }
  return target
}
function settingsSourceTarget(root, value) {
  return {
    __root: root,
    value,
    dataset: {
      bioweaveApiSource: true,
    },
    closest(selector) {
      if (selector === '[data-bioweave-api-source]') return this
      return null
    },
  }
}
function settingsDefaultProfileTarget(root, value) {
  return {
    __root: root,
    value,
    dataset: {
      bioweaveDefaultProfile: true,
    },
    closest(selector) {
      return selector === '[data-bioweave-default-profile]' ? this : null
    },
  }
}
function settingsFormTarget(root, form) {
  return {
    __root: root,
    dataset: {},
    closest(selector) {
      return selector === '[data-bioweave-settings-form]' ? form : null
    },
  }
}
function apiProfileRuntime(chatId = 'chat-model-cache') {
  return {
    chat: {
      current: () => chatId,
      token: () => ({ chatId }),
      assert: () => {},
    },
    store: {
      getChat: () => ({ settings: {} }),
      saveChat: async () => {},
    },
    st: {
      getContext: () => ({ chatId }),
      fetch: async () => ({ ok: true, json: async () => [] }),
      getRequestHeaders: () => ({}),
    },
    subscribe: () => () => {},
  }
}

test('Projection terminal status automatically rereads business projections without rereading while running', async () => {
  const documentRef = new AppFakeDocument()
  let runtimeListener = null
  let businessReads = 0
  const runtime = {
    ...apiProfileRuntime('chat-projection-auto-refresh'),
    collectActiveBusinessData: async () => {
      businessReads += 1
      return {
        projections: businessReads > 1 ? [{id: 'projection-read-back', generated_statement: '候选支线'}] : [],
        projection_summary: {active_count: businessReads > 1 ? 1 : 0, recent: []},
        analysis_status: {state: 'success'},
      }
    },
    subscribe: listener => {
      runtimeListener = listener
      return () => { if (runtimeListener === listener) runtimeListener = null }
    },
  }
  const app = createApp(runtime, {documentRef, storageRef: {}, profileStore: {getSettings: () => ({})}})
  app.openBioWeave()
  app.go('projection')
  await new Promise(resolve => setTimeout(resolve, 0))
  const readsBeforeRunning = businessReads
  runtimeListener?.({type: 'PROJECTION_ANALYSIS_STATUS_CHANGED', payload: {state: 'running', stage: 'PROJECTION_AI_REQUEST_STARTED'}})
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(businessReads, readsBeforeRunning)
  runtimeListener?.({type: 'PROJECTION_ANALYSIS_STATUS_CHANGED', payload: {state: 'success', stage: 'PROJECTION_READBACK'}})
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(businessReads, readsBeforeRunning + 1)
  runtimeListener?.({type: 'PROJECTION_ANALYSIS_STATUS_CHANGED', payload: {state: 'success', stage: 'PROJECTION_READBACK'}})
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(businessReads, readsBeforeRunning + 1)
  assert.match(app.getRoot().querySelector('.bioweave-main').innerHTML, /候选支线/)
  app.destroyBioWeave()
})

test('Projection app forwards storyline snapshots from the business DTO into the selected detail', async () => {
  const documentRef = new AppFakeDocument()
  const runtime = {
    ...apiProfileRuntime('chat-projection-storyline-ui'),
    collectActiveBusinessData: async () => ({
      tracking_subjects: {char_qi: {character_id: 'char_qi', display_name: '祁鸢'}},
      projections: [{id: 'projection-q', subject: {id: 'char_qi'}, rule: {label: '恶心'}, status: 'active'}],
      projection_summary: {active_count: 1, recent: []},
      storyline_snapshots: [{
        subject_id: 'char_qi',
        status: 'candidates',
        branches: [1, 2, 3].map(index => ({
          branch_id: `branch-${index}`,
          title: `路线 ${index}`,
          premise: `路线 ${index} 前提。`,
          nodes: [1, 2, 3].map(node => ({objective: `节点 ${node}`})),
          conclusion_goal: `路线 ${index} 结论。`,
        })),
      }],
      analysis_status: {state: 'success'},
    }),
  }
  const app = createApp(runtime, {documentRef, storageRef: {}, profileStore: {getSettings: () => ({})}})
  app.openBioWeave()
  app.go('projection')
  await new Promise(resolve => setTimeout(resolve, 0))
  const markup = app.getRoot().querySelector('.bioweave-main').innerHTML
  assert.match(markup, /候选剧情支线/u)
  assert.match(markup, /路线 1/u)
  assert.match(markup, /现在可能出现/u)
  app.destroyBioWeave()
})

test('settled Floor deletion forces the projection page to read the rolled-back Floor', async () => {
  const documentRef = new AppFakeDocument()
  let runtimeListener = null
  const reads = []
  const runtime = {
    ...apiProfileRuntime('chat-projection-floor-delete-refresh'),
    collectActiveBusinessData: async options => {
      reads.push({...options})
      const projections = options?.force === true
        ? [{id: 'projection-rolled-back', generated_statement: '回退楼层候选'}]
        : []
      return {
        projections,
        projection_summary: {active_count: projections.length, recent: []},
        analysis_status: {state: 'success'},
      }
    },
    subscribe: listener => {
      runtimeListener = listener
      return () => { if (runtimeListener === listener) runtimeListener = null }
    },
  }
  const app = createApp(runtime, {documentRef, storageRef: {}, profileStore: {getSettings: () => ({})}})
  app.openBioWeave()
  app.go('projection')
  await new Promise(resolve => setTimeout(resolve, 0))

  runtimeListener?.({type: 'MESSAGE_DELETED', payload: {message_id: 12, swipe_id: 0}})
  runtimeListener?.({type: 'BIOWEAVE_LIFECYCLE_SETTLED', mutationType: 'MESSAGE_DELETED', payload: {message_id: 12, swipe_id: 0}})
  await new Promise(resolve => setTimeout(resolve, 0))

  assert.ok(reads.some(read => read.reason === 'BIOWEAVE_LIFECYCLE_SETTLED'))
  assert.equal(reads.at(-1)?.force, true)
  assert.match(app.getRoot().querySelector('.bioweave-main').innerHTML, /回退楼层候选/u)
  app.destroyBioWeave()
})

test('Projection page renders built-in pre-confirmation branch labels instead of concern keys', () => {
  const html = projectionPage({
    currentStoryTime: {day_index: 21, display: '第 21 天'},
    trackingSubjects: {
      char_000001: {character_id: 'char_000001', display_name: '祁鸢'},
    },
    projectionSubjectId: 'char_000001',
    projections: [{
      id: 'projection-built-in',
      subject: {id: 'char_000001'},
      rule: {label: '嗜睡或疲倦', description: '观察期内可能出现嗜睡或疲倦等身体表现；这只是备选剧情方向，不是已确认怀孕事实。'},
      concern_key: 'pre_confirmation_observation:fatigue',
      aggregated_candidate_count: 4,
      status: 'active',
      generated_statement: '观察期内可能出现嗜睡或疲倦等身体表现；这只是备选剧情方向。',
      source_refs: [],
      timing: {elapsed_story_days: 21, reference_story_time: {day_index: 0}, current_story_time: {day_index: 21, display: '第 21 天'}},
    }],
    projectionSummary: {active_count: 1},
  })
  assert.match(html, /人物推演/u)
  assert.match(html, /祁鸢/u)
  assert.match(html, /第 21 天/u)
  assert.match(html, /现在可能出现/u)
  assert.match(html, /最后怎么结束/u)
  assert.match(html, /嗜睡或疲倦/u)
  assert.match(html, /观察期内可能出现嗜睡或疲倦等身体表现/u)
  assert.doesNotMatch(html, /备选路线/u)
  assert.doesNotMatch(html, /这只是备选剧情方向/u)
  assert.doesNotMatch(html, /pre_confirmation_observation:fatigue/u)
})

test('Projection page does not reuse a legacy stage snapshot elapsed day for the current stage', () => {
  const stages = [
    {key: 'early_subtle_changes', label: '第 14–20 天', phase: '早期细微变化', min_elapsed_story_days: 14, max_elapsed_story_days: 20, branches: []},
    {key: 'early_reactions', label: '第 21–27 天', phase: '早期反应出现', min_elapsed_story_days: 21, max_elapsed_story_days: 27, branches: []},
    {key: 'more_obvious_reactions', label: '第 28–42 天', phase: '反应逐渐明显', min_elapsed_story_days: 28, max_elapsed_story_days: 42, branches: [{key: 'nausea', label: '恶心'}]},
  ]
  const html = projectionPage({
    currentStoryTime: {day_index: 31, display: '第 31 天'},
    trackingSubjects: {char_qi: {character_id: 'char_qi', display_name: '祁鸢'}},
    projectionSubjectId: 'char_qi',
    projections: [{
      id: 'projection-reused-floor-106',
      subject: {id: 'char_qi'},
      concern_key: 'pre_confirmation_observation:nausea',
      rule: {label: '恶心', observation_stage: stages[2]},
      aggregated_candidate_count: 4,
      status: 'active',
      timing: {
        reference_story_time: {day_index: 0},
        current_story_time: {day_index: 30},
        elapsed_story_days: 31,
        observation_stage_key: stages[2].key,
      },
    }],
    projectionSummary: {active_count: 1, observation_schedule: stages},
  })
  assert.match(html, /第 28–42 天 · 反应逐渐明显/u)
  assert.match(html, /第 30 天/u)
  assert.doesNotMatch(html, /第 31 天/u)
})

test('Projection page prefers current Story Time over a stale saved stage key', () => {
  const stages = [
    {key: 'early_subtle_changes', label: '第 14–20 天', phase: '早期细微变化', min_elapsed_story_days: 14, max_elapsed_story_days: 20, branches: [{key: 'fatigue', label: '嗜睡或疲倦'}]},
    {key: 'early_reactions', label: '第 21–27 天', phase: '早期反应出现', min_elapsed_story_days: 21, max_elapsed_story_days: 27, branches: [{key: 'nausea', label: '恶心'}]},
  ]
  const html = projectionPage({
    currentStoryTime: {day_index: 17, display: '第 17 天'},
    trackingSubjects: {char_qi: {character_id: 'char_qi', display_name: '祁鸢'}},
    projectionSubjectId: 'char_qi',
    projections: [{
      id: 'projection-stale-stage-key',
      subject: {id: 'char_qi'},
      concern_key: 'pre_confirmation_observation:fatigue',
      rule: {label: '嗜睡或疲倦', observation_stage: stages[0]},
      aggregated_candidate_count: 4,
      status: 'active',
      timing: {
        reference_story_time: {day_index: 0},
        current_story_time: {day_index: 17},
        observation_stage_key: stages[1].key,
      },
    }],
    projectionSummary: {active_count: 1, observation_schedule: stages},
  })
  assert.match(html, /第 14–20 天 · 早期细微变化/u)
  assert.doesNotMatch(html, /第 21–27 天 · 早期反应出现/u)
})

test('Projection page uses stable possibility labels and keeps the delete hook', () => {
  const html = projectionPage({
    trackingSubjects: {char_qi: {character_id: 'char_qi', display_name: '祁鸢'}},
    projectionSubjectId: 'char_qi',
    projections: [
      {id: 'projection-no-reaction', subject: {id: 'char_qi'}, rule: {label: '一直没有明显反应', concern_key: 'pre_confirmation_observation:no_reaction_late', description: '一直没有明显身体反应，不能因为没有反应就确认结果。'}, aggregated_candidate_count: 4, status: 'active', observed_reaction: {matched: false}},
      {id: 'projection-nausea', subject: {id: 'char_qi'}, concern_key: 'pre_confirmation_observation:nausea', rule: {label: '恶心', description: '闻到气味或进食时可能出现反胃感。'}, aggregated_candidate_count: 4, status: 'active', observed_reaction: {matched: true}},
      {id: 'projection-odor', subject: {id: 'char_qi'}, concern_key: 'pre_confirmation_observation:odor_discomfort', rule: {label: '闻到气味不舒服', description: '闻到气味时觉得不舒服。'}, aggregated_candidate_count: 4, status: 'active', observed_reaction: {matched: true}},
    ],
    projectionSummary: {
      active_count: 2,
      historical_observed_reactions: [{subject_id: 'char_qi', reaction_label: '乳房敏感'}],
    },
  })
  assert.match(html, /现在可能出现/u)
  assert.doesNotMatch(html, /始终可能/u)
  assert.match(html, /data-bioweave-action="delete-projection"/u)
  assert.equal((html.match(/bioweave-projection-signal-observed/g) ?? []).length, 2)
  assert.match(html, /已触发/u)
  assert.doesNotMatch(html, /event-nausea|Floor Version|projection-observed-nausea/u)
  assert.match(html, /已聚合候选<\/span><strong>4 人/u)
  assert.match(html, /本轮曾经触发/u)
  assert.match(html, /此前出现过，不代表当前仍持续/u)
  assert.match(html, /乳房敏感/u)
  assert.doesNotMatch(html, /当前路线/u)
  assert.doesNotMatch(html, /未知/u)
  assert.doesNotMatch(html, /备选路线/u)
  const historicalHtml = projectionPage({
    trackingSubjects: {char_qi: {character_id: 'char_qi', display_name: '祁鸢'}},
    projections: [{id: 'projection-realized', subject: {id: 'char_qi'}, rule: {label: '已出现表现', description: '正文已经记录了对应表现。'}, status: 'realized', generated_statement: '历史说明'}],
  })
  assert.match(historicalHtml, /已出现/u)
  assert.doesNotMatch(historicalHtml, /历史说明/u)
  assert.doesNotMatch(historicalHtml, /不是已经发生的事实/u)
})

test('Projection page keeps the reference header structure and active status tone', () => {
  const html = projectionPage({
    trackingSubjects: {char_qi: {character_id: 'char_qi', display_name: '祁鸢'}},
    projectionSubjectId: 'char_qi',
    projections: [{id: 'projection-active', subject: {id: 'char_qi'}, rule: {label: '恶心'}, status: 'active'}],
  })
  assert.match(html, /class="bioweave-page-head"><div class="bioweave-page-head-copy">/u)
  assert.match(html, /class="bioweave-badge good">观察中<\/span>/u)
  assert.match(html, /class="bioweave-badge accent">1 位人物观察中<\/span>/u)
  assert.match(html, /bioweave-projection-outcomes"><article class="good">/u)
})

test('Projection CSS preserves reference parity for controls, notices, and signal cards', () => {
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-projection-page \.bioweave-button\s*\{[\s\S]*?min-height: 32px !important;[\s\S]*?padding: 5px 10px !important;[\s\S]*?font-size: 12px !important;/u)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-projection-page \.bioweave-badge\.accent\s*\{[\s\S]*?background: var\(--bioweave-accent-soft\) !important;/u)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-projection-notice\s*\{[\s\S]*?border: 1px solid color-mix[\s\S]*?background: var\(--bioweave-accent-soft\) !important;/u)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-projection-stop\s*\{[\s\S]*?border-color: var\(--bioweave-danger-border\) !important;[\s\S]*?background: var\(--bioweave-danger-soft\) !important;[\s\S]*?color: var\(--bioweave-danger\) !important;/u)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-projection-page \.bioweave-projection-person-status\s*\{[\s\S]*?margin-top: 2px !important;[\s\S]*?font-size: 11px !important;/u)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-projection-signal\s*\{[\s\S]*?display: grid;[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto;[\s\S]*?background: var\(--bioweave-surface-raised\);/u)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-projection-signal > strong,[\s\S]*?grid-column: 1 \/ -1;/u)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-projection-signal-foot\s*\{[\s\S]*?grid-column: 2;[\s\S]*?display: flex;[\s\S]*?justify-content: space-between;/u)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-projection-page \.bioweave-badge\.good\s*\{[\s\S]*?background: var\(--bioweave-success-soft\) !important;[\s\S]*?color: var\(--bioweave-success\) !important;/u)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-projection-page \.bioweave-badge\.muted\s*\{[\s\S]*?border-color: var\(--bioweave-border\) !important;[\s\S]*?background: var\(--bioweave-surface-soft\) !important;[\s\S]*?color: var\(--bioweave-text-muted\) !important;/u)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-projection-person-progress i\.done\s*\{[\s\S]*?background: var\(--bioweave-success\);/u)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-projection-route-row\s*\{[\s\S]*?border: 1px solid var\(--bioweave-border\);[\s\S]*?border-radius: 7px;[\s\S]*?background: var\(--bioweave-surface-raised\);/u)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-projection-route-day\s*\{[\s\S]*?color: var\(--bioweave-accent\);[\s\S]*?font-weight: 700;/u)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-projection-outcomes article\.good\s*\{[\s\S]*?background: var\(--bioweave-success-soft\);/u)
})

test('Projection stop button keeps danger colors after shared button hover rules', () => {
  const sharedHoverIndex = FINAL_STYLE_SOURCE.indexOf('.bioweave-main .bioweave-button:hover,')
  const stopOverrideIndex = FINAL_STYLE_SOURCE.indexOf('.bioweave-main .bioweave-button.bioweave-projection-stop {')
  assert.ok(sharedHoverIndex >= 0)
  assert.ok(stopOverrideIndex > sharedHoverIndex)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-main \.bioweave-button\.bioweave-projection-stop\s*\{[\s\S]*?border-color: var\(--bioweave-danger-border\) !important;[\s\S]*?background: var\(--bioweave-danger-soft\) !important;[\s\S]*?color: var\(--bioweave-danger\) !important;/u)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-main \.bioweave-button\.bioweave-projection-stop:hover,[\s\S]*?\.bioweave-main \.bioweave-button\.bioweave-projection-stop:focus-visible\s*\{[\s\S]*?border-color: var\(--bioweave-danger\) !important;[\s\S]*?background: var\(--bioweave-danger-soft\) !important;[\s\S]*?color: var\(--bioweave-danger\) !important;/u)
})

test('Projection storyline styles use prototype bullets, hierarchy, and conclusion treatment', () => {
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-projection-storyline-route > p\s*\{[\s\S]*?font-weight: 600;/u)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-projection-storyline-node-list li\s*\{[\s\S]*?padding-left: 12px;[\s\S]*?color: var\(--bioweave-text-muted\);/u)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-projection-storyline-node-list li::before\s*\{[\s\S]*?width: 5px;[\s\S]*?height: 5px;[\s\S]*?border-radius: 50%;[\s\S]*?content: '';/u)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-projection-storyline-goal\s*\{[\s\S]*?border-left: 2px solid var\(--bioweave-warn\);[\s\S]*?background: color-mix\(in srgb, var\(--bioweave-warn\) 14%, transparent\) !important;[\s\S]*?color: var\(--bioweave-warn\);[\s\S]*?font-weight: 700;/u)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-projection-storyline-goal > span\s*\{[\s\S]*?color: inherit;[\s\S]*?font-weight: 700;/u)
  assert.match(FINAL_STYLE_SOURCE, /\.bioweave-panel\[data-theme="tavern"\]\s*\{[\s\S]*?--bioweave-warn-soft: #4b3c23 !important;/u)
})

test('Projection page renders the running storyline module without a duplicate top status bar', () => {
  const html = projectionPage({
    projectionStatus: {state: 'running'},
    trackingSubjects: {char_qi: {character_id: 'char_qi', display_name: '祁鸢'}},
    projectionSubjectId: 'char_qi',
    projections: [{id: 'projection-q', subject: {id: 'char_qi'}, rule: {label: '恶心'}, status: 'active'}],
  })
  assert.match(html, /正在生成候选路线/u)
  assert.match(html, /class="bioweave-button bioweave-projection-stop"/u)
  assert.match(html, /data-bioweave-action="stop-projection-storyline"/u)
  assert.match(html, /停止生成候选路线/u)
  assert.match(html, /class="[^"]*bioweave-projection-storyline-section[^"]*"/u)
  assert.match(html, /bioweave-projection-storyline-state-running/u)
  assert.match(html, /<div class="bioweave-projection-detail-meta">[\s\S]*<span class="bioweave-badge">生成中<\/span>/u)
  assert.match(html, /<div class="bioweave-projection-section-title">[\s\S]*<span class="bioweave-badge warn">生成中<\/span>/u)
  assert.doesNotMatch(html, /class="bioweave-card bioweave-projection-status"/u)
  assert.doesNotMatch(html, /正在等待推演 API 返回本轮非生理剧情结果/u)
})

test('Projection running status keeps the stop action available without tracked people', () => {
  const html = projectionPage({projectionStatus: {state: 'running'}, projections: []})
  assert.match(html, /bioweave-projection-storyline-state-running/u)
  assert.match(html, /data-bioweave-action="stop-projection-storyline"/u)
  assert.doesNotMatch(html, /bioweave-projection-status/u)
})

test('Projection failed status uses a neutral storyline status badge in the detail header', () => {
  const html = projectionPage({
    projectionStatus: {state: 'failed'},
    trackingSubjects: {char_qi: {character_id: 'char_qi', display_name: '祁鸢'}},
    projectionSubjectId: 'char_qi',
    projections: [{id: 'projection-q', subject: {id: 'char_qi'}, rule: {label: '恶心'}, status: 'active'}],
  })
  assert.match(html, /<div class="bioweave-projection-detail-meta">[\s\S]*<span class="bioweave-badge">生成失败<\/span>/u)
  assert.match(html, /<div class="bioweave-projection-section-title">[\s\S]*<span class="bioweave-badge warn">生成失败<\/span>/u)
})

test('Projection running status keeps one in-detail loading section without a top status bar', () => {
  const html = projectionPage({
    projectionStatus: {state: 'running'},
    trackingSubjects: {char_qi: {character_id: 'char_qi', display_name: '祁鸢'}},
    projectionSubjectId: 'char_qi',
    projections: [{id: 'projection-q', subject: {id: 'char_qi'}, rule: {label: '恶心'}, status: 'active'}],
    storylineSnapshots: [{
      subject_id: 'char_qi',
      status: 'candidates',
      branches: [1, 2, 3].map(index => ({
        title: `路线 ${index}`,
        premise: `路线 ${index} 前提。`,
        nodes: [{objective: `节点 ${index}`}],
        conclusion_goal: `路线 ${index} 结论。`,
      })),
    }],
  })
  assert.match(html, /data-bioweave-action="stop-projection-storyline"/u)
  assert.equal((html.match(/class="bioweave-projection-storyline-route"/g) ?? []).length, 0)
  assert.match(html, /class="[^"]*bioweave-projection-storyline-state[^"]*"/u)
  assert.doesNotMatch(html, /class="bioweave-card bioweave-projection-status"/u)
})

test('Projection page renders storyline candidates as an additive detail section', () => {
  const storyline = {
    subject_id: 'char_qi',
    display_name: '祁鸢',
    status: 'candidates',
    branches: [1, 2, 3].map(index => ({
      branch_id: `branch-internal-${index}`,
      title: `候选路线 ${index}`,
      premise: `候选路线 ${index} 的前提。`,
      nodes: [1, 2, 3].map(node => ({title: `节点 ${node}`, objective: `推进条件 ${node}。`, completion_signal: `完成信号 ${node}。`})),
      conclusion_goal: `路线 ${index} 的结论目标。`,
    })),
  }
  const html = projectionPage({
    trackingSubjects: {char_qi: {character_id: 'char_qi', display_name: '祁鸢'}},
    projectionSubjectId: 'char_qi',
    projections: [{id: 'projection-q', subject: {id: 'char_qi'}, rule: {label: '恶心'}, status: 'active'}],
    storylineSnapshots: [storyline],
  })
  assert.equal((html.match(/class="bioweave-projection-storyline-route"/g) ?? []).length, 3)
  assert.match(html, /候选剧情支线/u)
  assert.match(html, /候选，不是已发生事实/u)
  assert.match(html, /<div class="bioweave-projection-section-title">[\s\S]*<span class="bioweave-badge accent">等待正文推进<\/span>/u)
  assert.match(html, /候选路线 1/u)
  assert.match(html, /现在可能出现/u)
  assert.match(html, /已触发|之后可能出现|最后怎么结束/u)
  assert.doesNotMatch(html, /branch-internal-1|storyline-snapshot-internal/u)
})

test('Projection storyline detail exposes status badge and avoids duplicate route numbering', () => {
  const html = projectionPage({
    trackingSubjects: {char_qi: {character_id: 'char_qi', display_name: '祁鸢'}},
    projectionSubjectId: 'char_qi',
    projections: [{id: 'projection-q', subject: {id: 'char_qi'}, rule: {label: '恶心'}, status: 'active'}],
    storylineSnapshots: [{
      subject_id: 'char_qi',
      status: 'candidates',
      branches: [1, 2, 3].map(index => ({
        title: `就医支线 ${index}`,
        premise: `支线 ${index} 前提。`,
        nodes: [{objective: `节点 ${index}`}],
        conclusion_goal: `支线 ${index} 结论。`,
      })),
    }],
  })
  assert.match(html, /<span class="bioweave-badge">候选路线<\/span>/u)
  assert.match(html, /<strong>就医支线 1<\/strong><span class="bioweave-badge accent">路线 1<\/span>/u)
  assert.doesNotMatch(html, /<strong>1\. 就医支线 1<\/strong>/u)
  assert.doesNotMatch(html, /跟着[^<]*自己的时间走/u)
})

test('Projection page renders only the selected storyline branch and preserves the production sections', () => {
  const html = projectionPage({
    trackingSubjects: {char_qi: {character_id: 'char_qi', display_name: '祁鸢'}},
    projectionSubjectId: 'char_qi',
    projections: [{id: 'projection-q', subject: {id: 'char_qi'}, rule: {label: '恶心'}, status: 'active'}],
    storylineSnapshots: [{
      subject_id: 'char_qi',
      status: 'selected',
      selected_branch_id: 'branch-selected',
      current_node_index: 1,
      branches: [{
        branch_id: 'branch-selected',
        title: '以肠胃不适为由就医',
        premise: '先按日常不适就医。',
        nodes: [
          {title: '症状加重', objective: '症状在日常中变得难以忽略。', completion_signal: '持续不适'},
          {title: '提出检查', objective: '身边人提出去医馆检查。', completion_signal: '有人提出就医'},
          {title: '常规检查', objective: '大夫问诊并安排常规检查。', completion_signal: '检查开始'},
        ],
        conclusion_goal: '在常规检查中自然发现异常。',
      }],
    }],
  })
  assert.match(html, /当前推进支线/u)
  assert.match(html, /<div class="bioweave-projection-section-title">[\s\S]*<span class="bioweave-badge good">进行中<\/span>/u)
  assert.match(html, /单线推进/u)
  assert.match(html, /当前目标 · 身边人提出去医馆检查/u)
  assert.match(html, /完成信号：有人提出就医/u)
  assert.match(html, /<span class="bioweave-badge">已选支线<\/span>/u)
  assert.doesNotMatch(html, /候选路线 1|候选路线 2|候选路线 3/u)
  assert.match(html, /现在可能出现/u)
  assert.match(html, /之后可能出现/u)
  assert.match(html, /最后怎么结束/u)
})

test('Projection page renders a terminated storyline without hiding biological observation content', () => {
  const html = projectionPage({
    trackingSubjects: {char_qi: {character_id: 'char_qi', display_name: '祁鸢'}},
    projectionSubjectId: 'char_qi',
    projections: [{id: 'projection-q', subject: {id: 'char_qi'}, rule: {label: '恶心'}, status: 'active'}],
    storylineSnapshots: [{subject_id: 'char_qi', status: 'terminated', branches: []}],
  })
  assert.match(html, /本轮剧情支线已结束/u)
  assert.match(html, /<span class="bioweave-badge">本轮已结束<\/span>/u)
  assert.match(html, /<div class="bioweave-projection-section-title">[\s\S]*<span class="bioweave-badge muted">已结束<\/span>/u)
  assert.match(html, /现在可能出现/u)
  assert.match(html, /最后怎么结束/u)
  assert.doesNotMatch(html, /当前推进支线/u)
})

test('Projection stop action keeps the frontend info notification contract', () => {
  const source = fs.readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8')
  assert.match(source, /候选路线生成已停止。['"], ['"]info['"]/u)
})

test('Projection page keeps historical triggered reactions visible across stage changes', () => {
  const html = projectionPage({
    trackingSubjects: {char_qi: {character_id: 'char_qi', display_name: '祁鸢'}},
    projectionSubjectId: 'char_qi',
    projections: [{id: 'projection-current', subject: {id: 'char_qi'}, rule: {label: '恶心'}, status: 'active'}],
    projectionSummary: {active_count: 1, historical_observed_reactions: [{subject_id: 'char_qi', reaction_label: '乳房敏感'}]},
  })
  assert.match(html, /已触发 1 条/u)
  assert.match(html, /乳房敏感/u)
})

test('Projection page filters malformed built-in groups but keeps generic projections', () => {
  const html = projectionPage({
    trackingSubjects: {
      char_invalid: {character_id: 'char_invalid', display_name: '无效人物'},
      char_generic: {character_id: 'char_generic', display_name: '通用人物'},
    },
    projections: [
      {
        id: 'projection-invalid-built-in',
        subject: {id: 'char_invalid'},
        concern_key: 'pre_confirmation_observation:fatigue',
        rule: {label: '嗜睡或疲倦', description: '不应渲染的内置预确认。'},
        status: 'active',
      },
      {
        id: 'projection-generic',
        subject: {id: 'char_generic'},
        concern_key: 'generic_observation',
        rule: {label: '通用观察', description: '通用推演仍应显示。'},
        status: 'active',
      },
    ],
    projectionSummary: {active_count: 2},
  })
  assert.doesNotMatch(html, /无效人物/u)
  assert.doesNotMatch(html, /不应渲染的内置预确认/u)
  assert.match(html, /通用人物/u)
  assert.match(html, /通用推演仍应显示/u)
})

test('Projection page keeps each person in an independent selected detail view', () => {
  const html = projectionPage({
    trackingSubjects: {
      char_qi: {character_id: 'char_qi', display_name: '祁鸢'},
      char_shen: {character_id: 'char_shen', display_name: '沈微'},
    },
    projectionSubjectId: 'char_shen',
    projections: [
      {
        id: 'projection-qi',
        subject: {id: 'char_qi'},
        rule: {label: '恶心'},
        status: 'active',
        generated_statement: '祁鸢可能出现恶心。',
        source_refs: ['event-qi'],
        timing: {reference_story_time: {day_index: 0}, current_story_time: {day_index: 23}},
      },
      {
        id: 'projection-shen',
        subject: {id: 'char_shen'},
        rule: {label: '嗜睡或疲倦'},
        status: 'active',
        generated_statement: '沈微可能出现嗜睡或疲倦。',
        source_refs: ['event-shen'],
        timing: {reference_story_time: {day_index: 0}, current_story_time: {day_index: 16}},
      },
    ],
    projectionSummary: {active_count: 2},
  })
  assert.match(html, /data-projection-subject-id="char_qi"/u)
  assert.match(html, /data-projection-subject-id="char_shen"/u)
  assert.match(html, /沈微 的推演详情/u)
  assert.match(html, /第 16 天/u)
  assert.match(html, /沈微可能出现嗜睡或疲倦/u)
  assert.match(html, /可能：<\/b>恶心/u)
  assert.doesNotMatch(html, /pre_confirmation_observation/u)
})

test('Projection page follows the person-specific staged observation schedule', () => {
  const stages = [
    {key: 'early_subtle_changes', label: '第 14–20 天', phase: '早期细微变化', min_elapsed_story_days: 14, max_elapsed_story_days: 20, branches: [{key: 'fatigue', label: '嗜睡或疲倦'}, {key: 'breast_sensitivity', label: '乳房敏感'}, {key: 'scent_food_change', label: '对气味或食物产生轻微变化'}, {key: 'no_reaction_early', label: '暂时没有明显反应'}]},
    {key: 'early_reactions', label: '第 21–27 天', phase: '早期反应出现', min_elapsed_story_days: 21, max_elapsed_story_days: 27, branches: [{key: 'nausea', label: '恶心'}, {key: 'odor_discomfort', label: '闻到气味不舒服'}, {key: 'mood_change', label: '情绪变化'}, {key: 'appetite_change', label: '食欲变化'}]},
    {key: 'more_obvious_reactions', label: '第 28–42 天', phase: '反应逐渐明显', min_elapsed_story_days: 28, max_elapsed_story_days: 42, branches: [{key: 'nausea_worsening', label: '恶心加重'}, {key: 'vomiting', label: '可能出现孕吐'}, {key: 'persistent_fatigue', label: '持续疲倦'}, {key: 'no_reaction_late', label: '一直没有明显反应'}]},
  ]
  const currentStage = stages[1]
  const html = projectionPage({
    trackingSubjects: {char_qi: {character_id: 'char_qi', display_name: '祁鸢'}},
    projectionSubjectId: 'char_qi',
    projections: currentStage.branches.map((branch, index) => ({
      id: `projection-stage-${index}`,
      subject: {id: 'char_qi'},
      concern_key: `pre_confirmation_observation:${branch.key}`,
      rule: {label: branch.label, observation_stage: currentStage},
      status: 'active',
      aggregated_candidate_count: 4,
      generated_statement: `${branch.label}只是备选剧情方向。`,
      timing: {reference_story_time: {day_index: 0}, current_story_time: {day_index: 23}, observation_stage_key: currentStage.key},
    })),
    projectionSummary: {active_count: 4, observation_schedule: stages},
  })
  for (const label of currentStage.branches.map(branch => branch.label)) assert.match(html, new RegExp(label, 'u'))
  for (const label of stages[2].branches.map(branch => branch.label)) assert.match(html, new RegExp(label, 'u'))
  assert.match(html, /第 21–27 天 · 早期反应出现/u)
  assert.match(html, /现在可能出现<\/h3><span class="bioweave-badge accent">早期反应出现<\/span>/u)
  assert.doesNotMatch(html, /现在可能出现<\/h3><span class="bioweave-badge accent">第 21–27 天<\/span>/u)
  assert.match(html, /距离本轮结算<\/span><strong>19 天/u)
  assert.doesNotMatch(html, /距离本轮结算<\/span><strong>观察期内/u)
  assert.doesNotMatch(html, /只是备选剧情方向/u)
  assert.doesNotMatch(html, /嗜睡或疲倦/u)
})
function createSettingsTestApp(profileStore, { apiClient = undefined, chatId = 'chat-profile-save' } = {}) {
  const documentRef = new AppFakeDocument()
  const app = createApp(apiProfileRuntime(chatId), {
    documentRef,
    storageRef: {},
    profileStore,
    apiClient,
  })
  const root = app.openBioWeave()
  app.go('settings')
  return { app, documentRef, root }
}
async function clickSettingsAction(root, dataset) {
  const click = [...root.listeners.get('click')][0]
  await click({
    target: actionTarget(root, dataset),
    preventDefault() {},
  })
}
function createMenuDocument() {
  const documentRef = new FakeDocument()
  const menu = documentRef.createElement('div')
  menu.id = 'extensionsMenu'
  documentRef.body.append(menu)
  return { documentRef, menu }
}
function createTestLifecycle(documentRef) {
  let initialized = 0
  let tornDown = 0
  const lifecycle = createOverlayLifecycle({
    documentRef,
    createOverlay: documentRefRef => documentRefRef.createElement('div'),
    createRoot: documentRefRef => documentRefRef.createElement('section'),
    initializeRoot: () => {
      initialized += 1
    },
    teardownRoot: () => {
      tornDown += 1
    },
  })
  return {
    lifecycle,
    getInitialized: () => initialized,
    getTornDown: () => tornDown,
  }
}
test('overlay lifecycle keeps one root and reopens after close', () => {
  const documentRef = new FakeDocument()
  const { lifecycle, getInitialized } = createTestLifecycle(documentRef)
  const first = lifecycle.open()
  assert.equal(first.initializedBeforeOpen, false)
  assert.equal(first.overlay.parentElement, documentRef.documentElement)
  assert.equal(documentRef.body.children.length, 0)
  assert.equal(documentRef.documentElement.children.length, 2)
  assert.equal(first.overlay.children.length, 1)
  assert.equal(first.overlay.hidden, false)
  assert.equal(first.root.dataset.open, 'true')
  assert.equal(getInitialized(), 1)
  lifecycle.close()
  assert.equal(first.overlay.hidden, true)
  const reopened = lifecycle.open()
  assert.equal(reopened.initializedBeforeOpen, true)
  assert.equal(lifecycle.getRoot(), first.root)
  assert.equal(documentRef.body.children.length, 0)
  assert.equal(getInitialized(), 1)
})
test('detached root is discarded and recreated, then destroy removes overlay', () => {
  const documentRef = new FakeDocument()
  const { lifecycle, getTornDown } = createTestLifecycle(documentRef)
  const first = lifecycle.mount()
  first.root.remove()
  assert.equal(isConnectedToDocument(first.root, documentRef), false)
  const second = lifecycle.open()
  assert.notEqual(second.root, first.root)
  assert.equal(second.overlay.parentElement, documentRef.documentElement)
  assert.equal(documentRef.body.children.length, 0)
  assert.equal(second.overlay.children.length, 1)
  assert.equal(getTornDown(), 1)
  lifecycle.destroy()
  lifecycle.destroy()
  assert.equal(documentRef.body.children.length, 0)
  assert.equal(documentRef.documentElement.children.length, 1)
  assert.equal(documentRef.getElementById('bioweave-overlay'), null)
  assert.equal(getTornDown(), 2)
})
test('worldbook parent checkbox keeps native toggle and does not toggle disclosure', async () => {
  const details = { open: false, isConnected: true }
  const target = {
    // 模拟浏览器 click 事件进入监听器时 checkbox 已经完成预激活。
    checked: true,
    indeterminate: false,
    disabled: false,
    dataset: { bioweaveAnalysisWorldbookToggle: 'st-worldbook:alpha' },
    closest(selector) {
      return selector === 'details' ? details : this
    },
  }
  let prevented = false
  let stopped = false
  const handled = handleAnalysisParentToggleClick({
    target,
    preventDefault() {
      prevented = true
    },
    stopPropagation() {
      stopped = true
    },
  })
  assert.equal(handled, true)
  assert.equal(prevented, false)
  assert.equal(stopped, true)
  assert.equal(target.checked, true)
  assert.equal(target.indeterminate, false)
  details.open = true
  await Promise.resolve()
  assert.equal(details.open, false)
})
test('render scroll helper restores main and worldbook list positions', () => {
  const nodes = new Map([
    ['.bioweave-main', { scrollTop: 123, scrollLeft: 7 }],
    ['[data-bioweave-analysis-source-list]', { scrollTop: 456, scrollLeft: 11 }],
  ])
  const root = {
    querySelector(selector) {
      return nodes.get(selector) ?? null
    },
  }
  const positions = captureScrollPositions(root)
  nodes.set('.bioweave-main', { scrollTop: 0, scrollLeft: 0 })
  nodes.set('[data-bioweave-analysis-source-list]', {
    scrollTop: 0,
    scrollLeft: 0,
  })
  restoreScrollPositions(root, positions)
  assert.deepEqual(nodes.get('.bioweave-main'), {
    scrollTop: 123,
    scrollLeft: 7,
  })
  assert.deepEqual(nodes.get('[data-bioweave-analysis-source-list]'), {
    scrollTop: 456,
    scrollLeft: 11,
  })
})
test('notify dispatches each toastr method and trims empty messages', () => {
  const calls = []
  const documentRef = {
    defaultView: {
      toastr: Object.fromEntries(['success', 'info', 'warning', 'error'].map(type => [type, message => calls.push([type, message])])),
    },
  }
  notify('  已保存。  ', 'success', documentRef)
  notify('说明。', 'info', documentRef)
  notify('注意。', 'warning', documentRef)
  notify('失败。', 'error', documentRef)
  notify('   ', 'error', documentRef)
  assert.deepEqual(calls, [
    ['success', '已保存。'],
    ['info', '说明。'],
    ['warning', '注意。'],
    ['error', '失败。'],
  ])
})
test('notify survives a throwing host toastr method and uses prefixed console fallback', () => {
  const previousToastr = globalThis.toastr
  const previousConsole = globalThis.console
  const consoleCalls = []
  let attempts = 0
  const throwingToastr = {
    error() {
      attempts += 1
      throw new Error('broken toastr')
    },
  }
  globalThis.toastr = throwingToastr
  globalThis.console = {
    error(message) {
      consoleCalls.push(message)
    },
  }
  try {
    notify('保存失败。', 'error', {
      defaultView: {
        toastr: throwingToastr,
      },
    })
    assert.equal(attempts, 1)
    assert.deepEqual(consoleCalls, ['[BioWeave] 保存失败。'])
  } finally {
    if (previousToastr === undefined) delete globalThis.toastr
    else globalThis.toastr = previousToastr
    globalThis.console = previousConsole
  }
})
test('notify falls back to the global toastr and then typed console methods', () => {
  const previousToastr = globalThis.toastr
  const previousConsole = globalThis.console
  const toastrCalls = []
  const consoleCalls = []
  globalThis.toastr = {
    warning(message) {
      toastrCalls.push(['warning', message])
    },
  }
  globalThis.console = {
    error(message) {
      consoleCalls.push(['error', message])
    },
    warn(message) {
      consoleCalls.push(['warn', message])
    },
    log(message) {
      consoleCalls.push(['log', message])
    },
  }
  try {
    notify('来源刷新完成。', 'warning', { defaultView: { toastr: {} } })
    notify('保存失败。', 'error', { defaultView: {} })
    notify('说明。', 'info', { defaultView: {} })
    assert.deepEqual(toastrCalls, [['warning', '来源刷新完成。']])
    assert.deepEqual(consoleCalls, [
      ['error', '[BioWeave] 保存失败。'],
      ['log', '[BioWeave] 说明。'],
    ])
  } finally {
    if (previousToastr === undefined) delete globalThis.toastr
    else globalThis.toastr = previousToastr
    globalThis.console = previousConsole
  }
})
test('settings API source and default profile keep fallback values without host setters', async () => {
  const documentRef = new AppFakeDocument()
  const toastCalls = []
  documentRef.defaultView.toastr = {
    success(message) {
      toastCalls.push(message)
    },
  }
  const profileStore = {
    getSettings: () => ({
      api_source: 'sillytavern',
      default_profile_id: null,
      api_profiles: {},
      assignments: {},
    }),
    getApiRequestSettings: () => ({}),
    getWorldAnalysisPrompt: () => ({}),
    getRecentStoryGlobal: () => ({ regex_rules: [] }),
  }
  const runtime = {
    chat: {
      current: () => 'chat-1',
      token: () => ({ chatId: 'chat-1', epoch: 0 }),
      assert: () => {},
    },
    store: {
      getChat: () => ({ settings: {} }),
      saveChat: async () => {},
    },
    st: {
      getContext: () => ({ chatId: 'chat-1', characters: [] }),
      fetch: async () => ({ ok: true, json: async () => ({}) }),
      getRequestHeaders: () => ({}),
    },
    subscribe: () => () => {},
  }
  const app = createApp(runtime, { documentRef, storageRef: {}, profileStore })
  const root = app.mountBioWeave()
  app.go('settings')
  const change = [...root.listeners.get('change')][0]
  const dispatchChange = async (value, selector) => {
    const target = {
      __root: root,
      value,
      dataset: {},
      closest(candidate) {
        return candidate === selector ? this : null
      },
    }
    await change({ target })
  }
  await dispatchChange('bioweave', '[data-bioweave-api-source]')
  await dispatchChange('profile-1', '[data-bioweave-default-profile]')
  assert.equal(app.getSettingsState().apiSource, 'bioweave')
  assert.equal(app.getSettingsState().defaultProfileId, 'profile-1')
  assert.deepEqual(toastCalls, ['默认 API 来源已保存。', '默认 API 配置已保存。'])
  app.destroyBioWeave()
})
test('settings restores each profile model cache after recreation and switches caches by profile', async () => {
  let globalSettings = {
    api_source: 'bioweave',
    api_profiles: {
      'profile-a': {
        profile_id: 'profile-a',
        name: '配置一',
        api_url: 'https://api.example/v1',
        model: 'model-a',
      },
      'profile-b': {
        profile_id: 'profile-b',
        name: '配置二',
        api_url: 'https://api.example/v1',
        model: 'model-b',
      },
    },
    api_model_caches: {
      'profile-a': { models: ['a-model-1', 'a-model-2'], refreshed_at: 101 },
      'profile-b': { models: ['b-model-1'], refreshed_at: 202 },
    },
  }
  const profileStore = createApiProfileStore({
    getGlobalSettings: () => globalSettings,
    saveGlobalSettings: async value => {
      globalSettings = structuredClone(value)
    },
  })
  const apiClient = { fetchModels: async () => [] }
  const createSettingsApp = () => {
    const documentRef = new AppFakeDocument()
    const app = createApp(apiProfileRuntime(), {
      documentRef,
      storageRef: {},
      profileStore,
      apiClient,
    })
    const root = app.openBioWeave()
    app.go('settings')
    return { app, root }
  }

  const first = createSettingsApp()
  const click = [...first.root.listeners.get('click')][0]
  await click({
    target: actionTarget(first.root, {
      bioweaveAction: 'edit-profile',
      profileId: 'profile-a',
    }),
    preventDefault() {},
  })
  assert.deepEqual(first.app.getSettingsState().modelList, ['a-model-1', 'a-model-2'])
  assert.equal(first.app.getSettingsState().modelListProfileKey, 'profile-a')
  await click({
    target: actionTarget(first.root, {
      bioweaveAction: 'edit-profile',
      profileId: 'profile-b',
    }),
    preventDefault() {},
  })
  assert.deepEqual(first.app.getSettingsState().modelList, ['b-model-1'])
  assert.equal(first.app.getSettingsState().modelListProfileKey, 'profile-b')
  first.app.destroyBioWeave()

  const reopened = createSettingsApp()
  const reopenedClick = [...reopened.root.listeners.get('click')][0]
  await reopenedClick({
    target: actionTarget(reopened.root, {
      bioweaveAction: 'edit-profile',
      profileId: 'profile-a',
    }),
    preventDefault() {},
  })
  assert.deepEqual(reopened.app.getSettingsState().modelList, ['a-model-1', 'a-model-2'])
  assert.equal(reopened.app.getSettingsState().modelListProfileKey, 'profile-a')
  reopened.app.destroyBioWeave()
})
test('task assignment events stay isolated from closed and active profile editors', async () => {
  let globalSettings = {
    api_source: 'bioweave',
    default_profile_id: 'profile-a',
    api_profiles: {
      'profile-a': {
        profile_id: 'profile-a',
        name: '配置一',
        api_url: 'https://api.example/v1',
        model: 'model-a',
      },
      'profile-b': {
        profile_id: 'profile-b',
        name: '配置二',
        api_url: 'https://api.example/v1',
        model: 'model-b',
      },
      'profile-c': {
        profile_id: 'profile-c',
        name: '配置三',
        api_url: 'https://api.example/v1',
        model: 'model-c',
      },
    },
    assignments: {
      world_analysis: 'profile-b',
      event_analysis: 'profile-b',
      projection: 'sillytavern',
      history_scan: 'default',
    },
    api_model_caches: {
      'profile-a': { profile_id: 'profile-a', models: ['a-model'], refreshed_at: 101 },
      'profile-b': { profile_id: 'profile-b', models: ['b-model'], refreshed_at: 202 },
      'profile-c': { profile_id: 'profile-c', models: ['c-model'], refreshed_at: 303 },
    },
  }
  const profileStore = createApiProfileStore({
    getGlobalSettings: () => globalSettings,
    saveGlobalSettings: async value => {
      globalSettings = structuredClone(value)
    },
  })
  const { app, root } = createSettingsTestApp(profileStore)
  const click = [...root.listeners.get('click')][0]
  const input = [...root.listeners.get('input')][0]
  const change = [...root.listeners.get('change')][0]
  const cacheBefore = structuredClone(globalSettings.api_model_caches)
  const closedStateBefore = app.getSettingsState()
  const assignmentValues = ['profile-c', 'profile-a', 'default', 'sillytavern', '']
  let profileLookupCount = 0
  const originalGetProfile = profileStore.getProfile
  profileStore.getProfile = (...args) => {
    profileLookupCount += 1
    return originalGetProfile(...args)
  }

  assert.equal(closedStateBefore.editingProfile, undefined)
  for (const value of assignmentValues) {
    const target = assignmentTarget(root, value, {
      action: 'edit-profile',
      profileId: 'profile-a',
    })
    await input({ target })
    await click({ target, preventDefault() {} })
    await change({ target })
    const state = app.getSettingsState()
    assert.equal(state.editingProfile, undefined)
    assert.equal(state.editingDraft, undefined)
    assert.deepEqual(state.modelList, [])
    assert.deepEqual(state.modelListCaches, closedStateBefore.modelListCaches)
    assert.deepEqual(globalSettings.api_model_caches, cacheBefore)
    assert.equal(state.assignments.world_analysis, value || null)
    assert.equal(state.assignments.event_analysis, 'profile-b')
  }
  assert.equal(profileLookupCount, 0)

  await click({
    target: actionTarget(root, {
      bioweaveAction: 'edit-profile',
      profileId: 'profile-a',
    }),
    preventDefault() {},
  })
  profileLookupCount = 0
  const profileForm = attachSettingsForm(
    root,
    createSettingsForm({
      profile_id: 'profile-a',
      name: '配置一草稿',
      api_url: 'https://api.example/v2',
      model: 'draft-model-a',
    }),
  )
  await input({ target: settingsFormTarget(root, profileForm) })
  const profileDraftBefore = app.getSettingsState().editingDraft
  const profileCacheStateBefore = app.getSettingsState().modelListCaches
  profileForm.fields.name.value = '不应被 assignment capture 覆盖'
  for (const value of assignmentValues) {
    const target = assignmentTarget(root, value, {
      form: profileForm,
      action: 'edit-profile',
      profileId: 'profile-b',
    })
    await input({ target })
    await click({ target, preventDefault() {} })
    await change({ target })
    const state = app.getSettingsState()
    assert.equal(state.editingProfile.profile_id, 'profile-a')
    assert.deepEqual(state.editingDraft, profileDraftBefore)
    assert.deepEqual(state.modelList, ['a-model'])
    assert.deepEqual(state.modelListCaches, profileCacheStateBefore)
    assert.deepEqual(globalSettings.api_model_caches, cacheBefore)
    assert.equal(state.assignments.world_analysis, value || null)
    assert.equal(state.assignments.event_analysis, 'profile-b')
  }
  assert.equal(profileLookupCount, 0)

  await click({
    target: actionTarget(root, { bioweaveAction: 'new-profile' }),
    preventDefault() {},
  })
  const newProfileForm = attachSettingsForm(
    root,
    createSettingsForm({
      name: '新配置草稿',
      api_url: 'https://api.example/v3',
      model: 'draft-model-new',
    }),
  )
  await input({ target: settingsFormTarget(root, newProfileForm) })
  const newProfileDraftBefore = app.getSettingsState().editingDraft
  newProfileForm.fields.name.value = '不应被 new assignment capture 覆盖'
  for (const value of assignmentValues) {
    const target = assignmentTarget(root, value, {
      form: newProfileForm,
      action: 'edit-profile',
      profileId: 'profile-a',
    })
    await input({ target })
    await click({ target, preventDefault() {} })
    await change({ target })
    const state = app.getSettingsState()
    assert.equal(state.editingProfile, null)
    assert.deepEqual(state.editingDraft, newProfileDraftBefore)
    assert.deepEqual(state.modelList, [])
    assert.deepEqual(state.modelListCaches, profileCacheStateBefore)
    assert.deepEqual(globalSettings.api_model_caches, cacheBefore)
    assert.equal(state.assignments.world_analysis, value || null)
    assert.equal(state.assignments.event_analysis, 'profile-b')
  }
  const profileFormAfterAssignment = app.getSettingsState().editingDraft
  const sourceTarget = settingsSourceTarget(root, 'sillytavern')
  await input({ target: sourceTarget })
  await click({ target: sourceTarget, preventDefault() {} })
  await change({ target: sourceTarget })
  assert.equal(app.getSettingsState().editingProfile, null)
  assert.deepEqual(app.getSettingsState().editingDraft, profileFormAfterAssignment)
  assert.equal(profileLookupCount, 0)
  const defaultProfileTarget = settingsDefaultProfileTarget(root, 'profile-c')
  await input({ target: defaultProfileTarget })
  await click({ target: defaultProfileTarget, preventDefault() {} })
  await change({ target: defaultProfileTarget })
  assert.equal(app.getSettingsState().editingProfile, null)
  assert.deepEqual(app.getSettingsState().editingDraft, profileFormAfterAssignment)
  assert.equal(app.getSettingsState().defaultProfileId, 'profile-c')
  assert.deepEqual(app.getSettingsState().modelListCaches, profileCacheStateBefore)
  assert.deepEqual(globalSettings.api_model_caches, cacheBefore)
  assert.equal(profileLookupCount, 0)
  app.destroyBioWeave()
})
test('successful model refresh replaces the cache and a failed refresh preserves it', async () => {
  let globalSettings = {
    api_source: 'bioweave',
    api_profiles: {
      'profile-a': {
        profile_id: 'profile-a',
        name: '配置一',
        api_url: 'https://api.example/v1',
        model: 'model-a',
      },
    },
  }
  const profileStore = createApiProfileStore({
    getGlobalSettings: () => globalSettings,
    saveGlobalSettings: async value => {
      globalSettings = structuredClone(value)
    },
  })
  const responses = [[{ id: 'model-z' }, { id: 'model-a' }, { id: 'model-a' }], new Error('API_MODELS_FETCH_FAILED')]
  const apiClient = {
    async fetchModels() {
      const response = responses.shift()
      if (response instanceof Error) throw response
      return response
    },
  }
  const documentRef = new AppFakeDocument()
  const errors = []
  documentRef.defaultView.toastr = { error: message => errors.push(message) }
  const app = createApp(apiProfileRuntime(), {
    documentRef,
    storageRef: {},
    profileStore,
    apiClient,
  })
  const root = app.openBioWeave()
  app.go('settings')
  const click = [...root.listeners.get('click')][0]
  await click({
    target: actionTarget(root, {
      bioweaveAction: 'edit-profile',
      profileId: 'profile-a',
    }),
    preventDefault() {},
  })
  attachSettingsForm(
    root,
    createSettingsForm({
      profile_id: 'profile-a',
      name: '配置一',
      model: 'model-a',
    }),
  )

  await click({
    target: actionTarget(root, { bioweaveAction: 'refresh-models' }),
    preventDefault() {},
  })
  assert.deepEqual(app.getSettingsState().modelList, ['model-a', 'model-z'])
  assert.deepEqual(profileStore.getModelListCache('profile-a')?.models, ['model-a', 'model-z'])
  const firstCache = structuredClone(globalSettings.api_model_caches['profile-a'])

  await click({
    target: actionTarget(root, { bioweaveAction: 'refresh-models' }),
    preventDefault() {},
  })
  assert.deepEqual(app.getSettingsState().modelList, ['model-a', 'model-z'])
  assert.deepEqual(globalSettings.api_model_caches['profile-a'], firstCache)
  assert.deepEqual(errors, ['模型列表请求失败，请检查地址和权限。'])
  app.destroyBioWeave()
})
test('unsaved model discovery stays in memory and migrates only after a profile gets a stable id', async () => {
  let globalSettings = {}
  const profileStore = createApiProfileStore({
    getGlobalSettings: () => globalSettings,
    saveGlobalSettings: async value => {
      globalSettings = structuredClone(value)
    },
  })
  const apiClient = { fetchModels: async () => [{ id: 'temporary-model' }] }
  const documentRef = new AppFakeDocument()
  const app = createApp(apiProfileRuntime('chat-unsaved-model'), {
    documentRef,
    storageRef: {},
    profileStore,
    apiClient,
  })
  const root = app.openBioWeave()
  app.go('settings')
  const click = [...root.listeners.get('click')][0]
  await click({
    target: actionTarget(root, { bioweaveAction: 'new-profile' }),
    preventDefault() {},
  })
  const form = createSettingsForm({ name: '待保存配置', model: '' })
  attachSettingsForm(root, form)

  await click({
    target: actionTarget(root, { bioweaveAction: 'refresh-models' }),
    preventDefault() {},
  })
  assert.deepEqual(app.getSettingsState().modelList, ['temporary-model'])
  assert.equal(app.getSettingsState().modelListProfileKey, '__new__')
  assert.equal(globalSettings.api_model_caches, undefined)

  form.fields.model.value = 'temporary-model'
  await click({
    target: actionTarget(root, { bioweaveAction: 'save-profile' }),
    preventDefault() {},
  })
  const savedState = app.getSettingsState()
  const savedId = Object.keys(savedState.profiles).find(profileId => savedState.profiles[profileId].name === '待保存配置')
  assert.notEqual(savedId, '__new__')
  assert.equal(savedState.editingProfile, undefined)
  assert.equal(savedState.editingDraft, undefined)
  assert.equal(globalSettings.api_model_caches.__new__, undefined)
  assert.equal(globalSettings.api_model_caches.new, undefined)
  assert.deepEqual(profileStore.getModelListCache(savedId)?.models, ['temporary-model'])
  app.destroyBioWeave()
})
test('saving a new profile closes the editor and updates the profile list immediately', async () => {
  let globalSettings = {
    api_source: 'bioweave',
    default_profile_id: null,
    api_profiles: {},
  }
  const profileStore = createApiProfileStore({
    getGlobalSettings: () => globalSettings,
    saveGlobalSettings: async value => {
      globalSettings = structuredClone(value)
    },
  })
  const { app, root } = createSettingsTestApp(profileStore)
  await clickSettingsAction(root, { bioweaveAction: 'new-profile' })
  attachSettingsForm(
    root,
    createSettingsForm({
      name: '新建配置',
      api_url: 'https://api.example/v1',
      model: 'new-model',
    }),
  )

  await clickSettingsAction(root, { bioweaveAction: 'save-profile' })

  const state = app.getSettingsState()
  assert.equal(state.editingProfile, undefined)
  assert.equal(state.editingDraft, undefined)
  assert.equal(state.apiSource, 'bioweave')
  assert.equal(state.defaultProfileId, null)
  assert.equal(Object.values(state.profiles).length, 1)
  assert.equal(Object.values(state.profiles)[0].name, '新建配置')
  assert.doesNotMatch(root.querySelector('.bioweave-main').innerHTML, /bioweave-settings-editor/)
  assert.match(root.querySelector('.bioweave-main').innerHTML, /新建配置/)
  app.destroyBioWeave()
})
test('saving an existing profile closes the editor, preserves default state, and reopens saved data', async () => {
  let globalSettings = {
    api_source: 'bioweave',
    default_profile_id: 'profile-a',
    api_profiles: {
      'profile-a': {
        profile_id: 'profile-a',
        name: '原配置',
        api_url: 'https://api.example/v1',
        model: 'old-model',
      },
    },
  }
  const profileStore = createApiProfileStore({
    getGlobalSettings: () => globalSettings,
    saveGlobalSettings: async value => {
      globalSettings = structuredClone(value)
    },
  })
  const { app, root } = createSettingsTestApp(profileStore)
  await clickSettingsAction(root, {
    bioweaveAction: 'edit-profile',
    profileId: 'profile-a',
  })
  attachSettingsForm(
    root,
    createSettingsForm({
      profile_id: 'profile-a',
      name: '更新后的配置',
      api_url: 'https://api.example/v2',
      model: 'new-model',
    }),
  )

  await clickSettingsAction(root, { bioweaveAction: 'save-profile' })

  let state = app.getSettingsState()
  assert.equal(state.editingProfile, undefined)
  assert.equal(state.editingDraft, undefined)
  assert.equal(state.defaultProfileId, 'profile-a')
  assert.equal(state.profiles['profile-a'].name, '更新后的配置')
  assert.equal(state.profiles['profile-a'].model, 'new-model')
  assert.match(root.querySelector('.bioweave-main').innerHTML, /更新后的配置/)
  assert.doesNotMatch(root.querySelector('.bioweave-main').innerHTML, /bioweave-settings-editor/)

  await clickSettingsAction(root, {
    bioweaveAction: 'edit-profile',
    profileId: 'profile-a',
  })
  state = app.getSettingsState()
  assert.equal(state.editingProfile.name, '更新后的配置')
  assert.equal(state.editingProfile.api_url, 'https://api.example/v2')
  assert.equal(state.editingDraft.name, '更新后的配置')
  assert.equal(state.editingDraft.model, 'new-model')
  assert.match(root.querySelector('.bioweave-main').innerHTML, /bioweave-settings-editor/)
  app.destroyBioWeave()
})
test('profile save failure keeps the editor and current draft data', async () => {
  const profile = {
    profile_id: 'profile-failure',
    name: '原配置',
    api_url: 'https://api.example/v1',
    model: 'old-model',
  }
  const errors = []
  const profileStore = {
    getSettings: () => ({
      api_source: 'bioweave',
      default_profile_id: 'profile-failure',
      api_profiles: { 'profile-failure': profile },
      assignments: {},
    }),
    getProfile: profileId => (profileId === 'profile-failure' ? { ...profile } : null),
    getApiRequestSettings: () => ({}),
    getWorldAnalysisPrompt: () => ({}),
    getRecentStoryGlobal: () => ({ regex_rules: [] }),
    saveProfile: async () => {
      throw new Error('SAVE_FAILED')
    },
  }
  const { app, documentRef, root } = createSettingsTestApp(profileStore)
  documentRef.defaultView.toastr = { error: message => errors.push(message) }
  await clickSettingsAction(root, {
    bioweaveAction: 'edit-profile',
    profileId: 'profile-failure',
  })
  attachSettingsForm(
    root,
    createSettingsForm({
      profile_id: 'profile-failure',
      name: '未保存名称',
      api_url: 'https://api.example/v1',
      model: '未保存模型',
    }),
  )

  await clickSettingsAction(root, { bioweaveAction: 'save-profile' })

  const state = app.getSettingsState()
  assert.equal(state.editingProfile.profile_id, 'profile-failure')
  assert.equal(state.editingDraft.name, '未保存名称')
  assert.equal(state.editingDraft.model, '未保存模型')
  assert.match(root.querySelector('.bioweave-main').innerHTML, /bioweave-settings-editor/)
  assert.deepEqual(errors, ['设置操作失败，请检查 SillyTavern 状态后重试。'])
  app.destroyBioWeave()
})
test('profile validation failure keeps the editor, draft data, and validation error', async () => {
  let globalSettings = {
    api_source: 'bioweave',
    api_profiles: {
      'profile-invalid': {
        profile_id: 'profile-invalid',
        name: '原配置',
        api_url: 'https://api.example/v1',
        model: 'old-model',
      },
    },
  }
  const profileStore = createApiProfileStore({
    getGlobalSettings: () => globalSettings,
    saveGlobalSettings: async value => {
      globalSettings = structuredClone(value)
    },
  })
  const errors = []
  const { app, documentRef, root } = createSettingsTestApp(profileStore)
  documentRef.defaultView.toastr = { error: message => errors.push(message) }
  await clickSettingsAction(root, {
    bioweaveAction: 'edit-profile',
    profileId: 'profile-invalid',
  })
  attachSettingsForm(
    root,
    createSettingsForm({
      profile_id: 'profile-invalid',
      name: '校验失败草稿',
      api_url: 'https://api.example/v1',
      model: '',
    }),
  )

  await clickSettingsAction(root, { bioweaveAction: 'save-profile' })

  const state = app.getSettingsState()
  assert.equal(state.editingProfile.profile_id, 'profile-invalid')
  assert.equal(state.editingDraft.name, '校验失败草稿')
  assert.equal(state.editingDraft.model, '')
  assert.match(root.querySelector('.bioweave-main').innerHTML, /bioweave-settings-editor/)
  assert.deepEqual(errors, ['请填写有效的 API URL 和 Model。'])
  app.destroyBioWeave()
})
test('cancelling profile edit still closes the editor without saving the draft', async () => {
  let globalSettings = {
    api_source: 'bioweave',
    api_profiles: {},
  }
  const profileStore = createApiProfileStore({
    getGlobalSettings: () => globalSettings,
    saveGlobalSettings: async value => {
      globalSettings = structuredClone(value)
    },
  })
  const { app, root } = createSettingsTestApp(profileStore)
  await clickSettingsAction(root, { bioweaveAction: 'new-profile' })
  attachSettingsForm(
    root,
    createSettingsForm({
      name: '取消的草稿',
      model: 'draft-model',
    }),
  )

  await clickSettingsAction(root, { bioweaveAction: 'cancel-profile' })

  const state = app.getSettingsState()
  assert.equal(state.editingProfile, undefined)
  assert.equal(state.editingDraft, undefined)
  assert.equal(Object.keys(state.profiles).length, 0)
  assert.deepEqual(globalSettings.api_profiles, {})
  assert.doesNotMatch(root.querySelector('.bioweave-main').innerHTML, /bioweave-settings-editor/)
  app.destroyBioWeave()
})
test('new profile cache migration completes before the editor closes', async () => {
  let globalSettings = {
    api_source: 'bioweave',
    api_profiles: {},
  }
  const profileStore = createApiProfileStore({
    getGlobalSettings: () => globalSettings,
    saveGlobalSettings: async value => {
      globalSettings = structuredClone(value)
    },
  })
  const saveModelListCache = profileStore.saveModelListCache.bind(profileStore)
  let resolveMigration
  let migrationStartedResolve
  let migrationCompleted = false
  const migrationGate = new Promise(resolve => {
    resolveMigration = resolve
  })
  const migrationStarted = new Promise(resolve => {
    migrationStartedResolve = resolve
  })
  profileStore.saveModelListCache = async (...args) => {
    migrationStartedResolve()
    await migrationGate
    const saved = await saveModelListCache(...args)
    migrationCompleted = true
    return saved
  }
  const { app, root } = createSettingsTestApp(profileStore, {
    apiClient: { fetchModels: async () => [{ id: 'migrated-model' }] },
  })
  await clickSettingsAction(root, { bioweaveAction: 'new-profile' })
  const form = attachSettingsForm(
    root,
    createSettingsForm({
      name: '待迁移配置',
      api_url: 'https://api.example/v1',
    }),
  )
  await clickSettingsAction(root, { bioweaveAction: 'refresh-models' })
  form.fields.model.value = 'migrated-model'

  const savePromise = clickSettingsAction(root, {
    bioweaveAction: 'save-profile',
  })
  await migrationStarted
  assert.equal(app.getSettingsState().editingProfile, null)
  assert.equal(migrationCompleted, false)
  assert.match(root.querySelector('.bioweave-main').innerHTML, /bioweave-settings-editor/)

  resolveMigration()
  await savePromise
  const state = app.getSettingsState()
  const savedId = Object.keys(state.profiles)[0]
  assert.equal(migrationCompleted, true)
  assert.equal(state.editingProfile, undefined)
  assert.equal(state.editingDraft, undefined)
  assert.deepEqual(profileStore.getModelListCache(savedId)?.models, ['migrated-model'])
  assert.doesNotMatch(root.querySelector('.bioweave-main').innerHTML, /bioweave-settings-editor/)
  app.destroyBioWeave()
})
test('cache migration failure keeps the saved profile editor open without a false cache', async () => {
  let globalSettings = {
    api_source: 'bioweave',
    api_profiles: {},
  }
  const profileStore = createApiProfileStore({
    getGlobalSettings: () => globalSettings,
    saveGlobalSettings: async value => {
      globalSettings = structuredClone(value)
    },
  })
  profileStore.saveModelListCache = async () => {
    throw new Error('CACHE_MIGRATION_FAILED')
  }
  const { app, documentRef, root } = createSettingsTestApp(profileStore, {
    apiClient: { fetchModels: async () => [{ id: 'migration-model' }] },
  })
  const warnings = []
  documentRef.defaultView.toastr = {
    warning: message => warnings.push(message),
  }
  await clickSettingsAction(root, { bioweaveAction: 'new-profile' })
  const form = attachSettingsForm(
    root,
    createSettingsForm({
      name: '迁移失败配置',
      api_url: 'https://api.example/v1',
    }),
  )
  await clickSettingsAction(root, { bioweaveAction: 'refresh-models' })
  form.fields.model.value = 'migration-model'

  await clickSettingsAction(root, { bioweaveAction: 'save-profile' })

  const state = app.getSettingsState()
  const savedId = Object.keys(state.profiles)[0]
  assert.ok(savedId)
  assert.equal(state.editingProfile.profile_id, savedId)
  assert.equal(state.editingDraft.profile_id, savedId)
  assert.deepEqual(state.modelList, ['migration-model'])
  assert.match(root.querySelector('.bioweave-main').innerHTML, /bioweave-settings-editor/)
  assert.deepEqual(globalSettings.api_model_caches, {})
  assert.deepEqual(warnings, ['设置操作失败，请检查 SillyTavern 状态后重试。'])
  app.destroyBioWeave()
})
test.skip('removed analysis debug Popup exposed a safe persistence trace copy entry', () => {
  const markup = renderAnalysisDebugPopupContent({
    persistenceTrace: {
      execution: {chat_id: 'chat-trace', message_id: 'message-1', swipe_id: 0, attempt: 1, trigger: 'auto-full'},
      host_post_save_hook: 'NO_PUBLIC_POST_SAVE_HOOK',
      sequence: [{seq: 1, stage: 'WORLD_SAVE_PATH_SELECTED', path: 'official'}],
    },
  })
  const html = typeof markup === 'string' ? markup : markup.innerHTML
  assert.match(html, /复制最近一次运行诊断/)
  assert.match(html, /NO_PUBLIC_POST_SAVE_HOOK/)
  assert.doesNotMatch(html, /should-not-enter|api_key|authorization/i)
  assert.match(STYLE_SOURCE, /bioweave-persistence-trace[\s\S]*text-align:\s*left\s*!important/)
})

test.skip('removed analysis debug Popup rendered production business state sources and derived Tracking Windows', () => {
  const markup = renderAnalysisDebugPopupContent({
    businessDebug: {
      status: 'current',
      data: {
        sampled_at: '2026-10-10T00:00:00.000Z',
        target: {
          chat_id: 'chat-debug',
          floor: 35,
          swipe_id: 0,
          floor_version: {
            chat_id: 'chat-debug', message_id: 'message-35', floor: 35,
            swipe_id: 0, content_hash: 'hash-35', message_version: 'v1',
          },
          source_type: 'CURRENT_DERIVED',
        },
        event_state: {
          source_type: 'CURRENT_RESOLVED',
          source: {source_type: 'CURRENT_RESOLVED', floor: 26, swipe_id: 0},
          count: 1,
          events: [{
            event_id: 'event-a', event_type: 'sexual_activity', subject_ids: ['char-a'],
            participant_ids: ['char-a', 'char-b'], story_time: {day_index: 1},
            source: {source_type: 'HISTORICAL_PERSISTED', floor: 20, swipe_id: 0},
          }],
        },
        world_model: {
          source_type: 'CURRENT_RESOLVED',
          source: {source_type: 'CURRENT_RESOLVED', floor: 28, swipe_id: 0},
          model: {schema_version: 1, species: []},
        },
        character_registry: {
          source_type: 'CURRENT_RESOLVED',
          source: {source_type: 'CURRENT_RESOLVED', floor: 26, swipe_id: 0},
          count: 1,
          registry: {schema_version: 1, entities: {'char-a': {display_name: 'Alice'}}},
        },
        tracking_window: {
          source_type: 'CURRENT_DERIVED', current_story_time: {day_index: 2}, count: 1,
          status_counts: {open: 1, expired: 0, terminated: 0, resolved_pregnant: 0},
          horizons: {'window-a': 7},
          windows: [{
            tracking_window_id: 'window-a', cycle_id: 'cycle-a', subject_id: 'char-a',
            mechanism_key: 'fertilization', source_event_ids: ['event-a'], source_basis_refs: [],
            opened_story_time: {day_index: 1}, opened_at_floor_version: {floor: 20}, status: 'open',
            terminal_event_id: null, terminal_reason: null, terminal_story_time: null,
            terminal_at_floor_version: null,
          }],
        },
        tracking_registry: {source_type: 'CURRENT_DERIVED', tracking_subjects: {'char-a': {}}, tracking_candidates: {}, character_profiles: {}},
        health_state: {source_type: 'CURRENT_DERIVED', state: {schema_version: 1, characters: {}}},
      },
    },
  })
  const html = typeof markup === 'string' ? markup : markup.innerHTML
  assert.match(html, /当前生产业务状态/)
  assert.match(html, /CURRENT_DERIVED/)
  assert.match(html, /CURRENT_RESOLVED/)
  assert.match(html, /HISTORICAL_PERSISTED/)
  assert.match(html, /目标 Floor Version/)
  assert.match(html, /window-a/)
  assert.match(html, /horizon/)
  assert.match(html, /Health Evolution/)
  assert.doesNotMatch(html, /getTrackingWindowTimeline/)
})

test.skip('removed analysis debug Popup used the SillyTavern DISPLAY Popup and kept preview actions local', async () => {
  const documentRef = new AppFakeDocument()
  const popupCalls = []
  let resolvePopup
  class Popup {
    constructor(content, type, title, options) {
      popupCalls.push({ content, type, title, options })
    }
    show() {
      return new Promise(resolve => {
        resolvePopup = resolve
      })
    }
  }
  const profileStore = {
    getSettings: () => ({
      api_source: 'sillytavern',
      default_profile_id: null,
      api_profiles: {},
      assignments: {},
    }),
    getApiRequestSettings: () => ({}),
    getWorldAnalysisPrompt: () => ({}),
    getRecentStoryGlobal: () => ({ regex_rules: [] }),
  }
  const runtime = {
    chat: {
      current: () => 'chat-debug',
      token: () => ({ chatId: 'chat-debug', epoch: 0 }),
      assert: () => {},
    },
    store: {
      getChat: () => ({ settings: {} }),
      saveChat: async () => {},
    },
    getPersistenceTrace: () => ({
      execution: {chat_id: 'chat-debug', message_id: 'message-1', swipe_id: 0},
      sequence: [{seq: 1, stage: 'WORLD_PERSISTENCE_CONFIRMED'}],
    }),
    st: {
      getContext: () => ({
        chatId: 'chat-debug',
        characters: [],
        Popup,
        POPUP_TYPE: { DISPLAY: 'display' },
        POPUP_RESULT: { AFFIRMATIVE: 'yes', NEGATIVE: 'no' },
      }),
      fetch: async () => ({ ok: true, json: async () => [] }),
      getRequestHeaders: () => ({}),
    },
    subscribe: () => () => {},
  }
  const app = createApp(runtime, { documentRef, storageRef: {}, profileStore })
  const root = app.openBioWeave()
  app.go('settings')
  await new Promise(resolve => setTimeout(resolve, 0))
  const click = [...root.listeners.get('click')][0]
  const actionTarget = action => ({
    __root: root,
    dataset: { bioweaveAction: action },
    closest(selector) {
      return selector.includes('[data-bioweave-action]') ? this : null
    },
  })
  const clickAction = async action => {
    await click({
      target: actionTarget(action),
      preventDefault() {},
      stopPropagation() {},
    })
  }
  const directCopied = []
  documentRef.defaultView.navigator = {clipboard: {writeText: async text => directCopied.push(text)}}
  await clickAction('copy-persistence-trace')
  assert.equal(directCopied.length, 1)
  const openPromise = clickAction('open-analysis-debug')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(popupCalls.length, 1)
  assert.equal(popupCalls[0].type, 'display')
  assert.equal(popupCalls[0].title, '')
  assert.deepEqual(popupCalls[0].options, {
    wide: true,
    allowVerticalScrolling: true,
  })
  assert.equal(popupCalls[0].content.ownerDocument, documentRef)
  assert.match(popupCalls[0].content.innerHTML, /data-bioweave-analysis-preview/)
  const popupContent = popupCalls[0].content
  const popupClick = [...popupContent.listeners.get('click')][0]
  const popupActionTarget = (action, mode = undefined) => ({
    __root: popupContent,
    dataset: {
      bioweaveAction: action,
      ...(mode ? { bioweavePreviewMode: mode } : {}),
    },
    closest(selector) {
      return selector.includes('[data-bioweave-action]') ? this : null
    },
  })
  await popupClick({
    target: popupActionTarget('refresh-analysis-preview'),
    preventDefault() {},
  })
  assert.match(popupContent.innerHTML, /data-bioweave-analysis-preview/)
  assert.match(popupContent.innerHTML, /data-bioweave-world-model-message-preview/)
  await popupClick({
    target: popupActionTarget('analysis-preview-mode', 'raw'),
    preventDefault() {},
  })
  assert.match(popupContent.innerHTML, /bioweave-analysis-preview-raw/)
  assert.equal(popupContent.listeners.get('click').size, 1)
  const copied = []
  documentRef.defaultView.navigator = {clipboard: {writeText: async text => copied.push(text)}}
  const clonedCopyTarget = {
    dataset: {bioweaveAction: 'copy-persistence-trace'},
    closest(selector) {
      return selector.includes('data-bioweave-action') || selector.includes('copy-persistence-trace') ? this : null
    },
  }
  const documentClick = [...documentRef.listeners.get('click')][0]
  await documentClick({target: clonedCopyTarget, preventDefault() {}})
  assert.equal(copied.length, 1)
  documentRef.defaultView.navigator = {clipboard: {writeText: async () => { throw new Error('CLIPBOARD_PERMISSION_DENIED') }}}
  documentRef.execCommand = command => command === 'copy'
  await documentClick({target: clonedCopyTarget, preventDefault() {}})
  resolvePopup()
  await openPromise
  assert.equal(root.dataset.open, 'true')
  const secondOpenPromise = clickAction('open-analysis-debug')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(popupCalls.length, 2)
  assert.equal(popupCalls[1].content.listeners.get('click').size, 1)
  resolvePopup()
  await secondOpenPromise
  const keydown = [...root.listeners.get('keydown')][0]
  keydown({ key: 'Escape', preventDefault() {} })
  assert.equal(root.dataset.open, 'false')
  app.destroyBioWeave()
})
test.skip('removed settings analysis debug Popup kept one Popup and the persisted prompt source boundary', async () => {
  const documentRef = new AppFakeDocument()
  const popupCalls = []
  let resolvePopup
  class Popup {
    constructor(content, type, title, options) {
      popupCalls.push({ content, type, title, options })
    }
    show() {
      return new Promise(resolve => {
        resolvePopup = resolve
      })
    }
  }
  const savedPrompt = {
    system_top: 'SAVED TOP',
    task: 'SAVED TASK',
    input_prefix: '',
    input_suffix: '',
    system_bottom: 'SAVED BOTTOM',
  }
  const profileStore = {
    getSettings: () => ({
      api_source: 'sillytavern',
      default_profile_id: null,
      api_profiles: {},
      assignments: {},
      world_analysis_prompt: savedPrompt,
    }),
    getApiRequestSettings: () => ({}),
    getWorldAnalysisPrompt: () => savedPrompt,
    getRecentStoryGlobal: () => ({ regex_rules: [] }),
  }
  const runtime = {
    chat: {
      current: () => 'chat-debug-shared',
      token: () => ({ chatId: 'chat-debug-shared', epoch: 0 }),
      assert: () => {},
    },
    store: {
      getChat: () => ({ settings: {} }),
      saveChat: async () => {},
    },
    st: {
      getContext: () => ({
        chatId: 'chat-debug-shared',
        characters: [],
        Popup,
        POPUP_TYPE: { DISPLAY: 'display' },
      }),
      fetch: async () => ({ ok: true, json: async () => [] }),
      getRequestHeaders: () => ({}),
    },
    subscribe: () => () => {},
  }
  const app = createApp(runtime, { documentRef, storageRef: {}, profileStore })
  const root = app.openBioWeave()
  app.go('settings')
  await new Promise(resolve => setTimeout(resolve, 0))
  const promptForm = {}
  root.selectorNodes.set('[data-bioweave-world-analysis-prompt-settings]', [promptForm])
  for (const [key, value] of Object.entries({
    system_top: 'DRAFT TOP',
    task: 'DRAFT TASK',
    input_prefix: '',
    input_suffix: '',
    system_bottom: 'DRAFT BOTTOM',
  })) {
    root.selectorNodes.set(`[data-bioweave-world-analysis-prompt-field="${key}"]`, [{ value }])
  }
  const click = [...root.listeners.get('click')][0]
  const actionTarget = action => ({
    __root: root,
    dataset: { bioweaveAction: action },
    closest(selector) {
      return selector.includes('[data-bioweave-action]') ? this : null
    },
  })
  const clickAction = async action => {
    await click({
      target: actionTarget(action),
      preventDefault() {},
      stopPropagation() {},
    })
  }
  const settingsOpen = clickAction('open-analysis-debug')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(popupCalls.length, 1)
  const settingsPopup = popupCalls[0]
  assert.equal(settingsPopup.type, 'display')
  assert.equal(settingsPopup.title, '')
  assert.deepEqual(settingsPopup.options, {
    wide: true,
    allowVerticalScrolling: true,
  })
  const popupActionTarget = (content, action, mode = undefined) => ({
    __root: content,
    dataset: {
      bioweaveAction: action,
      ...(mode ? { bioweavePreviewMode: mode } : {}),
    },
    closest(selector) {
      return selector.includes('[data-bioweave-action]') ? this : null
    },
  })
  const settingsPopupClick = [...settingsPopup.content.listeners.get('click')][0]
  await settingsPopupClick({
    target: popupActionTarget(settingsPopup.content, 'refresh-analysis-preview'),
    preventDefault() {},
  })
  assert.match(settingsPopup.content.innerHTML, /SAVED TOP/)
  assert.match(settingsPopup.content.innerHTML, /SAVED BOTTOM/)
  assert.doesNotMatch(settingsPopup.content.innerHTML, /DRAFT TOP|DRAFT BOTTOM/)
  assert.match(settingsPopup.content.innerHTML, /data-bioweave-world-model-message-preview/)
  resolvePopup()
  await settingsOpen
  app.destroyBioWeave()
})
test.skip('removed analysis debug Popup showed a safe Toast and no custom modal when Popup was unavailable', async () => {
  const documentRef = new AppFakeDocument()
  const toastCalls = []
  documentRef.defaultView.toastr = {
    error: message => toastCalls.push(message),
  }
  const profileStore = {
    getSettings: () => ({
      api_source: 'sillytavern',
      default_profile_id: null,
      api_profiles: {},
      assignments: {},
    }),
    getApiRequestSettings: () => ({}),
    getWorldAnalysisPrompt: () => ({}),
    getRecentStoryGlobal: () => ({ regex_rules: [] }),
  }
  const runtime = {
    chat: {
      current: () => 'chat-no-popup',
      token: () => ({ chatId: 'chat-no-popup' }),
      assert: () => {},
    },
    store: { getChat: () => ({ settings: {} }), saveChat: async () => {} },
    st: {
      getContext: () => ({ chatId: 'chat-no-popup' }),
      fetch: async () => ({ ok: true, json: async () => [] }),
      getRequestHeaders: () => ({}),
    },
    subscribe: () => () => {},
  }
  const app = createApp(runtime, { documentRef, storageRef: {}, profileStore })
  const root = app.openBioWeave()
  app.go('settings')
  const click = [...root.listeners.get('click')][0]
  await click({
    target: {
      __root: root,
      dataset: { bioweaveAction: 'open-analysis-debug' },
      closest(selector) {
        return selector.includes('[data-bioweave-action]') ? this : null
      },
    },
    preventDefault() {},
  })
  assert.deepEqual(toastCalls, ['高级 / 调试窗口暂不可用，请确认 SillyTavern Popup 已加载。'])
  assert.doesNotMatch(root.querySelector('.bioweave-main').innerHTML, /bioweave-analysis-debug-overlay/)
  app.destroyBioWeave()
})

test('inline debug refresh actions restore business DTO and analysis preview after Popup removal', async () => {
  const documentRef = new AppFakeDocument()
  let businessReads = 0
  let analysisReads = 0
  const runtime = {
    ...apiProfileRuntime('chat-inline-debug'),
    collectActiveBusinessData: async () => {
      businessReads += 1
      return {debug: {
        sampled_at: '2026-10-11T00:00:00.000Z',
        target: {chat_id: 'chat-inline-debug', floor: 12, swipe_id: 0, floor_version: {chat_id: 'chat-inline-debug', message_id: 'm-12', floor: 12, swipe_id: 0, content_hash: 'hash-12', message_version: 'v1'}},
        event_state: {count: 0, events: []},
        world_model: {model: {species: []}},
        character_registry: {count: 0, registry: {}},
        tracking_window: {count: 0, windows: []},
        tracking_registry: {tracking_subjects: {}},
        health_state: {state: {}},
      }}
    },
    resolveCurrentBioWeaveFloor: async () => ({version: {chat_id: 'chat-inline-debug', message_id: 'm-12', floor: 12, swipe_id: 0, content_hash: 'hash-12', message_version: 'v1'}}),
    getCurrentFloorAnalysisInput: async () => {
      analysisReads += 1
      return {messages: [{role: 'user', content: 'analysis-input'}], token_estimate: 3}
    },
  }
  const app = createApp(runtime, {documentRef, storageRef: {}, profileStore: {getSettings: () => ({})}})
  const root = app.openBioWeave()
  app.go('settings')
  let html = root.querySelector('.bioweave-main').innerHTML
  assert.match(html, /当前生产业务状态/)
  assert.match(html, /data-bioweave-action="refresh-business-debug"/)
  const businessReadsBeforeDebugRefresh = businessReads
  await clickSettingsAction(root, {bioweaveAction: 'refresh-business-debug'})
  html = root.querySelector('.bioweave-main').innerHTML
  assert.ok(businessReads > businessReadsBeforeDebugRefresh)
  assert.match(html, /data-bioweave-business-debug-current/)
  await clickSettingsAction(root, {bioweaveAction: 'refresh-analysis-preview'})
  html = root.querySelector('.bioweave-main').innerHTML
  assert.equal(analysisReads, 1)
  assert.match(html, /data-bioweave-analysis-preview/)
  assert.doesNotMatch(html, /分析输入预览读取失败/)
  await clickSettingsAction(root, {bioweaveAction: 'analysis-preview-mode', bioweavePreviewMode: 'raw'})
  html = root.querySelector('.bioweave-main').innerHTML
  assert.match(html, /bioweave-analysis-preview-raw/)
  app.destroyBioWeave()
})

test('all settings debug previews use the shared 240px internal scroll container', () => {
  const html = settingsPage({})
  const businessContent = html.indexOf('bioweave-business-debug-content')
  const analysisContent = html.indexOf('bioweave-analysis-preview-content')
  assert.ok(businessContent >= 0)
  assert.ok(analysisContent >= 0)
  assert.match(html, /class="bioweave-debug-preview-scroll bioweave-business-debug-content"/)
  assert.match(html, /class="bioweave-debug-preview-scroll bioweave-analysis-preview-content"/)
  assert.ok(html.indexOf('data-bioweave-action="refresh-business-debug"') < businessContent)
  assert.ok(html.indexOf('data-bioweave-action="refresh-analysis-preview"') < analysisContent)
  const tracedHtml = settingsPage({analysisPreview: {input: {token_estimate: 1}, worldModelTrace: {rawResponse: {long: true}, canonicalModel: {}}}})
  const tracedContent = tracedHtml.indexOf('bioweave-analysis-preview-content')
  assert.ok(tracedContent < tracedHtml.indexOf('data-bioweave-world-model-trace'))
  assert.doesNotMatch(STYLE_SOURCE, /\.bioweave-analysis-preview-content\s*\{[\s\S]*?max-height:\s*520px/)
  assert.match(STYLE_SOURCE, /\.bioweave-business-debug-content\s+pre\s*\{[\s\S]*?white-space:\s*pre-wrap/)
})

test('settings business debug renders storyline snapshots, receipts, ordered trace, and safe export fields', () => {
  const html = settingsPage({businessDebug: {target: {floor_version: {floor: 20, swipe_id: 0}}, storyline: {
    source_type: 'CURRENT_RESOLVED', snapshot_complete: true,
    snapshots: [{display_name: '沈清秋', subject_id: 'char-1', status: 'selected', selected_branch_id: 'branch-1', current_node_index: 2, valid_body_count: 1, branches: [{branch_id: 'branch-1', title: '就医', premise: '胃部不适', node_count: 3, node_goals: ['挂号'], conclusion_goal: '完成检查'}]}],
    delivery_records: [{delivery_record_id: 'receipt-1', kind: 'submission', subject_id: 'char-1', context_fingerprint: 'fp-1', floor_version: {floor: 20, swipe_id: 0}}],
    execution_trace: {trace_buffer_status: 'SESSION_ONLY', sequence: [{sequence: 1, stage: 'API_REQUEST', status: 'completed', phase: 'design', display_name: '沈清秋', api_assignment: 'projection', projection_route: 'projection', profile_resolution_task: 'storyline', message_summary: {message_count: 4, role_order: ['system', 'system', 'assistant', 'user'], messages: [{role: 'system', length: 42, fingerprint: 'safe', sections: ['【剧情支线分析规则】']}]}, response: {shape: 'object', length: 88, fingerprint: 'response-safe'}, parse_outcome: 'validated_snapshot', io: {body_refs: [{response_id: 'response-a', floor_version: {floor: 18}, status: 'succeeded', length: 123}, {response_id: 'response-b', floor_version: {floor: 19}, status: 'succeeded', length: 145}]}, prompt: '不得显示', raw_response: '不得显示', body: '不得显示'}, {sequence: 2, stage: 'SNAPSHOT_READBACK', status: 'succeeded', phase: 'design', display_name: '沈清秋'}]},
  }}})
  assert.match(html, /Storyline Debug · 内容、读写与顺序/)
  assert.match(html, /完成检查/)
  assert.match(html, /SNAPSHOT_READBACK/)
  assert.match(html, /context fingerprint/)
  assert.match(html, /projection/)
  assert.match(html, /消息结构摘要/)
  assert.ok(html.includes('返回/解析摘要'))
  assert.match(html, /response-a/)
  assert.doesNotMatch(html, /不得显示/)
})

test('settings debug keeps the inline preview and directly downloads the complete safe TXT DTO', async () => {
  const documentRef = new AppFakeDocument()
  const downloads = []
  const revoked = []
  const createdBlobs = []
  const originalCreateElement = documentRef.createElement.bind(documentRef)
  documentRef.createElement = tagName => {
    const node = originalCreateElement(tagName)
    if (tagName === 'a') node.click = () => downloads.push({href: node.href, download: node.download})
    return node
  }
  const windowRef = {
    Blob: globalThis.Blob,
    URL: {
      createObjectURL: blob => {
        createdBlobs.push(blob)
        return `blob:debug-report-${createdBlobs.length}`
      },
      revokeObjectURL: value => revoked.push(value),
    },
    localStorage: {getItem: () => null, setItem: () => {}},
  }
  const profileStore = {getSettings: () => ({})}
  const runtime = {
    ...apiProfileRuntime('chat-debug-export'),
    collectActiveBusinessData: async () => ({debug: {
      target: {floor_version: {chat_id: 'chat-debug-export', floor: 7, swipe_id: 0}},
      story_time_snapshot: {
        current_story_time: {normalized: '2026-10-07'},
        target_floor_version: {floor: 7},
        candidate_source: 'floor_header',
      },
      event_state: {events: [{event_id: 'event-edit', event: {event_edit_operation_id: 'op-7'}}]},
      tracking_registry: {tracking_subjects: {'char-a': {}}},
      observation_boundary: {aggregations: [{freeze_status: 'FROZEN', excluded_after_aggregation_event_ids: ['event-later'], timeout_status: 'waiting/not_due'}]},
    }}),
    getPersistenceTrace: () => ({sequence: [{stage: 'EVENT_EDIT_COMPLETED', event_edit_operation_id: 'op-7', duration_ms: 12.5, persistence_confirmed: true, failure_stage: null}]}),
    getStoryTimeDebugInfo: async () => ({
      status: 'ready',
      floor: {floor: 7, swipe_id: 0},
      story_time: {display: '羲和元年五月初四 午时', normalized: 'cn-1-5-4T11:00'},
      parsed_parts: {era_label: '羲和', year: 1, month: 5, day: 4},
      trace: {raw_candidate: 'excluded-from-export'},
    }),
  }
  const app = createApp(runtime, {documentRef, windowRef, storageRef: {}, profileStore})
  const root = app.openBioWeave()
  app.go('settings')
  const html = root.querySelector('.bioweave-main').innerHTML
  assert.match(html, /data-bioweave-analysis-preview/)
  assert.match(html, /data-bioweave-action="export-debug-txt"/)
  assert.doesNotMatch(html, /open-analysis-debug|高级调试 Popup|bioweave-analysis-debug-popup-content/)
  await clickSettingsAction(root, {bioweaveAction: 'export-debug-txt'})
  assert.equal(downloads.length, 1)
  assert.match(downloads[0].download, /^ST-BioWeave-Debug-\d{8}-\d{6}\.txt$/)
  assert.deepEqual(revoked, ['blob:debug-report-1'])
  const downloaded = JSON.parse(await createdBlobs[0].text())
  assert.equal(downloaded.business_debug.observation_boundary.aggregations[0].freeze_status, 'FROZEN')
  assert.deepEqual(downloaded.business_debug.observation_boundary.aggregations[0].excluded_after_aggregation_event_ids, ['event-later'])
  assert.equal(downloaded.business_debug.observation_boundary.aggregations[0].timeout_status, 'waiting/not_due')
  assert.equal(downloaded.story_time_snapshot.target_floor_version.floor, 7)
  assert.equal(downloaded.story_time_snapshot.current_story_time.normalized, '2026-10-07')
  const text = buildDebugExportText({
    businessDebug: {event_state: {events: [{event_edit_operation_id: 'op-7'}]}, observation_boundary: {aggregations: [{freeze_status: 'FROZEN', excluded_after_aggregation_reason: 'POST_AGGREGATION_CYCLE_FROZEN'}]}},
    worldModelLiveState: {history_trace: {nested: [1, 2]}},
    historyTrace: {sequence: [{event_edit_operation_id: 'op-7', duration_ms: 12.5}]},
  })
  const exported = JSON.parse(text)
  assert.equal(exported.business_debug.event_state.events[0].event_edit_operation_id, 'op-7')
  assert.equal(exported.business_debug.observation_boundary.aggregations[0].freeze_status, 'FROZEN')
  assert.equal(exported.business_debug.observation_boundary.aggregations[0].excluded_after_aggregation_reason, 'POST_AGGREGATION_CYCLE_FROZEN')
  assert.equal(exported.history_trace.sequence[0].duration_ms, 12.5)
  assert.deepEqual(exported.world_model_live_state.history_trace.nested, [1, 2])
  const storyToggle = actionTarget(root, {bioweaveAction: 'toggle-story-time-debug'})
  storyToggle.checked = true
  const click = [...root.listeners.get('click')][0]
  await click({target: storyToggle, preventDefault() {}})
  await clickSettingsAction(root, {bioweaveAction: 'export-story-time-debug'})
  assert.equal(downloads.length, 2)
  assert.match(downloads[1].download, /^ST-BioWeave-Story-Time-Debug-\d{8}-\d{6}\.txt$/)
  assert.equal(revoked.length, 2)
  const storyExported = JSON.parse(await createdBlobs[1].text())
  assert.equal(storyExported.story_time_debug.story_time.normalized, 'cn-1-5-4T11:00')
  assert.equal(storyExported.story_time_debug.trace, undefined)
  assert.equal(storyExported.business_debug, undefined)
  const storyText = buildStoryTimeDebugExportText({story_time: {normalized: 'cn-1-5-4T11:00'}, trace: {secret: true}})
  assert.equal(JSON.parse(storyText).story_time_debug.trace, undefined)
  assert.match(debugExportFilename(new Date('2026-10-11T01:02:03Z')), /^ST-BioWeave-Debug-20261011-\d{6}\.txt$/)
  const errors = []
  documentRef.defaultView.toastr = {error: message => errors.push(message)}
  windowRef.URL.createObjectURL = undefined
  await clickSettingsAction(root, {bioweaveAction: 'export-debug-txt'})
  assert.equal(downloads.length, 2)
  assert.match(errors[0], /无法导出调试信息/)
  assert.equal(documentRef.listeners.get('click')?.size ?? 0, 0)
  app.destroyBioWeave()
})
test('API profile deletion uses Popup.show.confirm and cancels on a negative result', async () => {
  const documentRef = new AppFakeDocument()
  const confirmCalls = []
  const toastCalls = []
  let confirmResult = 'negative'
  let deleted = false
  const context = {
    Popup: {
      show: {
        async confirm(title, message) {
          confirmCalls.push([title, message])
          return confirmResult
        },
      },
    },
    POPUP_RESULT: { AFFIRMATIVE: 'affirmative', NEGATIVE: 'negative' },
  }
  documentRef.defaultView.toastr = {
    success: message => toastCalls.push(message),
  }
  const profileStore = {
    getSettings: () => ({
      api_source: 'bioweave',
      default_profile_id: 'profile-1',
      api_profiles: deleted ? {} : { 'profile-1': { profile_id: 'profile-1', name: '配置一' } },
      assignments: {},
    }),
    getApiRequestSettings: () => ({}),
    getWorldAnalysisPrompt: () => ({}),
    getRecentStoryGlobal: () => ({ regex_rules: [] }),
    deleteProfile: async id => {
      deleted = id === 'profile-1'
    },
  }
  const runtime = {
    chat: {
      current: () => 'chat-delete',
      token: () => ({ chatId: 'chat-delete' }),
      assert: () => {},
    },
    store: { getChat: () => ({ settings: {} }), saveChat: async () => {} },
    st: {
      getContext: () => context,
      fetch: async () => ({ ok: true, json: async () => [] }),
      getRequestHeaders: () => ({}),
    },
    subscribe: () => () => {},
  }
  const previousConfirm = globalThis.confirm
  globalThis.confirm = () => {
    throw new Error('native confirm must not be called')
  }
  try {
    const app = createApp(runtime, {
      documentRef,
      storageRef: {},
      profileStore,
    })
    const root = app.openBioWeave()
    app.go('settings')
    const click = [...root.listeners.get('click')][0]
    const deleteTarget = {
      __root: root,
      dataset: { bioweaveAction: 'delete-profile', profileId: 'profile-1' },
      closest(selector) {
        return selector.includes('[data-bioweave-action]') ? this : null
      },
    }
    const event = { target: deleteTarget, preventDefault() {} }
    await click(event)
    assert.equal(deleted, false)
    assert.deepEqual(confirmCalls, [['删除 API 配置', '确定删除此 API 配置并清理关联 Secret 引用吗？']])
    confirmResult = 'affirmative'
    await click(event)
    assert.equal(deleted, true)
    assert.equal(confirmCalls.length, 2)
    assert.deepEqual(toastCalls, ['API 配置已删除；关联 Secret 引用已清理。'])
    app.destroyBioWeave()
  } finally {
    if (previousConfirm === undefined) delete globalThis.confirm
    else globalThis.confirm = previousConfirm
  }
})
test('dirty World Model drafts use Popup confirmation and do not analyze after cancellation', async () => {
  const documentRef = new AppFakeDocument()
  const confirmCalls = []
  let analyzeCalls = 0
  let confirmCount = 0
  const context = {
    Popup: {
      show: {
        async confirm(title, message) {
          confirmCalls.push([title, message])
          confirmCount += 1
          return confirmCount === 1 ? 'affirmative' : 'negative'
        },
      },
    },
    POPUP_RESULT: { AFFIRMATIVE: 'affirmative', NEGATIVE: 'negative' },
    chatId: 'chat-dirty-world',
    characters: [],
  }
  const model = {
    schema_version: 1,
    species: [{ name: '潮汐生物', description: '描述', biological_types: [] }],
    medical_context: {
      childbirth_difficulty: null,
      care_level: null,
      evidence: null,
    },
    exceptions: [],
    unknowns: ['旧未知'],
  }
  const profileStore = {
    getSettings: () => ({
      api_source: 'sillytavern',
      default_profile_id: null,
      api_profiles: {},
      assignments: {},
    }),
    getApiRequestSettings: () => ({}),
    getWorldAnalysisPrompt: () => ({}),
    getRecentStoryGlobal: () => ({ regex_rules: [] }),
  }
  const runtime = {
    chat: {
      current: () => 'chat-dirty-world',
      token: () => ({ chatId: 'chat-dirty-world' }),
      assert: () => {},
    },
    store: {
      getChat: () => ({ settings: {}, world_model: model }),
      saveChat: async () => {},
    },
    resolveWorldModelAtOrBefore: async () => ({ model, meta: null }),
    analyzeCurrentWorldModelFull: async () => ({ model, meta: null }),
    saveWorldModel: async () => {},
    st: {
      getContext: () => context,
      fetch: async () => ({ ok: true, json: async () => [] }),
      getRequestHeaders: () => ({}),
    },
    subscribe: () => () => {},
  }
  const app = createApp(runtime, {
    documentRef,
    storageRef: {},
    profileStore,
    analyzer: {
      analyzeWorldModel: async () => {
        analyzeCalls += 1
        return model
      },
    },
  })
  const root = app.openBioWeave()
  app.go('world')
  await new Promise(resolve => setTimeout(resolve, 0))
  const click = [...root.listeners.get('click')][0]
  const actionTarget = (action, section = undefined) => ({
    __root: root,
    dataset: {
      bioweaveAction: action,
      ...(section ? { bioweaveWorldSection: section } : {}),
    },
    closest(selector) {
      return selector.includes('[data-bioweave-action]') ? this : null
    },
  })
  await click({
    target: actionTarget('world-model-edit-section', 'unknowns'),
    preventDefault() {},
  })
  const row = {
    querySelector(selector) {
      return selector.includes('data-bioweave-world-section-field="value"') ? { value: '新未知' } : null
    },
  }
  const form = {
    querySelectorAll(selector) {
      return selector.includes('data-bioweave-world-section-row="unknowns"') ? [row] : []
    },
  }
  root.selectorNodes.set('[data-bioweave-world-section-form]', [form])
  const input = [...root.listeners.get('input')][0]
  input({
    target: {
      __root: root,
      closest(selector) {
        return selector === '[data-bioweave-world-section-form]' ? form : null
      },
    },
  })
  await click({
    target: actionTarget('world-model-full'),
    preventDefault() {},
  })
  assert.deepEqual(confirmCalls, [
    ['重新分析世界资料', '重新分析会清理当前已有的全部世界分析数据，并根据当前资料重新进行完整分析。此操作会替换现有分析结果，是否继续？'],
    ['放弃未保存修改', '当前修改尚未保存，是否放弃？'],
  ])
  assert.equal(analyzeCalls, 0)
  app.destroyBioWeave()
})
test('World Model Full CTA gates only populated active data and leaves cancellation side-effect free', async () => {
  const model = normalizeWorldModel({
    schema_version: 1,
    species: [{name: '潮汐生物', biological_types: []}],
  })
  const scenarios = [
    {name: 'empty', resolved: null, confirmed: false, expectedConfirmCalls: 0, expectedFullCalls: 1},
    {name: 'cancel', resolved: {model, meta: {archived_species: [{species: {name: '归档种族'}}]}}, confirmed: false, expectedConfirmCalls: 1, expectedFullCalls: 0},
    {name: 'confirm', resolved: {model, meta: null}, confirmed: true, expectedConfirmCalls: 1, expectedFullCalls: 1},
  ]
  for (const scenario of scenarios) {
    const documentRef = new AppFakeDocument()
    const confirmCalls = []
    let fullCalls = 0
    let startActivityCalls = 0
    let saveCalls = 0
    const hostContext = {
      chatId: `chat-world-cta-${scenario.name}`,
      characters: [],
      POPUP_RESULT: {AFFIRMATIVE: 'affirmative'},
      Popup: {
        show: {
          async confirm(title, message) {
            confirmCalls.push([title, message])
            return scenario.confirmed ? 'affirmative' : 'negative'
          },
        },
      },
    }
    const profileStore = {
      getSettings: () => ({api_source: 'sillytavern', default_profile_id: null, api_profiles: {}, assignments: {}}),
      getApiRequestSettings: () => ({}),
      getWorldAnalysisPrompt: () => ({}),
      getRecentStoryGlobal: () => ({regex_rules: []}),
    }
    const runtime = {
      chat: {
        current: () => hostContext.chatId,
        token: () => ({chatId: hostContext.chatId, epoch: 0}),
        assert: () => {},
      },
      store: {getChat: () => ({settings: {}})},
      resolveWorldModelAtOrBefore: async () => scenario.resolved,
      analyzeCurrentWorldModelFull: async () => {
        fullCalls += 1
        return {model, meta: null}
      },
      saveWorldModel: async () => { saveCalls += 1 },
      startActivity: () => { startActivityCalls += 1 },
      finishActivity: () => {},
      assertBioWeaveEnabled: () => {},
      st: {
        getContext: () => hostContext,
        fetch: async () => ({ok: true, json: async () => []}),
        getRequestHeaders: () => ({}),
      },
      subscribe: () => () => {},
    }
    const app = createApp(runtime, {documentRef, storageRef: {}, profileStore})
    const root = app.openBioWeave()
    app.go('world')
    await new Promise(resolve => setTimeout(resolve, 0))
    const click = [...root.listeners.get('click')][0]
    const target = {
      __root: root,
      dataset: {bioweaveAction: 'world-model-full'},
      closest(selector) {
        return selector.includes('[data-bioweave-action]') ? this : null
      },
    }
    const markup = root.querySelector('.bioweave-main').innerHTML
    assert.match(markup, new RegExp(`>${scenario.resolved ? '重新分析' : '开始分析'}<\\/button>`))
    await click({target, preventDefault() {}})
    assert.equal(confirmCalls.length, scenario.expectedConfirmCalls, scenario.name)
    assert.equal(fullCalls, scenario.expectedFullCalls, scenario.name)
    assert.equal(saveCalls, 0, scenario.name)
    if (scenario.name === 'cancel') assert.equal(startActivityCalls, 0)
    if (scenario.name === 'cancel') {
      assert.deepEqual(confirmCalls[0], [
        '重新分析世界资料',
        '重新分析会清理当前已有的全部世界分析数据，并根据当前资料重新进行完整分析。此操作会替换现有分析结果，是否继续？',
      ])
      assert.deepEqual(scenario.resolved.model, model)
      assert.deepEqual(scenario.resolved.meta, {archived_species: [{species: {name: '归档种族'}}]})
    }
    app.destroyBioWeave()
  }
})

test('World Model analysis routes success and failure feedback through semantic Toasts', async () => {
  const previousModel = {
    schema_version: 1,
    species: [{ name: '潮汐生物', description: '描述', biological_types: [] }],
    medical_context: {
      childbirth_difficulty: null,
      care_level: null,
      evidence: null,
    },
    exceptions: [],
    unknowns: ['旧模型'],
  }
  const nextModel = {
    ...previousModel,
    unknowns: ['新模型'],
  }
  const scenarios = [
    {
      code: null,
      type: 'success',
      message: 'BioWeave：世界分析完成',
    },
    {
      code: 'REQUEST_TIMEOUT',
      type: 'error',
      message: 'BioWeave：世界模型分析请求超时，上一份模型已保留。',
    },
    {
      code: 'REQUEST_TIMEOUT',
      diagnosticCode: 'server',
      status: 503,
      type: 'error',
      message: 'BioWeave：服务暂时不可用（HTTP 503），请稍后重试。 上一份模型已保留。',
    },
    {
      code: 'API_PROFILE_INVALID',
      type: 'error',
      message: 'BioWeave：世界分析 API 配置无效，请检查 URL 和模型。',
    },
  ]
  for (const scenario of scenarios) {
    const documentRef = new AppFakeDocument()
    const toastCalls = []
    const hostContext = {
      chatId: 'chat-world-feedback',
      characters: [],
      POPUP_RESULT: { AFFIRMATIVE: 'affirmative' },
      Popup: { show: { confirm: async () => 'affirmative' } },
    }
    documentRef.defaultView.toastr = {
      success(message) {
        toastCalls.push(['success', message])
      },
      error(message) {
        toastCalls.push(['error', message])
      },
    }
    let savedChat = { settings: {}, world_model: previousModel }
    let refreshCalls = 0
    const profileStore = {
      getSettings: () => ({
        api_source: 'sillytavern',
        default_profile_id: null,
        api_profiles: {},
        assignments: {},
      }),
      getApiRequestSettings: () => ({}),
      getWorldAnalysisPrompt: () => ({}),
      getRecentStoryGlobal: () => ({ regex_rules: [] }),
    }
    const runtime = {
      chat: {
        current: () => 'chat-world-feedback',
        token: () => ({ chatId: 'chat-world-feedback', epoch: 0 }),
        assert: () => {},
      },
      store: {
        getChat: () => savedChat,
        saveChat: async (_chatId, nextChat) => {
          savedChat = nextChat
        },
      },
      resolveWorldModelAtOrBefore: async () => ({ model: previousModel, meta: null }),
      analyzeCurrentWorldModelFull: async () => {
        if (scenario.code) {
          const error = new Error(scenario.code)
          error.code = scenario.code
          if (scenario.diagnosticCode) {
            error.diagnosticCode = scenario.diagnosticCode
            error.diagnostic_code = scenario.diagnosticCode
            error.error_code = scenario.diagnosticCode
          }
          if (scenario.status) error.status = scenario.status
          throw error
        }
        const model = normalizeWorldModel(nextModel)
        savedChat = { ...savedChat, world_model: model }
        return { model, meta: null }
      },
      st: {
        getContext: () => hostContext,
        fetch: async () => ({ ok: true, json: async () => [] }),
        getRequestHeaders: () => ({}),
      },
      subscribe: () => () => {},
    }
    const analyzer = {
      analyzeWorldModel: async () => {
        if (!scenario.code) return nextModel
        const error = new Error(scenario.code)
        error.code = scenario.code
        if (scenario.diagnosticCode) {
          error.diagnosticCode = scenario.diagnosticCode
          error.diagnostic_code = scenario.diagnosticCode
          error.error_code = scenario.diagnosticCode
        }
        if (scenario.status) error.status = scenario.status
        throw error
      },
    }
    const app = createApp(runtime, {
      documentRef,
      storageRef: {},
      profileStore,
      analyzer,
    })
    const root = app.openBioWeave()
    app.go('world')
    await new Promise(resolve => setTimeout(resolve, 0))
    const click = [...root.listeners.get('click')][0]
    await click({
      target: {
        __root: root,
        dataset: { bioweaveAction: 'world-model-full' },
        closest(selector) {
          return selector.includes('[data-bioweave-action]') ? this : null
        },
      },
      preventDefault() {},
    })
    assert.deepEqual(toastCalls, [[scenario.type, scenario.message]], scenario.code ?? 'success')
    const markup = root.querySelector('.bioweave-main').innerHTML
    assert.doesNotMatch(markup, /class="bioweave-settings-notice"/)
    assert.doesNotMatch(markup, new RegExp(scenario.message))
    if (scenario.code) {
      assert.match(markup, /旧模型/)
      assert.equal(savedChat.world_model, previousModel)
    } else {
      assert.match(markup, /新模型/)
      assert.deepEqual(savedChat.world_model, normalizeWorldModel(nextModel))
      assert.equal(refreshCalls, 0)
    }
    app.destroyBioWeave()
  }
})
test('clicking the running World Full action cancels it instead of starting another request', async () => {
  const documentRef = new AppFakeDocument()
  let abortObserved = false
  let confirmCalls = 0
  const hostContext = {
    chatId: 'chat-world-cancel',
    characters: [],
    POPUP_RESULT: {AFFIRMATIVE: 'affirmative'},
    Popup: {
      show: {
        async confirm() {
          confirmCalls += 1
          return 'affirmative'
        },
      },
    },
  }
  const profileStore = {
    getSettings: () => ({
      api_source: 'sillytavern',
      default_profile_id: null,
      api_profiles: {},
      assignments: {},
    }),
    getApiRequestSettings: () => ({retry_count: 0}),
    getWorldAnalysisPrompt: () => ({}),
    getRecentStoryGlobal: () => ({regex_rules: []}),
  }
  const runtime = {
    chat: {
      current: () => 'chat-world-cancel',
      token: () => ({chatId: 'chat-world-cancel', epoch: 0}),
      assert: () => {},
    },
    store: {
      getChat: () => ({settings: {}}),
    },
    resolveWorldModelAtOrBefore: async () => null,
    analyzeCurrentWorldModelFull: ({signal}) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        abortObserved = true
        const error = new Error('REQUEST_ABORTED')
        error.code = 'REQUEST_ABORTED'
        reject(error)
      }, {once: true})
    }),
    startActivity: () => {},
    finishActivity: () => {},
    assertBioWeaveEnabled: () => {},
    subscribe: () => () => {},
    st: {
      getContext: () => hostContext,
      fetch: async () => ({ok: true, json: async () => []}),
      getRequestHeaders: () => ({}),
    },
  }
  const app = createApp(runtime, {
    documentRef,
    storageRef: {},
    profileStore,
  })
  const root = app.openBioWeave()
  app.go('world')
  await Promise.resolve()
  const click = [...root.listeners.get('click')][0]
  const target = {
    __root: root,
    dataset: {bioweaveAction: 'world-model-full'},
    closest(selector) {
      return selector.includes('[data-bioweave-action]') ? this : null
    },
  }
  const firstClick = click({target, preventDefault() {}})
  for (let index = 0; index < 20; index += 1) {
    await new Promise(resolve => setImmediate(resolve))
    if (root.querySelector('.bioweave-main').innerHTML.includes('分析中…')) break
  }
  await click({target, preventDefault() {}})
  await firstClick
  assert.equal(confirmCalls, 1)
  assert.equal(abortObserved, true)
  app.destroyBioWeave()
})
test('World Model section save routes success and failure feedback through Toasts', async () => {
  const baseModel = {
    schema_version: 1,
    species: [{ name: '潮汐生物', description: '描述', biological_types: [] }],
    medical_context: {
      childbirth_difficulty: null,
      care_level: null,
      evidence: null,
    },
    exceptions: [],
    unknowns: ['旧模块内容'],
  }
  const scenarios = [
    {
      errorCode: null,
      type: 'success',
      message: '当前模块已保存。',
    },
    {
      errorCode: 'WORLD_MODEL_SAVE_FAILED',
      type: 'error',
      message: '保存失败，当前模块草稿仍保留。',
    },
  ]
  for (const scenario of scenarios) {
    const documentRef = new AppFakeDocument()
    const toastCalls = []
    documentRef.defaultView.toastr = {
      success(message) {
        toastCalls.push(['success', message])
      },
      error(message) {
        toastCalls.push(['error', message])
      },
    }
    let savedChat = { settings: {}, world_model: baseModel }
    let refreshCalls = 0
    const profileStore = {
      getSettings: () => ({
        api_source: 'sillytavern',
        default_profile_id: null,
        api_profiles: {},
        assignments: {},
      }),
      getApiRequestSettings: () => ({}),
      getWorldAnalysisPrompt: () => ({}),
      getRecentStoryGlobal: () => ({ regex_rules: [] }),
    }
    const runtime = {
      chat: {
        current: () => 'chat-world-section-feedback',
        token: () => ({ chatId: 'chat-world-section-feedback', epoch: 0 }),
        assert: () => {},
      },
      store: {
        getChat: () => savedChat,
        saveChat: async (_chatId, nextChat) => {
          if (scenario.errorCode) {
            const error = new Error(scenario.errorCode)
            error.code = scenario.errorCode
            throw error
          }
          savedChat = nextChat
        },
      },
      resolveWorldModelAtOrBefore: async () => ({ model: baseModel, meta: null }),
      saveWorldModel: async ({ model }) => {
        if (scenario.errorCode) {
          const error = new Error(scenario.errorCode)
          error.code = scenario.errorCode
          throw error
        }
        savedChat = { ...savedChat, world_model: model }
      },
      refreshTrackingRegistry: async () => {
        refreshCalls += 1
      },
      st: {
        getContext: () => ({
          chatId: 'chat-world-section-feedback',
          characters: [],
        }),
        fetch: async () => ({ ok: true, json: async () => [] }),
        getRequestHeaders: () => ({}),
      },
      subscribe: () => () => {},
    }
    const app = createApp(runtime, {
      documentRef,
      storageRef: {},
      profileStore,
    })
    const root = app.openBioWeave()
    app.go('world')
    await new Promise(resolve => setTimeout(resolve, 0))
    const actionTarget = (action, section = undefined) => ({
      __root: root,
      dataset: {
        bioweaveAction: action,
        ...(section ? { bioweaveWorldSection: section } : {}),
      },
      closest(selector) {
        return selector.includes('[data-bioweave-action]') ? this : null
      },
    })
    const click = [...root.listeners.get('click')][0]
    await click({
      target: actionTarget('world-model-edit-section', 'unknowns'),
      preventDefault() {},
    })
    const row = {
      querySelector(selector) {
        return selector.includes('data-bioweave-world-section-field="value"') ? { value: '新模块内容' } : null
      },
    }
    const form = {
      querySelectorAll(selector) {
        return selector.includes('data-bioweave-world-section-row="unknowns"') ? [row] : []
      },
    }
    root.selectorNodes.set('[data-bioweave-world-section-form]', [form])
    const input = [...root.listeners.get('input')][0]
    input({
      target: {
        __root: root,
        closest(selector) {
          return selector === '[data-bioweave-world-section-form]' ? form : null
        },
      },
    })
    await click({
      target: actionTarget('world-model-save-section'),
      preventDefault() {},
    })
    assert.deepEqual(toastCalls, [[scenario.type, scenario.message]])
    const markup = root.querySelector('.bioweave-main').innerHTML
    assert.doesNotMatch(markup, /class="bioweave-settings-notice"/)
    assert.doesNotMatch(markup, new RegExp(scenario.message))
    if (scenario.errorCode) {
      assert.deepEqual(savedChat.world_model, baseModel)
    } else {
      assert.deepEqual(savedChat.world_model.unknowns, ['新模块内容'])
      assert.equal(refreshCalls, 1)
    }
    app.destroyBioWeave()
  }
})
test('World Model view reloads from Runtime after owner mutations and drops deleted owners', async () => {
  const documentRef = new AppFakeDocument()
  const oldModel = {
    schema_version: 1,
    species: [{name: 'Floor 3 世界', description: '', biological_types: []}],
    medical_context: {childbirth_difficulty: null, care_level: null, evidence: null},
    exceptions: [],
    unknowns: [],
  }
  const newModel = {
    schema_version: 1,
    species: [{name: 'Floor 6 世界', description: '', biological_types: []}],
    medical_context: {childbirth_difficulty: null, care_level: null, evidence: null},
    exceptions: [],
    unknowns: [],
  }
  let currentModel = oldModel
  let resolveCalls = 0
  let listener = null
  const runtime = {
    chat: {
      current: () => 'chat-world-view-invalidation',
      token: () => ({chatId: 'chat-world-view-invalidation', epoch: 0}),
      assert: () => {},
    },
    resolveWorldModelAtOrBefore: async () => {
      resolveCalls += 1
      return {model: currentModel, meta: {owner_floor: currentModel === oldModel ? 3 : 6}}
    },
    st: {
      getContext: () => ({chatId: 'chat-world-view-invalidation', characters: []}),
      fetch: async () => ({ok: true, json: async () => []}),
      getRequestHeaders: () => ({}),
    },
    subscribe: callback => {
      listener = callback
      return () => {
        listener = null
      }
    },
  }
  const profileStore = {
    getSettings: () => ({api_source: 'sillytavern', default_profile_id: null, api_profiles: {}, assignments: {}}),
    getApiRequestSettings: () => ({}),
    getWorldAnalysisPrompt: () => ({}),
    getRecentStoryGlobal: () => ({regex_rules: []}),
  }
  const app = createApp(runtime, {documentRef, storageRef: {}, profileStore})
  const root = app.openBioWeave()
  app.go('world')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.match(root.querySelector('.bioweave-main').innerHTML, /Floor 3 世界/)
  assert.equal(resolveCalls, 1)

  currentModel = newModel
  listener({type: 'MESSAGE_DELETED'})
  listener({type: 'BIOWEAVE_LIFECYCLE_SETTLED', mutationType: 'MESSAGE_DELETED'})
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.match(root.querySelector('.bioweave-main').innerHTML, /Floor 6 世界/)
  assert.equal(resolveCalls, 2)

  currentModel = null
  listener({type: 'MESSAGE_SWIPE_DELETED'})
  listener({type: 'BIOWEAVE_LIFECYCLE_SETTLED', mutationType: 'MESSAGE_SWIPE_DELETED'})
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.doesNotMatch(root.querySelector('.bioweave-main').innerHTML, /Floor 6 世界/)
  assert.match(root.querySelector('.bioweave-main').innerHTML, /世界模型尚未建立/)
  app.destroyBioWeave()
})

test('World Model view ignores stale reloads after a Chat change', async () => {
  const documentRef = new AppFakeDocument()
  const modelA = {
    schema_version: 1,
    species: [{name: 'Chat A 世界', description: '', biological_types: []}],
    medical_context: {childbirth_difficulty: null, care_level: null, evidence: null},
    exceptions: [],
    unknowns: [],
  }
  const modelB = {
    schema_version: 1,
    species: [{name: 'Chat B 世界', description: '', biological_types: []}],
    medical_context: {childbirth_difficulty: null, care_level: null, evidence: null},
    exceptions: [],
    unknowns: [],
  }
  let chatId = 'chat-a'
  let listener = null
  const pending = []
  const runtime = {
    chat: {
      current: () => chatId,
      token: () => ({chatId}),
      assert: token => {
        if (token.chatId !== chatId) throw new Error('STALE_CHAT')
      },
    },
    resolveWorldModelAtOrBefore: () => new Promise(resolve => pending.push(resolve)),
    st: {
      getContext: () => ({chatId, characters: []}),
      fetch: async () => ({ok: true, json: async () => []}),
      getRequestHeaders: () => ({}),
    },
    subscribe: callback => {
      listener = callback
      return () => {
        listener = null
      }
    },
  }
  const profileStore = {
    getSettings: () => ({api_source: 'sillytavern', default_profile_id: null, api_profiles: {}, assignments: {}}),
    getApiRequestSettings: () => ({}),
    getWorldAnalysisPrompt: () => ({}),
    getRecentStoryGlobal: () => ({regex_rules: []}),
  }
  const app = createApp(runtime, {documentRef, storageRef: {}, profileStore})
  const root = app.openBioWeave()
  app.go('world')
  chatId = 'chat-b'
  listener({type: 'CHAT_CHANGED', chatChanged: true})
  listener({type: 'BIOWEAVE_LIFECYCLE_SETTLED', mutationType: 'CHAT_CHANGED'})
  pending[0]({model: modelA, meta: null})
  await new Promise(resolve => setTimeout(resolve, 0))
  app.go('world')
  pending[1]({model: modelB, meta: null})
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.match(root.querySelector('.bioweave-main').innerHTML, /Chat B 世界/)
  assert.doesNotMatch(root.querySelector('.bioweave-main').innerHTML, /Chat A 世界/)
  app.destroyBioWeave()
})

test('World Model status resolves from the current history independently of route order', async () => {
  const documentRef = new AppFakeDocument()
  const model = {
    schema_version: 1,
    species: [{name: '状态页世界', description: '', biological_types: []}],
    medical_context: {childbirth_difficulty: null, care_level: null, evidence: null},
    exceptions: [],
    unknowns: [],
  }
  let resolveCalls = 0
  let fullCalls = 0
  let currentResolved = {model, meta: {owner_floor: 12}}
  const runtime = {
    chat: {
      current: () => 'chat-world-status-order',
      token: () => ({chatId: 'chat-world-status-order', epoch: 0}),
      assert: () => {},
    },
    resolveWorldModelAtOrBefore: async () => {
      resolveCalls += 1
      return currentResolved
    },
    analyzeCurrentWorldModelFull: async () => {
      fullCalls += 1
      return currentResolved
    },
    analyzeCurrentWorldModelPatch: async () => {
      fullCalls += 1
      return currentResolved
    },
    st: {
      getContext: () => ({chatId: 'chat-world-status-order', characters: []}),
      fetch: async () => ({ok: true, json: async () => []}),
      getRequestHeaders: () => ({}),
    },
    subscribe: () => () => {},
  }
  const profileStore = {
    getSettings: () => ({api_source: 'sillytavern', default_profile_id: null, api_profiles: {}, assignments: {}}),
    getApiRequestSettings: () => ({}),
    getWorldAnalysisPrompt: () => ({}),
    getRecentStoryGlobal: () => ({regex_rules: []}),
  }
  const app = createApp(runtime, {documentRef, storageRef: {}, profileStore})
  const root = app.openBioWeave()
  app.go('state')
  await new Promise(resolve => setImmediate(resolve))
  assert.match(root.querySelector('.bioweave-main').innerHTML, /成功/)
  assert.match(root.querySelector('.bioweave-main').innerHTML, /所属楼层 12/)
  assert.equal(resolveCalls, 1)
  assert.equal(fullCalls, 0)

  app.go('world')
  await new Promise(resolve => setImmediate(resolve))
  assert.match(root.querySelector('.bioweave-main').innerHTML, /状态页世界/)
  assert.equal(resolveCalls, 1, 'world route should reuse the valid status read')
  assert.equal(fullCalls, 0)

  app.go('state')
  assert.match(root.querySelector('.bioweave-main').innerHTML, /成功/)
  app.closeBioWeave()
  app.openBioWeave()
  assert.match(root.querySelector('.bioweave-main').innerHTML, /成功/)
  assert.equal(resolveCalls, 1, 'reopening should reuse the current valid owner state')
  app.destroyBioWeave()
})

test('World Model status keeps the original empty label only after resolver confirms no history', async () => {
  const documentRef = new AppFakeDocument()
  let resolveCalls = 0
  const runtime = {
    chat: {
      current: () => 'chat-world-status-empty',
      token: () => ({chatId: 'chat-world-status-empty', epoch: 0}),
      assert: () => {},
    },
    resolveWorldModelAtOrBefore: async () => {
      resolveCalls += 1
      return null
    },
    st: {
      getContext: () => ({chatId: 'chat-world-status-empty', characters: []}),
      fetch: async () => ({ok: true, json: async () => []}),
      getRequestHeaders: () => ({}),
    },
    subscribe: () => () => {},
  }
  const profileStore = {
    getSettings: () => ({api_source: 'sillytavern', default_profile_id: null, api_profiles: {}, assignments: {}}),
    getApiRequestSettings: () => ({}),
    getWorldAnalysisPrompt: () => ({}),
    getRecentStoryGlobal: () => ({regex_rules: []}),
  }
  const app = createApp(runtime, {documentRef, storageRef: {}, profileStore})
  const root = app.openBioWeave()
  app.go('state')
  assert.equal(root.querySelector('.bioweave-main').innerHTML, '', 'unresolved state must not be rendered as not started')
  await new Promise(resolve => setImmediate(resolve))
  const html = root.querySelector('.bioweave-main').innerHTML
  assert.match(html, /未启用/)
  assert.equal(resolveCalls, 1)
  app.destroyBioWeave()
})

test('World Model status does not turn a resolver failure into the empty-state label', async () => {
  const documentRef = new AppFakeDocument()
  const toastCalls = []
  documentRef.defaultView.toastr = {error: message => toastCalls.push(message)}
  const runtime = {
    chat: {
      current: () => 'chat-world-status-failure',
      token: () => ({chatId: 'chat-world-status-failure', epoch: 0}),
      assert: () => {},
    },
    resolveWorldModelAtOrBefore: async () => { throw new Error('WORLD_READ_FAILED') },
    st: {
      getContext: () => ({chatId: 'chat-world-status-failure', characters: []}),
      fetch: async () => ({ok: true, json: async () => []}),
      getRequestHeaders: () => ({}),
    },
    subscribe: () => () => {},
  }
  const profileStore = {
    getSettings: () => ({api_source: 'sillytavern', default_profile_id: null, api_profiles: {}, assignments: {}}),
    getApiRequestSettings: () => ({}),
    getWorldAnalysisPrompt: () => ({}),
    getRecentStoryGlobal: () => ({regex_rules: []}),
  }
  const app = createApp(runtime, {documentRef, storageRef: {}, profileStore})
  const root = app.openBioWeave()
  app.go('state')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(root.querySelector('.bioweave-main').innerHTML, '')
  assert.deepEqual(toastCalls, ['世界模型读取失败，请重试。'])
  app.destroyBioWeave()
})

test('World Model status ignores a stale Chat result while resolving the new Chat', async () => {
  const documentRef = new AppFakeDocument()
  let chatId = 'chat-status-a'
  let listener = null
  const pending = []
  const runtime = {
    chat: {
      current: () => chatId,
      token: () => ({chatId, epoch: 0}),
      assert: token => { if (token.chatId !== chatId) throw new Error('STALE_CHAT') },
    },
    resolveWorldModelAtOrBefore: () => new Promise(resolve => pending.push(resolve)),
    st: {
      getContext: () => ({chatId, characters: []}),
      fetch: async () => ({ok: true, json: async () => []}),
      getRequestHeaders: () => ({}),
    },
    subscribe: callback => {
      listener = callback
      return () => { listener = null }
    },
  }
  const profileStore = {
    getSettings: () => ({api_source: 'sillytavern', default_profile_id: null, api_profiles: {}, assignments: {}}),
    getApiRequestSettings: () => ({}),
    getWorldAnalysisPrompt: () => ({}),
    getRecentStoryGlobal: () => ({regex_rules: []}),
  }
  const app = createApp(runtime, {documentRef, storageRef: {}, profileStore})
  const root = app.openBioWeave()
  app.go('state')
  chatId = 'chat-status-b'
  listener({type: 'CHAT_CHANGED', chatChanged: true})
  listener({type: 'BIOWEAVE_LIFECYCLE_SETTLED', mutationType: 'CHAT_CHANGED'})
  app.go('state')
  pending[0]({model: {schema_version: 1, species: [{name: '旧 Chat', biological_types: []}]}, meta: {owner_floor: 1}})
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(root.querySelector('.bioweave-main').innerHTML, '')
  pending[1]({model: {schema_version: 1, species: [{name: '新 Chat', biological_types: []}]}, meta: {owner_floor: 2}})
  await new Promise(resolve => setImmediate(resolve))
  assert.match(root.querySelector('.bioweave-main').innerHTML, /所属楼层 2/)
  assert.doesNotMatch(root.querySelector('.bioweave-main').innerHTML, /所属楼层 1/)
  app.destroyBioWeave()
})

test('World Model status refreshes for a new Floor or Swipe owner without stale state', async () => {
  const documentRef = new AppFakeDocument()
  const modelA = {schema_version: 1, species: [{name: '旧历史', biological_types: []}], medical_context: {}, exceptions: [], unknowns: []}
  const modelB = {schema_version: 1, species: [{name: '新历史', biological_types: []}], medical_context: {}, exceptions: [], unknowns: []}
  let currentResolved = {model: modelA, meta: {owner_floor: 3}}
  let resolveCalls = 0
  let listener = null
  const runtime = {
    chat: {
      current: () => 'chat-world-status-owner',
      token: () => ({chatId: 'chat-world-status-owner', epoch: 0}),
      assert: () => {},
    },
    resolveWorldModelAtOrBefore: async () => {
      resolveCalls += 1
      return currentResolved
    },
    st: {
      getContext: () => ({chatId: 'chat-world-status-owner', characters: []}),
      fetch: async () => ({ok: true, json: async () => []}),
      getRequestHeaders: () => ({}),
    },
    subscribe: callback => {
      listener = callback
      return () => { listener = null }
    },
  }
  const profileStore = {
    getSettings: () => ({api_source: 'sillytavern', default_profile_id: null, api_profiles: {}, assignments: {}}),
    getApiRequestSettings: () => ({}),
    getWorldAnalysisPrompt: () => ({}),
    getRecentStoryGlobal: () => ({regex_rules: []}),
  }
  const app = createApp(runtime, {documentRef, storageRef: {}, profileStore})
  const root = app.openBioWeave()
  app.go('state')
  await new Promise(resolve => setImmediate(resolve))
  assert.match(root.querySelector('.bioweave-main').innerHTML, /所属楼层 3/)

  currentResolved = {model: modelB, meta: {owner_floor: 8}}
  listener({type: 'BIOWEAVE_LIFECYCLE_SETTLED', mutationType: 'MESSAGE_SWIPE_DELETED'})
  await new Promise(resolve => setImmediate(resolve))
  assert.match(root.querySelector('.bioweave-main').innerHTML, /所属楼层 8/)
  assert.doesNotMatch(root.querySelector('.bioweave-main').innerHTML, /所属楼层 3/)
  assert.equal(resolveCalls, 2)
  app.destroyBioWeave()
})

test('World Model collection edits persist on the current resolver and preserve metadata', async () => {
  const documentRef = new AppFakeDocument()
  const toastCalls = []
  let confirmResult = 'negative'
  const confirmCalls = []
  let refreshCalls = 0
  documentRef.defaultView.toastr = {
    success(message) { toastCalls.push(['success', message]) },
    error(message) { toastCalls.push(['error', message]) },
    warning(message) { toastCalls.push(['warning', message]) },
  }
  const baseModel = {
    schema_version: 1,
    species: [{
      name: '种族 A',
      description: 'A 描述',
      biological_types: [{name: '类型 A'}],
    }],
    medical_context: {childbirth_difficulty: null, care_level: null, evidence: null},
    exceptions: [{statement: '保留'}],
    unknowns: ['保留未知'],
  }
  const meta = {last_saved_by: 'ai', source_summary: {character_fields: 1}}
  let currentModel = normalizeWorldModel(baseModel)
  let currentMeta = structuredClone(meta)
  let failSave = false
  let saveCalls = 0
  const savePayloads = []
  const profileStore = {
    getSettings: () => ({api_source: 'sillytavern', default_profile_id: null, api_profiles: {}, assignments: {}}),
    getApiRequestSettings: () => ({}),
    getWorldAnalysisPrompt: () => ({}),
    getRecentStoryGlobal: () => ({regex_rules: []}),
  }
  const runtime = {
    chat: {
      current: () => 'chat-world-collections',
      token: () => ({chatId: 'chat-world-collections', epoch: 0}),
      assert: () => {},
    },
    resolveWorldModelAtOrBefore: async () => ({model: currentModel, meta: currentMeta}),
    saveWorldModel: async ({model, meta: nextMeta}) => {
      saveCalls += 1
      savePayloads.push({model: structuredClone(model), meta: structuredClone(nextMeta)})
      if (failSave) {
        const error = new Error('WORLD_MODEL_SAVE_FAILED')
        error.code = 'WORLD_MODEL_SAVE_FAILED'
        throw error
      }
      currentModel = structuredClone(model)
      currentMeta = structuredClone(nextMeta)
    },
    refreshTrackingRegistry: async () => { refreshCalls += 1 },
    st: {
      getContext: () => ({
        chatId: 'chat-world-collections',
        characters: [],
        Popup: {show: {async confirm(title, message) { confirmCalls.push([title, message]); return confirmResult }}},
        POPUP_RESULT: {AFFIRMATIVE: 'affirmative', NEGATIVE: 'negative'},
      }),
      fetch: async () => ({ok: true, json: async () => []}),
      getRequestHeaders: () => ({}),
    },
    subscribe: () => () => {},
  }
  let app = createApp(runtime, {documentRef, storageRef: {}, profileStore})
  let root = app.openBioWeave()
  app.go('world')
  await new Promise(resolve => setTimeout(resolve, 0))
  let click = [...root.listeners.get('click')][0]
  const actionTarget = (action, dataset = {}, form = null) => ({
    __root: root,
    dataset: {bioweaveAction: action, ...dataset},
    closest(selector) {
      if (selector.includes('[data-bioweave-world-model-collection-form]')) return form
      return selector.includes('[data-bioweave-action]') ? this : null
    },
  })
  const nestedActionTarget = (action, dataset = {}, form = null) => {
    const button = actionTarget(action, dataset, form)
    return {
      __root: root,
      dataset: {},
      closest(selector) {
        return button.closest(selector)
      },
    }
  }
  const clickCollection = async (action, dataset, value, {mode = 'add', typeIndex = ''} = {}) => {
    const form = {
      dataset: {
        bioweaveWorldModelCollectionKind: dataset.bioweaveWorldModelCollectionKind,
        bioweaveWorldModelCollectionMode: mode,
        bioweaveWorldSpeciesIndex: dataset.bioweaveWorldSpeciesIndex ?? '',
        bioweaveWorldTypeIndex: typeIndex,
      },
      querySelector(selector) {
        return selector.includes('data-bioweave-world-model-collection-input') ? {value} : null
      },
    }
    await click({target: actionTarget(action, dataset, form), preventDefault() {}})
  }
  await click({target: actionTarget('world-model-add-species'), preventDefault() {}})
  assert.match(root.querySelector('.bioweave-main').innerHTML, /data-bioweave-world-model-collection-form/)
  await clickCollection('world-model-save-species', {bioweaveWorldModelCollectionKind: 'species'}, '  种族 B  ')
  assert.deepEqual(currentModel.species.map(item => item.name), ['种族 A', '种族 B'])
  assert.deepEqual(currentMeta, meta)
  assert.deepEqual(currentModel.medical_context, normalizeWorldModel(baseModel).medical_context)
  assert.deepEqual(currentModel.exceptions, normalizeWorldModel(baseModel).exceptions)

  assert.doesNotMatch(
    root.querySelector('.bioweave-main').innerHTML,
    /data-bioweave-action="world-model-add-biological-type"[^>]*disabled/,
  )
  await click({target: nestedActionTarget('world-model-add-biological-type'), preventDefault() {}})
  await clickCollection('world-model-save-biological-type', {
    bioweaveWorldModelCollectionKind: 'biological-type',
    bioweaveWorldSpeciesIndex: '1',
  }, '类型 B')
  assert.deepEqual(currentModel.species[1].biological_types.map(item => item.name), ['类型 B'])
  await click({target: nestedActionTarget('world-model-edit-biological-type'), preventDefault() {}})
  assert.match(root.querySelector('.bioweave-main').innerHTML, /value="类型 B"/)
  await clickCollection('world-model-save-biological-type', {
    bioweaveWorldModelCollectionKind: 'biological-type',
    bioweaveWorldSpeciesIndex: '1',
  }, '类型 B2', {mode: 'edit', typeIndex: '0'})
  assert.equal(currentModel.species[1].biological_types[0].name, '类型 B2')
  await click({target: nestedActionTarget('world-model-edit-species'), preventDefault() {}})
  assert.match(root.querySelector('.bioweave-main').innerHTML, /value="种族 B"/)
  await clickCollection('world-model-save-species', {bioweaveWorldModelCollectionKind: 'species'}, '高等种族 B', {mode: 'edit'})
  assert.equal(currentModel.species[1].name, '高等种族 B')
  assert.equal(currentModel.species[1].biological_types[0].name, '类型 B2')
  const renameSaveCalls = saveCalls
  await click({target: nestedActionTarget('world-model-edit-species'), preventDefault() {}})
  await clickCollection('world-model-save-species', {bioweaveWorldModelCollectionKind: 'species'}, '种族 A', {mode: 'edit'})
  assert.equal(currentModel.species[1].name, '高等种族 B')
  assert.equal(saveCalls, renameSaveCalls)
  await click({target: nestedActionTarget('world-model-edit-species'), preventDefault() {}})
  await clickCollection('world-model-save-species', {bioweaveWorldModelCollectionKind: 'species'}, '   ', {mode: 'edit'})
  assert.equal(currentModel.species[1].name, '高等种族 B')
  assert.equal(saveCalls, renameSaveCalls)
  failSave = true
  await click({target: nestedActionTarget('world-model-edit-biological-type'), preventDefault() {}})
  await clickCollection('world-model-save-biological-type', {
    bioweaveWorldModelCollectionKind: 'biological-type',
    bioweaveWorldSpeciesIndex: '1',
  }, '类型 B3', {mode: 'edit', typeIndex: '0'})
  assert.equal(currentModel.species[1].biological_types[0].name, '类型 B2')
  assert.doesNotMatch(root.querySelector('.bioweave-main').innerHTML, /类型 B3/)
  failSave = false

  app.destroyBioWeave()
  const reloadDocument = new AppFakeDocument()
  reloadDocument.defaultView.toastr = documentRef.defaultView.toastr
  app = createApp(runtime, {documentRef: reloadDocument, storageRef: {}, profileStore})
  root = app.openBioWeave()
  app.go('world')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.match(root.querySelector('.bioweave-main').innerHTML, /高等种族 B/)
  assert.match(root.querySelector('.bioweave-main').innerHTML, /类型 B2/)
  click = [...root.listeners.get('click')][0]

  await click({target: nestedActionTarget('world-model-select-species', {bioweaveWorldSpeciesIndex: '0'}), preventDefault() {}})
  assert.match(root.querySelector('.bioweave-main').innerHTML, /类型 A/)
  assert.match(root.querySelector('.bioweave-main').innerHTML, /data-bioweave-action="world-model-delete-biological-type"[^>]*disabled/)
  await click({target: nestedActionTarget('world-model-select-species', {bioweaveWorldSpeciesIndex: '1'}), preventDefault() {}})
  await click({target: nestedActionTarget('world-model-select-type', {bioweaveWorldSpeciesIndex: '1', bioweaveWorldTypeIndex: '0'}), preventDefault() {}})
  await click({target: nestedActionTarget('world-model-delete-biological-type'), preventDefault() {}})
  assert.deepEqual(currentModel.species[1].biological_types, [])
  await click({target: nestedActionTarget('world-model-select-species', {bioweaveWorldSpeciesIndex: '1'}), preventDefault() {}})
  await click({target: nestedActionTarget('world-model-delete-species'), preventDefault() {}})
  assert.deepEqual(currentModel.species.map(item => item.name), ['种族 A'])
  assert.equal(currentMeta.archived_species.length, 1)
  assert.equal(currentMeta.archived_species[0].species.name, '高等种族 B')
  await click({target: nestedActionTarget('world-model-toggle-archive'), preventDefault() {}})
  assert.match(root.querySelector('.bioweave-main').innerHTML, /高等种族 B/)
  await clickCollection('world-model-save-species', {bioweaveWorldModelCollectionKind: 'species'}, '高等种族 B')
  assert.deepEqual(currentModel.species.map(item => item.name), ['种族 A'])
  assert.match(toastCalls.at(-1)[1], /归档名单/)
  await click({target: nestedActionTarget('world-model-restore-species', {bioweaveWorldArchiveIndex: '0'}), preventDefault() {}})
  assert.deepEqual(currentModel.species.map(item => item.name), ['种族 A', '高等种族 B'])
  assert.deepEqual(currentMeta.archived_species, [])

  await click({target: nestedActionTarget('world-model-select-species', {bioweaveWorldSpeciesIndex: '1'}), preventDefault() {}})
  await click({target: nestedActionTarget('world-model-delete-species'), preventDefault() {}})
  assert.equal(currentMeta.archived_species.length, 1)
  const permanentDeleteSaveCalls = saveCalls
  const refreshBeforePermanentDelete = refreshCalls
  const cancelHtml = root.querySelector('.bioweave-main').innerHTML
  await click({target: nestedActionTarget('world-model-delete-archived-species', {bioweaveWorldArchiveIndex: '0'}), preventDefault() {}})
  assert.equal(saveCalls, permanentDeleteSaveCalls)
  assert.equal(currentMeta.archived_species.length, 1)
  assert.equal(root.querySelector('.bioweave-main').innerHTML, cancelHtml)
  assert.match(confirmCalls.at(-1)[1], /后续世界分析仍可能根据证据重新发现该 Species/)
  const activeModelBeforePermanentDelete = structuredClone(currentModel)
  confirmResult = 'affirmative'
  await click({target: nestedActionTarget('world-model-delete-archived-species', {bioweaveWorldArchiveIndex: '0'}), preventDefault() {}})
  assert.equal(saveCalls, permanentDeleteSaveCalls + 1)
  assert.deepEqual(currentModel, activeModelBeforePermanentDelete)
  assert.deepEqual(currentMeta.archived_species, [])
  assert.equal(refreshCalls, refreshBeforePermanentDelete)
  assert.match(root.querySelector('.bioweave-main').innerHTML, /bioweave-world-model-archive-popover/)
  assert.doesNotMatch(root.querySelector('.bioweave-main').innerHTML, /高等种族 B/)
  assert.deepEqual(savePayloads.at(-1).model, activeModelBeforePermanentDelete)
  assert.deepEqual(savePayloads.at(-1).meta.archived_species, [])

  await click({target: nestedActionTarget('world-model-add-species'), preventDefault() {}})
  await clickCollection('world-model-save-species', {bioweaveWorldModelCollectionKind: 'species'}, '种族 C')
  await click({target: nestedActionTarget('world-model-select-species', {bioweaveWorldSpeciesIndex: '0'}), preventDefault() {}})
  await click({target: nestedActionTarget('world-model-delete-species'), preventDefault() {}})
  const permanentDeleteFailureSaveCalls = saveCalls
  failSave = true
  await click({target: nestedActionTarget('world-model-delete-archived-species', {bioweaveWorldArchiveIndex: '0'}), preventDefault() {}})
  assert.equal(saveCalls, permanentDeleteFailureSaveCalls + 1)
  assert.equal(currentMeta.archived_species.length, 1)
  assert.deepEqual(currentModel.species.map(item => item.name), ['种族 C'])
  assert.notEqual(toastCalls.at(-1)[0], 'success')
  failSave = false
  await click({target: nestedActionTarget('world-model-restore-species', {bioweaveWorldArchiveIndex: '0'}), preventDefault() {}})

  await click({target: nestedActionTarget('world-model-select-species', {bioweaveWorldSpeciesIndex: '0'}), preventDefault() {}})
  await click({target: nestedActionTarget('world-model-delete-species'), preventDefault() {}})
  failSave = true
  await clickCollection('world-model-save-species', {bioweaveWorldModelCollectionKind: 'species'}, '失败后不应显示')
  assert.deepEqual(currentModel.species.map(item => item.name), ['种族 A'])
  assert.doesNotMatch(root.querySelector('.bioweave-main').innerHTML, /失败后不应显示/)
  assert.equal(toastCalls.at(-1)[0], 'error')

  app.destroyBioWeave()
  const reloaded = createApp(runtime, {documentRef: new AppFakeDocument(), storageRef: {}, profileStore})
  const reloadedRoot = reloaded.openBioWeave()
  reloaded.go('world')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.match(reloadedRoot.querySelector('.bioweave-main').innerHTML, /种族 A/)
  assert.doesNotMatch(reloadedRoot.querySelector('.bioweave-main').innerHTML, /高等种族 B/)
  reloaded.destroyBioWeave()
})
test('worldbook source checkbox updates immediately and saves with a success Toast without a page notice', async () => {
  const documentRef = new AppFakeDocument()
  const toastCalls = []
  documentRef.defaultView.toastr = {
    success(message) {
      toastCalls.push(message)
    },
  }
  const profileStore = {
    getSettings: () => ({
      api_source: 'sillytavern',
      default_profile_id: null,
      api_profiles: {},
      assignments: {},
    }),
    getApiRequestSettings: () => ({}),
    getWorldAnalysisPrompt: () => ({}),
    getRecentStoryGlobal: () => ({ regex_rules: [] }),
  }
  let savedChat = { settings: {} }
  let saveCalls = 0
  let releaseSave
  let markSaveStarted
  const saveStarted = new Promise(resolve => {
    markSaveStarted = resolve
  })
  const runtime = {
    chat: {
      current: () => 'chat-sources',
      token: () => ({ chatId: 'chat-sources', epoch: 0 }),
      assert: () => {},
    },
    store: {
      getChat: () => savedChat,
      saveChat: async (chatId, nextChat) => {
        savedChat = nextChat
        saveCalls += 1
        if (saveCalls === 1) return
        markSaveStarted()
        await new Promise(resolve => { releaseSave = resolve })
      },
    },
    st: {
      getContext: () => ({
        chatId: 'chat-sources',
        characterId: 0,
        characters: [
          {
            avatar: 'alice.png',
            data: {
              name: '爱丽丝',
              description: '角色描述',
              first_mes: '你好',
            },
          },
        ],
      }),
      fetch: async () => ({ ok: true, json: async () => [] }),
      getRequestHeaders: () => ({}),
    },
    subscribe: () => () => {},
  }
  const app = createApp(runtime, { documentRef, storageRef: {}, profileStore })
  const root = app.openBioWeave()
  app.go('settings')
  const main = root.querySelector('.bioweave-main')
  for (let attempt = 0; attempt < 10 && !main.innerHTML.includes('st-character-card:alice.png'); attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  assert.match(main.innerHTML, /data-bioweave-analysis-source="st-character-card:alice\.png"/)
  const change = [...root.listeners.get('change')][0]
  const target = {
    __root: root,
    checked: true,
    disabled: false,
    dataset: {
      bioweaveAnalysisSource: 'st-character-card:alice.png',
      bioweaveAnalysisField: 'description',
    },
    closest(selector) {
      return selector === '[data-bioweave-analysis-source]' ? this : null
    },
  }
  const pendingSave = change({ target })
  await saveStarted
  assert.match(main.innerHTML, /data-bioweave-analysis-source="st-character-card:alice\.png"[^>]*checked/)
  assert.doesNotMatch(main.innerHTML, /class="bioweave-settings-notice"/)
  releaseSave()
  await pendingSave
  assert.deepEqual(savedChat.settings.worldbooks.selected, [
    {
      source_id: 'st-character-card:alice.png',
      field_key: 'description',
      enabled: true,
    },
  ])
  assert.deepEqual(toastCalls, ['分析来源与最近剧情设置已保存到当前 Chat。'])
  app.destroyBioWeave()
})
test('first source load snapshots current Character-owned defaults once and preserves explicit empty selections', async () => {
  const documentRef = new AppFakeDocument()
  let activeChatId = 'chat-initial'
  let savedChat = {settings: {}}
  let saveCalls = 0
  const profileStore = {
    getSettings: () => ({api_source: 'sillytavern', default_profile_id: null, api_profiles: {}, assignments: {}}),
    getApiRequestSettings: () => ({}),
    getWorldAnalysisPrompt: () => ({}),
    getRecentStoryGlobal: () => ({regex_rules: []}),
  }
  const runtime = {
    chat: {
      current: () => activeChatId,
      token: () => ({chatId: activeChatId, epoch: 0}),
      assert: token => { if (token.chatId !== activeChatId) throw new Error('STALE_CHAT') },
    },
    store: {
      getChat: () => savedChat,
      saveChat: async (_chatId, nextChat) => { saveCalls += 1; savedChat = nextChat },
    },
    st: {
      getContext: () => ({
        chatId: activeChatId,
        characterId: 0,
        characters: [{avatar: 'alice.png', data: {
          name: '爱丽丝', first_mes: '主开场白', alternate_greetings: ['备用开场白'],
          character_book: {entries: [
            {uid: 'keep-entry', comment: '普通规则', content: '保留'},
            {uid: 'excluded-entry', comment: '状态规则', content: '不默认'},
          ]},
        }}],
        chat: [{name: '爱丽丝', is_user: false, is_system: false, swipe_id: 1, swipes: ['主开场白', '备用开场白']}],
      }),
      fetch: async () => ({ok: true, json: async () => []}),
      getRequestHeaders: () => ({}),
    },
    subscribe: () => () => {},
  }
  let app = createApp(runtime, {documentRef, storageRef: {}, profileStore})
  let root = app.openBioWeave()
  app.go('settings')
  for (let attempt = 0; attempt < 20 && !root.querySelector('.bioweave-analysis-source-list')?.innerHTML.includes('keep-entry'); attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  assert.equal(saveCalls, 1)
  assert.deepEqual(savedChat.settings.worldbooks, {
    mode: 'selected_only',
    selected: [
      {source_id: 'st-character-card:alice.png', field_key: 'opening:alternate:0', enabled: true},
      {source_id: 'st-character-card:alice.png:embedded-worldbook', entry_id: 'keep-entry', enabled: true},
    ],
    selection_initialized: true,
  })
  assert.match(root.querySelector('.bioweave-main').innerHTML, /data-bioweave-analysis-field="opening:alternate:0"[^>]*checked/)
  assert.doesNotMatch(root.querySelector('.bioweave-main').innerHTML, /data-bioweave-analysis-field="opening:main"[^>]*checked/)
  savedChat = {...savedChat, settings: {...savedChat.settings, worldbooks: {...savedChat.settings.worldbooks, selected: []}}}
  app.destroyBioWeave()
  app = createApp(runtime, {documentRef: new AppFakeDocument(), storageRef: {}, profileStore})
  root = app.openBioWeave()
  app.go('settings')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(saveCalls, 1)
  savedChat = {...savedChat, settings: {...savedChat.settings, worldbooks: {...savedChat.settings.worldbooks,
    selected: [{source_id: 'st-worldbook:additional-book', entry_id: 'user-selected', enabled: true}],
  }}}
  app.destroyBioWeave()
  app = createApp(runtime, {documentRef: new AppFakeDocument(), storageRef: {}, profileStore})
  app.openBioWeave()
  app.go('settings')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(saveCalls, 1)
  assert.deepEqual(savedChat.settings.worldbooks.selected, [
    {source_id: 'st-worldbook:additional-book', entry_id: 'user-selected', enabled: true},
  ])
  app.destroyBioWeave()
})
test('first initialization waits for external character_card hydration but not additional lorebooks', async () => {
  const documentRef = new AppFakeDocument()
  let savedChat = {settings: {}}
  let saveCalls = 0
  const loadedNames = []
  const runtime = {
    chat: {
      current: () => 'chat-primary-completeness',
      token: () => ({chatId: 'chat-primary-completeness', epoch: 0}),
      assert: () => {},
    },
    store: {
      getChat: () => savedChat,
      saveChat: async (_chatId, nextChat) => { saveCalls += 1; savedChat = nextChat },
    },
    st: {
      getContext: () => ({
        chatId: 'chat-primary-completeness',
        characterId: 0,
        characters: [{avatar: 'primary-completeness.png', data: {
          name: '角色',
          first_mes: '主开场白',
          extensions: {world: 'primary-book', additional_worldbooks: ['additional-book']},
        }}],
        chat: [{name: '角色', is_user: false, is_system: false, swipe_id: 0, swipes: ['主开场白']}],
        async loadWorldInfo(name) {
          loadedNames.push(name)
          if (name === 'additional-book') throw new Error('additional should remain deferred')
          return {entries: [{uid: 'primary-entry', comment: '主书规则', content: '主书内容'}]}
        },
      }),
      fetch: async url => url === '/api/worldinfo/list'
        ? {ok: true, json: async () => [
          {file_id: 'primary-book', name: '角色卡自身世界书'},
          {file_id: 'additional-book', name: '角色附加世界书'},
        ]}
        : {ok: true, json: async () => ({entries: []})},
      getRequestHeaders: () => ({}),
    },
    subscribe: () => () => {},
  }
  const profileStore = {
    getSettings: () => ({api_source: 'sillytavern', default_profile_id: null, api_profiles: {}, assignments: {}}),
    getApiRequestSettings: () => ({}),
    getWorldAnalysisPrompt: () => ({}),
    getRecentStoryGlobal: () => ({regex_rules: []}),
  }
  const app = createApp(runtime, {documentRef, storageRef: {}, profileStore})
  const root = app.openBioWeave()
  app.go('settings')
  for (let attempt = 0; attempt < 20 && saveCalls === 0; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  assert.deepEqual(loadedNames, ['primary-book'])
  assert.equal(saveCalls, 1)
  assert.equal(savedChat.settings.worldbooks.selection_initialized, true)
  assert.deepEqual(savedChat.settings.worldbooks.selected, [
    {source_id: 'st-worldbook:primary-book', entry_id: 'primary-entry', enabled: true},
    {source_id: 'st-character-card:primary-completeness.png', field_key: 'opening:main', enabled: true},
  ])
  assert.match(root.querySelector('.bioweave-main').innerHTML, /主书规则/)
  app.destroyBioWeave()
})
test('initialized selected-only settings show external character_card entries without selecting them', async () => {
  const documentRef = new AppFakeDocument()
  const savedChat = {
    settings: {
      worldbooks: {
        mode: 'selected_only',
        selected: [],
        selection_initialized: true,
      },
    },
  }
  const loadedNames = []
  const runtime = {
    chat: {
      current: () => 'chat-external-primary',
      token: () => ({chatId: 'chat-external-primary', epoch: 0}),
      assert: () => {},
    },
    store: {
      getChat: () => savedChat,
      saveChat: async () => { throw new Error('selection should already be initialized') },
    },
    st: {
      getContext: () => ({
        chatId: 'chat-external-primary',
        characterId: 0,
        characters: [{avatar: 'external-primary.png', data: {
          name: '角色',
          description: '角色描述',
          extensions: {world: 'primary-book', additional_worldbooks: ['additional-book']},
        }}],
        async loadWorldInfo(name) {
          loadedNames.push(name)
          return {entries: [{uid: 'primary-entry', comment: '主书条目', content: '主书内容'}]}
        },
      }),
      fetch: async url => url === '/api/worldinfo/list'
        ? {ok: true, json: async () => [
          {file_id: 'primary-book', name: '角色卡自身世界书'},
          {file_id: 'additional-book', name: '角色附加世界书'},
        ]}
        : {ok: true, json: async () => ({entries: []})},
      getRequestHeaders: () => ({}),
    },
    subscribe: () => () => {},
  }
  const profileStore = {
    getSettings: () => ({api_source: 'sillytavern', default_profile_id: null, api_profiles: {}, assignments: {}}),
    getApiRequestSettings: () => ({}),
    getWorldAnalysisPrompt: () => ({}),
    getRecentStoryGlobal: () => ({regex_rules: []}),
  }
  const app = createApp(runtime, {documentRef, storageRef: {}, profileStore})
  const root = app.openBioWeave()
  app.go('settings')
  for (let attempt = 0; attempt < 20 && !root.querySelector('.bioweave-analysis-source-list')?.innerHTML.includes('主书条目'); attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  const html = root.querySelector('.bioweave-main').innerHTML
  assert.deepEqual(loadedNames, ['primary-book'])
  assert.match(html, /主书条目/)
  const primarySection = html.split('data-bioweave-analysis-source-row="st-worldbook:primary-book"')[1]?.split('data-bioweave-analysis-source-row="st-worldbook:additional-book"')[0] ?? ''
  assert.doesNotMatch(primarySection, /展开后读取这本世界书的条目/)
  const additionalSection = html.split('data-bioweave-analysis-source-row="st-worldbook:additional-book"')[1] ?? ''
  assert.match(additionalSection, /展开后读取这本世界书的条目/)
  assert.deepEqual(savedChat.settings.worldbooks.selected, [])
  app.destroyBioWeave()
})
test('failed first default selection save leaves Chat selection uninitialized and does not show defaults', async () => {
  const documentRef = new AppFakeDocument()
  let savedChat = {settings: {}}
  const runtime = {
    chat: {current: () => 'chat-save-failure', token: () => ({chatId: 'chat-save-failure'}), assert: () => {}},
    store: {
      getChat: () => savedChat,
      saveChat: async () => { throw new Error('SAVE_FAILED') },
    },
    st: {
      getContext: () => ({chatId: 'chat-save-failure', characterId: 0, characters: [{avatar: 'alice.png', data: {first_mes: '主'}}], chat: [{is_user: false, is_system: false, swipe_id: 0}]}),
      fetch: async () => ({ok: true, json: async () => []}),
      getRequestHeaders: () => ({}),
    },
    subscribe: () => () => {},
  }
  const profileStore = {getSettings: () => ({api_source: 'sillytavern', assignments: {}}), getApiRequestSettings: () => ({}), getWorldAnalysisPrompt: () => ({}), getRecentStoryGlobal: () => ({regex_rules: []})}
  const app = createApp(runtime, {documentRef, storageRef: {}, profileStore})
  const root = app.openBioWeave()
  app.go('settings')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(savedChat.settings, {})
  assert.doesNotMatch(root.querySelector('.bioweave-main').innerHTML, /data-bioweave-analysis-field="opening:main"[^>]*checked/)
  app.destroyBioWeave()
})
test('stale Character source load cannot initialize a different Chat', async () => {
  const documentRef = new AppFakeDocument()
  let activeChatId = 'chat-a'
  let runtimeListener = null
  let resolveList
  let saveCalls = 0
  const savedByChat = { 'chat-a': {settings: {}}, 'chat-b': {settings: {}} }
  const runtime = {
    chat: {
      current: () => activeChatId,
      token: () => ({chatId: activeChatId, epoch: 0}),
      assert: token => { if (token.chatId !== activeChatId) throw new Error('STALE_CHAT') },
    },
    store: {
      getChat: chatId => savedByChat[chatId],
      saveChat: async (chatId, nextChat) => { saveCalls += 1; savedByChat[chatId] = nextChat },
    },
    st: {
      getContext: () => ({chatId: activeChatId, characterId: 0, characters: [{avatar: 'alice.png', data: {first_mes: '主'}}]}),
      fetch: async () => new Promise(resolve => { resolveList = resolve }),
      getRequestHeaders: () => ({}),
    },
    subscribe: listener => { runtimeListener = listener; return () => { runtimeListener = null } },
  }
  const profileStore = {getSettings: () => ({api_source: 'sillytavern', assignments: {}}), getApiRequestSettings: () => ({}), getWorldAnalysisPrompt: () => ({}), getRecentStoryGlobal: () => ({regex_rules: []})}
  const app = createApp(runtime, {documentRef, storageRef: {}, profileStore})
  app.openBioWeave()
  app.go('settings')
  await new Promise(resolve => setTimeout(resolve, 0))
  activeChatId = 'chat-b'
  runtimeListener?.({type: 'CHAT_CHANGED', chatChanged: true})
  resolveList?.({ok: true, json: async () => []})
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(saveCalls, 0)
  assert.deepEqual(savedByChat['chat-a'].settings, {})
  assert.deepEqual(savedByChat['chat-b'].settings, {})
  app.destroyBioWeave()
})
test('analysis prompt save keeps data behavior and uses a success Toast without a page notice', async () => {
  const documentRef = new AppFakeDocument()
  const toastCalls = []
  documentRef.defaultView.toastr = {
    success(message) {
      toastCalls.push(['success', message])
    },
  }
  let savedPrompt = null
  const profileStore = {
    getSettings: () => ({
      api_source: 'sillytavern',
      default_profile_id: null,
      api_profiles: {},
      assignments: {},
    }),
    getApiRequestSettings: () => ({}),
    getAnalysisPrompt: () => savedPrompt ?? {},
    getRecentStoryGlobal: () => ({ regex_rules: [] }),
    saveAnalysisPrompt: async value => {
      savedPrompt = value
      return value
    },
  }
  const runtime = {
    chat: {
      current: () => 'chat-prompt',
      token: () => ({ chatId: 'chat-prompt', epoch: 0 }),
      assert: () => {},
    },
    store: {
      getChat: () => ({ settings: {} }),
      saveChat: async () => {},
    },
    st: {
      getContext: () => ({ chatId: 'chat-prompt', characters: [] }),
      fetch: async () => ({ ok: true, json: async () => [] }),
      getRequestHeaders: () => ({}),
    },
    subscribe: () => () => {},
  }
  const app = createApp(runtime, { documentRef, storageRef: {}, profileStore })
  const root = app.openBioWeave()
  app.go('settings')
  root.selectorNodes.set('[data-bioweave-analysis-prompt-settings]', [{}])
  root.selectorNodes.set('[data-bioweave-analysis-prompt-field="system_top"]', [{ value: 'TOP' }])
  root.selectorNodes.set('[data-bioweave-analysis-prompt-field="task"]', [{ value: 'TASK' }])
  root.selectorNodes.set('[data-bioweave-analysis-prompt-field="input_prefix"]', [{ value: '' }])
  root.selectorNodes.set('[data-bioweave-analysis-prompt-field="input_suffix"]', [{ value: '' }])
  root.selectorNodes.set('[data-bioweave-analysis-prompt-field="system_bottom"]', [{ value: 'BOTTOM' }])
  const click = [...root.listeners.get('click')][0]
  await click({
    target: {
      __root: root,
      dataset: { bioweaveAction: 'save-analysis-prompt' },
      closest(selector) {
        return selector.includes('[data-bioweave-action]') ? this : null
      },
    },
    preventDefault() {},
    stopPropagation() {},
  })
  assert.deepEqual(savedPrompt, {
    system_top: 'TOP',
    task: 'TASK',
    input_prefix: '',
    input_suffix: '',
    system_bottom: 'BOTTOM',
    labels: {
      character: '角色卡',
      worldbooks: '世界书',
      recent_story: '最近剧情',
      external_memory: '外部记忆',
    },
  })
  assert.deepEqual(toastCalls, [['success', '分析提示词设置已保存。']])
  assert.doesNotMatch(root.querySelector('.bioweave-main').innerHTML, /class="bioweave-settings-notice"/)
  app.destroyBioWeave()
})
test('extensions menu entry opens synchronously without cancelling the host click', () => {
  const { documentRef, menu } = createMenuDocument()
  let openCalls = 0
  const unregister = registerHostEntry(
    () => {
      openCalls += 1
    },
    documentRef,
    null,
  )
  const entry = documentRef.getElementById('bioweave-extensions-menu-entry')
  assert.equal(entry.parentElement, menu)
  assert.equal(entry.className, 'bioweave-menu-entry list-group-item flex-container flexGap5')
  assert.match(entry.innerHTML, /class="fa-solid fa-dna extensionsMenuExtensionButton"/)
  const event = entry.dispatch('click')
  assert.equal(event.defaultPrevented, false)
  assert.equal(openCalls, 1)
  assert.equal(entry.dispatch('keydown', { key: 'Enter' }).defaultPrevented, false)
  assert.equal(openCalls, 2)
  assert.equal(entry.dispatch('keydown', { key: ' ' }).defaultPrevented, false)
  assert.equal(openCalls, 3)
  entry.dispatch('keydown', { key: 'Escape' })
  assert.equal(openCalls, 3)
  assert.equal(documentRef.body.clickCount, 0)
  unregister()
  assert.equal(documentRef.getElementById('bioweave-extensions-menu-entry'), null)
})
test('extensions menu recreation restores one entry and destroy prevents re-registration', () => {
  const { documentRef, menu: oldMenu } = createMenuDocument()
  const unregister = registerHostEntry(
    () => {},
    documentRef,
    FakeMutationObserver,
  )
  const oldEntry = documentRef.getElementById('bioweave-extensions-menu-entry')
  oldEntry.dataset.bioweaveOwned = 'true'
  const duplicate = documentRef.createElement('div')
  duplicate.id = 'bioweave-extensions-menu-entry'
  duplicate.dataset.bioweaveOwned = 'true'
  oldMenu.append(duplicate)
  FakeMutationObserver.latest.trigger()
  assert.equal(oldMenu.querySelectorAll('#bioweave-extensions-menu-entry').length, 1)
  oldMenu.remove()
  const newMenu = documentRef.createElement('div')
  newMenu.id = 'extensionsMenu'
  documentRef.body.append(newMenu)
  FakeMutationObserver.latest.trigger()
  assert.equal(newMenu.querySelectorAll('#bioweave-extensions-menu-entry').length, 1)
  unregister()
  assert.equal(FakeMutationObserver.latest.disconnected, true)
  FakeMutationObserver.latest.trigger()
  assert.equal(newMenu.querySelectorAll('#bioweave-extensions-menu-entry').length, 0)
})
test('menu re-registration retires the stale handler and observer', () => {
  const { documentRef } = createMenuDocument()
  let firstCalls = 0
  let secondCalls = 0
  const firstUnregister = registerHostEntry(
    () => {
      firstCalls += 1
    },
    documentRef,
    FakeMutationObserver,
  )
  const firstObserver = FakeMutationObserver.latest
  const secondUnregister = registerHostEntry(
    () => {
      secondCalls += 1
    },
    documentRef,
    FakeMutationObserver,
  )
  documentRef.getElementById('bioweave-extensions-menu-entry').dispatch('click')
  assert.equal(firstCalls, 0)
  assert.equal(secondCalls, 1)
  firstObserver.trigger()
  documentRef.getElementById('bioweave-extensions-menu-entry').dispatch('click')
  assert.equal(firstObserver.disconnected, true)
  assert.equal(firstCalls, 0)
  assert.equal(secondCalls, 2)
  firstUnregister()
  assert.notEqual(documentRef.getElementById('bioweave-extensions-menu-entry'), null)
  secondUnregister()
  assert.equal(documentRef.getElementById('bioweave-extensions-menu-entry'), null)
})

test('extension menu registration survives Runtime false and throw outcomes', async () => {
  for (const outcome of ['false', 'throw']) {
    onDisable()
    const {documentRef} = createMenuDocument()
    const toasts = []
    documentRef.defaultView ??= {}
    documentRef.defaultView.toastr = {error: message => toasts.push(message)}
    let destroyCalls = 0
    const runtime = {
      chat: {current: () => null},
      init: async () => {
        if (outcome === 'throw') throw new Error('RUNTIME_INIT_FAILED')
        return false
      },
      destroy: () => { destroyCalls += 1 },
    }
    const app = {
      mountBioWeave() {},
      openBioWeave() {},
      destroyBioWeave() {},
    }
    await init({
      runtimeFactory: () => runtime,
      appFactory: () => app,
      documentRef,
      observerCtor: null,
    })
    assert.notEqual(documentRef.getElementById('bioweave-extensions-menu-entry'), null, outcome)
    assert.deepEqual(toasts, ['BioWeave 初始化失败，请重新加载。'], outcome)
    assert.equal(await onActivate(), await init())
    onDisable()
    assert.equal(documentRef.getElementById('bioweave-extensions-menu-entry'), null, outcome)
    assert.equal(destroyCalls, 1, outcome)
  }
})

test('extension bootstrap passes the host document and Window context to App', async () => {
  onDisable()
  const {documentRef} = createMenuDocument()
  documentRef.defaultView = {}
  let appOptions = null
  const runtime = {
    chat: {current: () => 'chat-bootstrap-context'},
    init: async () => true,
    destroy() {},
    store: {profileStore: {getUiPreferences: () => ({})}},
  }
  const app = {
    mountBioWeave() {},
    openBioWeave() {},
    destroyBioWeave() {},
  }
  await init({
    runtimeFactory: () => runtime,
    appFactory: (_runtime, options) => {
      appOptions = options
      return app
    },
    documentRef,
    observerCtor: null,
  })
  assert.equal(appOptions.documentRef, documentRef)
  assert.equal(appOptions.windowRef, documentRef.defaultView)
  onDisable()
})

test('settings data management uses three distinct confirmations and the Runtime clear facade', async () => {
  const documentRef = new AppFakeDocument()
  const confirmCalls = []
  const clearCalls = []
  const context = {
    chatId: 'chat-data-management',
    Popup: {
      show: {
        async confirm(title, message) {
          confirmCalls.push({ title, message })
          return 'affirmative'
        },
      },
    },
    POPUP_RESULT: { AFFIRMATIVE: 'affirmative' },
  }
  const runtime = {
    chat: {
      current: () => context.chatId,
      token: () => ({ chatId: context.chatId, epoch: 1 }),
      assert: () => {},
    },
    store: {
      getChat: () => ({ settings: {} }),
      saveChat: async () => {},
    },
    st: {
      getContext: () => context,
      fetch: async () => ({ ok: true, json: async () => [] }),
      getRequestHeaders: () => ({}),
    },
    subscribe: () => () => {},
    collectActiveBusinessData: async () => ({}),
    clearCharacterData: async () => {
      clearCalls.push('character')
      return { ok: true, changed: false, persistence: { commitState: 'confirmed' } }
    },
    clearWorldData: async () => {
      clearCalls.push('world')
      return { ok: true, changed: false, persistence: { commitState: 'confirmed' } }
    },
    clearAllBioWeaveData: async () => {
      clearCalls.push('all')
      return { ok: true, changed: false, persistence: { commitState: 'confirmed' } }
    },
  }
  const app = createApp(runtime, { documentRef, storageRef: {} })
  const root = app.openBioWeave()
  app.go('settings')
  const click = [...root.listeners.get('click')][0]
  for (const action of ['clear-character-data', 'clear-world-data', 'clear-all-bioweave-data']) {
    await click({
      target: actionTarget(root, { bioweaveAction: action }),
      preventDefault() {},
    })
  }
  assert.deepEqual(clearCalls, ['character', 'world', 'all'])
  assert.equal(confirmCalls.length, 3)
  assert.equal(new Set(confirmCalls.map(call => call.message)).size, 3)
  for (const call of confirmCalls) {
    assert.match(call.message, /当前聊天/)
    assert.match(call.message, /聊天正文/)
    assert.match(call.message, /Swipe 正文/)
    assert.match(call.message, /其它插件/)
    assert.match(call.message, /API \/ Secret \/ 全局设置/)
    assert.match(call.message, /不可撤销/)
  }
  const markup = root.querySelector('.bioweave-main').innerHTML
  assert.match(markup, /data-bioweave-data-management/)
  assert.match(markup, /data-bioweave-action="clear-character-data"/)
  assert.match(markup, /data-bioweave-action="clear-world-data"/)
  assert.match(markup, /data-bioweave-action="clear-all-bioweave-data"/)
  assert.doesNotMatch(APP_SOURCE, /delete\s+[^\n]*(?:bioweave|swipe_info|extra)/i)
  app.destroyBioWeave()
})

test('data management disables every clear action while saving and never reports a failed clear as success', async () => {
  const documentRef = new AppFakeDocument()
  const toasts = []
  documentRef.defaultView.toastr = {
    success: message => toasts.push(['success', message]),
    info: message => toasts.push(['info', message]),
    error: message => toasts.push(['error', message]),
  }
  let resolveClear
  const clearPromise = new Promise(resolve => {
    resolveClear = resolve
  })
  let clearCalls = 0
  const context = {
    chatId: 'chat-data-management-busy',
    Popup: {
      show: {
        async confirm() {
          return 'affirmative'
        },
      },
    },
    POPUP_RESULT: { AFFIRMATIVE: 'affirmative' },
  }
  const runtime = {
    chat: {
      current: () => context.chatId,
      token: () => ({ chatId: context.chatId, epoch: 1 }),
      assert: () => {},
    },
    store: {
      getChat: () => ({ settings: {} }),
      saveChat: async () => {},
    },
    st: {
      getContext: () => context,
      fetch: async () => ({ ok: true, json: async () => [] }),
      getRequestHeaders: () => ({}),
    },
    subscribe: () => () => {},
    collectActiveBusinessData: async () => ({}),
    clearAllBioWeaveData: async () => {
      clearCalls += 1
      return clearPromise
    },
  }
  const app = createApp(runtime, { documentRef, storageRef: {} })
  const root = app.openBioWeave()
  app.go('settings')
  const click = [...root.listeners.get('click')][0]
  const pending = click({
    target: actionTarget(root, { bioweaveAction: 'clear-all-bioweave-data' }),
    preventDefault() {},
  })
  await Promise.resolve()
  await Promise.resolve()
  const busyMarkup = root.querySelector('.bioweave-main').innerHTML
  assert.equal(clearCalls, 1)
  assert.match(busyMarkup, /data-bioweave-action="clear-character-data"[^>]*disabled/)
  assert.match(busyMarkup, /data-bioweave-action="clear-world-data"[^>]*disabled/)
  assert.match(busyMarkup, /data-bioweave-action="clear-all-bioweave-data"[^>]*disabled[^>]*aria-busy="true"[^>]*>清除中…/)

  resolveClear({ ok: false, changed: true, error_code: 'CLEAR_SAVE_FAILED', persistence: { commitState: 'failed' } })
  await pending
  assert.equal(toasts.some(([type]) => type === 'success'), false)
  assert.deepEqual(toasts.map(([type]) => type), ['error'])
  assert.match(toasts[0][1], /失败/)
  app.destroyBioWeave()
})
