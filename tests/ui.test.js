import test from 'node:test';
import assert from 'node:assert/strict';
import {registerExtensionsMenuEntry} from '../index.js';
import fs from 'node:fs';
import {
  captureScrollPositions,
  createOverlayLifecycle,
  createApp,
  handleAnalysisParentToggleClick,
  isConnectedToDocument,
  notify,
  restoreScrollPositions,
} from '../ui/app.js';

const STYLE_SOURCE = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');

test('BioWeave overlay stays between ordinary host UI and host modal layers', () => {
  const match = STYLE_SOURCE.match(/\.bioweave-overlay\s*\{[\s\S]*?z-index:\s*(\d+)\s*;/);
  assert.ok(match, 'expected the BioWeave overlay to declare a numeric z-index');
  const zIndex = Number(match[1]);
  assert.ok(zIndex > 4100, 'BioWeave must stay above ordinary SillyTavern overlays');
  assert.ok(zIndex < 9999, 'BioWeave must stay below SillyTavern Popup/backdrop');
  assert.ok(zIndex < 999999, 'BioWeave must stay below SillyTavern Toast');
  assert.doesNotMatch(STYLE_SOURCE, /(?:#shadow_popup|#dialogue_popup|#toast-container|dialog\.popup|\.popup-backdrop)\s*\{/);
});

class FakeElement {
  constructor(documentRef, tagName = 'div') {
    this.ownerDocument = documentRef;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.hidden = false;
    this.id = '';
    this.className = '';
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

  remove() {
    this.parentElement?.removeChild(this);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type, extra = {}) {
    const event = {
      type,
      target: this,
      key: extra.key,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    return event;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = node => {
      for (const child of node.children) {
        if (selector.startsWith('#') && child.id === selector.slice(1)) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

class FakeDocument {
  constructor() {
    this.documentElement = new FakeElement(this, 'html');
    this.body = new FakeElement(this, 'body');
    this.documentElement.append(this.body);
    this.body.clickCount = 0;
    this.body.click = () => {
      this.body.clickCount += 1;
    };
  }

  createElement(tagName) {
    return new FakeElement(this, tagName);
  }

  querySelectorAll(selector) {
    return this.documentElement.querySelectorAll(selector);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  getElementById(id) {
    return this.querySelector('#' + id);
  }
}

class AppFakeElement extends FakeElement {
  constructor(documentRef, tagName = 'div') {
    super(documentRef, tagName);
    this._innerHTML = '';
    this.selectorNodes = new Map();
    this.classList = {
      toggle: (name, force) => {
        const names = new Set(this.className.split(/\s+/).filter(Boolean));
        if (force) names.add(name);
        else names.delete(name);
        this.className = [...names].join(' ');
      },
    };
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    if (this.className.includes('bioweave-root') && this._innerHTML.includes('bioweave-main')) this.buildAppShell();
  }

  get innerHTML() {
    return this._innerHTML;
  }

  buildAppShell() {
    if (this.children.length) return;
    const add = (selector, tagName) => {
      const node = new AppFakeElement(this.ownerDocument, tagName);
      this.append(node);
      this.selectorNodes.set(selector, [node]);
      return node;
    };
    add('.bioweave-nav nav', 'nav');
    add('.bioweave-bottom', 'nav');
    add('.bioweave-main', 'main');
    add('.bioweave-more-menu', 'div');
  }

  querySelectorAll(selector) {
    return this.selectorNodes.get(selector) ?? [];
  }

  querySelector(selector) {
    return this.selectorNodes.get(selector)?.[0] ?? null;
  }

  contains(node) {
    if (node === this || node?.__root === this) return true;
    let current = node;
    while (current?.parentElement) {
      if (current.parentElement === this) return true;
      current = current.parentElement;
    }
    return false;
  }
}

class AppFakeDocument extends FakeDocument {
  constructor() {
    super();
    this.defaultView = {};
  }

  createElement(tagName) {
    return new AppFakeElement(this, tagName);
  }
}

class FakeMutationObserver {
  static latest = null;

  constructor(callback) {
    this.callback = callback;
    this.disconnected = false;
    FakeMutationObserver.latest = this;
  }

  observe() {}

  disconnect() {
    this.disconnected = true;
  }

  trigger() {
    if (!this.disconnected) this.callback([]);
  }
}

function createMenuDocument() {
  const documentRef = new FakeDocument();
  const menu = documentRef.createElement('div');
  menu.id = 'extensionsMenu';
  documentRef.body.append(menu);
  return {documentRef, menu};
}

function createTestLifecycle(documentRef) {
  let initialized = 0;
  let tornDown = 0;
  const lifecycle = createOverlayLifecycle({
    documentRef,
    createOverlay: documentRefRef => documentRefRef.createElement('div'),
    createRoot: documentRefRef => documentRefRef.createElement('section'),
    initializeRoot: () => {
      initialized += 1;
    },
    teardownRoot: () => {
      tornDown += 1;
    },
  });
  return {
    lifecycle,
    getInitialized: () => initialized,
    getTornDown: () => tornDown,
  };
}

test('overlay lifecycle keeps one root and reopens after close', () => {
  const documentRef = new FakeDocument();
  const {lifecycle, getInitialized} = createTestLifecycle(documentRef);

  const first = lifecycle.open();
  assert.equal(first.overlay.parentElement, documentRef.documentElement);
  assert.equal(documentRef.body.children.length, 0);
  assert.equal(documentRef.documentElement.children.length, 2);
  assert.equal(first.overlay.children.length, 1);
  assert.equal(first.overlay.hidden, false);
  assert.equal(first.root.dataset.open, 'true');
  assert.equal(getInitialized(), 1);

  lifecycle.close();
  assert.equal(first.overlay.hidden, true);
  lifecycle.open();
  assert.equal(lifecycle.getRoot(), first.root);
  assert.equal(documentRef.body.children.length, 0);
  assert.equal(getInitialized(), 1);
});

test('detached root is discarded and recreated, then destroy removes overlay', () => {
  const documentRef = new FakeDocument();
  const {lifecycle, getTornDown} = createTestLifecycle(documentRef);
  const first = lifecycle.mount();
  first.root.remove();
  assert.equal(isConnectedToDocument(first.root, documentRef), false);

  const second = lifecycle.open();
  assert.notEqual(second.root, first.root);
  assert.equal(second.overlay.parentElement, documentRef.documentElement);
  assert.equal(documentRef.body.children.length, 0);
  assert.equal(second.overlay.children.length, 1);
  assert.equal(getTornDown(), 1);

  lifecycle.destroy();
  lifecycle.destroy();
  assert.equal(documentRef.body.children.length, 0);
  assert.equal(documentRef.documentElement.children.length, 1);
  assert.equal(documentRef.getElementById('bioweave-overlay'), null);
  assert.equal(getTornDown(), 2);
});

test('worldbook parent checkbox keeps native toggle and does not toggle disclosure', async () => {
  const details = {open: false, isConnected: true};
  const target = {
    // 模拟浏览器 click 事件进入监听器时 checkbox 已经完成预激活。
    checked: true,
    indeterminate: false,
    disabled: false,
    dataset: {bioweaveAnalysisWorldbookToggle: 'st-worldbook:alpha'},
    closest(selector) {
      return selector === 'details' ? details : this;
    },
  };
  let prevented = false;
  let stopped = false;
  const handled = handleAnalysisParentToggleClick({
    target,
    preventDefault() {
      prevented = true;
    },
    stopPropagation() {
      stopped = true;
    },
  });

  assert.equal(handled, true);
  assert.equal(prevented, false);
  assert.equal(stopped, true);
  assert.equal(target.checked, true);
  assert.equal(target.indeterminate, false);
  details.open = true;
  await Promise.resolve();
  assert.equal(details.open, false);
});

test('render scroll helper restores main and worldbook list positions', () => {
  const nodes = new Map([
    ['.bioweave-main', {scrollTop: 123, scrollLeft: 7}],
    ['[data-bioweave-analysis-source-list]', {scrollTop: 456, scrollLeft: 11}],
  ]);
  const root = {
    querySelector(selector) {
      return nodes.get(selector) ?? null;
    },
  };

  const positions = captureScrollPositions(root);
  nodes.set('.bioweave-main', {scrollTop: 0, scrollLeft: 0});
  nodes.set('[data-bioweave-analysis-source-list]', {scrollTop: 0, scrollLeft: 0});
  restoreScrollPositions(root, positions);

  assert.deepEqual(nodes.get('.bioweave-main'), {scrollTop: 123, scrollLeft: 7});
  assert.deepEqual(nodes.get('[data-bioweave-analysis-source-list]'), {scrollTop: 456, scrollLeft: 11});
});

test('notify dispatches each toastr method and trims empty messages', () => {
  const calls = [];
  const documentRef = {
    defaultView: {
      toastr: Object.fromEntries(['success', 'info', 'warning', 'error'].map(type => [
        type,
        message => calls.push([type, message]),
      ])),
    },
  };

  notify('  已保存。  ', 'success', documentRef);
  notify('说明。', 'info', documentRef);
  notify('注意。', 'warning', documentRef);
  notify('失败。', 'error', documentRef);
  notify('   ', 'error', documentRef);

  assert.deepEqual(calls, [
    ['success', '已保存。'],
    ['info', '说明。'],
    ['warning', '注意。'],
    ['error', '失败。'],
  ]);
});

test('notify survives a throwing host toastr method and uses prefixed console fallback', () => {
  const previousToastr = globalThis.toastr;
  const previousConsole = globalThis.console;
  const consoleCalls = [];
  let attempts = 0;
  const throwingToastr = {
    error() {
      attempts += 1;
      throw new Error('broken toastr');
    },
  };
  globalThis.toastr = throwingToastr;
  globalThis.console = {
    error(message) {
      consoleCalls.push(message);
    },
  };

  try {
    notify('保存失败。', 'error', {
      defaultView: {
        toastr: throwingToastr,
      },
    });
    assert.equal(attempts, 1);
    assert.deepEqual(consoleCalls, ['[BioWeave] 保存失败。']);
  } finally {
    if (previousToastr === undefined) delete globalThis.toastr;
    else globalThis.toastr = previousToastr;
    globalThis.console = previousConsole;
  }
});

test('notify falls back to the global toastr and then typed console methods', () => {
  const previousToastr = globalThis.toastr;
  const previousConsole = globalThis.console;
  const toastrCalls = [];
  const consoleCalls = [];
  globalThis.toastr = {
    warning(message) {
      toastrCalls.push(['warning', message]);
    },
  };
  globalThis.console = {
    error(message) {
      consoleCalls.push(['error', message]);
    },
    warn(message) {
      consoleCalls.push(['warn', message]);
    },
    log(message) {
      consoleCalls.push(['log', message]);
    },
  };

  try {
    notify('来源刷新完成。', 'warning', {defaultView: {toastr: {}}});
    notify('保存失败。', 'error', {defaultView: {}});
    notify('说明。', 'info', {defaultView: {}});
    assert.deepEqual(toastrCalls, [['warning', '来源刷新完成。']]);
    assert.deepEqual(consoleCalls, [['error', '[BioWeave] 保存失败。'], ['log', '[BioWeave] 说明。']]);
  } finally {
    if (previousToastr === undefined) delete globalThis.toastr;
    else globalThis.toastr = previousToastr;
    globalThis.console = previousConsole;
  }
});

test('settings API source and default profile keep fallback values without host setters', async () => {
  const documentRef = new AppFakeDocument();
  const toastCalls = [];
  documentRef.defaultView.toastr = {
    success(message) {
      toastCalls.push(message);
    },
  };
  const profileStore = {
    getSettings: () => ({api_source: 'sillytavern', default_profile_id: null, api_profiles: {}, assignments: {}}),
    getApiRequestSettings: () => ({}),
    getWorldAnalysisPrompt: () => ({}),
    getRecentStoryGlobal: () => ({regex_rules: []}),
  };
  const runtime = {
    chat: {
      current: () => 'chat-1',
      token: () => ({chatId: 'chat-1', epoch: 0}),
      assert: () => {},
    },
    store: {
      getChat: () => ({settings: {}}),
      saveChat: async () => {},
    },
    st: {
      getContext: () => ({chatId: 'chat-1', characters: []}),
      fetch: async () => ({ok: true, json: async () => ({})}),
      getRequestHeaders: () => ({}),
    },
    subscribe: () => () => {},
  };
  const app = createApp(runtime, {documentRef, storageRef: {}, profileStore});
  const root = app.mountBioWeave();
  app.go('settings');

  const change = [...root.listeners.get('change')][0];
  const dispatchChange = async (value, selector) => {
    const target = {
      __root: root,
      value,
      dataset: {},
      closest(candidate) {
        return candidate === selector ? this : null;
      },
    };
    await change({target});
  };

  await dispatchChange('bioweave', '[data-bioweave-api-source]');
  await dispatchChange('profile-1', '[data-bioweave-default-profile]');

  assert.equal(app.getSettingsState().apiSource, 'bioweave');
  assert.equal(app.getSettingsState().defaultProfileId, 'profile-1');
  assert.deepEqual(toastCalls, ['默认 API 来源已保存。', '默认 API 配置已保存。']);
  app.destroyBioWeave();
});

test('analysis debug uses the SillyTavern DISPLAY Popup and keeps preview actions local', async () => {
  const documentRef = new AppFakeDocument();
  const popupCalls = [];
  let resolvePopup;
  class Popup {
    constructor(content, type, title, options) {
      popupCalls.push({content, type, title, options});
    }

    show() {
      return new Promise(resolve => {
        resolvePopup = resolve;
      });
    }
  }
  const profileStore = {
    getSettings: () => ({api_source: 'sillytavern', default_profile_id: null, api_profiles: {}, assignments: {}}),
    getApiRequestSettings: () => ({}),
    getWorldAnalysisPrompt: () => ({}),
    getRecentStoryGlobal: () => ({regex_rules: []}),
  };
  const runtime = {
    chat: {
      current: () => 'chat-debug',
      token: () => ({chatId: 'chat-debug', epoch: 0}),
      assert: () => {},
    },
    store: {
      getChat: () => ({settings: {}}),
      saveChat: async () => {},
    },
    st: {
      getContext: () => ({
        chatId: 'chat-debug',
        characters: [],
        Popup,
        POPUP_TYPE: {DISPLAY: 'display'},
        POPUP_RESULT: {AFFIRMATIVE: 'yes', NEGATIVE: 'no'},
      }),
      fetch: async () => ({ok: true, json: async () => []}),
      getRequestHeaders: () => ({}),
    },
    subscribe: () => () => {},
  };
  const app = createApp(runtime, {documentRef, storageRef: {}, profileStore});
  const root = app.openBioWeave();
  app.go('settings');
  await new Promise(resolve => setTimeout(resolve, 0));

  const click = [...root.listeners.get('click')][0];
  const actionTarget = action => ({
    __root: root,
    dataset: {bioweaveAction: action},
    closest(selector) {
      return selector.includes('[data-bioweave-action]') ? this : null;
    },
  });
  const clickAction = async action => {
    await click({
      target: actionTarget(action),
      preventDefault() {},
      stopPropagation() {},
    });
  };

  const openPromise = clickAction('open-analysis-debug');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(popupCalls.length, 1);
  assert.equal(popupCalls[0].type, 'display');
  assert.equal(popupCalls[0].title, '');
  assert.deepEqual(popupCalls[0].options, {wide: true, allowVerticalScrolling: true});
  assert.equal(popupCalls[0].content.ownerDocument, documentRef);
  assert.match(popupCalls[0].content.innerHTML, /data-bioweave-analysis-preview/);

  const popupContent = popupCalls[0].content;
  const popupClick = [...popupContent.listeners.get('click')][0];
  const popupActionTarget = (action, mode = undefined) => ({
    __root: popupContent,
    dataset: {
      bioweaveAction: action,
      ...(mode ? {bioweavePreviewMode: mode} : {}),
    },
    closest(selector) {
      return selector.includes('[data-bioweave-action]') ? this : null;
    },
  });
  await popupClick({
    target: popupActionTarget('refresh-analysis-preview'),
    preventDefault() {},
  });
  assert.match(popupContent.innerHTML, /data-bioweave-analysis-preview/);
  assert.match(popupContent.innerHTML, /data-bioweave-world-model-message-preview/);
  await popupClick({
    target: popupActionTarget('analysis-preview-mode', 'raw'),
    preventDefault() {},
  });
  assert.match(popupContent.innerHTML, /bioweave-analysis-preview-raw/);

  resolvePopup();
  await openPromise;
  assert.equal(root.dataset.open, 'true');
  const keydown = [...root.listeners.get('keydown')][0];
  keydown({key: 'Escape', preventDefault() {}});
  assert.equal(root.dataset.open, 'false');
  app.destroyBioWeave();
});

test('settings and World Model analysis debug actions share one Popup and prompt source boundary', async () => {
  const documentRef = new AppFakeDocument();
  const popupCalls = [];
  let resolvePopup;
  class Popup {
    constructor(content, type, title, options) {
      popupCalls.push({content, type, title, options});
    }

    show() {
      return new Promise(resolve => {
        resolvePopup = resolve;
      });
    }
  }
  const savedPrompt = {
    system_top: 'SAVED TOP',
    task: 'SAVED TASK',
    input_prefix: '',
    input_suffix: '',
    system_bottom: 'SAVED BOTTOM',
  };
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
    getRecentStoryGlobal: () => ({regex_rules: []}),
  };
  const runtime = {
    chat: {
      current: () => 'chat-debug-shared',
      token: () => ({chatId: 'chat-debug-shared', epoch: 0}),
      assert: () => {},
    },
    store: {
      getChat: () => ({settings: {}}),
      saveChat: async () => {},
    },
    st: {
      getContext: () => ({
        chatId: 'chat-debug-shared',
        characters: [],
        Popup,
        POPUP_TYPE: {DISPLAY: 'display'},
      }),
      fetch: async () => ({ok: true, json: async () => []}),
      getRequestHeaders: () => ({}),
    },
    subscribe: () => () => {},
  };
  const app = createApp(runtime, {documentRef, storageRef: {}, profileStore});
  const root = app.openBioWeave();
  app.go('settings');
  await new Promise(resolve => setTimeout(resolve, 0));

  const promptForm = {};
  root.selectorNodes.set('[data-bioweave-world-analysis-prompt-settings]', [promptForm]);
  for (const [key, value] of Object.entries({
    system_top: 'DRAFT TOP',
    task: 'DRAFT TASK',
    input_prefix: '',
    input_suffix: '',
    system_bottom: 'DRAFT BOTTOM',
  })) {
    root.selectorNodes.set(`[data-bioweave-world-analysis-prompt-field="${key}"]`, [{value}]);
  }

  const click = [...root.listeners.get('click')][0];
  const actionTarget = action => ({
    __root: root,
    dataset: {bioweaveAction: action},
    closest(selector) {
      return selector.includes('[data-bioweave-action]') ? this : null;
    },
  });
  const clickAction = async action => {
    await click({
      target: actionTarget(action),
      preventDefault() {},
      stopPropagation() {},
    });
  };

  const settingsOpen = clickAction('open-analysis-debug');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(popupCalls.length, 1);
  const settingsPopup = popupCalls[0];
  assert.equal(settingsPopup.type, 'display');
  assert.equal(settingsPopup.title, '');
  assert.deepEqual(settingsPopup.options, {wide: true, allowVerticalScrolling: true});
  const popupActionTarget = (content, action, mode = undefined) => ({
    __root: content,
    dataset: {
      bioweaveAction: action,
      ...(mode ? {bioweavePreviewMode: mode} : {}),
    },
    closest(selector) {
      return selector.includes('[data-bioweave-action]') ? this : null;
    },
  });
  const settingsPopupClick = [...settingsPopup.content.listeners.get('click')][0];
  await settingsPopupClick({
    target: popupActionTarget(settingsPopup.content, 'refresh-analysis-preview'),
    preventDefault() {},
  });
  assert.match(settingsPopup.content.innerHTML, /DRAFT TOP/);
  assert.match(settingsPopup.content.innerHTML, /DRAFT BOTTOM/);
  assert.match(settingsPopup.content.innerHTML, /data-bioweave-world-model-message-preview/);
  resolvePopup();
  await settingsOpen;

  app.go('world');
  const worldPageMarkup = root.querySelector('.bioweave-main').innerHTML;
  const worldOpen = clickAction('world-model-view-input');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(root.querySelector('.bioweave-main').innerHTML, worldPageMarkup);
  assert.equal(popupCalls.length, 2);
  const worldPopup = popupCalls[1];
  assert.equal(worldPopup.type, settingsPopup.type);
  assert.equal(worldPopup.title, settingsPopup.title);
  assert.deepEqual(worldPopup.options, settingsPopup.options);
  assert.match(worldPopup.content.innerHTML, /SAVED TOP/);
  assert.match(worldPopup.content.innerHTML, /SAVED BOTTOM/);
  assert.doesNotMatch(worldPopup.content.innerHTML, /DRAFT TOP|DRAFT BOTTOM/);
  assert.match(worldPopup.content.innerHTML, /data-bioweave-analysis-preview/);
  assert.match(worldPopup.content.innerHTML, /data-bioweave-world-model-message-preview/);
  const worldPopupClick = [...worldPopup.content.listeners.get('click')][0];
  await worldPopupClick({
    target: popupActionTarget(worldPopup.content, 'refresh-analysis-preview'),
    preventDefault() {},
  });
  assert.match(worldPopup.content.innerHTML, /data-bioweave-world-model-message-preview/);
  await worldPopupClick({
    target: popupActionTarget(worldPopup.content, 'analysis-preview-mode', 'raw'),
    preventDefault() {},
  });
  assert.match(worldPopup.content.innerHTML, /bioweave-analysis-preview-raw/);
  resolvePopup();
  await worldOpen;
  app.destroyBioWeave();
});

test('analysis debug shows a safe Toast and no custom modal when Popup is unavailable', async () => {
  const documentRef = new AppFakeDocument();
  const toastCalls = [];
  documentRef.defaultView.toastr = {error: message => toastCalls.push(message)};
  const profileStore = {
    getSettings: () => ({api_source: 'sillytavern', default_profile_id: null, api_profiles: {}, assignments: {}}),
    getApiRequestSettings: () => ({}),
    getWorldAnalysisPrompt: () => ({}),
    getRecentStoryGlobal: () => ({regex_rules: []}),
  };
  const runtime = {
    chat: {current: () => 'chat-no-popup', token: () => ({chatId: 'chat-no-popup'}), assert: () => {}},
    store: {getChat: () => ({settings: {}}), saveChat: async () => {}},
    st: {getContext: () => ({chatId: 'chat-no-popup'}), fetch: async () => ({ok: true, json: async () => []}), getRequestHeaders: () => ({})},
    subscribe: () => () => {},
  };
  const app = createApp(runtime, {documentRef, storageRef: {}, profileStore});
  const root = app.openBioWeave();
  app.go('settings');
  const click = [...root.listeners.get('click')][0];
  await click({
    target: {
      __root: root,
      dataset: {bioweaveAction: 'open-analysis-debug'},
      closest(selector) { return selector.includes('[data-bioweave-action]') ? this : null; },
    },
    preventDefault() {},
  });
  assert.deepEqual(toastCalls, ['高级 / 调试窗口暂不可用，请确认 SillyTavern Popup 已加载。']);
  assert.doesNotMatch(root.querySelector('.bioweave-main').innerHTML, /bioweave-analysis-debug-overlay/);
  app.destroyBioWeave();
});

test('API profile deletion uses Popup.show.confirm and cancels on a negative result', async () => {
  const documentRef = new AppFakeDocument();
  const confirmCalls = [];
  const toastCalls = [];
  let confirmResult = 'negative';
  let deleted = false;
  const context = {
    Popup: {
      show: {
        async confirm(title, message) {
          confirmCalls.push([title, message]);
          return confirmResult;
        },
      },
    },
    POPUP_RESULT: {AFFIRMATIVE: 'affirmative', NEGATIVE: 'negative'},
  };
  documentRef.defaultView.toastr = {success: message => toastCalls.push(message)};
  const profileStore = {
    getSettings: () => ({
      api_source: 'bioweave',
      default_profile_id: 'profile-1',
      api_profiles: deleted ? {} : { 'profile-1': {profile_id: 'profile-1', name: '配置一'} },
      assignments: {},
    }),
    getApiRequestSettings: () => ({}),
    getWorldAnalysisPrompt: () => ({}),
    getRecentStoryGlobal: () => ({regex_rules: []}),
    deleteProfile: async id => {
      deleted = id === 'profile-1';
    },
  };
  const runtime = {
    chat: {current: () => 'chat-delete', token: () => ({chatId: 'chat-delete'}), assert: () => {}},
    store: {getChat: () => ({settings: {}}), saveChat: async () => {}},
    st: {getContext: () => context, fetch: async () => ({ok: true, json: async () => []}), getRequestHeaders: () => ({})},
    subscribe: () => () => {},
  };
  const previousConfirm = globalThis.confirm;
  globalThis.confirm = () => {
    throw new Error('native confirm must not be called');
  };
  try {
    const app = createApp(runtime, {documentRef, storageRef: {}, profileStore});
    const root = app.openBioWeave();
    app.go('settings');
    const click = [...root.listeners.get('click')][0];
    const deleteTarget = {
      __root: root,
      dataset: {bioweaveAction: 'delete-profile', profileId: 'profile-1'},
      closest(selector) {
        return selector.includes('[data-bioweave-action]') ? this : null;
      },
    };
    const event = {target: deleteTarget, preventDefault() {}};

    await click(event);
    assert.equal(deleted, false);
    assert.deepEqual(confirmCalls, [['删除 API 配置', '确定删除此 API 配置并清理关联 Secret 引用吗？']]);

    confirmResult = 'affirmative';
    await click(event);
    assert.equal(deleted, true);
    assert.equal(confirmCalls.length, 2);
    assert.deepEqual(toastCalls, ['API 配置已删除；关联 Secret 引用已清理。']);
    app.destroyBioWeave();
  } finally {
    if (previousConfirm === undefined) delete globalThis.confirm;
    else globalThis.confirm = previousConfirm;
  }
});

test('dirty World Model drafts use Popup confirmation and do not analyze after cancellation', async () => {
  const documentRef = new AppFakeDocument();
  const confirmCalls = [];
  let analyzeCalls = 0;
  const context = {
    Popup: {
      show: {
        async confirm(title, message) {
          confirmCalls.push([title, message]);
          return 'negative';
        },
      },
    },
    POPUP_RESULT: {AFFIRMATIVE: 'affirmative', NEGATIVE: 'negative'},
    chatId: 'chat-dirty-world',
    characters: [],
  };
  const model = {
    schema_version: 1,
    species: [{name: '潮汐生物', description: '描述', biological_types: []}],
    medical_context: {childbirth_difficulty: null, care_level: null, evidence: null},
    exceptions: [],
    unknowns: ['旧未知'],
  };
  const profileStore = {
    getSettings: () => ({api_source: 'sillytavern', default_profile_id: null, api_profiles: {}, assignments: {}}),
    getApiRequestSettings: () => ({}),
    getWorldAnalysisPrompt: () => ({}),
    getRecentStoryGlobal: () => ({regex_rules: []}),
  };
  const runtime = {
    chat: {current: () => 'chat-dirty-world', token: () => ({chatId: 'chat-dirty-world'}), assert: () => {}},
    store: {
      getChat: () => ({settings: {}, world_model: model}),
      saveChat: async () => {},
    },
    st: {getContext: () => context, fetch: async () => ({ok: true, json: async () => []}), getRequestHeaders: () => ({})},
    subscribe: () => () => {},
  };
  const app = createApp(runtime, {
    documentRef,
    storageRef: {},
    profileStore,
    analyzer: {analyzeWorldModel: async () => { analyzeCalls += 1; return model; }},
  });
  const root = app.openBioWeave();
  app.go('world');
  const click = [...root.listeners.get('click')][0];
  const actionTarget = (action, section = undefined) => ({
    __root: root,
    dataset: {
      bioweaveAction: action,
      ...(section ? {bioweaveWorldSection: section} : {}),
    },
    closest(selector) {
      return selector.includes('[data-bioweave-action]') ? this : null;
    },
  });

  await click({target: actionTarget('world-model-edit-section', 'unknowns'), preventDefault() {}});
  const row = {
    querySelector(selector) {
      return selector.includes('data-bioweave-world-section-field="value"') ? {value: '新未知'} : null;
    },
  };
  const form = {
    querySelectorAll(selector) {
      return selector.includes('data-bioweave-world-section-row="unknowns"') ? [row] : [];
    },
  };
  root.selectorNodes.set('[data-bioweave-world-section-form]', [form]);
  const input = [...root.listeners.get('input')][0];
  input({
    target: {
      __root: root,
      closest(selector) {
        return selector === '[data-bioweave-world-section-form]' ? form : null;
      },
    },
  });

  await click({target: actionTarget('world-model-reanalyze'), preventDefault() {}});
  assert.deepEqual(confirmCalls, [['放弃未保存修改', '当前修改尚未保存，是否放弃？']]);
  assert.equal(analyzeCalls, 0);
  app.destroyBioWeave();
});

test('worldbook source checkbox updates immediately and saves with a success Toast without a page notice', async () => {
  const documentRef = new AppFakeDocument();
  const toastCalls = [];
  documentRef.defaultView.toastr = {
    success(message) {
      toastCalls.push(message);
    },
  };
  const profileStore = {
    getSettings: () => ({api_source: 'sillytavern', default_profile_id: null, api_profiles: {}, assignments: {}}),
    getApiRequestSettings: () => ({}),
    getWorldAnalysisPrompt: () => ({}),
    getRecentStoryGlobal: () => ({regex_rules: []}),
  };
  let savedChat = {settings: {}};
  let releaseSave;
  let markSaveStarted;
  const saveStarted = new Promise(resolve => {
    markSaveStarted = resolve;
  });
  const runtime = {
    chat: {
      current: () => 'chat-sources',
      token: () => ({chatId: 'chat-sources', epoch: 0}),
      assert: () => {},
    },
    store: {
      getChat: () => savedChat,
      saveChat: async (chatId, nextChat) => {
        savedChat = nextChat;
        markSaveStarted();
        await new Promise(resolve => {
          releaseSave = resolve;
        });
      },
    },
    st: {
      getContext: () => ({
        chatId: 'chat-sources',
        characterId: 0,
        characters: [{avatar: 'alice.png', data: {name: '爱丽丝', description: '角色描述', first_mes: '你好'}}],
      }),
      fetch: async () => ({ok: true, json: async () => []}),
      getRequestHeaders: () => ({}),
    },
    subscribe: () => () => {},
  };
  const app = createApp(runtime, {documentRef, storageRef: {}, profileStore});
  const root = app.openBioWeave();
  app.go('settings');
  const main = root.querySelector('.bioweave-main');
  for (let attempt = 0; attempt < 10 && !main.innerHTML.includes('st-character-card:alice.png'); attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.match(main.innerHTML, /data-bioweave-analysis-source="st-character-card:alice\.png"/);

  const change = [...root.listeners.get('change')][0];
  const target = {
    __root: root,
    checked: true,
    disabled: false,
    dataset: {
      bioweaveAnalysisSource: 'st-character-card:alice.png',
      bioweaveAnalysisField: 'description',
    },
    closest(selector) {
      return selector === '[data-bioweave-analysis-source]' ? this : null;
    },
  };
  const pendingSave = change({target});
  await saveStarted;
  assert.match(main.innerHTML, /data-bioweave-analysis-source="st-character-card:alice\.png"[^>]*checked/);
  assert.doesNotMatch(main.innerHTML, /class="bioweave-settings-notice"/);
  releaseSave();
  await pendingSave;

  assert.deepEqual(savedChat.settings.worldbooks.selected, [{
    source_id: 'st-character-card:alice.png',
    field_key: 'description',
    enabled: true,
  }]);
  assert.deepEqual(toastCalls, ['分析来源与最近剧情设置已保存到当前 Chat。']);
  app.destroyBioWeave();
});

test('world analysis prompt save keeps data behavior and uses a success Toast without a page notice', async () => {
  const documentRef = new AppFakeDocument();
  const toastCalls = [];
  documentRef.defaultView.toastr = {
    success(message) {
      toastCalls.push(['success', message]);
    },
  };
  let savedPrompt = null;
  const profileStore = {
    getSettings: () => ({api_source: 'sillytavern', default_profile_id: null, api_profiles: {}, assignments: {}}),
    getApiRequestSettings: () => ({}),
    getWorldAnalysisPrompt: () => savedPrompt ?? {},
    getRecentStoryGlobal: () => ({regex_rules: []}),
    saveWorldAnalysisPrompt: async value => {
      savedPrompt = value;
      return value;
    },
  };
  const runtime = {
    chat: {
      current: () => 'chat-prompt',
      token: () => ({chatId: 'chat-prompt', epoch: 0}),
      assert: () => {},
    },
    store: {
      getChat: () => ({settings: {}}),
      saveChat: async () => {},
    },
    st: {
      getContext: () => ({chatId: 'chat-prompt', characters: []}),
      fetch: async () => ({ok: true, json: async () => []}),
      getRequestHeaders: () => ({}),
    },
    subscribe: () => () => {},
  };
  const app = createApp(runtime, {documentRef, storageRef: {}, profileStore});
  const root = app.openBioWeave();
  app.go('settings');
  root.selectorNodes.set('[data-bioweave-world-analysis-prompt-settings]', [{}]);
  root.selectorNodes.set('[data-bioweave-world-analysis-prompt-field="system_top"]', [{value: 'TOP'}]);
  root.selectorNodes.set('[data-bioweave-world-analysis-prompt-field="task"]', [{value: 'TASK'}]);
  root.selectorNodes.set('[data-bioweave-world-analysis-prompt-field="input_prefix"]', [{value: ''}]);
  root.selectorNodes.set('[data-bioweave-world-analysis-prompt-field="input_suffix"]', [{value: ''}]);
  root.selectorNodes.set('[data-bioweave-world-analysis-prompt-field="system_bottom"]', [{value: 'BOTTOM'}]);

  const click = [...root.listeners.get('click')][0];
  await click({
    target: {
      __root: root,
      dataset: {bioweaveAction: 'save-world-analysis-prompt'},
      closest(selector) {
        return selector.includes('[data-bioweave-action]') ? this : null;
      },
    },
    preventDefault() {},
    stopPropagation() {},
  });

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
  });
  assert.deepEqual(toastCalls, [['success', '世界分析提示词设置已保存。']]);
  assert.doesNotMatch(root.querySelector('.bioweave-main').innerHTML, /class="bioweave-settings-notice"/);
  app.destroyBioWeave();
});

test('extensions menu entry opens synchronously without cancelling the host click', () => {
  const {documentRef, menu} = createMenuDocument();
  let openCalls = 0;
  const unregister = registerExtensionsMenuEntry({
    openBioWeave() {
      openCalls += 1;
    },
  }, documentRef, null);
  const entry = documentRef.getElementById('bioweave-extensions-menu-entry');

  assert.equal(entry.parentElement, menu);
  assert.equal(entry.className, 'bioweave-menu-entry list-group-item flex-container flexGap5');
  assert.match(entry.innerHTML, /class="fa-solid fa-dna extensionsMenuExtensionButton"/);
  const event = entry.dispatch('click');
  assert.equal(event.defaultPrevented, false);
  assert.equal(openCalls, 1);
  assert.equal(entry.dispatch('keydown', {key: 'Enter'}).defaultPrevented, false);
  assert.equal(openCalls, 2);
  assert.equal(entry.dispatch('keydown', {key: ' '}).defaultPrevented, false);
  assert.equal(openCalls, 3);
  entry.dispatch('keydown', {key: 'Escape'});
  assert.equal(openCalls, 3);
  assert.equal(documentRef.body.clickCount, 0);
  unregister();
  assert.equal(documentRef.getElementById('bioweave-extensions-menu-entry'), null);
});

test('extensions menu recreation restores one entry and destroy prevents re-registration', () => {
  const {documentRef, menu: oldMenu} = createMenuDocument();
  const unregister = registerExtensionsMenuEntry({
    openBioWeave() {},
  }, documentRef, FakeMutationObserver);
  const oldEntry = documentRef.getElementById('bioweave-extensions-menu-entry');
  oldEntry.dataset.bioweaveOwned = 'true';

  const duplicate = documentRef.createElement('div');
  duplicate.id = 'bioweave-extensions-menu-entry';
  duplicate.dataset.bioweaveOwned = 'true';
  oldMenu.append(duplicate);
  FakeMutationObserver.latest.trigger();
  assert.equal(oldMenu.querySelectorAll('#bioweave-extensions-menu-entry').length, 1);

  oldMenu.remove();
  const newMenu = documentRef.createElement('div');
  newMenu.id = 'extensionsMenu';
  documentRef.body.append(newMenu);
  FakeMutationObserver.latest.trigger();
  assert.equal(newMenu.querySelectorAll('#bioweave-extensions-menu-entry').length, 1);

  unregister();
  assert.equal(FakeMutationObserver.latest.disconnected, true);
  FakeMutationObserver.latest.trigger();
  assert.equal(newMenu.querySelectorAll('#bioweave-extensions-menu-entry').length, 0);
});

test('menu re-registration retires the stale handler and observer', () => {
  const {documentRef} = createMenuDocument();
  let firstCalls = 0;
  let secondCalls = 0;
  const firstUnregister = registerExtensionsMenuEntry({
    openBioWeave() {
      firstCalls += 1;
    },
  }, documentRef, FakeMutationObserver);
  const firstObserver = FakeMutationObserver.latest;
  const secondUnregister = registerExtensionsMenuEntry({
    openBioWeave() {
      secondCalls += 1;
    },
  }, documentRef, FakeMutationObserver);

  documentRef.getElementById('bioweave-extensions-menu-entry').dispatch('click');
  assert.equal(firstCalls, 0);
  assert.equal(secondCalls, 1);

  firstObserver.trigger();
  documentRef.getElementById('bioweave-extensions-menu-entry').dispatch('click');
  assert.equal(firstObserver.disconnected, true);
  assert.equal(firstCalls, 0);
  assert.equal(secondCalls, 2);

  firstUnregister();
  assert.notEqual(documentRef.getElementById('bioweave-extensions-menu-entry'), null);
  secondUnregister();
  assert.equal(documentRef.getElementById('bioweave-extensions-menu-entry'), null);
});
