# Research: character registry provenance audit

- Query: 审计当前 checkout 中 `character_registry` 的全部 read/write/merge/bootstrap 路径，验证 Chat Metadata registry -> Runtime Canonical Character Registry -> Analyzer API 链，并核对 Floor/Swipe provenance、legacy 边界和 Case J-P 测试缺口。
- Scope: internal
- Date: 2026-09-16

## Files found

- `core/identity.js`：canonical registry 的 schema normalize、identity resolution、alias/display-name 变更和 legacy bootstrap 纯函数。
- `core/tracking.js`：从当前有效 Event 重建 `tracking_subjects`、`tracking_candidates`、`character_profiles`；没有直接读取 `character_registry`。
- `storage/schema.js`：`emptyChat()` 的空 registry bootstrap、Floor 空结构和 schema normalize 导出。
- `storage/store.js`：Chat registry 读取/写入、tracking 兼容写入口，以及 message/per-Swipe Floor owner 读写边界。
- `runtime/floor.js`：六字段 Floor Version、Event source equality 和 active Event 过滤；没有 registry snapshot 逻辑。
- `runtime/event-analysis.js`：当前 Floor 扫描、legacy bootstrap、Analyzer input、identity resolution、Floor/Chat 保存、Event edit 和 registry read。
- `runtime/events.js`：SillyTavern Chat Metadata 与 message/per-Swipe owner adapter，以及 init 时的 registry refresh。
- `ai/input-builder.js`：从 Runtime 显式输入读取并规范化 `character_registry`，不负责 provenance discovery。
- `ai/prompts.js`：把 registry 渲染为 Runtime Canonical Character Registry prompt block。
- `ai/analyzer.js`：构建 prompt、调用 API、解析 raw response；没有独立 registry 读取。
- `ai/client.js`：当前 API/独立 `fetch` 的最终 request transport sink。
- `tests/runtime.test.js`：storage compatibility 与 current Floor Event bootstrap 测试。
- `tests/event-analysis-runtime.test.js`：Runtime identity、previous Floor、Swipe/delete/reload/version 生命周期测试。
- `tests/event-analysis.test.js`：input/prompt registry boundary 测试。
- `tests/character-identity.test.js`：identity 与 legacy bootstrap 单元测试。
- `tests/tracking.test.js`：current-facts-only tracking projection 测试，没有 canonical registry fixture。
- `.trellis/spec/domain/floor-state.md`：当前 Floor/Swipe ownership、previous、derived state 和 API provenance contract。
- `.trellis/spec/domain/event-pipeline.md`：当前 Chat-local CharacterRegistry、identity resolution 和 legacy bootstrap contract。
- `.trellis/tasks/09-16-floor-owned-character-registry/prd.md`：本任务的 R1-R6 与 Case J-P 验收条件。
- `docs/DEVELOPMENT.md`、`README.md`：现有 Event/Tracking/Floor 数据流与 Chat/Floor 数据骨架说明。
- `.trellis/tasks/archive/2026-09/09-16-floor-analysis-provenance-repair/{design.md,implement.md}`：上一轮已完成的 Floor-derived tracking/provenance 修复边界，明确当时保留 Chat-local canonical identity configuration。

## Findings

### 1. 总结结论

当前实现能满足上一轮 Floor/Swipe/Event/Tracking provenance 基线，但不能满足本任务 PRD 的 Floor-owned canonical registry 目标。核心原因是 `character_registry` 仍被当作 Chat-local identity configuration/history 使用：

1. `storage/store.js:641-653` 从 Chat Metadata 读取它，`runtime/event-analysis.js:631-634` 把整个 Chat registry 作为 `bootstrapCharacterRegistryFromLegacy()` 的 base；即使没有任何 current valid Floor Event，base 中的 orphan entity 也会被保留。
2. `runtime/event-analysis.js:1105-1196` 将该结果传入 `buildEventAnalysisInput()`；`ai/input-builder.js:944-975`、`ai/prompts.js:414-455,611-620` 和 `ai/analyzer.js:2547-2565` 没有 provenance guard，因此 orphan entity 会进入 prompt。
3. `ai/client.js:1155-1169` 的 current API 路径或 `:1174-1200` 的独立 HTTP 路径发送包含该 prompt 的 request；`existing_bioweave` 即使是空值，也不能阻止独立 registry 污染。
4. 本次分析产生的新 identity 在 `runtime/event-analysis.js:1284-1295` 只写回 Chat Metadata；目标 Floor owner 的 `events` 保存位于 `:1274-1282`，但没有同一 owner slot 的 registry snapshot。
5. `runtime/event-analysis.js:1620-1622` 在 Floor preflight 失败时直接返回 Chat registry，是一个不依赖 refresh 的明确 Chat fallback。

