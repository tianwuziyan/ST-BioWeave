# Audit: PRE-CONFIRMATION TRACKING WINDOW PHASE 1

## Audit boundary

只验证本任务冻结 decisions 是否与当前 checkout 冲突；不重新审计整个产品架构。审计依据为当前代码、测试、规范和当前 worktree。

## Frozen decision compatibility

结论：未发现产品语义冲突，可以直接实施。当前缺口是独立 Window domain/runtime/persistence，而不是需要改变既有 Timing、Event、State 或 Projection contract。

| Frozen decision | Current evidence | Result |
| --- | --- | --- |
| Window 与 Timing/Projection/Event/State 分离 | `docs/ARCHITECTURE.md` feature map；`docs/DATA-MODEL.md` Concept Separation；`pregnancy-tracking.md` four-layer boundary | Compatible; new owner required |
| Timing cycle identity reuse | `core/projection-timing.js:85-88` `buildProjectionTimingCycleId()` | Reuse or wrap existing helper; no second biological identity |
| Timing instance frozen / no resampling | `core/projection-timing.js:91-124` and `storage/projection-timing.js` | Compatible; Window only binds to existing cycle |
| Floor/Swipe authority | `.trellis/spec/domain/floor-state.md` sections 1-5; `storage/projection-timing.js` owner/version checks | Compatible; Window needs same owner guard/readback path |
| Tracking true/null/false semantics | `core/tracking.js:470-570` `rebuildTrackingRegistry()` | Compatible; add Window-open filter before active registry projection |
| terminal factual semantics | `core/events.js:15-20, 392-430`; `core/state.js:450-500` | Confirmation/loss/abortion are available; conception remains separate |
| Event edit/delete rebuild | `runtime/event-editing.js:45-112` | Compatible; Window must be derived from refreshed active Events |
| Projection boundary | `core/projection-eligibility.js:141-154`; `docs/bioweave-data-lifecycle.md` Context rules | Compatible; bridge only pre-confirmation path |
| Characters retention | `ui/characters.js` and `runtime/event-analysis.js` current Tracking DTO; `core/state.js:647-660` active episodes | Requires minimal read-model bridge, not UI redesign |

## Current implementation map

```text
valid Floor Events
  → collectTrackingInputs()
  → core/tracking.js::rebuildTrackingRegistry()
  → runtime/tracking-runtime.js
  → event-analysis/runtime DTO
  → ui/characters.js
```

Timing is a parallel Floor-owned path:

```text
valid exposure Event
  → core/projection-timing.js cycle/instance
  → storage/projection-timing.js
  → projection eligibility/runtime
```

There is no current `tracking_window_timeline`, Window reducer/view, Window Runtime owner, or lifecycle filtering.

## Confirmed technical conflicts / risks

1. `storage/floor-persistence-coordinator.js` currently allows `projection_timing_timeline` only under `projection`; an independent Window field requires a narrow `tracking` owner addition and lifecycle registry entry.
2. The existing Event contract has subject-bound terminal facts but no direct `tracking_window_id` reference. Phase 1 must use deterministic subject-bound factual matching and Story Time ordering, fail closed on invalid/uncertain facts, and never infer pregnancy from exposure.
3. Existing Tracking groups exposure by subject but not by mechanism/cycle. Reusing only the Timing cycle helper without a shared compatibility predicate would create divergent grouping behavior; the implementation must extract the smallest shared core predicate.
4. Existing Characters enumeration is Tracking-Subject-centric. Closing a Window must not erase a factual confirmed Pregnancy Episode; read-model composition is required.

## Verified non-conflicts

- No requirement forces a World horizon or medical fallback; fail-closed open status is compatible with current Story Time semantics.
- No requirement requires changing `projection_rule` schema or injecting Window into Context.
- No requirement requires rewriting historical Floors or introducing Chat-level Window cache.
- Existing uncommitted files are unrelated to the new Window owner and will be preserved.

## Recommended minimal implementation boundary

- `core/tracking-window.js`: DTO validation/normalization, deterministic identity, compatibility, reducer/view, terminal matching, active filtering.
- `storage/tracking-window.js` plus schema/lifecycle/coordinator allowlist: independent Floor-owned append-only timeline and authoritative readback.
- `runtime/tracking-window-runtime.js`: collect surviving valid Events, resolve/rebuild Window view, persist current owner-scoped records, expose read model to Tracking/Projection.
- `core/tracking.js` / `runtime/tracking-runtime.js`: consume Window view and preserve capability tri-state.
- `core/projection-eligibility.js` / projection runtime bridge: gate only pre-confirmation exposure-driven path.
- event-analysis composition and Characters read-model bridge: wire downstream consumers without adding Window to Context.

## Audit conclusion

`TRACKING_WINDOW_PHASE_1_AUDIT: NO_PRODUCT_CONFLICTS_FOUND; IMPLEMENTATION_READY_AFTER_PLANNING_APPROVAL`.
