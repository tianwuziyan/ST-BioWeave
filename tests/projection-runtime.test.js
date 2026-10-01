import test from 'node:test'
import assert from 'node:assert/strict'
import {createProjectionRuntime} from '../runtime/projection-runtime.js'
import {buildProjectionRuleId} from '../core/projection-eligibility.js'

const version = {
  chat_id: 'chat-projection',
  message_id: 'message-3',
  floor: 3,
  swipe_id: 0,
  content_hash: 'hash-3',
  message_version: 'v1:hash-3',
}
const subject = 'char_000001'
const ruleContent = {
  schema_version: 1,
  mechanism_key: 'fertilization',
  development_concern_key: 'detection',
  development_kind: 'possible_detection',
  trigger: {kind: 'immediate_after_event', source_event_type: 'sexual_activity'},
  requirements: {
    capabilities: [],
    source_compatibility: 'not_required',
    contributor_relationships: [],
  },
  realization: null,
  contradiction: null,
  expiration: null,
}
const rule = {...ruleContent, projection_rule_id: buildProjectionRuleId(ruleContent)}

function inputs() {
  return {
    floor: {index: 3, swipeId: 0, version},
    currentState: {characters: {[subject]: {reproductive_capabilities: {}}}},
    currentStateStatus: 'ready',
    events: [{
      event_id: 'event-1',
      type: 'sexual_activity',
      status: 'confirmed',
      pregnancy_relevance: {
        relevant: true,
        gestational_subject_ids: [subject],
        reproductive_mechanism: {kind: 'fertilization'},
      },
    }],
    sourceCandidates: [],
    worldModel: {projection_rules: [rule]},
    currentStoryTime: {day_index: 3, display: '第 3 天'},
    storyContext: [],
  }
}

function createFixture({analyzer, mutateInputs = null} = {}) {
  let current = inputs()
  const saved = []
  const statuses = []
  const contextRefreshes = []
  const views = async () => ({all: saved.map(item => ({...item, factual_status: 'active', deleted: false, context_visible: true}))})
  const runtime = createProjectionRuntime({
    analyzer: analyzer ?? {generateProjection: async () => ({development: {kind: 'possible_detection', description: '可能出现检测迹象。'}})},
    getChatId: () => version.chat_id,
    collectInputs: async () => {
      if (mutateInputs) current = mutateInputs(current)
      return structuredClone(current)
    },
    resolveCurrentFloor: async () => current.floor,
    getProjectionViews: views,
    saveGeneratedProjection: async ({projectionCandidate}) => { saved.push(projectionCandidate); return {status: 'committed'} },
    saveProjectionEvidence: async () => ({status: 'committed'}),
    saveEvolutionDecision: async () => ({status: 'skipped'}),
    refreshProjectionContext: async () => {
      contextRefreshes.push(saved.length)
    },
    notify: event => statuses.push(event),
  })
  return {runtime, saved, statuses, contextRefreshes, setInputs: next => {current = next}}
}

test('Projection Runtime generates one candidate and same identity reread does not call AI again', async () => {
  let calls = 0
  const fixture = createFixture({analyzer: {generateProjection: async () => { calls += 1; return {development: {kind: 'possible_detection', description: '可能出现检测迹象。'}} }}})
  const first = await fixture.runtime.process({reason: 'factual-success'})
  assert.equal(first.status, 'success')
  assert.equal(calls, 1)
  assert.equal(fixture.saved.length, 1)
  const second = await fixture.runtime.refreshProjection()
  assert.equal(second.status, 'success')
  assert.equal(calls, 1)
  assert.equal(fixture.saved.length, 1)
})

test('duplicate Projection execution is single-flight', async () => {
  let calls = 0
  let release
  const fixture = createFixture({analyzer: {generateProjection: async () => {
    calls += 1
    await new Promise(resolve => { release = resolve })
    return {development: {kind: 'possible_detection', description: '可能出现检测迹象。'}}
  }}})
  const first = fixture.runtime.process({reason: 'factual-success'})
  const second = fixture.runtime.process({reason: 'duplicate-lifecycle'})
  while (typeof release !== 'function') await new Promise(resolve => setImmediate(resolve))
  release()
  await Promise.all([first, second])
  assert.equal(calls, 1)
})

test('stale factual basis fails closed before persistence', async () => {
  let calls = 0
  let revision = 0
  const fixture = createFixture({
    analyzer: {generateProjection: async () => {
      calls += 1
      return {development: {kind: 'possible_detection', description: '可能出现检测迹象。'}}
    }},
    mutateInputs: value => ({...value, events: value.events.map(event => ({...event, event_id: `event-new-${++revision}`}))}),
  })
  const result = await fixture.runtime.process({reason: 'factual-success'})
  assert.equal(result.status, 'stale')
  assert.equal(calls, 0)
  assert.equal(fixture.saved.length, 0)
})

test('Projection Context refresh observes persisted views after generation', async () => {
  const fixture = createFixture()
  const result = await fixture.runtime.process({reason: 'factual-success'})
  assert.equal(result.status, 'success')
  assert.deepEqual(fixture.contextRefreshes, [1])
})
