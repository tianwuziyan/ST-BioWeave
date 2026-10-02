# Implementation Plan: PRE-CONFIRMATION TRACKING WINDOW PHASE 1

## Preconditions

- Preserve existing uncommitted worktree changes; inspect diff before touching overlapping docs/tests.
- Before product edits, load `trellis-before-dev` and the relevant domain/frontend spec indexes again.
- Do not modify known-good persistence transport behavior except the narrow owner/field allowlist needed by the new domain.

## Ordered checklist

1. Add pure `core/tracking-window.js` with schema validation, normalization, deterministic cycle/window binding, compatible basis grouping, terminal transition reducer, source validity filtering, and open-window view.
2. Add Window timeline normalization/reducer and Floor storage adapter; extend `emptyFloor()`, lifecycle registry, clear allowlists, and coordinator owner allowlist with independent `tracking` ownership.
3. Add `runtime/tracking-window-runtime.js`; wire active Floor/Swipe/version collection, authoritative readback, stale guards, rebuild/reload, and event edit/delete refresh.
4. Integrate Window view into Tracking Core/Runtime while preserving `true/null/false` capability semantics and dropping closed-window exposure from pre-confirmation active registry.
5. Bind Window cycle ID to existing Timing cycle ID/predicate; prove additional basis does not resample or mutate frozen Timing fields.
6. Add the narrow pre-confirmation Projection Eligibility bridge; preserve future pregnancy-stage rule evaluation and Context isolation.
7. Add Characters read-model compatibility for active factual Pregnancy Episodes without changing page design or raw/debug data exposure.
8. Add focused tests for all 20 core semantics plus runtime/persistence, event edit/delete, reload/Swipe/Chat isolation, timing non-resampling, projection bridge, and Characters regression.
9. Run targeted suites, `npm run check`, `git diff --check`; record unrelated flaky/World signature failures without chasing them.
10. Review actual diff, update `docs/PROJECT-STATE.md`, `docs/ARCHITECTURE.md`, `docs/DATA-MODEL.md`, `docs/bioweave-data-lifecycle.md` if field registry details require it, and relevant `.trellis/spec/domain/*` to say `PARTIAL / PHASE 1 IMPLEMENTED` with Phase 2 boundaries.

## Validation commands

```bash
node --test tests/tracking-window.test.js
node --test tests/tracking.test.js tests/projection-timing.test.js tests/projection-eligibility.test.js tests/projection-runtime.test.js
node --test tests/state.test.js tests/floor-persistence-coordinator.test.js tests/event-analysis-runtime.test.js
npm run check
git diff --check
git status --short
```

## Risk gates

- After core implementation: pure tests must prove no Window-created factual pregnancy or negative fact.
- After persistence wiring: verify owner whitelist, sibling preservation, authoritative readback, stale Floor Version, active Swipe, Chat isolation.
- After Tracking integration: verify source deletion and terminal filtering do not delete Registry/Event/Episode history.
- After Projection bridge: verify Window is not in Context and Projection cannot close Window.
- Before completion: inspect every changed Markdown against final implementation and report any real-host acceptance still pending.

## Rollback points

- Core/window tests fail → revert only new Window core/timeline files.
- Persistence owner tests fail → remove only the new owner/field patch while retaining pure core tests; do not reset existing worktree.
- Cross-layer regression → disable Window input at Tracking/Projection bridge and preserve factual/Event/Timing paths for diagnosis.

## Completion gate

Do not commit or push. Report the final `TRACKING_WINDOW_CONTRACT`, implementation map, changed files, test results, semantic guards, documentation status, remaining risks, and whether the next blocker is World-authoritative horizon Phase 2.
