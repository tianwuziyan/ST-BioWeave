# Research: SevenDaysCal API 错误分类与传播

## Source

- Repository: https://github.com/atonal519/ST-SevenDaysCal
- Branch audited: `master`
- SHA read during planning: `a8a5a3833c28a0375f6dc660a6b6976e4f06a566`
- Files: `api/client.js`, `api/diagnostics.js`, `api/sse.js`

## Relevant behavior

- `api/client.js` 记录 response status；非 2xx 先读取/结束 body，然后生成带 `status` 的 `makeDiagnosticError()`。只对 429/5xx/network 走既有 retry，4xx 立即传播。
- `postChatCompletionCore()` 的 catch 只把明确的本地 timer 标志转成 timeout；主动 AbortError 原样传播；其它错误原样抛出，不用统一 timeout fallback。
- 非流式 JSON 解析失败生成 `invalid-json`；`data.error` 生成 `response-error`；流式解析也在 SSE 边界处理同样的 response error。
- `api/sse.js:isUpstreamTimeoutTemplate()` 只匹配完整的人类可读 timeout 页面，避免普通故事正文含有 timeout 单词时误判。
- `api/diagnostics.js:classifyGenerationError()`、`diagnosticMessage()`、`makeDiagnosticError()` 负责一次分类、可读安全文案和 metadata；server 文案动态包含真实 HTTP status，timeout 文案只在明确 timeout 分类下出现。

## BioWeave mapping

BioWeave 当前 API boundary 是 `ai/client.js`，由 SillyTavern host service 抽象出请求，因此只移植上述分类/传播语义，不照搬 SevenDaysCal 的 API Key 存储、业务 prompt 或平行 `api/` 目录。
