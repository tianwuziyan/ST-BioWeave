# ST-BioWeave：Coordinator no-op 权威读取复用并发测试审计

审计分支：`fix/world-model-prompt-baseline`（执行时未切换分支）
审计日期：2026-10-17
范围：当前源码、现有测试、隔离 Mock Authority、既有 Floor 写入审计报告。
生产逻辑变更：无。

## 1. 执行摘要

结论先行：当前没有达到生产实施标准的 GET 复用方案。

当前单笔普通 Coordinator no-op 的真实官方 I/O 基线仍是：

| 操作 | Floor 事务 | `/api/chats/get` | `/api/chats/save` | Coordinator 权威 readback |
| --- | ---: | ---: | ---: | ---: |
| 普通 Floor no-op | 1 | 3 | 0 | 1 |
| 普通 Floor changed | 1 | 6 | 1 | 3 个权威读取阶段中的 1 个 Coordinator readback |
| Timing + Aggregation no-op | 2 | 6 | 0 | 2 |
| Timing + Aggregation changed | 2 | 12 | 2 | 6 |

前两行由现有官方 Adapter Mock 的 endpoint 断言直接验证，见 `tests/runtime.test.js:855-976`；后两行来自上一轮审计的组合路径和真实宿主 Debug 证据，见 `.trellis/tasks/10-17-floor-write-path-performance-audit/audit-report.md` 及用户提供的三个 Debug 文件。新增隔离测试进一步验证了单笔 Coordinator no-op 的三阶段顺序，但其 Mock Authority 不是 `/api/chats/get` 网络统计，不能冒充宿主端点计数。

本轮得到三个确定性结果：

1. 候选 A（直接用 `OWNER_ACQUISITION` 结果替代 `LATEST_SLOT_READ`）在同一 Floor 的 Snapshot 于两次读取之间变化时，会把真实变化误判成 no-op；保留最终 readback 也不能恢复被跳过的最新 merge 基线。无条件复用模型为 `PROVEN_UNSAFE`。
2. 候选 B（用 `LATEST_SLOT_READ` 结果替代最终 `COORDINATOR_READBACK`）在两者之间发生 Floor Version 变化时，会把原实现应返回的 `FLOOR_TX_READBACK_FAILED` 变成成功。无条件省略模型为 `PROVEN_UNSAFE`。
3. 候选 C（把 Timing no-op 事务中捕获的 Aggregation 输入跨事务复用）在 Timing 参数不变、Story Time/Exposure/Tracking Window 等依赖变化时，会得到不同的 `before_min` / `in_window` / `overdue` 结果。无条件跨事务复用模型为 `PROVEN_UNSAFE`。

这三个等级只针对报告中明确测试的“直接复用、没有新增原子条件校验”的候选模型。带有新的 CAS、revision 或全量重新读取的其他设计不是同一个候选，当前均为 `UNKNOWN` 或 `TESTED_NOT_PROVEN`，不能进入生产实现。

## 2. 证据边界

本报告区分四类证据：

- `S`：当前生产源码静态分析。
- `T`：现有测试或本轮新增隔离测试的实际断言。
- `H`：真实 SillyTavern Debug/既有宿主观察。
- `M`：本轮 test-only candidate model。它使用确定性 Mock 和 Promise barrier，只证明该模型的时序差异，不证明官方宿主接口行为。

本轮实际新增文件：

- `tests/timing-noop-concurrency-audit.test.js:1-685`：隔离 Authority、deferred barrier、Coordinator baseline 和 A/B/C candidate model。
- `.trellis/tasks/10-17-timing-noop-concurrency-validation/audit-report.md`：本报告。

未修改 `storage/floor-persistence-coordinator.js`、`storage/store.js`、`runtime/events.js`、`runtime/sillytavern-adapter.js` 或其他生产模块。

## 3. 当前 no-op 三次读取的真实调用图

### 3.1 调用顺序

