import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDeviceLocalPreferences,
  FLOATING_LAUNCHER_POSITION_KEY,
  THEME_PREFERENCE_KEY,
} from '../core/device-local-preferences.js';

function storageFixture(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test('device-local preferences prefer explicit storage over host Window storage', () => {
  const explicit = storageFixture();
  const host = storageFixture({[THEME_PREFERENCE_KEY]: 'light'});
  const preferences = createDeviceLocalPreferences({
    documentRef: {defaultView: {localStorage: host}},
    windowRef: {localStorage: host},
    storageRef: explicit,
  });
  assert.equal(preferences.readTheme(), null);
  preferences.writeTheme('dark');
  assert.equal(explicit.values.get(THEME_PREFERENCE_KEY), 'dark');
  assert.equal(host.values.get(THEME_PREFERENCE_KEY), 'light');
});

test('device-local preferences use the host Window storage realm', () => {
  const host = storageFixture({[THEME_PREFERENCE_KEY]: 'dark'});
  const globalLike = storageFixture({[THEME_PREFERENCE_KEY]: 'light'});
  const previous = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: globalLike});
  try {
    const preferences = createDeviceLocalPreferences({windowRef: {localStorage: host}});
    assert.equal(preferences.readTheme(), 'dark');
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: previous});
  }
});

test('device-local preferences read and write Theme values with verification', () => {
  const storage = storageFixture();
  const preferences = createDeviceLocalPreferences({storageRef: storage});
  preferences.writeTheme('dark');
  assert.equal(preferences.readTheme(), 'dark');
  assert.equal(storage.values.get(THEME_PREFERENCE_KEY), 'dark');
});

test('device-local preferences keep Theme write verification best effort', () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = message => warnings.push(message);
  try {
    const preferences = createDeviceLocalPreferences({storageRef: {getItem: () => 'tavern', setItem() {}}});
    assert.doesNotThrow(() => preferences.writeTheme('dark'));
  } finally {
    console.warn = originalWarn;
  }
  assert.ok(warnings.some(message => message.includes('THEME_STORAGE_VERIFY_FAILED')));
});

test('device-local preferences keep Theme read and write failures non-throwing', () => {
  const preferences = createDeviceLocalPreferences({storageRef: {
    getItem: () => { throw new Error('READ_FAILED'); },
    setItem: () => { throw new Error('WRITE_FAILED'); },
  }});
  assert.doesNotThrow(() => preferences.readTheme());
  assert.doesNotThrow(() => preferences.writeTheme('dark'));
});

test('device-local preferences serialize and restore Launcher position', () => {
  const storage = storageFixture();
  const preferences = createDeviceLocalPreferences({storageRef: storage});
  preferences.writeLauncherPosition({x: 120, y: 240});
  assert.deepEqual(preferences.readLauncherPosition(), {x: 120, y: 240});
  assert.equal(storage.values.get(FLOATING_LAUNCHER_POSITION_KEY), JSON.stringify({x: 120, y: 240}));
});

test('device-local preferences fail safe for malformed Launcher position JSON', () => {
  const preferences = createDeviceLocalPreferences({storageRef: storageFixture({[FLOATING_LAUNCHER_POSITION_KEY]: '{bad json'})});
  assert.equal(preferences.readLauncherPosition(), null);
});

test('device-local preferences keep Launcher storage failures non-throwing', () => {
  const preferences = createDeviceLocalPreferences({storageRef: {
    getItem: () => { throw new Error('READ_FAILED'); },
    setItem: () => { throw new Error('WRITE_FAILED'); },
  }});
  assert.doesNotThrow(() => preferences.readLauncherPosition());
  assert.doesNotThrow(() => preferences.writeLauncherPosition({x: 1, y: 2}));
});

test('device-local preferences fail safe when storage is unavailable', () => {
  const preferences = createDeviceLocalPreferences({storageRef: null});
  assert.equal(preferences.readTheme(), null);
  assert.equal(preferences.readLauncherPosition(), null);
  assert.doesNotThrow(() => preferences.writeTheme('dark'));
  assert.doesNotThrow(() => preferences.writeLauncherPosition({x: 1, y: 2}));
});
