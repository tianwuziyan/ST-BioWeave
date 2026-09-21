# Implementation Plan

1. Locate the current header, settings order, launcher drag release, preference
   contract, and activity CSS/test coverage.
2. Remove edge snap end-to-end and simplify Chinese launcher settings.
3. Add the header visibility icon and route it through the existing preference
   callback; render its state from current settings.
4. Rework only launcher sizing/animation CSS and preserve pointer behavior.
5. Add/update focused tests for synchronization, no-snap positioning, state
   classes, placement, wording, and contract removal.
6. Update existing UI/lifecycle documentation, then run syntax, focused, full,
   and diff checks. Do not commit or push.
