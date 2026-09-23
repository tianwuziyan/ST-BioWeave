# BioWeave 数据模型

## Extension Level
`SillyTavern.getContext().extensionSettings.bioweave`：插件级 API Profiles、Secret 引用、四个分析任务的 Profile 选择，以及全局 `api_request_settings: {timeout, retry_count}`。超时以整数毫秒保存（250–600000），重试次数保存为 0–3 的整数；两者不属于 Profile 或 Chat 数据。`retry_count=N` 是每个 World/Event 完整业务阶段失败后的额外重试次数：首次阶段执行为 `attempt=1/retry_index=0`，因此 N=1 最多两次完整阶段执行；它不是只重放 HTTP 请求，也不取代 Chat Scheduler 的 `retry_failed_analysis`。

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

同一层的 `analysis_prompt` 保存所有 AI Analysis 共用的用户可编辑 `system_top`、公共 `task`、`input_prefix`、`input_suffix`、`system_bottom` 和输入分段标签，不保存 AnalysisInput 正文或 API Key。旧 `world_analysis_prompt` 只作为读取迁移来源；保存后只写 `analysis_prompt`。`system_top` 和 `system_bottom` 为空时不生成额外 SYSTEM 消息；固定 Core、任务契约、输出 JSON Contract 和结果校验不由该设置覆盖。Event participant 的 `event_role` 只能使用 Domain enum；`reproductive_capabilities_used.*` 为 `true | false | null`；`pregnancy_relevance.relevant` 与 `possible_conception` 为 boolean；`gestational_subject_ids` 与 `counterpart_ids` 为数组；`participant.evidence` 与 `source_evidence` 为 `{kind, text}` 对象数组；pregnancy-related `sexual_activity` 的每个 participant 必须包含 `biological_context.species` 与 `biological_context.biological_type`，二者均为 `string | null`；`physical_effect.gestational_substance_intake` 只能是 `true | false | null`。

Profile 只保存非秘密连接配置和不透明的 `secret_ref`；API Key 由 SillyTavern Secret Store 保存，不能进入 Chat、Floor、Event、Snapshot、Projection、Log、Export 或 Prompt Inspector。

## Chat Level
`chat_metadata.bioweave` 只保存当前 Chat 的 `schema_version`、`chat_scope`、`settings` 和空的 `data_lifecycle` 保留根。API Profiles 不属于 Chat 数据。人物 profiles、Tracking Registry、关系/索引等均为 Runtime DTO，不写入 Chat；World Model 的权威状态也不在 Chat Level。

## Floor Level
`message.extra.bioweave` 或当前结构化消息的
`message.swipe_info[swipe_id].extra.bioweave` 同时承载不同业务域的 Floor
字段。`world_model` / `world_model_meta` 属于 World Model owner；
`analysis` / `events` / `character_registry` / `snapshot` 属于
Character/Event owner。`snapshot` 是由 Current State 派生出的缓存检查点，
不是新的事实来源，也不能替代或删除 `events`。

Projection timeline 同样属于当前 Character Floor/active Swipe，但与 Event、State
和 Snapshot 分离。其持久化根为：

```json
{
  "schema_version": 1,
  "creations": [],
  "evidence_records": [],
  "lifecycle_records": []
}
```

`creations` 保存 Projection creation DTO；`evidence_records` 和
`lifecycle_records` 只保存后续 Floor 的 append-only 记录。Current Projection View
只从当前 Chat 中 surviving、active Swipe 且 Floor Version 有效的 Character Floors
聚合，不写入 Chat metadata，也不进入 Snapshot 或 StateReducer。

Snapshot 的最小结构为：

```json
{
  "schema_version": 1,
  "checkpoint": {
    "chat_id": "chat-id",
    "message_id": "message-id",
    "floor": 12,
    "swipe_id": 0,
    "content_hash": "sha256",
    "message_version": "v1"
  },
  "state": {
    "schema_version": 1,
    "characters": {},
    "processed_event_ids": [],
    "diagnostics": []
  }
}
```

Snapshot 只能写在拥有该 checkpoint 的 Character/assistant Floor：无 Swipe
结构使用 `message.extra.bioweave`，有 Swipe 结构（包括 Swipe 0）使用
`message.swipe_info[swipe_id].extra.bioweave`。User message、Chat metadata 和
其它 Swipe 都不是 Snapshot owner。读取时必须验证当前 Chat、active Swipe 和
完整六字段 Floor Version；失败、损坏或不存在时回退 full replay。默认检查点
间隔按有效 Character Floor 序列计数，不按 User message 或宿主 message floor
数字取模。Snapshot 不保存 AI 响应、Prompt、概率、Projection、UI 状态、随机
结果或系统时间；restore 只把 `snapshot.state` 作为 `reduceState({baseState})`
的 base state，并继续归约后续有效 Events。

