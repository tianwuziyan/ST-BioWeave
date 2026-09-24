# Phase G Generation Lifecycle Extraction Design

以下结论来自当前工作树（包含 Phase A–F），不是基于旧 task 或
`git show HEAD`。当前 Generation lifecycle 仍主要位于
`runtime/event-analysis.js`，而 `runtime/events.js` 负责 host event subscription
与串行转发。

## A. Current Generation state machine

### State owned by the current coordinator

`createEventAnalysisCoordinator` 当前拥有：

```text
generationIntentSequence: number
schedulerState: {
  counter,
  retryPaused,
  countedFloorKeys: Set,
  observedFloorKeys: Set,
  pendingGeneration,
  pendingSwipeGeneration,
  completedGeneration,
  completedSwipeGeneration,
  lastFailure
}
lifecycleMutationChain: Promise
lifecycleSnapshot: {chat_id, epoch, entries[]} | null
```

Generation state 与 execution state 并存但不相同：`inFlight`、execution token、
abort/cancellation/currentness 仍属于 execution owner；Generation 只决定何时将
一个 target 交给 `scheduleRenderedCharacter`。

### Event → state change → guard → next action

| EVENT | STATE CHANGE | GUARD | NEXT ACTION |
|---|---|---|---|
| `GENERATION_STARTED` | 解析 source/type，观察旧 pending，标记旧 intent superseded，清 pending/completed markers，创建 `pendingGeneration` 或 `pendingSwipeGeneration` | 必须存在 generation signal；普通重复 generation 在已有 pending 时返回 `generation-intent-already-pending`；reroll/regenerate 或 swipe 可替换旧 intent | 等待最终 CMR 与 ENDED |
| `CHARACTER_MESSAGE_RENDERED` | `settleGenerationForTarget` 将 target version 写入 pending 的 `finalFloorVersion/finalFloorIndex`，并标记 `finalFloorSeen` | target Chat/message/swipe 必须与 pending owner 匹配；completed marker 或 observed key 阻止重复 consume | 未 ended：`GENERATION_SETTLE_WAITING`；已 ended：settle 并进入 scheduler |
| `GENERATION_ENDED` | pending `ended=true`，发 `GENERATION_END_SEEN` | 没有 pending 或未观察 final Floor 时只等待/返回；若 final target 已知，再重新 resolve target | `settleGenerationForTarget`；否则等待后续 CMR |
| `GENERATION_STOPPED` | 标记 pending terminal 并按 payload 清 pending/observed keys | 只处理当前 Chat/相关 message/swipe | 不分析，`generation-not-rendered` |
| `GENERATION_CANCELLED` | 同上 | 同上 | 不分析，`generation-not-rendered` |
| `MESSAGE_SWIPED`（existing） | 先做 source mutation/invalidation 与 Tracking refresh；记录 observed Floor key | payload 没有 `pendingGeneration`/`isNewSwipe`/`new_swipe` 标志；existing Floor 可复用 | `existing-swipe-reused` 或 `existing-swipe-unavailable`，不创建新 generation |
| `MESSAGE_SWIPED`（new） | 创建/替换 `pendingSwipeGeneration`，旧 pending swipe 标记 superseded | payload 明确表示新 Swipe generation | 等待 CMR + ENDED |
| `MESSAGE_RECEIVED` / `MESSAGE_UPDATED` / `MESSAGE_EDITED` | 更新 lifecycle snapshot；source mutation 可能 invalidation | User-only message 不作为 BioWeave Floor；普通 baseline mutation 不自动分析 | `lifecycle-baseline-only`，或先执行现有 mutation invalidation |
| `CHAT_CHANGED` | prime snapshot；Chat boundary listener 也清 execution/cache/scheduler | enabled 与 Chat epoch/currentness guard | refresh Tracking；不直接启动 generation analysis |
| `CHAT_CREATED` | 无 Generation state transition | 当前实现视为 unsupported | return `unsupported-event` |

