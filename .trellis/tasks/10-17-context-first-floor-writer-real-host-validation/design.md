# Context-first Floor Writer 真实宿主验证设计

## 1. 变更边界

本任务只新增测试专用工具、隔离测试、任务文档和真实宿主验证记录。不得把 Context-first 写入接入 `runtime/*`、`storage/*` 或 UI；不得修改已有 Coordinator。真实宿主写入只允许落到通过专用创建流程识别的新临时 Chat。

本轮要回答的是宿主能力事实，不预先承诺减少请求，也不把隔离原型结论当成宿主保证。

## 2. 证据层级

| 标签 | 含义 |
| --- | --- |
| `SOURCE_VERIFIED` | 当前实际加载的宿主代码、Context 或可观察接口直接支持。 |
| `ISOLATED_TEST_VERIFIED` | 本地注入模型和确定性测试支持，只说明模型行为。 |
| `HOST_VERIFIED` | 在本轮新建专用临时 Chat 上取得保存、官方读取和刷新证据。 |
| `HOST_TEST_BLOCKED` | 无法安全创建/识别/隔离目标，Phase B 不执行。 |
| `CONDITIONALLY_SAFE` | 仅在身份不漂移、无未协调外部写入且确认边界明确时成立。 |
| `PROVEN_UNSAFE` | 在真实宿主或隔离模型中有确定性违反契约的反例。 |
| `UNKNOWN` | 观察不足，不能判断。 |

## 3. Phase A 工具边界

新增 `tests/helpers/real-host-floor-writer-verification.js`，提供：

- `summarizeHostContext(context)`：只输出身份、消息结构和字段名，不输出聊天正文；
- `assertDedicatedTempChatTarget(target, proof)`：要求显式专用 Chat 创建证明和目标 token；
- `buildProbeSnapshot(version, kind)`：使用生产 `projection_timing_snapshot` / `participant_aggregation_snapshot` 根；
- `makeHostProbeSource()`：生成可由人工/自动化执行的只读检查与写入探针脚本；
- `classifyPersistenceOutcome()`：把 dispatch、Promise、HTTP/readback 和漂移分别归类；
- `createRequestRecorder()`：只统计注入或观察到的 GET/SAVE，不伪造真实宿主计数。

隔离测试覆盖目标拒绝、Schema 根、双写、其他扩展保留、保存失败/未知/readback 不一致和外部覆盖反例。工具不替换生产 Writer，也不将整条 message 作为写入 payload。

## 4. Phase B 观察顺序

```text
只读识别当前宿主与版本
  -> 通过宿主专用“临时聊天”入口创建新 Chat
  -> 记录创建前后 Chat identity 与事件
  -> 重新读取 Context 并确认目标 message/Floor/Swipe
  -> 构造测试 Snapshot
  -> 只修改当前消息 extra.bioweave 与 active Swipe mirror
  -> 调用 saveChat()，记录 Promise/网络事件
  -> 必要时执行一次官方 GET readback
  -> 刷新/重新加载专用临时 Chat
  -> 再次只读核对目标 Snapshot
```

如果创建流程只提供“临时模式”但不提供可验证 Chat identity、保存文件名或刷新后的重定位能力，则 Phase B 结论为 `HOST_TEST_BLOCKED`。不能以 UI 上显示“临时聊天”作为唯一证据。

## 5. 身份和数据保护

每次写入前重新确认：Chat ID、message ID、floor、active swipe、content hash、message version、epoch。结构化消息的 durable owner 仍是 `message.swipe_info[swipe_id].extra.bioweave`，主 `message.extra.bioweave` 只作为宿主 active mirror；字段和生命周期遵循 `.trellis/spec/domain/floor-state.md` 与 `docs/bioweave-data-lifecycle.md`。

只允许修改 BioWeave 自有根；保留 `message.extra` 其他字段、其他 Swipe 和历史消息。若当前消息不是合法 Character/assistant Floor，或无法证明 active Swipe slot，就拒绝真实写入。

## 6. 保存完成语义

```text
DISPATCHED
  -> HOST_ACCEPTED       save Promise/HTTP 返回，但没有权威 readback
  -> CONFIRMED           readback + 刷新后的同一 identity/payload 均匹配
  -> FAILED              明确请求或服务端失败，且结果可判定失败
  -> UNKNOWN             响应丢失、readback 不一致、刷新前后目标漂移
  -> STALE               Chat/Floor/Swipe/message/version/epoch 变化
```

`saveChatDebounced()` 若没有可等待 Promise，只能记录为已调度；不能报告 `CONFIRMED`。服务端响应成功后再发生旧快照覆盖时，单次 readback 只能确认某个时点，不自动证明后续持续一致。

## 7. 请求观察

通过浏览器 DevTools/CDP `Network` 事件观察 `/api/chats/get`、`/api/chats/save`，并按 initiator 或时间窗区分：

- Writer probe 主动请求；
- SillyTavern 自己的保存/刷新请求；
- 其他扩展请求；
- 读回与页面刷新请求。

如果 Network 事件不可可靠归因，记录总数并标记 `UNATTRIBUTED`，不得声称是 Writer 独占数量。

## 8. 回退/停止

任何目标身份不一致、临时 Chat 创建未确认、写入可能触及现有聊天、或页面切换无法安全恢复时，立即停止 Phase B，只保留 Phase A 与只读证据。停止不执行删除、不尝试清理目标、不回到现有正式聊天补测。
