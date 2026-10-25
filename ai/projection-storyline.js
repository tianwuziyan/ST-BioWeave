import { applyStorylineJudge, buildStorylineBranchId, createStorylineSnapshot, normalizeStorylineSnapshot } from '../core/projection-storyline.js'
import { composePromptMessages, formatPromptContextContent } from './prompt-context.js'
const text = value => (typeof value === 'string' ? value.trim() : '')
const promptBlock = (strings, ...values) => {
  const markers = values.map((_, index) => `\u0000BIOWEAVE_PROMPT_${index}\u0000`)
  const raw = strings.reduce((result, part, index) => `${result}${part}${markers[index] ?? ''}`, '')
  const lines = raw.split('\n')
  const indent = lines.reduce((minimum, line) => {
    if (!line.trim()) return minimum
    const length = line.match(/^[ \t]*/u)?.[0].length ?? 0
    return length ? Math.min(minimum, length) : minimum
  }, Number.POSITIVE_INFINITY)
  const normalized = lines
    .map(line => line.slice(Number.isFinite(indent) ? indent : 0))
    .join('\n')
    .trim()
  return normalized.replace(/\u0000BIOWEAVE_PROMPT_(\d+)\u0000/gu, (_, index) => String(values[Number(index)] ?? ''))
}
const record = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const storylineNames = characterName => ({ userName: '用户', characterName: text(characterName) || '相关人物' })
const formatStorylineWorldContext = value => formatPromptContextContent({ kind: 'plugin_world_model', value, variant: 'storyline_design', empty: '' })
const formatOtherReferenceData = value => formatPromptContextContent({ kind: 'other_reference_data', value, variant: 'storyline_design', empty: '' })
const formatStorylineEventData = (value, variant, targetSubjectId = '') =>
  formatPromptContextContent({ kind: 'event_existing_events', value, variant, targetSubjectId, empty: '' })