### Phase 2D-2 Projection Eligibility / Evolution

Projection 是基于有效 BiologicalEvent、Current State、Story Time、World Model
mechanism 和 Character Facts 产生的未来可能生物发展方向，不是事实、Current
State 或 Snapshot。Phase 2D-1 只定义纯 Core DTO 和 timeline reducer；尚未把
Projection 已接入 Floor timeline read path 与只读 Runtime Context Injection；仍不进入
StateReducer、Snapshot 或 UI 持久化。

第一版 development kind 只有 `possible_biological_change`、`possible_detection`、
`mechanism_progression`、`no_obvious_change` 和 `monitoring_signal`。Projection identity
只由 Chat scope、subject、`projection_rule_id` 和 `development_concern_key` 组成；
`source_event_ids` 只是 provenance。后续 source evidence 使用独立的 append-only
evidence record，不能回写创建 Floor。

后续变化由独立的 `ProjectionLifecycleRecord` 表达：`realized`、`contradicted`、
`expired` 是 factual lifecycle，`deleted` 是独立的用户可见性维度。同一 timeline
position 的 factual 冲突必须 fail closed，不能使用枚举优先级。生命周期聚合只读取
canonical surviving Character Floor timeline。第一版不实现 Probability 或 RNG，Story
Time-only 变化只负责 development eligibility。

Exposure Fact、Projection、Contributor Attribution 是三个不同层次。Candidate 是由
exposure 与 World Model compatibility 派生的 read model；只有 `confirmed` / `excluded`
的 `reproductive_source_attribution` BiologicalEvent 才能改变 contributor attribution，
允许多个 confirmed contributors，`unresolved` 是合法状态。

`core/projection-eligibility.js` 只执行 World Model 提供的
`projection_rules[]`。它输出三态 `eligible`、`not_eligible`、`unresolved` decision；
Story Time 只决定 trigger eligibility，不产生 BiologicalEvent 或 pregnancy fact。
Evolution 只有在规则定义的 confirmed factual realization/contradiction/expiration
criteria 满足时，才输出对应生命周期决策。正文沉默、时间经过、概率和 Candidate
选择都不能改变事实层；该模块仍不负责 AI、Persistence 或 Context Injection。

Floor 是 storage container，不代表业务代码合并。World Model 保存必须
preserve Character/Event 字段；Character/Event 保存必须 preserve World
Model 字段；只有明确的完整 Floor lifecycle invalidation 才能跨域同时清除。

World Model v1 保存在 `world_model`，只包含经过规范化的生物学世界规则；顶层固定为 `schema_version`、`species`、`medical_context`、`exceptions`、`unknowns` 和 `projection_rules`。`biological_types` 只能嵌套在对应的 `species[].biological_types[]` 中，species 不承载合并 capabilities。species 识别与 biological type 识别分开：完整 AnalysisInput 只有在明确出现普通人类，或综合上下文可靠支持普通人类作为默认生物背景且没有独立非人类/冲突生理证据时，才可以建立“人类” species；缺少 species 名称不是无条件回退，也不因识别出人类自动补齐任何 biological type。类型只来自 AnalysisInput 实际出现或规则明确描述存在的分类。固定双性分类的显示名称为“双性”，临时双性化、身体改造、个人模糊状态和种族/属性/来源别名不构成 biological type。明确的非人类证据分别建立对应 species；类型名称保持开放，可表达资料实际定义的分类，不自动生成类型组合。非人类 biological type 必须有同一 species 上下文中的直接证据或唯一、低推断的语义证据，不能用另一个 species 的男性/女性证据跨 species 授权。每个 biological type 的 `capabilities` 仍按证据或适用的人类基线逐项保存 `true`、`false` 或 `null`，不能由名称、性别、代词、称谓、外貌或身体形态触发补全；`reproduction_rules`、`lifecycle` 和 `special_rules` 也都属于具体 biological type。非人类的每个能力和规则字段都必须分别通过对应 AnalysisInput 证据；没有证据时为 `null`，不复制现实人类模板。人类基线按字段使用，优先级为明确当前个体事实 > 明确转化后/特殊体系规则 > 明确世界/世界书规则 > 可靠推断出的人类基线 > 未知；delta 只覆盖明确变化的字段，未变化的稳定基础继续保留。明确的人类等价规则也只支持明确覆盖的字段。AI 分析结果会在结构规范化后执行证据边界清理，手动编辑只执行结构规范化，因此手动修订仍可保存来源未自动识别的合法开放类型。顶层 `medical_context` 记录当前世界医疗条件、生育难易度和证据。`world_model_meta` 只保存最后分析/保存时间、保存方式和来源数量摘要。World Model 的分析输入正文只在当前页面内存中临时生成，不写入 Chat metadata。用户人物设定仍可用于通用 AnalysisInput 预览，但不作为 World Model 世界规则判断依据。

