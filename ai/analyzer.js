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
const HUMAN_SPECIES_NAMES = new Set(['人类', '人', 'human', 'humans']);
const DIRECT_AMBIGUOUS_TYPE = '性别模糊';
const FAMILIAR_TYPE_NAMES = new Set(['男性', '女性', '双性']);
const GENERIC_SPECIES_TYPE_SUFFIXES = Object.freeze(['族', '类', '种', '人', '修', '修士']);

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

function evidenceUnits(input) {
  return worldModelEvidenceText(input)
    .replace(COMPOSITE_DUAL_LABEL_PATTERN, '双性')
    // 保留逗号连接的同一语义单元，例如“剑灵性别基本都为男性，极少女剑灵”。
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

function speciesEvidenceAliases(speciesName) {
  const normalizedSpecies = compactEvidenceText(speciesName);
  if (normalizedSpecies === '妖') return ['妖族', '妖修', '妖兽', '妖怪', '妖类', '妖'];
  if (normalizedSpecies === '魔') return ['魔族', '天魔', '魔物', '魔'];
  if (normalizedSpecies === '剑灵') return ['剑灵'];
  return normalizedSpecies ? [normalizedSpecies] : [];
}

function matchesSpeciesAlias(text, alias) {
  if (alias.length > 1) return text.includes(alias);
  const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?:^|[\\s\\[\\]（）()<>：:、，,])${escapedAlias}(?=$|[\\s\\[\\]（）()<>：:、，,族类种性修兽怪])`, 'u').test(text);
}

function speciesEvidenceUnits(units, speciesName) {
  const aliases = speciesEvidenceAliases(speciesName);
  return units.filter(unit => {
    const compactUnit = compactEvidenceText(unit);
    return aliases.some(alias => matchesSpeciesAlias(compactUnit, alias));
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

  for (const alias of speciesEvidenceAliases(speciesName)) {
    let aliasStart = compactUnit.indexOf(alias);
    while (aliasStart >= 0) {
      const aliasEnd = aliasStart + alias.length;
      const contextStart = Math.min(aliasStart, typeStart);
      const contextEnd = Math.max(aliasEnd, typeEnd);
      const between = compactUnit.slice(Math.min(aliasEnd, typeEnd), Math.max(aliasStart, typeStart));
      const context = compactUnit.slice(Math.max(0, contextStart - 8), Math.min(compactUnit.length, contextEnd + 8));
      if (!externalHumanPattern.test(between)
        && !(interactionPattern.test(between) && !relationPattern.test(between))
        && !(individualPattern.test(context) && !relationPattern.test(between))) {
        if (between.length <= 6 || relationPattern.test(between)) return true;
      }
      aliasStart = compactUnit.indexOf(alias, aliasStart + 1);
    }
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

function hasBiologicalTypeEvidence(units, speciesName, typeName) {
  if (isHumanSpeciesName(speciesName)) {
    return units.some(unit => hasDirectTypeEvidence(unit, typeName));
  }
  return hasNonHumanTypeEvidence(units, speciesName, typeName);
}

function fieldEvidenceUnits(units, speciesName, typeName) {
  // 非人类字段始终需要当前 species + biological_type 的直接上下文。
  return typeEvidenceUnits(units, speciesName, typeName);
}

function isHumanSpeciesName(speciesName) {
  return HUMAN_SPECIES_NAMES.has(compactEvidenceText(speciesName).toLowerCase());
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
  const after = unit.slice((match.index ?? 0) + match[0].length).slice(0, 16);
  return EXPLICIT_NEGATIVE_CAPABILITY_PATTERN.test(match[0])
    || EXPLICIT_NEGATIVE_CAPABILITY_PATTERN.test(before)
    || EXPLICIT_NEGATIVE_CAPABILITY_PATTERN.test(after)
    || EXPLICIT_NEGATIVE_CAPABILITY_PATTERN.test(capabilityEvidenceContext(unit, match));
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

function sanitizeNonHumanType(type, units, speciesName) {
  const fieldUnits = fieldEvidenceUnits(units, speciesName, type.name);
  return {
    ...type,
    capabilities: Object.fromEntries(CAPABILITY_KEYS.map(key => [
      key,
      capabilityEvidenceValue(fieldUnits, CAPABILITY_EVIDENCE_PATTERNS[key]),
    ])),
    reproduction_rules: Object.fromEntries(WORLD_RULE_KEYS.map(key => [
      key,
      textEvidenceState(fieldUnits, REPRODUCTION_RULE_EVIDENCE_PATTERNS[key])
        ? type.reproduction_rules[key]
        : null,
    ])),
    lifecycle: Object.fromEntries(LIFECYCLE_KEYS.map(key => [
      key,
      textEvidenceState(fieldUnits, LIFECYCLE_EVIDENCE_PATTERNS[key])
        ? type.lifecycle[key]
        : null,
    ])),
    special_rules: type.special_rules.filter(rule => hasDirectRuleEvidence(rule, fieldUnits)),
  };
}

function normalizeAnalysisType(type, speciesName) {
  const name = normalizeBiologicalTypeName(type?.name, speciesName);
  return name === type?.name ? type : {...type, name};
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
  const normalizedSpecies = compactEvidenceText(speciesName);
  if (isSpeciesNameOrGenericDerivative(name, speciesName) || normalizedName === DIRECT_AMBIGUOUS_TYPE) return true;
  // Preserve the existing semantic exclusions for observed subtype/source labels.
  if (normalizedSpecies === '妖' && normalizedName === '半兽人') return true;
  if (normalizedSpecies === '剑灵' && ['妖剑剑灵', '魔剑灵'].includes(normalizedName)) return true;
  return false;
}

function isUnsupportedFamiliarType(name, speciesName, evidence) {
  if (!FAMILIAR_TYPE_NAMES.has(name)) return false;
  const units = evidenceUnits(evidence);
  if (isHumanSpeciesName(speciesName)) {
    if (name === '男性') return !hasLabelEvidenceInUnits(units, MALE_EVIDENCE_PATTERN);
    if (name === '女性') return !hasLabelEvidenceInUnits(units, FEMALE_EVIDENCE_PATTERN);
    return !hasFixedDualEvidenceInUnits(units);
  }
  return !hasNonHumanTypeEvidence(units, speciesName, name);
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

// AI 分析才经过证据边界；手动编辑保存的 World Model 只经过结构规范化。
function applyWorldModelEvidenceGuard(model, analysisInput) {
  const evidence = evidenceUnits(analysisInput);
  const hasFixedDual = hasFixedDualEvidenceInUnits(evidence);
  const species = [];
  for (const item of model.species) {
    const normalizedTypes = item.biological_types
      .map(type => normalizeAnalysisType(type, item.name))
      .filter(type => !isObservedNonBiologicalType(type.name, item.name));
    const humanSpecies = isHumanSpeciesName(item.name);
    const localFixedDual = humanSpecies ? hasFixedDual : hasNonHumanTypeEvidence(evidence, item.name, '双性');
    const supportedTypes = normalizedTypes
      .filter(type => !isUnsupportedFamiliarType(type.name, item.name, analysisInput))
      .filter(type => hasBiologicalTypeEvidence(evidence, item.name, type.name))
      .filter(type => localFixedDual || !isDualTypeName(type.name));
    const biologicalTypes = humanSpecies
      ? supportedTypes
      : supportedTypes.map(type => sanitizeNonHumanType(type, evidence, item.name));
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
const HUMAN_FEMALE_BASELINE_CYCLE_PATTERN = /(?:月经|经期|生理期|排卵周期|(?:约\s*)?(?:28|二十八)\s*(?:天|日)|(?:28|二十八)\s*[-－~～至到]?\s*day)/iu;

function fertilizationRoleFlags(value) {
  const text = String(value ?? '');
  return {
    recipient: FERTILIZATION_RECIPIENT_PATTERN.test(text),
    donor: FERTILIZATION_DONOR_PATTERN.test(text),
  };
}

function isGenericHumanFertilizationRule(value) {
  const text = String(value ?? '')
    .replace(/\s+/gu, '')
    .replace(/[。！？!?]/gu, '');
  return /^(?:通常|一般|人类通常|按人类方式)?(?:为|是)?(?:体内)?受精(?:方式|机制)?$/u.test(text);
}

function hasFertilizationMechanism(value) {
  return REPRODUCTION_RULE_EVIDENCE_PATTERNS.fertilization.test(String(value ?? ''));
}

function humanBaselineRole(type, speciesName) {
  if (!isHumanSpeciesName(speciesName)) return null;
  const capabilities = type.capabilities ?? {};
  if (type.name === '男性'
    && capabilities.can_be_fertilized === false
    && capabilities.can_fertilize === true) {
    return 'donor';
  }
  if (type.name === '女性'
    && capabilities.can_be_fertilized === true
    && capabilities.can_fertilize === false) {
    return 'recipient';
  }
  return null;
}

function applyWorldModelFinalConsistencyGuard(model) {
  return {
    ...model,
    species: model.species.map(species => ({
      ...species,
      biological_types: species.biological_types.map(type => {
        const capabilities = type.capabilities ?? {};
        const reproductionRules = {...(type.reproduction_rules ?? {})};
        const baselineRole = humanBaselineRole(type, species.name);

        if (reproductionRules.fertilization && !hasFertilizationMechanism(reproductionRules.fertilization)) {
          reproductionRules.fertilization = null;
        }

        if (baselineRole && isGenericHumanFertilizationRule(reproductionRules.fertilization)) {
          reproductionRules.fertilization = baselineRole === 'donor'
            ? '通过精子使卵细胞受精。'
            : '卵细胞可被精子受精。';
        }
        if (baselineRole === 'donor'
          && HUMAN_FEMALE_BASELINE_CYCLE_PATTERN.test(String(reproductionRules.cycle ?? ''))) {
          reproductionRules.cycle = null;
        }

        if (capabilities.can_produce_ova === false) reproductionRules.ovulation = null;
        if (capabilities.can_carry_pregnancy === false) {
          reproductionRules.pregnancy_or_carrying = null;
          reproductionRules.gestation = null;
          reproductionRules.labor = null;
        }

        if (reproductionRules.fertilization) {
          const roles = fertilizationRoleFlags(reproductionRules.fertilization);
          const roleConflict = (capabilities.can_be_fertilized === false && roles.recipient)
            || (capabilities.can_fertilize === false && roles.donor)
            || (!roles.recipient && !roles.donor
              && (capabilities.can_be_fertilized === false || capabilities.can_fertilize === false));
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
    const evidenceGuardedModel = applyWorldModelEvidenceGuard(model, input.analysisInput ?? input);
    return applyWorldModelFinalConsistencyGuard(evidenceGuardedModel);
  }

  return {
    analyzeWorldModel,
    analyzeWorld: analyzeWorldModel,
    analyzeFloor: input => run('event', input),
    generateProjection: input => run('projection', input),
  };
}
