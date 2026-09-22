import {differenceStoryTime} from '../story/time.js';
import {deterministicDigest, PROJECTION_DEVELOPMENT_KINDS, PROJECTION_TRIGGER_KINDS, isProjectionEligible} from './projection.js';

export const PROJECTION_RULE_SCHEMA_VERSION = 1;
export const PROJECTION_DECISION_STATUSES = Object.freeze(['eligible', 'not_eligible', 'unresolved']);
export const PROJECTION_EVOLUTION_DECISIONS = Object.freeze(['keep_active', 'realized', 'contradicted', 'expired', 'unresolved']);

const RULE_FIELDS = new Set(['schema_version', 'projection_rule_id', 'mechanism_key', 'development_concern_key', 'development_kind', 'trigger', 'requirements', 'realization', 'contradiction', 'expiration']);
const RAW_RULE_FIELDS = new Set(['schema_version', 'mechanism_key', 'development_concern_key', 'development_kind', 'trigger', 'requirements', 'realization', 'contradiction', 'expiration']);
const TRIGGER_FIELDS = new Set(['kind', 'source_event_type', 'reference_event_id', 'min_elapsed_story_days', 'target_story_time']);
const REQUIREMENT_FIELDS = new Set(['capabilities', 'source_compatibility', 'contributor_relationships']);
const CAPABILITY_FIELDS = new Set(['key', 'equals']);
const RELATIONSHIP_FIELDS = new Set(['relationship_key', 'attribution']);
const CRITERIA_FIELDS = new Set(['event_types', 'statuses', 'payload_equals']);
const FORBIDDEN_KEYS = new Set(['probability', 'weight', 'rng', 'random', 'seed', 'prompt', 'raw_prompt', 'raw_response', 'raw_ai_output', 'code', 'expression', 'script', 'callback', 'function', 'eval', 'pregnancy_id', 'pregnancy_outcome', 'no_pregnancy', 'outcome']);

function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function clone(value) { if (value === undefined || value === null || typeof value !== 'object') return value; return structuredClone(value); }
function text(value) { return typeof value === 'string' && value.trim() !== ''; }
function textArray(value, required = false) { return Array.isArray(value) && (!required || value.length > 0) && value.every(text) && new Set(value).size === value.length; }
function stable(value) { if (Array.isArray(value)) return value.map(stable); if (!isRecord(value)) return value; return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])); }
function fingerprint(value) { return JSON.stringify(stable(value)); }
function collectUnexpected(errors, value, allowed, path) { if (!isRecord(value)) return; for (const key of Object.keys(value)) { if (FORBIDDEN_KEYS.has(key)) errors.push(`${path}.${key}:forbidden_field`); else if (!allowed.has(key)) errors.push(`${path}.${key}:unexpected_field`); } }
function rejectExecutableValues(errors, value, path = 'projection_rule') {
  if (typeof value === 'function') { errors.push(`${path}:executable_value`); return; }
  if (Array.isArray(value)) { value.forEach((item, index) => rejectExecutableValues(errors, item, `${path}[${index}]`)); return; }
  if (!isRecord(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) errors.push(`${path}.${key}:forbidden_field`);
    rejectExecutableValues(errors, item, `${path}.${key}`);
  }
}
function validateTriggerShape(value, path, errors) { if (!isRecord(value)) { errors.push(`${path}:invalid`); return; } collectUnexpected(errors, value, TRIGGER_FIELDS, path); if (!PROJECTION_TRIGGER_KINDS.includes(value.kind)) errors.push(`${path}.kind:invalid`); if (value.source_event_type !== undefined && value.source_event_type !== null && !text(value.source_event_type)) errors.push(`${path}.source_event_type:invalid`); if (value.reference_event_id !== undefined && value.reference_event_id !== null && !text(value.reference_event_id)) errors.push(`${path}.reference_event_id:invalid`); if (value.min_elapsed_story_days !== undefined && (!Number.isFinite(Number(value.min_elapsed_story_days)) || Number(value.min_elapsed_story_days) < 0)) errors.push(`${path}.min_elapsed_story_days:invalid`); }
function validateCriteria(value, path, errors) { if (value === undefined || value === null) return; if (!isRecord(value)) { errors.push(`${path}:invalid`); return; } collectUnexpected(errors, value, CRITERIA_FIELDS, path); if (value.event_types !== undefined && !textArray(value.event_types)) errors.push(`${path}.event_types:invalid`); if (value.statuses !== undefined && !textArray(value.statuses)) errors.push(`${path}.statuses:invalid`); if (value.payload_equals !== undefined && !isRecord(value.payload_equals)) errors.push(`${path}.payload_equals:invalid`); }

