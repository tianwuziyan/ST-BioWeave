# 审计设计：推演周期 no-op 保存性能优化可行性

## 1. 证据模型

报告使用三种证据标签：

- `S`（源码静态分析）：调用关系、存储目标、事务边界、`await` 和错误处理。
- `T`（测试证据）：现有集成测试、Mock Adapter、官方 I/O stage/count 断言。
- `H`（真实宿主 Debug）：三个用户提供的 SillyTavern Debug 文件中的实际 `floor_transaction`、`official_io_calls` 和等待时间。

没有对应证据时使用 `UNKNOWN`，不以相邻调用或理论最少请求数代替实测结果。

## 2. 审计主线

按以下顺序整理调用链，避免把局部缓存或业务 readback 误认为官方 Chat GET：

```text
Timing 编辑器
  -> Runtime editCharacterTimingInstance
  -> Timing Instance Storage
  -> Timing Coordinator
  -> official Chat GET/SAVE/readback
  -> Timing 业务 readback
  -> Aggregation 输入收集与 trigger 重评估
  -> Aggregation Coordinator（可能 no-op/changed）
  -> Aggregation 业务 readback
  -> UI success/error/reconciliation
```

随后用同一套字段检查 Event、World、Character、Tracking、Config、Projection 和其他 Floor owner，确认它们是 Floor、Chat-local、内存派生还是纯读取。

## 3. No-op 判定原则

### UI no-op

只表示编辑器打开时保存的五个显示值与当前 draft 相等。它不证明当前 Floor 未被其他操作修改，因此不能直接阻止 Runtime authority/stale 校验。

### Timing no-op

必须在当前权威 Floor owner、active Swipe、完整 Floor Version、Chat 边界、edit-start version、当前 Instance ID、Cycle ID、sampled offset 和五个 Timing 参数都通过检查后，确认 `projection_timing_snapshot` 的 mutation 没有变化。

### Aggregation no-op

必须在当前权威 Timing、Story Time、active Event/exposure、Tracking Window、既有 Aggregation 以及目标 subject/cycle 都完成重评估后，确认 `participant_aggregation_snapshot` 没有变化。Timing no-op 不蕴含 Aggregation no-op。

## 4. 请求计数方法

- 按 `floor_transaction_id` 汇总事务。
- 按 `io_purpose` 区分 `OWNER_ACQUISITION`、`LATEST_SLOT_READ`、`SAVE_PREWRITE_READ`、`SAVE_AUTHORITATIVE_READBACK`、`SAVE_FINAL_SLOT_AUDIT`、`COORDINATOR_READBACK`。
- 不把 `getTimingInstances()`、`getParticipantAggregations()` 等本地 Store/历史扫描算作官方 `/api/chats/get`。
- 对业务模块只有 local mock 的情况，只报告可证明的 Coordinator 基线，模块级真实计数标 `UNKNOWN`。

## 5. 方案评估标准

每个候选方案必须同时回答：

1. 能减少多少已验证的 GET/SAVE，还是只有理论上限。
2. 是否保留 Timing/Aggregation 事务边界。
3. 是否保留 Floor Version、Swipe、Chat/epoch、stale、owner 和权威 readback。
4. 读取之后到返回成功之间是否有外部写入窗口。
5. 失败、部分成功和重试语义是否改变。
6. 需要哪些并发、外部 Chat 修改、readback 失败和多 subject 测试才能实施。

## 6. 预期交付

本任务保持 `planning`，不调用 `task.py start`。最终只新增 `audit-report.md` 及本规划文档，不对生产代码或测试进行实现性修改。
