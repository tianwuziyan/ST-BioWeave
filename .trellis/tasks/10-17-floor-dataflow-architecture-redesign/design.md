# Floor 数据流架构重整设计

## 1. 设计判断

推荐的目标不是“把所有写入改成 `context.chat` + `saveChat()`”，而是把读取和写入的职责拆开：

```text
当前 Chat Context / Floor storage view
        ↓
内部计算与纯 Snapshot merge
        ↓
owner-scoped write intent
        ↓
宿主能力检查 + 当前 owner/version guard
        ↓
已证明安全的 native patch 或现有 Coordinator
        ↓
宿主保存
        ↓
confirmed / failed / unknown
```

在当前证据下，生产默认仍然是现有 Coordinator。Context-first 目前只能安全地作为内部计算输入和 merge 准备层；它不能单独替代权威 owner acquisition、最新 Snapshot 基线、冲突保护或确认 readback。

证据等级：

- `SOURCE_VERIFIED`：当前 BioWeave checkout 或已固定的宿主源码快照。
- `TESTED_IN_ISOLATION`：隔离原型/Promise barrier 测试模型。
- `REAL_HOST_BASELINE`：既有真实 SillyTavern Debug 或人工验收。
- `HOST_UNVERIFIED`：当前运行宿主 build、服务端竞争或 native API 契约没有直接证据。
- `DESIGN_PROPOSAL`：本文件提出、尚未实现的接口或流程。
- `BLOCKED`：缺少必要宿主能力，不能进入生产。

## 2. 当前生产数据流

### 2.1 通用 Floor owner 写入

```text
Event / World / Projection / Timing / Tracking / Aggregation
        ↓ 业务模块计算与本地读取
owner-scoped patch
        ↓ runtime/event-analysis.js::commitFloorPatch 或 storage owner module
FloorPersistenceCoordinator::commitFloorPatch
        ↓ transaction_key 串行化
OWNER_ACQUISITION       → 官方 Chat GET
LATEST_SLOT_READ        → 官方 Chat GET
SNAPSHOT_MERGE          → owner allowlist + sibling preservation
        ├─ no-op → COORDINATOR_READBACK → 官方 Chat GET
        └─ changed → saveFloor
                    → SAVE_PREWRITE_READ /官方 GET
                    → /api/chats/save
                    → SAVE_AUTHORITATIVE_READBACK /官方 GET
                    → SAVE_FINAL_SLOT_AUDIT /官方 GET
                    → COORDINATOR_READBACK /官方 GET
        ↓ confirmed / failed / unknown
Runtime derived state / UI
```

源码：`storage/floor-persistence-coordinator.js:281-610,613-708`、`storage/store.js:879-930`、`runtime/sillytavern-adapter.js:397-485`、`runtime/event-analysis.js:804-837`。

### 2.2 Timing + Aggregation

```text
ui/app.js::saveCharacterTiming
  → runtime/events.js::editCharacterTimingInstance
  → projectionTimingPersistence.editTimingInstance
  → projection owner Coordinator 事务
  → 本地 Timing 业务 readback
  → collectActiveBusinessData + getParticipantAggregations
  → resolveParticipantAggregationTrigger(aggregation: null)
  → participantAggregationPersistence.remove/upsert
  → participant_aggregation owner Coordinator 事务
  → 本地 Aggregation readback
  → UI 显示 confirmed 或 timing_persisted partial failure
```

源码：`ui/app.js:4181-4359`、`runtime/events.js:5480-6037`、`storage/projection-timing.js:219-295`、`storage/participant-aggregation.js:211-275`。

### 2.3 当前已知计数

| 操作 | Floor 事务 | 官方 GET | 官方 SAVE | 证据 |
|---|---:|---:|---:|---|
| 普通 Floor no-op | 1 | 3 | 0 | `tests/runtime.test.js:949-969`；`REAL_HOST_BASELINE` |
| 普通 Floor changed | 1 | 6 | 1 | `tests/runtime.test.js:918-947`；`REAL_HOST_BASELINE` |
| Timing + Aggregation no-op | 2 | 6 | 0 | 三份真实 Debug 与既有报告，`REAL_HOST_BASELINE` |
| Timing + Aggregation changed | 2 | 12 | 2 | 真实 Debug 与既有报告，`REAL_HOST_BASELINE` |