因此，“Chat Metadata registry -> Runtime Canonical Character Registry -> Analyzer API”链当前是真实存在且可达的；在没有合法 analyzed Floor 时，它不会 fail closed。

### 2. 精确 source -> propagation -> sink 链

#### A. Chat Metadata registry 到 Analyzer API（当前污染链）

```text
SillyTavern context.chatMetadata.bioweave
  runtime/events.js:58-60
  -> storage/store.js:641-648
  -> runtime/event-analysis.js:626-634
  -> runtime/event-analysis.js:1105-1196
  -> ai/input-builder.js:944-975,982-1023
  -> ai/prompts.js:414-455,611-620,672-707
  -> ai/analyzer.js:2547-2565
  -> ai/client.js:1155-1169 或 1174-1200
```

- Source：`runtime/events.js:58-60` 暴露 `getChatMetadata()`；`storage/store.js:641-648` 在 Chat scope 匹配后把 `stored.character_registry` normalize 后返回。`storage/store.js:648` 只清理形状，不校验 Floor Version、active Swipe、Event source 或 provenance。
- Propagation：`runtime/event-analysis.js:626-634` 先扫描当前 message 的 active Swipe/valid Floor states，随后仍以 `currentChat.character_registry` 为 bootstrap base。`core/identity.js:1695-1711` 的 bootstrap 保留 base entity，再补充传入 Event/profile 中的 exact ID；所以 `activeEvents=[]` 不会清空 Chat registry。
- Runtime input：`runtime/event-analysis.js:1105-1108` 读取 Chat 并建立 current derived state；`runtime/event-analysis.js:1146-1150` 还将含有 Chat 字段的 `derivedChatData` 传给 `characterContextResolver()`；最终 `:1191-1195` 用 `derived.characterRegistry` 作为 Analyzer 的 canonical registry 输入。
- DTO boundary：`ai/input-builder.js:944-949` 从 snake/camel case 的显式 source 或 nested input 读取 registry，`:957-979` 只安全复制并在缺省时给 `{schema_version:1,entities:{}}`。它不读 storage，也不检查 registry 是否来自 Floor。
- Prompt：`ai/prompts.js:414-455` 读取每个 entity 的 ID/display/alias，`:450-455` 宣称其为 Runtime candidate block；`:611-620` 将 block 放入 request references，`:672-707` 组装最终 messages。prompt 语义要求 existing ID 只能从 block 中选择，但不会判断 block 的历史 provenance。
- Analyzer/API sink：`ai/analyzer.js:2547-2565` 调用 `buildEventAnalysisMessages()` 后把 messages 交给 `callOpenAICompatible()`。`ai/client.js:1166-1169` 将 messages 转为宿主 current API 的 prompt；独立 API 在 `:1185-1200` 将 `messagesForRequest(messages)` 放进 POST JSON body。因此 orphan 的 ID 和 display name 会到达 API request。

该链与 `runtime/event-analysis.js:550-567` 的 strict `existing_bioweave` previous 搜索相互独立；previous 返回空并不等于 registry 输入为空。

#### B. 当前有效 Floor Event 到 Chat registry projection（当前混合链）

```text
message.extra.bioweave 或 message.swipe_info[swipe_id].extra.bioweave
  storage/store.js:675-692
  -> runtime/floor.js:154-188
  -> runtime/event-analysis.js:569-605
  -> core/identity.js:1648-1723
  -> runtime/event-analysis.js:626-644
  -> runtime/event-analysis.js:645-670
  -> storage/store.js:656-673
  -> runtime/events.js:61-80
```

- `storage/store.js:675-692` 只读取请求 message 的精确 owner slot；结构化 Swipe 缺 slot 时返回 `emptyFloor()`，不从 message mirror、Chat map 或其它 Swipe fallback。
- `runtime/floor.js:154-188` 要求完整六字段 Version，`getActiveFloorEvents()` 只保留 Event `source` 与当前 Version 完全相等的事实。
- `runtime/event-analysis.js:569-605` 对当前 Chat 中仍存在的 messages 重算 Version、选择 active Swipe，并收集 active Events。
- `runtime/event-analysis.js:626-634` 将这些 Events 交给 `bootstrapCharacterRegistryFromLegacy()`，但同时合并当前 Chat registry；因此得到的是 `Chat base ∪ current valid Event IDs`，而不是纯 Floor snapshot。
- `runtime/event-analysis.js:645-659` 保存 `...registry`、`character_registry` 和 `last_processed_floor` 到 Chat Metadata；`:666-670` 返回同一 projection。
- `runtime/events.js:61-80` 的 adapter 只是通用 Chat Metadata writer；没有把写入值绑定到某个 Floor owner。

