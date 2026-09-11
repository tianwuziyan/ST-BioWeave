import { normalizeAnalysisPrompt, WORLD_MODEL_SCHEMA } from '../storage/schema.js'
import {
  CAPABILITY_KEYS,
  EVENT_STATUS as DOMAIN_EVENT_STATUS,
  EVENT_TYPES as DOMAIN_EVENT_TYPES,
  REPRODUCTIVE_ROLES,
  STORY_TIME_PRECISIONS,
} from '../core/events.js'
import { normalizeEventAnalysisInput } from './input-builder.js'
export { WORLD_MODEL_SCHEMA }
export const CORE_PROMPTS = {
  world: 'Analyze world rules into the required JSON schema. Unknown facts remain unknown.',
  event: 'Extract biological facts from the target Floor Version. Do not convert symptoms into confirmed pregnancy.',
  projection: 'Generate non-factual future possibilities only. Never rewrite history.',
}
export const WORLD_MODEL_SCHEMA_TEXT = JSON.stringify(WORLD_MODEL_SCHEMA, null, 2)

export const EVENT_TYPES = Object.freeze([...DOMAIN_EVENT_TYPES])
export const EVENT_STATUS = Object.freeze([...DOMAIN_EVENT_STATUS])
export const EVENT_REPRODUCTIVE_ROLES = Object.freeze([...REPRODUCTIVE_ROLES])
export const EVENT_CAPABILITY_KEYS = Object.freeze([...CAPABILITY_KEYS])
export const EVENT_STORY_TIME_PRECISIONS = Object.freeze([...STORY_TIME_PRECISIONS])

export const EVENT_ANALYZER_CORE_CONTRACT = [
  '你是 BioWeave 的 BiologicalEvent 事实提取器。只提取当前 Floor Version 与输入证据明确支持的事件，不输出分析过程或自然语言解释。',
  '重点识别 sexual_activity，但必须兼容其它 BiologicalEvent 类型（包括 medical_event、physical_symptom、conception、pregnancy_suspicion、pregnancy_confirmation、pregnancy_loss、labor、delivery、postpartum、menstrual_event、ovulation_event、fertility_change、abortion、other_biological）。不要把所有事件强行分类为 sexual_activity。',
  '对 sexual_activity 提取结构化 Story Time、地点和全部实际参与者；不要只列主角、不要只列有生殖角色的参与者。参与者使用稳定 character_id，姓名只作为 display_name。',
  '同时阅读 World Model baseline 与当前 Floor / recent_context 的 narrative evidence。World Model baseline 只提供已知生物学能力背景，narrative evidence 只记录本次剧情事实；二者不能互相臆造或跨角色借证。',
  'event_role 与 gender/biological_type 是不同字段。只能依据 capability 与事件证据填写 reproductive role；不得从 gender、性别词、攻受、姓名、外貌或社会角色推导 can_carry_pregnancy、can_cause_pregnancy 或其它 capability。不要添加 gender eligibility 分支。',
  'reproductive_capabilities_used 固定包含 can_produce_sperm、can_produce_ova、can_be_fertilized、can_carry_pregnancy、can_cause_pregnancy；每个值只能是 true、false 或 null。null 表示未知/没有证据，禁止把 unknown、缺失、模糊描述或模型常识自动变成 true。',
  'pregnancy_relevance.gestational_subject_ids[] 与 counterpart_ids[] 永远是稳定 character_id 数组，分别允许 0、1 或 N 个值；不要输出逗号拼接字符串，也不要用姓名代替 ID。',
  '不要因为 NSFW、性交、体液、症状、恶心、腹痛或其它 physical_symptom 自动判定 conception 或 pregnancy；只有 World Model baseline 与 narrative evidence 共同明确支持时才填写 possible_conception 或 pregnancy relevance。',
  '不要把 UI 显示、人物列表或其它后续层的判断写入结果；UI 不会也不应二次判断生殖资格。输出的是完整事实 DTO。',
].join('\n')

export const EVENT_ANALYZER_TASK_CONTRACT = [
  '任务：只分析【本次目标楼层】中实际发生或有可靠证据支持的 BiologicalEvent，并返回完整 events 数组。',
  'Recent Story 只作为前置剧情参考；目标楼层是本次事件事实的唯一直接提取对象。',
  '不要把预测、症状或可能性写成已经发生的受孕或妊娠事实。',
].join('\n')

