import test from 'node:test'
import assert from 'node:assert/strict'
import {createProjectionRuntime} from '../runtime/projection-runtime.js'
import {buildBuiltInPreConfirmationRules, buildProjectionRuleId} from '../core/projection-eligibility.js'
import {createProjection} from '../core/projection.js'
import {createRuntimeDiagnostics} from '../runtime/diagnostics.js'
import {deriveTrackingWindows} from '../core/tracking-window.js'
import {emptyFloor} from '../storage/schema.js'
import {createPregnancyLifecyclePersistence} from '../storage/pregnancy-lifecycle.js'

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
      story_time: {day_index: 0, display: '第 0 天'},
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

function createFixture({analyzer, diagnostics = null, mutateInputs = null, resolvePreConfirmationTiming = null, getProjectionViews = null, deleteProjection = null, getProjectionDeliveryRecords = null, saveProjectionDeliveryResponseBatch = null, saveProjectionDeliveryResponse = null, saveProjectionLifecycleBatch = null, saveProjectionObservationBatch = null, saveProjectionTriggeredSnapshotBatch = null, archiveAndReleasePregnancy = null, saveProjectionBatchHook = null} = {}) {
  let current = inputs()
  const saved = []
  let collectInputsCalls = 0
  let batchPersistenceCalls = 0
  const batchRecordCounts = []
  const statuses = []
  const contextRefreshes = []
  const views = async () => ({all: saved.map(item => ({...item, factual_status: 'active', deleted: false, context_visible: true}))})
  const runtime = createProjectionRuntime({
    analyzer: analyzer ?? {generateProjection: async () => ({development: {kind: 'possible_detection', description: '可能出现检测迹象。'}})},
    getChatId: () => version.chat_id,
    collectInputs: async () => {
      collectInputsCalls += 1
      if (mutateInputs) current = mutateInputs(current)
      const snapshot = structuredClone(current)
      if (deleteProjection) snapshot.deleteProjection = deleteProjection
      return snapshot
    },
    resolveCurrentFloor: async () => current.floor,
    getProjectionViews: getProjectionViews ?? views,
    saveProjectionBatch: async ({records, ...payload}) => {
      batchPersistenceCalls += 1
      if (saveProjectionBatchHook) return saveProjectionBatchHook({records, ...payload})
      batchRecordCounts.push(records.length)
      for (const {projectionCandidate} of records) saved.push(projectionCandidate)
      return {status: 'appended'}
    },
    saveProjectionLifecycleBatch,
    saveProjectionObservationBatch,
    saveProjectionTriggeredSnapshotBatch,
    saveEvolutionDecision: async () => ({status: 'skipped'}),
    getProjectionDeliveryRecords,
    saveProjectionDeliveryResponseBatch,
    saveProjectionDeliveryResponse,
    archiveAndReleasePregnancy,
    resolvePreConfirmationTiming,
    diagnostics,
    refreshProjectionContext: async () => {
      contextRefreshes.push(saved.length)
    },
    notify: event => statuses.push(event),
  })
  return {runtime, saved, statuses, contextRefreshes, batchRecordCounts, setInputs: next => {current = next}, get collectInputsCalls() { return collectInputsCalls }, get batchPersistenceCalls() { return batchPersistenceCalls }}
}

test('Projection Runtime batches expired lifecycle updates in one save', async () => {
  const savedRecords = []
  let viewReads = 0
  const expiredViews = Array.from({length: 7}, (_, index) => ({
    projection_id: `projection-expired-${index}`,
    tracking_scope: 'pre_confirmation',
    tracking_window_id: `window-expired-${index}`,
    factual_status: 'active',
    deleted: false,
  }))
  const fixture = createFixture({
    getProjectionViews: async () => { viewReads += 1; return {all: expiredViews} },
    saveProjectionLifecycleBatch: async ({records}) => {
      savedRecords.push(records)
      return {status: 'appended'}
    },
  })
  fixture.setInputs({...inputs(), trackingWindows: expiredViews.map(view => ({tracking_window_id: view.tracking_window_id, status: 'expired'}))})
  const result = await fixture.runtime.tickLifecycleOnly({reason: 'batch-expired-lifecycle'})
  assert.equal(result.status, 'success')
  assert.equal(result.expired_projections, 7)
  assert.equal(savedRecords.length, 1)
  assert.equal(savedRecords[0].length, 7)
  assert.deepEqual(savedRecords[0].map(record => record.action), Array(7).fill('expired'))
  assert.equal(viewReads, 2)
})

test('Projection Runtime batches factual lifecycle evolution records in one save', async () => {
  const savedRecords = []
  const evolvedRule = {...rule, realization: {event_types: ['medical_event']}}
  evolvedRule.projection_rule_id = buildProjectionRuleId(evolvedRule)
  const evolvedViews = Array.from({length: 7}, (_, index) => ({
    projection_id: `projection-realized-${index}`,
    subject_id: subject,
    projection_rule_id: evolvedRule.projection_rule_id,
    development_concern_key: evolvedRule.development_concern_key,
    factual_status: 'active',
    deleted: false,
    context_visible: true,
  }))
  const fixture = createFixture({
    getProjectionViews: async () => ({all: evolvedViews}),
    saveProjectionLifecycleBatch: async ({records}) => {
      savedRecords.push(records)
      return {status: 'appended'}
    },
  })
  fixture.setInputs({...inputs(), worldModel: {projection_rules: [evolvedRule]}, events: [{
    event_id: 'medical-event-1',
    type: 'medical_event',
    status: 'confirmed',
    state_fact: {subject_id: subject, payload: {}},
  }]})
  const result = await fixture.runtime.process({reason: 'batch-factual-lifecycle'})
  assert.equal(result.status, 'success')
  assert.equal(savedRecords.length, 1)
  assert.equal(savedRecords[0].length, 7)
  assert.deepEqual(savedRecords[0].map(record => record.action), Array(7).fill('realized'))
})

test('Projection Runtime batches all completed delivery responses in one save', async () => {
  const deliveries = Array.from({length: 23}, (_, index) => ({
    delivery_record_id: `delivery-record-${index}`,
    delivery_id: `delivery-${index}`,
    projection_id: `projection-${index}`,
    aggregation_id: `aggregation-${index}`,
    subject_id: subject,
    pregnancy_id: null,
    cycle_id: `cycle-${index}`,
    submitted_floor_version: version,
    context_fingerprint: 'context-batch',
    status: 'readback_verified',
    owner_index: 2,
    owner_swipe_id: 0,
  }))
  let savedRecords = null
  const fixture = createFixture({
    getProjectionDeliveryRecords: async () => deliveries,
    saveProjectionDeliveryResponseBatch: async ({records}) => { savedRecords = records; return {status: 'appended'} },
  })
  const result = await fixture.runtime.recordCompletedResponse({target: {index: 3, version}, execution: {generation_id: 'generation-batch'}})
  assert.equal(result.status, 'observed')
  assert.equal(result.observed, 23)
  assert.equal(savedRecords.length, 23)
  assert.equal(new Set(savedRecords.map(record => record.delivery_id)).size, 23)
})

test('Projection Runtime keeps the legacy single delivery response fallback', async () => {
  const deliveries = [{
    delivery_record_id: 'delivery-record-legacy', delivery_id: 'delivery-legacy', projection_id: 'projection-legacy',
    aggregation_id: 'aggregation-legacy', subject_id: subject, pregnancy_id: null, cycle_id: 'cycle-legacy',
    submitted_floor_version: version, context_fingerprint: 'context-legacy', status: 'readback_verified', owner_index: 2, owner_swipe_id: 0,
  }]
  const savedRecords = []
  const fixture = createFixture({
    getProjectionDeliveryRecords: async () => deliveries,
    saveProjectionDeliveryResponse: async ({deliveryRecord}) => { savedRecords.push(deliveryRecord); return {status: 'appended'} },
  })
  const result = await fixture.runtime.recordCompletedResponse({target: {index: 3, version}, execution: {generation_id: 'generation-legacy'}})
  assert.equal(result.observed, 1)
  assert.equal(savedRecords.length, 1)
  assert.equal(savedRecords[0].delivery_id, 'delivery-legacy')
})

test('Projection Runtime shares the post-analysis input and delivery snapshots', async () => {
  let deliveryReads = 0
  const timing = {
    timing_instance_id: 'timing-shared-snapshot', subject_id: subject, mechanism_key: 'fertilization', cycle_id: 'cycle-shared-snapshot',
    source_event_ids: ['event-1'], reference_story_time: {day_index: 0, display: '第 0 天'}, effective_min_story_days: 14, effective_max_story_days: 42,
  }
  const aggregation = {
    aggregation_id: 'aggregation-shared-snapshot', subject_id: subject, pregnancy_id: null, mechanism_key: 'fertilization', cycle_id: timing.cycle_id,
    status: 'succeeded', accepted_exposure_event_ids: ['event-1'],
  }
  const fixture = createFixture({
    getProjectionDeliveryRecords: async () => { deliveryReads += 1; return [] },
    saveProjectionDeliveryResponseBatch: async () => ({status: 'deduped'}),
    archiveAndReleasePregnancy: async () => ({status: 'deduped'}),
    resolvePreConfirmationTiming: async () => ({
      enabled: true,
      instances: [timing],
      windows: [{tracking_window_id: 'window-shared-snapshot', subject_id: subject, mechanism_key: timing.mechanism_key, cycle_id: timing.cycle_id, status: 'open', source_event_ids: ['event-1']}],
      aggregations: [aggregation],
    }),
  })
  fixture.setInputs({...inputs(), worldModel: {projection_rules: []}, currentStoryTime: {day_index: 17, display: '第 17 天'}})
  const result = await fixture.runtime.handleAnalysisSuccess({
    target: {index: 3, version},
    execution: {pipeline_run_id: 'pipeline-shared-snapshot'},
  })
  assert.equal(result.projection.status, 'success')
  assert.equal(fixture.collectInputsCalls, 2)
  assert.equal(deliveryReads, 1)
})

test('Projection Runtime correlates real stages to one bounded pipeline run', async () => {
  const diagnostics = createRuntimeDiagnostics()
  const fixture = createFixture({diagnostics})
  const result = await fixture.runtime.process({reason: 'factual-success'})
  assert.equal(result.status, 'success')

  const trace = diagnostics.getNsfwPipelineDiagnostics({floor_version: version})
  assert.equal(trace.runs.length, 1)
  assert.equal(trace.runs[0].execution_status, 'SUCCEEDED')
  const runIds = new Set(trace.stages.map(stage => stage.run_id))
  assert.deepEqual([...runIds], [trace.runs[0].run_id])
  assert.ok(trace.stages.some(stage => stage.stage === 'TIMING_ELIGIBILITY_EVALUATION'))
  assert.ok(trace.stages.some(stage => stage.stage === 'PROJECTION_ELIGIBILITY'))
  assert.ok(trace.stages.some(stage => stage.stage === 'PROJECTION_AI_SCHEDULING'))
  assert.ok(trace.stages.some(stage => stage.stage === 'PROJECTION_PERSISTENCE'))
  assert.ok(trace.stages.some(stage => stage.stage === 'PROJECTION_READBACK' && stage.readback_succeeded === true))
})

