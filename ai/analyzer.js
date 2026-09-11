import { callOpenAICompatible } from './client.js';
import * as eventDomain from '../core/events.js';
import {
  buildEventAnalysisMessages,
  buildPrompt,
  buildWorldModelMessages,
  EVENT_STATUS,
  EVENT_TYPES,
  WORLD_MODEL_SCHEMA,
} from './prompts.js';
import {normalizeEventFloorVersion} from './input-builder.js';

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
const MALE_EVIDENCE_PATTERN = /(?:男性|男人|男孩|男生|雄性|男子|(?:性别|角色|人物|个体)\s*(?:是|为|属于|[:：])?\s*男(?:性)?|\bmale\b|\bman\b|\bboy\b)/iu;
const FEMALE_EVIDENCE_PATTERN = /(?:女性|女人|女孩|女生|少女|雌性|女子|(?:性别|角色|人物|个体)\s*(?:是|为|属于|[:：])?\s*女(?:性)?|\bfemale\b|\bwoman\b|\bgirl\b)/iu;
const NEGATED_LABEL_CONTEXT_PATTERN = /(?:没有|无|不存在|并非|不是|非|未(?:有|见|说明|提及|发现|出现)|不含|不确定|不明确|不清楚|可能|或许|也许|是否)[^。！？!?；;，,、\n]{0,24}$/u;
const UNKNOWN_LABEL_SUFFIX_PATTERN = /(?:未知|不确定|不明确|不清楚|模糊)\s*$/u;
const CAPABILITY_EVIDENCE_PATTERNS = Object.freeze({
  can_produce_sperm: /(?:产生|生成|制造|分泌|拥有|含有|具备)[^。！？!?；;\n，,]{0,8}(?:精子|精液|雄性配子)|(?:精子|精液|雄性配子)[^。！？!?；;\n，,]{0,8}(?:产生|生成|制造|分泌|拥有|含有|具备)/iu,
  can_produce_ova: /(?:产生|生成|制造|分泌|拥有|含有|具备)[^。！？!?；;\n，,]{0,8}(?:卵子|卵细胞|雌性配子)|(?:卵子|卵细胞|雌性配子)[^。！？!?；;\n，,]{0,8}(?:产生|生成|制造|分泌|拥有|含有|具备)/iu,
  can_be_fertilized: /(?:被|接受|可被|能被|能够被|可以被)[^。！？!?；;\n，,]{0,8}受精|(?:可|能|能够|可以|会|不能|无法|不可|不会)受精(?:能力)?|受精[^。！？!?；;\n，,]{0,8}(?:能力|资格)/iu,
  can_fertilize: /(?:使|让|令)[^。！？!?；;\n，,]{0,8}受精|授精|(?:可|能|能够|可以|会|不能|无法|不可|不会)[^。！？!?；;\n，,]{0,8}(?:使|让|令)[^。！？!?；;\n，,]{0,8}受精/iu,
  can_carry_pregnancy: /(?:怀孕|妊娠|孕育|携带胎儿|承担妊娠|妊娠能力|生育)/iu,
});
const REPRODUCTION_RULE_EVIDENCE_PATTERNS = Object.freeze({
  fertilization: /受精|授精|配子结合|精卵结合|fertiliz/iu,
  pregnancy_or_carrying: /怀孕|妊娠|孕育|受孕|携带胎儿|承担妊娠|母体|pregnan|carrying/iu,
  cycle: /发情期|发情周期|生理期|月经(?:周期)?|排卵周期|繁殖周期|生殖周期|性周期|热期|cycle/iu,
  ovulation: /排卵|卵巢排出|ovulation/iu,
  gestation: /孕期|妊娠期|妊娠时长|妊娠|孕周|孕期时长|(?:孕育|怀孕)[^。！？!?；;\n，,]{0,8}(?:月|周|天)|gestation/iu,
  labor: /分娩|产程|生产|接生|labor/iu,
});
const LIFECYCLE_EVIDENCE_PATTERNS = Object.freeze({
  maturation: /成熟|性成熟|成年|发育|maturation/iu,
  aging: /衰老|老化|寿命|长生|老去|aging|lifespan/iu,
});
const EXPLICIT_NEGATIVE_CAPABILITY_PATTERN = /(?:不能|无法|不可|不会|不具备|未具备|不产生|不生成|不制造|不分泌|不孕育|不可能|不支持|不具有|不含有|(?:不被|不接受)(?:受精|授精)|(?:没有|无(?!法)|不存在)(?:任何|该|其)?(?:产生精子|产生卵子|怀孕|妊娠|生育|受精)(?:能力|可能性|资格|条件))/u;
const NON_EVIDENCE_CAPABILITY_PATTERN = /(?:仅(?:存在|有)?[^。！？!?；;\n，,、]{0,16}(?:假孕|假性妊娠)|(?:无(?!法)|没有|未(?:有|能|观察到|记录|发现|实际)?|尚无|暂无|目前没有|没有实际|无实际)[^。！？!?；;\n，,、]{0,16}(?:妊娠|怀孕|生育|精子|卵子|受精|能力|记录|证据|观察))/u;
const UNSPECIFIED_FIELD_CONTEXT_PATTERN = /(?:没有(?:明确|说明|提及|描述|提供)|未(?:明确|说明|提及|描述|提供)|不确定|不明确|不清楚|未知|尚未(?:明确|说明)|无从判断)[^。！？!?；;，,、\n]{0,10}$/u;
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
const UNKNOWN_RULE_TEXT_PATTERN = /^(?:未知|不确定|不知道|未(?:说明|提及|提到|描述|提供)|没有(?:说明|提及|提到|描述|提供|资料|相关资料|对应资料)|资料不足|证据不足|无法(?:判断|确定)|不能(?:判断|确定)|不明确|不清楚|不明|尚未(?:明确|说明)|暂无(?:资料|记录|证据))$/u;
const KNOWN_ABSENT_RULE_PATTERN = /^(?:无|无(?:此|该|相关)?(?:功能|机制|规则|过程|能力)|(?:不具备|不具有|不含有|不适用|不存在)(?:此|该|相关)?(?:功能|机制|规则|过程|能力)?|没有(?:此|该|相关)?(?:功能|机制|规则|过程|能力))$/u;
const DIRECT_AMBIGUOUS_TYPE = '性别模糊';
const FAMILIAR_TYPE_NAMES = new Set(['男性', '女性', '双性']);
const GENERIC_SPECIES_TYPE_SUFFIXES = Object.freeze(['族', '类', '种', '人']);
const TYPE_PARENT_SPECIES = Symbol('world_model_parent_species');
const TYPE_KNOWN_SPECIES = Symbol('world_model_known_species');
const TYPE_SIBLING_NAMES = Symbol('world_model_sibling_names');

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

