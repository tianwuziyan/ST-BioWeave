# 统一 Floor 持久化协调器

## Goal

在不改变 BioWeave Floor/Swipe 数据所有权的前提下，把普通 Floor 写入收敛为一个可审计、串行、基于最新 authoritative slot merge 的 `FloorPersistenceCoordinator`，解决 World/Event/Projection/Manual 之间的旧快照覆盖、重复 save orchestration 与确认语义不一致问题。

## Confirmed baseline facts

- 当前生产 owner 是 Character message 的 active Swipe：`message.swipe_info[activeSwipeId].extra.bioweave`；没有 Swipe 时沿用现有 canonical no-Swipe 规则。
- `storage/store.js` 暴露业务 `getFloor/saveFloor` 边界；`runtime/events.js` 同时包含 official `/api/chats/get`、`/api/chats/save`、host memory sync、readback、convergence 与 audit orchestration。
- `runtime/event-analysis.js` 的 World、terminal 和编辑/删除路径多处直接组装完整 Floor 后调用 `store.saveFloor`；`storage/projection.js` 也直接把完整 `nextFloor` 交给 `store.saveFloor`。
- 当前工作树已经包含 Generation Settle Barrier、Auto prerequisite、Floor Version stale guard、Stage retry、World/Event canonical readiness 和 UI refresh reentrancy 修复；本任务不得回退这些安全机制。
- 现有自动化测试已覆盖大量 official persistence、Swipe 0、readback、host sync 与生命周期行为；新改动必须保持既有测试通过。

## Requirements

### R1. Storage and ownership remain unchanged

- 继续写入当前 Character Floor + active Swipe 的 `extra.bioweave`，保留 no-Swipe canonical fallback。
- 不新增 Chat metadata Floor 副本、`message.extra` bypass 或第二套 UI 权威数据源。
- 业务字段 whitelist：World=`world_model/world_model_meta`；Event=`analysis/events/character_registry`；Projection=`snapshot/projection_timeline`。Terminal 只有经过审计确认的业务字段可以持久化。

### R2. One ordinary persistence owner

- 新增一个 `FloorPersistenceCoordinator` 作为普通 Floor patch 的唯一 orchestration owner。
- World、Event/Character、Projection、Manual Full/Patch 和允许的 Terminal patch 只能提交 owner-scoped patch；不得提交旧的完整 `bioweave` snapshot。
- Coordinator 必须拒绝越权 patch、非法 owner、非 Character Floor、错误 Chat/Floor/Swipe/Version 和失效 execution。

### R3. Latest authoritative merge and serialized transactions

- 每次真正 dispatch 前重新获取当前 context、Chat、Floor owner、active Swipe 和 Floor Version。
- dispatch 时读取最新 authoritative Floor slot，保留所有 sibling，只应用本 owner whitelist patch。
- 同一 Chat + message/Floor + Swipe + canonical Floor Version 的普通写入必须串行；不同 Floor 可独立。
- 排队不是 stale guard 的替代品；队列中的旧 transaction 在 dispatch 前必须 fail closed/supersede。

### R4. Confirmed persistence semantics

- transaction 至少有 created、queued、dispatch、owner check、latest slot、patch validation、host sync、official save resolved、readback、sibling audit、confirmed/failed/superseded 状态。
- 只有 owner identity 仍匹配、official readback 成功、owner patch 正确存在且 sibling 未被错误删除，才报告 confirmed。
- `saveChat()`/Promise resolve 不得单独被标记为永久 durable；保留真实 ST late-writer/F5 未证实的限制。

### R5. Preserve lifecycle and retry boundaries

- Generation Settle Barrier 和 Auto prerequisite 继续决定何时可以启动分析；Coordinator 不负责 AI、scheduler 或 generation settle。
- World Ready 前不得进入 Event；World failure 只 retry World；Event failure 只 retry Event；Coordinator 内部 serialization/convergence 不消耗 Stage retry budget。
- Manual Full/Patch 仍 World-only、single-flight、可取消；取消或 ownership 变化不得让 late write 发布为 UI-ready。
- prerequisite 未通过、owner 不存在或 execution 已失效时，不得为了诊断创建无意义 Floor terminal writer。

### R6. Diagnostics and cleanup

- 以 `FLOOR_TX_*` 为统一普通持久化 transaction trace，携带 `floor_transaction_id`、owner、transaction key、execution/stage/retry identity 和安全 presence/version 摘要，不记录正文、Prompt、API key/Auth。
- 迁移后删除或收口旧 World/Event/terminal persistence orchestration、重复 convergence workaround 和无 caller dead code；保留低层无业务 ownership primitive 及显式 clear/restore/migration whole-object operation。
- production 普通业务源文件不得直接调用完整 Floor save、`/api/chats/save` 或 `context.saveChat()` 绕过 Coordinator；允许的 Auto prerequisite host save boundary、clear/restore/migration 必须有明确理由和测试。

## Acceptance Criteria

- [ ] World → Event → Projection 连续提交后，同一 Floor/Swipe 中全部 sibling 保留，且每次由同一 Coordinator latest merge。
- [ ] World patch 修改 Event 字段、Event patch 修改 World 字段、Projection patch 修改其它 owner 字段都会 fail closed。
- [ ] 同 Floor 并发写入实际串行；排队期间 Chat/Floor/Swipe/Version 变化时旧 transaction 不写。
- [ ] transaction 创建时旧 slot 与 dispatch 时 authoritative slot 不同，dispatch 保留最新 sibling，不被旧 snapshot 覆盖。
- [ ] official readback 缺失、sibling 丢失、owner/version 变化都产生结构化失败而不是假成功。
- [ ] World/Event/Projection/Manual 的普通写入不再保留第二套 production persistence orchestration；legacy inventory 可逐项说明 KEEP/MOVE/DELETE/SPECIAL。
- [ ] Generation barrier、Auto prerequisite、Stage retry、Manual cancel、Swipe 0/no-Swipe、UI refresh loop 与现有生命周期测试保持通过。
- [ ] 新增 direct-writer gate，证明普通业务模块不能绕过 Coordinator。
- [ ] `npm test`、`npm run check`、修改 JS 的 `node --check`、`git diff --check` 全部通过。
- [ ] 真实 SillyTavern F5 durability 仍单独标记为待验收，不把 immediate readback 或 Promise resolve 夸大成永久 durable。

## Out of scope

- 不迁移到 `chatMetadata`，不改变 Floor Version、active Swipe、Generation Settle Barrier、Scheduler interval 或 World→Event hard dependency。
- 不修改 Prompt/schema/validator、AI retry 产品语义或 UI framework。
- 不使用 setTimeout、sleep、polling、无限 retry 或整条 message LWW 覆盖来掩盖 host race。
