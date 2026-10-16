import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canonicalFailureCategory,
  FAILURE_CATEGORIES,
  createRuntimeDiagnostics,
  safeDiagnosticSummary,
} from '../runtime/diagnostics.js'
import { buildDebugExportText, runtimeAnalysisFailureMessage } from '../ui/app.js'

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

test('Story Time diagnostics separates persisted fields from read-only parsing and comparison', () => {
  const diagnostics = createRuntimeDiagnostics();
  const input = {
    display: '2026-09-20',
    normalized: null,
    day_index: null,
    calendar_id: null,
  };
  const dto = diagnostics.buildStoryTimeDebugInfo({
    info: {
      status: 'ready',
      story_time: input,
      trace: [{source: 'floor_header', story_time: input}],
    },
  });
  assert.equal(dto.persisted_structured, false);
  assert.equal(dto.parseable, true);
  assert.equal(dto.comparable, 'not_evaluated');
  assert.equal(dto.failure_reason, 'COMPARISON_NOT_EVALUATED');
  assert.deepEqual(input, {
    display: '2026-09-20',
    normalized: null,
    day_index: null,
    calendar_id: null,
  });
});

test('Story Time diagnostics reports structured, invalid, and zero-index states', () => {
  const diagnostics = createRuntimeDiagnostics();
  const zeroIndex = diagnostics.buildStoryTimeDebugInfo({
    info: {status: 'ready', story_time: {day_index: 0}, trace: []},
  });
  assert.equal(zeroIndex.persisted_structured, true);
  assert.equal(zeroIndex.parseable, true);

  const invalid = diagnostics.buildStoryTimeDebugInfo({
    info: {status: 'ready', story_time: {display: '2026-02-30'}, trace: []},
  });
  assert.equal(invalid.persisted_structured, false);
  assert.equal(invalid.parseable, false);
  assert.equal(invalid.failure_reason, 'CURRENT_STORY_TIME_PARSE_FAILED');

  const conflict = diagnostics.buildStoryTimeDebugInfo({
    info: {
      status: 'ready',
      story_time: {display: '2026-09-20', normalized: '2026-09-21', day_index: null},
      trace: [],
    },
  });
  assert.equal(conflict.parseable, false);
  assert.equal(conflict.failure_reason, 'STORY_TIME_FIELD_CONFLICT');
});

test('Story Time diagnostics reports a unified difference without changing Event input', () => {
  const diagnostics = createRuntimeDiagnostics();
  const eventStoryTime = {display: '2026-09-19', normalized: null, day_index: null};
  const dto = diagnostics.buildStoryTimeDebugInfo({
    info: {status: 'ready', story_time: {display: '2026-09-20'}, trace: []},
    business: {
      active_events: [{event_id: 'event-a', story_time: eventStoryTime}],
      current_story_time_differences: { 'event-a': {value: 1, unit: 'day'} },
    },
  });
  assert.equal(dto.persisted_structured, false);
  assert.equal(dto.parseable, true);
  assert.equal(dto.comparable, true);
  assert.deepEqual(dto.difference, {value: 1, unit: 'day'});
  assert.equal(dto.recent_event.persisted_structured, false);
  assert.equal(dto.recent_event.parseable, true);
  assert.deepEqual(eventStoryTime, {display: '2026-09-19', normalized: null, day_index: null});
});

test('Story Time diagnostics exposes the current date, historical Event date, and 90 Story Days', () => {
  const diagnostics = createRuntimeDiagnostics();
  const eventStoryTime = {display: '2026-01-01', normalized: null, day_index: null, calendar_id: null};
  const currentStoryTime = {display: '2026-04-01', normalized: null, day_index: null, calendar_id: null};
  const dto = diagnostics.buildStoryTimeDebugInfo({
    info: {status: 'ready', story_time: currentStoryTime, trace: []},
    business: {
      active_events: [{event_id: 'event-90', story_time: eventStoryTime}],
      current_story_time_differences: {'event-90': {value: 90, unit: 'day'}},
    },
  });
  assert.equal(dto.story_time.display, '2026-04-01');
  assert.equal(dto.recent_event.story_time.display, '2026-01-01');
  assert.equal(dto.comparable, true);
  assert.deepEqual(dto.difference, {value: 90, unit: 'day'});
  assert.equal(dto.failure_reason, null);
});

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

