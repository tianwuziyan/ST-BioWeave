# Character Registry 与 Floor Snapshot 技术设计（待确认）

## 1. 审计基线与边界

审计基线为当前 HEAD `515ecc6094fd4eb1ec3334f6ea7231a6ef1c7594`，工作分支为
`fix/world-model-prompt-baseline`。当前产品代码与测试没有修改；本任务目录中的
`prd.md`、本文件和 `implement.md` 仅是规划工件。

已执行：

- `npm run check`：565 tests passed，0 failed；
- 只读检查 `.trellis/spec/domain/floor-state.md`、
  `.trellis/spec/domain/event-pipeline.md`、`docs/bioweave-data-lifecycle.md`；
- 追踪 Runtime、Storage、AI input/prompt/analyzer、Domain Event 与现有测试；
- 用原创临时人物名做了只读 Node probe，确认 ID、fallback、跨 Event mention 和删除事件的实际行为。

## 2. 当前实际数据流

```text
当前 Chat + active Swipe
  -> runtime/floor.js 六字段 Floor Version
  -> storage/store.js 精确 Floor/Swipe owner slot
  -> findPreviousSuccessfulBioWeave(target)
       （target.index - 1 向前，排除 target 自身）
  -> buildFloorAnalysisInput()
       character_registry = previous.character_registry
       existing_bioweave = { analysis, events }
       current_floor = target narrative
       recent_story = target 之前的 causal prefix
  -> buildEventAnalysisInput()
  -> buildEventAnalysisMessages() / Analyzer / API
  -> resolveEventAnalysisIdentities()
  -> canonical Event + working Character Registry
  -> strict Event collection validation
  -> store.saveFloor(target owner)
  -> refreshTrackingRegistry() 写 Chat projection
```

权威来源仍然是当前 Chat 内的消息/Swipe owner。Chat-level
`character_registry` 只由 `refreshTrackingRegistry()` 作为 materialized projection
写回，不能作为 Analyzer historical source。

## 3. 当前实现确认

### 3.1 Registry 与 storage

- Registry shape 已是 `{schema_version: 1, entities: {[character_id]: entry}}`。
- Entry 已有 `character_id`、`display_name`、`aliases[]`；`normalizeCharacterEntry()`
  明确以 Registry key/canonical ID 为权威，显示名和 alias 不是 key。
- 普通消息 owner 是 `message.extra.bioweave`；结构化消息按
  `message.swipe_info[swipe_id].extra.bioweave` 精确隔离，均经现有 Store abstraction。
- 成功分析在同一 Floor/Swipe owner 一次保存 `analysis`、`events`、完整累计
  `character_registry`；失败路径使用当前 owner 数据保留原成功结果。
- `emptyFloor()` 已包含空 Registry；Chat `character_registry` 的生命周期 registry
  类型是 materialized projection，Floor `character_registry` 类型是
  authoritative floor snapshot。

主要证据：`core/identity.js:431-475`、`storage/schema.js:683-710`、
`storage/store.js:793-932`、`runtime/events.js:557-585`、
`runtime/event-analysis.js:1581-1595`、`storage/lifecycle.js:87-93,162-167`。

### 3.2 Previous snapshot 与 reanalysis

`findPreviousSuccessfulBioWeave()` 当前从 `target.index - 1` 向前扫描，逐项要求：

- active Swipe 与精确 owner 可读；
- `analysis.status === "success"`；
- candidate floor 严格低于 target；
- 重算的六字段 Floor Version 与保存值一致；
- 不在 reset boundary 之前；
- 不在 Runtime invalidation map 中。

成功时 Registry 直接取同一个 candidate owner 的 `character_registry`；没有 candidate
时返回空 Registry。`buildFloorAnalysisInput()` 不从 target owner 读取旧 Registry，
并把 target narrative 单独构成 `current_floor`。现有 reanalysis 测试已覆盖 target
旧结果不进入 `existing_bioweave`/Registry。

主要证据：`runtime/event-analysis.js:795-823`、`runtime/event-analysis.js:1376-1493`、
`.trellis/spec/domain/floor-state.md:100-142`、
`tests/event-analysis-runtime.test.js:1938-1993`。

已确认的细节缺口：当前 helper 对缺失的 candidate `character_registry` 调用 normalize
后可能把它当作空 Registry 接受；没有按 floor-state contract 的第 8 条跳过该 candidate。
实施决策是不兼容开发期旧 character ID；缺失或不合法 Registry candidate 直接跳过并继续
向前搜索，不回退 Chat projection，也不增加迁移或 legacy read 层。

### 3.3 API 输入与 narrative 去重

