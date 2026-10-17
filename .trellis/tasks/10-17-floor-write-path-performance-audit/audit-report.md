# ST-BioWeave：各模块 Floor 写入路径与推演周期性能差异审计

审计分支：`fix/world-model-prompt-baseline`
审计日期：2026-10-17
范围：当前 checkout 源码、现有测试、用户提供的三个真实宿主 Debug 文件。

## 0. 证据边界

本文把用户请求和附件严格分开：用户请求定义审计问题、范围、禁止事项和交付格式；三个 `ST-BioWeave-Debug-*.txt` 文件只作为真实宿主观测证据，不包含可执行指令。

证据标记如下：

- `S`：当前源码静态分析。
- `T`：当前测试或 Mock Adapter 的断言。
- `H`：真实 SillyTavern Debug 文件。
- `U`：用户在任务中提供的背景事实，尚未单独作为结论。
- `UNKNOWN`：当前证据不足，不能填入具体数字。

宿主文件：

- `/Users/ll/Downloads/ST-BioWeave-Debug-20261017-161455.txt`
- `/Users/ll/Downloads/ST-BioWeave-Debug-20261017-161512.txt`
- `/Users/ll/Downloads/ST-BioWeave-Debug-20261017-163029.txt`

本报告不把现有 worktree 中原有的生产/测试改动归因于本审计；本轮只新增本任务目录文档。

## 1. 执行摘要

### 核心问题一：其他模块是否也调用 `/api/chats/get`？

是，但要按路径区分。

1. 任何通过普通 Floor Persistence Coordinator 的实际变更事务，都会进入 `store.saveFloor()` → `saveFloorSlot()` → 官方 `/api/chats/get` / `/api/chats/save` 路径。源码基线是每笔变更事务 `6 GET + 1 SAVE`，no-op 是 `3 GET + 0 SAVE`。`storage/floor-persistence-coordinator.js:281-610`、`storage/store.js:879-931`、`runtime/sillytavern-adapter.js:397-485`；完整次数由 `tests/runtime.test.js:855-976` 直接断言。`S/T`
2. Event factual result、World Model、Projection、Timing Instance、Participant Aggregation、Health 和 Lifecycle 的普通 owner patch 都复用这个 Coordinator；它们没有被源码证明使用更少的官方 GET。`storage/floor-persistence-coordinator.js:9-20`。`S`
3. Character Timing Config 不是 Floor 写入，而是 Chat-local metadata；它走 `store.saveChat()` → `saveChatMetadata()`，没有普通 Floor Coordinator，也没有当前代码中的 `/api/chats/get`。`storage/character-timing.js:3-23`、`storage/store.js:810-828`、`runtime/events.js:1632-1651`。`S`
4. Current State、Tracking Registry 和普通 Tracking Window 派生主要是宿主内存计算。Tracking Window 有独立 Floor 写入能力，但当前源码搜索没有找到生产调用 `resolveTrackingWindows()` 或直接 `appendTrackingWindow()` 的调用点；因此不能把当前 `refreshTrackingRegistry()` 报成已发生的官方 I/O。`runtime/tracking-window-runtime.js:29-42`、`runtime/tracking-runtime.js:57-83`、`runtime/event-analysis.js:2454-2466`。`S/UNKNOWN`
5. 低层 `saveFloorBioWeave()` 测试路径能做到 `3 GET + 1 SAVE`，但它绕过普通 Coordinator，且返回的 `saveChat()` 结果可能只是 `unknown/unconfirmed`；架构文档明确禁止普通业务模块以此作为 precedent。`runtime/events.js:1655-1714`、`tests/runtime.test.js:773-853`、`docs/ARCHITECTURE.md:323-325`。`S/T`

所以，“其他模块似乎更快”不能直接解释为它们没有 Chat GET。更可能的差异是：某些操作只是内存派生或 Chat-local 配置；普通分析的下游写入可能在 AI/事件成功之后后台执行；而手动 Timing 编辑把两个 Floor 事务和两个业务结果 readback 同步串在一个 UI 等待中。

### 核心问题二：为什么手动保存推演周期明显慢？

当前已经有证据支持的原因按影响排序是：

- 一次手动编辑通常包含 `TIMING_INSTANCE` 一笔事务，随后同步重新评估 `PARTICIPANT_AGGREGATION`，再产生第二笔独立事务。`runtime/events.js:5681-6033`。`S`
- 每笔实际变更事务是 `6 GET + 1 SAVE`，因此连续实际修改通常是 `12 GET + 2 SAVE`；每笔 no-op 仍有 `3 GET + 0 SAVE`，因此连续 no-op 是 `6 GET + 0 SAVE`。`tests/runtime.test.js:918-968`、三个 Debug 文件。`T/H`
- UI 在 `await runtime.editCharacterTimingInstance()` 返回前保持 `saving=true`，等待 Timing 持久化、Timing 业务 readback、Aggregation 重评估和 Aggregation readback。`ui/app.js:4181-4369`。`S`
- Debug 样本显示官方 GET 偶发占据秒级：161455 的 Timing no-op owner acquisition 约 2470.1ms，Coordinator readback 约 1742.5ms；163029 的 Aggregation no-op latest slot 约 1739.2ms、Coordinator readback 约 1865.5ms。`H`
- JSON 解析并非唯一主因；同一批样本的慢点分布在网络等待或响应体/解析阶段，必须以每次 `official_io_calls` 的字段为准，不能用“解析只有数毫秒”概括整个 GET。`runtime/sillytavern-adapter.js:274-360`、Debug 的 `official_io_calls`。`S/H`

## 2. Floor 写入根与统一存储路径

### 2.1 Coordinator owner 表

`storage/floor-persistence-coordinator.js:9-20` 是当前实际 owner 字段表：

| Coordinator owner | Floor 根 | 主要入口 |
|---|---|---|
| `world` | `world_model`, `world_model_meta` | `runtime/world-analysis.js::saveWorldModel` |
| `event` | `analysis`, `events`, `character_registry` | `runtime/character-event-analysis.js`、`runtime/event-editing.js` |
| `projection` | `snapshot`, `projection_timeline`, `projection_timing_snapshot` | `storage/projection.js`、`storage/projection-timing.js`、Snapshot |
| `tracking` | `tracking_window_timeline` | `storage/tracking-window.js` |
| `participant_aggregation` | `participant_aggregation_snapshot` | `storage/participant-aggregation.js` |
| `lifecycle` | `pregnancy_lifecycle_timeline`, `events` | `storage/pregnancy-lifecycle.js` |
| `health` | `health_assessment_timeline` | `runtime/health-assessment.js` |
| `terminal` | `analysis` | `runtime/event-analysis.js` terminal 状态 |