export const EVENT_ANALYZER_OUTPUT_CONTRACT = [
  '只输出一个完整、可直接 JSON.parse 的 JSON 对象，不要 Markdown、代码围栏、前后解释或半结构化文本。顶层固定为 {"schema_version":1,"events":[]}；唯一允许的旧兼容顶层字段是会被忽略的 source，任何其它未知顶层字段都必须拒绝。',
  'AI Event DTO 不生成 event_id 或 source；它们不是 AI 事实字段。Runtime 会按响应顺序生成 deterministic、同一响应内唯一且不依赖 display_name 的 event_id，并强制绑定 authoritative Floor Version。若兼容旧响应而出现 event.event_id、event.source，它们会被忽略，不能覆盖 Runtime 身份。',
  `event.type 只能取：${EVENT_TYPES.join('、')}。event.status 只能取：${EVENT_STATUS.join('、')}。不得创造其它枚举值。`,
  `story_time 必须是结构化对象：display、normalized、calendar_id、day_index、provider、precision、confidence；precision 只能取：${EVENT_STORY_TIME_PRECISIONS.join('、')}；不可靠的 normalized/day_index 使用 null，不要从模糊 display 伪造日期。`,
  'story_time.day_index 只有在证据提供真实、连续且可排序的 canonical index 时才能填写 number；否则必须是 null。不要把月内第几日或 display 文本解析成 day_index，时间计算不读取 display。',
  `participants 必须是完整数组；每项包含 character_id、display_name、event_role、reproductive_capabilities_used 和 evidence，可带最小 biological_context。event_role 只能取：${EVENT_REPRODUCTIVE_ROLES.join('、')}。它表示本事件中的生殖角色，不表示姿势、主动/被动、攻/受、职业、性别或社会角色。不要省略实际参与者。`,
  `reproductive_capabilities_used 固定包含 ${EVENT_CAPABILITY_KEYS.join('、')}；每个值只能是 true、false 或 null。`,
  'participant.evidence 与 source_evidence 都必须是数组；每项必须是 {"kind":"...","text":"..."} 对象，kind 和 text 都是非空字符串。不得输出裸字符串、content 替代 text 或其它 evidence 形状。',
  '每个 event 必须包含 type、status、story_time、location、participants、pregnancy_relevance、source_evidence；physical_effect 是可选对象。',
  'pregnancy_relevance 必须包含 relevant、possible_conception、gestational_subject_ids[]、counterpart_ids[]、confidence；relevant 与 possible_conception 都只能是 boolean，不能是 null、字符串或 probable/possible/unknown。两个 ID 字段始终是数组，可为空、单个或多个；不能是字符串。',
  'confidence 只能是 null 或 0 到 1 之间的 number。',
  '模型不要生成 source；六字段 Floor Version 只存在于输入的 Authoritative Floor Metadata，并由 Runtime 写入最终 Event：chat_id、message_id、floor、swipe_id、content_hash、message_version。',
].join('\n')

