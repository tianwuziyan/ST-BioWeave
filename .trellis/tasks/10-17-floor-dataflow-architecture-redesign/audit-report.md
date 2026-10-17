# BioWeave Floor 数据流架构重整审计报告

审计分支：`fix/world-model-prompt-baseline`
审计日期：2026-10-17
任务范围：只读源码复核、既有审计复核和架构设计；未修改生产逻辑、宿主源码或真实 Chat/Floor。

## 1. 执行摘要

结论先行：

**BioWeave 可以把“内部读取、内部计算、内部 owner-scoped merge”作为目标架构，但当前没有证据证明可以直接用 `context.chat + saveChat()` 替代普通 Floor Coordinator。**

推荐方案是 C：Context-first + 严格确认/回退，但当前只能以“内部视图与纯 merge 的设计方向”存在。生产写入仍应以方案 A（现有 Coordinator）为默认；只有真实宿主提供 owner patch、expected revision/CAS、可等待完成和 unknown 确认契约后，才可以在 Coordinator 内增加能力 gate。

已确认的边界：

- 当前 Floor owner 的业务计算大部分已经在 BioWeave 内完成；`store.getCurrentChatOwnerSnapshot()`、Floor resolver、domain pure function 和 Runtime derived state 不需要默认调用官方 `/api/chats/get`。`SOURCE_VERIFIED`
- 当前 `/api/chats/get` 的主要职责不是 JSON 解析，而是权威 owner acquisition、latest Snapshot merge 基线、写前状态保护、保存后确认和 Coordinator 返回边界。`SOURCE_VERIFIED`
- 普通 Floor no-op/changed 的真实基线仍为 `3/0`、`6/1`；Timing + Aggregation no-op/changed 仍为 `6/0`、`12/2`。`REAL_HOST_BASELINE` + `TESTED_IN_ISOLATION`
- 前序并发审计已对 Owner→Latest、Latest→Readback、Timing→Aggregation 输入复用构造确定性反例；P2 原型也对 Context-only no-op、完整 Chat 覆盖和旧快照覆盖构造反例。`TESTED_IN_ISOLATION`
- 当前 SillyTavern 原生保存接口没有被证明提供 BioWeave 所需的服务器端 CAS、字段级 merge、跨标签页冲突仲裁或可区分的 durable confirmation。运行版本 commit 也没有得到验证。`HOST_UNVERIFIED/BLOCKED`

因此本轮没有可以直接实施的“少 GET native Floor writer”。正确的重整顺序是：

```text
内部状态视图
  → 纯 owner merge intent
  → 能力与身份 gate
  → 当前 Coordinator（默认）或已证明的 host owner patch
  → 保存结果确认
  → confirmed / failed / unknown
```

不要采用：

```text
先修改 Context
  → saveChat()
  → 发现冲突后再 fallback Coordinator
```

因为第一次完整 Chat 写入可能已经覆盖其他扩展、旧标签页或其他 Swipe 的变化，之后的 fallback 无法恢复未知 writer 的数据。

## 2. 证据范围与既有报告复核

本轮复核了：

- `.trellis/tasks/10-17-floor-write-path-performance-audit/audit-report.md`
- `.trellis/tasks/10-17-timing-noop-performance-audit/audit-report.md`
- `.trellis/tasks/10-17-timing-noop-concurrency-validation/audit-report.md`
- `.trellis/tasks/10-17-native-host-persistence-architecture-audit/audit-report.md`
- `.trellis/tasks/10-17-sillytavern-native-persistence-capability-audit/audit-report.md`
- `.trellis/tasks/10-17-native-floor-persistence-prototype/audit-report.md`

并重新核对当前源码：

- `storage/floor-persistence-coordinator.js:9-20,281-610,613-708`
- `storage/store.js:721-750,831-930,933-964`
- `runtime/sillytavern-adapter.js:190-233,363-485,575-597`
- `runtime/chat.js:13-95`
- `runtime/floor.js:1-8,130-167`
- `runtime/events.js:5480-6037`
- `runtime/event-analysis.js:804-837,2234-2336,3389-3414`
- `runtime/character-event-analysis.js:919-1058`
- `runtime/world-analysis.js:351-408,616-725`
- `storage/projection.js:43-203`
- `runtime/projection-runtime.js:602-650`
- `storage/projection-timing.js:219-386`
- `storage/participant-aggregation.js:211-361`
- `storage/tracking-window.js:16-75`
- `runtime/tracking-window-runtime.js:11-42`
- `runtime/tracking-runtime.js:6-85`
- `storage/character-timing.js:3-23`
- `core/state.js:740-766`
- `ui/app.js:4068-4377`

