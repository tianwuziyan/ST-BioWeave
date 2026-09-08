import { callOpenAICompatible } from './client.js';
import {buildPrompt, buildWorldModelMessages, WORLD_MODEL_SCHEMA} from './prompts.js';

const CAPABILITY_KEYS = Object.freeze([
  'can_produce_sperm',
  'can_produce_ova',
  'can_be_fertilized',
  'can_fertilize',
  'can_carry_pregnancy',
]);

const WORLD_RULE_KEYS = Object.freeze([
  'fertilization',
  'pregnancy_or_carrying',
  'cycle',
  'ovulation',
  'gestation',
  'labor',
]);
const LIFECYCLE_KEYS = Object.freeze(['maturation', 'aging']);
const MEDICAL_CONTEXT_KEYS = Object.freeze(['childbirth_difficulty', 'care_level', 'evidence']);
const UNKNOWN_TEXT = new Set(['unknown', 'null', 'undefined', 'n/a', '未知', '不确定']);
const COMPOSITE_DUAL_LABEL_PATTERN = /双性\s*[\/／]\s*间性/gu;
const DUAL_TERM_PATTERN = /双性(?!化|恋)/u;
const NEGATED_DUAL_CONTEXT_PATTERN = /(?:没有|无|不存在|不是|并非|不属于|未(?:说明|提及|发现)|不确定|可能|或许|也许|模糊|不要|不应|不生成|不创建|不能|无法|禁止)[^。！？!?；;，,、\n]{0,8}\s*$/u;
const TEMPORARY_DUAL_PHRASE_PATTERN = /(?:(?:临时|暂时|短暂)(?:地)?\s*)?(?:(?:可以|能够|能|可|会|允许|可能|或许|也许)(?:\s*(?:临时|暂时|短暂)(?:地)?)?\s*)?(?:(?:变为|变成|转为|转换为|转化为|变化为|修改为|改造成)\s*)双性|(?:(?:临时|暂时|短暂)(?:地)?\s*)?(?:(?:可以|能够|能|可|会|允许|可能|或许|也许)(?:\s*(?:临时|暂时|短暂)(?:地)?)?\s*)?(?:(?:是|为)\s*)?双性(?:化|状态)|(?:(?:临时|暂时|短暂)(?:地)?\s*|(?:可以|能够|能|可|会|允许|可能|或许|也许)\s*)(?:是|为)\s*双性/gu;
const MALE_EVIDENCE_PATTERN = /(?:男性|男人|男孩|男生|雄性|男子|男剑灵|(?:性别|角色|人物|个体)\s*(?:是|为|属于|[:：])?\s*男(?:性)?|\bmale\b|\bman\b|\bboy\b)/iu;
const FEMALE_EVIDENCE_PATTERN = /(?:女性|女人|女孩|女生|少女|雌性|女子|女剑灵|(?:性别|角色|人物|个体)\s*(?:是|为|属于|[:：])?\s*女(?:性)?|\bfemale\b|\bwoman\b|\bgirl\b)/iu;
const NEGATED_LABEL_CONTEXT_PATTERN = /(?:没有|无|不存在|并非|不是|非|未(?:有|见|说明|提及|发现|出现)|不含|不确定|不明确|不清楚|可能|或许|也许|是否)[^。！？!?；;，,、\n]{0,24}$/u;
const UNKNOWN_LABEL_SUFFIX_PATTERN = /(?:未知|不确定|不明确|不清楚|模糊)\s*$/u;
const DIRECT_AMBIGUOUS_TYPE = '性别模糊';
const FAMILIAR_TYPE_NAMES = new Set(['男性', '女性', '双性']);

function invalidWorldModel(message = 'WORLD_MODEL_INVALID') {
  const error = new Error(message);
  error.code = 'WORLD_MODEL_INVALID';
  return error;
}

function nullableText(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw invalidWorldModel();
  const text = value.trim();
  return UNKNOWN_TEXT.has(text.toLowerCase()) ? null : text || null;
}

