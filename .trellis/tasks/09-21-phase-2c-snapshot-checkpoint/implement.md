# Implementation Plan

1. Read `trellis-before-dev` and the domain Floor State / lifecycle guidance before editing; re-check the current worktree and exact symbols.
2. Implement the pure Snapshot DTO, deep clone, validation, creation, progression checkpoint helper, and baseState restore in `core/snapshot.js`.
3. Add the Floor `snapshot` root and lifecycle registry/clear semantics in `storage/schema.js` and `storage/lifecycle.js`; keep storage access through existing `store.js` abstractions only.
4. Add focused tests for replay equivalence, clone isolation, validation/ownership/version failures, Swipe 0, User owner, valid Character Floor counting, fallback, baseState restore, and forbidden fields.
5. Update `docs/DATA-MODEL.md` with DTO, ownership, cache, invalidation, and non-goals.
6. Run `node --check` on every modified JS file, the focused tests, `npm run check`, and `git diff --check`.
7. Inspect the final diff for Runtime/UI/Projection scope drift. Stop after Wave 1 and report remaining Runtime integration as deferred.

Rollback points: `core/snapshot.js`, Floor schema/registry, tests, and documentation are isolated; do not revert unrelated worktree changes. No commit/push is part of this Wave unless explicitly requested.
