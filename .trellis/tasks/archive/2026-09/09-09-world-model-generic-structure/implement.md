# Implementation Plan

1. Capture the clean state and reverse `09b9b86` exactly after planning approval.
   Verify the working tree contains the pre-round `ai/analyzer.js`,
   `ai/prompts.js`, `tests/world-model.test.js`, and spec state before any new
   product edits.
2. Re-read the restored files and apply the generic design: keep the v1 five
   capability keys, remove fixture aliases/branches, remove any single-type
   evidence widening, and implement Human baseline fallback with explicit
   evidence precedence.
3. Reduce `ai/prompts.js` to the generic task, evidence, Human/non-Human,
   fertilization and output-contract sections. Check its source for all known
   fixture terms and forbidden registry names.
4. Refactor the World Model tests to original species fixtures and add coverage
   for schema whitelisting, Human/non-Human baseline separation, type/species
   boundaries, fertilization semantics, final consistency, UI co-rendering,
   and production pollution.
5. Update only relevant World Model documentation/spec statements if the
   restored baseline contains named fixture behavior.
6. Run the World Model test file and inspect failures; then run all project
   tests and `npm run check`.
7. Run the Trellis quality checklist: read task artifacts/specs, inspect
   cross-layer consumers, search for fixture terms and forbidden registries,
   verify no new dependency, and review `git diff --stat`/`git diff`.
8. Commit the implementation in Chinese using the actual diff, record the
   commit hash, archive this task, and record the session journal.

## Validation commands

```bash
node --test tests/world-model.test.js
npm test
npm run check
git diff --check
git status --short
git diff --stat
```

## Rollback point

Before implementation, the reverse of `09b9b86` is the known clean baseline.
If the corrected patch needs to be abandoned, restore only the current task's
uncommitted changes; do not reset the shared branch or touch unrelated Chat,
Runtime, UI, or storage history.
