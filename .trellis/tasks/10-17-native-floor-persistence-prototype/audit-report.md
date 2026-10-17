# P2：宿主原生 Floor 快速保存方案隔离原型与测试审计

审计分支：`fix/world-model-prompt-baseline`
审计日期：2026-10-17
生产逻辑变更：无。
真实 SillyTavern Chat/Floor 写入：无。
任务目录：`.trellis/tasks/10-17-native-floor-persistence-prototype/`

## 1. 执行摘要

本轮新增了一个仅供测试使用的宿主原生保存行为模型和 20 个确定性隔离测试。模型把 live Context、official archive、native save ticket、server write、HTTP response 和 authoritative readback 分开，并使用 deferred Promise barrier 控制竞争时序。

结论是：

**当前没有已经证明可以进入生产的“少 GET 且保持 BioWeave Floor 一致性契约”的宿主原生保存方案。**

模型确实测得：

- `context-fast` changed：`0 GET / 1 SAVE / 0 readback`，但只有 `HOST_ACCEPTED`，不代表 Floor confirmed；外部扩展字段或旧标签页写入可以被完整 Chat 快照覆盖。
- `native-confirmed` changed：`1 GET / 1 SAVE / 1 readback`，在单一 writer、owner token 稳定、官方 readback 命中目标内容的模型内可以确认；但模型中的外部 writer 仍能制造覆盖或 stale 窗口，不能替代 Coordinator 的 latest merge、CAS 和完整并发保护。
- `context-fast` no-op：`0 GET / 0 SAVE`，即使 official archive 已经发生变化也会直接返回 `NOOP`；这是确定性 stale 漏检。
- `native-confirmed` no-op：每笔事务 `1 GET / 0 SAVE`；两笔 Timing + Aggregation no-op 的模型结果为 `2 GET / 0 SAVE`，但这是 test model 计数，不是当前真实宿主网络计数。

因此，减少 GET 的最短路径与保持现有契约之间存在明确冲突：

1. 不做 readback 的路径不能确认官方写入完成，也不能发现 full-Chat 外部覆盖。
2. 做一次 readback 的路径只能确认 readback 时点看到的内容；没有宿主 CAS 时，写前 latest merge 和 readback 之间仍有竞争窗口。
3. 插件内部 queue 只能串行化 BioWeave 自己的操作，不能约束其他标签页、设备、扩展或直接 `/api/chats/save`。
4. Timing 和 Aggregation 仍必须是两笔逻辑事务，不能为了得到一次 SAVE 而改变 Timing 成功/Aggregation 失败的部分成功语义。

本轮建议：**保留当前 Coordinator，不进入生产 native Floor 迁移；原型结果只作为后续真实宿主 capability 验证的输入。**

## 2. 证据边界

本报告使用以下证据标记：

| 标记 | 含义 |
| --- | --- |
| `SOURCE_VERIFIED` | 当前 BioWeave checkout 或已固定的 SillyTavern 源码快照中的静态事实 |
| `ISOLATED_TEST_VERIFIED` | 本轮 test-only 模型和测试实际通过 |
| `REAL_HOST_BASELINE` | 前序真实 SillyTavern Debug 或既有真实宿主验收 |
| `HOST_RUNTIME_UNVERIFIED` | 当前真实宿主 build/网络行为没有在本轮通过真实写入确认 |
| `UNKNOWN` | 现有源码、模型和测试不足以判断 |

本轮没有调用真实 `/api/chats/save`、`/api/chats/get`，没有修改真实 Chat/Floor，也没有导入生产 Coordinator、Adapter 或 Runtime。原型的 `get`/`save` 是模型内逻辑计数，不能写成实际网络请求计数。

生产基线沿用前两份报告：

- `.trellis/tasks/10-17-native-host-persistence-architecture-audit/audit-report.md`
- `.trellis/tasks/10-17-sillytavern-native-persistence-capability-audit/audit-report.md`

## 3. 当前生产路径基线

### 3.1 Timing + Aggregation 当前调用链

