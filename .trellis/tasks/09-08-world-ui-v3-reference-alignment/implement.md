# Implementation Plan: World UI v3 Reference 对齐与顶部信息降噪

## Ordered checklist

1. Re-read the full v3 HTML and current World UI CSS/renderer; record reference
   values before editing.
2. Update `ui/world.js` only for compact analysis time/source presentation:
   keep all raw metadata fields internal and do not change model/save paths.
3. Add or consolidate a scoped World UI reset and reference-value CSS block in
   `style.css`; cover typography, controls, cards, modules, rows, editors,
   selected/hover states, and all three breakpoints.
4. Extend `tests/world-model.test.js` with compact metadata cases and CSS/DOM
   contract assertions. Do not alter business-layer tests.
5. Run focused World Model/UI tests, full test/check commands, syntax and diff
   checks, and verify no forbidden business-layer files changed.
6. At the real SillyTavern acceptance point compare Desktop, Tablet, and Mobile
   against the reference HTML values; stop for user verification.

## Validation commands

```bash
node --test tests/world-model.test.js
node --test tests/ui.test.js
npm test
npm run check
node --check ui/world.js
node --check ui/app.js
git diff --check
git diff -- storage/schema.js ai/prompts.js ai/analyzer.js ai/input-builder.js
python3 .trellis/scripts/task.py validate .trellis/tasks/09-08-world-ui-v3-reference-alignment
```

## Risky files and rollback points

- `ui/world.js`: only the source-summary formatter and top metadata markup may
  change; verify no save/editor/analysis event path changes.
- `style.css`: large visual surface; verify every selector is scoped to
  `bioweave-*` and no global SillyTavern selector is introduced.
- `tests/world-model.test.js`: update only UI expectations and add regression
  cases for source filtering/time formatting.

## Explicit non-goals

Do not add production files, dependencies, controllers, services, factories,
new metadata fields, mock data, or browser injection/deployment workarounds.
