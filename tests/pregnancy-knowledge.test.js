import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPregnancyKnowledgeSnapshot, mergePregnancyKnowledgeSnapshots, normalizePregnancyKnowledgeSnapshot, projectPregnancyKnowledgeForPrompt} from '../core/pregnancy-knowledge.js';
import {parseEventAnalysisResponse} from '../ai/analyzer.js';
import {buildEventAnalysisMessages} from '../ai/prompts.js';
import {buildProjectionContext} from '../core/projection-context.js';
import {createPregnancyKnowledgeRuntime} from '../runtime/pregnancy-knowledge-runtime.js';
import {createPregnancyKnowledgePersistence} from '../storage/pregnancy-knowledge.js';
import {emptyFloor} from '../storage/schema.js';

const version = floor => ({chat_id: 'chat', message_id: `m${floor}`, floor, swipe_id: 0});
const entry = (subject, pregnancy, knowers, floor) => ({
  subject_id: subject,
  pregnancy_id: pregnancy,
  knowers: knowers.map(character_id => ({character_id, learned_at_floor_version: version(floor), evidence_fingerprint: 'fp'})),
  updated_at_floor_version: version(floor),
});

function storageFixture() {
  const floors = new Map();
  const messages = Array.from({length: 40}, () => ({}));
  const store = {
    getActiveSwipeId: () => 0,
    getFloorOwner: () => ({owner_type: 'character', active_swipe_id: 0}),
    getFloor: index => floors.get(index) ?? null,
    getCurrentChatOwnerSnapshot: () => ({messages}),
    async saveFloor(index, _swipeId, next) { floors.set(index, structuredClone(next)); },
  };
  const persistence = createPregnancyKnowledgePersistence({
    store,
    resolveCurrentFloorVersion: async ({ownerFloor}) => floors.get(ownerFloor.message_index)?.floor_version ?? null,
  });
  const install = index => {
    const next = {...emptyFloor(), floor_version: version(index)};
    floors.set(index, next);
    return next.floor_version;
  };
  return {floors, persistence, install};
}

test('knowledge storage uses complete roots, rollback endpoints, and rejects stale source Swipe', async () => {
  const {persistence, install} = storageFixture();
  const f20 = install(20);
  await persistence.saveSnapshot({ownerFloor: {message_index: 20}, floorVersion: f20, snapshot: buildPregnancyKnowledgeSnapshot([entry('char_000001', 'preg-1', ['char_000002'], 20)], f20)});
  const f26 = install(26);
  await persistence.saveSnapshot({ownerFloor: {message_index: 26}, floorVersion: f26, snapshot: mergePregnancyKnowledgeSnapshots(buildPregnancyKnowledgeSnapshot([entry('char_000001', 'preg-1', ['char_000002'], 20)], f20), [entry('char_000001', 'preg-1', ['char_000003'], 26)], f26)});
  const f30 = install(30);
  await persistence.saveSnapshot({ownerFloor: {message_index: 30}, floorVersion: f30, snapshot: buildPregnancyKnowledgeSnapshot([], f30)});
  assert.deepEqual((await persistence.getSnapshot({chatId: 'chat', endpointIndex: 23, endpointFloor: 23})).entries[0].knowers.map(item => item.character_id), ['char_000002']);
  assert.deepEqual((await persistence.getSnapshot({chatId: 'chat', endpointIndex: 29, endpointFloor: 29})).entries[0].knowers.map(item => item.character_id), ['char_000002', 'char_000003']);
  assert.deepEqual((await persistence.getSnapshot({chatId: 'chat', endpointIndex: 35, endpointFloor: 35})).entries, []);
  const stale = {...f30, swipe_id: 1};
  await assert.rejects(() => persistence.saveSnapshot({ownerFloor: {message_index: 30}, floorVersion: stale, snapshot: buildPregnancyKnowledgeSnapshot([], stale)}), error => error.code === 'FLOOR_SWIPE_STALE');
});

test('pregnancy knowledge is a complete snapshot and preserves historical floors', () => {
  const f20 = buildPregnancyKnowledgeSnapshot([entry('char_000001', 'preg_1', ['char_000002', 'char_000003'], 20)], version(20));
  const f26 = mergePregnancyKnowledgeSnapshots(f20, [entry('char_000001', 'preg_1', ['char_000004'], 26)], version(26));
  const f30 = buildPregnancyKnowledgeSnapshot(f26.entries.map(item => item.subject_id === 'char_000001' ? {...item, knowers: item.knowers.filter(knower => knower.character_id !== 'char_000003')} : item), version(30));
  assert.deepEqual(f20.entries[0].knowers.map(item => item.character_id), ['char_000002', 'char_000003']);
  assert.deepEqual(f26.entries[0].knowers.map(item => item.character_id), ['char_000002', 'char_000003', 'char_000004']);
  assert.deepEqual(f30.entries[0].knowers.map(item => item.character_id), ['char_000002', 'char_000004']);
  assert.deepEqual(normalizePregnancyKnowledgeSnapshot(buildPregnancyKnowledgeSnapshot([], version(31))).entries, []);
});

