# 内部 Floor View 最小试点设计

## 1. 设计判断和证据等级

本设计不是生产实现。所有判断使用以下标记：

- `SOURCE_VERIFIED`：可由当前源码或既有报告直接核对。
- `MEASURED`：由真实宿主 Debug 或现有测试实际记录。
- `DESIGN_PROPOSAL`：为了后续验证提出的接口/边界，不代表已经存在。
- `UNVERIFIED`：存在源码迹象，但没有足够计数、并发或宿主证据。
- `BLOCKED`：缺少必要证据，当前不能安全推进。

核心结论：

> `NO_REDUNDANT_COMPUTE_GET_FOUND`：当前没有发现由内部 Event/World/Character/Tracking/Projection/Timing/Aggregation 计算额外发起的官方 `/api/chats/get`。

当前可见的重复工作是本地 Context/Store 的 owner snapshot 深拷贝和消息/Floor 扫描，不是官方网络 GET。它可能值得做一个操作内 View 试点，但当前没有内部计数和耗时证据，不能把它写成已验证的性能收益。

## 2. A/B 读取分类

### 2.1 A 类：内部计算读取

这些读取从当前宿主 Context、Store 或既有 Runtime 结果取得数据：

| 入口 | 实际行为 | 官方 `/api/chats/get` | 证据 |
| --- | --- | --- | --- |
| `eventAnalysis.messages()`、`messageCollection()` | 读取 `st.getContext()?.chat` / `st.getChat()`，再由 `resolveFloorAtIndex()` 计算 Floor Version | 未发现 | `runtime/event-analysis.js:1615-1765`，`SOURCE_VERIFIED` |
| `collectCurrentFloorStates()` | `store.getCurrentChatOwnerSnapshot()` 后扫描消息和 active Swipe，读取本地 Floor 并计算六字段版本 | 未发现 | `runtime/event-analysis.js:1873-1928`，`SOURCE_VERIFIED` |
| `collectTrackingInputs()` | 复用当前 floor states，读取 tracking/registry/character facts/story time | 未发现 | `runtime/event-analysis.js:1930-2006`，`SOURCE_VERIFIED` |
| `getTimingInstances()` | 本地 owner snapshot、active Swipe、Floor root、历史继承和版本保护 | 未发现 | `storage/projection-timing.js:338-386`，`SOURCE_VERIFIED` |
| `getParticipantAggregations()` | 本地 owner snapshot、active Swipe、Aggregation root、历史继承和版本保护 | 未发现 | `storage/participant-aggregation.js:306-351`，`SOURCE_VERIFIED` |
| `getTrackingWindowTimeline()` | 本地 owner snapshot、active Swipe、tracking timeline 扫描 | 未发现 | `storage/tracking-window.js:57-74`，`SOURCE_VERIFIED` |
| `collectCanonicalDerivedState()` | 对同一 target/phase 使用 `canonicalBuilds` single-flight，后续并发调用等待同一结果 | 未发现 | `runtime/event-analysis.js:2339-2397`，`SOURCE_VERIFIED` |

上述“未发现”是源码静态结论，不是对所有宿主版本的运行时证明。官方 GET 计数来自 Adapter/Coordinator 的记录，见下节。

### 2.2 B 类：持久化保护读取

`createFloorPersistenceCoordinator().commitFloorPatch()` 在 `storage/floor-persistence-coordinator.js:613-708` 维护 owner acquisition、latest slot、merge、changed/no-op 分支、save 和 readback。其官方 I/O 是安全边界的一部分，不能由“内部 View 已有数据”自动替代。

典型顺序为：

```text
内部/模块输入
  -> Coordinator OWNER_ACQUISITION
  -> LATEST_SLOT_READ
  -> merge / FLOOR_TX_NOOP 或 SAVE
  -> authoritative readback / final audit / coordinator readback
```

具体阶段和官方 I/O 的归属已经在 `.trellis/tasks/10-17-floor-write-path-performance-audit/audit-report.md:70-84,228-333` 及 `.trellis/tasks/10-17-timing-noop-concurrency-validation/audit-report.md` 中核对。它们保护的是当前 Chat/Floor/Swipe/epoch、版本新鲜度、写入后的权威状态和并发窗口，而不是计算输入的重复读取。

## 3. 当前模块数据流和重复工作审计

### 3.1 Event / Character