// 归一化模型可能返回的常见人类标签，避免拉丁学名泄露到用户可见 World Model。
function localizedWorldModelText(value) {
  const text = nullableText(value);
  if (!text) return text;
  return text
    .replace(/\bHomo\s+sapiens\b/gi, '人类')
    .replace(/\bHumans?\b/gi, '人类')
    .replace(/\bfemale\b/gi, '女性')
    .replace(/\bmale\b/gi, '男性')
    .replace(COMPOSITE_DUAL_LABEL_PATTERN, '双性');
}

function nullableBoolean(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') throw invalidWorldModel();
  const text = value.trim().toLowerCase();
  if (UNKNOWN_TEXT.has(text)) return null;
  if (['true', 'yes', '是'].includes(text)) return true;
  if (['false', 'no', '否'].includes(text)) return false;
  throw invalidWorldModel();
}

function stringList(value, mapText = nullableText) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    if (typeof value === 'string' && value.trim()) return [mapText(value)].filter(Boolean);
    throw invalidWorldModel();
  }
  return [...new Set(value.map(item => mapText(item)).filter(Boolean))];
}

function objectOrEmpty(value) {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidWorldModel();
  return value;
}

function normalizeBiologicalTypeName(value, parentSpeciesName) {
  const name = localizedWorldModelText(value);
  if (!name) return name;
  const compactName = name.replace(/\s+/gu, '');
  const compactParent = String(parentSpeciesName ?? '').replace(/\s+/gu, '');
  if (/^双性(?:人类|类型|分类|个体|生物|性别|身份|体质|特征|者|体)$/.test(compactName)) return '双性';
  for (const familiarName of FAMILIAR_TYPE_NAMES) {
    if (compactName === `${familiarName}人类` || (compactParent && compactName === `${familiarName}${compactParent}`)) {
      return familiarName;
    }
  }
  return name;
}

function normalizeBiologicalType(raw, index, parentSpeciesName) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalidWorldModel(`WORLD_MODEL_TYPE_${index}`);
  const capabilities = objectOrEmpty(raw.capabilities);
  const reproductionRules = objectOrEmpty(raw.reproduction_rules);
  const lifecycle = objectOrEmpty(raw.lifecycle);
  return {
    name: normalizeBiologicalTypeName(raw.name, parentSpeciesName),
    description: localizedWorldModelText(raw.description),
    capabilities: Object.fromEntries(CAPABILITY_KEYS.map(key => [key, nullableBoolean(capabilities[key])])),
    reproduction_rules: Object.fromEntries(WORLD_RULE_KEYS.map(key => [key, localizedWorldModelText(reproductionRules[key])])),
    lifecycle: Object.fromEntries(LIFECYCLE_KEYS.map(key => [key, localizedWorldModelText(lifecycle[key])])),
    special_rules: stringList(raw.special_rules, localizedWorldModelText),
  };
}

function normalizeSpecies(raw, index, {strict = false} = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalidWorldModel(`WORLD_MODEL_SPECIES_${index}`);
  if (strict && !Array.isArray(raw.biological_types)) throw invalidWorldModel(`WORLD_MODEL_SPECIES_${index}`);
  if (raw.biological_types !== undefined && !Array.isArray(raw.biological_types)) throw invalidWorldModel(`WORLD_MODEL_SPECIES_${index}`);
  const speciesName = localizedWorldModelText(raw.name);
  const biologicalTypes = Array.isArray(raw.biological_types)
    ? raw.biological_types.map((item, typeIndex) => normalizeBiologicalType(item, typeIndex, speciesName))
    : [];
  return {
    name: speciesName,
    description: localizedWorldModelText(raw.description),
    biological_types: biologicalTypes,
  };
}