test('Projection Runtime records automatic performance stages without changing manual timing operations', async () => {
  const diagnostics = createRuntimeDiagnostics()
  const fixture = createFixture({diagnostics, resolvePreConfirmationTiming: async () => null})
  const result = await fixture.runtime.process({reason: 'automatic-performance-test', trigger: 'automatic'})
  assert.equal(result.status, 'success')

  const performance = diagnostics.getTimingPerformanceDiagnostics()
  assert.equal(performance.recent_operations.length, 0)
  assert.equal(performance.automatic_projection_runs.length, 1)
  const run = performance.automatic_projection_runs[0]
  assert.equal(run.status, 'SUCCEEDED')
  assert.equal(typeof run.total_duration_ms, 'number')
  assert.ok(run.stages.some(stage => stage.stage === 'INPUT_COLLECTION' && stage.call_count === 1))
  assert.ok(run.stages.some(stage => stage.stage === 'INITIAL_PROJECTION_VIEWS' && stage.read_count === 1))
  assert.ok(run.stages.some(stage => stage.stage === 'TIMING_RESOLUTION'))
  assert.ok(run.stages.some(stage => stage.stage === 'ELIGIBILITY_EVALUATION'))
  assert.ok(run.stages.some(stage => stage.stage === 'PROJECTION_PERSISTENCE'))
  assert.ok(run.stages.some(stage => stage.stage === 'FINAL_PROJECTION_READBACK'))
  assert.ok(run.stages.some(stage => stage.stage === 'PROJECTION_CONTEXT_REFRESH'))
  assert.equal(run.ai_called, true)
})

test('Projection Runtime closes automatic performance diagnostics for stale and in-flight paths', async () => {
  const staleDiagnostics = createRuntimeDiagnostics()
  const staleFixture = createFixture({diagnostics: staleDiagnostics})
  staleFixture.setInputs({...inputs(), floor: {...inputs().floor, version: {...version, message_id: 'changed'}}})
  const staleResult = await staleFixture.runtime.handleAnalysisSuccess({
    target: {index: 3, version},
    execution: {pipeline_run_id: 'pipeline-stale-performance'},
  })
  assert.equal(staleResult.status, 'stale')
  const staleRun = staleDiagnostics.getTimingPerformanceDiagnostics().automatic_projection_runs[0]
  assert.equal(staleRun.status, 'CANCELLED_STALE_CONTEXT')
  assert.equal(typeof staleRun.total_duration_ms, 'number')

  let release
  const gate = new Promise(resolve => { release = resolve })
  const inFlightDiagnostics = createRuntimeDiagnostics()
  const inFlightFixture = createFixture({
    diagnostics: inFlightDiagnostics,
    analyzer: {generateProjection: async () => {
      await gate
      return {development: {kind: 'possible_detection', description: '可能出现检测迹象。'}}
    }},
  })
  const first = inFlightFixture.runtime.process({trigger: 'in-flight-test'})
  while (inFlightDiagnostics.getTimingPerformanceDiagnostics().automatic_projection_runs.length < 1
    || !inFlightDiagnostics.getTimingPerformanceDiagnostics().automatic_projection_runs[0].stages.some(stage => stage.stage === 'ELIGIBILITY_EVALUATION')) {
    await new Promise(resolve => setImmediate(resolve))
  }
  const second = inFlightFixture.runtime.process({trigger: 'in-flight-test'})
  const runsBeforeRelease = inFlightDiagnostics.getTimingPerformanceDiagnostics().automatic_projection_runs
  assert.equal(runsBeforeRelease.length, 2)
  release()
  await Promise.all([first, second])
  const runsAfterRelease = inFlightDiagnostics.getTimingPerformanceDiagnostics().automatic_projection_runs
  const skippedRun = runsAfterRelease.find(run => run.status === 'SKIPPED')
  assert.ok(skippedRun)
  assert.equal(typeof skippedRun.total_duration_ms, 'number')
})

test('Projection Runtime business output is unchanged when diagnostics are absent', async () => {
  const withoutDiagnostics = createFixture()
  const withDiagnostics = createFixture({diagnostics: createRuntimeDiagnostics()})

  const withoutResult = await withoutDiagnostics.runtime.process({reason: 'diagnostic-equivalence'})
  const withResult = await withDiagnostics.runtime.process({reason: 'diagnostic-equivalence'})

  assert.equal(withResult.status, withoutResult.status)
  assert.deepEqual(withResult.errors, withoutResult.errors)
  assert.equal(withDiagnostics.saved.length, withoutDiagnostics.saved.length)
  assert.deepEqual(withDiagnostics.contextRefreshes, withoutDiagnostics.contextRefreshes)
})

test('Projection Runtime marks authoritative readback failures without changing the business result contract', async () => {
  const diagnostics = createRuntimeDiagnostics()
  let viewReads = 0
  const fixture = createFixture({
    diagnostics,
    getProjectionViews: async () => {
      viewReads += 1
      if (viewReads > 1) throw Object.assign(new Error('PROJECTION_READBACK_UNAVAILABLE'), {code: 'PROJECTION_READBACK_UNAVAILABLE'})
      return {all: fixture?.saved?.map(item => ({...item, factual_status: 'active', deleted: false, context_visible: true})) ?? []}
    },
  })
  const result = await fixture.runtime.process({reason: 'readback-regression'})
  assert.equal(result.status, 'failed')
  const trace = diagnostics.getNsfwPipelineDiagnostics({floor_version: version})
  assert.ok(trace.stages.some(stage => stage.stage === 'PROJECTION_READBACK' && stage.execution_status === 'READBACK_FAILED'))
  assert.equal(trace.runs[0].execution_status, 'FAILED')
})

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

test('Projection Runtime business DTO keeps presentation-safe timing fields', async () => {
  const fixture = createFixture()
  await fixture.runtime.process({reason: 'projection-dto-timing'})
  const business = await fixture.runtime.getBusinessData()
  assert.equal(business.projections.length, 1)
  assert.deepEqual(business.projections[0].timing, {
    reference_story_time: {day_index: 3, display: '第 3 天'},
    current_story_time: {day_index: 3, display: '第 3 天'},
  })
})

test('Projection Runtime resolves reused built-in stage DTO from current Story Time', async () => {
  const fixture = createFixture({
    getProjectionViews: async () => ({all: [{
      projection_id: 'projection-reused-stage',
      subject_id: subject,
      projection_rule_id: 'rule-reused-stage',
      development_concern_key: 'pre_confirmation_observation:nausea',
      tracking_scope: 'pre_confirmation',
      aggregation_path: 'participant_aggregation',
      aggregation_evidence: {subject_id: subject, aggregation_id: 'aggregation-reused-stage', pregnancy_id: null, cycle_id: 'cycle-reused-stage', accepted_exposure_event_ids: ['event-1'], participant_exposure_mapping: [{participant_id: 'participant-a', exposure_event_ids: ['event-1']}]},
      factual_status: 'active',
      deleted: false,
      context_visible: true,
      development: {kind: 'possible_biological_change', next_signal: '可能出现恶心。'},
      source_event_ids: [],
      timing: {reference_story_time: {day_index: 0}, current_story_time: {day_index: 30}, elapsed_story_days: 30},
    }]}),
  })
  const business = await fixture.runtime.getBusinessData({businessData: {
    current_floor: {version},
    active_events: [],
    current_story_time: {day_index: 31, display: '第 31 天'},
  }})
  assert.deepEqual(business.projections[0].timing, {
    reference_story_time: {day_index: 0},
    current_story_time: {day_index: 31, display: '第 31 天'},
    observation_stage_key: 'more_obvious_reactions',
    observation_stage_code: '1-3',
  })
})

test('Projection Runtime derives a current observed-reaction badge without realizing the Projection', async () => {
  const event = {
    event_id: 'event-nausea',
    type: 'physical_symptom',
    status: 'confirmed',
    story_time: {day_index: 23, display: '第 23 天'},
    source_evidence: [{type: 'narrative', text: '正文记录恶心'}],
    state_fact: {subject_id: subject, payload: {symptom: {kind: 'nausea', description: '闻到气味后恶心', health_role: 'observation'}}},
  }
  const fixture = createFixture({
    getProjectionViews: async () => ({all: [{
      projection_id: 'projection-observed-nausea',
      subject_id: subject,
      projection_rule_id: 'rule-observed-nausea',
      development_concern_key: 'pre_confirmation_observation:nausea',
      tracking_scope: 'pre_confirmation',
      aggregation_path: 'participant_aggregation',
      factual_status: 'active',
      deleted: false,
      development: {next_signal: '可能出现恶心。', kind: 'possible_biological_change'},
      aggregation_evidence: {
        subject_id: subject,
        aggregation_id: 'aggregation-observed-nausea',
        pregnancy_id: null,
        cycle_id: 'cycle-observed-nausea',
        accepted_exposure_event_ids: ['event-1'],
        participant_exposure_mapping: [{participant_id: 'participant-a', exposure_event_ids: ['event-1']}],
      },
      timing: {
        reference_story_time: {day_index: 0, display: '第 0 天'},
        current_story_time: {day_index: 23, display: '第 23 天'},
        elapsed_story_days: 23,
      },
      source_event_ids: [],
    }]}),
  })
  const businessData = {current_floor: {version}, active_events: [event]}
  const business = await fixture.runtime.getBusinessData({businessData})
  assert.equal(business.projections[0].observed_reaction.matched, true)
  assert.equal(business.projections[0].status, 'active')
  assert.equal(business.projections[0].lifecycle.factual_status, 'active')
  assert.equal(business.projection_observed_reaction_debug, undefined)
  const debug = await fixture.runtime.getBusinessData({businessData, includeDebug: true})
  assert.equal(debug.projection_observed_reaction_debug[0].reason_code, 'REACTION_CONCEPT_MATCH')
  assert.equal(debug.projection_observed_reaction_debug[0].projection_concept, 'nausea')
  assert.equal(debug.projection_observed_reaction_debug[0].match_mode, 'STRUCTURED_KIND_AND_DESCRIPTION')
  assert.deepEqual(debug.projection_observed_reaction_debug[0].matched_event_ids, ['event-nausea'])
  assert.equal(debug.projection_observed_reaction_debug[0].recognition.matched, true)
  assert.equal(debug.projection_observed_reaction_debug[0].persisted.latest_action, null)
  assert.equal(debug.projection_observed_reaction_debug[0].persisted.status_code, 'NO_RELEVANT_OBSERVATION_RECORD')
  assert.equal(debug.projection_observed_reaction_debug[0].final_usage.product.status_code, 'PRODUCT_BADGE_MATCHED')
  assert.equal(debug.projection_observed_reaction_debug[0].final_usage.context.status_code, 'CONTEXT_NOT_ELIGIBLE')
  assert.doesNotMatch(JSON.stringify(debug.projection_observed_reaction_debug[0]), /闻到气味后恶心|正文记录恶心/)
})

test('Projection Runtime keeps recognition current-derived when only a persisted observation exists', async () => {
  const baseView = concept => ({
    projection_id: `projection-persisted-${concept}`,
    subject_id: subject,
    projection_rule_id: `rule-persisted-${concept}`,
    development_concern_key: `pre_confirmation_observation:${concept}`,
    tracking_scope: 'pre_confirmation', tracking_window_id: `window-${concept}`,
    aggregation_path: 'participant_aggregation', factual_status: 'active', deleted: false,
    context_visible: true,
    development: {next_signal: `可能出现${concept}。`, kind: 'possible_biological_change'},
    aggregation_evidence: {subject_id: subject, aggregation_id: `aggregation-${concept}`, pregnancy_id: null, cycle_id: `cycle-${concept}`, accepted_exposure_event_ids: ['event-1'], participant_exposure_mapping: [{participant_id: 'participant-a', exposure_event_ids: ['event-1']}]},
    timing: {reference_story_time: {day_index: 0}, current_story_time: {day_index: 23}, elapsed_story_days: 23},
    source_event_ids: [], observation_records: [],
  })
  const persistedOnly = baseView('nausea')
  persistedOnly.observation_records = [{projection_id: persistedOnly.projection_id, subject_id: subject, action: 'triggered', reaction_concept: 'nausea', event_ids: ['event-old'], created_at_floor_version: {...version, floor: 20, message_id: 'message-20'}}]
  const unrelated = baseView('fatigue')
  unrelated.observation_records = [
    {projection_id: unrelated.projection_id, subject_id: subject, action: 'triggered', reaction_concept: 'fatigue', event_ids: ['event-old-fatigue'], created_at_floor_version: {...version, floor: 20, message_id: 'message-20'}},
    {projection_id: unrelated.projection_id, subject_id: subject, action: 'revoked', reaction_concept: 'fatigue', event_ids: ['event-old-fatigue'], created_at_floor_version: {...version, floor: 21, message_id: 'message-21'}},
    {projection_id: unrelated.projection_id, subject_id: subject, action: 'triggered', reaction_concept: 'nausea', event_ids: ['event-unrelated'], created_at_floor_version: {...version, floor: 22, message_id: 'message-22'}},
  ]
  const fixture = createFixture({getProjectionViews: async () => ({all: [persistedOnly, unrelated], observation_records: [...persistedOnly.observation_records, ...unrelated.observation_records]})})
  const debug = await fixture.runtime.getBusinessData({businessData: {current_floor: {version}, active_events: []}, includeDebug: true})
  const nausea = debug.projection_observed_reaction_debug.find(item => item.projection_concept === 'nausea')
  const fatigue = debug.projection_observed_reaction_debug.find(item => item.projection_concept === 'fatigue')
  assert.equal(nausea.recognition.matched, false)
  assert.equal(nausea.recognition.match_mode, null)
  assert.equal(nausea.persisted.latest_action, 'triggered')
  assert.equal(nausea.persisted.status_code, 'RELEVANT_OBSERVATION_RECORD_READ')
  assert.equal(nausea.final_usage.product.status_code, 'PRODUCT_BADGE_MATCHED')
  assert.equal(fatigue.persisted.latest_action, 'revoked')
  assert.equal(fatigue.persisted.status_code, 'RELEVANT_OBSERVATION_RECORD_READ')
  assert.equal(fatigue.final_usage.product.status_code, 'PRODUCT_BADGE_NOT_MATCHED')
})