所有 lifecycle work 通过 `lifecycleMutationChain.then(work, work)` 串行执行，避免
host event async reentry 改写同一 pending state。

## B. Host event → lifecycle transition map

`runtime/events.js` 在 `bindLifecycleEvents` 中从 `st.getContext().eventSource`
注册 `LIFECYCLE_EVENTS`，每个 host event listener 只调用
`handleLifecycleEvent(key, eventType, payload)`。`events.js` 先广播 Runtime event，
然后把同一事件串行交给 `eventAnalysis.handleLifecycleEvent`；最后刷新 owner/
projection 并发出 `BIOWEAVE_LIFECYCLE_SETTLED`。

因此 subscription 属于 host integration（当前 `events.js`），Generation module
不应 import ST API。未来可由 adapter 转发 plain event payload：

```text
ST eventSource
  -> events.js listener/binding
  -> generationLifecycle.onGenerationStarted/onGenerationEnded/
     onCharacterMessageRendered/onSwipe...
  -> settled callback(target, metadata)
  -> existing analysis scheduler/pipeline
```

目前这一层还与一般 MESSAGE mutation、clear、projection 和 Analysis lifecycle
共用 `eventAnalysis.handleLifecycleEvent`，所以不能机械地把整个 handler 搬走。

## C. Pending generation intent structure

### Normal / reroll intent

在 `GENERATION_STARTED` 分支创建：

| FIELD | PURPOSE |
|---|---|
| `chatId` | Chat ownership，防止旧 Chat event consume 当前 intent |
| `messageId` | generation target message identity；payload 可为空，后续 CMR target 负责解析 |
| `swipeId` | target Swipe identity；区分 reroll/current Swipe |
| `baselineVersion` | generation start 前的 six-field Floor Version；用于判断是否真的产生新 Floor |
| `generation_id` | host/request correlation（若 payload 提供） |
| `generation_type` | `normal`、`regenerate` 或 `swipe` 的诊断/ownership metadata |
| `force` | reroll/new Swipe 是否绕过普通 interval，并强制一次 scheduler run |
| `ended` | 是否已收到 `GENERATION_ENDED` |
| `finalFloorSeen` | 是否已收到并确认最终 Character Floor target |
| `settled` | exactly-once settle guard |
| `intent_id` | Runtime 本地递增 `generation-${generationIntentSequence}` correlation |

### New Swipe intent

`MESSAGE_SWIPED` 明确标记 new generation 时创建 `pendingSwipeGeneration`，字段同样
包含 Chat/message/swipe/baseline/ended/finalFloorSeen/settled/force/type/intent_id，
但当前实现不从该 payload 设置 `generation_id`。这一差异属于当前 contract，不能
在 extraction 中补齐或归一化。

### Completed marker

`markGenerationTerminal` 将 pending shallow copy 为 `completedGeneration` 或
`completedSwipeGeneration`，并附加 settled target 的 `floorVersion`。后续 CMR 通过
`generationMarkerOwnerMatches` 识别已消费 owner，防止 duplicate analysis。

## D. Settle barrier implementation

`settleGenerationForTarget(pending, target)` 是冻结 contract 的核心：

1. 没有 pending/target 时返回 `generation-awaiting-target`。
2. 首次 target 到达时写 `finalFloorSeen=true`、`finalFloorVersion`、
   `finalFloorIndex`，发 `GENERATION_FINAL_FLOOR_SEEN`。
3. `ended=false` 时发 `GENERATION_SETTLE_WAITING(waiting_for=generation-ended)`，
   返回 `generation-awaiting-end`。
4. `settled=true` 时返回 `generation-already-settled`。
5. 两个条件都满足后才写 `settled=true`、发 `GENERATION_SETTLED`、清 pending 两
   个槽、记录 completed marker，并调用现有 scheduler。

因此两个顺序均是第一类路径：

```text
A: CMR -> finalFloorSeen -> waiting -> ENDED -> settled
B: ENDED -> ended -> waiting -> CMR -> finalFloorSeen -> settled
```

