# Event 与 Character canonical business-state 回归审计

## Goal

以 a8030e 与当前分支为基线，审计 Event/Character extraction、canonical business-state 与 UI-ready 回归，不修改生产代码

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
# Event 与 Character canonical business-state 回归审计

## Goal

以 commit `a8030e285936f7101f879aa7129369c2595b2dbf` 作为已知较早正常 baseline，针对当前分支 `fix/world-model-prompt-baseline` 做只读 targeted regression audit，解释真实 Trace 中 `registry_character_count = 1` 但 `character_count = 0` 的精确原因，并区分 Event extraction regression 与 Character canonical/UI projection regression。

## Scope

- 对比 `ai/prompts.js` 中 Event prompt 的完整语义变化。
- 分别追踪 baseline/current 的 Event AI raw response 到 Character UI 的数据链。
- 审计 `runtime/event-analysis.js`、`runtime/events.js`、`ui/app.js`、`ui/characters.js`、`storage/projection.js`、`storage/store.js` 及相关 Core/Domain 调用。
- 检查 `CHARACTER_CANONICAL_ACTUAL`、`CHARACTER_CANONICAL_STATE_BUILT`、`CHARACTER_UI_READY`、single-in-flight/queued refresh 相关近期改动是否改变人物资格或 readiness。
- 单独核对 Event 各阶段计数 diagnostics；已有等价字段只列出，不重复设计。
- 明确最小修复位置、引入行为差异的 commit/change、应保持不动的 persistence 代码，以及是否需要补 diagnostics 后再做真实测试。

## Confirmed constraints

- 本轮不修改生产代码，不修改已通过真实 SillyTavern persistence 验证的 World/Event persistence、settle barrier、owner acquisition、scheduler、retry 或 bootstrap 逻辑。
- 真实 Trace 已确认 Event AI schema/domain 有效、Event persistence readback 为 1 个 Event、registry readback 为 1 个 Character，但 canonical Character state 的 `character_count` 为 0，随后 UI-ready 为 true。
- 报告必须以实际代码与 commit diff 为准，不把人物消失先验归因于 AI prompt。

## Acceptance criteria

1. 给出 `a8030e -> 当前` Event prompt 的完整实际变化及逐项语义影响。
2. 给出两版本的端到端数据生成链，并明确 `character_registry.entities`、`events[].participants`、`character_context/profiles`、`snapshot`、`projection_timeline` 是否参与人物计数。
3. 定位 `registry_character_count = 1`、`character_count = 0` 的精确代码条件和引入该行为差异的 commit/change。
4. 判断 readiness 是否错误地允许 `event_count > 0 && registry_character_count > 0 && character_count = 0 -> ready=true`，并结合既有产品边界说明结论。
5. 说明 Event 不全发生在 AI 侧还是 Runtime 侧；若当前 diagnostics 不足，列出最小新增计数方案，不实施。
6. 明确 A-J 结论：prompt diff、prompt 根因判断、两版本人物链、精确原因、Event 丢失阶段、回归 change、最小修复位置、禁止修改范围、真实测试前 diagnostics 决策。

## Out of scope

- 任何生产代码、测试代码、文档或 persistence 行为修改。
- 修复 Character canonical state、readiness 或 Event diagnostics。
- 重新执行真实 SillyTavern persistence 测试；只判断下一次测试所需的 diagnostics。
