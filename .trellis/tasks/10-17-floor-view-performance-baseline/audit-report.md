# BioWeave：内部 Floor View 最小改造规划与性能基线

## 1. 执行摘要

### 直接结论

1. 当前没有源码证据表明 Event、World Model、Character、Tracking、Projection、Timing 或 Aggregation 的内部计算阶段额外调用官方 `/api/chats/get`。结论为：

   `NO_REDUNDANT_COMPUTE_GET_FOUND`

   当前官方 GET 主要来自 Floor Persistence Coordinator 的保护和确认阶段，不能通过普通的内部 Floor View 复用直接消除。`SOURCE_VERIFIED`

2. 当前确实存在一个值得测量的本地重复：Timing readback 与 Aggregation 输入 getter 分别调用 `store.getCurrentChatOwnerSnapshot(chatId)`，各自做 owner snapshot 深拷贝、active Swipe 过滤、Floor 扫描和模块专用规范化。调用链重复已由源码确认，但本地构造次数、深拷贝量和耗时尚未被现有诊断测量。`SOURCE_VERIFIED` / `UNVERIFIED`

3. 最小候选不是删除 Coordinator GET，而是下一阶段建立操作内、只读、不可变的 `TimingAggregationReadView` 影子比较 seam。它只用于比较 Timing/ Aggregation 本地计算输入，不成为写入基线，不改变 Coordinator、版本保护、权威 readback 或两笔逻辑事务。`DESIGN_PROPOSAL`

4. 这个候选理论上可能减少一次本地 owner snapshot clone/scan，但当前预计官方 GET 减少为 **0**。因此不能声称它会解决真实宿主中 1.6–2 秒官方 GET 等待，也不能在没有内部计数和等价性测试前进入生产。`UNVERIFIED` / `BLOCKED` for latency claim

### 最值得实施的一个小改动

在后续 Execute 获得授权后，优先实施“测试专用 baseline/candidate 计数与影子比较”，而不是直接改生产读取路径：

```text
现有 Timing Coordinator + readback
  -> 现有本地 getter（baseline）
  -> 测试专用不可变 View（candidate）
  -> 完整结果、继承、版本和失效条件比较
  -> 生产返回值仍使用 baseline
```

如果该试点不能证明结果等价，保持现状；如果等价，也仍需重新测量本地收益并单独评估是否值得生产改造。

## 2. 证据边界

本报告复核了：

- `.trellis/tasks/10-17-floor-dataflow-architecture-redesign/audit-report.md`
- `.trellis/tasks/10-17-floor-dataflow-architecture-redesign/design.md`
- `.trellis/tasks/10-17-floor-write-path-performance-audit/audit-report.md`
- `.trellis/tasks/10-17-native-floor-persistence-prototype/audit-report.md`
- 当前生产源码和现有测试调用链
- `/Users/ll/Downloads/ST-BioWeave-Debug-20261017-161455.txt`
- `/Users/ll/Downloads/ST-BioWeave-Debug-20261017-161512.txt`
- `/Users/ll/Downloads/ST-BioWeave-Debug-20261017-163029.txt`

本轮没有修改生产代码、测试代码、Coordinator、Adapter、Runtime、UI 或真实 Chat/Floor 数据。已有工作区修改和其他 Trellis 目录保持原样。

证据标签：

- `SOURCE_VERIFIED`：当前源码静态可核对。
- `MEASURED`：真实宿主 Debug 或现有测试实际记录。
- `DESIGN_PROPOSAL`：后续方案，不代表已实现。
- `UNVERIFIED`：存在候选或迹象，但缺少计数、耗时、并发或宿主证明。
- `BLOCKED`：当前证据不足，不能安全实施。

## 3. A 类与 B 类 `/api/chats/get` 分类

### 3.1 A 类：内部计算阶段读取

A 类是从当前 SillyTavern Context、BioWeave Store 或 Runtime 已有结果构造业务输入的读取。当前静态检查没有发现它们直接调用官方 `/api/chats/get`：

