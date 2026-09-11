import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntime} from '../runtime/events.js';
import {createAnalyzer} from '../ai/analyzer.js';
import {SILLYTAVERN_CURRENT_API} from '../storage/schema.js';

function eventResult(eventId = 'evt-1', overrides = {}) {
  return {
    event_id: eventId,
    type: 'sexual_activity',
    status: 'confirmed',
    story_time: {
      display: '第三日', normalized: null, day_index: null, calendar_id: null,
      provider: 'bioweave_fallback', precision: 'unknown', confidence: 0.6,
    },
    location: '房间',
    participants: [{
      character_id: 'char-a',
      display_name: 'Alice',
      event_role: 'potential_gestational_subject',
      reproductive_capabilities_used: {can_carry_pregnancy: true},
      evidence: [{kind: 'narrative', text: '明确证据'}],
    }],
    pregnancy_relevance: {
      relevant: true,
      possible_conception: true,
      gestational_subject_ids: ['char-a'],
      counterpart_ids: [],
      confidence: 0.8,
    },
    source_evidence: [{kind: 'current_floor', text: '当前楼层'}],
    ...overrides,
  };
}

function createFixture({floor = 3, messages = null, analyzer = null, rawApiResponse = null, saveFloorError = null, saveChatMetadataError = null, saveChatMetadataErrorAt = 0} = {}) {
  const listeners = new Map();
  const context = {
    chatId: 'chat-runtime',
    chat: messages ?? [{message_id: 'message-stable', floor, content: '当前剧情', role: 'assistant'}],
    chatMetadata: {},
    extensionSettings: {bioweave: {}},
    eventTypes: {
      CHAT_CHANGED: 'chat-changed', MESSAGE_UPDATED: 'message-updated', MESSAGE_EDITED: 'message-edited',
      MESSAGE_DELETED: 'message-deleted', MESSAGE_SWIPED: 'message-swiped',
      MESSAGE_SWIPE_DELETED: 'message-swipe-deleted', MESSAGE_RECEIVED: 'message-received',
      GENERATION_ENDED: 'generation-ended',
    },
    eventSource: {
      on(type, listener) { listeners.set(type, listener); },
      removeListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    },
    async saveMetadata() {},
    async saveChat() {},
  };
  let saveChatMetadataCalls = 0;
  const apiRequests = [];
  const adapter = {
    getContext: () => context,
    getChat: () => context.chat,
    getChatId: () => context.chatId,
    getChatMetadata: () => context.chatMetadata,
    getExtensionSettings: () => context.extensionSettings,
    getGlobalSettings: () => context.extensionSettings.bioweave,
    getMessage: index => context.chat[index] ?? null,
    async saveChatMetadata(key, value) {
      saveChatMetadataCalls += 1;
      if (saveChatMetadataErrorAt && saveChatMetadataCalls === saveChatMetadataErrorAt) {
        throw new Error(saveChatMetadataError ?? 'ST_METADATA_STORAGE_UNAVAILABLE');
      }
      if (saveChatMetadataError) throw new Error(saveChatMetadataError);
      context.chatMetadata[key] = structuredClone(value);
    },
    async saveFloorBioWeave(index, swipeId, value) {
      if (saveFloorError) throw new Error(saveFloorError);
      const message = context.chat[index];
      if (!message) throw new Error('MESSAGE_NOT_FOUND');
      if (message.swipes || message.swipe_info) {
        message.swipe_info ??= [];
        message.swipe_info[swipeId] ??= {};
        message.swipe_info[swipeId].extra ??= {};
        message.swipe_info[swipeId].extra.bioweave = structuredClone(value);
      } else {
        message.extra ??= {};
        message.extra.bioweave = structuredClone(value);
      }
    },
  };
  if (rawApiResponse !== null) {
    context.chatCompletionSettings = {chat_completion_source: 'openai', model: 'fixture-model'};
    context.getChatCompletionModel = () => 'fixture-model';
    context.ChatCompletionService = {
      async processRequest(request) {
        apiRequests.push(request);
        return rawApiResponse;
      },
    };
  }
  let calls = 0;
  const runtime = createRuntime({
    adapter,
    analyzer: analyzer ?? (rawApiResponse !== null
      ? createAnalyzer({
        profileResolver: () => SILLYTAVERN_CURRENT_API,
        contextResolver: () => context,
      })
      : {
        async analyzeFloor() {
          calls += 1;
          return {events: [eventResult(`evt-${calls}`)]};
        },
      }),
  });
  return {
    runtime,
    context,
    listeners,
    apiRequests,
    calls: () => calls,
    emit(type, payload) { listeners.get(type)?.(payload); },
  };
}

