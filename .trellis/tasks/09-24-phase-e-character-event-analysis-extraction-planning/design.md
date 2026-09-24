# Phase E Character / Event Analysis Extraction Design

以下结论来自当前工作树，不是基于旧 task 行号。核心代码位置：
`runtime/event-analysis.js` 的 `createEventAnalysisCoordinator`、
`buildFloorAnalysisInput`、`runAnalysisStageWithRetry`、`runAnalysis`、
`verifyCharacterCanonicalReady`、`persistTerminalAttempt`；
`ai/analyzer.js` 的 `analyzeFloor`/`parseEventAnalysisResponse`；
`core/identity.js` 的 `resolveEventAnalysisIdentities`；
`core/events.js` 的 `normalizeEvent`/`validateEventCollection`；
`runtime/events.js` 的 Runtime facade。

## A. Current Character/Event call graph

```text
ui/app.js / scheduler / generation-settled lifecycle
  -> runtime/events.js facade.analyzeCurrentFloor / analyzeFloor
  -> event-analysis.analyzeFloor
     -> resolve target Character Floor + active Swipe + six-field version
     -> inFlight single-flight + execution token/currentness guards
     -> buildFloorAnalysisInput
        -> current valid previous Floor / character_registry
        -> current causal World Model
        -> recent story / story time / shared input collector
        -> Event input normalizer
     -> resolveFinalWorldModelForAnalysis
        -> World reuse or World Full/Patch (existing Phase D owner)
     -> build Event input again with final World Model
     -> runAnalysisStageWithRetry(domain=event)
        -> analyzer.analyzeFloor
           -> AI transport + buildEventAnalysisMessages
           -> parseEventAnalysisResponse (strict JSON object)
           -> Event parser diagnostics
        -> resolveEventAnalysisIdentities
           -> canonical participant IDs / aliases / new registry entries
        -> Runtime Event normalization
           -> deterministic event_id + Floor source
           -> materializeStateFact
        -> validateEventCollection(strictCanonicalParticipants=true)
        -> Event canonical expectation
     -> complete callback
        -> commitAnalysis(status=success)
        -> dependency/currentness guard
        -> commitFloorPatch(owner=event,
             {analysis, events, character_registry},
             operation_type=event-analysis-patch)
        -> authoritative slot readback
        -> canonical Event/character readiness verification
        -> maybeCreateSnapshot (projection owner, existing shared machinery)
        -> refreshTrackingRegistry(execution.reason)
        -> canonical readiness verification + success
     -> runAnalysis catch/finally
        -> terminal cancel/failure attempt (owner=terminal)
        -> analysis-failed Tracking refresh when current and eligible
        -> execution finalization/status notifications
```

Character is not a separate AI invocation in the current implementation. The
single Event analyzer returns Event records; identity resolution constructs the
cumulative `character_registry` in the same attempt, and Tracking derives
`tracking_subjects`, `tracking_candidates`, and `character_profiles` later.

## B. Event AI workflow trace

1. `resolveFloor`/`resolveCurrentBioWeaveFloor` determines the current
   Character/assistant Floor and active Swipe through the existing Runtime
   resolver. The target carries the complete six-field `Floor Version`.
2. `buildFloorAnalysisInput` reads a valid older Floor for `existing_bioweave`
   and the previous canonical `character_registry`; it collects only the causal
   prefix and resolves the strictly-before World Model.
3. It composes recent story, story time, character context, shared host-derived
   fields, external memory and Event-specific fields via
   `buildEventAnalysisInput`.
4. `resolveFinalWorldModelForAnalysis` is invoked before the Event stage. This
   is the current coupling and is a follow-up boundary issue, not Phase E work.
5. The input is rebuilt with the final World Model, then the shared retry wrapper
   invokes `analyzer.analyzeFloor` with target and authoritative Floor Version,
   signal, and the existing Event trace sink.
6. `ai/analyzer.js` performs profile routing, World Model preflight, prompt
   construction, transport, strict Event response parsing, and parser trace
   publication. `<think>` plus JSON is rejected by the Event parser; the parser
   does not use the World parser's fenced/substring recovery.
7. Runtime resolves participant identities against the previous Floor registry,
   persists accepted aliases in the returned registry, assigns deterministic
   `event_id` and current Floor `source`, materializes state facts, emits
   expectations, validates the complete Event collection, deduplicates and
   normalizes the final events.
