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
  biological_types: [{
    name: '潮汐生物',
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

test('World Model schema keeps capability unknowns as null and drops extra fields', () => {
  const model = normalizeWorldModel({...modelFixture, gender: '不要推断', extra: '不要保存'});
  assert.deepEqual(model, modelFixture);
  assert.equal(Object.hasOwn(model, 'gender'), false);
  assert.equal(Object.hasOwn(model.biological_types[0], 'gender'), false);
  assert.deepEqual(WORLD_MODEL_SCHEMA.biological_types[0].capabilities, {
    can_produce_sperm: null,
    can_produce_ova: null,
    can_be_fertilized: null,
    can_fertilize: null,
    can_carry_pregnancy: null,
  });
  assert.deepEqual(WORLD_MODEL_SCHEMA.biological_types[0].reproduction_rules, {
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

test('World Model legacy fixtures keep old fields and default new fields to null', () => {
  const legacy = structuredClone(modelFixture);
  delete legacy.medical_context;
  delete legacy.biological_types[0].reproduction_rules.ovulation;
  delete legacy.biological_types[0].reproduction_rules.gestation;
  delete legacy.biological_types[0].reproduction_rules.labor;
  const normalized = normalizeWorldModel(legacy);
  assert.deepEqual(normalized.biological_types[0].reproduction_rules, {
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
  rawModel.biological_types[0] = {
    ...rawModel.biological_types[0],
    name: '双性/间性人类',
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
  assert.equal(parsed.biological_types[0].name, '双性/间性人类');
  assert.deepEqual(parsed.biological_types[0].capabilities, {
    can_produce_sperm: true,
    can_produce_ova: null,
    can_be_fertilized: false,
    can_fertilize: null,
    can_carry_pregnancy: null,
  });
});

test('World Model analysis does not keep an unsupported bisexual/intersex type', async () => {
  const response = structuredClone(modelFixture);
  response.biological_types.push({
    ...structuredClone(modelFixture.biological_types[0]),
    name: '双性/间性人类',
  });
  const analyzer = createAnalyzer({
    profileResolver: () => SILLYTAVERN_CURRENT_API,
    contextResolver: () => ({generateRaw: () => JSON.stringify(response)}),
  });

  const result = await analyzer.analyzeWorldModel({
    analysisInput: {
      persona: {description: '用户自述为双性，但人物设定不参与 World Model。'},
      character: {description: '资料只出现男性和女性。'},
    },
  });

  assert.deepEqual(result.biological_types.map(type => type.name), ['潮汐生物']);
});

test('World Model analysis keeps a bisexual/intersex type when source evidence is explicit', async () => {
  const response = structuredClone(modelFixture);
  response.biological_types.push({
    ...structuredClone(modelFixture.biological_types[0]),
    name: '双性/间性人类',
  });
  const analyzer = createAnalyzer({
    profileResolver: () => SILLYTAVERN_CURRENT_API,
    contextResolver: () => ({generateRaw: () => JSON.stringify(response)}),
  });

  const result = await analyzer.analyzeWorldModel({
    analysisInput: {
      character: {description: '角色是明确的双性人类。'},
    },
  });

  assert.deepEqual(result.biological_types.map(type => type.name), ['潮汐生物', '双性/间性人类']);
});

test('World Model parser localizes common English human labels before saving', () => {
  const parsed = normalizeWorldModel({
    ...modelFixture,
    biological_types: [{
      ...modelFixture.biological_types[0],
      name: 'Homo sapiens (男性)',
      description: 'Human male type',
      special_rules: ['Humans have a known rule.'],
    }],
    medical_context: {
      ...modelFixture.medical_context,
      evidence: 'Human childbirth evidence',
    },
    exceptions: ['Homo sapiens exception'],
    unknowns: ['Human cycle unknown'],
  });

  assert.equal(parsed.biological_types[0].name, '人类 (男性)');
  assert.equal(parsed.biological_types[0].description, '人类 男性 type');
  assert.equal(parsed.biological_types[0].special_rules[0], '人类 have a known rule.');
  assert.equal(parsed.medical_context.evidence, '人类 childbirth evidence');
  assert.equal(parsed.exceptions[0].statement, '人类 exception');
  assert.equal(parsed.unknowns[0], '人类 cycle unknown');
  assert.doesNotMatch(JSON.stringify(parsed), /\bHomo\s+sapiens\b|\bHumans?\b|\bmale\b|\bfemale\b/i);
});

test('World Analysis request uses ordinary chat messages for current and independent APIs', async () => {
  const analysisInput = {
    persona: {name: '用户甲', description: '用户人物设定私密内容，不应发送'},
    character: {description: '只作为输入证据 {{user}}'},
    worldbooks: [{source_id: 'book-1', name: '内部书名不应发送', entries: [{entry_id: 'entry-1', label: '内部条目名不应发送', token_estimate: 8, content: '规则证据 {{user}}'}]}],
    recent_story: {enabled: true, items: [{floor: 81, role: 'assistant', content: '楼层证据 {{user}}'}]},
    external_memory: [],
    meta: {chat_id: 'chat-a', user_name: '用户甲', character_name: '角色甲'},
  };
  const requests = [];
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
    assert.deepEqual(result, modelFixture);
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
    character: {description: '角色性别为女性，但资料没有说明其物种。'},
    worldbooks: [{entries: [{content: '当前世界医疗条件：城市有产科医院和急救设施。'}]}],
  });
  const prompt = messages[0].content;
  assert.match(prompt, /Homo sapiens/);
  assert.match(prompt, /人类/);
  assert.match(prompt, /排卵.*ovulation/);
  assert.match(prompt, /受精.*fertilization/);
  assert.match(prompt, /妊娠\/孕期.*gestation/);
  assert.match(prompt, /分娩\/产程周期.*labor cycle/);
  assert.match(prompt, /必须在对应人类 biological_type 的 reproduction_rules 中分别输出/);
  assert.match(prompt, /这四个基线字段都必须是非空说明，不得为 null/);
  assert.match(prompt, /28 天月经周期/);
  assert.match(prompt, /妊娠约 40 周/);
  assert.match(prompt, /该人类基线只适用于明确识别的人类类型/);
  assert.match(prompt, /未知.*非人类/);
  assert.match(prompt, /性别.*gender.*外貌.*身体形态/);
  assert.match(prompt, /medical_context/);
  assert.match(messages[1].content, /当前世界医疗条件：城市有产科医院和急救设施/);
  assert.match(prompt, /childbirth_difficulty.*care_level.*evidence/);
});

test('World Model prompt treats default male/female资料 as human without non-human evidence', () => {
  const messages = buildWorldModelMessages({
    character: {description: '资料只呈现默认男性/女性二元，没有明确非人类证据。'},
  });
  const prompt = messages[0].content;
  assert.match(prompt, /只呈现默认男性\/女性二元、且没有明确非人类证据，则物种识别按人类处理/);
  assert.match(prompt, /明确非人类证据优先/);
  assert.match(prompt, /capabilities.*不能从 gender/);
});

test('World Model prompt adds bisexual/intersex types only with explicit AnalysisInput evidence', () => {
  const messages = buildWorldModelMessages({
    character: {description: '明确证据：角色是双性/间性，并明确可产生精子。'},
  });
  const prompt = messages[0].content;
  assert.match(prompt, /只有当本次 AnalysisInput 出现明确的双性\/间性身份、身体\/生殖特征或规则证据时，才在 biological_types 中加入对应类型/);
  assert.match(messages[1].content, /明确证据：角色是双性\/间性，并明确可产生精子/);
  assert.match(prompt, /双性\/间性类型只有在有明确证据并被加入后才参与规则分析/);
  assert.match(prompt, /必须逐项依据明确证据判断 can_produce_sperm、can_produce_ova、can_be_fertilized、can_fertilize、can_carry_pregnancy/);
  assert.match(prompt, /每个能力独立判断，证据不足的单项使用 null/);
  assert.match(prompt, /不能因为双性\/间性标签自动把所有能力设为 true 或 false/);
});

test('World Model prompt rejects bisexual/intersex types inferred from default male/female input', () => {
  const messages = buildWorldModelMessages({
    character: {description: '资料只呈现默认男性/女性二元，没有其它生殖类型描述。'},
  });
  const prompt = messages[0].content;
  assert.match(prompt, /默认人类基础类型只包含男性和女性；双性\/间性不是默认类型/);
  assert.match(prompt, /默认男性\/女性且没有明确双性\/间性证据时，绝不能生成双性\/间性类型/);
  assert.doesNotMatch(prompt, /默认人类基础类型包含男性、女性和双性\/间性/);
  assert.match(messages[1].content, /资料只呈现默认男性\/女性二元/);
  assert.doesNotMatch(messages[1].content, /双性\/间性/);
});

test('World Model prompt requires Chinese string values and human type names', () => {
  const prompt = buildWorldModelMessages()[0].content;
  assert.match(prompt, /JSON 的 key 必须严格保持 schema 规定的英文/);
  assert.match(prompt, /所有字符串值必须使用中文/);
  assert.match(prompt, /name、description、生殖规则、生命周期、special_rules、exceptions、unknowns、medical_context/);
  assert.match(prompt, /默认人类基础类型只包含男性和女性/);
  assert.match(prompt, /只有当本次 AnalysisInput 出现明确的双性\/间性身份、身体\/生殖特征或规则证据时/);
  assert.match(prompt, /name 只能写“人类”“男性”“女性”“双性\/间性”等中文名称/);
  assert.match(prompt, /Homo sapiens、Human 或其它英文标签/);
  assert.match(prompt, /不得把这些英文标签写入任何字符串值/);
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
  assert.match(html, /可承担妊娠/);
  assert.match(html, /世界医疗条件/);
  assert.match(html, /生育难易度/);
  assert.match(html, /当前资料不足以确定难度/);
  assert.match(html, /未知/);
  assert.equal(/\b(?:unknown|null|undefined|N\/A)\b/i.test(html), false);
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
