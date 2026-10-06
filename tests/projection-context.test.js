import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROJECTION_CONTEXT_INJECTION_KEY,
  buildProjectionContext,
  buildProjectionContextDTO,
} from '../core/projection-context.js';
import {createCurrentStateAttributionResolver, createProjectionContextCoordinator} from '../runtime/projection-context.js';
import {createSillyTavernAdapter} from '../runtime/sillytavern-adapter.js';
import {EVENT_ANALYZER_CORE_CONTRACT} from '../ai/prompts.js';

function view(overrides = {}) {
  return {
    projection_id: 'projection-a',
    subject_id: 'char_000002',
    projection_rule_id: 'rule-a',
    development_concern_key: 'concern-a',
    mechanism: {key: 'mechanism-a'},
    development: {kind: 'possible_detection', next_signal: '可能出现可观察的检测迹象。'},
    created_at_floor_version: {message_id: 'message-2'},
    factual_status: 'active',
    deleted: false,
    context_visible: true,
    ...overrides,
  };
}

test('context DTO only contains visible projections and strips storage metadata', () => {
  const views = [
    view(),
    view({projection_id: 'projection-deleted', deleted: true, context_visible: false}),
  ];
  const context = buildProjectionContextDTO(views, {
    attributionBySubject: {
      char_000002: {
        unresolved: true,
        candidates: [{source_character_id: 'char_000003', contribution_kind: 'genetic'}],
      },
    },
  });
  assert.deepEqual(context, [{
    subject_id: 'char_000002',
    development_kind: 'possible_detection',
    description: '可能出现可观察的检测迹象。',
    mechanism: {key: 'mechanism-a'},
    attribution: {
      status: 'unresolved',
      conflict: false,
      confirmed: [],
      candidates: [{source_character_id: 'char_000003', contribution_kind: 'genetic'}],
    },
  }]);
  assert.equal(JSON.stringify(context).includes('projection-a'), false);
  assert.equal(JSON.stringify(context).includes('message-2'), false);
});

test('context ordering is stable and input views remain unchanged', () => {
  const views = [
    view({projection_id: 'projection-b', subject_id: 'char_000002', development_concern_key: 'concern-b'}),
    view({projection_id: 'projection-a', subject_id: 'char_000001'}),
  ];
  const original = structuredClone(views);
  const result = buildProjectionContext(views);
  assert.deepEqual(views, original);
  assert.deepEqual(result.dto.map(item => item.subject_id), ['char_000001', 'char_000002']);
  assert.match(result.prompt, /不是已经发生的事实/);
  assert.match(result.prompt, /可能出现可观察的检测迹象/);
});

test('health recovery guidance shares the projection context slot without exposing timing internals', () => {
  const result = buildProjectionContext([], {
    healthGuidance: [{
      subject_id: 'char_000002',
      body_site: '左手腕',
      stage: 'recovering',
      guidance: '疼痛已比早期减轻，日常活动有所恢复，但用力时仍可能引起不适。',
    }],
  });
  assert.equal(result.dto.length, 1);
  assert.equal(result.dto[0].context_type, 'health_recovery_guidance');
  assert.match(result.prompt, /恢复阶段身体表现指导/);
  assert.match(result.prompt, /无关场景可以完全不提/);
  assert.match(result.prompt, /不要机械重复健康问题/);
  assert.doesNotMatch(result.prompt, /remaining_days\s*=|deadline\s*=|story_days\s*=|assessment_id\s*=|event_id\s*=|recovering/);
});

test('multiple unresolved source candidates are not selected or ranked', () => {
  const {prompt} = buildProjectionContext([view()], {
    attributionBySubject: {
      char_000002: {
        unresolved: true,
        candidates: [
          {source_character_id: 'char_000003', contribution_kind: 'genetic'},
          {source_character_id: 'char_000004', contribution_kind: 'magical'},
        ],
      },
    },
  });
  assert.match(prompt, /多个尚未确认的来源候选/);
  assert.doesNotMatch(prompt, /char_000003|char_000004/);
});