test('Projection Runtime exposes old-stage history in bounded debug usage summary', async () => {
  const currentView = {
    projection_id: 'projection-current-history-debug', subject_id: subject,
    projection_rule_id: 'rule-current-history-debug', development_concern_key: 'pre_confirmation_observation:nausea',
    tracking_scope: 'pre_confirmation', factual_status: 'active', deleted: false, context_visible: true,
    development: {next_signal: '可能出现恶心。', kind: 'possible_biological_change'}, timing: {reference_story_time: {day_index: 0}}, source_event_ids: [], observation_records: [],
  }
  const oldObservation = {projection_id: 'projection-old-history-debug', subject_id: subject, action: 'triggered', reaction_concept: 'nausea', event_ids: ['event-old'], created_at_floor_version: {...version, floor: 20, message_id: 'message-20'}}
  const fixture = createFixture({getProjectionViews: async () => ({all: [currentView], observation_records: [oldObservation]})})
  const debug = await fixture.runtime.getBusinessData({businessData: {current_floor: {version}, current_story_time: {day_index: 28}, active_events: []}, includeDebug: true})
  assert.deepEqual(debug.projection_observed_reaction_history, [{subject_id: subject, reaction_concept: 'nausea', reaction_label: '恶心', projection_id: 'projection-old-history-debug'}])
})

test('Projection Runtime persists triggered and manual revoked observations, but health recovery does not revoke', async () => {
  const diagnostics = createRuntimeDiagnostics()
  const event = {
    event_id: 'event-runtime-observation',
    type: 'physical_symptom',
    status: 'confirmed',
    story_time: {day_index: 23, display: '第 23 天'},
    source_evidence: [{type: 'narrative', text: '正文记录恶心'}],
    state_fact: {subject_id: subject, payload: {symptom: {kind: 'nausea', description: '闻到气味后恶心', health_role: 'observation'}}},
  }
  const view = {
    projection_id: 'projection-runtime-observation', subject_id: subject,
    projection_rule_id: 'rule-runtime-observation', development_concern_key: 'pre_confirmation_observation:nausea',
    tracking_scope: 'pre_confirmation', tracking_window_id: 'window-runtime-observation',
    aggregation_path: 'participant_aggregation', factual_status: 'active', deleted: false, context_visible: true,
    development: {next_signal: '可能出现恶心。', kind: 'possible_biological_change'},
    aggregation_evidence: {subject_id: subject, aggregation_id: 'aggregation-runtime-observation', pregnancy_id: null, cycle_id: 'cycle-runtime-observation', accepted_exposure_event_ids: ['event-1'], participant_exposure_mapping: [{participant_id: 'participant-a', exposure_event_ids: ['event-1']}]},
    timing: {reference_story_time: {day_index: 0, display: '第 0 天'}, current_story_time: {day_index: 23, display: '第 23 天'}, elapsed_story_days: 23},
    source_event_ids: [], observation_records: [],
  }
  const saved = []
  let observationSaveCalls = 0
  const fixture = createFixture({
    diagnostics,
    getProjectionViews: async () => ({all: [view], observation_records: view.observation_records}),
    saveProjectionObservationBatch: async ({records}) => {
      observationSaveCalls += 1
      saved.push(...records)
      view.observation_records.push(...records)
      return {status: 'appended'}
    },
  })
  fixture.setInputs({...inputs(), events: [event], currentStoryTime: {day_index: 23, display: '第 23 天'}})
  await fixture.runtime.process({reason: 'event-edit'})
  assert.deepEqual(saved.map(record => record.action), ['triggered'])

  const editedEvent = {...event, state_fact: {...event.state_fact, payload: {...event.state_fact.payload, symptom: {...event.state_fact.payload.symptom, description: '轻微恶心'}}}}
  fixture.setInputs({...inputs(), events: [editedEvent], currentStoryTime: {day_index: 23, display: '第 23 天'}})
  await fixture.runtime.process({reason: 'event-edit'})
  assert.deepEqual(saved.map(record => record.action), ['triggered', 'triggered'])
  assert.equal(observationSaveCalls, 2)

  await fixture.runtime.process({reason: 'projection-refresh'})
  assert.deepEqual(saved.map(record => record.action), ['triggered', 'triggered'])
  assert.equal(observationSaveCalls, 2)

  fixture.setInputs({...inputs(), events: [], currentStoryTime: {day_index: 23, display: '第 23 天'}})
  await fixture.runtime.process({reason: 'health-recovery-expiration'})
  assert.deepEqual(saved.map(record => record.action), ['triggered', 'triggered'])

  fixture.setInputs({...inputs(), floor: {index: 4, swipeId: 0, version: {...version, floor: 4, message_id: 'message-4'}}, events: [], currentStoryTime: {day_index: 23, display: '第 23 天'}})
  await fixture.runtime.process({reason: 'event-delete'})
  assert.deepEqual(saved.map(record => record.action), ['triggered', 'triggered', 'revoked'])

  fixture.setInputs({...inputs(), floor: {index: 5, swipeId: 0, version: {...version, floor: 5, message_id: 'message-5'}}, events: [event], currentStoryTime: {day_index: 23, display: '第 23 天'}})
  const unchangedResult = await fixture.runtime.process({reason: 'projection-refresh'})
  assert.equal(unchangedResult.status, 'success')
  assert.deepEqual(saved.map(record => record.action), ['triggered', 'triggered', 'revoked'])
  assert.equal(observationSaveCalls, 3)

  fixture.setInputs({...inputs(), floor: {index: 6, swipeId: 0, version: {...version, floor: 6, message_id: 'message-6'}}, events: [{...event, event_id: 'event-runtime-observation-updated'}], currentStoryTime: {day_index: 23, display: '第 23 天'}})
  await fixture.runtime.process({reason: 'projection-refresh'})
  assert.deepEqual(saved.map(record => record.action), ['triggered', 'triggered', 'revoked', 'triggered'])
  assert.equal(observationSaveCalls, 4)

  const trace = diagnostics.getNsfwPipelineDiagnostics({chat_id: version.chat_id, floor_version: version})
  assert.ok(trace.stages.some(stage => stage.stage === 'PROJECTION_OBSERVATION_PERSISTENCE' && stage.reason_code === 'PROJECTION_OBSERVATION_PERSISTED'))
  assert.ok(trace.stages.some(stage => stage.stage === 'PROJECTION_OBSERVATION_PERSISTENCE' && stage.reason_code === 'PROJECTION_OBSERVATION_PERSISTED' && stage.output_count === 1))
  assert.ok(trace.stages.some(stage => stage.stage === 'PROJECTION_OBSERVATION_PERSISTENCE' && stage.reason_code === 'PROJECTION_OBSERVATION_DEDUPED'))
  assert.ok(trace.stages.some(stage => stage.stage === 'PROJECTION_OBSERVATION_READBACK' && stage.readback_succeeded === true))
})

test('Projection Runtime product DTO clears historical reactions at day 43 using the authoritative Story Time', async () => {
  const currentView = {
    projection_id: 'projection-current-day-28', subject_id: subject,
    projection_rule_id: 'rule-current-day-28', development_concern_key: 'pre_confirmation_observation:nausea',
    tracking_scope: 'pre_confirmation', factual_status: 'active', deleted: false, context_visible: true,
    development: {next_signal: '可能出现恶心。', kind: 'possible_biological_change'},
    timing: {reference_story_time: {day_index: 0, display: '第 0 天'}, current_story_time: {day_index: 28, display: '第 28 天'}, elapsed_story_days: 28},
    source_event_ids: [], observation_records: [],
  }
  const oldObservation = {
    projection_id: 'projection-old-stage', subject_id: subject, action: 'triggered', reaction_concept: 'nausea',
    created_at_floor_version: {...version, floor: 20, message_id: 'message-20'},
  }
  const fixture = createFixture({
    getProjectionViews: async () => ({all: [currentView], observation_records: [oldObservation]}),
  })
  const business = await fixture.runtime.getBusinessData({businessData: {
    current_floor: {version}, current_story_time: {day_index: 43, display: '第 43 天'}, active_events: [],
  }})
  assert.deepEqual(business.projection_summary.historical_observed_reactions, [])
  assert.equal(business.projections.some(item => item.id === 'projection-old-stage'), false)
})

test('Projection Runtime DTO exposes only the validated aggregated candidate count', async () => {
  const participantIds = ['participant-a', 'participant-b']
  const fixture = createFixture({
    getProjectionViews: async () => ({all: [
      {
        projection_id: 'projection-safe-count',
        subject_id: subject,
        projection_rule_id: 'rule-safe-count',
        development_concern_key: 'pre_confirmation_observation:fatigue',
        tracking_scope: 'pre_confirmation',
        factual_status: 'active',
        deleted: false,
        development: {next_signal: '可能出现疲倦。', kind: 'possible_biological_change'},
        aggregation_evidence: {
          subject_id: subject,
          aggregation_id: 'aggregation-safe-count',
          pregnancy_id: null,
          cycle_id: 'cycle-safe-count',
          accepted_exposure_event_ids: ['event-1'],
          participant_exposure_mapping: participantIds.map(participant_id => ({participant_id, exposure_event_ids: ['event-1']})),
        },
        timing: {},
        source_event_ids: [],
      },
      {
        projection_id: 'projection-invalid-preconfirmation',
        subject_id: subject,
        projection_rule_id: 'rule-invalid',
        development_concern_key: 'pre_confirmation_observation:nausea',
        tracking_scope: 'pre_confirmation',
        factual_status: 'active',
        deleted: false,
        development: {next_signal: '不应显示。', kind: 'possible_biological_change'},
        timing: {},
        source_event_ids: [],
      },
      {
        projection_id: 'projection-generic',
        subject_id: subject,
        projection_rule_id: 'rule-generic',
        development_concern_key: 'detection',
        tracking_scope: 'general',
        factual_status: 'active',
        deleted: false,
        development: {next_signal: '通用推演。', kind: 'possible_detection'},
        timing: {},
        source_event_ids: [],
      },
    ]}),
  })
  const business = await fixture.runtime.getBusinessData()
  assert.equal(business.projections.length, 2)
  assert.equal(business.projections.find(item => item.id === 'projection-safe-count').aggregated_candidate_count, participantIds.length)
  assert.ok(business.projections.some(item => item.id === 'projection-generic'))
  assert.ok(!business.projections.some(item => item.id === 'projection-invalid-preconfirmation'))
  assert.doesNotMatch(JSON.stringify(business), /participant-a|participant-b|不应显示/u)
})