```text
UI 保存推演周期
  -> ui/app.js::saveCharacterTiming()
  -> runtime/events.js::editCharacterTimingInstance()
  -> storage/projection-timing.js::editTimingInstance()
  -> FloorPersistenceCoordinator::commitFloorPatch()
  -> Timing authoritative readback
  -> Aggregation input re-evaluation
  -> storage/participant-aggregation.js::upsertAggregation/removeAggregation()
  -> 第二笔 FloorPersistenceCoordinator 事务
  -> Aggregation authoritative readback
  -> UI 返回 confirmed / partial failure
```

源码位置：

- UI 同步等待和成功/错误处理：`ui/app.js:4181-4359`。
- Timing Runtime、Timing readback、Aggregation 重评估、部分成功：`runtime/events.js:5480-6037`。
- Timing owner patch：`storage/projection-timing.js:219-295`。
- Aggregation owner patch：`storage/participant-aggregation.js:211-275`。
- Coordinator queue、owner acquisition、latest merge、no-op/readback 和 changed transaction：`storage/floor-persistence-coordinator.js:281-610,613-708`。
- 官方 owner GET、SAVE 和 source revision：`runtime/sillytavern-adapter.js:363-485`。

### 3.2 当前请求基线

| 操作 | Floor 事务 | 官方 Chat GET | 官方 Chat SAVE | 证据 |
| --- | ---: | ---: | ---: | --- |
| 普通 Floor no-op | 1 | 3 | 0 | 前序 Coordinator 测试、源码和真实 Debug |
| 普通 Floor changed | 1 | 6 | 1 | 前序 Coordinator 测试、源码和真实 Debug |
| Timing + Aggregation no-op | 2 | 6 | 0 | 前序真实宿主 Debug 与审计报告 |
| Timing + Aggregation changed | 2 | 12 | 2 | 前序真实宿主 Debug 与审计报告 |

这些数字是当前生产路径基线，不是本轮 native 模型结果。当前 Coordinator 的 latest authoritative merge、Floor Version/Swipe/epoch guard、官方 SAVE 和 readback 仍是已冻结的生产正确性边界；本轮没有修改它们。

## 4. 独立原型实现

### 4.1 三层状态模型

原型代码：`tests/helpers/native-floor-persistence-prototype.js`。

| 层 | 模型行为 | 代码位置 |
| --- | --- | --- |
| live Context | 可变 Chat ID、epoch、消息、正文、message version、active Swipe、Swipe slots 和 `message.extra` | `:41-94,221-230` |
| official archive | 按 Chat ID 保存独立完整 Chat，GET 返回 clone | `:96-142` |
| native save ticket | dispatch 时捕获完整 Context；server write 和 HTTP response 分别由 deferred barrier 释放 | `:156-201,209-218` |
| authoritative readback | 读取 official archive，单独计数 GET/readback，可挂 barrier | `:127-142` |
| external writer | 修改 official archive 或替换旧的完整 Chat snapshot | `:144-154` |

原型明确模拟了完整 Chat SAVE 的重要限制：文件替换可以是完整替换，但不是 field-level merge，也没有 expected revision/CAS。模型因此可以表达 last-write-wins，而不会错误地把“atomic file replacement”当成“业务冲突保护”。

### 4.2 身份、Snapshot 和状态

- Floor token 包含 Chat ID、message ID、Floor、Swipe ID、message version、content hash、epoch：`tests/helpers/native-floor-persistence-prototype.js:78-89`。
- 目标捕获拒绝历史 Floor 和 User owner：`:248-255`。
- dispatch 前、保存后都重新检查 Chat/epoch/message/Floor/Swipe/content hash/message version：`:257-270,323-347`。
- readback 额外检查官方消息身份、Floor、Swipe、message version 和 content hash：`:30-38,304-340`。
- owner merge 只允许 `projection_timing_snapshot` 和 `participant_aggregation_snapshot`：`:272-278`。
- 其他 sibling、extension、其他 Swipe 和历史消息通过完整快照保留断言：`tests/native-floor-persistence-prototype.test.js:162-213`。

这不是生产 Floor schema 的重新实现。模型用 Context 字段和 `floor_version` fixture 表现六字段 token，但没有导入生产 schema、Floor resolver 或 Coordinator；因此 schema 兼容性仍属于 `HOST_RUNTIME_UNVERIFIED`/`UNKNOWN`，不能由测试模型替代。