既有报告的核心结论仍适用于当前 checkout。当前源码没有显示出可以把既有报告中的 `UNKNOWN` 变成已验证安全的宿主能力；相反，当前 `sourceOwnerLatestMerge` 只是 BioWeave 侧能力标记，不等于 SillyTavern 服务端 CAS。`storage/store.js:734-750`、`runtime/sillytavern-adapter.js:510-516`。`SOURCE_VERIFIED`

证据等级说明：

| 标记 | 含义 |
|---|---|
| `SOURCE_VERIFIED` | 当前 checkout 或已固定的宿主源码快照直接支持 |
| `TESTED_IN_ISOLATION` | Mock/隔离模型和确定性测试支持，不代表真实宿主 |
| `REAL_HOST_BASELINE` | 用户 Debug 或既有人工宿主验收支持 |
| `HOST_UNVERIFIED` | 当前实际运行 server build/跨 writer 行为未核对 |
| `DESIGN_PROPOSAL` | 本报告提出的未来设计，尚未实现 |
| `BLOCKED` | 缺少进入生产所需的宿主契约或测试证据 |

## 3. 当前 Floor 数据流

### 3.1 普通 owner patch

```text
Event / World / Projection / Timing / Tracking / Aggregation
        ↓
内部业务计算、当前 Floor 读取、owner patch
        ↓
FloorPersistenceCoordinator::commitFloorPatch()
        ↓ 同 transaction key 串行
OWNER_ACQUISITION       → 官方 Chat GET
LATEST_SLOT_READ        → 官方 Chat GET
SNAPSHOT_MERGE          → owner allowlist + sibling preservation
        ├─ no-op → COORDINATOR_READBACK → 官方 Chat GET
        └─ changed
             → storage/store.js::saveFloor
             → SAVE_PREWRITE_READ       → 官方 Chat GET
             → /api/chats/save          → 官方 Chat SAVE
             → SAVE_AUTHORITATIVE_READBACK → 官方 Chat GET
             → host Context sync
             → SAVE_FINAL_SLOT_AUDIT    → 官方 Chat GET
             → COORDINATOR_READBACK     → 官方 Chat GET
        ↓
confirmed / failed / unknown
```

`storage/floor-persistence-coordinator.js:322-610` 负责阶段、owner 允许字段、merge、no-op 和 Coordinator readback；`runtime/events.js:923-1437` 负责低层保存前后读取、宿主保存和 final audit；`runtime/sillytavern-adapter.js:397-485` 负责官方 GET/SAVE transport。`SOURCE_VERIFIED`

### 3.2 Timing + Aggregation

```text
ui/app.js::saveCharacterTiming()
  → runtime/events.js::editCharacterTimingInstance()
  → projectionTimingPersistence.editTimingInstance()
  → projection owner Coordinator transaction
  → Timing business readback
  → collectActiveBusinessData()
  → getParticipantAggregations()
  → resolveParticipantAggregationTrigger(aggregation: null)
  → participantAggregationPersistence.remove/upsert()
  → participant_aggregation owner Coordinator transaction
  → Aggregation business readback
  → UI success or timing_persisted partial failure
```

Timing 和 Aggregation 的业务输入读取已经主要使用当前 Context/Store 的内存视图；它们的官方 GET 来自两笔 Coordinator 事务，而不是 `getTimingInstances()` 或 `getParticipantAggregations()` 本身。`runtime/events.js:5716-6006`、`storage/projection-timing.js:338-386`、`storage/participant-aggregation.js:306-350`。`SOURCE_VERIFIED`

### 3.3 当前请求基线

| 模块/操作 | Floor 事务 | 官方 GET | 官方 SAVE | 等待语义 | 证据 |
|---|---:|---:|---:|---|---|
| 普通 Floor no-op | 1 | 3 | 0 | 由调用方决定 | `tests/runtime.test.js:949-969` + `REAL_HOST_BASELINE` |
| 普通 Floor changed | 1 | 6 | 1 | 由调用方决定 | `tests/runtime.test.js:918-947` + `REAL_HOST_BASELINE` |
| Timing + Aggregation no-op | 2 | 6 | 0 | UI 同步等待 | 三份 Debug + 前序报告 |
| Timing + Aggregation changed | 2 | 12 | 2 | UI 同步等待 | Debug `161512`/`163029` + 前序报告 |
| World canonical no-op | 0 Floor tx | 0 | 0 | 仍等待分析/渲染流程 | `runtime/world-analysis.js:620-681`, `SOURCE_VERIFIED` |
| Tracking Registry refresh | 0 | 0 | 0 | 内存 refresh | `runtime/tracking-runtime.js:57-83`, `SOURCE_VERIFIED` |
| Character Timing Config | 0 Floor；Chat-local metadata | Floor 0；metadata endpoint `UNKNOWN` | Floor 0 | UI await metadata | `storage/character-timing.js:11-21`, `SOURCE_VERIFIED` |

