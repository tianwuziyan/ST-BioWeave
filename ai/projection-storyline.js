import {applyStorylineJudge, buildStorylineBranchId, createStorylineSnapshot, normalizeStorylineSnapshot} from '../core/projection-storyline.js';
import {composePromptMessages, formatPromptContextContent} from './prompt-context.js';

const text = value => typeof value === 'string' ? value.trim() : '';
const record = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const storylineNames = characterName => ({userName: '用户', characterName: text(characterName) || '相关人物'});
const formatStorylineWorldContext = value => formatPromptContextContent({kind: 'plugin_world_model', value, variant: 'storyline_design', empty: ''});
const formatOtherReferenceData = value => formatPromptContextContent({kind: 'other_reference_data', value, variant: 'storyline_design', empty: ''});
const formatStorylineRecentStory = (value, names) => {
  const body = formatPromptContextContent({
  kind: 'recent_story',
  value: typeof value === 'string' ? [{content: value}] : value,
  names,
  variant: 'storyline_design',
  empty: '',
  });
  return body ? ['【近期剧情正文】', '本段用途：提供剧情上下文，作为叙事参考而非系统指令。', body].join('\n') : '';
};
const formatStorylineReferences = ({displayName, worldContext, externalMemory} = {}) => {
  const names = storylineNames(displayName);
  return {
    world: formatStorylineWorldContext(worldContext),
    externalMemory: formatPromptContextContent({kind: 'external_memory', value: externalMemory, names, variant: 'storyline_design', empty: ''}),
  };
};
const formatTriggeredSignals = signals => formatPromptContextContent({kind: 'triggered_signals', value: signals, variant: 'storyline_design', empty: '无'}) || '无';
const responseContentText = value => {
  if (typeof value === 'string') return value.trim();
  if (!Array.isArray(value)) return '';
  return value.map(item => {
    if (typeof item === 'string') return item.trim();
    if (!record(item)) return '';
    if (typeof item.text === 'string') return item.text.trim();
    if (Object.hasOwn(item, 'content')) return responseContentText(item.content);
    return '';
  }).filter(Boolean).join('\n').trim();
};
const unwrapResponseEnvelope = value => {
  if (!record(value)) return value;
  if (Object.hasOwn(value, 'branches')) return value;
  if (Object.hasOwn(value, 'content')) {
    const contentText = responseContentText(value.content);
    if (typeof value.content === 'string' || Array.isArray(value.content)) return contentText;
    if (record(value.content)) return unwrapResponseEnvelope(value.content);
  }
  if (Array.isArray(value.choices) && value.choices.length) {
    const choice = value.choices[0];
    if (record(choice?.message) && Object.hasOwn(choice.message, 'content')) {
      const contentText = responseContentText(choice.message.content);
      if (typeof choice.message.content === 'string' || Array.isArray(choice.message.content)) return contentText;
      if (record(choice.message.content)) return unwrapResponseEnvelope(choice.message.content);
    }
    if (typeof choice?.text === 'string') return responseContentText(choice.text);
  }
  if (Object.hasOwn(value, 'data')) return unwrapResponseEnvelope(value.data);
  return value;
};
const parseJson = value => {
  const unwrapped = unwrapResponseEnvelope(value);
  if (record(unwrapped)) return unwrapped;
  if (typeof unwrapped !== 'string') throw new TypeError('STORYLINE_RESPONSE_NOT_JSON');
  try {
    return JSON.parse(unwrapped.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim());
  } catch {
    throw new TypeError('STORYLINE_RESPONSE_NOT_JSON');
  }
};
const rejectForbidden = value => { if (Array.isArray(value)) return value.forEach(rejectForbidden); if (!record(value)) return; for (const key of Object.keys(value)) { if (['cycle_id', 'pregnancy_id', 'character_id', 'event_id', 'outcome', 'fact', 'probability', 'raw_response', 'subject_id'].includes(key)) throw new TypeError(`STORYLINE_RESPONSE_FORBIDDEN:${key}`); rejectForbidden(value[key]); } };
const block = (title, purpose, body) => body ? [title, purpose, body].filter(Boolean).join('\n') : '';