8. Completion builds the successful `analysis`, writes the Event-owned patch,
   validates authoritative readback and canonical UI readiness, then invokes
   Snapshot and Tracking capabilities in the existing order.

`buildFloorAnalysisInput`, Floor traversal/version computation, World resolution,
generic retry, execution registry, and persistence dispatch are not Event module
implementation and should not be copied into the target module.

## C. Parser / normalization ownership

| Layer | Current owner | Responsibility | Phase E disposition |
|---|---|---|---|
| AI transport/parser | `ai/analyzer.js` | profile routing, prompt messages, response extraction, strict JSON/schema normalization, parser diagnostics | KEEP; Event module calls `analyzeFloor` |
| Event domain | `core/events.js` | `normalizeEvent`, `validateEventCollection`, dedupe/sort and Event contracts | KEEP; Event module calls these capabilities |
| Identity domain | `core/identity.js` | canonical IDs, alias resolution, registry merge, unresolved participant errors | KEEP; Event module orchestrates the call |
| Runtime orchestration | `runtime/event-analysis.js` today | target/input/World prerequisite, attempt body, Floor save/readback, post-success bridges | candidate for `character-event-analysis.js`, except shared outer coordinator |
| Diagnostics | `runtime/diagnostics.js` | diagnostic DTO/sanitization/trace buffering | KEEP; no Phase E change |

## D. Empty Event semantics

`events: []` is valid when the parser returns the required Event envelope, identity
resolution succeeds, collection validation succeeds, the Event-owned patch is
confirmed, and canonical readback remains empty for the current Floor. The code
emits `EVENT_EMPTY_RESULT_CLASSIFIED` at normalization and again during canonical
readback; the final reason is `valid_empty_event_result` and the UI can reach
ready/success with no active Events.

It is not a retryable failure merely because it is empty. It becomes failure or
retry when parsing/schema/domain validation fails, persistence/readback loses the
expected state, or canonical verification disagrees with the non-empty expected
result. Empty canonical readback is unexpected when a non-empty result was
expected. These classifications and UI status contracts are frozen.

## E. Identity / `character_registry` workflow

```text
raw Event participants / pregnancy references
  -> core/identity.resolveEventAnalysisIdentities
  -> resolveRawParticipantIdentity against normalized previous registry
  -> reuse canonical ID, persist approved alias, or allocate char_######
  -> canonical participant references + cumulative registry
  -> Event runtime materialization/validation
  -> same owner patch: events + character_registry
  -> authoritative registry readback / Tracking rebuild
```

The resolver is where aliases and new IDs are selected; Runtime then enforces
canonical participant collection validity and persists the returned registry.
Unknown or unresolved participants abort the batch before persistence. The
persisted registry count is not the Tracking subject count: the former is the
Floor-owned identity snapshot, while Tracking is a runtime-derived projection
from valid Events and World context. UI characters enumerate `tracking_subjects`,
not all registry entities.

## F. Event persistence contract

Current successful Event attempt:

```text
owner          = "event"
patch          = { analysis, events, character_registry }
operation_type = "event-analysis-patch"
target         = current target Floor + active Swipe + complete Floor Version
guard          = assertExecutionTargetCurrent before/inside commit
readback       = coordinator confirmation plus exact target slot checks
siblings       = preserved by existing Coordinator
```

Terminal cancel/failure remains a separate `owner="terminal"` patch with
`operation_type="terminal-analysis-patch"`; it is outside the successful Event
owner patch and must retain the existing attempt/supersede logic. No Coordinator
implementation moves or changes.

## G. Terminal analysis dual-owner interaction

`analysis` is written by both the Event success path and terminal failure/cancel
path. `commitAnalysis` carries attempt/version metadata. Existing terminal
supersede behavior in the persistence path prevents an older/equal terminal
attempt from overwriting a successful Event analysis. Phase E must preserve:

- Event success writes `analysis.status=success` in the Event-owned patch.
- Terminal failure/cancel writes only the terminal analysis patch when its
  currentness/eligibility checks permit it.
- A late terminal result cannot replace a newer successful Event result.
- Rollback and stale-result guards remain in the shared coordinator/execution
  owner.

## H. Event retry ownership

`runAnalysisStageWithRetry` is shared by World and Event and remains in
`runtime/event-analysis.js` (or a later explicitly shared owner). It owns retry
count normalization, attempt numbering, retryable classification, stale/current
guards and retry trace stages. Phase E must not copy it.

The Event-specific `invoke`/`complete` body is the extraction candidate. Event
retry repeats Event-specific AI → identity → normalize → validate → persist →
readback/ready as it does today, without rerunning the already-ready World stage.

