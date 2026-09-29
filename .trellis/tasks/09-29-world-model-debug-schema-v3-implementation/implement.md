# Implementation Plan

1. Re-read current AGENTS/spec boundaries and capture clean baseline: status, diff, focused tests, full test identity.
2. Search all producers/consumers for v2 keys, final-result/persistence fields, mutation UI projection, candidate model, and continuation wording.
3. Update the single debug schema version source and diagnostics producers/serializers/allow-lists. Preserve accounting array behavior and calculations.
4. Remove stale `mutation_ui_projected` only after producer count and consumer migration are proven.
5. Bound `latest_nonempty_fact_delta` candidate diagnostics without changing current candidate persistence flow.
6. Update Debug UI labels/preview and world-model diagnostics spec.
7. Add/update semantic tests for dynamic accounting, result ownership, persistence ownership, stale field absence, and candidate semantics.
8. Run syntax checks, focused tests, full tests, diff check, and source scans. Compare failure identity and invariance evidence.
9. Review diff for production behavior changes; report any unresolved issue instead of fixing outside scope.

Rollback points: before producer migration, before UI/spec/test edits, and after focused test verification. No commit, push, or Group A API cleanup.
