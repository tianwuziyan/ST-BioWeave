import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../ui/app.js';
import {
  buildRenderedWorldLayerSnapshot,
  buildWorldModelLayerSnapshot,
  compareWorldModelLayers,
  diffWorldModelAddresses,
  fingerprintWorldModel,
  stableWorldModelStringify,
} from '../utils/world-model-debug.js';

const modelR1 = {
  schema_version: 1,
  species: [{name: 'Species-A', biological_types: [{name: 'Type-A', capabilities: {can_produce_ova: false}}]}],
};
const modelR2 = {
  schema_version: 1,
  species: [
    {name: 'Species-A', biological_types: [{name: 'Type-A', capabilities: {can_produce_ova: false}, description: 'stable'}]},
    {name: 'Species-B', biological_types: [{name: 'Type-C'}]},
  ],
};

function runtimeFixture({runtimeModel = modelR1, floorModel = modelR1, targetSequence = []} = {}) {
  let targetIndex = 0;
  const target = () => targetSequence[targetIndex++] ?? {version: {chat_id: 'chat-a', message_id: 1, floor: 1, swipe_id: 0, content_hash: 'hash-a', message_version: 'v1'}};
  let diagnostic = {
    execution_id: 'exec-r1',
    runtime_model: runtimeModel,
    fact_delta_summary: {
      raw_fact_block_count: 1,
      parsed_fact_count: 1,
      parse_rejected_fact_count: 0,
      resolution_rejected_fact_count: 0,
      evidence_guard_rejected_fact_count: 0,
      accepted_fact_count: 1,
      accepted_operation_count: 1,
      fact_count: 1,
    },
  };
  const calls = {save: 0, commit: 0, storeSave: 0};
  const runtime = {
    chat: {current: () => 'chat-a'},
    resolveCurrentBioWeaveFloor: async () => target(),
    resolveWorldModelAtOrBefore: async () => ({model: diagnostic.floorModel ?? floorModel, meta: {present: true}, floor_version: targetSequence[0]?.version ?? target().version}),
    getWorldModelDiagnosticState: () => diagnostic,
    getPersistenceTrace: () => ({sequence: []}),
    saveWorldModel: async () => { calls.save += 1 },
    commitFloorPatch: async () => { calls.commit += 1 },
    store: {saveFloor: async () => { calls.storeSave += 1 }},
  };
  return {runtime, calls, setDiagnostic(next) { diagnostic = {...diagnostic, ...next} }};
}

test('fingerprint is deterministic, preserves array order, and distinguishes false from missing', async () => {
  const left = await fingerprintWorldModel({b: 2, a: {flag: false, list: ['Type-A', 'Type-B']}});
  const right = await fingerprintWorldModel({a: {list: ['Type-A', 'Type-B'], flag: false}, b: 2});
  const reordered = await fingerprintWorldModel({a: {list: ['Type-B', 'Type-A'], flag: false}, b: 2});
  const missing = await fingerprintWorldModel({a: {list: ['Type-A', 'Type-B']}, b: 2});
  assert.equal(left.full_hash, right.full_hash);
  assert.notEqual(left.full_hash, reordered.full_hash);
  assert.notEqual(left.full_hash, missing.full_hash);
  assert.equal((await fingerprintWorldModel(null)).status, 'null');
  assert.equal(stableWorldModelStringify({b: 1, a: 2}), '{"a":2,"b":1}');
});

test('cross-layer comparison and dynamic address diff identify Floor newer than UI and stale render', async () => {
  const runtime = await buildWorldModelLayerSnapshot({model: modelR2, source: 'runtime'});
  const floor = await buildWorldModelLayerSnapshot({model: modelR2, source: 'floor'});
  const ui = await buildWorldModelLayerSnapshot({model: modelR1, source: 'ui'});
  const render = await buildRenderedWorldLayerSnapshot({canonicalSerialized: stableWorldModelStringify(modelR1), viewModelSerialized: stableWorldModelStringify(modelR1), addresses: ['Species-A', 'Species-A / Type-A'], counts: {species_count: 1, biological_type_count: 1}});
  const layers = {runtime, floor, ui, last_render: render};
  assert.equal(compareWorldModelLayers(layers).world_consistency.runtime_vs_floor, 'MATCH');
  assert.equal(compareWorldModelLayers(layers).world_consistency.floor_vs_ui, 'MISMATCH');
  assert.equal(compareWorldModelLayers(layers).world_consistency.ui_vs_last_render, 'MATCH');
  assert.deepEqual(diffWorldModelAddresses(layers).floor_not_in_ui, ['Species-B', 'Species-B / Type-C']);
});

