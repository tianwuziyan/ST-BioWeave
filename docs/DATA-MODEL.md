# BioWeave 数据模型

## Extension Level
`SillyTavern.getContext().extensionSettings.bioweave`：插件级 API Profiles、Secret 引用、四个分析任务的 Profile 选择，以及全局 `api_request_settings: {timeout, retry_count}`。超时以整数毫秒保存（250–600000），重试次数保存为 0–3 的整数；两者不属于 Profile 或 Chat 数据。

最近剧情的全局正则也属于插件级配置，仅保存规则本身，不保存读取楼数或正文：

```json
{
  "recent_story_global": {
    "regex_rules": [
      {"pattern": "/正则/", "type": "extract", "enabled": true}
    ]
  }
}
```

全局正则适用于所有角色卡，并在分析输入收集时先于当前 Chat 的角色卡正则执行。

同一层的 `analysis_prompt` 保存所有 AI Analysis 共用的用户可编辑 `system_top`、公共 `task`、`input_prefix`、`input_suffix`、`system_bottom` 和输入分段标签，不保存 AnalysisInput 正文或 API Key。旧 `world_analysis_prompt` 只作为读取迁移来源；保存后只写 `analysis_prompt`。`system_top` 和 `system_bottom` 为空时不生成额外 SYSTEM 消息；固定 Core、任务契约、输出 JSON Contract 和结果校验不由该设置覆盖。Event participant 的 `event_role` 只能使用 Domain enum；`reproductive_capabilities_used.*` 为 `true | false | null`；`pregnancy_relevance.relevant` 与 `possible_conception` 为 boolean；`gestational_subject_ids` 与 `counterpart_ids` 为数组；`participant.evidence` 与 `source_evidence` 为 `{kind, text}` 对象数组；`physical_effect.gestational_substance_intake` 只能是 `true | false | null`。

Profile 只保存非秘密连接配置和不透明的 `secret_ref`；API Key 由 SillyTavern Secret Store 保存，不能进入 Chat、Floor、Event、Snapshot、Projection、Log、Export 或 Prompt Inspector。

## Chat Level
`chat_metadata.bioweave`：当前 Chat 的 WorldModel、CharacterProfiles、Relationships、Settings、Indexes。API Profiles 不属于 Chat 数据。

World Model v1 保存在 `world_model`，只包含经过规范化的生物学世界规则。顶层固定为 `schema_version`、`species`、`medical_context`、`exceptions` 和 `unknowns`；`biological_types` 只能嵌套在对应的 `species[].biological_types[]` 中，species 不承载合并 capabilities。species 识别与 biological type 识别分开：完整 AnalysisInput 只有在明确出现普通人类，或综合上下文可靠支持普通人类作为默认生物背景且没有独立非人类/冲突生理证据时，才可以建立“人类” species；缺少 species 名称不是无条件回退，也不因识别出人类自动补齐任何 biological type。类型只来自 AnalysisInput 实际出现或规则明确描述存在的分类。固定双性分类的显示名称为“双性”，临时双性化、身体改造、个人模糊状态和种族/属性/来源别名不构成 biological type。明确的非人类证据分别建立对应 species；类型名称保持开放，可表达资料实际定义的分类，不自动生成类型组合。非人类 biological type 必须有同一 species 上下文中的直接证据或唯一、低推断的语义证据，不能用另一个 species 的男性/女性证据跨 species 授权。每个 biological type 的 `capabilities` 仍按证据或适用的人类基线逐项保存 `true`、`false` 或 `null`，不能由名称、性别、代词、称谓、外貌或身体形态触发补全；`reproduction_rules`、`lifecycle` 和 `special_rules` 也都属于具体 biological type。非人类的每个能力和规则字段都必须分别通过对应 AnalysisInput 证据；没有证据时为 `null`，不复制现实人类模板。人类基线按字段使用，优先级为明确当前个体事实 > 明确转化后/特殊体系规则 > 明确世界/世界书规则 > 可靠推断出的人类基线 > 未知；delta 只覆盖明确变化的字段，未变化的稳定基础继续保留。明确的人类等价规则也只支持明确覆盖的字段。AI 分析结果会在结构规范化后执行证据边界清理，手动编辑只执行结构规范化，因此手动修订仍可保存来源未自动识别的合法开放类型。顶层 `medical_context` 记录当前世界医疗条件、生育难易度和证据。`world_model_meta` 只保存最后分析/保存时间、保存方式和来源数量摘要。World Model 的分析输入正文只在当前页面内存中临时生成，不写入 Chat metadata。用户人物设定仍可用于通用 AnalysisInput 预览，但不作为 World Model 世界规则判断依据。

