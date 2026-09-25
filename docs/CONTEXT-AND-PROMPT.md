# BioWeave Analysis Context / Prompt Contract

本文档定义 BioWeave 各类 AI Analysis 的长期输入边界和消息组合契约。它适用于当前的 World Analysis、Event Analysis，以及未来明确接入的 Projection、History 等任务。

## 1. Settings are authoritative

设置是分析输入来源的唯一控制入口。任务实现必须先读取当前适用的全局设置和 Chat-local 设置，再决定哪些资料可以进入本次 Analysis Context。Prompt builder 不得绕过设置直接读取 SillyTavern 原始对象。

输入边界的标准流水线是：

```text
Raw SillyTavern Context
→ Settings-based Selection
→ Recent Story Regex Processing
→ Sanitization / Secret Redaction
→ Normalized Analysis Context DTO
→ Task Prompt Formatter
→ messages[]
```

`ai/input-builder.js` 的共享 Context Collector 负责“拿什么”，任务 Prompt Builder 负责“怎么组织消息”。新任务应复用这条边界，不再建立任务私有读取路径。

## 2. Shared context collection

共享 collector 的 wide normalized context 至少可以包含以下 DTO；这些字段仍供 World Analyzer 和 Runtime orchestration 使用：

- `character`：已选择的 Character Card 字段；
- `persona`：仅由允许该任务读取的 User Persona 资料组成；
- `worldbooks`：已选择的 Worldbook source/entry；
- `recent_story`：按当前 Chat 的 `floor_count` 和 regex 处理后的楼层；
- `external_memory`：已启用且确实可读的 provider 正文；
- `meta`：不含 Secret 的显示和统计元数据。

Event Analysis 在共享 wide DTO 之外建立独立的 semantic projection，组合 `world_model`、`existing_events`、`story_time`、`current_floor`、`recent_story`、`identity_context`、Character Evidence (`individual_evidence`) 和 authoritative Floor boundary。完整 `existing_bioweave`、`character_registry` 以及 raw Character Card、Persona、Worldbook、External Memory 可以继续存在于 Runtime wide DTO，但不能由 Event prompt formatter 消费。模块独立不等于人物证据删除：正确链路是 raw/source collection → Character Evidence semantic projection → Character/Event Analyzer。

Prompt Formatter 只能消费 normalized DTO，不能从 `context.chat`、原始 Character Card、原始 Worldbook、原始 Persona 或外部 provider response 补回内容。

### Character Evidence contract

`identity_context` 只回答“这个 mention 是谁”，包含 canonical
`character_id`、`display_name`、aliases；它不提供 species、biological_type
或 capability。`individual_evidence` / Character Evidence 只回答“这个人物
有哪些稳定生理事实”，可包含 subject binding、typed
`stable_biological_evidence: {kind, text}[]`、species/type、明确个体
capability 与 provenance。`world_model` 回答“当前世界中该 species/type 的
baseline biological rules 是什么”。三者不可互相替代。

Character Card description 可为 `current_character` 提供稳定人物证据；Persona
description 可为 `persona` 提供稳定人物证据；existing profile 保持原有
canonical ID、species/type、capabilities/evidence。Recent Story 与 Current
Floor 都是 narrative Event discovery evidence；Recent Story 中明确已经发生
的历史事实可以生成 Event，并保留事实自己的 story_time。Worldbook/External Memory 只有可靠
subject binding 才能进入 Character Evidence；文本包含姓名、first-match-wins
和跨人物借证都不构成 binding，无绑定时排除而不是广播。

能力解析顺序固定为：Character Evidence 映射到 persisted World Model 已存在
的 species/type → 读取该 type baseline → 用明确个体 capability evidence
覆盖或补充；冲突/不足保持 `null`。生理性别可以帮助 type mapping，但不能
直接推出 capability；Character/Event 不创建 Human baseline、不创建缺失 type，
Nonhuman 的同名 type 不能套 Human baseline，也不能用现实常识补空。

