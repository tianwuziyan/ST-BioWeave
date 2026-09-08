# Implementation Plan: Non-human Evidence Gate

## Ordered checklist

1. Inspect and preserve the current World Model schema, normalization, AI-only
   guard, human baseline tests, and the archived previous task decisions.
2. Rewrite `ai/prompts.js` non-human instructions to state a single Evidence
   Gate and the `剑灵性别基本都为男性，极少女剑灵` semantic example.
3. Add species-local evidence helpers in `ai/analyzer.js`; replace the current
   global familiar-label check for non-human types.
4. Add non-human field-level sanitization for capabilities,
   reproduction_rules, and lifecycle. Keep human types and existing type
   exclusions unchanged.
5. Add focused regressions in `tests/world-model.test.js` for:
   - human evidence not leaking into 妖/魔 types;
   - semantic female sword-spirit evidence;
   - non-human fields becoming null without direct evidence;
   - direct non-human capability/rule evidence being retained narrowly;
   - partial human-equivalence not filling unrelated fields;
   - existing temporary dualization, alias, fixed dual, ABO, and human
     baseline behavior.
6. Update `docs/DATA-MODEL.md`, `docs/UI.md`, and the relevant frontend state
   contract if needed so the evidence gate matches runtime behavior.
7. Run focused World Model tests, full tests, `npm run check`, changed-file
   syntax checks, and `git diff --check`.
8. Run the Trellis quality check, commit only the scoped changes, archive the
   task, record the session, and stop for the user's SillyTavern retest.

## Validation commands

```bash
node --test tests/world-model.test.js
npm test
npm run check
node --check ai/analyzer.js
node --check ai/prompts.js
git diff --check
```

## Risky files / rollback points

- `ai/analyzer.js`: evidence scope and field sanitization; preserve the
  analysis-only versus manual-edit boundary.
- `ai/prompts.js`: remove contradictory old human/non-human template wording.
- `tests/world-model.test.js`: ensure tests assert source evidence, not merely
  the guard implementation.
- `docs/*` and `.trellis/spec/frontend/state-management.md`: documentation only;
  do not alter unrelated UI or storage contracts.

If a focused test exposes an unintended human regression, first narrow the
non-human branch rather than weakening the human baseline or changing schema.