普通 owner patch 都进入 `createFloorPersistenceCoordinator().commitFloorPatch()`。`runtime/floor-persistence.js:1-7` 只是兼容 re-export，不是第二套持久化实现。

### 2.2 一笔普通 Coordinator 事务的固定阶段

| 阶段 | 源码位置 | 实际读取/作用 | 本审计分类 |
|---|---|---|---|
| `OWNER_ACQUISITION` | `storage/floor-persistence-coordinator.js:322-354` → `runtime/events.js:654-728` | 官方 owner Chat、目标 message、active Swipe、完整六字段 Floor Version；判断 host-ahead、真实 stale owner 和是否允许 convergence | `A` |
| `LATEST_SLOT_READ` | `storage/floor-persistence-coordinator.js:356-407`；`runtime/events.js:2065-2083` | 再取最新权威 Floor slot，作为 owner patch 的 sibling-preserving merge 基线 | `A` |
| `SAVE_PREWRITE_READ` | `runtime/events.js:1001-1115` | 写入前再次取得官方 owner，解析 message/Swipe，验证 owner、active Swipe 和官方 Floor Version | `B` |
| `SAVE_WRITE` | `runtime/events.js:1278-1305`；`runtime/sillytavern-adapter.js:444-485` | 官方 `/api/chats/save` | 不适用 GET 分类 |
| `SAVE_AUTHORITATIVE_READBACK` | `runtime/events.js:1325-1366` | 写入后官方读取，比较目标 slot 是否完全等于 merged value | `A` |
| `SAVE_FINAL_SLOT_AUDIT` | `runtime/events.js:1367-1432` | host memory sync 后再次官方读取，同时审计 host/official owner、Swipe、Floor Version 和 sibling presence | `B` |
| `COORDINATOR_READBACK` | `storage/floor-persistence-coordinator.js:543-610` | Coordinator 边界再次通过 `store.readAuthoritativeFloor()` 验证 owner patch、兄弟根和六字段版本，才返回 `confirmed` | `B` |

实际普通变更事务：`OWNER_ACQUISITION`、`LATEST_SLOT_READ`、`SAVE_PREWRITE_READ` 是前写入的 3 GET；`SAVE_WRITE` 是 1 SAVE；`SAVE_AUTHORITATIVE_READBACK`、`SAVE_FINAL_SLOT_AUDIT`、`COORDINATOR_READBACK` 再产生 3 GET，合计 `6 GET + 1 SAVE`。no-op 在 `storage/floor-persistence-coordinator.js:452-518` 仍执行 owner、latest、Coordinator readback，合计 `3 GET + 0 SAVE`。

## 3. 跨模块入口清单与调用链

### 3.1 Event Analysis / Event Projection

**用户入口与 Runtime：**

- 手动人物分析：`ui/app.js:4675-4697::manualRefreshEventAnalysis` → `runtime/event-analysis.js:4211-4220::analyzeCurrentCharacterEvents` → Event execution。
- 自动 Character Floor：同一 `runEventAttempt` 管线；本审计的保存边界在 `runtime/character-event-analysis.js:953-986`。
- Event 编辑/删除：`ui/app.js:4591-4611` → `runtime/event-editing.js:243-300::updateEvent/deleteEvent`；删除路径在 `runtime/event-editing.js:303-328`。

**Storage 与持久化：**

- AI 结果规范化后把 `analysis`、完整 `events` 集合和 `character_registry` 一次性提交给 `commitFloorPatch(target, "event", ...)`。`runtime/character-event-analysis.js:953-986`。
- Runtime bridge 在 `runtime/event-analysis.js:804-837` 将它转给 shared Coordinator；不是直接调用 `store.saveFloor()`。
- 因为一份 AI 结果可以含多个 Event，多个 Event 是同一 `event` owner patch 中的一个数组，不是每个 Event 一笔事务。`runtime/character-event-analysis.js:977-980`。
- unchanged 结果不会再次写 Event root，但可能按间隔生成 Snapshot。`runtime/character-event-analysis.js:930-948`、`runtime/event-analysis.js:2176-2222`。

**目标、回读、等待、错误：**

- 目标是当前 Character message/active Swipe 的 Floor `analysis/events/character_registry`；Current State 是从这些事实派生的内存状态，不是独立 Character State Floor root。`core/state.js:740-766`、`runtime/event-analysis.js:2234-2336`。
- Event owner 的实际变更事务若进入普通 Coordinator，静态基线为 `6 GET + 1 SAVE`；no-op 为 `3 GET + 0 SAVE`。但现有 Event Runtime fixture 多数注入直接的内存 `saveFloorBioWeave` mock，没有独立官方 I/O 次数证明，模块级真实数量为 `UNKNOWN`。
- Event factual save 后会做当前 Floor 的本地 canonical 检查，随后可选 Health、Snapshot、Lifecycle 写入。`runtime/character-event-analysis.js:996-1058`。这些下游不是 Event owner 同一事务。
- Event 成功通知在 `runtime/event-analysis.js:3389-3414` 先发出；Projection postprocessor 通过 `void projectionPostProcessor(...)` 后台启动。Event 编辑/删除后的 Projection 也在 `runtime/events.js:3709-3718` 以 `void projectionRuntime.process(...)` 启动。因此 Event UI 等待 Event 自身，但不等待所有 Projection 下游 Floor 写入。`S`
- 失败时 Event factual save 失败会抛错并保留旧事实；Health 是下游，Health 失败不会回滚 factual Event。`runtime/character-event-analysis.js:1016-1032`。

**结论：** Event 不是已证实的“无 Chat GET”路径；它与普通 Timing 单笔事务共享官方保存架构。用户感觉较快的一部分原因是 Projection 下游被放到后台，且 Event 的一份多 Event 结果只提交一个 Event owner patch。

### 3.2 World Model

**入口与写入：**

- 手动 Section 保存：`ui/app.js:2664-2726::saveWorldModelSection` → `runtime/world-analysis.js:351-408::saveWorldModel`。
- AI Full/Patch：`ui/app.js:3041-3188::analyzeWorldModel` → `runtime/world-analysis.js:620-705`；非 canonical no-op 时才调用 `saveWorldModel()`。
- `saveWorldModel()` 在 `runtime/world-analysis.js:383-392` 调用 `commitFloorPatch(target, "world", {world_model, world_model_meta})`。

**目标与比较：**