`GENERATION_ENDED` 如果已经有 final target，会再次 resolve
`resolveFloorAtIndex` 后 settle；如果 resolve 失败，保留 pending，等待后续 CMR
fail-closed。不能把其中一条改成 fallback 或直接触发 AI。

## E. Exactly-once mechanism

当前 exactly-once 由多层共同保证：

- `lifecycleMutationChain` 串行化 lifecycle work；
- `pending.settled` 阻止同一 intent 第二次进入 settle；
- settle 后清空 `pendingGeneration` / `pendingSwipeGeneration`；
- `completedGeneration` / `completedSwipeGeneration` 与 Chat/message/swipe owner
  匹配，阻止后续 duplicate CMR；
- `observedFloorKeys` 由 `scheduleRenderedCharacter` 去重；
- `countedFloorKeys` 防止普通 interval 计数重复；
- `inFlight`/World single-flight/analysis execution guard 负责分析启动后的有效性，
  不属于 Generation state machine。

这能阻止 World/Event 双启动，但不能将 `inFlight` 或 generic retry 搬入新模块。

## F. Supersede mechanism

`GENERATION_STARTED` 会先记录旧 pending 的
`GENERATION_SOURCE_OBSERVED`。普通重复 normal generation 在已有 pending 时直接
返回，不替换 intent；reroll/regenerate 或新 Swipe 会将旧 pending 标记
`superseded=true`，发 `GENERATION_INTENT_SUPERSEDED`，清两个 pending slot 和
completed markers，再创建新 intent。

`MESSAGE_SWIPED` new path 只替换旧 `pendingSwipeGeneration`；existing Swipe path
不创建 intent。Chat change 通过 Chat boundary signal 清 scheduler/pending markers；
execution 的 abort/invalidation 仍由 execution owner 处理。

`pendingGenerationMatches` 要求 same Chat、payload message/swipe owner 不冲突，且
baselineVersion 与最终 target 不相同；如果 force generation 没产生新 Floor，settle
只记录 observed key 并返回 `generation-without-new-floor`。

旧 generation 的晚到 CMR 不会消费新 intent，因为 owner/Chat/message/swipe 与
completed/observed guard 不匹配；但这些检查依赖真实 target resolver，未来应通过
窄 capability 注入，不复制 Floor policy。

## G. Reroll / new Swipe behavior

- reroll/regenerate 从 `GENERATION_STARTED` 解析为 `generationKindName="regenerate"`
  且 `force=true`，最终 settle 后直接进入 `runScheduledAnalysis(force=true)`，绕过
  interval。
- source type `swipe` 同样 force；如果 host 同时发送 `MESSAGE_SWIPED` new marker，
  使用 `pendingSwipeGeneration`，不是普通 pending。
- new Swipe baseline 是 lifecycle snapshot 中的上一版本；最终 target 必须通过
  six-field Floor Version correlation，删除/错误 Swipe fail closed。
- `GENERATION_STOPPED/CANCELLED` 不会启动 World/Event，清理未渲染 intent。

## H. Existing Swipe switch behavior

`MESSAGE_SWIPED` 先判断 payload 是否有
`pendingGeneration`、`pending_generation`、`isNewSwipe` 或 `new_swipe`。没有这些
标记时，它解析当前 Floor：

- 有成功分析且 Floor Version 相同：`existing-swipe-reused`，不调用 AI；
- 没有可复用 Floor：`existing-swipe-unavailable`；
- Swipe slot 不存在：`swipe-not-found`。

因此 existing Swipe selection 不应被 Generation module 当作 new generation。这个
guard 是现有行为合同。

## I. Generation source observation

`generationTrace` 通过当前 `emitPersistenceTrace(..., domain="scheduler")`
进入 Diagnostics/trace sink。`GENERATION_SOURCE_OBSERVED` 发生在
`GENERATION_STARTED`，携带：

- generation/request id/type/source；
- current execution id；
- target message/swipe id；
- `owner_changed`；
- `supersede_decision` 与 `supersede_reason`。

