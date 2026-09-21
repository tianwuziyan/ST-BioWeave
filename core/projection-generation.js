import {
  PROJECTION_DEVELOPMENT_KINDS,
  createProjection,
  validateProjection,
} from './projection.js'
import {validateProjectionRule} from './projection-eligibility.js'

export const PROJECTION_GENERATION_STATUS = Object.freeze([
  'generated',
  'skipped',
  'failed',
  'stale',
])

const RAW_FIELDS = new Set(['development'])
const RAW_DEVELOPMENT_FIELDS = new Set(['kind', 'description'])
const FORBIDDEN_KEYS = new Set([
  'projection_id',
  'projection_rule_id',
  'lifecycle_id',
  'created_at_floor_version',
  'floor_version',
  'owner_type',
  'chat_id',
  'message_id',
  'swipe_id',
  'content_hash',
  'message_version',
  'source_event_ids',
  'evidence_refs',
  'probability',
  'random',
  'random_result',
  'seed',
  'pregnancy_id',
  'conception_id',
  'outcome',
  'biological_event',
  'event',
  'events',
  'attribution',
  'contributor',
  'contributors',
  'prompt',
  'raw_response',
  'raw_ai_response',
  'snapshot',
  'current_state',
  'ui',
])

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function clone(value) {
  if (value === undefined || value === null || typeof value !== 'object') return value
  if (typeof structuredClone === 'function') return structuredClone(value)
  if (Array.isArray(value)) return value.map(clone)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]))
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
}

function fingerprint(value) {
  return JSON.stringify(stable(value))
}

function unexpected(errors, value, allowed, path) {
  if (!isRecord(value)) return
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) errors.push(`${path}.${key}:forbidden_field`)
    else if (!allowed.has(key)) errors.push(`${path}.${key}:unexpected_field`)
  }
}

function forbiddenNested(errors, value, path = 'raw') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => forbiddenNested(errors, item, `${path}[${index}]`))
    return
  }
  if (!isRecord(value)) return
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) errors.push(`${path}.${key}:forbidden_field`)
    forbiddenNested(errors, item, `${path}.${key}`)
  }
}

export function validateRawProjectionGenerationOutput(value) {
  const errors = []
  if (!isRecord(value)) return {ok: false, errors: ['raw_projection:invalid']}
  forbiddenNested(errors, value)
  unexpected(errors, value, RAW_FIELDS, 'raw_projection')
  if (!isRecord(value.development)) errors.push('raw_projection.development:required')
  else {
    unexpected(errors, value.development, RAW_DEVELOPMENT_FIELDS, 'raw_projection.development')
    if (!PROJECTION_DEVELOPMENT_KINDS.includes(value.development.kind)) errors.push('raw_projection.development.kind:invalid')
    if (typeof value.development.description !== 'string' || !value.development.description.trim()) errors.push('raw_projection.development.description:required')
  }
  return {ok: errors.length === 0, errors}
}

export function normalizeRawProjectionGenerationOutput(value) {
  const validation = validateRawProjectionGenerationOutput(value)
  if (!validation.ok) throw new TypeError(validation.errors.join(', '))
  return {development: {kind: value.development.kind, description: value.development.description.trim()}}
}

function decisionIsEligible(decision) {
  return isRecord(decision) && decision.eligibility === 'eligible'
}

export function validateProjectionGenerationBinding(raw, {decision} = {}) {
  const errors = []
  if (!decisionIsEligible(decision)) errors.push('decision:not_eligible')
  const rawValidation = validateRawProjectionGenerationOutput(raw)
  errors.push(...rawValidation.errors)
  if (rawValidation.ok && decisionIsEligible(decision) && raw.development.kind !== decision.development_kind) errors.push('raw_projection.development.kind:decision_mismatch')
  return {ok: errors.length === 0, errors}
}

function validateDecisionRuleBinding(decision, rule) {
  const errors = []
  if (!isRecord(rule)) return ['projection_rule:invalid']
  if (rule.projection_rule_id !== decision?.projection_rule_id) errors.push('projection_rule:decision_mismatch')
  if (rule.development_concern_key !== decision?.development_concern_key) errors.push('projection_rule:concern_mismatch')
  if (rule.development_kind !== decision?.development_kind) errors.push('projection_rule:development_kind_mismatch')
  return errors
}

function contextFloorVersion(context) {
  return context?.floor_version ?? context?.current_floor_version ?? null
}

function contextStoryTime(context) {
  return context?.current_story_time ?? null
}

function contextRuleRefs(context, rule) {
  const refs = Array.isArray(context?.world_model_rule_refs) ? context.world_model_rule_refs : []
  return [...new Set([...refs, `projection-rule:${rule.projection_rule_id}`])].sort()
}

export function boundProjectionStoryContext(storyContext = [], currentCharacterFloor) {
  if (!Number.isFinite(Number(currentCharacterFloor))) return []
  return (Array.isArray(storyContext) ? storyContext : [])
    .filter(item => Number.isFinite(Number(item?.floor ?? item?.floor_version?.floor)))
    .filter(item => Number(item.floor ?? item.floor_version.floor) <= Number(currentCharacterFloor))
    .map(clone)
}