export const EVENT_ANALYZER_SCHEMA = Object.freeze({
  schema_version: 1,
  events: [],
})
export const EVENT_ANALYZER_SCHEMA_TEXT = JSON.stringify(EVENT_ANALYZER_SCHEMA, null, 2)
const WORLD_MODEL_CORE_INSTRUCTIONS = [
  '任务：从本次 AnalysisInput 提取当前 Chat 的生物学 World Model。只使用资料实际支持的内容，不把模型常识补写成 species、biological_type、能力或规则。',
  '结构与 biological_type Contract：按 species → biological_types → capabilities / reproduction_rules / lifecycle / special_rules 分层。species.name 和 biological_type.name 都是开放字符串；species 回答“这是什么生物”；biological_type 只回答“该 species 内属于哪一种稳定的生理/生殖分类”，也就是该 species 内稳定存在的性别、生殖角色或直接影响生殖机制的生物分类。它不表示 species、亚种、血统、职业、身份、阵营、来源、属性、等级、形态等其它分类轴。固定生殖分类必须由资料支持；候选 type 必须同时满足以下 A–E 才能保留：A. 明确位于同一 species 内；B. 是稳定存在的分类，而非一次性或条件状态；C. 直接涉及身体结构、生理机制、生殖角色或生殖能力；D. 去掉职业、身份、社会角色、组织归属、文化群体、阵营、能力体系、等级或成长阶段等非生物背景后仍成立；E. 当前 AnalysisInput 对该分类有充分直接证据。species 别名、普通 taxonomy 子类、职业、身份、社会角色、组织归属、文化群体、阵营、能力体系、等级/境界、成长阶段、训练状态、临时或可逆身体变化、疾病或异常状态、个体特质、行为模式及其它非稳定生物分类均排除；任一条件不满足就不要建立 type。证据不足时保留 biological_types: []；空数组优于错误分类，不要猜测。',
  '证据：每个 species、biological_type 和字段独立分析；不跨 species 或跨 biological_type 借证据。五个 capability 逐字段独立举证：明确支持才写 true/false，其中 true 需要明确具备证据、false 需要明确不具备证据；未说明、未知或仅凭“通常/一般”不足以判断时写 null，不要把它们写成 false。除已建立的普通人类男性/女性 baseline 外，不从男性、女性、雄性、雌性等名称推导能力；固定双性统一使用名称“双性”。',
  'Human baseline 与显式 delta：Human 是唯一内置的现实生物 baseline。只有当前资料支持普通人类背景时才建立“人类”；这种支持可以来自显式 Human/人类，也可以来自完整 AnalysisInput（Character Card、Worldbook、Recent Story、External Memory 和当前上下文）合并后对普通人类默认背景的可靠支持。明确独立 Nonhuman、陌生生命、明显不同身体结构或生理体系、相互冲突的证据或无法判断时禁止 fallback；没有 species、没有 Human 字样、类人外形、男性/女性称谓、性交行为或社会结构本身都不是充分条件，无法可靠判断就保留未知。先判断基础来源，再把当前个体事实、明确转化后/特殊体系规则、明确世界级规则逐 capability、逐 reproduction_rules、逐 lifecycle 字段覆盖 baseline；优先级为明确当前个体事实 > 明确转化后/特殊体系规则 > 明确世界级规则 > 可靠推断的 Human baseline > 未知。delta 只覆盖明确改变的字段，其余稳定字段保留；规则字段只有在已知不存在或已知不适用时写“无”，未知、未提及或证据不足仍写 null；未成立的 biological_types 保持 []。Human baseline 不创建缺失 type，只适用于已成立的普通 Human Male/Female，不适用于其它 Human type。普通 Human Male 已知不适用的 pregnancy_or_carrying、cycle、ovulation、gestation、labor 使用“无”；普通 Human Female 的 cycle、ovulation、gestation、labor 使用简洁 baseline。若资料明确将永久变化后的对象定义为新 species，输出当前 species label 与合成后的当前字段，不新增 source_species、origin 或 inheritance 字段；个体 Human 来源也不能自动扩展为整个新 species 的来源。',
  '规则值与 Nonhuman 字段语义：对 reproduction_rules 和 lifecycle 的 string 字段，null 只表示未知、未提及、证据不足或无法判断；“无”只表示已经知道不存在、明确不具备或明确不适用；非空描述表示已知存在对应机制。非 Human 没有资料时必须保持 null，不能把未知写成“无”。只依据本次 AnalysisInput，不使用模型自身常识，也不从 biological_type 名称套用 Human template；即使类人、使用男性/女性名称、具有类似器官或性交行为，非人类字段仍需该 species 和该 type 的直接证据，不能继承 Human baseline。fertilization 只描述真实受精、授精或配子结合机制，并说明当前 type 的供体/受体角色；性交、体液/能量交换、感染/寄生、侵蚀/异化、身体改造、觉醒、个体生成、力量或关系变化本身都不等于 fertilization。若资料明确不存在受精机制才写“无”，否则未知仍为 null。gestation 只描述真实妊娠或孕育过程，非妊娠的身体转化不属于 gestation。lifecycle.maturation 只描述生物成熟或生命阶段变化，aging 只描述寿命、衰老或明确抗衰老生理；职业、修炼、技能、关系或力量 progression 不属于生命周期。资料明确声明与人类相同，也只继承被声明的范围；未知能力、规则或生命周期字段保持 null。',
  '临时状态与内部自检：临时、可逆或条件性的性征、器官或生殖能力变化留在已有 type 的规则/例外中，不能建立新的 biological_type。输出前进行内部自检（不要输出过程）：对每个候选执行 A–E；即使只有一个候选，也要额外确认它是独立且稳定的 biological classification，不能因数量为一自动保留；再检查每个非 null capability 的直接依据、fertilization 是否真的描述受精、lifecycle 是否真的描述生命周期。没有可靠答案就把字段降为 null 或删除错误 type。medical_context、exceptions、unknowns 只记录资料明确支持的内容。',
].join('\n')
// 只用普通文字描述输出字段，避免把格式围栏或大段 schema 代码发送给后端。
const WORLD_MODEL_OUTPUT_CONTRACT = [
  '只输出一个结构化对象，不要输出解释文字、Markdown 或代码围栏；schema_version 固定为 1。JSON key 使用 schema 规定的英文，说明、规则和列表字符串使用中文。',
  '顶层只包含 schema_version、species、medical_context、exceptions、unknowns；不得出现顶层 biological_types 或 species 级 capabilities。',
  'species[] 包含 name、description、biological_types[]；每个 biological_type 包含 name、description、capabilities、reproduction_rules、lifecycle、special_rules。',
  'capabilities 只能位于 biological_types 下，固定包含五个 key：can_produce_sperm、can_produce_ova、can_be_fertilized、can_fertilize、can_carry_pregnancy；值只能是 true、false 或 null。',
  'reproduction_rules 固定包含 fertilization、pregnancy_or_carrying、cycle、ovulation、gestation、labor；lifecycle 固定包含 maturation、aging。规则字段只能使用 null、非空中文描述或 canonical absence value“无”：null 是未知/证据不足，非空描述是已知存在，“无”是已知不存在/不适用；没有提到或无法判断时不要写“无”。其它未知标量为 null，列表为数组。',
  'medical_context 固定包含 childbirth_difficulty、care_level、evidence，均为 nullable string。',
].join('\n')
const HISTORY_MEMORY_CONTEXT = [
  '【外部历史参考信息】',
  '以下内容来自用户在设置中启用的外部历史或记忆来源，用于补充较早剧情背景。它是参考证据，请结合当前剧情、明确的后续事件和 BioWeave 已保存事实判断；若存在冲突，不要自行强行合并为确定事实。',
].join('\n')
function readableText(value) {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .trim()
}
function expandPlaceholders(value, names) {
  return readableText(value)
    .replace(/\{\{user\}\}|<user>/gi, names.userName)
    .replace(/\{\{char\}\}|<char>/gi, names.characterName)
}
function addBlock(lines, title, value, names = { userName: '用户', characterName: '角色' }) {
  const text = expandPlaceholders(value, names)
  if (!text) return
  lines.push(`${title}\n${text}`)
}