它既是 diagnostic output，也记录当前 pending ownership review 的控制流依据；
不能删除、降级为普通日志或仅保留 generation source 字符串。

## J. Generation versus execution boundary

Generation lifecycle 负责：

```text
host source/type -> pending intent -> final Floor + ENDED barrier
                 -> exactly-once settled callback -> scheduler dispatch
```

Execution 负责：

```text
analysis started -> token/currentness -> abort/cancel/supersede
                  -> retry -> terminal persistence/status
```

当前 Generation code读取 execution 仅用于 `GENERATION_SOURCE_OBSERVED` 的
`current_execution_id` 与后续 `runScheduledAnalysis` 对 target 的 dispatch；不能
让 generation-lifecycle.js 接管 `inFlight`、`executionIsCurrent`、abort 或 terminal。

## K. Generation versus analysis pipeline boundary

当前 settled 后路径是：

```text
GENERATION_SETTLED
  -> scheduleRenderedCharacter
  -> interval/retryPaused/enabled decision
  -> runScheduledAnalysis
  -> analyzeFloor
  -> runAnalysis
  -> buildFloorAnalysisInput
  -> resolveFinalWorldModelForAnalysis
  -> World Full/Patch/reuse
  -> Event stage
```

Generation lifecycle 只应拥有前四项中的 pending/settle/dispatch handoff；
`runScheduledAnalysis` 的 analysis interval、retryPaused、failure/success bookkeeping
更像 Auto scheduler/pipeline owner，不应为了文件变小全部塞入 lifecycle module。

## L. Generation versus Persistence boundary

Generation lifecycle 不调用 FloorPersistenceCoordinator，也不读写 official owner。
AI 前的 host prerequisite 已由当前代码保持为 Input Ready/Floor resolver path，不
是 official durability proof。`generation_settled` 只作为 persistence trace context
和 execution metadata，不能解释为“保存已确认”。

World/Event AI 后的 owner patch、authoritative readback、host-ahead bootstrap、
`FLOOR_TX_CONFIRMED` 仍由现有 Persistence owner 处理。

## M. Analysis Input Ready boundary

审计显示没有一个独立名为 `ANALYSIS_INPUT_READY` 的状态事件。当前实现把 readiness
分在：

1. settle target 的 final Floor resolution；
2. `scheduleRenderedCharacter` 的 enabled/observed/interval/retryPaused guard；
3. `runAnalysis` 的 current target/input construction；
4. World resolver 的 existing/reuse/full/patch prerequisite。

因此未来 extraction 的 settled callback 应传 plain target/ownership metadata，
由原 scheduler/pipeline 继续做 Input Ready 和 World prerequisite。不能让
generation-lifecycle.js 调用 analyzer 或判定 official owner convergence。

## N. Auto prerequisite behavior

当前代码/测试明确保持：

- CMR 单独不能触发早于 ENDED 的 World AI；
- ENDED 单独不能触发早于 final CMR 的 World AI；
- AI 前不要求 official owner already converged；
- `automatic analysis does not use saveChat convergence before World AI` 测试保护
  这一点；
- host-ahead-of-official、authoritative owner acquisition、temporary convergence
  与 true owner change 属于 Persistence/current Floor handling，不属于 Generation
  settle。

Phase G 不能把 `saveChatConditional` 或 adapter `saveChat` resolve 重新解释成
durability proof，也不能在 lifecycle module 增加 official owner gate。

## O. `saveChatConditional` semantics

当前相关行为由 Adapter/Persistence tests 锁定：host save 返回/resolve 只表示调用
完成；official persistence 是否 confirmed 要看 authoritative owner/readback 与
Coordinator outcome。Generation code不应拥有或调用该 transport primitive。若未来
移 lifecycle，必须保持它完全不可见，只保留 settled timing callback。

## P. Floor/Swipe/version dependencies

Generation intent 直接绑定 Chat、message、swipe 与 baseline/target six-field
`Floor Version`，但版本计算和比较来自 `floor.js` / `event-analysis.js` 的通用
Floor owner。推荐未来只注入：

