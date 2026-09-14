# Implementation Plan

The user approved the planning summary and the task is now in Phase 2
(`in_progress`). The implementation below is limited to the approved TRACE,
tests, and verification scope.

## Ordered work

1. Re-read the current client, Analyzer, Runtime, UI, and test sections at the
   implementation boundary; confirm the line anchors in `design.md` and record
   any drift before editing.
2. Load the repository `trellis-before-dev` guidance for the affected `ai`,
   `runtime`, `ui`, and test layers. Preserve the current lightweight module
   structure.
3. Add the gated metadata TRACE helper and client checkpoints in
   `ai/client.js`. Keep the existing `json()`/`text()`/reader selection,
   timeout, AbortSignal, retry, and error paths byte-for-byte in behavior.
4. Add Analyzer parser checkpoints in `ai/analyzer.js`, with safe structural
   metadata only. Do not change `responseText()`, JSON candidate recovery, or
   World/Event schema validation.
5. Add Event Runtime and World Model UI terminal checkpoints in
   `runtime/event-analysis.js` and `ui/app.js`. Do not alter persistence,
   notification, cancellation, or stale-chat behavior.
6. Add focused response-shape and trace-capture tests in the existing test
   files. Any currently failing behavior must be represented as an explicit
   diagnostic expectation and reported; do not modify production code solely
   to make the new test green.
7. Run targeted tests for `tests/api-profile.test.js`,
   `tests/world-model.test.js`, `tests/event-analysis.test.js`, and
   `tests/event-analysis-runtime.test.js`; then run `npm run check` and
   `git diff --check`.
8. Run a source audit for forbidden sensitive logging (`api_key`,
   `Authorization`, prompt/content serialization, and raw response logging),
   inspect the actual diff, and verify that only task-scoped files changed.
9. Prepare the final diagnostic report with the complete call chain, three
   probability-ranked breakpoints, checkpoint list, real-host reproduction
   instructions, requested log fields, test results, and explicit unresolved
   host-validation scope.

## Validation commands

```bash
npm test -- tests/api-profile.test.js
npm test -- tests/world-model.test.js
npm test -- tests/event-analysis.test.js tests/event-analysis-runtime.test.js
npm run check
git diff --check
git status --short
```

The repository's `npm test` script expands `tests/*.test.js`; if the argument
form above is not honored by Node's test runner, run the direct equivalent:

```bash
node --test tests/api-profile.test.js tests/world-model.test.js tests/event-analysis.test.js tests/event-analysis-runtime.test.js
```

## Review gates and rollback points

- Gate A: planning approval has been received; source edits remain limited to
  the approved diagnostic scope.
- Gate B: after client instrumentation, verify no body method is called by a
  TRACE helper and existing client tests still pass.
- Gate C: after Analyzer/Runtime/UI instrumentation, verify all logs are
  disabled by default and contain only metadata.
- Gate D: review the full diff against the user constraints before any real
  host test.
- Rollback is limited to this task's TRACE calls, logger helper, new tests,
  and task artifacts. Do not restore or reset unrelated work.

## Not included

No transport migration, API Profile/Secret Store change, Prompt/schema/parser
change, timeout-default change, refactor, commit, push, merge, or root-cause
fix is planned in this task.
