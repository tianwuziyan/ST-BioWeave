import test from 'node:test';
import assert from 'node:assert/strict';
import {createDebugHandle} from '../index.js';
import {createCharacterTimingConfigStore} from '../storage/character-timing.js';

const configInput = {
  schema_version: 1,
  config_version: 1,
  base_min_story_days: 2,
  base_max_story_days: 4,
  variance_ratio: 0,
  variance_cap_story_days: 0,
  total_adjustment_cap_story_days: 0,
};

function createFixtureRuntime() {
  let currentChatId = 'chat-a';
  const chats = {
    'chat-a': {chat_scope: {chat_id: 'chat-a'}, settings: {}},
    'chat-b': {chat_scope: {chat_id: 'chat-b'}, settings: {}},
  };
  const saveCalls = [];
  const store = {
    getChat: chatId => chats[chatId ?? currentChatId],
    saveChat: async (chatId, next) => {
      saveCalls.push(chatId);
      chats[chatId] = next;
    },
  };
  const timing = createCharacterTimingConfigStore({store, getChatId: () => currentChatId});
  const runtime = {
    getTrackingRegistry: async () => ({character_registry: {schema_version: 1, entities: {
      char_000001: {character_id: 'char_000001', display_name: 'Test Subject', aliases: []},
    }}}),
    getCharacterTimingConfig: timing.getConfig,
    saveCharacterTimingConfig: timing.saveConfig,
    resetCharacterTimingConfig: timing.resetConfig,
  };
  return {runtime, chats, saveCalls, switchChat: chatId => {currentChatId = chatId;}};
}

test('debug timing save facade delegates to official Chat-local persistence and reads back', async () => {
  const fixture = createFixtureRuntime();
  const debug = createDebugHandle(fixture.runtime);

  const saved = await debug.saveCharacterTimingConfig({characterId: 'char_000001', config: configInput});

  assert.deepEqual(saved.config, configInput);
  assert.equal(saved.overridden, true);
  assert.deepEqual(fixture.runtime.getCharacterTimingConfig({characterId: 'char_000001'}).config, configInput);
  assert.deepEqual(fixture.saveCalls, ['chat-a']);
  assert.deepEqual(fixture.chats['chat-a'].settings.character_timing_configs['char_000001'], configInput);
  assert.equal(fixture.chats['chat-a'].events, undefined);
  assert.equal(fixture.chats['chat-a'].projection_timing_timeline, undefined);
});

test('debug timing facade preserves formal validation and fails closed for unknown IDs', async () => {
  const fixture = createFixtureRuntime();
  const debug = createDebugHandle(fixture.runtime);

  await assert.rejects(
    debug.saveCharacterTimingConfig({characterId: 'char_000001', config: {...configInput, base_max_story_days: 1}}),
    /base_max_story_days:before_min/,
  );
  await assert.rejects(
    debug.saveCharacterTimingConfig({characterId: 'Test Subject', config: configInput}),
    /CANONICAL_CHARACTER_ID_REQUIRED/,
  );
  await assert.rejects(
    debug.saveCharacterTimingConfig({characterId: 'char_000002', config: configInput}),
    /UNKNOWN_CHARACTER_ID/,
  );
  assert.deepEqual(fixture.saveCalls, []);
});

test('debug timing facade rejects cross-Chat writes and preserves Chat isolation', async () => {
  const fixture = createFixtureRuntime();
  const debug = createDebugHandle(fixture.runtime);

  await debug.saveCharacterTimingConfig({characterId: 'char_000001', config: configInput});
  fixture.switchChat('chat-b');
  assert.equal(fixture.runtime.getCharacterTimingConfig({characterId: 'char_000001'}).config, null);
  await assert.rejects(
    debug.resetCharacterTimingConfig({chatId: 'chat-a', characterId: 'char_000001'}),
    /DEBUG_TIMING_CHAT_OVERRIDE_NOT_ALLOWED/,
  );
  assert.deepEqual(fixture.chats['chat-a'].settings.character_timing_configs['char_000001'], configInput);
  assert.equal(fixture.chats['chat-b'].settings.character_timing_configs?.['char_000001'], undefined);
});

test('debug timing reset delegates to official reset and only changes the Chat-local override', async () => {
  const fixture = createFixtureRuntime();
  const debug = createDebugHandle(fixture.runtime);

  await debug.saveCharacterTimingConfig({characterId: 'char_000001', config: configInput});
  const reset = await debug.resetCharacterTimingConfig({characterId: 'char_000001'});

  assert.deepEqual(reset, {config: null, overridden: false});
  assert.equal(fixture.runtime.getCharacterTimingConfig({characterId: 'char_000001'}).config, null);
  assert.deepEqual(fixture.saveCalls, ['chat-a', 'chat-a']);
});
