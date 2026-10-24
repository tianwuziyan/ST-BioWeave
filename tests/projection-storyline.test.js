import test from 'node:test';
import assert from 'node:assert/strict';
import {applyStorylineJudge, buildStorylineContextPrompt, createStorylineSnapshot, emptyStorylineSnapshot, recordStorylineBody, storylineJudgeDue} from '../core/projection-storyline.js';
import {buildStorylineDesignMessages, buildStorylineJudgeMessages, parseStorylineDesignResponse, parseStorylineJudgeResponse} from '../ai/projection-storyline.js';
import {createProjectionStorylineRuntime} from '../runtime/projection-storyline-runtime.js';
import {parseEventAnalysisResponse} from '../ai/analyzer.js';
import {materializeNotPregnantCandidates} from '../runtime/character-event-analysis.js';
import {createCharacterEventAnalysis} from '../runtime/character-event-analysis.js';
import {createRuntimeDiagnostics} from '../runtime/diagnostics.js';

const floor = {chat_id: 'chat', message_id: 'm1', floor: 20, swipe_id: 0, content_hash: 'hash', message_version: '1'};
const branch = n => ({title: `支线${n}`, premise: '因肠胃不适就医', nodes: [{title: '挂号', objective: '创造就医条件', completion_signal: '已挂号'}, {title: '检查', objective: '完成检查', completion_signal: '已检查'}, {title: '结论', objective: '形成检查结论', completion_signal: '已有结论'}], conclusion_goal: '完成检查并自然得到结论'});

test('storyline design exposes display name but not internal ids', () => {
  const messages = buildStorylineDesignMessages({displayName: '沈清秋', aliases: ['清秋']});
  const prompt = messages.map(message => message.content).join('\n');
  assert.match(prompt, /姓名：沈清秋/);
  assert.doesNotMatch(prompt, /subject_id|cycle_id/);
  const snapshot = parseStorylineDesignResponse(JSON.stringify({branches: [branch(1), branch(2), branch(3)]}), {subjectId: 'char_1', displayName: '沈清秋', floorVersion: floor});
  assert.equal(snapshot.branches.length, 3);
  assert.equal(snapshot.branches[0].nodes.length, 3);
});

test('storyline design parser unwraps standard API response envelopes', () => {
  const response = JSON.stringify({branches: [branch(1), branch(2), branch(3)]});
  const fencedResponse = `\`\`\`json\n${response}\n\`\`\``;
  const envelopes = [
    {content: response},
    {content: fencedResponse},
    {content: [{type: 'text', text: response}]},
    {choices: [{message: {content: response}}]},
    {choices: [{text: response}]},
    {data: {content: response}},
  ];
  for (const envelope of envelopes) {
    const snapshot = parseStorylineDesignResponse(envelope, {subjectId: 'char_1', displayName: '沈清秋', floorVersion: floor});
    assert.equal(snapshot.branches.length, 3);
  }
});

test('storyline API messages use readable system assistant user sections', () => {
  const messages = buildStorylineDesignMessages({
    displayName: '沈清秋',
    aliases: ['清秋'],
    characterContext: 'medical_note：容易胃部不适',
    worldContext: 'setting：医院附近',
    worldbooks: '世界书：医院规则',
    otherReferenceData: '其他参考：当地诊疗习惯',
    externalMemory: '外部记忆：曾经有过胃部不适记录',
    recentStory: '沈清秋因胃部不适准备去医院。',
    triggeredSignals: ['恶心'],
  });
  assert.deepEqual(messages.map(message => message.role), ['system', 'system', 'assistant', 'user']);
  assert.doesNotMatch(messages[0].content, /你是 BioWeave 剧情支线 API/);
  assert.match(messages[0].content, /【任务定位】/);
  assert.match(messages[0].content, /【事实边界】/);
  assert.match(messages[0].content, /【支线推进】/);
  assert.match(messages[0].content, /【输出格式】/);
  assert.match(messages[0].content, /每条支线恰好包含 3 个节点/);
  assert.match(messages[0].content, /只输出合法 JSON/);
  assert.match(messages[0].content, /不使用 Markdown 代码围栏/);
  assert.match(messages[0].content, /“branches”/);
  assert.doesNotMatch(messages[0].content, /3 到 5 个有序节点/);
  assert.doesNotMatch(messages[1].content, /【目标人物】|【人物资料】|【已触发生理信号】|沈清秋/);
  assert.doesNotMatch(messages[1].content, /【世界观】/);
  assert.match(messages[1].content, /【其他参考数据】/);
  assert.match(messages[1].content, /【外部记忆】/);
  assert.doesNotMatch(messages[1].content, /世界书：医院规则/);
  assert.match(messages[1].content, /- 其他参考：当地诊疗习惯/);
  assert.match(messages[1].content, /外部记忆：曾经有过胃部不适记录/);
  assert.doesNotMatch(messages[1].content, /沈清秋|恶心|容易胃部不适/);
  assert.match(messages[2].content, /【近期剧情正文】[\s\S]*沈清秋因胃部不适准备去医院/);
  assert.match(messages[3].content, /【目标人物】[\s\S]*本块用途：限定本次支线分析的叙事对象[\s\S]*姓名：沈清秋/);
  assert.match(messages[3].content, /【人物资料】[\s\S]*容易胃部不适/);
  assert.match(messages[3].content, /【已触发生理信号】[\s\S]*恶心/);
  assert.ok(messages[3].content.indexOf('【人物资料】') < messages[3].content.indexOf('【已触发生理信号】'));
  assert.match(messages[3].content, /【任务要求】[\s\S]*设计恰好 3 条简短、自然且互不重复的剧情支线/);
  assert.match(messages[0].content, /不得使用“安胎”“保胎”或其它以妊娠已经成立为前提的诊疗措辞/);
  const all = messages.map(message => message.content).join('\n');
  assert.doesNotMatch(all, /JSON\.stringify|"world_model"|"setting"|char_1|cycle-secret|event-secret/);
});

test('storyline design parser rejects branches with fewer than three nodes', () => {
  const twoNodeBranch = {...branch(1), nodes: branch(1).nodes.slice(0, 2)};
  assert.throws(
    () => parseStorylineDesignResponse(JSON.stringify({branches: [twoNodeBranch, branch(2), branch(3)]}), {subjectId: 'char_1', displayName: '沈清秋', floorVersion: floor}),
    /STORYLINE_RESPONSE|must_be_three_to_five/,
  );
});

test('storyline omits empty optional blocks and does not duplicate character profile heading', () => {
  const messages = buildStorylineDesignMessages({
    displayName: '沈清秋',
    characterContext: {display_name: '沈清秋', projection_rules: [], health: {status: ''}},
    worldContext: {projection_rules: [], health: {status: ''}},
    otherReferenceData: {},
  });
  const all = messages.map(message => message.content).join('\n');
  assert.doesNotMatch(all, /【其他参考数据】|推演规则：\s*（无）/);
  assert.equal((all.match(/【人物资料】/g) || []).length, 1);
  assert.doesNotMatch(all, /【人物资料】[\s\S]*【人物资料】/);
});

