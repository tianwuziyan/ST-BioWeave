# Phase F Runtime Composition Cleanup Design

以下结论来自当前工作树（包含 Phase A–E），不是来自旧 task 行号。当前文件
规模为：`runtime/events.js` 2540 行、`runtime/event-analysis.js` 3504 行、
`runtime/diagnostics.js` 414 行、`runtime/world-analysis.js` 536 行、
`runtime/character-event-analysis.js` 470 行、`runtime/event-editing.js` 106
行、`runtime/tracking-runtime.js` 41 行；仓库中当前没有 `runtime/runtime.js`。

## A. Current composition graph

```text
ui/app.js / tests
  -> runtime/events.js:createRuntime
     -> createSillyTavernAdapter() [default host + official transport]
     -> createChatBoundary(st)
     -> createStore(st, chat)
     -> createRuntimeDiagnostics({getChatId})
     -> createRuntimeActivity()
     -> createAnalyzer(profile/settings/context resolvers)
     -> createStoryTime / calendar / storyTimeCoordinator
     -> createFloorPersistenceCoordinator({store, enabledResolver, trace,
          official-owner capability from adapter, current-version resolver})
     -> createEventAnalysisCoordinator({st, chat, store, analyzer, story,
          enabledResolver, notify, floorPersistence, input/source hooks})
        -> createRuntimeDiagnostics()       [local diagnostic formatter/buffer]
        -> createTrackingRuntime({plain input collector, token, notify, queue})
        -> createWorldAnalysis({Floor/execution/retry/persistence capabilities})
        -> createCharacterEventAnalysis({Event/persistence/snapshot/tracking seams})
        -> createEventEditing({Floor/mutation/persistence/tracking seams})
        -> event-analysis pipeline state and lifecycle scheduler
     -> createProjectionPersistence({store, floorPersistence, current-version seam})
     -> createProjectionContextCoordinator({projection reads, ST prompt setter})
     -> Clear service / lifecycle binding / facade assembly
  -> Runtime public object returned by runtime/events.js
```

当前最重要的事实是：`runtime/events.js` 创建 host-level diagnostics 和
FloorPersistence；但 `event-analysis.js` 仍然创建自己的 diagnostics、Tracking
Runtime 以及 feature modules。因而当前既不是“所有模块由 events.js 创建”，也不
是“所有模块由一个 composition root 创建”，而是一个跨两层的混合 composition。

| MODULE | CREATED BY | INJECTED DEPENDENCIES | PUBLIC METHODS RETURNED TO | BUSINESS STATE OWNED? |
|---|---|---|---|---|
| SillyTavern adapter | `runtime/events.js` default parameter | global ST context/fetch/API | `createRuntime` facade、tests | host transport/adapter-local trace and compatibility state |
| Chat boundary / Store | `runtime/events.js` | adapter | facade and all runtime modules through callbacks | Chat epoch/token and Floor/store state owner |
| Diagnostics (outer) | `runtime/events.js` | current Chat id | facade trace API, notify/activity path | outer persistence trace visibility |
| Floor persistence | `runtime/events.js` | store, enabled resolver, adapter owner acquisition, trace, current-version resolver | event-analysis/projection via capability | persistence transaction state in storage coordinator |
| Analysis coordinator | `runtime/events.js` invokes factory | ST/chat/store/analyzer/story/input hooks/persistence/notify | facade plus lifecycle callback | execution maps, scheduler, invalidation, lifecycle snapshot, retry/terminal state |
| World/Event/Edit/Tracking features | `event-analysis.js` | narrow callbacks closed over coordinator state | returned through coordinator then facade | feature-local queues/in-flight maps only where currently present |
| Projection persistence/context | `runtime/events.js` | store, persistence, current Floor resolver, ST extension prompt | facade/UI | projection context/persistence state |
| Clear service | `runtime/events.js` | store/adapter and lifecycle callbacks | facade data-lifecycle methods | clear operation state in current owner |

