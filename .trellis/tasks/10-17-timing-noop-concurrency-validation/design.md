# 技术设计：Coordinator no-op 权威读取复用并发验证

## 1. 证据边界

报告将每个结论标为：

- `S`：生产源码静态分析；
- `T`：实际运行的现有/新增测试；
- `H`：真实宿主或宿主接口契约；
- `UNPROVEN`：测试模型无法覆盖的宿主行为。

候选模型只用于回答“如果删除/复用该读取，哪个并发不变量会丢失”。模型结果不能被写成生产实现已经采用该候选。

## 2. Baseline 直接测试

优先在新测试文件中调用真实 `createFloorPersistenceCoordinator()`，使用测试侧 Store/Adapter callback 计数：

```text
OWNER_ACQUISITION -> LATEST_SLOT_READ -> SNAPSHOT_MERGE(no-op)
  -> COORDINATOR_NOOP_GUARD -> COORDINATOR_READBACK -> FINALIZATION
```

测试侧 Store 记录：

- owner acquisition 调用次数/返回的 owner 与 source revision；
- latest slot 调用次数/返回的完整 Floor Slot；
- authoritative readback 调用次数/返回的 Slot、Floor Version 和 Swipe；
- Floor save 次数；
- 每个 barrier 释放前后的 state；
- 最终 `status`、错误码、`noWrite`、`authoritativeReadback` 和事务队列顺序。

无并发 baseline 必须重复证明 `1 tx / 3 GET / 0 SAVE`，并验证 no-op 返回仍含完整 expected Floor Version。

## 3. 确定性并发 harness

所有竞态使用 deferred Promise，不使用固定 sleep：

```js
function deferred() {
  let resolve;
  const promise = new Promise(next => { resolve = next; });
  return {promise, resolve};
}
```

每个读函数先捕获“读取时状态”，再等待显式 gate；测试在 gate 未释放时执行 mutation，然后释放 gate。每个用例记录：

```text
initial_authoritative_state
mutation_point
baseline_result
candidate_result
baseline_get_count
candidate_get_count
concurrent_mutation
invariant_preserved
```

不使用 `setTimeout`。必要时使用测试中已有的 `Promise.resolve()`/`setImmediate` 仅等待已知执行点，不依赖时间窗口。

## 4. 候选模型

### Candidate A：Owner → Latest

测试模型把第一次 owner acquisition 返回的完整 owner state 直接当作 latest Slot。Baseline 仍调用独立 latest reader。重点反例：第一次读取后，同一 Floor 的 owner Slot/兄弟 Snapshot/Timing 内容改变但 owner identity 仍相同；候选使用旧 Slot 计算 no-op 或 merged result。

### Candidate B：Latest → No-op Readback

测试模型在 latest reader 返回后不做最终 authoritative readback，直接以 latest 作为 no-op confirmation。Baseline 在同一位置通过 `store.readAuthoritativeFloor()` 回读。重点反例：latest 返回后 Floor Version、message content hash、message version、active Swipe、Chat owner 或 sibling Snapshot 改变；候选应与 baseline 的 `FLOOR_TX_READBACK_FAILED`/stale 结果对比。

### Candidate C：Timing → Aggregation 跨事务

测试模型把 Timing no-op 的 readback、revision 或业务 DTO 直接提供给下一笔 Aggregation 事务，省略重新获取 Timing/Exposure/Tracking Window/当前 Aggregation 输入。Baseline 使用独立事务和独立输入读取。重点反例：两笔事务之间 Story Time、Exposure、Tracking Window、Timing sibling 或队列状态改变，以及 Aggregation 持久化失败后的 partial success。

该模型必须单独标注为“业务输入复用模型”，不能声称当前生产 Runtime 已经提供可注入的跨事务 read cache。

## 5. 测试矩阵

至少包含：

1. 无并发 no-op 基线；
2. owner acquisition 返回后同 Floor 写入；
3. latest slot 返回后同 Floor 写入；
4. 两次读取之间 Swipe 切换；
5. 两次读取之间 Chat 切换；
6. 两次读取之间 Chat epoch invalidation；
7. 同 Floor 其他 owner 修改 sibling Snapshot；
8. Timing no-op 与 Aggregation 启动之间写入；
9. Timing 参数不变但 Aggregation 输入改变；
10. Coordinator 同 key 队列已有事务；
11. owner/latest/readback GET 失败；
12. authoritative readback 失败或版本不一致；
13. message_id/content_hash/message_version/floor/swipe_id/chat_id 各自变化；
14. `sourceRevision` 改变但 Floor Version 不变，以及反向情况；
15. 多角色/多 sibling 保留。

现有生产实现只允许 baseline 结果成为业务契约；候选差异若未达到宿主 CAS/等价串行保证，只能记录为 `TESTED_NOT_PROVEN` 或 `PROVEN_UNSAFE`。

## 6. Source revision 与 CAS 审计边界

- `runtime/sillytavern-adapter.js:363-372` 的 `sourceRevision` 是 Chat owner header、metadata、messages、Chat/character/group identity 的稳定 hash；它能表示读取到的 owner 内容，但不是锁。
- `runtime/sillytavern-adapter.js:397-430` 每次官方 GET 重新计算该 hash；两次 GET 的 hash 相同只能说明两个读取结果相同，不能锁住后续 SAVE。
- `storage/store.js:696-750` 识别显式 CAS writer；`storage/store.js:1028-1057` 要求 expected revision 和 CAS capability。
- `runtime/events.js:1532-1583` 的 capability probe 允许显式 CAS writer；`officialLatestMerge` 是应用层官方 clone/merge 能力探测，不能单独当作原子 compare-and-save 契约。
- `runtime/events.js:1248-1437` 的普通 Floor path 仍是应用层合并、官方 SAVE、两次写后 GET 和 host/official audit；不能把 source revision 的读取比较称为原子 CAS。

最终报告必须把“有 revision 摘要”“应用层检查”“服务器条件写入”分成三层。