```text
commitFloorPatch()
  └─ 同 transaction_key 排队
     └─ dispatch()
        ├─ resolveLive / owner guard
        ├─ OWNER_ACQUISITION       → 官方 Chat GET #1
        ├─ 可选 FLOOR_VERSION_VALIDATION
        ├─ LATEST_SLOT_READ        → 官方 Chat GET #2
        ├─ SNAPSHOT_MERGE / patchResolver
        ├─ FLOOR_TX_NOOP
        ├─ COORDINATOR_NOOP_GUARD  → 当前 Chat token / execution 检查
        └─ COORDINATOR_READBACK    → 官方 Chat GET #3
           └─ FLOOR_TX_NOOP_FINALIZATION
              └─ sameFloorVersion(expected, readback) 后返回 noop/confirmed
```

源码位置：

- 事务队列和 `transaction_key`：`storage/floor-persistence-coordinator.js:613-708`。
- live owner、Chat、Swipe 与 owner guard：`storage/floor-persistence-coordinator.js:281-320`。
- `OWNER_ACQUISITION`：`storage/floor-persistence-coordinator.js:322-354`。
- 可选当前 Floor Version 校验：`storage/floor-persistence-coordinator.js:356-399`。
- `LATEST_SLOT_READ`：`storage/floor-persistence-coordinator.js:370-407`。
- Snapshot merge 和 no-op 标记：`storage/floor-persistence-coordinator.js:424-451`。
- no-op guard、最终权威回读和版本确认：`storage/floor-persistence-coordinator.js:452-518`。

实际 Runtime 的 `LATEST_SLOT_READ` 通过 `store.readAuthoritativeFloor()` 读取：`runtime/events.js:2065-2083`。Store 在权威读取前捕获 Chat token、完成读取后再次 `assertToken()`：`storage/store.js:910-930`。官方 GET 的默认实现是 `/api/chats/get`：`runtime/sillytavern-adapter.js:397-443`。

### 3.2 三次读取分别返回什么、保护什么

| 阶段 | 数据 | 保护的不变量 | 与前后读取的关系 |
| --- | --- | --- | --- |
| `OWNER_ACQUISITION` | 官方 Chat owner、目标 message、目标 Floor/Swipe 以及 owner/Floor Version 分类结果；`inspectOfficialFloorOwner()` 还检查当前宿主 Chat 身份和 active Swipe | 当前 owner 仍是允许写入的 Character Floor；不是 User Floor；Chat、message、Swipe、六字段 Floor Version 没有被识别为真实 stale owner change | 这是事务进入写路径的资格/收敛读取。它的返回值在当前 Coordinator API 中主要是 classification，不是可直接替代 latest merge 的完整稳定快照；`runtime/events.js:505-575,654-728`。 |
| `LATEST_SLOT_READ` | 当前权威 Floor slot 的 Snapshot，作为 owner patch 的 sibling-preserving merge 基线 | 不把事务创建时的旧 DTO 或 owner acquisition 时的旧 Snapshot 当作最新 merge 基线；保留其他模块的 Snapshot root | 即使内容常常相同，也是在另一个 `await` 后重新取权威时点；`runtime/events.js:2070-2083`。 |
| `COORDINATOR_READBACK` | no-op 判断之后再次取得的权威 Floor slot | no-op 只有在回读存在且六字段 Floor Version 与 expected 完全相同才可返回 `confirmed/noop`；读取传输失败继续失败，版本不符返回 `FLOOR_TX_READBACK_FAILED` | 它发生在 `SNAPSHOT_MERGE` 和 `COORDINATOR_NOOP_GUARD` 之后，不能仅因前一个 GET 相邻就视为同一权威时点；`storage/floor-persistence-coordinator.js:469-517`。 |

注意：no-op 最终化当前明确比较的是 Floor Version，不是整个 Snapshot 的深相等；这是现有业务契约的边界，不应在复用方案中默认为“内容未变化”。

### 3.3 三次读取之间的异步和并发窗口

当前源码存在以下边界：

