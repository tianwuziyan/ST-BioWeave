import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildWorldModelMessages, buildWorldModelPrompt, WORLD_MODEL_SCHEMA} from '../ai/prompts.js';
import {buildAnalysisInput} from '../ai/input-builder.js';
import {
  createAnalyzer,
  normalizeWorldModel,
  parseWorldModelResponse,
  summarizeAnalysisInput,
} from '../ai/analyzer.js';
import {SILLYTAVERN_CURRENT_API, emptyChat} from '../storage/schema.js';
import {settingsPage} from '../ui/settings.js';
import {
  applyWorldModelSection,
  WORLD_MODEL_SECTION_KEYS,
  worldPage,
} from '../ui/world.js';

const modelFixture = {
  schema_version: 1,
  species: [{
    name: '潮汐生物',
    description: '具有特殊生殖规则的物种。',
    biological_types: [{
      name: '潮汐生物型',
      description: '具有双向受精能力的生物类型。',
      capabilities: {
        can_produce_sperm: true,
        can_produce_ova: null,
        can_be_fertilized: false,
        can_fertilize: true,
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
      lifecycle: {maturation: null, aging: '寿命尚未明确。'},
      special_rules: ['潮汐期能力会变化。'],
    }],
  }],
  medical_context: {
    childbirth_difficulty: '当前资料不足以确定难度。',
    care_level: '需要基础医疗支持。',
    evidence: '世界书明确描述存在产科设施。',
  },
  exceptions: [{
    statement: '本 Chat 中记录了一次不符合一般规则的受精。',
    applies_to: '角色甲',
    evidence: '最近剧情中的明确描述',
  }],
  unknowns: ['是否存在其他生物类型。'],
};

function typeFixture(name, overrides = {}) {
  return {
    ...structuredClone(modelFixture.species[0].biological_types[0]),
    name,
    ...overrides,
  };
}

function worldResponse(species, unknowns = []) {
  return {
    schema_version: 1,
    species,
    medical_context: null,
    exceptions: [],
    unknowns,
  };
}

async function analyzeInput(analysisInput, species, unknowns = []) {
  const response = worldResponse(species, unknowns);
  const analyzer = createAnalyzer({
    profileResolver: () => SILLYTAVERN_CURRENT_API,
    contextResolver: () => ({generateRaw: () => JSON.stringify(response)}),
  });
  return analyzer.analyzeWorldModel({analysisInput});
}

async function analyzeDescription(description, species, unknowns = []) {
  return analyzeInput({character: {description}}, species, unknowns);
}

test('World Model schema keeps capability unknowns as null and drops extra fields', () => {
  const model = normalizeWorldModel({
    ...modelFixture,
    species: modelFixture.species.map(species => ({...species, capabilities: {can_fertilize: true}})),
    gender: '不要推断',
    extra: '不要保存',
  });
  assert.deepEqual(model, modelFixture);
  assert.equal(Object.hasOwn(model, 'gender'), false);
  assert.equal(Object.hasOwn(model.species[0], 'gender'), false);
  assert.equal(Object.hasOwn(model.species[0].biological_types[0], 'gender'), false);
  assert.equal(Object.hasOwn(model.species[0], 'capabilities'), false);
  assert.equal(Object.hasOwn(WORLD_MODEL_SCHEMA, 'biological_types'), false);
  assert.equal(Object.hasOwn(WORLD_MODEL_SCHEMA.species[0], 'capabilities'), false);
  assert.deepEqual(WORLD_MODEL_SCHEMA.species[0].biological_types[0].capabilities, {
    can_produce_sperm: null,
    can_produce_ova: null,
    can_be_fertilized: null,
    can_fertilize: null,
    can_carry_pregnancy: null,
  });
  assert.deepEqual(WORLD_MODEL_SCHEMA.species[0].biological_types[0].reproduction_rules, {
    fertilization: null,
    pregnancy_or_carrying: null,
    cycle: null,
    ovulation: null,
    gestation: null,
    labor: null,
  });
  assert.deepEqual(WORLD_MODEL_SCHEMA.medical_context, {
    childbirth_difficulty: null,
    care_level: null,
    evidence: null,
  });
});

test('World Model schema drops model-invented capability keys', () => {
  const raw = structuredClone(modelFixture);
  raw.species[0].biological_types[0].capabilities = {
    can_produce_sperm: true,
    can_produce_ova: null,
    can_be_fertilized: false,
    can_fertilize: true,
    can_carry_pregnancy: null,
    can_lactate: true,
    can_regenerate: true,
    can_shapeshift: true,
    reproduction: '不得保存',
    gestation: '不得保存',
  };

  const normalized = normalizeWorldModel(raw);
  assert.deepEqual(normalized.species[0].biological_types[0].capabilities, {
    can_produce_sperm: true,
    can_produce_ova: null,
    can_be_fertilized: false,
    can_fertilize: true,
    can_carry_pregnancy: null,
  });
});

test('World Model nested fixtures keep old fields and default new fields to null', () => {
  const legacy = structuredClone(modelFixture);
  delete legacy.medical_context;
  delete legacy.species[0].biological_types[0].reproduction_rules.ovulation;
  delete legacy.species[0].biological_types[0].reproduction_rules.gestation;
  delete legacy.species[0].biological_types[0].reproduction_rules.labor;
  const normalized = normalizeWorldModel(legacy);
  assert.deepEqual(normalized.species[0].biological_types[0].reproduction_rules, {
    fertilization: '需要两种配子接触。',
    pregnancy_or_carrying: null,
    cycle: '周期尚未明确。',
    ovulation: null,
    gestation: null,
    labor: null,
  });
  assert.deepEqual(normalized.medical_context, {
    childbirth_difficulty: null,
    care_level: null,
    evidence: null,
  });
});

test('World Model medical context accepts nullable strings and drops extra fields', () => {
  const normalized = normalizeWorldModel({
    ...modelFixture,
    medical_context: {
      childbirth_difficulty: '  中等  ',
      care_level: 'unknown',
      evidence: null,
      diagnosis: '不得保存',
    },
  });
  assert.deepEqual(normalized.medical_context, {
    childbirth_difficulty: '中等',
    care_level: null,
    evidence: null,
  });
  assert.equal(Object.hasOwn(normalized.medical_context, 'diagnosis'), false);
  assert.throws(() => normalizeWorldModel({...modelFixture, medical_context: {care_level: 3}}), error => error?.code === 'WORLD_MODEL_INVALID');
});

test('World Model response parser accepts JSON object content and rejects invalid output', () => {
  const parsed = parseWorldModelResponse({
    choices: [{message: {content: ['```json\n', JSON.stringify(modelFixture), '\n```']}}],
  });
  assert.deepEqual(parsed, modelFixture);
  assert.throws(() => parseWorldModelResponse('这不是 JSON'), error => error?.code === 'WORLD_MODEL_INVALID');
  assert.throws(() => parseWorldModelResponse(JSON.stringify({})), error => error?.code === 'WORLD_MODEL_INVALID');
});

test('World Model parser keeps bisexual/intersex capabilities independently evidence-based', () => {
  const rawModel = structuredClone(modelFixture);
  rawModel.species[0].biological_types[0] = {
    ...rawModel.species[0].biological_types[0],
    name: '双性/间性',
    description: '资料明确说明可产生精子，明确不能被受精，其余能力没有足够证据。',
    capabilities: {
      can_produce_sperm: true,
      can_produce_ova: null,
      can_be_fertilized: false,
      can_fertilize: null,
      can_carry_pregnancy: null,
    },
  };

  const parsed = parseWorldModelResponse(JSON.stringify(rawModel));
  assert.equal(parsed.species[0].biological_types[0].name, '双性');
  assert.deepEqual(parsed.species[0].biological_types[0].capabilities, {
    can_produce_sperm: true,
    can_produce_ova: null,
    can_be_fertilized: false,
    can_fertilize: null,
    can_carry_pregnancy: null,
  });
});

test('World Model analysis does not keep an unsupported fixed dual type', async () => {
  const response = structuredClone(modelFixture);
  response.species[0].biological_types.push({
    ...structuredClone(modelFixture.species[0].biological_types[0]),
    name: '双性/间性类型',
  });
  response.species.push({
    name: '仅有未获证据的类型',
    description: null,
    biological_types: [{
      ...structuredClone(modelFixture.species[0].biological_types[0]),
      name: '双性/间性类型',
    }],
  });
  const analyzer = createAnalyzer({
    profileResolver: () => SILLYTAVERN_CURRENT_API,
    contextResolver: () => ({generateRaw: () => JSON.stringify(response)}),
  });

  const result = await analyzer.analyzeWorldModel({
    analysisInput: {
      persona: {description: '用户自述为双性，但人物设定不参与 World Model。'},
      character: {description: '资料只出现男性和女性；潮汐生物存在潮汐生物型，但不确定双性。'},
    },
  });

  assert.deepEqual(result.species.map(species => species.name), ['潮汐生物']);
  assert.deepEqual(result.species[0].biological_types.map(type => type.name), ['潮汐生物型']);
});

test('World Model analysis keeps and canonicalizes a fixed dual type when source evidence is explicit', async () => {
  const response = structuredClone(modelFixture);
  response.species[0].biological_types.push({
    ...structuredClone(modelFixture.species[0].biological_types[0]),
    name: '双性/间性类型',
  });
  const analyzer = createAnalyzer({
    profileResolver: () => SILLYTAVERN_CURRENT_API,
    contextResolver: () => ({generateRaw: () => JSON.stringify(response)}),
  });

  const result = await analyzer.analyzeWorldModel({
    analysisInput: {
      character: {description: '潮汐生物型存在；潮汐生物明确存在双性个体。'},
    },
  });

  assert.deepEqual(result.species[0].biological_types.map(type => type.name), ['潮汐生物型', '双性']);
});

test('World Model parser localizes common English human labels before saving', () => {
  const parsed = normalizeWorldModel({
    ...modelFixture,
    species: [{
      ...modelFixture.species[0],
      name: 'Homo sapiens',
      biological_types: [{
        ...modelFixture.species[0].biological_types[0],
        name: 'Human male type',
        description: 'Human male type',
        special_rules: ['Humans have a known rule.'],
      }],
    }],
    medical_context: {
      ...modelFixture.medical_context,
      evidence: 'Human childbirth evidence',
    },
    exceptions: ['Homo sapiens exception'],
    unknowns: ['Human cycle unknown'],
  });

  assert.equal(parsed.species[0].name, '人类');
  assert.equal(parsed.species[0].biological_types[0].name, '人类 男性 type');
  assert.equal(parsed.species[0].biological_types[0].description, '人类 男性 type');
  assert.equal(parsed.species[0].biological_types[0].special_rules[0], '人类 have a known rule.');
  assert.equal(parsed.medical_context.evidence, '人类 childbirth evidence');
  assert.equal(parsed.exceptions[0].statement, '人类 exception');
  assert.equal(parsed.unknowns[0], '人类 cycle unknown');
  assert.doesNotMatch(JSON.stringify(parsed), /\bHomo\s+sapiens\b|\bHumans?\b|\bmale\b|\bfemale\b/i);
});

test('World Model structural normalization removes species context from familiar type names', () => {
  const parsed = normalizeWorldModel({
    ...modelFixture,
    species: [{
      name: '镜生体',
      description: null,
      biological_types: [
        typeFixture('男性镜生体'),
        typeFixture('女性镜生体'),
        typeFixture('双性/间性人类'),
      ],
    }],
  });
  assert.deepEqual(parsed.species[0].biological_types.map(type => type.name), ['男性', '女性', '双性']);
});

test('World Model rejects the old flat biological_types contract without guessing a species', () => {
  const legacy = {
    schema_version: 1,
    biological_types: structuredClone(modelFixture.species[0].biological_types),
    medical_context: modelFixture.medical_context,
    exceptions: [],
    unknowns: [],
  };
  assert.throws(() => normalizeWorldModel(legacy), error => error?.code === 'WORLD_MODEL_INVALID');
  assert.throws(() => parseWorldModelResponse(JSON.stringify(legacy)), error => error?.code === 'WORLD_MODEL_INVALID');
});

test('World Model keeps species and biological type recognition separate and supports open type names', () => {
  const raw = {
    schema_version: 1,
    species: [
      {
        name: '人类',
        description: '资料明确出现人类常规类型和双性/间性类型。',
        biological_types: [
          {...structuredClone(modelFixture.species[0].biological_types[0]), name: '男性'},
          {...structuredClone(modelFixture.species[0].biological_types[0]), name: '女性'},
          {...structuredClone(modelFixture.species[0].biological_types[0]), name: '双性/间性'},
        ],
      },
      {name: '仅识别出的物种', description: '资料只识别出物种，没有具体类型。', biological_types: []},
      {
        name: '镜生体',
        description: '明确的原创物种，性别基本为男性，极少数为女性。',
        biological_types: [
          {...structuredClone(modelFixture.species[0].biological_types[0]), name: '男性', capabilities: {}},
          {...structuredClone(modelFixture.species[0].biological_types[0]), name: '女性', capabilities: {}},
        ],
      },
      {
        name: '人类 ABO',
        description: null,
        biological_types: [
          {...structuredClone(modelFixture.species[0].biological_types[0]), name: 'Alpha', capabilities: {}},
          {...structuredClone(modelFixture.species[0].biological_types[0]), name: 'Beta', capabilities: {}},
          {...structuredClone(modelFixture.species[0].biological_types[0]), name: 'Omega', capabilities: {}},
        ],
      },
    ],
    medical_context: null,
    exceptions: [],
    unknowns: [],
  };
  const parsed = parseWorldModelResponse(JSON.stringify(raw));
  assert.deepEqual(parsed.species[0].biological_types.map(type => type.name), ['男性', '女性', '双性']);
  assert.deepEqual(parsed.species[1].biological_types, []);
  assert.deepEqual(parsed.species[2].biological_types.map(type => type.name), ['男性', '女性']);
  assert.deepEqual(parsed.species[3].biological_types.map(type => type.name), ['Alpha', 'Beta', 'Omega']);
  assert.deepEqual(parsed.species[3].biological_types[0].capabilities, {
    can_produce_sperm: null,
    can_produce_ova: null,
    can_be_fertilized: null,
    can_fertilize: null,
    can_carry_pregnancy: null,
  });
});

test('World Model analysis keeps only the familiar types supported by male-only evidence', async () => {
  const result = await analyzeDescription('普通人类资料明确说明角色为男性。', [
    {
      name: '人类',
      biological_types: [typeFixture('男性'), typeFixture('女性'), typeFixture('双性')],
    },
  ]);
  assert.deepEqual(result.species[0].biological_types.map(type => type.name), ['男性']);
});

test('World Model analysis keeps male and female when both are explicitly evidenced', async () => {
  const result = await analyzeDescription('普通人类世界规则明确记载男性和女性都存在。', [
    {
      name: '人类',
      biological_types: [typeFixture('男性'), typeFixture('女性'), typeFixture('双性')],
    },
  ]);
  assert.deepEqual(result.species[0].biological_types.map(type => type.name), ['男性', '女性']);
});

test('World Model analysis recognizes ordinary sex wording and rejects negated or uncertain labels', async () => {
  const result = await analyzeDescription('普通人类角色性别为男；普通人类另一角色性别为女。', [
    {
      name: '人类',
      biological_types: [typeFixture('男性'), typeFixture('女性'), typeFixture('双性')],
    },
  ]);
  assert.deepEqual(result.species[0].biological_types.map(type => type.name), ['男性', '女性']);

  const noEvidence = await analyzeDescription('普通人类资料不存在男性和女性；其性别不确定。', [
    {
      name: '人类',
      biological_types: [typeFixture('男性'), typeFixture('女性'), typeFixture('双性')],
    },
  ]);
  assert.deepEqual(noEvidence.species[0].biological_types, []);
});

test('World Model analysis does not treat a temporary conversion as fixed dual evidence', async () => {
  const result = await analyzeDescription('普通人类角色原本为男性；角色可以转为双性，持续时间只有三天。', [
    {
      name: '人类',
      biological_types: [typeFixture('男性'), typeFixture('双性')],
    },
  ]);
  assert.deepEqual(result.species[0].biological_types.map(type => type.name), ['男性']);
});

test('World Model analysis keeps fixed dual evidence when its mechanisms remain unknown', async () => {
  const result = await analyzeDescription('普通人类世界明确存在双性个体，但其具体生育能力可能未知。', [
    {name: '人类', biological_types: [typeFixture('双性')]},
  ]);
  assert.deepEqual(result.species[0].biological_types.map(type => type.name), ['双性']);
});

test('World Model analysis rejects uncertain dual existence', async () => {
  const result = await analyzeDescription('普通人类资料可能有双性个体，但没有确认。', [
    {name: '人类', biological_types: [typeFixture('双性')]},
  ]);
  assert.deepEqual(result.species[0].biological_types, []);
});

test('World Model analysis removes temporary dualization from types and unknowns but keeps the rule', async () => {
  const result = await analyzeDescription(
    '普通人类角色原本是男性，金丹可以双性化，持续一至三天。',
    [{
      name: '人类',
      biological_types: [
        typeFixture('男性', {special_rules: ['金丹可以双性化，持续一至三天。']}),
        typeFixture('双性'),
      ],
    }],
    ['双性化持续时间未知', '双性个体的能力未知'],
  );
  assert.deepEqual(result.species[0].biological_types.map(type => type.name), ['男性']);
  assert.deepEqual(result.species[0].biological_types[0].special_rules, ['金丹可以双性化，持续一至三天。']);
  assert.deepEqual(result.unknowns, ['双性化持续时间未知']);
});

test('World Model analysis removes individual ambiguity and observed non-biological aliases', async () => {
  const result = await analyzeDescription('普通人类某人物性别模糊；镜生体性别基本为男性，极少数镜生体为女性。', [
    {name: '人类', biological_types: [typeFixture('性别模糊')]},
    {name: '晶巢种', biological_types: [typeFixture('晶巢种族'), typeFixture('晶巢种分支')]},
    {name: '绒核族', biological_types: [typeFixture('绒核族身份')]},
    {
      name: '镜生体',
      biological_types: [
        typeFixture('男性镜生体'),
        typeFixture('女性镜生体'),
        typeFixture('晶巢镜生体'),
        typeFixture('绒核镜生体'),
      ],
    },
  ]);
  assert.deepEqual(result.species.map(species => species.name), ['人类', '镜生体']);
  assert.deepEqual(result.species.find(species => species.name === '人类').biological_types, []);
  assert.deepEqual(result.species.find(species => species.name === '镜生体').biological_types.map(type => type.name), ['男性', '女性']);
});

test('World Model analysis preserves open ABO names without inventing sex combinations', async () => {
  const result = await analyzeDescription('普通人类世界规则明确存在 Alpha、Beta、Omega 三类生殖分类。', [
    {
      name: '人类',
      biological_types: [
        typeFixture('Alpha', {capabilities: {}}),
        typeFixture('Beta', {capabilities: {}}),
        typeFixture('Omega', {capabilities: {}}),
      ],
    },
  ]);
  assert.deepEqual(result.species[0].biological_types.map(type => type.name), ['Alpha', 'Beta', 'Omega']);
  assert.equal(result.species[0].biological_types.some(type => ['男性', '女性', '双性'].includes(type.name)), false);
  assert.ok(result.species[0].biological_types.every(type => Object.values(type.capabilities).every(value => value === null)));
});

test('World Model analysis keeps non-human female mechanisms unknown without evidence', async () => {
  const result = await analyzeDescription('资料明确存在女性镜生体，但没有说明其生殖机制。', [
    {
      name: '镜生体',
      biological_types: [typeFixture('女性')],
    },
  ]);
  const type = result.species[0].biological_types[0];
  assert.equal(type.name, '女性');
  assert.deepEqual(type.capabilities, {
    can_produce_sperm: null,
    can_produce_ova: null,
    can_be_fertilized: null,
    can_fertilize: null,
    can_carry_pregnancy: null,
  });
  assert.deepEqual(type.reproduction_rules, {
    fertilization: null,
    pregnancy_or_carrying: null,
    cycle: null,
    ovulation: null,
    gestation: null,
    labor: null,
  });
});

test('World Model analysis keeps only explicitly evidenced non-human capabilities', async () => {
  const result = await analyzeDescription('晶巢种女性能够产生卵细胞，但不能承担妊娠。', [
    {name: '晶巢种', biological_types: [typeFixture('女性')]},
  ]);
  assert.deepEqual(result.species[0].biological_types[0].capabilities, {
    can_produce_sperm: null,
    can_produce_ova: true,
    can_be_fertilized: null,
    can_fertilize: null,
    can_carry_pregnancy: false,
  });
});

test('World Model analysis does not leak human sex evidence into non-human species', async () => {
  const result = await analyzeInput({
    character: {description: '人类资料明确出现男性和女性。晶巢种：只确认存在这个物种，未说明性别分类。绒核族：只确认存在这个物种，未说明性别分类。'},
  }, [
    {name: '人类', biological_types: [typeFixture('男性'), typeFixture('女性'), typeFixture('Alpha')]},
    {name: '晶巢种', biological_types: [typeFixture('男性'), typeFixture('女性')]},
    {name: '绒核族', biological_types: [typeFixture('男性'), typeFixture('女性')]},
  ], ['晶巢种男性的具体机制未知', '晶巢种的生殖机制未知']);

  assert.deepEqual(result.species[0].biological_types.map(type => type.name), ['男性', '女性']);
  assert.deepEqual(result.species.slice(1).map(species => species.biological_types), [[], []]);
  assert.deepEqual(result.unknowns, ['晶巢种的生殖机制未知']);
});

test('World Model analysis keeps an arbitrary fantasy species empty without type evidence', async () => {
  const result = await analyzeDescription('资料明确存在星尘生物这一生命种类，但没有说明其性别或生殖分类。', [
    {name: '星尘生物', biological_types: [typeFixture('男性'), typeFixture('女性')]},
  ]);

  assert.deepEqual(result.species[0].biological_types, []);
});

test('World Model analysis keeps arbitrary non-human male and female capabilities unknown', async () => {
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
            can_carry_pregnancy: true,
          },
        }),
        typeFixture('女性', {
          capabilities: {
            can_produce_sperm: true,
            can_produce_ova: true,
            can_be_fertilized: true,
            can_fertilize: true,
            can_carry_pregnancy: true,
          },
        }),
      ],
    },
  ]);

  assert.deepEqual(result.species[0].biological_types.map(type => type.capabilities), [
    {
      can_produce_sperm: null,
      can_produce_ova: null,
      can_be_fertilized: null,
      can_fertilize: null,
      can_carry_pregnancy: null,
    },
    {
      can_produce_sperm: null,
      can_produce_ova: null,
      can_be_fertilized: null,
      can_fertilize: null,
      can_carry_pregnancy: null,
    },
  ]);
});