`chat_metadata.bioweave.settings.worldbooks` 只保存当前 Chat 的世界书来源选择：`mode`、`selection_initialized` 与 `selected` 中的稳定子项标识。首次默认快照只自动选择 `character_card` 角色卡自身世界书；`character` additional Lorebooks 仍是可展示、可手动选择并可进入分析输入的来源，但不属于首次默认范围。`selection_initialized` 表示首次默认快照是否已成功保存，与 `selected` 是否为空、World Model 是否存在或分析是否成功无关。世界书条目使用 `{source_id, entry_id, enabled}`，角色卡字段使用 `{source_id, field_key, enabled}`。来源名称、宿主 file 内容、请求头和 token estimate 不持久化；选择也不等于最终 BioWeave Context 注入。

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

已规范化 DTO 的再次读取/编辑只能通过明确的 trusted
`normalizeStoredWorldModel()` 路径；raw AI schema 与 normalized domain DTO 不混用。

World Model v1 的顶层也正式包含 `projection_rules: []`。它是当前 Floor 所有的声明式机制规则集合，不是 Projection 实例。AI/raw rule content 不输出 `projection_rule_id`；每条 raw rule 只包含业务内容，由 BioWeave 在规范化阶段生成 ID 后形成完整 domain DTO。每条最终规则包含 `schema_version`、`projection_rule_id`、`mechanism_key`、`development_concern_key`、`development_kind`、`trigger`、`requirements`、`realization`、`contradiction` 和 `expiration`；规则必须先通过 `validateProjectionRuleContent()`、`normalizeProjectionRules()` 与 final validation，再随 `world_model` 保存。规则不得包含概率、RNG、Prompt、AI 原文、妊娠结果或可执行代码。没有可验证规则时保存空数组，Eligibility 保持无可用规则，不使用现实人类 timing fallback。`projection_rule_id` 由规范化规则材料稳定生成，source Event 证据属于 Projection provenance，不属于 World Model rule identity。

World Model 规则字段使用统一三态语义：`null` 表示未知、未提及、证据不足或无法判断；`"无"` 表示已经知道机制不存在、能力不具备或规则不适用；非空字符串表示已知存在对应机制。没有资料不能写成 `"无"`。普通 Human Male/Female 已建立后可以使用现实 baseline：Male 的 `pregnancy_or_carrying`、`cycle`、`ovulation`、`gestation`、`labor` 为 `"无"`，Female 的 `cycle`、`ovulation`、`gestation`、`labor` 使用简洁的普通 Human 描述；明确世界/个体规则按 Baseline + Delta 逐字段覆盖，Human baseline 只在当前字段为 `null` 时补值，不覆盖 `true`、`false`、`"无"` 或非空描述。独立的明确结构冲突仍可由 Final Consistency Guard 修正为已知 absence。Human species 的显示 canonical name 为“人类”，仅合并明确的 Human 显示别名，不建立其它 species 的同义词 registry。schema 不因该语义扩展，仍使用现有 `string | null` 字段。

## Phase 2A：BiologicalEvent 与 Tracking Subject

本节是已批准的 Phase 2A 数据契约。它描述实现必须保持的边界；契约、代码接入和真实 SillyTavern 验收是不同层次，文档不把其中任一层自动等同为已完成的端到端闭环。

### 人物列表语义与进入条件

人物列表不是当前 Chat 的全角色列表，只展示当前 Chat 中 `eligibility: "eligible"` 的 active Tracking Subjects。普通聊天角色、当前主卡角色、出现过的名字和仅被事件提及的参与者不会自动进入列表；有 exposure 但能力未知的 recipient 保留在后台 `tracking_candidates` pending 中。

创建或更新 Subject 必须同时有：

1. 真实或可靠识别的、带有 pregnancy-relevant exposure 事实的 BiologicalEvent；
2. Event 参与者实际存在，并有稳定的 `character_id`；
3. World Model 与 Narrative Evidence 对相关 reproductive capability 提供支持；
4. 本次事件存在实际受孕暴露可能。