| 内部读取 | 源码位置 | 当前行为 | 官方 GET 结论 |
| --- | --- | --- | --- |
| 当前 Chat/message 与 Floor target | `runtime/event-analysis.js:1615-1765` | `messages()` / `messageCollection()` 使用当前 Context；`resolveFloorAtIndex()` 计算六字段 Floor Version | 未发现官方 GET，`SOURCE_VERIFIED` |
| 当前 Floor states | `runtime/event-analysis.js:1873-1928` | `collectCurrentFloorStates()` 取得 owner snapshot，扫描消息/active Swipe/Floor 并计算版本 | 未发现官方 GET，`SOURCE_VERIFIED` |
| Tracking 输入 | `runtime/event-analysis.js:1930-2006` | 复用 floor states，读取 tracking registry、character facts、story time 等 | 未发现官方 GET，`SOURCE_VERIFIED` |
| Timing getter | `storage/projection-timing.js:338-386` | 当前 owner snapshot、active Swipe、Timing root、历史继承和版本规则 | 未发现官方 GET，`SOURCE_VERIFIED` |
| Aggregation getter | `storage/participant-aggregation.js:306-351` | 当前 owner snapshot、active Swipe、Aggregation root、历史继承和版本规则 | 未发现官方 GET，`SOURCE_VERIFIED` |
| Tracking Window getter | `storage/tracking-window.js:57-74` | 当前 owner snapshot、active Swipe、tracking timeline 扫描 | 未发现官方 GET，`SOURCE_VERIFIED` |
| Canonical derived state | `runtime/event-analysis.js:2339-2397` | `canonicalBuilds` 对同一 target/phase 做 single-flight | 未发现官方 GET，`SOURCE_VERIFIED` |

“未发现”是源码静态结论，不是对任意未检查宿主版本的运行时保证。真实官方 GET 计数由 Adapter/Coordinator 的诊断记录验证，见第 7 节。

### 3.2 B 类：Coordinator 持久化保护读取

`storage/floor-persistence-coordinator.js:613-708` 的 `commitFloorPatch()` 负责 owner acquisition、latest slot、merge、no-op/changed 分支、SAVE、authoritative readback 和最终审计。已有报告在 `.trellis/tasks/10-17-floor-write-path-performance-audit/audit-report.md:70-84,228-333` 明确将这些 GET 归为保护/确认路径。

B 类读取不能因为 A 类已经拥有一个本地 View 就自动删除。它们保护：

- 当前 Chat、Floor、Message、Swipe 和 epoch 是否仍然匹配；
- Floor Version、content hash、message version 是否 stale；
- 其他 Snapshot 或其他写入者是否已经改变目标；
- no-op 结果是否仍然是当前权威状态；
- SAVE 后权威数据是否与预期一致。

因此本轮的内部 View 优化范围只包含 A 类本地重复，**不包含** B 类官方 GET。

## 4. 当前 Floor 数据流调用链

### 4.1 通用内部读取和写入

```text
当前 SillyTavern Context
  -> runtime/event-analysis.js 的 Floor target / Floor states
  -> 各模块本地规范化和业务计算
  -> storage/* persistence wrapper
  -> floor-persistence-coordinator.commitFloorPatch()
  -> 官方 Chat GET/SAVE/GET ...
  -> 权威 readback
```

内部模块当前没有把官方 `/api/chats/get` 当成业务计算输入源；官方读取集中在持久化 Coordinator 与 Adapter 层。`SOURCE_VERIFIED`

### 4.2 Timing + Aggregation 手动保存

源码位置：`runtime/events.js:5480-6037`。

```text
ui/app.js:4181-4377
  -> runtime.editCharacterTimingInstance
       -> resolveCurrentBioWeaveFloor             :5485
       -> getTimingInstances                       :5573-5578
       -> editTimingInstance                       :5681-5696
            -> projection-timing.mutateFloor       :211-295
            -> Coordinator.commitFloorPatch        :613-708
       -> Timing getTimingInstances readback       :5718-5723
       -> collectActiveBusinessData                :5795-5803
       -> getParticipantAggregations               :5796-5803
       -> compute Aggregation / force reevaluation  :5816-5833
       -> independent aggregation save/readback    :5861-6006
       -> partial success handling                 :5964-5981
```

其中 `collectActiveBusinessData()` 的 business 输入被复用给事件、tracking window、story time 和 candidate exposure 过滤；这部分已经有一次操作内复用。`runtime/events.js:5795-5833`，`SOURCE_VERIFIED`。

## 5. 各模块重复工作审计

### 5.1 Event / Character

`runtime/event-analysis.js:2861-2969` 的 `collectActiveBusinessData()`：

1. 捕获 token；
2. 解析当前 target；
3. 取得 Chat data；
4. 调用 `collectCanonicalDerivedState()`；
5. 返回前调用 `assertBusinessTargetCurrent()`。

