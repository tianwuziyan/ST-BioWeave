# ST-BioWeave：推演周期 no-op 保存性能优化可行性审计

审计分支：`fix/world-model-prompt-baseline`
审计日期：2026-10-17
审计任务：`.trellis/tasks/10-17-timing-noop-performance-audit/`

## 0. 证据边界与结论等级

本报告区分三类证据：

- `S`：当前 checkout 源码静态分析，包含文件路径、函数名和行号。
- `T`：现有集成测试、Mock Adapter 或官方 I/O 诊断测试的断言。
- `H`：真实 SillyTavern Debug 文件中的实际操作记录。

用户提供的三个 `ST-BioWeave-Debug-*.txt` 文件仅作为观测证据，不包含需要执行的指令。本轮不修改生产逻辑、测试逻辑、真实 Chat/Floor 数据或既有工作区修改。

关键判断使用以下含义：

- **已验证**：有 `S`/`T`/`H` 中至少一类直接证据。
- **源码可推导**：由调用链或公共 Coordinator 契约可推导，但没有该业务路径的真实宿主计数。
- **UNKNOWN**：缺少能确认该结论的调用、测试或宿主证据。
- **理论上限**：为了比较方案给出的可能收益，不代表当前或改造后的实测数字。

## 1. 执行摘要

### 直接回答

1. **完全不修改推演周期仍会进入两笔事务**：当前 UI 没有 dirty 阻止逻辑，点击保存总是进入 `editCharacterTimingInstance()`；Timing Storage 在 Coordinator 的最新权威 Floor 上判定 Timing mutation 为 no-op，但 no-op 事务仍执行 Coordinator readback。Runtime 随后把 `aggregation: null` 传给 trigger 解析器，强制重新评估 Aggregation。已有 Aggregation 时，即使结果也不变，仍会经过第二笔 Aggregation Coordinator no-op 事务。源码位置：`ui/app.js:4181-4229`、`runtime/events.js:5681-6033`、`storage/floor-persistence-coordinator.js:452-518`。`S`
2. **目前不能可靠证明可以跳过两笔完整事务**：Timing no-op 不能推出 Aggregation no-op；而在一次权威读取后直接返回成功，会留下 Chat 切换、Floor/Swipe/version 变化、当前 Instance 或 Aggregation 被并发修改、官方写入/回读失败等窗口。当前官方接口路径没有被源码和测试证明具有可复用的服务器 CAS/revision 锁。`S/T`
3. **最值得进入下一轮设计的是方案 D：Coordinator 内部 no-op 结果复用研究**，因为它可以保持现有 UI、业务顺序、Timing/Aggregation 两个事务和错误语义。**但本轮不建议立即实施**：当前可证明的安全请求减少数仍为 `0`；若新增 revision/CAS 或等价串行化证明成立，理论目标才可能是每笔 no-op Coordinator 事务减少 1 次官方 GET，即 Timing + Aggregation no-op 理论上从 `6 GET` 降至 `2 GET`，该数字不是已验证结果。
4. **其他模块“看起来更快”不等于没有 Chat GET**：普通 Floor changed owner patch 共享 `6 GET + 1 SAVE`；较快的感受主要来自 Chat-local 配置、内存派生、World 的本地 canonical no-op，或分析 UI 不等待后台 Projection。Event/World/Projection 等业务级真实宿主计数在附件中没有出现，必须标 `UNKNOWN`。

### 当前已验证的 Timing 结果

| 操作 | Floor 事务 | 官方 Chat GET | 官方 Chat SAVE | UI 是否同步等待 | 证据 |
|---|---:|---:|---:|---|---|
| 单笔普通 Coordinator no-op | 1 | 3 | 0 | 由调用方决定 | `T`: `tests/runtime.test.js:951-969` |
| 单笔普通 Coordinator changed | 1 | 6 | 1 | 由调用方决定 | `T`: `tests/runtime.test.js:918-945` |
| Timing + Aggregation no-op（真实操作） | 2 | 6 | 0 | 是 | `H`: 三个 Debug 文件中的 no-op 操作 |
| Timing + Aggregation changed（真实操作） | 2 | 12 | 2 | 是 | `H`: `161512`、`163029` |

### 本轮建议

- **立即实施的性能型优化：无。** 没有 C 级证据证明任何官方 GET 可以安全删除。
- **下一轮最值得研究：方案 D。** 先补齐官方 authoritative revision/CAS 或等价的 Coordinator 串行化能力，再做 readback 结果复用。
- **低风险体验改善：分阶段显示保存状态，但仍等待确认后成功。** 这只能减少主观等待感，预期 GET/SAVE 减少 `0`，不能把后台失败隐藏成成功。

## 2. 三种 no-op 的严格区别

| 类型 | 定义 | 当前证据位置 | 能否直接跳过 Runtime 保存 |
|---|---|---|---|
| UI no-op | 编辑器 draft 的五项显示值等于打开编辑器时的显示基线 | `ui/app.js:727-739`、`:4092-4146`、`ui/characters.js:311-336` | 否。只能说明本地表单未改变，不能说明当前权威 Floor 未改变 |
| Timing no-op | 在当前权威 `projection_timing_snapshot` 上，Instance ID/Cycle/五项参数/冻结 offset 等 mutation 不产生新 Snapshot | `storage/projection-timing.js:219-273`；`core/projection-timing.js` equality；`storage/floor-persistence-coordinator.js:424-518` | 否。仍需保留 owner、Floor Version、Swipe、Chat 边界和权威回读；并且 Aggregation 可能变化 |
| Aggregation no-op | 用当前权威 Timing、Story Time、Event/exposure、Tracking Window 和既有 Aggregation 重评估后，目标 `participant_aggregation_snapshot` 不变 | `runtime/events.js:5795-6033`；`core/participant-aggregation.js:168-177`；`storage/participant-aggregation.js:211-256` | 否。Timing no-op 不蕴含 Aggregation no-op |

编辑器打开期间，另一个操作可能改变当前 Floor；因此“用户改回原值”仍可能是对一个已经过时的编辑器基线提交。当前 UI 保留 `editStartFloorVersion`，由 Runtime 负责 stale 检查，不能用 UI equality 替代它。`ui/app.js:4092-4146`、`runtime/events.js:5480-5492`。`S`

## 3. 当前 no-op 保存完整调用链