test('storyline source blocks reuse World/Event analysis presentation formatters', () => {
  const messages = buildStorylineDesignMessages({
    displayName: '沈清秋',
    worldContext: {
      schema_version: 1,
      event_id: 'event-secret',
      species: [{name: '人类', biological_type: '女性', biological_types: [{name: '女性'}], reproductive_capabilities: {can_carry_pregnancy: true}}],
    },
    worldbooks: [{
      source_id: 'worldbook-secret',
      entries: [{entry_id: 'entry-secret', label: '医疗设定', content: '世界中存在可进行常规检查的医馆。'}],
    }],
    externalMemory: [
      {enabled: true, available: true, content_available: true, read_status: 'success', label: 'Anima', items: [{content: '曾有胃部不适记录。'}]},
      {enabled: false, available: true, content_available: true, read_status: 'success', label: 'Disabled', items: [{content: '不应进入请求。'}]},
    ],
    otherReferenceData: {known_characters: [
      {display_name: '祁鸢'},
      {display_name: '觉心'},
      {display_name: '柳如烟', aliases: ['如烟']},
    ]},
  });
  assert.match(messages[1].content, /【当前 World Model 参考】/);
  assert.doesNotMatch(messages[1].content, /【世界观】/);
  assert.match(messages[1].content, /物种：[\s\S]*名称：人类/);
  assert.match(messages[1].content, /生理类型：\n\s+- 名称：女性/);
  assert.match(messages[1].content, /已知生殖能力：[\s\S]*可承载妊娠：是/);
  assert.match(messages[1].content, /物种：[\s\S]*\n  - 名称：人类[\s\S]*\n    生理类型：/);
  assert.doesNotMatch(messages[1].content, /event-secret/);
  assert.doesNotMatch(messages[1].content, /\n\s*-\s*\n/);
  assert.doesNotMatch(messages[1].content, /世界中存在可进行常规检查的医馆|worldbook-secret|entry-secret/);
  assert.match(messages[1].content, /- 已知人物：\n  - 角色名：柳如烟\n    昵称：如烟/);
  assert.doesNotMatch(messages[1].content, /祁鸢|觉心/);
  assert.doesNotMatch(messages[1].content, /- 已知人物：角色名：/);
  assert.match(messages[1].content, /【外部记忆】[\s\S]*【Anima】[\s\S]*曾有胃部不适记录/);
  assert.doesNotMatch(messages[1].content, /不应进入请求/);
  assert.doesNotMatch(messages[1].content, /\n\s*-\s*\n/);
});

test('storyline omits known-character entries and block when no nicknames exist', () => {
  const messages = buildStorylineDesignMessages({
    otherReferenceData: {known_characters: [{display_name: '祁鸢'}, {display_name: '觉心', aliases: []}]},
  });
  const content = messages[1].content;
  assert.doesNotMatch(content, /已知人物|祁鸢|觉心/);
});

