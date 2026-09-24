# Phase C Tracking Runtime Extraction Design

## Current boundary

当前 Tracking Domain 与 Runtime orchestration 已经部分分离：

```text
Floor/Swipe storage slots + current message collection
  -> collectCurrentFloorStates (general valid-Floor traversal)
  -> collectCurrentDerivedState (mixed derived-state coordinator)
       -> sort valid Events
       -> resolve current-or-before World Model
       -> rebuildTrackingRegistry (core/tracking.js)
       -> select Floor-owned character_registry
       -> buildCharacterFacts
       -> restore Snapshot or reduceState
       -> Story Time and business-derived DTO inputs
  -> refreshTrackingRegistry
       -> serialized registry refresh chain
       -> TRACKING_REGISTRY_REFRESHED {reason,event_count}
       -> Runtime subscribers / ui/app.js refreshBusinessState
```

`refreshTrackingRegistry` is a valid Tracking Runtime candidate, but
`collectCurrentDerivedState` is not a valid whole-module move. It owns State,
Snapshot, Story Time, Floor traversal, and business DTO inputs in addition to
Tracking.

## Proposed extraction seam

The implemented target is `runtime/tracking-runtime.js`, composed by
`createEventAnalysisCoordinator` and exposed through the unchanged Runtime
facade. It receives narrow capabilities or plain data for:

- current valid Floor/Event collection;
- provenance-checked current-or-before World Model;
- Floor-owned canonical `character_registry` selection;
- enabled check and Chat token assertion;
- Runtime notification sink;
- serialized refresh enqueueing. The `registryRefreshChain` itself remains in
  `event-analysis.js` because `invalidateForClear()` waits on it as a clear
  barrier.

The module should call `core/tracking.js` directly and return the exact current
registry shape. It must not import `event-analysis.js`, `event-editing.js`,
`events.js`, the Persistence coordinator, or Generation lifecycle.

The final seam must not copy Floor traversal or Snapshot/StateReducer logic.
If a narrow plain-data seam cannot preserve the existing `chat.assert`, stale
Floor, disabled, and refresh-chain behavior, the recommendation is
`NOT SAFE TO EXTRACT YET`.

## Final minimal API

The audit must decide the exact form, but the smallest supported shape is
expected to be one factory with only the capabilities currently consumed by
Runtime:

```js
createTrackingRuntime({
  collectTrackingInputs,
  isEnabled,
  hasMessageCollection,
  getToken,
  assertToken,
  notify,
  enqueueRefresh,
})
```

Returning only the existing capability needed by callers is preferred:

```js
{
  buildTrackingRegistry,
  refreshTrackingRegistry,
}
```

`getTrackingRegistry` and `collectActiveBusinessData` remain in
`event-analysis.js`. They use the internal `buildTrackingRegistry` capability
without moving their mixed derived-state and business DTO paths.

## Compatibility and ordering

- Preserve `TRACKING_REGISTRY_REFRESHED` and its payload `{reason,event_count}`.
- Preserve disabled/no-message behavior (`skipped` or `null`).
- Preserve `registryRefreshChain` serialization and failure reset behavior;
  only the refresh callback and Tracking rebuild moved behind `enqueueRefresh`.
- Preserve token assertion after derived reads and before notification.
- Preserve Event Editing calls with reasons `event-edit` and `event-delete`.
- Preserve analysis success refresh after canonical persistence/readback and
  failure refresh after terminal metadata handling.
- Preserve lifecycle refresh for Chat change, Swipe boundaries, deletion, clear,
  init, and any other confirmed current call site.
- Preserve all Floor/Swipe/version ownership checks in the existing Runtime
  capabilities.

## Non-goals

No Tracking algorithm, candidate/subject semantics, character profile meaning,
identity registry behavior, StateReducer, Snapshot, Projection, UI list source,
or persistence behavior changes are part of this design.

## Rollback shape

If a future implementation is approved and fails, revert only the new Tracking
Runtime module, its composition seam, and import/call substitutions. Restore no
unrelated Phase A/Phase B or pre-existing worktree changes.