`gender`、攻受/receiver 文本、姓名、代词和 UI 选择都不能替代上述判断。`true`、`false`、`null` 三态 capability 必须保留；`null` 表示当前未知，不能在当前解析中被当作 `true` 或 `false`，但后续可信 World Model/profile/narrative evidence 更新可以重评 pending candidate。非 NSFW、没有受孕暴露或明确不具备承载能力的 Event 不建立 Subject；能力未知的有效 exposure 保存为 pending candidate；NSFW 本身、症状或猜测也不能自动变成 conception / pregnancy。一个 Event 可以产生 0、1 或多个 Subject；一个 Subject 可以累积多个 exposure Event。

### BiologicalEvent：完整事实的单一来源

BiologicalEvent 是当前范围内实际生物事实（尤其是 pregnancy-relevant reproductive exposure）的单一来源，不是完整 NSFW 行为日志。Tracking Subject 不复制完整 Event；它只保存稳定人物索引、active 状态和有效 Event 的 `event_id` 引用。人物详情需要展示事件事实时，必须沿引用读取当前有效 Event，不能在人物索引中另存一份事件正文，也不建立 Chat-level 唯一事件大数组。

Event Analysis V1 的输入单位是一个 Target Floor Version，但一个分析响应可以产生
零个、一个或多个彼此独立的 Event：

```text
One Target Floor Version → 0 / 1 / N BiologicalEvents
```

对于 pregnancy-related `sexual_activity`，Event 的粒度是一个 gestational subject
在本 Floor Version 中的一组实际 pregnancy-relevant exposure。先识别所有实际
发生暴露的 subject，再按 subject 分组：每个 Event 的
`gestational_subject_ids.length === 1`，并且 `counterpart_ids[]` 只包含实际对该
subject 造成暴露的一个或多个 source。participant ID 集合必须严格等于该 subject
与这些 counterpart 的并集，不能混入另一个 subject、另一组 source、在场人物或无
实际暴露的 sexual participant；同一 subject 在同一 Floor Version 最多一个该类
Event，多个 source 合并进该 Event。不同 subject 即使时间、地点、行为和 Event
type 相同，也必须分别成 Event。两个 subject 之间的互相 exposure 仍可形成两个
彼此独立的 subject-local Event。

同一 subject 的 sexual exposure、即时 physical effect、直接身体反应和相关证据
保持在同一个 Event 内，不机械拆成独立 `physical_symptom`。其它真正独立的新症状、
明确医疗检查/诊断/治疗/给药/干预/医学监测或其它 BiologicalEvent 可以在同一
Floor 并存。普通照顾、送汤、食物、补品和静态外貌/体质背景不单独创建
`medical_event` 或 `physical_symptom`。Parser、Domain Validator 会拒绝多 subject
Event、重复 subject Event 和不满足 subject-local 闭包的 Event；Runtime 与 UI 不
选择、丢弃、合并或按人物重建 Event。

本阶段保留现有其它 BiologicalEvent 类型，但 Tracking 入口是结构化 pregnancy-relevant reproductive exposure，不依赖单一 Event type。`conception`、`pregnancy_suspicion`、`pregnancy_confirmation`、`pregnancy_loss`、`abortion`、`labor`、`delivery`、`postpartum`、`menstrual_event`、`ovulation_event`、`fertility_change`、`physical_symptom`、`medical_event` 和 `other_biological` 等类型仍可被领域层接受或展示，但不能因为类型存在就自动创建 Subject。

### BiologicalEvent 固定结构

每个进入 Floor 的 Event 至少包含以下字段：

| 字段 | 语义 |
| --- | --- |
| `event_id` | Event 稳定标识；Registry 只通过它引用 Event。 |
| `type` | 现有 BiologicalEvent 类型；Tracking 入口是结构化 pregnancy-relevant reproductive exposure，不依赖单一 Event type。 |
| `status` | Event 状态；`negated` / `fictional` 不得成为受孕追踪事实。 |
| `location` | 事件地点，允许未知值按领域规范化处理。 |
| `participants[]` | 对 `sexual_activity` 只包含 actual reproductive exposure chain 的直接参与者；其它 Event 只包含对该生物事实直接有作用的对象。每项至少包含 `character_id`、`display_name`、`event_role`、`reproductive_capabilities_used` 和 `evidence`；pregnancy-related `sexual_activity` 的每项还必须包含 `biological_context: {species, biological_type}`，两个值均为 `string | null`。 |
| `pregnancy_relevance` | 至少包含 `relevant`、`possible_conception`、`gestational_subject_ids[]`、`counterpart_ids[]`、`reproductive_mechanism`、`confidence`；`relevant` 表示进入未来推演池的资格，`possible_conception` 不表示该资格，也不表示已经 conception。 |
| `source_evidence` | 支撑 Event 的当前楼层/上下文证据摘要。 |
| `source` | 产生事实的 Chat、Message、Floor、Swipe 和 Floor Version 绑定。 |
| `story_time` | 结构化故事时间，不能只保存展示字符串。 |
| `state_fact` | 仅用于非 exposure 的类型化生物事实；固定 envelope 为 `{subject_id, payload}`。`subject_id` 必须是参与该 Event 的 canonical character ID，`payload` 按 Event type 严格校验。有效 pregnancy-related exposure 不重复写入 `state_fact`，仍以 `pregnancy_relevance` 为唯一 exposure fact。 |

