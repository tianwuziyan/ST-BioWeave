# Technical design

## Boundary

原型阶段只新增一个可直接打开的静态 HTML 文件，放在本任务目录内。HTML 自带 CSS 和少量 JavaScript，不导入生产模块、不读取仓库运行时数据，也不写 Chat/Floor/Storage。

生产接入阶段沿用原型的详情内增量结构，但由现有生产边界负责数据流：

```text
Projection Views（当前合法 Floor endpoint）
  → runtime/projection-runtime.js 安全 storyline_snapshots DTO
  → runtime/events.js / ui/app.js 业务状态转发
  → ui/projection.js 当前人物详情的增量区块
  → style.css 生产命名空间样式
```

生产 UI 不读取 Storage/Floor，不重新判定支线状态，也不展示内部 ID；既有生理观察区块保持原样。

## Visual structure

```text
BioWeave shell
├─ 页面标题：人物推演 / 生成状态
├─ 人物选择栏
├─ 人物详情
│  ├─ 生产 projection 基线：观察说明 / 当前阶段 / 候选摘要 / 结算时间
│  ├─ 现在可能出现 / 已触发 / 之后可能出现 / 最后怎么结束
│  ├─ 候选剧情支线（candidates，增量插入）
│  │  └─ 3 张路线卡 → 节点预览 → 结论目标
│  ├─ 已选支线（selected）
│  │  └─ 单条路线 + 节点时间线 + 当前目标
│  └─ 观察信号 / 结论边界 / 生产脚注
└─ 原型状态切换栏（只用于演示）
```

生产 `ui/projection.js` 的 `projectionPage()`、`detail()` 和 `personCard()` 展示内容是不可删除基线。本原型中的非生理剧情支线只作为详情内的增量区块插入，不能替换或隐藏观察阶段、已触发生理信号、结算摘要、结束方式和脚注；`selected`、`running`、`terminated` 只改变新增剧情支线区块的展示状态。

候选路线使用轻量的“路线卡 + 节点数量”结构；已选路线使用一条纵向节点线，避免把三个候选误读为同时推进。页面底部提供状态切换，仅为原型控制，不伪装成生产操作。

## State model

内存状态仅包含 `viewMode`（`candidates`、`selected`、`running`、`terminated`）。已选状态用第一条示例路线代表单线推进，不提供候选卡片的逐条选线交互，避免把原型操作误读为每楼换线；生产接入时由 Runtime / 正文 API 提供真正的已选支线。示例数据直接映射 API 约定中的 `title`、`premise`、`nodes`、`conclusion_goal`；不把内部 ID 放入可见文案。

## Responsive behavior

- 继承现有 960px 面板、深蓝灰 token、页面标题和 routebar 节奏。
- Desktop / tablet 使用人物选择区 + 详情双栏；详情中的路线卡最多三列。
- Mobile 将人物选择区压缩为两列卡片，详情和路线节点变成单列。
- 所有文字和卡片允许自然换行，禁止页面级横向滚动。

## Compatibility / rollback

原型仍可单独删除而不影响生产代码；生产接入的回滚点是移除 `storyline_snapshots` 的 DTO 转发、详情增量调用和对应样式/测试，不触碰 Storyline 持久化数据。
