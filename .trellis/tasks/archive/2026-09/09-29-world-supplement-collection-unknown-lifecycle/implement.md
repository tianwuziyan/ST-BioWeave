# Implementation Plan

## Phase A — audit and baseline

1. [x] Record current git status and preserve all existing changes.
2. [x] Read the Floor State Ownership, World Model, Architecture, lifecycle, and local
   layer specs before editing production code.
3. [x] Trace and document the Supplement call graph and mutation matrix.
4. [x] Inventory legacy helpers/constants/tests by Full/Supplement call site.
5. [x] Run targeted baseline tests and record the known stale failures without fixing
   unrelated UI/prompt drift.

## Phase B — protocol and deterministic mutation

1. [x] Add the smallest validated resolution declaration/binding contract to the JSON
   parser and diagnostics.
2. [x] Reuse or formalize deterministic canonical identities for Special_Rule,
   Exception, and Unknown; preserve existing order and response append order.
3. [x] Implement Unknown queue reduction in the transient snapshot: accepted resolving
   Fact first, then per-item removal; rejected/no-evidence/no-op remains.
4. [x] Remove/bypass `v2SortAppendedEntries()` for Supplement collection mutations.
   Preserve existing Special_Rule and Exception order exactly, append accepted
   unique items at the tail in response order, and add explicit `[A, B] + C →
   [A, B, C]` regressions. Do not alter scalar `SET_FIELD` replacement.
5. [x] Verify Cycle → reproduction_rules.cycle and all 14 nested scalar regressions
   before moving on.

## Phase C — Supplement prompt and guard cleanup

1. [x] Update the final `buildWorldModelPatchMessagesV2()` user payload and system task
   so Existing Unknowns and resolution binding are explicit in the one request.
2. [x] Split/remove Supplement legacy field-specific semantic reclassification as a
   formal cleanup deliverable, while retaining structural/address/scope/evidence-
   boundary safety and Full behavior. Prove Supplement JSON Facts no longer enter
   `patchFactEvidence()` or field-specific capability/reproduction/lifecycle regex
   classification; close the temporary `structuredFactDelta` branch where safe.
3. [x] Rename/remove misleading Supplement diagnostics and stale comments/contracts;
   migrate tests to structural Fact safety rather than old regex implementation
   details, while keeping Full-only semantic guard tests explicitly classified.

## Phase D — tests and spec

1. [x] Add generic Special_Rule, Exception, Unknown lifecycle, partial resolution,
   resolution rejection, existing-order/tail-append, and snapshot persistence
   tests.
2. [x] Add final-message parity tests for Existing Unknowns, resolution task, JSON
   contract, role topology, and no semantic continuation call.
3. [x] Update `.trellis/spec/domain/world-model.md` with the four mutation classes,
   Unknown lifecycle, identity/binding, and one-commit atomicity.

## Phase E — verification gates

Run, in order as applicable:

```text
node --check <every changed JS>
node --test tests/world-model.test.js
node --test tests/api-profile.test.js
node --test tests/world-model-debug.test.js
node --test tests/event-analysis-runtime.test.js
npm test
git diff --check
```

Compare failures with the documented 35-failure baseline; new tests must all pass
and unexpected new failures must be zero. Report real SillyTavern smoke separately
as executed or `NOT EXECUTED`.

## Verification result

The requested targeted suites pass. `npm test` was rerun after a transient
flaky run and ended at 1125 tests / 1090 pass / 35 pre-existing failures; the
8 tests added by this task pass and unexpected new failures are zero. Real
SillyTavern smoke was not executed.

## Rollback points

- Before production edits: task docs and audit only.
- After protocol/merge edits: run world-model targeted tests and inspect only the
  task diff.
- After guard split: run Full and Supplement guard tests independently.
- Before final report: inspect `git status`, `git diff`, changed-file syntax, and
  persistence call count tests. Never use reset/clean/checkout to recover.
