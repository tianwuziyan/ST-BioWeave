# 统一 Floor 持久化协调器实施计划

## Phase 1: inventory and seam extraction

- [x] Inventory `runtime/events.js`, `storage/store.js`, `runtime/event-analysis.js`, `storage/projection.js`, manual edit/delete paths, clear/restore/migration, and tests that write Floor data.
- [x] Classify each writer KEEP / MOVE INTO COORDINATOR / DELETE AS SUPERSEDED / EXPLICIT SPECIAL OPERATION.
- [x] Identify low-level host/official primitives that can be reused without retaining World/Event orchestration.
- [x] Confirm exact no-Swipe path and Swipe 0 semantics from current code/spec.

Inventory classification:

- KEEP: `storage/store.js` ownership checks and cloning; `runtime/events.js`
  official GET/SAVE, host synchronization, readback, and convergence adapter;
  explicit clear/restore/migration whole-object operations.
- MOVE: World and Manual Full/Patch, Event/Character analysis and CRUD,
  terminal attempt records, Snapshot invalidation, and Projection timeline
  writes now submit owner-scoped patches through the coordinator.
- DELETE AS SUPERSEDED: ordinary business calls that assembled a complete
  Floor snapshot before `store.saveFloor`; the static gate prevents their
  return in `runtime/event-analysis.js` and `storage/projection.js`.
- SPECIAL: lifecycle root clearing remains a guarded low-level clear operation;
  it is not an ordinary owner patch and does not create Chat metadata state.

## Phase 2: coordinator and tests

- [x] Add the coordinator module with owner whitelist, transaction key, per-key serialization, live-context reacquisition, patch validation, latest-slot merge, host sync, official save/readback, sibling audit, and structured result.
- [x] Add `FLOOR_TX_*` diagnostics and ensure diagnostic traces remain non-business events.
- [x] Add coordinator contract tests: sibling preservation, 越权拒绝, queue stale failure, latest dispatch merge, Swipe 0/no-Swipe, confirmed/readback semantics.

## Phase 3: migrate production writers

- [x] Migrate World persistence and Manual Full/Patch.
- [x] Migrate Event/Character persistence and preserve World sibling.
- [x] Migrate Projection timeline writers.
- [x] Audit Terminal persistence; keep only approved business fields and remove prerequisite-failure Floor writes.
- [x] Remove old duplicate orchestration and dead diagnostics/functions with no production caller.
- [x] Add direct-writer/static gate for ordinary business modules.

## Phase 4: lifecycle and documentation

- [x] Update data lifecycle/floor ownership docs to describe coordinator, transaction outcomes, and retained special operations.
- [x] Verify Generation Settle Barrier, Auto prerequisite, retry/cancel, UI reentrancy, World→Event dependency, and scheduler semantics are unchanged.
- [x] Split Analysis Input Ready from persistence owner acquisition; add strict host-ahead bootstrap and authoritative readback classification.
- [x] Stop treating undefined/void `saveChatConditional()` results as confirmed persistence.
- [x] Add regression coverage for host-ahead bootstrap, true-stale rejection, and save/readback confirmation semantics.
- [x] Add generation-source correlation diagnostics without changing settle-barrier or supersede semantics.

## Validation and review gates

- [x] `npm test`
- [x] `npm run check`
- [x] `node --check` every modified JS file
- [x] `git diff --check`
- [x] Review `git diff` for no Chat metadata migration, no message.extra bypass, no timing workaround, and no whole-slot replacement in normal owner patches.
- [x] Report real-ST validation still required for F5 durability and late host writers.

## Rollback points

- Keep coordinator introduction separate from each domain migration.
- If a domain cannot be migrated without changing ownership, leave it on a clearly classified special/low-level path and report the blocker; do not add a second ordinary orchestration path.