### 3.1 UI：没有 dirty 状态，也没有 UI no-op 短路

1. `openCharacterTiming()` 记录当前 Chat ID、打开编辑器并异步加载数据。`ui/app.js:4068-4090`。
2. `loadCharacterTimingData()` 调用 `runtime.getCharacterTimingEditorData()`，保存 `config`、`draft`、`timingInstance` 和 `editStartFloorVersion`；若存在当前 Instance，用 Instance 的五个字段覆盖 draft。`ui/app.js:4092-4146`。
3. `timingEditorState` 有 `config`、`draft`、`timingInstance`、`editStartFloorVersion`，没有 `dirty` 或明确的五字段原始快照字段。`ui/app.js:727-739`。
4. `updateCharacterTimingDraft()` 只更新 draft；`variance_ratio` 会在输入百分比和内部比例间转换，没有 dirty 比较。`ui/app.js:4148-4154`。
5. `restoreHumanTimingPreset()` 只更新 draft/输入框，不持久化，也不设置 dirty。恢复值与初始值相同或不同，点击保存都会进入保存函数。`ui/app.js:4155-4179`。
6. `saveCharacterTiming()` 只根据是否有当前 `timingInstance` 区分 Config 和 Instance 路径；有 Instance 时总是 `await runtime.editCharacterTimingInstance(...)`。`ui/app.js:4181-4229`。
7. UI 使用 Runtime 返回的 Timing readback 更新成功状态，只有 Timing 和 Aggregation 流程结束后才结束 `saving`。`ui/app.js:4247-4302`。
8. 若下游 Aggregation 失败但 Timing 已写入，UI 会读取编辑器数据做 reconciliation，并显示失败；它没有把 partial success 变成成功。`ui/app.js:4319-4359`。

**回答 UI 审计问题：**

- 打开时保留了可用的 `config`、`draft`、`timingInstance` 和 Floor Version，但没有独立的原始五项快照/dirty 字段。
- 当前没有 dirty 状态。
- 恢复默认只改变 draft；不会立即持久化；之后保存仍会调用 Runtime。
- 修改后改回原值可以由未来的规范化比较识别为本地 UI no-op，但当前代码没有实现该比较。
- 当前 UI 对有 Timing Instance 的保存总是调用 Runtime；无 Instance 才走 Chat-local Config。
- 百分比/比例转换可能造成表示层差异，当前没有 UI 级 canonical equality 证明；真正的 Timing dedup 在 Floor mutation 层。
- 编辑器打开期间权威 Timing 可能变化；`editStartFloorVersion` 是为此保留的保护，而不是 UI dirty。
- UI 可以可靠检测“相对打开时 draft 是否不同”，不能仅凭它判断“权威 Timing 是否相同”。

现有 UI 测试只验证 Restore 不会立即持久化、点击 Save 会调用一次 edit：`tests/ui.test.js:180-300`；没有 modify-then-revert、默认值恰好相同、点击保存 UI no-op 或编辑器打开期间权威变化测试。`T`

### 3.2 Runtime：Timing no-op 的首次确认点

1. `editCharacterTimingInstance()` 先解析当前 Floor/Chat 和 edit-start version。`runtime/events.js:5480-5492`。
2. 它通过 `projectionTimingPersistence.getTimingInstances()` 解析当前 Instance。这是当前 Chat Owner Snapshot/本地 Floor 历史扫描，不是官方 `/api/chats/get`。`runtime/events.js:5570-5633`、`storage/projection-timing.js:338-386`。
3. Runtime 不信任 stale `timingInstanceId`，而是按当前 Floor/character 找出当前 Instance、Cycle 和冻结 sampled offset。`runtime/events.js:5634-5678`。
4. `projectionTimingPersistence.editTimingInstance()` 进入 `owner: projection` 的 `commitFloorPatch()`。`runtime/events.js:5681-5696`、`storage/projection-timing.js:282-294`。
5. Coordinator 在自己的 latest authoritative slot 上执行 patch resolver；`mutateFloor()` 对规范化 Timing Snapshot 调用 mutation。若 dedup/not-found，返回 `__floor_tx_noop`。`storage/projection-timing.js:219-273`。
6. 因此 Timing no-op 首次被确认的位置是 **Coordinator 已取得的最新权威 Slot 上的 Storage patch resolver**，不是 UI DTO，也不是 Runtime 最初的内存 Instance。
7. 在 no-op 判定前，当前 no-op Coordinator 事务已经完成 `OWNER_ACQUISITION` 和 `LATEST_SLOT_READ` 两次官方 GET；之后还会执行 `COORDINATOR_READBACK` 一次官方 GET。`storage/floor-persistence-coordinator.js:322-407`、`:452-518`。
8. no-op 分支不调用 `store.saveFloor()`，但仍通过 `store.readAuthoritativeFloor()` 回读并检查完整 Floor Version、owner/sibling 结果。`storage/floor-persistence-coordinator.js:452-517`。

**为什么已有数据不能直接复用：**

- Runtime 初始 `getTimingInstances()` 是本地 Store/历史扫描，不是对当前官方 Chat 的权威证明。
- `OWNER_ACQUISITION` 返回的是 owner/message/Swipe/version 关系，`LATEST_SLOT_READ` 返回的是用于 sibling-preserving merge 的最新 Slot；二者承担不同边界。
- latest read 之后到 patch resolver、no-op readback、UI 返回之间存在 `await` 和外部 Chat 写入窗口。
- no-op 返回成功仍需证明当前 owner、Floor Version、Swipe 和兄弟 Snapshot 没有在读后变成另一状态；当前没有 server-side CAS/revision 证据。

因此可以在 Coordinator 外做“可能 no-op”的提示或统计，但不能用它直接跳过 Coordinator。提前返回还可能把应当报告的 `FLOOR_VERSION_STALE`、Swipe 切换、Chat 变化或 readback failure 错误显示成成功。`S/T`

### 3.3 Aggregation：Timing no-op 后仍重评估

Timing readback 后，Runtime 收集当前业务数据、已有 Aggregation 和匹配 Tracking Window：`runtime/events.js:5795-5815`。随后把 `aggregation: null` 传入 `resolveParticipantAggregationTrigger()`，即使已有 Aggregation 曾经是 succeeded，也要求本次手动操作重新判断：`runtime/events.js:5816-5822`。