test('storyline judge uses readable branch labels instead of JSON blobs', () => {
  const snapshot = createStorylineSnapshot({subject_id: 'char_1', display_name: '沈清秋', branches: [branch(1), branch(2), branch(3)], created_at_floor_version: floor});
  const messages = buildStorylineJudgeMessages({snapshot, body: '沈清秋挂号后进入检查室。'});
  const prompt = messages.map(message => message.content).join('\n');
  assert.match(prompt, /支线 1（支线编号：/);
  assert.match(prompt, /节点目标：/);
  assert.match(prompt, /【目标人物】/);
  assert.match(prompt, /【候选支线】/);
  assert.match(prompt, /【近期剧情正文】/);
  assert.ok(prompt.indexOf('【人物资料】') < prompt.indexOf('【已触发生理信号】'));
  assert.doesNotMatch(prompt, /\[\{\"branch_id\"|JSON\.stringify/);
  assert.doesNotMatch(prompt, /char_1|cycle_id|pregnancy_id/);
  assert.deepEqual(messages.map(message => message.role), ['system', 'assistant', 'user']);
  assert.match(messages.find(message => message.role === 'assistant').content, /【近期剧情正文】[\s\S]*沈清秋挂号后进入检查室/);
  assert.match(messages.find(message => message.role === 'user').content, /【候选支线】/);
});

test('storyline judge prompt keeps JSON response contract aligned with parser', () => {
  const snapshot = createStorylineSnapshot({subject_id: 'char_1', display_name: '沈清秋', branches: [branch(1), branch(2), branch(3)], created_at_floor_version: floor});
  const selection = buildStorylineJudgeMessages({snapshot, body: '沈清秋挂号后进入检查室.'});
  assert.match(selection.map(message => message.content).join('\n'), /\{"branch_id":"支线编号"\} 或 \{"branch_id":null\}/);
  const selected = parseStorylineJudgeResponse(JSON.stringify({branch_id: snapshot.branches[0].branch_id}), snapshot);
  const progression = buildStorylineJudgeMessages({snapshot: selected, body: '沈清秋完成检查。'});
  const progressionText = progression.map(message => message.content).join('\n');
  assert.match(progressionText, /\{"action":"stay"\}、\{"action":"advance"\} 或 \{"action":"awaiting_outcome"\}/);
  assert.ok(progressionText.indexOf('【人物资料】') < progressionText.indexOf('【已触发生理信号】'));
  assert.deepEqual(progression.map(message => message.role), ['system', 'assistant', 'user']);
  assert.deepEqual(parseStorylineJudgeResponse(JSON.stringify({action: 'stay'}), selected), selected);
});

test('selection is one-way and progression cannot switch branch', () => {
  const snapshot = createStorylineSnapshot({subject_id: 'char_1', display_name: '沈清秋', branches: [branch(1), branch(2), branch(3)], created_at_floor_version: floor});
  const selected = parseStorylineJudgeResponse(JSON.stringify({branch_id: snapshot.branches[1].branch_id}), snapshot);
  assert.equal(selected.status, 'selected');
  assert.equal(selected.branches.length, 1);
  assert.equal(selected.selected_branch_id, snapshot.branches[1].branch_id);
  assert.throws(() => parseStorylineJudgeResponse(JSON.stringify({branch_id: snapshot.branches[0].branch_id}), selected));
});

test('selected branch leaves its final node and continues toward conclusion goal', () => {
  const snapshot = createStorylineSnapshot({subject_id: 'char_1', display_name: '沈清秋', branches: [branch(1), branch(2), branch(3)], created_at_floor_version: floor});
  const selected = applyStorylineJudge(snapshot, {branch_id: snapshot.branches[0].branch_id});
  const afterNodes = applyStorylineJudge({...selected, current_node_index: selected.branches[0].nodes.length - 1}, {action: 'advance'});
  assert.equal(afterNodes.status, 'selected');
  assert.equal(afterNodes.current_node_index, afterNodes.branches[0].nodes.length);
  const prompt = buildStorylineContextPrompt(afterNodes);
  assert.match(prompt, /完成检查并自然得到结论/);
  assert.doesNotMatch(prompt, /当前目标：形成检查结论/);
});

test('two valid bodies make a judge due without retaining raw response', () => {
  const snapshot = createStorylineSnapshot({subject_id: 'char_1', display_name: '沈清秋', branches: [branch(1), branch(2), branch(3)], created_at_floor_version: floor});
  const one = recordStorylineBody(snapshot, 'response-1');
  assert.equal(storylineJudgeDue(one), false);
  const two = recordStorylineBody(one, 'response-2');
  assert.equal(storylineJudgeDue(two), true);
  assert.notEqual(two.snapshot_id, one.snapshot_id);
  assert.match(two.due_attempt_id, /^storyline_judge_attempt_/);
  assert.equal(JSON.stringify(two).includes('raw_response'), false);
  assert.deepEqual(recordStorylineBody(two, 'response-3'), two);
});

test('terminated snapshot is explicit and context is empty', () => {
  const snapshot = emptyStorylineSnapshot({subject_id: 'char_1', display_name: '沈清秋', created_at_floor_version: floor});
  assert.equal(snapshot.status, 'terminated');
  assert.equal(buildStorylineContextPrompt(snapshot), '');
  assert.equal(buildStorylineJudgeMessages({snapshot, body: '检查完成'}), '');
});

test('storyline runtime keeps submission and readback helpers inside the factory', async () => {
  const saved = [];
  const snapshot = createStorylineSnapshot({subject_id: 'char_1', display_name: '沈清秋', branches: [branch(1), branch(2), branch(3)], created_at_floor_version: floor});
  const runtime = createProjectionStorylineRuntime({
    analyzer: {generateStoryline: async () => JSON.stringify({branch_id: null})},
    getProjectionViews: async () => ({storyline_snapshots: [snapshot], triggered_snapshots: [], storyline_delivery_records: []}),
    saveProjectionStorylineSnapshotBatch: async input => { saved.push(input); return {status: 'appended'}; },
    saveProjectionStorylineDelivery: async input => { saved.push(input); return {status: 'appended'}; },
    resolveCurrentFloor: async () => ({index: 0, version: floor}),
    getChatId: () => 'chat',
  });
  const result = await runtime.recordSubmission({floor: {index: 0, version: floor}, subjectId: 'char_1', contextFingerprint: 'ctx', generationId: 'g1'});
  assert.equal(result.status, 'appended');
  assert.equal(saved[0].record.context_fingerprint, 'ctx');
});

test('not-pregnant closure fails closed when its active aggregation is absent', async () => {
  const snapshot = createStorylineSnapshot({subject_id: 'char_1', display_name: '沈清秋', branches: [branch(1), branch(2), branch(3)], created_at_floor_version: floor});
  let writes = 0;
  const runtime = createProjectionStorylineRuntime({
    analyzer: {generateStoryline: async () => null},
    getProjectionViews: async () => ({storyline_snapshots: [snapshot], triggered_snapshots: [], storyline_delivery_records: []}),
    saveProjectionStorylineSnapshotBatch: async () => { writes += 1; return {status: 'appended'}; },
    resolveCurrentFloor: async () => ({index: 0, version: floor}),
    getChatId: () => 'chat',
  });
  await runtime.settled({
    settled: true,
    inputs: {
      floor: {index: 0, version: floor},
      subjects: [{subject_id: 'char_1', display_name: '沈清秋'}],
      events: [{type: 'pregnancy_lifecycle', status: 'confirmed', event_id: 'evt-1', state_fact: {subject_id: 'char_1', payload: {status: 'not_pregnant', cycle_id: 'cycle-1'}}}],
      participantAggregations: [],
    },
  });
  assert.equal(writes, 0);
});

test('not-pregnant closure selects the lifecycle fact even when confirmation is listed first', async () => {
  const snapshot = createStorylineSnapshot({subject_id: 'char_1', display_name: '沈清秋', branches: [branch(1), branch(2), branch(3)], created_at_floor_version: floor});
  const views = {storyline_snapshots: [snapshot], triggered_snapshots: [], storyline_delivery_records: []};
  let archivedFact = null;
  const diagnostics = createRuntimeDiagnostics({getChatId: () => 'chat'});
  const runtime = createProjectionStorylineRuntime({
    analyzer: {generateStoryline: async () => null},
    getProjectionViews: async () => views,
    saveProjectionStorylineSnapshotBatch: async ({snapshots}) => { views.storyline_snapshots = snapshots; return {status: 'appended'}; },
    archiveAndReleasePregnancy: async input => { archivedFact = input.fact; },
    resolveCurrentFloor: async () => ({index: 0, version: floor}),
    getChatId: () => 'chat',
    diagnostics,
  });
  await runtime.settled({settled: true, inputs: {
    floor: {index: 0, version: floor},
    trackingSubjects: {char_1: {character_id: 'char_1', display_name: '沈清秋'}},
    events: [
      {type: 'pregnancy_confirmation', status: 'confirmed', event_id: 'evt-confirmation', state_fact: {subject_id: 'char_1', payload: {status: 'pregnant'}}},
      {type: 'pregnancy_lifecycle', status: 'confirmed', event_id: 'evt-not-pregnant', state_fact: {subject_id: 'char_1', payload: {status: 'not_pregnant', cycle_id: 'cycle-1', evidence_refs: ['evt-not-pregnant']}}},
    ],
    participantAggregations: [{aggregation_id: 'agg-1', subject_id: 'char_1', cycle_id: 'cycle-1', status: 'succeeded'}],
  }});
  assert.equal(archivedFact.source_event_id, 'evt-not-pregnant');
  assert.equal(views.storyline_snapshots[0].status, 'terminated');
  const stages = diagnostics.getStorylineDiagnostics({chat_id: 'chat', floor_version: floor}).sequence;
  const first = (stage, status) => stages.findIndex(item => item.stage === stage && item.status === status);
  assert.ok(first('NOT_PREGNANT_BINDING', 'succeeded') >= 0);
  assert.ok(first('NOT_PREGNANT_RELEASE', 'started') > first('NOT_PREGNANT_BINDING', 'succeeded'));
  assert.ok(first('NOT_PREGNANT_RELEASE', 'succeeded') > first('NOT_PREGNANT_RELEASE', 'started'));
  assert.ok(first('SNAPSHOT_WRITE', 'started') > first('NOT_PREGNANT_RELEASE', 'succeeded'));
  assert.ok(first('SNAPSHOT_WRITE', 'succeeded') > first('SNAPSHOT_WRITE', 'started'));
  assert.ok(first('SNAPSHOT_READBACK', 'started') > first('SNAPSHOT_WRITE', 'succeeded'));
  assert.ok(first('SNAPSHOT_READBACK', 'succeeded') > first('SNAPSHOT_READBACK', 'started'));
});

test('factual closure only becomes terminal after verified snapshot readback', async () => {
  const snapshot = createStorylineSnapshot({subject_id: 'char_1', display_name: '沈清秋', branches: [branch(1), branch(2), branch(3)], created_at_floor_version: floor});
  const sibling = createStorylineSnapshot({subject_id: 'char_2', display_name: '林黛玉', branches: [branch(1), branch(2), branch(3)], created_at_floor_version: floor});
  const views = {storyline_snapshots: [snapshot, sibling], triggered_snapshots: [], storyline_delivery_records: []};
  let saveCalls = 0;
  const runtime = createProjectionStorylineRuntime({
    analyzer: {generateStoryline: async () => null},
    getProjectionViews: async () => views,
    saveProjectionStorylineSnapshotBatch: async ({snapshots}) => { saveCalls += 1; views.storyline_snapshots = [...views.storyline_snapshots.filter(item => item.subject_id !== snapshots[0].subject_id), ...snapshots]; return {status: 'appended'}; },
    archiveAndReleasePregnancy: async () => {},
    resolveCurrentFloor: async () => ({index: 0, version: floor}),
    getChatId: () => 'chat',
  });
  await runtime.settled({settled: true, inputs: {
    floor: {index: 0, version: floor},
    trackingSubjects: {char_1: {character_id: 'char_1', display_name: '沈清秋'}, char_2: {character_id: 'char_2', display_name: '林黛玉'}},
    events: [{type: 'pregnancy_confirmation', status: 'confirmed', event_id: 'evt-confirmation', state_fact: {subject_id: 'char_1', payload: {status: 'pregnant'}}}],
    participantAggregations: [],
  }});
  assert.equal(saveCalls, 1);
  assert.equal(views.storyline_snapshots.find(item => item.subject_id === 'char_1').status, 'terminated');
  assert.equal(views.storyline_snapshots.find(item => item.subject_id === 'char_2').snapshot_id, sibling.snapshot_id);
});

test('factual closure uses a current-Floor storyline snapshot even when the previous endpoint is empty', async () => {
  const currentFloor = {...floor, message_id: 'm20', floor: 20};
  const snapshot = createStorylineSnapshot({subject_id: 'char_1', display_name: '沈清秋', branches: [branch(1), branch(2), branch(3)], created_at_floor_version: currentFloor});
  const currentViews = {storyline_snapshots: [snapshot], triggered_snapshots: [], storyline_delivery_records: []};
  const previousViews = {storyline_snapshots: [], triggered_snapshots: [], storyline_delivery_records: []};
  let writes = 0;
  const runtime = createProjectionStorylineRuntime({
    analyzer: {generateStoryline: async () => null},
    getProjectionViews: async options => Number(options.endpointIndex) === 0 ? previousViews : currentViews,
    saveProjectionStorylineSnapshotBatch: async ({snapshots}) => {
      writes += 1;
      currentViews.storyline_snapshots = snapshots;
      return {status: 'appended'};
    },
    resolveCurrentFloor: async () => ({index: 1, version: currentFloor}),
    getChatId: () => 'chat',
  });
  await runtime.settled({settled: true, inputs: {
    floor: {index: 1, version: currentFloor},
    trackingSubjects: {char_1: {character_id: 'char_1', display_name: '沈清秋'}},
    events: [{type: 'pregnancy_confirmation', status: 'confirmed', event_id: 'evt-confirmation', state_fact: {subject_id: 'char_1', payload: {status: 'pregnant'}}}],
    participantAggregations: [],
  }});
  assert.equal(writes, 1);
  assert.equal(currentViews.storyline_snapshots[0].status, 'terminated');
});

test('factual closure readback mismatch throws and leaves the active snapshot retryable', async () => {
  const snapshot = createStorylineSnapshot({subject_id: 'char_1', display_name: '沈清秋', branches: [branch(1), branch(2), branch(3)], created_at_floor_version: floor});
  const views = {storyline_snapshots: [snapshot], triggered_snapshots: [], storyline_delivery_records: []};
  const diagnostics = createRuntimeDiagnostics({getChatId: () => 'chat'});
  const runtime = createProjectionStorylineRuntime({
    analyzer: {generateStoryline: async () => null},
    getProjectionViews: async () => views,
    saveProjectionStorylineSnapshotBatch: async () => ({status: 'appended'}),
    resolveCurrentFloor: async () => ({index: 0, version: floor}),
    getChatId: () => 'chat',
    diagnostics,
  });
  await assert.rejects(() => runtime.settled({settled: true, inputs: {
    floor: {index: 0, version: floor},
    trackingSubjects: {char_1: {character_id: 'char_1', display_name: '沈清秋'}},
    events: [{type: 'pregnancy_confirmation', status: 'confirmed', event_id: 'evt-confirmation', state_fact: {subject_id: 'char_1', payload: {status: 'pregnant'}}}],
    participantAggregations: [],
  }}), /STORYLINE_READBACK_MISMATCH/);
  assert.equal(views.storyline_snapshots[0].snapshot_id, snapshot.snapshot_id);
  assert.equal(views.storyline_snapshots[0].status, snapshot.status);
  assert.ok(diagnostics.getStorylineDiagnostics({chat_id: 'chat', floor_version: floor}).sequence.some(item => item.stage === 'SNAPSHOT_READBACK' && item.status === 'mismatch'));
});

test('runtime judges exactly the same two bodies after a failed judge and never counts a third', async () => {
  const submissionFloor = {...floor, floor: 10, message_id: 'm10', content_hash: 'hash-10'};
  const currentFloor = {...floor, floor: 20, message_id: 'm20'};
  const candidateSnapshot = createStorylineSnapshot({subject_id: 'char_1', display_name: '沈清秋', branches: [branch(1), branch(2), branch(3)], created_at_floor_version: submissionFloor});
  const snapshot = createStorylineSnapshot({subject_id: 'char_1', display_name: '沈清秋', status: 'selected', branches: [candidateSnapshot.branches[0]], selected_branch_id: candidateSnapshot.branches[0].branch_id, created_at_floor_version: submissionFloor});
  const views = {
    storyline_snapshots: [snapshot],
    triggered_snapshots: [{subject_id: 'char_1', status: 'active', triggered: [{reaction_concept: 'nausea'}]}],
    storyline_delivery_records: [{kind: 'submission', subject_id: 'char_1', response_id: 'generation-1', context_fingerprint: 'ctx-1', floor_version: submissionFloor, created_at_floor_version: submissionFloor}],
  };
  const analyzedBodies = [];
  let judgeCalls = 0;
  const diagnostics = createRuntimeDiagnostics({getChatId: () => 'chat'});
  const runtime = createProjectionStorylineRuntime({
    analyzer: {generateStoryline: async ({messages}) => { judgeCalls += 1; analyzedBodies.push(messages.map(message => message.content).join('\n')); return JSON.stringify({action: 'invalid'}); }},
    getProjectionViews: async () => views,
    saveProjectionStorylineSnapshotBatch: async ({snapshots}) => { views.storyline_snapshots = snapshots; return {status: 'appended'}; },
    saveProjectionStorylineDelivery: async ({record}) => { views.storyline_delivery_records.push({...record, floor_version: record.response_id === 'body-1' ? {...currentFloor, floor: 19, message_id: 'm19'} : currentFloor, created_at_floor_version: currentFloor}); return {status: 'appended'}; },
    readStoryBodyByFloorVersion: async version => version.message_id === 'm19' ? '第一条正文' : '第二条正文',
    resolveCurrentFloor: async () => ({index: 1, version: currentFloor}),
    getChatId: () => 'chat',
    diagnostics,
  });
  const inputs = {floor: {index: 1, version: currentFloor}, trackingSubjects: {char_1: {character_id: 'char_1', display_name: '沈清秋'}}};
  await runtime.settled({settled: true, inputs, responseId: 'body-1', generation: 'g-1'});
  assert.equal(views.storyline_snapshots[0].valid_body_count, 1);
  await runtime.settled({settled: true, inputs, responseId: 'body-2', generation: 'g-2'});
  const dueAttempt = views.storyline_snapshots[0].due_attempt_id;
  assert.equal(views.storyline_snapshots[0].valid_body_count, 2);
  assert.equal(judgeCalls, 1);
  await runtime.settled({settled: true, inputs, responseId: 'body-3', generation: 'g-3'});
  assert.equal(judgeCalls, 2);
  assert.equal(views.storyline_snapshots[0].valid_body_count, 2);
  assert.equal(views.storyline_snapshots[0].due_attempt_id, dueAttempt);
  assert.equal(analyzedBodies[0].includes('第一条正文'), true);
  assert.equal(analyzedBodies[0].includes('第二条正文'), true);
  assert.equal(analyzedBodies[1], analyzedBodies[0]);
  const stages = diagnostics.getStorylineDiagnostics({chat_id: 'chat', floor_version: currentFloor}).sequence;
  const first = (stage, status) => stages.findIndex(item => item.stage === stage && item.status === status);
  assert.ok(first('RESPONSE_RECEIPT', 'succeeded') >= 0);
  assert.ok(first('BODY_READ', 'started') > first('RESPONSE_RECEIPT', 'succeeded'));
  assert.ok(first('BODY_READ', 'succeeded') > first('BODY_READ', 'started'));
  assert.ok(first('CADENCE_DUE', 'due') > first('BODY_READ', 'succeeded'));
  assert.ok(first('JUDGE_REQUEST', 'started') > first('CADENCE_DUE', 'due'));
  assert.ok(first('JUDGE_RETRY', 'failed') > first('JUDGE_REQUEST', 'started'));
  assert.equal(stages.filter(item => item.stage === 'BODY_READ' && item.status === 'started').length, 2);
});

test('settled storyline design is deferred, single-flight, and deduplicated after Floor readback', async () => {
  let calls = 0;
  let writes = 0;
  const trigger = {subject_id: 'char_1', status: 'active', triggered: [{reaction_concept: 'nausea', event_ids: ['event-1']}]};
  const views = {storyline_snapshots: [], triggered_snapshots: [trigger], storyline_delivery_records: []};
  const runtime = createProjectionStorylineRuntime({
    analyzer: {generateStoryline: async () => { calls += 1; return JSON.stringify({branches: [branch(1), branch(2), branch(3)]}); }},
    getProjectionViews: async () => views,
    saveProjectionStorylineSnapshotBatch: async ({snapshots}) => { writes += 1; views.storyline_snapshots = snapshots; return {status: 'appended'}; },
    resolveCurrentFloor: async () => ({index: 0, version: floor}),
    getChatId: () => 'chat',
  });
  const inputs = {floor: {index: 0, version: floor, narrative: '医院检查'}, trackingSubjects: {char_1: {character_id: 'char_1', display_name: '沈清秋', aliases: ['清秋']}}, worldModel: {}, characterProfiles: {char_1: {display_name: '沈清秋'}}};
  assert.equal((await runtime.settled({inputs, settled: false})).status, 'not_settled');
  assert.equal(calls, 0);
  await runtime.settled({inputs, settled: true, generation: 'g1'});
  await runtime.settled({inputs, settled: true, generation: 'g2'});
  assert.equal(calls, 1);
  assert.equal(writes, 1);
});

test('storyline design ignores an old current-Floor snapshot, replaces it, and preserves current siblings', async () => {
  const currentFloor = {...floor, message_id: 'm20', floor: 20};
  const oldSnapshot = createStorylineSnapshot({subject_id: 'char_1', display_name: '沈清秋', branches: [branch(1), branch(2), branch(3)], created_at_floor_version: currentFloor});
  const sibling = createStorylineSnapshot({subject_id: 'char_2', display_name: '林黛玉', branches: [branch(1), branch(2), branch(3)], created_at_floor_version: currentFloor});
  const currentViews = {
    storyline_snapshots: [oldSnapshot, sibling],
    triggered_snapshots: [{subject_id: 'char_1', status: 'active', triggered: [{reaction_concept: 'nausea', event_ids: ['event-1']}]}],
    storyline_delivery_records: [],
  };
  const previousViews = {storyline_snapshots: [], triggered_snapshots: [], storyline_delivery_records: []};
  const viewReads = [];
  let designCalls = 0;
  let writes = 0;
  const runtime = createProjectionStorylineRuntime({
    analyzer: {generateStoryline: async () => {
      designCalls += 1;
      return JSON.stringify({branches: [
        {...branch(designCalls * 10 + 1), title: `新支线${designCalls}-1`},
        {...branch(designCalls * 10 + 2), title: `新支线${designCalls}-2`},
        {...branch(designCalls * 10 + 3), title: `新支线${designCalls}-3`},
      ]});
    }},
    getProjectionViews: async options => {
      viewReads.push(options);
      return Number(options.endpointIndex) === 0 ? previousViews : currentViews;
    },
    saveProjectionStorylineSnapshotBatch: async ({snapshots}) => {
      writes += 1;
      currentViews.storyline_snapshots = [sibling, ...snapshots];
      return {status: 'appended'};
    },
    resolveCurrentFloor: async () => ({index: 1, version: currentFloor}),
    getChatId: () => 'chat',
  });
  const inputs = {floor: {index: 1, version: currentFloor}, trackingSubjects: {char_1: {character_id: 'char_1', display_name: '沈清秋'}}};

  await runtime.settled({inputs, settled: true, generation: 'g1'});
  assert.equal(designCalls, 1);
  assert.equal(writes, 1);
  assert.equal(currentViews.storyline_snapshots.find(item => item.subject_id === 'char_1').branches[0].title, '新支线1-1');
  assert.equal(currentViews.storyline_snapshots.find(item => item.subject_id === 'char_2').snapshot_id, sibling.snapshot_id);

  await runtime.settled({inputs, settled: true, generation: 'g2'});
  assert.equal(designCalls, 2);
  assert.equal(writes, 2);
  assert.equal(currentViews.storyline_snapshots.find(item => item.subject_id === 'char_1').branches[0].title, '新支线2-1');
  assert.equal(currentViews.storyline_snapshots.find(item => item.subject_id === 'char_2').snapshot_id, sibling.snapshot_id);
  assert.ok(viewReads.some(options => Number(options.endpointIndex) === 0 && Number(options.endpointFloor) === 20));
});

test('same-Floor submission receipts are not prior evidence for the Floor being settled', async () => {
  const previousFloor = {...floor, message_id: 'm19', floor: 19, content_hash: 'hash-19'};
  const currentFloor = {...floor, message_id: 'm20', floor: 20};
  const previousCandidates = createStorylineSnapshot({subject_id: 'char_1', display_name: '沈清秋', branches: [branch(1), branch(2), branch(3)], created_at_floor_version: previousFloor});
  const previousSnapshot = applyStorylineJudge(previousCandidates, {branch_id: previousCandidates.branches[0].branch_id});
  const currentSnapshot = createStorylineSnapshot({...previousSnapshot, created_at_floor_version: currentFloor});
  const previousViews = {storyline_snapshots: [previousSnapshot], triggered_snapshots: [], storyline_delivery_records: []};
  const currentViews = {
    storyline_snapshots: [currentSnapshot],
    triggered_snapshots: [{subject_id: 'char_1', status: 'active', triggered: [{reaction_concept: 'nausea', event_ids: ['event-1']}]}],
    storyline_delivery_records: [{kind: 'submission', subject_id: 'char_1', response_id: 'generation-current', context_fingerprint: 'ctx-current', floor_version: currentFloor, created_at_floor_version: currentFloor}],
  };
  let responseReceipts = 0;
  const runtime = createProjectionStorylineRuntime({
    analyzer: {generateStoryline: async () => JSON.stringify({action: 'stay'})},
    getProjectionViews: async options => Number(options.endpointIndex) === 0 ? previousViews : currentViews,
    saveProjectionStorylineSnapshotBatch: async () => { throw new Error('UNEXPECTED_SNAPSHOT_WRITE'); },
    saveProjectionStorylineDelivery: async ({record}) => { if (record.kind === 'response') responseReceipts += 1; return {status: 'appended'}; },
    resolveCurrentFloor: async () => ({index: 1, version: currentFloor}),
    getChatId: () => 'chat',
  });
  await runtime.settled({settled: true, inputs: {floor: {index: 1, version: currentFloor}, trackingSubjects: {char_1: {character_id: 'char_1', display_name: '沈清秋'}}}, responseId: 'body-current'});
  assert.equal(responseReceipts, 0);
  assert.equal(currentViews.storyline_snapshots[0].valid_body_count, 0);
});

test('same-Floor terminal storyline state is not revived by a still-active trigger', async () => {
  const currentFloor = {...floor, message_id: 'm20', floor: 20};
  const terminal = emptyStorylineSnapshot({subject_id: 'char_1', display_name: '沈清秋', created_at_floor_version: currentFloor});
  const currentViews = {
    storyline_snapshots: [terminal],
    triggered_snapshots: [{subject_id: 'char_1', status: 'active', triggered: [{reaction_concept: 'nausea', event_ids: ['event-1']}]}],
    storyline_delivery_records: [],
  };
  const previousViews = {storyline_snapshots: [], triggered_snapshots: [], storyline_delivery_records: []};
  let designCalls = 0;
  const runtime = createProjectionStorylineRuntime({
    analyzer: {generateStoryline: async () => { designCalls += 1; return JSON.stringify({branches: [branch(1), branch(2), branch(3)]}); }},
    getProjectionViews: async options => Number(options.endpointIndex) === 0 ? previousViews : currentViews,
    saveProjectionStorylineSnapshotBatch: async () => { throw new Error('UNEXPECTED_SNAPSHOT_WRITE'); },
    resolveCurrentFloor: async () => ({index: 1, version: currentFloor}),
    getChatId: () => 'chat',
  });
  await runtime.settled({settled: true, inputs: {floor: {index: 1, version: currentFloor}, trackingSubjects: {char_1: {character_id: 'char_1', display_name: '沈清秋'}}}});
  assert.equal(designCalls, 0);
  assert.equal(currentViews.storyline_snapshots[0].status, 'terminated');
});

test('storyline cancellation aborts the API request and does not write a snapshot', async () => {
  let receivedSignal = null;
  let writes = 0;
  const views = {storyline_snapshots: [], triggered_snapshots: [{subject_id: 'char_1', status: 'active', triggered: [{reaction_concept: 'nausea'}]}], storyline_delivery_records: []};
  const runtime = createProjectionStorylineRuntime({
    analyzer: {generateStoryline: async ({signal}) => {
      receivedSignal = signal;
      await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('REQUEST_ABORTED'), {code: 'REQUEST_ABORTED'})), {once: true});
      });
    }},
    getProjectionViews: async () => views,
    saveProjectionStorylineSnapshotBatch: async () => { writes += 1; return {status: 'appended'}; },
    resolveCurrentFloor: async () => ({index: 0, version: floor}),
    getChatId: () => 'chat',
  });
  const pending = runtime.settled({settled: true, inputs: {floor: {index: 0, version: floor}, trackingSubjects: {char_1: {character_id: 'char_1', display_name: '沈清秋'}}}});
  await new Promise(resolve => setImmediate(resolve));
  const cancellation = runtime.cancelStoryline();
  assert.equal(cancellation.status, 'cancelled');
  await pending;
  assert.equal(receivedSignal?.aborted, true);
  assert.equal(writes, 0);
});

