# Design: 生命周期 Debug 边界语义

## 1. Boundary

```text
SillyTavern eventSource
  -> production adapter listener             [host_boundary]
     -> handler(payload) + rejection sink
     -> return undefined immediately
  -> runtime handleLifecycleEvent            [runtime_boundary]
     -> lifecycleTail queue
     -> Projection Context refresh

runtime.init                              [initialization_boundary]
  -> owner/snapshot/scheduler/context/tracking/recovery phases
```

本任务只观察这三个边界，不移动业务职责。生产 adapter 是宿主返回策略的唯一
证据 owner；`runtime/events.js` 是内部队列与初始化阶段的证据 owner；
`runtime/diagnostics.js` 只做安全汇总，不重新推断业务状态。

## 2. Trace Contract

### Host boundary

`subscribeLifecycle({eventTypes, handlers, trace?})` 接受可选 fail-open trace callback。
listener 调用 handler、为 Promise 安装 rejection sink，然后在返回 `undefined` 前记录：

```js
{
  stage: "HOST_LIFECYCLE_LISTENER_RETURNED",
  host_event_key,
  host_event_type,
  generation_id,
  generation_intent_id,
  generation_type,
  host_listener_return_policy: "fire_and_forget",
  handler_returned_promise,
  dispatch_status: "accepted" | "sync_failed",
  host_listener_return_duration_ms,
  error_code: null | string,
}
```

trace callback 抛错必须吞掉；异步 handler rejection 继续走既有 error sink，不改变
宿主返回值，并额外记录 `HOST_LIFECYCLE_HANDLER_REJECTED`（仅事件键、类型和安全
错误码），不能把它并入 listener returned 事件。

### Runtime boundary

`GENERATION_PROJECTION_REFRESH_STARTED/SETTLED` 保留 stage 名以便关联历史阅读，
替换歧义字段：

```js
{
  runtime_work_wait_policy: "lifecycle_tail",
  runtime_work_settled: true,
  context_ready_at_runtime_settle: boolean,
  runtime_work_duration_ms: number,
}
```

summary 分为：

```js
generation: {
  host_boundary: {...latest host listener return evidence},
  runtime_boundary: {...latest generation Projection refresh evidence},
}
```

summary 只投影已有 trace，不通过时间顺序猜测宿主行为。

### Initialization boundary

`runtime.init()` 使用小型 fail-open 计时 helper 包装既有阶段，记录：

- `RUNTIME_INIT_STARTED`
- `RUNTIME_INIT_PHASE_SETTLED`
- `RUNTIME_INIT_SETTLED`

每轮使用 Runtime 内计数生成 `init_run_id`，字段仅含 `init_run_id`、`phase`、`status`、
`duration_ms`、`error_code`；summary 只投影最新 `RUNTIME_INIT_SETTLED` 对应轮次。
helper 对错误只记录后原样抛回；原有调用点的 try/catch 继续决定 fail-open/fail-closed，
避免诊断改变行为。

## 3. Compatibility and Cleanup

旧字段只存在于进程内 Debug trace/TXT 导出，不是持久化 schema，也没有生产读取方。
因此直接停止生成并清理 allowlist、summary、测试和文档引用，不保留 alias。历史导出
文件保持可读，但不会被插件重新导入。

## 4. Safety

- 所有 trace callback 均 fail-open。
- 耗时使用现有 monotonic helpers。
- 只记录枚举、布尔、有限字符串和毫秒值。
- 不写 Floor、Chat、settings 或 lifecycle registry。
- 不改变 Promise 返回、await 顺序、异常传播或现有重试策略。

## 5. Rollback

实现按文件可独立回滚：adapter trace、Runtime trace、diagnostics summary、tests/docs。
若新 adapter trace 影响监听器返回契约，优先删除该 trace 调用，保留 Runtime 字段重命名；
不得通过恢复旧 `awaited` 字段解决测试失败。

## 6. Deleted Floor supersession

Projection 运行期间，宿主可以先删除或替换目标 Floor，随后才投递 lifecycle event。
此时 Floor transaction 的 `STALE_FLOOR_VERSION` 是 owner 守卫成功拒绝旧任务的证据，
不是 Projection 业务失败：

```text
old Projection target
  -> host deletes/replaces target Floor
  -> persistence owner/version guard returns STALE_FLOOR_VERSION
  -> old Projection run terminates as cancelled/superseded
  -> lifecycle rebuild reads nearest legal surviving Character Floor
```

只允许将明确的 `STALE_FLOOR_VERSION` 收口为 stale-context cancellation；API、解析、
普通 persistence/readback 错误仍走 `PROJECTION_PROCESS_FAILED`。取消分支不得把旧结果
写入回退 Floor，也不得把 activity 终态伪装成成功。