`core/tracking.js:459-564` 的 tracking projection 与此不同：它从传入的 current valid Events 自己构建 subjects/candidates/profiles，`:535-549` 删除没有当前 Event 引用的 subject。Canonical registry 的合并发生在 Runtime 旁路，而不是 Tracking core。

#### C. Analyzer raw response 到 identity registry、Floor 和 Chat sinks

```text
API response
  ai/analyzer.js:2557-2589
  -> runtime/event-analysis.js:1217-1224
  -> core/identity.js:1225-1359,1406-1548
  -> runtime/event-analysis.js:1226-1258
  -> runtime/event-analysis.js:1274-1282 (Floor events)
  -> runtime/event-analysis.js:1284-1295 (Chat registry)
  -> runtime/event-analysis.js:1297-1300 -> :645-659 (Chat refresh)
```

- `ai/analyzer.js:2557-2589` 解析 API response；`parseEventAnalysisResponse()` 的 identity validation 在 Runtime 延后处理。
- `runtime/event-analysis.js:1217-1224` 以 `normalizeCharacterRegistry(analysisInput.character_registry)` 为 identity base，调用 `resolveEventAnalysisIdentities()`。
- `core/identity.js:1225-1359` 对 participant collection 原子解析；失败时 `:1321-1330` 返回原始 base，不把部分新 entity 带出去。`core/identity.js:1406-1548` 再把 participant/reference handle 转成 canonical ID，并在成功时返回 working registry。
- 纯函数层的 registry “写入”是返回新值，不是 persistence：`core/identity.js:704-749` 接受 alias、`:758-824` rename、`:866-1010` 注册新 opaque ID；实际 storage write 由 Runtime 负责。
- `runtime/event-analysis.js:1226-1258` 丢弃模型的 `event_id/source`，由 Runtime 绑定确定性 Event ID 和目标六字段 Version，再 strict validate/normalize。
- `runtime/event-analysis.js:1274-1282` 只将 `analysis` 和 `events` 写入目标 Floor owner；当前 `target.floorData` 没有被补充 `character_registry` snapshot。
- `runtime/event-analysis.js:1284-1295` 随后读取当前 Chat，再把 `identityResult.character_registry` 写入 Chat Metadata。也就是说 identity 结果在 Floor authoritative save 后才写 Chat，但权威副本仍只有 Chat。
- `runtime/event-analysis.js:1297-1300` 再次 refresh；该 refresh 又使用 `Chat base ∪ active Event IDs`，可能继续保留没有 Floor 证明的 Chat entity。

#### D. Event edit、registry read 和 preflight fallback

- `runtime/event-analysis.js:1520-1545` 的 `updateEvent()` 读取当前 target active Floor Events，但在 membership check 前将 `chatData.character_registry` 作为 bootstrap base（`:1528-1537`）。因此 Event edit 的 canonical-ID 合法性仍可由 orphan Chat entry 授权。
- `runtime/event-analysis.js:1565-1569` 只保存编辑后的 target Floor Events，然后 refresh；没有保存 registry snapshot。
- `runtime/event-analysis.js:1572-1582` 删除 Event 后保存剩余 Events 并 refresh；Tracking 会 current-facts-only 重建，但 Chat registry base 仍能令 canonical entity 生存。
- `runtime/event-analysis.js:1608-1628` 的正常 `getTrackingRegistry()` 返回 derived registry；若 `collectCurrentDerivedState()` 在 Floor preflight 阶段失败，`:1614-1623` 返回空 tracking/profiles，却在 `:1620-1622` 直接返回 `normalizeCharacterRegistry(chatData.character_registry)`。这是当前最直接的 fail-open fallback。
- `runtime/events.js:242-260` 的 `init()` 异步调用 `refreshTrackingRegistry("init")`，所以 plugin init/reload 会触发 Chat registry 写入；它不是只读 bootstrap。

### 3. Canonical registry 的全部 read/write/merge/bootstrap 入口

#### 3.1 `core/identity.js`：所有是纯函数，不直接持久化