`core/participant-aggregation.js:168-177` 的触发语义包括：

- 已有 succeeded 的 Aggregation 在正常自动路径可能返回 `already_succeeded`；手动路径显式传空 aggregation，避免直接跳过。
- 策略必须为 `at_effective_min`。
- Story Time 不足或不可解析时是 `source_invalidated`/unresolved。
- elapsed 小于 effective min 时是 `before_min`。
- elapsed 大于 effective max 时是 `aggregate_due_overdue`，中间是 `aggregate_due`。

即使五项 Timing 参数不变，以下依赖也可能变化：

- 当前 Story Time 跨过 effective min/max；
- active Event 或 accepted exposure source IDs 变化；
- Tracking Window 的 subject、mechanism、cycle 或 source event IDs 变化；
- 既有 Aggregation 的存在、状态或有效范围变化；
- 当前 Floor、active Swipe、Floor Version 或 Chat boundary 变化；
- 同 Floor 另一个模块并发写入了需要保留的 sibling root。

对多个角色，自动管线按各 Timing Instance 独立选择 subject/cycle 和 source IDs：`runtime/events.js:3415-3531`。同一 Floor 的 sibling Aggregation 必须由 Storage/Coordinator 保留，不能因为当前操作只显示一个角色就把整棵 Snapshot 当成可替换对象。`storage/participant-aggregation.js:211-256`、`tests/participant-aggregation.test.js:328-348`。

**因此：** Timing no-op 只能说明 Timing root 不需要变化；它不能证明柳如烟、祁鸢或同 Floor 其他 tracking subject 的 Aggregation 不需要创建、移除、保留或更新。当前测试有合成的多 subject Event 独立性覆盖，但没有以这两个具体名称执行“同一手动 Timing no-op 的双角色 Aggregation”专用契约；`UNKNOWN`。`tests/event-analysis-runtime.test.js:3243-3267`。`S/T`

### 3.4 两笔事务的原因与边界

- Timing 写入 `projection_timing_snapshot`，owner 是 `projection`；Aggregation 写入 `participant_aggregation_snapshot`，owner 是 `participant_aggregation`。`storage/floor-persistence-coordinator.js:9-20`。
- 当前 Coordinator API 一次 `commitFloorPatch()` 只接受一个 owner/patch，队列也按 transaction key 串行执行；没有多-owner atomic transaction API。`storage/floor-persistence-coordinator.js:613-708`。
- Runtime 先完成 Timing 事务及其业务 readback，再用当前 Timing 和其他输入重评估 Aggregation。`runtime/events.js:5716-5799`。
- 所以两笔事务是当前实现的 owner 边界和依赖顺序选择；源码没有证明它们是永远不能合并的业务公理，也没有证明现在可合并。合并会改变“Timing 已确认、Aggregation 可独立失败”的 partial-success contract，不能作为 no-op 优化顺手实施。

## 4. 官方 GET/SAVE 阶段与必要性分类

分类：`A` = 独立权威读取有明确必要性；`B` = 有潜在复用空间但尚未证明安全；`C` = 源码和测试已证明可安全消除；`D` = 证据不足、无法判断。当前没有任何阶段达到 `C`。

> no-op Coordinator 事务只执行 `OWNER_ACQUISITION`、`LATEST_SLOT_READ` 和 `COORDINATOR_READBACK`，所以 no-op 是 `3 GET + 0 SAVE`。下面的六阶段表用于解释 changed 事务的完整链路。

| 阶段 | 实际数据与不变量 | 是否完整 `/api/chats/get` | 前后是否可能相同版本 | 中间窗口/已有数据 | 当前分类 |
|---|---|---|---|---|---|
| `OWNER_ACQUISITION` | 官方 owner、message identity、active Swipe、六字段 Floor Version、host/official owner 关系、消息计数和 predecessor；决定 stale 或 host-ahead convergence | 是，`runtime/events.js:505-575`、`:654-728` | 静止宿主可能相同 | 需要独立确认 owner 身份和官方边界；不能由 Slot 对象替代 | A |
| `LATEST_SLOT_READ` | Coordinator 队列内最新 Floor Slot，作为 sibling-preserving merge 和 dedup 基线 | 是，经 `runtime/events.js:2065-2084`、`storage/store.js:910-931` | 可能与 acquisition 的 Slot 相同 | acquisition 后有 await，外部 Chat/其他插件可修改；patch 必须针对最新 Slot | A |
| `SAVE_PREWRITE_READ` | 写入前再次解析官方 owner/message/index/Swipe，检查官方 Floor Version 和目标身份 | 是，`runtime/events.js:1001-1227` | 常常可能相同 | 低层写入边界自己需要 preflight；当前没有 server revision/CAS 证明可以借用 latest | B |
| `SAVE_AUTHORITATIVE_READBACK` | `/api/chats/save` 后读取官方 Slot，比较是否完全等于 merged value | 是，`runtime/events.js:1325-1366` | 不应与 prewrite 等同，因为中间已有写入 | SAVE 可能失败、丢失、被规范化或返回 ambiguous；必须确认落盘 | A |
| `SAVE_FINAL_SLOT_AUDIT` | host memory sync 后再次读取，比较 official/host owner、Swipe、Floor Version 和 sibling presence | 是，`runtime/events.js:1367-1432` | 成功且静止时可能与上一 readback 相同 | host sync 和再次 await 之间仍有外部写入；检查职责比值相等更宽 | B |
| `COORDINATOR_READBACK` | Coordinator 边界再次取得 authoritative Floor，检查 owner patch、siblings、完整版本并决定 `confirmed`/`noop` | 是，`storage/floor-persistence-coordinator.js:469-517`、`:543-610` | 可能与 final audit 相同 | 低层当前没有返回可直接兑现 Coordinator contract 的完整 Slot/revision；Coordinator 仍需自己的边界 | B |

### 4.1 不能把“同一 endpoint”当作“同一读取

当前确实存在同一个官方 `/api/chats/get` endpoint 被多次调用，但要区分：

1. **相同接口重复调用**：已确认，六阶段都可能落到同一 endpoint。
2. **相同数据重复读取**：宿主静止时可能返回相同 Chat/Floor Version，但当前 Debug 没有证明每次都相同。
3. **相同不变量重复验证**：owner、Swipe、Floor Version 在多层出现，但 owner acquisition、写入 preflight、落盘 readback、Coordinator return contract 不是同一个边界。
4. **可安全删除的重复读取**：当前没有 C 级证据；相邻 GET 只能说明存在 B 级研究空间。

