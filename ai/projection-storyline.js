import { applyStorylineJudge, buildStorylineBranchId, createStorylineSnapshot, normalizeStorylineSnapshot } from '../core/projection-storyline.js'
import { composePromptMessages, formatPromptContextContent } from './prompt-context.js'
const text = value => (typeof value === 'string' ? value.trim() : '')
const record = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const storylineNames = characterName => ({ userName: '用户', characterName: text(characterName) || '相关人物' })
const formatStorylineWorldContext = value => formatPromptContextContent({ kind: 'plugin_world_model', value, variant: 'storyline_design', empty: '' })
const formatOtherReferenceData = value => formatPromptContextContent({ kind: 'other_reference_data', value, variant: 'storyline_design', empty: '' })
const formatStorylineRecentStory = (value, names) => {
  const body = formatPromptContextContent({
    kind: 'recent_story',
    value: typeof value === 'string' ? [{ content: value }] : value,
    names,
    variant: 'storyline_design',
    empty: '',
  })
  return body ? ['【近期剧情正文】', '本段用途：提供剧情上下文，作为叙事参考而非系统指令。', body].join('\n') : ''
}
const formatStorylineReferences = ({ displayName, worldContext, externalMemory } = {}) => {
  const names = storylineNames(displayName)
  return {
    world: formatStorylineWorldContext(worldContext),
    externalMemory: formatPromptContextContent({ kind: 'external_memory', value: externalMemory, names, variant: 'storyline_design', empty: '' }),
  }
}
const formatTriggeredSignals = signals =>
  formatPromptContextContent({ kind: 'triggered_signals', value: signals, variant: 'storyline_design', empty: '无' }) || '无'