因此 composition cleanup 的目标应是“一个 assembly boundary”，不是把 pipeline
state 变成 composition state。

## B. `runtime/events.js` responsibility map

| Block | Current responsibility | Classification | Phase F disposition |
|---|---|---|---|
| `createSillyTavernAdapter` and helpers near lines 48–1620 | Context lookup, request headers, official Chat/floor reads, owner inspection/acquisition/bootstrap, host memory sync, official save/readback, source owner compatibility | A ST adapter / E persistence transport | KEEP in this phase; identify as future Adapter boundary only |
| `createRuntime` setup around lines 1627–1839 | Chat/store/activity/diagnostics/analyzer/story/persistence/projection/coordinator construction | B Runtime composition | Candidate for narrow composition root |
| `notify`, trace sink, lifecycle-settled forwarding | Diagnostics observation, activity forwarding, subscribers, runtime event broadcast | C/D/F mixed integration | Keep broadcast in facade; inject only narrow diagnostic/activity sinks if later proven equivalent |
| `isBioWeaveEnabled`, `assertBioWeaveEnabled`, `setBioWeaveEnabled` | enabled read/write and settings persistence | G Settings boundary plus facade | KEEP behavior; composition may pass enabled/settings capability |
| owner capture and Chat transition helpers | source owner/lifecycle clear detection | D lifecycle integration | KEEP; not composition-only |
| `runClear` and clear wrappers | Clear service invocation, invalidation/recovery, notifications | H clear integration | KEEP orchestration owner; root may only wire hooks |
| `handleLifecycleEvent`, `bindLifecycleEvents`, `init` | ST event binding, lifecycle serialization, projection/story/analysis ordering | D Generation/lifecycle + integration | KEEP; do not move to root |
| return object at lines 2480+ | public Runtime facade | C public facade | Candidate for assembly helper, but signatures/identity must remain in `events.js` until verified |
| `destroy` | projection/story/analysis/adapter/activity/chat cleanup order | C integration teardown | Root may call a teardown list only if order is explicitly preserved |

`runtime/events.js` is therefore not merely a facade: it is simultaneously ST host
adapter, transport, top-level composition, lifecycle integration, clear integration,
and public API assembly. Phase F should not pretend those are already separable.

## C. `runtime/event-analysis.js` responsibility map

当前 `createEventAnalysisCoordinator`（line 408）仍承担以下几类职责：

### Pipeline / execution owner（必须 KEEP）

- `inFlight`, `lastTerminal`, `attemptSequence`, `executionIsCurrent`,
  `assertExecutionCurrent`, `invalidateExecution`、late-result guard。
- `runAnalysisStageWithRetry` 以及 retry configuration、retryable classification、
  Floor version convergence。
- `runAnalysis`（约 line 2746）整体 pipeline：target/input、World prerequisite、
  Event attempt、terminal failure/cancellation、final status。
- `schedulerState`、pending generation/swipe intent、settle barrier、generation
  markers、lifecycle mutation chain 与 `handleLifecycleEvent`。
- `persistTerminalAttempt` 和 terminal/analysis dual-owner supersede。

### General runtime/data owner（本 Phase 不拆）

- `resolveMessage`、`resolveFloorAtIndex`、`resolveCurrentBioWeaveFloor`、
  active Swipe/Floor Version/invalidated-Floor policy。
- `collectCurrentFloorStates`、`collectCurrentDerivedState`、state reducer、
  snapshot candidate/restore/create、business DTO、Story Time/character facts。
- `buildFloorAnalysisInput` 与 shared analysis source/context collection。
- `invalidateMutation`、clear invalidation barriers、Chat boundary handling。

### Current composition sites（可作为后续 seam 目标，但不是 orchestration）

