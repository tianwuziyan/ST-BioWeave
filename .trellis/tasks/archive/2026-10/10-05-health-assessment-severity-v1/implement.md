# Implementation plan

1. Re-read current Health Assessment, analyzer prompt, runtime coordinator,
   Evolution, storage default and focused tests; confirm dirty documentation changes
   are preserved.
2. Add v2 severity constants, legacy-aware normalization/validation, and timeline
   compatibility without changing fingerprint/request key.
3. Add severity to the existing Health Assessment prompt and preserve one-pass
   analyzer behavior.
4. Add minimal runtime v2 write wiring and Evolution passthrough with legacy unknown.
5. Add focused tests for schema values, malformed downgrade, v1 compatibility,
   prompt contract, no extra call, independence from recovery/persistence,
   Evolution passthrough/lifecycle, identity invariants, and invalidation.
6. Synchronize only affected Markdown/spec docs; explicitly retain Deferred and
   withdrawn architecture boundaries.
7. Run focused tests, broader test command from package scripts, `node --check` on
   changed JavaScript, `git diff --check`, and inspect `git diff`/status for scope.

## Verification commands

- `cat package.json` to identify repository test/check scripts
- focused Health Assessment and Evolution tests
- broader repository test/check script(s)
- `node --check` for changed JavaScript files
- `git diff --check`
- `git status --short` and targeted `git diff`

## Rollback points

- Core schema/normalization changes are isolated from Event factual code.
- Prompt changes are limited to the existing Health Assessment builder.
- Evolution change is a single DTO passthrough.
- If legacy item distinction cannot be preserved without rewriting old data, stop and
  report the compatibility blocker rather than weakening the no-backfill contract.

## Completion record

- Implementation complete.
- Regression attribution: PASS.
- Health Assessment Severity v1: CLOSED.
- Health focused tests: 28 passed.
- Broader controlled tests: 106 passed.
- `node --check`: passed.
- `git diff --check`: passed.
- Full `npm test` did not produce a clean pass; observed failures were attributed to HEAD
  baseline failures or existing long-running/long-resident `event-analysis-runtime` behavior,
  with no evidence of a severity v1 regression.
- Future severity UI, functional impact, overall health, severity aggregation, Recovery
  Guidance coupling, confidence/rationale, and critical/triage semantics are independent
  future tasks.
