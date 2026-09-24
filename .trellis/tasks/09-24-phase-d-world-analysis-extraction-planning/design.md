# Phase D World Analysis Extraction Design

## A. Current World Analysis call graph

```text
ui/app.js
  ├─ refreshWorldModelState -> runtime.resolveWorldModelAtOrBefore
  ├─ saveWorldModelSection / saveWorldModelCollectionEdit
  │    -> runtime.saveWorldModel -> event-analysis.saveWorldModel
  │    -> injected commitFloorPatch(owner=world, patch={world_model, world_model_meta})
  │    -> UI refreshTrackingAfterWorldModelSave
  └─ analyzeWorldModel(full|patch)
       -> runtime.analyzeCurrentWorldModelFull/Patch
       -> event-analysis.runWorldAnalysisJob
       -> runAnalysisStageWithRetry(domain=world)
       -> analyzer.analyzeWorldModel / analyzeWorldModelPatch
       -> normalize/merge World model
       -> saveWorldModel(automatic=true)
       -> current-Floor readback + buildWorldModelViewModel
       -> WORLD_ANALYSIS_STATUS_CHANGED

runtime/events.js facade
  -> eventAnalysis.resolve/save/analyze World methods

Generation/lifecycle in event-analysis.js
  -> settleGenerationForTarget -> runScheduledAnalysis -> runAnalysis
  -> buildFloorAnalysisInput
  -> resolveFinalWorldModelForAnalysis
       ├─ resolveWorldModelAtOrBefore
       ├─ reuse canonical World view when valid and no update signal
       └─ runWorldAnalysisJob(full|patch) when absent/forced/update-signaled
  -> Event Analysis stage (must remain in event-analysis.js)
```

World-specific symbols currently in `runtime/event-analysis.js` are:
`worldModelUnavailableError`, `worldModelPersistenceError`,
`worldModelUiNotReadyError`, `hasWorldModelUpdateSignal`,
`cloneWorldValue`, `resolveWorldModelAtOrBefore`, `saveWorldModel`,
`resolveWorldModelUiReady`, `runWorldAnalysisJob`,
`analyzeCurrentWorldModelFull`, `analyzeCurrentWorldModelPatch`, and
`resolveFinalWorldModelForAnalysis`. The module also imports AI/domain helpers
used by both World and Event paths, so imports must be split by actual caller,
not copied wholesale.

## B. Full workflow trace

`analyzeCurrentWorldModelFull` checks `isEnabled`, takes a Chat token, resolves
the current Character/assistant Floor through the existing general resolver,
asserts the token, and starts a per-Floor `worldInFlight` job with mode `full`.
The job:

1. checks Chat/Floor currentness and analyzer availability;
2. invokes the shared `runAnalysisStageWithRetry` with `domain: "world"`;
3. calls `analyzer.analyzeWorldModel` with the supplied `analysisInput`, the
   target six-field `floor_version`, `authoritative_floor_version`, and signal;
4. normalizes the complete result through `normalizeStoredWorldModel` and
   constructs World metadata with `source: "world-full-analysis"` plus the
   input summary;
5. applies the existing post-accept execution/Floor guards;
6. calls `saveWorldModel` with `automatic: true` and a per-attempt persistence
   owner;
7. persists exactly `{world_model, world_model_meta}` through the injected
   `commitFloorPatch`, owner `world`, operation type `world-auto-patch`;
8. reads the current target slot, builds the canonical World view model, and
   publishes `WORLD_READBACK_*`, `WORLD_RUNTIME_STATE_UPDATED`, and
   `WORLD_PERSISTENCE_CONFIRMED` diagnostics;
9. publishes running phases (`world_full`, `world_readback`,
   `world_ui_ready`) and terminal success/failure status.

The World job itself does not refresh Tracking or start Event Analysis. In the
automatic path, Event Analysis continues only after
`resolveFinalWorldModelForAnalysis` returns and later performs its existing
canonical Event persistence/readback and Tracking refresh.

## C. Patch workflow trace

`analyzeCurrentWorldModelPatch` has the same enabled/token/current-Floor/job
path, but preflights `resolveWorldModelAtOrBefore(target)` and fails with
`WORLD_MODEL_REQUIRED_FOR_PATCH` if no baseline exists. Inside the retry
attempt it resolves the baseline again, calls `analyzer.analyzeWorldModelPatch`
with the baseline added as `analysisInput.world_model`, validates the sparse
patch in the AI layer, merges it through `mergeWorldModelPatch`, and carries
forward baseline metadata before adding `source: "world-patch-analysis"` and
input summary. The persistence contract is the same `{world_model,
world_model_meta}` owner patch and `world-auto-patch` operation type for the
automatic runtime entry point.

