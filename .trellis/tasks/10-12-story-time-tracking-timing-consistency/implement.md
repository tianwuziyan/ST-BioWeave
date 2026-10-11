# Implementation Plan

## Ordered checklist

1. Before editing, load `trellis-before-dev` and the exact domain/runtime spec indexes;
   re-check applicable `AGENTS.md`, current status, and the target-file diff.
2. Add focused Story Time tests first for era-standard comparison/difference consistency,
   time precision, Gregorian/custom calendars, mismatched eras, and fail-closed unknowns.
3. Implement the smallest `story/time.js` comparison-domain change, reusing existing parser,
   resolver, and calendar arithmetic.
4. Add Tracking Window regression fixtures for Floor 58/60/66, two subjects, equal-time
   tie-breaking, incomparable events, and unchanged historical snapshots. Implement only the
   smallest owner-local ordering/anchor fix.
5. Audit the Timing creation contract against task 10-08, projection timing tasks, specs, and
   runtime tests. If the evidence is consistent, implement only the required Runtime entrance;
   if conflicting, stop that scope and report the conflict.
6. Extend `getProjectionTimingDebug()`/existing lifecycle runtime data only with fields needed
   for the accepted contract; preserve schema compatibility and Settings UI boundaries.
7. Run focused tests for Story Time, Tracking Window, Projection Timing, Participant
   Aggregation, Projection Runtime, and relevant Event Runtime paths.
8. Run `npm run check` and `git diff --check`; inspect `git diff --stat` and the exact diff for
   unrelated changes.
9. Check affected Markdown and synchronize only authoritative docs whose behavior became
   inaccurate. Do not commit or push.

## Likely files

- `story/time.js`
- `story/calendar.js` only if existing resolver evidence requires a narrow compatibility fix
- `core/tracking-window.js`
- `core/projection-timing.js` only if a direct contract gap is proven
- `runtime/events.js`
- `ui/settings.js` only if existing debug rendering omits newly exposed fields
- focused tests under `tests/`
- affected authoritative Markdown/spec files

## Validation commands

```bash
node --test tests/story-time.test.js tests/tracking-window.test.js tests/projection-timing.test.js tests/projection-runtime.test.js tests/participant-aggregation.test.js
npm run check
git diff --check
```

Also verify the actual task/spec references and report any pre-existing failures separately
from regressions introduced by this task.

## Rollback points

- Do not alter or restore the pre-existing 44-file worktree changes.
- Stop before implementation if comparison-domain identity, unresolved anchor representation,
  or `projection_rules=[]` behavior requires a new schema or conflicts with an accepted task.
- Stop before Runtime expansion if the repository does not establish independent Exposure-owned
  Timing creation.
