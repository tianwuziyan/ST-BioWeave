# 技术设计：Floor-owned cumulative canonical character registry

## 1. 设计结论与边界

本轮的行为缺口不是新的 identity schema，也不是重新设计 Tracking。缺口是
上一轮把 `character_registry` 保留为 Chat-local configuration 后，Runtime
仍在普通分析路径中把它当作历史 identity candidate source。修复采用最小
ownership 调整：

```text
current message + active Swipe
  -> complete Floor Version
  -> Floor analysis/events + cumulative character_registry snapshot
  -> nearest valid previous (analysis/events/registry)
  -> current derived Tracking/UI projection and API input
```

`character_registry` 继续复用现有 `CharacterRegistry` shape、opaque ID、alias
和 identity resolution contract；改变的是 owner 和读取边界。每个成功分析的
Floor slot 增加同级的 `character_registry` snapshot，不再把 Chat registry
作为普通请求的 history source。

本阶段规划完成后不执行 `task.py start`，不修改业务代码、测试或项目 domain
spec；以下变更只在后续用户明确批准最新 planning summary 后实施。

## 2. 当前 source-level provenance audit

行号以本次规划时的 clean checkout 为准，实施后需重新核对。

### 2.1 Chat Metadata 的 read/write/normalize 路径

| 入口 | 当前行为 | 本轮判断 |
|---|---|---|
| `storage/schema.js:671-674` | 注释和导出把 canonical registry 定义为 Chat-local registry | 与新 ownership 冲突；需要改为 Floor snapshot + Chat projection/migration 说明 |
| `storage/schema.js:676-689` | `emptyChat()` 默认创建 `character_registry` | shape 可保留，但它不再是 historical authority；可增加明确的 migration marker shape |
| `storage/store.js:641-653` | `getChat()` 从 `chatMetadata.bioweave` 读取并 normalize registry | 读取本身可保留为兼容/projection 入口，普通 Runtime history 不得调用它作为 API source |
| `storage/store.js:656-673` | `saveChat()` 将 registry 原样 normalize 后写回 Chat Metadata | 可保留用于 materialized projection；不得在分析成功路径直接写 identity result 作为唯一 owner |
| `storage/store.js:720-787` | 兼容性的 `saveTrackingSubjects/Candidates()` 可随 registry 一起写 Chat | 当前生产 Runtime 没有调用这些 helpers；保留兼容 API，但不能被当作 historical source |

### 2.2 产生当前污染的完整链路

| 阶段 | 证据 | 传播结果 |
|---|---|---|
| Source | `context.chatMetadata.bioweave.character_registry`；`storage/store.js:641-653` | Chat 中的旧 canonical IDs 被读入 `currentChat.character_registry` |
| Bootstrap | `runtime/event-analysis.js:626-634` 调用 `bootstrapCharacterRegistryFromLegacy({ events: activeEvents, character_registry: currentChat.character_registry })` | `core/identity.js:1695-1711` 先 clone Chat registry；即使 `events=[]` 也保留全部 Chat entities |
| Runtime projection | `runtime/event-analysis.js:636-643,645-670` 把结果命名为 `characterRegistry`，并再次写回 Chat | Chat registry 成为跨 Floor 的永久循环 source，而不是单纯 projection |
| Input assembly | `runtime/event-analysis.js:1105-1149,1177-1196` 将 `derived.characterRegistry` 传给 `buildEventAnalysisInput()`，同时把含 Chat registry 的 `derivedChatData` 交给 context resolver | custom resolver 还有读取 Chat registry 的旁路可能 |
| Input normalization | `ai/input-builder.js:944-977` 接收显式 registry 并做安全 normalize | 该层没有自主发现 history，当前实现符合“显式输入边界” |
| Prompt sink | `ai/prompts.js:414-455,611-620` 输出 `【Runtime Canonical Character Registry】` | Chat entities 被逐个格式化进 Analyzer Prompt |
| API transport | `ai/analyzer.js:2547-2563` 调用 `buildEventAnalysisMessages()` 后进入 `callOpenAICompatible()` | 旧人物实际发送给外部 API |

