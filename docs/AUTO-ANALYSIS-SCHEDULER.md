# BioWeave Auto Analysis Scheduler Architecture

当前 scheduler 的行为语义以本文为准；自动分析模块的职责边界、公开 ports 和禁止
跨层访问以 [Automatic Analysis Isolation Contract](../.trellis/spec/domain/automatic-analysis.md)
为准。当前模块 ownership 仍以 [ARCHITECTURE.md](./ARCHITECTURE.md) 为准：
`runtime/generation-lifecycle.js` 拥有 generation intent、settle barrier 和
exactly-once state machine；`runtime/sillytavern-adapter.js` 只负责 ST listener
subscribe/unsubscribe；`runtime/events.js` 负责 lifecycle orchestration；
`runtime/event-analysis.js` 负责 scheduler、execution 和 analysis pipeline。

Manual Character 不属于该自动 scheduler 的 World prerequisite：UI 通过
`analyzeCurrentCharacterEvents()` 进入 Event-only 执行，先读取已持久化且
canonical-ready 的 at-or-before World；缺少 World 时返回 `WORLD_MODEL_REQUIRED`
并 fail closed。该路径的 World AI 调用数为 0，不改变下方 Generation settled
到 AUTO World → Event 的状态机。

状态：`CLOSED` / 已完成。本文档是 BioWeave Auto Analysis Scheduler 的唯一
权威说明。其它文档只描述摘要并链接到本文档；Floor ownership、持久化位置和
清除生命周期仍以 [Floor State Ownership Contract](../.trellis/spec/domain/floor-state.md)
与 [BioWeave Data Lifecycle](./bioweave-data-lifecycle.md) 为准。

当前阶段验收范围：普通连续 Character generation 已在真实宿主验证
`interval=3` 到期、automatic exactly once、analysis success，以及 UI current
Floor refresh。Swipe、reroll、cancel、stop 等特殊路径主要由自动化回归覆盖，尚未
全部完成真实宿主人工验收；该 remaining acceptance coverage 不阻塞本阶段
`CLOSED`。没有新的真实宿主证据时，不重新打开本阶段或继续重构 scheduler。

## 1. 核心定义

World routing 与 World Analysis 语义分离。没有有效 World Model 时调用 Full；有
效 World 且存在 world-relevant update signal 时调用 Supplement/Patch；有有效
World 且没有 update signal 时 Reuse。Scheduler 只决定调用时机，不定义 Full 或
Supplement 的事实语义；完整规则以 [World Model and World Analysis Contract](../.trellis/spec/domain/world-model.md) 为准。

`analysis_interval` 表示“每 N 个新的有效 Character Floor 执行一次正常
Auto Analysis”，不是 SillyTavern 的物理 message floor 差值。

这里的“正常 Auto Analysis”只指需要 World/Event 或 Projection 外部 API 的分析路线。
每个已经通过 Generation settle 的有效 Character Floor，还会独立进入一次插件内部的
Projection 阶段同步：重新读取 Timing/Aggregation，按人物自己的 Story Time 判断当前
内置观察阶段，同阶段复用，跨阶段保存新的完整阶段快照。这条内部路线不调用外部 API，
也不增加 `analysis_interval` counter；因此“每三楼一次”不会阻止内置推演随每个已完成正文
推进。打开角色卡或普通只读重绑没有 settled Character Floor，不会启动这条内部路线。

因此 `interval=N` 的 N 只统计新的、有效的 Character Floor：User 消息不计数；
`MESSAGE_SENT`、`MESSAGE_RECEIVED`、`GENERATION_ENDED` 等指向 User Floor 的宿主
事件不得增加 counter；N 也不是原始 SillyTavern message index、Floor 编号，或
两个物理楼号之间的差值。

原因是 ST message floor 同时包含 User 和 Character 消息，也会受到编辑、
删除、Swipe 和宿主生命周期通知影响。物理楼号不能回答“已经出现了多少个新的
有效 Character 回复”。BioWeave 的业务单位是有效 Character Floor，因此
scheduler 只消费 Character Floor progression。

