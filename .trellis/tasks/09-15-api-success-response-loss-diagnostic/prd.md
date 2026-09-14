# 诊断 API 成功返回后 BioWeave 响应丢失

## Goal

精确定位第三方 API 已成功返回之后，BioWeave 响应在哪一个调用链边界丢失、被错误分类、被重复消费、被本地 timeout 中止，或因返回结构不匹配而在 Analyzer 中变为空结果。

本轮只增加可回滚的开发环境元数据 TRACE 和覆盖真实返回形态的回归测试；不修复已发现的问题，不改变现有生产行为。

## Confirmed context

- 已知请求可以从 BioWeave 发出，服务商确认请求成功且已生成并返回响应。
- 需要审计的链路是 `ai/client.js` → `callOpenAICompatible()` → `runCurrentApi()` / `runIndependentApi()` → `ChatCompletionService.processRequest()` 或 `fetch()` → `normalizeResponseLike()` → `ai/analyzer.js` → `responseText()` → World Model / Event parser → Runtime → UI。
- 当前不能先验把问题归因于 API、Prompt、JSON Schema 或 transport；结论必须由本地代码证据与 TRACE checkpoint 支持。
- 当前 worktree 起始状态干净；不得覆盖或撤销既有工作。
- 当前 client 已有针对 HTTP 200 body/SSE 读取卡住并触发本地 timeout 的回归测试，但尚未覆盖成功完成的各类正文形态和 TRACE checkpoint。
- 静态证据显示 `normalizeResponseLike()` 在 `Response` 同时存在 `json()` 时优先调用 `json()`，只有没有 `json()` 时才使用 `text()` / `body.getReader()`；一次性探针以 HTTP 200 标准 `Response` 携带 SSE body 时得到 `invalid-json`，status 保留为 200。这是待通过正式诊断测试和 TRACE 进一步确认的高概率断点，不是本轮修复目标。
- `ai/analyzer.js` 的 `responseText()` 当前已覆盖 string、顶层 `text` / `content`、OpenAI `choices[0].message.content`、`choices[0].text` 和嵌套 `data`；需要验证这些形态是否在 client 返回值进入 Analyzer 后保持不变。

## Requirements

### R1. 完整静态调用链审计

记录每个调用链步骤的真实文件与行号、输入和返回值类型、`await` 边界、AbortSignal 传递、timeout 作用范围、Response body 消费位置、JSON 解析位置以及 error/catch 位置。

审计必须明确：

- `ChatCompletionService.processRequest()` 的实际返回值与当前调用方假设是否一致。
- 独立 API 的 `fetch('/api/backends/chat-completions/generate')` 返回的 `Response` 是否会被 `json()`、`text()`、`body` 重复消费。
- `normalizeResponseLike()` 是否可能误判成功 Response、再次处理已解析对象、丢失 `content`，或因 body 读取在 timeout 内未完成而失败。
- `responsePayloadText()` / `responseText()` 是否覆盖 `{content}`, OpenAI `choices.message.content`, `choices.text`, string, Response 以及项目实际返回格式。
- `runWithTimeout()` 的 Promise race 与 AbortController 是否可能在 HTTP 成功但 body consumption 未完成时触发本地 timeout 或中止读取。
- Analyzer 接收 `callOpenAICompatible()` 返回值后，是否会因结构不匹配使 `responseText()` 为空，并如何进入 parser、Runtime 与 UI。

### R2. 安全的开发环境 TRACE

在不改变成功/失败控制流的前提下，为实际调用链增加统一前缀 `[BioWeave API TRACE]` 的 metadata-only 日志。日志不得包含 API Key、Authorization、Secret、完整 Prompt、用户聊天正文或完整模型返回正文。

至少提供这些 checkpoint：

- `request-start`: transport、model、stream、timeout、timestamp。
- `transport-resolved`: `typeof result`、constructor name、Response-like 判断、status、ok、是否有 `json()` / `text()` / `body`、顶层 keys。
- `normalize-start`。
- `body-read-start`。
- `body-read-complete`: body length、识别到的 payload 类型，不记录正文。
- `normalize-complete`: 返回对象 keys、content 是否存在、content 长度、choices 是否存在。
- `analyzer-received`: raw 类型、keys、`responseText` 长度。
- `parser-start`。
- `parser-success` 或 `parser-error`: 只记录 error code / diagnostic code，不记录原始响应。
- `runtime-success` 或 `runtime-error`。

