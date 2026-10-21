const CONCEPT_DEFINITIONS = [
  ['fatigue', 14, 20, /(?:疲倦|疲劳|乏力|嗜睡|困倦)/u, /(?:只是睡觉|单纯睡觉|注意力变化)/u],
  ['breast_sensitivity', 14, 20, /(?:乳房|胸部)(?:[^，。；;]{0,8})(?:敏感|胀痛|胀|触碰.*不适)/u, /(?:普通胸口疼|衣物摩擦但部位不明确)/u],
  ['scent_food_change', 14, 20, /(?:气味|食物)(?:[^，。；;]{0,10})(?:偏好|喜好|变化|不适)/u, /(?:已经达到恶心|呕吐)(?![^，。；;]{0,6}(?:偏好|喜好|变化))/u],
  ['nausea', 21, 27, /(?:恶心|反胃|作呕)/u, /(?:没有|未|尚未|不曾|担心|可能|也许|预计|将会)[^，。；;]{0,8}(?:恶心|反胃|作呕)/u],
  ['odor_discomfort', 21, 27, /(?:闻到|气味|油烟|香气)(?:[^，。；;]{0,12})(?:不舒服|反胃|恶心|回避|避开)/u, /(?:没有|未|尚未|可能|担心)[^，。；;]{0,10}(?:气味|闻到)/u],
  ['mood_change', 21, 27, /(?:情绪波动|情绪变化|易怒|易哭|情绪不稳)/u, /(?:别人|他人|另一个人物|其他人物|对方)(?:[^，。；;]{0,8})(?:情绪|易怒|易哭)/u],
  ['appetite_change', 21, 27, /(?:食欲[^，。；;]{0,4}(?:不振|增加|下降|变化)|食量(?:增加|减少|变化)|吃得(?:少|多))/u, /(?:因为没有食物|没有东西吃|单次没吃)/u],
  ['nausea_worsening', 28, 42, /(?:比之前|越来越|持续|不断|明显)(?:[^，。；;]{0,6})(?:恶心|反胃)(?:[^，。；;]{0,6})(?:加重|严重|频繁|明显)?|恶心(?:加重|恶化|越来越明显|持续恶化)/u, /(?:单次|一次)(?:[^，。；;]{0,6})(?:剧烈|严重)(?:恶心|反胃)/u],
  ['vomiting', 28, 42, /(?:呕吐|吐出(?:内容物|东西)?|孕吐)/u, /(?:干呕|作呕)(?:[^，。；;]{0,8})(?:未吐|没有吐|但没吐)/u],
  ['persistent_fatigue', 28, 42, /(?:持续|多日|反复|一直|休息后仍)(?:[^，。；;]{0,8})(?:疲倦|疲劳|乏力|嗜睡|困倦)|(?:疲倦|疲劳|乏力)(?:[^，。；;]{0,8})(?:持续|多日|反复|一直|休息后仍)/u, /(?:单次|刚睡醒)(?:[^，。；;]{0,6})(?:疲倦|疲劳|乏力)/u],
];

export const PROJECTION_REACTION_CONCEPTS = Object.freeze(CONCEPT_DEFINITIONS.map(([key, min, max]) => Object.freeze({
  key,
  min_elapsed_story_days: min,
  max_elapsed_story_days: max,
})));

const DEFINITIONS = new Map(CONCEPT_DEFINITIONS.map(([key, min, max, positive, exclusion]) => [key, {key, min, max, positive, exclusion}]));
const STRUCTURED_KINDS = new Map(PROJECTION_REACTION_CONCEPTS.map(({key}) => [key, key]));
const NEGATIVE_OR_UNCERTAIN = /(?:没有|未|尚未|不曾|并未|未出现|未发生|可能|也许|担心|预计|将会|会出现)[^，。；;]{0,10}(?:疲倦|疲劳|乏力|嗜睡|乳房|胸部|气味|食物|恶心|反胃|作呕|情绪|食欲|食量|呕吐|孕吐)/u;
const OTHER_PERSON = /(?:另一个人物|另一个人|其他人物|其他人|别人|他人|对方)(?:[^，。；;]{0,12})(?:疲倦|疲劳|乏力|嗜睡|乳房|胸部|气味|食物|恶心|反胃|作呕|情绪|食欲|食量|呕吐|孕吐)/u;

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function descriptionOf(event) {
  const symptom = record(record(event?.state_fact).payload).symptom;
  return typeof symptom?.description === 'string' ? symptom.description.trim() : '';
}