- 目标是同一 Character Floor 的 `world_model/world_model_meta`，独立于 Event owner；兄弟根由 Coordinator merge 保留。
- 与 Event 使用同一 Coordinator/Store/official adapter path，不存在 World 专属的更少 GET 路径。`runtime/world-analysis.js:383-392`、`storage/floor-persistence-coordinator.js:9-20`。
- World 的版本、Swipe、owner、权威回读检查来自公共 Coordinator，而不是另设一个 World CAS。World 自己在写入前后还有本地 `resolveCurrentFloor()` / `getFloor()` / `resolveWorldModelUiReady()` 检查。`runtime/world-analysis.js:362-380`、`runtime/world-analysis.js:707-715`。
- `canonicalNoop` 明确跳过 Floor 事务。`runtime/world-analysis.js:620-681`；此时不会发生该路径的官方 GET/SAVE，静态结果为 `0/0`，但没有对应真实宿主 Debug 样本。

**UI 等待：**

- `saveWorldModelSection()` await Floor save 后再 await `refreshTrackingAfterWorldModelSave()`；后者只是 `refreshTrackingRegistry()` 的内存派生刷新，失败会记录并留待生命周期重试。`ui/app.js:2652-2662`、`ui/app.js:2699-2724`。
- Full/Patch 分析 await Runtime 分析结果和持久化，之后才提示完成。`ui/app.js:3082-3161`。

**结论：** World 的实际 Floor 变更若发生，静态上与 Event/TIMING 单笔事务成本相同；World 没有额外的官方前后回读。当前没有 World 的真实宿主 I/O 样本，因此“World 更快”不能从附件确认。

### 3.3 Character Analysis / Character State

- “Character Analysis”不是另一个独立 Floor owner；它就是 Event owner 的 `analysis/events/character_registry` patch。`storage/floor-persistence-coordinator.js:11`、`runtime/character-event-analysis.js:977-980`。
- “Character State”由 `core/state.js::reduceState` 和 `runtime/event-analysis.js::collectCurrentDerivedState` 从当前有效 Event/Registry/Health facts 派生，读取时不会写 Snapshot。`core/state.js:740-766`、`runtime/event-analysis.js:2234-2336`。
- `updateCharacterAliases()` 只修改 Event owner 的 `character_registry` 字段，仍是一笔 event Coordinator 事务；没有独立 Character State 事务。`runtime/event-analysis.js:1780-1819`。
- 角色分析一次响应中的多个角色/多个 Event 被组合进一个完整 registry/events patch；不存在“每个角色一笔保存”的源码证据。
- UI 对手动人物分析 await `manualAnalysis.analyzeCurrentCharacterEvents()`，但成功后的 Projection postprocessor 不在该 await 中。`ui/app.js:4675-4697`、`runtime/event-analysis.js:3389-3414`。
- 现有 Event Runtime tests 能证明本地 Floor save、完整集合、stale/Swipe 保护；不能独立证明真实宿主官方 GET/SAVE 次数，模块级为 `UNKNOWN`。`tests/event-analysis-runtime.test.js:171-203`、多个 `saveFloorCalls()` 断言。

### 3.4 Tracking Window

**能力边界：**

- `storage/tracking-window.js:16-74::createTrackingWindowPersistence` 以 `owner: 'tracking'` 调用 Coordinator；`saveTrackingWindowTimeline()` 是替换式一笔 owner patch，`appendTrackingWindow()` 是新建一笔 owner patch，重复项在写入前 dedupe。
- `runtime/tracking-window-runtime.js:29-42::resolveTrackingWindows` 只有在被调用且注入 `persist` 时才会 await 持久化；前后各有 `assertCurrent()`。
- Event Analysis 只在组合时注入 `persist` callback，callback 在 `runtime/event-analysis.js:2454-2466` 调用 `saveTrackingWindowTimeline()`。
- 当前 `runtime/tracking-runtime.js:57-83::refreshTrackingRegistry` 只调用 `buildTrackingWindows()` / `buildTrackingRegistry()` 并更新内存 DTO；当前源码搜索没有找到生产调用 `resolveTrackingWindows()`、`appendTrackingWindow()` 或 `saveTrackingWindowTimeline()` 的直接调用点。

**审计结论：**

- 当前普通 Tracking Registry refresh：内存派生，Floor transaction `0`，官方 GET/SAVE `0/0`，没有 Floor persistence await。`S`
- 显式调用 Tracking persistence API：若发生变更，静态基线为 `1` Coordinator tx、`6 GET + 1 SAVE`；dedupe 为 `1` no-op tx、`3 GET + 0 SAVE`。这是能力路径，不是当前宿主操作的观测值，实际当前入口为 `UNKNOWN`。
- 现有 `tests/tracking-window-persistence.test.js:36-62` 只验证内存 mock 的 append/dedupe/Swipe guard，没有官方 endpoint 统计。

### 3.5 Character Timing Config

- UI 在没有当前 Timing Instance 时调用 `runtime.saveCharacterTimingConfig()`，当前编辑有实例时则调用 `editCharacterTimingInstance()`。`ui/app.js:4181-4229`。
- Config 存储是 `storage/character-timing.js:3-23`：读 `store.getChat()`，写 `store.saveChat()`，再本地 `getChat()` readback。
- `store.saveChat()` 调用 `adapter.saveChatMetadata()`；SillyTavern adapter 的实现是 `context.saveMetadata()`，不是 `/api/chats/get` 或普通 `/api/chats/save`。`storage/store.js:810-828`、`runtime/events.js:1632-1651`。
- Floor transaction `0`；Coordinator `否`；Floor authoritative readback `否`；Chat-local metadata readback `是`；UI await metadata save `是`。
- `tests/debug-timing-config.test.js` 与相关 Config 测试验证的是 Chat-local 配置隔离和读回，不是 Floor 官方 GET 次数。

### 3.6 Timing Instance

- Floor root 是完整的 `projection_timing_snapshot`，不是 Chat-local Config。`storage/projection-timing.js:14`、`core/projection-timing-persistence.js:20-110`。
- `storage/projection-timing.js:219-273::mutateFloor` 使用 `owner: 'projection'` 的 shared Coordinator；在 Coordinator 队列内使用最新 authoritative slot，缺 root 时才进行本地历史继承。
- `saveTimingInstance()` / `editTimingInstance()` 在 `storage/projection-timing.js:275-295` 进入同一事务；重复或未找到可返回 no-op，但 Coordinator no-op 仍执行 owner/latest/readback。
- 手动编辑 Runtime 完整路径在 `runtime/events.js:5570-6033`：
  1. `getTimingInstances()` 本地读取当前/历史 Floor；
  2. `editTimingInstance()` 产生一笔 Timing Coordinator 事务；
  3. `getTimingInstances()` 做 Timing 业务 readback；
  4. `collectActiveBusinessData()` 和 `getParticipantAggregations()` 本地收集重评估输入；
  5. 按 trigger 可能 `removeAggregation()` 或 `upsertAggregation()`，产生第二笔 Aggregation Coordinator 事务；
  6. `getParticipantAggregations()` 做 Aggregation 业务 readback。