`runtime/event-analysis.js:1615-1765` 以当前 Context 建立 Floor target；`collectActiveBusinessData()` 在 `runtime/event-analysis.js:2861-2969` 捕获 token、解析 target、读取当前 Chat 数据、执行 canonical derived state，并在返回前执行 `assertBusinessTargetCurrent()`。这类重复 target 解析是 stale guard 的一部分，不能仅因相邻调用而删除。

角色分析在 `runtime/character-event-analysis.js:451-467` 复用 `collectActiveBusinessData()` 或重新收集当前 floor states，并在 `runtime/character-event-analysis.js:966-989` 写入前再次校验依赖和 target。它没有直接官方 GET；它通过 `commitFloorPatch()` 进入 Coordinator。重复收集可能存在于特定分析流程，但当前没有可比的计数/耗时记录，标记 `UNVERIFIED`，不作为本轮试点。

### 3.2 World Model

`runtime/world-analysis.js:351-402` 先解析当前 Floor、读取当前本地 Floor，并再次解析 target 后调用 `commitFloorPatch()`。这两个解析承载 Chat/Floor/Swipe/Version 保护；当前未证明是可删除的纯重复。写入仍走 Coordinator，不存在内部计算阶段官方 GET 的证据。`SOURCE_VERIFIED`；可优化性 `UNVERIFIED`。

### 3.3 Tracking

`storage/tracking-window.js:16-55` 的创建/更新先做 active Swipe、Floor Version 和本地 Floor 检查，再进入 Coordinator；`getTrackingWindowTimeline()` 在 `:57-74` 从当前 owner snapshot 扫描。没有直接官方 GET。一次操作内是否同时重复调用 tracking timeline 与 `collectTrackingInputs()`，取决于具体 Runtime 调用链；当前没有统一计数器，标记 `UNVERIFIED`。

### 3.4 Projection

`storage/projection.js:43-96` 的 `mutateFloor()` 解析 owner、检查 record version、读取 projection views、规范化当前 timeline，然后调用 Coordinator。Projection AI 结果的计算与写入是不同阶段；`runtime/event-analysis.js:2217-2240` 等入口使用现有 business/target 结果。Projection 的本地读取可能多次扫描，但这些扫描是 projection 自身去重和版本校验的一部分，当前没有证据能安全合并，标记 `UNVERIFIED`。

### 3.5 Timing Instance

手动保存路径在 `runtime/events.js:5480-6037`：

1. `:5485` 解析当前 Floor。
2. `:5573-5578` 读取编辑前 Timing DTO。
3. `:5681-5696` 调用 `editTimingInstance()`，其 `storage/projection-timing.js:211-295` 通过 Coordinator 写入。
4. `:5718-5723` 读取 Timing 权威 readback。
5. `:5795-5833` 同一阶段收集 business 输入和 Aggregation snapshot，且显式令 `aggregation: null` 触发重评估。
6. `:5861-6006` 独立执行 Aggregation 写入/回读，并在 `:5964-5981` 保持 Timing 成功、Aggregation 失败的部分成功语义。

这里最明确的本地重复候选是：Timing readback 的 `getTimingInstances()` 和 Aggregation 输入的 `getParticipantAggregations()` 各自调用 `store.getCurrentChatOwnerSnapshot()`，随后各自扫描 owner snapshot。它们读取不同 Snapshot root、不同继承结果和不同版本修复规则，不能直接视为相同数据。重复 clone/scan 的事实为 `SOURCE_VERIFIED`；可安全合并为一份 View 为 `UNVERIFIED`。

### 3.6 Participant Aggregation

`storage/participant-aggregation.js:211-275` 的写入路径在缺失 root 时必须调用历史 `getParticipantAggregations()` 以保留继承和显式空值语义；`storage/participant-aggregation.js:306-351` 的 getter 扫描当前 Context/Store。Timing 参数不变时仍可能因为 Exposure、Tracking Window、Event 或其他角色状态变化而改变结果，因此不能用 Timing no-op 直接跳过 Aggregation 重评估。

### 3.7 UI

`ui/app.js:4181-4377` 在当前 Timing 编辑成功路径直接使用 Runtime 返回的 `result.timing_instance` 和 `result.timing_readback`（`4248-4279`），没有再调用一次 `getCharacterTimingEditorData()`。只有部分成功/需要协调的错误路径在 `4319-4355` 重新获取编辑器数据。当前未发现成功路径的 UI DTO 重复读取，`SOURCE_VERIFIED`。