function canonicalApiEvent({type = 'sexual_activity', pregnancyRelevance, participants} = {}) {
  return {
    event_id: 'model-forged-event-id',
    type,
    status: 'confirmed',
    story_time: {
      display: 'fixture day', normalized: null, day_index: null, calendar_id: null,
      provider: null, precision: 'unknown', confidence: null,
    },
    location: 'location_fixture',
    participants: participants ?? [
      {
        character_id: 'character_subject',
        display_name: 'subject_display',
        event_role: 'potential_gestational_subject',
        reproductive_capabilities_used: {
          can_produce_sperm: false,
          can_produce_ova: true,
          can_be_fertilized: true,
          can_carry_pregnancy: true,
          can_cause_pregnancy: false,
        },
        evidence: [{kind: 'capability', text: 'explicit gestational capability fixture evidence'}],
      },
      {
        character_id: 'character_source',
        display_name: 'source_display',
        event_role: 'potential_conception_source',
        reproductive_capabilities_used: {
          can_produce_sperm: true,
          can_produce_ova: false,
          can_be_fertilized: false,
          can_carry_pregnancy: false,
          can_cause_pregnancy: true,
        },
        evidence: [{kind: 'capability', text: 'explicit conception-source capability fixture evidence'}],
      },
    ],
    pregnancy_relevance: pregnancyRelevance ?? {
      relevant: true,
      possible_conception: true,
      gestational_subject_ids: ['character_subject'],
      counterpart_ids: ['character_source'],
      confidence: 0.9,
    },
    source_evidence: [{kind: 'narrative', text: 'explicit current-floor exposure fixture evidence'}],
    source: {chat_id: 'model-chat', message_id: 'model-message', floor: 999, swipe_id: 9},
  };
}

async function settle() {
  await new Promise(resolve => setTimeout(resolve, 30));
}

async function withGlobalCrypto(value, callback) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    enumerable: descriptor?.enumerable ?? true,
    value,
  });
  try {
    return await callback();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    else delete globalThis.crypto;
  }
}

test('manual analysis targets the current Floor and exposes observable status', async () => {
  let input = null;
  const fixture = createFixture({analyzer: {
    async analyzeFloor(request) {
      input = request.analysisInput;
      return {events: [eventResult()]};
    },
  }});
  await fixture.runtime.init();
  const result = await fixture.runtime.refreshCurrentFloorAnalysis();
  assert.equal(result.status, 'success');
  assert.equal(input.current_floor.message_id, 'message-stable');
  const status = await fixture.runtime.getCurrentFloorAnalysisStatus();
  assert.equal(status.state, 'success');
  assert.equal(status.event_count, 1);
  assert.equal(status.floor_version.message_id, 'message-stable');
  const data = await fixture.runtime.collectActiveBusinessData();
  assert.equal(data.active_event_count, 1);
  assert.equal(data.tracking_subject_count, 1);
  assert.equal(data.tracking_decisions[0].eligible, true);
  fixture.runtime.destroy();
});

test('Runtime owns canonical Event IDs and Floor provenance', async () => {
  const fixture = createFixture({analyzer: {
    async analyzeFloor() {
      const {event_id: ignoredEventId, source: ignoredSource, ...facts} = eventResult('model-forged-id');
      return {
        events: [{
          ...facts,
          event_id: ignoredEventId,
          source: {chat_id: 'model-chat', message_id: 'model-message', floor: 999, swipe_id: 9},
        }],
      };
    },
  }});
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const first = (await fixture.runtime.getCurrentFloorEvents())[0];
  assert.notEqual(first.event_id, 'model-forged-id');
  assert.deepEqual(first.source, {
    chat_id: 'chat-runtime',
    message_id: 'message-stable',
    floor: 3,
    swipe_id: 0,
    content_hash: first.source.content_hash,
    message_version: first.source.message_version,
  });
  const firstId = first.event_id;
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const second = (await fixture.runtime.getCurrentFloorEvents())[0];
  assert.equal(second.event_id, firstId);
  const registry = await fixture.runtime.getTrackingRegistry();
  assert.deepEqual(registry.tracking_subjects['char-a'].exposure_event_ids, [firstId]);
  await fixture.runtime.updateEvent(firstId, {location: 'updated-location'});
  assert.equal((await fixture.runtime.getCurrentFloorEvents())[0].location, 'updated-location');
  await fixture.runtime.deleteEvent(firstId);
  assert.deepEqual(await fixture.runtime.getCurrentFloorEvents(), []);
  fixture.runtime.destroy();
});