`assertBusinessTargetCurrent()` 在 `runtime/event-analysis.js:2834-2859` 重新确认当前 Floor target。它可能与之前的 target 解析相邻，但它是 stale guard；没有并发测试和契约证明不能删除。`SOURCE_VERIFIED`，优化 `UNVERIFIED`。

Character 分析在 `runtime/character-event-analysis.js:451-467` 可能复用 business，也可能收集 current floor states；写入在 `runtime/character-event-analysis.js:966-989` 之前再次校验依赖和目标。这些是本地状态工作，不是官方 GET；重复次数和耗时没有统一诊断字段。`UNVERIFIED`

### 5.2 World Model

`runtime/world-analysis.js:351-402` 的 `saveWorldModel()`：

- `:362` 解析当前 Floor；
- `:376` 从 Store 读取当前 Floor；
- `:377-378` 再解析目标并比较 Floor Version；
- `:384-392` 调用 `commitFloorPatch()`。

第二次 target 解析不是已证实的无用计算，它参与保存前 stale 校验。当前没有证据可安全合并。`SOURCE_VERIFIED` / `UNVERIFIED`

### 5.3 Tracking

`storage/tracking-window.js:16-55` 的创建/更新先检查 active Swipe、Floor Version 和本地 Floor，再进入 Coordinator。`storage/tracking-window.js:57-74` 的 getter 另行扫描 owner snapshot。某个具体 Runtime 操作是否同时调用 tracking getter 和 `collectTrackingInputs()`，当前没有统一操作级计数，不能报重复次数。`SOURCE_VERIFIED` / `UNVERIFIED`

### 5.4 Projection

`storage/projection.js:43-96` 的 `mutateFloor()` 会解析 owner、检查 record version、取得 projection views、规范化 timeline，然后调用 Coordinator。Projection 的去重、record version 和已知 ID 检查不能因相同结果看起来相邻而删除。当前没有可验证的安全复用点。`SOURCE_VERIFIED` / `UNVERIFIED`

### 5.5 Timing Instance

`storage/projection-timing.js:211-295` 的 `mutateFloor()` 会在 Coordinator patch resolver 中处理现有 root；若当前 root 缺失，`getTimingInstances()` 用于历史继承和显式空值语义（`projection-timing.js:232-244`）。该读取不是可以简单删除的重复。

Timing 权威 readback `projection-timing.js:338-386` 与 Aggregation getter 的本地 owner snapshot 构造是本轮最清晰的重复候选：

```text
getTimingInstances
  -> store.getCurrentChatOwnerSnapshot(chatId)
  -> normalize/scan active Swipe/Floor

getParticipantAggregations
  -> store.getCurrentChatOwnerSnapshot(chatId)
  -> normalize/scan active Swipe/Floor
```

二者读取不同 root、历史继承规则和 `editStartFloorVersion`/版本修复逻辑，因此“共享原始 view”仍需验证。`SOURCE_VERIFIED`（重复调用链）/`UNVERIFIED`（消除安全性）。

### 5.6 Participant Aggregation

`storage/participant-aggregation.js:211-275` 在缺少当前 Aggregation root 时调用历史 getter，以保留继承和显式空集合清除语义；`306-351` 扫描当前 owner snapshot。Timing 参数不变并不意味着 Exposure、Tracking Window、Event、story time 或同 Floor 其他角色输入不变，所以 Aggregation 重评估不能被 UI no-op 短路。`SOURCE_VERIFIED`

### 5.7 UI DTO

`ui/app.js:4181-4377` 成功路径在 `4248-4279` 直接使用 Runtime 返回的 `timing_instance` 和 `timing_readback`；没有再次获取编辑器 DTO。`4319-4355` 是部分成功/恢复路径，不是正常成功路径。当前没有证据说明 UI 成功路径存在重复 DTO 获取。`SOURCE_VERIFIED`

## 6. 重复点清单