```text
resolveTarget(payload or index) -> plain target with version
baselineForGeneration(payload) -> plain version or null
isNewTarget(baselineVersion, targetVersion) -> boolean
rememberObserved(version) / ownerKey(version) -> narrow dedupe capability
```

如果这些 callbacks 需要让新模块复制 `sameFloorVersion`、active Swipe 或 deleted
Floor policy，则不应移动；当前是否新 Floor 的 policy 应留原 owner。

## Q. Scheduler boundary

| CURRENT CODE | CLASSIFICATION | PLANNED OWNER |
|---|---|---|
| pending intent / settle / supersede / markers | Generation lifecycle | candidate `generation-lifecycle.js` |
| `schedulerState.counter` and `countedFloorKeys` | auto-analysis scheduler | likely keep `event-analysis.js` unless a separate narrow scheduler seam is proven |
| `retryPaused`, `lastFailure` | auto-analysis retry scheduling | keep with analysis pipeline/retry owner |
| `scheduleRenderedCharacter` | generation-to-analysis handoff plus interval scheduler | mixed; do not move wholesale without seam |
| `runScheduledAnalysis` | analysis invocation/failure bookkeeping | keep `event-analysis.js` |
| `SCHEDULER_DEDUPE_LIMIT` | scheduler policy | keep with current scheduler owner |

This means Phase G is not a license to move the whole `schedulerState` object. A
Generation module may own only pending/settle/marker state, or recommendation must be
`NOT SAFE` if that split changes exact order.

## R. Settings/enabled dependencies

Generation/auto scheduler currently reads Chat-local `settings.analysis_interval` and
`settings.retry_failed_analysis` through `schedulerSettings()`. `isEnabled()` reads the
existing enabled resolver. These are read-only capabilities; settings schema/defaults
remain in existing Settings/Store owners.

`analysisRetryConfig()` separately reads global/profile API request `retry_count` and is
generic analysis retry, not Generation lifecycle. It must remain in
`event-analysis.js`.

## S. ST subscription boundary

Registration and removal are in `runtime/events.js`: `LIFECYCLE_EVENTS` is mapped to
`st.getContext().eventTypes`, listeners call the existing facade handler, and `destroy`
unwinds `unbind` callbacks. The Generation module should receive normalized event calls,
not `st`, `getContext`, `eventSource`, or `eventTypes`.

The current handler also processes generic Chat/message mutation and clear-related
coordination, so a future extraction needs either a dispatch seam or a dedicated
generation-only branch. It must not create a second ST listener set.

## T. Mutable state ownership map

| STATE | CURRENT OWNER | USED BY | MOVE TO `generation-lifecycle.js`? | WHY |
|---|---|---|---|---|
| `pendingGeneration` | `event-analysis.js:schedulerState` | lifecycle + scheduler | Yes, candidate | pure intent/settle state |
| `pendingSwipeGeneration` | same | Swipe lifecycle + scheduler | Yes, candidate | same lifecycle responsibility |
| `completedGeneration` / `completedSwipeGeneration` | same | duplicate CMR guard | Yes, candidate | exactly-once marker |
| `generationIntentSequence` | coordinator | intent ids/diagnostics | Yes, candidate | lifecycle-local counter |
| `generationTrace` emission | coordinator + Diagnostics sink | trace/UI debug | Move emission call sites only | implementation stays Diagnostics owner |
| `counter` | `schedulerState` | interval scheduler | No by default | not a settle state; affects auto policy |
| `retryPaused` / `lastFailure` | `schedulerState` | retry scheduling | No | analysis retry/auto scheduler |
| `observedFloorKeys` / `countedFloorKeys` | `schedulerState` | dedupe/interval | Keep or split only with proven semantics | scheduler policy and Floor key retention |
| `lifecycleMutationChain` | coordinator | all lifecycle mutations | No | generic lifecycle serialization and mutations |
| `lifecycleSnapshot` | coordinator | source mutation, generation baseline | No by default | general lifecycle/Floor snapshot, not only generation |
| `inFlight`/execution | coordinator | analysis | No | execution ownership |
| pending timers | none found | n/a | No new timer | do not invent timer abstraction |