test('generic API response with legacy source reaches Floor save, Registry, and business DTOs', async () => {
  const eventA = canonicalApiEvent();
  const eventB = canonicalApiEvent({
    type: 'physical_symptom',
    participants: [{
      character_id: 'character_subject',
      display_name: 'subject_display',
      event_role: 'other_participant',
      reproductive_capabilities_used: {
        can_produce_sperm: null,
        can_produce_ova: null,
        can_be_fertilized: null,
        can_carry_pregnancy: null,
        can_cause_pregnancy: null,
      },
      evidence: [{kind: 'narrative', text: 'explicit symptom fixture evidence'}],
    }],
    pregnancyRelevance: {
      relevant: false,
      possible_conception: false,
      gestational_subject_ids: [],
      counterpart_ids: [],
      confidence: null,
    },
  });
  const eventC = canonicalApiEvent({
    type: 'medical_event',
    participants: [
      {
        character_id: 'character_other',
        display_name: 'other_display',
        event_role: 'other_participant',
        reproductive_capabilities_used: {
          can_produce_sperm: null,
          can_produce_ova: null,
          can_be_fertilized: null,
          can_carry_pregnancy: null,
          can_cause_pregnancy: null,
        },
        evidence: [{kind: 'narrative', text: 'explicit medical participant fixture evidence'}],
      },
      {
        character_id: 'character_subject',
        display_name: 'subject_display',
        event_role: 'other_participant',
        reproductive_capabilities_used: {
          can_produce_sperm: null,
          can_produce_ova: null,
          can_be_fertilized: null,
          can_carry_pregnancy: null,
          can_cause_pregnancy: null,
        },
        evidence: [{kind: 'narrative', text: 'explicit medical subject fixture evidence'}],
      },
    ],
    pregnancyRelevance: {
      relevant: false,
      possible_conception: false,
      gestational_subject_ids: [],
      counterpart_ids: [],
      confidence: null,
    },
  });
  const fixture = createFixture({
    rawApiResponse: JSON.stringify({
      schema_version: 1,
      events: [eventA, eventB, eventC],
      source: {chat_id: 'legacy-chat', message_id: 'legacy-message', floor: 999},
    }),
  });
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();

  assert.equal(fixture.apiRequests.length, 1);
  const events = await fixture.runtime.getCurrentFloorEvents();
  assert.equal(events.length, 3);
  assert.equal(events[0].type, 'sexual_activity');
  assert.equal(events[0].participants.length, 2);
  assert.equal(events[0].participants[1].character_id, 'character_source');
  assert.equal(events[0].participants[1].reproductive_capabilities_used.can_carry_pregnancy, false);
  assert.notEqual(events[0].event_id, 'model-forged-event-id');
  assert.equal(events[0].source.chat_id, 'chat-runtime');
  assert.equal(events[0].source.message_id, 'message-stable');
  assert.equal(events[0].source.floor, 3);
  assert.equal(events[1].type, 'physical_symptom');
  assert.equal(events[2].type, 'medical_event');
  assert.deepEqual(events[2].participants.map(participant => participant.character_id), [
    'character_other', 'character_subject',
  ]);

  const data = await fixture.runtime.collectActiveBusinessData();
  assert.equal(data.active_event_count, 3);
  assert.equal(data.tracking_subject_count, 1);
  assert.deepEqual(data.tracking_subjects.character_subject.exposure_event_ids, [events[0].event_id]);
  assert.equal(data.tracking_subjects.character_source, undefined);
  assert.equal(data.tracking_subjects.character_other, undefined);
  fixture.runtime.destroy();
});

