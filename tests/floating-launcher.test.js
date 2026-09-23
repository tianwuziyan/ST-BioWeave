import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeActivity} from '../runtime/activity.js';
import {
  FLOATING_LAUNCHER_ID,
  FLOATING_LAUNCHER_POSITION_KEY,
  registerFloatingLauncher,
} from '../floating-launcher.js';
import {normalizeExtensionSettings} from '../storage/schema.js';
import {createApiProfileStore} from '../storage/store.js';
import {DEFAULT_FLOATING_LAUNCHER_THEME} from '../floating-launcher-theme.js';
import {settingsPage} from '../ui/settings.js';

class FakeNode {
  constructor(documentRef, tagName = 'div') {
    this.ownerDocument = documentRef;
    this.tagName = tagName.toUpperCase();
    this.parentElement = null;
    this.children = [];
    this.listeners = new Map();
    this.style = {};
    this.dataset = {};
    this.attributes = new Map();
    this.className = '';
    this.classList = {
      toggle: (name, force) => {
        const values = new Set(this.className.split(/\s+/).filter(Boolean));
        if (force) values.add(name); else values.delete(name);
        this.className = [...values].join(' ');
      },
      add: name => this.classList.toggle(name, true),
      remove: name => this.classList.toggle(name, false),
    };
    this.offsetWidth = 48;
    this.offsetHeight = 48;
  }
  get isConnected() {
    let node = this;
    while (node.parentElement) node = node.parentElement;
    return node === this.ownerDocument.documentElement;
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parentElement?.removeChild(node);
      node.parentElement = this;
      this.children.push(node);
    }
  }
  removeChild(node) {
    const index = this.children.indexOf(node);
    if (index >= 0) this.children.splice(index, 1);
    node.parentElement = null;
  }
  remove() { this.parentElement?.removeChild(this); }
  addEventListener(type, listener) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  dispatch(type, event = {}) {
    const value = {
      type,
      target: this,
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientX: 0,
      clientY: 0,
      key: undefined,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...event,
    };
    for (const listener of this.listeners.get(type) ?? []) listener(value);
    return value;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  querySelector() { return null; }
  setPointerCapture(id) { this.captured = id; }
  releasePointerCapture(id) { if (this.captured === id) this.captured = null; }
  getBoundingClientRect() {
    const left = Number.parseFloat(this.style.left) || 0;
    const top = Number.parseFloat(this.style.top) || 0;
    return {left, top, right: left + this.offsetWidth, bottom: top + this.offsetHeight};
  }
}

class FakeWindow {
  constructor() {
    this.innerWidth = 800;
    this.innerHeight = 600;
    this.listeners = new Map();
    this.visualViewport = {width: 800, height: 600, listeners: new Map(), addEventListener: (type, fn) => this.visualViewport.listeners.set(type, fn), removeEventListener: (type, fn) => this.visualViewport.listeners.get(type) === fn && this.visualViewport.listeners.delete(type)};
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type, listener) { if (this.listeners.get(type) === listener) this.listeners.delete(type); }
  setTimeout(...args) { return setTimeout(...args); }
  clearTimeout(...args) { return clearTimeout(...args); }
}

class FakeDocument {
  constructor() {
    this.defaultView = new FakeWindow();
    this.documentElement = new FakeNode(this, 'html');
    this.body = new FakeNode(this, 'body');
    this.documentElement.append(this.body);
    this.nodes = new Map();
  }
  createElement(tagName) {
    const node = new FakeNode(this, tagName);
    const originalRemove = node.remove.bind(node);
    node.remove = () => { if (node.id) this.nodes.delete(node.id); originalRemove(); };
    return node;
  }
  getElementById(id) { return this.nodes.get(id) ?? null; }
  register(node) { if (node.id) this.nodes.set(node.id, node); }
}

function createLauncherDocument() {
  const documentRef = new FakeDocument();
  const originalAppend = documentRef.body.append.bind(documentRef.body);
  documentRef.body.append = (...nodes) => {
    originalAppend(...nodes);
    nodes.forEach(node => documentRef.register(node));
  };
  return documentRef;
}