## U. clear/destroy/chat-switch behavior

- Chat boundary subscription in `event-analysis.js` calls `invalidateInFlightExecutions`,
  clears Worldbook cache, and on changed Chat clears terminal/invalidation/snapshot and
  resets scheduler state.
- `invalidateForClear` invalidates Chat/executions/Floor/cache, waits for lifecycle and
  Tracking barriers, then `completeClear` may prime snapshot and refresh Tracking.
- `destroy` removes Chat boundary listener, aborts/releases executions, clears `inFlight`,
  clears World jobs and resets scheduler state. Host listeners are removed by
  `runtime/events.js` after `eventAnalysis.destroy()`.
- `pause` invalidates active executions; it does not separately model a Generation
  cancellation API.

Future lifecycle module may expose `clear()`/`destroy()` for its own pending/marker state,
but existing owner must call it in the same order. It cannot own Chat clear or Tracking
barriers.

## V. Diagnostics map

| DIAGNOSTIC | EMIT LOCATION | PAYLOAD | CONTROL-FLOW SIGNIFICANCE |
|---|---|---|---|
| `GENERATION_SOURCE_OBSERVED` | `handleLifecycleEvent(GENERATION_STARTED)` | generation id/type/source, current execution, message/swipe, owner change, supersede decision/reason | records ownership review; not just cosmetic |
| `GENERATION_INTENT_CREATED` | after normal/swipe intent creation | intent fields, pending flags | establishes pending correlation |
| `GENERATION_INTENT_SUPERSEDED` | new normal/reroll/Swipe replaces old | old intent + successor type | records old intent rejection |
| `GENERATION_FINAL_FLOOR_SEEN` | first settle target | target version/index + flags | first barrier half |
| `GENERATION_SETTLE_WAITING` | missing ENDED | `waiting_for=generation-ended` | proves no premature AI |
| `GENERATION_END_SEEN` | ENDED with pending | generation flags | second barrier half |
| `GENERATION_SETTLED` | both halves true | settled flags/target | exact dispatch point |
| `GENERATION_SOURCE_OBSERVED` and related trace payloads | `emitPersistenceTrace` scheduler domain | sanitized by Diagnostics | must preserve sequence/order |

`GENERATION_STAGE_*`, `WORLD_*`, `EVENT_*` traces after dispatch belong to analysis/
World/Event and must not move. The new module may call an injected `generationTrace`
capability; `runtime/diagnostics.js` remains owner of sanitization/buffering.

## W. Proposed `runtime/generation-lifecycle.js` responsibility

Candidate responsibility:

- maintain normal and Swipe pending intent;
- parse normalized generation source/type input;
- create/supersede intent and completed markers;
- record final target and ENDED flags;
- enforce both-order settle barrier and exactly-once transition;
- expose lifecycle-only `clear`/`destroy` for its own state;
- emit existing Generation diagnostics through injected sink;
- call an injected `onGenerationSettled(target, metadata)` exactly where current
  `settleGenerationForTarget` calls the scheduler.

It must not own interval counter, generic retry, execution maps, Floor resolver policy,
World/Event invocation, terminal persistence, Snapshot/Tracking, ST transport, UI, or
generic Chat lifecycle.

## X. Proposed API

The minimum plausible factory is:

```js
export function createGenerationLifecycle({
  getCurrentChatId,
  resolveTarget,
  resolveEndedTarget,
  baselineVersionForPayload,
  targetOwnerMatches,
  targetIsNew,
  onGenerationSettled,
  generationTrace,
  enqueueLifecycleWork,
} = {}) {
  return {
    onGenerationStarted,
    onCharacterMessageRendered,
    onGenerationEnded,
    onGenerationStopped,
    onGenerationCancelled,
    onSwipe,
    clear,
    destroy,
  };
}
```