Event/World/Projection/Tracking 的业务级真实宿主总数没有独立 Debug 证据；公共 Coordinator 的静态基线不能伪装成每条业务路径的实测值。

## 3. 目标数据流与职责

### 3.1 Floor State Manager：优先复用现有 Store + Floor resolver

这不是立即新建的 Module。当前职责已经分散但可识别：

- `storage/store.js:831-873,933-947`：从当前 Context 读取精确 message/Swipe Floor 和 Chat owner snapshot。
- `runtime/floor.js:1-8,130-167`：计算和比较六字段 Floor Version。
- `runtime/chat.js:13-95`：Chat ID/epoch token 和生命周期失效。
- `runtime/event-analysis.js`、各 owner storage：解析当前有效 Floor、历史继承和 provenance。

建议的未来接口（`DESIGN_PROPOSAL`，不是生产 API）：

```text
captureFloorView(target) -> {
  chatId, epoch, messageId, floor, activeSwipe, floorVersion,
  currentFloor, validHistoricalRoots, sourceRevision?, status
}
assertCurrent(view) -> confirmed | throws STALE
readOwnerRoot(view, owner) -> root + provenance
```

接口必须返回“当前 Context 视图”而不是声称服务器权威。它不能把 runtime cache、Chat-level map 或旧 DTO 变成历史事实源。若当前 View 与宿主 Context 不一致，状态为 `STALE`，不可直接 native 写入。

### 3.2 Snapshot Merge Engine：纯函数 seam

需要一个小接口、深实现的纯 Module；首选从现有 `preparePersistedPatch`、各 owner 的 `patchResolver` 和 domain normalizer 抽取测试面，而不是新增第二套 storage repository。

```text
mergeOwnerPatch({latestFloor, owner, patch, expectedVersion})
  -> {mergedFloor, changed, preservedSiblings, errors}
```

不变量：

- 只接受 `FLOOR_OWNER_FIELDS` 中当前 owner 的字段。
- 以 latest authoritative slot 或能力契约提供的等价 immutable baseline 为输入。
- 缺失 root 与显式 empty root 不同；显式空集合阻止历史继承。
- 保留所有 pre-existing sibling roots、其他 Swipe、历史 Floor、未知 extension 字段。
- 不直接读写 `message.extra`；Host Adapter 是唯一 raw slot writer。
- merge 是可重复、无副作用、可单独测试的；它不决定 confirmed。

当前 `storage/projection-timing.js:232-270` 和 `storage/participant-aggregation.js:224-253` 已经体现了在 Coordinator 内用 latest 做 owner-scoped merge 的正确方向；新设计应复用该 seam，而不是在 Runtime 复制 merge。

### 3.3 Floor Write Coordinator：保留现有 Coordinator 角色

Coordinator 负责：

- 同一完整 transaction key 的插件内串行化。
- owner、Chat、active Swipe、Floor Version、execution/epoch guard。
- latest Snapshot merge、save、官方 readback、sibling audit。
- `confirmed`、`failed`、`unknown` 结果。

它不能被一个“快速保存” Module 绕过。未来如果宿主提供真正的 owner patch/CAS，可以在 Coordinator 与 Host Adapter 之间增加一个能力 Adapter；仍由 Coordinator 统一决定是否允许 native path 和何时 fallback。

### 3.4 Host Persistence Adapter：复用现有 Adapter，隔离宿主差异

`runtime/sillytavern-adapter.js:190-233,397-485,575-597` 已拥有：

- Context/raw message/Swipe 读取和写入。
- `/api/chats/get`、`/api/chats/save` 传输。
- source revision 计算和官方 I/O trace。
- Chat-local metadata 保存。

未来允许新增的最小能力接口（`DESIGN_PROPOSAL`）：

```text
readCurrentContextOwner() -> live view
readAuthoritativeOwner() -> owner + immutable revision
saveOwnerPatchIfRevision({owner, patch, expectedRevision})
confirmOwner({owner, expectedRevision, expectedPatch})
```

只有宿主实际提供原子条件写入或等价的 serialized owner patch 时，第三个接口才可声明 `confirmed`。普通 `saveChat()`、`saveChatDebounced()`、应用层 sourceRevision 比较都不满足该条件。若能力不存在，Adapter 返回 `UNSUPPORTED`，Coordinator 走现有严格路径。

