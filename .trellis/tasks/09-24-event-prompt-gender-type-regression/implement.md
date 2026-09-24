# Implementation plan

1. [x] Re-read current prompt and test context; capture the pre-edit diff boundary.
2. [x] Replace only the contradictory Event Analyzer authority wording and inspect all three contracts for residual contradictions.
3. [x] Add minimal prompt regression assertions for A-C/E, using wording-level contract checks rather than pretending tests can run an LLM.
4. [x] Add or tighten the existing tracking unit assertion for D; do not edit `core/tracking.js`.
5. [x] Audit the five requested commits and compare the final diff to ensure no unrelated canonical/persistence behavior changed.
6. [x] Run targeted Event/tracking tests, `node --check ai/prompts.js`, `npm run check`, and `git diff --check`.
7. [x] Update the task report and journal with root cause, commit attribution, exact prompt conflict, final semantics, runtime scope, cases, and verification.

## Review gates

- Before implementation: task is started only after the user approves the final planning summary.
- Before completion: `git diff --stat` and `git diff --name-only` must show only the authorized Prompt/tests/task-document scope; no commit/push.
- If tests reveal a Runtime failure unrelated to the requested fallback, stop and report rather than widening scope.
