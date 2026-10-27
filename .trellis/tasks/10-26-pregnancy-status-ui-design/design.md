# 技术设计：怀孕状态多页面 UI 原型

## 1. 设计目标

在现有 BioWeave shell 内，为总览、人物、推演三页加入“妊娠状态 + 知情边界”的增量展示。原型只读，不连接 Runtime、Floor、API 或真实事件数据。不得另起独立外壳；以生产 `ui/app.js` 的 shell 与八路由、生产页面 renderer 和 `style.css` 为唯一实现基准。`docs/UI_FULL_REFERENCE.html`、`docs/index.html` 和其它参考 HTML 只用于对照，不作为生产 UI 基础。

## 2. 现有 UI 约束

- Shell：复用生产 `ui/app.js` 的 `.bioweave-overlay`、`.bioweave-panel`、`.bioweave-app-header`、`.bioweave-routebar`、`.bioweave-main` 及八个生产路由按钮；样式直接加载生产 `style.css`。
- 总览：统计条 + 两列 overview grid；卡片间距约 `8–10px`，摘要数字优先。
- 人物：`220px minmax(0, 1fr)` 列表/详情工作区，详情连续纵向区块，不新增详情 Tab。
- 推演：`250px minmax(0, 1fr)` 人物/时间线工作区，已有“当前可能出现 / 候选支线 / 已触发 / 之后可能出现 / 最后怎么结束”层级。
- 颜色：`good` = 已确认，`warn` = 疑似 / 观察，`muted` = 未知 / 无结论，`accent` = 当前焦点或普通信息。
- 断点：Desktop `>=1200px`、Tablet `768–1199px`、Mobile `<768px`；Mobile 不允许页面级横向滚动。

## 3. 页面职责与增量放置

- 总览：完全沿用现有统计条和两列卡片，本原型不新增妊娠状态摘要或知情人数模块。
- 人物：沿用现有 `220px + 详情` 工作区。详情头部操作区只保留生产 UI 原有的健康、推演周期和编辑昵称，不重复放置妊娠标识；`.bioweave-character-state` 的“当前状态”保留“生殖暴露”“受孕事实”和“妊娠状态”三个格。受孕事实格用普通文字显示是否确认，不加状态徽标或外框；已确认人物在格右上角以带生产按钮边框的 `.bioweave-button` 显示“知情名单”，点击打开轻量只读弹层查看该人物独立名单；疑似或未知状态不提供知情名单入口。妊娠状态格在已确认时显示孕周（如“孕 8 周”），疑似或未知时显示观察中/暂无结论，不伪造周数，也不增加第二个入口。
- 推演：沿用现有 `250px + 时间线详情` 工作区，复用 `.bioweave-projection-detail-meta` 的第一个“观察中”徽标作为状态入口；疑似/未知保持观察状态，已确认时将该徽标改为“已确认怀孕”按钮并复用知情人弹层，不新增妊娠栏目。
- 所有页面都明确显示“其他人物默认不知道”；疑似或未确认状态不建立知情名单。

## 4. 演示数据边界

- 原型使用固定、明确标注的演示 DTO：柳如烟（疑似，不建立知情名单）、祁鸢（已确认，柳如烟与觉心知情）、孙大壮（未知）。
- 演示数据只在 HTML 内存中使用，不写入 Chat、Floor、Runtime cache 或 Debug。
- 多个妊娠人物始终分组显示：`怀孕人物 → 已知情人物 → 其他人物默认不知道`。

## 5. 原型交互

- 顶部 routebar 切换总览 / 人物 / 推演；其余导航保留为占位，不改变现有页面结构。
- 已确认人物可展开/收起“认知边界”弹层；弹层使用 `role="dialog"`、稳定的 `aria-controls` / `aria-labelledby`，支持点击弹层外部、关闭按钮和 Escape 关闭，且不会跨路由、方案或终点残留。推演页可在疑似、已确认和未确认结束三种状态间切换演示，验证文案长度和布局。
- 主题切换沿用现有 tavern / light / dark token；不新增生产主题或持久化。

## 6. 兼容与回滚

- `ui/app.js`、`ui/overview.js`、`ui/characters.js`、`ui/projection.js`、`style.css`、`docs/UI_FULL_REFERENCE.html`、`docs/index.html` 及其它参考 HTML 均只读保留；本任务使用 `pregnancy-status-ui-addition-real-ui.html` 直接调用生产 renderer，并提供无 ES Module 依赖的 `pregnancy-status-ui-addition-real-ui-standalone.html` 作为直接打开版，不复制旧的否决原型到参考页。
- 用户确认最终展示位置后，另开生产 UI 实施任务；实施时重新消费 Runtime DTO，不复制原型演示数据。
