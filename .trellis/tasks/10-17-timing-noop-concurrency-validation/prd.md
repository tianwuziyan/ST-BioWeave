# Coordinator no-op 权威读取复用并发测试验证

## Goal

基于两份既有 Floor 写入审计报告，在不修改生产 Coordinator、Adapter 或业务规则的前提下，用确定性的隔离测试验证 Coordinator no-op 三次权威读取的并发保护，以及三个 GET 复用候选的安全边界：

- A：`OWNER_ACQUISITION` 结果复用 `LATEST_SLOT_READ`；
- B：`LATEST_SLOT_READ` 结果复用 no-op 最终 `COORDINATOR_READBACK`；
- C：Timing no-op 事务的权威结果跨事务复用给 Aggregation。

最终报告必须区分：确定性反例、有限测试未发现反例、以及由源码/宿主契约共同支持的安全证明。

## Confirmed source facts

- `storage/floor-persistence-coordinator.js:322-407` 先执行 owner acquisition 与 latest slot read；`storage/floor-persistence-coordinator.js:424-518` 在 Snapshot Merge 判定 no-op 后仍执行 `COORDINATOR_READBACK`。
- no-op 最终化至少检查权威回读存在且 Floor Version 与 expected 完全相同；changed 最终化还检查 owner fields、siblings 和 version：`storage/floor-persistence-coordinator.js:469-610`。
- `runtime/sillytavern-adapter.js:363-430` 为官方 Chat GET 的完整 owner 状态计算稳定 SHA-256 `sourceRevision`，但默认 `/api/chats/save` 是普通保存调用，没有源码证明的条件写入/服务器 CAS。
- `runtime/chat.js:20-91` 的 epoch/token 能阻止 Chat 生命周期跨界；它不是 `/api/chats/save` 的服务器 revision lock。
- `storage/store.js:1028-1057` 只有显式 CAS writer 且提供 expected revision 时才允许 source-owner revision CAS；普通 Floor path 仍经 `runtime/events.js:923-1437` 的 GET/应用层校验/SAVE/GET 流程。
- 现有 `tests/floor-persistence-coordinator.test.js:160-290` 已覆盖部分队列、no-op/readback 和 deferred save 基线，但没有覆盖读间隔内的 Chat/Floor/Swipe/epoch/同 Floor 写入矩阵。

## In scope

1. 阅读并以当前源码核对三次 no-op GET 的数据、不变量、异步边界和错误语义。
2. 使用可控 Promise/deferred barrier、Mock Adapter 或 test-only behavior model 构造确定性并发场景。
3. 验证 baseline 的事务数、GET/SAVE、readback、错误码和队列顺序。
4. 以明确标记的测试模型比较 A/B/C 候选；模型结果不能冒充生产实现或宿主保证。
5. 在新任务目录生成审计报告，包含 source revision/CAS 能力和候选证据等级矩阵。

## Out of scope and safety constraints

- 不修改 `storage/floor-persistence-coordinator.js`、`storage/store.js`、`runtime/events.js`、`runtime/sillytavern-adapter.js` 或其他生产持久化逻辑。
- 不修改生产导出接口，不删除任何 GET、权威 readback、Floor Version/Swipe/epoch 校验，不合并 Timing 与 Aggregation 事务。
- 不修改真实 SillyTavern Chat/Floor Snapshot，不切换分支，不 commit、push、reset、clean。
- 不使用固定 `setTimeout` 或运行速度制造竞态；每个竞态必须由显式 barrier 释放。
- 不为了让候选测试通过而削弱 baseline 断言；不可模拟的宿主能力标记为 `UNPROVEN`。

## Acceptance Criteria

- [ ] 新报告准确给出 no-op 三次 GET 的当前调用图、每次读取的数据/不变量、异步边界、当前宿主状态依赖和现有测试证据。
- [ ] 新增测试覆盖无并发基线、A/B/C 关键读间隔、Chat/Floor/Swipe/epoch/source revision、同 Floor sibling、队列、官方 GET 失败和 readback 失败；每项写明初始状态、barrier 位置、baseline 与候选差异。
- [ ] 测试结果分别记录 `baseline_result`、`candidate_result`、GET 计数、并发 mutation、`invariant_preserved`；候选模型与生产实现边界明确。
- [ ] 报告建立 A/B/C 证据矩阵，仅 `CONTRACT_SUPPORTED` 才可建议进入生产优化；有限通过只能标为 `TESTED_NOT_PROVEN`。
- [ ] 报告明确回答：不修改宿主、不削弱保护、不改变 partial-success 的前提下，当前是否证明可减少官方 Chat GET；若不能，必须写出“目前没有达到生产实施标准的 GET 复用方案。”
- [ ] 仅新增/调整隔离测试和新任务文档；`npm run check`、`git diff --check` 结果真实记录。
