# 技术设计：API 错误分类与状态码传播

## 1. Boundary and ownership

错误分类唯一归属 `ai/client.js`。这里是 BioWeave 进入 SillyTavern `ChatCompletionService` / `generateRaw` 以及模型状态 fetch 的 API 边界，负责把 host 异常或 response-like 返回值归一为带诊断 metadata 的错误。`runtime/event-analysis.js` 只搬运字段并保存安全摘要，`ui/app.js` 只选择业务上下文并显示共享诊断文案。

不新增平行的 `api/` 服务层；SevenDaysCal 的 `diagnostics.js` / `sse.js` 语义以最小 helper 形式落在现有 client 边界，避免重复请求实现和新的抽象层。

## 2. Classification order

按以下顺序处理，保证 HTTP 非 2xx 不被 timeout 或 abort-like fallback 覆盖：

1. 从 response/error 的 `status`、`statusCode`、`response.status` 取合法 HTTP status；非 2xx 先归类为 `http-400`、`auth`、`not-found`、`rate-limit`、`server` 或带数字的 generic HTTP error。
2. 保留本地 timer 的明确 `timedOut` 标记，生成兼容 `REQUEST_TIMEOUT` 与 `timeout` diagnostic code；不能仅凭 controller 已 aborted 推断所有 timeout。
3. 保留外部用户取消为现有 `REQUEST_ABORTED`，但不覆盖已有 HTTP status。
4. 对 2xx response-like body 检查完整上游 timeout 模板、JSON 解析失败和 JSON `error`。
5. 将 `TypeError`、`ECONNRESET`、`ECONNREFUSED`、网络/连接文本等归类为 `network`；`SyntaxError` / JSON reader failure 归类为 `invalid-json`。
6. 已经有明确诊断 code 的错误只补 metadata，不再次猜测；未知错误保持安全 unknown fallback。

## 3. Error contract

诊断 helper 提供 SevenDaysCal 对应语义：

- `classifyGenerationError(error, options)`：返回单一稳定分类；HTTP status 优先；兼容 BioWeave 现有 `REQUEST_TIMEOUT`、`REQUEST_ABORTED`、Profile 和模型错误 code。
- `diagnosticMessage(error, options)`：仅输出安全文案，所有 HTTP 文案包含真实数字；不包含 response body、URL、Key 或模型输出。
- `makeDiagnosticError(code, options)`：用于本地生成的分类错误，设置 `diagnosticCode` / Runtime 使用的下划线字段、status、phase、retryable、attempt、timeout metadata。
- `isUpstreamTimeoutTemplate(value)`：采用 SevenDaysCal 当前完整模板匹配，不使用宽泛 `includes('timeout')`，避免误判正常模型正文。

已有 host Error 尽量原地附加诊断字段，保留其 `name`、`code`、`status`；只有没有可保留对象的本地边界错误才创建新 Error，并通过 `cause`/安全 metadata 保持来源可追踪。

## 4. Request and response flow

```text
ChatCompletionService / generateRaw / model fetch
        ↓
ai/client.js response/error normalization
        ├─ HTTP status → status-bearing diagnostic error
        ├─ local timer → timeout
        ├─ network/socket → network
        ├─ 2xx timeout template → upstream-timeout
        ├─ JSON reader failure → invalid-json
        └─ JSON error envelope → response-error
        ↓
requestWithRetry (只按分类决定重试，不重包错误)
        ↓
analyzer / Runtime (复制 diagnostic fields 与 safe summary)
        ↓
UI shared diagnostic formatter + business context suffix
```

当前请求重试范围保持：可重试的 429/5xx/network 继续按既有 `retry_count` 执行；timeout、用户取消、invalid-json、response-error 和 upstream-timeout 不因为包装变化而被隐式扩大重试范围。若现有 host 抛出带 status 的 timeout-like error，最终 status 分类优先，但是否重试仍由 HTTP status 规则决定。

## 5. UI compatibility

`worldModelOperationError()` 和设置模型刷新错误只保留业务层特有的文案；当错误已带 transport diagnostic 或 HTTP status 时，调用 `ai/client.js` 的共享 formatter，并在必要处追加“上一份模型/事件已保留”。Event Analysis Runtime 继续输出 `error_code` / `safe_error_summary`，但 API diagnostic 同步到 `diagnostic_code`、`error_code`，使现有下划线合同无需 UI 重新解析 `name` / `message`。

## 6. Security and rollback

- 错误 body 只用于判断模板或 `error` 存在，不写入 Chat、调试 DTO 或普通 UI；原始错误只通过 `cause` 留在内存错误链中，安全 summary 不回显。
- 修改集中在 `ai/client.js`、必要的 Runtime/UI 转发和 API/UI 测试；不触碰 Profile/Secret schema。
- 若 fake host 测试发现某种现有 SillyTavern 返回值不是 response-like，回退点是 client normalization helper；不得在 analyzer/UI 增加第二套分类。
