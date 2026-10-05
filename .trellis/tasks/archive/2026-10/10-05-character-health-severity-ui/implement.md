# Implementation Plan

1. Add the minimal pure severity presentation ranking in
   `core/health-aggregation.js`; keep grouping, source IDs and observation
   lifecycle unchanged.
2. Add `severity_summary` to the character-level derived read model in
   `core/health-evolution.js` only for characters with active observations.
3. Update `ui/characters.js` to consume the field and map it to the existing
   “总体状态” text, preserving unavailable and no-entry behavior. Do not add
   local ranking or new UI sections.
4. Extend `tests/health-evolution.test.js` and the existing Character Health UI
   test file with all requested ranking, inactive, legacy, unavailable, source
   navigation and no-English-token cases.
5. Synchronize `docs/CHARACTER-HEALTH-STATE.md`, `docs/UI.md`,
   `docs/ARCHITECTURE.md`, and `docs/PROJECT-STATE.md` to describe the
   presentation-only summary and retain full overall health as Deferred.
6. Run focused tests, broader controlled tests, `node --check` for changed JS,
   `git diff --check`, and inspect the final diff for forbidden authority or
   scope expansion.

## Risk points

- Do not use `overall_health` as the DTO field name.
- Do not make the presence of an active character entry depend on a new
  severity value; active/inactive lifecycle remains the existing Evolution rule.
- Do not make missing severity turn a ready health issue into “正常”.
