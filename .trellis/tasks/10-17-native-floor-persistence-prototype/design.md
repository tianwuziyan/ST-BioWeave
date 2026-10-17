# 技术设计：宿主原生 Floor 快速保存隔离原型

## 1. 设计边界

本任务只新增测试辅助模型、隔离测试和审计报告。原型不是 BioWeave storage abstraction 的替代实现，不被生产 Runtime/Coordinator/Adapter/UI 导入，也不写入真实 SillyTavern。生产正确性基线继续由 `storage/floor-persistence-coordinator.js`、`runtime/events.js` 和 `runtime/sillytavern-adapter.js` 提供。

设计必须把三类对象分开：

1. **live Context**：模拟当前页面可变的 `context.chat`、Chat ID、active Swipe 和 epoch。
2. **official archive**：模拟 `/api/chats/get` 所能看到的权威 Chat 快照，独立于 live Context。
3. **native save ticket**：模拟 `saveChat()` 在 dispatch 时捕获的完整 Chat 请求；server write、HTTP response 和 readback 可分别由 deferred barrier 释放。

因此，测试可以直接表现出“Context 已修改”“完整 Chat SAVE 已 dispatch”“官方状态已替换”“响应已返回”“读回已确认”不是同一个时点。

## 2. 原型组件

### 2.1 `NativeFloorHostModel`

放在 `tests/helpers/native-floor-persistence-prototype.js`，只提供测试用 host 行为：

- `context`：当前 Chat 的消息、metadata、epoch；消息包含 `message_id`、`floor`、`swipe_id`、`message_version`、正文、`extra` 和 `swipe_info`。
- `officialByChat`：按 Chat ID 存储独立的完整 Chat 快照。
- `readOfficial(chatId)`：模拟官方 GET，递增 `chatGetCount`，返回 clone，支持明确失败。
- `saveChat()`：递增 `chatSaveCount`，在调用时 capture 完整 Chat；返回受 ticket barrier 控制的 Promise。ticket 可分别释放 server write、response、failure 或 response lost。
- `saveChatDebounced()`：只安排/替换 pending ticket，不返回可等待 Promise，用于证明 debounce 不能作为持久化完成确认。
- `switchChat`、`switchSwipe`、`editMessage`、`deleteMessage`、`mutateContextExtra`、`mutateOfficial`：只用于确定性竞争注入。
- `metrics`：记录 GET、SAVE、readback、等待阶段、overwrite、captured target、response state 和最终状态。

完整 Chat SAVE 采用“请求时捕获、服务器替换完整快照”的模型。它模拟文件原子替换能避免半个文件，但不提供字段级 merge 或 CAS；外部 mutation 可以在 ticket release 时制造 last-write-wins 反例。

### 2.2 `NativeFloorPersistencePrototype`

同文件导出测试专用操作：

- `captureTarget()`：从 live Context 构造并校验 Chat ID、message ID、Floor、Swipe ID、message version、content hash、epoch，并拒绝历史/非 Character owner。
- `mergeOwnedSnapshot()`：只在目标 active Swipe 的 BioWeave slot 更新指定 owner root，保留 sibling root、其他 extension 字段、其他 Swipe 和历史消息；`undefined`/显式空值按测试契约保留清除语义。
- `writeFloorPatch()`：执行 token preflight、Context no-op 判断、Context mutation、native save ticket、post-save token guard 和可选 authoritative readback。确认模式只在 readback 与目标 owner token/内容一致时返回 confirmed。
- `runTimingAggregation()`：顺序调用两个独立的逻辑 write operation；Aggregation 在 Timing 结果确认后重新读取当前输入，不能复用 Timing 阶段的 Context snapshot。Aggregation 失败返回 Timing 成功、Aggregation 失败的 partial-success 结果。
- `enqueue(key, task)`：只串行化 BioWeave prototype 自己的同 Chat/Floor 操作，明确不保护外部标签页、设备或直接 API writer。

原型提供两类候选测量模式：

| 模式 | 目的 | 预期证据边界 |
| --- | --- | --- |
| `context-fast` | 不做官方 GET/readback，测量最短请求路径 | 只能在无外部 mutation 的模型内观察，不能确认权威持久化 |
| `native-confirmed` | 每个 changed save 后做一次官方 readback，no-op 可选官方 readback | 可验证“读回时点”结果，但没有 CAS、写前 latest merge 或跨 writer 冲突拒绝 |

### 2.3 事务与请求计数

原型不重新实现生产六次 GET。它只测量候选 native path 实际发出的模型调用：