export function buildProjectionGenerationInput({
  decision,
  rule,
  currentState = {},
  sourceCandidates = [],
  currentStoryTime = null,
  storyContext = [],
  generationContext = {},
} = {}) {
  if (!decisionIsEligible(decision)) throw new TypeError('decision:not_eligible')
  if (decision.existing_projection_id) throw new TypeError('decision:existing_projection')
  if (!isRecord(rule) || !validateProjectionRule(rule).ok) throw new TypeError('projection_rule:invalid')
  const ruleBindingErrors = validateDecisionRuleBinding(decision, rule)
  if (ruleBindingErrors.length) throw new TypeError(ruleBindingErrors.join(', '))
  const subject = currentState?.characters?.[decision.subject_id] ?? null
  const floorVersion = contextFloorVersion(generationContext)
  return clone({
    eligible_decision: decision,
    rule: {
      schema_version: rule.schema_version,
      mechanism_key: rule.mechanism_key,
      development_concern_key: rule.development_concern_key,
      development_kind: rule.development_kind,
      trigger: rule.trigger,
      requirements: rule.requirements,
      realization: rule.realization,
      contradiction: rule.contradiction,
      expiration: rule.expiration,
    },
    subject_state: subject,
    source_candidates: (Array.isArray(sourceCandidates) ? sourceCandidates : []).filter(item => item?.subject_id === decision.subject_id),
    current_story_time: currentStoryTime,
    story_context: boundProjectionStoryContext(storyContext, floorVersion?.floor ?? generationContext.current_character_floor),
  })
}

export function assembleProjectionCandidate({raw, decision, rule, generationContext = {}} = {}) {
  const binding = validateProjectionGenerationBinding(raw, {decision})
  if (!binding.ok) throw new TypeError(binding.errors.join(', '))
  const ruleValidation = validateProjectionRule(rule)
  if (!ruleValidation.ok) throw new TypeError(ruleValidation.errors.join(', '))
  const ruleBindingErrors = validateDecisionRuleBinding(decision, rule)
  if (ruleBindingErrors.length) throw new TypeError(ruleBindingErrors.join(', '))
  const floorVersion = contextFloorVersion(generationContext)
  const sourceEventIds = [...new Set(decision.source_event_ids ?? [])].sort()
  const evidenceRefs = [...new Set([...(decision.evidence_refs ?? []), ...(generationContext.evidence_refs ?? [])])].sort()
  const mechanismRuleRefs = contextRuleRefs(generationContext, rule)
  const candidate = createProjection({
    owner_type: 'character',
    subject_id: decision.subject_id,
    projection_rule_id: decision.projection_rule_id,
    development_concern_key: decision.development_concern_key,
    mechanism: {key: rule.mechanism_key, world_model_rule_refs: mechanismRuleRefs},
    source_event_ids: sourceEventIds,
    development: {
      kind: raw.development.kind,
      current_basis: {
        event_ids: sourceEventIds,
        state_refs: [`state:${decision.subject_id}`],
        mechanism_rule_refs: mechanismRuleRefs,
      },
      next_signal: raw.development.description,
    },
    timing: {
      trigger_kind: rule.trigger.kind,
      reference_event_id: decision.reference_event_id ?? null,
      reference_story_time: generationContext.reference_story_time ?? null,
      current_story_time: contextStoryTime(generationContext),
      elapsed_story_days: generationContext.elapsed_story_days ?? null,
    },
    created_at_floor_version: floorVersion,
    evidence_refs: evidenceRefs,
  })
  const validation = validateProjection(candidate, {expectedChatId: floorVersion?.chat_id ?? null})
  if (!validation.ok) throw new TypeError(validation.errors.join(', '))
  return candidate
}

function parseRaw(value) {
  if (typeof value === 'string') {
    try { return JSON.parse(value) } catch { return null }
  }
  return clone(value)
}

export async function generateProjectionCandidate({
  decision,
  rule,
  generationContext = {},
  currentState = {},
  sourceCandidates = [],
  currentStoryTime = null,
  storyContext = [],
  generateRaw,
  isStillCurrent = () => true,
} = {}) {
  if (!decisionIsEligible(decision)) return {status: 'skipped', reason_code: 'decision_not_eligible', projection: null}
  if (decision.existing_projection_id) return {status: 'skipped', reason_code: 'existing_projection', projection: null}
  if (typeof generateRaw !== 'function') return {status: 'failed', reason_code: 'generator_missing', projection: null}
  const input = buildProjectionGenerationInput({decision, rule, currentState, sourceCandidates, currentStoryTime, storyContext, generationContext})
  const requestFingerprint = fingerprint({decision, rule, generation_context: generationContext, input})
  if (!(await isStillCurrent({phase: 'before_request', fingerprint: requestFingerprint}))) return {status: 'stale', reason_code: 'stale_before_request', projection: null}
  let response
  try { response = await generateRaw(clone(input)) } catch { return {status: 'failed', reason_code: 'api_failure', projection: null} }
  if (!(await isStillCurrent({phase: 'after_response', fingerprint: requestFingerprint}))) return {status: 'stale', reason_code: 'stale_after_response', projection: null}
  const raw = parseRaw(response)
  if (raw === null) return {status: 'failed', reason_code: 'invalid_json', projection: null}
  const binding = validateProjectionGenerationBinding(raw, {decision})
  if (!binding.ok) return {status: 'failed', reason_code: 'validation_failed', errors: binding.errors, projection: null}
  try {
    const projection = assembleProjectionCandidate({raw: normalizeRawProjectionGenerationOutput(raw), decision, rule, generationContext})
    return {status: 'generated', reason_code: null, projection}
  } catch (error) {
    return {status: 'failed', reason_code: 'assembly_failed', errors: [error.message], projection: null}
  }
}
