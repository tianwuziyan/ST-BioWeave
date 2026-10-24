# Research: Prompt Context 端口返回形态审计

- Query: 当前共享 Prompt Context 端口究竟返回“已带标题/用途说明的完整区块”，还是只返回统一格式正文；与“世界书统一格式后隔离，其他调用和说明由各自模块负责”的目标是否一致。
- Scope: internal
- Date: 2026-10-23

> 历史迁移前审计快照：以下 Findings 记录的是迁移前状态，不代表当前实现。当前最终契约和名称以本任务 `design.md`、`ai/prompt-context.js` 以及 `docs/CONTEXT-AND-PROMPT.md` 为准：正文端口只返回内容，Storyline builder 直接返回 `messages[]`。

## Findings

当前实现是“收集 DTO 与展示格式/区块语义部分分离”，但还不是用户描述的纯格式端口。

### 1. Source collection

- `ai/input-builder.js:277-310` 的 `buildWorldbookInput()` 从 source 中筛选世界书和条目，保留 `source_id`、`entry_id`、label、content、token_estimate；它负责选择/归一化，不负责模型可读标题和用途说明。
- `ai/input-builder.js:672-742` 的 `buildAnalysisInput()` 汇总 character、worldbooks、recent_story、external_memory 等结构化 DTO。
- `ai/input-builder.js:759-843` 的 `collectAnalysisContext()` 负责注入 source/provider loader，并最终回到同一 `buildAnalysisInput()` 路径。也就是说，收集端与展示端在代码边界上是分开的。

### 2. 迁移前 `ai/prompt-context.js` 的实际返回形态

历史实现曾把字段统一、标题、“本段用途”说明和正文合并为完整模型区块；本任务已将其收口为只返回正文的公共端口。

迁移前的完整区块 helper 曾分别返回标题、用途说明和正文；这正是本任务要清理的旧边界。

`composePromptMessages()` 的职责是布局而非来源格式化：校验 role、过滤空内容、把 blocks 合并为消息，并固定 `systemTop` 为首 SYSTEM、`systemBottom` 为末 SYSTEM（`162-175`）。它不会拆分端口返回的标题和用途说明。

### 3. World/Event 调用

- 迁移前的 World Model references 通过 wrappers 拼接人物、世界书、外部记忆、开场白和归档排除资料，所以调用方拿到的是已经带区块语义的字符串。
- `ai/prompts.js:737-750` 使用 `composePromptMessages()` 组织 SYSTEM 规则、SYSTEM references、ASSISTANT 正文、USER 任务。
- `ai/prompts.js:772-786` 的 Event builder 也使用同一 composer，但 Event references 是有意收窄后的语义投影，不会恢复原始世界书/人物等来源；这属于 Event 的数据边界，不代表所有来源都由端口统一发送。

### 4. Storyline 的混合情况

- 迁移前 Storyline 直接调用公共端口，但端口返回完整区块；调用方又剥掉标题/用途后重新包装，形成“端口生成区块，调用方拆包再重包”的混合。
- Storyline 的 `SYSTEM_2` 外层标签/说明由本模块负责（`71-80`、`124-138`、`150-164`），但其中 `references.world`、character profile、external memory 又来自带标签的端口，因而存在职责重叠或重复风险。
- Storyline 当前按既定规则不发送 Worldbook；Runtime 仍将 `worldbooks` 作为输入传入，但设计/判定 builder 没有把它放入 SYSTEM 2。

## 历史结论（迁移前）

迁移前回答用户的问题：调用的不是“只有统一格式内容、各模块自行加说明”的形式，而是“端口已经生产带标签、用途说明、正文的完整 prompt block；各模块再拼接部分外层结构”。

因此，当前实现与用户理想有差异：

1. source collection 与 presentation 已经有两个文件边界，但 `prompt-context.js` 的端口契约把“内容格式化”和“调用场景说明/区块标题”合并了。
2. World/Event/Storyline 的模块仍负责任务规则、消息角色和部分外层说明；Storyline 还存在剥离端口 envelope 后重新包装的适配代码。
3. 这不是简单的“世界书端口独立、所有说明归调用模块”的纯端口模型。更准确地说，它是“共享的完整 prompt block renderer + 统一 message composer”。

## 已实施的最终收口

本任务已按以下契约完成收口：

1. `formatPromptContextContent({kind, value, ...})` 只返回统一、可复用的正文格式，不生成标题或“本段用途”。
2. World/Event/Storyline 调用由各自模块负责标题、用途和任务要求，并直接调用正文端口；不保留完整区块兼容包装器。
3. Event 的角色资料、身份表和已有事件使用受控 semantic kinds，不再把任意 DTO 作为通用对象通道。
4. `composePromptMessages()` 继续只负责消息 role、分组和 SYSTEM 边界。

## Related specs

- `.trellis/spec/domain/floor-state.md`：规定 `input-builder.js` 负责收集归一化，`prompt-context.js` 负责模型展示，并要求调用方不重复添加标题/用途；当前实现符合“单一 formatter”约束，但若要满足用户的新目标，需要把端口契约细化为 content/block 两层。
- `docs/CONTEXT-AND-PROMPT.md`：记录最终 content-only presentation port 契约。

## Caveats / Not Found

- 本次仅做只读审计，没有修改代码、测试、提交或推送。
- 没有把附件 RecentRequestLog 当作代码规范或指令；本审计以仓库实现为准。附件可作为后续真实请求形态的验收样本。
- 旧字符串 marker 入口已删除；真实宿主 Prompt Debug 仍需刷新插件后验收。