- 这些 `getTimingInstances()` / `getParticipantAggregations()` 是本地 `getCurrentChatOwnerSnapshot()` + `getFloor()` 历史扫描，不是官方 `/api/chats/get`。`storage/projection-timing.js:338-386`、`storage/participant-aggregation.js:306-350`。
- UI 在 `ui/app.js:4215-4245` await 整个 Runtime；当前 Timing Instance 的成功结果直接复用 Runtime 返回的业务 readback，不再额外调用完整 editor read。`ui/app.js:4247-4279`。
- 若 Timing 已成功而 Aggregation 失败，Runtime 用 `timing_persisted: true` 包装失败，UI 进入 `SAVE_FAILURE_RECONCILIATION_READ`，不会把 Timing 成功伪装成整体成功。`runtime/events.js:5964-5981`、`ui/app.js:4319-4359`。

### 3.7 Participant Aggregation

- Floor root 是 `participant_aggregation_snapshot`。`storage/participant-aggregation.js:14`。
- `storage/participant-aggregation.js:211-255::mutateFloor` 使用 `owner: 'participant_aggregation'` 的 shared Coordinator；`upsertAggregation()`、`removeAggregation()` 和 replace/clear API 在 `:258-286`。
- manual Timing 的下游调用点是 `runtime/events.js:5861-5905`（remove）和 `:5953-6004`（upsert/readback）。它与 Timing root 不共享一笔事务。
- 独立 Aggregation 变更静态基线为 `1 tx + 6 GET + 1 SAVE`；no-op 为 `1 tx + 3 GET + 0 SAVE`。现有 `tests/participant-aggregation.test.js:170-190` 只证明本地 saveCount/dedupe。

### 3.8 Projection AI 结果

- Projection 通过 `storage/projection.js:43-203` 的 `owner: 'projection'` 事务写 `projection_timeline`。
- 一个 AI candidate 在 `runtime/projection-runtime.js:603-632` 先调用 `saveGeneratedProjection()`，然后另行调用 `saveProjectionEvidence()`；当前源码没有将这两个结果合并为一个 owner patch 的路径。
- 已存在 Projection 的 evolution decision、delivery submission/response 和 lifecycle 写入口，分别在 `runtime/projection-runtime.js:438-447`、`:281-318`、`:786-800` 调用 Storage。每个实际变更调用都可能是一笔独立 projection Coordinator 事务。
- 因此一份 Projection AI 结果的事务数不是固定单数：至少 `1`，若 evidence 独立落库通常是 `2`，再加实际 delivery/evolution/lifecycle 结果。具体一次 AI 运行的事务数取决于候选、规则和状态，当前三个 Debug 文件没有 Projection 操作，记为 `UNKNOWN`。
- 每个实际变更事务静态上仍是 `6 GET + 1 SAVE`；每个 dedup/no-op 是 `3 GET + 0 SAVE`。Projection 的 `getProjectionViews()` 是本地宿主快照扫描，不是官方 GET。`storage/projection.js:140-188`。
- Event 成功之后由 `runtime/event-analysis.js:3400-3414` 后台启动，Event UI 不同步等待；Projection 专属 UI 等待策略在当前附件中没有独立宿主证据，记为 `UNKNOWN`。

### 3.9 其他实际 Floor 写入模块

- Snapshot：`runtime/event-analysis.js:2176-2222::maybeCreateSnapshot` 按 `snapshot_interval` 条件生成并通过 `owner: projection` 提交；可在 Event 成功后额外产生一笔 projection 事务，不能与 Event patch 合并。`S`
- Health Assessment：`runtime/health-assessment.js:155-173` 通过 `owner: health` 提交 `health_assessment_timeline`，Coordinator 后再做本地 `getFloor()` readback；是 Event factual save 的下游，不回滚 Event。`S`
- Pregnancy Lifecycle：`storage/pregnancy-lifecycle.js:38-154` 以 `owner: lifecycle` 提交 facts/candidate/archive/release；`archiveAndRelease()` 在 archive、Exposure 删除、release、可选 father cleanup 间可能产生多笔事务，每次都有本地 Store readback。`runtime/events.js:2474-2524` 是 Event 成功后的触发桥。具体一次 lifecycle 操作事务数依输入而定，当前宿主为 `UNKNOWN`。
- Terminal analysis：`runtime/event-analysis.js:3542-3548` 写 `owner: terminal` 的 `analysis` 状态，属于失败/取消状态写入，不是成功 Event factual write。
- Clear / lifecycle invalidation：`storage/floor-persistence-coordinator.js:710-745` 的 `clearFloorSlot()` 是特殊全槽清除路径；`storage/clear.js:864-906` 还存在 Chat metadata/chat save 的原子清理和补偿。它们不是普通 owner patch precedent，不能拿来比较普通分析性能。

## 4. 简洁跨模块对比表

表中“静态基线”表示一次普通 Coordinator 事务；“真实宿主”只填写附件真正观测到的操作。