function addMessage(messages, role, content) {
  const text = readableText(content)
  if (text) messages.push({role, content: text})
}

function formatPromptValue(value, indent = 0, seen = new Set()) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return readableText(value) || '（空）'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value !== 'object') return '（不支持的值）'
  if (seen.has(value)) return '（重复引用已省略）'
  seen.add(value)
  if (Array.isArray(value)) {
    if (!value.length) return '（空数组）'
    return value.map(item => `${' '.repeat(indent)}- ${formatPromptValue(item, indent + 2, seen)}`).join('\n')
  }
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
  if (!entries.length) return '（空对象）'
  return entries.map(([key, item]) => {
    const valueText = formatPromptValue(item, indent + 2, seen)
    if (valueText.includes('\n')) return `${' '.repeat(indent)}${key}:\n${valueText}`
    return `${' '.repeat(indent)}${key}: ${valueText}`
  }).join('\n')
}

function hasPromptValue(value, seen = new Set()) {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return Boolean(readableText(value))
  if (typeof value === 'number' || typeof value === 'boolean') return true
  if (typeof value !== 'object' || seen.has(value)) return false
  seen.add(value)
  return Array.isArray(value)
    ? value.some(item => hasPromptValue(item, seen))
    : Object.values(value).some(item => hasPromptValue(item, seen))
}

function eventContextBlock(title, value, fallback = '（本次没有可用内容）') {
  const rendered = formatPromptValue(value)
  return `${title}\n${rendered === 'null' || rendered === '（空对象）' ? fallback : rendered}`
}

