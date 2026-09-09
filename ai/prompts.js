import { normalizeWorldAnalysisPrompt, WORLD_MODEL_SCHEMA } from '../storage/schema.js'
export { WORLD_MODEL_SCHEMA }
export const CORE_PROMPTS = {
  world: 'Analyze world rules into the required JSON schema. Unknown facts remain unknown.',
  event: 'Extract biological facts from the target Floor Version. Do not convert symptoms into confirmed pregnancy.',
  projection: 'Generate non-factual future possibilities only. Never rewrite history.',
}
export const WORLD_MODEL_SCHEMA_TEXT = JSON.stringify(WORLD_MODEL_SCHEMA, null, 2)
const WORLD_MODEL_CORE_INSTRUCTIONS = [
  '任务：从本次 AnalysisInput 提取当前 Chat 的生物学 World Model。只使用资料实际支持的内容，不把模型常识补写成 species、biological_type、能力或规则。',
  '结构：按 species → biological_types → capabilities / reproduction_rules / lifecycle / special_rules 分层。species.name 和 biological_type.name 都是开放字符串；biological_type 只表示该 species 内稳定存在的性别、生殖角色或直接影响生殖机制的生物分类，不表示 species、亚种、血统、职业、身份、阵营、来源、属性、等级、形态或临时、可逆、条件性状态。固定生殖分类必须由资料支持；证据不足时保留 biological_types: []，不要猜测。',
  '证据：每个 species、biological_type 和字段独立分析；不跨 species 或跨 biological_type 借证据。五个 capability 逐字段独立举证：明确支持才写 true/false，其中 true 需要明确具备证据、false 需要明确不具备证据；未说明、未知或仅凭“通常/一般”不足以判断时写 null，不要把它们写成 false。除已建立的普通人类男性/女性 baseline 外，不从男性、女性、雄性、雌性等名称推导能力；固定双性统一使用名称“双性”。',
  'Human：只有当前资料支持普通人类背景时才建立“人类”。已经被资料支持的“男性”或“女性”可以使用对应的普通现实人类 baseline；baseline 不创建缺失类型，也不适用于其它 Human type。明确剧情事实 > 明确世界/世界书规则 > 明确个人例外 > 普通人类 baseline。',
  'Nonhuman 与字段语义：只依据本次 AnalysisInput，不使用模型自身常识，也不从 biological_type 名称套用 Human template；即使名称相同，非人类字段仍需该 species 和该 type 的直接证据。fertilization 只描述真实受精、授精或配子结合机制，并说明当前 type 的供体/受体角色；性交、体液/能量交换、感染/寄生、侵蚀/异化、身体改造、觉醒、个体生成、力量或关系变化本身都不等于 fertilization。lifecycle.maturation 只描述生物成熟或生命阶段变化，aging 只描述寿命、衰老或明确抗衰老生理；职业、修炼、技能、关系或力量 progression 不属于生命周期。资料明确声明与人类相同，也只继承被声明的范围。',
  '临时状态与内部自检：临时、可逆或条件性的性征、器官或生殖能力变化留在已有 type 的规则/例外中，不能建立新的 biological_type。输出前进行内部自检（不要输出过程），逐个检查“这个 type 为什么成立”“每个非 null capability 的直接依据是什么”“fertilization 是否真的描述受精”“lifecycle 是否真的描述生命周期”；没有可靠答案就把字段降为 null 或删除错误 type。medical_context、exceptions、unknowns 只记录资料明确支持的内容。',
].join('\n')
// 只用普通文字描述输出字段，避免把格式围栏或大段 schema 代码发送给后端。
const WORLD_MODEL_OUTPUT_CONTRACT = [
  '只输出一个结构化对象，不要输出解释文字、Markdown 或代码围栏；schema_version 固定为 1。JSON key 使用 schema 规定的英文，说明、规则和列表字符串使用中文。',
  '顶层只包含 schema_version、species、medical_context、exceptions、unknowns；不得出现顶层 biological_types 或 species 级 capabilities。',
  'species[] 包含 name、description、biological_types[]；每个 biological_type 包含 name、description、capabilities、reproduction_rules、lifecycle、special_rules。',
  'capabilities 只能位于 biological_types 下，固定包含五个 key：can_produce_sperm、can_produce_ova、can_be_fertilized、can_fertilize、can_carry_pregnancy；值只能是 true、false 或 null。',
  'reproduction_rules 固定包含 fertilization、pregnancy_or_carrying、cycle、ovulation、gestation、labor；lifecycle 固定包含 maturation、aging；未知标量为 null，列表为数组。',
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
  return [
    { role: 'system', content: systemLines.join('\n\n') },
    { role: 'system', content: formatWorldModelSystemContext(input, settings) },
    { role: 'assistant', content: formatWorldModelAssistantContext(input, names, settings.labels) },
    { role: 'user', content: '请根据以上资料完成 World Model 分析，并只输出符合约定的结构化对象。' },
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
