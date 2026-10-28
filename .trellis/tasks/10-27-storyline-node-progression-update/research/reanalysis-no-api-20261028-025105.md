# Research: 推演页重新读取未发 API 即报错

- Query: 根据 `ST-BioWeave-Debug-20261028-025105.txt` 重建“推演页重新读取 → 没有 API 请求 → 报错”的执行顺序，判断是否由 `forceStorylineReanalysis` 短路、旧状态、read-only 路径或 Floor 保存失败导致。
- Scope: internal
- Date: 2026-10-28

## Findings

### 1. 本次没有进入 Storyline API，不是 API 请求失败

Debug 的手动重新读取运行是：

```text
seq 181  PROJECTION_PROCESS_STARTED       trigger=projection-refresh
seq 182  PROJECTION_TIMING_EVALUATED       重新评估观察窗口
seq 184  PROJECTION_AI_PLAN                ai_call_will_start=false, candidate_count=0
seq 185  FLOOR_TX_CREATED                  owner=projection, projection-timeline-patch
seq 209  BIOWEAVE_FULL_CHAT_SAVE_DISPATCHED
seq 210  FLOOR_HOST_SAVE_BARRIER
seq 211  BIOWEAVE_FULL_CHAT_SAVE_RESOLVED   FLOOR_HOST_SAVE_BARRIER_TIMEOUT, 30001.8ms
seq 212  FLOOR_TX_FAILED                   FLOOR_HOST_SAVE_BARRIER_TIMEOUT
seq 213  PROJECTION_PROCESS_FAILED         FLOOR_HOST_SAVE_BARRIER_TIMEOUT
```

在 `seq 211` 超时后，`runtime/projection-runtime.js` 的 `runExecution()` 在进入
`storylineRuntime.settled()` 之前就抛出了异常；因此这次没有出现
`PROGRESSION_GENERATION`、`API_REQUEST` 或 `API_ROUTE`。也就是说“没有内容发送给 API”
是因为前置的 Projection Floor 保存失败中断了整个流程，不是推进 API 自身返回失败。

### 2. `forceStorylineReanalysis` 没有被逻辑短路，但本次没有机会执行

推演页的 `refreshProjection()` 确实调用：

```js
process({reason: 'projection-refresh', forceStorylineReanalysis: true})
```

`runExecution()` 也会把这个标记传给 `storylineRuntime.settled()`。
在 `runtime/projection-storyline-runtime.js` 中，标记只会使满足以下条件的当前快照重新生成：

- `status === 'selected'`
- `selected_node_status === 'completed'`
- 当前 `progression_event.status === 'active'`

Debug 导出的 `business_debug.storyline` 确实满足这些状态：柳如烟为
`selected`，入口节点为 `completed`，当前推进事件为 `active`。因此如果流程能到达
`storylineRuntime.settled()`，按现有代码应当进入推进 API；这次实际没有到达该调用点。

### 3. “报错状态”来自宿主 Floor 保存屏障超时

本次手动重新读取不是 read-only 路径。它先重新执行 Projection eligibility 和当前
触发快照处理；即使 `seq 184` 表明没有新的普通 Projection API 候选，后续仍创建了
`floor-tx-2`，并走 `host_context` 的完整宿主保存与等待屏障。

关键证据：

- `seq 194`: `ANALYSIS_SAVE_PATH_SELECTED`, `path=official`, `floor_write_transport=host_context`
- `seq 195` / `seq 202`: owner、Chat、message、Swipe 和 Floor 版本均匹配
- `seq 203` / `seq 204`: Projection slot 存在且完成 merge
- `seq 205` / `seq 206`: Host memory slot 已同步，`floor_version_match=true`
- `seq 207` / `seq 209`: 保存已捕获并 dispatch
- `seq 211`: `FLOOR_HOST_SAVE_BARRIER_TIMEOUT`，宿主保存耗时约 30 秒

所以当前错误图标对应的是 `projection-runtime.js` 的失败收口；不是“重新读取按钮没有
设置 force”，也不是当前推进事件被旧快照覆盖。

### 4. 最新快照和触发生理信号仍存在，但持久化屏障阻断了后续更新