test('UI updated but last render stale is distinguishable from synchronized UI', async () => {
  const floor = await buildWorldModelLayerSnapshot({model: modelR2, source: 'floor'});
  const ui = await buildWorldModelLayerSnapshot({model: modelR2, source: 'ui'});
  const render = await buildRenderedWorldLayerSnapshot({canonicalSerialized: stableWorldModelStringify(modelR1), viewModelSerialized: stableWorldModelStringify(modelR1), addresses: ['Species-A', 'Species-A / Type-A'], counts: {species_count: 1, biological_type_count: 1}});
  assert.equal(compareWorldModelLayers({runtime: floor, floor, ui, last_render: render}).world_consistency.floor_vs_ui, 'MATCH');
  assert.equal(compareWorldModelLayers({runtime: floor, floor, ui, last_render: render}).world_consistency.ui_vs_last_render, 'MISMATCH');
});

test('all four layers report MATCH when they consume the same canonical content', async () => {
  const runtime = await buildWorldModelLayerSnapshot({model: modelR2, source: 'runtime'});
  const floor = await buildWorldModelLayerSnapshot({model: modelR2, source: 'floor'});
  const ui = await buildWorldModelLayerSnapshot({model: modelR2, source: 'ui'});
  const render = await buildRenderedWorldLayerSnapshot({canonicalSerialized: stableWorldModelStringify(modelR2), viewModelSerialized: stableWorldModelStringify(modelR2), addresses: ui.addresses, counts: {species_count: 2, biological_type_count: 2}});
  assert.deepEqual(compareWorldModelLayers({runtime, floor, ui, last_render: render}).world_consistency, {
    runtime_vs_floor: 'MATCH',
    floor_vs_ui: 'MATCH',
    ui_vs_last_render: 'MATCH',
    runtime_vs_ui: 'MATCH',
  });
});

test('collectWorldModelLiveState samples the current Runtime and remains read only', async () => {
  const fixture = runtimeFixture({runtimeModel: modelR1});
  const app = createApp(fixture.runtime, {documentRef: {}, storageRef: {}});
  const first = await app.collectWorldModelLiveState();
  fixture.setDiagnostic({
    execution_id: 'exec-r2',
    runtime_model: modelR2,
    fact_delta_summary: {
      raw_fact_block_count: 1,
      parsed_fact_count: 1,
      accepted_fact_count: 1,
      accepted_operation_count: 1,
      fact_count: 2,
    },
  });
  const second = await app.collectWorldModelLiveState();
  assert.notEqual(first.layers.runtime.full_hash, second.layers.runtime.full_hash);
  assert.equal(second.active_world_execution_id, 'exec-r2');
  assert.equal(second.latest_fact_delta.raw_fact_block_count, 1);
  assert.equal(second.latest_fact_delta.parsed_fact_count, 1);
  assert.equal(second.latest_fact_delta.accepted_operation_count, 1);
  assert.equal(fixture.calls.save, 0);
  assert.equal(fixture.calls.commit, 0);
  assert.equal(fixture.calls.storeSave, 0);
});

test('authoritative Floor read failure is reported without failing the live snapshot', async () => {
  const fixture = runtimeFixture();
  fixture.runtime.resolveWorldModelAtOrBefore = async () => { throw Object.assign(new Error('FLOOR_READ_BROKE'), {code: 'FLOOR_READ_BROKE'}) };
  const app = createApp(fixture.runtime, {documentRef: {}, storageRef: {}});
  const snapshot = await app.collectWorldModelLiveState();
  assert.equal(snapshot.layers.floor.floor_read_status, 'failed');
  assert.equal(snapshot.layers.floor.floor_read_error_code, 'FLOOR_READ_BROKE');
  assert.equal(snapshot.snapshot_consistent, true);
});

