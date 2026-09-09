import { normalizeWorldAnalysisPrompt, WORLD_MODEL_SCHEMA } from '../storage/schema.js'
export { WORLD_MODEL_SCHEMA }
export const CORE_PROMPTS = {
  world: 'Analyze world rules into the required JSON schema. Unknown facts remain unknown.',
  event: 'Extract biological facts from the target Floor Version. Do not convert symptoms into confirmed pregnancy.',
  projection: 'Generate non-factual future possibilities only. Never rewrite history.',
}
export const WORLD_MODEL_SCHEMA_TEXT = JSON.stringify(WORLD_MODEL_SCHEMA, null, 2)
const WORLD_MODEL_CORE_INSTRUCTIONS = [
  '你是 BioWeave 的 World Model 分析器。',
  '只依据本次 AnalysisInput 判断当前 Chat 的生物学规则；不得补写输入没有支持的 species、biological_type 或字段。JSON key 必须使用 schema 规定的英文，说明、规则和列表字符串使用中文。',
  '按 species → biological_types → 具体类型字段的顺序分析：先识别当前资料实际存在的 species，再识别该 species 下有直接证据的性别/生殖分类，最后逐项判断 capabilities、reproduction_rules、lifecycle 和 special_rules。类型名称保持开放，不因名称相似、常见或为了完整性补类型。',
  '若没有明确非人类证据，普通人类性别、身体或生殖描述可以建立 species“人类”；这只负责 species 兜底，不能自动创建任何 biological_type。species 名称或其通用重复标签也不能充当子类型。',
  '当资料已建立人类男性或女性类型时，可使用对应的现实普通人类 biological baseline；男性与女性 baseline 分开，baseline 不创造缺失类型。明确剧情事实 > 明确世界/世界书规则 > 明确个人例外 > 普通人类 baseline；高优先级信息覆盖 baseline。',
  '非人类 Evidence Gate 要求每个 type 和每个字段都有同一 species、同一 biological_type 的直接证据或唯一、低推断成本的语义归纳。类型名称、类人外形或单一身体线索不能套用人类模板；证据不足时填写 null，true 与 false 都不能由“没有观察到”推断。明确与人类相同的部分只继承对应字段。',
  'fertilization 只描述真实受精机制以及当前 biological_type 在其中的供体/受体角色。性行为、能量交换、修炼或其它互动本身不是受精证据；没有机制或角色依据时填写 null。',
  '固定生殖分类必须由资料明确支持；临时改造、一次性状态或单个人的特殊情况不创建世界级类型。固定双性统一使用名称“双性”。unknowns 只能描述已经建立的 species、type 或规则中仍未知的机制，不能重新引入未成立的类型。',
  'medical_context 只记录资料明确描述的医疗条件及其影响；没有依据时使用 null。',
].join('\n')
// 只用普通文字描述输出字段，避免把格式围栏或大段 schema 代码发送给后端。
const WORLD_MODEL_OUTPUT_CONTRACT = [
  '只输出一个结构化对象，不要输出解释文字、Markdown 或代码围栏。',
  '顶层字段固定为：schema_version、species、medical_context、exceptions、unknowns；顶层不得出现 biological_types 或 species 级 capabilities。',
  'schema_version 固定为 1。',
  'species 是数组，每项包含 name、description、biological_types；每个 biological_type 包含 name、description、capabilities、reproduction_rules、lifecycle、special_rules。',
  'biological_type.name 是开放字符串；capabilities 只能位于 biological_types 下，并固定包含五个 capability key，每项只能是 true、false 或 null。',
  'reproduction_rules 固定包含 fertilization、pregnancy_or_carrying、cycle、ovulation、gestation、labor；lifecycle 固定包含 maturation、aging；未知字段使用 null，数组字段使用数组。',
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