test('Projection Runtime creates the current staged built-in candidates after participant aggregation without projection rules', async () => {
  let analyzerCalls = 0
  const timing = {
    timing_instance_id: 'timing-built-in-empty-rules',
    subject_id: subject,
    mechanism_key: 'fertilization',
    cycle_id: 'cycle-built-in-empty-rules',
    source_event_ids: ['event-1'],
    reference_story_time: {day_index: 0, display: '第 0 天'},
    effective_min_story_days: 14,
    effective_max_story_days: 42,
  }
  const aggregation = {
    aggregation_id: 'aggregation-built-in-empty-rules',
    subject_id: subject,
    pregnancy_id: null,
    mechanism_key: timing.mechanism_key,
    cycle_id: timing.cycle_id,
    status: 'succeeded',
    accepted_exposure_event_ids: ['event-1'],
  }
  const fixture = createFixture({
    diagnostics: createRuntimeDiagnostics(),
    analyzer: {generateProjection: async () => {
      analyzerCalls += 1
      throw new Error('BUILT_IN_CANDIDATE_MUST_NOT_REQUIRE_ANALYZER')
    }},
    resolvePreConfirmationTiming: async () => ({
      enabled: true,
      instances: [timing],
      windows: [{
        tracking_window_id: 'window-built-in-empty-rules',
        subject_id: subject,
        mechanism_key: timing.mechanism_key,
        cycle_id: timing.cycle_id,
        status: 'open',
        source_event_ids: ['event-1'],
      }],
      aggregations: [aggregation],
    }),
  })
  fixture.setInputs({...inputs(), worldModel: {projection_rules: []}, currentStoryTime: {day_index: 17, display: '第 17 天'}})

  const result = await fixture.runtime.process({reason: 'built-in-empty-rules'})

  assert.equal(result.status, 'success')
  assert.equal(analyzerCalls, 0)
  assert.equal(fixture.saved.length, 4)
  assert.ok(fixture.saved.every(item => item.aggregation_path === 'participant_aggregation'))
  assert.ok(fixture.saved.every(item => item.aggregation_evidence.pregnancy_id === null))
  assert.deepEqual(
    fixture.saved.map(item => item.development_concern_key).sort(),
    ['pre_confirmation_observation:breast_sensitivity', 'pre_confirmation_observation:fatigue', 'pre_confirmation_observation:no_reaction_early', 'pre_confirmation_observation:scent_food_change'],
  )
  assert.ok(fixture.saved.some(item => /更早想休息/.test(item.development.next_signal)))
  assert.ok(fixture.saved.some(item => /暂时没有明显身体表现/.test(item.development.next_signal)))
  assert.ok(fixture.saved.every(item => item.development.next_signal.includes('不是已确认怀孕事实') || item.development.next_signal.includes('不能据此确认未孕')))
  assert.ok(fixture.saved.every(item => item.timing.trigger_kind === 'elapsed_after_event'))
  assert.ok(fixture.saved.every(item => item.timing.reference_story_time?.day_index === 0))
  assert.ok(fixture.saved.every(item => item.timing.current_story_time?.day_index === 17))
  assert.ok(fixture.saved.every(item => !Object.hasOwn(item.timing, 'elapsed_story_days')))
  const trace = fixture.statuses.find(event => event.payload?.stage === 'PROJECTION_BUILT_IN_CANDIDATE_COMPLETED')
  assert.equal(trace.payload.projection_candidate_source, 'built_in_pre_confirmation')
  const scheduling = fixture.statuses.find(event => event.payload?.stage === 'PROJECTION_AI_PLAN')
  assert.equal(scheduling.payload.ai_call_will_start, false)
  assert.equal(fixture.statuses.some(event => event.payload?.stage === 'PROJECTION_BUILT_IN_CANDIDATE'), true)
})

test('Projection Runtime reuses a complete built-in stage without generation or persistence', async () => {
  let analyzerCalls = 0
  const timing = {
    timing_instance_id: 'timing-stage-reuse', subject_id: subject, mechanism_key: 'fertilization', cycle_id: 'cycle-stage-reuse',
    source_event_ids: ['event-1'], reference_story_time: {day_index: 0, display: '第 0 天'}, effective_min_story_days: 14, effective_max_story_days: 42,
  }
  const aggregation = {aggregation_id: 'aggregation-stage-reuse', subject_id: subject, pregnancy_id: null, mechanism_key: 'fertilization', cycle_id: 'cycle-stage-reuse', status: 'succeeded', accepted_exposure_event_ids: ['event-1']}
  const fixture = createFixture({
    analyzer: {generateProjection: async () => { analyzerCalls += 1; throw new Error('SAME_STAGE_MUST_REUSE') }},
    resolvePreConfirmationTiming: async () => ({enabled: true, instances: [timing], windows: [{tracking_window_id: 'window-stage-reuse', subject_id: subject, mechanism_key: 'fertilization', cycle_id: 'cycle-stage-reuse', status: 'open', source_event_ids: ['event-1']}], aggregations: [aggregation]}),
  })
  fixture.setInputs({...inputs(), worldModel: {projection_rules: []}, currentStoryTime: {day_index: 17, display: '第 17 天'}})
  assert.equal((await fixture.runtime.process({reason: 'stage-reuse-first'})).status, 'success')
  assert.equal((await fixture.runtime.process({reason: 'stage-reuse-second'})).status, 'success')
  assert.equal(analyzerCalls, 0)
  assert.equal(fixture.batchPersistenceCalls, 1)
  assert.equal(fixture.saved.length, 4)
  assert.equal(fixture.statuses.filter(event => event.payload?.stage === 'PROJECTION_STAGE_REUSED').length, 1)
  assert.equal(fixture.statuses.find(event => event.payload?.stage === 'PROJECTION_STAGE_REUSED')?.payload?.reused_candidate_count, 4)
})

test('Projection Runtime internal route defers custom Projection API work', async () => {
  let analyzerCalls = 0
  const fixture = createFixture({
    analyzer: {generateProjection: async () => {
      analyzerCalls += 1
      return {development: {kind: 'possible_detection', description: '不应在内部路线调用。'}}
    }},
  })

  const result = await fixture.runtime.processInternal({reason: 'settled-floor-internal'})

  assert.equal(result.status, 'success')
  assert.equal(analyzerCalls, 0)
  assert.equal(fixture.saved.length, 0)
})

test('Projection Runtime replaces a built-in stage with one batch and no old-stage lifecycle', async () => {
  const lifecycleRecords = []
  const timing = {
    timing_instance_id: 'timing-stage-replacement', subject_id: subject, mechanism_key: 'fertilization', cycle_id: 'cycle-stage-replacement',
    source_event_ids: ['event-1'], reference_story_time: {day_index: 0, display: '第 0 天'}, effective_min_story_days: 14, effective_max_story_days: 42,
  }
  const aggregation = {aggregation_id: 'aggregation-stage-replacement', subject_id: subject, pregnancy_id: null, mechanism_key: 'fertilization', cycle_id: 'cycle-stage-replacement', status: 'succeeded', accepted_exposure_event_ids: ['event-1']}
  const fixture = createFixture({
    analyzer: {generateProjection: async () => { throw new Error('BUILT_IN_MUST_NOT_USE_ANALYZER') }},
    saveProjectionLifecycleBatch: async ({records}) => { lifecycleRecords.push(...records); return {status: 'appended'} },
    resolvePreConfirmationTiming: async () => ({enabled: true, instances: [timing], windows: [{tracking_window_id: 'window-stage-replacement', subject_id: subject, mechanism_key: 'fertilization', cycle_id: 'cycle-stage-replacement', status: 'open', source_event_ids: ['event-1']}], aggregations: [aggregation]}),
  })
  fixture.setInputs({...inputs(), worldModel: {projection_rules: []}, currentStoryTime: {day_index: 17, display: '第 17 天'}})
  assert.equal((await fixture.runtime.process({reason: 'stage-replacement-before'})).status, 'success')
  fixture.setInputs({...inputs(), worldModel: {projection_rules: []}, currentStoryTime: {day_index: 23, display: '第 23 天'}})
  const result = await fixture.runtime.process({reason: 'stage-replacement-after'})
  assert.equal(result.status, 'success')
  assert.equal(fixture.batchPersistenceCalls, 2)
  assert.equal(fixture.saved.length, 8)
  assert.equal(fixture.batchRecordCounts[1], 4)
  assert.equal(lifecycleRecords.length, 0)
  assert.ok(fixture.saved.slice(4).every(item => ['nausea', 'odor_discomfort', 'mood_change', 'appetite_change'].some(branch => item.development_concern_key.endsWith(branch))))
  const snapshots = fixture.statuses.filter(event => event.payload?.stage === 'PROJECTION_STAGE_SNAPSHOT')
  assert.deepEqual(snapshots.map(event => event.payload?.snapshot_status), ['planned', 'succeeded', 'planned', 'succeeded'])
})

test('Projection Runtime does not persist an incomplete built-in stage batch', async () => {
  const timing = {
    timing_instance_id: 'timing-stage-incomplete', subject_id: subject, mechanism_key: 'fertilization', cycle_id: 'cycle-stage-incomplete',
    source_event_ids: ['event-1'], reference_story_time: {day_index: 0, display: '第 0 天'}, effective_min_story_days: 14, effective_max_story_days: 42,
  }
  const aggregation = {aggregation_id: 'aggregation-stage-incomplete', subject_id: subject, pregnancy_id: null, mechanism_key: 'fertilization', cycle_id: 'cycle-stage-incomplete', status: 'succeeded', accepted_exposure_event_ids: ['event-1']}
  const earlyRules = buildBuiltInPreConfirmationRules({enabled: true, instances: [timing], windows: [], aggregations: [aggregation]})
  const existingRule = earlyRules.find(rule => rule.development_concern_key.endsWith('fatigue'))
  const existing = createProjection({
    subject_id: subject,
    projection_rule_id: existingRule.projection_rule_id,
    development_concern_key: existingRule.development_concern_key,
    mechanism: {key: 'fertilization', world_model_rule_refs: []},
    source_event_ids: ['event-1'],
    development: {kind: existingRule.development_kind, current_basis: {event_ids: ['event-1'], state_refs: [], mechanism_rule_refs: []}, next_signal: '已有分支'},
    timing: {trigger_kind: 'elapsed_after_event', reference_event_id: 'event-1', reference_story_time: {day_index: 0, display: '第 0 天'}, current_story_time: {day_index: 17, display: '第 17 天'}, elapsed_story_days: 17},
    created_at_floor_version: version,
    evidence_refs: ['event:event-1'],
    tracking_scope: 'pre_confirmation',
    tracking_window_id: 'window-stage-incomplete',
    aggregation_path: 'participant_aggregation',
    aggregation_evidence: {subject_id: subject, aggregation_id: aggregation.aggregation_id, pregnancy_id: null, cycle_id: aggregation.cycle_id, accepted_exposure_event_ids: ['event-1'], participant_exposure_mapping: [{participant_id: 'participant-a', exposure_event_ids: ['event-1']}]},
  })
  const fixture = createFixture({
    analyzer: {generateProjection: async () => { throw new Error('BUILT_IN_MUST_NOT_USE_ANALYZER') }},
    getProjectionViews: async () => ({all: [{...existing, factual_status: 'active', deleted: false, context_visible: true}]}),
    resolvePreConfirmationTiming: async () => ({enabled: true, instances: [timing], windows: [{tracking_window_id: 'window-stage-incomplete', subject_id: subject, mechanism_key: 'fertilization', cycle_id: timing.cycle_id, status: 'open', source_event_ids: ['event-1']}], aggregations: [aggregation]}),
  })
  fixture.setInputs({...inputs(), worldModel: {projection_rules: []}, currentStoryTime: {day_index: 17, display: '第 17 天'}})

  const result = await fixture.runtime.process({reason: 'stage-incomplete'})

  assert.equal(result.status, 'partial')
  assert.equal(fixture.batchPersistenceCalls, 0)
  assert.equal(fixture.saved.length, 0)
  assert.equal(fixture.statuses.some(event => event.payload?.snapshot_status === 'succeeded'), false)
})