test('storyline cancellation stops the current multi-subject settle before starting another request', async () => {
  let calls = 0;
  const views = {
    storyline_snapshots: [],
    triggered_snapshots: [
      {subject_id: 'char_1', status: 'active', triggered: [{reaction_concept: 'nausea'}]},
      {subject_id: 'char_2', status: 'active', triggered: [{reaction_concept: 'fatigue'}]},
    ],
    storyline_delivery_records: [],
  };
  const runtime = createProjectionStorylineRuntime({
    analyzer: {generateStoryline: async ({signal}) => {
      calls += 1;
      await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('REQUEST_ABORTED'), {code: 'REQUEST_ABORTED'})), {once: true}));
    }},
    getProjectionViews: async () => views,
    saveProjectionStorylineSnapshotBatch: async () => ({status: 'appended'}),
    resolveCurrentFloor: async () => ({index: 0, version: floor}),
    getChatId: () => 'chat',
  });
  const pending = runtime.settled({settled: true, inputs: {
    floor: {index: 0, version: floor},
    trackingSubjects: {char_1: {character_id: 'char_1', display_name: '沈清秋'}, char_2: {character_id: 'char_2', display_name: '林黛玉'}},
  }});
  await new Promise(resolve => setImmediate(resolve));
  runtime.cancelStoryline();
  const result = await pending;
  assert.equal(result.status, 'cancelled');
  assert.equal(calls, 1);
});