`chat_metadata.bioweave.settings.worldbooks` 只保存当前 Chat 的世界书来源选择：`mode` 与 `selected` 中的稳定子项标识。世界书条目使用 `{source_id, entry_id, enabled}`，角色卡字段使用 `{source_id, field_key, enabled}`。来源名称、宿主 file 内容、请求头和 token estimate 不持久化；选择也不等于最终 BioWeave Context 注入。

AI 原始返回只在当前分析调用中存在；若启用开发调试 trace，只临时保存在当前页面内存并显示在设置页高级/调试区域，不进入 Chat metadata、Floor、Event、Snapshot、Projection、Context 或 World Model schema。

最近剧情和外部记忆是同一 Chat 下的独立配置，不属于世界书来源目录：

```json
{
  "recent_story": {
    "floor_count": 20,
    "regex_user_enabled": false,
    "regex_rules": [
      {"pattern": "/正则/", "type": "extract", "enabled": true}
    ]
  },
  "external_memory": {
    "anima": false,
    "baobaoshu": false,
    "database_memory": false
  }
}
```

`recent_story.regex_rules` 是当前 Chat/角色卡范围的规则，保留既有 Chat-local 数据；既有规则不会自动升级为全局规则。读取楼数和是否处理 USER 楼也只属于当前 Chat。最终执行顺序固定为：插件级 `recent_story_global.regex_rules`，然后当前 Chat 的 `recent_story.regex_rules`。

最近剧情不再提供单独的读取开关；`floor_count` 大于 0 时读取最近楼层，填写 `0` 时不读取。旧数据中的 `enabled` 仅作为兼容字段，不再参与读取判断。

外部来源的可用状态只存在 UI 运行时；未确认公开接口的来源可以显示为不可用，但不会伪造读取或写入能力。

分析来源的 `source_type` 至少区分 `character_card`、`worldbook` 和 `recent_story`。真正的 SillyTavern Worldbook 使用稳定 `file_id`/`source_id`，条目使用宿主稳定 `uid`/`id`/对象 key，显示名称和条目标题都不是唯一 ID。

## World Model 规则字段语义

World Model 规则字段使用统一三态语义：`null` 表示未知、未提及、证据不足或无法判断；`"无"` 表示已经知道机制不存在、能力不具备或规则不适用；非空字符串表示已知存在对应机制。没有资料不能写成 `"无"`。普通 Human Male/Female 已建立后可以使用现实 baseline：Male 的 `pregnancy_or_carrying`、`cycle`、`ovulation`、`gestation`、`labor` 为 `"无"`，Female 的 `cycle`、`ovulation`、`gestation`、`labor` 使用简洁的普通 Human 描述；明确世界/个体规则按 Baseline + Delta 逐字段覆盖，Human baseline 只在当前字段为 `null` 时补值，不覆盖 `true`、`false`、`"无"` 或非空描述。独立的明确结构冲突仍可由 Final Consistency Guard 修正为已知 absence。Human species 的显示 canonical name 为“人类”，仅合并明确的 Human 显示别名，不建立其它 species 的同义词 registry。schema 不因该语义扩展，仍使用现有 `string | null` 字段。

## Phase 2A：BiologicalEvent 与 Tracking Subject

本节是已批准的 Phase 2A 数据契约。它描述实现必须保持的边界；契约、代码接入和真实 SillyTavern 验收是不同层次，文档不把其中任一层自动等同为已完成的端到端闭环。

### 人物列表语义与进入条件

