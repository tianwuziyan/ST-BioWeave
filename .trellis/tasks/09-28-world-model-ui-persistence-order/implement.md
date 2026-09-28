# Implementation plan

1. Read the current task artifacts/specs again immediately before coding; confirm
   `ai/prompts.js` remains the only pre-existing unrelated worktree modification.
2. Add the smallest Runtime candidate revision/pending state to
   `runtime/world-analysis.js`, reusing `fingerprintWorldModel()` and existing
   target/token helpers. Publish candidate notification before any save.
3. Add exact ACK validation, supersession and idempotency in the same Runtime World
   ownership boundary. Keep `saveWorldModel()` as the only World persistence entry
   and leave the coordinator unchanged.
4. In `ui/app.js`, implement candidate adoption as an application-state-only helper;
   wire manual `result.model` and automatic candidate notifications through it,
   including non-World routes. Keep normal authoritative reload as a separate path.
5. Guard reload application with the existing generation/token state and record a
   suppression diagnostic when a newer adopted candidate exists. Remove only the
   analysis-success reload behavior that duplicates candidate delivery.
6. Extend the existing diagnostics/trace allowlist and LIVE STATE projection with
   candidate revision, adoption, persistence and reconciliation facts. Preserve
   `WORLD_UI_RENDERED` as render-only telemetry.
7. Add focused tests for T1-T15. Use Species-A/Species-B and Type-A/Type-B/Type-C
   fixtures only; do not alter World schema or Evidence Guard tests.
8. Run focused World/UI/runtime tests, `node --check` on every changed JS file,
   `npm run check`, `git diff --check`, and inspect the final diff/status.

## Review gates

- Before product edits: confirm no coordinator/floor-persistence changes are needed.
- After Runtime edits: assert no path calls `saveWorldModel()` before exact UI ACK
  except explicit non-analysis manual editor saves, which remain separate behavior.
- After UI edits: grep for `commitFloorPatch`/`store.saveFloor` in `ui/app.js` and
  verify candidate adoption does not call either or reload Floor.
- Before reporting completion: verify all T1-T15 outcomes and that the only pre-task
  worktree change remains `ai/prompts.js`.

## Verification commands

```sh
npm run check
node --check runtime/world-analysis.js
node --check runtime/events.js
node --check runtime/diagnostics.js
node --check ui/app.js
node --check utils/world-model-debug.js
node --check runtime/floor-persistence.js
node --check storage/floor-persistence-coordinator.js
node --test tests/phase2a-app.test.js tests/ui.test.js tests/event-analysis-runtime.test.js tests/world-model-debug.test.js
git diff --check
git status --short
```

No commit, push, reset, clean, checkout, or destructive rollback is permitted.