test('Projection Runtime changes the built-in candidate set with the current observation stage', async () => {
  const runAt = async day => {
    const timing = {
      timing_instance_id: `timing-built-in-stage-${day}`,
      subject_id: subject,
      mechanism_key: 'fertilization',
      cycle_id: `cycle-built-in-stage-${day}`,
      source_event_ids: ['event-1'],
      reference_story_time: {day_index: 0, display: '第 0 天'},
      effective_min_story_days: 14,
      effective_max_story_days: 42,
    }
    const aggregation = {
      aggregation_id: `aggregation-built-in-stage-${day}`,
      subject_id: subject,
      pregnancy_id: null,
      mechanism_key: timing.mechanism_key,
      cycle_id: timing.cycle_id,
      status: 'succeeded',
      accepted_exposure_event_ids: ['event-1'],
    }
    const fixture = createFixture({
      analyzer: {generateProjection: async () => { throw new Error('BUILT_IN_CANDIDATE_MUST_NOT_REQUIRE_ANALYZER') }},
      resolvePreConfirmationTiming: async () => ({
        enabled: true,
        instances: [timing],
        windows: [{tracking_window_id: `window-built-in-stage-${day}`, subject_id: subject, mechanism_key: timing.mechanism_key, cycle_id: timing.cycle_id, status: 'open', source_event_ids: ['event-1']}],
        aggregations: [aggregation],
      }),
    })
    fixture.setInputs({...inputs(), worldModel: {projection_rules: []}, currentStoryTime: {day_index: day, display: `第 ${day} 天`}})
    await fixture.runtime.process({reason: `built-in-stage-${day}`})
    return fixture.saved.map(item => item.development_concern_key.split(':').at(-1)).sort()
  }
  assert.deepEqual(await runAt(23), ['appetite_change', 'mood_change', 'nausea', 'odor_discomfort'])
  assert.deepEqual(await runAt(35), ['nausea_worsening', 'no_reaction_late', 'persistent_fatigue', 'vomiting'])
})

test('Projection Runtime creates time-eligible built-in branches for every complete subject', async () => {
  const secondSubject = 'char_000003'
  const secondEvent = structuredClone(inputs().events[0])
  secondEvent.event_id = 'event-2'
  secondEvent.pregnancy_relevance.gestational_subject_ids = [secondSubject]
  const timingFor = (subjectId, cycleId, eventId, timingId) => ({
    timing_instance_id: timingId,
    subject_id: subjectId,
    mechanism_key: 'fertilization',
    cycle_id: cycleId,
    source_event_ids: [eventId],
    reference_story_time: {day_index: 0, display: '第 0 天'},
    effective_min_story_days: 14,
    effective_max_story_days: 42,
  })
  const aggregationFor = (subjectId, cycleId, aggregationId, eventId) => ({
    aggregation_id: aggregationId,
    subject_id: subjectId,
    pregnancy_id: null,
    mechanism_key: 'fertilization',
    cycle_id: cycleId,
    status: 'succeeded',
    accepted_exposure_event_ids: [eventId],
  })
  const fixture = createFixture({
    analyzer: {generateProjection: async () => { throw new Error('BUILT_IN_CANDIDATE_MUST_NOT_REQUIRE_ANALYZER') }},
    resolvePreConfirmationTiming: async () => ({
      enabled: true,
      instances: [
        timingFor(subject, 'cycle-subject-1', 'event-1', 'timing-subject-1'),
        timingFor(secondSubject, 'cycle-subject-2', 'event-2', 'timing-subject-2'),
      ],
      windows: [
        {tracking_window_id: 'window-subject-1', subject_id: subject, mechanism_key: 'fertilization', cycle_id: 'cycle-subject-1', status: 'open', source_event_ids: ['event-1']},
        {tracking_window_id: 'window-subject-2', subject_id: secondSubject, mechanism_key: 'fertilization', cycle_id: 'cycle-subject-2', status: 'open', source_event_ids: ['event-2']},
      ],
      aggregations: [
        aggregationFor(subject, 'cycle-subject-1', 'aggregation-subject-1', 'event-1'),
        aggregationFor(secondSubject, 'cycle-subject-2', 'aggregation-subject-2', 'event-2'),
      ],
    }),
  })
  fixture.setInputs({...inputs(), currentState: {characters: {[subject]: {reproductive_capabilities: {}}, [secondSubject]: {reproductive_capabilities: {}}}}, events: [inputs().events[0], secondEvent], worldModel: {projection_rules: []}, currentStoryTime: {day_index: 17, display: '第 17 天'}})

  const result = await fixture.runtime.process({reason: 'built-in-two-subjects'})

  assert.equal(result.status, 'success')
  assert.equal(fixture.saved.length, 8)
  assert.equal(fixture.collectInputsCalls, 2)
  assert.equal(fixture.batchPersistenceCalls, 1)
  assert.deepEqual(fixture.batchRecordCounts, [8])
  assert.deepEqual(
    Object.fromEntries([subject, secondSubject].map(subjectId => [subjectId, fixture.saved.filter(item => item.subject_id === subjectId).length])),
    {[subject]: 4, [secondSubject]: 4},
  )
  assert.ok(fixture.saved.every(item => !Object.hasOwn(item.timing, 'elapsed_story_days')))
})

test('Projection Runtime keeps a subject eligible when one frozen source is missing from the current snapshot', async () => {
  const fixture = createFixture({
    analyzer: {generateProjection: async () => { throw new Error('BUILT_IN_CANDIDATE_MUST_NOT_REQUIRE_ANALYZER') }},
    resolvePreConfirmationTiming: async () => ({
      enabled: true,
      instances: [{
        timing_instance_id: 'timing-partial-current',
        subject_id: subject,
        mechanism_key: 'fertilization',
        cycle_id: 'cycle-partial-current',
        source_event_ids: ['event-1', 'event-missing'],
        reference_story_time: {day_index: 0, display: '第 0 天'},
        effective_min_story_days: 14,
        effective_max_story_days: 42,
      }],
      windows: [{
        tracking_window_id: 'window-partial-current',
        subject_id: subject,
        mechanism_key: 'fertilization',
        cycle_id: 'cycle-partial-current',
        status: 'open',
        source_event_ids: ['event-1', 'event-missing'],
      }],
      aggregations: [{
        aggregation_id: 'aggregation-partial-current',
        subject_id: subject,
        pregnancy_id: null,
        mechanism_key: 'fertilization',
        cycle_id: 'cycle-partial-current',
        status: 'succeeded',
        accepted_exposure_event_ids: ['event-1', 'event-missing'],
      }],
    }),
  })
  fixture.setInputs({...inputs(), worldModel: {projection_rules: []}, currentStoryTime: {day_index: 17, display: '第 17 天'}})

  const result = await fixture.runtime.process({reason: 'built-in-partial-current-evidence'})

  assert.equal(result.status, 'success')
  assert.equal(fixture.saved.length, 4)
  assert.ok(fixture.saved.every(item => item.subject_id === subject))
  assert.ok(fixture.saved.every(item => item.aggregation_evidence.accepted_exposure_event_ids.length === 1))
  assert.ok(fixture.saved.every(item => item.aggregation_evidence.accepted_exposure_event_ids[0] === 'event-1'))
})

test('Projection Runtime removes obsolete immediate built-in branches before scheduling the current windows', async () => {
  const oldViews = [{
    projection_id: 'projection-old-immediate-fatigue',
    subject_id: subject,
    projection_rule_id: 'projection_rule_old_immediate-fatigue',
    development_concern_key: 'pre_confirmation_observation:fatigue',
    mechanism: {key: 'fertilization', world_model_rule_refs: []},
    aggregation_path: 'participant_aggregation',
    factual_status: 'active',
    deleted: false,
    context_visible: true,
  }]
  const deleted = []
  let fixture
  fixture = createFixture({
    getProjectionViews: async () => ({all: [
      ...oldViews,
      ...fixture.saved.map(item => ({...item, factual_status: 'active', deleted: false, context_visible: true})),
    ]}),
    deleteProjection: async ({projectionId}) => {
      deleted.push(projectionId)
      const index = oldViews.findIndex(view => view.projection_id === projectionId)
      if (index >= 0) oldViews.splice(index, 1)
      return {status: 'appended'}
    },
    resolvePreConfirmationTiming: async () => ({
      enabled: true,
      instances: [{timing_instance_id: 'timing-upgrade', subject_id: subject, mechanism_key: 'fertilization', cycle_id: 'cycle-upgrade', source_event_ids: ['event-1'], reference_story_time: {day_index: 0}, effective_min_story_days: 14, effective_max_story_days: 42}],
      windows: [{tracking_window_id: 'window-upgrade', subject_id: subject, mechanism_key: 'fertilization', cycle_id: 'cycle-upgrade', status: 'open', source_event_ids: ['event-1']}],
      aggregations: [{aggregation_id: 'aggregation-upgrade', subject_id: subject, pregnancy_id: null, mechanism_key: 'fertilization', cycle_id: 'cycle-upgrade', status: 'succeeded', accepted_exposure_event_ids: ['event-1']}],
    }),
  })
  fixture.setInputs({...inputs(), worldModel: {projection_rules: []}, currentStoryTime: {day_index: 17, display: '第 17 天'}})

  const result = await fixture.runtime.process({reason: 'built-in-schedule-upgrade'})

  assert.equal(result.status, 'success')
  assert.deepEqual(deleted, ['projection-old-immediate-fatigue'])
  assert.equal(fixture.saved.length, 4)
  assert.deepEqual(fixture.saved.map(item => item.development_concern_key).sort(), ['pre_confirmation_observation:breast_sensitivity', 'pre_confirmation_observation:fatigue', 'pre_confirmation_observation:no_reaction_early', 'pre_confirmation_observation:scent_food_change'])
})

test('lifecycle-only Projection refresh receives the business snapshot built for its inputs', async () => {
  const businessData = {
    marker: 'LIFECYCLE_INPUT_SNAPSHOT',
    current_floor: {version},
  };
  const refreshes = [];
  const viewRequests = [];
  const runtime = createProjectionRuntime({
    analyzer: {generateProjection: async () => { throw new Error('AI_MUST_NOT_RUN'); }},
    collectInputs: async () => ({...inputs(), businessData}),
    resolveCurrentFloor: async () => ({version}),
    getProjectionViews: async request => { viewRequests.push(request); return {all: []}; },
    saveProjectionBatch: async () => { throw new Error('GENERATION_MUST_NOT_RUN'); },
    saveEvolutionDecision: async () => ({status: 'skipped'}),
    refreshProjectionContext: async options => { refreshes.push(options); },
  });

  const result = await runtime.tickLifecycleOnly();

  assert.equal(result.status, 'success');
  assert.equal(viewRequests[0].endpointIndex, 3);
  assert.equal(refreshes.length, 1);
  assert.equal(refreshes[0].businessData, businessData);
});