test('World Model analysis rejects exact and generic-suffix parent type duplicates', async () => {
  const result = await analyzeDescription('资料明确存在雾生体这一生命种类。', [
    {
      name: '雾生体',
      biological_types: [typeFixture('雾生体'), typeFixture('雾生体族'), typeFixture('人')],
    },
  ]);

  assert.deepEqual(result.species[0].biological_types, []);
});

test('World Model analysis does not treat interaction text as fertilization', async () => {
  const result = await analyzeDescription('星海生物男性会性交、双修和补灵，但没有描述受精机制。', [
    {
      name: '星海生物',
      biological_types: [typeFixture('男性', {
        reproduction_rules: {fertilization: '性交、双修和补灵。'},
      })],
    },
  ]);

  assert.equal(result.species[0].biological_types[0].reproduction_rules.fertilization, null);
});

test('World Model analysis preserves a directly evidenced rule when capability is unknown', async () => {
  const result = await analyzeDescription('星海生物男性的受精机制是体内配子结合，但具体能力细节未知。', [
    {
      name: '星海生物',
      biological_types: [typeFixture('男性', {
        capabilities: {
          can_produce_sperm: null,
          can_produce_ova: null,
          can_be_fertilized: null,
          can_fertilize: null,
          can_carry_pregnancy: null,
        },
        reproduction_rules: {fertilization: '体内配子结合。'},
      })],
    },
  ]);

  const type = result.species[0].biological_types[0];
  assert.equal(type.capabilities.can_fertilize, null);
  assert.equal(type.reproduction_rules.fertilization, '体内配子结合。');
});