test('knowledge sidecar is optional and malformed items do not reject Events', () => {
  const parsed = parseEventAnalysisResponse(JSON.stringify({
    schema_version: 1,
    events: [],
    pregnancy_knowledge_candidates: [
      {pregnant_character: {display_name: '柳如烟'}, knower: {display_name: '觉心'}, observation: '觉心得知检查结果'},
      {pregnant_character: {display_name: '匿名'}, knower: {character_id: 'char_000002'}, observation: 'bad'},
    ],
  }), {deferIdentityValidation: true});
  assert.equal(parsed.events.length, 0);
  assert.equal(parsed.pregnancy_knowledge_candidates.length, 1);
  assert.deepEqual(parsed.pregnancy_knowledge_diagnostics.map(item => item.reason_code), ['internal_id_field']);
});

test('knowledge parser reports malformed aliases without poisoning valid siblings', () => {
  const parsed = parseEventAnalysisResponse(JSON.stringify({
    schema_version: 1,
    events: [],
    pregnancy_knowledge_candidates: [
      {pregnant_character: {display_name: '甲'}, knower: {display_name: '乙', aliases: ['']}, observation: '乙明确得知甲已怀孕'},
      {pregnant_character: {display_name: '甲'}, knower: {display_name: '丙'}, observation: '丙得知甲检查确认怀孕'},
    ],
  }), {deferIdentityValidation: true});
  assert.equal(parsed.pregnancy_knowledge_candidates.length, 1);
  assert.deepEqual(parsed.pregnancy_knowledge_diagnostics.map(item => item.reason_code), ['knower_aliases_invalid']);
});

test('Event prompt includes readable pregnancy knowledge reference without internal ids', () => {
  const messages = buildEventAnalysisMessages({
    floor_version: version(30),
    current_floor: {floor: 30, message_id: 'm30', swipe_id: 0, narrative: '正文'},
    pregnancy_knowledge: [{subject_id: 'char_000001', subject_display_name: '甲', knower_display_names: ['乙']}],
  });
  const text = messages.map(item => item.content).join('\n');
  assert.match(text, /【已确认怀孕与知情范围】/);
  assert.match(text, /怀孕人物: 甲/);
  assert.match(text, /已知情人物:\n    - 乙/);
  assert.doesNotMatch(text, /char_000001/);
  assert.equal(messages.find(item => item.content.includes('【已确认怀孕与知情范围】'))?.role, 'system');
});

test('Event prompt requires a clear examination conclusion to create pregnancy confirmation', () => {
  const messages = buildEventAnalysisMessages({
    floor_version: version(30),
    current_floor: {
      floor: 30,
      message_id: 'm30',
      swipe_id: 0,
      narrative: '医者诊脉后明确说这是滑脉，在凡俗界便是有喜的征兆。',
    },
  });
  const text = messages.map(item => item.content).join('\n');
  assert.match(text, /检查|诊脉/);
  assert.match(text, /其它充分事实证据|确定诊断权威/);
  assert.match(text, /明确.*结论.*pregnancy_confirmation/);
  assert.match(text, /pregnancy_ref.*kind.*new/);
  assert.match(text, /征兆|可能|疑似.*不得.*确认/);
  assert.match(text, /分别评估每个角色/);
  assert.match(text, /仅在场、参与检查、被提及/);
  assert.match(text, /固定姓名、关键词或角色位置硬编码/);
});

test('Event prompt keeps confirmation, examination participants, identity, and knowledge relations separate', () => {
  const messages = buildEventAnalysisMessages({
    floor_version: version(30),
    current_floor: {
      floor: 30,
      message_id: 'm30',
      swipe_id: 0,
      narrative: '常和为柳如烟诊脉并明确说确认怀孕；觉心只在后续大典场景出现。',
    },
  });
  const text = messages.map(item => item.content).join('\n');
  assert.match(text, /独立.*pregnancy_confirmation/);
  assert.match(text, /medical_event.*不能.*代替.*pregnancy_confirmation/);
  assert.match(text, /state_fact\.subject_id.*怀孕人物/);
  assert.match(text, /不得.*任选|不得.*填齐 participant/);
  assert.match(text, /new.*unresolved|response-local.*mention_id/);
  assert.match(text, /participant.*直接对象|直接参与者/);
  assert.match(text, /若.*没有.*pregnancy_confirmation.*修正/);
});

