import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROJECTION_CONTEXT_INJECTION_KEY,
  buildProjectionContext,
  buildProjectionContextDTO,
} from '../core/projection-context.js';
import {createProjectionContextCoordinator} from '../runtime/projection-context.js';
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
  assert.deepEqual(result, {
    ok: false,
    status: 'unavailable',
    reason: 'ST_EXTENSION_PROMPT_UNAVAILABLE',
    dto: [],
    prompt: '',
  });
  assert.doesNotThrow(() => coordinator.destroy());
});

test('coordinator converts a throwing extension prompt setter into unavailable', async () => {
  const coordinator = createProjectionContextCoordinator({
    getProjectionViews: async () => ({all: []}),
    resolveCurrentFloor: async () => ({version: {chat_id: 'chat-a', floor: 2}}),
    getChatId: () => 'chat-a',
    setExtensionPrompt: () => {
      const error = new Error('prompt unavailable');
      error.code = 'ST_EXTENSION_PROMPT_UNAVAILABLE';
      throw error;
    },
  });
  const result = await coordinator.refreshProjectionContext();
  assert.equal(result.ok, false);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'ST_EXTENSION_PROMPT_UNAVAILABLE');
  assert.deepEqual(result.dto, []);
  assert.equal(result.prompt, '');
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
