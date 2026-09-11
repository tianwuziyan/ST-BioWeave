import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEventAnalysisMessages,
  buildWorldModelMessages,
  EVENT_ANALYZER_OUTPUT_CONTRACT,
  EVENT_CAPABILITY_KEYS,
  EVENT_REPRODUCTIVE_ROLES,
  EVENT_STATUS,
  EVENT_STORY_TIME_PRECISIONS,
  EVENT_TYPES,
} from '../ai/prompts.js';
import {buildEventAnalysisInput} from '../ai/input-builder.js';
import {createAnalyzer, parseEventAnalysisResponse} from '../ai/analyzer.js';
import {renderAnalysisDebugPopupContent} from '../ui/settings.js';
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
      can_carry_pregnancy: null,
      can_cause_pregnancy: null,
    },
    evidence: [{kind: 'narrative', text: `${characterId} participates in the current event.`}],
    ...overrides,
  };
}

function event(overrides = {}) {
  return {
    event_id: 'event-current-1',
    type: 'sexual_activity',
    status: 'confirmed',
    story_time: {
      display: 'an unspecified story day',
      normalized: null,
      calendar_id: 'calendar-main',
      day_index: null,
      provider: 'bioweave_fallback',
      precision: 'unknown',
      confidence: null,
    },
    location: 'an unspecified location',
    participants: [participant('character_subject'), participant('character_source')],
    pregnancy_relevance: {
      relevant: false,
      possible_conception: false,
      gestational_subject_ids: [],
      counterpart_ids: [],
      confidence: null,
    },
    source_evidence: [{kind: 'current_floor', text: 'The current floor contains the event evidence.'}],
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
    currentFloor: {floor: 12, message_id: 'message-current', swipe_id: 1, narrative: 'Current floor narrative.'},
    recentContext: [{floor: 11, role: 'assistant', content: 'Recent narrative context.'}],
    worldModel: {species: [], api_key: 'DO-NOT-SEND'},
    storyTime: {display: 'an unspecified story day', normalized: null, precision: 'unknown'},
    characterContext: {characters: [{character_id: 'character_subject', evidence: 'character evidence'}]},
  });
  assert.deepEqual(input.chat_scope, {chat_id: 'chat-authoritative'});
  assert.deepEqual(input.floor_version, floorVersion);
  assert.equal(input.current_floor.narrative, 'Current floor narrative.');
  assert.equal(input.recent_context[0].content, 'Recent narrative context.');
  assert.deepEqual(input.story_time, {
    display: 'an unspecified story day',
    normalized: null,
    calendar_id: null,
    day_index: null,
    provider: null,
    precision: 'unknown',
    confidence: null,
  });
  assert.equal(JSON.stringify(input).includes('DO-NOT-SEND'), false);

  const messages = buildEventAnalysisMessages(input);
  assert.deepEqual(messages.map(message => message.role), [
    'system', 'assistant', 'user',
  ]);
  const prompt = messages.map(message => message.content).join('\n');
  assert.match(prompt, /sexual_activity/);
  assert.match(prompt, /World Model/);
  assert.match(prompt, /gender/);
  assert.match(prompt, /counterpart_ids\[\]/);
  assert.match(prompt, /0、1 或 N/);
  assert.match(prompt, /症状/);
  assert.match(prompt, /目标楼层：12/);
  assert.match(prompt, /Event source 由 Runtime 绑定/);
  assert.doesNotMatch(prompt, /Chat ID:/);
  assert.doesNotMatch(prompt, /character_context/);
  assert.equal(JSON.stringify(messages).includes('DO-NOT-SEND'), false);
});

test('Event parser returns normalized facts without AI-owned identity or source', () => {
  const parsed = parseEventAnalysisResponse(response([event({
    pregnancy_relevance: {
      relevant: true,
      possible_conception: true,
      gestational_subject_ids: ['character_subject'],
      counterpart_ids: ['character_source'],
      confidence: 0.8,
    },
  })]), floorVersion);
  assert.equal(parsed.schema_version, 1);
  assert.equal(parsed.events.length, 1);
  assert.equal('event_id' in parsed.events[0], false);
  assert.equal('source' in parsed.events[0], false);
  assert.deepEqual(parsed.events[0].pregnancy_relevance.counterpart_ids, ['character_source']);
  assert.deepEqual(parsed.events[0].pregnancy_relevance.gestational_subject_ids, ['character_subject']);
});