- `createRuntimeDiagnostics()` line 437。
- `createTrackingRuntime()` line 438。
- `createWorldAnalysis()` line 1785。
- `createCharacterEventAnalysis()` line 1832。
- `createEventEditing()` line 1857。
- fallback `createFloorPersistenceCoordinator()` line 452。

这些 construction site 目前位于 coordinator 内，是 Phase F 要解决的 wiring 问题；
但不能把它们连同其闭包内的 pipeline state 直接搬到 `runtime/runtime.js`。

## D. Feature construction-site map

| FEATURE | CURRENT CONSTRUCTION SITE | INJECTED CAPABILITIES | WHY THEY LIVE THERE | COULD CONSTRUCTION MOVE TO COMPOSITION ROOT? |
|---|---|---|---|---|
| Diagnostics (outer) | `runtime/events.js:1642` | Chat id getter | facade/host trace needs current Chat | Yes, already top-level |
| Diagnostics (analysis-local) | `runtime/event-analysis.js:437` | none at construction | formatter/analysis diagnostic helpers are closed over by coordinator | Only with a narrow shared diagnostic capability; do not create a second buffer |
| Persistence coordinator | `runtime/events.js:1760` | store, enabled, trace, authoritative owner acquisition, current version resolver | requires host adapter and store | Yes; already is top-level. Do not move implementation |
| Persistence fallback | `runtime/event-analysis.js:452` | store, enabled, notify | direct coordinator construction fallback for standalone use | Remove only after an explicit injected-capability contract; do not duplicate implementations |
| Tracking Runtime | `runtime/event-analysis.js:438` | `collectTrackingInputs`, enabled, message presence, Chat token/assert, notify, refresh queue | collector and queue are currently closed over coordinator state | Not safely without a narrow input/queue seam; no broad coordinator injection |
| World Analysis | `runtime/event-analysis.js:1785` | Floor resolver, retry/currentness/execution, persistence, trace/status | workflow needs private execution/Floor capabilities | Possible only with explicit capability object; root must not own those states |
| Character/Event Analysis | `runtime/event-analysis.js:1832` | input/readback/identity/persistence/snapshot/tracking/currentness seams | attempt body needs general runtime capabilities | Possible with existing narrow factory, but caller must remain pipeline owner |
| Event Editing | `runtime/event-analysis.js:1857` | Floor lookup, mutation invalidation, event persistence, token, Tracking | edit workflow needs general mutation capabilities | Possible with existing narrow factory; public API must remain facade |
| Projection persistence/context | `runtime/events.js:1818/1832` | store, Floor persistence, version resolver, ST extension prompt | host/runtime projection integration | Keep in events.js in this phase |

## E. Capability ownership map

