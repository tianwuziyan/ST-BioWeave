# 设计：统一 UI 框架迁移

## 目标与非目标

本任务只替换生产 UI 的视觉系统、控件结构和响应式布局，不重写领域逻辑。`ui/app.js` 继续作为唯一应用编排者，页面模块继续只接收现有 DTO 并返回 DOM/HTML 片段；Runtime、存储、AI、世界书和事件处理保持原实现。

不把静态参考页变成生产运行时，不复制其 mock 状态、假 API、设备切换器、业务推断或 `bw-*` 选择器。生产选择器统一使用 `bioweave-*`，并保留现有 `data-bioweave-*` hooks。

## 视觉源与优先级

视觉决策顺序为：

1. `docs/ui-framework.config.json`：机器可读的 token、组件、断点、hook 和同步顺序。
2. `docs/UI_FRAMEWORK.md`：人类可读的组件语义、层级、响应式和维护规则。
3. `docs/UI_FRAMEWORK_EXAMPLE.html`：结构、控件状态和可复用语法示例。
4. `docs/UI_FULL_REFERENCE.html`：八页面完整视觉验收基准。
5. 生产 `style.css` 与 `ui/*.js`：仅按以上来源落地，不新增未登记的视觉规则。

参考页使用紧凑的顶端 routebar，Desktop、iPad、Mobile 通过宽度适配显示同一组路由；生产实现用真实媒体查询实现该结果，不使用参考页的 `body[data-device]` 切换。若旧前端规范仍描述左侧栏或底部导航，须在同一配置同步批次中更新为当前统一框架，避免规范与实现冲突。

## 生产壳层映射

- 保留 `document.documentElement > #bioweave-overlay > #bioweave-panel` 的宿主边界、生命周期、焦点处理、关闭逻辑和 Runtime 订阅。
- 在 `ui/app.js` 内保留 `createApp(runtime)` 及现有公开方法和事件委托；只调整 header、routebar、main、移动适配和导航按钮的结构/类名。
- 路由仍由现有 `pages` 映射驱动，八个 route id 不变；导航标题、可见性和当前选中状态只由生产 `pages`/runtime 状态生成。
- 所有业务动作继续经过既有 `data-bioweave-action`、页面专用 hook 和当前事件委托，禁止在页面模块中新增第二套全局事件总线。
- 继续使用宿主 Popup/Toast（`notify`、`confirmWithPopup` 等现有入口），不加入原型中的自绘 modal、确认框或调试卡。

## 页面与控件映射

| 页面 | 生产模块 | 迁移重点 | 必须保留 |
| --- | --- | --- | --- |
| 总览 | `ui/overview.js` | 标题层级、统计/状态表格、动作按钮 | 分析状态 DTO、动作 hook |
| 人物 | `ui/characters.js` | 紧凑人物卡、能力/暴露状态 | 真实 tracking subject、三态语义 |
| 事件 | `ui/events.js` | 单行表格/事件卡、编辑删除状态 | event id/source 只读和现有事件操作 |
| 推演 | `ui/projection.js` | 空态/结果表面和操作层级 | 现有 DTO 与 route，不造预测数据 |
| 家系 | `ui/genealogy.js` | 空态/图谱表面和窄屏布局 | 现有页入口和保存边界 |
| 世界 | `ui/world.js` | 物种/生物类型卡、模块编辑卡、单编辑按钮 | 生产数据、独立保存/取消、null/未知 |
| 设置 | `ui/settings.js` | 多级折叠、来源树、选择器、regex 行 | 所有现有设置 hook、存储和 API 参数 |
| 状态 | `ui/state.js` | 状态表格、提示、滚动和移动适配 | 现有状态页语义 |

`ui/state.js`、`ui/projection.js`、`ui/genealogy.js` 即使内容简短也不删除；它们是正式 route 模块。页面视觉重排不能改变其调用方签名。

## 世界模型编辑设计

世界页只负责展示生产世界模型并调用现有编辑回调。物种卡、生物类型卡和人物/类型模块卡使用统一 surface/card token；每个模块渲染一个编辑入口，进入该模块的局部编辑态后只显示该模块的保存与取消。保存继续调用已有 handler 和 DTO，不引入全局 `editing` 状态，不在前端推断能力或替换 null。

## 设置与正则设计

世界书来源采用上级 details/折叠栏包裹一级分支，一级下继续渲染子级分支和 checkbox；父级选中、未选中、半选由现有状态计算驱动，原生 checkbox 状态与 click 目标区域保持一致。API 来源和模型保持原下拉框及参数。

全局正则和角色卡正则复用相同紧凑 row 结构：左侧短标签列，中间名称/状态内容，右侧上下移动按钮组成零间隙的垂直 control rail；rail 顶/底与正则 row 对齐，窄屏时 row 内部可收缩但页面不横向溢出。新增、删除、启停、上移、下移均继续走现有 hooks。

## 响应式策略

- Desktop（`min-width: 1200px`）：参考页宽高和 routebar 视觉，主内容内部滚动。
- iPad（`768px–1199px`）：同一顶端 routebar 与更紧凑的 panel/content 间距，控件和卡片可在两列/单列之间切换。
- Mobile（`max-width: 767px`）：顶端标题与路由平铺为紧凑多行网格，卡片/表格单列，设置展开后所有子内容 `min-width: 0`，避免右侧下拉框撑宽父级；页面级 `overflow-x` 隐藏，必要的局部长内容只允许在明确的局部容器处理。
- 断点、尺寸、间距、safe-area、scroll 和 focus 规则必须先登记到 config/docs/example，再进入 CSS。

## 兼容与清理

迁移过程中先保留最小可运行结构和现有 hooks，按页面替换视觉；每个批次运行针对性测试。全部验收通过后，删除旧模板、旧类名、旧 CSS 和临时兼容渲染；不删除 `ui/*.js`，不修改受保护目录。若需要调整前端规范描述，也要与配置和示例同批次更新。
