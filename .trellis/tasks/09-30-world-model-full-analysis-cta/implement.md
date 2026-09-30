# Implementation Plan

1. Confirm the current normalizer/schema and existing tests at implementation
   time; add the smallest pure `hasWorldModelData` helper in the existing UI
   seam. Include the exact species, medical, exception, unknown, projection,
   default-medical, and archive-only semantics in tests.
2. Update `ui/world.js` so only the Full non-busy label/title/aria text derives
   from active World Model data. Preserve Full busy text and all Supplement
   markup/semantics.
3. Update `ui/app.js` Full action handling to re-check current state and await
   `confirmWithPopup` before invoking `analyzeWorldModel('full')`; leave busy
   abort handling and Supplement dispatch unchanged. Confirm cancellation must
   return before any Full-flow busy/cleanup work.
4. Add focused tests for empty/populated outlet families, archive-only,
   confirmation cancel/confirm, stale click state, success label transition,
   busy behavior, and Supplement non-regression.
5. Run focused baseline/current comparisons, `tests/ui.test.js`, relevant World
   Model/archive tests, `npm test`, `node --check` on changed JS, and
   `git diff --check`. Record failure identities, not only counts.
6. Inspect related Markdown impact. Update only if the final behavior makes
   existing UI/framework or World Model documentation inaccurate.

Rollback points: revert only the task-owned product/test/doc hunks; do not
touch unrelated worktree changes. Do not commit or push.
