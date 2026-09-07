# Research: Anima-Memory-System 消息格式与可编辑 prompt blocks

- Query: 核对 Anima-Memory-System 的普通文本请求、OpenAI-compatible message 清洗、提示块/可编辑内容及 global/chat/character 保存边界。
- Scope: external
- Date: 2026-09-07

## Findings

### Files found

- [`scripts/api.js`](https://raw.githubusercontent.com/Ellinav/Anima-Memory-System/main/scripts/api.js) — `generateText` 的 string/array 归一化、OpenAI messages body、代理和响应提取。
- [`scripts/summary_logic.js`](https://raw.githubusercontent.com/Ellinav/Anima-Memory-System/main/scripts/summary_logic.js) — 可编辑 `summary_messages` blocks、占位符、role 合并和摘要调用。
- [`config/default_status_prompts.js`](https://raw.githubusercontent.com/Ellinav/Anima-Memory-System/main/config/default_status_prompts.js) — status prompt block 默认结构。
- [`config/default_gc_prompts.js`](https://raw.githubusercontent.com/Ellinav/Anima-Memory-System/main/config/default_gc_prompts.js) — GC/calibration prompt block 默认结构。
- [`index.js`](https://raw.githubusercontent.com/Ellinav/Anima-Memory-System/main/index.js) — 从角色卡 extension 读取/注入可编辑 prompt blocks 的生命周期。

Retrieved from `Ellinav/Anima-Memory-System`, `main`, on 2026-09-07. 该仓库的 `key` 是可读配置，不符合 BioWeave 不保存 secret 的约束。

### Ordinary text and request message format

- `generateText(promptOrMessages, ...)` 在 `scripts/api.js:1448-1505` 处理输入：字符串被明确归一化为 `[{ role: 'user', content: promptOrMessages }]`；数组则直接作为 messages 使用。
- 这给出最小映射：普通文本请求应是 user message；如果需要固定规则，应显式提供 system message，再提供 user message。不要把普通文本误放成唯一 system message。
- OpenAI-compatible 分支在 `scripts/api.js:1764-1800` 构造最终请求：system 出现在对话开始之后会被转成 user，body 核心字段是 `{model, messages, temperature, max_tokens, top_p, stream}`。
- 请求经内部 proxy 发送，headers/body 见 `scripts/api.js:1808-1820`；非流式结果优先取 `choices[0].message.content`，并兼容 reasoning/text：`scripts/api.js:1835-1872`。
- 对 BioWeave 来说，这支持如下最小形状：

  ```js
  [
    { role: 'system', content: '<固定分析规则/schema>' },
    { role: 'user', content: 'AnalysisInput:\n<JSON>' },
  ]
  ```

  其中 `AnalysisInput` 不需要复制 Anima 的 status/RAG/summary 业务包装。

### Prompt blocks and editable content

- Anima 的默认摘要 blocks 在 `scripts/summary_logic.js:18-49`：既有 `type` 型动态块（`char_info`、`user_info`、`prev_summaries`），也有普通 `{role, content}` 文本块，并使用 `{{context}}` 占位符。
- `requestSummaryFromAPI()` 在 `scripts/summary_logic.js:286-351` 顺序处理 blocks：动态块按 type 插入内容，`{{context}}` 生成一条 user message，普通文本保留 `item.role` 和 `item.content`。
- 最终会合并相邻同 role 的片段，再调用 `generateText(finalMessages, 'llm')`：`scripts/summary_logic.js:353-377`。可借鉴的最小数据模型是 `role + content`，`enabled`/`count` 只在确有动态块需要时增加。
- status 默认块也体现相同结构：`config/default_status_prompts.js:2-12`、`21-49`、`56-67`；GC 默认块包含 `type`、`role`、`title`、`content`、`floors` 等字段：`config/default_gc_prompts.js:1-13`、`23-58`。这些复杂字段是 Anima 自身状态/GC 业务，不应整体搬进 BioWeave World Model。
- Anima 的摘要 global/local 配置读取和保存分离：`scripts/summary_logic.js:56-190`；可编辑 prompt blocks 依赖 `extensionSettings`，Chat-local 的 `anima_config` 只存运行开关等局部设置。
- 角色切换时，Anima 从角色卡 `character.data.extensions.anima_prompt_config` 读取；没有自定义内容时深拷贝默认 blocks 并写回角色卡，status 流程见 `index.js:401-467`，GC 流程见 `index.js:482-545`。这证明“可编辑 prompt”可以有明确 owner，但 BioWeave 当前 PRD 不要求角色卡写回，因此不应引入这个持久化面。

### Minimum mapping to BioWeave

1. 先修正消息层次：固定 World Model 指令/schema 为 system，`AnalysisInput` 为 user；这同时满足本地 World Model 测试和 ST/Anima 的普通文本语义。
2. 若要开放 prompt 编辑，只映射一个 World Analysis task block（最小字段 `content`，必要时 `enabled`），放到 BioWeave 现有 `prompts.task`；不复制 Anima 的 char/user/status/RAG block 类型。
3. `{{context}}` 的思想可映射为一次性 AnalysisInput 占位，但当前 BioWeave 已在 analyzer 前构造 AnalysisInput，优先直接传值，避免再造一层模板解释器。
4. Anima 的 key/url/model 全部保存在 extension config（`scripts/api.js:4-52`、`1448-1494`），不能作为 BioWeave 的存储方案；BioWeave 继续使用现有 `secret_ref` 和宿主 secret API。

## Related specs

- `.trellis/tasks/09-07-world-model-v1/prd.md`、`design.md` — World Model 固定 schema、Chat-local 结果、无 secret 持久化。
- `.trellis/spec/guides/code-reuse-thinking-guide.md` — 复用边界而非复制业务模块。

## Caveats / Not Found

- Anima 的 OpenAI-compatible 分支在浏览器/插件代理里自带 key；其请求形状可作消息格式参考，但不能作 BioWeave secret 生命周期参考。
- Anima 的 prompt blocks 服务于状态摘要/GC，不等价于 World Model schema；这里只抽取 `role/content` 和保存分层。
- 未修改远端或本地生产文件。
