# World UI v3 Reference 对齐与顶部信息降噪

## Goal

严格按 BioWeave World UI reference v3 HTML 对齐 World UI 的字体、控件、卡片、间距与 Desktop/Tablet/Mobile 布局，并精简顶部 metadata 展示；不修改 World Model 业务逻辑、schema 或分析链路。

## Requirements

- `docs/references/BioWeave_World_UI_reference_v3.html` 是主要视觉与布局基准；直接采用其 CSS 数值，允许只做 `bioweave-*` 命名和 SillyTavern theme token 适配。
- World UI 控件在 `.bioweave-world-model-page` 范围内明确 reset 必要的 `font-size`、`font-weight`、`line-height`、`letter-spacing`、`border`、`background`、`border-radius`、`padding`、`min-height` 与 `cursor`，避免 SillyTavern/旧 BioWeave CSS 污染。
- 对齐 reference 的 top、section title、species card、biological type pill、workspace、frame、module header、key/value row、editor、按钮和 hover/active 状态。
- 保持 reference 的响应式数值和结构：Desktop 四列物种卡片与 `2fr / 1fr` 工作区；Tablet 两列物种卡片、单列工作区、三列世界级规则；Mobile 横向物种卡片、单列模块、单列世界级规则、单列 key/value/editor 字段。
- 顶部默认只显示短摘要：最后分析时间（到分钟）与实际参与分析的来源；不显示最后保存、保存者、条目数、未启用外部记忆、token estimate 或状态冗余信息。
- 来源摘要只根据已参与本次分析的 meta 展示：实际读取角色卡才显示“角色卡”，世界书只显示“X 本世界书”，实际读取最近剧情显示楼层数量或范围，外部记忆只显示启用且成功读取的 provider。
- token estimate、世界书 entry count、外部来源详细状态、last_saved_at、last_saved_by 等内部 meta 继续保留，不从数据层删除；必要详情继续由“查看本次输入”承载。
- 保持现有七个模块独立编辑、单模块 draft/save/cancel、动态 biological type、中文 true/false/null 显示、主题跟随和 UI Host 行为不变。

## Acceptance Criteria

- [ ] World UI 的字体、字重、行高、按钮高度/圆角/padding、卡片尺寸/padding/圆角、边框、gap 和 selected/hover 状态均可在 CSS 中对应到 v3 reference 数值；没有依赖未 reset 的宿主默认控件样式。
- [ ] Desktop / Tablet / Mobile 的 World UI 结构与 v3 reference 对齐，且功能等价、无普通横向溢出。
- [ ] 顶部只呈现短的最后分析时间和实际来源摘要，不出现最后保存、AI 分析、未启用外部来源、entry count 或 token estimate。
- [ ] `character_fields === 0` 不显示“角色卡”；`worldbooks > 0` 只显示世界书数量；最近剧情和外部记忆只显示实际参与的来源。
- [ ] 内部 `world_model_meta` 原值仍可用于保存/调试，World Model schema、Prompt、Analyzer、AnalysisInput、API、Chat 保存和分析逻辑无 diff。
- [ ] 现有 World UI 模块编辑、动态类型、三态显示相关测试继续通过，并新增顶部摘要和 reference CSS/结构回归断言。
- [ ] 完成真实 SillyTavern Desktop、Tablet、Mobile 对照验收后停下，不继续扩展后续模块。

## Out of Scope

- 不修改 World Model schema、Prompt、Analyzer、AnalysisInput、API / Secret、Chat 保存、世界书来源、外部记忆读取、重新分析逻辑或模块级编辑逻辑。
- 不删除或重命名内部 Analysis Meta 字段，不迁移已有 Chat 数据。
- 不修改 SillyTavern 全局 CSS、主题基础、UI Host、其他 BioWeave 页面或新增 UI 框架/依赖/生产文件。
- 不把 reference HTML 的 mock 数据复制到真实业务层。

## Confirmed Technical Findings

- 当前 reference HTML 的关键数值包括：body `14px/1.5`；top 标题 `23px`；按钮默认 `min-height:38px; padding:8px 12px; border-radius:7px`；small 按钮 `min-height:31px; padding:5px 9px; font-size:12px`；species card `min-height:150px; padding:13px; border-radius:10px`；workspace `2fr / 1fr; gap:12px`；module header `min-height:43px; padding:8px 10px`；key/value row `padding:7px 9px`；editor `padding:10px; gap:8px`。
- 当前 `ui/world.js` 的 `renderSourceSummary` 会把角色字段、世界书条目、外部未启用状态、token estimate 和最近剧情配置一起拼接，`worldPage` 还渲染最后保存 metadata；本轮只压缩渲染，不改变 meta 生产。
- 当前 v2 任务已归档；本任务只处理真实验收反馈产生的 UI 对齐与顶部降噪。

## Open Questions

None. 用户已明确 reference 优先、范围只限 World UI 样式与默认 metadata 展示，并授权建立本独立任务。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
