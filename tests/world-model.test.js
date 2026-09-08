import test from 'node:test';
import assert from 'node:assert/strict';
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
import {worldPage} from '../ui/world.js';

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

  assert.deepEqual(result.species.map(species => species.name), ['潮汐生物', '仅有未获证据的类型']);
  assert.deepEqual(result.species[0].biological_types.map(type => type.name), ['潮汐生物型']);
  assert.deepEqual(result.species[1].biological_types, []);
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
      name: '剑灵',
      description: null,
      biological_types: [
        typeFixture('男性剑灵'),
        typeFixture('女性剑灵'),
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
        name: '剑灵',
        description: '明确的非人类物种，性别基本为男性，极少数为女性。',
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
  const result = await analyzeDescription('资料明确说明角色为男性。', [
    {
      name: '人类',
      biological_types: [typeFixture('男性'), typeFixture('女性'), typeFixture('双性')],
    },
  ]);
  assert.deepEqual(result.species[0].biological_types.map(type => type.name), ['男性']);
});

test('World Model analysis keeps male and female when both are explicitly evidenced', async () => {
  const result = await analyzeDescription('世界规则明确记载男性和女性都存在。', [
    {
      name: '人类',
      biological_types: [typeFixture('男性'), typeFixture('女性'), typeFixture('双性')],
    },
  ]);
  assert.deepEqual(result.species[0].biological_types.map(type => type.name), ['男性', '女性']);
});

test('World Model analysis recognizes ordinary sex wording and rejects negated or uncertain labels', async () => {
  const result = await analyzeDescription('角色性别为男；另一角色性别为女。', [
    {
      name: '人类',
      biological_types: [typeFixture('男性'), typeFixture('女性'), typeFixture('双性')],
    },
  ]);
  assert.deepEqual(result.species[0].biological_types.map(type => type.name), ['男性', '女性']);

  const noEvidence = await analyzeDescription('资料不存在男性和女性；其性别不确定。', [
    {
      name: '人类',
      biological_types: [typeFixture('男性'), typeFixture('女性'), typeFixture('双性')],
    },
  ]);
  assert.deepEqual(noEvidence.species[0].biological_types, []);
});

test('World Model analysis does not treat a temporary conversion as fixed dual evidence', async () => {
  const result = await analyzeDescription('角色原本为男性；角色可以转为双性，持续时间只有三天。', [
    {
      name: '人类',
      biological_types: [typeFixture('男性'), typeFixture('双性')],
    },
  ]);
  assert.deepEqual(result.species[0].biological_types.map(type => type.name), ['男性']);
});

test('World Model analysis keeps fixed dual evidence when its mechanisms remain unknown', async () => {
  const result = await analyzeDescription('世界明确存在双性个体，但其具体生育能力可能未知。', [
    {name: '人类', biological_types: [typeFixture('双性')]},
  ]);
  assert.deepEqual(result.species[0].biological_types.map(type => type.name), ['双性']);
});

test('World Model analysis rejects uncertain dual existence', async () => {
  const result = await analyzeDescription('资料可能有双性个体，但没有确认。', [
    {name: '人类', biological_types: [typeFixture('双性')]},
  ]);
  assert.deepEqual(result.species[0].biological_types, []);
});

test('World Model analysis removes temporary dualization from types and unknowns but keeps the rule', async () => {
  const result = await analyzeDescription(
    '角色原本是男性；金丹可以双性化，持续一至三天。',
    [{
      name: '人类',
      biological_types: [
        typeFixture('男性', {special_rules: ['金丹双性化是临时身体规则。']}),
        typeFixture('双性'),
      ],
    }],
    ['双性化持续时间未知', '双性个体的能力未知'],
  );
  assert.deepEqual(result.species[0].biological_types.map(type => type.name), ['男性']);
  assert.deepEqual(result.species[0].biological_types[0].special_rules, ['金丹双性化是临时身体规则。']);
  assert.deepEqual(result.unknowns, ['双性化持续时间未知']);
});