test('World Model analysis keeps arbitrary species sex types from deterministic semantic evidence', async () => {
  const result = await analyzeDescription('镜生体性别基本都为男性，极少数镜生体为女性。', [
    {name: '镜生体', biological_types: [typeFixture('男性'), typeFixture('女性')]},
  ]);

  assert.deepEqual(result.species[0].biological_types.map(type => type.name), ['男性', '女性']);
  assert.ok(result.species[0].biological_types.every(type => Object.values(type.capabilities).every(value => value === null)));
});

test('World Model analysis does not treat unrelated partners or individual labels as species types', async () => {
  const result = await analyzeDescription('晶巢种会与男人交配，也会与人类女性性交；某个镜生体角色是男性。', [
    {name: '晶巢种', biological_types: [typeFixture('女性')]},
    {name: '镜生体', biological_types: [typeFixture('男性')]},
  ]);
  assert.deepEqual(result.species.map(species => species.biological_types), [[], []]);
});

test('World Model analysis keeps only directly evidenced non-human fields', async () => {
  const result = await analyzeDescription('晶巢种男性会产生精液；晶巢种男性存在发情期；晶巢种男性寿命通常为六百年。', [
    {
      name: '晶巢种',
      biological_types: [typeFixture('男性', {
        capabilities: {
          can_produce_sperm: true,
          can_produce_ova: false,
          can_be_fertilized: false,
          can_fertilize: true,
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
        lifecycle: {maturation: '达到成年后成熟。', aging: '寿命通常为六百年。'},
        special_rules: ['晶巢种男性存在发情期。', '成结用于提高受精成功率。'],
      })],
    },
  ]);
  const type = result.species[0].biological_types[0];

  assert.deepEqual(type.capabilities, {
    can_produce_sperm: true,
    can_produce_ova: null,
    can_be_fertilized: null,
    can_fertilize: null,
    can_carry_pregnancy: null,
  });
  assert.deepEqual(type.reproduction_rules, {
    fertilization: null,
    pregnancy_or_carrying: null,
    cycle: '存在发情期。',
    ovulation: null,
    gestation: null,
    labor: null,
  });
  assert.deepEqual(type.lifecycle, {maturation: null, aging: '寿命通常为六百年。'});
  assert.deepEqual(type.special_rules, ['晶巢种男性存在发情期。']);
});

test('World Model analysis does not widen a single type with species-level evidence', async () => {
  const result = await analyzeDescription('晶巢种存在甲型；晶巢种的体液会结晶，但没有说明该规则属于甲型。', [
    {
      name: '晶巢种',
      biological_types: [typeFixture('甲型', {
        capabilities: {
          can_produce_sperm: true,
          can_produce_ova: false,
          can_be_fertilized: true,
          can_fertilize: true,
          can_carry_pregnancy: false,
        },
        reproduction_rules: {fertilization: '体液结晶会触发生殖。'},
        special_rules: ['晶巢种的体液会结晶。'],
      })],
    },
  ]);
  const type = result.species[0].biological_types[0];
  assert.equal(type.name, '甲型');
  assert.deepEqual(type.capabilities, {
    can_produce_sperm: null,
    can_produce_ova: null,
    can_be_fertilized: null,
    can_fertilize: null,
    can_carry_pregnancy: null,
  });
  assert.deepEqual(type.reproduction_rules, {
    fertilization: null,
    pregnancy_or_carrying: null,
    cycle: null,
    ovulation: null,
    gestation: null,
    labor: null,
  });
  assert.deepEqual(type.special_rules, []);
});

test('World Model analysis keeps reversible body changes out of fixed types for original species', async () => {
  const result = await analyzeDescription('澜壳体存在定常型；某角色可以暂时变为双性状态，结束后恢复原状。', [
    {
      name: '澜壳体',
      biological_types: [typeFixture('定常型'), typeFixture('双性')],
    },
  ]);

  assert.deepEqual(result.species[0].biological_types.map(type => type.name), ['定常型']);
});

test('World Model analysis rejects parent-name suffix types for original species', async () => {
  const result = await analyzeDescription('雾棱群明确存在雾棱群族这一分类名称，但没有其它稳定生殖类型资料。', [
    {
      name: '雾棱群',
      biological_types: [typeFixture('雾棱群族'), typeFixture('雾棱群')],
    },
  ]);

  assert.deepEqual(result.species[0].biological_types, []);
});

test('World Model analysis keeps non-fertilization interaction null for original species', async () => {
  const result = await analyzeDescription('回声囊体存在共鸣型；共鸣型会性交并交换能量，促进个体生成，但资料没有受精机制。', [
    {
      name: '回声囊体',
      biological_types: [typeFixture('共鸣型', {
        reproduction_rules: {fertilization: '性交并交换能量，促进个体生成。'},
      })],
    },
  ]);

  assert.equal(result.species[0].biological_types[0].reproduction_rules.fertilization, null);
});

test('World Model analysis keeps original non-human sex labels from Human capabilities', async () => {
  const claimedCapabilities = {
    can_produce_sperm: true,
    can_produce_ova: true,
    can_be_fertilized: true,
    can_fertilize: true,
    can_carry_pregnancy: true,
  };
  const result = await analyzeDescription('浮芯体稳定分为男性和女性，但没有说明其生殖能力。', [
    {
      name: '浮芯体',
      biological_types: [
        typeFixture('男性', {capabilities: claimedCapabilities}),
        typeFixture('女性', {capabilities: claimedCapabilities}),
      ],
    },
  ]);

  assert.deepEqual(result.species[0].biological_types.map(type => type.name), ['男性', '女性']);
  assert.ok(result.species[0].biological_types.every(type => (
    Object.values(type.capabilities).every(value => value === null)
  )));
});

test('World Model analysis does not classify progression as biological maturation for original species', async () => {
  const result = await analyzeDescription('阶纹生物存在阶序型；阶序型通过修炼等级提升和力量进阶完成 progression。', [
    {
      name: '阶纹生物',
      biological_types: [typeFixture('阶序型', {
        lifecycle: {maturation: '修炼等级达到九阶。', aging: '力量进阶持续进行。'},
      })],
    },
  ]);

  assert.deepEqual(result.species[0].biological_types[0].lifecycle, {
    maturation: null,
    aging: null,
  });
});

test('World Model analysis preserves explicit negative non-human capability evidence', async () => {
  const result = await analyzeDescription('晶巢种男性不能产生精子，也不能被受精。', [
    {name: '晶巢种', biological_types: [typeFixture('男性')]},
  ]);
  assert.equal(result.species[0].biological_types[0].capabilities.can_produce_sperm, false);
  assert.equal(result.species[0].biological_types[0].capabilities.can_be_fertilized, false);
  assert.equal(result.species[0].biological_types[0].capabilities.can_fertilize, null);
});

test('World Model analysis keeps absent or pseudo-pregnancy evidence unknown', async () => {
  const result = await analyzeDescription('女性镜生体没有证据证明可以怀孕；仅存在假孕现象，无实际妊娠记录。', [
    {name: '镜生体', biological_types: [typeFixture('女性')]},
  ]);
  assert.deepEqual(result.species[0].biological_types[0].capabilities, {
    can_produce_sperm: null,
    can_produce_ova: null,
    can_be_fertilized: null,
    can_fertilize: null,
    can_carry_pregnancy: null,
  });
});

test('World Model analysis accepts field-local explicit non-human inability', async () => {
  const result = await analyzeDescription('女性镜生体不能怀孕，也无法被受精。', [
    {name: '镜生体', biological_types: [typeFixture('女性')]},
  ]);
  assert.deepEqual(result.species[0].biological_types[0].capabilities, {
    can_produce_sperm: null,
    can_produce_ova: null,
    can_be_fertilized: false,
    can_fertilize: null,
    can_carry_pregnancy: false,
  });
});

test('World Model analysis applies only the named human-equivalence field to non-human types', async () => {
  const result = await analyzeDescription('女性镜生体的妊娠规律与人类相同。', [
    {
      name: '镜生体',
      biological_types: [typeFixture('女性', {
        capabilities: {
          can_produce_sperm: false,
          can_produce_ova: true,
          can_be_fertilized: true,
          can_fertilize: false,
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
      })],
    },
  ]);
  const type = result.species[0].biological_types[0];

  assert.deepEqual(type.capabilities, {
    can_produce_sperm: null,
    can_produce_ova: null,
    can_be_fertilized: null,
    can_fertilize: null,
    can_carry_pregnancy: true,
  });
  assert.deepEqual(type.reproduction_rules, {
    fertilization: null,
    pregnancy_or_carrying: '按人类方式妊娠。',
    cycle: null,
    ovulation: null,
    gestation: '约40周。',
    labor: null,
  });
});

test('World Model final guard separates human male and female reproduction baselines', async () => {
  const result = await analyzeDescription('资料明确存在人类男性和女性。', [{
    name: '人类',
    biological_types: [
      typeFixture('男性', {
        capabilities: {
          can_produce_sperm: true,
          can_produce_ova: false,
          can_be_fertilized: false,
          can_fertilize: true,
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
  }]);
  const [male, female] = result.species[0].biological_types;

  assert.deepEqual(male.reproduction_rules, {
    fertilization: '通过精子使卵细胞受精。',
    pregnancy_or_carrying: null,
    cycle: null,
    ovulation: null,
    gestation: null,
    labor: null,
  });
  assert.deepEqual(female.reproduction_rules, {
    fertilization: '卵细胞可被精子受精。',
    pregnancy_or_carrying: '可以承担妊娠。',
    cycle: '通常约28天一个周期。',
    ovulation: '通常每个周期排卵。',
    gestation: '通常约40周。',
    labor: '通过分娩完成生产。',
  });
});

test('World Model final guard clears non-human rules blocked by false capabilities', async () => {
  const result = await analyzeDescription(
    '潮汐生物男性不能怀孕，但规则记载妊娠约40周和分娩产程；潮汐生物男性不能产生卵子，但记录会排卵；潮汐生物男性存在发情期和体内受精规则。',
    [{
      name: '潮汐生物',
      biological_types: [typeFixture('男性', {
        capabilities: {
          can_produce_sperm: null,
          can_produce_ova: null,
          can_be_fertilized: null,
          can_fertilize: null,
          can_carry_pregnancy: null,
        },
        reproduction_rules: {
          fertilization: '体内受精',
          pregnancy_or_carrying: '可以妊娠。',
          cycle: '存在发情期。',
          ovulation: '会排卵。',
          gestation: '约40周。',
          labor: '分娩产程。',
        },
      })],
    }],
  );
  const type = result.species[0].biological_types[0];

  assert.equal(type.capabilities.can_produce_ova, false);
  assert.equal(type.capabilities.can_carry_pregnancy, false);
  assert.equal(type.reproduction_rules.fertilization, '体内受精');
  assert.equal(type.reproduction_rules.pregnancy_or_carrying, null);
  assert.equal(type.reproduction_rules.cycle, '存在发情期。');
  assert.equal(type.reproduction_rules.ovulation, null);
  assert.equal(type.reproduction_rules.gestation, null);
  assert.equal(type.reproduction_rules.labor, null);
});

test('World Model final guard clears only conflicting fertilization roles', async () => {
  const result = await analyzeDescription('资料明确存在人类男性和女性；人类男性不能被受精，但其受精规则是卵细胞可在生殖道内被精子受精；人类女性不能使卵细胞受精，但其受精规则是通过精子使卵细胞受精。', [{
    name: '人类',
    biological_types: [
      typeFixture('男性', {
        capabilities: {
          can_produce_sperm: true,
          can_produce_ova: false,
          can_be_fertilized: false,
          can_fertilize: true,
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
          can_carry_pregnancy: true,
        },
        reproduction_rules: {
          fertilization: '通过精子使卵细胞受精。',
        },
      }),
    ],
  }]);
  const [male, female] = result.species[0].biological_types;

  assert.equal(male.reproduction_rules.fertilization, null);
  assert.equal(female.reproduction_rules.fertilization, null);
});

test('World Model final guard keeps evidence-backed rules when capabilities are unknown', async () => {
  const result = await analyzeDescription('潮汐生物男性存在体内受精规则，但该类型的具体能力未说明。', [{
    name: '潮汐生物',
    biological_types: [typeFixture('男性', {
      capabilities: {
        can_produce_sperm: null,
        can_produce_ova: null,
        can_be_fertilized: null,
        can_fertilize: null,
        can_carry_pregnancy: null,
      },
      reproduction_rules: {
        fertilization: '体内受精',
      },
    })],
  }]);
  const type = result.species[0].biological_types[0];

  assert.deepEqual(type.capabilities, {
    can_produce_sperm: null,
    can_produce_ova: null,
    can_be_fertilized: null,
    can_fertilize: null,
    can_carry_pregnancy: null,
  });
  assert.equal(type.reproduction_rules.fertilization, '体内受精');
});

test('World Model Human baseline yields only the established female type', async () => {
  const result = await analyzeDescription('普通人类资料明确说明角色为女性。', [
    {name: '人类', biological_types: [typeFixture('女性'), typeFixture('男性')]},
  ]);
  const [type] = result.species[0].biological_types;
  assert.equal(type.name, '女性');
  assert.deepEqual(type.capabilities, {
    can_produce_sperm: false,
    can_produce_ova: true,
    can_be_fertilized: true,
    can_fertilize: false,
    can_carry_pregnancy: true,
  });
  assert.deepEqual(type.reproduction_rules, {
    fertilization: '卵细胞可被精子受精。',
    pregnancy_or_carrying: '可以承担妊娠。',
    cycle: '通常约28天一个周期。',
    ovulation: '通常每个周期排卵。',
    gestation: '通常约40周。',
    labor: '通过分娩完成生产。',
  });
});

test('World Model Human world rules override the ordinary baseline', async () => {
  const result = await analyzeDescription('普通人类世界规则明确：人类男性可以承担妊娠。', [
    {name: '人类', biological_types: [typeFixture('男性', {
      capabilities: {
        can_produce_sperm: true,
        can_produce_ova: false,
        can_be_fertilized: false,
        can_fertilize: true,
        can_carry_pregnancy: true,
      },
      reproduction_rules: {pregnancy_or_carrying: '该世界男性可以承担妊娠。'},
    })]},
  ]);
  const type = result.species[0].biological_types[0];
  assert.equal(type.capabilities.can_carry_pregnancy, true);
  assert.equal(type.reproduction_rules.pregnancy_or_carrying, '该世界男性可以承担妊娠。');
});

test('World Analysis request uses ordinary chat messages for current and independent APIs', async () => {
  const analysisInput = {
    persona: {name: '用户甲', description: '用户人物设定私密内容，不应发送'},
    character: {description: '只作为输入证据 {{user}}；潮汐生物存在潮汐生物型'},
    worldbooks: [{source_id: 'book-1', name: '内部书名不应发送', entries: [{entry_id: 'entry-1', label: '内部条目名不应发送', token_estimate: 8, content: '规则证据 {{user}}'}]}],
    recent_story: {enabled: true, items: [{floor: 81, role: 'assistant', content: '楼层证据 {{user}}'}]},
    external_memory: [],
    meta: {chat_id: 'chat-a', user_name: '用户甲', character_name: '角色甲'},
  };
  const requests = [];
  const expectedModel = structuredClone(modelFixture);
  expectedModel.species[0].biological_types[0].capabilities = {
    can_produce_sperm: null,
    can_produce_ova: null,
    can_be_fertilized: null,
    can_fertilize: null,
    can_carry_pregnancy: null,
  };
  expectedModel.species[0].biological_types[0].reproduction_rules = {
    fertilization: null,
    pregnancy_or_carrying: null,
    cycle: null,
    ovulation: null,
    gestation: null,
    labor: null,
  };
  expectedModel.species[0].biological_types[0].lifecycle = {maturation: null, aging: null};
  expectedModel.species[0].biological_types[0].special_rules = [];
  const cases = [
    {
      profile: SILLYTAVERN_CURRENT_API,
      context: {
        generateRaw({prompt}) {
          requests.push({api: 'current', messages: prompt});
          return JSON.stringify(modelFixture);
        },
      },
    },
    {
      profile: {api_url: 'https://api.example/v1', model: 'model-a'},
      context: {
        ChatCompletionService: {
          processRequest(payload) {
            requests.push({api: 'independent', messages: payload.messages});
            return {content: JSON.stringify(modelFixture)};
          },
        },
      },
    },
  ];

  for (const item of cases) {
    const analyzer = createAnalyzer({
      profileResolver: () => item.profile,
      contextResolver: () => item.context,
    });
    const result = await analyzer.analyzeWorldModel({analysisInput});
    assert.deepEqual(result, expectedModel);
  }

  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.deepEqual(request.messages.map(message => message.role), ['system', 'system', 'assistant', 'user']);
    assert.ok(request.messages.every(message => typeof message.content === 'string' && message.content.trim()));
    assert.doesNotMatch(JSON.stringify(request.messages), /```|<json>|JSON 格式/i);
    assert.match(request.messages[1].content, /【角色甲 的资料】/);
    assert.match(request.messages[1].content, /【世界书】/);
    assert.match(request.messages[1].content, /规则证据 用户甲/);
    assert.doesNotMatch(JSON.stringify(request.messages), /用户人物设定私密内容| 的人物设定/);
    assert.doesNotMatch(request.messages[1].content, /source_id|entry_id|token_estimate|内部书名不应发送|内部条目名不应发送/);
    assert.match(request.messages[2].content, /楼层证据 用户甲/);
    assert.doesNotMatch(request.messages[2].content, /【楼层信息】|Floor 81|\[assistant\]/);
    assert.match(request.messages[3].content, /World Model/);
  }
});

test('World Analysis prompt blocks can be edited without sending format tags', () => {
  const messages = buildWorldModelMessages({
    persona: {name: '用户乙', description: '用户人物设定私密内容，不应发送'},
    character: {description: '角色证据 {{user}}'},
    worldbooks: [{source_id: 'book-1', name: '书名不进入发送内容', entries: [{entry_id: 'entry-1', token_estimate: 4, content: '世界书证据'}]}],
    recent_story: {items: [{floor: 3, role: 'assistant', content: '楼层内容'}]},
    meta: {user_name: '用户乙', character_name: '角色乙'},
  }, {
    task: '只分析生物能力，不讨论其它主题，称呼 {{user}}。',
    input_prefix: '用户自定义资料前言。',
    input_suffix: '用户自定义资料后记。',
    labels: {character: '角色资料'},
  });
  assert.deepEqual(messages.map(message => message.role), ['system', 'system', 'assistant', 'user']);
  assert.match(messages[0].content, /只分析生物能力/);
  assert.match(messages[0].content, /称呼 用户乙/);
  assert.match(messages[1].content, /用户自定义资料前言/);
  assert.match(messages[1].content, /【角色乙 的资料】/);
  assert.match(messages[1].content, /【角色资料】/);
  assert.match(messages[1].content, /世界书证据/);
  assert.match(messages[1].content, /用户自定义资料后记/);
  assert.doesNotMatch(JSON.stringify(messages), /用户人物设定私密内容| 的人物设定/);
  assert.doesNotMatch(messages[1].content, /source_id|entry_id|token_estimate|书名不进入发送内容/);
  assert.match(messages[2].content, /楼层内容/);
  assert.doesNotMatch(messages[2].content, /【楼层信息】|Floor 3|\[assistant\]/);
  assert.match(messages[3].content, /World Model/);
  assert.equal(messages.some(message => /```|<json>|JSON 格式/i.test(message.content)), false);
  assert.match(buildWorldModelPrompt({character: {description: '普通资料'}}), /AnalysisInput/);
});

test('World Model prompt distinguishes unknown non-human rules from the identified human baseline', () => {
  const messages = buildWorldModelMessages({
    character: {description: '角色性别为女性，但资料没有说明其物种；个人例外是妊娠时间不同。'},
    worldbooks: [{entries: [{content: '当前世界医疗条件：城市有产科医院和急救设施；人类妊娠规则为三个月。'}]}],
  });
  const prompt = messages[0].content;
  assert.match(prompt, /人类/);
  assert.match(prompt, /已经被资料支持的“男性”或“女性”可以使用对应的普通现实人类 baseline/);
  assert.match(prompt, /baseline 不创建缺失类型/);
  assert.match(prompt, /明确剧情事实 > 明确世界\/世界书规则 > 明确个人例外 > 普通人类 baseline/);
  assert.match(prompt, /species → biological_types/);
  assert.match(prompt, /不从 biological_type 名称套用 Human template/);
  assert.match(prompt, /该 species 和该 type 的直接证据/);
  assert.match(prompt, /未说明、未知或仅凭“通常\/一般”不足以判断时写 null/);
  assert.match(prompt, /fertilization/);
  assert.match(prompt, /medical_context/);
  assert.doesNotMatch(prompt, /妖|魔|剑灵|精灵|兽人|极少女剑灵/);
  assert.match(messages[1].content, /当前世界医疗条件：城市有产科医院和急救设施；人类妊娠规则为三个月/);
  assert.match(prompt, /childbirth_difficulty、care_level、evidence/);
});

test('World Model prompt keeps the Human fallback bounded and generic', () => {
  const messages = buildWorldModelMessages({
    character: {description: '资料只呈现默认男性/女性二元，没有明确非人类证据。'},
  });
  const prompt = messages[0].content;
  assert.match(prompt, /只有当前资料支持普通人类背景时才建立“人类”/);
  assert.match(prompt, /baseline 不创建缺失类型/);
  assert.match(prompt, /只使用资料实际支持的内容，不把模型常识补写成 species、biological_type/);
  assert.doesNotMatch(prompt, /妖|魔|剑灵|精灵|兽人|极少女剑灵/);
});

test('World Model prompt distinguishes fixed dual evidence from temporary dualization', () => {
  const messages = buildWorldModelMessages({
    character: {description: '明确证据：角色本身是双性，并明确可产生精子；也可以短暂双性化。'},
  });
  const prompt = messages[0].content;
  assert.match(prompt, /固定生殖分类必须由资料支持/);
  assert.match(prompt, /临时、可逆或条件性的性征、器官或生殖能力变化.*不能建立新的 biological_type/);
  assert.match(prompt, /固定双性统一使用名称“双性”/);
  assert.match(messages[1].content, /角色本身是双性/);
  assert.match(prompt, /明确支持才写 true\/false/);
  assert.match(prompt, /未说明、未知或仅凭“通常\/一般”不足以判断时写 null/);
});

test('World Model prompt rejects dual types inferred from default male/female input', () => {
  const messages = buildWorldModelMessages({
    character: {description: '资料只呈现默认男性/女性二元，没有其它生殖类型描述。'},
  });
  const prompt = messages[0].content;
  assert.match(prompt, /biological_type\.name 都是开放字符串/);
  assert.match(prompt, /证据不足时保留 biological_types: \[\]/);
  assert.doesNotMatch(prompt, /默认人类基础类型包含男性、女性和双性/);
  assert.match(messages[1].content, /资料只呈现默认男性\/女性二元/);
  assert.doesNotMatch(messages[1].content, /固定双性分类/);
});

test('World Model prompt states the complete generic field semantic contract', () => {
  const prompt = buildWorldModelMessages()[0].content;

  assert.match(prompt, /该 species 内稳定存在的性别、生殖角色或直接影响生殖机制/);
  assert.match(prompt, /species、亚种、血统、职业、身份、阵营、来源、属性、等级、形态/);
  assert.match(prompt, /证据不足时保留 biological_types: \[\]/);
  assert.match(prompt, /五个 capability 逐字段独立举证/);
  assert.match(prompt, /true 需要明确具备证据、false 需要明确不具备证据/);
  assert.match(prompt, /未说明、未知或仅凭“通常\/一般”不足以判断时写 null/);
  assert.match(prompt, /性交、体液\/能量交换、感染\/寄生、侵蚀\/异化/);
  assert.match(prompt, /lifecycle\.maturation 只描述生物成熟或生命阶段变化/);
  assert.match(prompt, /职业、修炼、技能、关系或力量 progression 不属于生命周期/);
  assert.match(prompt, /临时、可逆或条件性的性征、器官或生殖能力变化/);
  assert.match(prompt, /输出前进行内部自检（不要输出过程）/);
  assert.match(prompt, /没有可靠答案就把字段降为 null 或删除错误 type/);
  assert.doesNotMatch(prompt, /妖|魔|剑灵|精灵|兽人|极少女剑灵/);
});

test('World Model prompt requires Chinese string values and human type names', () => {
  const prompt = buildWorldModelMessages()[0].content;
  assert.match(prompt, /JSON key 使用 schema 规定的英文/);
  assert.match(prompt, /说明、规则和列表字符串使用中文/);
  assert.match(prompt, /species\[\] 包含 name、description、biological_types\[\]/);
  assert.match(prompt, /每个 biological_type 包含 name、description、capabilities、reproduction_rules、lifecycle、special_rules/);
  assert.match(prompt, /biological_type\.name 都是开放字符串/);
  assert.match(prompt, /固定包含五个 key/);
  assert.match(prompt, /reproduction_rules 固定包含 fertilization、pregnancy_or_carrying、cycle、ovulation、gestation、labor/);
  assert.doesNotMatch(prompt, /妖|魔|剑灵|精灵|兽人|Homo sapiens|极少女剑灵/);
});

test('settings debug preview groups the actual World Model messages by role', () => {
  const html = settingsPage({
    analysisPreview: {
      input: {
        persona: {name: '用户丙', description: '用户丙的人物设定'},
        character: {description: '角色预览'},
        worldbooks: [{source_id: 'book-1', name: '书名', entries: [{entry_id: 'entry-1', content: '世界书预览'}]}],
        recent_story: {items: [{floor: 7, role: 'assistant', content: '楼层预览'}]},
        external_memory: [],
        meta: {user_name: '用户丙', character_name: '角色丙'},
      },
    },
  });
  assert.match(html, /SYSTEM/);
  assert.match(html, /assistant/);
  assert.match(html, /USER/);
  assert.doesNotMatch(html, /用户丙的人物设定/);
  assert.match(html, /【角色丙 的资料】/);
  assert.match(html, /楼层预览/);
  assert.equal((html.match(/<details class="bioweave-world-model-message"/g) ?? []).length, 4);
  assert.equal((html.match(/data-bioweave-world-model-message-role=/g) ?? []).length, 4);
  assert.match(html, /<details class="bioweave-world-model-message"[^>]*data-bioweave-world-model-message-role="system"/);
  assert.match(html, /<summary><strong>SYSTEM<\/strong>/);
  assert.match(html, /<summary><strong>ASSISTANT<\/strong>/);
  assert.match(html, /<summary><strong>USER<\/strong>/);
  assert.equal(html.includes('bioweave-analysis-preview-groups'), false);
});

test('AnalysisInput carries current SillyTavern names for request placeholder replacement', () => {
  const input = buildAnalysisInput({
    context: {chatId: 'chat-names', name1: '当前用户设定', name2: '当前角色卡'},
    chatId: 'chat-names',
  });
  assert.equal(input.meta.user_name, '当前用户设定');
  assert.equal(input.meta.character_name, '当前角色卡');
  const messages = buildWorldModelMessages({
    ...input,
    character: {description: '<user> 与 {{char}} 的资料'},
  });
  assert.match(messages[1].content, /当前用户设定 与 当前角色卡 的资料/);
});

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
  });

  assert.deepEqual(input.persona, {
    name: '当前人物设定名称',
    description: '用户人物设定：偏好在夜间活动。',
  });
  assert.equal(input.meta.user_name, '当前人物设定名称');
  const messages = buildWorldModelMessages(input);
  assert.doesNotMatch(JSON.stringify(messages), /用户人物设定：偏好在夜间活动。/);
  assert.doesNotMatch(JSON.stringify(messages), / 的人物设定/);
});

test('World Model request failure leaves the previous model untouched', async () => {
  const previousModel = structuredClone(modelFixture);
  let currentModel = previousModel;
  const analyzer = createAnalyzer({
    profileResolver: () => SILLYTAVERN_CURRENT_API,
    contextResolver: () => ({
      generateRaw() {
        throw new Error('API_BAD_REQUEST');
      },
    }),
  });

  await assert.rejects(analyzer.analyzeWorldModel({analysisInput: {}}), /API_BAD_REQUEST/);
  assert.deepEqual(currentModel, previousModel);
});

test('AnalysisInput summary stores counts only, never source正文', () => {
  const summary = summarizeAnalysisInput({
    persona: {name: '用户', description: '用户秘密人物设定'},
    character: {description: '秘密正文', greetings: [{content: '备用开场白'}]},
    worldbooks: [{source_id: 'book-1', entries: [{entry_id: 'entry-1', content: '世界书正文'}]}],
    recent_story: {enabled: true, floor_count: 2, floor_start: 8, floor_end: 9, items: [{content: '剧情正文'}]},
    external_memory: [{key: 'anima', label: 'Anima', status: '读取成功', items: [{content: '记忆正文'}]}],
    token_estimate: 42,
  });
  assert.equal(summary.character_fields, 2);
  assert.equal(summary.worldbook_entries, 1);
  assert.equal(summary.token_estimate, 42);
  assert.equal(JSON.stringify(summary).includes('秘密正文'), false);
  assert.equal(JSON.stringify(summary).includes('用户秘密人物设定'), false);
  assert.equal(JSON.stringify(summary).includes('世界书正文'), false);
  assert.equal(JSON.stringify(summary).includes('剧情正文'), false);
  assert.equal(JSON.stringify(summary).includes('记忆正文'), false);
});

test('World Model external memory uses the neutral history memory heading', () => {
  const messages = buildWorldModelMessages({
    external_memory: [{
      key: 'anima',
      label: 'Anima',
      items: [{label: '记忆文件', content: '历史事件摘要'}],
    }],
  });
  assert.match(messages[1].content, /【历史事件记忆库】/);
  assert.match(messages[1].content, /以下是对话过程中自动生成的客观摘要/);
  assert.doesNotMatch(messages[1].content, /【Anima】/);
});

test('World Model page uses Chinese labels and shows null as 未知', () => {
  const html = worldPage({
    worldModel: modelFixture,
    worldModelMeta: {
      last_analyzed_at: '2026-09-07T00:00:00.000Z',
      last_saved_at: '2026-09-07T00:00:00.000Z',
      last_saved_by: 'ai',
      source_summary: {character_fields: 1, worldbooks: 1, worldbook_entries: 1, token_estimate: 3},
    },
  });
  assert.match(html, /世界模型/);
  assert.match(html, /bioweave-world-model-top/);
  assert.match(html, /最后分析：<\/strong>\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}/);
  assert.match(html, /来源：<\/strong>角色卡 · 1 本世界书/);
  assert.doesNotMatch(html, /角色卡 1 项|条目|令牌|最后保存|AI 分析/);
  assert.match(html, /物种与生物类型/);
  assert.match(html, /当前世界中已识别的物种及其生物类型/);
  assert.match(html, /bioweave-world-model-content-grid/);
  assert.match(html, /bioweave-world-model-module-grid/);
  assert.match(html, /bioweave-world-model-world-stack/);
  assert.match(html, /潮汐生物/);
  assert.match(html, /潮汐生物型/);
  assert.match(html, /生物类型详情/);
  assert.match(html, /切换类型/);
  assert.match(html, /生殖能力/);
  assert.match(html, /可承担妊娠/);
  assert.match(html, /医疗与照护/);
  assert.match(html, /分娩难度/);
  assert.match(html, /当前资料不足以确定难度/);
  assert.match(html, /未知/);
  assert.equal(/\b(?:unknown|null|undefined|N\/A)\b/i.test(html), false);

  const canonicalDualModel = normalizeWorldModel({
    ...modelFixture,
    species: [{
      ...modelFixture.species[0],
      biological_types: [typeFixture('双性/间性')],
    }],
  });
  const dualHtml = worldPage({worldModel: canonicalDualModel});
  assert.match(dualHtml, /双性/);
  assert.doesNotMatch(dualHtml, /双性\/间性/);

  const visibleTypesModel = normalizeWorldModel({
    ...modelFixture,
    species: [{
      ...modelFixture.species[0],
      name: '人类',
      biological_types: [
        typeFixture('男性'),
        typeFixture('女性'),
        typeFixture('双性'),
        typeFixture('Alpha'),
        typeFixture('Beta'),
        typeFixture('Omega'),
      ],
    }],
  });
  const visibleTypesHtml = worldPage({worldModel: visibleTypesModel});
  assert.equal((visibleTypesHtml.match(/data-bioweave-action="world-model-select-type"/g) ?? []).length, 6);
  assert.equal((visibleTypesHtml.match(/<section class="[^"]*bioweave-world-model-type-detail[^"]*">/g) ?? []).length, 1);
  assert.match(visibleTypesHtml, />男性<\/button>/);
  assert.match(visibleTypesHtml, />女性<\/button>/);
  assert.match(visibleTypesHtml, />双性<\/button>/);
  assert.match(visibleTypesHtml, />Alpha<\/button>/);
  assert.match(visibleTypesHtml, />Beta<\/button>/);
  assert.match(visibleTypesHtml, />Omega<\/button>/);
});

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
          {key: 'anima', label: 'Anima', enabled: false, read_status: 'disabled'},
          {key: 'baobaoshu', label: '柏宝书', enabled: true, read_status: 'success'},
          {key: 'database_memory', label: '数据库记忆', enabled: true, read_status: 'empty'},
        ],
        token_estimate: 9757,
      },
    },
  });

  assert.match(html, /最后分析：<\/strong>2026\/09\/08 19:18/);
  assert.match(html, /来源：<\/strong>1 本世界书 · 最近剧情 F57-F60 · 柏宝书/);
  assert.doesNotMatch(html, /角色卡/);
  assert.doesNotMatch(html, /Anima|数据库记忆/);
  assert.doesNotMatch(html, /23 条目|9757|最后保存|手动|AI 分析/);
});