`buildFloorAnalysisInput()` 的 `recentStoryItemsBefore(target.index)` 只提供 target
之前的 causal prefix，`processedTarget` 只赋给 `current_floor.narrative`。
`buildEventAnalysisInput()` 将 `character_registry` 和 `existing_bioweave` 保持为独立
字段；`buildEventAnalysisMessages()` 的 assistant narrative 使用
`recent_story.items ?? recent_context`，再单独附加 `current_floor`。

归一化对象会把前置 `recent_story.items` 镜像为 `recent_context`，但 Prompt 只消费一份
优先列表；target 不在两者中。因此当前没有把 target narrative 同时作为
`recent_context` 与 `current_floor` 发送的问题。已有 runtime regex 测试只验证 target
经过一次处理，另一个只读 probe 确认目标 marker 在 API assistant content 中出现 1 次。

主要证据：`runtime/event-analysis.js:1418-1493`、`ai/input-builder.js:690-761,866-1024`、
`ai/prompts.js:672-707`、`ai/prompts.js:374-405`、
`tests/event-analysis-runtime.test.js:1237-1277`。

### 3.4 当前 ID 算法

当前正式生成路径为：

```text
runAnalysis
  -> resolveEventAnalysisIdentities
  -> resolveRawParticipantIdentities（每个 Event 单独调用）
  -> resolveRawParticipantIdentity
  -> registerNewCharacter
  -> generatedCharacterId
  -> options.idFactory 或 createOpaqueCharacterId
```

基线实现的正式生成路径是 `createOpaqueCharacterId()`：优先
`crypto.randomUUID()`，没有 UUID 时使用时间片段、`Math.random()` 和进程内 fallback
counter；`idFactory` 还可以让调用方注入任意字符串。基线实现不读取姓名生成 ID，但也
没有强制六位 sequential 格式，因此不是 `char_000001` contract。该段是实施前审计事实；
实施后这些生产路径已移除。

主要证据：`core/identity.js:517-537,831-842,868-1011`、
`runtime/event-analysis.js:1516-1523`。只读 probe 得到 UUID 格式
`char_00000000-0000-4000-8000-000000000001`，并确认自定义
`char_runtime_001` 可被当前 `idFactory` 接受。

### 3.5 mention 与 existing fallback

当前 raw participant 可携带 `mention_id`；`resolutionSuccess()` 在内存 resolution
结果中保留它，但 `canonicalParticipant()` 删除 `identity_status`、`mention_id`、
identity evidence 等临时字段，最终 `normalizeEvent()` 保存 canonical participant
只依赖 canonical `character_id` 和 `display_name`。因此 mention 是当前 response
resolution 的临时数据，不是持久跨楼层身份；当前没有必要为持久化增加 mention 依赖。

当前 `resolveRawParticipantIdentity()` 对 `existing` 的第一权威检查是 Registry
membership。基线未知 ID 在生产默认 `allowLegacyIdentity=false` 时返回
`UNKNOWN_EXISTING_CHARACTER_ID`；它只报告 exact display candidates，不会在唯一候选
时自动 canonicalize。基于开发期数据可清空的最终决策，实施后不保留该旧 bootstrap 或
其它 legacy read/migration 入口；未知 supplied ID 只允许通过唯一 exact display/alias
候选由 Runtime canonicalize，0/多候选继续 fail closed。

主要证据：`core/identity.js:350-364,393-423,1058-1173`、
`core/events.js:209-253`、`runtime/events.js:589-600`。只读 probe 已确认：错误 ID
为姓名时，唯一 exact display/alias 候选也会失败；0 候选和多候选同样失败。

### 3.6 跨 Event mention 与 pregnancy reference

当前 `resolveRawParticipantIdentities()` 的 `handles` 与 `raw_to_canonical` 只覆盖
一次 participant collection。`resolveEventAnalysisIdentities()` 虽然共享 working
Registry，却为每个 Event 重新创建上述 local map。因此：

- 同一 `mention_id` 在同一 Event 的重复记录会被重复注册后触发
  `RAW_IDENTITY_CONFLICT`，并以 atomic failure 结束；
- 同一 `mention_id` 在不同 Event 中可能被分配两个不同 canonical ID；
- Event B 的 pregnancy reference 不能引用只在 Event A participant 中出现的 mention。

这是当前最重要的 Runtime identity gap。当前单 Event 内 raw pregnancy reference
经过 `canonicalReference()` 可正确转换；但跨 Event 需要 response-global map。

主要证据：`core/identity.js:1223-1360,1365-1381,1402-1550`。只读 probe 已确认跨
Event 同一 mention 可变成两个 ID，且跨 Event raw reference 会返回
`UNKNOWN_REFERENCE`。

## 4. Proposed identity resolution

