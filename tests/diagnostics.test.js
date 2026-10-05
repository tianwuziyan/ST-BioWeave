import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canonicalFailureCategory,
  FAILURE_CATEGORIES,
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