## 5. 跨模块 Floor 写入清单

### 5.1 Event Analysis / Event Projection

**调用链：**

`ui/app.js:4675-4697::manualRefreshEventAnalysis` → `runtime/event-analysis.js:4211-4220::analyzeCurrentCharacterEvents` → AI/规范化 → `runtime/character-event-analysis.js:953-986` → shared `commitFloorPatch(target, "event", {analysis, events, character_registry})` → Coordinator。

- 不是直接 `store.saveFloor()`；`runtime/event-analysis.js:804-837` 包装共享 Coordinator。`S`
- 一个 AI 结果中的多个 Event 放进一个完整 `events[]`/registry patch，不是每个 Event 一笔事务。`runtime/character-event-analysis.js:972-980`。`S`
- Event changed 走普通 Coordinator 时，源码基线为 `1 tx / 6 GET / 1 SAVE`；no-op 为 `1 tx / 3 GET / 0 SAVE`。这是公共事务基线，不是附件中的 Event 宿主实测。`S/T`
- unchanged Event 可能跳过 Event root 写入，但仍可能根据 interval 生成 Projection Snapshot：`runtime/character-event-analysis.js:930-948`、`runtime/event-analysis.js:2176-2222`。`S`
- 手动 Event UI 等待 Event factual analysis；成功后 Projection postprocessor 使用 `void projectionPostProcessor(...)` 后台启动，用户不一定等待所有下游 Floor 写入：`runtime/event-analysis.js:3389-3414`。`S`
- 附件没有可归因 Event `official_io_calls`，真实 Event GET/SAVE 为 `UNKNOWN`。`H`

**结论：** Event 使用普通 Floor 保存路径时也会调用官方 Chat GET；“分析完成较快”可能来自一个多 Event 合并 owner patch，以及用户不等待后台 Projection，不是已证明没有 GET。

### 5.2 World Model

**调用链：**

- Section 保存：`ui/app.js:2664-2726::saveWorldModelSection` → `runtime/world-analysis.js:351-408::saveWorldModel`。
- Full/Patch 分析：`ui/app.js:3041-3188::analyzeWorldModel` → `runtime/world-analysis.js:620-705`。
- changed 写入：`runtime/world-analysis.js:383-392` → `commitFloorPatch(target, "world", {world_model, world_model_meta})`。

- changed World 与 Event/Timing 使用同一 Coordinator/Store/official adapter path；没有 World 专属少 GET 路径。`storage/floor-persistence-coordinator.js:9-20`。`S`
- World 有 `canonicalNoop`，在当前 Floor canonical equality 成立时跳过 Floor 事务：`runtime/world-analysis.js:620-681`。这是一条本地分析路径的 no-op，不等于一般并发条件下的权威 no-op；对应实际宿主请求数没有附件证据。
- changed World 的公共事务基线为 `1 tx / 6 GET / 1 SAVE`，canonical no-op 的 Floor I/O 为 `0/0`；业务模块级真实计数 `UNKNOWN`。`S/T/H`
- UI await World save，之后再 await `refreshTrackingAfterWorldModelSave()` 的内存 Tracking refresh：`ui/app.js:2652-2662`、`:2699-2724`。`S`

### 5.3 Character Analysis / Character State

- Character Analysis 没有独立 Character Floor owner；它写 Event owner 的 `analysis/events/character_registry`。`storage/floor-persistence-coordinator.js:11`、`runtime/character-event-analysis.js:977-980`。`S`
- Character State 由 `core/state.js:740-766` 和 `runtime/event-analysis.js:2234-2336` 从当前有效事实派生，读取不产生 Floor Snapshot。`S`
- `updateCharacterAliases()` 仍是 Event owner patch，不是新的 Character State 事务：`runtime/event-analysis.js:1780-1819`。`S`
- 多角色/多 Event 结果在完整 Event patch 中合并；没有每个角色独立保存的源码证据。`S`
- 现有 Runtime tests 多使用 local `saveFloorCalls()`，没有一次 Character Analysis 的官方 endpoint 总计数；真实宿主为 `UNKNOWN`。`tests/event-analysis-runtime.test.js` 多处 Event fixture。`T/H`

### 5.4 Tracking Window / Tracking Registry

- `storage/tracking-window.js:16-74::createTrackingWindowPersistence` 以 `owner: tracking` 写 `tracking_window_timeline`；changed 能力路径为一个 Coordinator 事务，dedup 为 no-op 事务：`storage/tracking-window.js:32-55`。`S`
- `runtime/tracking-window-runtime.js:29-42::resolveTrackingWindows` 只有在调用方注入 `persist` 时才 await 写入，并在前后检查 current context。`S`
- Event Analysis 的持久化 callback 在 `runtime/event-analysis.js:2454-2466`；当前直接调用图没有找到生产 `resolveTrackingWindows()`、`appendTrackingWindow()` 或 `saveTrackingWindowTimeline()` 的其他直接 caller，生产触发频率为 `UNKNOWN`。`S`
- `runtime/tracking-runtime.js:57-83::refreshTrackingRegistry` 主要构建内存 Window/Registry，不是 Floor 写入。`S`
- explicit Tracking changed/no-op 的公共基线分别为 `1 tx / 6 GET / 1 SAVE` 和 `1 tx / 3 GET / 0 SAVE`；现有测试只断言 local save/dedup/Swipe，没有官方 endpoint 总数：`tests/tracking-window-persistence.test.js:36-62`。`T`

### 5.5 Character Timing Config 与 Timing Instance（必须分开）

| 项目 | 入口 | 目标 | Coordinator | 官方 Floor GET/SAVE |
|---|---|---|---|---|
| Character Timing Config | `ui/app.js:4181-4229` 无当前 Instance 分支 → `runtime/events.js:6106-6110` | `chat.settings.character_timing_configs` | 否 | `0/0`（源码未走 `/api/chats/get` 或普通 `/api/chats/save`；实际 host metadata save endpoint `UNKNOWN`） |
| Timing Instance | 同一 UI 的有 Instance 分支 → `runtime/events.js:5480-6033` → `storage/projection-timing.js:282-294` | Floor `projection_timing_snapshot` | 是，owner `projection` | no-op `3/0`；changed `6/1` |

