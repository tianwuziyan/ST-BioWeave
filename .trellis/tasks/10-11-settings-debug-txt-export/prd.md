# 简化设置页调试信息并支持 TXT 导出

## Goal

保留设置页现有的调试下拉选择与内嵌查看能力，移除重复的高级调试 Popup 入口及其专用交互，新增一个明确的“导出调试信息（TXT）”按钮。导出的 UTF-8 TXT 内容使用完整、可解析的格式化 JSON Debug DTO，不改变 Runtime 诊断、Floor Persistence、Tracking、Projection 或 Event 编辑业务逻辑。

## Background and confirmed facts

- 设置页当前由 `ui/settings.js` 渲染 `analysis_debug` 区域，其中内嵌分析输入预览由 `analysisPreviewState` 提供，支持 World/Event 类型与结构/原始模式切换。
- 设置页当前还有 `data-bioweave-action="open-analysis-debug"` 按钮；`ui/app.js` 的 `openAnalysisDebugPopup()` 通过 SillyTavern `Popup` 展示 `renderAnalysisDebugPopupContent()`，并注册 Popup 内容及 document 捕获阶段的临时点击监听。本任务要求这些仅服务于该调试 Popup 的入口、DOM、渲染逻辑和事件监听全部删除，而不是隐藏或保留死代码。
- Popup 与设置页内嵌区域共享 `analysisPreviewState`，但 Popup 另外刷新并展示 `collectActiveBusinessData({includeDebug: true})`、`collectWorldModelLiveState()` 与 `runtime.getPersistenceTrace()`；因此二者不是完全相同的数据集合，Popup 包含设置页下拉/预览没有直接展示的业务与 LIVE STATE 字段。
- `runtime/event-analysis.js` 的 `collectActiveBusinessData({includeDebug: true})` 返回安全的 `debug` DTO，包含当前有效 Floor/Swipe、BiologicalEvent 完整对象、World Model、Character Registry、Tracking Window、Tracking Registry 与 Health Evolution 等字段。
- `runtime/diagnostics.js` 的 `getPersistenceTrace()` 返回安全过滤后的持久化/生命周期历史 trace，过滤规则包含 Event 编辑 operation ID、各阶段 `duration_ms`、Floor/Swipe、Floor Version、事务与持久化确认、错误码和失败阶段等字段。
- 当前已有 `copyPersistenceTrace()`，但只序列化 `world_model_live_state` 与 `history_trace` 并复制到剪贴板，不能满足完整 Debug DTO 导出需求。
- 当前 worktree 在任务开始时确认干净；用户要求不 reset、clean、commit、push。

## Requirements

1. 保留现有调试信息下拉框、选项、内容查看、World/Event 类型切换及结构/原始模式。
2. 真正删除重复调试 Popup：删除入口按钮、该 Popup 专用 DOM、渲染逻辑、打开路径、刷新/失效逻辑和事件监听，并清理仅服务于该 Popup 的 CSS；不得通过隐藏按钮、保留死代码或把导出放入另一个 Popup 来规避。通用 Popup 基础设施以及其它仍在使用的弹窗必须保留。
3. 新增或整合一个设置页内明确的“导出调试信息（TXT）”按钮，点击直接下载，不打开任何 Popup；桌面端与移动端均不溢出。
4. 导出动作必须在点击时读取最新可用诊断数据，至少组合现有完整来源：`debug_metadata`、分析预览、`debug` 业务 DTO、`world_model_live_state`、`history_trace`，并保留嵌套对象/数组。不得从页面显示文本反向拼接，不得加入未被现有安全过滤允许的聊天正文、敏感证据正文或凭据。
5. 继续复用现有安全 Debug DTO 和序列化/采集逻辑；不得修改 Runtime 诊断事件、history trace、Event 编辑性能诊断、Floor Persistence、Tracking Window、Story Time、Event Schema、Character Registry 或 Projection 业务逻辑。
6. 使用 UTF-8 Blob 触发浏览器下载，文件名符合 `ST-BioWeave-Debug-YYYYMMDD-HHMMSS.txt`，时间部分使用文件名安全格式，并在下载后释放 Object URL。
7. 采集、序列化或下载失败时显示清晰错误提示，不创建空文件，不清空既有诊断记录，不使设置页失效；连续点击/连续导出不得累积事件监听。
8. 更新定向 UI/设置测试，覆盖 UI 保留与移除、TXT 下载、完整 DTO/嵌套数据、Event 编辑诊断字段、失败安全、连续导出和移动端布局约束，并保持其它设置项目不变。

## Acceptance criteria

- 设置 HTML 仍包含调试下拉/查看区域与其稳定 action/selector；可切换内容的现有测试继续通过。
- 设置 HTML 不再包含 `open-analysis-debug` 或重复 Popup 入口；设置调试 Popup 专用 DOM、渲染函数、打开/刷新/失效逻辑、事件监听及无用 CSS 均不存在。通用 Popup 代码仍可被其它功能使用。
- 设置 HTML 包含唯一明确的 TXT 导出按钮，使用现有设置按钮样式与响应式布局。
- 点击导出从当前 Runtime/诊断来源生成 `.txt` 下载；Blob 文本为格式化 JSON，包含 `debug_metadata`、`world_model_live_state`、`history_trace`、业务 Debug DTO、Floor/Swipe/Version、Persistence 状态、Tracking/Projection 诊断及 Event 编辑 operation/duration/错误阶段字段（在来源存在时原样保留）。
- 下载失败不会调用下载链接或产生空文件；第二次导出仍可成功且不增加监听器数量。
- `node --check`、定向设置/调试/Event 编辑测试、`npm test`、`npm run check`、`git diff --check` 与 `git status` 结果被记录，并区分既有失败与新增回归。
- 真实 SillyTavern 宿主中的桌面/移动端下载与 Popup 完整移除仍需明确标注为已验证或未证明。

## Out of scope

- 不重构 Runtime Diagnostics 或建立新的跨层诊断事实源。
- 不改变 Debug 安全字段过滤规则、不加入聊天正文或敏感证据正文。
- 不修改其它设置项、其它 Popup、业务计算、持久化、Tracking、Projection 或 Event Schema。
