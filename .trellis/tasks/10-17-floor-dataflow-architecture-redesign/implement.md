# 架构审计执行清单

本任务只交付设计与证据报告，不进入生产 Execute，不运行 `task.py start`，不修改生产代码。

## 1. 证据准备

- [x] 读取根 `AGENTS.md`、Floor State Ownership Contract、Lifecycle Contract、Architecture 和相关 thinking guides。
- [x] 读取六份既有 Floor/宿主/原型审计报告，并区分源码、测试、真实宿主和隔离模型证据。
- [x] 检查当前 checkout 的生产调用链和现有工作区状态；保留既有生产修改与 Trellis 目录。

## 2. 架构梳理

- [x] 还原 Event、World、Character/State、Tracking、Projection、Timing Config、Timing Instance、Participant Aggregation 的生命周期。
- [x] 区分内部计算读取、Snapshot merge、并发保护和保存确认四类读取。
- [x] 核对当前 Context、Store、Floor resolver、Coordinator、Adapter 的职责和可复用 seam。
- [x] 明确普通 Floor/Chat-local/内存派生的持久化目标，不把模块名称当成独立 writer。

## 3. 设计交付

- [x] 形成当前与目标 Context-first 数据流调用图。
- [x] 形成 Floor State View、纯 Snapshot Merge、Coordinator、Host Adapter 的职责提案。
- [x] 形成 CLEAN/DIRTY/SAVING/CONFIRMED/FAILED/UNKNOWN/STALE 状态机和生命周期恢复规则。
- [x] 比较方案 A/B/C，明确 B 的确定性反例与 C 的 capability gate/fallback 前置条件。
- [x] 形成分阶段、可回退的实施路线和生产阻断条件。

## 4. 质量门

- [x] `npm run check`：1643 项测试，1627 通过、0 失败、16 跳过；本轮未修改生产代码或测试。
- [x] `git diff --check`：报告写入完成后执行并通过。
- [x] 检查 Markdown 影响：本轮仅新增 Trellis 任务文档；不改变生产行为，因此无需同步 README、Architecture 或 lifecycle contract。
- [x] 报告明确写出：当前没有已达到生产标准的少 GET native Floor 方案。

## 禁止事项

- 不修改 `storage/floor-persistence-coordinator.js`、`storage/store.js`、`runtime/sillytavern-adapter.js`、Runtime、UI 或业务规则。
- 不删除官方 GET、权威 readback、Floor Version/Swipe/epoch guard。
- 不合并 Timing 与 Aggregation 事务，不改变 partial-success 语义。
- 不执行真实 Chat/Floor 写入，不切换分支，不 commit/push/reset/clean。