只读 baseline reproduction 已重现：没有合法 analyzed Floor、
`existing_bioweave` 为 `{ analysis: null, events: [] }` 时，输入仍含
`shen_qi_yuan`/沈祁鸢、`jue_xin`/觉心、`liu_ru_yan`/柳如烟，且 Prompt 同时含
这三个 ID 与 display name。因此问题不在 previous resolver，而在独立的
registry input source。

### 2.3 其它 read/write/bootstrap 路径

- `core/identity.js:462-474` 的 `normalizeCharacterRegistry()` 是纯 shape
  normalizer，不拥有 storage；保留。
- `core/identity.js:1406-1547` 的 `resolveEventAnalysisIdentities()` 以传入
  registry 为 base，输出 identity resolution 后的新 registry；这正是当前
  Floor save 所需的计算步骤，不应改成 Chat writer。
- `core/identity.js:1652-1722` 的
  `bootstrapCharacterRegistryFromLegacy()` 是旧数据工具。它会保留传入 base
  的所有实体，并从 Events/profiles 添加 exact IDs；必须从普通 Runtime 路径
  移除，仅保留在明确的一次性 migration/legacy adapter 边界。
- `core/identity.js:1028-1085` 的 `allowLegacy` 可在显式兼容模式下接受模型
  携带的旧 ID；生产 `createRuntime()` 默认 `false`。本轮不扩大该兼容模式，
  只确保它不能以 Chat registry 作为普通 API fallback。
- `runtime/event-analysis.js:1528-1545` 的 `updateEvent()` 当前用 Chat
  registry bootstrap 校验 participant ID；应改用目标 Floor 自身的 snapshot。
- `runtime/event-analysis.js:1608-1628` 的 `getTrackingRegistry()` 在
  preflight error 分支直接 normalize `chatData.character_registry`；这是另
  一条 fail-closed 失效路径，必须返回当前有效 Floor projection 或空 registry。
- `runtime/event-analysis.js:1284-1295` 在成功分析后把
  `identityResult.character_registry` 写入 Chat，但目标 Floor save
  `:1274-1281` 只写 `analysis/events`；这使 Chat 变成唯一持久 owner。
- `ai/input-builder.js`、`ai/prompts.js`、`ai/analyzer.js` 都只消费显式
  `character_registry`，没有读 Chat 的代码；除非测试证明需要 API 文案调整，
  本轮不改这些层。

## 3. 保持不变的上一轮合规实现

以下实现已经符合 `floor-state.md`，不应因本轮 identity owner 修复而重写：

1. `runtime/floor.js:154-188` 的完整六字段 Floor Version 和 Event source
   equality；stale Event 必须继续失效。
2. `storage/store.js:675-705,790-814` 的 exact ordinary-message/per-Swipe
   slot read/write、缺失 Swipe fail-closed 和 Chat scope guard；只扩展对
   snapshot 字段的 normalize，不直接绕过 storage abstraction。
3. `runtime/event-analysis.js:550-567` 的 previous 搜索方向、target self
   exclusion、floor lower-bound、active Swipe、Version equality 和 active
   Event filtering；只让它在同一候选上附带 snapshot。
4. `core/identity.js` 的 opaque ID、existing/new/unresolved、完整 candidate
   set、alias evidence 和 atomic unresolved rollback。
5. `core/tracking.js:464-569` 的 current-valid Event-only derived rebuild；
   Tracking 不应重新拥有 canonical identity history。
6. `ai/input-builder.js:984-` 的 pure input normalization，以及
   `ai/prompts.js:414-455` 的显式 registry formatter；它们不应自行回读 Chat。
7. `runtime/event-analysis.js` 已完成的 Chat epoch/in-flight invalidation、
   target Version recheck、Swipe deletion guard 和 `last_processed_floor`
   current-state recomputation。
8. Character Card、Persona、World Model、Recent Story、API profile、Event
   schema 和 UI DTO 的既有语义；它们不是本轮要移动的历史 identity state。

## 4. 目标数据模型与有效性

### 4.1 Floor slot shape

在现有 `message.extra.bioweave` 或
`message.swipe_info[swipe_id].extra.bioweave` 中增加同级字段：

```json
{
  "analysis": {
    "status": "success",
    "floor_version": {
      "chat_id": "chat-1",
      "message_id": "message-5",
      "floor": 5,
      "swipe_id": 0,
      "content_hash": "...",
      "message_version": "v1:..."
    }
  },
  "events": [],
  "character_registry": {
    "schema_version": 1,
    "entities": {}
  }
}
```