Config 使用 `store.getChat()`/`store.saveChat()` 和 `context.saveMetadata()`：`storage/character-timing.js:3-23`、`storage/store.js:810-828`、`runtime/events.js:1632-1651`。它更快是因为存储目标不同，不能作为 Timing Instance 的安全 precedent。`S`

### 5.6 Participant Aggregation

- 目标是 Floor `participant_aggregation_snapshot`，Storage 使用 `owner: participant_aggregation`：`storage/participant-aggregation.js:14`、`:211-256`。`S`
- Manual Timing 在 `runtime/events.js:5861-5905` 可能 remove，在 `:5953-6004` 可能 upsert；这是 Timing 之后的独立 Coordinator 事务。
- 单独 Aggregation changed/no-op 的公共基线分别为 `1 tx / 6 GET / 1 SAVE` 和 `1 tx / 3 GET / 0 SAVE`；`tests/participant-aggregation.test.js:170-190` 证明 local dedup，未证明官方 endpoint 总数。`S/T`

### 5.7 Projection AI 结果与其他 Floor owners

- Projection AI 结果通过 `storage/projection.js:43-203` 写 `projection_timeline`/相关 Snapshot，使用 `owner: projection`。
- `runtime/projection-runtime.js:594-632` 对一个 candidate 先 `saveGeneratedProjection()`，再可能单独 `saveProjectionEvidence()`；这不是一个固定事务数。每个实际 changed owner patch 的公共基线仍为 `6 GET + 1 SAVE`，总数取决于 candidate/evidence/delivery/evolution/lifecycle，真实总数 `UNKNOWN`。
- Event 成功后的 Projection postprocessor 是后台 `void` 任务：`runtime/event-analysis.js:3389-3414`；这解释用户感受，不证明少 I/O。
- Health：`runtime/health-assessment.js:155-173` 使用 `owner: health`；Lifecycle：`storage/pregnancy-lifecycle.js:38-154` 使用 `owner: lifecycle`，一次操作可能一笔或多笔，均未在附件中独立观测。`S/H`
- `terminal` 是失败/取消状态的 `analysis` 写入，不是普通成功分析路径：`runtime/event-analysis.js:3542-3548`。`S`

## 6. 跨模块持久化对照表

“静态基线”是一次公共 Coordinator owner patch；“实际宿主”只有附件确实出现的操作才填写具体数值。

| 模块/操作 | 一次操作事务数 | GET | SAVE | 是否等待 | 证据来源 |
|---|---:|---:|---:|---|---|
| Event factual changed | 1；可有下游 owner | 静态 6；模块实测 `UNKNOWN` | 静态 1；实测 `UNKNOWN` | UI 等待 factual；Projection 可后台 | `S`: `character-event-analysis.js:953-1058`; `T`: Event fixtures; `H`: 无 Event 样本 |
| World changed | 1 | 静态 6；实测 `UNKNOWN` | 静态 1；实测 `UNKNOWN` | UI await save 和内存 refresh | `S`: `world-analysis.js:620-715`; `H`: 无 World 样本 |
| World canonical no-op | 0 Floor tx | 0（源码分支） | 0（源码分支） | 仍等待分析流程 | `S`: `runtime/world-analysis.js:620-681` |
| Character Analysis | Event owner 同上 | 同 Event；`UNKNOWN` | 同 Event；`UNKNOWN` | factual await；下游可能不 await | `S/T`; `H`: 无独立样本 |
| Character State read | 0 | 0 | 0 | 只读/内存派生 | `S`: `core/state.js:740-766` |
| Tracking Registry refresh | 0 | 0 | 0 | 等待内存 refresh | `S`: `runtime/tracking-runtime.js:57-83` |
| Tracking Window explicit changed/no-op | 1 / 1 | 6 / 3 | 1 / 0 | 被调用时 await persist | `S/T`: `tracking-window.js:32-55`; `tracking-window-persistence.test.js:36-62` |
| Character Timing Config | 0 Floor；1 Chat-local metadata save | 官方 Floor `0`；metadata endpoint `UNKNOWN` | 官方 Floor `0`；metadata endpoint `UNKNOWN` | UI await metadata save | `S`: `character-timing.js:3-23` |
| Timing Instance no-op | 1 | 3 | 0 | 是 | `T`: `runtime.test.js:951-969`; `H`: 每笔 3/0 |
| Timing Instance changed | 1 | 6 | 1 | 是 | `T`: `runtime.test.js:918-945`; `H`: 每笔 6/1 |
| Aggregation no-op | 1（若重评估调用 mutation） | 3 | 0 | Manual Timing 中 await | `S/T`: `participant-aggregation.test.js:170-190`; `H`: 每笔 3/0 |
| Aggregation changed | 1 | 6 | 1 | Manual Timing 中 await | `S`: `events.js:5953-6004`; `H`: 每笔 6/1 |
| Timing + Aggregation no-op | 2（本次重评估确实调用第二 owner） | 6 | 0 | 是 | `H`: `161455`、`161512`、`163029` 中 no-op |
| Timing + Aggregation changed | 2 | 12 | 2 | 是 | `H`: `161512`、`163029` |
| Projection AI candidate | 至少 1；candidate/evidence 可为多笔 | 每笔静态 6；总数 `UNKNOWN` | 每笔静态 1；总数 `UNKNOWN` | Event 触发可后台 | `S`: `projection-runtime.js:594-632`; 无 `H` |
| Health / Lifecycle | 1 至多多笔，取决于结果 | 每笔静态 6；总数 `UNKNOWN` | 每笔静态 1；总数 `UNKNOWN` | 由调用方决定 | `S`: `health-assessment.js:155-173`; `pregnancy-lifecycle.js:38-154` |

## 7. 当前请求计数与真实宿主时间

### 7.1 公共 Coordinator 测试

`tests/runtime.test.js:855-976` 直接断言：