test('timeout closes an unconfirmed aggregation even when no response delivery exists', async () => {
  const version = {...inputs().floor.version, floor: 4, message_id: 'message-4'};
  const exposure = {
    event_id: 'timeout-exposure',
    type: 'sexual_activity',
    status: 'confirmed',
    pregnancy_relevance: {relevant: true, gestational_subject_ids: [subject], counterpart_ids: ['source'], reproductive_mechanism: {kind: 'fertilization'}},
  };
  let floor = {...emptyFloor(), floor_version: version, events: [exposure, {event_id: 'unrelated-event', type: 'medical_event', status: 'confirmed'}]};
  const deliveryRequests = [];
  const store = {
    getActiveSwipeId: () => 0,
    getFloorOwner: () => ({owner_type: 'character', active_swipe_id: 0}),
    getFloor: () => structuredClone(floor),
    getCurrentChatOwnerSnapshot: () => ({messages: [{}]}),
    async saveFloor(_index, _swipe, next) { floor = structuredClone(next); },
  };
  const lifecyclePersistence = createPregnancyLifecyclePersistence({store, resolveCurrentFloorVersion: async () => version});
  const aggregation = {
    aggregation_id: 'aggregation-timeout-no-delivery',
    subject_id: subject,
    pregnancy_id: null,
    cycle_id: 'cycle-timeout-no-delivery',
    status: 'succeeded',
    reference_story_time: {day_index: 0},
    effective_max_story_days: 10,
    accepted_exposure_event_ids: [exposure.event_id],
  };
  const runtime = createProjectionRuntime({
    collectInputs: async () => ({
      floor: {index: 4, version},
      events: floor.events,
      currentStoryTime: {day_index: 11},
      participantAggregations: [aggregation],
      pregnancyLifecycleTimeline: {release_records: []},
    }),
    resolveCurrentFloor: async () => ({index: 4, version}),
    getProjectionViews: async () => ({all: []}),
    saveProjectionBatch: async () => ({status: 'committed'}),
    saveEvolutionDecision: async () => ({status: 'skipped'}),
    getProjectionDeliveryRecords: async request => { deliveryRequests.push(request); return []; },
    archiveAndReleasePregnancy: lifecyclePersistence.archiveAndRelease,
  });
  const result = await runtime.tickLifecycleOnly();
  assert.equal(result.timeout_closed, 1);
  assert.equal(deliveryRequests[0].endpointIndex, 4);
  assert.deepEqual(floor.events.map(event => event.event_id), ['unrelated-event']);
  assert.equal(floor.pregnancy_lifecycle_timeline.release_records.some(record => record.action === 'cycle-lock-released' && record.closure_reason === 'timeout_no_pregnancy'), true);
  assert.deepEqual(deriveTrackingWindows(floor.events, {chatId: version.chat_id}), []);
});

test('timeout identity matching does not treat a different concrete pregnancy as the same cycle', async () => {
  const version = {...inputs().floor.version, floor: 4, message_id: 'message-4b'};
  const closed = [];
  const runtime = createProjectionRuntime({
    collectInputs: async () => ({
      floor: {index: 4, version},
      events: [{
        event_id: 'pregnancy-p2-terminal',
        type: 'pregnancy_lifecycle',
        status: 'confirmed',
        state_fact: {subject_id: subject, payload: {status: 'delivery', pregnancy_id: 'pregnancy-2', cycle_id: 'cycle-concrete'}},
      }],
      currentStoryTime: {day_index: 11},
      participantAggregations: [{
        aggregation_id: 'aggregation-concrete-p1',
        subject_id: subject,
        pregnancy_id: 'pregnancy-1',
        cycle_id: 'cycle-concrete',
        status: 'succeeded',
        reference_story_time: {day_index: 0},
        effective_max_story_days: 10,
      }],
      pregnancyLifecycleTimeline: {release_records: []},
    }),
    resolveCurrentFloor: async () => ({index: 4, version}),
    getProjectionViews: async () => ({all: []}),
    saveProjectionBatch: async () => ({status: 'committed'}),
    saveEvolutionDecision: async () => ({status: 'skipped'}),
    getProjectionDeliveryRecords: async () => [],
    archiveAndReleasePregnancy: async request => { closed.push(request); return {status: 'released'}; },
  });
  const result = await runtime.evaluateTimeoutNoPregnancy({index: 4, version});
  assert.equal(result.closed, 1);
  assert.equal(closed[0].aggregation.pregnancy_id, 'pregnancy-1');
});

test('timeout identity matching does not treat a different cycle as the same observation', async () => {
  const version = {...inputs().floor.version, floor: 4, message_id: 'message-4c'};
  const closed = [];
  const runtime = createProjectionRuntime({
    collectInputs: async () => ({
      floor: {index: 4, version},
      events: [{
        event_id: 'pregnancy-cycle-other',
        type: 'pregnancy_lifecycle',
        status: 'confirmed',
        state_fact: {subject_id: subject, payload: {status: 'delivery', pregnancy_id: 'pregnancy-1', cycle_id: 'cycle-other'}},
      }],
      currentStoryTime: {day_index: 11},
      participantAggregations: [{
        aggregation_id: 'aggregation-cycle-specific',
        subject_id: subject,
        pregnancy_id: 'pregnancy-1',
        cycle_id: 'cycle-concrete',
        status: 'succeeded',
        reference_story_time: {day_index: 0},
        effective_max_story_days: 10,
      }],
      pregnancyLifecycleTimeline: {release_records: []},
    }),
    resolveCurrentFloor: async () => ({index: 4, version}),
    getProjectionViews: async () => ({all: []}),
    saveProjectionBatch: async () => ({status: 'committed'}),
    saveEvolutionDecision: async () => ({status: 'skipped'}),
    getProjectionDeliveryRecords: async () => [],
    archiveAndReleasePregnancy: async request => { closed.push(request); return {status: 'released'}; },
  });
  const result = await runtime.evaluateTimeoutNoPregnancy({index: 4, version});
  assert.equal(result.closed, 1);
  assert.equal(closed[0].aggregation.cycle_id, 'cycle-concrete');
});

test('timeout without delivery uses a distinct operation key for each Aggregation', async () => {
  const version = {...inputs().floor.version, floor: 4, message_id: 'message-4d'};
  const closed = [];
  const aggregation = (aggregationId, subjectId, cycleId) => ({
    aggregation_id: aggregationId,
    subject_id: subjectId,
    pregnancy_id: null,
    cycle_id: cycleId,
    status: 'succeeded',
    reference_story_time: {day_index: 0},
    effective_max_story_days: 10,
  });
  const runtime = createProjectionRuntime({
    collectInputs: async () => ({
      floor: {index: 4, version},
      events: [],
      currentStoryTime: {day_index: 11},
      participantAggregations: [
        aggregation('aggregation-timeout-1', subject, 'cycle-timeout-1'),
        aggregation('aggregation-timeout-2', 'subject-2', 'cycle-timeout-2'),
      ],
      pregnancyLifecycleTimeline: {release_records: []},
    }),
    resolveCurrentFloor: async () => ({index: 4, version}),
    getProjectionViews: async () => ({all: []}),
    saveProjectionBatch: async () => ({status: 'committed'}),
    saveEvolutionDecision: async () => ({status: 'skipped'}),
    getProjectionDeliveryRecords: async () => [],
    archiveAndReleasePregnancy: async request => { closed.push(request); return {status: 'released'}; },
  });
  const result = await runtime.evaluateTimeoutNoPregnancy({index: 4, version});
  assert.equal(result.closed, 2);
  assert.deepEqual(closed.map(request => request.operationKey).sort(), [
    'timeout-no-pregnancy:aggregation-timeout-1',
    'timeout-no-pregnancy:aggregation-timeout-2',
  ]);
});

test('Projection Runtime does not persist a new aggregation-path Projection when evidence cannot be built', async () => {
  let calls = 0
  const timing = {
    timing_instance_id: 'timing-invalid-evidence',
    subject_id: subject,
    mechanism_key: 'fertilization',
    cycle_id: 'cycle-invalid-evidence',
    source_event_ids: ['event-1'],
    reference_story_time: {day_index: 0},
    effective_min_story_days: 1,
    effective_max_story_days: 10,
  }
  const fixture = createFixture({
    analyzer: {generateProjection: async () => { calls += 1; return {development: {kind: 'possible_detection', description: '不应生成。'}} }},
    resolvePreConfirmationTiming: async () => ({
      enabled: true,
      instances: [timing],
      windows: [{tracking_window_id: 'window-invalid-evidence', cycle_id: timing.cycle_id, subject_id: subject, mechanism_key: timing.mechanism_key, status: 'open', source_event_ids: ['event-1']}],
      aggregations: [{aggregation_id: 'aggregation-invalid-evidence', subject_id: subject, mechanism_key: timing.mechanism_key, cycle_id: timing.cycle_id, accepted_exposure_event_ids: ['missing-event']}],
    }),
  })
  fixture.setInputs({...inputs(), currentStoryTime: {day_index: 3, display: '第 3 天'}})
  const result = await fixture.runtime.process({reason: 'invalid-aggregation-evidence'})
  assert.equal(result.status, 'success')
  assert.equal(calls, 0)
  assert.equal(fixture.saved.length, 0)
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

test('completed automatic Projection execution is skipped for a sequential duplicate', async () => {
  let calls = 0
  const fixture = createFixture({analyzer: {generateProjection: async () => {
    calls += 1
    return {development: {kind: 'possible_detection', description: '只应生成一次。'}}
  }}})
  const first = await fixture.runtime.process({reason: 'factual-success', dedupeCompleted: true})
  const second = await fixture.runtime.process({reason: 'lifecycle-generation-ended', dedupeCompleted: true})
  assert.equal(first.status, 'success')
  assert.equal(second.status, 'success')
  assert.equal(calls, 1)
  assert.equal(fixture.batchPersistenceCalls, 1)
})

test('partial automatic Projection execution remains retryable', async () => {
  let calls = 0
  const fixture = createFixture({
    analyzer: {generateProjection: async () => {
      calls += 1
      return {development: {kind: 'possible_detection', description: '重试候选。'}}
    }},
    saveProjectionBatchHook: async () => {
      throw new Error('PROJECTION_PERSISTENCE_RETRYABLE')
    },
  })
  const first = await fixture.runtime.process({reason: 'factual-success', dedupeCompleted: true})
  const second = await fixture.runtime.process({reason: 'lifecycle-generation-ended', dedupeCompleted: true})
  assert.equal(first.status, 'partial')
  assert.equal(second.status, 'partial')
  assert.equal(calls, 2)
  assert.equal(fixture.batchPersistenceCalls, 2)
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

test('Story Time-only progression after effective_max performs overdue aggregation before Projection', async () => {
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
      return {development: {kind: 'possible_detection', description: '超期后补做聚合并生成。'}}
    }},
    resolvePreConfirmationTiming: async () => ({enabled: true, instances: [timing], windows: [window], aggregations: [{aggregation_id: 'aggregation-cycle-missed', subject_id: subject, mechanism_key: 'fertilization', cycle_id: 'cycle-missed', accepted_exposure_event_ids: ['event-1'], participant_exposure_mapping: []}]}),
  })
  fixture.setInputs({...inputs(), currentStoryTime: {day_index: 11, display: '第 11 天'}})
  const result = await fixture.runtime.process({reason: 'story-time:window-missed', trigger: 'story-time-progression'})
  assert.equal(result.status, 'success')
  assert.equal(calls, 1)
  assert.equal(fixture.saved.length, 1)
})

function observedReactionEvent({eventId = 'event-nausea', subjectId = subject} = {}) {
  return {
    event_id: eventId,
    type: 'physical_symptom',
    status: 'confirmed',
    story_time: {day_index: 23, display: '第 23 天'},
    source_evidence: [{type: 'narrative', text: '正文记录恶心'}],
    state_fact: {subject_id: subjectId, payload: {symptom: {kind: 'nausea', description: '闻到气味后恶心', health_role: 'observation'}}},
  }
}

function observedReactionView({projectionId, subjectId = subject, concern = 'nausea', referenceDay = 0, createdFloor = 3} = {}) {
  return {
    projection_id: projectionId,
    subject_id: subjectId,
    projection_rule_id: `rule-${projectionId}`,
    development_concern_key: `pre_confirmation_observation:${concern}`,
    tracking_scope: 'pre_confirmation',
    aggregation_path: 'participant_aggregation',
    factual_status: 'active',
    deleted: false,
    context_visible: true,
    development: {next_signal: '可能出现观察信号。', kind: 'possible_biological_change'},
    aggregation_evidence: {
      subject_id: subjectId,
      aggregation_id: `aggregation-${projectionId}`,
      pregnancy_id: null,
      cycle_id: `cycle-${subjectId}`,
      accepted_exposure_event_ids: ['event-exposure'],
      participant_exposure_mapping: [{participant_id: 'participant-a', exposure_event_ids: ['event-exposure']}],
    },
    timing: {reference_story_time: {day_index: referenceDay, display: `第 ${referenceDay} 天`}},
    created_at_floor_version: {
      ...version,
      message_id: `message-${createdFloor}`,
      floor: createdFloor,
      content_hash: `hash-${createdFloor}`,
      message_version: `v1:hash-${createdFloor}`,
    },
    source_event_ids: [],
    observation_records: [],
  }
}

