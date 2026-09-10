# 技术设计

## 边界和所有权

- `ui/settings.js` 继续是设置页的纯 HTML 渲染模块：扩展已有 `renderSettingsSummary` 的局部接口，在世界分析提示词 summary 插入受控 action HTML；新增 debug overlay 壳，但 preview 内容唯一来源仍是 `renderAnalysisInputPreview`。
- `ui/app.js` 继续是 app 状态和事件委托 owner：持有 `analysisDebugOpen` 临时布尔值，捕获 prompt draft，处理 open/close/backdrop/Escape，并提供 `notify` 宿主适配薄层。
- `style.css` 只增加 `bioweave-*` 作用域的 debug overlay/dialog/header/body 和 summary action 样式，复用现有 panel 主题变量和 mobile breakpoints。
- `tests/*.test.js` 只补 UI/通知回归，不改变业务层测试的 schema fixture。

## 数据流

```text
世界分析提示词按钮
  -> app.handleClick()
  -> captureWorldAnalysisPromptDraft()
  -> analysisDebugOpen = true
  -> render()
  -> settingsPage({analysisDebugOpen, analysisPreview, prompt draft})
  -> renderAnalysisInputPreview({standalone: true, messagePreview: true})
  -> buildWorldModelMessages(input, promptSettings)
```

```text
设置操作
  -> existing async save / state update
  -> notify(message, type)
  -> hostWindow.toastr[type](text) | console fallback
```

Toast 只处理瞬时反馈；`analysisPreview.error`、`testResult`、World Model trace 和页面 loading/result 仍由所属渲染组件持有。

## Debug 状态和事件合同

- `analysisDebugOpen` 只存在 `createApp` 闭包；`closeBioWeave()`、路由离开 settings 和 `destroyBioWeave()` 清零，确保重开不会恢复旧弹窗。
- `openAnalysisDebug()` 先 capture draft，再置 true/render；`closeAnalysisDebug()` 置 false/render。
- root click delegation 在常规 action 分派前识别 debug overlay 本身的点击：只有 `event.target === debugOverlay` 才关闭并 stop propagation；dialog 或其子节点不关闭。
- Escape 处理顺序固定为 debug → More → BioWeave，并保留 `preventDefault()`。
- debug overlay 放在 BioWeave root 内，主 overlay listener 仍只判断外层 surface；debug backdrop 处理时阻止继续冒泡，避免未来外层判断扩展造成误关。

## Settings markup

- `renderSettingsSummary(title, hint, actionHtml = '')` 只扩展第三个受控参数，其他 disclosure 调用保持原输出。
- `renderWorldAnalysisPromptSettings` 传入 action button；按钮位于 summary copy 和 summary arrow 之间，不放 textarea card 底部。
- `renderAnalysisDebugOverlay` 传入 `analysisDebugOpen` 和 preview 参数，关闭状态输出 `hidden`，打开状态输出同一 DOM 位置的 dialog。不会在主设置文档流中渲染可见 preview card。
- debug preview 的 `promptSettings` 优先 draft，`openSettingsSections` 来自 worldbook state；不新增 message builder 或数据字段。

## Toast notice 迁移

- 删除设置页顶层 `safeNotice` 和 worldbook source card 的 notice 输出；迁移生产者时保留 continuous preview/test/trace 渲染。
- `persistAnalysisSettings` 在保存链完成时直接 notify success/error，并允许来源 checkbox 调用使用 `renderAfterSave: false`；状态仍立即 render，保存失败不回滚已有用户选择，只 Toast error。
- profile/API/prompt/assignment/source/model/regex 操作在各自成功/失败分支 notify；不把 API test result 或 preview error 改成短暂 Toast-only 状态。
- `notify` 不触碰任何存储或 schema；host window 优先于 globalThis，方便宿主 iframe/documentRef 和 Node mock。

## CSS 和兼容性

- Debug backdrop 使用 fixed top/left、100vw/100dvw、100vh/100dvh、pointer-events 和较高 root 内 z-index；dialog `display:flex; flex-direction:column; min-width:0; max-height`，body `min-height:0; overflow:auto`。
- 桌面宽度约 `min(900px, calc(100vw - 40px))`、高度约 `min(80vh, 850px)`；移动端（不超过 700px）改为 `calc(100vw - 16px)`/`calc(100vh - 16px)`，header 不收缩，pre 保留横向滚动。
- 不改变主 overlay 的 z-index、pointer-events、bottom nav 或 theme root；所有选择器使用 `bioweave-*`，避免全局 body/button 覆盖。

## 兼容性、回滚和风险

- 宿主没有 toastr 时 console fallback 保证保存逻辑继续执行；真实 SillyTavern Toast 外观需宿主 smoke 验收。
- 弹窗使用已有 root 重建生命周期，无额外 DOM 节点挂到 `documentElement`，因此不会改变主 overlay 生命周期。
- 最大风险是 summary 内按钮的原生 details toggle 和 nested backdrop 冒泡；事件测试必须验证 `preventDefault`/stopPropagation 和主 overlay 未关闭。
- 如需回滚，限于恢复 `ui/settings.js`、`ui/app.js`、`style.css` 与 UI 测试的本次 diff，不触及已有业务/schema 变更。