test('coordinator updates one injection slot and clears when no visible projection exists', async () => {
  const writes = [];
  let views = {all: [view()]};
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => views,
    resolveCurrentFloor: async () => ({version: {chat_id: 'chat-a', floor: 2}}),
    getChatId: () => 'chat-a',
    setExtensionPrompt: payload => writes.push(payload),
  });
  const updated = await coordinator.refreshProjectionContext();
  assert.equal(updated.status, 'updated');
  assert.equal(writes.at(-1).key, PROJECTION_CONTEXT_INJECTION_KEY);
  assert.equal(writes.at(-1).position, 'IN_CHAT');
  assert.equal(writes.at(-1).depth, 4);
  assert.equal(writes.at(-1).role, 'SYSTEM');
  views = {all: []};
  const cleared = await coordinator.refreshProjectionContext();
  assert.equal(cleared.status, 'cleared');
  assert.equal(writes.at(-1).content, '');
});

test('coordinator combines Health Guidance with projections and clears both from the same slot', async () => {
  const writes = [];
  let guidance = [{
    subject_id: 'char_000002',
    body_site: '左手腕',
    stage: 'near_recovery',
    guidance: '大部分普通活动不再明显受影响。',
  }];
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => ({all: [view()]}),
    healthGuidanceResolver: async () => guidance,
    resolveCurrentFloor: async () => ({version: {
      chat_id: 'chat-a', message_id: 'message-a', floor: 2, swipe_id: 0,
      content_hash: 'hash-a', message_version: 'v1',
    }}),
    getChatId: () => 'chat-a',
    setExtensionPrompt: payload => writes.push(payload),
  });
  const result = await coordinator.refreshProjectionContext();
  assert.equal(result.status, 'updated');
  assert.equal(result.dto.length, 2);
  assert.match(result.prompt, /生物发展方向/);
  assert.match(result.prompt, /恢复阶段身体表现指导/);
  guidance = [];
  const clearedHealth = await coordinator.refreshProjectionContext();
  assert.equal(clearedHealth.dto.length, 1);
  assert.doesNotMatch(clearedHealth.prompt, /左手腕/);
});

test('coordinator keeps Health Guidance when Projection views are empty', async () => {
  const writes = [];
  const diagnostics = [];
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => ({all: []}),
    healthGuidanceResolver: async () => [{
      subject_id: 'char_000002',
      body_site: '右肩',
      stage: 'early',
      guidance: '右肩在受到刺激时可能出现明显身体反应。',
    }],
    resolveCurrentFloor: async () => ({version: {chat_id: 'chat-a', floor: 2}}),
    getChatId: () => 'chat-a',
    setExtensionPrompt: payload => writes.push(payload),
    trace: item => diagnostics.push(item),
  });

  const result = await coordinator.refreshProjectionContext();

  assert.equal(result.status, 'updated');
  assert.equal(result.dto.length, 1);
  assert.match(writes.at(-1).content, /右肩/);
  assert.equal(diagnostics.some(item => item.stage === 'PROJECTION_CONTEXT_HEALTH_INPUT' && item.health_guidance_count === 1), true);
  assert.equal(diagnostics.some(item => item.stage === 'PROJECTION_CONTEXT_SLOT_WRITTEN' && item.health_guidance_count === 1), true);
  assert.equal(diagnostics.some(item => item.stage === 'PROJECTION_CONTEXT_SLOT_CLEARED'), false);
});

test('Health-only context writes through the SillyTavern adapter without exported constants on context', async () => {
  const calls = [];
  const previous = globalThis.SillyTavern;
  globalThis.SillyTavern = {getContext: () => ({
    chatId: 'chat-a',
    setExtensionPrompt: (...args) => calls.push(args),
  })};
  try {
    const adapter = createSillyTavernAdapter();
    const coordinator = createProjectionContextCoordinator({
      getProjectionViews: async () => ({all: []}),
      healthGuidanceResolver: async () => [{
        subject_id: 'char_000002', body_site: '右肩', stage: 'early', guidance: 'HEALTH_ONLY',
      }],
      resolveCurrentFloor: async () => ({version: {chat_id: 'chat-a', floor: 2}}),
      getChatId: () => 'chat-a',
      setExtensionPrompt: adapter.setExtensionPrompt,
    });
    const result = await coordinator.refreshProjectionContext();
    assert.equal(result.status, 'updated');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].slice(0, 1), ['bioweave_projection_context']);
    assert.equal(calls[0][2], 1);
    assert.equal(calls[0][5], 0);
    coordinator.destroy();
  } finally {
    if (previous === undefined) delete globalThis.SillyTavern;
    else globalThis.SillyTavern = previous;
  }
});

