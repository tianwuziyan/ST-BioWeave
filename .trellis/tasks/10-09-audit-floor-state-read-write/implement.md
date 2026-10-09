# Implementation Plan

## Phase 0: Swipe baseline

1. Reproduce both failing Swipe tests independently.
2. Trace active Swipe selection, pending generation lifecycle, exact slot read, Floor Version validation, and previous input.
3. Fix the root cause without weakening assertions.
4. Run both tests and relevant lifecycle/version tests.

## Phase 1: Complete-state read contract

1. Inspect schema/persistence presence behavior and implement the smallest reliable distinction between missing state and explicit `events: []`.
2. Implement the unified nearest-valid-complete-Floor resolver.
3. Update Floor Event filtering so container owner validation is preserved while inherited Event source remains visible.
4. Add isolated resolver tests for nearest state, empty state, future exclusion, Swipe isolation and six-field invalidation.

## Phase 2: Analysis save

1. Build analysis input from the previous complete `events`.
2. Merge AI output using existing Event ID and dedupe rules.
3. Save the complete result only to the current Floor.
4. Verify reanalysis of one Floor does not duplicate events and historical slots remain unchanged.

## Phase 3: Edit/delete

1. Change Event update/delete to operate on current complete state.
2. Persist explicit empty `events: []` for deleting the last Event.
3. Verify stale Floor Version, wrong Swipe, missing target and write failure fail closed.

## Phase 4: Downstream consumers

1. Make Tracking consume the current complete collection.
2. Prevent StateReducer and Snapshot from replaying complete arrays as deltas.
3. Adapt Health Assessment minimally for inherited source and fingerprint binding.
4. Verify MESSAGE_DELETED remains owner/downstream invalidation and does not revive deleted Event data.

## Required checks

- Focused Event/Swipe/Floor/Health Assessment/Snapshot/Tracking/lifecycle tests after each phase.
- `npm test` and `npm run check` before completion.
- Real Host acceptance remains separate and must be reported as unverified until performed.

## Current execution status

- Phase 0: PASS. The two previously failing Swipe tests now pass. Root cause was
  that a pending new Swipe carried `force: true`, but the scheduler still applied
  the ordinary Character interval before starting analysis. The fix preserves
  the existing assertion and waits for the real analysis-success notification.
- Phase 1: PASS for the new read contract. `hasCompleteEventState()` uses the
  existing analysis record plus the six-field Floor Version; no storage-mode
  marker was added. The resolver walks backward by position and treats a
  successful `events: []` as an explicit empty state.
- Phase 2: PASS for the covered complete-state examples. Analysis input starts
  from the nearest complete state; the current Floor receives the merged full
  result and inherited Event `source` is preserved.
- Phase 3: PASS for covered edit/delete flows. Edit/delete target the current
  Floor, repeated edits update that slot, and deleting the last Event persists
  `events: []` plus a successful analysis record.
- Phase 4: PASS for the covered Tracking/Health/StateReducer paths. Tracking and
  StateReducer consume the resolved complete collection; Health uses current
  Events with source-bound assessment timelines; Snapshot Event replay was
  removed from the current read path.

The complete repository test run was started but interrupted after the existing
long-running runtime suite; it is not treated as a passing full-suite result.

## Stop conditions

Stop before the next phase if a source-binding, Swipe, Health Assessment, Snapshot or historical immutability conflict cannot be resolved without adding a second Event state system.
