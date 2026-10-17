# Context-first Floor Writer 隔离原型

## 目标

基于 SevenDaysCal 的消息 Snapshot 写入方式，制作 BioWeave 专用的、与生产 Coordinator 隔离的 Context-first Floor Writer 原型，配套确定性并发测试、请求计数和最终审计报告。

本任务已获用户 review 批准并进入 Execute。实现范围仍严格限定为测试隔离原型、确定性测试和审计报告；不得修改生产持久化路径。

## 需求

### R1：参考实现核对

- 读取 SevenDaysCal 的 `snapshot.js`、`writeSnapshot()`、`scheduleSnapshotSave()`、`message.extra`、`swipe_info[swipe_id].extra`、`saveChatDebounced()`/`saveChat()` 相关调用。
- 读取 BioTracker 的 `scripts/state.js`、`scripts/host.js`、`scripts/save_sync.js`（若当前分支存在）和持久化文档。
- 报告实际实现、可借鉴机制、需要补足的保护和参考插件没有解决的风险。

### R2：独立 Writer 原型

原型只能放在测试/helper 或新的实验目录，不得 import 成生产入口。它必须：

- 从模拟 SillyTavern Context 定位 Chat、Floor、Message、Swipe；
- 校验 Chat ID、Floor、Message ID、Swipe ID、Content Hash、Message Version、Epoch；
- 只修改 BioWeave 自有字段，同时保留其他扩展字段、其他 BioWeave Snapshot、其他 Swipe 和历史 Floor；
- 支持 Event、World Model、Tracking、Projection、Timing Instance、Participant Aggregation 的模块 owner；
- 支持完整继承、显式空集合清除和同 Floor 多模块合并；
- 同步当前 message 的 `extra` 与对应 `swipe_info[swipe_id].extra`；
- 通过注入的 host save adapter 模拟 `saveChat()`，不直接写真实 Chat。

### R3：协调与状态

实现最小的单 Chat/Floor 操作队列和状态机：

`DIRTY -> SAVING -> HOST_ACCEPTED -> CONFIRMED`，并支持 `FAILED`、`UNKNOWN`、`STALE`。

`HOST_ACCEPTED` 不得自动升级为 `CONFIRMED`；响应丢失、保存结果不明和 readback 不一致必须保留为 `UNKNOWN` 或 `FAILED`，不能报告成功。

### R4：Timing/Aggregation 语义

原型模拟两个独立逻辑事务，保持：

- Timing Instance ID、Cycle ID、已采样浮动稳定；
- Aggregation 幂等；
- Timing 成功/Aggregation 失败的部分成功语义；
- 不为减少 SAVE 次数合并两个事务。

### R5：确定性并发测试

使用 Promise barrier/deferred，不使用固定 sleep。至少覆盖：

- 正常/no-op、连续/并发、多 Snapshot、重复写入；
- 其他扩展修改或替换 `message.extra`；
- Chat/Swipe 切换、正文编辑、消息删除；
- 历史 Floor、显式清空、其他标签页旧快照覆盖；
- 保存失败、响应丢失、readback 不一致；
- 保存期间再次产生结果；
- Timing 成功/Aggregation 失败。

外部写入无法由插件内队列解决时，测试必须暴露该风险。

### R6：量化和结论

每个场景记录 GET、SAVE、merge 次数、队列等待、保存状态、覆盖情况、确认需求和未解决外部并发风险，并与现有 Coordinator baseline 分开标注。

最终报告必须使用：

`IMPLEMENTED_IN_PROTOTYPE`、`TESTED_IN_ISOLATION`、`HOST_VERIFIED`、`CONDITIONALLY_SAFE`、`PROVEN_UNSAFE`、`BLOCKED`。

## 约束

- 不修改生产 Coordinator、Adapter、Runtime、UI、业务规则或 Snapshot schema。
- 不修改真实 SillyTavern Chat/Floor，不修改宿主源码。
- 不删除旧 Coordinator，不把旧 Coordinator GET 偷换成 Writer 内部 GET。
- 不切换分支、commit、push、reset、clean。
- 保留 `.trellis/tasks/10-15-nsfw-auto-aggregation-diagnostics/` 及现有工作区修改。

## 规划阶段验收

- [x] 新建独立 Trellis 任务目录。
- [x] 写明参考实现事实和不应继承的保证。
- [x] 写明原型的 Module/Interface/Implementation/Seam/Adapter/Locality 边界。
- [x] 写明测试矩阵、请求计数和 Execute 顺序。
- [x] Execute 原型代码和隔离测试（用户已批准 Execute）。
- [x] 最终审计报告和 `npm run check`/`git diff --check`（Execute 已完成）。
