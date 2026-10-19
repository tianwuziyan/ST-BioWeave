# 修正人物健康与事件展示链路

## Goal

修复健康浮层裁剪、非健康内容进入事件、健康 API 部位文本重复与 UI 部位语义不一致。

## Confirmed Facts

- 健康浮层主体当前为 `z-index: 7`，事件展开项为 `z-index: 3`；来源菜单位于滚动中的健康浮层内部，使用 `z-index: 2`，实机展开时会被父级 `overflow-y: auto` 裁剪。[style.css:7501-7544]
- 附件事件输出把剑灵/精神共鸣写成 `other_biological + fact.kind=sword_resonance + health_role=observation`，当前资格判断因此将其送入 Health Assessment；按用户确认，该内容不应生成任何 BiologicalEvent。[输出结果1-1.txt；输入文件2.txt]
- API 恢复指导层会把缺少 `body_site` 的内部 `general` 展示为“全身”，但 Character UI 读取 `body_site: null` 与 `display_site: general` 后显示“未标明部位”，两层展示语义不一致。[core/health-recovery-guidance.js:70-85；ui/characters.js:360-365]
- API Prompt 的“右右手食指”由恢复指导层无条件把 `laterality=right` 前置到已经包含方向的 factual `body_site=右手食指` 产生。[core/health-recovery-guidance.js:70-85]
- Floor/Swipe/Version ownership、Health Assessment persistence ownership 和既有 provenance 不属于本次修正范围。

## Requirements

- 健康浮层来源菜单在 Desktop、iPad、Mobile 都必须完整可见，且不破坏现有关闭、外侧点击、Escape 和 `data-bioweave-*` 事件契约。
- 与生理、身体状态或健康无关的叙事（至少包括本次 `sword_resonance` 示例）不得生成、保存、展示为 BiologicalEvent，也不得进入 Health Assessment；事件分析允许返回空 `events`。
- 合法的身体症状、骨折、伤口和医疗干预等既有 Event/Health contract 不得被误删。
- API Prompt 与 Character UI 必须使用一致的身体部位展示语义：方向只出现一次；API 已显示为“全身”的无部位健康问题，UI 也显示“全身”。原始 Event 的 `body_site` 不因展示修正被回写。
- 同步受影响的测试、业务 Markdown 和 UI 框架契约；不修改无关的 Persistence、Adapter、Generation boundary。

## Acceptance Criteria

- [ ] 来源菜单在真实宿主中不被健康浮层或滚动容器裁剪。
- [ ] `sword_resonance` 回归样例最终不产生 Event、Assessment、Current Health issue 或 Event 页记录。
- [ ] 合法 `other_biological` 健康观察（现有 fracture fixture）仍被接受并可进入健康链路。
- [ ] `body_site=右手食指 + laterality=right` 的 API Prompt 只显示“右手食指”。
- [ ] 缺少 `body_site` 且 API 展示为 `general` 的健康问题，Character UI 显示“全身”。
- [ ] 定向测试、静态检查和真实宿主 Desktop/Tablet/Mobile 验收结果可追溯。

## Child Tasks

- `10-19-character-health-popup-layer`：健康来源菜单层级与滚动边界。
- `10-19-event-non-health-boundary`：非健康叙事的 Event Analysis 边界。
- `10-19-health-display-contract-consistency`：API Prompt 与 Character UI 部位展示一致性。

## Key Decisions

- `other_biological` 收紧为明确属于生理/健康的事实；精神共鸣、灵力/能量反应、剑灵/法器效果、能力觉醒、关系变化、普通物品递送等内容直接返回空事件。未来新增的健康事实需要先补充明确的事实 kind contract，不能继续使用自由兜底。

## Out of Scope

- 不批量改写已经保存的历史错误 Event；用户需要在代码修正后重新分析对应 Floor，历史数据生命周期另行处理。
- 不修改 Floor/Swipe/Version ownership、Assessment persistence、Event provenance、Generation boundary、tracking 资格规则或 unrelated UI。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
