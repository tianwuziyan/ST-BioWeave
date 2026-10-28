# Research: generation/save race in progression persistence

- Query: Diagnose `ST-BioWeave-Debug-20261028-015417.txt`'s `FLOOR_HOST_SAVE_TIMEOUT`, compare first-stage storyline persistence behavior, and identify the smallest safe fix.
- Scope: internal
- Date: 2026-10-28

## Findings

### Debug evidence

The failing run is the manual Projection refresh `projection_perf_mvqzhz5l_2`,
started at `2026-10-27T17:53:28.377Z` and ending partial at
`17:54:04.772Z` (`timing_performance_diagnostics.automatic_projection_runs`).
Its storyline progression request was already in progress when the host emitted
`GENERATION_STARTED`:

- sequence 151: progression `API_REQUEST` selected the Projection route.
- sequence 154: `CHAT_CHANGED` at `17:53:29.808Z`.
- sequence 178/179: host/runtime `GENERATION_STARTED` at `17:53:33.283Z`, creating
  `generation-2` (sequence 182).
- sequence 196: generation context refresh settled, but no final-generation
  floor was confirmed before the progression response returned.
- sequence 200/202: progression API completed and parsed as
  `validated_snapshot`.
- sequence 204 onward: the progression snapshot immediately attempted a native
  Projection Floor save while the host generation boundary was still active.
- sequence 228/229: native `saveChat()` dispatched; sequence 230 reports
  `FLOOR_HOST_SAVE_TIMEOUT`, `commit_state: unknown`, `host_chat_save_duration_ms:
  8005.5`; sequence 231 closes the Floor transaction as failed.

This is not a parser or API response-shape failure. The response was accepted,
but the write reached the host save boundary during an active generation. The
debug also shows sequence 197/198 later expiring the generation activity lease;
that is stale-generation recovery and does not prove that the host's final save
had completed before the Projection write.

### Lifecycle and concurrency path

`runtime/events.js:5593-5659` reserves the generation gate and performs a
read-only Projection context refresh for `GENERATION_STARTED`. The event then
calls `eventAnalysis.handleLifecycleEvent()` (`runtime/events.js:5770-5810`),
which creates the generation intent but does not cancel an already-running
Projection Runtime execution. The gate defers new automatic work, but it does
not stop work that was already inside `projectionRuntime.process()`.

`runtime/projection-runtime.js:1921-2012` has a single-flight map for the same
Projection execution and `runtime/projection-runtime.js:2136-2161` can cancel
an active run, but that cancellation is currently invoked by explicit
Projection refresh/stop flows, not by `GENERATION_STARTED`.

`runtime/projection-storyline-runtime.js:348-390` passes the outer execution
signal to `saveVerified()` and its Floor transaction. Therefore an active
progression generation can be safely aborted before the native host save, or
while it is waiting, provided the lifecycle boundary invokes the existing
cancellation path and waits for the run to leave the single-flight map.

### Comparison with first-stage handling

First-stage design and second-stage progression share the same safe persistence
primitive: `runtime/projection-storyline-runtime.js:221-292` performs a complete
current-Floor collection replacement, preserves siblings, and requires
authoritative readback. The first-stage path (`:520-616`) waits for design API
requests to settle, then serializes each qualified snapshot through
`saveVerified()`; it does not use an alternate write authority or a direct raw
Chat save.

The current progression path also uses `saveVerified()` (`:389`), so the data
replacement semantics are not the cause of this failure. The difference exposed
by this debug is lifecycle timing: an already-running manual/automatic Projection
execution survives a later `GENERATION_STARTED` event and reaches the same Floor
save while the host is generating. The first-stage “repeat read/write” rules
correctly cover previous-endpoint suppression, current-Floor replacement, and
single-flight/manual refresh cancellation; they do not currently provide a
generation-start cancellation hook.

### Persistence contract constraints

`.trellis/spec/domain/floor-state.md:266-282` requires the common bounded native
save barrier, forbids overlapping native saves, and treats timeout as unknown;
it does not authorize silently reporting the snapshot as persisted. The same
spec's storyline contract (`:292-372`) requires current-Floor replacement,
authoritative readback, and preserving the old progression event on failure.
`docs/bioweave-data-lifecycle.md:467-499` states that generation gates defer
business work and the final Character Floor handoff is the safe processing
boundary. The current trace demonstrates a gap between that contract and an
already-running Projection execution.

## Minimal safe fix recommendation

Reuse the existing `projectionRuntime.cancelProjectionRuns()` path at the
`GENERATION_STARTED` boundary, after the generation intent is accepted and
before any generation-boundary handoff can release deferred work. The call must
be awaited and must remain fail-closed: abort the outer execution and storyline
request controllers, wait for the single-flight Projection promise and any
native Floor save barrier to settle, then allow generation to proceed. Do not
increase the host timeout, add an official Projection save fallback, or retry
the same snapshot concurrently; those would mask an active host writer and
could overwrite the generation's final Floor.

If cancellation is intentionally not desired, the alternative is to queue the
pending Projection write until the final Character Floor is confirmed after
`GENERATION_ENDED`/`CHARACTER_MESSAGE_RENDERED`; however, this is a larger
lifecycle change and must preserve the current snapshot as the retry baseline.

## Regression tests to add

1. In `tests/projection-runtime.test.js`, start a Projection refresh whose
   storyline save is held, simulate the generation-start cancellation hook,
   assert the refresh ends `cancelled`, the outer execution leaves its
   single-flight map, and a subsequent refresh can run.
2. In the lifecycle/runtime integration tests, emit `GENERATION_STARTED` while
   a progression API request or `saveVerified()` is pending. Assert the
   progression snapshot write receives an aborted signal, no second native
   `saveChat()` is overlapped, and the later final-Floor handoff can retry the
   same progression without duplicate API/write records.
3. Retain existing `tests/runtime.test.js` native-save timeout/barrier tests;
   they verify the persistence layer's correct fail-closed behavior but do not
   simulate a host generation boundary.

## Caveats / Not Found

- This research made no production-code changes.
- The debug export has no explicit `GENERATION_ENDED` or final
  `CHARACTER_MESSAGE_RENDERED` entry before the failing save, so it cannot prove
  whether the host eventually completed its own save after the timeout. It does
  prove that the plugin's progression write was attempted after START and was
  classified unknown at the native save boundary.
- Native host write timing still needs real SillyTavern acceptance after the
  lifecycle cancellation/defer change; Node tests cannot prove host generation
  save ordering.