| CAPABILITY | CURRENT OWNER | USED BY | STATEFUL? | BUSINESS-SPECIFIC? | SAFE TO INJECT FROM COMPOSITION ROOT? |
|---|---|---|---|---|---|
| `resolveFloorAtIndex` / `resolveCurrentBioWeaveFloor` | `event-analysis.js` | World, Event, Editing, projection wiring | reads invalidation/store/Chat | Floor policy | Yes, as narrow function; root does not implement it |
| `commitFloorPatch` | `event-analysis.js` bridge to injected storage coordinator | World, Event, Editing | transaction/currentness context | persistence dispatch | Yes, as capability; owner/patch remain feature-specific |
| `runAnalysisStageWithRetry` | `event-analysis.js` | World and Event pipeline | execution/retry state | analysis pipeline | Yes only as injected function; root must not copy or own loop |
| `assertExecutionCurrent` / `executionIsCurrent` | `event-analysis.js` | World/Event/terminal | in-flight execution state | execution | No broad state move; narrow callbacks only |
| `targetVersionIsCurrent` | `event-analysis.js` | World/Event/persistence guards | reads current Floor/Chat | Floor policy | Yes as callback, not as root policy |
| `invalidateMutation` | `event-analysis.js` | Event Editing, lifecycle/clear | invalidated map + aborts | lifecycle/mutation | No direct root ownership; inject narrow mutation capability |
| `refreshTrackingRegistry` | `trackingRuntime` created by event-analysis | Event/Event Editing/lifecycle/init/clear | refresh chain | Tracking runtime | Yes only as function; Tracking implementation stays feature owner |
| Snapshot checkpoint (`maybeCreateSnapshot`) | `event-analysis.js` general derived-state owner | Event success/business reads | snapshot state/store reads | general derived state | Yes only as callback; no machinery in root |
| `notify` | `events.js` | analysis, adapter traces, UI subscribers, activity | subscriber set/activity | mixed integration | Do not move wholesale; split only by proven sink contract |
| diagnostic sink / `recordPersistenceTrace` | outer events + diagnostics | adapter/coordinator/UI debug | trace buffers | diagnostics | Yes as sink, but retain runtime event broadcast semantics |
| Chat token create/assert | `chat.js` boundary used by events/event-analysis | all feature modules | epoch/token state | host/runtime | Yes via narrow boundary methods |
| settings/profile access | `store.profileStore` + `events.js` resolver | analyzer/runtime/UI | persisted settings | settings/host | Inject resolvers; no schema change |
| enabled access | `events.js:isBioWeaveEnabled` | persistence/analysis/projection/UI | reads current Chat settings | settings | Yes as `enabledResolver`; writer stays facade/settings boundary |

## F. Composition versus orchestration boundary

Composition is only:

```text
adapter -> chat/store -> settings/analyzer/story/persistence capabilities
        -> feature factories with narrow capabilities
        -> projection/clear/lifecycle integration
        -> compatibility facade
```

Orchestration remains:

```text
Generation settled -> World prerequisite -> Event stage -> terminal handling
Event success -> canonical readback -> Snapshot checkpoint -> Tracking refresh
mutation -> invalidation/cancellation -> persistence -> derived refresh
clear -> invalidate barriers -> Clear Service -> rebuild/notification
```

The proposed root must not call `runAnalysis`, decide retry, select persistence
owners, construct analysis patches, schedule generations, or rebuild Tracking.

## G. Proposed `runtime/runtime.js` responsibility

`runtime/runtime.js` is worthwhile only as a narrow assembly module, not as a new
coordinator. It could eventually:

1. accept the same host/analyzer/settings override inputs currently accepted by
   `createRuntime`;
2. create `chat`, `store`, one outer diagnostics/activity sink, one Floor persistence
   capability and existing projection coordinators;
3. supply a narrow capability bundle to the existing pipeline coordinator, which
   remains the owner of execution/lifecycle/derived state;
4. receive the pipeline's feature API and assemble the existing public facade;
5. expose teardown wiring while preserving current destroy order.

It must not own World workflow, Event workflow, generation scheduler, Floor
persistence algorithm, Snapshot algorithm, retry loop, ST transport, or business
mutable state.

Current code does not yet support moving every feature construction site to the root
without a seam: World/Event/Editing require closures over private coordinator
functions, and Tracking requires the coordinator's collector and refresh chain. The
safe design is therefore a two-level boundary: root owns infrastructure and facade
assembly; `event-analysis.js` remains pipeline owner and either constructs features
through a narrow internal capability factory or receives only feature factories that
do not capture the root. Do not expose the whole coordinator to modules.

## H. Proposed minimal API

Recommendation for the future composition module:

```js
export function createRuntimeComposition(options = {}) {
  // returns the existing Runtime facade plus internal teardown capability
}
```

However, because tests and callers currently import `createRuntime` and
`createSillyTavernAdapter` from `runtime/events.js`, the compatibility entry should
remain:

```js
export function createRuntime(options = {}) {
  return createRuntimeComposition(options);
}
```

This is a proposed shape, not an implementation decision to apply in this phase.
No `services`, `container`, generic `resolve()`, or public feature registry should be
added. If an internal factory is needed, keep it private and return only the current
feature methods/capabilities.