test('Runtime Activity supports concurrent tasks and ignores cancellation as error', () => {
  const activity = createRuntimeActivity();
  activity.startActivity('event_analysis');
  activity.startActivity('world_analysis');
  assert.deepEqual(activity.getActivityState(), {
    busy: true,
    active_tasks: ['event_analysis', 'world_analysis'],
    last_result: null,
    last_error: null,
  });
  activity.finishActivity('event_analysis', 'cancelled');
  assert.equal(activity.getActivityState().busy, true);
  activity.finishActivity('world_analysis', 'error', new Error('world failed'));
  assert.deepEqual(activity.getActivityState(), {
    busy: false,
    active_tasks: [],
    last_result: 'error',
    last_error: 'world failed',
  });
  activity.startActivity('event_analysis');
  activity.finishActivity('event_analysis', 'success');
  assert.equal(activity.getActivityState().last_result, 'success');
});

test('one execution starts and finishes activity once across phase updates', () => {
  const activity = createRuntimeActivity();
  const floor_version = {
    chat_id: 'chat-activity', message_id: 'message-activity', floor: 6,
    swipe_id: 0, content_hash: 'hash-activity', message_version: 'v1:hash-activity',
  };
  const send = (state, phase) => activity.handleRuntimeEvent({
    type: 'EVENT_ANALYSIS_STATUS_CHANGED',
    chatId: 'chat-activity',
    payload: {state, phase, attempt: 3, floor_version},
  });
  assert.equal(send('running'), true);
  assert.equal(activity.getActivityState().active_tasks.length, 1);
  assert.equal(send('running', 'world_full'), false);
  assert.equal(send('running', 'event_analysis'), false);
  assert.equal(activity.getActivityState().active_tasks.length, 1);
  assert.equal(send('success'), true);
  assert.equal(activity.getActivityState().busy, false);
  activity.destroy();
});

test('failed, cancelled, and disabled terminals release their execution identity', () => {
  const activity = createRuntimeActivity();
  const floor_version = {
    chat_id: 'chat-terminal', message_id: 'message-terminal', floor: 1,
    swipe_id: 0, content_hash: 'hash-terminal', message_version: 'v1:hash-terminal',
  };
  for (const state of ['failed', 'cancelled', 'disabled']) {
    const identity = {
      type: 'EVENT_ANALYSIS_STATUS_CHANGED', chatId: 'chat-terminal',
      payload: {state: 'running', attempt: 1, floor_version},
    };
    activity.handleRuntimeEvent(identity);
    assert.equal(activity.getActivityState().busy, true);
    activity.handleRuntimeEvent({...identity, payload: {...identity.payload, state}});
    assert.equal(activity.getActivityState().busy, false);
  }
  activity.destroy();
});

test('Floating Launcher opens only on click or keyboard activation', () => {
  const documentRef = createLauncherDocument();
  let opens = 0;
  const handle = registerFloatingLauncher({openBioWeave: () => { opens += 1; }, documentRef, getActivityState: () => ({})});
  const node = documentRef.getElementById(FLOATING_LAUNCHER_ID);
  assert.ok(node);
  node.dispatch('pointerdown', {clientX: 100, clientY: 100});
  node.dispatch('pointerup', {clientX: 102, clientY: 102});
  node.dispatch('click');
  assert.equal(opens, 1);
  node.dispatch('keydown', {key: 'Enter'});
  node.dispatch('keydown', {key: ' '});
  assert.equal(opens, 3);
  handle.destroy();
  assert.equal(documentRef.getElementById(FLOATING_LAUNCHER_ID), null);
});

test('Floating Launcher drag clamps, persists the exact clamped position, and never opens', () => {
  const documentRef = createLauncherDocument();
  const storage = new Map();
  const storageRef = {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)};
  let opens = 0;
  const handle = registerFloatingLauncher({openBioWeave: () => { opens += 1; }, documentRef, storageRef, getActivityState: () => ({})});
  const node = documentRef.getElementById(FLOATING_LAUNCHER_ID);
  node.dispatch('pointerdown', {clientX: 20, clientY: 20});
  node.dispatch('pointermove', {clientX: -500, clientY: -500});
  node.dispatch('pointerup', {clientX: -500, clientY: -500});
  node.dispatch('click');
  assert.equal(opens, 0);
  const saved = JSON.parse(storage.get(FLOATING_LAUNCHER_POSITION_KEY));
  assert.equal(saved.x, 224);
  assert.equal(saved.y, 8);
  handle.destroy();
});