Initial Registry Bootstrap 时，即使 Registry 为空、没有 profile 或 canonical
ID，Character Evidence 仍可 transient 存在，`character_id` 必须为 `null`，并
保留 subject kind、display name/identity hint 与 provenance；raw response 使用
`identity_status=new|unresolved`，由 Runtime 后续分配 canonical ID。稳定人物
证据不是当前 Floor Event，Character Evidence 也不新增 Chat/Floor 持久化字段。

### Character identity output contract

AI 只负责 participant identity classification，不拥有 canonical identity authority。
`identity_context` 是唯一的 canonical identity candidate projection：

- `existing` 必须原样引用其中唯一匹配的 canonical `character_id`；不存在、非法或
  不允许引用的 ID 由 Runtime 拒绝，不能静默接受；
- `new` / `unresolved` 必须使用 `character_id: null`。response-local mention token
  只在同一 AI response 内引用同一人物，不跨分析持久化、不成为 registry key，也没有
  固定字面格式；生产代码不得依赖编号 token；
- 同名、alias collision、多候选或证据冲突必须 `unresolved`，禁止 first-match-wins。

`display_name`、`aliases[]`、mention token、`event_role`、gender、physiological sex、
species、biological_type、Tracking eligibility 和 UI visibility 都不能替代
canonical `character_id`。正式 ID、participant reference canonicalization、registry
registration、Event source 和 Floor ownership 全部由 Runtime 负责。

Character Evidence 只能提供 semantic identity/biology evidence，不能创建 ID、替代
registry、创建 Tracking Subject 或自动建立 alias。一次 narrative 称呼也不能自动
持久化为 alias；只有明确 alias establishment evidence 或用户手动编辑才可进入
`aliases[]`。

## 3. Character selection contract

只有用户在当前 Chat 的分析来源设置中选择的 Character Card 字段可以进入 DTO。未选择的字段不得进入实际 API request、Prompt Preview 或 token estimate。展示给模型时使用中文来源说明，不展示原始对象式的 `character:`、`description:`、`greetings:` 结构。

标准来源标签是：

```text
【角色卡：{{char}} 的背景资料】
```

其中 `{{char}}` 仅用于显示替换；display name 不是稳定 identity，也不参与 Domain 关联。

## 4. Worldbook selection contract

只有设置中选中的 Worldbook source/entry 可以进入 DTO。未选中的 entry 不得进入实际请求、Preview 或 token estimate。条目标题可以显示，但内部 `source_id`、`entry_id` 不应以原始对象序列化方式发送，除非任务确实需要该稳定 ID。

标准来源标签是：

```text
【世界书参考资料】
```

Worldbook 是世界观和生物规则的参考证据；当前剧情的明确后续事实或个体例外不能被它机械覆盖。

## 5. Recent Story contract

Recent Story 的楼数唯一来自当前既有设置 `recent_story.floor_count`。禁止在某个 Analyzer 内另设固定的 5 楼、10 楼或其它独立默认值。World/Event Analysis 都先解析 Current BioWeave Character Floor，再以该 Floor 为 inclusive upper bound，从原始 SillyTavern message 中按 `floor_count` 选择最近楼层。历史 User message 可以保留；只有 Character Floor 之后的尾部 User message 被排除。

Recent Story 的处理顺序是：

```text
raw message
→ collectRecentStory
→ global regex
→ Chat-local regex
→ regex_user_enabled 语义
→ sanitized recent_story.items
→ Prompt Formatter
```

开场楼和用户楼的处理遵守现有 collector 语义。`regex_user_enabled` 为 false 时保留既定用户楼行为；为 true 时用户楼按配置规则处理。Prompt Formatter 不重新执行 regex。

Event 仍单独发送 Target Floor，但 Recent Story 必须包含同一个 Current BioWeave Character Floor；重复是有意的，确保 World/Event 使用一致的 recent-story 边界。Current Floor 之后的尾部 User message 不得进入任一分析 Context。

