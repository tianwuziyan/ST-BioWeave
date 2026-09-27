# Implementation Plan

1. Extend the existing Identity Discovery Review grammar and prompt with diversity count and exhaustive sibling/additional-Type search fields.
2. Add host-observed identity reconciliation and fail-closed count mismatch diagnostics without bypassing resolver or Evidence Guard.
3. Reuse the current retry wrapper to carry the complete Existing/evidence context and review/coverage diagnostics across attempts.
4. Recompute coverage targets against accepted transient candidates for post-response completeness diagnostics without driving a normal second semantic API request.
5. Add recent execution/per-subject sibling diagnostics and focused regressions for one existing Type with/without sibling, 3/4 open-string Types, zero Types, majority wording without an explicit sibling, explicit sibling Facts, count mismatch, rejected siblings, multiple existing Types discovering another, and retry exhaustion.
6. Run the existing and new focused tests, syntax checks, `npm run check`, and `git diff --check`; leave changes uncommitted and unpushed.

## Audit baseline

- `runtime/event-analysis.js::runAnalysisStageWithRetry` owns the configured retry budget and retries analyzer/completion failures without a second Supplement-specific loop.
- `runtime/world-analysis.js` sends the complete Existing/candidate context to the single semantic request and uses post-response target recomputation only for diagnostics; malformed/stage recovery remains under the shared retry wrapper.
- `ai/world-supplement-protocol.js` currently validates exact review IDs and EMITTED/NO_EVIDENCE mappings, but Identity Review has no diversity fields and coverage targets are computed only from the attempt's initial Existing model.
- `ai/analyzer.js` resolves and guards Facts after parser validation; accepted patch operations are the only source allowed to change the candidate canonical model.