function normalizeExceptions(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalidWorldModel();
  return value.map(item => {
    if (typeof item === 'string') {
      return {statement: localizedWorldModelText(item), applies_to: null, evidence: null};
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw invalidWorldModel();
    return {
      statement: localizedWorldModelText(item.statement),
      applies_to: localizedWorldModelText(item.applies_to),
      evidence: localizedWorldModelText(item.evidence),
    };
  });
}

function normalizeMedicalContext(value) {
  const medicalContext = objectOrEmpty(value);
  return Object.fromEntries(MEDICAL_CONTEXT_KEYS.map(key => [key, localizedWorldModelText(medicalContext[key])]));
}

// 只收集实际发送给 World Model 的正文，避免把用户人物设定或内部元数据当成世界证据。
function worldModelEvidenceText(input = {}) {
  const parts = [];
  const character = input?.character && typeof input.character === 'object' ? input.character : {};
  parts.push(character.description);
  for (const greeting of Array.isArray(character.greetings) ? character.greetings : []) {
    parts.push(greeting?.content);
  }
  for (const worldbook of Array.isArray(input?.worldbooks) ? input.worldbooks : []) {
    for (const entry of Array.isArray(worldbook?.entries) ? worldbook.entries : []) {
      parts.push(entry?.content);
    }
  }
  const recentStory = input?.recent_story && typeof input.recent_story === 'object' ? input.recent_story : {};
  for (const item of Array.isArray(recentStory.items) ? recentStory.items : []) {
    parts.push(item?.content);
  }
  for (const provider of Array.isArray(input?.external_memory) ? input.external_memory : []) {
    for (const item of Array.isArray(provider?.items) ? provider.items : []) {
      parts.push(item?.content);
    }
  }
  return parts.filter(value => typeof value === 'string').join('\n');
}

function evidenceClauses(input) {
  return worldModelEvidenceText(input)
    .replace(COMPOSITE_DUAL_LABEL_PATTERN, '双性')
    .split(/[。！？!?；;，,、\n]+/u)
    .map(value => value.trim())
    .filter(Boolean);
}

function hasLabelEvidence(input, pattern) {
  return evidenceClauses(input).some(clause => {
    const match = clause.match(pattern);
    if (!match) return false;
    const before = clause.slice(0, match.index ?? 0).slice(-12);
    const after = clause.slice((match.index ?? 0) + match[0].length).slice(0, 12);
    if (NEGATED_LABEL_CONTEXT_PATTERN.test(before)) return false;
    if (/^\s*(?:不存在|没有|未(?:有|见|说明|提及|发现|出现)|不确定|不明确|不清楚|模糊)/u.test(after)) return false;
    if (UNKNOWN_LABEL_SUFFIX_PATTERN.test(after)) return false;
    return true;
  });
}

function hasFixedDualEvidence(input) {
  return evidenceClauses(input).some(clause => {
    const stableClause = clause.replace(TEMPORARY_DUAL_PHRASE_PATTERN, '').trim();
    const dualMatch = stableClause.match(DUAL_TERM_PATTERN);
    if (!dualMatch) return false;
    const beforeDual = stableClause.slice(0, dualMatch.index ?? 0).slice(-20);
    if (NEGATED_DUAL_CONTEXT_PATTERN.test(beforeDual)) return false;
    return /(?:^|[：:])\s*双性|双性(?:个体|人|生物|类型|分类|性别|身份|体质|特征|存在者|者|体|存在|是|为|属于)|(?:是|为|属于|定义为|分类为|归类为|存在(?:着)?|包括|包含|出现|有|分为|明确为|固定(?:为)?|本身(?:是|为)?|角色(?:本身)?(?:是|为)?|个体(?:是|为)?|物种(?:是|为)?|种族(?:是|为)?|性别|世界规则|规则|设定|具有|具备|呈现|表现为|规定|记载|说明|明确)[^。！？!?；;，,、\n]{0,16}双性/u.test(stableClause);
  });
}

function normalizeAnalysisType(type, speciesName) {
  const name = normalizeBiologicalTypeName(type?.name, speciesName);
  return name === type?.name ? type : {...type, name};
}

function isObservedNonBiologicalType(name, speciesName) {
  const normalizedName = String(name ?? '').replace(/\s+/gu, '');
  const normalizedSpecies = String(speciesName ?? '').replace(/\s+/gu, '');
  if (!normalizedName || normalizedName === normalizedSpecies || normalizedName === DIRECT_AMBIGUOUS_TYPE) return true;
  if (normalizedSpecies === '妖' && ['妖修', '半兽人'].includes(normalizedName)) return true;
  if (normalizedSpecies === '魔' && normalizedName === '魔族') return true;
  if (normalizedSpecies === '剑灵' && ['妖剑剑灵', '魔剑灵'].includes(normalizedName)) return true;
  return false;
}

function isUnsupportedFamiliarType(name, evidence) {
  if (!FAMILIAR_TYPE_NAMES.has(name)) return false;
  if (name === '男性') return !hasLabelEvidence(evidence, MALE_EVIDENCE_PATTERN);
  if (name === '女性') return !hasLabelEvidence(evidence, FEMALE_EVIDENCE_PATTERN);
  return !hasFixedDualEvidence(evidence);
}

function isDualTypeName(name) {
  const text = String(name ?? '');
  return DUAL_TERM_PATTERN.test(text) || /双性(?:化|状态)/u.test(text);
}

function isUnsupportedDualUnknown(value) {
  return /双性(?:个体|个人|人|生物|类型|分类|性别|能力|生育|受精)/u.test(String(value ?? ''));
}

// AI 分析才经过证据边界；手动编辑保存的 World Model 只经过结构规范化。
function applyWorldModelEvidenceGuard(model, analysisInput) {
  const hasFixedDual = hasFixedDualEvidence(analysisInput);
  const species = [];
  for (const item of model.species) {
    const biologicalTypes = item.biological_types
      .map(type => normalizeAnalysisType(type, item.name))
      .filter(type => !isObservedNonBiologicalType(type.name, item.name))
      .filter(type => !isUnsupportedFamiliarType(type.name, analysisInput))
      .filter(type => hasFixedDual || !isDualTypeName(type.name));
    species.push({...item, biological_types: biologicalTypes});
  }
  return {
    ...model,
    species,
    unknowns: hasFixedDual ? model.unknowns : model.unknowns.filter(value => !isUnsupportedDualUnknown(value)),
  };
}

// 将 AI 或手动编辑结果收敛到唯一的 World Model v1 结构。
export function normalizeWorldModel(raw, {strict = false} = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalidWorldModel();
  if (strict && Number(raw.schema_version) !== WORLD_MODEL_SCHEMA.schema_version) throw invalidWorldModel();
  if (raw.schema_version !== undefined && Number(raw.schema_version) !== WORLD_MODEL_SCHEMA.schema_version) {
    throw invalidWorldModel();
  }
  // v1 曾把 biological_types 放在顶层，但无法从旧结果安全推断 species 归属，因此不做迁移。
  if (Object.hasOwn(raw, 'biological_types')) throw invalidWorldModel();
  if (strict && (!Array.isArray(raw.species) || !Array.isArray(raw.exceptions) || !Array.isArray(raw.unknowns))) {
    throw invalidWorldModel();
  }
  if (raw.species !== undefined && !Array.isArray(raw.species)) throw invalidWorldModel();
  const species = Array.isArray(raw.species)
    ? raw.species.map((item, index) => normalizeSpecies(item, index, {strict}))
    : [];
  return {
    schema_version: WORLD_MODEL_SCHEMA.schema_version,
    species,
    medical_context: normalizeMedicalContext(raw.medical_context),
    exceptions: normalizeExceptions(raw.exceptions),
    unknowns: stringList(raw.unknowns, localizedWorldModelText),
  };
}

export function validateWorldModel(raw) {
  return normalizeWorldModel(raw, {strict: true});
}

function responseText(raw) {
  if (typeof raw === 'string') return raw;
  if (!raw || typeof raw !== 'object') return '';
  if (typeof raw.text === 'string') return raw.text;
  if (typeof raw.content === 'string') return raw.content;
  if (Array.isArray(raw.content)) {
    return raw.content.map(item => typeof item === 'string' ? item : item?.text ?? '').join('');
  }
  const choice = Array.isArray(raw.choices) ? raw.choices[0] : null;
  if (typeof choice?.message?.content === 'string') return choice.message.content;
  if (Array.isArray(choice?.message?.content)) {
    return choice.message.content.map(item => typeof item === 'string' ? item : item?.text ?? '').join('');
  }
  if (typeof choice?.text === 'string') return choice.text;
  if (raw.data && typeof raw.data === 'object') return responseText(raw.data);
  return '';
}

function jsonCandidates(text) {
  const value = String(text ?? '').trim();
  if (!value) return [];
  const candidates = [value];
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(value.slice(start, end + 1));
  return [...new Set(candidates.filter(Boolean))];
}

// 只接受 JSON 对象并在持久化前完成 schema 规范化，不把原始响应写入 Chat。
export function parseWorldModelResponse(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.schema_version !== undefined) {
    return validateWorldModel(raw);
  }
  for (const candidate of jsonCandidates(responseText(raw))) {
    try {
      return validateWorldModel(JSON.parse(candidate));
    } catch {
      // 继续尝试代码围栏或正文中的 JSON 对象，最终统一返回安全错误。
    }
  }
  throw invalidWorldModel();
}