test('Floating Launcher drag release keeps the exact in-viewport position without edge snap', () => {
  const documentRef = createLauncherDocument();
  const storage = new Map([[FLOATING_LAUNCHER_POSITION_KEY, JSON.stringify({x: 300, y: 100})]]);
  const storageRef = {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)};
  const handle = registerFloatingLauncher({openBioWeave() {}, documentRef, storageRef});
  const node = documentRef.getElementById(FLOATING_LAUNCHER_ID);
  node.dispatch('pointerdown', {clientX: 10, clientY: 10});
  node.dispatch('pointermove', {clientX: 30, clientY: 30});
  node.dispatch('pointerup', {clientX: 30, clientY: 30});
  assert.deepEqual(JSON.parse(storage.get(FLOATING_LAUNCHER_POSITION_KEY)), {x: 320, y: 120});
  handle.destroy();
});

test('Floating Launcher ignores secondary pointers, handles cancel, and fails safe on bad position data', () => {
  const documentRef = createLauncherDocument();
  const storage = new Map([[FLOATING_LAUNCHER_POSITION_KEY, '{bad json']]);
  const storageRef = {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)};
  let opens = 0;
  const handle = registerFloatingLauncher({openBioWeave: () => { opens += 1; }, documentRef, storageRef});
  const node = documentRef.getElementById(FLOATING_LAUNCHER_ID);
  assert.equal(node.style.left, '744px');
  node.dispatch('pointerdown', {button: 2, clientX: 100, clientY: 100});
  node.dispatch('pointermove', {clientX: 300, clientY: 300});
  node.dispatch('pointerup', {clientX: 300, clientY: 300});
  assert.equal(storage.get(FLOATING_LAUNCHER_POSITION_KEY), '{bad json');
  node.dispatch('pointerdown', {clientX: 100, clientY: 100});
  node.dispatch('pointermove', {clientX: 300, clientY: 300});
  node.dispatch('pointercancel', {clientX: 300, clientY: 300});
  node.dispatch('click');
  assert.equal(opens, 0);
  handle.destroy();
});

test('Repeated Floating Launcher registration leaves one owned node and retires the old callback', () => {
  const documentRef = createLauncherDocument();
  let firstOpens = 0;
  let secondOpens = 0;
  registerFloatingLauncher({openBioWeave: () => { firstOpens += 1; }, documentRef});
  const second = registerFloatingLauncher({openBioWeave: () => { secondOpens += 1; }, documentRef});
  const node = documentRef.getElementById(FLOATING_LAUNCHER_ID);
  assert.equal(documentRef.body.children.filter(child => child.id === FLOATING_LAUNCHER_ID).length, 1);
  node.dispatch('click');
  assert.equal(firstOpens, 0);
  assert.equal(secondOpens, 1);
  second.destroy();
});

test('Floating Launcher preference false removes it and true remounts it', () => {
  const documentRef = createLauncherDocument();
  const handle = registerFloatingLauncher({openBioWeave() {}, documentRef, getPreferences: () => ({show_floating_launcher: false})});
  assert.equal(documentRef.getElementById(FLOATING_LAUNCHER_ID), null);
  handle.updatePreferences({show_floating_launcher: true});
  assert.ok(documentRef.getElementById(FLOATING_LAUNCHER_ID));
  handle.updatePreferences({show_floating_launcher: false});
  assert.equal(documentRef.getElementById(FLOATING_LAUNCHER_ID), null);
  handle.destroy();
});

test('Floating Launcher uses the default and all supported visual themes without changing its SVG DOM', () => {
  const documentRef = createLauncherDocument();
  const handle = registerFloatingLauncher({openBioWeave() {}, documentRef});
  const node = documentRef.getElementById(FLOATING_LAUNCHER_ID);
  assert.equal(node.dataset.theme, DEFAULT_FLOATING_LAUNCHER_THEME);
  assert.match(node.innerHTML, /<svg/);
  assert.match(node.innerHTML, /icon-center/);
  assert.match(node.innerHTML, /icon-arc/);
  assert.match(node.innerHTML, /icon-dot/);
  const markup = node.innerHTML;
  handle.updatePreferences({floating_launcher_theme: 'mist-violet'});
  assert.equal(node.dataset.theme, 'mist-violet');
  assert.equal(node.innerHTML, markup);
  handle.updatePreferences({floating_launcher_theme: 'deep-teal'});
  assert.equal(node.dataset.theme, 'deep-teal');
  handle.destroy();
});