function formatCommonAnalysisPrompt(settings, names) {
  const blocks = [settings.task, settings.input_prefix]
    .map(value => expandPlaceholders(value, names))
    .filter(Boolean)
  return blocks.length
    ? `【公共分析提示词】\n${blocks.join('\n\n')}`
    : ''
}

function formatAnalysisPromptTail(settings, names) {
  const blocks = [settings.input_suffix]
    .map(value => expandPlaceholders(value, names))
    .filter(Boolean)
  return blocks.length
    ? `【公共分析补充】\n${blocks.join('\n\n')}`
    : ''
}

function formatCharacterReference(input, names) {
  const character = input?.character && typeof input.character === 'object'
    ? input.character
    : {}
  const lines = []
  addBlock(lines, '角色背景', character.description, names)
  for (const greeting of Array.isArray(character.greetings) ? character.greetings : []) {
    addBlock(lines, greeting?.is_current ? '开场信息（当前）' : greeting?.label || '开场信息', greeting?.content, names)
  }
  if (!lines.length) return ''
  return [
    `【角色卡：${names.characterName} 的背景资料】`,
    '以下内容来自当前角色卡中用户允许 BioWeave 读取的字段，仅作为本次分析的背景资料与证据参考。角色卡未描述的内容不能因此自动视为已知事实。',
    lines.join('\n\n'),
  ].join('\n')
}

function formatWorldbookReference(worldbooks, names) {
  const lines = []
  for (const worldbook of Array.isArray(worldbooks) ? worldbooks : []) {
    for (const entry of Array.isArray(worldbook?.entries) ? worldbook.entries : []) {
      const content = expandPlaceholders(entry?.content, names)
      if (!content) continue
      const label = expandPlaceholders(entry?.label || '未命名条目', names)
      lines.push(`【条目：${label}】\n${content}`)
    }
  }
  if (!lines.length) return ''
  return [
    '【世界书参考资料】',
    '以下内容来自用户在 BioWeave 设置中选择的世界书条目，请作为世界观、生物规则和背景资料的参考证据。若当前剧情存在明确的后续变化或个体例外，应结合当前剧情判断，不要机械覆盖当前事实。',
    lines.join('\n\n'),
  ].join('\n')
}

function formatPersonaReference(persona, names) {
  const value = persona && typeof persona === 'object' ? persona : {}
  const lines = []
  addBlock(lines, '人物名称', value.name || names.userName, names)
  addBlock(lines, '人物设定', value.description, names)
  if (!value.description) return ''
  return [
    `【${names.userName} 的人物设定】`,
    '以下内容来自 SillyTavern 当前启用的用户人物设定，仅供理解人物关系、身份背景和剧情事件时参考。人物设定本身不代表当前目标楼层一定发生了其中描述的事件。',
    lines.join('\n\n'),
  ].join('\n')
}

function formatExternalMemoryReference(externalMemory, names) {
  const lines = []
  for (const provider of Array.isArray(externalMemory) ? externalMemory : []) {
    if (provider?.enabled !== true
      || provider?.available !== true
      || provider?.content_available !== true
      || ['disabled', 'unavailable', 'error'].includes(provider?.read_status)) continue
    for (const item of Array.isArray(provider?.items) ? provider.items : []) {
      const content = expandPlaceholders(item?.content, names)
      if (!content) continue
      const label = expandPlaceholders(item?.label || provider?.label || '历史记录', names)
      lines.push(`【${label}】\n${content}`)
    }
  }
  if (!lines.length) return ''
  return [HISTORY_MEMORY_CONTEXT, lines.join('\n\n')].join('\n')
}

function formatWorldModelReference(worldModel) {
  if (!hasPromptValue(worldModel)) return ''
  const rendered = formatPromptValue(worldModel)
  return [
    '【当前 World Model 参考】',
    '以下内容是已经保存的 World Model baseline，仅作为生物规则和能力背景参考；它不是本次目标楼层已经发生的事件事实。',
    rendered,
  ].join('\n')
}

function formatExistingBioWeaveReference(existing) {
  if (!hasPromptValue(existing)) return ''
  const rendered = formatPromptValue(existing)
  return [
    '【现有 BioWeave 事实参考】',
    '以下是当前 Chat 已保存的结构化事实参考，用于避免重复或理解已有记录；不要把它改写成当前目标楼层的新事实。',
    rendered,
  ].join('\n')
}

