import test from 'node:test';
import assert from 'node:assert/strict';
import {applyStorylineJudge, buildStorylineContextPrompt, buildStorylineResponseId, createStorylineSnapshot, emptyStorylineSnapshot, recordStorylineBody, setStorylineProgressionEvent, storylineJudgeDue, storylinePhase} from '../core/projection-storyline.js';
import {buildStorylineDesignMessages, buildStorylineJudgeMessages, buildStorylineProgressionMessages, parseStorylineDesignResponse, parseStorylineJudgeResponse, parseStorylineProgressionResponse} from '../ai/projection-storyline.js';
import {createProjectionStorylineRuntime} from '../runtime/projection-storyline-runtime.js';
import {parseEventAnalysisResponse} from '../ai/analyzer.js';
import {materializeNotPregnantCandidates} from '../runtime/character-event-analysis.js';
import {createCharacterEventAnalysis} from '../runtime/character-event-analysis.js';
import {createRuntimeDiagnostics} from '../runtime/diagnostics.js';

const floor = {chat_id: 'chat', message_id: 'm1', floor: 20, swipe_id: 0, content_hash: 'hash', message_version: '1'};
const branch = n => ({title: `支线${n}`, premise: '因肠胃不适就医', nodes: [{title: '挂号', objective: '创造就医条件', completion_signal: '已挂号', conclusion_goal: '为后续问诊留下自然入口'}, {title: '检查', objective: '完成检查', completion_signal: '已检查', conclusion_goal: '根据检查过程引出新的选择'}, {title: '结论', objective: '形成检查结论', completion_signal: '已有结论', conclusion_goal: '等待角色决定下一步行动'}]});

test('storyline design exposes display name but not internal ids', () => {
  const messages = buildStorylineDesignMessages({displayName: '沈清秋', aliases: ['清秋']});
  const prompt = messages.map(message => message.content).join('\n');
  assert.match(prompt, /姓名: 沈清秋/);
  assert.doesNotMatch(prompt, /subject_id|cycle_id/);
  const snapshot = parseStorylineDesignResponse(JSON.stringify({branches: [branch(1), branch(2), branch(3)]}), {subjectId: 'char_1', displayName: '沈清秋', floorVersion: floor});
  assert.equal(snapshot.branches.length, 3);
  assert.equal(snapshot.branches[0].nodes.length, 3);
});

test('legacy branch conclusion goals are read as node-level fallback without surviving in normalized snapshots', () => {
  const legacy = {
    subject_id: 'char_legacy',
    display_name: '旧快照人物',
    status: 'selected',
    selected_branch_id: 'legacy-branch',
    current_node_index: 0,
    branches: [{
      branch_id: 'legacy-branch',
      title: '旧支线',
      premise: '旧格式支线',
      nodes: [
        {title: '节点一', objective: '旧节点一', completion_signal: '信号一'},
        {title: '节点二', objective: '旧节点二', completion_signal: '信号二', conclusion_goal: '节点二自有目标'},
        {title: '节点三', objective: '旧节点三', completion_signal: '信号三'},
      ],
      conclusion_goal: '旧支线目标',
    }],
    created_at_floor_version: floor,
  };
  const normalized = createStorylineSnapshot(legacy);
  assert.equal(normalized.branches[0].conclusion_goal, undefined);
  assert.equal(normalized.branches[0].nodes[0].conclusion_goal, '旧支线目标');
  assert.equal(normalized.branches[0].nodes[1].conclusion_goal, '节点二自有目标');
  assert.equal(normalized.branches[0].nodes[2].conclusion_goal, '旧支线目标');
});

test('legacy selected snapshots that passed the final cursor remain readable as the last selected node', () => {
  const legacy = {
    subject_id: 'char_legacy_cursor',
    display_name: '旧游标人物',
    status: 'selected',
    selected_branch_id: 'legacy-branch',
    current_node_index: 3,
    branches: [{
      branch_id: 'legacy-branch',
      title: '旧支线',
      premise: '旧格式支线',
      nodes: [
        {title: '节点一', objective: '目标一', completion_signal: '信号一', conclusion_goal: '目标一结论'},
        {title: '节点二', objective: '目标二', completion_signal: '信号二', conclusion_goal: '目标二结论'},
        {title: '节点三', objective: '目标三', completion_signal: '信号三', conclusion_goal: '目标三结论'},
      ],
    }],
    created_at_floor_version: floor,
  };
  const normalized = createStorylineSnapshot(legacy);
  assert.equal(normalized.current_node_index, 2);
  assert.equal(normalized.selected_node_id, 'node_3');
  assert.equal(normalized.selected_node_status, 'active');
});

test('selected node identity backfills its index when legacy index is absent', () => {
  const legacy = {
    subject_id: 'char_legacy_node',
    display_name: '旧节点人物',
    status: 'selected',
    selected_branch_id: 'legacy-branch',
    selected_node_id: 'node_2',
    branches: [{
      branch_id: 'legacy-branch',
      title: '旧支线',
      premise: '旧格式支线',
      nodes: [
        {title: '节点一', objective: '目标一', completion_signal: '信号一', conclusion_goal: '目标一结论'},
        {title: '节点二', objective: '目标二', completion_signal: '信号二', conclusion_goal: '目标二结论'},
        {title: '节点三', objective: '目标三', completion_signal: '信号三', conclusion_goal: '目标三结论'},
      ],
    }],
    created_at_floor_version: floor,
  };
  const normalized = createStorylineSnapshot(legacy);
  assert.equal(normalized.selected_node_id, 'node_2');
  assert.equal(normalized.current_node_index, 1);
});

