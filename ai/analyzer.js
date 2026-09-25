import { callOpenAICompatible, traceApi } from './client.js';
import * as eventDomain from '../core/events.js';
import {
  buildEventAnalysisMessages,
  buildPrompt,
  buildWorldModelMessages,
  buildWorldModelPatchMessages,
  buildWorldModelPatchMessagesV2,
  EVENT_STATUS,
  EVENT_TYPES,
  WORLD_MODEL_SCHEMA,
} from './prompts.js';
import { normalizeProjectionRules, validateProjectionRuleContent } from '../core/projection-eligibility.js';

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
const HUMAN_SPECIES_NAMES = new Set([
  '人类',
  '人',
  'human',
  'humans',
  '人类human',
  'human人类',
  '人类人类',
  'homosapiens',
]);
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
  return {
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
  return {
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
}

function humanSpeciesAliasKey(value) {
  return compactEvidenceText(value)
    .replace(/[()\uFF08\uFF09]/gu, '')
    .toLowerCase();
}

function canonicalSpeciesName(value) {
  const text = nullableText(value);
  if (!text) return text;
  return isHumanSpeciesName(text) ? '人类' : localizedWorldModelText(text);
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
  return HUMAN_SPECIES_NAMES.has(humanSpeciesAliasKey(speciesName));
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
  const text = compactEvidenceText(unit);
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

function hasDirectPatternTextEvidence(value, units, pattern) {
  const directUnits = directTextEvidenceUnits(value, units);
  return (
    directUnits.length > 0 && textEvidenceState(directUnits, pattern) !== null
  );
}

function hasGenericScopedTypeEvidence(unit, speciesName, typeName) {
  const speciesMatch = genericDirectLabelMatch(unit, speciesName);
  const typeMatch = genericDirectLabelMatch(unit, typeName);
  if (!speciesMatch || !typeMatch) return false;

  const text = compactEvidenceText(unit);
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
    /性别|生殖分类|分类|类型|存在|包括|包含|分为|基本|主要|多数|少数|极少|少量|大多|通常|均为|都是|为主|有|属于|明确|记录|记载|说明/u;
  const individualPattern =
    /某(?:个|位|名)|一(?:个|位|名)|这个角色|该角色|某人物|单个/u;
  const interactionPattern = /与|和|同|对|向|被|交配|性交|伴侣/u;

  if (
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

function patchFactHasValue(value) {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim() !== ''
  if (typeof value === 'boolean' || typeof value === 'number') return true
  return false
}

function patchCollectionMap(values, identityFor, path) {
  const map = new Map()
  for (const value of Array.isArray(values) ? values : []) {
    const identity = identityFor(value)
    if (!identity || map.has(identity)) {
      throw invalidWorldModelPatch('WORLD_MODEL_PATCH_IDENTITY_UNSUPPORTED', { path })
    }
    map.set(identity, value)
  }
  return map
}

function patchExceptionSemanticValue(value) {
  return {
    statement: value?.statement ?? null,
    applies_to: value?.applies_to ?? null,
  }
}

function patchExceptionSemanticEqual(left, right) {
  return semanticPatchValueEqual(
    patchExceptionSemanticValue(left),
    patchExceptionSemanticValue(right),
  )
}

function patchMechanismSemanticValue(value) {
  return {
    key: value?.key ?? null,
    label: value?.label ?? null,
    pathway: value?.pathway ?? null,
    carrying_compatibility: value?.carrying_compatibility ?? null,
    world_model_rule_refs: [...new Set(value?.world_model_rule_refs ?? [])].sort(),
  }
}

function patchMechanismFingerprint(value) {
  const semantic = patchMechanismSemanticValue(value)
  const encode = (item) => `${typeof item}:${String(item).length}:${String(item)}`
  return [
    semantic.key,
    semantic.label,
    semantic.pathway,
    semantic.carrying_compatibility,
    ...semantic.world_model_rule_refs,
  ].map(encode).join('|')
}

function patchPresenceOf(patch) {
  return patch?.[PATCH_PRESENCE] ?? null
}

function patchPresenceKeys(patch, section, field, value) {
  const presence = patchPresenceOf(patch)?.[section]?.[field]
  if (!Array.isArray(presence))
    throw invalidWorldModelPatch('WORLD_MODEL_PATCH_PRESENCE_UNAVAILABLE', { section, field })
  return presence
}

function patchDeltaError(path, code = 'WORLD_MODEL_PATCH_EVIDENCE_UNSUPPORTED') {
  throw invalidWorldModelPatch(code, { path })
}

function addPatchDelta(deltas, path, oldValue, newValue, context = {}) {
  if (semanticPatchValueEqual(oldValue, newValue)) return
  const kind = oldValue === null || oldValue === undefined
    ? (newValue === null || newValue === undefined ? 'UNCHANGED' : 'ADD')
    : (newValue === null || newValue === undefined ? 'REMOVE' : 'CHANGE')
  if (kind !== 'UNCHANGED') deltas.push({ kind, path, oldValue, newValue, ...context })
}

function comparePatchScalarObject(existing, candidate, keys, path, deltas, context = {}) {
  for (const key of keys)
    addPatchDelta(deltas, `${path}.${key}`, existing?.[key] ?? null, candidate?.[key] ?? null, { ...context, key })
}

function comparePatchStringMembership(existing, candidate, path, deltas, context = {}) {
  const oldSet = new Set(Array.isArray(existing) ? existing : [])
  const newSet = new Set(Array.isArray(candidate) ? candidate : [])
  for (const value of oldSet) {
    if (!newSet.has(value)) addPatchDelta(deltas, `${path}[${value}]`, value, null, { ...context, value })
  }
  for (const value of newSet) {
    if (!oldSet.has(value)) addPatchDelta(deltas, `${path}[${value}]`, null, value, { ...context, value })
  }
}

function comparePatchMechanisms(existing, candidate, path, deltas, context = {}) {
  const oldValues = Array.isArray(existing) ? existing : []
  const newValues = Array.isArray(candidate) ? candidate : []
  const oldMap = patchCollectionMap(oldValues, patchMechanismFingerprint, path)
  const newMap = patchCollectionMap(newValues, patchMechanismFingerprint, path)
  const oldKeys = new Set(oldValues.map((value) => value?.key).filter(Boolean))
  const newKeys = new Set(newValues.map((value) => value?.key).filter(Boolean))

  for (const [fingerprint, oldValue] of oldMap) {
    if (newMap.has(fingerprint)) continue
    if (oldValue?.key && newKeys.has(oldValue.key))
      patchDeltaError(`${path}[${oldValue.key}]`, 'WORLD_MODEL_PATCH_IDENTITY_UNSUPPORTED')
    addPatchDelta(deltas, `${path}[${fingerprint}]`, oldValue, null, { ...context, identity: fingerprint })
  }

  for (const [fingerprint, newValue] of newMap) {
    if (oldMap.has(fingerprint)) continue
    if (!newValue?.key || oldKeys.has(newValue.key))
      patchDeltaError(`${path}[${newValue?.key ?? fingerprint}]`, 'WORLD_MODEL_PATCH_IDENTITY_UNSUPPORTED')
    deltas.push({
      kind: 'ADD_MECHANISM',
      path: `${path}[${newValue.key}]`,
      newValue,
      ...context,
      nested: 'reproductive_mechanisms',
      mechanismKey: newValue.key,
    })
  }
}

function comparePatchBiologicalType(existing, candidate, path, deltas, context = {}) {
  comparePatchScalarObject(existing, candidate, ['description'], path, deltas, context)
  comparePatchScalarObject(existing?.capabilities, candidate?.capabilities, CAPABILITY_KEYS, `${path}.capabilities`, deltas, { ...context, nested: 'capabilities' })
  comparePatchScalarObject(existing?.reproduction_rules, candidate?.reproduction_rules, WORLD_RULE_KEYS, `${path}.reproduction_rules`, deltas, { ...context, nested: 'reproduction_rules' })
  comparePatchScalarObject(existing?.lifecycle, candidate?.lifecycle, LIFECYCLE_KEYS, `${path}.lifecycle`, deltas, { ...context, nested: 'lifecycle' })
  comparePatchStringMembership(existing?.special_rules, candidate?.special_rules, `${path}.special_rules`, deltas, { ...context, nested: 'special_rules' })
  comparePatchMechanisms(existing?.reproductive_mechanisms, candidate?.reproductive_mechanisms, `${path}.reproductive_mechanisms`, deltas, context)
}

function comparePatchSpecies(existing, candidate, deltas) {
  const speciesName = existing?.name ?? candidate?.name
  addPatchDelta(deltas, 'species.description', existing?.description ?? null, candidate?.description ?? null, { speciesName })
  const oldTypes = patchCollectionMap(existing?.biological_types, (value) => value?.name, 'species.biological_types')
  const newTypes = patchCollectionMap(candidate?.biological_types, (value) => value?.name, 'species.biological_types')
  for (const [identity, oldType] of oldTypes) {
    const path = `species[${speciesName}].biological_types[${identity}]`
    if (!newTypes.has(identity)) {
      addPatchDelta(deltas, path, oldType, null, { speciesName, typeName: identity })
      continue
    }
    comparePatchBiologicalType(oldType, newTypes.get(identity), path, deltas, { speciesName, typeName: identity })
  }
  for (const [identity, newType] of newTypes) {
    if (!oldTypes.has(identity)) {
      const path = `species[${speciesName}].biological_types[${identity}]`
      deltas.push({
        kind: 'ADD_TYPE',
        path,
        newValue: newType,
        speciesName,
        typeName: identity,
      })
    }
  }
}

function collectPatchFactLeaves(value, path, facts, context = {}, key = '') {
  if (key === 'name') return facts
  if (['evidence', 'schema_version', 'projection_rule_id'].includes(key)) return facts
  if (patchFactHasValue(value)) {
    facts.push({ path, value, ...context, key })
    return facts
  }
  if (!value || typeof value !== 'object') return facts
  if (Array.isArray(value)) {
    for (const item of value) {
      const childContext = key === 'biological_types' && item && typeof item === 'object'
        ? { ...context, typeName: item.name }
        : key === 'reproductive_mechanisms' && item && typeof item === 'object'
          ? { ...context, nested: 'reproductive_mechanisms', mechanismKey: item.key }
          : context
      collectPatchFactLeaves(item, `${path}[]`, facts, childContext, key)
    }
    return facts
  }
  for (const [childKey, childValue] of Object.entries(value)) {
    const childContext = ['capabilities', 'reproduction_rules', 'lifecycle', 'special_rules', 'reproductive_mechanisms'].includes(childKey)
      ? { ...context, nested: childKey }
      : context
    collectPatchFactLeaves(childValue, `${path}.${childKey}`, facts, childContext, childKey)
  }
  return facts
}

function scopeCompatiblePatchUnits(units, delta) {
  const individualOnlyPattern = /某(?:个|位|名)?(?:角色|人物|NPC)|这个角色|该角色|单个(?:角色|人物|个体)/u
  if (delta.typeName) {
    return units.filter((unit) => hasGenericScopedTypeEvidence(unit, delta.speciesName, delta.typeName))
  }
  if (delta.speciesName) {
    return units
      .filter((unit) => hasGenericDirectLabelEvidence(unit, delta.speciesName))
      .filter((unit) => !individualOnlyPattern.test(unit))
  }
  return units.filter((unit) => !individualOnlyPattern.test(unit))
}

function patchFactEvidence(fact, units, delta) {
  const scopedUnits = scopeCompatiblePatchUnits(units, delta)
  if (delta.typeName && scopedUnits.length === 0) return false
  const capabilityKey = delta.nested === 'capabilities' ? delta.key : null
  if (capabilityKey && Object.hasOwn(CAPABILITY_EVIDENCE_PATTERNS, capabilityKey))
    return capabilityEvidenceValue(scopedUnits, CAPABILITY_EVIDENCE_PATTERNS[capabilityKey]) === fact.value
  const ruleKey = delta.nested === 'reproduction_rules'
    ? delta.key
    : delta.nested === 'lifecycle'
      ? delta.key
      : null
  const rulePattern = delta.nested === 'reproduction_rules'
    ? REPRODUCTION_RULE_EVIDENCE_PATTERNS[ruleKey]
    : delta.nested === 'lifecycle'
      ? LIFECYCLE_EVIDENCE_PATTERNS[ruleKey]
      : null
  if (rulePattern && typeof fact.value === 'string') {
    const direct = hasDirectPatternTextEvidence(fact.value, scopedUnits, rulePattern)
    if (direct) return true
  }
  return hasPatchTextEvidence(String(fact.value), scopedUnits)
}

function validateAddedPatchEntry(field, entry, evidence, context = {}) {
  const facts = collectPatchFactLeaves(entry, field, [], context)
  if (!facts.length) patchDeltaError(field)
  for (const fact of facts) {
    if (!patchFactEvidence(fact, evidence, fact)) patchDeltaError(fact.path)
  }
}

function validateAddedBiologicalType(speciesName, type, evidence, path) {
  const identity = { value: type.name, speciesName, typeName: type.name, key: 'name' }
  if (!patchFactEvidence(identity, evidence, identity)) patchDeltaError(`${path}.name`)
  const facts = collectPatchFactLeaves(type, path, [], { speciesName, typeName: type.name })
  for (const fact of facts) {
    if (!patchFactEvidence(fact, evidence, fact)) patchDeltaError(fact.path)
  }
}

function validateAddedReproductiveMechanism(mechanism, evidence, context, path) {
  if (!mechanism?.key) patchDeltaError(path, 'WORLD_MODEL_PATCH_IDENTITY_UNSUPPORTED')
  const facts = collectPatchFactLeaves(
    mechanism,
    path,
    [],
    { ...context, nested: 'reproductive_mechanisms', mechanismKey: mechanism.key },
  )
  for (const fact of facts) {
    if (!patchFactEvidence(fact, evidence, fact)) patchDeltaError(fact.path)
  }
}

function validatePatchDeltas(deltas, evidence) {
  for (const delta of deltas) {
    if (delta.kind === 'ADD_TYPE') {
      validateAddedBiologicalType(delta.speciesName, delta.newValue, evidence, delta.path)
      continue
    }
    if (delta.kind === 'ADD_MECHANISM') {
      validateAddedReproductiveMechanism(delta.newValue, evidence, delta, delta.path)
      continue
    }
    if (delta.kind === 'REMOVE') patchDeltaError(delta.path)
    if (delta.kind === 'UNCHANGED') continue
    const fact = { value: delta.newValue }
    if (!patchFactEvidence(fact, evidence, delta)) patchDeltaError(delta.path)
  }
}

// Patch validation is intentionally narrower than the Full evidence guard:
// AI performs World Fact Discovery and scope/classification; this layer only
// checks canonical safety, changed-fact evidence, presence, and deletion risk.
export function applyWorldModelPatchEvidenceGuard(patch, analysisInput) {
  const validatedPatch = validateWorldModelPatch(patch)
  const evidence = evidenceUnits(analysisInput)
  const existing = analysisInput?.world_model
    ? normalizeWorldModel(analysisInput.world_model, { strict: true, allowGeneratedProjectionRuleIds: true })
    : null

  for (const entry of validatedPatch.add.species ?? [])
    validateAddedPatchEntry('add.species', entry, evidence, { speciesName: entry.name })
  for (const entry of validatedPatch.add.exceptions ?? [])
    validateAddedPatchEntry('add.exceptions', entry, evidence)
  for (const entry of validatedPatch.add.unknowns ?? [])
    validateAddedPatchEntry('add.unknowns', entry, evidence)
  for (const entry of validatedPatch.add.projection_rules ?? [])
    validateAddedPatchEntry('add.projection_rules', entry, evidence)

  for (const candidate of validatedPatch.update.species ?? []) {
    const target = existing?.species?.find((item) => item.name === candidate.name)
    if (!target) patchDeltaError(`update.species[${candidate.name}]`, 'WORLD_MODEL_PATCH_TARGET_NOT_FOUND')
    const deltas = []
    comparePatchSpecies(target, candidate, deltas)
    validatePatchDeltas(deltas, evidence)
  }

  const medical = validatedPatch.update.medical_context
  if (medical) {
    if (!existing) patchDeltaError('update.medical_context', 'WORLD_MODEL_PATCH_TARGET_NOT_FOUND')
    const deltas = []
    for (const key of patchPresenceKeys(validatedPatch, 'update', 'medical_context', medical))
      addPatchDelta(deltas, `update.medical_context.${key}`, existing.medical_context?.[key] ?? null, medical[key] ?? null, { nested: 'medical_context', key })
    validatePatchDeltas(deltas, evidence)
  }

  for (const entry of validatedPatch.update.projection_rules ?? [])
    patchDeltaError('update.projection_rules', 'WORLD_MODEL_PATCH_IDENTITY_UNSUPPORTED')
  return validatedPatch
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

function validateRawStateFactRecord(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !stateFactText(value.kind)) {
    throw eventDiagnostic('invalid_state_fact_payload', path, 'EVENT_STATE_FACT_RECORD_INVALID');
  }
  if (value.description !== undefined && value.description !== null && !stateFactText(value.description)) {
    throw eventDiagnostic('invalid_state_fact_payload', `${path}.description`, 'EVENT_STATE_FACT_DESCRIPTION_INVALID');
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
      validateRawStateFactRecord(payload.symptom, `${eventPath(eventIndex)}.state_fact.payload.symptom`);
      break;
    case 'medical_event':
    case 'other_biological':
      if (!only('fact')) throw eventDiagnostic('invalid_state_fact_payload', `${eventPath(eventIndex)}.state_fact.payload`, 'EVENT_FACT_PAYLOAD_INVALID');
      validateRawStateFactRecord(payload.fact, `${eventPath(eventIndex)}.state_fact.payload.fact`);
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
  'ADD_EXCEPTION',
  'ADD_UNKNOWN',
  'ADD_PROJECTION_RULE',
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
  mechanism: Object.freeze(['key', 'label', 'pathway', 'carrying_compatibility', 'world_model_rule_refs', 'evidence']),
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

export function parseWorldModelPatchV2(raw) {
  if (typeof raw !== 'string') return validateWorldModelPatchV2(raw);
  let lastSchemaError;
  let lastParseError;
  for (const candidate of jsonCandidates(raw)) {
    let parsed;
    try { parsed = JSON.parse(candidate); } catch (cause) { lastParseError = cause; continue; }
    try { return validateWorldModelPatchV2(parsed); } catch (cause) { lastSchemaError = cause; }
  }
  if (lastSchemaError) throw lastSchemaError;
  throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_JSON_INVALID', { path: '$', cause: lastParseError });
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
  if (['SET_FIELD', 'ADD_SPECIAL_RULE', 'ADD_MECHANISM'].includes(operation.op)) {
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
  const pending = new Map();
  return patch.operations.map((rawOperation) => {
    const operation = v2CanonicalOperation(rawOperation);
    if (operation.op === 'SET_FIELD') {
      const classification = v2ClassifyField(existing, operation);
      const normalizedValue = v2NormalizeField(operation);
      return { operation, classification: v2PendingClassification(pending, `field:${operation.target.kind}:${operation.target.species_name ?? ''}:${operation.target.type_name ?? ''}:${operation.path.join('.')}`, normalizedValue, classification) };
    }
    if (operation.op === 'ADD_SPECIES') {
      const candidate = v2NormalizeSpecies(operation.species);
      const current = v2Species(existing, candidate.name);
      if (!current) return { operation, classification: v2PendingClassification(pending, `species:${candidate.name}`, candidate, 'ADD'), target: { kind: 'species', species_name: candidate.name } };
      if (v2Equal(current, candidate)) return { operation, classification: 'NO-OP', target: { kind: 'species', species_name: candidate.name } };
      throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_IDENTITY_CONFLICT', { path: 'operation.species.name' });
    }
    if (operation.op === 'ADD_TYPE') {
      const speciesName = canonicalSpeciesName(operation.target.species_name);
      const species = v2Species(existing, speciesName);
      if (!species) throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_TARGET_NOT_FOUND', { path: 'operation.target.species_name' });
      const candidate = v2NormalizeType(operation.type, speciesName);
      const current = species.biological_types.find((item) => item.name === candidate.name);
      if (!current) return { operation, classification: v2PendingClassification(pending, `type:${speciesName}:${candidate.name}`, candidate, 'ADD'), target: { kind: 'biological_type', species_name: speciesName, type_name: candidate.name } };
      if (v2Equal(current, candidate)) return { operation, classification: 'NO-OP', target: { kind: 'biological_type', species_name: speciesName, type_name: candidate.name } };
      throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_IDENTITY_CONFLICT', { path: 'operation.type.name' });
    }
    if (operation.op === 'ADD_SPECIAL_RULE') {
      const type = v2Type(existing, canonicalSpeciesName(operation.target.species_name), normalizeBiologicalTypeName(operation.target.type_name, operation.target.species_name));
      if (!type) throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_TARGET_NOT_FOUND', { path: 'operation.target' });
      const value = v2TextIdentity(operation.value);
      return { operation, classification: v2PendingClassification(pending, `special_rule:${canonicalSpeciesName(operation.target.species_name)}:${type.name}:${value}`, value, type.special_rules.some((item) => v2TextIdentity(item) === value) ? 'NO-OP' : 'ADD') };
    }
    if (operation.op === 'ADD_MECHANISM') {
      const type = v2Type(existing, canonicalSpeciesName(operation.target.species_name), normalizeBiologicalTypeName(operation.target.type_name, operation.target.species_name));
      if (!type) throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_TARGET_NOT_FOUND', { path: 'operation.target' });
      const candidate = normalizeReproductiveMechanism(operation.mechanism, 'operation.mechanism');
      const classification = v2PendingClassification(pending, `mechanism:${canonicalSpeciesName(operation.target.species_name)}:${type.name}:${candidate.key}`, candidate, v2CollectionClassification(type.reproductive_mechanisms, candidate, (item) => item.key, v2MechanismContent));
      if (classification === 'REJECT') throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_IDENTITY_CONFLICT', { path: 'operation.mechanism.key' });
      return { operation, classification, target: { kind: 'biological_type', species_name: canonicalSpeciesName(operation.target.species_name), type_name: type.name, mechanism_key: candidate.key } };
    }
    if (operation.op === 'ADD_EXCEPTION') {
      const candidate = v2NormalizeException(operation.exception);
      const exceptionIdentity = `${v2TextIdentity(candidate.statement)}|${v2TextIdentity(candidate.applies_to)}`;
      const classification = v2PendingClassification(pending, `exception:${exceptionIdentity}`, candidate, v2CollectionClassification(existing.exceptions, candidate, (item) => `${v2TextIdentity(item.statement)}|${v2TextIdentity(item.applies_to)}`, (item) => ({ statement: v2TextIdentity(item.statement), applies_to: v2TextIdentity(item.applies_to), evidence: item.evidence ?? null })));
      if (classification === 'REJECT') throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_IDENTITY_CONFLICT', { path: 'operation.exception' });
      return { operation, classification };
    }
    if (operation.op === 'ADD_UNKNOWN') {
      const candidate = v2TextIdentity(operation.unknown);
      return { operation, classification: v2PendingClassification(pending, `unknown:${candidate}`, candidate, existing.unknowns.some((item) => v2TextIdentity(item) === candidate) ? 'NO-OP' : 'ADD') };
    }
    const candidate = normalizeProjectionRules([operation.projection_rule], { allowGeneratedIdentity: true })[0];
    const classification = v2PendingClassification(pending, `projection_rule:${candidate.projection_rule_id}`, candidate, v2CollectionClassification(existing.projection_rules, candidate, (item) => item.projection_rule_id, (item) => item));
    if (classification === 'REJECT') throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_IDENTITY_CONFLICT', { path: 'operation.projection_rule' });
    return { operation, classification, target: { kind: 'projection_rule', projection_rule_id: candidate.projection_rule_id } };
  });
}

function v2EvidenceError(path) {
  throw invalidWorldModelPatchV2('WORLD_MODEL_PATCH_V2_EVIDENCE_UNSUPPORTED', { path });
}

function v2IndividualOnlyUnit(unit) {
  return /(?:某(?:个|位|名)?(?:角色|人物|个体|NPC)|这个角色|该角色|单个(?:角色|人物|个体)|\b(?:an?|one|single)\s+(?:character|person|individual|NPC)\b)/iu.test(unit);
}

function v2ScopedEvidenceUnits(units, context = {}) {
  const safeUnits = units.filter((unit) => !v2IndividualOnlyUnit(unit));
  if (context.typeName)
    return safeUnits.filter((unit) =>
      hasGenericDirectLabelEvidence(unit, context.speciesName) &&
      hasGenericDirectLabelEvidence(unit, context.typeName) &&
      hasGenericScopedTypeEvidence(unit, context.speciesName, context.typeName),
    );
  if (context.speciesName)
    return safeUnits.filter((unit) => hasGenericDirectLabelEvidence(unit, context.speciesName));
  return safeUnits;
}

function v2EvidenceSupportsFact(value, units, context = {}) {
  const scopedUnits = v2ScopedEvidenceUnits(units, context);
  if (!scopedUnits.length) return false;
  if (context.nested === 'capabilities')
    return patchFactEvidence({ value }, scopedUnits, context);
  if (typeof value === 'string') {
    const compactValue = compactEvidenceText(value).replace(/[。！？!?；;，,、]+$/gu, '');
    if (compactValue && scopedUnits.some((unit) => compactEvidenceText(unit).includes(compactValue))) return true;
  }
  if (patchFactEvidence({ value }, scopedUnits, context)) return true;
  if (typeof value !== 'string') return false;
  return scopedUnits.some((unit) =>
    hasDirectTextEvidence(value, [unit]) || hasGenericDirectLabelEvidence(unit, value),
  );
}

function v2SpeciesExistenceSupported(speciesName, units) {
  return speciesEvidenceUnits(units, speciesName).some((unit) => !v2IndividualOnlyUnit(unit));
}

function v2TypeExistenceSupported(speciesName, typeName, units) {
  return v2ScopedEvidenceUnits(units, { speciesName, typeName }).length > 0;
}

function v2KnownTypeLeaves(type, path, speciesName) {
  const facts = [];
  if (v2Known(type.description)) facts.push({ path: `${path}.description`, value: type.description, context: { speciesName, typeName: type.name } });
  for (const key of CAPABILITY_KEYS) {
    if (v2Known(type.capabilities?.[key])) facts.push({ path: `${path}.capabilities.${key}`, value: type.capabilities[key], context: { speciesName, typeName: type.name, nested: 'capabilities', key } });
  }
  for (const key of WORLD_RULE_KEYS) {
    if (v2Known(type.reproduction_rules?.[key])) facts.push({ path: `${path}.reproduction_rules.${key}`, value: type.reproduction_rules[key], context: { speciesName, typeName: type.name, nested: 'reproduction_rules', key } });
  }
  for (const key of LIFECYCLE_KEYS) {
    if (v2Known(type.lifecycle?.[key])) facts.push({ path: `${path}.lifecycle.${key}`, value: type.lifecycle[key], context: { speciesName, typeName: type.name, nested: 'lifecycle', key } });
  }
  for (const [index, value] of (type.special_rules ?? []).entries()) {
    if (v2Known(value)) facts.push({ path: `${path}.special_rules[${index}]`, value, context: { speciesName, typeName: type.name, nested: 'special_rules', key: value } });
  }
  for (const [index, mechanism] of (type.reproductive_mechanisms ?? []).entries()) {
    const mechanismPath = `${path}.reproductive_mechanisms[${index}]`;
    const mechanismContext = { speciesName, typeName: type.name, nested: 'reproductive_mechanisms', mechanismKey: mechanism.key };
    const knownFields = ['label', 'pathway', 'carrying_compatibility', 'world_model_rule_refs'];
    for (const key of knownFields) {
      const value = mechanism[key];
      if (Array.isArray(value)) {
        value.forEach((item, itemIndex) => {
          if (v2Known(item)) facts.push({ path: `${mechanismPath}.${key}[${itemIndex}]`, value: item, context: { ...mechanismContext, key } });
        });
      } else if (v2Known(value)) facts.push({ path: `${mechanismPath}.${key}`, value, context: { ...mechanismContext, key } });
    }
    // key is identity, and evidence is provenance supplied by the model; neither self-proves the mechanism.
  }
  return facts;
}

function v2MechanismCompatibilityEvidence(value, units, context) {
  const scopedText = v2ScopedEvidenceUnits(units, context).join('\n');
  const expected = value === true
    ? /(?:(?:支持|可以|能够|允许)[^。！？!?；;，,、\n]{0,10}(?:携带|妊娠|胎儿|兼容)|(?:携带|妊娠|胎儿|兼容)[^。！？!?；;，,、\n]{0,10}(?:支持|可以|能够|允许))/iu
    : /(?:(?:不支持|不能|无法|不允许|不兼容)[^。！？!?；;，,、\n]{0,10}(?:携带|妊娠|胎儿|兼容)|(?:携带|妊娠|胎儿|兼容)[^。！？!?；;，,、\n]{0,10}(?:不支持|不能|无法|不允许|不兼容))/iu;
  return expected.test(scopedText);
}

function v2ValidateTypeSubtree(type, speciesName, units, path) {
  const knownFacts = v2KnownTypeLeaves(type, path, speciesName);
  if (!v2TypeExistenceSupported(speciesName, type.name, units)) v2EvidenceError(`${path}.name`);
  for (const fact of knownFacts) {
    if (fact.context.nested === 'reproductive_mechanisms' && fact.context.key === 'carrying_compatibility') {
      if (!v2MechanismCompatibilityEvidence(fact.value, units, fact.context)) v2EvidenceError(fact.path);
      continue;
    }
    if (!v2EvidenceSupportsFact(fact.value, units, fact.context)) v2EvidenceError(fact.path);
  }
  if ((type.reproductive_mechanisms ?? []).some((mechanism) => !v2KnownTypeLeaves({ ...type, reproductive_mechanisms: [mechanism] }, path, speciesName).some((fact) => fact.context.mechanismKey === mechanism.key)))
    v2EvidenceError(`${path}.reproductive_mechanisms`);
}

function v2ValidateSpeciesSubtree(species, units, path) {
  if (!v2SpeciesExistenceSupported(species.name, units)) v2EvidenceError(`${path}.name`);
  if (v2Known(species.description) && !v2EvidenceSupportsFact(species.description, units, { speciesName: species.name }))
    v2EvidenceError(`${path}.description`);
  for (const [index, type] of (species.biological_types ?? []).entries())
    v2ValidateTypeSubtree(type, species.name, units, `${path}.biological_types[${index}]`);
}

function v2ValidateMechanismOperation(operation, units) {
  const mechanism = operation.mechanism;
  const context = { speciesName: operation.target.species_name, typeName: operation.target.type_name, nested: 'reproductive_mechanisms', mechanismKey: mechanism.key };
  const knownFields = ['label', 'pathway', 'carrying_compatibility', 'world_model_rule_refs'];
  let supported = false;
  for (const key of knownFields) {
    const value = mechanism[key];
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (!v2Known(item)) continue;
      if (key === 'carrying_compatibility') {
        if (!v2MechanismCompatibilityEvidence(item, units, context)) v2EvidenceError(`operation.mechanism.${key}`);
      } else if (!v2EvidenceSupportsFact(item, units, { ...context, key })) {
        v2EvidenceError(`operation.mechanism.${key}`);
      }
      supported = true;
    }
  }
  if (!supported) v2EvidenceError('operation.mechanism');
}

function v2ProjectionSemanticLeaves(rule, path = 'operation.projection_rule') {
  const leaves = [];
  const collect = (value, currentPath, key) => {
    if (value === null || value === undefined || key === 'schema_version' || key === 'projection_rule_id') return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => collect(item, `${currentPath}[${index}]`, key));
      return;
    }
    if (typeof value === 'object') {
      for (const [childKey, childValue] of Object.entries(value)) collect(childValue, `${currentPath}.${childKey}`, childKey);
      return;
    }
    leaves.push({ path: currentPath, value });
  };
  for (const [key, value] of Object.entries(rule ?? {})) collect(value, `${path}.${key}`, key);
  return leaves;
}

function v2ProjectionToken(value) {
  return compactEvidenceText(String(value)).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function v2ProjectionContextualScalarSupported(path, value, units) {
  const token = v2ProjectionToken(value);
  if (!token) return false;
  let contexts;
  if (path.includes('.target_story_time.day_index')) {
    contexts = ['target_story_time', 'target story time', 'story_time', 'story time', '故事时间', '目标故事时间'];
  } else if (path.includes('.min_elapsed_story_days')) {
    contexts = ['min_elapsed_story_days', 'min elapsed story days', 'elapsed story days', 'elapsed days', '经过天数'];
  } else {
    const key = path.split('.').at(-1)?.replace(/\[\d+\]/gu, '') ?? '';
    contexts = key ? [key, key.replaceAll('_', ' ')] : [];
  }
  const contextPattern = contexts
    .filter(Boolean)
    .map((context) => v2ProjectionToken(context))
    .join('|');
  if (!contextPattern) return false;
  const scalarPattern = path.includes('.target_story_time.') || path.includes('.min_elapsed_story_days')
    ? new RegExp(`(?:${contextPattern})[^。！？!?；;，,、\\n]{0,28}${token}`, 'iu')
    : new RegExp(`(?:${contextPattern})[^。！？!?；;，,、\\n]{0,28}${token}|${token}[^。！？!?；;，,、\\n]{0,28}(?:${contextPattern})`, 'iu');
  return units.some((unit) => scalarPattern.test(compactEvidenceText(unit)));
}

function v2ProjectionBooleanSupported(path, value, units) {
  const token = value ? '(?:true|是|支持|可以|能够|允许)' : '(?:false|否|不支持|不能|无法|不允许)';
  const contexts = path.includes('.requirements.capabilities[')
    ? ['capability', 'capabilities', '能力', 'equals', '要求', 'required']
    : [path.split('.').at(-1)?.replace(/\[\d+\]/gu, '') ?? ''];
  const contextPattern = contexts.filter(Boolean).map(v2ProjectionToken).join('|');
  if (!contextPattern) return false;
  const booleanPattern = new RegExp(`(?:${contextPattern})[^。！？!?；;，,、\\n]{0,28}${token}|${token}[^。！？!?；;，,、\\n]{0,28}(?:${contextPattern})`, 'iu');
  return units.some((unit) => booleanPattern.test(compactEvidenceText(unit)));
}

function v2ProjectionLeafSupported(leaf, units) {
  if (typeof leaf.value === 'string') return v2EvidenceSupportsFact(leaf.value, units, {});
  if (typeof leaf.value === 'boolean') return v2ProjectionBooleanSupported(leaf.path, leaf.value, units);
  if (typeof leaf.value === 'number') return v2ProjectionContextualScalarSupported(leaf.path, leaf.value, units);
  return false;
}

function v2ValidateProjectionRuleEvidence(rule, units) {
  const leaves = v2ProjectionSemanticLeaves(rule);
  if (!leaves.length) v2EvidenceError('operation.projection_rule');
  for (const leaf of leaves) {
    if (!v2ProjectionLeafSupported(leaf, units)) v2EvidenceError(leaf.path);
  }
}

function v2ValidateOperationEvidence(operation, classification, units, existing) {
  if (classification === 'NO-OP') return;
  if (classification === 'REJECT') v2EvidenceError('operation');
  if (operation.op === 'ADD_SPECIES') {
    v2ValidateSpeciesSubtree(v2NormalizeSpecies(operation.species), units, 'operation.species');
    return;
  }
  if (operation.op === 'ADD_TYPE') {
    const species = v2Species(existing, operation.target.species_name);
    if (!species) v2EvidenceError('operation.target.species_name');
    v2ValidateTypeSubtree(v2NormalizeType(operation.type, operation.target.species_name), operation.target.species_name, units, 'operation.type');
    return;
  }
  if (operation.op === 'SET_FIELD') {
    const context = { speciesName: operation.target.species_name, typeName: operation.target.type_name, nested: operation.path[0], key: operation.path[1] };
    if (operation.target.kind === 'species') delete context.typeName;
    if (operation.target.kind === 'world') delete context.speciesName;
    if (!v2EvidenceSupportsFact(v2NormalizeField(operation), units, context)) v2EvidenceError(`operation.${operation.path.join('.')}`);
    return;
  }
  if (operation.op === 'ADD_SPECIAL_RULE') {
    if (!v2EvidenceSupportsFact(operation.value, units, { speciesName: operation.target.species_name, typeName: operation.target.type_name, nested: 'special_rules', key: operation.value })) v2EvidenceError('operation.value');
    return;
  }
  if (operation.op === 'ADD_MECHANISM') {
    v2ValidateMechanismOperation(operation, units);
    return;
  }
  if (operation.op === 'ADD_EXCEPTION') {
    const exception = v2NormalizeException(operation.exception);
    const scope = exception.applies_to;
    const context = v2Species(existing, scope) ? { speciesName: scope } : {};
    if (!v2EvidenceSupportsFact(exception.statement, units, context)) v2EvidenceError('operation.exception.statement');
    if (scope && !v2EvidenceSupportsFact(scope, units, context)) v2EvidenceError('operation.exception.applies_to');
    return;
  }
  if (operation.op === 'ADD_UNKNOWN') {
    if (!v2EvidenceSupportsFact(operation.unknown, units, {})) v2EvidenceError('operation.unknown');
    return;
  }
  if (operation.op === 'ADD_PROJECTION_RULE') {
    v2ValidateProjectionRuleEvidence(operation.projection_rule, units);
  }
}

export function applyWorldModelPatchV2EvidenceGuard(patch, existingModel, analysisInput = {}) {
  const existing = normalizeWorldModel(existingModel, { strict: true, allowGeneratedProjectionRuleIds: true });
  const classified = classifyWorldModelPatchV2(patch, existing);
  const units = evidenceUnits(analysisInput);
  for (const result of classified) v2ValidateOperationEvidence(result.operation, result.classification, units, existing);
  return classified;
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

function v2ExceptionIdentity(exception) {
  return `${v2TextIdentity(exception.statement)}|${v2TextIdentity(exception.applies_to)}`;
}

function v2ApplyAddException(model, operation) {
  const exception = v2NormalizeException(operation.exception);
  const identity = v2ExceptionIdentity(exception);
  const existing = model.exceptions.find((item) => v2ExceptionIdentity(item) === identity);
  if (existing) {
    if (v2Equal(patchExceptionSemanticValue(existing), patchExceptionSemanticValue(exception))) return;
    v2MergeError('operation.exception', 'WORLD_MODEL_PATCH_V2_IDENTITY_CONFLICT');
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

function v2ApplyClassifiedOperations(model, classified) {
  for (const result of classified) {
    if (result.classification === 'NO-OP') continue;
    if (result.classification !== 'ADD' && result.classification !== 'CHANGE')
      v2MergeError('operations', 'WORLD_MODEL_PATCH_V2_CLASSIFICATION_INVALID');
    const operation = result.operation;
    if (operation.op === 'ADD_SPECIES') v2ApplyAddSpecies(model, operation);
    else if (operation.op === 'ADD_TYPE') v2ApplyAddType(model, operation);
    else if (operation.op === 'SET_FIELD') v2ApplySetField(model, operation);
    else if (operation.op === 'ADD_SPECIAL_RULE') v2ApplyAddSpecialRule(model, operation);
    else if (operation.op === 'ADD_MECHANISM') v2ApplyAddMechanism(model, operation);
    else if (operation.op === 'ADD_EXCEPTION') v2ApplyAddException(model, operation);
    else if (operation.op === 'ADD_UNKNOWN') v2ApplyAddUnknown(model, operation);
    else if (operation.op === 'ADD_PROJECTION_RULE') v2ApplyAddProjectionRule(model, operation);
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

function mergeWorldModelPatchV2Classified(existingModel, classified) {
  const base = normalizeWorldModel(existingModel, { strict: true, allowGeneratedProjectionRuleIds: true });
  const working = clonePatchValue(base);
  v2ApplyClassifiedOperations(working, classified);
  v2SortAppendedEntries(working, base);
  const consistent = applyWorldModelFinalConsistencyGuard(working);
  const normalized = normalizeWorldModel(consistent, { strict: true, allowGeneratedProjectionRuleIds: true });
  return v2RestoreExistingProjectionOrder(normalized, base);
}

export function mergeWorldModelPatchV2(existingModel, patch, analysisInput = {}) {
  const base = normalizeWorldModel(existingModel, { strict: true, allowGeneratedProjectionRuleIds: true });
  const guarded = applyWorldModelPatchV2EvidenceGuard(patch, base, analysisInput);
  return mergeWorldModelPatchV2Classified(base, guarded);
}

const WORLD_MODEL_PATCH_FIELDS = Object.freeze({
  add: Object.freeze(['species', 'exceptions', 'unknowns', 'projection_rules']),
  update: Object.freeze(['species', 'medical_context', 'projection_rules']),
})
const PATCH_PRESENCE = Symbol('worldModelPatchPresence')

function invalidWorldModelPatch(message = 'WORLD_MODEL_PATCH_INVALID', details = {}) {
  const error = new Error(message)
  error.code = 'WORLD_MODEL_PATCH_INVALID'
  Object.assign(error, details)
  return error
}

function clonePatchValue(value) {
  if (value === undefined || value === null) return value
  if (typeof structuredClone === 'function') return structuredClone(value)
  if (Array.isArray(value)) return value.map(clonePatchValue)
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clonePatchValue(item)]))
  return value
}

function patchSection(raw, section) {
  if (raw === undefined) return {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw invalidWorldModelPatch('WORLD_MODEL_PATCH_INVALID', { path: section })
  const unknown = Object.keys(raw).find(key => !WORLD_MODEL_PATCH_FIELDS[section].includes(key))
  if (unknown)
    throw invalidWorldModelPatch('WORLD_MODEL_PATCH_INVALID', { path: `${section}.${unknown}` })
  return raw
}

function normalizePatchEntry(field, value, section, index) {
  const probe = { schema_version: 1, species: [], exceptions: [], unknowns: [], projection_rules: [] }
  if (field === 'species') probe.species = [value]
  else if (field === 'exceptions') probe.exceptions = [value]
  else if (field === 'unknowns') probe.unknowns = [value]
  else if (field === 'projection_rules') probe.projection_rules = [value]
  else if (field === 'medical_context') probe.medical_context = value
  try {
    const normalized = normalizeWorldModel(probe, { strict: false, allowGeneratedProjectionRuleIds: true })
    if (field === 'species') return normalized.species[0]
    if (field === 'exceptions') return normalized.exceptions[0]
    if (field === 'unknowns') return normalized.unknowns[0]
    if (field === 'projection_rules') return normalized.projection_rules[0]
    return normalized.medical_context
  } catch (cause) {
    throw invalidWorldModelPatch('WORLD_MODEL_PATCH_INVALID', {
      path: `${section}.${field}[${index}]`, cause,
    })
  }
}

function capturePatchPresence(raw) {
  if (raw?.[PATCH_PRESENCE]) return raw[PATCH_PRESENCE]
  const presence = { add: {}, update: {} }
  for (const section of ['add', 'update']) {
    const source = raw?.[section]
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue
    for (const field of WORLD_MODEL_PATCH_FIELDS[section]) {
      if (!Object.hasOwn(source, field)) continue
      if (field === 'medical_context') {
        presence[section][field] = source[field] && typeof source[field] === 'object'
          ? Object.keys(source[field])
          : null
      } else {
        presence[section][field] = true
      }
    }
  }
  return presence
}

export function validateWorldModelPatch(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalidWorldModelPatch()
  if (Number(raw.schema_version ?? 1) !== 1) throw invalidWorldModelPatch()
  if (Object.hasOwn(raw, 'remove') || Object.hasOwn(raw, 'invalidate'))
    throw invalidWorldModelPatch('WORLD_MODEL_PATCH_REMOVE_UNSUPPORTED')
  const presence = capturePatchPresence(raw)
  const result = { schema_version: 1, add: {}, update: {} }
  for (const section of ['add', 'update']) {
    const source = patchSection(raw[section], section)
    for (const field of WORLD_MODEL_PATCH_FIELDS[section]) {
      if (source[field] === undefined) continue
      if (field === 'medical_context') {
        if (!source[field] || typeof source[field] !== 'object' || Array.isArray(source[field]))
          throw invalidWorldModelPatch('WORLD_MODEL_PATCH_INVALID', { path: `${section}.${field}` })
        result[section][field] = normalizePatchEntry(field, source[field], section, 0)
        continue
      }
      if (!Array.isArray(source[field]))
        throw invalidWorldModelPatch('WORLD_MODEL_PATCH_INVALID', { path: `${section}.${field}` })
      result[section][field] = source[field].map((entry, index) => normalizePatchEntry(field, entry, section, index))
    }
  }
  Object.defineProperty(result, PATCH_PRESENCE, {
    value: presence,
    enumerable: false,
  })
  return result
}

function stablePatchIdentity(field, entry) {
  if (field === 'species') return String(entry?.name ?? '')
  if (field === 'projection_rules') return String(entry?.projection_rule_id ?? entry?.mechanism_key ?? '')
  if (field === 'unknowns') return String(entry ?? '')
  return null
}

function mergeNamedEntries(base, entries, field, mode) {
  const next = Array.isArray(base) ? base.map(clonePatchValue) : []
  for (const entry of entries ?? []) {
    if (field === 'exceptions') {
      const index = next.findIndex((item) => patchExceptionSemanticEqual(item, entry))
      if (mode === 'update') throw invalidWorldModelPatch('WORLD_MODEL_PATCH_IDENTITY_UNSUPPORTED', { field })
      if (index >= 0) throw invalidWorldModelPatch('WORLD_MODEL_PATCH_DUPLICATE_ADD', { field })
      next.push(clonePatchValue(entry))
      continue
    }
    const identity = stablePatchIdentity(field, entry)
    if (!identity) throw invalidWorldModelPatch('WORLD_MODEL_PATCH_IDENTITY_UNSUPPORTED', { field })
    const index = next.findIndex(item => stablePatchIdentity(field, item) === identity)
    if (mode === 'update') {
      if (index < 0) throw invalidWorldModelPatch('WORLD_MODEL_PATCH_TARGET_NOT_FOUND', { field, identity })
      next[index] = clonePatchValue(entry)
    } else if (index < 0) next.push(clonePatchValue(entry))
    else throw invalidWorldModelPatch('WORLD_MODEL_PATCH_DUPLICATE_ADD', { field, identity })
  }
  return next
}

export function mergeWorldModelPatch(existingModel, patch) {
  const base = normalizeWorldModel(existingModel, { allowGeneratedProjectionRuleIds: true })
  if (patch?.update?.medical_context !== undefined && !patch?.[PATCH_PRESENCE])
    throw invalidWorldModelPatch('WORLD_MODEL_PATCH_PRESENCE_UNAVAILABLE', { section: 'update', field: 'medical_context' })
  const validatedPatch = validateWorldModelPatch(patch)
  const merged = clonePatchValue(base)
  for (const field of ['species', 'projection_rules']) {
    merged[field] = mergeNamedEntries(merged[field], validatedPatch.add[field], field, 'add')
    merged[field] = mergeNamedEntries(merged[field], validatedPatch.update[field], field, 'update')
  }
  for (const field of ['exceptions', 'unknowns'])
    merged[field] = mergeNamedEntries(merged[field], validatedPatch.add[field], field, 'add')
  if (validatedPatch.update.medical_context) {
    const medicalContext = clonePatchValue(validatedPatch.update.medical_context)
    const keys = patchPresenceKeys(validatedPatch, 'update', 'medical_context', medicalContext)
    merged.medical_context = {
      ...merged.medical_context,
      ...Object.fromEntries(keys.map((key) => [key, medicalContext[key]])),
    }
  }
  const consistent = applyWorldModelFinalConsistencyGuard(merged)
  return normalizeWorldModel(consistent, { strict: true, allowGeneratedProjectionRuleIds: true })
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

  async function analyzeWorldModelPatch(input = {}) {
    const profile = profileResolver?.('world_analysis') ?? profileResolver?.('world')
    if (!profile) throw new Error('API_PROFILE_NOT_CONFIGURED')
    const messages = buildWorldModelPatchMessages(
      input.analysisInput ?? input,
      worldModelPromptResolver?.() ?? analysisPromptResolver?.() ?? {},
    )
    const raw = await callOpenAICompatible(profile, messages, requestOptions(input))
    let parsed = null
    let lastParseError = null
    for (const candidate of jsonCandidates(responseText(raw))) {
      try {
        parsed = JSON.parse(candidate)
        break
      } catch (cause) {
        lastParseError = cause
      }
    }
    if (!parsed) {
      throw invalidWorldModelPatch('WORLD_MODEL_PATCH_JSON_INVALID', {
        cause: lastParseError ?? new Error('invalid JSON'),
      })
    }
    return applyWorldModelPatchEvidenceGuard(
      validateWorldModelPatch(parsed),
      input.analysisInput ?? input,
    )
  }

  // Explicit Phase 6 boundary. Runtime continues to call the v1 method until
  // Phase 7 wires v2 sparse merge and persistence; never return this result to
  // the v1 mergeWorldModelPatch() consumer.
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
    const messages = buildWorldModelPatchMessagesV2(
      analysisInput,
      worldModelPromptResolver?.() ?? analysisPromptResolver?.() ?? {},
    )
    const raw = await callOpenAICompatible(profile, messages, requestOptions(input))
    const patch = parseWorldModelPatchV2(responseText(raw))
    const classified = applyWorldModelPatchV2EvidenceGuard(
      patch,
      existingModel,
      analysisInput,
    )
    return { patch, classified }
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

  return {
    analyzeWorldModel,
    analyzeWorldModelPatch,
    analyzeWorldModelPatchV2,
    analyzeWorld: analyzeWorldModel,
    analyzeFloor,
    generateProjection: (input) => run('projection', input),
  };
}
