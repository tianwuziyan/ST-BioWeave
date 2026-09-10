# 统一 World Model 分析调试 Popup

## Goal

让设置页“高级 / 调试”和 World Model“查看本次分析输入”共用同一个 SillyTavern 原生 DISPLAY Popup、内容 renderer 和 Popup 内事件委托，删除 World Model 旧版页内 AnalysisInput 展开状态。

## Background / Confirmed Facts

- `ui/app.js` 已有设置页原生 Popup 路径：`openAnalysisDebug()` 构造 `Popup(content, POPUP_TYPE.DISPLAY, '', {wide: true, allowVerticalScrolling: true})`，并在 Popup content 上委托刷新/结构-原始切换事件。
- `renderAnalysisDebugPopupContent()` 和 `renderAnalysisInputPreview()` 已覆盖 AnalysisInput、结构/原始预览、真实 `buildWorldModelMessages()` 消息、Trace、AI 原始返回和 normalize 结果。
- 当前 helper 被 `route === 'settings'` 限制，World Model 仍在 `ui/world.js` 渲染 `inputPreview`，并由 `showAnalysisInput` / `toggleWorldModelInputPreview()` 管理。
- 当前 branch 上首尾 SYSTEM 配置已存在；本任务不得改动其 builder、schema、storage 或 API 行为。

## Requirements

- R1. 提取或重命名现有设置页 Popup 打开路径为一个 route-independent helper（推荐 `openAnalysisDebugPopup({usePromptDraft = false})`），不能复制第二份 Popup 构造或 Popup content 事件委托。
- R2. 设置页 `open-analysis-debug` 入口继续存在，点击时捕获当前未保存的世界分析提示词草稿，并使用 `worldAnalysisPromptDraft ?? worldAnalysisPrompt`。
- R3. World Model `world-model-view-input` 入口改为调用同一 helper，不捕获 textarea 草稿，直接使用当前已保存的 `worldAnalysisPrompt`（必要时从 profileStore 读取，不能依赖未加载的 settings route 状态）。
- R4. 两个入口均使用同一 `Popup` 构造参数：`POPUP_TYPE.DISPLAY`、空标题、`wide: true`、`allowVerticalScrolling: true`；不得创建自定义 modal/overlay。
- R5. 两个入口均使用 `renderAnalysisDebugPopupContent()` → `renderAnalysisInputPreview(... standalone: true, messagePreview: true)`；消息仍唯一来源于真实 `buildWorldModelMessages()`。
- R6. Popup content 的刷新、结构/原始切换事件委托只保留一份，并在两个入口打开的 Popup 内继续工作；不得依赖 `#bioweave-panel` 祖先事件委托。
- R7. 从 `worldPage()` 删除 `showAnalysisInput` 参数、`analysisPreview` 仅为旧内嵌 preview 的参数、页内 `inputPreview` 渲染、动态“收起”文字以及对 `renderAnalysisInputPreview` 的 import；保留仍被设置 Popup/Trace 使用的全局 `analysisPreviewState`。
- R8. 从 `ui/app.js` 删除 `showAnalysisInput` 状态字段、所有写入/传递，以及 `toggleWorldModelInputPreview()`；World Model 页面重新渲染不受调试 Popup 打开/关闭影响。
- R9. World Model 按钮固定显示“查看本次分析输入”，保留 `data-bioweave-action="world-model-view-input"`。
- R10. 不修改 `buildAnalysisInput()`、`buildWorldModelMessages()`、schema、storage、World Model 数据、API Profile、Analyzer guard、source selection 或 prompt 格式。

## Acceptance Criteria

- [x] AC1. 设置页和 World Model 两个入口都调用同一 `openAnalysisDebugPopup`（或等价唯一 helper），均构造原生 DISPLAY Popup，参数包含 `wide: true` 与 `allowVerticalScrolling: true`。
- [x] AC2. World Model 页面保留按钮并固定显示“查看本次分析输入”，不再出现“收起本次分析输入”。
- [x] AC3. `showAnalysisInput`、`toggleWorldModelInputPreview()`、World Model 页内 `inputPreview` 和无用途的 renderer import 均删除；即使传入旧 `showAnalysisInput: true`，页面也不渲染 `data-bioweave-analysis-preview`。
- [x] AC4. 两入口打开的 Popup content 均包含 `data-bioweave-analysis-preview`、`data-bioweave-world-model-message-preview`、结构/原始切换、刷新、system_top/system_bottom 消息和 World Model Trace 区域（有 trace 时）。
- [x] AC5. Popup 内刷新和结构/原始切换在两个入口均通过同一 content 事件委托正常更新，不依赖 BioWeave root。
- [x] AC6. 设置入口先捕获未保存 prompt 草稿；World Model 入口只使用已保存 prompt；两者的消息内容分别反映对应配置。
- [x] AC7. World Model Popup 关闭由宿主负责，不触发 World Model 重新渲染或产生页面高度变化；按钮文字与状态不变。
- [x] AC8. 原有测试、双入口 Popup 回归、World Model 结构回归、`npm run check`、变更 JS `node --check`、`git diff --check` 全部通过。

## Out of Scope

- 不修改 `storage/schema.js`、`storage/store.js`、`ai/input-builder.js`、`ai/prompts.js`、`ai/analyzer.js`、World Model schema/data、API Profile 或 source selection。
- 不重写 `renderAnalysisInputPreview()`、`renderAnalysisDebugPopupContent()` 或真实 request builder。
- 不新增 World Model 自有 Popup、CSS 伪装 Popup、第二套刷新/预览事件逻辑、持久化调试状态或新的 UI 框架。
- 不要求本任务顺带修复 World 页面既有的 promptSettings 传参差异；World Model 入口只需通过统一 helper 读取当前已保存 prompt。

## Risks / Deferred

- 当前仓库的 Node fake DOM 可验证 Popup 构造和事件委托，但 Popup 的宿主遮罩、Esc、z-index、移动端尺寸仍需真实 SillyTavern 安装验收。
- helper 的 prompt 来源必须显式区分设置草稿和 World Model 已保存值，避免从设置页残留 draft 污染 World Model。

## Technical Notes

- 修改所有权集中在 `ui/app.js`（helper、入口分发、状态清理）、`ui/world.js`（按钮与页内 preview 删除）和测试文件；不扩展业务层。
- `renderAnalysisDebugPopupContent()` 已是设置页 Popup 内容单一 renderer；应通过参数控制 prompt draft，而不是让 world.js 重新组装内容。