test('storyline design and judge scope event references to the target subject', () => {
  const eventData = [
    {type: 'physical_symptom', status: 'confirmed', state_fact: {subject_id: 'char_a', payload: {symptom: {description: '甲的症状'}}}, participants: [{character_id: 'char_a', display_name: '甲'}]},
    {type: 'physical_symptom', status: 'confirmed', state_fact: {subject_id: 'char_b', payload: {symptom: {description: '乙的症状'}}}, participants: [{character_id: 'char_b', display_name: '乙'}]},
  ];
  const design = buildStorylineDesignMessages({displayName: '甲', targetSubjectId: 'char_a', eventData});
  const snapshot = createStorylineSnapshot({subject_id: 'char_a', display_name: '甲', status: 'candidates', branches: [branch(1), branch(2), branch(3)], created_at_floor_version: floor});
  const judge = buildStorylineJudgeMessages({snapshot, targetSubjectId: 'char_a', eventData});
  for (const messages of [design, judge]) {
    const prompt = messages.map(message => message.content).join('\n');
    assert.match(prompt, /甲的症状/);
    assert.doesNotMatch(prompt, /乙的症状|char_a|char_b/);
  }
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
  assert.match(messages[0].content, /【二、事实与人物边界】/);
  assert.match(messages[0].content, /【四、单条支线内的候选节点】/);
  assert.match(messages[0].content, /【七、输出格式与检查】/);
  assert.match(messages[0].content, /每条支线恰好包含 3 个节点/);
  assert.match(messages[0].content, /只输出合法 JSON/);
  assert.match(messages[0].content, /不使用 Markdown 代码围栏/);
  assert.match(messages[0].content, /"branches"/);
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
  assert.match(messages[3].content, /【目标人物】[\s\S]*本块用途：限定本次支线分析的叙事对象[\s\S]*姓名: 沈清秋/);
  assert.match(messages[3].content, /【人物资料】[\s\S]*容易胃部不适/);
  assert.match(messages[3].content, /【已触发生理信号】[\s\S]*恶心/);
  assert.ok(messages[3].content.indexOf('【人物资料】') < messages[3].content.indexOf('【已触发生理信号】'));
  assert.match(messages[3].content, /【任务要求】[\s\S]*设计恰好 3 条简短、自然且互不重复的剧情支线/);
  assert.match(messages[0].content, /不得将推测写成客观事实，也不得预设检查结果或最终真相/);
  const all = messages.map(message => message.content).join('\n');
  assert.doesNotMatch(all, /JSON\.stringify|"world_model"|"setting"|char_1|cycle-secret|event-secret/);
});

test('storyline multiline prompt blocks remove source indentation without losing interpolated content', () => {
  const messages = buildStorylineDesignMessages({
    displayName: '沈清秋',
    characterContext: 'medical_note：容易胃部不适',
    recentStory: '沈清秋准备前往医馆。',
  });
  assert.equal(messages[0].content.startsWith('【任务定位】'), true);
  assert.match(messages[0].content, /"branches": \[[\s\S]*\]\n\}$/);
  assert.doesNotMatch(messages[0].content, /^ {12}/mu);
  assert.match(messages.find(message => message.role === 'user').content, /【人物资料】[\s\S]*容易胃部不适/);
});

test('storyline design parser rejects branches with fewer than three nodes', () => {
  const twoNodeBranch = {...branch(1), nodes: branch(1).nodes.slice(0, 2)};
  assert.throws(
    () => parseStorylineDesignResponse(JSON.stringify({branches: [twoNodeBranch, branch(2), branch(3)]}), {subjectId: 'char_1', displayName: '沈清秋', floorVersion: floor}),
    /STORYLINE_RESPONSE|must_be_three_to_five/,
  );
});

test('storyline design parser rejects an otherwise complete branch with an incomplete node', () => {
  const incompleteBranch = {
    ...branch(1),
    nodes: branch(1).nodes.map((node, index) => index === 1 ? {...node, completion_signal: ''} : node),
  };
  assert.throws(
    () => parseStorylineDesignResponse(JSON.stringify({branches: [incompleteBranch, branch(2), branch(3)]}), {subjectId: 'char_1', displayName: '沈清秋', floorVersion: floor}),
    /STORYLINE_DESIGN_NODE_FIELDS|storyline_snapshot\.node_fields:required/,
  );
});