Event、World、Projection、Tracking 的“业务级实际宿主总数”没有与 Timing 同等的独立 Debug 样本；公共 Coordinator 静态基线不能替代该实测。`HOST_UNVERIFIED`

## 4. 各模块生命周期与职责

### 4.1 Event / Character Analysis

- 计算者：`runtime/character-event-analysis.js::runEventAttempt`；AI 结果经过事件、身份、来源和完整集合规范化。
- 输入：当前目标 Floor、合法 previous Floor、World Model、Recent Story、Character Evidence、AI response；保存前重新检查 execution、Chat、Floor Version。`runtime/character-event-analysis.js:919-986`。
- 内部可用性：当前 AI/Runtime 输入和当前 Floor 可在插件内；previous 必须来自当前 Chat 向前最近合法 Character Floor，不能来自 Chat-level registry/cache。`.trellis/spec/domain/floor-state.md:120-180`。
- 目标：同一 Character message/active Swipe 的 `analysis`、`events`、`character_registry`。一次结果的多个 Event 在同一个 Event owner patch 中，不是每个 Event 一笔事务。`runtime/character-event-analysis.js:977-980`。
- 继承/清空：继承最近完整合法 Event/registry；删除最后 Event 使用显式 `events: []`；历史 Floor 不改。`docs/bioweave-data-lifecycle.md:804-813,1005-1025`。
- 保存/确认：`commitFloorPatch(target, "event", ...)` 进入 shared Coordinator；保存后有本地完整 Floor/canonical 检查。`runtime/character-event-analysis.js:972-1015`。
- 下游：Health 是事实保存后的独立 derived 路径；Projection postprocessor 由 `void ...` 后台启动。Event 成功通知不等于下游 Projection 已完成。`runtime/event-analysis.js:3389-3414`。
- 失败：Event factual save 失败不替换旧事实；Health/Projection 下游失败不回滚 factual Event。`runtime/character-event-analysis.js:1016-1032`。
- 证据：当前保存路径 `SOURCE_VERIFIED`；业务级真实 GET/SAVE `HOST_UNVERIFIED`。

### 4.2 World Model

- 计算者：`runtime/world-analysis.js`，Full/Patch 经过 domain parser、evidence guard、canonical merge 和 complete-model consistency。
- 输入：World analysis input、当前合法 World baseline、target Floor、Story/character context；输入构建与保存前均有 Chat/Floor token guard。
- 内部可用性：当前 World Model 和 canonical equality 可在 Store/Runtime 内判断。`runtime/world-analysis.js:351-392`。
- 目标：`world_model`、`world_model_meta`，owner allowlist 独立于 Event/Character。`runtime/world-analysis.js:384-392`。
- 继承/清空：nearest valid World model 可作分析 baseline；World clear 只清 World root，保留 Event、identity 和其他 extension。`docs/bioweave-data-lifecycle.md:815-832`。
- 保存/确认：changed World 走 shared Coordinator；canonical no-op 在 `runtime/world-analysis.js:620-681` 直接跳过 Floor transaction；changed 后 `resolveWorldModelUiReady()` 做 UI-ready/readback。`runtime/world-analysis.js:698-725`。
- 用户等待：World UI await 分析和保存；Tracking refresh 是保存后的内存派生，失败可重试，不代表额外 Floor write。`ui/app.js:2652-2724,3030-3187`。
- 证据：canonical no-op 的 `0/0` 是源码事实；changed World 的独立宿主总数为 `UNKNOWN`。

### 4.3 Character State

- 计算者：`core/state.js::reduceState`，由当前有效 Events、character facts、Story Time 派生。
- 输入：`runtime/event-analysis.js::collectCurrentDerivedState` 收集当前 Floor、active Events、Registry、Tracking 和 Story Time。`runtime/event-analysis.js:2234-2336`。
- 目标：没有独立 Character State Floor root；Current State 是 transient/derived read model。`core/state.js:740-766`。
- 继承/清空：由 surviving valid Floor facts 重建；删除/Swipe/version 失效后不会从 Chat-level map 或 cache 恢复。
- 保存/确认：只读，不调用 `/api/chats/get` 或 `/api/chats/save`；如果后续 Snapshot checkpoint 写入，那是 Projection owner 的独立操作，不是 Character State writer。
- 证据：`SOURCE_VERIFIED`。

### 4.4 Tracking Window / Tracking Registry