function validateProjectionRuleShape(value, {requireIdentity = true, forbidIdentity = false} = {}) {
  const errors = [];
  if (!isRecord(value)) return {ok: false, errors: ['projection_rule:invalid']};
  rejectExecutableValues(errors, value);
  collectUnexpected(errors, value, forbidIdentity ? RAW_RULE_FIELDS : RULE_FIELDS, 'projection_rule');
  if (value.schema_version !== PROJECTION_RULE_SCHEMA_VERSION) errors.push('projection_rule.schema_version:invalid');
  if (requireIdentity && !text(value.projection_rule_id)) errors.push('projection_rule.projection_rule_id:required');
  if (forbidIdentity && Object.hasOwn(value, 'projection_rule_id')) errors.push('projection_rule.projection_rule_id:forbidden_raw_field');
  if (!text(value.mechanism_key)) errors.push('projection_rule.mechanism_key:required');
  if (!text(value.development_concern_key)) errors.push('projection_rule.development_concern_key:required');
  if (!PROJECTION_DEVELOPMENT_KINDS.includes(value.development_kind)) errors.push('projection_rule.development_kind:invalid');
  validateTriggerShape(value.trigger, 'projection_rule.trigger', errors);
  if (value.requirements !== undefined) {
    if (!isRecord(value.requirements)) errors.push('projection_rule.requirements:invalid');
    else {
      collectUnexpected(errors, value.requirements, REQUIREMENT_FIELDS, 'projection_rule.requirements');
      if (value.requirements.capabilities !== undefined) {
        if (!Array.isArray(value.requirements.capabilities)) errors.push('projection_rule.requirements.capabilities:invalid');
        else value.requirements.capabilities.forEach((item, index) => { collectUnexpected(errors, item, CAPABILITY_FIELDS, `projection_rule.requirements.capabilities[${index}]`); if (!text(item?.key) || ![true, false, null].includes(item?.equals)) errors.push(`projection_rule.requirements.capabilities[${index}]:invalid`); });
      }
      if (value.requirements.source_compatibility !== undefined && !['required_true', 'allow_null', 'not_required'].includes(value.requirements.source_compatibility)) errors.push('projection_rule.requirements.source_compatibility:invalid');
      if (value.requirements.contributor_relationships !== undefined) {
        if (!Array.isArray(value.requirements.contributor_relationships)) errors.push('projection_rule.requirements.contributor_relationships:invalid');
        else value.requirements.contributor_relationships.forEach((item, index) => { collectUnexpected(errors, item, RELATIONSHIP_FIELDS, `projection_rule.requirements.contributor_relationships[${index}]`); if (!text(item?.relationship_key) || !['confirmed', 'excluded'].includes(item?.attribution)) errors.push(`projection_rule.requirements.contributor_relationships[${index}]:invalid`); });
      }
    }
  }
  validateCriteria(value.realization, 'projection_rule.realization', errors);
  validateCriteria(value.contradiction, 'projection_rule.contradiction', errors);
  if (value.expiration !== undefined && value.expiration !== null) { if (!isRecord(value.expiration)) errors.push('projection_rule.expiration:invalid'); else validateTriggerShape(value.expiration.trigger, 'projection_rule.expiration.trigger', errors); }
  return {ok: errors.length === 0, errors};
}
export function validateProjectionRule(value) { return validateProjectionRuleShape(value); }
export function validateProjectionRuleContent(value) { return validateProjectionRuleShape(value, {requireIdentity: false, forbidIdentity: true}); }

