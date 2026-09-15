# 技术设计：Floor 分析事实 provenance 修复

## 1. 审计结论

本次基线为当前 checkout 的 source-level audit 与 `npm test`：510 passed、0
failed。结论不是“删除 Floor 的事件回调少清了一个 cache”，而是存在两类
不同性质的缺口：

1. `existing_bioweave` 的主要 previous 查找链路已经遵守
   `floor-state.md`，不应推翻重写。
2. Chat Metadata 中的 Event-derived profile/candidate 被当成了下一次
   Tracking 的证据，且业务读路径直接信任 materialized view；因此删除、截断、
   版本失效或 refresh 失败后，旧事实仍可能出现在派生状态或 API prompt。
   另外，生命周期失效发生在请求构建后时，旧请求仍可能被 transport/retry
   发送。

这意味着当前代码确实存在 deleted/stale/orphan Floor facts 的污染路径。

## 2. Source → propagation → sink 审计

### P1：旧 `character_profiles` 重新授权当前 Event，并进入 API

```text
曾经有效的 Floor Event participant
→ core/tracking.js profileFromParticipant/mergeProfiles
→ Chat character_profiles
→ previousProfiles + resolvedParticipantFacts
→ 当前 tracking_subjects/candidates 与当前 character_profiles
→ defaultCharacterContext
→ character_context → Event prompt → API transport
```

证据：

- `core/tracking.js:50-76,149-156,518-569` 从旧 Chat profile 读取并合并
  `species`、`biological_type`、生殖能力和 evidence；当前有效 Event 的
  `null` 能力会因此被旧 `true/false` 补全。
- `runtime/event-analysis.js:596-613` 将这个 projection 写回 Chat；
  `:125-130,1033-1083` 又把 Chat profile 作为 `character_context` 输入。
- `ai/input-builder.js:930-979` 只负责安全规范化，不验证这些 profile 的
  Floor provenance；`ai/prompts.js:466-557,611-620` 将生物字段和 evidence
  写进 prompt；`ai/analyzer.js:2534-2565`、`ai/client.js:1155-1203`
  是最终 API sink。

这是确定的 API 污染路径，不是 `existing_bioweave` 的 fallback。

### P2：旧 `tracking_candidates` / nested derived root 污染新 Tracking

```text
已删除/失效 Floor 的 candidate/profile
→ Chat tracking_candidates 或 bioweave/chat_metadata.bioweave nested root
→ findRegistryRoot → previousCandidates/previousProfiles
→ resolveIdentity/resolveCapabilities
→ World Model baseline 与 eligibility 判定
→ 当前 tracking_subjects/candidates、explainTrackingDecision
→ business DTO/UI 与下一次 Chat materialized view
```

证据：

- `core/tracking.js:111-126` 会在多个 Chat root 之间为 derived field
  选择有值的旧 root；`:159-196` 不校验 candidate 的 Event/Floor source。
- `:290-340,383-415` 允许旧 candidate/profile 影响当前 identity、capability
  和 decision；`:518-569` 把结果重新写成当前 projection。
- `runtime/event-analysis.js:822-876` 将 subjects/candidates/profile 放入
  business DTO；旧 candidate 不直接作为 `existing_bioweave` 发送，但会
  污染运行状态和 UI，并可能继续成为下一次 rebuild 的输入。

当前 `tracking_subjects` 的 exposure reference 在正常一次 rebuild 中会按
本轮 Event ID 过滤（`core/tracking.js:594-605`），所以单独的引用清理方向
是对的；污染发生在判定输入和 profile 保留，而不是该过滤器缺少一次
`delete`。

### P3：Materialized Chat view 作为直接读源

```text
删除/截断/Swipe 删除/旧版本失效后的 Chat Metadata
→ runtime/event-analysis.js buildBusinessData/getTrackingRegistry
→ tracking_subjects/candidates/character_profiles business DTO
→ ui/app.js refreshBusinessState → UI model
```

证据：`runtime/event-analysis.js:797-876` 虽然重新收集了当前 Floor Events，
但仍直接取 `chatData.tracking_subjects`、`tracking_candidates` 和
`character_profiles`；`:1477-1486` 的 `getTrackingRegistry()` 直接返回
Chat metadata。`runtime/events.js:191-210,236-255` 的 refresh 是异步的，
`ui/app.js:1972-1994,2961-2974` 会在通知/读取窗口中消费 DTO。

因此丢失生命周期回调、refresh 尚未完成或 refresh 失败，都能造成 stale
read。已有 `tests/event-analysis-runtime.test.js:1799-1819` 只证明发出
`MESSAGE_DELETED` 后最终 rebuild 正确，尚未证明 callback-independent read
正确。

