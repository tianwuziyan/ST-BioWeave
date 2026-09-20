import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createApp} from '../ui/app.js';
import {floorVersion} from '../runtime/floor.js';

class FakeElement {
  constructor(documentRef, tagName = 'div') {
    this.ownerDocument = documentRef;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.selectorNodes = new Map();
    this.hidden = false;
    this.id = '';
    this.className = '';
    this._innerHTML = '';
    this.classList = {
      toggle: (name, force) => {
        const names = new Set(this.className.split(/\s+/).filter(Boolean));
        if (force) names.add(name);
        else names.delete(name);
        this.className = [...names].join(' ');
      },
    };
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

  set innerHTML(value) {
    this._innerHTML = String(value);
    if (this.className.includes('bioweave-root') && this._innerHTML.includes('bioweave-main') && !this.children.length) {
      for (const [selector, tagName] of [
        ['.bioweave-route-items', 'div'],
        ['.bioweave-main', 'main'],
      ]) {
        const node = new FakeElement(this.ownerDocument, tagName);
        this.append(node);
        this.selectorNodes.set(selector, [node]);
      }
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  querySelector(selector) {
    return this.selectorNodes.get(selector)?.[0] ?? null;
  }

  querySelectorAll(selector) {
    return this.selectorNodes.get(selector) ?? [];
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

class FakeDocument {
  constructor() {
    this.documentElement = new FakeElement(this, 'html');
    this.body = new FakeElement(this, 'body');
    this.documentElement.append(this.body);
    this.defaultView = {toastr: {success() {}, error() {}, info() {}}};
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
}

function sourceEvent(version, overrides = {}) {
  return {
    event_id: 'evt-1',
    type: 'sexual_activity',
    status: 'confirmed',
    story_time: {
      display: '2026-08-20',
      normalized: '2026-08-20',
      day_index: 20685,
      calendar_id: 'calendar_main',
      precision: 'day',
      confidence: 1,
    },
    location: '房间',
    participants: [
      {
        character_id: 'char-a',
        display_name: 'Alice',
        event_role: 'potential_gestational_subject',
        reproductive_capabilities_used: {can_carry_pregnancy: true},
        evidence: [{kind: 'narrative', text: '明确受孕暴露'}],
      },
      {
        character_id: 'char-b',
        display_name: 'B',
        event_role: 'potential_conception_source',
        reproductive_capabilities_used: {can_cause_pregnancy: true},
        evidence: [{kind: 'narrative', text: '明确来源'}],
      },
    ],
    pregnancy_relevance: {
      relevant: true,
      possible_conception: true,
      gestational_subject_ids: ['char-a'],
      counterpart_ids: ['char-b'],
      confidence: 0.8,
    },
    source_evidence: [{kind: 'current_floor', text: '当前楼层'}],
    source: version,
    ...overrides,
  };
}

async function createFixture({event = null, analysisState = 'success', analysisBusy = false, onRefresh = null, contextOverrides = {}} = {}) {
  const documentRef = new FakeDocument();
  const toastCalls = [];
  documentRef.defaultView.toastr = {
    success(message) {
      toastCalls.push(['success', message]);
    },
    error(message) {
      toastCalls.push(['error', message]);
    },
    info(message) {
      toastCalls.push(['info', message]);
    },
    warning(message) {
      toastCalls.push(['warning', message]);
    },
  };
  const message = {floor: 10, content: '当前楼层剧情', role: 'assistant'};
  const version = await floorVersion({
    chatId: 'chat-app',
    messageId: 0,
    floor: 10,
    swipeId: 0,
    text: message.content,
  });
  const floorData = {events: event ? [event] : []};
  const chatData = {
    schema_version: 1,
    chat_scope: {chat_id: 'chat-app'},
  };
  let trackingSubjects = event ? {'char-a': {
      character_id: 'char-a', display_name: 'Alice', created_from_event_id: event.event_id,
      exposure_event_ids: [event.event_id], status: 'active',
    }} : {};
  let floor = floorData;
  let chat = chatData;
  let runtimeListener = null;
  let refreshCalls = 0;
  let abortCalls = 0;
  let currentBusy = analysisBusy;
  let updateCalls = 0;
  let deleteCalls = 0;
  const context = {chatId: 'chat-app', chat: [message], characters: [], ...contextOverrides};
  const businessData = () => ({
    tracking_subjects: trackingSubjects,
    character_profiles: event ? {'char-a': {character_id: 'char-a', display_name: 'Alice'}} : {},
    active_events: floor.events,
    current_floor: {floor: 10, message_id: 0, swipe_id: 0, version},
    last_success: analysisState === 'success' ? '2026-08-20T00:00:00.000Z' : null,
    analysis_status: {
      state: currentBusy ? 'running' : analysisState,
      busy: currentBusy,
      current_floor: {floor: 10, message_id: 0, swipe_id: 0, version},
      floor_version: version,
      last_success: analysisState === 'success' ? '2026-08-20T00:00:00.000Z' : null,
      last_error: analysisState === 'failed' ? 'JSON_SCHEMA_INVALID' : null,
      event_count: floor.events.length,
      active_event_count: floor.events.length,
      sexual_activity_count: floor.events.filter(item => item.type === 'sexual_activity').length,
      tracking_subject_count: Object.keys(trackingSubjects).length,
      current_floor_events: floor.events,
      active_events: floor.events,
      tracking_decisions: [],
      registry_summary: {tracking_subject_count: Object.keys(trackingSubjects).length},
    },
  });
  const runtime = {
    chat: {
      current: () => context.chatId,
      token: () => ({chatId: context.chatId, epoch: 0}),
      assert: token => {
        if (token.chatId !== context.chatId) throw new Error('STALE_CHAT');
      },
    },
    st: {getContext: () => context, getChat: () => context.chat},
    store: {getChat: () => chat},
    collectActiveBusinessData: async () => structuredClone(businessData()),
    async refreshCurrentFloorAnalysis() {
      refreshCalls += 1;
      if (onRefresh) await onRefresh({floor, chat, version, context});
      return {status: 'success'};
    },
    async getCurrentFloorAnalysisStatus() {
      return businessData().analysis_status;
    },
    async requestAbortCurrentFloorAnalysis() {
      abortCalls += 1;
      currentBusy = false;
      return true;
    },
    async updateEvent(eventId, next) {
      updateCalls += 1;
      const index = floor.events.findIndex(item => item.event_id === eventId);
      if (index < 0) throw new Error('EVENT_NOT_FOUND');
      floor.events[index] = structuredClone({...floor.events[index], ...next, source: floor.events[index].source});
      return floor.events[index];
    },
    async deleteEvent(eventId) {
      deleteCalls += 1;
      floor.events = floor.events.filter(item => item.event_id !== eventId);
      trackingSubjects = {};
      return true;
    },
    subscribe: listener => {
      runtimeListener = listener;
      return () => {
        if (runtimeListener === listener) runtimeListener = null;
      };
    },
  };
  const profileStore = {
    getSettings: () => ({api_source: 'sillytavern', assignments: {}}),
    getApiRequestSettings: () => ({}),
    getWorldAnalysisPrompt: () => ({}),
    getRecentStoryGlobal: () => ({regex_rules: []}),
  };
  const app = createApp(runtime, {
    documentRef,
    storageRef: {},
    profileStore,
    analyzer: {analyzeFloor: async () => { throw new Error('UI_MUST_NOT_ANALYZE_EVENTS'); }},
  });
  app.openBioWeave();
  await new Promise(resolve => setTimeout(resolve, 0));
  return {
    app,
    root: app.getRoot(),
    runtime,
    context,
    version,
    getFloor: () => floor,
    getChat: () => chat,
    documentRef,
    emit: event => runtimeListener?.(event),
    toasts: () => [...toastCalls],
    calls: () => ({refresh: refreshCalls, abort: abortCalls, update: updateCalls, delete: deleteCalls}),
  };
}

function clickTarget(action, extra = {}) {
  return {
    __root: extra.root,
    dataset: {bioweaveAction: action, ...extra},
    closest(selector) {
      return selector.includes('[data-bioweave-action]') ? this : null;
    },
  };
}

function visibleMarkup(html) {
  return html.replace(/\sdata-[\w-]+(?:="[^"]*")?/g, '');
}

test('App consumes persisted events and Tracking Registry without creating Chat-wide characters', async () => {
  const version = await floorVersion({chatId: 'chat-app', messageId: 0, floor: 10, swipeId: 0, text: '当前楼层剧情'});
  const fixture = await createFixture({event: sourceEvent(version)});
  fixture.app.go('overview');
  const overview = fixture.root.querySelector('.bioweave-main').innerHTML;
  assert.match(overview, /1<\/strong><span>追踪人物/);
  assert.match(overview, /1<\/strong><span>事件/);
  fixture.app.go('characters');
  const characters = fixture.root.querySelector('.bioweave-main').innerHTML;
  assert.match(characters, /Alice/);
  assert.match(characters, /data-character-id="char-a"/);
  assert.doesNotMatch(visibleMarkup(characters), /char-a|character_id|event_id/);
  assert.doesNotMatch(characters, /demo-character-1|演示人物/);
  fixture.app.go('events');
  const events = fixture.root.querySelector('.bioweave-main').innerHTML;
  assert.match(events, /2026-08-20/);
  assert.doesNotMatch(visibleMarkup(events), /evt-1|event_id|chat-app|message_id|content_hash|message_version/);
  assert.equal(Object.hasOwn(fixture.getChat(), 'tracking_subjects'), false);
  fixture.app.destroyBioWeave();
});

test('manual analyze action delegates to Runtime instead of the UI analyzer', async () => {
  const fixture = await createFixture({analysisState: 'not_analyzed'});
  const click = [...fixture.root.listeners.get('click')][0];
  await click({
    target: clickTarget('analyze-current-floor', {root: fixture.root}),
    preventDefault() {},
  });
  assert.equal(fixture.calls().refresh, 1);
  assert.deepEqual(fixture.toasts(), [['success', '当前楼层事件分析成功并已保存。']]);
  fixture.app.destroyBioWeave();
});

test('manual Event Analysis shows one diagnostic error Toast and does not reject the UI event', async () => {
  const originalError = Object.assign(new Error('REQUEST_TIMEOUT'), {
    code: 'REQUEST_TIMEOUT',
    diagnosticCode: 'timeout',
    timeoutSec: 3,
  });
  const fixture = await createFixture({
    analysisState: 'not_analyzed',
    onRefresh: async () => {
      throw originalError;
    },
  });
  const click = [...fixture.root.listeners.get('click')][0];
  await assert.doesNotReject(
    click({
      target: clickTarget('analyze-current-floor', {root: fixture.root}),
      preventDefault() {},
    }),
  );
  assert.deepEqual(fixture.toasts(), [
    ['error', '事件分析失败（请求超时：等待 3 秒后已在本地终止。本次未自动重试。），上一份有效事件已保留。'],
  ]);
  fixture.app.destroyBioWeave();
});

test('manual Event Analysis keeps the Runtime error object in its helper contract', () => {
  const source = readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');
  const helper = source.slice(source.indexOf('async function manualRefreshEventAnalysis()'), source.indexOf('async function requestAbortEventAnalysis()'));
  assert.match(helper, /catch \(error\) \{\s*notify\(eventAnalysisError\(error\), 'error', documentRef\)\s*throw error\s*\}/);
});

test('background Event Analysis failures update UI state without a top error Toast', async () => {
  const fixture = await createFixture({analysisState: 'not_analyzed'});
  fixture.emit({
    type: 'EVENT_ANALYSIS_STATUS_CHANGED',
    payload: {
      state: 'failed',
      error_code: 'REQUEST_TIMEOUT',
      diagnostic_code: 'timeout',
      safe_error_summary: '请求超时',
    },
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(fixture.toasts(), []);
  fixture.app.destroyBioWeave();
});

test('second Event Analysis click asks for confirmation and delegates cancellation to Runtime', async () => {
  const fixture = await createFixture({analysisBusy: true});
  fixture.context.Popup = {show: {confirm: async () => 'affirmative'}};
  fixture.context.POPUP_RESULT = {AFFIRMATIVE: 'affirmative'};
  const click = [...fixture.root.listeners.get('click')][0];
  await click({
    target: clickTarget('analyze-current-floor', {root: fixture.root}),
    preventDefault() {},
  });
  assert.equal(fixture.calls().refresh, 0);
  assert.equal(fixture.calls().abort, 1);
  fixture.app.destroyBioWeave();
});

test('cancelled Event Analysis confirmation leaves the Runtime execution running', async () => {
  const fixture = await createFixture({analysisBusy: true});
  fixture.context.Popup = {show: {confirm: async () => 'negative'}};
  fixture.context.POPUP_RESULT = {AFFIRMATIVE: 'affirmative'};
  const click = [...fixture.root.listeners.get('click')][0];
  await click({
    target: clickTarget('analyze-current-floor', {root: fixture.root}),
    preventDefault() {},
  });
  assert.equal(fixture.calls().abort, 0);
  fixture.app.destroyBioWeave();
});

test('UI reopen only reads Runtime state and never triggers Event Analysis', async () => {
  const fixture = await createFixture({analysisState: 'not_analyzed'});
  assert.equal(fixture.calls().refresh, 0);
  fixture.app.destroyBioWeave();
  fixture.app.openBioWeave();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(fixture.calls().refresh, 0);
  fixture.app.destroyBioWeave();
});

test('Event edit writes the current Floor fact and delete removes its Tracking exposure', async () => {
  const version = await floorVersion({chatId: 'chat-app', messageId: 0, floor: 10, swipeId: 0, text: '当前楼层剧情'});
  const fixture = await createFixture({event: sourceEvent(version)});
  fixture.app.go('events');
  const current = fixture.getFloor().events[0];
  const fields = {
    type: {value: current.type},
    status: {value: current.status},
    location: {value: '编辑后的地点'},
    story_time: {value: JSON.stringify(current.story_time)},
    participants: {value: JSON.stringify(current.participants)},
    pregnancy_relevance: {value: JSON.stringify(current.pregnancy_relevance)},
    source_evidence: {value: JSON.stringify(current.source_evidence)},
  };
  const form = {
    dataset: {bioweaveEventId: current.event_id},
    querySelector(selector) {
      const match = selector.match(/data-bioweave-event-field="([^"]+)"/);
      return match ? fields[match[1]] ?? null : null;
    },
  };
  fixture.root.selectorNodes.set('[data-bioweave-event-form]', [form]);
  const click = [...fixture.root.listeners.get('click')][0];
  await click({
    target: clickTarget('save-event', {root: fixture.root, bioweaveEventId: current.event_id}),
    preventDefault() {},
  });
  assert.equal(fixture.calls().update, 1);
  assert.equal(fixture.getFloor().events[0].location, '编辑后的地点');
  assert.deepEqual(fixture.getFloor().events[0].source, version);

  fixture.context.Popup = {show: {confirm: async () => 'affirmative'}};
  fixture.context.POPUP_RESULT = {AFFIRMATIVE: 'affirmative'};
  await click({
    target: clickTarget('delete-event', {root: fixture.root, bioweaveEventId: current.event_id}),
    preventDefault() {},
  });
  assert.equal(fixture.calls().delete, 1);
  assert.deepEqual(fixture.getFloor().events, []);
  assert.equal(Object.hasOwn(fixture.getChat(), 'tracking_subjects'), false);
  fixture.app.destroyBioWeave();
});

test('UI contains no Event production or duplicated Tracking eligibility logic', () => {
  const appSource = readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');
  const characterSource = readFileSync(new URL('../ui/characters.js', import.meta.url), 'utf8');
  assert.doesNotMatch(appSource, /buildEventAnalysisInput|rebuildTrackingRegistry|shouldAnalyze\s*\(|eligibleGestationalSubjects/);
  assert.doesNotMatch(characterSource, /pregnancy_relevance\.relevant\s*===|possible_conception\s*===|can_carry_pregnancy\s*===/);
});
