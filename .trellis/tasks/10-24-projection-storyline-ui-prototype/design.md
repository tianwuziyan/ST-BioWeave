# Technical design

## Boundary

原型只新增一个可直接打开的静态 HTML 文件，放在本任务目录内。HTML 自带 CSS 和少量 JavaScript，不导入生产模块、不读取仓库运行时数据，也不写 Chat/Floor/Storage。

## Visual structure

```text
BioWeave shell
├─ 页面标题：人物推演 / 生成状态
├─ 人物选择栏
├─ 人物详情
│  ├─ 当前观察摘要
│  ├─ 候选剧情支线（candidates）
│  │  └─ 3 张路线卡 → 节点预览 → 结论目标
│  ├─ 已选支线（selected）
│  │  └─ 单条路线 + 节点时间线 + 当前目标
│  └─ 观察信号 / 结论边界
└─ 原型状态切换栏（只用于演示）
```

候选路线使用轻量的“路线卡 + 节点数量”结构；已选路线使用一条纵向节点线，避免把三个候选误读为同时推进。页面底部提供状态切换，仅为原型控制，不伪装成生产操作。

## State model

内存状态仅包含 `viewMode`（`candidates`、`selected`、`running`、`terminated`）和 `selectedBranchIndex`。示例数据直接映射 API 约定中的 `title`、`premise`、`nodes`、`conclusion_goal`；不把内部 ID 放入可见文案。

## Responsive behavior

- 继承现有 960px 面板、深蓝灰 token、页面标题和 routebar 节奏。
- Desktop / tablet 使用人物选择区 + 详情双栏；详情中的路线卡最多三列。
- Mobile 将人物选择区压缩为两列卡片，详情和路线节点变成单列。
- 所有文字和卡片允许自然换行，禁止页面级横向滚动。

## Compatibility / rollback

原型与生产模块完全隔离。删除本任务目录即可回滚，不会改变 `ui/`、`style.css`、Runtime 或业务数据。
