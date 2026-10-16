# 实施计划

## 文件边界

预计修改以下文件；若实现过程中发现不需要的文件，保持未修改：

- `runtime/diagnostics.js`：共享诊断 owner；增加 run/stage recorder、状态字段、bounded buffer、metadata 和安全 sanitizer。
- `runtime/runtime.js`：允许 feature composition 复用外层已有 Runtime diagnostics 实例，避免第二套 Trace owner。
- `runtime/analysis-execution.js`：透传可选 pipeline `run_id`，不改变共享执行端口行为。
- `runtime/event-analysis.js`：在实际 automatic scheduler/analysis 边界创建和透传 run，并补充 scheduling/snapshot/tracking 关联字段。
- `runtime/projection-runtime.js`：在实际 Projection process、eligibility、AI status、persistence/readback 边界记录 run/stage，并复用上游 run。
- `runtime/events.js`：在真实 Timing/Aggregation 解析与持久化边界记录诊断；从现有权威 current state/readback 构建 timing/aggregation DTO；暴露 debug 结构。
- `ui/app.js`：保留旧 Debug 导出字段并加入新诊断区域。
- `ui/settings.js`：复用现有 Debug/Lifecycle Runtime 区域展示结构化诊断。
- `tests/diagnostics.test.js`：recorder、状态语义、buffer 截断、run/floor 隔离和 fail-open 测试。
- `tests/event-analysis-runtime.test.js`、`tests/projection-runtime.test.js`：自动链路和实际边界的 run/stage 回归。
- `tests/ui.test.js`：导出字段和 UI 消费 DTO 回归。
- 视实际公开架构变化同步 `docs/ARCHITECTURE.md`；不为临时调试输出新增重复 Markdown。

## 执行顺序

1. 先记录当前工作区状态并逐段检查上述文件的精确上下文；禁止覆盖已有用户修改。
2. 在 `runtime/diagnostics.js` 增加 recorder 和有限容量 helper，先运行 diagnostics 现有测试。
3. 复用同一 recorder 接入 automatic scheduler、analysis execution 和 Projection process，补充失败/取消/stale/floor version 关联。
4. 接入 `resolvePreConfirmationTiming` 的 config、Timing、trigger、Aggregation、persistence 和 readback 诊断；所有诊断调用 fail-open。
5. 基于当前有效 Floor/Swipe 和既有 `evaluateProjectionTiming`、`resolveParticipantAggregationTrigger` 生成人物级 Timing/Aggregation DTO；不创建新业务判定。
6. 扩展 `collectActiveBusinessData({includeDebug:true})`、导出和 Debug UI，保持旧 DTO/字段不变。
7. 先执行 `node --check` 与定向测试，再执行完整 `npm run check`。
8. 用实际 Diff 检查业务规则文件是否只增加可观测性边界；单独检查新增字段无完整 Event/NSFW 原文、无额外 AI/聚合/Timing 业务调用。
9. 运行 Trellis quality check；最终不 commit、push、switch branch，保留工作区修改供用户审查。

## 验证矩阵

| 场景 | 预期诊断证据 |
| --- | --- |
| 有效 Exposure → Tracking → Timing → Aggregation | 同一 run 的阶段链，成功/持久化/readback 完整 |
| `projection_rules=[]` | 记录规则输入不可用和未进入绑定候选；不声称 Aggregation 已失败 |
| Tracking 有、Timing 无 | `TIMING_INSTANCE_MISSING`/实际 config 或规则阻断；区分 NOT_INVOKED、BLOCKED、FAILED、READBACK_FAILED |
| Story Time 不可比较 | `elapsed_story_days=null`、`story_time_unresolved`，不使用 JS Date |
| Aggregation save 失败 | 计算/执行成功后记录 `PERSIST_FAILED`，不制造成功记录 |
| Floor Version / Swipe 变化 | 新 run/current state 隔离，旧 run 不冒充当前结果 |
| 插件禁用/重新启用 | 业务启用状态与周期锁 capability 分开展示；会话 Trace 不伪造为持久化状态 |
| 诊断 recorder 抛错 | 业务结果、AI 调用和持久化顺序保持不变，诊断只出现安全错误状态 |

## 停止条件

如果当前实现只能在没有执行事实的情况下推导某个原因，则输出 `UNKNOWN` 或 `TRACE_UNAVAILABLE`，不新增业务判断。若 UI 改动会触及普通用户页面或现有 UI contract，则只完成 Debug 导出并在最终报告说明。
