# 内部 Floor View 最小改造规划

## 目标

在不改变生产持久化逻辑的前提下，审计 BioWeave Floor 计算、读取和合并阶段的重复工作，冻结 Timing 保存路径的可复核性能基线，并提出一个小范围、可测试、可回退的内部 Floor View 试点。

本任务是 planning-only。当前不授权生产实现，也不授权删除任何 Coordinator 官方读取、权威 readback 或并发保护。

## 已确认范围

### 必须回答的问题

1. 将 `/api/chats/get` 严格拆成两类：
   - A：内部计算或业务输入读取；
   - B：Floor Persistence Coordinator 的 owner acquisition、latest slot、prewrite、readback、audit 等保护读取。
2. 横向检查 Event、World Model、Character、Tracking、Projection、Timing Instance、Participant Aggregation 的内部读取和计算。
3. 判断是否存在可由一次操作内的有效 Floor View 消除的本地重复工作。
4. 建立三种证据的基线：真实宿主 Debug、现有隔离测试、源码静态调用链。
5. 只选择一个候选试点；若没有满足安全条件的候选，明确报告 `NO_REDUNDANT_COMPUTE_GET_FOUND`，不制造优化点。

### 保护约束

- Floor Snapshot、历史 Floor 不可变、完整继承和显式空值清除语义不变。
- Chat、Message、Floor、Swipe、六字段 Floor Version、epoch 的身份和过期检查不变。
- Timing Instance ID、Cycle ID、已采样浮动值和 Aggregation 业务规则不变。
- Timing 与 Aggregation 仍保持独立逻辑事务和部分成功语义。
- 不修改生产 Coordinator、Adapter、Runtime、UI 或真实 Chat/Floor 数据。
- 不引入全局 Floor 缓存，不把 `message.extra`、`swipe_info[].extra` 或 Chat-level map 变成第二事实源。
- 插件内部的本地复用不能被描述为跨标签页、跨设备或 direct API 的并发保护。

## 当前证据摘要

- 生产内部计算使用当前 Context/Store；现有 `getTimingInstances()`、`getParticipantAggregations()`、`getTrackingWindowTimeline()` 的本地读取不直接调用官方 `/api/chats/get`。`runtime/event-analysis.js:1615-1765`、`storage/projection-timing.js:338-386`、`storage/participant-aggregation.js:306-351`、`storage/tracking-window.js:57-74`。
- Timing + Aggregation 的官方 GET 来自两笔 Coordinator 事务，不是内部业务计算阶段；普通 no-op 为 3 GET/0 SAVE，Timing + Aggregation no-op 为 6 GET/0 SAVE，changed 为 12 GET/2 SAVE。既有报告和真实宿主 Debug 均支持这一点。
- Timing 读回和 Aggregation 输入读取各自调用 `store.getCurrentChatOwnerSnapshot(chatId)` 并扫描本地消息/Floor；这构成可疑的本地深拷贝/扫描重复，但当前诊断没有记录其次数和耗时，因此优化收益仍为 `UNVERIFIED`。
- `collectCanonicalDerivedState()` 已有按 target/phase 的单飞复用；当前 UI 成功路径已经消费 Runtime 返回的 Timing DTO，不会再次请求编辑器 DTO。`runtime/event-analysis.js:2339-2397`、`ui/app.js:4181-4377`。

## 本轮交付物

- `audit-report.md`：证据分层的完整审计、性能基线、候选点及直接回答。
- `design.md`：最小试点的 Module / Interface / Seam / Adapter / Locality 设计，包含失效和回退条件。
- `implement.md`：仅供后续授权使用的 Execute 计划；不在本轮执行。
- `implement.jsonl`、`check.jsonl`：任务上下文和检查入口。

## 规划阶段验收标准

- [x] 读取并复核四份既有报告。
- [x] 为内部计算 GET 与 Coordinator 保护 GET 建立明确分类。
- [x] 对全部目标模块给出源码入口、是否重复、证据等级和未测量项。
- [x] 从 `timing_performance_diagnostics.recent_operations` 和真实宿主 Debug 提取请求/阶段基线。
- [x] 明确声明当前没有证据证明可减少官方 GET。
- [x] 提出一个不改变生产代码的最小试点，并列出前置测试与回退条件。
- [x] 运行 `npm run check` 和 `git diff --check`，且不修改生产文件。

## Execute 阶段前置条件

以下条件未在本轮授权范围内执行，必须由后续 Execute 授权单独确认：

- 测试专用的 Floor View 计数/影子比较 seam，能够同时输出现有读取结果和候选 View 结果。
- 对历史继承、显式空集合、同 Floor 多角色、Chat/Swipe/epoch 变化的确定性测试。
- 证明 View 只用于本地计算，任何 Coordinator 写入仍重新执行既有权威保护。
- 真实宿主临时 Chat 的行为验证；在此之前不得声称减少了用户观察到的官方 GET 延迟。