## 4. 全部 Floor 数据生命周期

| 模块/数据 | 计算者与输入 | Context/内存可用性 | 当前持久化目标 | 继承/清空 | 当前保存/确认职责 |
|---|---|---|---|---|---|
| Event / Character Analysis | `runtime/character-event-analysis.js::runEventAttempt` 规范化 AI 结果、当前 Floor/World/Registry、Recent Story | AI 结果、当前 Floor 和派生输入在 Runtime 内；历史 previous 需按当前有效 Floor 扫描 | `analysis`、`events`、`character_registry`，Event owner；`runtime/character-event-analysis.js:953-986` | 继承最近合法完整 Character Floor；显式 `events: []` 清空；历史 Floor 不变 | shared Coordinator；Event save 后本地 canonical readback；Health/Projection 下游独立，Projection 可后台 `void`，源码 `runtime/event-analysis.js:3389-3414`；失败不替换旧事实 |
| World Model | `runtime/world-analysis.js` 根据 permitted evidence、Full/Patch 规则计算 complete model | 当前 World/analysis input 在 Runtime；canonical equality 可在当前 Floor 视图判断 | `world_model`、`world_model_meta`；`runtime/world-analysis.js:384-392` | 最近合法 World 可作分析 baseline；World clear 只清 World roots；canonical no-op 分支不写 | World owner Coordinator；`canonicalNoop` 在 `runtime/world-analysis.js:620-681` 跳过事务；changed 后 UI-ready/readback，`707-725` |
| Character State | `core/state.js::reduceState` 从有效 Events/characterFacts/Story Time 派生 | 完全是当前有效 Floor + Runtime 内存派生 | 无独立 Floor root；Current State 是 derived | 删除/Swipe/version 失效后从 surviving Floors rebuild；无独立 clear | 只读，不调用 save；`core/state.js:740-766`、`runtime/event-analysis.js:2234-2336` |
| Tracking Registry / Window | `runtime/tracking-runtime.js`、`core/tracking.js`、`runtime/tracking-window-runtime.js` 从 active Events/World/Story Time/subjects 派生 | 当前 inputs 在内存；window timeline 历史需通过 Store/valid Floor | Registry 本身内存；可选 `tracking_window_timeline` 由 `storage/tracking-window.js:32-55` 写 | Timeline append-only；缺失 root 继承，显式 empty 阻止继承；历史 Floor 不变 | Registry refresh `runtime/tracking-runtime.js:57-83` 不保存；显式 tracking persistence 才走 Coordinator；动态生产 caller 仍需运行时 trace确认 |
| Projection | `runtime/projection-runtime.js` 读取有效 Event/World/Timing/Tracking/Story Time，AI 生成 candidate/evidence/lifecycle/delivery | Eligibility 和 AI candidate 在内存；历史 Projection 必须从 valid Floor roots 读取 | `projection_timeline`、`snapshot`、`projection_timing_snapshot`；`storage/projection.js:81-95` | timeline append-only records；explicit lifecycle/delivery semantics；历史 owner 不改 | Projection owner Coordinator；candidate/evidence 可连续产生多笔，`runtime/projection-runtime.js:602-632`；Event 完成后可后台处理，不等于不保存 |
| Character Timing Config | `core/character-timing-config.js` 规范化 UI config | 当前 Chat metadata/Runtime 可读 | Chat-local `settings.character_timing_configs`；`storage/character-timing.js:11-21` | Chat-local override，可 reset；不是 Floor history | `store.saveChat()` → `adapter.saveChatMetadata()`；不走 Floor Coordinator，不应与 Timing Instance 混淆 |
| Timing Instance | `runtime/events.js::editCharacterTimingInstance` 使用当前 Instance/Cycle、五项参数、冻结 sampled offset、editStart version | 当前 Instance 首先从 Store/有效历史读取；业务 readback 仍可内存完成 | `projection_timing_snapshot`；`storage/projection-timing.js:219-295` | 缺失 root 继承，explicit empty 阻断；manual current-owner repair 有特殊 guard；历史不可变 | projection owner Coordinator；Timing no-op 仍需权威事务语义；业务 readback 检查 ID/Cycle/offset/range |
| Participant Aggregation | `resolveParticipantAggregationTrigger` + `runtime/events.js:5795-6006`，输入 Timing、Story Time、Events/Exposure、Tracking Window、existing root | 输入可在当前 Runtime 读取，但必须重新读取跨事务依赖 | `participant_aggregation_snapshot`；`storage/participant-aggregation.js:211-275` | nearest valid root；explicit empty 阻断；按 subject/cycle 完整集合更新；历史不可变 | 独立 owner Coordinator；manual Timing 强制 `aggregation: null` 重评估；失败保留 `timing_persisted: true` |

