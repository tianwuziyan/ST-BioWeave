# ST-BioWeave：宿主原生 Context / Chat 保存机制架构审计

审计分支：`fix/world-model-prompt-baseline`（执行期间未切换分支）
审计日期：2026-10-17
生产逻辑变更：无。
新增隔离测试：`tests/native-host-persistence-audit.test.js`

## 1. 执行摘要

结论先行：

**BioWeave 在不改变 Floor 数据模型的前提下，理论上可以增加“宿主 Context 原地修改 + 原生保存”的候选路径；但当前 SillyTavern 默认接口没有提供足够的原子 revision/CAS 与可验证持久化完成契约，因此目前不能把它作为普通 Timing Floor 写入的生产替代路径。**

更准确地说：

- `context.chat` 适合做当前 Chat 的快速本地读取，也能定位当前 message、active Swipe 和现有 `bioweave` 字段。`storage/store.js:831-873,933-947`、`runtime/sillytavern-adapter.js:190-233`。
- 直接修改 `context.chat` 在隔离模型中可以做到一次 native `saveChat()` 调用、零次模型内官方 GET，并保留不属于 BioWeave 的 `message.extra` 字段；但这只是测试模型的结果，不是当前真实宿主的请求计数或持久化证明。`tests/native-host-persistence-audit.test.js:336-353`。
- 当前 Floor Coordinator 之所以读取 `/api/chats/get`，不是因为 JSON 解析需要，而是为了在没有宿主原子条件写入的情况下取得权威 owner、最新 Snapshot merge 基线、写前状态、写后状态和最终 Coordinator readback。`storage/floor-persistence-coordinator.js:281-610`、`runtime/events.js:923-1437`。
- 当前 adapter 的 `sourceRevision` 是返回数据的内容哈希，不是锁；`/api/chats/save` 请求体也没有 expected revision/CAS 参数。`runtime/sillytavern-adapter.js:363-372,397-485`。
- Timing Instance 与 Aggregation 是两个不同的 Floor owner Snapshot。手动 Timing 保存先确认 Timing，再基于当前业务输入重新评估 Aggregation；Aggregation 失败时必须保留 `timing_persisted: true` 的部分成功语义。`runtime/events.js:5681-6033`。
- 因此“把 Timing 和 Aggregation 合成一次 native Chat 保存”不能直接视为优化：一笔批量保存无法自然保留“Timing 已成功、Aggregation 失败”的现有契约。本轮模型对该反例有确定性测试。`tests/native-host-persistence-audit.test.js:566-581`。

本轮最终建议：**暂不迁移普通 Floor 写入。** 最小、低风险的下一步不是删除 Coordinator GET，而是先为真实宿主验证一个显式能力契约：当前 owner snapshot/revision、serialized owner write、条件写入或等价冲突拒绝、可等待的成功事件/响应、unknown 结果确认和 Chat/Swipe 生命周期绑定。在该契约没有被真实宿主证明前，Floor 继续走 Coordinator；原生 Context 路径只可作为隔离实验或非 Floor 元数据方案。

## 2. 证据边界与参考版本

本文区分四类证据：

- `S`：BioWeave 当前 checkout 的生产源码静态分析。
- `T`：BioWeave 现有测试和本轮新增测试的实际断言。
- `H`：前两轮真实 SillyTavern Debug/宿主观测。
- `M`：本轮 test-only native host 行为模型。它使用确定性 Promise barrier，不代表官方宿主已经具备模型中的能力。

参考仓库已在本地只读 clone，并固定到以下 commit：

