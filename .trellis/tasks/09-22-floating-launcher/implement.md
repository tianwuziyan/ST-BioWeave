# Implementation Plan

1. Inspect Runtime task boundaries, global settings normalization, App
   lifecycle, CSS loading, and current test helpers.
2. Add the Runtime Activity coordinator and wire only existing Event Analysis
   and World Analysis tasks.
3. Add `floating-launcher.js` with idempotent DOM ownership, Pointer Events,
   clamp/snap, keyboard access, status rendering, preference reads, and full
   destroy cleanup.
4. Update `index.js` to register the launcher before `runtime.init()` and keep
   it on init failure.
5. Add global settings fields without changing Chat/Floor/business schemas.
6. Add focused Host/Lifecycle, interaction, persistence, activity, settings,
   and dependency-boundary tests.
7. Update README/UI/lifecycle/settings documentation and run syntax checks,
   focused tests, `npm run check`, and `git diff --check`.

Explicitly out of scope: Projection generation refactoring, Event Analysis
semantics, World Model data model changes, Floor/Snapshot migrations, new AI
requests, and SillyTavern host implementation changes.