### 4.1 四类读取的明确分界

1. **内部计算读取**：当前 Context、Store 的 valid Floor views、derived state、AI result。原则上可在插件内部完成，官方 GET 计数为 `0`；但只读 Context 不自动是权威。
2. **Snapshot merge 读取**：为了保留同 Floor sibling、显式 empty 和最新 owner root，必须有 latest authoritative baseline，或宿主提供等价 immutable patch/CAS。当前 Coordinator 的 `LATEST_SLOT_READ` 是这一类。
3. **并发冲突保护读取**：owner acquisition、write preflight、Chat/epoch/Swipe/Floor Version guard，保护读后写窗口和生命周期。没有宿主 CAS 时不能用内部 View 代替。
4. **保存结果确认读取**：save 后 readback、final audit、Coordinator readback，决定是否可以返回 `confirmed`。HTTP 200、Promise fulfilled、Context mutation 或 debounce dispatch 都不是该类确认。

## 5. Context-first 三条路径

### 5.1 普通内部写入

```text
valid current Context view
  → pure domain calculation
  → pure owner-scoped merge intent
  → capability/identity check
  → current Coordinator (today)
  → host save + authoritative confirmation
```

当前可安全采用的“内部优先”含义是减少重复业务读取和重复解析，不是删除权威 GET。普通 changed 基线仍是 `6 GET + 1 SAVE`；no-op 仍是 `3 GET + 0 SAVE`。这是 `SOURCE_VERIFIED + REAL_HOST_BASELINE`。

### 5.2 具备宿主能力的 native path（设计候选）

```text
capture Context owner + epoch + Floor Version
  → pure merge against current owner view
  → host atomic owner patch(expectedRevision)
  → await server result
  → owner confirmation(expectedRevision, expectedPatch)
```

只有以下条件全部满足才允许进入生产候选：

- save 是 owner patch 或服务器端原子 expected-revision/CAS，不是完整 Chat last-write-wins。
- host 返回可区分 `confirmed`、`failed`、`unknown` 的结果；响应丢失可通过 owner-targeted readback 安全确认。
- native mutation 前完成 Chat/Floor/Message/Swipe/epoch guard；save 期间的目标身份绑定可验证。
- 不覆盖其他扩展的 `message.extra`、其他 Swipe 或 sibling root；同 Floor 外部 writer 的冲突有拒绝/合并契约。
- Timing/Aggregation 仍是两笔逻辑事务，保留 partial success；不以一次 native Chat save 偷换业务事务契约。

若任一项为 `UNKNOWN`，native mutation 不应先发生；应直接走 Coordinator。若 native save 已 dispatch 且结果为 `UNKNOWN`，不能盲目再走 Coordinator，否则可能二次覆盖旧状态；必须先完成明确的 owner-targeted confirmation 或报告 unknown。

### 5.3 状态过期/冲突回退

```text
Context view stale / capability missing / revision conflict
  → stop native mutation
  → capture current authoritative owner through Coordinator path
  → validate six-field version + active Swipe + epoch
  → retry owner-scoped merge, reject, or report UNKNOWN
```

“先 Context 写入，再发现冲突后 fallback”不是安全回退：第一次 full-Chat SAVE 可能已经覆盖外部字段或旧标签页内容，第二次 Coordinator 只能修复当前可见状态，不能恢复已丢失的未知 writer 变更。安全 fallback 的判定必须发生在 native mutation 之前，或宿主提供可撤销/幂等 owner patch。

## 6. 状态机

