# BioWeave v0.2.2-dev

BioWeave 是一个轻量、世界观自适应的 SillyTavern 生理状态追踪与推演扩展。

这一版采用“**一个明显职责一个文件**”的中等粒度结构：不采用几十个 Store/Validator/Interface 小文件，也不把 AI、UI、Runtime 全塞进单文件。

## 开发入口

1. VS Code 打开本目录。
2. `npm run check`。
3. 阅读 `docs/DEVELOPMENT.md`、`docs/DATA-MODEL.md`、`docs/UI.md`。
4. 基础 Runtime 与 UI Foundation 已完成真实设备验收；当前按 `API Profile + Secret → Event/State/Snapshot → Worldbook/World Model → Analyzer/Projection` 继续实现。

## 核心约束

- 动态数据只属于当前 Chat Instance，namespace 固定 `bioweave`。
- Floor Version 由 chat/message/swipe/content hash 共同标识。
- Event 是历史事实；State 是计算结果；Snapshot 是检查点；Projection 是非事实软推演。
- 成功分析的同一 Floor Version 不自动重复分析；失败可重试；手动刷新可覆盖，刷新失败保留旧成功结果。
- 世界规则是 baseline，不硬编码物种、性别或现实世界生殖规则。

## UI 设计基准

BioWeave 的 UI 开发以 `docs/references/` 中的 v2.0 完整设计文档与响应式参考图为正式视觉/交互基准：

- `BioWeave_UI_v2.0_design.md`
- `BioWeave_UI_v2.0_reference.jpeg`

实现 UI 时应优先遵循该设计基准，包括多人总览、人物详情二级页面、PC/iPad/手机响应式布局、无头像、低视觉噪音，以及日 / 夜 / 跟随酒馆三种主题模式。