function normalizeRuleText(value) {
  const text = localizedWorldModelText(value);
  if (!text) return text;
  const compact = text
    .replace(/\s+/gu, '')
    .replace(/[。！？!?]+$/gu, '');
  if (UNKNOWN_RULE_TEXT_PATTERN.test(compact)) return null;
  return KNOWN_ABSENT_RULE_PATTERN.test(compact) ? '无' : text;
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
    reproduction_rules: Object.fromEntries(WORLD_RULE_KEYS.map(key => [key, normalizeRuleText(reproductionRules[key])])),
    lifecycle: Object.fromEntries(LIFECYCLE_KEYS.map(key => [key, normalizeRuleText(lifecycle[key])])),
    special_rules: stringList(raw.special_rules, localizedWorldModelText),
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

function normalizeSpecies(raw, index, {strict = false} = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalidWorldModel(`WORLD_MODEL_SPECIES_${index}`);
  if (strict && !Array.isArray(raw.biological_types)) throw invalidWorldModel(`WORLD_MODEL_SPECIES_${index}`);
  if (raw.biological_types !== undefined && !Array.isArray(raw.biological_types)) throw invalidWorldModel(`WORLD_MODEL_SPECIES_${index}`);
  const speciesName = canonicalSpeciesName(raw.name);
  const biologicalTypes = Array.isArray(raw.biological_types)
    ? raw.biological_types.map((item, typeIndex) => normalizeBiologicalType(item, typeIndex, speciesName))
    : [];
  return {
    name: speciesName,
    description: localizedWorldModelText(raw.description),
    biological_types: biologicalTypes,
  };
}

function mergeKnownValue(first, second) {
  return first === null || first === undefined ? second ?? null : first;
}

function mergeBiologicalTypes(first, second) {
  return {
    ...first,
    description: mergeKnownValue(first.description, second.description),
    capabilities: Object.fromEntries(CAPABILITY_KEYS.map(key => [
      key,
      first.capabilities[key] === null ? second.capabilities[key] : first.capabilities[key],
    ])),
    reproduction_rules: Object.fromEntries(WORLD_RULE_KEYS.map(key => [
      key,
      mergeKnownValue(first.reproduction_rules[key], second.reproduction_rules[key]),
    ])),
    lifecycle: Object.fromEntries(LIFECYCLE_KEYS.map(key => [
      key,
      mergeKnownValue(first.lifecycle[key], second.lifecycle[key]),
    ])),
    special_rules: [...new Set([...first.special_rules, ...second.special_rules])],
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
    const canonical = {...item, name: '人类'};
    if (humanIndex < 0) {
      humanIndex = merged.length;
      merged.push(canonical);
      continue;
    }
    const current = merged[humanIndex];
    const biologicalTypes = [...current.biological_types];
    for (const type of canonical.biological_types) {
      const existingIndex = biologicalTypes.findIndex(existing => existing.name === type.name);
      if (existingIndex < 0) {
        biologicalTypes.push(type);
      } else {
        biologicalTypes[existingIndex] = mergeBiologicalTypes(biologicalTypes[existingIndex], type);
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

function normalizeExceptions(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalidWorldModel();
  return value.map(item => {
    if (typeof item === 'string') {
      return {statement: localizedWorldModelText(item), applies_to: null, evidence: null};
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw invalidWorldModel();
    const statement = [item.statement, item.description, item.name]
      .map(localizedWorldModelText)
      .find(Boolean) ?? null;
    return {
      statement,
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

function evidenceUnits(input) {
  return worldModelEvidenceText(input)
    .replace(COMPOSITE_DUAL_LABEL_PATTERN, '双性')
    // 保留逗号连接的同一语义单元，避免拆开同一条 species/type 关系。
    .split(/[。！？!?；;\n]+/u)
    .map(value => value.trim())
    .filter(Boolean);
}

function hasLabelEvidenceInUnits(units, pattern) {
  return units.some(unit => {
    const match = unit.match(pattern);
    if (!match) return false;
    const before = unit.slice(0, match.index ?? 0).slice(-12);
    const after = unit.slice((match.index ?? 0) + match[0].length).slice(0, 12);
    if (NEGATED_LABEL_CONTEXT_PATTERN.test(before)) return false;
    if (/^\s*(?:不存在|没有|未(?:有|见|说明|提及|发现|出现)|不确定|不明确|不清楚|模糊)/u.test(after)) return false;
    if (UNKNOWN_LABEL_SUFFIX_PATTERN.test(after)) return false;
    return true;
  });
}

function hasMentionedLabelInUnits(units, pattern) {
  return units.some(unit => {
    const match = unit.match(pattern);
    if (!match) return false;
    const before = unit.slice(0, match.index ?? 0).slice(-12);
    return !NEGATED_LABEL_CONTEXT_PATTERN.test(before);
  });
}

function hasFixedDualEvidenceInUnits(units) {
  return units.some(unit => {
    const stableClause = unit.replace(TEMPORARY_DUAL_PHRASE_PATTERN, '').trim();
    const dualMatch = stableClause.match(DUAL_TERM_PATTERN);
    if (!dualMatch) return false;
    const beforeDual = stableClause.slice(0, dualMatch.index ?? 0).slice(-20);
    if (NEGATED_DUAL_CONTEXT_PATTERN.test(beforeDual)) return false;
    return /(?:^|[：:])\s*双性|双性(?:个体|人|生物|类型|分类|性别|身份|体质|特征|存在者|者|体|存在|是|为|属于)|(?:是|为|属于|定义为|分类为|归类为|存在(?:着)?|包括|包含|出现|有|分为|明确为|固定(?:为)?|本身(?:是|为)?|角色(?:本身)?(?:是|为)?|个体(?:是|为)?|物种(?:是|为)?|种族(?:是|为)?|性别|世界规则|规则|设定|具有|具备|呈现|表现为|规定|记载|说明|明确)[^。！？!?；;，,、\n]{0,16}双性/u.test(stableClause);
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
  return !/[A-Za-z0-9_-]/u.test(compactText[start - 1] ?? '')
    && !/[A-Za-z0-9_-]/u.test(compactText[end] ?? '');
}

function matchesSpeciesName(text, speciesName) {
  const normalizedSpecies = compactEvidenceText(speciesName);
  if (!normalizedSpecies) return false;
  if (isHumanSpeciesName(speciesName) && hasHumanSpeciesEvidence(text)) return true;
  if (normalizedSpecies.length > 1) return text.includes(normalizedSpecies);
  const escapedSpecies = normalizedSpecies.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?:^|[\\s\\[\\]（）()<>：:、，,])${escapedSpecies}(?=$|[\\s\\[\\]（）()<>：:、，,])`, 'u').test(text);
}

function speciesEvidenceUnits(units, speciesName) {
  return units.filter(unit => {
    const compactUnit = compactEvidenceText(unit);
    return matchesSpeciesName(compactUnit, speciesName);
  });
}

function hasDirectTypeEvidence(unit, typeName) {
  if (typeName === '男性') return hasLabelEvidenceInUnits([unit], MALE_EVIDENCE_PATTERN);
  if (typeName === '女性') return hasLabelEvidenceInUnits([unit], FEMALE_EVIDENCE_PATTERN);
  if (typeName === '双性') return hasFixedDualEvidenceInUnits([unit]);
  const normalizedType = compactEvidenceText(typeName);
  if (!normalizedType) return false;
  const typeIndex = compactEvidenceText(unit).indexOf(normalizedType);
  if (typeIndex < 0) return false;
  const before = compactEvidenceText(unit).slice(0, typeIndex).slice(-18);
  const after = compactEvidenceText(unit).slice(typeIndex + normalizedType.length, typeIndex + normalizedType.length + 18);
  return !NEGATED_LABEL_CONTEXT_PATTERN.test(before) && !/^(?:不存在|没有|未(?:有|见|说明|提及|发现|出现)|不确定|不明确|不清楚|模糊)/u.test(after);
}

function typeEvidenceMatch(unit, typeName) {
  if (typeName === '男性') return unit.match(MALE_EVIDENCE_PATTERN);
  if (typeName === '女性') return unit.match(FEMALE_EVIDENCE_PATTERN);
  if (typeName === '双性') return unit.match(DUAL_TERM_PATTERN);
  const normalizedType = compactEvidenceText(typeName);
  if (!normalizedType) return null;
  const compactUnit = compactEvidenceText(unit);
  const typeIndex = compactUnit.indexOf(normalizedType);
  return typeIndex < 0 ? null : {index: typeIndex, 0: normalizedType};
}

function hasSpeciesLinkedTypeEvidence(unit, speciesName, typeName) {
  const typeMatch = typeEvidenceMatch(unit, typeName);
  if (!typeMatch) return false;
  const compactUnit = compactEvidenceText(unit);
  const typeStart = typeMatch.index ?? 0;
  const typeEnd = typeStart + String(typeMatch[0] ?? '').length;
  const relationPattern = /性别|生殖分类|分类|类型|存在|包括|包含|分为|基本|主要|多数|少数|极少|少量|大多|通常|均为|都是|为主|有|属于|明确/u;
  const individualPattern = /某(?:个|位|名)|一(?:个|位|名)|这个角色|该角色|某人物|单个/u;
  const externalHumanPattern = /人类|人族/u;
  const interactionPattern = /与|和|同|对|向|被|交配|性交|伴侣/u;

  const speciesToken = compactEvidenceText(speciesName);
  if (!speciesToken) return false;
  let speciesStart = compactUnit.indexOf(speciesToken);
  while (speciesStart >= 0) {
    const speciesEnd = speciesStart + speciesToken.length;
    const contextStart = Math.min(speciesStart, typeStart);
    const contextEnd = Math.max(speciesEnd, typeEnd);
    const between = compactUnit.slice(Math.min(speciesEnd, typeEnd), Math.max(speciesStart, typeStart));
    const context = compactUnit.slice(Math.max(0, contextStart - 8), Math.min(compactUnit.length, contextEnd + 8));
    if (!externalHumanPattern.test(between)
      && !(interactionPattern.test(between) && !relationPattern.test(between))
      && !(individualPattern.test(context) && !relationPattern.test(between))) {
      if (between.length <= 6 || relationPattern.test(between)) return true;
    }
    speciesStart = compactUnit.indexOf(speciesToken, speciesStart + 1);
  }
  return false;
}

function typeEvidenceUnits(units, speciesName, typeName) {
  const speciesUnits = speciesEvidenceUnits(units, speciesName);
  const directUnits = speciesUnits.filter(unit => (
    hasDirectTypeEvidence(unit, typeName)
      && hasSpeciesLinkedTypeEvidence(unit, speciesName, typeName)
  ));
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
    .filter(value => typeof value === 'string' && value.trim())
    .map(value => value.trim());
  const textAnchors = textValues
    .map(value => compactEvidenceText(value).replace(/[。！？!?；;，,、]+$/gu, ''))
    .filter(Boolean);
  const parentSpeciesName = type?.[TYPE_PARENT_SPECIES];
  const siblingNames = type?.[TYPE_SIBLING_NAMES] ?? [];
  const directlyEvidencedTextUnits = new Set(
    textValues
      .flatMap(value => directTextEvidenceUnits(value, units))
      .filter(unit => !hasGenericDirectLabelEvidence(unit, parentSpeciesName))
      .filter(unit => !siblingNames.some(siblingName => (
        compactEvidenceText(siblingName) !== compactEvidenceText(typeName)
          && hasGenericDirectLabelEvidence(unit, siblingName)
      ))),
  );
  const capabilityPatterns = Object.values(CAPABILITY_EVIDENCE_PATTERNS);
  const rulePatterns = [
    ...Object.values(REPRODUCTION_RULE_EVIDENCE_PATTERNS),
    ...Object.values(LIFECYCLE_EVIDENCE_PATTERNS),
  ];

  return units.filter(unit => {
    if (directlyEvidencedTextUnits.has(unit)) return true;
    const hasTypeName = Boolean(typeName) && hasGenericDirectLabelEvidence(unit, typeName);
    const compactUnit = compactEvidenceText(unit);
    const hasTypeText = hasTypeName && textAnchors.some(anchor => compactUnit.includes(anchor));
    const hasCapabilityPattern = capabilityPatterns.some(pattern => pattern.test(unit));
    const hasRuleOrLifecyclePattern = rulePatterns.some(pattern => pattern.test(unit));
    // Pattern-only wording is local only when the same unit names this type;
    // a bare capability sentence cannot be assigned to one sibling safely.
    return hasTypeName && (hasTypeText || hasCapabilityPattern || hasRuleOrLifecyclePattern);
  });
}

function fieldEvidenceUnits(units, speciesName, typeName) {
  if (isHumanSpeciesName(speciesName)) {
    return units.filter(unit => hasDirectTypeEvidence(unit, typeName));
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
  return NON_EVIDENCE_CAPABILITY_PATTERN.test(capabilityEvidenceContext(unit, match));
}

function isExplicitNegativeCapabilityEvidence(unit, match) {
  const before = unit.slice(0, match.index ?? 0).slice(-16);
  const negatedAuxiliary = /(?:不|未|并不)\s*$/u.test(before)
    && /^(?:能|可|会|被|接受|具备)/u.test(match[0]);
  return EXPLICIT_NEGATIVE_CAPABILITY_PATTERN.test(match[0])
    || EXPLICIT_NEGATIVE_CAPABILITY_PATTERN.test(before)
    || negatedAuxiliary
    || EXPLICIT_NEGATIVE_CAPABILITY_PATTERN.test(unit.slice(Math.max(0, (match.index ?? 0) - 4), match.index ?? 0));
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
  return runs.some(run => [...Array(run.length - 3)].some((_, index) => sourceText.includes(run.slice(index, index + 4))));
}

function sanitizeNonHumanType(type) {
  return {...type};
}

function humanBaseline(typeName) {
  if (typeName === '男性') {
    return {
      capabilities: {
        can_produce_sperm: true,
        can_produce_ova: false,
        can_be_fertilized: false,
        can_fertilize: true,
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
    capabilities: Object.fromEntries(CAPABILITY_KEYS.map(key => {
      const value = type.capabilities[key];
      return [key, value === null ? baseline.capabilities[key] : value];
    })),
    reproduction_rules: Object.fromEntries(WORLD_RULE_KEYS.map(key => {
      const value = type.reproduction_rules[key];
      return [key, value === null ? baseline.reproduction_rules[key] : value];
    })),
    special_rules: type.special_rules.filter(rule => hasDirectRuleEvidence(rule, fieldUnits)),
  };
}

function normalizeAnalysisType(type, speciesName, knownSpeciesNames, siblingNames) {
  const name = normalizeBiologicalTypeName(type?.name, speciesName);
  const normalized = name === type?.name ? {...type} : {...type, name};
  Object.defineProperty(normalized, TYPE_PARENT_SPECIES, {value: speciesName});
  Object.defineProperty(normalized, TYPE_KNOWN_SPECIES, {value: knownSpeciesNames});
  Object.defineProperty(normalized, TYPE_SIBLING_NAMES, {value: siblingNames});
  return normalized;
}

function isSpeciesNameOrGenericDerivative(name, speciesName) {
  const normalizedName = compactEvidenceText(name);
  const normalizedSpecies = compactEvidenceText(speciesName);
  if (!normalizedName || !normalizedSpecies || normalizedName === normalizedSpecies) return true;
  if (isHumanSpeciesName(speciesName) && ['人类', '人'].includes(normalizedName)) return true;
  return GENERIC_SPECIES_TYPE_SUFFIXES.some(suffix => normalizedName === `${normalizedSpecies}${suffix}`);
}

function isObservedNonBiologicalType(name, speciesName) {
  const normalizedName = compactEvidenceText(name);
  if (isSpeciesNameOrGenericDerivative(name, speciesName) || normalizedName === DIRECT_AMBIGUOUS_TYPE) return true;
  return false;
}

function isDualTypeName(name) {
  const text = String(name ?? '');
  return DUAL_TERM_PATTERN.test(text) || /双性(?:化|状态)/u.test(text);
}

function isUnsupportedDualUnknown(value) {
  return /双性(?:个体|个人|人|生物|类型|分类|性别|能力|生育|受精)/u.test(String(value ?? ''));
}

function isUnsupportedUnknownType(value, species) {
  const text = String(value ?? '');
  return species.some(item => {
    if (isHumanSpeciesName(item.name)) return false;
    if (!speciesEvidenceUnits([text], item.name).length) return false;
    const names = new Set(item.biological_types.map(type => type.name));
    return [...FAMILIAR_TYPE_NAMES].some(typeName => {
      if (typeName === '双性' && !hasFixedDualEvidenceInUnits([text])) return false;
      if (typeName === '男性' && !hasMentionedLabelInUnits([text], MALE_EVIDENCE_PATTERN)) return false;
      if (typeName === '女性' && !hasMentionedLabelInUnits([text], FEMALE_EVIDENCE_PATTERN)) return false;
      return !names.has(typeName);
    });
  });
}

function hasGenericDirectLabelEvidence(unit, value) {
  return genericDirectLabelMatch(unit, value) !== null;
}

function hasDirectNameEvidence(value, units) {
  return Boolean(compactEvidenceText(value))
    && units.some(unit => hasGenericDirectLabelEvidence(unit, value));
}

function genericLabelVariants(value) {
  const label = compactEvidenceText(value);
  if (!label) return [];
  const baseLabel = label.replace(/(?:类型|分类|个体|性)$/u, '');
  return baseLabel && baseLabel !== label ? [label, baseLabel] : [label];
}

function genericDirectLabelMatch(unit, value) {
  const text = compactEvidenceText(unit);
  for (const label of genericLabelVariants(value)) {
    let labelIndex = text.indexOf(label);
    while (labelIndex >= 0) {
      const labelEnd = labelIndex + label.length;
      const singleCharacterLabel = label.length === 1
        && /[\u4e00-\u9fff]/u.test(label)
        && !/[\u4e00-\u9fffA-Za-z0-9_-]/u.test(text[labelEnd] ?? '');
      const matchesBoundary = matchesSpeciesName(text, label) || singleCharacterLabel;
      if (matchesBoundary) {
        const before = text.slice(0, labelIndex).slice(-18);
        const after = text.slice(labelEnd, labelEnd + 18);
        const asciiLabelBoundary = /^[A-Za-z0-9_-]+$/u.test(label)
          && (/[A-Za-z0-9_-]/u.test(text[labelIndex - 1] ?? '')
            || /[A-Za-z0-9_-]/u.test(text[labelEnd] ?? ''));
        if (!asciiLabelBoundary
          && !NEGATED_LABEL_CONTEXT_PATTERN.test(before)
          && !/^(?:不存在|没有|未(?:有|见|说明|提及|发现|出现)|不确定|不明确|不清楚|模糊)/u.test(after)
          && !/^(?:未知|不确定|不明确|不清楚|模糊)/u.test(after)) {
          return {index: labelIndex, label};
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
  if (typeof value !== 'string' || value.trim() === '' || !punctuationTrimmedText) return [];
  if (!hasDirectRuleEvidence(value, units)) return [];
  return units.filter(unit => compactEvidenceText(unit).includes(punctuationTrimmedText));
}

function hasDirectTextEvidence(value, units) {
  return directTextEvidenceUnits(value, units).length > 0;
}

function hasDirectPatternTextEvidence(value, units, pattern) {
  const directUnits = directTextEvidenceUnits(value, units);
  return directUnits.length > 0 && textEvidenceState(directUnits, pattern) !== null;
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
  const between = text.slice(Math.min(speciesEnd, typeEnd), Math.max(speciesStart, typeStart));
  const context = text.slice(
    Math.max(0, Math.min(speciesStart, typeStart) - 8),
    Math.min(text.length, Math.max(speciesEnd, typeEnd) + 8),
  );
  const relationPattern = /性别|生殖分类|分类|类型|存在|包括|包含|分为|基本|主要|多数|少数|极少|少量|大多|通常|均为|都是|为主|有|属于|明确|记录|记载|说明/u;
  const individualPattern = /某(?:个|位|名)|一(?:个|位|名)|这个角色|该角色|某人物|单个/u;
  const interactionPattern = /与|和|同|对|向|被|交配|性交|伴侣/u;

  if (between.length > 6 && interactionPattern.test(between) && !relationPattern.test(between)) return false;
  if (individualPattern.test(context) && !relationPattern.test(between)) return false;
  return between.length <= 6 || relationPattern.test(between);
}

function hasTypeSubtreeEvidence(type, units) {
  const parentSpeciesName = type[TYPE_PARENT_SPECIES];
  const knownSpeciesNames = type[TYPE_KNOWN_SPECIES] ?? [];
  const directNameUnits = units.filter(unit => hasGenericDirectLabelEvidence(unit, type.name));
  const supportedNameUnits = directNameUnits.filter(unit => {
    if (!parentSpeciesName || hasGenericScopedTypeEvidence(unit, parentSpeciesName, type.name)) return true;
    if (hasGenericDirectLabelEvidence(unit, parentSpeciesName)) return false;
    return !knownSpeciesNames.some(speciesName => (
      compactEvidenceText(speciesName) !== compactEvidenceText(parentSpeciesName)
        && hasGenericDirectLabelEvidence(unit, speciesName)
    ));
  });
  if (supportedNameUnits.length > 0 || hasDirectTextEvidence(type.description, units)) return true;
  if (WORLD_RULE_KEYS.some(key => type.reproduction_rules[key]
    && hasDirectPatternTextEvidence(type.reproduction_rules[key], units, REPRODUCTION_RULE_EVIDENCE_PATTERNS[key]))) return true;
  if (LIFECYCLE_KEYS.some(key => type.lifecycle[key]
    && hasDirectPatternTextEvidence(type.lifecycle[key], units, LIFECYCLE_EVIDENCE_PATTERNS[key]))) return true;
  if (type.special_rules.some(rule => hasDirectTextEvidence(rule, units))) return true;
  const scopedUnits = units.filter(unit => supportedNameUnits.includes(unit)
    || hasGenericDirectLabelEvidence(unit, type.description));
  if (CAPABILITY_KEYS.some(key => type.capabilities[key] !== null
    && capabilityEvidenceValue(scopedUnits, CAPABILITY_EVIDENCE_PATTERNS[key]) !== null)) return true;
  if (WORLD_RULE_KEYS.some(key => type.reproduction_rules[key]
    && textEvidenceState(scopedUnits, REPRODUCTION_RULE_EVIDENCE_PATTERNS[key]))) return true;
  if (LIFECYCLE_KEYS.some(key => type.lifecycle[key]
    && textEvidenceState(scopedUnits, LIFECYCLE_EVIDENCE_PATTERNS[key]))) return true;
  return false;
}

function hasSpeciesSubtreeEvidence(species, units) {
  if (hasDirectNameEvidence(species.name, units) || hasDirectTextEvidence(species.description, units)) return true;
  return species.biological_types.some(type => hasTypeSubtreeEvidence(type, units));
}

// AI 分析才经过证据边界；手动编辑保存的 World Model 只经过结构规范化。
function applyWorldModelEvidenceGuard(model, analysisInput) {
  const evidence = evidenceUnits(analysisInput);
  const hasFixedDual = hasFixedDualEvidenceInUnits(evidence);
  const knownSpeciesNames = model.species.map(item => item.name);
  const species = [];
  for (const item of model.species) {
    const siblingNames = item.biological_types
      .map(type => normalizeBiologicalTypeName(type?.name, item.name))
      .filter(Boolean);
    const normalizedTypes = item.biological_types
      .map(type => normalizeAnalysisType(type, item.name, knownSpeciesNames, siblingNames))
      .filter(type => !isObservedNonBiologicalType(type.name, item.name));
    if (!hasSpeciesSubtreeEvidence({...item, biological_types: normalizedTypes}, evidence)) continue;
    const humanSpecies = isHumanSpeciesName(item.name);
    const localSpeciesUnits = speciesEvidenceUnits(evidence, item.name);
    const localFixedDual = humanSpecies
      ? hasFixedDualEvidenceInUnits(localSpeciesUnits)
      : hasNonHumanTypeEvidence(evidence, item.name, '双性');
    const supportedTypes = normalizedTypes
      .filter(type => hasTypeSubtreeEvidence(type, evidence))
      .filter(type => localFixedDual || !isDualTypeName(type.name));
    const biologicalTypes = supportedTypes.map(type => humanSpecies
      ? sanitizeHumanType(type, evidence, item.name)
      : sanitizeNonHumanType(type, evidence, item.name));
    species.push({...item, biological_types: biologicalTypes});
  }
  return {
    ...model,
    species,
    unknowns: model.unknowns.filter(value => {
      if (!hasFixedDual && isUnsupportedDualUnknown(value)) return false;
      return !isUnsupportedUnknownType(value, species);
    }),
  };
}

const FERTILIZATION_RECIPIENT_PATTERN = /(?:被|接受|承受)[^。！？!?；;，,、\n]{0,16}(?:受精|授精)|(?:卵子|卵细胞|雌性配子)[^。！？!?；;，,、\n]{0,16}(?:被|接受|承受)[^。！？!?；;，,、\n]{0,16}(?:受精|授精)/iu;
const FERTILIZATION_DONOR_PATTERN = /(?:使|让|令)[^。！？!?；;，,、\n]{0,20}受精|(?:通过|利用|依靠|凭借)[^。！？!?；;，,、\n]{0,16}(?:精子|精液|雄性配子)[^。！？!?；;，,\n]{0,16}(?:使|让|令)[^。！？!?；;，,\n]{0,16}受精|(?:向|给|对)[^。！？!?；;，,、\n]{0,16}授精|作为(?:施受精者|施受精方|供体)/iu;

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
    species: model.species.map(species => ({
      ...species,
      biological_types: species.biological_types.map(type => {
        const capabilities = type.capabilities ?? {};
        const reproductionRules = {...(type.reproduction_rules ?? {})};

        if (capabilities.can_produce_ova === false) reproductionRules.ovulation = '无';
        if (capabilities.can_carry_pregnancy === false) {
          reproductionRules.pregnancy_or_carrying = '无';
          reproductionRules.gestation = '无';
          reproductionRules.labor = '无';
        }

        if (reproductionRules.fertilization && reproductionRules.fertilization !== '无') {
          const roles = fertilizationRoleFlags(reproductionRules.fertilization);
          const roleConflict = (capabilities.can_be_fertilized === false && roles.recipient)
            || (capabilities.can_fertilize === false && roles.donor);
          if (roleConflict) reproductionRules.fertilization = null;
        }

        return {...type, reproduction_rules: reproductionRules};
      }),
    })),
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
    ? mergeHumanSpeciesEntries(raw.species.map((item, index) => normalizeSpecies(item, index, {strict})))
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

const EVENT_CAPABILITY_KEYS = Object.freeze([
  'can_produce_sperm',
  'can_produce_ova',
  'can_be_fertilized',
  'can_carry_pregnancy',
  'can_cause_pregnancy',
]);
const EVENT_SCHEMA_VERSION = Number(
  eventDomain.EVENT_SCHEMA_VERSION
    ?? eventDomain.BIOLOGICAL_EVENT_SCHEMA?.schema_version
    ?? 1,
);
const EVENT_STORY_TIME_PRECISIONS = new Set(['year', 'month', 'day', 'hour', 'minute', 'unknown']);
const EVENT_SOURCE_KEYS = Object.freeze([
  'chat_id',
  'message_id',
  'floor',
  'swipe_id',
  'content_hash',
  'message_version',
]);
const EVENT_SENSITIVE_KEY_PATTERN = /(?:^|_)(?:api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|password|secret)(?:$|_)/iu;

function invalidEventAnalysis(message = 'EVENT_ANALYSIS_INVALID') {
  const error = new Error(message);
  error.code = 'EVENT_ANALYSIS_INVALID';
  return error;
}

function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function eventText(value, field, {nullable = true} = {}) {
  if (value === undefined || value === null) {
    if (nullable) return null;
    throw invalidEventAnalysis(`EVENT_ANALYSIS_${field.toUpperCase()}_REQUIRED`);
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw invalidEventAnalysis(`EVENT_ANALYSIS_${field.toUpperCase()}_INVALID`);
  }
  const text = String(value).trim();
  if (!text && !nullable) throw invalidEventAnalysis(`EVENT_ANALYSIS_${field.toUpperCase()}_REQUIRED`);
  return text || null;
}

function eventBoolean(value, field, fallback = null) {
  if (value === undefined) return fallback;
  if (value === null || typeof value === 'boolean') return value;
  throw invalidEventAnalysis(`EVENT_ANALYSIS_${field.toUpperCase()}_INVALID`);
}

function eventConfidence(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw invalidEventAnalysis(`EVENT_ANALYSIS_${field.toUpperCase()}_INVALID`);
  }
  return value;
}

function eventIdArray(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw invalidEventAnalysis(`EVENT_ANALYSIS_${field.toUpperCase()}_ARRAY_REQUIRED`);
  const ids = [];
  const seen = new Set();
  for (const item of value) {
    const id = eventText(item, field, {nullable: false});
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
  if (Array.isArray(value)) return value.map(item => safeEventValue(item, seen));
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (EVENT_SENSITIVE_KEY_PATTERN.test(key)) continue;
    output[key] = safeEventValue(item, seen);
  }
  return output;
}

function eventEvidence(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw invalidEventAnalysis(`EVENT_ANALYSIS_${field.toUpperCase()}_ARRAY_REQUIRED`);
  return value.map((item, index) => {
    if (typeof item === 'string') {
      const text = eventText(item, `${field}_${index}_text`, {nullable: false});
      return {kind: 'unknown', text};
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw invalidEventAnalysis(`EVENT_ANALYSIS_${field.toUpperCase()}_${index}_INVALID`);
    }
    const text = eventText(item.text ?? item.content, `${field}_${index}_text`, {nullable: false});
    const kind = eventText(item.kind, `${field}_${index}_kind`) ?? 'unknown';
    return {
      kind,
      text,
    };
  });
}

function validateRawEventShape(raw) {
  for (const field of [
    'event_id',
    'type',
    'status',
    'story_time',
    'location',
    'participants',
    'pregnancy_relevance',
    'source_evidence',
    'source',
  ]) {
    if (!hasOwn(raw, field)) {
      throw invalidEventAnalysis(`EVENT_ANALYSIS_${field.toUpperCase()}_REQUIRED`);
    }
  }
  if (!raw.source || typeof raw.source !== 'object' || Array.isArray(raw.source)) {
    throw invalidEventAnalysis('EVENT_ANALYSIS_SOURCE_INVALID');
  }
  for (const field of EVENT_SOURCE_KEYS) {
    if (!hasOwn(raw.source, field)) {
      throw invalidEventAnalysis(`EVENT_ANALYSIS_SOURCE_${field.toUpperCase()}_REQUIRED`);
    }
  }
  for (const field of ['event_id', 'type', 'status', 'location']) {
    if (hasOwn(raw, field) && raw[field] !== null
      && typeof raw[field] !== 'string' && typeof raw[field] !== 'number') {
      throw invalidEventAnalysis(`EVENT_ANALYSIS_${field.toUpperCase()}_INVALID`);
    }
  }
  if (hasOwn(raw, 'participants') && !Array.isArray(raw.participants)) {
    throw invalidEventAnalysis('EVENT_ANALYSIS_PARTICIPANTS_ARRAY_REQUIRED');
  }
  if (!Array.isArray(raw.participants)) return;
  const allowedRoles = new Set(eventDomain.REPRODUCTIVE_ROLES ?? ['potential_gestational_subject', 'potential_conception_source', 'other_participant', 'unknown']);
  raw.participants.forEach((participant, index) => {
    if (!participant || typeof participant !== 'object' || Array.isArray(participant)) {
      throw invalidEventAnalysis(`EVENT_ANALYSIS_PARTICIPANT_${index}_INVALID`);
    }
    for (const field of ['character_id', 'display_name', 'event_role', 'reproductive_capabilities_used', 'evidence']) {
      if (!hasOwn(participant, field)) {
        throw invalidEventAnalysis(`EVENT_ANALYSIS_PARTICIPANT_${index}_${field.toUpperCase()}_REQUIRED`);
      }
    }
    for (const field of ['character_id', 'display_name', 'event_role']) {
      if (hasOwn(participant, field) && participant[field] !== null
        && typeof participant[field] !== 'string' && typeof participant[field] !== 'number') {
        throw invalidEventAnalysis(`EVENT_ANALYSIS_PARTICIPANT_${index}_${field.toUpperCase()}_INVALID`);
      }
    }
    if (hasOwn(participant, 'event_role') && participant.event_role !== null
      && !allowedRoles.has(String(participant.event_role).trim())) {
      throw invalidEventAnalysis(`EVENT_ANALYSIS_PARTICIPANT_${index}_EVENT_ROLE_INVALID`);
    }
    const capabilities = participant.reproductive_capabilities_used
      ?? participant.reproductive_capabilities;
    if (capabilities !== undefined && (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities))) {
      throw invalidEventAnalysis(`EVENT_ANALYSIS_PARTICIPANT_${index}_CAPABILITIES_INVALID`);
    }
    if (capabilities) {
      for (const key of [...EVENT_CAPABILITY_KEYS, 'can_fertilize']) {
        if (hasOwn(capabilities, key)
          && capabilities[key] !== null
          && typeof capabilities[key] !== 'boolean') {
          throw invalidEventAnalysis(`EVENT_ANALYSIS_PARTICIPANT_${index}_${key.toUpperCase()}_INVALID`);
        }
      }
      for (const key of EVENT_CAPABILITY_KEYS) {
        if (!hasOwn(capabilities, key)
          && !(key === 'can_cause_pregnancy' && hasOwn(capabilities, 'can_fertilize'))) {
          throw invalidEventAnalysis(`EVENT_ANALYSIS_PARTICIPANT_${index}_${key.toUpperCase()}_REQUIRED`);
        }
      }
    }
    if (!Array.isArray(participant.evidence)) {
      throw invalidEventAnalysis(`EVENT_ANALYSIS_PARTICIPANT_${index}_EVIDENCE_ARRAY_REQUIRED`);
    }
    eventEvidence(participant.evidence, `participant_${index}_evidence`);
  });

  const storyTime = raw.story_time;
  if (storyTime === undefined || storyTime === null) return;
  if (typeof storyTime !== 'object' || Array.isArray(storyTime)) {
    throw invalidEventAnalysis('EVENT_ANALYSIS_STORY_TIME_INVALID');
  }
  for (const field of ['display', 'normalized', 'calendar_id', 'day_index', 'provider', 'precision', 'confidence']) {
    if (!hasOwn(storyTime, field)) {
      throw invalidEventAnalysis(`EVENT_ANALYSIS_STORY_TIME_${field.toUpperCase()}_REQUIRED`);
    }
  }
  if (hasOwn(storyTime, 'precision') && storyTime.precision !== null
    && (typeof storyTime.precision !== 'string' || !EVENT_STORY_TIME_PRECISIONS.has(storyTime.precision))) {
    throw invalidEventAnalysis('EVENT_ANALYSIS_STORY_TIME_PRECISION_INVALID');
  }
  for (const field of ['display', 'normalized', 'calendar_id', 'provider']) {
    if (hasOwn(storyTime, field) && storyTime[field] !== null
      && typeof storyTime[field] !== 'string' && typeof storyTime[field] !== 'number') {
      throw invalidEventAnalysis(`EVENT_ANALYSIS_STORY_TIME_${field.toUpperCase()}_INVALID`);
    }
  }
  for (const field of ['day_index', 'confidence']) {
    if (hasOwn(storyTime, field) && storyTime[field] !== null
      && (typeof storyTime[field] !== 'number' || !Number.isFinite(storyTime[field]))) {
      throw invalidEventAnalysis(`EVENT_ANALYSIS_STORY_TIME_${field.toUpperCase()}_INVALID`);
    }
  }
  const relevance = raw.pregnancy_relevance;
  if (relevance === undefined || relevance === null) return;
  if (typeof relevance !== 'object' || Array.isArray(relevance)) {
    throw invalidEventAnalysis('EVENT_ANALYSIS_PREGNANCY_RELEVANCE_INVALID');
  }
  for (const field of ['relevant', 'possible_conception', 'gestational_subject_ids', 'counterpart_ids', 'confidence']) {
    if (!hasOwn(relevance, field)) {
      throw invalidEventAnalysis(`EVENT_ANALYSIS_PREGNANCY_RELEVANCE_${field.toUpperCase()}_REQUIRED`);
    }
  }
  for (const field of ['relevant', 'possible_conception']) {
    if (hasOwn(relevance, field) && relevance[field] !== null && typeof relevance[field] !== 'boolean') {
      throw invalidEventAnalysis(`EVENT_ANALYSIS_${field.toUpperCase()}_INVALID`);
    }
  }
  for (const field of ['gestational_subject_ids', 'counterpart_ids']) {
    if (hasOwn(relevance, field) && !Array.isArray(relevance[field])) {
      throw invalidEventAnalysis(`EVENT_ANALYSIS_${field.toUpperCase()}_ARRAY_REQUIRED`);
    }
  }
  if (hasOwn(relevance, 'confidence') && relevance.confidence !== null
    && (typeof relevance.confidence !== 'number' || !Number.isFinite(relevance.confidence))) {
    throw invalidEventAnalysis('EVENT_ANALYSIS_PREGNANCY_RELEVANCE_CONFIDENCE_INVALID');
  }
  if (!Array.isArray(raw.source_evidence)) {
    throw invalidEventAnalysis('EVENT_ANALYSIS_SOURCE_EVIDENCE_ARRAY_REQUIRED');
  }
  eventEvidence(raw.source_evidence, 'source_evidence');
}

function normalizeEventStoryTime(value) {
  if (value === undefined || value === null) {
    return {
      display: null,
      normalized: null,
      calendar_id: null,
      day_index: null,
      provider: null,
      precision: 'unknown',
      confidence: null,
    };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidEventAnalysis('EVENT_ANALYSIS_STORY_TIME_INVALID');
  }
  const precision = value.precision === undefined || value.precision === null
    ? 'unknown'
    : eventText(value.precision, 'story_time_precision', {nullable: false});
  if (!EVENT_STORY_TIME_PRECISIONS.has(precision)) {
    throw invalidEventAnalysis('EVENT_ANALYSIS_STORY_TIME_PRECISION_INVALID');
  }
  let dayIndex = null;
  if (value.day_index !== undefined && value.day_index !== null) {
    if (typeof value.day_index !== 'number' || !Number.isInteger(value.day_index)) {
      throw invalidEventAnalysis('EVENT_ANALYSIS_STORY_TIME_DAY_INDEX_INVALID');
    }
    dayIndex = value.day_index;
  }
  return {
    display: eventText(value.display, 'story_time_display'),
    normalized: eventText(value.normalized, 'story_time_normalized'),
    calendar_id: eventText(value.calendar_id, 'story_time_calendar_id'),
    day_index: dayIndex,
    provider: eventText(value.provider, 'story_time_provider'),
    precision,
    confidence: eventConfidence(value.confidence, 'story_time_confidence'),
  };
}

function normalizeEventCapabilities(value) {
  if (value === undefined || value === null) {
    return Object.fromEntries(EVENT_CAPABILITY_KEYS.map(key => [key, null]));
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidEventAnalysis('EVENT_ANALYSIS_CAPABILITIES_INVALID');
  }
  return Object.fromEntries(EVENT_CAPABILITY_KEYS.map(key => {
    const alias = key === 'can_cause_pregnancy' ? value.can_fertilize : undefined;
    return [key, eventBoolean(value[key] ?? alias, key)];
  }));
}

function normalizeEventParticipant(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidEventAnalysis(`EVENT_ANALYSIS_PARTICIPANT_${index}_INVALID`);
  }
  const characterId = eventText(value.character_id, `participant_${index}_character_id`, {nullable: false});
  const displayName = eventText(value.display_name, `participant_${index}_display_name`);
  const role = eventText(value.event_role, `participant_${index}_event_role`) ?? 'unknown';
  const participant = {
    character_id: characterId,
    display_name: displayName,
    event_role: role,
    reproductive_capabilities_used: normalizeEventCapabilities(value.reproductive_capabilities_used),
    evidence: eventEvidence(value.evidence, `participant_${index}_evidence`),
  };
  if (value.biological_context !== undefined && value.biological_context !== null) {
    if (!value.biological_context || typeof value.biological_context !== 'object' || Array.isArray(value.biological_context)) {
      throw invalidEventAnalysis(`EVENT_ANALYSIS_PARTICIPANT_${index}_BIOLOGICAL_CONTEXT_INVALID`);
    }
    participant.biological_context = safeEventValue(value.biological_context);
  }
  return participant;
}

function normalizeEventPregnancyRelevance(value, participantIds) {
  if (value !== undefined && value !== null && (typeof value !== 'object' || Array.isArray(value))) {
    throw invalidEventAnalysis('EVENT_ANALYSIS_PREGNANCY_RELEVANCE_INVALID');
  }
  const source = value && typeof value === 'object' ? value : {};
  const gestationalSubjectIds = eventIdArray(source.gestational_subject_ids, 'gestational_subject_ids');
  const counterpartIds = eventIdArray(source.counterpart_ids, 'counterpart_ids');
  for (const id of [...gestationalSubjectIds, ...counterpartIds]) {
    if (!participantIds.has(id)) throw invalidEventAnalysis('EVENT_ANALYSIS_PARTICIPANT_REFERENCE_INVALID');
  }
  return {
    relevant: eventBoolean(source.relevant, 'pregnancy_relevance_relevant'),
    possible_conception: eventBoolean(source.possible_conception, 'possible_conception'),
    gestational_subject_ids: gestationalSubjectIds,
    counterpart_ids: counterpartIds,
    confidence: eventConfidence(source.confidence, 'pregnancy_relevance_confidence'),
  };
}

function authoritativeFloorVersion(value) {
  const candidate = value?.authoritative_floor_version
    ?? value?.authoritativeFloorVersion
    ?? value?.floor_version
    ?? value?.floorVersion
    ?? value?.analysisInput?.floor_version
    ?? value?.analysisInput?.floorVersion
    ?? value;
  const normalized = normalizeEventFloorVersion(candidate);
  for (const key of EVENT_SOURCE_KEYS) {
    if (normalized[key] === null || normalized[key] === undefined || normalized[key] === '') {
      throw invalidEventAnalysis(`EVENT_ANALYSIS_SOURCE_${key.toUpperCase()}_REQUIRED`);
    }
  }
  if (!Number.isInteger(normalized.floor) || normalized.floor < 0) {
    throw invalidEventAnalysis('EVENT_ANALYSIS_SOURCE_FLOOR_INVALID');
  }
  if (!Number.isInteger(normalized.swipe_id) || normalized.swipe_id < 0) {
    throw invalidEventAnalysis('EVENT_ANALYSIS_SOURCE_SWIPE_ID_INVALID');
  }
  return normalized;
}

function domainNormalizeEvent(raw) {
  if (typeof eventDomain.normalizeEvent !== 'function') return raw;
  try {
    return eventDomain.normalizeEvent(raw);
  } catch {
    throw invalidEventAnalysis();
  }
}

function domainValidateEvent(event) {
  if (typeof eventDomain.validateEvent !== 'function') return;
  try {
    const result = eventDomain.validateEvent(event);
    if (result === false || (result && result.ok === false)) throw invalidEventAnalysis();
  } catch (error) {
    if (error?.code === 'EVENT_ANALYSIS_INVALID') throw error;
    throw invalidEventAnalysis();
  }
}

function normalizeEventRecord(raw, source) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalidEventAnalysis('EVENT_ANALYSIS_EVENT_INVALID');
  validateRawEventShape(raw);
  const normalized = domainNormalizeEvent({...raw, source});
  const eventType = eventText(normalized.type, 'type', {nullable: false});
  const eventStatus = eventText(normalized.status, 'status', {nullable: false});
  const eventTypes = new Set(Array.isArray(eventDomain.EVENT_TYPES) ? eventDomain.EVENT_TYPES : EVENT_TYPES);
  const eventStatuses = new Set(Array.isArray(eventDomain.EVENT_STATUS) ? eventDomain.EVENT_STATUS : EVENT_STATUS);
  if (!eventTypes.has(eventType)) throw invalidEventAnalysis('EVENT_ANALYSIS_TYPE_INVALID');
  if (!eventStatuses.has(eventStatus)) throw invalidEventAnalysis('EVENT_ANALYSIS_STATUS_INVALID');
  if (!Array.isArray(normalized.participants)) throw invalidEventAnalysis('EVENT_ANALYSIS_PARTICIPANTS_ARRAY_REQUIRED');
  const participants = normalized.participants.map(normalizeEventParticipant);
  const participantIds = new Set(participants.map(item => item.character_id));
  const event = {
    event_id: eventText(normalized.event_id, 'event_id', {nullable: false}),
    type: eventType,
    status: eventStatus,
    story_time: normalizeEventStoryTime(normalized.story_time),
    location: eventText(normalized.location, 'location'),
    participants,
    pregnancy_relevance: normalizeEventPregnancyRelevance(normalized.pregnancy_relevance, participantIds),
    source_evidence: eventEvidence(normalized.source_evidence, 'source_evidence'),
    source: {...source},
    physical_effect: safeEventValue(normalized.physical_effect ?? {}),
  };
  domainValidateEvent(event);
  return event;
}

function eventPayload(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)
    && (hasOwn(raw, 'schema_version') || hasOwn(raw, 'events'))) {
    return raw;
  }
  const text = responseText(raw).trim();
  if (!text) throw invalidEventAnalysis();
  try {
    return JSON.parse(text);
  } catch {
    // Event extraction is stricter than the legacy World Model parser: no
    // fenced JSON or substring recovery is allowed at this boundary.
    throw invalidEventAnalysis();
  }
}

// Parse only the fixed Event response object. The second argument is the
// scheduler-owned Floor Version (or an object containing one); AI source data
// is never used as an identity fallback.
export function parseEventAnalysisResponse(raw, sourceOrOptions = {}) {
  const payload = eventPayload(raw);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalidEventAnalysis();
  const keys = Object.keys(payload);
  if (keys.some(key => !['schema_version', 'events'].includes(key))) throw invalidEventAnalysis();
  if (payload.schema_version !== EVENT_SCHEMA_VERSION || !Array.isArray(payload.events)) throw invalidEventAnalysis();
  const source = authoritativeFloorVersion(sourceOrOptions);
  const events = payload.events.map(event => normalizeEventRecord(event, source));
  return {schema_version: EVENT_SCHEMA_VERSION, events};
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

export function createAnalyzer({
  profileResolver,
  contextResolver,
  requestSettingsResolver,
  worldModelPromptResolver,
  onWorldModelTrace,
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
    const evidenceGuardedModel = applyWorldModelEvidenceGuard(model, input.analysisInput ?? input);
    const canonicalModel = applyWorldModelFinalConsistencyGuard(evidenceGuardedModel);
    emitWorldModelTrace(raw, model, canonicalModel);
    return canonicalModel;
  }

  async function analyzeFloor(input = {}) {
    const profile = profileResolver?.('event_analysis') ?? profileResolver?.('event');
    if (!profile) throw new Error('API_PROFILE_NOT_CONFIGURED');
    const analysisInput = input.analysisInput ?? input;
    const messages = buildEventAnalysisMessages(analysisInput);
    const raw = await callOpenAICompatible(profile, messages, requestOptions(input));
    return parseEventAnalysisResponse(raw, input);
  }

  return {
    analyzeWorldModel,
    analyzeWorld: analyzeWorldModel,
    analyzeFloor,
    generateProjection: input => run('projection', input),
  };
}
