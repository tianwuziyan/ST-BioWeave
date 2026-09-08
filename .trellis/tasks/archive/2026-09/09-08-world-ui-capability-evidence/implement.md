# Implementation Plan: World UI Type Rendering and Capability Tri-state

## Ordered checklist

1. Inspect the existing `ui/world.js` rendering path and replay the attached
   response through `normalizeWorldModel` / `worldPage` to establish the
   missing-type regression boundary.
2. Make the World view's biological-type list traversal explicit and add tests
   for human `男性、女性、双性` plus an open custom type.
3. Split non-human capability evidence into explicit positive, explicit
   negative, and non-evidence states. Preserve the existing species-local gate,
   human baseline bypass, and field-local behavior.
4. Add regressions for false-vs-null (`无实际妊娠记录`, `仅假孕`), explicit
   false, explicit true, unrelated fields, and human baseline compatibility.
5. Update `ai/prompts.js` and the relevant frontend state spec to describe the
   false evidence gate; do not change the schema or unrelated docs/modules.
6. Run focused World Model tests, full tests, `npm run check`, changed-file
   syntax checks, and `git diff --check`.
7. Run the Trellis quality check, commit the scoped changes, archive this task,
   record the session, and stop for the user's SillyTavern re-test.

## Validation commands

```bash
node --test tests/world-model.test.js
npm test
npm run check
node --check ai/analyzer.js
node --check ai/prompts.js
node --check ui/world.js
git diff --check
```

## Risky files / rollback points

- `ai/analyzer.js`: only alter non-human capability evidence classification;
  protect human baseline and species-local type filtering.
- `ui/world.js`: keep existing escaping, empty-state text, editor behavior, and
  responsive markup while making the type loop explicit.
- `tests/world-model.test.js`: assert rendered names and source evidence rather
  than implementation-specific helper details.
- `ai/prompts.js` and `.trellis/spec/frontend/state-management.md`: keep the
  prompt/spec wording consistent with the runtime tri-state behavior.
