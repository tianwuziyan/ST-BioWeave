# Technical Design: Story Time, Tracking Window, and Timing Consistency

## Boundaries

- Story Time comparison remains owned by `story/time.js`, using the existing
  `utils/cn-date.js`, `story/calendar.js`, and `business/calendar/date.js` chain.
- Tracking Window remains owned by `core/tracking-window.js`; it consumes validated
  Events and never parses Chinese dates itself.
- Timing creation/aggregation remains the Runtime/Core/Storage path already composed in
  `runtime/events.js`, `core/projection-timing.js`, `core/participant-aggregation.js`, and
  `storage/projection-timing.js`.
- Debug extends `getProjectionTimingDebug()` and the existing lifecycle/runtime export; no
  parallel diagnostic authority is introduced.

## Story Time comparison contract

1. Normalize both values through the existing Story Time facade.
2. Determine an explicit comparable domain. A same-era `era-standard` pair may use the
   existing Gregorian month/leap-year arithmetic even when its `calendar_id` is null; a
   custom calendar requires the same explicit calendar identity/descriptor. Ordinary
   Gregorian values retain day-index comparison.
3. If the domain is absent, mismatched, or only inferred from an untrusted display/normalized
   string, return `null` for both comparison and difference.
4. Preserve clock precision only in the existing `differenceStoryTime()` same-day rule; do
   not change Story Days timing thresholds.

The implementation must avoid duplicating parsing and must not make `calendar_id=null` a
universal identity. Tests should assert the relation between the signed day difference and
comparison result rather than only testing isolated values.

## Tracking Window contract

- Replace the current event-ID fallback as a temporal decision. First use a non-null
  `compareStoryTime()` result. For equal Story Time, use a stable provenance tie-breaker only
  to make iteration deterministic. For a null comparison, retain an explicit unresolved
  condition and avoid creating or selecting a first anchor from that pair.
- Preserve subject + mechanism grouping, Floor provenance, append-only source IDs, current
  Floor reconstruction, and historical immutability.
- If the current data shape cannot represent unresolved anchor selection without ambiguity,
  stop before schema expansion and report the contract gap rather than inventing a new state.

## Timing and aggregation contract

- Confirm the current task/spec/test decision before changing `runtime/events.js`.
- Preserve the existing independent persisted Timing Instance, one-time random sampling,
  frozen effective bounds, Floor/Swipe/version guards, and aggregation trigger semantics.
- `projection_rules=[]` must remain fail-closed unless repository evidence explicitly proves
  an Exposure-owned independent creation contract. If such evidence exists, add only the
  narrowest Exposure-to-Timing entrance and keep Projection Rule evaluation separate.
- Do not fabricate a rule, call the analyzer, or bypass the existing projection eligibility
  and persistence/readback gates.

## Compatibility and rollback

- Existing Gregorian, custom calendar, Event, Projection, participant aggregation, lifecycle,
  Swipe, and Floor persistence tests remain the regression baseline.
- Changes are limited to the confirmed owner modules and focused tests/docs. If a change
  requires Coordinator, Snapshot, lifecycle registry, or historical migration changes, stop
  and return to planning.
- Current unrelated/uncommitted work remains untouched; no destructive Git command is allowed.
