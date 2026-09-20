import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatBoundary } from '../runtime/chat.js';
import { createClearService } from '../storage/clear.js';
import { createStore } from '../storage/store.js';
import { cloneValue, emptyChat, emptyFloor } from '../storage/schema.js';

function completeRoot(chatId) {
  return {
    ...emptyChat(chatId),
    settings: { ...emptyChat(chatId).settings, custom: true },
    data_lifecycle: {
      future_marker: 'preserve-on-domain-clear',
    },
  };
}

function completeFloor(marker, chatId, swipeId = 0) {
  const version = {
    chat_id: chatId,
    message_id: marker,
    floor: swipeId + 1,
    swipe_id: swipeId,
    content_hash: `hash-${marker}-${swipeId}`,
    message_version: `v-${marker}-${swipeId}`,
  };
  return {
    ...emptyFloor(),
    floor_version: version,
    analysis: { status: 'success', floor_version: version, marker },
    events: [{ event_id: `event-${marker}-${swipeId}`, source: version }],
    character_registry: {
      schema_version: 1,
      entities: { [`char-${marker}`]: { character_id: `char-${marker}` } },
    },
    world_model: { species: [{ name: `世界-${marker}` }] },
    world_model_meta: { saved_at: marker },
    future_field: { must_survive: true },
  };
}

function makeFixture({ currentChatId = 'chat-a', saveMetadata, saveChat } = {}) {
  const globalSettings = {
    api_source: 'bioweave',
    api_profiles: { local: { profile_id: 'local', secret_ref: 'secret-ref' } },
    api_request_settings: { timeout: 120000, retry_count: 1 },
    analysis_prompt: { task: 'keep this global prompt' },
  };
  const chatMetadata = {
    unrelated_plugin_metadata: { keep: true },
    bioweave: completeRoot('chat-a'),
  };
  const secretStoreCalls = [];
  const secretStore = {
    get: () => secretStoreCalls.push('get'),
    set: () => secretStoreCalls.push('set'),
    delete: () => secretStoreCalls.push('delete'),
  };
  const messages = [
    {
      message_id: 'message-ordinary',
      role: 'assistant',
      content: 'ordinary text',
      extra: {
        unrelated: { keep: 'ordinary' },
        bioweave: completeFloor('ordinary', 'chat-a'),
      },
    },
    {
      message_id: 'message-swipes',
      role: 'assistant',
      content: 'active mirror text',
      extra: {
        unrelated: { keep: 'message-extra' },
        bioweave: completeFloor('mirror', 'chat-a'),
      },
      swipes: ['swipe zero text', 'swipe one text', 'swipe two text'],
      swipe_id: 1,
      swipe_info: [
        {
          content: 'swipe zero text',
          extra: {
            unrelated: { keep: 0 },
            bioweave: completeFloor('swipe-zero', 'chat-a', 0),
          },
        },
        {
          content: 'swipe one text',
          extra: {
            unrelated: { keep: 1 },
            bioweave: completeFloor('swipe-one', 'chat-a', 1),
          },
        },
        {
          content: 'swipe two text',
          extra: {
            unrelated: { keep: 2 },
            bioweave: completeFloor('swipe-two', 'chat-a', 2),
          },
        },
      ],
    },
  ];
  const adapter = {
    getChatId: () => currentChatId,
    getChat: () => messages,
    getChatMetadata: () => chatMetadata,
    getGlobalSettings: () => globalSettings,
    getSecretStore: () => {
      secretStoreCalls.push('getSecretStore');
      return secretStore;
    },
    saveChatMetadata: async (key, value, expectedChatId) => {
      assert.equal(expectedChatId, currentChatId);
      if (typeof saveMetadata === 'function') return saveMetadata(key, value);
      chatMetadata[key] = cloneValue(value);
      return { commitState: 'confirmed' };
    },
    saveChat: async () => {
      if (typeof saveChat === 'function') return saveChat();
      return { commitState: 'confirmed' };
    },
  };
  const boundary = createChatBoundary(adapter);
  const store = createStore(adapter, boundary);
  const service = createClearService({
    adapter,
    store,
    boundary,
    autoInvalidate: false,
  });
  return {
    adapter,
    boundary,
    store,
    service,
    globalSettings,
    secretStoreCalls,
    chatMetadata,
    messages,
  };
}

function floorRoots(fixture) {
  return [
    fixture.messages[0].extra?.bioweave,
    fixture.messages[1].extra?.bioweave,
    ...fixture.messages[1].swipe_info.map((slot) => slot.extra?.bioweave),
  ];
}