`state_fact` 是事实契约，不是 Current State，也不是 Projection。其有效时间直接引用同一 Event 的结构化 `story_time`，不复制第二份时间字段；缺少可靠 `day_index` 时不得进行时间数学。`conception`、`pregnancy_confirmation`、终止、分娩和产后事实通过最小类型 payload 引用稳定的 Chat-local `pregnancy_id`；conception 与后续 pregnancy facts 共用该 episode identity，不另建 `conception_id`。AI 只声明 `new` / `existing` reference，Runtime 以 Floor Version、Event ordinal、subject 和 fact kind 生成确定性 ID。不得使用随机数、系统时间或 UUID。

`pregnancy_suspicion` 保留 suspicion fact，不等价于 confirmed pregnancy；`possible_conception: true` 也不创建 conception fact。`confirmed`、`probable`、`ambiguous`、`negated`、`fictional` 保持独立的 Event status 维度，后两者不能改变 factual Current State。相同 `event_id` 的完全相同事实可以去重；同 ID 不同事实必须报告 conflict，禁止 last-write-wins。

`reproductive_source_attribution` 是独立的 factual state fact，只表达已有 Pregnancy
Episode 的 contributor relationship：`pregnancy_id`、`source_character_id`、
`contribution_kind` 和 `attribution: confirmed | excluded`。StateReducer 将关系聚合到
`pregnancy.episodes[pregnancy_id].contributors`，relationship identity 为
`pregnancy_id + subject_id + source_character_id + contribution_kind`，允许多个
confirmed contributors。Candidate 不进入 Current State；不存在对应 Pregnancy Episode
时 attribution 只产生 diagnostic，不创建 pregnancy/conception。相同 relationship 同时
confirmed 与 excluded 时 fail closed，不使用输入顺序或 last-write-wins。

`event_role` 是事件语义，不是性别或生物学能力的替代品；可以使用 `potential_gestational_subject`、`potential_conception_source`、`other_participant`、`unknown` 等角色。实际 exposure recipient/source 与 `possible_conception` 必须由当前 World Model、匹配 species/type 的 reproduction rules/capabilities 和 Narrative evidence 共同决定；不能把任何现实物种、性别、解剖结构、行为位置或单一现实生殖机制硬编码成所有世界的必要条件。每个 pregnancy-related participant 的 `biological_context.species` 必须来自该人物对应的 World Model species，`biological_type` 表示该 species 下稳定的生理/生殖分类；资料不足时两个字段都填 `null`，不新增 `gender`。AI 可综合 Character Card、Persona、Worldbook、Narrative、Existing profile、稳定设定、身体/生理/生殖事实和多条一致上下文进行映射；明确生理性别事实可以作为 `biological_type` 映射证据之一，但不能单独授权 capability；名称、称谓、外貌、event_role、位置、主动/被动或社会身份等单一弱线索不能单独补全 identity/capability，证据冲突或不足时保持 `null` 并进入 pending。`reproductive_capabilities_used` 必须先依据当前 World Model baseline，再结合已有 character profile 与 Character / Persona / Worldbook / 当前剧情证据判断；个体明确值可覆盖或补充 baseline，未知 capability 保持 `null`。

`reproductive_capabilities_used` 的字段使用 `true | false | null`。只有明确的 `can_carry_pregnancy === true`、实际 pregnancy-relevant exposure 和有效 Event 共同满足时，相关参与者才能成为 `eligible` gestational Subject；明确 `false` 为 `ineligible`，`null`/无法确认必须保存为 `pending` candidate，不能当作 reject 后丢失。`can_be_fertilized === true` 不能单独授权 Subject；只靠 event role、gender、NSFW 状态、症状或自然语言猜测也不能授权 Subject。`relevant === true` 时，两个 ID 数组都必须非空、每个 ID 都必须来自 `participants[]`，`participants[]` 只能包含这些 subject/source，且 `source_evidence[]` 必须包含 kind 为 `pregnancy_relevant_exposure` 的结构化证据。没有实际暴露的 `sexual_activity`（若保留）必须没有 participants，使用 `relevant=false`、`possible_conception=false` 和两个空数组。