function normalizeCriteria(value) {
  if (!value) return null;
  return {
    ...clone(value),
    event_types: [...(value.event_types ?? [])].sort(),
    statuses: [...(value.statuses ?? [])].sort(),
    payload_equals: value.payload_equals ? stable(value.payload_equals) : undefined,
  };
}
export function normalizeProjectionRule(value) {
  return {
    ...clone(value),
    requirements: {
      capabilities: [...(value.requirements?.capabilities ?? [])].map(item => ({key: item.key, equals: item.equals})).sort((left, right) => left.key.localeCompare(right.key)),
      source_compatibility: value.requirements?.source_compatibility ?? 'not_required',
      contributor_relationships: [...(value.requirements?.contributor_relationships ?? [])].map(item => ({relationship_key: item.relationship_key, attribution: item.attribution})).sort((left, right) => left.relationship_key.localeCompare(right.relationship_key) || left.attribution.localeCompare(right.attribution)),
    },
    realization: normalizeCriteria(value.realization),
    contradiction: normalizeCriteria(value.contradiction),
    expiration: value.expiration ? {trigger: clone(value.expiration.trigger)} : null,
  };
}
function normalizedRule(value) { return normalizeProjectionRule(value); }
const RULE_ID_FIELDS = Object.freeze(['schema_version', 'mechanism_key', 'development_concern_key', 'development_kind', 'trigger', 'requirements', 'realization', 'contradiction', 'expiration']);
function ruleIdentityMaterial(value) { const normalized = normalizeProjectionRule(value); return Object.fromEntries(RULE_ID_FIELDS.map(key => [key, normalized[key]])); }
export function buildProjectionRuleId(value) {
  return `projection_rule_${deterministicDigest(ruleIdentityMaterial(value))}`;
}
export function normalizeProjectionRules(value, {allowGeneratedIdentity = true} = {}) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new TypeError('projection_rules must be an array');
  const byId = new Map();
  for (const [index, item] of value.entries()) {
    const hasIdentity = Object.hasOwn(item ?? {}, 'projection_rule_id');
    const validation = hasIdentity && allowGeneratedIdentity
      ? validateProjectionRule(item)
      : validateProjectionRuleContent(item);
    if (!validation.ok) {
      const errors = validation.errors.map((error) =>
        error.replace(/^projection_rule(?=\.|:)/u, `projection_rules[${index}]`),
      );
      throw new TypeError(errors.join(', '));
    }
    const normalizedContent = normalizeProjectionRule(item);
    const generatedId = buildProjectionRuleId(normalizedContent);
    if (hasIdentity && normalizedContent.projection_rule_id !== generatedId) throw new TypeError(`projection_rule_id_mismatch:${normalizedContent.projection_rule_id}`);
    const normalized = {...normalizedContent, projection_rule_id: generatedId};
    const previous = byId.get(normalized.projection_rule_id);
    if (previous && fingerprint(previous) !== fingerprint(normalized)) throw new TypeError(`projection_rule_conflict:${normalized.projection_rule_id}`);
    if (!validateProjectionRule(normalized).ok)
      throw new TypeError(`projection_rules[${index}]:generated_identity_invalid`);
    byId.set(normalized.projection_rule_id, normalized);
  }
  return [...byId.values()].sort((left, right) => left.projection_rule_id.localeCompare(right.projection_rule_id)).map(clone);
}
function rulesFrom(worldModel) { return Array.isArray(worldModel?.projection_rules) ? worldModel.projection_rules : []; }
function eventsForSubject(events, subjectId) { return (Array.isArray(events) ? events : []).filter(event => event?.pregnancy_relevance?.relevant === true && event.pregnancy_relevance.gestational_subject_ids?.includes(subjectId)); }
function mechanismMatches(event, mechanismKey) { return event?.pregnancy_relevance?.reproductive_mechanism?.kind === mechanismKey; }
function candidateMatches(candidate, subjectId, mechanismKey) { return candidate?.subject_id === subjectId && candidate?.mechanism_key === mechanismKey; }
function subjectIds(events, state, candidates) { return [...new Set([...Object.keys(state?.characters ?? {}), ...(Array.isArray(events) ? events.flatMap(event => event?.pregnancy_relevance?.gestational_subject_ids ?? []) : []), ...(Array.isArray(candidates) ? candidates.map(item => item.subject_id) : [])])].filter(text).sort(); }
function orderedEvents(events) { return [...events].sort((left, right) => Number(left?.story_time?.day_index ?? Number.POSITIVE_INFINITY) - Number(right?.story_time?.day_index ?? Number.POSITIVE_INFINITY) || String(left?.event_id ?? '').localeCompare(String(right?.event_id ?? ''))); }
function evidenceFor(events, candidates, subjectId, mechanismKey) { const eventIds = [...events.map(event => event.event_id), ...candidates.flatMap(candidate => candidate.source_event_ids ?? [])].filter(text); const refs = [...eventIds.map(id => `event:${id}`), ...candidates.map(candidate => `candidate:${candidate.source_character_id}:${candidate.contribution_kind}`), `mechanism:${mechanismKey}`]; return {source_event_ids: [...new Set(eventIds)].sort(), evidence_refs: [...new Set(refs)].sort()}; }
function evaluateCapabilities(rule, character) { for (const requirement of rule.requirements.capabilities) { const actual = character?.reproductive_capabilities?.[requirement.key]; if (actual === undefined) return {status: 'unresolved', reason_code: 'required_capability_missing'}; if (actual === null) return {status: 'unresolved', reason_code: 'required_capability_unknown'}; if (actual !== requirement.equals) return {status: 'not_eligible', reason_code: 'required_capability_incompatible'}; } return null; }
function evaluateCandidates(rule, candidates) { if (rule.requirements.source_compatibility === 'not_required') return null; if (!candidates.length) return {status: 'unresolved', reason_code: 'source_candidate_missing'}; if (candidates.some(candidate => candidate.compatibility === true)) return null; if (candidates.some(candidate => candidate.compatibility === null)) return {status: 'unresolved', reason_code: 'source_compatibility_unknown'}; return {status: 'not_eligible', reason_code: 'source_compatibility_incompatible'}; }
function evaluateContributorRequirements(rule, character) { for (const requirement of rule.requirements.contributor_relationships) { const conflict = character?.pregnancy?.episodes ? Object.values(character.pregnancy.episodes).some(episode => episode.contributors?.conflicts?.some(item => item.relationship_key === requirement.relationship_key)) : false; if (conflict) return {status: 'unresolved', reason_code: 'contributor_attribution_conflict'}; const found = Object.values(character?.pregnancy?.episodes ?? {}).some(episode => episode.contributors?.[requirement.attribution === 'confirmed' ? 'confirmed' : 'excluded']?.some(item => item.relationship_key === requirement.relationship_key)); if (!found) return {status: 'unresolved', reason_code: 'required_contributor_unresolved'}; } return null; }
function ruleTrigger(rule, event) { const trigger = {...rule.trigger, development_kind: rule.development_kind}; if (['immediate_after_event', 'elapsed_after_event'].includes(trigger.kind)) trigger.reference_event_id = event.event_id; return {schema_version: 1, ...trigger}; }
function triggerResult(rule, matchingEvents, currentStoryTime) { if (!matchingEvents.length && rule.trigger.kind !== 'story_time_reached') return {status: 'not_eligible', reason_code: 'required_exposure_missing'}; const candidates = matchingEvents.length ? matchingEvents : [null]; const results = candidates.map(event => isProjectionEligible({trigger: ruleTrigger(rule, event ?? {}), referenceEvent: event, currentStoryTime})); if (results.some(result => result.eligible)) { const index = results.findIndex(result => result.eligible); return {status: 'eligible', reason_code: results[index].reason, reference_event_id: candidates[index]?.event_id ?? null}; } if (results.some(result => result.status === 'unresolved')) return {status: 'unresolved', reason_code: results.find(result => result.status === 'unresolved').reason}; return {status: 'not_eligible', reason_code: results[0]?.reason ?? 'trigger_not_met'}; }
function existingProjection(projections, subjectId, rule) { return (Array.isArray(projections) ? projections : []).find(item => item?.subject_id === subjectId && item.projection_rule_id === rule.projection_rule_id && item.development_concern_key === rule.development_concern_key) ?? null; }

