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
        ['.bioweave-nav nav', 'nav'],
        ['.bioweave-bottom', 'nav'],
        ['.bioweave-main', 'main'],
        ['.bioweave-more-menu', 'div'],
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
      provider: 'bioweave_fallback',
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
    world_model: null,
    world_model_meta: null,
    character_profiles: {},
    tracking_subjects: event ? {'char-a': {
      character_id: 'char-a', display_name: 'Alice', created_from_event_id: event.event_id,
      exposure_event_ids: [event.event_id], status: 'active',
    }} : {},
  };
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
    tracking_subjects: chat.tracking_subjects,
    character_profiles: chat.character_profiles,
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
      tracking_subject_count: Object.keys(chat.tracking_subjects).length,
      current_floor_events: floor.events,
      active_events: floor.events,
      tracking_decisions: [],
      registry_summary: {tracking_subject_count: Object.keys(chat.tracking_subjects).length},
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
      chat.tracking_subjects = {};
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
  assert.match(characters, /char-a/);
  assert.doesNotMatch(characters, /demo-character-1|演示人物/);
  fixture.app.go('events');
  assert.match(fixture.root.querySelector('.bioweave-main').innerHTML, /2026-08-20/);
  assert.equal(Object.keys(fixture.getChat().tracking_subjects).length, 1);
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
  assert.deepEqual(fixture.getChat().tracking_subjects, {});
  fixture.app.destroyBioWeave();
});

test('UI contains no Event production or duplicated Tracking eligibility logic', () => {
  const appSource = readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');
  const characterSource = readFileSync(new URL('../ui/characters.js', import.meta.url), 'utf8');
  assert.doesNotMatch(appSource, /buildEventAnalysisInput|rebuildTrackingRegistry|shouldAnalyze\s*\(|eligibleGestationalSubjects/);
  assert.doesNotMatch(characterSource, /pregnancy_relevance\.relevant\s*===|possible_conception\s*===|can_carry_pregnancy\s*===/);
});