test('World Model analysis removes individual ambiguity and observed non-biological aliases', async () => {
  const result = await analyzeDescription('某人物性别模糊；剑灵性别基本为男性，极少女剑灵。', [
    {name: '人类', biological_types: [typeFixture('性别模糊')]},
    {name: '妖', biological_types: [typeFixture('妖修'), typeFixture('半兽人')]},
    {name: '魔', biological_types: [typeFixture('魔族')]},
    {
      name: '剑灵',
      biological_types: [
        typeFixture('男性剑灵'),
        typeFixture('女性剑灵'),
        typeFixture('妖剑剑灵'),
        typeFixture('魔剑灵'),
      ],
    },
  ]);
  assert.deepEqual(result.species[0].biological_types, []);
  assert.deepEqual(result.species[1].biological_types, []);
  assert.deepEqual(result.species[2].biological_types, []);
  assert.deepEqual(result.species[3].biological_types.map(type => type.name), ['男性', '女性']);
});

test('World Model analysis preserves open ABO names without inventing sex combinations', async () => {
  const result = await analyzeDescription('世界规则明确存在 Alpha、Beta、Omega 三类生殖分类。', [
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
  const result = await analyzeDescription('资料明确存在女性剑灵，但没有说明其生殖机制。', [
    {
      name: '剑灵',
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

test('World Model analysis does not leak human sex evidence into non-human species', async () => {
  const result = await analyzeInput({
    character: {description: '人类资料明确出现男性和女性。妖：只确认存在这个种族，未说明性别分类。魔：只确认存在这个种族，未说明性别分类。'},
  }, [
    {name: '人类', biological_types: [typeFixture('男性'), typeFixture('女性'), typeFixture('Alpha')]},
    {name: '妖', biological_types: [typeFixture('男性'), typeFixture('女性')]},
    {name: '魔', biological_types: [typeFixture('男性'), typeFixture('女性')]},
  ], ['妖族男性的具体机制未知', '妖族的生殖机制未知']);

  assert.deepEqual(result.species[0].biological_types.map(type => type.name), ['男性', '女性']);
  assert.deepEqual(result.species.slice(1).map(species => species.biological_types), [[], []]);
  assert.deepEqual(result.unknowns, ['妖族的生殖机制未知']);
});

test('World Model analysis keeps female sword spirits from deterministic semantic evidence', async () => {
  const result = await analyzeDescription('剑灵性别基本都为男性，极少女剑灵。', [
    {name: '剑灵', biological_types: [typeFixture('男性'), typeFixture('女性')]},
  ]);

  assert.deepEqual(result.species[0].biological_types.map(type => type.name), ['男性', '女性']);
  assert.ok(result.species[0].biological_types.every(type => Object.values(type.capabilities).every(value => value === null)));
});

test('World Model analysis does not treat unrelated partners or individual labels as species types', async () => {
  const result = await analyzeDescription('妖兽会与男人交配，也会与人类女性性交；某个剑灵角色是男性。', [
    {name: '妖', biological_types: [typeFixture('女性')]},
    {name: '剑灵', biological_types: [typeFixture('男性')]},
  ]);
  assert.deepEqual(result.species.map(species => species.biological_types), [[], []]);
});

test('World Model analysis keeps only directly evidenced non-human fields', async () => {
  const result = await analyzeDescription('妖族男性会产生精液；妖族存在发情期；妖族寿命通常为六百年。', [
    {
      name: '妖',
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
        special_rules: ['妖族存在发情期。', '成结用于提高受精成功率。'],
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
  assert.deepEqual(type.special_rules, ['妖族存在发情期。']);
});

test('World Model analysis preserves explicit negative non-human capability evidence', async () => {
  const result = await analyzeDescription('妖族男性不能产生精子，也不能被受精。', [
    {name: '妖', biological_types: [typeFixture('男性')]},
  ]);
  assert.equal(result.species[0].biological_types[0].capabilities.can_produce_sperm, false);
  assert.equal(result.species[0].biological_types[0].capabilities.can_be_fertilized, false);
  assert.equal(result.species[0].biological_types[0].capabilities.can_fertilize, null);
});

test('World Model analysis keeps absent or pseudo-pregnancy evidence unknown', async () => {
  const result = await analyzeDescription('女性剑灵没有证据证明可以怀孕；仅存在假孕现象，无实际妊娠记录。', [
    {name: '剑灵', biological_types: [typeFixture('女性')]},
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
  const result = await analyzeDescription('女性剑灵不能怀孕，也无法被受精。', [
    {name: '剑灵', biological_types: [typeFixture('女性')]},
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
  const result = await analyzeDescription('女性剑灵的妊娠规律与人类相同。', [
    {
      name: '剑灵',
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
  assert.match(prompt, /Homo sapiens/);
  assert.match(prompt, /人类/);
  assert.match(prompt, /排卵（ovulation）/);
  assert.match(prompt, /受精（fertilization）/);
  assert.match(prompt, /妊娠\/孕期（gestation/);
  assert.match(prompt, /分娩\/产程周期（labor，labor cycle）/);
  assert.match(prompt, /已建立的人类类型应在对应 reproduction_rules 中分别填写/);
  assert.match(prompt, /约 28 天/);
  assert.match(prompt, /通常约 40 周/);
  assert.match(prompt, /人类基线只在对应的人类 biological_type 已由当前资料建立后才可使用/);
  assert.match(prompt, /明确剧情事实 > 明确世界\/世界书规则 > 明确个人例外 > 普通人类基线/);
  assert.match(prompt, /先独立识别 species，再在每个 species 内识别 biological_types/);
  assert.match(prompt, /识别出“人类”本身绝不能自动补齐任何 biological_type/);
  assert.match(prompt, /非人类 species/);
  assert.match(prompt, /非人类 Evidence Gate/);
  assert.match(prompt, /极少女剑灵/);
  assert.match(prompt, /没有字段级证据时对应字段使用 null/);
  assert.match(prompt, /性别标签.*代词.*称谓.*外貌.*身体形态/);
  assert.match(prompt, /明确说明某一项生理结构与人类相同.*继承该项对应的基线部分/);
  assert.match(prompt, /medical_context/);
  assert.match(messages[1].content, /当前世界医疗条件：城市有产科医院和急救设施；人类妊娠规则为三个月/);
  assert.match(prompt, /childbirth_difficulty.*care_level.*evidence/);
});

test('World Model prompt treats default male/female资料 as human without non-human evidence', () => {
  const messages = buildWorldModelMessages({
    character: {description: '资料只呈现默认男性/女性二元，没有明确非人类证据。'},
  });
  const prompt = messages[0].content;
  assert.match(prompt, /默认人类回退只用于物种识别/);
  assert.match(prompt, /只呈现默认男性\/女性二元或其它普通人类.*没有明确非人类证据/);
  assert.match(prompt, /识别出“人类”本身绝不能自动补齐任何 biological_type/);
  assert.match(prompt, /只出现男性时输出人类→男性/);
  assert.match(prompt, /出现男性和女性时输出人类→男性、女性/);
  assert.match(prompt, /男性剑灵.*女性/);
  assert.match(prompt, /明确非人类证据优先/);
  assert.match(prompt, /capabilities.*不能从类型名称/);
});

test('World Model prompt distinguishes fixed dual evidence from temporary dualization', () => {
  const messages = buildWorldModelMessages({
    character: {description: '明确证据：角色本身是双性，并明确可产生精子；也可以短暂双性化。'},
  });
  const prompt = messages[0].content;
  assert.match(prompt, /固定双性分类只使用名称“双性”/);
  assert.match(prompt, /固定的双性个体、species 分类或世界规则/);
  assert.match(prompt, /可以双性化、临时双性状态、变身\/改造能力.*都不是固定类型证据/);
  assert.match(messages[1].content, /角色本身是双性/);
  assert.match(prompt, /每个 biological_type 的 capabilities 必须逐项依据证据独立填写 true、false 或 null/);
  assert.match(prompt, /不能因为双性、Alpha、Beta 或 Omega 自动把所有能力设为 true/);
  assert.match(prompt, /capability 的三态 Evidence Gate 同时约束 true 和 false/);
  assert.match(prompt, /没有证据证明可以.*没有观察到.*没有实际记录.*仅存在假孕.*null/);
});

test('World Model prompt rejects dual types inferred from default male/female input', () => {
  const messages = buildWorldModelMessages({
    character: {description: '资料只呈现默认男性/女性二元，没有其它生殖类型描述。'},
  });
  const prompt = messages[0].content;
  assert.match(prompt, /缺少证据的类型不要为了完整性添加/);
  assert.match(prompt, /类型名称保持开放/);
  assert.match(prompt, /可以双性化.*不是固定类型证据/);
  assert.doesNotMatch(prompt, /默认人类基础类型包含男性、女性和双性/);
  assert.match(messages[1].content, /资料只呈现默认男性\/女性二元/);
  assert.doesNotMatch(messages[1].content, /固定双性分类/);
});

test('World Model prompt requires Chinese string values and human type names', () => {
  const prompt = buildWorldModelMessages()[0].content;
  assert.match(prompt, /JSON 的 key 必须严格保持 schema 规定的英文/);
  assert.match(prompt, /说明、规则和列表字符串必须使用中文/);
  assert.match(prompt, /species 是数组；每项包含 name、description、biological_types/);
  assert.match(prompt, /name、description、capabilities、reproduction_rules、lifecycle、special_rules/);
  assert.match(prompt, /species 识别与 biological_type 识别必须分开/);
  assert.match(prompt, /只保留资料实际出现或明确规则建立的分类/);
  assert.match(prompt, /资料定义的 biological_type\.name 是开放字符串/);
  assert.match(prompt, /Alpha、Beta、Omega/);
  assert.match(prompt, /Homo sapiens 或 Human/);
  assert.match(prompt, /不得把未翻译的 Homo sapiens 或 Human 写入名称或说明/);
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
  assert.match(html, /物种/);
  assert.match(html, /潮汐生物/);
  assert.match(html, /潮汐生物型/);
  assert.match(html, /性别 \/ 生殖类型/);
  assert.match(html, /可承担妊娠/);
  assert.match(html, /世界医疗条件/);
  assert.match(html, /生育难易度/);
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
        typeFixture('双性/间性'),
        typeFixture('Alpha'),
      ],
    }],
  });
  const visibleTypesHtml = worldPage({worldModel: visibleTypesModel});
  assert.equal((visibleTypesHtml.match(/<article class="bioweave-world-model-type">/g) ?? []).length, 4);
  assert.match(visibleTypesHtml, /<h5>男性<\/h5>/);
  assert.match(visibleTypesHtml, /<h5>女性<\/h5>/);
  assert.match(visibleTypesHtml, /<h5>双性<\/h5>/);
  assert.match(visibleTypesHtml, /<h5>Alpha<\/h5>/);
  assert.doesNotMatch(visibleTypesHtml, /双性\/间性/);
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
  assert.match(html, /尚未识别出具体性别 \/ 生殖类型/);
  assert.doesNotMatch(html, /可产生精子/);
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

test('World Model editor exposes structured fields and safe save actions', () => {
  const html = worldPage({
    worldModel: modelFixture,
    worldModelEditing: true,
    worldModelDraft: modelFixture,
  });
  assert.match(html, /data-bioweave-world-model-form/);
  assert.match(html, /data-bioweave-world-species/);
  assert.match(html, /data-bioweave-world-species-field="name"/);
  assert.match(html, /data-bioweave-action="world-model-add-species"/);
  assert.match(html, /data-bioweave-action="world-model-add-type"/);
  assert.match(html, /data-bioweave-world-capability="can_carry_pregnancy"/);
  assert.match(html, /data-bioweave-world-rule="ovulation"/);
  assert.match(html, /data-bioweave-world-rule="gestation"/);
  assert.match(html, /data-bioweave-world-rule="labor"/);
  assert.match(html, /data-bioweave-world-medical="childbirth_difficulty"/);
  assert.match(html, /data-bioweave-action="world-model-save"/);
  assert.match(html, /保存世界模型/);
  assert.match(html, /data-bioweave-action="world-model-cancel"/);
  assert.equal(html.includes('api_key'), false);
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
