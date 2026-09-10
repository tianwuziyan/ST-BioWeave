# 设置页高级调试二级弹窗

## Goal

把设置页的“高级 / 调试”从独立设置板块改成“世界分析提示词”标题右侧的二级工具弹窗，继续展示真实 AnalysisInput、World Model messages、结构/原始预览、刷新、Trace、AI 原始返回和 normalize 结果。

## Requirements

- `ui/settings.js` 的世界分析提示词 summary 右侧必须有 `data-bioweave-action="open-analysis-debug"` 按钮。
- `settingsPage()` 不得直接调用非 standalone 的 `renderAnalysisInputPreview()`；不得生成 `data-bioweave-settings-disclosure="analysis_preview"`。
- Debug overlay 关闭时 hidden，打开时有独立 header、关闭按钮、dialog/body 标记；body 调用现有 `renderAnalysisInputPreview()`，传入 `standalone: true`、`messagePreview: true`、当前 prompt draft/设置和 open settings sections。
- 消息预览继续依赖 `buildWorldModelMessages()`，不复制 message builder。
- `ui/app.js` 增加临时 `analysisDebugOpen` 状态，打开前捕获 prompt draft，支持入口、关闭按钮、遮罩和 Escape 优先级。
- 点击 dialog 内容不关闭；点击 overlay 空白只关闭 debug，不关闭主 BioWeave overlay。
- CSS 使用 BioWeave 主题变量；桌面约 900px/80vh 工具窗口，body 内滚动；移动端接近全屏且 `pre` 横向滚动。
- 不新增持久化状态、拖拽、resize 或位置/尺寸保存。

## Acceptance Criteria

- [ ] 默认设置 HTML 没有 analysis preview disclosure，存在高级 / 调试入口。
- [ ] 打开状态 HTML 显示 debug dialog，关闭状态带 hidden；preview card 和 message preview 均存在。
- [ ] 入口、关闭、遮罩、内部点击和 Escape helper/事件测试通过；第一次 Escape 不关闭 BioWeave，第二次关闭 BioWeave。
- [ ] Preview 消息角色、顺序和 system_top/system_bottom 仍由真实 builder 产生。
- [ ] 桌面/移动 CSS 规则覆盖尺寸、内部滚动、关闭按钮、主题和 pre 横向滚动。
- [ ] 只修改 UI 渲染、临时状态、事件和样式/测试，不修改 schema、prompt、Analyzer 或存储。

## Out of scope

- Toast 迁移、数据 schema、请求协议、Preview 实现复制、窗口拖拽/缩放/持久化。

## Dependencies

- 与 `09-10-settings-toast-notifications` 共用 `ui/settings.js`、`ui/app.js` 和静态设置测试；实现顺序由父任务协调，避免并行写同一文件。
- 待父任务最终规划摘要获批后才能 `task.py start`。
