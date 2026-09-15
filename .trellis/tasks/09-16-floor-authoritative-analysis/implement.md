# Implementation Plan

## Phase 1: establish the contract

1. Confirm the requested source files, existing domain specs and reference
   snapshot have been read; record the current test baseline.
2. Create the single detailed Floor State Ownership spec and update its domain
   navigation and cross-document pointers.
3. Add the concise `AGENTS.md` trigger and redlines outside the Trellis
   managed block.

Completion gate: the planning summary is presented to the user. Do not start
implementation until the user explicitly approves that summary.

## Phase 2: bounded implementation after approval

### Slice A — contract entry points

- Add `.trellis/spec/domain/floor-state.md` with all ten required sections and
  concrete references to the current storage, Floor, runtime, tracking and API
  boundaries.
- Update `.trellis/spec/domain/index.md`, `event-pipeline.md`,
  `world-model.md` and `AGENTS.md` without duplicating the full contract.

### Slice B — architecture boundary comments

- Add only short ownership/provenance comments in `storage/store.js`,
  `runtime/event-analysis.js` and `core/tracking.js`.
- Keep comments aligned with the new spec and avoid incidental cleanup or
  behavior changes.

### Slice C — executable contract

- Extend or rename focused tests in the existing runtime, storage, Floor and
  tracking suites so names state the architecture invariant.
- Cover target self-exclusion, nearest valid previous, deleted Floor/Swipe
  exclusion, active Swipe isolation, stale Version exclusion, empty previous,
  API input provenance and orphan-free derived registry state.
- Reuse existing fixtures and public abstractions. If an invariant fails for a
  reason inside the requested boundary, make only the smallest necessary
  correction and preserve unrelated business behavior.

## Phase 3: quality gates

Immediately after source/test/document changes, run repository-local Prettier
on exactly the files modified by this task. Do not continue if formatting
fails. Then run:

```text
node --test tests/runtime.test.js tests/floor.test.js tests/tracking.test.js tests/event-analysis-runtime.test.js
npm test
npm run check
```

Also check broken relative links, placeholder text under `.trellis/spec/`,
duplicate ownership wording, and the final Git diff. Do not commit or push.

## Explicit non-goals

- No disease/medication/reproduction feature implementation.
- No new permanent Floor ID database, Chat-level historical ledger or README
  architecture copy.
- No broad storage adapter, Event schema, identity, World Model or UI rewrite.
- No lifecycle correctness that depends solely on one deletion handler.

## Rollback boundary

Any rollback is limited to files changed by this task. Existing user-owned
worktree changes and unrelated task artifacts remain untouched.