function formatStoryTimeReference(storyTime, names) {
  if (!storyTime || typeof storyTime !== 'object') return ''
  const display = expandPlaceholders(storyTime.display, names)
  const normalized = expandPlaceholders(storyTime.normalized, names)
  const calendarId = expandPlaceholders(storyTime.calendar_id, names)
  const provider = expandPlaceholders(storyTime.provider, names)
  const hasKnownValue = Boolean(display || normalized || calendarId || provider
    || storyTime.day_index !== null && storyTime.day_index !== undefined
    || storyTime.precision && storyTime.precision !== 'unknown'
    || storyTime.confidence !== null && storyTime.confidence !== undefined)
  if (!hasKnownValue) return ''
  return [
    '故事时间结构化参考：',
    `显示：${display || '未知'}`,
    `标准化时间：${normalized || '未知'}`,
    `日历：${calendarId || '未知'}`,
    `连续日索引：${storyTime.day_index === null || storyTime.day_index === undefined ? '未知' : formatPromptValue(storyTime.day_index)}`,
    `提供者：${provider || '未知'}`,
    `精度：${expandPlaceholders(storyTime.precision, names) || '未知'}`,
    `置信度：${storyTime.confidence === null || storyTime.confidence === undefined ? '未知' : formatPromptValue(storyTime.confidence)}`,
  ].join('\n')
}

function narrativeItemsMatch(left, right) {
  if (!left || !right) return false
  const leftMessageId = readableText(left.message_id ?? left.messageId)
  const rightMessageId = readableText(right.message_id ?? right.messageId)
  const leftSwipeId = Number.isInteger(left.swipe_id) ? left.swipe_id : null
  const rightSwipeId = Number.isInteger(right.swipe_id) ? right.swipe_id : null
  if (leftMessageId && rightMessageId) {
    return leftMessageId === rightMessageId
      && (leftSwipeId === null || rightSwipeId === null || leftSwipeId === rightSwipeId)
  }
  const leftFloor = left.floor === null || left.floor === undefined ? null : Number(left.floor)
  const rightFloor = right.floor === null || right.floor === undefined ? null : Number(right.floor)
  return Number.isFinite(leftFloor) && Number.isFinite(rightFloor) && leftFloor === rightFloor
}

function formatNarrativeContent(item, names) {
  return expandPlaceholders(item?.content ?? item?.narrative, names)
}

function formatNarrativeContext(items, targetItem = null, names, storyTime = null) {
  const recentItems = (Array.isArray(items) ? items : [])
    .filter(item => !narrativeItemsMatch(item, targetItem))
  const recentContent = recentItems
    .map(item => formatNarrativeContent(item, names))
    .filter(Boolean)
  if (!targetItem) {
    return recentContent.length
      ? ['【近期剧情参考】', recentContent.join('\n\n')].join('\n\n')
      : ''
  }

  const targetContent = formatNarrativeContent(targetItem, names)
  const sections = []
  if (recentContent.length) sections.push(['【剧情上下文】', recentContent.join('\n\n')].join('\n\n'))
  if (targetContent) {
    sections.push([
      '【本次分析内容】',
      formatStoryTimeReference(storyTime, names),
      targetContent,
    ].filter(Boolean).join('\n\n'))
  }
  return sections.join('\n\n')
}

function formatEventCharacterReference(input, names) {
  return formatCharacterReference({character: input?.character}, names)
}

const EVENT_CHARACTER_CAPABILITY_LABELS = Object.freeze({
  can_produce_sperm: '可产生精子',
  can_produce_ova: '可产生卵子',
  can_be_fertilized: '可被受精',
  can_cause_pregnancy: '可导致受孕',
  can_carry_pregnancy: '可承载妊娠',
})

