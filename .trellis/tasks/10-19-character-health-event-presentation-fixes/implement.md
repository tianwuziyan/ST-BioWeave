# Implementation Plan

1. Finish the shared Event contract first:
   - add the explicit health-fact vocabulary/helper in `core/events.js`;
   - filter non-health `other_biological` AI results in `ai/analyzer.js`;
   - add the prompt boundary in `ai/prompts.js`;
   - make Health Assessment eligibility fail closed for the same invalid fact;
   - add parser, prompt, eligibility, and runtime regressions while preserving
     the fracture observation fixture.
2. Fix the health display contract:
   - make recovery guidance avoid duplicating a side already present in
     `body_site`;
   - make Character UI render derived `general` as `全身`;
   - update focused guidance/projection/UI tests.
3. Fix the popup clipping:
   - update the health popover/source-menu CSS and its framework reference;
   - add a CSS contract regression while preserving delegated close behavior.
4. Synchronize affected Markdown contracts and inspect the final diff for
   scope drift.
5. Run verification:
   - `node --check` for changed JavaScript;
   - focused Event, Health Assessment/Evolution, Recovery Guidance,
     Projection Context, and Phase 2A UI tests;
   - `npm run check` and `npm test`;
   - `git diff --check`;
   - real-host smoke check at Desktop, Tablet/iPad, and Mobile widths.

## Risk points

- The explicit `other_biological` vocabulary is intentionally conservative;
  any future health kind must be added to the contract and regression tests.
- UI CSS has repeated override blocks; the final computed rules must be checked
  so the Mobile fixed placement is not overwritten by a later generic rule.
- Existing stored bad Events remain until their owning Floor is reanalyzed.