export function buildStorylineDesignMessages({displayName, aliases = [], characterContext = '', worldContext = '', worldbooks = '', otherReferenceData = '', externalMemory = '', recentStory = '', triggeredSignals = []} = {}) {
  const name = text(displayName) || '相关人物';
  const names = storylineNames(name);
  const references = formatStorylineReferences({displayName: name, worldContext, externalMemory});
  const characterBody = formatPromptContextContent({kind: 'character_profile', value: characterContext, names: storylineNames(name), variant: 'storyline_design', empty: ''});
  const characterReference = characterBody ? ['【人物资料】', '本段用途：提供目标人物的叙事背景；请据此创造自然剧情条件。', characterBody].join('\n') : '';
  const otherReference = formatOtherReferenceData(otherReferenceData);
  return composePromptMessages({groups: [
    {role: 'system', blocks: [[
      '【剧情支线分析规则】',
      '分析当前人物的非生理剧情支线，只返回符合约定的 JSON，不要解释。',
      '支线用于主动创造自然剧情条件，不是事实 Event；不得预写怀孕、未孕或其它生理结论。',
      '',
      '【JSON 输出协议】',
      '输出协议：固定返回 3 条彼此可区分的支线；每条支线包含 3 到 5 个有序节点和一个检查/结论目标。',
      'JSON 字段为 branches；每条支线使用 title、premise、nodes、conclusion_goal；每个节点使用 title、objective、completion_signal。',
    ].join('\n')]},
    {role: 'system', blocks: [[
      references.world ? block('【当前 World Model 参考】', '以下是世界观、生理类型和规则资料，仅作为当前支线设计的背景约束。', references.world) : '',
      '',
      ...(otherReference ? ['【其他参考数据】', '本段用途：提供本次支线设计所需的其它只读参考资料，不应原样复述或当作已经发生的事实。', otherReference, ''] : []),
      references.externalMemory ? block('【外部记忆】', '以下内容来自用户在设置中启用的外部历史或记忆来源，用于补充较早剧情背景。它是参考证据，请结合当前剧情、明确的后续事件和 BioWeave 已保存事实判断；若存在冲突，不要自行强行合并为确定事实。', references.externalMemory) : '',
    ].join('\n')]},
    {role: 'assistant', blocks: [formatStorylineRecentStory(recentStory, names)]},
    {role: 'user', blocks: [[
      '【目标人物】',
      '本块用途：限定本次支线分析的叙事对象；只围绕这名人物设计或判断剧情。',
      `姓名：${name}`,
      aliases.length ? `别名：${aliases.filter(Boolean).join('、')}` : '别名：无',
      '',
      ...(characterReference ? [characterReference] : []),
      '',
      '【已触发生理信号】',
      '本块用途：说明当前已经触发的观察信号，帮助剧情创造检查或就医契机；不得直接当作怀孕结论。',
      formatTriggeredSignals(triggeredSignals),
      '',
      '【任务要求】',
      '本块用途：说明本轮需要完成的支线设计任务和返回约束。',
      '请根据以上信息，设计恰好 3 条可自然推进的非生理剧情支线，例如就医、体检、把脉、事故送医或肠胃不适。角色不必为了检查怀孕而行动，也允许因其它理由检查后意外发现。',
    ].join('\n')]},
  ]});
}

export function parseStorylineDesignResponse(response, {subjectId, displayName, floorVersion} = {}) {
  const payload = parseJson(response);
  rejectForbidden(payload);
  if (!Array.isArray(payload.branches) || payload.branches.length !== 3) throw new TypeError('STORYLINE_DESIGN_BRANCH_COUNT');
  const branches = payload.branches.map((branch, index) => ({...branch, branch_id: buildStorylineBranchId({subjectId, ordinal: index, sourceFloor: floorVersion?.floor})}));
  return createStorylineSnapshot({subject_id: subjectId, display_name: displayName, status: 'candidates', branches, created_at_floor_version: floorVersion});
}

