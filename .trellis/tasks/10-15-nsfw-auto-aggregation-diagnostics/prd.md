# ST-BioWeave NSFW 自动聚合诊断系统增强

## Goal

仅增强 NSFW 自动聚合链路的可观测性、结构化 Debug 导出、诊断界面与回归测试，不改变聚合、Tracking、Timing、Projection 或 NSFW Lock 业务规则。

## Requirements

### Scope

本任务只增强 NSFW 自动聚合链路的可观测性、结构化 Debug 导出、既有 Debug UI 展示和自动化测试。不得修改 Exposure 有效性、Tracking Window 生命周期、Timing 到期规则、聚合成员筛选、Projection Eligibility、Projection AI Prompt、Floor-owned Snapshot、Swipe 隔离、Pregnancy Lifecycle 或 NSFW Lock 的业务语义。

### Current evidence to preserve

- 初始审计时 HEAD 为 `a1a8ade469022b344661d02336311b208617865f`，分支为 `fix/world-model-prompt-baseline`，生产工作区无既有修改。
- 现有 Debug 导出由 `ui/app.js::buildDebugExportText` 组装，包含 `debug_metadata`、`business_debug`、`world_model_live_state`、`history_trace` 和 `story_time_debug`。
- 现有业务调试数据由 `runtime/event-analysis.js::buildBusinessDebugData` 采集，生命周期调试由 `runtime/events.js::buildLifecycleDebugData` 采集；二者必须保留。
- 现有历史 Trace 由 `runtime/diagnostics.js` 管理，宿主生命周期、自动调度、Tracking、Projection Timing、Aggregation 和 Projection 过程已经有部分事件，新增诊断应复用这些事件并补足真实调用边界。
- 实际自动链路为宿主生命周期事件 → `runtime/events.js::handleLifecycleEvent` → `runtime/event-analysis.js` 的 generation/scheduler/analysis 执行 → Tracking 刷新 → `runtime/projection-runtime.js::process` → `runtime/events.js::resolvePreConfirmationTiming` → Timing/Aggregation 持久化 → Projection Eligibility/AI/Projection 持久化与 readback。
- `projection_rules` 为空时，当前源码会使 `resolvePreConfirmationTiming` 的 Timing 创建循环没有候选输入；这只是待验证的执行事实，不能直接推断为聚合失败根因。

### Required diagnostic output

在现有 Debug 数据中增加独立且有限容量的结构化区域：

- `diagnostic_metadata`
- `nsfw_pipeline_diagnostics`
- `timing_diagnostics`
- `aggregation_diagnostics`

诊断记录必须区分 `CURRENT_STATE`、`EXECUTION_TRACE` 和 `DERIVED_DIAGNOSTIC`。执行状态使用语义清晰的 `NOT_INVOKED`、`SKIPPED`、`BLOCKED`、`ATTEMPTED`、`FAILED`、`PERSIST_FAILED`、`SUCCEEDED`、`READBACK_FAILED`；`NOT_INVOKED` 不得冒充 `SKIPPED`，`BLOCKED` 不得冒充 `FAILED`。

Pipeline 阶段按实际调用关系映射以下逻辑阶段：Pipeline Scheduling、Event Snapshot Resolution、Exposure Classification、Tracking Window Resolution、Timing Configuration Resolution、Timing Instance Creation、Timing Eligibility Evaluation、Aggregation Eligibility Evaluation、Participant Aggregation Execution、Aggregation Persistence、Aggregation Readback、Projection Eligibility、Projection AI Scheduling、Projection Persistence。每条记录尽量包含 `stage`、`execution_status`、`reason_code`、`invoked`、起止时间、耗时、输入/输出数量、错误码、`run_id`、`subject_id`、`cycle_id`、`floor_version`；无真实来源的字段必须为 `null`。