## I. Event-specific attempt body breakdown

| Step | Current code | Proposed ownership |
|---|---|---|
| Input/target | `buildFloorAnalysisInput`, `resolveFinalWorldModelForAnalysis` | shared pipeline/original owner; pass final plain input into Event module |
| AI invocation | `runAnalysis` invoke + `analyzer.analyzeFloor` | Character/Event module orchestration; AI implementation stays `ai/analyzer.js` |
| Parser | `analyzer.analyzeFloor` | `ai/analyzer.js` |
| Identity | `resolveEventAnalysisIdentities` | core domain; Character/Event module invokes it |
| Event IDs/source/state facts | `deterministicEventId`, `materializeStateFact` | Event-specific Runtime seam; review whether these helpers move together |
| Validation | `validateEventCollection` and `domainValidationError` | validator stays core; error contract is shared and must remain stable |
| Canonical expectation | expected character/event IDs and trace | Character/Event orchestration |
| Successful patch | `commitAnalysis` + `commitFloorPatch` | Event module may construct the explicit Event-owned patch and call injected commit capability |
| Readback/readiness | `verifyCharacterCanonicalReady` and exact slot audit | Event-specific canonical verification, but Floor traversal/business DTO capabilities remain injected/shared |
| Post-success | `maybeCreateSnapshot`, `refreshTrackingRegistry` | Event module owns call timing; implementations remain shared Snapshot/Tracking owners |
| Terminal failure | `persistTerminalAttempt`, rollback, finalization | keep outer `runAnalysis` until a separate terminal/execution seam is proven |

## J. Snapshot boundary

The Event success workflow currently decides when to enter
`snapshot_checkpoint` and calls `maybeCreateSnapshot`. The Snapshot machinery
(`createSnapshot`, validation, restore, candidate traversal, StateReducer) is
general derived-state infrastructure and must remain in `runtime/event-analysis.js`
or a later general owner. A future extraction may inject a narrow
`maybeCreateSnapshot(target, token)` capability; it must not move Snapshot logic
or change the fact that Snapshot errors are traced without turning a successful
Event persistence into an Event failure.

## K. Tracking boundary

After canonical Event persistence/readback, success calls
`refreshTrackingRegistry(execution.reason)`. Failure terminal handling may call
`refreshTrackingRegistry("analysis-failed")` when the currentness/eligibility
conditions permit it. Character/Event owns these call sites and ordering only;
`runtime/tracking-runtime.js` owns the implementation. The Event module must not
import or instantiate Tracking Runtime.

## L. Auto pipeline coupling

```text
Generation Settle Barrier / scheduler (event-analysis.js)
  -> prerequisite input
  -> resolveFinalWorldModelForAnalysis
     -> World full/patch/reuse (world-analysis.js)
  -> Event stage (candidate Phase E module)
  -> Event owner persistence/readback
  -> Snapshot checkpoint
  -> Tracking refresh
  -> execution finalization and UI status
```

World returns the canonical/reusable World Model. The current Event stage also
rebuilds input and receives the World result through `analysisInput.world_model`.
`execution.phase` and World-to-Event transitions remain execution/lifecycle
capabilities, not Character/Event module-owned lifecycle state.

## M. Manual Character coupling

Current Manual Character calls the same `analyzeCurrentFloor`/`runAnalysis`
pipeline; `resolveFinalWorldModelForAnalysis` may therefore reuse or invoke World
AI before Event AI. Phase E must preserve this behavior exactly.

FOLLOW-UP: **Analysis Boundary Fix** — future routing should use an existing valid
World and perform Event only (or fail closed if no World exists), but that is not
part of extraction.

## N. Event input field audit

| Field | Current source | Used by Event prompt/input now? | Phase E disposition |
|---|---|---:|---|
| `world_model` | causal/returned World resolver | yes | KEEP current behavior; pass as plain input |
| `story_time` | Story Time coordinator for target Floor | yes | KEEP |
| `recent_story` / `recent_context` | bounded recent-story/input collector | yes | KEEP |
| `character_registry` | nearest valid previous Floor snapshot | yes | KEEP; do not replace with Tracking registry |
| `existing_bioweave` | previous valid Floor analysis/events | yes | KEEP |
| `character` / `character_context` | shared context + runtime resolver | yes | KEEP; contamination follow-up only |
| `persona` | shared `buildAnalysisInput` / host context | yes | KEEP current behavior |
| `worldbooks` | selected source loader/common input | yes | KEEP current behavior |
| `external_memory` | external memory provider loader | yes | KEEP current behavior |
| `meta` | common input metadata | yes | KEEP current behavior |
| `floor_version` / `current_floor` | target Floor resolver | yes | KEEP; preserve provenance |
| `chat_scope` / `token_estimate` | Event input normalization/common builder | yes | KEEP |