test('Floating Launcher invalid theme values fail safe to midnight-indigo', () => {
  const documentRef = createLauncherDocument();
  const handle = registerFloatingLauncher({openBioWeave() {}, documentRef, getPreferences: () => ({floating_launcher_theme: 'unknown'})});
  assert.equal(documentRef.getElementById(FLOATING_LAUNCHER_ID).dataset.theme, DEFAULT_FLOATING_LAUNCHER_THEME);
  handle.updatePreferences({floating_launcher_theme: null});
  assert.equal(documentRef.getElementById(FLOATING_LAUNCHER_ID).dataset.theme, DEFAULT_FLOATING_LAUNCHER_THEME);
  handle.destroy();
});

test('Floating Launcher renders Runtime error without losing its open entry', () => {
  const documentRef = createLauncherDocument();
  let listener = null;
  const handle = registerFloatingLauncher({
    openBioWeave() {},
    documentRef,
    getActivityState: () => ({}),
    subscribeActivity: callback => {
      listener = callback;
      return () => { listener = null; };
    },
  });
  listener?.({busy: false, active_tasks: [], last_result: 'error', last_error: 'RUNTIME_INIT_FAILED'});
  const node = documentRef.getElementById(FLOATING_LAUNCHER_ID);
  assert.equal(node.dataset.state, 'error');
  assert.equal(node.getAttribute('aria-label'), 'BioWeave 分析失败');
  handle.destroy();
});

test('Floating Launcher activity states connect to DOM state and running class', () => {
  const documentRef = createLauncherDocument();
  let listener = null;
  const handle = registerFloatingLauncher({
    openBioWeave() {},
    documentRef,
    subscribeActivity: callback => { listener = callback; return () => { listener = null; }; },
  });
  const node = documentRef.getElementById(FLOATING_LAUNCHER_ID);
  listener?.({busy: true, active_tasks: ['event_analysis']});
  assert.equal(node.dataset.state, 'running');
  assert.match(node.className, /is-running/);
  listener?.({busy: false, last_result: 'success'});
  assert.equal(node.dataset.state, 'success');
  assert.doesNotMatch(node.className, /is-running/);
  listener?.({busy: false, last_result: 'error'});
  assert.equal(node.dataset.state, 'error');
  assert.doesNotMatch(node.className, /is-running/);
  listener?.({busy: false, last_result: null});
  assert.equal(node.dataset.state, 'idle');
  assert.doesNotMatch(node.className, /is-running/);
  handle.destroy();
});

test('Floating Launcher has no business-layer imports', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../floating-launcher.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bfrom\s+['"].*(?:runtime|storage|projection|event-analysis|world-model|snapshot|floor)/i);
});

test('Floating Launcher preferences are global settings and render as UI controls', () => {
  const settings = normalizeExtensionSettings({show_floating_launcher: false, floating_launcher_theme: 'mist-violet'});
  assert.equal(settings.show_floating_launcher, false);
  assert.equal(settings.floating_launcher_theme, 'mist-violet');
  assert.equal(normalizeExtensionSettings({floating_launcher_theme: 'invalid'}).floating_launcher_theme, DEFAULT_FLOATING_LAUNCHER_THEME);
  const markup = settingsPage({
    show_floating_launcher: settings.show_floating_launcher,
    floating_launcher_theme: settings.floating_launcher_theme,
  });
  assert.match(markup, /data-bioweave-ui-preference="show_floating_launcher"/);
  assert.match(markup, /data-bioweave-floating-launcher-theme/);
  assert.match(markup, /bioweave-floating-launcher-settings-controls/);
  assert.match(markup, /bioweave-floating-launcher-visibility/);
  assert.match(markup, /bioweave-floating-launcher-theme-field/);
  assert.ok(markup.indexOf('bioweave-floating-launcher-theme-field') < markup.indexOf('bioweave-floating-launcher-visibility'));
  assert.match(markup, /value="mist-violet" selected/);
  assert.match(markup, /悬浮图标/);
  assert.doesNotMatch(markup, /Floating Launcher|Edge Snap|Launcher|Snap|Show Floating Launcher/);
  const disclosureNames = [...markup.matchAll(/data-bioweave-settings-disclosure="([^"]+)"/g)].map(match => match[1]);
  assert.equal(disclosureNames.at(-2), 'floating_launcher');
  assert.equal(disclosureNames.at(-1), 'analysis_debug');
  assert.doesNotMatch(markup, /data-bioweave-settings-disclosure="story_time_debug"/);
});

