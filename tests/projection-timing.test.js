import test from 'node:test';
import assert from 'node:assert/strict';
import {resetCharacterTimingConfig, resolveCharacterTimingConfig, validateCharacterTimingConfig, withCharacterTimingConfig} from '../core/character-timing-config.js';
import {buildProjectionTimingCycleId, editProjectionTimingInstance, evaluateProjectionTiming, resolveProjectionTimingInstance} from '../core/projection-timing.js';
import {emptyProjectionTimingSnapshot, normalizeProjectionTimingSnapshot, upsertProjectionTimingInstance} from '../core/projection-timing-persistence.js';
import {buildProjectionRuleId, evaluateProjectionEligibility} from '../core/projection-eligibility.js';
import {getHumanPreconfirmationTimingPreset, HUMAN_PRECONFIRMATION_TIMING_PRESET_CLASSIFICATION, HUMAN_PRECONFIRMATION_TIMING_PRESET_VERSION} from '../core/human-timing-preset.js';
import {createProjectionTimingPersistence} from '../storage/projection-timing.js';
import {emptyFloor} from '../storage/schema.js';
import {createStore} from '../storage/store.js';
import {floorVersion as buildFloorVersion} from '../runtime/floor.js';

const config = {schema_version: 1, config_version: 1, base_min_story_days: 10, base_max_story_days: 20, variance_ratio: 0.2, variance_cap_story_days: 3, total_adjustment_cap_story_days: 2};
const floorVersion = {chat_id: 'chat-timing', message_id: 'message-1', floor: 1, swipe_id: 0, content_hash: 'hash', message_version: 'v1'};
const hostFloorVersion = {chat_id: 'chat-timing', message_id: 70, floor: 70, swipe_id: 0, content_hash: 'host-hash', message_version: 'v1:host-hash'};
const historicalExposureFloorVersion = {chat_id: 'chat-timing', message_id: 58, floor: 58, swipe_id: 0, content_hash: 'historical-hash', message_version: 'v1:historical-hash'};
const event = {event_id: 'event-1', type: 'sexual_activity', status: 'confirmed', story_time: {day_index: 100}, pregnancy_relevance: {relevant: true, gestational_subject_ids: ['char_000001'], reproductive_mechanism: {kind: 'fertilization'}}};

test('store reads missing Timing and Aggregation roots as absent rather than explicit empty snapshots', () => {
  const message = {role: 'assistant', message_id: 'message-1', extra: {}};
  const store = createStore({
    getChatId: () => 'chat-timing',
    getMessage: index => index === 0 ? message : null,
  });
  const floor = store.getFloor(0, 0);
  assert.equal(Object.hasOwn(floor, 'projection_timing_snapshot'), false);
  assert.equal(Object.hasOwn(floor, 'participant_aggregation_snapshot'), false);
});

function timingFor(version, eventId, sampled = 0.5) {
  return resolveProjectionTimingInstance({
    chatId: version.chat_id,
    subjectId: 'char_000001',
    mechanismKey: 'fertilization',
    firstEvent: {...event, event_id: eventId},
    config,
    floorVersion: version,
    rng: () => sampled,
  });
}

function historyFixture(entries, {activeSwipes = {}} = {}) {
  const floors = new Map(entries.map(({index, swipeId = 0, floor}) => [`${index}:${swipeId}`, structuredClone(floor)]));
  const messages = Array.from({length: Math.max(0, ...entries.map(entry => entry.index)) + 1}, () => ({}));
  const currentVersions = new Map(entries.map(({index, floor}) => [index, structuredClone(floor.floor_version)]));
  const store = {
    getActiveSwipeId: index => activeSwipes[index] ?? 0,
    getFloorOwner: index => ({owner_type: 'character', active_swipe_id: activeSwipes[index] ?? 0}),
    getFloor: (index, swipeId = 0) => structuredClone(floors.get(`${index}:${swipeId}`) ?? emptyFloor()),
    getCurrentChatOwnerSnapshot: () => ({messages}),
    async saveFloor(index, swipeId, next) { floors.set(`${index}:${swipeId}`, structuredClone(next)); },
  };
  return {
    store,
    floors,
    currentVersions,
    resolverCalls: [],
    resolveCurrentFloorVersion: async ({ownerFloor, floorVersion}) => {
      const index = ownerFloor?.message_index;
      const current = currentVersions.get(index);
      return current ? structuredClone(current) : structuredClone(floorVersion);
    },
  };
}

test('Human pre-confirmation timing preset is a versioned product narrative policy', () => {
  assert.equal(HUMAN_PRECONFIRMATION_TIMING_PRESET_VERSION, 'human-narrative-v1');
  assert.equal(HUMAN_PRECONFIRMATION_TIMING_PRESET_CLASSIFICATION, 'PRODUCT_POLICY_CONSERVATIVE_NARRATIVE_PRESET');
  assert.deepEqual(getHumanPreconfirmationTimingPreset(), {
    schema_version: 1,
    config_version: 1,
    base_min_story_days: 14,
    base_max_story_days: 42,
    variance_ratio: 0.1,
    variance_cap_story_days: 3,
    total_adjustment_cap_story_days: 3,
  });
  assert.equal(Object.hasOwn(getHumanPreconfirmationTimingPreset(), 'projection_rule_id'), false);
  assert.equal(Object.hasOwn(getHumanPreconfirmationTimingPreset(), 'timing_instance_id'), false);
});

test('character timing config rejects invalid numeric values and preserves Chat-local override/reset semantics', () => {
  assert.equal(validateCharacterTimingConfig({...config, variance_ratio: Infinity}).ok, false);
  const chat = {settings: {character_timing_configs: {}}};
  const withOverride = withCharacterTimingConfig(chat, 'char_000001', config);
  assert.equal(resolveCharacterTimingConfig({override: withOverride.settings.character_timing_configs['char_000001']}).config.config_version, 1);
  assert.equal(withCharacterTimingConfig(withOverride, 'char_000001', config).settings.character_timing_configs['char_000001'].config_version, 2);
  assert.equal(resetCharacterTimingConfig(withOverride, 'char_000001').settings.character_timing_configs['char_000001'], undefined);
  assert.equal(resolveCharacterTimingConfig({baseline: config}).overridden, false);
});

