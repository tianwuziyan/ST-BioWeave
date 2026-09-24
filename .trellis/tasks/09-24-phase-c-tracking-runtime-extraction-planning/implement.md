# Phase C Tracking Runtime Extraction Planning Implementation Plan

本文件记录已批准并完成的 Phase C 实施；不进入下一 Phase。

## Completed implementation

- 新增 `runtime/tracking-runtime.js`，唯一 module export 为
  `createTrackingRuntime`。
- 将 Tracking registry rebuild、refresh enabled guard、token guard、通知和
  返回 DTO 的 orchestration 归位到新模块。
- `collectTrackingInputs` 留在 `runtime/event-analysis.js`，只适配现有
  general Floor traversal、invalidated filtering、World provenance resolver
  和 Floor-owned character registry 为 plain input。
- `collectCurrentFloorStates`、`collectCurrentDerivedState`、Snapshot、StateReducer、
  Story Time、Business DTO、Persistence 和 lifecycle owner 未移动。
- `registryRefreshChain` 保留在 `runtime/event-analysis.js`，因为
  `invalidateForClear()` 仍将它作为 clear barrier；通过 `enqueueRefresh`
  注入新模块，保持 Clear sequencing 不变。
- `runtime/event-editing.js` 继续只使用注入的 `refreshTrackingRegistry`，
  `event-edit` / `event-delete` reasons 与调用时机未改变。
- Runtime facade、Characters UI、`TRACKING_REGISTRY_REFRESHED` payload 与
  `character_registry` ownership 保持兼容。

## Verification

- Focused Tracking/Event Runtime/UI/Persistence tests: 301 pass, 0 fail。
- `npm test -- --test-force-exit`: 931 pass, 0 fail。
- `npm run check`: 931 pass, 0 fail。
- Changed JavaScript `node --check`: pass。
- `git diff --check`: pass。

## Ordered future steps

1. Freeze current contracts from `refreshTrackingRegistry`,
   `collectCurrentDerivedState`, `collectCurrentFloorStates`,
   `buildBusinessData`, `getTrackingRegistry`, Runtime facade and UI refresh.
   Verify current focused Tracking/lifecycle/UI tests before edits.
   Risk: HIGH.
2. Introduce only the smallest Tracking Runtime module if the audit confirms a
   plain-data seam. Keep `core/tracking.js` as Domain owner and keep general
   Floor traversal, StateReducer, Snapshot, Story Time and DTO assembly in
   their existing owners.
   Risk: HIGH.
3. Compose the module inside Runtime construction without changing
   `runtime/events.js` public names or `runtime/event-editing.js` callbacks.
   Risk: MEDIUM.
4. Preserve refresh serialization, token/current-owner guards, disabled and
   empty-Chat behavior, notification schema, and all existing refresh reasons.
   Risk: HIGH.
5. Run focused tests covering Tracking domain, Runtime rebuild, Event Editing
   refresh, World Model refresh, lifecycle/swipe/delete/clear/reload, business
   DTOs and Characters UI.
   Risk: HIGH.
6. Run full checks and inspect diff scope. Do not change tests to accept new
   behavior.

## Required regression matrix

- valid active Floor and active Swipe only;
- stale six-field Floor Version and deleted/missing Swipe fail closed;
- current World Model is provenance-checked and no Chat-level fallback appears;
- `tracking_subjects` eligibility remains unchanged;
- pending `tracking_candidates` remain unchanged;
- `character_profiles` retain current merge/evidence semantics;
- canonical `character_registry` remains Floor-owned and separate;
- Event Editing update/delete still refreshes after commit in the same order;
- Event Analysis success refreshes only after canonical persistence/readback;
- analysis failure refresh behavior remains unchanged;
- Chat change, init, Swipe switch/delete, message deletion, clear/reset and
  reload preserve the existing refresh matrix;
- refresh notification payload and UI business refresh remain compatible;
- concurrent refreshes remain serialized and stale results cannot publish;
- no tracking data is written through a new Floor writer;
- Snapshot, StateReducer and Projection outputs remain unchanged.

## Stop conditions

Stop planning implementation if the seam requires:

- changing `core/tracking.js` semantics;
- moving or duplicating `collectCurrentFloorStates` / Snapshot / StateReducer;
- changing `character_registry` ownership or historical resolution;
- changing Event Editing, Analysis, Generation or Clear ordering;
- adding persisted tracking fields or a second Floor writer;
- changing Runtime public API, UI DTOs or notification payloads;
- changing Diagnostics.

Any Persistence transport, owner acquisition, readback, Swipe ownership,
transaction serialization or Floor Version policy change requires a separate
task and real-host validation; it is outside Phase C.

## Validation commands after a separately approved implementation

- `npm test -- --test-force-exit`
- `npm run check`
- `git diff --check`
- `node --check` every changed JavaScript file
- focused Tracking, Event Analysis Runtime, Event Editing, lifecycle, clear,
  reload, phase2a app and floor static-gate tests

Real ST + F5 is not automatically required for a pure runtime extraction, but
becomes required if any Persistence transport, owner acquisition, readback,
Swipe ownership or lifecycle ordering changes.
