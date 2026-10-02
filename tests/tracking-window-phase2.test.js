import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveTrackingWindows,
  evaluateTrackingWindowHorizon,
  evaluateTrackingWindowLifecycles,
  resolveTrackingWindowHorizon,
} from '../core/tracking-window.js';
import {createProjection} from '../core/projection.js';
import {createProjectionRuntime} from '../runtime/projection-runtime.js';
import {createTrackingWindowRuntime} from '../runtime/tracking-window-runtime.js';
import {classifyWorldModelPatchV2, normalizeWorldModel, validateWorldModelPatchV2} from '../ai/analyzer.js';

const version = {chat_id: 'phase2-chat', message_id: 'm-1', floor: 1, swipe_id: 0, content_hash: 'h-1', message_version: 'v1'};
const exposure = {event_id: 'exposure-1', type: 'sexual_activity', status: 'confirmed', story_time: {day_index: 1}, source: version, participants: [{character_id: 'subject', event_role: 'potential_gestational_subject', biological_context: {species: 'Human', biological_type: 'female'}, reproductive_capabilities_used: {can_carry_pregnancy: true}}, {character_id: 'source', event_role: 'potential_conception_source', reproductive_capabilities_used: {can_cause_pregnancy: true}}], pregnancy_relevance: {relevant: true, possible_conception: true, gestational_subject_ids: ['subject'], counterpart_ids: ['source'], reproductive_mechanism: {kind: 'fertilization'}}, source_evidence: [{kind: 'pregnancy_relevant_exposure', text: 'factual exposure'}]};
const world = {species: [{name: 'Human', biological_types: [{name: 'female', reproductive_mechanisms: [{key: 'fertilization', tracking_window_horizon: {schema_version: 1, max_story_days: 7}}]}]}]};

test('World horizon resolves only through exact subject type and mechanism', () => {
  assert.deepEqual(resolveTrackingWindowHorizon({worldModel: world, subjectProfile: {species: 'Human', biological_type: 'female'}, mechanismKey: 'fertilization'}), {schema_version: 1, max_story_days: 7});
  assert.equal(resolveTrackingWindowHorizon({worldModel: world, subjectProfile: {species: 'Human'}, mechanismKey: 'fertilization'}), null);
  assert.equal(resolveTrackingWindowHorizon({worldModel: {}, subjectProfile: {species: 'Human', biological_type: 'female'}, mechanismKey: 'fertilization'}), null);
});

test('World Patch v2 can evidence-bind a mechanism horizon correction', () => {
  const existing = normalizeWorldModel({schema_version: 1, species: [{name: 'Human', biological_types: [{name: 'female', capabilities: {}, reproduction_rules: {}, lifecycle: {}, reproductive_mechanisms: [{key: 'fertilization'}], special_rules: []}]}], exceptions: [], unknowns: [], projection_rules: []});
  const patch = {schema_version: 2, operations: [{op: 'SET_MECHANISM_HORIZON', target: {kind: 'biological_type', species_name: 'Human', type_name: 'female'}, mechanism_key: 'fertilization', tracking_window_horizon: {schema_version: 1, max_story_days: 42}}]};
  assert.equal(validateWorldModelPatchV2(patch).operations.length, 1);
  assert.equal(classifyWorldModelPatchV2(patch, existing)[0].classification, 'CHANGE');
});

test('open Window expires at authoritative horizon and terminal states never reopen', () => {
  const window = deriveTrackingWindows([exposure], {chatId: version.chat_id})[0];
  const expired = evaluateTrackingWindowHorizon(window, {worldModel: world, subjectProfile: {species: 'Human', biological_type: 'female'}, currentStoryTime: {day_index: 8}, floorVersion: version});
  assert.equal(expired.status, 'expired');
  assert.equal(expired.terminal_event_id, null);
  assert.equal(evaluateTrackingWindowHorizon(expired, {worldModel: {...world, species: []}, subjectProfile: {species: 'Human', biological_type: 'female'}, currentStoryTime: {day_index: 100}}).status, 'expired');
  assert.equal(evaluateTrackingWindowHorizon({...window, status: 'resolved_pregnant', terminal_event_id: 'confirmation', terminal_reason: 'pregnancy_confirmation'}, {worldModel: world, subjectProfile: {species: 'Human', biological_type: 'female'}, currentStoryTime: {day_index: 100}}).status, 'resolved_pregnant');
});