### P4：生命周期失效后的 in-flight API request

```text
当前有效 Floor input 已构建
→ lifecycle 使 Chat epoch 失效
→ in-flight analyzer/transport/retry 仍持有旧 messages
→ ai/client.js current API 或 independent fetch
→ API
```

证据：`runtime/event-analysis.js:1064-1102` 只在 analyzer 返回后检查
`assertExecutionCurrent`；`runtime/events.js:191-205` 会 invalidate，但
`runtime/event-analysis.js:1357-1360` 删除时只 refresh，没有取消所有 in-flight
execution。`ai/client.js:531-547` 的 retry 已经支持 abort signal，但当前
runtime 没有在生命周期失效时触发该 signal。已有
`tests/event-analysis-runtime.test.js:2123-2149` 只验证 stale completion
不写回，不验证 API transport 未发送/重试旧 request。

这条路径是“删除发生在请求期间”的 stale send 风险；它和 P1 的 Chat profile
旁路需要分别测试。

### P5：已删除 Swipe 的 slot 被重新创建（条件性边界风险）

```text
Swipe slot 被删除但 host active swipe id/数组仍暂时指向旧索引
→ activeSwipeId 不验证内容存在
→ resolveFloor 对无内容 Swipe 回退到 message content
→ saveFloor/adapter 创建 swipe_info[id].extra.bioweave
→ 新结果成为 active Floor/API 输入
```

证据：`storage/store.js:595-613,654-668` 选择 id 但不确认对应 Swipe 内容；
`runtime/event-analysis.js:67-78,500-533` 在结构化消息缺失当前 swipe 内容时
会回退到消息级内容；`runtime/events.js:82-97` 的 writer 会创建缺失的
`swipe_info[id]`。正常 host 若已把 active id 切到存在的 Swipe 不会触发，
但删除/切换边界必须 fail closed，不能依赖 host 回调顺序。

### P6：Storage/schema 的 shape-preserving 入口不是事实有效性门

```text
任意 caller 提供的 Chat tracking payload
→ storage/store.js saveTrackingSubjects/saveTrackingCandidates
→ Chat Metadata
→ 后续旧 projection 读取或 rebuild 输入
```

`storage/store.js:685-765` 暴露了可写入 subjects/candidates/profile/registry
的兼容入口，`storage/schema.js:656-694` 只做 shape-preserving normalization，
不验证 Floor/Swipe/Version provenance。当前 source search 未发现生产业务代码
调用这两个兼容入口（调用只存在于 storage tests）；因此它不是当前主 API
污染证据，但它不能被误认为 authoritative storage。实施阶段应以实际新增
失败测试决定是否限制入口为 Runtime projection，不能把它当第二个历史库。

同时，`ui/app.js:882-934,1592-1636,1663-1717` 写入的是分析来源、recent
story 和 World Model configuration，未发现其写入 derived tracking facts；
`ai/worldbook.js` 的 source/model cache 也不承载 Floor Event。它们属于应保留
并明确排除的配置/cache 边界。

## 3. 已符合规范、实施阶段不应修改的部分

- `storage/store.js:654-683` 对结构化消息读取精确的
  `swipe_info[swipe_id].extra.bioweave`，不跨 Swipe fallback；普通消息读
  `message.extra.bioweave`。业务调用已通过 store abstraction。
- `runtime/floor.js:1-8,130-189` 定义并校验完整六字段 Floor Version，且
  `getActiveFloorEvents` 要求 Event `source` 逐字段匹配。
- `runtime/event-analysis.js:535-579` 的 previous/active scan 从当前消息
  集合读取 active Swipe，重算当前 content hash，排除目标自身，只接受最近
  的低楼层、成功且完整版本匹配的 Floor；无来源返回
  `{analysis:null,events:[]}`。这部分应以测试锁定，不要另建 Chat history
  查询或第二个 repository。
- `runtime/event-analysis.js:1111-1129,1160-1166` 丢弃模型提供的 Event ID
  和 source，由 Runtime 绑定确定性 ID 与目标 Floor Version，再写目标 slot。
- `ai/input-builder.js:866-1024` 是输入规范化边界，没有自行搜索 Chat
  历史；`ai/analyzer.js:2534-2565` 和 `ai/client.js:1155-1203` 不会自行
  发现旧 BioWeave 事实。
- `core/tracking.js:594-605` 的 active Event ID/reference 清理方向正确；
  `core/identity.js:431-434,1648-1711` 的 canonical
  `character_registry` 只含稳定 ID、display name、alias，不含 Event、能力、
  妊娠或 evidence，应继续作为合法 Chat identity configuration 保留。
