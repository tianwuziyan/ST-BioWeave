# SillyTavern Popup 与 Toast 交互修正

## Goal

纠正设置页交互层对 SillyTavern `Popup` 和 `toastr` 的职责划分：高级 / 调试使用酒馆原生 Popup，普通操作反馈继续使用 Toast，明确确认使用原生确认 Popup。目标是移除上一轮重复实现的 modal 生命周期，同时保留现有预览、保存和 Chat-local 行为。

## Background and confirmed facts

- SillyTavern 官方扩展文档将 Popup 分为确认、输入、文本和 `POPUP_TYPE.DISPLAY`；直接构造 Popup 支持 `wide` 与 `allowVerticalScrolling`，并由宿主处理关闭、遮罩和 Esc。文档同一节明确要求轻量反馈使用全局 `toastr`：<https://docs.sillytavern.app/for-contributors/writing-extensions/#popups-and-user-feedback>。
- `ui/settings.js:846-874` 当前生成 `.bioweave-analysis-debug-overlay`、dialog、header 和 close button；`ui/app.js:408`、`593-605`、`2427-2494`、`2752-2777` 维护对应的临时状态、事件和 Esc 优先级；`style.css:2430-2478`、`2500-2543`、`3454-3478` 维护重复 modal shell。
- `ui/settings.js:802-843` 的 `renderAnalysisInputPreview()` 已支持 `standalone: true`，且其消息预览继续通过真实 `buildWorldModelMessages()` 生成；本次只改变承载方式。
- `ui/app.js:74-98` 已有统一 `notify()`，目前最终调用宿主 window/global toastr 并提供 console fallback；该封装可以保留。
- `ui/app.js:1294-1299` 和 `ui/app.js:2286` 仍使用宿主 `confirm`；至少删除 API Profile 的确认必须改为 `Popup.show.confirm`，并且所有 `window.confirm`/`globalThis.confirm` 路径都应移除。
- Popup 内容被宿主移动到酒馆 Popup DOM 后，不再是 BioWeave root 的后代；Preview 的刷新和结构/原始切换动作必须在 Popup 内容自身做事件委托并更新其内容，不能因移出 root 而失效。

## Requirements

### R1. 高级 / 调试使用原生 Popup

- 世界分析提示词标题右侧继续保留 `data-bioweave-action="open-analysis-debug"` 按钮。
- 点击按钮时通过 `runtime.st?.getContext?.() ?? globalThis.SillyTavern?.getContext?.()` 获取宿主 context。
- 使用 `new Popup(content, POPUP_TYPE.DISPLAY, '', {wide: true, allowVerticalScrolling: true})` 或与当前宿主 API 等价的参数；优先传入 DOM `Element`，无 DOM 能力时才退回 HTML 字符串。
- Popup 内容必须继续包含：
  - 高级 / 调试说明；
  - `renderAnalysisInputPreview({...analysisPreview, standalone: true, messagePreview: true, promptSettings: worldAnalysisPromptDraft ?? worldAnalysisPrompt, openSettingsSections})`；
  - AnalysisInput 预览、消息预览、结构/原始切换、刷新、Trace、AI 原始返回和 normalize 后结果。
- Preview 的操作按钮在原生 Popup 内继续可用；必要时只为 Popup 内容增加局部事件委托和原地内容更新。
- 不再维护 `analysisDebugOpen`、自定义 debug overlay、dialog、遮罩点击关闭或自定义 debug Esc 优先级。

### R2. 删除自定义 modal 壳

- 删除 `.bioweave-analysis-debug-overlay`、`.bioweave-analysis-debug-dialog` 及 header/close/body 等 modal shell CSS、HTML 和事件判断。
- 只保留 Preview 内容本身需要的样式，例如 Popup 内容标题、预览布局、`pre` overflow 和 Trace grid。
- 不新增拖拽、缩放、位置/尺寸持久化或第二套 Popup 生命周期。

### R3. 普通操作使用 toastr

