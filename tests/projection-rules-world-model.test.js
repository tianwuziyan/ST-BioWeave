import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildProjectionRuleId,
  normalizeProjectionRule,
  normalizeProjectionRules,
  validateProjectionRule,
  validateProjectionRuleContent,
} from '../core/projection-eligibility.js'
import { normalizeWorldModel, parseWorldModelResponse, validateWorldModel } from '../ai/analyzer.js'
import { evaluateProjectionEligibility } from '../core/projection-eligibility.js'

function rule(overrides = {}) {
  const base = {
    schema_version: 1,
    mechanism_key: 'mechanism:implant',
    development_concern_key: 'concern:change',
    development_kind: 'possible_biological_change',
    trigger: {
      kind: 'elapsed_after_event',
      source_event_type: 'sexual_activity',
      min_elapsed_story_days: 20,
    },
    requirements: {
      capabilities: [{ key: 'can_carry_pregnancy', equals: true }],
      source_compatibility: 'required_true',
      contributor_relationships: [],
    },
    realization: { event_types: ['medical_event'], statuses: ['confirmed'] },
    contradiction: { event_types: ['other_biological'], statuses: ['confirmed'] },
    expiration: null,
    ...overrides,
  }
  return base
}

test('Projection Rule identity is stable and excludes irrelevant object ordering', () => {
  const first = rule()
  const reordered = rule({
    requirements: {
      contributor_relationships: [],
      source_compatibility: 'required_true',
      capabilities: [{ equals: true, key: 'can_carry_pregnancy' }],
    },
  })
  assert.equal(buildProjectionRuleId(first), buildProjectionRuleId(reordered))
  assert.notEqual(buildProjectionRuleId(first), buildProjectionRuleId(rule({ trigger: { ...first.trigger, min_elapsed_story_days: 21 } })))
  assert.notEqual(buildProjectionRuleId(first), buildProjectionRuleId(rule({ development_concern_key: 'concern:detection' })))
  assert.equal(buildProjectionRuleId(first), buildProjectionRuleId({ ...first, raw_description: '不同 AI 措辞', created_at_floor_version: { floor: 99, swipe_id: 2 } }))
})

test('Projection Rule normalization sorts unordered requirements without mutating input', () => {
  const input = rule({ requirements: { capabilities: [{ key: 'z', equals: null }, { key: 'a', equals: false }] } })
  const before = structuredClone(input)
  const normalized = normalizeProjectionRule(input)
  assert.deepEqual(input, before)
  assert.deepEqual(normalized.requirements.capabilities.map(item => item.key), ['a', 'z'])
})

test('Projection Rule validation rejects missing identity, forbidden data, and executable values', () => {
  assert.equal(validateProjectionRule({ ...rule(), projection_rule_id: undefined }).ok, false)
  assert.equal(validateProjectionRule({ ...rule(), probability: 0.5 }).ok, false)
  assert.equal(validateProjectionRule({ ...rule(), prompt: 'generate this' }).ok, false)
  assert.equal(validateProjectionRuleContent({ ...rule(), projection_rule_id: 'ai-guessed-id' }).ok, false)
  assert.equal(validateProjectionRule({ ...rule(), trigger: { kind: 'elapsed_after_event', code: 'x => x' } }).ok, false)
  assert.equal(validateProjectionRule({ ...rule(), realization: { payload_equals: { probability: 1 } } }).ok, false)
  assert.equal(validateProjectionRule({ ...rule(), realization: { payload_equals: { callback: () => true } } }).ok, false)
})

test('raw AI World Model rejects projection_rule_id while normalization owns generation', () => {
  const raw = { schema_version: 1, species: [], exceptions: [], unknowns: [], projection_rules: [{ ...rule(), projection_rule_id: 'ai-guessed-id' }] }
  assert.throws(
    () => parseWorldModelResponse({ schema_version: 1, species: [], exceptions: [], unknowns: [], projection_rules: raw.projection_rules }),
    error => error?.diagnosticCode === 'WORLD_MODEL_PROJECTION_RULES_INVALID',
  )
  const normalized = normalizeWorldModel({ ...raw, projection_rules: [rule()] })
  assert.equal(normalized.projection_rules[0].projection_rule_id, buildProjectionRuleId(rule()))
})

test('Projection Rule normalization dedupes exact duplicates and generated IDs protect the rule set', () => {
  const first = rule()
  const normalized = normalizeProjectionRules([first, structuredClone(first)])
  assert.equal(normalized.length, 1)
  assert.match(normalized[0].projection_rule_id, /^projection_rule_[0-9a-f]{16}$/)
})

test('same generated ID with different canonical content fails closed in Eligibility', () => {
  const first = normalizeProjectionRules([rule()])[0]
  const changed = normalizeProjectionRules([rule({ development_kind: 'possible_detection' })])[0]
  const result = evaluateProjectionEligibility({
    worldModel: { projection_rules: [first, { ...changed, projection_rule_id: first.projection_rule_id }] },
  })
  assert.equal(result.diagnostics[0].code, 'projection_rule_conflict')
})

test('World Model normalizer persists only validated projection_rules', () => {
  const input = { schema_version: 1, species: [], exceptions: [], unknowns: [], projection_rules: [rule()] }
  const before = structuredClone(input)
  const normalized = normalizeWorldModel(input, { strict: true })
  assert.deepEqual(input, before)
  assert.equal(normalized.projection_rules.length, 1)
  assert.equal(normalized.projection_rules[0].projection_rule_id, buildProjectionRuleId(input.projection_rules[0]))
  assert.deepEqual(validateWorldModel(normalized, { allowGeneratedProjectionRuleIds: true }).projection_rules, normalized.projection_rules)
})

test('Invalid World Model projection rules fail closed and empty rules remain explicit', () => {
  assert.deepEqual(normalizeWorldModel({ schema_version: 1, species: [], exceptions: [], unknowns: [] }).projection_rules, [])
  assert.throws(
    () => normalizeWorldModel({ schema_version: 1, species: [], exceptions: [], unknowns: [], projection_rules: [{ ...rule(), probability: 1 }] }),
    error => error?.code === 'WORLD_MODEL_INVALID' && error?.diagnosticCode === 'WORLD_MODEL_PROJECTION_RULES_INVALID',
  )
})

test('Eligibility consumes the formal normalized World Model rule and does not create facts', () => {
  const normalized = normalizeWorldModel({ schema_version: 1, species: [], exceptions: [], unknowns: [], projection_rules: [rule()] })
  const result = evaluateProjectionEligibility({ worldModel: normalized, currentState: { characters: {} }, events: [] })
  assert.ok(Array.isArray(result.decisions))
  assert.equal(Object.hasOwn(result, 'event'), false)
})
