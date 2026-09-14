# 执行计划：API 错误分类与状态码传播

## Before implementation

- [x] 记录当前 worktree 为 clean（任务规划文件除外）。
- [x] 记录基线 `npm test`：432/432 通过。
- [x] 对照 SevenDaysCal 当前 master SHA `a8a5a3833c28a0375f6dc660a6b6976e4f06a566` 的 `api/client.js`、`api/diagnostics.js`、`api/sse.js`。
- [x] 确认 BioWeave 实际入口为 `ai/client.js`，不直接新建平行 `api/` 目录。
- [x] 通过 `task.py validate`、`task.py start` 前的 planning review gate。

## Ordered implementation checklist

1. **建立共享诊断 helper（写入 `ai/client.js`）** ✅
   - 增加并导出 `classifyGenerationError()`、`diagnosticMessage()`、`makeDiagnosticError()` 和 `isUpstreamTimeoutTemplate()` 的 BioWeave 兼容语义。
   - status-first；本地 timer 以明确标记生成 timeout；保留旧 `REQUEST_TIMEOUT` / `REQUEST_ABORTED` 合同。
   - 修改 `safeErrorSummary()` 复用共享 formatter，保留现有安全文案兼容性并确保所有 HTTP 数字可见。

2. **收紧 API response/error boundary（`ai/client.js`）** ✅
   - 归一化 `runCurrentApi()` / `runIndependentApi()` 的 response-like 返回值：非 2xx、`{error: ...}`、invalid JSON 和完整 upstream timeout body 均抛带分类错误。
   - 将 `SyntaxError`、fetch/socket/network 异常转为对应分类；HTTP status-bearing error 原地附加诊断字段。
   - 调整 `runWithTimeout()` / `callOpenAICompatible()` 的 catch 顺序，只有本地 timer 才能覆盖为 timeout，HTTP status 不被 abort/timeout fallback 丢弃。
   - 修正 `safeModelsError()` 的重包装，保留 status 与诊断 metadata，不暴露上游敏感正文。

3. **保持跨层字段传播（`runtime/event-analysis.js`、`ui/app.js`）** ✅
   - Runtime 把底层 diagnostic code/status 映射到既有 `error_code` / `safe_error_summary`，不新增二次分类。
   - World Model、Event Analysis、模型刷新错误显示复用 client formatter；业务上下文只追加既有“结果保留”提示。
   - 不改变成功响应、Toast 类型、Profile/Secret 或业务数据合同。

4. **补齐回归测试** ✅
   - `tests/api-profile.test.js`：参数化 HTTP 400/401/403/404/429/500/502/503、local timeout、network、200 upstream timeout、invalid JSON、response error；断言 status、分类、summary、重试边界和原始 metadata。
   - `tests/event-analysis-runtime.test.js`：API diagnostic 从 analyzer 到 Runtime status 不丢失，并保持安全摘要。
   - `tests/ui.test.js`：World Model/设置错误路径显示共享 HTTP 数字与分类，不再显示 timeout/generic fallback。

## Validation commands

```bash
npm test
npm run check
node --check ai/client.js
node --check runtime/event-analysis.js
node --check ui/app.js
git diff --check
```

## Review gates and rollback points

- 每一阶段只允许修改列出的文件；发现与当前 worktree 现有改动重叠时停止并重新审计。
- 完成 client helper 后先运行 `tests/api-profile.test.js`，确认旧 timeout/abort/retry 测试仍通过，再进入 Runtime/UI。
- 完成跨层修改后运行完整测试和静态检查，由主 agent 检查真实 diff、状态保留和敏感信息边界。
- 不执行 commit、push、merge 或 destructive Git 操作；发布需要另行授权。
- 自动化通过后仍需真实 SillyTavern host smoke：至少验证一个非 2xx、一个本地超时、一个网络失败和一个 200 timeout 模板响应。