## I. Public Runtime facade plan

The facade currently is assembled in `runtime/events.js` and is consumed by
`ui/app.js`, runtime tests, lifecycle tests, and UI tests. The compatibility surface
includes, among others:

- lifecycle: `init`, `destroy`, `subscribe`, activity methods;
- analysis: `analyzeCurrentFloor`, `analyzeFloor`, `refreshCurrentFloorAnalysis`,
  `requestAbortCurrentFloorAnalysis`, status/scheduler/input reads;
- World: query, save, Full/Patch analysis;
- Event/identity: current events, identity reads/alias updates, `updateEvent`,
  `deleteEvent`;
- Tracking/business: `getTrackingRegistry`, `refreshTrackingRegistry`,
  `collectActiveBusinessData`, biological state;
- diagnostics: `getPersistenceTrace`, `recordPersistenceTrace`, Story Time debug;
- clear/projection/settings/Floor reads.

Future root assembly may build this object, but `ui/app.js` must continue receiving
the same object and method signatures. `runtime/events.js` should retain the named
host entry exports and the lifecycle binding compatibility layer until tests prove a
smaller boundary without duplicate listeners.

## J. SillyTavern adapter boundary

The adapter begins at `createSillyTavernAdapter` (line 177) and includes the request
transport and official Floor owner methods. The following remain outside Phase F:

`readOfficialFloorSlot`, `inspectOfficialFloorOwner`, `bootstrapOfficialFloorOwner`,
`acquireAuthoritativeFloorOwner`, `syncHostMemoryFloorSlot`, `saveOfficialFloorSlot`,
`saveOfficialChatOwner`, request/header/context helpers, and persistence trace sink
compatibility.

They may be documented as an adapter/persistence-transport boundary, but cannot be
moved into `runtime/runtime.js` or rewritten as part of composition cleanup.

## K. Persistence boundary

`storage/floor-persistence-coordinator.js` remains the sole normal Floor persistence
implementation. `runtime/floor-persistence.js` is only a seven-line compatibility
re-export. `runtime/events.js` creates the coordinator and injects it into
`event-analysis.js`; `storage/projection.js` can also construct a fallback when no
coordinator is supplied.

Phase F should not change owner acquisition, authoritative merge/readback, sibling
preservation, Floor Version, Swipe ownership, transaction serialization, official save,
or static gate behavior. The root may pass the existing `floorPersistence` object,
never the concrete implementation's internals.

## L. Generation lifecycle boundary

Generation lifecycle remains in `event-analysis.js`: `schedulerState`, pending
generation/swipe intents, settle barrier, `generationTrace`, generation markers,
`handleLifecycleEvent`, `lifecycleMutationChain`, and `scheduleRenderedCharacter`.
`runtime/events.js` owns host event subscription and calls the coordinator's lifecycle
entry. Composition may wire that callback, but must not own ordering, CMR/ENDED
correlation, supersede, or scheduler state. Phase G remains the appropriate future
extraction.

## M. General derived-state boundary

Keep in `event-analysis.js` / current general owner:

- `collectCurrentFloorStates`, `collectCurrentDerivedState`;
- Floor traversal and valid-state filtering;
- `buildCharacterFacts`, `buildBusinessData`, `collectActiveBusinessData`;
- `reduceState`, snapshot candidates/restore/create/validation;
- projection inputs and Story Time DTO bridge.

Tracking Runtime consumes a plain Tracking input DTO; it does not become a general
derived-state or StateReducer runtime. Composition root must not receive these
algorithms as a state bag.

## N. Mutable state ownership map

