# 设置页高级调试弹窗与 Toast 通知改造

## Goal

改善 BioWeave 设置页的空间稳定性和操作反馈：将“高级 / 调试”从设置页独立 disclosure 收纳到二级工具弹窗，并将瞬时设置操作反馈迁移到 SillyTavern 顶部 Toast。现有分析输入、World Model 请求、数据结构和存储行为必须保持不变。

## Background and confirmed facts

- `ui/settings.js:151-158` 的 `renderSettingsSummary(title, hint)` 是现有设置 disclosure 标题壳，世界分析提示词在 `ui/settings.js:719-743` 使用它。
- `ui/settings.js:797-839` 的 `renderAnalysisInputPreview()` 已支持 `standalone: true`；非 standalone 路径才生成 `data-bioweave-settings-disclosure="analysis_preview"`。
- `ui/settings.js:841-903` 当前直接把非 standalone preview 插入设置页，并在页标题后渲染 `settingsState.notice`。
- `ui/app.js:354-404` 持有 app 的展示状态；`ui/app.js:1645-1695` 统一重建页面并恢复 `.bioweave-main` 与世界书列表滚动位置。
- `ui/app.js:2306-2623` 使用 root 事件委托处理设置动作、主 overlay 点击和 Escape；主 overlay 监听器只在事件目标等于外层 overlay 时关闭 BioWeave。
- `ui/app.js:680-730` 的分析来源保存串行执行；世界书 checkbox 在 `ui/app.js:852-865`、`936-954` 中先更新内存并 render，再异步保存。
- `style.css:62-92` 已定义 documentElement 级主 overlay；`style.css:1104-1252`、`2278-2412` 已提供 settings summary 和 preview 的基础样式。
- 当前仓库没有现成 toastr/notification helper；SillyTavern 宿主通过 `globalThis.toastr` 或 document window 暴露 Toast API。

## Requirements

### R1. 调试入口和弹窗

- 在“世界分析提示词”设置项标题区域右侧加入 `button[type="button"]`，包含 `bioweave-secondary-action bioweave-analysis-debug-trigger` 和 `data-bioweave-action="open-analysis-debug"`。
- 设置页不再直接插入非 standalone 的 AnalysisInput preview，不再生成 `data-bioweave-settings-disclosure="analysis_preview"` 独立板块。
- 设置页保留一个临时 debug overlay 壳；关闭时使用 `hidden`，打开时显示独立标题栏、关闭按钮和可滚动 body，不撑开设置页。
- 弹窗 body 必须调用现有 `renderAnalysisInputPreview({...analysisPreview, standalone: true, messagePreview: true, promptSettings: worldAnalysisPromptDraft ?? worldAnalysisPrompt, openSettingsSections: worldbookSources.openSettingsSections})`。
- Preview 中的消息顺序必须继续由现有 `buildWorldModelMessages()` 产生，不得在 UI 中手工拼接请求消息。

### R2. 调试交互和响应式行为

- 打开前捕获未保存的世界分析提示词草稿；打开和关闭只改变 app 内存中的 `analysisDebugOpen` 或等价 UI 状态，不写入 Chat、extensionSettings、localStorage、worldbookSources 或 prompt 数据。
- `open-analysis-debug` 和 `close-analysis-debug` 由现有 root click delegation 处理。
- 点击弹窗内容不关闭；点击 debug overlay 空白关闭 debug，且不得关闭 BioWeave 主 overlay。
- Escape 优先关闭 debug，其次关闭 More 菜单，最后关闭 BioWeave；连续两次 Escape 的结果必须是先 debug closed、再主 BioWeave closed。
- 桌面弹窗宽度采用约 `min(900px, calc(100vw - 40px))`、高度采用约 `min(80vh, 850px)`；body 自己滚动。
- `max-width: 700px` 时弹窗使用接近全屏的宽高，header/关闭按钮保持可用，preview 内的 `pre` 支持横向滚动，不能遮挡 BioWeave 底部导航。

### R3. Toast 统一封装和分类

