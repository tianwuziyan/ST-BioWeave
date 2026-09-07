# Research: Anima-Memory-System 提示块、可编辑内容与普通文本请求

- Query: 核对 Anima-Memory-System 的普通文本 API、总结提示块、状态提示块、校准提示块和可编辑内容的组织方式，判断哪些模式可作为 BioWeave World Model 的小型参考。
- Scope: external
- Date: 2026-09-07

## Findings

### Source/version

本次按固定提交阅读 GitHub 源码：

- Repo: [Ellinav/Anima-Memory-System](https://github.com/Ellinav/Anima-Memory-System)
- Observed default branch commit: `d92dfc4dc741386962091ac149a7ed4b4b04e95d` (`3.3.6`, 2026-08-10)。对应固定源码：[`scripts/api.js`](https://github.com/Ellinav/Anima-Memory-System/blob/d92dfc4dc741386962091ac149a7ed4b4b04e95d/scripts/api.js)、[`scripts/summary_logic.js`](https://github.com/Ellinav/Anima-Memory-System/blob/d92dfc4dc741386962091ac149a7ed4b4b04e95d/scripts/summary_logic.js)、[`scripts/summary.js`](https://github.com/Ellinav/Anima-Memory-System/blob/d92dfc4dc741386962091ac149a7ed4b4b04e95d/scripts/summary.js)、[`scripts/status_logic.js`](https://github.com/Ellinav/Anima-Memory-System/blob/d92dfc4dc741386962091ac149a7ed4b4b04e95d/scripts/status_logic.js)、[`scripts/status.js`](https://github.com/Ellinav/Anima-Memory-System/blob/d92dfc4dc741386962091ac149a7ed4b4b04e95d/scripts/status.js)、[`index.js`](https://github.com/Ellinav/Anima-Memory-System/blob/d92dfc4dc741386962091ac149a7ed4b4b04e95d/index.js)、[`config/default_status_prompts.js`](https://github.com/Ellinav/Anima-Memory-System/blob/d92dfc4dc741386962091ac149a7ed4b4b04e95d/config/default_status_prompts.js)、[`config/default_gc_prompts.js`](https://github.com/Ellinav/Anima-Memory-System/blob/d92dfc4dc741386962091ac149a7ed4b4b04e95d/config/default_gc_prompts.js)。

### 1. 普通文本/消息数组的实现

- `scripts/api.js:4-45` 为 `llm`、`status` 等用途分别保存 source、URL、Key、model、stream、temperature 和 max output；这说明“同一插件内按用途路由”是配置层能力，不等于要增加新的 Provider 类型。
- `scripts/api.js:92-165` 的非流式 `proxyFetch` 不让浏览器直接访问第三方 URL，而是 POST 到 `/api/plugins/anima-rag/proxy/forward`，外层 JSON 包含 `targetUrl`、method、headers、body、`isStream:false`；流式路径从 `scripts/api.js:167-200` 继续使用相同的后端 proxy。
- `scripts/api.js:1448-1506` 的 `generateText(promptOrMessages, purpose, overrideConfig, requestOptions)` 先检查 abort/config，再做最小标准化：字符串变为 `[{role:'user', content: prompt}]`，数组则原样作为 messages。普通字符串请求的角色不是 system，而是 user。
- OpenAI-compatible 分支在 `scripts/api.js:1764-1800` 做角色兼容：对话已经开始后出现的 system 会映射为 user；URL 规范化为 `/chat/completions`；body 为 `{model, messages, temperature, max_tokens, top_p:1, stream}`。`scripts/api.js:1811-1829` 通过 proxy 发 POST，并保留上游错误摘要；`scripts/api.js:1835-1872` 处理 `choices[0].message.content`、reasoning_content 和 text。
- 这给 BioWeave 的直接启示是：
  - 单纯字符串输入应成为 user message；
  - 多段规则/证据用 message array 表达；
  - provider-specific 兼容应集中在既有 client boundary，而不是让 World Model 复制业务请求代码。

### 2. 总结模块的提示块模型

- `scripts/summary_logic.js:18-49` 的默认 `summary_messages` 混合三类内容：`char_info`、`user_info`、`prev_summaries` 等特殊块；普通 system 规则；`{{context}}` user 块；总结格式要求 user 块。
- `scripts/summary_logic.js:56-149` 将全局 extension settings 与当前 Chat 的 `chatMetadata.anima_config` 合并；`scripts/summary_logic.js:151-190` 只把全局设置写回 extension settings，把 automation/exclude_user 等局部值写回 Chat metadata。这是“全局提示配置”和“Chat-local 小设置”分层的具体实现。
- `scripts/summary_logic.js:273-350` 的 `requestSummaryFromAPI` 按 `summary_messages` 顺序生成 raw segments：
  - `char_info`/`user_info` 注入角色卡/用户设定并按条目 role 发送（`297-307`）；
  - `prev_summaries` 读取前文总结（`310-320`）；
  - 含 `{{context}}` 的块把聊天上下文改成带 `userName:`/`assistant:` 前缀的 user content（`323-343`）；
  - 普通文本使用条目自己的 `role` 和 `processMacros(item.content)`（`345-350`）。
- `scripts/summary_logic.js:353-377` 会把相邻同 role 的 segment 用双换行合并，最终把 message array 交给 `generateText(finalMessages, 'llm')`。它没有把所有内容粗暴拼成一个 system 字符串。
- `scripts/summary.js:483-674` 的 UI 将特殊块显示为可开关/占位符，将普通块显示为 role tag、title、编辑/删除按钮、role select 和 textarea；普通块进入编辑模式后，`role/title/content` 都可修改（`644-674`）。
- `scripts/summary.js:748-867` 支持添加普通块、拖拽排序、JSON 导入/导出和保存。`summary_messages` 是用户可编辑的消息序列，而不是隐藏在一段不可分割的 prompt 中。

### 3. 状态提示块与校准提示块

- `scripts/status_logic.js:63-103` 默认状态提示规则保留 `char_info`、`user_info`、`{{status}}` 和 `{{chat_context}}` 等特殊类型；`config/default_status_prompts.js:2-67` 给出更完整的默认规则序列。
- `scripts/status_logic.js:122-145` 读取当前角色卡 `extensions.anima_prompt_config`，存在时覆盖默认 `prompt_rules`；没有角色卡时回退到代码默认。`scripts/status_logic.js:265-281` 对 GC/校准提示类似地读取 `anima_gc_prompts`，默认值来自 `DEFAULT_GC_PROMPTS`。
- `scripts/status_logic.js:506-584` 的 `constructStatusPrompt` 逐条处理规则：关闭的跳过；`char_info`/`user_info` 注入宏；`{{chat_context}}` 注入增量剧情；`{{status}}` 替换为 YAML；普通文本执行宏替换；相邻相同 role 合并成双换行 message。`scripts/status_logic.js:618-654` 将最终 messages 交给 `generateText(messages, 'status')`。
- `config/default_gc_prompts.js:1-74` 与默认状态 prompt 一样，使用 normal/special placeholder 条目，而不是新建 provider 或复制一套 HTTP client。
- `index.js:400-455` 和 `index.js:484-544` 会在角色卡没有有效自定义规则时注入默认 `anima_prompt_config`/`anima_gc_prompts`，并保存到角色卡扩展字段；这解释了默认规则与角色卡级覆盖的关系。

### 4. 状态提示块的可编辑 UI 与持久化

- `scripts/status.js:1560-1599` 将 char/user special items 显示为可拖拽、可启用/停用；`scripts/status.js:1600-1628` 将 status/context placeholder 显示为专用插入位。
- `scripts/status.js:1637-1714` 将普通提示条目显示为 role/title/content；编辑时开放 system/user/assistant 选择和 textarea，确认后更新 `msg.role`、`msg.title`、`msg.content`。
- `scripts/status.js:3473-3568` 支持添加普通规则、JSON 导入/导出，并把当前 `prompt_rules` 写回 `anima_prompt_config`；`status_logic.js:821-844` 的 `saveSettingsToCharacterCard` 通过宿主 `writeExtensionField` 保存，不把它们复制到 API 请求配置。

### 5. 对 BioWeave 的可迁移模式

- 可迁移的是“固定核心合同 + 可编辑附加块 + 普通 message array + 相邻 role 合并”的结构：它可以直接帮助 World Model 修正 system/user 消息边界。
- 不应迁移的是 Anima 的原始 API key 配置模型：`scripts/api.js:7-27` 将 key 放在扩展设置中，并在 UI/预设中管理；BioWeave 已有 Secret Store/opaque `secret_ref` 合同，必须保持现状。
- Anima 的角色卡提示配置会包含大量状态/校准业务占位符，不应复制到 World Model；World Model 只需要少量可编辑 task/input prefix/suffix/labels，并保留自己的固定 schema 与 capability null 约束。

## Files found

- `scripts/api.js` — 普通字符串/消息数组标准化、OpenAI-compatible 请求 body、后端 proxy、响应解析。
- `scripts/summary_logic.js` — 总结提示块读取、普通文本处理、上下文注入、相邻 role 合并、调用 API。
- `scripts/summary.js` — 总结 prompt block 的编辑/排序/导入/导出 UI。
- `scripts/status_logic.js` — 状态/校准 prompt block 的读取、宏替换、消息构造、API 调用与角色卡保存。
- `scripts/status.js` — 状态 prompt block 编辑、启停、排序、导入/导出 UI。
- `index.js` — 默认状态/校准规则注入角色卡扩展字段的启动逻辑。
- `config/default_status_prompts.js` — 状态更新默认提示块。
- `config/default_gc_prompts.js` — 状态校准默认提示块。

## Code patterns

- String-to-user normalization: `scripts/api.js:1499-1506`。
- OpenAI-compatible request body/proxy: `scripts/api.js:1764-1829`。
- Editable summary blocks and ordinary text path: `scripts/summary_logic.js:273-377`、`scripts/summary.js:574-674`。
- Editable status blocks and special placeholders: `scripts/status_logic.js:506-584`、`scripts/status.js:1560-1714`。
- Character-card persistence: `scripts/status_logic.js:821-844`、`index.js:400-455,484-544`。

## External references

- 固定提交的源码页面见本文件 “Source/version” 小节；对应 raw URL：
  - `https://raw.githubusercontent.com/Ellinav/Anima-Memory-System/d92dfc4dc741386962091ac149a7ed4b4b04e95d/scripts/api.js`
  - `https://raw.githubusercontent.com/Ellinav/Anima-Memory-System/d92dfc4dc741386962091ac149a7ed4b4b04e95d/scripts/summary_logic.js`
  - `https://raw.githubusercontent.com/Ellinav/Anima-Memory-System/d92dfc4dc741386962091ac149a7ed4b4b04e95d/scripts/summary.js`
  - `https://raw.githubusercontent.com/Ellinav/Anima-Memory-System/d92dfc4dc741386962091ac149a7ed4b4b04e95d/scripts/status_logic.js`
  - `https://raw.githubusercontent.com/Ellinav/Anima-Memory-System/d92dfc4dc741386962091ac149a7ed4b4b04e95d/scripts/status.js`
  - `https://raw.githubusercontent.com/Ellinav/Anima-Memory-System/d92dfc4dc741386962091ac149a7ed4b4b04e95d/index.js`

## Related specs

- BioWeave `.trellis/spec/frontend/state-management.md:72-78,297-310,349-364` 禁止保存 API key，只允许保留 `secret_ref`/`secret_id`，所以 Anima 的 key storage 只能作为反例。
- BioWeave `.trellis/tasks/09-07-world-model-v1/design.md:5-16,53-61` 要求 World Model 复用已有 API/AnalysisInput 边界，不进入 State/Context，也不新增复杂业务读取器。

## Caveats / Not Found

- Anima 的源码版本固定为 3.3.6 commit；其当前实现包含状态、校准、世界书等大量业务，本文只抽取消息与可编辑配置模式，不建议复制整套业务代码。
- Anima 的普通 OpenAI-compatible body 看起来标准，但它通过自有 `/api/plugins/anima-rag/proxy/forward`，不能直接替换 BioWeave 的 SillyTavern host adapter。
- 本轮只读取固定源码并记录证据，没有修改 Anima、BioWeave 生产代码或任何外部配置。
