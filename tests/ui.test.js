import test from 'node:test'
import assert from 'node:assert/strict'
import { init, onActivate, onDisable } from '../index.js'
import { registerHostEntry } from '../host-entry.js'
import fs from 'node:fs'
import {
  captureScrollPositions,
  createOverlayLifecycle,
  createApp,
  createPanelDragController,
  handleAnalysisParentToggleClick,
  isConnectedToDocument,
  notify,
  restoreScrollPositions,
} from '../ui/app.js'
import { createApiProfileStore } from '../storage/store.js'
import { renderAnalysisDebugPopupContent, settingsPage } from '../ui/settings.js'
import { normalizeWorldModel } from '../ai/analyzer.js'
const STYLE_SOURCE = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8')
const FINAL_STYLE_SOURCE = STYLE_SOURCE.slice(STYLE_SOURCE.lastIndexOf('/* Last cascade layer:'))
const FINAL_RESPONSIVE_STYLE_SOURCE = STYLE_SOURCE.slice(STYLE_SOURCE.lastIndexOf('/* Final responsive correction:'))
const APP_SOURCE = fs.readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8')
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
      recent_event: null,
      failure_reason: null,
    },
  }});
  assert.match(open, /synopsis_time/);
  assert.match(open, /羲和元年五月初四 午时/);
  assert.match(open, /data-bioweave-action="refresh-story-time-debug"/);
  assert.match(open, /data-bioweave-action="copy-story-time-debug"/);
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
  assert.equal(first.overlay.parentElement, documentRef.documentElement)
  assert.equal(documentRef.body.children.length, 0)
  assert.equal(documentRef.documentElement.children.length, 2)
  assert.equal(first.overlay.children.length, 1)
  assert.equal(first.overlay.hidden, false)
  assert.equal(first.root.dataset.open, 'true')
  assert.equal(getInitialized(), 1)
  lifecycle.close()
  assert.equal(first.overlay.hidden, true)
  lifecycle.open()
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
test('analysis debug Popup exposes a safe persistence trace copy entry', () => {
  const markup = renderAnalysisDebugPopupContent({
    persistenceTrace: {
      execution: {chat_id: 'chat-trace', message_id: 'message-1', swipe_id: 0, attempt: 1, trigger: 'auto-full'},
      host_post_save_hook: 'NO_PUBLIC_POST_SAVE_HOOK',
      sequence: [{seq: 1, stage: 'WORLD_SAVE_PATH_SELECTED', path: 'official'}],
    },
  })
  const html = typeof markup === 'string' ? markup : markup.innerHTML
  assert.match(html, /复制最近一次分析诊断/)
  assert.match(html, /NO_PUBLIC_POST_SAVE_HOOK/)
  assert.doesNotMatch(html, /should-not-enter|api_key|authorization/i)
  assert.match(STYLE_SOURCE, /bioweave-persistence-trace[\s\S]*text-align:\s*left\s*!important/)
})

test('analysis debug uses the SillyTavern DISPLAY Popup and keeps preview actions local', async () => {
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
test('settings analysis debug keeps one Popup and the persisted prompt source boundary', async () => {
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
test('analysis debug shows a safe Toast and no custom modal when Popup is unavailable', async () => {
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
  const context = {
    Popup: {
      show: {
        async confirm(title, message) {
          confirmCalls.push([title, message])
          return 'negative'
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
  assert.deepEqual(confirmCalls, [['放弃未保存修改', '当前修改尚未保存，是否放弃？']])
  assert.equal(analyzeCalls, 0)
  app.destroyBioWeave()
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
        getContext: () => ({ chatId: 'chat-world-feedback', characters: [] }),
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

test('World Model collection edits persist on the current resolver and preserve metadata', async () => {
  const documentRef = new AppFakeDocument()
  const toastCalls = []
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
      if (failSave) {
        const error = new Error('WORLD_MODEL_SAVE_FAILED')
        error.code = 'WORLD_MODEL_SAVE_FAILED'
        throw error
      }
      currentModel = structuredClone(model)
      currentMeta = structuredClone(nextMeta)
    },
    refreshTrackingRegistry: async () => {},
    st: {
      getContext: () => ({chatId: 'chat-world-collections', characters: []}),
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
  assert.doesNotMatch(reloadedRoot.querySelector('.bioweave-main').innerHTML, /种族 B/)
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
