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

共享 normalized context 至少可以包含以下 DTO：

- `character`：已选择的 Character Card 字段；
- `persona`：仅由允许该任务读取的 User Persona 资料组成；
- `worldbooks`：已选择的 Worldbook source/entry；
- `recent_story`：按当前 Chat 的 `floor_count` 和 regex 处理后的楼层；
- `external_memory`：已启用且确实可读的 provider 正文；
- `meta`：不含 Secret 的显示和统计元数据。

Event Analysis 可以在共享 DTO 之外组合任务所需的 `world_model`、`existing_bioweave`、`story_time`、`current_floor` 和 authoritative Floor boundary。它们也必须经过对应的安全归一化。

Prompt Formatter 只能消费 normalized DTO，不能从 `context.chat`、原始 Character Card、原始 Worldbook、原始 Persona 或外部 provider response 补回内容。

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

Recent Story 的楼数唯一来自当前既有设置 `recent_story.floor_count`。禁止在某个 Analyzer 内另设固定的 5 楼、10 楼或其它独立默认值。Event Analysis 提供目标 Floor 之前的 causal message prefix，由共享 collector 按相同 `floor_count` 选择最近楼层。

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

Event 单独发送 Target Floor，因此 collector 必须从 Recent Story 中排除同一个 authoritative target（按 message/swipe identity，必要时按 floor 兜底）。Recent Story 与 Target Floor 不得重复。World Model 没有独立 Target Floor 时继续使用其原有 Recent Story 语义。

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
| Event Analysis | yes | yes |

Event Persona 必须先经过 sanitization 和 Secret redaction，再使用中文自然语言格式：

```text
【{{user}} 的人物设定】
```

Persona name 只用于显示，不作为稳定 `character_id`。Persona 中出现性别、外貌或身份文字时，也不能直接变成 reproductive capability；`unknown` 仍然是 unknown。

## 8. Message role contract

BioWeave 不要求一个请求只有一个 SYSTEM message。允许按职责拆分多个 SYSTEM messages，但不应机械地把每个资料来源拆成独立 message。重点是绝对边界、职责聚合、稳定顺序、可测试性，以及实际请求与 Prompt Preview 完全一致。

### Prompt SYSTEM Boundary Contract

用户设置中的 `analysis_prompt.system_top`（设置界面“第一个 SYSTEM”）是整个请求中第一条 `role: system` message。它非空时，Protected Core、公共提示词、Task Contract、Reference Context、Floor metadata 和 Output Contract 都不能出现在它前面。

用户设置中的 `analysis_prompt.system_bottom`（设置界面“最后一个 SYSTEM”）是整个请求中最后一条 `role: system` message。它非空时，任何受保护规则或参考资料都不能出现在它后面；其后只能是非 SYSTEM 的 narrative 和最终执行指令。为空时对应 message 省略。

首尾设置不是普通 Core/suffix block。首尾之间的 SYSTEM 应按职责聚合：规则通常合并为一个 SYSTEM，允许的参考资料通常合并为一个 SYSTEM。因此 Event/World 请求通常为 1–4 个 SYSTEM，而不是每个来源一个 SYSTEM。

Event Analysis 的 canonical 顺序如下；空正文 block 可以省略，但不能改变剩余 block 的相对顺序：

1. 可选 `SYSTEM`：用户设置的“第一个 SYSTEM”（绝对第一条 SYSTEM）；
2. `SYSTEM`：BioWeave Event Analysis Rules，合并 Protected Core、公共 `analysis_prompt`、Event Task、必要边界说明、输入后补充和 Protected Output Contract；
3. 可选 `SYSTEM`：Reference Context，合并已选 Character Card、Event Persona、已选 Worldbook、External Memory、Current World Model、Existing BioWeave 和必要的结构化角色资料；
4. 可选 `SYSTEM`：用户设置的“最后一个 SYSTEM”（绝对最后一条 SYSTEM）；
5. `ASSISTANT`：唯一的 Narrative Context，按剧情顺序包含每层已处理的 Recent Story 和明确标记的 Target Floor；
6. `USER`：最终执行指令。

World Analysis 使用相同的首尾边界、选择和来源处理，但不包含 User Persona、Event 角色资料、Target Floor、World Model reference 或 Existing BioWeave reference 等 Event 专属资料。其规则与参考资料同样按职责聚合，Recent Story 同样只产生一个 narrative `ASSISTANT`。

