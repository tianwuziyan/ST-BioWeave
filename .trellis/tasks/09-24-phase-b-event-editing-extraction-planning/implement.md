# Phase B Event Editing Extraction Implementation

本文件记录已批准并完成的 Phase B 实施结果；不进入 Phase C。

## Completed implementation

- 新增 `runtime/event-editing.js`，唯一 export 为 `createEventEditing`。
- 将 `findActiveEvent`、`updateEvent`、`deleteEvent` 的 Event-specific workflow 归位到新模块。
- `runtime/event-analysis.js` 保留 Floor resolver、mutation invalidation、token guard、Floor persistence wrapper、invalidated state 与 Tracking refresh，并通过窄 capability seam 组合 Event Editing。
- `runtime/events.js` public `updateEvent` / `deleteEvent` API 保持不变。
- `storage/floor-persistence-coordinator.js`、`runtime/diagnostics.js`、tests 与项目 docs 未因本 Phase 修改。

## Verification

- `npm test -- --test-force-exit`: 931 pass, 0 fail。
- `npm run check`: 931 pass, 0 fail。
- `git diff --check`: pass。
- Changed runtime JavaScript `node --check`: pass。

## Ordered future steps

1. Freeze the current behavior contract from `findActiveEvent`, `updateEvent`, `deleteEvent`, `invalidateMutation`, `commitFloorPatch`, and `refreshTrackingRegistry`.
   - Verify existing Runtime, Event Analysis Runtime, UI, persistence coordinator, and static-gate tests before edits.
   - Risk: HIGH.
2. Introduce the smallest `runtime/event-editing.js` factory with plain-data/callback seams.
   - Move only Event-specific lookup/mutation logic.
   - Keep coordinator-owned invalidation, target-version guard, persistence, and derived refresh in their current owner.
   - Risk: HIGH.
3. Compose the module in the Runtime/Analysis construction path without changing `runtime/events.js` public names.
   - `runtime.updateEvent` and `runtime.deleteEvent` remain the only UI-facing Runtime methods.
   - Risk: MEDIUM.
4. Preserve exact patch contracts:
   - update: owner `event`, patch `{events}`, operation `event-edit-patch`;
   - delete: owner `event`, patch `{events}`, operation `event-delete-patch`;
   - preserve `event_id` and `source` on update;
   - preserve token and current Floor/Swipe guards.
   - Risk: HIGH.
5. Run focused regression checks before any broader check:
   - `tests/event-analysis-runtime.test.js` Event edit/delete cases;
   - `tests/phase2a-app.test.js` UI edit/delete case;
   - `tests/events.test.js` normalization/collection validation;
   - `tests/floor-persistence-coordinator.test.js` and `tests/floor-persistence-static-gate.test.js`.
6. Run full project checks only after the focused contract remains unchanged:
   - `npm test -- --test-force-exit`
   - `npm run check`
   - `git diff --check`
   - `node --check` all changed JS.

## Required regression matrix

- unknown Event ID and missing current Floor;
- active Swipe switch/delete and stale six-field Floor Version;
- edit invalid participant ID without any save or registry refresh;
- edit duplicate gestational subject without any save or registry refresh;
- delete removes active Tracking subjects/candidates/profiles derived only from that Event;
- historical Event edit/delete clears downstream Floor roots as today;
- edit/delete while analysis is running cancels or invalidates the same executions as today;
- late analysis result cannot overwrite the edit/delete patch;
- coordinator owner patch preserves World, analysis, registry, snapshot, and projection siblings;
- authoritative readback and UI refresh remain unchanged;
- snapshot and projection behavior is explicitly characterized, not silently changed.

## Stop conditions

Stop and return to planning if extraction requires:

- changing `storage/floor-persistence-coordinator.js` or persistence behavior;
- moving owner acquisition, bootstrap, readback, sibling audit, transaction queue, stale guard, or Swipe policy;
- changing generation cancellation/order, retry, supersede, or analysis execution state semantics;
- changing `character_registry`, snapshot, projection, or Tracking semantics to make extraction easier;
- changing Runtime public API or UI event/DTO contracts.

## Rollback shape

If approved implementation fails, revert only the new module composition/imports and callback wiring. Do not restore or rewrite unrelated pre-existing worktree changes, and do not alter the known-good Persistence coordinator.
