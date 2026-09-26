import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildEventAnalysisMessages, buildWorldModelMessages, buildWorldModelPatchMessages, buildWorldModelPatchMessagesV2, buildWorldModelPrompt, WORLD_MODEL_SCHEMA, WORLD_MODEL_SCHEMA_TEXT } from '../ai/prompts.js'
import { buildAnalysisInput } from '../ai/input-builder.js'
import { applyWorldModelPatchEvidenceGuard, applyWorldModelPatchV2EvidenceGuard, classifyWorldModelPatchV2, createAnalyzer, mergeWorldModelPatch, mergeWorldModelPatchV2, normalizeWorldModel, parseWorldModelPatchV2, parseWorldModelResponse, summarizeAnalysisInput, validateWorldModelPatch, validateWorldModelPatchV2, worldModelCandidateToPatchV2, worldModelIdentityIndex } from '../ai/analyzer.js'
import { formatWorldModelSupplementReference, parseWorldModelCandidateText as parseWorldModelCandidateTextRaw, parseWorldModelSupplementText } from '../ai/world-supplement-protocol.js'
import {
  DEFAULT_ANALYSIS_PROMPT,
  DEFAULT_EXTENSION_SETTINGS,
  DEFAULT_WORLD_ANALYSIS_PROMPT,
  SILLYTAVERN_CURRENT_API,
  emptyChat,
  normalizeWorldAnalysisPrompt,
} from '../storage/schema.js'
import { renderAnalysisDebugPopupContent, settingsPage } from '../ui/settings.js'
import { applyWorldModelCollectionEdit, applyWorldModelSection, createWorldModelBiologicalTypeSelection, createWorldModelSelection, createWorldModelSpeciesSelection, normalizeWorldModelBiologicalTypeSelection, normalizeWorldModelSelection, normalizeWorldModelSpeciesSelection, resolveWorldModelSelection, WORLD_MODEL_SECTION_KEYS, worldPage } from '../ui/world.js'

const STYLE_SOURCE = readFileSync(new URL('../style.css', import.meta.url), 'utf8')
const failedWorldResponseFixture = JSON.parse(readFileSync(new URL('./fixtures/world-model/failed-response.json', import.meta.url), 'utf8'))
const successfulWorldResponseFixture = JSON.parse(readFileSync(new URL('./fixtures/world-model/successful-response.json', import.meta.url), 'utf8'))

function decodeHtml(value) {
  return String(value ?? '')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

function extractRawMessages(html) {
  const match = String(html).match(/<pre[^>]*class="[^"]*bioweave-analysis-message-raw[^"]*"[^>]*>([\s\S]*?)<\/pre>/)
  assert.ok(match, 'raw World Model messages should be rendered in a dedicated container')
  return JSON.parse(decodeHtml(match[1]))
}

function extractStructuredMessages(html) {
  const messages = []
  const pattern =
    /<details class="bioweave-world-model-message"[^>]*data-bioweave-world-model-message-index="(\d+)"[^>]*data-bioweave-world-model-message-role="([^"]+)"[\s\S]*?<pre class="bioweave-world-model-message-content"[^>]*>([\s\S]*?)<\/pre>/g
  for (const match of String(html).matchAll(pattern)) {
    messages.push({
      index: Number(match[1]),
      role: decodeHtml(match[2]),
      content: decodeHtml(match[3]),
    })
  }
  return messages
}

function messageStartingWith(messages, marker) {
  const message = messages.find(item => item.content.startsWith(marker))
  assert.ok(message, `expected a message starting with ${marker}`)
  return message.content
}

function candidateText({type = 'Type-B', description = 'Type-B description。'} = {}) {
  return `[World Model]\n[Species]\nSpecies: Species-A\n[Biological Type]\nBiological_Type: ${type}\nType_Description: ${description}\n[/Biological Type]\n[/Species]\n[/World Model]`
}

function parseWorldModelCandidateText(raw) {
  const stack = []
  const labels = {
    Species: {Name: 'Species', Description: 'Species_Description'},
    'Biological Type': {Name: 'Biological_Type', Description: 'Type_Description'},
    Capabilities: Object.fromEntries(['Can Produce Sperm', 'Can Produce Ova', 'Can Be Fertilized', 'Can Fertilize', 'Can Cause Pregnancy', 'Can Carry Pregnancy'].map(label => [label, label.replaceAll(' ', '_')])),
    'Reproduction Rules': {'Pregnancy Or Carrying': 'Pregnancy_Or_Carrying'},
    Mechanism: {Key: 'Mechanism_Key', Label: 'Mechanism_Label', Pathway: 'Mechanism_Pathway', 'Carrying Compatibility': 'Carrying_Compatibility', 'World Model Rule Refs': 'World_Model_Rule_Refs'},
    Rule: {Value: 'Rule'},
    'Medical Context': {'Childbirth Difficulty': 'Childbirth_Difficulty', 'Care Level': 'Care_Level'},
    Exception: {Statement: 'Exception_Statement', 'Applies To': 'Applies_To'},
    Unknown: {Value: 'Unknown_Fact'},
  }
  const rewritten = String(raw).split(/\r?\n/u).map(line => {
    const trimmed = line.trim()
    const tag = trimmed.match(/^\[\/?(.+)\]$/u)
    if (tag) {
      if (trimmed.startsWith('[/')) stack.pop()
      else stack.push(tag[1])
      return line
    }
    const match = line.match(/^(\s*)([^:]+):(.*)$/u)
    const label = labels[stack.at(-1)]?.[match?.[2]?.trim()]
    return label ? `${match[1]}${label}:${match[3]}` : line
  }).join('\n')
  return parseWorldModelCandidateTextRaw(rewritten)
}

function supplementText({candidate = candidateText()} = {}) {
  return `[World Model Supplement]\n${candidate}\n[/World Model Supplement]`
}

async function captureTraceLogs(run) {
  const previousFlag = globalThis.__BIOWEAVE_API_TRACE__
  const previousDebug = globalThis.console?.debug
  const entries = []
  globalThis.__BIOWEAVE_API_TRACE__ = true
  if (globalThis.console) globalThis.console.debug = (...args) => entries.push(args)
  try {
    return { result: await run(), entries }
  } finally {
    if (previousFlag === undefined) delete globalThis.__BIOWEAVE_API_TRACE__
    else globalThis.__BIOWEAVE_API_TRACE__ = previousFlag
    if (globalThis.console) globalThis.console.debug = previousDebug
  }
}

function responseLikeSse(body) {
  let consumed = false
  return {
    ok: true,
    status: 200,
    headers: { get: name => (name.toLowerCase() === 'content-type' ? 'text/event-stream' : null) },
    body: {
      getReader() {
        return {
          async read() {
            if (consumed) return { done: true, value: undefined }
            consumed = true
            return { done: false, value: new TextEncoder().encode(body) }
          },
          releaseLock() {},
        }
      },
    },
  }
}

const modelFixture = {
  schema_version: 1,
  species: [
    {
      name: '潮汐生物',
      description: '具有特殊生殖规则的物种。',
      biological_types: [
        {
          name: '潮汐生物型',
          description: '具有双向受精能力的生物类型。',
          capabilities: {
            can_produce_sperm: true,
            can_produce_ova: null,
            can_be_fertilized: false,
            can_fertilize: true,
            can_cause_pregnancy: null,
            can_carry_pregnancy: null,
          },
          reproduction_rules: {
            fertilization: '需要两种配子接触。',
            pregnancy_or_carrying: null,
            cycle: '周期尚未明确。',
            ovulation: '排卵时机尚未明确。',
            gestation: '妊娠时长尚未明确。',
            labor: '产程规则尚未明确。',
          },
          lifecycle: { maturation: null, aging: '寿命尚未明确。' },
          reproductive_mechanisms: [],
          special_rules: ['潮汐期能力会变化。'],
        },
      ],
    },
  ],
  medical_context: {
    childbirth_difficulty: '当前资料不足以确定难度。',
    care_level: '需要基础医疗支持。',
    evidence: '世界书明确描述存在产科设施。',
  },
  exceptions: [
    {
      statement: '本 Chat 中记录了一次不符合一般规则的受精。',
      applies_to: '角色甲',
      evidence: '最近剧情中的明确描述',
    },
  ],
  unknowns: ['是否存在其他生物类型。'],
  projection_rules: [],
}

function structuredFixtureType(name, description, overrides = {}) {
  return {
    name,
    description,
    capabilities: {
      can_produce_sperm: null,
      can_produce_ova: null,
      can_be_fertilized: null,
      can_fertilize: null,
            can_cause_pregnancy: null,
      can_carry_pregnancy: null,
    },
    reproduction_rules: {
      fertilization: null,
      pregnancy_or_carrying: null,
      cycle: null,
      ovulation: null,
      gestation: null,
      labor: null,
    },
      lifecycle: { maturation: null, aging: null },
    reproductive_mechanisms: [],
    special_rules: [],
    ...overrides,
  }
}

// Fixture A: one species with two biological types, including every fixed field.
const fixtureA = {
  schema_version: 1,
  species: [
    {
      name: 'Fixture A 物种',
      description: 'Fixture A 物种描述。\n第二行仍然可读。',
      biological_types: [
        structuredFixtureType('Fixture A 类型一', 'Fixture A 类型一描述。\n类型说明第二行。', {
          capabilities: {
            can_produce_sperm: true,
            can_produce_ova: false,
            can_be_fertilized: null,
            can_fertilize: true,
            can_cause_pregnancy: null,
            can_carry_pregnancy: false,
          },
          reproduction_rules: {
            fertilization: 'Fixture A 受精方式',
            pregnancy_or_carrying: 'Fixture A 妊娠方式',
            cycle: 'Fixture A 生理周期',
            ovulation: 'Fixture A 排卵机制',
            gestation: 'Fixture A 妊娠周期',
            labor: 'Fixture A 分娩方式',
          },
          lifecycle: { maturation: 'Fixture A 成熟', aging: 'Fixture A 衰老' },
          special_rules: ['Fixture A 特殊规则'],
        }),
        structuredFixtureType('Fixture A 类型二', 'Fixture A 类型二描述。', {
          capabilities: {
            can_produce_sperm: null,
            can_produce_ova: false,
            can_be_fertilized: null,
            can_fertilize: null,
            can_cause_pregnancy: null,
            can_carry_pregnancy: false,
          },
        }),
      ],
    },
  ],
  medical_context: {
    childbirth_difficulty: 'Fixture A 分娩难度',
    care_level: 'Fixture A 照护水平',
    evidence: 'Fixture A 医疗依据',
  },
  exceptions: [
    {
      statement: 'Fixture A 例外主文本',
      applies_to: 'Fixture A 适用对象',
      evidence: 'Fixture A 例外依据',
    },
    {
      statement: 'Fixture A 无附加标签的例外',
      applies_to: null,
      evidence: null,
    },
  ],
  unknowns: ['Fixture A 尚未确定项'],
}

// Fixture B: four species with different dynamic type counts, including an empty type list.
const fixtureB = {
  schema_version: 1,
  species: [
    {
      name: 'Fixture B 物种一',
      description: 'Fixture B 物种一描述。',
      biological_types: [
        structuredFixtureType('Fixture B 类型一甲', 'Fixture B 类型一甲描述。', { special_rules: ['Fixture B 规则甲'] }),
        structuredFixtureType('Fixture B 类型一乙', 'Fixture B 类型一乙描述。'),
      ],
    },
    {
      name: 'Fixture B 物种二',
      description: 'Fixture B 物种二描述。',
      biological_types: [structuredFixtureType('Fixture B 类型二甲', 'Fixture B 类型二甲描述。')],
    },
    {
      name: 'Fixture B 物种三',
      description: 'Fixture B 物种三描述。',
      biological_types: [],
    },
    {
      name: 'Fixture B 物种四',
      description: 'Fixture B 物种四描述。',
      biological_types: [
        structuredFixtureType('Fixture B 类型四甲', 'Fixture B 类型四甲描述。'),
        structuredFixtureType('Fixture B 类型四乙', 'Fixture B 类型四乙描述。'),
        structuredFixtureType('Fixture B 类型四丙', 'Fixture B 类型四丙描述。'),
      ],
    },
  ],
  medical_context: { childbirth_difficulty: null, care_level: null, evidence: null },
  exceptions: [],
  unknowns: [],
}

function typeFixture(name, overrides = {}) {
  return {
    ...structuredClone(modelFixture.species[0].biological_types[0]),
    name,
    ...overrides,
  }
}

function worldResponse(species, unknowns = []) {
  return {
    schema_version: 1,
    species,
    medical_context: null,
    exceptions: [],
    unknowns,
  }
}

async function analyzeInput(analysisInput, species, unknowns = []) {
  const response = worldResponse(species, unknowns)
  const analyzer = createAnalyzer({
    profileResolver: () => SILLYTAVERN_CURRENT_API,
    contextResolver: () => ({ generateRaw: () => JSON.stringify(response) }),
  })
  return analyzer.analyzeWorldModel({ analysisInput })
}

async function analyzeDescription(description, species, unknowns = []) {
  return analyzeInput({ character: { description } }, species, unknowns)
}

test('World Model schema keeps capability unknowns as null and drops extra fields', () => {
  const model = normalizeWorldModel({
    ...modelFixture,
    species: modelFixture.species.map(species => ({ ...species, capabilities: { can_fertilize: true } })),
    gender: '不要推断',
    extra: '不要保存',
  })
  assert.deepEqual(model, modelFixture)
  assert.equal(Object.hasOwn(model, 'gender'), false)
  assert.equal(Object.hasOwn(model.species[0], 'gender'), false)
  assert.equal(Object.hasOwn(model.species[0].biological_types[0], 'gender'), false)
  assert.equal(Object.hasOwn(model.species[0], 'capabilities'), false)
  assert.equal(Object.hasOwn(WORLD_MODEL_SCHEMA, 'biological_types'), false)
  assert.equal(Object.hasOwn(WORLD_MODEL_SCHEMA.species[0], 'capabilities'), false)
  assert.deepEqual(WORLD_MODEL_SCHEMA.species[0].biological_types[0].capabilities, {
    can_produce_sperm: null,
    can_produce_ova: null,
    can_be_fertilized: null,
    can_fertilize: null,
            can_cause_pregnancy: null,
    can_carry_pregnancy: null,
  })
  assert.deepEqual(WORLD_MODEL_SCHEMA.species[0].biological_types[0].reproduction_rules, {
    fertilization: null,
    pregnancy_or_carrying: null,
    cycle: null,
    ovulation: null,
    gestation: null,
    labor: null,
  })
  assert.deepEqual(WORLD_MODEL_SCHEMA.medical_context, {
    childbirth_difficulty: null,
    care_level: null,
    evidence: null,
  })
})

test('World Model schema drops model-invented capability keys', () => {
  const raw = structuredClone(modelFixture)
  raw.species[0].biological_types[0].capabilities = {
    can_produce_sperm: true,
    can_produce_ova: null,
    can_be_fertilized: false,
    can_fertilize: true,
            can_cause_pregnancy: null,
    can_carry_pregnancy: null,
    can_lactate: true,
    can_regenerate: true,
    can_shapeshift: true,
    reproduction: '不得保存',
    gestation: '不得保存',
  }

  const normalized = normalizeWorldModel(raw)
  assert.deepEqual(normalized.species[0].biological_types[0].capabilities, {
    can_produce_sperm: true,
    can_produce_ova: null,
    can_be_fertilized: false,
    can_fertilize: true,
            can_cause_pregnancy: null,
    can_carry_pregnancy: null,
  })
})

test('World Model keeps open structured reproductive mechanisms without an enum', () => {
  const model = normalizeWorldModel({
    schema_version: 1,
    species: [{
      name: '开放机制物种',
      biological_types: [{
        name: '载体型',
        reproductive_mechanisms: [{
          key: 'world_custom_seed_host',
          label: '世界自定义繁殖体植入',
          pathway: 'seed_host_transfer',
          carrying_compatibility: true,
          world_model_rule_refs: ['rule-custom-1'],
          evidence: ['世界规则明确支持该机制。'],
        }],
      }],
    }],
  });
  assert.deepEqual(model.species[0].biological_types[0].reproductive_mechanisms[0], {
    key: 'world_custom_seed_host',
    label: '世界自定义繁殖体植入',
    pathway: 'seed_host_transfer',
    carrying_compatibility: true,
    world_model_rule_refs: ['rule-custom-1'],
    evidence: ['世界规则明确支持该机制。'],
  });
})

test('World Model nested fixtures keep old fields and default new fields to null', () => {
  const legacy = structuredClone(modelFixture)
  delete legacy.medical_context
  delete legacy.species[0].biological_types[0].reproduction_rules.ovulation
  delete legacy.species[0].biological_types[0].reproduction_rules.gestation
  delete legacy.species[0].biological_types[0].reproduction_rules.labor
  const normalized = normalizeWorldModel(legacy)
  assert.deepEqual(normalized.species[0].biological_types[0].reproduction_rules, {
    fertilization: '需要两种配子接触。',
    pregnancy_or_carrying: null,
    cycle: '周期尚未明确。',
    ovulation: null,
    gestation: null,
    labor: null,
  })
  assert.deepEqual(normalized.medical_context, {
    childbirth_difficulty: null,
    care_level: null,
    evidence: null,
  })
})

test('World Model medical context accepts nullable strings and drops extra fields', () => {
  const normalized = normalizeWorldModel({
    ...modelFixture,
    medical_context: {
      childbirth_difficulty: '  中等  ',
      care_level: 'unknown',
      evidence: null,
      diagnosis: '不得保存',
    },
  })
  assert.deepEqual(normalized.medical_context, {
    childbirth_difficulty: '中等',
    care_level: null,
    evidence: null,
  })
  assert.equal(Object.hasOwn(normalized.medical_context, 'diagnosis'), false)
  assert.throws(
    () => normalizeWorldModel({ ...modelFixture, medical_context: { care_level: 3 } }),
    error => error?.code === 'WORLD_MODEL_INVALID',
  )
})

test('World Model response parser accepts JSON object content and rejects invalid output', () => {
  const parsed = parseWorldModelResponse({
    choices: [{ message: { content: ['```json\n', JSON.stringify(modelFixture), '\n```'] } }],
  })
  assert.deepEqual(parsed, modelFixture)
  assert.throws(
    () => parseWorldModelResponse('这不是 JSON'),
    error => error?.code === 'WORLD_MODEL_INVALID',
  )
  assert.throws(
    () => parseWorldModelResponse(JSON.stringify({})),
    error => error?.code === 'WORLD_MODEL_INVALID',
  )
})

test('World Model Patch is a separate sparse DTO and never treats omission as deletion', () => {
  const patch = validateWorldModelPatch({
    schema_version: 1,
    add: { unknowns: ['新增规则尚未明确。'] },
    update: {},
  })
  const merged = mergeWorldModelPatch(modelFixture, patch)
  assert.equal(merged.species.length, modelFixture.species.length)
  assert.deepEqual(merged.species, modelFixture.species)
  assert.deepEqual(merged.exceptions, modelFixture.exceptions)
  assert.deepEqual(merged.unknowns, [...modelFixture.unknowns, '新增规则尚未明确。'])
  assert.throws(
    () => validateWorldModelPatch({ schema_version: 1, remove: { species: ['潮汐生物'] } }),
    error => error?.code === 'WORLD_MODEL_PATCH_INVALID' && error.message === 'WORLD_MODEL_PATCH_REMOVE_UNSUPPORTED',
  )
})

test('World Model Patch updates only the named species and preserves unrelated rules', () => {
  const updatedSpecies = {
    ...modelFixture.species[0],
    description: '当前 Floor 明确修正后的描述。',
  }
  const merged = mergeWorldModelPatch(modelFixture, {
    schema_version: 1,
    add: {},
    update: { species: [updatedSpecies] },
  })
  assert.equal(merged.species[0].description, updatedSpecies.description)
  assert.deepEqual(merged.species[0].biological_types, modelFixture.species[0].biological_types)
  assert.deepEqual(merged.medical_context, modelFixture.medical_context)
  assert.deepEqual(merged.exceptions, modelFixture.exceptions)
})

test('World Model Patch prompt requires sparse add/update output and forbids implicit deletion', () => {
  const prompt = buildWorldModelPatchMessages({ character: { description: '当前楼层明确新增规则。' } })
    .map(message => message.content).join('\n')
  assert.match(prompt, /不要返回完整 World Model/)
  assert.match(prompt, /缺少字段永远表示不修改/)
  assert.match(prompt, /不支持 remove、invalidate/)
  assert.match(prompt, /Previously missed 与 newly available evidence 使用相同 eligibility/)
  assert.match(prompt, /newly available evidence/)
  assert.match(prompt, /不要求事实首次出现于 current Floor/)
  assert.match(prompt, /evidence-supported sparse v1 add\/update delta/)
})

test('World Model Patch final API messages include the baseline while Full messages do not anchor to it', async () => {
  const baseline = normalizeWorldModel({
    schema_version: 1,
    species: [{ name: '已保存基线', description: '已有世界规则。' }],
  })
  const analysisInput = {
    world_model: baseline,
    character: { description: '此前资料明确记载一个补充事实。' },
    recent_story: { items: [{ content: '同一允许证据集合中的历史资料。' }] },
  }
  const requests = []
  const analyzer = createAnalyzer({
    profileResolver: () => SILLYTAVERN_CURRENT_API,
    contextResolver: () => ({
      generateRaw({ prompt }) {
        requests.push(prompt)
        return requests.length === 1
          ? JSON.stringify({ schema_version: 1, add: {}, update: {} })
          : JSON.stringify({
              schema_version: 1,
              species: [],
              medical_context: null,
              exceptions: [],
              unknowns: [],
              projection_rules: [],
            })
      },
    }),
  })

  await analyzer.analyzeWorldModelPatch({ analysisInput })
  await analyzer.analyzeWorldModel({ analysisInput })

  assert.deepEqual(requests[0].map(message => message.role), ['system', 'system', 'assistant', 'user'])
  const patchSystem = requests[0].filter(message => message.role === 'system').map(message => message.content).join('\n')
  const patchUser = requests[0].find(message => message.role === 'user')?.content ?? ''
  assert.doesNotMatch(patchSystem, /已保存基线/)
  assert.match(patchUser, /【Supplement Target：当前已保存的 World Model】/)
  assert.match(patchUser, /已保存基线/)
  assert.doesNotMatch(requests[1].map(message => message.content).join('\n'), /【当前 World Model 参考】/)
  assert.doesNotMatch(requests[1].map(message => message.content).join('\n'), /已保存基线/)
})

test('Supplement keeps permitted evidence roles while placing only its Target in the user message', () => {
  const existing = { schema_version: 1, species: [{ name: 'Species-A', description: '当前 canonical baseline。' }] }
  const patchMessages = buildWorldModelPatchMessages({
    world_model: existing,
    character: {
      description: 'Character Card evidence for Type-B.',
      greetings: [{ content: 'Character greeting evidence.' }],
    },
    persona: { name: '用户', description: 'Persona private content.' },
    worldbooks: [{ entries: [{ label: 'Worldbook-A', content: 'Worldbook evidence for Type-B.' }] }],
    external_memory: [{
      enabled: true,
      available: true,
      content_available: true,
      items: [{ label: 'External Memory-A', content: 'External memory evidence for Type-B.' }],
    }],
    recent_story: { items: [{ content: 'Recent Story evidence for Type-B.' }] },
  })
  const userMessages = patchMessages.filter(message => message.role === 'user')
  const user = userMessages[0].content
  const system = patchMessages.filter(message => message.role === 'system').map(message => message.content).join('\n')
  const evidenceSystem = patchMessages.filter(message => message.role === 'system')[1]?.content ?? ''
  const recentStoryMessages = patchMessages.filter(message => message.role === 'assistant')
  const targetIndex = user.indexOf('【Supplement Target：当前已保存的 World Model】')
  const requestIndex = user.indexOf('【Supplement Request】')

  assert.deepEqual(patchMessages.map(message => message.role), ['system', 'system', 'assistant', 'user'])
  assert.equal(userMessages.length, 1)
  assert.ok(targetIndex >= 0 && requestIndex > targetIndex)
  assert.match(user, /Existing = TARGET \+ comparison baseline/u)
  assert.match(user, /Existing 本身不是 evidence/u)
  assert.match(user, /<existing_world_model>[\s\S]*当前 canonical baseline。[\s\S]*<\/existing_world_model>/u)
  assert.doesNotMatch(system, /当前 canonical baseline。|<existing_world_model>/u)
  assert.doesNotMatch(user, /【当前 World Model 参考】|仅作为生物规则和能力背景参考|Worldbook evidence for Type-B\.|Character Card evidence for Type-B\.|External memory evidence for Type-B\.|Character greeting evidence\.|External memory evidence for Type-B\.|Recent Story evidence for Type-B\./u)
  assert.match(evidenceSystem, /【世界书参考资料】[\s\S]*Worldbook evidence for Type-B\./u)
  assert.match(evidenceSystem, /Character Card evidence for Type-B\./u)
  assert.match(evidenceSystem, /External memory evidence for Type-B\./u)
  assert.match(evidenceSystem, /Character greeting evidence\./u)
  assert.equal(recentStoryMessages.length, 1)
  assert.match(recentStoryMessages[0].content, /Recent Story evidence for Type-B\./u)
  assert.doesNotMatch(user, /Persona private content\.|人物设定/u)
  assert.match(user.slice(requestIndex), /permitted World Analysis evidence/u)
  assert.match(user.slice(requestIndex), /完成事实发现、scope\/classification 与 Existing exact comparison/u)

  const boundedMessages = buildWorldModelPatchMessages(
    {
      world_model: existing,
      character: { description: 'Character Card evidence.' },
      recent_story: { items: [{ content: 'Recent Story evidence for Type-B.' }] },
    },
    { system_top: 'TOP', system_bottom: 'BOTTOM' },
  )
  assert.deepEqual(boundedMessages[0], { role: 'system', content: 'TOP' })
  assert.deepEqual(boundedMessages.at(-1), { role: 'system', content: 'BOTTOM' })
  assert.deepEqual(boundedMessages.slice(1, -1).map(message => message.role), ['system', 'system', 'assistant', 'user'])

  const fullMessages = buildWorldModelMessages({ world_model: existing })
  assert.doesNotMatch(JSON.stringify(fullMessages), /当前 canonical baseline。|existing_world_model/u)

  const eventMessages = buildEventAnalysisMessages({ world_model: existing })
  assert.match(JSON.stringify(eventMessages), /【当前 World Model 参考】/u)
  assert.match(JSON.stringify(eventMessages), /仅作为生物规则和能力背景参考/u)

  assert.match(system, /\{"schema_version":1,"add":\{\},"update":\{\}\}/u)
  assert.match(system, /允许 add 的字段：species、exceptions、unknowns、projection_rules/u)
  assert.match(system, /允许 update 的字段：species、medical_context、projection_rules/u)
})

