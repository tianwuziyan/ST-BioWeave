import test from 'node:test';
import assert from 'node:assert/strict';
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

async function createFixture({analyzer = null, event = null, analysisOverrides = {}, lastProcessedFloor = 10, contextOverrides = {}} = {}) {
  const documentRef = new FakeDocument();
  const message = {floor: 10, content: '当前楼层剧情', role: 'assistant'};
  const version = await floorVersion({
    chatId: 'chat-app',
    messageId: 0,
    floor: 10,
    swipeId: 0,
    text: message.content,
  });
  const floorData = {
    analysis: {
      floor_version: version,
      last_analyzed_at: '2026-08-20T00:00:00.000Z',
      status: 'success',
      ...analysisOverrides,
      floor_version: version,
    },
    events: event ? [event] : [],
    snapshot: null,
    projections: [],
  };
  const chatData = {
    schema_version: 1,
    chat_scope: {chat_id: 'chat-app'},
    world_model: null,
    world_model_meta: null,
    character_profiles: {},
    tracking_subjects: {},
    settings: {analysis_interval: 3},
    index: {last_processed_floor: lastProcessedFloor},
  };
  let floor = floorData;
  let chat = chatData;
  let runtimeListener = null;
  const context = {chatId: 'chat-app', chat: [message], characters: [], ...contextOverrides};
  const runtime = {
    chat: {
      current: () => context.chatId,
      token: () => ({chatId: context.chatId, epoch: 0}),
      assert: token => {
        if (token.chatId !== context.chatId) throw new Error('STALE_CHAT');
      },
    },
    st: {getContext: () => context, getChat: () => context.chat},
    store: {
      getChat: () => chat,
      saveChat: async (_chatId, next) => { chat = structuredClone(next); },
      getFloor: () => structuredClone(floor),
      saveFloor: async (_messageId, _swipeId, next) => { floor = structuredClone(next); },
      getActiveSwipeId: () => 0,
      getActiveFloorEvents: (_messageId, currentVersion) => floor.events.filter(item => (
        ['chat_id', 'message_id', 'floor', 'swipe_id', 'content_hash', 'message_version']
          .every(key => item.source?.[key] === currentVersion[key])
      )),
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
    analyzer: analyzer ?? {analyzeFloor: async () => ({events: []})},
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

test('Event analysis receives the current character card as narrative evidence', async () => {
  let receivedInput = null;
  const fixture = await createFixture({
    analyzer: {
      async analyzeFloor({analysisInput}) {
        receivedInput = analysisInput;
        return {events: []};
      },
    },
    contextOverrides: {
      characterId: 0,
      name2: 'Alice',
      characters: [{
        avatar: 'char-a',
        data: {
          name: 'Alice',
          description: '角色卡中的生理与叙事背景。',
          personality: '谨慎',
          scenario: '当前场景',
        },
      }],
    },
  });
  const click = [...fixture.root.listeners.get('click')][0];
  await click({
    target: clickTarget('refresh', {root: fixture.root}),
    preventDefault() {},
  });
  assert.equal(receivedInput.character_context.current_character, 'Alice');
  assert.equal(receivedInput.character_context.character_id, 'char-a');
  assert.equal(receivedInput.character_context.character_card.description, '角色卡中的生理与叙事背景。');
  assert.equal(receivedInput.character_context.character_card.personality, '谨慎');
  assert.deepEqual(receivedInput.story_time, {
    display: null,
    normalized: null,
    calendar_id: null,
    day_index: null,
    provider: null,
    precision: 'unknown',
    confidence: null,
  });
  fixture.app.destroyBioWeave();
});

test('manual refresh replaces successful Floor Events and a later failure keeps them', async () => {
  const version = await floorVersion({chatId: 'chat-app', messageId: 0, floor: 10, swipeId: 0, text: '当前楼层剧情'});
  let calls = 0;
  const analyzer = {
    async analyzeFloor() {
      calls += 1;
      if (calls === 2) throw new Error('REQUEST_TIMEOUT');
      return {events: [sourceEvent(version, {event_id: 'evt-replaced', location: '新地点'})]};
    },
  };
  const fixture = await createFixture({analyzer, event: sourceEvent(version)});
  const click = [...fixture.root.listeners.get('click')][0];
  await click({
    target: clickTarget('refresh', {root: fixture.root}),
    preventDefault() {},
  });
  assert.equal(calls, 1);
  assert.equal(fixture.getFloor().events[0].event_id, 'evt-replaced');
  assert.equal(fixture.getFloor().events[0].location, '新地点');
  await click({
    target: clickTarget('refresh', {root: fixture.root}),
    preventDefault() {},
  });
  assert.equal(calls, 2);
  assert.equal(fixture.getFloor().events[0].event_id, 'evt-replaced');
  assert.equal(fixture.getFloor().analysis.status, 'failed');
  assert.equal(fixture.getFloor().analysis.last_success.status, 'success');
  fixture.app.destroyBioWeave();
});

test('automatic analysis follows the configured Floor interval and UI reopen does not request AI', async () => {
  const version = await floorVersion({chatId: 'chat-app', messageId: 0, floor: 10, swipeId: 0, text: '当前楼层剧情'});
  let calls = 0;
  const analyzer = {
    async analyzeFloor() {
      calls += 1;
      return {events: [sourceEvent(version, {event_id: 'evt-auto'})]};
    },
  };
  const fixture = await createFixture({
    analyzer,
    analysisOverrides: {status: 'failed'},
    lastProcessedFloor: 7,
  });

  assert.equal(calls, 0);
  fixture.emit({type: 'MESSAGE_RECEIVED', payload: {message_id: 0}});
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(calls, 1);
  assert.equal(fixture.getFloor().analysis.status, 'success');

  fixture.app.destroyBioWeave();
  fixture.app.openBioWeave();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(calls, 1);
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
  assert.equal(fixture.getFloor().events[0].location, '编辑后的地点');
  assert.deepEqual(fixture.getFloor().events[0].source, version);

  fixture.context.Popup = {show: {confirm: async () => 'affirmative'}};
  fixture.context.POPUP_RESULT = {AFFIRMATIVE: 'affirmative'};
  await click({
    target: clickTarget('delete-event', {root: fixture.root, bioweaveEventId: current.event_id}),
    preventDefault() {},
  });
  assert.deepEqual(fixture.getFloor().events, []);
  assert.deepEqual(fixture.getChat().tracking_subjects, {});
  fixture.app.destroyBioWeave();
});
