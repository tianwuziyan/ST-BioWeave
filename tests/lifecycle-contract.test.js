import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertLifecycleRegistryCoverage,
  CHAT_FIELD_REGISTRY,
  FLOOR_FIELD_REGISTRY,
  GLOBAL_FIELD_REGISTRY,
  LIFECYCLE_DOMAINS,
  getClearableFields,
} from '../storage/lifecycle.js';
import { DEFAULT_EXTENSION_SETTINGS, emptyChat, emptyFloor } from '../storage/schema.js';

test('current Chat and Floor schema roots are all classified by the lifecycle registry', () => {
  const result = assertLifecycleRegistryCoverage({
    chatKeys: Object.keys(emptyChat('contract-chat')),
    floorKeys: Object.keys(emptyFloor()),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, { chat: [], floor: [] });
  assert.ok(Object.keys(CHAT_FIELD_REGISTRY).includes('data_lifecycle'));
  assert.ok(Object.keys(FLOOR_FIELD_REGISTRY).includes('floor_version'));
  assert.ok(Object.values(LIFECYCLE_DOMAINS).includes('events'));
  assert.ok(Object.values(LIFECYCLE_DOMAINS).includes('snapshot'));
  assert.ok(Object.values(LIFECYCLE_DOMAINS).includes('projection'));
  assert.ok(Object.values(LIFECYCLE_DOMAINS).includes('history'));
  assert.ok(Object.values(LIFECYCLE_DOMAINS).includes('runtime_cache'));
});

test('an unregistered persistent root fails closed in the contract helper', () => {
  assert.throws(
    () =>
      assertLifecycleRegistryCoverage({
        chatKeys: [...Object.keys(emptyChat('contract-chat')), 'future_clearable_root'],
        floorKeys: Object.keys(emptyFloor()),
      }),
    (error) => {
      assert.equal(error.code, 'LIFECYCLE_REGISTRY_INCOMPLETE');
      assert.deepEqual(error.missing.chat, ['future_clearable_root']);
      return true;
    },
  );
});

test('global settings are explicitly non-clearable and every clearable root exists in the schema', () => {
  for (const [field, definition] of Object.entries(GLOBAL_FIELD_REGISTRY)) {
    assert.equal(definition.scope, 'global', field);
    assert.equal(definition.clear, 'preserve', field);
    assert.equal(definition.clearOn, undefined, field);
    assert.ok(Object.hasOwn(DEFAULT_EXTENSION_SETTINGS, field), field);
  }
  assert.deepEqual(getClearableFields('global', 'all'), []);

  for (const operation of ['character', 'world', 'all']) {
    for (const field of getClearableFields('chat', operation)) {
      assert.ok(Object.hasOwn(emptyChat('contract-chat'), field), `${operation}: ${field}`);
    }
    for (const field of getClearableFields('floor', operation)) {
      assert.ok(Object.hasOwn(emptyFloor(), field), `${operation}: ${field}`);
    }
  }
});