| 候选点 | 重复次数 | 是否官方 GET | 实际耗时 | 过期/历史/并发风险 | 结论 |
| --- | ---: | --- | --- | --- | --- |
| 内部计算直接 `/api/chats/get` | 0（源码未发现） | 否 | 不适用 | 不适用 | `NO_REDUNDANT_COMPUTE_GET_FOUND`，`SOURCE_VERIFIED` |
| Timing readback owner snapshot | 每次 getter 1 次，调用链已确认 | 否 | 未测 | active Swipe、Floor Version、继承规则 | 重复存在，收益/安全 `UNVERIFIED` |
| Aggregation input owner snapshot | 每次 getter 1 次，调用链已确认 | 否 | 未测 | Aggregation root、显式空值、历史继承 | 重复存在，收益/安全 `UNVERIFIED` |
| `collectCurrentFloorStates()` 中的 Floor Version | 一次扫描内按消息/角色计算；实际调用数在业务诊断中有计数但未与本操作基线对齐 | 否 | 有阶段字段但没有本轮样本汇总 | 删除可能放宽 provenance/stale guard | 不选试点，`UNVERIFIED` |
| Canonical derived state | 同 target/phase single-flight | 否 | 已有阶段计时字段 | 去除会增加并发重复计算 | 已有保护，`SOURCE_VERIFIED` |
| UI 成功 DTO | 成功路径不重复获取 | 否 | 未发现 | 无 | `SOURCE_VERIFIED` |
| Coordinator owner/latest/readback | 多次，属于保护读取 | 是 | 真实 Debug 有秒级等待 | 版本、Swipe、epoch、外部并发 | 不属于本试点 |

“未测”不是“为零”；它表示当前 `timing_performance_diagnostics` 没有相应内部计数。

## 7. 性能基线

### 7.1 真实宿主 Debug：请求和阶段

真实宿主记录的摘要：

| 文件/操作 | 总耗时 | 官方 GET | 官方 SAVE | 关键阶段 |
| --- | ---: | ---: | ---: | --- |
| `ST-BioWeave-Debug-20261017-161455.txt`，`timing_perf_mvc4f73j_6` | 5435.3 ms | 6 | 0 | Timing persistence 4451.2 ms；Aggregation reevaluation input 370.8 ms；Aggregation persistence 552.5 ms |
| `ST-BioWeave-Debug-20261017-161512.txt`，`timing_perf_mvc4f73j_6` | 5435.3 ms | 6 | 0 | 同一诊断操作记录 |
| `ST-BioWeave-Debug-20261017-161512.txt`，`timing_perf_mvc4fmb7_c` | 2827.4 ms | 12 | 2 | Timing persistence 1288.4 ms；Aggregation input 369.7 ms；Aggregation persistence 1108.7 ms |
| `ST-BioWeave-Debug-20261017-163029.txt`，`timing_perf_mvc4z20y_3` | 5088.8 ms | 6 | 0 | Aggregation persistence 3899.7 ms |
| `ST-BioWeave-Debug-20261017-163029.txt`，`timing_perf_mvc4z9y5_5` | 3446.5 ms | 12 | 2 | Timing persistence 1519.5 ms；Aggregation input 373.7 ms；Aggregation persistence 1489 ms |

证据位置示例：

- no-op 官方摘要：`ST-BioWeave-Debug-20261017-161455.txt:6777-6790`；`ST-BioWeave-Debug-20261017-163029.txt:6919-6921`。
- changed 官方摘要：`ST-BioWeave-Debug-20261017-163029.txt:24597-24599`；`ST-BioWeave-Debug-20261017-161512.txt:25457-25459`。
- 161455 中同一 no-op 的 `OWNER_ACQUISITION` 约 2003.1 ms network wait 及 `COORDINATOR_READBACK` 约 1622 ms response parse 记录在 `:6642-6707`；这说明阶段耗时并非来自内部 View 构造。
- 163029 的另一 no-op 官方调用记录中可见约 1643.6 ms、1714.4 ms 的 network wait，JSON parse 约 1.6–1.9 ms（`ST-BioWeave-Debug-20261017-163029.txt:6783-6905`）。

这些日志可以证明请求数量和某些阶段等待，不能单独证明秒级等待的物理根因是网络、浏览器调度、服务端文件读取还是宿主其他任务。

### 7.2 诊断能力边界

`runtime/diagnostics.js:658-702` 创建 `recent_operations`；`705-756` 记录阶段；`758-840` 只按 `endpoint_kind` 和 `actual_network_request` 统计官方 `CHAT_GET`/`CHAT_SAVE`；`869-887` 暴露 `recent_operations`。

现有诊断已覆盖：

- Timing 操作总耗时和阶段耗时；
- 官方 GET/SAVE 实际网络请求数；
- readback、Aggregation 处理状态。

现有诊断没有覆盖：

- `getCurrentChatOwnerSnapshot()` 调用次数；
- `normalizeOwnerState()` 的 clone 次数/对象大小；
- 每个 getter 的 Floor scan 次数；
- Snapshot parse 次数；
- Character/Tracking 查询次数；
- Aggregation 输入生成次数；
- UI DTO 获取次数。