1. `dispatch()` `await` owner acquisition 返回后，仍可能执行异步的 `resolveCurrentFloorVersion`，然后才进入 latest read：`storage/floor-persistence-coordinator.js:322-370`。
2. `LATEST_SLOT_READ` 返回后，`patchResolver` 仍可以异步执行：`storage/floor-persistence-coordinator.js:424-431`。本轮 B 测试在这个位置释放同 Floor Floor Version 变更。
3. Snapshot merge 完成后，no-op guard 还要调用 `input.assertCurrent()` 并检查 execution：`storage/floor-persistence-coordinator.js:452-462`。Chat epoch 或 Chat ID 在此之前变化时，不能返回成功。
4. no-op guard 之后仍有一次异步 `store.readAuthoritativeFloor()`；其内部还存在官方 GET 和回读后 Chat token 检查：`storage/floor-persistence-coordinator.js:469-480`、`storage/store.js:910-930`。
5. 同一 `transaction_key` 的 Coordinator 事务串行排队，但队列只约束使用该 Coordinator 的同 key 事务；队列之外的官方 Chat writer 仍可能修改同一 Chat：`storage/floor-persistence-coordinator.js:648-700`。

本轮测试没有使用固定 `setTimeout`。所有窗口由 `deferred()`、`barrier()`、`queueMicrotask()` 和显式 `release` 控制：`tests/timing-noop-concurrency-audit.test.js:24-66`、`:250-307`、`:353-404`。

## 4. 当前生产 I/O 和测试证据

### 4.1 已验证的实际端点计数

| 证据 | operation | Floor tx | `/api/chats/get` | `/api/chats/save` | 权威读取阶段 | 错误/结果 |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `T` `tests/runtime.test.js:918-947` | 普通 Floor changed | 1 | 6 | 1 | owner、latest、save prewrite、save authoritative readback、save final audit、Coordinator readback | confirmed |
| `T` `tests/runtime.test.js:949-969` | 普通 Floor no-op | 1 | 3 | 0 | owner、latest、Coordinator readback | noop/confirmed |
| `T/H` 前两轮审计 | Timing + Aggregation changed | 2 | 12 | 2 | 每笔 changed 事务各自完整链路 | Timing 成功后 Aggregation 可部分失败 |
| `T/H` 前两轮审计 | Timing + Aggregation no-op | 2 | 6 | 0 | 每笔 no-op 各自 owner/latest/readback | 两笔事务均无 SAVE |

`tests/runtime.test.js:831-845` 还直接断言 changed 路径的三次 save-side GET；`tests/runtime.test.js:963-969` 直接断言 no-op 的三个 `io_purpose`。这是真实 Adapter/官方 endpoint Mock 统计，不是只看 trace 推测。

### 4.2 本轮隔离测试计数

本轮 `createAuthorityFixture()` 对真实 Coordinator 进行 stage-level 计数：`tests/timing-noop-concurrency-audit.test.js:47-125`。它验证顺序、结果和错误语义，但这些数字是逻辑读取阶段数，不是 `/api/chats/get` 请求数。

| 场景 | baseline_result | baseline logical GET | baseline SAVE | candidate logical GET | candidate SAVE | 证据 |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 完全 no-op | `noop`, `noWrite=true` | 3 | 0 | 不适用 | 不适用 | `tests/timing-noop-concurrency-audit.test.js:215-248` |
| A：owner 后同 Floor Snapshot 变化 | `confirmed`，并按 latest merge 后 SAVE | 3 | 1 | 2（owner + 保留 readback 的模型） | 0 | `:250-307`，`M` |
| B：latest 后 Floor Version 变化 | `FLOOR_TX_READBACK_FAILED` | 3 | 0 | 2（owner + latest 的模型） | 0 | `:353-404`，`M` |
| C：Timing no-op 后 Aggregation 输入变化 | 重新得到 `in_window` | 官方 GET 未在该领域模型中测量 | 未进入 Floor writer | 官方 GET 未测量 | 未测量 | `:597-668`，`M` |