The UI's separate manual `saveWorldModel` path uses the same World owner patch
but `world-manual-patch`. Full/Patch distinction is therefore an AI/workflow
mode, not a different Floor owner or storage shape.

## D. `resolveFinalWorldModelForAnalysis`

This function is called by the automatic `runAnalysis` path immediately after
the causal Event input is built and before the Event stage. It is not called by
the UI's direct manual World buttons. It first resolves the current-or-before
World Model. If an existing model is available, `force` is false, and the
target narrative has no World update signal, it returns the canonical UI-ready
model without an AI request. Otherwise it selects:

- `world_analysis` / Full when no baseline exists;
- `world_patch_analysis` / Patch when a baseline exists and the target is
  forced or contains a World update signal.

It delegates to `runWorldAnalysisJob`, asserts the execution target, clears the
target invalidation marker on success, sets the execution phase back to
`event_analysis`, and returns the canonical model. It maps persistence,
request-abort, stale-owner, and generic failures to the existing World error
contracts. It therefore performs both World resolution and conditional World
generation. Current behavior allows a Manual Character/automatic analysis path
to reach this World resolver/generator; this is a documented follow-up, not a
Phase D behavior change.

It is a good World Runtime API candidate, but its direct writes to shared
execution state (`stage`, `phase`, invalidation) require narrow injected
capabilities or a composition callback. The target module must not import the
Generation lifecycle coordinator.

## E. World retry ownership

`runAnalysisStageWithRetry` is a generic analysis-stage wrapper used by both
World and Event. It owns the configured retry count lookup, retry trace stages,
currentness checks, retryability classification, retry exhaustion mutation, and
attempt sequencing. It must remain in a neutral analysis/runtime owner for this
Phase. World module receives it as a capability or a later shared module can be
introduced only in a separate, explicitly scoped extraction.

World-specific retry policy is currently not separate: World and Event both use
the same normalized retry count and wrapper. Do not move Event retry, alter
`retry_count`, or duplicate the wrapper in `world-analysis.js`.

## F. Persistence contract

| Path | Owner | Patch | Operation type | Target/currentness |
|---|---|---|---|---|
| manual `saveWorldModel` | `world` | `{world_model, world_model_meta}` | `world-manual-patch` | current resolved Floor/active Swipe; coordinator guard and readback |
| automatic Full/Patch stage | `world` | `{world_model, world_model_meta}` | `world-auto-patch` | target six-field Floor Version; per-attempt owner; caller and coordinator guards |

`saveWorldModel` normalizes the model before writing, preserves all unrelated
Floor siblings through the coordinator, and maps prewrite/readback failures to
World-stage errors. `resolveWorldModelAtOrBefore` only returns a candidate when
the current active Swipe, exact stored/recomputed six-field Floor Version,
Floor validity, and non-null World model all pass. `resolveWorldModelUiReady`
adds the canonical `buildWorldModelViewModel` read model and is the current
World readiness gate.

The coordinator and `runtime/floor-persistence.js` compatibility boundary stay
unchanged. `world-analysis.js` may depend on an injected `commitFloorPatch` and
resolver, never on `FloorPersistenceCoordinator` directly.

## G. Readiness and canonical state

Runtime readiness is `resolveWorldModelUiReady`: current-slot readback (or
historical resolution for the non-current read path), exact Floor Version
matching when required, non-null model, then `buildWorldModelViewModel`.
Automatic World stage success requires this readback before publishing success.
UI readiness is separately formatted/managed in `ui/app.js` through the Runtime
resolver and `WORLD_ANALYSIS_STATUS_CHANGED`; UI does not own the persistence
decision. Missing/invalid World model becomes `WORLD_MODEL_UI_NOT_READY` or the
existing unavailable error and prevents the Event stage from being reported as
successful.

## H. Auto pipeline coupling

```text
Generation settled / lifecycle trigger
  -> generation scheduler and execution guards (KEEP in event-analysis.js)
  -> buildFloorAnalysisInput (general analysis input; KEEP)
  -> resolveFinalWorldModelForAnalysis (World Runtime candidate)
  -> Full/Patch World job and canonical readback
  -> EVENT_ANALYSIS_STATUS_CHANGED
  -> Event AI/identity/validation/persistence (KEEP)
  -> Event canonical readback
  -> Snapshot checkpoint and Tracking refresh (KEEP)
```

Phase D must preserve all stage/status ordering. `WORLD_READY` is represented
by the existing World status/readiness phase and the following Event status
transition; no new event or UI contract is proposed.

## I/J. Manual World and Manual Character coupling

Manual World Full/Patch is World-only at the Runtime API level: UI collects the
input and calls one World facade method. Manual World section/collection edits
call `saveWorldModel` and then refresh Tracking from UI, without moving that UI
behavior into the World module.