test('storyline design receives readable narrative/world context without internal identities', async () => {
  let prompt = '';
  const diagnostics = createRuntimeDiagnostics({getChatId: () => 'chat'});
  const views = {storyline_snapshots: [], triggered_snapshots: [{subject_id: 'char_1', status: 'active', triggered: [{reaction_concept: 'nausea', event_ids: ['event-secret']}]}], storyline_delivery_records: []};
  const runtime = createProjectionStorylineRuntime({
    analyzer: {generateStoryline: async input => { prompt = input.messages.map(message => message.content).join('\n'); return JSON.stringify({branches: [branch(1), branch(2), branch(3)]}); }},
    getProjectionViews: async () => views,
    saveProjectionStorylineSnapshotBatch: async ({snapshots}) => { views.storyline_snapshots = snapshots; return {status: 'appended'}; },
    resolveCurrentFloor: async () => ({index: 0, version: floor}),
    getChatId: () => 'chat',
    diagnostics,
  });
  await runtime.settled({settled: true, inputs: {
    floor: {index: 0, version: floor},
    trackingSubjects: {char_1: {character_id: 'char_1', display_name: '沈清秋', aliases: ['清秋']}},
    characterProfiles: {char_1: {display_name: '沈清秋', medical_note: '容易胃部不适', cycle_id: 'cycle-secret', source_id: 'source-secret'}},
    worldModel: {setting: '医院附近', event_id: 'event-secret', rule_id: 'rule-secret', cycle_id: 'cycle-secret'},
    worldbooks: [{name: '医疗世界书', entries: [{content: '医院可以进行常规检查。'}]}],
    externalMemory: [{enabled: true, available: true, content_available: true, read_status: 'success', label: '外部记忆', items: [{content: '曾经有过胃部不适记录。'}]}],
    otherReferenceData: {known_characters: [{display_name: '柳如烟', aliases: ['如烟']}]},
    storyContext: '沈清秋因胃部不适准备去医院。',
  }});
  assert.match(prompt, /沈清秋/);
  assert.match(prompt, /胃部不适|医院附近/);
  assert.match(prompt, /恶心/);
  assert.doesNotMatch(prompt, /医院可以进行常规检查/);
  assert.match(prompt, /曾经有过胃部不适记录/);
  assert.match(prompt, /柳如烟/);
  assert.match(prompt, /- 已知人物：\n  - 角色名：柳如烟\n    昵称：如烟/);
  assert.doesNotMatch(prompt, /- 已知人物：角色名：/);
  assert.doesNotMatch(prompt, /； aliases：；/);
  assert.doesNotMatch(prompt, /char_1|cycle-secret|event-secret|source-secret|rule-secret/);
  const trace = diagnostics.getStorylineDiagnostics({chat_id: 'chat', floor_version: floor});
  assert.ok(trace.sequence.some(item => item.stage === 'DESIGN_REQUEST' && item.status === 'completed'));
  assert.ok(trace.sequence.some(item => item.stage === 'DESIGN_PARSE' && item.status === 'succeeded'));
  const promptBuilt = trace.sequence.findIndex(item => item.stage === 'PROMPT_BUILD' && item.status === 'succeeded');
  const apiStarted = trace.sequence.findIndex(item => item.stage === 'API_REQUEST' && item.status === 'started');
  const apiCompleted = trace.sequence.find(item => item.stage === 'API_REQUEST' && item.status === 'completed');
  const designParsed = trace.sequence.findIndex(item => item.stage === 'DESIGN_PARSE' && item.status === 'succeeded');
  assert.ok(promptBuilt >= 0 && apiStarted > promptBuilt && designParsed > apiStarted);
  assert.ok(apiCompleted);
  assert.equal(apiCompleted.api_assignment, 'projection');
  assert.equal(apiCompleted.projection_route, 'projection');
  assert.deepEqual(apiCompleted.message_summary.role_order, ['system', 'system', 'assistant', 'user']);
  assert.equal(apiCompleted.response.shape, 'object');
  assert.ok(apiCompleted.response.length > 0);
  const writeSucceeded = trace.sequence.findIndex(item => item.stage === 'SNAPSHOT_WRITE' && item.status === 'succeeded');
  const readbackStarted = trace.sequence.findIndex(item => item.stage === 'SNAPSHOT_READBACK' && item.status === 'started');
  assert.ok(writeSucceeded >= 0 && readbackStarted > writeSucceeded);
  assert.ok(trace.sequence.some(item => item.stage === 'SNAPSHOT_READBACK' && item.status === 'succeeded'));
  assert.equal(JSON.stringify(trace).includes('胃部不适准备去医院'), false);
});