`counterpart_ids` 与 `gestational_subject_ids` 永远是数组，允许 `[]`、单项或多项；不得保存为逗号分隔字符串，也不得用姓名代替稳定 `character_id`。对 pregnancy-related `sexual_activity`，`gestational_subject_ids[]` 严格只有一个 ID，`counterpart_ids[]` 至少一个且去重，是 `participants[]` 的 subject-local 子集，只记录最终实际造成该 subject pregnancy-relevant exposure 的 source ID，不表示所有性伴侣、在场者、能力具备者或所有曾出现的对象。

AI Event Output 与持久化 Domain Event 分层：AI 只返回 `schema_version: 1`
和 `events[]` 中的生物学事实，不需要生成 `event_id` 或 `source`。为兼容
旧响应，顶层单独出现的 `source` 以及 Event 内的 `event_id`/`source` 会被
忽略；其它未知顶层字段仍按固定 Contract 拒绝。对于新的 Event Analysis V1，
`events[]` 可包含 0、1 或 N 条；多条合法 Event 按响应序号进入 Runtime，不会被
合并。每个 pregnancy-related `sexual_activity` Event 在 parser/domain boundary
检查唯一 subject、实际 source 与 participants 闭包；同一 Floor 的重复 subject
Event 被拒绝。
Runtime 在解析成功后仍按 authoritative Floor Version 与响应序号生成稳定
`event_id`，再绑定下面的六字段 `source`，随后才执行 Domain normalize / validate
并写入 Floor。响应序号保留是为了兼容 deterministic identity 语义，并保证同一
Floor 的多个 Event 都有稳定且不依赖 display name 的 ID。

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

失败的 force refresh（包括重复 subject 或 subject-local contract failure）只记录
失败尝试，不覆盖同一 Floor Version 的上一份成功分析。已存在的历史数据不在本轮
自动迁移或语义合并；本轮保证新 AI response 在保存边界前满足 0/1/N，并通过
subject-local consistency validation。

自动分析的 Character Floor counter、Floor Version 去重、reroll/Swipe 分类和 retryPaused 规则见唯一权威文档 [Auto Analysis Scheduler Architecture](./AUTO-ANALYSIS-SCHEDULER.md)。本数据模型只保留 Floor/Swipe owner、版本和事实持久化规则；User、编辑、删除和 lifecycle update 不创建新的 Floor 事实。

### Story Time

Story Time 采用结构化 DTO：

```json
{
  "display": "2026-08-20",
  "normalized": "2026-08-20",
  "calendar_id": "calendar_main",
  "day_index": 20685,
  "precision": "day",
  "confidence": 1
}
```

字段可为 `null`，尤其是无法可靠获得 `normalized` 或 `day_index` 时不得伪造准确日期。Story Time 只由 BioWeave 本地 trusted candidate extraction、canonical parser 和 Calendar Engine 计算；不读取外部日期 Store。

`display` 不是排序或计算输入。`parseCnDate()`、传统时辰解析和 Calendar Engine 都是 BioWeave 本地能力；解析失败时保留显示值并返回 `null`，不伪造 `day_index`。本阶段不实现妊娠天数、Gestational Age 或预计分娩日。

公历完整日使用 `YYYY-MM-DD`；传统月份、节日或开放纪年在无法证明连续历法序数时使用 BioWeave 当前 `cn-year-month-day` 规范 key，但 `day_index` 必须保持 `null`。

Custom Calendar 不属于 Event 或 Floor payload。BioWeave 对带 era 的年月日
使用内建标准 12 月月份长度和闰年规则进行 elapsed-time arithmetic；`eraLabel`
只负责纪年语义与同一纪年体系的比较，不被当作 Gregorian 身份。不同 era 不直接
比较；无法确定同一纪年体系时，相对差值保持 `null`。公历继续使用同一套内建
Calendar Engine。

### Tracking Subject Registry

Runtime 从当前有效 Floor Events、World Model 和 Floor `character_registry` 重建 Tracking Registry，人物列表只消费其中的 `tracking_subjects`。`tracking_subjects` 只保存当前已确认具备承孕能力的 eligible Subject；能力未知的 exposure recipient 不进入人物列表，而保存在 Runtime `tracking_candidates`。Subject 的索引形状如下：

```json
{
  "tracking_subjects": {
    "char_000001": {
      "character_id": "char_000001",
      "display_name": "A",
      "created_from_event_id": "evt_001",
      "exposure_event_ids": ["evt_001", "evt_008"],
      "status": "active"
    }
  }
}
```