test('full clear removes only the explicit Floor allowlist and preserves host data', async () => {
  const fixture = makeFixture();
  const chatBefore = cloneValue(fixture.chatMetadata.bioweave);
  const globalBefore = cloneValue(fixture.globalSettings);
  const textAndHostBefore = {
    metadata: fixture.chatMetadata.unrelated_plugin_metadata,
    ordinaryText: fixture.messages[0].content,
    swipeText: fixture.messages[1].swipe_info.map((slot) => slot.content),
    messageExtras: fixture.messages.map((message) => cloneValue(message.extra.unrelated)),
    swipeExtras: fixture.messages[1].swipe_info.map((slot) => cloneValue(slot.extra.unrelated)),
  };

  const result = await fixture.service.clearAllBioWeaveData();

  assert.equal(result.ok, true);
  assert.equal(result.persistence.commitState, 'confirmed');
  assert.equal(result.removed.floorSlots, 5);
  assert.equal(result.removed.swipeSlots, 3);
  assert.deepEqual(fixture.globalSettings, globalBefore);
  assert.deepEqual(fixture.secretStoreCalls, []);
  assert.deepEqual(
    {
      metadata: fixture.chatMetadata.unrelated_plugin_metadata,
      ordinaryText: fixture.messages[0].content,
      swipeText: fixture.messages[1].swipe_info.map((slot) => slot.content),
      messageExtras: fixture.messages.map((message) => cloneValue(message.extra.unrelated)),
      swipeExtras: fixture.messages[1].swipe_info.map((slot) => cloneValue(slot.extra.unrelated)),
    },
    textAndHostBefore,
  );
  assert.deepEqual(fixture.chatMetadata.bioweave, chatBefore);
  for (const root of floorRoots(fixture)) {
    assert.equal(root.analysis, null);
    assert.deepEqual(root.events, []);
    assert.deepEqual(root.character_registry, { schema_version: 1, entities: {} });
    assert.equal(root.world_model, null);
    assert.equal(root.world_model_meta, null);
    assert.ok(root.v);
    assert.ok(root.floor_version);
    assert.deepEqual(root.future_field, { must_survive: true });
  }
});

test('character and world clear use domain allowlists and preserve unrelated facts', async () => {
  const fixture = makeFixture();
  const globalBefore = cloneValue(fixture.globalSettings);
  const settingsBefore = cloneValue(fixture.chatMetadata.bioweave.settings);

  const characterResult = await fixture.service.clearCharacterData();
  assert.equal(characterResult.ok, true);
  assert.deepEqual(fixture.chatMetadata.bioweave.settings, settingsBefore);
  assert.deepEqual(fixture.chatMetadata.bioweave.data_lifecycle, { future_marker: 'preserve-on-domain-clear' });
  assert.equal(fixture.messages[0].extra.bioweave.analysis, null);
  assert.deepEqual(fixture.messages[0].extra.bioweave.events, []);
  assert.deepEqual(fixture.messages[0].extra.bioweave.character_registry, { schema_version: 1, entities: {} });
  assert.ok(fixture.messages[0].extra.bioweave.world_model);
  assert.ok(fixture.messages[0].extra.bioweave.world_model_meta);
  assert.deepEqual(fixture.messages[0].extra.bioweave.future_field, { must_survive: true });
  assert.deepEqual(fixture.globalSettings, globalBefore);

  const worldResult = await fixture.service.clearWorldData();
  assert.equal(worldResult.ok, true);
  assert.deepEqual(fixture.chatMetadata.bioweave.settings, settingsBefore);
  assert.deepEqual(fixture.messages[0].extra.bioweave.events, []);
  assert.equal(fixture.messages[0].extra.bioweave.world_model, null);
  assert.equal(fixture.messages[0].extra.bioweave.world_model_meta, null);
  assert.ok(fixture.messages[0].extra.bioweave.floor_version);
  assert.deepEqual(fixture.messages[0].extra.bioweave.future_field, { must_survive: true });
  assert.deepEqual(fixture.globalSettings, globalBefore);
  assert.deepEqual(fixture.secretStoreCalls, []);
});

test('clear operations are idempotent and concurrent duplicate calls share one commit', async () => {
  let saves = 0;
  const fixture = makeFixture({
    saveChat: async () => {
      saves += 1;
      return { commitState: 'confirmed' };
    },
  });
  const first = fixture.service.clearAllBioWeaveData();
  const duplicate = fixture.service.clearAllBioWeaveData();
  assert.strictEqual(first, duplicate);
  const firstResult = await first;
  const secondResult = await fixture.service.clearAllBioWeaveData();
  assert.equal(firstResult.ok, true);
  assert.equal(secondResult.ok, true);
  assert.equal(secondResult.changed, false);
  assert.equal(saves, 1);
});

