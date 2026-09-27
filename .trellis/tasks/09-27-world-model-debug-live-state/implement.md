# Implementation Plan

## Phase 1 — exact seam confirmation before edits

- [x] Re-read current `AGENTS.md`, relevant domain/frontend specs, and task artifacts.
- [x] Confirm exact runtime factory/module that owns `getPersistenceTrace`, `resolveWorldModelAtOrBefore`, current Floor read, and World execution callbacks.
- [x] Confirm Settings Popup action paths for open, refresh, copy, and any export path; preserve existing popup hooks and visual framework.
- [x] Confirm no current retained runtime model/candidate exists beyond transient analysis return values; choose `unavailable` vs minimal transient diagnostic retention without persistence.

## Phase 2 — pure diagnostic primitives

- [x] Add deterministic canonical stringify/fingerprint helper using the existing SHA-256 utility.
- [x] Add generic model projection: presence, counts, address inventory, and optional field summaries.
- [x] Add layer comparison and address diff helpers with `MATCH` / `MISMATCH` / `UNAVAILABLE` semantics.
- [x] Unit-test key ordering, array order, null/unavailable, false capability, generic identities, and non-mutation.

## Phase 3 — live collection and runtime/UI seams

- [x] Add read-only runtime diagnostic access for latest World execution/fact-delta state and authoritative Floor read; retain no persistent candidate/snapshot.
- [x] Add `collectWorldModelLiveState()` at the Settings action boundary with snapshot ID/timestamps, target-before/after, one retry maximum, and safe Floor error reporting.
- [x] Record last World render diagnostic at the point where `render()` consumes current `worldModelState`; include canonical/ViewModel identity and counts.
- [x] Ensure collector cannot call analysis, `saveWorldModel`, `commitFloorPatch`, `store.saveFloor`, or UI repair.

## Phase 4 — Settings output wiring

- [x] Add an independent `WORLD MODEL LIVE STATE` block before `HISTORY TRACE`.
- [x] Make open/refresh/copy/export paths collect afresh; avoid caching the live snapshot in app state between actions.
- [x] Preserve existing analysis preview and trace output, adding explicit source/capacity/truncation metadata.
- [x] Keep output bounded: hashes, counts, addresses, and field summaries only; no full World Model dump.

## Phase 5 — focused regression and static boundaries

- [x] Add Tests A–H from the PRD with abstract fixtures and writer spies.
- [x] Extend direct-writer/static gate coverage for new modules and UI code.
- [x] Run `node --check` for every changed JS file.
- [x] Run focused debug/settings/UI, World runtime, Floor coordinator, and direct-writer tests.
- [x] Run `npm run check` and `git diff --check`.
- [x] Review actual diff for forbidden business/persistence changes and update docs/spec markdown required by the repository.

## Review gates / rollback points

- Gate 1: no implementation until runtime/UI seams and read-only API are confirmed.
- Gate 2: pure helper tests pass before UI wiring.
- Gate 3: collector tests prove unchanged Runtime/Floor/UI and no writer calls.
- Gate 4: full checks pass; any observed World/UI mismatch is reported only, not repaired.
- If a seam requires changing business semantics or persistence architecture, stop and return to planning rather than expanding scope.

## Required final handoff

- Do not commit or push.
- Report branch/HEAD/pre-existing changes, old/new data flows, fingerprint semantics, freshness/race handling, cross-layer diagnostics, read-only proof, Floor architecture proof, modified files, commands/results, and remaining findings.
