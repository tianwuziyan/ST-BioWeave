# Research: API 错误后悬浮图标持续转动

- Query: API 返回错误后，BioWeave 悬浮插件图标仍处于运行中；对照其它模块，定位状态未释放的原因并给出回归测试 seam。
- Scope: internal
- Date: 2026-10-28

## Findings

附件 `/Users/ll/Downloads/ST-BioWeave-Debug-20261028-194153.txt` 的末尾诊断显示，实际失败的是人物/Event API，而不是 Projection API：

- `EVENT_AI_ATTEMPT_FAILED` / `EVENT_STAGE_ATTEMPT_FAILED` 的执行与阶段 attempt 都是 `1`，失败码为 `response-error`。
- 随后出现 `ANALYSIS_FAILED`，但该终端条目中的 `attempt` 变成了 `2`。
- `history_trace.summary.terminal` 已经是 `failed`，说明业务分析本身已经结束；问题是悬浮活动租约没有正确匹配终端身份。

悬浮活动的匹配依赖 `chat_id + floor_version + attempt + domain`：

- `runtime/activity.js:56-68` 生成活动 identity key；
- `runtime/activity.js:109-123` 通过 `EVENT_ANALYSIS_STATUS_CHANGED` 的 `attempt` 结束 Event 活动；
- `runtime/events.js:2125-2134` 每个 Runtime 通知先交给 activity，再广播给 UI。

Event 执行真正的 attempt 保存在 `execution.attempt`，并在 `runtime/event-analysis.js:3656-3670` 组装终端状态。这里先写入 `attempt: execution.attempt`，之后又展开 `diagnostic`。API 客户端的诊断对象也可以带有 `attempt`（例如 HTTP/transport 重试次数），因此会覆盖业务执行 attempt。附件中的“阶段 attempt=1、终端 attempt=2”正好符合这个覆盖路径：

```text
业务运行 identity: attempt = 1
API 错误 diagnostic.attempt: 2
终端 EVENT_ANALYSIS_STATUS_CHANGED.payload.attempt: 2
activity active key: attempt = 1
finishActivity lookup: attempt = 2 -> 找不到 -> false
active_tasks 仍保留 -> 悬浮图标继续 is-running
```

其它模块之所以通常没有这个表现：World 分析在 UI 操作层直接在 `try/catch/finally` 中调用 `runtime.finishActivity('world_analysis', ...)`；Projection 也在 `runExecution` 的成功、取消、失败分支分别显式调用 `finishActivity`（`runtime/projection-runtime.js:1923-1974`）。Event/Character 分析则完全依赖 Runtime 终端事件的 identity，且当前终端 payload 允许诊断字段覆盖控制字段，所以只在错误诊断含同名 `attempt` 时暴露问题。

推荐最小修复：把终端事件的控制 identity 放到诊断展开之后，或显式过滤诊断中的 `attempt/chat_id/floor_version/domain/state` 等保留字段，确保 `attempt` 始终等于 `execution.attempt`。不要改为无 identity 的“按 kind 随便结束”，否则并发重试可能误清理新任务。

建议回归测试：

1. 建立一条 `EVENT_ANALYSIS_STATUS_CHANGED(state=running, attempt=1, floor_version=...)`，让 `createRuntimeActivity()` 进入 busy。
2. 用 API 错误诊断构造终端失败事件，其中 diagnostic 含 `attempt: 2`，但业务终端身份仍应为 `attempt: 1`；验证 `handleRuntimeEvent()` 后 `busy === false`，并且 `last_result === 'error'`。
3. 更稳妥的集成测试在 `tests/event-analysis-runtime.test.js`：让 analyzer 返回带 transport attempt 的 response-error，订阅终端事件，断言失败事件的 `payload.attempt` 等于执行 attempt，而不是诊断重试 attempt；再接入 runtime activity 或模拟 `runtime/events.js` 的 notify，确认悬浮活动释放。
4. 保留现有 stale-terminal 测试（`tests/floating-launcher.test.js:292-325`），并增加“diagnostic attempt 不得覆盖业务 attempt”的专门用例；这样不会破坏已有的并发旧任务保护。

## Caveats / Not Found

- 调试导出不包含 `active_tasks` 的最终快照，因此“图标持续转动”不能仅凭导出直接观察；但终端 attempt 不一致与活动 key 规则构成了可复现的确定性路径。
- 附件末尾的 `ANALYSIS_FAILED` 条目是 diagnostics 对终端事件的记录，不应把其中的 attempt 直接视为业务 execution attempt；需要在实际 Runtime 事件或测试中确认修复后的 payload。
- 本次只做研究，没有修改代码，也没有执行真实 SillyTavern 宿主测试。
