# 技术设计

## 变更边界

当前最小行为缺口不是业务判定缺失，而是自动链路的执行事实没有被统一关联：现有 `business_debug` 只能展示当前解析状态，现有 `history_trace` 虽然有宿主/调度/Projection 事件，却没有统一 `run_id`，也不能在 Timing/聚合为空时区分未调用、条件阻断、执行失败、持久化失败和 readback 失败。

这些事实实际分布在既有 owner 中：自动调度在 `runtime/event-analysis.js`，Projection/TIming/Aggregation 组合在 `runtime/events.js` 与 `runtime/projection-runtime.js`，有限 Trace Buffer 在 `runtime/diagnostics.js`，Debug 导出在 `ui/app.js`，Debug UI 在 `ui/settings.js`。因此新增诊断仍由既有 `runtime/diagnostics.js` 作为唯一瞬时诊断 owner；不创建 Chat 级业务状态、不创建第二套 Tracking/Timing/Aggregation 判定器。

明确不做：不改变任何业务 eligibility/trigger、Exposure 规则、时间阈值、窗口生命周期、成员筛选、Projection Prompt/AI、Floor/Swipe 权威模型和 NSFW Lock 语义；不增加自动补偿、强制聚合或额外 AI/持久化业务调用。

## 诊断数据模型

`createRuntimeDiagnostics` 增加有限容量的瞬时 pipeline run/stage 缓冲，并继续保留原有 `persistenceTrace` 与生命周期 Trace。每次真正开始自动分析或 Projection 自动执行时创建 `run_id`；调度被跳过的记录保留 `run_id: null`，因为它不是一次真实业务执行。分析成功后的 Projection post-processor 复用同一个 ID；没有分析前置的 Story Time Projection 入口自行创建一次 run。

每条结构化 stage 记录包含：

`stage`、`execution_status`、`reason_code`、`invoked`、`started_at`、`completed_at`、`duration_ms`、`input_count`、`output_count`、`error_code`、`run_id`、`chat_id`、`subject_id`、`cycle_id`、`floor_version`、`source_type`。禁止把完整 Event 或 NSFW 原文复制到新区域。

导出明确分成三类：

- `CURRENT_STATE`：从当前有效 Floor/active Swipe 读取的业务数量、Tracking Window、Timing/Aggregation/Projection 当前记录。
- `EXECUTION_TRACE`：真实由 scheduler、Timing/Aggregation/Projection 边界记录的 run/stage。
- `DERIVED_DIAGNOSTIC`：由当前状态与可见执行图推导的“未到达/无法确定”说明；不可冒充历史调用事实。

`diagnostic_metadata` 记录 schema 版本、采集时间、采集状态、Trace Buffer 状态、是否发生覆盖、当前 `run_id` 和当前六字段 Floor Version。

## 实际阶段映射

不重排业务调用，只在真实边界记录以下阶段：

| 逻辑阶段 | 真实 owner/证据 |
| --- | --- |
| Pipeline Scheduling | `scheduleRenderedCharacter` 的 interval/skip/analysis 入口与现有 `AUTO_SCHEDULER_*` Trace |
| Event Snapshot Resolution | Projection `collectInputs` 得到的当前 Floor Event 快照及其 Floor Version |
| Exposure Classification | 现有有效 Event/Tracking Window 输入计数；不复制分类规则 |
| Tracking Window Resolution | Tracking Registry/Projection 输入中的当前 Window 快照，复用现有窗口 Trace |
| Timing Configuration Resolution | `resolvePreConfirmationTiming` 的实际 config/baseline 解析结果 |
| Timing Instance Creation | `resolveProjectionTimingInstance` 实际调用、已有实例跳过和异常 |
| Timing Eligibility Evaluation | `evaluateProjectionTiming`/现有 Timing runtime 结果 |
| Aggregation Eligibility Evaluation | `resolveParticipantAggregationTrigger` 的实际结果 |
| Participant Aggregation Execution | `appendParticipantAggregation` 实际调用 |
| Aggregation Persistence | `participantAggregationPersistence.appendAggregation` 的实际结果 |
| Aggregation Readback | 现有权威 aggregation 读取及成功持久化后的只读 readback |
| Projection Eligibility | `evaluateProjectionEligibility` 的实际结果与既有 status Trace |
| Projection AI Scheduling | 既有 AI Plan/Request status；诊断不发起请求 |
| Projection Persistence | 既有 Projection save 与 `PROJECTION_READBACK` |

World Model `projection_rules` 为空只记录为实际规则输入不可用/对应候选未进入规则绑定阶段；不能直接写成聚合失败根因。`aggregation_due` 只来自 `resolveParticipantAggregationTrigger` 或权威成功记录；缺少 Timing Instance 时为 unavailable。

## 运行关联与 fail-open

- 自动 scheduler 在真正调用共享 Analysis Execution Port 前创建 run，并将 ID 沿 `analysisExecutionPort`、analysis execution、Projection post-processor 传递。
- Projection `process` 接受可选 run ID；没有上游 ID 时在实际 process 开始处创建。
- `runtime/diagnostics.js` 的 recorder 所有写入都捕获异常；诊断异常只设置一次安全的诊断错误元数据，不递归写 Trace。
- 原有 Trace 追加改为有限容量 append；发生覆盖时输出 `trace_truncated`，并保持原有去重/summary 行为。
- 诊断 readback 只读，不参与业务分支，不改变持久化事务顺序；readback 失败只生成 `READBACK_FAILED`。

## Debug 导出与 UI

`runtime.collectActiveBusinessData({includeDebug:true})` 保留原有 `business_debug`/`lifecycle_runtime`，额外提供四个结构化区域。`ui/app.js` 的既有导出函数增加可选参数并输出新区域；旧字段与旧格式继续存在。

`ui/settings.js` 在既有 Lifecycle Runtime Debug 卡片中增加简洁的 Pipeline 总览，并展示 timing/aggregation 诊断记录；UI 只格式化 DTO，不自行执行资格判定。

## 兼容与验证策略

无长期存储迁移：诊断是 Runtime 内存/导出快照。旧数据没有新诊断记录时显示 `TRACE_UNAVAILABLE`/`UNKNOWN`，不补写伪造历史。

测试分为：诊断 recorder/status/buffer 单元测试、实际 Timing/Aggregation/Projection 边界测试、导出/UI DTO 测试、Floor/Swipe/run 隔离测试和 fail-open 业务等价性测试。真实 SillyTavern 事件注册、宿主 Promise 等待和浏览器 UI 仍列为 HOST_ONLY。
