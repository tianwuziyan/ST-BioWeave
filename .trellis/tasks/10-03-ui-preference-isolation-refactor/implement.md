# Implementation Plan

1. Add the preference factory around the existing resolver and move the two
   durable preference contracts, diagnostics, and serialization into it.
2. Inject one factory result from `index.js` into App and Launcher; preserve
   explicit `storageRef` test/DI compatibility at the composition boundary.
3. Replace App/Launcher raw storage calls with port calls without changing
   Theme normalization or Launcher durable/transient position ownership.
4. Add preference unit tests and adapt App/Launcher tests to stable port mocks;
   retain existing mobile resize, pointercancel, remount, and failure tests.
5. Update only the relevant UI preference contract documentation if needed.
6. Run syntax checks, focused tests, full suite, production scan, and diff
   checks; compare exact failure identities with the recorded baseline.

## Scope guard

Only preference implementation, composition wiring, focused tests, relevant
contract docs, and this task's Trellis artifacts may change.