test('HTTP-like crypto without subtle still reaches analyzer and persists a complete Floor Version', {concurrency: false}, async () => {
  let analyzed = 0;
  const fixture = createFixture({analyzer: {
    async analyzeFloor(request) {
      analyzed += 1;
      assert.equal(request.floor_version.content_hash.length, 64);
      return {events: []};
    },
  }});
  await withGlobalCrypto({subtle: undefined}, async () => {
    await fixture.runtime.init();
    const result = await fixture.runtime.refreshCurrentFloorAnalysis();
    assert.equal(result.status, 'success');
    assert.equal(analyzed, 1);
    const stored = fixture.runtime.store.getFloor(0);
    assert.equal(stored.analysis.floor_version.content_hash.length, 64);
    assert.deepEqual(Object.keys(stored.analysis.floor_version), [
      'chat_id', 'message_id', 'floor', 'swipe_id', 'content_hash', 'message_version',
    ]);
  });
  fixture.runtime.destroy();
});

test('Runtime sends the target floor through the shared per-floor regex pipeline', async () => {
  let analysisInput = null;
  const fixture = createFixture({
    messages: [{
      message_id: 'message-target',
      floor: 3,
      role: 'assistant',
      content: '<target>TARGET_PROCESSED</target>',
    }],
    analyzer: {
      async analyzeFloor(request) {
        analysisInput = request.analysisInput;
        return {events: []};
      },
    },
  });
  fixture.context.chatMetadata.bioweave = {
    chat_scope: {chat_id: 'chat-runtime'},
    settings: {
      recent_story: {
        enabled: true,
        floor_count: 4,
        regex_user_enabled: false,
        regex_rules: [{
          pattern: '/<target>(.*?)<\\/target>/',
          type: 'extract',
          enabled: true,
        }],
      },
    },
    tracking_subjects: {},
  };
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  assert.equal(analysisInput.current_floor.narrative, 'TARGET_PROCESSED');
  fixture.runtime.destroy();
});

test('Floor Version preflight failures expose safe diagnostics without throwing status or business DTO reads', {concurrency: false}, async () => {
  const digestError = new Error('DIGEST_BROKE');
  digestError.code = 'DIGEST_BROKE';
  const fixture = createFixture();
  await withGlobalCrypto({subtle: {async digest() { throw digestError; }}}, async () => {
    await fixture.runtime.init();
    const status = await fixture.runtime.getCurrentFloorAnalysisStatus();
    assert.equal(status.state, 'failed');
    assert.equal(status.busy, false);
    assert.equal(status.error_stage, 'floor_version');
    assert.equal(status.error_code, 'DIGEST_BROKE');
    assert.match(status.safe_error_summary, /Floor Version/);
    assert.doesNotMatch(status.safe_error_summary, /DIGEST_BROKE/);
    assert.equal(status.floor_version, null);
    assert.deepEqual(status.current_floor_events, []);

    const data = await fixture.runtime.collectActiveBusinessData();
    assert.equal(data.analysis_status.error_stage, 'floor_version');
    assert.equal(data.analysis_status.error_code, 'DIGEST_BROKE');
    assert.equal(data.floor_version, null);
    assert.deepEqual(data.active_events, []);
    assert.equal(fixture.runtime.store.getFloor(0).analysis, null);
    await assert.rejects(fixture.runtime.refreshCurrentFloorAnalysis(), /DIGEST_BROKE/);
  });
  fixture.runtime.destroy();
});

test('analysis status exposes running state and attempt while the analyzer is busy', async () => {
  let release;
  const fixture = createFixture({analyzer: {
    analyzeFloor: () => new Promise(resolve => {
      release = () => resolve({events: []});
    }),
  }});
  await fixture.runtime.init();
  const pending = fixture.runtime.refreshCurrentFloorAnalysis();
  await new Promise(resolve => setTimeout(resolve, 0));
  const running = await fixture.runtime.getCurrentFloorAnalysisStatus();
  assert.equal(running.state, 'running');
  assert.equal(running.busy, true);
  assert.equal(running.attempt, 1);
  release();
  await pending;
  fixture.runtime.destroy();
});

test('successful Floor skips non-force analysis and force success replaces Events', async () => {
  const fixture = createFixture();
  await fixture.runtime.init();
  await fixture.runtime.analyzeCurrentFloor();
  const firstId = (await fixture.runtime.getCurrentFloorEvents())[0].event_id;
  await fixture.runtime.analyzeCurrentFloor();
  assert.equal(fixture.calls(), 1);
  await fixture.runtime.refreshCurrentFloorAnalysis();
  assert.equal(fixture.calls(), 2);
  assert.deepEqual((await fixture.runtime.getCurrentFloorEvents()).map(event => event.event_id), [firstId]);
  fixture.runtime.destroy();
});