- 计算者：`runtime/tracking-window-runtime.js::buildTrackingWindows/resolveTrackingWindows` 与 `runtime/tracking-runtime.js::buildTrackingRegistry/refreshTrackingRegistry`，输入是 active Events、World Model、Story Time、subject profiles。
- 内部可用性：Registry refresh 的计算和 current window 主要在内存；`refreshTrackingRegistry()` 只 enqueue rebuild，`runtime/tracking-runtime.js:57-83`。
- 目标：Registry 本身不持久化；显式 `tracking_window_timeline` 由 `storage/tracking-window.js:32-55` 写入 Floor。
- 继承/清空：Timeline 是 append-only；nearest valid root 继承，explicit empty 阻断继承；历史 Floor 不变。`.trellis/spec/domain/floor-state.md` 的 Tracking Window 条款。
- 保存/确认：`saveTrackingWindowTimeline()`/`appendTrackingWindow()` 调用 Coordinator；`resolveTrackingWindows()` 只有注入 `persist` 时才 await。`runtime/tracking-window-runtime.js:29-39`。
- 当前缺口：静态搜索没有找到所有生产 `resolveTrackingWindows(...persist)` caller，不能把显式能力路径写成当前每次 Tracking 都会发生的 I/O。`HOST_UNVERIFIED`。

### 4.5 Projection

- 计算者：`runtime/projection-runtime.js`，Eligibility、Timing 关联和 AI candidate 读取当前 Event/World/Timing/Tracking/Story Time。
- 内部可用性：当前 views/decisions/candidate 在 Runtime 内；历史 Timeline 由 `storage/projection.js::getProjectionViews` 从有效 Floor/Swipe/version 重建。`storage/projection.js:140-170`。
- 目标：`projection_timeline`、`snapshot`、`projection_timing_snapshot`，都是 Projection owner 下的不同 root。`storage/projection.js:81-95`、`storage/projection-timing.js:219-295`。
- 继承/清空：timeline records 绑定创建 Floor Version；projection timing 缺失 root 继承，explicit empty 阻断；历史 root 不被后续 Floor 改写。
- 保存/确认：`saveGeneratedProjection()` 后可能单独 `saveProjectionEvidence()`；AI 结果可能形成多笔 Projection owner transaction。`runtime/projection-runtime.js:602-632`。每笔都应以 Coordinator confirmed 为成功条件。
- 用户等待：Event 成功后 Projection postprocessor 可后台执行；后台不等于不调用官方 GET，也不等于失败消失。`runtime/event-analysis.js:3389-3414`。
- 证据：模块路径 `SOURCE_VERIFIED`；一次完整 AI 运行的宿主总数 `HOST_UNVERIFIED`。

### 4.6 Character Timing Config 与 Timing Instance

两者必须保持分离：

| 数据 | 当前目标 | 当前入口 | 读取/保存 |
|---|---|---|---|
| Character Timing Config | Chat-local `settings.character_timing_configs` | `runtime.saveCharacterTimingConfig()` → `storage/character-timing.js::saveConfig` | `store.getChat/saveChat` → `adapter.saveChatMetadata`/`context.saveMetadata`; 不是 Floor Coordinator |
| Timing Instance | 当前 Character Floor 的 `projection_timing_snapshot` | `runtime/events.js::editCharacterTimingInstance` → `storage/projection-timing.js::editTimingInstance` | current Store/historical scan + independent Projection owner Coordinator + Timing business readback |

Config 可以使用宿主 Chat metadata 保存语义；它不拥有 Floor Version、历史 Floor 或 Snapshot sibling。Timing Instance 不能因为 UI 同处一个编辑器而改用 Config 的保存假设。`storage/character-timing.js:3-23`、`ui/app.js:4181-4229`。`SOURCE_VERIFIED`

### 4.7 Participant Aggregation

- 计算者：`runtime/events.js:5795-6006` 的 `resolveParticipantAggregationTrigger` 和候选 Exposure/Tracking Window 过滤；输入包括 Timing、Story Time、active Events、accepted exposure IDs、Tracking Window、既有 Aggregation。
- 内部可用性：这些输入可在 Timing readback 后从当前 Store/Runtime 重新读取；但它们跨 Timing 与 Aggregation 两笔事务，不能复用旧输入。
- 目标：`participant_aggregation_snapshot`，是 exact Floor/active Swipe 的独立完整 collection。`storage/participant-aggregation.js:211-275`。
- 继承/清空：nearest valid root 继承；explicit empty 阻断；每个 subject/cycle 的完整集合要保留；历史 Floor immutable。
- 保存/确认：`upsertAggregation`/`removeAggregation` 独立调用 Coordinator；manual Timing 将 `aggregation: null` 传给 trigger resolver，强制重新评估既有 succeeded 结果。`runtime/events.js:5816-5822`。
- 失败：Timing 成功后 Aggregation 失败必须返回 `timing_persisted: true`，UI 进入 reconciliation，不能报告整次成功。`runtime/events.js:5964-5981`、`ui/app.js:4319-4359`。
- 角色独立性：柳如烟、祁鸢或同 Floor 其他 subject 的 Aggregation 必须按 subject-local input 独立 create/remove/preserve；一个角色的 Context 判断不能代表整个 collection。`TESTED_IN_ISOLATION` 已有等价双角色反例，但具体宿主覆盖仍未验证。