test('storyline signals keep matched event evidence under each signal and hide profile evidence', async () => {
  let prompt = '';
  const trigger = {
    subject_id: 'char_1',
    status: 'active',
    triggered: [
      {reaction_concept: 'appetite_change', event_ids: ['event-appetite']},
      {reaction_concept: 'nausea', event_ids: ['event-nausea']},
    ],
  };
  const views = {storyline_snapshots: [], triggered_snapshots: [trigger], storyline_delivery_records: []};
  const runtime = createProjectionStorylineRuntime({
    analyzer: {generateStoryline: async input => { prompt = input.messages.map(message => message.content).join('\n'); return JSON.stringify({branches: [branch(1), branch(2), branch(3)]}); }},
    getProjectionViews: async () => views,
    saveProjectionStorylineSnapshotBatch: async ({snapshots}) => { views.storyline_snapshots = snapshots; return {status: 'appended'}; },
    resolveCurrentFloor: async () => ({index: 0, version: floor}),
    getChatId: () => 'chat',
  });
  await runtime.settled({settled: true, inputs: {
    floor: {index: 0, version: floor},
    trackingSubjects: {char_1: {character_id: 'char_1', display_name: '沈清秋'}},
    characterProfiles: {char_1: {display_name: '沈清秋', evidence: ['旧暴露证据，不属于人物资料'], medical_note: '容易胃部不适', health: {evidence: ['嵌套旧证据，也不属于人物资料']}}},
    events: [
      {event_id: 'event-appetite', source_evidence: [{text: '最近几日食欲明显变化。'}]},
      {event_id: 'event-nausea', source_evidence: [{text: '闻到油腻气味后出现恶心。'}]},
    ],
  }});
  assert.doesNotMatch(prompt, /旧暴露证据，不属于人物资料/);
  assert.doesNotMatch(prompt, /嵌套旧证据，也不属于人物资料/);
  assert.match(prompt, /- 食欲变化\n  证据：最近几日食欲明显变化。/);
  assert.match(prompt, /- 恶心\n  证据：闻到油腻气味后出现恶心。/);
  assert.ok(prompt.indexOf('食欲变化\n  证据：最近几日食欲明显变化。') < prompt.indexOf('恶心\n  证据：闻到油腻气味后出现恶心。'));
  assert.doesNotMatch(prompt, /event-appetite|event-nausea/);
});

