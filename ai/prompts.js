import { normalizeWorldAnalysisPrompt, WORLD_MODEL_SCHEMA } from '../storage/schema.js'
import { EVENT_TYPES as DOMAIN_EVENT_TYPES } from '../core/events.js'
import { normalizeEventAnalysisInput } from './input-builder.js'
export { WORLD_MODEL_SCHEMA }
export const CORE_PROMPTS = {
  world: 'Analyze world rules into the required JSON schema. Unknown facts remain unknown.',
  event: 'Extract biological facts from the target Floor Version. Do not convert symptoms into confirmed pregnancy.',
  projection: 'Generate non-factual future possibilities only. Never rewrite history.',
}
export const WORLD_MODEL_SCHEMA_TEXT = JSON.stringify(WORLD_MODEL_SCHEMA, null, 2)

export const EVENT_TYPES = Object.freeze([...DOMAIN_EVENT_TYPES])
export const EVENT_STATUS = Object.freeze(['confirmed', 'probable', 'ambiguous', 'negated', 'fictional'])

export const EVENT_ANALYZER_CORE_CONTRACT = [
  '你是 BioWeave 的 BiologicalEvent 事实提取器。只提取当前 Floor Version 与输入证据明确支持的事件，不输出分析过程或自然语言解释。',
  '重点识别 sexual_activity，但必须兼容其它 BiologicalEvent 类型（包括 medical_event、physical_symptom、conception、pregnancy_suspicion、pregnancy_confirmation、pregnancy_loss、labor、delivery、postpartum、menstrual_event、ovulation_event、fertility_change、abortion、other_biological）。不要把所有事件强行分类为 sexual_activity。',
  '对 sexual_activity 提取结构化 Story Time、地点和全部实际参与者；不要只列主角、不要只列有生殖角色的参与者。参与者使用稳定 character_id，姓名只作为 display_name。',
  '同时阅读 World Model baseline 与当前 Floor / recent_context 的 narrative evidence。World Model baseline 只提供已知生物学能力背景，narrative evidence 只记录本次剧情事实；二者不能互相臆造或跨角色借证。',
  'event_role 与 gender/biological_type 是不同字段。只能依据 capability 与事件证据填写 reproductive role；不得从 gender、性别词、攻受、姓名、外貌或社会角色推导 can_carry_pregnancy、can_cause_pregnancy 或其它 capability。不要添加 gender eligibility 分支。',
  'reproductive_capabilities_used 固定包含 can_produce_sperm、can_produce_ova、can_be_fertilized、can_carry_pregnancy、can_cause_pregnancy；每个值只能是 true、false 或 null。null 表示未知/没有证据，禁止把 unknown、缺失、模糊描述或模型常识自动变成 true。',
  'pregnancy_relevance.gestational_subject_ids[] 与 counterpart_ids[] 永远是稳定 character_id 数组，分别允许 0、1 或 N 个值；不要输出逗号拼接字符串，也不要用姓名代替 ID。',
  '不要因为 NSFW、性交、体液、症状、恶心、腹痛或其它 physical_symptom 自动判定 conception 或 pregnancy；只有 World Model baseline 与 narrative evidence 共同明确支持时才填写 possible_conception 或 pregnancy relevance。未知保持 null/unknown。',
  '不要把 UI 显示、人物列表或其它后续层的判断写入结果；UI 不会也不应二次判断生殖资格。输出的是完整事实 DTO。',
].join('\n')