// 只保存来源数量、范围和状态，不保存 AnalysisInput 正文。
export function summarizeAnalysisInput(input = {}) {
  const character = input?.character ?? {};
  const greetings = Array.isArray(character.greetings) ? character.greetings : [];
  const worldbooks = Array.isArray(input?.worldbooks) ? input.worldbooks : [];
  const recentStory = input?.recent_story ?? {};
  const externalMemory = Array.isArray(input?.external_memory) ? input.external_memory : [];
  return {
    character_fields: (character.description ? 1 : 0) + greetings.length,
    worldbooks: worldbooks.length,
    worldbook_entries: worldbooks.reduce((total, book) => total + (Array.isArray(book?.entries) ? book.entries.length : 0), 0),
    recent_story: {
      enabled: recentStory.enabled === true,
      floor_count: Number(recentStory.floor_count) || 0,
      floor_start: recentStory.floor_start ?? null,
      floor_end: recentStory.floor_end ?? null,
      floors_read: Array.isArray(recentStory.items) ? recentStory.items.length : 0,
    },
    external_memory: externalMemory.map(provider => ({
      key: String(provider?.key ?? ''),
      label: String(provider?.label ?? provider?.key ?? ''),
      enabled: provider?.enabled === true,
      read_status: String(provider?.read_status ?? 'unknown'),
      status: String(provider?.status ?? ''),
    })),
    token_estimate: Number(input?.token_estimate) || 0,
  };
}