test('source-targeted clear removes source A only after reading its latest revision while current B stays untouched', async () => {
  const source = makeFixture();
  const targetB = makeFixture({ currentChatId: 'chat-b' });
  const sourceState = {
    chatId: 'chat-a',
    revision: 7,
    chatMetadata: source.chatMetadata,
    messages: source.messages,
  };
  const currentMetadata = targetB.chatMetadata;
  const currentMessages = targetB.messages;
  let savedOwner = null;
  const adapter = {
    getChatId: () => 'chat-b',
    getChat: () => currentMessages,
    getChatMetadata: () => currentMetadata,
    getGlobalSettings: () => targetB.globalSettings,
    sourceOwnerRevisionCAS: true,
    async readChatOwner({ chatId }) {
      assert.equal(chatId, 'chat-a');
      return {
        chatId: sourceState.chatId,
        revision: sourceState.revision,
        chatMetadata: cloneValue(sourceState.chatMetadata),
        messages: cloneValue(sourceState.messages),
      };
    },
    async saveChatOwner(payload) {
      savedOwner = payload.chatId;
      assert.equal(payload.expectedRevision, 7);
      sourceState.chatMetadata = cloneValue(payload.state.chatMetadata);
      sourceState.messages = cloneValue(payload.state.messages);
      sourceState.revision += 1;
      return { commitState: 'confirmed' };
    },
  };
  const boundary = createChatBoundary(adapter);
  const service = createClearService({
    adapter,
    store: createStore(adapter, boundary),
    boundary,
    autoInvalidate: false,
  });
  const bBefore = { metadata: cloneValue(currentMetadata), messages: cloneValue(currentMessages) };
  const result = await service.clearSourceChatBioWeave({ chatId: 'chat-a', revision: 7 });

  assert.equal(result.ok, true);
  assert.equal(result.sourceTargeted, true);
  assert.equal(result.chatId, 'chat-a');
  assert.equal(savedOwner, 'chat-a');
  assert.deepEqual(currentMetadata, bBefore.metadata);
  assert.deepEqual(currentMessages, bBefore.messages);
  assert.deepEqual(sourceState.chatMetadata.bioweave, source.chatMetadata.bioweave);
  for (const root of sourceState.messages.flatMap((message) => [
    message.extra?.bioweave,
    ...(message.swipe_info ?? []).map((slot) => slot.extra?.bioweave),
  ])) {
    assert.equal(root.analysis, null);
    assert.deepEqual(root.events, []);
    assert.deepEqual(root.character_registry, { schema_version: 1, entities: {} });
    assert.equal(root.world_model, null);
    assert.equal(root.world_model_meta, null);
    assert.deepEqual(root.future_field, { must_survive: true });
  }
});

test('manual Clear All and source Start New Chat cleanup share the same registry removal coverage', async () => {
  const manual = makeFixture();
  const source = makeFixture();
  const current = makeFixture({ currentChatId: 'chat-b' });
  const sourceState = {
    chatId: 'chat-a',
    revision: 1,
    chatMetadata: cloneValue(source.chatMetadata),
    messages: cloneValue(source.messages),
  };
  const adapter = {
    getChatId: () => 'chat-b',
    getChat: () => current.messages,
    getChatMetadata: () => current.chatMetadata,
    getGlobalSettings: () => current.globalSettings,
    sourceOwnerRevisionCAS: true,
    async readChatOwner({ chatId }) {
      assert.equal(chatId, 'chat-a');
      return {
        ...cloneValue(sourceState),
        chatMetadata: cloneValue(sourceState.chatMetadata),
        messages: cloneValue(sourceState.messages),
      };
    },
    async saveChatOwner(payload) {
      assert.equal(payload.expectedRevision, sourceState.revision);
      sourceState.revision += 1;
      sourceState.chatMetadata = cloneValue(payload.state.chatMetadata);
      sourceState.messages = cloneValue(payload.state.messages);
      return { commitState: 'confirmed' };
    },
  };
  const boundary = createChatBoundary(adapter);
  const sourceService = createClearService({
    adapter,
    store: createStore(adapter, boundary),
    boundary,
    autoInvalidate: false,
  });
  const manualResult = await manual.service.clearAllBioWeaveData();
  const sourceResult = await sourceService.clearSourceChatBioWeave({
    chatId: 'chat-a',
    revision: 1,
  });

  assert.equal(manualResult.ok, true);
  assert.equal(sourceResult.ok, true);
  assert.deepEqual(sourceResult.removed, manualResult.removed);
  assert.deepEqual(sourceState.chatMetadata.bioweave, source.chatMetadata.bioweave);
  for (const root of sourceState.messages.flatMap((message) => [
    message.extra?.bioweave,
    ...(message.swipe_info ?? []).map((slot) => slot.extra?.bioweave),
  ])) {
    assert.equal(root.analysis, null);
    assert.deepEqual(root.events, []);
    assert.deepEqual(root.character_registry, { schema_version: 1, entities: {} });
    assert.equal(root.world_model, null);
    assert.equal(root.world_model_meta, null);
    assert.deepEqual(root.future_field, { must_survive: true });
  }
});

