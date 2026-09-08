# World UI v2 模块化编辑

## Goal

按 `docs/references/BioWeave_World_UI_开发规范_v2.md` 重构世界模型页面，让用户能够按“物种 → biological type → 单类型详情 → 世界级规则”浏览内容，并只编辑当前需要修改的一个模块。

视觉结构以 `docs/references/BioWeave_World_UI_reference_v3.html` 为主要实现基准，v2 规范继续作为行为、数据边界和响应式验收约束；`BioWeave_World_UI_reference_v2.png` 用于视觉比例核对。

## Confirmed scope

- 本轮只改 World Model UI 与其测试，不改变 World Model 业务逻辑。
- 顶部保留重新分析、查看本次输入等既有功能，但删除整份 World Model 的全局编辑入口。
- 七个模块各自拥有编辑、取消、保存：生殖能力、生殖规则、生命周期、特殊规则、医疗与照护、特殊例外、尚未确定。
- 默认同一时间只允许一个模块编辑；切换模块或 biological type 时不得静默丢弃未保存 draft。
- species 与 `species[].biological_types[]` 完全动态渲染，不能用男性/女性/双性固定列表过滤；合法的双性、Alpha、Beta、Omega 等必须显示。
- `true / false / null` 在用户界面严格显示为“是 / 否 / 未知”，编辑控件使用中文三态选项。
- 所有本轮新增或修改的用户可见 World UI 文案使用中文；复用现有主题 token 和 UI Host。
- Desktop、Tablet、Mobile 功能等价，不新增 UI 框架、重型依赖或复杂 Controller / Service / Factory 层。
- 不新增生产文件，除非实现过程中证明现有 `ui/world.js` 无法合理承载；当前计划不新增文件。

## Data and business boundaries

- 不修改 `storage/schema.js`、World Model schema、Prompt、Analyzer、AnalysisInput、API / Secret、Chat-local storage、Worldbook、最近剧情、外部记忆、UI Host 或主题基础。
- 模块保存只能替换当前 section，其他 species、biological type 和 World Model section 必须保持不变。
- `last_saved_at` / `last_saved_by` 只有在当前现有模型元数据已经支持时才沿用；本轮不得新增字段或扩展 schema。若现有结构不支持，则不添加。
- 保存失败必须保留旧 World Model、当前模块 draft 和编辑状态；取消不得修改已保存模型。

## Acceptance criteria

- [ ] 页面不存在“编辑整个世界模型”主入口，也不存在整页保存按钮。
- [ ] 七个模块各有独立的“编辑”按钮，并可独立“取消 / 保存”。
- [ ] 编辑一个模块不会让其他模块进入编辑状态。
- [ ] 当前 biological type 详情只展示一个 type；切换 type 只更新展示，不重新分析或重新加载整个模型。
- [ ] species、biological type 和空 biological type 状态均能动态渲染。
- [ ] `true / false / null` 显示为“是 / 否 / 未知”，不把原始英文状态暴露给用户。
- [ ] 模块保存后只有目标 section 变化；保存失败和取消均保留原模型。
- [ ] 特殊规则、特殊例外、尚未确定支持修改、删除和添加。
- [ ] PC（≥1200px）、Tablet（768–1199px）、Mobile（<768px）均可完成相同功能，且无普通横向溢出。
- [ ] 日、夜、跟随酒馆主题继续可用。
- [ ] World Model 业务层文件与 schema 无 diff。
- [ ] World UI 专项测试、全量测试、语法检查和 `git diff --check` 通过。

## Out of scope

- 不实现 species / biological type 名称和描述的基本信息编辑、增删入口，除非现有 UI 实现证明没有合理替代方案。
- 不修改 World Model 语义校验、AI evidence guard、Prompt 或 API 请求流程。
- 不开发 Biological Event、State、Snapshot、Projection、Genealogy 或 Context Injection。
- 不新增 logo、品牌图形或模块级装饰图标；保留现有 UI Host 品牌与导航。

## Open questions

None. 用户已批准规划并明确 schema 与任务边界。
