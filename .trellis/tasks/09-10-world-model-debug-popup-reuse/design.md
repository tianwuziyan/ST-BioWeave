# 技术设计

## 1. 统一 Popup helper

在 `ui/app.js` 将现有 `openAnalysisDebug()` 改为唯一的 route-independent `openAnalysisDebugPopup({usePromptDraft = false} = {})`（名称可保持等价但必须只有一个实现）。

- `usePromptDraft === true` 时先调用 `captureWorldAnalysisPromptDraft()`，适用于设置页入口。
- 渲染前解析 prompt：草稿模式使用 `settingsState.worldAnalysisPromptDraft ?? settingsState.worldAnalysisPrompt`；非草稿模式优先使用 `profileStore.getWorldAnalysisPrompt?.()`，回退到 `settingsState.worldAnalysisPrompt`，适用于 World Model route 尚未加载设置的情况。
- `renderDebugPopupContent(content, {usePromptDraft})` 每次刷新重绘时使用同一个已选 prompt 来源；不把 settings textarea 或 route-specific preview 拼进 Popup。
- 保持当前 `hostPopupContext()`、`Popup`/`POPUP_TYPE.DISPLAY` 检查、DOM Element content、`wide` 和 `allowVerticalScrolling` 参数以及安全 Toast。
- 将当前 content click listener 绑定/解绑逻辑原样保留在 helper 内，刷新和模式切换仍更新 Popup content 自身。

## 2. 入口与状态

- `open-analysis-debug` 分支调用 `await openAnalysisDebugPopup({usePromptDraft: true})`。
- `world-model-view-input` 分支调用 `await openAnalysisDebugPopup()`。
- 删除 `createWorldModelState()` 中的 `showAnalysisInput`，以及 World Model 编辑/分析流程中的清零赋值、render 传递和 `toggleWorldModelInputPreview()`。
- `analysisPreviewState`、`refreshAnalysisPreview()`、`setAnalysisPreviewMode()` 和 World Model trace 保留，因为它们属于统一 Popup/设置调试功能；World route 不再把 `analysisPreview` 传给 `worldPage()`。

## 3. World Model 页面

- `ui/world.js` 删除 settings renderer import、`showAnalysisInput`/`analysisPreview` 参数、页内 `inputPreview` 和返回数组中的 preview。
- 生成固定按钮文本“查看本次分析输入”。页面只渲染 World Model 内容与原有 notice，不承载调试卡。

## 4. 测试设计

- 在 `tests/ui.test.js` 扩展 fake Popup 测试：从 settings 入口与 world 入口分别点击，断言构造记录使用同一 Popup 路径、DISPLAY、空标题和相同 options；验证两个 content 都包含相同 preview/message 标记，且 Popup content 自身的 refresh/mode listener 可用。
- 在 `tests/world-model.test.js` 更新 World Model 静态结构测试：按钮固定文案/动作存在；传入旧 `showAnalysisInput` 不会生成页内 `data-bioweave-analysis-preview`；页内不再出现内嵌 message preview。
- 添加或扩展 prompt 来源测试：设置入口捕获 draft，World 入口调用已保存值，避免 draft 泄漏。

## 5. 不变项与回滚

不触碰真实 AnalysisInput 收集、`buildWorldModelMessages()`、schema、storage、API Profile 或 Analyzer。若 Popup 宿主兼容出现问题，回滚点为 `ui/app.js` helper/入口改动和 `ui/world.js` 状态清理，不需要数据迁移。