不能把 A/B 的模型 `3 → 2` 写成生产承诺；它们只说明“省掉一阶段”会丢失一个并发保护。C 没有调用官方 Adapter，因此请求数必须保持 `UNMEASURED`。

## 5. 候选 A：Owner Acquisition → Latest Slot Read

### 5.1 直接复用模型的反例

测试时序：`tests/timing-noop-concurrency-audit.test.js:250-307`。

```text
T0  expected Floor Version = V；OWNER_ACQUISITION 返回 Snapshot S，world_model={stable:true}，sourceRevision=R1。
T1  owner acquisition promise 已完成；同一 Floor 的外部写入把 world_model 改为 changed，sourceRevision 变为 R2，Floor Version 仍为 V。
T2  原实现执行 LATEST_SLOT_READ，取得 S'；发现目标不是 no-op，按 S' merge，SAVE，再 readback，最终恢复 desired world_model。
T2' 候选 A 把 S 当作 latest；看到 desired 已相同，直接判定 no-op。即使保留最终 readback，也没有用 S' 作为本次 merge/no-op 判断基线，目标 Snapshot 没有被恢复。
```

测试记录：

```text
baseline_result      = confirmed
candidate_result     = noop_confirmed
baseline_get_count   = 3 logical stages
candidate_get_count  = 2 logical stages
concurrent_mutation  = world_model + sourceRevision after OWNER_ACQUISITION
invariant_preserved  = false
```

同一测试还证明：如果候选 A 用 stale owner Snapshot 构造 changed patch，新的 `events` sibling 会被旧值覆盖；原实现从 latest merge 可以保留新 sibling：`:309-351`。

### 5.2 为什么不能靠 source revision 直接修复

`runtime/sillytavern-adapter.js:363-372` 的 `sourceRevision` 是对一次已返回 Chat owner 状态的稳定内容哈希；它包含 Chat/character/group/header/metadata/messages，但不是锁，也不包含 Chat boundary epoch。要知道 R1 是否变成 R2，仍要重新读取或使用宿主原子条件写入。当前 Coordinator 的 A 复用模型没有这样的原子比较。

因此：

- “两次 GET 返回的 Chat 内容通常相同”不是安全证明。
- “同一 Chat、同一 Floor Version”也不是 Snapshot 未变化证明；Snapshot root 可以在不改变 message-derived Floor Version 的情况下变化。
- 如果新增 revision 比较但比较和后续写入仍是两个非原子调用，仍不能称为 CAS。

### 5.3 证据等级

| 候选 | 结论 |
| --- | --- |
| A：无条件 owner → latest 复用，保留现有最终 readback | `PROVEN_UNSAFE`：有确定性 same-Floor Snapshot 反例 |
| A：增加新的 source revision/CAS guard 后再复用 | `UNKNOWN`：当前 SillyTavern 默认接口没有足够契约证据 |

## 6. 候选 B：Latest Slot Read → Coordinator Readback

### 6.1 直接复用模型的反例

测试时序：`tests/timing-noop-concurrency-audit.test.js:353-404`。

```text
T0  owner 和 latest 都取得旧 Floor Version V，world_model={stable:true}。
T1  SNAPSHOT_MERGE 的 patchResolver 已收到 latest；外部写入把 content_hash/message_version 改为 hash-b/v2。
T2  原实现仍执行 COORDINATOR_READBACK，看到实际版本 != V，返回 FLOOR_TX_READBACK_FAILED，SAVE=0。
T2' 候选 B 跳过最终 readback，使用旧 latest 直接返回 noop/confirmed。
```

测试记录：

```text
baseline_result      = FLOOR_TX_READBACK_FAILED
candidate_result     = noop_confirmed
baseline_get_count   = 3 logical stages
candidate_get_count  = 2 logical stages
concurrent_mutation  = content_hash + message_version after LATEST_SLOT_READ
invariant_preserved  = false
```