test('Timing Instance accepts the canonical host Floor Version and preserves historical Exposure provenance', () => {
  const historicalEvent = {...event, version: historicalExposureFloorVersion};
  const timing = resolveProjectionTimingInstance({
    chatId: hostFloorVersion.chat_id,
    subjectId: 'char_000001',
    mechanismKey: 'fertilization',
    firstEvent: historicalEvent,
    config,
    floorVersion: hostFloorVersion,
    rng: () => 0.5,
  });

  assert.deepEqual(timing.created_at_floor_version, {
    chat_id: hostFloorVersion.chat_id,
    message_id: hostFloorVersion.message_id,
    floor: hostFloorVersion.floor,
    swipe_id: hostFloorVersion.swipe_id,
  });
  assert.deepEqual(timing.source_basis_refs[event.event_id].event_version, historicalExposureFloorVersion);
});

test('Timing Instance rejects missing or invalid Floor Version identity fields', () => {
  for (const field of ['chat_id', 'message_id', 'floor', 'swipe_id']) {
    const invalidVersion = {...hostFloorVersion, [field]: null};
    assert.throws(
      () => resolveProjectionTimingInstance({
        chatId: hostFloorVersion.chat_id,
        subjectId: 'char_000001',
        mechanismKey: 'fertilization',
        firstEvent: event,
        config,
        floorVersion: invalidVersion,
        rng: () => 0.5,
      }),
      /projection_timing\.created_at_floor_version:invalid/,
    );
  }
  assert.throws(
    () => resolveProjectionTimingInstance({
      chatId: hostFloorVersion.chat_id,
      subjectId: 'char_000001',
      mechanismKey: 'fertilization',
      firstEvent: event,
      config,
      floorVersion: {...hostFloorVersion, message_id: {id: 70}},
      rng: () => 0.5,
    }),
    /projection_timing\.created_at_floor_version:invalid/,
  );
});

test('Timing persistence keeps Floor Version and active Swipe stale guards while deduping one cycle', async () => {
  let activeSwipe = 0;
  let saveCount = 0;
  let floor = {...emptyFloor(), floor_version: hostFloorVersion};
  const store = {
    getActiveSwipeId: () => activeSwipe,
    getFloorOwner: () => ({owner_type: 'character', active_swipe_id: activeSwipe}),
    getFloor: () => structuredClone(floor),
    getCurrentChatOwnerSnapshot: () => ({messages: [{}]}),
    async saveFloor(_index, _swipe, next) { saveCount += 1; floor = structuredClone(next); },
  };
  const persistence = createProjectionTimingPersistence({
    store,
    resolveCurrentFloorVersion: async () => hostFloorVersion,
  });
  const timing = resolveProjectionTimingInstance({
    chatId: hostFloorVersion.chat_id,
    subjectId: 'char_000001',
    mechanismKey: 'fertilization',
    firstEvent: event,
    config,
    floorVersion: hostFloorVersion,
    rng: () => 1,
  });
  const ownerFloor = {message_index: 0, swipe_id: 0};

  assert.equal((await persistence.saveTimingInstance({chatId: hostFloorVersion.chat_id, ownerFloor, floorVersion: hostFloorVersion, timingInstance: timing})).status, 'created');
  const deduped = await persistence.saveTimingInstance({chatId: hostFloorVersion.chat_id, ownerFloor, floorVersion: hostFloorVersion, timingInstance: timing});
  assert.equal(deduped.status, 'deduped');
  assert.equal(deduped.noWrite, true);
  assert.equal(saveCount, 1);
  assert.equal((await persistence.getTimingInstances({chatId: hostFloorVersion.chat_id, endpointFloor: hostFloorVersion.floor})).items.length, 1);
  assert.equal((await persistence.getTimingInstances({chatId: hostFloorVersion.chat_id, endpointFloor: hostFloorVersion.floor})).items[0].sampled_individual_offset_story_days, timing.sampled_individual_offset_story_days);

  const editedBody = await persistence.saveTimingInstance({
    chatId: hostFloorVersion.chat_id,
    ownerFloor,
    floorVersion: {...hostFloorVersion, content_hash: 'edited-body'},
    timingInstance: timing,
  });
  assert.equal(editedBody.status, 'deduped');
  activeSwipe = 1;
  await assert.rejects(
    persistence.saveTimingInstance({chatId: hostFloorVersion.chat_id, ownerFloor, floorVersion: hostFloorVersion, timingInstance: timing}),
    error => error.code === 'FLOOR_SWIPE_STALE',
  );
});

test('Timing persistence prefers message_index over numeric host message_id and audits an internal slot mismatch', async () => {
  let floor = {...emptyFloor(), floor_version: hostFloorVersion};
  const store = {
    getActiveSwipeId: index => index === 1 ? 0 : null,
    getFloorOwner: () => ({owner_type: 'character', active_swipe_id: 0}),
    getFloor: index => index === 1 ? structuredClone(floor) : emptyFloor(),
    getCurrentChatOwnerSnapshot: () => ({messages: [{}, {}]}),
    async saveFloor(_index, _swipe, next) { floor = structuredClone(next); },
  };
  const persistence = createProjectionTimingPersistence({
    store,
    resolveCurrentFloorVersion: async () => hostFloorVersion,
  });
  const timing = resolveProjectionTimingInstance({
    chatId: hostFloorVersion.chat_id,
    subjectId: 'char_000001',
    mechanismKey: 'fertilization',
    firstEvent: event,
    config,
    floorVersion: hostFloorVersion,
    rng: () => 1,
  });

  const saved = await persistence.saveTimingInstance({
    chatId: hostFloorVersion.chat_id,
    ownerFloor: {message_index: 1, message_id: 70, swipe_id: 0},
    floorVersion: hostFloorVersion,
    timingInstance: timing,
  });
  assert.equal(saved.status, 'created');

  floor = {...emptyFloor(), floor_version: {...hostFloorVersion, message_id: 71}};
  await assert.rejects(
    persistence.saveTimingInstance({
      chatId: hostFloorVersion.chat_id,
      ownerFloor: {message_index: 1, message_id: 70, swipe_id: 0},
      floorVersion: hostFloorVersion,
      timingInstance: timing,
    }),
    error => error.code === 'FLOOR_VERSION_STALE'
      && error.validation_layer === 'projection_timing_storage_owner'
      && error.owner_message_index === 1
      && error.owner_message_id === 70
      && error.version_classification === 'INTERNAL_OWNER_SLOT_MISMATCH'
      && error.version_audit.mismatch_fields.includes('message_id'),
  );
});