This is a design shape only. `enqueueLifecycleWork` must be an existing narrow
serialization capability or remain in the current owner; do not move the whole
`lifecycleMutationChain` without proving that generic MESSAGE mutation ordering is
unchanged. `onGenerationSettled` must return/hand off to the existing scheduler rather
than call World/Event directly.

If the required callbacks collapse into `eventAnalysisCoordinator`, do not extract.

## Y. Dependency direction / circular dependency audit

Current import direction after Phase F has no observed cycle:

```text
events.js -> runtime/runtime.js -> feature modules -> core/ai
events.js -> event-analysis.js -> runtime feature modules -> core/ai
```

The desired future direction is:

```text
events.js host listeners
  -> generation-lifecycle.js
  -> narrow onGenerationSettled callback
  -> event-analysis.js scheduler/pipeline
runtime/runtime.js -> construct and wire both
```

`generation-lifecycle.js` must not import `events.js`, `runtime/runtime.js`,
`event-analysis.js`, Storage Coordinator, World/Event modules, or Tracking Runtime.
Callbacks must be one-way; no feature-to-root callback that calls back into lifecycle
state synchronously in a cycle.

## Z. `event-analysis.js` responsibilities after extraction

It should retain:

- `runAnalysis`, execution ownership/currentness/cancellation/supersede;
- generic retry and terminal persistence;
- Floor resolution/version policy and general input construction;
- World prerequisite and Event stage sequencing;
- Snapshot, derived state, Tracking bridge and clear coordination;
- auto-analysis interval/retryPaused scheduler unless a later audit proves a separate
  Auto Scheduler feature seam;
- normalized callback from Generation lifecycle and existing public APIs.

It should no longer contain only the pure pending-intent/settle state machine if a
behavior-neutral seam is proven; it may retain mixed scheduler/lifecycle code that
cannot be separated without changing ordering.

## AA. `events.js` responsibilities after extraction

Phase G should leave `events.js` largely unchanged:

- ST event-source subscription/unsubscription;
- host adapter and official transport (Phase H boundary remains frozen);
- Runtime integration shell, notification/facade, init/destroy, clear/projection wiring;
- forwarding normalized lifecycle events to the generation capability/coordinator.

It must not gain Generation state or a second listener path.

## AB. `runtime/runtime.js` impact

Phase F's composition root may construct `createGenerationLifecycle` and pass its
callbacks/capabilities, but it must not own pending intent, settle markers, scheduler
counter, or lifecycle subscriptions. Its role remains create/inject/assemble/return.

The safest wiring is one lifecycle instance per Runtime and one existing
`eventAnalysis.handleLifecycleEvent` integration path. If adding the instance requires
passing the whole coordinator or moving `lifecycleMutationChain`, stop.

## AC. Existing regression tests

| COVERAGE | CURRENT EVIDENCE | STATUS |
|---|---|---|
| CMR → ENDED | `event-analysis-runtime.test.js` reroll/order tests around 3267–3357 | Existing |
| ENDED → CMR | same settle barrier test around 3312 onward | Existing |
| exactly-once / duplicate CMR | settled generation duplicate lifecycle tests | Existing |
| duplicate ENDED / no pending | lifecycle trace and pending assertions | Existing/verify explicitly |
| stale target/version | Floor Version mutation and stale completion tests | Existing |
| reroll/new Swipe | real ST reroll and pending Swipe tests around 3450–3560 | Existing |
| existing Swipe switch | existing Swipe reuse test | Existing |
| Chat switch/clear/destroy | lifecycle/start-new-chat/runtime tests | Existing |
| enabled/disabled | Chat enabled and lifecycle tests | Existing |
| source observation | generation trace assertions around 3319–3375/4493 | Existing |
| no premature World AI | World-first and settle barrier tests | Existing |
| no official owner prerequisite | automatic input readiness tests around 3865–3990 | Existing |
| saveChat resolution != durable | runtime persistence tests around 965 | Existing |
| World → Event order | World-first tests | Existing |

## AD. Missing tests required before extraction

