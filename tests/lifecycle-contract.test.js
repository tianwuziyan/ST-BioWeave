import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertLifecycleRegistryCoverage,
  CHAT_FIELD_REGISTRY,
  FLOOR_FIELD_REGISTRY,
  GLOBAL_FIELD_REGISTRY,
  LIFECYCLE_DOMAINS,
  USER_CLEARABLE_FLOOR_FIELDS,
  getClearableFields,
} from '../storage/lifecycle.js';
import { DEFAULT_EXTENSION_SETTINGS, emptyChat, emptyFloor } from '../storage/schema.js';
import { normalizeProjectionTimeline } from '../core/projection-persistence.js';

test('current Chat and Floor schema roots are all classified by the lifecycle registry', () => {
  const result = assertLifecycleRegistryCoverage({
    chatKeys: Object.keys(emptyChat('contract-chat')),
    floorKeys: Object.keys(emptyFloor()),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, { chat: [], floor: [] });
  assert.ok(Object.keys(CHAT_FIELD_REGISTRY).includes('data_lifecycle'));
  assert.ok(Object.keys(FLOOR_FIELD_REGISTRY).includes('floor_version'));
  assert.ok(Object.keys(FLOOR_FIELD_REGISTRY).includes('snapshot'));
  assert.ok(Object.values(LIFECYCLE_DOMAINS).includes('events'));
  assert.ok(Object.values(LIFECYCLE_DOMAINS).includes('runtime_cache'));
});

test('storyline roots normalize old projection timelines and preserve explicit empties', () => {
  const floor = emptyFloor();
  assert.deepEqual(floor.projection_timeline.storyline_snapshots, []);
  assert.deepEqual(floor.projection_timeline.storyline_delivery_records, []);
  const normalized = normalizeProjectionTimeline({schema_version: 1, creations: [], evidence_records: [], lifecycle_records: [], delivery_records: [], observation_records: []});
  assert.deepEqual(normalized.timeline.storyline_snapshots, []);
  assert.deepEqual(normalized.timeline.storyline_delivery_records, []);
  assert.equal(normalized.timeline.storyline_snapshot_complete, undefined);
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

test('user Floor clear operations are explicit allowlists and never include owner metadata', () => {
  assert.deepEqual(USER_CLEARABLE_FLOOR_FIELDS.character, [
    'analysis',
    'events',
    'character_registry',
    'snapshot',
    'projection_timeline',
    'projection_timing_snapshot',
    'tracking_window_timeline',
    'participant_aggregation_snapshot',
    'pregnancy_lifecycle_timeline',
    'pregnancy_knowledge_snapshot',
    'health_assessment_timeline',
  ]);
  assert.deepEqual(USER_CLEARABLE_FLOOR_FIELDS.world, [
    'world_model',
    'world_model_meta',
  ]);
  assert.deepEqual(USER_CLEARABLE_FLOOR_FIELDS.all, [
    ...USER_CLEARABLE_FLOOR_FIELDS.character,
    ...USER_CLEARABLE_FLOOR_FIELDS.world,
  ]);
  for (const field of ['v', 'floor_version', 'future_field']) {
    assert.equal(USER_CLEARABLE_FLOOR_FIELDS.all.includes(field), false, field);
  }
  assert.deepEqual(getClearableFields('chat', 'all'), []);
});
