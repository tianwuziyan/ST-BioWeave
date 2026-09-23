# 统一 Floor 持久化协调器设计

## 1. Boundaries

`FloorPersistenceCoordinator` 是普通 Floor patch 的唯一 orchestration owner。它只处理当前已通过业务校验的 candidate patch，不调用 AI、不决定 Scheduler due、不实现 Generation Settle Barrier，也不把 DOM/UI 作为事实源。

现有 `storage/store.js` 继续是业务存储边界，`runtime/events.js` 提供宿主适配所需的低层 primitive（当前 Chat/owner 解析、official GET/SAVE、host live object sync、readback）；这些 primitive 必须去除 World/Event 业务分支，避免 Coordinator 套旧 pipeline。

## 2. Data flow

```text
business candidate patch
  -> coordinator.commitFloorPatch({ owner, execution, floorVersion, patch, reason })
  -> transaction queue by canonical Floor identity
  -> reacquire current context / owner / swipe / version
  -> resolve latest authoritative slot
  -> validate owner whitelist and patch
  -> merge only patch into latest sibling-preserving slot
  -> sync the current host live owner object
  -> official save
  -> official readback
  -> owner + sibling audit
  -> confirmed result / structured failure
```

The Auto prerequisite remains a separate read/host-save boundary before AI. The coordinator may reuse low-level host save/readback primitives, but must not trigger analysis or silently consume Stage retry budget.

Analysis Input Ready deliberately does not require the official server to have
the new generation yet. At coordinator dispatch, owner acquisition is classified
as `AUTHORITATIVE_MATCH`, `HOST_AHEAD_OF_OFFICIAL`, or
`TRUE_STALE_OWNER_CHANGE`. The host-ahead path is allowed only after settled
generation/live identity checks and uses the latest official chat as its base,
merging only the finalized target message/Swipe body before a direct official
save and authoritative readback. `saveChatConditional()` resolution is never
treated as durable confirmation.

## 3. Transaction contract

Each transaction carries:

- `floor_transaction_id`
- `transaction_key = chat_id/message_id/floor/swipe_id/message_version/content_hash`
- `owner` (`world`, `event`, `projection`, or explicitly approved `terminal`)
- `execution_attempt`, `stage_attempt`, `retry_index`
- `patch` limited to the owner whitelist
- `reason` and `operation_type`

Queue state is per transaction key. A queued transaction re-resolves live context before dispatch and fails closed when chat, message, floor, active Swipe, content hash, message version, execution ownership, cancellation, or plugin state no longer matches.

## 4. Owner whitelist and sibling audit

```text
world      -> world_model, world_model_meta
event      -> analysis, events, character_registry
projection -> snapshot, projection_timeline
terminal   -> only fields proven business-owned during inventory
```

The coordinator clones the latest slot, applies only the selected owner patch, and records before/after presence for every sibling owner. Whole-object replacement is not a normal path. Clear/restore/migration remain explicit operation types with their own guards and tests.

## 5. Confirmed semantics

`FLOOR_TX_CREATED/QUEUED/DISPATCH_BEGIN/OWNER_CHECK/LATEST_SLOT_RESOLVED/PATCH_VALIDATED/HOST_SYNCED/OFFICIAL_SAVE_RESOLVED/READBACK/SIBLING_AUDIT/CONFIRMED/FAILED/SUPERSEDED` are implementation diagnostics, not business-state events. They must not trigger UI rendering.

`CONFIRMED` means current owner identity still matches, official readback contains the expected owner patch, and sibling audit proves this transaction did not delete unrelated owner data. It does not claim that an unknown future SillyTavern writer can never overwrite the slot.

## 6. Migration strategy

1. Inventory all writers and classify each as KEEP, MOVE, DELETE, or SPECIAL.
2. Implement coordinator plus low-level adapter primitives and contract tests.
3. Migrate World first, then Event/Character, Projection, Manual, and approved Terminal paths.
4. Remove legacy orchestration and duplicate diagnostics; retain Stage diagnostics and lifecycle diagnostics.
5. Add direct-writer/static gate and run complete checks.

## 7. Risk and rollback

The working tree is already dirty. Changes must be surgical and limited to coordinator migration plus its tests/docs; unrelated existing modifications are not to be reverted. If a migration step cannot preserve the current owner/version contract, stop that path rather than adding a fallback storage domain. Real ST F5 durability remains a separate acceptance item.