- Create/normalize/read：`createEmptyCharacterRegistry()` 在 `core/identity.js:426-439` 创建 `{schema_version:1,entities:{}}`；`normalizeCharacterEntry()` 和 `normalizeCharacterRegistry()` 在 `:442-474` 以 entity key 作为 canonical ID，只清理 shape。注释明确 historical IDs 会按输入保留；没有 source、Floor Version 或 owner 字段。
- Clone/membership/projection：`:477-507` 的 clone、`hasCharacterId()`、`getCharacterEntry()` 和 `projectCharacterRegistryCandidates()` 都只读 registry；projection 只输出 ID/display/alias，不带 Event/profile/capability/evidence。
- Pure mutations：`:704-749` alias persistence、`:758-824` display-name update/old-name alias、`:866-1010` new registration 都 clone base 并返回 next registry。它们没有 adapter/store 引用。
- Single/collection identity resolution：`:1017-1210` 检查 existing membership；`allowLegacy=true` 时未知 existing ID 在 `:1065-1085` 直接补成 legacy entity。`:1225-1359` 以 working registry 原子处理 participant collection，失败返回未改变的 base。
- Event/reference resolution：`resolveEventIdentityOptions()` 在 `:1382-1397` 接受 registry 或含 `registry/character_registry` 的 options；`resolveEventAnalysisIdentities()` 在 `:1406-1548` 以该 registry 为 base，处理 participant/reference canonicalization 和 alias candidates，不进行 storage/provenance 检查。
- Legacy bootstrap：`bootstrapLegacyCharacterRegistry()` 在 `:1648-1711` 接受 Event array/object、profiles 和 registry；`:1695-1711` normalize base 后收集 legacy Event/profile exact IDs 并补齐缺失 entity。`bootstrapCharacterRegistryFromLegacy()` 在 `:1717-1723` 只是 Runtime-shaped alias。它不从姓名生成 ID、不合并同名/同 alias、不改写旧 Event，但也不验证 Event source 是否完整、是否仍 active、是否属于当前 Chat/Swipe/Version。

#### 3.2 Storage/schema/store：Chat 是当前实际持久化 owner

- `storage/schema.js:671-674` 记载旧约定：老 Chat 缺 registry 时读取为空，等待 Runtime 从 Event/profile IDs lazy bootstrap；`:676-689` 的 `emptyChat()` 永久给 Chat object seed 一个空 registry。`:692-694` 的 `emptyFloor()` 只有 `analysis/events/snapshot/projections`，没有 registry 字段。
- `storage/store.js:641-653` 是 Chat registry read；`:656-673` 是 Chat registry write，`saveChat()` 只执行 clone、normalize 和 Chat scope/epoch 检查，未执行 Floor provenance 检查。
- `storage/store.js:720-753` 的 `saveTrackingSubjects()` 若传入 wrapper 的 `character_registry`，在 `:745-750` 复制到 `nextChat`；`:755-787` 的 `saveTrackingCandidates()` 在 `:780-785` 也有同样侧门。当前 production source search 只找到这两个方法定义/导出，没有 Runtime 调用；但它们是公开的潜在 Chat registry writer，且对应 `tests/runtime.test.js:194-211` 只覆盖普通 tracking write，不覆盖该 optional branch。
- `storage/store.js:790-814` 的 `saveFloor()` 和 `runtime/events.js:81-110` 的 `saveFloorBioWeave()` 对 Floor value 做通用 clone/save；它们没有 registry-specific normalize/validation。调用者理论上可以把任意 `character_registry` 放入 Floor data，但当前生产调用 `runtime/event-analysis.js:1277-1281` 没有这样做，且没有对应 getter/active snapshot 读取路径。

#### 3.3 Runtime：真正的 merge/bootstrap/write 集中在 `event-analysis.js`

- Read/base：`runtime/event-analysis.js:626-634` 从 current Chat 读取 registry，并把它传给 legacy bootstrap；`:1105-1195` 将结果作为 Analyzer input；`:1219-1223` 将 input registry作为 identity resolver base。
- Current Event merge：`:631-634` 调用 `bootstrapCharacterRegistryFromLegacy({events: activeEvents, character_registry: currentChat.character_registry})`。这是唯一将 current valid Floor Events 与 Chat canonical registry合并成 Runtime registry 的 production call site之一。
- Chat write/projection：`:645-659` refresh 写 Chat；`:1289-1295` analysis success 写 Chat；`:1297-1300` 之后 refresh；`:1620-1622` 失败时 Chat direct read 返回。`runtime/events.js:242-260` init 是 refresh 触发入口。
- CRUD merge/read：`updateEvent()` 在 `:1529-1537` 用 Chat base + target active Events 检查 ID；`deleteEvent()` 在 `:1572-1582` 只改 Floor Event 后 refresh。
- No Floor snapshot：`runtime/floor.js:181-188` 只理解 active Events；`runtime/floor.js:234-274` 的 `commitAnalysis()` 只处理 analysis status/version；没有任何 `character_registry` 保存、读取或合并语义。