Manual Character is not a separate World API call, but the automatic/current
Floor analysis path invokes `resolveFinalWorldModelForAnalysis` before Event AI.
This means a Character analysis may reuse or generate World Model under current
behavior. Record as `FOLLOW-UP: Analysis Boundary Fix`; do not change it during
extraction.

## K. Shared helper dependency map

| Helper | Current location | World | Event/Generation | Pure? | Proposed owner |
|---|---|---:|---:|---:|---|
| `resolveFloorAtIndex` / `resolveCurrentBioWeaveFloor` | `runtime/event-analysis.js` | yes | yes | no, host/Floor read | existing general Runtime capability; inject |
| `commitFloorPatch` | `runtime/event-analysis.js` wrapper + persistence coordinator | yes | yes | no, write | existing persistence capability; inject |
| `resolveWorldModelAtOrBefore` | `runtime/event-analysis.js` | yes/UI/Tracking input | Event input + auto resolver | no, Floor reads | `world-analysis.js` candidate, using injected Floor traversal/store reads |
| `resolveWorldModelUiReady` | `runtime/event-analysis.js` | yes/UI gate | auto World | no, read + view build | `world-analysis.js`, using injected canonical view builder |
| `runWorldAnalysisJob` | `runtime/event-analysis.js` | yes | auto orchestration caller | no | `world-analysis.js` |
| `resolveFinalWorldModelForAnalysis` | `runtime/event-analysis.js` | yes | Generation/Event prerequisite | no, mutates execution | `world-analysis.js` with narrow execution-state capabilities |
| `runAnalysisStageWithRetry` | `runtime/event-analysis.js` | yes | Event | no, retry state/trace | KEEP neutral shared owner |
| `targetVersionIsCurrent` / execution guards | `runtime/event-analysis.js` | yes | Event/Generation | no | KEEP existing Runtime guard owner; inject narrow assertions |
| `normalizeStoredWorldModel`, `mergeWorldModelPatch`, `buildWorldModelViewModel` | `ai/analyzer.js` | yes | no | domain/pure transforms | KEEP AI/World domain layer |
| `buildFloorAnalysisInput` | `runtime/event-analysis.js` + `ai/input-builder.js` | indirectly | Event + auto prerequisite | no, broad context | KEEP general/Event input owner |
| `analyzeWorldModel*` | `ai/analyzer.js` | yes | no | API side effect | KEEP AI layer |
| `getWorldAnalysisPrompt` / World messages | `ai/prompts.js` | yes | no | prompt construction | KEEP AI layer |
| `notify` / diagnostics trace | Runtime + `runtime/diagnostics.js` | yes | yes | side effect/DTO | inject existing notification/diagnostics capabilities |

`collectCurrentFloorStates`, Snapshot/StateReducer, `buildCharacterFacts`,
`collectCurrentDerivedState`, `collectActiveBusinessData`, and
`getTrackingRegistry` are general/derived capabilities and must remain where
they are. They may continue calling the World resolver through the existing
Runtime seam.

## L. Proposed `runtime/world-analysis.js` responsibility

The module should own the cohesive World Runtime workflow:

- World error classification and World update-signal interpretation;
- current-or-before World resolution and strict-before resolver facade;
- World Full/Patch job deduplication per target Floor;
- World AI invocation orchestration and result normalization/patch merge;
- World metadata construction;
- automatic/manual World save invocation through an injected persistence
  capability, with existing owner/operation contracts;
- canonical World readback and UI-ready gating;
- World status notifications and result/failure mapping;
- conditional World resolution used as the Event prerequisite.

It must not own AI prompt/schema implementation, generic retry policy, generic
Floor traversal/version policy, Persistence coordinator internals, Event AI,
Generation scheduling, Snapshot/StateReducer, Tracking, or UI rendering.

## M. Proposed minimal API

Recommended single module export:

```js
createWorldAnalysis({
  analyzer,
  enabledResolver,
  resolveCurrentFloor,
  resolveFloorAtIndex,
  resolveStoredWorldFloor,
  commitFloorPatch,
  runStageWithRetry,
  assertChatToken,
  assertExecutionCurrent,
  assertTargetCurrent,
  isExecutionCurrent,
  invalidateExecution,
  clearInvalidatedFloor,
  isFloorInvalidated,
  notify,
  emitTrace,
  buildWorldModelViewModel,
  normalizeStoredWorldModel,
  mergeWorldModelPatch,
  summarizeAnalysisInput,
})
```

The exact implementation should minimize callbacks by grouping only genuinely
existing capabilities, but must not accept callbacks such as
`performWorldAnalysis` or `saveAnything`. The returned methods should be only
the currently required World capabilities:

