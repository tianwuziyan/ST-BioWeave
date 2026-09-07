# Research: local World Model request shape

- Query: 读取 BioWeave 当前 World Model 链路、API client、提示词、Chat 存储、UI 与测试，定位 Bad Request 可能对应的请求形状，并核对可编辑 World Analysis 提示设置是否真正进入请求。
- Scope: internal
- Date: 2026-09-07

## Findings

### 1. 实际调用链

- `ui/app.js:1182-1208` 在当前 Chat 上收集 AnalysisInput，调用 `analyzer.analyzeWorldModel({analysisInput})`，成功后才写入 `world_model` 与 `world_model_meta`；失败分支保留旧状态并显示安全错误（`ui/app.js:1026-1042,1228-1235`）。来源收集复用 `collectCurrentAnalysisInput()`（`ui/app.js:920-953`），没有另起一套业务读取器。
- `ai/analyzer.js:197-205` 解析 `world_analysis` assignment（回退到 `world`），把 `buildWorldModelPrompt(input.analysisInput ?? input)` 的完整字符串包装成一条 `system` 消息，再交给 `callOpenAICompatible`。
- `ai/prompts.js:54-73` 当前 World Model builder 把固定中文约束、`AnalysisInput:`、序列化后的输入、固定 JSON schema 全部拼成一个字符串；没有生成第二条 `user` 消息。

### 2. 当前代码实际发出的两种形状

`ai/client.js:179-182` 只保证消息是非空数组，否则退回一条 `{role: 'user', content: 'Reply OK.'}`。因此 World Model 当前不是 fallback，而是下列形状：

| Profile | 当前调用 | 关键字段 |
| --- | --- | --- |
| SillyTavern 当前 API | `context.generateRaw({prompt: messages, responseLength: ..., signal})`（`ai/client.js:188-195`） | `prompt` 是长度为 1 的数组，唯一消息为 `role: 'system'`，其 content 包含指令、AnalysisInput 与 schema |
| 独立 Profile | `context.ChatCompletionService.processRequest(payload, {}, true, signal)`（`ai/client.js:197-222`） | `stream:false`、`messages` 同样是长度为 1 的 system 数组，另带 `model`、`chat_completion_source:'custom'`、规范化 `custom_url`、`secret_id`、`max_tokens`、`temperature` |

独立 Profile 的 `secret_id` 来自不透明 `secret_ref`，无引用时使用 `__bioweave_no_secret__`；实现明确不把 `api_key` 放入 payload（`ai/client.js:216-221`）。URL 规范化会拒绝凭证、secret query，并去掉 `/chat/completions` 或 `/completions` 尾缀（`storage/schema.js:184-207`）。

### 3. 已经可以复现的形状不一致

- `tests/world-model.test.js:64-113` 的回归测试名称是 “uses ordinary chat messages for current and independent APIs”，明确期望两条消息，角色顺序为 `['system', 'user']`，并期望 `AnalysisInput` 在第二条 user content 中（`tests/world-model.test.js:105-112`）。
- 当前实现实际只产生 `['system']`。在 2026-09-07 运行 `npm test`：82 个测试中 81 个通过、1 个失败；失败正是 `tests/world-model.test.js:64`，实际 `['system']` 对比期望 `['system','user']`。这不是猜测，而是当前代码与现有回归契约的直接矛盾。
- `tests/api-profile.test.js:289-328` 只 stub `ChatCompletionService.processRequest` 并检查自定义来源、URL、opaque/sentinel `secret_id`；`tests/api-profile.test.js:351-367` 只 stub `generateRaw` 并检查 `prompt` 是数组；这些测试没有穿过宿主实际 HTTP endpoint，也没有捕获独立请求最终由宿主补充的字段。因此它们不能证明上游实际收到的 body 能被目标模型接受。

### 4. Bad Request 的判断

可以确认的风险排序如下：

1. **首先修正消息形状契约**：World Model 现在把“指令”和“待分析证据”塞进单条 system 消息；现有测试、ST-SevenDaysCal 的普通消息构造、Anima 的普通文本请求都采用 system + user 或至少把普通文本规范化为 user。单条 system 未必对所有 OpenAI-compatible endpoint 非法，但它已经违反本仓库的 World Model 测试契约，也增加了只接受 user 输入/要求有效对话起点的兼容性风险。
2. **独立 Profile 的 400 可能来自宿主/上游适配，而不是 JSON parser**：BioWeave 通过宿主 `ChatCompletionService`，实际 HTTP body 由宿主继续加工；本地可读到的 SillyTavern `public/scripts/custom-request.js:421-451,462-480,544-565` 显示该服务会补 `use_sysprompt:true` 并 POST `/api/backends/chat-completions/generate`。如果用户运行的宿主版本、后端 source 或兼容端点契约不同，`chat_completion_source:'custom'`、`custom_url`、`secret_id`、`use_sysprompt` 或可选生成参数都可能成为 400 的来源。当前测试没有验证这一层。
3. **不能把 400 归因于 `generateRaw` 接收数组**：同一份本地可读 SillyTavern 源码在 `public/script.js:3865-3920,3941-3951,4063-4091` 明确支持 `prompt` 为 `string | object[]`，数组会作为 chat-style messages 处理。若用户的宿主版本接近该实现，`generateRaw({prompt: [...]})` 本身是合法调用；但该 `/tmp` 源码版本未被项目锁定，仍需以实际宿主版本和网络响应为准。
4. **当前错误摘要丢失了最有价值的证据**：`ai/client.js:157-174` 把 HTTP 400/404 统一显示为“配置或地址错误”，不保留上游响应 body。没有实际 HTTP status、宿主日志或脱敏后的 upstream error body，无法进一步区分 message 形状、模型名、URL、`max_tokens`/`temperature` 或 provider-specific 参数。