export function evaluateProjectionEligibility({currentState = {}, events = [], sourceCandidates = [], worldModel = {}, currentStoryTime = null, existingProjections = []} = {}) {
  const rawRules = rulesFrom(worldModel); if (!rawRules.length) return {decisions: [], diagnostics: [{code: 'projection_rules_unavailable'}]};
  const rules = []; const seenRules = new Map(); const diagnostics = [];
  for (const rawRule of rawRules) { const previous = seenRules.get(rawRule?.projection_rule_id); if (previous) { if (fingerprint(previous) !== fingerprint(rawRule)) diagnostics.push({code: 'projection_rule_conflict', projection_rule_id: rawRule?.projection_rule_id ?? null}); continue; } seenRules.set(rawRule?.projection_rule_id, rawRule); rules.push(rawRule); }
  const decisions = [];
  for (const rawRule of rules) {
    const validation = validateProjectionRule(rawRule); if (!validation.ok) { diagnostics.push({code: 'invalid_projection_rule', projection_rule_id: rawRule?.projection_rule_id ?? null, detail: validation.errors.join('|')}); continue; }
    const rule = normalizedRule(rawRule);
    for (const subjectId of subjectIds(events, currentState, sourceCandidates)) {
      const allSubjectEvents = eventsForSubject(events, subjectId); const matchingEvents = orderedEvents(allSubjectEvents.filter(event => mechanismMatches(event, rule.mechanism_key) && (!rule.trigger.source_event_type || event.type === rule.trigger.source_event_type))); const matchingCandidates = (Array.isArray(sourceCandidates) ? sourceCandidates : []).filter(candidate => candidateMatches(candidate, subjectId, rule.mechanism_key)); const evidence = evidenceFor(matchingEvents, matchingCandidates, subjectId, rule.mechanism_key); const checks = [triggerResult(rule, matchingEvents, currentStoryTime), evaluateCapabilities(rule, currentState.characters?.[subjectId]), evaluateCandidates(rule, matchingCandidates), evaluateContributorRequirements(rule, currentState.characters?.[subjectId])].filter(Boolean); const notEligible = checks.find(check => check.status === 'not_eligible'); const unresolved = checks.find(check => check.status === 'unresolved'); const result = notEligible ?? unresolved ?? checks[0] ?? {status: 'unresolved', reason_code: 'rule_unresolved'}; const existing = existingProjection(existingProjections, subjectId, rule); decisions.push({subject_id: subjectId, projection_rule_id: rule.projection_rule_id, development_concern_key: rule.development_concern_key, development_kind: rule.development_kind, eligibility: result.status, reason_code: result.reason_code, source_event_ids: evidence.source_event_ids, evidence_refs: evidence.evidence_refs, existing_projection_id: existing?.projection_id ?? null, reference_event_id: result.reference_event_id ?? null});
    }
  }
  decisions.sort((left, right) => left.subject_id.localeCompare(right.subject_id) || left.projection_rule_id.localeCompare(right.projection_rule_id) || left.development_concern_key.localeCompare(right.development_concern_key));
  return {decisions, diagnostics};
}