- 增加一个薄 `notify(message, type)` 封装，优先使用宿主 `toastr[type]`；宿主不可用时按类型回退到 `console.log/warn/error`。不得引入第三方通知库。
- 保存、删除、来源切换、任务分配、默认 API 来源/API 配置、提示词保存和世界书来源保存等瞬时成功反馈使用 `success`。
- 一般刷新完成使用 `info`；达到规则数量上限或模型列表为空但仍可手填使用 `warning`；保存失败、API/Secret Store/配置操作失败使用 `error`。
- `settingsState.notice` 和 `analysisSourcesState.notice` 不再作为设置页顶部或世界书来源卡片中的瞬时反馈载体；对应生产者改为 Toast，并清除已无消费者的 presentation notice 写入。
- `settingsPage()` 不再渲染设置页顶部 `safeNotice`，因此常规 checkbox、API 保存、任务分配和提示词保存不会新增或移除 `.bioweave-settings-notice`。
- 必须保留持续可阅读状态：API 测试结果、AnalysisInput preview error、World Model Trace、AI 原始返回、normalize 后结果，以及 world page 自身的 loading/empty/result 状态。

### R4. 世界书选择稳定性

- checkbox 勾选必须立即反映内存状态并保持现有保存函数、Chat-local schema 和异步串行/过期保护行为。
- 世界书来源成功/失败反馈使用 Toast；可以保留已有必要 render，但 Toast 的出现/消失不得创建或删除页面文档流节点。
- 连续切换多个世界书 checkbox 时，`.bioweave-main` 和世界书列表当前滚动位置、顶部布局不能因 notice 上下移动。

### R5. 业务边界

- 不修改 `storage/schema.js`、`storage/store.js`、World Model schema、AnalysisInput schema、API Profile schema、`ai/prompts.js`、Analyzer guard 或真实 World Model 请求结构。
- 不改变 system_top/system_bottom 的保存、normalize、placeholder 展开和 message builder 行为。
- 不增加拖拽、resize、位置/尺寸持久化或新的 Preview/Toast 实现。

### R6. 验证

- 补充设置结构、弹窗显示/关闭、Preview 复用、真实 builder 消息预览、Escape、遮罩点击、Toast 类型、世界书 checkbox 和提示词保存回归测试。
- 运行聚焦测试与完整 `npm test`、`npm run check`，并对变更 JavaScript 执行 `node --check`，对变更执行 `git diff --check`。
- 记录仍需真实 SillyTavern 宿主进行的 Desktop/Tablet/Mobile 与原生 Toast 验收。

## Child task map

- `09-10-analysis-debug-dialog`: R1、R2，以及设置结构/preview/交互/CSS 测试。
- `09-10-settings-toast-notifications`: R3、R4，以及 Toast 分类、保存失败/上限/checkbox/提示词测试。
- `09-10-world-model-debug-popup-reuse`: 让 World Model 的分析输入入口复用设置页原生 Popup，并删除旧页内 preview 状态；依赖前述 Popup helper 已落地。
- 父任务负责三个子任务的顺序协调、共享 `ui/app.js`/`ui/settings.js` 变更的整合审查和完整回归验收。

## Acceptance Criteria

- [ ] 设置页没有独立的 `analysis_preview` settings disclosure；世界分析提示词标题右侧存在高级 / 调试按钮。
- [ ] Debug overlay 默认 hidden，点击入口后显示，关闭按钮、遮罩点击和 Escape 行为正确，内部点击不关闭且不触发主 overlay 关闭。
- [ ] Debug 内容包含 `data-bioweave-analysis-preview` 和 `data-bioweave-world-model-message-preview`，并继续使用真实 `buildWorldModelMessages()`。
- [ ] Debug 状态不进入任何持久化对象；未保存 prompt 草稿打开后可用于 preview。
- [ ] 桌面和移动端弹窗满足独立滚动、主题变量、尺寸、关闭按钮和 pre 横向滚动要求。
- [ ] 瞬时设置反馈统一走宿主 Toast；成功/信息/警告/错误类型与分类一致，宿主缺失时安全回退。
- [ ] 设置页顶部和世界书来源卡片不因常规操作反馈产生 `.bioweave-settings-notice`；持续型 preview/test/trace 状态仍可读。
- [ ] 连续世界书 checkbox 切换的保存、状态和滚动稳定性回归通过；提示词保存行为不变且只产生 success Toast。
- [ ] 未修改列出的 schema、prompt、Analyzer guard 和 World Model 核心行为。
- [ ] 原有测试及新增聚焦测试通过，`node --check` 和 `git diff --check` 通过；宿主验收限制被明确记录。

## Out of scope

- 数据结构、存储 schema、Chat metadata 内容和 API 请求协议改造。
- 新通知库、拖拽/缩放/窗口位置持久化、Preview 逻辑复制、全局主题或主 overlay 生命周期重构。

## Open questions

无。用户已确认进入规划；现有代码和需求已确定实现边界，待用户批准最终规划摘要后再启动实现。