- `world_model`、analysis source/settings、recent story、API profile 和
  World Model prompt 是配置/叙事输入，不是 Floor analysis history，不应因
  本修复被迁移或清空。`last_processed_floor` 当前只在
  `runtime/event-analysis.js:1171-1185,1365-1371` 参与 interval scheduling，
  没有进入 previous 或 API historical context；但其 stale hint 需要重算以
  避免历史截断后的调度错误。
- `storage/schema.js:656-694` 的 empty/normalizer 只是兼容形状，不负责把
  Chat projection 变成权威事实；`storage/store.js:697-764` 的兼容写入入口
  当前没有生产调用，实施阶段不得绕过 Runtime provenance 直接扩展其职责。
- `core/identity.js:1652-1722` 的 legacy profile bootstrap 是纯 identity
  helper；生产 Runtime 不应把无 provenance 的 Chat profile 传给它，但 helper
  本身不需要改成 Floor history store。`ui/app.js` 的配置写入和
  `ai/worldbook.js` 的 source cache 不属于本次污染源。
- 参考项目的 per-message/per-swipe owner 方向记录于
  `research/reference-snapshot.md`；不照搬其宿主镜像细节，不新增独立历史表。

## 4. 最小修复设计

### 4.1 将 Tracking projection 改为 current-facts-only

在 `core/tracking.js` 保留 `rebuildTrackingRegistry(activeEvents, chat)` 的
公开边界和现有 Event/World Model 判定逻辑，但做以下最小收窄：

1. `tracking_subjects`、`tracking_candidates` 和 `character_profiles` 每次从
   本次传入的当前有效 Events 重新建立；不以 Chat 的旧 derived fields 初始化。
2. `resolveIdentity`、`resolveCapabilities` 和
   `trackingDecisionPath` 只接收当前 Event participant records 与合法
   `world_model` configuration，不再接收旧 profile/candidate 作为证据。
3. 取消 `findRegistryRoot` 对 `tracking_subjects`、`tracking_candidates`、
   `character_profiles` 的 nested fallback。若保留 legacy root 兼容，只允许
   `world_model` 等明确配置字段使用，不得把 legacy derived data 注入 rebuild。
4. `created_from_event_id` 从当前 Event 顺序确定；不依赖旧 subject 的同名字段。
   当前 Event 的 exposure records 仍保留其 `source`，并由现有 active-ID
   清理逻辑保证没有 dangling reference。

本 checkout 中没有发现独立 UI/配置写入 `character_profiles` 的生产路径；
`character_registry` 才是 identity configuration，`world_model` 才是
World Model configuration。因此将 `character_profiles` 作为当前 Event-derived
projection 重建是有证据的最小处理，不是粗暴删除混合用户配置。若兼容旧
Chat 中的历史 profile，允许其物理存在的迁移策略也不能让它进入上述三个
判定/API-facing projection；本任务不把它另立为事实源。

### 4.2 统一 current-derived read projection

在 `runtime/event-analysis.js` 保持现有模块边界，增加一个小的纯/异步
current-derived 读取路径：

```text
current Chat messages
→ active Swipe + exact Floor slot
→ current Floor Version/source filter
→ activeEvents
→ rebuildTrackingRegistry(activeEvents, authoritative config)
→ business DTO / registry read / character_context
```

- `collectActiveBusinessData()` 和 `getTrackingRegistry()` 每次使用当前
  `activeEvents` 的 rebuild 结果，而不是直接返回 Chat materialized view。
- `refreshTrackingRegistry()` 仍可把 projection 持久化到 Chat，作为 reload
  和性能友好的 materialized view；但保存失败、回调丢失或 reload race 不会
  改变即时 read 的正确性。
- `buildFloorAnalysisInput()` 给 `characterContextResolver` 的 Chat-shaped
  input 只包含本次 current-derived profiles/subjects/candidates，以及合法的
  configuration。默认 resolver 因而不会把 stale profile 放进
  `character_context`。
- `character_registry` 继续从当前 active Event 补足尚未登记的 exact IDs，
  但不再从旧 `character_profiles` bootstrap；既有 canonical identity entries
  仍作为配置保留，不携带生物事实。
- preflight/derived rebuild 出错时 fail closed：不能用旧 Chat subjects、
  candidates 或 profiles 填充业务 DTO 或 API input。

### 4.3 生命周期和 Floor/Swipe re-check

- 在 coordinator 订阅 `chat` boundary 的 invalidation/change；失效时 abort
  当前 in-flight executions，并在调用 analyzer 前再次
  `assertExecutionCurrent`。
- 复用 `ai/client.js` 已有的 signal-aware timeout/retry；补充测试证明
  abort 后不会开始下一次 retry。若 current API host 忽略 signal，runtime
  仍必须在调用前 fail closed，不能把 stale completion 当成成功。