Event discovery window 与 Event persistence owner 是两个独立概念：Current
Target Floor 与 bounded Recent Story 都可参与 BiologicalEvent discovery；本轮
新发现 Event 统一持久化到当前 Character Floor active Swipe。历史 Event 保留
实际 story_time，但 canonical source 仍由 Runtime 绑定当前 Floor Version，表示
本轮 persistence owner，而不是历史事实原始 Floor。

`existing_bioweave` 继续只表示最近合法成功前置 Floor 的 snapshot，用于身份和
profile continuity。Event prompt 的 `existing_events` 是单独的 bounded dedupe
projection：除最近前置 snapshot 外，至少覆盖 Recent Story discovery window 中
其它合法 active Floor 的 canonical Events；不扫描无限 Chat 历史，不包含 target 自身
旧结果、删除/失效 Swipe 或 stale Floor。Runtime identity resolution 后，只有在
type、structured story_time、canonical participant/subject/counterpart 集合、机制、
关键事实 evidence 与 state fact 均完全匹配时才视为 semantic duplicate；资料不完整
或存在差异时保留 Event。

## 6. External Memory provider contract

只有设置中启用、宿主明确可用、provider 正文确实可读且没有读取错误的外部来源可以贡献正文。disabled、unavailable 和 error provider 不贡献正文；错误对象、response、`extra`、Store 或 debug 结构不得发送给模型。

标准来源标签是：

```text
【外部历史参考信息】
```

External Memory 是参考证据，用于补充较早背景，不是无条件的最高权威。遇到冲突时，模型应结合当前剧情、明确后续事件和 BioWeave 已保存事实判断。

## 7. Persona task policy

User Persona 是否进入 Context 由任务策略决定，而不是由 Formatter 临时判断：

| Task | common `analysis_prompt` | User Persona evidence |
| --- | --- | --- |
| World Analysis | yes | no |
| Event Analysis | yes | yes；仅通过 Character Evidence projection，raw Persona DTO 不进入 |

Event prompt 不包含 raw Persona，也不提供 `【{{user}} 的人物设定】` section；但 Persona 的稳定生理证据必须通过 Character Evidence projection 进入 Event。Persona 中的旧经历/背景事件不能成为当前 Floor Event，也不得广播给其他 participants。World Analysis 仍按既有共享 collector 规则处理宿主来源。

## 8. Message role contract

BioWeave 不要求一个请求只有一个 SYSTEM message。允许按职责拆分多个 SYSTEM messages，但不应机械地把每个资料来源拆成独立 message。重点是绝对边界、职责聚合、稳定顺序、可测试性，以及实际请求与 Prompt Preview 完全一致。

### Prompt SYSTEM Boundary Contract

用户设置中的 `analysis_prompt.system_top`（设置界面“第一个 SYSTEM”）是整个请求中第一条 `role: system` message。它非空时，Protected Core、公共提示词、Task Contract、Reference Context、Floor metadata 和 Output Contract 都不能出现在它前面。

用户设置中的 `analysis_prompt.system_bottom`（设置界面“最后一个 SYSTEM”）是整个请求 `messages[]` 的绝对最后一项，且保持独立的 `role: system` message。它非空时，任何 narrative、最终执行指令或其它输出内容都必须排在它前面；它后面不能再有任何 message。为空时对应 message 省略。

首尾设置不是普通 Core/suffix block。首尾之间的 SYSTEM 应按职责聚合：规则通常合并为一个 SYSTEM，允许的参考资料通常合并为一个 SYSTEM。因此 Event/World 请求通常为 1–4 个 SYSTEM，而不是每个来源一个 SYSTEM。

Event Analysis 的 canonical 顺序如下；空正文 block 可以省略，但不能改变剩余 block 的相对顺序：

1. 可选 `SYSTEM`：用户设置的“第一个 SYSTEM”（绝对第一条 SYSTEM）；
2. `SYSTEM`：BioWeave Event Analysis Rules，合并 Protected Core、公共 `analysis_prompt`、Event Task、必要边界说明、输入后补充和 Protected Output Contract；
3. 可选 `SYSTEM`：Reference Context，合并 persisted Current World Model、`identity_context`、经过 projection 的 Character Evidence (`individual_evidence`) 和 existing Events；raw Character Card、Persona、Worldbook、External Memory 不进入 Event prompt；
4. `ASSISTANT`：唯一的 Narrative Context，按剧情顺序包含每层已处理的 Recent Story 和明确标记的 Target Floor；
5. `USER`：最终执行指令；
6. 可选 `SYSTEM`：用户设置的“最后一个 SYSTEM”（整个 `messages[]` 的绝对最后一项）。