User message 永远不是 BioWeave Floor，不创建 Floor Version，也不推进 counter。
编辑、删除、普通 lifecycle update 同样不产生新的 Character Floor。

counter 的精确定义是：

> 当前自动分析周期内，已经观察到的新的有效 Character Floor 数量。

它不是 ST message count、message_id、floor number，也不是与上次成功分析之间的
物理楼号差。

当前有效时间线是 scheduler 的事实来源：baseline 是当前 Chat 中仍存在、active
Swipe 与完整 Floor Version 均有效的最近成功 Character/Event Analysis Floor。
Runtime 会在 reload、删除/回滚、active Swipe/version replacement 或 manual
reanalysis success 等缓存可能失真的边界重新计算 baseline、baseline 后的有效
Character Floor 成员和 due 状态。`counter`、`observedFloorKeys`、
`countedFloorKeys` 只是可重建的 Runtime cache / execution state，不是第二套
历史时间线，也不新增 persisted counter 或 Chat-level scheduler truth。正常向前
生成仍走轻量增量路径。

## 2. Lifecycle event 只是观察信号

SillyTavern event 不直接等价于业务结论。Runtime 必须先结合当前消息集合、
Character owner、active Swipe、六字段 Floor Version、正文签名、generation intent
和当前 scheduler state 判断真实语义，然后才执行动作。

| Host signal | Runtime 需要判断的业务语义 |
| --- | --- |
| `CHARACTER_MESSAGE_RENDERED` | 是否形成新的有效 Character Floor；只有确认后才可能推进 counter |
| `MESSAGE_EDITED` / `MESSAGE_UPDATED` | ordinary edit/update 还是其它宿主更新；普通路径只更新签名基线并失效旧派生事实，不自动 AI |
| `GENERATION_STARTED` | 是否是真正 reroll/regenerate intent，并记录生成前 Floor Version |
| `GENERATION_ENDED` / stopped / cancelled | 是否形成新 Floor Version；若没有，清理 pending intent，不分析、不计数 |
| `MESSAGE_SWIPED` | existing Swipe switch 还是 pending new Swipe generation |
| `MESSAGE_SWIPE_DELETED` | 删除并重建 active path，不因为删除动作自动分析 |
| User message signal | 只更新 lifecycle baseline，不创建 Floor、不计数、不分析 |

普通 `MESSAGE_EDITED` 和 `MESSAGE_UPDATED` 不自动调用 World API 或
Character/Event API。它们只允许 Runtime 正确更新当前正文签名、Floor Version
识别基线及必要的 downstream invalidation。

## 3. 状态机

```text
                 新有效 Character Floor
                          │
                          ▼
                    counter + 1
                          │
                 ┌────────┴────────┐
                 │                 │
              未到 interval       达到 interval
                 │                 │
                idle              due
                                   │
                                   ▼
                             Auto Analysis
                              │          │
                           success      failed
                              │          │
                              │     ┌────┴──────────────┐
                              │     │                   │
                              │ retry_failed=true  retry_failed=false
                              │     │                   │
                              │  保持 due          保持 due + retryPaused
                              │     │                   │
                              │ 下一 Character     后续 Character 不自动请求
                              │     │                   │
                              └─────┴──────┐       │
                                           │       │
                                      force attempt
                                 Manual Refresh only
                                           │       │
                                  ┌────────┴───────┐
                                  │                │
                               success           failure
                                  │                │
                       counter=0, paused=false   保持 due/paused
                                  │                │
                                  └──── idle ──────┘
```

调度结论 `character-interval` 的含义是“本楼跳过外部 API 分析”，不代表本楼跳过
内部 Projection 阶段同步。内部同步若发现当前楼层缺少合法 Floor owner slot，会先通过
现有 Floor Coordinator 继承最近有效的 `events` 与 `character_registry` 建立当前快照；
这不会伪造分析成功状态，也不会改变 scheduler 的 counter/baseline。

完整业务链是（外部路线）：

```text
World Full / Patch / Reuse
  -> World validation and persistence
  -> current Floor read-back
  -> canonical World page view-model / selector readiness
  -> WORLD_READY
  -> Character/Event Analysis
  -> validation
  -> Floor persistence and derived refresh
```

