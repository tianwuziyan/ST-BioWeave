# Implementation plan

## Change boundary

Expected product files:

- `ai/prompts.js`: rewrite the World Model core/output rules without changing
  message roles or AnalysisInput formatting.
- `ai/analyzer.js`: canonicalize the user-visible dual label and replace the
  broad intersex evidence filter with the narrow analysis-only evidence guard.
- `storage/schema.js`: only update schema comments/description if needed; keep
  the nested open-string shape and version unchanged.
- `ui/world.js`: update Chinese type labels/empty states; preserve the current
  DOM actions and responsive/theme behavior.
- `tests/world-model.test.js`: replace stale composite-label assertions and add
  focused regressions for all requested evidence cases.
- `docs/UI.md`, `docs/DATA-MODEL.md`, and
  `.trellis/spec/frontend/state-management.md`: document the final contract.

Explicitly do not touch AnalysisInput, selectors, API profiles, secrets,
Chat-local save/refresh code, Floor/Event/State/Projection/Genealogy, or host
UI behavior.

## Ordered checklist

1. [x] Start the approved Trellis task and re-read the final PRD/design,
   relevant frontend specs, and current tests.
2. [x] Rewrite the World Model prompt as one ordered contract covering
   species/type separation, default human fallback, exclusions, fixed versus
   temporary `双性`, open ABO names, baseline precedence, non-human unknowns,
   local capabilities, and closed unknowns.
3. [x] Implement the smallest analyzer guard:
   - exact composite-name canonicalization to `双性`;
   - fixed-vs-temporary dual evidence;
   - familiar male/female evidence gating;
   - redundant sword-spirit name normalization;
   - direct observed non-biological alias removal;
   - unknown entries cannot reintroduce a removed fixed type.
4. [x] Keep structural schema validation open and nested; verify no enum or
   species-level capability field is introduced.
5. [x] Update World page wording/empty states to `性别 / 生殖类型` and verify
   all null-like values remain `未知`.
6. [x] Update docs/spec wording and remove all stale default/composite
   `双性` claims.
7. [x] Add or revise focused tests for:
   - male-only and male+female default-human evidence;
   - temporary versus fixed dualization;
   - individual ambiguity;
   - `妖修`/`半兽人`/`魔族` and sword-spirit subtype exclusions;
   - sword-spirit male/female rule;
   - human baseline and world override;
   - non-human unknowns and explicit partial human inheritance;
   - open ABO names without combinations;
   - closed unknowns;
   - Chinese UI labels and canonical `双性` display.
8. [x] Run focused tests, JavaScript syntax checks, full `npm test`, and
   `npm run check`.
9. [x] Perform a diff audit against the explicit out-of-scope list and run
   the Trellis quality check. Fix only findings within this task.
10. [x] Update the frontend state-management spec if implementation reveals a
    sharper reusable contract, then commit the completed task. Stop after the
    handoff; do not begin another BioWeave module.

## Validation commands

```bash
node --test tests/world-model.test.js
node --check ai/analyzer.js
node --check ai/prompts.js
node --check ui/world.js
npm test
npm run check
git diff --check
```

Also run targeted searches before the final report:

```bash
rg -n "双性|生物学 / 生殖类型|species-level.*capabil|top-level.*biological" \
  ai storage ui tests docs .trellis/spec/frontend/state-management.md
```

The first two stale-label matches are allowed only in regression-test input
that explicitly proves canonicalization/removal; no active prompt or UI copy
may retain the old default wording.

## Risk and rollback points

- Prompt-only changes can alter provider output without changing persistence;
  prompt tests and the attached regression fixture are the first checkpoint.
- The analysis guard is the main semantic risk. Keep it isolated so a failing
  SillyTavern retest can roll back just that cleanup while retaining the prompt
  and canonical display name.
- Do not change the schema version or migrate stored Chat data. If a test
  reveals a compatibility issue, stop at the normalizer/guard boundary rather
  than widening the task.
