# Implementation Plan: World Model Final Evidence and Consistency Guards

## Ordered checklist

1. Inspect the current analyzer guard, the attached API response, and existing
   World Model tests; replay the fixture through `createAnalyzer` to establish
   the raw-response versus post-guard boundary.
2. Add a small species-alias/generic-suffix final type guard and remove the
   non-human single-type fallback to species-wide field evidence. Preserve
   human baseline handling and Sword Spirit semantic type recognition.
3. Add a pure final consistency guard for the three requested
   capability/reproduction-rule conflicts. Keep capability values authoritative;
   clear only contradictory positive rules.
4. Update the World Model Prompt and frontend World Model contract with the
   type-local evidence, no cross-individual aggregation, and consistency
   precedence rules.
5. Add focused regressions for `妖修`, `魔族`, cross-individual evidence,
   conflict cleanup, fixed/temporary dual evidence, Sword Spirit male/female,
   and non-human unknown capabilities.
6. Run focused tests, full tests, `npm run check`, changed-file syntax checks,
   and `git diff --check`.
7. Run the Trellis quality check, update acceptance criteria, commit the scoped
   changes, archive the task, record the session, and stop for the user's real
   retest.

## Validation commands

```bash
node --test tests/world-model.test.js
npm test
npm run check
node --check ai/analyzer.js
node --check ai/prompts.js
node --check tests/world-model.test.js
git diff --check
```

## Risky files and rollback points

- `ai/analyzer.js`: keep the semantic type guard analysis-only; do not alter
  structural normalization or manual editor behavior. Verify human baseline and
  non-human field locality separately.
- `ai/prompts.js`: add only coherent World Model evidence/consistency wording;
  do not append contradictory instructions.
- `tests/world-model.test.js`: assert output behavior through
  `analyzeWorldModel`, not only helper internals or raw API JSON.
- `.trellis/spec/frontend/state-management.md`: document the final guard without
  changing the schema/storage contract.
