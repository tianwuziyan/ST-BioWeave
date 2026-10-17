# 设计与证据分析

## 1. 诊断模型

把一次用户操作拆成三条可能相互叠加的链路：

```text
UI route/render
  └─ 异步 refreshBusinessState
       └─ runtime.collectActiveBusinessData
            └─ canonical derived state
                 └─ tracking windows / registry / health / reduce state

Timing 保存
  └─ Timing Floor 事务
       └─ Aggregation reevaluation input
            └─ Aggregation Floor 事务
                 └─ 宿主 save + authoritative readback

Projection lifecycle
  └─ refreshProjectionContext
       └─ collectActiveBusinessData
       └─ refreshTail 串行等待下一次 refresh
```

只有第三条链路中的官方 GET/SAVE 才是宿主 I/O；第一、二条链路可以在没有官方 GET 的情况下消耗约秒级时间。

## 2. 已确认的真实宿主基线

证据文件：`/Users/ll/Downloads/ST-BioWeave-Debug-20261017-203027.txt`。

通过可失败的 `jq -e` 基线断言确认：

| 操作 | 总时长 | Aggregation 输入 | Host save wait | canonical 完成次数 | tracking 构建次数 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Timing no-op + Aggregation no-op | 1259.3 ms | 1148.8 ms | 0 | 同一 trace 共 15 次 | 14 次 |
| Timing changed + Aggregation changed | 2099.4 ms | 1147.7 ms | 232.3 + 207.8 ms | 同一 trace 共 15 次 | 14 次 |

在这份诊断数据中：

- no-op 的 Coordinator 阶段只有约 3–6ms，`STORE_SAVE_FLOOR` 为 `NOT_APPLICABLE`；但 `AGGREGATION_REEVALUATION_INPUT` 仍为约 1.15s。
- changed 操作在两个独立事务中各等待一次宿主原生保存，并各执行一次官方 readback；这两笔保存不能从当前日志直接合并为一笔。
- `JSON.parse` 只有约 2–3ms，不是主要瓶颈。
- 角色 route switch 的同步渲染本身为约 5.2ms（overview → characters）或约 70.4ms（characters → settings）；这不包含随后异步 business refresh 的等待。

结论状态：`SOURCE_VERIFIED` + `MEASURED`。这些数据只代表这份真实宿主样本，不代表所有机器和所有 Chat。

### 2.1 缓存改动后的真实宿主复测

证据文件：`/Users/ll/Downloads/ST-BioWeave-Debug-20261017-220906.txt`。

- 角色页完整渲染为 10.5 ms；推演周期弹窗两次打开记录为 14.2 ms 和 16.8 ms；人物选择提交和详情 DOM 局部提交约 1.3–1.4 ms。
- 最新 Timing no-op + Aggregation no-op Runtime 操作为 413.6 ms，其中 `AGGREGATION_REEVALUATION_INPUT` 为 346.2 ms；两个事务均为 `FLOOR_TX_NOOP`，`STORE_SAVE_FLOOR` 均为 `NOT_APPLICABLE`。
- 同一导出中观察到 8 次 `CHARACTER_CANONICAL_BUILD_CACHE_HIT`、4 次完整 canonical build 完成和 6 次 Tracking Registry build phase。日志末尾仍有一次约 983.9 ms 的完整 build，因此不能把缓存描述成全局或永久零成本。
- 该导出没有独立 endpoint 级网络计数；它不能证明 `/api/chats/get` 或 `/api/chats/save` 的精确次数，只能证明这次采样的 Floor no-op 没有执行 `STORE_SAVE_FLOOR`。

与改动前 no-op 样本的 1259.3 ms 相比，本次观测少 845.7 ms（约 67.1%）。这是单次真实宿主样本对比，不是跨环境性能承诺。

## 3. 当前源码调用链

### 3.1 手动保存推演周期

改动前 `runtime/events.js:5865-5873` 在 Timing 事务完成后通过完整 Business DTO 构造 Aggregation reevaluation input；本轮已改为同一位置调用定向入口：

```text
editCharacterTimingInstance
  → eventAnalysis.getParticipantAggregationInputs()
  → participantAggregationPersistence.getParticipantAggregations()
  → 计算当前事件、窗口、story time、exposure 和候选结果
  → participantAggregationPersistence.remove/upsert
```

因此 Timing no-op 只表示 Timing Snapshot 没变化，不能证明 Aggregation 输入没有变化。当前源码没有以 Timing no-op 作为 Aggregation 短路条件。

### 3.2 Canonical business rebuild

