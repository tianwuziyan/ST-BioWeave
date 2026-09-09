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
  resolveWorldModelSelection,
  WORLD_MODEL_SECTION_KEYS,
  worldPage,
} from '../ui/world.js';

const STYLE_SOURCE = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

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

function structuredFixtureType(name, description, overrides = {}) {
  return {
    name,
    description,
    capabilities: {
      can_produce_sperm: null,
      can_produce_ova: null,
      can_be_fertilized: null,
      can_fertilize: null,
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
    lifecycle: {maturation: null, aging: null},
    special_rules: [],
    ...overrides,
  };
}

// Fixture A: one species with two biological types, including every fixed field.
const fixtureA = {
  schema_version: 1,
  species: [{
    name: 'Fixture A 物种',
    description: 'Fixture A 物种描述。\n第二行仍然可读。',
    biological_types: [
      structuredFixtureType('Fixture A 类型一', 'Fixture A 类型一描述。\n类型说明第二行。', {
        capabilities: {
          can_produce_sperm: true,
          can_produce_ova: false,
          can_be_fertilized: null,
          can_fertilize: true,
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
        lifecycle: {maturation: 'Fixture A 成熟', aging: 'Fixture A 衰老'},
        special_rules: ['Fixture A 特殊规则'],
      }),
      structuredFixtureType('Fixture A 类型二', 'Fixture A 类型二描述。', {
        capabilities: {
          can_produce_sperm: null,
          can_produce_ova: false,
          can_be_fertilized: null,
          can_fertilize: null,
          can_carry_pregnancy: false,
        },
      }),
    ],
  }],
  medical_context: {
    childbirth_difficulty: 'Fixture A 分娩难度',
    care_level: 'Fixture A 照护水平',
    evidence: 'Fixture A 医疗依据',
  },
  exceptions: [{
    statement: 'Fixture A 例外主文本',
    applies_to: 'Fixture A 适用对象',
    evidence: 'Fixture A 例外依据',
  }, {
    statement: 'Fixture A 无附加标签的例外',
    applies_to: null,
    evidence: null,
  }],
  unknowns: ['Fixture A 尚未确定项'],
};

// Fixture B: four species with different dynamic type counts, including an empty type list.
const fixtureB = {
  schema_version: 1,
  species: [
    {
      name: 'Fixture B 物种一',
      description: 'Fixture B 物种一描述。',
      biological_types: [
        structuredFixtureType('Fixture B 类型一甲', 'Fixture B 类型一甲描述。', {special_rules: ['Fixture B 规则甲']}),
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
  medical_context: {childbirth_difficulty: null, care_level: null, evidence: null},
  exceptions: [],
  unknowns: [],
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
    name: '双性',
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
    name: '双性类型',
  });
  response.species.push({
    name: '仅有未获证据的类型',
    description: null,
    biological_types: [{
      ...structuredClone(modelFixture.species[0].biological_types[0]),
      name: '双性类型',
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
    name: '双性类型',
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

test('World Model rule normalization separates unknown from known absence', () => {
  const parsed = normalizeWorldModel({
    ...modelFixture,
    species: [{
      name: '雾核体',
      description: null,
      biological_types: [structuredFixtureType('甲型', null, {
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
      })],
    }],
  });
  const type = parsed.species[0].biological_types[0];

  assert.deepEqual(type.reproduction_rules, {
    fertilization: '无',
    pregnancy_or_carrying: '无',
    cycle: null,
    ovulation: '无',
    gestation: null,
    labor: null,
  });
  assert.deepEqual(type.lifecycle, {maturation: null, aging: '无'});
});

test('World Model merges only explicit Human aliases and keeps conservative known values', () => {
  const parsed = normalizeWorldModel({
    ...modelFixture,
    species: [
      {name: '人类', description: null, biological_types: [structuredFixtureType('男性')]},
      {name: 'Human', description: null, biological_types: [structuredFixtureType('男性', null, {
        reproduction_rules: {cycle: '首个已知规则'},
      })]},
      {name: 'HUMAN', description: null, biological_types: [structuredFixtureType('男性', null, {
        reproduction_rules: {cycle: '冲突规则'},
      })]},
      {name: '人类 (Human)', description: null, biological_types: [structuredFixtureType('女性')]},
      {name: 'Human (人类)', description: null, biological_types: []},
    ],
  });

  assert.equal(parsed.species.length, 1);
  assert.equal(parsed.species[0].name, '人类');
  assert.deepEqual(parsed.species[0].biological_types.map(type => type.name), ['男性', '女性']);
  assert.equal(parsed.species[0].biological_types[0].reproduction_rules.cycle, '首个已知规则');
});

test('World Model applies Human baseline after alias canonicalization', async () => {
  const result = await analyzeDescription('Human 世界明确存在男性和女性。', [
    {name: 'HUMAN (人类)', biological_types: [structuredFixtureType('男性')]},
    {name: '人类 (Human)', biological_types: [structuredFixtureType('女性')]},
  ]);
  const species = result.species[0];
  const male = species.biological_types.find(type => type.name === '男性');
  const female = species.biological_types.find(type => type.name === '女性');

  assert.deepEqual(result.species.map(item => item.name), ['人类']);
  assert.deepEqual(species.biological_types.map(type => type.name), ['男性', '女性']);
  assert.equal(male.reproduction_rules.cycle, '无');
  assert.equal(male.reproduction_rules.ovulation, '无');
  assert.equal(male.reproduction_rules.gestation, '无');
  assert.equal(male.reproduction_rules.labor, '无');
  assert.equal(female.reproduction_rules.cycle, '通常约28天一个周期。');
  assert.equal(female.reproduction_rules.ovulation, '通常每个周期排卵。');
  assert.equal(female.reproduction_rules.gestation, '通常约40周。');
  assert.equal(female.reproduction_rules.labor, '通过分娩完成生产。');
});

test('World Model exception normalization keeps canonical fields and uses normalized fallback order', () => {
  const parsed = normalizeWorldModel({
    ...modelFixture,
    exceptions: [
      '旧字符串例外',
      {description: '旧 description 例外', name: '不应覆盖 description'},
      {statement: 'canonical 例外', description: '不应覆盖 statement', name: '不应覆盖 name', applies_to: '角色乙', evidence: '来源乙'},
      {statement: '  ', description: 'description 回退例外', name: '不应覆盖 description'},
      {statement: null, description: '  ', name: 'name 回退例外', applies_to: '角色丙', evidence: '来源丙'},
    ],
  });

  assert.deepEqual(parsed.exceptions, [
    {statement: '旧字符串例外', applies_to: null, evidence: null},
    {statement: '旧 description 例外', applies_to: null, evidence: null},
    {statement: 'canonical 例外', applies_to: '角色乙', evidence: '来源乙'},
    {statement: 'description 回退例外', applies_to: null, evidence: null},
    {statement: 'name 回退例外', applies_to: '角色丙', evidence: '来源丙'},
  ]);
  assert.ok(parsed.exceptions.every(item => Object.keys(item).sort().join(',') === 'applies_to,evidence,statement'));
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
        typeFixture('双性人类'),
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
        description: '资料明确出现人类常规类型和双性类型。',
        biological_types: [
          {...structuredClone(modelFixture.species[0].biological_types[0]), name: '男性'},
          {...structuredClone(modelFixture.species[0].biological_types[0]), name: '女性'},
          {...structuredClone(modelFixture.species[0].biological_types[0]), name: '双性'},
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

test('World Model analysis keeps non-human female mechanisms unknown when raw fields are null', async () => {
  const result = await analyzeDescription('资料明确存在女性镜生体，但没有说明其生殖机制。', [
    {
      name: '镜生体',
      biological_types: [structuredFixtureType('女性')],
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

test('World Model analysis preserves schema-valid non-human capabilities without source re-filtering', async () => {
  const result = await analyzeDescription('晶巢种女性能够产生卵细胞，但不能承担妊娠。', [
    {name: '晶巢种', biological_types: [typeFixture('女性')]},
  ]);
  assert.deepEqual(result.species[0].biological_types[0].capabilities, {
    can_produce_sperm: true,
    can_produce_ova: null,
    can_be_fertilized: false,
    can_fertilize: true,
    can_carry_pregnancy: null,
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

test('World Model analysis preserves generic raw fields after type-only retention', async () => {
  const rawType = structuredFixtureType('Type-X', 'AI 改写后的类型摘要。', {
    capabilities: {
      can_produce_sperm: true,
      can_produce_ova: true,
      can_be_fertilized: true,
      can_fertilize: true,
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
  });
  const result = await analyzeDescription('Type-X 是一种通用生物类型。', [{
    name: 'Species-A',
    description: 'Species-A 的通用描述。',
    biological_types: [rawType],
  }]);

  assert.deepEqual(result.species.map(species => species.name), ['Species-A']);
  assert.deepEqual(result.species[0].biological_types[0], rawType);
});

test('World Model analysis preserves raw fields for custom types under human species', async () => {
  const rawType = structuredFixtureType('自定义类型', 'AI 改写后的类型摘要。', {
    capabilities: {
      can_produce_sperm: true,
      can_produce_ova: true,
      can_be_fertilized: true,
      can_fertilize: true,
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
  });
  const result = await analyzeDescription('人类资料明确存在自定义类型。', [{
    name: '人类',
    biological_types: [rawType],
  }]);

  assert.deepEqual(result.species[0].biological_types[0], rawType);
});

test('World Model analysis preserves generic null and empty raw fields', async () => {
  const result = await analyzeDescription('Type-Y 是一种通用生物类型。', [{
    name: 'Species-B',
    biological_types: [structuredFixtureType('Type-Y')],
  }]);

  assert.deepEqual(result.species[0].biological_types[0].capabilities, {
    can_produce_sperm: null,
    can_produce_ova: null,
    can_be_fertilized: null,
    can_fertilize: null,
    can_carry_pregnancy: null,
  });
  assert.deepEqual(result.species[0].biological_types[0].reproduction_rules, {
    fertilization: null,
    pregnancy_or_carrying: null,
    cycle: null,
    ovulation: null,
    gestation: null,
    labor: null,
  });
  assert.deepEqual(result.species[0].biological_types[0].lifecycle, {maturation: null, aging: null});
  assert.deepEqual(result.species[0].biological_types[0].special_rules, []);
});

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
      type: structuredFixtureType('Type-Z', null, {capabilities: {can_produce_sperm: true}}),
    },
    {
      name: 'Species-D',
      input: '通过配子结合完成受精。',
      type: structuredFixtureType('Type-R', null, {
        reproduction_rules: {fertilization: '通过配子结合完成受精。'},
      }),
    },
    {
      name: 'Species-E',
      input: '该生物达到成熟后进入下一阶段。',
      type: structuredFixtureType('Type-L', null, {
        lifecycle: {maturation: '该生物达到成熟后进入下一阶段。'},
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
  ];

  for (const item of cases) {
    const result = await analyzeDescription(item.input, [{
      name: item.name,
      description: item.speciesDescription ?? null,
      biological_types: [item.type],
    }]);
    assert.deepEqual(result.species.map(species => species.name), [item.name], item.name);
  }
});

test('World Model analysis keeps a generic species but filters an unsupported type', async () => {
  const result = await analyzeDescription('Species-A 明确存在 Type-X。', [{
    name: 'Species-A',
    biological_types: [structuredFixtureType('Type-X', null), structuredFixtureType('Type-Y', null)],
  }]);

  assert.deepEqual(result.species.map(species => species.name), ['Species-A']);
  assert.deepEqual(result.species[0].biological_types.map(type => type.name), ['Type-X']);
});

test('World Model analysis filters a generic species when only schema keys are present', async () => {
  const result = await analyzeDescription(
    'species biological_types capabilities reproduction_rules lifecycle special_rules',
    [{
      name: 'Species-A',
      description: 'Species-A 的描述不在输入中。',
      biological_types: [structuredFixtureType('Type-Y', 'Type-Y 的描述不在输入中。', {
        capabilities: {can_produce_sperm: true},
        reproduction_rules: {fertilization: '该类型的受精规则不在输入中。'},
        lifecycle: {maturation: '该类型的成熟规则不在输入中。'},
        special_rules: ['该类型的特殊规则不在输入中。'],
      })],
    }],
  );

  assert.deepEqual(result.species, []);
});

test('World Model analysis does not use an unscoped special rule as species evidence', async () => {
  const result = await analyzeDescription('资料中只提到“特殊规则”四个字。', [{
    name: 'Species-A',
    biological_types: [structuredFixtureType('Type-X', null, {
      special_rules: ['特殊规则：月光下会改变生殖能力。'],
    })],
  }]);

  assert.deepEqual(result.species, []);
});

test('World Model analysis keeps arbitrary Alpha Beta Omega types under a generic species', async () => {
  const result = await analyzeDescription('Species-A 明确存在 Alpha、Beta、Omega 三种生物类型。', [{
    name: 'Species-A',
    biological_types: [
      structuredFixtureType('Alpha', null),
      structuredFixtureType('Beta', null),
      structuredFixtureType('Omega', null),
    ],
  }]);

  assert.deepEqual(result.species[0].biological_types.map(type => type.name), ['Alpha', 'Beta', 'Omega']);
});

test('World Model pipeline retains a type when species and type evidence are separate units', async () => {
  const result = await analyzeInput({
    character: {description: 'Species-A 已被记录为一个生物种群。\nType-X 的类型描述已在资料中明确记录。'},
  }, [{
    name: 'Species-A',
    biological_types: [structuredFixtureType('Type-X', 'Type-X 的类型描述已在资料中明确记录。', {
      capabilities: {can_produce_sperm: true},
    })],
  }]);

  assert.deepEqual(result.species.map(species => species.name), ['Species-A']);
  assert.deepEqual(result.species[0].biological_types.map(type => type.name), ['Type-X']);
  assert.equal(result.species[0].biological_types[0].capabilities.can_produce_sperm, true);
});

test('World Model pipeline retains a type from a directly evidenced reproduction rule without its name', async () => {
  const fertilizationRule = '通过配子结合完成受精。';
  const result = await analyzeInput({
    character: {description: 'Species-A 被明确记录为物种。\n资料记载受精方式为通过配子结合完成受精。'},
  }, [{
    name: 'Species-A',
    biological_types: [structuredFixtureType('Type-X', null, {
      reproduction_rules: {fertilization: fertilizationRule},
    })],
  }]);

  assert.deepEqual(result.species[0].biological_types.map(type => type.name), ['Type-X']);
  assert.equal(result.species[0].biological_types[0].reproduction_rules.fertilization, fertilizationRule);
});

test('World Model pipeline keeps nameless type field evidence isolated across siblings', async () => {
  const fertilizationRule = '通过配子结合完成受精。';
  const maturationRule = '该生物达到成熟后进入下一阶段。';
  const specialRule = '该生物在月光下会改变生殖能力。';
  const description = '该生物类型能够产生精子。';
  const result = await analyzeInput({
    character: {
      description: [
        'Species-A 已被记录为物种。',
        fertilizationRule,
        maturationRule,
        specialRule,
        description,
      ].join('\n'),
    },
  }, [{
    name: 'Species-A',
    biological_types: [
      structuredFixtureType('Type-X', null, {
        reproduction_rules: {fertilization: fertilizationRule},
      }),
      structuredFixtureType('Type-Y', null, {
        lifecycle: {maturation: maturationRule},
      }),
      structuredFixtureType('Type-Z', null, {
        special_rules: [specialRule],
      }),
      structuredFixtureType('Type-W', description, {
        capabilities: {can_produce_sperm: true},
      }),
    ],
  }]);

  const [typeX, typeY, typeZ, typeW] = result.species[0].biological_types;
  assert.deepEqual(result.species[0].biological_types.map(type => type.name), ['Type-X', 'Type-Y', 'Type-Z', 'Type-W']);
  assert.equal(typeX.reproduction_rules.fertilization, fertilizationRule);
  assert.equal(typeX.lifecycle.maturation, null);
  assert.deepEqual(typeX.special_rules, []);
  assert.equal(typeY.reproduction_rules.fertilization, null);
  assert.equal(typeY.lifecycle.maturation, maturationRule);
  assert.deepEqual(typeY.special_rules, []);
  assert.equal(typeZ.reproduction_rules.fertilization, null);
  assert.equal(typeZ.lifecycle.maturation, null);
  assert.deepEqual(typeZ.special_rules, [specialRule]);
  assert.equal(typeW.capabilities.can_produce_sperm, true);
  assert.equal(typeW.reproduction_rules.fertilization, null);
  assert.equal(typeW.lifecycle.maturation, null);
  assert.deepEqual(typeW.special_rules, []);
});

test('World Model pipeline preserves each retained type raw field despite sibling evidence', async () => {
  const fertilizationRule = '通过配子结合完成受精。';
  const result = await analyzeInput({
    character: {
      description: `Species-A 已被记录为物种。Type-Y ${fertilizationRule}`,
    },
  }, [{
    name: 'Species-A',
    biological_types: [
      structuredFixtureType('Type-X', null, {
        reproduction_rules: {fertilization: fertilizationRule},
      }),
      structuredFixtureType('Type-Y', null, {
        reproduction_rules: {fertilization: fertilizationRule},
      }),
    ],
  }]);

  const [typeX, typeY] = result.species[0].biological_types;
  assert.equal(typeX.reproduction_rules.fertilization, fertilizationRule);
  assert.equal(typeY.reproduction_rules.fertilization, fertilizationRule);
});

test('World Model pipeline keeps the species while filtering a type with no subtree evidence', async () => {
  const result = await analyzeInput({
    character: {description: 'Species-A 明确存在 Type-X。'},
  }, [{
    name: 'Species-A',
    biological_types: [structuredFixtureType('Type-X', null), structuredFixtureType('Type-Y', null)],
  }]);

  assert.deepEqual(result.species.map(species => species.name), ['Species-A']);
  assert.deepEqual(result.species[0].biological_types.map(type => type.name), ['Type-X']);
});

test('World Model pipeline keeps only Type-X when Type-Y has no subtree evidence', async () => {
  const result = await analyzeInput({
    character: {description: 'Species-A 已被记录。\nType-X 的类型说明已被记录。'},
  }, [{
    name: 'Species-A',
    biological_types: [
      structuredFixtureType('Type-X', 'Type-X 的类型说明已被记录。'),
      structuredFixtureType('Type-Y', null),
    ],
  }]);

  assert.deepEqual(result.species[0].biological_types.map(type => type.name), ['Type-X']);
});

test('World Model pipeline retains open Alpha Beta Omega names without male or female matching', async () => {
  const result = await analyzeInput({
    character: {description: 'Species-A 已被记录。\nAlpha 是一种生殖分类。\nBeta 是一种生殖分类。\nOmega 是一种生殖分类。'},
  }, [{
    name: 'Species-A',
    biological_types: [
      structuredFixtureType('Alpha', 'Alpha 是一种生殖分类。'),
      structuredFixtureType('Beta', 'Beta 是一种生殖分类。'),
      structuredFixtureType('Omega', 'Omega 是一种生殖分类。'),
    ],
  }]);

  assert.deepEqual(result.species[0].biological_types.map(type => type.name), ['Alpha', 'Beta', 'Omega']);
  assert.equal(result.species[0].biological_types.some(type => ['男性', '女性'].includes(type.name)), false);
});

test('World Model pipeline retains human male and female types without human species wording', async () => {
  const evidence = '角色甲的性别是男性，能够产生精子并使卵细胞受精。角色乙的性别是女性，可以怀孕并通过分娩完成生产。';
  const result = await analyzeInput({
    character: {description: evidence},
  }, [{
    name: '人类',
    biological_types: [typeFixture('男性'), typeFixture('女性')],
  }]);

  assert.doesNotMatch(evidence, /人类/);
  assert.deepEqual(result.species[0].biological_types.map(type => type.name), ['男性', '女性']);
});

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
      can_produce_sperm: true,
      can_produce_ova: true,
      can_be_fertilized: true,
      can_fertilize: true,
      can_carry_pregnancy: true,
    },
    {
      can_produce_sperm: true,
      can_produce_ova: true,
      can_be_fertilized: true,
      can_fertilize: true,
      can_carry_pregnancy: true,
    },
  ]);
});

test('World Model keeps non-human unknown rules null but canonicalizes explicit absence to 无', async () => {
  const result = await analyzeDescription('雾核体的甲型明确不存在受精机制、排卵机制和妊娠机制；周期资料没有说明。', [{
    name: '雾核体',
    biological_types: [structuredFixtureType('甲型', null, {
      reproduction_rules: {
        fertilization: '无此机制',
        ovulation: '不具备该机制',
        gestation: '不适用',
        cycle: '没有对应资料',
      },
    })],
  }]);
  const rules = result.species[0].biological_types[0].reproduction_rules;

  assert.equal(rules.fertilization, '无');
  assert.equal(rules.ovulation, '无');
  assert.equal(rules.gestation, '无');
  assert.equal(rules.cycle, null);
  assert.equal(result.species[0].biological_types[0].capabilities.can_produce_ova, null);
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

test('World Model analysis keeps prompt-supplied unknown fertilization for interaction-only text', async () => {
  const result = await analyzeDescription('星海生物男性会性交、双修和补灵，但没有描述受精机制。', [
    {
      name: '星海生物',
      biological_types: [typeFixture('男性', {
        capabilities: {
          can_be_fertilized: false,
          can_fertilize: false,
        },
        reproduction_rules: {fertilization: null},
      })],
    },
  ]);

  assert.equal(result.species[0].biological_types[0].reproduction_rules.fertilization, null);
});

test('World Model preserves unfamiliar fertilization prose without a keyword admission gate', async () => {
  const firstRule = '两类配子在专门器官内融合并形成新个体。';
  const secondRule = '遗传材料在专门部位完成结合，随后形成新的生命个体。';
  const result = await analyzeDescription(
    '弧晶体的甲相和穗核型都是稳定的生殖分类；甲相的机制是两类配子在专门器官内融合并形成新个体；穗核型的机制是遗传材料在专门部位完成结合，随后形成新的生命个体。',
    [{
      name: '弧晶体',
      biological_types: [
        structuredFixtureType('甲相', null, {reproduction_rules: {fertilization: firstRule}}),
        structuredFixtureType('穗核型', null, {reproduction_rules: {fertilization: secondRule}}),
      ],
    }],
  );

  const types = result.species[0].biological_types;
  assert.deepEqual(types.map(type => type.name), ['甲相', '穗核型']);
  assert.equal(types[0].reproduction_rules.fertilization, firstRule);
  assert.equal(types[1].reproduction_rules.fertilization, secondRule);
});

test('World Model keeps interaction-only fertilization unknown when the AI follows the prompt contract', async () => {
  const result = await analyzeDescription(
    '弧晶体的甲相只通过液体交换激活能量循环，资料没有受精机制。',
    [{
      name: '弧晶体',
      biological_types: [
        structuredFixtureType('甲相', null, {
          reproduction_rules: {fertilization: null},
        }),
      ],
    }],
  );

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

test('World Model preserves a source-grounded unfamiliar biological type', async () => {
  const result = await analyzeDescription(
    '弧晶体内部稳定存在穗核型这一生殖生理分类；该分类直接影响身体机制。',
    [{
      name: '弧晶体',
      biological_types: [structuredFixtureType('穗核型')],
    }],
  );

  assert.deepEqual(result.species[0].biological_types.map(type => type.name), ['穗核型']);
});

test('World Model rejects an unfamiliar type without reliable source binding', async () => {
  const result = await analyzeDescription(
    '弧晶体存在一种稳定生殖分类，但资料没有记录该分类的名称或 type-local 规则。',
    [{
      name: '弧晶体',
      biological_types: [{
        ...structuredFixtureType('穗核型'),
        description: '穗核型是弧晶体内稳定存在的生殖分类。',
      }],
    }],
  );

  assert.deepEqual(result.species[0].biological_types, []);
});

test('World Model trace exposes raw and canonical models without request secrets', async () => {
  const rule = '两类配子在专门器官内融合并形成新个体。';
  const response = worldResponse([{
    name: '弧晶体',
    biological_types: [
      structuredFixtureType('甲相', null, {
        reproduction_rules: {fertilization: rule},
      }),
    ],
  }]);
  let trace = null;
  const analyzer = createAnalyzer({
    profileResolver: () => SILLYTAVERN_CURRENT_API,
    contextResolver: () => ({
      api_key: 'should-not-enter-trace',
      generateRaw: () => JSON.stringify(response),
    }),
    onWorldModelTrace: value => {
      trace = value;
    },
  });

  const result = await analyzer.analyzeWorldModel({
    analysisInput: {
      character: {description: '弧晶体的甲相是稳定生殖分类，机制描述已明确。'},
    },
  });

  assert.ok(trace);
  assert.match(trace.raw_output, /两类配子在专门器官内融合并形成新个体/);
  assert.equal(trace.normalized_model.species[0].biological_types[0].reproduction_rules.fertilization, rule);
  assert.equal(trace.canonical_model.species[0].biological_types[0].reproduction_rules.fertilization, rule);
  assert.equal(result.species[0].biological_types[0].reproduction_rules.fertilization, rule);
  assert.equal(Object.hasOwn(result, 'raw_output'), false);
  assert.equal(Object.hasOwn(result, 'canonical_model'), false);
  assert.doesNotMatch(JSON.stringify(trace), /should-not-enter-trace|api_key|secret_ref|authorization/iu);
});

test('World Model analysis keeps arbitrary species sex types from deterministic semantic evidence', async () => {
  const result = await analyzeDescription('镜生体性别基本都为男性，极少数镜生体为女性。', [
    {name: '镜生体', biological_types: [structuredFixtureType('男性'), structuredFixtureType('女性')]},
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

test('World Model analysis preserves generic fields while applying final contradictions', async () => {
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
    can_produce_ova: false,
    can_be_fertilized: false,
    can_fertilize: true,
    can_carry_pregnancy: false,
  });
  assert.deepEqual(type.reproduction_rules, {
    fertilization: '按人类方式受精。',
    pregnancy_or_carrying: '无',
    cycle: '存在发情期。',
    ovulation: '无',
    gestation: '无',
    labor: '无',
  });
  assert.deepEqual(type.lifecycle, {maturation: '达到成年后成熟。', aging: '寿命通常为六百年。'});
  assert.deepEqual(type.special_rules, ['晶巢种男性存在发情期。', '成结用于提高受精成功率。']);
});

test('World Model analysis keeps generic type-local fields across separate parent and type units', async () => {
  const result = await analyzeInput({
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
  }, [{
    name: 'Species-A',
    biological_types: [
      structuredFixtureType('Type-X', 'Type-X 是一种生殖分类。', {
        capabilities: {
          can_produce_sperm: true,
          can_produce_ova: true,
          can_be_fertilized: null,
          can_fertilize: null,
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
        special_rules: [
          'Type-X 特殊规则：月光下会改变生殖能力。',
          '云脉休眠规则。',
        ],
      }),
      structuredFixtureType('Type-Y', 'Type-Y 是另一种生殖分类。', {
        capabilities: {
          can_produce_sperm: true,
          can_produce_ova: true,
          can_be_fertilized: null,
          can_fertilize: null,
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
        special_rules: [
          'Type-Y 特殊规则：白昼会改变颜色。',
          '银沙环境下保持静止。',
        ],
      }),
    ],
  }]);

  const [typeX, typeY] = result.species[0].biological_types;
  assert.deepEqual(typeX.capabilities, {
    can_produce_sperm: true,
    can_produce_ova: true,
    can_be_fertilized: null,
    can_fertilize: null,
    can_carry_pregnancy: null,
  });
  assert.deepEqual(typeX.reproduction_rules, {
    fertilization: 'Type-X 的受精规则是通过配子结合完成受精。',
    pregnancy_or_carrying: 'Type-X 可以承担妊娠。',
    cycle: 'Type-X 存在发情期。',
    ovulation: null,
    gestation: null,
    labor: null,
  });
  assert.deepEqual(typeX.lifecycle, {
    maturation: 'Type-X 达到成熟后进入下一阶段。',
    aging: 'Type-X 的寿命通常为六百年。',
  });
  assert.deepEqual(typeX.special_rules, [
    'Type-X 特殊规则：月光下会改变生殖能力。',
    '云脉休眠规则。',
  ]);

  assert.deepEqual(typeY.capabilities, {
    can_produce_sperm: true,
    can_produce_ova: true,
    can_be_fertilized: null,
    can_fertilize: null,
    can_carry_pregnancy: true,
  });
  assert.deepEqual(typeY.reproduction_rules, {
    fertilization: 'Type-Y 的受精规则是通过配子结合完成受精。',
    pregnancy_or_carrying: 'Type-Y 可以承担妊娠。',
    cycle: 'Type-Y 存在发情期。',
    ovulation: null,
    gestation: null,
    labor: null,
  });
  assert.deepEqual(typeY.lifecycle, {
    maturation: 'Type-Y 达到成熟后进入下一阶段。',
    aging: 'Type-Y 的寿命通常为六百年。',
  });
  assert.deepEqual(typeY.special_rules, [
    'Type-Y 特殊规则：白昼会改变颜色。',
    '银沙环境下保持静止。',
  ]);
});

test('World Model analysis keeps Alpha Beta Omega fields under Species-B without name special cases', async () => {
  const result = await analyzeInput({
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
  }, [{
    name: 'Species-B',
    biological_types: [
      structuredFixtureType('Alpha', null, {
        capabilities: {can_produce_sperm: true},
        special_rules: ['仅在极端环境下休眠。'],
      }),
      structuredFixtureType('Beta', null, {
        lifecycle: {
          maturation: 'Beta 达到成熟后进入下一阶段。',
          aging: 'Beta 的寿命通常为六百年。',
        },
      }),
      structuredFixtureType('Omega', null, {
        special_rules: [
          'Omega 特殊规则：月光下会改变生殖能力。',
          '银沙环境下保持静止。',
        ],
      }),
    ],
  }]);

  assert.deepEqual(result.species[0].biological_types.map(type => type.name), ['Alpha', 'Beta', 'Omega']);
  assert.equal(result.species[0].biological_types[0].capabilities.can_produce_sperm, true);
  assert.deepEqual(result.species[0].biological_types[0].special_rules, ['仅在极端环境下休眠。']);
  assert.deepEqual(result.species[0].biological_types[1].lifecycle, {
    maturation: 'Beta 达到成熟后进入下一阶段。',
    aging: 'Beta 的寿命通常为六百年。',
  });
  assert.deepEqual(result.species[0].biological_types[2].special_rules, [
    'Omega 特殊规则：月光下会改变生殖能力。',
    '银沙环境下保持静止。',
  ]);
});

test('World Model analysis keeps a retained type raw while ignoring species-level contradiction guards', async () => {
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
        reproduction_rules: {fertilization: null},
        special_rules: ['晶巢种的体液会结晶。'],
      })],
    },
  ]);
  const type = result.species[0].biological_types[0];
  assert.equal(type.name, '甲型');
  assert.deepEqual(type.capabilities, {
    can_produce_sperm: true,
    can_produce_ova: false,
    can_be_fertilized: true,
    can_fertilize: true,
    can_carry_pregnancy: false,
  });
  assert.deepEqual(type.reproduction_rules, {
    fertilization: null,
    pregnancy_or_carrying: '无',
    cycle: null,
    ovulation: '无',
    gestation: '无',
    labor: '无',
  });
  assert.deepEqual(type.special_rules, ['晶巢种的体液会结晶。']);
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

test('World Model analysis keeps prompt-supplied unknown interaction rule for original species', async () => {
  const result = await analyzeDescription('回声囊体存在共鸣型；共鸣型会性交并交换能量，促进个体生成，但资料没有受精机制。', [
    {
      name: '回声囊体',
      biological_types: [typeFixture('共鸣型', {
        reproduction_rules: {fertilization: null},
      })],
    },
  ]);

  assert.equal(result.species[0].biological_types[0].reproduction_rules.fertilization, null);
});

test('World Model analysis preserves original non-human sex-label capabilities', async () => {
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
    Object.values(type.capabilities).every(value => value === true)
  )));
});

test('World Model analysis preserves normalized lifecycle text for a retained original type', async () => {
  const result = await analyzeDescription('阶纹生物存在阶序型；阶序型通过修炼等级提升和力量进阶完成 progression。', [
    {
      name: '阶纹生物',
      biological_types: [typeFixture('阶序型', {
        lifecycle: {maturation: '修炼等级达到九阶。', aging: '力量进阶持续进行。'},
      })],
    },
  ]);

  assert.deepEqual(result.species[0].biological_types[0].lifecycle, {
    maturation: '修炼等级达到九阶。',
    aging: '力量进阶持续进行。',
  });
});

test('World Model analysis does not rewrite generic capabilities from source-only negatives', async () => {
  const result = await analyzeDescription('晶巢种男性不能产生精子，也不能被受精。', [
    {name: '晶巢种', biological_types: [structuredFixtureType('男性')]},
  ]);
  assert.equal(result.species[0].biological_types[0].capabilities.can_produce_sperm, null);
  assert.equal(result.species[0].biological_types[0].capabilities.can_be_fertilized, null);
  assert.equal(result.species[0].biological_types[0].capabilities.can_fertilize, null);
});

test('World Model analysis keeps absent or pseudo-pregnancy raw capabilities unknown', async () => {
  const result = await analyzeDescription('女性镜生体没有证据证明可以怀孕；仅存在假孕现象，无实际妊娠记录。', [
    {name: '镜生体', biological_types: [structuredFixtureType('女性')]},
  ]);
  assert.deepEqual(result.species[0].biological_types[0].capabilities, {
    can_produce_sperm: null,
    can_produce_ova: null,
    can_be_fertilized: null,
    can_fertilize: null,
    can_carry_pregnancy: null,
  });
});

test('World Model analysis keeps generic null capabilities despite source-only inability', async () => {
  const result = await analyzeDescription('女性镜生体不能怀孕，也无法被受精。', [
    {name: '镜生体', biological_types: [structuredFixtureType('女性')]},
  ]);
  assert.deepEqual(result.species[0].biological_types[0].capabilities, {
    can_produce_sperm: null,
    can_produce_ova: null,
    can_be_fertilized: null,
    can_fertilize: null,
    can_carry_pregnancy: null,
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
    can_produce_sperm: false,
    can_produce_ova: true,
    can_be_fertilized: true,
    can_fertilize: false,
    can_carry_pregnancy: true,
  });
  assert.deepEqual(type.reproduction_rules, {
    fertilization: '按人类方式受精。',
    pregnancy_or_carrying: '按人类方式妊娠。',
    cycle: '约28天。',
    ovulation: '排卵。',
    gestation: '约40周。',
    labor: '按人类方式分娩。',
  });
});

test('World Model final guard preserves explicit Human rules while applying structural absences', async () => {
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
    fertilization: '体内受精',
    pregnancy_or_carrying: '无',
    cycle: '约28天',
    ovulation: '无',
    gestation: '无',
    labor: '无',
  });
  assert.deepEqual(female.reproduction_rules, {
    fertilization: '体内受精',
    pregnancy_or_carrying: '妊娠',
    cycle: '约28天',
    ovulation: '约28天一次排卵',
    gestation: '约40周',
    labor: '分娩产程',
  });
});

test('World Model final guard marks non-human rules absent when capabilities are false', async () => {
  const result = await analyzeDescription(
    '潮汐生物男性不能怀孕，但规则记载妊娠约40周和分娩产程；潮汐生物男性不能产生卵子，但记录会排卵；潮汐生物男性存在发情期和体内受精规则。',
    [{
      name: '潮汐生物',
      biological_types: [typeFixture('男性', {
        capabilities: {
          can_produce_sperm: null,
          can_produce_ova: false,
          can_be_fertilized: null,
          can_fertilize: null,
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
      })],
    }],
  );
  const type = result.species[0].biological_types[0];

  assert.equal(type.capabilities.can_produce_ova, false);
  assert.equal(type.capabilities.can_carry_pregnancy, false);
  assert.equal(type.reproduction_rules.fertilization, '体内受精');
  assert.equal(type.reproduction_rules.pregnancy_or_carrying, '无');
  assert.equal(type.reproduction_rules.cycle, '存在发情期。');
  assert.equal(type.reproduction_rules.ovulation, '无');
  assert.equal(type.reproduction_rules.gestation, '无');
  assert.equal(type.reproduction_rules.labor, '无');
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

test('World Model final guard preserves known absence for fertilization', async () => {
  const result = await analyzeDescription('雾核体甲型明确不存在受精机制。', [{
    name: '雾核体',
    biological_types: [typeFixture('甲型', {
      capabilities: {
        can_produce_sperm: null,
        can_produce_ova: null,
        can_be_fertilized: false,
        can_fertilize: false,
        can_carry_pregnancy: null,
      },
      reproduction_rules: {fertilization: '无'},
    })],
  }]);

  assert.equal(result.species[0].biological_types[0].reproduction_rules.fertilization, '无');
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

test('World Model final guard preserves roleless fertilization text for mixed capability states', async () => {
  const cases = [
    {can_be_fertilized: null, can_fertilize: false},
    {can_be_fertilized: false, can_fertilize: null},
  ];
  const rule = '两种微粒在回声腔内完成结合并形成新个体。';

  for (const capabilities of cases) {
    const result = await analyzeDescription('澄屿体的黏炽型明确存在该生殖分类。', [{
      name: '澄屿体',
      biological_types: [structuredFixtureType('黏炽型', null, {
        capabilities,
        reproduction_rules: {fertilization: rule},
      })],
    }]);

    assert.equal(result.species[0].biological_types[0].reproduction_rules.fertilization, rule);
  }
});

test('World Model final guard still clears direct fertilization role conflicts', async () => {
  const cases = [
    {
      typeName: '受纳型',
      capabilities: {can_be_fertilized: false},
      rule: '卵细胞可在内囊中被精子受精。',
    },
    {
      typeName: '供化型',
      capabilities: {can_fertilize: false},
      rule: '通过精子使卵细胞受精。',
    },
  ];

  for (const item of cases) {
    const result = await analyzeDescription(`澄屿体的${item.typeName}明确存在该生殖分类。`, [{
      name: '澄屿体',
      biological_types: [structuredFixtureType(item.typeName, null, {
        capabilities: item.capabilities,
        reproduction_rules: {fertilization: item.rule},
      })],
    }]);

    assert.equal(result.species[0].biological_types[0].reproduction_rules.fertilization, null);
  }
});

test('World Model final guard preserves all non-empty rules when capabilities are unknown', async () => {
  const reproductionRules = {
    fertilization: '两种微粒在回声腔内完成结合。',
    pregnancy_or_carrying: '黏炽型可以承载新生体。',
    cycle: '黏炽型按潮汐阶段循环。',
    ovulation: '黏炽型按阶段释放配子。',
    gestation: '新生体在内囊中经历阶段性发育。',
    labor: '成熟个体通过裂解过程离体。',
  };
  const lifecycle = {
    maturation: '达到成熟阶段后进入稳定期。',
    aging: '衰老过程随时间逐步发生。',
  };
  const result = await analyzeDescription('澄屿体的黏炽型明确存在。', [{
    name: '澄屿体',
    biological_types: [structuredFixtureType('黏炽型', null, {
      reproduction_rules: reproductionRules,
      lifecycle,
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
  assert.deepEqual(type.reproduction_rules, reproductionRules);
  assert.deepEqual(type.lifecycle, lifecycle);
});

test('World Model Human baseline fills only null fields and preserves explicit deltas', async () => {
  const result = await analyzeDescription('资料明确存在人类男性和女性。', [{
    name: '人类',
    biological_types: [
      structuredFixtureType('男性', null, {
        capabilities: {
          can_produce_sperm: false,
          can_produce_ova: true,
          can_be_fertilized: null,
          can_fertilize: false,
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
  }]);
  const [male, female] = result.species[0].biological_types;

  assert.deepEqual(male.capabilities, {
    can_produce_sperm: false,
    can_produce_ova: true,
    can_be_fertilized: false,
    can_fertilize: false,
    can_carry_pregnancy: true,
  });
  assert.deepEqual(male.reproduction_rules, {
    fertilization: '无',
    pregnancy_or_carrying: '当前男性可承担妊娠。',
    cycle: '当前男性周期描述。',
    ovulation: '当前男性排卵描述。',
    gestation: '无',
    labor: '无',
  });
  assert.deepEqual(female.capabilities, {
    can_produce_sperm: true,
    can_produce_ova: false,
    can_be_fertilized: true,
    can_fertilize: true,
    can_carry_pregnancy: true,
  });
  assert.deepEqual(female.reproduction_rules, {
    fertilization: '当前女性受精描述。',
    pregnancy_or_carrying: '无',
    cycle: '通常约28天一个周期。',
    ovulation: '无',
    gestation: '当前女性妊娠描述。',
    labor: '通过分娩完成生产。',
  });
});

test('World Model keeps non-human evidence boundaries without applying Human baseline', async () => {
  const result = await analyzeDescription('澄屿体明确存在男性分类，但没有说明其生殖机制。', [{
    name: '澄屿体',
    biological_types: [
      structuredFixtureType('男性'),
      structuredFixtureType('女性', null, {
        capabilities: {
          can_produce_sperm: true,
          can_produce_ova: true,
          can_be_fertilized: true,
          can_fertilize: true,
          can_carry_pregnancy: true,
        },
      }),
    ],
  }]);
  const species = result.species[0];

  assert.deepEqual(species.biological_types.map(type => type.name), ['男性']);
  assert.deepEqual(species.biological_types[0].capabilities, {
    can_produce_sperm: null,
    can_produce_ova: null,
    can_be_fertilized: null,
    can_fertilize: null,
    can_carry_pregnancy: null,
  });
  assert.deepEqual(species.biological_types[0].reproduction_rules, {
    fertilization: null,
    pregnancy_or_carrying: null,
    cycle: null,
    ovulation: null,
    gestation: null,
    labor: null,
  });
});

test('World Model Human baseline yields only the established female type', async () => {
  const result = await analyzeDescription('普通人类资料明确说明角色为女性。', [
    {name: '人类', biological_types: [structuredFixtureType('女性'), structuredFixtureType('男性')]},
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

test('World Model can use an implicit Human baseline without a Human label', async () => {
  const result = await analyzeDescription('普通城市社会中的一名男性加入某条路线；资料没有声明独立物种来源。', [
    {name: '人类', biological_types: [structuredFixtureType('男性'), structuredFixtureType('女性')]},
  ]);

  const [type] = result.species[0].biological_types;
  assert.equal(type.name, '男性');
  assert.deepEqual(type.capabilities, {
    can_produce_sperm: true,
    can_produce_ova: false,
    can_be_fertilized: false,
    can_fertilize: true,
    can_carry_pregnancy: false,
  });
});

test('World Model applies a Human delta to one capability and keeps other baseline fields', async () => {
  const result = await analyzeDescription('男性加入某条路线后明确可以承担妊娠；没有说明其它基础机制改变。', [{
    name: '人类',
    biological_types: [structuredFixtureType('男性', null, {
      capabilities: {
        can_produce_sperm: null,
        can_produce_ova: null,
        can_be_fertilized: null,
        can_fertilize: null,
        can_carry_pregnancy: true,
      },
      reproduction_rules: {
        pregnancy_or_carrying: '该路线允许男性承担妊娠。',
      },
    })],
  }]);

  const type = result.species[0].biological_types[0];
  assert.deepEqual(type.capabilities, {
    can_produce_sperm: true,
    can_produce_ova: false,
    can_be_fertilized: false,
    can_fertilize: true,
    can_carry_pregnancy: true,
  });
  assert.equal(type.reproduction_rules.pregnancy_or_carrying, '该路线允许男性承担妊娠。');
  assert.equal(type.reproduction_rules.cycle, '无');
  assert.equal(type.reproduction_rules.gestation, '无');
});

test('World Model applies a Human reproduction-rule delta without clearing the female baseline', async () => {
  const result = await analyzeDescription('女性接受某项改造后，妊娠期明确为六个月；没有说明其它生理机制改变。', [{
    name: '人类',
    biological_types: [structuredFixtureType('女性', null, {
      reproduction_rules: {gestation: '该改造后的妊娠期为六个月。'},
    })],
  }]);

  const type = result.species[0].biological_types[0];
  assert.equal(type.capabilities.can_produce_ova, true);
  assert.equal(type.capabilities.can_carry_pregnancy, true);
  assert.equal(type.reproduction_rules.gestation, '该改造后的妊娠期为六个月。');
  assert.equal(type.reproduction_rules.cycle, '通常约28天一个周期。');
  assert.equal(type.reproduction_rules.labor, '通过分娩完成生产。');
});

test('World Model does not use implicit Human fallback when an independent species is explicit', async () => {
  const result = await analyzeInput({
    character: {description: '璃穹体男性可以承担妊娠，但资料没有说明普通人类背景。'},
  }, [
    {name: '人类', biological_types: [structuredFixtureType('男性')]},
    {name: '璃穹体', biological_types: [structuredFixtureType('男性')]},
  ]);

  assert.deepEqual(result.species.map(species => species.name), ['璃穹体']);
  assert.deepEqual(result.species[0].biological_types[0].capabilities, {
    can_produce_sperm: null,
    can_produce_ova: null,
    can_be_fertilized: null,
    can_fertilize: null,
    can_carry_pregnancy: null,
  });
});

test('World Model keeps source unknown instead of defaulting an unsupported Human type', async () => {
  const result = await analyzeDescription('一个陌生生命的来源、身体结构和生理体系均未说明。', [
    {name: '人类', biological_types: [structuredFixtureType('男性')]},
  ]);

  assert.deepEqual(result.species, []);
});

test('World Model preserves the current transformed species label and its synthesized fields', async () => {
  const result = await analyzeDescription('某角色永久变化后被明确称为沧烬种；沧烬种男性仍能产生精子，但不能承担妊娠。', [{
    name: '沧烬种',
    biological_types: [structuredFixtureType('男性', null, {
      capabilities: {
        can_produce_sperm: true,
        can_produce_ova: false,
        can_be_fertilized: false,
        can_fertilize: true,
        can_carry_pregnancy: false,
      },
    })],
  }]);

  assert.deepEqual(result.species.map(species => species.name), ['沧烬种']);
  assert.deepEqual(result.species[0].biological_types[0].capabilities, {
    can_produce_sperm: true,
    can_produce_ova: false,
    can_be_fertilized: false,
    can_fertilize: true,
    can_carry_pregnancy: false,
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
  assert.match(prompt, /Human baseline 与显式 delta/);
  assert.match(prompt, /唯一内置的现实生物 baseline/);
  assert.match(prompt, /Human baseline 不创建缺失 type/);
  assert.match(prompt, /明确当前个体事实 > 明确转化后\/特殊体系规则 > 明确世界级规则 > 可靠推断的 Human baseline > 未知/);
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
  assert.match(prompt, /Human baseline 不创建缺失 type/);
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
  assert.match(prompt, /null 只表示未知、未提及、证据不足或无法判断/);
  assert.match(prompt, /“无”只表示已经知道不存在、明确不具备或明确不适用/);
  assert.match(prompt, /非 Human 没有资料时必须保持 null/);
  assert.match(prompt, /输出前进行内部自检（不要输出过程）/);
  assert.match(prompt, /没有可靠答案就把字段降为 null 或删除错误 type/);
  assert.doesNotMatch(prompt, /妖|魔|剑灵|精灵|兽人|极少女剑灵/);
});

test('World Model prompt requires a full biological type candidate gate without worldview examples', () => {
  const prompt = buildWorldModelMessages()[0].content;

  for (const pattern of [
    /species.*这是什么生物/u,
    /biological_type.*稳定.*生理.*生殖/u,
    /必须同时满足/u,
    /普通 taxonomy 子类/u,
    /职业.*身份.*社会角色.*组织归属/u,
    /等级.*成长阶段.*训练状态/u,
    /疾病或异常.*个体特质.*行为模式/u,
    /AnalysisInput.*充分.*证据/u,
    /biological_types: \[\].*优于错误分类/u,
    /只有一个.*候选.*不能.*自动/u,
    /A\..*稳定生物分类/u,
    /E\..*证据/u,
  ]) {
    assert.match(prompt, pattern);
  }
  assert.doesNotMatch(prompt, /例如|比如|示例/u);
});

test('World Model prompt defines conditional implicit Human baseline and field-level delta', () => {
  const prompt = buildWorldModelMessages()[0].content;

  assert.match(prompt, /完整 AnalysisInput.*Character Card、Worldbook、Recent Story、External Memory/u);
  assert.match(prompt, /没有 Human 字样.*不是充分条件/u);
  assert.match(prompt, /类人外形、男性\/女性称谓、性交行为或社会结构本身都不是充分条件/u);
  assert.match(prompt, /明确当前个体事实 > 明确转化后\/特殊体系规则 > 明确世界级规则 > 可靠推断的 Human baseline > 未知/u);
  assert.match(prompt, /delta 只覆盖明确改变的字段，其余稳定字段保留/u);
  assert.match(prompt, /当前 species label.*不新增 source_species、origin 或 inheritance 字段/u);
  assert.match(prompt, /个体 Human 来源也不能自动扩展为整个新 species 的来源/u);
  assert.match(prompt, /gestation 只描述真实妊娠或孕育过程，非妊娠的身体转化不属于 gestation/u);
  assert.doesNotMatch(prompt, /例如|比如|示例/u);
});

test('World Model keeps an empty type list when original evidence only names other classification axes', async () => {
  const result = await analyzeDescription(
    '澄砂体是一种独立生命 species。资料只提到成员身份为巡航员、等级为第三阶，并描述某角色短暂进入短昼态后恢复原状；没有建立稳定生理分类。',
    [{name: '澄砂体', biological_types: []}],
  );

  assert.deepEqual(result.species.map(species => species.name), ['澄砂体']);
  assert.deepEqual(result.species[0].biological_types, []);
});

test('World Model does not turn a single derived member label into a biological type', async () => {
  const result = await analyzeDescription(
    '烁环体已被记录为一个 species；资料中只出现成员称呼“雾航者”，没有证明它是稳定的生理或生殖分类。',
    [{name: '烁环体', biological_types: []}],
  );

  assert.deepEqual(result.species[0].biological_types, []);
});

test('World Model preserves multiple explicitly established stable biological classifications with null capabilities', async () => {
  const result = await analyzeDescription(
    '霜脉种稳定存在内核型和外壳型两种生殖生理分类；资料没有说明这两类的五项 capability。',
    [{
      name: '霜脉种',
      biological_types: [structuredFixtureType('内核型'), structuredFixtureType('外壳型')],
    }],
  );

  assert.deepEqual(result.species[0].biological_types.map(type => type.name), ['内核型', '外壳型']);
  assert.ok(result.species[0].biological_types.every(type => (
    Object.values(type.capabilities).every(value => value === null)
  )));
});

test('World Model keeps progression outside lifecycle when the AI returns no biological lifecycle evidence', async () => {
  const result = await analyzeDescription(
    '纤潮体存在稳定生理分类“环核型”，但资料只描述训练阶级提升、技能等级和力量 progression，没有生物成熟或衰老事实。',
    [{name: '纤潮体', biological_types: [structuredFixtureType('环核型')]}],
  );

  assert.deepEqual(result.species[0].biological_types[0].lifecycle, {maturation: null, aging: null});
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

test('settings debug preview shows temporary Raw and Canonical trace in Chinese', () => {
  const html = settingsPage({
    analysisPreview: {
      worldModelTrace: {
        rawResponse: '{"species":[{"name":"弧晶体","biological_types":[{"name":"甲相"}]}]}',
        canonicalModel: {
          schema_version: 1,
          species: [{name: '弧晶体', biological_types: [{name: '甲相'}]}],
        },
      },
    },
  });

  assert.match(html, /AI 原始返回/);
  assert.match(html, /规范化后的世界模型/);
  assert.match(html, /弧晶体/);
  assert.match(html, /甲相/);
  assert.doesNotMatch(html, /api_key|secret_ref|authorization/iu);
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
      biological_types: [typeFixture('双性')],
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

test('World UI Fixture A keeps one species, two types, descriptions, fixed fields, and exception labels', () => {
  assert.equal(fixtureA.species.length, 1);
  assert.equal(fixtureA.species[0].biological_types.length, 2);
  assert.deepEqual(Object.keys(fixtureA.species[0].biological_types[0].capabilities).sort(), [
    'can_be_fertilized',
    'can_carry_pregnancy',
    'can_fertilize',
    'can_produce_ova',
    'can_produce_sperm',
  ]);
  assert.deepEqual(Object.keys(fixtureA.species[0].biological_types[0].reproduction_rules).sort(), [
    'cycle',
    'fertilization',
    'gestation',
    'labor',
    'ovulation',
    'pregnancy_or_carrying',
  ]);
  assert.deepEqual(Object.keys(fixtureA.species[0].biological_types[0].lifecycle).sort(), ['aging', 'maturation']);

  const firstTypeHtml = worldPage({
    worldModel: fixtureA,
    selectedSpeciesIndex: 0,
    selectedTypeIndex: 0,
  });
  assert.match(firstTypeHtml, /Fixture A 物种描述。/);
  assert.match(firstTypeHtml, /第二行仍然可读。/);
  assert.match(firstTypeHtml, /Fixture A 类型一描述。/);
  assert.match(firstTypeHtml, /类型说明第二行。/);
  assert.match(firstTypeHtml, /Fixture A 受精方式|Fixture A 妊娠方式|Fixture A 生理周期/);
  assert.match(firstTypeHtml, /Fixture A 排卵机制|Fixture A 妊娠周期|Fixture A 分娩方式/);
  assert.match(firstTypeHtml, /Fixture A 成熟|Fixture A 衰老|Fixture A 特殊规则/);
  assert.match(firstTypeHtml, /Fixture A 分娩难度|Fixture A 照护水平|Fixture A 医疗依据/);
  assert.match(firstTypeHtml, /Fixture A 例外主文本/);
  assert.match(firstTypeHtml, /Fixture A 无附加标签的例外/);
  assert.match(firstTypeHtml, /适用对象：Fixture A 适用对象/);
  assert.match(firstTypeHtml, /依据：Fixture A 例外依据/);
  assert.equal((firstTypeHtml.match(/适用对象：/g) ?? []).length, 1);
  assert.equal((firstTypeHtml.match(/依据：/g) ?? []).length, 1);
  assert.match(firstTypeHtml, /Fixture A 尚未确定项/);
  assert.match(firstTypeHtml, />是<\/dd>/);
  assert.match(firstTypeHtml, />否<\/dd>/);
  assert.match(firstTypeHtml, />未知<\/dd>/);

  const secondTypeHtml = worldPage({
    worldModel: fixtureA,
    selectedSpeciesIndex: 0,
    selectedTypeIndex: 1,
  });
  assert.match(secondTypeHtml, /Fixture A 类型二描述。/);
  assert.match(secondTypeHtml, /data-bioweave-world-section="special_rules"/);
  assert.match(secondTypeHtml, /尚未确定|未知/);
  assert.doesNotMatch(secondTypeHtml, /适用对象：<\/small>|依据：<\/small>/);
});

test('World UI Fixture B maps four species and all dynamic type descriptions', () => {
  assert.equal(fixtureB.species.length, 4);
  assert.deepEqual(fixtureB.species.map(species => species.biological_types.length), [2, 1, 0, 3]);

  const html = worldPage({
    worldModel: fixtureB,
    selectedSpeciesIndex: 3,
    selectedTypeIndex: 2,
  });
  assert.equal((html.match(/data-bioweave-action="world-model-select-type"/g) ?? []).length, 6);
  for (const species of fixtureB.species) {
    assert.match(html, new RegExp(species.name));
    assert.match(html, new RegExp(species.description));
    for (const type of species.biological_types) {
      assert.match(html, new RegExp(type.name));
    }
  }
  assert.match(html, /Fixture B 类型四丙描述。/);
  assert.match(html, /尚未识别出生物类型/);
  assert.match(html, /<h3 class="bioweave-world-model-module-title">特殊例外<\/h3>/);
  assert.match(html, /<h3 class="bioweave-world-model-module-title">尚未确定<\/h3>/);
  assert.match(html, /<p class="bioweave-empty">未知<\/p>/);

  for (const [speciesIndex, species] of fixtureB.species.entries()) {
    for (const [typeIndex] of species.biological_types.entries()) {
      assert.deepEqual(resolveWorldModelSelection(fixtureB, speciesIndex, typeIndex), {
        speciesIndex,
        typeIndex,
      });
      const selectedHtml = worldPage({
        worldModel: fixtureB,
        selectedSpeciesIndex: speciesIndex,
        selectedTypeIndex: typeIndex,
      });
      for (const section of ['capabilities', 'reproduction_rules', 'lifecycle', 'special_rules']) {
        assert.equal(
          (selectedHtml.match(new RegExp(`<section class="[^\"]*bioweave-world-model-module[^\"]*" data-bioweave-world-section="${section}"`, 'g')) ?? []).length,
          1,
          `${species.name} type ${typeIndex} should render ${section}`,
        );
      }
      if (speciesIndex === 0 && typeIndex === 0) {
        assert.match(selectedHtml, /Fixture B 规则甲/);
      }
      for (const label of [
        '可产生精子', '可产生卵子', '可被受精', '可使其受精', '可承担妊娠',
        '受精方式', '妊娠方式', '生理周期', '排卵机制', '妊娠周期', '分娩方式',
        '成熟', '衰老',
      ]) {
        assert.equal((selectedHtml.match(new RegExp(`<dt>${label}<\\/dt>`, 'g')) ?? []).length, 1);
      }
    }
  }
});

test('World UI description CSS keeps type and mobile species descriptions visible', () => {
  assert.match(STYLE_SOURCE, /\.bioweave-world-model-page \.bioweave-world-model-description\s*\{[^}]*white-space:\s*pre-wrap[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(STYLE_SOURCE, /\.bioweave-world-model-page \.bioweave-world-model-type-detail\s*>\s*\.bioweave-world-model-description\s*\{[^}]*display:\s*block[^}]*max-height:\s*none[^}]*overflow:\s*visible/s);
  assert.match(STYLE_SOURCE, /\.bioweave-world-model-page \.bioweave-world-model-species-card\s*>\s*\.bioweave-world-model-description\s*\{[^}]*display:\s*-webkit-box/s);
  assert.doesNotMatch(STYLE_SOURCE, /\.bioweave-world-model(?:-page\s+)?(?:\.bioweave-world-model-)?type-detail\s*>\s*\.bioweave-world-model-description\s*\{[^}]*display:\s*none/s);
  assert.doesNotMatch(STYLE_SOURCE, /\.bioweave-world-model(?:-page\s+)?\.bioweave-world-model-species-card\s*>\s*\.bioweave-world-model-description\s*\{[^}]*display:\s*none/s);
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