test('UI performance trace preserves zero and millisecond fields through Debug JSON export', () => {
  const diagnostics = createRuntimeDiagnostics({getChatId: () => 'chat-debug'})
  diagnostics.observe({type: 'BIOWEAVE_PERSISTENCE_TRACE', payload: {
    stage: 'CHARACTER_UI_PERFORMANCE',
    operation: 'open',
    route: 'overview',
    ui_open_total_ms: 0,
    ui_initialization_ms: 1.25,
    business_read_ms: 2.5,
    canonical_build_ms: 3.75,
    dto_build_ms: 0,
    render_ms: 4,
    message_content: '敏感聊天正文不应进入 Trace',
  }})
  diagnostics.observe({type: 'BIOWEAVE_PERSISTENCE_TRACE', payload: {
    stage: 'CHARACTER_UI_PERFORMANCE',
    operation: 'route_switch',
    from_route: 'overview',
    to_route: 'characters',
    route_switch_total_ms: 5.5,
  }})
  const trace = diagnostics.getPersistenceTrace()
  const performanceEntries = trace.sequence.filter(item => item.stage === 'CHARACTER_UI_PERFORMANCE')
  assert.equal(performanceEntries[0].ui_open_total_ms, 0)
  assert.equal(performanceEntries[0].dto_build_ms, 0)
  assert.equal(performanceEntries[0].message_content, undefined)
  assert.equal(performanceEntries[1].route_switch_total_ms, 5.5)
  assert.equal(performanceEntries[1].ui_open_total_ms, undefined)

  const exported = JSON.parse(buildDebugExportText({historyTrace: trace}))
  const exportedEntries = exported.history_trace.sequence.filter(item => item.stage === 'CHARACTER_UI_PERFORMANCE')
  assert.equal(exportedEntries[0].ui_open_total_ms, 0)
  assert.equal(exportedEntries[0].canonical_build_ms, 3.75)
  assert.equal(exportedEntries[1].route_switch_total_ms, 5.5)
  assert.equal(exportedEntries[1].message_content, undefined)
})