- `runtime/event-analysis.js:2861-2969` 的 `collectActiveBusinessData()` 先解析当前 Floor、获取当前 Chat，再调用 `collectCanonicalDerivedState()`。
- `runtime/event-analysis.js:2339-2397` 的 `collectCanonicalDerivedState()` 对同一个 key 的并发调用 join；完成后的结果现在还会保留在当前 Runtime 的 `completedCanonicalBuilds` 中。只有完整六字段 Floor Version、相同 `canonicalGeneration` 和相同 `analysisPhase` 同时匹配时才复用；`includeDebug: true` 会绕过该缓存。
- `runtime/event-analysis.js:2234-2336` 的完整构建包含 tracking inputs、registry、character facts、health derive 和 reduce state；这对应日志中的约 0.98–1.02s canonical build。

该缓存不是新的 Floor 事实源：命中时仍重新取得当前 Chat/Floor target、执行 Chat token 与最终 target assertion，并在 Chat boundary、Event/World/Terminal/Health confirmed commit 后清空。缓存值通过副本返回；Tracking Runtime 的非枚举 `registry.tracking_windows` 也会保留。跨标签页或绕过当前 Runtime 的外部写入不在该内存缓存的保护范围内，仍需宿主事件或权威路径发现过期。

### 3.3 Tracking 成本

真实 trace 的 14 次 `TRACKING_REGISTRY_BUILD_PHASES` 每次约 286–291ms：其中 `window_build_ms` 约 283–290ms，`registry_rebuild_ms` 约 104–107ms。该成本发生在插件内存计算阶段，不是 `/api/chats/get`。

### 3.4 Projection refresh 串行化

- `runtime/projection-context.js:142-181` 在存在 projection evidence、attribution 或 health resolver 时调用 `collectActiveBusinessData()`。
- `runtime/projection-context.js:227-232` 在写入前再次检查 Chat/Floor 是否仍匹配。
- `runtime/projection-context.js:306-309` 用 `refreshTail.then(...)` 串行执行刷新，但没有按 Chat/Floor/Swipe/版本合并或丢弃重复请求。
- `runtime/events.js:4578-4581` 在 lifecycle/generation 事件中触发刷新，`4774-4779` 在 runtime init 触发首次刷新。

源码状态：`SOURCE_VERIFIED`。仅凭当前日志还不能把每一次 canonical build 一一归因到某个外部事件，但 repeated refresh → full rebuild 的链路已经存在。

### 3.5 UI 异步等待

- `ui/app.js:3755-3770` 对 UI refresh 做单次 in-flight 合并，但完成后可由 `businessRefreshQueued` 再次启动。
- `ui/app.js:3782-3787` 同步等待 `runtime.collectActiveBusinessData()`。
- `ui/app.js:4850-4855` 的 `render()` 会在业务状态未加载时启动异步 refresh；route switch 的同步计时不包含该异步任务。

因此“页面切换慢”可能表现为：页面壳同步很快，但内容在后台等待约 1s 的 business read；这与“DOM render 本身耗时”是两件事。

## 4. 根因分层

### 已证实

1. no-op 保存慢的主要时间来自 Aggregation 重评估输入，而不是官方 GET/SAVE。
2. changed 保存的主要工作是约 1.15s 的重评估，加上两次独立宿主保存等待及各自 readback。
3. 页面/角色数据读取存在重复 canonical build；同一 Floor 的顺序调用现在可以在安全身份与 generation 条件满足时复用完成结果。
4. Projection refresh 采用串行队列，重复请求不会自动 coalesce。

### 合理推测，仍需进一步归因

1. Context-first 持久化改动可能让业务刷新或 projection refresh 更频繁地触发；当前日志能证明重复构建，不能仅凭日志证明它由某一行本轮变更引入。
2. `runtime/events.js:6188-6192` 的 runtime wrapper 在每次 business read 后再调用 `projectionRuntime.getBusinessData()`，可能增加附加读取或 DTO 组装；需要对该函数内部阶段单独测量才能量化。
3. `getParticipantAggregations()` 的历史 Floor 扫描可能贡献 `AGGREGATION_REEVALUATION_INPUT` 的一部分；当前阶段把它与 canonical business read 合并计时，尚未分离。

### 不能从当前证据推出

- 不能说宿主 `/api/chats/get` 是 no-op 的主要原因。
- 不能说 Timing 与 Aggregation 可以安全合并成一笔事务。
- 不能说删除一次 projection refresh 或永久缓存 canonical state 已经安全。

