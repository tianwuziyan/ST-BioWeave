import { callOpenAICompatible, traceApi } from './client.js';
import * as eventDomain from '../core/events.js';
import {
  buildEventAnalysisMessages,
  buildHealthAssessmentMessages,
  buildPrompt,
  buildWorldModelMessages,
  buildWorldModelPatchMessagesV2,
  EVENT_STATUS,
  EVENT_TYPES,
  WORLD_MODEL_SCHEMA,
} from './prompts.js';
import { normalizeProjectionRules, validateProjectionRuleContent } from '../core/projection-eligibility.js';
import { rejectArchivedSpeciesFact, rejectArchivedSpeciesOperation } from '../core/world-species-archive.js';
import {canonicalWorldSpeciesName, isCanonicalWorldHumanSpecies} from '../core/world-species-identity.js';
import {
  buildWorldModelSupplementCoverageTargets,
  buildWorldModelSupplementIdentityReviewSubjects,
  parseWorldModelFactDeltaJson,
  summarizeWorldModelSupplementIdentityDiversity,
  validateWorldModelSupplementCompleteness,
  worldModelSupplementCoverageCardinality,
  validateWorldModelFactDelta,
  SUPPLEMENT_CANONICAL_WRITABILITY_REGISTRY,
  worldModelUnknownId,
} from './world-supplement-protocol.js';
import {fingerprintWorldModelString, stableWorldModelStringify} from '../utils/world-model-debug.js';
import {normalizeHealthAssessment, validateHealthAssessment} from '../core/health-assessment.js';

const WORLD_MODEL_DEBUG_SCHEMA_VERSION = 3;

const CAPABILITY_KEYS = Object.freeze([
  'can_produce_sperm',
  'can_produce_ova',
  'can_be_fertilized',
  'can_fertilize',
  'can_cause_pregnancy',
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
const MEDICAL_CONTEXT_KEYS = Object.freeze([
  'childbirth_difficulty',
  'care_level',
  'evidence',
]);
const UNKNOWN_TEXT = new Set([
  'unknown',
  'null',
  'undefined',
  'n/a',
  '未知',
  '不确定',
]);
const COMPOSITE_DUAL_LABEL_PATTERN = /双性\s*[\/／]\s*间性/gu;
const DUAL_TERM_PATTERN = /双性(?!化|恋)/u;
const NEGATED_DUAL_CONTEXT_PATTERN =
  /(?:没有|无|不存在|不是|并非|不属于|未(?:说明|提及|发现)|不确定|可能|或许|也许|模糊|不要|不应|不生成|不创建|不能|无法|禁止)[^。！？!?；;，,、\n]{0,8}\s*$/u;
const TEMPORARY_DUAL_PHRASE_PATTERN =
  /(?:(?:临时|暂时|短暂)(?:地)?\s*)?(?:(?:可以|能够|能|可|会|允许|可能|或许|也许)(?:\s*(?:临时|暂时|短暂)(?:地)?)?\s*)?(?:(?:变为|变成|转为|转换为|转化为|变化为|修改为|改造成)\s*)双性|(?:(?:临时|暂时|短暂)(?:地)?\s*)?(?:(?:可以|能够|能|可|会|允许|可能|或许|也许)(?:\s*(?:临时|暂时|短暂)(?:地)?)?\s*)?(?:(?:是|为)\s*)?双性(?:化|状态)|(?:(?:临时|暂时|短暂)(?:地)?\s*|(?:可以|能够|能|可|会|允许|可能|或许|也许)\s*)(?:是|为)\s*双性/gu;
const MALE_EVIDENCE_PATTERN =
  /(?:男性|男人|男孩|男生|雄性|男子|(?:性别|角色|人物|个体)\s*(?:是|为|属于|[:：])?\s*男(?:性)?|\bmale\b|\bman\b|\bboy\b)/iu;
const FEMALE_EVIDENCE_PATTERN =
  /(?:女性|女人|女孩|女生|少女|雌性|女子|(?:性别|角色|人物|个体)\s*(?:是|为|属于|[:：])?\s*女(?:性)?|\bfemale\b|\bwoman\b|\bgirl\b)/iu;
const NEGATED_LABEL_CONTEXT_PATTERN =
  /(?:没有|无|不存在|并非|不是|非|未(?:有|见|说明|提及|发现|出现)|不含|不确定|不明确|不清楚|可能|或许|也许|是否)[^。！？!?；;，,、\n]{0,24}$/u;
const UNKNOWN_LABEL_SUFFIX_PATTERN = /(?:未知|不确定|不明确|不清楚|模糊)\s*$/u;
const CAPABILITY_EVIDENCE_PATTERNS = Object.freeze({
  can_produce_sperm:
    /(?:产生|生成|制造|分泌|拥有|含有|具备)[^。！？!?；;\n，,]{0,8}(?:精子|精液|雄性配子)|(?:精子|精液|雄性配子)[^。！？!?；;\n，,]{0,8}(?:产生|生成|制造|分泌|拥有|含有|具备)/iu,
  can_produce_ova:
    /(?:产生|生成|制造|分泌|拥有|含有|具备)[^。！？!?；;\n，,]{0,8}(?:卵子|卵细胞|雌性配子)|(?:卵子|卵细胞|雌性配子)[^。！？!?；;\n，,]{0,8}(?:产生|生成|制造|分泌|拥有|含有|具备)/iu,
  can_be_fertilized:
    /(?:被|接受|可被|能被|能够被|可以被)[^。！？!?；;\n，,]{0,8}受精|(?:可|能|能够|可以|会|不能|无法|不可|不会)受精(?:能力)?|受精[^。！？!?；;\n，,]{0,8}(?:能力|资格)/iu,
  can_fertilize:
    /(?:使|让|令)[^。！？!?；;\n，,]{0,8}受精|授精|(?:可|能|能够|可以|会|不能|无法|不可|不会)[^。！？!?；;\n，,]{0,8}(?:使|让|令)[^。！？!?；;\n，,]{0,8}受精/iu,
  can_cause_pregnancy:
    /(?:导致|引发|造成|使|让|令)[^。！？!?；;\n，,]{0,12}(?:怀孕|妊娠|受孕|孕育)/iu,
  can_carry_pregnancy: /(?:怀孕|妊娠|孕育|携带胎儿|承担妊娠|妊娠能力|生育)/iu,
});
const REPRODUCTION_RULE_EVIDENCE_PATTERNS = Object.freeze({
  fertilization: /受精|授精|配子结合|精卵结合|fertiliz/iu,
  pregnancy_or_carrying:
    /怀孕|妊娠|孕育|受孕|携带胎儿|承担妊娠|母体|pregnan|carrying/iu,
  cycle:
    /发情期|发情周期|生理期|月经(?:周期)?|排卵周期|繁殖周期|生殖周期|性周期|热期|cycle/iu,
  ovulation: /排卵|卵巢排出|ovulation/iu,
  gestation:
    /孕期|妊娠期|妊娠时长|妊娠|孕周|孕期时长|(?:孕育|怀孕)[^。！？!?；;\n，,]{0,8}(?:月|周|天)|gestation/iu,
  labor: /分娩|产程|生产|接生|labor/iu,
});
const LIFECYCLE_EVIDENCE_PATTERNS = Object.freeze({
  maturation: /成熟|性成熟|成年|发育|maturation/iu,
  aging: /衰老|老化|寿命|长生|老去|aging|lifespan/iu,
});
const EXPLICIT_NEGATIVE_CAPABILITY_PATTERN =
  /(?:不能|无法|不可|不会|不具备|未具备|不产生|不生成|不制造|不分泌|不孕育|不可能|不支持|不具有|不含有|(?:不被|不接受)(?:受精|授精)|(?:没有|无(?!法)|不存在)(?:任何|该|其)?(?:产生精子|产生卵子|怀孕|妊娠|生育|受精)(?:能力|可能性|资格|条件))/u;
const NON_EVIDENCE_CAPABILITY_PATTERN =
  /(?:仅(?:存在|有)?[^。！？!?；;\n，,、]{0,16}(?:假孕|假性妊娠)|(?:无(?!法)|没有|未(?:有|能|观察到|记录|发现|实际)?|尚无|暂无|目前没有|没有实际|无实际)[^。！？!?；;\n，,、]{0,16}(?:妊娠|怀孕|生育|精子|卵子|受精|能力|记录|证据|观察))/u;
const UNSPECIFIED_FIELD_CONTEXT_PATTERN =
  /(?:没有(?:明确|说明|提及|描述|提供)|未(?:明确|说明|提及|描述|提供)|不确定|不明确|不清楚|未知|尚未(?:明确|说明)|无从判断)[^。！？!?；;，,、\n]{0,10}$/u;
const UNKNOWN_RULE_TEXT_PATTERN =
  /^(?:未知|不确定|不知道|未(?:说明|提及|提到|描述|提供)|没有(?:说明|提及|提到|描述|提供|资料|相关资料|对应资料)|资料不足|证据不足|无法(?:判断|确定)|不能(?:判断|确定)|不明确|不清楚|不明|尚未(?:明确|说明)|暂无(?:资料|记录|证据))$/u;
const KNOWN_ABSENT_RULE_PATTERN =
  /^(?:无|无(?:此|该|相关)?(?:功能|机制|规则|过程|能力)|(?:不具备|不具有|不含有|不适用|不存在)(?:此|该|相关)?(?:功能|机制|规则|过程|能力)?|没有(?:此|该|相关)?(?:功能|机制|规则|过程|能力))$/u;
const DIRECT_AMBIGUOUS_TYPE = '性别模糊';
const FAMILIAR_TYPE_NAMES = new Set(['男性', '女性', '双性']);
const GENERIC_SPECIES_TYPE_SUFFIXES = Object.freeze(['族', '类', '种', '人']);
const TYPE_PARENT_SPECIES = Symbol('world_model_parent_species');
const TYPE_KNOWN_SPECIES = Symbol('world_model_known_species');
const TYPE_SIBLING_NAMES = Symbol('world_model_sibling_names');

function invalidWorldModel(message = 'WORLD_MODEL_INVALID', details = {}) {
  const error = new Error(message);
  error.code = 'WORLD_MODEL_INVALID';
  error.analysis_stage = details.stage ?? 'schema_validation';
  error.stage = details.stage ?? 'schema_validation';
  error.diagnosticCode = details.diagnosticCode ?? 'WORLD_MODEL_SCHEMA_INVALID';
  if (details.path) error.path = details.path;
  if (details.expected) error.expected = details.expected;
  if (details.received) error.received = details.received;
  if (details.validator) error.validator = details.validator;
  return error;
}

function nullableText(value, path) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw invalidWorldModel('WORLD_MODEL_INVALID', { path, expected: 'string|null', received: Array.isArray(value) ? 'array' : typeof value, validator: 'nullableText' });
  const text = value.trim();
  return UNKNOWN_TEXT.has(text.toLowerCase()) ? null : text || null;
}

// 归一化模型可能返回的常见人类标签，避免拉丁学名泄露到用户可见 World Model。
function localizedWorldModelText(value, path) {
  const text = nullableText(value, path);
  if (!text) return text;
  return text
    .replace(/\bHomo\s+sapiens\b/gi, '人类')
    .replace(/\bHumans?\b/gi, '人类')
    .replace(/\bfemale\b/gi, '女性')
    .replace(/\bmale\b/gi, '男性')
    .replace(COMPOSITE_DUAL_LABEL_PATTERN, '双性');
}

function normalizeRuleText(value, path) {
  const text = localizedWorldModelText(value, path);
  if (!text) return text;
  const compact = text.replace(/\s+/gu, '').replace(/[。！？!?]+$/gu, '');
  if (UNKNOWN_RULE_TEXT_PATTERN.test(compact)) return null;
  return KNOWN_ABSENT_RULE_PATTERN.test(compact) ? '无' : text;
}

function nullableBoolean(value, path) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') throw invalidWorldModel('WORLD_MODEL_INVALID', { path, expected: 'boolean|null', received: Array.isArray(value) ? 'array' : typeof value, validator: 'nullableBoolean' });
  const text = value.trim().toLowerCase();
  if (UNKNOWN_TEXT.has(text)) return null;
  if (['true', 'yes', '是'].includes(text)) return true;
  if (['false', 'no', '否'].includes(text)) return false;
  throw invalidWorldModel('WORLD_MODEL_INVALID', { path, expected: 'boolean|null', received: 'string', validator: 'nullableBoolean' });
}

function stringList(value, mapText = nullableText, { strict = false, path } = {}) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    if (!strict && typeof value === 'string' && value.trim())
      return [mapText(value, path)].filter(Boolean);
    throw invalidWorldModel('WORLD_MODEL_INVALID', { path, expected: 'array<string>', received: Array.isArray(value) ? 'array' : typeof value });
  }
  return [
    ...new Set(
      value
        .map((item, index) =>
          mapText(item, path ? `${path}[${index}]` : undefined),
        )
        .filter(Boolean),
    ),
  ];
}

function objectOrEmpty(value, path) {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw invalidWorldModel('WORLD_MODEL_INVALID', { path, expected: 'object', received: Array.isArray(value) ? 'array' : typeof value });
  return value;
}

function normalizeBiologicalTypeName(value, parentSpeciesName) {
  const name = localizedWorldModelText(value);
  if (!name) return name;
  const compactName = name.replace(/\s+/gu, '');
  const compactParent = String(parentSpeciesName ?? '').replace(/\s+/gu, '');
  if (
    /^双性(?:人类|类型|分类|个体|生物|性别|身份|体质|特征|者|体)$/.test(
      compactName,
    )
  )
    return '双性';
  for (const familiarName of FAMILIAR_TYPE_NAMES) {
    if (
      compactName === `${familiarName}人类` ||
      (compactParent && compactName === `${familiarName}${compactParent}`)
    ) {
      return familiarName;
    }
  }
  return name;
}

function normalizeBiologicalType(raw, index, parentSpeciesName, { strict = false, path = `biological_types[${index}]` } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw invalidWorldModel(`WORLD_MODEL_TYPE_${index}`);
  const capabilities = objectOrEmpty(raw.capabilities, `${path}.capabilities`);
  const reproductionRules = objectOrEmpty(raw.reproduction_rules, `${path}.reproduction_rules`);
  const lifecycle = objectOrEmpty(raw.lifecycle, `${path}.lifecycle`);
  const mechanismValues = raw.reproductive_mechanisms;
  if (mechanismValues !== undefined && !Array.isArray(mechanismValues))
    throw invalidWorldModel('WORLD_MODEL_INVALID', {
      path: `${path}.reproductive_mechanisms`,
      expected: 'array',
      received: typeof mechanismValues,
      validator: 'normalizeBiologicalType',
    });
  const reproductiveMechanisms = (Array.isArray(mechanismValues) ? mechanismValues : []).map(
    (item, mechanismIndex) => normalizeReproductiveMechanism(
      item,
      `${path}.reproductive_mechanisms[${mechanismIndex}]`,
    ),
  );
  const normalized = {
    name: normalizeBiologicalTypeName(raw.name, parentSpeciesName),
    description: localizedWorldModelText(raw.description),
    capabilities: Object.fromEntries(
      CAPABILITY_KEYS.map((key) => [key, nullableBoolean(capabilities[key], `${path}.capabilities.${key}`)]),
    ),
    reproduction_rules: Object.fromEntries(
      WORLD_RULE_KEYS.map((key) => [
        key,
        normalizeRuleText(reproductionRules[key], `${path}.reproduction_rules.${key}`),
      ]),
    ),
    lifecycle: Object.fromEntries(
      LIFECYCLE_KEYS.map((key) => [key, normalizeRuleText(lifecycle[key], `${path}.lifecycle.${key}`)]),
    ),
    reproductive_mechanisms: reproductiveMechanisms,
    special_rules: stringList(raw.special_rules, localizedWorldModelText, { path: `${path}.special_rules` }),
  };
  return normalized;
}

function normalizeReproductiveMechanism(raw, path) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw invalidWorldModel('WORLD_MODEL_INVALID', {
      path,
      expected: 'object',
      received: Array.isArray(raw) ? 'array' : typeof raw,
      validator: 'normalizeReproductiveMechanism',
    });
  const ruleRefs = raw.world_model_rule_refs;
  const evidence = raw.evidence;
  if (ruleRefs !== undefined && !Array.isArray(ruleRefs))
    throw invalidWorldModel('WORLD_MODEL_INVALID', {
      path: `${path}.world_model_rule_refs`,
      expected: 'array',
      received: typeof ruleRefs,
      validator: 'normalizeReproductiveMechanism',
    });
  if (evidence !== undefined && !Array.isArray(evidence))
    throw invalidWorldModel('WORLD_MODEL_INVALID', {
      path: `${path}.evidence`,
      expected: 'array',
      received: typeof evidence,
      validator: 'normalizeReproductiveMechanism',
    });
  const normalized = {
    key: nullableText(raw.key),
    label: nullableText(raw.label),
    pathway: nullableText(raw.pathway),
    carrying_compatibility: nullableBoolean(
      raw.carrying_compatibility,
      `${path}.carrying_compatibility`,
    ),
    world_model_rule_refs: stringList(
      ruleRefs,
      localizedWorldModelText,
      { path: `${path}.world_model_rule_refs` },
    ),
    evidence: stringList(evidence, localizedWorldModelText, {
      path: `${path}.evidence`,
    }),
  };
  const horizon = normalizeTrackingWindowHorizon(raw.tracking_window_horizon, `${path}.tracking_window_horizon`);
  if (horizon) normalized.tracking_window_horizon = horizon;
  return normalized;
}

function normalizeTrackingWindowHorizon(raw, path) {
  if (raw === undefined || raw === null) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw invalidWorldModel('WORLD_MODEL_INVALID', {path, expected: 'object|null'});
  const unknown = Object.keys(raw).find(key => !['schema_version', 'max_story_days'].includes(key));
  if (unknown) throw invalidWorldModel('WORLD_MODEL_INVALID', {path: `${path}.${unknown}`});
  const maxDays = Number(raw.max_story_days);
  if (raw.schema_version !== 1 || !Number.isInteger(maxDays) || maxDays < 0)
    throw invalidWorldModel('WORLD_MODEL_INVALID', {path, expected: '{schema_version:1,max_story_days:integer>=0}'});
  return {schema_version: 1, max_story_days: maxDays};
}

function canonicalSpeciesName(value) {
  return canonicalWorldSpeciesName(nullableText(value))
}

function normalizeSpecies(raw, index, { strict = false } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw invalidWorldModel(`WORLD_MODEL_SPECIES_${index}`);
  if (strict && !Array.isArray(raw.biological_types))
    throw invalidWorldModel(`WORLD_MODEL_SPECIES_${index}`);
  if (
    raw.biological_types !== undefined &&
    !Array.isArray(raw.biological_types)
  )
    throw invalidWorldModel(`WORLD_MODEL_SPECIES_${index}`);
  const speciesName = canonicalSpeciesName(raw.name);
  const biologicalTypes = Array.isArray(raw.biological_types)
    ? raw.biological_types.map((item, typeIndex) =>
        normalizeBiologicalType(item, typeIndex, speciesName, { strict, path: `species[${index}].biological_types[${typeIndex}]` }),
      )
    : [];
  return {
    name: speciesName,
    description: localizedWorldModelText(raw.description),
    biological_types: biologicalTypes,
  };
}

function mergeKnownValue(first, second) {
  return first === null || first === undefined ? (second ?? null) : first;
}

function mergeBiologicalTypes(first, second) {
  const mechanismMap = new Map(
    [...(first.reproductive_mechanisms ?? []), ...(second.reproductive_mechanisms ?? [])]
      .map((mechanism) => [mechanism.key ?? mechanism.label ?? mechanism.pathway, mechanism]),
  );
  return {
    ...first,
    description: mergeKnownValue(first.description, second.description),
    capabilities: Object.fromEntries(
      CAPABILITY_KEYS.map((key) => [
        key,
        first.capabilities[key] === null
          ? second.capabilities[key]
          : first.capabilities[key],
      ]),
    ),
    reproduction_rules: Object.fromEntries(
      WORLD_RULE_KEYS.map((key) => [
        key,
        mergeKnownValue(
          first.reproduction_rules[key],
          second.reproduction_rules[key],
        ),
      ]),
    ),
    lifecycle: Object.fromEntries(
      LIFECYCLE_KEYS.map((key) => [
        key,
        mergeKnownValue(first.lifecycle[key], second.lifecycle[key]),
      ]),
    ),
    reproductive_mechanisms: [...mechanismMap.values()],
    special_rules: [
      ...new Set([...first.special_rules, ...second.special_rules]),
    ],
  };
}

function mergeHumanSpeciesEntries(species) {
  const merged = [];
  let humanIndex = -1;
  for (const item of species) {
    if (!isHumanSpeciesName(item.name)) {
      merged.push(item);
      continue;
    }
    const canonical = { ...item, name: '人类' };
    if (humanIndex < 0) {
      humanIndex = merged.length;
      merged.push(canonical);
      continue;
    }
    const current = merged[humanIndex];
    const biologicalTypes = [...current.biological_types];
    for (const type of canonical.biological_types) {
      const existingIndex = biologicalTypes.findIndex(
        (existing) => existing.name === type.name,
      );
      if (existingIndex < 0) {
        biologicalTypes.push(type);
      } else {
        biologicalTypes[existingIndex] = mergeBiologicalTypes(
          biologicalTypes[existingIndex],
          type,
        );
      }
    }
    merged[humanIndex] = {
      ...current,
      description: mergeKnownValue(current.description, canonical.description),
      biological_types: biologicalTypes,
    };
  }
  return merged;
}

function normalizeExceptions(value, { strict = false } = {}) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalidWorldModel('WORLD_MODEL_INVALID', { path: 'exceptions', expected: 'array<object>', received: Array.isArray(value) ? 'array' : typeof value });
  return value.map((item, index) => {
    if (typeof item === 'string') {
      return {
        statement: localizedWorldModelText(item),
        applies_to: null,
        evidence: null,
      };
    }
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw invalidWorldModel('WORLD_MODEL_INVALID', { path: `exceptions[${index}]`, expected: 'object', received: Array.isArray(item) ? 'array' : typeof item });
    const statement =
      [item.statement, item.description, item.name]
        .map((entry) => localizedWorldModelText(entry))
        .find(Boolean) ?? null;
    return {
      statement,
      applies_to: localizedWorldModelText(item.applies_to),
      evidence: localizedWorldModelText(item.evidence),
    };
  });
}

function normalizeMedicalContext(value) {
  const medicalContext = objectOrEmpty(value, 'medical_context');
  return Object.fromEntries(
    MEDICAL_CONTEXT_KEYS.map((key) => [
      key,
      localizedWorldModelText(medicalContext[key]),
    ]),
  );
}

// 只收集实际发送给 World Model 的正文，避免把用户人物设定或内部元数据当成世界证据。
function worldModelEvidenceText(input = {}) {
  const parts = [];
  const character =
    input?.character && typeof input.character === 'object'
      ? input.character
      : {};
  parts.push(character.description);
  for (const greeting of Array.isArray(character.greetings)
    ? character.greetings
    : []) {
    parts.push(greeting?.content);
  }
  for (const worldbook of Array.isArray(input?.worldbooks)
    ? input.worldbooks
    : []) {
    for (const entry of Array.isArray(worldbook?.entries)
      ? worldbook.entries
      : []) {
      parts.push(entry?.content);
    }
  }
  const recentStory =
    input?.recent_story && typeof input.recent_story === 'object'
      ? input.recent_story
      : {};
  for (const item of Array.isArray(recentStory.items)
    ? recentStory.items
    : []) {
    parts.push(item?.content);
  }
  for (const provider of Array.isArray(input?.external_memory)
    ? input.external_memory
    : []) {
    for (const item of Array.isArray(provider?.items) ? provider.items : []) {
      parts.push(item?.content);
    }
  }
  return parts.filter((value) => typeof value === 'string').join('\n');
}

function evidenceUnits(input) {
  return (
    worldModelEvidenceText(input)
      .replace(COMPOSITE_DUAL_LABEL_PATTERN, '双性')
      // 保留逗号连接的同一语义单元，避免拆开同一条 species/type 关系。
      .split(/[。！？!?；;\n]+/u)
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function factDeltaDebugEnabled(input = {}) {
  return input?.fact_delta_debug === true || globalThis?.__BIOWEAVE_API_TRACE__ === true;
}

function factDeltaDiagnosticValue(value, depth = 0) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.slice(0, 240);
  if (depth >= 4) return {type: typeof value};
  if (Array.isArray(value)) return value.slice(0, 32).map(item => factDeltaDiagnosticValue(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).slice(0, 48).map(([key, item]) => [key, factDeltaDiagnosticValue(item, depth + 1)]),
    );
  }
  return {type: typeof value};
}

function worldModelEvidenceParts(input = {}) {
  const parts = [];
  const character = input?.character && typeof input.character === 'object' ? input.character : {};
  parts.push({source_kind: 'character_description', text: character.description});
  for (const greeting of Array.isArray(character.greetings) ? character.greetings : [])
    parts.push({source_kind: 'character_greeting', text: greeting?.content});
  for (const worldbook of Array.isArray(input?.worldbooks) ? input.worldbooks : [])
    for (const entry of Array.isArray(worldbook?.entries) ? worldbook.entries : [])
      parts.push({source_kind: 'worldbook_entry', text: entry?.content});
  const recentStory = input?.recent_story && typeof input.recent_story === 'object' ? input.recent_story : {};
  for (const item of Array.isArray(recentStory.items) ? recentStory.items : [])
    parts.push({source_kind: 'recent_story', text: item?.content});
  for (const provider of Array.isArray(input?.external_memory) ? input.external_memory : [])
    for (const item of Array.isArray(provider?.items) ? provider.items : [])
      parts.push({source_kind: 'external_memory', text: item?.content});
  return parts;
}