test('source clear fails closed when the owner writer cannot prove revision CAS', async () => {
  const source = makeFixture();
  const current = makeFixture({ currentChatId: 'chat-b' });
  const sourceBefore = {
    metadata: cloneValue(source.chatMetadata),
    messages: cloneValue(source.messages),
  };
  let writes = 0;
  const adapter = {
    getChatId: () => 'chat-b',
    getChat: () => current.messages,
    getChatMetadata: () => current.chatMetadata,
    getGlobalSettings: () => current.globalSettings,
    async readChatOwner({ chatId }) {
      assert.equal(chatId, 'chat-a');
      return {
        chatId: 'chat-a',
        revision: 3,
        chatMetadata: cloneValue(source.chatMetadata),
        messages: cloneValue(source.messages),
      };
    },
    async saveChatOwner() {
      writes += 1;
      return { commitState: 'confirmed' };
    },
  };
  const boundary = createChatBoundary(adapter);
  const service = createClearService({
    adapter,
    store: createStore(adapter, boundary),
    boundary,
    autoInvalidate: false,
  });

  const result = await service.clearSourceChatBioWeave({
    chatId: 'chat-a',
    revision: 3,
  });

  assert.equal(result.ok, false);
  assert.equal(result.persistence.commitState, 'failed');
  assert.equal(result.error.code, 'SOURCE_REVISION_CAS_UNVERIFIED');
  assert.equal(writes, 0);
  assert.deepEqual(source.chatMetadata, sourceBefore.metadata);
  assert.deepEqual(source.messages, sourceBefore.messages);
});

test('source verification failure is unknown and does not trigger a blind old-snapshot overwrite', async () => {
  const source = makeFixture();
  const current = makeFixture({ currentChatId: 'chat-b' });
  let reads = 0;
  let rollbackWrites = 0;
  const sourceState = {
    chatId: 'chat-a',
    revision: 4,
    chatMetadata: cloneValue(source.chatMetadata),
    messages: cloneValue(source.messages),
  };
  const adapter = {
    getChatId: () => 'chat-b',
    getChat: () => current.messages,
    getChatMetadata: () => current.chatMetadata,
    getGlobalSettings: () => current.globalSettings,
    sourceOwnerRevisionCAS: true,
    async readChatOwner({ chatId }) {
      assert.equal(chatId, 'chat-a');
      reads += 1;
      if (reads >= 3) throw Object.assign(new Error('source read unavailable'), { code: 'SOURCE_READ_FAILED' });
      return cloneValue(sourceState);
    },
    async saveChatOwner(payload) {
      sourceState.chatMetadata = cloneValue(payload.state.chatMetadata);
      sourceState.messages = cloneValue(payload.state.messages);
      sourceState.revision += 1;
      return { commitState: 'confirmed' };
    },
    async rollbackChatOwner() {
      rollbackWrites += 1;
      return { commitState: 'confirmed' };
    },
  };
  const boundary = createChatBoundary(adapter);
  const service = createClearService({
    adapter,
    store: createStore(adapter, boundary),
    boundary,
    autoInvalidate: false,
  });

  const result = await service.clearSourceChatBioWeave({ chatId: 'chat-a', revision: 4 });

  assert.equal(result.ok, false);
  assert.equal(result.persistence.commitState, 'unknown');
  assert.equal(result.error.code, 'SOURCE_READ_FAILED');
  assert.equal(rollbackWrites, 0);
  assert.equal(reads, 3);
});