### 4.3 两种候选模式

| 模式 | 实现 | 可以确认什么 | 明确不能确认什么 |
| --- | --- | --- | --- |
| `context-fast` | Context no-op 比较；changed 原地修改 active Swipe 后调用模型 `saveChat()`；不做官方 GET/readback | 模型内 server ticket 完成或 host response 返回 | 权威 Floor 版本、外部 writer、跨页/跨设备冲突、readback 时点结果 |
| `native-confirmed` | changed save 后做一次 official readback；no-op 也读取 official slot；响应丢失时只有匹配 readback 才升级 | readback 时点的目标消息身份和 owner payload | 写前 latest merge、原子 CAS、readback 后覆盖、跨 writer 冲突 |

原型没有把 `saveChatDebounced()` 当作可等待保存；该路径直接返回 `UNKNOWN_OUTCOME`：`:204-207`、测试 `tests/native-floor-persistence-prototype.test.js:105-112`。

## 5. 测试执行结果

### 5.1 实际执行结果

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| Prototype 定向测试 | 20 passed, 0 failed, 0 skipped | `node --test tests/native-floor-persistence-prototype.test.js` |
| Node syntax check | passed | `node --check tests/helpers/native-floor-persistence-prototype.js`、`node --check tests/native-floor-persistence-prototype.test.js` |
| 全量 `npm run check` | 1643 total；1627 passed；0 failed；16 skipped | 最终全量运行输出，约 71 秒 |
| `git diff --check` | 通过 | 报告及任务清单写入后的最终质量门 |

20 个测试全部使用 `deferred()`、ticket barrier 或 microtask release；没有固定 `setTimeout` 竞争。barrier 定义和阶段等待：`tests/helpers/native-floor-persistence-prototype.js:16-24,127-140,156-199`；测试等待辅助：`tests/native-floor-persistence-prototype.test.js:19-31`。

### 5.2 模型实测请求计数

以下是本轮模型实际断言的 logical host call 计数，不是当前远程宿主的 HTTP 计数。

| 场景 | 模式 | 模型 GET | 模型 SAVE | readback | 最终状态 | 证据 |
| --- | --- | ---: | ---: | ---: | --- | --- |
| 单笔 Timing changed | `context-fast` | 0 | 1 | 0 | `HOST_ACCEPTED`，非 confirmed | `tests/native-floor-persistence-prototype.test.js:51-58` |
| 单笔 Timing changed | `native-confirmed` | 1 | 1 | 1 | `AUTHORITATIVE_READBACK_CONFIRMED` | `:60-66` |
| Context no-op，official 同步 | `context-fast` | 0 | 0 | 0 | `NOOP` | `:69-75` |
| Context no-op，official 已变化 | `context-fast` | 0 | 0 | 0 | 仍为 `NOOP`，确定性漏检 | `:69-76` |
| Context no-op，official 已变化 | `native-confirmed` | 1 | 0 | 1 | `UNKNOWN_OUTCOME` | `:77-84` |
| Timing + Aggregation no-op | `native-confirmed` | 2 | 0 | 2 | 两笔各自确认 | `:355-365` |
| Timing changed + Aggregation no-op | `native-confirmed` | 2 | 1 | 2 | 两笔各自确认 | `:367-379` |
| Timing no-op + Aggregation changed | `native-confirmed` | 2 | 1 | 2 | 两笔各自确认 | `:381-393` |
| Timing changed + Aggregation changed | `native-confirmed` | 2 | 2 | 2 | 两笔各自确认 | `:327-347` |
| Timing changed，Aggregation 计算失败 | `context-fast` | 0 | 1 | 0 | `partialSuccess: true` | `:304-325` |
| changed + `saveChatDebounced()` | `context-fast` | 0 | 0 | 0 | `UNKNOWN_OUTCOME` | `:105-112` |
| response lost + matching readback | `native-confirmed` | 1 | 1 | 1 | readback 后可确认 | `:291-301` |

“两笔各自确认”只表示当前模型的两个 readback 都命中，并不表示宿主提供了跨事务 CAS。对于 no-op，模型明确展示了 Timing no-op 不等于 Aggregation no-op：`:355-393` 分别测得 `2/0`、`2/1`、`2/1` 三种组合。

