import {readCharacterTimingConfig, resetCharacterTimingConfig, withCharacterTimingConfig} from '../core/character-timing-config.js';

export function createCharacterTimingConfigStore({store, getChatId = null} = {}) {
  if (!store || typeof store.getChat !== 'function' || typeof store.saveChat !== 'function') throw new TypeError('CHARACTER_TIMING_STORE_REQUIRED');
  function chatIdOrCurrent(chatId) { return chatId ?? getChatId?.(); }
  function getConfig({chatId = null, characterId, baseline = null} = {}) {
    const chat = store.getChat(chatIdOrCurrent(chatId));
    const override = readCharacterTimingConfig(chat, characterId);
    return override.config ? override : {config: baseline, overridden: false};
  }
  async function saveConfig({chatId = null, characterId, config} = {}) {
    const resolvedChatId = chatIdOrCurrent(chatId);
    const next = withCharacterTimingConfig(store.getChat(resolvedChatId), characterId, config);
    await store.saveChat(resolvedChatId, next);
    return readCharacterTimingConfig(store.getChat(resolvedChatId), characterId);
  }
  async function resetConfig({chatId = null, characterId} = {}) {
    const resolvedChatId = chatIdOrCurrent(chatId);
    const next = resetCharacterTimingConfig(store.getChat(resolvedChatId), characterId);
    await store.saveChat(resolvedChatId, next);
    return {config: null, overridden: false};
  }
  return {getConfig, saveConfig, resetConfig};
}