- changed：`6 /api/chats/get + 1 /api/chats/save`，阶段是 `OWNER_ACQUISITION`、`LATEST_SLOT_READ`、`SAVE_PREWRITE_READ`、`SAVE_AUTHORITATIVE_READBACK`、`SAVE_FINAL_SLOT_AUDIT`、`COORDINATOR_READBACK`：`tests/runtime.test.js:918-945`。
- no-op：`3 GET + 0 SAVE`，阶段是 `OWNER_ACQUISITION`、`LATEST_SLOT_READ`、`COORDINATOR_READBACK`：`tests/runtime.test.js:951-969`。
- 低层官方 Floor save 测试 `tests/runtime.test.js:773-853` 的 `3 GET + 1 SAVE` 只覆盖 prewrite/readback/final audit，不包含完整 Coordinator owner/latest/readback，不能当普通业务 precedent。

### 7.2 真实宿主 Debug

| 文件 | operation | 事务结构 | GET | SAVE | 观察 |
|---|---|---|---:|---:|---|
| `/Users/ll/Downloads/ST-BioWeave-Debug-20261017-161455.txt` | Timing no-op 操作 | Timing no-op + Aggregation no-op | 6 | 0 | Timing owner acquisition 约 2470.1ms；Coordinator readback 约 1742.5ms |
| `/Users/ll/Downloads/ST-BioWeave-Debug-20261017-161512.txt` | `timing_perf_mvc4f73j_6` no-op | Timing no-op + Aggregation no-op | 6 | 0 | 同一文件同时包含 no-op 和 changed 操作 |
| `/Users/ll/Downloads/ST-BioWeave-Debug-20261017-161512.txt` | `timing_perf_mvc4fmb7_c` changed | Timing changed + Aggregation changed | 12 | 2 | 每笔 changed txn 为 6/1 |
| `/Users/ll/Downloads/ST-BioWeave-Debug-20261017-163029.txt` | `timing_perf_mvc4z20y_3` no-op | Timing no-op + Aggregation no-op | 6 | 0 | Aggregation latest/readback 可出现约 1.7～1.9s 等待 |
| `/Users/ll/Downloads/ST-BioWeave-Debug-20261017-163029.txt` | `timing_perf_mvc4z9y5_5` changed | Timing changed + Aggregation changed | 12 | 2 | 保存及 readback 成功 |

附件没有 Event、World、Character Analysis、Tracking Window 或 Projection AI 的可归因官方 I/O，因此不能用“其他模块较快”反推出它们没有 `/api/chats/get`。

## 8. 四种方案对照与量化

以下“当前 no-op”以真实宿主已观察到的 Timing + Aggregation 两笔 no-op 为基线；“未知”不填理论值。

| 指标 | 当前 | 方案 A：保持现状 | 方案 B：仅 UI dirty | 方案 C：Runtime 权威 no-op 快速路径 | 方案 D：Coordinator 内部 no-op 优化 |
|---|---:|---:|---:|---:|---:|
| Floor 事务数 | 2 | 2 | 若只提示则 2；若阻止则 0（不安全） | 至少仍需 Aggregation 事务；具体 `UNKNOWN` | 保持 2 |
| 官方 Chat GET | 6 | 6 | 0（若阻止，但不安全）；提示则 6 | 最小安全数 `UNKNOWN` | 当前仍 6；若证明可复用，理论每笔 no-op 减 1，目标 2（未验证） |
| 官方 Chat SAVE | 0 | 0 | 0 | 0（no-op 假设） | 0 |
| Aggregation 是否重评估 | 是 | 是 | 若阻止则否（可能漏更新）；提示则是 | 必须仍是，除非另有独立权威证明 | 是 |
| Floor Version 校验 | 保留 | 保留 | 阻止路径可能丢失 | 必须保留 | 保留 |
| Swipe/Chat/epoch 校验 | 保留 | 保留 | 阻止路径可能丢失 | 必须保留 | 保留 |
| 权威 readback | 保留 | 保留 | 阻止路径没有 | 不能直接删除，所需形式 `UNKNOWN` | 保留；仅研究结果复用 |
| 部分成功语义 | 保留 | 保留 | 可能变成错误成功 | 必须保留 | 保留 |

### 8.1 方案 A：保持现状

- 正确性基线；没有性能收益。
- 适合在新优化证据不足时作为回归参照。
- 不需要新增并发假设。

### 8.2 方案 B：UI dirty

- 可以保存五项 draft 与打开时基线，识别用户改动后又改回原值。
- **安全用法**是提示“表单未变化”或更新 UI 状态；官方请求减少 `0`。
- **不安全用法**是直接阻止 Runtime：编辑器打开期间 Floor 可能变化，且 Timing no-op 不代表 Aggregation no-op；会掩盖 stale、错过 `before_min`/due/overdue 和角色 Aggregation 创建/移除。
- 因此不能把 UI dirty 等同于持久化 no-op，也不能标为 P1 性能优化。

### 8.3 方案 C：Runtime 权威 no-op 快速路径

- 进入 Runtime 后仍至少要验证当前 Chat、active Swipe、完整 Floor Version、edit-start version、当前 Instance ID、Cycle ID、五项参数和冻结 offset。
- 仅做一次权威 GET 后直接成功返回仍有“读后到返回”的并发窗口；当前默认官方 Chat 路径没有证明的 CAS/revision lock。
- 即使 Timing authority no-op 被确认，Aggregation 仍必须按当前 Story Time/Event/Window/既有 Snapshot 重评估。
- 因此该方案不是简单把 UI dirty 传给 Runtime；需要新增只读 Coordinator 能力、不可变 revision/CAS 或等价的“读后返回前不可被外部写入”的证明。请求数字 `UNKNOWN`。

### 8.4 方案 D：Coordinator 内部 no-op 优化

- 保持 Runtime/Storage 业务边界和两笔 owner 事务，只研究是否可把 Coordinator 已有的 latest authoritative read 安全上提为 no-op 返回结果，或让低层完整 readback 结果满足上层 contract。
- 当前不能直接删除 `COORDINATOR_READBACK`：低层 adapter 没有返回完整 authoritative Slot、siblings、host audit 和 revision token；Coordinator readback 是自己的返回边界。
- 若将来证明 latest read 是最终权威点，或官方 save/readback 返回不可变 revision 并由 Coordinator 验证，理论上每笔 no-op Coordinator 可减少 1 GET；Timing + Aggregation no-op 理论目标为 `2 GET`。当前实测减少 `0`。
- 这是四个方案中最不改变业务语义的研究方向，但不是本轮可立即实施的删除动作。

