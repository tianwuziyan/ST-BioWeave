# Phase A Diagnostics Extraction Design

## Boundary

`runtime/diagnostics.js` owns only BioWeave diagnostic formatting, safe cloning/sanitization, trace buffering, and plain-data debug DTO construction. It does not own Runtime event broadcast, business state, Floor resolution, persistence, or lifecycle decisions.

## Proposed API

`createRuntimeDiagnostics({ notifyDiagnostic, chatIdResolver })` returns only current needs:

- `sanitizePersistenceTracePayload(payload)`
- `cloneSafeTraceValue(value)`
- `recordLifecycleTrace(stage, payload, chatId)`
- `recordPersistenceTrace(payload)`
- `emitPersistenceTrace(payload)`
- `getPersistenceTrace()`
- `buildReloadFloorSlotAudit(input)`
- `buildStoryTimeDebugInfo(input)`
- `formatExecutionDiagnostic(error, stage)`
- `buildFloorPreflightStatus(error, trackingSubjectCount)`
- `compareFloorVersions(expected, actual)` / `versionMismatchFields(expected, actual)`

The implementation may reduce names when an existing call site can use a smaller equivalent API. No speculative logging abstraction is allowed.

## Data Flow

```text
Runtime/Analysis business code
  ├─ resolves Floor, Story Time, execution, or lifecycle facts
  ├─ keeps control flow and notify/activity behavior
  └─ passes plain diagnostic data
          ↓
runtime/diagnostics.js
  ├─ sanitizes/clones
  ├─ buffers trace sequence
  └─ builds safe DTO
          ↓
Runtime diagnostic sink / existing UI Runtime API
```

`runtime/diagnostics.js` must not import `runtime/events.js` or `runtime/event-analysis.js`. Runtime owns existing subscriber broadcast and passes a narrow diagnostic sink.

## Story Time and Reload Audit

Runtime continues to call `storyTimeCoordinator`, `eventAnalysis.collectActiveBusinessData`, Floor resolver, and Store. Diagnostics receives their results and only formats the existing DTO. No resolver or Store dependency enters the new module.

## Compatibility

- Existing `getPersistenceTrace()` return structure remains unchanged.
- Existing `BIOWEAVE_PERSISTENCE_TRACE`, `EVENT_ANALYSIS_STATUS_CHANGED`, and lifecycle notification ordering remains unchanged.
- Existing adapter `setPersistenceTraceSink` remains unchanged.
- Existing Runtime return object remains unchanged.
- Persistence coordinator and adapter functions remain in their current files and call order.

## Main Risk

The largest risk is accidentally moving `notify`, `finalizeExecution`, `statusForCurrentFloor`, or `generationTrace` wholesale. These functions contain business state and ordering. They must remain owners and only call extracted pure helpers.
