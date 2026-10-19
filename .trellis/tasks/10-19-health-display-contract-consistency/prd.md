# 统一健康部位展示与 API Prompt 语义

## Goal

修复 API Prompt 中身体方向重复，以及 API 显示全身而人物 UI 显示未知的不一致。

## Requirements

- factual `body_site` 已包含方向时，API 恢复指导不得再次前置 `laterality`；`右手食指 + right` 只能显示一次“右手食指”。
- `laterality` 继续保留为结构化分组维度；展示层不得修改原始 Event `body_site`。
- 当 API 恢复指导将缺少部位的内部 `general` 展示为“全身”时，Character Health UI 必须显示“全身”，不能显示“未标明部位”。
- 保留缺失/无效 Health State 的安全空状态和现有 source navigation。

## Acceptance Criteria

- [ ] 最小复现不再产生“右右手食指”或“左左膝”。
- [ ] API Prompt 与 Character UI 对无 `body_site` 的 general 健康问题都显示“全身”。
- [ ] 原始 Event `body_site: null` 仍保持 null，`display_site` 只作为 derived presentation。
- [ ] 现有身体部位、方向分组、severity 和恢复指导行为不变。
- [ ] 更新 UI/Projection/Health Guidance 定向测试及相关 Markdown 契约。

## Out of Scope

- 不回写原始 Event 的 `body_site`，不改变 Health Aggregation 的分组、严重度、Assessment 或 Recovery Guidance 计算规则。
- 不修改 Floor/Swipe/Version ownership 和 source navigation。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
