# Implementation Plan: Generic World Model Prompt and Baseline Boundaries

## Ordered checklist

1. Re-read the current `ai/prompts.js`, `ai/analyzer.js`, and World Model tests; record the existing prompt assertions and final guard behavior before editing.
2. Rewrite only the World Model Core Prompt and output contract into a shorter generic form. Remove current fixture species/cases and duplicate rules while retaining schema keys, human baseline precedence, non-human Evidence Gate, open type names, and fertilization semantics.
3. Add or adjust the analyzer's generic parent/type duplicate predicate. Remove the single-non-human-type species-wide evidence fallback; keep human types outside that non-human sanitizer.
4. Keep the final consistency guard and tighten only the fertilization mechanism/role check required by the new contract. Do not add a shared human reproduction object or change schema normalization.
5. Add fixture-independent tests for:
   - ordinary modern human male/female baseline separation;
   - one arbitrary fantasy species with no type evidence;
   - arbitrary non-human male/female types with no capability evidence;
   - exact and generic-suffix parent/type duplicates;
   - non-human fertilization false/null behavior and interaction text;
   - prompt genericity and absence of current fixture names.
6. Run the focused World Model tests, full test suite, project checks, changed-file syntax checks, and diff whitespace validation.
7. Review the diff against the scope constraints, update the World Model frontend contract documentation if implementation changes its executable boundary, then commit/archive only after the user approves this planning summary.

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

## Review gates

- Before editing: verify no change is needed in schema, AnalysisInput, API, storage, UI, or refresh code.
- After Prompt edit: assert the production Prompt has no current fixture species/case names and still contains the generic baseline/Evidence Gate contracts.
- After analyzer edit: verify human baseline is not evidence-filtered as non-human, non-human fields never use species-wide fallback, duplicate types are removed generically, and capability `null` does not clear rules.
- Before commit: inspect `git diff` and `git status`; leave unrelated `docs/references/*` files untouched.

## Rollback points

- Prompt-only rollback: restore `ai/prompts.js` while retaining analyzer tests for the existing contract.
- Analyzer rollback: revert only the duplicate predicate, type-local evidence selection, and fertilization filter; do not revert schema or storage history.
- Test rollback: remove only newly added generic cases if a test fixture is found to assert an out-of-scope behavior.