## 9. 并发、stale、失败和提前返回风险

| 候选返回点 | 可能发生的变化 | 提前成功的风险 | 当前结论 |
|---|---|---|---|
| UI 点击保存前 | Chat 切换、编辑器聚焦角色变化、Floor/Swipe 变化 | 用旧 UI baseline 错报 no-op，跳过 stale | 不可直接返回 |
| Runtime 初始本地 `getTimingInstances()` 后 | 同 Floor Timing 被其他操作修改，历史/当前 Slot 变化 | local read 不是权威，可能写错 Instance/Cycle | 只能作为输入，不能短路 |
| `OWNER_ACQUISITION` 后 | 外部插件/Tab/宿主改变 Chat 或 Swipe | acquisition 与 latest/readback 不同 revision | 不能替代 latest |
| `LATEST_SLOT_READ` 后 | 同 Floor 另一个 owner 写入 sibling；当前 Timing/Aggregation 被修改 | 丢 sibling、接受 stale、错误 no-op | 需要队列与最新 Slot；不能移到队列外 |
| no-op 判定后、返回前 | 外部 Chat 写入、Chat epoch 改变、官方读回失败 | 原本应失败的操作显示成功 | 需要 CAS/锁/最终权威点 |
| Timing no-op 后 | Story Time/Event/Window/已有 Aggregation 改变 | 漏 `before_min`、due/overdue、create/remove/preserve | 必须重评估 Aggregation |
| Aggregation latest read 后 | 同 Floor 另一角色/模块写入 | 覆盖 sibling 或错误保留/删除 | 保留 Aggregation Coordinator |
| changed SAVE 后 | 官方 SAVE unknown/网络失败/服务器规范化 | 提前成功无法证明落盘 | 保留 post-save readback/final audit |
| Timing 成功、Aggregation 失败后 | 只有 Timing 已持久化 | 若统一成功会掩盖部分成功 | 保留 `timing_persisted` 和 UI reconciliation |

Coordinator 队列按 Chat/Floor/Swipe/version 相关 key 串行 BioWeave 事务，但它不等于官方 Chat 服务端 CAS，也不阻止其他插件/Tab/宿主在 GET 之间写入。`storage/floor-persistence-coordinator.js:613-708`、`runtime/events.js:919-1432`。`S`

“epoch”在当前路径主要通过 Chat token/`chat.getEpoch()` 和 `chat.assert(token)` 保护 Chat 生命周期；它不是 Floor Version 中另一个独立持久字段。`runtime/events.js:505-575`、`storage/store.js:910-931`。没有独立 Timing persisted epoch 证据，不能把它虚构为 Snapshot 字段。

## 10. 现有测试覆盖矩阵

| 场景 | 当前覆盖 | 证据/缺口 |
|---|---|---|
| 1. 完全无变化保存 | 部分 | 公共 Coordinator no-op `3 GET/0 SAVE`：`tests/runtime.test.js:951-969`；没有完整 Runtime 手动 Timing no-op + Aggregation 计数契约 |
| 2. 修改后改回原值 | 缺失 | `tests/ui.test.js:180-300` 只测 Restore 后点击保存，不测 canonical equality/dirty |
| 3. 恢复默认且与原值相同 | 缺失 | Restore 不立即保存已覆盖；恢复后点击 Save 的 UI no-op 缺失 |
| 4. Timing no-op、Aggregation no-op | 部分 | Timing/Aggregation local dedup：`tests/projection-timing.test.js:138-180`、`tests/participant-aggregation.test.js:170-190`；真实宿主 H 证据有 6/0；缺完整 Mock Adapter Runtime 组合测试 |
| 5. Timing no-op、Aggregation changed | 缺失 | 没有证明 Story Time/Event/Window 变化时仍重评估并只产生正确第二事务的整链测试 |
| 6. Timing changed、Aggregation no-op | 部分 | `tests/event-analysis-runtime.test.js:1678-1722` 覆盖有效 Aggregation 保留/范围变化，但没有官方 I/O count 组合断言 |
| 7. Timing changed、Aggregation changed | 部分 | `tests/event-analysis-runtime.test.js:1724-1755` 有成功诊断；H 有 12/2；缺各阶段组合断言 |
| 8. Floor Version stale | 已有 | `tests/event-analysis-runtime.test.js:1626-1675`；Projection stale edit-start tests 见 `tests/projection-timing.test.js:317-348` |
| 9. Swipe 切换 | 已有 | `tests/projection-timing.test.js:138-180`、`tests/participant-aggregation.test.js:170-190`、Tracking `tests/tracking-window-persistence.test.js:36-62` |
| 10. epoch 变化 | 不完整 | Chat token/assert 有源码保护，但没有明确的手动 Timing epoch 变化竞态测试；需新增 |
| 11. 同 Floor 并发写入 | 已有局部 | Timing sibling：`tests/projection-timing.test.js:531-551`；Aggregation sibling：`tests/participant-aggregation.test.js:328-348`；需增加 Runtime 两笔事务竞态 |
| 12. readback 失败 | 部分 | Coordinator readback/no-op contract：`tests/floor-persistence-coordinator.test.js:186-290`；缺官方服务端外部修改后的整链 Runtime no-op 返回语义 |
| 13. Aggregation 持久化失败后的部分成功 | 已有 | `tests/event-analysis-runtime.test.js:2060-2098` 验证 `PERSIST_FAILED`/无 Aggregation state；应再断言 UI reconciliation |
| 14. 两个角色 Aggregation 独立性 | 部分 | 合成双 subject Event：`tests/event-analysis-runtime.test.js:3243-3267`；没有同 Floor 手动 Timing + 柳如烟/祁鸢独立结果专用测试 |
| 15. 历史 Floor 不可变 | 已有局部 | Projection/Participant history、active Swipe 和 provenance 测试：`tests/projection-timing.test.js:231-315`、`tests/participant-aggregation.test.js:231-325`；需增加 no-op 快速路径不触碰历史的契约 |

### 实施方案 D 前必须补的测试/能力

