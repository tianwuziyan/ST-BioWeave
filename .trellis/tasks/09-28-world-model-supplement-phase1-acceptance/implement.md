# Phase 1 执行计划

1. 记录 branch、HEAD、git status、最近提交和 baseline tests；确认当前未提交修改不属于本 task。
2. 搜索并读取 Supplement parser、resolver、evidence-unit builder、scope matcher、value matcher、Evidence Guard、diagnostics 及现有相关 tests。
3. 建立 evidence provenance trace，核对 parent heading inheritance、nested structured evidence、sibling boundaries、multiline handling、normalization 和 boundary reset。
4. 先添加或确认 generic reproduction：explicit scope、parent inheritance、wrong Species/Type、candidate hit but scoped zero、Existing/Target-only、identity/detail、faithful/embellished/world-scope value、dependency 和 no sibling inference。
5. 运行 targeted tests，判断 `SCOPE_BINDING_FAILED` 是否为 confirmed bug；若不是，记录 `NOT CONFIRMED` 并不改 matcher。
6. 单独审计 `VALUE_SUPPORT_FAILED`，仅对 confirmed false rejection 做最小修复，并验证 unsupported embellishment 仍被拒绝。
7. 运行 targeted tests、`npm run check`、相关 `node --check`、`git diff --check` 和 `python3 ./.trellis/scripts/task.py validate .trellis/tasks/09-28-world-model-supplement-phase1-acceptance`。
8. 最终复核 diff scope、Phase 1 非目标未改、baseline failure 分类和 `git status --short`；停止，不进入 Phase 2。

## Execution result

- Branch：`fix/world-model-prompt-baseline`；保留开始前全部未提交修改。
- Generic reproduction：explicit structured scope 与 parent heading inheritance 均通过；wrong Species 产生 `candidate_unit_count > 0`、`scoped_unit_count = 0`、`SCOPE_BINDING_FAILED`，结论为正确 fail-closed，而非 confirmed matcher bug。
- Parent provenance：`factDeltaEvidenceUnitRecords()` 通过 transient parent headings 和带 scope 前缀的 unit text 保留结构化上下文；现有 bounded diagnostics 在 debug 模式下提供 parent context summary。
- Value support：现有 positive controls、identity/detail separation、unsupported value、embellishment、world-scope overclaim、Existing/Target-only 与 no-sibling cases 均符合 contract；未确认 false rejection。
- 修改：仅在 `tests/world-model.test.js` 增加 generic scope audit regression；未修改 `ai/analyzer.js`、`ai/world-supplement-protocol.js` 或其它产品代码。
- Targeted test：`node --test tests/world-model.test.js`，265 passed / 0 failed。
- Full check：`npm run check`，1080 passed / 0 failed；本次未观察到 Phase 3 baseline failure，也没有新增 failure。
- Syntax / diff / Trellis：`node --check ai/analyzer.js`、`node --check ai/world-supplement-protocol.js`、`git diff --check`、`task.py validate` 均通过。
- 本 task 在此停止，不进入 Phase 2；未 commit、未 push。

## Rollback boundary

只允许回退本 task 本轮新增的产品代码或测试修改；保留用户已有未提交修改、稳定化方案和其它 task。禁止 reset、clean、checkout、restore、commit、push。