## 5. GET 分类与必要性

### 5.1 四种读取不能混淆

| 类型 | 目的 | 当前例子 | 是否可由 Context/内存承担 |
|---|---|---|---|
| 内部计算读取 | 计算 Event/World/Tracking/Timing/Aggregation/Projection | `store.getCurrentChatOwnerSnapshot`、valid Floor scan、pure domain function | 通常可以；`0` 官方 GET 只代表内部读取，不代表权威 |
| Snapshot merge 基线 | 保留 sibling、explicit empty、latest owner root | Coordinator `LATEST_SLOT_READ`，各 owner `patchResolver({latest})` | 只有在 Context 被证明是最新 immutable owner 或宿主提供 atomic patch 时才可；当前不能 |
| 并发冲突保护 | owner acquisition、Chat/Swipe/Floor Version/epoch、读后写窗口 | Coordinator owner acquisition、save prewrite、`chat.assert`、Floor Version resolver | Context token 可做本页 guard，但不能防外部 writer；不能替代官方/宿主 CAS |
| 保存结果确认 | 判断文件/owner patch 是否真正达到并保持预期 | save-side authoritative readback、final audit、Coordinator readback | `saveChat()` Promise/HTTP 200/Context mutation 都不够；需要权威确认 |

### 5.2 当前 Coordinator stages

| 阶段 | 主要数据 | 保护/确认 | 当前判断 |
|---|---|---|---|
| `OWNER_ACQUISITION` | 官方 owner、message、active Swipe、六字段版本、host/official 分类 | 是否允许进入该 owner 写路径 | `A`：当前无等价宿主 CAS 证明 |
| `LATEST_SLOT_READ` | latest Floor slot | owner patch 的 sibling-preserving merge 基线 | `A`：前序审计已有 owner 后变化反例 |
| `SAVE_PREWRITE_READ` | 写前官方 owner/目标身份/version | write boundary stale guard | `B`：可能与 latest 重叠，但没有原子 revision 写入 |
| `SAVE_AUTHORITATIVE_READBACK` | save 后官方 target slot | 证明 merged owner 是否出现 | `A`：不能用 save Promise 替代 |
| `SAVE_FINAL_SLOT_AUDIT` | host sync 后 official/host owner、Swipe、sibling | 确认 host/official convergence | `B`：相同内容不等于相同保护 |
| `COORDINATOR_READBACK` | Coordinator 边界 latest Floor | owner fields、siblings、六字段 version、confirmed/no-op | `B`：低层没有返回可兑现的完整 contract；直接省略有 readback 反例 |

结论：当前没有任何阶段达到“源码和测试证明可安全删除”的 `C` 级证据。相同 endpoint、相同 Floor Version 或相邻 await 不能证明相同权威时点。

### 5.3 可以从普通业务路径移出的工作

可移出的不是未经证明的权威 GET，而是：

- Runtime 对当前 Context 的重复 `getTimingInstances()`/`getParticipantAggregations()` 业务扫描，前提是建立一次带完整 owner token 的内部 View，并且所有 consumer 都继续经过 Store/Floor resolver。`DESIGN_PROPOSAL`
- domain calculation、canonical equality、Event normalization、Aggregation trigger、Projection eligibility 等纯计算。`SOURCE_VERIFIED` 已有大量纯函数/Runtime owner。
- UI/Runtime 层把同一个业务 readback DTO 重复转换；但不得减少 Coordinator confirmation。

这类调整的直接官方 GET 收益为 `UNKNOWN/0`，因为当前官方 GET 主要发生在 Coordinator/Adapter，不是这些本地扫描。它们的收益是减少内部重复工作与维护耦合，而不是宣称网络优化。

## 6. 三条写入路径设计

### 6.1 普通内部写入：当前可安全采用的最小形态

```text
capture current Context Floor view
  → Event/World/Tracking/Timing/Aggregation/Projection internal calculation
  → pure owner-scoped merge intent
  → Coordinator identity/epoch/version guard
  → Coordinator latest merge + host save/readback
  → confirmed/failed/unknown
```

这里的“内部优先”只表示业务计算和 merge intent 不再为了每个局部输入主动调用 `/api/chats/get`。普通写入仍保留当前基线：changed `6 GET + 1 SAVE`，no-op `3 GET + 0 SAVE`。`SOURCE_VERIFIED/REAL_HOST_BASELINE`

### 6.2 需要权威确认的写入

```text
internal calculation
  → latest/owner guard
  → host save
  → authoritative owner readback
  → sibling/version/lifecycle audit
  → CONFIRMED or FAILED/UNKNOWN
```

