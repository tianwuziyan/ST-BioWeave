import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createApp} from '../ui/app.js';
import {floorVersion} from '../runtime/floor.js';
import {fingerprintWorldModel} from '../utils/world-model-debug.js';
import {normalizeWorldModel} from '../ai/analyzer.js';
import {
  createWorldModelUiIngressFixture,
  WORLD_MODEL_UI_INGRESS_VALUES,
} from './fixtures/world-model/ui-ingress.js';

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

async function createFixture({event = null, analysisState = 'success', analysisBusy = false, analysisPhase = null, onRefresh = null, characterAnalysisError = null, updateEventError = null, contextOverrides = {}, worldModel = null, resolveWorldModel = null, analyzeWorldPatch = null, reemitPersistenceTrace = false, currentFloor: initialCurrentFloor = null} = {}) {
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
  let currentFloor = initialCurrentFloor ?? {floor: 10, message_id: 0, swipe_id: 0, version};
  let runtimeListener = null;
  let refreshCalls = 0;
  let businessDataCalls = 0;
  let businessDataFailure = null;
  let characterAnalysisCalls = 0;
  let abortCalls = 0;
  let currentBusy = analysisBusy;
  let updateCalls = 0;
  let deleteCalls = 0;
  let worldResolveCalls = 0;
  const persistenceTrace = [];
  let enabled = true;
  const context = {chatId: 'chat-app', chat: [message], characters: [], ...contextOverrides};
  const businessData = () => ({
    tracking_subjects: trackingSubjects,
    character_profiles: event ? {'char-a': {character_id: 'char-a', display_name: 'Alice'}} : {},
    active_events: floor.events,
    current_floor: currentFloor,
    last_success: analysisState === 'success' ? '2026-08-20T00:00:00.000Z' : null,
    analysis_status: {
      state: currentBusy ? 'running' : analysisState,
      busy: currentBusy,
      phase: analysisPhase,
      current_floor: currentFloor,
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
    getBioWeaveEnabled: () => enabled,
    setEnabled(value) { enabled = value !== false; },
    async resolveWorldModelAtOrBefore() {
      worldResolveCalls += 1;
      if (typeof resolveWorldModel === 'function') return resolveWorldModel();
      return worldModel ? {model: structuredClone(worldModel), meta: {}} : null;
    },
    recordPersistenceTrace(entry) {
      persistenceTrace.push(structuredClone(entry));
      if (reemitPersistenceTrace) runtimeListener?.({
        type: 'BIOWEAVE_PERSISTENCE_TRACE',
        chatId: context.chatId,
        payload: structuredClone(entry),
      });
    },
    collectActiveBusinessData: async () => {
      businessDataCalls += 1;
      if (businessDataFailure) throw businessDataFailure;
      return structuredClone(businessData());
    },
    async refreshCurrentFloorAnalysis() {
      refreshCalls += 1;
      if (onRefresh) await onRefresh({floor, chat, version, context});
      return {status: 'success'};
    },
    async analyzeCurrentCharacterEvents() {
      characterAnalysisCalls += 1;
      if (characterAnalysisError) throw characterAnalysisError;
      if (onRefresh) await onRefresh({floor, chat, version, context});
      return {status: 'success'};
    },
    ...(typeof analyzeWorldPatch === 'function' ? {analyzeCurrentWorldModelPatch: analyzeWorldPatch} : {}),
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
      if (updateEventError) throw updateEventError;
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
    calls: () => ({refresh: refreshCalls, characterAnalysis: characterAnalysisCalls, abort: abortCalls, update: updateCalls, delete: deleteCalls}),
    businessDataCalls: () => businessDataCalls,
    setCurrentFloor: value => { currentFloor = value; },
    worldResolveCalls: () => worldResolveCalls,
    persistenceTrace: () => [...persistenceTrace],
    setBusinessDataFailure: error => { businessDataFailure = error; },
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

async function waitFor(predicate, message = 'condition') {
  for (let index = 0; index < 40; index += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.fail(`Timed out waiting for ${message}`);
}

function worldCandidatePayload({model, fingerprint, version, executionId, trigger = 'auto-patch'}) {
  return {
    state: 'candidate_ready',
    execution_id: executionId,
    candidate_revision: fingerprint.full_hash,
    candidate_fingerprint: fingerprint.fingerprint,
    candidate_full_hash: fingerprint.full_hash,
    chat_id: 'chat-app',
    floor_version: version,
    model,
    meta: {source: 'world-patch-analysis'},
    mode: 'patch',
    trigger,
    accepted_operation_count: 1,
    canonical_mutation_occurred: true,
    final_result: 'UPDATED',
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
  assert.equal(fixture.calls().refresh, 0);
  assert.equal(fixture.calls().characterAnalysis, 1);
  assert.deepEqual(fixture.toasts(), [['success', 'BioWeave：人物分析完成']]);
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
    ['error', 'BioWeave：事件分析失败（请求超时：等待 3 秒后已在本地终止。本次未自动重试。），上一份有效事件已保留。'],
  ]);
  fixture.app.destroyBioWeave();
});

test('manual Character Analysis reports a missing World Model without falling back to World Analysis', async () => {
  const fixture = await createFixture({
    analysisState: 'not_analyzed',
    characterAnalysisError: Object.assign(new Error('WORLD_MODEL_REQUIRED'), {code: 'WORLD_MODEL_REQUIRED'}),
  });
  const click = [...fixture.root.listeners.get('click')][0];
  await assert.doesNotReject(
    click({
      target: clickTarget('analyze-current-floor', {root: fixture.root}),
      preventDefault() {},
    }),
  );
  assert.equal(fixture.calls().characterAnalysis, 1);
  assert.equal(fixture.calls().refresh, 0);
  assert.deepEqual(fixture.toasts(), [['warning', 'BioWeave：需要先完成世界分析。']]);
  fixture.app.destroyBioWeave();
});

test('manual Event Analysis keeps the Runtime error object in its helper contract', () => {
  const source = readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');
  const helper = source.slice(source.indexOf('async function manualRefreshEventAnalysis()'), source.indexOf('async function requestAbortEventAnalysis()'));
  assert.match(helper, /catch \(error\) \{[\s\S]*eventAnalysisError\(error\)[\s\S]*throw error\s*\}/);
});

test('background Event Analysis failures update UI state with one top error Toast', async () => {
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
  assert.deepEqual(fixture.toasts(), [['error', 'BioWeave：分析失败：请求超时。']]);
  fixture.app.destroyBioWeave();
});

test('normal Character render refreshes the current Floor without starting analysis or repeating on duplicate render', async () => {
  const fixture = await createFixture({
    currentFloor: {floor: 60, message_id: 60, swipe_id: 0},
    analysisState: 'success',
  });
  fixture.app.go('state');
  await waitFor(() => fixture.root.querySelector('.bioweave-main').innerHTML.includes('当前楼层 60'), 'Floor 60 UI');

  fixture.setCurrentFloor({floor: 62, message_id: 62, swipe_id: 0});
  fixture.emit({
    type: 'BIOWEAVE_LIFECYCLE_SETTLED',
    mutationType: 'CHARACTER_MESSAGE_RENDERED',
    payload: {message_id: 62, swipe_id: 0},
  });
  await waitFor(() => fixture.root.querySelector('.bioweave-main').innerHTML.includes('当前楼层 62'), 'Floor 62 UI');

  const readsAfterFirstRender = fixture.businessDataCalls();
  assert.equal(fixture.calls().refresh, 0);
  assert.equal(fixture.calls().characterAnalysis, 0);
  assert.equal(fixture.persistenceTrace().filter(entry => entry.stage === 'CHARACTER_UI_REFRESH_REQUESTED').length, 2);

  fixture.emit({
    type: 'BIOWEAVE_LIFECYCLE_SETTLED',
    mutationType: 'CHARACTER_MESSAGE_RENDERED',
    payload: {message_id: 62, swipe_id: 0},
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(fixture.businessDataCalls(), readsAfterFirstRender);
  assert.equal(fixture.calls().refresh, 0);
  fixture.app.destroyBioWeave();
});

async function createStaleBusinessRefreshFixture() {
  const fixture = await createFixture({event: sourceEvent({chat_id: 'chat-app', message_id: 0, floor: 10, swipe_id: 0})});
  await waitFor(() => fixture.persistenceTrace().some(entry => entry.stage === 'CHARACTER_UI_STATE_COMMITTED'), 'initial UI business refresh');
  const normalCollect = fixture.runtime.collectActiveBusinessData;
  let calls = 0;
  let releaseLatest;
  const latest = new Promise(resolve => { releaseLatest = resolve; });
  fixture.runtime.collectActiveBusinessData = async () => {
    calls += 1;
    if (calls === 1)
      throw Object.assign(new Error('STALE_FLOOR_VERSION'), {code: 'STALE_FLOOR_VERSION'});
    if (calls === 2) {
      await latest;
      return normalCollect();
    }
    return normalCollect();
  };
  fixture.app.go('state');
  return {fixture, calls: () => calls, releaseLatest};
}

for (const mutationType of ['MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_DELETED']) {
  test(`STALE_FLOOR_VERSION during ${mutationType} clears old UI projections and refreshes once`, async () => {
    const {fixture, calls, releaseLatest} = await createStaleBusinessRefreshFixture();
    try {
      fixture.emit({type: mutationType, payload: {message_id: 0, swipe_id: 0}});
      fixture.emit({type: 'MESSAGE_UPDATED', payload: {message_id: 0}});
      await waitFor(() => calls() === 1, `${mutationType} stale refresh start`);
      await waitFor(() => fixture.root.querySelector('.bioweave-main').innerHTML.includes('正在重新读取'), `${mutationType} stale state`);
      assert.doesNotMatch(fixture.root.querySelector('.bioweave-main').innerHTML, /Alice/);
      assert.doesNotMatch(fixture.root.querySelector('.bioweave-main').innerHTML, /状态归约发生错误/);
      assert.deepEqual(fixture.toasts(), []);
      releaseLatest();
      await waitFor(() => calls() === 2 && fixture.root.querySelector('.bioweave-main').innerHTML.includes('当前楼层 10'), `${mutationType} latest refresh`);
    } finally {
      releaseLatest();
      fixture.app.destroyBioWeave();
    }
  });
}

test('连续 STALE_FLOOR_VERSION 最多只触发一次自动重试', async () => {
  const fixture = await createFixture({event: sourceEvent({chat_id: 'chat-app', message_id: 0, floor: 10, swipe_id: 0})});
  let calls = 0;
  fixture.runtime.collectActiveBusinessData = async () => {
    calls += 1;
    throw Object.assign(new Error('STALE_FLOOR_VERSION'), {code: 'STALE_FLOOR_VERSION'});
  };
  try {
    fixture.app.go('state');
    fixture.emit({type: 'MESSAGE_EDITED', payload: {message_id: 0}});
    await waitFor(() => calls === 2, 'bounded stale retries');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(calls, 2);
    assert.doesNotMatch(fixture.root.querySelector('.bioweave-main').innerHTML, /状态归约发生错误/);
    assert.deepEqual(fixture.toasts(), []);
  } finally {
    fixture.app.destroyBioWeave();
  }
});

test('Floor 边界变化在异步 stale 结果返回前也不保留旧 projection', async () => {
  const fixture = await createFixture({event: sourceEvent({chat_id: 'chat-app', message_id: 0, floor: 10, swipe_id: 0})});
  await waitFor(() => fixture.persistenceTrace().some(entry => entry.stage === 'CHARACTER_UI_STATE_COMMITTED'), 'initial UI business refresh');
  const normalCollect = fixture.runtime.collectActiveBusinessData;
  let calls = 0;
  let releaseFirst;
  const first = new Promise(resolve => { releaseFirst = resolve; });
  fixture.runtime.collectActiveBusinessData = async () => {
    calls += 1;
    if (calls === 1) {
      await first;
      throw Object.assign(new Error('STALE_FLOOR_VERSION'), {code: 'STALE_FLOOR_VERSION'});
    }
    return normalCollect();
  };
  try {
    fixture.app.go('characters');
    fixture.emit({type: 'MESSAGE_EDITED', payload: {message_id: 0}});
    await waitFor(() => calls === 1, 'pending stale read');
    assert.doesNotMatch(fixture.root.querySelector('.bioweave-main').innerHTML, /Alice/);
    releaseFirst();
    await waitFor(() => calls === 2, 'post-stale refresh');
  } finally {
    releaseFirst();
    fixture.app.destroyBioWeave();
  }
});

test('automatic World Full phase owns World busy state before Event Analysis', async () => {
  const fixture = await createFixture({analysisState: 'not_analyzed', analysisBusy: true, analysisPhase: 'world_full'});
  fixture.app.go('world');
  fixture.emit({
    type: 'WORLD_ANALYSIS_STATUS_CHANGED',
    chatId: 'chat-app',
    payload: {state: 'running', phase: 'world_full', mode: 'full', trigger: 'auto-full'},
  });
  const worldMarkup = fixture.root.querySelector('.bioweave-main').innerHTML;
  assert.match(worldMarkup, /data-bioweave-action="world-model-full"[^>]*>分析中…</);
  assert.doesNotMatch(worldMarkup, /data-bioweave-action="world-model-full"[^>]*disabled/);
  fixture.app.go('characters');
  const charactersMarkup = fixture.root.querySelector('.bioweave-main').innerHTML;
  assert.match(charactersMarkup, /等待世界分析完成…/);
  assert.doesNotMatch(charactersMarkup, /当前楼层正在分析中/);
  fixture.app.destroyBioWeave();
});

test('T1-T5/T10 closed-tab committed readback uses shared ingress despite an active loading gate', async () => {
  let resolveFloor;
  let fixture;
  const pending = new Promise(resolve => { resolveFloor = resolve; });
  const oldModel = normalizeWorldModel({schema_version: 1, species: [{name: 'Species-Old', biological_types: []}]});
  const candidateModel = normalizeWorldModel(createWorldModelUiIngressFixture());
  const fingerprint = await fingerprintWorldModel(candidateModel);
  fixture = await createFixture({
    worldModel: oldModel,
    resolveWorldModel: () => pending,
  });
  fixture.app.go('world');
  await waitFor(() => fixture.worldResolveCalls() === 1, 'initial World reload');
  fixture.app.go('overview');
  fixture.emit({
    type: 'WORLD_PERSISTENCE_CONFIRMED',
    chatId: 'chat-app',
    payload: worldCandidatePayload({model: candidateModel, fingerprint, version: fixture.version, executionId: 'candidate-closed'}),
  });
  await waitFor(() => fixture.app.getWorldModelUiDiagnosticState().application_state.model_fingerprint === fingerprint.fingerprint, 'closed-tab committed projection');
  const adopted = fixture.app.getWorldModelUiDiagnosticState();
  assert.equal(adopted.application_state.committed_full_hash, fingerprint.full_hash);
  assert.equal(adopted.application_state.projection_state, 'APPLIED');
  assert.equal(adopted.last_ingress.ui_fingerprint_after, fingerprint.fingerprint);
  assert.equal(adopted.last_ingress.view_model_fingerprint, fingerprint.fingerprint);

  fixture.app.go('world');
  const click = [...fixture.root.listeners.get('click')][0];
  await click({target: clickTarget('world-model-select-species', {root: fixture.root, bioweaveWorldSpeciesIndex: '0'}), preventDefault() {}});
  await click({target: clickTarget('world-model-select-type', {root: fixture.root, bioweaveWorldSpeciesIndex: '0', bioweaveWorldTypeIndex: '0'}), preventDefault() {}});
  const worldMarkup = fixture.root.querySelector('.bioweave-main').innerHTML;
  for (const value of WORLD_MODEL_UI_INGRESS_VALUES)
    assert.match(worldMarkup, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(fixture.app.getWorldModelUiDiagnosticState().last_render.model_fingerprint, fingerprint.fingerprint);

  resolveFloor({model: oldModel, meta: {}, floor_version: fixture.version});
  await waitFor(() => fixture.app.getWorldModelUiDiagnosticState().application_state.stale_reload_suppression_count === 1, 'stale reload suppression');
  assert.equal(fixture.app.getWorldModelUiDiagnosticState().application_state.model_fingerprint, fingerprint.fingerprint);
  fixture.app.destroyBioWeave();
});

test('T11 open World tab renders the committed readback projection', async () => {
  let fixture;
  const candidateModel = normalizeWorldModel(createWorldModelUiIngressFixture());
  const fingerprint = await fingerprintWorldModel(candidateModel);
  fixture = await createFixture({
  });
  fixture.app.go('world');
  await waitFor(() => fixture.app.getWorldModelUiDiagnosticState().application_state.loaded, 'empty World state');
  fixture.emit({
    type: 'WORLD_PERSISTENCE_CONFIRMED',
    chatId: 'chat-app',
    payload: worldCandidatePayload({model: candidateModel, fingerprint, version: fixture.version, executionId: 'candidate-open'}),
  });
  await waitFor(() => fixture.app.getWorldModelUiDiagnosticState().last_render.model_fingerprint === fingerprint.fingerprint, 'open-tab committed projection');
  assert.match(fixture.root.querySelector('.bioweave-main').innerHTML, /Species-A/);
  fixture.app.destroyBioWeave();
});

test('confirmed World persistence refreshes the production business DTO without starting Event Analysis', async () => {
  const fixture = await createFixture({worldModel: normalizeWorldModel({
    schema_version: 1,
    species: [{name: 'Species-Base', biological_types: []}],
  })});
  await waitFor(() => fixture.businessDataCalls() > 0, 'initial business DTO');
  const before = fixture.businessDataCalls();
  fixture.emit({
    type: 'WORLD_PERSISTENCE_CONFIRMED',
    chatId: 'chat-app',
    payload: {floor_version: fixture.version, persistence_confirmed: true},
  });
  await waitFor(() => fixture.businessDataCalls() > before, 'World persistence business refresh');
  assert.equal(fixture.calls().refresh, 0);
  assert.equal(fixture.calls().characterAnalysis, 0);
  fixture.app.destroyBioWeave();
});

test('T6/T7 stale Floor N-1 is suppressed after a newer committed projection', async () => {
  let resolveFirst;
  let resolverCall = 0;
  const first = new Promise(resolve => { resolveFirst = resolve; });
  const oldModel = normalizeWorldModel({schema_version: 1, species: [{name: 'Species-Old', biological_types: []}]});
  const candidateModel = normalizeWorldModel(createWorldModelUiIngressFixture());
  const fingerprint = await fingerprintWorldModel(candidateModel);
  let fixture;
  fixture = await createFixture({
    resolveWorldModel: () => {
      resolverCall += 1;
      if (resolverCall === 1) return first;
      return {model: candidateModel, meta: {source: 'authoritative-readback'}, floor_version: fixture.version};
    },
  });
  fixture.app.go('world');
  await waitFor(() => resolverCall === 1, 'stale Floor resolver');
  fixture.emit({
    type: 'WORLD_PERSISTENCE_CONFIRMED',
    chatId: 'chat-app',
    payload: worldCandidatePayload({model: candidateModel, fingerprint, version: fixture.version, executionId: 'candidate-reconcile'}),
  });
  await waitFor(() => fixture.app.getWorldModelUiDiagnosticState().application_state.committed_fingerprint === fingerprint.fingerprint, 'Committed projection');
  fixture.emit({
    type: 'BIOWEAVE_LIFECYCLE_SETTLED',
    mutationType: 'MESSAGE_UPDATED',
    payload: {floor_version: fixture.version},
  });
  resolveFirst({model: oldModel, meta: {}, floor_version: fixture.version});
  await waitFor(() => fixture.app.getWorldModelUiDiagnosticState().application_state.projection_state === 'APPLIED', 'authoritative committed readback');
  const state = fixture.app.getWorldModelUiDiagnosticState();
  assert.equal(resolverCall, 1);
  assert.equal(state.application_state.model_fingerprint, fingerprint.fingerprint);
  assert.equal(state.application_state.stale_reload_suppression_count, 0);
  assert.equal(state.last_ingress.ingress_source, 'authoritative-persistence-readback');
  fixture.app.destroyBioWeave();
});

test('T6 stale resolver rejection cannot clear a committed projection', async () => {
  let rejectFloor;
  const pending = new Promise((resolve, reject) => { rejectFloor = reject; });
  const candidateModel = normalizeWorldModel(createWorldModelUiIngressFixture());
  const fingerprint = await fingerprintWorldModel(candidateModel);
  const fixture = await createFixture({resolveWorldModel: () => pending});
  fixture.app.go('world');
  await waitFor(() => fixture.worldResolveCalls() === 1, 'rejecting Floor resolver');
  fixture.emit({
    type: 'WORLD_PERSISTENCE_CONFIRMED',
    chatId: 'chat-app',
    payload: worldCandidatePayload({model: candidateModel, fingerprint, version: fixture.version, executionId: 'candidate-before-reject'}),
  });
  await waitFor(() => fixture.app.getWorldModelUiDiagnosticState().application_state.committed_fingerprint === fingerprint.fingerprint, 'Committed projection before rejection');
  rejectFloor(new Error('STALE_FLOOR_READ'));
  await waitFor(() => fixture.app.getWorldModelUiDiagnosticState().application_state.stale_reload_suppression_count === 1, 'resolver rejection suppression');
  const state = fixture.app.getWorldModelUiDiagnosticState();
  assert.equal(state.application_state.model_fingerprint, fingerprint.fingerprint);
  assert.equal(state.application_state.loading, false);
  fixture.app.destroyBioWeave();
});

test('T8/T9 Manual and Automatic paths converge on the same committed UI ingress', async () => {
  const baseModel = normalizeWorldModel({schema_version: 1, species: [{name: 'Species-Base', biological_types: []}]});
  const candidateModel = normalizeWorldModel(createWorldModelUiIngressFixture());
  const fingerprint = await fingerprintWorldModel(candidateModel);

  const automatic = await createFixture();
  automatic.app.go('world');
  await waitFor(() => automatic.app.getWorldModelUiDiagnosticState().application_state.loaded, 'Automatic empty World state');
  automatic.emit({
    type: 'WORLD_PERSISTENCE_CONFIRMED',
    chatId: 'chat-app',
    payload: worldCandidatePayload({model: candidateModel, fingerprint, version: automatic.version, executionId: 'candidate-automatic'}),
  });
  await waitFor(() => automatic.app.getWorldModelUiDiagnosticState().application_state.committed_fingerprint === fingerprint.fingerprint, 'Automatic committed projection');

  let manual;
  manual = await createFixture({
    worldModel: baseModel,
    analyzeWorldPatch: async () => ({
      ...worldCandidatePayload({model: candidateModel, fingerprint, version: manual.version, executionId: 'candidate-manual', trigger: 'manual-patch'}),
      candidate_execution_id: 'candidate-manual',
    }),
  });
  manual.app.go('world');
  await waitFor(() => manual.app.getWorldModelUiDiagnosticState().application_state.loaded, 'Manual base World state');
  const click = [...manual.root.listeners.get('click')][0];
  await click({target: clickTarget('world-model-patch', {root: manual.root}), preventDefault() {}});
  const automaticState = automatic.app.getWorldModelUiDiagnosticState();
  const manualState = manual.app.getWorldModelUiDiagnosticState();
  assert.equal(automaticState.application_state.model_fingerprint, fingerprint.fingerprint);
  assert.equal(manualState.application_state.model_fingerprint, fingerprint.fingerprint);
  assert.deepEqual(manualState.world_model, automaticState.world_model);
  assert.equal(automaticState.last_ingress.ingress_source, 'authoritative-persistence-readback');
  assert.equal(manualState.last_ingress.ingress_source, 'authoritative-persistence-readback');
  assert.equal(manualState.last_ingress.view_model_fingerprint, automaticState.last_ingress.view_model_fingerprint);
  automatic.app.destroyBioWeave();
  manual.app.destroyBioWeave();
});

test('T15 canonical no-op does not create a persistence transaction or run model ingress', async () => {
  const model = normalizeWorldModel(createWorldModelUiIngressFixture());
  const fixture = await createFixture({
    worldModel: model,
    analyzeWorldPatch: async () => ({
      model,
      final_result: 'NO_CHANGE',
      canonical_noop: true,
      candidate_execution_id: null,
      accepted_operation_count: 0,
      canonical_mutation_occurred: false,
    }),
  });
  fixture.app.go('world');
  await waitFor(() => fixture.app.getWorldModelUiDiagnosticState().application_state.loaded, 'no-op base model');
  const before = fixture.app.getWorldModelUiDiagnosticState();
  const ingressCount = fixture.persistenceTrace().filter(item => item.stage === 'WORLD_UI_INGRESS_COMPLETED').length;
  const click = [...fixture.root.listeners.get('click')][0];
  await click({target: clickTarget('world-model-patch', {root: fixture.root}), preventDefault() {}});
  const after = fixture.app.getWorldModelUiDiagnosticState();
  assert.equal(after.application_state.model_fingerprint, before.application_state.model_fingerprint);
  assert.equal(after.application_state.committed_fingerprint, null);
  assert.equal(fixture.persistenceTrace().filter(item => item.stage === 'WORLD_UI_INGRESS_COMPLETED').length, ingressCount);
  assert.equal(fixture.persistenceTrace().some(item => item.stage === 'WORLD_UI_PROJECTION_FAILED'), false);
  fixture.app.destroyBioWeave();
});

test('UI projection failure does not roll back confirmed Floor state', async () => {
  const fixture = await createFixture();
  fixture.emit({
    type: 'WORLD_PERSISTENCE_CONFIRMED',
    chatId: 'chat-app',
    payload: {execution_id: 'committed-missing-model', floor_version: fixture.version, persistence_confirmed: true},
  });
  await waitFor(() => fixture.persistenceTrace().some(item => item.stage === 'WORLD_UI_PROJECTION_FAILED'), 'projection failure');
  assert.equal(fixture.app.getWorldModelUiDiagnosticState().world_model, null);
  fixture.app.destroyBioWeave();

});

test('WORLD_READY transition clears World busy and starts Event busy', async () => {
  const fixture = await createFixture({analysisState: 'not_analyzed', analysisBusy: true, analysisPhase: 'world_full'});
  fixture.app.go('world');
  fixture.emit({
    type: 'WORLD_ANALYSIS_STATUS_CHANGED',
    chatId: 'chat-app',
    payload: {state: 'running', phase: 'world_ui_ready', mode: 'full', trigger: 'auto-full'},
  });
  fixture.emit({
    type: 'WORLD_ANALYSIS_STATUS_CHANGED',
    chatId: 'chat-app',
    payload: {state: 'success', mode: 'full', trigger: 'auto-full'},
  });
  fixture.emit({
    type: 'EVENT_ANALYSIS_STATUS_CHANGED',
    chatId: 'chat-app',
    payload: {state: 'running', phase: 'event_analysis', attempt: 1},
  });
  const worldMarkup = fixture.root.querySelector('.bioweave-main').innerHTML;
  assert.match(worldMarkup, />开始分析</);
  assert.doesNotMatch(worldMarkup, /分析中…/);
  fixture.app.go('characters');
  const charactersMarkup = fixture.root.querySelector('.bioweave-main').innerHTML;
  assert.match(charactersMarkup, /当前楼层正在分析中/);
  assert.match(charactersMarkup, /分析中…/);
  fixture.app.destroyBioWeave();
});

test('automatic World Patch phase uses the patch button and keeps Characters waiting', async () => {
  const worldModel = {schema_version: 1, species: [{name: '人类', biological_types: []}], exceptions: [], unknowns: []};
  const fixture = await createFixture({worldModel, analysisState: 'not_analyzed', analysisBusy: true, analysisPhase: 'world_patch'});
  fixture.app.go('world');
  fixture.emit({
    type: 'WORLD_ANALYSIS_STATUS_CHANGED',
    chatId: 'chat-app',
    payload: {state: 'running', phase: 'world_patch', mode: 'patch', trigger: 'auto-patch'},
  });
  const worldMarkup = fixture.root.querySelector('.bioweave-main').innerHTML;
  assert.match(worldMarkup, /disabled[^>]*>补充中…</);
  assert.doesNotMatch(worldMarkup, /disabled[^>]*>分析中…</);
  fixture.app.go('characters');
  assert.match(fixture.root.querySelector('.bioweave-main').innerHTML, /等待世界分析完成…/);
  fixture.app.destroyBioWeave();
});

test('World Reuse skips World busy and enters Event phase directly', async () => {
  const worldModel = {schema_version: 1, species: [{name: '人类', biological_types: []}], exceptions: [], unknowns: []};
  const fixture = await createFixture({worldModel, analysisState: 'not_analyzed', analysisBusy: true, analysisPhase: 'event_analysis'});
  fixture.app.go('world');
  fixture.emit({
    type: 'EVENT_ANALYSIS_STATUS_CHANGED',
    chatId: 'chat-app',
    payload: {state: 'running', phase: 'event_analysis', attempt: 1, reason: 'automatic'},
  });
  const worldMarkup = fixture.root.querySelector('.bioweave-main').innerHTML;
  assert.doesNotMatch(worldMarkup, /分析中…|补充中…/);
  fixture.app.go('characters');
  assert.match(fixture.root.querySelector('.bioweave-main').innerHTML, /当前楼层正在分析中/);
  fixture.app.destroyBioWeave();
});

test('World failure never changes Characters into Event busy state', async () => {
  const fixture = await createFixture({analysisState: 'not_analyzed', analysisBusy: true, analysisPhase: 'world_full'});
  fixture.emit({
    type: 'WORLD_ANALYSIS_STATUS_CHANGED',
    chatId: 'chat-app',
    payload: {state: 'running', phase: 'world_full', mode: 'full', trigger: 'auto-full'},
  });
  fixture.emit({
    type: 'WORLD_ANALYSIS_STATUS_CHANGED',
    chatId: 'chat-app',
    payload: {state: 'failed', mode: 'full', trigger: 'auto-full', error_code: 'WORLD_FAILED'},
  });
  fixture.emit({
    type: 'EVENT_ANALYSIS_STATUS_CHANGED',
    chatId: 'chat-app',
    payload: {state: 'failed', phase: 'world_full', error_code: 'WORLD_MODEL_UNAVAILABLE'},
  });
  fixture.app.go('characters');
  const charactersMarkup = fixture.root.querySelector('.bioweave-main').innerHTML;
  assert.doesNotMatch(charactersMarkup, /当前楼层正在分析中/);
  fixture.app.destroyBioWeave();
});

test('duplicate World phase events do not change the mapped busy state', async () => {
  const fixture = await createFixture({analysisState: 'not_analyzed', analysisPhase: 'world_readback'});
  fixture.app.go('world');
  const phase = {
    type: 'WORLD_ANALYSIS_STATUS_CHANGED',
    chatId: 'chat-app',
    payload: {state: 'running', phase: 'world_readback', mode: 'full', trigger: 'auto-full'},
  };
  fixture.emit(phase);
  const first = fixture.root.querySelector('.bioweave-main').innerHTML;
  fixture.emit(phase);
  const second = fixture.root.querySelector('.bioweave-main').innerHTML;
  assert.equal(second, first);
  fixture.app.destroyBioWeave();
});

test('automatic analysis terminal status shows one success Toast even when repeated', async () => {
  const fixture = await createFixture({analysisState: 'not_analyzed'});
  const terminal = {
    type: 'EVENT_ANALYSIS_STATUS_CHANGED',
    chatId: 'chat-app',
    payload: {
      state: 'success',
      attempt: 4,
      reason: 'CHARACTER_MESSAGE_RENDERED',
      world_resolution: 'full',
      floor_version: {chat_id: 'chat-app', message_id: 0, floor: 10, swipe_id: 0, content_hash: 'hash', message_version: 'v1:hash'},
    },
  };
  fixture.emit(terminal);
  fixture.emit(terminal);
  assert.deepEqual(fixture.toasts(), [['success', 'BioWeave：世界与人物分析完成']]);
  fixture.app.destroyBioWeave();
});

test('automatic World UI-ready failure shows one hard-gate Toast and no Event success', async () => {
  const fixture = await createFixture({analysisState: 'not_analyzed'});
  const event = {
    type: 'WORLD_ANALYSIS_STATUS_CHANGED',
    chatId: 'chat-app',
    payload: {
      state: 'failed',
      trigger: 'auto-full',
      error_code: 'WORLD_MODEL_UI_NOT_READY',
      error_stage: 'world_view_model',
      floor_version: {chat_id: 'chat-app', message_id: 0, floor: 10, swipe_id: 0, content_hash: 'world-fail', message_version: 'v1:world-fail'},
    },
  };
  fixture.emit(event);
  fixture.emit(event);
  assert.deepEqual(fixture.toasts(), [['error', 'BioWeave：世界数据未能正常显示，已停止人物分析']]);
  fixture.app.destroyBioWeave();
});

test('World status refreshes the open World page and closed panels do not suppress Toasts', async () => {
  const worldModel = {schema_version: 1, species: [{name: '人类', biological_types: []}], exceptions: [], unknowns: []};
  const fixture = await createFixture({worldModel});
  fixture.app.go('world');
  const before = fixture.worldResolveCalls();
  fixture.emit({
    type: 'WORLD_ANALYSIS_STATUS_CHANGED',
    chatId: 'chat-app',
    payload: {
      state: 'success',
      trigger: 'auto-full',
      floor_version: {chat_id: 'chat-app', message_id: 0, floor: 10, swipe_id: 0, content_hash: 'world', message_version: 'v1:world'},
    },
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  // The initial World read is still the authoritative refresh for this
  // terminal event; a duplicate status notification must not start another
  // resolver call while that read is in flight.
  assert.equal(fixture.worldResolveCalls(), before);
  fixture.emit({
    type: 'WORLD_ANALYSIS_STATUS_CHANGED',
    chatId: 'chat-app',
    payload: {
      state: 'success',
      trigger: 'auto-full',
      floor_version: {chat_id: 'chat-app', message_id: 0, floor: 10, swipe_id: 0, content_hash: 'world', message_version: 'v1:world'},
    },
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(fixture.worldResolveCalls(), before);
  fixture.app.closeBioWeave();
  fixture.emit({
    type: 'EVENT_ANALYSIS_STATUS_CHANGED',
    chatId: 'chat-app',
    payload: {
      state: 'success',
      attempt: 1,
      reason: 'CHARACTER_MESSAGE_RENDERED',
      floor_version: {chat_id: 'chat-app', message_id: 0, floor: 10, swipe_id: 0, content_hash: 'closed', message_version: 'v1:closed'},
    },
  });
  assert.deepEqual(fixture.toasts(), [['success', 'BioWeave：分析完成']]);
  fixture.app.destroyBioWeave();
});

test('World refresh guard exists before synchronous persistence trace reentry', async () => {
  const worldModel = {schema_version: 1, species: [{name: '人类', biological_types: []}], exceptions: [], unknowns: []};
  const fixture = await createFixture({worldModel, reemitPersistenceTrace: true});
  fixture.app.go('world');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(fixture.worldResolveCalls(), 1);
  assert.equal(fixture.persistenceTrace().filter(entry => entry.stage === 'WORLD_UI_REFRESH_REQUESTED').length, 1);
  assert.ok(fixture.persistenceTrace().some(entry => entry.stage === 'UI_REFRESH_CYCLE_BEGIN'));
  assert.ok(fixture.persistenceTrace().some(entry => entry.stage === 'UI_REFRESH_CYCLE_END'));
  fixture.app.destroyBioWeave();
});

test('Persistence trace notifications do not trigger business render or World refresh', async () => {
  const worldModel = {schema_version: 1, species: [{name: '人类', biological_types: []}], exceptions: [], unknowns: []};
  const fixture = await createFixture({worldModel});
  fixture.app.go('world');
  await new Promise(resolve => setTimeout(resolve, 0));
  const before = fixture.worldResolveCalls();
  fixture.emit({
    type: 'BIOWEAVE_PERSISTENCE_TRACE',
    chatId: 'chat-app',
    payload: {stage: 'WORLD_UI_REFRESH_REQUESTED'},
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(fixture.worldResolveCalls(), before);
  fixture.app.destroyBioWeave();
});

test('disabled BioWeave ignores late terminal status Toasts', async () => {
  const fixture = await createFixture({analysisState: 'not_analyzed'});
  fixture.runtime.setEnabled(false);
  fixture.emit({
    type: 'EVENT_ANALYSIS_STATUS_CHANGED',
    payload: {
      state: 'success',
      attempt: 1,
      reason: 'CHARACTER_MESSAGE_RENDERED',
      floor_version: {chat_id: 'chat-app', message_id: 0, floor: 10, swipe_id: 0, content_hash: 'late', message_version: 'v1:late'},
    },
  });
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
    story_time: {value: current.story_time.display},
    relevant: {value: 'false'},
    possible_conception: {value: 'false'},
    gestational_subject_ids: {value: ['char-a'], multiple: true, selectedOptions: [{value: 'char-a'}]},
    counterpart_ids: {value: ['char-b'], multiple: true, selectedOptions: [{value: 'char-b'}]},
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
  assert.equal(fixture.getFloor().events[0].pregnancy_relevance.relevant, false);
  assert.equal(fixture.getFloor().events[0].pregnancy_relevance.possible_conception, false);
  assert.deepEqual(fixture.getFloor().events[0].pregnancy_relevance.gestational_subject_ids, ['char-a']);
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

test('Event edit reads collapsed person pickers as stable ID arrays', async () => {
  const version = await floorVersion({chatId: 'chat-app', messageId: 0, floor: 10, swipeId: 0, text: '当前楼层剧情'})
  const fixture = await createFixture({event: sourceEvent(version)})
  fixture.app.go('events')
  const current = fixture.getFloor().events[0]
  const picker = (values, selected) => ({
    dataset: {bioweaveEventField: 'person-picker'},
    querySelectorAll(selector) {
      if (selector.includes(':checked')) return selected.map(value => ({value, checked: true}))
      return values.map(value => ({value, checked: selected.includes(value)}))
    },
  })
  const fields = {
    type: {value: current.type},
    status: {value: current.status},
    location: {value: current.location},
    story_time: {value: current.story_time.display},
    relevant: {value: 'true'},
    possible_conception: {value: 'true'},
    gestational_subject_ids: picker(['char-a', 'char-c'], ['char-c']),
    counterpart_ids: picker(['char-a', 'char-b'], ['char-a']),
  }
  const form = {
    dataset: {bioweaveEventId: current.event_id},
    querySelector(selector) {
      const match = selector.match(/data-bioweave-event-field="([^"]+)"/)
      return match ? fields[match[1]] ?? null : null
    },
  }
  fixture.root.selectorNodes.set('[data-bioweave-event-form]', [form])
  const click = [...fixture.root.listeners.get('click')][0]
  await click({target: clickTarget('save-event', {root: fixture.root, bioweaveEventId: current.event_id}), preventDefault() {}})
  assert.deepEqual(fixture.getFloor().events[0].pregnancy_relevance.gestational_subject_ids, ['char-c'])
  assert.deepEqual(fixture.getFloor().events[0].pregnancy_relevance.counterpart_ids, ['char-a'])
  fixture.app.destroyBioWeave()
})

test('Event person picker updates the draft and summary in place while remaining open', async () => {
  const version = await floorVersion({chatId: 'chat-app', messageId: 0, floor: 10, swipeId: 0, text: '当前楼层剧情'})
  const fixture = await createFixture({event: sourceEvent(version)})
  fixture.app.go('events')
  const current = fixture.getFloor().events[0]
  const click = [...fixture.root.listeners.get('click')][0]
  await click({target: clickTarget('edit-event', {root: fixture.root, bioweaveEventId: current.event_id}), preventDefault() {}})
  const selectedText = {textContent: 'Alice'}
  const summary = {querySelector(selector) { return selector.includes('selected') ? selectedText : null }}
  const optionLabel = label => ({querySelector() { return {textContent: label} }})
  const charA = {value: 'char-a', checked: true, dataset: {bioweaveEventPersonOption: 'char-a'}, parentElement: optionLabel('Alice')}
  const charB = {value: 'char-b', checked: true, dataset: {bioweaveEventPersonOption: 'char-b'}, parentElement: optionLabel('B')}
  const picker = {
    dataset: {bioweaveEventField: 'gestational_subject_ids'},
    open: true,
    querySelector(selector) { return selector.includes('selected') ? selectedText : selector.includes('summary') ? summary : null },
    querySelectorAll(selector) { return selector.includes('data-bioweave-event-person-option') ? [charA, charB] : [] },
  }
  const personTarget = {
    __root: fixture.root,
    dataset: {bioweaveEventPersonOption: 'char-b'},
    checked: true,
    value: 'char-b',
    parentElement: charB.parentElement,
    closest(selector) {
      if (selector.includes('[data-bioweave-event-person-option]')) return this
      if (selector.includes('[data-bioweave-event-field]') || selector.includes('.bioweave-event-person-picker')) return picker
      return null
    },
  }
  const change = [...fixture.root.listeners.get('change')][0]
  await change({target: personTarget})
  assert.equal(fixture.calls().update, 0)
  assert.equal(selectedText.textContent, '已选 2 人：Alice、B')
  assert.equal(picker.open, true)
  personTarget.checked = false
  charB.checked = false
  await change({target: personTarget})
  assert.equal(selectedText.textContent, 'Alice')
  assert.equal(picker.open, true)
  fixture.root.selectorNodes.set('.bioweave-event-person-picker[open]', [picker])
  await click({target: {__root: fixture.root, closest() { return null }}, preventDefault() {}})
  assert.equal(picker.open, false)
  fixture.app.destroyBioWeave()
})

test('Event edit keeps persistence success distinct from a later business refresh failure', async () => {
  const version = await floorVersion({chatId: 'chat-app', messageId: 0, floor: 10, swipeId: 0, text: '当前楼层剧情'});
  const fixture = await createFixture({event: sourceEvent(version)});
  fixture.app.go('events');
  const current = fixture.getFloor().events[0];
  const fields = {
    type: {value: current.type},
    status: {value: current.status},
    location: {value: current.location},
    story_time: {value: current.story_time.display},
  };
  const form = {
    dataset: {bioweaveEventId: current.event_id},
    querySelector(selector) {
      const match = selector.match(/data-bioweave-event-field="([^"]+)"/);
      return match ? fields[match[1]] ?? null : null;
    },
  };
  fixture.root.selectorNodes.set('[data-bioweave-event-form]', [form]);
  fixture.setBusinessDataFailure(Object.assign(new Error('REFRESH_FAILED'), {code: 'REFRESH_FAILED'}));
  const click = [...fixture.root.listeners.get('click')][0];
  await click({
    target: clickTarget('save-event', {root: fixture.root, bioweaveEventId: current.event_id}),
    preventDefault() {},
  });
  assert.equal(fixture.calls().update, 1);
  assert.equal(fixture.getFloor().events[0].location, current.location);
  assert.deepEqual(fixture.toasts(), [['error', '事件已保存，但业务视图刷新失败，请刷新页面。']]);
  fixture.app.destroyBioWeave();
});

test('Event edit failure keeps the same card in edit mode with the draft available for retry', async () => {
  const version = await floorVersion({chatId: 'chat-app', messageId: 0, floor: 10, swipeId: 0, text: '当前楼层剧情'});
  const fixture = await createFixture({
    event: sourceEvent(version),
    updateEventError: Object.assign(new Error('EVENT_EDIT_PERSISTENCE_FAILED'), {code: 'EVENT_EDIT_PERSISTENCE_FAILED'}),
  });
  fixture.app.go('events');
  const current = fixture.getFloor().events[0];
  const click = [...fixture.root.listeners.get('click')][0];
  await click({target: clickTarget('edit-event', {root: fixture.root, bioweaveEventId: current.event_id}), preventDefault() {}});
  const fields = {
    type: {value: current.type},
    status: {value: current.status},
    location: {value: '重试地点'},
    story_time: {value: current.story_time.display},
  };
  const form = {
    dataset: {bioweaveEventId: current.event_id},
    querySelector(selector) {
      const match = selector.match(/data-bioweave-event-field="([^"]+)"/);
      return match ? fields[match[1]] ?? null : null;
    },
  };
  fixture.root.selectorNodes.set('[data-bioweave-event-form]', [form]);
  await click({target: clickTarget('save-event', {root: fixture.root, bioweaveEventId: current.event_id}), preventDefault() {}});
  assert.equal(fixture.calls().update, 1);
  assert.match(fixture.root.querySelector('.bioweave-main').innerHTML, /data-bioweave-event-form/);
  assert.match(fixture.root.querySelector('.bioweave-main').innerHTML, /value="重试地点"/);
  assert.deepEqual(fixture.toasts(), [['error', '事件保存失败，上一份有效事件已保留。']]);
  fixture.app.destroyBioWeave();
});

test('Event edit validation diagnostics are shown as a specific user error', async () => {
  const version = await floorVersion({chatId: 'chat-app', messageId: 0, floor: 10, swipeId: 0, text: '当前楼层剧情'});
  const fixture = await createFixture({
    event: sourceEvent(version),
    updateEventError: Object.assign(new Error('EVENT_ANALYSIS_INVALID'), {
      code: 'EVENT_ANALYSIS_INVALID',
      error_code: 'duplicate_gestational_subject_event',
      diagnostic_code: 'duplicate_gestational_subject_event',
      diagnostic_path: '$.events[1].pregnancy_relevance.gestational_subject_ids[0]',
    }),
  });
  fixture.app.go('events');
  const current = fixture.getFloor().events[0];
  const click = [...fixture.root.listeners.get('click')][0];
  await click({target: clickTarget('edit-event', {root: fixture.root, bioweaveEventId: current.event_id}), preventDefault() {}});
  const fields = {
    type: {value: current.type},
    status: {value: current.status},
    location: {value: current.location},
    story_time: {value: current.story_time.display},
  };
  fixture.root.selectorNodes.set('[data-bioweave-event-form]', [{
    dataset: {bioweaveEventId: current.event_id},
    querySelector(selector) {
      const match = selector.match(/data-bioweave-event-field="([^"]+)"/);
      return match ? fields[match[1]] ?? null : null;
    },
  }]);
  await click({target: clickTarget('save-event', {root: fixture.root, bioweaveEventId: current.event_id}), preventDefault() {}});
  assert.deepEqual(fixture.toasts(), [['error', '事件集合中的妊娠追踪对象重复，事件未保存。']]);
  fixture.app.destroyBioWeave();
});

test('UI contains no Event production or duplicated Tracking eligibility logic', () => {
  const appSource = readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');
  const characterSource = readFileSync(new URL('../ui/characters.js', import.meta.url), 'utf8');
  assert.doesNotMatch(appSource, /buildEventAnalysisInput|rebuildTrackingRegistry|shouldAnalyze\s*\(|eligibleGestationalSubjects/);
  assert.doesNotMatch(characterSource, /pregnancy_relevance\.relevant\s*===|possible_conception\s*===|can_carry_pregnancy\s*===/);
});