test('World Model page shows a recent-story count when its floor range is unavailable', () => {
  const html = worldPage({
    worldModel: modelFixture,
    worldModelMeta: {
      last_analyzed_at: '2026-09-08T19:18:42+08:00',
      source_summary: {
        character_fields: 0,
        worldbooks: 0,
        recent_story: {enabled: true, floor_start: null, floor_end: null, floors_read: 4},
      },
    },
  });

  assert.match(html, /来源：<\/strong>最近剧情 4 楼/);
});

test('World Model page preserves a species with no inferred biological type', () => {
  const html = worldPage({
    worldModel: {
      schema_version: 1,
      species: [{name: '人类', description: null, biological_types: []}],
      medical_context: {childbirth_difficulty: null, care_level: null, evidence: null},
      exceptions: [],
      unknowns: [],
    },
  });
  assert.match(html, /人类/);
  assert.match(html, /尚未识别出生物类型/);
  assert.doesNotMatch(html, /可产生精子/);
});

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
      medical_context: {childbirth_difficulty: null, care_level: null, evidence: null},
      exceptions: [],
      unknowns: [],
    },
  });

  assert.match(html, /人类/);
  assert.match(html, /男性/);
  assert.match(html, /女性/);
  assert.match(html, /镜生体/);
  assert.match(html, /甲型/);
  assert.equal((html.match(/data-bioweave-action="world-model-select-type"/g) ?? []).length, 3);
});