## 4. 候选重复点矩阵

| 候选 | 当前重复 | 是否官方 GET | 保护/语义风险 | 当前结论 |
| --- | --- | --- | --- | --- |
| 内部计算阶段再次调用 `/api/chats/get` | 未发现 | 否 | 无 | `NO_REDUNDANT_COMPUTE_GET_FOUND`，`SOURCE_VERIFIED` |
| Timing readback 与 Aggregation getter 各自建立 owner snapshot | 两次本地 snapshot clone/scan 的调用链已确认；数量和耗时未测 | 否 | 历史继承、显式空值、active Swipe、Floor Version 修复不完全相同 | 重复事实 `SOURCE_VERIFIED`，消除方案 `UNVERIFIED` |
| `collectActiveBusinessData()` 与 `collectCurrentFloorStates()` 的 target/state 解析 | 特定调用链可能重复，但部分是 stale guard 和输入边界 | 否 | 删除可能放宽 current-target guard | `UNVERIFIED`，不选作试点 |
| canonical derived state 并发构造 | 已有 target/phase single-flight | 否 | 删除会重新引入并发重复计算 | 无优化动作，`SOURCE_VERIFIED` |
| UI 成功路径重新获取 Timing DTO | 当前成功路径复用 Runtime 返回值 | 否 | 无 | 未发现，`SOURCE_VERIFIED` |
| Coordinator 历史 fallback / protection GET | 多个读取存在且必要性由并发审计覆盖 | 是 | 版本、Swipe、epoch、其他模块并发和 readback | 不属于内部 View 优化范围 |

## 5. 最小试点：操作内只读 `TimingAggregationReadView`

### 5.1 目标

只研究 Timing 保存完成之后、Aggregation 重评估输入构造阶段的局部复用：将一次操作中已经取得的、经过身份校验的当前 owner 本地视图，以不可变的操作内对象传给 Timing/ Aggregation 读取函数，避免重复 clone/scan 的可能性。

这是 `DESIGN_PROPOSAL`，不是现有生产 API，也不是允许本轮实现的改动。

### 5.2 Module / Interface / Implementation / Seam / Adapter / Locality

- **Module**：`storage/store.js` 的当前 owner snapshot 读取，以及 `projection-timing.js` / `participant-aggregation.js` 的本地扫描逻辑。
- **Interface**：建议的 `TimingAggregationReadView` 只暴露已验证的 `chatId`、message index/id、Floor、Swipe、六字段 Floor Version、不可变 message/Floor 读取和模块专用规范化读取，不暴露可写 raw `extra`。
- **Implementation**：优先复用现有 `normalizeOwnerState()`、`getFloor()`、`getActiveSwipeId()` 和各模块自己的历史继承/规范化函数；不得复制另一套 Floor schema。
- **Seam**：最小 seam 是“同一次 `editCharacterTimingInstance()` 操作内，Timing readback / Aggregation input 之间传递一个只读 snapshot view”。不建立全局缓存，不改变 Coordinator 输入。
- **Adapter**：宿主 Context 仍由现有 Store/Adapter 读取；View 不直接依赖 `/api/chats/get`，也不能代替 Coordinator 的官方读取。
- **Locality**：View 的有效期只到当前操作阶段结束；每个跨 `await` 的高风险边界都要用 token/当前 target 重新确认，失效时退回现有 getter。

### 5.3 建议调用图

当前：

```text
editCharacterTimingInstance
  -> Timing Coordinator + authoritative readback
  -> getTimingInstances
       -> getCurrentChatOwnerSnapshot (clone/scan A)
  -> collectActiveBusinessData
       -> current floor / canonical business
  -> getParticipantAggregations
       -> getCurrentChatOwnerSnapshot (clone/scan B)
  -> Aggregation Coordinator + authoritative readback
```

候选影子路径：

```text
editCharacterTimingInstance
  -> Timing Coordinator + authoritative readback
  -> capture operation-scoped local owner view
  -> readTiming(view) + collect business(view)
  -> readAggregation(view)
  -> compare candidate output with existing getters
  -> continue using existing Coordinator writes and readbacks
```

候选路径只有在 compare 结果完全一致时才可进入下一阶段；在影子阶段不替代现有生产返回值，不减少官方 GET。