No field is removed or re-routed in Phase E. Raw-source contamination remains a
follow-up Input Boundary Fix.

## O. Shared helper dependency map

| Helper | Current location | Event | World | Tracking | Snapshot | Generation | Pure? | Proposed owner |
|---|---|---:|---:|---:|---:|---:|---:|---|
| `buildFloorAnalysisInput` | `runtime/event-analysis.js` | yes | prerequisite inputs | consumes derived input | indirectly | yes | mixed/general input owner |
| `resolveCurrentBioWeaveFloor` / `resolveFloorAtIndex` | `runtime/event-analysis.js` | yes | yes | yes | yes | yes | no | existing Runtime Floor owner |
| `runAnalysisStageWithRetry` | `runtime/event-analysis.js` | yes | yes | no | no | lifecycle calls it | no | shared Analysis owner |
| `commitFloorPatch` capability | `runtime/event-analysis.js` -> Coordinator | yes | yes | no | snapshot/projection | terminal/lifecycle | no | Persistence seam; Coordinator unchanged |
| `assertExecutionCurrent` / `executionIsCurrent` | `runtime/event-analysis.js` | yes | World stage | Tracking guards | snapshot | lifecycle | no | execution owner |
| `resolveEventAnalysisIdentities` | `core/identity.js` | yes | no | consumes registry only | no | no | yes-ish domain transform | core identity owner |
| `normalizeEvent` / `validateEventCollection` | `core/events.js` | yes | no | consumes Events | no | no | yes | core Event owner |
| `verifyCharacterCanonicalReady` | `runtime/event-analysis.js` | yes | no | reads derived Tracking | no | no | mixed readback/business | Event canonical seam, Floor/business capabilities injected |
| `persistTerminalAttempt` | `runtime/event-analysis.js` | terminal path | World may have separate terminal path | failure refresh | no | lifecycle | no | shared terminal/execution owner |
| `maybeCreateSnapshot` | `runtime/event-analysis.js` | post-success call | World-independent | consumes derived | yes | lifecycle | no | general Snapshot owner |
| `refreshTrackingRegistry` | `runtime/tracking-runtime.js` | call site | world update may trigger elsewhere | yes | no | lifecycle triggers | no | Tracking Runtime |

## P. Proposed `runtime/character-event-analysis.js` responsibility

The target should own a cohesive Event/Character workflow, not an empty
`callback.performEventAnalysis()` wrapper:

- Event analyzer invocation orchestration and Event trace callback wiring;
- identity-resolution invocation against supplied previous registry;
- Event-specific normalization, deterministic provenance/ID construction and
  complete collection validation;
- canonical Event/character expectation DTOs and Event-specific error mapping;
- successful Event `analysis` construction and explicit owner patch shape;
- Event canonical readback/readiness verification using narrow Floor/business
  capabilities;
- post-success Snapshot and Tracking capability calls in existing order.

It must not own input collection/Floor traversal, World generation, generic retry,
execution registry/cancellation/supersede, terminal finalization, Snapshot
machinery, Tracking implementation, or concrete persistence.

## Q. Proposed minimal API

Proposed only after implementation seam review:

```js
export function createCharacterEventAnalysis({
  analyzer,
  normalizeCharacterRegistry,
  resolveEventAnalysisIdentities,
  normalizeEvent,
  dedupeEvents,
  validateEventCollection,
  deterministicEventId,
  materializeStateFact,
  commitAnalysis,
  commitFloorPatch,
  assertExecutionTargetCurrent,
  verifyCharacterCanonicalReady,
  maybeCreateSnapshot,
  refreshTrackingRegistry,
  emitPersistenceTrace,
  traceApi,
} = {}) {
  return { runEventAttempt };
}
```

This is a design shape, not an implementation commitment. `runEventAttempt` must
receive plain `target`, `analysisInput`, `worldModel`, `execution`, `token`, and
the current saved analysis; it must not receive the entire event-analysis
coordinator. If terminal/rollback/finalization cannot be separated without
passing the coordinator, implementation must stop rather than create a broad
callback bag.