## 6. 确定性并发结果与反例

### 6.1 Context-only no-op 漏掉 official 变化

执行时序：

```text
T0  live Context 的 Timing root = []，捕获目标 token
T1  external writer 修改 official Timing root = [{id: "remote"}]
T2  context-fast 只比较 live Context，0 GET / 0 SAVE
T3  返回 NOOP，没有检测 official stale
```

这是 `PROVEN_UNSAFE`，因为 UI/Context 相等不等于权威 Floor 相等。`native-confirmed` 至少会执行 1 次 GET 并返回 `UNKNOWN_OUTCOME`，但仍没有 CAS；测试位置：`tests/native-floor-persistence-prototype.test.js:69-84`。

### 6.2 dispatch 后生命周期变化

执行时序：

```text
T0  capture target
T1  Context mutation + native save dispatch，ticket 捕获旧 Chat/Swipe/message
T2  切换 Chat、切换 Swipe、编辑正文、删除消息或改变 epoch
T3  release server write / response
T4  post-save owner guard 失败，结果保持 UNKNOWN_OUTCOME
```

测试覆盖 Chat、Swipe、消息编辑、消息删除和 epoch 五种变化：`tests/native-floor-persistence-prototype.test.js:141-160`。

这说明 post-guard 可以阻止错误的成功提示，但不能撤销已经 dispatch 的旧完整 Chat 写入；因此它不是 CAS，也不能单独保证“没有写错目标”。

### 6.3 其他扩展字段在 capture 后丢失

```text
T0  native save capture 完整 Context
T1  其他扩展只修改 live message.extra
T2  native save 写入 T0 的完整 snapshot
T3  host 返回 HOST_ACCEPTED，但新 extension 字段不存在于 official archive
```

测试位置：`tests/native-floor-persistence-prototype.test.js:235-246`。

这是 `PROVEN_UNSAFE` 的 full-Chat overwrite 反例。原型仍保留 dispatch 时已存在的其他 extension 字段；它不能保护 capture 之后才出现的并发修改。

### 6.4 旧标签页完整快照覆盖 native output

```text
T0  native save dispatch
T1  native server write 完成
T2  旧标签页把旧完整 Chat snapshot 写回 official archive
T3  HTTP response 返回
T4  native-confirmed readback 发现目标 payload 不匹配，返回 UNKNOWN_OUTCOME
```

测试位置：`tests/native-floor-persistence-prototype.test.js:248-263`。

readback 能阻止错误 confirmed，但不能恢复被覆盖的 Timing/extension 数据；没有 CAS 时，readback 前后仍存在竞态。

### 6.5 external root mutation 与 readback mismatch

外部 writer 在 server write 后、readback 前修改目标 owner root，测试确认 `native-confirmed` 返回 `UNKNOWN_OUTCOME`，而不是成功：`tests/native-floor-persistence-prototype.test.js:86-103,396-414`。

另一个测试直接改变官方 message version，即使 owner payload 看似匹配，身份检查仍拒绝 confirmed：`:416-429`。这验证了 readback 不能只比较 Snapshot 内容，还要比较目标消息身份和版本。

### 6.6 plugin-only queue 的边界

原型 queue 只按 `chatId:messageId:swipeId` 串行化自身操作：`tests/helpers/native-floor-persistence-prototype.js:354-360`。测试中两个 owner 的内部操作按顺序执行，但 external writer 仍可以在第二笔完整 SAVE 周围插入并被覆盖：`tests/native-floor-persistence-prototype.test.js:215-233`。

结论是：plugin queue 对单页内 BioWeave out-of-order 有帮助，不能替代宿主 CAS，也不能保护其他标签页、设备、扩展或 direct API。

## 7. Timing 与 Aggregation 语义

### 7.1 保留两笔逻辑事务

`runTimingAggregation()` 先写 `projection_timing_snapshot`，确认或 no-op 后重新读取 `inputs()`，再独立处理 `participant_aggregation_snapshot`：`tests/helpers/native-floor-persistence-prototype.js:362-387`。

测试证明：