test('manual edit accepts the same logical owner with a stale legacy snapshot', async () => {
  const message = {
    role: 'assistant',
    message_id: 72,
    floor: 72,
    content: '人工编辑后的当前正文',
    extra: {},
  };
  const oldVersion = {
    chat_id: 'chat-timing',
    message_id: 72,
    floor: 72,
    swipe_id: 0,
    content_hash: 'a29ab3f742a62daf08bd70a5367f82f43c20b1e32406bea170ae528a9d5d4d40',
    message_version: 'v1:a29ab3f742a62daf08bd70a5367f82f43c20b1e32406bea170ae528a9d5d4d40',
  };
  let floor = {...emptyFloor(), floor_version: oldVersion};
  const store = {
    getActiveSwipeId: () => 0,
    getFloorOwner: () => ({owner_type: 'character', active_swipe_id: 0}),
    getFloor: () => structuredClone(floor),
    getCurrentChatOwnerSnapshot: () => ({messages: [message]}),
    async saveFloor(_index, _swipe, next) { floor = structuredClone(next); },
  };
  const currentVersion = await buildFloorVersion({
    chatId: 'chat-timing',
    messageId: 72,
    floor: 72,
    swipeId: 0,
    text: message.content,
    messageVersion: 'v1:current-edit-start-72',
  });
  assert.deepEqual(currentVersion, {
    chat_id: 'chat-timing', message_id: 72, floor: 72, swipe_id: 0,
  });

  const persistence = createProjectionTimingPersistence({
    store,
    resolveCurrentFloorVersion: async () => currentVersion,
  });
  const timing = timingFor(oldVersion, 'manual-edit-current-content');
  floor.projection_timing_snapshot = {schema_version: 1, items: [timing]};
  const beforeEdit = await persistence.getTimingInstances({
    chatId: 'chat-timing',
    endpointFloor: currentVersion.floor,
    endpointIndex: 0,
    editStartFloorVersion: currentVersion,
  });
  assert.equal(beforeEdit.items[0]?.timing_instance_id, timing.timing_instance_id);

  const edited = await persistence.editTimingInstance({
      chatId: 'chat-timing',
      ownerFloor: {message_index: 0, message_id: 72, swipe_id: 0},
      floorVersion: currentVersion,
      timingInstanceId: timing.timing_instance_id,
      baseMinStoryDays: 12,
      baseMaxStoryDays: 24,
      operation_type: 'manual-timing-instance-edit',
      editStartFloorVersion: currentVersion,
    });
  assert.equal(edited.status, 'updated');
  assert.deepEqual(floor.floor_version, currentVersion);
  assert.equal(floor.projection_timing_snapshot.items[0].base_min_story_days, 12);

  const beforeRejectedEdit = structuredClone(floor);
  const liveChangedPersistence = createProjectionTimingPersistence({
    store,
    resolveCurrentFloorVersion: async () => ({...currentVersion, message_id: 73}),
  });
  await assert.rejects(
    liveChangedPersistence.editTimingInstance({
      chatId: 'chat-timing',
      ownerFloor: {message_index: 0, message_id: 72, swipe_id: 0},
      floorVersion: currentVersion,
      timingInstanceId: timing.timing_instance_id,
      baseMinStoryDays: 13,
      baseMaxStoryDays: 25,
      operation_type: 'manual-timing-instance-edit',
      editStartFloorVersion: currentVersion,
    }),
    error => error.code === 'FLOOR_VERSION_STALE'
      && error.version_classification === 'TRUE_CONTEXT_VERSION_CHANGE'
      && error.version_audit.mismatch_fields.includes('message_id'),
  );
  assert.deepEqual(floor, beforeRejectedEdit);
});

test('manual Timing edit rejects a stale edit-start version even when the current Snapshot is synchronized', async () => {
  let floor = {...emptyFloor(), floor_version: hostFloorVersion};
  const store = {
    getActiveSwipeId: () => 0,
    getFloor: () => structuredClone(floor),
    getCurrentChatOwnerSnapshot: () => ({messages: [{role: 'assistant', message_id: hostFloorVersion.message_id, content: 'current'}]}),
    async saveFloor(_index, _swipe, next) { floor = structuredClone(next); },
  };
  const persistence = createProjectionTimingPersistence({
    store,
    resolveCurrentFloorVersion: async () => hostFloorVersion,
  });
  const timing = timingFor(hostFloorVersion, 'stale-edit-start');
  floor.projection_timing_snapshot = {schema_version: 1, items: [timing]};
  const staleEditStart = {...hostFloorVersion, message_id: 71};
  await assert.rejects(
    persistence.editTimingInstance({
      chatId: hostFloorVersion.chat_id,
      ownerFloor: {message_index: 0, message_id: hostFloorVersion.message_id, swipe_id: 0},
      floorVersion: hostFloorVersion,
      timingInstanceId: timing.timing_instance_id,
      baseMinStoryDays: 12,
      baseMaxStoryDays: 24,
      operation_type: 'manual-timing-instance-edit',
      editStartFloorVersion: staleEditStart,
    }),
    error => error.code === 'FLOOR_VERSION_STALE'
      && error.version_audit.mismatch_fields.includes('message_id')
      && error.version_classification === 'TRUE_CONTEXT_VERSION_CHANGE',
  );
  assert.deepEqual(floor.projection_timing_snapshot.items[0], timing);
});