| 项目 | 本地审计路径 | commit | 公开来源 |
|---|---|---|---|
| ST-SevenDaysCal | `/tmp/bioweave-native-host-audit.tl3nJ0/ST-SevenDaysCal` | `8d2dec507b2b96bd3f6ba45ada19b5c8526944af` | [atonal519/ST-SevenDaysCal](https://github.com/atonal519/ST-SevenDaysCal/tree/8d2dec507b2b96bd3f6ba45ada19b5c8526944af) |
| st_bs_biotracker | `/tmp/bioweave-native-host-audit.tl3nJ0/st_bs_biotracker` | `5731cc454788986b2a11e31f52c06f6f56c49e8a` | [Liuuuu54/st_bs_biotracker](https://github.com/Liuuuu54/st_bs_biotracker/tree/5731cc454788986b2a11e31f52c06f6f56c49e8a) |

参考仓库的测试和真实宿主脚本只作为架构比较证据，不被当作 BioWeave 的生产保证。

## 3. 两个参考项目的实际保存调用图

### 3.1 ST-SevenDaysCal：普通 `message.extra` 快照路径

生产源码：`snapshot.js:1-180`。

```text
writeSnapshot(mesId, snap)
  ├─ ctx().chat[mesId]
  ├─ isCurrentWritableFloor()
  │    └─ 只允许最后一条非 system 楼；历史楼不再写
  ├─ 规范化 Snapshot
  ├─ _sameSnapContent(prev, payload)
  │    └─ 内容相同：直接 return false，不 touch extra，不保存
  ├─ message.extra.gouhua_snapshot = payload
  ├─ _mirrorToCurrentSwipe()
  │    └─ 只镜像当前 message.swipe_id 的 swipe_info 槽
  ├─ prepareNormalChatStoreForSave(context)
  └─ scheduleSnapshotSave()
       ├─ context.saveChatDebounced()：调用后立即返回
       └─ fallback context.saveChat()：200ms timer，fire-and-forget
```

源码事实：

- 快照绑定 message，普通模式写 `message.extra` 并镜像 active `swipe_info`；只有当前最后一条非 system 楼可更新，历史楼保持不变。`snapshot.js:1-4,47-59,143-153`。
- no-op 比较忽略时间戳和 schema 版本，只比较业务内容；相同内容不会触发保存。`snapshot.js:75-76,101-140`。
- `saveChatDebounced()` 的返回值没有被等待，也没有在此处确认服务器持久化成功。`snapshot.js:24-35,111-119`。
- 这是渲染元数据快照，不是 BioWeave 这种带完整 Floor Version、owner、Sibling merge 和权威回读契约的 Floor fact。`snapshot.js:1-4`。

普通业务 feature 的保存包装也只是：`business/coordinate/feature.js:81-84` 中调用 `host.saveChatDebounced()`，没有将该调用本身当作强持久化确认。对应测试 harness 的 `saveChatDebounced` 是立即 resolved 的 mock：`business/coordinate/feature.test.js:14-70,73-139`。这能验证 UI 业务顺序和部分成功提示，不证明 SillyTavern 的真实 Chat 保存完成。

### 3.2 ST-SevenDaysCal：外置存储的严格路径

```text
writeExternalSnapshot(message, snapshot)
  └─ enqueue()
       └─ writeExternalSnapshotNow()
            ├─ capture current Chat / reply / Swipe identity
            ├─ readHostState()
            ├─ build pointer / next message snapshot
            ├─ publishMessages()
            │    ├─ runSerializedChatWrite()
            │    ├─ re-read latest host messages / metadata
            │    ├─ compare before snapshot / expected roots / live Chat
            │    ├─ build patch operations
            │    ├─ host patch write
            │    └─ validate response + integrity
            ├─ unknown result → confirmPublished()
            ├─ Chat/reply changed → do not publish live success
            └─ only after confirmed publish, mutate live message pointer
```

关键证据：

- 每个 Chat 有串行写队列；队列会检查 Chat 是否仍是 active、是否 ready、是否被取消或超时。`runtime/external-chat-storage.js:251-280`。
- 外置 record 写入携带 `expectedRevision`；失败后会 readback，只有读回的数据与写入数据一致才转为 confirmed，否则保留 unknown/unavailable。`runtime/external-chat-storage.js:407-434,438-500`。
- `publishMessages()` 在 host serialized write 内重新读取最新 message/metadata，比较 baseline、expected roots、live Chat，并在写入后校验 host patch 返回和 integrity。`runtime/external-chat-storage.js:897-976`。
- unknown publish 可以调用 `confirmPublished()`；只有确认后才把 pointer 发布到 live message。`runtime/external-chat-storage.js:978-989,1039-1047`。
- 外置迁移要求 `ctx.saveChat()` 返回 thenable，并在完成后刷新 host snapshot、重新比较 live 与 server；非 awaitable save 被视为 `live-save-unconfirmed`。`runtime/external-chat-storage.js:1081-1111`。

这个项目最有借鉴价值的不是“直接改 message.extra”，而是它为直接写入补足了以下能力：写队列、owner guard、expected revision、写前最新读取、冲突拒绝、unknown readback、只在确认后发布 live 状态。它同时有明确的当前楼限制；不能把普通渲染快照的轻量路径直接套到 BioWeave Floor。

### 3.3 st_bs_biotracker：Chat State / extension settings 路径

```text
状态变化
  └─ scripts/state.js::saveSettings()
       ├─ hashChatState() / isChatStateDirty()
       ├─ 当前 Chat changed → claimChatRevision(force)
       ├─ save_sync.localStorage 记录 revision
       ├─ SillyTavern：50ms coalesce
       │    └─ saveHostSettingsImmediately()
       │         ├─ ctx.saveSettings() 并 await
       │         └─ 或 script.js::saveSettings() + SETTINGS_UPDATED 事件确认
       └─ TauriTavern/Luker：Chat sidecar write queue
            ├─ 50ms debounce
            ├─ per-chat write chain
            └─ flushHostChatStateSave() 等待真实 write promise
```

源码和文档证据：

- ST 模式下 Chat State 主要在 extension settings；TauriTavern/Luker 走每 Chat sidecar，不是 message Floor Snapshot。`docs/mechanics/tracking-and-state.md:54-68`、`scripts/state.js:930-975`。
- `saveHostSettings()` 只调用 `ctx.saveSettingsDebounced()`，不等待；破坏性操作改用 `saveHostSettingsImmediately()`，等待 `ctx.saveSettings()`，或等待 `SETTINGS_UPDATED` 成功事件。`scripts/host.js:251-257,271-308`。
- sidecar 读取在内容未确认前禁止把空状态写回；写入按 Chat 串行排队，flush 等待实际 write promise。`scripts/host.js:422-431,488-557,559-641`。
- `saveRevision`、`localStorage` 和 `BroadcastChannel` 只覆盖同一浏览器的分页；跨设备没有 CAS/同步保障。`scripts/save_sync.js:1-20,36-123`、`docs/mechanics/tracking-and-state.md:60-62`。
- stale 且本分页没有修改的状态，保存前通过 `/api/settings/get` 读回；本分页已经修改的状态则保留本地并 force 领新 revision。`scripts/state.js:1120-1189,1191-1230`。

现有测试验证了 revision、stale-clean readback、dirty override 和 pending 状态：`tests/save_sync.test.mjs:30-106`。真实宿主脚本 `tests/check-persistence-host.mjs:1-8,184-212` 覆盖短延迟 reload 和 stale second tab，但使用的是独立临时 Chat/浏览器测试，不等价于 BioWeave Floor CAS。

## 4. BioWeave 当前保存架构

### 4.1 Context 与官方 Chat 的关系

当前系统同时存在两种读取：

| 读取 | 实际实现 | 是否 `/api/chats/get` | 可信边界 |
|---|---|---:|---|
| 当前宿主 Context | `store.getCurrentChatOwnerSnapshot()` → `adapter.getChatMetadata()/getChat()` | 否 | 当前页面内存对象；用于本地派生、快速读取和 Chat boundary 检查，不自动证明服务器最新 |
| 当前 message/Swipe Floor | `store.getFloor()` → `adapter.getMessage()`；`adapter.readHostFloorSlot()` | 否 | 当前 Context 中的目标 slot；可用于本地 UI/runtime，但不等于官方归档权威 |
| 官方 owner Chat | `readOfficialChatOwner()` → `/api/chats/get` → JSONL parse → `sourceRevision()` | 是 | 返回的 Chat owner、message、metadata、Floor slot和 revision；是 Coordinator 的权威 merge/校验输入 |
| 官方 Chat 保存 | `requestOfficialChatSave()` → `/api/chats/save` | 否，1 次 SAVE | 直接发送完整 cloned Chat；请求体没有 expected revision/CAS |

源码位置：

- 当前 Context 读取：`storage/store.js:831-873,933-947`。
- Floor 权威读取：`storage/store.js:910-930`、`runtime/sillytavern-adapter.js:397-443`。
- 官方保存：`runtime/sillytavern-adapter.js:444-485`。
- source revision：`runtime/sillytavern-adapter.js:363-372`。

`context.chat` 与官方 `/api/chats/get` 返回的数据通常来自同一 Chat，但当前源码没有把它们视为自动一致的同一个不可变对象：Context 是可变 live object；官方 GET 是另一次异步读取。两者之间可以发生 Chat 切换、Swipe 变化、消息编辑、其他扩展写入、分页/窗口外修改或服务器状态变化。

### 4.2 Coordinator 为什么必须使用官方 GET

普通 Coordinator no-op 的真实调用图是：

```text
commitFloorPatch()
  └─ transaction_key 串行队列
     └─ dispatch()
        ├─ resolveLive / owner guard
        ├─ OWNER_ACQUISITION
        │    └─ 官方 owner Chat GET #1
        ├─ 可选 FLOOR_VERSION_VALIDATION
        ├─ LATEST_SLOT_READ
        │    └─ 官方 Floor slot GET #2
        ├─ SNAPSHOT_MERGE / patchResolver
        ├─ FLOOR_TX_NOOP
        ├─ COORDINATOR_NOOP_GUARD
        │    └─ current Chat / execution token 检查
        └─ COORDINATOR_READBACK
             └─ 官方 Floor slot GET #3
                └─ 六字段 Floor Version 验证后返回 noop/confirmed
```

对应源码：

- owner、Chat、Floor owner、active Swipe、owner guard：`storage/floor-persistence-coordinator.js:281-320`。
- `OWNER_ACQUISITION`：`storage/floor-persistence-coordinator.js:322-354`。
- 当前 Floor Version 校验和 `LATEST_SLOT_READ`：`storage/floor-persistence-coordinator.js:356-407`。
- merge、owner 字段白名单、Sibling presence 保护：`storage/floor-persistence-coordinator.js:424-450`。
- no-op guard、Coordinator readback、`FLOOR_TX_READBACK_FAILED`：`storage/floor-persistence-coordinator.js:452-518`。
- changed 事务的 Store save 和 Coordinator readback：`storage/floor-persistence-coordinator.js:519-610`。
- per-`transaction_key` 串行队列：`storage/floor-persistence-coordinator.js:613-708`。

changed 事务在 adapter 侧还包含：

```text
saveOfficialFloorSlot()
  ├─ SAVE_PREWRITE_READ       → 官方 GET
  ├─ 目标 message / active Swipe / 六字段 Version 校验
  ├─ merge 并同步 host Context
  ├─ requestOfficialChatSave  → 官方 SAVE
  ├─ SAVE_AUTHORITATIVE_READBACK → 官方 GET
  ├─ host Context sync
  └─ SAVE_FINAL_SLOT_AUDIT    → 官方 GET
```

位置：`runtime/events.js:923-1437`；Store 入口是 `storage/store.js:879-930`。因此当前生产端点基线是：

| 操作 | Floor 事务 | `/api/chats/get` | `/api/chats/save` | 证据 |
|---|---:|---:|---:|---|
| 普通 Floor no-op | 1 | 3 | 0 | `tests/runtime.test.js:949-969`；真实宿主 Debug |
| 普通 Floor changed | 1 | 6 | 1 | `tests/runtime.test.js:918-947`；`tests/runtime.test.js:831-845` |
| Timing + Aggregation no-op | 2 | 6 | 0 | 前两轮审计及 Debug |
| Timing + Aggregation changed | 2 | 12 | 2 | 前两轮审计及 Debug |

这些 GET 不是为了“读取 JSON 两次”，而是由当前宿主没有被证明支持 atomic owner CAS、以及当前 Coordinator 的分层校验/回读设计共同造成。它们是否全部属于不可改变的业务不变量，需要新宿主能力证明；但在当前接口下不能直接删除。

### 4.3 Character Timing Config 与 Timing Instance 必须分开

| 项目 | 持久化目标 | 入口 | 关键源码 |
|---|---|---|---|
| Character Timing Config | Chat-local `settings.character_timing_configs` | UI 没有现有 Timing Instance 时调用 `saveCharacterTimingConfig()` | `storage/character-timing.js:3-23`；`runtime/events.js:1632-1651`；`storage/store.js:810-828` |
| Timing Instance | 当前 Character Floor 的 `projection_timing_snapshot` | UI 有现有 instance 时调用 `editCharacterTimingInstance()` | `ui/app.js:4181-4229`；`runtime/events.js:5480-6033`；`storage/projection-timing.js:14,219-295` |

Config 走 `store.saveChat()` → `adapter.saveChatMetadata()` → `context.saveMetadata()`，不是普通 Floor Coordinator，也没有普通 `/api/chats/get`。Timing Instance 则必须遵守 active Swipe、完整六字段 Floor Version、历史 Floor 不可变和 Coordinator readback。不能因为两者都在 Timing editor 中就共享原生保存假设。

### 4.4 UI 与 Runtime 的当前同步等待

Timing editor 打开时保存：

- 保存的 state 包含 `draft`、`timingInstance` 和 `editStartFloorVersion`，但没有 `dirty` 字段或五项原始值比较器。`ui/app.js:727-738,4075-4120`。
- 每次输入用 `Number()` 规范化；`variance_ratio` 在 UI 中以百分比显示并除以 100。`ui/app.js:4148-4154`。
- “恢复默认数值”只是覆盖 draft 并更新 DOM，不设置或清除 dirty 状态。`ui/app.js:4155-4179`。
- 点击保存时，只要有当前 Timing Instance 就总是 `await runtime.editCharacterTimingInstance(...)`；没有当前 instance 才走 Chat-local Config。`ui/app.js:4181-4229`。
- UI 在 Runtime 返回前保持 `saving: true`；Runtime 返回后才更新编辑器并显示成功；Timing readback 或 Aggregation 失败会进入错误/部分成功处理。`ui/app.js:4200-4303`。

因此：

- 用户改值后再改回原值，UI 当前没有独立 dirty 判定；仍会进入 Runtime。
- UI no-op 只能说明表单值与打开时 DTO 相同，不能说明当前权威 Floor 未变。
- UI 没有保留一个可独立证明权威状态未变化的完整 owner token；它保留的是 `editStartFloorVersion`，真正 stale 检查仍在 Runtime/Storage。

## 5. Timing Instance 当前完整调用链

```text
UI saveCharacterTiming()
  └─ await runtime.editCharacterTimingInstance()
      ├─ resolveCurrentBioWeaveFloor()
      ├─ getTimingInstances()
      │    └─ 当前 Context 本地历史扫描 + Floor Version resolver
      ├─ projectionTimingPersistence.editTimingInstance()
      │    └─ projection owner Coordinator 事务
      │         ├─ owner / Swipe / Version guard
      │         ├─ official owner GET
      │         ├─ latest Floor GET
      │         ├─ snapshot merge
      │         ├─ no-op 或 saveFloor
      │         └─ Coordinator authoritative readback
      ├─ getTimingInstances() 业务 readback
      │    └─ 验证 instance id、cycle id、五项参数、sampled offset、effective range
      ├─ collectActiveBusinessData()
      ├─ getParticipantAggregations()
      ├─ resolveParticipantAggregationTrigger()
      │    └─ 手动编辑强制重评估，不走已有 success shortcut
      ├─ before_min → removeAggregation()
      │    或 eligible → upsertAggregation()
      │         └─ participant_aggregation owner 独立 Coordinator 事务
      ├─ getParticipantAggregations() Aggregation readback
      └─ return success / partial failure to UI
```

源码位置：

- Runtime 入口与 Timing 初始读取：`runtime/events.js:5480-5633`。
- Timing Floor 事务：`runtime/events.js:5681-5713`；`storage/projection-timing.js:219-295`。
- Timing 业务 readback：`runtime/events.js:5716-5793`。
- Aggregation 输入和强制触发：`runtime/events.js:5795-5859`。
- before_min remove：`runtime/events.js:5861-5911`。
- eligible upsert、失败包装和 readback：`runtime/events.js:5912-6006`。
- Aggregation owner：`storage/participant-aggregation.js:14,211-255`。

Timing no-op 不足以推出 Aggregation no-op，因为当前 Story Time、Event/Exposure、accepted exposure IDs、Tracking Window、已有 Aggregation 状态和同 Floor 其他依赖都可能在 Timing 与 Aggregation 两个阶段之间变化。当前 Runtime 明确重新取得这些输入；这不是纯粹的重复 transport 工作。

当 Aggregation 失败时，Runtime 返回 `AGGREGATION_REEVALUATION_FAILED` 并带 `timing_persisted: true`；UI 显示“当前周期已保存，但 Aggregation 重新评估失败”，不会伪装成整体成功。`runtime/events.js:5964-5981`、`ui/app.js:4319-4359`。这解释了为什么两个 Floor owner 事务目前独立存在：它们有独立 Snapshot、独立 merge/readback 和当前实现的部分成功语义。它不是“Timing 业务必然需要两个 `/api/chats/save`”的宿主定律，但合并前必须重新定义事务和失败契约。

## 6. 四个候选方案审计

### 6.1 方案 A：宿主 Context 原地修改 + 原生保存

候选流程：

```text
current Context
  ├─ Chat/Floor/Swipe/六字段 Version/epoch guard
  ├─ 读取目标 message.swipe_info[swipe].extra.bioweave
  ├─ 仅修改 BioWeave 自有 root
  ├─ 当前 Context deep no-op 检查
  ├─ await context.saveChat()
  └─ 保存后再次检查 Chat/Swipe/Version/epoch
```

可取之处：

- 不需要为每次本地 merge 先请求完整官方 Chat。
- 可以只改目标 Swipe slot 的 `extra.bioweave`，不触碰 message text 和其他 extension root。当前 adapter 的 host mutation 形态可参考 `runtime/sillytavern-adapter.js:205-233`；但该函数本身不负责官方确认。
- 当前 Store 已有 Context owner snapshot、Chat boundary token 和 Floor/Swipe 定位能力：`storage/store.js:831-873,933-947`、`runtime/chat.js:13-95`。

不可直接接受之处：

- `context.chat` 与官方归档之间可能不一致；本轮测试复现了 Context ahead/behind official 时 Context-only no-op 误判。`tests/native-host-persistence-audit.test.js:598-610`。
- 当前 `adapter.saveChat()` 只检查保存前后 Chat ID，并将 `context.saveChat()` 的空返回映射成 `commitState: "unknown"`，没有证明服务器已持久化。`runtime/sillytavern-adapter.js:575-585`、`runtime/events.js:1609-1627`。
- native full-Chat save 没有当前生产源码证明的 expected revision/CAS；若另一个 writer 在 dispatch 后修改 `message.extra`，完整快照写回可能覆盖它。本轮有确定性模型反例。`tests/native-host-persistence-audit.test.js:459-473`。
- 同一用户操作里的 Timing 和 Aggregation 若分别原地修改但无队列，out-of-order native completion 会丢失 sibling；本轮有确定性反例。`tests/native-host-persistence-audit.test.js:444-457`。
- 即使保留前后 Chat ID 检查，Chat 切换、Swipe 切换、正文编辑、epoch 变化也可能发生在 save promise 等待期间；本轮测试要求 post-save guard 拒绝成功。`tests/native-host-persistence-audit.test.js:385-431`。

判定：

- 无 guard、只比较 UI/Context、调用 `saveChatDebounced()` 即返回成功：`PROVEN_UNSAFE`。
- 具备宿主原子 owner revision/CAS、serialized write、可等待成功回执和完整 post-save identity guard：`CONDITIONALLY_SAFE`，但当前未实现、未被真实宿主证明，当前项目状态仍是 `NOT_YET_PROVEN`。

### 6.2 方案 B：插件内部统一写入队列 / 一次批量 Chat 保存

分两种含义：

1. **仅增加插件内队列**：保留 Timing 与 Aggregation 两个逻辑事务，按同一 owner key 串行调用 native save。
2. **把 Timing + Aggregation 合并成一笔 full-Chat save**：在同一 Context 快照中同时修改两个 root，只保存一次。

对第 1 种：本轮模型显示 plugin-only queue 可以避免 BioWeave 自己的 out-of-order sibling 覆盖，但它不能保护队列之外的其他扩展、另一个分页或宿主自身 writer。`tests/native-host-persistence-audit.test.js:475-500`。因此需要 host-level serialized write 或 CAS 才能升级为生产保证。

对第 2 种：它会破坏或重新定义当前部分成功语义。若 Aggregation 计算失败，批量 save 尚未发生，则 Timing 也未保存；当前实现要求 Timing 已成功、Aggregation 失败时返回 `timing_persisted: true`。本轮批量模型明确得到该差异：`tests/native-host-persistence-audit.test.js:566-581`。

判定：

- plugin-only queue：`CONDITIONALLY_SAFE`，只能证明同一插件内的顺序；当前没有外部 writer 协调证明。
- 一次批量 save 作为现有两事务的直接替代：`PROVEN_UNSAFE`。
- 若未来设计出带 journal/两阶段确认/补偿的事务模型：`NOT_YET_PROVEN`，不能在本轮实施。

### 6.3 方案 C：进入持久化前的变更检测 / no-op 短路

#### UI dirty

可以安全用于：

- 提示“表单未改变”；
- 避免重复渲染或避免对 Chat-local Config 做无意义调用；
- 作为 Runtime 的输入 hint。

不能安全用于：

- 直接阻止 Timing Instance Runtime 保存；
- 跳过 Floor Version、Swipe、epoch 或权威 current-floor 检查；
- 跳过 Aggregation reevaluation。

原因是打开编辑器后，权威 Timing、Exposure、Tracking Window 和 Aggregation 都可能被其他操作修改。当前 UI 只保留 `editStartFloorVersion`，没有持有一个足以替代 Runtime 权威检查的完整 Snapshot/revision。`ui/app.js:4111-4120,4181-4229`。

#### Context-only no-op

本轮模型证明：当当前 Context 中 Timing 参数与提交值相同，但官方 Aggregation root 或其他依赖已经变化时，Context-only 判断会返回 no-op，而无法证明 Aggregation no-op。`tests/native-host-persistence-audit.test.js:549-564`。

判定：

- 只看 UI 五项：`PROVEN_UNSAFE`，因为会错过 Aggregation 更新并掩盖 stale。
- 只看当前 Context 完整 Snapshot：`PROVEN_UNSAFE`，除非同时满足新的权威 revision/CAS 条件；当前普通 host 没有该证明。
- 完成必要 owner/Version/epoch/依赖读取后的 no-op：理论上可行，但当前仍是 `NOT_YET_PROVEN`，因为它不能再称为“进入持久化前零读取短路”。

### 6.4 方案 D：混合式架构

可接受的混合设计只能是：

```text
能力探测 + current owner token
  ├─ 能证明当前 Chat/Floor/Swipe/epoch
  ├─ 能证明宿主 write serialized
  ├─ 能取得 expected revision / 原子冲突拒绝
  ├─ save promise / success event 可确认完成
  └─ 可做目标字段 patch 且不覆盖其他 owner
       ├─ 全部满足 → native path
       └─ 任一 UNKNOWN / conflict / save unknown → Coordinator fallback
```

fallback 必须在 native mutation 之前决定，或者拥有可恢复的明确 pending 状态；不能先把 Context 改掉、再无条件调用 Coordinator，否则会出现两套 merge 基线和两个数据真相。native path 失败后若已 dispatch 但结果 unknown，也不能直接 fallback 再写一次，除非有 readback/幂等 intent 保证不会重复或覆盖。

判定：`CONDITIONALLY_SAFE` 作为架构方向，`NOT_YET_PROVEN` 作为当前实现。它是唯一可以同时保留旧 Coordinator 保护和逐步验证宿主能力的路线，但本轮没有授权或实施生产路由。

## 7. 本轮隔离并发测试结果

### 7.1 测试范围与方法

新增 `tests/native-host-persistence-audit.test.js:1-610`。测试只包含 test-only `NativeHostModel`、权威状态模型和候选行为模型，不修改、也不导入生产持久化实现。测试使用：

- `deferred()` Promise barrier；
- 显式 `completeSave()` release；
- `waitFor()` 只等待已排队的 microtask，不依赖固定 `setTimeout`；
- 独立的 current Context 与 official archive；
- 可变 Chat ID、Swipe、epoch、message version、content hash、Floor owner 和 extension field。

实际结果：

```text
node --test tests/native-host-persistence-audit.test.js
16 passed, 0 failed, 0 skipped
```

### 7.2 结果表

| 场景 | baseline / candidate 观察 | 结论 | 证据 |
|---|---|---|---|
| 当前 Floor changed | model `0` official GET / `1` native save call | native path 只有在 save 可确认且无外部并发时才可能成立 | `:336-353`，`M` |
| 当前 Floor no-op | model `0` GET / `0` save；先做 current identity guard | 可作为候选行为，不代表 authoritative no-op | `:355-367`，`M` |
| `saveChatDebounced()` 未完成 | 返回 `unknown`，不报告 confirmed | 正确边界；不能把 debounce 调用当成功 | `:369-383`，`M` |
| Chat 切换 | save ticket 可能已经写入原 Chat，但 operation post-guard 拒绝成功 | 需要 stale/unknown 语义，不可静默成功 | `:385-398`，`M` |
| Swipe / message / epoch 变化 | post-save guard 拒绝 | 必须保留现有身份保护 | `:400-417`，`M` |
| 页面刷新 | 同一 Chat ID 但 epoch 变化也拒绝 | Chat ID 单独不够 | `:419-431`，`M` |
| 历史 Floor | save 前拒绝，save count 为 0 | 保留历史 Floor 不可变 | `:433-442`，`M` |
| 两个 Floor root 并发 native save | out-of-order 完成丢失 Aggregation sibling | 必须有队列和外部协调 | `:444-457`，`M` |
| 其他扩展并发修改 `message.extra` | full-Chat snapshot 覆盖 remote extension change | “只改自己字段”不等于“不会覆盖并发变化” | `:459-473`，`M` |
| plugin-only queue | 顺序正确；外部 mutation 仍不受保护 | queue 不是 CAS | `:475-500`，`M` |
| 候选 A | owner→latest 复用丢同 Floor sibling | 无条件复用 `PROVEN_UNSAFE` | `:502-524`，`M` |
| 候选 B | latest→readback 复用漏掉 release window 的 Version 变化 | 无条件省略 readback `PROVEN_UNSAFE` | `:526-547`，`M` |
| 候选 C | Context Timing no-op 漏掉官方 Aggregation 依赖变化 | UI/Context-only short circuit `PROVEN_UNSAFE` | `:549-564`，`M` |
| Timing + Aggregation 一次批量 save | Aggregation fail 时 Timing 未保存 | 不等价于现有部分成功语义 | `:566-581`，`M` |
| save failure / unavailable | 不产生 confirmed | fallback 必须显式处理 | `:583-596`，`M` |
| Context 与 official 不一致 | Context no-op 不能证明 official no-op | 需要权威 revision/readback/CAS | `:598-610`，`M` |

### 7.3 测试不能证明的部分

本轮测试没有宣称：

- SillyTavern `context.saveChat()` 实际调用哪个后端 endpoint；
- `context.saveChat()` 的响应是否包含 durable revision；
- SillyTavern 是否在 save 期间自动做了服务器端 CAS；
- Context 是否由宿主在 Chat/Swipe/消息编辑后同步到官方最新内容；
- 多分页、多设备和其他扩展 writer 是否由宿主统一串行化；
- native save 是否保留全部未知 `message.extra`/`swipe_info` 字段。

这些必须由真实宿主源码/接口契约和专门宿主测试提供，不能用本轮 mock 通过替代。

## 8. Source revision 与 CAS 审计

### 8.1 BioWeave 当前 revision

`runtime/sillytavern-adapter.js:363-372` 的 `sourceRevision(state)` 对以下值做稳定 JSON + SHA-256：

```text
chatId
characterId
groupId
header
chatMetadata
messages
```

它能识别一次 official owner 读取结果中的完整 Chat 内容变化，包括其他 Snapshot root 和其他 extension fields；但它有三个限制：

1. 它是在读取结果返回后计算的 hash，不是服务器上的独立递增 revision。
2. 它没有把 Chat boundary epoch 纳入 hash；epoch 属于页面/runtime 生命周期，需由 `createChatBoundary()` 单独保护。`runtime/chat.js:18-63`。
3. 比较 revision 与随后 `/api/chats/save` 之间没有原子锁；应用层“读 revision → 组装 Chat → save”不能称为 CAS。

`storage/store.js:734-750` 会把 `sourceOwnerLatestMerge` 或同名 capability marker 视为支持 revision CAS 的候选能力；当前 adapter 在 `runtime/sillytavern-adapter.js:11,510-516` 提供 `sourceOwnerLatestMerge: true`。但普通 `saveChat()`/`requestOfficialChatSave()` 本身没有 expected revision 参数或 compare-and-swap 响应。这个 marker 是 BioWeave 侧能力声明，不是 SillyTavern 原子写契约证明。

### 8.2 SillyTavern 官方接口的当前证据

当前 BioWeave adapter 的 `/api/chats/save` body 是：

```text
ch_name
file_name
chat
avatar_url
force: false
```

位置：`runtime/sillytavern-adapter.js:444-485`。源码没有传 expected revision，也没有读取 ETag/version 后进行条件保存。因此：

- 目前没有 BioWeave 源码证据证明官方 Chat SAVE 是原子 CAS；
- 目前没有 BioWeave 源码证据证明 native `context.saveChat()` 提供比直接 endpoint 更强的 CAS；
- 如果真实 SillyTavern 内部确有 serialized write 或 revision guard，必须以对应宿主版本源码和实际行为测试为证，而不是以 `sourceOwnerLatestMerge: true` 代替。

## 9. 性能与请求量比较

### 9.1 当前已验证基线

| 操作 | 当前 Floor tx | 当前官方 GET | 当前官方 SAVE | UI 是否同步等待 | 证据 |
|---|---:|---:|---:|---|---|
| Timing no-op（含 Aggregation no-op） | 2 | 6 | 0 | 是 | 前两轮报告、真实 Debug |
| Timing changed + Aggregation changed | 2 | 12 | 2 | 是 | 前两轮报告、`tests/runtime.test.js` 单笔基线 |
| 单笔 Floor no-op | 1 | 3 | 0 | 调用方决定 | `tests/runtime.test.js:949-969` |
| 单笔 Floor changed | 1 | 6 | 1 | 调用方决定 | `tests/runtime.test.js:918-947` |
| Timing Config | 0 Floor；Chat-local metadata save | Floor GET 0 | Floor SAVE 0 | 是 | `storage/character-timing.js:11-21` |

### 9.2 候选请求量：只写已测模型，不把理论当实现

| 候选 | Timing no-op | Timing + Aggregation changed | 是否真实宿主实测 | 说明 |
|---|---|---|---|---|
| 当前 Coordinator | 6 GET / 0 SAVE | 12 GET / 2 SAVE | 是，GET/SAVE由既有 Adapter Mock和 Debug覆盖 | 正确性基线 |
| A：直接 Context + native save | 模型 0 GET / 0 save call（仅当 current snapshot 相同且 guard 通过） | 模型可为 0 GET / 1 native save call，但不等价于两个事务 | 否 | native save 的实际网络请求数 `UNKNOWN`；`context.saveChat()` 返回/完成契约 `UNKNOWN` |
| B：plugin-only queue | 模型 0 official GET / 2 native save calls | 模型 0 official GET / 2 native save calls | 否 | 只减少官方读取，不解决外部 writer/CAS；若合并成 1 save 则改变部分成功语义 |
| C：UI dirty | 不应改变 Floor GET/SAVE | 不应改变 Floor GET/SAVE | 否 | 只能作为 hint；不能安全阻止 Runtime |
| D：具备 CAS 的 hybrid | 理论上正常 changed path 可少于当前 6 GET；具体最低值 `UNKNOWN` | 两个逻辑事务是否 1/2 次 native save 取决于部分成功设计 | 否 | 必须先验证宿主能力；fallback 时仍是当前 6/12 GET 基线 |

因此本轮没有可交付的“已实测 6→2”或“12→1”性能承诺。`tests/native-host-persistence-audit.test.js` 的 `getCount` 是模型内 official read 计数，不是 `/api/chats/get` 计数。

### 9.3 UI 等待与后台隐藏

- 当前 Timing editor 明确 `await editCharacterTimingInstance()`，所以 6/12 次官方 GET 的慢延迟直接暴露给用户。`ui/app.js:4200-4303`。
- Event/Projection 等路径可能在 AI 分析或成功通知后以 `void` 后台启动下游 Projection，因此用户不一定等待所有 Floor 写入；这不能证明它们没有官方 GET。`runtime/event-analysis.js:3389-3414`、`runtime/events.js:3709-3718`。
- ST-SevenDaysCal 普通快照调用 debounce 后返回；BioTracker 普通设置保存也可延迟，只有破坏性操作调用 immediate/flush。它们的“感觉更快”部分来自不等待，不是持久化更快。`ST-SevenDaysCal/snapshot.js:24-35`、`st_bs_biotracker/scripts/host.js:251-308`。
- BioWeave Timing 不能直接采用“先提示成功、后台写入”的方式，因为当前契约要求真实保存失败、readback 失败和 Aggregation 部分失败都不能伪装成整体成功。`runtime/events.js:5964-5981`、`ui/app.js:4303-4359`。

## 10. 哪些行为是硬契约，哪些是架构选择

### 必须保留的业务/数据契约

以下由当前源码、`Floor State Ownership Contract` 和生命周期文档共同支持，不能因为换宿主保存接口而放宽：

- Chat ID、message ID、Floor、Swipe ID、content hash、message version 的完整 Floor Version。`runtime/floor.js:1-8,154-167`。
- 当前 Chat、active Swipe、Character owner 身份和 epoch/stale guard。`runtime/chat.js:13-95`；`storage/floor-persistence-coordinator.js:292-320`。
- 历史 Floor 不可变；当前 owner slot 不能被 user message 或历史 slot 写入。`.trellis/spec/domain/floor-state.md:216-260`、`storage/store.js:831-873`。
- Snapshot 缺失时按既定继承规则读取；显式空 root 必须阻止继承；显式 `undefined`/删除必须保留清除语义。`.trellis/spec/domain/floor-state.md:218-246`。
- sibling root 合并不能互相覆盖；owner 只能写自己拥有的字段。`storage/floor-persistence-coordinator.js:9-20,122-139,438-448`。
- Timing Instance ID、Cycle ID、sampled offset、effective range 和 variance 业务规则。`runtime/events.js:5740-5789`。
- Timing 成功、Aggregation 失败的部分成功语义。`runtime/events.js:5964-5981`。
- 真实 SAVE/readback 失败不能向 UI 报告 confirmed。`ui/app.js:4280-4359`。

### 当前实现选择，可能在新能力证明后重构

- Coordinator 把 owner acquisition、latest slot read、save-side prewrite/readback/final audit、Coordinator readback 分层实现，是当前在缺少宿主 CAS 时的防御架构；这不是“Floor 业务必须调用六次 GET”的独立领域规则。
- Timing 和 Aggregation 使用两笔独立 Coordinator 事务，是当前为独立 Snapshot merge/readback 和部分成功语义服务的实现选择；若要合并，必须先重新定义失败、重试、补偿和 readback 契约。
- 当前手动 Timing 编辑总是触发 Aggregation reevaluation，是当前业务规则，不是 native save 的传输要求；但不能用 UI dirty 擅自改变。
- 使用 `context.saveChatDebounced()`、`context.saveChat()` 或 `context.saveMetadata()` 的具体宿主入口是 API 选择；调用入口不自动等于成功确认。
- `sourceOwnerLatestMerge` capability marker 是当前应用层选择；若宿主没有 atomic conditional save，它不能单独替代 GET。

## 11. 候选方案证据矩阵

| 方案 | 直接候选的确定性结果 | 当前证据等级 | 是否可进入生产 |
|---|---|---|---|
| A：Context 原地写 + native save；不做 CAS/只做 UI 或 Context no-op | 会漏掉官方变化、覆盖外部 extension、在 save 后生命周期变化时产生 unknown/stale | `PROVEN_UNSAFE`（无保护子方案） | 否 |
| A：Context 原地写 + host serialized owner CAS + durable confirmation | 本轮模型未反驳；当前 SillyTavern 契约未证明 | `NOT_YET_PROVEN` / 条件满足后 `CONDITIONALLY_SAFE` | 否，需宿主证据 |
| B：plugin-only queue，保留两笔逻辑事务 | 可防 BioWeave 自己的 out-of-order；外部 writer 仍可覆盖 | `CONDITIONALLY_SAFE` | 否，需 host writer 协调 |
| B：Timing + Aggregation 直接合成一笔 native save | 确定性破坏 Timing 成功/Aggregation 失败部分成功语义 | `PROVEN_UNSAFE` | 否 |
| C：UI dirty 或 Context-only no-op 短路 | 会错过 Aggregation dependency/stale | `PROVEN_UNSAFE` | 否 |
| C：完成必要权威检查后的 no-op 短路 | 可能减少业务工作，但不再是零读取；仍缺少 host CAS/并发完整证明 | `NOT_YET_PROVEN` | 否 |
| D：能力探测 + native path + strict Coordinator fallback | 设计上能保留旧保护，但 fallback/unknown 迁移边界尚未实现/测试 | `CONDITIONALLY_SAFE` | 否，先做 host contract spike |

只有达到“源码、宿主接口契约、并发测试、真实宿主验证”共同支持的 `CONTRACT_SUPPORTED`，才可进入生产实现；本轮没有任何候选达到该等级。

## 12. 进入生产前必须补齐的安全证据

至少需要以下证据，缺一不可：

1. **真实 SillyTavern save 契约**：确认 `getContext().saveChat()` 是否返回可 await 的 durable promise；失败、超时、返回 undefined 分别代表什么；是否存在成功事件或 revision。
2. **原子条件写入能力**：确认宿主是否提供 expected revision、ETag、CAS、serialized owner patch 或同等冲突拒绝。若没有，不能把应用层 sourceRevision 比较称为 CAS。
3. **owner snapshot 能力**：确认 native save 是否写整个 Chat，能否只 patch BioWeave 自己的 message/Swipe field，是否会覆盖其他扩展未被 Context 反映的修改。
4. **生命周期时序**：Chat switch、Swipe switch、消息编辑/删除、刷新、生成新楼期间，Context 对象和 save promise 的身份关系。
5. **同 Floor 外部 writer**：另一个 BioWeave queue、其他插件、另一个分页、宿主自身保存同时修改同一 message.extra/swipe_info 时，冲突/merge 行为。
6. **unknown 结果确认**：save dispatch 后结果未知时，必须有安全 readback/版本确认；不能立即 fallback 再写一次，也不能先报告成功。
7. **双 owner 事务契约**：若要减少 Timing + Aggregation 的 native save 次数，需要证明如何保留 Timing 成功/Aggregation 失败、重试、回读和角色独立性。
8. **真实请求测量**：在隔离测试 Chat 中统计 native `saveChat()` 触发的实际 endpoint、GET/SAVE 次数、debounce 等待和服务器响应；当前模型的 0 GET/1 save call 不能代替该数据。
9. **数据安全测试**：恢复已有 `message.extra`、`swipe_info`、其他 Snapshot root、历史 Floor、explicit empty、multi-role（柳如烟/祁鸢）和同 Floor sibling 的端到端验证。

## 13. 建议路线与风险分级

### P0：不实施当前 native Floor 替换

- 对应源码：`storage/floor-persistence-coordinator.js:281-610`、`runtime/events.js:923-1437`。
- 当前行为：Coordinator 负责最新 merge、Floor Version/stale、官方 save/readback；Timing/Aggregation 保持独立事务。
- 预期请求变化：0；不增加风险。
- 并发风险：最低，维持已通过现有测试和真实 Debug 的语义。
- 建议：立即维持。

### P1：建立真实宿主 capability/contract spike（不改生产路由）

- 对应源码：`runtime/sillytavern-adapter.js:363-485,575-585`；参考 `ST-SevenDaysCal/runtime/external-chat-storage.js:897-976`、`st_bs_biotracker/scripts/host.js:271-308`。
- 内容：在隔离/临时 Chat 中验证 native save 的 thenable、成功事件、revision/CAS、serialized write、完整 Chat 覆盖范围和 unknown readback。
- 预期请求变化：暂不承诺；只新增观测/测试。
- 并发风险：不进入生产写路径，因此不改变现有保护。
- 需要测试：Chat/Swipe/epoch/message edit、其他扩展、同分页、stale tab、失败/unknown、刷新前关闭。
- 建议：最值得先做，但本轮不实施。

### P2：若宿主提供原子 owner CAS，再设计 D 的最小 native path

- 对应源码：当前 Floor owner API `storage/store.js:879-1057`，Coordinator owner 白名单 `storage/floor-persistence-coordinator.js:9-20`。
- 当前行为：每笔 changed 事务 6 GET/1 SAVE；no-op 3 GET/0 SAVE。
- 预期收益：理论上可减少 save-side prewrite/多个 merge read；具体 GET/SAVE 数量 `UNKNOWN`，不能写成已验证 6→2。
- 事务边界：先保留 Timing 与 Aggregation 两个逻辑事务，不先合并。
- 并发风险：需要 CAS 拒绝 stale、完整 owner patch merge、unknown 结果 readback；没有这些就回退 Coordinator。
- 需要测试：同 Floor sibling、其他扩展字段、两角色、历史 Floor、部分成功、CAS conflict/retry。
- 建议：只有 P1 证据达到契约标准后再评审。

### P2：只做 plugin queue / save coalescing，不改变业务事务

- 对应参考：BioTracker `scripts/host.js:559-641`、`scripts/state.js:1242-1295`；BioWeave 当前 queue `storage/floor-persistence-coordinator.js:648-700`。
- 当前行为：Coordinator 已按 `transaction_key` 串行；原生 Context 候选尚没有跨 writer queue。
- 预期收益：可能减少同一操作中重复 full-Chat native save，但实际 endpoint 数量 `UNKNOWN`；若仍保留两个逻辑事务，不能承诺 2→1。
- 事务边界：必须保留 Timing/Aggregation 独立部分成功语义。
- 并发风险：plugin-only queue 不保护其他 extension/分页；需要 host-level queue/CAS。
- 建议：可作为 P1 后的局部设计研究，不立即实施。

### P3：UI dirty 作为 UX hint

- 对应源码：`ui/app.js:4148-4179,4181-4229`。
- 当前行为：没有 dirty 状态；任何保存都进入 Runtime。
- 预期收益：只能减少表单重复工作/提示，不能证明 Floor no-op；Floor GET/SAVE 变化应记为 0。
- 并发风险：若用于阻止 Runtime，会错过 Aggregation reevaluation/stale，风险高于收益。
- 建议：可研究 UI 提示，但不用于持久化短路。

## 14. 最终回答

### BioWeave 是否可以改用宿主原生保存机制，避免正常 Timing 修改反复读取整份 Chat？

**有条件地可行，但当前尚未达到生产实施标准。**

必要条件是：

- 宿主提供当前 owner 的可验证 revision 或等价原子条件写入；
- native save 的完成结果可等待、可确认，unknown 不得当成功；
- 写入前后保留 Chat/Floor/message/Swipe/Version/epoch guard；
- 只 patch BioWeave 自有字段，并在宿主层或应用层安全合并 sibling；
- 同一 Chat 的 BioWeave 写入与外部 writer 有明确 serialized/CAS 关系；
- Timing 与 Aggregation 仍保持当前部分成功语义，或先完成经批准的事务契约变更；
- native path 失败/冲突/能力未知时，在未伪造成功的情况下 fallback 到 Coordinator；
- 以上全部通过隔离测试和真实 SillyTavern 临时 Chat 验证。

在这些条件没有证据之前：

**不要用 UI no-op、`context.chat` 相等、`saveChatDebounced()` 返回、或 `sourceRevision` hash 比较来替代官方权威读取和 CAS。**

本轮没有实施生产改造，也没有删除任何 Coordinator GET/readback。下一步应等待真实宿主能力验证和用户确认后再决定是否进入 D 方案设计。