`created_from_event_id` 与 `exposure_event_ids[]` 必须指向当前有效 Event；Registry 重建时去重并清理 dangling 引用。同一角色多次事件复用同一个 Subject 并累积多个 exposure 引用；pregnancy-related `sexual_activity` 的单个 Event 只关联一个 gestational Subject，其它非 pregnancy Event 是否关联 Subject 仍由既有 Domain/Tracking 规则决定。eligible Subject 与 pending candidate 可建立必要的 `character_profiles` 最小资料或证据摘要；这些资料不替代历史 Event，也不复制完整事实，普通聊天角色不进入通用生理数据库。

Registry rebuild 必须先 exhaustive scan 当前全部有效 Floor Event，收集所有 actual pregnancy-relevant exposure recipient，再逐 recipient 做 identity、World Model mapping、capability 和 eligibility resolution；不能因 Persona/current user、已有 profile、首个 eligible 或某个 false/unknown recipient 提前停止。`can_carry_pregnancy === true` 为 `eligible` 并进入 `tracking_subjects`，明确 `false` 为 `ineligible` 且不进入任何 active Registry，`null`/未知为 `pending` 并进入 `tracking_candidates`。`can_be_fertilized === true` 不能单独授权承孕追踪。

`tracking_candidates` 的最小形状如下；它保留原始 exposure Event ID、Story Time、authoritative Floor/Swipe Source Version、当前 identity、resolved capabilities 与 evidence，供可信 World Model/profile/narrative 更新后重评：

```json
{
  "tracking_candidates": {
    "subject_pending": {
      "character_id": "subject_pending",
      "exposure_event_ids": ["evt_pending"],
      "exposure_records": [{
        "event_id": "evt_pending",
        "story_time": {},
        "source": {}
      }],
      "eligibility": "pending",
      "species": null,
      "biological_type": null,
      "reproductive_capabilities": {},
      "evidence": []
    }
  }
}
```

没有有效 exposure Event 且没有后续 pregnancy/delivery 等状态时，Subject 从 active 人物列表移除；必要的无事件 profile 可作为非展示历史保留，直到后续任务定义清理策略。Floor 删除、Swipe 切换、Event 编辑/删除、Chat 切换或手动刷新后，都必须依据当前有效 Event 集合重建 Registry。

`BiologicalEvent.participants[]` 与 Tracking Subject 是两个不同层次的业务对象。前者在 `sexual_activity` 中只记录 actual reproductive exposure chain 的直接参与者，其中 `counterpart_ids[]` 标记实际 exposure source；后者只表示 Core 根据受孕暴露、事件相关性和 `can_carry_pregnancy` 三态能力解析后正式进入追踪流程的 eligible 角色。pending recipient 只进入 `tracking_candidates`，参与者的 profile 存在也不代表该角色是 Tracking Subject。

`explainTrackingDecision(event, previousChat?)` 与正式 Registry 构建共享同一条 Core 判定路径，返回 `{character_id, eligibility, reasons[]}`，其中 `eligibility` 为 `eligible | pending | ineligible`。Reason code 只用于 Core、Runtime 的诊断、Debug 或 Analysis Detail，例如 `CAN_CARRY_PREGNANCY_UNKNOWN`、`POSSIBLE_CONCEPTION_FALSE` 或 `NOT_GESTATIONAL_SUBJECT`；它不是第二套 eligibility 规则，也不是人物实体，普通 Characters UI 不读取或展示这些诊断。eligible/pending 都不代表 actual conception 或 pregnancy。

Product UI（Overview、Characters、Character Detail、Events）只显示用户可读的业务
投影和明确空状态，不渲染 `event_id`、`character_id`、`source`、Floor Version、
hash、Registry Summary、raw Event JSON 或其它 Runtime provenance。必要的
Debug/Prompt inspection 只属于 Settings 的 Advanced/Debug 工具；隐藏这些字段不
等于从 Core、Runtime、Storage 或编辑操作中删除它们。

Event Analysis 的运行状态由 Runtime coordinator 组合为 transient/read DTO，而不是第二套事实存储。DTO 同时区分当前 Floor 的 `event_count/current_floor_events` 与当前 Chat 的 `active_event_count/active_events`，并带有 Floor Version、attempt、last success/error、Tracking 数量、decision diagnostics 和脱敏 Registry 摘要。`running` 只表示当前 transient execution；持久分析记录保存成功结果或最后一次失败/取消尝试，失败刷新不覆盖 `last_success`。Runtime 以完整 Floor Version 持有 `AbortController` 和 in-flight Promise；取消、超时、stale Chat、保存失败或 Registry 失败都必须释放执行资源，迟到结果不得提交。Raw AI Response、API Secret、Authorization header 与请求正文不为可观察性写入 Chat。

### 本阶段的空状态边界

Phase 2A 的闭环为：

