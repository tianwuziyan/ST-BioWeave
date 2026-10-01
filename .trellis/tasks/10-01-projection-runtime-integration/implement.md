# Projection Runtime Integration Implementation Plan

## Phase 1 — Runtime owner, read path, and deterministic decisions

1. Load current derived factual inputs and authoritative Floor/Swipe owner.
2. Add execution identity and per-identity single-flight.
3. Implement read views, evolution, terminal lifecycle persistence, reread, and eligibility.
4. Add Projection-specific status/activity without changing `event_analysis` semantics.
5. Test no-op decisions, terminal handling, duplicate execution, same-Floor reread, and active Swipe isolation.

## Phase 2 — Generation and persistence

1. Adapt analyzer `generateProjection` to `generateProjectionCandidate`.
2. Schedule eligible decisions serially and deterministically.
3. Apply pre/post/persistence stale guards.
4. Save candidates through the existing facade and reread views.
5. Test valid generation, invalid/raw failures, stale AI results, partial success, persistence failure, and terminal dedupe.

## Phase 3 — Runtime DTO, Context, and business data

1. Map resolved views to Runtime DTOs and active/recent summaries.
2. Expose DTOs through `collectActiveBusinessData()` and Projection Refresh without generation on read.
3. Enforce same-Floor Context temporal boundary and refresh only from persisted views.
4. Test DTO reads, no-AI reads, Context, and circular-feedback prevention.

## Phase 4 — Minimal UI

1. Replace the Projection placeholder with the DTO consumer.
2. Add refresh and existing append-only delete wiring where the current route supports it.
3. Add Overview active/recent summary only.
4. Test that UI performs no business calculation or direct storage/AI access.

## Phase 5 — Verification and documentation

1. Run targeted Projection/Core/Runtime/UI/Snapshot/Persistence tests after each phase.
2. Run `git diff --check`.
3. Run `npm run check` with zero failures/skips/todos and no focused-test bypasses.
4. Review and synchronize authoritative Markdown only after implementation facts are verified.

## Risk / rollback points

- High-risk files: `runtime/events.js`, `runtime/event-analysis.js`, `runtime/projection-context.js`, `ui/app.js`.
- Do not alter `storage/projection.js` or Projection Core unless direct evidence proves a frozen contract gap.
- If the Context boundary cannot be implemented without changing factual input ownership, stop before expanding scope.
- Preserve the clean baseline and review `git diff` after each phase.