当前默认实现就是这个严格路径。可减少 GET 的前提不是“Context 看起来一样”，而是宿主提供：

1. owner-level patch 或完整 Chat 的 expected revision/CAS；
2. 写入期间的目标 identity 绑定；
3. 可等待的 server result；
4. response lost/unknown 的 owner-targeted confirmation；
5. 外部 writer 冲突拒绝或字段级 merge；
6. 不影响 Timing/Aggregation partial success。

任一条件未知，native candidate 不允许在生产 mutation 前通过。`BLOCKED`

### 6.3 过期/冲突回退

```text
Context view stale / capability absent / CAS conflict
  → discard current native intent
  → reacquire authoritative owner through Coordinator
  → validate Chat/Floor/Message/Swipe/epoch
  → retry owner patch, reject, or return UNKNOWN
```

若 native save 已经 dispatch：

- known pre-dispatch rejection：`FAILED`，可以恢复本地 draft；
- response lost/5xx/host lifecycle changed：`UNKNOWN`，不得立刻用旧快照 fallback；
- 只有确认当前 owner 状态或具备幂等 intent/CAS 后，才可以显式重试；否则报告 unknown 并等待用户/诊断路径。

## 7. 失效、保存和恢复状态机

| 状态 | 进入条件 | UI/Runtime 行为 | 允许的下一步 |
|---|---|---|---|
| `CLEAN` | captured view 与当前 token/version 一致 | 可计算；不显示待保存 | draft/内部 merge → `DIRTY`；生命周期 → `STALE` |
| `DIRTY` | owner patch intent 与当前 Snapshot 不同 | 只能做纯 merge 和能力检查 | guard 通过 → `SAVING`；身份变化 → `STALE` |
| `SAVING` | save 已 dispatch | 显示保存阶段，不能报告成功 | known reject → `FAILED`；ambiguous/readback mismatch → `UNKNOWN`；目标变化 → `STALE/UNKNOWN` |
| `CONFIRMED` | owner patch、sibling、version、身份、host result 均确认 | 更新 derived state，显示成功 | 后续 lifecycle → `STALE` |
| `FAILED` | 可证明没有发生 commit 的拒绝 | 保留/恢复 draft，显示失败 | 重新 capture 后重试 |
| `UNKNOWN` | dispatch 后结果不确定或 readback 不一致 | 显示“未确认”，禁止成功提示和盲目补偿 | 只读确认、显式 owner retry 或人工处理 |
| `STALE` | Chat/epoch/message/Swipe/Floor Version/owner 变化 | 丢弃旧 intent，重建当前 view | 重新打开/重新计算；禁止写旧目标 |

`UNKNOWN` 不是 `FAILED`，也不是 `CONFIRMED`。现有生命周期契约要求 unknown 不得静默成功或以旧 Snapshot 盲写补偿。`docs/bioweave-data-lifecycle.md:1117-1133`。`SOURCE_VERIFIED`

### 7.1 生命周期矩阵

| 事件 | Context-first 风险 | 必须动作 |
|---|---|---|
| Chat 切换 | 旧 intent 写入 Chat B 或错误显示成功 | 递增 Chat epoch；旧操作 `STALE/UNKNOWN`；不把 B 当 A 的 fallback |
| Swipe 切换 | message 相同但 owner slot 变了 | 只读新 active Swipe；旧 Swipe 结果不可贡献当前 derived state |
| 消息正文编辑 | content hash/message version 改变，旧 analysis/timing/projection inactive | 重新计算 Floor Version；旧 operation fail closed |
| 消息删除/楼层重排 | array index 不再是稳定 owner | 以稳定 message identity/当前 collection 重新解析；删除 owner 不可由 cache 恢复 |
| 其他扩展修改 `message.extra` | full Chat save 覆盖 capture 后变化 | 需要 host patch/CAS/merge；否则 native path blocked |
| 插件内多个模块并发 | out-of-order save 或 owner sibling 丢失 | 现有 Coordinator transaction key 串行；native path 也必须在同一 Coordinator gate |
| 旧标签页/设备/direct API | plugin mutex 无法约束外部 writer | host CAS/冲突拒绝；无此能力则 strict Coordinator/unknown |
| 原生保存失败 | 可能是已写前明确拒绝 | 只有确定未写时标 `FAILED`，恢复内存 draft，不做盲目补偿 |
| 响应丢失/5xx/超时 | 服务端可能已写入 | `UNKNOWN`；owner-targeted readback 或显式 retry，不能直接 success/fallback |
| 页面刷新/关闭 | debounce 尚未执行或请求未完成 | 不把 timer dispatch 当 confirmed；恢复后重建当前 owner，报告 pending/unknown |
| 保存后 readback 不一致 | 目标被覆盖或写入内容不完整 | `UNKNOWN`/`FLOOR_TX_READBACK_FAILED`，不报告成功 |