test('failed force refresh preserves the previous successful Events and records failure', async () => {
  let calls = 0;
  const fixture = createFixture({analyzer: {
    async analyzeFloor() {
      calls += 1;
      if (calls === 2) throw new Error('JSON_SCHEMA_INVALID');
      return {events: [eventResult('evt-success')]};
    },
  }});
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const firstId = (await fixture.runtime.getCurrentFloorEvents())[0].event_id;
  await assert.rejects(fixture.runtime.refreshCurrentFloorAnalysis(), /JSON_SCHEMA_INVALID/);
  const status = await fixture.runtime.getCurrentFloorAnalysisStatus();
  assert.equal(status.state, 'failed');
  assert.equal(status.last_error, 'JSON_SCHEMA_INVALID');
  assert.deepEqual(status.current_floor_events.map(event => event.event_id), [firstId]);
  fixture.runtime.destroy();
});

test('failed analysis of an edited Floor removes old-version exposures from active Registry', async () => {
  let calls = 0;
  const fixture = createFixture({analyzer: {
    async analyzeFloor() {
      calls += 1;
      if (calls === 2) throw new Error('REQUEST_TIMEOUT');
      return {events: [eventResult('evt-old-version')]};
    },
  }});
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  fixture.context.chat[0].content = '编辑后的当前剧情';
  await assert.rejects(fixture.runtime.analyzeCurrentFloor(), /REQUEST_TIMEOUT/);
  const data = await fixture.runtime.collectActiveBusinessData();
  assert.equal(data.state, 'failed');
  assert.equal(data.active_event_count, 0);
  assert.equal(data.tracking_subject_count, 0);
  fixture.runtime.destroy();
});

test('Runtime lifecycle performs interval analysis without any UI subscriber', async () => {
  const fixture = createFixture({floor: 3});
  await fixture.runtime.init();
  fixture.emit('message-received', {message_id: 'message-stable'});
  await settle();
  assert.equal(fixture.calls(), 1);
  fixture.emit('generation-ended', {message_id: 'message-stable'});
  await settle();
  assert.equal(fixture.calls(), 1);
  fixture.runtime.destroy();
});

test('lifecycle stable message id and swipe switch select the authoritative Floor Version', async () => {
  const message = {
    message_id: 'message-swipe', floor: 3, swipe_id: 0,
    swipes: ['版本 A', '版本 B'], swipe_info: [{}, {}], role: 'assistant',
  };
  const fixture = createFixture({messages: [message]});
  await fixture.runtime.init();
  fixture.emit('message-received', {message_id: 'message-swipe'});
  await settle();
  const firstId = (await fixture.runtime.getCurrentFloorEvents())[0].event_id;
  message.swipe_id = 1;
  fixture.emit('message-swiped', {message_id: 'message-swipe'});
  await settle();
  const events = await fixture.runtime.getCurrentFloorEvents();
  assert.equal(events.length, 1);
  assert.notEqual(events[0].event_id, firstId);
  assert.equal(events[0].source.swipe_id, 1);
  fixture.runtime.destroy();
});

test('stable lifecycle message IDs are not confused with array indexes', async () => {
  const fixture = createFixture({messages: [
    {message_id: '0', floor: 3, content: '楼层三', role: 'assistant'},
    {message_id: '1', floor: 1, content: '楼层一', role: 'assistant'},
  ]});
  await fixture.runtime.init();
  fixture.emit('message-received', {message_id: '0'});
  await settle();
  assert.equal(fixture.runtime.store.getFloor(0).analysis.floor_version.message_id, '0');
  assert.equal(fixture.runtime.store.getFloor(0).analysis.floor_version.floor, 3);
  assert.equal(fixture.runtime.store.getFloor(1).analysis, null);
  fixture.runtime.destroy();
});

