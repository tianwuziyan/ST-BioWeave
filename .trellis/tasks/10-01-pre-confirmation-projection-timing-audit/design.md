# Technical Design: Read-only Projection Timing Audit

## Audit boundary

Inspect the current implementation directly, beginning with the requested
Projection Core/Runtime/Storage/UI files, then follow imports and callers into
World Model, Floor ownership, Tracking, Current State, identity, and tests.
Use the Floor State Ownership, Event Pipeline, Pregnancy Tracking, and World
Model specs as authoritative constraints. The original audit was read-only;
its implementation handoff has since been extended by the approved Human
narrative preset and Characters timing editor. Current implementation status is
recorded in `implement.md` and `docs/PROJECT-STATE.md`.

## Analysis axes

1. Map the declarative rule shape to the actual evaluator and runtime evolution
   path. Distinguish `min_elapsed_story_days` from expiration and from generated
   Projection validity.
2. Locate validation that rejects probabilistic or random fields and explain
   the deterministic biological-rule invariant it protects.
3. Compare candidate owners against Floor/Swipe provenance, persistence,
   derived-state rules, and UI editability. Treat an effective timing instance
   as a distinct concept from Event, Current State, Snapshot, and Projection
   Context.
4. Evaluate persistence-first sampling and stable deterministic derivation for
   reruns, config edits, source edits/deletes, Swipe changes, and debugging.
5. Keep any future State modifier limited to factual Current Biological State,
   snapshotted per timing instance, and bounded by a total cap.
6. Trace Characters page list/detail/action ownership to identify the minimal
   future UI seam without implementing it.
7. Determine whether Human defaults belong to World Model rules, a built-in
   plugin baseline, or a composition of both, including the current branch's
   World Model baseline work.

## Output contract

The report must state evidence locations, current support, missing primitives,
recommended ownership, lifecycle actions, minimal change surface, tests,
documentation/spec implications, risks, and actual product decisions still
blocking implementation. No numeric medical baseline is to be proposed.

## Design-phase handoff

The audit findings have been converted into the implementation contract in
[`decision.md`](decision.md). That document freezes the approved product
decisions, defines the Chat-owned character config and Floor-owned timing
instance boundary, specifies cycle identity and lifecycle derivation, and lists
the future implementation/test/doc surface. Phase 1 has now implemented the
approved Core, Chat config storage service, Floor timing timeline, eligibility
integration, the versioned Human narrative preset, and the Characters
timing-config editor. Medical-derived universal defaults and Tracking Window
remain out of scope.