function factDeltaEvidenceUnitRecords(input = {}) {
  const speciesLabel = /^(?:[\[({\s"']*)Species\s*[:：=]\s*([^\]})\n,;]+)[\]})\s"']*$/iu;
  const typeLabel = /^(?:[\[({\s"']*)(?:Biological[_ ]?Type|Type)\s*[:：=]\s*([^\]})\n,;]+)[\]})\s"']*$/iu;
  return worldModelEvidenceParts(input).flatMap(({source_kind, text}, source_index) => {
    if (typeof text !== 'string') return [];
    let species = null;
    let biological_type = null;
    const headings = [];
    const records = [];
    for (const [line_index, rawLine] of text.replace(COMPOSITE_DUAL_LABEL_PATTERN, '双性').split('\n').entries()) {
      const line = rawLine.trim();
      if (!line) continue;
      const indentation = rawLine.match(/^\s*/u)?.[0].length ?? 0;
      const headingMatch = rawLine.match(/^\s*(?:[-*]\s*)?([^:：\n]{1,80})\s*[:：]\s*$/u);
      if (headingMatch) {
        while (headings.length && headings.at(-1).indentation >= indentation) headings.pop();
        headings.push({indentation, label: headingMatch[1].trim()});
      }
      for (const segment of line.split(/[。！？!?；;]+/u).map(value => value.trim()).filter(Boolean)) {
        const value = segment;
        const speciesMatch = value.match(speciesLabel);
        if (speciesMatch) {
          species = speciesMatch[1].trim();
          biological_type = null;
        }
        const typeMatch = value.match(typeLabel);
        if (typeMatch) biological_type = typeMatch[1].trim();
        const parent = [...headings.map(item => item.label), species && `Species: ${species}`, biological_type && `Biological_Type: ${biological_type}`]
          .filter(Boolean)
          .join(' | ');
        records.push({
          source_kind,
          source_index,
          line_index,
          text: parent && !value.includes(parent) ? `${parent} | ${value}` : value,
          parent_context: {headings: headings.map(item => item.label), species, biological_type},
        });
      }
    }
    return records;
  });
}

function factDeltaEvidenceUnits(input = {}) {
  return factDeltaEvidenceUnitRecords(input).map(({text}) => text);
}

function factDeltaEvidenceTraceUnits(input = {}) {
  return factDeltaEvidenceUnitRecords(input).map(({source_kind, source_index, line_index, text, parent_context}) => ({
    source_kind,
    source_index,
    line_index,
    text,
    parent_context,
  }));
}

function factDeltaEvidenceGuardUnits(input = {}) {
  return factDeltaEvidenceUnitRecords(input).map((record) => Object.assign(new String(record.text), record));
}

function factDeltaAddress(fact) {
  if (fact?.field === 'Exception' || fact?.field === 'Unknown' || fact?.field === 'Projection_Rule' || !fact?.species) {
    return {scope: 'world'};
  }
  if (fact?.biological_type) {
    return {scope: 'biological_type', species: fact.species, biological_type: fact.biological_type};
  }
  return {scope: 'species', species: fact.species};
}

function factDeltaEvidenceSummary(input = {}) {
  const units = factDeltaEvidenceTraceUnits(input);
  return {
    unit_count: units.length,
    units: units.map(({source_kind, text}, index) => ({
      unit_index: index,
      stable_unit_id: `world-evidence-${index}`,
      source_kind,
      text_length: text.length,
    })),
  };
}

function supplementRequestBaseInput(input = {}, existingModel, candidateModel) {
  const {
    supplement_request_mode: _requestMode,
    supplement_retry_directive: _retryDirective,
    ...baseInput
  } = input && typeof input === 'object' ? input : {};
  return {
    ...baseInput,
    world_model: existingModel,
    supplement_candidate: candidateModel,
    supplement_request_mode: undefined,
    supplement_retry_directive: undefined,
  };
}

async function supplementRequestParity({analysisInput, existingModel, candidateModel, retryDirective, requestMode, promptSettings, messages}) {
  const evidenceUnits = factDeltaEvidenceTraceUnits(analysisInput);
  const evidencePayload = evidenceUnits.map(({source_kind, source_index, line_index, text, parent_context}) => ({
    source_kind,
    source_index,
    line_index,
    text,
    parent_context,
  }));
  const coverageTargets = buildWorldModelSupplementCoverageTargets(candidateModel);
  const baseMessages = buildWorldModelPatchMessagesV2(
    supplementRequestBaseInput(analysisInput, existingModel, candidateModel),
    promptSettings,
  );
  const fingerprint = async value => fingerprintWorldModelString(stableWorldModelStringify(value));
  const [evidenceFingerprint, existingFingerprint, targetFingerprint, analysisPayloadFingerprint, modelRequestPayloadFingerprint, controlDirectiveFingerprint] = await Promise.all([
    fingerprint(evidencePayload),
    fingerprint(existingModel),
    fingerprint(coverageTargets.map(target => ({
      target_id: target.target_id,
      scope: target.scope,
      species: target.species ?? null,
      biological_type: target.biological_type ?? null,
      field: target.field,
      cardinality: target.cardinality,
    })).sort((left, right) => left.target_id.localeCompare(right.target_id))),
    fingerprint(baseMessages),
    fingerprint(messages),
    fingerprint({request_mode: requestMode, directive: retryDirective ?? null}),
  ]);
  return {
    permitted_evidence_fingerprint: evidenceFingerprint.fingerprint,
    existing_reference_fingerprint: existingFingerprint.fingerprint,
    coverage_target_set_fingerprint: targetFingerprint.fingerprint,
    analysis_payload_fingerprint: analysisPayloadFingerprint.fingerprint,
    model_request_payload_fingerprint: modelRequestPayloadFingerprint.fingerprint,
    control_directive_fingerprint: controlDirectiveFingerprint.fingerprint,
    permitted_evidence_char_count: evidencePayload.reduce((total, item) => total + item.text.length, 0),
  };
}

function canonicalCoverageAddress({scope, species = null, biological_type = null, field} = {}) {
  return {
    scope: String(scope ?? '').trim(),
    species: species == null ? null : String(species).trim(),
    biological_type: biological_type == null ? null : String(biological_type).trim(),
    field: String(field ?? '').trim(),
  }
}

function canonicalFactCoverageAddress(fact) {
  return canonicalCoverageAddress({
    ...factDeltaAddress(fact),
    species: fact?.species,
    biological_type: fact?.biological_type,
    field: fact?.field,
  })
}

function coverageAddressEquals(left, right) {
  return stableWorldModelStringify(left) === stableWorldModelStringify(right)
}

export function buildWorldModelSupplementCoverageFactMappings(coverageTargets = [], facts = [], resolution = {}) {
  const results = Array.isArray(resolution?.factResults) ? resolution.factResults : []
  const sourceFacts = Array.isArray(facts) ? facts : []
  return (Array.isArray(coverageTargets) ? coverageTargets : []).slice(0, 128).map(target => {
    const expected = canonicalCoverageAddress(target)
    const candidates = sourceFacts.map((fact, index) => ({fact, index, address: canonicalFactCoverageAddress(fact)}))
    const exact = candidates.filter(item => coverageAddressEquals(item.address, expected))
    const accepted = exact.filter(item => results.some(result => result?.fact === item.fact && ['accepted', 'no-op', 'deduplicated'].includes(result?.status)))
    const resolved = exact.filter(item => results.some(result => result?.fact === item.fact && result?.status !== 'rejected'))
    const matching = accepted.map(item => ({
      fact_index: item.fact?.fact_index ?? item.index,
      field: item.fact?.field ?? null,
      address: item.address,
    }))
    const cardinality = target?.cardinality ?? worldModelSupplementCoverageCardinality(target?.field)
    const result = cardinality === 'collection'
      ? accepted.length > 0 ? 'MATCHED' : exact.length > 0 ? 'UNRESOLVED' : 'NO_EXACT_MATCH'
      : accepted.length === 1 ? 'EXACT_MATCH' : accepted.length === 0 ? (exact.length > 0 ? 'UNRESOLVED' : 'NO_EXACT_MATCH') : 'MULTIPLE_EXACT_MATCH'
    return {
      target_id: target?.target_id ?? null,
      target_scope: target?.scope ?? null,
      target_species: target?.species ?? null,
      target_biological_type: target?.biological_type ?? null,
      target_field: target?.field ?? null,
      expected_canonical_address: expected,
      raw_candidate_fact_count: exact.length,
      parsed_candidate_fact_count: exact.length,
      resolved_candidate_fact_count: resolved.length,
      accepted_candidate_fact_count: accepted.length,
      candidate_fact_addresses: candidates.slice(0, 16).map(item => item.address),
      raw_exact_address_match_count: exact.length,
      exact_address_match_count: accepted.length,
      matched_fact_indices: matching.slice(0, 16).map(item => item.fact_index),
      matched_fact_fields: matching.slice(0, 16).map(item => item.field),
      matched_fact_addresses: matching.slice(0, 16).map(item => item.address),
      target_cardinality: cardinality,
      minimum_required_fact_count: cardinality === 'collection' ? 1 : 1,
      maximum_allowed_fact_count: cardinality === 'collection' ? null : 1,
      target_collection_semantics: cardinality,
      mapping_result: result,
      ...(result === 'EXACT_MATCH' || result === 'MATCHED'
        ? {mapping_failure_reason: null}
        : {mapping_failure_reason: result === 'MULTIPLE_EXACT_MATCH' ? 'exact_address_must_match_once' : result === 'UNRESOLVED' ? 'accepted_fact_address_unresolved' : 'no_exact_address_match'}),
    }
  })
}

function factDeltaCoverageTargetKey(target) {
  return [target?.scope, target?.species ?? '', target?.biological_type ?? '', target?.field].join(':')
}

function factDeltaCoverageSummary(targets, facts = []) {
  const list = Array.isArray(targets) ? targets : []
  const emitted = new Set((Array.isArray(facts) ? facts : []).map(fact => factDeltaCoverageTargetKey({
    scope: factDeltaAddress(fact).scope,
    species: fact?.species,
    biological_type: fact?.biological_type,
    field: fact?.field,
  })))
  const targetSummary = list.map(target => ({
    ...target,
    ...(emitted.has(factDeltaCoverageTargetKey(target)) ? {target_emitted: true} : {target_not_emitted: true}),
  }))
  return {
    coverage_target_count: list.length,
    coverage_target_counts: list.reduce((counts, target) => {
      counts.by_scope[target.scope] = (counts.by_scope[target.scope] ?? 0) + 1
      counts.by_category[target.category] = (counts.by_category[target.category] ?? 0) + 1
      return counts
    }, {by_scope: {}, by_category: {}}),
    covered_target_count: targetSummary.filter(target => target.target_emitted).length,
    coverage_targets: targetSummary.slice(0, 128),
    coverage_targets_truncated: targetSummary.length > 128,
  }
}

function factDeltaMutationStates(targets, dispositions, factResults) {
  const factsByAddress = new Map()
  for (const result of Array.isArray(factResults) ? factResults : []) {
    if (!result?.fact) continue
    const fact = result.fact
    const key = factDeltaCoverageTargetKey({
      scope: factDeltaAddress(fact).scope,
      species: fact.species,
      biological_type: fact.biological_type,
      field: fact.field,
    })
    factsByAddress.set(key, result)
  }
  return (Array.isArray(dispositions) ? dispositions : []).slice(0, 64).map(disposition => {
    const target = (Array.isArray(targets) ? targets : []).find(item => item.target_id === disposition.target_id)
    const result = target ? factsByAddress.get(factDeltaCoverageTargetKey(target)) : null
    if (disposition.disposition === 'NO_EVIDENCE') {
      return {target_id: disposition.target_id, review_status: 'REVIEWED', disposition: 'NO_EVIDENCE', mutation_status: 'NOT_APPLICABLE'}
    }
    const accepted = ['accepted', 'no-op', 'deduplicated'].includes(result?.status)
    return {
      target_id: disposition.target_id,
      review_status: 'REVIEWED',
      disposition: 'EMITTED',
      mutation_status: accepted ? 'ACCEPTED' : 'REJECTED',
      ...(accepted ? {} : {mutation_rejection_reason: result?.code ?? result?.reason ?? 'FACT_REJECTED'}),
    }
  })
}

function factDeltaFieldForOperation(operation) {
  if (!operation) return null;
  if (operation.op === 'ADD_SPECIES') return 'Species_Identity';
  if (operation.op === 'ADD_TYPE') return 'Type_Identity';
  if (operation.op === 'ADD_SPECIAL_RULE') return 'Special_Rule';
  if (operation.op === 'ADD_MECHANISM') return 'Reproductive_Mechanism';
  if (operation.op === 'SET_MECHANISM_HORIZON') return 'Tracking_Window_Horizon';
  if (operation.op === 'ADD_EXCEPTION') return 'Exception';
  if (operation.op === 'ADD_UNKNOWN') return 'Unknown';
  if (operation.op === 'ADD_PROJECTION_RULE') return 'Projection_Rule';
  if (operation.op === 'DISABLE_PROJECTION_RULE') return 'Projection_Rule_Override';
  if (operation.op !== 'SET_FIELD') return null;
  const path = operation.path?.join('.') ?? '';
  const match = Object.entries(FACT_DELTA_SCALAR_PATHS).find(([, candidate]) => {
    if (candidate[0] === 'world') return operation.target?.kind === 'world' && candidate.slice(1).join('.') === path;
    if (candidate[0] === 'species') return operation.target?.kind === 'species' && candidate.slice(1).join('.') === path;
    return operation.target?.kind === 'biological_type' && candidate.slice(1).join('.') === path;
  });
  return match?.[0] ?? null;
}

function factDeltaOperationMatchesFact(fact, operation) {
  if (!operation) return false;
  if (factDeltaFieldForOperation(operation) !== fact?.field) return false;
  const target = operation.target ?? {};
  if (fact?.field === 'Species_Identity') return operation.species?.name === fact.species;
  if (fact?.field === 'Type_Identity') return target.species_name === fact.species && operation.type?.name === fact.biological_type;
  if (fact?.field === 'Exception') return v2Equal(operation.exception, fact.exception);
  if (fact?.field === 'Unknown') return v2TextIdentity(operation.unknown) === v2TextIdentity(fact.value);
  if (fact?.field === 'Projection_Rule') return v2Equal(operation.projection_rule, fact.projection_rule);
  if (fact?.field === 'Projection_Rule_Override') return operation.projection_rule_id === factDeltaCanonicalProjection(fact.projection_rule).projection_rule_id;
  if (fact?.field === 'Special_Rule') return target.species_name === fact.species && target.type_name === fact.biological_type && v2TextIdentity(operation.value) === v2TextIdentity(fact.value);
  if (fact?.field === 'Reproductive_Mechanism') return target.species_name === fact.species && target.type_name === fact.biological_type && operation.mechanism?.key === fact.mechanism?.key;
  if (operation.target?.kind === 'species') return target.species_name === fact.species && v2Equal(operation.value, fact.value);
  return target.species_name === fact.species && target.type_name === fact.biological_type && v2Equal(operation.value, fact.value);
}

function factDeltaExistingComparison(fact, existing) {
  const species = existing.species.find(item => item.name === fact?.species);
  if (fact?.field === 'Species_Identity') return species ? 'same' : 'missing';
  const type = species?.biological_types?.find(item => item.name === fact?.biological_type);
  if (fact?.field === 'Type_Identity') return type ? 'same' : 'missing';
  let current;
  if (fact?.field === 'Species_Description') current = species?.description;
  else if (fact?.field === 'Type_Description') current = type?.description;
  else if (FACT_DELTA_SCALAR_PATHS[fact?.field]?.[0] === 'world') current = existing.medical_context?.[FACT_DELTA_SCALAR_PATHS[fact.field][2]];
  else if (FACT_DELTA_SCALAR_PATHS[fact?.field]) current = type?.[FACT_DELTA_SCALAR_PATHS[fact.field][1]]?.[FACT_DELTA_SCALAR_PATHS[fact.field][2]];
  else if (fact?.field === 'Special_Rule') return type?.special_rules?.some(value => v2TextIdentity(value) === v2TextIdentity(fact.value)) ? 'same' : 'missing';
  else if (fact?.field === 'Reproductive_Mechanism') return type?.reproductive_mechanisms?.some(value => value?.key === fact.mechanism?.key && v2Equal(value, fact.mechanism)) ? 'same' : 'missing';
  else if (fact?.field === 'Exception') return existing.exceptions?.some(value => v2Equal(value, fact.exception)) ? 'same' : 'missing';
  else if (fact?.field === 'Unknown') return existing.unknowns?.some(value => v2TextIdentity(value) === v2TextIdentity(fact.value)) ? 'same' : 'missing';
  else if (fact?.field === 'Projection_Rule') return existing.projection_rules?.some(value => v2Equal(value, fact.projection_rule)) ? 'same' : 'missing';
  else if (fact?.field === 'Projection_Rule_Override') {
    const targetId = factDeltaCanonicalProjection(fact.projection_rule).projection_rule_id
    return existing.projection_rules?.some(value => value.projection_rule_id === targetId) ? 'correction' : 'missing'
  }
  else return 'missing';
  if (current === null || current === undefined) return 'missing';
  return v2Equal(current, fact.value) ? 'same' : 'correction';
}

function factDeltaResolutionDiagnostics(facts, patch, existing, factResults = []) {
  const classified = classifyWorldModelPatchV2(patch, existing);
  return facts.map((fact, fact_index) => {
    const operationIndex = patch.operations.findIndex(operation => factDeltaOperationMatchesFact(fact, operation));
    const operation = operationIndex >= 0 ? patch.operations[operationIndex] : null;
    const classification = operationIndex >= 0 ? classified[operationIndex]?.classification ?? null : null;
    const lifecycle = factResults.find(item => item.fact_index === (fact.fact_index ?? fact_index))
    const resolverStatus = lifecycle?.guardError
      ? 'resolved'
      : lifecycle?.status === 'accepted'
        ? 'resolved'
        : ['resolved', 'no-op', 'deduplicated', 'rejected'].includes(lifecycle?.status)
          ? lifecycle.status
        : null
    const guardStatus = lifecycle?.guardError
      ? 'rejected'
      : ['accepted', 'no-op', 'deduplicated'].includes(lifecycle?.status)
        ? lifecycle.status === 'accepted' ? 'accepted' : 'not_required'
        : lifecycle?.status === 'resolved' ? 'pending' : 'not_run'
    return {
      fact_index: fact.fact_index ?? fact_index,
      field: fact.field,
      registry_field: fact.field,
      species: fact.species ?? null,
      biological_type: fact.biological_type ?? null,
      canonical_address: factDeltaAddress(fact),
      canonical_scope: factDeltaAddress(fact).scope,
      comparison: factDeltaExistingComparison(fact, existing),
      patch_operation_type: operation?.op ?? null,
      patch_path: operation ? v2CanonicalTargetPath(operation) : null,
      classification,
      resolver_status: resolverStatus,
      guard_status: guardStatus,
      guard_type: lifecycle?.guardError?.guard_kind === 'structured_fact_boundary'
        ? 'structural'
        : lifecycle?.guardError ? 'legacy_or_semantic' : null,
      snapshot_applied: lifecycle?.status === 'accepted',
      ...(operation?.op === 'ADD_SPECIAL_RULE' || operation?.op === 'ADD_MECHANISM' || operation?.op === 'ADD_EXCEPTION' || operation?.op === 'ADD_UNKNOWN' || operation?.op === 'ADD_PROJECTION_RULE'
        ? {collection_mutation: lifecycle?.status === 'accepted' ? 'appended' : lifecycle?.status === 'deduplicated' || lifecycle?.status === 'no-op' ? 'deduped' : 'not_applied'}
        : {}),
      ...(lifecycle?.status === 'rejected' ? {
        status: 'rejected',
        failure_stage: lifecycle.guardError?.validation_stage ?? 'fact_resolution',
        failure_code: lifecycle.code ?? null,
        reason: lifecycle.reason ?? null,
      } : {}),
    };
  });
}

function factDeltaRejectedOperation(error) {
  return error?.rejected_operation && typeof error.rejected_operation === 'object'
    ? error.rejected_operation
    : null;
}

function factDeltaEvidenceCandidates(operation, units, debug) {
  const target = operation?.target ?? {};
  const tokens = [
    target.species_name,
    target.type_name,
    operation?.species?.name,
    operation?.type?.name,
    operation?.value,
    operation?.unknown,
    operation?.exception?.statement,
    operation?.exception?.applies_to,
    operation?.exception?.evidence,
    operation?.mechanism?.key,
    operation?.mechanism?.label,
    operation?.mechanism?.pathway,
    ...(Array.isArray(operation?.mechanism?.world_model_rule_refs) ? operation.mechanism.world_model_rule_refs : []),
    ...(Array.isArray(operation?.mechanism?.evidence) ? operation.mechanism.evidence : []),
  ]
    .concat(
      operation?.projection_rule && typeof operation.projection_rule === 'object'
        ? Object.values(operation.projection_rule).flatMap(value => Array.isArray(value) ? value : [value]).filter(value => typeof value === 'string')
        : [],
    )
    .filter(value => typeof value === 'string' && value.trim())
    .map(value => value.trim().toLocaleLowerCase());
  const candidateIndices = units
    .map((unit, index) => ({unit: unit.text, index}))
    .filter(({unit}) => tokens.some(token => unit.toLocaleLowerCase().includes(token)))
    .map(({index}) => index);
  return {
    source_kind: 'permitted_world_model_evidence',
    unit_count: units.length,
    candidate_unit_indices: candidateIndices,
    units: units.map(({source_kind, source_index, line_index, text, parent_context}, unit_index) => ({
      unit_index,
      stable_unit_id: `world-evidence-${unit_index}`,
      source_kind,
      source_index,
      line_index,
      text_length: text.length,
      ...(debug ? {parent_context} : {}),
      ...(debug && candidateIndices.includes(unit_index) ? {excerpt: text.slice(0, 240)} : {}),
    })),
  };
}

function factDeltaEvidenceBindingDiagnostics(operation, analysisInput, error = null, debug = false) {
  const units = factDeltaEvidenceGuardUnits(analysisInput);
  const traceUnits = units;
  const candidateBinding = factDeltaEvidenceCandidates(operation, traceUnits, debug);
  const target = operation?.target ?? {};
  const speciesName = target.species_name ?? operation?.species?.name ?? null;
  const typeName = target.type_name ?? operation?.type?.name ?? null;
  const context = {
    speciesName,
    typeName,
    nested: operation?.op === 'SET_FIELD' ? operation.path?.[0] : null,
    key: operation?.op === 'SET_FIELD' ? operation.path?.[1] : null,
  };
  if (target.kind === 'world') {
    delete context.speciesName;
    delete context.typeName;
  }
  if (target.kind === 'species' && operation?.op !== 'ADD_TYPE') delete context.typeName;
  const scopedUnitRecords = v2ScopedEvidenceUnitRecords(units, context);
  const scopedUnits = scopedUnitRecords.map(evidenceUnitText);
  const scopedUnitIndices = scopedUnitRecords.flatMap((unit) => {
    const index = units.indexOf(unit);
    return index >= 0 ? [index] : [];
  });
  const matchedSupportingUnitIndices = candidateBinding.candidate_unit_indices.filter(index => scopedUnitIndices.includes(index));
  const operationValue = operation?.op === 'SET_FIELD'
    ? operation.value
    : operation?.op === 'ADD_TYPE'
      ? operation.type?.name
      : operation?.op === 'ADD_SPECIES'
        ? operation.species?.name
        : operation?.op === 'ADD_SPECIAL_RULE' || operation?.op === 'ADD_UNKNOWN'
          ? (operation.value ?? operation.unknown)
          : operation?.op === 'ADD_EXCEPTION'
            ? operation.exception
            : operation?.op === 'ADD_MECHANISM'
              ? operation.mechanism
              : operation?.op === 'ADD_PROJECTION_RULE'
                ? operation.projection_rule
                : null;
  let code = null;
  if (error?.guard_kind === 'structured_fact_boundary') {
    code = scopedUnitIndices.length === 0 ? 'EVIDENCE_SCOPE_MISMATCH' : 'EVIDENCE_NOT_PERMITTED'
  } else if (candidateBinding.candidate_unit_indices.length === 0) code = 'NO_CANDIDATE_EVIDENCE';
  else if (context.typeName && scopedUnitIndices.length === 0) code = 'SCOPE_BINDING_FAILED';
  else if (operation?.op === 'ADD_TYPE' || operation?.op === 'ADD_SPECIES') code = 'IDENTITY_SUPPORT_FAILED';
  else if (operation?.op === 'ADD_SPECIAL_RULE' || operation?.op === 'ADD_MECHANISM') code = 'SEMANTIC_FIELD_SUPPORT_FAILED';
  else if (error) code = 'VALUE_SUPPORT_FAILED';
  const scope = target.kind === 'world'
    ? 'world'
    : typeName
      ? 'biological_type'
      : target.kind === 'species'
        ? 'species'
        : 'biological_type';
  return {
    ...candidateBinding,
    scope,
    registry_field: factDeltaFieldForOperation(operation),
    canonical_scope: scope,
    canonical_container_path: v2CanonicalTargetPath(operation),
    guard_type: error?.guard_kind === 'structured_fact_boundary' ? 'structural' : error ? 'legacy_or_semantic' : null,
    canonical_address: scope === 'world'
      ? {scope: 'world'}
      : scope === 'species'
        ? {scope: 'species', species: speciesName}
        : {scope: 'biological_type', species: speciesName, biological_type: typeName},
    candidate_unit_count: candidateBinding.candidate_unit_indices.length,
    candidate_evidence_unit_count: candidateBinding.candidate_unit_indices.length,
    candidate_evidence_unit_indices: candidateBinding.candidate_unit_indices,
    scoped_unit_indices: scopedUnitIndices,
    scoped_unit_count: scopedUnitIndices.length,
    scoped_evidence_unit_count: scopedUnitIndices.length,
    scoped_evidence_unit_indices: scopedUnitIndices,
    matched_supporting_unit_indices: matchedSupportingUnitIndices,
    matched_supporting_unit_count: matchedSupportingUnitIndices.length,
    matched_evidence_unit_count: matchedSupportingUnitIndices.length,
    matched_evidence_unit_indices: matchedSupportingUnitIndices,
    matched_evidence_excerpts: matchedSupportingUnitIndices.slice(0, 8).map(index => ({
      unit_index: index,
      excerpt: String(traceUnits[index]?.text ?? '').slice(0, 240),
    })),
    candidate_value: factDeltaDiagnosticValue(operationValue),
    candidate_normalized_value: typeof operationValue === 'string'
      ? compactEvidenceText(operationValue).slice(0, 240)
      : factDeltaDiagnosticValue(operationValue),
    support_strategy: error ? 'v2_validate_operation_evidence' : null,
    support_score_if_any: null,
    required_threshold_if_any: null,
    scope_binding_result: scopedUnitIndices.length > 0 ? 'BOUND' : 'NO_MATCH',
    value_support_result: error ? 'REJECTED' : matchedSupportingUnitIndices.length > 0 ? 'MATCHED' : 'NOT_EVALUATED',
    rejection_detail: error?.message ?? error?.code ?? null,
    rejection_stage: error ? 'world_patch_v2_evidence_guard' : null,
    rejection_code: code,
  };
}

function factDeltaEvidenceGuardDecision(operation, analysisInput, error, factIndex = null, debug = false) {
  const binding = factDeltaEvidenceBindingDiagnostics(operation, analysisInput, error, debug);
  return {
    fact_index: factIndex,
    field: operation ? factDeltaFieldForOperation(operation) : null,
    canonical_address: binding.canonical_address,
    candidate_value: binding.candidate_value,
    candidate_normalized_value: binding.candidate_normalized_value,
    scoped_evidence_unit_count: binding.scoped_unit_count,
    matched_evidence_unit_count: binding.matched_evidence_unit_count,
    matched_evidence_unit_indices: binding.matched_evidence_unit_indices,
    matched_evidence_excerpts: binding.matched_evidence_excerpts,
    support_strategy: binding.support_strategy,
    support_score_if_any: binding.support_score_if_any,
    required_threshold_if_any: binding.required_threshold_if_any,
    scope_binding_result: binding.scope_binding_result,
    value_support_result: binding.value_support_result,
    registry_field: binding.registry_field,
    canonical_scope: binding.canonical_scope,
    canonical_container_path: binding.canonical_container_path,
    guard_type: binding.guard_type,
    rejection_code: binding.rejection_code,
    rejection_detail: binding.rejection_detail,
  };
}

function factDeltaTypeIdentityDecisions({facts = [], resolution, guarded, existing, analysisInput, debug = false} = {}) {
  const normalizedExisting = normalizeWorldModel(existing, {strict: true, allowGeneratedProjectionRuleIds: true});
  const results = Array.isArray(guarded?.factResults) ? guarded.factResults : [];
  return (Array.isArray(facts) ? facts : [])
    .filter(fact => fact?.field === 'Type_Identity')
    .slice(0, 32)
    .map(fact => {
      const factIndex = fact.fact_index ?? facts.indexOf(fact);
      const lifecycle = results.find(item => item.fact_index === factIndex);
      const species = normalizedExisting.species.find(item => item.name === fact.species);
      const existingIdentity = Boolean(species?.biological_types?.some(item => item.name === fact.biological_type));
      const operation = lifecycle?.operation ?? factDeltaOperationForFact(fact, normalizedExisting);
      const error = lifecycle?.guardError ?? null;
      const binding = operation
        ? factDeltaEvidenceBindingDiagnostics(operation, analysisInput, error, debug)
        : null;
      const dependentFacts = (Array.isArray(facts) ? facts : []).filter(item =>
        item?.species === fact.species && item?.biological_type === fact.biological_type && item?.field !== 'Type_Identity',
      );
      const dependentResults = dependentFacts.map(dependent => results.find(item => item.fact_index === (dependent.fact_index ?? facts.indexOf(dependent))));
      const accepted = ['accepted', 'no-op', 'deduplicated'].includes(lifecycle?.status);
      const identitySupportClassification = existingIdentity
        ? 'EXISTING_IDENTITY'
        : binding?.scoped_unit_count > 0
          ? 'SUPPORTED'
          : 'LEGITIMATELY_UNSUPPORTED';
      return {
        fact_index: factIndex,
        species: fact.species ?? null,
        biological_type: fact.biological_type ?? null,
        existing_identity: existingIdentity,
        new_identity: !existingIdentity,
        evidence_unit_count: binding?.unit_count ?? null,
        candidate_unit_count: binding?.candidate_unit_count ?? null,
        candidate_unit_indices: binding?.candidate_unit_indices?.slice(0, 16) ?? [],
        species_scoped_unit_count: binding?.scoped_unit_count ?? null,
        candidate_type_matching_unit_count: binding?.matched_supporting_unit_count ?? null,
        matched_evidence_unit_indices: binding?.matched_supporting_unit_indices?.slice(0, 16) ?? [],
        scope_binding_strategy: 'SPECIES_PLUS_STABLE_TYPE_IDENTITY_SCOPE',
        scope_binding_result: binding?.scope_binding_result ?? null,
        value_support_strategy: binding?.support_strategy ?? null,
        value_support_result: binding?.value_support_result ?? null,
        identity_support_classification: identitySupportClassification,
        guard_decision: accepted ? 'ACCEPTED' : 'REJECTED',
        rejection_code: lifecycle?.code ?? error?.code ?? null,
        identity_operation_produced: Boolean(operation),
        identity_accepted: accepted,
        dependent_fact_count: dependentFacts.length,
        dependent_facts_unlocked: accepted
          ? dependentFacts.filter((_, index) => !['WORLD_MODEL_FACT_DELTA_TYPE_IDENTITY_REQUIRED', 'WORLD_MODEL_FACT_DELTA_SPECIES_IDENTITY_REQUIRED'].includes(dependentResults[index]?.code)).map(item => item.fact_index ?? facts.indexOf(item)).slice(0, 32)
          : [],
        dependent_facts_blocked: dependentFacts.filter((_, index) => dependentResults[index]?.code === 'WORLD_MODEL_FACT_DELTA_TYPE_IDENTITY_REQUIRED').map(item => item.fact_index ?? facts.indexOf(item)).slice(0, 32),
      };
    });
}

function hasLabelEvidenceInUnits(units, pattern) {
  return units.some((unit) => {
    const match = unit.match(pattern);
    if (!match) return false;
    const before = unit.slice(0, match.index ?? 0).slice(-12);
    const after = unit.slice((match.index ?? 0) + match[0].length).slice(0, 12);
    if (NEGATED_LABEL_CONTEXT_PATTERN.test(before)) return false;
    if (
      /^\s*(?:不存在|没有|未(?:有|见|说明|提及|发现|出现)|不确定|不明确|不清楚|模糊)/u.test(
        after,
      )
    )
      return false;
    if (UNKNOWN_LABEL_SUFFIX_PATTERN.test(after)) return false;
    return true;
  });
}

function hasMentionedLabelInUnits(units, pattern) {
  return units.some((unit) => {
    const match = unit.match(pattern);
    if (!match) return false;
    const before = unit.slice(0, match.index ?? 0).slice(-12);
    return !NEGATED_LABEL_CONTEXT_PATTERN.test(before);
  });
}

function hasFixedDualEvidenceInUnits(units) {
  return units.some((unit) => {
    const stableClause = unit.replace(TEMPORARY_DUAL_PHRASE_PATTERN, '').trim();
    const dualMatch = stableClause.match(DUAL_TERM_PATTERN);
    if (!dualMatch) return false;
    const beforeDual = stableClause.slice(0, dualMatch.index ?? 0).slice(-20);
    if (NEGATED_DUAL_CONTEXT_PATTERN.test(beforeDual)) return false;
    return /(?:^|[：:])\s*双性|双性(?:个体|人|生物|类型|分类|性别|身份|体质|特征|存在者|者|体|存在|是|为|属于)|(?:是|为|属于|定义为|分类为|归类为|存在(?:着)?|包括|包含|出现|有|分为|明确为|固定(?:为)?|本身(?:是|为)?|角色(?:本身)?(?:是|为)?|个体(?:是|为)?|物种(?:是|为)?|种族(?:是|为)?|性别|世界规则|规则|设定|具有|具备|呈现|表现为|规定|记载|说明|明确)[^。！？!?；;，,、\n]{0,16}双性/u.test(
      stableClause,
    );
  });
}

function compactEvidenceText(value) {
  return String(value ?? '').replace(/\s+/gu, '');
}

function hasHumanSpeciesEvidence(text) {
  const compactText = compactEvidenceText(text);
  if (/(?:人类|人族|普通人)/u.test(compactText)) return true;
  const match = compactText.match(/humans?/iu);
  if (!match) return false;
  const start = match.index ?? 0;
  const end = start + match[0].length;
  return (
    !/[A-Za-z0-9_-]/u.test(compactText[start - 1] ?? '') &&
    !/[A-Za-z0-9_-]/u.test(compactText[end] ?? '')
  );
}

function matchesSpeciesName(text, speciesName) {
  const normalizedSpecies = compactEvidenceText(speciesName);
  if (!normalizedSpecies) return false;
  if (isHumanSpeciesName(speciesName) && hasHumanSpeciesEvidence(text))
    return true;
  if (normalizedSpecies.length > 1) return text.includes(normalizedSpecies);
  const escapedSpecies = normalizedSpecies.replace(
    /[.*+?^${}()|[\]\\]/gu,
    '\\$&',
  );
  return new RegExp(
    `(?:^|[\\s\\[\\]（）()<>：:、，,])${escapedSpecies}(?=$|[\\s\\[\\]（）()<>：:、，,])`,
    'u',
  ).test(text);
}

function speciesEvidenceUnits(units, speciesName) {
  return units.filter((unit) => {
    const compactUnit = compactEvidenceText(unit);
    return matchesSpeciesName(compactUnit, speciesName);
  });
}

function hasDirectTypeEvidence(unit, typeName) {
  if (typeName === '男性')
    return hasLabelEvidenceInUnits([unit], MALE_EVIDENCE_PATTERN);
  if (typeName === '女性')
    return hasLabelEvidenceInUnits([unit], FEMALE_EVIDENCE_PATTERN);
  if (typeName === '双性') return hasFixedDualEvidenceInUnits([unit]);
  const normalizedType = compactEvidenceText(typeName);
  if (!normalizedType) return false;
  const typeIndex = compactEvidenceText(unit).indexOf(normalizedType);
  if (typeIndex < 0) return false;
  const before = compactEvidenceText(unit).slice(0, typeIndex).slice(-18);
  const after = compactEvidenceText(unit).slice(
    typeIndex + normalizedType.length,
    typeIndex + normalizedType.length + 18,
  );
  return (
    !NEGATED_LABEL_CONTEXT_PATTERN.test(before) &&
    !/^(?:不存在|没有|未(?:有|见|说明|提及|发现|出现)|不确定|不明确|不清楚|模糊)/u.test(
      after,
    )
  );
}

function typeEvidenceMatch(unit, typeName) {
  if (typeName === '男性') return unit.match(MALE_EVIDENCE_PATTERN);
  if (typeName === '女性') return unit.match(FEMALE_EVIDENCE_PATTERN);
  if (typeName === '双性') return unit.match(DUAL_TERM_PATTERN);
  const normalizedType = compactEvidenceText(typeName);
  if (!normalizedType) return null;
  const compactUnit = compactEvidenceText(unit);
  const typeIndex = compactUnit.indexOf(normalizedType);
  return typeIndex < 0 ? null : { index: typeIndex, 0: normalizedType };
}

function hasSpeciesLinkedTypeEvidence(unit, speciesName, typeName) {
  const typeMatch = typeEvidenceMatch(unit, typeName);
  if (!typeMatch) return false;
  const compactUnit = compactEvidenceText(unit);
  const typeStart = typeMatch.index ?? 0;
  const typeEnd = typeStart + String(typeMatch[0] ?? '').length;
  const relationPattern =
    /性别|生殖分类|分类|类型|存在|包括|包含|分为|基本|主要|多数|少数|极少|少量|大多|通常|均为|都是|为主|有|属于|明确/u;
  const individualPattern =
    /某(?:个|位|名)|一(?:个|位|名)|这个角色|该角色|某人物|单个/u;
  const externalHumanPattern = /人类|人族/u;
  const interactionPattern = /与|和|同|对|向|被|交配|性交|伴侣/u;

  const speciesToken = compactEvidenceText(speciesName);
  if (!speciesToken) return false;
  let speciesStart = compactUnit.indexOf(speciesToken);
  while (speciesStart >= 0) {
    const speciesEnd = speciesStart + speciesToken.length;
    const contextStart = Math.min(speciesStart, typeStart);
    const contextEnd = Math.max(speciesEnd, typeEnd);
    const between = compactUnit.slice(
      Math.min(speciesEnd, typeEnd),
      Math.max(speciesStart, typeStart),
    );
    const context = compactUnit.slice(
      Math.max(0, contextStart - 8),
      Math.min(compactUnit.length, contextEnd + 8),
    );
    if (
      !externalHumanPattern.test(between) &&
      !(interactionPattern.test(between) && !relationPattern.test(between)) &&
      !(individualPattern.test(context) && !relationPattern.test(between))
    ) {
      if (between.length <= 6 || relationPattern.test(between)) return true;
    }
    speciesStart = compactUnit.indexOf(speciesToken, speciesStart + 1);
  }
  return false;
}

function typeEvidenceUnits(units, speciesName, typeName) {
  const speciesUnits = speciesEvidenceUnits(units, speciesName);
  const directUnits = speciesUnits.filter(
    (unit) =>
      hasDirectTypeEvidence(unit, typeName) &&
      hasSpeciesLinkedTypeEvidence(unit, speciesName, typeName),
  );
  return directUnits;
}

function hasNonHumanTypeEvidence(units, speciesName, typeName) {
  return typeEvidenceUnits(units, speciesName, typeName).length > 0;
}

function genericTypeLocalEvidenceUnits(units, type) {
  const typeName = type?.name;
  const textValues = [
    type?.description,
    ...Object.values(type?.reproduction_rules ?? {}),
    ...Object.values(type?.lifecycle ?? {}),
    ...(Array.isArray(type?.special_rules) ? type.special_rules : []),
  ]
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim());
  const textAnchors = textValues
    .map((value) =>
      compactEvidenceText(value).replace(/[。！？!?；;，,、]+$/gu, ''),
    )
    .filter(Boolean);
  const parentSpeciesName = type?.[TYPE_PARENT_SPECIES];
  const siblingNames = type?.[TYPE_SIBLING_NAMES] ?? [];
  const directlyEvidencedTextUnits = new Set(
    textValues
      .flatMap((value) => directTextEvidenceUnits(value, units))
      .filter((unit) => !hasGenericDirectLabelEvidence(unit, parentSpeciesName))
      .filter(
        (unit) =>
          !siblingNames.some(
            (siblingName) =>
              compactEvidenceText(siblingName) !==
                compactEvidenceText(typeName) &&
              hasGenericDirectLabelEvidence(unit, siblingName),
          ),
      ),
  );
  const capabilityPatterns = Object.values(CAPABILITY_EVIDENCE_PATTERNS);
  const rulePatterns = [
    ...Object.values(REPRODUCTION_RULE_EVIDENCE_PATTERNS),
    ...Object.values(LIFECYCLE_EVIDENCE_PATTERNS),
  ];

  return units.filter((unit) => {
    if (directlyEvidencedTextUnits.has(unit)) return true;
    const hasTypeName =
      Boolean(typeName) && hasGenericDirectLabelEvidence(unit, typeName);
    const compactUnit = compactEvidenceText(unit);
    const hasTypeText =
      hasTypeName && textAnchors.some((anchor) => compactUnit.includes(anchor));
    const hasCapabilityPattern = capabilityPatterns.some((pattern) =>
      pattern.test(unit),
    );
    const hasRuleOrLifecyclePattern = rulePatterns.some((pattern) =>
      pattern.test(unit),
    );
    // Pattern-only wording is local only when the same unit names this type;
    // a bare capability sentence cannot be assigned to one sibling safely.
    return (
      hasTypeName &&
      (hasTypeText || hasCapabilityPattern || hasRuleOrLifecyclePattern)
    );
  });
}

function fieldEvidenceUnits(units, speciesName, typeName) {
  if (isHumanSpeciesName(speciesName)) {
    return units.filter((unit) => hasDirectTypeEvidence(unit, typeName));
  }
  return typeEvidenceUnits(units, speciesName, typeName);
}

function isHumanSpeciesName(speciesName) {
  return isCanonicalWorldHumanSpecies(speciesName);
}

function capabilityEvidenceContext(unit, match) {
  const start = Math.max(0, (match.index ?? 0) - 24);
  const end = Math.min(unit.length, (match.index ?? 0) + match[0].length + 24);
  return unit.slice(start, end);
}

function isNonEvidenceCapabilityContext(unit, match) {
  return NON_EVIDENCE_CAPABILITY_PATTERN.test(
    capabilityEvidenceContext(unit, match),
  );
}

function isExplicitNegativeCapabilityEvidence(unit, match) {
  const before = unit.slice(0, match.index ?? 0).slice(-16);
  const negatedAuxiliary =
    /(?:不|未|并不)\s*$/u.test(before) &&
    /^(?:能|可|会|被|接受|具备)/u.test(match[0]);
  return (
    EXPLICIT_NEGATIVE_CAPABILITY_PATTERN.test(match[0]) ||
    EXPLICIT_NEGATIVE_CAPABILITY_PATTERN.test(before) ||
    negatedAuxiliary ||
    EXPLICIT_NEGATIVE_CAPABILITY_PATTERN.test(
      unit.slice(Math.max(0, (match.index ?? 0) - 4), match.index ?? 0),
    )
  );
}

function capabilityEvidenceValue(units, pattern) {
  let explicitNegative = false;
  let positive = false;
  for (const unit of units) {
    const match = unit.match(pattern);
    if (!match) continue;
    if (isExplicitNegativeCapabilityEvidence(unit, match)) {
      explicitNegative = true;
      continue;
    }
    if (isNonEvidenceCapabilityContext(unit, match)) continue;
    positive = true;
  }
  if (positive) return true;
  if (explicitNegative) return false;
  return null;
}

function textEvidenceState(units, pattern) {
  let found = false;
  let positive = false;
  for (const unit of units) {
    const match = unit.match(pattern);
    if (!match) continue;
    found = true;
    const before = unit.slice(0, match.index ?? 0).slice(-18);
    if (!UNSPECIFIED_FIELD_CONTEXT_PATTERN.test(before)) positive = true;
  }
  if (!found || !positive) return null;
  return 'positive';
}

function hasDirectRuleEvidence(value, units) {
  const ruleText = compactEvidenceText(value);
  if (!ruleText) return false;
  const sourceText = units.map(compactEvidenceText).join('\n');
  if (ruleText.length <= 3) return sourceText.includes(ruleText);
  const runs = ruleText.match(/[\u4e00-\u9fffA-Za-z0-9]{4,}/gu) ?? [];
  return runs.some((run) =>
    [...Array(run.length - 3)].some((_, index) =>
      sourceText.includes(run.slice(index, index + 4)),
    ),
  );
}

function sanitizeNonHumanType(type) {
  return { ...type };
}

function humanBaseline(typeName) {
  if (typeName === '男性') {
    return {
      capabilities: {
        can_produce_sperm: true,
        can_produce_ova: false,
        can_be_fertilized: false,
        can_fertilize: true,
        can_cause_pregnancy: null,
        can_carry_pregnancy: false,
      },
      reproduction_rules: {
        fertilization: '通过精子使卵细胞受精。',
        pregnancy_or_carrying: '无',
        cycle: '无',
        ovulation: '无',
        gestation: '无',
        labor: '无',
      },
    };
  }
  if (typeName === '女性') {
    return {
      capabilities: {
        can_produce_sperm: false,
        can_produce_ova: true,
        can_be_fertilized: true,
        can_fertilize: false,
        can_cause_pregnancy: null,
        can_carry_pregnancy: true,
      },
      reproduction_rules: {
        fertilization: '卵细胞可被精子受精。',
        pregnancy_or_carrying: '可以承担妊娠。',
        cycle: '通常约28天一个周期。',
        ovulation: '通常每个周期排卵。',
        gestation: '通常约40周。',
        labor: '通过分娩完成生产。',
      },
    };
  }
  return null;
}

function sanitizeHumanType(type, units, speciesName) {
  const baseline = humanBaseline(type.name);
  if (!baseline) return sanitizeNonHumanType(type, units, speciesName);
  const fieldUnits = fieldEvidenceUnits(units, speciesName, type.name);
  return {
    ...type,
    capabilities: Object.fromEntries(
      CAPABILITY_KEYS.map((key) => {
        const value = type.capabilities[key];
        return [key, value === null ? baseline.capabilities[key] : value];
      }),
    ),
    reproduction_rules: Object.fromEntries(
      WORLD_RULE_KEYS.map((key) => {
        const value = type.reproduction_rules[key];
        return [key, value === null ? baseline.reproduction_rules[key] : value];
      }),
    ),
    special_rules: type.special_rules.filter((rule) =>
      hasDirectRuleEvidence(rule, fieldUnits),
    ),
  };
}

function normalizeAnalysisType(
  type,
  speciesName,
  knownSpeciesNames,
  siblingNames,
) {
  const name = normalizeBiologicalTypeName(type?.name, speciesName);
  const normalized = name === type?.name ? { ...type } : { ...type, name };
  Object.defineProperty(normalized, TYPE_PARENT_SPECIES, {
    value: speciesName,
  });
  Object.defineProperty(normalized, TYPE_KNOWN_SPECIES, {
    value: knownSpeciesNames,
  });
  Object.defineProperty(normalized, TYPE_SIBLING_NAMES, {
    value: siblingNames,
  });
  return normalized;
}

function isSpeciesNameOrGenericDerivative(name, speciesName) {
  const normalizedName = compactEvidenceText(name);
  const normalizedSpecies = compactEvidenceText(speciesName);
  if (
    !normalizedName ||
    !normalizedSpecies ||
    normalizedName === normalizedSpecies
  )
    return true;
  if (
    isHumanSpeciesName(speciesName) &&
    ['人类', '人'].includes(normalizedName)
  )
    return true;
  return GENERIC_SPECIES_TYPE_SUFFIXES.some(
    (suffix) => normalizedName === `${normalizedSpecies}${suffix}`,
  );
}

function isObservedNonBiologicalType(name, speciesName) {
  const normalizedName = compactEvidenceText(name);
  if (
    isSpeciesNameOrGenericDerivative(name, speciesName) ||
    normalizedName === DIRECT_AMBIGUOUS_TYPE
  )
    return true;
  return false;
}

function isDualTypeName(name) {
  const text = String(name ?? '');
  return DUAL_TERM_PATTERN.test(text) || /双性(?:化|状态)/u.test(text);
}

function isUnsupportedDualUnknown(value) {
  return /双性(?:个体|个人|人|生物|类型|分类|性别|能力|生育|受精)/u.test(
    String(value ?? ''),
  );
}

function isUnsupportedUnknownType(value, species) {
  const text = String(value ?? '');
  return species.some((item) => {
    if (isHumanSpeciesName(item.name)) return false;
    if (!speciesEvidenceUnits([text], item.name).length) return false;
    const names = new Set(item.biological_types.map((type) => type.name));
    return [...FAMILIAR_TYPE_NAMES].some((typeName) => {
      if (typeName === '双性' && !hasFixedDualEvidenceInUnits([text]))
        return false;
      if (
        typeName === '男性' &&
        !hasMentionedLabelInUnits([text], MALE_EVIDENCE_PATTERN)
      )
        return false;
      if (
        typeName === '女性' &&
        !hasMentionedLabelInUnits([text], FEMALE_EVIDENCE_PATTERN)
      )
        return false;
      return !names.has(typeName);
    });
  });
}

function hasGenericDirectLabelEvidence(unit, value) {
  return genericDirectLabelMatch(unit, value) !== null;
}

function hasDirectNameEvidence(value, units) {
  return (
    Boolean(compactEvidenceText(value)) &&
    units.some((unit) => hasGenericDirectLabelEvidence(unit, value))
  );
}

function genericLabelVariants(value) {
  const label = compactEvidenceText(value);
  if (!label) return [];
  const baseLabel = label.replace(/(?:类型|分类|个体|型|性)$/u, '');
  return baseLabel && baseLabel !== label ? [label, baseLabel] : [label];
}

function genericDirectLabelMatch(unit, value) {
  const text = String(unit ?? '').replace(/\s+/gu, ' ').trim();
  for (const label of genericLabelVariants(value)) {
    let labelIndex = text.indexOf(label);
    while (labelIndex >= 0) {
      const labelEnd = labelIndex + label.length;
      const singleCharacterLabel =
        label.length === 1 &&
        /[\u4e00-\u9fff]/u.test(label) &&
        !/[\u4e00-\u9fffA-Za-z0-9_-]/u.test(text[labelEnd] ?? '');
      const matchesBoundary =
        matchesSpeciesName(text, label) || singleCharacterLabel;
      if (matchesBoundary) {
        const before = text.slice(0, labelIndex).slice(-18);
        const after = text.slice(labelEnd, labelEnd + 18);
        const asciiLabelBoundary =
          /^[A-Za-z0-9_-]+$/u.test(label) &&
          (/[A-Za-z0-9_-]/u.test(text[labelIndex - 1] ?? '') ||
            /[A-Za-z0-9_-]/u.test(text[labelEnd] ?? ''));
        if (
          !asciiLabelBoundary &&
          !NEGATED_LABEL_CONTEXT_PATTERN.test(before) &&
          !/^(?:不存在|没有|未(?:有|见|说明|提及|发现|出现)|不确定|不明确|不清楚|模糊)/u.test(
            after,
          ) &&
          !/^(?:未知|不确定|不明确|不清楚|模糊)/u.test(after)
        ) {
          return { index: labelIndex, label };
        }
      }
      labelIndex = text.indexOf(label, labelIndex + 1);
    }
  }
  return null;
}

function directTextEvidenceUnits(value, units) {
  const text = compactEvidenceText(value);
  const punctuationTrimmedText = text.replace(/[。！？!?；;，,、]+$/gu, '');
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    !punctuationTrimmedText
  )
    return [];
  if (!hasDirectRuleEvidence(value, units)) return [];
  return units.filter((unit) =>
    compactEvidenceText(unit).includes(punctuationTrimmedText),
  );
}

function hasDirectTextEvidence(value, units) {
  return directTextEvidenceUnits(value, units).length > 0;
}

function familiarTypeLabelMatch(unit, speciesName, typeName) {
  if (!FAMILIAR_TYPE_NAMES.has(typeName)) return null;
  const text = compactEvidenceText(unit);
  const pattern = typeName === '男性'
    ? MALE_EVIDENCE_PATTERN
    : typeName === '女性'
      ? FEMALE_EVIDENCE_PATTERN
      : DUAL_TERM_PATTERN;
  const directMatch = text.match(pattern);
  if (directMatch) return {index: directMatch.index ?? 0, label: directMatch[0]};
  if (typeName !== '男性' && typeName !== '女性') return null;
  const speciesToken = compactEvidenceText(speciesName);
  if (!speciesToken) return null;
  const prefix = typeName === '男性' ? '男' : '女';
  const escapedSpecies = speciesToken
    .replaceAll('\\', '\\\\')
    .replaceAll('.', '\\.').replaceAll('*', '\\*').replaceAll('+', '\\+')
    .replaceAll('?', '\\?').replaceAll('^', '\\^').replaceAll('$', '\\$')
    .replaceAll('{', '\\{').replaceAll('}', '\\}').replaceAll('(', '\\(')
    .replaceAll(')', '\\)').replaceAll('|', '\\|').replaceAll('[', '\\[')
    .replaceAll(']', '\\]');
  const prefixMatch = text.match(new RegExp(`${prefix}(?=${escapedSpecies})`, 'u'));
  return prefixMatch
    ? {index: prefixMatch.index ?? 0, label: prefixMatch[0]}
    : null;
}

function hasDirectPatternTextEvidence(value, units, pattern) {
  const directUnits = directTextEvidenceUnits(value, units);
  return (
    directUnits.length > 0 && textEvidenceState(directUnits, pattern) !== null
  );
}

function hasGenericScopedTypeEvidence(unit, speciesName, typeName, {allowFamiliar = false, strictInteraction = false} = {}) {
  const speciesMatch = genericDirectLabelMatch(unit, speciesName);
  const typeMatch =
    genericDirectLabelMatch(unit, typeName) ??
    (allowFamiliar ? familiarTypeLabelMatch(unit, speciesName, typeName) : null);
  if (!speciesMatch || !typeMatch) return false;

  const text = String(unit ?? '').replace(/\s+/gu, ' ').trim();
  const speciesStart = speciesMatch.index;
  const speciesEnd = speciesStart + speciesMatch.label.length;
  const typeStart = typeMatch.index;
  const typeEnd = typeStart + typeMatch.label.length;
  const between = text.slice(
    Math.min(speciesEnd, typeEnd),
    Math.max(speciesStart, typeStart),
  );
  const context = text.slice(
    Math.max(0, Math.min(speciesStart, typeStart) - 8),
    Math.min(text.length, Math.max(speciesEnd, typeEnd) + 8),
  );
  const relationPattern =
    /性别|生殖分类|分类|类型|存在|包括|包含|分为|基本|主要|多数|少数|极少|少量|大多|通常|均为|都是|为主|有|属于|明确|记录|记载|说明|(?:sex|gender|classification|class|type|exists?|present|population|minority|majority|rare|uncommon|mostly|primarily|stable|persistent|permanent|consists?|includes?|contains?|classified|belongs?|has)/iu;
  const individualPattern =
    /某(?:个|位|名)|一(?:个|位|名)|这个角色|该角色|某人物|单个/u;
  const interactionPattern = /与|和|同|对|向|被|交配|性交|伴侣|(?:interact(?:s|ed|ing)?|partner(?:s|ed)?|mating|paired|with|and|or)/iu;

  if (
    strictInteraction &&
    interactionPattern.test(between) &&
    !relationPattern.test(between)
  )
    return false;
  if (strictInteraction && /互动|交互|伴侣关系/u.test(context) && interactionPattern.test(between)) return false;
  if (
    !strictInteraction &&
    between.length > 6 &&
    interactionPattern.test(between) &&
    !relationPattern.test(between)
  )
    return false;
  if (individualPattern.test(context) && !relationPattern.test(between))
    return false;
  return between.length <= 6 || relationPattern.test(between);
}

function hasTypeSubtreeEvidence(type, units) {
  const parentSpeciesName = type[TYPE_PARENT_SPECIES];
  const knownSpeciesNames = type[TYPE_KNOWN_SPECIES] ?? [];
  const directNameUnits = units.filter((unit) =>
    hasGenericDirectLabelEvidence(unit, type.name),
  );
  const supportedNameUnits = directNameUnits.filter((unit) => {
    if (
      !parentSpeciesName ||
      hasGenericScopedTypeEvidence(unit, parentSpeciesName, type.name)
    )
      return true;
    if (hasGenericDirectLabelEvidence(unit, parentSpeciesName)) return false;
    return !knownSpeciesNames.some(
      (speciesName) =>
        compactEvidenceText(speciesName) !==
          compactEvidenceText(parentSpeciesName) &&
        hasGenericDirectLabelEvidence(unit, speciesName),
    );
  });
  if (
    supportedNameUnits.length > 0 ||
    hasDirectTextEvidence(type.description, units)
  )
    return true;
  if (
    WORLD_RULE_KEYS.some(
      (key) =>
        type.reproduction_rules[key] &&
        hasDirectPatternTextEvidence(
          type.reproduction_rules[key],
          units,
          REPRODUCTION_RULE_EVIDENCE_PATTERNS[key],
        ),
    )
  )
    return true;
  if (
    LIFECYCLE_KEYS.some(
      (key) =>
        type.lifecycle[key] &&
        hasDirectPatternTextEvidence(
          type.lifecycle[key],
          units,
          LIFECYCLE_EVIDENCE_PATTERNS[key],
        ),
    )
  )
    return true;
  if (type.special_rules.some((rule) => hasDirectTextEvidence(rule, units)))
    return true;
  const scopedUnits = units.filter(
    (unit) =>
      supportedNameUnits.includes(unit) ||
      hasGenericDirectLabelEvidence(unit, type.description),
  );
  if (
    CAPABILITY_KEYS.some(
      (key) =>
        type.capabilities[key] !== null &&
        capabilityEvidenceValue(
          scopedUnits,
          CAPABILITY_EVIDENCE_PATTERNS[key],
        ) !== null,
    )
  )
    return true;
  if (
    WORLD_RULE_KEYS.some(
      (key) =>
        type.reproduction_rules[key] &&
        textEvidenceState(
          scopedUnits,
          REPRODUCTION_RULE_EVIDENCE_PATTERNS[key],
        ),
    )
  )
    return true;
  if (
    LIFECYCLE_KEYS.some(
      (key) =>
        type.lifecycle[key] &&
        textEvidenceState(scopedUnits, LIFECYCLE_EVIDENCE_PATTERNS[key]),
    )
  )
    return true;
  return false;
}

function hasSpeciesSubtreeEvidence(species, units) {
  if (
    hasDirectNameEvidence(species.name, units) ||
    hasDirectTextEvidence(species.description, units)
  )
    return true;
  return species.biological_types.some((type) =>
    hasTypeSubtreeEvidence(type, units),
  );
}

// AI 分析才经过证据边界；手动编辑保存的 World Model 只经过结构规范化。
function applyWorldModelEvidenceGuard(model, analysisInput) {
  const evidence = evidenceUnits(analysisInput);
  const hasFixedDual = hasFixedDualEvidenceInUnits(evidence);
  const knownSpeciesNames = model.species.map((item) => item.name);
  const species = [];
  for (const item of model.species) {
    const siblingNames = item.biological_types
      .map((type) => normalizeBiologicalTypeName(type?.name, item.name))
      .filter(Boolean);
    const normalizedTypes = item.biological_types
      .map((type) =>
        normalizeAnalysisType(type, item.name, knownSpeciesNames, siblingNames),
      )
      .filter((type) => !isObservedNonBiologicalType(type.name, item.name));
    if (
      !hasSpeciesSubtreeEvidence(
        { ...item, biological_types: normalizedTypes },
        evidence,
      )
    )
      continue;
    const humanSpecies = isHumanSpeciesName(item.name);
    const localSpeciesUnits = speciesEvidenceUnits(evidence, item.name);
    const localFixedDual = humanSpecies
      ? hasFixedDualEvidenceInUnits(localSpeciesUnits)
      : hasNonHumanTypeEvidence(evidence, item.name, '双性');
    const supportedTypes = normalizedTypes
      .filter((type) => hasTypeSubtreeEvidence(type, evidence))
      .filter((type) => localFixedDual || !isDualTypeName(type.name));
    const biologicalTypes = supportedTypes.map((type) =>
      humanSpecies
        ? sanitizeHumanType(type, evidence, item.name)
        : sanitizeNonHumanType(type, evidence, item.name),
    );
    species.push({ ...item, biological_types: biologicalTypes });
  }
  return {
    ...model,
    species,
    unknowns: model.unknowns.filter((value) => {
      if (!hasFixedDual && isUnsupportedDualUnknown(value)) return false;
      return !isUnsupportedUnknownType(value, species);
    }),
  };
}

function hasPatchTextEvidence(value, evidence) {
  return (
    hasGenericDirectLabelEvidence(evidence.join('\n'), value) ||
    hasDirectRuleEvidence(value, evidence)
  )
}

function semanticPatchValueEqual(left, right) {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false
    return left.every((value, index) => semanticPatchValueEqual(value, right[index]))
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const leftKeys = Object.keys(left).sort()
    const rightKeys = Object.keys(right).sort()
    return leftKeys.length === rightKeys.length && leftKeys.every(
      (key, index) => key === rightKeys[index] && semanticPatchValueEqual(left[key], right[key]),
    )
  }
  return false
}

function patchMechanismSemanticValue(value) {
  const result = {
    key: value?.key ?? null,
    label: value?.label ?? null,
    pathway: value?.pathway ?? null,
    carrying_compatibility: value?.carrying_compatibility ?? null,
    world_model_rule_refs: [...new Set(value?.world_model_rule_refs ?? [])].sort(),
  }
  if (Object.hasOwn(value ?? {}, 'tracking_window_horizon')) result.tracking_window_horizon = value.tracking_window_horizon ?? null;
  return result;
}

function scopeCompatiblePatchUnits(units, delta) {
  const individualOnlyPattern = /某(?:个|位|名)?(?:角色|人物|NPC)|这个角色|该角色|单个(?:角色|人物|个体)/u
  if (delta.typeName) {
    const exactTypeUnits = units.filter((unit) =>
      hasGenericScopedTypeEvidence(unit, delta.speciesName, delta.typeName),
    )
    return exactTypeUnits
  }
  if (delta.speciesName) {
    return units
      .filter((unit) => hasGenericDirectLabelEvidence(unit, delta.speciesName))
      .filter((unit) => !individualOnlyPattern.test(unit))
  }
  return units.filter((unit) => !individualOnlyPattern.test(unit))
}

const FERTILIZATION_RECIPIENT_PATTERN =
  /(?:被|接受|承受)[^。！？!?；;，,、\n]{0,16}(?:受精|授精)|(?:卵子|卵细胞|雌性配子)[^。！？!?；;，,、\n]{0,16}(?:被|接受|承受)[^。！？!?；;，,、\n]{0,16}(?:受精|授精)/iu;
const FERTILIZATION_DONOR_PATTERN =
  /(?:使|让|令)[^。！？!?；;，,、\n]{0,20}受精|(?:通过|利用|依靠|凭借)[^。！？!?；;，,、\n]{0,16}(?:精子|精液|雄性配子)[^。！？!?；;，,\n]{0,16}(?:使|让|令)[^。！？!?；;，,\n]{0,16}受精|(?:向|给|对)[^。！？!?；;，,、\n]{0,16}授精|作为(?:施受精者|施受精方|供体)/iu;

function fertilizationRoleFlags(value) {
  const text = String(value ?? '');
  return {
    recipient: FERTILIZATION_RECIPIENT_PATTERN.test(text),
    donor: FERTILIZATION_DONOR_PATTERN.test(text),
  };
}

function applyWorldModelFinalConsistencyGuard(model) {
  return {
    ...model,
    species: model.species.map((species) => ({
      ...species,
      biological_types: species.biological_types.map((type) => {
        const capabilities = type.capabilities ?? {};
        const reproductionRules = { ...(type.reproduction_rules ?? {}) };

        if (capabilities.can_produce_ova === false)
          reproductionRules.ovulation = '无';
        if (capabilities.can_carry_pregnancy === false) {
          reproductionRules.pregnancy_or_carrying = '无';
          reproductionRules.gestation = '无';
          reproductionRules.labor = '无';
        }

        if (
          reproductionRules.fertilization &&
          reproductionRules.fertilization !== '无'
        ) {
          const roles = fertilizationRoleFlags(reproductionRules.fertilization);
          const roleConflict =
            (capabilities.can_be_fertilized === false && roles.recipient) ||
            (capabilities.can_fertilize === false && roles.donor);
          if (roleConflict) reproductionRules.fertilization = null;
        }

        return { ...type, reproduction_rules: reproductionRules };
      }),
    })),
  };
}

// 将 AI 或手动编辑结果收敛到唯一的 World Model v1 结构。
export function normalizeWorldModel(raw, { strict = false, allowGeneratedProjectionRuleIds = false } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw invalidWorldModel();
  if (
    strict &&
    Number(raw.schema_version) !== WORLD_MODEL_SCHEMA.schema_version
  )
    throw invalidWorldModel();
  if (
    raw.schema_version !== undefined &&
    Number(raw.schema_version) !== WORLD_MODEL_SCHEMA.schema_version
  ) {
    throw invalidWorldModel();
  }
  // v1 曾把 biological_types 放在顶层，但无法从旧结果安全推断 species 归属，因此不做迁移。
  if (Object.hasOwn(raw, 'biological_types')) throw invalidWorldModel();
  if (
    strict &&
    (!Array.isArray(raw.species) ||
      !Array.isArray(raw.exceptions) ||
      !Array.isArray(raw.unknowns))
  ) {
    const path = !Array.isArray(raw.species)
      ? 'species'
      : !Array.isArray(raw.exceptions)
        ? 'exceptions'
        : 'unknowns';
    throw invalidWorldModel('WORLD_MODEL_INVALID', {
      path,
      expected: 'array',
      received: Array.isArray(raw[path]) ? 'array' : typeof raw[path],
    });
  }
  if (raw.species !== undefined && !Array.isArray(raw.species))
    throw invalidWorldModel();
  let projectionRules;
  try {
    projectionRules = normalizeProjectionRules(raw.projection_rules, {
      allowGeneratedIdentity: allowGeneratedProjectionRuleIds,
    });
  } catch (error) {
    const diagnostic = String(error?.message ?? 'invalid');
    const firstDiagnostic = diagnostic.split(', ')[0];
    const diagnosticPath = firstDiagnostic.match(
      /^(projection_rules\[\d+\](?:\.[^:]+)?|projection_rules\[\d+\])/u,
    )?.[1] ?? 'projection_rules';
    throw invalidWorldModel('WORLD_MODEL_INVALID', {
      path: diagnosticPath,
      expected: 'valid projection rule content',
      diagnosticCode: 'WORLD_MODEL_PROJECTION_RULES_INVALID',
      received: diagnostic,
      validator: 'normalizeProjectionRules → validateProjectionRuleContent',
    });
  }
  const species = Array.isArray(raw.species)
    ? mergeHumanSpeciesEntries(
        raw.species.map((item, index) =>
          normalizeSpecies(item, index, { strict }),
        ),
      )
    : [];
  return {
    schema_version: WORLD_MODEL_SCHEMA.schema_version,
    species,
    medical_context: normalizeMedicalContext(raw.medical_context),
    exceptions: normalizeExceptions(raw.exceptions, { strict }),
    unknowns: stringList(raw.unknowns, localizedWorldModelText, { strict, path: 'unknowns' }),
    projection_rules: projectionRules,
  };
}

export function validateWorldModel(raw, { allowGeneratedProjectionRuleIds = false } = {}) {
  return normalizeWorldModel(raw, { strict: true, allowGeneratedProjectionRuleIds });
}

export function normalizeStoredWorldModel(raw, { strict = false } = {}) {
  return normalizeWorldModel(raw, { strict, allowGeneratedProjectionRuleIds: true });
}

// The World page and the Runtime hard gate share this canonical read model.
// A structurally valid but empty model is not ready for Character/Event use.
export function buildWorldModelViewModel(raw) {
  let model;
  try {
    model = normalizeStoredWorldModel(raw);
  } catch (cause) {
    const error = new Error('WORLD_MODEL_UI_NOT_READY');
    error.code = 'WORLD_MODEL_UI_NOT_READY';
    error.analysis_stage = 'world_view_model';
    error.cause = cause;
    throw error;
  }
  if (!Array.isArray(model.species) || model.species.length === 0) {
    const error = new Error('WORLD_MODEL_UI_NOT_READY');
    error.code = 'WORLD_MODEL_UI_NOT_READY';
    error.analysis_stage = 'world_ui_ready';
    error.diagnostic_code = 'WORLD_MODEL_EMPTY_SPECIES';
    throw error;
  }
  return {model};
}

function responseText(raw) {
  if (typeof raw === 'string') return raw;
  if (!raw || typeof raw !== 'object') return '';
  if (typeof raw.text === 'string') return raw.text;
  if (typeof raw.content === 'string') return raw.content;
  if (Array.isArray(raw.content)) {
    return raw.content
      .map((item) => (typeof item === 'string' ? item : (item?.text ?? '')))
      .join('');
  }
  const choice = Array.isArray(raw.choices) ? raw.choices[0] : null;
  if (typeof choice?.message?.content === 'string')
    return choice.message.content;
  if (Array.isArray(choice?.message?.content)) {
    return choice.message.content
      .map((item) => (typeof item === 'string' ? item : (item?.text ?? '')))
      .join('');
  }
  if (typeof choice?.text === 'string') return choice.text;
  if (raw.data && typeof raw.data === 'object') return responseText(raw.data);
  return '';
}

function eventResponseShape(raw) {
  if (typeof raw === 'string') return 'string';
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return Array.isArray(raw) ? 'array' : raw === null ? 'null' : typeof raw;
  if (typeof raw.content === 'string') return 'content';
  if (Array.isArray(raw.content)) return 'content_array';
  if (Array.isArray(raw.choices)) {
    const content = raw.choices[0]?.message?.content;
    if (typeof content === 'string') return 'choices.message.content';
    if (Array.isArray(content)) return 'choices.message.content_array';
    if (typeof raw.choices[0]?.text === 'string') return 'choices.text';
    return 'choices';
  }
  if (raw.data && typeof raw.data === 'object') return 'data';
  if (raw.schema_version !== undefined || raw.events !== undefined)
    return 'event_payload';
  return 'object';
}

function eventExtractionMode(text) {
  const value = String(text ?? '').trim();
  if (!value) return 'empty';
  if (/^\s*\{[\s\S]*\}\s*$/u.test(value)) return 'direct_json';
  if (/^\s*<think>[\s\S]*<\/think>\s*\{[\s\S]*\}\s*$/iu.test(value))
    return 'think_plus_json_rejected_by_event_parser';
  if (/```/u.test(value)) return 'fenced_json_rejected_by_event_parser';
  return 'non_json_text';
}

function traceAnalyzerReceived(raw) {
  if (globalThis?.__BIOWEAVE_API_TRACE__ !== true) return 0;
  let text = '';
  try {
    text = responseText(raw);
  } catch {
    text = '';
  }
  let topLevelKeys = [];
  let constructor = null;
  let contentExists = false;
  let choicesExists = false;
  try {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      topLevelKeys = Object.keys(raw).slice(0, 64);
      constructor = raw?.constructor?.name ?? null;
      contentExists = Object.hasOwn(raw, 'content');
      choicesExists = Array.isArray(raw.choices);
    }
  } catch {
    topLevelKeys = [];
  }
  traceApi('analyzer-received', {
    rawType: typeof raw,
    constructor,
    topLevelKeys,
    responseTextLength: text.length,
    contentExists,
    choicesExists,
  });
  return text.length;
}

function traceParserError(error) {
  return {
    code: typeof error?.code === 'string' ? error.code : null,
    diagnosticCode:
      typeof error?.diagnosticCode === 'string'
        ? error.diagnosticCode
        : typeof error?.diagnostic_code === 'string'
          ? error.diagnostic_code
          : typeof error?.error_code === 'string'
            ? error.error_code
            : null,
    analysisStage: typeof error?.analysis_stage === 'string' ? error.analysis_stage : null,
    stage: typeof error?.stage === 'string' ? error.stage : null,
    path: typeof error?.path === 'string' ? error.path : null,
    expected: typeof error?.expected === 'string' ? error.expected : null,
    received: typeof error?.received === 'string' ? error.received : null,
    validator: typeof error?.validator === 'string' ? error.validator : null,
    operationIndex: Number.isInteger(error?.operation_index) ? error.operation_index : null,
    operationOp: typeof error?.operation_op === 'string' ? error.operation_op : null,
    canonicalTargetPath: typeof error?.canonical_target_path === 'string' ? error.canonical_target_path : null,
    rejectedSemanticField: typeof error?.rejected_semantic_field === 'string' ? error.rejected_semantic_field : null,
    validationStage: typeof error?.validation_stage === 'string' ? error.validation_stage : null,
    keyword: typeof error?.keyword === 'string' ? error.keyword : null,
    instancePath: typeof error?.instancePath === 'string' ? error.instancePath : null,
    schemaPath: typeof error?.schemaPath === 'string' ? error.schemaPath : null,
    params: error?.params && typeof error.params === 'object' ? error.params : null,
  };
}

const EVENT_CAPABILITY_KEYS = Object.freeze([
  'can_produce_sperm',
  'can_produce_ova',
  'can_be_fertilized',
  'can_fertilize',
  'can_carry_pregnancy',
  'can_cause_pregnancy',
]);
const EVENT_BIOLOGICAL_CONTEXT_KEYS = Object.freeze([
  'species',
  'biological_type',
]);
const EVENT_SCHEMA_VERSION = Number(
  eventDomain.EVENT_SCHEMA_VERSION ??
    eventDomain.BIOLOGICAL_EVENT_SCHEMA?.schema_version ??
    1,
);
const EVENT_STORY_TIME_PRECISIONS = new Set([
  'year',
  'month',
  'day',
  'hour',
  'minute',
  'unknown',
]);
const EVENT_SENSITIVE_KEY_PATTERN =
  /(?:^|_)(?:api[_-]?key|api[_-]?secret|authorization|access[_-]?token|refresh[_-]?token|bearer|password|credential|secret|token)(?:$|_)/iu;
const EVENT_IDENTITY_STATUSES = new Set(['existing', 'new', 'unresolved']);
const EVENT_ALIAS_CANDIDATE_KINDS = new Set(['name_variant', 'nickname']);
const EVENT_AI_FIELDS = new Set([
  'event_id',
  'type',
  'status',
  'story_time',
  'location',
  'participants',
  'pregnancy_relevance',
  'source_evidence',
  'source',
  'physical_effect',
  'state_fact',
]);

function invalidEventAnalysis(
  message = 'EVENT_ANALYSIS_INVALID',
  stage = 'schema_validation',
  { diagnosticCode = null, diagnosticPath = null } = {},
) {
  const error = new Error(message);
  error.code = 'EVENT_ANALYSIS_INVALID';
  error.analysis_stage = stage;
  if (diagnosticCode) {
    error.diagnostic_code = diagnosticCode;
    error.error_code = diagnosticCode;
  }
  if (diagnosticPath) {
    error.diagnostic_path = diagnosticPath;
    error.error_path = diagnosticPath;
  }
  return error;
}

function eventDiagnostic(code, path, message) {
  const error = invalidEventAnalysis(message, 'schema_validation', {
    diagnosticCode: code,
    diagnosticPath: path,
  });
  error.validator = 'event_contract';
  error.keyword = code;
  error.instancePath = path;
  error.schemaPath = `#/events${String(path ?? '').replace(/^\$\.events/iu, '')}`;
  error.params = {};
  return error;
}

function eventPath(index, suffix = '') {
  return `$.events[${index}]${suffix}`;
}

function diagnosticSegment(value) {
  return (
    String(value ?? '')
      .replace(/[^a-z0-9]+/giu, '_')
      .replace(/^_|_$/gu, '') || 'FIELD'
  );
}

function annotateAnalysisError(error, stage) {
  const target =
    error instanceof Error
      ? error
      : new Error(String(error ?? 'EVENT_ANALYSIS_FAILED'));
  if (!target.analysis_stage) target.analysis_stage = stage;
  return target;
}

function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function eventText(value, field, { nullable = true } = {}) {
  if (value === undefined || value === null) {
    if (nullable) return null;
    throw invalidEventAnalysis(
      `EVENT_ANALYSIS_${field.toUpperCase()}_REQUIRED`,
    );
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw invalidEventAnalysis(`EVENT_ANALYSIS_${field.toUpperCase()}_INVALID`);
  }
  const text = String(value).trim();
  if (!text && !nullable)
    throw invalidEventAnalysis(
      `EVENT_ANALYSIS_${field.toUpperCase()}_REQUIRED`,
    );
  return text || null;
}

function eventBoolean(value, field, fallback = null) {
  if (value === undefined) return fallback;
  if (value === null || typeof value === 'boolean') return value;
  throw invalidEventAnalysis(`EVENT_ANALYSIS_${field.toUpperCase()}_INVALID`);
}

function requiredEventBoolean(value, field) {
  if (typeof value !== 'boolean') {
    throw invalidEventAnalysis(`EVENT_ANALYSIS_${field.toUpperCase()}_INVALID`);
  }
  return value;
}

function eventConfidence(value, field) {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw invalidEventAnalysis(`EVENT_ANALYSIS_${field.toUpperCase()}_INVALID`);
  }
  return value;
}

function eventIdArray(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw invalidEventAnalysis(
      `EVENT_ANALYSIS_${field.toUpperCase()}_ARRAY_REQUIRED`,
    );
  const ids = [];
  const seen = new Set();
  for (const item of value) {
    const id = eventText(item, field, { nullable: false });
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function safeEventValue(value, seen = new Set()) {
  if (value === undefined || value === null) return value ?? null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value))
    return value.map((item) => safeEventValue(item, seen));
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (EVENT_SENSITIVE_KEY_PATTERN.test(key)) continue;
    output[key] = safeEventValue(item, seen);
  }
  return output;
}

function eventEvidence(value, field, path = `$.${field}`) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw eventDiagnostic(
      'invalid_evidence_shape',
      path,
      `EVENT_ANALYSIS_${field.toUpperCase()}_ARRAY_REQUIRED`,
    );
  }
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw eventDiagnostic(
        'invalid_evidence_shape',
        `${path}[${index}]`,
        `EVENT_ANALYSIS_${field.toUpperCase()}_${index}_INVALID`,
      );
    }
    if (
      typeof item.kind !== 'string' ||
      !item.kind.trim() ||
      typeof item.text !== 'string' ||
      !item.text.trim()
    ) {
      throw eventDiagnostic(
        'invalid_evidence_shape',
        `${path}[${index}]`,
        `EVENT_ANALYSIS_${field.toUpperCase()}_${index}_INVALID`,
      );
    }
    return {
      kind: item.kind.trim(),
      text: item.text.trim(),
    };
  });
}

function normalizeEventIdentityStatus(value, participantIndex, eventIndex = 0) {
  const status =
    value === undefined || value === null
      ? 'existing'
      : eventText(value, `participant_${participantIndex}_identity_status`, {
          nullable: false,
        });
  if (!EVENT_IDENTITY_STATUSES.has(status)) {
    throw eventDiagnostic(
      'invalid_identity_status',
      `$.events[${eventIndex}].participants[${participantIndex}].identity_status`,
      `EVENT_ANALYSIS_PARTICIPANT_${participantIndex}_IDENTITY_STATUS_INVALID`,
    );
  }
  return status;
}

function validateRawParticipantIdentity(
  participant,
  eventIndex,
  participantIndex,
) {
  const basePath = `${eventPath(eventIndex)}.participants[${participantIndex}]`;
  const status =
    participant.identity_status === undefined ||
    participant.identity_status === null
      ? 'existing'
      : typeof participant.identity_status === 'string'
        ? participant.identity_status.trim()
        : null;
  if (!EVENT_IDENTITY_STATUSES.has(status)) {
    throw eventDiagnostic(
      'invalid_identity_status',
      `${basePath}.identity_status`,
      `EVENT_ANALYSIS_PARTICIPANT_${participantIndex}_IDENTITY_STATUS_INVALID`,
    );
  }
  if (
    status === 'existing' &&
    (participant.character_id === null ||
      participant.character_id === undefined ||
      (typeof participant.character_id === 'string' &&
        !participant.character_id.trim()))
  ) {
    throw eventDiagnostic(
      'existing_character_id_required',
      `${basePath}.character_id`,
      `EVENT_ANALYSIS_PARTICIPANT_${participantIndex}_CHARACTER_ID_REQUIRED`,
    );
  }
  if (status !== 'existing') {
    if (participant.character_id !== null) {
      throw eventDiagnostic(
        'provisional_character_id_forbidden',
        `${basePath}.character_id`,
        `EVENT_ANALYSIS_PARTICIPANT_${participantIndex}_PROVISIONAL_CHARACTER_ID_FORBIDDEN`,
      );
    }
    if (
      typeof participant.mention_id !== 'string' ||
      !participant.mention_id.trim()
    ) {
      throw eventDiagnostic(
        'mention_id_required',
        `${basePath}.mention_id`,
        `EVENT_ANALYSIS_PARTICIPANT_${participantIndex}_MENTION_ID_REQUIRED`,
      );
    }
  }
  if (
    participant.mention_id !== undefined &&
    participant.mention_id !== null &&
    (typeof participant.mention_id !== 'string' ||
      !participant.mention_id.trim())
  ) {
    throw eventDiagnostic(
      'invalid_mention_id',
      `${basePath}.mention_id`,
      `EVENT_ANALYSIS_PARTICIPANT_${participantIndex}_MENTION_ID_INVALID`,
    );
  }
  if (
    participant.alias_candidate !== undefined &&
    participant.alias_candidate !== null
  ) {
    const candidate = participant.alias_candidate;
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate)
    ) {
      throw eventDiagnostic(
        'invalid_alias_candidate',
        `${basePath}.alias_candidate`,
        `EVENT_ANALYSIS_PARTICIPANT_${participantIndex}_ALIAS_CANDIDATE_INVALID`,
      );
    }
    if (
      typeof candidate.value !== 'string' ||
      !candidate.value.trim() ||
      typeof candidate.kind !== 'string' ||
      !EVENT_ALIAS_CANDIDATE_KINDS.has(candidate.kind.trim())
    ) {
      throw eventDiagnostic(
        'invalid_alias_candidate',
        `${basePath}.alias_candidate`,
        `EVENT_ANALYSIS_PARTICIPANT_${participantIndex}_ALIAS_CANDIDATE_INVALID`,
      );
    }
    if (
      candidate.confidence !== undefined &&
      candidate.confidence !== null &&
      (typeof candidate.confidence !== 'number' ||
        !Number.isFinite(candidate.confidence) ||
        candidate.confidence < 0 ||
        candidate.confidence > 1)
    ) {
      throw eventDiagnostic(
        'invalid_alias_candidate',
        `${basePath}.alias_candidate.confidence`,
        `EVENT_ANALYSIS_PARTICIPANT_${participantIndex}_ALIAS_CANDIDATE_CONFIDENCE_INVALID`,
      );
    }
  }
  if (participant.identity_evidence !== undefined) {
    eventEvidence(
      participant.identity_evidence,
      `participant_${participantIndex}_identity_evidence`,
      `${basePath}.identity_evidence`,
    );
  }
  return status;
}