1. 官方 Mock Adapter 在 `LATEST_SLOT_READ` 与 Coordinator 返回之间注入外部 Chat/Floor 修改，验证任何复用仍能拒绝 stale。
2. 注入 Chat 切换、Swipe 切换、epoch/token 变化、Floor Version 变化，验证 no-op 不会错误成功。
3. 注入 SAVE unknown、authoritative readback mismatch、final audit mismatch，验证 partial/error 语义不改变。
4. 在同一 Floor 并发执行 Timing、Aggregation、Event/World sibling 写入，验证完整 Snapshot 和 sibling 保留。
5. 增加完整 Runtime 组合矩阵：Timing no-op/changed × Aggregation no-op/changed，按 `floor_transaction_id` 统计官方 GET/SAVE。
6. 明确官方服务端是否提供不可变 revision/CAS；如果没有，不能把单次 read + return 宣称为安全优化。
7. 为多 tracking subject（包括柳如烟、祁鸢的等价测试数据）验证 Aggregation 独立 create/remove/preserve。

## 11. 分级优化建议

### P0：没有已证实项目

当前没有源码、测试或 Debug 证据证明某一次 GET 是错误请求、无效请求或违反契约的请求。不能仅因为 endpoint 相同、版本可能相同就标 P0。

### P1：没有已证实项目

现有证据不能在保留所有 authority/stale/readback 语义的条件下证明任何 GET 可立即删除；因此没有 P1 请求删除建议。

### P2：方案 D，先补能力再评估实施

- **对应源码**：`storage/floor-persistence-coordinator.js:452-610`、`runtime/events.js:1325-1432`、`:1377-1432`。
- **当前行为**：no-op 使用 latest 后仍执行 Coordinator readback；changed 低层已有 SAVE-side authoritative readback/final audit，Coordinator 再执行自己的 readback。
- **预期收益**：若新增不可变 revision/CAS 或返回值完整性证明，理论上每笔 no-op Coordinator 减少 1 GET；Timing + Aggregation no-op 理论为 `6 → 2 GET`。当前已证明收益 `0`。
- **事务边界**：保持 Timing 与 Aggregation 两笔事务、保持先 Timing 后 Aggregation，不改变 partial-success 语义。
- **并发风险**：没有 CAS/最终权威点时会丢失读后并发保护；低层 readback 与 Coordinator readback的职责不能只因数据相同就合并。
- **需要测试**：见第 10 节的外部修改、token/Swipe/version、readback failure、sibling、四象限组合和多 subject 测试。
- **是否立即实施**：否。先确认宿主 revision/CAS 或建立等价串行保证。

### P3：方案 B 的 UI dirty 仅作提示，以及分阶段等待提示

- **对应源码**：`ui/app.js:4148-4179`、`:4181-4369`。
- **当前行为**：没有 dirty；保存 UI 同步等待完整 Timing + Aggregation 流程。
- **预期 GET/SAVE 减少**：`0`。它可以减少无意义的表单提交感或显示“未改变”，但不应阻止 authority 流程。
- **并发风险**：若只作提示，风险低；若直接 return，风险与方案 B 的不安全分支相同。
- **需要测试**：modify-revert、restore-equal、编辑器打开期间 Floor stale、UI error/reconciliation。
- **是否立即实施**：作为产品体验研究可行；不属于本轮性能优化，不应替代方案 D 的 authority 证明。

### 方案 C：不建议直接实施

它比 D 更早离开现有 Coordinator 边界，必须新增只读 authority/serialization 语义；即使安全跳过 Timing 事务，Aggregation 仍需单独重评估。当前没有可验证的最少 GET 数，也没有充分测试基础。

## 12. 用户可见等待：不提前成功的处理方式

如果暂时不能安全提前返回，仍可研究以下不改变持久化结果的方向：

- 在 `ui/app.js:4200-4369` 的 `saving` 状态中显示“Timing 持久化 / Timing 回读 / Aggregation 重评估 / Aggregation 回读”阶段。
- 保持 `await runtime.editCharacterTimingInstance()`，只有所有要求的权威 readback 完成才显示成功。
- 如果下游失败，继续保留 `timing_persisted` 和 reconciliation，明确“Timing 已保存、Aggregation 失败”，不要转成后台静默失败。

这只改变等待反馈，预期官方 GET/SAVE 减少 `0`；把 Aggregation 变成未 await 后台任务会改变错误可见性和 partial-success 契约，当前不建议。

## 13. 仍未解决的问题与所需证据

1. **其他模块的真实宿主计数**：附件没有 Event/World/Projection/Tracking 样本；需逐条启用 operation ID 并按 `floor_transaction_id`/`io_purpose` 采集。
2. **Coordinator readback 结果是否可上提复用**：需要完整 Slot、siblings、Floor Version、Swipe、host/official revision 和 server CAS 语义；不能只返回 `commitState`。
3. **LATEST 与 SAVE_PREWRITE 是否同 revision**：需在两次 `await` 间注入外部 Chat 修改，验证当前错误码和 stale 行为。
4. **默认 SillyTavern 官方 Chat API 是否提供原子 compare-and-save**：当前源码未证明；需要宿主 API 契约或真实 adapter 证据。
5. **Tracking Window 的动态间接调用**：静态直接调用图未找到全部生产 caller，需运行时 trace 或构建入口确认。
6. **官方 GET 的 1.5～2 秒延迟来源**：当前只能确认 GET 等待造成用户感知，不能仅凭插件 JSON parse 字段归因到服务器、网络或响应体阶段。

## 14. 最终结论

- **问题一：** 完全不修改 Timing 仍进入两笔事务，是因为 UI 无 dirty 短路，Timing no-op 仍需权威 Coordinator 校验/readback，随后 Runtime 强制重评估 Aggregation；Aggregation no-op 也有自己的 Coordinator 边界。
- **问题二：** 当前没有足够证据可靠确认 Timing 与 Aggregation 都无需变化并安全跳过两笔完整事务。Timing no-op 与 Aggregation no-op 是两个独立事实。
- **问题三：** 最值得实施的一个方案是 **D：Coordinator 内部 no-op/readback 结果复用研究**；它最能保持现有业务边界。**但当前不立即实施，已证明的实际请求减少为 0。**
- **问题四：** 必须补官方 revision/CAS 或等价串行化能力，以及外部修改、Chat/Swipe/epoch、readback failure、同 Floor 并发、多 subject 和四象限组合测试。
- **问题五：** 在证据补齐前，安全减少用户主观等待的方式是分阶段显示同步保存进度并继续等待权威确认；不能把持久化放到未观测的后台后提前报告成功。
