# 技术设计：Projection 批量生成与保存

## 1. 根因

`runtime/projection-runtime.js` 当前逐条调用 `generateProjectionCandidate()`。每条内置候选在请求前、响应后和保存前重新执行完整输入收集；随后 creation 与 evidence 又分别进入 `storage/projection.js::mutateFloor()`，各自触发 owner/version 解析、Projection 全量视图扫描、Coordinator transaction、Host 保存和 authoritative readback。

## 2. 目标数据流

```text
初始 collectInputs（同一阶段后处理共享）
  -> eligibility
  -> 内存生成全部候选
       - 内置候选：只检查本次 execution 仍 active
       - AI 候选：保留请求前/响应后的完整 stale guard
  -> 批量提交前 currentInputsMatch 一次
  -> Projection Storage 一次规范化、append 和 commitFloorPatch
  -> authoritative readback
  -> 最终 Projection views / Context 刷新
```

阶段成功后的回执观察、超时判断和后续生成共享这份业务快照及 delivery
列表；只有超时关闭确实改变业务状态时才重新读取。AI 候选仍保留其请求前/响应后
失效检查，不能用缓存绕过这条保护。

没有发生生命周期变化时，Runtime 复用已经读到的 Projection views；批量提交后的
最终 views 直接传给 Context 刷新，避免同一结果再次全量读取。

## 2.1 Generation settle gate

ST 的正文生成是 BioWeave 自动计算的前置边界。收到 `GENERATION_STARTED` 后，
只更新 Generation Lifecycle 的 pending 状态，不执行 Projection process、
`tickLifecycleOnly`、Tracking/超时判断、Projection Floor 保存或 Projection
Context 的完整重算。生成期间收到的 `CHAT_CHANGED`、`MESSAGE_RECEIVED` 和其他
计算触发只合并为一个待处理标记；不得在当前生成与 BioWeave 保存之间并发竞争。

`GENERATION_ENDED` / `GENERATION_STOPPED` / `GENERATION_CANCELLED` 只负责推进
宿主生命周期。待最终 Character 消息确认（或停止/取消已明确没有最终消息）后，
再按当前 Chat、active Swipe 和完整 Floor Version 重新读取并执行一次合并后的
自动计算。旧 Chat、旧 Floor 或重复触发必须通过现有 owner/epoch/version guard
丢弃。

生成开始时保留已有的 Projection Context 槽位；若发生 Chat 边界，先清空旧 Chat
上下文，等生成结束后再重建，避免把旧上下文或计算结果写入新生成流程。

## 2.2 Chat boundary 按构画方式拆成“换上下文”和“做业务计算”

构画的可借鉴点不是一个万能的 ST busy flag，而是把 `CHAT_CHANGED` 当成加载/换绑
边界，把 `CHARACTER_MESSAGE_RENDERED` 当成正文稳定后的主要处理入口。BioWeave 采用同一
原则，但保留自己的 Floor owner、active Swipe 和六字段版本保护。

### 进入已有角色卡 / 已有聊天

`CHAT_CHANGED` 只做以下事情：

1. 递增 Chat boundary/epoch，立即取消或失效旧 Chat 的异步结果；
2. 清除旧 Chat 的 `bioweave_projection_context`，防止旧人物/旧聊天继续注入；
3. 绑定当前 Chat、active Swipe 和当前 Floor 读取范围；
4. 在当前 Chat 稳定后延迟合并一次已有结果的恢复和 UI 刷新。

这条路径不调用 `projectionRuntime.process()`，不调用
`projectionRuntime.tickLifecycleOnly()`，不执行 `runLifecycleRecovery()`，不触发
Tracking Window/Projection Lifecycle 的持久化，也不调用 Analyzer。Tracking/Projection
的现有结果只允许作为恢复显示和 Context 的输入，不能因为“打开角色卡”被重新推演或
追加生命周期记录。