Timing 诊断按 `subject_id`、`mechanism_key`、`cycle_id` 输出有效 Tracking 人物的窗口、Exposure、Story Time、配置、实例和聚合判定信息。`elapsed_story_days` 必须使用项目既有 Story Time 比较机制；无法比较时输出 `story_time_unresolved` 及具体原因；不得自行实现另一套到期判定。

Aggregation 诊断按候选周期解释有效 Exposure、Tracking Window、Timing Instance、Eligibility、聚合调用、结果、持久化、readback、Floor/Swipe 解析和幂等性阻断。`aggregation_due` 必须来自真实聚合判定；没有判定来源时必须标记 unavailable，而不是推导业务资格。

自动调度诊断必须覆盖插件启用、入口注册、触发事件、Floor 条件、配置跳过、运行中去重、已有任务去重、Floor Version 变化、异步异常、未等待 Promise 和静默 catch（仅在源码有证据时记录）。必须明确区分聚合能力开关与聚合成功后的周期锁定能力，尤其是 `PARTICIPANT_AGGREGATION_LOCK_DISABLED` 和 `test_or_isolated_capability` 的真实范围。

每次真实自动执行使用有限范围的 `run_id`，尽可能关联 Event、Tracking、Timing、Aggregation、Projection，同时保留 `chat_id`、`floor_version`、`subject_id`、`cycle_id`、`event_id`、`aggregation_id`。不得用旧执行记录冒充当前 Floor 或 Swipe 的执行结果；Trace 被环形缓冲区覆盖时必须输出 `trace_truncated`。

### Safety and non-functional constraints

- 诊断不得触发额外 AI 请求、聚合、Timing Instance、Tracking Window 或 Projection，不改变持久化事务顺序，也不引入长期业务状态。
- 优先复用现有 Trace Buffer；新增缓存必须有限容量，不能重复保存完整 Event 或 NSFW 原文，不能绕过敏感内容过滤。
- 诊断采集失败必须 fail-open，不得破坏业务流程；诊断失败本身应在可用范围内留下非递归错误状态。
- Debug UI 直接消费结构化诊断数据，不自行重算业务资格，不修改普通用户界面。
- 保留所有现有 Debug 导出字段和现有 Trace 内容。
- 不提交、不推送、不切换分支、不覆盖用户既有工作区修改。

## Acceptance Criteria

- [ ] 在真实自动链路的实际边界生成可关联、有限容量的结构化诊断，不改变业务输出。
- [ ] 导出能够区分当前业务状态、真实执行 Trace 和推导诊断，并对未调用、跳过、阻断、失败、持久化失败、readback 失败和成功使用不同状态。
- [ ] 对有效 Tracking 人物输出 Timing 诊断；缺少实例、配置、可比较 Story Time 时分别给出可验证原因，不伪造时间区间。
- [ ] 对候选聚合周期输出 Aggregation 诊断；聚合数量为零时尽可能给出真实阻断原因，无法确定时输出 `UNKNOWN` 或 `TRACE_UNAVAILABLE`。
- [ ] Debug 导出保留旧字段；Debug UI（若现有架构适合）显示当前执行状态、阻断阶段/原因、Tracking/Timing/Aggregation 数量和最近聚合尝试，并支持人物级 Tracking/Timing/Aggregation 展开。
- [ ] 自动化测试覆盖正常链路、World Model Rules 缺失、Timing Instance 缺失、Story Time 不可比较、聚合持久化失败、Floor Version 变化、Swipe 切换、插件重新启用、诊断异常 fail-open、诊断开关业务等价性；不得为测试伪造聚合结果或修改业务规则。
- [ ] 执行相关测试、静态检查和 Diff 审查；不执行 Git Commit、Push 或分支切换。
- [ ] 最终报告包含修改文件、诊断结构、实际调用路径、按 `CONFIRMED`/`INFERRED`/`NOT_TESTED`/`HOST_ONLY` 分类的问题、测试结果、SillyTavern 宿主验证步骤和剩余风险。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