内部路线是：

```text
settled Character Floor
  -> Timing/Aggregation 与当前阶段判断
  -> 同阶段复用，或准备完整内置阶段
  -> 当前 Floor Projection batch persistence（仅跨阶段）
  -> Projection read-back 与 Context refresh
```

### 阶段 Ready 边界

`retry_count` 是单一的请求总预算：`ai/client.js` 先负责网络、HTTP 429/5xx
等传输重试，也负责本地超时、空响应、损坏传输响应和明确的错误响应包；Runtime
不再消费请求重试预算，也不完整重跑已返回结果的 World/Event 阶段。一次 Event 阶段只有在 Event/Character Floor 槽位完成 authoritative
read-back，并且通过与人物页共用的 canonical `collectActiveBusinessData()`
路径重建当前 Floor、Events、registry 和业务 state 后，才算
`CHARACTER_UI_READY` 与 `EVENT_STAGE_ATTEMPT_SUCCEEDED`。这里的 UI-ready 是
业务 view-model 可重建，不要求面板、路由或 DOM 已打开；纯 DOM 渲染问题不应
消耗 AI retry。

World 阶段同理：World API 成功只是中间的 `WORLD_ACCEPTED`，必须继续完成
持久化、read-back、Floor/Swipe 校验和 canonical World view-model readiness，
才算 World Ready 并允许 Event 阶段开始。模型正文返回后的持久化、read-back、
Floor/Swipe、canonical 或 UI-ready 失败直接结束当前分析，不重新请求 AI；后续
新的有效 Character Floor 或手动操作仍可重新发起一次新的分析。

AI 阶段的 persistence/canonical readiness 诊断使用独立的 attempt trace；诊断
事件不是业务 UI invalidation 事件。UI refresh 会从当前 Floor/active Swipe
重新收集业务 state，并以 refresh sequence 防止旧结果覆盖新结果。

Promise resolve 只表示某个保存调用完成，不自动等于 SillyTavern 文件已经永久
提交。BioWeave 的 full-chat save trace 会区分 captured、dispatched、resolved
和 readback-confirmed；插件初始化/Chat 切换也会从当前 authoritative Floor/Swipe
记录 `RELOAD_FLOOR_SLOT_AUDIT`，runtime cache 不是 reload 的事实来源。

只有本次应完成的整条链成功，才允许 `counter=0`。成功消费一个周期后回到
`idle`；失败不是成功消费周期，而是“欠着一次分析”，所以 counter 保持在
饱和值 `interval`。

### retry=true

失败后保持 `due`。下一个新的有效 Character Floor 自动重新执行当前业务流程，
直到成功。成功才清 counter。

### retry=false

失败后保持 `due` 并进入 `retryPaused`。后续新的 Character Floor 不自动请求。
ordinary edit、User、delete、普通 update 不能解除 paused、清 counter 或触发
retry。只有 Manual Refresh / manual reanalysis 可以 force attempt；成功清 counter
并退出 paused，失败继续保持 due/paused。Reroll、regenerate 和 new Swipe 不是
automatic force 入口，最终有效 Floor Version 形成后仍按普通 Character interval
计数。

## 4. Floor、edit、reroll 和 Swipe

### ordinary edit

正文编辑会形成新的正文签名/Floor Version 基线，并按 Floor ownership 规则使
旧派生结果失效；它不增加 counter，不绕过 interval，不自动调用 AI，也不能解除
`retryPaused`。

### true reroll/regenerate

generation lifecycle 仍负责识别真实 generation、等待 settle、确认最终完整
Floor Version、处理 active Swipe、supersede/cancel 和迟到 callback，但这些 intent
属性不再决定 automatic scheduler 是否立即调用 AI。新的有效 Floor Version 只进入
普通 Character interval：

1. 真实 generation intent；
2. 新的完整 Floor Version，至少 content hash、message version 或 Swipe owner
   发生有效变化。