Coordinator no-op 最终化的实际错误语义在 `storage/floor-persistence-coordinator.js:482-514`：缺少回读或六字段版本不相等时是 `FLOOR_TX_READBACK_FAILED`，不能把“latest 读过”替换成成功凭据。

本轮还逐项改变了 `chat_id`、`message_id`、`floor`、`swipe_id`、`content_hash`、`message_version`，并验证 no-op readback 不确认：`tests/timing-noop-concurrency-audit.test.js:450-486`。这覆盖了 Floor Version 六字段；纯宿主 active Swipe 指针变化而 Snapshot Floor Version 暂时不变的情况仍缺少真实宿主证明，见第 11 节。

### 6.2 Chat/epoch 窗口

在 latest 之后、no-op guard 之前：

- Chat epoch invalidation 会使 `createChatBoundary().assert(token)` 抛出 `STALE_CHAT`，且不会进入 Coordinator readback 或 SAVE：`runtime/chat.js:24-63`、`tests/timing-noop-concurrency-audit.test.js:406-426`。
- Chat ID 切换同样失败：`tests/timing-noop-concurrency-audit.test.js:428-448`。

这说明最终 readback 不是唯一保护，但也说明它不能被删除后假设 Chat token 检查已经覆盖 Floor Version/官方 Snapshot 的变化。

### 6.3 证据等级

| 候选 | 结论 |
| --- | --- |
| B：无条件 latest → Coordinator readback 复用 | `PROVEN_UNSAFE`：有确定性 Floor Version stale 反例 |
| B：用宿主原子 revision/CAS 替代 GET | `UNKNOWN`：当前默认 `/api/chats/save` 没有源码证明的 expected-revision 条件写入 |

## 7. 候选 C：Timing → Aggregation 跨事务复用

### 7.1 当前为什么 Timing no-op 仍必须重评估

手动编辑的 Runtime 顺序是：

1. `editCharacterTimingInstance()` 先解析当前 Timing Instance：`runtime/events.js:5480-5578`。
2. 调用 `projectionTimingPersistence.editTimingInstance()` 进入 Timing Floor owner 事务：`runtime/events.js:5681-5713`；Storage 使用 `owner: 'projection'`：`storage/projection-timing.js:219-295`。
3. Timing 业务 readback 验证 cycle、五项参数、variance、frozen sampled offset 和 effective range：`runtime/events.js:5716-5764`。
4. 无论参数是否改变，手动编辑都构造 Aggregation reevaluation 输入，并明确把 `aggregation: null` 传给 trigger resolver，避免已有 success shortcut：`runtime/events.js:5795-5822`。
5. `before_min` 可删除已有 Aggregation；eligible 的 `in_window/overdue` 路径可创建或更新 Aggregation；失败和 readback 也有独立语义：`runtime/events.js:5861-6006`。

因此 Timing no-op 只说明 Timing Snapshot 无需变化，不说明以下输入无变化：

- 当前 Story Time；
- 当前 Event/Exposure 集合及 accepted exposure IDs；
- Tracking Window 的 subject、mechanism、cycle、source event 关联；
- 当前 Aggregation 是否已存在、状态和 source basis；
- 其他同 Floor 依赖结果；
- `柳如烟` 与 `祁鸢` 各自的 subject-local 输入。

### 7.2 确定性跨事务反例

`tests/timing-noop-concurrency-audit.test.js:597-668` 使用两个角色：

```text
T0  Timing 参数不变，Timing no-op 捕获柳如烟 story_time=5，before_min=10。
T1  Timing no-op 已完成；在 Aggregation input read 之前，柳如烟 story_time 变为 15。
T2  原实现重新读当前输入，柳如烟结果为 in_window；祁鸢保持 none。
T2' 候选 C 复用 Timing 事务捕获的旧输入，柳如烟仍为 before_min。
```

这不是某个具体官方 GET 次数的测试；该测试故意只验证业务输入在两个事务之间变化时的结果差异，官方 Chat I/O 计数为 `UNMEASURED_IN_THIS_DOMAIN_MODEL`。

### 7.3 部分成功语义