These should be added or explicitly confirmed before implementation; Phase G planning
does not modify them:

- dedicated CMR→ENDED and ENDED→CMR tests asserting exactly one settled callback,
  one World dispatch, and one Event dispatch;
- duplicate `GENERATION_ENDED` with and without pending intent;
- stale old CMR/ENDED after a new intent, including changed message/swipe owner;
- `continue`/non-reroll source variants and missing generation id correlation;
- explicit `MESSAGE_SWIPED` existing selection versus marked new generation;
- lifecycle `clear`, Chat switch, disable and destroy while pending but before settle;
- direct assertion that no generation callback calls persistence or `saveChat`;
- no duplicate lifecycle listener or Generation instance after Runtime re-init;
- scheduler overlap while an active execution is running, asserting execution guard stays
  in `event-analysis.js`;
- diagnostic sequence contract for source observed, superseded, waiting, ended and
  settled.

## AE. Historical regression protections

The extraction must preserve all of the following:

1. CMR alone never starts World AI.
2. ENDED alone never starts World AI.
3. Both orderings settle exactly once.
4. `saveChatConditional`/host save resolution is not durability confirmation.
5. AI input does not require official-owner match before World AI.
6. Host-ahead-of-official is handled by Persistence owner acquisition.
7. A new generation cannot be consumed by an old late event.

## AF. Exact MOVE / KEEP list

### MOVE candidates

- `pendingGeneration` / `pendingSwipeGeneration` state;
- `generationIntentSequence`;
- `completedGeneration` / `completedSwipeGeneration` markers;
- `pendingGenerationMatches`, `pendingGenerationOwnerMatches`,
  `generationMarkerOwnerMatches`, `generationKind`;
- `generationTrace` call sites and Generation-specific transition logic;
- `settleGenerationForTarget` and source/type intent creation;
- Generation-specific stop/cancel clearing and new Swipe intent creation;
- only if a narrow seam exists: Generation-specific portion of lifecycle dispatch.

### KEEP in `event-analysis.js`

- `runAnalysis`, `runAnalysisStageWithRetry`, execution maps/currentness/cancellation;
- `scheduleRenderedCharacter` interval/retryPaused dispatch unless separately split;
- `runScheduledAnalysis`, `schedulerSettings`, `recordSchedulerFailure/Success`;
- `lifecycleMutationChain` if it serializes non-Generation message mutations;
- `lifecycleSnapshot`, `captureLifecycleSnapshot`, mutation invalidation;
- Floor resolver/version policy and all Persistence/terminal/Snapshot/Tracking behavior;
- generic `handleLifecycleEvent` orchestration unless it can delegate without changing
  ordering;
- ST subscription and public facade in `events.js`.

## AG. Implementation risk

**MEDIUM-HIGH.** The settle logic is cohesive and has explicit diagnostics, but the
current handler also owns generic message mutation, lifecycle snapshot invalidation,
auto interval scheduler and analysis dispatch. The most likely regression is moving too
much of `schedulerState` or `lifecycleMutationChain`, which could change clear/mutation/
generation ordering or stale target behavior.

## AH. Recommendation

**SAFE WITH NARROW SEAMS.**

The pending-intent/settle/marker state has a plausible feature boundary, and host event
subscription can remain in `events.js`. However, the full current handler is mixed with
general lifecycle mutation and auto scheduler, so a mechanical whole-function move is
not safe. Proceed only if implementation can inject target resolution, trace sink and
settled dispatch as narrow capabilities while leaving scheduler/execution/persistence
owners in place. Otherwise conclude `NOT SAFE TO EXTRACT YET`.

## AI. FOLLOW-UP ISSUES

- Analysis Boundary Fix: Manual Character → World AI routing.
- Event Input Boundary Fix: shared raw-source contamination.
- Phase H: SillyTavern Adapter extraction.
- Snapshot/Projection decomposition.
- Tracking/UI product semantics.
- General derived-state decomposition.

本 Phase 只记录这些问题，不修改。