function validateRawEventShape(raw, eventIndex) {
  const basePath = eventPath(eventIndex);
  const unexpectedKey = Object.keys(raw).find(
    (key) => !EVENT_AI_FIELDS.has(key),
  );
  if (unexpectedKey) {
    throw eventDiagnostic(
      'unexpected_event_field',
      `${basePath}.${unexpectedKey}`,
      `EVENT_SCHEMA_UNEXPECTED_EVENT_FIELD_${diagnosticSegment(unexpectedKey).toUpperCase()}`,
    );
  }
  for (const field of [
    'type',
    'status',
    'story_time',
    'location',
    'participants',
    'pregnancy_relevance',
    'source_evidence',
  ]) {
    if (!hasOwn(raw, field)) {
      throw eventDiagnostic(
        'missing_event_field',
        `${basePath}.${field}`,
        `EVENT_ANALYSIS_${field.toUpperCase()}_REQUIRED`,
      );
    }
  }
  for (const field of ['type', 'status', 'location']) {
    if (
      hasOwn(raw, field) &&
      raw[field] !== null &&
      typeof raw[field] !== 'string' &&
      typeof raw[field] !== 'number'
    ) {
      throw invalidEventAnalysis(
        `EVENT_ANALYSIS_${field.toUpperCase()}_INVALID`,
      );
    }
  }
  if (hasOwn(raw, 'participants') && !Array.isArray(raw.participants)) {
    throw invalidEventAnalysis('EVENT_ANALYSIS_PARTICIPANTS_ARRAY_REQUIRED');
  }
  const allowedRoles = new Set(
    eventDomain.REPRODUCTIVE_ROLES ?? [
      'potential_gestational_subject',
      'potential_conception_source',
      'other_participant',
      'unknown',
    ],
  );
  for (const [index, participant] of (Array.isArray(raw.participants)
    ? raw.participants
    : []
  ).entries()) {
    if (
      !participant ||
      typeof participant !== 'object' ||
      Array.isArray(participant)
    ) {
      throw invalidEventAnalysis(`EVENT_ANALYSIS_PARTICIPANT_${index}_INVALID`);
    }
    for (const field of [
      'character_id',
      'display_name',
      'event_role',
      'reproductive_capabilities_used',
      'evidence',
    ]) {
      if (!hasOwn(participant, field)) {
        throw invalidEventAnalysis(
          `EVENT_ANALYSIS_PARTICIPANT_${index}_${field.toUpperCase()}_REQUIRED`,
        );
      }
    }
    for (const field of ['character_id', 'display_name', 'event_role']) {
      if (
        hasOwn(participant, field) &&
        participant[field] !== null &&
        typeof participant[field] !== 'string' &&
        typeof participant[field] !== 'number'
      ) {
        throw invalidEventAnalysis(
          `EVENT_ANALYSIS_PARTICIPANT_${index}_${field.toUpperCase()}_INVALID`,
        );
      }
    }
    validateRawParticipantIdentity(participant, eventIndex, index);
    if (
      hasOwn(participant, 'event_role') &&
      (typeof participant.event_role !== 'string' ||
        !allowedRoles.has(participant.event_role.trim()))
    ) {
      throw eventDiagnostic(
        'invalid_event_role',
        `${basePath}.participants[${index}].event_role`,
        `EVENT_ANALYSIS_PARTICIPANT_${index}_EVENT_ROLE_INVALID`,
      );
    }
    const capabilities = participant.reproductive_capabilities_used;
    if (
      !capabilities ||
      typeof capabilities !== 'object' ||
      Array.isArray(capabilities)
    ) {
      throw invalidEventAnalysis(
        `EVENT_ANALYSIS_PARTICIPANT_${index}_CAPABILITIES_INVALID`,
      );
    }
    for (const key of EVENT_CAPABILITY_KEYS) {
      if (!hasOwn(capabilities, key)) {
        throw invalidEventAnalysis(
          `EVENT_ANALYSIS_PARTICIPANT_${index}_${key.toUpperCase()}_REQUIRED`,
        );
      }
      if (
        capabilities[key] !== null &&
        typeof capabilities[key] !== 'boolean'
      ) {
        throw invalidEventAnalysis(
          `EVENT_ANALYSIS_PARTICIPANT_${index}_${key.toUpperCase()}_INVALID`,
        );
      }
    }
    if (!Array.isArray(participant.evidence)) {
      throw invalidEventAnalysis(
        `EVENT_ANALYSIS_PARTICIPANT_${index}_EVIDENCE_ARRAY_REQUIRED`,
      );
    }
    eventEvidence(
      participant.evidence,
      `participant_${index}_evidence`,
      `${basePath}.participants[${index}].evidence`,
    );
  }

  const storyTime = raw.story_time;
  if (!storyTime || typeof storyTime !== 'object' || Array.isArray(storyTime)) {
    throw invalidEventAnalysis('EVENT_ANALYSIS_STORY_TIME_INVALID');
  }
  for (const field of [
    'display',
    'normalized',
    'calendar_id',
    'day_index',
    'precision',
    'confidence',
  ]) {
    if (!hasOwn(storyTime, field)) {
      throw invalidEventAnalysis(
        `EVENT_ANALYSIS_STORY_TIME_${field.toUpperCase()}_REQUIRED`,
      );
    }
  }
  if (
    typeof storyTime.precision !== 'string' ||
    !EVENT_STORY_TIME_PRECISIONS.has(storyTime.precision)
  ) {
    throw invalidEventAnalysis('EVENT_ANALYSIS_STORY_TIME_PRECISION_INVALID');
  }
  for (const field of ['display', 'normalized', 'calendar_id']) {
    if (
      storyTime[field] !== null &&
      typeof storyTime[field] !== 'string' &&
      typeof storyTime[field] !== 'number'
    ) {
      throw invalidEventAnalysis(
        `EVENT_ANALYSIS_STORY_TIME_${field.toUpperCase()}_INVALID`,
      );
    }
  }
  for (const field of ['day_index', 'confidence']) {
    if (
      storyTime[field] !== null &&
      (typeof storyTime[field] !== 'number' ||
        !Number.isFinite(storyTime[field]))
    ) {
      throw invalidEventAnalysis(
        `EVENT_ANALYSIS_STORY_TIME_${field.toUpperCase()}_INVALID`,
      );
    }
  }
  const relevance = raw.pregnancy_relevance;
  if (relevance !== undefined && relevance !== null) {
    if (typeof relevance !== 'object' || Array.isArray(relevance)) {
      throw invalidEventAnalysis('EVENT_ANALYSIS_PREGNANCY_RELEVANCE_INVALID');
    }
    for (const field of [
      'relevant',
      'possible_conception',
      'gestational_subject_ids',
      'counterpart_ids',
      'confidence',
    ]) {
      if (!hasOwn(relevance, field)) {
        throw invalidEventAnalysis(
          `EVENT_ANALYSIS_PREGNANCY_RELEVANCE_${field.toUpperCase()}_REQUIRED`,
        );
      }
    }
    for (const field of ['relevant', 'possible_conception']) {
      if (hasOwn(relevance, field) && typeof relevance[field] !== 'boolean') {
        if (field === 'possible_conception') {
          throw eventDiagnostic(
            'invalid_possible_conception',
            `${basePath}.pregnancy_relevance.possible_conception`,
            'EVENT_ANALYSIS_POSSIBLE_CONCEPTION_INVALID',
          );
        }
        throw invalidEventAnalysis(
          `EVENT_ANALYSIS_${field.toUpperCase()}_INVALID`,
        );
      }
    }
    for (const field of ['gestational_subject_ids', 'counterpart_ids']) {
      if (hasOwn(relevance, field) && !Array.isArray(relevance[field])) {
        throw invalidEventAnalysis(
          `EVENT_ANALYSIS_${field.toUpperCase()}_ARRAY_REQUIRED`,
        );
      }
    }
    if (
      hasOwn(relevance, 'confidence') &&
      relevance.confidence !== null &&
      (typeof relevance.confidence !== 'number' ||
        !Number.isFinite(relevance.confidence))
    ) {
      throw invalidEventAnalysis(
        'EVENT_ANALYSIS_PREGNANCY_RELEVANCE_CONFIDENCE_INVALID',
      );
    }
  }
  if (!Array.isArray(raw.source_evidence)) {
    throw eventDiagnostic(
      'invalid_evidence_shape',
      `${basePath}.source_evidence`,
      'EVENT_ANALYSIS_SOURCE_EVIDENCE_ARRAY_REQUIRED',
    );
  }
  eventEvidence(
    raw.source_evidence,
    'source_evidence',
    `${basePath}.source_evidence`,
  );
  if (
    hasOwn(raw, 'physical_effect') &&
    raw.physical_effect !== null &&
    (typeof raw.physical_effect !== 'object' ||
      Array.isArray(raw.physical_effect))
  ) {
    throw eventDiagnostic(
      'invalid_physical_effect',
      `${basePath}.physical_effect`,
      'EVENT_ANALYSIS_PHYSICAL_EFFECT_INVALID',
    );
  }
  if (
    raw.physical_effect &&
    typeof raw.physical_effect === 'object' &&
    hasOwn(raw.physical_effect, 'gestational_substance_intake') &&
    raw.physical_effect.gestational_substance_intake !== null &&
    typeof raw.physical_effect.gestational_substance_intake !== 'boolean'
  ) {
    throw eventDiagnostic(
      'invalid_physical_effect',
      `${basePath}.physical_effect.gestational_substance_intake`,
      'EVENT_ANALYSIS_PHYSICAL_EFFECT_GESTATIONAL_SUBSTANCE_INTAKE_INVALID',
    );
  }
  validateRawStateFactShape(raw, eventIndex);
}

