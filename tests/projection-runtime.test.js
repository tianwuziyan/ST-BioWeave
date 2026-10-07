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

function createFixture({analyzer, mutateInputs = null, resolvePreConfirmationTiming = null} = {}) {
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
    resolvePreConfirmationTiming,
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

test('Story Time-only progression enters the frozen Timing window without a new Event and generates once', async () => {
  let calls = 0
  const timing = {
    timing_instance_id: 'timing-cycle-1',
    subject_id: subject,
    mechanism_key: 'fertilization',
    cycle_id: 'cycle-1',
    source_event_ids: ['event-1'],
    reference_story_time: {day_index: 0},
    effective_min_story_days: 5,
    effective_max_story_days: 10,
  }
  const window = {
    tracking_window_id: 'window-cycle-1',
    cycle_id: 'cycle-1',
    subject_id: subject,
    mechanism_key: 'fertilization',
    status: 'open',
    source_event_ids: ['event-1'],
  }
  const fixture = createFixture({
    analyzer: {generateProjection: async () => {
      calls += 1
      return {development: {kind: 'possible_detection', description: '可能出现检测迹象。'}}
    }},
    resolvePreConfirmationTiming: async () => ({enabled: true, instances: [timing], windows: [window]}),
  })
  fixture.setInputs({...inputs(), currentStoryTime: {day_index: 3, display: '第 3 天'}})
  const before = await fixture.runtime.process({reason: 'story-time:before-min', trigger: 'story-time-progression'})
  assert.equal(before.status, 'success')
  assert.equal(calls, 0)

  fixture.setInputs({...inputs(), currentStoryTime: {day_index: 5, display: '第 5 天'}})
  const opened = await fixture.runtime.process({reason: 'story-time:window-open', trigger: 'story-time-progression'})
  assert.equal(opened.status, 'success')
  assert.equal(calls, 1)

  fixture.setInputs({...inputs(), currentStoryTime: {day_index: 6, display: '第 6 天'}})
  const continued = await fixture.runtime.process({reason: 'story-time:window-open-again', trigger: 'story-time-progression'})
  assert.equal(continued.status, 'success')
  assert.equal(calls, 1)
  assert.equal(fixture.saved.length, 1)
  const timingStatus = fixture.statuses.filter(event => event.payload?.stage === 'PROJECTION_TIMING_EVALUATED').find(event => event.payload?.timing_evaluations?.[0]?.timing_state === 'window_open')
  assert.equal(timingStatus.payload.trigger, 'story-time-progression')
  assert.equal(timingStatus.payload.timing_evaluations[0].timing_state, 'window_open')
  assert.equal(timingStatus.payload.timing_evaluations[0].compatible_exposure_count, 1)
  assert.equal(fixture.statuses.some(event => event.payload?.stage === 'PROJECTION_AI_REQUEST_STARTED'), true)
  assert.equal(fixture.statuses.some(event => event.payload?.stage === 'PROJECTION_AI_REQUEST_COMPLETED' && event.payload?.candidate_validation_result === 'passed'), true)
  assert.equal(fixture.statuses.some(event => event.payload?.stage === 'PROJECTION_READBACK' && event.payload?.projection_view_count === 1), true)
})

test('Story Time-only first Projection aggregates every compatible exposure in the cycle', async () => {
  const sourceEvents = ['event-a', 'event-b', 'event-c'].map((event_id, index) => ({
    ...inputs().events[0],
    event_id,
    story_time: {day_index: index},
  }))
  const timing = {
    timing_instance_id: 'timing-cycle-aggregate',
    subject_id: subject,
    mechanism_key: 'fertilization',
    cycle_id: 'cycle-aggregate',
    source_event_ids: sourceEvents.map(event => event.event_id),
    reference_story_time: {day_index: 0},
    effective_min_story_days: 5,
    effective_max_story_days: 10,
  }
  const window = {
    tracking_window_id: 'window-cycle-aggregate',
    cycle_id: 'cycle-aggregate',
    subject_id: subject,
    mechanism_key: 'fertilization',
    status: 'open',
    source_event_ids: sourceEvents.map(event => event.event_id),
  }
  const fixture = createFixture({
    resolvePreConfirmationTiming: async () => ({enabled: true, instances: [timing], windows: [window]}),
  })
  fixture.setInputs({...inputs(), events: sourceEvents, currentStoryTime: {day_index: 5, display: '第 5 天'}})
  const result = await fixture.runtime.process({reason: 'story-time:window-open', trigger: 'story-time-progression'})
  assert.equal(result.status, 'success')
  assert.deepEqual(fixture.saved[0].source_event_ids, sourceEvents.map(event => event.event_id).sort())
})

test('Story Time-only progression after effective_max does not backfill a missed first Projection', async () => {
  let calls = 0
  const timing = {
    timing_instance_id: 'timing-cycle-missed',
    subject_id: subject,
    mechanism_key: 'fertilization',
    cycle_id: 'cycle-missed',
    source_event_ids: ['event-1'],
    reference_story_time: {day_index: 0},
    effective_min_story_days: 5,
    effective_max_story_days: 10,
  }
  const window = {
    tracking_window_id: 'window-cycle-missed',
    cycle_id: 'cycle-missed',
    subject_id: subject,
    mechanism_key: 'fertilization',
    status: 'open',
    source_event_ids: ['event-1'],
  }
  const fixture = createFixture({
    analyzer: {generateProjection: async () => {
      calls += 1
      return {development: {kind: 'possible_detection', description: '不应生成。'}}
    }},
    resolvePreConfirmationTiming: async () => ({enabled: true, instances: [timing], windows: [window]}),
  })
  fixture.setInputs({...inputs(), currentStoryTime: {day_index: 11, display: '第 11 天'}})
  const result = await fixture.runtime.process({reason: 'story-time:window-missed', trigger: 'story-time-progression'})
  assert.equal(result.status, 'success')
  assert.equal(calls, 0)
  assert.equal(fixture.saved.length, 0)
})
