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
  '只依据本次提供的 AnalysisInput 判断当前 Chat 的生物学世界规则，不要补写输入中没有证据的事实。',
  '不要仅凭男性/女性标签推断 capabilities，不要默认男性一定产精、女性一定妊娠，也不要套用现实世界固定周期；若资料只呈现默认男性/女性二元、且没有明确非人类证据，则物种识别按人类处理。',
  '明确非人类证据优先；除上述默认男性/女性二元且无明确非人类证据的情况外，身份未知、一般未知或明确非人类的生物按未知/非人类规则处理，不得仅凭性别、gender、代词、称谓、外貌或身体形态套用人类规则。',
  '资料明确识别为 Homo sapiens 或人类，或只呈现默认男性/女性二元且没有明确非人类证据时，才使用人类生殖基线；明确非人类证据优先，不得套用人类基线。此时必须在对应人类 biological_type 的 reproduction_rules 中分别输出排卵（ovulation）、受精（fertilization）、妊娠/孕期（gestation）和分娩/产程周期（labor cycle，字段 labor）的常见人类过程/周期说明。可用约 28 天月经周期中期排卵、妊娠约 40 周（约 280 天，从末次月经起算；约 38 周从受精起算）作为一般基线，受精窗口受排卵影响，产程按阶段描述并保留个体与医疗条件差异；资料未提供具体参数时，在相应字段写明具体参数未知，但这四个基线字段都必须是非空说明，不得为 null。',
  '该人类基线只适用于明确识别的人类类型，以及上述默认男性/女性二元且无明确非人类证据的资料；对明确非人类类型不得套用，capabilities 仍只能依据明确证据填写，绝不能从 gender、性别、代词、称谓、外貌或身体形态推断。',
  '资料中明确描述的当前世界医疗条件，包括疾病、医疗设施、照护资源、医疗可及性和既有治疗，都是 medical_context 的证据；证据不足时不要推测诊断或确定分娩难度。',
  '请区分一般规则与剧情中明确出现的例外；不确定或没有证据的值使用 null，并在 unknowns 中说明缺失信息。',
  'capabilities 必须使用布尔值或 null，不得通过 gender 推断能力。',
].join('\n')
// 只用普通文字描述输出字段，避免把格式围栏或大段 schema 代码发送给后端。
const WORLD_MODEL_OUTPUT_CONTRACT = [
  '只输出一个结构化对象，不要输出解释文字、Markdown 或代码围栏。',
  '顶层字段固定为：schema_version、biological_types、medical_context、exceptions、unknowns。',
  'schema_version 固定为 1。',
  'biological_types 中每项包含 name、description、capabilities、reproduction_rules、lifecycle、special_rules。',
  'capabilities 固定包含：can_produce_sperm、can_produce_ova、can_be_fertilized、can_fertilize、can_carry_pregnancy；证据不足时使用 null。',
  'reproduction_rules 固定包含：fertilization、pregnancy_or_carrying、cycle、ovulation、gestation、labor；证据不足时使用 null。',
  'lifecycle 固定包含：maturation、aging；special_rules、exceptions、unknowns 使用数组。',
  'medical_context 固定包含 childbirth_difficulty、care_level、evidence，三者都是 nullable string；只做轻量、基于证据的评估，不能把推测写成确定结论。',
  '顶层 medical_context 用于记录当前世界的医疗条件及其对分娩支持的影响；没有明确医疗证据时三个字段都使用 null。',
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
