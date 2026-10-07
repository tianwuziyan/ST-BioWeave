import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canonicalFailureCategory,
  FAILURE_CATEGORIES,
  createRuntimeDiagnostics,
  safeDiagnosticSummary,
} from '../runtime/diagnostics.js'
import { runtimeAnalysisFailureMessage } from '../ui/app.js'

const staleMessage = '当前楼层状态已发生变化，本次分析结果未写入。'

test('stale floor codes and owner classifications share one canonical category', () => {
  for (const payload of [
    { error_code: 'FLOOR_TX_STALE_VERSION' },
    { code: 'STALE_FLOOR_VERSION' },
    { classification: 'TRUE_STALE_OWNER_CHANGE' },
    { retry_classification: 'true_owner_change' },
    { cause: { classification: 'STALE_OWNER_CHANGE' } },
  ]) {
    assert.equal(canonicalFailureCategory(payload), FAILURE_CATEGORIES.STALE_FLOOR_OWNER)
  }
})

test('runtime diagnostics maps stale floor owner failures to the business message', () => {
  assert.equal(safeDiagnosticSummary({ error_code: 'FLOOR_TX_STALE_VERSION' }), staleMessage)
  assert.equal(safeDiagnosticSummary({ code: 'STALE_FLOOR_VERSION' }), staleMessage)
  assert.equal(safeDiagnosticSummary({ classification: 'TRUE_STALE_OWNER_CHANGE' }), staleMessage)
})

test('UI maps all stale floor owner variants to the same business message', () => {
  assert.equal(runtimeAnalysisFailureMessage({ error_code: 'FLOOR_TX_STALE_VERSION' }), staleMessage)
  assert.equal(runtimeAnalysisFailureMessage({ code: 'STALE_FLOOR_VERSION' }), staleMessage)
  assert.equal(runtimeAnalysisFailureMessage({ classification: 'TRUE_STALE_OWNER_CHANGE' }), staleMessage)
})

test('API/network failures keep the existing connection summary', () => {
  assert.equal(
    safeDiagnosticSummary({ code: 'NETWORK_ERROR', message: 'connection failed' }),
    '网络连接中断，请检查网络后重试。',
  )
})

test('validation failures keep the existing validation summary', () => {
  assert.equal(
    safeDiagnosticSummary({ code: 'EVENT_SCHEMA_INVALID' }),
    'AI 返回未通过 Event JSON Schema 校验',
  )
  assert.equal(
    runtimeAnalysisFailureMessage({ error_code: 'EVENT_ANALYSIS_INVALID' }),
    '分析失败：AI 返回结果无法通过校验。',
  )
})

test('health diagnostics export separates invocation counts from persisted reuse', () => {
  const diagnostics = createRuntimeDiagnostics()
  const emit = payload => diagnostics.observe({type: 'BIOWEAVE_PERSISTENCE_TRACE', payload})
  emit({stage: 'HEALTH_ASSESSMENT_REQUEST_STARTED', request_key: 'request-a', source_event_id: 'event-a'})
  emit({stage: 'HEALTH_ASSESSMENT_REQUEST_COMPLETED', request_key: 'request-a', source_event_id: 'event-a'})
  emit({stage: 'HEALTH_ASSESSMENT_REUSED', request_key: 'request-a', source_event_id: 'event-a'})
  emit({stage: 'GENERATION_PROJECTION_REFRESH_SETTLED', generation_type: 'normal', settled_before_listener_resolve: true, context_ready_before_prompt_read: true, refresh_outcome: 'updated'})
  const trace = diagnostics.getPersistenceTrace()
  assert.deepEqual(trace.summary.health_assessments, [{
    source_event_id: 'event-a',
    request_key: 'request-a',
    lookup_count: 0,
    ai_request_started_count: 1,
    ai_request_completed_count: 1,
    ai_request_failed_count: 0,
    reuse_count: 1,
    inflight_reuse_count: 0,
  }])
  assert.equal(trace.summary.generation.projection_refresh_awaited, true)
  assert.equal(trace.summary.generation.context_ready_before_listener_resolve, true)
})

test('Settings debug trace retains Story Time Projection stages and safe IDs', () => {
  const diagnostics = createRuntimeDiagnostics({getChatId: () => 'chat-debug'})
  diagnostics.observe({type: 'PROJECTION_ANALYSIS_STATUS_CHANGED', payload: {
    stage: 'PROJECTION_TIMING_EVALUATED', state: 'running', trigger: 'story-time-progression',
    timing_evaluations: [{timing_state: 'window_open', current_story_time: {day_index: 18}, reproductive_cycle_id: 'cycle-a', tracking_window_id: 'window-a', timing_instance_id: 'timing-a', compatible_exposure_event_ids: ['event-a', 'event-b']}],
    source_identity_ids: ['char-source'],
  }})
  diagnostics.observe({type: 'BIOWEAVE_PERSISTENCE_TRACE', payload: {
    stage: 'FLOOR_TX_CONFIRMED', floor_transaction_id: 'floor-tx-1', transaction_key: 'chat-debug/3/0/hash/v1', owner: 'projection', operation_type: 'projection-timeline-patch', commit_state: 'confirmed', projection_id: 'projection-a',
  }})
  diagnostics.observe({type: 'PROJECTION_ANALYSIS_STATUS_CHANGED', payload: {
    stage: 'PROJECTION_READBACK', state: 'success', projection_view_count: 1, context_visible_projection_count: 1, projection_ids: ['projection-a'], generated_projection_ids: ['projection-a'],
  }})
  diagnostics.observe({type: 'BIOWEAVE_PERSISTENCE_TRACE', payload: {
    stage: 'PROJECTION_CONTEXT_SLOT_WRITTEN', slot: 'bioweave_projection_context', projection_contribution_count: 1, context_visible_projection_ids: ['projection-a'], context_nonempty: true,
  }})
  const trace = diagnostics.getPersistenceTrace()
  assert.equal(trace.execution.trigger, 'story-time-progression')
  assert.equal(trace.sequence.find(item => item.stage === 'PROJECTION_TIMING_EVALUATED').timing_evaluations[0].tracking_window_id, 'window-a')
  assert.deepEqual(trace.sequence.find(item => item.stage === 'FLOOR_TX_CONFIRMED').projection_id, 'projection-a')
  assert.deepEqual(trace.summary.projection.generated_projection_ids, ['projection-a'])
  assert.deepEqual(trace.summary.projection_context.projection_ids, ['projection-a'])
})