test('event edit updates the Floor fact and delete rebuilds Registry without dangling refs', async () => {
  const fixture = createFixture();
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const eventId = (await fixture.runtime.getCurrentFloorEvents())[0].event_id;
  await fixture.runtime.updateEvent(eventId, {location: '新地点'});
  assert.equal((await fixture.runtime.getCurrentFloorEvents())[0].location, '新地点');
  await fixture.runtime.deleteEvent(eventId);
  const data = await fixture.runtime.collectActiveBusinessData();
  assert.equal(data.active_event_count, 0);
  assert.equal(data.tracking_subject_count, 0);
  fixture.runtime.destroy();
});

test('deleted Floor facts and inactive swipes no longer participate', async () => {
  const fixture = createFixture();
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  assert.equal((await fixture.runtime.collectActiveBusinessData()).active_event_count, 1);
  fixture.context.chat.splice(0, 1);
  fixture.emit('message-deleted', {message_id: 'message-stable'});
  await settle();
  const data = await fixture.runtime.collectActiveBusinessData();
  assert.equal(data.active_event_count, 0);
  assert.equal(data.tracking_subject_count, 0);
  fixture.runtime.destroy();
});

test('API failure exits running and exposes the real request diagnostic', async () => {
  const fixture = createFixture({analyzer: {
    async analyzeFloor() {
      const error = new Error('REQUEST_TIMEOUT');
      error.code = 'REQUEST_TIMEOUT';
      throw error;
    },
  }});
  await fixture.runtime.init();
  await assert.rejects(fixture.runtime.refreshCurrentFloorAnalysis(), /REQUEST_TIMEOUT/);
  const status = await fixture.runtime.getCurrentFloorAnalysisStatus();
  assert.equal(status.busy, false);
  assert.equal(status.state, 'failed');
  assert.equal(status.error_stage, 'api_request');
  assert.equal(status.error_code, 'REQUEST_TIMEOUT');
  assert.match(status.safe_error_summary, /超时/);
  fixture.runtime.destroy();
});

test('Domain validation failure keeps a specific diagnostic code and path', async () => {
  const fixture = createFixture({analyzer: {
    async analyzeFloor() {
      return {events: [eventResult('ignored-by-runtime', {type: 'not_a_biological_event_type'})]};
    },
  }});
  await fixture.runtime.init();
  await assert.rejects(fixture.runtime.refreshCurrentFloorAnalysis(), /EVENT_DOMAIN_VALIDATION_FAILED/);
  const status = await fixture.runtime.getCurrentFloorAnalysisStatus();
  assert.equal(status.busy, false);
  assert.equal(status.state, 'failed');
  assert.equal(status.error_code, 'domain_validation_failed');
  assert.equal(status.error_path, '$.events[0].type');
  assert.match(status.safe_error_summary, /Event JSON Schema/);
  fixture.runtime.destroy();
});

test('response parse failure exits running with a response_parse diagnostic', async () => {
  const fixture = createFixture({analyzer: {
    async analyzeFloor() {
      const error = new Error('EVENT_RESPONSE_JSON_INVALID');
      error.code = 'EVENT_ANALYSIS_INVALID';
      error.analysis_stage = 'response_parse';
      throw error;
    },
  }});
  await fixture.runtime.init();
  await assert.rejects(fixture.runtime.refreshCurrentFloorAnalysis(), /EVENT_RESPONSE_JSON_INVALID/);
  const status = await fixture.runtime.getCurrentFloorAnalysisStatus();
  assert.equal(status.busy, false);
  assert.equal(status.state, 'failed');
  assert.equal(status.error_stage, 'response_parse');
  assert.equal(status.error_code, 'EVENT_RESPONSE_JSON_INVALID');
  fixture.runtime.destroy();
});

test('Floor save failure exits running even when failure metadata cannot be saved', async () => {
  const fixture = createFixture({saveFloorError: 'ST_FLOOR_STORAGE_UNAVAILABLE'});
  await fixture.runtime.init();
  await assert.rejects(fixture.runtime.refreshCurrentFloorAnalysis(), /ST_FLOOR_STORAGE_UNAVAILABLE/);
  const status = await fixture.runtime.getCurrentFloorAnalysisStatus();
  assert.equal(status.busy, false);
  assert.equal(status.state, 'failed');
  assert.equal(status.error_stage, 'floor_save');
  assert.equal(status.error_code, 'ST_FLOOR_STORAGE_UNAVAILABLE');
  fixture.runtime.destroy();
});