## 5. 已收敛的最小方案（单角色输入已实施）

一次用户操作只修改一个目标角色。不能因为一个 Floor 中存在多个 Aggregation item，就把它当成多人同时编辑；其他角色只需要在 Snapshot 合并时保留。

### 5.1 保留两笔逻辑事务

```text
当前 Floor Context
  → 目标角色 Timing A 计算为 B
  → Timing Coordinator 保存并 readback
  → 只构造目标角色 Aggregation 输入
  → 目标角色 Aggregation 计算
  → Aggregation Coordinator 仅替换目标 item
  → Aggregation 保存并 readback
```

Timing 成功后才进入 Aggregation。若 Aggregation 计算或持久化失败，返回部分成功，不回滚已确认 Timing。

### 5.2 单角色定向输入（已实施）

当前 `runtime/events.js:5865-5877` 调用 `eventAnalysis.getParticipantAggregationInputs()`，由 `runtime/event-analysis.js:2013-2057` 提供目标角色输入。它不再为该路径调用完整 `collectActiveBusinessData()`，只提供：

- 当前目标角色的有效 Event 与 exposure 关联；
- 当前目标角色的 Tracking Window；
- 当前 Story Time；
- 当前目标角色已有 Aggregation；
- Timing readback 后的目标 Timing。

输入必须来自现有 Floor storage/runtime abstraction，不能直接建立第二个 `message.extra` 事实源。

Aggregation 的合并规则保持：

```text
items = old.items.filter(item => item.subject_id !== targetSubjectId)
items.push(nextTargetItem) // 或在 before_min 时移除 target item
```

其他角色、其他 Snapshot、历史 Floor 和其他扩展字段原样保留。

### 5.3 Projection/UI 不进入保存关键路径

保存函数直接使用 Timing 和 Aggregation 的 readback 结果更新当前 UI；不在保存完成后再次触发完整 `collectActiveBusinessData()`。Projection Runtime 已构造的同一 Floor Business DTO 在最终 Context refresh 中按完整 Floor Version 复用；独立生命周期请求仍保持串行，尚未合并。

Timing popup 的打开、读取完成和关闭现在优先只替换当前 Character detail pane，不重建 `.bioweave-main`；detail 尚未挂载时才使用原有整页渲染回退。异步读取继续校验 request identity、Chat、route、focused character 和 editor open 状态，关闭或切换后的迟到结果被丢弃。

### 5.4 明确不做的事情

- 不合并 Timing/Aggregation 两笔逻辑事务；
- 不改变部分成功语义；
- 不按 UI dirty 状态直接跳过 Floor/Swipe/epoch 校验；
- 不引入永久全局 Floor 缓存；新增的是当前 Runtime、按完整 Floor Version/generation 限定的短生命周期 canonical read cache；
- 不重新计算同一 Floor 中未被编辑的角色；
- 不删除任何必要的保存后 readback。

### 5.5 本轮新增的 Projection DTO 复用

`projectionRuntime` 在 `collectInputs()` 中已经构造完整 Business DTO。现在
`runExecution()`、`tickLifecycleOnly()` 和 `deleteProjection()` 将该 DTO 传给最终的
`refreshProjectionContext()`。Coordinator 只在 DTO 内的
`current_floor.version` 与刷新开始时解析出的完整六字段 Floor Version 完全一致时复用；
否则回退原来的 `collectActiveBusinessData()`，并继续执行刷新末尾的 Chat/Floor 校验。

这不是跨操作缓存，也不是永久状态源；它只消除同一调用链中已构造状态的重复 canonical build。

## 6. 需要的下一步证据

- 为目标角色输入读取、`getParticipantAggregations()` 和现有完整 `collectActiveBusinessData()` 补充独立耗时测量。
- 在测试中构造单角色 A 写入，确认角色 B 的 Aggregation、其他 Snapshot 和历史 Floor 完全不变。
- 覆盖目标角色 `before_min`、`in_window`、`overdue`、缺少 Exposure、已有 Aggregation 和显式移除。
- 覆盖 Timing 成功后 Aggregation 计算失败、保存失败、readback 失败的部分成功语义。
- 对 projection refresh 建立 Promise barrier 测试：重复等价请求、不同版本请求、Chat 切换、generation boundary、失败后队列恢复。
- 用 `npm run check` 和 `git diff --check` 作为 Execute 阶段质量门；本轮已实际运行并记录结果，且已补录 220906 真实宿主复测。仍需 changed 操作和 endpoint 级网络计数样本，才能完成完整的宿主 I/O 对照。
