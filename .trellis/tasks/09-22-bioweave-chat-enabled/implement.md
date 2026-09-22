# Implementation Plan

1. Establish the current Chat enabled read/write contract and normalization.
   Verify missing values resolve to `true`, explicit `false` round-trips in
   Chat metadata, and no Character Card/global registry path is touched.
2. Add the Runtime master guard and disabled result semantics at lifecycle,
   scheduler, manual/programmatic analysis, tracking, snapshot, projection
   generation/evidence, and API side-effect boundaries. Extend existing
   abort/epoch/Floor-Version commit checks with enabled revalidation.
3. Integrate Projection Context clearing and refresh gating. Verify disable
   clears `bioweave_projection_context`, disabled lifecycle refresh stays clear,
   and enable does not create disabled-period backlog.
4. Add the header control and Settings binding using the same Chat setting;
   wire pause confirmation, accessible labels/status, and disabled manual
   refresh behavior while following existing host Popup/Toast conventions.
5. Add focused regressions for storage/lifecycle scope, all automatic pipeline
   guards, manual refresh, Projection Context, history preservation, UI state,
   and late async commit.
6. Update event-pipeline/runtime/settings/UI specs and lifecycle docs with the
   Chat-local master-switch contract.
7. Run `npm test`, `npm run check`, `node --check` for every changed JS file,
   and `git diff --check`; inspect the final diff for unrelated changes and
   record real-host Desktop/Tablet/Mobile acceptance still pending if not run.

## Risk / rollback points

- Before edits: record `git status` and preserve the 15 existing worktree
  changes.
- After storage/runtime guard: run focused runtime tests before touching UI.
- After UI: run focused UI/projection tests and inspect responsive selectors.
- Do not commit or push without a separate explicit authorization.
