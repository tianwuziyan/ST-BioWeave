# 阻止非健康内容生成 BiologicalEvent

## Goal

阻止剑灵共鸣等与生理健康无关的叙事生成 BiologicalEvent，同时保留合法 other_biological 健康事实。

## Confirmed Facts

- `ai/prompts.js` 当前允许 `other_biological` 使用自由 `fact.kind/description`，没有明确要求“非生理、非身体、非健康的精神/灵力/物品共鸣不得成为 Event”。[ai/prompts.js:52,78,81-87]
- `core/events.js` 与 `ai/analyzer.js` 只验证 `other_biological` 的 payload 形状，不判断事实是否确实属于生理/健康语义。[core/events.js:519-522；ai/analyzer.js:3033-3040]
- `healthAssessmentEligibility()` 会信任模型输出的 `health_role=observation`，因此错误的 `sword_resonance` 进入健康链路。[core/health-assessment.js:59-77]
- 现有 `other_biological + fracture + observation` 测试代表必须保留的合法健康事实。[tests/event-analysis.test.js:882-917]

## Requirements

- 明确 Event Analysis 的事实边界：精神、灵力、法器/剑灵共鸣、能力觉醒、关系变化、物品递送等没有明确生理或健康状态变化的内容返回空事件，不得用 `other_biological` 兜底。
- 在 AI 提示词和可验证的解析/运行时边界中落实该规则，避免只依赖 UI 或 Health UI 过滤。
- 保留合法的 physical symptom、medical event，以及明确生理/健康事实的 `other_biological`。
- 已保存的旧错误 Event 不在本子任务中直接改写；另行按 Floor-owned 数据生命周期规则决定重分析或失效策略。

## Acceptance Criteria

- [ ] 使用 `sword_resonance` fixture 时，不产生 BiologicalEvent、Health Assessment、Current Health issue 或 Event UI 记录。
- [ ] `other_biological + fracture + health_role=observation` 仍通过现有解析与健康资格测试。
- [ ] Prompt regression 明确禁止精神/灵力共鸣等非生理事实生成 Event。
- [ ] 不改变 Floor/Swipe ownership、Event provenance、合法 Event reconciliation 和 persistence contract。

## Key Decision

- 将 `other_biological` 收紧为明确的生理/健康事实 kind；未知 kind 不再作为自由兜底通过 AI Event parser。未来新增健康事实先补充明确 contract。

## Out of Scope

- 不批量重写历史 Floor 中已经保存的错误 Event；本任务只保证新分析结果不再产生这类 Event，并让 Health eligibility 对这类历史事实 fail closed。
- 不修改 Floor/Swipe ownership、provenance、reconciliation、persistence 和已有合法 Event 的身份规则。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