function criteriaMatch(event, criteria) { if (!criteria) return false; if (criteria.event_types?.length && !criteria.event_types.includes(event.type)) return false; if (criteria.statuses?.length && !criteria.statuses.includes(event.status)) return false; if (criteria.payload_equals && Object.entries(criteria.payload_equals).some(([key, value]) => event.state_fact?.payload?.[key] !== value)) return false; return true; }
function factualEvidence(events, criteria, subjectId) { return (Array.isArray(events) ? events : []).filter(event => (event.state_fact?.subject_id === subjectId || event.pregnancy_relevance?.gestational_subject_ids?.includes(subjectId)) && event.status === 'confirmed' && criteriaMatch(event, criteria)); }
function expirationResult(rule, events, currentStoryTime, subjectId) { if (!rule.expiration?.trigger) return {status: 'not_eligible'}; const candidates = orderedEvents((Array.isArray(events) ? events : []).filter(event => (event.pregnancy_relevance?.gestational_subject_ids?.includes(subjectId) || event.state_fact?.subject_id === subjectId) && (!rule.expiration.trigger.source_event_type || event.type === rule.expiration.trigger.source_event_type))); if (!candidates.length) return {status: 'unresolved', reason_code: 'expiration_reference_missing'}; const results = candidates.map(event => isProjectionEligible({trigger: {...rule.expiration.trigger, schema_version: 1, development_kind: rule.development_kind, reference_event_id: event.event_id}, referenceEvent: event, currentStoryTime})); if (results.some(result => result.eligible)) return {status: 'eligible', reason_code: 'expiration_window_ended'}; if (results.some(result => result.status === 'unresolved')) return {status: 'unresolved', reason_code: results.find(result => result.status === 'unresolved').reason}; return {status: 'not_eligible'}; }