function stateFactText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function validateRawStateFactReference(value, path, {allowNew = false} = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw eventDiagnostic('invalid_state_fact_payload', path, 'EVENT_STATE_FACT_REFERENCE_INVALID');
  }
  if (value.kind === 'new' && allowNew && value.id === undefined) return;
  if (value.kind !== 'existing' || !stateFactText(value.id)) {
    throw eventDiagnostic('invalid_state_fact_payload', path, 'EVENT_STATE_FACT_REFERENCE_INVALID');
  }
}

function validateRawStateFactRecord(value, path, {allowHealthIdentity = false} = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !stateFactText(value.kind)) {
    throw eventDiagnostic('invalid_state_fact_payload', path, 'EVENT_STATE_FACT_RECORD_INVALID');
  }
  if (value.description !== undefined && value.description !== null && !stateFactText(value.description)) {
    throw eventDiagnostic('invalid_state_fact_payload', `${path}.description`, 'EVENT_STATE_FACT_DESCRIPTION_INVALID');
  }
  if (!allowHealthIdentity) return;
  const allowed = new Set(['kind', 'description', 'body_site', 'laterality', 'continuation']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw eventDiagnostic('invalid_state_fact_payload', `${path}.${key}`, 'EVENT_HEALTH_IDENTITY_FIELD_INVALID');
    }
  }
  if (value.body_site !== undefined && value.body_site !== null && !stateFactText(value.body_site)) {
    throw eventDiagnostic('invalid_state_fact_payload', `${path}.body_site`, 'EVENT_HEALTH_BODY_SITE_INVALID');
  }
  if (value.laterality !== undefined && value.laterality !== null &&
      !eventDomain.HEALTH_LATERALITY.includes(value.laterality)) {
    throw eventDiagnostic('invalid_state_fact_payload', `${path}.laterality`, 'EVENT_HEALTH_LATERALITY_INVALID');
  }
  if (value.continuation !== undefined && typeof value.continuation !== 'boolean') {
    throw eventDiagnostic('invalid_state_fact_payload', `${path}.continuation`, 'EVENT_HEALTH_CONTINUATION_INVALID');
  }
}