不新增第二个 registry schema 或独立 version 字段。Snapshot 的 provenance
由同一 owner slot 的 successful `analysis.floor_version` 绑定：只有
`analysis.status === 'success'`、enclosing Version 完整且与当前六字段 Version
相等、当前 message/active Swipe/slot 仍存在时，snapshot 才能作为历史 identity
candidate。

### 4.2 Single previous resolver

保留 `findPreviousSuccessfulBioWeave(target)` 的一套扫描：从 target index - 1
向前，逐个使用当前 active Swipe、exact Floor slot、current Version、success
analysis 和 active Events 校验；通过的同一个 candidate 返回：

```js
{
  analysis: candidate.floorData.analysis,
  events: currentValidCandidateEvents,
  character_registry: normalizeCharacterRegistry(
    candidate.floorData.character_registry,
  ),
}
```

没有合法 candidate 时返回：

```js
{
  analysis: null,
  events: [],
  character_registry: { schema_version: 1, entities: {} },
}
```

目标 Floor 旧 slot 永远不进入扫描。candidate 缺少 snapshot 时不得回到 Chat
registry；在一次性 legacy migration 尚未成功时，identity 部分按空 registry
处理，analysis/events 仍遵循原有 candidate 规则。这样可以 fail closed，不能
因为兼容性恢复无 provenance 的人物。

### 4.3 Current projection

`collectCurrentDerivedState()` 不再把 `currentChat.character_registry` 交给
普通 bootstrap。它从 `collectCurrentFloorStates()` 的当前有效 states 中，按
当前消息顺序选取最近一个 successful、Version-valid、active-Swipe-owned
snapshot 作为 materialized `characterRegistry`。如果不存在则使用空 registry。

Tracking subjects/candidates/profiles 继续从 current active Events rebuild；
canonical registry projection 与 Tracking projection 分开计算，但都不能用
Chat historical fields 作为 base。`getTrackingRegistry()` 的 preflight failure
也必须 fail closed，不得返回 `chatData.character_registry`。

### 4.4 Request build and target save

`buildFloorAnalysisInput()` 先通过同一个 previous resolver 得到
`previous.character_registry`，再把它作为本次 Analyzer 的 explicit registry
candidate source。传给 `characterContextResolver()` 的 Chat-shaped compatibility
object 必须覆盖/隔离 Chat registry，使 custom resolver 也只能看到这份 previous
snapshot，不会读到 stale `chatData.character_registry`。

`runAnalysis()` 的顺序保持：

```text
previous snapshot
  -> build input / Analyzer
  -> resolveEventAnalysisIdentities(base = input.character_registry)
  -> canonical Event IDs + source
  -> validate/normalize Event collection
  -> one target Floor save: analysis + events + identityResult.character_registry
  -> rebuild current Chat projections
```

成功结果不能先把 `identityResult.character_registry` 写到 Chat。目标 Floor
save 失败时，Chat projection 和旧 Floor result 都不能被新 identity 结果污染；
Floor save 成功而 Chat projection save 失败时，Floor 仍是 authoritative owner，
下一次 refresh 可重建 projection。

`updateEvent()` 只需用目标 Floor snapshot 验证 canonical participant IDs，编辑
不会从 Chat registry 补 ID；`deleteEvent()` 继续通过 active Floor facts rebuild。

### 4.5 Explicit legacy migration boundary

现有仓库没有独立 schema migration runner，因此采用一个有限、可审计的一次性
Runtime migration boundary（具体函数名在实施前由当前 seam 决定）：

1. 只在 plugin/runtime 初始化的 migration 阶段执行一次，并用 Chat-local 的
   migration marker 记录完成状态；普通 `analyzeFloor()`、previous search、
   registry read、Event edit 和 API build 永不调用它。
2. 扫描当前 Chat 中仍存在、active Swipe 有效、六字段 Version 有效且
   `analysis.status === 'success'` 的 Floor states，按消息顺序处理缺少 snapshot
   的 legacy owner。
3. 对每个 legacy Floor，只允许导入该 Floor 当前有效 Events 能证明的 exact
   canonical IDs；Chat registry 只能按这些 exact IDs 做 display/alias enrichment，
   不能全量复制未被当前 Floor 证明的实体。累计结果写入该 Floor owner slot。