Debug 中仍能读到：

- `business_debug.projection_triggered_snapshots` 包含柳如烟（`char_000003`）且有 1 个触发信号；
- `business_debug.storyline.snapshots` 中当前推进事件为“柳如烟深夜翻阅丹泉门医典”，状态为 `active`；
- `business_debug.storyline.execution_trace.summary.latest_api_request` 为 `null`，说明本次导出没有新的推进请求；
- 较早的 `RESPONSE_RECEIPT` 记录为 `same_floor_response_already_consumed`，它是旧的正文消费记录，不能解释本次 API 未调用，因为本次真正的推进调用尚未开始。

### 5. 任务契约要求不能把保存失败当作推进完成

当前任务设计要求：推进 API、parser、Floor persistence 或 readback 失败时保留已选支线
和当前推进状态，并允许后续重试；不能把保存失败误判成完成，也不能清理支线。
因此“绕过保存错误直接显示 API 成功”不是安全修复方向。

## Minimal fix direction

建议先做一个窄修复并补回归测试：

1. 推演页“重新读取/强制重新分析”需要有一条不被无关 Projection 保存阻断的路径。
   在进入 `storylineRuntime.settled()` 前，若本次只是已有触发快照和已选支线的推进重分析，
   不应因为普通 Projection timeline 的无变化/重复保存进入 30 秒宿主保存屏障。
2. 更稳妥的实现是让 `projection-refresh + forceStorylineReanalysis` 先确认当前
   Storyline 的触发快照/推进状态，再执行推进 API；普通 Projection eligibility 和
   生命周期保存失败仍必须保留失败诊断，不得伪造整体成功。
3. 如果暂时不拆分顺序，至少在 `runExecution()` 中为“storyline reanalysis 被前置
   Floor save 阻断”增加明确诊断字段（例如 `STORYLINE_REANALYSIS_BLOCKED_BY_FLOOR_SAVE`），
   避免 Debug 看起来像“没有触发 API”。
4. 保留当前宿主保存超时的 fail-closed 语义；不要把 timeout 改成成功，也不要恢复
   官方 `/api/chats/save` 作为 Projection fallback。先确认本次触发快照是否确实发生了
   无变化却仍创建 `floor-tx-2`，这是最小根因验证点。

## Relevant code patterns

- `runtime/projection-runtime.js:1097-1818`：普通 Projection 保存、触发快照处理完成后，才调用 `storylineRuntime.settled()`；前置保存异常会直接跳到 `PROJECTION_PROCESS_FAILED`。
- `runtime/projection-runtime.js:2150-2165`：`refreshProjection()` 以 `forceStorylineReanalysis: true` 调用完整 `process()`。
- `runtime/projection-storyline-runtime.js:460`：当前 settled 读取当前/上一端点的 Projection Views 和触发快照。
- `runtime/projection-storyline-runtime.js:785-791`：仅当 `forceStorylineReanalysis` 且选中节点已完成、当前 progression event 为 active 时排入生成任务。
- `runtime/projection-storyline-runtime.js:300-399`：推进生成函数负责构建消息、调用 API、解析并持久化；本次 Debug 中没有进入这些阶段。
- `storage/projection.js:392-395`：Projection Views 从当前合法 Floor/Swipe timeline 解析；它不是另一个 Chat 级事实源。
- `runtime/projection-runtime.js:1812-1822`：`storylineRuntime.settled()` 位于普通 Projection 持久化和触发快照处理之后。

## Caveats / Not Found

- 当前 Debug 的 `history_trace` 没有记录 `STORYLINE_REANALYSIS_BLOCKED_BY_FLOOR_SAVE`，因此只能由阶段顺序确认“尚未进入 Storyline API”，不能进一步证明 `floor-tx-2` 是由哪一个具体子保存（观察记录、触发快照或其它 Projection timeline patch）创建的。
- `business_debug.storyline` 是导出时的当前业务快照，不能单独证明本次手动重新读取已经成功读回最新 Floor；本次成功/失败以 `FLOOR_HOST_SAVE_BARRIER_TIMEOUT` 为准。
- 本研究未修改生产代码、测试或规格；只写入本研究文件。