Timing 成功后 Aggregation 可能独立持久化失败。当前 Runtime 会保留 `timing_persisted: true` 并返回 Aggregation failure，而不是把整次操作改报成功：`runtime/events.js:5964-5981`；隔离测试保留这一边界：`tests/timing-noop-concurrency-audit.test.js:670-685`。

跨事务复用不能改变这个顺序或把 Aggregation 失败吞掉；否则会破坏“Timing 成功、Aggregation 失败”的部分成功语义。

### 7.4 证据等级

| 候选 | 结论 |
| --- | --- |
| C：无条件复用 Timing 事务捕获的全部 Aggregation 输入 | `PROVEN_UNSAFE`：有输入变化导致业务结果不同的确定性反例 |
| C：只复用 Timing 结果、重新读取所有 Aggregation 输入 | `TESTED_NOT_PROVEN`/`UNKNOWN`：本轮没有实现或验证该窄化方案，也没有请求减少证明 |

## 8. source revision、Floor Version 与 CAS 审计

### 8.1 当前 revision 能识别什么

- `sourceRevision` 是 `runtime/sillytavern-adapter.js:363-372` 对一次官方 Chat owner 返回值的内容哈希。
- 它可以在“已经取得两份 Chat 内容”后识别序列化 owner state 是否不同；不能在没有第二次读取时知道外部状态是否变化。
- 它不等于 `runtime/chat.js` 的 Chat epoch。epoch/token 在 `runtime/chat.js:24-63` 保护生命周期/Chat 切换，但不是服务器写入锁。
- Floor Version 是六字段 `chat_id/message_id/floor/swipe_id/content_hash/message_version`：`runtime/floor.js:1-8,130-167`。它绑定消息事实和 Swipe，不承诺所有 BioWeave Snapshot root 变更都会改变版本。
- 应用层读到 revision/version 后再进行另一个写入调用，不是原子 CAS；读写之间仍存在窗口。

### 8.2 当前默认写入是否提供 CAS

- Store 仅在存在显式 CAS writer 或明确能力标记、且调用者提供 `expectedRevision` 时，才允许 source-owner revision CAS：`storage/store.js:721-750,1028-1057`。
- 默认 SillyTavern Chat 保存构造普通 `/api/chats/save` body，没有 `expectedRevision` 或条件写入字段：`runtime/sillytavern-adapter.js:444-485`。
- `runtime/events.js:1532-1567` 把 `officialLatestMerge` 作为能力检测结果之一；这只能说明可以调用官方最新合并路径，不能证明 SillyTavern 服务端执行 compare-and-swap。
- 目前没有源码或本轮测试证明官方 `/api/chats/save` 能以 Chat revision、Floor Version、Swipe 和 epoch 作为服务器端原子条件拒绝写入。

结论：没有 CAS 时，A/B 只能在仍保留独立权威读取和当前 stale/readback 语义的条件下研究；不能把 source revision 哈希本身当成可替代 GET 的锁。

## 9. 并发场景测试结果

| 场景 | 原始实现测试结果 | candidate model 结果 | 业务契约是否保留 |
| --- | --- | --- | --- |
| 无并发、完全 no-op | 3 阶段读取、0 SAVE、`noop` | 不适用 | 是 |
| Owner Acquisition 后同 Floor Snapshot 改变 | latest 看到变化并 SAVE/确认 | A 误报 no-op；或 stale merge 丢 sibling | 否，A 反例 |
| Latest 后 Floor Version 改变 | `FLOOR_TX_READBACK_FAILED` | B 返回成功 | 否，B 反例 |
| Latest 后 Chat epoch invalidation | `STALE_CHAT`，无 readback/SAVE | 不能跳过 guard | 是，原实现保留 |
| Latest 后 Chat ID 切换 | `STALE_CHAT`，无 readback/SAVE | 不能跳过 guard | 是，原实现保留 |
| 六字段 Floor Version 任一变化 | no-op readback 失败 | 省略 readback 无法发现 | 原实现保留 |
| Active Swipe 同时随 authoritative version 变化 | `FLOOR_TX_READBACK_FAILED` | 省略 readback 会误报 | 原实现保留 |
| Owner/Latest/Readback GET 失败 | 分别在对应边界失败，不 SAVE | 没有成功伪装 | 是 |
| Coordinator 队列中已有同 key 事务 | 第二笔等待第一笔完成；两笔各自读取 | 不能跨事务共用 | 是 |
| Timing no-op 后 Aggregation 输入变化 | 重新计算并可能改变状态/写入 | C 使用旧输入 | 否，C 反例 |
| Timing 成功、Aggregation 持久化失败 | partial success | 不能改成整体成功 | 是，现有语义 |

