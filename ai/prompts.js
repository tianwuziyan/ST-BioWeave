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
  '只依据本次提供的 AnalysisInput 判断当前 Chat 的生物学世界规则，不要补写输入中没有证据的事实。输出 JSON 的 key 必须严格保持 schema 规定的英文；除 null、布尔值和数字外，说明、规则和列表字符串必须使用中文。普通人类物种与性别标签规范为中文，不得把未翻译的 Homo sapiens 或 Human 写入名称或说明。',
  'species 识别与 biological_type 识别必须分开，严格按两步判断：先独立识别 species，再在每个 species 内识别 biological_types，最后才在具体 biological_type 下判断 capabilities。男性、女性、双性、Alpha、Beta、Omega、无性等是性别/生殖分类，不会因为先被识别就成为 species。',
  '默认人类回退只用于物种识别：资料只呈现默认男性/女性二元或其它普通人类的性别、身体或生殖证据，且没有明确非人类证据时，可以建立 species“人类”；识别出“人类”本身绝不能自动补齐任何 biological_type。只出现男性时输出人类→男性；出现男性和女性时输出人类→男性、女性；缺少证据的类型不要为了完整性添加。',
  '明确非人类证据优先；妖、魔、剑灵、精灵、兽人及资料定义的其它种类分别建立各自 species。biological_types 只表示其父 species 的性别、性别生殖或直接生殖分类，类型名称保持开放，不得枚举或改造成固定本体。',
  '非人类 Evidence Gate：在某个非人类 species 下写入 biological_type、capabilities、reproduction_rules、lifecycle 或 special_rules 前，必须在 AnalysisInput 的同一 species 上下文中找到直接陈述，或唯一、直接、低推断的语义等价；另一个 species 的证据不能跨 species 授权。没有 species-linked 类型证据时保留该 species 但 biological_types 为空；没有字段级证据时对应字段使用 null。',
  '“剑灵性别基本都为男性，极少女剑灵”在同一物种上下文中直接支持剑灵→男性、女性；“极少女剑灵”是女性语义证据，不能因为没有单独出现“女性”二字而丢失。',
  '常见、通常如此、现实生物可能如此、类人外貌、性交、妊娠、身体结构、类型名称或模型认为合理，都不是非人类 biological_type 或字段的证据；必须拒绝把人类模板复制给非人类。',
  '不要把种族/亚种、血统、职业、修炼身份、门派、阵营、来源、属性、身体形态、临时身体状态、身体改造、人格、性偏好或单个人的描述放进 biological_types。比如性别模糊、妖修、半兽人、重复父 species 的魔族、妖剑剑灵和魔剑灵应留在 species 说明或规则位置；“男性剑灵”“女性剑灵”应规范为剑灵下的男性、女性。',
  'BioWeave 的固定双性分类只使用名称“双性”。只有 AnalysisInput 明确说明固定的双性个体、species 分类或世界规则（例如“存在双性个体”“角色本身是双性”）时，才建立“双性”；可以双性化、临时双性状态、变身/改造能力、持续时间或单次身体状态都不是固定类型证据。双性不是全部生殖能力的结论，旧式复合称呼不要作为输出名称。',
  '每个 biological_type 的 capabilities 必须逐项依据证据独立填写 true、false 或 null；不能从类型名称、性别标签、代词、称谓、外貌或身体形态推断，也不能因为双性、Alpha、Beta 或 Omega 自动把所有能力设为 true。ABO 等开放类型不得自动生成男性/女性组合。',
  '人类基线只在对应的人类 biological_type 已由当前资料建立后才可使用。事实优先级固定为：明确剧情事实 > 明确世界/世界书规则 > 明确个人例外 > 普通人类基线。世界规则覆盖约 40 周等一般基线；个人例外记录为 exception，不得改写 species 的基线。人类基线可说明通常的配子、受精（fertilization）、排卵（ovulation）、周期（默认可参考约 28 天）、妊娠/孕期（gestation，通常约 40 周）和分娩/产程周期（labor，labor cycle），但不用于创造缺失的类型；已建立的人类类型应在对应 reproduction_rules 中分别填写这些有证据或基线支持的字段，证据不足的其它字段仍为 null。',
  '对妖、魔、剑灵、精灵、兽人和其它非人类 species，capabilities、reproduction_rules、lifecycle 和 special_rules 都必须逐项回到同一 species 的 AnalysisInput 证据；缺少对应机制证据就保留 null。只有资料明确说明某一项生理结构与人类相同，才继承该项对应的基线部分（对应字段），不能扩大到其它能力或规则。',
  '资料中明确描述的当前世界医疗条件，包括疾病、医疗设施、照护资源、医疗可及性和既有治疗，才是 medical_context 的证据；证据不足时不要推测诊断或确定分娩难度。',
  'unknowns 只能描述已经建立的 species、biological_type 或已知规则的未知机制，不能重新引入被拒绝或从未建立的类型；临时双性化规则留在 species 说明或已有 special_rules，不要放回 unknowns。',
].join('\n')
// 只用普通文字描述输出字段，避免把格式围栏或大段 schema 代码发送给后端。
const WORLD_MODEL_OUTPUT_CONTRACT = [
  '只输出一个结构化对象，不要输出解释文字、Markdown 或代码围栏。',
  '顶层字段固定为：schema_version、species、medical_context、exceptions、unknowns；顶层不得出现 biological_types 或 species 级 capabilities。',
  'schema_version 固定为 1。',
  'species 是数组；每项包含 name、description、biological_types。biological_types 是该 species 内的数组；每项包含 name、description、capabilities、reproduction_rules、lifecycle、special_rules。',
  '资料定义的 biological_type.name 是开放字符串；只保留资料实际出现或明确规则建立的分类。固定双性分类的标准名称是“双性”，不得输出旧式复合别名。',
  'capabilities 只能位于 species[].biological_types[].capabilities；species 不承载合并 capabilities。固定包含 can_produce_sperm、can_produce_ova、can_be_fertilized、can_fertilize、can_carry_pregnancy；人类类型可使用适用的人类基线，非人类每项必须有同一 species 的直接/低推断证据；每项独立填写 true、false 或 null，不能由名称触发补全。',
  'reproduction_rules 固定包含：fertilization、pregnancy_or_carrying、cycle、ovulation、gestation、labor；人类类型可使用适用的人类基线，非人类没有对应 AnalysisInput 证据时使用 null。',
  'lifecycle 固定包含：maturation、aging；非人类没有对应 AnalysisInput 证据时使用 null；special_rules、exceptions、unknowns 使用数组，unknowns 不得引入未成立的新类型。',
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
