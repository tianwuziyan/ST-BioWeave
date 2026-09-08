# Implementation Plan: World Model Final Reproduction Consistency

## Ordered checklist

1. Keep the current species/type and Evidence Gate code unchanged; add a pure
   final consistency helper in `ai/analyzer.js` after the existing analysis guard.
2. Implement the four false-capability mappings, role-aware fertilization
   filtering, and human male/female baseline separation without changing the
   structural parser or manual save path.
3. Add analyzer-level regressions for human male and female baselines, non-human
   carrying/ovulation conflicts, donor/recipient fertilization conflicts,
   roleless human baseline text, and capability-`null` preservation.
4. Run focused tests, full tests, `npm run check`, changed-file syntax checks,
   and `git diff --check`.
5. Run the Trellis quality check, update the frontend contract note, commit the
   scoped changes, archive the task, record the session, and stop for the user's
   real retest.

## Validation commands

```bash
node --test tests/world-model.test.js
npm test
npm run check
node --check ai/analyzer.js
node --check tests/world-model.test.js
git diff --check
```

## Risky files and rollback points

- `ai/analyzer.js`: final guard must run only after `applyWorldModelEvidenceGuard`; do
  not alter `normalizeWorldModel`, `parseWorldModelResponse`, species/type filtering,
  or Evidence Gate behavior.
- `tests/world-model.test.js`: assert results through `analyzeWorldModel`, not only
  helper internals or raw API JSON.
- `.trellis/spec/frontend/state-management.md`: document only the final consistency
  contract; do not change schema/storage contracts.