test('target change during async collection invalidates the snapshot instead of claiming a match', async () => {
  const versions = [
    {chat_id: 'chat-a', message_id: 1, floor: 1, swipe_id: 0, content_hash: 'hash-a', message_version: 'v1'},
    {chat_id: 'chat-a', message_id: 2, floor: 2, swipe_id: 0, content_hash: 'hash-b', message_version: 'v2'},
    {chat_id: 'chat-a', message_id: 3, floor: 3, swipe_id: 0, content_hash: 'hash-c', message_version: 'v3'},
    {chat_id: 'chat-a', message_id: 4, floor: 4, swipe_id: 0, content_hash: 'hash-d', message_version: 'v4'},
  ];
  const fixture = runtimeFixture({targetSequence: versions.map(version => ({version}))});
  const app = createApp(fixture.runtime, {documentRef: {}, storageRef: {}});
  const snapshot = await app.collectWorldModelLiveState();
  assert.equal(snapshot.snapshot_consistent, false);
  assert.equal(snapshot.snapshot_invalidation_reason, 'active_target_changed_during_collection');
  assert.equal(snapshot.world_consistency.floor_vs_ui, 'UNAVAILABLE');
});

test.skip('removed debug Popup output separated LIVE STATE from HISTORY TRACE', () => {
  const markup = renderAnalysisDebugPopupContent({
    worldModelLiveState: {
      snapshot_generated_at: 'now',
      world_consistency: {floor_vs_ui: 'MISMATCH'},
      latest_fact_delta: {
        raw_fact_block_count: 4,
        parsed_fact_count: 1,
        parse_rejected_fact_count: 3,
        resolution_rejected_fact_count: 0,
        evidence_guard_rejected_fact_count: 1,
        accepted_fact_count: 0,
        accepted_operation_count: 0,
        identity_review_completed_count: 4,
        identity_review_count: 4,
        coverage_disposition_count: 23,
        coverage_target_count: 23,
        supplement_completeness_complete: true,
        world_model_debug_schema_version: 3,
        first_failed_stage: 'FACT_RESOLUTION',
        type_identity_decisions: [{species: 'Species-A', biological_type: 'Type-B', identity_support_classification: 'LEGITIMATELY_UNSUPPORTED'}],
        fact_delta_result: 'ALL_FACTS_REJECTED',
      },
      active_world_execution_id: 'exec-last',
      current_execution_candidate_id: null,
      candidate_belongs_to_previous_execution: true,
      execution_result: 'ALL_FACTS_REJECTED',
      candidate_state: null,
      request_transitions: [{previous_execution_id: 'exec-previous', current_execution_id: 'exec-last', existing_reference: 'CHANGED'}],
      latest_nonempty_fact_delta: {
        execution_id: 'exec-nonempty',
        summary: {
          raw_fact_block_count: 2,
          parsed_fact_count: 2,
          evidence_guard_rejected_fact_count: 2,
          accepted_fact_count: 0,
        },
      },
    },
    persistenceTrace: {sequence: [{stage: 'WORLD_UI_RENDERED'}]},
    documentRef: null,
  });
  assert.match(markup, /WORLD MODEL LIVE STATE/u);
  assert.match(markup, /WORLD MODEL LAST EXECUTION/u);
  assert.match(markup, /ALL_FACTS_REJECTED/u);
  assert.match(markup, /WORLD MODEL REQUEST TRANSITION/u);
  assert.match(markup, /TYPE IDENTITY DECISIONS/u);
  assert.match(markup, /FACT_RESOLUTION/u);
  assert.match(markup, /Candidate Belongs to Previous Execution/u);
  assert.match(markup, /Execution Result/u);
  assert.match(markup, /Fact Delta Result/u);
  assert.match(markup, /Fact Delta Analysis Result/u);
  assert.match(markup, /Derived Target Accounting/u);
  assert.match(markup, /Persistence Confirmed/u);
  assert.match(markup, /WORLD_UI_RENDERED/u);
  assert.match(markup, /data-bioweave-world-model-live-state/u);
  assert.match(markup, /Raw Fact Blocks/u);
  assert.match(markup, />4<\/dd>/u);
  assert.match(markup, /Evidence Guard Rejected/u);
  assert.match(markup, /Identity Reviews/u);
  assert.match(markup, />4 \/ 4<\/dd>/u);
  assert.match(markup, /Coverage Dispositions/u);
  assert.match(markup, /Latest Non-empty Fact Delta/u);
  assert.match(markup, /exec-nonempty/u);
  assert.doesNotMatch(markup, /"fact_count"/u);
});

test.skip('removed Advanced Debug Popup marked an unknown World Model diagnostics schema', () => {
  const markup = renderAnalysisDebugPopupContent({
    worldModelLiveState: {latest_fact_delta: {world_model_debug_schema_version: 99}},
    documentRef: null,
  });
  assert.match(markup, /DEBUG_SCHEMA_MISMATCH/u);
});
