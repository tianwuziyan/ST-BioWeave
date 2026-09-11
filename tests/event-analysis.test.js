import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEventAnalysisMessages} from '../ai/prompts.js';
import {buildEventAnalysisInput} from '../ai/input-builder.js';
import {createAnalyzer, parseEventAnalysisResponse} from '../ai/analyzer.js';
import {SILLYTAVERN_CURRENT_API} from '../storage/schema.js';

const floorVersion = {
  chat_id: 'chat-authoritative',
  message_id: 'message-current',
  floor: 12,
  swipe_id: 1,
  content_hash: 'hash-current',
  message_version: 'v2',
};

function participant(characterId, overrides = {}) {
  return {
    character_id: characterId,
    display_name: characterId,
    event_role: 'unknown',
    reproductive_capabilities_used: {
      can_produce_sperm: null,
      can_produce_ova: null,
      can_be_fertilized: null,
      can_fertilize: null,
      can_carry_pregnancy: null,
    },
    evidence: [{kind: 'narrative', text: `${characterId} 出现在当前事件中。`}],
    ...overrides,
  };
}

function event(overrides = {}) {
  return {
    event_id: 'event-current-1',
    type: 'sexual_activity',
    status: 'confirmed',
    story_time: {
      display: '第十二楼',
      normalized: null,
      calendar_id: 'calendar-main',
      day_index: null,
      provider: 'bioweave_fallback',
      precision: 'unknown',
      confidence: null,
    },
    location: '当前地点',
    participants: [participant('char-a'), participant('char-b')],
    pregnancy_relevance: {
      relevant: null,
      possible_conception: null,
      gestational_subject_ids: [],
      counterpart_ids: [],
      confidence: null,
    },
    source_evidence: [{kind: 'current_floor', text: '当前楼层事件证据。'}],
    source: {...floorVersion, chat_id: 'model-invented-chat'},
    ...overrides,
  };
}

function response(events = [event()]) {
  return JSON.stringify({schema_version: 1, events});
}

test('Event input and prompt carry the authoritative boundary without secrets', () => {
  const input = buildEventAnalysisInput({
    chatId: floorVersion.chat_id,
    floorVersion,
    currentFloor: {floor: 12, message_id: 'message-current', swipe_id: 1, narrative: '当前楼层剧情。'},
    recentContext: [{floor: 11, role: 'assistant', content: '上一楼剧情。'}],
    worldModel: {species: [], api_key: 'DO-NOT-SEND'},
    storyTime: {display: '第十二楼', normalized: null, precision: 'unknown'},
    characterContext: {characters: [{character_id: 'char-a', evidence: '角色证据'}]},
  });
  assert.deepEqual(input.chat_scope, {chat_id: 'chat-authoritative'});
  assert.deepEqual(input.floor_version, floorVersion);
  assert.equal(input.current_floor.narrative, '当前楼层剧情。');
  assert.equal(input.recent_context[0].content, '上一楼剧情。');
  assert.deepEqual(input.story_time, {
    display: '第十二楼',
    normalized: null,
    calendar_id: null,
    day_index: null,
    provider: null,
    precision: 'unknown',
    confidence: null,
  });
  assert.equal(JSON.stringify(input).includes('DO-NOT-SEND'), false);

  const messages = buildEventAnalysisMessages(input);
  assert.deepEqual(messages.map(message => message.role), ['system', 'user']);
  assert.match(messages[0].content, /sexual_activity/);
  assert.match(messages[0].content, /World Model/);
  assert.match(messages[0].content, /gender/);
  assert.match(messages[0].content, /counterpart_ids\[\]/);
  assert.match(messages[0].content, /0、1 或 N/);
  assert.match(messages[0].content, /症状/);
  assert.match(messages[1].content, /chat_scope/);
  assert.match(messages[1].content, /floor_version/);
  assert.match(messages[1].content, /character_context/);
  assert.equal(JSON.stringify(messages).includes('DO-NOT-SEND'), false);
});

test('Event parser normalizes and force-binds every source to the authoritative Floor Version', () => {
  const parsed = parseEventAnalysisResponse(response([event({
    pregnancy_relevance: {
      relevant: true,
      possible_conception: true,
      gestational_subject_ids: ['char-a'],
      counterpart_ids: ['char-b'],
      confidence: 0.8,
    },
  })]), floorVersion);
  assert.equal(parsed.schema_version, 1);
  assert.equal(parsed.events.length, 1);
  assert.deepEqual(parsed.events[0].source, floorVersion);
  assert.deepEqual(parsed.events[0].pregnancy_relevance.counterpart_ids, ['char-b']);
  assert.deepEqual(parsed.events[0].pregnancy_relevance.gestational_subject_ids, ['char-a']);
});

