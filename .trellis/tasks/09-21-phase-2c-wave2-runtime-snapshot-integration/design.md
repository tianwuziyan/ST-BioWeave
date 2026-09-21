# Technical Design

## Runtime read path

Extend `collectCurrentDerivedState()` only. It already owns the shared Current State calculation used by both public read APIs. After collecting current valid Floor states, resolving the current Character Floor, Story Time, and `characterFacts`, select the nearest usable Snapshot from the ordered active states. The selector validates the Snapshot against the state’s current six-field version, active Swipe, current Chat, and current endpoint. Invalid candidates are skipped.

The selected state becomes:

```js
reduceState({
  baseState: snapshot.state,
  events: statesAfterCheckpoint.flatMap((state) => state.events),
  currentStoryTime,
  characterFacts,
})
```

The checkpoint owner’s Events are excluded. If no candidate survives, use the existing full replay input. No read path writes.

## Runtime write path

After `runAnalysis()` successfully saves authoritative `analysis`, `events`, and `character_registry`, compute the current derived State once under the same Chat token. If the ordered valid Character Floor progression reaches the configured `snapshot_interval`, create a Snapshot for the current target version and save only that target Floor through `store.saveFloor()`. A valid existing Snapshot for that exact target version is retained unchanged. Before and after the write, assert Chat token and target Floor Version; `store.saveFloor()` remains the persistence boundary.

Authoritative Event edits/deletes and successful same-version analysis replace clear `snapshot: null`, because the six-field version alone does not detect Event mutations within a version.

## State facts and time

Keep `currentStoryTime` and Runtime-built `characterFacts` outside Snapshot. Adjust the reducer’s base-state initialization only as needed so current character identity/capability facts update a restored state in the same shape expected by full replay; do not create a second mapper in Snapshot or Runtime.

## Lifecycle isolation

Candidate selection uses current active Swipe states only, so Swipe 0 is a normal numeric owner and old Swipes cannot leak. Store scope/version checks and the Chat token guard reject stale checkpoint writes. Deletion naturally removes an owner’s Snapshot; the next read searches earlier candidates or full replays.

## Deferred complexity

No cascade invalidation scans or dependency graph is added. A deleted old intermediate Floor may leave a later Snapshot that is not dependency-aware, as explicitly accepted for this phase.
