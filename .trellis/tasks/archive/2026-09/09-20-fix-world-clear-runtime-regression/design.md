# Technical Design

## Change boundary

Smallest behavior gap: World clear must distinguish a confirmed host save from
an ambiguous/failed save, and any pre-commit Runtime invalidation must be
recoverable. The behavior lives at the storage commit boundary and Runtime
clear completion boundary, not in the UI toast copy.

Expected files, subject to evidence:

- `storage/clear.js`: commit-state interpretation, current-owner verification,
  rollback/recovery behavior.
- `runtime/events.js`: SillyTavern adapter save contract and clear completion
  recovery wiring.
- `runtime/event-analysis.js`: clear invalidation/rebuild only if required by
  the diagnosed half-failure.
- `ui/app.js`: only if the diagnosed result contract requires a narrow UI state
  correction; no copy redesign.
- focused tests in `tests/storage-clear.test.js`, `tests/runtime.test.js`,
  `tests/event-analysis-runtime.test.js`, and/or `tests/ui.test.js`.

## Data flow

```text
UI clearWorldData
  -> Runtime clear facade
  -> Clear Service plan (world_model, world_model_meta only)
  -> pre-commit invalidation
  -> exact message/Swipe Floor mutation
  -> SillyTavern saveChat adapter
  -> explicit result or verified in-memory/host state
  -> confirmed / failed / unknown
  -> Runtime reload/rebuild or rollback
  -> UI success / failure toast
```

World Model re-analysis must follow:

```text
confirmed clear
  -> valid unchanged Floor Version
  -> refreshed Runtime state
  -> new World Model request
  -> save world_model + world_model_meta only
```

## Contract decisions

- `undefined` is not globally treated as success. The SillyTavern adapter may
  normalize a host void save to confirmed only after the host call returns
  normally and the clear path verifies the expected owner mutation remains in
  the current host state.
- Explicit failed/unknown result, thrown write error, owner mismatch, epoch
  mismatch, or failed post-write verification remains non-success.
- Failed clear must restore/reload Runtime state before returning, while the
  durable result remains failed/unknown.
- World clear never changes Floor Version because output fields are excluded
  from the six-field owner/input identity.

## Risks and rollback

- The existing worktree contains the prior Data Management phase changes. Do
  not revert unrelated changes. Review only the regression patch against that
  baseline.
- If host post-write verification is unavailable, preserve unknown state rather
  than claiming success.
- Keep existing owner/revision/epoch/rollback guards and extend tests around
  them instead of replacing them.