### 5.4 必须保持的失效规则

View 必须携带并验证：

- `chat_id`、message index、message id、Floor、active `swipe_id`；
- 六字段 Floor Version、content hash、message version、epoch；
- 当前 Timing Instance ID、Cycle ID 只作为输入/输出一致性字段，不得在 View 中重生成；
- 当前操作开始时的 Context token。

以下任何变化都使 View `STALE`，必须停止复用并走既有 getter/Coordinator 错误路径：Chat 切换、Floor 切换、Swipe 切换/删除、消息正文编辑或删除、epoch 变化、目标 Snapshot 版本变化、其他模块写入导致的当前 Floor Version 变化。

View 不能保证外部标签页、设备或 direct API 在 capture 后不写入。它只减少同一操作内本地读取，不承担跨写入者 CAS。

### 5.5 预期收益边界

| 指标 | 当前事实 | 影子 View 的理论影响 | 证据等级 |
| --- | --- | --- | --- |
| 官方 Chat GET | Timing + Aggregation no-op 6，changed 12 | 0；Coordinator 仍保留 | `MEASURED` baseline / `DESIGN_PROPOSAL` |
| 官方 Chat SAVE | no-op 0，changed 2 | 0；两笔逻辑事务保留 | `MEASURED` baseline / `DESIGN_PROPOSAL` |
| 本地 owner snapshot clone/scan | Timing 与 Aggregation getter 各自调用一次；实际次数/耗时未记录 | 理论上可能从两次到一次，但仍需保持模块读取语义 | `SOURCE_VERIFIED` / `UNVERIFIED` |
| Timing UI 等待 | 真实 Debug 的总耗时约 2.8–5.4 秒样本 | 无法声称改善；官方 GET 不减少 | `MEASURED` / `BLOCKED` for latency claim |

因此最小试点的首要价值是测量和证明本地复用是否等价，而不是承诺解决秒级 GET 等待。

## 6. 后续测试设计

仅在 Execute 获得授权后新增测试辅助代码；本轮不新增测试代码。

### 6.1 输出比较

每个 fixture 必须同时运行 baseline getter 和 candidate view，比较：

- Timing items、Aggregation items 的完整规范化结果；
- 历史继承结果、显式空集合清除结果；
- 多角色同 Floor 的独立性；
- Floor Version、Swipe、epoch 和 owner 身份；
- canonical business input 和 readback 触发条件。

任何差异都必须使 candidate 失败或 fallback，而不是弱化断言。

### 6.2 必测情形

1. 当前 Floor 有 Timing root 和 Aggregation root。
2. 当前 root 缺失，需要从历史 Floor 继承。
3. 当前 root 是显式空集合，不能错误继承历史值。
4. 柳如烟、祁鸢和同 Floor 多角色同时存在。
5. Timing no-op 但 Exposure/Tracking/Event 输入改变，Aggregation 仍需重评估。
6. capture 后 Chat、Swipe、message body、epoch 或 Floor Version 变化。
7. capture 后其他 Snapshot 写入，必须 fallback 或返回 stale，不能覆盖/伪成功。
8. Timing 成功、Aggregation 失败，部分成功结果与现有路径一致。
9. Coordinator 队列中已有其他事务；View 不得成为写入基线。

### 6.3 证据标签

隔离测试即使全部通过，也最多是有限模型内的测试证据，不能升级为 `SOURCE_VERIFIED` 或真实宿主 `MEASURED`。真实宿主仍需在临时 Chat 中验证 Context 替换、Swipe 生命周期和保存时序。

## 7. 回退

影子试点的回退是停止使用候选 View、保留现有 `getTimingInstances()`、`getParticipantAggregations()` 和 Coordinator 调用链。不得通过删除 readback 或提前返回来回退。若要进入生产，必须另行授权并先通过等价性、失效和真实宿主验收。

## 8. 设计结论

- 当前最有证据的局部重复是本地 owner snapshot clone/scan，而不是官方 Chat GET。
- 最小、可回退的候选是“单次 Timing 操作内的只读影子 View + baseline compare”，不是直接改变生产读路径。
- 当前没有证据证明该候选能减少任何 `/api/chats/get`，也没有证据证明它能改善用户观察到的 Timing 等待。
- 若执行阶段不能先建立内部 View 计数和等价性测试，应保持现状，不实施候选。