### 5. 本地“可编辑提示词/标签”目前是断线的

- `storage/schema.js:19-50` 已定义 `DEFAULT_WORLD_ANALYSIS_PROMPT`，包括可编辑 task、input prefix/suffix 与四个分段标签；`storage/schema.js:37-50` 只保留提示文本/标签并限制长度，不允许其它设置或 Secret 混入。
- UI 已完整提供编辑与保存：`ui/settings.js:576-609` 渲染字段并明确说明核心约束/结果校验仍保留且不保存正文或 API Key；`storage/store.js:377-385` 规范化并持久化；`ui/app.js:1523-1572` 读取草稿、保存并处理失败保留。
- `ui/app.js:396-402` 甚至把 `worldModelPromptResolver` 传给 `createAnalyzer`。但 `ai/analyzer.js:186-205` 的 `createAnalyzer` 只解构 `profileResolver`、`contextResolver`，`analyzeWorldModel` 也没有调用该 resolver；它始终调用不接收设置参数的 `buildWorldModelPrompt`。因此当前设置页的 World Analysis 提示词和标签虽然能保存，却不会影响发送内容。这是代码事实，与 HTTP 400 是不同的、可独立复现的功能缺口。

### 6. 当前存储/UI 边界没有显示为 Bad Request 根因

- World Model schema/解析在 `ai/analyzer.js:4-110,112-155`，UI 仅在模型通过规范化后保存（`ui/app.js:1124-1172,1182-1227`）；它不会把原始 AI 文本写进 Chat。
- `storage/schema.js:302-313`/空 Chat 结构与 `tests/world-model.test.js:131-145` 只保存 World Model 和计数摘要，不保存 AnalysisInput 正文；`tests/world-model.test.js:136-145` 也验证了 source 正文不会进入摘要。
- `ui/world.js:31-40,97-200,203-250` 的中文空值显示、结构化编辑与重新分析按钮均发生在请求前/请求后，不改变 API body。因此当前 Bad Request 调查应优先看 prompt/message 与宿主 API 边界，不应扩大到 World Model 存储或 UI。

## Files found

- `ai/client.js` — 当前 API 与独立 Profile 的宿主调用、重试和安全错误摘要。
- `ai/analyzer.js` — World Model prompt 调用、响应提取、schema 校验和失败语义。
- `ai/prompts.js` — World Model 固定 prompt/schema builder。
- `ui/app.js` — profile assignment、可编辑 prompt resolver、AnalysisInput 收集、请求后 Chat 保存。
- `ui/world.js` — World Model 中文查看/编辑/重新分析页面。
- `storage/schema.js` — API URL/Secret 规范化、World Analysis prompt 设置和 Chat schema。
- `storage/store.js` — World Analysis prompt 的全局设置读写。
- `ui/settings.js` — World Analysis 可编辑提示词/标签设置 UI。
- `tests/world-model.test.js` — 当前消息角色期望、失败保留、schema/UI 回归测试。
- `tests/api-profile.test.js` — 宿主 API 调用 stub、opaque secret 与模型 endpoint 测试。
- `.trellis/spec/frontend/state-management.md` — API Profile/Secret Store contract 与测试要求。
- `.trellis/tasks/09-07-world-model-v1/prd.md` — 本轮 World Model 目标与验收标准。
- `.trellis/tasks/09-07-world-model-v1/design.md` — 变更边界、Prompt、Chat-local 保存设计。

## Code patterns

- `ai/analyzer.js:197-205`：World Model 目前只组装一条 system message。
- `ai/client.js:188-222`：两条 provider 路径的准确 payload 边界。
- `tests/world-model.test.js:105-112`：仓库已经写明的 system + user 形状契约。
- `ui/app.js:396-402` 与 `ai/analyzer.js:186-205`：prompt resolver 传入但未消费的断点。
- `ai/client.js:216-221`、`storage/schema.js:184-207`：只传 secret 引用、不传 secret 值的安全模式。
- `.trellis/spec/frontend/state-management.md:297-301,342-350,375-378`：独立请求使用宿主 ChatCompletionService，当前 API 使用 generateRaw，且要求 opaque/sentinel secret 与捕获请求测试。

## External references

- 本地可读的 SillyTavern host source（未纳入 BioWeave、版本未锁定）：`/tmp/sillytavern.g6hpgu/public/script.js:3865-3920,3941-3951,4063-4091`；`/tmp/sillytavern.g6hpgu/public/scripts/custom-request.js:421-451,462-480,544-565`。它只用于核对宿主公开方法的形状，不作为稳定依赖结论。

## Related specs

- `design.md:5-16` 要求复用 `ai/client.js` 请求边界，不新增复杂 Provider，并冻结 API/Secret、来源读取器及其它业务层。
- `design.md:53-61` 要求请求、解析和 schema 成功后才替换模型，且 World Analysis 只接收最小 prompt 与 AnalysisInput。
- `state-management.md:297-301` 规定独立请求用 `ChatCompletionService.processRequest`，当前 API 用 `context.generateRaw`；`state-management.md:349-350` 禁止无 secret 引用时回落宿主当前 Key。

## Caveats / Not Found

- 当前证据能确定“单 system 与测试契约不一致”以及“可编辑 prompt resolver 未接通”，但不能在没有实际宿主日志/响应 body 的情况下证明某一次 400 只由其中一项触发。
- `/tmp/sillytavern.g6hpgu` 是可用的本地源码副本，未从 BioWeave 配置中读取版本；若目标用户的 SillyTavern 版本不同，`processRequest` 的内部字段可能变化。
- 未读取或修改任何生产代码；本轮只运行了测试并写入本任务 `research/`。