function formatEventCharacterContext(characterContext, names) {
  const value = characterContext && typeof characterContext === 'object' && !Array.isArray(characterContext)
    ? characterContext
    : {}
  const profiles = value.profiles && typeof value.profiles === 'object' && !Array.isArray(value.profiles)
    ? value.profiles
    : {}
  const profileBlocks = Object.entries(profiles).map(([fallbackId, rawProfile]) => {
    const profile = rawProfile && typeof rawProfile === 'object' && !Array.isArray(rawProfile)
      ? rawProfile
      : {}
    const characterId = expandPlaceholders(profile.character_id ?? fallbackId, names)
    if (!characterId) return ''
    const lines = [`角色标识：${characterId}`]
    const displayName = expandPlaceholders(profile.display_name, names)
    const species = expandPlaceholders(profile.species, names)
    const biologicalType = expandPlaceholders(profile.biological_type, names)
    if (displayName) lines.push(`显示名称：${displayName}`)
    if (species) lines.push(`物种：${species}`)
    if (biologicalType) lines.push(`生物类型：${biologicalType}`)

    const capabilities = profile.reproductive_capabilities
      ?? profile.reproductive_capabilities_used
    if (capabilities && typeof capabilities === 'object' && !Array.isArray(capabilities)) {
      lines.push('已知生殖能力：')
      for (const key of EVENT_CAPABILITY_KEYS) {
        const value = capabilities[key] === true || capabilities[key] === false || capabilities[key] === null
          ? capabilities[key]
          : null
        lines.push(`- ${EVENT_CHARACTER_CAPABILITY_LABELS[key] ?? key}：${value === null ? '未知' : value ? '是' : '否'}`)
      }
    }

    const evidence = Array.isArray(profile.evidence)
      ? profile.evidence.map(item => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const text = expandPlaceholders(item.text ?? item.content, names)
          const kind = expandPlaceholders(item.kind, names)
          return text ? `${kind ? `${kind}：` : ''}${text}` : ''
        }
        return expandPlaceholders(item, names)
      }).filter(Boolean)
      : []
    if (evidence.length) {
      lines.push('资料证据：')
      evidence.forEach(item => lines.push(`- ${item}`))
    }
    return lines.join('\n')
  }).filter(Boolean)
  const currentCharacter = expandPlaceholders(value.current_character ?? value.currentCharacter, names)
  if (!currentCharacter && !profileBlocks.length) return ''
  return [
    '【事件相关角色参考】',
    '以下内容来自 BioWeave 已建立的角色资料，仅作为角色身份和已知能力的背景证据参考；它不代表本次目标楼层已经发生了任何事件，也不能替代当前剧情证据。',
    currentCharacter ? `当前角色显示名：${currentCharacter}` : '',
    profileBlocks.join('\n\n'),
  ].filter(Boolean).join('\n')
}

function formatEventFloorMetadata(input) {
  const scope = input.chat_scope && typeof input.chat_scope === 'object' ? input.chat_scope : {}
  const version = input.floor_version && typeof input.floor_version === 'object' ? input.floor_version : {}
  return [
    '【本次分析边界】',
    `目标楼层：${formatPromptValue(version.floor)}`,
    `目标消息：${formatPromptValue(version.message_id)}`,
    `目标 Swipe：${formatPromptValue(version.swipe_id)}`,
    scope.chat_id ? '当前 Chat 边界已由 Runtime 校验。' : '',
    '以上字段仅用于限定本次输入边界，不要复制到 Event 输出；Event source 由 Runtime 绑定。',
  ].join('\n')
}

function joinPromptSections(sections) {
  return sections.filter(Boolean).join('\n\n')
}

function formatWorldModelRules(settings, names) {
  return joinPromptSections([
    `【BioWeave World Model 分析规则】\n${WORLD_MODEL_CORE_INSTRUCTIONS}`,
    formatCommonAnalysisPrompt(settings, names),
    `【World Model 任务】\n${WORLD_MODEL_TASK_PROMPT}`,
    formatAnalysisPromptTail(settings, names),
    `【World Model 输出契约】\n${WORLD_MODEL_OUTPUT_CONTRACT}`,
  ])
}

function formatWorldModelReferences(input, names) {
  return joinPromptSections([
    formatCharacterReference(input, names),
    formatWorldbookReference(input.worldbooks, names),
    formatExternalMemoryReference(input.external_memory, names),
  ])
}

function formatEventAnalysisRules(input, settings, names) {
  return joinPromptSections([
    `【BioWeave Event Analysis 核心规则】\n${EVENT_ANALYZER_CORE_CONTRACT}`,
    formatCommonAnalysisPrompt(settings, names),
    `【Event Analysis 任务】\n${EVENT_ANALYZER_TASK_CONTRACT}`,
    formatEventFloorMetadata(input),
    formatAnalysisPromptTail(settings, names),
    `【Event 输出契约】\n${EVENT_ANALYZER_OUTPUT_CONTRACT}`,
  ])
}

