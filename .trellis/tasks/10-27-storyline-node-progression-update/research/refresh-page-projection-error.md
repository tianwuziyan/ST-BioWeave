# Research: 刷新网页后 Projection 自动运行并报错

- Query: 诊断 `ST-BioWeave-Debug-20261028-023045.txt` 中“刷新网页后进入即触发插件运作并报错”的原因，区分 UI read-only refresh、CHAT_CHANGED、Generation 生命周期、Projection/Storyline API 与 Floor 写入。
- Scope: internal
- Date: 2026-10-28

## Findings

### 1. 初始网页刷新本身是只读初始化，不是直接发起 Projection API

Debug 的前段顺序为：

1. `CHARACTER_UI_REFRESH_REQUESTED` / `CHARACTER_UI_REFRESH_BEGIN`，`request_source=ui-read`；
2. `RELOAD_FLOOR_SLOT_AUDIT`，`reason=runtime-init`，但当时没有可用消息，`resolution_reason=MESSAGE_NOT_FOUND`；
3. `PROJECTION_CONTEXT_REFRESH_STARTED` 后执行 `PROJECTION_CONTEXT_SLOT_CLEARED`，`clear_reason=no_chat`；
4. `NSFW_LIFECYCLE_RECOVERY` 记录 `DEFERRED_CONTEXT_NOT_READY` / `MESSAGE_NOT_FOUND`。

这段没有 `API_REQUEST`、Storyline 请求或 Floor 写入。对应实现中，`runtime/events.js:6020-6068` 的 `init()` 只做宿主上下文、Floor、生命周期快照、Projection context 和 tracking registry 初始化，最后调用 recovery；没有在 UI read 路径直接调用 `projectionRuntime.refreshProjection()`。因此“打开网页就报错”不是 UI 读操作直接写 Floor 的证据。

### 2. 后续确实进入了 Generation 生命周期，并在 settle 后自动进入 Projection

关键历史序列（均来自该 Debug 的 `history_trace.sequence`）：

- `seq 29-35`: 收到 `GENERATION_STARTED`，建立 generation gate，向 Projection context 做只读刷新；
- `seq 36-50`: `GENERATION_PROJECTION_REFRESH_STARTED` 到 `GENERATION_PROJECTION_REFRESH_SETTLED`，结果 `updated`，这是 context 刷新，不是外部 API；
- `seq 51`: 收到 `CHAT_CHANGED`，事件类型为 `chat_id_changed`；
- `seq 55-61`: 初始 generation gate 先因 activity lease 过期而 supersede，随后 deferred event replay 恢复，最终 `GENERATION_SETTLED`，目标为 Floor 108；
- `seq 63-70`: `AUTO_HANDOFF_TO_SCHEDULER` → `AUTO_SCHEDULER_ENTER` → `HEALTH_RECOVERY_CHECK_SCHEDULED` → `PROJECTION_INTERNAL_TRIGGERED`；
- `seq 75`: 启动唯一明确的自动 Projection run，`run_id=nsfw_run_mvr0tgte_1`，`reason=settled-floor:automatic`，`trigger=character-interval`。

当前实现会在 generation settle 后调用 `eventAnalysis.handoffSettledCharacterFloor()`，见 `runtime/events.js:5875-5915`；该 handoff 最终进入 `projectionRuntime.processInternal()`，见 `runtime/events.js:4380` 附近的 settled projection processor。`processInternal()` 的职责是自动处理 settled Floor，而不是 UI read-only 读取。

### 3. 本次自动 Projection 没有调用外部 AI / Storyline API

Debug 的 `automatic_projection_runs[0]` 显示：

- `operation=AUTOMATIC_PROJECTION`；
- `trigger=character-interval`；
- `status=FAILED`；
- `ai_called=false`；
- Eligibility 阶段 `output_count=0`；
- Projection internal route，没有 `API_REQUEST` 或 Storyline response。

因此本次错误不是“第二次 API 请求”或“Storyline API 返回异常”。`runtime/projection-storyline-runtime.js:409-452` 的 `settled()` 只有在 Projection 主流程进入 storyline settle 后才会读当前/上一 endpoint；本次失败发生在更早的 Projection triggered snapshot 持久化阶段，尚未进入可见的 Storyline API 调用。

### 4. 实际失败点是当前 Floor 的宿主 Chat 保存超时

自动 run 在 `seq 84-110` 完成候选复用、生成计划和 Floor transaction：

- `seq 84`: 复用 8 个现有候选；
- `seq 85`: `PROJECTION_AI_PLAN`，但 `ai_call_will_start=false`、`projection_route=internal`；
- `seq 86-107`: 创建并校验 `projection-timeline-patch` Floor transaction，owner 为 `projection`，目标为当前 Chat / Floor 108 / Swipe 0；
- `seq 108-110`: 将 `bioweave` slot 写入宿主内存并 dispatch official `saveChat()`。

随后：

- `seq 117`: `BIOWEAVE_FULL_CHAT_SAVE_RESOLVED`，`commit_state=unknown`，`error_code=FLOOR_HOST_SAVE_TIMEOUT`，`host_chat_save_duration_ms=8002`；
- `seq 118`: `FLOOR_TX_FAILED`；
- `seq 119`: `PROJECTION_PROCESS_FAILED`；
- `seq 120-137`: 失败后的 UI read / context refresh；
- `PROJECTION_READBACK` 也因此失败，最终状态为 partial/failed。