人物列表不是当前 Chat 的全角色列表，只展示当前 Chat 中已经进入妊娠相关追踪流程的 active Tracking Subjects。普通聊天角色、当前主卡角色、出现过的名字和仅被事件提及的参与者不会自动进入列表。

创建或更新 Subject 必须同时有：

1. 真实或可靠识别的 `sexual_activity` BiologicalEvent；
2. Event 参与者实际存在，并有稳定的 `character_id`；
3. World Model 与 Narrative Evidence 对相关 reproductive capability 提供支持；
4. 本次事件存在实际受孕暴露可能。

`gender`、攻受/receiver 文本、姓名、代词和 UI 选择都不能替代上述判断。`true`、`false`、`null` 三态 capability 必须保留；`null` 表示 unknown，不能自动变成 `true`。非 NSFW、没有受孕暴露、能力未知或明确不具备承载能力的 Event 都不能建立 Subject；NSFW 本身、症状或猜测也不能自动变成 conception / pregnancy。一个 Event 可以产生 0、1 或多个 Subject；一个 Subject 可以累积多个 exposure Event。

### BiologicalEvent：完整事实的单一来源

BiologicalEvent 是当前范围内实际生物事实（尤其是 conception-relevant reproductive exposure）的单一来源，不是完整 NSFW 行为日志。Tracking Subject 不复制完整 Event；它只保存稳定人物索引、active 状态和有效 Event 的 `event_id` 引用。人物详情需要展示事件事实时，必须沿引用读取当前有效 Event，不能在人物索引中另存一份事件正文，也不建立 Chat-level 唯一事件大数组。

本阶段保留现有其它 BiologicalEvent 类型的兼容性，但只实现 `sexual_activity` 的妊娠相关 Tracking 闭环。`conception`、`pregnancy_suspicion`、`pregnancy_confirmation`、`pregnancy_loss`、`abortion`、`labor`、`delivery`、`postpartum`、`menstrual_event`、`ovulation_event`、`fertility_change`、`physical_symptom`、`medical_event` 和 `other_biological` 等类型仍可被领域层接受或展示，但不能因为类型存在就自动创建 Subject。

### BiologicalEvent 固定结构

每个进入 Floor 的 Event 至少包含以下字段：

| 字段 | 语义 |
| --- | --- |
| `event_id` | Event 稳定标识；Registry 只通过它引用 Event。 |
| `type` | 现有 BiologicalEvent 类型；本阶段以 `sexual_activity` 为 Tracking 入口。 |
| `status` | Event 状态；`negated` / `fictional` 不得成为受孕追踪事实。 |
| `location` | 事件地点，允许未知值按领域规范化处理。 |
| `participants[]` | 对 `sexual_activity` 只包含 actual reproductive exposure chain 的直接参与者；其它 Event 只包含对该生物事实直接有作用的对象。每项至少包含 `character_id`、`display_name`、`event_role`、`reproductive_capabilities_used` 和 `evidence`。 |
| `pregnancy_relevance` | 至少包含 `relevant`、`possible_conception`、`gestational_subject_ids[]`、`counterpart_ids[]`、`confidence`。 |
| `source_evidence` | 支撑 Event 的当前楼层/上下文证据摘要。 |
| `source` | 产生事实的 Chat、Message、Floor、Swipe 和 Floor Version 绑定。 |
| `story_time` | 结构化故事时间，不能只保存展示字符串。 |

`event_role` 是事件语义，不是性别或生物学能力的替代品；可以使用 `potential_gestational_subject`、`potential_conception_source`、`other_participant`、`unknown` 等角色。对妊娠相关 `sexual_activity`，完整有效阻隔未进入有效路径、体外或其它无有效路径的排出、仅插入和仅身体接触都不产生妊娠相关参与者；保护动作只是证据，最终实际暴露结果优先，破裂、脱落或摘除后实际进入有效路径时才保留对应 source。`biological_context` 只在有对应 World Model/species 证据时作为最小上下文保存，不由名称或常识补全。