World Analysis 使用相同的首尾边界、选择和来源处理，但不包含 User Persona、Event 角色资料、Target Floor 或 Existing BioWeave reference 等 Event 专属资料。Full World Analysis 的语义是 `evidence → complete World Model`，不消费 Existing World Model baseline；即使调用路径或 `AnalysisInput` 偶然带有旧 `world_model`，Full final messages 也不得包含 `【当前 World Model 参考】`。

Supplement/Patch World Analysis 的语义是 `Existing World Model + evidence → baseline-aware semantic differential → sparse Patch`。它必须在最终 API messages 的 Reference Context 中包含已验证的 Existing World Model comparison baseline，并与 Full 使用相同的完整、允许的 World Analysis evidence set。baseline 不是 evidence，不得被 `evidenceUnits()` 收集，也不能证明它自身产生的新 Patch fact。Analyzer 重新审阅这些 evidence：新近资料中新出现的事实、较早资料中之前遗漏的事实、已有 entry 的 evidence-supported 补充，以及 explicit evidence-supported correction，都可以相对于 baseline 产生 `add` 或 `update`；事实不要求首次出现于 current Floor。Existing Model 已充分表达的事实不重复输出，省略字段表示 unchanged，`remove` / `invalidate` 仍不支持。Patch evidence validation 必须验证 canonical semantic delta，而不是以整个 entry 任意一个字符串命中 evidence 就放行。

Protected Core、Task Contract 和 Output Contract 由 BioWeave 代码维护。用户 common prompt 可以补充行为，不能覆盖 schema、业务 invariant 或 validator contract。

Event Analysis V1 的 Output Contract 允许一个当前 Target Floor Version 产生
`0 / 1 / N` 个 BiologicalEvents。对于 pregnancy-related `sexual_activity`，Event
granularity is per gestational subject：先 exhaustive scan 整个 narrative discovery
window（Current Target Floor 与 Recent Story），建立临时
candidate 集合并收集全部实际发生
conception-relevant exposure 的 gestational subject，再按 subject 分组。同一
subject 的多个 actual exposure source 合并为一个 Event；不同 subject 必须输出
不同 Event，即使时间、地点和 type 相同。每个该类 Event 必须有且仅有一个
`gestational_subject_ids`，至少一个 subject-local `counterpart_ids[]`，并且
`participants[]` 只包含该 subject 与这些实际 source；不得混入另一个 subject、其
source、在场人物或无 actual exposure 的参与者。同一 subject 在同一 Floor Version
最多一个 pregnancy-related sexual_activity Event；重复 subject 或非法
subject/source 闭包由 parser/domain validator 拒绝，Runtime 不自动合并。

收集完成后再逐 recipient 进行 identity、World Model species/type mapping、capability
和 eligibility resolution；不得因 current user、已有 individual evidence、
首个 eligible 或某个 false/unknown recipient 提前结束。允许多条一致上下文支持
biological identity；姓名、称谓、外貌、event_role、位置、主动/被动、社会身份、穿着或
气质等单一弱线索不能独立决定 identity/capability，冲突或不足时保留 null/pending。

同一 subject 的 sexual exposure、即时 symptoms、physical effects、直接身体反应
和证据保持在同一 Event；其它真正独立的 `physical_symptom`、`medical_event` 或
BiologicalEvent 可以并存。普通照顾/补品、食物、饮料、静态外貌/体质描写不自动
形成独立 Event。Recent Story 中明确发生但尚未记录的 Event 可以在本轮补录；已
存在的 canonical Event 通过 bounded `existing_events` semantic comparison 避免
重复。多 Event response 不由 Runtime 或 UI 合并、拆分或按人物重建。

