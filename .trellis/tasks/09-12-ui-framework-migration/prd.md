# 完整替换生产 UI 到统一框架

## Goal

将 BioWeave 现有八页面生产 UI 的视觉和控件结构迁移到项目内统一 UI 框架，同时保持 Runtime、接口、数据模型、存储和现有交互契约不变，并同步维护 UI 配置、规范与参考示例。

## Requirements

- 以 `docs/UI_FULL_REFERENCE.html` 的八页面视觉结果为目标，以 `docs/UI_FRAMEWORK_EXAMPLE.html` 的控件结构和语法为示例，以 `docs/ui-framework.config.json` 为字体、颜色、尺寸、间距、圆角、按钮、控件和断点的唯一配置来源。
- 保留现有生产行为：不修改函数签名、Runtime 调用参数、API 配置格式、数据结构、存储键、`data-bioweave-*` 事件语义、世界书、正则、事件分析、世界模型和 Chat 保存逻辑。
- 在迁移前核对调用方/被调用方、Runtime DTO、事件钩子、测试断言、存储键、API 参数和现有生产 UI；不得从静态 HTML 推断业务接口。
- 覆盖总览、人物、事件、推演、家系、世界、设置和状态八个生产页面，并保留真实生产数据；不得复制参考页的 mock 数据、假事件或假 API。
- 保留并视觉统一所有控件：标题与层级、表格、卡片、按钮状态、下拉框、折叠栏、父/子/半选 checkbox、switch、世界物种/生物类型卡、模块编辑卡、正则行和紧邻的上下移动按钮。
- 世界模型使用生产物种和生物类型数据；人物卡与类型卡采用卡片布局；每个模块只有一个编辑按钮、独立保存/取消；不增加全局编辑模式、不从名称/性别/代词/外貌推断能力，并保留 `null`/未知语义。
- 设置页面完整保留多级世界书来源树、父子及半选状态、API 来源/模型下拉框、最近剧情、全局和当前角色卡正则、正则增删启停移动、外部记忆、世界分析提示词及调试预览。
- 每次 UI 调整严格按“配置 → 规范文档 → HTML 示例 → 完整视觉参考（如适用）→ 生产 UI”顺序同步；新增控件、字段、类名、颜色、字号、间距、断点和交互必须登记。
- Desktop、iPad、Mobile 使用真实 CSS 响应式布局；移动端不得出现页面级横向滚动，设置展开后不得被右侧控件撑坏，移动端标题/路由栏和选择页面必须保持参考页的紧凑层级。
- 保持现有文档级 Overlay 生命周期和宿主 Popup/Toast 约束；生产代码使用 `bioweave-*` 命名，不复制参考页的 `bw-*` 类名或设备切换脚本。
- 只允许修改 UI 文件、UI 配置/规范/示例/参考文档、对应 UI 测试与必要的前端规范同步；`index.js`、`manifest.json`、`settings.html`、`ai/`、`core/`、`runtime/`、`storage/`、`context/`、`story/` 不得改动。

## Acceptance Criteria

- [ ] 只读审计结论已落在设计/实施文档中，明确函数、Runtime、事件、存储、API 和测试边界。
- [ ] 配置、`UI_FRAMEWORK.md`、`UI_FRAMEWORK_EXAMPLE.html`、`UI_FULL_REFERENCE.html`（如视觉规则变化）和生产 UI 同步，且不存在只在 CSS 中登记的新增控件或视觉 token。
- [ ] 八个页面都由现有生产页面模块渲染，所有原有业务事件和保存路径继续工作，无 mock/fake 业务数据进入生产。
- [ ] 三端视觉与参考页逐项核对：字体、颜色、尺寸、圆角、间距、按钮状态、表格/卡片/表单控件、折叠栏、checkbox/switch 和响应式布局一致。
- [ ] 世界模型满足真实数据、卡片布局、单模块编辑、独立保存/取消、null/未知语义和能力不推断约束。
- [ ] 设置页满足多级折叠/父子半选、API 与模型选择、正则完整操作、外部记忆、提示词和调试预览约束；正则上下按钮垂直紧邻且与正则行上下边界对齐。
- [ ] 生产 UI 不再保留旧模板、旧类名、旧 CSS 或临时兼容渲染；`ui/*.js` 作为正式模块保留。
- [ ] `npm run check`、`git diff --check`、相关 `node --check` 通过；测试覆盖现有交互契约。
- [ ] 在 1200×800、1024×800、390×844 下完成真实浏览器/宿主验证，并记录折叠栏、下拉框、checkbox、switch、正则按钮、世界模型编辑和滚动结果。
- [ ] 未提交 Git、未推送远程；最终报告列出修改文件、接口/钩子保留情况、旧 UI 删除项、三端和自动化验证结果及人工待验项。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