因此本轮不能把任何本地重复的“次数”和“耗时”标为 `MEASURED`。

### 7.3 真实宿主、隔离测试、静态分析分开

| 数据 | 证据类型 | 当前状态 |
| --- | --- | --- |
| 6 GET/0 SAVE、12 GET/2 SAVE | 真实宿主 Debug + 既有报告 | `MEASURED` |
| 官方 I/O 阶段和约 1.6–2.0 秒等待样本 | 真实宿主 Debug | `MEASURED`，根因未定位 |
| 内部 getter 使用 Context/Store，不直接官方 GET | 生产源码 | `SOURCE_VERIFIED` |
| Timing/Aggregation 各自 owner snapshot clone/scan | 生产源码调用链 | `SOURCE_VERIFIED` |
| 本地 clone/scan 实际成本 | 当前无计数器/汇总 | `UNVERIFIED` |
| 候选 View 可安全替代 getter | 尚无等价性/失效测试 | `UNVERIFIED` |
| 候选 View 能减少官方 GET | Coordinator 未改变，当前无证据 | `BLOCKED` / 理论为 0 |

## 8. 最小试点设计

### 8.1 试点边界

建议后续只做一个操作内的 `TimingAggregationReadView` 影子 seam：

```text
editCharacterTimingInstance
  -> Timing Coordinator + authoritative readback（保持不变）
  -> baseline: getTimingInstances / collectActiveBusinessData / getParticipantAggregations
  -> candidate: 一份不可变 owner view + 模块专用 read model
  -> 深度比较和身份比较
  -> 生产结果继续使用 baseline
```

候选 View 不是全局缓存，不是第二事实源，不是 CAS，也不提供跨标签页保护。

### 8.2 建议的最小接口（设计，不是生产 API）

```text
captureTimingAggregationReadView({chatId, target, token})
  -> immutable { chatId, messageId, index, floor, swipeId,
                 contentHash, messageVersion, epoch, ownerSnapshot }

readTimingFromView(view, options)
readAggregationFromView(view, options)
assertViewCurrent(view, liveToken)
```

实现必须复用现有 Store/schema/规范化函数；不得从 raw `message.extra` 旁路读取或把 Chat-level Floor map 变成事实源。该接口只允许在一次操作内部传递，不能缓存到 Runtime 全局。

### 8.3 失效条件

以下任一变化后 View 必须 `STALE`，并退回现有 getter 或直接报告现有错误语义：

- Chat ID 或当前 Context token 改变；
- Floor、message index/id、active Swipe 改变；
- message body、content hash、message version 或 epoch 改变；
- 当前目标 Floor Version 改变；
- message 被删除；
- 其他模块改变同 Floor Snapshot；
- Coordinator 队列中的事务改变了需要作为输入的状态。

跨 await 只重用 View 不能证明权威状态仍未变；该候选必须保留当前 target/token guard，且不改变 Coordinator 的 owner/latest/readback 时序。

### 8.4 预期工作变化

| 指标 | 当前 | 候选影子 View | 当前证据 |
| --- | --- | --- | --- |
| Floor 逻辑事务 | Timing 1 + Aggregation 1 | 仍为 2 | `SOURCE_VERIFIED` |
| 官方 GET | no-op 6；changed 12 | 预计仍为 6/12 | `MEASURED` baseline；候选未实现 |
| 官方 SAVE | no-op 0；changed 2 | 预计仍为 0/2 | `MEASURED` baseline；候选未实现 |
| Timing/Aggregation 重新评估 | 保留 | 保留 | `SOURCE_VERIFIED` |
| 权威 readback | 保留 | 保留 | `SOURCE_VERIFIED` |
| 本地 owner snapshot clone/scan | Timing/Aggregation getter 各自一次调用链 | 理论上可共享一次，但实际净收益未测 | `UNVERIFIED` |
| UI 等待 | 包含现有官方 I/O | 官方 I/O 不变，不能承诺改善 | `BLOCKED` for latency claim |

## 9. 风险与回退

### 9.1 不能做的“优化”

- 不能以 UI 输入不变跳过 Aggregation；其他依赖可能变化。
- 不能把 Timing readback 当成 Aggregation 最新输入；两者 root 和时点不同。
- 不能用第一次 `getCurrentChatOwnerSnapshot()` 代替 Coordinator latest slot 或权威 readback。
- 不能只比较内容对象而忽略 Swipe、Floor Version、epoch、message version。
- 不能因为测试 fixture 没有外部写入就宣布跨标签页安全。
- 不能通过删除 B 类 GET 来验证 A 类 View 优化。