同 key 队列的实际测试在 `tests/timing-noop-concurrency-audit.test.js:566-595`；现有 Coordinator 的 queue/cancel 断言在 `tests/floor-persistence-coordinator.test.js:158-184`。

## 10. 候选方案证据矩阵

| 候选 | 理论减少的 logical GET | 确定性反例 | 当前证据等级 | 是否可进入生产 |
| --- | ---: | --- | --- | --- |
| A：Owner → Latest 复用 | 1 | 同 Floor Snapshot/source revision 在 owner 完成后变化；目标被误判 no-op，或 stale merge 丢 sibling | `PROVEN_UNSAFE` | 否 |
| B：Latest → Readback 复用 | 1 | latest 后六字段 Floor Version 变化；原实现应 `FLOOR_TX_READBACK_FAILED`，候选成功 | `PROVEN_UNSAFE` | 否 |
| C：Timing → Aggregation 跨事务复用 | UNKNOWN；本轮没有生产 I/O 模型 | Timing no-op 后当前 Story Time/Exposure/Window 变化，Aggregation 结果不同 | `PROVEN_UNSAFE`（针对无条件全量输入复用） | 否 |

证据等级含义：

- `PROVEN_UNSAFE`：已有确定性反例。
- `TESTED_NOT_PROVEN`：有限测试通过但没有完整安全保证。
- `CONTRACT_SUPPORTED`：源码、接口契约和测试共同支持。
- `UNKNOWN`：证据不足。

本轮没有任何候选达到 `CONTRACT_SUPPORTED`。

## 11. 当前测试覆盖与仍缺少的证据

### 11.1 已执行并通过

- `node --test tests/timing-noop-concurrency-audit.test.js`：15 passed，0 failed。
- `node --test tests/floor-persistence-coordinator.test.js tests/runtime.test.js`：55 passed，0 failed。
- `npm run check`：总计 1589，1573 passed，16 skipped，0 failed；包含 `node --check index.js`。
- `git diff --check`：通过。

新增测试覆盖：

- no-op 三次读取基线和顺序：`:215-248`；
- A 的 owner 后 Snapshot/source revision 变化与 sibling stale merge：`:250-351`；
- B 的 latest 后 Floor Version 变化和 readback 错误：`:353-404`；
- Chat epoch、Chat ID、六字段 Floor Version、Swipe：`:406-508`；
- owner/latest/readback GET failure：`:510-564`；
- same-key Coordinator queue：`:566-595`；
- Timing no-op 后 Aggregation 输入变化、柳如烟/祁鸢独立结果：`:597-668`；
- Timing/Aggregation partial-success 边界模型：`:670-685`。

### 11.2 仍未证明