`reproductive_capabilities_used` 的字段使用 `true | false | null`。只有明确的 `can_carry_pregnancy === true`、真实受孕暴露和有效 Event 共同满足时，相关参与者才能成为 gestational Subject；只靠 event role、gender、NSFW 状态、症状或自然语言猜测不能授权 Subject。`possible_conception === true` 时，`relevant` 必须为 true，两个 ID 数组都必须非空、每个 ID 都必须来自 `participants[]`，`participants[]` 只能包含这些 subject/source，且 `source_evidence[]` 必须包含 kind 为 `conception_relevant_exposure` 的结构化证据。没有实际暴露的 `sexual_activity`（若保留）必须没有 participants，使用 `relevant=false`、`possible_conception=false` 和两个空数组。

`counterpart_ids` 与 `gestational_subject_ids` 永远是数组，允许 `[]`、单项或多项；不得保存为逗号分隔字符串，也不得用姓名代替稳定 `character_id`。`counterpart_ids[]` 是 `participants[]` 的子集，只记录最终实际造成 conception-relevant exposure 的 source ID，不表示所有性伴侣、在场者、能力具备者或所有曾出现的对象。

AI Event Output 与持久化 Domain Event 分层：AI 只返回 `schema_version: 1`
和 `events[]` 中的生物学事实，不需要生成 `event_id` 或 `source`。为兼容
旧响应，顶层单独出现的 `source` 以及 Event 内的 `event_id`/`source` 会被
忽略；其它未知顶层字段仍按固定 Contract 拒绝。Runtime 在解析成功后按
authoritative Floor Version 与响应序号生成稳定 `event_id`，再绑定下面的
六字段 `source`，随后才执行 Domain normalize / validate 并写入 Floor。

### Source binding 与 Floor / Swipe

Event 的 `source` 必须由当前分析目标的 authoritative Floor Version 写入，不能信任 AI 返回的跨作用域身份。固定字段为：

```json
{
  "chat_id": "当前 Chat",
  "message_id": "产生事件的消息",
  "floor": 12,
  "swipe_id": 0,
  "content_hash": "当前消息正文的 SHA-256",
  "message_version": "当前消息版本"
}
```

没有 swipe 结构时，Event 保存到 `message.extra.bioweave`；存在 swipe 结构时，包括 swipe `0`，只能保存到对应 `message.swipe_info[swipe_id].extra.bioweave`。Floor `events[]` 是该消息/版本的 Floor-bound 事实集合，不是 Chat-level 历史事件账本。删除 Floor 后其 Event 必须消失；切换到没有事件的 Swipe 后旧 Swipe Event 不得参与当前有效状态。

自动分析沿用 `analysis_interval` 的 N-floor 规则与六字段 Floor Version：同一成功版本跳过，版本变化允许重新分析；失败可重试；UI mount/open/reopen/init 不触发新的 AI 请求。手动刷新始终强制请求，成功后替换该 Floor Version 的旧成功 Event，失败保留旧成功结果，但旧版本 Event 不能进入当前有效 Registry。Event 编辑直接修改当前有效事实，保存时保留 `event_id` 与 authoritative `source`；Event 删除是真删除，不产生 `user_override` 层。

### Story Time

Story Time 采用结构化 DTO：

```json
{
  "display": "2026-08-20",
  "normalized": "2026-08-20",
  "calendar_id": "calendar_main",
  "day_index": 20685,
  "provider": "bioweave_fallback",
  "precision": "day",
  "confidence": 1
}
```

字段可为 `null`，尤其是无法可靠获得 `normalized` 或 `day_index` 时不得伪造准确日期。优先使用可用的 SevenDaysCal 公开 Story Time Adapter；不可用时使用 BioWeave Fallback StoryTimeProvider。Adapter 只依赖公开 context 或注入的 provider，不读取 SevenDaysCal 私有 Store。

`display` 只由 formatter 用于 UI 展示，不是存储格式，也不得被任何排序或计算逻辑反向解析。模糊时间仍可保存 display、`precision` 和 `confidence`，但不制造 `day_index`。本阶段不实现妊娠天数、Gestational Age 或预计分娩日。

### Tracking Subject Registry

Registry 保存在当前 Chat 的 `chat_metadata.bioweave`，是人物列表的唯一来源。Subject 的索引形状如下：

