# Technical Design

## Boundary

Snapshot remains a Floor-owned derived checkpoint. The authoritative facts are still the current valid Character/assistant Floor and active Swipe `analysis/events`; Snapshot is only a copy of the already-reduced Current State. It is stored in the same Floor owner object, never in Chat metadata or a User message.

## DTO

```js
{
  schema_version: 1,
  checkpoint: {
    chat_id,
    message_id,
    floor,
    swipe_id,
    content_hash,
    message_version,
  },
  state: {
    schema_version: 1,
    characters: {},
    processed_event_ids: [],
    diagnostics: [],
  },
}
```

`checkpoint` is exactly the existing six-field Floor Version. `state` is validated against the State DTO shape and deep-cloned on both creation and restore. No time, probability, projection, UI, or AI fields are introduced.

## Pure helpers

- `createSnapshot({ checkpoint, state })` validates the complete checkpoint and State DTO, then returns a deep copy.
- `validateSnapshot(snapshot, options?)` returns an explicit `{ ok, errors }` result and can verify expected Chat, owner message/Floor, active Swipe, and exact Floor Version. A User owner is rejected before persistence.
- `shouldSnapshot({ characterFloors, lastSnapshotCheckpoint = null, interval = 3, majorEvent = false })` counts ordered valid Character Floor checkpoints after the prior checkpoint; User entries are not candidates. `majorEvent` is only a boolean force hook.
- `restoreFromSnapshot({ snapshot, events, currentStoryTime, characterFacts, reducer = reduceState })` validates/reads `snapshot.state` and calls `reducer({ baseState: snapshot.state, events, currentStoryTime, characterFacts })`.

The exact object names may follow current project style, but no old `snapshot` reducer field or compatibility fallback is retained.

## Persistence

Add `snapshot: null` to `emptyFloor()` and register it as a Floor-owned derived/cache field. Character clear and All clear remove it; World clear preserves it. `storage/store.js` remains the only persistence boundary, so no helper writes `message.extra` or `swipe_info` directly. Existing owner validation and active Swipe selection provide Chat/message/Swipe scope checks; Snapshot validation additionally compares the checkpoint's six fields to the current owner version.

## Verification strategy

Use a new focused Snapshot test module plus the existing State/Floor/runtime/lifecycle tests. The focused tests cover full replay equivalence, clone isolation, schema/ownership/version rejection, Swipe 0, User rejection, valid-floor progression, full-replay fallback, baseState restore, and forbidden non-state fields. Documentation records the cache semantics and the exact persistence root.

## Deferred

No Runtime automatic checkpoint search/save/restore is wired in Wave 1. No attempt is made to invalidate future checkpoints after deletion of an old intermediate Floor.