只有新 Floor Version 定型后才进入普通 interval。相同 generation intent 但正文和
版本未变化时，不分析、不推进 counter。日志中的 `generation_type=regenerate` 只
说明宿主发出了 regenerate intent；它不再产生 automatic `force-analysis`，也不能
单独证明用户是否实际点击了 reroll UI。

### existing Swipe switch

切换到已有 Swipe 不等于重新生成：

- 有匹配当前六字段 Floor Version 的成功分析：直接 reuse，API=0；
- 没有匹配成功分析：不推进 counter，不自动触发 interval analysis；
- 后续只能由 Manual Refresh、真正 new Swipe generation，或后续新的有效
  Character Floor 推动分析。

### new Swipe generation

pending new Swipe generation 等待正文定型并形成新 Floor Version，然后进入普通
interval。同一次生成可能产生多个 ST events，但相同 Floor Version 只能得到
一个实际 Analysis Job。Runtime 还会在一次 generation intent 首次消费后保留一个
有限的 completed marker；后续同一 generation 的重复 CMR，即使正文继续流式变化并
形成新的签名，也不会被当成新的自动 Character Floor 或再次 force。下一次真实
`GENERATION_STARTED` 才开启新的 generation 生命周期。

completed marker 缺少明确 message/Swipe owner 时，只能按已消费的同一消息槽
（同一 message index）匹配；不得把缺失 owner 字段当成 wildcard，从而吞掉后续新的
Character Floor。只有未被 completed marker 认领的新 Character Floor 才进入 normal
automatic-analysis handoff；同一 generation 的重复通知由 generation marker 截断，
而已进入 scheduler 的 Floor 由 `observedFloorKeys` 幂等拦截。generation lifecycle
不得代替 scheduler 写入 `observedFloorKeys`；它只能返回 stopped、cancelled、
same-version 或 existing-Swipe 等 lifecycle outcome，由 scheduler handoff 统一决定
是否记录不可计数版本。

#### 后台延迟与 owner 防线

手机前后台切换可能延迟 host event、Promise continuation 或 timer，但不改变
Analysis owner。pending generation 在新的 Character Floor 定型时必须被旧 owner
supersede；迟到的 `GENERATION_ENDED`、settle callback 或 scheduler callback 不得
复活 stale Floor。Analysis execution 在首次 AI 调用前仍须验证 Chat、active Swipe、
完整六字段 Floor Version 与 generation identity；验证失败即 fail closed。该防线不依赖
`visibilitychange`，也不把前台 timer 当作任务队列。

Scheduled-analysis 的 success/failure completion 在修改 counter、retry/due state 或
failure latch 前，必须重新校验 captured Chat、完整 Floor Version、active Swipe 与
当前 scheduler reconciliation revision；旧 owner 的 completion 统一丢弃，不得覆盖
reconciliation 后的 scheduler state。

#### 宿主事件入口诊断

SillyTavern `eventSource` listener 在转交 Runtime lifecycle handler 之前记录
`HOST_EVENT_RECEIVED`，并在转交完成或异常后记录 `HOST_EVENT_FORWARD_RESULT`。
这些诊断不依赖 `AUTO_ANALYSIS_TRIGGERED`、Analysis execution 或 AI 请求，因此即使
自动分析完全没有启动，也能从 Runtime 调试信息导出中确认宿主事件是否到达 BioWeave。
进入 `event-analysis` 之后的 `CHARACTER_MESSAGE_RENDERED_RECEIVED` 只能证明 Runtime
已经收到 target，不能替代宿主入口诊断。

## 5. World 请求重试不重放业务 Stage

`retry_count` 只为当前 AI 请求尚未得到有效模型正文时的请求层暂时性故障提供
额外尝试，不会重跑已经返回模型正文后的 World/Event 完整业务 Stage。前一次
请求必须已经失败结束，下一次请求才允许开始；解析、Schema、领域、identity、
evidence、持久化、read-back 或 canonical/UI-ready 失败均直接结束当前分析。

请求层 retry 发生在同一次 Analyzer 调用内部，不重新 resolve 当前 Floor，也不重新
执行 World/Event 业务 Stage：