#### 3.4 Core Tracking、AI layers：不是 registry owner，但构成链的中间/末端

- `core/tracking.js` 没有 `character_registry` 字段引用。`trackingContext()` 的 Chat roots 只为 `world_model` 服务，见 `core/tracking.js:108-124`；`rebuildTrackingRegistry()` 在 `:459-564` 仅从 current valid Event participant records 生成 tracking/profiles，并在 `:535-549` 清掉 dangling Event refs。它没有把旧 Chat canonical registry 合并回来，这一部分符合 previous/current-facts-only contract。
- `ai/input-builder.js:944-975` 是显式 DTO passthrough/normalize；没有 host context、storage 或 Floor read。它无法单独阻止 Runtime 传入错误来源。
- `ai/prompts.js:414-455,611-620,672-707` 是纯 formatter/message builder；没有 write，也没有 provenance guard。
- `ai/analyzer.js:2547-2589` 只使用给定 `analysisInput` 构建 messages、调用 transport、解析 response；当前 source search 中没有它直接读/写 `character_registry` 的路径。最终网络/宿主 sink 在 `ai/client.js:1155-1203`。

### 4. 哪些实现仍符合上一轮 Floor/Swipe provenance

以下实现对上一轮 A-I Floor-derived provenance 基线仍是正确的，不能因本次 registry 修复而回退：

1. **Per-message/per-Swipe owner**：`storage/store.js:675-692` 只读精确 owner slot；`runtime/events.js:81-110` 只写对应 `message.swipe_info[swipe_id].extra.bioweave`，没有 Swipe 结构时才写 `message.extra.bioweave`。
2. **六字段 Version binding**：`runtime/floor.js:154-188` 只承认完整 `chat_id/message_id/floor/swipe_id/content_hash/message_version`，Event active 条件是 `source` 完全相等。
3. **Previous API history**：`runtime/event-analysis.js:550-567` 从 target index 前向后扫描当前 active Swipe，要求成功 analysis、完整且相等的当前 Version、较低 Floor 和 current-version Events；无合法 candidate 返回精确 `{analysis:null,events:[]}`。它不读 Chat registry。
4. **Current-derived tracking**：`runtime/event-analysis.js:569-605` 只提供当前仍存在且 active/version-valid 的 Events；`core/tracking.js:459-564` 由这些 Events 重新生成 tracking subjects/candidates/profiles，并清除 dangling refs。Chat 的旧 tracking/profile 不是当前 Event 的授权来源。
5. **Runtime-owned Event identity/source**：`runtime/event-analysis.js:1226-1258` 丢弃模型 event ID/source，绑定 deterministic Event ID 与 target Version 后才 strict validate/normalize；`runtime/event-analysis.js:1274-1282` 只在目标 owner 保存有效 analysis/Events。
6. **Atomic identity failure**：`core/identity.js:1225-1359,1406-1548` 在 participant/reference 失败时返回原始 registry base；`runtime/event-analysis.js:1318-1382` 的失败路径不保存半结构化 Event/identity result。
7. **Chat scope/async safety**：`storage/store.js:656-673,790-814` 与 adapter `runtime/events.js:61-110` 做 Chat scope、current token 和 owner/Swipe checks；`runtime/event-analysis.js:1275-1299` 在 Floor/Chat save 前后 recheck execution target。
8. **AI input layering**：`ai/input-builder.js`、`ai/prompts.js` 和 `ai/analyzer.js` 本身没有自行发现 Chat history；其职责是消费 Runtime 已给出的输入。问题在于 Runtime 给了错误的 registry source，而不是这些层另建了历史库。

上一轮 archive 也记录了同一边界：`.trellis/tasks/archive/2026-09/09-16-floor-analysis-provenance-repair/design.md:164-185` 与 `implement.md:127-137` 将 canonical registry 明确保留为稳定 ID/display/alias 的 Chat identity configuration；上一轮只收窄了 tracking/profile/Event-derived state。因此本任务是 ownership 语义的新变化，不是上一轮 Event provenance 修复的遗漏小 patch。

### 5. `floor-state.md` / `event-pipeline.md` 与本任务 contract 的冲突

