# Wave 0 Implementation Plan

## Ordered checklist

1. Read event-pipeline, floor-state, world-model and shared thinking specs before code changes.
2. Define the single new Event state-fact contract and type-specific payload validators in `core/events.js`.
3. Reuse normalized `story_time` as `effective_story_time`; do not duplicate independent dates.
4. Preserve the existing pregnancy-relevant exposure contract and ensure non-exposure `sexual_activity` remains valid without state payload.
5. Add deterministic pregnancy/reproductive episode identity handling at the Event analysis/runtime boundary using Floor Version + Event ordinal + canonical identity; no random or clock IDs.
6. Add status applicability/conflict diagnostics and duplicate Event identity validation without last-write-wins.
7. Add pure Story Time comparability and separate Story Time ordering helper; keep existing provenance `sortEvents()` unchanged unless a focused regression proves otherwise.
8. Define/export the normalized `characterFacts` DTO without making it a Tracking Registry dependency.
9. Update AI prompt/parser/normalizer, fixtures, docs and tests to the single new schema. No legacy compatibility layer.
10. Verify no `core/state.js` transition engine, Snapshot, Projection or UI State code is added.

## Expected files

- `core/events.js`
- `story/time.js`
- `ai/prompts.js`
- `ai/analyzer.js`
- direct Runtime normalization file only if identity binding cannot remain at the existing boundary
- focused `tests/events.test.js`, Story Time tests, runtime/event-analysis tests, tracking regressions
- `docs/DATA-MODEL.md`

## Required tests

Cover the 27 Wave 0 cases from the request: missing/valid subject and payload for every state-changing type, episode references, capability tri-state, no gender/alias inference, exposure preservation, `possible_conception` separation, Story Time comparability, deterministic ordering, duplicate identical/conflicting IDs, Tracking/Floor/Swipe/Chat/event lifecycle regressions.

## Validation gate

- `node --check` for every changed JavaScript module.
- Focused Event, Story Time, Tracking, Floor and Runtime tests.
- `npm run check`.
- `git diff --check`.
- Inspect final diff to confirm `core/state.js`, Snapshot, Projection and UI State remain outside the implementation.

## Rollback boundary

Only Wave 0 contract files and their tests/docs may be changed. Do not reset or restore unrelated work. If current code cannot represent a requested type without guessing, stop and report the schema blocker instead of adding fallback behavior.