test('World Model page input preview shows the actual request messages', () => {
  const html = worldPage({
    showAnalysisInput: true,
    analysisPreview: {
      input: {
        character: {description: '角色预览'},
        worldbooks: [],
        recent_story: {items: [{floor: 7, role: 'assistant', content: '楼层预览'}]},
        external_memory: [],
        meta: {user_name: '用户丙', character_name: '角色丙'},
      },
    },
  });
  assert.equal((html.match(/<details class="bioweave-world-model-message"/g) ?? []).length, 4);
  assert.match(html, /data-bioweave-world-model-message-role="system"/);
  assert.match(html, /data-bioweave-world-model-message-role="assistant"/);
  assert.match(html, /data-bioweave-world-model-message-role="user"/);
  assert.match(html, /角色预览/);
  assert.match(html, /楼层预览/);
});

test('World UI uses seven independent section editors and keeps the global editor removed', () => {
  const viewHtml = worldPage({
    worldModel: modelFixture,
  });
  assert.deepEqual(WORLD_MODEL_SECTION_KEYS, [
    'capabilities',
    'reproduction_rules',
    'lifecycle',
    'special_rules',
    'medical_context',
    'exceptions',
    'unknowns',
  ]);
  assert.equal((viewHtml.match(/data-bioweave-action="world-model-edit-section"/g) ?? []).length, 7);
  assert.doesNotMatch(viewHtml, /data-bioweave-world-model-form/);
  assert.doesNotMatch(viewHtml, /保存世界模型/);
  assert.equal(viewHtml.includes('api_key'), false);

  const editingHtml = worldPage({
    worldModel: modelFixture,
    selectedSpeciesIndex: 0,
    selectedTypeIndex: 0,
    editingSection: 'capabilities',
    sectionDraft: modelFixture.species[0].biological_types[0].capabilities,
  });
  assert.equal((editingHtml.match(/data-bioweave-world-section-form/g) ?? []).length, 1);
  assert.match(editingHtml, /data-bioweave-world-section="capabilities"/);
  assert.match(editingHtml, /data-bioweave-action="world-model-cancel-section"/);
  assert.match(editingHtml, /data-bioweave-action="world-model-save-section"/);
  assert.match(editingHtml, />是<\/option>/);
  assert.match(editingHtml, />否<\/option>/);
  assert.match(editingHtml, />未知<\/option>/);
  assert.equal((editingHtml.match(/data-bioweave-action="world-model-edit-section"/g) ?? []).length, 6);
});