export function createAnalyzer({profileResolver, contextResolver, requestSettingsResolver, worldModelPromptResolver} = {}) {
  function requestOptions(input = {}) {
    return {
      signal: input.signal,
      context: contextResolver?.(),
      requestSettings: requestSettingsResolver?.(),
    };
  }

  async function run(task, input = {}) {
    const profile = profileResolver?.(task);
    if (!profile) throw new Error('API_PROFILE_NOT_CONFIGURED');
    const content = buildPrompt({task, ...input});
    return callOpenAICompatible(profile, [{role: 'system', content}], requestOptions(input));
  }

  async function analyzeWorldModel(input = {}) {
    const profile = profileResolver?.('world_analysis') ?? profileResolver?.('world');
    if (!profile) throw new Error('API_PROFILE_NOT_CONFIGURED');
    const messages = buildWorldModelMessages(
      input.analysisInput ?? input,
      worldModelPromptResolver?.() ?? {},
    );
    const raw = await callOpenAICompatible(profile, messages, requestOptions(input));
    const model = parseWorldModelResponse(raw);
    return applyWorldModelEvidenceGuard(model, input.analysisInput ?? input);
  }

  return {
    analyzeWorldModel,
    analyzeWorld: analyzeWorldModel,
    analyzeFloor: input => run('event', input),
    generateProjection: input => run('projection', input),
  };
}
