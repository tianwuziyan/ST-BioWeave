# 修复 Event AI continuation 协议与 Schema 冲突并审计 UI 首次打开卡顿

## Goal

修复真实 ST 中 Event AI 返回形状与严格 Event Contract 不一致导致的 continuation 分析失败，同时保留非法顶层字段拒绝、Event 持久化边界和 Floor 权威性；完成 UI 首次打开 canonical build 的静态性能审计，并给出下一步最小性能方案。本任务不实施 UI 性能编排优化。

## Confirmed evidence

- `ai/prompts.js` 要求 Event 响应顶层固定为 `{schema_version:1, events:[]}`，continuation 字段描述为 `events[]` 内 Event 的临时字段。
- `ai/analyzer.js:3520` 的 `parseEventAnalysisResponse()` 只接受顶层 `schema_version`、`events` 和兼容 `source`；其它顶层字段在 `$.<field>` 报 `unexpected_top_level_field`。
- 真实 Debug `ST-BioWeave-Debug-20261013-174833.txt` 的同一手动分析两次失败分别为 `$.state_fact` 与 `$.continuation_of_event_id`，随后 `EVENT_STAGE_RETRY_EXHAUSTED` 和 `ANALYSIS_FAILED`。
- 当前解析器已经接受 Event 内的 `state_fact`、`continuation_of_event_id`、`continuation_update`，并在 Runtime continuation 合并后移除临时字段；持久化 Event Schema 不应因此放宽。
- 真实 Debug 的首次打开/分析阶段有 10 次 `CHARACTER_CANONICAL_BUILD_STARTED`、10 次 completed、0 次 joined；单次约 730–770ms。多次 `request_source="unknown"` 的 `business-read` 出现在 UI refresh 之外，说明存在串行重复业务读取，但该 wall-clock 指标不能单独证明主线程同步阻塞。

## Requirements

1. 追踪完整 analyzer → JSON parse/validation → Runtime continuation extraction/merge → persistence 路径，确定真实响应的协议层级。
2. 让 AI 能合法表达 `continuation_of_event_id` 与 `continuation_update`，并正确保留合法 Event 内 `state_fact`；临时字段不得进入 canonical Event 或 Snapshot。
3. 保持严格未知字段校验；不得把所有 unknown top-level fields 改为允许。
4. 保留 authoritative Floor/Swipe/Version 校验、原 Event ID/source.floor、显式 continuation 的完整兼容条件，以及不同真实事件不自动合并的规则。
5. 增加真实 analyzer → parser/validation 路径的回归测试，覆盖真实失败形状和最终 Runtime merge/persistence 边界；不只测试 merge helper。
6. 只读审计 UI 首次打开的 canonical build 调用来源、串行重复、`collectCurrentDerivedState` 子步骤和 wall-clock/CPU 边界；不修改 UI refresh 编排或 canonical 并发合并机制。
7. 允许修改必要的 Event AI 协议解析代码、定向测试和受影响的协议文档；禁止修改 Event persistence Schema、Floor Snapshot Schema、Prompt、Scheduler、Projection 排序和 Tracking 业务语义。

## Acceptance criteria

- [ ] 真实失败形状可通过完整 `createAnalyzer().analyzeFloor()` 路径解析，且合法 continuation metadata 只存在于分析中间结果。
- [ ] 合法 `state_fact` 仍按 Event 内严格结构校验；顶层 `state_fact` 的处理与最终协议定义一致，任意其它未知顶层字段仍被拒绝。
- [ ] continuation merge 后保留原 Event ID 与 `source.floor`，临时 continuation 字段不被持久化。
- [ ] Floor 66 → 68 continuation、同时间但不同真实事件不误合并的既有测试仍通过，并新增完整 analyzer/parser 回归覆盖。
- [ ] Debug 性能报告明确列出 10 次 canonical build 的调用/刷新关联、`unknown` 来源和可确认/不可确认的主线程结论。
- [ ] `npm run check` 与 `git diff --check` 通过。

## Out of scope

- UI refresh 编排、刷新合并、render、Projection 排序或 canonical in-flight 合并机制。
- Event persistence Schema、Floor Snapshot Schema、Floor/Swipe/Version 规则、Tracking 语义、Scheduler、Prompt 的业务要求变更。
- 通过时间/参与者相似度扩大 continuation 自动合并。

## Open questions

无阻塞问题。协议兼容形状以代码、真实 Debug 和现有严格 Contract 为依据；若发现必须修改持久化 Schema，立即停止并报告。