#### 当前两个 domain spec 的共同旧约定

- `floor-state.md:22-52` 正确规定 Floor facts 属于 message/per-Swipe owner，Chat map/registry/cache 不是 Floor facts 的历史来源；但同时 `:48-52` 明确允许 Chat Metadata 拥有独立的“canonical identity configuration”。
- `floor-state.md:127-169` 将 event-derived registry portions 归入 current valid Floor facts，却把 independent character identity 定义为可保留的 Chat configuration。
- `floor-state.md:142-162` 允许 derived state 为 `derive(currentValidFloorFacts, authoritativeConfiguration)`，并要求字段级区分 config 与 Floor-derived evidence；`:282-284` 更直接规定 `character_registry` 只含 ID/display/alias，且“may survive deletion of an Event”。
- `event-pipeline.md:64-73` 把 explicit Chat-local `character_registry` 定义为唯一 identity candidate source；`:124-135` 定义其持久化位置为 `chatMetadata.bioweave.character_registry`，并保留 `allowLegacyIdentity` 兼容开关。
- `event-pipeline.md:146-169`、`:192-210` 要求 Runtime registry block、Chat persistence、legacy exact-ID lazy bootstrap；storage test 还明确期望 old Chat 读空后由 refresh lazy add legacy IDs。

#### 本任务 PRD 的新要求

- `prd.md:45-63`（R1/R2）要求每个成功 Floor owner 保存完整 cumulative snapshot，previous resolver 一次返回 analysis/events/snapshot；无合法 previous 必须空 registry，不得从 Chat Metadata、Tracking、profiles/cache/`last_processed_floor` 回填。
- `prd.md:65-84`（R3/R4）要求 Analyzer candidates 只能来自 previous Floor snapshot，analysis/Events/final snapshot 在同一次 target owner save 中保存，Chat registry 若保留只能是 projection/config/compat view，不能是 historical source。
- `prd.md:86-94`（R5）把 legacy bootstrap 限定为一次性 migration/adapter，普通 analysis、previous、registry read、Event edit 和 API input 均不得调用。

#### 冲突和必须明确的语义边界

当前 `character_registry` shape 只有 `{character_id,display_name,aliases[]}`，没有字段区分“用户/角色/插件明确配置的 independent identity”与“由 Event 学到的 historical identity”。因此不能仅凭现有 entry 形状同时满足：

- `floor-state.md:282-284` 允许 canonical identity config 跨 Event deletion 存活；以及
- PRD 要求 historical canonical identity 只随 valid Floor/Swipe snapshot 恢复。

如果本任务将所有 `character_registry` entity 视为 historical identity，现有 `floor-state.md` 和 `event-pipeline.md` 的 Chat-owned/persistent/lazy-bootstrap 条款需要同步修订；如果仍允许用户显式配置身份，则必须在后续设计中明确其与 Floor snapshot 的分离、优先级、合并和 API exposure。当前代码没有这个区分。此审计不修改 spec，故该冲突是后续 implementation 的关键前置 caveat。

### 6. Legacy migration 的现实边界与兼容风险

#### 现实边界

1. `core/identity.js:442-474` 的 normalize 只做 shape cleanup，保留输入中的历史 IDs；它不能证明 ID 曾经来自哪个 Floor。
2. `core/identity.js:1648-1711` 的 legacy bootstrap 只从 Event participant/pregnancy reference 和 profile 的 exact `character_id` 收集记录，不从姓名生成 ID，不按同名/alias 合并，也不重写旧 Event。该防破坏策略由 `tests/character-identity.test.js:572-608` 锁定。
3. 该 helper 本身不检查 Event `source` 是否完整、current、active Swipe、匹配六字段 Version 或仍属于当前 Chat；安全性完全取决于 caller 传入的 `events`。当前 Runtime caller 在 `runtime/event-analysis.js:631-634` 传入 current valid active Events，但同时把未经筛选的 `currentChat.character_registry` 作为 base；`updateEvent()` 的 caller 在 `:1529-1532` 也如此。
4. 老 Chat 的“读取为空、不立即写 migration”行为在 `tests/runtime.test.js:176-192`；但 `runtime/events.js:242-260` 的 init refresh 会调用 `runtime/event-analysis.js:645-659`，从当前 valid Events lazy bootstrap 并写 Chat。也就是说 migration 不是 storage read 发生时写，而是 Runtime init/refresh 发生时写。
5. `allowLegacyIdentity` 默认在 `runtime/events.js:115-125` 为 `false`，但 `core/identity.js:1065-1085` 在显式开启时允许未知 existing ID 从 AI participant 直接创建 registry entry；这条兼容路径没有 Floor snapshot 参数。生产默认路径不应开启它，但它仍是可达的兼容风险。
6. `storage/store.js:720-787` 的 tracking save wrappers 可以带 `character_registry`，虽当前 production search 未发现调用；任何未来 caller 若把 derived wrapper 传入就能绕过 Floor-owned 语义写 Chat。

