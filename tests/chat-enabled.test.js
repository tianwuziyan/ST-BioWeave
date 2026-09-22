import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {emptyChat, normalizeChatSettings} from '../storage/schema.js';
import {createStore} from '../storage/store.js';
import {settingsPage} from '../ui/settings.js';

const APP_SOURCE = fs.readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');
const STYLE_SOURCE = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');

test('missing Chat enabled values normalize to true and explicit false survives', () => {
  assert.equal(emptyChat('chat-a').settings.enabled, true);
  assert.equal(normalizeChatSettings({}).enabled, true);
  assert.equal(normalizeChatSettings({enabled: false}).enabled, false);
  assert.equal(normalizeChatSettings({enabled: 'false'}).enabled, true);
});

test('settings page keeps the master switch only in the top header', () => {
  const settings = settingsPage({});
  assert.doesNotMatch(settings, /data-bioweave-action="toggle-bioweave-enabled"/);
  assert.doesNotMatch(settings, /BioWeave 总开关/);
});

test('enabled header control reuses the native checkbox and delegated Runtime action', () => {
  assert.match(APP_SOURCE, /class="bioweave-theme-button bioweave-enabled-control"/);
  assert.match(APP_SOURCE, /class="bioweave-checkbox" type="checkbox" data-bioweave-enabled-input/);
  assert.match(APP_SOURCE, /data-bioweave-enabled-label>已开启/);
  assert.match(APP_SOURCE, /event\.preventDefault\(\)\s*await toggleBioWeaveEnabled\(\)/);
  assert.match(STYLE_SOURCE, /\.bioweave-panel \.bioweave-enabled-control\s*\{/);
  assert.doesNotMatch(APP_SOURCE, /data-bioweave-enabled-toggle[^>]*aria-pressed/);
});

test('enabled persists per Chat and does not follow a character card', async () => {
  let chatId = 'chat-a';
  const metadata = {bioweave: emptyChat('chat-a')};
  const adapter = {
    getChatId: () => chatId,
    getChatMetadata: () => metadata,
    async saveChatMetadata(key, value) { metadata[key] = structuredClone(value); },
  };
  const store = createStore(adapter);
  await store.saveChat('chat-a', {...store.getChat('chat-a'), settings: {...store.getChat('chat-a').settings, enabled: false}});
  assert.equal(store.getChat('chat-a').settings.enabled, false);
  chatId = 'chat-b';
  assert.equal(store.getChat('chat-b').settings.enabled, true);
  chatId = 'chat-a';
  assert.equal(store.getChat('chat-a').settings.enabled, false);
});