- Timing no-op 但依赖输入变化时，Aggregation 仍可 changed：`:381-393`。
- Timing changed、Aggregation no-op 时，Timing 产生 1 SAVE，Aggregation 只做自己的 readback：`:367-379`。
- Timing 和 Aggregation 都 changed 时，模型产生 2 SAVE、2 GET/readback：`:327-347`。
- Timing 成功、Aggregation 计算失败时，保留 Timing 结果并返回 `partialSuccess: true`，不会把失败合并成一笔不可分割 SAVE：`:304-325`。
- repeated Aggregation no-op 不产生新的 SAVE，但仍按 `native-confirmed` 执行自己的 authoritative readback：`:327-352`。

### 7.2 为什么不能把模型的 2 SAVE 改成 1 SAVE

一次完整 native save 同时包含 Timing 和 Aggregation 时，Aggregation 失败无法自然产生现有的：

```text
Timing 已成功 / Aggregation 未成功 / UI 显示部分成功
```

因此模型保持两笔逻辑事务。是否可以在宿主提供 patch/CAS 后减少物理 SAVE，仍是未解决的事务契约问题，而不是本轮可直接宣布的优化。

## 8. 失败、未知和成功语义

| 情况 | 模型结果 | 结论 |
| --- | --- | --- |
| server write 前明确失败 | `FAILED` | 可报告失败；不把 save ticket 当成功 |
| server write 完成、HTTP response 丢失 | `UNKNOWN_OUTCOME`；若 readback 命中目标则可升级确认 | 必须先 readback，不能直接报告成功 |
| response 阶段错误 | `UNKNOWN_OUTCOME` | 服务器可能已经替换完整 Chat |
| readback owner 不一致 | `UNKNOWN_OUTCOME` | 不能用 HTTP/Promise 完成替代确认 |
| Chat/Swipe/message/epoch 在 dispatch 后变化 | `UNKNOWN_OUTCOME` | post-guard 可阻止成功提示，但不能撤销旧请求 |
| debounce 只安排未完成任务 | `UNKNOWN_OUTCOME` | 不能向 UI 报告已持久化 |
| Timing 成功、Aggregation 失败 | Timing 结果保留，`partialSuccess: true` | 与当前业务语义一致 |

原型把 server write 与 HTTP response 分开：`tests/helpers/native-floor-persistence-prototype.js:169-199`。这验证了“Promise fulfilled/HTTP response/权威确认”必须分层处理，但模型本身不证明真实宿主的 Promise 或文件 durable 语义。

## 9. 与当前生产基线的性能对照

| 操作 | 当前生产路径 | 本轮 native 模型最短/确认路径 | 是否真实宿主实测 |
| --- | --- | --- | --- |
| 单笔 Floor changed | `6 GET + 1 SAVE` | `context-fast: 0 GET + 1 SAVE`；`native-confirmed: 1 GET + 1 SAVE` | 否；模型实测 |
| 单笔 Floor no-op | `3 GET + 0 SAVE` | `context-fast: 0 GET + 0 SAVE`；confirmed no-op `1 GET + 0 SAVE` | 否；模型实测 |
| Timing + Aggregation changed | `12 GET + 2 SAVE` | 两笔 confirmed 模型 `2 GET + 2 SAVE` | 否；模型实测 |
| Timing + Aggregation no-op | `6 GET + 0 SAVE` | 两笔 confirmed 模型 `2 GET + 0 SAVE` | 否；模型实测 |

请求数量看起来明显减少，但保护也同时减少：

- `context-fast` 没有 authoritative readback；其 `HOST_ACCEPTED` 不可当作 Floor confirmed。
- `native-confirmed` 每笔只做一次 readback，没有生产 Coordinator 的写前 latest merge、owner acquisition、完整 sibling audit 和 CAS。
- 2 GET/2 SAVE 只是本模型的“两笔保存后各一次 readback”；它不代表官方 SillyTavern native API 实际只发 2 次 GET，也不代表官方接口能防止外部覆盖。
- 没有测试真实宿主的请求合并、代理、服务器队列、文件锁或 direct API 竞争，因此实际网络计数是 `HOST_RUNTIME_UNVERIFIED`。

## 10. 安全结论矩阵