| 模块/操作 | 一次操作事务数 | GET | SAVE | 是否等待 | 证据来源 |
|---|---:|---:|---:|---|---|
| Event 单次 factual write | 1；可选 Health/Snapshot/Lifecycle/后台 Projection | 静态 6；模块级真实 `UNKNOWN` | 静态 1；真实 `UNKNOWN` | UI await Event；Projection 不 await | `S`: `character-event-analysis.js:953-1058`; `T`: Event fixture local save; `H`: 无 Event 样本 |
| World Model changed | 1；canonical no-op 为 0 | 静态 6；no-op 0；宿主 `UNKNOWN` | 静态 1；no-op 0 | UI await分析/保存 | `S`: `world-analysis.js:620-705`; `T`: `event-analysis-runtime.test.js:12454-12624`; `H`: 无 World 样本 |
| Character Analysis | 同 Event owner | 同 Event；真实 `UNKNOWN` | 同 Event；真实 `UNKNOWN` | await factual；下游 Projection 不 await | `S/T`; 无独立宿主样本 |
| Character State read | 0 | 0 | 0 | 读操作 | `S`: `core/state.js:740-766`; `runtime/event-analysis.js:2234-2336`; `T`: state read never writes Snapshot |
| Tracking Registry refresh | 当前调用图为 0 | 0 | 0 | 等待内存 refresh | `S`: `tracking-runtime.js:57-83`; 宿主 `UNKNOWN` |
| Tracking Window explicit persist | 1 changed / 1 no-op | 6 / 3 | 1 / 0 | `resolveTrackingWindows()` 若被调用会 await persist | `S`: `tracking-window.js:32-55`; `T`: `tracking-window-persistence.test.js:36-62`; 当前生产调用点 `UNKNOWN` |
| Character Timing Config | 0 Floor；1 Chat-local metadata save | 官方 Chat GET 0 | 官方 Chat SAVE 0 | UI await metadata save | `S`: `character-timing.js:3-23`; `T`: debug timing config tests |
| Timing Instance no-op 单笔 | 1 Coordinator no-op | 3 | 0 | Runtime/UI await | `S/T`: `runtime.test.js:951-968`; `H`: 每笔 3/0 |
| Timing Instance changed 单笔 | 1 Coordinator | 6 | 1 | Runtime/UI await | `S/T`: `runtime.test.js:918-945`; `H`: 每笔 6/1 |
| Participant Aggregation no-op 单笔 | 1 Coordinator no-op | 3 | 0 | 若被调用则 await | `S/T`: `participant-aggregation.test.js:170-190`; `H`: 每笔 3/0 |
| Participant Aggregation changed 单笔 | 1 Coordinator | 6 | 1 | manual Timing 中同步 await | `S`: `events.js:5953-6004`; `H`: 每笔 6/1 |
| Timing + Aggregation no-op | 2 consecutive no-op tx | 6 | 0 | 同步等待两笔 | `H`: 161455、163029 |
| Timing + Aggregation changed | 2 changed tx | 12 | 2 | 同步等待两笔及业务 readback | `H`: 161512、163029 |
| Projection AI candidate | 至少 1；通常 candidate + evidence 为 2，另有条件下游 | 每笔 6；总数 `UNKNOWN` | 每笔 1；总数 `UNKNOWN` | Event 触发为后台；专属入口 `UNKNOWN` | `S`: `projection.js:99-137`; `projection-runtime.js:603-632`; 无 `H` |
| Health assessment | 每个 accepted assessment 1 | 静态 6；真实 `UNKNOWN` | 静态 1；真实 `UNKNOWN` | Event 下游 await，但失败不回滚 Event | `S`: `health-assessment.js:155-173` |
| Lifecycle archive/release | 1 至多多笔，取决于 facts/candidate/release | 每笔静态 6 | 每笔静态 1 | 由 Event/Projection 调用方决定 | `S`: `pregnancy-lifecycle.js:79-136` |

## 5. Event Analysis 与 World Model 的路径差异

### Event Analysis

完整链路是：

`manualRefreshEventAnalysis` → `manualAnalysis.analyzeCurrentCharacterEvents` → AI/规范化 → `commitFloorPatch(event)` → Coordinator → Store → 官方 adapter → Coordinator authoritative readback → 本地 canonical read → 可选 Health/Snapshot/Lifecycle → 后台 Projection。

- 不是直接 `store.saveFloor()`。
- 不是每个 Event 独立提交；完整 `events[]`、analysis、registry 一次 owner patch。
- 官方 Chat GET 发生在 Coordinator/Adapter 的普通变更事务中；AI 输入阶段使用当前 host/store 的 Floor 读取，并不把输入阶段的本地对象当成可跨 await 的官方权威基线。
- UI 等待 Event runtime 返回；`projectionPostProcessor` 明确用 `void` 启动，所以用户看到“人物分析完成”时，所有下游 Projection 写入可能仍在进行。
- 失败、stale、readback mismatch 会失败或重试；下游 Health 失败不会撤销 factual Event。

### World Model

链路是：

`World UI Full/Patch 或 Section Save` → `world-analysis.saveWorldModel` → `commitFloorPatch(world)` → 同一 Coordinator → Store → 官方 adapter → Coordinator authoritative readback → 本地 `resolveWorldModelUiReady` → 内存 Tracking refresh。

- 与 Event 使用相同的 Coordinator/官方保存路径。
- World 没有独立的前后官方 Chat 回读；公共 Coordinator 已提供权威回读。
- `getFloor()`、`resolveCurrentFloor()`、历史 World resolver 和 UI-ready resolver 都是本地宿主状态检查；不能称为 `/api/chats/get`。
- canonical no-op 会跳过事务。
- World UI 等待持久化完成；它之后等待的是内存 Registry refresh，不是另一个 Floor save。

## 6. 手动 Timing 保存的完整链路与两笔事务原因

### 6.1 实际调用链

`ui/app.js:4181-4229::saveCharacterTiming` 先判断是否存在当前 Timing Instance：

- 没有实例：`saveCharacterTimingConfig`，是 Chat-local 配置路径。
- 有实例：`editCharacterTimingInstance`，是 Floor-owned `projection_timing_snapshot` 路径。

有实例时：

1. `runtime/events.js:5573-5600` 本地解析当前 Timing Instance。
2. `runtime/events.js:5683-5696` → `storage/projection-timing.js:282-295` → `commitFloorPatch(owner='projection')`，写 Timing root。
3. Coordinator 对该笔事务执行 owner acquisition、latest slot、save prewrite、official save、two save-side reads、Coordinator readback。
4. `runtime/events.js:5718-5764` 本地 Timing readback，检查 cycle、区间、variance 和 frozen offset。
5. `runtime/events.js:5795-5859` 收集业务数据、active Events、Tracking Window、Aggregation snapshot，重新计算 trigger。
6. 若需要移除或创建/更新 Aggregation，`runtime/events.js:5865-6004` → `storage/participant-aggregation.js` → 第二笔 Coordinator 事务，再本地 Aggregation readback。
7. `ui/app.js:4247-4302` 使用 Runtime 返回的 Timing readback，保持 saving 状态直到整个链路完成。

### 6.2 为什么是两笔独立事务

源码能证明的是：

- Timing 与 Aggregation 是两个不同的 Floor root、两个不同的 Coordinator owner（`projection_timing_snapshot` 与 `participant_aggregation_snapshot`）。`storage/floor-persistence-coordinator.js:12-15`。
- Aggregation 的计算必须以已经编辑成功并 readback 的 Timing 为输入。`runtime/events.js:5716-5799`。
- 当前 Coordinator API 一次 `commitFloorPatch()` 只接受一个 owner 和一个 patch；没有多-owner atomic transaction API。`storage/floor-persistence-coordinator.js:613-708`。
- 因此“两笔事务”是当前实现选择加上明确的依赖顺序，而不是从源码得出的“永远不能合并”的业务公理。业务要求是 Timing 成功后才允许基于它重评估 Aggregation；是否设计跨 owner atomic commit 尚未被当前测试契约证明。

