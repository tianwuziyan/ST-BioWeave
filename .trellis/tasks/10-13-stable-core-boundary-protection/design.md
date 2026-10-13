# ST-BioWeave 稳定核心模块边界保护设计

## Boundary

- `story/time.js` remains the Story Time semantic entry; `story/coordinator.js` owns Floor lifecycle. The existing `core/tracking-window.js` fast path remains in place and is characterized through its public diagnostics/output.
- `core/events.js` remains the canonical Event normalization, validation, and semantic-dedupe domain entry.
- `runtime/character-event-analysis.js` remains the complete Reconciliation implementation. Runtime owns identity resolution, continuation, Floor Version checks, persistence decision, and final add/merge/skip.
- Core/domain modules do not read or write Store. Tracking, Health, Projection, and UI consume canonical Event/read-model outputs and do not import the private Reconciliation implementation.

## Static gate

Add one Node test using repository-relative import declarations only. It checks:

1. `core/events.js` does not import `runtime/` or `storage/`.
2. `story/time.js` does not import `runtime/`, `storage/`, or `ui/`.
3. consumer roots for Tracking, Health, Projection, and UI do not directly import `runtime/character-event-analysis.js`.

The gate intentionally does not ban field names or infer identity ownership from arbitrary text. The test file is covered by the existing `tests/*.test.js` glob.

## Story Time baseline

Use `compareStoryTime()` as the authoritative observable comparator and `deriveTrackingWindows()` diagnostics/output as the public observation of the private fast path. Canonical inputs must agree; malformed, conflicting, incompatible, and incomparable inputs are recorded as current behavior rather than normalized by the test.

## Compatibility and rollback

No production import is moved. Removing the added tests/spec text is sufficient rollback; no schema or persistence migration exists.