test('World Model Supplement v3 prompt is gated and keeps Phase 1 message roles', () => {
  const messages = buildWorldModelPatchMessagesV2({
    world_model: v2ExistingModel(),
    character: { description: 'Character Card evidence.' },
    worldbooks: [{ entries: [{ label: 'Worldbook-A', content: 'Worldbook evidence.' }] }],
    external_memory: [{ enabled: true, available: true, content_available: true, items: [{ label: 'Memory-A', content: 'External evidence.' }] }],
    recent_story: { items: [{ content: 'Recent Story evidence.' }] },
    persona: { description: 'Persona must remain excluded.' },
  })
  const prompt = messages.map(message => message.content).join('\n')
  assert.deepEqual(messages.map(message => message.role), ['system', 'system', 'assistant', 'user'])
  assert.match(prompt, /\[World Model\][\s\S]*\[\/World Model\]/u)
  for (const tag of ['Species', 'Biological Type', 'Capabilities', 'Reproduction Rules', 'Lifecycle', 'Reproductive Mechanisms', 'Mechanism', 'Special Rules', 'Rule', 'Medical Context', 'Exceptions', 'Exception', 'Unknowns', 'Unknown', 'Projection Rules', 'Projection Rule']) assert.match(prompt, new RegExp(`\\[${tag}\\]`))
  assert.doesNotMatch(prompt, /\{"schema_version":2,"operations"/u)
  assert.doesNotMatch(prompt, /"op":"(?:ADD|SET)_/u)
  assert.doesNotMatch(prompt, /\{"schema_version":1,"add":\{\},"update":\{\}\}/u)
  assert.doesNotMatch(prompt, /update\.species|完整 updated canonical species|允许 add 的字段/u)
  assert.match(prompt, /Existing = TARGET \+ comparison baseline/u)
  assert.match(prompt, /Existing 本身不是 evidence/u)
  assert.match(prompt, /Species → Biological Type → Details/u)
  assert.match(prompt, /opening\/closing tags 与 parser stack 是唯一 ownership signal/u)
  assert.match(prompt, /字段 absent = no claim\/preserve Existing/u)
  assert.match(prompt, /Patch v2 是 internal deterministic IR/u)
  assert.match(prompt, /<existing_world_model_reference>/u)
  assert.doesNotMatch(prompt, /<existing_world_model>/u)
  assert.doesNotMatch(prompt, /Persona must remain excluded\./u)
  assert.equal(messages.filter(message => message.role === 'assistant').length, 1)
  assert.match(messages.find(message => message.role === 'assistant').content, /Recent Story evidence\./u)
})

test('World Model Supplement v3 prompt keeps one response and deterministic comparison boundaries', () => {
  const messages = buildWorldModelPatchMessagesV2({
    world_model: normalizeWorldModel({
      schema_version: 1,
      species: [{ name: 'Species-A', biological_types: [] }],
    }),
  })
  const prompt = messages.map(message => message.content).join('\n')

  assert.match(prompt, /一次 Supplement attempt 只有一次 API request/u)
  assert.match(prompt, /Existing 仅作 TARGET、comparison baseline 和 structure reference，不是 evidence/u)
  for (const outlet of ['Species', 'Biological Type', 'Capabilities', 'Reproduction Rules', 'Lifecycle', 'Reproductive Mechanisms', 'Special Rules', 'Exceptions', 'Unknowns', 'Medical Context', 'Projection Rules']) {
    assert.match(prompt, new RegExp(outlet.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')))
  }
  assert.match(prompt, /所有 opening\/closing tags 与 parser stack 是唯一 ownership signal/u)
  assert.match(prompt, /Complete Evidence-Supported Candidate/u)
  assert.doesNotMatch(prompt, /Missing Identity Ledger|Candidate Ledger|identity universe|\[Discovery\]|\[Candidate\]/u)
})

test('Supplement Existing reference is identity-first and preserves canonical coverage', () => {
  const existing = {
    schema_version: 1,
    exceptions: [{ statement: 'Exception-A', applies_to: 'Species-A', evidence: 'Evidence-A' }],
    unknowns: ['Unknown-A'],
    medical_context: { childbirth_difficulty: null, care_level: 'false-like text', evidence: '无' },
    projection_rules: [{ projection_rule_id: 'projection-a', mechanism_key: 'mechanism-a', development_concern_key: 'concern-a', development_kind: 'possible_detection', trigger: { kind: 'story_time_reached', target_story_time: { day_index: 1 } } }],
    species: [
      {
        name: 'Species-A',
        description: 'Species-A description.',
        biological_types: [{
          name: 'Type-A',
          description: 'Type-A description.',
          capabilities: {
            can_produce_sperm: true,
            can_produce_ova: false,
            can_be_fertilized: null,
            can_fertilize: true,
            can_cause_pregnancy: false,
            can_carry_pregnancy: null,
          },
          reproduction_rules: { fertilization: '无', pregnancy_or_carrying: null, cycle: 'Rule-A' },
          lifecycle: { maturation: 'Maturation-A', aging: null },
          reproductive_mechanisms: [{ key: 'mechanism-a', label: 'Mechanism-A' }],
          special_rules: ['Special-A'],
        }],
      },
      { name: 'Species-B', description: 'Species-B description.', biological_types: [] },
      { name: 'Species-C', description: 'Species-C description.', biological_types: [{ name: 'Type-C', description: 'Type-C description.' }] },
    ],
  }
  const reference = formatWorldModelSupplementReference(existing)

  assert.match(reference, /<existing_world_model_reference>[\s\S]*<\/existing_world_model_reference>/u)
  assert.ok(reference.indexOf('[Species]\nSpecies: Species-A') < reference.indexOf('[Biological Type]\nBiological_Type: Type-A'))
  assert.ok(reference.indexOf('[Biological Type]\nBiological_Type: Type-A') < reference.indexOf('Type_Description: Type-A description.'))
  assert.match(reference, /\[Species\]\nSpecies: Species-B\nSpecies_Description: Species-B description\.[\s\S]*\[\/Species\]/u)
  assert.ok(reference.indexOf('[Species]\nSpecies: Species-B') < reference.indexOf('[Species]\nSpecies: Species-C'))
  assert.match(reference, /\[Capabilities\][\s\S]*Can_Produce_Sperm: true/u)
  assert.match(reference, /\[Capabilities\][\s\S]*Can_Produce_Ova: false/u)
  assert.match(reference, /\[Capabilities\][\s\S]*Can_Be_Fertilized: null/u)
  assert.match(reference, /\[Capabilities\][\s\S]*Can_Cause_Pregnancy: false/u)
  assert.match(reference, /Fertilization: 无/u)
  assert.match(reference, /Childbirth_Difficulty: null/u)
  assert.match(reference, /projection_rule_id.*projection-a/u)
  assert.match(reference, /\[Exceptions\][\s\S]*Exception-A/u)
  assert.match(reference, /\[Unknowns\][\s\S]*Unknown-A/u)
  assert.match(reference, /\[Reproductive Mechanisms\][\s\S]*Mechanism_Key: mechanism-a/u)
  assert.match(reference, /\[Special Rules\][\s\S]*Rule: Special-A/u)
  assert.doesNotMatch(reference, /新增|推断|missing|candidate/u)
})

test('Supplement v2 uses the coverage-oriented Existing reference without changing message roles or boundaries', () => {
  const existing = {
    schema_version: 1,
    species: [
      { name: 'Species-A', description: 'Species-A description.', biological_types: [{ name: 'Type-A' }] },
      { name: 'Species-B', description: 'Species-B description.', biological_types: [] },
      { name: 'Species-C', description: 'Species-C description.', biological_types: [] },
    ],
  }
  const messages = buildWorldModelPatchMessagesV2(
    {
      world_model: existing,
      character: { description: 'Character evidence.' },
      worldbooks: [{ entries: [{ content: 'Worldbook evidence.' }] }],
      recent_story: { items: [{ content: 'Recent Story evidence.' }] },
    },
    { system_top: 'TOP', system_bottom: 'BOTTOM' },
  )
  const user = messages.find(message => message.role === 'user')?.content ?? ''
  const evidenceSystem = messages.filter(message => message.role === 'system')[2]?.content ?? ''
  const fullMessages = buildWorldModelMessages(
    {
      character: { description: 'Character evidence.' },
      worldbooks: [{ entries: [{ content: 'Worldbook evidence.' }] }],
      recent_story: { items: [{ content: 'Recent Story evidence.' }] },
      world_model: existing,
    },
    { system_top: 'TOP', system_bottom: 'BOTTOM' },
  )

  assert.deepEqual(messages.map(message => message.role), ['system', 'system', 'system', 'assistant', 'user', 'system'])
  assert.equal(messages[0].content, 'TOP')
  assert.equal(messages.at(-1).content, 'BOTTOM')
  assert.match(user, /\[Species\]\nSpecies: Species-B[\s\S]*\[\/Species\]/u)
  assert.match(user, /\[Species\]\nSpecies: Species-C[\s\S]*\[\/Species\]/u)
  assert.doesNotMatch(user, /^biological_types:/mu)
  assert.doesNotMatch(user, /<existing_world_model>/u)
  assert.match(evidenceSystem, /Worldbook evidence\./u)
  assert.equal(messages.filter(message => message.role === 'assistant').length, 1)
  assert.match(messages.find(message => message.role === 'assistant').content, /Recent Story evidence\./u)
  assert.deepEqual(fullMessages.map(message => message.role), ['system', 'system', 'system', 'assistant', 'user', 'system'])
  assert.equal(fullMessages[0].content, 'TOP')
  assert.equal(fullMessages.at(-1).content, 'BOTTOM')
  assert.doesNotMatch(JSON.stringify(fullMessages), /Species-B description|existing_world_model_reference/u)
})

test('Hierarchical Candidate parser uses explicit tag ownership and ignores indentation', () => {
  const base = `[World Model]\n[Species]\nName: Species-A\n[Biological Type]\nName: Type-A\n[Capabilities]\nCan Carry Pregnancy: true\n[/Capabilities]\n[/Biological Type]\n[/Species]\n[/World Model]`
  const indented = base.split('\n').map((line, index) => `${' '.repeat(index % 4)}${line}`).join('\n')
  const first = parseWorldModelCandidateText(base)
  const second = parseWorldModelCandidateText(indented)
  assert.deepEqual(second.candidate, first.candidate)
  assert.equal(first.candidate.species[0].biological_types[0].capabilities.can_carry_pregnancy, true)
})

test('Hierarchical Candidate parser rejects ambiguous ownership without cross Species re-parenting', () => {
  const text = `[World Model]\n[Species]\nName: Species-A\n[Biological Type]\nName: Type-A\n[Capabilities]\nCan Carry Pregnancy: true\n[/Capabilities]\n[Species]\nName: Species-B\n[Biological Type]\nName: Type-B\n[Capabilities]\nCan Carry Pregnancy: false\n[/Capabilities]\n[/Biological Type]\n[/Species]\n[/World Model]`
  const parsed = parseWorldModelCandidateText(text)
  assert.deepEqual(parsed.candidate.species.map(item => item.name), ['Species-B'])
  assert.deepEqual(parsed.candidate.species[0].biological_types.map(item => item.name), ['Type-B'])
  assert.equal(parsed.candidate.species[0].biological_types[0].capabilities.can_carry_pregnancy, false)
  assert.ok(parsed.diagnostics.some(item => item.code === 'species_boundary_conflict'))
})

test('Hierarchical Candidate parser recovers valid leaves but fails closed for missing identity', () => {
  const text = `[World Model]\n[Species]\nName: Species-A\n[Biological Type]\nName: Type-A\n[Capabilities]\nCan Carry Pregnancy: maybe\nCan Produce Ova: true\n[/Capabilities]\n[/Biological Type]\n[/Species]\n[Species]\n[Biological Type]\nName: Type-B\n[/Biological Type]\n[/Species]\n[/World Model]`
  const parsed = parseWorldModelCandidateText(text)
  assert.equal(parsed.candidate.species.length, 1)
  assert.equal(parsed.candidate.species[0].name, 'Species-A')
  assert.equal(parsed.candidate.species[0].biological_types[0].capabilities.can_produce_ova, true)
  assert.equal(parsed.candidate.species[0].biological_types[0].capabilities.can_carry_pregnancy, undefined)
  assert.ok(parsed.diagnostics.some(item => item.code === 'expected_boolean'))
  assert.ok(parsed.diagnostics.some(item => item.code === 'missing_required_field'))
})

test('Hierarchical Candidate parser transactionally discards a section on closing mismatch', () => {
  const text = `[World Model]\n[Species]\nName: Species-A\n[Biological Type]\nName: Type-A\n[Capabilities]\nCan Produce Sperm: true\n[/Biological Type]\n[/Species]\n[/World Model]`
  const parsed = parseWorldModelCandidateText(text)
  assert.deepEqual(parsed.candidate.species[0].biological_types, [])
  assert.ok(parsed.diagnostics.some(item => item.code === 'closing_tag_mismatch'))
})

test('Hierarchical Candidate parser transactionally discards a conflicting duplicate section', () => {
  const text = `[World Model]\n[Species]\nName: Species-A\n[Biological Type]\nName: Type-A\n[Capabilities]\nCan Carry Pregnancy: true\nCan Carry Pregnancy: false\n[/Capabilities]\n[/Biological Type]\n[/Species]\n[/World Model]`
  const parsed = parseWorldModelCandidateText(text)
  assert.deepEqual(parsed.candidate.species[0].biological_types[0].capabilities, {})
  assert.ok(parsed.diagnostics.some(item => item.code === 'duplicate_scalar'))
})

test('Hierarchical Candidate parser commits valid sibling sections after an invalid section', () => {
  const text = `[World Model]\n[Species]\nName: Species-A\n[Biological Type]\nName: Type-A\n[Capabilities]\nCan Carry Pregnancy: true\nCan Carry Pregnancy: false\n[/Capabilities]\n[Reproduction Rules]\nGestation: Supported gestation rule.\n[/Reproduction Rules]\n[/Biological Type]\n[/Species]\n[/World Model]`
  const parsed = parseWorldModelCandidateText(text)
  const type = parsed.candidate.species[0].biological_types[0]
  assert.deepEqual(type.capabilities, {})
  assert.deepEqual(type.reproduction_rules, {gestation: 'Supported gestation rule.'})
})

test('Hierarchical Candidate parser transactionally stages invalid Medical Context', () => {
  const text = `[World Model]\n[Medical Context]\nCare Level: specialist\nCare Level: unsupported\n[/Medical Context]\n[Unknowns]\n[Unknown]\nValue: Triggered unknown.\n[/Unknown]\n[/Unknowns]\n[/World Model]`
  const parsed = parseWorldModelCandidateText(text)
  assert.deepEqual(parsed.candidate.medical_context, {})
  assert.deepEqual(parsed.candidate.unknowns, ['Triggered unknown.'])
  assert.ok(parsed.diagnostics.some(item => item.code === 'duplicate_scalar'))
})

test('Rejected transactional Candidate facts do not generate SET_FIELD operations', () => {
  const parsed = parseWorldModelCandidateText(`[World Model]\n[Species]\nName: Species-A\n[Biological Type]\nName: Type-A\n[Capabilities]\nCan Carry Pregnancy: true\nCan Carry Pregnancy: false\n[/Capabilities]\n[/Biological Type]\n[/Species]\n[Medical Context]\nCare Level: specialist\nCare Level: unsupported\n[/Medical Context]\n[/World Model]`)
  const patch = worldModelCandidateToPatchV2(parsed.candidate, v2ExistingModel())
  assert.equal(patch.operations.some(operation => operation.op === 'SET_FIELD'), false)
})

test('Hierarchical Candidate parser accepts only formal field label tokens', () => {
  const parsed = parseWorldModelCandidateText(`[World Model]\n[Species]\nName: Species-A\n[Biological Type]\nName: Type-A\n[Capabilities]\ncan_carry_pregnancy: true\n[/Capabilities]\n[/Biological Type]\n[/Species]\n[/World Model]`)
  assert.deepEqual(parsed.candidate.species[0].biological_types[0].capabilities, {})
  assert.ok(parsed.diagnostics.some(item => item.code === 'unknown_field'))
})

test('Semantic transport parser rejects ambiguous legacy identity and outlet labels', () => {
  const parsed = parseWorldModelCandidateTextRaw(`[World Model]
[Species]
Name: Species-A
[Biological Type]
Name: Type-A
[Special Rules]
[Rule]
Value: legacy
[/Rule]
[/Special Rules]
[/Biological Type]
[/Species]
[/World Model]`)
  assert.deepEqual(parsed.candidate.species, [])
  assert.ok(parsed.diagnostics.some(item => item.code === 'unknown_field'))
})

test('World Model Supplement v2 generic candidate ledger boundary preserves missing-type and negative cases', () => {
  const emptyTypeModel = normalizeWorldModel({
    schema_version: 1,
    species: [{ name: 'Species-A', biological_types: [] }],
  })
  const stableType = {
    op: 'ADD_TYPE',
    target: { kind: 'species', species_name: 'Species-A' },
    type: { name: 'Type-B' },
  }

  assert.doesNotThrow(() => applyWorldModelPatchV2EvidenceGuard(
    { schema_version: 2, operations: [stableType] },
    emptyTypeModel,
    v2Evidence('Species-A 包含 Type-B 类型，属于稳定生物分类。'),
  ))
  assert.throws(() => applyWorldModelPatchV2EvidenceGuard(
    { schema_version: 2, operations: [stableType] },
    emptyTypeModel,
    v2Evidence('某个角色表现出 Species-A 的 Type-B biological feature。'),
  ), error => error?.message === 'WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED')
  assert.doesNotThrow(() => applyWorldModelPatchV2EvidenceGuard(
    { schema_version: 2, operations: [] },
    emptyTypeModel,
    v2Evidence('Species-A 的 Type-B 只在 Condition-X 下暂时出现。'),
  ))

  const majorityModel = v2ExistingModel()
  assert.doesNotThrow(() => applyWorldModelPatchV2EvidenceGuard(
    { schema_version: 2, operations: [stableType] },
    majorityModel,
    v2Evidence('Species-A 的 Type-A 是多数，Type-B 是少数但稳定存在的 biological classification。'),
  ))
  assert.doesNotThrow(() => applyWorldModelPatchV2EvidenceGuard(
    { schema_version: 2, operations: [] },
    majorityModel,
    {},
  ))
})

test('World Model Supplement v2 prompt exposes the hierarchical Candidate grammar without Patch DTO output', () => {
  const prompt = buildWorldModelPatchMessagesV2().map(message => message.content).join('\n')
  assert.match(prompt, /\[Species\]/u)
  assert.match(prompt, /\[Biological Type\]/u)
  assert.match(prompt, /\[Capabilities\]/u)
  assert.match(prompt, /\[Mechanism\]/u)
  assert.match(prompt, /\[Unknown\]/u)
  assert.doesNotMatch(prompt, /"op"\s*:/u)
  assert.doesNotMatch(prompt, /"target"\s*:/u)
  assert.doesNotMatch(prompt, /"path"\s*:/u)
})

test('World Model Supplement v2 prompt publishes exact section field grammar', () => {
  const prompt = buildWorldModelPatchMessagesV2().map(message => message.content).join('\n')
  assert.match(prompt, /\[Rule\]\nRule: \.\.\.\n\[\/Rule\]/u)
  assert.doesNotMatch(prompt, /\[Rule\]\nName:/u)
  assert.doesNotMatch(prompt, /\[Rule\]\nDescription:/u)
  for (const label of [
    'Species', 'Species_Description', 'Biological_Type', 'Type_Description', 'Can_Produce_Sperm', 'Can_Produce_Ova', 'Can_Be_Fertilized',
    'Can_Fertilize', 'Can_Cause_Pregnancy', 'Can_Carry_Pregnancy', 'Fertilization',
    'Pregnancy_Or_Carrying', 'Cycle', 'Ovulation', 'Gestation', 'Labor', 'Maturation',
    'Aging', 'Mechanism_Key', 'Mechanism_Label', 'Mechanism_Pathway', 'Carrying_Compatibility', 'World_Model_Rule_Refs',
    'Evidence', 'Childbirth_Difficulty', 'Care_Level', 'Exception_Statement', 'Applies_To', 'Rule', 'Unknown_Fact',
  ]) assert.match(prompt, new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}:`, 'u'))
  assert.match(prompt, /Projection Rule 唯一允许的 representation 是单个 JSON object/u)
  assert.match(prompt, /每个 section 只允许下列 exact labels/u)
  assert.match(prompt, /snake_case alias/u)
})

test('Supplement v3 assembled production prompt includes the semantic Field Dictionary', () => {
  const prompt = buildWorldModelPatchMessagesV2({
    world_model: {schema_version: 1, species: []},
  }).map(message => message.content).join('\n')
  assert.match(prompt, /Species \/ Species.*稳定生命种类/u)
  assert.match(prompt, /Species_Description.*物种描述/u)
  assert.match(prompt, /Biological_Type.*稳定生理\/生殖分类/u)
  assert.match(prompt, /男性、女性、雄性、雌性、双性、间性、Alpha、Beta、Omega/u)
  assert.match(prompt, /不是 enum/u)
  assert.match(prompt, /Type identity 只证明分类存在，不授权 capability/u)
  for (const field of [
    'Can_Produce_Sperm', 'Can_Produce_Ova', 'Can_Be_Fertilized',
    'Can_Fertilize', 'Can_Cause_Pregnancy', 'Can_Carry_Pregnancy',
    'Fertilization', 'Pregnancy_Or_Carrying', 'Cycle', 'Ovulation',
    'Gestation', 'Labor', 'Maturation', 'Aging', 'Mechanism_Key',
    'Mechanism_Label', 'Mechanism_Pathway', 'Carrying_Compatibility',
    'World_Model_Rule_Refs', 'Childbirth_Difficulty', 'Care_Level',
    'Exception_Statement', 'Applies_To', 'Unknown_Fact',
  ]) assert.match(prompt, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))
  assert.match(prompt, /Fertilization：受精如何发生/u)
  assert.match(prompt, /Pregnancy_Or_Carrying：妊娠\/承载如何发生/u)
  assert.match(prompt, /Gestation：进入妊娠后的孕期长度/u)
  assert.match(prompt, /Maturation：生物成熟/u)
  assert.match(prompt, /Aging：寿命、衰老/u)
  assert.match(prompt, /普通性交、生殖或妊娠事实不自动创建 Mechanism/u)
  assert.match(prompt, /Rule 是 fallback outlet，不是事实垃圾桶/u)
  assert.match(prompt, /world-level 的医疗\/照护背景/u)
  assert.match(prompt, /未知、资料不足和普通临时事实不自动成为 Exception/u)
  assert.match(prompt, /schema field 没资料不是 Unknown/u)
  assert.match(prompt, /明确正向证据=true，明确负向证据=false，unknown\/unstated\/insufficient=omit/u)
  assert.match(prompt, /Candidate 禁止 null/u)
  assert.match(prompt, /Existing 仅作 TARGET、comparison baseline 和 structure reference，不是 evidence/u)
  assert.match(prompt, /Existing 相同 known fact 不输出/u)
  assert.match(prompt, /null、absent 或 collection 中没有该 identity\/member/u)
  assert.match(prompt, /Existing Description 仍必须遵守 Existing comparison/u)
  assert.match(prompt, /Existing 已记录完全相同的 Description 时不输出/u)
  assert.match(prompt, /Existing Description 为 null\/absent 且 permitted evidence 支持/u)
  assert.match(prompt, /permitted evidence 明确支持与 Existing 不同的 known Description 时/u)
  assert.doesNotMatch(prompt, /Existing Description.*可重复/u)
  assert.match(prompt, /不负责 ADD、CHANGE 或 NO-OP/u)
  assert.doesNotMatch(prompt, /Candidate 可以重复 Existing|重复 unchanged claim|不要因为 Existing 已有/u)
  assert.doesNotMatch(prompt, /Supplement only outputs ADD\/CHANGE|avoid NO-OP|do not repeat Existing unchanged facts/u)
})

test('World Model Supplement v2 prompt enforces Nonhuman field-level evidence and minority completeness', () => {
  const prompt = buildWorldModelPatchMessagesV2().map(message => message.content).join('\n')
  assert.match(prompt, /Type identity != details/u)
  assert.match(prompt, /每个字段必须有同一 scope 的独立 permitted evidence/u)
  assert.match(prompt, /Type 名称、male\/female\/sex-like label、外形、性交行为、schema 对称性和现实常识都不能授权 capability/u)
  assert.match(prompt, /unknown\/unstated\/insufficient evidence 省略；Candidate 禁止 null/u)
  assert.match(prompt, /rare、minority、uncommon、low prevalence 不影响 existence，数量少不等于 temporary/u)
  assert.match(prompt, /Existing 仅作 TARGET、comparison baseline 和 structure reference，不是 evidence/u)
  assert.match(prompt, /Existing 相同 known fact 不输出/u)
})

test('World Model prompt keeps direct stable rare Type existence separate from prevalence and details', () => {
  const fullPrompt = buildWorldModelMessages().map(message => message.content).join('\n')
  const supplementPrompt = buildWorldModelPatchMessagesV2().map(message => message.content).join('\n')
  for (const prompt of [fullPrompt]) {
    assert.match(prompt, /Species-A has stable Type-B 只证明 Species-A\/Type-B identity/u)
    assert.match(prompt, /直接陈述某 Species 长期存在/u)
    assert.match(prompt, /rare != temporary，minority != unstable，low prevalence != insufficient existence evidence/u)
    assert.match(prompt, /Type existence != Type details\/capabilities/u)
    assert.match(prompt, /temporary、reversible、conditional-only/u)
    assert.match(prompt, /没有独立 evidence 的 capability 必须省略|Supplement Candidate 对无证据字段省略/u)
  }
  assert.match(supplementPrompt, /Species scope 下明确持续存在的 classification 可直接成立/u)
  assert.match(supplementPrompt, /rare、minority、uncommon、low prevalence 不影响 existence/u)
  assert.match(supplementPrompt, /Type identity != details/u)
})

test('Supplement deterministic comparison permits Existing identity field-only delta and empty sparse output', () => {
  const existing = normalizeWorldModel({
    schema_version: 1,
    species: [{ name: 'Species-A', biological_types: [{ name: 'Type-A' }] }],
  })
  const existingTypeCandidate = parseWorldModelCandidateText(`[World Model]\n[Species]\nName: Species-A\n[Biological Type]\nName: Type-A\n[Capabilities]\nCan Produce Ova: true\n[/Capabilities]\n[/Biological Type]\n[/Species]\n[/World Model]`).candidate
  const emptyCandidate = { schema_version: 1, species: [], medical_context: {}, exceptions: [], unknowns: [], projection_rules: [] }
  assert.equal(worldModelCandidateToPatchV2(existingTypeCandidate, existing).operations.length, 1)
  assert.equal(worldModelCandidateToPatchV2(emptyCandidate, existing).operations.length, 0)
})

test('Supplement single-response prompt keeps internal discovery and complete evidence boundaries', () => {
  const prompt = buildWorldModelPatchMessagesV2().map(message => message.content).join('\n')
  assert.match(prompt, /internal Complete Evidence Discovery/u)
  assert.match(prompt, /Complete Evidence-Supported Candidate/u)
  assert.match(prompt, /complete with respect to permitted evidence/u)
  assert.match(prompt, /not complete with respect to schema/u)
  assert.match(prompt, /Evidence completeness != Schema completeness/u)
  assert.match(prompt, /No Evidence Compression/u)
  assert.match(prompt, /No Schema Completion/u)
  assert.match(prompt, /Identity discovery first\. Detail extraction second\./u)
  assert.match(prompt, /Type identity does not authorize details/u)
  assert.match(prompt, /Existing 仅作 TARGET、comparison baseline 和 structure reference，不是 evidence/u)
  assert.match(prompt, /Existing 相同 known fact 不输出/u)
  assert.match(prompt, /correction claim/u)
  assert.match(prompt, /不支持的 schema field 必须省略|schema 中存在但 evidence 不支持的 field 必须省略/u)
  assert.doesNotMatch(prompt, /Candidate 可以重复 Existing|重复 unchanged claim|不要因为 Existing 已有/u)
  assert.doesNotMatch(prompt, /Sparse Evidence Candidate/u)
  assert.doesNotMatch(prompt, /Missing Identity Ledger|Candidate Ledger|identity universe|\[Discovery\]|\[Candidate\]/u)
  assert.doesNotMatch(prompt, /前一次 AI call/u)
})

test('Hierarchical Candidate parser rejects Rule Name and Description fields', () => {
  const parsed = parseWorldModelCandidateText(`[World Model]\n[Species]\nName: Species-A\n[Biological Type]\nName: Type-A\n[Special Rules]\n[Rule]\nName: Unsupported\nDescription: Unsupported\nValue: Supported rule\n[/Rule]\n[/Special Rules]\n[/Biological Type]\n[/Species]\n[/World Model]`)
  assert.deepEqual(parsed.candidate.species[0].biological_types[0].special_rules, ['Supported rule'])
  assert.equal(parsed.diagnostics.filter(item => item.code === 'unsupported_field_for_section').length, 2)
})

test('Single-tree Candidate rejects duplicate Species and duplicate Type identities before indexing', () => {
  const duplicateSpecies = parseWorldModelCandidateText(`[World Model]\n[Species]\nName: Species-A\n[Biological Type]\nName: Type-C\n[/Biological Type]\n[/Species]\n[Species]\nName: Species-A\n[Biological Type]\nName: Type-B\n[/Biological Type]\n[/Species]\n[/World Model]`).candidate
  assert.throws(() => worldModelIdentityIndex(duplicateSpecies), error => error?.code === 'WORLD_MODEL_IDENTITY_DUPLICATE')
  assert.throws(
    () => worldModelCandidateToPatchV2(duplicateSpecies, v2ExistingModel()),
    error => error?.code === 'WORLD_MODEL_CANDIDATE_DUPLICATE_IDENTITY',
  )
  const duplicateType = parseWorldModelCandidateText(`[World Model]\n[Species]\nName: Species-A\n[Biological Type]\nName: Type-B\n[/Biological Type]\n[Biological Type]\nName: Type-B\n[/Biological Type]\n[/Species]\n[/World Model]`).candidate
  assert.throws(
    () => worldModelCandidateToPatchV2(duplicateType, v2ExistingModel()),
    error => error?.code === 'WORLD_MODEL_CANDIDATE_DUPLICATE_IDENTITY',
  )
})

test('Candidate Type-C cannot be hidden by a later duplicate Species index entry', () => {
  const candidate = parseWorldModelCandidateText(`[World Model]\n[Species]\nName: Species-A\n[Biological Type]\nName: Type-C\n[/Biological Type]\n[/Species]\n[Species]\nName: Species-A\n[Biological Type]\nName: Type-B\n[/Biological Type]\n[/Species]\n[/World Model]`).candidate
  assert.throws(() => worldModelCandidateToPatchV2(candidate, v2ExistingModel()), error => error?.code === 'WORLD_MODEL_CANDIDATE_DUPLICATE_IDENTITY')
})

test('A single Species block with distinct Type identities passes deterministic translation', () => {
  const candidate = parseWorldModelCandidateText(`[World Model]\n[Species]\nName: Species-A\n[Biological Type]\nName: Type-B\n[/Biological Type]\n[/Species]\n[/World Model]`).candidate
  assert.equal(worldModelCandidateToPatchV2(candidate, v2ExistingModel()).operations.length, 1)
  assert.deepEqual([...worldModelIdentityIndex(candidate).get('Species-A')], ['Type-B'])
})

test('Direct stable rare Type identity passes ADD_TYPE without detail evidence', () => {
  const existing = normalizeWorldModel({
    schema_version: 1,
    species: [{name: 'Species-A', biological_types: [{name: 'Type-A'}]}],
  })
  const candidate = parseWorldModelCandidateText(`[World Model]\n[Species]\nName: Species-A\n[Biological Type]\nName: Type-B\n[/Biological Type]\n[/Species]\n[/World Model]`).candidate
  const patch = worldModelCandidateToPatchV2(candidate, existing)
  assert.equal(patch.operations[0].op, 'ADD_TYPE')
  const evidenceVariants = [
    'Species-A mostly has Type-A, while a small persistent Type-B population also exists.',
    'Type-B exists in small numbers in Species-A.',
    'Species-A has an uncommon but stable Type-B population.',
    'A persistent minority Type-B population exists in Species-A.',
  ]
  for (const evidence of evidenceVariants) {
    assert.doesNotThrow(() => applyWorldModelPatchV2EvidenceGuard(patch, existing, v2Evidence(evidence)))
  }
  const merged = mergeWorldModelPatchV2(existing, patch, v2Evidence(evidenceVariants[0]))
  assert.deepEqual(merged.species[0].biological_types.map(type => type.name), ['Type-A', 'Type-B'])
})

test('Direct Type identity does not authorize an unsupported capability detail', () => {
  const existing = normalizeWorldModel({
    schema_version: 1,
    species: [{name: 'Species-A', biological_types: [{name: 'Type-A'}]}],
  })
  const candidate = {
    schema_version: 1,
    species: [{name: 'Species-A', biological_types: [{name: 'Type-B', capabilities: {can_produce_ova: true}}]}],
    medical_context: {}, exceptions: [], unknowns: [], projection_rules: [],
  }
  const patch = worldModelCandidateToPatchV2(candidate, existing)
  assert.throws(
    () => applyWorldModelPatchV2EvidenceGuard(
      patch,
      existing,
      v2Evidence('Species-A has a small persistent Type-B population.'),
    ),
    error => error?.path === 'operation.type.capabilities.can_produce_ova' && error?.path !== 'operation.type.name',
  )
})

test('Temporary Type identity does not satisfy the stable ADD_TYPE existence contract', () => {
  const existing = normalizeWorldModel({
    schema_version: 1,
    species: [{name: 'Species-A', biological_types: [{name: 'Type-A'}]}],
  })
  assert.throws(
    () => guardV2(
      {op: 'ADD_TYPE', target: {kind: 'species', species_name: 'Species-A'}, type: {name: 'Type-B'}},
      existing,
      'Species-A temporarily becomes Type-B under Condition-X.',
    ),
    error => error?.path === 'operation.type.name',
  )
})

test('Supplement single request contains one sparse tree and Existing only as reference', () => {
  const input = {
    world_model: {schema_version: 1, species: [{name: 'Species-A', biological_types: []}]},
    character: {description: 'Evidence for Species-A and Type-A.'},
  }
  const prompt = buildWorldModelPatchMessagesV2(input).map(message => message.content).join('\n')
  assert.match(prompt, /\[World Model Supplement\][\s\S]*\[World Model\][\s\S]*\[\/World Model\][\s\S]*\[\/World Model Supplement\]/u)
  assert.doesNotMatch(prompt, /\[Discovery\]|\[Candidate\]|Missing Identity Ledger|identity universe/u)
  assert.match(prompt, /existing_world_model_reference/u)
  assert.match(prompt, /读完全部 permitted evidence/u)
})

test('Single Supplement response parser extracts one hierarchical Candidate tree', () => {
  const parsed = parseWorldModelSupplementText(`[World Model Supplement]
[World Model]
[Species]
Species: Species-A
[Biological Type]
Biological_Type: Type-B
[/Biological Type]
[/Species]
[/World Model]
[/World Model Supplement]`)
  assert.deepEqual(parsed.candidate.species.map(species => ({name: species.name, types: species.biological_types.map(type => type.name)})), [{name: 'Species-A', types: ['Type-B']}])
})

test('Single Supplement parser preserves multiple evidence-supported types under one Species', () => {
  const parsed = parseWorldModelSupplementText(`[World Model Supplement]
[World Model]
[Species]
Species: Species-A
[Biological Type]
Biological_Type: Type-A
[/Biological Type]
[Biological Type]
Biological_Type: Type-B
[/Biological Type]
[/Species]
[/World Model]
[/World Model Supplement]`)
  assert.deepEqual(parsed.candidate.species.map(species => ({
    name: species.name,
    types: species.biological_types.map(type => type.name),
  })), [{name: 'Species-A', types: ['Type-A', 'Type-B']}])
  const patch = worldModelCandidateToPatchV2(parsed.candidate, v2ExistingModel())
  assert.deepEqual(patch.operations.map(operation => [operation.op, operation.type?.name]), [['ADD_TYPE', 'Type-B']])
})

test('Single Supplement parser rejects legacy wrapper and preserves hierarchy failure closure', () => {
  assert.throws(
    () => parseWorldModelSupplementText(`[World Model Supplement]
[Discovery]
[Species]
Name: Species-A
[/Species]
[/World Model Supplement]`),
    error => error?.code === 'WORLD_MODEL_SUPPLEMENT_INVALID',
  )
  assert.throws(() => parseWorldModelSupplementText(`[World Model Supplement]
[World Model]
[Species]
Name: Species-A
[Biological Type]
Name: Type-A
[/Species]
[Species]
Name: Species-B
[Biological Type]
Name: Type-B
[/Biological Type]
[/Species]
[/World Model]
[/World Model Supplement]`), error => error?.code === 'WORLD_MODEL_SUPPLEMENT_INVALID')
})

test('Species and Type identity alone create ADD_TYPE without capability fallback', () => {
  const candidate = parseWorldModelCandidateText(`[World Model]\n[Species]\nName: Species-A\n[Biological Type]\nName: Type-B\n[/Biological Type]\n[/Species]\n[/World Model]`).candidate
  const patch = worldModelCandidateToPatchV2(candidate, v2ExistingModel())
  assert.equal(patch.operations.length, 1)
  assert.equal(patch.operations[0].op, 'ADD_TYPE')
  assert.equal(patch.operations[0].type.name, 'Type-B')
  assert.deepEqual(patch.operations[0].type.capabilities, {})
})

test('Single-tree Supplement treats repeated Existing identity as deterministic NO-OP', () => {
  const existing = v2ExistingModel()
  const candidate = parseWorldModelCandidateText(`[World Model]\n[Species]\nName: Species-A\n[Biological Type]\nName: Type-A\n[/Biological Type]\n[/Species]\n[/World Model]`).candidate
  assert.deepEqual(worldModelCandidateToPatchV2(candidate, existing).operations, [])
})

test('Single-tree Supplement translates multiple missing Types and Species without a discovery copy', () => {
  const candidate = parseWorldModelCandidateText(`[World Model]
[Species]
Name: Species-A
[Biological Type]
Name: Type-B
[/Biological Type]
[Biological Type]
Name: Type-C
[/Biological Type]
[/Species]
[Species]
Name: Species-B
[Biological Type]
Name: Type-C
[/Biological Type]
[/Species]
[/World Model]`).candidate
  const operations = worldModelCandidateToPatchV2(candidate, v2ExistingModel()).operations
  assert.deepEqual(operations.filter(operation => operation.op === 'ADD_TYPE').map(operation => [operation.target.species_name, operation.type.name]), [
    ['Species-A', 'Type-B'],
    ['Species-A', 'Type-C'],
  ])
  assert.deepEqual(operations.filter(operation => operation.op === 'ADD_SPECIES').map(operation => [operation.species.name, operation.species.biological_types.map(type => type.name)]), [['Species-B', ['Type-C']]])
})

test('Empty single-tree Supplement is a valid empty delta', () => {
  const parsed = parseWorldModelSupplementText('[World Model Supplement]\n[World Model]\n[/World Model]\n[/World Model Supplement]')
  assert.deepEqual(worldModelCandidateToPatchV2(parsed.candidate, v2ExistingModel()).operations, [])
})

test('Unsupported Nonhuman capability omission cannot gain a deterministic fallback', () => {
  const candidate = parseWorldModelCandidateText(`[World Model]\n[Species]\nName: Species-A\n[Biological Type]\nName: Type-B\n[/Biological Type]\n[/Species]\n[/World Model]`).candidate
  const patch = worldModelCandidateToPatchV2(candidate, v2ExistingModel())
  assert.equal(patch.operations.some(operation => operation.path?.[0] === 'capabilities'), false)
  assert.equal(patch.operations.some(operation => operation.path?.[1] === 'can_produce_sperm'), false)
})

test('Nonhuman unsupported capability is rejected by the existing Guard at the scoped field path', () => {
  const candidate = {
    schema_version: 1,
    species: [{name: 'Species-A', biological_types: [{name: 'Type-B', capabilities: {can_produce_sperm: true}}]}],
    medical_context: {}, exceptions: [], unknowns: [], projection_rules: [],
  }
  const patch = worldModelCandidateToPatchV2(candidate, v2ExistingModel())
  assert.throws(
    () => applyWorldModelPatchV2EvidenceGuard(
      patch,
      v2ExistingModel(),
      {character: {description: 'Species-A 中 Type-B 是少数但稳定存在的 biological type。'}},
    ),
    error => error?.code === 'WORLD_MODEL_PATCH_V2_INVALID' &&
      error?.message === 'WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED' &&
      error?.path === 'operation.type.capabilities.can_produce_sperm',
  )
})

test('World Model v2 analyzer rejects semantically correct but structurally wrong operation shapes', async () => {
  const existing = v2ExistingModel()
  const evidence = { character: { description: 'Species-A 中 Type-B 是少数但稳定存在的 biological type。' } }
  let invalidCall = 0
  const analyzer = createAnalyzer({
    profileResolver: () => SILLYTAVERN_CURRENT_API,
    contextResolver: () => ({
      generateRaw: () => {
        invalidCall += 1
        return supplementText({candidate: JSON.stringify({
        schema_version: 2,
        operations: [{ op: 'ADD_TYPE', target: { kind: 'species', species_name: 'Species-A' }, type: { name: 'Type-B' } }],
        })})
      },
    }),
  })
  await assert.rejects(
    analyzer.analyzeWorldModelPatchV2({ analysisInput: { world_model: existing, ...evidence } }),
    error => error?.code === 'WORLD_MODEL_SUPPLEMENT_INVALID',
  )
  assert.equal(invalidCall, 1)

  let acceptedCall = 0
  const accepted = createAnalyzer({
    profileResolver: () => SILLYTAVERN_CURRENT_API,
    contextResolver: () => ({
      generateRaw: () => {
        acceptedCall += 1
        return supplementText({candidate: candidateText({type: 'Type-B'})})
      },
    }),
  })
  const result = await accepted.analyzeWorldModelPatchV2({ analysisInput: { world_model: existing, ...evidence } })
  assert.equal(acceptedCall, 1)
  assert.equal(result.patch.operations[0].type.name, 'Type-B')
  assert.equal(result.classified[0].classification, 'ADD')
})

test('World Model v2 analyzer boundary accepts sparse minority Type-B without feeding v1 merge', async () => {
  const existing = v2ExistingModel()
  const evidence = 'Species-A 中 Type-A 是多数类型，Type-B 是少数但稳定存在的 biological type，Type-B description。'
  const v2Response = supplementText({candidate: candidateText()})
  let call = 0
  const analyzer = createAnalyzer({
    profileResolver: () => SILLYTAVERN_CURRENT_API,
    contextResolver: () => ({ generateRaw: () => { call += 1; return v2Response } }),
  })
  const result = await analyzer.analyzeWorldModelPatchV2({
    analysisInput: { world_model: existing, character: { description: evidence } },
  })
  assert.equal(call, 1)
  assert.equal(result.patch.schema_version, 2)
  assert.equal(result.patch.operations.length, 1)
  assert.equal(result.patch.operations[0].op, 'ADD_TYPE')
  assert.equal(result.patch.operations[0].type.name, 'Type-B')
  assert.equal(result.classified[0].classification, 'ADD')
  assert.equal(result.patch.operations.some(operation => operation.type?.name === 'Type-A'), false)
  assert.equal(result.patch.operations.some(operation => operation.species), false)
  assert.deepEqual(mergeWorldModelPatchV2(existing, result.patch, { character: { description: evidence } }).species[0].biological_types.map(type => type.name), ['Type-A', 'Type-B'])

  const v1Analyzer = createAnalyzer({
    profileResolver: () => SILLYTAVERN_CURRENT_API,
    contextResolver: () => ({ generateRaw: () => v2Response }),
  })
  await assert.rejects(
    v1Analyzer.analyzeWorldModelPatch({ analysisInput: { world_model: existing, character: { description: evidence } } }),
    error => error?.code === 'WORLD_MODEL_PATCH_INVALID',
  )
})

test('World Model Candidate deterministically maps all legal internal Patch v2 operations and preserves omission', () => {
  const existing = v2ExistingModel()
  const candidate = {
    schema_version: 1,
    species: [
      {
        name: 'Species-A',
        description: 'Species-A corrected description.',
        biological_types: [
          {
            name: 'Type-A',
            description: 'Type-A corrected description.',
            capabilities: {can_carry_pregnancy: true},
            reproduction_rules: {gestation: 'Supported gestation rule.'},
            lifecycle: {maturation: 'Supported maturation rule.'},
            reproductive_mechanisms: [{key: 'mechanism-b', label: 'Mechanism-B'}],
            special_rules: ['Special-B'],
          },
          {name: 'Type-B', description: 'Supported new type.'},
        ],
      },
      {name: 'Species-B', description: 'Supported new species.', biological_types: [{name: 'Type-B'}]},
    ],
    medical_context: {care_level: 'Supported care level.'},
    exceptions: [{statement: 'Supported exception.', applies_to: 'Species-A'}],
    unknowns: ['Supported unresolved world question.'],
    projection_rules: [{schema_version: 1, mechanism_key: 'mechanism-b', development_concern_key: 'concern-b', development_kind: 'possible_detection', trigger: {kind: 'story_time_reached', target_story_time: {day_index: 2}}}],
  }
  const patch = worldModelCandidateToPatchV2(candidate, existing)
  assert.deepEqual(new Set(patch.operations.map(operation => operation.op)), new Set([
    'ADD_SPECIES', 'ADD_TYPE', 'SET_FIELD', 'ADD_SPECIAL_RULE', 'ADD_MECHANISM',
    'ADD_EXCEPTION', 'ADD_UNKNOWN', 'ADD_PROJECTION_RULE',
  ]))
  assert.equal(patch.operations.some(operation => operation.target?.type_name === 'Type-A' && operation.path?.join('.') === 'capabilities.can_carry_pregnancy'), true)
  assert.equal(patch.operations.some(operation => operation.target?.type_name === 'Type-A' && operation.path?.join('.') === 'capabilities.can_produce_sperm'), false)
  assert.equal(patch.operations.some(operation => operation.op === 'REMOVE'), false)

  const same = worldModelCandidateToPatchV2({
    schema_version: 1,
    species: [{name: 'Species-A', biological_types: [{name: 'Type-A', capabilities: {can_produce_sperm: false}}]}],
    medical_context: {}, exceptions: [], unknowns: [], projection_rules: [],
  }, existing)
  assert.deepEqual(same.operations, [])
})

test('World Model Patch evidence guard accepts differential evidence regardless of Floor origin', () => {
  const baseline = normalizeWorldModel({
    schema_version: 1,
    species: [{ name: '已有物种' }],
  })
  const patch = applyWorldModelPatchEvidenceGuard(
    {
      schema_version: 1,
      add: { species: [{ name: '遗漏物种', description: '遗漏资料中的稳定规则。' }] },
      update: {},
    },
    {
      world_model: baseline,
      recent_story: {
        items: [{ floor: 2, content: '较早允许资料明确记载遗漏物种，描述为遗漏资料中的稳定规则。' }],
      },
    },
  )
  assert.equal(patch.add.species[0].name, '遗漏物种')
})

test('World Model Patch evidence guard rejects unsupported canonical additions', () => {
  assert.throws(
    () => applyWorldModelPatchEvidenceGuard(
      {
        schema_version: 1,
        add: { species: [{ name: '没有证据的物种' }] },
        update: {},
      },
      { recent_story: { items: [{ content: '只说明另一条事实。' }] } },
    ),
    error => error?.code === 'WORLD_MODEL_PATCH_INVALID'
      && error?.message === 'WORLD_MODEL_PATCH_EVIDENCE_UNSUPPORTED',
  )
})

test('World Model Patch analyzer rejects an unsupported addition at the API boundary', async () => {
  const analyzer = createAnalyzer({
    profileResolver: () => SILLYTAVERN_CURRENT_API,
    contextResolver: () => ({
      generateRaw: () => JSON.stringify({
        schema_version: 1,
        add: { species: [{ name: 'API 无证据物种' }] },
        update: {},
      }),
    }),
  })
  await assert.rejects(
    analyzer.analyzeWorldModelPatch({
      analysisInput: { recent_story: { items: [{ content: '没有相关证据。' }] } },
    }),
    error => error?.code === 'WORLD_MODEL_PATCH_INVALID'
      && error?.message === 'WORLD_MODEL_PATCH_EVIDENCE_UNSUPPORTED',
  )
})

test('World Model Patch evidence guard accepts evidence-supported correction of an existing entry', () => {
  const baseline = normalizeWorldModel({
    schema_version: 1,
    species: [{ name: '已有物种', description: '旧描述。' }],
  })
  const corrected = { ...baseline.species[0], description: '已有物种的规则已明确修正。' }
  const patch = applyWorldModelPatchEvidenceGuard(
    { schema_version: 1, add: {}, update: { species: [corrected] } },
    { character: { description: '已有物种的规则已明确修正。' }, world_model: baseline },
  )
  const merged = mergeWorldModelPatch(baseline, patch)
  assert.equal(merged.species[0].description, corrected.description)
  assert.doesNotThrow(() => normalizeWorldModel(merged, { strict: true }))
})

function patchSpeciesCandidate(baseline, typePatch = {}) {
  const species = structuredClone(baseline.species[0])
  species.biological_types[0] = {
    ...species.biological_types[0],
    ...typePatch,
  }
  return species
}

function patchEvidenceInput(baseline, content) {
  return {
    world_model: baseline,
    recent_story: { items: [{ content }] },
  }
}

test('World Model Patch semantic safety accepts compatible accumulation and preserves Existing facts (A, C, I)', () => {
  const baseline = normalizeWorldModel({
    schema_version: 1,
    species: [{
      name: '累积物种',
      biological_types: [structuredFixtureType('甲型', '已有类型描述。', { special_rules: ['已有世界规则'] })],
    }],
  })
  const candidate = patchSpeciesCandidate(baseline, {
    special_rules: ['已有世界规则', '新增世界规则'],
  })
  const patch = applyWorldModelPatchEvidenceGuard(
    { schema_version: 1, add: {}, update: { species: [candidate] } },
    patchEvidenceInput(baseline, '累积物种甲型明确具有新增世界规则。'),
  )
  const merged = mergeWorldModelPatch(baseline, patch)
  assert.deepEqual(merged.species[0].biological_types[0].special_rules, ['已有世界规则', '新增世界规则'])
})

test('World Model Patch rejects unsupported nested piggyback (B, J, N)', () => {
  const baseline = normalizeWorldModel({
    schema_version: 1,
    species: [{
      name: '安全物种',
      biological_types: [structuredFixtureType('甲型', '已有类型描述。', { special_rules: ['已有世界规则'] })],
    }],
  })
  const candidate = patchSpeciesCandidate(baseline, {
    special_rules: ['已有世界规则', '证据规则', '无证据规则'],
    capabilities: { ...baseline.species[0].biological_types[0].capabilities, can_produce_sperm: true, can_produce_ova: true },
  })
  assert.throws(
    () => applyWorldModelPatchEvidenceGuard(
      { schema_version: 1, add: {}, update: { species: [candidate] } },
      patchEvidenceInput(baseline, '安全物种甲型产生精子，具有证据规则。'),
    ),
    error => error?.message === 'WORLD_MODEL_PATCH_EVIDENCE_UNSUPPORTED',
  )
})

test('World Model Patch rejects baseline self-proof and complete-candidate deletion (D, E, K)', () => {
  const baseline = normalizeWorldModel({
    schema_version: 1,
    species: [{
      name: '基线物种',
      biological_types: [structuredFixtureType('甲型', '已有类型描述。', {
        capabilities: { ...structuredFixtureType('x', '').capabilities, can_carry_pregnancy: true },
        special_rules: ['Existing 已知规则'],
      })],
    }],
    unknowns: ['仅存在于 Existing 的未知事项'],
  })
  assert.throws(
    () => applyWorldModelPatchEvidenceGuard(
      { schema_version: 1, add: { unknowns: ['仅存在于 Existing 的未知事项'] }, update: {} },
      { world_model: baseline },
    ),
    error => error?.message === 'WORLD_MODEL_PATCH_EVIDENCE_UNSUPPORTED',
  )
  const candidate = patchSpeciesCandidate(baseline, { special_rules: [] })
  assert.throws(
    () => applyWorldModelPatchEvidenceGuard(
      { schema_version: 1, add: {}, update: { species: [candidate] } },
      patchEvidenceInput(baseline, '基线物种甲型仍有其它规则。'),
    ),
    error => error?.message === 'WORLD_MODEL_PATCH_EVIDENCE_UNSUPPORTED',
  )
})

test('World Model Patch accepts CHANGE from direct compatible world evidence without correction keywords (F)', () => {
  const baseline = normalizeWorldModel({
    schema_version: 1,
    species: [{
      name: '直接属性物种',
      biological_types: [structuredFixtureType('甲型', '旧世界规则。')],
    }],
  })
  const candidate = patchSpeciesCandidate(baseline, { description: '新世界规则。' })
  const patch = applyWorldModelPatchEvidenceGuard(
    { schema_version: 1, add: {}, update: { species: [candidate] } },
    patchEvidenceInput(baseline, '直接属性物种甲型明确适用新世界规则。'),
  )
  assert.equal(patch.update.species[0].biological_types[0].description, '新世界规则。')
})

test('World Model Patch rejects individual-only world-rule promotion (G)', () => {
  const baseline = normalizeWorldModel({
    schema_version: 1,
    species: [{
      name: '个体边界物种',
      biological_types: [structuredFixtureType('甲型', '已有世界规则。', { special_rules: ['有特征'] })],
    }],
  })
  const candidate = patchSpeciesCandidate(baseline, { special_rules: ['有特征', '没有特征'] })
  assert.throws(
    () => applyWorldModelPatchEvidenceGuard(
      { schema_version: 1, add: {}, update: { species: [candidate] } },
      patchEvidenceInput(baseline, '某个角色没有特征。'),
    ),
    error => error?.message === 'WORLD_MODEL_PATCH_EVIDENCE_UNSUPPORTED',
  )
})

test('World Model Patch keeps general rules and adds world exceptions without replacing them (H)', () => {
  const baseline = normalizeWorldModel({
    schema_version: 1,
    species: [{ name: '例外物种', biological_types: [structuredFixtureType('甲型', '一般规则。')] }],
  })
  const patch = applyWorldModelPatchEvidenceGuard(
    {
      schema_version: 1,
      add: { exceptions: [{ statement: '某类异常个体不表现一般规则。' }] },
      update: {},
    },
    patchEvidenceInput(baseline, '例外物种存在某类异常个体不表现一般规则。'),
  )
  const merged = mergeWorldModelPatch(baseline, patch)
  assert.equal(merged.species[0].biological_types[0].description, '一般规则。')
  assert.equal(merged.exceptions[0].statement, '某类异常个体不表现一般规则。')
})

test('World Model Patch rejects individual uncertainty and individual medical promotion (G, O, P)', () => {
  const baseline = normalizeWorldModel({ schema_version: 1, species: [{ name: '范围物种' }] })
  for (const patch of [
    { add: { unknowns: ['某角色的机制无法确定。'] }, update: {} },
    { add: {}, update: { medical_context: { care_level: '需要特殊照护。' } } },
  ]) {
    assert.throws(
      () => applyWorldModelPatchEvidenceGuard(
        { schema_version: 1, ...patch },
        patchEvidenceInput(baseline, '某角色的机制无法确定，需要特殊照护。'),
      ),
      error => error?.message === 'WORLD_MODEL_PATCH_EVIDENCE_UNSUPPORTED',
    )
  }
})

test('World Model Patch preserves sparse medical context presence (J)', () => {
  const baseline = normalizeWorldModel({
    schema_version: 1,
    medical_context: {
      childbirth_difficulty: 'Existing difficulty',
      care_level: 'Existing care',
      evidence: 'Existing evidence',
    },
  })
  const patch = applyWorldModelPatchEvidenceGuard(
    { schema_version: 1, add: {}, update: { medical_context: { care_level: 'New care' } } },
    patchEvidenceInput(baseline, '世界级医疗背景明确为 New care。'),
  )
  const merged = mergeWorldModelPatch(baseline, patch)
  assert.deepEqual(merged.medical_context, {
    childbirth_difficulty: 'Existing difficulty',
    care_level: 'New care',
    evidence: 'Existing evidence',
  })
})

test('World Model Patch treats canonical null, false, and 无 as distinct unchanged values (L)', () => {
  const baseline = normalizeWorldModel({
    schema_version: 1,
    species: [{ name: '三态物种', biological_types: [structuredFixtureType('甲型', '已有规则。', {
      capabilities: { ...structuredFixtureType('x', '').capabilities, can_carry_pregnancy: false },
      reproduction_rules: { ...structuredFixtureType('x', '').reproduction_rules, gestation: '无' },
    })] }],
  })
  const candidate = patchSpeciesCandidate(baseline)
  assert.doesNotThrow(() => applyWorldModelPatchEvidenceGuard(
    { schema_version: 1, add: {}, update: { species: [candidate] } },
    { world_model: baseline, recent_story: { items: [] } },
  ))
})

test('World Model Patch does not create delta for collection reorder (M)', () => {
  const baseline = normalizeWorldModel({
    schema_version: 1,
    species: [{ name: '排序物种', biological_types: [structuredFixtureType('甲型', '规则。', { special_rules: ['规则一', '规则二'] })] }],
  })
  const candidate = patchSpeciesCandidate(baseline, { special_rules: ['规则二', '规则一'] })
  assert.doesNotThrow(() => applyWorldModelPatchEvidenceGuard(
    { schema_version: 1, add: {}, update: { species: [candidate] } },
    { world_model: baseline, recent_story: { items: [] } },
  ))
})

test('World Model Patch applies shared final consistency after merge (S)', () => {
  const baseline = normalizeWorldModel({
    schema_version: 1,
    species: [{ name: '一致性物种', biological_types: [structuredFixtureType('甲型', '规则。', {
      capabilities: { ...structuredFixtureType('x', '').capabilities, can_carry_pregnancy: true },
      reproduction_rules: { ...structuredFixtureType('x', '').reproduction_rules, gestation: '有妊娠。' },
    })] }],
  })
  const candidate = patchSpeciesCandidate(baseline, {
    capabilities: { ...baseline.species[0].biological_types[0].capabilities, can_carry_pregnancy: false },
  })
  const patch = applyWorldModelPatchEvidenceGuard(
    { schema_version: 1, add: {}, update: { species: [candidate] } },
    patchEvidenceInput(baseline, '一致性物种甲型不能怀孕。'),
  )
  const merged = mergeWorldModelPatch(baseline, patch)
  assert.equal(merged.species[0].biological_types[0].reproduction_rules.gestation, '无')
  assert.doesNotThrow(() => normalizeWorldModel(merged, { strict: true }))
})

test('World Model Patch keeps projection update identity blocked (T)', () => {
  assert.throws(
    () => applyWorldModelPatchEvidenceGuard(
      { schema_version: 1, add: {}, update: { projection_rules: [{ schema_version: 1, mechanism_key: 'm', development_concern_key: 'c', development_kind: 'possible_detection', trigger: { kind: 'story_time_reached', target_story_time: { day_index: 1 } } }] } },
      { recent_story: { items: [{ content: '世界规则支持该 projection rule。' }] } },
    ),
    error => error?.message === 'WORLD_MODEL_PATCH_IDENTITY_UNSUPPORTED',
  )
})

test('World Model Patch expands a new biological type into semantic field adds (U)', () => {
  const baseline = normalizeWorldModel({ schema_version: 1, species: [{ name: '新增类型物种', biological_types: [] }] })
  const candidate = {
    ...baseline.species[0],
    biological_types: [{ name: '新增型', description: '新增类型存在。', special_rules: ['新增类型规则'] }],
  }
  const patch = applyWorldModelPatchEvidenceGuard(
    { schema_version: 1, add: {}, update: { species: [candidate] } },
    patchEvidenceInput(baseline, '新增类型物种新增型明确存在，新增类型存在，新增类型规则。'),
  )
  assert.equal(patch.update.species[0].biological_types[0].name, '新增型')
  assert.deepEqual(patch.update.species[0].biological_types[0].special_rules, ['新增类型规则'])
})

test('World Model Patch guard and merge support a generic Type-B add without claiming discovery (U2)', () => {
  const baseline = normalizeWorldModel({
    schema_version: 1,
    species: [{ name: 'Species-A', biological_types: [{ name: 'Type-A', description: 'Existing type.' }] }],
  })
  const candidate = structuredClone(baseline.species[0])
  candidate.biological_types.push({ name: 'Type-B', special_rules: ['Type-B'] })
  const patch = applyWorldModelPatchEvidenceGuard(
    { schema_version: 1, add: {}, update: { species: [candidate] } },
    { world_model: baseline, character: { description: 'Species-A：Type-B。' } },
  )
  const merged = mergeWorldModelPatch(baseline, patch)

  assert.deepEqual(merged.species[0].biological_types.map(type => type.name), ['Type-A', 'Type-B'])
  assert.ok(merged.species[0].biological_types[1].capabilities)
  assert.ok(Object.values(merged.species[0].biological_types[1].capabilities).every(value => value === null))
})

test('World Model Patch rejects unsupported nested capability on a new type (V)', () => {
  const baseline = normalizeWorldModel({ schema_version: 1, species: [{ name: '新增能力物种', biological_types: [] }] })
  const candidate = {
    ...baseline.species[0],
    biological_types: [{
      name: '新增型',
      description: '新增类型存在。',
      capabilities: { can_carry_pregnancy: true },
    }],
  }
  assert.throws(
    () => applyWorldModelPatchEvidenceGuard(
      { schema_version: 1, add: {}, update: { species: [candidate] } },
      patchEvidenceInput(baseline, '新增能力物种新增型明确存在，新增类型存在。'),
    ),
    error => error?.message === 'WORLD_MODEL_PATCH_EVIDENCE_UNSUPPORTED',
  )
})

test('World Model Patch accepts a safe new reproductive mechanism add (W)', () => {
  const baseline = normalizeWorldModel({
    schema_version: 1,
    species: [{ name: '新增机制物种', biological_types: [structuredFixtureType('甲型', '已有类型。')] }],
  })
  const candidate = structuredClone(baseline.species[0])
  candidate.biological_types[0].reproductive_mechanisms = [{
    key: 'new_mechanism',
    label: '新增机制',
    pathway: '新增路径',
  }]
  const patch = applyWorldModelPatchEvidenceGuard(
    { schema_version: 1, add: {}, update: { species: [candidate] } },
    patchEvidenceInput(baseline, '新增机制物种甲型新增机制 new_mechanism，路径为新增路径。'),
  )
  assert.equal(patch.update.species[0].biological_types[0].reproductive_mechanisms[0].key, 'new_mechanism')
})

test('World Model Patch blocks mechanism updates without stable identity (X)', () => {
  const baseline = normalizeWorldModel({
    schema_version: 1,
    species: [{
      name: '机制身份物种',
      biological_types: [{
        ...structuredFixtureType('甲型', '已有类型。'),
        reproductive_mechanisms: [{ key: 'mechanism_key', label: '旧标签', pathway: '旧路径' }],
      }],
    }],
  })
  const candidate = structuredClone(baseline.species[0])
  candidate.biological_types[0].reproductive_mechanisms[0].label = '新标签'
  assert.throws(
    () => applyWorldModelPatchEvidenceGuard(
      { schema_version: 1, add: {}, update: { species: [candidate] } },
      patchEvidenceInput(baseline, '机制身份物种甲型机制标签变为新标签。'),
    ),
    error => error?.message === 'WORLD_MODEL_PATCH_IDENTITY_UNSUPPORTED',
  )
})

test('World Model Patch uses canonical exception equality rather than object key order (Y)', () => {
  const baseline = normalizeWorldModel({
    schema_version: 1,
    species: [],
    exceptions: [{ statement: '已有例外。', applies_to: '某类', evidence: '已有证据。' }],
  })
  const patch = applyWorldModelPatchEvidenceGuard(
    {
      schema_version: 1,
      add: { exceptions: [{ evidence: '已有证据。', statement: '已有例外。', applies_to: '某类' }] },
      update: {},
    },
    { recent_story: { items: [{ content: '已有例外。某类。已有证据。' }] }, world_model: baseline },
  )
  assert.throws(
    () => mergeWorldModelPatch(baseline, patch),
    error => error?.message === 'WORLD_MODEL_PATCH_DUPLICATE_ADD',
  )
})

test('World Model Patch distinguishes explicit medical null from absent presence (Z, AA)', () => {
  const baseline = normalizeWorldModel({
    schema_version: 1,
    medical_context: { childbirth_difficulty: 'known', care_level: 'known', evidence: 'known' },
  })
  const unchanged = applyWorldModelPatchEvidenceGuard(
    { schema_version: 1, add: {}, update: { medical_context: { care_level: 'new' } } },
    patchEvidenceInput(baseline, '世界级医疗背景的照护等级是 new。'),
  )
  const merged = mergeWorldModelPatch(baseline, unchanged)
  assert.deepEqual(merged.medical_context, { childbirth_difficulty: 'known', care_level: 'new', evidence: 'known' })
  assert.throws(
    () => applyWorldModelPatchEvidenceGuard(
      { schema_version: 1, add: {}, update: { medical_context: { care_level: null } } },
      patchEvidenceInput(baseline, '世界级医疗背景。'),
    ),
    error => error?.message === 'WORLD_MODEL_PATCH_EVIDENCE_UNSUPPORTED',
  )
})

test('World Model Patch accepts CHANGE without correction wording (AB)', () => {
  const baseline = normalizeWorldModel({
    schema_version: 1,
    species: [{ name: '直接规则物种', biological_types: [structuredFixtureType('甲型', '已有描述。', {
      reproduction_rules: { ...structuredFixtureType('x', '').reproduction_rules, gestation: '旧妊娠规则。' },
    })] }],
  })
  const candidate = patchSpeciesCandidate(baseline, {
    reproduction_rules: { ...baseline.species[0].biological_types[0].reproduction_rules, gestation: '新妊娠规则。' },
  })
  assert.doesNotThrow(() => applyWorldModelPatchEvidenceGuard(
    { schema_version: 1, add: {}, update: { species: [candidate] } },
    patchEvidenceInput(baseline, '直接规则物种甲型的妊娠规则为新妊娠规则。'),
  ))
})

test('World Model Patch rejects an explicitly individual-bound label hit (AC)', () => {
  const baseline = normalizeWorldModel({
    schema_version: 1,
    species: [{ name: '边界物种', description: '旧属性。' }],
  })
  const candidate = { ...baseline.species[0], description: '个体属性。' }
  assert.throws(
    () => applyWorldModelPatchEvidenceGuard(
      { schema_version: 1, add: {}, update: { species: [candidate] } },
      patchEvidenceInput(baseline, '边界物种的某个角色具有个体属性。'),
    ),
    error => error?.message === 'WORLD_MODEL_PATCH_EVIDENCE_UNSUPPORTED',
  )
})

test('World Model Patch presence metadata loss fails closed (AD)', () => {
  const baseline = normalizeWorldModel({
    schema_version: 1,
    medical_context: { childbirth_difficulty: 'known', care_level: 'known', evidence: 'known' },
  })
  const validated = applyWorldModelPatchEvidenceGuard(
    { schema_version: 1, add: {}, update: { medical_context: { care_level: 'new' } } },
    patchEvidenceInput(baseline, '世界级医疗背景的照护等级是 new。'),
  )
  const cloned = structuredClone(validated)
  assert.throws(
    () => mergeWorldModelPatch(baseline, cloned),
    error => error?.message === 'WORLD_MODEL_PATCH_PRESENCE_UNAVAILABLE',
  )
})

test('World Model Patch analyzer accepts fenced JSON without relaxing the patch schema', async () => {
  const analyzer = createAnalyzer({
    profileResolver: () => SILLYTAVERN_CURRENT_API,
    contextResolver: () => ({
      generateRaw: () => '```json\n{"schema_version":1,"add":{},"update":{}}\n```',
    }),
  })
  const patch = await analyzer.analyzeWorldModelPatch({ analysisInput: {} })
  assert.deepEqual(patch, { schema_version: 1, add: {}, update: {} })
  await assert.rejects(
    createAnalyzer({
      profileResolver: () => SILLYTAVERN_CURRENT_API,
      contextResolver: () => ({
        generateRaw: () => '```json\n{"schema_version":1,"add":{},"update":{},"remove":{}}\n```',
      }),
    }).analyzeWorldModelPatch({ analysisInput: {} }),
    error => error?.code === 'WORLD_MODEL_PATCH_INVALID',
  )
})

function v2ExistingModel() {
  return normalizeWorldModel({
    schema_version: 1,
    species: [{
      name: 'Species-A',
      description: 'Existing species.',
      biological_types: [{
        name: 'Type-A',
        description: 'Existing type.',
        capabilities: { can_produce_sperm: false },
        reproduction_rules: { gestation: 'existing rule' },
        special_rules: ['existing rule'],
        reproductive_mechanisms: [{ key: 'mechanism-a', label: 'Existing mechanism' }],
      }],
    }],
    medical_context: { childbirth_difficulty: 'existing difficulty', care_level: 'existing care', evidence: 'existing evidence' },
    exceptions: [{ statement: 'Existing exception.', applies_to: 'Species-A' }],
    unknowns: ['Existing unknown.'],
  })
}

function v2Evidence(text) {
  return { character: { description: text } }
}

function guardV2(operation, existing = v2ExistingModel(), evidence = '') {
  return applyWorldModelPatchV2EvidenceGuard(
    { schema_version: 2, operations: [operation] },
    existing,
    v2Evidence(evidence),
  )
}

function mergeV2(operations, existing = v2ExistingModel(), evidence = '') {
  return mergeWorldModelPatchV2(
    existing,
    { schema_version: 2, operations },
    v2Evidence(evidence),
  )
}

test('World Model Patch v2 structurally rejects non-v2 and non-contract DTOs', () => {
  assert.throws(() => validateWorldModelPatchV2({ schema_version: 1, operations: [] }), error => error?.message === 'WORLD_MODEL_PATCH_V2_SCHEMA_VERSION_INVALID')
  assert.throws(() => validateWorldModelPatchV2({ schema_version: 2, operations: {} }), error => error?.path === 'operations')
  assert.throws(() => validateWorldModelPatchV2({ schema_version: 2, operations: [{ op: 'REMOVE' }] }), error => error?.message === 'WORLD_MODEL_PATCH_V2_OPERATION_UNSUPPORTED')
  assert.throws(() => validateWorldModelPatchV2({ schema_version: 2, operations: [{ op: 'SET_FIELD', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }, path: ['capabilities', 'can_produce_sperm', 'nested'], value: true }] }), error => error?.path?.endsWith('.path'))
  assert.throws(() => validateWorldModelPatchV2({ schema_version: 2, operations: [{ op: 'SET_FIELD', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }, path: ['capabilities', '0'], value: true }] }), error => error?.path?.endsWith('.path'))
  assert.throws(() => validateWorldModelPatchV2({ schema_version: 2, operations: [{ op: 'SET_FIELD', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A', name: 'renamed' }, path: ['description'], value: 'new' }] }), error => error?.path?.endsWith('.name'))
  assert.throws(() => validateWorldModelPatchV2({ schema_version: 2, operations: [{ op: 'ADD_PROJECTION_RULE', projection_rule: { projection_rule_id: 'ai-supplied' } }] }), error => error?.path?.endsWith('.projection_rule_id'))
})

test('World Model Patch v2 classifies SET_FIELD as NO-OP, ADD, CHANGE, and rejects weakening', () => {
  const existing = v2ExistingModel()
  const classify = (operation) => classifyWorldModelPatchV2({ schema_version: 2, operations: [operation] }, existing)[0].classification
  assert.equal(classify({ op: 'SET_FIELD', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }, path: ['capabilities', 'can_produce_sperm'], value: false }), 'NO-OP')
  assert.equal(classify({ op: 'SET_FIELD', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }, path: ['capabilities', 'can_produce_ova'], value: true }), 'ADD')
  assert.equal(classify({ op: 'SET_FIELD', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }, path: ['reproduction_rules', 'gestation'], value: 'changed rule' }), 'CHANGE')
  assert.equal(classify({ op: 'SET_FIELD', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }, path: ['reproduction_rules', 'labor'], value: '无' }), 'ADD')
  assert.throws(() => classifyWorldModelPatchV2({ schema_version: 2, operations: [{ op: 'SET_FIELD', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }, path: ['reproduction_rules', 'gestation'], value: null }] }, existing), error => error?.message === 'WORLD_MODEL_PATCH_V2_REMOVE_UNSUPPORTED')
})

test('World Model Patch v2 detects duplicate and conflicting SET_FIELD changes independent of operation order', () => {
  const existing = v2ExistingModel()
  const target = { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }
  const change = { op: 'SET_FIELD', target, path: ['reproduction_rules', 'gestation'], value: 'new rule' }
  const duplicate = classifyWorldModelPatchV2({ schema_version: 2, operations: [change, structuredClone(change)] }, existing)
  assert.deepEqual(duplicate.map(result => result.classification), ['CHANGE', 'NO-OP'])
  const conflicting = { ...change, value: 'other rule' }
  assert.throws(() => classifyWorldModelPatchV2({ schema_version: 2, operations: [change, conflicting] }, existing), error => error?.message === 'WORLD_MODEL_PATCH_V2_IDENTITY_CONFLICT')
  assert.throws(() => classifyWorldModelPatchV2({ schema_version: 2, operations: [conflicting, change] }, existing), error => error?.message === 'WORLD_MODEL_PATCH_V2_IDENTITY_CONFLICT')
})

test('World Model Patch v2 canonicalizes species and type targets before lookup and pending identity', () => {
  const existing = normalizeWorldModel({
    schema_version: 1,
    species: [{ name: '人类', biological_types: [{ name: '男性', reproduction_rules: { gestation: 'existing rule' } }] }],
  })
  const canonicalTarget = { kind: 'biological_type', species_name: '人类', type_name: '男性' }
  const aliasTarget = { kind: 'biological_type', species_name: 'Homo sapiens', type_name: '男性人类' }
  const canonical = { op: 'SET_FIELD', target: canonicalTarget, path: ['reproduction_rules', 'gestation'], value: 'new rule' }
  const alias = { op: 'SET_FIELD', target: aliasTarget, path: ['reproduction_rules', 'gestation'], value: 'new rule' }
  const results = classifyWorldModelPatchV2({ schema_version: 2, operations: [canonical, alias] }, existing)
  assert.deepEqual(results.map(result => result.classification), ['CHANGE', 'NO-OP'])
  assert.deepEqual(results[1].operation.target, canonicalTarget)
  assert.throws(() => classifyWorldModelPatchV2({ schema_version: 2, operations: [
    { ...canonical, value: 'canonical change' },
    { ...alias, value: 'alias change' },
  ] }, existing), error => error?.message === 'WORLD_MODEL_PATCH_V2_IDENTITY_CONFLICT')
})

test('World Model Patch v2 resolves species-local type identity and duplicate semantics', () => {
  const existing = v2ExistingModel()
  const typeB = { name: 'Type-B', description: 'New type.' }
  assert.equal(classifyWorldModelPatchV2({ schema_version: 2, operations: [{ op: 'ADD_TYPE', target: { kind: 'species', species_name: 'Species-A' }, type: typeB }] }, existing)[0].classification, 'ADD')
  assert.throws(() => classifyWorldModelPatchV2({ schema_version: 2, operations: [{ op: 'ADD_TYPE', target: { kind: 'species', species_name: 'Species-B' }, type: typeB }] }, existing), error => error?.message === 'WORLD_MODEL_PATCH_V2_TARGET_NOT_FOUND')
  const withTypeB = normalizeWorldModel({ ...existing, species: [{ ...existing.species[0], biological_types: [...existing.species[0].biological_types, typeB] }] })
  assert.equal(classifyWorldModelPatchV2({ schema_version: 2, operations: [{ op: 'ADD_TYPE', target: { kind: 'species', species_name: 'Species-A' }, type: typeB }] }, withTypeB)[0].classification, 'NO-OP')
  assert.throws(() => classifyWorldModelPatchV2({ schema_version: 2, operations: [{ op: 'ADD_TYPE', target: { kind: 'species', species_name: 'Species-A' }, type: { ...typeB, description: 'conflict' } }] }, withTypeB), error => error?.message === 'WORLD_MODEL_PATCH_V2_IDENTITY_CONFLICT')
})

test('World Model Patch v2 collection identity is semantic and order-independent', () => {
  const existing = v2ExistingModel()
  const classify = (operation) => classifyWorldModelPatchV2({ schema_version: 2, operations: [operation] }, existing)[0].classification
  assert.equal(classify({ op: 'ADD_SPECIAL_RULE', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }, value: ' existing rule。 ' }), 'NO-OP')
  assert.equal(classify({ op: 'ADD_UNKNOWN', unknown: ' Existing unknown。 ' }), 'NO-OP')
  assert.equal(classify({ op: 'ADD_MECHANISM', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }, mechanism: { key: 'mechanism-a', label: 'Existing mechanism' } }), 'NO-OP')
  assert.throws(() => classifyWorldModelPatchV2({ schema_version: 2, operations: [{ op: 'ADD_MECHANISM', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }, mechanism: { key: 'mechanism-a', label: 'Conflicting mechanism' } }] }, existing), error => error?.message === 'WORLD_MODEL_PATCH_V2_IDENTITY_CONFLICT')
  const reordered = normalizeWorldModel({ ...existing, species: [{ ...existing.species[0], biological_types: [...existing.species[0].biological_types].reverse() }] })
  assert.equal(classifyWorldModelPatchV2({ schema_version: 2, operations: [{ op: 'ADD_TYPE', target: { kind: 'species', species_name: 'Species-A' }, type: structuredClone(reordered.species[0].biological_types[0]) }] }, reordered)[0].classification, 'NO-OP')
  assert.equal(classifyWorldModelPatchV2({ schema_version: 2, operations: [{ op: 'ADD_EXCEPTION', exception: { applies_to: 'Species-A', statement: 'Existing exception.' } }] }, existing)[0].classification, 'NO-OP')
})

test('World Model Patch v2 covers sparse world fields, species adds, duplicate operations, and generated projection identity', () => {
  const existing = v2ExistingModel()
  const validRule = {
    schema_version: 1,
    mechanism_key: 'mechanism-b',
    development_concern_key: 'concern-b',
    development_kind: 'possible_biological_change',
    trigger: { kind: 'story_time_reached', target_story_time: { day_index: 10 } },
  }
  assert.deepEqual(parseWorldModelPatchV2('{"schema_version":2,"operations":[]}'), { schema_version: 2, operations: [] })
  assert.equal(classifyWorldModelPatchV2({ schema_version: 2, operations: [{ op: 'ADD_SPECIES', species: { name: 'Species-B', description: 'New species.' } }] }, existing)[0].classification, 'ADD')
  assert.equal(classifyWorldModelPatchV2({ schema_version: 2, operations: [{ op: 'SET_FIELD', target: { kind: 'world' }, path: ['medical_context', 'care_level'], value: 'new care' }] }, existing)[0].classification, 'CHANGE')
  assert.equal(classifyWorldModelPatchV2({ schema_version: 2, operations: [{ op: 'ADD_PROJECTION_RULE', projection_rule: validRule }] }, existing)[0].classification, 'ADD')
  const duplicateType = { op: 'ADD_TYPE', target: { kind: 'species', species_name: 'Species-A' }, type: { name: 'Type-B', description: 'New type.' } }
  const duplicateResults = classifyWorldModelPatchV2({ schema_version: 2, operations: [duplicateType, structuredClone(duplicateType)] }, existing)
  assert.deepEqual(duplicateResults.map(result => result.classification).sort(), ['ADD', 'NO-OP'])
  assert.throws(() => classifyWorldModelPatchV2({ schema_version: 2, operations: [{ ...duplicateType, type: { name: 'Type-B', description: 'Other content.' } }, duplicateType] }, existing), error => error?.message === 'WORLD_MODEL_PATCH_V2_IDENTITY_CONFLICT')
})

test('World Model Patch v2 evidence guard validates species and species-local type existence', () => {
  assert.doesNotThrow(() => guardV2(
    { op: 'ADD_SPECIES', species: { name: 'Species-B' } },
    v2ExistingModel(),
    'Species-B exists as a stable world species.',
  ))
  assert.throws(() => guardV2(
    { op: 'ADD_SPECIES', species: { name: 'Species-B' } },
    v2ExistingModel(),
    'No permitted source names this species.',
  ), error => error?.message === 'WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED')
  assert.doesNotThrow(() => guardV2(
    { op: 'ADD_TYPE', target: { kind: 'species', species_name: 'Species-A' }, type: { name: 'Type-B' } },
    v2ExistingModel(),
    'Species-A 包含 Type-B 类型，属于稳定生物分类。',
  ))
  assert.throws(() => guardV2(
    { op: 'ADD_TYPE', target: { kind: 'species', species_name: 'Species-A' }, type: { name: 'Type-B' } },
    v2ExistingModel(),
    'Species-B 包含 Type-B 类型，属于稳定生物分类。',
  ), error => error?.message === 'WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED')
  assert.throws(() => guardV2(
    { op: 'ADD_TYPE', target: { kind: 'species', species_name: 'Species-A' }, type: { name: 'Type-B' } },
    v2ExistingModel(),
    'Type-B 类型被列出但没有物种范围。',
  ), error => error?.message === 'WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED')
})

test('World Model Patch v2 rejects subtree hitchhiking and accepts independently supported known leaves', () => {
  const partial = {
    op: 'ADD_TYPE',
    target: { kind: 'species', species_name: 'Species-A' },
    type: { name: 'Type-B', capabilities: { can_produce_ova: true, can_carry_pregnancy: false } },
  }
  assert.throws(() => guardV2(partial, v2ExistingModel(), 'Species-A 包含 Type-B 类型；Type-B 产生卵子。'), error => error?.message === 'WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED')
  const complete = {
    ...partial,
    type: {
      ...partial.type,
      description: 'Type-B is a stable reproductive class.',
      reproduction_rules: { gestation: '孕期为三月。' },
      lifecycle: { maturation: 'Type-B reaches maturity at maturity age.' },
      special_rules: ['Type-B follows the stable rule.'],
      reproductive_mechanisms: [{ key: 'mechanism-b', label: '路径B' }],
    },
  }
  assert.doesNotThrow(() => guardV2(
    complete,
    v2ExistingModel(),
    'Species-A 包含 Type-B 类型。Species-A 的 Type-B 产生卵子且不能怀孕。Species-A 的 Type-B 是稳定生殖分类。Species-A 的 Type-B 孕期为三月。Species-A 的 Type-B 达到成熟年龄。Species-A 的 Type-B 遵循稳定规则。Species-A 的 Type-B 路径B。',
  ))
})

test('World Model Patch v2 evidence guard keeps NO-OP unproved and validates ADD/CHANGE scope', () => {
  const existing = v2ExistingModel()
  assert.doesNotThrow(() => guardV2(
    { op: 'SET_FIELD', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }, path: ['reproduction_rules', 'gestation'], value: 'existing rule' },
    existing,
    '',
  ))
  assert.doesNotThrow(() => guardV2(
    { op: 'SET_FIELD', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }, path: ['reproduction_rules', 'gestation'], value: '新规则' },
    existing,
    'Species-A 的 Type-A 记录新规则。',
  ))
  assert.throws(() => guardV2(
    { op: 'SET_FIELD', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }, path: ['reproduction_rules', 'gestation'], value: 'new rule' },
    existing,
    '',
  ), error => error?.message === 'WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED')
  assert.throws(() => applyWorldModelPatchV2EvidenceGuard(
    { schema_version: 2, operations: [{ op: 'SET_FIELD', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }, path: ['reproduction_rules', 'gestation'], value: 'new rule' }] },
    existing,
    { world_model: existing },
  ), error => error?.message === 'WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED')
  assert.throws(() => guardV2(
    { op: 'SET_FIELD', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }, path: ['reproduction_rules', 'gestation'], value: 'new rule' },
    existing,
    '某个角色 Species-A Type-A has new rule.',
  ), error => error?.message === 'WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED')
  assert.throws(() => guardV2(
    { op: 'SET_FIELD', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }, path: ['reproduction_rules', 'gestation'], value: 'new rule' },
    existing,
    'Species-A and Type-A are mentioned without a binding rule.',
  ), error => error?.message === 'WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED')
})

test('World Model Patch v2 maps familiar type labels from scoped biological wording', () => {
  const existing = v2ExistingModel()
  for (const evidence of [
    'Species-A 的性别基本为男性，极少女 Species-A。',
    'Species-A 基本为男性，极少雌性个体。',
    'Species-A 基本为男性，极少男 Species-A。',
  ]) {
    assert.doesNotThrow(() => guardV2(
      { op: 'ADD_TYPE', target: { kind: 'species', species_name: 'Species-A' }, type: { name: evidence.includes('男 Species-A') ? '男性' : '女性' } },
      existing,
      evidence,
    ))
  }
  assert.throws(() => guardV2(
    { op: 'ADD_TYPE', target: { kind: 'species', species_name: 'Species-A' }, type: { name: '女性' } },
    existing,
    '角色甲是女性。',
  ), error => error?.message === 'WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED')
  assert.throws(() => guardV2(
    { op: 'ADD_TYPE', target: { kind: 'species', species_name: 'Species-A' }, type: { name: '女性' } },
    existing,
    'Species-B 存在女性。',
  ), error => error?.message === 'WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED')
  assert.throws(() => guardV2(
    { op: 'ADD_TYPE', target: { kind: 'species', species_name: 'Species-A' }, type: { name: '女性' } },
    existing,
    'Species-A 与女性角色互动。',
  ), error => error?.message === 'WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED')
  assert.doesNotThrow(() => guardV2(
    { op: 'ADD_TYPE', target: { kind: 'species', species_name: 'Species-A' }, type: { name: 'Type-B' } },
    existing,
    'Species-A 的 Type-B 是稳定生殖分类。',
  ))
})

test('World Model Patch v2 accepts descriptive type paraphrase but blocks capability hitchhiking', () => {
  const existing = v2ExistingModel()
  assert.doesNotThrow(() => guardV2(
    {
      op: 'ADD_TYPE',
      target: { kind: 'species', species_name: 'Species-A' },
      type: { name: '女性', description: '极少数出现的女性形态 Species-A。' },
    },
    existing,
    'Species-A 的性别基本为男性，极少女 Species-A。',
  ))
  assert.throws(() => guardV2(
    {
      op: 'ADD_TYPE',
      target: { kind: 'species', species_name: 'Species-A' },
      type: { name: '女性', description: '极少数出现且可以怀孕的女性形态 Species-A。' },
    },
    existing,
    'Species-A 的性别基本为男性，极少女 Species-A。',
  ), error => error?.message === 'WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED')
})

test('World Model Patch v2 evidence guard validates collections, unknowns, exceptions, and projection adds', () => {
  const existing = v2ExistingModel()
  assert.doesNotThrow(() => guardV2(
    { op: 'ADD_SPECIAL_RULE', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }, value: '新特殊规则' },
    existing,
    'Species-A 的 Type-A 特殊规则为新特殊规则。',
  ))
  assert.throws(() => guardV2(
    { op: 'ADD_SPECIAL_RULE', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }, value: 'new special rule' },
    existing,
    'A different fact is recorded.',
  ), error => error?.message === 'WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED')
  assert.throws(() => guardV2(
    { op: 'ADD_MECHANISM', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }, mechanism: { key: 'mechanism-b', pathway: 'mechanism-b pathway', carrying_compatibility: true } },
    existing,
    'Species-A 的 Type-A 的 mechanism-b pathway 已支持，但兼容性未说明。',
  ), error => error?.message === 'WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED')
  assert.doesNotThrow(() => guardV2(
    { op: 'ADD_MECHANISM', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }, mechanism: { key: 'mechanism-b', label: '标签B', pathway: '路径B', carrying_compatibility: true, world_model_rule_refs: ['孕期规则'] } },
    existing,
    'Species-A 的 Type-A 的 mechanism-b 标签B路径B支持携带妊娠，相关规则为孕期规则。',
  ))
  assert.doesNotThrow(() => guardV2(
    { op: 'ADD_EXCEPTION', exception: { statement: 'Species-A 存在世界级例外。', applies_to: 'Species-A' } },
    existing,
    'Species-A 存在世界级例外。',
  ))
  assert.throws(() => guardV2(
    { op: 'ADD_EXCEPTION', exception: { statement: 'Species-A 存在世界级例外。', applies_to: 'Species-A' } },
    existing,
    '某个角色经历了 Species-A 的单一个体例外。',
  ), error => error?.message === 'WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED')
  assert.doesNotThrow(() => guardV2(
    { op: 'ADD_UNKNOWN', unknown: 'Species-A mechanism remains unresolved.' },
    existing,
    'World-level Species-A mechanism remains unresolved.',
  ))
  assert.throws(() => guardV2(
    { op: 'ADD_UNKNOWN', unknown: 'A missing capability is worth investigating.' },
    existing,
    '',
  ), error => error?.message === 'WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED')
  assert.throws(() => guardV2(
    { op: 'ADD_SPECIAL_RULE', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }, value: 'unsupported sibling rule' },
    existing,
    '',
  ), error => error?.message === 'WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED')
  assert.throws(() => applyWorldModelPatchV2EvidenceGuard(
    {
      schema_version: 2,
      operations: [
        { op: 'SET_FIELD', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }, path: ['reproduction_rules', 'gestation'], value: 'existing rule' },
        { op: 'ADD_SPECIAL_RULE', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }, value: 'unsupported sibling rule' },
      ],
    },
    existing,
    {},
  ), error => error?.message === 'WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED')
  const projectionRule = {
    schema_version: 1,
    mechanism_key: 'mechanism-b',
    development_concern_key: 'concern-b',
    development_kind: 'possible_biological_change',
    trigger: { kind: 'story_time_reached', target_story_time: { day_index: 10 } },
  }
  assert.doesNotThrow(() => guardV2(
    { op: 'ADD_PROJECTION_RULE', projection_rule: projectionRule },
    existing,
    'World rule mechanism-b supports concern-b possible_biological_change with story_time_reached target story day 10.',
  ))
  assert.throws(() => guardV2(
    { op: 'ADD_PROJECTION_RULE', projection_rule: projectionRule },
    existing,
    'No permitted source supports this projection.',
  ), error => error?.message === 'WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED')
  assert.throws(() => guardV2(
    { op: 'ADD_PROJECTION_RULE', projection_rule: projectionRule },
    existing,
    'The mechanism-b projection mechanism is supported.',
  ), error => error?.message === 'WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED')
  assert.throws(() => guardV2(
    { op: 'ADD_PROJECTION_RULE', projection_rule: projectionRule },
    existing,
    'The development kind possible_biological_change is supported, but the trigger story_time_reached target is not established.',
  ), error => error?.message === 'WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED')
  assert.throws(() => guardV2(
    { op: 'ADD_PROJECTION_RULE', projection_rule: projectionRule },
    existing,
    'An unrelated fact contains the number 10.',
  ), error => error?.message === 'WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED')
  assert.throws(() => guardV2(
    { op: 'ADD_PROJECTION_RULE', projection_rule: projectionRule },
    existing,
    'A separate duration field is 10 days; no target story time is provided.',
  ), error => error?.message === 'WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED')
  const projectionRuleWithCapability = {
    ...projectionRule,
    requirements: { capabilities: [{ key: 'can_carry_pregnancy', equals: true }] },
  }
  assert.throws(() => guardV2(
    { op: 'ADD_PROJECTION_RULE', projection_rule: projectionRuleWithCapability },
    existing,
    'World rule mechanism-b supports concern-b possible_biological_change with story_time_reached target story day 10; can_carry_pregnancy is listed, and an unrelated flag is true.',
  ), error => error?.message === 'WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED')
  assert.doesNotThrow(() => guardV2(
    { op: 'ADD_PROJECTION_RULE', projection_rule: projectionRuleWithCapability },
    existing,
    'World rule mechanism-b supports concern-b possible_biological_change with story_time_reached target story day 10; capability can_carry_pregnancy equals true.',
  ))
  assert.throws(() => applyWorldModelPatchV2EvidenceGuard(
    [{
      operation: { op: 'SET_FIELD', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }, path: ['reproduction_rules', 'gestation'], value: 'invented rule' },
      classification: 'NO-OP',
    }],
    existing,
    {},
  ), error => error?.code === 'WORLD_MODEL_PATCH_V2_INVALID')
})

test('World Model Patch v2 accepts evidence-grounded exception paraphrase and rejects semantic hitchhiking', () => {
  const existing = v2ExistingModel()
  const evidence = 'Compound-X 服用后不论性别、物种均产生 Effect-Y 三日。'
  const paraphrase = {
    op: 'ADD_EXCEPTION',
    exception: {
      statement: '服用 Compound-X 后，任何性别与物种的个体均会出现 Effect-Y，持续三日。',
      applies_to: '任何性别与物种',
      evidence,
    },
  }
  assert.doesNotThrow(() => guardV2(paraphrase, existing, evidence))
  assert.doesNotThrow(() => guardV2({
    ...paraphrase,
    exception: { ...paraphrase.exception, statement: evidence },
  }, existing, evidence))
  assert.throws(() => guardV2({
    ...paraphrase,
    exception: { ...paraphrase.exception, statement: '服用 Compound-X 后永久出现 Effect-Y。' },
  }, existing, evidence), error => error?.message === 'WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED')
  assert.throws(() => guardV2({
    ...paraphrase,
    exception: { ...paraphrase.exception, statement: '服用 Compound-X 后，任何性别与物种的个体均会出现 Effect-Z，持续三日。' },
  }, existing, evidence), error => error?.message === 'WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED')
  assert.throws(() => guardV2({
    ...paraphrase,
    exception: { ...paraphrase.exception, statement: '所有个体天然具有 Effect-Y。' },
  }, existing, evidence), error => error?.message === 'WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED')
  assert.throws(() => guardV2({
    ...paraphrase,
    exception: { ...paraphrase.exception, statement: '服用 Effect-Y 后，任何性别与物种的个体均会出现 Compound-X，持续三日。' },
  }, existing, evidence), error => error?.message === 'WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED')
})

test('World Model Patch v2 exception guard rejects unsupported scope and individual-only upgrades', () => {
  const existing = v2ExistingModel()
  assert.throws(() => guardV2({
    op: 'ADD_EXCEPTION',
    exception: {
      statement: '服用 Compound-X 后，任何物种都会出现 Effect-Y。',
      applies_to: '任何物种',
    },
  }, existing, 'Species-A 服用 Compound-X 后出现 Effect-Y。'), error => error?.message === 'WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED')
  assert.throws(() => guardV2({
    op: 'ADD_EXCEPTION',
    exception: {
      statement: '所有 Species-A 个体服用 Compound-X 后都会出现 Effect-Y。',
      applies_to: 'Species-A',
    },
  }, existing, 'Character-A 服用 Compound-X 后出现 Effect-Y。'), error => error?.message === 'WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED')
  assert.throws(() => guardV2({
    op: 'ADD_EXCEPTION',
    exception: {
      statement: '服用 Compound-X 后获得怀孕能力。',
      applies_to: '任何性别与物种',
    },
  }, existing, 'Compound-X 服用后不论性别、物种均产生 Effect-Y 三日。'), error => error?.message === 'WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED')
})

test('World Model Patch v2 preserves atomicity for valid type plus invalid exception', () => {
  const existing = v2ExistingModel()
  const snapshot = structuredClone(existing)
  assert.throws(() => mergeV2([
    {
      op: 'ADD_TYPE',
      target: { kind: 'species', species_name: 'Species-A' },
      type: { name: 'Type-B', description: '稳定新增类型。' },
    },
    {
      op: 'ADD_EXCEPTION',
      exception: {
        statement: '服用 Compound-X 后永久出现 Effect-Y。',
        applies_to: '任何性别与物种',
      },
    },
  ], existing, 'Species-A 存在稳定 Type-B 类型。Compound-X 服用后不论性别、物种均产生 Effect-Y 三日。'), error => error?.message === 'WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED')
  assert.deepEqual(existing, snapshot)
})

test('World Model Patch v2 sparse merge preserves Existing data and applies independent operations', () => {
  const existing = v2ExistingModel()
  const snapshot = structuredClone(existing)
  assert.deepEqual(mergeV2([]), normalizeWorldModel(existing, { strict: true, allowGeneratedProjectionRuleIds: true }))
  assert.deepEqual(mergeV2([
    { op: 'SET_FIELD', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }, path: ['capabilities', 'can_produce_sperm'], value: false },
  ]), normalizeWorldModel(existing, { strict: true, allowGeneratedProjectionRuleIds: true }))

  const result = mergeV2([
    { op: 'ADD_SPECIES', species: { name: 'Species-B', description: '新物种描述' } },
    { op: 'SET_FIELD', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }, path: ['capabilities', 'can_produce_ova'], value: true },
    { op: 'SET_FIELD', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }, path: ['reproduction_rules', 'gestation'], value: '更新妊娠规则' },
    { op: 'SET_FIELD', target: { kind: 'species', species_name: 'Species-A' }, path: ['description'], value: '更新物种描述' },
    { op: 'SET_FIELD', target: { kind: 'world' }, path: ['medical_context', 'care_level'], value: '更新护理等级' },
    { op: 'ADD_TYPE', target: { kind: 'species', species_name: 'Species-A' }, type: { name: 'Type-B', description: '新类型描述' } },
    { op: 'ADD_SPECIAL_RULE', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }, value: '新特殊规则' },
    { op: 'ADD_MECHANISM', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }, mechanism: { key: 'mechanism-b', label: '标签B', pathway: '路径B' } },
    { op: 'ADD_EXCEPTION', exception: { statement: 'Species-A 存在世界级例外。', applies_to: 'Species-A' } },
    { op: 'ADD_UNKNOWN', unknown: 'Species-A 的机制仍未确定。' },
  ], existing, '【Species-B】存在，描述为新物种描述。Species-A 的 Type-B 是稳定生物类型，描述为新类型描述。Species-A 的 Type-A 能产生卵子，更新妊娠规则，描述为更新物种描述。World medical care_level 更新护理等级。Species-A 的 Type-A 新特殊规则。Species-A 的 Type-A 的 mechanism-b 标签B路径B。Species-A 存在世界级例外。Species-A 的机制仍未确定。')

  assert.equal(result.species.find((item) => item.name === 'Species-A').description, '更新物种描述')
  assert.equal(result.species.find((item) => item.name === 'Species-A').biological_types.find((item) => item.name === 'Type-A').capabilities.can_produce_ova, true)
  assert.equal(result.species.find((item) => item.name === 'Species-A').biological_types.find((item) => item.name === 'Type-A').reproduction_rules.gestation, '更新妊娠规则')
  assert.equal(result.species.find((item) => item.name === 'Species-A').biological_types.find((item) => item.name === 'Type-A').special_rules.length, 2)
  assert.equal(result.species.find((item) => item.name === 'Species-A').biological_types.find((item) => item.name === 'Type-A').reproductive_mechanisms.length, 2)
  assert.equal(result.medical_context.care_level, '更新护理等级')
  assert.equal(result.medical_context.childbirth_difficulty, 'existing difficulty')
  assert.equal(result.medical_context.evidence, 'existing evidence')
  assert.equal(result.species.find((item) => item.name === 'Species-A').biological_types.find((item) => item.name === 'Type-A').reproduction_rules.cycle, null)
  assert.deepEqual(existing, snapshot)
})

test('World Model Patch v2 sparse merge is atomic and rejects untrusted classified input', () => {
  const existing = v2ExistingModel()
  const snapshot = structuredClone(existing)
  assert.throws(() => mergeWorldModelPatchV2(existing, [
    { operation: { op: 'SET_FIELD', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }, path: ['description'], value: 'forged' }, classification: 'NO-OP' },
  ]), error => error?.code === 'WORLD_MODEL_PATCH_V2_INVALID')
  assert.deepEqual(existing, snapshot)

  assert.throws(() => mergeV2([
    { op: 'SET_FIELD', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }, path: ['description'], value: 'accepted first' },
    { op: 'REMOVE', target: { kind: 'species', species_name: 'Species-A' } },
  ], existing, 'Species-A 的 Type-A description accepted first.'), error => error?.message === 'WORLD_MODEL_PATCH_V2_OPERATION_UNSUPPORTED')
  assert.deepEqual(existing, snapshot)
})

test('World Model Patch v2 sparse merge is independent of operation order and keeps v1 merge separate', () => {
  const existing = v2ExistingModel()
  const operations = [
    { op: 'SET_FIELD', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }, path: ['description'], value: '有序描述' },
    { op: 'SET_FIELD', target: { kind: 'world' }, path: ['medical_context', 'care_level'], value: '有序护理' },
  ]
  const evidence = 'Species-A 的 Type-A 描述为有序描述。World medical care_level 为有序护理。'
  const forward = mergeV2(operations, existing, evidence)
  const reverse = mergeV2([...operations].reverse(), existing, evidence)
  assert.deepEqual(reverse, forward)
  assert.throws(() => mergeV2([
    { op: 'SET_FIELD', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }, path: ['reproduction_rules', 'gestation'], value: '第一次变更' },
    { op: 'SET_FIELD', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }, path: ['reproduction_rules', 'gestation'], value: '第二次变更' },
  ], existing, 'Species-A 的 Type-A 第一次变更 第二次变更。'), error => error?.message === 'WORLD_MODEL_PATCH_V2_IDENTITY_CONFLICT')
  const v1 = mergeWorldModelPatch(existing, { schema_version: 1, add: {}, update: {} })
  assert.deepEqual(v1, normalizeWorldModel(existing, { allowGeneratedProjectionRuleIds: true }))
})

test('World Model Patch v2 sparse merge applies projection generated identity and final consistency', () => {
  const existing = v2ExistingModel()
  const projectionRule = {
    schema_version: 1,
    mechanism_key: 'mechanism-b',
    development_concern_key: 'concern-b',
    development_kind: 'possible_biological_change',
    trigger: { kind: 'story_time_reached', target_story_time: { day_index: 10 } },
  }
  const result = mergeV2([
    { op: 'SET_FIELD', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Type-A' }, path: ['capabilities', 'can_carry_pregnancy'], value: false },
    { op: 'ADD_PROJECTION_RULE', projection_rule: projectionRule },
  ], existing, 'Species-A 的 Type-A 不能妊娠。World rule mechanism-b supports concern-b possible_biological_change with story_time_reached target story day 10.')
  const type = result.species[0].biological_types[0]
  assert.equal(type.reproduction_rules.pregnancy_or_carrying, '无')
  assert.equal(type.reproduction_rules.gestation, '无')
  assert.equal(result.projection_rules.length, 1)
  assert.match(result.projection_rules[0].projection_rule_id, /^projection_rule_/u)
  assert.throws(() => mergeV2([
    { op: 'SET_FIELD', target: { kind: 'biological_type', species_name: 'Species-A', type_name: 'Missing-Type' }, path: ['description'], value: 'invalid' },
  ], existing, 'Species-A Missing-Type description invalid.'), error => error?.message === 'WORLD_MODEL_PATCH_V2_TARGET_NOT_FOUND')
})

test('World Model Patch v2 sorts only appended projections deterministically', () => {
  const makeRule = (suffix, day) => ({
    schema_version: 1,
    mechanism_key: `mechanism-${suffix}`,
    development_concern_key: `concern-${suffix}`,
    development_kind: 'possible_biological_change',
    trigger: { kind: 'story_time_reached', target_story_time: { day_index: day } },
  })
  const evidenceFor = (rule) => `World rule ${rule.mechanism_key} supports ${rule.development_concern_key} ${rule.development_kind} with story_time_reached target story day ${rule.trigger.target_story_time.day_index}.`
  const existing = v2ExistingModel()
  const ruleA = makeRule('a', 10)
  const ruleB = makeRule('b', 20)
  const ruleE = makeRule('e', 5)
  const evidence = [ruleA, ruleB, ruleE].map(evidenceFor).join(' ')
  const forward = mergeV2([
    { op: 'ADD_PROJECTION_RULE', projection_rule: ruleA },
    { op: 'ADD_PROJECTION_RULE', projection_rule: ruleB },
  ], existing, evidence)
  const reverse = mergeV2([
    { op: 'ADD_PROJECTION_RULE', projection_rule: ruleB },
    { op: 'ADD_PROJECTION_RULE', projection_rule: ruleA },
  ], existing, evidence)
  assert.deepEqual(forward, reverse)

  const existingWithProjection = normalizeWorldModel({ ...existing, projection_rules: [ruleE] }, { allowGeneratedProjectionRuleIds: true })
  const preserved = mergeV2([
    { op: 'ADD_PROJECTION_RULE', projection_rule: ruleA },
    { op: 'ADD_PROJECTION_RULE', projection_rule: ruleB },
  ], existingWithProjection, evidence)
  assert.equal(preserved.projection_rules[0].projection_rule_id, existingWithProjection.projection_rules[0].projection_rule_id)
  assert.deepEqual(
    preserved.projection_rules.slice(1).map((item) => item.projection_rule_id),
    preserved.projection_rules.slice(1).map((item) => item.projection_rule_id).sort(),
  )

  const mixedOperations = [
    { op: 'ADD_EXCEPTION', exception: { statement: 'Species-A 存在另一个世界级例外。', applies_to: 'Species-A' } },
    { op: 'ADD_UNKNOWN', unknown: 'Species-A 的另一个机制仍未确定。' },
    { op: 'ADD_PROJECTION_RULE', projection_rule: ruleA },
  ]
  const mixedEvidence = `${evidenceFor(ruleA)} Species-A 存在另一个世界级例外。Species-A 的另一个机制仍未确定。`
  assert.deepEqual(
    mergeV2(mixedOperations, existing, mixedEvidence),
    mergeV2([...mixedOperations].reverse(), existing, mixedEvidence),
  )
})

test('World Model strict parser enforces canonical list shapes with diagnostics', () => {
  const canonical = parseWorldModelResponse(JSON.stringify(modelFixture))
  assert.deepEqual(canonical.exceptions, modelFixture.exceptions)
  assert.deepEqual(canonical.unknowns, modelFixture.unknowns)
  for (const [field, value] of [['exceptions', { entity: '例外' }], ['unknowns', { entity: '未知' }]]) {
    assert.throws(
      () => parseWorldModelResponse(JSON.stringify({ ...modelFixture, [field]: value })),
      error => error?.code === 'WORLD_MODEL_INVALID' && error.path === field && error.expected === 'array',
    )
  }
  assert.throws(
    () => parseWorldModelResponse(JSON.stringify({
      ...modelFixture,
      species: [{ ...modelFixture.species[0], biological_types: [{ ...modelFixture.species[0].biological_types[0], capabilities: { can_fertilize: { value: true } } }] }],
    })),
    error => error?.path === 'species[0].biological_types[0].capabilities.can_fertilize' && error.expected === 'boolean|null',
  )
})

test('World Model prompt states canonical exceptions, unknowns, and special_rules shapes', () => {
  const messages = buildWorldModelMessages({ character: { description: 'generic evidence' } })
  const prompt = messages.map(message => message.content).join('\n\n')
  assert.match(prompt, /exceptions 必须是 JSON 数组/)
  assert.match(prompt, /每项必须是对象，固定包含 statement、applies_to、evidence/)
  assert.match(prompt, /三者均为 nullable string/)
  assert.match(prompt, /unknowns 必须是 JSON 字符串数组/)
  assert.match(prompt, /special_rules 必须是 JSON 字符串数组/)
  assert.match(prompt, /实体名称为 key 的对象映射/)
  assert.match(prompt, /没有例外时输出 \[\]/)
  assert.match(prompt, /不得使用对象映射；没有未知项时输出 \[\]/)
  assert.match(prompt, /没有特殊规则时输出 \[\]/)
  assert.doesNotMatch(prompt, /Canonical JSON shape/)
  assert.doesNotMatch(prompt, /"schema_version"\s*:\s*1/)
  assert.doesNotMatch(prompt, /"statement"\s*:\s*null/)
})

test('World Model prompt routes discovered facts without relaxing evidence thresholds', () => {
  const fixtures = [
    {
      id: 'A-medical-case',
      input: '某产妇因难产死亡。',
      expected: {
        medical_context: {
          childbirth_difficulty: '存在难产导致产妇死亡的案例',
          care_level: null,
          evidence: '某产妇因难产死亡。',
        },
        exceptions: [],
        unknowns: [],
      },
    },
    {
      id: 'B-human-without-medical-fact',
      input: '普通人类可以自然生育，但资料没有医疗信息。',
      expected: {
        medical_context: {
          childbirth_difficulty: null,
          care_level: null,
          evidence: null,
        },
        exceptions: [],
        unknowns: [],
      },
    },
    {
      id: 'C-temporary-deviation',
      input: '该物种通常只有女性可以孕育，但临时法术使一名男性短暂获得孕育能力。',
      expected: {
        exceptions: [{
          statement: '临时法术使一名男性短暂获得孕育能力。',
          applies_to: '该名男性',
          evidence: '临时法术使一名男性短暂获得孕育能力。',
        }],
        unknowns: [],
      },
    },
    {
      id: 'D-triggered-mechanism-unknown',
      input: '该族可以通过魔力使另一方怀孕，但资料没有说明是否存在配子结合。',
      expected: {
        exceptions: [],
        unknowns: ['是否需要配子结合尚未确定。'],
      },
    },
    {
      id: 'E-untouched-mechanism',
      input: '资料只说明该族存在妊娠现象，没有提及剖宫产。',
      expected: {
        exceptions: [],
        unknowns: [],
      },
    },
    {
      id: 'F-no-exception-evidence',
      input: '普通人类女性可以孕育。',
      expected: {
        exceptions: [],
        unknowns: [],
      },
    },
  ]
  const prompt = buildWorldModelMessages({ character: { description: fixtures[0].input } })
    .map(message => message.content)
    .join('\n\n')
  assert.match(prompt, /完整扫描全部 permitted AnalysisInput，先发现所有与生物学、生殖、妊娠、分娩、生理变化和医疗\/照护有关的 evidence-supported biological facts/)
  assert.match(prompt, /继续检查 reproduction_rules、reproductive_mechanisms、special_rules、medical_context、exceptions、unknowns、projection_rules 等合法 outlet/)
  assert.match(prompt, /事实不能建立 Biological Type 时，不得因此丢弃/)
  assert.match(prompt, /individual fact 不自动升级为 species\/world-wide rule/)
  assert.match(prompt, /没有 exception evidence 不生成 exception/)
  assert.match(prompt, /unknowns 只记录已被 evidence 触及但仍 unresolved/u)
  assert.match(prompt, /是否有已发现但未归档的 biological fact/)

  for (const fixture of fixtures) {
    const fixturePrompt = buildWorldModelMessages({ character: { description: fixture.input } })
      .map(message => message.content)
      .join('\n\n')
    assert.ok(fixturePrompt.includes(fixture.input), `${fixture.id} should remain in the prompt evidence`)
    const response = {
      ...modelFixture,
      ...fixture.expected,
      species: [],
    }
    const parsed = parseWorldModelResponse(JSON.stringify(response))
    for (const [field, expected] of Object.entries(fixture.expected)) {
      assert.deepEqual(parsed[field], expected, `${fixture.id} should preserve ${field}`)
    }
  }
})

test('World Model parser distinguishes JSON syntax errors from schema diagnostics', () => {
  assert.throws(
    () => parseWorldModelResponse('{ not valid json'),
    error =>
      error?.code === 'WORLD_MODEL_INVALID' &&
      error.stage === 'json_parse' &&
      error.path === '$',
  )
  assert.throws(
    () => parseWorldModelResponse(JSON.stringify({ ...modelFixture, unknowns: { entity: 'unknown' } })),
    error =>
      error?.code === 'WORLD_MODEL_INVALID' &&
      error.stage === 'schema_validation' &&
      error.path === 'unknowns' &&
      error.expected === 'array' &&
      error.received === 'object',
  )
})

test('World Model reproductive mechanism carrying compatibility keeps the strict tri-state contract', () => {
  for (const value of [true, false, null]) {
    const model = structuredClone(modelFixture)
    model.species[0].biological_types[0].reproductive_mechanisms = [{
      key: 'natural_conception',
      label: '自然受孕',
      pathway: '明确的生殖路径',
      carrying_compatibility: value,
      world_model_rule_refs: [],
      evidence: [],
    }]
    assert.equal(
      parseWorldModelResponse(JSON.stringify(model)).species[0].biological_types[0].reproductive_mechanisms[0].carrying_compatibility,
      value,
    )
  }
  for (const value of ['无', '人类女性子宫']) {
    const model = structuredClone(modelFixture)
    model.species[0].biological_types[0].reproductive_mechanisms = [{ carrying_compatibility: value }]
    assert.throws(
      () => parseWorldModelResponse(JSON.stringify(model)),
      error => error?.path === 'species[0].biological_types[0].reproductive_mechanisms[0].carrying_compatibility'
        && error?.expected === 'boolean|null'
        && error?.received === 'string'
        && error?.validator === 'nullableBoolean',
    )
  }
})

test('World Model reproductive mechanisms use array defaults and complete element diagnostics', () => {
  const omitted = structuredClone(modelFixture)
  delete omitted.species[0].biological_types[0].reproductive_mechanisms
  assert.deepEqual(
    parseWorldModelResponse(JSON.stringify(omitted)).species[0].biological_types[0].reproductive_mechanisms,
    [],
  )

  const nullValue = structuredClone(modelFixture)
  nullValue.species[0].biological_types[0].reproductive_mechanisms = null
  assert.throws(
    () => parseWorldModelResponse(JSON.stringify(nullValue)),
    error => error?.path === 'species[0].biological_types[0].reproductive_mechanisms'
      && error?.expected === 'array'
      && error?.received === 'object'
      && error?.validator === 'normalizeBiologicalType',
  )

  for (const field of ['world_model_rule_refs', 'evidence']) {
    const model = structuredClone(modelFixture)
    model.species[0].biological_types[0].reproductive_mechanisms = [{ [field]: [{ invalid: true }] }]
    assert.throws(
      () => parseWorldModelResponse(JSON.stringify(model)),
      error => error?.path === `species[0].biological_types[0].reproductive_mechanisms[0].${field}[0]`
        && error?.expected === 'string|null'
        && error?.received === 'object'
        && error?.validator === 'nullableText',
    )
  }
})

test('Real World Model response fixtures preserve the production acceptance boundary', () => {
  assert.throws(
    () => parseWorldModelResponse(JSON.stringify(failedWorldResponseFixture)),
    error => error?.path === 'species[0].biological_types[0].reproductive_mechanisms[0].carrying_compatibility'
      && error?.expected === 'boolean|null'
      && error?.received === 'string',
  )
  assert.deepEqual(
    parseWorldModelResponse(JSON.stringify(successfulWorldResponseFixture)),
    successfulWorldResponseFixture,
  )
})

test('World Model projection rules use the production raw schema and diagnostics', () => {
  const validRule = {
    schema_version: 1,
    mechanism_key: 'natural_conception',
    development_concern_key: 'pregnancy_confirmation',
    development_kind: 'possible_biological_change',
    trigger: { kind: 'story_time_reached', target_story_time: { day_index: 10 } },
    requirements: {
      capabilities: [{ key: 'can_carry_pregnancy', equals: true }],
      source_compatibility: 'not_required',
      contributor_relationships: [{ relationship_key: 'spouse', attribution: 'confirmed' }],
    },
    realization: { event_types: ['pregnancy_confirmation'], statuses: ['confirmed'], payload_equals: {} },
    contradiction: { event_types: [], statuses: [], payload_equals: {} },
    expiration: { trigger: { kind: 'story_time_reached', target_story_time: { day_index: 30 } } },
  }
  const model = structuredClone(modelFixture)
  model.projection_rules = [validRule]
  const normalized = parseWorldModelResponse(JSON.stringify(model))
  assert.match(normalized.projection_rules[0].projection_rule_id, /^projection_rule_/)
  assert.equal(normalized.projection_rules[0].development_kind, validRule.development_kind)

  for (const [field, value, expectedPath] of [
    ['development_kind', 'invalid_kind', 'projection_rules[0].development_kind'],
    ['trigger', { kind: 'invalid_trigger' }, 'projection_rules[0].trigger.kind'],
    ['requirements', { capabilities: [{ key: 'can_carry_pregnancy', equals: 'yes' }] }, 'projection_rules[0].requirements.capabilities[0]'],
  ]) {
    const invalid = structuredClone(model)
    invalid.projection_rules[0][field] = value
    assert.throws(
      () => parseWorldModelResponse(JSON.stringify(invalid)),
      error => error?.path === expectedPath
        && error?.diagnosticCode === 'WORLD_MODEL_PROJECTION_RULES_INVALID'
        && error?.validator === 'normalizeProjectionRules → validateProjectionRuleContent',
    )
  }
})

test('World Model Initial and Patch prompts expose the same strict mechanism and projection contracts', () => {
  const initialPrompt = buildWorldModelMessages().map(message => message.content).join('\n')
  const patchPrompt = buildWorldModelPatchMessages().map(message => message.content).join('\n')
  for (const prompt of [initialPrompt, patchPrompt]) {
    assert.match(prompt, /reproductive_mechanisms 必须是 JSON array/)
    assert.match(prompt, /不得输出 null/)
    assert.match(prompt, /carrying_compatibility boolean\|null/)
    assert.match(prompt, /明确支持为 true，明确不支持为 false，证据不足为 null/)
    assert.match(prompt, /world_model_rule_refs string\[\]/)
    assert.match(prompt, /evidence string\[\]/)
    assert.match(prompt, /projection_rule_id/)
    assert.match(prompt, /possible_biological_change/)
    assert.match(prompt, /immediate_after_event/)
    assert.match(prompt, /禁止 projection rule 中出现 probability/)
  }
  const schema = JSON.parse(WORLD_MODEL_SCHEMA_TEXT)
  const mechanism = schema.species[0].biological_types[0].reproductive_mechanisms[0]
  assert.equal(mechanism.carrying_compatibility, null)
  assert.deepEqual(mechanism.world_model_rule_refs, [])
  assert.deepEqual(mechanism.evidence, [])
})

test('World Model analyzer preserves processRequest content and OpenAI message content', async () => {
  const response = JSON.stringify(modelFixture)
  for (const raw of [
    { content: response },
    { choices: [{ message: { content: response } }] },
    new Response(JSON.stringify({ content: response }), { status: 200, headers: { 'content-type': 'application/json' } }),
    responseLikeSse(`data: ${JSON.stringify({ content: response })}\ndata: [DONE]\n`),
  ]) {
    const analyzer = createAnalyzer({
      profileResolver: () => SILLYTAVERN_CURRENT_API,
      contextResolver: () => ({
        discoveryCall: false,
        chatCompletionSettings: { chat_completion_source: 'openai', model: 'test-model' },
        getChatCompletionModel: () => 'test-model',
        ChatCompletionService: {
          async processRequest() {
            return raw
          },
        },
      }),
    })
    const result = await analyzer.analyzeWorldModel({
      analysisInput: {
        character: { description: '潮汐生物型存在；潮汐生物明确存在双性个体。' },
      },
    })
    assert.equal(result.schema_version, 1)
    assert.equal(result.species[0]?.name, '潮汐生物')
    assert.ok(result.species[0]?.biological_types.length >= 1)
  }
})

test('World Model parser TRACE keeps the safe parser error code readable', async () => {
  const captured = await captureTraceLogs(async () => {
    const analyzer = createAnalyzer({
      profileResolver: () => SILLYTAVERN_CURRENT_API,
      contextResolver: () => ({
        chatCompletionSettings: { chat_completion_source: 'openai', model: 'test-model' },
        getChatCompletionModel: () => 'test-model',
        ChatCompletionService: {
          async processRequest() {
            return { content: 'not-json' }
          },
        },
      }),
    })
    await assert.rejects(
      analyzer.analyzeWorldModel({ analysisInput: { character: { description: '有分析输入。' } } }),
      error => error?.code === 'WORLD_MODEL_INVALID',
    )
  })
  const logText = JSON.stringify(captured.entries)
  assert.match(logText, /parser-error/)
  assert.match(logText, /"code":"WORLD_MODEL_INVALID"/)
})

test('World Model Patch v2 TRACE exposes validation path and stage without evidence text', async () => {
  const captured = await captureTraceLogs(async () => {
    const analyzer = createAnalyzer({
      profileResolver: () => SILLYTAVERN_CURRENT_API,
      contextResolver: () => ({
        chatCompletionSettings: { chat_completion_source: 'openai', model: 'test-model' },
        getChatCompletionModel: () => 'test-model',
        ChatCompletionService: {
          async processRequest() {
            return { content: supplementText({candidate: candidateText()}) }
          },
        },
      }),
    })
    await assert.rejects(
      analyzer.analyzeWorldModelPatchV2({
        analysisInput: { world_model: v2ExistingModel(), character: { description: '无相关世界级分类证据。' } },
      }),
      error => error?.message === 'WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED',
    )
  })
  const logText = JSON.stringify(captured.entries)
  assert.match(logText, /world-model-supplement-text/)
  assert.match(logText, /WORLD_MODEL_PATCH_V2_INVALID/)
  assert.match(logText, /WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED/)
  assert.match(logText, /world_patch_v2_evidence_guard/)
  assert.match(logText, /operation\.type\.name/)
  assert.match(logText, /"operationIndex":0/)
  assert.match(logText, /"operationOp":\{"type":"string","length":8\}/)
  assert.match(logText, /"canonicalTargetPath":\{"type":"string","length":41\}/)
  assert.match(logText, /"validationStage":\{"type":"string","length":29\}/)
  assert.doesNotMatch(logText, /无相关世界级分类证据/u)
})

test('World Model Patch v2 reports unsupported descriptions at the exact operation path', () => {
  assert.throws(
    () => applyWorldModelPatchV2EvidenceGuard(
      {
        schema_version: 2,
        operations: [{
          op: 'SET_FIELD',
          target: { kind: 'species', species_name: 'Species-A' },
          path: ['description'],
          value: 'Synthesized unsupported description.',
        }],
      },
      v2ExistingModel(),
      { character: { description: 'Species-A is present.' } },
    ),
    error => error?.path === 'operation.description' &&
      error?.operation_index === 0 &&
      error?.operation_op === 'SET_FIELD' &&
      error?.canonical_target_path === 'species.Species-A.description' &&
      error?.rejected_semantic_field === 'operation.description' &&
      error?.validation_stage === 'world_patch_v2_evidence_guard',
  )
})

test('World Model parser keeps bisexual/intersex capabilities independently evidence-based', () => {
  const rawModel = structuredClone(modelFixture)
  rawModel.species[0].biological_types[0] = {
    ...rawModel.species[0].biological_types[0],
    name: '双性',
    description: '资料明确说明可产生精子，明确不能被受精，其余能力没有足够证据。',
    capabilities: {
      can_produce_sperm: true,
      can_produce_ova: null,
      can_be_fertilized: false,
      can_fertilize: null,
            can_cause_pregnancy: null,
      can_carry_pregnancy: null,
    },
  }

  const parsed = parseWorldModelResponse(JSON.stringify(rawModel))
  assert.equal(parsed.species[0].biological_types[0].name, '双性')
  assert.deepEqual(parsed.species[0].biological_types[0].capabilities, {
    can_produce_sperm: true,
    can_produce_ova: null,
    can_be_fertilized: false,
    can_fertilize: null,
            can_cause_pregnancy: null,
    can_carry_pregnancy: null,
  })
})

test('World Model analysis does not keep an unsupported fixed dual type', async () => {
  const response = structuredClone(modelFixture)
  response.species[0].biological_types.push({
    ...structuredClone(modelFixture.species[0].biological_types[0]),
    name: '双性类型',
  })
  response.species.push({
    name: '仅有未获证据的类型',
    description: null,
    biological_types: [
      {
        ...structuredClone(modelFixture.species[0].biological_types[0]),
        name: '双性类型',
      },
    ],
  })
  const analyzer = createAnalyzer({
    profileResolver: () => SILLYTAVERN_CURRENT_API,
    contextResolver: () => ({ generateRaw: () => JSON.stringify(response) }),
  })

  const result = await analyzer.analyzeWorldModel({
    analysisInput: {
      persona: { description: '用户自述为双性，但人物设定不参与 World Model。' },
      character: { description: '资料只出现男性和女性；潮汐生物存在潮汐生物型，但不确定双性。' },
    },
  })

  assert.deepEqual(
    result.species.map(species => species.name),
    ['潮汐生物'],
  )
  assert.deepEqual(
    result.species[0].biological_types.map(type => type.name),
    ['潮汐生物型'],
  )
})

test('World Model analysis keeps and canonicalizes a fixed dual type when source evidence is explicit', async () => {
  const response = structuredClone(modelFixture)
  response.species[0].biological_types.push({
    ...structuredClone(modelFixture.species[0].biological_types[0]),
    name: '双性类型',
  })
  const analyzer = createAnalyzer({
    profileResolver: () => SILLYTAVERN_CURRENT_API,
    contextResolver: () => ({ generateRaw: () => JSON.stringify(response) }),
  })

  const result = await analyzer.analyzeWorldModel({
    analysisInput: {
      character: { description: '潮汐生物型存在；潮汐生物明确存在双性个体。' },
    },
  })

  assert.deepEqual(
    result.species[0].biological_types.map(type => type.name),
    ['潮汐生物型', '双性'],
  )
})

test('World Model parser localizes common English human labels before saving', () => {
  const parsed = normalizeWorldModel({
    ...modelFixture,
    species: [
      {
        ...modelFixture.species[0],
        name: 'Homo sapiens',
        biological_types: [
          {
            ...modelFixture.species[0].biological_types[0],
            name: 'Human male type',
            description: 'Human male type',
            special_rules: ['Humans have a known rule.'],
          },
        ],
      },
    ],
    medical_context: {
      ...modelFixture.medical_context,
      evidence: 'Human childbirth evidence',
    },
    exceptions: ['Homo sapiens exception'],
    unknowns: ['Human cycle unknown'],
  })

  assert.equal(parsed.species[0].name, '人类')
  assert.equal(parsed.species[0].biological_types[0].name, '人类 男性 type')
  assert.equal(parsed.species[0].biological_types[0].description, '人类 男性 type')
  assert.equal(parsed.species[0].biological_types[0].special_rules[0], '人类 have a known rule.')
  assert.equal(parsed.medical_context.evidence, '人类 childbirth evidence')
  assert.equal(parsed.exceptions[0].statement, '人类 exception')
  assert.equal(parsed.unknowns[0], '人类 cycle unknown')
  assert.doesNotMatch(JSON.stringify(parsed), /\bHomo\s+sapiens\b|\bHumans?\b|\bmale\b|\bfemale\b/i)
})

test('World Model rule normalization separates unknown from known absence', () => {
  const parsed = normalizeWorldModel({
    ...modelFixture,
    species: [
      {
        name: '雾核体',
        description: null,
        biological_types: [
          structuredFixtureType('甲型', null, {
            reproduction_rules: {
              fertilization: '无此机制',
              pregnancy_or_carrying: '不适用',
              cycle: '没有提到',
              ovulation: '无此功能',
              gestation: '资料不足',
              labor: null,
            },
            lifecycle: {
              maturation: '未提及',
              aging: '不存在该机制',
            },
          }),
        ],
      },
    ],
  })
  const type = parsed.species[0].biological_types[0]

  assert.deepEqual(type.reproduction_rules, {
    fertilization: '无',
    pregnancy_or_carrying: '无',
    cycle: null,
    ovulation: '无',
    gestation: null,
    labor: null,
  })
  assert.deepEqual(type.lifecycle, { maturation: null, aging: '无' })
})

test('World Model merges only explicit Human aliases and keeps conservative known values', () => {
  const parsed = normalizeWorldModel({
    ...modelFixture,
    species: [
      { name: '人类', description: null, biological_types: [structuredFixtureType('男性')] },
      {
        name: 'Human',
        description: null,
        biological_types: [
          structuredFixtureType('男性', null, {
            reproduction_rules: { cycle: '首个已知规则' },
          }),
        ],
      },
      {
        name: 'HUMAN',
        description: null,
        biological_types: [
          structuredFixtureType('男性', null, {
            reproduction_rules: { cycle: '冲突规则' },
          }),
        ],
      },
      { name: '人类 (Human)', description: null, biological_types: [structuredFixtureType('女性')] },
      { name: 'Human (人类)', description: null, biological_types: [] },
    ],
  })

  assert.equal(parsed.species.length, 1)
  assert.equal(parsed.species[0].name, '人类')
  assert.deepEqual(
    parsed.species[0].biological_types.map(type => type.name),
    ['男性', '女性'],
  )
  assert.equal(parsed.species[0].biological_types[0].reproduction_rules.cycle, '首个已知规则')
})

test('World Model applies Human baseline after alias canonicalization', async () => {
  const result = await analyzeDescription('Human 世界明确存在男性和女性。', [
    { name: 'HUMAN (人类)', biological_types: [structuredFixtureType('男性')] },
    { name: '人类 (Human)', biological_types: [structuredFixtureType('女性')] },
  ])
  const species = result.species[0]
  const male = species.biological_types.find(type => type.name === '男性')
  const female = species.biological_types.find(type => type.name === '女性')

  assert.deepEqual(
    result.species.map(item => item.name),
    ['人类'],
  )
  assert.deepEqual(
    species.biological_types.map(type => type.name),
    ['男性', '女性'],
  )
  assert.equal(male.reproduction_rules.cycle, '无')
  assert.equal(male.reproduction_rules.ovulation, '无')
  assert.equal(male.reproduction_rules.gestation, '无')
  assert.equal(male.reproduction_rules.labor, '无')
  assert.equal(female.reproduction_rules.cycle, '通常约28天一个周期。')
  assert.equal(female.reproduction_rules.ovulation, '通常每个周期排卵。')
  assert.equal(female.reproduction_rules.gestation, '通常约40周。')
  assert.equal(female.reproduction_rules.labor, '通过分娩完成生产。')
})

test('World Model exception normalization keeps canonical fields and uses normalized fallback order', () => {
  const parsed = normalizeWorldModel({
    ...modelFixture,
    exceptions: [
      '旧字符串例外',
      { description: '旧 description 例外', name: '不应覆盖 description' },
      { statement: 'canonical 例外', description: '不应覆盖 statement', name: '不应覆盖 name', applies_to: '角色乙', evidence: '来源乙' },
      { statement: '  ', description: 'description 回退例外', name: '不应覆盖 description' },
      { statement: null, description: '  ', name: 'name 回退例外', applies_to: '角色丙', evidence: '来源丙' },
    ],
  })

  assert.deepEqual(parsed.exceptions, [
    { statement: '旧字符串例外', applies_to: null, evidence: null },
    { statement: '旧 description 例外', applies_to: null, evidence: null },
    { statement: 'canonical 例外', applies_to: '角色乙', evidence: '来源乙' },
    { statement: 'description 回退例外', applies_to: null, evidence: null },
    { statement: 'name 回退例外', applies_to: '角色丙', evidence: '来源丙' },
  ])
  assert.ok(parsed.exceptions.every(item => Object.keys(item).sort().join(',') === 'applies_to,evidence,statement'))
})

test('World Model structural normalization removes species context from familiar type names', () => {
  const parsed = normalizeWorldModel({
    ...modelFixture,
    species: [
      {
        name: '镜生体',
        description: null,
        biological_types: [typeFixture('男性镜生体'), typeFixture('女性镜生体'), typeFixture('双性人类')],
      },
    ],
  })
  assert.deepEqual(
    parsed.species[0].biological_types.map(type => type.name),
    ['男性', '女性', '双性'],
  )
})

test('World Model rejects the old flat biological_types contract without guessing a species', () => {
  const legacy = {
    schema_version: 1,
    biological_types: structuredClone(modelFixture.species[0].biological_types),
    medical_context: modelFixture.medical_context,
    exceptions: [],
    unknowns: [],
  }
  assert.throws(
    () => normalizeWorldModel(legacy),
    error => error?.code === 'WORLD_MODEL_INVALID',
  )
  assert.throws(
    () => parseWorldModelResponse(JSON.stringify(legacy)),
    error => error?.code === 'WORLD_MODEL_INVALID',
  )
})

test('World Model keeps species and biological type recognition separate and supports open type names', () => {
  const raw = {
    schema_version: 1,
    species: [
      {
        name: '人类',
        description: '资料明确出现人类常规类型和双性类型。',
        biological_types: [
          { ...structuredClone(modelFixture.species[0].biological_types[0]), name: '男性' },
          { ...structuredClone(modelFixture.species[0].biological_types[0]), name: '女性' },
          { ...structuredClone(modelFixture.species[0].biological_types[0]), name: '双性' },
        ],
      },
      { name: '仅识别出的物种', description: '资料只识别出物种，没有具体类型。', biological_types: [] },
      {
        name: '镜生体',
        description: '明确的原创物种，性别基本为男性，极少数为女性。',
        biological_types: [
          { ...structuredClone(modelFixture.species[0].biological_types[0]), name: '男性', capabilities: {} },
          { ...structuredClone(modelFixture.species[0].biological_types[0]), name: '女性', capabilities: {} },
        ],
      },
      {
        name: '人类 ABO',
        description: null,
        biological_types: [
          { ...structuredClone(modelFixture.species[0].biological_types[0]), name: 'Alpha', capabilities: {} },
          { ...structuredClone(modelFixture.species[0].biological_types[0]), name: 'Beta', capabilities: {} },
          { ...structuredClone(modelFixture.species[0].biological_types[0]), name: 'Omega', capabilities: {} },
        ],
      },
    ],
    medical_context: null,
    exceptions: [],
    unknowns: [],
  }
  const parsed = parseWorldModelResponse(JSON.stringify(raw))
  assert.deepEqual(
    parsed.species[0].biological_types.map(type => type.name),
    ['男性', '女性', '双性'],
  )
  assert.deepEqual(parsed.species[1].biological_types, [])
  assert.deepEqual(
    parsed.species[2].biological_types.map(type => type.name),
    ['男性', '女性'],
  )
  assert.deepEqual(
    parsed.species[3].biological_types.map(type => type.name),
    ['Alpha', 'Beta', 'Omega'],
  )
  assert.deepEqual(parsed.species[3].biological_types[0].capabilities, {
    can_produce_sperm: null,
    can_produce_ova: null,
    can_be_fertilized: null,
    can_fertilize: null,
            can_cause_pregnancy: null,
    can_carry_pregnancy: null,
  })
})

test('World Model analysis keeps only the familiar types supported by male-only evidence', async () => {
  const result = await analyzeDescription('普通人类资料明确说明角色为男性。', [
    {
      name: '人类',
      biological_types: [typeFixture('男性'), typeFixture('女性'), typeFixture('双性')],
    },
  ])
  assert.deepEqual(
    result.species[0].biological_types.map(type => type.name),
    ['男性'],
  )
})

test('World Model analysis keeps male and female when both are explicitly evidenced', async () => {
  const result = await analyzeDescription('普通人类世界规则明确记载男性和女性都存在。', [
    {
      name: '人类',
      biological_types: [typeFixture('男性'), typeFixture('女性'), typeFixture('双性')],
    },
  ])
  assert.deepEqual(
    result.species[0].biological_types.map(type => type.name),
    ['男性', '女性'],
  )
})

test('World Model analysis recognizes ordinary sex wording and rejects negated or uncertain labels', async () => {
  const result = await analyzeDescription('普通人类角色性别为男；普通人类另一角色性别为女。', [
    {
      name: '人类',
      biological_types: [typeFixture('男性'), typeFixture('女性'), typeFixture('双性')],
    },
  ])
  assert.deepEqual(
    result.species[0].biological_types.map(type => type.name),
    ['男性', '女性'],
  )

  const noEvidence = await analyzeDescription('普通人类资料不存在男性和女性；其性别不确定。', [
    {
      name: '人类',
      biological_types: [typeFixture('男性'), typeFixture('女性'), typeFixture('双性')],
    },
  ])
  assert.deepEqual(noEvidence.species[0].biological_types, [])
})

test('World Model analysis does not treat a temporary conversion as fixed dual evidence', async () => {
  const result = await analyzeDescription('普通人类角色原本为男性；角色可以转为双性，持续时间只有三天。', [
    {
      name: '人类',
      biological_types: [typeFixture('男性'), typeFixture('双性')],
    },
  ])
  assert.deepEqual(
    result.species[0].biological_types.map(type => type.name),
    ['男性'],
  )
})

test('World Model analysis keeps fixed dual evidence when its mechanisms remain unknown', async () => {
  const result = await analyzeDescription('普通人类世界明确存在双性个体，但其具体生育能力可能未知。', [
    { name: '人类', biological_types: [typeFixture('双性')] },
  ])
  assert.deepEqual(
    result.species[0].biological_types.map(type => type.name),
    ['双性'],
  )
})

test('World Model analysis rejects uncertain dual existence', async () => {
  const result = await analyzeDescription('普通人类资料可能有双性个体，但没有确认。', [{ name: '人类', biological_types: [typeFixture('双性')] }])
  assert.deepEqual(result.species[0].biological_types, [])
})

test('World Model analysis removes temporary dualization from types and unknowns but keeps the rule', async () => {
  const result = await analyzeDescription(
    '普通人类角色原本是男性，金丹可以双性化，持续一至三天。',
    [
      {
        name: '人类',
        biological_types: [typeFixture('男性', { special_rules: ['金丹可以双性化，持续一至三天。'] }), typeFixture('双性')],
      },
    ],
    ['双性化持续时间未知', '双性个体的能力未知'],
  )
  assert.deepEqual(
    result.species[0].biological_types.map(type => type.name),
    ['男性'],
  )
  assert.deepEqual(result.species[0].biological_types[0].special_rules, ['金丹可以双性化，持续一至三天。'])
  assert.deepEqual(result.unknowns, ['双性化持续时间未知'])
})

test('World Model analysis removes individual ambiguity and observed non-biological aliases', async () => {
  const result = await analyzeDescription('普通人类某人物性别模糊；镜生体性别基本为男性，极少数镜生体为女性。', [
    { name: '人类', biological_types: [typeFixture('性别模糊')] },
    { name: '晶巢种', biological_types: [typeFixture('晶巢种族'), typeFixture('晶巢种分支')] },
    { name: '绒核族', biological_types: [typeFixture('绒核族身份')] },
    {
      name: '镜生体',
      biological_types: [typeFixture('男性镜生体'), typeFixture('女性镜生体'), typeFixture('晶巢镜生体'), typeFixture('绒核镜生体')],
    },
  ])
  assert.deepEqual(
    result.species.map(species => species.name),
    ['人类', '镜生体'],
  )
  assert.deepEqual(result.species.find(species => species.name === '人类').biological_types, [])
  assert.deepEqual(
    result.species.find(species => species.name === '镜生体').biological_types.map(type => type.name),
    ['男性', '女性'],
  )
})

test('World Model analysis preserves open ABO names without inventing sex combinations', async () => {
  const result = await analyzeDescription('普通人类世界规则明确存在 Alpha、Beta、Omega 三类生殖分类。', [
    {
      name: '人类',
      biological_types: [
        typeFixture('Alpha', { capabilities: {} }),
        typeFixture('Beta', { capabilities: {} }),
        typeFixture('Omega', { capabilities: {} }),
      ],
    },
  ])
  assert.deepEqual(
    result.species[0].biological_types.map(type => type.name),
    ['Alpha', 'Beta', 'Omega'],
  )
  assert.equal(
    result.species[0].biological_types.some(type => ['男性', '女性', '双性'].includes(type.name)),
    false,
  )
  assert.ok(result.species[0].biological_types.every(type => Object.values(type.capabilities).every(value => value === null)))
})

test('World Model analysis keeps non-human female mechanisms unknown when raw fields are null', async () => {
  const result = await analyzeDescription('资料明确存在女性镜生体，但没有说明其生殖机制。', [
    {
      name: '镜生体',
      biological_types: [structuredFixtureType('女性')],
    },
  ])
  const type = result.species[0].biological_types[0]
  assert.equal(type.name, '女性')
  assert.deepEqual(type.capabilities, {
    can_produce_sperm: null,
    can_produce_ova: null,
    can_be_fertilized: null,
    can_fertilize: null,
            can_cause_pregnancy: null,
    can_carry_pregnancy: null,
  })
  assert.deepEqual(type.reproduction_rules, {
    fertilization: null,
    pregnancy_or_carrying: null,
    cycle: null,
    ovulation: null,
    gestation: null,
    labor: null,
  })
})

test('World Model analysis preserves schema-valid non-human capabilities without source re-filtering', async () => {
  const result = await analyzeDescription('晶巢种女性能够产生卵细胞，但不能承担妊娠。', [{ name: '晶巢种', biological_types: [typeFixture('女性')] }])
  assert.deepEqual(result.species[0].biological_types[0].capabilities, {
    can_produce_sperm: true,
    can_produce_ova: null,
    can_be_fertilized: false,
    can_fertilize: true,
            can_cause_pregnancy: null,
    can_carry_pregnancy: null,
  })
})

test('World Model analysis does not leak human sex evidence into non-human species', async () => {
  const result = await analyzeInput(
    {
      character: {
        description: '人类资料明确出现男性和女性。晶巢种：只确认存在这个物种，未说明性别分类。绒核族：只确认存在这个物种，未说明性别分类。',
      },
    },
    [
      { name: '人类', biological_types: [typeFixture('男性'), typeFixture('女性'), typeFixture('Alpha')] },
      { name: '晶巢种', biological_types: [typeFixture('男性'), typeFixture('女性')] },
      { name: '绒核族', biological_types: [typeFixture('男性'), typeFixture('女性')] },
    ],
    ['晶巢种男性的具体机制未知', '晶巢种的生殖机制未知'],
  )

  assert.deepEqual(
    result.species[0].biological_types.map(type => type.name),
    ['男性', '女性'],
  )
  assert.deepEqual(
    result.species.slice(1).map(species => species.biological_types),
    [[], []],
  )
  assert.deepEqual(result.unknowns, ['晶巢种的生殖机制未知'])
})

test('World Model analysis keeps an arbitrary fantasy species empty without type evidence', async () => {
  const result = await analyzeDescription('资料明确存在星尘生物这一生命种类，但没有说明其性别或生殖分类。', [
    { name: '星尘生物', biological_types: [typeFixture('男性'), typeFixture('女性')] },
  ])

  assert.deepEqual(result.species[0].biological_types, [])
})

test('World Model keeps every evidenced species when type details and mechanisms are unknown', async () => {
  const result = await analyzeInput(
    {
      character: {
        description: '资料明确证明甲类、乙类和丙类三个 species 存在；乙类的详细 reproduction mechanism 未知。',
      },
    },
    [
      { name: '甲类', biological_types: [] },
      { name: '乙类', biological_types: [] },
      { name: '丙类', biological_types: [] },
    ],
    ['乙类的详细 reproduction mechanism 未知'],
  )

  assert.deepEqual(result.species.map(species => species.name), ['甲类', '乙类', '丙类'])
  assert.ok(result.species.every(species => species.biological_types.length === 0))
  assert.deepEqual(result.unknowns, ['乙类的详细 reproduction mechanism 未知'])
})

test('World Model analysis preserves generic raw fields after type-only retention', async () => {
  const rawType = structuredFixtureType('Type-X', 'AI 改写后的类型摘要。', {
    capabilities: {
      can_produce_sperm: true,
      can_produce_ova: true,
      can_be_fertilized: true,
      can_fertilize: true,
            can_cause_pregnancy: null,
      can_carry_pregnancy: true,
    },
    reproduction_rules: {
      fertilization: 'AI 改写后的配子结合机制。',
      pregnancy_or_carrying: 'AI 改写后的孕育总结。',
      cycle: 'AI 改写后的周期总结。',
      ovulation: 'AI 改写后的排卵总结。',
      gestation: 'AI 改写后的妊娠总结。',
      labor: 'AI 改写后的分娩总结。',
    },
    lifecycle: {
      maturation: 'AI 改写后的成熟总结。',
      aging: 'AI 改写后的衰老总结。',
    },
    special_rules: ['AI 改写后的特殊规则。'],
  })
  const result = await analyzeDescription('Type-X 是一种通用生物类型。', [
    {
      name: 'Species-A',
      description: 'Species-A 的通用描述。',
      biological_types: [rawType],
    },
  ])

  assert.deepEqual(
    result.species.map(species => species.name),
    ['Species-A'],
  )
  assert.deepEqual(result.species[0].biological_types[0], rawType)
})

test('World Model analysis preserves raw fields for custom types under human species', async () => {
  const rawType = structuredFixtureType('自定义类型', 'AI 改写后的类型摘要。', {
    capabilities: {
      can_produce_sperm: true,
      can_produce_ova: true,
      can_be_fertilized: true,
      can_fertilize: true,
            can_cause_pregnancy: null,
      can_carry_pregnancy: true,
    },
    reproduction_rules: {
      fertilization: 'AI 改写后的配子结合机制。',
      pregnancy_or_carrying: 'AI 改写后的孕育总结。',
      cycle: 'AI 改写后的周期总结。',
      ovulation: 'AI 改写后的排卵总结。',
      gestation: 'AI 改写后的妊娠总结。',
      labor: 'AI 改写后的分娩总结。',
    },
    lifecycle: {
      maturation: 'AI 改写后的成熟总结。',
      aging: 'AI 改写后的衰老总结。',
    },
    special_rules: ['AI 改写后的特殊规则。'],
  })
  const result = await analyzeDescription('人类资料明确存在自定义类型。', [
    {
      name: '人类',
      biological_types: [rawType],
    },
  ])

  assert.deepEqual(result.species[0].biological_types[0], rawType)
})

test('World Model analysis preserves generic null and empty raw fields', async () => {
  const result = await analyzeDescription('Type-Y 是一种通用生物类型。', [
    {
      name: 'Species-B',
      biological_types: [structuredFixtureType('Type-Y')],
    },
  ])

  assert.deepEqual(result.species[0].biological_types[0].capabilities, {
    can_produce_sperm: null,
    can_produce_ova: null,
    can_be_fertilized: null,
    can_fertilize: null,
            can_cause_pregnancy: null,
    can_carry_pregnancy: null,
  })
  assert.deepEqual(result.species[0].biological_types[0].reproduction_rules, {
    fertilization: null,
    pregnancy_or_carrying: null,
    cycle: null,
    ovulation: null,
    gestation: null,
    labor: null,
  })
  assert.deepEqual(result.species[0].biological_types[0].lifecycle, { maturation: null, aging: null })
  assert.deepEqual(result.species[0].biological_types[0].special_rules, [])
})

test('World Model analysis retains arbitrary species from direct subtree evidence', async () => {
  const cases = [
    {
      name: 'Species-A',
      input: 'Type-X 作为一种生物类型被明确记录。',
      type: structuredFixtureType('Type-X', null),
    },
    {
      name: 'Species-B',
      input: '一种可被直接引用的类型说明文本。',
      type: structuredFixtureType('Type-Y', '一种可被直接引用的类型说明文本。'),
    },
    {
      name: 'Species-C',
      input: 'Type-Z 能够产生精子。',
      type: structuredFixtureType('Type-Z', null, { capabilities: { can_produce_sperm: true } }),
    },
    {
      name: 'Species-D',
      input: '通过配子结合完成受精。',
      type: structuredFixtureType('Type-R', null, {
        reproduction_rules: { fertilization: '通过配子结合完成受精。' },
      }),
    },
    {
      name: 'Species-E',
      input: '该生物达到成熟后进入下一阶段。',
      type: structuredFixtureType('Type-L', null, {
        lifecycle: { maturation: '该生物达到成熟后进入下一阶段。' },
      }),
    },
    {
      name: 'Species-F',
      input: '该生物在月光下会改变生殖能力。',
      type: structuredFixtureType('Type-S', null, {
        special_rules: ['该生物在月光下会改变生殖能力。'],
      }),
    },
    {
      name: 'Species-G',
      speciesDescription: '一种明确记录的物种描述文本。',
      input: '一种明确记录的物种描述文本。',
      type: structuredFixtureType('Type-G', null),
    },
  ]

  for (const item of cases) {
    const result = await analyzeDescription(item.input, [
      {
        name: item.name,
        description: item.speciesDescription ?? null,
        biological_types: [item.type],
      },
    ])
    assert.deepEqual(
      result.species.map(species => species.name),
      [item.name],
      item.name,
    )
  }
})

test('World Model analysis keeps a generic species but filters an unsupported type', async () => {
  const result = await analyzeDescription('Species-A 明确存在 Type-X。', [
    {
      name: 'Species-A',
      biological_types: [structuredFixtureType('Type-X', null), structuredFixtureType('Type-Y', null)],
    },
  ])

  assert.deepEqual(
    result.species.map(species => species.name),
    ['Species-A'],
  )
  assert.deepEqual(
    result.species[0].biological_types.map(type => type.name),
    ['Type-X'],
  )
})

test('World Model analysis filters a generic species when only schema keys are present', async () => {
  const result = await analyzeDescription('species biological_types capabilities reproduction_rules lifecycle special_rules', [
    {
      name: 'Species-A',
      description: 'Species-A 的描述不在输入中。',
      biological_types: [
        structuredFixtureType('Type-Y', 'Type-Y 的描述不在输入中。', {
          capabilities: { can_produce_sperm: true },
          reproduction_rules: { fertilization: '该类型的受精规则不在输入中。' },
          lifecycle: { maturation: '该类型的成熟规则不在输入中。' },
          special_rules: ['该类型的特殊规则不在输入中。'],
        }),
      ],
    },
  ])

  assert.deepEqual(result.species, [])
})

test('World Model analysis does not use an unscoped special rule as species evidence', async () => {
  const result = await analyzeDescription('资料中只提到“特殊规则”四个字。', [
    {
      name: 'Species-A',
      biological_types: [
        structuredFixtureType('Type-X', null, {
          special_rules: ['特殊规则：月光下会改变生殖能力。'],
        }),
      ],
    },
  ])

  assert.deepEqual(result.species, [])
})

test('World Model analysis keeps arbitrary Alpha Beta Omega types under a generic species', async () => {
  const result = await analyzeDescription('Species-A 明确存在 Alpha、Beta、Omega 三种生物类型。', [
    {
      name: 'Species-A',
      biological_types: [structuredFixtureType('Alpha', null), structuredFixtureType('Beta', null), structuredFixtureType('Omega', null)],
    },
  ])

  assert.deepEqual(
    result.species[0].biological_types.map(type => type.name),
    ['Alpha', 'Beta', 'Omega'],
  )
})

test('World Model pipeline retains a type when species and type evidence are separate units', async () => {
  const result = await analyzeInput(
    {
      character: { description: 'Species-A 已被记录为一个生物种群。\nType-X 的类型描述已在资料中明确记录。' },
    },
    [
      {
        name: 'Species-A',
        biological_types: [
          structuredFixtureType('Type-X', 'Type-X 的类型描述已在资料中明确记录。', {
            capabilities: { can_produce_sperm: true },
          }),
        ],
      },
    ],
  )

  assert.deepEqual(
    result.species.map(species => species.name),
    ['Species-A'],
  )
  assert.deepEqual(
    result.species[0].biological_types.map(type => type.name),
    ['Type-X'],
  )
  assert.equal(result.species[0].biological_types[0].capabilities.can_produce_sperm, true)
})

test('World Model pipeline retains a type from a directly evidenced reproduction rule without its name', async () => {
  const fertilizationRule = '通过配子结合完成受精。'
  const result = await analyzeInput(
    {
      character: { description: 'Species-A 被明确记录为物种。\n资料记载受精方式为通过配子结合完成受精。' },
    },
    [
      {
        name: 'Species-A',
        biological_types: [
          structuredFixtureType('Type-X', null, {
            reproduction_rules: { fertilization: fertilizationRule },
          }),
        ],
      },
    ],
  )

  assert.deepEqual(
    result.species[0].biological_types.map(type => type.name),
    ['Type-X'],
  )
  assert.equal(result.species[0].biological_types[0].reproduction_rules.fertilization, fertilizationRule)
})

test('World Model pipeline keeps nameless type field evidence isolated across siblings', async () => {
  const fertilizationRule = '通过配子结合完成受精。'
  const maturationRule = '该生物达到成熟后进入下一阶段。'
  const specialRule = '该生物在月光下会改变生殖能力。'
  const description = '该生物类型能够产生精子。'
  const result = await analyzeInput(
    {
      character: {
        description: ['Species-A 已被记录为物种。', fertilizationRule, maturationRule, specialRule, description].join('\n'),
      },
    },
    [
      {
        name: 'Species-A',
        biological_types: [
          structuredFixtureType('Type-X', null, {
            reproduction_rules: { fertilization: fertilizationRule },
          }),
          structuredFixtureType('Type-Y', null, {
            lifecycle: { maturation: maturationRule },
          }),
          structuredFixtureType('Type-Z', null, {
            special_rules: [specialRule],
          }),
          structuredFixtureType('Type-W', description, {
            capabilities: { can_produce_sperm: true },
          }),
        ],
      },
    ],
  )

  const [typeX, typeY, typeZ, typeW] = result.species[0].biological_types
  assert.deepEqual(
    result.species[0].biological_types.map(type => type.name),
    ['Type-X', 'Type-Y', 'Type-Z', 'Type-W'],
  )
  assert.equal(typeX.reproduction_rules.fertilization, fertilizationRule)
  assert.equal(typeX.lifecycle.maturation, null)
  assert.deepEqual(typeX.special_rules, [])
  assert.equal(typeY.reproduction_rules.fertilization, null)
  assert.equal(typeY.lifecycle.maturation, maturationRule)
  assert.deepEqual(typeY.special_rules, [])
  assert.equal(typeZ.reproduction_rules.fertilization, null)
  assert.equal(typeZ.lifecycle.maturation, null)
  assert.deepEqual(typeZ.special_rules, [specialRule])
  assert.equal(typeW.capabilities.can_produce_sperm, true)
  assert.equal(typeW.reproduction_rules.fertilization, null)
  assert.equal(typeW.lifecycle.maturation, null)
  assert.deepEqual(typeW.special_rules, [])
})

test('World Model pipeline preserves each retained type raw field despite sibling evidence', async () => {
  const fertilizationRule = '通过配子结合完成受精。'
  const result = await analyzeInput(
    {
      character: {
        description: `Species-A 已被记录为物种。Type-Y ${fertilizationRule}`,
      },
    },
    [
      {
        name: 'Species-A',
        biological_types: [
          structuredFixtureType('Type-X', null, {
            reproduction_rules: { fertilization: fertilizationRule },
          }),
          structuredFixtureType('Type-Y', null, {
            reproduction_rules: { fertilization: fertilizationRule },
          }),
        ],
      },
    ],
  )

  const [typeX, typeY] = result.species[0].biological_types
  assert.equal(typeX.reproduction_rules.fertilization, fertilizationRule)
  assert.equal(typeY.reproduction_rules.fertilization, fertilizationRule)
})

test('World Model pipeline keeps the species while filtering a type with no subtree evidence', async () => {
  const result = await analyzeInput(
    {
      character: { description: 'Species-A 明确存在 Type-X。' },
    },
    [
      {
        name: 'Species-A',
        biological_types: [structuredFixtureType('Type-X', null), structuredFixtureType('Type-Y', null)],
      },
    ],
  )

  assert.deepEqual(
    result.species.map(species => species.name),
    ['Species-A'],
  )
  assert.deepEqual(
    result.species[0].biological_types.map(type => type.name),
    ['Type-X'],
  )
})

test('World Model pipeline keeps only Type-X when Type-Y has no subtree evidence', async () => {
  const result = await analyzeInput(
    {
      character: { description: 'Species-A 已被记录。\nType-X 的类型说明已被记录。' },
    },
    [
      {
        name: 'Species-A',
        biological_types: [structuredFixtureType('Type-X', 'Type-X 的类型说明已被记录。'), structuredFixtureType('Type-Y', null)],
      },
    ],
  )

  assert.deepEqual(
    result.species[0].biological_types.map(type => type.name),
    ['Type-X'],
  )
})

test('World Model pipeline retains open Alpha Beta Omega names without male or female matching', async () => {
  const result = await analyzeInput(
    {
      character: { description: 'Species-A 已被记录。\nAlpha 是一种生殖分类。\nBeta 是一种生殖分类。\nOmega 是一种生殖分类。' },
    },
    [
      {
        name: 'Species-A',
        biological_types: [
          structuredFixtureType('Alpha', 'Alpha 是一种生殖分类。'),
          structuredFixtureType('Beta', 'Beta 是一种生殖分类。'),
          structuredFixtureType('Omega', 'Omega 是一种生殖分类。'),
        ],
      },
    ],
  )

  assert.deepEqual(
    result.species[0].biological_types.map(type => type.name),
    ['Alpha', 'Beta', 'Omega'],
  )
  assert.equal(
    result.species[0].biological_types.some(type => ['男性', '女性'].includes(type.name)),
    false,
  )
})

test('World Model pipeline retains human male and female types without human species wording', async () => {
  const evidence = '角色甲的性别是男性，能够产生精子并使卵细胞受精。角色乙的性别是女性，可以怀孕并通过分娩完成生产。'
  const result = await analyzeInput(
    {
      character: { description: evidence },
    },
    [
      {
        name: '人类',
        biological_types: [typeFixture('男性'), typeFixture('女性')],
      },
    ],
  )

  assert.doesNotMatch(evidence, /人类/)
  assert.deepEqual(
    result.species[0].biological_types.map(type => type.name),
    ['男性', '女性'],
  )
})

test('World Model analysis preserves arbitrary non-human male and female capabilities', async () => {
  const result = await analyzeDescription('星海生物明确存在男性和女性，但资料没有说明其生殖能力。', [
    {
      name: '星海生物',
      biological_types: [
        typeFixture('男性', {
          capabilities: {
            can_produce_sperm: true,
            can_produce_ova: true,
            can_be_fertilized: true,
            can_fertilize: true,
            can_cause_pregnancy: null,
            can_carry_pregnancy: true,
          },
        }),
        typeFixture('女性', {
          capabilities: {
            can_produce_sperm: true,
            can_produce_ova: true,
            can_be_fertilized: true,
            can_fertilize: true,
            can_cause_pregnancy: null,
            can_carry_pregnancy: true,
          },
        }),
      ],
    },
  ])

  assert.deepEqual(
    result.species[0].biological_types.map(type => type.capabilities),
    [
      {
        can_produce_sperm: true,
        can_produce_ova: true,
        can_be_fertilized: true,
        can_fertilize: true,
            can_cause_pregnancy: null,
        can_carry_pregnancy: true,
      },
      {
        can_produce_sperm: true,
        can_produce_ova: true,
        can_be_fertilized: true,
        can_fertilize: true,
            can_cause_pregnancy: null,
        can_carry_pregnancy: true,
      },
    ],
  )
})

test('World Model keeps non-human unknown rules null but canonicalizes explicit absence to 无', async () => {
  const result = await analyzeDescription('雾核体的甲型明确不存在受精机制、排卵机制和妊娠机制；周期资料没有说明。', [
    {
      name: '雾核体',
      biological_types: [
        structuredFixtureType('甲型', null, {
          reproduction_rules: {
            fertilization: '无此机制',
            ovulation: '不具备该机制',
            gestation: '不适用',
            cycle: '没有对应资料',
          },
        }),
      ],
    },
  ])
  const rules = result.species[0].biological_types[0].reproduction_rules

  assert.equal(rules.fertilization, '无')
  assert.equal(rules.ovulation, '无')
  assert.equal(rules.gestation, '无')
  assert.equal(rules.cycle, null)
  assert.equal(result.species[0].biological_types[0].capabilities.can_produce_ova, null)
})

test('World Model analysis rejects exact and generic-suffix parent type duplicates', async () => {
  const result = await analyzeDescription('资料明确存在雾生体这一生命种类。', [
    {
      name: '雾生体',
      biological_types: [typeFixture('雾生体'), typeFixture('雾生体族'), typeFixture('人')],
    },
  ])

  assert.deepEqual(result.species[0].biological_types, [])
})

test('World Model analysis keeps prompt-supplied unknown fertilization for interaction-only text', async () => {
  const result = await analyzeDescription('星海生物男性会性交、双修和补灵，但没有描述受精机制。', [
    {
      name: '星海生物',
      biological_types: [
        typeFixture('男性', {
          capabilities: {
            can_be_fertilized: false,
            can_fertilize: false,
            can_cause_pregnancy: null,
          },
          reproduction_rules: { fertilization: null },
        }),
      ],
    },
  ])

  assert.equal(result.species[0].biological_types[0].reproduction_rules.fertilization, null)
})

test('World Model preserves unfamiliar fertilization prose without a keyword admission gate', async () => {
  const firstRule = '两类配子在专门器官内融合并形成新个体。'
  const secondRule = '遗传材料在专门部位完成结合，随后形成新的生命个体。'
  const result = await analyzeDescription(
    '弧晶体的甲相和穗核型都是稳定的生殖分类；甲相的机制是两类配子在专门器官内融合并形成新个体；穗核型的机制是遗传材料在专门部位完成结合，随后形成新的生命个体。',
    [
      {
        name: '弧晶体',
        biological_types: [
          structuredFixtureType('甲相', null, { reproduction_rules: { fertilization: firstRule } }),
          structuredFixtureType('穗核型', null, { reproduction_rules: { fertilization: secondRule } }),
        ],
      },
    ],
  )

  const types = result.species[0].biological_types
  assert.deepEqual(
    types.map(type => type.name),
    ['甲相', '穗核型'],
  )
  assert.equal(types[0].reproduction_rules.fertilization, firstRule)
  assert.equal(types[1].reproduction_rules.fertilization, secondRule)
})

test('World Model keeps interaction-only fertilization unknown when the AI follows the prompt contract', async () => {
  const result = await analyzeDescription('弧晶体的甲相只通过液体交换激活能量循环，资料没有受精机制。', [
    {
      name: '弧晶体',
      biological_types: [
        structuredFixtureType('甲相', null, {
          reproduction_rules: { fertilization: null },
        }),
      ],
    },
  ])

  assert.equal(result.species[0].biological_types[0].reproduction_rules.fertilization, null)
})

test('World Model analysis preserves a directly evidenced rule when capability is unknown', async () => {
  const result = await analyzeDescription('星海生物男性的受精机制是体内配子结合，但具体能力细节未知。', [
    {
      name: '星海生物',
      biological_types: [
        typeFixture('男性', {
          capabilities: {
            can_produce_sperm: null,
            can_produce_ova: null,
            can_be_fertilized: null,
            can_fertilize: null,
            can_cause_pregnancy: null,
            can_carry_pregnancy: null,
          },
          reproduction_rules: { fertilization: '体内配子结合。' },
        }),
      ],
    },
  ])

  const type = result.species[0].biological_types[0]
  assert.equal(type.capabilities.can_fertilize, null)
  assert.equal(type.reproduction_rules.fertilization, '体内配子结合。')
})

test('World Model preserves a source-grounded unfamiliar biological type', async () => {
  const result = await analyzeDescription('弧晶体内部稳定存在穗核型这一生殖生理分类；该分类直接影响身体机制。', [
    {
      name: '弧晶体',
      biological_types: [structuredFixtureType('穗核型')],
    },
  ])

  assert.deepEqual(
    result.species[0].biological_types.map(type => type.name),
    ['穗核型'],
  )
})

test('World Model rejects an unfamiliar type without reliable source binding', async () => {
  const result = await analyzeDescription('弧晶体存在一种稳定生殖分类，但资料没有记录该分类的名称或 type-local 规则。', [
    {
      name: '弧晶体',
      biological_types: [
        {
          ...structuredFixtureType('穗核型'),
          description: '穗核型是弧晶体内稳定存在的生殖分类。',
        },
      ],
    },
  ])

  assert.deepEqual(result.species[0].biological_types, [])
})

test('World Model trace exposes raw and canonical models without request secrets', async () => {
  const rule = '两类配子在专门器官内融合并形成新个体。'
  const response = worldResponse([
    {
      name: '弧晶体',
      biological_types: [
        structuredFixtureType('甲相', null, {
          reproduction_rules: { fertilization: rule },
        }),
      ],
    },
  ])
  let trace = null
  const analyzer = createAnalyzer({
    profileResolver: () => SILLYTAVERN_CURRENT_API,
    contextResolver: () => ({
      api_key: 'should-not-enter-trace',
      generateRaw: () => JSON.stringify(response),
    }),
    onWorldModelTrace: value => {
      trace = value
    },
  })

  const result = await analyzer.analyzeWorldModel({
    analysisInput: {
      character: { description: '弧晶体的甲相是稳定生殖分类，机制描述已明确。' },
    },
  })

  assert.ok(trace)
  assert.match(trace.raw_output, /两类配子在专门器官内融合并形成新个体/)
  assert.equal(trace.normalized_model.species[0].biological_types[0].reproduction_rules.fertilization, rule)
  assert.equal(trace.canonical_model.species[0].biological_types[0].reproduction_rules.fertilization, rule)
  assert.equal(result.species[0].biological_types[0].reproduction_rules.fertilization, rule)
  assert.equal(Object.hasOwn(result, 'raw_output'), false)
  assert.equal(Object.hasOwn(result, 'canonical_model'), false)
  assert.doesNotMatch(JSON.stringify(trace), /should-not-enter-trace|api_key|secret_ref|authorization/iu)
})

test('World Model analysis keeps arbitrary species sex types from deterministic semantic evidence', async () => {
  const result = await analyzeDescription('镜生体性别基本都为男性，极少数镜生体为女性。', [
    { name: '镜生体', biological_types: [structuredFixtureType('男性'), structuredFixtureType('女性')] },
  ])

  assert.deepEqual(
    result.species[0].biological_types.map(type => type.name),
    ['男性', '女性'],
  )
  assert.ok(result.species[0].biological_types.every(type => Object.values(type.capabilities).every(value => value === null)))
})

test('World Model analysis does not treat unrelated partners or individual labels as species types', async () => {
  const result = await analyzeDescription('晶巢种会与男人交配，也会与人类女性性交；某个镜生体角色是男性。', [
    { name: '晶巢种', biological_types: [typeFixture('女性')] },
    { name: '镜生体', biological_types: [typeFixture('男性')] },
  ])
  assert.deepEqual(
    result.species.map(species => species.biological_types),
    [[], []],
  )
})

test('World Model analysis preserves generic fields while applying final contradictions', async () => {
  const result = await analyzeDescription('晶巢种男性会产生精液；晶巢种男性存在发情期；晶巢种男性寿命通常为六百年。', [
    {
      name: '晶巢种',
      biological_types: [
        typeFixture('男性', {
          capabilities: {
            can_produce_sperm: true,
            can_produce_ova: false,
            can_be_fertilized: false,
            can_fertilize: true,
            can_cause_pregnancy: null,
            can_carry_pregnancy: false,
          },
          reproduction_rules: {
            fertilization: '按人类方式受精。',
            pregnancy_or_carrying: '可以妊娠。',
            cycle: '存在发情期。',
            ovulation: '会排卵。',
            gestation: '妊娠六个月。',
            labor: '按人类方式分娩。',
          },
          lifecycle: { maturation: '达到成年后成熟。', aging: '寿命通常为六百年。' },
          special_rules: ['晶巢种男性存在发情期。', '成结用于提高受精成功率。'],
        }),
      ],
    },
  ])
  const type = result.species[0].biological_types[0]

  assert.deepEqual(type.capabilities, {
    can_produce_sperm: true,
    can_produce_ova: false,
    can_be_fertilized: false,
    can_fertilize: true,
            can_cause_pregnancy: null,
    can_carry_pregnancy: false,
  })
  assert.deepEqual(type.reproduction_rules, {
    fertilization: '按人类方式受精。',
    pregnancy_or_carrying: '无',
    cycle: '存在发情期。',
    ovulation: '无',
    gestation: '无',
    labor: '无',
  })
  assert.deepEqual(type.lifecycle, { maturation: '达到成年后成熟。', aging: '寿命通常为六百年。' })
  assert.deepEqual(type.special_rules, ['晶巢种男性存在发情期。', '成结用于提高受精成功率。'])
})

test('World Model analysis keeps generic type-local fields across separate parent and type units', async () => {
  const result = await analyzeInput(
    {
      character: {
        description: [
          'Species-A 已被记录为一个物种。',
          'Type-X 是一种生殖分类。',
          'Type-X 能够产生精子。',
          'Type-X 的受精规则是通过配子结合完成受精。',
          'Type-X 达到成熟后进入下一阶段。',
          'Type-X 特殊规则：月光下会改变生殖能力。',
          'Type-Y 是另一种生殖分类。',
          'Type-Y 能够产生卵子。',
          'Type-Y 可以承担妊娠。',
          'Type-Y 的寿命通常为六百年。',
          'Type-Y 特殊规则：白昼会改变颜色。',
        ].join('\n'),
      },
    },
    [
      {
        name: 'Species-A',
        biological_types: [
          structuredFixtureType('Type-X', 'Type-X 是一种生殖分类。', {
            capabilities: {
              can_produce_sperm: true,
              can_produce_ova: true,
              can_be_fertilized: null,
              can_fertilize: null,
            can_cause_pregnancy: null,
              can_carry_pregnancy: null,
            },
            reproduction_rules: {
              fertilization: 'Type-X 的受精规则是通过配子结合完成受精。',
              pregnancy_or_carrying: 'Type-X 可以承担妊娠。',
              cycle: 'Type-X 存在发情期。',
            },
            lifecycle: {
              maturation: 'Type-X 达到成熟后进入下一阶段。',
              aging: 'Type-X 的寿命通常为六百年。',
            },
            special_rules: ['Type-X 特殊规则：月光下会改变生殖能力。', '云脉休眠规则。'],
          }),
          structuredFixtureType('Type-Y', 'Type-Y 是另一种生殖分类。', {
            capabilities: {
              can_produce_sperm: true,
              can_produce_ova: true,
              can_be_fertilized: null,
              can_fertilize: null,
            can_cause_pregnancy: null,
              can_carry_pregnancy: true,
            },
            reproduction_rules: {
              fertilization: 'Type-Y 的受精规则是通过配子结合完成受精。',
              pregnancy_or_carrying: 'Type-Y 可以承担妊娠。',
              cycle: 'Type-Y 存在发情期。',
            },
            lifecycle: {
              maturation: 'Type-Y 达到成熟后进入下一阶段。',
              aging: 'Type-Y 的寿命通常为六百年。',
            },
            special_rules: ['Type-Y 特殊规则：白昼会改变颜色。', '银沙环境下保持静止。'],
          }),
        ],
      },
    ],
  )

  const [typeX, typeY] = result.species[0].biological_types
  assert.deepEqual(typeX.capabilities, {
    can_produce_sperm: true,
    can_produce_ova: true,
    can_be_fertilized: null,
    can_fertilize: null,
            can_cause_pregnancy: null,
    can_carry_pregnancy: null,
  })
  assert.deepEqual(typeX.reproduction_rules, {
    fertilization: 'Type-X 的受精规则是通过配子结合完成受精。',
    pregnancy_or_carrying: 'Type-X 可以承担妊娠。',
    cycle: 'Type-X 存在发情期。',
    ovulation: null,
    gestation: null,
    labor: null,
  })
  assert.deepEqual(typeX.lifecycle, {
    maturation: 'Type-X 达到成熟后进入下一阶段。',
    aging: 'Type-X 的寿命通常为六百年。',
  })
  assert.deepEqual(typeX.special_rules, ['Type-X 特殊规则：月光下会改变生殖能力。', '云脉休眠规则。'])

  assert.deepEqual(typeY.capabilities, {
    can_produce_sperm: true,
    can_produce_ova: true,
    can_be_fertilized: null,
    can_fertilize: null,
            can_cause_pregnancy: null,
    can_carry_pregnancy: true,
  })
  assert.deepEqual(typeY.reproduction_rules, {
    fertilization: 'Type-Y 的受精规则是通过配子结合完成受精。',
    pregnancy_or_carrying: 'Type-Y 可以承担妊娠。',
    cycle: 'Type-Y 存在发情期。',
    ovulation: null,
    gestation: null,
    labor: null,
  })
  assert.deepEqual(typeY.lifecycle, {
    maturation: 'Type-Y 达到成熟后进入下一阶段。',
    aging: 'Type-Y 的寿命通常为六百年。',
  })
  assert.deepEqual(typeY.special_rules, ['Type-Y 特殊规则：白昼会改变颜色。', '银沙环境下保持静止。'])
})

test('World Model analysis keeps Alpha Beta Omega fields under Species-B without name special cases', async () => {
  const result = await analyzeInput(
    {
      character: {
        description: [
          'Species-B 已被记录为一个物种。',
          'Alpha 是一种生殖分类。',
          'Alpha 能够产生精子。',
          'Beta 是一种生殖分类。',
          'Beta 达到成熟后进入下一阶段。',
          'Omega 是一种生殖分类。',
          'Omega 特殊规则：月光下会改变生殖能力。',
        ].join('\n'),
      },
    },
    [
      {
        name: 'Species-B',
        biological_types: [
          structuredFixtureType('Alpha', null, {
            capabilities: { can_produce_sperm: true },
            special_rules: ['仅在极端环境下休眠。'],
          }),
          structuredFixtureType('Beta', null, {
            lifecycle: {
              maturation: 'Beta 达到成熟后进入下一阶段。',
              aging: 'Beta 的寿命通常为六百年。',
            },
          }),
          structuredFixtureType('Omega', null, {
            special_rules: ['Omega 特殊规则：月光下会改变生殖能力。', '银沙环境下保持静止。'],
          }),
        ],
      },
    ],
  )

  assert.deepEqual(
    result.species[0].biological_types.map(type => type.name),
    ['Alpha', 'Beta', 'Omega'],
  )
  assert.equal(result.species[0].biological_types[0].capabilities.can_produce_sperm, true)
  assert.deepEqual(result.species[0].biological_types[0].special_rules, ['仅在极端环境下休眠。'])
  assert.deepEqual(result.species[0].biological_types[1].lifecycle, {
    maturation: 'Beta 达到成熟后进入下一阶段。',
    aging: 'Beta 的寿命通常为六百年。',
  })
  assert.deepEqual(result.species[0].biological_types[2].special_rules, ['Omega 特殊规则：月光下会改变生殖能力。', '银沙环境下保持静止。'])
})

test('World Model analysis keeps a retained type raw while ignoring species-level contradiction guards', async () => {
  const result = await analyzeDescription('晶巢种存在甲型；晶巢种的体液会结晶，但没有说明该规则属于甲型。', [
    {
      name: '晶巢种',
      biological_types: [
        typeFixture('甲型', {
          capabilities: {
            can_produce_sperm: true,
            can_produce_ova: false,
            can_be_fertilized: true,
            can_fertilize: true,
            can_cause_pregnancy: null,
            can_carry_pregnancy: false,
          },
          reproduction_rules: { fertilization: null },
          special_rules: ['晶巢种的体液会结晶。'],
        }),
      ],
    },
  ])
  const type = result.species[0].biological_types[0]
  assert.equal(type.name, '甲型')
  assert.deepEqual(type.capabilities, {
    can_produce_sperm: true,
    can_produce_ova: false,
    can_be_fertilized: true,
    can_fertilize: true,
            can_cause_pregnancy: null,
    can_carry_pregnancy: false,
  })
  assert.deepEqual(type.reproduction_rules, {
    fertilization: null,
    pregnancy_or_carrying: '无',
    cycle: null,
    ovulation: '无',
    gestation: '无',
    labor: '无',
  })
  assert.deepEqual(type.special_rules, ['晶巢种的体液会结晶。'])
})

test('World Model analysis keeps reversible body changes out of fixed types for original species', async () => {
  const result = await analyzeDescription('澜壳体存在定常型；某角色可以暂时变为双性状态，结束后恢复原状。', [
    {
      name: '澜壳体',
      biological_types: [typeFixture('定常型'), typeFixture('双性')],
    },
  ])

  assert.deepEqual(
    result.species[0].biological_types.map(type => type.name),
    ['定常型'],
  )
})

test('World Model analysis rejects parent-name suffix types for original species', async () => {
  const result = await analyzeDescription('雾棱群明确存在雾棱群族这一分类名称，但没有其它稳定生殖类型资料。', [
    {
      name: '雾棱群',
      biological_types: [typeFixture('雾棱群族'), typeFixture('雾棱群')],
    },
  ])

  assert.deepEqual(result.species[0].biological_types, [])
})

test('World Model analysis keeps prompt-supplied unknown interaction rule for original species', async () => {
  const result = await analyzeDescription('回声囊体存在共鸣型；共鸣型会性交并交换能量，促进个体生成，但资料没有受精机制。', [
    {
      name: '回声囊体',
      biological_types: [
        typeFixture('共鸣型', {
          reproduction_rules: { fertilization: null },
        }),
      ],
    },
  ])

  assert.equal(result.species[0].biological_types[0].reproduction_rules.fertilization, null)
})

test('World Model analysis preserves original non-human sex-label capabilities', async () => {
  const claimedCapabilities = {
    can_produce_sperm: true,
    can_produce_ova: true,
    can_be_fertilized: true,
    can_fertilize: true,
            can_cause_pregnancy: null,
    can_carry_pregnancy: true,
  }
  const result = await analyzeDescription('浮芯体稳定分为男性和女性，但没有说明其生殖能力。', [
    {
      name: '浮芯体',
      biological_types: [typeFixture('男性', { capabilities: claimedCapabilities }), typeFixture('女性', { capabilities: claimedCapabilities })],
    },
  ])

  assert.deepEqual(
    result.species[0].biological_types.map(type => type.name),
    ['男性', '女性'],
  )
  assert.ok(result.species[0].biological_types.every(type =>
    Object.entries(type.capabilities).every(([key, value]) =>
      key === 'can_cause_pregnancy' ? value === null : value === true,
    ),
  ))
})

test('World Model analysis preserves normalized lifecycle text for a retained original type', async () => {
  const result = await analyzeDescription('阶纹生物存在阶序型；阶序型通过修炼等级提升和力量进阶完成 progression。', [
    {
      name: '阶纹生物',
      biological_types: [
        typeFixture('阶序型', {
          lifecycle: { maturation: '修炼等级达到九阶。', aging: '力量进阶持续进行。' },
        }),
      ],
    },
  ])

  assert.deepEqual(result.species[0].biological_types[0].lifecycle, {
    maturation: '修炼等级达到九阶。',
    aging: '力量进阶持续进行。',
  })
})

test('World Model analysis does not rewrite generic capabilities from source-only negatives', async () => {
  const result = await analyzeDescription('晶巢种男性不能产生精子，也不能被受精。', [
    { name: '晶巢种', biological_types: [structuredFixtureType('男性')] },
  ])
  assert.equal(result.species[0].biological_types[0].capabilities.can_produce_sperm, null)
  assert.equal(result.species[0].biological_types[0].capabilities.can_be_fertilized, null)
  assert.equal(result.species[0].biological_types[0].capabilities.can_fertilize, null)
})

test('World Model analysis keeps absent or pseudo-pregnancy raw capabilities unknown', async () => {
  const result = await analyzeDescription('女性镜生体没有证据证明可以怀孕；仅存在假孕现象，无实际妊娠记录。', [
    { name: '镜生体', biological_types: [structuredFixtureType('女性')] },
  ])
  assert.deepEqual(result.species[0].biological_types[0].capabilities, {
    can_produce_sperm: null,
    can_produce_ova: null,
    can_be_fertilized: null,
    can_fertilize: null,
            can_cause_pregnancy: null,
    can_carry_pregnancy: null,
  })
})

test('World Model analysis keeps generic null capabilities despite source-only inability', async () => {
  const result = await analyzeDescription('女性镜生体不能怀孕，也无法被受精。', [
    { name: '镜生体', biological_types: [structuredFixtureType('女性')] },
  ])
  assert.deepEqual(result.species[0].biological_types[0].capabilities, {
    can_produce_sperm: null,
    can_produce_ova: null,
    can_be_fertilized: null,
    can_fertilize: null,
            can_cause_pregnancy: null,
    can_carry_pregnancy: null,
  })
})

test('World Model analysis applies only the named human-equivalence field to non-human types', async () => {
  const result = await analyzeDescription('女性镜生体的妊娠规律与人类相同。', [
    {
      name: '镜生体',
      biological_types: [
        typeFixture('女性', {
          capabilities: {
            can_produce_sperm: false,
            can_produce_ova: true,
            can_be_fertilized: true,
            can_fertilize: false,
            can_cause_pregnancy: null,
            can_carry_pregnancy: true,
          },
          reproduction_rules: {
            fertilization: '按人类方式受精。',
            pregnancy_or_carrying: '按人类方式妊娠。',
            cycle: '约28天。',
            ovulation: '排卵。',
            gestation: '约40周。',
            labor: '按人类方式分娩。',
          },
        }),
      ],
    },
  ])
  const type = result.species[0].biological_types[0]

  assert.deepEqual(type.capabilities, {
    can_produce_sperm: false,
    can_produce_ova: true,
    can_be_fertilized: true,
    can_fertilize: false,
            can_cause_pregnancy: null,
    can_carry_pregnancy: true,
  })
  assert.deepEqual(type.reproduction_rules, {
    fertilization: '按人类方式受精。',
    pregnancy_or_carrying: '按人类方式妊娠。',
    cycle: '约28天。',
    ovulation: '排卵。',
    gestation: '约40周。',
    labor: '按人类方式分娩。',
  })
})

test('World Model final guard preserves explicit Human rules while applying structural absences', async () => {
  const result = await analyzeDescription('资料明确存在人类男性和女性。', [
    {
      name: '人类',
      biological_types: [
        typeFixture('男性', {
          capabilities: {
            can_produce_sperm: true,
            can_produce_ova: false,
            can_be_fertilized: false,
            can_fertilize: true,
            can_cause_pregnancy: null,
            can_carry_pregnancy: false,
          },
          reproduction_rules: {
            fertilization: '体内受精',
            pregnancy_or_carrying: '妊娠',
            cycle: '约28天',
            ovulation: '排卵周期性发生',
            gestation: '约40周',
            labor: '分娩产程',
          },
        }),
        typeFixture('女性', {
          capabilities: {
            can_produce_sperm: false,
            can_produce_ova: true,
            can_be_fertilized: true,
            can_fertilize: false,
            can_cause_pregnancy: null,
            can_carry_pregnancy: true,
          },
          reproduction_rules: {
            fertilization: '体内受精',
            pregnancy_or_carrying: '妊娠',
            cycle: '约28天',
            ovulation: '约28天一次排卵',
            gestation: '约40周',
            labor: '分娩产程',
          },
        }),
      ],
    },
  ])
  const [male, female] = result.species[0].biological_types

  assert.deepEqual(male.reproduction_rules, {
    fertilization: '体内受精',
    pregnancy_or_carrying: '无',
    cycle: '约28天',
    ovulation: '无',
    gestation: '无',
    labor: '无',
  })
  assert.deepEqual(female.reproduction_rules, {
    fertilization: '体内受精',
    pregnancy_or_carrying: '妊娠',
    cycle: '约28天',
    ovulation: '约28天一次排卵',
    gestation: '约40周',
    labor: '分娩产程',
  })
})

test('World Model final guard marks non-human rules absent when capabilities are false', async () => {
  const result = await analyzeDescription(
    '潮汐生物男性不能怀孕，但规则记载妊娠约40周和分娩产程；潮汐生物男性不能产生卵子，但记录会排卵；潮汐生物男性存在发情期和体内受精规则。',
    [
      {
        name: '潮汐生物',
        biological_types: [
          typeFixture('男性', {
            capabilities: {
              can_produce_sperm: null,
              can_produce_ova: false,
              can_be_fertilized: null,
              can_fertilize: null,
            can_cause_pregnancy: null,
              can_carry_pregnancy: false,
            },
            reproduction_rules: {
              fertilization: '体内受精',
              pregnancy_or_carrying: '可以妊娠。',
              cycle: '存在发情期。',
              ovulation: '会排卵。',
              gestation: '约40周。',
              labor: '分娩产程。',
            },
          }),
        ],
      },
    ],
  )
  const type = result.species[0].biological_types[0]

  assert.equal(type.capabilities.can_produce_ova, false)
  assert.equal(type.capabilities.can_carry_pregnancy, false)
  assert.equal(type.reproduction_rules.fertilization, '体内受精')
  assert.equal(type.reproduction_rules.pregnancy_or_carrying, '无')
  assert.equal(type.reproduction_rules.cycle, '存在发情期。')
  assert.equal(type.reproduction_rules.ovulation, '无')
  assert.equal(type.reproduction_rules.gestation, '无')
  assert.equal(type.reproduction_rules.labor, '无')
})

test('World Model final guard clears only conflicting fertilization roles', async () => {
  const result = await analyzeDescription(
    '资料明确存在人类男性和女性；人类男性不能被受精，但其受精规则是卵细胞可在生殖道内被精子受精；人类女性不能使卵细胞受精，但其受精规则是通过精子使卵细胞受精。',
    [
      {
        name: '人类',
        biological_types: [
          typeFixture('男性', {
            capabilities: {
              can_produce_sperm: true,
              can_produce_ova: false,
              can_be_fertilized: false,
              can_fertilize: true,
            can_cause_pregnancy: null,
              can_carry_pregnancy: false,
            },
            reproduction_rules: {
              fertilization: '卵细胞可在生殖道内被精子受精。',
            },
          }),
          typeFixture('女性', {
            capabilities: {
              can_produce_sperm: false,
              can_produce_ova: true,
              can_be_fertilized: true,
              can_fertilize: false,
            can_cause_pregnancy: null,
              can_carry_pregnancy: true,
            },
            reproduction_rules: {
              fertilization: '通过精子使卵细胞受精。',
            },
          }),
        ],
      },
    ],
  )
  const [male, female] = result.species[0].biological_types

  assert.equal(male.reproduction_rules.fertilization, null)
  assert.equal(female.reproduction_rules.fertilization, null)
})

test('World Model final guard preserves known absence for fertilization', async () => {
  const result = await analyzeDescription('雾核体甲型明确不存在受精机制。', [
    {
      name: '雾核体',
      biological_types: [
        typeFixture('甲型', {
          capabilities: {
            can_produce_sperm: null,
            can_produce_ova: null,
            can_be_fertilized: false,
            can_fertilize: false,
            can_cause_pregnancy: null,
            can_carry_pregnancy: null,
          },
          reproduction_rules: { fertilization: '无' },
        }),
      ],
    },
  ])

  assert.equal(result.species[0].biological_types[0].reproduction_rules.fertilization, '无')
})

test('World Model final guard keeps evidence-backed rules when capabilities are unknown', async () => {
  const result = await analyzeDescription('潮汐生物男性存在体内受精规则，但该类型的具体能力未说明。', [
    {
      name: '潮汐生物',
      biological_types: [
        typeFixture('男性', {
          capabilities: {
            can_produce_sperm: null,
            can_produce_ova: null,
            can_be_fertilized: null,
            can_fertilize: null,
            can_cause_pregnancy: null,
            can_carry_pregnancy: null,
          },
          reproduction_rules: {
            fertilization: '体内受精',
          },
        }),
      ],
    },
  ])
  const type = result.species[0].biological_types[0]

  assert.deepEqual(type.capabilities, {
    can_produce_sperm: null,
    can_produce_ova: null,
    can_be_fertilized: null,
    can_fertilize: null,
            can_cause_pregnancy: null,
    can_carry_pregnancy: null,
  })
  assert.equal(type.reproduction_rules.fertilization, '体内受精')
})

test('World Model final guard preserves roleless fertilization text for mixed capability states', async () => {
  const cases = [
    { can_be_fertilized: null, can_fertilize: false },
    { can_be_fertilized: false, can_fertilize: null },
  ]
  const rule = '两种微粒在回声腔内完成结合并形成新个体。'

  for (const capabilities of cases) {
    const result = await analyzeDescription('澄屿体的黏炽型明确存在该生殖分类。', [
      {
        name: '澄屿体',
        biological_types: [
          structuredFixtureType('黏炽型', null, {
            capabilities,
            reproduction_rules: { fertilization: rule },
          }),
        ],
      },
    ])

    assert.equal(result.species[0].biological_types[0].reproduction_rules.fertilization, rule)
  }
})

test('World Model final guard still clears direct fertilization role conflicts', async () => {
  const cases = [
    {
      typeName: '受纳型',
      capabilities: { can_be_fertilized: false },
      rule: '卵细胞可在内囊中被精子受精。',
    },
    {
      typeName: '供化型',
      capabilities: { can_fertilize: false },
      rule: '通过精子使卵细胞受精。',
    },
  ]

  for (const item of cases) {
    const result = await analyzeDescription(`澄屿体的${item.typeName}明确存在该生殖分类。`, [
      {
        name: '澄屿体',
        biological_types: [
          structuredFixtureType(item.typeName, null, {
            capabilities: item.capabilities,
            reproduction_rules: { fertilization: item.rule },
          }),
        ],
      },
    ])

    assert.equal(result.species[0].biological_types[0].reproduction_rules.fertilization, null)
  }
})

test('World Model final guard preserves all non-empty rules when capabilities are unknown', async () => {
  const reproductionRules = {
    fertilization: '两种微粒在回声腔内完成结合。',
    pregnancy_or_carrying: '黏炽型可以承载新生体。',
    cycle: '黏炽型按潮汐阶段循环。',
    ovulation: '黏炽型按阶段释放配子。',
    gestation: '新生体在内囊中经历阶段性发育。',
    labor: '成熟个体通过裂解过程离体。',
  }
  const lifecycle = {
    maturation: '达到成熟阶段后进入稳定期。',
    aging: '衰老过程随时间逐步发生。',
  }
  const result = await analyzeDescription('澄屿体的黏炽型明确存在。', [
    {
      name: '澄屿体',
      biological_types: [
        structuredFixtureType('黏炽型', null, {
          reproduction_rules: reproductionRules,
          lifecycle,
        }),
      ],
    },
  ])
  const type = result.species[0].biological_types[0]

  assert.deepEqual(type.capabilities, {
    can_produce_sperm: null,
    can_produce_ova: null,
    can_be_fertilized: null,
    can_fertilize: null,
            can_cause_pregnancy: null,
    can_carry_pregnancy: null,
  })
  assert.deepEqual(type.reproduction_rules, reproductionRules)
  assert.deepEqual(type.lifecycle, lifecycle)
})

test('World Model Human baseline fills only null fields and preserves explicit deltas', async () => {
  const result = await analyzeDescription('资料明确存在人类男性和女性。', [
    {
      name: '人类',
      biological_types: [
        structuredFixtureType('男性', null, {
          capabilities: {
            can_produce_sperm: false,
            can_produce_ova: true,
            can_be_fertilized: null,
            can_fertilize: false,
            can_cause_pregnancy: null,
            can_carry_pregnancy: true,
          },
          reproduction_rules: {
            fertilization: '无',
            pregnancy_or_carrying: '当前男性可承担妊娠。',
            cycle: '当前男性周期描述。',
            ovulation: '当前男性排卵描述。',
            gestation: null,
            labor: '无',
          },
        }),
        structuredFixtureType('女性', null, {
          capabilities: {
            can_produce_sperm: true,
            can_produce_ova: false,
            can_be_fertilized: null,
            can_fertilize: true,
            can_cause_pregnancy: null,
            can_carry_pregnancy: null,
          },
          reproduction_rules: {
            fertilization: '当前女性受精描述。',
            pregnancy_or_carrying: '无',
            cycle: null,
            ovulation: '无',
            gestation: '当前女性妊娠描述。',
            labor: null,
          },
        }),
      ],
    },
  ])
  const [male, female] = result.species[0].biological_types

  assert.deepEqual(male.capabilities, {
    can_produce_sperm: false,
    can_produce_ova: true,
    can_be_fertilized: false,
    can_fertilize: false,
            can_cause_pregnancy: null,
    can_carry_pregnancy: true,
  })
  assert.deepEqual(male.reproduction_rules, {
    fertilization: '无',
    pregnancy_or_carrying: '当前男性可承担妊娠。',
    cycle: '当前男性周期描述。',
    ovulation: '当前男性排卵描述。',
    gestation: '无',
    labor: '无',
  })
  assert.deepEqual(female.capabilities, {
    can_produce_sperm: true,
    can_produce_ova: false,
    can_be_fertilized: true,
    can_fertilize: true,
            can_cause_pregnancy: null,
    can_carry_pregnancy: true,
  })
  assert.deepEqual(female.reproduction_rules, {
    fertilization: '当前女性受精描述。',
    pregnancy_or_carrying: '无',
    cycle: '通常约28天一个周期。',
    ovulation: '无',
    gestation: '当前女性妊娠描述。',
    labor: '通过分娩完成生产。',
  })
})

test('World Model keeps non-human evidence boundaries without applying Human baseline', async () => {
  const result = await analyzeDescription('澄屿体明确存在男性分类，但没有说明其生殖机制。', [
    {
      name: '澄屿体',
      biological_types: [
        structuredFixtureType('男性'),
        structuredFixtureType('女性', null, {
          capabilities: {
            can_produce_sperm: true,
            can_produce_ova: true,
            can_be_fertilized: true,
            can_fertilize: true,
            can_cause_pregnancy: null,
            can_carry_pregnancy: true,
          },
        }),
      ],
    },
  ])
  const species = result.species[0]

  assert.deepEqual(
    species.biological_types.map(type => type.name),
    ['男性'],
  )
  assert.deepEqual(species.biological_types[0].capabilities, {
    can_produce_sperm: null,
    can_produce_ova: null,
    can_be_fertilized: null,
    can_fertilize: null,
            can_cause_pregnancy: null,
    can_carry_pregnancy: null,
  })
  assert.deepEqual(species.biological_types[0].reproduction_rules, {
    fertilization: null,
    pregnancy_or_carrying: null,
    cycle: null,
    ovulation: null,
    gestation: null,
    labor: null,
  })
})

test('World Model Human baseline yields only the established female type', async () => {
  const result = await analyzeDescription('普通人类资料明确说明角色为女性。', [
    { name: '人类', biological_types: [structuredFixtureType('女性'), structuredFixtureType('男性')] },
  ])
  const [type] = result.species[0].biological_types
  assert.equal(type.name, '女性')
  assert.deepEqual(type.capabilities, {
    can_produce_sperm: false,
    can_produce_ova: true,
    can_be_fertilized: true,
    can_fertilize: false,
            can_cause_pregnancy: null,
    can_carry_pregnancy: true,
  })
  assert.deepEqual(type.reproduction_rules, {
    fertilization: '卵细胞可被精子受精。',
    pregnancy_or_carrying: '可以承担妊娠。',
    cycle: '通常约28天一个周期。',
    ovulation: '通常每个周期排卵。',
    gestation: '通常约40周。',
    labor: '通过分娩完成生产。',
  })
})

test('World Model can use an implicit Human baseline without a Human label', async () => {
  const result = await analyzeDescription('普通城市社会中的一名男性加入某条路线；资料没有声明独立物种来源。', [
    { name: '人类', biological_types: [structuredFixtureType('男性'), structuredFixtureType('女性')] },
  ])

  const [type] = result.species[0].biological_types
  assert.equal(type.name, '男性')
  assert.deepEqual(type.capabilities, {
    can_produce_sperm: true,
    can_produce_ova: false,
    can_be_fertilized: false,
    can_fertilize: true,
            can_cause_pregnancy: null,
    can_carry_pregnancy: false,
  })
})

test('World Model applies a Human delta to one capability and keeps other baseline fields', async () => {
  const result = await analyzeDescription('男性加入某条路线后明确可以承担妊娠；没有说明其它基础机制改变。', [
    {
      name: '人类',
      biological_types: [
        structuredFixtureType('男性', null, {
          capabilities: {
            can_produce_sperm: null,
            can_produce_ova: null,
            can_be_fertilized: null,
            can_fertilize: null,
            can_cause_pregnancy: null,
            can_carry_pregnancy: true,
          },
          reproduction_rules: {
            pregnancy_or_carrying: '该路线允许男性承担妊娠。',
          },
        }),
      ],
    },
  ])

  const type = result.species[0].biological_types[0]
  assert.deepEqual(type.capabilities, {
    can_produce_sperm: true,
    can_produce_ova: false,
    can_be_fertilized: false,
    can_fertilize: true,
            can_cause_pregnancy: null,
    can_carry_pregnancy: true,
  })
  assert.equal(type.reproduction_rules.pregnancy_or_carrying, '该路线允许男性承担妊娠。')
  assert.equal(type.reproduction_rules.cycle, '无')
  assert.equal(type.reproduction_rules.gestation, '无')
})

test('World Model applies a Human reproduction-rule delta without clearing the female baseline', async () => {
  const result = await analyzeDescription('女性接受某项改造后，妊娠期明确为六个月；没有说明其它生理机制改变。', [
    {
      name: '人类',
      biological_types: [
        structuredFixtureType('女性', null, {
          reproduction_rules: { gestation: '该改造后的妊娠期为六个月。' },
        }),
      ],
    },
  ])

  const type = result.species[0].biological_types[0]
  assert.equal(type.capabilities.can_produce_ova, true)
  assert.equal(type.capabilities.can_carry_pregnancy, true)
  assert.equal(type.reproduction_rules.gestation, '该改造后的妊娠期为六个月。')
  assert.equal(type.reproduction_rules.cycle, '通常约28天一个周期。')
  assert.equal(type.reproduction_rules.labor, '通过分娩完成生产。')
})

test('World Model does not use implicit Human fallback when an independent species is explicit', async () => {
  const result = await analyzeInput(
    {
      character: { description: '璃穹体男性可以承担妊娠，但资料没有说明普通人类背景。' },
    },
    [
      { name: '人类', biological_types: [structuredFixtureType('男性')] },
      { name: '璃穹体', biological_types: [structuredFixtureType('男性')] },
    ],
  )

  assert.deepEqual(
    result.species.map(species => species.name),
    ['璃穹体'],
  )
  assert.deepEqual(result.species[0].biological_types[0].capabilities, {
    can_produce_sperm: null,
    can_produce_ova: null,
    can_be_fertilized: null,
    can_fertilize: null,
            can_cause_pregnancy: null,
    can_carry_pregnancy: null,
  })
})

test('World Model keeps source unknown instead of defaulting an unsupported Human type', async () => {
  const result = await analyzeDescription('一个陌生生命的来源、身体结构和生理体系均未说明。', [
    { name: '人类', biological_types: [structuredFixtureType('男性')] },
  ])

  assert.deepEqual(result.species, [])
})

test('World Model preserves the current transformed species label and its synthesized fields', async () => {
  const result = await analyzeDescription('某角色永久变化后被明确称为沧烬种；沧烬种男性仍能产生精子，但不能承担妊娠。', [
    {
      name: '沧烬种',
      biological_types: [
        structuredFixtureType('男性', null, {
          capabilities: {
            can_produce_sperm: true,
            can_produce_ova: false,
            can_be_fertilized: false,
            can_fertilize: true,
            can_cause_pregnancy: null,
            can_carry_pregnancy: false,
          },
        }),
      ],
    },
  ])

  assert.deepEqual(
    result.species.map(species => species.name),
    ['沧烬种'],
  )
  assert.deepEqual(result.species[0].biological_types[0].capabilities, {
    can_produce_sperm: true,
    can_produce_ova: false,
    can_be_fertilized: false,
    can_fertilize: true,
            can_cause_pregnancy: null,
    can_carry_pregnancy: false,
  })
})

test('World Model Human world rules override the ordinary baseline', async () => {
  const result = await analyzeDescription('普通人类世界规则明确：人类男性可以承担妊娠。', [
    {
      name: '人类',
      biological_types: [
        typeFixture('男性', {
          capabilities: {
            can_produce_sperm: true,
            can_produce_ova: false,
            can_be_fertilized: false,
            can_fertilize: true,
            can_cause_pregnancy: null,
            can_carry_pregnancy: true,
          },
          reproduction_rules: { pregnancy_or_carrying: '该世界男性可以承担妊娠。' },
        }),
      ],
    },
  ])
  const type = result.species[0].biological_types[0]
  assert.equal(type.capabilities.can_carry_pregnancy, true)
  assert.equal(type.reproduction_rules.pregnancy_or_carrying, '该世界男性可以承担妊娠。')
})

test('World Analysis request uses ordinary chat messages for current and independent APIs', async () => {
  const analysisInput = {
    persona: { name: '用户甲', description: '用户人物设定私密内容，不应发送' },
    character: { description: '只作为输入证据 {{user}}；潮汐生物存在潮汐生物型' },
    worldbooks: [
      {
        source_id: 'book-1',
        name: '内部书名不应发送',
        entries: [{ entry_id: 'entry-1', label: '内部条目名不应发送', token_estimate: 8, content: '规则证据 {{user}}' }],
      },
    ],
    recent_story: { enabled: true, items: [{ floor: 81, role: 'assistant', content: '楼层证据 {{user}}' }] },
    external_memory: [],
    meta: { chat_id: 'chat-a', user_name: '用户甲', character_name: '角色甲' },
  }
  const requests = []
  const expectedModel = structuredClone(modelFixture)
  const cases = [
    {
      profile: SILLYTAVERN_CURRENT_API,
      context: {
        generateRaw({ prompt }) {
          requests.push({ api: 'current', messages: prompt })
          return JSON.stringify(modelFixture)
        },
      },
    },
    {
      profile: { api_url: 'https://api.example/v1', model: 'model-a' },
      context: {
        getRequestHeaders: () => ({}),
      },
      fetchResponse: async (url, options) => {
        assert.equal(url, '/api/backends/chat-completions/generate')
        const payload = JSON.parse(options.body)
        requests.push({ api: 'independent', messages: payload.messages })
        return new Response(JSON.stringify({ content: JSON.stringify(modelFixture) }), { status: 200 })
      },
    },
  ]

  const originalFetch = globalThis.fetch
  try {
    for (const item of cases) {
      if (item.fetchResponse) globalThis.fetch = item.fetchResponse
      const analyzer = createAnalyzer({
        profileResolver: () => item.profile,
        contextResolver: () => item.context,
      })
      const result = await analyzer.analyzeWorldModel({ analysisInput })
      assert.deepEqual(result, expectedModel)
    }
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(requests.length, 2)
  for (const request of requests) {
    assert.deepEqual(
      request.messages.map(message => message.role),
      ['system', 'system', 'assistant', 'user'],
    )
    assert.ok(request.messages.every(message => typeof message.content === 'string' && message.content.trim()))
    assert.doesNotMatch(JSON.stringify(request.messages), /```|<json>|JSON 格式/i)
    const referenceMessage = request.messages.find(message => message.content.includes('【角色卡：角色甲 的背景资料】'))
    const characterMessage = referenceMessage?.content ?? ''
    const worldbookMessage = referenceMessage?.content ?? ''
    const storyMessage = messageStartingWith(request.messages, '【近期剧情参考】')
    const outputMessage = request.messages.find(message => message.content.includes('【World Model 输出契约】'))?.content ?? ''
    assert.match(characterMessage, /角色背景/)
    assert.match(worldbookMessage, /【条目：内部条目名不应发送】/)
    assert.match(worldbookMessage, /规则证据 用户甲/)
    assert.doesNotMatch(JSON.stringify(request.messages), /用户人物设定私密内容| 的人物设定/)
    assert.doesNotMatch(worldbookMessage, /source_id|entry_id|token_estimate/)
    assert.match(storyMessage, /楼层证据 用户甲/)
    assert.doesNotMatch(storyMessage, /【楼层信息】|【楼层|正文：|Floor 81|\[assistant\]|role=|message_id|swipe_id/)
    assert.match(outputMessage, /World Model/)
  }
})

test('World Analysis prompt blocks can be edited without sending format tags', () => {
  const messages = buildWorldModelMessages(
    {
      persona: { name: '用户乙', description: '用户人物设定私密内容，不应发送' },
      character: { description: '角色证据 {{user}}' },
      worldbooks: [{ source_id: 'book-1', name: '书名不进入发送内容', entries: [{ entry_id: 'entry-1', token_estimate: 4, content: '世界书证据' }] }],
      recent_story: { items: [{ floor: 3, role: 'assistant', content: '楼层内容' }] },
      meta: { user_name: '用户乙', character_name: '角色乙' },
    },
    {
      task: '只分析生物能力，不讨论其它主题，称呼 {{user}}。',
      input_prefix: '用户自定义资料前言。',
      input_suffix: '用户自定义资料后记。',
      labels: { character: '角色资料' },
    },
  )
  assert.deepEqual(
    messages.map(message => message.role),
    ['system', 'system', 'assistant', 'user'],
  )
  assert.match(messages[0].content, /任务：从本次 AnalysisInput/)
  const commonMessage = messages.find(message => message.content.includes('【公共分析提示词】'))?.content ?? ''
  const referenceMessage = messages.find(message => message.content.includes('【角色卡：角色乙 的背景资料】'))?.content ?? ''
  const characterMessage = referenceMessage
  const worldbookMessage = referenceMessage
  const tailMessage = messages.find(message => message.content.includes('【公共分析补充】'))?.content ?? ''
  const storyMessage = messageStartingWith(messages, '【近期剧情参考】')
  const outputMessage = messages.find(message => message.content.includes('【World Model 输出契约】'))?.content ?? ''
  assert.match(commonMessage, /用户自定义资料前言/)
  assert.match(characterMessage, /角色乙 的背景资料/)
  assert.match(worldbookMessage, /世界书证据/)
  assert.match(tailMessage, /用户自定义资料后记/)
  assert.doesNotMatch(JSON.stringify(messages), /用户人物设定私密内容| 的人物设定/)
  assert.doesNotMatch(worldbookMessage, /source_id|entry_id|token_estimate|书名不进入发送内容/)
  assert.match(storyMessage, /楼层内容/)
  assert.doesNotMatch(storyMessage, /【楼层信息】|【楼层|正文：|Floor 3|\[assistant\]|role=|message_id|swipe_id/)
  assert.match(outputMessage, /World Model/)
  assert.equal(
    messages.some(message => /```|<json>|JSON 格式/i.test(message.content)),
    false,
  )
  assert.match(buildWorldModelPrompt({ character: { description: '普通资料' } }), /AnalysisInput/)
})

test('World Analysis supports independent top and bottom SYSTEM messages', () => {
  const analysisInput = {
    character: { description: '角色资料' },
    worldbooks: [],
    recent_story: { items: [{ content: '最近剧情' }] },
    meta: { user_name: '用户甲', character_name: '角色甲' },
  }
  const plainMessages = buildWorldModelMessages(analysisInput, {
    system_top: 'TOP',
    system_bottom: 'BOTTOM',
  })
  const messages = buildWorldModelMessages(analysisInput, {
    system_top: 'TOP {{user}} / <CHAR>',
    system_bottom: 'BOTTOM <USER> / {{char}}',
  })
  const baseline = buildWorldModelMessages(analysisInput)

  assert.deepEqual(plainMessages[0], { role: 'system', content: 'TOP' })
  assert.deepEqual(messages[0], { role: 'system', content: 'TOP 用户甲 / 角色甲' })
  assert.deepEqual(messages.at(-1), { role: 'system', content: 'BOTTOM 用户甲 / 角色甲' })
  assert.equal(messages.at(-2).role, 'user')
  assert.notDeepEqual(messages, baseline)
  assert.ok(
    messages.findIndex(message => message.content.startsWith('TOP 用户甲')) <
      messages.findIndex(message => message.content.includes('【World Model 任务】')),
  )
  assert.ok(
    messages.findIndex(message => message.content.includes('【World Model 输出契约】')) < messages.findIndex(message => message.role === 'assistant'),
  )
  assert.deepEqual(
    messages.map(message => message.role),
    ['system', 'system', 'system', 'assistant', 'user', 'system'],
  )
})

test('World Analysis empty boundary SYSTEM values preserve the four-message behavior', () => {
  const analysisInput = {
    character: { description: '角色资料' },
    recent_story: { items: [{ content: '最近剧情' }] },
    meta: { user_name: '用户甲', character_name: '角色甲' },
  }
  const baseline = buildWorldModelMessages(analysisInput)
  const messages = buildWorldModelMessages(analysisInput, { system_top: '', system_bottom: ' \u0000 ' })

  assert.deepEqual(messages, baseline)
  assert.deepEqual(
    messages.map(message => message.role),
    ['system', 'system', 'assistant', 'user'],
  )
  assert.equal(
    messages.some(message => message.content === ''),
    false,
  )
})

test('World Analysis prompt normalization includes bounded boundary fields and defaults', () => {
  const normalized = normalizeWorldAnalysisPrompt({
    system_top: `  ${'T'.repeat(20005)}  `,
    system_bottom: `  ${'B'.repeat(20005)}  `,
    task: '保留任务',
  })

  assert.equal(DEFAULT_WORLD_ANALYSIS_PROMPT.system_top, '')
  assert.equal(DEFAULT_WORLD_ANALYSIS_PROMPT.system_bottom, '')
  assert.equal(DEFAULT_ANALYSIS_PROMPT.system_top, '')
  assert.equal(DEFAULT_ANALYSIS_PROMPT.system_bottom, '')
  assert.equal(DEFAULT_EXTENSION_SETTINGS.analysis_prompt.system_top, '')
  assert.equal(DEFAULT_EXTENSION_SETTINGS.analysis_prompt.system_bottom, '')
  assert.equal(normalized.system_top.length, 20000)
  assert.equal(normalized.system_bottom.length, 20000)
  assert.equal(normalized.task, '保留任务')
  assert.equal(normalizeWorldAnalysisPrompt({ system_top: 42, system_bottom: null }).system_top, '')
  assert.equal(normalizeWorldAnalysisPrompt({ system_top: 42, system_bottom: null }).system_bottom, '')
})

test('World Model prompt distinguishes unknown non-human rules from the identified human baseline', () => {
  const messages = buildWorldModelMessages({
    character: { description: '角色性别为女性，但资料没有说明其物种；个人例外是妊娠时间不同。' },
    worldbooks: [{ entries: [{ content: '当前世界医疗条件：城市有产科医院和急救设施；人类妊娠规则为三个月。' }] }],
  })
  const prompt = messages.map(message => message.content).join('\n')
  assert.match(prompt, /人类/)
  assert.match(prompt, /【5\. Baseline \/ Origin \/ Transformation】/)
  assert.match(prompt, /Human baseline 只在现有合法条件下使用/)
  assert.match(prompt, /不创建缺失 Type/)
  assert.match(prompt, /Human species 与 Human biological_type 分层/)
  assert.match(prompt, /【2\. Entity Discovery】[\s\S]*Species existence/)
  assert.match(prompt, /Nonhuman 不使用 Human baseline/)
  assert.match(prompt, /每个 fact 必须绑定明确 scope/)
  assert.match(prompt, /未说明\/未知\/证据不足为 null/)
  assert.match(prompt, /【4\. Reproduction \/ Lifecycle \/ Outlet Classification】[\s\S]*fertilization/)
  assert.match(prompt, /medical_context/)
  assert.doesNotMatch(prompt, /妖|魔|剑灵|精灵|兽人|极少女剑灵/)
  assert.match(
    messages.find(message => message.content.includes('【世界书参考资料】'))?.content ?? '',
    /当前世界医疗条件：城市有产科医院和急救设施；人类妊娠规则为三个月/,
  )
  assert.match(prompt, /childbirth_difficulty、care_level、evidence/)
})

test('World Model prompt keeps the Human fallback bounded and generic', () => {
  const messages = buildWorldModelMessages({
    character: { description: '资料只呈现默认男性/女性二元，没有明确非人类证据。' },
  })
  const prompt = messages[0].content
  assert.match(prompt, /普通 Human 支持可来自显式 Human\/人类/)
  assert.match(prompt, /没有 species、没有 Human 字样、类人外形、性别称谓、性交行为或社会结构单独都不充分/)
  assert.match(prompt, /普通 Human Male\/Female 及字段 baseline 不创建缺失 Type/)
  assert.match(prompt, /只输出资料实际支持的 species、biological_type、能力和规则，不使用模型常识补写/)
  assert.doesNotMatch(prompt, /妖|魔|剑灵|精灵|兽人|极少女剑灵/)
})

test('World Model prompt distinguishes fixed dual evidence from temporary dualization', () => {
  const messages = buildWorldModelMessages({
    character: { description: '明确证据：角色本身是双性，并明确可产生精子；也可以短暂双性化。' },
  })
  const prompt = messages[0].content
  assert.match(prompt, /Species-scoped stable statement 可以/)
  assert.match(prompt, /临时、可逆或条件性的性征、器官、生殖能力或身体变化不得建立新的 biological_type/)
  assert.match(messageStartingWith(messages, '【角色卡：角色 的背景资料】'), /角色本身是双性/)
  assert.match(prompt, /明确具备为 true，明确不具备为 false，未说明\/未知\/证据不足为 null/)
})

test('World Model prompt rejects dual types inferred from default male/female input', () => {
  const messages = buildWorldModelMessages({
    character: { description: '资料只呈现默认男性/女性二元，没有其它生殖类型描述。' },
  })
  const prompt = messages[0].content
  assert.match(prompt, /名称保持开放字符串/)
  assert.match(prompt, /缺少 Type evidence 时保持 biological_types: \[\]/)
  assert.doesNotMatch(prompt, /默认人类基础类型包含男性、女性和双性/)
  const characterMessage = messageStartingWith(messages, '【角色卡：角色 的背景资料】')
  assert.match(characterMessage, /资料只呈现默认男性\/女性二元/)
  assert.doesNotMatch(characterMessage, /固定双性分类/)
})

test('World Model prompt states the complete generic field semantic contract', () => {
  const prompt = buildWorldModelMessages()[0].content

  assert.match(prompt, /【2\.1 Direct Stable Classification】[\s\S]*生理性别、生物性别、生理类别、生殖类别/)
  assert.match(prompt, /profession、social identity、organization、culture\/faction、power system、rank\/stage/)
  assert.match(prompt, /缺少 Type evidence 时保持 biological_types: \[\]/)
  assert.match(prompt, /【3\. Field Evidence】[\s\S]*capability evidence/)
  assert.match(prompt, /明确具备为 true，明确不具备为 false，未说明\/未知\/证据不足为 null/)
  assert.match(prompt, /生理性别事实可以支持 Species-scoped type existence/)
  assert.match(prompt, /Type name、male\/female\/sex-like label、外形、性交行为/)
  assert.match(prompt, /Nonhuman 不使用 Human baseline/)
  assert.match(prompt, /【4\. Reproduction \/ Lifecycle \/ Outlet Classification】[\s\S]*真实 fertilization/)
  assert.match(prompt, /lifecycle 只描述生物成熟、寿命或衰老/)
  assert.match(prompt, /lifecycle 只描述生物成熟、寿命或衰老，不吸收 cultivation\/power progression/)
  assert.match(prompt, /【6\. Temporary \/ Exceptions \/ Medical】[\s\S]*不得建立新的 biological_type/)
  assert.match(prompt, /未说明\/未知\/证据不足为 null/)
  assert.match(prompt, /“无”是已知不存在\/不适用/)
  assert.match(prompt, /【7\. Final Completeness Check】/)
  assert.doesNotMatch(prompt, /妖|魔|剑灵|精灵|兽人|极少女剑灵/)
})

test('World Model prompt requires a full biological type candidate gate without worldview examples', () => {
  const prompt = buildWorldModelMessages()[0].content

  for (const pattern of [
    /Species 回答“这是什么生物或稳定生命类别”/u,
    /Type prevalence 不参与 existence threshold/u,
    /rare != temporary，minority != unstable，low prevalence != insufficient existence evidence/u,
    /直接陈述某 Species 长期存在/u,
    /数量、比例、常见程度不参与 Stability Gate/u,
    /只有原文没有直接命名 classification 时/u,
    /分类边界必须唯一确定/u,
    /只有一个 cluster 不得按现实常识补 paired Type/u,
    /不得跨 Species 借 evidence/u,
    /Human 常识补 Nonhuman Type/u,
    /缺少 Type evidence 时保持 biological_types: \[\]/u,
  ]) {
    assert.match(prompt, pattern)
  }
  assert.doesNotMatch(prompt, /例如|比如|示例/u)
})

test('World Model prompt allows unnamed structural reproductive classes without paired-type invention', () => {
  const prompt = buildWorldModelMessages()[0].content

  const genericCases = [
    /只有原文没有直接命名 classification 时，才使用同一 Species 内 stable physiology、reproductive structure、reproductive role 或 reproductive capability/u,
    /稳定且互相可区分 cluster/u,
    /分类边界必须唯一确定/u,
    /只有一个 cluster 不得按现实常识补 paired Type/u,
    /同一个 stable Type 同时具有多个结构\/能力时不得为 schema 对称强行拆分/u,
    /同一个 stable Type 同时具有多个结构\/能力时不得为 schema 对称强行拆分/u,
    /不得跨 Species 借 evidence/u,
    /Type name、male\/female\/sex-like label、外形、性交行为、配对性别和现实常识都不能自动授权 capability/u,
    /Nonhuman 不使用 Human baseline/u,
  ]

  for (const pattern of genericCases) {
    assert.match(prompt, pattern)
  }
  assert.doesNotMatch(prompt, /具体角色|具体世界|具体物种/u)
  assert.doesNotMatch(prompt, /妖|魔|剑灵|精灵|兽人|极少女剑灵/u)
})

test('World Model prompt defines conditional implicit Human baseline and field-level delta', () => {
  const prompt = buildWorldModelMessages()[0].content

  assert.match(prompt, /Character Card、Worldbook、Recent Story、External Memory、当前上下文合并后的可靠背景/u)
  assert.match(prompt, /不要求字面出现 Human\/人类/u)
  assert.match(prompt, /没有 species、没有 Human 字样、类人外形、性别称谓、性交行为或社会结构单独都不充分/u)
  assert.match(prompt, /Human baseline 只在现有合法条件下使用/u)
  assert.match(prompt, /稳定 transformation continuity 只保留 evidence 已建立且未被替换\/消除的事实/u)
  assert.match(prompt, /不新增 source_species、origin 或 inheritance 字段/u)
  assert.match(prompt, /不新增 source_species、origin 或 inheritance 字段/u)
  assert.match(prompt, /gestation 只描述真实 pregnancy\/carrying/u)
  assert.doesNotMatch(prompt, /例如|比如|示例/u)
})

test('World Model prompt requires exhaustive Human type recall without baseline invention', () => {
  const prompt = buildWorldModelMessages()[0].content

  assert.match(prompt, /Human species 与 Human biological_type 分层/u)
  assert.match(prompt, /Direct Stable Classification/u)
  assert.match(prompt, /Derived Stable Classification/u)
  assert.match(prompt, /不使用模型常识补写/u)
  assert.match(prompt, /不要求字面出现 Human\/人类/u)
  assert.match(prompt, /普通 Human Male\/Female 及字段 baseline 不创建缺失 Type/u)
  assert.match(prompt, /Nonhuman、独立生理体系、冲突证据或无法判断时禁止 fallback/u)
  assert.match(prompt, /temporary、reversible、conditional-only.*不创建 permanent Type/u)
  assert.doesNotMatch(prompt, /妖|魔|剑灵|精灵|兽人|极少女剑灵/u)
})

test('World Model prompt requires global species discovery before field analysis', () => {
  const prompt = buildWorldModelMessages()[0].content

  assert.match(prompt, /在分析任何 biological_type、capability、reproduction_rules 或 lifecycle 前/u)
  assert.match(prompt, /完整扫描全部 permitted AnalysisInput，先发现所有/u)
  assert.match(prompt, /Species existence、Biological Type existence、Type details 和各 outlet completeness 相互独立/u)
  assert.match(prompt, /Species existence 只需可靠的 Species-scoped existence evidence/u)
  assert.match(prompt, /type\/details 不完整不删除 Species/u)
  assert.match(prompt, /缺少 Type evidence 时保持 biological_types: \[\]/u)
  assert.match(prompt, /unknowns 只记录已被 evidence 触及但仍 unresolved/u)
  assert.doesNotMatch(prompt, /具体角色|具体世界|妖|魔|剑灵|精灵|兽人|极少女剑灵/u)
})

test('World Model prompt declares ordered discovery, continuity, and final self-check stages', () => {
  const prompt = buildWorldModelMessages()[0].content

  const stages = [
    '【0. Priority / Core Invariants】',
    '【1. Fact Discovery】',
    '【2. Entity Discovery】',
    '【2.1 Direct Stable Classification】',
    '【2.2 Derived Stable Classification】',
    '【3. Field Evidence】',
    '【4. Reproduction / Lifecycle / Outlet Classification】',
    '【5. Baseline / Origin / Transformation】',
    '【6. Temporary / Exceptions / Medical】',
    '【7. Final Completeness Check】',
  ]
  let previousIndex = -1
  for (const stage of stages) {
    const index = prompt.indexOf(stage)
    assert.ok(index > previousIndex, `${stage} must follow the previous analysis stage`)
    previousIndex = index
  }
  assert.equal((prompt.match(/lifecycle 只描述/g) ?? []).length, 1)
  assert.equal((prompt.match(/Human baseline/g) ?? []).length >= 1, true)
  assert.match(prompt, /type\/details 不完整不删除 Species/u)
  assert.match(prompt, /稳定 transformation continuity/u)
  assert.match(prompt, /不新增 source_species、origin 或 inheritance 字段/u)
  assert.match(prompt, /不新增 source_species、origin 或 inheritance 字段/u)
})

test('World Model prompts freeze the ordered generic biological type gate for Full and Supplement', () => {
  const prompts = [
    buildWorldModelMessages().map(message => message.content).join('\n'),
    buildWorldModelPatchMessages().map(message => message.content).join('\n'),
  ]
  const stages = [
    'Species Binding → Exclusion Gate → Stability Gate → Biological/Reproductive Classification → Evidence Sufficiency → Type Creation',
  ]

  for (const prompt of prompts) {
    let previousIndex = -1
    for (const stage of stages) {
      const index = prompt.indexOf(stage)
      assert.ok(index > previousIndex, `${stage} must follow the previous biological type gate stage`)
      previousIndex = index
    }
    assert.match(prompt, /分类边界必须唯一确定/u)
    assert.match(prompt, /profession、social identity、organization、culture\/faction、power system、rank\/stage/u)
    assert.match(prompt, /临时、可逆/u)
    assert.doesNotMatch(prompt, /妖|魔|剑灵|精灵|兽人|极少女剑灵/u)
  }
})

test('World Model Full and Supplement prompts enumerate minority types and run the shared candidate gates', () => {
  const fullPrompt = buildWorldModelMessages().map(message => message.content).join('\n')
  const supplementPrompt = buildWorldModelPatchMessages().map(message => message.content).join('\n')

  for (const prompt of [fullPrompt, supplementPrompt]) {
    assert.match(prompt, /对每个 Species 必须审查全部 evidence-supported stable biological classifications/u)
    assert.match(prompt, /确认一个 Type 后不得停止该 Species 的 Type discovery/u)
    assert.match(prompt, /Species Binding → Exclusion Gate → Stability Gate → Biological\/Reproductive Classification → Evidence Sufficiency → Type Creation/u)
  }
})

test('World Model prompts separate type existence, capability evidence, and species-linked scope', () => {
  const prompts = [
    buildWorldModelMessages().map(message => message.content).join('\n'),
    buildWorldModelPatchMessages().map(message => message.content).join('\n'),
  ]

  for (const prompt of prompts) {
    assert.match(prompt, /Type existence != Type details\/capabilities/u)
    assert.match(prompt, /type existence evidence 与 capability evidence 分离/u)
    assert.match(prompt, /每个 fact 必须绑定明确 scope/u)
    assert.match(prompt, /不跨 Species\/Type 借 evidence/u)
    assert.match(prompt, /明确具备为 true，明确不具备为 false，未说明\/未知\/证据不足为 null/u)
  }
})

test('Supplement compatibility prompt keeps shared review and sparse delta responsibilities', () => {
  const patchPrompt = buildWorldModelPatchMessages()
    .map(message => message.content)
    .join('\n')
  assert.match(patchPrompt, /先完成 Fact Discovery、Species\/Type scope 与共享 Direct\/Derived Type existence gates/u)
  assert.match(patchPrompt, /Existing 仅是 comparison baseline 与兼容合并参考，不是 evidence/u)
  assert.match(patchPrompt, /只输出 evidence-supported sparse v1 add\/update delta/u)
  assert.match(patchPrompt, /UNCHANGED 不输出，合法 ADD\/CHANGE 才输出/u)
  assert.match(patchPrompt, /不能输出完整 replacement World Model/u)
  assert.match(patchPrompt, /individual-only、temporary、scope ambiguous 或 unsupported facts/u)
})

test('World Model keeps an empty type list when original evidence only names other classification axes', async () => {
  const result = await analyzeDescription(
    '澄砂体是一种独立生命 species。资料只提到成员身份为巡航员、等级为第三阶，并描述某角色短暂进入短昼态后恢复原状；没有建立稳定生理分类。',
    [{ name: '澄砂体', biological_types: [] }],
  )

  assert.deepEqual(
    result.species.map(species => species.name),
    ['澄砂体'],
  )
  assert.deepEqual(result.species[0].biological_types, [])
})

test('World Model does not turn a single derived member label into a biological type', async () => {
  const result = await analyzeDescription('烁环体已被记录为一个 species；资料中只出现成员称呼“雾航者”，没有证明它是稳定的生理或生殖分类。', [
    { name: '烁环体', biological_types: [] },
  ])

  assert.deepEqual(result.species[0].biological_types, [])
})

test('World Model preserves multiple explicitly established stable biological classifications with null capabilities', async () => {
  const result = await analyzeDescription('霜脉种稳定存在内核型和外壳型两种生殖生理分类；资料没有说明这两类的五项 capability。', [
    {
      name: '霜脉种',
      biological_types: [structuredFixtureType('内核型'), structuredFixtureType('外壳型')],
    },
  ])

  assert.deepEqual(
    result.species[0].biological_types.map(type => type.name),
    ['内核型', '外壳型'],
  )
  assert.ok(result.species[0].biological_types.every(type => Object.values(type.capabilities).every(value => value === null)))
})

test('World Model preserves rare stable biological types from deterministic frequency evidence', async () => {
  const result = await analyzeDescription('绯环族绝大多数属于曜型，仅极少暮型个体。', [
    {
      name: '绯环族',
      biological_types: [structuredFixtureType('曜型'), structuredFixtureType('暮型')],
    },
  ])

  assert.deepEqual(
    result.species[0].biological_types.map(type => type.name),
    ['曜型', '暮型'],
  )
  assert.ok(result.species[0].biological_types.every(type => Object.values(type.capabilities).every(value => value === null)))
})

test('World Model preserves a rare generic sex type instead of keeping only the majority type', async () => {
  const result = await analyzeDescription('极昼体基本都为男性，极少女性个体。', [
    { name: '极昼体', biological_types: [structuredFixtureType('男性'), structuredFixtureType('女性')] },
  ])

  assert.deepEqual(
    result.species[0].biological_types.map(type => type.name),
    ['男性', '女性'],
  )
})

test('World Model does not invent an unmentioned sibling type during completeness checking', async () => {
  const result = await analyzeDescription('绯环族绝大多数属于曜型。', [
    { name: '绯环族', biological_types: [structuredFixtureType('曜型'), structuredFixtureType('暮型')] },
  ])

  assert.deepEqual(
    result.species[0].biological_types.map(type => type.name),
    ['曜型'],
  )
})

test('World Model keeps a normalized type when its name retains a unique source stem', async () => {
  const result = await analyzeDescription('绯环族多数为核心个体，极少边缘个体。', [
    {
      name: '绯环族',
      biological_types: [structuredFixtureType('核心型'), structuredFixtureType('边缘型')],
    },
  ])

  assert.deepEqual(
    result.species[0].biological_types.map(type => type.name),
    ['核心型', '边缘型'],
  )
})

test('World Model still rejects a normalized type without a source anchor', async () => {
  const result = await analyzeDescription('绯环族多数为核心个体，极少边缘个体。', [
    {
      name: '绯环族',
      biological_types: [structuredFixtureType('陌生型'), structuredFixtureType('异核型')],
    },
  ])

  assert.deepEqual(
    result.species[0].biological_types.map(type => type.name),
    [],
  )
})

test('World Model keeps progression outside lifecycle when the AI returns no biological lifecycle evidence', async () => {
  const result = await analyzeDescription(
    '纤潮体存在稳定生理分类“环核型”，但资料只描述训练阶级提升、技能等级和力量 progression，没有生物成熟或衰老事实。',
    [{ name: '纤潮体', biological_types: [structuredFixtureType('环核型')] }],
  )

  assert.deepEqual(result.species[0].biological_types[0].lifecycle, { maturation: null, aging: null })
})

test('World Model prompt requires Chinese string values and human type names', () => {
  const prompt = buildWorldModelMessages()
    .map(message => message.content)
    .join('\n')
  assert.match(prompt, /JSON key 使用 schema 规定的英文/)
  assert.match(prompt, /说明、规则和列表字符串使用中文/)
  assert.match(prompt, /species\[\] 包含 name、description、biological_types\[\]/)
  assert.match(prompt, /每个 biological_type 包含 name、description、capabilities、reproductive_mechanisms\[\]、reproduction_rules、lifecycle、special_rules/)
  assert.match(prompt, /名称保持开放字符串/)
  assert.match(prompt, /固定包含六个 key/)
  assert.match(prompt, /reproduction_rules 固定包含 fertilization、pregnancy_or_carrying、cycle、ovulation、gestation、labor/)
  assert.doesNotMatch(prompt, /妖|魔|剑灵|精灵|兽人|Homo sapiens|极少女剑灵/)
})

test('settings exposes one Advanced / Debug disclosure with the analysis preview entry', () => {
  const html = settingsPage({})
  assert.match(html, /data-bioweave-action="open-analysis-debug"/)
  assert.match(
    html,
    /data-bioweave-settings-disclosure="analysis_debug"[\s\S]*?高级 \/ 调试[\s\S]*?data-bioweave-action="open-analysis-debug"[\s\S]*?data-bioweave-action="toggle-story-time-debug"/,
  )
  assert.doesNotMatch(html, /data-bioweave-settings-disclosure="analysis_preview"/)
  assert.doesNotMatch(html, /data-bioweave-settings-disclosure="story_time_debug"/)
})

test('debug Popup content is standalone, uses the real message builder, and has no modal shell', () => {
  const html = renderAnalysisDebugPopupContent({
    theme: 'dark',
    analysisPreview: {
      input: {
        character: { description: '角色预览' },
        worldbooks: [],
        recent_story: { items: [{ floor: 1, role: 'assistant', content: '预览剧情' }] },
        external_memory: [],
        meta: { user_name: '用户丙', character_name: '角色丙' },
      },
    },
    documentRef: null,
  })
  assert.match(html, /class="bioweave-analysis-debug-popup-content"/)
  assert.match(html, /data-theme="dark"/)
  assert.match(html, /data-bioweave-analysis-preview/)
  assert.match(html, /data-bioweave-world-model-message-preview/)
  assert.doesNotMatch(html, /data-bioweave-settings-disclosure="analysis_preview"/)
  assert.doesNotMatch(html, /bioweave-analysis-debug-overlay|bioweave-analysis-debug-dialog|bioweave-analysis-debug-close/)
  assert.match(
    STYLE_SOURCE,
    /\.bioweave-analysis-debug-popup-content pre:not\(\.bioweave-world-model-message-content\):not\(\.bioweave-analysis-message-raw\)\s*\{[\s\S]*?overflow-x: auto;/,
  )
  assert.doesNotMatch(STYLE_SOURCE, /bioweave-analysis-debug-overlay|bioweave-analysis-debug-dialog|bioweave-analysis-debug-body/)
})

test('World Model message preview resets Popup alignment and wraps message content', () => {
  const html = renderAnalysisDebugPopupContent({
    worldAnalysisPrompt: { system_top: 'TOP', system_bottom: 'BOTTOM' },
    analysisPreview: {
      input: {
        character: { description: '角色预览' },
        worldbooks: [],
        recent_story: { items: [{ floor: 1, role: 'assistant', content: '预览剧情' }] },
        external_memory: [],
        meta: { user_name: '用户丙', character_name: '角色丙' },
      },
    },
    documentRef: null,
  })

  assert.match(html, /<strong>SYSTEM<\/strong>/)
  assert.match(html, /<strong>ASSISTANT<\/strong>/)
  assert.match(html, /<strong>USER<\/strong>/)
  assert.match(html, /class="bioweave-world-model-message-content"/)
  assert.match(html, /data-bioweave-world-model-message-content/)

  const messagePreviewRule = STYLE_SOURCE.match(/\.bioweave-world-model-message-preview\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
  const messageContentRule = STYLE_SOURCE.match(/\.bioweave-world-model-message-content\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
  assert.match(messagePreviewRule, /text-align:\s*left/)
  assert.match(messageContentRule, /text-align:\s*left/)
  assert.match(messageContentRule, /white-space:\s*pre-wrap/)
  assert.match(messageContentRule, /overflow-wrap:\s*anywhere/)
  assert.match(messageContentRule, /word-break:\s*break-word/)
  assert.match(STYLE_SOURCE, /\.bioweave-analysis-debug-popup-content \.bioweave-world-model-message-preview\s*\{[\s\S]*?text-align:\s*left/)
  assert.match(
    STYLE_SOURCE,
    /\.bioweave-analysis-message-raw,[\s\S]*?\.bioweave-analysis-preview-raw\s*\{[\s\S]*?text-align:\s*left[\s\S]*?white-space:\s*pre-wrap[\s\S]*?overflow-wrap:\s*anywhere[\s\S]*?word-break:\s*break-word/,
  )
  assert.match(
    STYLE_SOURCE,
    /\.bioweave-analysis-debug-popup-content pre:not\(\.bioweave-world-model-message-content\):not\(\.bioweave-analysis-message-raw\)\s*\{[\s\S]*?white-space:\s*pre[;\s]*[\s\S]*?overflow-wrap:\s*normal/,
  )
  assert.doesNotMatch(STYLE_SOURCE, /(?:^|\n)\s*\.popup[^{]*\{[^}]*text-align:\s*center/)
})

test('settings debug preview keeps boundary SYSTEM messages aligned with the request', () => {
  const html = renderAnalysisDebugPopupContent({
    worldAnalysisPrompt: { system_top: 'TOP {{user}}', system_bottom: 'BOTTOM {{char}}' },
    analysisPreview: {
      input: {
        character: { description: '角色预览' },
        worldbooks: [],
        recent_story: { items: [{ floor: 7, role: 'assistant', content: '楼层预览' }] },
        external_memory: [],
        meta: { user_name: '用户丙', character_name: '角色丙' },
      },
    },
    documentRef: null,
  })
  const preview = html
  const topIndex = preview.indexOf('<pre class="bioweave-world-model-message-content" data-bioweave-world-model-message-content>TOP 用户丙</pre>')
  const coreIndex = preview.indexOf('任务：从本次 AnalysisInput')
  const userIndex = preview.indexOf(
    '<pre class="bioweave-world-model-message-content" data-bioweave-world-model-message-content>请根据以上资料完成 World Model 分析',
  )
  const bottomIndex = preview.indexOf('BOTTOM 角色丙')

  assert.equal((preview.match(/<details class="bioweave-world-model-message"/g) ?? []).length, 6)
  assert.ok(topIndex >= 0)
  assert.ok(coreIndex >= 0)
  assert.ok(userIndex >= 0)
  assert.ok(bottomIndex >= 0)
  assert.ok(topIndex < coreIndex)
  assert.ok(userIndex < bottomIndex)
})

test('World Model message structure and raw views share one final messages array', () => {
  const input = {
    character: { description: 'CHARACTER_SOURCE_MARKER', greetings: [] },
    worldbooks: [{ entries: [{ content: 'WORLDBOOK_SOURCE_MARKER' }] }],
    recent_story: { items: [{ floor: 8, role: 'assistant', content: 'RECENT_STORY_SOURCE_MARKER' }] },
    external_memory: [],
    meta: { user_name: '用户丁', character_name: '角色丁' },
    token_estimate: 42,
  }
  const promptSettings = {
    system_top: 'TOP {{user}}',
    task: 'TASK {{char}}',
    input_prefix: 'PREFIX',
    input_suffix: 'SUFFIX',
    system_bottom: 'BOTTOM {{char}}',
  }
  const expectedMessages = buildWorldModelMessages(input, promptSettings)
  const structureHtml = renderAnalysisDebugPopupContent({
    analysisPreview: { mode: 'structure', input },
    worldAnalysisPrompt: promptSettings,
    documentRef: null,
  })
  const rawHtml = renderAnalysisDebugPopupContent({
    analysisPreview: { mode: 'raw', input },
    worldAnalysisPrompt: promptSettings,
    documentRef: null,
  })
  const structuredMessages = extractStructuredMessages(structureHtml)
  const rawMessages = extractRawMessages(rawHtml)

  assert.deepEqual(rawMessages, expectedMessages)
  assert.equal(structuredMessages.length, expectedMessages.length)
  assert.deepEqual(
    structuredMessages.map(({ role, content }) => ({ role, content })),
    expectedMessages,
  )
  assert.deepEqual(
    structuredMessages.map(message => message.index),
    expectedMessages.map((_, index) => index),
  )
  assert.deepEqual(rawMessages[0], { role: 'system', content: 'TOP 用户丁' })
  assert.match(rawMessages[1].content, /World Model/)
  assert.deepEqual(rawMessages.at(-1), expectedMessages.at(-1))
  assert.equal(structuredMessages[0].content, rawMessages[0].content)
  assert.equal(structuredMessages.at(-1).content, rawMessages.at(-1).content)
  assert.match(rawHtml, /class="bioweave-analysis-message-raw[^\"]*"/)
  assert.match(rawHtml, /CHARACTER_SOURCE_MARKER/)
  assert.doesNotMatch(rawHtml, /"character"\s*:/)
  assert.doesNotMatch(rawHtml, /"token_estimate"\s*:/)
})

test('World Model raw and structure views keep the four-message compatibility shape without boundaries', () => {
  const input = {
    character: { description: 'EMPTY_BOUNDARY_CHARACTER', greetings: [] },
    worldbooks: [],
    recent_story: { items: [] },
    external_memory: [],
    meta: { user_name: '用户戊', character_name: '角色戊' },
  }
  const promptSettings = { system_top: '', system_bottom: '' }
  const expectedMessages = buildWorldModelMessages(input, promptSettings)
  const structureHtml = renderAnalysisDebugPopupContent({
    analysisPreview: { mode: 'structure', input },
    worldAnalysisPrompt: promptSettings,
    documentRef: null,
  })
  const rawHtml = renderAnalysisDebugPopupContent({
    analysisPreview: { mode: 'raw', input },
    worldAnalysisPrompt: promptSettings,
    documentRef: null,
  })

  assert.equal(expectedMessages.length, 3)
  assert.equal(extractStructuredMessages(structureHtml).length, 3)
  assert.deepEqual(extractRawMessages(rawHtml), expectedMessages)
})

test('settings debug preview shows temporary Raw and Canonical trace in Chinese', () => {
  const html = renderAnalysisDebugPopupContent({
    analysisPreview: {
      worldModelTrace: {
        rawResponse: '{"species":[{"name":"弧晶体","biological_types":[{"name":"甲相"}]}]}',
        canonicalModel: {
          schema_version: 1,
          species: [{ name: '弧晶体', biological_types: [{ name: '甲相' }] }],
        },
      },
    },
    documentRef: null,
  })

  assert.match(html, /AI 原始返回/)
  assert.match(html, /规范化后的世界模型/)
  assert.match(html, /弧晶体/)
  assert.match(html, /甲相/)
  assert.doesNotMatch(html, /api_key|secret_ref|authorization/iu)
})

test('AnalysisInput carries current SillyTavern names for request placeholder replacement', () => {
  const input = buildAnalysisInput({
    context: { chatId: 'chat-names', name1: '当前用户设定', name2: '当前角色卡' },
    chatId: 'chat-names',
  })
  assert.equal(input.meta.user_name, '当前用户设定')
  assert.equal(input.meta.character_name, '当前角色卡')
  const messages = buildWorldModelMessages({
    ...input,
    character: { description: '<user> 与 {{char}} 的资料' },
  })
  assert.match(messageStartingWith(messages, '【角色卡：当前角色卡 的背景资料】'), /当前用户设定 与 当前角色卡 的资料/)
})

test('AnalysisInput keeps the selected persona for collection but excludes it from the World Model request', () => {
  const input = buildAnalysisInput({
    context: {
      chatId: 'chat-persona',
      name1: '界面用户名',
      name2: '当前角色卡',
      powerUserSettings: {
        persona_name: '当前人物设定名称',
        persona_description: '用户人物设定：偏好在夜间活动。',
      },
    },
    chatId: 'chat-persona',
  })

  assert.deepEqual(input.persona, {
    name: '当前人物设定名称',
    description: '用户人物设定：偏好在夜间活动。',
  })
  assert.equal(input.meta.user_name, '当前人物设定名称')
  const messages = buildWorldModelMessages(input)
  assert.doesNotMatch(JSON.stringify(messages), /用户人物设定：偏好在夜间活动。/)
  assert.doesNotMatch(JSON.stringify(messages), / 的人物设定/)
})

test('World Model request failure leaves the previous model untouched', async () => {
  const previousModel = structuredClone(modelFixture)
  let currentModel = previousModel
  const analyzer = createAnalyzer({
    profileResolver: () => SILLYTAVERN_CURRENT_API,
    contextResolver: () => ({
      generateRaw() {
        throw new Error('API_BAD_REQUEST')
      },
    }),
  })

  await assert.rejects(analyzer.analyzeWorldModel({ analysisInput: {} }), /API_BAD_REQUEST/)
  assert.deepEqual(currentModel, previousModel)
})

test('AnalysisInput summary stores counts only, never source正文', () => {
  const summary = summarizeAnalysisInput({
    persona: { name: '用户', description: '用户秘密人物设定' },
    character: { description: '秘密正文', greetings: [{ content: '备用开场白' }] },
    worldbooks: [{ source_id: 'book-1', entries: [{ entry_id: 'entry-1', content: '世界书正文' }] }],
    recent_story: { enabled: true, floor_count: 2, floor_start: 8, floor_end: 9, items: [{ content: '剧情正文' }] },
    external_memory: [{ key: 'anima', label: 'Anima', status: '读取成功', items: [{ content: '记忆正文' }] }],
    token_estimate: 42,
  })
  assert.equal(summary.character_fields, 2)
  assert.equal(summary.worldbook_entries, 1)
  assert.equal(summary.token_estimate, 42)
  assert.equal(JSON.stringify(summary).includes('秘密正文'), false)
  assert.equal(JSON.stringify(summary).includes('用户秘密人物设定'), false)
  assert.equal(JSON.stringify(summary).includes('世界书正文'), false)
  assert.equal(JSON.stringify(summary).includes('剧情正文'), false)
  assert.equal(JSON.stringify(summary).includes('记忆正文'), false)
})

test('World Model external memory uses the neutral history memory heading', () => {
  const messages = buildWorldModelMessages({
    external_memory: [
      {
        key: 'anima',
        label: 'Anima',
        enabled: true,
        available: true,
        content_available: true,
        read_status: 'success',
        items: [{ label: '记忆文件', content: '历史事件摘要' }],
      },
    ],
  })
  const memoryMessage = messageStartingWith(messages, '【外部历史参考信息】')
  assert.match(memoryMessage, /来自用户在设置中启用的外部历史或记忆来源/)
  assert.match(memoryMessage, /【记忆文件】/)
})

test('World Model page uses Chinese labels and shows null as 未知', () => {
  const html = worldPage({
    worldModel: modelFixture,
    selectedSpeciesIndex: 0,
    selectedTypeIndex: 0,
    worldModelMeta: {
      last_analyzed_at: '2026-09-07T00:00:00.000Z',
      last_saved_at: '2026-09-07T00:00:00.000Z',
      last_saved_by: 'ai',
      source_summary: { character_fields: 1, worldbooks: 1, worldbook_entries: 1, token_estimate: 3 },
    },
  })
  assert.match(html, /世界模型/)
  assert.match(html, /data-bioweave-action="world-model-full"[^>]*>开始分析<\/button>/)
  assert.match(html, /data-bioweave-action="world-model-patch"[^>]*>补充分析<\/button>/)
  assert.match(html, /title="重新分析当前上下文，构建完整的世界模型。"/)
  assert.match(html, /title="基于现有世界模型查漏补缺，补充或修正遗漏的世界信息。"/)
  assert.match(html, /bioweave-world-model-top/)
  assert.match(html, /最后分析：<\/strong>\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}/)
  assert.match(html, /来源：<\/strong>角色卡 · 1 本世界书/)
  assert.doesNotMatch(html, /角色卡 1 项|条目|令牌|最后保存|AI 分析/)
  assert.match(html, /种族/)
  assert.match(html, /当前世界中已识别的种族/)
  assert.match(html, /bioweave-world-model-content-grid/)
  assert.match(html, /bioweave-world-model-species-grid/)
  assert.match(html, /bioweave-world-model-type-grid/)
  assert.doesNotMatch(html, /bioweave-world-model-type-selector/)
  assert.match(html, /bioweave-world-model-module-grid/)
  assert.match(html, /bioweave-world-model-world-stack/)
  assert.match(html, /潮汐生物/)
  assert.match(html, /潮汐生物型/)
  assert.match(html, /1 个类型 · 潮汐生物型/)
  assert.match(html, /3\/6 项能力已知 · 妊娠未知/)
  assert.match(html, /生物类型详情/)
  assert.doesNotMatch(html, /切换类型/)
  assert.match(html, /生殖能力/)
  assert.match(html, /可承载妊娠/)
  assert.match(html, /医疗与照护/)
  assert.match(html, /分娩难度/)
  assert.match(html, /当前资料不足以确定难度/)
  assert.match(html, /未知/)
  assert.equal(/\b(?:unknown|null|undefined|N\/A)\b/i.test(html), false)
  assert.match(html, /data-bioweave-action="world-model-add-species"[^>]*title="新增种族"[^>]*aria-label="新增种族"/)
  assert.match(html, /data-bioweave-action="world-model-add-biological-type"[^>]*title="新增性别 \/ 生物类型"[^>]*aria-label="新增性别 \/ 生物类型"/)

  const canonicalDualModel = normalizeWorldModel({
    ...modelFixture,
    species: [
      {
        ...modelFixture.species[0],
        biological_types: [typeFixture('双性')],
      },
    ],
  })
  const dualHtml = worldPage({ worldModel: canonicalDualModel })
  assert.match(dualHtml, /双性/)
  assert.doesNotMatch(dualHtml, /双性\/间性/)

  const visibleTypesModel = normalizeWorldModel({
    ...modelFixture,
    species: [
      {
        ...modelFixture.species[0],
        name: '人类',
        biological_types: [
          typeFixture('潮汐生物型'),
          typeFixture('甲型'),
          typeFixture('穗核型'),
          typeFixture('Alpha'),
          typeFixture('Beta'),
          typeFixture('Omega'),
        ],
      },
    ],
  })
  const visibleTypesHtml = worldPage({ worldModel: visibleTypesModel, selectedSpeciesIndex: 0, selectedTypeIndex: 0 })
  assert.equal((visibleTypesHtml.match(/data-bioweave-action="world-model-select-type"/g) ?? []).length, 6)
  assert.equal((visibleTypesHtml.match(/<section class="[^"]*bioweave-world-model-type-detail[^"]*">/g) ?? []).length, 1)
  for (const typeName of ['潮汐生物型', '甲型', '穗核型', 'Alpha', 'Beta', 'Omega']) {
    assert.match(visibleTypesHtml, new RegExp(`<b>${typeName}</b>`))
  }
})

test('World Model page keeps Patch visible but disabled before the first World Model', () => {
  const html = worldPage()
  assert.match(html, /data-bioweave-action="world-model-full"[^>]*>开始分析<\/button>/)
  assert.match(html, /data-bioweave-action="world-model-patch"[^>]*disabled[^>]*>补充分析<\/button>/)
  assert.match(html, /title="需要先建立世界模型后才能进行补充分析。"/)
})

test('World Model page keeps the running action clickable for cancellation', () => {
  const html = worldPage({ worldModel: modelFixture, worldModelBusy: true, worldModelOperation: 'full' })
  assert.match(html, /data-bioweave-action="world-model-full"[^>]*>分析中…<\/button>/)
  assert.doesNotMatch(html, /data-bioweave-action="world-model-full"[^>]*disabled/)
  assert.match(html, /data-bioweave-action="world-model-patch"[^>]*disabled[^>]*>补充分析<\/button>/)
})

test('World Model collection edits are species-scoped, canonical, unique, and immutable', () => {
  const base = normalizeWorldModel(modelFixture)
  const original = structuredClone(base)
  const addSpecies = applyWorldModelCollectionEdit(base, {operation: 'add-species', name: '  镜生体  '})
  assert.equal(addSpecies.changed, true)
  assert.equal(addSpecies.model.species.at(-1).name, '镜生体')
  assert.deepEqual(addSpecies.model.species.at(-1), {
    name: '镜生体',
    description: null,
    biological_types: [],
  })
  assert.deepEqual(base, original)

  const duplicateSpecies = applyWorldModelCollectionEdit(addSpecies.model, {operation: 'add-species', name: '镜生体'})
  assert.equal(duplicateSpecies.changed, false)
  assert.equal(duplicateSpecies.model.species.length, 2)

  const addType = applyWorldModelCollectionEdit(addSpecies.model, {
    operation: 'add-biological-type',
    speciesIndex: 1,
    name: '  甲型  ',
  })
  assert.equal(addType.changed, true)
  assert.equal(addType.model.species[1].biological_types[0].name, '甲型')
  assert.equal(addType.model.species[0].biological_types.length, 1)
  assert.deepEqual(addType.model.medical_context, base.medical_context)
  assert.deepEqual(addType.model.unknowns, base.unknowns)

  const duplicateType = applyWorldModelCollectionEdit(addType.model, {
    operation: 'add-biological-type',
    speciesIndex: 1,
    name: '甲型',
  })
  assert.equal(duplicateType.changed, false)
  assert.equal(duplicateType.model.species[1].biological_types.length, 1)

  const removedType = applyWorldModelCollectionEdit(addType.model, {
    operation: 'remove-biological-type',
    speciesIndex: 1,
    typeIndex: 0,
  })
  assert.equal(removedType.changed, true)
  assert.deepEqual(removedType.model.species[1].biological_types, [])
  assert.equal(removedType.model.species[0].name, base.species[0].name)

  const removedSpecies = applyWorldModelCollectionEdit(addType.model, {
    operation: 'remove-species',
    speciesIndex: 1,
  })
  assert.equal(removedSpecies.changed, true)
  assert.deepEqual(removedSpecies.model.species, [base.species[0]])
  assert.equal(applyWorldModelCollectionEdit(base, {operation: 'add-species', name: '   '}).changed, false)
  assert.equal(applyWorldModelCollectionEdit(base, {operation: 'add-biological-type', speciesIndex: 0, name: '   '}).changed, false)

  const renamedSpecies = applyWorldModelCollectionEdit(base, {operation: 'rename-species', speciesIndex: 0, name: '  高等潮汐生物  '})
  assert.equal(renamedSpecies.changed, true)
  assert.equal(renamedSpecies.model.species[0].name, '高等潮汐生物')
  assert.deepEqual(renamedSpecies.model.species[0].biological_types, base.species[0].biological_types)
  assert.deepEqual({...renamedSpecies.model.species[0], name: base.species[0].name}, base.species[0])
  assert.equal(applyWorldModelCollectionEdit(base, {operation: 'rename-species', speciesIndex: 0, name: '潮汐生物'}).changed, false)
  assert.equal(applyWorldModelCollectionEdit(base, {operation: 'rename-species', speciesIndex: 0, name: '   '}).changed, false)
  assert.equal(applyWorldModelCollectionEdit(addSpecies.model, {operation: 'rename-species', speciesIndex: 0, name: '镜生体'}).changed, false)

  const renamedType = applyWorldModelCollectionEdit(base, {operation: 'rename-biological-type', speciesIndex: 0, typeIndex: 0, name: '  高等潮汐型  '})
  assert.equal(renamedType.changed, true)
  assert.equal(renamedType.model.species[0].biological_types[0].name, '高等潮汐型')
  assert.deepEqual(
    {...renamedType.model.species[0].biological_types[0], name: base.species[0].biological_types[0].name},
    base.species[0].biological_types[0],
  )
  assert.equal(applyWorldModelCollectionEdit(base, {operation: 'rename-biological-type', speciesIndex: 0, typeIndex: 0, name: base.species[0].biological_types[0].name}).changed, false)
  assert.equal(applyWorldModelCollectionEdit(base, {operation: 'rename-biological-type', speciesIndex: 0, typeIndex: 0, name: '   '}).changed, false)
  const duplicateTypeModel = structuredClone(base)
  duplicateTypeModel.species[0].biological_types.push({...duplicateTypeModel.species[0].biological_types[0], name: '另一个类型'})
  assert.equal(applyWorldModelCollectionEdit(duplicateTypeModel, {operation: 'rename-biological-type', speciesIndex: 0, typeIndex: 1, name: base.species[0].biological_types[0].name}).changed, false)
})

test('World Model collection controls stay icon-only, accessible, and species-scoped', () => {
  const html = worldPage({worldModel: modelFixture, selectedSpeciesIndex: 0, selectedTypeIndex: 0})
  assert.equal((html.match(/data-bioweave-action="world-model-add-species"/g) ?? []).length, 1)
  assert.equal((html.match(/data-bioweave-action="world-model-delete-species"/g) ?? []).length, 1)
  assert.equal((html.match(/data-bioweave-action="world-model-add-biological-type"/g) ?? []).length, 1)
  assert.equal((html.match(/data-bioweave-action="world-model-delete-biological-type"/g) ?? []).length, 1)
  assert.equal((html.match(/data-bioweave-action="world-model-edit-species"/g) ?? []).length, 1)
  assert.equal((html.match(/data-bioweave-action="world-model-edit-biological-type"/g) ?? []).length, 1)
  assert.match(html, /data-bioweave-action="world-model-edit-species"[^>]*title="编辑种族：潮汐生物"[^>]*aria-label="编辑种族：潮汐生物"[^>]*><i class="fa-solid fa-pen"/)
  assert.match(html, /data-bioweave-action="world-model-edit-biological-type"[^>]*title="编辑性别 \/ 生物类型：潮汐生物型"[^>]*aria-label="编辑性别 \/ 生物类型：潮汐生物型"[^>]*><i class="fa-solid fa-pen"/)
  assert.match(html, /bioweave-world-model-section-heading["]?[^>]*>.*data-bioweave-action="world-model-add-species"/s)
  assert.match(html, /bioweave-world-model-type-picker-head["]?[^>]*>.*data-bioweave-action="world-model-add-biological-type"/s)
  assert.doesNotMatch(html, /world-model-remove-species|world-model-remove-biological-type|world-model-open-add-menu|world-model-delete-selection|world-model-add-menu/)
  assert.doesNotMatch(STYLE_SOURCE, /bioweave-world-model-toolbar|bioweave-world-model-add-menu|bioweave-world-model-collection-card|bioweave-world-model-delete-button/)

  const speciesOnlyHtml = worldPage({worldModel: modelFixture, selectedSpeciesIndex: 0})
  assert.doesNotMatch(speciesOnlyHtml, /data-bioweave-action="world-model-add-biological-type"[^>]*disabled/)
  assert.match(speciesOnlyHtml, /data-bioweave-action="world-model-edit-biological-type"[^>]*disabled/)
  assert.match(speciesOnlyHtml, /data-bioweave-action="world-model-delete-biological-type"[^>]*disabled/)

  const noSelectionHtml = worldPage({worldModel: modelFixture})
  assert.match(noSelectionHtml, /data-bioweave-action="world-model-add-biological-type"[^>]*disabled/)
  assert.match(noSelectionHtml, /data-bioweave-action="world-model-edit-species"[^>]*disabled/)
  assert.match(noSelectionHtml, /data-bioweave-action="world-model-delete-biological-type"[^>]*disabled/)
})

test('World Model UI selection is typed and stale name snapshots fail closed', () => {
  const speciesSelection = createWorldModelSelection(modelFixture, 0)
  const typeSelection = createWorldModelSelection(modelFixture, 0, 0)
  assert.deepEqual(speciesSelection, {kind: 'species', speciesIndex: 0, typeIndex: null, speciesName: '潮汐生物'})
  assert.deepEqual(typeSelection, {kind: 'biological_type', speciesIndex: 0, typeIndex: 0, speciesName: '潮汐生物', typeName: '潮汐生物型'})
  assert.deepEqual(normalizeWorldModelSelection(modelFixture, speciesSelection), speciesSelection)
  assert.deepEqual(normalizeWorldModelSelection(modelFixture, typeSelection), typeSelection)
  assert.equal(normalizeWorldModelSelection({...modelFixture, species: [{...modelFixture.species[0], name: '已改名'}]}, typeSelection), null)
  assert.equal(normalizeWorldModelSelection({...modelFixture, species: []}, typeSelection), null)
  const selectedSpecies = createWorldModelSpeciesSelection(modelFixture, 0)
  const selectedType = createWorldModelBiologicalTypeSelection(modelFixture, 0, 0)
  assert.deepEqual(selectedSpecies, {speciesIndex: 0, speciesName: '潮汐生物'})
  assert.deepEqual(selectedType, {speciesIndex: 0, typeIndex: 0, speciesName: '潮汐生物', typeName: '潮汐生物型'})
  assert.deepEqual(normalizeWorldModelSpeciesSelection(modelFixture, selectedSpecies), selectedSpecies)
  assert.deepEqual(normalizeWorldModelBiologicalTypeSelection(modelFixture, selectedType), selectedType)
  assert.equal(normalizeWorldModelBiologicalTypeSelection({...modelFixture, species: [{...modelFixture.species[0], name: '已改名'}]}, selectedType), null)
})

test('World UI Fixture A keeps one species, two types, card summaries, fixed fields, and exception labels', () => {
  assert.equal(fixtureA.species.length, 1)
  assert.equal(fixtureA.species[0].biological_types.length, 2)
  assert.deepEqual(Object.keys(fixtureA.species[0].biological_types[0].capabilities).sort(), [
    'can_be_fertilized',
    'can_carry_pregnancy',
    'can_cause_pregnancy',
    'can_fertilize',
    'can_produce_ova',
    'can_produce_sperm',
  ])
  assert.deepEqual(Object.keys(fixtureA.species[0].biological_types[0].reproduction_rules).sort(), [
    'cycle',
    'fertilization',
    'gestation',
    'labor',
    'ovulation',
    'pregnancy_or_carrying',
  ])
  assert.deepEqual(Object.keys(fixtureA.species[0].biological_types[0].lifecycle).sort(), ['aging', 'maturation'])

  const firstTypeHtml = worldPage({
    worldModel: fixtureA,
    selectedSpeciesIndex: 0,
    selectedTypeIndex: 0,
  })
  assert.match(firstTypeHtml, /2 个类型 · Fixture A 类型一 \/ Fixture A 类型二/)
  assert.doesNotMatch(firstTypeHtml, /Fixture A 物种描述。|第二行仍然可读。/)
  assert.match(firstTypeHtml, /Fixture A 类型一描述。/)
  assert.match(firstTypeHtml, /类型说明第二行。/)
  assert.match(firstTypeHtml, /4\/6 项能力已知 · 不可承载妊娠/)
  assert.match(firstTypeHtml, /Fixture A 受精方式|Fixture A 妊娠方式|Fixture A 生理周期/)
  assert.match(firstTypeHtml, /Fixture A 排卵机制|Fixture A 妊娠周期|Fixture A 分娩方式/)
  assert.match(firstTypeHtml, /Fixture A 成熟|Fixture A 衰老|Fixture A 特殊规则/)
  assert.match(firstTypeHtml, /Fixture A 分娩难度|Fixture A 照护水平|Fixture A 医疗依据/)
  assert.match(firstTypeHtml, /Fixture A 例外主文本/)
  assert.match(firstTypeHtml, /Fixture A 无附加标签的例外/)
  assert.match(firstTypeHtml, /适用对象：Fixture A 适用对象/)
  assert.match(firstTypeHtml, /依据：Fixture A 例外依据/)
  assert.equal((firstTypeHtml.match(/适用对象：/g) ?? []).length, 1)
  assert.equal((firstTypeHtml.match(/依据：/g) ?? []).length, 1)
  assert.match(firstTypeHtml, /Fixture A 尚未确定项/)
  assert.match(firstTypeHtml, /<dd[^>]*>是<\/dd>/)
  assert.match(firstTypeHtml, /<dd[^>]*>否<\/dd>/)
  assert.match(firstTypeHtml, /<dd[^>]*>未知<\/dd>/)

  const secondTypeHtml = worldPage({
    worldModel: fixtureA,
    selectedSpeciesIndex: 0,
    selectedTypeIndex: 1,
  })
  assert.match(secondTypeHtml, /Fixture A 类型二描述。/)
  assert.match(secondTypeHtml, /data-bioweave-world-section="special_rules"/)
  assert.match(secondTypeHtml, /尚未确定|未知/)
  assert.doesNotMatch(secondTypeHtml, /适用对象：<\/small>|依据：<\/small>/)
})

test('World UI Fixture B maps four species and dynamic card summaries', () => {
  assert.equal(fixtureB.species.length, 4)
  assert.deepEqual(
    fixtureB.species.map(species => species.biological_types.length),
    [2, 1, 0, 3],
  )

  const html = worldPage({
    worldModel: fixtureB,
    selectedSpeciesIndex: 3,
    selectedTypeIndex: 2,
  })
  assert.equal((html.match(/data-bioweave-action="world-model-select-type"/g) ?? []).length, 3)
  for (const species of fixtureB.species) {
    assert.match(html, new RegExp(species.name))
    const typeNames = species.biological_types.map(type => type.name).join(' / ')
    assert.match(html, new RegExp(`${species.biological_types.length} 个类型 · ${typeNames || '未知'}`))
    for (const type of species === fixtureB.species[3] ? species.biological_types : []) {
      assert.match(html, new RegExp(type.name))
    }
  }
  assert.match(html, /Fixture B 类型四丙描述。/)
  const emptySpeciesHtml = worldPage({
    worldModel: fixtureB,
    selectedSpeciesIndex: 2,
    selectedTypeIndex: 0,
  })
  assert.match(emptySpeciesHtml, /尚未识别出生物类型/)
  assert.match(html, /<h3 class="bioweave-world-model-module-title">特殊例外<\/h3>/)
  assert.match(html, /<h3 class="bioweave-world-model-module-title">尚未确定<\/h3>/)
  assert.match(html, /<p class="bioweave-empty">未知<\/p>/)

  for (const [speciesIndex, species] of fixtureB.species.entries()) {
    for (const [typeIndex] of species.biological_types.entries()) {
      assert.deepEqual(resolveWorldModelSelection(fixtureB, speciesIndex, typeIndex), {
        speciesIndex,
        typeIndex,
      })
      const selectedHtml = worldPage({
        worldModel: fixtureB,
        selectedSpeciesIndex: speciesIndex,
        selectedTypeIndex: typeIndex,
      })
      for (const section of ['capabilities', 'reproduction_rules', 'lifecycle', 'special_rules']) {
        assert.equal(
          (
            selectedHtml.match(
              new RegExp(`<section class="[^\"]*bioweave-world-model-module[^\"]*" data-bioweave-world-section="${section}"`, 'g'),
            ) ?? []
          ).length,
          1,
          `${species.name} type ${typeIndex} should render ${section}`,
        )
      }
      if (speciesIndex === 0 && typeIndex === 0) {
        assert.match(selectedHtml, /Fixture B 规则甲/)
      }
      for (const label of [
        '可产生精子',
        '可产生卵子',
        '可受精',
        '可使对方受精',
        '可承载妊娠',
        '受精方式',
        '妊娠方式',
        '生理周期',
        '排卵机制',
        '妊娠周期',
        '分娩方式',
        '成熟',
        '衰老',
      ]) {
        assert.equal((selectedHtml.match(new RegExp(`<dt>${label}<\\/dt>`, 'g')) ?? []).length, 1)
      }
    }
  }
})

test('World UI card CSS keeps the reference density across devices', () => {
  assert.match(
    STYLE_SOURCE,
    /\.bioweave-world-model-page \.bioweave-world-model-species-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s,
  )
  assert.match(STYLE_SOURCE, /\.bioweave-world-model-page \.bioweave-world-model-species-card\s*\{[^}]*min-height:\s*72px\s*!important/s)
  assert.match(
    STYLE_SOURCE,
    /\.bioweave-world-model-page \.bioweave-world-model-type-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(150px,\s*1fr\)\)/s,
  )
  assert.match(STYLE_SOURCE, /\.bioweave-world-model-page \.bioweave-world-model-type-button\s*\{[^}]*min-height:\s*56px\s*!important/s)
  assert.match(
    STYLE_SOURCE,
    /\.bioweave-world-model-page \.bioweave-world-model-type-sections\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*!important/s,
  )
  assert.match(
    STYLE_SOURCE,
    /\.bioweave-world-model-page \.bioweave-world-model-type-sections \.bioweave-world-model-property\s*\{[^}]*grid-template-columns:\s*minmax\(118px,\s*max-content\)\s*minmax\(0,\s*1fr\)\s*!important/s,
  )
  assert.match(
    STYLE_SOURCE,
    /@media\s*\(min-width:\s*1200px\)[\s\S]*?\.bioweave-world-model-page \.bioweave-world-model-content-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*6fr\)\s*minmax\(0,\s*4fr\)\s*!important/s,
  )
  assert.match(
    STYLE_SOURCE,
    /\.bioweave-world-model-page \.bioweave-world-model-section-heading\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*flex-start;[^}]*justify-content:\s*space-between;[^}]*margin:\s*16px 0 9px/s,
  )
  assert.match(
    STYLE_SOURCE,
    /\.bioweave-world-model-page \.bioweave-world-model-type-picker-head\s*\{[^}]*margin-top:\s*5px\s*!important;[^}]*padding-top:\s*5px\s*!important/s,
  )
  assert.match(STYLE_SOURCE, /\.bioweave-world-model-page \.bioweave-world-model-type-card-head b\s*\{[^}]*font-size:\s*15px\s*!important/s)
  assert.match(
    STYLE_SOURCE,
    /data-bioweave-world-section="medical_context"\]\s*\.bioweave-world-model-property\s*\{[^}]*grid-template-columns:\s*minmax\(92px,\s*max-content\)\s*minmax\(0,\s*1fr\)\s*!important;[^}]*gap:\s*5px\s*!important/s,
  )
  assert.match(
    STYLE_SOURCE,
    /\.bioweave-world-model-page \.bioweave-world-model-property dd\.bioweave-world-model-value-good,[\s\S]*?padding-right:\s*8px\s*!important/s,
  )
  assert.match(
    STYLE_SOURCE,
    /\.bioweave-world-model-page \.bioweave-world-model-capability-check\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*16px\s*!important/s,
  )
  assert.match(STYLE_SOURCE, /\.bioweave-world-model-page \.bioweave-world-model-card-summary\s*,[^}]*\{[^}]*display:\s*block\s*!important/s)
  assert.match(
    STYLE_SOURCE,
    /@media\s*\(max-width:\s*767px\)[\s\S]*?\.bioweave-world-model-page \.bioweave-world-model-card-summary\s*\{[^}]*display:\s*none\s*!important/s,
  )
})

test('World Model type cards keep Runtime order after selecting a later type', () => {
  const html = worldPage({
    worldModel: fixtureB,
    selectedSpeciesIndex: 3,
    selectedTypeIndex: 2,
  })
  const positions = [0, 1, 2].map(index => html.indexOf(`data-bioweave-world-type-index="${index}"`))
  assert.ok(positions.every(position => position >= 0))
  assert.deepEqual(
    positions,
    [...positions].sort((left, right) => left - right),
  )
  assert.match(html, /data-bioweave-world-type-index="2"[^>]*aria-pressed="true"/)
})

test('World Model cards render arbitrary Runtime types and derive pregnancy only from capabilities', () => {
  const runtimeModel = {
    ...fixtureB,
    species: [
      {
        ...fixtureB.species[0],
        name: '运行时物种',
        biological_types: [
          structuredFixtureType('Gamma', null, {
            capabilities: {
              can_produce_sperm: true,
              can_produce_ova: true,
              can_be_fertilized: true,
              can_fertilize: true,
            can_cause_pregnancy: null,
              can_carry_pregnancy: false,
            },
          }),
          structuredFixtureType('Delta', null, {
            capabilities: {
              can_produce_sperm: true,
              can_produce_ova: true,
              can_be_fertilized: true,
              can_fertilize: true,
            can_cause_pregnancy: null,
              can_carry_pregnancy: true,
            },
          }),
          structuredFixtureType('Epsilon', null, {
            capabilities: {
              can_produce_sperm: null,
              can_produce_ova: null,
              can_be_fertilized: null,
              can_fertilize: null,
            can_cause_pregnancy: null,
              can_carry_pregnancy: null,
            },
          }),
        ],
      },
    ],
  }
  const html = worldPage({ worldModel: runtimeModel, selectedSpeciesIndex: 0, selectedTypeIndex: 1 })

  assert.match(html, /3 个类型 · Gamma \/ Delta \/ Epsilon/)
  assert.match(html, /<b>Gamma<\/b>[\s\S]*?5\/6 项能力已知 · 不可承载妊娠/)
  assert.match(html, /<b>Delta<\/b>[\s\S]*?5\/6 项能力已知 · 可承载妊娠/)
  assert.match(html, /<b>Epsilon<\/b>[\s\S]*?0\/6 项能力已知 · 妊娠未知/)
  assert.doesNotMatch(html, /<b>男性<\/b>|<b>女性<\/b>/)
  assert.match(html, /data-bioweave-world-type-index="1"[^>]*aria-pressed="true"/)
})

test('World Model page keeps the main source summary compact and filters unused sources', () => {
  const html = worldPage({
    worldModel: modelFixture,
    worldModelMeta: {
      last_analyzed_at: '2026-09-08T19:18:42+08:00',
      last_saved_at: '2026-09-08T19:18:42+08:00',
      last_saved_by: 'manual',
      source_summary: {
        character_fields: 0,
        worldbooks: 1,
        worldbook_entries: 23,
        recent_story: {
          enabled: true,
          floor_start: 57,
          floor_end: 60,
          floors_read: 4,
        },
        external_memory: [
          { key: 'anima', label: 'Anima', enabled: false, read_status: 'disabled' },
          { key: 'baobaoshu', label: '柏宝书', enabled: true, read_status: 'success' },
          { key: 'database_memory', label: '数据库记忆', enabled: true, read_status: 'empty' },
        ],
        token_estimate: 9757,
      },
    },
  })

  assert.match(html, /最后分析：<\/strong>2026\/09\/08 19:18/)
  assert.match(html, /来源：<\/strong>1 本世界书 · 最近剧情 F57-F60 · 柏宝书/)
  assert.doesNotMatch(html, /角色卡/)
  assert.doesNotMatch(html, /Anima|数据库记忆/)
  assert.doesNotMatch(html, /23 条目|9757|最后保存|手动|AI 分析/)
})

test('World Model page shows a recent-story count when its floor range is unavailable', () => {
  const html = worldPage({
    worldModel: modelFixture,
    worldModelMeta: {
      last_analyzed_at: '2026-09-08T19:18:42+08:00',
      source_summary: {
        character_fields: 0,
        worldbooks: 0,
        recent_story: { enabled: true, floor_start: null, floor_end: null, floors_read: 4 },
      },
    },
  })

  assert.match(html, /来源：<\/strong>最近剧情 4 楼/)
})

test('World Model page preserves a species with no inferred biological type', () => {
  const html = worldPage({
    worldModel: {
      schema_version: 1,
      species: [{ name: '人类', description: null, biological_types: [] }],
      medical_context: { childbirth_difficulty: null, care_level: null, evidence: null },
      exceptions: [],
      unknowns: [],
    },
    selectedSpeciesIndex: 0,
  })
  assert.match(html, /人类/)
  assert.match(html, /尚未识别出生物类型/)
  assert.doesNotMatch(html, /可产生精子/)
})

test('World Model UI renders Human and an original species through the same renderer', () => {
  const html = worldPage({
    worldModel: {
      schema_version: 1,
      species: [
        {
          name: '人类',
          description: '普通人类。',
          biological_types: [typeFixture('男性'), typeFixture('女性')],
        },
        {
          name: '镜生体',
          description: '原创物种。',
          biological_types: [typeFixture('甲型')],
        },
      ],
      medical_context: { childbirth_difficulty: null, care_level: null, evidence: null },
      exceptions: [],
      unknowns: [],
    },
    selectedSpeciesIndex: 0,
    selectedTypeIndex: 0,
  })

  assert.match(html, /人类/)
  assert.match(html, /男性/)
  assert.match(html, /女性/)
  assert.match(html, /镜生体/)
  assert.equal((html.match(/data-bioweave-action="world-model-select-type"/g) ?? []).length, 2)

  const originalSpeciesHtml = worldPage({
    worldModel: {
      schema_version: 1,
      species: [
        {
          name: '人类',
          description: '普通人类。',
          biological_types: [typeFixture('男性'), typeFixture('女性')],
        },
        {
          name: '镜生体',
          description: '原创物种。',
          biological_types: [typeFixture('甲型')],
        },
      ],
      medical_context: { childbirth_difficulty: null, care_level: null, evidence: null },
      exceptions: [],
      unknowns: [],
    },
    selectedSpeciesIndex: 1,
    selectedTypeIndex: 0,
  })
  assert.match(originalSpeciesHtml, /甲型/)
  assert.equal((originalSpeciesHtml.match(/data-bioweave-action="world-model-select-type"/g) ?? []).length, 1)
})

test('World Model page does not expose the analysis input preview entry', () => {
  const html = worldPage()
  assert.doesNotMatch(html, /查看本次分析输入|world-model-view-input/)
  assert.doesNotMatch(html, /data-bioweave-analysis-preview/)
  assert.doesNotMatch(html, /data-bioweave-world-model-message-preview/)
})

test('World Model page keeps invalid saved-model feedback as a persistent state notice', () => {
  const html = worldPage({ worldModelNotice: '已保存的世界模型格式无效，请重新分析。' })
  assert.match(html, /class="bioweave-settings-notice"[^>]*role="status"/)
  assert.match(html, /已保存的世界模型格式无效，请重新分析。/)
})

test('World UI uses seven independent section editors and keeps the global editor removed', () => {
  const viewHtml = worldPage({
    worldModel: modelFixture,
    selectedSpeciesIndex: 0,
    selectedTypeIndex: 0,
  })
  assert.deepEqual(WORLD_MODEL_SECTION_KEYS, [
    'capabilities',
    'reproduction_rules',
    'lifecycle',
    'special_rules',
    'medical_context',
    'exceptions',
    'unknowns',
  ])
  assert.equal((viewHtml.match(/data-bioweave-action="world-model-edit-section"/g) ?? []).length, 7)
  assert.doesNotMatch(viewHtml, /data-bioweave-world-model-form/)
  assert.doesNotMatch(viewHtml, /保存世界模型/)
  assert.equal(viewHtml.includes('api_key'), false)

  const editingHtml = worldPage({
    worldModel: modelFixture,
    selectedSpeciesIndex: 0,
    selectedTypeIndex: 0,
    editingSection: 'capabilities',
    sectionDraft: modelFixture.species[0].biological_types[0].capabilities,
  })
  assert.equal((editingHtml.match(/data-bioweave-world-section-form/g) ?? []).length, 1)
  assert.match(editingHtml, /data-bioweave-world-section="capabilities"/)
  assert.match(editingHtml, /data-bioweave-action="world-model-cancel-section"/)
  assert.match(editingHtml, /data-bioweave-action="world-model-save-section"/)
  assert.match(editingHtml, /bioweave-world-model-capability-input/)
  assert.match(editingHtml, /data-bioweave-world-capability-state="true"[^>]*checked/)
  assert.match(editingHtml, /data-bioweave-world-capability-state="false"/)
  assert.match(editingHtml, /data-bioweave-world-capability-state="unknown"[^>]*aria-checked="mixed"/)
  assert.doesNotMatch(editingHtml, /<select[^>]*data-bioweave-world-section-field/)
  assert.equal((editingHtml.match(/data-bioweave-action="world-model-edit-section"/g) ?? []).length, 6)
})

test('World Model production code remains free of fixture-specific species rules', () => {
  const production = [
    readFileSync(new URL('../ai/prompts.js', import.meta.url), 'utf8'),
    readFileSync(new URL('../ai/analyzer.js', import.meta.url), 'utf8'),
  ].join('\n')
  for (const term of ['妖修', '半兽人', '妖剑剑灵', '魔剑灵', '男剑灵', '女剑灵']) {
    assert.equal(production.includes(term), false, `production contains fixture term: ${term}`)
  }
  assert.doesNotMatch(production, /(?:species|type|item)\s*={2,3}\s*['"`](?:妖|魔|剑灵)['"`]/u)
  assert.doesNotMatch(production, /KNOWN_FANTASY_SPECIES|fantasySpecies|speciesDictionary|speciesRegistry|knownBiologicalTypes/u)
})

test('World UI section patches only the selected type or world-level section', () => {
  const base = normalizeWorldModel(modelFixture)
  const capabilityDraft = {
    ...base.species[0].biological_types[0].capabilities,
    can_produce_ova: true,
  }
  const typePatched = applyWorldModelSection(base, 'capabilities', capabilityDraft, {
    selectedSpeciesIndex: 0,
    selectedTypeIndex: 0,
  })

  assert.equal(typePatched.species[0].biological_types[0].capabilities.can_produce_ova, true)
  assert.deepEqual(typePatched.species[0].biological_types[0].reproduction_rules, base.species[0].biological_types[0].reproduction_rules)
  assert.deepEqual(typePatched.medical_context, base.medical_context)
  assert.deepEqual(base, normalizeWorldModel(modelFixture))

  const medicalDraft = {
    ...base.medical_context,
    care_level: '需要专门照护。',
  }
  const worldPatched = applyWorldModelSection(base, 'medical_context', medicalDraft, {
    selectedSpeciesIndex: 0,
    selectedTypeIndex: 0,
  })
  assert.equal(worldPatched.medical_context.care_level, '需要专门照护。')
  assert.deepEqual(worldPatched.species, base.species)
  assert.deepEqual(worldPatched.exceptions, base.exceptions)
})

test('empty Chat does not reserve Chat-level World Model slots', () => {
  const chat = emptyChat('chat-a')
  assert.equal(Object.hasOwn(chat, 'world_model'), false)
  assert.equal(Object.hasOwn(chat, 'world_model_meta'), false)
  assert.deepEqual(chat.settings.external_memory, {
    anima: false,
    baobaoshu: false,
    database_memory: false,
  })
})