test('Event Analysis run boundary persists a name-only not-pregnant candidate as a canonical Event', async () => {
  const target = {index: 0, swipeId: 0, version: {...floor, chat_id: 'chat-a'}};
  const registry = {schema_version: 1, entities: {'char_000001': {character_id: 'char_000001', display_name: '沈清秋', aliases: ['清秋']}}};
  const analysisInput = {
    character_registry: registry,
    current_floor: {narrative: '沈清秋到医院检查，结果确认未怀孕。'},
    story_time: null,
    participant_aggregations: [{subject_id: 'char_000001', cycle_id: 'cycle-1', status: 'succeeded'}],
    tracking_windows: [],
    pregnancy_lifecycle_timeline: {release_records: []},
    existing_events: [],
  };
  let persisted = null;
  const finalFloor = {floor_version: target.version, analysis: {}, events: [], character_registry: registry};
  const coordinator = createCharacterEventAnalysis({
    analyzer: {analyzeFloor: async () => ({schema_version: 1, events: [], not_pregnant_candidates: [{display_name: '清秋', observation: '结果确认未怀孕'}]})},
    commitAnalysis: (previous, next) => next,
    commitFloorPatch: async (_target, _owner, patch) => { persisted = patch; finalFloor.events = patch.events; finalFloor.analysis = patch.analysis; finalFloor.character_registry = patch.character_registry; },
    assertExecutionTargetCurrent: async () => {},
    assertExecutionCurrent: () => {},
    assertToken: () => {},
    dependencyHashForTarget: async () => 'dep',
    invalidateExecution: () => {},
    requestAbortedError: () => new Error('ABORTED'),
    getFloor: () => finalFloor,
    resolveFloorAtIndex: async () => target,
    resolveCurrentBioWeaveFloor: async () => target,
    resolveCharacterRegistryAtOrBefore: async () => ({character_registry: registry}),
    collectActiveBusinessData: async () => ({current_floor: {version: target.version}, current_state_status: 'ready', tracking_subjects: {'char_000001': {character_id: 'char_000001', display_name: '沈清秋'}}}),
    collectCurrentFloorStates: async () => [{index: 0, version: target.version}],
    refreshTrackingRegistry: async () => ({character_registry: registry}),
    maybeCreateSnapshot: async () => {},
    clearInvalidatedFloor: () => {},
    nextPersistenceInvocationId: () => 'event-test',
    emitPersistenceTrace: () => {},
    persistenceTraceContext: () => ({}),
    healthAssessment: null,
  });
  const result = await coordinator.runEventAttempt({
    target,
    token: {chatId: 'chat-a'},
    execution: {analysis_execution_id: 'analysis-test', attempt: 1, started_at: new Date().toISOString(), controller: new AbortController(), reason: 'test'},
    analysisInput,
    finalWorldModel: {},
    savedAnalysis: null,
    dependencyHash: 'dep',
  });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].type, 'pregnancy_lifecycle');
  assert.equal(result.events[0].state_fact.subject_id, 'char_000001');
  assert.equal(result.events[0].state_fact.payload.cycle_id, 'cycle-1');
  assert.equal(persisted.events[0].state_fact.subject_id, 'char_000001');
});