function validateRawStateFactShape(raw, eventIndex) {
  const type = String(raw.type ?? '').trim();
  const stateFact = raw.state_fact;
  const exposure = raw.pregnancy_relevance?.relevant === true;
  if (stateFact === undefined || stateFact === null) {
    if (eventDomain.STATE_FACT_EVENT_TYPES?.includes(type) && !exposure) {
      throw eventDiagnostic('missing_state_fact', `${eventPath(eventIndex)}.state_fact`, 'EVENT_STATE_FACT_REQUIRED');
    }
    return;
  }
  if (!stateFact || typeof stateFact !== 'object' || Array.isArray(stateFact)) {
    throw eventDiagnostic('invalid_state_fact', `${eventPath(eventIndex)}.state_fact`, 'EVENT_STATE_FACT_INVALID');
  }
  if (!stateFactText(stateFact.subject_id)) {
    throw eventDiagnostic('missing_state_fact_subject', `${eventPath(eventIndex)}.state_fact.subject_id`, 'EVENT_STATE_FACT_SUBJECT_REQUIRED');
  }
  const participantHandles = (Array.isArray(raw.participants) ? raw.participants : [])
    .flatMap((participant) => [participant?.character_id, participant?.mention_id])
    .filter(stateFactText);
  if (!participantHandles.includes(stateFact.subject_id)) {
    throw eventDiagnostic(
      'state_fact_subject_not_participant',
      `${eventPath(eventIndex)}.state_fact.subject_id`,
      'EVENT_STATE_FACT_SUBJECT_NOT_PARTICIPANT',
    );
  }
  if (!stateFact.payload || typeof stateFact.payload !== 'object' || Array.isArray(stateFact.payload)) {
    throw eventDiagnostic('invalid_state_fact_payload', `${eventPath(eventIndex)}.state_fact.payload`, 'EVENT_STATE_FACT_PAYLOAD_INVALID');
  }
  const payload = stateFact.payload;
  const payloadKeys = Object.keys(payload);
  const only = (...allowed) => payloadKeys.every((key) => allowed.includes(key));
  if (exposure || type === 'sexual_activity') {
    throw eventDiagnostic('state_fact_not_allowed', `${eventPath(eventIndex)}.state_fact`, 'EVENT_STATE_FACT_NOT_ALLOWED_FOR_EXPOSURE');
  }
  switch (type) {
    case 'menstrual_event':
    case 'ovulation_event':
      if (payloadKeys.length) throw eventDiagnostic('invalid_state_fact_payload', `${eventPath(eventIndex)}.state_fact.payload`, 'EVENT_STATE_FACT_PAYLOAD_MUST_BE_EMPTY');
      break;
    case 'conception':
      if (!only('pregnancy_ref') || !Object.hasOwn(payload, 'pregnancy_ref')) throw eventDiagnostic('missing_state_fact_identity', `${eventPath(eventIndex)}.state_fact.payload.pregnancy_ref`, 'EVENT_PREGNANCY_IDENTITY_REQUIRED');
      validateRawStateFactReference(payload.pregnancy_ref, `${eventPath(eventIndex)}.state_fact.payload.pregnancy_ref`, {allowNew: true});
      break;
    case 'pregnancy_suspicion':
      if (!only('pregnancy_ref', 'observation') || !Object.hasOwn(payload, 'observation')) throw eventDiagnostic('invalid_state_fact_payload', `${eventPath(eventIndex)}.state_fact.payload`, 'EVENT_STATE_FACT_OBSERVATION_REQUIRED');
      if (payload.pregnancy_ref !== undefined) validateRawStateFactReference(payload.pregnancy_ref, `${eventPath(eventIndex)}.state_fact.payload.pregnancy_ref`, {allowNew: true});
      validateRawStateFactRecord(payload.observation, `${eventPath(eventIndex)}.state_fact.payload.observation`);
      break;
    case 'pregnancy_confirmation':
      if (!only('pregnancy_ref') || !Object.hasOwn(payload, 'pregnancy_ref')) throw eventDiagnostic('missing_state_fact_identity', `${eventPath(eventIndex)}.state_fact.payload.pregnancy_ref`, 'EVENT_PREGNANCY_IDENTITY_REQUIRED');
      validateRawStateFactReference(payload.pregnancy_ref, `${eventPath(eventIndex)}.state_fact.payload.pregnancy_ref`, {allowNew: true});
      break;
    case 'pregnancy_loss':
    case 'abortion':
      if (!only('pregnancy_ref') || !Object.hasOwn(payload, 'pregnancy_ref')) throw eventDiagnostic('missing_state_fact_identity', `${eventPath(eventIndex)}.state_fact.payload.pregnancy_ref`, 'EVENT_PREGNANCY_IDENTITY_REQUIRED');
      validateRawStateFactReference(payload.pregnancy_ref, `${eventPath(eventIndex)}.state_fact.payload.pregnancy_ref`);
      break;
    case 'labor':
      if (!only('pregnancy_ref', 'labor_ref') || !Object.hasOwn(payload, 'pregnancy_ref') || !Object.hasOwn(payload, 'labor_ref')) throw eventDiagnostic('invalid_state_fact_payload', `${eventPath(eventIndex)}.state_fact.payload.labor_ref`, 'EVENT_LABOR_ID_REQUIRED');
      validateRawStateFactReference(payload.pregnancy_ref, `${eventPath(eventIndex)}.state_fact.payload.pregnancy_ref`);
      validateRawStateFactReference(payload.labor_ref, `${eventPath(eventIndex)}.state_fact.payload.labor_ref`, {allowNew: true});
      break;
    case 'delivery':
      if (!only('pregnancy_ref', 'delivery_ref') || !Object.hasOwn(payload, 'pregnancy_ref') || !Object.hasOwn(payload, 'delivery_ref')) throw eventDiagnostic('invalid_state_fact_payload', `${eventPath(eventIndex)}.state_fact.payload.delivery_ref`, 'EVENT_DELIVERY_ID_REQUIRED');
      validateRawStateFactReference(payload.pregnancy_ref, `${eventPath(eventIndex)}.state_fact.payload.pregnancy_ref`);
      validateRawStateFactReference(payload.delivery_ref, `${eventPath(eventIndex)}.state_fact.payload.delivery_ref`, {allowNew: true});
      break;
    case 'postpartum':
      if (!only('pregnancy_ref', 'postpartum_ref') || !Object.hasOwn(payload, 'pregnancy_ref') || !Object.hasOwn(payload, 'postpartum_ref')) throw eventDiagnostic('invalid_state_fact_payload', `${eventPath(eventIndex)}.state_fact.payload.postpartum_ref`, 'EVENT_POSTPARTUM_ID_REQUIRED');
      validateRawStateFactReference(payload.pregnancy_ref, `${eventPath(eventIndex)}.state_fact.payload.pregnancy_ref`);
      validateRawStateFactReference(payload.postpartum_ref, `${eventPath(eventIndex)}.state_fact.payload.postpartum_ref`, {allowNew: true});
      break;
    case 'fertility_change': {
      const changes = payload.capability_changes;
      if (!only('capability_changes') || !changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length) throw eventDiagnostic('invalid_state_fact_payload', `${eventPath(eventIndex)}.state_fact.payload.capability_changes`, 'EVENT_CAPABILITY_CHANGES_REQUIRED');
      for (const [key, value] of Object.entries(changes)) {
        if (!eventDomain.CAPABILITY_KEYS.includes(key) || ![true, false, null].includes(value)) throw eventDiagnostic('invalid_state_fact_payload', `${eventPath(eventIndex)}.state_fact.payload.capability_changes.${key}`, 'EVENT_CAPABILITY_CHANGE_INVALID');
      }
      break;
    }
    case 'physical_symptom':
      if (!only('symptom')) throw eventDiagnostic('invalid_state_fact_payload', `${eventPath(eventIndex)}.state_fact.payload`, 'EVENT_SYMPTOM_PAYLOAD_INVALID');
      validateRawStateFactRecord(payload.symptom, `${eventPath(eventIndex)}.state_fact.payload.symptom`, {allowHealthIdentity: true});
      break;
    case 'medical_event':
    case 'other_biological':
      if (!only('fact')) throw eventDiagnostic('invalid_state_fact_payload', `${eventPath(eventIndex)}.state_fact.payload`, 'EVENT_FACT_PAYLOAD_INVALID');
      validateRawStateFactRecord(payload.fact, `${eventPath(eventIndex)}.state_fact.payload.fact`, {allowHealthIdentity: true});
      break;
    default:
      throw eventDiagnostic('state_fact_type_invalid', `${eventPath(eventIndex)}.state_fact`, 'EVENT_STATE_FACT_TYPE_INVALID');
  }
}

function normalizeEventStoryTime(value) {
  if (value === undefined || value === null) {
    return {
      display: null,
      normalized: null,
      calendar_id: null,
      day_index: null,
      precision: 'unknown',
      confidence: null,
    };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidEventAnalysis('EVENT_ANALYSIS_STORY_TIME_INVALID');
  }
  const precision =
    value.precision === undefined || value.precision === null
      ? 'unknown'
      : eventText(value.precision, 'story_time_precision', { nullable: false });
  if (!EVENT_STORY_TIME_PRECISIONS.has(precision)) {
    throw invalidEventAnalysis('EVENT_ANALYSIS_STORY_TIME_PRECISION_INVALID');
  }
  let dayIndex = null;
  if (value.day_index !== undefined && value.day_index !== null) {
    if (
      typeof value.day_index !== 'number' ||
      !Number.isInteger(value.day_index)
    ) {
      throw invalidEventAnalysis('EVENT_ANALYSIS_STORY_TIME_DAY_INDEX_INVALID');
    }
    dayIndex = value.day_index;
  }
  return {
    display: eventText(value.display, 'story_time_display'),
    normalized: eventText(value.normalized, 'story_time_normalized'),
    calendar_id: eventText(value.calendar_id, 'story_time_calendar_id'),
    day_index: dayIndex,
    precision,
    confidence: eventConfidence(value.confidence, 'story_time_confidence'),
  };
}

function normalizeRawStateFact(value) {
  if (value === undefined || value === null) return null;
  return {
    subject_id: String(value.subject_id).trim(),
    payload: JSON.parse(JSON.stringify(value.payload)),
  };
}

function normalizeEventCapabilities(value) {
  if (value === undefined || value === null) {
    return Object.fromEntries(EVENT_CAPABILITY_KEYS.map((key) => [key, null]));
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidEventAnalysis('EVENT_ANALYSIS_CAPABILITIES_INVALID');
  }
  return Object.fromEntries(
    EVENT_CAPABILITY_KEYS.map((key) => [
      key,
      eventBoolean(value[key], key),
    ]),
  );
}

function validateEventParticipantBiologicalContext(
  value,
  eventIndex,
  participantIndex,
) {
  const path = `${eventPath(eventIndex)}.participants[${participantIndex}].biological_context`;
  const context = value.biological_context;
  if (
    !hasOwn(value, 'biological_context') ||
    !context ||
    typeof context !== 'object' ||
    Array.isArray(context)
  ) {
    throw eventDiagnostic(
      'invalid_biological_context',
      path,
      'EVENT_SCHEMA_PARTICIPANT_BIOLOGICAL_CONTEXT_INVALID',
    );
  }
  for (const field of EVENT_BIOLOGICAL_CONTEXT_KEYS) {
    const fieldPath = `${path}.${field}`;
    if (!hasOwn(context, field)) {
      throw eventDiagnostic(
        'invalid_biological_context',
        fieldPath,
        'EVENT_SCHEMA_PARTICIPANT_BIOLOGICAL_CONTEXT_FIELD_REQUIRED',
      );
    }
    if (
      context[field] !== null &&
      (typeof context[field] !== 'string' || !context[field].trim())
    ) {
      throw eventDiagnostic(
        'invalid_biological_context',
        fieldPath,
        'EVENT_SCHEMA_PARTICIPANT_BIOLOGICAL_CONTEXT_FIELD_INVALID',
      );
    }
  }
}

function normalizeEventParticipant(value, index, eventIndex = 0) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidEventAnalysis(`EVENT_ANALYSIS_PARTICIPANT_${index}_INVALID`);
  }
  const identityStatus = normalizeEventIdentityStatus(
    value.identity_status,
    index,
    eventIndex,
  );
  const characterId = eventText(
    value.character_id,
    `participant_${index}_character_id`,
    { nullable: identityStatus !== 'existing' },
  );
  const mentionId = eventText(
    value.mention_id,
    `participant_${index}_mention_id`,
  );
  const displayName = eventText(
    value.display_name,
    `participant_${index}_display_name`,
  );
  const role =
    eventText(value.event_role, `participant_${index}_event_role`) ?? 'unknown';
  const participant = {
    identity_status: identityStatus,
    character_id: characterId,
    mention_id: mentionId,
    display_name: displayName,
    event_role: role,
    reproductive_capabilities_used: normalizeEventCapabilities(
      value.reproductive_capabilities_used,
    ),
    evidence: eventEvidence(value.evidence, `participant_${index}_evidence`),
  };
  if (value.alias_candidate !== undefined && value.alias_candidate !== null) {
    participant.alias_candidate = safeEventValue(value.alias_candidate);
  }
  if (value.identity_evidence !== undefined) {
    participant.identity_evidence = eventEvidence(
      value.identity_evidence,
      `participant_${index}_identity_evidence`,
      `$.participants[${index}].identity_evidence`,
    );
  }
  if (
    value.biological_context !== undefined &&
    value.biological_context !== null
  ) {
    if (
      !value.biological_context ||
      typeof value.biological_context !== 'object' ||
      Array.isArray(value.biological_context)
    ) {
      throw invalidEventAnalysis(
        `EVENT_ANALYSIS_PARTICIPANT_${index}_BIOLOGICAL_CONTEXT_INVALID`,
      );
    }
    participant.biological_context = safeEventValue(value.biological_context);
  }
  return participant;
}

function normalizeEventParticipants(value) {
  return value;
}

function participantIdentityHandles(participant) {
  return [participant.mention_id, participant.character_id].filter(Boolean);
}

function normalizeEventMechanism(value, eventIndex) {
  if (value === undefined || value === null) {
    return {
      kind: null,
      label: null,
      pathway: null,
      world_model_rule_refs: [],
      evidence: [],
    };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw eventDiagnostic(
      'invalid_reproductive_mechanism',
      `${eventPath(eventIndex)}.pregnancy_relevance.reproductive_mechanism`,
      'EVENT_SCHEMA_REPRODUCTIVE_MECHANISM_INVALID',
    );
  }
  return {
    kind: eventText(value.kind, 'reproductive_mechanism_kind'),
    label: eventText(value.label, 'reproductive_mechanism_label'),
    pathway: eventText(value.pathway, 'reproductive_mechanism_pathway'),
    world_model_rule_refs: eventIdArray(
      value.world_model_rule_refs,
      'reproductive_mechanism_world_model_rule_refs',
    ),
    evidence: eventEvidence(
      value.evidence,
      'reproductive_mechanism_evidence',
      `${eventPath(eventIndex)}.pregnancy_relevance.reproductive_mechanism.evidence`,
    ),
  };
}

function normalizeEventPregnancyRelevance(value, participantIds, eventIndex) {
  if (
    value !== undefined &&
    value !== null &&
    (typeof value !== 'object' || Array.isArray(value))
  ) {
    throw invalidEventAnalysis('EVENT_ANALYSIS_PREGNANCY_RELEVANCE_INVALID');
  }
  const source = value && typeof value === 'object' ? value : {};
  const gestationalSubjectIds = eventIdArray(
    source.gestational_subject_ids,
    'gestational_subject_ids',
  );
  const counterpartIds = eventIdArray(
    source.counterpart_ids,
    'counterpart_ids',
  );
  for (const [field, ids] of [
    ['gestational_subject_ids', gestationalSubjectIds],
    ['counterpart_ids', counterpartIds],
  ]) {
    for (const [index, id] of ids.entries()) {
      if (!participantIds.has(id)) {
        throw eventDiagnostic(
          'participant_reference_invalid',
          `${eventPath(eventIndex)}.pregnancy_relevance.${field}[${index}]`,
          'EVENT_ANALYSIS_PARTICIPANT_REFERENCE_INVALID',
        );
      }
    }
  }
  return {
    relevant: requiredEventBoolean(
      source.relevant,
      'pregnancy_relevance_relevant',
    ),
    possible_conception: requiredEventBoolean(
      source.possible_conception,
      'possible_conception',
    ),
    gestational_subject_ids: gestationalSubjectIds,
    counterpart_ids: counterpartIds,
    reproductive_mechanism: normalizeEventMechanism(
      source.reproductive_mechanism,
      eventIndex,
    ),
    confidence: eventConfidence(
      source.confidence,
      'pregnancy_relevance_confidence',
    ),
  };
}

function normalizeEventRecord(
  raw,
  eventIndex,
  { deferIdentityValidation = false } = {},
) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw invalidEventAnalysis('EVENT_ANALYSIS_EVENT_INVALID');
  }
  validateRawEventShape(raw, eventIndex);
  const eventType = eventText(raw.type, 'type', { nullable: false });
  const eventStatus = eventText(raw.status, 'status', { nullable: false });
  const eventTypes = new Set(
    Array.isArray(eventDomain.EVENT_TYPES)
      ? eventDomain.EVENT_TYPES
      : EVENT_TYPES,
  );
  const eventStatuses = new Set(
    Array.isArray(eventDomain.EVENT_STATUS)
      ? eventDomain.EVENT_STATUS
      : EVENT_STATUS,
  );
  if (!eventTypes.has(eventType))
    throw invalidEventAnalysis('EVENT_ANALYSIS_TYPE_INVALID');
  if (!eventStatuses.has(eventStatus))
    throw invalidEventAnalysis('EVENT_ANALYSIS_STATUS_INVALID');
  const pregnancyExposure = raw.pregnancy_relevance?.relevant === true;
  const participants = normalizeEventParticipants(
    raw.participants.map((participant, participantIndex) => {
      if (pregnancyExposure) {
        validateEventParticipantBiologicalContext(
          participant,
          eventIndex,
          participantIndex,
        );
      }
      return normalizeEventParticipant(
        participant,
        participantIndex,
        eventIndex,
      );
    }),
  );
  const participantIds = new Set(
    participants.flatMap(participantIdentityHandles),
  );
  const normalized = {
    type: eventType,
    status: eventStatus,
    story_time: normalizeEventStoryTime(raw.story_time),
    location: eventText(raw.location, 'location'),
    participants,
    pregnancy_relevance: normalizeEventPregnancyRelevance(
      raw.pregnancy_relevance,
      participantIds,
      eventIndex,
    ),
    source_evidence: eventEvidence(
      raw.source_evidence,
      'source_evidence',
      `${eventPath(eventIndex)}.source_evidence`,
    ),
    physical_effect: safeEventValue(raw.physical_effect ?? {}),
    state_fact: normalizeRawStateFact(raw.state_fact),
  };
  const hasProvisionalIdentity = participants.some(
    (item) => item.identity_status !== 'existing' || !item.character_id,
  );
  if (!deferIdentityValidation && !hasProvisionalIdentity) {
    validateEventExposureStructure(normalized, eventIndex);
  }
  return normalized;
}

function validateEventExposureStructure(event, eventIndex) {
  const basePath = eventPath(eventIndex);
  const hasExposureEvidence =
    eventDomain.hasPregnancyRelevantExposureEvidence?.(
      event.source_evidence,
    ) === true;
  if (
    event.physical_effect?.gestational_substance_intake === true &&
    !hasExposureEvidence
  ) {
    throw eventDiagnostic(
      'missing_pregnancy_relevant_exposure_evidence',
      `${basePath}.source_evidence`,
      'EVENT_SCHEMA_PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_REQUIRED',
    );
  }
  const relevance = event.pregnancy_relevance;
  const subjectIds = relevance.gestational_subject_ids;
  const counterpartIds = relevance.counterpart_ids;
  const participantIds = new Set(
    event.participants.map((participant) => participant.character_id),
  );
  const pregnancyExposure = relevance.relevant === true;

  if (!pregnancyExposure) {
    if (event.type === 'sexual_activity' && (
      subjectIds.length ||
      counterpartIds.length ||
      event.participants.length
    )) {
      throw eventDiagnostic(
        'invalid_pregnancy_participants',
        `${basePath}.participants`,
        'EVENT_SCHEMA_INVALID_NON_EXPOSURE_PARTICIPANTS',
      );
    }
    return;
  }

  if (subjectIds.length < 1) {
    throw eventDiagnostic(
      'invalid_gestational_subject_cardinality',
      `${basePath}.pregnancy_relevance.gestational_subject_ids`,
      'EVENT_SCHEMA_GESTATIONAL_SUBJECT_REQUIRED',
    );
  }
  if (event.type === 'sexual_activity' && subjectIds.length !== 1) {
    throw eventDiagnostic(
      'invalid_gestational_subject_cardinality',
      `${basePath}.pregnancy_relevance.gestational_subject_ids`,
      'EVENT_SCHEMA_INVALID_GESTATIONAL_SUBJECT_CARDINALITY',
    );
  }
  if (counterpartIds.length < 1) {
    throw eventDiagnostic(
      'invalid_counterpart_cardinality',
      `${basePath}.pregnancy_relevance.counterpart_ids`,
      'EVENT_SCHEMA_INVALID_COUNTERPART_CARDINALITY',
    );
  }
  const subjectId = subjectIds[0];
  const overlapIndex = counterpartIds.indexOf(subjectId);
  if (overlapIndex >= 0) {
    throw eventDiagnostic(
      'gestational_subject_counterpart_overlap',
      `${basePath}.pregnancy_relevance.counterpart_ids[${overlapIndex}]`,
      'EVENT_SCHEMA_GESTATIONAL_SUBJECT_COUNTERPART_OVERLAP',
    );
  }
  const expectedParticipantIds = new Set([
    ...subjectIds,
    ...counterpartIds,
  ]);
  if (
    participantIds.size !== expectedParticipantIds.size ||
    [...participantIds].some((id) => !expectedParticipantIds.has(id))
  ) {
    throw eventDiagnostic(
      'invalid_pregnancy_participants',
      `${basePath}.participants`,
      'EVENT_SCHEMA_INVALID_PREGNANCY_PARTICIPANTS',
    );
  }
  if (!hasExposureEvidence) {
    throw eventDiagnostic(
      'missing_pregnancy_relevant_exposure_evidence',
      `${basePath}.source_evidence`,
      'EVENT_SCHEMA_PREGNANCY_RELEVANT_EXPOSURE_EVIDENCE_REQUIRED',
    );
  }
}

function eventPayload(raw) {
  if (
    raw &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    (hasOwn(raw, 'schema_version') || hasOwn(raw, 'events'))
  ) {
    return raw;
  }
  const text = responseText(raw).trim();
  if (!text)
    throw invalidEventAnalysis('EVENT_RESPONSE_EMPTY', 'response_parse');
  try {
    return JSON.parse(text);
  } catch {
    // Event extraction is stricter than the legacy World Model parser: no
    // fenced JSON or substring recovery is allowed at this boundary.
    throw invalidEventAnalysis('EVENT_RESPONSE_JSON_INVALID', 'response_parse');
  }
}

// Parse only the fixed Event response object. Identity and Floor provenance
// are deliberately absent here; Runtime owns both after a successful parse.
export function parseEventAnalysisResponse(
  raw,
  { deferIdentityValidation = false } = {},
) {
  const payload = eventPayload(raw);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw invalidEventAnalysis('EVENT_SCHEMA_INVALID');
  }
  const keys = Object.keys(payload);
  const unexpectedTopLevelField = keys.find(
    (key) => !['schema_version', 'events', 'source'].includes(key),
  );
  if (unexpectedTopLevelField) {
    throw eventDiagnostic(
      'unexpected_top_level_field',
      `$.${unexpectedTopLevelField}`,
      `EVENT_SCHEMA_UNEXPECTED_TOP_LEVEL_FIELD_${diagnosticSegment(unexpectedTopLevelField).toUpperCase()}`,
    );
  }
  if (
    payload.schema_version !== EVENT_SCHEMA_VERSION ||
    !Array.isArray(payload.events)
  ) {
    throw invalidEventAnalysis('EVENT_SCHEMA_INVALID');
  }
  const events = payload.events.map((event, index) =>
    normalizeEventRecord(event, index, { deferIdentityValidation }),
  );
  if (
    deferIdentityValidation ||
    events.some((event) =>
      event.participants.some((item) => item.identity_status !== 'existing'),
    )
  ) {
    return { schema_version: EVENT_SCHEMA_VERSION, events };
  }
  const gestationalSubjects = new Set();
  for (const [index, event] of events.entries()) {
    const relevance = event.pregnancy_relevance;
    if (relevance.relevant !== true) continue;
    for (const subjectId of relevance.gestational_subject_ids) {
      if (gestationalSubjects.has(subjectId)) {
        throw eventDiagnostic(
          'duplicate_gestational_subject_event',
          `${eventPath(index)}.pregnancy_relevance.gestational_subject_ids`,
          'EVENT_SCHEMA_DUPLICATE_GESTATIONAL_SUBJECT_EVENT',
        );
      }
      gestationalSubjects.add(subjectId);
    }
  }
  return { schema_version: EVENT_SCHEMA_VERSION, events };
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
  if (
    raw &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    raw.schema_version !== undefined
  ) {
    return validateWorldModel(raw);
  }
  let lastSchemaError = null;
  let lastParseError = null;
  for (const candidate of jsonCandidates(responseText(raw))) {
    let parsed;
    try {
      parsed = JSON.parse(candidate);
    } catch (error) {
      lastParseError = invalidWorldModel('WORLD_MODEL_INVALID', {
        stage: 'json_parse',
        diagnosticCode: 'WORLD_MODEL_JSON_PARSE',
        path: '$',
        expected: 'valid JSON object',
        received: error?.message ?? 'invalid JSON',
      });
      continue;
    }
    try {
      return validateWorldModel(parsed);
    } catch (error) {
      if (error?.code === 'WORLD_MODEL_INVALID') lastSchemaError = error;
      else throw error;
    }
  }
  if (lastSchemaError) throw lastSchemaError;
  if (lastParseError) throw lastParseError;
  throw invalidWorldModel('WORLD_MODEL_INVALID', {
    stage: 'json_parse',
    diagnosticCode: 'WORLD_MODEL_JSON_EMPTY',
    path: '$',
    expected: 'JSON object',
    received: 'empty response',
  });
}

const WORLD_MODEL_PATCH_V2_OPERATIONS = Object.freeze([
  'ADD_SPECIES',
  'ADD_TYPE',
  'SET_FIELD',
  'ADD_SPECIAL_RULE',
  'ADD_MECHANISM',
  'SET_MECHANISM_HORIZON',
  'ADD_EXCEPTION',
  'ADD_UNKNOWN',
  'ADD_PROJECTION_RULE',
  'DISABLE_PROJECTION_RULE',
]);
const WORLD_MODEL_PATCH_V2_SET_PATHS = Object.freeze({
  biological_type: Object.freeze([
    'capabilities.can_produce_sperm',
    'capabilities.can_produce_ova',
    'capabilities.can_be_fertilized',
    'capabilities.can_fertilize',
    'capabilities.can_cause_pregnancy',
    'capabilities.can_carry_pregnancy',
    'reproduction_rules.fertilization',
    'reproduction_rules.pregnancy_or_carrying',
    'reproduction_rules.cycle',
    'reproduction_rules.ovulation',
    'reproduction_rules.gestation',
    'reproduction_rules.labor',
    'lifecycle.maturation',
    'lifecycle.aging',
    'description',
  ]),
  species: Object.freeze(['description']),
  world: Object.freeze([
    'medical_context.childbirth_difficulty',
    'medical_context.care_level',
    'medical_context.evidence',
  ]),
});
const V2_ENTITY_FIELDS = Object.freeze({
  species: Object.freeze(['name', 'description', 'biological_types']),
  type: Object.freeze(['name', 'description', 'capabilities', 'reproduction_rules', 'lifecycle', 'reproductive_mechanisms', 'special_rules']),
  mechanism: Object.freeze(['key', 'label', 'pathway', 'carrying_compatibility', 'world_model_rule_refs', 'evidence', 'tracking_window_horizon']),
  exception: Object.freeze(['statement', 'applies_to', 'evidence']),
});

function invalidWorldModelPatchV2(message = 'WORLD_MODEL_PATCH_V2_INVALID', details = {}) {
  const error = new Error(message);
  error.code = 'WORLD_MODEL_PATCH_V2_INVALID';
  Object.assign(error, details);
  return error;
}

function v2Record(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_INVALID', { path, expected: 'object' });
  return value;
}

function v2ExactKeys(value, allowed, path) {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_INVALID', { path: `${path}.${unknown}` });
}

function v2RequiredText(value, path) {
  if (typeof value !== 'string' || !value.trim())
    throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_INVALID', { path, expected: 'non-empty string' });
  return value.trim();
}

function v2NullableText(value, path) {
  if (value !== null && typeof value !== 'string')
    throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_INVALID', { path, expected: 'string|null' });
  return value;
}

function validateV2EntityObject(value, kind, path) {
  const entity = v2Record(value, path);
  v2ExactKeys(entity, V2_ENTITY_FIELDS[kind], path);
  v2RequiredText(entity.name, `${path}.name`);
  if (entity.description !== undefined) v2NullableText(entity.description, `${path}.description`);
  if (kind === 'species') {
    if (entity.biological_types !== undefined) {
      if (!Array.isArray(entity.biological_types)) throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_INVALID', { path: `${path}.biological_types`, expected: 'array' });
      entity.biological_types.forEach((item, index) => validateV2EntityObject(item, 'type', `${path}.biological_types[${index}]`));
    }
    return entity;
  }
  for (const field of ['capabilities', 'reproduction_rules', 'lifecycle']) {
    if (entity[field] === undefined) continue;
    const object = v2Record(entity[field], `${path}.${field}`);
    const keys = field === 'capabilities' ? CAPABILITY_KEYS : field === 'reproduction_rules' ? WORLD_RULE_KEYS : LIFECYCLE_KEYS;
    v2ExactKeys(object, keys, `${path}.${field}`);
    for (const key of Object.keys(object)) {
      if (field === 'capabilities') {
        if (![true, false, null].includes(object[key])) throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_INVALID', { path: `${path}.${field}.${key}`, expected: 'boolean|null' });
      } else v2NullableText(object[key], `${path}.${field}.${key}`);
    }
  }
  if (entity.reproductive_mechanisms !== undefined) {
    if (!Array.isArray(entity.reproductive_mechanisms)) throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_INVALID', { path: `${path}.reproductive_mechanisms`, expected: 'array' });
    entity.reproductive_mechanisms.forEach((item, index) => validateV2Mechanism(item, `${path}.reproductive_mechanisms[${index}]`));
  }
  if (entity.special_rules !== undefined) {
    if (!Array.isArray(entity.special_rules) || !entity.special_rules.every((item) => typeof item === 'string' && item.trim()))
      throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_INVALID', { path: `${path}.special_rules`, expected: 'array<string>' });
  }
  return entity;
}

function validateV2Mechanism(value, path) {
  const mechanism = v2Record(value, path);
  v2ExactKeys(mechanism, V2_ENTITY_FIELDS.mechanism, path);
  v2RequiredText(mechanism.key, `${path}.key`);
  for (const field of ['label', 'pathway']) if (mechanism[field] !== undefined) v2NullableText(mechanism[field], `${path}.${field}`);
  if (mechanism.carrying_compatibility !== undefined && ![true, false, null].includes(mechanism.carrying_compatibility))
    throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_INVALID', { path: `${path}.carrying_compatibility` });
  for (const field of ['world_model_rule_refs', 'evidence']) {
    if (mechanism[field] !== undefined && (!Array.isArray(mechanism[field]) || !mechanism[field].every((item) => typeof item === 'string')))
      throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_INVALID', { path: `${path}.${field}`, expected: 'array<string>' });
  }
  if (mechanism.tracking_window_horizon !== undefined) normalizeTrackingWindowHorizon(mechanism.tracking_window_horizon, `${path}.tracking_window_horizon`);
  return mechanism;
}

function validateV2Target(value, kind) {
  const target = v2Record(value, 'operation.target');
  const fields = kind === 'world' ? ['kind'] : kind === 'species' ? ['kind', 'species_name'] : ['kind', 'species_name', 'type_name'];
  v2ExactKeys(target, fields, 'operation.target');
  if (target.kind !== kind) throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_INVALID', { path: 'operation.target.kind' });
  if (kind !== 'world') v2RequiredText(target.species_name, 'operation.target.species_name');
  if (kind === 'biological_type') v2RequiredText(target.type_name, 'operation.target.type_name');
  return target;
}

