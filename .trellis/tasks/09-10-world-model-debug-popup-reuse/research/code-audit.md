# 代码审计：World Model 调试 Popup 统一

## 现有设置 Popup

- `ui/app.js:576-653` 已有 `hostPopupContext()`、`renderDebugPopupContent()` 与 `openAnalysisDebug()`。
- 当前 helper 在 `ui/app.js:607` 以 `if (route !== 'settings') return false` 限制，只能从设置入口使用。
- 当前 helper 使用 `renderAnalysisDebugPopupContent()`，构造 DISPLAY Popup，选项为 `{wide: true, allowVerticalScrolling: true}`，并在 Popup content 本身绑定刷新与 `analysis-preview-mode` click listener。
- `ui/settings.js:846-875` 的 renderer 统一输出高级/调试标题与 `renderAnalysisInputPreview({standalone: true, messagePreview: true, promptSettings, ...})`；消息 preview 仍来自 `buildWorldModelMessages()`。

## World Model 旧链路

- `ui/world.js:1` import `renderAnalysisInputPreview`；`:578-608` 接收 `showAnalysisInput`/`analysisPreview`，按状态生成 `inputPreview`，并在页面 body 后插入。
- `ui/app.js:161-176` 在 `createWorldModelState()` 持有 `showAnalysisInput`；`:1386`、`:1517` 清零；`:1573-1582` 的 `toggleWorldModelInputPreview()` 切换并刷新；`:1809-1810` 传给 worldPage；`:2601-2604` action 调用旧 toggle。
- `analysisPreviewState` 不应整体删除：设置 Popup 与 World Model Analyzer trace 仍依赖它；仅删除 World route 对 `analysisPreview` 的 page 参数。

## Prompt 来源风险

- `renderDebugPopupContent()` 当前总是传 `settingsState.worldAnalysisPromptDraft`，因此直接复用到 World Model 会把设置页遗留 draft 泄漏到 World 入口。
- World route 不一定经过 `loadSettings()`，所以非 draft 模式应优先调用 `profileStore.getWorldAnalysisPrompt?.()`，再回退 state。

## 测试证据

- `tests/ui.test.js:502-607` 已覆盖设置 Popup 构造、DISPLAY/options、Popup content 事件委托和无 Popup Toast。
- `tests/world-model.test.js:3063-3082` 当前仍断言 World Model 页内四条消息，应改为无内嵌 preview 与固定按钮文案。
- `tests/worldbook.test.js` 也有 standalone debug renderer/设置入口静态断言，可作为共享 renderer 不回退的证据。

## 不变边界

不修改 `ai/input-builder.js`、`ai/prompts.js`、`storage/*`、World Model schema/data、API Profile、Analyzer guard、source selection 或 prompt 格式。