test('Timing persistence edits one frozen instance through the current Floor snapshot', async () => {
  let floor = {...emptyFloor(), floor_version: hostFloorVersion};
  const store = {
    getActiveSwipeId: () => 0,
    getFloorOwner: () => ({owner_type: 'character', active_swipe_id: 0}),
    getFloor: () => structuredClone(floor),
    getCurrentChatOwnerSnapshot: () => ({messages: [{}]}),
    async saveFloor(_index, _swipe, next) { floor = structuredClone(next); },
  };
  const persistence = createProjectionTimingPersistence({
    store,
    resolveCurrentFloorVersion: async () => hostFloorVersion,
  });
  const timing = resolveProjectionTimingInstance({
    chatId: hostFloorVersion.chat_id,
    subjectId: 'char_000001',
    mechanismKey: 'fertilization',
    firstEvent: event,
    config: {...config, base_min_story_days: 10, base_max_story_days: 16},
    floorVersion: hostFloorVersion,
    rng: () => 1,
  });
  const ownerFloor = {message_index: 0, swipe_id: 0};
  await persistence.saveTimingInstance({chatId: hostFloorVersion.chat_id, ownerFloor, floorVersion: hostFloorVersion, timingInstance: timing});
  const edited = await persistence.editTimingInstance({
    chatId: hostFloorVersion.chat_id,
    ownerFloor,
    floorVersion: hostFloorVersion,
    timingInstanceId: timing.timing_instance_id,
    baseMinStoryDays: 18,
    baseMaxStoryDays: 20,
    operation_type: 'manual-timing-instance-edit',
  });
  assert.equal(edited.status, 'updated');
  const readback = await persistence.getTimingInstances({chatId: hostFloorVersion.chat_id, endpointFloor: hostFloorVersion.floor});
  assert.equal(readback.items[0].timing_instance_id, timing.timing_instance_id);
  assert.equal(readback.items[0].cycle_id, timing.cycle_id);
  assert.equal(readback.items[0].sampled_individual_offset_story_days, timing.sampled_individual_offset_story_days);
  assert.equal(readback.items[0].base_min_story_days, 18);
  assert.equal(readback.items[0].base_max_story_days, 20);
  const editedOwner = await persistence.editTimingInstance({
    chatId: hostFloorVersion.chat_id,
    ownerFloor,
    floorVersion: {...hostFloorVersion, content_hash: 'edited-body'},
    timingInstanceId: timing.timing_instance_id,
    baseMinStoryDays: 19,
    baseMaxStoryDays: 21,
  });
  assert.equal(editedOwner.status, 'updated');
  await assert.rejects(
    persistence.editTimingInstance({
      chatId: hostFloorVersion.chat_id,
      ownerFloor,
      floorVersion: hostFloorVersion,
      timingInstanceId: 'missing-timing-instance',
      baseMinStoryDays: 19,
      baseMaxStoryDays: 21,
    }),
    error => error.code === 'TIMING_INSTANCE_NOT_FOUND',
  );
});

test('Timing persistence requires an explicit chat-array message index', async () => {
  const store = {
    getActiveSwipeId: () => 0,
    getFloor: () => emptyFloor(),
    async saveFloor() {},
  };
  const persistence = createProjectionTimingPersistence({
    store,
    resolveCurrentFloorVersion: async () => hostFloorVersion,
  });
  await assert.rejects(
    persistence.saveTimingInstance({
      chatId: hostFloorVersion.chat_id,
      ownerFloor: {message_id: hostFloorVersion.message_id, swipe_id: 0},
      floorVersion: hostFloorVersion,
      timingInstance: timingFor(hostFloorVersion, 'explicit-index-required'),
    }),
    error => error.code === 'FLOOR_OWNER_REQUIRED',
  );
});

test('Timing snapshots replace a complete Floor collection, inherit absent roots, and stop at explicit empty roots', async () => {
  const v20 = {...hostFloorVersion, message_id: 20, floor: 20, content_hash: 'hash-20', message_version: 'v1:20'};
  const v26 = {...hostFloorVersion, message_id: 26, floor: 26, content_hash: 'hash-26', message_version: 'v1:26'};
  const v30 = {...hostFloorVersion, message_id: 30, floor: 30, content_hash: 'hash-30', message_version: 'v1:30'};
  const v40 = {...hostFloorVersion, message_id: 40, floor: 40, content_hash: 'hash-40', message_version: 'v1:40'};
  const a20 = timingFor(v20, 'exposure-a', 0.5);
  const b20 = timingFor(v20, 'exposure-b', 0.5);
  const fixture = historyFixture([
    {index: 0, floor: {...emptyFloor(), floor_version: v20, projection_timing_snapshot: {schema_version: 1, items: [a20, b20]}}},
    {index: 1, floor: {floor_version: v26}},
    {index: 2, floor: {floor_version: v30}},
    {index: 3, floor: {floor_version: v40, projection_timing_snapshot: {schema_version: 1, items: [timingFor(v40, 'future-exposure')]}}},
  ]);
  const persistence = createProjectionTimingPersistence({store: fixture.store, resolveCurrentFloorVersion: fixture.resolveCurrentFloorVersion});

  const inherited = await persistence.getTimingInstances({chatId: v20.chat_id, endpointFloor: 26});
  assert.deepEqual(inherited.items.map(item => item.timing_instance_id), [a20.timing_instance_id, b20.timing_instance_id].sort());
  assert.equal(inherited.source_index, 0);
  const inheritedThroughAbsent = await persistence.getTimingInstances({chatId: v20.chat_id, endpointFloor: 32});
  assert.deepEqual(inheritedThroughAbsent.items.map(item => item.timing_instance_id), [a20.timing_instance_id, b20.timing_instance_id].sort());
  assert.equal(inheritedThroughAbsent.source_index, 0);
  const bounded = await persistence.getTimingInstances({chatId: v20.chat_id, endpointFloor: 23});
  assert.deepEqual(bounded.items.map(item => item.timing_instance_id), [a20.timing_instance_id, b20.timing_instance_id].sort());
  const futureBounded = await persistence.getTimingInstances({chatId: v20.chat_id, endpointFloor: 32, endpointIndex: 2});
  assert.deepEqual(futureBounded.items.map(item => item.timing_instance_id), [a20.timing_instance_id, b20.timing_instance_id].sort());
  assert.equal(futureBounded.items.some(item => item.source_event_ids.includes('future-exposure')), false);

  const a26 = {...a20, sampled_individual_offset_story_days: 1, created_at_floor_version: v26};
  await persistence.saveTimingInstance({chatId: v26.chat_id, ownerFloor: {message_index: 1, swipe_id: 0}, floorVersion: v26, timingInstance: a26});
  assert.deepEqual(fixture.floors.get('1:0').projection_timing_snapshot.items.map(item => item.timing_instance_id), [a26.timing_instance_id, b20.timing_instance_id].sort());
  const afterModify = await persistence.getTimingInstances({chatId: v20.chat_id, endpointFloor: 28});
  assert.equal(afterModify.items.find(item => item.timing_instance_id === a26.timing_instance_id).sampled_individual_offset_story_days, 1);
  assert.ok(afterModify.items.some(item => item.timing_instance_id === b20.timing_instance_id));

  await persistence.removeTimingInstance({chatId: v30.chat_id, ownerFloor: {message_index: 2, swipe_id: 0}, floorVersion: v30, timingInstanceId: b20.timing_instance_id});
  const afterDelete = await persistence.getTimingInstances({chatId: v20.chat_id, endpointFloor: 32});
  assert.deepEqual(afterDelete.items.map(item => item.timing_instance_id), [a26.timing_instance_id]);

  const emptyFixture = historyFixture([
    {index: 0, floor: {...emptyFloor(), floor_version: v20, projection_timing_snapshot: {schema_version: 1, items: [a20, b20]}}},
    {index: 1, floor: {floor_version: v30, projection_timing_snapshot: {schema_version: 1, items: []}}},
  ]);
  const emptyPersistence = createProjectionTimingPersistence({store: emptyFixture.store, resolveCurrentFloorVersion: emptyFixture.resolveCurrentFloorVersion});
  const explicitEmpty = await emptyPersistence.getTimingInstances({chatId: v20.chat_id, endpointFloor: 32});
  assert.deepEqual(explicitEmpty.items, []);
  assert.equal(explicitEmpty.source_index, 1);
});