每个已确认 participant 都必须返回 `biological_context: {species, biological_type}`；
这项人物分析不以 `pregnancy_relevance.relevant === true` 为前提。两个字段值只能是
字符串或 `null`，资料不足时不得单一线索猜测。`pregnancy_relevance` 描述当前 Event，
participant biological facts 描述人物；`relevant=false` 不能跳过人物分析，也不能由
人物 capability 反推为 pregnancy-related。固定顺序是 identity → Character Evidence →
species → 该 species 内 biological_type → exact persisted World Model species/type →
baseline capability → explicit individual capability evidence → final participant facts。
`species` 取当前 World Model 对应人物的 species，`biological_type` 取该 species 下稳定的
生理/生殖分类。`reproductive_capabilities_used` 必须先使用匹配 World Model species/type
的 baseline，再综合 canonical/derived individual evidence 与当前剧情证据逐项填写；个体
明确证据可覆盖或补充，未知保持 `null`。gender/sex 只能帮助映射已有 type，不能直接
推出 capability。Human baseline 只能由 World Model 建立，Nonhuman 不套 Human baseline，
也不创建缺失 type。exposure recipient/source 和 `possible_conception` 由 World Model、
species/type reproduction rules/capabilities 与 Narrative evidence 共同决定，不将任一
现实物种、性别、解剖结构或单一现实生殖机制硬编码为通用要求。不新增 `gender` 字段。

## 9. Chinese semantic source labels

主要来源 block 必须让模型清楚资料用途和边界，至少使用以下 presentation labels：

- `【角色卡：{{char}} 的背景资料】`（World Analysis only）；
- `【{{user}} 的人物设定】`（World/legacy context only；不属于 Event prompt）；
- `【世界书参考资料】`（World Analysis only）；
- `【外部历史参考信息】`（World Analysis only）；
- `【近期剧情参考】`；
- `【本次分析内容】`（当前 Target Floor 正文）；
- `【当前 World Model 参考】`；
- `【现有 BioWeave 事实参考】`。

Event 的参考 section 使用 `identity_context`、Character Evidence
(`individual_evidence`)、persisted World Model 和 existing Events；不使用上述
raw host source sections。未来任何 Event Input Boundary、Prompt trimming、
World/Event separation、sanitization 或 AnalysisInput narrowing 都必须保留
等价或更严格的 Character Evidence projection，并由最终
`buildEventAnalysisMessages()` 回归验证，而不能只验证 Prompt 规则文案。

`【当前 World Model 参考】` 在 World Prompt 中仅属于 Supplement/Patch 的
baseline reference；Full World Analysis 不得发送该 section。

内部 DTO/schema key 继续使用英文；中文只属于 Prompt presentation，不改变 Domain contract。

## 10. No raw DTO serialization into prompt

模型的最终结构化输出可以是 JSON。Prompt Preview 的 raw view 也可以为了调试展示最终 `messages[]` 的 JSON。但业务资料输入不得通过 `JSON.stringify(analysisInput)` 或局部 Persona/Character/Worldbook DTO 序列化后发送。每个输入来源都必须由专用 formatter 生成有标题、用途和边界的普通文本 block。

### Narrative Context Contract

所有 Chat narrative floor 都必须先解析 authoritative active content，再逐楼层判断 regex 是否适用并独立执行 global regex 与 Chat-local regex，最后按剧情顺序合并为一个 `ASSISTANT` message。不能先合并原文再执行 regex，也不能让 Target Floor 绕过该流程。

`regex_user_enabled` 只控制 user floor 是否执行剧情 regex：为 `false` 时 user floor 仍可进入上下文，但保留现有不执行 regex 的语义；为 `true` 时 user floor 执行 global regex 后再执行 Chat-local regex。opening floor 的既有特殊语义保持不变。Recent Story 与 Target Floor 使用同一个逐楼层处理 contract；内部 DTO 保留每层边界和目标标记，最终 narrative presentation 只显示处理后的正文与必要的历史/目标语义标题。

