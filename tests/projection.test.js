import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROJECTION_DEVELOPMENT_KINDS, buildProjectionId, createProjection, createProjectionEvidenceRecord,
  createProjectionLifecycleRecord, dedupeProjectionEvidenceRecords, dedupeProjectionLifecycleRecords,
  dedupeProjections, isProjectionEligible, resolveProjectionView, validateProjection,
} from '../core/projection.js';

function version(floor, chat_id = 'chat-a') { return {chat_id, message_id: `message-${floor}`, floor, swipe_id: 0, content_hash: `hash-${floor}`, message_version: `v${floor}`}; }
function storyDay(day, calendar_id = 'main') { return {display: `Day ${day}`, normalized: `day-${day}`, day_index: day, calendar_id, precision: 'day'}; }
function input(overrides = {}) { return {owner_type: 'character', subject_id: 'char_000001', projection_rule_id: 'rule:development-v1', development_concern_key: 'concern:change', mechanism: {key: 'alien-reproduction', world_model_rule_refs: ['wm:rule']}, source_event_ids: ['event-1', 'event-2'], development: {kind: 'possible_biological_change', current_basis: {event_ids: ['event-1'], state_refs: ['state:char_000001'], mechanism_rule_refs: ['wm:rule']}, next_signal: 'A possible biological change may become observable.'}, timing: {trigger_kind: 'elapsed_after_event', reference_event_id: 'event-1', reference_story_time: storyDay(0), current_story_time: storyDay(20), elapsed_story_days: 20}, created_at_floor_version: version(10), evidence_refs: ['event:event-1'], ...overrides}; }
function make(overrides = {}) { return createProjection(input(overrides)); }
function entry(floor, projections, lifecycle_records = [], evidence_records = []) { return {owner_type: 'character', floor_version: version(floor), projections, lifecycle_records, evidence_records}; }

