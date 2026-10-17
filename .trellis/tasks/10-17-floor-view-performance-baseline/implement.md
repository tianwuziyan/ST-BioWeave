# 内部 Floor View 试点 Execute 计划

## 状态

`PLANNING_ONLY`。本文件只定义后续授权后的执行边界；本轮不启动 Execute，不修改生产代码或测试代码。

## 1. Execute 前必须确认的事实

- 生产路径仍由 `createFloorPersistenceCoordinator().commitFloorPatch()` 负责写入和权威保护。
- 当前内部计算没有源码证据表明会直接发起官方 `/api/chats/get`；必须保留 `NO_REDUNDANT_COMPUTE_GET_FOUND`。
- 当前候选只针对操作内本地 owner snapshot clone/scan，不承诺减少官方 GET。
- 任何候选 View 都不能成为 Coordinator 的 latest slot、CAS 或 readback 替代物。
- Timing 与 Aggregation 仍是两笔逻辑事务；Timing 成功、Aggregation 失败仍需返回部分成功。

## 2. 分阶段计划

### Phase 0：冻结基线（只读）

**范围**：任务报告、既有 `timing_performance_diagnostics.recent_operations`、现有源码调用链。

**动作**：

1. 记录普通 Floor no-op/changed 和 Timing + Aggregation no-op/changed 的官方 GET/SAVE 数量。
2. 增加测试侧计数包装器的设计，但不修改生产诊断字段。
3. 将内部 owner snapshot 构造、Floor scan、canonical build、UI DTO 获取列为独立指标。

**通过条件**：每个指标都明确为 `MEASURED`、`SOURCE_VERIFIED` 或 `UNVERIFIED`；不能把测试耗时冒充真实宿主耗时。

**回退**：无生产修改，删除测试侧临时计数即可。

### Phase 1：测试专用 baseline/candidate seam

**拟修改范围**：只允许测试 helper 或新测试文件；不得修改 `storage/store.js`、`storage/projection-timing.js`、`storage/participant-aggregation.js` 的生产实现。

**动作**：

1. 用确定性 fixture 构造当前 Context、message、active Swipe、多个 Floor 和六字段 Floor Version。
2. 运行现有 Timing/Aggregation getter，统计 owner snapshot 构造和本地扫描次数。
3. 在测试 helper 中构造一个不可变候选 View，分别调用等价的纯读模型。
4. 对所有结果做深度和身份字段比较。

**通过条件**：正常、历史继承、显式空集合、多角色、不同 Swipe/Floor 的结果全部一致；否则候选保持 `UNVERIFIED`。

**回退**：删除测试 helper/测试文件，不涉及生产回滚。

### Phase 2：确定性失效测试

使用 Promise barrier，不使用固定 sleep。至少覆盖：

- capture 后 Chat 切换；
- capture 后 Swipe 切换/删除；
- message 正文编辑、删除或 message version/content hash 改变；
- epoch/Floor Version 改变；
- 其他模块在同 Floor 修改不同 Snapshot；
- Timing no-op 但 Exposure/Tracking/Event 改变；
- Coordinator 队列已有事务；
- Timing 成功、Aggregation 失败。

候选 View 在任一失效场景必须返回 stale/fallback；不允许通过放宽断言使其通过。

### Phase 3：影子比较（仍不改变生产结果）

**前提**：Phase 1/2 通过，且用户另行授权 Execute。

**动作**：在测试或隔离实验层同时计算 baseline 与 candidate，生产返回值继续使用 baseline；记录：

- `baseline_result` / `candidate_result`；
- snapshot clone/scan 次数；
- Floor Version/Swipe/epoch 失效次数；
- official GET/SAVE 仍应保持既有计数；
- fallback 原因。

**通过条件**：没有任何正常或并发 fixture 出现结果差异、历史继承差异、显式清空差异或身份误判。

### Phase 4：生产候选评审（另行授权）

只有在真实宿主临时 Chat 验证 Context/Swipe 生命周期、且没有跨写入者覆盖保证缺口后，才讨论是否将 View seam 放入生产。即使进入本阶段，也不能默认减少 Coordinator 官方 GET；需要重新审查是否有可证明的局部收益。

## 3. 预期验证命令

```bash
npm run check
git diff --check
```

本轮只运行现有检查，不新增生产逻辑，不运行会修改真实 SillyTavern Chat/Floor 的命令。

## 4. 失败处理和回退

- baseline 与 candidate 不一致：停止候选，不修改业务规则。
- 发现 View 过期但 candidate 继续返回结果：判为阻断，不进入生产。
- 官方 GET/SAVE 计数变化但没有对应 Coordinator 证据：判为诊断或模型不一致，不宣称收益。
- 真实宿主无法确认 Context 对象与保存目标的生命周期：保持当前 Coordinator 路径。
- 所有阶段均可通过不启用 candidate、保留现有 getter/Coordinator 完成回退。

## 5. 本轮不执行项

- 不修改 `runtime/events.js`、`runtime/event-analysis.js`、`storage/store.js`、`storage/floor-persistence-coordinator.js`、`storage/projection-timing.js`、`storage/participant-aggregation.js`、UI 或 Adapter。
- 不删除任何官方 GET、SAVE、版本校验、Swipe/epoch guard 或权威 readback。
- 不合并 Timing/Aggregation 事务。
- 不创建全局 Floor cache。
- 不写入真实 Chat/Floor，不切换分支，不 commit/push/reset/clean。

## 6. 进入 Execute 的判定

当前结论为 `NOT READY`：

- 现有证据支持“存在本地 clone/scan 重复”，但没有实际内部计数/耗时；
- 没有证据支持官方 GET 可减少；
- 没有经过候选 View 等价性和失效测试；
- 试点不能承诺改善真实宿主中的秒级等待。

因此本文件在本轮只作为后续计划，等待用户单独确认后再创建测试辅助代码。