延迟恢复使用当前 Chat boundary/epoch 和 Floor Version 做二次确认；如果恢复窗口内收到
`GENERATION_STARTED`、新的 `CHAT_CHANGED` 或当前 Floor 变化，恢复任务直接放弃并交给
生成 settle 或下一次稳定边界处理。这里的延迟只是等待宿主完成聊天切换，不是固定等待
一个假定的 ST 全局 busy 状态。

### ST 正在生成正文

`GENERATION_STARTED` 只推进 `generation-lifecycle`，保留已有 Context，不做完整
`refreshProjectionContext()`。消息、编辑、删除、Swipe 和 Chat 变化只合并为待处理事件；
重复的普通 `GENERATION_STARTED` 复用当前 gate，不能清空 gate，也不能让已暂存事件丢失。

### 正文真正落地

`CHARACTER_MESSAGE_RENDERED` 与 `GENERATION_ENDED` 的先后顺序继续由
`generation-lifecycle` 处理。满足最终 Character Floor 已确认、当前 Chat/Swipe/Floor
Version 仍一致后，统一执行一次：

```text
最终 Floor 读取
  -> 一次业务快照
  -> 生命周期/Tracking/Projection 判断
  -> 批量 Floor 保存
  -> authoritative readback
  -> 一次 Projection Context / UI 刷新
```

如果没有最终 Character Floor（例如明确停止或取消），只清理 pending intent 和待处理
状态，不凭空创建新的业务结果。旧 Chat 的延后事件只记录诊断并丢弃。

### 2.1.1 Quiet-start self-healing lease

Generation gate 不是永久 boolean：普通 `GENERATION_STARTED` 创建约 3000ms
provisional activity lease；宿主提供 `STREAM_TOKEN_RECEIVED` 或匹配的最终
`CHARACTER_MESSAGE_RENDERED` 时确认真实生成并停止 provisional expiry。重复 start
复用 gate，不清空 pending events；终止事件和
`destroy()` 清理 timer。lease callback 同时检查 gate identity 与 generation token。
Real activity disables only the provisional lease. A separate non-renewed hard
watchdog bounds the entire gate; if no terminal event arrives before it expires,
the run is abandoned fail-closed, partial text is never analyzed, and later
render/terminal signals remain quarantined for that abandoned run.

若 start 没有任何 token 或终止信号而 lease 到期，Runtime 只解除自动任务 defer，
并在当前 Chat 仍匹配时重放 deferred `CHAT_CHANGED` 的只读 Context restore；其他
消息/Swipe/业务触发 fail closed，不启动 Analyzer、Projection/Tracking lifecycle、
Context recompute 或 Floor persistence。start/renew/expire/release 原因进入 Debug
trace，不记录正文内容；同时显式取消 event-analysis Generation Lifecycle 的 stale
pending intent，避免后续真实 start 被判为 duplicate pending。该超时恢复不能替代最终
Character Floor 的业务 settle。

### 需要改动的边界

- `runtime/events.js`：区分 Chat rebind 与 post-generation handoff；禁止普通
  `CHAT_CHANGED` 走 lifecycle tick/recovery；跳过生成开始时的完整 Context refresh；
  修正重复 `GENERATION_STARTED` 不得提前释放 gate。
- `runtime/event-analysis.js`：保留 Chat snapshot/owner 重绑能力，但普通
  `CHAT_CHANGED` 不再把 Tracking/Projection 的持久化恢复当作自动业务触发；最终 Floor
  仍从既有 generation handoff 入口进入。
- `runtime/projection-context.js`：如现有 Context 恢复会强制重新收集完整业务数据，增加
  一个只读恢复入口或等价参数，使 Chat rebind 只能使用当前有效 Floor/已持久化 Projection
  View 恢复 Context，不把 Context 恢复误变成业务重算。
- `runtime/generation-lifecycle.js`：只补齐重复 start/settle 的状态测试；不改变
  generation intent、stop/cancel、reroll/Swipe 和最终 Floor 语义。

不修改 `storage/floor-persistence-coordinator.js`、Projection/Tracking 领域规则、
候选文案、UI DTO 或 Floor 所有权。若验证后发现只需调整事件编排，则不新增通用 Busy
Service 或新的跨层缓存。