test('development kinds remain world-independent and bounded', () => assert.deepEqual(PROJECTION_DEVELOPMENT_KINDS, ['possible_biological_change', 'possible_detection', 'mechanism_progression', 'no_obvious_change', 'monitoring_signal']));
test('projection identity uses rule and concern, not source evidence', () => {
  const first = make();
  assert.equal(first.projection_id, buildProjectionId(first));
  assert.equal(first.projection_id, make({source_event_ids: ['event-3']}).projection_id);
  assert.notEqual(first.projection_id, make({projection_rule_id: 'rule:development-v2'}).projection_id);
  assert.notEqual(first.projection_id, make({development_concern_key: 'concern:detection'}).projection_id);
});
test('exact duplicates dedupe and conflicts fail closed', () => {
  const first = make();
  const duplicate = dedupeProjections([first, structuredClone(first)]);
  assert.equal(duplicate.projections.length, 1);
  const conflict = dedupeProjections([first, {...first, development_concern_key: 'concern:other'}]);
  assert.equal(conflict.conflicts[0].code, 'projection_id_conflict');
});
test('validation rejects User owner, missing identity, factual outcome and State/Snapshot payloads', () => {
  const value = make();
  const result = validateProjection({...value, owner_type: 'user', projection_rule_id: null, development_concern_key: null, outcome: 'pregnancy', snapshot: {}});
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('not_character')));
  assert.ok(result.errors.some(error => error.includes('projection_rule_id:required')));
  assert.ok(result.errors.some(error => error.includes('outcome:forbidden_field')));
});
test('evidence evolution is append-only and current view aggregates surviving records', () => {
  const projection = make();
  const evidence = createProjectionEvidenceRecord({projection_id: projection.projection_id, source_event_ids: ['event-4'], created_at_floor_version: version(15), evidence_refs: ['event:event-4']});
  const original = structuredClone(projection);
  const view = resolveProjectionView({timeline: [entry(10, [projection]), entry(15, [], [], [evidence])]});
  assert.deepEqual(projection, original);
  assert.deepEqual(view.all[0].source_event_ids, ['event-1', 'event-2', 'event-4']);
  const rolledBack = resolveProjectionView({timeline: [entry(10, [projection]) ]});
  assert.deepEqual(rolledBack.all[0].source_event_ids, ['event-1', 'event-2']);
});
test('lifecycle separates factual status from deletion and preserves chronology from timeline order', () => {
  const projection = make();
  const realized = createProjectionLifecycleRecord({projection_id: projection.projection_id, record_kind: 'factual', action: 'realized', created_at_floor_version: version(15), evidence_refs: ['event:e3']});
  const deleted = createProjectionLifecycleRecord({projection_id: projection.projection_id, record_kind: 'deletion', action: 'deleted', created_at_floor_version: version(20), evidence_refs: ['user:delete']});
  const view = resolveProjectionView({timeline: [entry(10, [projection]), entry(15, [], [realized]), entry(20, [], [deleted])]});
  assert.equal(view.all[0].factual_status, 'realized');
  assert.equal(view.all[0].deleted, true);
  assert.equal(view.all[0].context_visible, false);
  assert.equal(view.realized.length, 1);
  assert.equal(view.deleted.length, 1);
  const restored = resolveProjectionView({timeline: [entry(10, [projection]), entry(15, [], [realized])]});
  assert.equal(restored.all[0].factual_status, 'realized');
});
test('same timeline position factual conflict is not resolved by arbitrary precedence', () => {
  const projection = make();
  const realized = createProjectionLifecycleRecord({projection_id: projection.projection_id, action: 'realized', created_at_floor_version: version(15), evidence_refs: ['event:r']});
  const contradicted = createProjectionLifecycleRecord({projection_id: projection.projection_id, action: 'contradicted', created_at_floor_version: version(15), evidence_refs: ['event:c']});
  const first = resolveProjectionView({timeline: [entry(10, [projection]), entry(15, [], [realized, contradicted])]});
  const second = resolveProjectionView({timeline: [entry(10, [projection]), entry(15, [], [contradicted, realized])]});
  assert.equal(first.all[0].factual_status, null);
  assert.equal(second.all[0].factual_status, null);
  assert.equal(first.conflicts.some(item => item.code === 'factual_lifecycle_conflict'), true);
});
test('lifecycle and evidence validation reject unknown projections and non-character owners', () => {
  const record = createProjectionLifecycleRecord({projection_id: 'projection_unknown', action: 'deleted', created_at_floor_version: version(20), evidence_refs: ['user:delete']});
  assert.equal(dedupeProjectionLifecycleRecords([{...record, owner_type: 'user'}], {knownProjectionIds: new Set()}).rejected.length, 1);
  const evidence = createProjectionEvidenceRecord({projection_id: 'projection_unknown', source_event_ids: ['e4'], created_at_floor_version: version(20), evidence_refs: []});
  assert.equal(dedupeProjectionEvidenceRecords([evidence], {knownProjectionIds: new Set()}).rejected.length, 1);
});
test('lifecycle exact duplicate dedupes and same id payload conflict fails closed', () => {
  const projection = make();
  const record = createProjectionLifecycleRecord({projection_id: projection.projection_id, action: 'realized', created_at_floor_version: version(15), evidence_refs: ['event:r']});
  const duplicate = dedupeProjectionLifecycleRecords([record, structuredClone(record)], {knownProjectionIds: new Set([projection.projection_id])});
  assert.equal(duplicate.records.length, 1);
  const conflict = dedupeProjectionLifecycleRecords([{...record, evidence_refs: ['event:other']}], {knownProjectionIds: new Set([projection.projection_id])});
  assert.equal(conflict.rejected.length, 1);
  const forcedConflict = dedupeProjectionLifecycleRecords([record, {...record, evidence_refs: ['event:other'], lifecycle_id: record.lifecycle_id}], {knownProjectionIds: new Set([projection.projection_id])});
  assert.equal(forcedConflict.conflicts[0].code, 'lifecycle_id_conflict');
});
test('trigger only answers eligibility and Story Time incomparability remains unresolved', () => {
  const trigger = {schema_version: 1, kind: 'elapsed_after_event', reference_event_id: 'event-1', min_elapsed_story_days: 20, development_kind: 'possible_biological_change'};
  const event = {event_id: 'event-1', type: 'sexual_activity', story_time: storyDay(0)};
  assert.equal(isProjectionEligible({trigger, referenceEvent: event, currentStoryTime: storyDay(20)}).eligible, true);
  assert.equal(isProjectionEligible({trigger, referenceEvent: event, currentStoryTime: storyDay(20, 'other')}).status, 'unresolved');
  assert.equal('event' in isProjectionEligible({trigger, referenceEvent: event, currentStoryTime: storyDay(20)}), false);
});
test('all domain inputs remain immutable and Projection has no State or Snapshot payload', () => {
  const value = input(); const before = structuredClone(value); make(value); assert.deepEqual(value, before);
  assert.equal(validateProjection({...make(), current_state: {}, probability: 0.5}).ok, false);
});
