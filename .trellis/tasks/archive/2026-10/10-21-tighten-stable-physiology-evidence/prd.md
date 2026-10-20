# 修正 Persona 稳定生理证据误判

## Goal

仅修复普通生理反应因包含“生理”字样而被误判为稳定人物生理证据的问题；不修改 Persona 身份绑定、能力显示或合并逻辑。

## Requirements

- Persona 或 Character Card 中仅表示短暂、普通身体反应的文字，不得因为包含“生理”字样就进入 `stable_physiology`。
- `眼角沁出生理性的泪水。` 必须被排除出 Character Evidence。
- 已有明确稳定生理含义的文本仍应继续进入 Character Evidence，不能整体移除 `stable_physiology` 支持。
- 本任务不修改 Persona 的 canonical character_id 绑定、生殖能力显示、同名证据合并或任何持久化逻辑。

## Acceptance Criteria

- [ ] 回归测试能在修改前复现“生理性的泪水”被错误投影的问题。
- [ ] 修改后该句不产生 Persona `individual_evidence`。
- [ ] 明确描述稳定生理或身体结构的文本仍能产生 `stable_physiology`。
- [ ] Event Analysis / Context Prompt 相关测试通过。
- [ ] 本次修改不新增持久化字段，不改变 Floor、Registry、Tracking 或 UI 数据所有权。

## Notes

- 这是 PRD-only 的轻量任务；实现应限制在 Character Evidence 分类及其回归测试。