test('Event reconciliation diagnostics keep only safe IDs, reasons, and timings', () => {
  const diagnostics = createRuntimeDiagnostics({getChatId: () => 'chat-debug'})
  diagnostics.observe({type: 'BIOWEAVE_PERSISTENCE_TRACE', payload: {
    stage: 'EVENT_RECONCILIATION_RESULT',
    pre_analysis_event_ids: ['event-a', 'event-b'],
    candidate_event_count: 1,
    post_analysis_event_ids: ['event-a'],
    removed_event_ids: ['event-b'],
    removal_reasons: [{event_id: 'event-b', reason: 'explicit_continuation_duplicate'}],
    continuation_diagnostics: [{
      continuation_reference_present: true,
      continuation_reference_event_id: 'event-a',
      continuation_reference_target_exists: true,
      continuation_reference_valid: true,
      continuation_merge_executed: true,
    }],
    canonical_build_wall_ms: 7.5,
    tracking_registry_sync_ms: 1.25,
    story_text: '敏感剧情正文不应进入 Trace',
    evidence: [{text: '敏感证据'}],
  }})
  const entry = diagnostics.getPersistenceTrace().sequence.at(-1)
  assert.equal(entry.pre_analysis_event_ids[0], 'event-a')
  assert.equal(entry.continuation_diagnostics[0].continuation_reference_valid, true)
  assert.equal(entry.canonical_build_wall_ms, 7.5)
  assert.equal(entry.story_text, undefined)
  assert.equal(entry.evidence, undefined)
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

test('NSFW pipeline recorder preserves explicit execution status and source semantics', () => {
  const diagnostics = createRuntimeDiagnostics()
  const floorVersion = {
    chat_id: 'chat-a', message_id: 'message-a', floor: 3, message_index: 3,
    swipe_id: 1, content_hash: 'hash-a', message_version: 2,
  }
  const runId = diagnostics.startNsfwPipelineRun({chat_id: 'chat-a', floor_version: floorVersion})
  for (const [stage, execution_status, invoked, source_type] of [
    ['schedule', 'SKIPPED', false, 'EXECUTION_TRACE'],
    ['timing', 'BLOCKED', true, 'EXECUTION_TRACE'],
    ['aggregation', 'PERSIST_FAILED', true, 'EXECUTION_TRACE'],
    ['projection', 'NOT_INVOKED', false, 'DERIVED_DIAGNOSTIC'],
  ]) {
    assert.equal(diagnostics.recordNsfwPipelineStage({
      stage, run_id: runId, floor_version: floorVersion, execution_status, invoked, source_type,
      reason_code: `${stage}_reason`, subject_id: 'subject-a', cycle_id: 'cycle-a', tracking_window_cycle_id: 'cycle-a',
      final_cycle_id: 'cycle-a', cycle_id_source: 'TRACKING_WINDOW', cycle_id_consistent: true,
      cycle_id_consistency_reason_code: 'TRACKING_WINDOW_CYCLE_MATCH', candidate_exposure_event_ids: ['event-a'],
      accepted_exposure_event_ids: ['event-a'], world_rule_binding: null, readback_attempted: true,
      readback_succeeded: true, readback_result_present: true, input_count: 2,
    }), true)
  }
  assert.equal(diagnostics.finishNsfwPipelineRun({run_id: runId, floor_version: floorVersion, execution_status: 'PERSIST_FAILED'}), true)

  const result = diagnostics.getNsfwPipelineDiagnostics({run_id: runId, floor_version: floorVersion})
  assert.equal(result.runs[0].execution_status, 'PERSIST_FAILED')
  assert.deepEqual(result.stages.map(stage => stage.execution_status), [
    'SKIPPED', 'BLOCKED', 'PERSIST_FAILED', 'NOT_INVOKED',
  ])
  assert.equal(result.stages[3].invoked, false)
  assert.equal(result.stages[3].source_type, 'DERIVED_DIAGNOSTIC')
  assert.equal(result.stages[0].source_type, 'EXECUTION_TRACE')
  assert.equal(result.stages[1].run_context_available, true)
  assert.equal(result.stages[0].tracking_window_cycle_id, 'cycle-a')
  assert.equal(result.stages[0].cycle_id_consistent, true)
  assert.deepEqual(result.stages[0].candidate_exposure_event_ids, ['event-a'])
  assert.equal(result.stages[0].readback_result_present, true)
  assert.equal(diagnostics.getDiagnosticMetadata({current_floor_version: floorVersion}).current_run_id, runId)
})

test('NSFW pipeline export keeps current state, execution trace, and derived diagnostics separate', () => {
  const exported = JSON.parse(buildDebugExportText({
    diagnosticMetadata: {diagnostics_schema_version: 1, trace_buffer_status: 'EMPTY', trace_truncated: null},
    nsfwPipelineDiagnostics: {
      current_state: {source_type: 'CURRENT_STATE', timing_instance_count: 0},
      execution_trace: {source_type: 'EXECUTION_TRACE', trace_buffer_status: 'EMPTY', stages: []},
      derived_diagnostic: {source_type: 'DERIVED_DIAGNOSTIC', current_blocking_reason_code: 'TRACE_UNAVAILABLE'},
    },
    timingDiagnostics: [{source_type: 'DERIVED_DIAGNOSTIC', timing_reason_code: 'TRACE_UNAVAILABLE'}],
    aggregationDiagnostics: [{source_type: 'DERIVED_DIAGNOSTIC', aggregation_reason_code: 'TRACE_UNAVAILABLE'}],
  }))
  assert.equal(exported.diagnostic_metadata.trace_buffer_status, 'EMPTY')
  assert.equal(exported.nsfw_pipeline_diagnostics.current_state.source_type, 'CURRENT_STATE')
  assert.equal(exported.nsfw_pipeline_diagnostics.execution_trace.source_type, 'EXECUTION_TRACE')
  assert.equal(exported.nsfw_pipeline_diagnostics.derived_diagnostic.source_type, 'DERIVED_DIAGNOSTIC')
  assert.equal(exported.timing_diagnostics[0].timing_reason_code, 'TRACE_UNAVAILABLE')
  assert.equal(exported.aggregation_diagnostics[0].aggregation_reason_code, 'TRACE_UNAVAILABLE')
})

test('NSFW pipeline recorder bounds run and stage buffers and reports truncation', () => {
  const diagnostics = createRuntimeDiagnostics({maxNsfwPipelineRuns: 2, maxNsfwPipelineStages: 2})
  const runIds = []
  for (let index = 1; index <= 3; index += 1) {
    const runId = diagnostics.startNsfwPipelineRun({run_id: `run-${index}`, chat_id: 'chat-a'})
    runIds.push(runId)
    diagnostics.recordNsfwPipelineStage({run_id: runId, stage: `stage-${index}`, execution_status: 'ATTEMPTED'})
  }
  const result = diagnostics.getNsfwPipelineDiagnostics()
  assert.deepEqual(result.runs.map(run => run.run_id), runIds.slice(1))
  assert.deepEqual(result.stages.map(stage => stage.stage), ['stage-2', 'stage-3'])
  assert.equal(result.trace_truncated, true)
  assert.equal(diagnostics.getDiagnosticMetadata().trace_truncated, true)
})

test('NSFW pipeline recorder isolates run IDs and Floor Versions', () => {
  const diagnostics = createRuntimeDiagnostics()
  const floorA = {chat_id: 'chat-a', message_id: 'message-a', floor: 1, swipe_id: 0, content_hash: 'hash-a', message_version: 1}
  const floorB = {...floorA, swipe_id: 1, content_hash: 'hash-b', message_version: 2}
  const runA = diagnostics.startNsfwPipelineRun({run_id: 'same-run', chat_id: 'chat-a', floor_version: floorA})
  const runB = diagnostics.startNsfwPipelineRun({run_id: 'same-run', chat_id: 'chat-a', floor_version: floorB})
  assert.notEqual(runA, runB)

  diagnostics.recordNsfwPipelineStage({run_id: runA, floor_version: floorA, stage: 'floor-a', execution_status: 'SUCCEEDED'})
  diagnostics.recordNsfwPipelineStage({run_id: runB, floor_version: floorB, stage: 'floor-b', execution_status: 'SUCCEEDED'})
  diagnostics.recordNsfwPipelineStage({run_id: runA, floor_version: floorB, stage: 'mismatch', execution_status: 'BLOCKED'})

  const floorAResult = diagnostics.getNsfwPipelineDiagnostics({floor_version: floorA})
  const floorBResult = diagnostics.getNsfwPipelineDiagnostics({floor_version: floorB})
  assert.equal(floorAResult.stages[0].stage, 'floor-a')
  assert.equal(floorBResult.stages[0].stage, 'floor-b')
  const mismatch = diagnostics.getNsfwPipelineDiagnostics({run_id: runA}).stages.find(stage => stage.stage === 'mismatch')
  assert.equal(mismatch.run_context_available, false)
  assert.equal(mismatch.run_floor_match, false)
  assert.equal(mismatch.reason_code, 'RUN_FLOOR_VERSION_MISMATCH')
})

test('NSFW pipeline stages correlate with existing persistence trace by run and Floor Version', () => {
  const diagnostics = createRuntimeDiagnostics()
  const floorVersion = {chat_id: 'chat-a', message_id: 'message-a', floor: 4, swipe_id: 0, content_hash: 'hash-a', message_version: 1}
  const runId = diagnostics.startNsfwPipelineRun({chat_id: 'chat-a', floor_version: floorVersion})
  diagnostics.observe({type: 'PROJECTION_ANALYSIS_STATUS_CHANGED', payload: {
    stage: 'PROJECTION_TIMING_EVALUATED', run_id: runId, chat_id: 'chat-a', floor_version: floorVersion,
  }})
  diagnostics.observe({type: 'PROJECTION_ANALYSIS_STATUS_CHANGED', payload: {
    stage: 'PROJECTION_READBACK', run_id: runId, chat_id: 'chat-a',
    floor_version: {...floorVersion, swipe_id: 1, content_hash: 'other-hash'},
  }})
  diagnostics.observe({type: 'BIOWEAVE_PERSISTENCE_TRACE', payload: {
    stage: 'unversioned_trace', run_id: runId, chat_id: 'chat-a',
  }})
  diagnostics.recordNsfwPipelineStage({
    run_id: runId, chat_id: 'chat-a', floor_version: floorVersion, stage: 'timing', execution_status: 'SUCCEEDED',
  })
  const result = diagnostics.getNsfwPipelineDiagnostics({run_id: runId})
  const traceSequence = diagnostics.getPersistenceTrace().sequence[0].seq
  assert.deepEqual(result.stages[0].persistence_trace_sequences, [traceSequence])
  assert.equal(diagnostics.getPersistenceTrace().sequence[0].run_id, runId)
})

test('NSFW recorder failures are fail-open and surfaced as partial diagnostic collection', () => {
  const diagnostics = createRuntimeDiagnostics({getChatId: () => { throw new Error('host unavailable') }})
  let businessResult = null
  assert.doesNotThrow(() => {
    const runId = diagnostics.startNsfwPipelineRun({floor_version: {chat_id: 'chat-a', floor: 1}})
    diagnostics.recordNsfwPipelineStage({
      run_id: runId, stage: 'scheduler', execution_status: 'ATTEMPTED',
    })
    businessResult = 'business-continued'
  })
  assert.equal(businessResult, 'business-continued')
  assert.equal(diagnostics.getDiagnosticMetadata().collection_status, 'PARTIAL')
  assert.equal(diagnostics.getDiagnosticMetadata().diagnostic_error_code, 'DIAGNOSTIC_RECORDER_FAILED')
  assert.equal(diagnostics.getNsfwPipelineDiagnostics().collection_status, 'PARTIAL')
  assert.equal(diagnostics.getNsfwPipelineDiagnostics().diagnostic_error_code, 'DIAGNOSTIC_RECORDER_FAILED')
  assert.equal(diagnostics.recordNsfwPipelineStage(new Proxy({}, {get() { throw new Error('diagnostic input failed') }})), false)
  assert.equal(diagnostics.getNsfwPipelineDiagnostics().collection_status, 'PARTIAL')

  const observerDiagnostics = createRuntimeDiagnostics({getChatId: () => { throw new Error('host unavailable') }})
  assert.doesNotThrow(() => observerDiagnostics.observe({type: 'PROJECTION_ANALYSIS_STATUS_CHANGED', payload: {stage: 'PROJECTION_PROCESS_STARTED'}}))
  assert.equal(observerDiagnostics.recordLifecycleTrace('LIFECYCLE_DIAGNOSTIC_FAILURE', {}), false)
  assert.equal(observerDiagnostics.getDiagnosticMetadata().collection_status, 'PARTIAL')
  assert.equal(observerDiagnostics.getDiagnosticMetadata().diagnostic_error_code, 'DIAGNOSTIC_RECORDER_FAILED')
})

test('missing session trace is unknown and never reported as proof of NOT_INVOKED', () => {
  const diagnostics = createRuntimeDiagnostics()
  assert.equal(diagnostics.getDiagnosticMetadata().trace_buffer_status, 'EMPTY')
  assert.equal(diagnostics.getDiagnosticMetadata().trace_truncated, null)
  assert.equal(diagnostics.getNsfwPipelineDiagnostics().trace_truncated, null)
  assert.deepEqual(diagnostics.getNsfwPipelineDiagnostics().stages, [])
})

test('legacy lifecycle trace ring reports when earlier execution history was overwritten', () => {
  const diagnostics = createRuntimeDiagnostics()
  for (let index = 0; index < 65; index += 1) {
    diagnostics.recordLifecycleTrace(`LIFECYCLE_${index}`, {event_type: 'test'})
  }
  assert.equal(diagnostics.getDiagnosticMetadata().trace_truncated, true)
  diagnostics.observe({type: 'PROJECTION_ANALYSIS_STATUS_CHANGED', payload: {stage: 'PROJECTION_PROCESS_STARTED'}})
  assert.equal(diagnostics.getPersistenceTrace().trace_truncated, true)
})