### 9.2 回退

候选影子 seam 的回退很小：停止 candidate compare，继续使用现有 `getTimingInstances()`、`getParticipantAggregations()` 和 Coordinator。不得通过删除 readback 或提前向 UI 返回成功来回退。

如果后续生产实现发现以下任一情况，应保持现状：

- baseline 与 candidate 的继承/显式空集合结果不同；
- stale 场景 candidate 没有 fallback；
- 其他 Snapshot 被覆盖或遗漏；
- 无法证明 View 的有效期只限当前操作；
- 真实宿主 Context 对象在保存/切换期间可能漂移且没有补偿机制。

## 10. 最终回答

### 问题 1：当前是否存在内部计算阶段多余的官方 Chat GET？

没有发现。`NO_REDUNDANT_COMPUTE_GET_FOUND`。当前官方 GET 主要来自 Coordinator 保护和确认阶段。`SOURCE_VERIFIED`

### 问题 2：如果存在，具体可以安全减少几次？

当前没有被证明可以安全减少的官方 GET。候选内部 View 的预期官方 GET 减少为 **0**；它最多可能减少本地 clone/scan，但该收益尚未测量。`BLOCKED` / `UNVERIFIED`

### 问题 3：是否存在不涉及 GET、但可以安全消除的重复计算或 DTO 构造？

存在本地 owner snapshot clone/scan 的重复调用链，但还不能安全消除：Timing 与 Aggregation 的 Snapshot root、继承、显式清空和版本规则不同。Canonical derived state 的并发 single-flight 和 UI 成功路径的 DTO 复用已经存在，不应重复重构。`SOURCE_VERIFIED` / `UNVERIFIED`

### 问题 4：最值得实施的一个小改动是什么？

后续授权后，新增测试专用的操作内 immutable View 计数与 baseline/candidate 影子比较；不直接改变生产路径。它最小、可回退，能回答“重复 clone/scan 是否真实存在且等价可复用”。`DESIGN_PROPOSAL`

### 问题 5：该改动能否改善用户观察到的 Timing 保存等待？

目前不能这样声称。真实样本的长等待位于官方 I/O；候选不减少官方 GET/SAVE，无法解决这些请求的等待。只有未来发现本地 clone/scan 在真实宿主中占据显著比例，才有可能改善剩余本地部分。`MEASURED` baseline / `BLOCKED` for improvement claim

## 11. 是否建议进入 Execute

**建议：可以单独授权“测试专用计数 + 影子比较”进入 Execute；不建议直接实施生产 Floor View 复用。**

Execute 前必须满足：

1. 测试能分别统计 owner snapshot 构造、Floor scan、规范化和 Aggregation 输入生成；
2. baseline/candidate 在有 root、历史继承、显式空集合、多角色和多 Floor 下完全一致；
3. Promise barrier 测试覆盖 Chat/Swipe/message/epoch/Floor Version/其他 Snapshot 变化；
4. candidate 失效时 fallback，不改变错误码、部分成功或权威 readback 语义；
5. 官方 GET/SAVE 数量保持现有基线，任何变化都有明确 Coordinator 证据；
6. 真实宿主临时 Chat 验证 Context 生命周期后，再讨论生产 seam。

在这些条件满足前，**不得声称内部 Floor View 优化已经减少请求或改善 Timing 延迟**。

## 12. 本轮检查与变更边界

- 本轮只新增本任务目录内的规划/审计文档。
- 未修改生产 Coordinator、Adapter、Runtime、UI、业务规则、Snapshot 格式或测试逻辑。
- 未修改真实 SillyTavern Chat/Floor。
- 保留现有工作区修改和 `.trellis/tasks/10-15-nsfw-auto-aggregation-diagnostics/`。
- `npm run check`：通过；`tests` 共 1643 项，1627 通过、0 失败、16 skipped，耗时约 70.0 秒。输出中出现的 `DIGEST_BROKE`、`NO_CHARACTER_FLOOR`、`REQUEST_ABORTED` 等日志来自既有测试的故障/取消场景断言，未形成测试失败。
- `git diff --check`：通过。由于本轮新增文件仍是未跟踪文件，额外检查了任务目录的行尾空白；未发现空白错误。
- 本轮没有生产代码或现有测试逻辑 diff；新建/更新内容仅限 `.trellis/tasks/10-17-floor-view-performance-baseline/`。
