# World Model Debug Schema v3 审计

## Goal

只读审计 World Model Debug Schema v2 的字段 ownership、命名、cardinality、兼容性与 v3 必要性，不修改生产架构。

## Scope and constraints

- 以当前真实 producer root 为准，完整追踪 `world_model_live_state`、`latest_fact_delta`、`latest_nonempty_fact_delta`、`request_transitions`、fact mappings、coverage dispositions/mutation states、identity diversity、collection lifecycle、request envelope、coverage rounds、unknown resolution、candidate/persistence、UI projection、history trace 与 fingerprints。
- 每个字段记录 producer、consumer、是否 serialized、是否 UI-visible、test/spec dependency、当前语义、owner、cardinality、null/false/zero semantics，以及 ambiguous/stale 判断。
- owner 只能归入 REQUEST、FACT_PIPELINE、COVERAGE_ACCOUNTING、IDENTITY_REVIEW、COLLECTION_LIFECYCLE、EXECUTION_SNAPSHOT、PERSISTENCE、RECONCILIATION、UI_PROJECTION、HISTORY_TRACE；混合职责标记 `MIXED_OWNERSHIP`。
- 特别证明五个 dynamic coverage 字段的实际 algorithm、`coverage_rounds` 的 production min/max cardinality、`final_result` 与 persistence fields 的层级归属、candidate/fingerprint/request transition 重复、mutation null semantics、latest delta duplication 和 status vocabulary。
- 只读审计；禁止修改 production code、tests、Spec、UI、Debug Schema version、Fact Delta、Prompt、Resolver、Evidence Guard、Patch V2、Snapshot、Persistence、Floor Coordinator、UI behavior、retry 或 coverage algorithm。
- 若发现 runtime bug，只在报告中单列，不顺手修复。

## Acceptance Criteria

- [ ] 输出 Executive Summary，并明确 `Should Debug Schema v3 change dynamic coverage diagnostics? YES / NO / PARTIAL`。
- [ ] 输出 ownership map、Coverage audit、Result/Persistence audit、Candidate/Fingerprint audit、Stale/Ambiguous fields、Compatibility audit、完整 schema inventory、Tier 分组、proposed v3 fragment 或明确不升级理由、migration risk 与 Phase 2 scope。
- [ ] 对 `coverage_rounds` 给出 production minimum/maximum，并区分 transport retry、FORMAT_RETRY、failed attempt、semantic response attempt、dynamic derivation 与 snapshot accumulation 是否追加。
- [ ] 对同名 `final_result`、`persistence_occurred` 与 live execution/persistence/UI fields 给出 owner/timepoint 结论，避免把 attempt-level 误读为 execution-level。
- [ ] 只使用仓库代码、测试、文档、历史 task 与当前 smoke 基线作为证据；所有关键结论带文件:行号或测试证据。
- [ ] 运行只读验证（至少相关 World Model/debug tests、必要的静态/schema consumer 搜索、`git diff --check`），并报告未执行或无法证明的 real-host acceptance。
- [ ] 任务结束时 production worktree 仍无本 task 修改；仅允许 task planning/report artifacts。

## Confirmed baseline

- 当前 `WORLD_MODEL_DEBUG_SCHEMA_VERSION = 2`。
- 最近真实 Smoke 已确认 `snapshot_consistent = true`、`canonical_mutation_occurred = true`、`final_result = UPDATED`、persistence confirmed、authoritative readback ingress 与 UI render 完成；本 task 不是 runtime bug 修复。
- World Supplement legacy semantic cleanup 已完成；不重新审计旧 Candidate/parser/semantic Guard。
- 当前 producer roots 主要位于 `ai/analyzer.js`、`runtime/world-analysis.js`、`runtime/diagnostics.js`、`ui/app.js`、`utils/world-model-debug.js`，consumer/allow-list 位于 `runtime/events.js` 与 `ui/settings.js`，回归依赖位于 `tests/world-model-debug.test.js`、`tests/event-analysis-runtime.test.js`、`tests/world-model.test.js` 等。

## Acceptance evidence format

- 最终表格列：Field、Owner、Producer、Consumer、Cardinality、Current meaning、Ambiguous?、Stale?、v3 action。
- `v3 action` 只能为 `KEEP`、`RENAME`、`RESHAPE`、`DELETE`、`MOVE`、`NEEDS_DECISION`。
- 仅在名称会导致错误架构理解、owner 不清导致错误诊断、字段 stale、同名跨层歧义、cardinality 与 architecture 不符或 duplication 造成诊断歧义时建议升级；纯 cosmetic 默认不改。