test('Timing historical candidates require active Swipe and recomputed current Floor Version', async () => {
  const v20 = {...hostFloorVersion, message_id: 20, floor: 20, content_hash: 'hash-20', message_version: 'v1:20'};
  const v26 = {...hostFloorVersion, message_id: 26, floor: 26, content_hash: 'hash-26', message_version: 'v1:26'};
  const timing20 = timingFor(v20, 'exposure-valid');
  const stale = timingFor(v26, 'exposure-stale');
  const fixture = historyFixture([
    {index: 0, floor: {...emptyFloor(), floor_version: v20, projection_timing_snapshot: {schema_version: 1, items: [timing20]}}},
    {index: 1, floor: {...emptyFloor(), floor_version: v26, projection_timing_snapshot: {schema_version: 1, items: [stale]}}},
    {index: 2, swipeId: 0, floor: {...emptyFloor(), floor_version: {...v26, message_id: 30, floor: 30, content_hash: 'hash-30', message_version: 'v1:30'}, projection_timing_snapshot: {schema_version: 1, items: [timingFor(v26, 'exposure-inactive')]}}},
  ], {activeSwipes: {2: 1}});
  fixture.currentVersions.set(1, {...v26, content_hash: 'recomputed-current-hash', message_version: 'v1:current'});
  const persistence = createProjectionTimingPersistence({store: fixture.store, resolveCurrentFloorVersion: fixture.resolveCurrentFloorVersion});
  const result = await persistence.getTimingInstances({chatId: v20.chat_id, endpointFloor: 40});
  assert.deepEqual(result.items.map(item => item.timing_instance_id), [stale.timing_instance_id]);
  assert.equal(result.source_index, 1);
});

test('Timing invalid snapshot roots are skipped instead of becoming explicit empty state', async () => {
  const v20 = {...hostFloorVersion, message_id: 20, floor: 20, content_hash: 'hash-20', message_version: 'v1:20'};
  const v26 = {...hostFloorVersion, message_id: 26, floor: 26, content_hash: 'hash-26', message_version: 'v1:26'};
  const valid = timingFor(v20, 'exposure-valid-root');
  const fixture = historyFixture([
    {index: 0, floor: {...emptyFloor(), floor_version: v20, projection_timing_snapshot: {schema_version: 1, items: [valid]}}},
    {index: 1, floor: {...emptyFloor(), floor_version: v26, projection_timing_snapshot: {schema_version: 1, creations: [valid]}}},
  ]);
  const persistence = createProjectionTimingPersistence({store: fixture.store, resolveCurrentFloorVersion: fixture.resolveCurrentFloorVersion});
  const result = await persistence.getTimingInstances({chatId: hostFloorVersion.chat_id, endpointFloor: 28});
  assert.deepEqual(result.items.map(item => item.timing_instance_id), [valid.timing_instance_id]);
  assert.equal(result.source_index, 0);
});

test('Timing roots containing future-provenance items do not pollute an earlier Floor read', async () => {
  const v20 = {...hostFloorVersion, message_id: 20, floor: 20, content_hash: 'hash-20', message_version: 'v1:20'};
  const v40 = {...hostFloorVersion, message_id: 40, floor: 40, content_hash: 'hash-40', message_version: 'v1:40'};
  const future = timingFor(v40, 'future-item-exposure');
  const fixture = historyFixture([
    {index: 0, floor: {...emptyFloor(), floor_version: v20, projection_timing_snapshot: {schema_version: 1, items: [future]}}},
  ]);
  const persistence = createProjectionTimingPersistence({store: fixture.store, resolveCurrentFloorVersion: fixture.resolveCurrentFloorVersion});
  const result = await persistence.getTimingInstances({chatId: hostFloorVersion.chat_id, endpointFloor: 20});
  assert.deepEqual(result.items, []);
  assert.equal(result.source_index, null);
  await assert.rejects(
    persistence.saveTimingInstance({chatId: v20.chat_id, ownerFloor: {message_index: 0, swipe_id: 0}, floorVersion: v20, timingInstance: future}),
    error => error.code === 'PROJECTION_TIMING_SNAPSHOT_INVALID',
  );
});

