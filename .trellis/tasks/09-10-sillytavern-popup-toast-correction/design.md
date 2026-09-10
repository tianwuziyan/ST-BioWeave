# 技术设计

## 宿主 API 边界

- 在 `ui/app.js` 内通过 `runtime.st?.getContext?.() ?? globalThis.SillyTavern?.getContext?.()` 获取当前 SillyTavern context；不 import `script.js` 或其他内部模块。
- 提取 `Popup`、`POPUP_TYPE`、`POPUP_RESULT` 只用于本次 UI 交互；`notify()` 继续通过宿主全局 toastr 做轻量反馈。
- `POPUP_TYPE.DISPLAY` 只负责承载高级调试内容；原生 Popup 的 dialog、backdrop、z-index、关闭按钮、Esc 和移动端行为全部由宿主拥有。
- BioWeave overlay 使用 `z-index: 5000`：高于真实宿主普通浮层最高观察值 `4100`，低于 Popup `9999` 与 Toast `999999`；禁止覆盖宿主 Popup/Toast selector。

## 调试内容流

```text
世界分析提示词按钮
  -> handleClick()
  -> captureWorldAnalysisPromptDraft()
  -> renderAnalysisDebugPopupContent(...)
  -> new Popup(content, POPUP_TYPE.DISPLAY, '', {wide, allowVerticalScrolling})
  -> await popup.show()
```

- `renderAnalysisDebugPopupContent` 放在 `ui/settings.js`，只负责拼接 Popup 内容和调用既有 `renderAnalysisInputPreview`；优先创建一个 `documentRef.createElement('div')` 并设置 `innerHTML`，无 DOM 时返回 HTML 字符串以支持 Node mock。
- 调用 Preview 时固定传入 `standalone: true`、`messagePreview: true`、当前 draft 优先的 `promptSettings` 和 `openSettingsSections`。不复制消息顺序，也不新增 request builder。
- 由于 Popup 会将内容移到宿主 dialog，Preview 内容根节点或 Popup content host 上绑定局部 click delegation。刷新和模式切换完成后根据当前 `analysisPreviewState` 重建 Popup content 的子内容；BioWeave 主 root 的正常设置页 render 仍可照常发生。
- 不在 app 闭包保存 `analysisDebugOpen`。Popup 实例、内容节点和局部监听器仅存在于一次 `openAnalysisDebug()` 调用的生命周期，并在 Popup 结束后由宿主清理。

## 确认流

- 增加一个小型异步 `confirmWithPopup(title, message)`：从当前 context 获取 `Popup.show.confirm` 和 `POPUP_RESULT.AFFIRMATIVE`；API 不完整或调用抛错时发 error Toast 并返回 false。
- `removeProfile()` 在删除前 `await confirmWithPopup(...)`。
- `canDiscardWorldModelSectionDraft()` 改为异步，使用同一 helper；`beginWorldModelSectionEdit()`、`selectWorldModelType()` 和 `analyzeWorldModel()` 依次 await，root click action 也 await 对应函数。
- 不保留 native confirm fallback，确保代码和真实交互不再绕过 SillyTavern Popup。

## Toast 流

- 保持现有 `notify(message, type, documentRef)` 作为业务唯一入口；只允许它接触 document window/global toastr 和 console fallback。
- 世界书 checkbox 不新增 Popup 调用；保留立即 `render()`、Chat token 校验、串行保存链和 `renderAfterSave: false`，保存结束只调用 success/error Toast。
- API test result、Preview error、World Model trace 和 world page notice 不因 Popup 调整而改变。

## CSS 和清理边界

- 删除 `.bioweave-analysis-debug-overlay`、`.bioweave-analysis-debug-dialog`、`.bioweave-analysis-debug-header`、`.bioweave-analysis-debug-close`、`.bioweave-analysis-debug-body` 及其 mobile modal rules。
- 可保留一个内容级 `.bioweave-analysis-debug-popup-content`，用于标题说明、Preview content `max-height: none` 和 Popup 内 `pre` 的滚动；不设置 fixed、z-index、backdrop、dialog height/width 或 close button。
- 删除 `analysisDebugOpen`、`resolveEscapeAction`、`isAnalysisDebugBackdropClick` 及 root/outer overlay 对 debug backdrop 的判断；主 BioWeave 的 More/Escape 行为保持原有顺序。

## 兼容性与回滚

- Node 测试 mock context 的 `Popup`, `POPUP_TYPE`, `POPUP_RESULT`，不模拟 SillyTavern 内部 dialog DOM；真实宿主 smoke 负责验证原生视觉和生命周期。
- Popup 不可用时高级调试打开操作只发安全 error Toast，不回退到自定义 modal；确认不可用时危险操作取消。
- 回滚范围限于 `ui/app.js`、`ui/settings.js`、`style.css` 及本次 UI 测试；不触及 schema、storage、prompt、Analyzer 或 World Model builder。