test('future independent exposure creates a new Window after expiration', () => {
  const runtime = createTrackingWindowRuntime();
  const expired = evaluateTrackingWindowHorizon(deriveTrackingWindows([exposure], {chatId: version.chat_id})[0], {worldModel: world, subjectProfile: {species: 'Human', biological_type: 'female'}, currentStoryTime: {day_index: 8}, floorVersion: version});
  const future = {...exposure, event_id: 'exposure-2', story_time: {day_index: 20}, source: {...version, message_id: 'm-20', floor: 20, content_hash: 'h-20', message_version: 'v20'}};
  const windows = runtime.buildTrackingWindows({activeEvents: [exposure, future], chatId: version.chat_id, worldModel: world, currentStoryTime: {day_index: 20}, subjectProfiles: {subject: {species: 'Human', biological_type: 'female'}}, persistedWindows: [expired]});
  assert.equal(windows.filter(window => window.status === 'expired').length, 1);
  assert.equal(windows.filter(window => window.status === 'open').length, 1);
  assert.notEqual(windows.find(window => window.status === 'open').tracking_window_id, expired.tracking_window_id);
});

test('unresolved Story Time and missing horizon fail closed', () => {
  const window = deriveTrackingWindows([exposure], {chatId: version.chat_id})[0];
  assert.equal(evaluateTrackingWindowLifecycles([window], {worldModel: world, subjectProfiles: {subject: {species: 'Human', biological_type: 'female'}}, currentStoryTime: {display: 'unknown'}})[0].status, 'open');
  assert.equal(evaluateTrackingWindowLifecycles([window], {worldModel: {}, subjectProfiles: {subject: {species: 'Human', biological_type: 'female'}}, currentStoryTime: {day_index: 100}})[0].status, 'open');
});

test('lifecycle-only Projection bridge expires bound pre-confirmation Projection without AI', async () => {
  const expiredWindow = deriveTrackingWindows([exposure], {chatId: version.chat_id})[0];
  const projection = createProjection({subject_id: 'subject', projection_rule_id: 'rule-1', development_concern_key: 'concern', mechanism: {key: 'fertilization', world_model_rule_refs: []}, source_event_ids: ['exposure-1'], development: {kind: 'monitoring_signal', current_basis: {event_ids: ['exposure-1'], state_refs: ['state:subject'], mechanism_rule_refs: []}, next_signal: 'signal'}, timing: {trigger_kind: 'immediate_after_event', reference_event_id: 'exposure-1', reference_story_time: {day_index: 1}, current_story_time: {day_index: 1}, elapsed_story_days: 0}, created_at_floor_version: version, evidence_refs: ['event:exposure-1'], tracking_scope: 'pre_confirmation', tracking_window_id: expiredWindow.tracking_window_id});
  const decisions = [];
  let refreshes = 0;
  const runtime = createProjectionRuntime({
    analyzer: {generateProjection: async () => { throw new Error('AI_MUST_NOT_RUN'); }},
    collectInputs: async () => ({floor: {version}, currentState: {}, currentStateStatus: 'ready', events: [], sourceCandidates: [], trackingWindows: [{...expiredWindow, status: 'expired', terminal_reason: 'tracking_window_horizon_reached'}], worldModel: {projection_rules: []}, currentStoryTime: {day_index: 8}}),
    resolveCurrentFloor: async () => ({version}),
    getProjectionViews: async () => ({all: [{...projection, factual_status: 'active', deleted: false}]}),
    saveGeneratedProjection: async () => { throw new Error('GENERATION_MUST_NOT_RUN'); },
    saveEvolutionDecision: async value => decisions.push(value),
    refreshProjectionContext: async () => { refreshes += 1; },
  });
  const result = await runtime.tickLifecycleOnly();
  assert.equal(result.expired_projections, 1);
  assert.equal(decisions[0].decision, 'expired');
  assert.equal(refreshes, 1);
});