test('coordinator clears the shared slot only when Projection and Health Guidance are both empty', async () => {
  const writes = [];
  const diagnostics = [];
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => ({all: []}),
    healthGuidanceResolver: async () => [],
    resolveCurrentFloor: async () => ({version: {chat_id: 'chat-a', floor: 2}}),
    getChatId: () => 'chat-a',
    setExtensionPrompt: payload => writes.push(payload),
    trace: item => diagnostics.push(item),
  });

  const result = await coordinator.refreshProjectionContext();

  assert.equal(result.status, 'cleared');
  assert.equal(writes.at(-1).content, '');
  assert.equal(diagnostics.some(item => item.stage === 'PROJECTION_CONTEXT_SLOT_CLEARED' && item.clear_reason === 'both_context_inputs_empty'), true);
});

test('serialized refreshes prevent an older empty result from clearing newer Health Guidance', async () => {
  const writes = [];
  let releaseFirstRead;
  const firstRead = new Promise(resolve => { releaseFirstRead = resolve; });
  let reads = 0;
  let guidanceReads = 0;
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => {
      reads += 1;
      if (reads === 1) await firstRead;
      return {all: []};
    },
    healthGuidanceResolver: async () => {
      guidanceReads += 1;
      return guidanceReads === 1 ? [] : [{
        subject_id: 'char_000002',
        body_site: '右肩',
        stage: 'early',
        guidance: '右肩在受到刺激时可能出现明显身体反应。',
      }];
    },
    resolveCurrentFloor: async () => ({version: {chat_id: 'chat-a', floor: 2}}),
    getChatId: () => 'chat-a',
    setExtensionPrompt: payload => writes.push(payload),
  });

  const first = coordinator.refreshProjectionContext();
  const second = coordinator.refreshProjectionContext();
  releaseFirstRead();
  await Promise.all([first, second]);

  assert.equal(reads, 2);
  assert.equal(guidanceReads, 2);
  assert.match(writes.at(-1).content, /右肩/);
});

test('Health Guidance read failure does not clear a valid Projection Context', async () => {
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => ({all: [view()]}),
    healthGuidanceResolver: async () => { throw new Error('HEALTH_READ_FAILED'); },
    resolveCurrentFloor: async () => ({version: {
      chat_id: 'chat-a', message_id: 'message-a', floor: 2, swipe_id: 0,
      content_hash: 'hash-a', message_version: 'v1',
    }}),
    getChatId: () => 'chat-a',
    setExtensionPrompt: () => true,
  });
  const result = await coordinator.refreshProjectionContext();
  assert.equal(result.status, 'updated');
  assert.equal(result.dto.length, 1);
  assert.match(result.prompt, /生物发展方向/);
});

test('coordinator refresh reads attribution through the resolver and updates the context summary', async () => {
  const writes = [];
  let attribution = {
    char_000002: {
      confirmed: [{source_character_id: 'char_000003', contribution_kind: 'genetic'}],
    },
  };
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => ({all: [view()]}),
    resolveCurrentFloor: async () => ({version: {chat_id: 'chat-a', floor: 2}}),
    getChatId: () => 'chat-a',
    attributionResolver: async ({chatId, floor}) => {
      assert.equal(chatId, 'chat-a');
      assert.equal(floor.version.floor, 2);
      return attribution;
    },
    setExtensionPrompt: payload => writes.push(payload),
  });
  const first = await coordinator.refreshProjectionContext();
  assert.match(first.prompt, /已确认的生殖贡献者/);
  attribution = {char_000002: {unresolved: true, conflicts: [{relationship_key: 'conflict'}]}};
  const second = await coordinator.refreshProjectionContext();
  assert.match(second.prompt, /存在冲突/);
  assert.equal(writes.length, 2);
});

test('current State attribution resolver fails closed for chat, Floor, Swipe, and state mismatches', async () => {
  const version = {chat_id: 'chat-a', message_id: 'message-a', floor: 2, swipe_id: 1, content_hash: 'hash-a', message_version: 'v1'};
  let business = {
    current_state_status: 'ready',
    current_floor: {version},
    current_state: {characters: {}},
  };
  let reads = 0;
  const resolver = createCurrentStateAttributionResolver({
    collectActiveBusinessData: async () => {
      reads += 1;
      return business;
    },
  });
  assert.deepEqual(await resolver({chatId: 'chat-b', floor: {version}}), {});
  assert.equal(reads, 0);
  assert.deepEqual(await resolver({chatId: 'chat-a', floor: {version: {...version, swipe_id: 0}}}), {});
  assert.equal(reads, 1);
  business = {...business, current_floor: {version: {...version, message_version: 'v2'}}};
  assert.deepEqual(await resolver({chatId: 'chat-a', floor: {version}}), {});
  business = {...business, current_floor: {version}, current_state_status: 'STATE_ERROR'};
  assert.deepEqual(await resolver({chatId: 'chat-a', floor: {version}}), {});
});

