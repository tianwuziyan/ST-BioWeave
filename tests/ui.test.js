import test from 'node:test';
import assert from 'node:assert/strict';
import {registerExtensionsMenuEntry} from '../index.js';
import {
  captureScrollPositions,
  createOverlayLifecycle,
  handleAnalysisParentToggleClick,
  isConnectedToDocument,
  restoreScrollPositions,
} from '../ui/app.js';

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