function activeSnapshot(subjectId, triggered, stageCode = '1-2') {
  return {subject_id: subjectId, status: 'active', stage_code: stageCode, triggered}
}

function storedActiveSnapshot(subjectId, triggered, createdFloor) {
  const {stage_code: _stageCode, ...legacySnapshot} = activeSnapshot(subjectId, triggered)
  return {
    ...legacySnapshot,
    snapshot_id: `snapshot-${createdFloor}`,
    schema_version: 1,
    created_at_floor_version: {
      ...version,
      message_id: `message-${createdFloor}`,
      floor: createdFloor,
      content_hash: `hash-${createdFloor}`,
      message_version: `v1:hash-${createdFloor}`,
    },
  }
}

function triggeredItem(projectionId, reactionConcept, eventIds = ['event-nausea']) {
  return {projection_id: projectionId, reaction_concept: reactionConcept, event_ids: eventIds}
}

function snapshotFixture({views, snapshots = [], observationRecords = [], diagnostics = null} = {}) {
  const currentViews = {all: views, triggered_snapshots: snapshots, observation_records: observationRecords}
  const writes = []
  const fixture = createFixture({
    diagnostics,
    getProjectionViews: async () => currentViews,
    saveProjectionTriggeredSnapshotBatch: async payload => {
      writes.push(payload)
      const updates = new Map(payload.snapshots.map(snapshot => [snapshot.subject_id, {
        ...snapshot,
        snapshot_id: `snapshot-${writes.length}`,
        schema_version: 1,
        created_at_floor_version: payload.floorVersion,
      }]))
      currentViews.triggered_snapshots = currentViews.triggered_snapshots
        .filter(snapshot => !updates.has(snapshot.subject_id))
        .concat([...updates.values()])
      return {status: 'appended'}
    },
  })
  return {fixture, currentViews, writes}
}

test('Projection Runtime writes the first strict current-stage match into one active snapshot', async () => {
  const view = observedReactionView({projectionId: 'projection-stage-a'})
  const {fixture, writes} = snapshotFixture({views: [view]})
  fixture.setInputs({...inputs(), events: [observedReactionEvent()], currentStoryTime: {day_index: 23, display: '第 23 天'}})

  await fixture.runtime.process({reason: 'projection-refresh'})

  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].snapshots, [activeSnapshot(subject, [triggeredItem(view.projection_id, 'nausea')])])
})

test('Projection Runtime debug exports current endpoint triggered snapshots grouped by subject with safe fields', async () => {
  const view = observedReactionView({projectionId: 'projection-debug-snapshot'})
  const snapshot = storedActiveSnapshot(subject, [triggeredItem(view.projection_id, 'nausea', ['event-debug'])], 3)
  const {fixture} = snapshotFixture({views: [view], snapshots: [snapshot]})
  const debug = await fixture.runtime.getBusinessData({
    businessData: {current_floor: {version}, current_story_time: {day_index: 23}, active_events: []},
    includeDebug: true,
  })

  assert.deepEqual(debug.projection_triggered_snapshots, [{
    subject_id: subject,
    status: 'active',
    stage_code: null,
    snapshot_created_floor: 3,
    triggered_count: 1,
    triggered: [{projection_id: view.projection_id, reaction_concept: 'nausea', event_ids: ['event-debug']}],
  }])
  assert.doesNotMatch(JSON.stringify(debug.projection_triggered_snapshots), /可能出现观察信号|正文记录恶心/u)
})

test('Projection Runtime appends A plus new B into the current subject snapshot', async () => {
  const oldView = observedReactionView({projectionId: 'projection-snapshot-a', concern: 'fatigue', createdFloor: 1})
  const currentView = observedReactionView({projectionId: 'projection-snapshot-b', concern: 'nausea', createdFloor: 3})
  const {fixture, writes} = snapshotFixture({
    views: [oldView, currentView],
    snapshots: [storedActiveSnapshot(subject, [triggeredItem(oldView.projection_id, 'fatigue', ['event-old'])], 1)],
  })
  fixture.setInputs({...inputs(), events: [observedReactionEvent()], currentStoryTime: {day_index: 23, display: '第 23 天'}})

  await fixture.runtime.process({reason: 'projection-stage-a-plus-b'})

  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].snapshots, [activeSnapshot(subject, [
    triggeredItem(oldView.projection_id, 'fatigue', ['event-old']),
    triggeredItem(currentView.projection_id, 'nausea'),
  ])])
})

test('Projection Runtime writes a new stage code when the triggered list stays empty', async () => {
  const view = observedReactionView({projectionId: 'projection-stage-empty', concern: 'nausea', createdFloor: 3})
  const {fixture, writes} = snapshotFixture({
    views: [view],
    snapshots: [{...storedActiveSnapshot(subject, [], 1), stage_code: '1-1'}],
  })
  fixture.setInputs({...inputs(), events: [], currentStoryTime: {day_index: 23, display: '第 23 天'}})

  await fixture.runtime.process({reason: 'projection-refresh'})

  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].snapshots, [{subject_id: subject, status: 'active', stage_code: '1-2', triggered: []}])
})

test('Projection Runtime snapshot trace separates nearest snapshot, current matches, inheritance, and final count', async () => {
  const diagnostics = createRuntimeDiagnostics()
  const oldView = observedReactionView({projectionId: 'projection-trace-a', concern: 'fatigue', createdFloor: 1})
  const currentView = observedReactionView({projectionId: 'projection-trace-b', concern: 'nausea', createdFloor: 3})
  const {fixture} = snapshotFixture({
    diagnostics,
    views: [oldView, currentView],
    snapshots: [storedActiveSnapshot(subject, [triggeredItem(oldView.projection_id, 'fatigue', ['event-old'])], 1)],
  })
  fixture.setInputs({...inputs(), events: [observedReactionEvent()], currentStoryTime: {day_index: 23, display: '第 23 天'}})

  await fixture.runtime.process({reason: 'projection-trace-a-plus-b'})

  const trace = diagnostics.getNsfwPipelineDiagnostics({floor_version: version})
  const persistence = trace.stages.find(stage => stage.stage === 'PROJECTION_TRIGGERED_SNAPSHOT_PERSISTENCE')
  const summary = persistence.subject_summaries.find(item => item.subject_id === subject)
  assert.deepEqual({
    nearest_snapshot_found: summary.nearest_snapshot_found,
    nearest_snapshot_floor: summary.nearest_snapshot_floor,
    nearest_snapshot_status: summary.nearest_snapshot_status,
    nearest_snapshot_triggered_count: summary.nearest_snapshot_triggered_count,
    current_candidate_count: summary.current_candidate_count,
    current_new_match_count: summary.current_new_match_count,
    inherited_count: summary.inherited_count,
    new_count: summary.new_count,
    final_count: summary.final_count,
    write_status: summary.write_status,
    reason_code: summary.reason_code,
  }, {
    nearest_snapshot_found: true,
    nearest_snapshot_floor: 1,
    nearest_snapshot_status: 'active',
    nearest_snapshot_triggered_count: 1,
    current_candidate_count: 2,
    current_new_match_count: 1,
    inherited_count: 1,
    new_count: 1,
    final_count: 2,
    write_status: 'appended',
    reason_code: 'SNAPSHOT_READY',
  })
})

test('Projection Runtime gives an explicit no-prior/no-new-match status', async () => {
  const diagnostics = createRuntimeDiagnostics()
  const view = observedReactionView({projectionId: 'projection-trace-empty'})
  const {fixture} = snapshotFixture({diagnostics, views: [view]})
  fixture.setInputs({...inputs(), events: [], currentStoryTime: {day_index: 23, display: '第 23 天'}})

  await fixture.runtime.process({reason: 'projection-trace-empty'})

  const trace = diagnostics.getNsfwPipelineDiagnostics({floor_version: version})
  const persistence = trace.stages.find(stage => stage.stage === 'PROJECTION_TRIGGERED_SNAPSHOT_PERSISTENCE')
  const readback = trace.stages.find(stage => stage.stage === 'PROJECTION_TRIGGERED_SNAPSHOT_READBACK')
  assert.equal(persistence.result_status, 'deduped')
  assert.equal(persistence.reason_code, 'PROJECTION_TRIGGERED_SNAPSHOT_DEDUPED')
  assert.equal(persistence.subject_summaries[0].reason_code, 'NO_PRIOR_SNAPSHOT_AND_NO_NEW_MATCH')
  assert.equal(readback.result_status, 'not_attempted')
  assert.equal(readback.subject_summaries[0].readback_status, 'NOT_ATTEMPTED')
})

test('Projection Runtime reports unsupported and failed snapshot persistence safely', async () => {
  const view = observedReactionView({projectionId: 'projection-snapshot-status'})
  const unsupportedDiagnostics = createRuntimeDiagnostics()
  const unsupported = createFixture({diagnostics: unsupportedDiagnostics, getProjectionViews: async () => ({all: [view]})})
  unsupported.setInputs({...inputs(), events: [observedReactionEvent()], currentStoryTime: {day_index: 23, display: '第 23 天'}})
  await unsupported.runtime.process({reason: 'projection-snapshot-unsupported'})
  const unsupportedTrace = unsupportedDiagnostics.getNsfwPipelineDiagnostics({floor_version: version})
  const unsupportedStage = unsupportedTrace.stages.find(stage => stage.stage === 'PROJECTION_TRIGGERED_SNAPSHOT_PERSISTENCE')
  assert.equal(unsupportedStage.result_status, 'unsupported')
  assert.equal(unsupportedStage.persistence_attempted, false)
  assert.deepEqual(unsupportedStage.floor_version, {...version, message_index: null})
  assert.equal(unsupportedStage.subject_summaries[0].write_status, 'unsupported')
  assert.equal(unsupportedStage.subject_summaries[0].reason_code, 'PERSISTENCE_UNSUPPORTED')

  const failedDiagnostics = createRuntimeDiagnostics()
  const failed = createFixture({
    diagnostics: failedDiagnostics,
    getProjectionViews: async () => ({all: [view]}),
    saveProjectionTriggeredSnapshotBatch: async () => { throw Object.assign(new Error('snapshot write failed'), {code: 'SNAPSHOT_WRITE_FAILED'}) },
  })
  failed.setInputs({...inputs(), events: [observedReactionEvent()], currentStoryTime: {day_index: 23, display: '第 23 天'}})
  const failedResult = await failed.runtime.process({reason: 'projection-snapshot-failed'})
  assert.equal(failedResult.status, 'failed')
  const failedTrace = failedDiagnostics.getNsfwPipelineDiagnostics({floor_version: version})
  const failedStage = failedTrace.stages.find(stage => stage.stage === 'PROJECTION_TRIGGERED_SNAPSHOT_PERSISTENCE')
  assert.equal(failedStage.result_status, 'failed')
  assert.equal(failedStage.persistence_succeeded, false)
  assert.equal(failedStage.error_code, 'SNAPSHOT_WRITE_FAILED')
  assert.equal(failedStage.subject_summaries[0].write_status, 'failed')
  assert.equal(failedStage.subject_summaries[0].final_count, 1)
  assert.doesNotMatch(JSON.stringify(failedStage), /snapshot write failed|正文记录恶心/u)
})