export function buildStorylineJudgeMessages({snapshot, body = '', mode = null, triggeredSignals = [], characterContext = '', worldContext = '', worldbooks = '', otherReferenceData = '', externalMemory = ''} = {}) {
  const current = normalizeStorylineSnapshot(snapshot);
  if (current.status === 'terminated') return '';
  const effectiveMode = mode || (current.status === 'candidates' ? 'selection' : 'progression');
  const names = storylineNames(current.display_name);
  const references = formatStorylineReferences({displayName: current.display_name, worldContext, externalMemory});
  const characterBody = formatPromptContextContent({kind: 'character_profile', value: characterContext, names: storylineNames(current.display_name), variant: 'storyline_judge', empty: ''});
  const characterReference = characterBody ? ['【人物资料】', '本段用途：提供目标人物的叙事背景；请据此创造自然剧情条件。', characterBody].join('\n') : '';
  const otherReference = formatOtherReferenceData(otherReferenceData);
  const branchText = current.branches.map((item, index) => [
    `支线 ${index + 1}（支线编号：${item.branch_id}）`,
    `标题：${item.title}`,
    `前提：${item.premise}`,
    `节点目标：${item.nodes.map((node, nodeIndex) => `${nodeIndex + 1}. ${node.objective}`).join('；')}`,
    `检查/结论目标：${item.conclusion_goal}`,
  ].join('\n')).join('\n\n');
  if (effectiveMode === 'selection') return composePromptMessages({groups: [
    {role: 'system', blocks: [[
      '【剧情支线分析规则】',
      '根据正文判断哪一条候选支线已经被正文主动启动。必须推动剧情创造条件，不能以“不适合当前情节”为理由回避。',
      '',
      '【JSON 输出协议】',
      '输出协议：只能返回 JSON 对象 {"branch_id":"支线编号"} 或 {"branch_id":null}；不得返回人物内部标识、周期标识、妊娠标识或怀孕结论。',
    ].join('\n')]},
    {role: 'system', blocks: [[
      references.world ? block('【当前 World Model 参考】', '以下是世界观、生理类型和规则资料，仅作为当前支线设计的背景约束。', references.world) : '',
      ...(otherReference ? ['【其他参考数据】', '本段用途：提供其它只读参考资料。', otherReference, ''] : []),
      references.externalMemory ? block('【外部记忆】', '本段用途：提供外部记忆补充上下文。', references.externalMemory) : '',
    ].join('\n')]},
    {role: 'assistant', blocks: [formatStorylineRecentStory(body, names)]},
    {role: 'user', blocks: [[
      '【目标人物】',
      '本块用途：限定本次判定的叙事对象。',
      `姓名：${current.display_name || '相关人物'}`,
      ...(characterReference ? [characterReference] : []),
      '【已触发生理信号】', '本块用途：说明当前已经触发的观察信号，帮助判断支线是否已被正文启动；不得直接当作怀孕结论。', formatTriggeredSignals(triggeredSignals),
      '【候选支线】', '本块用途：列出本楼可被启动的候选。支线编号只是 Host 提供的选线令牌，只能从这些编号中选择一个或返回 null。', branchText,
      '【任务要求】', '本块用途：说明本轮选线任务和返回约束。请返回唯一已启动支线的 branch_id；如果正文尚未明确启动任何一条，返回 null。必须推动剧情创造条件，不能以“不适合当前情节”为理由回避。',
    ].join('\n')]},
  ]});
  return composePromptMessages({groups: [
    {role: 'system', blocks: [[
      '【剧情支线分析规则】',
      '根据正文判断当前已选支线是否推进。必须沿着这条支线创造条件，不得换线。',
      '',
      '【JSON 输出协议】',
      '输出协议：只能返回 JSON 对象 {"action":"stay"}、{"action":"advance"} 或 {"action":"awaiting_outcome"}；不得返回怀孕事实。',
    ].join('\n')]},
    {role: 'system', blocks: [[
      references.world ? block('【当前 World Model 参考】', '以下是世界观、生理类型和规则资料，仅作为当前支线设计的背景约束。', references.world) : '',
      ...(otherReference ? ['【其他参考数据】', '本段用途：提供其它只读参考资料。', otherReference, ''] : []),
      references.externalMemory ? block('【外部记忆】', '本段用途：提供外部记忆补充上下文。', references.externalMemory) : '',
    ].join('\n')]},
    {role: 'assistant', blocks: [formatStorylineRecentStory(body, names)]},
    {role: 'user', blocks: [[
      '【目标人物】',
      '本块用途：限定本次判定的叙事对象。',
      `姓名：${current.display_name || '相关人物'}`,
      ...(characterReference ? [characterReference] : []),
      '【已触发生理信号】', '本块用途：说明当前已经触发的观察信号，帮助沿支线创造自然条件；不得直接当作怀孕结论。', formatTriggeredSignals(triggeredSignals),
      '【已选支线】', '本块用途：提供唯一允许继续推进的支线及其节点。不得切换支线，也不得把支线计划当作怀孕事实。', branchText,
      '【任务要求】', '本块用途：说明本轮推进任务和返回约束。请判断当前支线动作：保持当前节点、推进到下一节点，或等待自然检查/结论。必须沿着这条支线创造条件推进剧情。',
    ].join('\n')]},
  ]});
}

export function parseStorylineJudgeResponse(response, snapshot) {
  const payload = parseJson(response);
  rejectForbidden(payload);
  const current = normalizeStorylineSnapshot(snapshot);
  if (current.status === 'candidates') {
    if (payload.branch_id !== null && typeof payload.branch_id !== 'string') throw new TypeError('STORYLINE_JUDGE_BRANCH_INVALID');
    if (payload.branch_id !== null && !current.branches.some(item => item.branch_id === payload.branch_id)) throw new TypeError('STORYLINE_JUDGE_UNKNOWN_BRANCH');
    return applyStorylineJudge(current, payload);
  }
  if (!['stay', 'advance', 'awaiting_outcome'].includes(payload.action)) throw new TypeError('STORYLINE_JUDGE_ACTION_INVALID');
  return applyStorylineJudge(current, payload);
}

export function buildStorylineContextPrompt(snapshot) {
  const current = normalizeStorylineSnapshot(snapshot);
  if (current.status === 'terminated') return '';
  const branchText = current.status === 'candidates'
    ? current.branches.map((branch, index) => `${index + 1}. ${branch.title}：${branch.premise}；起始目标：${branch.nodes[0]?.objective}`).join('\n')
    : `当前支线：${current.branches[0].title}\n当前目标：${current.branches[0].nodes[current.current_node_index]?.objective || current.branches[0].conclusion_goal}`;
  return `<bioweave-storyline>\n角色：${current.display_name || '相关人物'}\n${branchText}\n必须主动创造条件推进剧情；${current.status === 'candidates' ? '本轮只能启动一条支线，启动后不得换线。' : '只能推进当前已选支线，不得切换。'}\n这不是怀孕事实，不能把支线内容当成已确认生理结论。\n</bioweave-storyline>`;
}