| 候选/场景 | 模型结论 | 生产结论 | 原因 |
| --- | --- | --- | --- |
| `context-fast`，单一 writer、无生命周期变化 | `PROVEN_SAFE_WITHIN_TEST_MODEL`，但仅为模型内操作完成 | `NOT_YET_PROVEN` | 没有权威 readback/CAS |
| `context-fast`，official 已变化或外部 writer 存在 | `PROVEN_UNSAFE` | 不可实施 | no-op 漏检、extension/旧 snapshot 被覆盖 |
| `native-confirmed`，无外部 writer、token 稳定 | `PROVEN_SAFE_WITHIN_TEST_MODEL` | `CONDITIONALLY_SAFE` | readback 能确认一个时点，但没有 host CAS |
| `native-confirmed`，旧标签页/扩展/direct API 并发 | `PROVEN_UNSAFE`（至少会返回 unknown 或发生覆盖） | 不可实施为现有契约替代 | full Chat last-write-wins |
| plugin-only queue | `PROVEN_SAFE_WITHIN_TEST_MODEL`，仅限自身排序 | `CONDITIONALLY_SAFE` | 不能约束外部 writer |
| Timing + Aggregation 合并一笔 native SAVE | 未作为默认实现；现有契约上不等价 | `PROVEN_UNSAFE` | 会改变部分成功边界 |
| 两笔独立 native save + readback | 模型内可执行 | `CONDITIONALLY_SAFE` | 仍需 host CAS/patch/merge/unknown contract |

## 11. 当前方案是否值得进入生产改造

### 11.1 当前结论

**不满足直接进入生产改造的条件。**

本轮已经证明：

- “少 GET”的数字可以在 test model 中实现；
- “少 GET 且保持当前 Floor 并发契约”尚未证明；
- Context 原地修改不是问题的全部，关键缺口是宿主没有被证明提供 owner-level CAS、字段级 merge 和可验证 durable completion；
- plugin queue 和一次 readback 都不能自动补足跨标签页/跨设备/direct API 竞争。

### 11.2 最小后续路线

只有在另行授权真实宿主临时 Chat 验证后，才建议继续：

1. 确认当前运行 SillyTavern build 的 `saveChat()` 完成阶段、服务端写入阶段和响应丢失行为。
2. 确认是否存在宿主级 expected revision/CAS、owner patch 或可证明的同 Chat serialized write；前端读 revision 后无条件 SAVE 不能算 CAS。
3. 用临时 Chat 验证 Chat/Swipe/消息编辑/删除、两个标签页旧快照、其他 extension `message.extra`、direct API 和 save-then-readback。
4. 如果宿主没有 CAS，native path 只能限定在明确禁止外部 writer 的场景，或继续 fallback 到 Coordinator；不能以插件 mutex 宣称全局安全。
5. 若进入生产原型，先保留 Timing/Aggregation 两笔事务和现有部分成功语义，native path 只作为能力明确时的受控候选，unknown 结果不得盲目 fallback 二次写入。

## 12. 文件与验证边界

本轮新增：

- `tests/helpers/native-floor-persistence-prototype.js`
- `tests/native-floor-persistence-prototype.test.js`
- `.trellis/tasks/10-17-native-floor-persistence-prototype/audit-report.md`

本轮没有修改生产 Coordinator、Adapter、Runtime、UI、业务规则、SillyTavern 源码或真实 Chat/Floor。工作区中已有的生产修改和其他 Trellis 未跟踪目录均保留，未执行分支切换、commit、push、reset 或 clean。

Markdown 影响检查：本轮没有改变生产行为、公共接口或数据生命周期，因此无需同步修改 README、`docs/ARCHITECTURE.md`、Floor State Ownership Contract 或 Lifecycle Contract；本报告只记录隔离实验结果。

最终结论：

> **目前不存在已达到生产实施标准的宿主原生少 GET Floor 保存方案。**
>
> `native-confirmed` 在有限 test model 内可以达到每笔 `1 GET + 1 SAVE`，但没有 CAS、latest merge 和跨 writer 保护；`context-fast` 虽可达到 `0 GET`，却已有确定性 no-op 漏检和完整 Chat 覆盖反例。因此本轮不建议修改生产持久化路径。