- 没有当前可用 World：Full；
- 已有合法 World 且没有 world-relevant 新证据：Reuse；
- 已有合法 World 且当前分析触发了 world-relevant 更新信号：Supplement/Patch。该信号只决定是否调用 Patch 能力，不限定 Patch fact 必须首次来自当前 Floor；Patch 仍将 Existing World Model 与完整允许的 World Analysis evidence 做 baseline-aware world-knowledge review/consolidation。Existing baseline 不是 evidence。

因此：

- World Full 的请求层失败由 Client 在预算内重新请求；不会创建假的 World，也不会调用 Character/Event；
- World Patch 的请求层失败由 Client 在预算内重新请求；不会调用 Character/Event，终止后新的分析再按当前规则 resolve；
- World 保存成功不等于 `WORLD_READY`。只有当前 Floor/active Swipe read-back
  成功且共享 World page canonical view-model 能得到非空、合法、可渲染模型时，才允许
  Character/Event API；否则失败为 `WORLD_MODEL_UI_NOT_READY`，Character/Event 调用次数为 0。
- World 已成功保存但 Character/Event 失败时，不回滚历史 World，也不重新请求
  World AI；后续新的有效分析可以 Reuse 该 World；
- World 成功、Character/Event 失败不会破坏已经合法保存的 World。

World-specific single-flight 和 Analysis single-flight 仍按完整 Floor Version
复用同一个进行中的 Job/Promise。

### 5.1 Floor Version mismatch 的诊断分类

`STALE_FLOOR_VERSION` 不是请求重试结论。官方持久化 prewrite 仍然必须拒绝
版本不匹配的写入，但 Runtime 会再次检查当前 Chat、Character owner、Floor、
active Swipe、正文 hash、message version，以及 execution 是否仍 active。

- 若这些 live owner 条件仍与 execution 相同，而错误明确来自旧的
  `official_owner` / source-owner 兼容路径，且官方 `/api/chats/get` 的 owner 版本
  暂时落后，分类为 `temporary_server_convergence`。该分类只用于诊断；由于它发生
  在模型正文返回后的 persistence 阶段，本次仍然停止，不重新请求 AI，也不能只重放
  persistence。普通 Context-first Coordinator 事务不
  走这条官方 prewrite GET 收敛路径；其 stale 判断以当前加载的 Chat Context 和
  Floor Version 为准。
- 若 Chat/Floor/message/Swipe/正文版本确实变化，或 execution 已取消、被替代、
  插件已禁用或 ownership 已丢失，分类为 `true_owner_change`，立即停止，不向旧
  owner 写入，也不启动 retry。

因此 stale guard 没有被放宽：本次 mismatch 的写入始终失败；诊断会记录比较来源、
字段级 mismatch、live owner 比较和 `retryable: false`，避免把 persistence
convergence failure 误报为 API 连接失败。

### 5.2 Stage failure classifier 与 timeout

`retry_count` 是一次请求的总预算，不是由 API 客户端和 Runtime 各自独立消费的两份
预算。对 World/Event/Health 等普通分析，`ai/client.js` 是请求重试拥有者，负责网络
中断、HTTP 429/5xx、本地超时、空响应、无效传输 JSON/SSE 和明确的响应错误包；外部
取消、upstream-timeout 和 truncated 不重试。Runtime 只记录阶段 attempt 成败，不
重新发起通用请求。Storyline Judge 另有同一预算的重复 settle 防护：它只允许同一
`due_attempt_id` 在预算内再次尝试，并把 Client 报告的 transport attempt 计入同一预算，
避免在 Client 已耗尽预算后再开一轮外层 Judge 请求。

对于 World/Event/Character 的普通 AI 请求，Client 的每次后续请求都必须在前一次请求
失败结束后开始，且整个请求序列最多使用 `retry_count + 1` 次请求；Runtime 不会在
Client 之后再开第二份预算。