test('World Model production code remains free of fixture-specific species rules', () => {
  const production = [
    readFileSync(new URL('../ai/prompts.js', import.meta.url), 'utf8'),
    readFileSync(new URL('../ai/analyzer.js', import.meta.url), 'utf8'),
  ].join('\n');
  for (const term of ['妖修', '半兽人', '妖剑剑灵', '魔剑灵', '男剑灵', '女剑灵']) {
    assert.equal(production.includes(term), false, `production contains fixture term: ${term}`);
  }
  assert.doesNotMatch(production, /(?:species|type|item)\s*={2,3}\s*['"`](?:妖|魔|剑灵)['"`]/u);
  assert.doesNotMatch(production, /KNOWN_FANTASY_SPECIES|fantasySpecies|speciesDictionary|speciesRegistry|knownBiologicalTypes/u);
});

test('World UI section patches only the selected type or world-level section', () => {
  const base = normalizeWorldModel(modelFixture);
  const capabilityDraft = {
    ...base.species[0].biological_types[0].capabilities,
    can_produce_ova: true,
  };
  const typePatched = applyWorldModelSection(base, 'capabilities', capabilityDraft, {
    selectedSpeciesIndex: 0,
    selectedTypeIndex: 0,
  });

  assert.equal(typePatched.species[0].biological_types[0].capabilities.can_produce_ova, true);
  assert.deepEqual(
    typePatched.species[0].biological_types[0].reproduction_rules,
    base.species[0].biological_types[0].reproduction_rules,
  );
  assert.deepEqual(typePatched.medical_context, base.medical_context);
  assert.deepEqual(base, normalizeWorldModel(modelFixture));

  const medicalDraft = {
    ...base.medical_context,
    care_level: '需要专门照护。',
  };
  const worldPatched = applyWorldModelSection(base, 'medical_context', medicalDraft, {
    selectedSpeciesIndex: 0,
    selectedTypeIndex: 0,
  });
  assert.equal(worldPatched.medical_context.care_level, '需要专门照护。');
  assert.deepEqual(worldPatched.species, base.species);
  assert.deepEqual(worldPatched.exceptions, base.exceptions);
});

test('empty Chat reserves only Chat-local World Model slots', () => {
  const chat = emptyChat('chat-a');
  assert.equal(chat.world_model, null);
  assert.equal(chat.world_model_meta, null);
  assert.deepEqual(chat.settings.external_memory, {
    anima: false,
    baobaoshu: false,
    database_memory: false,
  });
});