test('Event parser preserves unknown capability and never derives it from gender', () => {
  const parsed = parseEventAnalysisResponse(response([event({
    participants: [participant('character_subject', {fixture_label: 'receiver-like label'})],
  })]), floorVersion);
  assert.equal(parsed.events[0].participants[0].reproductive_capabilities_used.can_carry_pregnancy, null);
  assert.equal('gender' in parsed.events[0].participants[0], false);
});

test('Event parser accepts a non-sexual BiologicalEvent with the same fixed envelope', () => {
  const parsed = parseEventAnalysisResponse(response([event({
    event_id: 'symptom-1',
    type: 'physical_symptom',
    participants: [participant('character_subject')],
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
        gestational_subject_ids: ['character_subject'],
        counterpart_ids: 'character_source',
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

test('Event parser ignores an incomplete legacy source instead of trusting it', () => {
  const incomplete = event();
  delete incomplete.source.content_hash;
  const parsed = parseEventAnalysisResponse(response([incomplete]), floorVersion);
  assert.equal('event_id' in parsed.events[0], false);
  assert.equal('source' in parsed.events[0], false);
});

test('analyzeFloor sends contract-bound Event messages and parses the response', async () => {
  const requests = [];
  let receivedSignal = null;
  const analyzer = createAnalyzer({
    profileResolver: () => SILLYTAVERN_CURRENT_API,
    analysisPromptResolver: () => ({task: 'EVENT_ANALYZER_COMMON_MARKER'}),
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
      currentFloor: {narrative: 'Current floor narrative.'},
      recentContext: [],
      worldModel: {species: []},
      storyTime: {display: 'unknown', precision: 'unknown'},
      characterContext: {characters: []},
    }),
    signal: controller.signal,
  });
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].messages.map(message => message.role), [
    'system', 'assistant', 'user',
  ]);
  const requestText = requests[0].messages.map(message => message.content).join('\n');
  assert.match(requestText, /EVENT_ANALYZER_COMMON_MARKER/);
  assert.match(requestText, /只输出一个完整/);
  assert.match(requestText, /Current floor narrative/);
  assert.equal('event_id' in parsed.events[0], false);
  assert.equal('source' in parsed.events[0], false);
  assert.ok(receivedSignal instanceof AbortSignal);
  assert.equal(receivedSignal.aborted, false);
});

test('World Model analyzer injects the same common analysis prompt layer', async () => {
  const requests = [];
  const analyzer = createAnalyzer({
    profileResolver: () => SILLYTAVERN_CURRENT_API,
    analysisPromptResolver: () => ({task: 'WORLD_ANALYZER_COMMON_MARKER'}),
    contextResolver: () => ({
      chatCompletionSettings: {chat_completion_source: 'openai', model: 'test-model'},
      getChatCompletionModel: () => 'test-model',
      ChatCompletionService: {
        processRequest: async request => {
          requests.push(request);
          return JSON.stringify({
            schema_version: 1,
            species: [],
            medical_context: {childbirth_difficulty: null, care_level: null, evidence: null},
            exceptions: [],
            unknowns: [],
          });
        },
      },
    }),
  });
  await analyzer.analyzeWorldModel({analysisInput: {character: {}, worldbooks: [], recent_story: {items: []}}});
  assert.equal(requests.length, 1);
  const requestText = requests[0].messages.map(message => message.content).join('\n');
  assert.match(requestText, /WORLD_ANALYZER_COMMON_MARKER/);
  assert.match(requestText, /整理当前 Chat 的生物学世界规则/);
});

function conceptionFixture() {
  return event({
    participants: [
      participant('character_subject', {
        event_role: 'potential_gestational_subject',
        reproductive_capabilities_used: {
          can_produce_sperm: false,
          can_produce_ova: true,
          can_be_fertilized: true,
          can_carry_pregnancy: true,
          can_cause_pregnancy: false,
        },
        evidence: [{kind: 'capability', text: 'The current evidence supports gestational capability.'}],
      }),
      participant('character_source', {
        event_role: 'potential_conception_source',
        reproductive_capabilities_used: {
          can_produce_sperm: true,
          can_produce_ova: false,
          can_be_fertilized: false,
          can_carry_pregnancy: false,
          can_cause_pregnancy: true,
        },
        evidence: [{kind: 'capability', text: 'The current evidence supports conception-source capability.'}],
      }),
    ],
    pregnancy_relevance: {
      relevant: true,
      possible_conception: true,
      gestational_subject_ids: ['character_subject'],
      counterpart_ids: ['character_source'],
      confidence: 0.9,
    },
    source_evidence: [{kind: 'narrative', text: 'The current floor establishes actual conception exposure.'}],
  });
}

function aiOnlyEvent(overrides = {}) {
  const {event_id: ignoredEventId, source: ignoredSource, ...facts} = conceptionFixture();
  return {...facts, ...overrides};
}

test('Event protected output contract exposes the exact Domain enums and scalar types', () => {
  for (const value of [...EVENT_TYPES, ...EVENT_STATUS, ...EVENT_REPRODUCTIVE_ROLES, ...EVENT_CAPABILITY_KEYS, ...EVENT_STORY_TIME_PRECISIONS]) {
    assert.match(EVENT_ANALYZER_OUTPUT_CONTRACT, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(EVENT_ANALYZER_OUTPUT_CONTRACT, /relevant 与 possible_conception 都只能是 boolean/);
  assert.match(EVENT_ANALYZER_OUTPUT_CONTRACT, /participant\.evidence 与 source_evidence 都必须是数组/);
  assert.match(EVENT_ANALYZER_OUTPUT_CONTRACT, /\{"kind":"\.\.\.","text":"\.\.\."\}/);
  assert.match(EVENT_ANALYZER_OUTPUT_CONTRACT, /confidence 只能是 null 或 0 到 1 之间的 number/);
  assert.match(EVENT_ANALYZER_OUTPUT_CONTRACT, /event_id.*source.*Runtime|Runtime.*event_id.*source/);
});

test('AI Event DTO may omit identity and ignore only the legacy top-level source', () => {
  const parsed = parseEventAnalysisResponse(JSON.stringify({
    schema_version: 1,
    events: [aiOnlyEvent()],
    source: {chat_id: 'legacy-chat', floor: 999},
  }), floorVersion);
  assert.equal(parsed.events.length, 1);
  assert.equal('event_id' in parsed.events[0], false);
  assert.equal('source' in parsed.events[0], false);
  assert.deepEqual(parsed.events[0].pregnancy_relevance.gestational_subject_ids, ['character_subject']);
});

test('AI Event parser rejects arbitrary top-level fields while ignoring event identity/source extras', () => {
  assert.throws(
    () => parseEventAnalysisResponse(JSON.stringify({
      schema_version: 1,
      events: [aiOnlyEvent({event_id: 'model-id', source: {chat_id: 'model-chat'}})],
      unexpected: true,
    }), floorVersion),
    error => error?.message === 'EVENT_SCHEMA_UNEXPECTED_TOP_LEVEL_FIELD_UNEXPECTED',
  );
  const parsed = parseEventAnalysisResponse(JSON.stringify({
    schema_version: 1,
    events: [aiOnlyEvent({event_id: 'model-id', source: {chat_id: 'model-chat'}})],
  }), floorVersion);
  assert.equal('event_id' in parsed.events[0], false);
  assert.equal('source' in parsed.events[0], false);
});

test('Event parser exposes safe diagnostic codes and JSON paths', () => {
  const cases = [
    {
      payload: {schema_version: 1, events: [], unexpected: true},
      code: 'unexpected_top_level_field',
      path: '$.unexpected',
    },
    {
      payload: {schema_version: 1, events: [{...aiOnlyEvent(), location: undefined}]},
      code: 'missing_event_field',
      path: '$.events[0].location',
    },
    {
      payload: {schema_version: 1, events: [aiOnlyEvent({participants: [participant('character_subject', {event_role: 'receiver'})]})]},
      code: 'invalid_event_role',
      path: '$.events[0].participants[0].event_role',
    },
    {
      payload: {schema_version: 1, events: [aiOnlyEvent({pregnancy_relevance: {
        relevant: true,
        possible_conception: 'unknown',
        gestational_subject_ids: [],
        counterpart_ids: [],
        confidence: null,
      }})]},
      code: 'invalid_possible_conception',
      path: '$.events[0].pregnancy_relevance.possible_conception',
    },
    {
      payload: {schema_version: 1, events: [aiOnlyEvent({source_evidence: ['raw evidence']})]},
      code: 'invalid_evidence_shape',
      path: '$.events[0].source_evidence[0]',
    },
    {
      payload: {schema_version: 1, events: [aiOnlyEvent({pregnancy_relevance: {
        relevant: true,
        possible_conception: true,
        gestational_subject_ids: ['missing-character'],
        counterpart_ids: [],
        confidence: null,
      }})]},
      code: 'participant_reference_invalid',
      path: '$.events[0].pregnancy_relevance.gestational_subject_ids[0]',
    },
  ];
  for (const {payload, code, path} of cases) {
    assert.throws(
      () => parseEventAnalysisResponse(JSON.stringify(payload), floorVersion),
      error => error?.diagnostic_code === code && error?.diagnostic_path === path,
    );
  }
});

test('Event messages use deterministic ordered text blocks instead of serialized AnalysisInput JSON', () => {
  const input = buildEventAnalysisInput({
    chatId: floorVersion.chat_id,
    floorVersion,
    currentFloor: {narrative: 'TARGET_FLOOR_MARKER', role: 'assistant'},
    recentContext: [{floor: 11, role: 'assistant', content: 'RECENT_STORY_MARKER'}],
    worldModel: {species: [{name: 'WORLD_MODEL_MARKER'}]},
    context: {powerUserSettings: {persona_name: 'PERSONA_MARKER', persona_description: 'PERSONA_CONTEXT_MARKER'}},
    character: {description: 'CHARACTER_CONTEXT_MARKER', greetings: []},
  });
  const messages = buildEventAnalysisMessages(input, {task: 'COMMON_ANALYSIS_MARKER'});
  const content = messages.map(message => message.content).join('\n');
  assert.equal(content.includes(JSON.stringify(input, null, 2)), false);
  for (const marker of [
    '【角色卡：角色 的背景资料】',
    '【用户 的人物设定】',
    '【当前 World Model 参考】',
    '【剧情上下文】',
    '【本次分析内容】',
    '【本次分析边界】',
    '【Event 输出契约】',
  ]) assert.match(content, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const prompt = messages.map(message => message.content).join('\n');
  const order = [
    '【本次分析边界】',
    '【Event 输出契约】',
    '【角色卡：角色 的背景资料】',
    '【用户 的人物设定】',
    '【当前 World Model 参考】',
    '【剧情上下文】',
    '【本次分析内容】',
  ].map(marker => prompt.indexOf(marker));
  assert.deepEqual(order, [...order].sort((left, right) => left - right));
  assert.match(content, /COMMON_ANALYSIS_MARKER/);
  assert.match(content, /TARGET_FLOOR_MARKER/);
  assert.match(content, /RECENT_STORY_MARKER/);
  assert.match(content, /PERSONA_CONTEXT_MARKER/);
  assert.ok(content.indexOf('【Event 输出契约】') < content.indexOf('【剧情上下文】'));
  const narrative = messages.find(message => message.role === 'assistant')?.content ?? '';
  assert.doesNotMatch(narrative, /【楼层|正文：|role=|message_id|swipe_id|content_hash|message_version/u);
  assert.equal(messages.at(-1).role, 'user');
  assert.match(content.trimEnd(), /只返回符合 Event Analysis 输出契约的完整固定 JSON 对象，不要输出其它文字。$/);
  assert.doesNotMatch(content, /api_key|authorization|secret/i);
});

test('Event parser rejects invented roles, non-boolean conception flags, and non-canonical evidence', () => {
  assert.throws(
    () => parseEventAnalysisResponse(response([event({
      participants: [participant('character_subject', {event_role: 'receiver'})],
    })]), floorVersion),
    error => error?.message === 'EVENT_ANALYSIS_PARTICIPANT_0_EVENT_ROLE_INVALID',
  );
  for (const value of ['possible', null]) {
    assert.throws(
      () => parseEventAnalysisResponse(response([event({
        pregnancy_relevance: {
          relevant: true,
          possible_conception: value,
          gestational_subject_ids: [],
          counterpart_ids: [],
          confidence: null,
        },
      })]), floorVersion),
      error => error?.message === 'EVENT_ANALYSIS_POSSIBLE_CONCEPTION_INVALID',
    );
  }
  assert.throws(
    () => parseEventAnalysisResponse(response([event({
      participants: [participant('character_subject', {evidence: ['raw evidence']})],
    })]), floorVersion),
    error => error?.message === 'EVENT_ANALYSIS_PARTICIPANT_0_EVIDENCE_0_INVALID',
  );
  assert.throws(
    () => parseEventAnalysisResponse(response([event({source_evidence: ['raw evidence']})]), floorVersion),
    error => error?.message === 'EVENT_ANALYSIS_SOURCE_EVIDENCE_0_INVALID',
  );
});

test('canonical generic sexual-activity response parses with structured evidence and arrays', () => {
  const parsed = parseEventAnalysisResponse(response([conceptionFixture()]), floorVersion);
  const [subject, source] = parsed.events[0].participants;
  assert.equal(subject.event_role, 'potential_gestational_subject');
  assert.equal(source.event_role, 'potential_conception_source');
  assert.equal(subject.reproductive_capabilities_used.can_carry_pregnancy, true);
  assert.equal(source.reproductive_capabilities_used.can_cause_pregnancy, true);
  assert.deepEqual(parsed.events[0].pregnancy_relevance.gestational_subject_ids, ['character_subject']);
  assert.deepEqual(parsed.events[0].pregnancy_relevance.counterpart_ids, ['character_source']);
  assert.deepEqual(subject.evidence, [{kind: 'capability', text: 'The current evidence supports gestational capability.'}]);
  assert.deepEqual(parsed.events[0].source_evidence, [{kind: 'narrative', text: 'The current floor establishes actual conception exposure.'}]);
});

test('common analysis prompt reaches Event and World builders while Persona stays Event-only', () => {
  const input = buildEventAnalysisInput({
    chatId: floorVersion.chat_id,
    floorVersion,
    currentFloor: {narrative: 'Current floor evidence.'},
    context: {
      powerUserSettings: {
        persona_name: 'persona-display',
        persona_description: 'Direct capability evidence. Authorization: Bearer DO-NOT-SEND.',
      },
    },
  });
  const eventMessages = buildEventAnalysisMessages(input, {task: 'COMMON_ANALYSIS_MARKER'});
  const worldMessages = buildWorldModelMessages({
    persona: {name: 'persona-display', description: 'PERSONA_ONLY_MARKER'},
    character: {description: 'World evidence.'},
    recent_story: {items: []},
  }, {task: 'COMMON_ANALYSIS_MARKER'});

  assert.match(JSON.stringify(eventMessages), /COMMON_ANALYSIS_MARKER/);
  assert.match(JSON.stringify(eventMessages), /persona-display/);
  assert.doesNotMatch(JSON.stringify(eventMessages), /DO-NOT-SEND/);
  assert.match(JSON.stringify(input.persona), /\[redacted\]/i);
  assert.match(JSON.stringify(worldMessages), /COMMON_ANALYSIS_MARKER/);
  assert.doesNotMatch(JSON.stringify(worldMessages), /PERSONA_ONLY_MARKER|persona-display/);
  assert.doesNotMatch(JSON.stringify(eventMessages), /整理当前 Chat 的生物学世界规则/);
  assert.match(JSON.stringify(worldMessages), /整理当前 Chat 的生物学世界规则/);
});

test('Event Prompt Preview renders the final Event messages and common prompt safely', () => {
  const input = buildEventAnalysisInput({
    chatId: floorVersion.chat_id,
    floorVersion,
    currentFloor: {narrative: 'Preview floor evidence.'},
    context: {
      powerUserSettings: {
        persona_name: 'persona-preview',
        persona_description: 'Authorization: Bearer PREVIEW-SECRET.',
      },
    },
  });
  const html = renderAnalysisDebugPopupContent({
    analysisPrompt: {task: 'EVENT_PREVIEW_COMMON_MARKER'},
    analysisPreview: {analysisType: 'event', eventInput: input},
    documentRef: null,
  });
  assert.match(html, /Event Analysis/);
  assert.match(html, /EVENT_PREVIEW_COMMON_MARKER/);
  assert.match(html, /data-bioweave-analysis-type="event"/);
  assert.match(html, /potential_gestational_subject/);
  assert.doesNotMatch(html, /PREVIEW-SECRET/);
});
