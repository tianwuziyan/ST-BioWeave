# 修复 API 错误分类与状态码传播

## Goal

让 BioWeave 的 API 请求失败在底层完成一次可靠分类，并把真实 HTTP 状态、超时、网络和响应格式错误完整传播到最终 UI。用户至少能区分 `HTTP 400/401/403/404/429/500/502/503` 与真正由本地 `AbortController` 触发的 timeout。

## Background and confirmed facts

- SevenDaysCal 当前 `master`（审计时 SHA `a8a5a3833c28a0375f6dc660a6b6976e4f06a566`）在 `postChatCompletionCore()` 中先记录 `res.status`，HTTP 非 2xx 直接生成带 status 的诊断错误；只有本地 timer 触发时才生成 timeout，其他异常原样传播。`diagnostics.js` 的 `classifyGenerationError()` / `diagnosticMessage()` / `makeDiagnosticError()` 负责单一分类和安全文案，`sse.js` 负责 `isUpstreamTimeoutTemplate()` 及响应解析。
- BioWeave 没有 `api/` 目录；对应请求边界是 `ai/client.js` 的 `runWithTimeout()`、`requestWithRetry()`、`callOpenAICompatible()`、`safeErrorSummary()` 和模型刷新 wrapper。
- `ai/client.js:105-132` 的 `runWithTimeout()` 通过内部 AbortController 和 timer 实现本地超时；`ai/client.js:379-383` 的 `callOpenAICompatible()` 会把所有被 `isAbortError()` 识别的异常重新创建为无原始 metadata 的 `REQUEST_ABORTED`。
- `ai/client.js:167-185` 的 `safeErrorSummary()` 先判断 `REQUEST_TIMEOUT`，再读取 HTTP status；因此带 status 的 timeout-like host error 会丢失 HTTP 文案。它目前也没有把 `SyntaxError`、网络异常、上游 timeout 正文和响应 `error` 统一分类。
- `ai/client.js:279-318` 依赖 SillyTavern `ChatCompletionService` / `generateRaw` 的返回值，但没有统一检查 response-like 返回值的 `ok/status/json()`，所以返回的非 2xx、`{error: ...}` 或上游 timeout 模板可能进入分析解析器。
- `ai/client.js:358-366` 的 `safeModelsError()` 会重新创建 Error，只复制部分 code/status；该 wrapper 需要改为不丢失诊断分类、status 和超时/网络 metadata。
- `ui/app.js:1535-1555` 的 `worldModelOperationError()` 只映射少数业务 code，忽略 API error 的 status/分类；事件分析则依赖 Runtime 的 `safe_error_summary`。UI 不应再次猜测 transport error。
- 当前基线 `npm test` 为 432/432 通过；现有测试已有本地 timeout、网络重试和一个 401 status 检查，但未覆盖本任务要求的完整分类矩阵。

## Requirements

### R1. HTTP status preservation

- 对 HTTP 非 2xx，保留真实 `res.status` 或 host error 中的 status（包括 `statusCode` / `response.status` 等现有兼容形态）。
- HTTP status 优先于外层 timeout/abort-like fallback；不得因为错误的 `name`、`code` 或 message 含 timeout/abort 而覆盖非 2xx。
- 最终 API/分析 UI 文案至少出现对应真实数字：`HTTP 400`、`HTTP 401`、`HTTP 403`、`HTTP 404`、`HTTP 429`、`HTTP 500`、`HTTP 502`、`HTTP 503`。

### R2. Single-point transport classification

在 API client 边界分类一次，保留已有 Error 的 `status`、`name`、`code`，并附加可供 Runtime/UI 使用的诊断 code；外层 wrapper 只能传播或安全格式化，不得把不同错误统一包装为 timeout。

分类结果必须满足：

- 本地 AbortController timer 触发：`timeout` / 现有 `REQUEST_TIMEOUT` 兼容标记；
- fetch、socket、network 异常：`network`；
- HTTP 200 且正文完整匹配上游 timeout 模板：`upstream-timeout`；
- 需要 JSON 而正文无法解析：`invalid-json`；
- 响应 JSON 含 `error`：`response-error`；
- HTTP 非 2xx：按真实 status 分类并保留 status。

### R3. Response boundary

对 BioWeave 当前 host API 返回的 response-like 值进行与 SevenDaysCal 等价的最小处理：先判断 status，再安全读取 JSON/内容；不能把非 2xx、响应错误包、非法 JSON 或上游 timeout 模板当成成功模型正文。

### R4. UI propagation

- World Model、Event Analysis、连接测试和模型刷新等现有调用方继续使用既有 API/Runtime 合同，但最终展示必须使用底层分类和 status。
- 普通产品 UI 不展示原始响应正文、Key 或敏感错误内容；只显示安全且可操作的分类文案。
- 不改变 API Profile、Secret Store、请求参数、重试配置和现有成功响应合同。

### R5. Regression coverage

增加测试覆盖：

- HTTP 400；
- HTTP 401/403；
- HTTP 404；
- HTTP 429；
- HTTP 500/502/503；
- 本地 timeout；
- network failure；
- HTTP 200 + upstream timeout body；
- invalid JSON；
- response `{ error: ... }`。

测试同时断言分类、status/metadata 未丢失、最终安全文案及“HTTP 错误不会变成 timeout”。

## Acceptance Criteria

- [ ] API client 对上述十类场景分别产生稳定诊断分类；HTTP 场景保留真实数字 status。
- [ ] 本地 timeout 仍显示“请求超时”，network 不显示 timeout，HTTP 非 2xx 不显示 timeout。
- [ ] World Model / Event Analysis / API 设置错误路径不重新猜测 transport error；UI 能显示底层 HTTP 数字或对应分类文案。
- [ ] wrapper 不丢失原始 `status`、`name`、`code`；敏感原始 body 仍不会进入 UI、Chat 或日志。
- [ ] 现有成功请求、重试、主动取消和 API Profile/Secret 行为保持不变。
- [ ] `npm test`、`npm run check`、变更 JavaScript 的 `node --check` 全部通过。
- [ ] 需要真实 SillyTavern host 的响应 shape / UI smoke 仍单独记录为验收项，不以 Node fake host 测试冒充完成。

## Out of scope

- 不新增 API provider、改变 Profile/Secret 存储或复制 SevenDaysCal 的明文 API Key 方案。
- 不重做请求重试策略、World Model/Event 数据合同、页面布局或 Toast/Popup 架构；只修复错误分类、传播和对应测试。
- 不把 SevenDaysCal 的 `api/`、`diagnostics.js`、`sse.js` 目录原样搬入 BioWeave；只采用与 BioWeave 当前 `ai/client.js` 边界兼容的分类/传播机制。

## Open questions

无阻塞问题。SevenDaysCal 的当前模板和 BioWeave 的 host 返回 shape 已通过代码与外部源码审计确定；具体实现仍需在修改后用 fake host 和真实 host smoke 分别验证。
