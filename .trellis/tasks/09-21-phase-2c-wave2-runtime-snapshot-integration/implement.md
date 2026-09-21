# Implementation Plan

1. Re-read current Runtime/Storage code and Wave 1 Snapshot contract; preserve existing uncommitted Wave 1 changes.
2. Add Runtime Snapshot candidate selection and strict post-checkpoint Event boundary to `collectCurrentDerivedState()`.
3. Add post-success checkpoint creation with `shouldSnapshot()`, current state, current Story Time/facts, idempotence, and Chat/Floor Version guards.
4. Clear Snapshot on same-version authoritative Event replacement/edit/delete paths.
5. Update reducer base-state fact refresh only where required for current `characterFacts` correctness.
6. Add Runtime integration tests for all requested fallback, deletion, Swipe, Chat, User, idempotence, read-only, time, facts, and 500+ Event cases.
7. Run `node --check` for all modified JS, focused Runtime/State/Snapshot tests, `npm run check`, and `git diff --check`.
8. Review diff for forbidden Projection/pregnancy/UI/runtime-scope expansion and stop at Wave 2.