| 状态 | 进入条件 | 允许动作 | 禁止/转换 |
|---|---|---|---|
| `CLEAN` | Context view 与 captured owner token 一致，无 pending mutation | 计算、读取、capture | draft mutation → `DIRTY`；生命周期变化 → `STALE` |
| `DIRTY` | 内部 merge intent 与 view 不同 | 本地纯 merge、能力判断、进入保存 | 发现 Chat/Floor/Swipe/version/epoch变化 → `STALE` |
| `SAVING` | 已通过 guard，native 或 Coordinator save 已 dispatch | 只等待 ticket/readback；可响应取消但不能报告成功 | known pre-dispatch rejection → `FAILED`；ambiguous/response loss → `UNKNOWN`; owner change → `STALE/UNKNOWN` |
| `CONFIRMED` | expected owner patch、sibling、Floor Version、目标身份和保存结果均已确认 | 更新 Runtime derived state/UI | 后续 lifecycle 变化 → `STALE`，不能继续当 current |
| `FAILED` | 明确未写入的校验/服务端拒绝 | 恢复本地 draft，显示失败，可重新 capture | 不做盲目补偿写；新提交需重新 capture |
| `UNKNOWN` | dispatch 后连接断开、host result 不可解释、readback mismatch 或生命周期在保存后变化 | 只读确认、人工/显式 owner-targeted retry、显示未确认 | 不显示成功，不把旧 Snapshot 盲写回，不自动 fallback 二次覆盖 |
| `STALE` | Chat/epoch/message/Swipe/Floor Version/owner 发生变化 | 丢弃计算结果，重建当前 view | 不写旧目标；新操作必须重新 capture |

`UNKNOWN` 与 `FAILED`、`CONFIRMED` 不等价。`FAILED` 只有在能证明 commit 未发生时才可恢复 captured memory；`UNKNOWN` 必须保留不确定性。

## 7. A/B/C 架构比较

| 方案 | 一致性 | 完成语义 | 跨标签页 | 复杂度/测试 | GET/SAVE | 回退 | 结论 |
|---|---|---|---|---|---|---|---|
| A. 现有 Coordinator | 已有 owner merge、Floor/Swipe/epoch guard、readback | `confirmed/failed/unknown` 已定义 | 仍依赖官方 GET/readback，未被宿主 CAS 取代 | 现有测试和 real-host baseline | 普通 `3/0`、`6/1`；Timing+Agg `6/0`、`12/2` | 最强，直接保留 | 当前生产基线 |
| B. 完全 Context-first | 单页静止模型可工作，但官方/外部 writer 会造成 stale/full snapshot 覆盖 | `saveChat()`/debounce 不能直接确认；需另建 readback | 无法防旧标签页、设备、direct API | 新建状态/merge/host竞态系统，测试成本最高 | 理论 `0 GET + 1 SAVE`，未验证；两个逻辑事务理论 `0/2` | native 已写后 fallback 不能恢复覆盖 | 当前 `PROVEN_UNSAFE`，不可实施 |
| C. Context-first + 严格确认/回退 | 内部读取和纯 merge 可提速；写入仍受能力 gate 和 Coordinator 保底 | 能力满足时可确认；否则 strict path；unknown 显式保留 | 没有宿主 CAS 时仍不能声明全局安全 | 中等但需要 capability contract、状态机、双路径矩阵 | 未知；native candidate 可能少 GET，fallback 保持 A | 只有 mutation 前回退或原子 patch 才安全 | 推荐方向，但当前 `BLOCKED/NOT_YET_PROVEN` |

推荐 C 不是“马上开启双写”。它是先统一内部 View/Merge intent，再让一个 Coordinator 决定 native capability 或 strict fallback；在能力不足时只走 A。

## 8. 分阶段实施计划（仅设计，不执行）

### Phase 0：证据和基线冻结

- 修改：仅新任务文档/只读报告。
- 保留：所有生产路径和既有 Debug 计数。
- 测试：静态调用图、现有 `npm run check`、`git diff --check`。
- 回退：删除本任务文档即可，不影响生产。
- 进入条件：报告中所有未证实项标为 `HOST_UNVERIFIED`/`BLOCKED`。

### Phase 1：只读 Floor State View

