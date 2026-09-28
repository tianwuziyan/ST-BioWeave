# Technical design

## Boundary and current gap

当前 authoritative reload 是 `ui/app.js` 的 Floor reader/view-model builder；
candidate delivery 却同时由手动 `analyzeWorldModel()` 的直接 state assignment
和成功 status event 的 reload 承担。Runtime analysis 当前在
`runtime/world-analysis.js` 内先持久化，再读取 Floor，因此不能以
`resolveWorldModelUiReady()` 证明 exact candidate adoption。

最小修复是保留两个现有边界并增加一个窄的 transient handshake：

```text
validated candidate
  -> Runtime candidate revision + notification
  -> UI adopt exact candidate into worldModelState
  -> Runtime exact ACK validation/idempotency
  -> existing saveWorldModel
  -> existing commitFloorPatch(owner="world") / coordinator
  -> authoritative readback
  -> UI/Floor reconciliation
```

## Proposed ownership

- `runtime/world-analysis.js` owns pending candidate lifecycle, execution/revision
  validation, ACK completion and persistence sequencing.
- `runtime/events.js` exposes the narrow Runtime ACK boundary and continues to publish
  diagnostics/traces through existing notification machinery.
- `ui/app.js` owns candidate adoption into `worldModelState`; it never writes Floor,
  calls `commitFloorPatch`, or rereads Floor during adoption.
- `reloadWorldModelFromRuntime()` remains the authoritative reader. Its existing
  in-flight/loading/key/generation controls remain scoped to reload only.
- `utils/world-model-debug.js` remains the canonical fingerprint implementation.
- `runtime/diagnostics.js` and existing `recordPersistenceTrace()` receive only the
  additional candidate/reconciliation fields and stages needed to explain the flow.
- `storage/floor-persistence-coordinator.js` remains unchanged and sole coordinator.

## Candidate revision and ACK

For each accepted analysis result, Runtime computes the existing deterministic
fingerprint and creates an in-memory revision containing execution id, full
fingerprint (with short fingerprint for diagnostics), Chat id, target Floor version,
candidate model and state. Publishing a newer candidate marks the older pending one
superseded. The revision is never included in `floor_transaction_id` or
`transaction_key`.

The UI adoption result carries execution id, candidate full fingerprint and target
Chat/Floor identity. Runtime rejects missing/mismatched values with a revision
mismatch/stale-chat error. A repeated ACK for an already adopted/persisted revision
returns the existing result and does not re-enter `saveWorldModel()`.

## Reload race protection

Reload captures the current Chat token, load generation and candidate adoption sequence.
Before applying its result it verifies all three and checks whether a newer candidate
was adopted after the reload began. If so, the readback is not assigned to
`worldModelState`; it records the existing reload trace with a suppression reason.
This preserves the current reload behavior for normal lifecycle refreshes while
preventing an old C1 Floor response from replacing adopted C2.

## Canonical no-op and reconciliation

The current canonical comparison remains before the actual Floor write. A candidate
equal to the current authoritative World model is still adopted into UI state, but
does not invoke `saveWorldModel()`. For a real write, Runtime waits for coordinator
confirmation/readback, fingerprints the authoritative `world_model`, and compares it
to the adopted candidate. Equal fingerprints emit reconciliation confirmed; mismatch
emits an explicit diagnostic and does not silently claim success or overwrite the UI
candidate.

## Compatibility and rollback

Manual Full/Patch keeps its existing public Runtime analysis methods. The change only
adds the candidate result/event/ACK handshake and routes existing calls through it.
Existing route/lifecycle reload entry points remain available. If the handshake fails,
the candidate stays transient and no Floor mutation occurs; the prior authoritative
Floor remains intact. The pre-existing unrelated `ai/prompts.js` worktree change is
outside this task and must remain untouched.

## Files expected to change

- `runtime/world-analysis.js`: candidate revision state, notification/ACK facade,
  gated persistence, no-op/readback reconciliation.
- `runtime/events.js`: expose the Runtime ACK boundary and trace fields if needed.
- `ui/app.js`: candidate adoption helper, manual/automatic delivery wiring, reload
  generation guard and removal of success-event candidate reload.
- `runtime/diagnostics.js`: allow/shape candidate and reload suppression diagnostics.
- `tests/phase2a-app.test.js`, `tests/ui.test.js`, and/or
  `tests/event-analysis-runtime.test.js`: focused T1-T15 regressions using spies and
  deterministic deferred reloads.
- `tests/world-model-debug.test.js` only if the existing LIVE STATE snapshot needs
  a focused assertion; no second debug system.

`storage/floor-persistence-coordinator.js` and `runtime/floor-persistence.js` are
read-only review targets for this task and are not expected to change.