test('storyline design parser rejects branch-level conclusion goals', () => {
  const legacyBranch = {...branch(1), conclusion_goal: '旧支线目标', nodes: branch(1).nodes.map(node => ({...node, conclusion_goal: ''}))};
  assert.throws(
    () => parseStorylineDesignResponse(JSON.stringify({branches: [legacyBranch, branch(2), branch(3)]}), {subjectId: 'char_1', displayName: '沈清秋', floorVersion: floor}),
    /STORYLINE_DESIGN_NODE_FIELDS/,
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
  assert.match(messages[1].content, /物种:[\s\S]*名称: 人类/);
  assert.match(messages[1].content, /生理类型:\n\s+- 名称: 女性/);
  assert.match(messages[1].content, /已知生殖能力:[\s\S]*可承载妊娠: 是/);
  assert.match(messages[1].content, /物种:[\s\S]*\n  - 名称: 人类[\s\S]*\n    生理类型:/);
  assert.doesNotMatch(messages[1].content, /event-secret/);
  assert.doesNotMatch(messages[1].content, /\n\s*-\s*\n/);
  assert.doesNotMatch(messages[1].content, /世界中存在可进行常规检查的医馆|worldbook-secret|entry-secret/);
  assert.match(messages[1].content, /已知人物:\n  - 角色名: 柳如烟\n    昵称: 如烟/);
  assert.doesNotMatch(messages[1].content, /祁鸢|觉心/);
  assert.doesNotMatch(messages[1].content, /- 已知人物:角色名:/);
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
  assert.match(prompt, /- 支线 1:\n\s+支线编号:/);
  assert.match(prompt, /节点:\n\s+- 节点编号:/);
  assert.match(prompt, /完成信号:/);
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

test('storyline judge uses configured recent-story context instead of cadence bodies', () => {
  const snapshot = createStorylineSnapshot({subject_id: 'char_1', display_name: '沈清秋', branches: [branch(1), branch(2), branch(3)], created_at_floor_version: floor});
  const messages = buildStorylineJudgeMessages({
    snapshot,
    body: '正文一\n正文二',
    recentStory: [
      {floor: 8, role: 'assistant', content: '设置读取的第八楼'},
      {floor: 9, role: 'assistant', content: '设置读取的第九楼'},
    ],
  });
  const prompt = messages.map(message => message.content).join('\n');
  assert.match(prompt, /设置读取的第八楼/);
  assert.match(prompt, /设置读取的第九楼/);
  assert.doesNotMatch(prompt, /正文一/);
  assert.doesNotMatch(prompt, /正文二/);
});

test('storyline judge prompt keeps JSON response contract aligned with parser', () => {
  const snapshot = createStorylineSnapshot({subject_id: 'char_1', display_name: '沈清秋', branches: [branch(1), branch(2), branch(3)], created_at_floor_version: floor});
  const selection = buildStorylineJudgeMessages({snapshot, body: '沈清秋挂号后进入检查室.'});
  assert.match(selection.map(message => message.content).join('\n'), /\{"branch_id":"支线编号","node_id":"节点编号"\}.*\{"branch_id":null,"node_id":null\}/);
  const selected = parseStorylineJudgeResponse(JSON.stringify({branch_id: snapshot.branches[0].branch_id, node_id: snapshot.branches[0].nodes[1].node_id}), snapshot);
  const progression = buildStorylineJudgeMessages({snapshot: selected, body: '沈清秋完成检查。'});
  const progressionText = progression.map(message => message.content).join('\n');
  assert.match(progressionText, /\{"action":"stay"\}、\{"action":"complete"\} 或 \{"action":"awaiting_outcome"\}/);
  assert.ok(progressionText.indexOf('【人物资料】') < progressionText.indexOf('【已触发生理信号】'));
  assert.deepEqual(progression.map(message => message.role), ['system', 'assistant', 'user']);
  assert.deepEqual(parseStorylineJudgeResponse(JSON.stringify({action: 'stay'}), selected), selected);
});

test('selection is one-way and progression cannot switch branch', () => {
  const snapshot = createStorylineSnapshot({subject_id: 'char_1', display_name: '沈清秋', branches: [branch(1), branch(2), branch(3)], created_at_floor_version: floor});
  const selected = parseStorylineJudgeResponse(JSON.stringify({branch_id: snapshot.branches[1].branch_id, node_id: snapshot.branches[1].nodes[2].node_id}), snapshot);
  assert.equal(selected.status, 'selected');
  assert.equal(selected.branches.length, 1);
  assert.equal(selected.selected_branch_id, snapshot.branches[1].branch_id);
  assert.throws(() => parseStorylineJudgeResponse(JSON.stringify({branch_id: snapshot.branches[0].branch_id, node_id: snapshot.branches[0].nodes[0].node_id}), selected));
  assert.equal(selected.selected_node_id, snapshot.branches[1].nodes[2].node_id);
});

test('selection rejects partial and cross-branch node selections', () => {
  const snapshot = createStorylineSnapshot({subject_id: 'char_1', display_name: '沈清秋', branches: [branch(1), branch(2), branch(3)], created_at_floor_version: floor});
  const branchOne = snapshot.branches[0];
  assert.throws(() => parseStorylineJudgeResponse(JSON.stringify({branch_id: branchOne.branch_id}), snapshot), /STORYLINE_JUDGE_PARTIAL_SELECTION/);
  assert.throws(() => parseStorylineJudgeResponse(JSON.stringify({branch_id: branchOne.branch_id, node_id: 'unknown-node'}), snapshot), /STORYLINE_JUDGE_UNKNOWN_NODE/);
  assert.throws(() => parseStorylineJudgeResponse(JSON.stringify({branch_id: 'unknown-branch', node_id: branchOne.nodes[0].node_id}), snapshot), /STORYLINE_JUDGE_UNKNOWN_BRANCH/);
});

test('selected branch keeps one chosen node and records its completion', () => {
  const snapshot = createStorylineSnapshot({subject_id: 'char_1', display_name: '沈清秋', branches: [branch(1), branch(2), branch(3)], created_at_floor_version: floor});
  const selected = applyStorylineJudge(snapshot, {branch_id: snapshot.branches[0].branch_id, node_id: snapshot.branches[0].nodes[1].node_id});
  const afterNodes = applyStorylineJudge(selected, {action: 'complete'});
  assert.equal(afterNodes.status, 'selected');
  assert.equal(afterNodes.current_node_index, 1);
  assert.equal(afterNodes.selected_node_id, afterNodes.branches[0].nodes[1].node_id);
  assert.equal(afterNodes.selected_node_status, 'completed');
  const prompt = buildStorylineContextPrompt(afterNodes);
  assert.match(prompt, /角色：沈清秋/);
  assert.match(prompt, /【候选剧情】/);
  assert.match(prompt, /【剧情调度】/);
  assert.match(prompt, /【场外推进】/);
  assert.match(prompt, /【叙事约束】/);
  assert.match(prompt, /【推进优先级】/);
  assert.match(prompt, /【事实边界】/);
  assert.match(prompt, /本轮只能选择一条支线启动，启动后保持该支线连续性，不得擅自切换至其他候选支线/);
  assert.doesNotMatch(prompt, /只能推进当前已选支线，不得切换/);
  assert.doesNotMatch(prompt, /当前目标：完成检查|完成信号：已检查|根据检查过程引出新的选择/);
  assert.match(prompt, /正在生成后续推进事件/);
  assert.match(prompt, /节点状态：已完成/);
  assert.match(prompt, /不得将症状、传闻、角色猜测或支线目标直接认定为怀孕事实/);
  assert.doesNotMatch(prompt, /下一节点/);
});

test('completed entry node accepts a generic same-branch progression event without reusing old node content', () => {
  const candidates = createStorylineSnapshot({subject_id: 'char_1', display_name: '沈清秋', branches: [branch(1), branch(2), branch(3)], created_at_floor_version: floor});
  const snapshot = applyStorylineJudge(candidates, {branch_id: candidates.branches[0].branch_id, node_id: candidates.branches[0].nodes[1].node_id});
  const completed = applyStorylineJudge(snapshot, {action: 'complete'});
  const next = setStorylineProgressionEvent(completed, {
    title: '线索进入下一阶段',
    guidance: '根据当前世界的关系与信息条件，让已留下的线索在跨越一段时间后自然产生新的影响。',
    completion_signal: '相关人物或环境出现可观察的新变化。',
    conclusion_goal: '为后续确认保留一个自然的行动入口。',
    created_at_floor_version: floor,
  });
  assert.equal(storylinePhase(next), 'progression_active');
  const prompt = buildStorylineContextPrompt(next);
  assert.match(prompt, /当前推进事件：线索进入下一阶段/);
  assert.match(prompt, /推进引导：根据当前世界/);
  assert.doesNotMatch(prompt, /当前目标：完成检查|完成信号：已检查/);
  assert.equal(next.progression_event.source_node_id, next.selected_node_id);
});

test('progression completion is not a terminal branch and awaiting outcome stops cadence', () => {
  const candidates = createStorylineSnapshot({subject_id: 'char_1', display_name: '沈清秋', branches: [branch(1), branch(2), branch(3)], created_at_floor_version: floor});
  const selected = applyStorylineJudge(candidates, {branch_id: candidates.branches[0].branch_id, node_id: candidates.branches[0].nodes[0].node_id});
  const completed = applyStorylineJudge(selected, {action: 'complete'});
  const active = setStorylineProgressionEvent(completed, {
    title: '新的阶段', guidance: '跨越若干剧情条件推进。', completion_signal: '出现阶段变化。', conclusion_goal: '引出后续信息入口。', created_at_floor_version: floor,
  });
  const bodies = recordStorylineBody(recordStorylineBody(active, 'r1'), 'r2');
  assert.equal(storylineJudgeDue(bodies), true);
  const waiting = applyStorylineJudge(bodies, {action: 'awaiting_outcome'});
  assert.equal(waiting.progression_event.status, 'awaiting_outcome');
  assert.equal(storylinePhase(waiting), 'awaiting_outcome');
  assert.equal(storylineJudgeDue(recordStorylineBody(waiting, 'r3')), false);
});

test('progression generation prompt is world-driven and parser keeps internal ids out of API output', () => {
  const candidates = createStorylineSnapshot({subject_id: 'char_1', display_name: '沈清秋', branches: [branch(1), branch(2), branch(3)], created_at_floor_version: floor});
  const selected = applyStorylineJudge(candidates, {branch_id: candidates.branches[0].branch_id, node_id: candidates.branches[0].nodes[0].node_id});
  const completed = applyStorylineJudge(selected, {action: 'complete'});
  const messages = buildStorylineProgressionMessages({snapshot: completed, recentStory: '已完成入口事件，正文进入新的场景。'});
  const prompt = messages.map(message => message.content).join('\n');
  assert.match(prompt, /新的因果来源|新的条件来源|人物选择、信息变化、关系、时间、环境、资源、制度或第三方行为/);
  assert.doesNotMatch(prompt, /必须采用医疗|必须采用固定 NPC|必须通过闲聊/);
  assert.doesNotMatch(prompt, /char_1|storyline_branch_|node_1/);
  const event = parseStorylineProgressionResponse(JSON.stringify({
    title: '线索自然扩散',
    guidance: '让已留下的线索在符合世界规则的关系与时间条件下逐步产生影响。',
    completion_signal: '出现可观察的新变化。',
    conclusion_goal: '为后续确认保留行动入口。',
  }), {snapshot: completed, floorVersion: {...floor, floor: 21, message_id: 'm21'}});
  assert.equal(event.status, 'active');
  assert.equal(event.source_node_id, completed.selected_node_id);
  assert.throws(() => parseStorylineProgressionResponse(JSON.stringify({title: 'x', guidance: 'y', completion_signal: 'z', conclusion_goal: 'q', character_id: 'char_1'}), {snapshot: completed, floorVersion: floor}), /STORYLINE_RESPONSE_FORBIDDEN/);
});

test('progression prompt keeps entry hypotheses unresolved and requires a genuinely new causal stage', () => {
  const candidates = createStorylineSnapshot({subject_id: 'char_1', display_name: '柳如烟', branches: [branch(1), branch(2), branch(3)], created_at_floor_version: floor});
  const selected = applyStorylineJudge(candidates, {branch_id: candidates.branches[0].branch_id, node_id: candidates.branches[0].nodes[0].node_id});
  const completed = applyStorylineJudge(selected, {action: 'complete'});
  const messages = buildStorylineProgressionMessages({
    snapshot: completed,
    recentStory: '入口场景已经结束，正文留下了尚未证实的疑问。',
    eventData: [
      {type: 'pregnancy_suspicion', status: 'probable', participants: [{character_id: 'char_1', display_name: '柳如烟'}], source_evidence: [{text: '仅为未决判断'}]},
      {type: 'medical_event', status: 'confirmed', participants: [{character_id: 'char_1', display_name: '柳如烟'}], source_evidence: [{text: '已完成一次问诊'}]},
    ],
  });
  const prompt = messages.map(message => message.content).join('\n');
  assert.match(prompt, /历史方向与证据边界|远期结论目标/);
  assert.match(prompt, /已经发生的问诊、调查、争执、判断、选择或处理，不得换个说法再来一遍|允许继续使用原有人物、地点和事件机制/);
  assert.match(prompt, /新的因果来源|新的条件来源/);
  assert.match(prompt, /明确结果|实际进展|重要变化/);
  assert.match(prompt, /未确认结论|未决线索/);
  assert.match(prompt, /probable|possible|suspected|怀疑|可能|未决/);
  assert.match(prompt, /入口节点结论目标（仅远期方向，禁止复述为当前内容）/);
  assert.match(prompt, /当前已确认事实|事件资料/);
  assert.doesNotMatch(prompt, /事件类型: pregnancy_suspicion/);
  assert.doesNotMatch(prompt, /仅为未决判断/);
  assert.match(prompt, /已完成一次问诊/);
  assert.match(prompt, /不得把猜测、症状、传闻或尚未验证的结论写成当前已经成立的事实|不得把入口目标或未决怀疑直接落实为诊断/);
});

test('progression judge prompt sends only the active progression event, never sibling entry nodes', () => {
  const candidates = createStorylineSnapshot({subject_id: 'char_1', display_name: '沈清秋', branches: [branch(1), branch(2), branch(3)], created_at_floor_version: floor});
  const selected = applyStorylineJudge(candidates, {branch_id: candidates.branches[0].branch_id, node_id: candidates.branches[0].nodes[1].node_id});
  const completed = applyStorylineJudge(selected, {action: 'complete'});
  const active = setStorylineProgressionEvent(completed, {title: '当前推进', guidance: '阶段性条件引导。', completion_signal: '出现变化。', conclusion_goal: '引出后续。', created_at_floor_version: floor});
  const prompt = buildStorylineJudgeMessages({snapshot: active, recentStory: '新的正文。'}).map(message => message.content).join('\n');
  assert.match(prompt, /当前推进事件标题: 当前推进/);
  assert.doesNotMatch(prompt, /节点编号:|目标: 创造就医条件|标题: 挂号/);
});

test('candidate context exposes all independent node objectives without internal node ids', () => {
  const snapshot = createStorylineSnapshot({subject_id: 'char_1', display_name: '沈清秋', branches: [branch(1), branch(2), branch(3)], created_at_floor_version: floor});
  const prompt = buildStorylineContextPrompt(snapshot);
  assert.match(prompt, /候选节点（互相独立，正文只选其中一个）/);
  assert.match(prompt, /节点1：挂号[\s\S]*当前目标：创造就医条件/);
  assert.match(prompt, /节点2：检查[\s\S]*完成信号：已检查/);
  assert.match(prompt, /节点3：结论[\s\S]*结论目标：等待角色决定下一步行动/);
  assert.doesNotMatch(prompt, /node_\d+/);
});

test('two valid bodies make a judge due without retaining raw response', () => {
  const snapshot = createStorylineSnapshot({subject_id: 'char_1', display_name: '沈清秋', branches: [branch(1), branch(2), branch(3)], created_at_floor_version: floor});
  const one = recordStorylineBody(snapshot, 'response-1');
  assert.equal(storylineJudgeDue(one), false);
  const two = recordStorylineBody(one, 'response-2');
  assert.equal(storylineJudgeDue(two), true);
  assert.equal(two.snapshot_id, undefined);
  assert.notEqual(two.due_attempt_id, one.due_attempt_id);
  assert.match(two.due_attempt_id, /^storyline_judge_attempt_/);
  assert.equal(JSON.stringify(two).includes('raw_response'), false);
  assert.deepEqual(recordStorylineBody(two, 'response-3'), two);
});

test('storyline response identity is stable for repeated analysis of the same Floor owner', () => {
  const owner = {chat_id: 'chat', message_id: 'm20', floor: 20, swipe_id: 0};
  assert.equal(buildStorylineResponseId(owner), buildStorylineResponseId({...owner, content_hash: 'changed-body'}));
  assert.notEqual(buildStorylineResponseId(owner), buildStorylineResponseId({...owner, swipe_id: 1}));
  assert.notEqual(buildStorylineResponseId(owner), buildStorylineResponseId({...owner, chat_id: 'other-chat'}));
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
  assert.equal(views.storyline_snapshots.find(item => item.subject_id === 'char_2').subject_id, sibling.subject_id);
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
  assert.equal(views.storyline_snapshots[0].subject_id, snapshot.subject_id);
  assert.equal(views.storyline_snapshots[0].status, snapshot.status);
  const mismatch = diagnostics.getStorylineDiagnostics({chat_id: 'chat', floor_version: floor}).sequence.find(item => item.stage === 'SNAPSHOT_READBACK' && item.status === 'mismatch');
  assert.deepEqual(mismatch.mismatch_fields, ['status', 'branches']);
  assert.deepEqual(mismatch.subjects, ['char_1']);
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
  const analyzedMessages = [];
  let judgeCalls = 0;
  const diagnostics = createRuntimeDiagnostics({getChatId: () => 'chat'});
  const runtime = createProjectionStorylineRuntime({
    analyzer: {generateStoryline: async ({messages}) => { judgeCalls += 1; analyzedMessages.push(messages); analyzedBodies.push(messages.map(message => message.content).join('\n')); return JSON.stringify({action: 'invalid'}); }},
    getProjectionViews: async () => views,
    saveProjectionStorylineSnapshotBatch: async ({snapshots}) => { views.storyline_snapshots = snapshots; return {status: 'appended'}; },
    saveProjectionStorylineDelivery: async ({record}) => { views.storyline_delivery_records.push({...record, floor_version: record.response_id === 'body-1' ? {...currentFloor, floor: 19, message_id: 'm19'} : currentFloor, created_at_floor_version: currentFloor}); return {status: 'appended'}; },
    readStoryBodyByFloorVersion: async version => version.message_id === 'm19' ? '第一条正文' : '第二条正文',
    resolveCurrentFloor: async () => ({index: 1, version: currentFloor}),
    getChatId: () => 'chat',
    requestSettingsResolver: () => ({retry_count: 1}),
    diagnostics,
  });
  const inputs = {
    floor: {index: 1, version: currentFloor},
    trackingSubjects: {char_1: {character_id: 'char_1', display_name: '沈清秋'}},
    worldModel: {setting: '医院附近'},
    otherReferenceData: {known_characters: [{display_name: '大夫'}]},
    externalMemory: [{content: '曾有肠胃不适记录'}],
    storyContext: [{floor: 18, role: 'assistant', content: '设置指定的近期剧情上下文。'}],
    storyContextFloorCount: 7,
  };
  await runtime.settled({settled: true, inputs, responseId: 'body-1', generation: 'g-1'});
  assert.equal(Number(views.storyline_snapshots[0].valid_body_count), 1);
  assert.equal(Number(views.storyline_snapshots[0].created_at_floor_version.floor), 20);
  assert.equal(views.storyline_snapshots[0].snapshot_id, undefined);
  await runtime.settled({settled: true, inputs, responseId: 'body-2', generation: 'g-2'});
  const dueAttempt = views.storyline_snapshots[0].due_attempt_id;
  assert.equal(Number(views.storyline_snapshots[0].valid_body_count), 2);
  assert.equal(judgeCalls, 1);
  await runtime.settled({settled: true, inputs, responseId: 'body-2', generation: 'manual-reanalysis'});
  assert.equal(judgeCalls, 2);
  assert.equal(Number(views.storyline_snapshots[0].valid_body_count), 2);
  await runtime.settled({settled: true, inputs, responseId: 'body-3', generation: 'g-3'});
  assert.equal(judgeCalls, 2);
  assert.equal(Number(views.storyline_snapshots[0].valid_body_count), 2);
  assert.equal(views.storyline_snapshots[0].due_attempt_id, dueAttempt);
  assert.equal(analyzedBodies[0].includes('设置指定的近期剧情上下文。'), true);
  assert.equal(analyzedBodies[0].includes('第一条正文'), false);
  assert.equal(analyzedBodies[0].includes('第二条正文'), false);
  assert.equal(analyzedBodies[1], analyzedBodies[0]);
  assert.deepEqual(analyzedMessages[0].map(message => message.role), ['system', 'system', 'assistant', 'user']);
  const stages = diagnostics.getStorylineDiagnostics({chat_id: 'chat', floor_version: currentFloor}).sequence;
  const first = (stage, status) => stages.findIndex(item => item.stage === stage && item.status === status);
  assert.ok(first('RESPONSE_RECEIPT', 'succeeded') >= 0);
  assert.ok(first('BODY_READ', 'started') > first('RESPONSE_RECEIPT', 'succeeded'));
  assert.ok(first('BODY_READ', 'succeeded') > first('BODY_READ', 'started'));
  assert.ok(first('CADENCE_DUE', 'due') > first('BODY_READ', 'succeeded'));
  const cadenceIndex = first('CADENCE_DUE', 'due');
  const judgeContextIndex = stages.findIndex((item, index) => index > cadenceIndex && item.stage === 'CONTEXT_PORT_READ' && item.status === 'succeeded');
  assert.ok(judgeContextIndex > cadenceIndex);
  assert.equal(stages[judgeContextIndex].recent_story.floor_count, 7);
  assert.equal(stages[judgeContextIndex].recent_story.item_count, 1);
  assert.ok(first('JUDGE_REQUEST', 'started') > first('CADENCE_DUE', 'due'));
  assert.ok(first('JUDGE_RETRY', 'failed') > first('JUDGE_REQUEST', 'started'));
  assert.equal(stages.filter(item => item.stage === 'BODY_READ' && item.status === 'started').length, 2);
});

test('storyline judge retry budget follows api settings and transport attempts', async () => {
  async function runScenario({retryCount, errorAttempt = null} = {}) {
    const submissionFloor = {...floor, floor: 10, message_id: 'm10', content_hash: 'hash-10'};
    const currentFloor = {...floor, floor: 20, message_id: 'm20'};
    const candidateSnapshot = createStorylineSnapshot({subject_id: 'char_1', display_name: '沈清秋', branches: [branch(1), branch(2), branch(3)], created_at_floor_version: submissionFloor});
    const snapshot = createStorylineSnapshot({subject_id: 'char_1', display_name: '沈清秋', status: 'selected', branches: [candidateSnapshot.branches[0]], selected_branch_id: candidateSnapshot.branches[0].branch_id, created_at_floor_version: submissionFloor});
    const views = {
      storyline_snapshots: [snapshot],
      triggered_snapshots: [{subject_id: 'char_1', status: 'active', triggered: [{reaction_concept: 'nausea'}]}],
      storyline_delivery_records: [{kind: 'submission', subject_id: 'char_1', response_id: 'generation-1', context_fingerprint: 'ctx-1', floor_version: submissionFloor, created_at_floor_version: submissionFloor}],
    };
    let judgeCalls = 0;
    const runtime = createProjectionStorylineRuntime({
      analyzer: {generateStoryline: async () => {
        judgeCalls += 1;
        if (errorAttempt !== null) {
          const error = new Error('response-error');
          error.code = 'response-error';
          error.attempt = errorAttempt;
          throw error;
        }
        return JSON.stringify({action: 'invalid'});
      }},
      getProjectionViews: async () => views,
      saveProjectionStorylineSnapshotBatch: async ({snapshots}) => { views.storyline_snapshots = snapshots; return {status: 'appended'}; },
      saveProjectionStorylineDelivery: async ({record}) => { views.storyline_delivery_records.push({...record, floor_version: record.response_id === 'body-1' ? {...currentFloor, floor: 19, message_id: 'm19'} : currentFloor, created_at_floor_version: currentFloor}); return {status: 'appended'}; },
      readStoryBodyByFloorVersion: async version => version.message_id === 'm19' ? '第一条正文' : '第二条正文',
      resolveCurrentFloor: async () => ({index: 1, version: currentFloor}),
      getChatId: () => 'chat',
      requestSettingsResolver: () => ({retry_count: retryCount}),
    });
    const inputs = {floor: {index: 1, version: currentFloor}, trackingSubjects: {char_1: {character_id: 'char_1', display_name: '沈清秋'}}, storyContext: []};
    await runtime.settled({settled: true, inputs, responseId: 'body-1', generation: 'g-1'});
    await runtime.settled({settled: true, inputs, responseId: 'body-2', generation: 'g-2'});
    await runtime.settled({settled: true, inputs, responseId: 'body-3', generation: 'g-3'});
    return judgeCalls;
  }

  assert.equal(await runScenario({retryCount: 0}), 1);
  assert.equal(await runScenario({retryCount: 1, errorAttempt: 2}), 1);
});

test('valid null judge result clears the persisted due window after body-count writes', async () => {
  const priorFloor = {...floor, floor: 10, message_id: 'm10', content_hash: 'hash-10'};
  const currentFloor = {...floor, floor: 20, message_id: 'm20'};
  const snapshot = createStorylineSnapshot({subject_id: 'char_1', display_name: '沈清秋', branches: [branch(1), branch(2), branch(3)], created_at_floor_version: priorFloor});
  const views = {
    storyline_snapshots: [snapshot],
    triggered_snapshots: [{subject_id: 'char_1', status: 'active', triggered: [{reaction_concept: 'nausea'}]}],
    storyline_delivery_records: [{kind: 'submission', subject_id: 'char_1', response_id: 'generation-1', context_fingerprint: 'ctx-1', floor_version: priorFloor, created_at_floor_version: priorFloor}],
  };
  let judgeCalls = 0;
  let snapshotWrites = 0;
  const runtime = createProjectionStorylineRuntime({
    analyzer: {generateStoryline: async () => { judgeCalls += 1; return JSON.stringify({branch_id: null, node_id: null}); }},
    getProjectionViews: async () => views,
    saveProjectionStorylineSnapshotBatch: async ({snapshots}) => { snapshotWrites += 1; views.storyline_snapshots = snapshots; return {status: 'appended'}; },
    saveProjectionStorylineDelivery: async ({record}) => { views.storyline_delivery_records.push({...record, floor_version: currentFloor, created_at_floor_version: currentFloor}); return {status: 'appended'}; },
    readStoryBodyByFloorVersion: async version => `正文 ${version.message_id}`,
    resolveCurrentFloor: async () => ({index: 1, version: currentFloor}),
    getChatId: () => 'chat',
  });
  const inputs = {floor: {index: 1, version: currentFloor}, trackingSubjects: {char_1: {character_id: 'char_1', display_name: '沈清秋'}}};
  await runtime.settled({settled: true, inputs, responseId: 'body-1', generation: 'g-1'});
  await runtime.settled({settled: true, inputs, responseId: 'body-2', generation: 'g-2'});
  assert.equal(judgeCalls, 1);
  assert.equal(snapshotWrites, 3);
  assert.equal(views.storyline_snapshots[0].status, 'candidates');
  assert.equal(views.storyline_snapshots[0].valid_body_count, 0);
  assert.deepEqual(views.storyline_snapshots[0].counted_response_ids, []);
  assert.equal(views.storyline_snapshots[0].created_at_floor_version.floor, 20);

  await runtime.settled({settled: true, inputs, responseId: 'body-2', generation: 'manual-reanalysis'});
  assert.equal(judgeCalls, 1);
  assert.equal(views.storyline_snapshots[0].valid_body_count, 0);
  assert.deepEqual(views.storyline_snapshots[0].counted_response_ids, []);
});

test('response receipt failure is recoverable without recounting the same Floor response', async () => {
  const priorFloor = {...floor, floor: 10, message_id: 'm10', content_hash: 'hash-10'};
  const currentFloor = {...floor, floor: 20, message_id: 'm20'};
  const snapshot = createStorylineSnapshot({subject_id: 'char_1', display_name: '沈清秋', branches: [branch(1), branch(2), branch(3)], created_at_floor_version: priorFloor});
  const views = {
    storyline_snapshots: [snapshot],
    triggered_snapshots: [{subject_id: 'char_1', status: 'active', triggered: [{reaction_concept: 'nausea'}]}],
    storyline_delivery_records: [{kind: 'submission', subject_id: 'char_1', response_id: 'generation-1', context_fingerprint: 'ctx-1', floor_version: priorFloor, created_at_floor_version: priorFloor}],
  };
  let receiptAttempts = 0;
  let judgeCalls = 0;
  const runtime = createProjectionStorylineRuntime({
    analyzer: {generateStoryline: async () => { judgeCalls += 1; throw new Error('JUDGE_FAILED'); }},
    getProjectionViews: async () => views,
    saveProjectionStorylineSnapshotBatch: async ({snapshots}) => { views.storyline_snapshots = snapshots; return {status: 'appended'}; },
    saveProjectionStorylineDelivery: async ({record}) => {
      receiptAttempts += 1;
      if (receiptAttempts === 1) throw new Error('RECEIPT_WRITE_FAILED');
      views.storyline_delivery_records.push({...record, floor_version: currentFloor, created_at_floor_version: currentFloor});
      return {status: 'appended'};
    },
    readStoryBodyByFloorVersion: async version => `正文 ${version.message_id}`,
    resolveCurrentFloor: async () => ({index: 1, version: currentFloor}),
    getChatId: () => 'chat',
  });
  const inputs = {floor: {index: 1, version: currentFloor}, trackingSubjects: {char_1: {character_id: 'char_1', display_name: '沈清秋'}}};
  await runtime.settled({settled: true, inputs, responseId: 'body-1', generation: 'g-1'});
  assert.equal(views.storyline_snapshots[0].valid_body_count, 1);
  assert.deepEqual(views.storyline_snapshots[0].counted_response_ids, ['body-1']);
  assert.equal(views.storyline_delivery_records.filter(item => item.kind === 'response').length, 0);

  await runtime.settled({settled: true, inputs, responseId: 'body-1', generation: 'manual-reanalysis'});
  assert.equal(views.storyline_snapshots[0].valid_body_count, 1);
  assert.deepEqual(views.storyline_snapshots[0].counted_response_ids, ['body-1']);
  assert.equal(views.storyline_delivery_records.filter(item => item.kind === 'response').length, 1);
  assert.equal(judgeCalls, 0);

  await runtime.settled({settled: true, inputs, responseId: 'body-2', generation: 'g-2'});
  assert.equal(views.storyline_snapshots[0].valid_body_count, 2);
  assert.deepEqual(views.storyline_snapshots[0].counted_response_ids, ['body-1', 'body-2']);
  assert.equal(judgeCalls, 1);
});

test('body-count readback trusts the confirmed timeline when the host view is briefly stale', async () => {
  const priorFloor = {...floor, floor: 19, message_id: 'm19', content_hash: 'hash-19'};
  const currentFloor = {...floor, floor: 20, message_id: 'm20'};
  const snapshot = createStorylineSnapshot({subject_id: 'char_1', display_name: '沈清秋', branches: [branch(1), branch(2), branch(3)], created_at_floor_version: priorFloor});
  const views = {
    // Simulate the host memory view lagging behind the authoritative Floor
    // readback returned by the persistence boundary.
    storyline_snapshots: [snapshot],
    triggered_snapshots: [{subject_id: 'char_1', status: 'active', triggered: [{reaction_concept: 'nausea'}]}],
    storyline_delivery_records: [{kind: 'submission', subject_id: 'char_1', response_id: 'generation-1', context_fingerprint: 'ctx-1', floor_version: priorFloor, created_at_floor_version: priorFloor}],
  };
  let savedTimeline = null;
  const runtime = createProjectionStorylineRuntime({
    analyzer: {generateStoryline: async () => JSON.stringify({branch_id: null})},
    getProjectionViews: async () => views,
    saveProjectionStorylineSnapshotBatch: async ({snapshots}) => {
      savedTimeline = {storyline_snapshots: snapshots};
      // Deliberately leave `views.storyline_snapshots` stale.
      return {status: 'appended', timeline: savedTimeline, authoritativeReadback: true};
    },
    saveProjectionStorylineDelivery: async ({record}) => {
      views.storyline_delivery_records.push({...record, floor_version: currentFloor, created_at_floor_version: currentFloor});
      return {status: 'appended'};
    },
    readStoryBodyByFloorVersion: async () => '正文',
    resolveCurrentFloor: async () => ({index: 1, version: currentFloor}),
    getChatId: () => 'chat',
  });
  const inputs = {floor: {index: 1, version: currentFloor}, trackingSubjects: {char_1: {character_id: 'char_1', display_name: '沈清秋'}}};

  await runtime.settled({settled: true, inputs, responseId: 'body-1', generation: 'g-1'});
  assert.equal(savedTimeline.storyline_snapshots[0].valid_body_count, 1);
  assert.deepEqual(savedTimeline.storyline_snapshots[0].counted_response_ids, ['body-1']);
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

test('independent subject design requests run together and only qualified results are merged', async () => {
  const views = {
    storyline_snapshots: [],
    triggered_snapshots: [
      {subject_id: 'char_1', status: 'active', triggered: [{reaction_concept: 'nausea'}]},
      {subject_id: 'char_2', status: 'active', triggered: [{reaction_concept: 'fatigue'}]},
    ],
    storyline_delivery_records: [],
  };
  let active = 0;
  let maxActive = 0;
  let writes = 0;
  let releaseResponses;
  const bothRequestsStarted = new Promise(resolve => { releaseResponses = resolve; });
  const runtime = createProjectionStorylineRuntime({
    analyzer: {generateStoryline: async ({messages}) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (active === 2) releaseResponses();
      await bothRequestsStarted;
      active -= 1;
      const prompt = messages.map(message => message.content).join('\n');
      return prompt.includes('沈清秋')
        ? JSON.stringify({branches: [branch(1), branch(2), {...branch(3), nodes: branch(3).nodes.map((node, index) => index === 0 ? {...node, conclusion_goal: ''} : node)}]})
        : JSON.stringify({branches: [branch(1), branch(2), branch(3)]});
    }},
    getProjectionViews: async () => views,
    saveProjectionStorylineSnapshotBatch: async ({snapshots}) => {
      writes += 1;
      const bySubject = new Map(views.storyline_snapshots.map(snapshot => [snapshot.subject_id, snapshot]));
      snapshots.forEach(snapshot => bySubject.set(snapshot.subject_id, snapshot));
      views.storyline_snapshots = [...bySubject.values()];
      return {status: 'appended'};
    },
    resolveCurrentFloor: async () => ({index: 0, version: floor}),
    getChatId: () => 'chat',
  });
  await runtime.settled({settled: true, inputs: {
    floor: {index: 0, version: floor},
    trackingSubjects: {
      char_1: {character_id: 'char_1', display_name: '沈清秋'},
      char_2: {character_id: 'char_2', display_name: '林黛玉'},
    },
  }});
  assert.equal(maxActive, 2);
  assert.equal(writes, 1);
  assert.deepEqual(views.storyline_snapshots.map(snapshot => snapshot.subject_id), ['char_2']);
});

test('a qualified design sibling survives another subject persistence failure', async () => {
  const views = {
    storyline_snapshots: [],
    triggered_snapshots: [
      {subject_id: 'char_1', status: 'active', triggered: [{reaction_concept: 'nausea'}]},
      {subject_id: 'char_2', status: 'active', triggered: [{reaction_concept: 'fatigue'}]},
    ],
    storyline_delivery_records: [],
  };
  const runtime = createProjectionStorylineRuntime({
    analyzer: {generateStoryline: async () => JSON.stringify({branches: [branch(1), branch(2), branch(3)]})},
    getProjectionViews: async () => views,
    saveProjectionStorylineSnapshotBatch: async ({snapshots}) => {
      if (snapshots[0].subject_id === 'char_1') throw new Error('UNQUALIFIED_WRITE');
      views.storyline_snapshots = [...views.storyline_snapshots.filter(item => item.subject_id !== snapshots[0].subject_id), ...snapshots];
      return {status: 'appended'};
    },
    resolveCurrentFloor: async () => ({index: 0, version: floor}),
    getChatId: () => 'chat',
  });

  await assert.doesNotReject(() => runtime.settled({settled: true, inputs: {
    floor: {index: 0, version: floor},
    trackingSubjects: {
      char_1: {character_id: 'char_1', display_name: '沈清秋'},
      char_2: {character_id: 'char_2', display_name: '林黛玉'},
    },
  }}));
  assert.deepEqual(views.storyline_snapshots.map(snapshot => snapshot.subject_id), ['char_2']);
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
  assert.equal(currentViews.storyline_snapshots.find(item => item.subject_id === 'char_2').subject_id, sibling.subject_id);

  await runtime.settled({inputs, settled: true, generation: 'g2'});
  assert.equal(designCalls, 2);
  assert.equal(writes, 2);
  assert.equal(currentViews.storyline_snapshots.find(item => item.subject_id === 'char_1').branches[0].title, '新支线2-1');
  assert.equal(currentViews.storyline_snapshots.find(item => item.subject_id === 'char_2').subject_id, sibling.subject_id);
  assert.ok(viewReads.some(options => Number(options.endpointIndex) === 0 && Number(options.endpointFloor) === 20));
});

test('same-Floor submission receipts are not prior evidence for the Floor being settled', async () => {
  const previousFloor = {...floor, message_id: 'm19', floor: 19, content_hash: 'hash-19'};
  const currentFloor = {...floor, message_id: 'm20', floor: 20};
  const previousCandidates = createStorylineSnapshot({subject_id: 'char_1', display_name: '沈清秋', branches: [branch(1), branch(2), branch(3)], created_at_floor_version: previousFloor});
  const previousSnapshot = applyStorylineJudge(previousCandidates, {branch_id: previousCandidates.branches[0].branch_id, node_id: previousCandidates.branches[0].nodes[0].node_id});
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
    storyContext: [{floor: 0, role: 'assistant', content: '沈清秋因胃部不适准备去医院。'}],
  }});
  assert.match(prompt, /沈清秋/);
  assert.match(prompt, /胃部不适|医院附近/);
  assert.match(prompt, /恶心/);
  assert.doesNotMatch(prompt, /医院可以进行常规检查/);
  assert.match(prompt, /曾经有过胃部不适记录/);
  assert.match(prompt, /柳如烟/);
  assert.match(prompt, /已知人物:\n  - 角色名: 柳如烟\n    昵称: 如烟/);
  assert.doesNotMatch(prompt, /- 已知人物:角色名:/);
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
  assert.match(prompt, /- 信号: 食欲变化\n  证据:\n    - 最近几日食欲明显变化。/);
  assert.match(prompt, /- 信号: 恶心\n  证据:\n    - 闻到油腻气味后出现恶心。/);
  assert.ok(prompt.indexOf('信号: 食欲变化\n  证据:\n    - 最近几日食欲明显变化。') < prompt.indexOf('信号: 恶心\n  证据:\n    - 闻到油腻气味后出现恶心。'));
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