其他分析模块也存在保存后下游派生写入，但处理不同：Event 成功后 Projection 是 `void` 后台任务；Timing 手动编辑则同步 await Aggregation，因为 UI 合约返回“已重新评估聚合”并在失败时区分 `timing_persisted`。`runtime/event-analysis.js:3389-3414`、`runtime/events.js:5964-5979`、`ui/app.js:4300-4359`。

### 6.3 Timing 独有的额外工作

相对单独 Event/World owner patch，手动 Timing 操作额外拥有：

- 当前 Timing Instance 的局部历史解析与唯一性检查；
- Timing root 业务 readback；
- active business data、Tracking Window、Event exposure 和已有 Aggregation 的重新计算输入；
- 基于新的 effective min/max 判断 remove/create/update；
- 第二个 Aggregation Coordinator 事务；
- Aggregation 业务 readback；
- UI 在两个 owner 结果都完成前保持保存状态。

其中只有两个 Coordinator 事务会产生附件中记录的官方 GET/SAVE；Timing/Aggregation 的业务 readback是本地扫描，虽然是额外 await，却不是额外官方 Chat GET。

## 7. 六次 GET 的必要性分类

分类定义：

- `A`：独立权威读取有明确当前必要性。
- `B`：有潜在复用空间，但当前未证明安全。
- `C`：源码与测试已证明可以安全消除。
- `D`：证据不足，暂不能判断。

本六阶段没有 `C`。当前能保守分类为 `A/B`；这不等于建议现在删除任何一笔。

| GET | 数据与不变量 | 是否可能取得相同版本 | 不能直接复用的原因 | 分类 |
|---|---|---|---|---|
| `OWNER_ACQUISITION` | 完整官方 owner、message identity、active Swipe、六字段版本、host/official owner 关系、generation settled；决定 stale 或安全 convergence | 在静止宿主上可能与后续相同 | `LATEST_SLOT_READ` 只返回目标 Floor slot，不能替代 owner acquisition 对完整 owner/host 关系的判断；两次 fetch 间可发生外部修改 | A |
| `LATEST_SLOT_READ` | 最新 authoritative slot，作为 patch merge 基线并保留全部 sibling roots | 可能与 acquisition 得到的 slot 相同 | 代码明确要求在 Coordinator 队列内以 latest slot merge；owner acquisition 之后有 await 和外部写入窗口 | A |
| `SAVE_PREWRITE_READ` | 写入前官方 owner，解析实际 message/index/Swipe，检查官方 Floor Version 与 target | 常常可能与 latest 相同 | latest 发生在低层保存之前的不同分层；没有 server CAS 保证中间不变，且低层保存需要自己的 write-boundary preflight | B |
| `SAVE_AUTHORITATIVE_READBACK` | `/api/chats/save` 之后官方 slot 是否与 merged value 完全相等，确认保存是否真正落盘 | 不应与 prewrite 等同；写入已发生 | 写入可能被拒绝、丢失、规范化或返回 ambiguous；必须由写后读取确认 | A |
| `SAVE_FINAL_SLOT_AUDIT` | host memory sync 后再次官方 slot，并同时比较官方/host owner、Swipe、Floor Version、各 sibling presence | 成功且无并发时可能与上一 readback 相同 | 两次读取之间有 host memory sync 和 await；此阶段还检查 host/official convergence，当前测试要求它存在 | B |
| `COORDINATOR_READBACK` | Coordinator 边界重新读 owner patch、siblings、六字段版本，并决定是否返回 `confirmed` | 可能与 final audit 相同 | 低层 adapter 当前只向 Coordinator 返回 commit 状态，不返回可复用的完整 authoritative slot；Coordinator 仍需兑现自己的 boundary contract | B |

### 7.1 并发窗口与复用前提

- 每一次官方 GET 都是 `await fetch()`；服务端、另一个插件、另一个 Tab 或宿主自身都可能在两次读取间改变 Chat。
- 当前官方 adapter 普通路径没有可证明的 server-side Floor Version CAS；源码只在检测到宿主提供 CAS/owner API 时选择定制能力，默认 official clone path 仍是读取、合并、保存、再读回。`runtime/events.js:1536-1582`、`runtime/events.js:1278-1305`。
- 可复用 `SAVE_PREWRITE_READ` 的前提至少是：同一 authoritative revision token、服务端 CAS、写入接口接受并验证该 token、以及低层写入不会重新解析 owner/Swipe。当前接口不满足这些前提。
- 可复用 `SAVE_FINAL_SLOT_AUDIT` 或 `COORDINATOR_READBACK` 的前提至少是：低层函数返回完整 authoritative slot、siblings/version/host sync audit 结果，且中间没有 await/可变操作；当前函数只返回 confirmed metadata，测试也把两层 readback 作为独立契约。
- 对当前六次 GET，没有源码和测试证据可归类为 `C`；“相邻且可能同版本”只能归类 `B`，不能直接删除。

### 7.2 四种“重复”必须分开

1. **相同接口重复调用：** 六个阶段都可能最终进入 `/api/chats/get`，这是已确认的接口层重复。
2. **相同数据重复读取：** 在宿主静止时，多个调用可能返回相同 Chat/Floor Version；样本没有证明每次都发生版本变化。
3. **相同不变量重复验证：** owner、Swipe、Floor Version 在不同层重复出现，但每层还承担自己的边界责任（owner acquisition、write preflight、post-save durability、Coordinator return contract）。
4. **可以安全删除的重复读取：** 当前没有 `C` 级证据。`B` 级候选需要 CAS/immutable revision/返回值契约和并发测试后才能实施。

## 8. 测试与真实宿主证据

### 8.1 源码静态证据 `S`

- 普通 changed Coordinator tx：`storage/floor-persistence-coordinator.js:519-610` 调用 `store.saveFloor()`；Store 选择 `adapter.saveFloorSlot`。`storage/store.js:879-908`。
- official GET/SAVE：`runtime/sillytavern-adapter.js:397-485`。
- no-op 不调用 Store save：`storage/floor-persistence-coordinator.js:452-518`。
- Config 使用 metadata：`storage/character-timing.js:11-21`、`runtime/events.js:1632-1651`。
- Timing/Aggregation 分别提交：`runtime/events.js:5683-5696`、`:5955-5963`。

### 8.2 现有测试证据 `T`