## 3. Runtime 边界

Runtime 只收集成功生成的 `{projectionCandidate, evidenceRecord}`，不直接构造 `projection_timeline`。内置候选的 `generateRaw` 是本地确定性函数，不跨网络边界，因此逐条完整重读没有额外安全收益；批量写前的一次完整输入比对负责拒绝已经过期的业务快照。AI 候选仍使用现有请求前与响应后检查。

## 4. Storage 边界

`storage/projection.js` 增加 `saveProjectionBatch()`：

- 全部输入先完成 Projection schema、deterministic evidence ID 和完整 Floor Version 校验；
- 只调用一次 `mutateFloor()`；
- 在同一个 normalized timeline 上按输入顺序追加 creation，再追加对应 evidence；
- 新 creation ID 加入本批已知 Projection ID 集合后才验证 evidence；
- 任一 conflict/rejection 终止整批，提交前不产生写入；
- 有变化时只提交一次完整 `projection_timeline` patch；全部精确重复时返回 deduped/no-op。

现有单条保存函数保留为同一批量实现的薄封装，避免维护两套验证和 append 逻辑。

Projection Context delivery 另设 `saveProjectionDeliverySubmissionBatch()` 与
`saveProjectionDeliveryResponseBatch()`，不混入 candidate/evidence batch。两者
均先规范化并验证全部 delivery records，再通过一次 `mutateFloor()` 按输入顺序
追加；submission 使用 `readback_verified`，response 使用 `response_observed` 并
校验当前 response Floor Version。旧单条 delivery API 仅作为单元素 batch 薄封装。

Projection 生命周期记录另设 `saveProjectionLifecycleBatch()`。Runtime 将删除升级记录、事实状态
记录和 lifecycle-only 过期记录分别汇总；同一语义类别只提交一次 owner-scoped timeline patch，
两类记录同时出现时保持为两个批次，避免混淆删除与事实状态。`saveProjectionLifecycle()` 与
`saveEvolutionDecision()` 继续作为单元素兼容封装。该边界只减少 Floor 读取、宿主保存和权威读回，
不改变生命周期判断、状态优先级、Projection DTO 或 append-only 语义。

## 5. Frozen boundary

不修改 `storage/floor-persistence-coordinator.js`。批量 patch 继续使用 Projection owner 已允许的 `projection_timeline` 字段，并由 Coordinator 执行 live owner、active Swipe、Chat、六字段版本、sibling、Host save 和 readback 检查。

## 6. 失败语义

- 单条生成失败：沿用 Runtime 当前 partial/error 记录；仅成功生成项进入待保存批次。
- 批量 schema/conflict/stale/persistence 失败：整批零写入并记录一次持久化失败。
- 批量成功：诊断记录一次 `PROJECTION_PERSISTENCE`，`output_count` 等于实际保存候选数。
- 最终 views/readback 失败：沿用现有失败语义，不伪报成功。
- Context submission 与 completed response 各自先在内存收集全部 records，再各提交一次
  delivery batch；任一条非法或 stale 时整批零写入，精确重复保持 no-op。
- Lifecycle batch 任一条非法、stale、unknown Projection 或 append conflict 时整批零写入；
  精确重复返回 `deduped`，不产生 Host save。
- Generation gate 只改变自动任务的时序，不改变 Generation Lifecycle 的 settled、
  supersede、stop/cancel、Floor Version 和 scheduler 语义；所有待处理原因合并后最多
  触发一次后处理。
- 普通 Chat rebind 只恢复当前有效结果，不创建新的 Projection/Tracking/Lifecycle 事实；
  若需要新增 Context 恢复参数，必须保持只读、当前 Floor 绑定和 stale fail-closed。

## 7. 兼容性

Projection DTO、timeline schema、Floor owner、UI DTO、Context 内容和业务时间段均不变；只改变同一轮内部的读取与提交次数。旧 timeline 无需迁移。