export const EVENT_ANALYZER_OUTPUT_CONTRACT = [
  '只输出一个完整、可直接 JSON.parse 的 JSON 对象，不要 Markdown、代码围栏、前后解释或半结构化文本。顶层固定为 {"schema_version":1,"events":[]}，不得输出其它顶层字段。',
  '每个 event 至少包含 event_id、type、status、story_time、location、participants、pregnancy_relevance、source_evidence 和 source。type 必须来自允许的 BiologicalEvent 类型，status 必须是 confirmed、probable、ambiguous、negated 或 fictional。',
  'story_time 必须是结构化对象：display、normalized、calendar_id、day_index、provider、precision、confidence；不可靠的 normalized/day_index 使用 null，不要从模糊 display 伪造日期。',
  'participants 必须是完整数组；每项包含 character_id、display_name、event_role、reproductive_capabilities_used 和 evidence，可带最小 biological_context。不要省略实际参与者。',
  'pregnancy_relevance 必须包含 relevant、possible_conception、gestational_subject_ids[]、counterpart_ids[]、confidence。两个 ID 字段始终是数组，可为空、单个或多个；不能是字符串。',
  'source 的六个字段必须来自输入的 floor_version：chat_id、message_id、floor、swipe_id、content_hash、message_version。模型返回的 source 不可信，服务端会强制替换为 authoritative Floor Version。',
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
  '【历史事件记忆库】',
  '以下是对话过程中自动生成的客观摘要，反映从最早到近期的关键事件与伏笔。请**优先信任记忆库描述**，即使它与角色卡/世界书中较早的描述冲突（因为记忆库记录了事件后的最新状态）。请按当前聊天主角色上下文理解。',
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
function inputNames(input) {
  const meta = input?.meta && typeof input.meta === 'object' ? input.meta : {}
  return {
    userName: expandPlaceholders(meta.user_name ?? meta.userName ?? '用户', { userName: '用户', characterName: '角色' }) || '用户',
    characterName: expandPlaceholders(meta.character_name ?? meta.characterName ?? '角色', { userName: '用户', characterName: '角色' }) || '角色',
  }
}
function formatCharacterContext(input, names, labels = {}) {
  const character = input.character && typeof input.character === 'object' ? input.character : {}
  const characterLabel = readableText(labels.character) || '角色卡'
  const characterLines = [`【${names.characterName} 的资料】`, `【${characterLabel}】`]
  addBlock(characterLines, '角色描述', character.description, names)
  for (const greeting of Array.isArray(character.greetings) ? character.greetings : []) {
    addBlock(characterLines, greeting?.is_current ? '开场白（当前）' : greeting?.label || '开场白', greeting?.content, names)
  }
  return characterLines.join('\n\n')
}
function formatWorldbookContext(worldbooks, names, labels = {}) {
  const contents = []
  for (const worldbook of worldbooks) {
    for (const entry of Array.isArray(worldbook?.entries) ? worldbook.entries : []) {
      const content = expandPlaceholders(entry?.content, names)
      if (content) contents.push(content)
    }
  }
  const worldbookLabel = readableText(labels.worldbooks) || '世界书'
  return [`【${worldbookLabel}】`, contents.join('\n\n') || '本次没有选中的世界书内容。'].join('\n')
}
function formatExternalMemoryContext(externalMemory, names, labels = {}) {
  const contents = []
  for (const provider of externalMemory) {
    const items = Array.isArray(provider?.items) ? provider.items : []
    contents.push(...items.map(item => expandPlaceholders(item?.content, names)).filter(Boolean))
  }
  const externalMemoryLabel = readableText(labels.external_memory) || '外部记忆'
  return contents.length ? `${HISTORY_MEMORY_CONTEXT}\n【${externalMemoryLabel}】\n${contents.join('\n\n')}` : ''
}
function formatWorldModelSystemContext(analysisInput, settings) {
  const input = analysisInput && typeof analysisInput === 'object' ? analysisInput : {}
  const worldbooks = Array.isArray(input.worldbooks) ? input.worldbooks : []
  const externalMemory = Array.isArray(input.external_memory) ? input.external_memory : []
  const names = inputNames(input)
  const blocks = [
    settings.input_prefix,
    formatCharacterContext(input, names, settings.labels),
    formatWorldbookContext(worldbooks, names, settings.labels),
    formatExternalMemoryContext(externalMemory, names, settings.labels),
    settings.input_suffix,
  ]
    .map(value => expandPlaceholders(value, names))
    .filter(Boolean)
  return blocks.join('\n\n')
}
function formatWorldModelAssistantContext(analysisInput, names, labels = {}) {
  const recentStory = analysisInput?.recent_story && typeof analysisInput.recent_story === 'object' ? analysisInput.recent_story : {}
  const contents = (Array.isArray(recentStory.items) ? recentStory.items : [])
    .map(item => expandPlaceholders(item?.content, names))
    .filter(Boolean)
  if (!contents.length) return '本次没有读取最近剧情。'
  const recentStoryLabel = readableText(labels.recent_story) || '最近剧情'
  return [`【${recentStoryLabel}】`, contents.join('\n\n')].join('\n\n')
}
export function buildWorldModelMessages(analysisInput = {}, promptSettings = {}) {
  const settings = normalizeWorldAnalysisPrompt(promptSettings)
  const input = analysisInput && typeof analysisInput === 'object' ? analysisInput : {}
  const names = inputNames(input)
  const systemLines = [WORLD_MODEL_CORE_INSTRUCTIONS, expandPlaceholders(settings.task, names), WORLD_MODEL_OUTPUT_CONTRACT].filter(value =>
    readableText(value),
  )
  const messages = [
    { role: 'system', content: systemLines.join('\n\n') },
    { role: 'system', content: formatWorldModelSystemContext(input, settings) },
    { role: 'assistant', content: formatWorldModelAssistantContext(input, names, settings.labels) },
    { role: 'user', content: '请根据以上资料完成 World Model 分析，并只输出符合约定的结构化对象。' },
  ]
  const systemTop = expandPlaceholders(settings.system_top, names)
  if (systemTop) messages.unshift({ role: 'system', content: systemTop })
  const systemBottom = expandPlaceholders(settings.system_bottom, names)
  if (systemBottom) messages.push({ role: 'system', content: systemBottom })
  return messages
}

// Event requests intentionally have no user-editable prompt layers. Keeping
// the input JSON as its own message makes the authoritative boundary visible
// in previews and prevents World Model prompt settings from changing Event
// extraction semantics.
export function buildEventAnalysisMessages(analysisInput = {}) {
  const input = normalizeEventAnalysisInput(analysisInput)
  const inputJson = JSON.stringify(input, null, 2)
  return [
    {
      role: 'system',
      content: [EVENT_ANALYZER_CORE_CONTRACT, EVENT_ANALYZER_OUTPUT_CONTRACT].join('\n\n'),
    },
    {
      role: 'user',
      content: [
        '【Event Analysis Input】',
        '以下 JSON 是本次请求唯一的输入边界；chat_scope、floor_version 和 current_floor 对应当前 Chat 与 authoritative Floor Version。',
        inputJson,
        '请只返回完整的固定 JSON 对象，不要输出其它文字。',
      ].join('\n\n'),
    },
  ]
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
