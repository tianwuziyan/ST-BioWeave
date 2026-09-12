# 实施计划：统一 UI 框架迁移

## 阶段 0：审计基线

- [x] 记录工作树、当前分支、现有 UI 相关 diff 和受保护文件状态。
- [x] 核对 `ui/app.js` 的 `createApp`、overlay lifecycle、route map、事件委托、Runtime refresh 和所有 `data-bioweave-*` hooks。
- [x] 核对 `ui/overview.js`、`characters.js`、`events.js`、`projection.js`、`genealogy.js`、`world.js`、`settings.js`、`state.js` 的调用签名和真实 DTO。
- [x] 核对 Runtime DTO、API 参数、存储键、世界书/正则/事件分析/世界模型/Chat 保存调用方与被调用方。
- [x] 核对 `tests/ui.test.js`、`tests/phase2a-ui.test.js` 的 shell、route、控件、保存和数据真实性断言；必要时只更新与新 shell 结构对应的测试夹具。
- [x] 建立生产旧类名/模板/兼容渲染清单，作为最终清理验收依据。

## 阶段 1：配置与规范先行

- [x] 按配置同步顺序更新 `docs/ui-framework.config.json`。
- [x] 更新 `docs/UI_FRAMEWORK.md`，明确顶端 routebar、八页面、控件状态、世界/设置/正则和三端规则。
- [x] 更新 `docs/UI_FRAMEWORK_EXAMPLE.html`，使示例与生产 `bioweave-*` 语义、正则 rail、来源树和响应式结构一致；示例不得包含业务 mock。
- [x] 复核 `docs/UI_FULL_REFERENCE.html`；完整视觉基准已包含目标顶部路由和三端网格，因此保留为静态参考，不把其 mock 运行逻辑复制到生产。
- [x] 若 Trellis 前端规范仍与统一框架冲突，同步更新 `.trellis/spec/frontend/component-guidelines.md` 和相关质量规则。

## 阶段 2：生产壳层与样式

- [x] 在不改变 `createApp`/生命周期/事件语义的前提下，将 `ui/app.js` 的 shell 视觉结构映射到参考页 header、routebar、main 和状态层。
- [x] 按 token 和断点重构 `style.css` 中旧壳层、导航、页面 surface、控件、移动端规则；显式保留 overlay z-index、宿主边界、safe-area、滚动和 focus。
- [x] 让所有新增或重命名的 production class/hook 先在 config/docs/example 登记，并删除冲突的旧样式选择器。

## 阶段 3：逐页迁移

- [x] 总览：对齐标题、状态/统计表格、按钮状态和紧凑间距。
- [x] 人物：对齐人物卡、状态标记和三端单/多列布局，保持真实 tracking 数据。
- [x] 事件：对齐事件表/卡和编辑删除控件，保持 event id/source 语义。
- [x] 推演、家系、状态：对齐空态/内容表面和 route 状态，不添加假结果。
- [x] 世界：对齐物种/类型/人物模块卡；每个模块一个编辑按钮，独立保存/取消，保留 null/未知与生产能力语义。
- [x] 设置：对齐多级来源折叠、父子半选、下拉框/checkbox/switch、最近剧情、正则、外部记忆、提示词和调试入口；正则 rail 垂直紧邻并与 row 对齐。

## 阶段 4：测试与兼容清理

- [x] 更新 Fake DOM/测试夹具仅以适配新 shell 选择器，保留行为断言和 hook 断言。
- [x] 运行 `npm run check`。
- [x] 运行相关 `node --check ui/*.js`（按仓库脚本实际范围执行）。
- [x] 运行 `git diff --check`。
- [x] 检索旧模板、旧类名、旧 CSS 和兼容渲染；确认无两套 UI 并行。
- [x] 不修改 `index.js`、`manifest.json`、`settings.html`、`ai/`、`core/`、`runtime/`、`storage/`、`context/`、`story/`。

## 阶段 5：真实三端验收

- [ ] Desktop：1200×800，验证八个 route、主内容滚动、按钮状态、折叠栏、下拉框、checkbox、switch、世界编辑和正则移动。
- [ ] iPad：1024×800，验证 routebar、卡片/表格收缩、设置展开和控件对齐。
- [ ] Mobile：390×844，验证标题/路由平铺、页面无横向滚动、设置展开不被右侧选择器撑坏、正则 rail 和世界卡片。
- [ ] 记录宿主/SillyTavern 实际运行结果；静态测试通过不等同于宿主验收。

> 当前工作环境没有可连接的浏览器或 SillyTavern 宿主页面，因此这里保留为人工验收项；已完成静态 CSS/DOM 断言和三端媒体规则审计，未将其冒充为真实端到端通过。

## 完成边界

- [ ] 只报告和交付工作树修改，不提交 Git、不推送远程。
- [ ] 最终报告列出修改文件、接口/事件/存储保留、配置文档同步、旧 UI 删除、自动化和三端验证、人工待验项。
