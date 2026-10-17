# Context-first 修改后 UI 与保存变慢诊断

## Goal

诊断 Context-first Floor 持久化改动后，角色页面打开、页面切换和手动保存推演周期变慢的根因。必须区分：

1. 插件内部业务状态重建；
2. Aggregation 重评估；
3. Coordinator 的 Floor 身份/版本保护；
4. SillyTavern 原生保存与官方 readback；
5. UI 同步等待与后台刷新。

## Requirements

- 以当前工作区源码和真实宿主 Debug 为准，不凭请求数量推断根因。
- 读取 `/Users/ll/Downloads/ST-BioWeave-Debug-20261017-203027.txt`，保留原始证据与脱敏边界，不输出聊天正文或完整身份信息。
- 核对 `runtime/events.js`、`runtime/event-analysis.js`、`runtime/projection-context.js`、`runtime/tracking-runtime.js`、`storage/participant-aggregation.js`、`storage/floor-persistence-coordinator.js`、`storage/store.js` 和 `ui/app.js` 的实际调用链。
- 明确哪些慢点已经由日志测量，哪些只是源码推导，哪些仍未验证。
- 先完成只读诊断与可回放的基线断言；Execute 阶段实施本任务收敛的单角色 Aggregation 输入优化，并修复已确认的 Timing popup 整页重渲染问题。
- 不删除 Aggregation 重评估，不合并 Timing/Aggregation 事务，不放宽 Chat/Floor/Swipe/epoch/版本保护。
- 一次用户操作只修改一个目标角色；同一 Floor 中其他角色的 Aggregation 只允许原样继承和保留，不重新计算。
- 保留 Timing 成功、Aggregation 失败的部分成功语义：Timing 必须先完成独立确认，Aggregation 失败不得回滚已确认的 Timing。
- Aggregation 计算必须只读取当前目标角色需要的 Event、Tracking Window、Story Time、已有 Aggregation 和已确认 Timing，不调用完整 Character Business DTO 重建作为默认路径。
- 如需提出优化，只能作为设计候选；必须写清失效条件、并发风险、回退方式和所需测试。

## Acceptance Criteria

- [x] 证明当前 no-op 保存是否在没有官方 GET/SAVE 时仍然存在主要耗时。
- [x] 区分同步路由渲染耗时与其后异步 business refresh / projection refresh 耗时。
- [x] 给出 Timing 保存、Aggregation 重评估和 canonical business rebuild 的源码调用链与行号。
- [x] 给出重复 canonical/tracking/projection 构建的已测数量和耗时。
- [x] 通过当前测试和最小回归断言确认单角色定向 Aggregation 不会改变其他 Aggregation 记录，且保留现有 Floor/Swipe/epoch/版本保护和部分成功路径。
- [x] 证明 Timing 保存路径不再为单个角色调用完整 `collectActiveBusinessData()` 作为 Aggregation 输入的默认实现；测试同时确认手动编辑不新增 `CHARACTER_CANONICAL_PHASES`。
- [x] 已获得 Execute 授权并完成最小生产改动；未修改 Coordinator 事务边界、Snapshot Schema 或业务规则；Timing popup 仅做 UI 局部渲染优化。

## Out of Scope

- 本任务不重新设计或替换 Floor Persistence Coordinator；保留两笔逻辑事务。
- 本任务不实现多人批量编辑，也不把同 Floor 多角色记录误当成并发编辑。
- 本任务不合并 Timing/Aggregation 事务，不删除任一阶段的必要 readback。
- 本任务不引入全局 Floor 缓存；如需复用，只允许单次操作或明确身份范围内的结果传递。
- 本任务不把隔离测试结果当作真实宿主并发保证。