- `tests/runtime.test.js:773-853`：直接低层 Adapter Floor save，`3 GET + 1 SAVE`，阶段为 `SAVE_PREWRITE_READ`、`SAVE_AUTHORITATIVE_READBACK`、`SAVE_FINAL_SLOT_AUDIT`。这不是完整 Coordinator 操作。
- `tests/runtime.test.js:855-976`：完整 Coordinator changed `6 GET + 1 SAVE`，阶段精确为 `OWNER_ACQUISITION`、`LATEST_SLOT_READ`、`SAVE_PREWRITE_READ`、`SAVE_AUTHORITATIVE_READBACK`、`SAVE_FINAL_SLOT_AUDIT`、`COORDINATOR_READBACK`；no-op `3 GET + 0 SAVE`。
- `tests/floor-persistence-coordinator.test.js:186-290`：阶段、no-op 不保存、队列和 readback contract；主要使用 fixture，不能替代真实 host 网络。
- `tests/projection-timing.test.js:138-181`：Timing 创建后 dedup，fixture `saveCount=1`，没有官方 endpoint 统计。
- `tests/participant-aggregation.test.js:170-190`：Aggregation 创建后 dedup，fixture `saveCount=1`，没有官方 endpoint 统计。
- `tests/tracking-window-persistence.test.js:36-62`：Tracking append/dedup/Swipe guard，未统计官方 endpoint。
- `tests/event-analysis-runtime.test.js` 的 Event/World/Timing 测试大量使用 fixture `saveFloorCalls()`；例如 Event 写入在 `:10150-10180` 附近、World changed/no-op 在 `:12454-12624`，这些数字是本地 mock save，不是 `/api/chats/get`。
- `tests/event-analysis-runtime.test.js:9367-9425` 有官方 adapter read/save boundary 测试，但它验证的是 adapter readback，不是一次完整 Event/World/Timing Runtime 操作的官方总次数。

因此，现有测试能证明公共 Coordinator 的次数，不能独立给出 Event、World、Character Analysis、Tracking、Projection 等每条生产路径的真实宿主次数；这些行在对比表中保持 `UNKNOWN`。

### 8.3 真实宿主证据 `H`

对三个 Debug 文件的 `timing_performance_diagnostics.recent_operations` 统计：

| 文件 / operation | transaction | GET | SAVE | 结果 |
|---|---|---:|---:|---|
| `161455` / `timing_perf_mvc4f73j_6` | `floor-tx-1` Timing no-op + `floor-tx-2` Aggregation no-op | 6 | 0 | SUCCEEDED |
| `161512` / `timing_perf_mvc4fmb7_c` | `floor-tx-3` Timing changed + `floor-tx-4` Aggregation changed | 12 | 2 | SUCCEEDED |
| `163029` / `timing_perf_mvc4z20y_3` | `floor-tx-1` Timing no-op + `floor-tx-2` Aggregation no-op | 6 | 0 | SUCCEEDED |
| `163029` / `timing_perf_mvc4z9y5_5` | `floor-tx-3` Timing changed + `floor-tx-4` Aggregation changed | 12 | 2 | SUCCEEDED |

具体阶段序列与源码完全对应：no-op 每笔 `OWNER_ACQUISITION → LATEST_SLOT_READ → COORDINATOR_READBACK`；changed 每笔再加 `SAVE_PREWRITE_READ → SAVE_WRITE → SAVE_AUTHORITATIVE_READBACK → SAVE_FINAL_SLOT_AUDIT`。

附件没有 Event、World Model、Character Analysis、Tracking Window 或 Projection AI 的可归因 `official_io_calls`，所以不能用附件声称这些模块的真实 GET/SAVE 数量。

## 9. 失败、部分成功、重试和 no-op 语义

- Coordinator no-op 返回 `noWrite=true` / `status=noop`，但仍做权威 Coordinator readback；不是“直接返回成功”。`storage/floor-persistence-coordinator.js:452-518`。
- changed save 的官方 5xx/网络失败可能是 `commitState=unknown`；save 后缺失或不等于 merged slot 会抛 readback failure。`runtime/events.js:1297-1366`、`:1431-1437`。
- Event 的 AI/阶段失败可以重试，但 stale/owner/Swipe/Floor Version 保护先于写入；Event factual success 不被 Health 下游失败回滚。`runtime/character-event-analysis.js:1016-1032`。
- World canonical no-op 直接跳过事务；World persistence/readback mismatch 会让 World stage 失败并按当前 Runtime retry contract 处理。`runtime/world-analysis.js:620-681`、`:707-715`。
- Timing Instance dedup 可以是 no-op，但手动编辑后仍会继续 Aggregation re-evaluation；因此一个用户 no-op 操作仍可能出现两笔 no-op Coordinator 事务。`runtime/events.js:5681-6033`。
- Timing 已保存、Aggregation 失败时，错误携带 `timing_persisted=true`，UI 进行 reconciliation read 并明确显示失败；没有提前报告整体成功。`runtime/events.js:5964-5981`、`ui/app.js:4319-4359`。
- Projection postprocessor 的异常异步通知为 `PROJECTION_ANALYSIS_STATUS_CHANGED`，Event success 不会被后台 Projection 失败改写成 Event 失败。`runtime/event-analysis.js:3400-3414`。

## 10. 当前是否有可借鉴的更高效安全方案？

没有发现一个既已用于普通业务、又已被证明保持相同并发安全性的生产方案。

- Chat-local Timing Config 更快，但它不持久化 Floor fact，不能替代 Timing Instance。
- Current State/Tracking Registry/历史 root 扫描更快，但它们是内存读取/派生，不是 authoritative Floor write。
- 低层 `saveFloorBioWeave()` 的测试路径少一个 Coordinator 层，测得 `3 GET + 1 SAVE`；但它不返回 authoritative confirmed save，且普通业务明确不得绕过 Coordinator。因此不能借鉴为安全优化。
- Event 的后台 Projection 只是一种等待策略，不是更快的持久化架构；它把失败和 I/O 从 Event UI completion 中分离，不能证明少了 GET/SAVE。

## 11. 优化候选分级

本轮不实施任何候选。

### P0：无已证实项目

当前没有源码和测试证据证明某个官方 GET 是错误、无效或会破坏正确性的重复请求。不能把“6 次同 endpoint”直接标成 P0。

### P1：无已证实项目

当前没有一个请求删除可以在不改变 owner/Swipe/Floor Version/epoch/readback 契约的条件下，由现有源码和测试证明安全。因此不标 P1。

### P2：需要并发测试或架构调整

