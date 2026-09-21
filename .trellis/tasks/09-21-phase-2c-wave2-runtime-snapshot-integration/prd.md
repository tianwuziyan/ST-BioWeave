# Phase 2C Wave 2 Runtime Snapshot Integration

## Goal

将 Wave 1 Snapshot 基础能力接入 Runtime：按当前有效 Character Floor/active Swipe 搜索最近有效 checkpoint，使用 snapshot.state + 后续 Events 恢复 Current State，在 Event Analysis 成功生命周期创建幂等 checkpoint，并覆盖时间派生、删除、Swipe、Chat 隔离与 full replay fallback。

## Requirements

1. In the current Runtime State path shared by `getCurrentBiologicalState()` and `collectActiveBusinessData()`, search only current-Chat valid Character Floors, their active Swipe owners, and checkpoints at or before the current Character Floor.
2. Prefer the nearest valid Snapshot. If it is invalid, stale, wrong owner, wrong Swipe, wrong Chat, or future, continue to earlier candidates; if none is usable, full replay all valid Events.
3. Restore with `snapshot.state` as `baseState` and replay only Events strictly after the checkpoint Floor through the current Character Floor. Never replay checkpoint-Floor Events again.
4. Keep current Runtime Story Time and `characterFacts` resolution unchanged and pass both into every restore. Story-time derived values must be recalculated from current Story Time, not frozen Snapshot values; current facts must update restored state where the reducer accepts them.
5. Create a Snapshot only after a successful authoritative Event Analysis Floor save, using current state and current Floor Version. Use `shouldSnapshot()` over valid Character Floor progression and persist through `store.saveFloor()` to the current Character Floor/active Swipe owner.
6. Checkpoint writes must be Chat/epoch/Floor-Version guarded, stale-safe, and idempotent for an already-valid Snapshot on the same Floor Version. Read-only getters and UI refreshes must not write.
7. Invalidate/clear a Floor Snapshot whenever authoritative Events are edited/deleted or a successful analysis replaces Events at the same Floor Version, so a stale cache cannot replay mutated facts.
8. Preserve all existing Event, State Fact, Story Time, capability, pregnancy, World Model, Projection, and Genealogy semantics. Do not implement historical Snapshot cascade invalidation.

## Acceptance Criteria

- [ ] Snapshot path equals full replay and replays only post-checkpoint Events.
- [ ] Invalid newest Snapshot falls back to an earlier valid Snapshot, then to full replay when all are invalid.
- [ ] No Snapshot preserves Phase 2B full replay behavior.
- [ ] Current Floor deletion, Snapshot-owner deletion, Swipe 0/1 switching, Chat switching, User latest message, and User-only Chat all fail closed correctly.
- [ ] Three valid Character Floors create one checkpoint after successful analysis; repeated same-version lifecycle does not rewrite it.
- [ ] Read-only State getters never persist Snapshot data.
- [ ] Current Story Time recomputes elapsed derived fields; current `characterFacts` updates restored state.
- [ ] 500+ Event history proves equivalence and the replay set excludes checkpoint Events without timing assertions.
- [ ] All modified JS passes `node --check`; focused tests, `npm run check`, and `git diff --check` pass.

## Out of Scope

- Projection, pregnancy probability/automatic pregnancy decisions, Context Injection, Genealogy, World Model changes, UI changes.
- Snapshot dependency graphs, DAGs, all-history hash trees, and future Snapshot cascade invalidation after old intermediate Floor deletion.

## Acceptance Criteria

- [ ] TBD
