# 技术设计：统一 Prompt Context Presentation Port

## 1. 设计目标

在保留现有 AnalysisInput 收集边界的前提下，为 World、Event、Storyline 及未来 Analyzer 提供唯一的资料正文呈现 seam。新调用方只声明“需要哪些资料、采用哪个受支持的语义变体”，不再自行实现中文字段标签、嵌套列表、空值、ID 过滤和来源正文排版；标题、用途说明、消息角色和任务要求仍由调用方负责。

本任务解决 presentation locality，不改变任何事实所有权、Floor/Swipe 读取、API 路由、业务规则或 JSON 输出协议。

## 2. 已确认现状与根因

当前链路已经有可靠的前半段：

```text
Raw SillyTavern / Runtime sources
  -> collectAnalysisContext()
  -> buildAnalysisInput() / task semantic projection
  -> normalized DTO
```

缺失的是 normalized DTO 之后的公共 seam：

```text
normalized DTO
  -> source-specific readable presentation
  -> grouped SYSTEM / ASSISTANT / USER messages
```

`ai/prompts.js` 已有若干 formatter，但多数绑定 World/Event 的私有组合；`ai/projection-storyline.js` 因没有稳定公共 interface，重新实现了 World Model、其他参考数据和嵌套文本 formatter；`runtime/projection-storyline-runtime.js` 还提前把人物资料转成字符串。10-22 规划与检查上下文没有把 `docs/CONTEXT-AND-PROMPT.md` 和 shared presentation seam 作为门禁，现有测试也只验证单个任务的最终输出，无法发现跨消费者重复实现。

## 3. 目标数据流

```text
ai/input-builder.js
  shared source collection / selection / sanitization / normalized DTO
        |
        v
runtime task projection
  Floor-valid semantic inputs; no presentation strings
        |
        v
ai/prompt-context.js
  canonical source content formatter + readable labels + safe filtering
  (message grouping is a separate layout helper)
        |
        v
task prompt builder
  protected rules + JSON/output contract + task request
        |
        v
messages[] -> analyzer/client
```

Prompt Preview 必须继续调用实际请求的 task message builder；不得单独调用 presentation port 重建预览。

## 4. Module 与 interface

新增纯计算 module：`ai/prompt-context.js`。它是 presentation seam，不是新的 source collector、Repository、Service、Factory 或 Registry。

公开边界只保留正文端口和消息组装两个入口：

```js
formatPromptContextContent({
  kind,
  value,
  names,
  variant,
  empty,
}) -> string

composePromptMessages({
  systemTop,
  groups,
  user,
  systemBottom,
}) -> Array<{role, content}>
```

### 4.1 `formatPromptContextContent`

`kind` 使用受控白名单，首期至少支持：

- `character_card`
- `character_profile`
- `worldbooks`
- `plugin_world_model`
- `event_reference`
- `other_reference_data`
- `external_memory`
- `recent_story`
- `target_floor`
- `triggered_signals`
- `world_model_supplement`
- `world_species_archive_exclusions`
- `projection_generation_input`
- `event_identity_registry`
- `event_character_profiles`
- `event_existing_events`

每个 kind 在 module 内拥有：

- 统一正文中文字段标签；
- source-specific 字段白名单和内部 ID 过滤；
- 排序、缩进、列表和空值规则；
- 允许的 `variant`。

正文端口不返回场景标题、用途说明、消息角色或任务要求。`variant` 只能选择 module 已定义的资料投影用法，例如 `world`、`event`、`storyline_design`、`storyline_judge`、`comparison`。调用方不能传 formatter callback，也没有完整区块兼容包装器。

### 4.2 `composePromptMessages`

`groups` 按顺序声明消息及其 blocks：

```js
[
  {role: 'system', blocks: [rulesBlock]},
  {role: 'system', blocks: [worldBlock, otherBlock, memoryBlock]},
  {role: 'assistant', blocks: [storyBlock]},
]
```

不变量：

- role 只能是 `system | assistant | user`；
- 空 block 由 source 的 `empty` contract 决定省略或显示“无”；
- 同一 group 的 blocks 合并成一条 message，避免每个来源机械拆 message；
- `systemTop` 非空时是绝对第一条 SYSTEM；`systemBottom` 非空时是整个数组最后一条 message；
- 返回新数组，不修改任何输入；
- 不读取 Host、Runtime、Storage、Floor 或 API 配置。

### 4.3 错误模式

- 未知 kind：`PROMPT_CONTEXT_KIND_UNSUPPORTED`
- kind 不支持 variant：`PROMPT_CONTEXT_VARIANT_UNSUPPORTED`
- 非法 role/group：`PROMPT_CONTEXT_LAYOUT_INVALID`
- Event 尝试消费 raw Character/Persona/Worldbook：`PROMPT_CONTEXT_SEMANTIC_SOURCE_REQUIRED`

