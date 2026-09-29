# World Model Debug Schema v3 实施

## 目标

基于已完成的 Audit，将 World Model diagnostics 迁移到 schema v3。只改变诊断字段、serializer、Debug UI、测试和规范，不改变 World Model 的分析、retry、mutation、persistence、readback 或 UI projection 行为。

## 必须保持不变

- AI request count、transport/format retry 和请求消息。
- Fact Delta parsing、validation、resolver、evidence/safety boundary。
- Patch V2、Execution Snapshot、collection/Unknown lifecycle。
- saveWorldModel、Floor Persistence Coordinator、authoritative readback、UI projection。

## Schema 变更

- version 2 -> 3，继续使用现有唯一 version source。
- 保留 `dynamic_coverage_target_ids`。
- `unresolved_dynamic_target_ids` -> `unaccounted_dynamic_target_ids`。
- `coverage_rounds` -> `derived_target_accounting_records`，保留 array、顺序和 accounting 信息；记录索引不得再暗示 semantic round。
- `coverage_fixed_point_reached` -> `derived_target_accounting_complete`，保持计算逻辑。
- `dynamic_coverage_unresolved_in_single_response` -> `dynamic_coverage_unaccounted_in_single_response`，保持触发条件。
- execution-level `final_result` 与 Fact Delta-level `final_result` 使用明确 namespace。
- Fact Delta 不再拥有最终 `persistence_occurred`；最终 persistence telemetry 属于 execution/persistence diagnostics。
- 无 producer 的 `mutation_ui_projected` 从 v3 serialized diagnostics 移除。
- 保留 current persistence candidate diagnostics，且不恢复旧 AI Candidate semantics。
- 保留 `latest_nonempty_fact_delta`，避免复制完整 candidate model，使用 bounded candidate reference/summary。

## 验收

- modified JS 全部 `node --check` 通过。
- 相关 World Model/debug/settings/API profile 测试通过；旧断言只按明确 schema 变更更新。
- `npm test`、`git diff --check` 通过或明确报告既有失败及 failure identity。
- source scan 中 current production/debug code 不再使用旧 diagnostics keys 和 semantic-continuation wording。
- 提供 before/after invariance evidence：messages、request count、facts、ops、snapshot、Floor writes/final model。
- 不修改 Group A dead API。