#### 兼容风险

- **孤立 entry 无法辨识**：Chat registry 是当前唯一持久副本，且 entry 没有 provenance；不能区分用户配置、旧 profile、AI 新注册和 Event-derived history。
- **profile-only legacy identity 不可证明**：legacy helper 接受无 source 的 profile，`tests/character-identity.test.js:572-608` 甚至用 bare Event/profile fixture；在 PRD R5 下这类记录不能直接写入 Floor snapshot，必须有明确 migration 证明边界。
- **旧 Chat compatibility 与新 fail-closed 目标冲突**：`event-pipeline.md:169,208-210` 期望保留并 lazy-bootstrap 旧 ID；PRD R5 要求普通路径不再调用该 bootstrap，旧 Chat registry 只能 inert projection 或一次性 migration input。
- **Chat fallback 可能在正常 refresh 之外恢复 entity**：`runtime/event-analysis.js:1620-1622` 的 preflight fallback 和 `:1529-1537` 的 Event edit membership check 都不要求当前 valid Floor snapshot。
- **通用 Floor writer 未形成 snapshot contract**：虽然 `saveFloor()` 可存任意对象，但 `emptyFloor()`、`floorVersionFromData()`、`findPreviousSuccessfulBioWeave()` 和 active reader 都不读取 registry；“把字段塞入 Floor”本身不会建立 PRD 要求的 previous/validity/atomic semantics。

### 7. Case J-P 测试缺口与最小验证建议

Case J-P 的明确语义在 `.trellis/tasks/09-16-floor-owned-character-registry/prd.md:104-127`；当前测试 checkout 没有覆盖这些 canonical snapshot 断言。已有测试大多只断言 `existing_bioweave`、Events、Tracking/profiles，不能证明 registry provenance。最小验证如下：

| Case | 当前覆盖/缺口 | 最小验证建议 |
| --- | --- | --- |
| **J — first analysis 不继承 orphan Chat registry** | `tests/event-analysis-runtime.test.js:2182-2218` 只注入 stale profiles/candidates，并未注入 stale `character_registry`；`tests/runtime.test.js:176-192` 只验证老 Chat 读取不写 migration。 | 预置 Chat Metadata `[A,B,C]`，不放任何合法 analyzed Floor；调用 `getCurrentFloorAnalysisInput()` 和真实 analyzer stub。断言 `existing_bioweave` 是精确空值、`input.character_registry.entities` 为空、最终 prompt/request body 不含 A/B/C 的 ID 或 display name。当前 `runtime/event-analysis.js:631-634` 应产生 baseline red regression。
| **K — cumulative Floor snapshot** | `tests/event-analysis-runtime.test.js:451-590` 验证新 identity 写 Chat 且下一次 input 可见，但没有断言 2F/5F owner slot snapshot，也没有检查 Chat save 是否晚于 Floor save。 | 2F 输出 A，断言 2F 的 exact Floor owner slot 保存 snapshot `[A]`；5F analyzer 输入只来自 2F `[A]`，输出 B 后断言 5F snapshot `[A,B]`。同时记录 save calls，确保 target Floor 的 analysis/events/snapshot 是一次 authoritative save，Chat projection 不先于 Floor。
| **L — target self exclusion** | `tests/event-analysis-runtime.test.js:1515-1570` 验证 target 不进入 `existing_bioweave`；`tests/event-analysis-runtime.test.js:1240-1303` 只验证 previous Event/Version，不检查 target registry snapshot。 | 建立 2F `[A]`、5F `[A,B]`、9F `[A,B,C]`，强制重分析 9F；断言 9F analyzer input registry 恰为 5F `[A,B]`，而非自身旧 snapshot `[A,B,C]`，并保留 9F owner 的旧数据直到新结果成功保存。
| **M — deletion rollback** | `tests/event-analysis-runtime.test.js:1403-1419` 只验证删除 9F 后 Event previous 回退 6F；`:2116-2180` 只验证删除 Floor 后 Tracking/business data 为空。没有 registry snapshot rollback。 | 删除 9F 后分析目标，断言 identity previous `[A,B]`；再删除 5F，断言下一次只得到 2F `[A]`。同时断言 Chat projection、`getTrackingRegistry()` 和 API prompt 都不能补回已删除 Floor 的 entity。
| **N — delete all + reload** | `tests/event-analysis-runtime.test.js:1948-1997` reload 后验证 tracking/profiles/previous/旧 Event ID 清空，但未断言 canonical registry；`:1912-1946` Swipe deletion 也未断言 registry。 | 删除所有 analyzed Floor，重建 Runtime/reload；调用 refresh 和 analyzer stub，断言 input/prompt/request registry 为空，Chat 中旧 `[A,B,C]` 不再成为 source。若保留 Chat projection，验证它只能被清空/标记 inert，不能被普通 refresh 恢复为 input。
| **O — Swipe isolation** | `tests/event-analysis-runtime.test.js:1832-1854` 验证 active Swipe Event isolation，`:1856-1909` 验证 previous API state；`:1912-1946` 验证 Swipe 删除后的 Tracking/profiles，均未检查 registry snapshot。 | 同一 message 的 Swipe 0 保存 `[A]`、Swipe 1 保存 `[B]`；切换分别断言 registry `[A]`/`[B]`。删除 Swipe 1 后再次读取/分析，断言 `[B]` 不从 Chat projection、另一个 Swipe 或 preflight fallback 恢复。
| **P — Floor Version invalidation** | `tests/event-analysis-runtime.test.js:1572-1625` 与 `:1694-1749` 验证 stale Version/编辑后的 previous Events，不验证 identity snapshot。 | 预置旧 snapshot `[A,B]`，编辑正文或改变 `message_version` 使六字段 Version 不匹配；目标分析的 previous identity 必须为空或回退到更旧的 valid snapshot，绝不能继承 stale `[A,B]`。request body 也必须没有 stale IDs/display names。