function formatEventAnalysisReferences(input, names) {
  return joinPromptSections([
    formatEventCharacterReference(input, names),
    formatPersonaReference(input.persona, names),
    formatEventCharacterContext(input.character_context, names),
    formatWorldbookReference(input.worldbooks, names),
    formatExternalMemoryReference(input.external_memory, names),
    formatWorldModelReference(input.world_model),
    formatExistingBioWeaveReference(input.existing_bioweave),
  ])
}

function inputNames(input) {
  const meta = input?.meta && typeof input.meta === 'object' ? input.meta : {}
  return {
    userName: expandPlaceholders(meta.user_name ?? meta.userName ?? '用户', { userName: '用户', characterName: '角色' }) || '用户',
    characterName: expandPlaceholders(meta.character_name ?? meta.characterName ?? '角色', { userName: '用户', characterName: '角色' }) || '角色',
  }
}
const WORLD_MODEL_TASK_PROMPT = '请根据下面的资料整理当前 Chat 的生物学世界规则。只使用资料中的明确证据，不要把推测写成事实。'

export function buildWorldModelMessages(analysisInput = {}, promptSettings = {}) {
  const settings = normalizeAnalysisPrompt(promptSettings)
  const input = analysisInput && typeof analysisInput === 'object' ? analysisInput : {}
  const names = inputNames(input)
  const messages = []
  addMessage(messages, 'system', expandPlaceholders(settings.system_top, names))
  addMessage(messages, 'system', formatWorldModelRules(settings, names))
  addMessage(messages, 'system', formatWorldModelReferences(input, names))
  addMessage(messages, 'system', expandPlaceholders(settings.system_bottom, names))
  addMessage(messages, 'assistant', formatNarrativeContext(input.recent_story?.items, null, names))
  addMessage(messages, 'user', '请根据以上资料完成 World Model 分析，并只输出符合约定的结构化对象。')
  return messages
}

export function buildEventAnalysisMessages(analysisInput = {}, promptSettings = {}) {
  const input = normalizeEventAnalysisInput(analysisInput)
  const settings = normalizeAnalysisPrompt(promptSettings)
  const names = inputNames(input)
  const messages = []
  addMessage(messages, 'system', expandPlaceholders(settings.system_top, names))
  addMessage(messages, 'system', formatEventAnalysisRules(input, settings, names))
  addMessage(messages, 'system', formatEventAnalysisReferences(input, names))
  addMessage(messages, 'system', expandPlaceholders(settings.system_bottom, names))
  addMessage(messages, 'assistant', formatNarrativeContext(
    input.recent_story?.items ?? input.recent_context,
    input.current_floor,
    names,
    input.story_time,
  ))
  addMessage(messages, 'user', '请根据以上资料分析本次目标楼层，只返回符合 Event Analysis 输出契约的完整固定 JSON 对象，不要输出其它文字。')
  return messages
}

export function buildPrompt({
  task,
  customPrefix = '',
  taskCustom = '',
  worldbook = '',
  character = '',
  story = '',
  current = '',
  schema = '',
  customSuffix = '',
}) {
  return [
    ['CORE', CORE_PROMPTS[task]],
    ['CUSTOM PREFIX', customPrefix],
    ['TASK CUSTOM', taskCustom],
    ['WORLDBOOK', worldbook],
    ['CHARACTER', character],
    ['STORY', story],
    ['CURRENT BIOWEAVE', current],
    ['OUTPUT SCHEMA', schema],
    ['CUSTOM SUFFIX', customSuffix],
  ]
    .filter(([, value]) => String(value ?? '').trim())
    .map(([key, value]) => `## ${key}\n${value}`)
    .join('\n\n')
}
// 构造最小 World Analysis 请求，不复用会引入其他业务约束的复杂 Prompt Pipeline。
export function buildWorldModelPrompt(analysisInput = {}, promptSettings = {}) {
  return buildWorldModelMessages(analysisInput, promptSettings)
    .map(message => message.content)
    .join('\n\n')
}