## 8. A/B/C 架构比较

| 维度 | A：现有 Coordinator | B：完全 Context-first | C：Context-first + 严格确认/回退 |
|---|---|---|---|
| 数据一致性 | 当前已覆盖 owner/sibling/Floor/Swipe/epoch/readback | 单页静止模型可行；外部 writer 会 last-write-wins | 内部计算提速；写入由 capability gate/Coordinator 决定 |
| 完成语义 | `confirmed/failed/unknown` 已有契约 | `saveChat()`/debounce 不能直接确认 | 宿主能力满足时确认，否则沿用 A |
| 跨标签页/设备 | 仍以官方 readback 观测，但非 CAS | 无法保护 | 无 host CAS 时仍不解决；不能过度承诺 |
| 实现复杂度 | 已有 | 需要新状态、merge、lifecycle、冲突体系 | 中等；需要统一 intent、capability、fallback、unknown |
| 测试成本 | 已有测试和 Debug baseline | 最高，需全套外部 writer/生命周期测试 | 需要 A/B 路径一致性、宿主契约和临时 Chat 测试 |
| GET/SAVE | `3/0`、`6/1`；Timing+Agg `6/0`、`12/2` | 原型模型可为 `0 GET + 1 SAVE`，但不安全 | 正常仍可能走 A；native 数量 `UNKNOWN`，不能写理论值为承诺 |
| 用户等待 | 当前同步等待真实确认 | 可隐藏到后台，但成功可信度下降 | 可分阶段显示；确认前不报告成功 |
| 迁移风险 | 最低 | 最高，可能覆盖真实 Chat | 可小步 gate；native dispatch unknown 仍需专门恢复 |
| 回退 | 直接继续 A | 已写入后 fallback 不能恢复覆盖 | 只有 mutation 前回退，或宿主提供原子/幂等 intent，才安全 |

判定：

- B 的无保护子方案：`PROVEN_UNSAFE`（既有隔离原型反例）。
- C 的架构方向：`DESIGN_PROPOSAL`；当前生产资格 `BLOCKED`，因为宿主 CAS/patch/unknown completion 尚未证明。
- A：当前正确性基线，保留。

## 9. 分阶段实施计划

### Phase 0：证据与基线冻结

- 范围：只新增报告/测试模型，不改生产 writer。
- 验证：六份报告、源码行号、公共 Coordinator 次数、真实 Debug 计数。
- 回退：删除本任务文档即可。
- 进入下一阶段：所有未知项显式标为 `HOST_UNVERIFIED/BLOCKED`，没有将模型数字写成承诺。

### Phase 1：只读 Floor State View

- 候选文件：优先现有 `storage/store.js`、`runtime/floor.js`、`runtime/chat.js` 的窄接口；不新增持久化 root。
- 保留：Coordinator 是唯一 ordinary Floor writer；Adapter 仍是 host raw I/O seam。
- 测试：Chat/Swipe/message edit/delete、历史 Floor、explicit empty、previous resolution、owner provenance、epoch stale。
- 回退：只移除新 View consumer，生产 writer 不变。
- 门槛：所有事实仍从 Store/Floor abstraction 读取，没有 Chat-level history/cache fallback。

### Phase 2：纯 Snapshot Merge Engine seam

- 候选文件：现有 owner storage/Coordinator 内部纯函数 seam；不要在 Runtime 复制 merge。
- 保留：latest read、owner allowlist、sibling audit、readback。
- 测试：World/Event/Projection/Timing/Aggregation sibling、两角色柳如烟/祁鸢等价数据、其他 extension、Swipe 0/非 0、explicit empty、历史不可变。
- 回退：旧 merge implementation 保持唯一生产调用；新纯 Module 只用于对照测试直到结果逐字段一致。
- 门槛：纯 merge 与现有 confirmed/readback 结果一致，且无生产行为差异。

### Phase 3：真实宿主 capability spike

- 范围：只读宿主源码/临时 Chat 测试；需要用户单独授权真实写入时再停止请求。
- 验证：当前 server build；`saveChat()` thenable/完成阶段；owner patch/CAS；serialized scope；response lost；Chat/Swipe/message lifecycle；其他扩展、旧标签页、direct API。
- 保留：生产仍走 Coordinator，不把临时 Chat 成功当作生产安全。
- 回退：测试使用临时 Chat，销毁测试数据；不迁移用户数据。
- 门槛：宿主能力达到明确 contract，否则停止 native migration，继续方案 A。

### Phase 4：单模块 shadow/compare

