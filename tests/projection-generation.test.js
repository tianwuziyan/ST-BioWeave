import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assembleProjectionCandidate,
  boundProjectionStoryContext,
  buildProjectionGenerationInput,
  generateProjectionCandidate,
  validateProjectionGenerationBinding,
  validateRawProjectionGenerationOutput,
} from '../core/projection-generation.js'
import {normalizeProjectionRules} from '../core/projection-eligibility.js'
import {buildProjectionGenerationMessages} from '../ai/prompts.js'
import {validateProjection} from '../core/projection.js'

const SUBJECT = 'char_000001'

function story(day) { return {display: `Day ${day}`, normalized: `day-${day}`, day_index: day, calendar_id: 'main', precision: 'day'} }
function version(floor, chat_id = 'chat-a') { return {chat_id, message_id: `message-${floor}`, floor, swipe_id: 0, content_hash: `hash-${floor}`, message_version: `v${floor}`} }
function rule() {
  return normalizeProjectionRules([{
    schema_version: 1,
    mechanism_key: 'mechanism:implant',
    development_concern_key: 'concern:change',
    development_kind: 'possible_biological_change',
    trigger: {kind: 'elapsed_after_event', source_event_type: 'sexual_activity', min_elapsed_story_days: 5},
    requirements: {capabilities: [], source_compatibility: 'required_true', contributor_relationships: []},
    realization: {event_types: ['medical_event']},
    contradiction: {event_types: ['other_biological']},
    expiration: null,
  }])[0]
}
function decision(overrides = {}) {
  const projectionRule = rule()
  return {
    subject_id: SUBJECT,
    projection_rule_id: projectionRule.projection_rule_id,
    development_concern_key: projectionRule.development_concern_key,
    development_kind: projectionRule.development_kind,
    eligibility: 'eligible',
    source_event_ids: ['event-2', 'event-1'],
    evidence_refs: ['event:event-1', 'event:event-2'],
    reference_event_id: 'event-1',
    ...overrides,
    _rule: projectionRule,
  }
}
function context(overrides = {}) { return {floor_version: version(10), current_story_time: story(20), reference_story_time: story(0), elapsed_story_days: 20, ...overrides} }
function raw(overrides = {}) { return {development: {kind: 'possible_biological_change', description: '某种符合当前机制的变化可能逐渐显现。'}, ...overrides} }

test('raw generation DTO contains only creative development content', () => {
  assert.equal(validateRawProjectionGenerationOutput(raw()).ok, true)
  assert.equal(validateRawProjectionGenerationOutput({...raw(), projection_id: 'x'}).ok, false)
  assert.equal(validateRawProjectionGenerationOutput({...raw(), probability: 0.5}).ok, false)
  assert.equal(validateRawProjectionGenerationOutput({...raw(), biological_event: {type: 'pregnancy_confirmation'}}).ok, false)
  assert.equal(validateRawProjectionGenerationOutput({...raw(), development: {...raw().development, attribution: 'confirmed'}}).ok, false)
})

test('non-eligible decisions never call the generator', async () => {
  for (const eligibility of ['not_eligible', 'unresolved']) {
    let called = false
    const result = await generateProjectionCandidate({decision: decision({eligibility}), rule: decision()._rule, generationContext: context(), generateRaw: () => { called = true; return raw() }})
    assert.equal(result.status, 'skipped')
    assert.equal(called, false)
  }
})

test('existing Projection identity skips duplicate creation', async () => {
  let called = false
  const result = await generateProjectionCandidate({decision: decision({existing_projection_id: 'projection-existing'}), rule: decision()._rule, generationContext: context(), generateRaw: () => { called = true; return raw() }})
  assert.equal(result.reason_code, 'existing_projection')
  assert.equal(called, false)
})

test('kind is bound to Eligibility and cannot be corrected', () => {
  const result = validateProjectionGenerationBinding({development: {kind: 'possible_detection', description: '未来可能出现检测信号。'}}, {decision: decision()})
  assert.equal(result.ok, false)
  assert.ok(result.errors.includes('raw_projection.development.kind:decision_mismatch'))
})

test('rule, concern, and kind bindings fail closed when the caller supplies another rule', () => {
  const selected = decision()
  const otherRule = normalizeProjectionRules([{
    schema_version: 1,
    mechanism_key: 'mechanism:other',
    development_concern_key: 'concern:other',
    development_kind: 'possible_detection',
    trigger: {kind: 'story_time_reached', target_story_time: story(10)},
    requirements: {capabilities: [], source_compatibility: 'not_required', contributor_relationships: []},
    realization: null,
    contradiction: null,
    expiration: null,
  }])[0]
  assert.throws(() => buildProjectionGenerationInput({decision: selected, rule: otherRule, generationContext: context()}), /projection_rule:decision_mismatch/)
  assert.throws(() => assembleProjectionCandidate({raw: raw(), decision: selected, rule: otherRule, generationContext: context()}), /projection_rule:decision_mismatch/)
})