test('disabled coordinator clears immediately and never reinjects on refresh', async () => {
  const writes = [];
  let enabled = true;
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => ({all: [view()]}),
    resolveCurrentFloor: async () => ({version: {chat_id: 'chat-a', floor: 2}}),
    getChatId: () => 'chat-a',
    enabledResolver: () => enabled,
    setExtensionPrompt: payload => writes.push(payload),
  });
  assert.equal((await coordinator.refreshProjectionContext()).status, 'updated');
  enabled = false;
  assert.equal(coordinator.clearProjectionContext().status, 'cleared');
  assert.equal(writes.at(-1).content, '');
  const refreshed = await coordinator.refreshProjectionContext();
  assert.equal(refreshed.status, 'cleared');
  assert.equal(writes.at(-1).content, '');
  enabled = true;
  assert.equal((await coordinator.refreshProjectionContext()).status, 'updated');
});

test('coordinator clears for missing Character Floor and isolates chat scope', async () => {
  const writes = [];
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async ({chatId}) => chatId === 'chat-a' ? {all: [view()]} : {all: []},
    resolveCurrentFloor: async () => { throw new Error('NO_CHARACTER_FLOOR'); },
    getChatId: () => 'chat-b',
    setExtensionPrompt: payload => writes.push(payload),
  });
  const result = await coordinator.refreshProjectionContext();
  assert.equal(result.status, 'cleared');
  assert.equal(writes.at(-1).content, '');
});

test('coordinator fails closed when extension prompt injection is unavailable', async () => {
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => ({all: []}),
    resolveCurrentFloor: async () => { throw new Error('NO_CHARACTER_FLOOR'); },
    getChatId: () => 'chat-a',
  });
  const result = await coordinator.refreshProjectionContext();
  assert.equal(result.ok, false);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'ST_EXTENSION_PROMPT_UNAVAILABLE');
  assert.deepEqual(result.dto, []);
  assert.equal(result.prompt, '');
  assert.doesNotThrow(() => coordinator.destroy());
});

test('coordinator converts a throwing extension prompt setter into unavailable', async () => {
  const diagnostics = [];
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => ({all: []}),
    resolveCurrentFloor: async () => ({version: {chat_id: 'chat-a', floor: 2}}),
    getChatId: () => 'chat-a',
    setExtensionPrompt: () => {
      const error = new Error('prompt unavailable');
      error.code = 'ST_EXTENSION_PROMPT_UNAVAILABLE';
      throw error;
    },
    trace: item => diagnostics.push(item),
  });
  const result = await coordinator.refreshProjectionContext();
  assert.equal(result.ok, false);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'ST_EXTENSION_PROMPT_UNAVAILABLE');
  assert.deepEqual(result.dto, []);
  assert.equal(result.prompt, '');
  const failure = diagnostics.find(item => item.stage === 'PROJECTION_CONTEXT_SLOT_WRITE_FAILED');
  assert.equal(failure.reason, 'ST_EXTENSION_PROMPT_UNAVAILABLE');
  assert.equal(failure.error_name, 'Error');
  assert.equal(failure.error_code, 'ST_EXTENSION_PROMPT_UNAVAILABLE');
  assert.equal(failure.error_message, 'prompt unavailable');
  assert.doesNotThrow(() => coordinator.destroy());
});

test('Event Analysis contract treats injected Projection text as non-factual context', () => {
  assert.match(EVENT_ANALYZER_CORE_CONTRACT, /Projection Context/);
  assert.match(EVENT_ANALYZER_CORE_CONTRACT, /只有 narrative discovery window 中明确写出的历史或当前事实/);
});

test('coordinator destroy clears and refuses future writes', async () => {
  const writes = [];
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => ({all: [view()]}),
    resolveCurrentFloor: async () => ({version: {chat_id: 'chat-a', floor: 2}}),
    getChatId: () => 'chat-a',
    setExtensionPrompt: payload => writes.push(payload),
  });
  coordinator.destroy();
  assert.equal(writes.at(-1).content, '');
  assert.equal((await coordinator.refreshProjectionContext()).status, 'destroyed');
  assert.equal(writes.length, 1);
});