受孕前剧情支线的 Judge 是一个有明确边界的例外：同一 `due_attempt_id` 被后续
`settled()` 再次处理时，Runtime 可以在同一个 API 来源的 `retry_count` 预算内继续
发起外层 Judge 尝试，但不会创建另一份无限预算。`chat_id + subject_id +
due_attempt_id` 在请求进行中保持 single-flight；如果 Client 的失败对象带有已消耗的
`error.attempt`，Runtime 先把该次数计入同一预算，避免 Client 已用尽请求重试后又额外
发起一轮。`retry_count=0` 只允许初始 Judge；预算耗尽时保留 due 快照并记录停止诊断，
不再发送 API。World/Event/Character 的普通阶段仍遵循前文的 Client-only 请求层重试
规则。

模型正文已经返回后发生的 JSON/Schema/领域/identity/evidence 校验失败，以及
持久化/read-back、canonical readiness、UI-ready 或 Floor owner mismatch，均记录
`retryable: false`、`retry_decision: "stop"` 并结束当前分析。取消、ownership lost、
disabled、认证和配置错误同样不可重试。底层 `AbortController` 的 timeout abort 与
用户取消必须分开：带有 timeout 标记的 `AbortError` 是可重试的，用户取消产生的
`REQUEST_ABORTED` 仍不可重试。

阶段终态失败记录（例如保存 `failed`/`cancelled` attempt metadata）不属于新的
World Stage。它使用独立的 `ANALYSIS_*` persistence trace domain，避免把终态记录
误读为一次额外的 `WORLD_SAVE_*`。

## 6. Runtime scheduler state

以下 scheduler 状态仍由 `runtime/event-analysis.js` 的 Analysis Pipeline
Coordinator 持有。Generation-specific intent/settle state 由
`runtime/generation-lifecycle.js` 持有，不能因名称相近而合并。

以下状态全部是 Runtime-only，不写入 Chat metadata、Floor、Snapshot、World Model
或历史分析结果：

| State | 含义 | 生命周期 |
| --- | --- | --- |
| `counter` | 当前周期已观察的有效 Character Floor 数 | 成功清零；失败保持饱和；Chat switch/destroy 清零 |
| `retryPaused` | `retry_failed_analysis=false` 的失败暂停 | force 成功或 Chat switch/destroy 清除 |
| `countedFloorKeys` | 已计入 counter 的 Floor Version 去重 key | 只作 Runtime 去重/诊断，使用有界最近集合 |
| `observedFloorKeys` | 已观察过的 Floor Version，防止重复 lifecycle 通知 | 使用有界最近集合，不得随长 Chat 无限增长 |
| `pendingGeneration` | 等待 reroll 新正文定型 | 新 Floor Version 定型后消费；ended/stopped/cancelled 且未定型时清除 |
| `pendingSwipeGeneration` | 等待新 Swipe 正文定型 | 新 Floor Version 定型后消费；终止且未定型时清除 |
| `completedGeneration` / `completedSwipeGeneration` | 本次 generation intent 已消费或已终止，阻止后续同生命周期 CMR 重入 | 下一次 generation intent、Chat switch 或 destroy 清除 |
| `lastFailure` | 当前 Runtime 调度诊断 | 成功、Chat switch 或 destroy 清除 |

去重 key 必须是有限 Runtime hint，而不是历史事实源。实现使用固定上限的最近
Floor Version 结构；达到上限后淘汰最旧 key。这样可以防止长 Chat 使 Runtime
状态无界增长，同时不引入新的持久化字段或历史回写。

Chat switch 会先使旧异步工作失效，再清除 scheduler state。Runtime destroy
同样取消/丢弃进行中的工作并清除全部 scheduler state。重新初始化从当前 host
消息和 Floor facts 重新建立，不恢复旧 Runtime counter。

## 7. 三个正确性边界

- **Floor Version**：回答“这份分析属于哪一个 Chat/message/floor/Swipe/正文版本”。
  它防止编辑、Swipe 切换和异步旧结果错误归属。
- **single-flight**：回答“同一个 Floor Version 当前是否已有 Job”。它防止 Auto、
  Manual、reroll 和重复 lifecycle event 产生并发重复 API 请求。