test('valid response is assembled by BioWeave and passes the Projection validator', async () => {
  const selected = decision()
  const result = await generateProjectionCandidate({decision: selected, rule: selected._rule, generationContext: context(), currentState: {characters: {[SUBJECT]: {}}}, sourceCandidates: [{subject_id: SUBJECT, source_character_id: 'char_000002', compatibility: null}], generateRaw: async input => { assert.equal(input.eligible_decision.subject_id, SUBJECT); return raw() }})
  assert.equal(result.status, 'generated')
  assert.equal(validateProjection(result.projection, {expectedChatId: 'chat-a'}).ok, true)
  assert.equal(result.projection.subject_id, SUBJECT)
  assert.equal(result.projection.source_event_ids.includes('event-1'), true)
  assert.equal(result.projection.source_event_ids.includes('event-2'), true)
  assert.equal(result.projection.projection_rule_id, selected.projection_rule_id)
  assert.equal(result.projection.created_at_floor_version.floor, 10)
})

test('identity and metadata do not come from AI, and candidates remain unresolved', async () => {
  const selected = decision()
  const before = structuredClone(selected)
  const result = await generateProjectionCandidate({decision: selected, rule: selected._rule, generationContext: context(), sourceCandidates: [{subject_id: SUBJECT, source_character_id: 'B', compatibility: true}, {subject_id: SUBJECT, source_character_id: 'C', compatibility: null}], generateRaw: () => raw(),})
  assert.equal(result.status, 'generated')
  assert.deepEqual(selected, before)
  assert.equal(result.projection.projection_id.includes('B'), false)
  assert.equal(result.projection.projection_id.includes('C'), false)
  assert.equal(result.projection.development.next_signal.includes('confirmed'), false)
})

test('API, JSON, schema, and semantic failures are fail-closed', async () => {
  const selected = decision()
  const cases = [
    {response: () => { throw new Error('offline') }, code: 'api_failure'},
    {response: () => '{not-json', code: 'invalid_json'},
    {response: () => ({development: {kind: 'possible_biological_change'}}), code: 'validation_failed'},
    {response: () => ({...raw(), outcome: 'pregnancy'}), code: 'validation_failed'},
    {response: () => ({...raw(), contributor: {source_character_id: 'C'}}), code: 'validation_failed'},
  ]
  for (const item of cases) {
    const result = await generateProjectionCandidate({decision: selected, rule: selected._rule, generationContext: context(), generateRaw: item.response})
    assert.equal(result.status, 'failed')
    assert.equal(result.reason_code, item.code)
    assert.equal(result.projection, null)
  }
})

test('stale generation is discarded before or after the AI request', async () => {
  const selected = decision()
  const before = await generateProjectionCandidate({decision: selected, rule: selected._rule, generationContext: context(), generateRaw: () => raw(), isStillCurrent: ({phase}) => phase !== 'before_request'})
  assert.equal(before.status, 'stale')
  const after = await generateProjectionCandidate({decision: selected, rule: selected._rule, generationContext: context(), generateRaw: () => raw(), isStillCurrent: ({phase}) => phase !== 'after_response'})
  assert.equal(after.status, 'stale')
})

test('Story context is bounded by the current Character Floor, while earlier User context remains available', () => {
  const bounded = boundProjectionStoryContext([
    {floor: 4, role: 'user', content: '历史用户上下文'},
    {floor: 5, role: 'assistant', content: '当前 Character Floor'},
    {floor: 6, role: 'user', content: '最新用户消息'},
  ], 5)
  assert.deepEqual(bounded.map(item => item.floor), [4, 5])
  assert.equal(bounded.some(item => item.content === '最新用户消息'), false)
  const input = buildProjectionGenerationInput({decision: decision(), rule: decision()._rule, generationContext: context({floor_version: version(5)}), storyContext: [{floor: 5, role: 'assistant', content: 'A'}, {floor: 6, role: 'user', content: 'U'}]})
  assert.deepEqual(input.story_context.map(item => item.floor), [5])
})

test('prompt is separate and does not ask AI for identity or facts', () => {
  const messages = buildProjectionGenerationMessages({eligible_decision: {development_kind: 'possible_detection'}})
  const prompt = messages.map(message => message.content).join('\n')
  assert.match(prompt, /Projection Generation/)
  assert.match(prompt, /projection_id/)
  assert.match(prompt, /BiologicalEvent/)
  assert.match(prompt, /严格 JSON|JSON/)
})

test('generation does not mutate State, Snapshot, or produce Events', async () => {
  const selected = decision()
  const currentState = {characters: {[SUBJECT]: {pregnancy: {episodes: {}}}}}
  const snapshot = {state: structuredClone(currentState)}
  const beforeState = structuredClone(currentState)
  const beforeSnapshot = structuredClone(snapshot)
  const result = await generateProjectionCandidate({decision: selected, rule: selected._rule, generationContext: context(), currentState, generateRaw: () => raw()})
  assert.equal(result.status, 'generated')
  assert.deepEqual(currentState, beforeState)
  assert.deepEqual(snapshot, beforeSnapshot)
  assert.equal(result.projection.events, undefined)
  assert.equal(result.projection.state, undefined)
})