function validateV2Operation(operation, index) {
  const path = `operations[${index}]`;
  const value = v2Record(operation, path);
  if (!WORLD_MODEL_PATCH_V2_OPERATIONS.includes(value.op))
    throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_OPERATION_UNSUPPORTED', { path: `${path}.op` });
  if (Object.hasOwn(value, 'old_value') || Object.hasOwn(value, 'classification') || Object.hasOwn(value, 'status'))
    throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_INVALID', { path });
  if (value.op === 'ADD_SPECIES') {
    v2ExactKeys(value, ['op', 'species'], path);
    validateV2EntityObject(value.species, 'species', `${path}.species`);
  } else if (value.op === 'ADD_TYPE') {
    v2ExactKeys(value, ['op', 'target', 'type'], path);
    validateV2Target(value.target, 'species');
    validateV2EntityObject(value.type, 'type', `${path}.type`);
  } else if (value.op === 'SET_FIELD') {
    v2ExactKeys(value, ['op', 'target', 'path', 'value'], path);
    const targetKind = value.target?.kind;
    if (!['species', 'biological_type', 'world'].includes(targetKind)) throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_INVALID', { path: `${path}.target.kind` });
    validateV2Target(value.target, targetKind);
    if (!Array.isArray(value.path) || value.path.length === 0 || !value.path.every((part) => typeof part === 'string' && part.trim()))
      throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_INVALID', { path: `${path}.path` });
    const fieldPath = value.path.join('.');
    if (!WORLD_MODEL_PATCH_V2_SET_PATHS[targetKind].includes(fieldPath))
      throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_INVALID', { path: `${path}.path` });
    if (value.path[0] === 'capabilities') {
      if (![true, false, null].includes(value.value)) throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_INVALID', { path: `${path}.value`, expected: 'boolean|null' });
    } else v2NullableText(value.value, `${path}.value`);
  } else if (value.op === 'ADD_SPECIAL_RULE') {
    v2ExactKeys(value, ['op', 'target', 'value'], path);
    validateV2Target(value.target, 'biological_type');
    v2RequiredText(value.value, `${path}.value`);
  } else if (value.op === 'ADD_MECHANISM') {
    v2ExactKeys(value, ['op', 'target', 'mechanism'], path);
    validateV2Target(value.target, 'biological_type');
    validateV2Mechanism(value.mechanism, `${path}.mechanism`);
  } else if (value.op === 'SET_MECHANISM_HORIZON') {
    v2ExactKeys(value, ['op', 'target', 'mechanism_key', 'tracking_window_horizon'], path);
    validateV2Target(value.target, 'biological_type');
    v2RequiredText(value.mechanism_key, `${path}.mechanism_key`);
    normalizeTrackingWindowHorizon(value.tracking_window_horizon, `${path}.tracking_window_horizon`);
  } else if (value.op === 'ADD_EXCEPTION') {
    v2ExactKeys(value, ['op', 'exception'], path);
    const exception = v2Record(value.exception, `${path}.exception`);
    v2ExactKeys(exception, V2_ENTITY_FIELDS.exception, `${path}.exception`);
    v2RequiredText(exception.statement, `${path}.exception.statement`);
    for (const field of ['applies_to', 'evidence']) if (exception[field] !== undefined) v2NullableText(exception[field], `${path}.exception.${field}`);
  } else if (value.op === 'ADD_UNKNOWN') {
    v2ExactKeys(value, ['op', 'unknown'], path);
    v2RequiredText(value.unknown, `${path}.unknown`);
  } else if (value.op === 'ADD_PROJECTION_RULE') {
    v2ExactKeys(value, ['op', 'projection_rule'], path);
    if (Object.hasOwn(value.projection_rule ?? {}, 'projection_rule_id')) throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_INVALID', { path: `${path}.projection_rule.projection_rule_id` });
    const validation = validateProjectionRuleContent(value.projection_rule);
    if (!validation.ok) throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_INVALID', { path: `${path}.projection_rule`, details: validation.errors });
  } else if (value.op === 'DISABLE_PROJECTION_RULE') {
    v2ExactKeys(value, ['op', 'projection_rule_id', 'reason', 'source_evidence'], path);
    v2RequiredText(value.projection_rule_id, `${path}.projection_rule_id`);
    v2RequiredText(value.reason, `${path}.reason`);
    if (!Array.isArray(value.source_evidence) || value.source_evidence.length === 0 || !value.source_evidence.every(item => typeof item === 'string' && item.trim()))
      throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_INVALID', { path: `${path}.source_evidence`, expected: 'non-empty string[]' });
  }
  return value;
}

export function validateWorldModelPatchV2(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalidWorldModelPatchV2();
  if (raw.schema_version !== 2) throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_SCHEMA_VERSION_INVALID', { path: 'schema_version' });
  if (!Array.isArray(raw.operations)) throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_INVALID', { path: 'operations', expected: 'array' });
  v2ExactKeys(raw, ['schema_version', 'operations'], '$');
  return { schema_version: 2, operations: raw.operations.map(validateV2Operation) };
}

function v2Canonical(value) {
  if (Array.isArray(value)) return value.map(v2Canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, v2Canonical(value[key])]));
  return value;
}

function v2Equal(left, right) { return semanticPatchValueEqual(v2Canonical(left), v2Canonical(right)); }
function v2TextIdentity(value) {
  const normalized = normalizeRuleText(value);
  return normalized ? normalized.replace(/\s+/gu, '').replace(/[。！？!?\.]+$/gu, '') : '';
}
function v2Type(existing, speciesName, typeName) { return existing.species.find((item) => item.name === speciesName)?.biological_types.find((item) => item.name === typeName) ?? null; }
function v2Species(existing, speciesName) { return existing.species.find((item) => item.name === speciesName) ?? null; }
function v2Known(value) { return value !== null && value !== undefined; }

export function resolveWorldModelPatchV2Target(target) {
  const kind = target?.kind;
  validateV2Target(target, kind);
  if (kind === 'world') return { kind };
  const speciesName = canonicalSpeciesName(target.species_name);
  if (kind === 'species') return { kind, species_name: speciesName };
  return {
    kind,
    species_name: speciesName,
    type_name: normalizeBiologicalTypeName(target.type_name, speciesName),
  };
}

function v2CanonicalOperation(operation) {
  if (operation.op === 'ADD_TYPE') {
    return { ...operation, target: resolveWorldModelPatchV2Target(operation.target) };
  }
  if (['SET_FIELD', 'ADD_SPECIAL_RULE', 'ADD_MECHANISM', 'SET_MECHANISM_HORIZON'].includes(operation.op)) {
    return { ...operation, target: resolveWorldModelPatchV2Target(operation.target) };
  }
  return operation;
}

function v2FieldValue(existing, operation) {
  const target = operation.target;
  const [group, key] = operation.path;
  if (target.kind === 'world') return existing.medical_context?.[key] ?? null;
  const entity = target.kind === 'species' ? v2Species(existing, target.species_name) : v2Type(existing, target.species_name, target.type_name);
  if (!entity) throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_TARGET_NOT_FOUND', { path: 'operation.target' });
  return group ? entity[group]?.[key] ?? null : entity[key] ?? null;
}

function v2NormalizeField(operation) {
  const [group] = operation.path;
  if (group === 'capabilities') return operation.value === null ? null : nullableBoolean(operation.value, 'operation.value');
  if (group === 'reproduction_rules' || group === 'lifecycle' || group === 'medical_context' || operation.path[0] === 'description') return operation.value === null ? null : normalizeRuleText(operation.value);
  return operation.value;
}

function v2ClassifyField(existing, operation) {
  const oldValue = v2FieldValue(existing, operation);
  const newValue = v2NormalizeField(operation);
  if (v2Equal(oldValue, newValue)) return 'NO-OP';
  if (!v2Known(newValue)) {
    if (v2Known(oldValue)) throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_REMOVE_UNSUPPORTED', { path: operation.path.join('.') });
    return 'NO-OP';
  }
  return v2Known(oldValue) ? 'CHANGE' : 'ADD';
}

function v2NormalizeSpecies(value) { return normalizeWorldModel({ schema_version: 1, species: [value] }, { allowGeneratedProjectionRuleIds: true }).species[0]; }
function v2NormalizeType(value, speciesName) { return v2NormalizeSpecies({ name: speciesName, biological_types: [value] }).biological_types[0]; }
function v2NormalizeException(value) { return normalizeWorldModel({ schema_version: 1, exceptions: [value] }).exceptions[0]; }
function v2MechanismContent(value) { return patchMechanismSemanticValue(value); }

function v2CollectionClassification(existingValues, candidate, identityFor, contentFor) {
  const identity = identityFor(candidate);
  const current = existingValues.find((item) => identityFor(item) === identity);
  if (current) return v2Equal(contentFor(current), contentFor(candidate)) ? 'NO-OP' : 'REJECT';
  return 'ADD';
}

function v2PendingClassification(pending, identity, content, classification) {
  const previous = pending.get(identity);
  if (previous !== undefined) {
    if (v2Equal(previous.content, content)) return 'NO-OP';
    throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_IDENTITY_CONFLICT', { path: 'operations' });
  }
  pending.set(identity, { content, classification });
  return classification;
}

export function classifyWorldModelPatchV2(raw, existingModel) {
  const patch = validateWorldModelPatchV2(raw);
  const existing = normalizeWorldModel(existingModel ?? { schema_version: 1, species: [], exceptions: [], unknowns: [], projection_rules: [] }, { allowGeneratedProjectionRuleIds: true });
  const working = clonePatchValue(existing);
  const pending = new Map();
  const finalize = result => {
    if (result.classification === 'ADD' || result.classification === 'CHANGE' || result.classification === 'DISABLE') v2ApplyClassifiedOperations(working, [result]);
    return result;
  };
  return patch.operations.map((rawOperation) => {
    const operation = v2CanonicalOperation(rawOperation);
    if (operation.op === 'SET_FIELD') {
      const classification = v2ClassifyField(working, operation);
      const normalizedValue = v2NormalizeField(operation);
      return finalize({ operation, classification: v2PendingClassification(pending, `field:${operation.target.kind}:${operation.target.species_name ?? ''}:${operation.target.type_name ?? ''}:${operation.path.join('.')}`, normalizedValue, classification) });
    }
    if (operation.op === 'ADD_SPECIES') {
      const candidate = v2NormalizeSpecies(operation.species);
      const current = v2Species(working, candidate.name);
      if (!current) return finalize({ operation, classification: v2PendingClassification(pending, `species:${candidate.name}`, candidate, 'ADD'), target: { kind: 'species', species_name: candidate.name } });
      if (v2Equal(current, candidate)) return finalize({ operation, classification: 'NO-OP', target: { kind: 'species', species_name: candidate.name } });
      throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_IDENTITY_CONFLICT', { path: 'operation.species.name' });
    }
    if (operation.op === 'ADD_TYPE') {
      const speciesName = canonicalSpeciesName(operation.target.species_name);
      const species = v2Species(working, speciesName);
      if (!species) throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_TARGET_NOT_FOUND', { path: 'operation.target.species_name' });
      const candidate = v2NormalizeType(operation.type, speciesName);
      const current = species.biological_types.find((item) => item.name === candidate.name);
      if (!current) return finalize({ operation, classification: v2PendingClassification(pending, `type:${speciesName}:${candidate.name}`, candidate, 'ADD'), target: { kind: 'biological_type', species_name: speciesName, type_name: candidate.name } });
      if (v2Equal(current, candidate)) return finalize({ operation, classification: 'NO-OP', target: { kind: 'biological_type', species_name: speciesName, type_name: candidate.name } });
      throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_IDENTITY_CONFLICT', { path: 'operation.type.name' });
    }
    if (operation.op === 'ADD_SPECIAL_RULE') {
      const type = v2Type(working, canonicalSpeciesName(operation.target.species_name), normalizeBiologicalTypeName(operation.target.type_name, operation.target.species_name));
      if (!type) throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_TARGET_NOT_FOUND', { path: 'operation.target' });
      const value = v2TextIdentity(operation.value);
      return finalize({ operation, classification: v2PendingClassification(pending, `special_rule:${canonicalSpeciesName(operation.target.species_name)}:${type.name}:${value}`, value, type.special_rules.some((item) => v2TextIdentity(item) === value) ? 'NO-OP' : 'ADD') });
    }
    if (operation.op === 'ADD_MECHANISM') {
      const type = v2Type(working, canonicalSpeciesName(operation.target.species_name), normalizeBiologicalTypeName(operation.target.type_name, operation.target.species_name));
      if (!type) throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_TARGET_NOT_FOUND', { path: 'operation.target' });
      const candidate = normalizeReproductiveMechanism(operation.mechanism, 'operation.mechanism');
      const classification = v2PendingClassification(pending, `mechanism:${canonicalSpeciesName(operation.target.species_name)}:${type.name}:${candidate.key}`, candidate, v2CollectionClassification(type.reproductive_mechanisms, candidate, (item) => item.key, v2MechanismContent));
      if (classification === 'REJECT') throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_IDENTITY_CONFLICT', { path: 'operation.mechanism.key' });
      return finalize({ operation, classification, target: { kind: 'biological_type', species_name: canonicalSpeciesName(operation.target.species_name), type_name: type.name, mechanism_key: candidate.key } });
    }
    if (operation.op === 'SET_MECHANISM_HORIZON') {
      const type = v2Type(working, canonicalSpeciesName(operation.target.species_name), normalizeBiologicalTypeName(operation.target.type_name, operation.target.species_name));
      if (!type) throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_TARGET_NOT_FOUND', { path: 'operation.target' });
      const mechanism = type.reproductive_mechanisms.find(item => item.key === operation.mechanism_key);
      if (!mechanism) throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_TARGET_NOT_FOUND', { path: 'operation.mechanism_key' });
      const value = normalizeTrackingWindowHorizon(operation.tracking_window_horizon, 'operation.tracking_window_horizon');
      const classification = v2Equal(mechanism.tracking_window_horizon ?? null, value) ? 'NO-OP' : 'CHANGE';
      return finalize({ operation, classification, target: { kind: 'biological_type', species_name: canonicalSpeciesName(operation.target.species_name), type_name: type.name, mechanism_key: mechanism.key } });
    }
    if (operation.op === 'ADD_EXCEPTION') {
      const candidate = v2NormalizeException(operation.exception);
      const exceptionIdentity = `${v2TextIdentity(candidate.statement)}|${v2TextIdentity(candidate.applies_to)}`;
      const classification = working.exceptions.some(item => `${v2TextIdentity(item.statement)}|${v2TextIdentity(item.applies_to)}` === exceptionIdentity)
        ? 'NO-OP'
        : v2PendingClassification(pending, `exception:${exceptionIdentity}`, candidate, 'ADD');
      if (classification === 'REJECT') throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_IDENTITY_CONFLICT', { path: 'operation.exception' });
      return finalize({ operation, classification });
    }
    if (operation.op === 'ADD_UNKNOWN') {
      const candidate = v2TextIdentity(operation.unknown);
      return finalize({ operation, classification: v2PendingClassification(pending, `unknown:${candidate}`, candidate, working.unknowns.some((item) => v2TextIdentity(item) === candidate) ? 'NO-OP' : 'ADD') });
    }
    if (operation.op === 'DISABLE_PROJECTION_RULE') {
      const current = working.projection_rules.find(item => item.projection_rule_id === operation.projection_rule_id)
      if (!current) throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_TARGET_NOT_FOUND', { path: 'operation.projection_rule_id' })
      const pendingKey = `projection_rule:${operation.projection_rule_id}`
      if (pending.has(pendingKey)) throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_IDENTITY_CONFLICT', { path: 'operations' })
      pending.set(pendingKey, {content: null, classification: 'DISABLE'})
      return finalize({ operation, classification: 'DISABLE', target: { kind: 'projection_rule', projection_rule_id: operation.projection_rule_id } })
    }
    const candidate = normalizeProjectionRules([operation.projection_rule], { allowGeneratedIdentity: true })[0];
    const classification = v2PendingClassification(pending, `projection_rule:${candidate.projection_rule_id}`, candidate, v2CollectionClassification(working.projection_rules, candidate, (item) => item.projection_rule_id, (item) => item));
    if (classification === 'REJECT') throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_IDENTITY_CONFLICT', { path: 'operation.projection_rule' });
    return finalize({ operation, classification, target: { kind: 'projection_rule', projection_rule_id: candidate.projection_rule_id } });
  });
}

function v2EvidenceError(path) {
  throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED', { path });
}

function v2IndividualOnlyUnit(unit) {
  return /(?:某(?:个|位|名)?(?:角色|人物|个体|NPC)|这个角色|该角色|单个(?:角色|人物|个体)|\b(?:an?|one|single)\s+(?:character|person|individual|NPC)\b)/iu.test(evidenceUnitText(unit));
}

function evidenceUnitText(unit) {
  return typeof unit === 'string' ? unit : String(unit?.text ?? '');
}

function structuredScopeMatches(unit, context = {}) {
  const parent = unit?.parent_context;
  const headings = Array.isArray(parent?.headings)
    ? parent.headings.map(value => compactEvidenceText(value)).filter(Boolean)
    : [];
  const parentSpecies = compactEvidenceText(parent?.species);
  const parentType = compactEvidenceText(parent?.biological_type);
  const expectedSpecies = compactEvidenceText(context.speciesName);
  const expectedType = compactEvidenceText(context.typeName);
  const speciesMatches = value => {
    const actual = compactEvidenceText(value);
    return actual === expectedSpecies || isSpeciesNameOrGenericDerivative(actual, expectedSpecies);
  };
  if (!parentSpecies && !parentType && headings.length === 0) return null;
  if (context.typeName) {
    if (parentSpecies || parentType)
      return Boolean(parentSpecies && parentType && speciesMatches(parentSpecies) && parentType === expectedType);
    return Boolean(
      headings.some(speciesMatches) &&
      headings.includes(expectedType),
    );
  }
  if (context.speciesName) {
    if (parentSpecies) return speciesMatches(parentSpecies);
    return headings.some(speciesMatches);
  }
  return true;
}

function v2ScopedEvidenceUnitRecords(units, context = {}) {
  const safeUnits = units.filter((unit) => !v2IndividualOnlyUnit(unit));
  if (context.typeName) {
    return safeUnits.filter((unit) => {
      const structured = structuredScopeMatches(unit, context);
      if (structured !== null) return structured;
      const text = evidenceUnitText(unit);
      return hasGenericDirectLabelEvidence(text, context.speciesName) &&
        (hasGenericDirectLabelEvidence(text, context.typeName) ||
          familiarTypeLabelMatch(text, context.speciesName, context.typeName)) &&
        hasGenericScopedTypeEvidence(text, context.speciesName, context.typeName, { allowFamiliar: true, strictInteraction: true });
    });
  }
  if (context.speciesName) return safeUnits.filter((unit) => {
    const structured = structuredScopeMatches(unit, context);
    return structured !== null ? structured : hasGenericDirectLabelEvidence(evidenceUnitText(unit), context.speciesName);
  });
  return safeUnits;
}

// Supplement JSON Facts are already field-classified by the protocol.  Keep
// this guard limited to structural/address/scope and permitted-evidence
// membership checks; Full analysis retains the semantic guard above.
function v2StructuredOperationEvidenceUnits(operation, units, existing) {
  const target = operation?.target ?? {}
  const speciesName = target.species_name
    ?? (operation.op === 'ADD_SPECIES' ? operation.species?.name : undefined)
  const typeName = target.type_name
    ?? (operation.op === 'ADD_TYPE' ? operation.type?.name : undefined)
  const species = speciesName && Array.isArray(existing?.species)
    ? existing.species.find(item => item?.name === speciesName)
    : null
  const siblingTypeNames = species?.biological_types?.map(item => item?.name).filter(Boolean) ?? []
  const individualOnlyPattern = /某(?:个|位|名)?(?:角色|人物|NPC)|这个角色|该角色|单个(?:角色|人物|个体)/iu
  const safeUnits = units.filter((unit) => !individualOnlyPattern.test(String(unit)))
  const exact = (typeName && speciesName
    ? v2ScopedEvidenceUnitRecords(safeUnits, {speciesName, typeName})
    : scopeCompatiblePatchUnits(safeUnits, {
      speciesName,
      typeName,
      siblingTypeNames,
    }))
  // A new Type identity needs explicit Species + Type evidence. A
  // Species-wide unit can support a nested Fact for an already addressed
  // Type, but cannot manufacture the Type address itself.
  if (operation?.op === 'ADD_TYPE' && speciesName && typeName)
    return exact.filter((unit) => hasGenericScopedTypeEvidence(unit, speciesName, typeName))
  if (typeName && speciesName) {
    const siblingNames = new Set(siblingTypeNames
      .map(name => compactEvidenceText(name))
      .filter(name => name && name !== compactEvidenceText(typeName)))
    const knownSpeciesNames = (existing?.species ?? [])
      .map(item => compactEvidenceText(item?.name))
      .filter(Boolean)
    const explicitTargetType = safeUnits.some(unit => {
      const parentType = compactEvidenceText(unit?.parent_context?.biological_type)
      return parentType === compactEvidenceText(typeName) || hasGenericDirectLabelEvidence(evidenceUnitText(unit), typeName)
    })
    const explicitSiblingType = [...siblingNames].some(name => safeUnits.some(unit => {
      const parentType = compactEvidenceText(unit?.parent_context?.biological_type)
      return parentType === name || hasGenericDirectLabelEvidence(evidenceUnitText(unit), name)
    }))
    if (explicitSiblingType && !explicitTargetType) return []
    const compatible = safeUnits.filter(unit => {
      const parent = unit?.parent_context
      const parentSpecies = compactEvidenceText(parent?.species)
      const parentType = compactEvidenceText(parent?.biological_type)
      const headings = Array.isArray(parent?.headings)
        ? parent.headings.map(value => compactEvidenceText(value)).filter(Boolean)
        : []
      const structuredSpecies = [parentSpecies, ...headings].filter(Boolean)
      const hasOtherStructuredSpecies = structuredSpecies.some(value =>
        knownSpeciesNames.some(name =>
          (value === name || isSpeciesNameOrGenericDerivative(value, name)) &&
          !(value === compactEvidenceText(speciesName) || isSpeciesNameOrGenericDerivative(value, speciesName)),
        ),
      )
      if (hasOtherStructuredSpecies) return false
      if (parentType && parentType !== compactEvidenceText(typeName)) return false
      if (headings.some(value => siblingNames.has(value))) return false

      const text = evidenceUnitText(unit)
      const textSpecies = knownSpeciesNames.filter(name => matchesSpeciesName(text, name))
      if (textSpecies.length && !textSpecies.includes(compactEvidenceText(speciesName))) return false
      if ([...siblingNames].some(name => hasGenericDirectLabelEvidence(text, name))) return false
      return true
    })
    // Existing canonical addresses have already passed Fact schema, identity,
    // and target validation. For Supplement, this stage only rejects explicit
    // contradictory Species/Type scope; it does not reclassify the Field or
    // compare the proposed value with natural-language evidence.
    return [...new Set([...exact, ...compatible])]
  }
  return exact
}

function v2ValidateStructuredOperationEvidence(operation, classification, units, existing) {
  if (classification === 'NO-OP') return
  if (classification === 'REJECT') v2EvidenceError(v2StructuredOperationEvidencePath(operation))
  if (operation?.op === 'DISABLE_PROJECTION_RULE') {
    if (!/(?:contradict|conflict|inapplicable|not applicable|unsupported|does not apply|矛盾|冲突|不适用|不支持|不成立|无法适用)/iu.test(operation.reason ?? ''))
      v2EvidenceError('operation.reason')
    const references = Array.isArray(operation.source_evidence) ? operation.source_evidence : []
    if (!references.length || !references.some(reference => units.some(unit => {
      const evidence = compactEvidenceText(evidenceUnitText(unit))
      const cited = compactEvidenceText(reference)
      return evidence.includes(cited) || cited.includes(evidence)
    })))
      v2EvidenceError('operation.source_evidence')
    return
  }
  // The JSON contract already carries the model's field classification. Host
  // validation must only establish permitted, correctly scoped evidence; it
  // must not compare the proposed value with text or run field-specific NLP.
  if (!v2StructuredOperationEvidenceUnits(operation, units, existing).length)
    v2EvidenceError(v2StructuredOperationEvidencePath(operation))
}

function v2StructuredOperationEvidencePath(operation) {
  if (operation?.op === 'ADD_TYPE') return 'operation.type.name'
  if (operation?.op === 'ADD_SPECIES') return 'operation.species.name'
  if (operation?.op === 'SET_FIELD') return 'operation.value'
  if (operation?.op === 'ADD_SPECIAL_RULE') return 'operation.value'
  if (operation?.op === 'ADD_EXCEPTION') return 'operation.exception.statement'
  if (operation?.op === 'SET_MECHANISM_HORIZON') return 'operation.tracking_window_horizon'
  if (operation?.op === 'ADD_UNKNOWN') return 'operation.unknown'
  return 'operation'
}

function v2CanonicalTargetPath(operation) {
  const target = operation?.target ?? {};
  if (operation?.op === 'ADD_SPECIES') return `species.${operation.species?.name ?? '<unknown>'}`;
  if (operation?.op === 'ADD_TYPE') return `species.${target.species_name ?? '<unknown>'}.biological_types.${operation.type?.name ?? '<unknown>'}`;
  if (operation?.op === 'ADD_EXCEPTION') return 'world.exceptions';
  if (operation?.op === 'ADD_UNKNOWN') return 'world.unknowns';
  if (operation?.op === 'ADD_PROJECTION_RULE') return 'world.projection_rules';
  if (operation?.op === 'DISABLE_PROJECTION_RULE') return `world.projection_rules.${operation.projection_rule_id ?? '<unknown>'}`;
  if (operation?.op === 'ADD_SPECIAL_RULE') return `species.${target.species_name ?? '<unknown>'}.biological_types.${target.type_name ?? '<unknown>'}.special_rules`;
  if (operation?.op === 'ADD_MECHANISM') return `species.${target.species_name ?? '<unknown>'}.biological_types.${target.type_name ?? '<unknown>'}.reproductive_mechanisms`;
  if (operation?.op === 'SET_MECHANISM_HORIZON') return `species.${target.species_name ?? '<unknown>'}.biological_types.${target.type_name ?? '<unknown>'}.reproductive_mechanisms.${operation.mechanism_key ?? '<unknown>'}.tracking_window_horizon`;
  if (target.kind === 'world') return `world.${(operation.path ?? []).join('.')}`;
  if (target.kind === 'species') return `species.${target.species_name ?? '<unknown>'}.${(operation.path ?? []).join('.')}`;
  if (target.kind === 'biological_type') return `species.${target.species_name ?? '<unknown>'}.biological_types.${target.type_name ?? '<unknown>'}.${(operation.path ?? []).join('.')}`;
  return 'unknown';
}

function annotateV2GuardFailure(error, result, operationIndex) {
  if (!error || typeof error !== 'object') return error;
  error.operation_index = operationIndex;
  error.operation_op = result?.operation?.op ?? null;
  error.operation_target = result?.operation?.target ?? null;
  error.rejected_operation = {
    operation_type: result?.operation?.op ?? null,
    semantic_path: v2CanonicalTargetPath(result?.operation),
    field: factDeltaFieldForOperation(result?.operation),
    species: result?.operation?.target?.species_name ?? result?.operation?.species?.name ?? null,
    biological_type: result?.operation?.target?.type_name ?? result?.operation?.type?.name ?? null,
    proposed_value: factDeltaDiagnosticValue(
      result?.operation?.op === 'ADD_TYPE'
        ? result?.operation?.type?.name
        : result?.operation?.op === 'ADD_SPECIES'
          ? result?.operation?.species?.name
          : result?.operation?.op === 'SET_FIELD'
            ? result?.operation?.value
            : result?.operation?.op === 'ADD_SPECIAL_RULE'
              ? result?.operation?.value
              : result?.operation?.op === 'ADD_UNKNOWN'
                ? result?.operation?.unknown
                : result?.operation?.op === 'ADD_MECHANISM'
                  ? result?.operation?.mechanism
                  : result?.operation?.op === 'ADD_EXCEPTION'
                    ? result?.operation?.exception
                    : result?.operation?.projection_rule,
    ),
    classification: result?.classification ?? null,
  };
  error.canonical_target_path = v2CanonicalTargetPath(result?.operation);
  error.rejected_semantic_field = error.guard_kind === 'structured_fact_boundary' ? null : error.path ?? null;
  error.rejected_structural_path = error.guard_kind === 'structured_fact_boundary' ? error.path ?? null : null;
  error.validation_stage = 'world_patch_v2_evidence_guard';
  return error;
}

function canonicalUnknownResolutionAddress(fact) {
  return {...factDeltaAddress(fact), field: fact?.field ?? null}
}

function applyWorldModelUnknownResolutions(model, declarations, factResults, baselineUnknowns = model.unknowns) {
  const existingUnknowns = Array.isArray(baselineUnknowns) ? baselineUnknowns : []
  const acceptedFacts = (Array.isArray(factResults) ? factResults : []).filter((result) => result?.status === 'accepted' && result.operation && result.fact?.field !== 'Unknown')
  const removals = new Set()
  const diagnostics = []
  for (const declaration of Array.isArray(declarations) ? declarations : []) {
    const index = existingUnknowns.findIndex((value) => worldModelUnknownId(value) === declaration.unknown_id)
    if (index < 0) {
      diagnostics.push({unknown_id: declaration.unknown_id, status: 'rejected', code: 'UNKNOWN_RESOLUTION_ID_NOT_FOUND'})
      continue
    }
    const addresses = Array.isArray(declaration.resolving_fact_addresses) ? declaration.resolving_fact_addresses : []
    const bound = acceptedFacts.some((result) => addresses.some((address) => JSON.stringify(address) === JSON.stringify(canonicalUnknownResolutionAddress(result.fact))))
    if (bound) {
      removals.add(index)
      diagnostics.push({unknown_id: declaration.unknown_id, status: 'removed', code: 'UNKNOWN_RESOLUTION_ACCEPTED'})
    } else {
      diagnostics.push({unknown_id: declaration.unknown_id, status: 'retained', code: 'UNKNOWN_RESOLUTION_FACT_NOT_ACCEPTED'})
    }
  }
  if (!removals.size) return {model, diagnostics}
  const removedIds = new Set(existingUnknowns.filter((_, index) => removals.has(index)).map(worldModelUnknownId))
  return {model: {...model, unknowns: model.unknowns.filter((value) => !removedIds.has(worldModelUnknownId(value)))}, diagnostics}
}

function v2MergeError(path, message = 'WORLD_MODEL_PATCH_V2_MERGE_INVALID') {
  throw invalidWorldModelPatchV2(message, { path });
}

function v2MutableTarget(model, target) {
  if (target.kind === 'world') return model;
  const species = v2Species(model, target.species_name);
  if (!species) v2MergeError('operation.target', 'WORLD_MODEL_PATCH_V2_TARGET_NOT_FOUND');
  if (target.kind === 'species') return species;
  const type = v2Type(model, target.species_name, target.type_name);
  if (!type) v2MergeError('operation.target', 'WORLD_MODEL_PATCH_V2_TARGET_NOT_FOUND');
  return type;
}

function v2ApplySetField(model, operation) {
  const [group, key] = operation.path;
  const entity = v2MutableTarget(model, operation.target);
  const value = v2NormalizeField(operation);
  if (operation.target.kind === 'world') {
    model.medical_context = { ...model.medical_context, [key]: value };
    return;
  }
  if (group === 'description') entity.description = value;
  else entity[group] = { ...(entity[group] ?? {}), [key]: value };
}

function v2ApplyAddSpecies(model, operation) {
  const species = v2NormalizeSpecies(operation.species);
  if (v2Species(model, species.name)) v2MergeError('operation.species.name', 'WORLD_MODEL_PATCH_V2_IDENTITY_CONFLICT');
  model.species.push(species);
}

function v2ApplyAddType(model, operation) {
  const speciesName = operation.target.species_name;
  const species = v2Species(model, speciesName);
  if (!species) v2MergeError('operation.target.species_name', 'WORLD_MODEL_PATCH_V2_TARGET_NOT_FOUND');
  const type = v2NormalizeType(operation.type, speciesName);
  if (species.biological_types.some((item) => item.name === type.name))
    v2MergeError('operation.type.name', 'WORLD_MODEL_PATCH_V2_IDENTITY_CONFLICT');
  species.biological_types.push(type);
}

function v2ApplyAddSpecialRule(model, operation) {
  const type = v2MutableTarget(model, operation.target);
  const rule = v2TextIdentity(operation.value);
  if (type.special_rules.some((item) => v2TextIdentity(item) === rule))
    v2MergeError('operation.value', 'WORLD_MODEL_PATCH_V2_IDENTITY_CONFLICT');
  type.special_rules.push(rule);
}

function v2ApplyAddMechanism(model, operation) {
  const type = v2MutableTarget(model, operation.target);
  const mechanism = normalizeReproductiveMechanism(operation.mechanism, 'operation.mechanism');
  const existing = type.reproductive_mechanisms.find((item) => item.key === mechanism.key);
  if (existing) v2MergeError('operation.mechanism.key', 'WORLD_MODEL_PATCH_V2_IDENTITY_CONFLICT');
  type.reproductive_mechanisms.push(mechanism);
}