- Context-only no-op：通常 `0 GET / 0 SAVE`；若启用 official no-op check，则 `1 GET / 0 SAVE`。
- 单笔 changed + no readback：`0 GET / 1 SAVE`，状态最多为 server-write/unknown。
- 单笔 changed + readback：`1 GET / 1 SAVE`，仅能证明 readback 时点匹配。
- Timing + Aggregation changed、两笔独立事务 + readback：模型 `2 GET / 2 SAVE`。
- Timing + Aggregation no-op 取决于两个 owner 的 no-op 策略；实测结果写入报告，理论值不作为实现承诺。

这些计数与生产基线 `3/0`、`6/1`、`6/0`、`12/2` 分开标注。模型减少 GET 的代价必须同时记录：没有 latest authoritative merge、没有 CAS、没有跨 writer protection、没有自动 Floor readback 和没有宿主级部分成功语义。

## 3. 身份和数据契约

原型每次 write 都重新检查：

```text
chat_id + message_id + floor + swipe_id
+ content_hash + message_version + epoch
```

即使 UI/调用方传入值相同，也不能跳过当前 live Context 的检查。保存 ticket 在 dispatch 后捕获旧 Chat；如果 Chat、Swipe、正文、message version、目标消息存在性或 epoch 在等待期间变化，原型不报告 confirmed。历史 Floor 和 User message 写入直接拒绝。

Snapshot merge 只允许测试 owner 写自己的 root；已有 `analysis`、`world_model`、`projection_timeline`、`tracking_window_timeline`、其他角色 aggregation 和未知 `message.extra` 字段必须保持。没有“把整个 `bioweave` 替换成 patch”的快捷分支。

## 4. 确定性竞争场景

所有场景通过 host ticket 的 `serverWrite`、`response` 或 prototype phase barrier 控制，不使用 `setTimeout`：

1. dispatch 后、server write 前切换 Chat/Swipe/正文/epoch/删除消息；
2. server write 后、response 前注入其他扩展或旧标签页 full-Chat 写入；
3. readback GET 返回前后注入官方覆盖；
4. Timing 成功后、Aggregation 开始前修改 Exposure/Tracking/Aggregation 输入；
5. 两个 prototype operation 同时排队，验证内部队列只保证自身顺序；
6. server write 已完成但 response 不释放，验证结果保持 UNKNOWN；
7. explicit failure、readback mismatch、重复操作和历史目标拒绝。

每个测试都保存 baseline/candidate 结果、GET/SAVE/readback 计数、mutation 点、最终官方快照和 invariant 状态。测试通过的“无反例”只提升为 `PROVEN_SAFE_WITHIN_TEST_MODEL`，不会升级为 `CONDITIONALLY_SAFE` 或生产可实施。

## 5. Timing/Aggregation 编排

```text
capture Timing target
  -> patch only projection_timing_snapshot
  -> native save + optional readback
  -> re-read current Timing / Exposure / Window inputs
  -> compute participant_aggregation_snapshot
  -> independent native save + optional readback
  -> confirmed / partial-success / unknown result
```

Timing root 和 Aggregation root 仍是两个独立 owner transaction。模型不把两个 patch 合并到一个完整 Chat save；否则无法测试并保留“Timing 成功、Aggregation 失败”的现有契约。Aggregation 输入在第二阶段重新读取，专门覆盖“Timing no-op 但其他依赖已变”的场景。

## 6. 证据等级与报告结论规则

- `PROVEN_SAFE_WITHIN_TEST_MODEL`：仅在当前模型前提（单一 writer、稳定 owner token、明确 save completion/readback）下成立。
- `CONDITIONALLY_SAFE`：模型显示可行，但仍依赖宿主或外部 writer 未验证的条件。
- `PROVEN_UNSAFE`：确定性测试能构造覆盖、stale 误报成功、未知结果误确认或部分成功语义破坏。
- `UNKNOWN`：模型无法覆盖的宿主能力或证据不足。

报告必须单独列出：

- 测试模型实际计数；
- 既有生产源码/真实 Debug 基线；
- 尚未在真实宿主执行的网络与生命周期行为；
- 不能由插件内部 queue 解决的跨标签页/跨设备/direct API 竞争；
- 进入生产前需要的 host CAS、patch/merge 或可验证 confirmation 能力。

## 7. 回滚与兼容

所有代码变更限制在 `tests/` 和本任务目录。若原型模型或测试需要回滚，只删除/修订本任务新增文件，不触碰现有生产修改、既有 audit 测试或 `.trellis/tasks/10-15-nsfw-auto-aggregation-diagnostics/`。完成后必须核对 `git diff --name-only`，证明没有生产路径变更。