export function evaluateProjectionEvolution({projection, currentView = projection, currentState = {}, events = [], worldModel = {}, currentStoryTime = null} = {}) {
  if (!isRecord(projection)) return {decision: 'unresolved', reason_code: 'projection_missing', evidence_event_ids: []};
  if (currentView?.deleted) return {decision: 'unresolved', reason_code: 'projection_deleted', evidence_event_ids: []};
  if (['realized', 'contradicted', 'expired'].includes(currentView?.factual_status)) return {decision: currentView.factual_status, reason_code: 'already_terminal', evidence_event_ids: []};
  const rule = rulesFrom(worldModel).find(item => item?.projection_rule_id === projection.projection_rule_id && item?.development_concern_key === projection.development_concern_key); const validation = validateProjectionRule(rule); if (!validation.ok) return {decision: 'unresolved', reason_code: 'projection_rule_unavailable', evidence_event_ids: []};
  const normalized = normalizedRule(rule); const subjectCharacter = currentState.characters?.[projection.subject_id]; const contributorResult = evaluateContributorRequirements(normalized, subjectCharacter); if (contributorResult?.status === 'unresolved') return {decision: 'unresolved', reason_code: contributorResult.reason_code, evidence_event_ids: []}; const realization = factualEvidence(events, normalized.realization, projection.subject_id); const contradiction = factualEvidence(events, normalized.contradiction, projection.subject_id); if (realization.length && contradiction.length) return {decision: 'unresolved', reason_code: 'factual_evolution_conflict', evidence_event_ids: [...new Set([...realization, ...contradiction].map(event => event.event_id))].sort()}; if (realization.length) return {decision: 'realized', reason_code: 'realization_criteria_met', evidence_event_ids: realization.map(event => event.event_id).sort()}; if (contradiction.length) return {decision: 'contradicted', reason_code: 'contradiction_criteria_met', evidence_event_ids: contradiction.map(event => event.event_id).sort()}; const expiration = expirationResult(normalized, events, currentStoryTime, projection.subject_id); if (expiration.status === 'eligible') return {decision: 'expired', reason_code: expiration.reason_code, evidence_event_ids: []}; if (expiration.status === 'unresolved') return {decision: 'unresolved', reason_code: expiration.reason_code, evidence_event_ids: []}; return {decision: 'keep_active', reason_code: 'no_factual_transition', evidence_event_ids: []};
}
