# Analysis input collector and preview

## Goal

Build a temporary BioWeave AnalysisInput collector and lightweight settings preview for selected character card fields, worldbook entries, recent story, and detected external memory without AI, World Model, or context injection.

## Requirements

- 新增临时 `AnalysisInput` 收集器，复用现有角色卡、世界书、Chat-local 最近剧情和外部来源读取结果。
- 只收集当前勾选的角色卡字段、开场白、世界书条目；未勾选内容不得进入预览。
- 最近剧情按当前 Chat 的设置读取最近 N 楼，并显示真实 Floor 范围和可展开正文。
- 外部记忆显示 Anima、柏宝书、数据库记忆的启用状态、公开接口状态和本次实际读取结果；不再读取构画故事时间，未实现的来源不得伪造正文。
- 预览每次打开或点击刷新时临时生成，不写入 `chat_metadata`、`message.extra` 或其它持久化结构。
- 设置页提供“结构预览”和“原始内容”两种查看方式；原始内容为安全的结构化 JSON 等价文本。
- 预览不得包含 API Key、Secret、Profile 配置或其它敏感字段。
- 只允许轻量实现：不调用 AI、不进入 World Model、不接入 `context/builder.js`、不新增 tokenizer 依赖。

## Acceptance Criteria

- [ ] `ai/input-builder.js` 能由现有 sources、selected 和 Chat-local 设置生成临时 AnalysisInput。
- [ ] 角色卡预览只显示已选角色描述、主开场白和备用开场白。
- [ ] 世界书预览按书分组且只显示已选 entry 的稳定 ID、名称和正文。
- [ ] 最近剧情预览显示启用状态、读取楼数、Floor 起止和实际文本。
- [ ] 外部记忆预览分别显示三个来源的状态；成功来源才显示实际内容，未知来源显示未检测到或未实现。
- [ ] 结构预览和原始内容可切换，内容区支持折叠，移动端不横向溢出。
- [ ] token estimate 与 AnalysisInput 同步生成，且无需外部 tokenizer。
- [ ] 预览不触发 AI 请求，不写入 Chat 数据，不暴露 Secret。
- [ ] 现有 `npm test` 和 `npm run check` 全部通过，并有收集器/预览渲染回归测试。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