```text
当前剧情 → 固定 Event JSON → normalize / validate
         → Floor-bound BiologicalEvent[]
         → Tracking Subject Registry → Characters / Events / Overview
```

Genealogy、完整 StateReducer、Gestational Age、预计分娩日和完整妊娠计算仍是空状态或下一阶段能力。UI 不得从 Event 文本自行计算资格、概率、妊娠状态或时间。

## Floor Level
`message.extra.bioweave` / `message.swipe_info[n].extra.bioweave`：Analysis、Events、canonical `character_registry`、derived `snapshot`、World Model 和 `world_model_meta`；Phase 2A 的 BiologicalEvent 必须遵守上面的 Floor/Swipe source binding。

## 核心链
`Character/assistant BioWeave Floor → Floor Version → BiologicalEvent + canonical identity → Runtime rebuild → Characters / Events / Overview`。

用户编辑 Event 后，保存后的 Event 就是后续计算使用的数据；删除是真删除。Phase 2A 不提前接通 StateReducer/Genealogy。

## Data lifecycle contract pointer

The normative clear and lifecycle rules live in [BioWeave Data Lifecycle](./bioweave-data-lifecycle.md). Read it whenever a change touches the global settings boundary, Chat metadata, message/Swipe Floor roots, derived state, Chat lifecycle events, or asynchronous persistence. It is the single detailed contract for Manual Character/World/All clear, verified Start New Chat source cleanup, mutation invalidation, provenance, rollback, and contract-test coverage.

The current field ownership remains: `extensionSettings.bioweave` is global and preserved; `chatMetadata.bioweave` owns only Chat-local configuration/control state; `message.extra.bioweave` owns a Character/assistant message without Swipe structure; and `message.swipe_info[*].extra.bioweave` owns every structured Character/assistant Swipe, including inactive and historical slots. User messages are not BioWeave Floors and must never receive a BioWeave payload. Runtime/UI maps are transient and disposable. Any new field must be classified in the lifecycle registry before it is persisted, then this document and the lifecycle contract must be re-audited against the final path. In particular, Manual Clear All and the destructive source cleanup attached to SillyTavern Start New Chat use the same registry-driven coverage.
## Phase 2D-3 Projection Generation Contract

Phase 2D-3 的生成边界是 `eligible` Eligibility Decision 到内存中的 Projection
candidate。AI 原始 DTO 与领域 Projection DTO 分离：

```json
{
  "development": {
    "kind": "possible_biological_change",
    "description": "未来可能出现的生物发展方向"
  }
}
```

原始 DTO 不得包含 identity、Floor/Swipe owner、evidence、probability、
attribution、BiologicalEvent、Current State 或 Snapshot 字段。`kind` 必须与
eligible decision 完全一致。BioWeave 使用 decision、已验证的 World Model rule、
当前 Story Time 和当前 Character Floor Version 组装最终 Projection，并通过现有
`createProjection()` / `validateProjection()` 生成确定性的 `projection_id`。

只有 `eligibility === "eligible"` 的 decision 才能进入生成；`not_eligible` 和
`unresolved` 不调用 AI。AI 失败、结构或语义校验失败、或 generation context 过期时，
不创建半成品、不修改旧 Projection、Current State 或 Snapshot。此 wave 不持久化
candidate 的持久化由 Phase 2D-4 独立负责；Phase 2E 只读取聚合 View 进行 transient
Context Injection。

## Phase 2E Projection Context Injection

Runtime 只通过 `getProjectionViews()` 读取当前 Chat、surviving Character
Floors、active Swipe 和有效 Floor Version 聚合出的 View；不直接读取 raw
creation/evidence/lifecycle arrays。只有 `context_visible === true` 的 View
进入 `buildProjectionContextDTO()`，每个 `projection_id` 在一次注入中最多出现
一次，并按 subject、development concern、projection rule 的稳定字段排序。

Context DTO 只保留正文需要的 subject、development kind、未来可能方向、机制背景
以及可选的 contributor attribution 摘要，不携带 projection identity、Floor
Version、hash、message version、生命周期记录、diagnostics 或存储字段。注入通过
SillyTavern 的 `setExtensionPrompt()` 使用固定 key
`bioweave_projection_context`、`IN_CHAT`、depth 4、SYSTEM role；更新覆盖同一
slot，无有效 Projection 时写入空内容清理旧 prompt。

Chat 切换、active Swipe 切换、Character edit/reroll、Floor 删除和只有 User
message 的 endpoint 都重新 resolve；没有有效 Character Floor 或读取失败时清空
该 slot。Event Analysis 继续只读取实际正文，Projection prompt 不属于事实证据。