function v2ApplySetMechanismHorizon(model, operation) {
  const type = v2MutableTarget(model, operation.target);
  const mechanism = type.reproductive_mechanisms.find(item => item.key === operation.mechanism_key);
  if (!mechanism) v2MergeError('operation.mechanism_key', 'WORLD_MODEL_PATCH_V2_TARGET_NOT_FOUND');
  mechanism.tracking_window_horizon = normalizeTrackingWindowHorizon(operation.tracking_window_horizon, 'operation.tracking_window_horizon');
}

function v2ExceptionIdentity(exception) {
  return `${v2TextIdentity(exception.statement)}|${v2TextIdentity(exception.applies_to)}`;
}

function v2ApplyAddException(model, operation) {
  const exception = v2NormalizeException(operation.exception);
  const identity = v2ExceptionIdentity(exception);
  const existing = model.exceptions.find((item) => v2ExceptionIdentity(item) === identity);
  if (existing) {
    // Evidence is provenance, not collection identity. An equivalent
    // canonical exception is therefore a no-op even when its new evidence
    // payload differs.
    return;
  }
  model.exceptions.push(exception);
}

function v2ApplyAddUnknown(model, operation) {
  const unknown = v2TextIdentity(operation.unknown);
  if (model.unknowns.some((item) => v2TextIdentity(item) === unknown)) return;
  model.unknowns.push(unknown);
}

function v2ApplyAddProjectionRule(model, operation) {
  const rule = normalizeProjectionRules([operation.projection_rule], { allowGeneratedIdentity: true })[0];
  const existing = model.projection_rules.find((item) => item.projection_rule_id === rule.projection_rule_id);
  if (existing) {
    if (v2Equal(existing, rule)) return;
    v2MergeError('operation.projection_rule', 'WORLD_MODEL_PATCH_V2_IDENTITY_CONFLICT');
  }
  model.projection_rules.push(rule);
}

function v2ApplyDisableProjectionRule(model, operation) {
  const index = model.projection_rules.findIndex(item => item.projection_rule_id === operation.projection_rule_id)
  if (index < 0) v2MergeError('operation.projection_rule_id', 'WORLD_MODEL_PATCH_V2_TARGET_NOT_FOUND')
  model.projection_rules.splice(index, 1)
}

function v2ApplyClassifiedOperations(model, classified) {
  for (const result of classified) {
    if (result.classification === 'NO-OP') continue;
    if (result.classification !== 'ADD' && result.classification !== 'CHANGE' && result.classification !== 'DISABLE')
      v2MergeError('operations', 'WORLD_MODEL_PATCH_V2_CLASSIFICATION_INVALID');
    const operation = result.operation;
    if (operation.op === 'ADD_SPECIES') v2ApplyAddSpecies(model, operation);
    else if (operation.op === 'ADD_TYPE') v2ApplyAddType(model, operation);
    else if (operation.op === 'SET_FIELD') v2ApplySetField(model, operation);
    else if (operation.op === 'ADD_SPECIAL_RULE') v2ApplyAddSpecialRule(model, operation);
    else if (operation.op === 'ADD_MECHANISM') v2ApplyAddMechanism(model, operation);
    else if (operation.op === 'SET_MECHANISM_HORIZON') v2ApplySetMechanismHorizon(model, operation);
    else if (operation.op === 'ADD_EXCEPTION') v2ApplyAddException(model, operation);
    else if (operation.op === 'ADD_UNKNOWN') v2ApplyAddUnknown(model, operation);
    else if (operation.op === 'ADD_PROJECTION_RULE') v2ApplyAddProjectionRule(model, operation);
    else if (operation.op === 'DISABLE_PROJECTION_RULE') v2ApplyDisableProjectionRule(model, operation);
    else v2MergeError('operations', 'WORLD_MODEL_PATCH_V2_OPERATION_UNSUPPORTED');
  }
}

function v2SortAppendedEntries(model, existing) {
  const sortBy = (values, start, identity) => values.splice(start, values.length - start, ...values.slice(start).sort((left, right) => identity(left).localeCompare(identity(right))));
  sortBy(model.species, existing.species.length, (item) => item.name);
  for (const oldSpecies of existing.species) {
    const species = v2Species(model, oldSpecies.name);
    if (!species) continue;
    sortBy(species.biological_types, oldSpecies.biological_types.length, (item) => item.name);
    for (const oldType of oldSpecies.biological_types) {
      const type = v2Type(model, oldSpecies.name, oldType.name);
      if (!type) continue;
      sortBy(type.special_rules, oldType.special_rules.length, v2TextIdentity);
      sortBy(type.reproductive_mechanisms, oldType.reproductive_mechanisms.length, (item) => item.key ?? '');
    }
  }
  sortBy(model.exceptions, existing.exceptions.length, v2ExceptionIdentity);
  sortBy(model.unknowns, existing.unknowns.length, v2TextIdentity);
  sortBy(model.projection_rules, existing.projection_rules.length, (item) => item.projection_rule_id);
}

function v2RestoreExistingProjectionOrder(model, existing) {
  const existingIds = new Set(existing.projection_rules.map((item) => item.projection_rule_id));
  const byId = new Map(model.projection_rules.map((item) => [item.projection_rule_id, item]));
  const preserved = existing.projection_rules.map((item) => byId.get(item.projection_rule_id)).filter(Boolean);
  const appended = model.projection_rules
    .filter((item) => !existingIds.has(item.projection_rule_id))
    .sort((left, right) => left.projection_rule_id.localeCompare(right.projection_rule_id));
  return { ...model, projection_rules: [...preserved, ...appended] };
}

function mergeWorldModelPatchV2Classified(existingModel, classified, {preserveCollectionOrder = false} = {}) {
  const base = normalizeWorldModel(existingModel, { strict: true, allowGeneratedProjectionRuleIds: true });
  const working = clonePatchValue(base);
  v2ApplyClassifiedOperations(working, classified);
  if (!preserveCollectionOrder) v2SortAppendedEntries(working, base);
  const consistent = applyWorldModelFinalConsistencyGuard(working);
  const normalized = normalizeWorldModel(consistent, { strict: true, allowGeneratedProjectionRuleIds: true });
  return v2RestoreExistingProjectionOrder(normalized, base);
}

function factDeltaOperationTargetExists(model, operation) {
  if (!operation?.target || operation.target.kind === 'world') return true
  if (operation.target.kind === 'species') return Boolean(v2Species(model, operation.target.species_name))
  return Boolean(v2Type(model, operation.target.species_name, operation.target.type_name))
}

export function applyWorldModelFactDeltaEvidenceGuard(resolution, analysisInput) {
  let working = resolution.existing
  const acceptedOperations = []
  const acceptedResults = []
  const rejectedFacts = [...resolution.rejectedFacts]
  const archivedSpeciesMeta = Array.isArray(analysisInput?.archived_species_exclusions)
    ? {
        archived_species: analysisInput.archived_species_exclusions.map(item => ({
          species: {name: item?.name},
        })),
      }
    : analysisInput?.world_model_meta
  for (const result of resolution.factResults) {
    if (!result.operation || result.status !== 'resolved') {
      if (result.status === 'no-op' || result.status === 'deduplicated') acceptedResults.push(result)
      continue
    }
    const archivedDiagnostic = rejectArchivedSpeciesOperation(result.operation, archivedSpeciesMeta)
    if (archivedDiagnostic) {
      const error = Object.assign(new Error(archivedDiagnostic.code), archivedDiagnostic)
      annotateV2GuardFailure(error, result, result.fact_index ?? result.index ?? 0)
      result.status = 'rejected'
      result.code = archivedDiagnostic.code
      result.reason = archivedDiagnostic.code
      result.guardError = error
      rejectedFacts.push(result)
      continue
    }
    if (!factDeltaOperationTargetExists(working, result.operation)) {
      result.status = 'rejected'
      result.code = result.operation.op === 'ADD_TYPE'
        ? 'WORLD_MODEL_FACT_DELTA_SPECIES_IDENTITY_REQUIRED'
        : 'WORLD_MODEL_FACT_DELTA_TYPE_IDENTITY_REQUIRED'
      result.reason = 'identity dependency was not accepted'
      rejectedFacts.push(result)
      continue
    }
    try {
      const existing = normalizeWorldModel(working, { strict: true, allowGeneratedProjectionRuleIds: true })
      const classified = classifyWorldModelPatchV2({schema_version: 2, operations: [result.operation]}, existing)
      const units = factDeltaEvidenceGuardUnits(analysisInput)
      v2ValidateStructuredOperationEvidence(result.operation, classified[0].classification, units, existing)
      const classifiedResult = classified[0]
      if (classifiedResult.classification !== 'NO-OP') {
        working = mergeWorldModelPatchV2Classified(working, classified, {preserveCollectionOrder: true})
        acceptedOperations.push(result.operation)
      }
      result.status = classifiedResult.classification === 'NO-OP' ? 'no-op' : 'accepted'
      result.classification = classifiedResult.classification
      acceptedResults.push(result)
    } catch (error) {
      error.validation_stage ??= 'world_patch_v2_evidence_guard'
      error.guard_kind ??= 'structured_fact_boundary'
      annotateV2GuardFailure(error, result, result.fact_index ?? result.index ?? 0)
      result.status = 'rejected'
      result.code = error?.code ?? error?.message ?? 'WORLD_MODEL_PATCH_V2_INVALID'
      result.reason = error?.message ?? result.code
      result.guardError = error
      rejectedFacts.push(result)
    }
  }
  const unknownResolution = applyWorldModelUnknownResolutions(
    working,
    resolution.resolved_unknown_ids,
    acceptedResults,
    resolution.existing?.unknowns,
  )
  working = unknownResolution.model
  return {
    patch: {schema_version: 2, operations: acceptedOperations},
    factResults: [...acceptedResults, ...rejectedFacts],
    rejectedFacts,
    unknownResolution: unknownResolution.diagnostics,
    classified: classifyWorldModelPatchV2({schema_version: 2, operations: acceptedOperations}, resolution.existing),
    model: working,
  }
}

export function mergeWorldModelSupplementPatch(existingModel, patch, analysisInput = {}) {
  const base = normalizeWorldModel(existingModel, { strict: true, allowGeneratedProjectionRuleIds: true });
  const classified = classifyWorldModelPatchV2(patch, base);
  const units = factDeltaEvidenceGuardUnits(analysisInput);
  for (const result of classified)
    v2ValidateStructuredOperationEvidence(result.operation, result.classification, units, base);
  return mergeWorldModelPatchV2Classified(base, classified, {preserveCollectionOrder: true});
}

function clonePatchValue(value) {
  if (value === undefined || value === null) return value
  if (typeof structuredClone === 'function') return structuredClone(value)
  if (Array.isArray(value)) return value.map(clonePatchValue)
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clonePatchValue(item)]))
  return value
}

// 只保存来源数量、范围和状态，不保存 AnalysisInput 正文。
export function summarizeAnalysisInput(input = {}) {
  const character = input?.character ?? {};
  const greetings = Array.isArray(character.greetings)
    ? character.greetings
    : [];
  const worldbooks = Array.isArray(input?.worldbooks) ? input.worldbooks : [];
  const recentStory = input?.recent_story ?? {};
  const externalMemory = Array.isArray(input?.external_memory)
    ? input.external_memory
    : [];
  return {
    character_fields: (character.description ? 1 : 0) + greetings.length,
    worldbooks: worldbooks.length,
    worldbook_entries: worldbooks.reduce(
      (total, book) =>
        total + (Array.isArray(book?.entries) ? book.entries.length : 0),
      0,
    ),
    recent_story: {
      enabled: recentStory.enabled === true,
      floor_count: Number(recentStory.floor_count) || 0,
      floor_start: recentStory.floor_start ?? null,
      floor_end: recentStory.floor_end ?? null,
      floors_read: Array.isArray(recentStory.items)
        ? recentStory.items.length
        : 0,
    },
    external_memory: externalMemory.map((provider) => ({
      key: String(provider?.key ?? ''),
      label: String(provider?.label ?? provider?.key ?? ''),
      enabled: provider?.enabled === true,
      read_status: String(provider?.read_status ?? 'unknown'),
      status: String(provider?.status ?? ''),
    })),
    token_estimate: Number(input?.token_estimate) || 0,
  };
}

function candidateTarget(kind, speciesName, typeName = undefined) {
  if (kind === 'world') return {kind: 'world'}
  if (kind === 'species') return {kind: 'species', species_name: speciesName}
  return {kind: 'biological_type', species_name: speciesName, type_name: typeName}
}


function factDeltaError(message, details = {}, code = 'WORLD_MODEL_FACT_DELTA_INVALID') {
  const error = new Error(message)
  error.code = code
  Object.assign(error, details)
  return error
}

const FACT_DELTA_SCALAR_PATHS = Object.freeze(
  Object.fromEntries(
    Object.values(SUPPLEMENT_CANONICAL_WRITABILITY_REGISTRY)
      .filter(descriptor => descriptor.container === 'scalar')
      .map(descriptor => [
        descriptor.field,
        [
          descriptor.owner === 'world'
            ? 'world'
            : descriptor.owner === 'species'
              ? 'species'
              : 'biological_type',
          ...descriptor.path,
        ],
      ]),
  ),
)

function factDeltaPathKey(fact) {
  const path = FACT_DELTA_SCALAR_PATHS[fact.field]
  if (!path) return null
  if (path[0] === 'species') return `species:${fact.species}:${path.join('.')}`
  if (path[0] === 'world') return `world:${path.join('.')}`
  return `type:${fact.species}:${fact.biological_type}:${path.slice(1).join('.')}`
}

function factDeltaCanonicalMechanism(mechanism) {
  return normalizeReproductiveMechanism(mechanism, 'fact.mechanism')
}

function factDeltaCanonicalProjection(rule) {
  return normalizeProjectionRules([rule], {allowGeneratedIdentity: true})[0]
}

function factDeltaAddUnique(map, key, value, {equal = v2Equal} = {}) {
  const previous = map.get(key)
  if (previous === undefined) {
    map.set(key, value)
    return
  }
  if (!equal(previous, value)) throw factDeltaError('WORLD_MODEL_FACT_DELTA_CONFLICT', {path: key}, 'WORLD_MODEL_FACT_DELTA_CONFLICT')
}

// Compatibility-only candidate assembly. Supplement production uses the
// per-Fact resolver below so sibling claims never share an ADD_TYPE object.
function factDeltaBuildCandidate(facts, existingModel) {
  const existing = normalizeWorldModel(existingModel, {strict: true, allowGeneratedProjectionRuleIds: true})
  const speciesByName = new Map()
  const scalarFacts = new Map()
  const specialRules = new Map()
  const mechanisms = new Map()
  const exceptions = new Map()
  const unknowns = new Map()
  const projections = new Map()
  const speciesIdentities = new Set()
  const typeIdentities = new Set()

  const normalizedFacts = [...validateWorldModelFactDelta(facts)].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  for (const fact of normalizedFacts) {
    const species = String(fact.species).trim()
    const type = fact.biological_type ? String(fact.biological_type).trim() : null
    if (fact.field === 'Species_Identity') {
      if (type) throw factDeltaError('WORLD_MODEL_FACT_DELTA_IDENTITY_SCOPE_INVALID', {species}, 'WORLD_MODEL_FACT_DELTA_IDENTITY_SCOPE_INVALID')
      speciesIdentities.add(species)
      continue
    }
    if (fact.field === 'Type_Identity') {
      typeIdentities.add(`${species}\u0000${type}`)
      continue
    }
    const scope = FACT_DELTA_SCALAR_PATHS[fact.field]?.[0] === 'world' ? 'world' : fact.field === 'Exception' || fact.field === 'Unknown' || fact.field === 'Projection_Rule' ? 'world' : 'entity'
    if (scope === 'entity') {
      const speciesEntry = speciesByName.get(species) ?? {name: species, biological_types: []}
      speciesByName.set(species, speciesEntry)
    }
    if (FACT_DELTA_SCALAR_PATHS[fact.field]) {
      factDeltaAddUnique(scalarFacts, factDeltaPathKey({...fact, species, biological_type: type}), fact.value)
      continue
    }
    if (fact.field === 'Special_Rule') {
      if (!type) throw factDeltaError('WORLD_MODEL_FACT_DELTA_TYPE_REQUIRED', {field: fact.field})
      const key = `special:${species}\u0000${type}\u0000${String(fact.value).trim()}`
      factDeltaAddUnique(specialRules, key, {species, type, value: String(fact.value).trim()}, {equal: (left, right) => left.value === right.value})
      continue
    }
    if (fact.field === 'Reproductive_Mechanism') {
      if (!type) throw factDeltaError('WORLD_MODEL_FACT_DELTA_TYPE_REQUIRED', {field: fact.field})
      const mechanism = factDeltaCanonicalMechanism(fact.mechanism)
      const key = `mechanism:${species}\u0000${type}\u0000${mechanism.key}`
      factDeltaAddUnique(mechanisms, key, {species, type, mechanism})
      continue
    }
    if (fact.field === 'Exception') {
      const exception = {...fact.exception, applies_to: fact.exception.applies_to ?? null, evidence: fact.exception.evidence ?? null}
      const key = `exception:${String(exception.statement).trim()}\u0000${String(exception.applies_to ?? '').trim()}`
      factDeltaAddUnique(exceptions, key, exception)
      continue
    }
    if (fact.field === 'Unknown') {
      const value = String(fact.value).trim()
      factDeltaAddUnique(unknowns, `unknown:${value}`, value, {equal: (left, right) => left === right})
      continue
    }
    if (fact.field === 'Projection_Rule') {
      const rule = factDeltaCanonicalProjection(fact.projection_rule)
      const key = `projection:${rule.projection_rule_id}`
      factDeltaAddUnique(projections, key, rule)
      continue
    }
    throw factDeltaError('WORLD_MODEL_FACT_DELTA_FIELD_UNSUPPORTED', {field: fact.field})
  }

  const candidate = {schema_version: 1, species: [], medical_context: {}, exceptions: [...exceptions.values()], unknowns: [...unknowns.values()], projection_rules: []}
  const getSpecies = name => {
    let value = speciesByName.get(name)
    if (!value) { value = {name, biological_types: []}; speciesByName.set(name, value) }
    return value
  }
  const getType = (species, name) => {
    let value = species.biological_types.find(item => item.name === name)
    if (!value) { value = {name}; species.biological_types.push(value) }
    return value
  }
  for (const fact of normalizedFacts) {
    if (fact.field === 'Species_Description') getSpecies(fact.species).description = fact.value
    else if (fact.field === 'Type_Description') getType(getSpecies(fact.species), fact.biological_type).description = fact.value
    else if (FACT_DELTA_SCALAR_PATHS[fact.field]) {
      if (fact.field === 'Childbirth_Difficulty') candidate.medical_context.childbirth_difficulty = fact.value
      else if (fact.field === 'Care_Level') candidate.medical_context.care_level = fact.value
      else if (fact.field === 'Medical_Evidence') candidate.medical_context.evidence = fact.value
      else {
        const type = getType(getSpecies(fact.species), fact.biological_type)
        const [group, key] = FACT_DELTA_SCALAR_PATHS[fact.field].slice(1)
        type[group] ??= {}
        type[group][key] = fact.value
      }
    } else if (fact.field === 'Special_Rule') getType(getSpecies(fact.species), fact.biological_type).special_rules = [...(getType(getSpecies(fact.species), fact.biological_type).special_rules ?? []), fact.value]
    else if (fact.field === 'Reproductive_Mechanism') getType(getSpecies(fact.species), fact.biological_type).reproductive_mechanisms = [...(getType(getSpecies(fact.species), fact.biological_type).reproductive_mechanisms ?? []), factDeltaCanonicalMechanism(fact.mechanism)]
    else if (fact.field === 'Projection_Rule') candidate.projection_rules.push(fact.projection_rule)
  }
  for (const speciesName of speciesIdentities) getSpecies(speciesName)
  for (const key of typeIdentities) { const [speciesName, typeName] = key.split('\u0000'); getType(getSpecies(speciesName), typeName) }
  for (const species of speciesByName.values()) {
    if (!speciesIdentities.has(species.name) && !existing.species.some(item => item.name === species.name)) throw factDeltaError('WORLD_MODEL_FACT_DELTA_SPECIES_IDENTITY_REQUIRED', {species: species.name}, 'WORLD_MODEL_FACT_DELTA_SPECIES_IDENTITY_REQUIRED')
    for (const type of species.biological_types) {
      const typeKey = `${species.name}\u0000${type.name}`
      if (!typeIdentities.has(typeKey) && !existing.species.find(item => item.name === species.name)?.biological_types.some(item => item.name === type.name)) throw factDeltaError('WORLD_MODEL_FACT_DELTA_TYPE_IDENTITY_REQUIRED', {species: species.name, type: type.name}, 'WORLD_MODEL_FACT_DELTA_TYPE_IDENTITY_REQUIRED')
    }
    candidate.species.push(species)
  }
  return {candidate, existing, mechanisms, projections}
}

export function worldModelFactDeltaToPatchV2(facts, existingModel) {
  return resolveWorldModelFactDelta(facts, existingModel).patch
}

function factDeltaFactKey(fact) {
  if (fact.field === 'Species_Identity') return `species:${fact.species}`
  if (fact.field === 'Type_Identity') return `type:${fact.species}:${fact.biological_type}`
  if (FACT_DELTA_SCALAR_PATHS[fact.field]) return factDeltaPathKey(fact)
  if (fact.field === 'Special_Rule') return `special:${fact.species}:${fact.biological_type}:${v2TextIdentity(fact.value)}`
  if (fact.field === 'Reproductive_Mechanism') return `mechanism:${fact.species}:${fact.biological_type}:${fact.mechanism?.key}`
  if (fact.field === 'Exception') return `exception:${v2TextIdentity(fact.exception?.statement)}:${v2TextIdentity(fact.exception?.applies_to)}`
  if (fact.field === 'Unknown') return `unknown:${v2TextIdentity(fact.value)}`
  if (fact.field === 'Projection_Rule') return `projection:${fact.projection_rule?.projection_rule_id ?? JSON.stringify(v2Canonical(fact.projection_rule))}`
  if (fact.field === 'Projection_Rule_Override') {
    const rule = factDeltaCanonicalProjection(fact.projection_rule)
    return `projection-disable:${rule.projection_rule_id}`
  }
  return `fact:${JSON.stringify(v2Canonical(fact))}`
}

function factDeltaFactContent(fact) {
  if (fact.field === 'Species_Identity' || fact.field === 'Type_Identity') return fact.field === 'Species_Identity' ? fact.species : fact.biological_type
  if (fact.field === 'Reproductive_Mechanism') return fact.mechanism
  if (fact.field === 'Exception') return fact.exception
  if (fact.field === 'Projection_Rule') return fact.projection_rule
  if (fact.field === 'Projection_Rule_Override') return {action: fact.action, projection_rule: fact.projection_rule, reason: fact.reason, evidence: fact.evidence}
  return fact.value
}

function factDeltaOperationForFact(fact, existing) {
  const comparison = factDeltaExistingComparison(fact, existing)
  if (comparison === 'same') return null
  if (fact.field === 'Species_Identity') return {op: 'ADD_SPECIES', species: {name: fact.species}}
  if (fact.field === 'Type_Identity') return {
    op: 'ADD_TYPE',
    target: candidateTarget('species', fact.species),
    type: {name: fact.biological_type},
  }
  if (FACT_DELTA_SCALAR_PATHS[fact.field]) {
    const path = FACT_DELTA_SCALAR_PATHS[fact.field]
    const target = path[0] === 'world'
      ? candidateTarget('world')
      : path[0] === 'species'
        ? candidateTarget('species', fact.species)
        : candidateTarget('biological_type', fact.species, fact.biological_type)
    return {op: 'SET_FIELD', target, path: path[0] === 'world' ? path.slice(1) : path.slice(1), value: fact.value}
  }
  if (fact.field === 'Special_Rule') return {
    op: 'ADD_SPECIAL_RULE',
    target: candidateTarget('biological_type', fact.species, fact.biological_type),
    value: fact.value,
  }
  if (fact.field === 'Reproductive_Mechanism') return {
    op: 'ADD_MECHANISM',
    target: candidateTarget('biological_type', fact.species, fact.biological_type),
    mechanism: factDeltaCanonicalMechanism(fact.mechanism),
  }
  if (fact.field === 'Exception') return {op: 'ADD_EXCEPTION', exception: fact.exception}
  if (fact.field === 'Unknown') return {op: 'ADD_UNKNOWN', unknown: fact.value}
  if (fact.field === 'Projection_Rule') {
    const {projection_rule_id, ...projection_rule} = factDeltaCanonicalProjection(fact.projection_rule)
    return {op: 'ADD_PROJECTION_RULE', projection_rule}
  }
  if (fact.field === 'Projection_Rule_Override') {
    const rule = factDeltaCanonicalProjection(fact.projection_rule)
    return {
      op: 'DISABLE_PROJECTION_RULE',
      projection_rule_id: rule.projection_rule_id,
      reason: fact.reason,
      source_evidence: [...fact.evidence],
    }
  }
  throw factDeltaError('WORLD_MODEL_FACT_DELTA_FIELD_UNSUPPORTED', {field: fact.field})
}

function factDeltaDependency(fact, existing, responseSpecies, responseTypes) {
  if (fact.field === 'Species_Identity' || fact.field === 'Type_Identity' || factDeltaAddress(fact).scope === 'world') return null
  const species = existing.species.find(item => item.name === fact.species)
  if (!species && !responseSpecies.has(fact.species)) return {
    code: 'WORLD_MODEL_FACT_DELTA_SPECIES_IDENTITY_REQUIRED',
    species: fact.species,
  }
  if (factDeltaAddress(fact).scope !== 'biological_type') return null
  const typeExists = species?.biological_types?.some(item => item.name === fact.biological_type)
  if (!typeExists && !responseTypes.has(`${fact.species}\u0000${fact.biological_type}`)) return {
    code: 'WORLD_MODEL_FACT_DELTA_TYPE_IDENTITY_REQUIRED',
    species: fact.species,
    type: fact.biological_type,
  }
  return null
}

function factDeltaFactPriority(fact) {
  if (fact.field === 'Species_Identity') return 0
  if (fact.field === 'Type_Identity') return 1
  return 2
}

function factDeltaIsAppendOnlyCollection(fact) {
  return fact?.field === 'Special_Rule' || fact?.field === 'Exception' || fact?.field === 'Unknown' || fact?.field === 'Projection_Rule_Override'
}

export function resolveWorldModelFactDelta(facts, existingModel, archiveMeta = null) {
  const existing = normalizeWorldModel(existingModel, {strict: true, allowGeneratedProjectionRuleIds: true})
  const inputFacts = Array.isArray(facts) ? facts : []
  const responseSpecies = new Set(inputFacts.filter(fact => fact?.field === 'Species_Identity').map(fact => fact.species))
  const responseTypes = new Set(inputFacts.filter(fact => fact?.field === 'Type_Identity').map(fact => `${fact.species}\u0000${fact.biological_type}`))
  const seen = new Map()
  const factResults = []
  const ordered = inputFacts
    .map((fact, index) => ({fact, index, fact_index: fact?.fact_index ?? index}))
    // Identity dependencies are resolved first. Collection Facts retain their
    // response order; other equal-priority Facts keep the historical
    // deterministic order used by scalar conflict resolution.
    .sort((left, right) => {
      const priority = factDeltaFactPriority(left.fact) - factDeltaFactPriority(right.fact)
      if (priority) return priority
      if (factDeltaIsAppendOnlyCollection(left.fact) && factDeltaIsAppendOnlyCollection(right.fact)) return left.index - right.index
      return JSON.stringify(v2Canonical(left.fact)).localeCompare(JSON.stringify(v2Canonical(right.fact)))
    })
  for (const {fact, index, fact_index} of ordered) {
    const result = {fact, index, fact_index, field: fact?.field ?? null, species: fact?.species ?? null, biological_type: fact?.biological_type ?? null, operation: null, status: 'rejected'}
    try {
      validateWorldModelFactDelta([fact])
      const archivedDiagnostic = rejectArchivedSpeciesFact(fact, archiveMeta)
      if (archivedDiagnostic) {
        Object.assign(result, archivedDiagnostic, {reason: archivedDiagnostic.code})
        factResults.push(result)
        continue
      }
      const key = factDeltaFactKey(fact)
      const previous = seen.get(key)
      if (previous) {
        if (v2Equal(factDeltaFactContent(previous.fact), factDeltaFactContent(fact))) {
          result.status = 'deduplicated'
          result.code = 'FACT_DELTA_DUPLICATE_DEDUPED'
        } else {
          result.code = 'WORLD_MODEL_FACT_DELTA_CONFLICT'
          result.reason = 'same canonical Fact address has different content'
        }
        factResults.push(result)
        continue
      }
      const dependency = factDeltaDependency(fact, existing, responseSpecies, responseTypes)
      if (dependency) {
        Object.assign(result, dependency)
        result.reason = 'identity dependency is unresolved'
        factResults.push(result)
        continue
      }
      if (fact.field === 'Reproductive_Mechanism') {
        const current = existing.species.find(item => item.name === fact.species)?.biological_types?.find(item => item.name === fact.biological_type)?.reproductive_mechanisms?.find(item => item.key === fact.mechanism?.key)
        const candidate = factDeltaCanonicalMechanism(fact.mechanism)
        if (current && !v2Equal(current, candidate)) {
          result.code = 'FACT_DELTA_EXISTING_MECHANISM_UPDATE_UNSUPPORTED'
          result.reason = 'existing reproductive mechanism correction has no Patch v2 outlet'
          factResults.push(result)
          continue
        }
      }
      if (fact.field === 'Projection_Rule') {
        const candidate = factDeltaCanonicalProjection(fact.projection_rule)
        const current = existing.projection_rules.find(item => item.projection_rule_id === candidate.projection_rule_id)
        if (current && !v2Equal(current, candidate)) {
          result.code = 'FACT_DELTA_EXISTING_PROJECTION_UPDATE_UNSUPPORTED'
          result.reason = 'existing projection rule correction has no Patch v2 outlet'
          factResults.push(result)
          continue
        }
      }
      if (fact.field === 'Projection_Rule_Override') {
        const candidate = factDeltaCanonicalProjection(fact.projection_rule)
        const current = existing.projection_rules.find(item => item.projection_rule_id === candidate.projection_rule_id)
        if (!current) {
          result.code = 'WORLD_MODEL_FACT_DELTA_PROJECTION_RULE_TARGET_NOT_FOUND'
          result.reason = 'projection rule disable target is not present in Existing'
          factResults.push(result)
          continue
        }
      }
      const operation = factDeltaOperationForFact(fact, existing)
      seen.set(key, {fact, operation})
      result.operation = operation
      result.status = operation ? 'resolved' : 'no-op'
      factResults.push(result)
    } catch (error) {
      result.code = error?.code ?? 'WORLD_MODEL_FACT_DELTA_INVALID'
      result.reason = error?.message ?? result.code
      factResults.push(result)
    }
  }
  return {
    patch: {schema_version: 2, operations: factResults.filter(result => result.operation).map(result => result.operation)},
    factResults,
    rejectedFacts: factResults.filter(result => result.status === 'rejected'),
    existing,
  }
}