`runtime/projection-runtime.js:1778-1848` 会把 snapshot write/readback 异常向外抛出；Floor host save 的失败由 `runtime/events.js` 的官方 Floor 写入边界记录为 `FLOOR_HOST_SAVE_TIMEOUT`。这与 Floor ownership contract 要求的“通过现有 Floor abstraction 写入、等待宿主保存确认、失败关闭”一致；当前 Debug 不能证明宿主在超时后最终是否实际提交。

### 5. CHAT_CHANGED 与另一个 GENERATION_STARTED 是并发边界信号，不应直接解释为第二次正文/API

`seq 51-54` 的 `CHAT_CHANGED` 之后，当前代码已记录：

- `CHAT_CHANGED_PROJECTION_CANCEL_STARTED`；
- `CHAT_CHANGED_PROJECTION_CANCEL_SETTLED`，`cancellation_status=cancelled`、`cancelled_count=0`；
- 事件转发结果为 `generation-post-processing-deferred`。

这说明该边界发生时没有发现可取消的在途 Projection run。它很可能对应网页/宿主重载或其它插件引发的 Chat 绑定变化，但 Debug 没有记录其它插件的“加载完成”原始通知，不能把它确认为某一个插件。

`seq 111-113` 在 `saveChat()` 已 dispatch 后又出现一次 `GENERATION_STARTED`，但 Debug 没有为它记录 API 请求、正文生成结果或第二个 Projection run；它只建立了第二个 generation gate。由于其后 `seq 159-160` 又出现 lease supersede/expired，不能把这组生命周期信号当成第二次正文生成。它更像宿主/插件重载期间重复或延迟到达的 generation lifecycle 信号，至少当前证据不足以证明用户发起了第二次生成。

### 6. 根因分层

- 已确认事实：网页初始化先执行只读 UI/context 路径；之后存在一个 generation settle → automatic Projection 流程；该流程没有调用外部 AI，最终在 Floor host save 等待 8 秒后失败。
- 高可信推测：刷新网页/其它插件“加载完成”改变了宿主 lifecycle 时序，使自动 Projection 的 `saveChat()` 与宿主 Chat/generation 重载边界重叠或无法及时 resolve；第二个 `GENERATION_STARTED` 是同一边界上的生命周期噪声/延迟事件，而不是用户第二次 API 请求。
- 未验证假设：该次 `saveChat()` 是否在 Promise 超时后最终落盘；“加载完成”通知具体来自哪个插件；宿主是否在当前页面刷新阶段重复派发了 generation start。

## Recommendations

1. 首先不要把 UI `ui-read` 路径或 Storyline API 当成根因；应针对 `runtime-init / generation settle / automatic character-interval` 的自动 handoff 做边界保护。
2. 在真实宿主中补采一轮带时间戳的事件：网页刷新、其它插件“加载完成”、`CHAT_CHANGED`、`GENERATION_STARTED/ENDED`、`saveChat()` dispatch/resolve。重点确认 `GENERATION_STARTED` 是否由宿主真实发出，以及它是否发生在 Projection host save 未 resolve 时。
3. 让自动 Projection 在“页面/Chat 重载边界仍未稳定”时延迟或放弃本轮 Floor 写入；不能把仅有 `saveChat()` Promise 超时当成成功，也不能立即再次提交同一 Floor transaction。
4. 保留当前 `CHAT_CHANGED` 的取消/排空边界，但需要测试它与已经进入 host save 的 Projection run 的关系：当前 `cancelStoryline()` 返回 `cancelled_count=0`，且不会自动取消已进入 `saveChat()` 的 Floor transaction。
5. 加回归测试覆盖：
   - runtime init 无消息时只读且不触发 Projection/Floor write；
   - generation settle 触发一次 automatic Projection，但不重复调用外部 API；
   - `CHAT_CHANGED`/页面重载与 host save 并发时，旧 run 不得再次写入或把旧错误覆盖新状态；
   - host save timeout 后不能产生第二次隐式 retry，UI 应明确展示失败/待确认状态。

## Related specs

- `.trellis/spec/domain/floor-state.md`: Floor owner、当前有效 Floor/Swipe、Projection complete snapshot 与 API context 边界。
- `docs/bioweave-data-lifecycle.md`: 持久字段生命周期、异步 stale-result 与 persistence failure 约束。
- `docs/ARCHITECTURE.md`: runtime / Floor persistence / Projection lifecycle 的职责边界。

## Caveats / Not Found

- Debug 导出时间为 `2026-10-27T18:30:45.107Z`，文件名中的本地日期为次日凌晨；分析按导出内容时间线，不把文件名作为事件时间。
- Debug 没有记录其它插件的原始通知文本，也没有宿主 `saveChat()` 的最终回调/落盘确认，因此无法仅凭此文件证明“加载完成”通知与 `CHAT_CHANGED` 的一一对应关系。
- 本研究未修改生产代码、测试或规格文件；只新增了本 research 记录。