- 在 Floor save 前重新解析 target 的当前 active Swipe/六字段 Version，若
  内容、版本或 active Swipe 已变化，放弃旧结果而不写回。
- storage/runtime 的 active Swipe 解析增加“对应当前 Swipe 内容/slot 仍存在”
  的边界检查；无效删除 Swipe 不得回退到 message-level content，也不得由
  adapter 创建一个已经不存在的业务 owner slot。

### 4.4 `last_processed_floor` 只作可重算 hint

保留字段和现有 Chat schema，但不再用 `Math.max(old, target)` 形成不可回退的
游标。新增的最小重算点以当前 Chat 的 active Swipe + 完整 Floor Version +
`analysis.status === 'success'` 为依据，求当前有效成功分析 Floor 的最高值：

- registry refresh/reload 后更新 hint；
- 自动 interval 判断前使用当前集合重算，避免历史截断或删除高楼层后跳过
  本应分析的低楼层；
- previous 查找、active event validity、Tracking identity/capability 和
  API historical context 永远不读取该 hint。

## 5. API provenance contract

`existing_bioweave` 继续完全由现有 current-message scan 提供：

1. 从 target message 的前一条向前扫描；
2. 每次选当前 active Swipe 并读精确 slot；
3. 计算当前六字段 Version；
4. 要求 `analysis.status === 'success'`、floor 小于 target、完整 Version
   相等，并从 `getActiveFloorEvents` 取 source 匹配的 Events；
5. 第一条合法候选立即返回；target 自身永不参与；无候选返回
   `{analysis:null,events:[]}`。

因此旧 Floor 被删除、Swipe 被删除、内容 hash 改变或所有历史被清空时，
previous 只能回退到仍存在的更旧合法 Floor，或精确为空。profile/candidate/
registry/cache/last hint 不得提供第二条 previous 路径。

## 6. 兼容性与风险边界

- 保留 `character_registry` 的 canonical identity entries、World Model、
  settings、recent story、API profile 和 prompt 配置；不修改 Event/World
  Model schema。
- 现有测试把“空 current Events 仍保留历史 profile”作为兼容行为
  (`tests/tracking.test.js:381-415`)；实施阶段需改成验证 profile 不再作为
  active/API fact。若选择保留其物理存储，必须同时证明它是 inert 且不进入
  `character_context`，否则会违反 API boundary。
- 现有 nested legacy profile 测试
  (`tests/tracking.test.js:417-447`) 代表当前错误回退，不应继续作为业务
  资格判定的契约；可改成“legacy derived root 不授权当前 Event”的测试。
- `storage/store.js` 对一般测试数据仍允许不完整的 generic `floor_version`
  round-trip；不要为了此修复破坏旧 storage adapter 的通用兼容。有效分析
  事实的完整六字段门禁继续由 `runtime/floor.js`/active filters 和 save 前
  re-check 负责。
- `init()` 的异步 materialized-view refresh 可继续用于通知，但正确性必须
  由即时 current-derived read 保证；真实 SillyTavern host 的 delete/swipe
  顺序仍需实现后做手工验收。

## 7. 回归矩阵与 red → green 证明

先添加会在当前实现失败的断言，再实施修复并重新运行：

| Case | 证明点 | 主要测试位置 |
| --- | --- | --- |
| A | 3F/6F/9F 后重分析 9F，previous 是 6F，不是旧 9F | `tests/event-analysis-runtime.test.js` |
| B | 9F 首次分析 previous 是 6F | 同上 |
| C | 删除 9F 后新 Floor 回退 6F，9F 结果不在 input/DTO | 同上 |
| D | 仅 9F 删除后 previous 为空，不从 Chat metadata 恢复 | 同上 |
| E/F | active Swipe 严格隔离，删除当前 Swipe 后数据消失且不重建旧 slot | `tests/runtime.test.js`、runtime suite |
| G | 旧正文 hash/version 变化后旧 result/Event 不再有效 previous | runtime suite |
| H | 删除支持 subject/candidate 的 Floor 后即时 rebuild 只剩当前 Event | `tests/tracking.test.js`、runtime suite |
| I | 全部分析 Floor 删除后新 runtime/reload 的 active events、registry、previous、API 都为空 | runtime suite |

另加针对 P1/P2/P3/P4/P5 的 focused regression：旧 profile/candidate 不得改变
当前 unknown capability；不发 lifecycle callback 直接删除消息后读取也必须为空；
refresh/save 失败时不返回旧 DTO；invalid Swipe 不得写回；invalidate 后 transport
不发送/不 retry 旧 request。每个测试都要同时断言 Floor slot、derived DTO、
analysis input 和真实 request messages 的边界，避免只测试“最终 cache 被清掉”。