| Mutable state | Current owner | Correct feature owner? | Move in Phase F? |
|---|---|---|---|
| `inFlight`, `lastTerminal`, `attemptSequence` | `event-analysis.js` | execution/pipeline | No |
| `registryRefreshChain` | `event-analysis.js` closure around Tracking Runtime | Tracking refresh serialization, currently coupled to coordinator | No; expose only refresh capability |
| `lifecycleMutationChain` | `event-analysis.js` | lifecycle ordering | No |
| pending generation/swipe intent and scheduler sets | `event-analysis.js` | generation lifecycle | No; Phase G |
| `invalidatedFloors` | `event-analysis.js` | Floor/mutation execution guard | No |
| diagnostics trace buffers | `runtime/diagnostics.js`, plus outer events wiring | diagnostics | No; avoid duplicate buffers |
| World `worldInFlight` | `world-analysis.js` | World feature | No; already correctly local |
| Event editing state | `event-editing.js` | Event Editing | No |
| subscriptions/activity | `events.js` / activity module | host/runtime facade | No; root may only wire teardown |
| source cache/worldbook cache | `event-analysis.js` | analysis input/lifecycle cache | No |
| projection context | `projection-context.js` created by events | projection integration | No |
| Chat epoch/token | `chat.js` | host/runtime boundary | No; inject narrow access |

Composition root must not become an owner merely because it can reach these values.

## O. Destroy/clear wiring

Current `runtime/events.js:destroy` calls, in order, projection context destroy,
Story Time coordinator destroy, `eventAnalysis.destroy`, unbinds host listeners,
clears subscriptions/activity, then destroys Chat boundary. The coordinator destroy
marks execution entries cancelled/aborted, clears in-flight state, clears World jobs,
resets scheduler state, and removes its Chat listener.

Clear uses `runClear` plus the Clear Service. `eventAnalysis.invalidateForClear` first
invalidates Chat/executions/Floor/Worldbook, waits for lifecycle and Tracking refresh
barriers, then `completeClear` optionally primes snapshot/lifecycle and refreshes
Tracking. This is orchestration and must stay with current owners. A future root may
own only an ordered list of `destroy`/`invalidate`/`complete` calls, with tests for
exact order and no duplicate cleanup.

## P. Settings/enabled wiring

`events.js:isBioWeaveEnabled` reads the current Chat settings via `store.getChat`;
`assertBioWeaveEnabled` creates the existing disabled error; `setBioWeaveEnabled`
persists the Chat setting and pauses/clears projection as currently implemented.
Profile/API request settings are resolved by `resolveEventAnalysisProfile` and the
analyzer callbacks against `store.profileStore`.

The future root may pass `enabledResolver`, analyzer profile/request resolvers, and
read-only settings callbacks. It must not change settings schema/defaults or let
feature modules write settings directly.

## Q. Import/circular dependency audit

Current static import direction is acyclic for the Phase A–E modules:

```text
events.js -> event-analysis.js -> world-analysis.js -> ai/analyzer.js
                         -> character-event-analysis.js -> ai/core
                         -> event-editing.js -> core/events, core/identity
                         -> tracking-runtime.js -> core/tracking
events.js -> storage/floor-persistence-coordinator.js
event-analysis.js -> runtime/floor-persistence.js -> storage coordinator
```

`diagnostics.js` has no reverse import into runtime modules. `world-analysis.js`,
`character-event-analysis.js`, `event-editing.js`, and `tracking-runtime.js` do not
import `events.js` or `event-analysis.js`. Current cycles: none observed in the ES
module imports.

Potential cycle after extraction: `events.js -> runtime.js -> event-analysis.js ->
runtime.js`, or a feature module importing `runtime.js` for capabilities. Safe
direction is one-way: `events.js` compatibility entry -> `runtime.js` composition ->
pipeline/feature modules -> AI/core/storage capability; capabilities enter via
arguments, never reverse imports. `runtime.js` must not be imported by feature
modules.

## R. Static gate impact

`tests/floor-persistence-static-gate.test.js` currently scans `runtime/events.js` for
forbidden direct writer patterns and verifies the concrete coordinator remains in the
allowed location. Phase F must not modify the gate. If a future facade move causes a
location assertion, only a minimal test update could be considered after proving the
assertion is location-only and retaining all forbidden-write checks; no such change is
needed for this planning phase.