test('source verification detects a boundary-time header change instead of claiming confirmed clear', async () => {
  const source = makeFixture();
  const current = makeFixture({ currentChatId: 'chat-b' });
  const sourceState = {
    chatId: 'chat-a',
    revision: 4,
    header: { boundary_plugin_header: { keep: 'before' } },
    chatMetadata: cloneValue(source.chatMetadata),
    messages: cloneValue(source.messages),
  };
  let reads = 0;
  const adapter = {
    getChatId: () => 'chat-b',
    getChat: () => current.messages,
    getChatMetadata: () => current.chatMetadata,
    getGlobalSettings: () => current.globalSettings,
    sourceOwnerRevisionCAS: true,
    async readChatOwner() {
      reads += 1;
      if (reads < 3) return cloneValue(sourceState);
      return {
        ...cloneValue(sourceState),
        header: { boundary_plugin_header: { keep: 'changed-during-save' } },
      };
    },
    async saveChatOwner(payload) {
      sourceState.chatMetadata = cloneValue(payload.state.chatMetadata);
      sourceState.messages = cloneValue(payload.state.messages);
      return { commitState: 'confirmed' };
    },
  };
  const boundary = createChatBoundary(adapter);
  const service = createClearService({
    adapter,
    store: createStore(adapter, boundary),
    boundary,
    autoInvalidate: false,
  });

  const result = await service.clearSourceChatBioWeave({ chatId: 'chat-a', revision: 4 });

  assert.equal(result.ok, false);
  assert.equal(result.persistence.commitState, 'unknown');
  assert.equal(result.error.code, 'SOURCE_UNOWNED_STATE_CHANGED');
});

test('known persistence failure restores the exact in-memory snapshot and is not reported as success', async () => {
  let saveCalls = 0;
  const fixture = makeFixture({
    saveChat: async () => {
      saveCalls += 1;
      if (saveCalls > 1) return { commitState: 'confirmed' };
      throw Object.assign(new Error('Floor write rejected'), { code: 'SAVE_FAILED' });
    },
  });
  const before = { metadata: cloneValue(fixture.chatMetadata), messages: cloneValue(fixture.messages) };
  const result = await fixture.service.clearAllBioWeaveData();

  assert.equal(result.ok, false);
  assert.equal(result.persistence.commitState, 'failed');
  assert.equal(result.persistence.rollback.state, 'confirmed');
  assert.deepEqual(fixture.chatMetadata, before.metadata);
  assert.deepEqual(fixture.messages, before.messages);
});

test('a known Floor save failure is compensated without a Chat metadata write', async () => {
  let saveChatCalls = 0;
  const fixture = makeFixture({
    saveChat: async () => {
      saveChatCalls += 1;
      if (saveChatCalls === 1)
        throw Object.assign(new Error('floor write rejected'), { code: 'FLOOR_SAVE_FAILED' });
      return { commitState: 'confirmed' };
    },
  });
  const before = {
    metadata: cloneValue(fixture.chatMetadata),
    messages: cloneValue(fixture.messages),
  };

  const result = await fixture.service.clearAllBioWeaveData();

  assert.equal(result.ok, false);
  assert.equal(result.persistence.commitState, 'failed');
  assert.equal(result.persistence.rollback.state, 'confirmed');
  assert.equal(result.persistence.rollback.durable, 'confirmed');
  assert.deepEqual(result.persistence.rollback.steps, ['messages']);
  assert.equal(saveChatCalls, 2);
  assert.deepEqual(fixture.chatMetadata, before.metadata);
  assert.deepEqual(fixture.messages, before.messages);
});

test('an unconfirmed compensating Floor save is reported as partial failure', async () => {
  const fixture = makeFixture({
    saveChat: async () => {
      throw Object.assign(new Error('Floor persistence unavailable'), {
        code: 'FLOOR_SAVE_FAILED',
      });
    },
  });

  const result = await fixture.service.clearAllBioWeaveData();

  assert.equal(result.ok, false);
  assert.equal(result.persistence.commitState, 'failed');
  assert.equal(result.persistence.partial, true);
  assert.equal(result.changed, true);
  assert.equal(result.persistence.rollback.state, 'failed');
  assert.equal(result.persistence.rollback.durable, 'not_confirmed');
  assert.deepEqual(result.persistence.rollback.steps, []);
  assert.equal(result.persistence.rollback.error, 'FLOOR_SAVE_FAILED');
});

test('unknown persistence state leaves the attempted state visible and never performs blind rollback', async () => {
  const fixture = makeFixture({
    saveChat: async () => ({ commitState: 'unknown' }),
  });
  const before = cloneValue(fixture.messages);
  const result = await fixture.service.clearAllBioWeaveData();

  assert.equal(result.ok, false);
  assert.equal(result.persistence.commitState, 'unknown');
  assert.equal(result.changed, true);
  assert.notDeepEqual(fixture.messages, before);
  assert.deepEqual(fixture.globalSettings, {
    api_source: 'bioweave',
    api_profiles: { local: { profile_id: 'local', secret_ref: 'secret-ref' } },
    api_request_settings: { timeout: 120000, retry_count: 1 },
    analysis_prompt: { task: 'keep this global prompt' },
  });
});
