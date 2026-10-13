# Implementation plan

## Before activation

- [x] Read repository `AGENTS.md`, runtime architecture and Floor ownership/lifecycle contracts.
- [x] Inspect real Debug without exposing prompt text, story正文, credentials or API secrets.
- [x] Confirm parser and Runtime seams, existing continuation tests, and current uncommitted worktree.
- [x] Review this final plan before activating the task.

## Ordered work

1. [x] Reproduce the two validation failures with a minimal analyzer mock response; record the exact raw shape only as safe field names in tests.
2. [x] Implement the smallest protocol-boundary fix, if and only if the raw shape is unambiguous; preserve strict top-level and Event-field validation.
3. [x] Add analyzer-path tests for legal continuation metadata, legal Event `state_fact`, top-level invalid fields, and metadata stripping at persistence.
4. [x] Run targeted Event analyzer/runtime tests and inspect the diff for forbidden Schema/Prompt/Scheduler/UI changes.
5. [x] Run `npm run check` and `git diff --check`.
6. [x] Re-read affected Markdown/spec documents and update only if the final protocol contract changed.
7. [x] Report the UI first-open static trace analysis and next minimal profiling/fix proposal; stop for real ST validation.

## Risk gates

- Stop before code if accepting the real top-level shape would require treating arbitrary unknown fields as valid or changing persistence Schema.
- Stop before code if analyzer tests cannot reach the same parser seam as the real `createAnalyzer` path.
- Do not edit `runtime/event-analysis.js` canonical in-flight logic, UI refresh orchestration, Scheduler, Projection sorting, continuation matching semantics, or Snapshot/Event Schema.

## Verification commands

```sh
npm run check
git diff --check
```

Targeted checks may use `node --test tests/event-analysis.test.js tests/event-analysis-runtime.test.js` before the full check.