test('Timing same-Floor updates preserve siblings when queued from stale pre-queue reads', async () => {
  const v20 = {...hostFloorVersion, message_id: 20, floor: 20, content_hash: 'hash-20', message_version: 'v1:20'};
  const v26 = {...hostFloorVersion, message_id: 26, floor: 26, content_hash: 'hash-26', message_version: 'v1:26'};
  const a20 = timingFor(v20, 'exposure-a');
  const b20 = timingFor(v20, 'exposure-b');
  const fixture = historyFixture([
    {index: 0, floor: {...emptyFloor(), floor_version: v20, projection_timing_snapshot: {schema_version: 1, items: [a20, b20]}}},
    {index: 1, floor: {floor_version: v26}},
  ]);
  const persistence = createProjectionTimingPersistence({store: fixture.store, resolveCurrentFloorVersion: fixture.resolveCurrentFloorVersion});
  const a26 = {...a20, sampled_individual_offset_story_days: 1, created_at_floor_version: v26};
  const b26 = {...b20, sampled_individual_offset_story_days: -1, created_at_floor_version: v26};
  await Promise.all([
    persistence.saveTimingInstance({chatId: v26.chat_id, ownerFloor: {message_index: 1, swipe_id: 0}, floorVersion: v26, timingInstance: a26}),
    persistence.saveTimingInstance({chatId: v26.chat_id, ownerFloor: {message_index: 1, swipe_id: 0}, floorVersion: v26, timingInstance: b26}),
  ]);
  const saved = fixture.floors.get('1:0').projection_timing_snapshot.items;
  assert.equal(saved.length, 2);
  assert.equal(saved.find(item => item.timing_instance_id === a26.timing_instance_id).sampled_individual_offset_story_days, 1);
  assert.equal(saved.find(item => item.timing_instance_id === b26.timing_instance_id).sampled_individual_offset_story_days, -1);
});

test('Timing storage exposes complete snapshot replacement and skips an identical replacement', async () => {
  const v20 = {...hostFloorVersion, message_id: 20, floor: 20, content_hash: 'hash-20', message_version: 'v1:20'};
  const v26 = {...hostFloorVersion, message_id: 26, floor: 26, content_hash: 'hash-26', message_version: 'v1:26'};
  const a20 = timingFor(v20, 'exposure-a');
  const b20 = timingFor(v20, 'exposure-b');
  const fixture = historyFixture([
    {index: 0, floor: {...emptyFloor(), floor_version: v20, projection_timing_snapshot: {schema_version: 1, items: [a20]}}},
    {index: 1, floor: {floor_version: v26}},
  ]);
  const persistence = createProjectionTimingPersistence({store: fixture.store, resolveCurrentFloorVersion: fixture.resolveCurrentFloorVersion});

  const replaced = await persistence.saveTimingSnapshot({
    chatId: v26.chat_id,
    ownerFloor: {message_index: 1, swipe_id: 0},
    floorVersion: v26,
    items: [a20, b20],
  });
  assert.equal(replaced.status, 'replaced');
  assert.deepEqual(fixture.floors.get('1:0').projection_timing_snapshot.items.map(item => item.timing_instance_id), [a20.timing_instance_id, b20.timing_instance_id].sort());

  const deduped = await persistence.saveTimingSnapshot({
    chatId: v26.chat_id,
    ownerFloor: {message_index: 1, swipe_id: 0},
    floorVersion: v26,
    items: [a20, b20],
  });
  assert.equal(deduped.status, 'deduped');
  assert.equal(deduped.noWrite, true);
});

test('Timing snapshot normalization ignores the removed timeline representation', () => {
  const timing = timingFor(hostFloorVersion, 'timeline-only-event');
  const normalized = normalizeProjectionTimingSnapshot({schema_version: 1, creations: [timing], basis_records: []}, {expectedChatId: hostFloorVersion.chat_id});
  assert.deepEqual(normalized.snapshot.items, []);
  assert.equal(normalized.invalid, true);
});

test('timing instance samples once, freezes effective window, and remains stable on reread', () => {
  const first = resolveProjectionTimingInstance({chatId: floorVersion.chat_id, subjectId: 'char_000001', mechanismKey: 'fertilization', firstEvent: event, config, floorVersion, rng: () => 1});
  const second = resolveProjectionTimingInstance({chatId: floorVersion.chat_id, subjectId: 'char_000001', mechanismKey: 'fertilization', firstEvent: event, config, floorVersion, rng: () => 0});
  assert.equal(first.timing_instance_id, second.timing_instance_id);
  assert.equal(first.sampled_individual_offset_story_days, 3);
  assert.equal(second.sampled_individual_offset_story_days, -3);
  assert.equal(first.effective_min_story_days, 12);
  assert.equal(first.effective_max_story_days, 22);
});

test('10-16 Character timing config and variance are frozen into the Timing Instance', () => {
  const config1016 = {
    schema_version: 1,
    config_version: 3,
    base_min_story_days: 10,
    base_max_story_days: 16,
    variance_ratio: 0.1,
    variance_cap_story_days: 2,
    total_adjustment_cap_story_days: 1,
  };
  const timing = resolveProjectionTimingInstance({
    chatId: floorVersion.chat_id,
    subjectId: 'char_000001',
    mechanismKey: 'fertilization',
    firstEvent: event,
    config: config1016,
    floorVersion,
    rng: () => 1,
  });
  assert.equal(timing.base_min_story_days, 10);
  assert.equal(timing.base_max_story_days, 16);
  assert.equal(timing.variance_ratio, 0.1);
  assert.equal(timing.sampled_individual_offset_story_days, 1.3);
  assert.equal(timing.state_modifier_story_days, 0);
  assert.equal(timing.total_adjustment_story_days, 1);
  assert.equal(timing.effective_min_story_days, 11);
  assert.equal(timing.effective_max_story_days, 17);
  assert.equal(timing.config_snapshot.config_version, 3);
});