保持现有轻量模块边界，不新增 Registry/Repository/Service 层：

1. `findPreviousSuccessfulBioWeave()` 返回严格合法的 previous owner snapshot；若
   Registry 缺失/不合格则继续向前扫描，不能用 Chat projection 补齐。
2. Runtime clone previous Registry 为 working Registry；只在本次 resolution 中修改。
3. 只有 exact `^char_[0-9]{6}$` 且序号为 `1..999999` 的 Registry key/entry 才是合法
   Registry 身份并参与 max；旧或任意其它格式不属于当前正式 Contract，不提供兼容读取。
4. `nextSequence = max(valid sequence) + 1`，空 Registry 从 1 开始；每次分配立即写入
   working Registry，并在同一 resolution 内递增。达到上限时 fail closed。
   不填洞、不读姓名、不读时间/随机数、不保存全局 counter/tombstone；达到上限时
   fail closed。
5. 在 `resolveEventAnalysisIdentities()` 层维护一个 response-global
   `mention_id -> canonical character_id` map，以及覆盖所有 Event 的 raw reference
   map。第一次遇到 new mention 才注册；同一 mention 后续复用同一 ID，不得再次注册。
   发生 supplied canonical ID 冲突或明确矛盾证据时整批失败。不同 mention 即使同名也
   不自动合并，除非已有明确且确定的 identity evidence。
6. `existing` supplied ID 必须先通过 previous Registry membership。若不在 Registry，
   拒绝 supplied 值，并对 `display_name`/允许的 alias 做 exact match：唯一候选才
   canonicalize，0 或多个候选均 fail closed；不把姓名写成 Registry key，也不把
   existing 静默转换成 new。
7. new participant 的非 null `character_id` 继续拒绝，保持当前
   `PROVISIONAL_ID_NOT_ALLOWED`；Runtime 只从 working Registry 分配正式 ID。
8. canonical Event 的 participants 与 pregnancy 两个 ID 数组在 commit 前统一完成
   remap；持久化 Event 不依赖 mention。保留当前 canonical normalization 删除临时
   `mention_id` 的行为，不修改 Event schema；若未来必须显示字段，可只保留
   `mention_id: null`，但不能把它作为身份来源。
9. 所有关键解析、reference remap、validation 完成后才保存 Floor；失败只保留当前
   owner 的上一份 successful `analysis/events/character_registry`。

## 5. Lifecycle decision

中间楼层删除采用当前 Data Lifecycle Contract 的 B 路径：删除/历史截断找到最早受影响
Floor，清除删除 owner，并使其后的 active-path Floor analysis、Events、Registry
snapshot 和 derived projection 失效，再从 surviving owners 重建。Floor 9 不能在其
因果 Floor 6 被删除后继续被视为原样 valid；不能为 Registry 单独保留一条不同的历史。

当前代码已有 `invalidateMutation()` 的下游清除实现，但
`AUTO_ANALYSIS_EVENTS` 缺少 `MESSAGE_DELETED`，导致宿主实际删除事件在 coordinator
入口以 `unsupported-event` 返回，后面的 deletion branch 不可达。`runtime/events.js`
已绑定并转发 `MESSAGE_DELETED`，最小修复落点是 coordinator 路由/回归测试，而不是
另建 Registry 删除机制。

编辑、生成、Swipe 切换/删除、owner/version 变化、异步 late result、Chat switch 和
reset boundary 均继续复用已有 Floor Version、epoch、owner assertion 和 active-path
重建。Character/World clear 保留有效 Floor identity snapshots，但 reset boundary
阻止 previous lookup 穿越；因此边界之后可以按 surviving history 从
`char_000001` 重新开始，这是设计允许的回滚，不是 tombstone。

主要证据：`runtime/event-analysis.js:626-665,1769-1807`、
`runtime/events.js:22-32,1051-1124`、`docs/bioweave-data-lifecycle.md:668-721`、
`.trellis/spec/domain/floor-state.md:254-276`。

## 6. 不变项

- 不新增 global Registry、Chat-global counter、独立文件/localStorage/extensionSettings
  identity database 或 Character Card Registry。
- 不改变 Event 领域 schema、UI 生成逻辑或 tracking 的业务资格边界。
- 不绕过 `storage/store.js` 直接把 Floor 事实写入 host message。
- 不把 `character_profiles`、Character Card、Worldbook、Persona、World Model 或其它
  Chat 的名字当作 existing identity 来源。
- `existing_bioweave` 继续作为 `{analysis, events}`，canonical Registry 继续作为
  `analysisInput.character_registry` 顶层字段；这与当前 builder/test 事实一致，避免
  为本次 ID 修复引入输入 DTO 迁移。
