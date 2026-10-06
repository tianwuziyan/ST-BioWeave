# Character Health v1 closure audit and real-host recovery acceptance

## Goal

确认当前 Character Health v1 主链已经闭环、跨层边界一致，并为真实 SillyTavern Host 的 Story Time 自然恢复测试形成可执行验收清单。任务目标是审计与验收准备，不是开发新功能。

## Background and confirmed contract

主链为：`BiologicalEvent factual observation → Health Assessment → Health Evolution → Health Aggregation → Current Health State → Character Health UI`；恢复指导链为：`Current Health State → Health Recovery Guidance → existing Projection Context`。

- Event 是 factual authority；Assessment 是 persisted derived assessment；Evolution 是 deterministic derived state；Character Health 是当前身体状态 read model。
- 只有显式 `health_role=observation` 进入 Assessment、Evolution、Severity、Guidance；`intervention` 仅保留在 Event history。
- 每个 observation 独立 Assessment/lifecycle；presentation aggregation 不合并 Assessment、deadline 或 lifecycle。
- 只有 `short_term + natural_recovery=eligible` 允许随 Story Time 自然演化；expected recovery boundary 可使 derived observation inactive；earliest recovery 不关闭 observation；`long_term`/`permanent` 不因时间自动关闭。
- 自然恢复不生成 recovery Event；Projection/Guidance 不修改 factual Event 或 Assessment。
- 不恢复 trajectory、Condition、reference graph、freshness model；scheduler CLOSED，不属于本 task。
- 不做 legacy `health_role` compatibility/backfill/migration，不做 intervention presentation lifecycle，不处理无关 Active Swipe / World prompt failures。

## Phase 1 requirements: read-only closure audit

检查实现、测试、spec 与 docs，并逐项归类为 `PASS`、`CONTRACT GAP`、`DEAD CODE`、`DOC DRIFT` 或 `NOT PROVEN`：

1. Event → Assessment eligibility 只接受显式 observation。
2. Assessment identity/binding 仍绑定 source Event、完整六字段 Floor Version 与 observation fingerprint。
3. Evolution 只从 surviving authoritative Event、valid Assessment 与 Story Time 派生。
4. expected recovery boundary 的 inactive 行为不产生 persistence mutation。
5. earliest recovery 不会错误关闭 observation。
6. long-term/permanent 不会自然过期。
7. Aggregation 只是 presentation compression，不共享 lifecycle/deadline。
8. Severity 只来自 active observation；UI 不重复计算 lifecycle/severity。
9. Guidance 只消费有效 active observation，并在 inactive 后消失。
10. Guidance 不产生 Event、Assessment 或写入。
11. 删除、edit、swipe、version invalidation 后，Health State 能从 surviving authority 正确重建。
12. intervention 不泄漏进 current health、severity 或 guidance；`source_event_id` traceability 成立。
13. 没有遗留 trajectory/Condition/freshness/legacy fallback 死代码或旧 contract。
14. docs/spec 与当前实现一致。

若发现真实 contract bug，只报告根因、证据和最小修复方案，不在本 task 内扩大实现范围。

## Phase 2 requirements: real-host recovery acceptance

在真实 ST Host 使用全新生成、非旧测试数据的 observation：`health_role=observation`、`short_term`、`natural_recovery=eligible`、明确 expected recovery assessment，且 Story Time 可比较。

验收必须覆盖：

- 初始阶段：Event history 有 factual observation；Character Health 显示 active issue；Severity 正常；Recovery Guidance 可生成且明确是非事实指导。
- boundary 前推进：Event 不变；Assessment 不重新调用 AI；observation 仍 active；recovery stage/guidance 随 elapsed Story Time 正确变化；不生成 recovery Event。
- 到达/超过 boundary：原 Event 与 persisted Assessment 仍存在；derived observation inactive；active issue、severity summary、Guidance 均移除该 observation；不生成“已恢复” factual Event；不改 factual Event 内容。
- reload/rebuild：刷新或重载 ST 后结果一致；inactive 状态由 Event + Assessment + Story Time 重新推导；Snapshot/cache 不是 authority。

## Out of scope

不实现新业务功能；不修改 scheduler；不做旧数据兼容、migration/backfill、intervention presentation lifecycle、explicit recovery reference graph、Condition/trajectory/freshness；不处理无关 Active Swipe 或 World prompt failures；不 commit/push。

## Final acceptance

- 交付 v1 closure audit 结果、每项证据与分类。
- 交付 Host acceptance checklist、测试数据要求和未验证项。
- 明确是否存在 contract gap、是否需要代码修改、是否可将 Character Health v1 当前主链标记为 `CLOSED`。
- 若存在未能在当前环境验证的真实 Host 行为，必须标记为 `NOT PROVEN`，不能宣称 CLOSED。
