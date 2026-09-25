# BioWeave Auto Analysis Scheduler Architecture

当前模块 ownership 以 [ARCHITECTURE.md](./ARCHITECTURE.md) 为准：
`runtime/generation-lifecycle.js` 拥有 generation intent、settle barrier 和
exactly-once state machine；`runtime/sillytavern-adapter.js` 只负责 ST listener
subscribe/unsubscribe；`runtime/events.js` 负责 lifecycle orchestration；
`runtime/event-analysis.js` 负责 scheduler、execution 和 analysis pipeline。

Manual Character 不属于该自动 scheduler 的 World prerequisite：UI 通过
`analyzeCurrentCharacterEvents()` 进入 Event-only 执行，先读取已持久化且
canonical-ready 的 at-or-before World；缺少 World 时返回 `WORLD_MODEL_REQUIRED`
并 fail closed。该路径的 World AI 调用数为 0，不改变下方 Generation settled
到 AUTO World → Event 的状态机。

状态：规范性设计说明。本文档是 BioWeave Auto Analysis Scheduler 的唯一
权威说明。其它文档只描述摘要并链接到本文档；Floor ownership、持久化位置和
清除生命周期仍以 [Floor State Ownership Contract](../.trellis/spec/domain/floor-state.md)
与 [BioWeave Data Lifecycle](./bioweave-data-lifecycle.md) 为准。

## 1. 核心定义

World routing 与 World Analysis 语义分离。没有有效 World Model 时调用 Full；有
效 World 且存在 world-relevant update signal 时调用 Supplement/Patch；有有效
World 且没有 update signal 时 Reuse。Scheduler 只决定调用时机，不定义 Full 或
Supplement 的事实语义；完整规则以 [World Model and World Analysis Contract](../.trellis/spec/domain/world-model.md) 为准。

`analysis_interval` 表示“每 N 个新的有效 Character Floor 执行一次正常
Auto Analysis”，不是 SillyTavern 的物理 message floor 差值。

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
                                 Manual Refresh / reroll
                                           │       │
                                  ┌────────┴───────┐
                                  │                │
                               success           failure
                                  │                │
                       counter=0, paused=false   保持 due/paused
                                  │                │
                                  └──── idle ──────┘