`analyzeCharacterEventStage` is intentionally not exposed until a real caller
requires it; the Runtime facade remains unchanged.

## R. `runAnalysis` ownership recommendation

Keep `runAnalysis` in `runtime/event-analysis.js` as the outer pipeline and
execution coordinator. It currently combines:

- target/token/execution state;
- input preparation and World prerequisite;
- shared retry policy;
- terminal cancel/failure persistence;
- scheduler/lifecycle interaction and final status publication.

Move only the Event-specific `invoke`/successful `complete` workflow behind a
narrow capability. Do not move World prerequisite, terminal handling, generic
retry or Generation state into the new module.

## S. Target `event-analysis.js` responsibility after Phase E

It should retain:

- public Runtime composition/facade wiring;
- Floor resolution and general input/derived-state collection;
- execution registry, in-flight deduplication, cancellation/supersede and
  currentness guards;
- shared `runAnalysisStageWithRetry` and retry classification;
- Generation lifecycle/scheduler/settle barrier;
- World module composition and prerequisite transition;
- terminal analysis persistence and final status notification;
- Snapshot/general StateReducer/Projection bridge;
- Tracking Runtime wiring and business DTO assembly;
- Event Editing and Diagnostics composition.

It should no longer contain direct Event AI invocation, identity/normalization/
validation attempt body, Event success owner patch construction, or Event-specific
canonical readback/post-success bridge if the seam is implemented safely.

## T. Circular dependency analysis

Desired direction:

```text
runtime/event-analysis.js / runtime composition
  -> runtime/world-analysis.js
  -> runtime/character-event-analysis.js
  -> runtime/event-editing.js
  -> runtime/tracking-runtime.js
  -> ai/* and core/*
```

`character-event-analysis.js` must not import `event-analysis.js`, `events.js`,
`world-analysis.js` implementation, Event Editing, Tracking Runtime instance,
Generation lifecycle or concrete Coordinator. It receives World input and narrow
Runtime capabilities. This yields zero intended module cycles; callback cycles
are also zero if the factory receives individual capabilities rather than the
coordinator object.

## U. Regression tests required for implementation

Preserve and run the existing tests covering:

- Event success, parse failure, strict JSON/think-wrapped rejection and valid
  empty result;
- canonical non-empty mismatch/readback failure, retry and retry exhaustion;
- retry count and Event-only retry without rerunning World;
- identity resolution, alias merge, new/unknown character, unresolved batch;
- `character_registry` persistence/readback and sibling World/Snapshot/Projection
  preservation;
- Event owner patch, terminal failure, terminal supersede and late result guard;
- stale Floor, active/deleted Swipe, Chat change, cancellation/supersede;
- Snapshot checkpoint and Tracking refresh timing/reason;
- current Manual Character World coupling unchanged;
- auto World → Event ordering, Runtime facade compatibility and static gate.

No existing test expectation should be changed to accommodate extraction.

## V. Implementation risk

**HIGH.** The Event attempt body is cohesive, but its completion callback crosses
authoritative persistence/readback, business readiness, Snapshot, Tracking and
execution state. The recommended seam is feasible only if it remains narrow and
preserves async/error boundaries. The largest risks are moving terminal behavior
accidentally, changing retry attempt boundaries, and passing broad coordinator
callbacks.

## W. Recommendation

**SAFE TO EXTRACT WITH A NARROW SEAM.** This is safe as a future pure extraction
provided implementation moves only the Event-specific attempt/complete workflow,
keeps shared retry/execution/terminal/Floor capabilities in their owners, and
passes the full regression matrix. If the seam requires importing
`event-analysis.js` or injecting the whole coordinator, stop and report
`NOT SAFE TO EXTRACT UNDER CURRENT SEAM`.

## X. Follow-up issues

1. Manual Character currently reaches `resolveFinalWorldModelForAnalysis` and may
   trigger World AI — Analysis Boundary Fix.
2. Event input still carries raw/shared Character Card, Persona, Worldbook,
   external-memory and metadata fields — Input Boundary Fix.
3. Characters UI intentionally enumerates `tracking_subjects`, not all identity
   registry entries — product boundary review only.
4. `character_registry` and Tracking registry are distinct owners/projections —
   preserve and document in any future product change.
5. Event edit/delete Snapshot/Projection consistency remains a separate issue.
6. Generic retry remains shared in `event-analysis.js`; a later shared-runtime
   extraction would need its own plan and must not be mixed into Phase E.