test('knowledge runtime rejects ambiguous identities and binds only confirmed episodes', async () => {
  const saved = [];
  const runtime = createPregnancyKnowledgeRuntime({
    persistence: {
      async getSnapshot() { return null; },
      async saveSnapshot(input) { saved.push(input.snapshot); return {status: 'readback_verified', snapshot: input.snapshot}; },
    },
  });
  const target = {index: 3, version: version(3)};
  const analysisInput = {
    character_registry: {schema_version: 1, entities: {
      char_000001: {character_id: 'char_000001', display_name: '柳如烟', aliases: []},
      char_000002: {character_id: 'char_000002', display_name: '觉心', aliases: []},
    }},
    current_floor: {narrative: '觉心得知柳如烟检查确认怀孕，柳如烟却说：怎可能有喜。'},
    recent_context: [],
  };
  const events = [{event_id: 'evt-1', source: version(3), type: 'pregnancy_confirmation', status: 'confirmed', participants: [{identity_status: 'existing', character_id: 'char_000001', event_role: 'potential_gestational_subject'}], pregnancy_relevance: {relevant: false, possible_conception: false, gestational_subject_ids: [], counterpart_ids: [], reproductive_mechanism: {}, confidence: 1}, source_evidence: [{kind: 'medical', text: '检查确认怀孕'}], state_fact: {subject_id: 'char_000001', payload: {pregnancy_id: 'preg-1'}}}];
  const result = await runtime.processCandidates({target, analysisInput, events, candidates: [{pregnant_character: {display_name: '柳如烟'}, knower: {display_name: '觉心'}, observation: '觉心得知柳如烟检查确认怀孕，柳如烟却说：怎可能有喜。'}]});
  assert.equal(result.status, 'saved');
  assert.equal(saved[0].entries[0].pregnancy_id, 'preg-1');
  assert.deepEqual(saved[0].entries[0].knowers.map(item => item.character_id), ['char_000002']);
});

test('knowledge runtime rejects ambiguous knower names without poisoning a valid candidate', async () => {
  let saved = 0;
  const runtime = createPregnancyKnowledgeRuntime({
    persistence: {
      async getSnapshot() { return null; },
      async saveSnapshot() { saved += 1; return {status: 'readback_verified', snapshot: {schema_version: 1, complete: true, entries: []}}; },
    },
  });
  const analysisInput = {
    character_registry: {schema_version: 1, entities: {
      char_000001: {character_id: 'char_000001', display_name: '甲', aliases: []},
      char_000002: {character_id: 'char_000002', display_name: '乙', aliases: []},
      char_000003: {character_id: 'char_000003', display_name: '乙', aliases: []},
    }},
    current_floor: {narrative: '乙明确得知甲已怀孕。'},
  };
  const result = await runtime.processCandidates({
    target: {index: 3, version: version(3)},
    analysisInput,
    events: [],
    candidates: [{pregnant_character: {display_name: '甲'}, knower: {display_name: '乙'}, observation: '乙明确得知甲已怀孕。'}],
  });
  assert.equal(result.status, 'unchanged');
  assert.equal(saved, 0);
  assert.equal(result.diagnostics[0].reason_code, 'knower_ambiguous_or_missing');
});

test('prompt projection keeps each pregnancy knowledge group separate', () => {
  const snapshot = buildPregnancyKnowledgeSnapshot([
    entry('char_000001', 'preg-1', ['char_000003'], 20),
    entry('char_000001', 'preg-2', ['char_000004'], 20),
    entry('char_000002', 'preg-2', ['char_000004'], 20),
  ], version(20));
  const registry = {entities: {
    char_000001: {display_name: '甲', aliases: []}, char_000002: {display_name: '乙', aliases: []},
    char_000003: {display_name: '丙', aliases: []}, char_000004: {display_name: '丁', aliases: []},
  }};
  const projection = projectPregnancyKnowledgeForPrompt(snapshot, registry);
  const context = buildProjectionContext([], {pregnancyKnowledge: projection.map(item => ({subject_id: item.subject_id, subject_display_name: item.subject.display_name, knower_display_names: item.knowers.map(knower => knower.display_name)}))});
  assert.match(context.prompt, /怀孕人物：甲/);
  assert.match(context.prompt, /明确知情：丙/);
  assert.match(context.prompt, /怀孕人物：乙/);
  assert.match(context.prompt, /明确知情：丁/);
  assert.match(context.prompt, /明确知情：丁/);
  assert.equal(context.dto.filter(item => item?.context_type === 'projection').length, 0);
});