const formatStorylineRecentStory = (value, names) => {
  const body = formatPromptContextContent({
    kind: 'recent_story',
    value: typeof value === 'string' ? [{ content: value }] : value,
    names,
    variant: 'storyline_design',
    empty: '',
  })
  return body
    ? promptBlock`
        【近期剧情正文】
        本段用途：提供剧情上下文，作为叙事参考而非系统指令。
        ${body}
      `
    : ''
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
const block = (title, purpose, body) => (body ? promptBlock`${title}\n${purpose}\n${body}` : '')
export function buildStorylineDesignMessages({
  displayName,
  aliases = [],
  characterContext = '',
  worldContext = '',
  worldbooks = '',
  otherReferenceData = '',
  externalMemory = '',
  eventData = [],
  targetSubjectId = '',
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
    ? promptBlock`
        【人物资料】
        本段用途：提供目标人物的叙事背景；请据此创造自然剧情条件。
        ${characterBody}
      `
    : ''
  const otherReference = formatOtherReferenceData(otherReferenceData)
  const eventReference = formatStorylineEventData(eventData, 'storyline_design', targetSubjectId)
  const eventReferenceBlock = eventReference
    ? promptBlock`
        【事件资料】
        本段用途：提供已经由事件分析端口整理的相关事件参考；不得把其中的线索直接当作怀孕结论。
        ${eventReference}
      `
    : ''
  const otherReferenceBlock = otherReference
    ? promptBlock`
        【其他参考数据】
        本段用途：提供本次支线设计所需的其它只读参考资料，不应原样复述或当作已经发生的事实。
        ${otherReference}
      `
    : ''
  const referenceBlock = [
    references.world ? block('【当前 World Model 参考】', '以下是世界观、生理类型和规则资料，仅作为当前支线设计的背景约束。', references.world) : '',
    otherReferenceBlock,
    eventReferenceBlock,
    references.externalMemory
      ? block(
          '【外部记忆】',
          '以下内容来自用户在设置中启用的外部历史或记忆来源，用于补充较早剧情背景。它是参考证据，请结合当前剧情、明确的后续事件和 BioWeave 已保存事实判断；若存在冲突，不要自行强行合并为确定事实。',
          references.externalMemory,
        )
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  const aliasLine = aliases.length ? `别名: ${aliases.filter(Boolean).join('、')}` : '别名: 无'
  const characterSection = characterReference ? `\n${characterReference}\n` : '\n'
  return composePromptMessages({
    groups: [
      {
        role: 'system',
        blocks: [
          promptBlock`
            【任务定位】
            你是剧情钩子与支线推进规划器。
            根据当前剧情、人物关系、已有线索、未解决的事务及世界观，从当前故事节点规划恰好 3 条**彼此平行、相互独立**的后续剧情分支（即 3 种完全不同的未来发展方向，而非同一时间线上的连续三章）。
            你的任务是设计能够自然延续故事、带来新经历与人物互动的剧情大纲，而不是针对当前问题提出三种处理方案。
            剧情可以来自日常生活、个人需求、人物关系、已有约定、工作事务、外部消息、偶然相遇、误解、意外事件或其他合理契机。

            【一、三条平行支线的题材彻底互斥与角色解耦（核心铁律）】
            三条支线必须是以当前状态为共同起点的 3 种不同未来发展可能，且必须满足以下三个维度的硬性隔离，**绝对不允许出现“多条支线处理同一个问题/围绕同一个NPC”的情况**：

            1. 焦点解耦与剧情驱动力分流：
              - 三条支线必须由不同的主要动机、人物需求或事件契机驱动，不得全部围绕同一人物的同一个问题展开。
              - 支线一【个人事务与日常计划】：由目标人物自身的计划、需求、兴趣、修炼或日常安排推动。
              - 支线二【人际博弈与外部势力】：由其他角色基于自身利益、立场、情感或计划主动发起。目标人物可以作为主要参与者，但不能是事件发生的唯一原因。
              - 支线三【环境变数与突发事件】：由已有环境、奇物、外部消息或合理的偶发事件触发，不得只是将前两条支线的人际问题包装成突发事故。
              - 三条支线可以共享人物和地点，但必须具有不同的核心驱动力、主要经历与后续发展方向。

            2. 核心题材彻底互斥：
              - 严禁把三条支线写成时间顺序上的“上集、中集、下集”。
              - 若当前故事存在某个显眼的突出状况（如身体不适、某项危机或某个未解悬念），全篇三条支线中，最多只允许其中一条支线涉及它，另外两条支线必须切换到完全无关的题材（如职场/宗门事务、外部冲突、寻宝、日常社交、解密等）**。

            【二、事实与人物边界】
            已发生的剧情、已确认的事实和明确的世界观设定可以直接使用。
            允许规划合理的未来事件、人物行动和意外变化，但不得将尚未发生的事件写成既成事实，也不得重复安排已经发生的事件。
            不得凭空增加未经确认的世界观机制、组织制度、固定活动、人物职责、特殊能力或人物关系。
            人物只能依据自己亲历、观察、听闻或合理推断的信息采取行动，不得直接利用其不可能掌握的秘密。
            允许人物猜测、误判、隐瞒或产生误解，但必须区分人物认知与客观事实。
            对于尚未确认的身体状况、身份、秘密、事件真相或其原因，不得将推测写成客观事实，也不得预设检查结果或最终真相；允许人物根据自身认知产生怀疑、误判或采取合理行动。
            人物的行动必须符合其性格、立场、关系亲疏、实际需求、能力与接触机会。大纲中不得预设特定的非专属NPC身份，优先使用已有角色或符合世界观的常规身份。

            【三、人物主动权】
            至少 1 条支线的起始事件必须由目标人物之外的角色基于自身动机主动发起，而非单纯回应目标人物的行为。
            其他人物在三条支线中应具有合理的自主行动，不得全部被动等待目标人物求助、拜访或询问。
            环境变数与突发事件可以由非人物因素触发，不强制安排 NPC 作为事件发起者。
            其他人物可以出于关心、兴趣、责任、利益、误解、敌意或复杂动机参与事件，不要求所有人都采取帮助性行为。
            第三方必须通过自身选择影响剧情，而不能仅充当传话、带路或提供工具的角色。
            优先使用已有角色及已建立的人物关系，不得为了推动剧情而随意赋予人物新的身份、职责、知识或亲密关系。

            【四、单条支线内的节点推进】
            每条平行支线内部恰好包含 3 个递进节点（代表该特定走向下的发展脉络）：
            三个节点必须是同一条分支故事中先后发生、彼此关联的三件独立剧情事件，而不是同一件事情的开始、过程和结束。
            每个节点应具有不同的主要事件内容，能够单独展开为一段剧情经历；后续节点可以由前一节点的结果自然引发，但不能只是继续完成同一次活动。
            一次拜访、一次谈话、一次购物、一次问诊、一次用餐或一次工作事务，即使包含多个动作、场景或短暂时间间隔，通常仍只算一个事件。不得将同一次活动拆分成多个节点。
            三个节点按照以下方式规划：
            第一节点：发生一件具体的事情，使人物开始新的行动、互动或经历，并自然引出后续发展。
            第二节点：在前一事件的影响下，经过合理的后续发展，发生另一件具有独立内容的事情，使故事继续向前。
            第三节点：在前两个事件的基础上，发生第三件独立的事情，使人物的经历、关系、事务或计划得到进一步发展，并留下自然的后续空间。
            节点之间可以通过因果关系、人物约定、日常安排、关系变化或时间推移衔接，但不能只是同一件事情尚未完成的步骤。
            【事件粒度检验】
            三个节点是否独立，重点不在于它们是否存在因果依赖，而在于它们是否分别具有独立的事件契机、主要行动和人物互动。
            如果三个节点能够在同一次会面或同一项连续活动中自然完成，通常说明它们只是同一事件的不同阶段，必须重新规划。
            如果某个节点只是为了让人物抵达下一节点的地点、获取下一节点的工具或完成下一节点的准备工作，而缺乏自身值得展开的剧情内容，也必须重新规划。

            允许前一事件改变人物关系、产生约定或留下影响，并由此促成另一件新的事件，但不得把同一任务的准备、执行和收尾分别写成三个节点。

            节点独立性只根据 objective 所规划的核心事件判断，不根据 completion_signal 是否结束事件判断。completion_signal 可以停在当前事件尚未结束的互动瞬间，但下一节点必须规划另一件独立事件，不得将前一节点尚未完成的对话、动作或活动继续拆分为新节点。

            【五、叙事尺度、风格与互动创意】
            规划的是自然发展的小说剧情，而不是任务简报、调查报告或危机处置方案。
            剧情的规模与严重程度应由当前故事、人物关系和实际处境决定，不得为了制造戏剧性而刻意放大事件。
            平淡不等于缺少故事内容。事件可以通过人物互动、新的经历、情感变化、利益关系、误会、选择或意外收获产生吸引力，不要求刻意制造冲突，但应避免只有日常动作而没有后续影响的流水账。
            三条支线在互动风格上应体现多样化与创意感，贴合当前题材氛围（无论是现代都市、古代宫廷、奇幻修仙还是科幻废土）。在涉及情感、私密或亲密场景规划时，应根据剧情需要主动探索不同的互动切入角度，例如：
            - 温柔体贴、情绪沉浸式互动
            - 角色主动掌控或被动顺从的性格展现
            - 充满趣味的嬉戏、调侃与玩闹
            - 巧妙利用环境、道具或特殊场域的事件
            - 带有轻度支配、身份错位或契约感的微妙互动
            - 具有试探性、情趣玩法或阶段性突破的动态进展
            严禁三条支线采用同一种情感互动模式，必须通过不同的风格与动作契机推动剧情。
            使用简洁、自然的小说大纲语言。标题应像章节小标题。

            【六、字段定义】
            title：简短、自然地概括支线或节点的主要事件（支线标题应体现出该分支独特的事件类型与走向。严禁在标题中出现任何具体的角色姓名或特定NPC名）。
            premise：不超过 50 字，用一句话概括该平行支线的起因、主要人物和即将展开的事情。只写剧情本身，不解释设计思路，不得将未来写成既成事实。允许提及目标人物的本名，但严禁在起因概括中写死任何其他具体的特定 NPC 姓名（如必须提及其他角色，应用“同行者”、“某执事”、“外部来客”等抽象泛指）。
            objective：30～70 字，描述当前节点计划发生的独立剧情事件。明确主要参与人物、核心事情及其与整条支线的联系。
            completion_signal：20～50 字，描述当前事件正处于哪个充满张力的转折点或未尽余波。应当停留在动作刚停、矛盾初现或情绪正要延展的动态瞬间，严禁给出事件的最终结局、死板收尾或静态画面，为后续正文互动留下充足空间。
            conclusion_goal：15～35 字。描述当前节点的独立事件可能自然引出的新悬念、待解冲突、人物选择或后续互动契机（如即将面临的新抉择、突发的偶然碰撞、待处理的私密约定等）。每个节点只写一个与自身事件相关的后续目标，不总结过去，不预设未知事实，不得仅以“继续怀疑/观察”为目标。该字段不代表下一节点必须执行的任务。三个节点的 conclusion_goal 不得构成同一任务的准备、执行与完成流程，也不得共同指向一个预设的唯一结局。

            【七、输出格式与检查】
            只输出合法 JSON，不使用 Markdown 代码围栏，不输出任何说明。
            顶层只能包含 branches，且恰好有 3 条平行支线。
            每条支线恰好包含 3 个节点；每个节点都必须同时包含 title、objective、completion_signal 和 conclusion_goal。
            所有 JSON 字符串只能包含自然的故事内容，严禁出现“机制：”“发展方向：”“设计思路：”等分析性标签。
            输出前先在内部检查三条候选支线：
            1. 确认 3 条支线是**互相平行的 3 个不同走向**，而不是顺次发生的连续剧情；
            2. **检查题材与视角是否完全互斥**：若 3 条支线全部围绕同一个核心痛点（如某个主角的身体不适或单一事件）展开，或者全部由同一个 NPC 轮流来找主角，必须判定为严重不合格，并立即推翻重新规划，确保三条支线分别属于“个人日常”、“人际博弈/外部冲突”和“环境变数”三个完全不同的题材方向；
            3. 若某条支线的三个节点可以合并为一次活动，必须整条重新规划。
            检查过程不输出，只输出最终 JSON。

            以下 JSON 仅展示单条支线的字段结构，实际输出时必须在 branches 数组中生成恰好 3 个完整支线对象，每条均包含恰好 3 个节点。不得增加,删除或重命名任何字段，不得输出空字符串、null 或占位内容。
            {
              "branches": [
                {
                  "title": "支线标题",
                  "premise": "不超过50字的起因与概括",
                  "nodes": [
                    {
                      "title": "节点一标题",
                      "objective": "节点一具体剧情事件与行动",
                      "completion_signal": "节点一事件中可供正文接续的动态切入点",
                      "conclusion_goal": "节点一可能引出的后续具体剧情目标"
                    },
                    {
                      "title": "节点二标题",
                      "objective": "节点二具体剧情事件与行动",
                      "completion_signal": "节点二事件中可供正文接续的动态切入点",
                      "conclusion_goal": "节点二可能引出的后续具体剧情目标"
                    },
                    {
                      "title": "节点三标题",
                      "objective": "节点三具体剧情事件与行动",
                      "completion_signal": "节点三事件中可供正文接续的动态切入点",
                      "conclusion_goal": "节点三可能引出的后续具体剧情目标"
                    }
                  ]
                }
              ]
            }
          `,
        ],
      },
      {
        role: 'system',
        blocks: [referenceBlock],
      },
      { role: 'assistant', blocks: [formatStorylineRecentStory(recentStory, names)] },
      {
        role: 'user',
        blocks: [
          promptBlock`
            【目标人物】
            本块用途：限定本次支线分析的叙事对象；只围绕这名人物设计或判断剧情。
            姓名: ${name}
            ${aliasLine}
            ${characterSection}
            【已触发生理信号】
            本块用途：说明当前已经触发的观察信号，帮助剧情创造检查或就医契机；不得直接当作怀孕结论。
            ${formatTriggeredSignals(triggeredSignals)}

            【任务要求】
            请根据提供的当前剧情、历史事实和世界观，为目标人物设计恰好 3 条简短、自然且互不重复的剧情支线。
            目标是让人物有机会在后续剧情中接触身体检查、观察或生理信息，而不是直接确认怀孕或其他生理结论。
            优先从已有事件和人物关系出发，不要为了引出检查而编造症状、制度或复杂任务。
            每条支线恰好 3 个节点，按 System 指定的 JSON 格式输出。

          `,
        ],
      },
    ],
  })
}
export function parseStorylineDesignResponse(response, { subjectId, displayName, floorVersion } = {}) {
  const payload = parseJson(response)
  rejectForbidden(payload)
  if (!Array.isArray(payload.branches) || payload.branches.length !== 3) throw new TypeError('STORYLINE_DESIGN_BRANCH_COUNT')
  for (const branch of payload.branches) {
    if (
      !record(branch) ||
      Object.hasOwn(branch, 'conclusion_goal') ||
      !Array.isArray(branch.nodes) ||
      branch.nodes.some(
        node => !record(node) || !text(node.title) || !text(node.objective) || !text(node.completion_signal) || !text(node.conclusion_goal),
      )
    )
      throw new TypeError('STORYLINE_DESIGN_NODE_FIELDS')
  }
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
  // `body` is retained as a compatibility fallback for direct callers. The
  // runtime must pass the configured recent-story context separately; the
  // two bodies used to satisfy cadence are not the prompt context contract.
  recentStory = null,
  mode = null,
  triggeredSignals = [],
  characterContext = '',
  worldContext = '',
  worldbooks = '',
  otherReferenceData = '',
  externalMemory = '',
  eventData = [],
  targetSubjectId = '',
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
    ? promptBlock`
        【人物资料】
        本段用途：提供目标人物的叙事背景；请据此创造自然剧情条件。
        ${characterBody}
      `
    : ''
  const otherReference = formatOtherReferenceData(otherReferenceData)
  const eventReference = formatStorylineEventData(eventData, 'storyline_judge', targetSubjectId)
  const eventReferenceBlock = eventReference
    ? promptBlock`
        【事件资料】
        本段用途：提供已经由事件分析端口整理的相关事件参考；不得把其中的线索直接当作怀孕结论。
        ${eventReference}
      `
    : ''
  const otherReferenceBlock = otherReference
    ? promptBlock`
        【其他参考数据】
        本段用途：提供其它只读参考资料。
        ${otherReference}
      `
    : ''
  const referenceBlock = [
    references.world ? block('【当前 World Model 参考】', '以下是世界观、生理类型和规则资料，仅作为当前支线设计的背景约束。', references.world) : '',
    otherReferenceBlock,
    eventReferenceBlock,
    references.externalMemory ? block('【外部记忆】', '本段用途：提供外部记忆补充上下文。', references.externalMemory) : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  const characterSection = characterReference ? `${characterReference}\n` : ''
  const branchText = current.branches
    .map((item, index) =>
      [
        `- 支线 ${index + 1}:`,
        `  支线编号: ${item.branch_id}`,
        `  标题: ${item.title}`,
        `  前提: ${item.premise}`,
        '  节点:',
        ...item.nodes.flatMap(node => [
          `    - 标题: ${node.title}`,
          `      目标: ${node.objective}`,
          `      完成信号: ${node.completion_signal}`,
          `      结论目标: ${node.conclusion_goal}`,
        ]),
      ].join('\n'),
    )
    .join('\n\n')
  if (effectiveMode === 'selection')
    return composePromptMessages({
      groups: [
        {
          role: 'system',
          blocks: [
            promptBlock`
              【剧情支线分析规则】
              根据正文判断哪一条候选支线已经被正文主动启动。必须推动剧情创造条件，不能以“不适合当前情节”为理由回避。

              【JSON 输出协议】
              输出协议：只能返回 JSON 对象 {"branch_id":"支线编号"} 或 {"branch_id":null}；不得返回人物内部标识、周期标识、妊娠标识或怀孕结论。
            `,
          ],
        },
        {
          role: 'system',
          blocks: [referenceBlock],
        },
        { role: 'assistant', blocks: [formatStorylineRecentStory(recentStory ?? body, names)] },
        {
          role: 'user',
          blocks: [
            promptBlock`
              【目标人物】
              本块用途：限定本次判定的叙事对象。
              姓名: ${current.display_name || '相关人物'}
              ${characterSection}【已触发生理信号】
              本块用途：说明当前已经触发的观察信号，帮助判断支线是否已被正文启动；不得直接当作怀孕结论。
              ${formatTriggeredSignals(triggeredSignals)}

              【候选支线】
              本块用途：列出本楼可被启动的候选。支线编号只是 Host 提供的选线令牌，只能从这些编号中选择一个或返回 null。
              ${branchText}

              【任务要求】
              本块用途：说明本轮选线任务和返回约束。请返回唯一已启动支线的 branch_id；如果正文尚未明确启动任何一条，返回 null。必须推动剧情创造条件，不能以“不适合当前情节”为理由回避。
            `,
          ],
        },
      ],
    })
  return composePromptMessages({
    groups: [
      {
        role: 'system',
        blocks: [
          promptBlock`
            【剧情支线分析规则】
            根据正文判断当前已选支线是否推进。必须沿着这条支线创造条件，不得换线。

            【JSON 输出协议】
            输出协议：只能返回 JSON 对象 {"action":"stay"}、{"action":"advance"} 或 {"action":"awaiting_outcome"}；不得返回怀孕事实。
          `,
        ],
      },
      {
        role: 'system',
        blocks: [referenceBlock],
      },
      { role: 'assistant', blocks: [formatStorylineRecentStory(recentStory ?? body, names)] },
      {
        role: 'user',
        blocks: [
          promptBlock`
            【目标人物】
            本块用途：限定本次判定的叙事对象。
            姓名: ${current.display_name || '相关人物'}
            ${characterSection}【已触发生理信号】
            本块用途：说明当前已经触发的观察信号，帮助沿支线创造自然条件；不得直接当作怀孕结论。
            ${formatTriggeredSignals(triggeredSignals)}

            【已选支线】
            本块用途：提供唯一允许继续推进的支线及其节点。不得切换支线，也不得把支线计划当作怀孕事实。
            ${branchText}

            【任务要求】
            本块用途：说明本轮推进任务和返回约束。请判断当前支线动作：保持当前节点、推进到下一节点，或等待自然检查/结论。必须沿着这条支线创造条件推进剧情。
          `,
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