```js
{
  resolveWorldModelAtOrBefore,
  resolveWorldModelStrictlyBefore,
  saveWorldModel,
  analyzeCurrentWorldModelFull,
  analyzeCurrentWorldModelPatch,
  resolveFinalWorldModelForAnalysis,
}
```

Runtime composition continues to expose these through the unchanged
`runtime/events.js` facade. The module must not import `runtime/events.js`,
`runtime/event-analysis.js`, Event Editing, Tracking Runtime, Generation
Lifecycle, or the concrete persistence coordinator.

## N/O. Old → target map and KEEP list

| Current code | Target |
|---|---|
| `worldModelUnavailableError` | `runtime/world-analysis.js` |
| `worldModelPersistenceError` | `runtime/world-analysis.js` |
| `worldModelUiNotReadyError` | `runtime/world-analysis.js` |
| `hasWorldModelUpdateSignal` and World signal constant | `runtime/world-analysis.js` |
| `cloneWorldValue` | `runtime/world-analysis.js` if only World callers remain |
| `resolveWorldModelAtOrBefore` / strict facade | `runtime/world-analysis.js` |
| `saveWorldModel` | `runtime/world-analysis.js`, calling injected persistence |
| `resolveWorldModelUiReady` | `runtime/world-analysis.js` |
| `runWorldAnalysisJob` | `runtime/world-analysis.js` |
| `analyzeCurrentWorldModelFull/Patch` | `runtime/world-analysis.js` |
| `resolveFinalWorldModelForAnalysis` | `runtime/world-analysis.js`, with execution seam |
| `runAnalysisStageWithRetry` | KEEP in neutral shared runtime owner |
| `buildFloorAnalysisInput` | KEEP general/Event analysis owner |
| `runAnalysis`, Event AI/retry/identity/validation/persistence | KEEP in `event-analysis.js` |
| Generation Settle Barrier, scheduler, pending intents, cancel/supersede | KEEP in `event-analysis.js` |
| `collectCurrentFloorStates`, Snapshot, StateReducer, business DTO | KEEP |
| `commitFloorPatch` implementation and coordinator | KEEP existing persistence boundary |

`resolveWorldModelAtOrBefore` is also consumed by Tracking input and UI. Those
callers should continue through the Runtime/composition capability; they must
not import `world-analysis.js` directly from UI or Tracking.

## P. Circular dependency analysis

Target direction:

```text
runtime/events.js composition / event-analysis.js
  -> runtime/world-analysis.js
     -> ai/analyzer.js + ai/input-builder.js only where World input is needed
     -> existing Floor/persistence capabilities via injection
```

`world-analysis.js` must not import `event-analysis.js` or `events.js`. The main
risk is not a module cycle but a callback cycle: `resolveFinalWorldModelForAnalysis`
must receive narrow execution guards and not a whole Event Analysis coordinator.
Injecting the whole coordinator or asking World to call Event Analysis would be
an invalid design. Planned risk is MEDIUM for cycles, HIGH for seam/ordering.

## Q/R. Regression test requirements and risk

Required coverage includes existing World Model unit/parser/prompt tests,
Runtime Full/Patch/readback/retry tests, World history and active Swipe/Floor
Version tests, stale Chat/cancellation/supersede tests, UI World readiness and
manual collection-edit tests, phase2a World/Event status ordering tests,
analysis retry tests, and the Floor persistence static gate. Add no behavior
changes to tests; use the current tests as the compatibility oracle.

Implementation risk: **HIGH**. The World-specific block is cohesive, but the
job is coupled to shared retry, execution guards, invalidation, Floor resolver,
diagnostics, and the automatic Event prerequisite. Persistence behavior and
status ordering are especially regression-sensitive.

## S/T. Recommendation and follow-ups

**SAFE TO EXTRACT**, provided implementation uses the narrow capability seam
above and moves no shared policy. This is safe as a planned pure extraction,
not low-risk mechanically: stop if the seam would require moving
`runAnalysisStageWithRetry`, Floor traversal/version policy, Generation
scheduler, Event stage, Snapshot/StateReducer, Tracking, or Persistence
implementation.

Follow-ups only:

1. `FOLLOW-UP: Analysis Boundary Fix` — Manual Character/current analysis can
   invoke World AI through `resolveFinalWorldModelForAnalysis`; do not fix in
   Phase D.
2. `FOLLOW-UP: Shared retry owner` — `runAnalysisStageWithRetry` remains shared
   and still makes `event-analysis.js` a mixed owner until a separate plan.
3. `FOLLOW-UP: General derived-state owner` — World resolution is consumed by
   Tracking and business/state paths; keep those consumers behind Runtime seams.