对 transport/body 阶段还必须能区分：HTTP Response 已返回、`response.json()` 开始/成功/抛错、Content-Type、`bodyUsed` 前后、`response.text()` / reader 是否实际调用、normalize 最终返回/抛错、`invalid-json`、以及 headers 到达后 body 完成前发生的 timeout/abort。

SSE 诊断还必须记录 status、Content-Type、body length、`data:` 行数量、是否进入 `responseJsonFromText()`，以及是否成功提取 `choice.delta.content`、`message.content` 或 `text`；绝不记录这些字段的正文值。

日志必须能判断请求在“API 服务商成功返回”之后最后到达的 checkpoint；开发环境开关必须遵循项目现有环境判断方式，测试中不得污染默认控制台行为。

### R3. 返回形态回归测试

补充不改变生产行为的自动化测试，覆盖以下链路：

1. `processRequest()` 返回 `{ content: '{"schema_version":"test"}' }`。
2. `processRequest()` 返回 OpenAI 格式 `choices[0].message.content`。
3. `fetch()` 返回标准 `Response` 与 JSON body。
4. `fetch()` 返回 text/event-stream 风格 SSE body。
5. HTTP 200 但 body reader 延迟完成。

每种形态都必须验证从 `callOpenAICompatible()`、`normalizeResponseLike()` 到 Analyzer `responseText()` 的正文不会无故丢失；如果当前行为确实失败，测试应先固定可观察的失败/断点，不得为了让测试通过而修改生产解析或 timeout 语义。

### R4. 诊断报告

最终报告必须基于当前代码与测试结果，包含：

1. 真实调用链。
2. 按概率排序的最可疑三个断点。
3. 每个判断对应的文件/行号证据。
4. 新增 TRACE checkpoint。
5. 在真实 SillyTavern 中的最小复现步骤。
6. 复现后需要回传的 TRACE 日志字段。
7. 测试命令、结果、未覆盖范围与仍需真实宿主验收的部分。

## Constraints / Out of scope

- 不修改 transport 实现，不把独立 `fetch()` 改回 `ChatCompletionService`。
- 不修改 API Profile、Secret Store、Prompt、World Model Schema、Event Schema、parser 宽容度或默认 timeout。
- 不进行重构，不改变现有业务返回格式、错误分类、重试、取消和 Runtime/UI 行为。
- 不打印或持久化敏感数据、Prompt、用户聊天正文或完整模型输出。
- 不提交 commit，不 push，不 merge。
- 不把 Node 自动化测试结果当作真实 SillyTavern/浏览器验收；真实宿主复现单独报告。

## Acceptance Criteria

- [ ] 静态审计覆盖调用链各步骤的类型、await、AbortSignal、timeout、body 消费、JSON 解析和 catch 边界，并有可引用的文件/行号证据。
- [ ] `processRequest()` 与独立 `fetch()` 的实际返回形态和调用方假设均已验证，重复消费与 200-body-read-timeout 风险有明确结论。
- [ ] TRACE 仅记录安全 metadata，包含 R2 所列 checkpoint，并能定位 API 成功返回后的最后到达层。
- [ ] 返回形态测试覆盖 R3 五类场景，且测试不会修改生产行为或放宽 parser/schema。
- [ ] `npm run check`、必要的定向测试以及 `git diff --check` 有实际结果记录。
- [ ] 最终报告给出按概率排序的三个断点、代码证据、复现与日志回传指南，并明确哪些结论仍需真实 SillyTavern 验收。
- [ ] 未提交、未 push、未 merge，且所有修改仅限本任务允许的诊断日志、测试和 Trellis 任务文档。

## Open questions

无。用户已明确诊断范围、禁止项、日志字段和测试形态；实现前仍需完成规划审阅门。