来源不可用不是 formatter 异常：collector 已将读取失败规范化为空，port 只执行约定的空值呈现。

## 5. 任务所有权

### Prompt Context module 负责

- source-specific presentation；
- 统一正文中文字段标签（不包含场景标题和用途说明）；
- 内部 ID/不允许字段过滤；
- nested object/list 的可读文本；
- enabled/available/content-bearing External Memory 的最终呈现；
- recent/target narrative 的最终 presentation；
- 正文空值策略。

### Task builder 继续负责

- protected analysis rules；
- task-specific business semantics；
- JSON/output contract；
- retry directive；
- candidate/selected branch、triggered signals 等 task payload；
- 资料标题、用途说明、消息角色/分组、SYSTEM 首尾布局和最终 user request。

### Input builder / Runtime 继续负责

- source selection 和 host loading；
- current Chat、active Swipe、Floor Version 与 causal endpoint；
- Event semantic projection 和 identity/provenance；
- task input freshness/stale guard。

## 6. 兼容与迁移

### 6.1 World/Event

- `buildWorldModelMessages()`、`buildWorldModelPatchMessagesV2()`、`buildEventAnalysisMessages()` 保持公开入口不变。
- 将现有 Character、Worldbook、External Memory、World Model、Event reference 和 narrative formatter 的实现迁入 `prompt-context.js`。
- `ai/prompts.js` 保留 protected rules、output contracts、资料标题/用途说明和消息布局，仅委托 presentation port 生成统一资料正文。
- 迁移后已确认完整区块 formatter 无生产调用方，因此删除旧实现与兼容 re-export，不保留双轨。

### 6.2 Storyline

- Runtime 改为传递结构化 `characterProfile`、`worldModel`、`otherReferenceData`、`externalMemory` 和 processed narrative DTO/文本，不再提前执行 `readableContextText()`。
- Storyline design/judge 的资料块直接由公共 port 渲染，最终通过 `composePromptMessages()` 进入 `messages[]`；Analyzer、Runtime 和调试摘要复用同一数组。
- 已删除 `WORLD_LABELS`、`formatWorldValue()`、`formatOtherReferenceData()`、Runtime readable formatter 及 marker parser 等旧 implementation。
- Storyline 继续明确排除 Worldbook，不因公共 port 自动发送全部资料。

### 6.3 Event 安全边界

Event 只能请求受控的 `event_reference`、`event_identity_registry`、`event_character_profiles` 和 `event_existing_events` semantic block，不能直接请求 raw Character Card、Persona、Worldbook 或 External Memory。公共 presentation port 不改变 Character Evidence projection 及现有 Event Input Boundary。

## 7. 测试策略

接口就是测试面。先建立黄金输出，再迁移调用方：

1. `tests/prompt-context.test.js`：逐 kind/variant 验证正文中文字段标签、列表、空值、ID 过滤和错误模式；明确正文入口不返回场景标题或用途说明，且不存在完整区块兼容包装器。
2. 消费者矩阵：同一种资料在 World/Event/Storyline 的允许与禁止关系集中测试。
3. `tests/context-prompt.test.js` / `tests/event-analysis.test.js`：World/Event 最终 messages、首尾 SYSTEM、Preview/request parity 保持。
4. `tests/projection-storyline.test.js`：SYSTEM 规则、可选 SYSTEM 参考、ASSISTANT 正文和 USER 任务的顺序，以及人物/世界/参考/记忆/正文格式与 JSON parser contract 保持；空参考不生成空区块。
5. `tests/event-analysis-runtime.test.js`：真实 Floor/Swipe input 仍经 shared collector，presentation refactor 不改变因果范围。
6. 静态重复检查：Storyline/Runtime 不再定义第二份 world labels、readable nested formatter 或 marker parser。

## 8. 文档同步

实现后同步：

- `docs/ARCHITECTURE.md`：增加 Prompt Context presentation owner；
- `docs/CONTEXT-AND-PROMPT.md`：明确 shared collector 负责“拿什么”，Prompt Context port 负责“每种资料怎样呈现”，task builder 负责“规则与任务”；
- `.trellis/spec/domain/floor-state.md`：只补充 API context presentation 不改变 Floor ownership，避免复制字段清单。

不新增持久化字段，因此 `docs/bioweave-data-lifecycle.md` 无需修改，除非实现审计发现意外状态变化；若发生则停止并另开 lifecycle root-cause scope。

## 9. 风险与回滚

- 最大风险是迁移时悄然改变既有 Prompt 文本或消息顺序；用迁移前黄金输出和最终 messages diff 防护。
- 第二风险是通用接口泄漏 raw Event source；用 kind/variant 白名单和 Event semantic guard 防护。
- 第三风险是设计成浅层 Registry；首期固定 kind 和两个入口，不提供插件注册或任意 callback。
- 回滚以消费者为单位：先保留旧公开 builder，任何消费者迁移失败可恢复其委托点，不触碰 collector、Floor 或 Storage。