Protected Core、Task Contract 和 Output Contract 由 BioWeave 代码维护。用户 common prompt 可以补充行为，不能覆盖 schema、业务 invariant 或 validator contract。

## 9. Chinese semantic source labels

主要来源 block 必须让模型清楚资料用途和边界，至少使用以下 presentation labels：

- `【角色卡：{{char}} 的背景资料】`；
- `【{{user}} 的人物设定】`；
- `【世界书参考资料】`；
- `【外部历史参考信息】`；
- `【近期剧情参考】`；
- `【本次目标楼层】`；
- `【当前 World Model 参考】`；
- `【现有 BioWeave 事实参考】`。

内部 DTO/schema key 继续使用英文；中文只属于 Prompt presentation，不改变 Domain contract。

## 10. No raw DTO serialization into prompt

模型的最终结构化输出可以是 JSON。Prompt Preview 的 raw view 也可以为了调试展示最终 `messages[]` 的 JSON。但业务资料输入不得通过 `JSON.stringify(analysisInput)` 或局部 Persona/Character/Worldbook DTO 序列化后发送。每个输入来源都必须由专用 formatter 生成有标题、用途和边界的普通文本 block。

### Narrative Context Contract

所有 Chat narrative floor 都必须先解析 authoritative active content，再逐楼层判断 regex 是否适用并独立执行 global regex 与 Chat-local regex，最后按剧情顺序合并为一个 `ASSISTANT` message。不能先合并原文再执行 regex，也不能让 Target Floor 绕过该流程。

`regex_user_enabled` 只控制 user floor 是否执行剧情 regex：为 `false` 时 user floor 仍可进入上下文，但保留现有不执行 regex 的语义；为 `true` 时 user floor 执行 global regex 后再执行 Chat-local regex。opening floor 的既有特殊语义保持不变。Recent Story 与 Target Floor 使用同一个逐楼层处理 contract；内部 DTO 保留每层边界和目标标记，最终 narrative presentation 只显示处理后的正文与必要的历史/目标语义标题。

### Narrative Presentation Contract

楼层号、消息 role、message_id、swipe metadata 和其它 Floor provenance 只保留在内部逐楼 DTO，属于 Runtime/Collector 的追踪信息，不属于模型可读的剧情正文。每层内容必须独立完成 active swipe 解析、regex 判断、regex 处理和 sanitization；处理完成后才按真实剧情顺序以自然段落合并，不能先拼接原文再处理。

最终 narrative presentation 不应看起来像 Runtime debug dump：不显示 floor number、user/assistant role、`正文：`、message_id、swipe_id、content_hash 或 message_version，也不为每层自动插入分隔线。空的 processed floor 从最终正文中省略，但内部 DTO 可以保留供测试和诊断；Target Floor 处理为空时不得回退到 raw content。

Event 使用 `【剧情上下文】` 表示非目标历史内容，使用 `【本次分析内容】` 表示唯一的目标内容；没有历史时省略空的剧情上下文 section。World Model 的 Recent Story 使用 `【近期剧情参考】`。每个任务的历史与目标 narrative 最终都只生成一个 `ASSISTANT` message，Prompt Preview 必须直接展示同一份真实 message content。

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

## 12. Prompt Preview parity

Prompt Preview 必须直接调用实际请求使用的同一个 `buildWorldModelMessages()` 或 `buildEventAnalysisMessages()`。Preview 不得自行重建来源、角色、顺序或 message role。结构预览和 raw 预览都来自这份最终 `messages[]`；允许的差异仅限于安全 redaction。

实际 API 请求与 Prompt Preview 都读取已经保存的 canonical `analysis_prompt`；设置页面尚未保存的表单草稿不会冒充实际请求。

Token estimate 必须基于同一份 normalized selected context，只统计最终允许进入 Analysis Context 的正文，不统计未选字段、未选条目、disabled/unavailable provider、被 floor_count 排除的楼层或被 regex 清除的正文。

## 13. Future tasks

未来 Projection、History 或其它 Analyzer 在实现前必须显式声明消费哪些 shared context sources、是否读取 Persona、是否需要 Target Floor，以及自己的 Task/Output Contract。不得直接复制一套 Raw SillyTavern reader，也不得让公共 `analysis_prompt` 覆盖受保护 Contract。