test('manual Timing Instance edit preserves identity and frozen offset while editing percentage', () => {
  const timing = resolveProjectionTimingInstance({
    chatId: floorVersion.chat_id,
    subjectId: 'char_000001',
    mechanismKey: 'fertilization',
    firstEvent: event,
    config: {
      schema_version: 1,
      config_version: 3,
      base_min_story_days: 10,
      base_max_story_days: 16,
      variance_ratio: 0.1,
      variance_cap_story_days: 2,
      total_adjustment_cap_story_days: 1,
    },
    floorVersion,
    rng: () => 1,
  });
  const edited = editProjectionTimingInstance(timing, {
    baseMinStoryDays: 18,
    baseMaxStoryDays: 20,
    varianceRatio: 0.2,
    varianceCapStoryDays: 4,
    totalAdjustmentCapStoryDays: 0.5,
  });
  assert.equal(edited.timing_instance_id, timing.timing_instance_id);
  assert.equal(edited.cycle_id, timing.cycle_id);
  assert.equal(edited.sampled_individual_offset_story_days, timing.sampled_individual_offset_story_days);
  assert.equal(edited.total_adjustment_story_days, 0.5);
  assert.equal(edited.base_min_story_days, 18);
  assert.equal(edited.base_max_story_days, 20);
  assert.equal(edited.variance_ratio, 0.2);
  assert.equal(edited.variance_cap_story_days, 4);
  assert.equal(edited.total_adjustment_cap_story_days, 0.5);
  assert.equal(edited.total_adjustment_story_days, 0.5);
  assert.equal(edited.effective_min_story_days, 18.5);
  assert.equal(edited.effective_max_story_days, 20.5);
  assert.equal(edited.config_snapshot.base_min_story_days, 18);
  assert.equal(edited.config_snapshot.base_max_story_days, 20);
  const totalCapped = editProjectionTimingInstance(timing, {
    baseMinStoryDays: 16,
    baseMaxStoryDays: 20,
    varianceRatio: 0.2,
    varianceCapStoryDays: 4,
    totalAdjustmentCapStoryDays: 1,
  });
  assert.equal(totalCapped.sampled_individual_offset_story_days, timing.sampled_individual_offset_story_days);
  assert.equal(totalCapped.total_adjustment_story_days, 1);
  assert.equal(totalCapped.effective_min_story_days, 17);
  assert.equal(totalCapped.effective_max_story_days, 21);
  assert.throws(
    () => editProjectionTimingInstance(timing, {baseMinStoryDays: 20, baseMaxStoryDays: 18}),
    /base_max_story_days:before_min/,
  );
  assert.throws(
    () => editProjectionTimingInstance(timing, {
      baseMinStoryDays: 18,
      baseMaxStoryDays: 20,
      varianceRatio: 0,
      varianceCapStoryDays: 0,
      totalAdjustmentCapStoryDays: 1,
    }),
    /sampled_offset:outside_allowed_range/,
  );
});

test('manual Timing Instance edit preserves a zero sampled offset without resampling', () => {
  const timing = resolveProjectionTimingInstance({
    chatId: floorVersion.chat_id,
    subjectId: 'char_000001',
    mechanismKey: 'fertilization',
    firstEvent: event,
    config: {
      schema_version: 1,
      config_version: 1,
      base_min_story_days: 16,
      base_max_story_days: 20,
      variance_ratio: 0.1,
      variance_cap_story_days: 3,
      total_adjustment_cap_story_days: 3,
    },
    floorVersion,
    rng: () => 0.5,
  });
  const edited = editProjectionTimingInstance(timing, {
    baseMinStoryDays: 16,
    baseMaxStoryDays: 20,
    varianceRatio: 0.2,
    varianceCapStoryDays: 5,
    totalAdjustmentCapStoryDays: 4,
  });

  assert.equal(timing.sampled_individual_offset_story_days, 0);
  assert.equal(edited.sampled_individual_offset_story_days, 0);
  assert.equal(edited.variance_ratio, 0.2);
  assert.equal(edited.variance_cap_story_days, 5);
  assert.equal(edited.total_adjustment_cap_story_days, 4);
  assert.equal(edited.effective_min_story_days, 16);
  assert.equal(edited.effective_max_story_days, 20);
  assert.equal(edited.timing_instance_id, timing.timing_instance_id);
  assert.equal(edited.cycle_id, timing.cycle_id);
});

test('timing cycles remain distinct for different first Exposure events', () => {
  const first = resolveProjectionTimingInstance({
    chatId: floorVersion.chat_id,
    subjectId: 'char_000001',
    mechanismKey: 'fertilization',
    firstEvent: event,
    config,
    floorVersion,
    rng: () => 0.5,
  });
  const next = resolveProjectionTimingInstance({
    chatId: floorVersion.chat_id,
    subjectId: 'char_000001',
    mechanismKey: 'fertilization',
    firstEvent: {...event, event_id: 'event-2'},
    config,
    floorVersion,
    rng: () => 0.5,
  });
  assert.notEqual(first.cycle_id, next.cycle_id);
  assert.notEqual(first.timing_instance_id, next.timing_instance_id);
});

test('canonical Cycle ID treats missing and explicit null day_index identically', () => {
  const missingDayIndex = {
    ...event,
    story_time: {
      display: '第三日',
      normalized: null,
      precision: 'unknown',
      confidence: 0.6,
    },
  };
  const explicitNullDayIndex = {
    ...missingDayIndex,
    story_time: {...missingDayIndex.story_time, day_index: null},
  };
  const canonicalMissing = buildProjectionTimingCycleId({
    chatId: floorVersion.chat_id,
    subjectId: 'char_000001',
    mechanismKey: 'fertilization',
    firstEvent: missingDayIndex,
  });
  const canonicalNull = buildProjectionTimingCycleId({
    chatId: floorVersion.chat_id,
    subjectId: 'char_000001',
    mechanismKey: 'fertilization',
    firstEvent: explicitNullDayIndex,
  });
  assert.equal(canonicalMissing, canonicalNull);
});