export function worldModelIdentityIndex(model) {
  const index = new Map()
  for (const species of Array.isArray(model?.species) ? model.species : []) {
    if (!species || typeof species.name !== 'string' || !species.name.trim()) continue
    if (index.has(species.name)) {
      const error = new Error('WORLD_MODEL_IDENTITY_DUPLICATE')
      error.code = 'WORLD_MODEL_IDENTITY_DUPLICATE'
      error.path = `species.${species.name}`
      throw error
    }
    const typeNames = new Set()
    for (const type of Array.isArray(species.biological_types) ? species.biological_types : []) {
      if (!type || typeof type.name !== 'string' || !type.name.trim()) continue
      if (typeNames.has(type.name)) {
        const error = new Error('WORLD_MODEL_IDENTITY_DUPLICATE')
        error.code = 'WORLD_MODEL_IDENTITY_DUPLICATE'
        error.path = `species.${species.name}.biological_types.${type.name}`
        throw error
      }
      typeNames.add(type.name)
    }
    index.set(species.name, new Set(
      (Array.isArray(species.biological_types) ? species.biological_types : [])
        .filter(type => type && typeof type.name === 'string' && type.name.trim())
        .map(type => type.name),
    ))
  }
  return index
}

export function createAnalyzer({
  profileResolver,
  contextResolver,
  requestSettingsResolver,
  analysisPromptResolver,
  worldModelPromptResolver,
  onWorldModelTrace,
  onEventAnalysisTrace,
} = {}) {
  function emitWorldModelTrace(raw, normalizedModel, canonicalModel) {
    if (typeof onWorldModelTrace !== 'function') return;
    try {
      onWorldModelTrace({
        raw_output: responseText(raw),
        normalized_model: normalizedModel,
        canonical_model: canonicalModel,
      });
    } catch {
      // 调试回调不能改变分析结果或让 canonical 保存失败。
    }
  }

  function requestOptions(input = {}) {
    return {
      signal: input.signal,
      context: contextResolver?.(),
      requestSettings: requestSettingsResolver?.(),
      // JSON mode is opt-in from an explicit host capability, never inferred
      // from provider/model names. Prompt-only JSON remains the fallback.
      responseFormatCapability: input.response_format_capability === true,
    };
  }

  function emitEventAnalysisTrace(input, payload) {
    if (typeof input?.onEventAnalysisTrace !== 'function') return;
    try {
      input.onEventAnalysisTrace(payload);
    } catch {
      // Diagnostics must never change the parser or analysis result.
    }
  }

  async function run(task, input = {}) {
    const profile = profileResolver?.(task);
    if (!profile) throw new Error('API_PROFILE_NOT_CONFIGURED');
    const content = buildPrompt({ task, ...input });
    return callOpenAICompatible(
      profile,
      [{ role: 'system', content }],
      requestOptions(input),
    );
  }

  async function analyzeWorldModel(input = {}) {
    const profile =
      profileResolver?.('world_analysis') ?? profileResolver?.('world');
    if (!profile) throw new Error('API_PROFILE_NOT_CONFIGURED');
    const messages = buildWorldModelMessages(
      input.analysisInput ?? input,
      worldModelPromptResolver?.() ?? analysisPromptResolver?.() ?? {},
    );
    const raw = await callOpenAICompatible(
      profile,
      messages,
      requestOptions(input),
    );
    const responseTextLength = traceAnalyzerReceived(raw);
    traceApi('parser-start', { parser: 'world-model', responseTextLength });
    let model;
    try {
      model = parseWorldModelResponse(raw);
      traceApi('parser-success', {
        parser: 'world-model',
        responseTextLength,
        speciesCount: model.species.length,
      });
    } catch (error) {
      traceApi('parser-error', {
        parser: 'world-model',
        responseTextLength,
        ...traceParserError(error),
      });
      throw error;
    }
    const evidenceGuardedModel = applyWorldModelEvidenceGuard(
      model,
      input.analysisInput ?? input,
    );
    const canonicalModel =
      applyWorldModelFinalConsistencyGuard(evidenceGuardedModel);
    emitWorldModelTrace(raw, model, canonicalModel);
    return canonicalModel;
  }

  // Supplement AI returns JSON Fact Delta. Patch v2 remains an internal
  // deterministic mutation IR for the existing guard/merge boundary.
  async function analyzeWorldModelPatchV2(input = {}) {
    const profile = profileResolver?.('world_analysis') ?? profileResolver?.('world')
    if (!profile) throw new Error('API_PROFILE_NOT_CONFIGURED')
    const analysisInput = input.analysisInput ?? input
    const existingModel = input.world_model ?? analysisInput.world_model
    if (!existingModel) {
      const error = new Error('WORLD_MODEL_PATCH_V2_TARGET_REQUIRED')
      error.code = 'WORLD_MODEL_PATCH_V2_TARGET_REQUIRED'
      throw error
    }
    const promptSettings = worldModelPromptResolver?.() ?? analysisPromptResolver?.() ?? {}
    const candidateModel = input.supplement_candidate ?? analysisInput.supplement_candidate ?? existingModel
    const coverageTargets = buildWorldModelSupplementCoverageTargets(candidateModel)
    const identitySubjects = buildWorldModelSupplementIdentityReviewSubjects(candidateModel, input.supplement_identity_subjects ?? analysisInput.supplement_identity_subjects)
    const retryDirective = input.supplement_retry_directive
      ?? analysisInput.supplement_retry_directive
    const messages = buildWorldModelPatchMessagesV2({
      ...analysisInput,
      world_model: existingModel,
      supplement_candidate: candidateModel,
      supplement_retry_directive: retryDirective,
    }, promptSettings)
    const requestMode = retryDirective?.kind === 'format_retry' ? 'FORMAT_RETRY' : 'INITIAL'
    const requestParity = await supplementRequestParity({
      analysisInput,
      existingModel,
      candidateModel,
      retryDirective,
      requestMode,
      promptSettings,
      messages,
    })
    const requestEnvelope = {
      request_mode: requestMode,
      request_total_char_count: messages.reduce((total, message) => total + String(message?.content ?? '').length, 0),
      permitted_evidence_char_count: requestParity.permitted_evidence_char_count,
      existing_reference_char_count: JSON.stringify(existingModel ?? {}).length,
      coverage_target_char_count: JSON.stringify(coverageTargets).length,
      retry_directive_char_count: JSON.stringify(retryDirective ?? '').length,
      host_diagnostics_included: false,
      permitted_evidence_fingerprint: requestParity.permitted_evidence_fingerprint,
      existing_reference_fingerprint: requestParity.existing_reference_fingerprint,
      coverage_target_set_fingerprint: requestParity.coverage_target_set_fingerprint,
      analysis_payload_fingerprint: requestParity.analysis_payload_fingerprint,
      model_request_payload_fingerprint: requestParity.model_request_payload_fingerprint,
      control_directive_fingerprint: requestParity.control_directive_fingerprint,
    }
    const debug = factDeltaDebugEnabled(input)
    const emitFactDeltaTrace = (stage, details = {}) => {
      if (typeof input?.onFactDeltaTrace !== 'function') return
      try {
        input.onFactDeltaTrace({
          stage,
          mode: 'patch',
          attempt: input.fact_delta_attempt ?? null,
          retry_index: input.fact_delta_retry_index ?? null,
          ...details,
        })
      } catch {
        // Diagnostics must never affect the Supplement result.
      }
    }
    emitFactDeltaTrace('WORLD_PATCH_EVIDENCE_SUMMARY', factDeltaEvidenceSummary(analysisInput))
    emitFactDeltaTrace('WORLD_SUPPLEMENT_COVERAGE_TARGETS', factDeltaCoverageSummary(coverageTargets))
    emitFactDeltaTrace('WORLD_SUPPLEMENT_REQUEST_ENVELOPE', requestEnvelope)
    const raw = await callOpenAICompatible(profile, messages, requestOptions(input))
    const response = responseText(raw)
    emitFactDeltaTrace('WORLD_FACT_DELTA_RESPONSE_RECEIVED', {
      response_text_length: response.length,
    })
    try {
      const parsed = parseWorldModelFactDeltaJson(response)
      const facts = parsed.facts.map((fact, factIndex) => {
        const indexed = {...fact}
        Object.defineProperty(indexed, 'fact_index', {value: factIndex, enumerable: false})
        return indexed
      })
      emitFactDeltaTrace('WORLD_FACT_DELTA_PARSED', {
        raw_fact_block_count: facts.length + (parsed.rejectedFacts?.length ?? 0),
        parsed_fact_count: facts.length,
        parse_rejected_fact_count: parsed.rejectedFacts?.length ?? 0,
        fact_count: facts.length,
        rejected_fact_count: parsed.rejectedFacts?.length ?? 0,
        fields: [...new Set(facts.map(fact => fact.field))],
        scope_summary: facts.reduce((summary, fact) => {
          const scope = factDeltaAddress(fact).scope
          summary[scope] = (summary[scope] ?? 0) + 1
          return summary
        }, {}),
        address_summary: facts.map(fact => ({field: fact.field, ...factDeltaAddress(fact)})),
        rejected_facts: (parsed.rejectedFacts ?? []).map(item => ({
          index: item.index,
          code: item.code,
          reason: item.reason,
          ...(debug ? {raw: String(item.raw ?? '').slice(0, 1000)} : {}),
        })),
        ...(debug ? {facts: facts.map(fact => factDeltaDiagnosticValue(fact))} : {}),
        ...factDeltaCoverageSummary(coverageTargets, facts),
      })
      for (const rejected of parsed.rejectedFacts ?? []) emitFactDeltaTrace('WORLD_FACT_DELTA_REJECTED', {
        fact_index: rejected.index,
        field: rejected.diagnostics?.find(item => item.field)?.field ?? null,
        failure_stage: 'fact_parse',
        failure_code: rejected.code,
        reason: rejected.reason,
      })
      const resolution = {
        ...resolveWorldModelFactDelta(facts, candidateModel, analysisInput),
        resolved_unknown_ids: parsed.resolved_unknown_ids,
      }
      const normalizedExisting = normalizeWorldModel(candidateModel, {strict: true, allowGeneratedProjectionRuleIds: true})
      const guarded = applyWorldModelFactDeltaEvidenceGuard(resolution, analysisInput)
      const acceptedFacts = guarded.factResults
        .filter(item => ['accepted', 'no-op', 'deduplicated'].includes(item.status))
        .map(item => item.fact)
      const coverageFactMappings = buildWorldModelSupplementCoverageFactMappings(coverageTargets, facts, guarded)
      const coverageDispositions = coverageTargets.flatMap(target => {
        const mapping = coverageFactMappings.find(item => item.target_id === target.target_id)
        const acceptedCount = mapping?.exact_address_match_count ?? 0
        const complete = target.cardinality === 'collection' ? acceptedCount >= 1 : acceptedCount === 1
        if (parsed.coverage_no_evidence_target_ids.includes(target.target_id) && acceptedCount === 0)
          return [{target_id: target.target_id, disposition: 'NO_EVIDENCE'}]
        return complete ? [{target_id: target.target_id, disposition: 'EMITTED'}] : []
      })
      const review = {
        coverage_dispositions: coverageDispositions,
        identity_reviews: parsed.identity_reviews,
      }
      let completenessSummary = null
      if (input.require_supplement_completeness === true) {
        try {
          completenessSummary = validateWorldModelSupplementCompleteness({
            coverageTargets,
            coverageDispositions: review.coverage_dispositions,
            identitySubjects,
            identityReviews: review.identity_reviews,
            facts,
            coverageFactMappings,
            acceptedFacts,
            existingModel: candidateModel,
          })
        } catch (error) {
          if (guarded.patch?.operations?.length) {
            error.accepted_patch = typeof structuredClone === 'function'
              ? structuredClone(guarded.patch)
              : JSON.parse(JSON.stringify(guarded.patch))
            error.accepted_fact_delta_summary = {
              world_model_debug_schema_version: WORLD_MODEL_DEBUG_SCHEMA_VERSION,
              analysis_stage_succeeded: true,
              raw_fact_block_count: parsed.raw_fact_block_count ?? facts.length + (parsed.rejectedFacts?.length ?? 0),
              parsed_fact_count: facts.length,
              parse_rejected_fact_count: parsed.rejectedFacts?.length ?? 0,
              fact_count: facts.length,
              rejected_fact_count: (parsed.rejectedFacts?.length ?? 0) + guarded.rejectedFacts.length,
              accepted_fact_count: guarded.factResults.filter(item => ['accepted', 'no-op', 'deduplicated'].includes(item.status)).length,
              accepted_operation_count: guarded.patch.operations.length,
              canonical_mutation_occurred: true,
              completeness_required: true,
              completeness_satisfied: false,
              supplement_completeness_complete: false,
              coverage_dispositions: review.coverage_dispositions,
              request_envelope: requestEnvelope,
            }
          }
          emitFactDeltaTrace('WORLD_SUPPLEMENT_INCOMPLETE', {
            failure_stage: 'supplement_completeness',
            failure_code: error.code,
            completeness_diagnostics: error.diagnostics,
            accepted_operation_count: guarded.patch.operations.length,
            canonical_mutation_occurred: guarded.patch.operations.length > 0,
          })
          throw error
        }
      }
      const acceptedIdentityFacts = guarded.factResults
        .filter(item => ['accepted', 'no-op', 'deduplicated'].includes(item.status) && item.fact?.field === 'Type_Identity')
        .map(item => item.fact)
      const coverageMutationStates = factDeltaMutationStates(
        coverageTargets,
        review.coverage_dispositions,
        guarded.factResults,
      )
      const identityDiversity = summarizeWorldModelSupplementIdentityDiversity({
        existingModel: candidateModel,
        identitySubjects,
        identityReviews: review.identity_reviews,
        facts,
        acceptedFacts: acceptedIdentityFacts,
      })
      const typeIdentityDecisions = factDeltaTypeIdentityDecisions({
        facts,
        resolution,
        guarded,
        existing: candidateModel,
        analysisInput,
        debug,
      })
      for (const decision of typeIdentityDecisions)
        emitFactDeltaTrace('WORLD_TYPE_IDENTITY_DECISION', {
          execution_id: input.fact_delta_execution_id ?? null,
          world_model_debug_schema_version: WORLD_MODEL_DEBUG_SCHEMA_VERSION,
          ...decision,
        })
      for (const rejected of guarded.rejectedFacts) {
        const error = rejected.guardError
        const operation = factDeltaRejectedOperation(error)
        if (error?.validation_stage === 'world_patch_v2_evidence_guard') {
          const decision = factDeltaEvidenceGuardDecision(
            rejected.operation ?? {
              op: operation?.operation_type,
              target: error.operation_target,
              value: operation?.proposed_value,
            },
            analysisInput,
            error,
            rejected.fact_index ?? rejected.index ?? null,
            debug,
          )
          emitFactDeltaTrace('WORLD_EVIDENCE_GUARD_DECISION', {
            execution_id: input.fact_delta_execution_id ?? null,
            ...decision,
          })
          emitFactDeltaTrace('WORLD_PATCH_EVIDENCE_REJECTED', {
            fact_index: rejected.fact_index,
            rejected_operation_type: operation?.operation_type ?? error.operation_op ?? rejected.operation?.op ?? null,
            rejected_semantic_path: operation?.semantic_path ?? error.canonical_target_path ?? error.path ?? null,
            species: operation?.species ?? rejected.species ?? null,
            biological_type: operation?.biological_type ?? rejected.biological_type ?? null,
            field: operation?.field ?? rejected.field ?? null,
            proposed_value: operation?.proposed_value ?? null,
            classification: operation?.classification ?? null,
            evidence_guard_failure_code: error.message ?? error.code ?? rejected.code,
            rejected_semantic_field: error.guard_kind === 'structured_fact_boundary' ? null : error.rejected_semantic_field ?? error.path ?? null,
            rejected_structural_path: error.guard_kind === 'structured_fact_boundary' ? error.path ?? null : null,
            evidence_binding: factDeltaEvidenceBindingDiagnostics(rejected.operation ?? {
              op: operation?.operation_type,
              target: error.operation_target,
              value: operation?.proposed_value,
            }, analysisInput, error, debug),
            decision,
          })
        } else {
          emitFactDeltaTrace('WORLD_FACT_DELTA_REJECTED', {
            fact_index: rejected.fact_index,
            field: rejected.field,
            species: rejected.species,
            biological_type: rejected.biological_type,
            failure_stage: error?.validation_stage ?? 'fact_resolution',
            failure_code: rejected.code,
            reason: rejected.reason,
          })
        }
      }
      const parseRejectedFactCount = parsed.rejectedFacts?.length ?? 0
      const resolutionRejectedFactCount = guarded.rejectedFacts.filter(item => !item.guardError).length
      const evidenceGuardRejectedFactCount = guarded.rejectedFacts.filter(item => item.guardError).length
      const acceptedFactCount = guarded.factResults.filter(item => ['accepted', 'no-op', 'deduplicated'].includes(item.status)).length
      const collectionResults = Array.isArray(guarded.factResults) ? guarded.factResults : []
      const countCollection = (field, statuses) => collectionResults.filter(item => item.field === field && statuses.includes(item.status)).length
      const collectionLifecycle = {
        special_rule_appended_count: guarded.patch.operations.filter(operation => operation.op === 'ADD_SPECIAL_RULE').length,
        special_rule_deduped_count: countCollection('Special_Rule', ['no-op', 'deduplicated']),
        exception_appended_count: guarded.patch.operations.filter(operation => operation.op === 'ADD_EXCEPTION').length,
        exception_deduped_count: countCollection('Exception', ['no-op', 'deduplicated']),
        unknown_existing_count: Array.isArray(candidateModel?.unknowns) ? candidateModel.unknowns.length : 0,
        unknown_appended_count: guarded.patch.operations.filter(operation => operation.op === 'ADD_UNKNOWN').length,
        unknown_deduped_count: countCollection('Unknown', ['no-op', 'deduplicated']),
        unknown_resolved_count: (guarded.unknownResolution ?? []).filter(item => item.status === 'removed').length,
        unknown_resolution_rejected_count: (guarded.unknownResolution ?? []).filter(item => item.status !== 'removed').length,
        unknown_resolution: guarded.unknownResolution ?? [],
      }
      emitFactDeltaTrace('WORLD_COLLECTION_LIFECYCLE', collectionLifecycle)
      // These buckets are mutually exclusive: raw = parsed + parse-rejected;
      // parsed = resolution-rejected + Guard-rejected + accepted facts.
      const rejectedFactCount = parseRejectedFactCount + resolutionRejectedFactCount + evidenceGuardRejectedFactCount
      const factDeltaSummary = {
        world_model_debug_schema_version: WORLD_MODEL_DEBUG_SCHEMA_VERSION,
        analysis_stage_succeeded: true,
        raw_fact_block_count: parsed.raw_fact_block_count ?? facts.length + parseRejectedFactCount,
        parsed_fact_count: facts.length,
        parse_rejected_fact_count: parseRejectedFactCount,
        resolution_rejected_fact_count: resolutionRejectedFactCount,
        evidence_guard_rejected_fact_count: evidenceGuardRejectedFactCount,
        fact_count: facts.length,
        // Legacy aggregate retained for trace consumers; LIVE STATE uses the funnel above.
        rejected_fact_count: rejectedFactCount,
        accepted_fact_count: acceptedFactCount,
        accepted_operation_count: guarded.patch.operations.length,
        canonical_mutation_occurred: guarded.patch.operations.length > 0,
        completeness_required: input.require_supplement_completeness === true,
        ...(completenessSummary ?? {
          supplement_completeness_complete: input.require_supplement_completeness !== true,
        }),
        identity_diversity: identityDiversity.subjects,
        reported_distinct_type_count: identityDiversity.reported_distinct_type_count,
        host_observed_distinct_type_count: identityDiversity.host_observed_distinct_type_count,
        accepted_canonical_type_count: identityDiversity.accepted_canonical_type_count,
        discovered_sibling_type_count: identityDiversity.discovered_sibling_type_count,
        discovered_sibling_type_names: identityDiversity.discovered_sibling_type_names,
        accepted_sibling_type_count: identityDiversity.accepted_sibling_type_count,
        accepted_sibling_type_names: identityDiversity.accepted_sibling_type_names,
        rejected_sibling_type_count: identityDiversity.rejected_sibling_type_count,
        rejected_sibling_type_names: identityDiversity.rejected_sibling_type_names,
        new_type_identity_fact_count: identityDiversity.new_type_identity_fact_count,
        accepted_new_type_identity_count: identityDiversity.accepted_new_type_identity_count,
        type_identity_decisions: typeIdentityDecisions,
        first_failed_stage: parseRejectedFactCount > 0
          ? 'FACT_PARSE'
          : resolutionRejectedFactCount > 0
            ? 'FACT_RESOLUTION'
            : evidenceGuardRejectedFactCount > 0
              ? 'EVIDENCE_GUARD'
              : null,
        completeness_satisfied: completenessSummary?.supplement_completeness_complete ?? input.require_supplement_completeness !== true,
        coverage_dispositions: Array.isArray(review.coverage_dispositions)
          ? review.coverage_dispositions.slice(0, 64).map(item => ({
              target_id: item.target_id,
              disposition: item.disposition,
            }))
          : [],
        coverage_mutation_states: coverageMutationStates,
        review_accounted: completenessSummary?.supplement_completeness_complete ?? input.require_supplement_completeness !== true,
        mutation_rejected_count: coverageMutationStates.filter(item => item.mutation_status === 'REJECTED').length,
        unknown_resolution: guarded.unknownResolution ?? [],
        unknown_removed_count: (guarded.unknownResolution ?? []).filter(item => item.status === 'removed').length,
        collection_lifecycle: collectionLifecycle,
        request_envelope: requestEnvelope,
      }
      emitFactDeltaTrace('WORLD_FACT_DELTA_RESOLVED', {
        raw_fact_block_count: factDeltaSummary.raw_fact_block_count,
        parsed_fact_count: factDeltaSummary.parsed_fact_count,
        parse_rejected_fact_count: factDeltaSummary.parse_rejected_fact_count,
        resolution_rejected_fact_count: factDeltaSummary.resolution_rejected_fact_count,
        evidence_guard_rejected_fact_count: factDeltaSummary.evidence_guard_rejected_fact_count,
        fact_count: factDeltaSummary.fact_count,
        rejected_fact_count: factDeltaSummary.rejected_fact_count,
        patch_operation_count: guarded.patch.operations.length,
        ...factDeltaSummary,
        fact_mappings: factDeltaResolutionDiagnostics(facts, guarded.patch, normalizedExisting, guarded.factResults),
        coverage_fact_mappings: coverageFactMappings,
        ...factDeltaCoverageSummary(coverageTargets, facts),
      })
      return {
        patch: guarded.patch,
        facts,
        diagnostics: [
          ...(Array.isArray(parsed.diagnostics) ? parsed.diagnostics : []),
          ...(parsed.coverageDiagnostics ?? []),
          ...(parsed.rejectedIdentityReviews ?? []),
          ...(parsed.rejectedUnknownResolutions ?? []),
        ],
        rejectedFacts: [...(parsed.rejectedFacts ?? []), ...guarded.rejectedFacts],
        rejectedIdentityReviews: parsed.rejectedIdentityReviews ?? [],
        resolvedUnknownIds: parsed.resolved_unknown_ids ?? [],
        rejectedUnknownResolutions: parsed.rejectedUnknownResolutions ?? [],
        coverageDiagnostics: parsed.coverageDiagnostics ?? [],
        classified: guarded.classified,
        snapshot_model: clonePatchValue(guarded.model),
        fact_delta_summary: factDeltaSummary,
      }
    } catch (error) {
      if (error?.validation_stage === 'world_patch_v2_evidence_guard') {
        const rejected = factDeltaRejectedOperation(error)
        const decision = factDeltaEvidenceGuardDecision(rejected, analysisInput, error, error.fact_index ?? null, debug)
        emitFactDeltaTrace('WORLD_EVIDENCE_GUARD_DECISION', {
          execution_id: input.fact_delta_execution_id ?? null,
          ...decision,
        })
        emitFactDeltaTrace('WORLD_PATCH_EVIDENCE_REJECTED', {
          rejected_operation_type: rejected?.operation_type ?? error.operation_op ?? null,
          rejected_semantic_path: rejected?.semantic_path ?? error.canonical_target_path ?? error.path ?? null,
          species: rejected?.species ?? error.operation_target?.species_name ?? null,
          biological_type: rejected?.biological_type ?? error.operation_target?.type_name ?? null,
          field: rejected?.field ?? null,
          proposed_value: rejected?.proposed_value ?? null,
          classification: rejected?.classification ?? null,
          evidence_guard_failure_code: error.code ?? error.message ?? null,
          rejected_semantic_field: error.guard_kind === 'structured_fact_boundary' ? null : error.rejected_semantic_field ?? error.path ?? null,
          rejected_structural_path: error.guard_kind === 'structured_fact_boundary' ? error.path ?? null : null,
          evidence_binding: factDeltaEvidenceBindingDiagnostics(rejected, analysisInput, error, debug),
          decision,
        })
      }
      traceApi('parser-error', {
        parser: 'world-model-fact-delta',
        responseTextLength: response.length,
        ...traceParserError(error),
        diagnosticCode: error?.diagnosticCode ?? error?.diagnostic_code ?? error?.message ?? null,
        analysisStage: error?.analysis_stage ?? (error?.code === 'WORLD_MODEL_PATCH_V2_INVALID'
          ? 'world_patch_v2_evidence_guard'
          : 'world_fact_delta_parse'),
        stage: error?.stage ?? 'world_patch_v2',
      })
      throw error
    }
  }

  async function analyzeFloor(input = {}) {
    let profile;
    try {
      profile =
        profileResolver?.('event_analysis') ?? profileResolver?.('event');
    } catch (error) {
      throw annotateAnalysisError(error, 'task_routing');
    }
    if (!profile) {
      const error = new Error('API_PROFILE_NOT_CONFIGURED');
      error.code = 'API_PROFILE_NOT_CONFIGURED';
      throw annotateAnalysisError(error, 'task_routing');
    }
    const analysisInput = input.analysisInput ?? input;
    const suppliedWorldModel = input.world_model ?? analysisInput.world_model;
    if (!suppliedWorldModel) {
      const error = new Error('WORLD_MODEL_UNAVAILABLE')
      error.code = 'WORLD_MODEL_UNAVAILABLE'
      error.analysis_stage = 'world_model_preflight'
      throw error
    }
    try {
      normalizeWorldModel(suppliedWorldModel, { strict: true, allowGeneratedProjectionRuleIds: true })
    } catch (cause) {
      const error = new Error('WORLD_MODEL_UNAVAILABLE')
      error.code = 'WORLD_MODEL_UNAVAILABLE'
      error.analysis_stage = 'world_model_preflight'
      error.cause = cause
      throw error
    }
    let messages;
    try {
      messages = buildEventAnalysisMessages(
        analysisInput,
        analysisPromptResolver?.() ?? {},
      );
    } catch (error) {
      throw annotateAnalysisError(error, 'request_build');
    }
    let raw;
    try {
      raw = await callOpenAICompatible(
        profile,
        messages,
        requestOptions(input),
      );
    } catch (error) {
      throw annotateAnalysisError(error, 'api_request');
    }
    const responseTextLength = traceAnalyzerReceived(raw);
    const response = responseText(raw);
    emitEventAnalysisTrace(
      { onEventAnalysisTrace: input.onEventAnalysisTrace ?? onEventAnalysisTrace },
      {
        stage: 'EVENT_RAW_RESPONSE_SHAPE',
        response_shape: eventResponseShape(raw),
        extraction_mode: eventExtractionMode(response),
        response_text_length: response.length,
      },
    );
    traceApi('parser-start', { parser: 'event', responseTextLength });
    try {
      const parsed = parseEventAnalysisResponse(raw, {
        deferIdentityValidation: true,
      });
      emitEventAnalysisTrace(
        { onEventAnalysisTrace: input.onEventAnalysisTrace ?? onEventAnalysisTrace },
        {
          stage: 'EVENT_PARSE_RESULT',
          parsed: true,
          extraction_mode: eventExtractionMode(response),
          events_present: Array.isArray(parsed.events),
          event_count: parsed.events.length,
        },
      );
      traceApi('parser-success', {
        parser: 'event',
        responseTextLength,
        eventCount: parsed.events.length,
      });
      return parsed;
    } catch (error) {
      emitEventAnalysisTrace(
        { onEventAnalysisTrace: input.onEventAnalysisTrace ?? onEventAnalysisTrace },
        {
          stage: 'EVENT_PARSE_RESULT',
          parsed: false,
          extraction_mode: eventExtractionMode(response),
          events_present: false,
          event_count: 0,
        },
      );
      emitEventAnalysisTrace(
        { onEventAnalysisTrace: input.onEventAnalysisTrace ?? onEventAnalysisTrace },
        {
          stage: 'EVENT_VALIDATION_RESULT',
          schema_valid: error?.analysis_stage === 'response_parse' ? null : false,
          domain_valid: false,
          validator: error?.validator ?? 'event_contract',
          keyword: error?.keyword ?? error?.diagnostic_code ?? error?.code,
          instance_path: error?.instancePath ?? error?.error_path ?? error?.diagnostic_path,
          schema_path: error?.schemaPath,
          validator_params: error?.params,
        },
      );
      traceApi('parser-error', {
        parser: 'event',
        responseTextLength,
        ...traceParserError(error),
      });
      throw annotateAnalysisError(
        error,
        error?.analysis_stage ?? 'schema_validation',
      );
    }
  }

  async function analyzeHealthAssessment(input = {}) {
    const profile = profileResolver?.('health_assessment')
      ?? profileResolver?.('event_analysis')
      ?? profileResolver?.('event')
    if (!profile) {
      const error = new Error('API_PROFILE_NOT_CONFIGURED')
      error.code = 'API_PROFILE_NOT_CONFIGURED'
      throw error
    }
    const event = input.event ?? input.source_event ?? input
    const raw = await callOpenAICompatible(
      profile,
      buildHealthAssessmentMessages(event, analysisPromptResolver?.() ?? {}),
      requestOptions(input),
    )
    const response = responseText(raw)
    let parsed
    try {
      parsed = JSON.parse(response)
    } catch (cause) {
      const error = new Error('HEALTH_ASSESSMENT_INVALID_JSON')
      error.code = 'HEALTH_ASSESSMENT_INVALID_JSON'
      error.cause = cause
      throw error
    }
    const result = validateHealthAssessment({
      ...parsed,
      assessment_id: 'pending',
      request_key: 'pending',
      source_event_id: 'pending',
      source_floor_version: {chat_id: 'pending', message_id: 0, floor: 0, swipe_id: 0, content_hash: 'pending', message_version: 0},
      source_observation_fingerprint: 'pending',
    })
    if (!result.ok) {
      const error = new Error('HEALTH_ASSESSMENT_INVALID')
      error.code = 'HEALTH_ASSESSMENT_INVALID'
      error.errors = result.errors
      throw error
    }
    return normalizeHealthAssessment(parsed)
  }

  return {
    analyzeWorldModel,
    analyzeWorldModelPatchV2,
    analyzeWorld: analyzeWorldModel,
    analyzeFloor,
    analyzeHealthAssessment,
    generateProjection: (input) => run('projection', input),
  };
}