test('event AI boundary accepts only explicit name-based not-pregnant candidates', () => {
  const result = parseEventAnalysisResponse({schema_version: 1, events: [], not_pregnant_candidates: [{display_name: '沈清秋', aliases: ['清秋'], observation: '检查后确认未怀孕'}]}, {deferIdentityValidation: true});
  assert.equal(result.not_pregnant_candidates[0].display_name, '沈清秋');
  assert.throws(() => parseEventAnalysisResponse({schema_version: 1, events: [], not_pregnant_candidates: [{display_name: '沈清秋', cycle_id: 'cycle-1'}]}, {deferIdentityValidation: true}));
});

const candidateInput = (overrides = {}) => ({
  character_registry: {schema_version: 1, entities: {
    'char_000001': {character_id: 'char_000001', display_name: '沈清秋', aliases: ['清秋']},
    ...(overrides.entities ?? {}),
  }},
  current_floor: {narrative: '沈清秋到医院检查，结果确认未怀孕。'},
  participant_aggregations: [{subject_id: 'char_000001', cycle_id: 'cycle-1', status: 'succeeded'}],
  tracking_windows: [],
  pregnancy_lifecycle_timeline: {release_records: []},
  ...overrides,
});

test('host binds a unique name/alias and one active cycle into canonical not-pregnant Event', () => {
  const result = materializeNotPregnantCandidates([{display_name: '清秋', observation: '结果确认未怀孕'}], candidateInput(), floor);
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].state_fact.subject_id, 'char_000001');
  assert.equal(result.events[0].state_fact.payload.cycle_id, 'cycle-1');
});

test('host rejects zero/many subjects, missing/many/released cycles, and ambiguous conclusions', () => {
  const candidate = [{display_name: '沈清秋', observation: '结果确认未怀孕'}];
  assert.equal(materializeNotPregnantCandidates([{display_name: '清秋', observation: '结果确认未怀孕'}], candidateInput({entities: {'char_000002': {character_id: 'char_000002', display_name: '林清秋', aliases: ['清秋']}}}), floor).events.length, 0);
  assert.equal(materializeNotPregnantCandidates([{display_name: '不存在', observation: '结果确认未怀孕'}], candidateInput(), floor).events.length, 0);
  assert.equal(materializeNotPregnantCandidates(candidate, candidateInput({participant_aggregations: []}), floor).events.length, 0);
  assert.equal(materializeNotPregnantCandidates(candidate, candidateInput({participant_aggregations: [{subject_id: 'char_000001', cycle_id: 'a', status: 'succeeded'}, {subject_id: 'char_000001', cycle_id: 'b', status: 'succeeded'}]}), floor).events.length, 0);
  assert.equal(materializeNotPregnantCandidates(candidate, candidateInput({pregnancy_lifecycle_timeline: {release_records: [{action: 'cycle-lock-released', subject_id: 'char_000001', cycle_id: 'cycle-1'}]}}), floor).events.length, 0);
  assert.equal(materializeNotPregnantCandidates([{display_name: '清秋', observation: '可能没有吧'}], candidateInput(), floor).events.length, 0);
});
