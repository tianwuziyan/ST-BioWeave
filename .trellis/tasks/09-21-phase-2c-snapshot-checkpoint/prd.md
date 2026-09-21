# Phase 2C Wave 1 Snapshot Checkpoint 基础层

## Goal

实现 BioWeave Snapshot/Checkpoint 纯基础层：DTO、校验、Character Floor/active Swipe 存储边界、按有效 Character Floor progression 的 checkpoint 判断、以 baseState 恢复 StateReducer，以及定向测试和数据模型文档更新。

## Background

- `core/state.js` 的 Current State DTO 为 `schema_version: 1`、`characters`、`processed_event_ids`、`diagnostics`；`reduceState()` 接受 `baseState`，并从 `events` 继续归约。
- `core/snapshot.js` 当前仍是旧接口：`shouldSnapshot(currentFloor, lastSnapshotFloor, ...)` 按消息数字差值判断，`restoreFromSnapshot()` 向 reducer 传 `{snapshot, events}`，与当前 StateReducer API 不一致。
- `runtime/floor.js` 已定义完整六字段 Floor Version：`chat_id`、`message_id`、`floor`、`swipe_id`、`content_hash`、`message_version`，并提供严格比较能力。
- `storage/store.js` 已提供 Character/assistant Floor 的 exact message/per-Swipe owner 读写边界；结构化 Swipe 包括 `swipe_id = 0`，User message 写入会拒绝；`storage/schema.js` 的 Floor root 需要同步生命周期注册表。
- 当前 Runtime 会从有效 Floor Events full replay Current State，但本轮不接入自动 Snapshot 创建或恢复。

## Requirements

1. 在 `core/snapshot.js` 定义最小 Snapshot DTO：`schema_version: 1`、六字段 `checkpoint`、结构化完整 `state`。Snapshot 只保存 Current State checkpoint，不保存 AI 原响应、Prompt、概率、Projection、随机结果、UI 状态、Focus Character、系统时间或 User Floor 数据。
2. Snapshot 创建、复制和验证必须保持缓存身份：深拷贝 Current State，拒绝非法 State/Checkpoint，不能反向修改 Current State/Event；Snapshot 缺失、损坏或删除时仍可 full replay。
3. Snapshot 所属 checkpoint 必须是当前 Chat 的 Character/assistant Floor、当前 active Swipe 的 exact owner、当前完整 Floor Version；错误 Chat、User message、错误 Swipe（含错误 Swipe 0/非 0）、错误 `content_hash` 或 `message_version` 必须 fail closed。
4. 更新 `shouldSnapshot()`，按有效 Character Floor checkpoint progression 计数：默认间隔 3；忽略 User message，不使用简单 `message floor % interval`；没有历史 Snapshot 时从有效 Character Floor 序列开始计数；保留纯 `majorEvent` 扩展入口但不实现生物事件规则。
5. 更新 restore helper，使 Snapshot.state 作为 `reduceState({ baseState, events, currentStoryTime, characterFacts })` 的 `baseState`；禁止把 Snapshot 作为待重放 Events。
6. 不改变 Current State 或 BiologicalEvent 语义，不删除 Event，不创建 Chat-level authoritative Snapshot，不增加 Snapshot dependency graph、级联失效、Projection、概率或 Runtime 自动集成。
7. 更新 `docs/DATA-MODEL.md`，并按生命周期注册表将新增 Floor `snapshot` root 的 ownership、clear/invalidation 语义登记到 `storage/lifecycle.js`；Floor schema、生命周期测试和 Snapshot 测试保持同步。

## Acceptance Criteria

- [ ] Snapshot DTO 与 State DTO 结构化、最小、可深拷贝，验证拒绝缺字段/错误 schema/非法 checkpoint。
- [ ] full replay State A → 创建 Snapshot → `Snapshot.state + later events` 得到 State B；完整历史得到 State C；B deep-equal C。
- [ ] 修改 Snapshot 创建结果不污染源 Current State；恢复不污染 Snapshot/baseState。
- [ ] 错误 Chat、错误 Floor Version、错误 content hash/message version、错误 Swipe、User message owner 均拒绝；Swipe 0 正确识别。
- [ ] interval=3 按有效 Character Floors 计数：Character/User/User/Character/User/Character 达到 checkpoint 条件。
- [ ] 找不到/拒绝 Snapshot 时保留 full replay 路径；Snapshot 中没有概率、Projection 或 UI 字段。
- [ ] 相关 JS 通过 `node --check`，定向测试通过，`npm run check` 通过，`git diff --check` 通过。

## Out of Scope

- Runtime 自动创建/恢复 Snapshot、重写 `collectActiveBusinessData()` 或 Event aggregation。
- Projection、Context Injection、Genealogy、怀孕概率/自动判定、AI 创建 Snapshot、UI 修改。
- 删除历史中间 Floor 后的 Snapshot 依赖图、全历史 hash tree、未来 Snapshot 级联失效。
- legacy compatibility、migration alias、随机 ID/UUID/`Date.now()` checkpoint identity。