function semanticClauses(value) {
  return (typeof value === 'string' ? value : '')
    .split(/[，。；;！？!?]|(?:但是|可是|然而|不过|却|但)/u)
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeConceptPrecedence(concepts) {
  const unique = [...new Set(concepts)];
  if (unique.includes('nausea_worsening')) return unique.filter(concept => concept !== 'nausea');
  if (unique.includes('persistent_fatigue')) return unique.filter(concept => concept !== 'fatigue');
  return unique;
}

function conceptsFromText(value) {
  const source = typeof value === 'string' ? value.trim() : '';
  if (!source) return [];
  const concepts = semanticClauses(source).flatMap(clause => {
    // Negation, uncertainty, and another-person references only invalidate
    // concepts in their own clause. A later explicit observation must remain
    // available, e.g. “没有呕吐，但恶心且食欲不振”.
    if (NEGATIVE_OR_UNCERTAIN.test(clause) || OTHER_PERSON.test(clause)) return [];
    return CONCEPT_DEFINITIONS
      .filter(([key, , , positive, exclusion]) => positive.test(clause) && !exclusion?.test(clause))
      .map(([key]) => key);
  });
  return normalizeConceptPrecedence(concepts);
}

export function reactionConceptDefinition(concept) {
  const definition = DEFINITIONS.get(concept);
  return definition ? {...definition} : null;
}

export function extractObservedReactionConcepts(event) {
  if (event?.type !== 'physical_symptom'
    || event?.status !== 'confirmed'
    || !event?.state_fact?.subject_id
    || event?.state_fact?.payload?.symptom?.health_role !== 'observation'
    || !Array.isArray(event?.source_evidence)
    || event.source_evidence.length === 0) {
    return {concepts: [], evidence_modes: [], reason_code: 'INELIGIBLE_EVENT'};
  }
  const symptom = record(record(event?.state_fact).payload).symptom;
  const structuredKind = STRUCTURED_KINDS.get(symptom?.kind);
  const description = descriptionOf(event);
  const concepts = new Set();
  const evidenceModes = [];
  if (structuredKind && !(symptom?.description && (NEGATIVE_OR_UNCERTAIN.test(description) || OTHER_PERSON.test(description)))) {
    concepts.add(structuredKind);
    evidenceModes.push('STRUCTURED_KIND');
  }
  for (const concept of conceptsFromText(description)) {
    concepts.add(concept);
    if (!evidenceModes.includes('STRUCTURED_DESCRIPTION')) evidenceModes.push('STRUCTURED_DESCRIPTION');
  }
  const finalConcepts = normalizeConceptPrecedence([...concepts]);
  return {
    concepts: finalConcepts.sort(),
    evidence_modes: evidenceModes,
    reason_code: finalConcepts.length > 0 ? 'REACTION_CONCEPTS_EXTRACTED' : 'NO_EXPLICIT_REACTION',
  };
}

export function resolveProjectionReactionConcept(projectionView) {
  const concern = typeof projectionView?.development_concern_key === 'string'
    ? projectionView.development_concern_key
    : '';
  const prefix = 'pre_confirmation_observation:';
  const branch = concern.startsWith(prefix) ? concern.slice(prefix.length) : '';
  if (branch) {
    if (DEFINITIONS.has(branch)) {
      return {concept: branch, source: 'BRANCH_KEY', reason_code: 'BUILT_IN_BRANCH_CONCEPT'};
    }
  }
  if (projectionView?.tracking_scope !== 'pre_confirmation') {
    return {concept: null, source: 'NONE', reason_code: 'NOT_PRE_CONFIRMATION'};
  }
  const text = [projectionView?.rule?.label, projectionView?.rule?.description, projectionView?.generated_statement]
    .filter(value => typeof value === 'string' && value.trim())
    .join('；');
  const concepts = conceptsFromText(text);
  if (concepts.length !== 1) {
    return {concept: null, source: 'TEXT', reason_code: concepts.length > 1 ? 'AMBIGUOUS_PROJECTION_CONCEPT' : 'NO_PROJECTION_CONCEPT'};
  }
  return {concept: concepts[0], source: 'TEXT', reason_code: 'UNIQUE_PROJECTION_TEXT_CONCEPT'};
}