## S. Target `event-analysis.js` responsibility

After a successful composition cleanup, `event-analysis.js` should remain the
pipeline/execution and general-runtime coordinator, not a feature factory mega-file:

- execution registry/currentness/cancellation/supersede;
- generic retry and terminal persistence;
- `runAnalysis` plus World prerequisite/Event-stage transition;
- Generation lifecycle/scheduler until Phase G;
- general Floor resolution, input construction and derived-state/snapshot bridges;
- clear invalidation barriers and lifecycle callbacks;
- a narrow internal capability seam for feature modules.

It should no longer contain concrete World workflow, Event attempt workflow, Event
Editing workflow, or Tracking implementation. It may still be the caller/orchestrator
that receives their narrow methods.

## T. Target `events.js` responsibility

The long-term target is a compatibility/integration entry containing:

- SillyTavern host adapter and official transport (until Adapter Phase);
- Chat/store/activity construction boundary if not moved to root;
- lifecycle event binding and host-facing init/destroy integration;
- Clear/projection/story integration wiring;
- compatibility `createRuntime` / `createSillyTavernAdapter` exports and facade.

It should not contain World/Event/Tracking/Persistence algorithms. Phase F should not
force this target if moving lifecycle/transport would change behavior.

## U. Regression tests required for implementation

At minimum:

- Runtime facade compatibility for World, Character/Event, Event Editing, Tracking,
  diagnostics, clear, projection, settings/enabled and Floor reads;
- `init`, `destroy`, `subscribe`, activity forwarding and no duplicate listeners;
- lifecycle event ordering and exactly one Generation consumer;
- feature construction count: one Diagnostics buffer, one persistence capability,
  one World/Event/Editing/Tracking instance per Runtime;
- no duplicate Tracking refresh queue or generation scheduler;
- Chat token/currentness and stale result behavior;
- World/Event retry, canonical readback, terminal and Snapshot/Tracking ordering;
- persistence coordinator tests, official transport tests and static gate;
- import graph/circular dependency check and JS syntax checks.

No test expectation should be changed merely to accept a new location.

## V. Implementation risk

**MEDIUM-HIGH.** The feature modules already have mostly narrow factory seams, and
there are no current import cycles. The risk is not the new file itself; it is moving
construction without accidentally duplicating diagnostics/persistence/Tracking queues,
capturing stale closures, changing destroy order, or exposing private execution state.
`notify` is also mixed: subscriber broadcast, activity forwarding and diagnostic
observation happen together, so it cannot be relocated wholesale.

## W. Recommendation

**SAFE WITH NARROW SEAMS.**

It is safe to plan a composition boundary because the existing feature factories and
storage coordinator already accept capabilities, and current imports are acyclic. It
is not safe to mechanically move all construction from `event-analysis.js` into a new
root in one step: the coordinator still owns the private Floor/execution/input/
Tracking-queue closures needed to build the feature modules. Implementation should
first define the smallest internal capability seam, keep pipeline state in
`event-analysis.js`, and move only construction/facade wiring that can be proven
behavior-neutral. If that seam would require a whole-coordinator callback, choose
`NOT SAFE TO EXTRACT YET` and stop.

## X. FOLLOW-UP ISSUES

- Analysis Boundary Fix: Manual Character currently can trigger World resolution/AI.
- Event Input Boundary Fix: raw Character Card/Persona/Worldbook/external fields
  remain in the current shared input path.
- Phase G: Generation lifecycle/scheduler extraction.
- Later SillyTavern Adapter Phase: host transport and official Floor owner methods.
- General derived-state decomposition and Snapshot/Projection consistency.
- Tracking/UI product semantics and character registry versus Tracking registry
  boundary.

这些问题本 Phase 只记录，不修改。
