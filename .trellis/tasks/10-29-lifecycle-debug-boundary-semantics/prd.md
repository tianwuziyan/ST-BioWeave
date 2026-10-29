# 修正生命周期 Debug 边界语义

## Goal

让 Debug 能准确区分生产宿主监听器立即返回、Runtime 内部队列等待、Projection
Context 后台刷新和 Runtime 初始化耗时，避免再次依据错误字段把内部等待误判为
SillyTavern 宿主阻塞。

## Background

- 生产 `runtime/sillytavern-adapter.js` 已将生命周期监听器包装为
  fire-and-forget，并始终向宿主返回 `undefined`。
- `runtime/events.js` 仍通过 `lifecycleTail` 等待 Runtime 内部工作；该可等待
  Promise 只属于 Runtime/legacy seam。
- 当前 Debug 仍写入 `listener_resolve_policy: "awaited"`、
  `settled_before_listener_resolve`、`context_ready_before_prompt_read`，并在汇总中
  输出 `projection_refresh_awaited` 与 `context_ready_before_listener_resolve`。
  这些名称把内部完成顺序错误描述成宿主等待或 prompt 已读取。
- 当前 `HOST_EVENT_FORWARD_RESULT` 只说明 Runtime handler 的后续处理结果，不能
  证明生产 adapter 已立即返回；`runtime.init()` 也缺少分阶段耗时诊断。

## Requirements

- R1：生产 adapter 在调用生命周期 handler 后立即记录安全、只读的
  `HOST_LIFECYCLE_LISTENER_RETURNED` 诊断，包含事件键、返回策略、handler 是否
  返回 Promise、同步投递结果和监听器同步耗时；无正文、Prompt、API 响应或密钥。
- R2：Runtime 的 generation Projection Context trace 只描述内部队列语义，使用
  `runtime_work_wait_policy`、`runtime_work_settled`、
  `context_ready_at_runtime_settle` 和内部耗时，不再输出暗示宿主等待的旧字段。
- R3：Debug summary 明确拆分 `host_boundary` 与 `runtime_boundary`；不得从 Runtime
  settle 字段推导宿主是否等待。
- R4：`runtime.init()` 记录开始、主要阶段完成/失败和总完成状态及耗时，至少区分
  Chat/owner 准备、生命周期快照与 scheduler、Projection Context、Tracking Registry、
  lifecycle recovery。保持每个阶段原有 fail-open/fail-closed 行为。
- R5：诊断必须 fail-open；记录器或 trace callback 失败不得改变 listener 返回值、
  Runtime 初始化结果、生命周期排序、API 调度或 Floor persistence。
- R6：移除本次替代的旧 Debug 字段、allowlist、summary 映射、测试断言和文档语义；
  不保留会继续造成歧义的兼容别名。
- R7：同步相关架构、开发和 lifecycle Debug 文档，只记录实际实现。
- R8：删除或替换当前 Projection 目标 Floor 时，已经启动的旧任务若在 owner/version
  守卫处得到 `STALE_FLOOR_VERSION`，必须按“旧任务被替代/取消”结束，不得写成
  Projection 业务失败或把悬浮入口置为错误；删除后的读取仍由当前 Chat 向前最近的
  合法 Character Floor 重建，不允许旧任务转写该 Floor。

## Constraints

- 不新增持久化字段、Chat/Floor/Swipe 数据、Runtime 业务状态或第二事实源。
- 不改变 `GENERATION_STARTED`、`lifecycleTail`、generation gate、Projection Context、
  API 或 Floor 写入/readback；仅允许 R8 将明确的 stale owner 终态从错误改为中性取消。
- 不读取或输出完整正文、Prompt、API body、response、Secret 或其它敏感内容。
- 保留现有 dirty worktree 中与本任务无关的修改。

## Acceptance Criteria

- [x] AC1：生产 adapter handler 返回未完成 Promise 时，宿主 listener 仍同步返回
  `undefined`，并记录 `host_listener_return_policy: "fire_and_forget"`、
  `handler_returned_promise: true` 与有限耗时。
- [x] AC2：handler 同步抛错或异步 rejection 时，宿主边界仍 fail-open；诊断能区分
  同步投递失败与后台 Runtime 失败，不产生 unhandled rejection。
- [x] AC3：generation Projection refresh trace 和 summary 不再出现
  `listener_resolve_policy`、`settled_before_listener_resolve`、
  `context_ready_before_prompt_read`、`projection_refresh_awaited`、
  `context_ready_before_listener_resolve`。
- [x] AC4：Runtime 内部 trace 能确认 queued/settled、Context 是否在内部 settle 时
  ready、内部耗时和失败结果，同时明确 host boundary 为 fire-and-forget。
- [x] AC5：Runtime init 的成功、fail-open 阶段失败和终止性失败均有阶段/总耗时记录，
  且原返回值、抛错与初始化顺序不变。
- [x] AC6：定向 Runtime/Diagnostics 测试与完整 `npm run check` 通过；
  `git diff --check` 通过。
- [x] AC7：相关 Markdown 与最终字段和边界一致；不受影响的文档不做无关修改。
- [x] AC8：回归测试复现“Projection 运行期间目标 Floor 被删除”时，结果为取消/被替代，
  `PROJECTION_PROCESS_FAILED` 和 activity error 均不出现；随后业务读取仍来自最近合法
  Character Floor，真正的 Projection 读回/持久化错误仍保持失败。

## Out of Scope

- 优化 `runtime.init()`、`runLifecycleRecovery()` 或 Projection 的实际性能。
- 修改 SillyTavern 事件顺序、等待机制或生成时机。
- 新建 Debug UI、图表、持久化日志或远程遥测。
- 清理本任务之外的旧 diagnostics、历史任务或工作区修改。