test('Projection Runtime records triggered snapshot persistence and authoritative readback trace', async () => {
  const diagnostics = createRuntimeDiagnostics()
  const view = observedReactionView({projectionId: 'projection-snapshot-readback'})
  const {fixture, currentViews, writes} = snapshotFixture({
    views: [view],
    snapshots: [{...storedActiveSnapshot(subject, [triggeredItem(view.projection_id, 'nausea', ['event-nausea'])], 1), stage_code: '1-1'}],
  })
  fixture.runtime = createProjectionRuntime({
    analyzer: {generateProjection: async () => ({development: {kind: 'possible_detection', description: '测试'}})},
    getChatId: () => version.chat_id,
    collectInputs: async () => ({...inputs(), events: [observedReactionEvent()], currentStoryTime: {day_index: 23, display: '第 23 天'}}),
    resolveCurrentFloor: async () => ({index: 3, swipeId: 0, version}),
    getProjectionViews: async () => currentViews,
    saveProjectionBatch: async () => ({status: 'deduped'}),
    saveProjectionTriggeredSnapshotBatch: async payload => {
      writes.push(payload)
      currentViews.triggered_snapshots = payload.snapshots.map((snapshot, index) => ({...snapshot, snapshot_id: `snapshot-readback-${index}`, schema_version: 1, created_at_floor_version: payload.floorVersion}))
      return {status: 'appended'}
    },
    saveEvolutionDecision: async () => ({status: 'skipped'}),
    refreshProjectionContext: async () => {},
    diagnostics,
  })
  await fixture.runtime.process({reason: 'projection-snapshot-readback'})

  const trace = diagnostics.getNsfwPipelineDiagnostics({floor_version: version})
  const stages = trace.stages.filter(stage => stage.stage.startsWith('PROJECTION_TRIGGERED_SNAPSHOT_'))
  assert.equal(stages.some(stage => stage.stage === 'PROJECTION_TRIGGERED_SNAPSHOT_PERSISTENCE' && stage.result_status === 'appended' && stage.snapshot_count === 1), true)
  assert.equal(stages.some(stage => stage.stage === 'PROJECTION_TRIGGERED_SNAPSHOT_READBACK' && stage.readback_succeeded === true && stage.snapshot_count === 1), true)
  const readback = stages.find(stage => stage.stage === 'PROJECTION_TRIGGERED_SNAPSHOT_READBACK')
  assert.equal(readback.subject_summaries[0].readback_status, 'FOUND')
  assert.equal(readback.subject_summaries[0].readback_count, 1)
  assert.deepEqual(writes[0].snapshots, [activeSnapshot(subject, [triggeredItem(view.projection_id, 'nausea')])])
})

test('Projection Runtime distinguishes a missing authoritative snapshot readback', async () => {
  const diagnostics = createRuntimeDiagnostics()
  const view = observedReactionView({projectionId: 'projection-snapshot-readback-missing'})
  const {fixture} = snapshotFixture({diagnostics, views: [view]})
  fixture.runtime = createProjectionRuntime({
    analyzer: {generateProjection: async () => ({development: {kind: 'possible_detection', description: '测试'}})},
    getChatId: () => version.chat_id,
    collectInputs: async () => ({...inputs(), events: [observedReactionEvent()], currentStoryTime: {day_index: 23, display: '第 23 天'}}),
    resolveCurrentFloor: async () => ({index: 3, swipeId: 0, version}),
    getProjectionViews: async () => ({all: [view], triggered_snapshots: []}),
    saveProjectionBatch: async () => ({status: 'deduped'}),
    saveProjectionTriggeredSnapshotBatch: async () => ({status: 'appended', snapshot_count: 1, subject_summaries: [{subject_id: subject, final_count: 1}]}),
    saveEvolutionDecision: async () => ({status: 'skipped'}),
    refreshProjectionContext: async () => {},
    diagnostics,
  })

  await fixture.runtime.process({reason: 'projection-snapshot-readback-missing'})

  const trace = diagnostics.getNsfwPipelineDiagnostics({floor_version: version})
  const readback = trace.stages.find(stage => stage.stage === 'PROJECTION_TRIGGERED_SNAPSHOT_READBACK')
  assert.equal(readback.execution_status, 'READBACK_MISMATCH')
  assert.equal(readback.reason_code, 'PROJECTION_TRIGGERED_SNAPSHOT_READBACK_MISMATCH')
  assert.equal(readback.readback_attempted, true)
  assert.equal(readback.readback_succeeded, false)
  assert.equal(readback.subject_summaries[0].readback_status, 'NOT_FOUND')
})

test('Projection Runtime carries an active old-stage snapshot into the current Floor without untriggered current candidates', async () => {
  const oldView = observedReactionView({projectionId: 'projection-stage-a', concern: 'fatigue', referenceDay: 0, createdFloor: 1})
  const currentView = observedReactionView({projectionId: 'projection-stage-b', concern: 'nausea', referenceDay: 0, createdFloor: 3})
  const {fixture, writes} = snapshotFixture({
    views: [currentView],
    snapshots: [storedActiveSnapshot(subject, [triggeredItem(oldView.projection_id, 'fatigue', ['event-old'])], 1)],
  })
  fixture.setInputs({...inputs(), events: [], currentStoryTime: {day_index: 23, display: '第 23 天'}})

  await fixture.runtime.process({reason: 'projection-refresh'})

  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].snapshots, [activeSnapshot(subject, [triggeredItem(oldView.projection_id, 'fatigue', ['event-old'])])])
})

test('Projection Runtime does not copy the same carried snapshot again on a later Floor in the same stage', async () => {
  const oldView = observedReactionView({projectionId: 'projection-stage-a', concern: 'fatigue', createdFloor: 1})
  const currentView = observedReactionView({projectionId: 'projection-stage-b', concern: 'nausea', createdFloor: 3})
  const carried = [triggeredItem(oldView.projection_id, 'fatigue', ['event-old'])]
  const {fixture, writes} = snapshotFixture({
    views: [currentView],
    snapshots: [storedActiveSnapshot(subject, carried, 3)],
  })
  const floor4 = {
    ...version,
    message_id: 'message-4',
    floor: 4,
    content_hash: 'hash-4',
    message_version: 'v1:hash-4',
  }
  fixture.setInputs({...inputs(), floor: {index: 4, swipeId: 0, version: floor4}, events: [], currentStoryTime: {day_index: 24, display: '第 24 天'}})

  await fixture.runtime.process({reason: 'projection-refresh'})

  assert.equal(writes.length, 0)
})

test('Projection Runtime does not persist an unchanged current-stage snapshot on an ordinary later process', async () => {
  const view = observedReactionView({projectionId: 'projection-stage-a'})
  const {fixture, writes} = snapshotFixture({
    views: [view],
    snapshots: [activeSnapshot(subject, [triggeredItem(view.projection_id, 'nausea')])],
  })
  fixture.setInputs({...inputs(), events: [observedReactionEvent()], currentStoryTime: {day_index: 23, display: '第 23 天'}})

  await fixture.runtime.process({reason: 'projection-refresh'})
  await fixture.runtime.process({reason: 'projection-refresh'})

  assert.equal(writes.length, 0)
})

test('Projection Runtime manual Event edit/delete removes only the current-stage triggered item', async () => {
  const oldView = observedReactionView({projectionId: 'projection-stage-a', concern: 'fatigue'})
  const currentView = observedReactionView({projectionId: 'projection-stage-b', concern: 'nausea'})
  const {fixture, writes} = snapshotFixture({
    views: [currentView],
    snapshots: [activeSnapshot(subject, [
      triggeredItem(oldView.projection_id, 'fatigue', ['event-old']),
      triggeredItem(currentView.projection_id, 'nausea'),
    ])],
  })
  fixture.setInputs({...inputs(), events: [], currentStoryTime: {day_index: 23, display: '第 23 天'}})

  await fixture.runtime.process({reason: 'event-delete'})

  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].snapshots, [activeSnapshot(subject, [triggeredItem(oldView.projection_id, 'fatigue', ['event-old'])])])
})

test('Projection Runtime writes a terminated empty snapshot only after a proven observation end', async () => {
  const view = observedReactionView({projectionId: 'projection-stage-a'})
  const {fixture, currentViews, writes} = snapshotFixture({
    views: [view],
    snapshots: [activeSnapshot(subject, [triggeredItem(view.projection_id, 'nausea')])],
  })
  fixture.setInputs({...inputs(), events: [observedReactionEvent()], currentStoryTime: {day_index: 23, display: '第 23 天'}})

  currentViews.all = []
  await fixture.runtime.process({reason: 'projection-refresh'})
  currentViews.all = [{...view, timing: null}]
  await fixture.runtime.process({reason: 'projection-refresh'})
  assert.equal(writes.length, 0)

  currentViews.all = [view]
  fixture.setInputs({...inputs(), events: [observedReactionEvent()], currentStoryTime: {day_index: 43, display: '第 43 天'}})
  await fixture.runtime.process({reason: 'projection-refresh'})

  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].snapshots, [{subject_id: subject, status: 'terminated', stage_code: '1-2', triggered: []}])

  await fixture.runtime.process({reason: 'projection-refresh'})
  assert.equal(writes.length, 1)
})

test('Projection Runtime lets a later newly created observation restart after a terminated snapshot', async () => {
  const oldView = observedReactionView({projectionId: 'projection-old-round', createdFloor: 3})
  const newView = observedReactionView({projectionId: 'projection-new-round', createdFloor: 5})
  const terminated = {
    subject_id: subject,
    status: 'terminated',
    triggered: [],
    snapshot_id: 'snapshot-terminated',
    schema_version: 1,
    created_at_floor_version: {
      ...version,
      message_id: 'message-4',
      floor: 4,
      content_hash: 'hash-4',
      message_version: 'v1:hash-4',
    },
  }
  const {fixture, writes} = snapshotFixture({views: [newView], snapshots: [terminated]})
  const floor5 = newView.created_at_floor_version
  fixture.setInputs({...inputs(), floor: {index: 5, swipeId: 0, version: floor5}, events: [observedReactionEvent()], currentStoryTime: {day_index: 23, display: '第 23 天'}})

  await fixture.runtime.process({reason: 'projection-refresh'})

  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].snapshots, [activeSnapshot(subject, [triggeredItem(newView.projection_id, 'nausea')])])
  assert.notEqual(newView.projection_id, oldView.projection_id)
})

test('Projection Runtime writes one complete subject batch while converging legacy observations', async () => {
  const migratedSubject = subject
  const legacySubject = 'char_000002'
  const migratedView = observedReactionView({projectionId: 'projection-migrated', subjectId: migratedSubject})
  const legacyView = observedReactionView({projectionId: 'projection-legacy', subjectId: legacySubject})
  const {fixture, currentViews, writes} = snapshotFixture({
    views: [migratedView, legacyView],
    snapshots: [activeSnapshot(migratedSubject, [triggeredItem(migratedView.projection_id, 'nausea')])],
    observationRecords: [{subject_id: legacySubject, projection_id: legacyView.projection_id, action: 'triggered', reaction_concept: 'nausea', event_ids: ['event-legacy']}],
  })
  fixture.setInputs({...inputs(), currentState: {characters: {[migratedSubject]: {reproductive_capabilities: {}}, [legacySubject]: {reproductive_capabilities: {}}}}, events: [observedReactionEvent({subjectId: migratedSubject}), observedReactionEvent({eventId: 'event-legacy', subjectId: legacySubject})], currentStoryTime: {day_index: 23, display: '第 23 天'}})

  await fixture.runtime.process({reason: 'projection-refresh'})

  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].snapshots, [
    activeSnapshot(migratedSubject, [triggeredItem(migratedView.projection_id, 'nausea')]),
    activeSnapshot(legacySubject, [triggeredItem(legacyView.projection_id, 'nausea', ['event-legacy'])]),
  ])
  assert.deepEqual(currentViews.triggered_snapshots.map(({snapshot_id, schema_version, created_at_floor_version, ...snapshot}) => snapshot), [
    activeSnapshot(migratedSubject, [triggeredItem(migratedView.projection_id, 'nausea')]),
    activeSnapshot(legacySubject, [triggeredItem(legacyView.projection_id, 'nausea', ['event-legacy'])]),
  ])
})
