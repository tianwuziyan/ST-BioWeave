# 技术设计

## UI 结构

- 在 `renderSettingsSummary` 增加受控第三参数，仅世界分析提示词 disclosure 使用；按钮位于 summary copy 与箭头之间。
- `settingsPage` 不再输出独立 `analysis_preview` details，改为输出 hidden/open 的 debug overlay 壳。
- overlay 内部只调用 `renderAnalysisInputPreview` 的 `standalone: true` 路径，消息预览继续由 `buildWorldModelMessages` 生成。

## 状态与事件

- `createApp` 闭包新增 `analysisDebugOpen`；打开前执行 `captureWorldAnalysisPromptDraft()`。
- root click delegation 处理 open/close action 和 overlay 空白点击；Escape 顺序为 debug、More、主 BioWeave。
- 关闭主 BioWeave、离开 settings 或 destroy 时清零状态；不写入任何持久化对象。

## 样式

- 使用固定独立 backdrop、dialog header/body；body 自滚动，桌面约 900px/80vh，700px 以下接近全屏。
- 使用现有 `--bioweave-*` 变量和 `bioweave-*` 选择器；移动端 pre 允许横向滚动。

## 测试和风险

- 静态 HTML 验证入口/无独立 disclosure/hidden-open/preview marker。
- 导出或复用实际事件判定 helper 验证 Esc、内部点击和 backdrop 点击不会误关主 overlay。
- 重点检查 summary button 不触发原生 details toggle，nested overlay click 不冒泡到主 overlay。
