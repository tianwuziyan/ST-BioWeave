# Implementation Plan

1. Define/export the explicit health-fact kind contract and helper in
   `core/events.js`.
2. Filter invalid `other_biological` facts in `parseEventAnalysisResponse()`.
3. Guard `healthAssessmentEligibility()` with the same helper.
4. Update Event prompt core/output contracts with the non-health exclusion.
5. Add sword-resonance empty-event, fracture-preservation, prompt, and health
   eligibility regressions.
6. Run focused Event/Health tests, `node --check`, `npm run check`,
   `git diff --check`, and the full test suite.
