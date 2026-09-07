# World Model v1

## Goal

从已验收的 AnalysisInput 生成、校验、保存和管理当前 Chat 的生物学 World Model v1，不进入事件、状态、快照、推演或 Context 注入。

## Requirements

- 复用当前 Chat 的临时 AnalysisInput，生成只描述生物学世界规则的 World Model v1。
- World Model 使用固定、轻量 schema：生物类型、capability、生殖规则、妊娠/孕育规则、周期、成熟/衰老、特殊规则、明确例外和未知信息；未知值允许 `null`，不得硬编码人类或性别二元规则。
- 使用 World Analysis 任务分配调用现有 API Profile / SillyTavern 当前 API；AI 只接收最小 World Analysis Prompt 和 AnalysisInput，不进入 Event、Floor、State、Snapshot、Projection 或 Context。
- AI 返回内容必须先解析和校验为固定 schema；请求失败、JSON 无效或 schema 无效时显示中文错误，并保留上一份成功 World Model。
- 成功分析保存到当前 Chat 的 `chat_metadata.bioweave.world_model`，分析时间和来源摘要保存为不含正文的 Chat-local 元数据。
- 世界模型页面支持查看当前模型、最后分析时间、来源摘要、重新分析、结构化编辑保存，以及临时查看本次分析输入。
- 手动编辑保存后成为当前 Chat 的权威 World Model；编辑失败不覆盖旧模型。
- 所有用户可见页面文案、状态、错误、空值显示使用中文；`unknown` / `null` / `undefined` 在 UI 中统一显示“未知”。
- 不新增第二套来源读取器或预览器；保留已验收的入口、来源选择、AnalysisInput、预览、API/Secret 和主题实现。

## Acceptance Criteria

- [ ] `AnalysisInput → World Model Prompt → AI 请求 → JSON 校验` 链路可运行。
- [ ] capability 使用布尔值或 `null`，不根据 gender 推断能力。
- [ ] 成功结果与分析元数据 Chat-local 保存；失败/无效结果不覆盖旧成功结果。
- [ ] 世界模型页面可查看、重新分析、编辑并保存。
- [ ] 页面可临时查看本次分析输入，且不持久化正文或 Secret。
- [ ] 中文 UI 不直接显示 `unknown`、`null`、`undefined`、`N/A`。
- [ ] 现有测试、World Model 回归测试和 `npm run check` 全部通过。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
