# Technical design

## Boundary

保持现有链路：

```text
validated BiologicalEvent
  -> existing Health Assessment AI pass
  -> normalized/validated Assessment v2
  -> Health Evolution severity passthrough
  -> existing derived read model
```

severity 是 Assessment output metadata。BiologicalEvent 仍只保存 factual
payload；Evolution 不评估 severity；Aggregation、Projection、Snapshot 和 UI 不
成为 authority。

## Assessment schema and compatibility

- `HEALTH_ASSESSMENT_SCHEMA_VERSION` 升为 2。
- 新写入 Assessment 必须带 schema v2 和 severity。
- 规范化允许四个值：`unknown`、`mild`、`moderate`、`severe`。
- 缺失或非法 severity 在合法 Assessment 中运行时按 unknown 消费；非法单字段
  不加入 validation error。
- v1 item 读取时保留其 legacy schema/字段缺失状态，不把 severity=unknown 写回。
- legacy timeline 只有在已有新 Assessment 写入时才升级容器 schema；旧 Assessment
  item 本身仍保持 v1/缺字段，从而区分“legacy 缺字段”和“v2 明确 unknown”。

## Prompt and analyzer

修改现有 `buildHealthAssessmentMessages` 的结构化输出契约，加入 schema v2 和
severity 规则。`analyzeHealthAssessment` 继续使用现有一次调用、解析和 core
validation；不新增 AI 请求。severity 非法由 core normalization 降级为 unknown，
其它字段照旧验证。

## Runtime and evolution

`runtime/health-assessment.js` 仅做必要的 v2 timeline 写入 wiring，并保持现有
request key、candidate reuse、source binding 和 stale guard。`core/health-evolution.js`
在 `buildObservation` 中从 Assessment 读取 severity，缺失时使用 unknown；不改变
recovery、Story Time 或 active/inactive 规则。

`core/health-aggregation.js` 不扩张 grouped issue DTO，因为当前 UI 没有 severity
consumer。`core/health-recovery-guidance.js` 不改动。

## Compatibility and lifecycle

旧 Chat、v1 Assessment、Snapshot、reload/replay 不因缺少 severity 重新调用 AI；
普通 reload 不 backfill。source Event edit/delete/swipe/rollback 仍只通过原有
fingerprint/source-floor binding 失效 Assessment。severity 不进入 Event identity、
Assessment request identity、Snapshot 或 Projection。

## Files expected to change

- `core/health-assessment.js`
- `runtime/health-assessment.js`（仅 v2 persistence wiring）
- `ai/prompts.js`
- `ai/analyzer.js`（仅必要的现有 validation/schema wiring）
- `core/health-evolution.js`
- `storage/schema.js`（默认 timeline schema）
- 相关 Health Assessment / Evolution tests
- `docs/CHARACTER-HEALTH-STATE.md`
- `docs/ARCHITECTURE.md`
- `docs/DEVELOPMENT.md`
- `docs/PROJECT-STATE.md`
- `docs/bioweave-data-lifecycle.md`
- `docs/DATA-MODEL.md` 或实际 Health Assessment contract 文档

不修改 UI、Event factual schema、generic runtime orchestration、Scheduler、
VERSION_CHAIN 或新建 Health module。