```json
{
  "tracking_subjects": {
    "char_A": {
      "character_id": "char_A",
      "display_name": "A",
      "created_from_event_id": "evt_001",
      "exposure_event_ids": ["evt_001", "evt_008"],
      "status": "active"
    }
  }
}
```

`created_from_event_id` 与 `exposure_event_ids[]` 必须指向当前有效 Event；Registry 重建时去重并清理 dangling 引用。同一角色多次事件复用同一个 Subject 并累积多个 exposure 引用，一个 Event 可以关联多个 Subject。只有真正进入 Tracking 的角色才建立必要的 `character_profiles` 最小资料或证据摘要；这些资料不替代历史 Event，也不复制完整事实，普通聊天角色不进入通用生理数据库。

没有有效 exposure Event 且没有后续 pregnancy/delivery 等状态时，Subject 从 active 人物列表移除；必要的无事件 profile 可作为非展示历史保留，直到后续任务定义清理策略。Floor 删除、Swipe 切换、Event 编辑/删除、Chat 切换或手动刷新后，都必须依据当前有效 Event 集合重建 Registry。

`BiologicalEvent.participants[]` 与 Tracking Subject 是两个不同层次的业务对象。前者在 `sexual_activity` 中只记录 actual reproductive exposure chain 的直接参与者，其中 `counterpart_ids[]` 标记实际 exposure source；后者只表示 Core 根据受孕暴露、事件相关性和生殖能力计算后正式进入追踪流程的角色。参与者的 profile 存在也不代表该角色是 Tracking Subject。

`explainTrackingDecision(event)` 与正式 Registry 构建共享同一条 Core 判定路径，返回 `{character_id, eligible, reasons[]}`。Reason code 只用于 Core、Runtime 的诊断、Debug 或 Analysis Detail，例如 `CAN_CARRY_PREGNANCY_UNKNOWN`、`POSSIBLE_CONCEPTION_FALSE` 或 `NOT_GESTATIONAL_SUBJECT`；它不是第二套 eligibility 规则，也不是人物实体，普通 Characters UI 不读取或展示这些诊断。

Event Analysis 的运行状态由 Runtime coordinator 组合为 transient/read DTO，而不是第二套事实存储。DTO 同时区分当前 Floor 的 `event_count/current_floor_events` 与当前 Chat 的 `active_event_count/active_events`，并带有 Floor Version、attempt、last success/error、Tracking 数量、decision diagnostics 和脱敏 Registry 摘要。`running` 只表示当前 transient execution；持久分析记录保存成功结果或最后一次失败/取消尝试，失败刷新不覆盖 `last_success`。Runtime 以完整 Floor Version 持有 `AbortController` 和 in-flight Promise；取消、超时、stale Chat、保存失败或 Registry 失败都必须释放执行资源，迟到结果不得提交。Raw AI Response、API Secret、Authorization header 与请求正文不为可观察性写入 Chat。

### 本阶段的空状态边界

Phase 2A 的闭环为：

```text
当前剧情 → 固定 Event JSON → normalize / validate
         → Floor-bound BiologicalEvent[]
         → Tracking Subject Registry → Characters / Events / Overview
```

Projection、Genealogy、完整 StateReducer、Snapshot 恢复、Gestational Age、预计分娩日和完整妊娠计算仍是空状态或下一阶段能力。UI 不得从 Event 文本自行计算资格、概率、妊娠状态或时间。

## Floor Level
`message.extra.bioweave` / `message.swipe_info[n].extra.bioweave`：Analysis、Events、Snapshot、Projections；Phase 2A 的 BiologicalEvent 必须遵守上面的 Floor/Swipe source binding。

## 核心链
`Floor Version → BiologicalEvent → Tracking Subject Registry → Characters / Events / Overview → State Reducer → Current State → Snapshot → Projection → Context`。

用户编辑 Event 后，保存后的 Event 就是后续计算使用的数据；删除是真删除。Projection 不进入事实历史，Phase 2A 不提前接通 State/Snapshot/Projection/Genealogy。