- **stale guard**：回答“异步结果返回时 owner、Chat epoch 和 Floor Version 是否仍
  有效”。失效结果只能丢弃，不能覆盖当前 Floor 或重建当前 Registry。

三者不是 scheduler counter 的替代品：counter 管业务周期，Floor Version 管
事实身份，single-flight 管并发，stale guard 管异步提交安全。

World UI 只在真实 World-owner mutation 后失效并重载。`GENERATION_ENDED`、
`MESSAGE_RECEIVED` 等纯生命周期信号不代表 World 已被修改，不能仅凭这些事件清空
已经从 active Floor resolver 读取的 World Model；最终显示仍来自 Floor-owned
`resolveWorldModelAtOrBefore`，不建立 Chat metadata 旁路。

Runtime 发布带有业务阶段的 World/Analysis status；`ui/app.js` 将阶段映射为页面
busy 状态，并将自动分析最终结果转换为顶部 toastr。自动 World 成功不单独弹窗，完整业务链成功只弹一次；通知按
Chat、Floor Version、attempt/trigger、domain 去重。面板关闭不影响 toastr，插件关闭后
会丢弃迟到的 success/error notification。手动 World Full/Patch 与 Manual Refresh
仍分别显示各自操作结果。

### 7.1 阶段级 UI 状态

Runtime 是阶段真相源；ST lifecycle event 不能由 UI 自己推断当前 API 阶段。自动分析
发布以下运行阶段：

- `world_full`：World Full 正在运行；世界页“开始分析”显示“分析中…”并禁用；人物页显示“等待世界分析完成…”；
- `world_patch`：World Patch 正在运行；世界页“补充分析”显示“补充中…”并禁用；人物页不显示分析中；
- `world_readback` / `world_ui_ready`：World 已保存，正在完成 read-back 与 canonical view-model ready 检查；仍保持对应 World 按钮 busy；
- `event_analysis`：World 已达到 `WORLD_READY` 或被合法 Reuse；World 按钮恢复，人物页才显示“分析中…”。

终态 `success`、`failed`、`cancelled` 清理所有 busy 状态。World 失败或 UI-ready
失败不会发布可被 UI 视为 `event_analysis` 的阶段，因此人物页不会先进入 busy。
手动 World Full/Patch 与 Manual Refresh 复用同一阶段映射，但不改变各自原有操作和通知语义。

## 8. 已废弃设计

以下结构不得重新加入：

- ST physical floor difference interval：混淆 User 与 Character，无法表达有效
  Character progression；
- `isIntervalTarget` scheduler 用途：把物理楼号差值伪装成业务周期；
- `lastProcessedFloor` scheduler 状态：以历史物理 floor hint 代替 Runtime counter；
- `MESSAGE_EDITED -> force`：普通编辑不是新的 Character 回复；
- `MESSAGE_UPDATED -> force`：宿主普通更新不是分析意图；
- `MESSAGE_SWIPED -> unconditional force`：existing Swipe switch 不是新生成；
- `MESSAGE_SWIPE_DELETED -> unconditional force`：删除不会产生新的 Character Floor。

未来维护者不得以“简化生命周期处理”为理由恢复这些路径。事件名称只能作为
观察输入，业务动作必须经过当前 Floor Version、owner、generation intent 和
scheduler state 的组合判断。

## 9. Activity 与宿主持久化边界

一次 Analysis execution 只有一个 Activity identity：`chat_id + Floor Version +
attempt + domain`。World/Event phase 只是该 execution 的状态更新，不能再次
`startActivity`；`success`、`failed`、`cancelled` 或 `disabled` 只允许完成一次
对应 identity。这样悬浮窗反映的是执行数量，而不是状态事件数量。

自动分析成功还必须通过 Floor Coordinator 的 Context-first owner merge 与
authoritative read-back；不能把当前内存可读或一次 `saveChat()` 调用当作宿主已提交。
只有显式 source-owner 兼容操作才使用 latest-source merge。SillyTavern 生成消息的
生命周期事件是观察信号，最终 Floor 写入继续遵守
[`docs/bioweave-data-lifecycle.md`](./bioweave-data-lifecycle.md) 的 commit contract。