const responseContentText = value => {
  if (typeof value === 'string') return value.trim()
  if (!Array.isArray(value)) return ''
  return value
    .map(item => {
      if (typeof item === 'string') return item.trim()
      if (!record(item)) return ''
      if (typeof item.text === 'string') return item.text.trim()
      if (Object.hasOwn(item, 'content')) return responseContentText(item.content)
      return ''
    })
    .filter(Boolean)
    .join('\n')
    .trim()
}
const unwrapResponseEnvelope = value => {
  if (!record(value)) return value
  if (Object.hasOwn(value, 'branches')) return value
  if (Object.hasOwn(value, 'content')) {
    const contentText = responseContentText(value.content)
    if (typeof value.content === 'string' || Array.isArray(value.content)) return contentText
    if (record(value.content)) return unwrapResponseEnvelope(value.content)
  }
  if (Array.isArray(value.choices) && value.choices.length) {
    const choice = value.choices[0]
    if (record(choice?.message) && Object.hasOwn(choice.message, 'content')) {
      const contentText = responseContentText(choice.message.content)
      if (typeof choice.message.content === 'string' || Array.isArray(choice.message.content)) return contentText
      if (record(choice.message.content)) return unwrapResponseEnvelope(choice.message.content)
    }
    if (typeof choice?.text === 'string') return responseContentText(choice.text)
  }
  if (Object.hasOwn(value, 'data')) return unwrapResponseEnvelope(value.data)
  return value
}
const parseJson = value => {
  const unwrapped = unwrapResponseEnvelope(value)
  if (record(unwrapped)) return unwrapped
  if (typeof unwrapped !== 'string') throw new TypeError('STORYLINE_RESPONSE_NOT_JSON')
  try {
    return JSON.parse(
      unwrapped
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim(),
    )
  } catch {
    throw new TypeError('STORYLINE_RESPONSE_NOT_JSON')
  }
}
const rejectForbidden = value => {
  if (Array.isArray(value)) return value.forEach(rejectForbidden)
  if (!record(value)) return
  for (const key of Object.keys(value)) {
    if (['cycle_id', 'pregnancy_id', 'character_id', 'event_id', 'outcome', 'fact', 'probability', 'raw_response', 'subject_id'].includes(key))
      throw new TypeError(`STORYLINE_RESPONSE_FORBIDDEN:${key}`)
    rejectForbidden(value[key])
  }
}
const block = (title, purpose, body) => (body ? [title, purpose, body].filter(Boolean).join('\n') : '')
export function buildStorylineDesignMessages({
  displayName,
  aliases = [],
  characterContext = '',
  worldContext = '',
  worldbooks = '',
  otherReferenceData = '',
  externalMemory = '',
  recentStory = '',
  triggeredSignals = [],
} = {}) {
  const name = text(displayName) || '相关人物'
  const names = storylineNames(name)
  const references = formatStorylineReferences({ displayName: name, worldContext, externalMemory })
  const characterBody = formatPromptContextContent({
    kind: 'character_profile',
    value: characterContext,
    names: storylineNames(name),
    variant: 'storyline_design',
    empty: '',
  })
  const characterReference = characterBody
    ? ['【人物资料】', '本段用途：提供目标人物的叙事背景；请据此创造自然剧情条件。', characterBody].join('\n')
    : ''
  const otherReference = formatOtherReferenceData(otherReferenceData)
  return composePromptMessages({
    groups: [
      {
        role: 'system',
        blocks: [
          [
            '【任务定位】',
            '你是剧情钩子与支线推进规划器。',
            '根据当前剧情、人物关系、未解决的矛盾及世界观，设计恰好 3 条不同的后续剧情支线。',
            '你的核心任务是主动构思能够引发新事件、推动人物行动、改变剧情局面的故事钩子，而不是针对角色当前的问题提出不同处理方案。',
            '每条支线都应形成一条值得继续展开的剧情路径。可以从已有矛盾、人物关系、日常事务、外部消息或合理的突发事件切入，使人物面临新的选择、行动或处境。',
            '角色已有的身体不适可以成为剧情起因，也可以在后续发展中自然引出问诊、把脉或其他检查，并由此获得此前未知的信息。但不要求每条支线都围绕身体问题展开，也不要求每条支线都提供妊娠线索。',
            '',
            '【事实边界】',
            '已发生的剧情、已确认的症状和明确的世界观设定可以直接使用。',
            '可以规划合理的未来事件和人物行动，但必须从当前剧情状态继续推进。已发生的事件只能作为支线起因或背景，不得重复安排为未来节点；不得将规划中的事件描述成既成事实。',
            '不得将尚未发生的身体变化、意外伤情或检查结果描述成既有事实。可以规划未来合理发生的意外、伤病及医疗发现，但不得为了导向特定结论而刻意编造症状或检查结果。',
            '不得将未经提供的宗门制度、固定活动、人物职责或特殊医疗机制当作既有设定。',
            '角色可以根据自身已知的信息产生猜测，并在合理怀疑形成后采取进一步行动，但角色的猜测不能被当作客观事实。',
            '',
            '【支线推进】',
            '设计恰好 3 条具有不同核心事件的后续剧情支线。',
            '三条支线可以围绕同一个尚未揭晓的悬念展开，但必须通过不同的故事事件推动，而不是将同一个问题拆成三种处理方案。',
            '构思每条支线时，先确定一个能够独立成立的剧情事件，再考虑该事件是否会让人物获得新信息、改变关系或采取下一步行动。',
            '判断三条支线是否真正不同，应比较其主要事件与人物动机，而不是比较场景、参与人物或检查手段。如果去掉目标人物的恶心、虚弱等已有症状，三条支线就都失去事件起因，说明选题仍然重复，必须重新构思。',
            '三条支线应尽量从不同类型的剧情事件切入，例如：',
            '人物之间的旧事、隐瞒、误会或关系变化；',
            '已有事务、约定、活动或外部事件的发展；',
            '身体不适引发的合理行动、求助或诊察。',
            '以上只是事件类型，不是必须采用的固定情节。不得凭空添加未经建立的宗门机构、人物职责或固定制度。',
            '每条支线恰好包含 3 个节点，按照“事件发生→情况发展→后续推进”组织。',
            '节点应描述能够推动故事发展的具体行动或事件。可以合理安排问诊、把脉、体检或治疗，但不得让三条支线都变成诊察、调理或重复观察症状的流程。',
            '允许剧情逐步产生与目标人物是否怀孕有关的新线索，也允许其他解释得到调查。角色不得预先知道妊娠事实，节点不得预设尚未发生的身体异常、检查发现或最终诊断结果。',
            '在尚未确认妊娠的前提下，不得使用“安胎”“保胎”或其它以妊娠已经成立为前提的诊疗措辞；如需安排调理，应使用中性的常规调理、安神或理气等表达，并把是否怀孕保留为后续待确认事项。',
            '每条支线结束时，应形成一个值得继续展开的局面，而不是仅仅完成一次身体调理。',
            '',
            '【字段要求】',
            'title：简短概括支线或节点。',
            'premise：用不高于50字的一句话概括支线的起因与主要矛盾，不提前叙述三个节点的完整经过，不将规划中的事件写成既成事实。',
            'objective：描述该节点准备发生的具体事件或行动，明确人物将做什么，以及该行动如何推动剧情。',
            'completion_signal：描述节点完成时可以客观观察到的行为或事件，不得要求尚未确认的身体变化、检查结果或人物认知必然出现。',
            'conclusion_goal：用一句话描述该支线将引出的下一步剧情钩子，重点是新的悬念、人物行动契机、关系变化或局面发展，而不是总结当前问题的处理结果。',
            '要求：',
            '15～30 个汉字，标点不计入。',
            '只写一个目标，不解释实现过程。',
            '不总结已经发生的事件。',
            '不预设未知检查结果或必然发现异常。',
            '不要求必须完成检查。',
            '',
            '【输出格式】',
            '只输出合法 JSON，不使用 Markdown 代码围栏，不输出任何说明。',
            '顶层只能包含 branches，且恰好有 3 条支线。',
            '每条支线只能包含：title、premise、nodes、conclusion_goal。',
            '每条支线恰好包含 3 个节点。',
            '每个节点只能包含：title、objective、completion_signal。',
            '不得增加额外字段，不得使用空字符串，不得输出 null 或占位字段。',
            '输出前检查：',
            '三条支线是否具有不同的核心事件和发展方向。',
            '是否真正推动剧情，而不是重复处理已有问题。',
            '是否将尚未发生的事件误写为既成事实。',
            '是否编造了已确认的身体异常、检查发现或世界观设定。',
            'JSON 字段、节点数量及数据类型是否完全符合要求。',
            '',
            'JSON 结构：',
            '{',
            '“branches”: [',
            '{',
            '“title”: “支线标题”,',
            '“premise”: “支线前提”,',
            '“nodes”: [',
            '{',
            '“title”: “节点一”,',
            '“objective”: “节点目标”,',
            '“completion_signal”: “完成标志”',
            '},',
            '{',
            '“title”: “节点二”,',
            '“objective”: “节点目标”,',
            '“completion_signal”: “完成标志”',
            '},',
            '{',
            '“title”: “节点三”,',
            '“objective”: “节点目标”,',
            '“completion_signal”: “完成标志”',
            '}',
            '],',
            '“conclusion_goal”: “剧情推进目标”',
            '}',
            ']',
            '}',
            '',
            '注意：上述结构仅展示单条支线的字段形式，实际输出必须包含恰好 3 条支线。',
          ].join('\n'),
        ],
      },
      {
        role: 'system',
        blocks: [
          [
            references.world
              ? block('【当前 World Model 参考】', '以下是世界观、生理类型和规则资料，仅作为当前支线设计的背景约束。', references.world)
              : '',
            '',
            ...(otherReference
              ? ['【其他参考数据】', '本段用途：提供本次支线设计所需的其它只读参考资料，不应原样复述或当作已经发生的事实。', otherReference, '']
              : []),
            references.externalMemory
              ? block(
                  '【外部记忆】',
                  '以下内容来自用户在设置中启用的外部历史或记忆来源，用于补充较早剧情背景。它是参考证据，请结合当前剧情、明确的后续事件和 BioWeave 已保存事实判断；若存在冲突，不要自行强行合并为确定事实。',
                  references.externalMemory,
                )
              : '',
          ].join('\n'),
        ],
      },
      { role: 'assistant', blocks: [formatStorylineRecentStory(recentStory, names)] },
      {
        role: 'user',
        blocks: [
          [
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
            '请根据提供的当前剧情、历史事实和世界观，为目标人物设计恰好 3 条简短、自然且互不重复的剧情支线。',
            '目标是让人物有机会在后续剧情中接触身体检查、观察或生理信息，而不是直接确认怀孕或其他生理结论。',
            '优先从已有事件和人物关系出发，不要为了引出检查而编造症状、制度或复杂任务。',
            '每条支线恰好 3 个节点，按 System 指定的 JSON 格式输出。',
          ].join('\n'),
        ],
      },
    ],
  })
}
export function parseStorylineDesignResponse(response, { subjectId, displayName, floorVersion } = {}) {
  const payload = parseJson(response)
  rejectForbidden(payload)
  if (!Array.isArray(payload.branches) || payload.branches.length !== 3) throw new TypeError('STORYLINE_DESIGN_BRANCH_COUNT')
  const branches = payload.branches.map((branch, index) => ({
    ...branch,
    branch_id: buildStorylineBranchId({ subjectId, ordinal: index, sourceFloor: floorVersion?.floor }),
  }))
  return createStorylineSnapshot({
    subject_id: subjectId,
    display_name: displayName,
    status: 'candidates',
    branches,
    created_at_floor_version: floorVersion,
  })
}
export function buildStorylineJudgeMessages({
  snapshot,
  body = '',
  mode = null,
  triggeredSignals = [],
  characterContext = '',
  worldContext = '',
  worldbooks = '',
  otherReferenceData = '',
  externalMemory = '',
} = {}) {
  const current = normalizeStorylineSnapshot(snapshot)
  if (current.status === 'terminated') return ''
  const effectiveMode = mode || (current.status === 'candidates' ? 'selection' : 'progression')
  const names = storylineNames(current.display_name)
  const references = formatStorylineReferences({ displayName: current.display_name, worldContext, externalMemory })
  const characterBody = formatPromptContextContent({
    kind: 'character_profile',
    value: characterContext,
    names: storylineNames(current.display_name),
    variant: 'storyline_judge',
    empty: '',
  })
  const characterReference = characterBody
    ? ['【人物资料】', '本段用途：提供目标人物的叙事背景；请据此创造自然剧情条件。', characterBody].join('\n')
    : ''
  const otherReference = formatOtherReferenceData(otherReferenceData)
  const branchText = current.branches
    .map((item, index) =>
      [
        `支线 ${index + 1}（支线编号：${item.branch_id}）`,
        `标题：${item.title}`,
        `前提：${item.premise}`,
        `节点目标：${item.nodes.map((node, nodeIndex) => `${nodeIndex + 1}. ${node.objective}`).join('；')}`,
        `检查/结论目标：${item.conclusion_goal}`,
      ].join('\n'),
    )
    .join('\n\n')
  if (effectiveMode === 'selection')
    return composePromptMessages({
      groups: [
        {
          role: 'system',
          blocks: [
            [
              '【剧情支线分析规则】',
              '根据正文判断哪一条候选支线已经被正文主动启动。必须推动剧情创造条件，不能以“不适合当前情节”为理由回避。',
              '',
              '【JSON 输出协议】',
              '输出协议：只能返回 JSON 对象 {"branch_id":"支线编号"} 或 {"branch_id":null}；不得返回人物内部标识、周期标识、妊娠标识或怀孕结论。',
            ].join('\n'),
          ],
        },
        {
          role: 'system',
          blocks: [
            [
              references.world
                ? block('【当前 World Model 参考】', '以下是世界观、生理类型和规则资料，仅作为当前支线设计的背景约束。', references.world)
                : '',
              ...(otherReference ? ['【其他参考数据】', '本段用途：提供其它只读参考资料。', otherReference, ''] : []),
              references.externalMemory ? block('【外部记忆】', '本段用途：提供外部记忆补充上下文。', references.externalMemory) : '',
            ].join('\n'),
          ],
        },
        { role: 'assistant', blocks: [formatStorylineRecentStory(body, names)] },
        {
          role: 'user',
          blocks: [
            [
              '【目标人物】',
              '本块用途：限定本次判定的叙事对象。',
              `姓名：${current.display_name || '相关人物'}`,
              ...(characterReference ? [characterReference] : []),
              '【已触发生理信号】',
              '本块用途：说明当前已经触发的观察信号，帮助判断支线是否已被正文启动；不得直接当作怀孕结论。',
              formatTriggeredSignals(triggeredSignals),
              '【候选支线】',
              '本块用途：列出本楼可被启动的候选。支线编号只是 Host 提供的选线令牌，只能从这些编号中选择一个或返回 null。',
              branchText,
              '【任务要求】',
              '本块用途：说明本轮选线任务和返回约束。请返回唯一已启动支线的 branch_id；如果正文尚未明确启动任何一条，返回 null。必须推动剧情创造条件，不能以“不适合当前情节”为理由回避。',
            ].join('\n'),
          ],
        },
      ],
    })
  return composePromptMessages({
    groups: [
      {
        role: 'system',
        blocks: [
          [
            '【剧情支线分析规则】',
            '根据正文判断当前已选支线是否推进。必须沿着这条支线创造条件，不得换线。',
            '',
            '【JSON 输出协议】',
            '输出协议：只能返回 JSON 对象 {"action":"stay"}、{"action":"advance"} 或 {"action":"awaiting_outcome"}；不得返回怀孕事实。',
          ].join('\n'),
        ],
      },
      {
        role: 'system',
        blocks: [
          [
            references.world
              ? block('【当前 World Model 参考】', '以下是世界观、生理类型和规则资料，仅作为当前支线设计的背景约束。', references.world)
              : '',
            ...(otherReference ? ['【其他参考数据】', '本段用途：提供其它只读参考资料。', otherReference, ''] : []),
            references.externalMemory ? block('【外部记忆】', '本段用途：提供外部记忆补充上下文。', references.externalMemory) : '',
          ].join('\n'),
        ],
      },
      { role: 'assistant', blocks: [formatStorylineRecentStory(body, names)] },
      {
        role: 'user',
        blocks: [
          [
            '【目标人物】',
            '本块用途：限定本次判定的叙事对象。',
            `姓名：${current.display_name || '相关人物'}`,
            ...(characterReference ? [characterReference] : []),
            '【已触发生理信号】',
            '本块用途：说明当前已经触发的观察信号，帮助沿支线创造自然条件；不得直接当作怀孕结论。',
            formatTriggeredSignals(triggeredSignals),
            '【已选支线】',
            '本块用途：提供唯一允许继续推进的支线及其节点。不得切换支线，也不得把支线计划当作怀孕事实。',
            branchText,
            '【任务要求】',
            '本块用途：说明本轮推进任务和返回约束。请判断当前支线动作：保持当前节点、推进到下一节点，或等待自然检查/结论。必须沿着这条支线创造条件推进剧情。',
          ].join('\n'),
        ],
      },
    ],
  })
}
export function parseStorylineJudgeResponse(response, snapshot) {
  const payload = parseJson(response)
  rejectForbidden(payload)
  const current = normalizeStorylineSnapshot(snapshot)
  if (current.status === 'candidates') {
    if (payload.branch_id !== null && typeof payload.branch_id !== 'string') throw new TypeError('STORYLINE_JUDGE_BRANCH_INVALID')
    if (payload.branch_id !== null && !current.branches.some(item => item.branch_id === payload.branch_id))
      throw new TypeError('STORYLINE_JUDGE_UNKNOWN_BRANCH')
    return applyStorylineJudge(current, payload)
  }
  if (!['stay', 'advance', 'awaiting_outcome'].includes(payload.action)) throw new TypeError('STORYLINE_JUDGE_ACTION_INVALID')
  return applyStorylineJudge(current, payload)
}
export function buildStorylineContextPrompt(snapshot) {
  const current = normalizeStorylineSnapshot(snapshot)
  if (current.status === 'terminated') return ''
  const branchText =
    current.status === 'candidates'
      ? current.branches
          .map((branch, index) => `${index + 1}. ${branch.title}：${branch.premise}；起始目标：${branch.nodes[0]?.objective}`)
          .join('\n')
      : `当前支线：${current.branches[0].title}\n当前目标：${current.branches[0].nodes[current.current_node_index]?.objective || current.branches[0].conclusion_goal}`
  return `<bioweave-storyline>\n角色：${current.display_name || '相关人物'}\n${branchText}\n必须主动创造条件推进剧情；${current.status === 'candidates' ? '本轮只能启动一条支线，启动后不得换线。' : '只能推进当前已选支线，不得切换。'}\n这不是怀孕事实，不能把支线内容当成已确认生理结论。\n</bioweave-storyline>`
}