- 修改候选：优先扩展现有 Store/Floor resolver 的只读 DTO，不新增持久化根。
- 保留：Coordinator 作为唯一 ordinary writer；Host Adapter raw slot 读写不变。
- 测试：Chat/Swipe/message edit/delete、历史 Floor、显式 empty、valid previous、owner provenance；证明 View 不是权威 revision。
- 回退：只禁用 View consumer，生产 writer 不变。
- 进入条件：所有 consumer 仍通过 storage abstraction；没有 Chat-level history/cache 作为事实源。

### Phase 2：纯 Snapshot Merge Engine seam

- 修改候选：从现有 owner patchResolver/preparePersistedPatch 抽出小型纯 Module，或在现有 owner Module 内形成私有 seam。
- 保留：Coordinator 队列、latest read、readback、owner allowlist。
- 测试：多 owner sibling、两角色（柳如烟/祁鸢等价 fixture）、其他 extension 字段、Swipe 0/非 0、explicit empty/inheritance、历史不可变、Timing/Aggregation partial success。
- 回退：保留旧 merge implementation 作为唯一调用路径，纯 Module 只做对照测试；没有安全证明不替换。
- 进入条件：merge 纯函数结果与现有 Coordinator 逐字段一致，`git diff --check` 和全量测试通过。

### Phase 3：Host capability spike（只在临时 Chat）

- 修改候选：测试 Adapter/宿主测试辅助，不改生产路由或真实用户数据。
- 验证：当前实际宿主版本的 `saveChat()` 完成阶段、owner patch/CAS、serialized scope、readback、响应丢失、Chat/Swipe lifecycle、其他扩展和旧标签页。
- 保留：所有生产写入仍走 Coordinator；测试通过不得提升生产能力等级。
- 回退：销毁临时测试数据/测试 helper，不改插件数据模型。
- 进入条件：宿主能力达到明确契约；否则标记 `BLOCKED`，停止 native 迁移。

### Phase 4：受控单模块 shadow/compare

- 修改候选：仅测试环境或 feature-disabled 的 compare path；不向 UI 报告 native confirmed。
- 测试：Event/World/Timing/Projection 单模块 owner patch 对比、跨标签页和 direct API 竞争、请求统计。
- 回退：关闭 compare path，Coordinator 结果仍是唯一业务结果。
- 进入条件：无覆盖反例；每个失败/unknown 与 Coordinator 结果一致；真实宿主数据安全验收通过。

### Phase 5：受控 native candidate（若所有门槛通过）

- 修改候选：仅在 Coordinator 内增加能力 gate；不改 owner allowlist、Floor Version、Swipe/epoch 或 Timing/Aggregation 业务规则。
- 事务：先保持 Timing 与 Aggregation 两笔逻辑事务和 partial success；不得先做物理 save 合并。
- 测试：native success/no-op/failure/unknown、CAS conflict、readback mismatch、外部 writer、刷新、历史 Floor、多角色、多 Swipe。
- 回退：任意 capability unknown/conflict/unknown outcome 立即回到 strict Coordinator；native dispatch unknown 不得盲目二次写。
- 进入条件：源码、宿主契约、隔离测试、真实临时 Chat 和失败恢复全部达到 `CONTRACT_SUPPORTED`。

## 9. 阻断条件

以下任一项成立时，方案 C 不得进入生产：

1. native save 只有完整 Chat last-write-wins，没有 owner patch 或 expected revision/CAS。
2. save Promise/HTTP 结果无法区分 `confirmed`、`failed`、`unknown`，且没有安全的 owner readback。
3. Context capture 后其他扩展字段变化会被完整 Chat SAVE 覆盖，且无宿主 merge/冲突拒绝。
4. Chat/Swipe/message 生命周期变化只能在保存后发现，无法阻止错误目标写入，也没有 unknown recovery。
5. Timing/Aggregation 的两笔 partial success 无法通过 native path 保持。
6. native failure 后 fallback 需要用旧快照二次写入，无法证明幂等和不覆盖。

## 10. 与既有报告的兼容性

本设计保留前序报告的结论：

- Coordinator A/B/C 直接 GET 复用候选仍有确定性反例，不能机械删除。
- P2 native 原型的 `context-fast`、`native-confirmed` 请求数仅是测试模型数字。
- Chat-local Timing Config 与 Floor Timing Instance 继续分开。
- Event 用户感觉较快可能是后台 Projection/不同等待语义，不是无 GET 证明。
- 当前没有可直接进入生产的少 GET native Floor writer。