### Narrative Presentation Contract

楼层号、消息 role、message_id、swipe metadata 和其它 Floor provenance 只保留在内部逐楼 DTO，属于 Runtime/Collector 的追踪信息，不属于模型可读的剧情正文。每层内容必须独立完成 active swipe 解析、regex 判断、regex 处理和 sanitization；处理完成后才按真实剧情顺序以自然段落合并，不能先拼接原文再处理。

最终 narrative presentation 不应看起来像 Runtime debug dump：不显示 floor number、user/assistant role、`正文：`、message_id、swipe_id、content_hash 或 message_version，也不为每层自动插入分隔线。空的 processed floor 从最终正文中省略，但内部 DTO 可以保留供测试和诊断；Target Floor 处理为空时不得回退到 raw content。

Event 使用 `【剧情上下文】` 表示 Recent Story，使用 `【本次分析内容】` 表示当前 Target Floor；两者共同构成 narrative discovery window，均可提供明确已发生 Event 的发现证据。没有历史时省略空的剧情上下文 section。World Model 的 Recent Story 使用 `【近期剧情参考】`。每个任务的历史与目标 narrative 最终都只生成一个 `ASSISTANT` message，Prompt Preview 必须直接展示同一份真实 message content。

Event Analyzer 只负责从 Current Target Floor 与 bounded Recent Story 中发现
明确已发生的 factual `BiologicalEvent`。它不根据“过了很久”宣布 Pregnancy
Exposure Tracking Window expired，不自动生成 resolved-not-pregnant、negative
pregnancy 或 medical fact。未来 Context Injection 如消费 Tracking Window，只能
把仍为 `open` 的 Window 作为当前 pregnancy signal；已关闭 Window 不得继续以
“这些 exposure 仍可能导致当前妊娠”的 active signal 注入。Window 生命周期由
[Pregnancy Exposure Tracking Lifecycle Contract](../.trellis/spec/domain/pregnancy-tracking.md)
定义，不能由 Prompt 文案替代。

## 11. Runtime authoritative identity

Floor identity 和 Event provenance 由 Runtime 负责。必要的 boundary metadata 可以单独作为 SYSTEM scope block，用于限制输入范围；不要要求模型 echo 它们。最终 Event source 绑定当前 authoritative Floor Version，包含：

```text
chat_id
message_id
floor
swipe_id
content_hash
message_version
```

AI 不拥有 `event_id` 或 authoritative `source`。Event ID、Floor/swipe binding、stale-result protection 和保存语义由 Runtime/Core 维护。

这些 Runtime/Core provenance 字段属于内部数据边界，不属于普通 Product UI。
Overview、Characters、Character Detail 和 Events 只显示用户可读业务投影；需要
查看 raw prompt、诊断或 provenance 时使用 Settings 的 Advanced/Debug 工具。该
UI 边界不改变 Prompt 中对 Floor provenance 的内部追踪，也不改变 Runtime 的
authoritative source ownership。

## 12. Prompt Preview parity

Prompt Preview 必须直接调用实际请求使用的同一个 `buildWorldModelMessages()` 或 `buildEventAnalysisMessages()`。Preview 不得自行重建来源、角色、顺序或 message role。结构预览和 raw 预览都来自这份最终 `messages[]`；允许的差异仅限于安全 redaction。

实际 API 请求与 Prompt Preview 都读取已经保存的 canonical `analysis_prompt`；设置页面尚未保存的表单草稿不会冒充实际请求。

Token estimate 必须基于同一份 normalized selected context，只统计最终允许进入 Analysis Context 的正文，不统计未选字段、未选条目、disabled/unavailable provider、被 floor_count 排除的楼层或被 regex 清除的正文。

## 13. Future tasks

未来 Projection、History 或其它 Analyzer 在实现前必须显式声明消费哪些 shared context sources、是否读取 Persona、是否需要 Target Floor，以及自己的 Task/Output Contract。不得直接复制一套 Raw SillyTavern reader，也不得让公共 `analysis_prompt` 覆盖受保护 Contract。
