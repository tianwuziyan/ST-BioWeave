# 调查删除旧 Floor Event 后后续 Events 从 UI 消失

## Goal

在真实 SillyTavern Host 中，定位删除 Floor 70 的单个旧测试 Event 后，Floor 70 之后仍应存活的独立 BiologicalEvents 从 Event UI 消失的第一处真实数据分歧，并明确归类为：

- A：persistence/delete corruption；
- B：authoritative collection/rebuild bug；
- C：presentation-only bug。

Floor 70 的目标 Event 是用户主动删除的数据，不需要恢复，也不增加 legacy Health compatibility。

## 已确认事实

- Host 删除事务为 `operation_type=event-delete-patch`、`floor=70`、`message_id=70`、`swipe_id=0`。
- Floor 70 save、official readback、host sync、Floor Version/Swipe match、sibling audit 和最终 confirmed 均成功。
- 删除后的 Character/Event authoritative rebuild 记录 `CHARACTER_FLOOR_SOURCE_RESOLVED event_count=3` 与 `CHARACTER_CANONICAL_STATE_BUILT event_count=3`，但这不足以证明后续 Floor 的 slot、collection 或 UI 状态。
- UI 删除入口在 `ui/app.js`，删除业务由 `runtime/event-editing.js` 执行；删除后刷新 Tracking/derived state。
- `collectCurrentFloorStates()` 按当前消息集合和 active Swipe 遍历 Character Floors，`getActiveFloorEvents()` 以完整 Floor Version 过滤 Event。

## 调查要求

1. 只读跟踪完整调用链：Event UI 删除入口 → delete request/target resolution → target Floor Version → `event-delete-patch` → Floor persistence → official readback → host memory sync → full-chat Floor collection → canonical Event state → Event UI read model/render。
2. 证明或排除 `event-delete-patch` 是否只写目标 Floor/active Swipe；检查删除后的 invalidation/reconciliation 是否存在按 `floor >= target floor` 清理、截断或失效的路径。
3. 检查 `collectCurrentFloorStates`、`getActiveFloorEvents`、active Swipe resolver、Floor Version resolver，以及 latest analyzed/baseline/current Floor 边界是否错误影响后续 Floor collection。
4. 不根据 `event_count=3` 猜结论；必须针对至少一个 Floor > 70 的 surviving Event 记录：删除前存在、事务后 official source、collection 是否扫描、included/excluded 原因、canonical state 是否存在、UI read model 是否存在。
5. 如果现有 diagnostics 无法证明 A/B/C，只增加 observation-only diagnostics，不写 Floor、不触发额外 persistence write、不修改业务语义。

## 诊断范围

优先增加或扩展 `CHARACTER_FLOOR_COLLECTION_AUDIT`，逐个记录 `floor`、`message_id`、`active_swipe_id`、candidate swipe、BioWeave slot/events presence、event count/IDs、Floor Version match、included 和结构化 `exclusion_reason`；同时记录 collection summary 的 scanned/included Floor 数、总 Event 数和 included Event IDs。

如 persistence 证据不足，再增加只读 `EVENT_DELETE_CROSS_FLOOR_AUDIT`，在删除前和 official readback 后比较目标 Event IDs，以及非目标 Floors 的 Event slots/IDs；不得为诊断额外写入 persistence。

## 明确排除

- 不修改 `health_role` contract，不恢复 legacy Assessment compatibility。
- 不修改 Health Assessment、Evolution、Aggregation、Guidance。
- 不为 Floor 70 旧测试数据做 migration/backfill。
- 不修改 scheduler。
- 不先假设 UI bug，也不先假设 persistence corruption。
- 不恢复 Floor 70 被删除的 Event。
- 本阶段不修改业务修复点；只有审计明确发现确定、局部且无需额外产品决策的修复点，才在后续阶段提出最小修复方案。

## Acceptance Criteria

- [ ] 形成 `ROOT CAUSE` 或 `NOT YET PROVEN` 结论，并完成 A/B/C 分类。
- [ ] 给出第一处 divergence 的精确文件、函数、字段和调用链证据。
- [ ] 至少一个 Floor > 70 surviving Event 完成 delete 前、official source、collection、canonical、UI 五段证据闭环。
- [ ] 证明 `event-delete-patch` 的目标写入范围，或明确缺失的 persistence 观察点。
- [ ] 若无法由现有诊断证明，增加且仅增加 observation-only diagnostics，并覆盖对应测试；不得改变业务语义或执行额外 persistence write。
- [ ] 若代码审计确认根因，再提出最小业务修复和 regression test 方案；未经后续明确授权不实施业务修复。
- [ ] 完成必要的静态检查和相关自动化测试，并明确是否需要再次真实 ST Host 复现。
- [ ] task 保持 `in_progress`；不 commit、不 push。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
