# Phase B Event Editing Extraction Design

## Recommended boundary

建议新增 `runtime/event-editing.js`，但只让它拥有 Event-specific mutation orchestration：active Event lookup contract、Event patch normalization、participant canonical-ID guard、collection validation、事件数组替换/删除，以及对 Runtime seams 的调用。

它不拥有 Floor resolver、Floor Version policy、mutation invalidation、persistence coordinator、Tracking rebuild、snapshot 或 projection policy。

## Current call graph

```text
ui/app.js saveEventEdit / deleteEvent
  -> runtime.updateEvent / runtime.deleteEvent
    -> eventAnalysis.updateEvent / deleteEvent
      -> findActiveEvent
        -> messages + isCharacterMessage
        -> resolveFloorAtIndex
        -> store.getActiveFloorEvents(index, target.version)
      -> update only: normalizeEvent
      -> update only: normalizeCharacterRegistry + hasCharacterId guard
      -> update only: validateEventCollection + domainValidationError
      -> invalidateMutation(MESSAGE_EDITED or MESSAGE_DELETED, target.index, preserveTarget)
        -> invalidate in-flight executions / clear later Floor roots / preserve target
      -> commitFloorPatch(target, owner=event, patch={events}, operation_type)
        -> FloorPersistenceCoordinator.commitFloorPatch
      -> chat.assert mutation token
      -> invalidatedFloors.delete(target version key)
      -> refreshTrackingRegistry(reason)
        -> collectCurrentDerivedState
        -> collect current valid Floor states
        -> rebuildTrackingRegistry(active Events, World Model)
        -> current Character Registry from valid Floor snapshots
        -> reduce/restore current biological state
        -> notify TRACKING_REGISTRY_REFRESHED
  -> UI success Toast + refreshBusinessState(reason)
```

`runtime/events.js` remains the public facade. The safer composition point is inside `createEventAnalysisCoordinator`, where the existing private Floor/mutation seams already live; no UI or direct `runtime/events.js` import of `runtime/event-editing.js` is proposed.

## Proposed seam

Use a small factory/callback seam rather than a general service framework:

```js
createEventEditing({
  resolveActiveEvent,
  normalizeEvent,
  normalizeCharacterRegistry,
  hasCharacterId,
  validateEventCollection,
  createCollectionValidationError,
  invalidateMutation,
  commitEventPatch,
  clearInvalidatedFloor,
  refreshTrackingRegistry,
})
```

The exact callback names are implementation detail. The important direction is:

- `event-editing.js` does not import `event-analysis.js`;
- Runtime/Analysis retains Floor and execution state ownership;
- the persistence callback remains a thin adapter to the existing coordinator;
- no callback exposes or transfers the coordinator's private execution map.

`resolveActiveEvent` should return `{target, event}` from the current active Floor/Swipe. `commitEventPatch` should preserve the existing `commitFloorPatch` owner=`event`, operation type, token guard, and patch shape. `invalidateMutation` and `refreshTrackingRegistry` remain coordinator-owned capabilities.

## Ownership map

| Responsibility | Current owner | Proposed owner after extraction |
|---|---|---|
| Event lookup by canonical ID | `event-analysis.js` private `findActiveEvent` | Event Editing lookup contract, with Floor resolver callback |
| Event patch normalization | `core/events.js` + `updateEvent` | Event Editing |
| Participant canonical-ID check | `core/identity.js` + `updateEvent` | Event Editing using domain helper |
| Complete Event collection validation | `core/events.js` + `domainValidationError` | Validation call in Event Editing; diagnostic error builder remains a seam unless later moved to neutral domain layer |
| Mutation invalidation / downstream clearing | `event-analysis.js` `invalidateMutation` | Keep in Runtime/Analysis coordinator |
| Floor patch commit | coordinator wrapper + storage coordinator | Keep in Runtime/Analysis and storage |
| Tracking rebuild | `refreshTrackingRegistry` + `core/tracking.js` | Keep Tracking Runtime |
| Character registry snapshot | valid Floor state reader | Keep Floor/Analysis derived-state reader; Event Editing does not rewrite it |
| Current biological state | `collectCurrentDerivedState` + `core/state.js` | Keep Tracking/State Runtime |
| Snapshot checkpoint | `maybeCreateSnapshot` | Keep analysis lifecycle; current edit/delete path does not call it |
| Projection timeline | `runtime/events.js` projection facade/storage | Keep Projection; current edit/delete path does not mutate it |
| UI refresh/toast | `ui/app.js` | Keep UI |

## Important coupling

`invalidateMutation` is the main extraction seam. It depends on in-flight execution state, lifecycle mutation ordering, downstream Floor clearing, `invalidatedFloors`, and current Chat token rules. Moving it into Event Editing would mix editing with Generation/Analysis lifecycle and would be unsafe.

The current target cleanup after commit (`invalidatedFloors.delete(floorExecutionKey(target.version))`) is also coordinator state. Expose only a narrow callback such as `clearInvalidatedFloor(target.version)` or include it in a coordinator-owned mutation wrapper; do not move `floorExecutionKey` policy into Event Editing.

## Derived-state facts

- `events`: update replaces one normalized Event; delete removes one Event; both save only `{events}`.
- `character_registry`: neither operation directly changes the persisted canonical registry. The current registry projection is rebuilt from valid Floor snapshots.
- `tracking_subjects`, `tracking_candidates`, `character_profiles`: rebuilt from current valid Events by `core/tracking.js`; deletion removes derived exposure references when no remaining valid Event supports them.
- biological `state`: recomputed by `reduceState` or restored from a valid snapshot plus later Events.
- `snapshot`: not directly updated by edit/delete. Because a same-Version edit can leave an existing valid snapshot in place, snapshot freshness is a regression risk and must be tested before implementation; changing that semantic is out of scope for extraction.
- `projection_timeline`: not touched by current Event edit/delete. Projection records may retain source Event IDs; any change to that contract is a separate behavior task.
- `analysis`: not replaced by edit/delete; the existing analysis and Floor Version remain in the target slot while only `events` is patched.

## Dependency direction

```text
runtime/events.js
  -> runtime/event-analysis.js
    -> runtime/event-editing.js
    -> analysis/lifecycle/derived capabilities

runtime/event-editing.js
  -> core/events.js
  -> core/identity.js
  -> plain-data/callback seams

runtime/event-editing.js -X-> runtime/event-analysis.js
runtime/event-editing.js -X-> storage/floor-persistence-coordinator.js
```

`createEventAnalysisCoordinator` can compose the new module while `runtime/events.js` continues to expose the same `updateEvent` and `deleteEvent` functions.

## Recommendation

SAFE TO EXTRACT with a narrow callback seam and behavior-preserving tests. Implementation risk is HIGH because Event Editing currently shares private Runtime/Analysis state for invalidation, stale protection, and downstream rebuild. A wholesale move of the three shared runtime capabilities is NOT safe.