4. 已有合法 snapshot 的 Floor 不被 Chat registry 覆盖。全部 owner 已删除时，
   migration 不产生 snapshot，随后 Chat projection 被清为空。
5. 任一 Floor save 失败不写完成 marker；下次明确 migration retry 仍可继续，
   但普通 API 永远不等待或依赖 Chat registry 来兜底。

这个边界解决旧 Chat 的可迁移 exact IDs，同时保证报告中的 `[A,B,C]` orphan
在没有任何有效 Floor 时不会被迁移。若实施阶段发现 host 没有安全的初始化
hook，则宁可不自动迁移，保留 explicit utility 供未来迁移命令调用；不可把
Chat registry 放回普通 API fallback。

## 5. Layer/file change boundary

### 必要修改

- `runtime/event-analysis.js`：previous 返回 snapshot；current projection 从
  Floor snapshots 派生；请求使用 previous snapshot；目标 Floor 原子保存；
  update/read 取消 Chat registry fallback；实现或接入一次性 legacy boundary。
- `storage/schema.js`：empty Floor 增加 normalized `character_registry`；更新
  Chat registry/migration marker 注释和 shape（不改变 Event schema）。
- `storage/store.js`：在既有 exact owner abstraction 内 normalize/read/write
  Floor snapshot；继续保持 Chat projection helper 的兼容性与 scope guard。
- `core/identity.js`：如需仅调整注释/导出边界，明确 legacy bootstrap 只供
  migration；不改变 opaque ID 或 resolution 算法。
- `tests/event-analysis-runtime.test.js`：J-P、目标 self-exclusion、删除/版本/
  Swipe/reload、target save 和 API Prompt sink 回归。
- `tests/runtime.test.js`：Floor snapshot per-message/per-Swipe storage、Chat
  projection 与 stale Chat isolation。
- `tests/character-identity.test.js`：legacy bootstrap 的纯函数保留为显式
  migration utility，并增加 exact-ID scope/不全量复制的测试（如由实现需要）。

### 预期不修改

- `runtime/floor.js`：已有 Version/active Event 算法符合规范。
- `core/tracking.js`：上一轮已 current-facts-only；只验证没有新 caller。
- `ai/input-builder.js`、`ai/prompts.js`、`ai/analyzer.js`：显式 registry
  transport 已正确，除非新增测试发现字段命名/empty shape 不兼容。
- `runtime/events.js`：Floor adapter 已通过 store 写入 exact slot；若 generic
  save seam 不能承载新字段才做最小适配。
- Event/World Model schema、API profile、UI production contract 和 unrelated
  migration/config code。

## 6. Compatibility and risk

- 旧 Chat registry 中没有任何当前有效 Floor provenance 的实体会停止进入 API，
  这是有意的安全/ownership 行为变化；它们仍可留在 Chat Metadata 作为 inert
  projection，直到 refresh 覆盖，不能作为 history。
- 旧 successful Floors 没有 snapshot 时，migration 只从当前有效 Event exact IDs
  受限地建立 snapshot；无法证明的 Chat-only identity 不迁移。
- canonical IDs 仍保持 opaque/stable；同名/同 alias 不合并，不改变 Event ID/source。
- Chat projection 写失败不会破坏 Floor authoritative state；需要保留现有重建和
  retry 行为。
- 测试 fixture 默认 `allowLegacyIdentity` 可能掩盖未知 ID 行为；J-P 使用显式
  `identity_status` 和 `allowLegacyIdentity: false`，避免 tautological green。
- Node tests 无法替代真实 SillyTavern host 的 Chat reload、active Swipe、Swipe
  deletion 和 saveChat/saveChatMetadata 行为；实施后需记录真实 Desktop/Tablet/
  Mobile acceptance 是否执行。

## 7. Rollback shape

回滚边界只包含本任务新增的 Floor snapshot field、runtime owner selection、
legacy migration marker/utility、相关 schema comments/spec updates 和 J-P tests。
不得恢复“Chat registry 作为普通 API historical fallback”的旧路径；若 migration
失败，回滚应保留 fail-closed empty registry 行为，避免把 orphan facts 重新开放。