- 范围：仅测试/feature-disabled compare path，不向 UI 报告 native confirmed。
- 验证：Event、World、Projection、Timing、Aggregation 各自 owner patch 与 Coordinator 逐字段比较；统计真实 GET/SAVE；注入外部 writer。
- 回退：关闭 compare path，Coordinator 结果仍是唯一业务结果。
- 门槛：无覆盖反例；失败/unknown 语义和 A 一致；历史、Swipe、同 Floor sibling 全部通过。

### Phase 5：受控 native candidate

- 前置：源码、宿主契约、隔离测试、真实临时 Chat 和失败恢复均达到 `CONTRACT_SUPPORTED`。
- 范围：仅 Coordinator 内 capability gate；不改 Floor schema、owner allowlist、Floor Version/Swipe/epoch guard。
- 事务：先保持 Timing 与 Aggregation 两笔逻辑事务和 partial success；不先合并 physical SAVE。
- 回退：capability unknown/conflict/unknown outcome 时回到 strict path；native dispatch unknown 不得盲目二次写。

## 10. 风险与阻断条件

方案 C 在以下任一条件成立时保持 `BLOCKED`：

1. Native save 是完整 Chat last-write-wins，没有 owner patch 或 expected revision/CAS。
2. `saveChat()` 结果不能区分 `failed`/`unknown`/`confirmed`，且没有可靠 owner readback。
3. Context capture 后其他 extension 写入会被覆盖，且宿主不提供 merge/冲突拒绝。
4. Chat/Swipe/message 生命周期变化只能在 save 后发现，无法阻止错误目标写入，也无法恢复 unknown。
5. Timing/Aggregation 的两笔 partial-success 不能保持。
6. fallback 需要用旧完整 Snapshot 二次写入，无法证明幂等或不覆盖。

当前六项均未被完整证明；因此 native production migration 是 `BLOCKED`。`HOST_UNVERIFIED`

## 11. 最终架构建议与直接回答

### 建议

1. 现在保留方案 A 作为唯一生产 Floor writer。
2. 把“内部优先”落在只读 View、纯业务计算和纯 owner merge intent，避免业务模块自己发起额外官方 GET。
3. 不在 Runtime、UI 或普通 owner module 中直接调用 `saveChat()`/`/api/chats/save`；Host Adapter 是唯一宿主 I/O seam。
4. 未来只在 Coordinator 内增加能力 gate：无 CAS/patch/confirmation 时自动选择 strict path；不能让两个数据真相并存。
5. Timing/Aggregation 继续两笔逻辑事务，保留 `timing_persisted` partial success；物理 SAVE 是否能 coalesce 必须另立事务契约设计。

### 直接回答

**BioWeave 如何做到插件内部计算、内部读取、内部合并，只在真正需要宿主能力时调用宿主？**

- Event、World、Tracking、Timing、Aggregation、Projection 的 domain calculation 继续在插件内执行；输入优先来自当前有效 Floor View、Runtime DTO 和纯函数，不为本地计算主动请求 `/api/chats/get`。`SOURCE_VERIFIED/DESIGN_PROPOSAL`
- Snapshot merge 由纯 owner-scoped seam 生成 intent；不直接操作 raw `message.extra`，不创建 Chat-level history。`DESIGN_PROPOSAL`
- 只有写入、并发冲突保护和确认需要 Host Adapter/Coordinator；当前默认是 existing Coordinator。`SOURCE_VERIFIED`
- 在宿主提供原子 owner patch/CAS、可等待完成、unknown confirmation 和外部 writer 保护前，不能把 Context-first native save 当作普通 Floor 生产路径。`BLOCKED`
- 如果 native save 已 dispatch 且结果未知，不能直接 fallback 再写旧 Snapshot；必须 readback/显式 owner retry 或保留 `UNKNOWN`。`SOURCE_VERIFIED`

最终结论：

> **内部优先的数据流设计可行；当前少 GET 的宿主原生 Floor 保存实现不可证明安全。方案 C 值得作为后续架构方向，但当前必须以方案 A 为严格回退和生产基线。**

## 12. 本轮边界与验证

- 本轮只新增 `.trellis/tasks/10-17-floor-dataflow-architecture-redesign/` 任务文档。
- 没有修改生产 Coordinator、Adapter、Runtime、UI、业务规则、Snapshot schema、真实 Chat/Floor 或宿主源码。
- 没有删除官方 GET、readback、Floor Version/Swipe/epoch guard，也没有合并 Timing/Aggregation 事务。
- 既有 `.trellis/tasks/10-15-nsfw-auto-aggregation-diagnostics/` 和其他工作区修改保持不变。
- 质量检查：`npm run check` 通过，1643 项测试中 1627 通过、0 失败、16 跳过；`git diff --check` 通过。本轮没有新增生产代码或测试，因此该结果用于确认当前 checkout 仍通过既有质量门，不将既有工作区修改归因于本任务。