- `notify(message, type)` 保留并作为唯一业务入口；内部按 `success/info/warning/error` 调用宿主 `toastr`，不得引入第三方通知库。
- 世界书来源、提示词、API Profile、默认 API、任务分配、模型刷新、规则上限和普通保存失败继续按语义使用 Toast。
- 世界书 checkbox 必须保持“立即更新状态 → 保存 → Toast”，不能每次切换显示阻塞 Popup。
- 持续可阅读的 API 测试结果、Preview 错误、World Model Trace、AI 原始返回、normalize 结果和 loading/empty/result 状态继续留在组件内。
- World Model 分析成功和手动模块保存成功使用 `success` Toast；`REQUEST_ABORTED` 仅在请求实际完成取消清理后使用 `info` Toast；`REQUEST_TIMEOUT` 及其他真实分析/保存失败使用 `error` Toast。上述 transient 结果不得通过 World Model 页面 notice 输出。
- World Model 页面 inline notice 仅保留真正需要持续处理的 persistent 状态，例如已保存模型格式无效；确认 Popup 的取消、关闭或 Escape 不产生取消 Toast。

### R4. 明确确认使用 Popup

- 删除 API Profile 使用 `Popup.show.confirm(title, message)`，仅 `result === POPUP_RESULT.AFFIRMATIVE` 时继续。
- World Model 草稿放弃确认等其他原生 confirm 路径也迁移到同一 Popup confirm helper；禁止 `window.confirm`、`document.defaultView.confirm` 和 `globalThis.confirm`。
- Popup API 不可用时不得静默执行危险操作；使用安全 error Toast 并取消本次操作。

### R5. 业务边界

- 不修改 World Model、AnalysisInput、API Profile、Analyzer guard、核心提示词约束、真实 `buildWorldModelMessages()`、存储 schema 或请求结构。
- 不直接 import SillyTavern 内部模块；只使用 `getContext()` 暴露的 Popup/常量。
- 不改变上一轮 Toast 的布局稳定性和 Chat token/串行保存保护。

### R6. 验证

- 增加 Popup 构造、`POPUP_TYPE.DISPLAY`、`wide`、`allowVerticalScrolling`、Preview 内容事件和 Popup confirm 测试。
- 确认普通 Toast、世界书连续 checkbox、提示词保存和 API 删除确认没有回归。
- 运行聚焦测试、完整 `npm run check`、`node --check` 和 `git diff --check`。
- 记录仍需真实 SillyTavern 宿主验证的 Popup 主题、遮罩、Esc、z-index、移动端和 Toast 表现。

## Acceptance Criteria

- [ ] 点击高级 / 调试调用 SillyTavern `Popup`，类型为 `POPUP_TYPE.DISPLAY`，选项包含 `wide: true` 与 `allowVerticalScrolling: true`。
- [ ] 设置页和 CSS 不再包含自定义 debug modal overlay/dialog/header/body/close shell，也不再有 `analysisDebugOpen` 或其 Esc/遮罩逻辑。
- [ ] Popup 内容继续复用 `renderAnalysisInputPreview(... standalone: true, messagePreview: true)`，消息顺序继续由真实 `buildWorldModelMessages()` 提供。
- [ ] Popup 内刷新预览、结构/原始切换仍可用，不依赖 BioWeave root 事件委托。
- [ ] API Profile 删除和 World Model 草稿放弃确认使用 `Popup.show.confirm`，代码中不再调用 `window.confirm`、`document.defaultView.confirm` 或 `globalThis.confirm`。
- [ ] 世界书 checkbox、设置保存、删除成功/失败和数量上限继续只产生对应 toastr，不产生阻塞 Popup 或页面 notice。
- [ ] 数据 schema、请求 builder、Analyzer guard、核心提示词和存储行为不变。
- [ ] 原有测试与新增 Popup/confirm/Toast/checkbox 回归通过，`npm run check`、`node --check`、`git diff --check` 全部通过。

## Out of scope

- 重构 BioWeave 主 overlay、设置状态系统、Preview builder 或 Toast 封装之外的通知架构。
- 引入第三方 UI/通知库、直接 import SillyTavern 内部模块、改变数据 schema 或 API 请求协议。
- 自定义弹窗拖拽、缩放、位置保存、焦点陷阱或新的持久化配置。

## Open questions

无。用户已明确要求按官方 Popup/toastr 边界实施；技术未知项由宿主文档和当前 `Popup` 源码核验后按上述设计落地。