```

完整业务链是：

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

### 阶段 Ready 边界

`retry_count` 作用于完整的 World/Event 阶段，而不是只重试一次 AI HTTP
请求。一次 Event 阶段只有在 Event/Character Floor 槽位完成 authoritative
read-back，并且通过与人物页共用的 canonical `collectActiveBusinessData()`
路径重建当前 Floor、Events、registry 和业务 state 后，才算
`CHARACTER_UI_READY` 与 `EVENT_STAGE_ATTEMPT_SUCCEEDED`。这里的 UI-ready 是
业务 view-model 可重建，不要求面板、路由或 DOM 已打开；纯 DOM 渲染问题不应
消耗 AI retry。

World 阶段同理：World API 成功只是中间的 `WORLD_ACCEPTED`，必须继续完成
持久化、read-back、Floor/Swipe 校验和 canonical World view-model readiness，
才算 World Ready 并允许 Event 阶段开始。Event 阶段失败重试时，已经 Ready 的
World 不会重新分析。

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
retry。Manual Refresh 或真正 reroll 可以 force attempt；成功清 counter 并退出
paused，失败继续保持 due/paused。

## 4. Floor、edit、reroll 和 Swipe

### ordinary edit

正文编辑会形成新的正文签名/Floor Version 基线，并按 Floor ownership 规则使
旧派生结果失效；它不增加 counter，不绕过 interval，不自动调用 AI，也不能解除
`retryPaused`。

### true reroll/regenerate

force path 必须同时满足：

1. 真实 generation intent；
2. 新的完整 Floor Version，至少 content hash、message version 或 Swipe owner
   发生有效变化。

只有新 Floor Version 定型后才强制分析。相同 generation intent 但正文和版本未
变化时，不分析、不推进 counter。成功的 reroll 是一次成功建立当前 BioWeave
分析基线的强制操作，因此清 counter 并清除 due/paused。

### existing Swipe switch

切换到已有 Swipe 不等于重新生成：

- 有匹配当前六字段 Floor Version 的成功分析：直接 reuse，API=0；
- 没有匹配成功分析：不推进 counter，不自动触发 interval analysis；
- 后续只能由 Manual Refresh、真正 new Swipe generation，或后续新的有效
  Character Floor 推动分析。

### new Swipe generation

pending new Swipe generation 等待正文定型并形成新 Floor Version，然后进入
force path。同一次生成可能产生多个 ST events，但相同 Floor Version 只能得到
一个实际 Analysis Job。Runtime 还会在一次 generation intent 首次消费后保留一个
有限的 completed marker；后续同一 generation 的重复 CMR，即使正文继续流式变化并
形成新的签名，也不会被当成新的自动 Character Floor 或再次 force。下一次真实
`GENERATION_STARTED` 才开启新的 generation 生命周期。

## 5. World retry 不是 API 重放

retry 的对象是“当前 Floor 的完整 BioWeave 自动分析业务流程”，不是机械重放
上一次 World API 调用。

每次 retry 都重新 resolve 当前 Floor 所需 World：

- 没有当前可用 World：Full；
- 已有合法 World 且没有 world-relevant 新证据：Reuse；
- 已有合法 World 且当前分析触发了 world-relevant 更新信号：Supplement/Patch。该信号只决定是否调用 Patch 能力，不限定 Patch fact 必须首次来自当前 Floor；Patch 仍将 Existing World Model 与完整允许的 World Analysis evidence 做 baseline-aware semantic differential comparison。Existing baseline 不是 evidence。

因此：

- World Full 失败时不会创建假的 World，也不会调用 Character/Event；
- World Patch 失败时不会调用 Character/Event，下一次重新按当前规则 resolve；
- World 保存成功不等于 `WORLD_READY`。只有当前 Floor/active Swipe read-back
  成功且共享 World page canonical view-model 能得到非空、合法、可渲染模型时，才允许
  Character/Event API；否则失败为 `WORLD_MODEL_UI_NOT_READY`，Character/Event 调用次数为 0。
- World 已成功保存但 Character/Event 失败时，不回滚历史 World，也不无意义重复
  Full/Patch；后续 retry 可以 Reuse 该 World；
- World 成功、Character/Event 失败不会破坏已经合法保存的 World。

World-specific single-flight 和 Analysis single-flight 仍按完整 Floor Version
复用同一个进行中的 Job/Promise。

### 5.1 Floor Version mismatch 的阶段重试分类

`STALE_FLOOR_VERSION` 不是单独的重试结论。官方持久化 prewrite 仍然必须拒绝
版本不匹配的写入，但 Runtime 会再次检查当前 Chat、Character owner、Floor、
active Swipe、正文 hash、message version，以及 execution 是否仍 active。

- 若这些 live owner 条件仍与 execution 相同，而只有官方 `/api/chats/get` 的
  owner 版本暂时落后，分类为 `temporary_server_convergence`。这是可重试的完整
  Stage failure：下一次必须重新开始 World/Event Stage，并重新请求 AI，不能只重放
  persistence，也不能复用上一次 AI 结果。
- 若 Chat/Floor/message/Swipe/正文版本确实变化，或 execution 已取消、被替代、
  插件已禁用或 ownership 已丢失，分类为 `true_owner_change`，立即停止，不向旧
  owner 写入，也不启动 retry。

因此 stale guard 没有被放宽：本次 mismatch 的写入始终失败；分类只决定当前完整
Stage 是否还有合法的 retry budget。诊断会记录比较来源、字段级 mismatch、live
owner 比较和 `retryable`，避免把 persistence convergence failure 误报为 API 连接
失败。

### 5.2 Stage failure classifier 与 timeout

`retry_count` 是业务阶段的完整重试预算，不是底层 HTTP client 的 retry 开关。
因此 transport 层的 `error.retryable` 不能直接决定 Stage 是否停止：只要当前
execution 仍拥有相同的 Chat、Character Floor、active Swipe 和 Floor Version，且
没有取消、禁用、destroy、supersede 或真实 owner 变化，未达到 Stage Ready 的失败
默认仍可消耗 Stage retry budget。

`REQUEST_TIMEOUT`、provider/network failure、空响应、解析/schema/domain failure、
持久化/read-back 和 canonical readiness failure 都按这个规则重新请求当前 Stage
的 AI；Event retry 不重跑已经 Ready 的 World。只有明确的 cancellation、ownership
lost、disabled 或不可用的业务前置才终止当前 Stage。底层 `AbortController` 的
timeout abort 与用户取消必须分开：带有 timeout 标记的 `AbortError` 是可重试的，
用户取消产生的 `REQUEST_ABORTED` 仍不可重试。

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

自动分析成功还必须通过 Floor 的 authoritative latest-source merge 与 read-back；
不能把当前内存可读或一次 `saveChat()` 调用当作宿主已提交。SillyTavern 生成消息的
生命周期事件是观察信号，最终 Floor 写入继续遵守
[`docs/bioweave-data-lifecycle.md`](./bioweave-data-lifecycle.md) 的 commit contract。