test('Registry rebuild failure exits running while the Floor Event remains available', async () => {
  const fixture = createFixture({saveChatMetadataErrorAt: 3});
  await fixture.runtime.init();
  await settle();
  await assert.rejects(fixture.runtime.refreshCurrentFloorAnalysis(), /ST_METADATA_STORAGE_UNAVAILABLE/);
  const status = await fixture.runtime.getCurrentFloorAnalysisStatus();
  assert.equal(status.busy, false);
  assert.equal(status.state, 'failed');
  assert.equal(status.error_stage, 'registry_rebuild');
  assert.equal(status.error_code, 'ST_METADATA_STORAGE_UNAVAILABLE');
  assert.equal(status.current_floor_events.length, 1);
  fixture.runtime.destroy();
});

test('confirmed cancellation releases execution and preserves the previous successful Events', async () => {
  let release;
  let startedResolve;
  const started = new Promise(resolve => {
    startedResolve = resolve;
  });
  let calls = 0;
  const fixture = createFixture({analyzer: {
    analyzeFloor: () => {
      calls += 1;
      if (calls === 1) return Promise.resolve({events: [eventResult('prior-event')]});
      return new Promise(resolve => {
        release = resolve;
        startedResolve();
      });
    },
  }});
  await fixture.runtime.init();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const previousId = (await fixture.runtime.getCurrentFloorEvents())[0].event_id;
  const pending = fixture.runtime.refreshCurrentFloorAnalysis();
  await started;
  const running = await fixture.runtime.getCurrentFloorAnalysisStatus();
  assert.equal(running.state, 'running');
  assert.equal(await fixture.runtime.requestAbortCurrentFloorAnalysis(), true);
  const cancelled = await fixture.runtime.getCurrentFloorAnalysisStatus();
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(cancelled.busy, false);
  assert.equal(cancelled.error_code, 'REQUEST_ABORTED');
  assert.deepEqual(cancelled.current_floor_events.map(event => event.event_id), [previousId]);
  release({events: [eventResult('late-event')]});
  await assert.rejects(pending, /REQUEST_ABORTED/);
  assert.deepEqual((await fixture.runtime.getCurrentFloorEvents()).map(event => event.event_id), [previousId]);
  fixture.runtime.destroy();
});

test('late result from an aborted execution cannot overwrite a newer execution', async () => {
  let firstRelease;
  let calls = 0;
  const fixture = createFixture({analyzer: {
    analyzeFloor: () => {
      calls += 1;
      if (calls === 1) return new Promise(resolve => { firstRelease = resolve; });
      return Promise.resolve({events: [eventResult('new-event')]});
    },
  }});
  await fixture.runtime.init();
  const first = fixture.runtime.refreshCurrentFloorAnalysis();
  await new Promise(resolve => setTimeout(resolve, 0));
  await fixture.runtime.requestAbortCurrentFloorAnalysis();
  await fixture.runtime.refreshCurrentFloorAnalysis();
  const newId = (await fixture.runtime.getCurrentFloorEvents())[0].event_id;
  assert.notEqual(newId, 'new-event');
  firstRelease({events: [eventResult('old-event')]});
  await assert.rejects(first, /REQUEST_ABORTED/);
  assert.deepEqual((await fixture.runtime.getCurrentFloorEvents()).map(event => event.event_id), [newId]);
  fixture.runtime.destroy();
});

test('stale Chat completion releases execution without writing stale failure metadata', async () => {
  let release;
  let startedResolve;
  const started = new Promise(resolve => {
    startedResolve = resolve;
  });
  const fixture = createFixture({analyzer: {
    analyzeFloor: () => new Promise(resolve => {
      release = resolve;
      startedResolve();
    }),
  }});
  await fixture.runtime.init();
  const pending = fixture.runtime.refreshCurrentFloorAnalysis();
  await started;
  fixture.runtime.chat.invalidate('test-stale-chat');
  release({events: [eventResult('stale-event')]});
  await assert.rejects(pending, /STALE_CHAT/);
  const status = await fixture.runtime.getCurrentFloorAnalysisStatus();
  assert.equal(status.busy, false);
  assert.equal(status.state, 'failed');
  assert.equal(fixture.runtime.store.getFloor(0).analysis, null);
  assert.deepEqual(await fixture.runtime.getCurrentFloorEvents(), []);
  fixture.runtime.destroy();
});