test('Event parser preserves unknown capability and never derives it from gender', () => {
  const parsed = parseEventAnalysisResponse(response([event({
    participants: [participant('char-a', {gender: 'female'})],
  })]), floorVersion);
  assert.equal(parsed.events[0].participants[0].reproductive_capabilities_used.can_carry_pregnancy, null);
  assert.equal('gender' in parsed.events[0].participants[0], false);
});

test('Event parser accepts a non-sexual BiologicalEvent with the same fixed envelope', () => {
  const parsed = parseEventAnalysisResponse(response([event({
    event_id: 'symptom-1',
    type: 'physical_symptom',
    participants: [participant('char-a')],
    pregnancy_relevance: {
      relevant: false,
      possible_conception: false,
      gestational_subject_ids: [],
      counterpart_ids: [],
      confidence: 1,
    },
  })]), floorVersion);
  assert.equal(parsed.events[0].type, 'physical_symptom');
  assert.deepEqual(parsed.events[0].pregnancy_relevance.counterpart_ids, []);
});

test('Event parser rejects natural language, fenced JSON, and non-array counterpart ids', () => {
  assert.throws(
    () => parseEventAnalysisResponse('', floorVersion),
    error => error?.code === 'EVENT_ANALYSIS_INVALID'
      && error?.message === 'EVENT_RESPONSE_EMPTY'
      && error?.analysis_stage === 'response_parse',
  );
  assert.throws(
    () => parseEventAnalysisResponse('这是事件分析结果：{}', floorVersion),
    error => error?.code === 'EVENT_ANALYSIS_INVALID'
      && error?.message === 'EVENT_RESPONSE_JSON_INVALID'
      && error?.analysis_stage === 'response_parse',
  );
  assert.throws(
    () => parseEventAnalysisResponse(`\`\`\`json\n${response()}\n\`\`\``, floorVersion),
    error => error?.code === 'EVENT_ANALYSIS_INVALID',
  );
  assert.throws(
    () => parseEventAnalysisResponse(response([event({
      pregnancy_relevance: {
        relevant: true,
        possible_conception: true,
        gestational_subject_ids: ['char-a'],
        counterpart_ids: 'char-b',
        confidence: 1,
      },
    })]), floorVersion),
    error => error?.code === 'EVENT_ANALYSIS_INVALID',
  );
});

test('Event parser rejects an incomplete event envelope instead of defaulting required facts', () => {
  const incomplete = event();
  delete incomplete.pregnancy_relevance;
  assert.throws(
    () => parseEventAnalysisResponse(response([incomplete]), floorVersion),
    error => error?.code === 'EVENT_ANALYSIS_INVALID',
  );
});

test('Event parser requires the complete source envelope before authoritative rebinding', () => {
  const incomplete = event();
  delete incomplete.source.content_hash;
  assert.throws(
    () => parseEventAnalysisResponse(response([incomplete]), floorVersion),
    error => error?.code === 'EVENT_ANALYSIS_INVALID',
  );
});

test('analyzeFloor sends fixed Event messages and parses the response', async () => {
  const requests = [];
  let receivedSignal = null;
  const analyzer = createAnalyzer({
    profileResolver: () => SILLYTAVERN_CURRENT_API,
    contextResolver: () => ({
      chatCompletionSettings: {chat_completion_source: 'openai', model: 'test-model'},
      getChatCompletionModel: () => 'test-model',
      ChatCompletionService: {
        processRequest: async (request, ...args) => {
          requests.push(request);
          receivedSignal = args[2] ?? null;
          return response();
        },
      },
    }),
  });
  const controller = new AbortController();
  const parsed = await analyzer.analyzeFloor({
    analysisInput: buildEventAnalysisInput({
      chatId: floorVersion.chat_id,
      floorVersion,
      currentFloor: {narrative: '当前楼层。'},
      recentContext: [],
      worldModel: {species: []},
      storyTime: {display: '未知', precision: 'unknown'},
      characterContext: {characters: []},
    }),
    signal: controller.signal,
  });
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].messages.map(message => message.role), ['system', 'user']);
  assert.match(requests[0].messages[0].content, /只输出一个完整/);
  assert.match(requests[0].messages[1].content, /当前楼层/);
  assert.deepEqual(parsed.events[0].source, floorVersion);
  assert.ok(receivedSignal instanceof AbortSignal);
  assert.equal(receivedSignal.aborted, false);
});