1. 当前隔离 Mock 没有实现真正的 SillyTavern HTTP server；因此不能证明 `/api/chats/save` 是否存在未文档化的服务器端 CAS。
2. 没有真实宿主级测试能在两个独立 `/api/chats/get` 之间插入另一个官方 `/api/chats/save` 并读取服务器最终仲裁结果；本轮只用 Mock Authority 证明 Coordinator 行为差异。
3. 本轮 Swipe 测试改变了 authoritative Floor Version 的 `swipe_id`；“宿主 active Swipe 指针先切换但 Floor Version 暂时不变”的窗口仍需真实宿主契约或 Adapter 测试。
4. `sourceRevision` 能否在真实宿主中稳定覆盖 message、swipe_info、metadata 和其他外部 writer 的全部可见变化，源码只能确认哈希输入，不足以确认服务器并发语义。
5. Timing + Aggregation 的 `6 GET/0 SAVE` 和 `12 GET/2 SAVE` 是既有组合测试/Debug 证据；本轮没有为了重复统计而修改生产 Runtime 或真实 Chat。
6. 本轮没有实现“带 CAS 的 A/B”候选；因此不能把 `PROVEN_UNSAFE` 的直接模型反向解释为所有可能的未来 CAS 方案都不可能，只能说当前没有可用契约支撑它们。

## 12. 风险分级建议

### P0：无

本轮没有发现已确认的生产正确性错误可以通过删除 GET 修复；也没有发现应立即删除的重复请求。

### P1：无

没有一个 GET 删除候选同时具备低风险、现有契约支持和明确收益。将 A/B 标为 P1 会把测试模型的请求减少误写成安全结论。

### P2：先补宿主条件写入契约，再重新审计

对应源码：`runtime/sillytavern-adapter.js:397-485`、`storage/store.js:721-750,1028-1057`。
当前行为：默认官方 Chat GET/SAVE 是应用层读取、普通保存和回读；没有确认的服务器 CAS。
潜在收益：若宿主提供覆盖完整 Chat owner 的原子 expected-revision/CAS，理论上可能替代某一阶段读取，但净 GET/SAVE 数量必须重新由真实 Adapter 测试测量；当前收益为 `UNKNOWN`。
事务边界：不能改变现有 Floor Version、Swipe、epoch 校验，也不能把 Timing/Aggregation 合并成一笔事务。
并发风险：外部 writer、同 Chat 不同模块、active Swipe、服务端保存仲裁必须由宿主保证。
所需测试：真实或契约级 CAS 成功/失败、同 Floor sibling、Chat 切换、Swipe 切换、epoch、external writer、save failure、readback failure、partial success。
是否立即实施：否；先取得宿主接口保证。

### P2：补齐真实宿主竞争测试后，再分别评估 A/B

对应源码：`storage/floor-persistence-coordinator.js:322-518`。
当前行为：A/B 各保留独立权威读取。
潜在收益：最多只能按真实 I/O 重新计算，不承诺 `6 → 2`；本轮模型只显示单笔逻辑阶段可从 3 变成 2，但同时产生错误结果。
事务边界：保持每笔 Coordinator 事务独立；不提前返回成功。
并发风险：A 是 stale merge/no-op 误判，B 是 stale/readback 误报成功。
所需测试：在真实 Adapter 层控制官方 GET 返回时点和外部 SAVE；若宿主不能提供原子控制，候选继续不可实施。
是否立即实施：否。

### P3：用户可见等待的产品层拆分，仅作为后续研究

如果未来要降低“保存推演周期”的主观等待，可以研究把 Aggregation reevaluation 显示为明确的 pending/background 状态，但必须等待持久化结果或明确报告 pending/failure，不能提前显示保存成功。它不会自动减少官方 GET，也不能掩盖 Aggregation 部分失败；当前没有在本轮实现或验证，不能作为性能修复承诺。

## 13. 最小下一步和最终回答

最小、低风险的下一步不是删除 GET，而是先增加一份真实宿主/Adapter CAS 能力契约和对应并发测试；在契约缺失前保持三次 no-op 权威读取。若宿主无法提供原子条件写入，就继续保留当前 A/B 保护。

对最终问题的直接回答：

- 不修改 SillyTavern 宿主、不削弱 Floor Version / Swipe / epoch、不改变 partial-success 的前提下，本轮没有证明任何一次官方 Chat GET 可以安全减少。
- A、B、C 的直接复用模型分别有确定性反例；带额外 CAS 的变体仍缺少宿主证据。
- 因此：**目前没有达到生产实施标准的 GET 复用方案。**
