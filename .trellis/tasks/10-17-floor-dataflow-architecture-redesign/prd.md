# Floor 数据流架构重整

## Goal

在不改变 Floor 数据模型、所有权和失败语义的前提下，设计一条“插件内部计算与合并优先、宿主负责最终保存”的 Floor 数据流。报告必须明确哪些读取可以留在当前 Context/插件内存，哪些读取仍是并发保护或权威确认所必需，避免把 Context-first 设计误写成已经安全的生产实现。

本任务只做源码/既有证据审计和架构设计，不实施生产路径切换。

## Confirmed facts

- 普通 Floor Coordinator changed 事务当前为 `6 GET + 1 SAVE`，no-op 为 `3 GET + 0 SAVE`；Timing + Aggregation 真实宿主样本分别为 `12 GET + 2 SAVE` 和 `6 GET + 0 SAVE`。证据来自既有测试、审计报告和真实宿主 Debug，不能用隔离原型数字替代。
- Event、World、Projection、Timing Instance、Participant Aggregation 等 Floor owner patch 共享 Coordinator；Character Timing Config 是 Chat-local metadata，不是 Floor Snapshot。
- `context.chat`/Store 当前读取适合插件内计算，但不是服务器最新 revision 的证明；官方 `/api/chats/get` 仍承担 owner acquisition、latest merge、写前/写后校验和 Coordinator readback。
- 上一轮 Coordinator 并发测试已为直接复用 Owner→Latest、Latest→Readback 和 Timing→Aggregation 输入建立确定性反例；原型也证明 Context-only no-op 和完整 Chat last-write-wins 存在覆盖风险。
- 当前 SillyTavern 官方保存能力尚未证明提供 BioWeave 所需的 owner-level CAS、字段级合并、可等待 durable confirmation 或跨标签页冲突仲裁。

## Requirements

### R1. 证据复核

复核六份既有审计报告与当前 checkout 源码，区分 `SOURCE_VERIFIED`、`TESTED_IN_ISOLATION`、`REAL_HOST_BASELINE`、`HOST_UNVERIFIED`、`DESIGN_PROPOSAL` 和 `BLOCKED`。报告不得把隔离模型的 GET/SAVE 数字写成真实宿主保证。

### R2. Floor 生命周期清单

覆盖 Event、World Model、Character/State、Tracking、Projection、Timing Config、Timing Instance、Participant Aggregation，并对每类数据说明计算者、输入、Context/内存可用性、继承、显式清空、Snapshot 合并、保存、确认和失败恢复职责。

### R3. 职责与 seam 设计

研究并明确 Floor State Manager、Snapshot Merge Engine、Floor Write Coordinator、Host Persistence Adapter 是否需要作为独立 Module。优先复用现有 feature owner、Store、Floor resolver、Coordinator 和 Adapter，不新增第二事实源或仅透传的浅 Module。

### R4. GET 分类

把内部计算读取、Snapshot merge 基线、并发冲突保护、保存结果确认四类读取分开。对普通写入、需要权威确认、状态过期/冲突三条路径分别给出 GET/SAVE 数量、保护、风险和进入生产条件；不得逐条机械删除旧 Coordinator GET。

### R5. 状态与恢复

设计 `CLEAN`、`DIRTY`、`SAVING`、`CONFIRMED`、`FAILED`、`UNKNOWN`、`STALE` 状态及转换。覆盖 Chat/Swipe/消息编辑/删除/Floor 索引变化、外部扩展、插件并发、旧标签页、保存失败、未知结果、刷新/关闭和 readback 不一致。

### R6. 架构比较

比较方案 A（现有 Coordinator）、方案 B（完全 Context-first）和方案 C（Context-first + 严格确认/回退），评价数据一致性、完成语义、跨标签页风险、复杂度、测试成本、GET/SAVE、用户等待、迁移和回退能力。明确说明“先 Context 写入再 fallback”为什么不安全。

### R7. 分阶段路线

提出可回退的最小实施顺序，先建立只读内部状态视图和纯 Snapshot merge 测试，再验证宿主能力，最后才讨论生产路由。每一步必须写明修改范围、旧逻辑保留、测试、回退和进入下一步的条件。

### R8. 业务契约

设计必须保留 Chat/Message/Floor/Swipe、Content Hash/Message Version/epoch、历史 Floor 不可变、完整继承和显式空集合、同 Floor sibling 合并、其他扩展字段、Timing Instance/Cycle/采样值、Aggregation 幂等、Timing/Aggregation partial success，以及 confirmed/failed/unknown 的真实语义。

## Acceptance criteria

- [x] 新任务报告包含当前 Floor 数据流和目标 Context-first 数据流调用图。
- [x] 每个 Floor/Chat-local/内存模块都有源码路径、函数、输入、目标 Snapshot、继承/清空、保存/确认/失败说明。
- [x] 报告明确区分四类读取，并单独列出普通写入、权威确认和冲突回退路径的请求数量与证据等级。
- [x] 设计给出最小职责接口、seam、状态机和生命周期恢复规则，且不引入第二事实源。
- [x] A/B/C 对照表明确写出 B 的确定性风险和 C 的回退前置条件；没有 CAS/patch/确认能力时不得标记为可实施。
- [x] 分阶段计划包含测试、回退和宿主临时 Chat 验证门槛。
- [x] 最终结论明确回答如何内部优先、何时必须依赖宿主、哪些事项当前被宿主能力阻断。
- [x] 本轮没有修改生产 Coordinator、Adapter、Runtime、UI、业务规则、真实 Chat/Floor 或现有无关 Trellis 任务。

## Out of scope

- 不修改生产持久化路径、业务规则、Floor Snapshot schema 或 UI。
- 不删除或合并任何 Coordinator GET/readback，不合并 Timing 与 Aggregation 事务。
- 不执行真实 SillyTavern Chat/Floor 写入、不迁移数据、不改宿主源码。
- 不把 UI dirty、Context 相等、插件 mutex、source revision hash 或 `saveChatDebounced()` 直接当作 CAS/confirmed。
- 不提交、推送、切换分支、reset、clean 或覆盖既有工作区修改。

## Deferred blockers

- 当前运行 SillyTavern server build 的完整源码/接口契约是否与已审计 1.19.0 快照一致。
- 原生保存是否存在可依赖的 owner patch、expected revision/CAS、跨 writer 串行化和可确认完成事件。
- 在没有这些宿主保证时，Context-first 是否只能作为内部读/合并准备层，而不能替代现有权威写入路径。