test('one Timing snapshot item keeps both same-cycle Exposure basis records', () => {
  const timing = resolveProjectionTimingInstance({chatId: floorVersion.chat_id, subjectId: 'char_000001', mechanismKey: 'fertilization', firstEvent: event, config, floorVersion, rng: () => 0.5});
  let snapshot = upsertProjectionTimingInstance(timing, {snapshot: emptyProjectionTimingSnapshot(), expectedChatId: floorVersion.chat_id}).snapshot;
  snapshot = upsertProjectionTimingInstance({
    ...snapshot.items[0],
    source_event_ids: [...snapshot.items[0].source_event_ids, 'event-2'],
    source_basis_refs: {...snapshot.items[0].source_basis_refs, 'event-2': {event_id: 'event-2', story_time: event.story_time}},
  }, {snapshot, expectedChatId: floorVersion.chat_id}).snapshot;
  snapshot = upsertProjectionTimingInstance({
    ...snapshot.items[0],
    source_event_ids: [...snapshot.items[0].source_event_ids, 'event-3'],
    source_basis_refs: {...snapshot.items[0].source_basis_refs, 'event-3': {event_id: 'event-3', story_time: event.story_time}},
  }, {snapshot, expectedChatId: floorVersion.chat_id}).snapshot;
  assert.equal(snapshot.items.length, 1);
  assert.deepEqual(snapshot.items[0].source_event_ids, ['event-1', 'event-2', 'event-3']);
  assert.deepEqual(Object.keys(snapshot.items[0].source_basis_refs).sort(), ['event-1', 'event-2', 'event-3']);
});

test('timing window is before-min, inclusive-open at min/max, and missed after max', () => {
  const timing = resolveProjectionTimingInstance({chatId: floorVersion.chat_id, subjectId: 'char_000001', mechanismKey: 'fertilization', firstEvent: event, config, floorVersion, rng: () => 0.5});
  assert.equal(evaluateProjectionTiming({timingInstance: timing, currentStoryTime: {day_index: 109}, events: [event], subjectId: 'char_000001'}).status, 'before_min');
  assert.equal(evaluateProjectionTiming({timingInstance: timing, currentStoryTime: {day_index: 110}, events: [event], subjectId: 'char_000001'}).eligible, 'eligible');
  assert.equal(evaluateProjectionTiming({timingInstance: timing, currentStoryTime: {day_index: 120}, events: [event], subjectId: 'char_000001'}).eligible, 'eligible');
  assert.equal(evaluateProjectionTiming({timingInstance: timing, currentStoryTime: {day_index: 121}, events: [event], subjectId: 'char_000001'}).status, 'window_missed');
});

test('Projection Timing elapsed uses unified Story Time for display-only Gregorian dates', () => {
  const displayEvent = {...event, story_time: {display: '2026-01-01'}};
  const displayConfig = {...config, base_min_story_days: 90, base_max_story_days: 100, variance_ratio: 0, variance_cap_story_days: 0, total_adjustment_cap_story_days: 0};
  const timing = resolveProjectionTimingInstance({chatId: floorVersion.chat_id, subjectId: 'char_000001', mechanismKey: 'fertilization', firstEvent: displayEvent, config: displayConfig, floorVersion, rng: () => 0.5});
  const result = evaluateProjectionTiming({timingInstance: timing, currentStoryTime: {display: '2026-04-01'}, events: [displayEvent], subjectId: 'char_000001'});
  assert.equal(result.status, 'window_open');
  assert.equal(Object.hasOwn(result, 'elapsed_story_days'), false);
});

test('Projection eligibility composes World Rule eligibility with timing eligibility', () => {
  const content = {schema_version: 1, mechanism_key: 'fertilization', development_concern_key: 'detection', development_kind: 'possible_detection', trigger: {kind: 'immediate_after_event', source_event_type: 'sexual_activity'}, requirements: {capabilities: [], source_compatibility: 'not_required', contributor_relationships: []}, realization: null, contradiction: null, expiration: null};
  const rule = {...content, projection_rule_id: buildProjectionRuleId(content)};
  const timing = resolveProjectionTimingInstance({chatId: floorVersion.chat_id, subjectId: 'char_000001', mechanismKey: 'fertilization', firstEvent: event, config, floorVersion, rng: () => 0.5});
  const result = evaluateProjectionEligibility({events: [event], currentState: {characters: {'char_000001': {reproductive_capabilities: {}}}}, worldModel: {projection_rules: [rule]}, currentStoryTime: {day_index: 109}, preConfirmationTiming: {enabled: true, instances: [timing], windows: [{tracking_window_id: 'window-projection-timing', subject_id: 'char_000001', mechanism_key: 'fertilization', status: 'open', source_event_ids: [event.event_id]}]}});
  assert.equal(result.decisions[0].eligibility, 'not_eligible');
  assert.equal(result.decisions[0].reason_code, 'before_min');
});

test('Projection eligibility fails closed when enabled timing has no valid Tracking Window', () => {
  const content = {schema_version: 1, mechanism_key: 'fertilization', development_concern_key: 'detection', development_kind: 'possible_detection', trigger: {kind: 'immediate_after_event', source_event_type: 'sexual_activity'}, requirements: {capabilities: [], source_compatibility: 'not_required', contributor_relationships: []}, realization: null, contradiction: null, expiration: null};
  const rule = {...content, projection_rule_id: buildProjectionRuleId(content)};
  const timing = resolveProjectionTimingInstance({chatId: floorVersion.chat_id, subjectId: 'char_000001', mechanismKey: 'fertilization', firstEvent: event, config, floorVersion, rng: () => 0.5});
  const result = evaluateProjectionEligibility({events: [event], currentState: {characters: {'char_000001': {reproductive_capabilities: {}}}}, worldModel: {projection_rules: [rule]}, currentStoryTime: {day_index: 110}, preConfirmationTiming: {enabled: true, instances: [timing]}});
  assert.equal(result.decisions[0].eligibility, 'not_eligible');
  assert.equal(result.decisions[0].reason_code, 'tracking_window_not_open');
});
