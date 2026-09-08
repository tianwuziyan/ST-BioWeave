# Implementation Plan: World UI v2 模块化编辑

## Ordered checklist

1. Confirm the task boundary and current working tree; do not touch the existing
   `09-08-world-model-final-consistency` task or the user-provided v2 docs.
2. Replace the global World renderer in `ui/world.js` with dynamic species cards,
   selected biological type detail, seven section cards, and one-section editor
   markup. Remove the global editor markup and related unused helpers.
3. Update `ui/app.js` state and delegated actions for type selection, one active
   section draft, cancel, add/remove list rows, normalized section application,
   isolated Chat save, and failed-save draft retention.
4. Add World-specific CSS in `style.css` following the v3 reference HTML
   hierarchy and the existing Desktop / Tablet / Mobile breakpoints. Reuse
   theme variables and avoid new logo or dependency work.
5. Update `tests/world-model.test.js` and `tests/ui.test.js` with renderer,
   dynamic type, tri-state, section isolation, cancel, failed-save, and
   responsive-contract regressions. Do not weaken existing business tests.
6. Run focused tests, full tests, changed-file syntax checks, `npm run check`,
   and `git diff --check`.
7. Inspect the final diff for forbidden business-layer changes, run the real
   SillyTavern smoke checks at Desktop / Tablet / Mobile, then stop at the
   World UI acceptance point.

## Validation commands

```bash
node --test tests/world-model.test.js
node --test tests/ui.test.js
npm test
npm run check
node --check ui/world.js
node --check ui/app.js
git diff --check
git diff -- storage/schema.js ai/analyzer.js ai/prompts.js ai/input-builder.js
```

## Risky files and rollback points

- `ui/world.js`: renderer contract and section patch helper; verify no global
  editor action remains and no fixed type list is introduced.
- `ui/app.js`: async save and stale Chat behavior; verify failed saves never
  replace the in-memory model or clear the draft.
- `style.css`: responsive World layout; verify no host-level or theme-level
  selectors are changed.
- Tests: update old global-editor assertions to v2 behavior without removing
  schema/analyzer coverage.

Rollback is a scoped revert of the UI/test changes. No data migration is
required because the World Model payload and metadata schema remain unchanged.
