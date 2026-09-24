# Phase A Diagnostics Extraction Implementation Plan

## Preconditions

- Re-read `AGENTS.md`, `.trellis/spec/domain/floor-state.md`, and relevant frontend/runtime guidance before editing.
- Confirm pre-existing worktree changes and limit the implementation diff to Phase A files.
- Do not run `task.py start` until this plan is explicitly approved.

## Ordered Steps

1. Add `runtime/diagnostics.js` with only confirmed pure helpers and the minimal `createRuntimeDiagnostics` API; verify no imports from Runtime/Analysis/Persistence coordinators and run `node --check`.
2. Wire `runtime/events.js` trace buffering/sanitization through Diagnostics. Keep `notify` subscriber/activity forwarding in Runtime and keep Floor resolver/store reads in Runtime.
3. Wire `runtime/event-analysis.js` diagnostic formatters through Diagnostics. Keep retry, generation, analysis, status, persistence, and terminal control flow in place.
4. Add or update only focused unit coverage if existing tests cannot prove extracted pure helpers; do not rewrite behavior tests.
5. Run `npm test -- --test-force-exit`, `npm run check`, `git diff --check`, `node --check` on every changed JS file, and focused Runtime/Event Analysis/persistence trace/lifecycle/UI/static-gate tests.
6. Inspect the final diff for explicit zero changes to Persistence, Generation semantics, Analysis, Tracking, Settings, UI behavior, and public Runtime API.

## Rollback Points

- Before wiring: remove only the new diagnostics module if its API cannot preserve the current contract.
- After Runtime wiring: revert only Diagnostics imports/call substitutions; preserve unrelated worktree changes.
- After Analysis wiring: same narrow rollback; preserve all business code.

## Stop Conditions

Stop and report instead of continuing if extraction requires changes to `/api/chats/save`, owner acquisition, Host-ahead bootstrap, authoritative readback, Floor Version checks, sibling audit, transaction queue, Generation settle barrier, lifecycle ordering, public Runtime API, UI data contract, or Settings schema/defaults.

No dedicated REAL-HOST F5 validation is required if these stop conditions remain untouched.