1. **研究 Adapter readback 结果向 Coordinator 上提，评估减少 `COORDINATOR_READBACK`。**
   - 对应源码：`runtime/events.js:1377-1437`、`storage/floor-persistence-coordinator.js:543-610`。
   - 当前行为：低层已做 authoritative readback/final audit，Coordinator 又用 `store.readAuthoritativeFloor()` 做自己的 boundary readback。
   - 潜在收益：理论上每笔 changed tx 最多减少 1 GET；no-op 不受影响。
   - 事务边界：仍是同一笔 owner transaction；不能改变 confirmed 语义。
   - 风险：低层当前返回值没有完整 slot、siblings 和 host audit；如果只返回 `commitState`，复用会丢失 Coordinator contract。需要完整 slot、revision、six-field、Swipe、sibling-preservation proof，以及 custom adapter path 的一致契约。
   - 测试：官方 mock 并发修改、save response unknown、host memory divergent、Swipe switch、same-Floor queued writers、custom adapter/official adapter 双路径。
   - 是否立即实施：否。

2. **研究合并 `SAVE_AUTHORITATIVE_READBACK` 与 `SAVE_FINAL_SLOT_AUDIT`。**
   - 对应源码：`runtime/events.js:1325-1432`。
   - 当前行为：保存后先确认官方 slot，再同步 host memory，再进行官方/host final audit。
   - 潜在收益：理论上每笔 changed tx 最多减少 1 GET。
   - 事务边界：不改变 owner transaction，但会改变 host/official convergence 的检查时点。
   - 风险：host sync 与另一个外部写入之间的窗口会失去 final audit；当前测试明确断言两次读取阶段。
   - 测试：服务端外部修改、host memory 修改、响应延迟、save unknown、sibling root 保留、F5 reload durability。
   - 是否立即实施：否。

3. **研究 Timing + Aggregation 的事务批处理，而不是直接合并。**
   - 对应源码：`runtime/events.js:5681-6033`、`storage/floor-persistence-coordinator.js:613-708`。
   - 当前行为：Timing confirmed 后才同步重评估 Aggregation；两个 root 两笔事务。
   - 潜在收益：若设计成真正支持多-owner atomic merge，可能把 `12 GET + 2 SAVE` 降到一个批事务的 `6 GET + 1 SAVE`；但这是架构级上限，不是当前可证明收益。
   - 事务边界：会从“Timing 已确认、Aggregation 独立失败”变为跨 owner atomic 或部分提交语义，必须重新定义 UI/error contract。
   - 风险：Aggregation 输入依赖 Timing readback；并发 Event/World/Projection 写入、不同 owner sibling merge 和 partial failure 都会改变现有语义。
   - 测试：跨 owner atomicity、Timing 成功/Aggregation 失败、并发同 Floor writes、stale edit start、rollback/reload、真实宿主。
   - 是否立即实施：否。

4. **为每个业务操作增加官方 I/O 集成统计，而不是猜测。**
   - 对应源码/测试：`runtime/sillytavern-adapter.js:397-485`、`tests/runtime.test.js:855-976`。
   - 当前行为：公共 Coordinator 有次数测试，业务模块大多只有 local Mock save count。
   - 潜在收益：不减少 GET/SAVE；可以补齐证据并避免错误优化。
   - 风险：测试 fixture 不能模拟真实 host concurrent mutation，若只复制 fetch mock 仍可能过度自信。
   - 测试：Event、World、Timing、Aggregation、Projection、Tracking 各自独立触发并按 `floor_transaction_id/io_purpose` 统计，附并发变体。
   - 是否立即实施：可以作为下一轮只读测试补充，但不属于本轮生产优化。

### P3：理论或产品体验方向

1. **区分 UI 的 Timing 持久化阶段和 Aggregation 重评估阶段。** 当前已经有阶段 trace；可评估显示分段进度，而不是改变 await 语义。预期 GET/SAVE 减少 `0`，事务边界不变；需要 UI contract 和失败显示测试。对应 `ui/app.js:4200-4369`。不立即实施。
2. **研究受服务端 immutable revision/CAS 支持的 GET 复用。** 若宿主提供原子 `read-revision + save-if-revision`，才可能把 prewrite/latest 复用为一个安全 token；当前默认 official API 没有已证实的 CAS。预期 GET 可能减少 `1`，但属于宿主能力和架构调整，不是当前优化。对应 `runtime/events.js:1536-1582`。不立即实施。

## 12. 未解决问题与所需证据

1. **其他模块的真实宿主次数：UNKNOWN。** 需要在同一宿主启用 Event、World、Projection、Tracking 的专属 `performance_operation_id`，分别采集 `official_io_calls`、`floor_transaction_id`、UI await 起止时间；当前附件只含 Timing。
2. **Coordinator readback 是否能安全复用低层 final result：B。** 需要扩展返回值契约并做并发/外部修改测试，不能只看相邻时间戳。
3. **SAVE prewrite 与 LATEST 是否总是同一 revision：UNKNOWN。** 需要在两次 await 之间注入外部 Chat 修改或 server revision，验证是否会被正确拒绝/合并。
4. **Projection AI 一次运行的实际 candidate/evidence/delivery 数量：UNKNOWN。** 需要独立运行带有多个 projection decisions、evidence 和 delivery response 的测试/宿主样本。
5. **Tracking Window 是否有未被静态搜索覆盖的动态间接调用：UNKNOWN。** 需要生产构建入口或运行时 trace；当前直接调用图没有找到 `resolveTrackingWindows()` 的生产 caller。
6. **真实 SillyTavern `/api/chats/get` 响应慢点的服务端原因：UNKNOWN。** 当前 adapter 能拆分 network wait、body read、JSON parse、normalize、source revision；但没有服务端 profile，不能把 1.6–2 秒归因到某一层。

## 13. 最终结论

- 其他普通 Floor 模块并非天然不调用 `/api/chats/get`；只要走普通 Coordinator 的实际变更事务，它们与 Timing 单笔事务使用同一 `6 GET + 1 SAVE` 安全路径。
- 手动 Timing 的显著延迟主要来自“两个独立 Floor 事务 + 同步等待 + 每笔事务的官方 I/O”，而不是 Timing JSON 解析或本地 Timing 历史扫描本身。
- Timing 与 Aggregation 的分开是当前实现选择，并有“先确认 Timing、再用它重评估 Aggregation”的业务顺序要求；源码没有证明它们必须永远分开，也没有证明现在可以安全合并。
- 当前确实存在同一 `/api/chats/get` endpoint 的多次调用，以及可能相同版本/重叠不变量的读取；但没有 `C` 级安全消除证据。任何请求减少都应暂列 `B/P2`，在 CAS、revision、并发和 readback 契约补齐前不实施。
- 当前可确认的更快路径只有“不做 Floor 写入”的路径（Chat-local Config、内存派生）或不具备同等确认语义的低层测试路径；没有已验证的、可直接借鉴的等价安全方案。