Case J-P 之外还需要一个 cross-cutting regression：将 Chat registry、Tracking DTO、Event edit membership 和 API request 放在同一 deletion/version/Swipe fixture 中，断言它们都消费同一 valid Floor snapshot；并保留上一轮已有的 Event source、per-Swipe、previous empty、tracking current-facts-only 和 in-flight invalidation 测试。当前没有测试目标 Floor owner 内存在 `character_registry`、previous resolver 返回它、或 Chat save 不能先于 Floor save。

## Related specs

- `.trellis/spec/domain/floor-state.md:22-52,95-169,171-211,259-286`：当前 Floor owner、previous、derived state、API provenance 和“canonical identity configuration 可留在 Chat”的旧 contract。
- `.trellis/spec/domain/event-pipeline.md:20-36,64-73,113-169,192-210`：当前 CharacterRegistry 持久位置、identity resolution、legacy bootstrap 和旧测试要求。
- `.trellis/tasks/09-16-floor-owned-character-registry/prd.md:1-140`：本任务 R1-R6、legacy boundary、Case J-P 和禁止当前阶段修改业务/测试/spec 的约束。
- `docs/DEVELOPMENT.md:38-55,62-66`、`README.md:476-492`：现有产品/数据流描述；没有定义 Floor-owned canonical registry snapshot。
- `.trellis/tasks/archive/2026-09/09-16-floor-analysis-provenance-repair/design.md:164-185`、`implement.md:127-137`：上一轮明确保留 Chat-local canonical identity configuration 的历史边界。

## External references

None. This was a source-level internal audit; no external API/version facts were needed.

## Caveats / Not Found

- 本轮未运行自动化测试、未启动 `task.py`、未修改业务代码/测试/spec/规划文档，也未执行任何 Git 操作；Case J-P 建议是基于当前 PRD 的最小 test assertions，不是已执行结果。
- 当前代码没有 registry provenance 字段，也没有 per-Floor snapshot reader。若要实现 PRD，必须先解决“独立 Chat identity configuration”与“Floor-owned historical identity”是否共用同一 `character_registry` shape 的语义/迁移边界；不能只把现有 Chat write 移到另一个位置而假定 contract 已闭合。
- `allowLegacyIdentity=true` 是显式兼容开关，生产 `createRuntime()` 默认关闭；审计保留该风险，因为它可在调用方/fixture 开启时从未知 AI existing ID 创建无 Floor provenance 的 registry entity。
- `storage/store.js:720-787` 的 optional registry copy 是潜在通用写入口，当前 production search 未发现调用；后续实现/检查应明确禁止它成为 Floor-owned registry 的 bypass。
