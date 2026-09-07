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
const INTERSEX_EVIDENCE_PATTERN = /(?:双性(?!恋)|间性|雌雄同体|阴阳人|intersex|hermaphrodite)/iu;

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
    .replace(/\bmale\b/gi, '男性');
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

function normalizeBiologicalType(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalidWorldModel(`WORLD_MODEL_TYPE_${index}`);
  const capabilities = objectOrEmpty(raw.capabilities);
  const reproductionRules = objectOrEmpty(raw.reproduction_rules);
  const lifecycle = objectOrEmpty(raw.lifecycle);
  return {
    name: localizedWorldModelText(raw.name),
    description: localizedWorldModelText(raw.description),
    capabilities: Object.fromEntries(CAPABILITY_KEYS.map(key => [key, nullableBoolean(capabilities[key])])),
    reproduction_rules: Object.fromEntries(WORLD_RULE_KEYS.map(key => [key, localizedWorldModelText(reproductionRules[key])])),
    lifecycle: Object.fromEntries(LIFECYCLE_KEYS.map(key => [key, localizedWorldModelText(lifecycle[key])])),
    special_rules: stringList(raw.special_rules, localizedWorldModelText),
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

function hasExplicitIntersexEvidence(input) {
  return INTERSEX_EVIDENCE_PATTERN.test(worldModelEvidenceText(input));
}

function isIntersexType(type) {
  return INTERSEX_EVIDENCE_PATTERN.test(typeof type?.name === 'string' ? type.name : '');
}

// AI 分析不能凭空新增双性/间性类型；手动编辑保存的 World Model 不经过此过滤。
function removeUnsupportedIntersexTypes(model, analysisInput) {
  if (hasExplicitIntersexEvidence(analysisInput)) return model;
  return {
    ...model,
    biological_types: model.biological_types.filter(type => !isIntersexType(type)),
  };
}

// 将 AI 或手动编辑结果收敛到唯一的 World Model v1 结构。
export function normalizeWorldModel(raw, {strict = false} = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalidWorldModel();
  if (strict && Number(raw.schema_version) !== WORLD_MODEL_SCHEMA.schema_version) throw invalidWorldModel();
  if (raw.schema_version !== undefined && Number(raw.schema_version) !== WORLD_MODEL_SCHEMA.schema_version) {
    throw invalidWorldModel();
  }
  if (strict && (!Array.isArray(raw.biological_types) || !Array.isArray(raw.exceptions) || !Array.isArray(raw.unknowns))) {
    throw invalidWorldModel();
  }
  if (raw.biological_types !== undefined && !Array.isArray(raw.biological_types)) throw invalidWorldModel();
  const biologicalTypes = Array.isArray(raw.biological_types)
    ? raw.biological_types.map(normalizeBiologicalType)
    : [];
  return {
    schema_version: WORLD_MODEL_SCHEMA.schema_version,
    biological_types: biologicalTypes,
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
    return removeUnsupportedIntersexTypes(model, input.analysisInput ?? input);
  }

  return {
    analyzeWorldModel,
    analyzeWorld: analyzeWorldModel,
    analyzeFloor: input => run('event', input),
    generateProjection: input => run('projection', input),
  };
}
