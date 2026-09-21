# Implement Floating Launcher

## Goal

Add a second SillyTavern Floating Launcher entry sharing app.openBioWeave, introduce a read-only Runtime Activity seam, global UI preferences, lifecycle cleanup, regression tests, and synchronized documentation without changing business semantics.

## Requirements

- Add a second Host Entry with DOM id `bioweave-floating-launcher`.
- Reuse the existing `app.openBioWeave()` callback; do not create a second App,
  Panel, Runtime, or analysis path.
- Store launcher position only in device-local localStorage under
  `bioweave-floating-launcher-position`.
- Add global UI preferences `show_floating_launcher` and
  `floating_launcher_snap_to_edge`; they must not become Chat/Floor/business
  data.
- Expose a read-only Runtime Activity seam that supports concurrent
  `event_analysis` and `world_analysis` tasks without exposing business DTOs.
- Keep the launcher present when Runtime initialization returns false or throws.
- Implement pointer click/drag separation, viewport clamping, optional
  left/right edge snap, keyboard activation, reduced-motion styling, and full
  destroy cleanup.
- Update the relevant settings/lifecycle/UI documentation and add focused
  regression tests.

## Acceptance Criteria

- [ ] Menu and launcher are both registered before `runtime.init()`.
- [ ] Runtime init false/throw does not remove either Host Entry.
- [ ] Launcher click opens the existing BioWeave shell; drag never opens it.
- [ ] Repeated registration/reload leaves at most one launcher node.
- [ ] Disable removes launcher DOM, listeners, observer, timer, and activity
      subscription idempotently.
- [ ] Invalid, missing, or out-of-range saved positions fail safe and clamp.
- [ ] Event Analysis and World Analysis activity supports concurrent tasks;
      cancellation is not reported as an error.
- [ ] Active Projection does not produce a running launcher state.
- [ ] `node --check`, focused tests, `npm run check`, and `git diff --check`
      pass, or any host-only limitation is explicitly reported.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