test('Floating Launcher top-bar toggle and reduced-motion contract are present', async () => {
  const fs = await import('node:fs/promises');
  const appSource = await fs.readFile(new URL('../ui/app.js', import.meta.url), 'utf8');
  const styleSource = await fs.readFile(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(appSource, /data-bioweave-action="toggle-floating-launcher"/);
  assert.match(appSource, /data-bioweave-floating-toggle/);
  assert.match(appSource, /bioweave-floating-toggle-icon/);
  assert.match(appSource, /M 10 27 A 15 15 0 0 1 30 10/);
  assert.match(appSource, /切换皮肤：/);
  assert.match(appSource, /关闭悬浮窗/);
  assert.match(appSource, /打开悬浮窗/);
  assert.match(appSource, /data-bioweave-tooltip/);
  assert.match(appSource, /data-bioweave-header-tooltip/);
  assert.match(styleSource, /\.bioweave-theme-button:hover \.bioweave-header-tooltip/);
  assert.match(styleSource, /\.bioweave-floating-launcher-settings-controls\s*\{[\s\S]*?display:\s*flex;[\s\S]*?align-items:\s*center;/);
  assert.match(styleSource, /\.bioweave-settings-page \.bioweave-floating-launcher-theme-field\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*row;/);
  assert.match(styleSource, /\.bioweave-settings-page \.bioweave-floating-launcher-theme-field \.bioweave-select\s*\{[\s\S]*?width:\s*auto\s*!important;/);
  assert.match(styleSource, /display: none !important;[\s\S]*?visibility: hidden !important;/);
  assert.match(styleSource, /display: block !important;[\s\S]*?visibility: visible !important;/);
  assert.match(styleSource, /visibility: hidden !important;[\s\S]*?opacity: 0 !important/);
  assert.match(styleSource, /visibility: visible !important;[\s\S]*?opacity: 1 !important/);
  assert.match(styleSource, /\.bioweave-floating-toggle-icon\s*\{[\s\S]*?width: 22px/);
  assert.match(appSource, /setUiPreference\(key, value\)/);
  assert.match(styleSource, /\.bioweave-floating-launcher-icon\s*\{[\s\S]*?width: 26px/);
  assert.match(styleSource, /@keyframes bioweave-floating-launcher-rotate/);
  assert.match(styleSource, /prefers-reduced-motion: reduce/);
});

test('Floating Launcher theme persists through the existing global settings store', async () => {
  let globalSettings = {};
  const profileStore = createApiProfileStore({
    getGlobalSettings: () => globalSettings,
    saveGlobalSettings: async value => { globalSettings = structuredClone(value); },
  }, {secretStore: {}});
  assert.equal(profileStore.getUiPreferences().floating_launcher_theme, DEFAULT_FLOATING_LAUNCHER_THEME);
  assert.equal(Object.hasOwn(profileStore.getUiPreferences(), 'floating_launcher_snap_to_edge'), false);
  await assert.rejects(profileStore.setUiPreference('floating_launcher_snap_to_edge', true), /UI_PREFERENCE_UNKNOWN/);
  await profileStore.setUiPreference('floating_launcher_theme', 'deep-teal');
  assert.equal(globalSettings.floating_launcher_theme, 'deep-teal');
  assert.equal(profileStore.getUiPreferences().floating_launcher_theme, 'deep-teal');
  await profileStore.setUiPreference('floating_launcher_theme', 'not-a-theme');
  assert.equal(profileStore.getUiPreferences().floating_launcher_theme, DEFAULT_FLOATING_LAUNCHER_THEME);
});
