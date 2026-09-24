# Phase E Character / Event Analysis Implementation Plan

# Phase E Character / Event Analysis Extraction Implementation Record

本 Phase 已完成；不进入下一 Phase。

## Completed

- 新增 `runtime/character-event-analysis.js`，唯一 module export 为
  `createCharacterEventAnalysis`，factory 返回 `runEventAttempt`。
- 将 Event-specific analyzer invocation、identity resolution、canonical Event
  normalization、state-fact ID materialization、empty classification、完整
  collection validation、Event owner patch、canonical readback/readiness、
  Snapshot checkpoint 调用和成功后的 Tracking refresh 归位。
- `runtime/event-analysis.js` 继续拥有 `runAnalysis`、World prerequisite、
  generic `runAnalysisStageWithRetry`、execution/cancellation/supersede、
  terminal persistence、Generation lifecycle、general input/Floor traversal、
  Snapshot machinery及 failure Tracking refresh。
- Event/Character 仍是一个 Event AI stage；没有新建 Character AI、parser 或
  persistence stage。
- `runtime/events.js` facade、Diagnostics、World Analysis、Event Editing、
  Tracking Runtime、AI/domain modules及 Persistence Coordinator未改变。

## Contract review

- Event owner patch remains `{analysis, events, character_registry}`。
- `owner="event"` and `operation_type="event-analysis-patch"` unchanged。
- Terminal writer remains in `runtime/event-analysis.js` with existing
  `terminal-analysis-patch` and supersede behavior。
- Generic retry implementation, retry count normalization, retryability and
  exhaustion policy remain unchanged。
- Event input shape, parser semantics, identity semantics and `events=[]`
  semantics remain unchanged。
- Snapshot implementation remains in the general Runtime owner; success ordering
  remains canonical persistence/readback → Snapshot checkpoint → Tracking refresh。
- No import cycle: the new module imports only AI trace, core Event/Identity and
  Floor hashing/version helpers; it does not import Runtime coordinators,
  concrete Persistence, World Analysis, Event Editing or Tracking Runtime.

## Verification

- Focused Event/Runtime/Identity/Tracking/UI tests: 234 pass, 0 fail。
- `npm test -- --test-force-exit`: 931 pass, 0 fail。
- `npm run check`: 931 pass, 0 fail。
- Floor persistence static gate: 6 pass, 0 fail。
- `node --check runtime/character-event-analysis.js`: pass。
- `node --check runtime/event-analysis.js`: pass。
- `node --check runtime/events.js`: pass。
- `git diff --check`: pass。

## File size

- `runtime/event-analysis.js`: 3778 → 3504 lines, -274。
- `runtime/character-event-analysis.js`: +470 lines。

## Scope review

- `storage/floor-persistence-coordinator.js` 未修改。
- 未修改 tests、Prompt/Input、Diagnostics implementation、World/Character
  boundary、Tracking semantics、Snapshot/Projection follow-ups或 Generation
  lifecycle。
- 未进行 REAL ST + F5；本 Phase 未触碰 Persistence transport 或 lifecycle
  ordering。

## Follow-ups

- Manual Character → World AI routing：Analysis Boundary Fix。
- Event raw-source contamination：Input Boundary Fix。
- Character UI/Tracking registry product boundary与Snapshot/Projection edit/delete
  consistency：保留为后续独立任务。

<!-- The remaining checklist is retained as the original planning record. -->

## Step 1 — Freeze and baseline

- 锁定当前 `runtime/event-analysis.js` 的 Event call graph、trace stages、
  public facade、owner patch、operation type、terminal supersede 与
  Snapshot/Tracking 顺序。
- 运行 Event/Runtime/identity/tracking/UI/Floor persistence/static-gate focused
  tests，保存 baseline。
- 风险：MEDIUM。

## Step 2 — Define the narrow attempt seam

- 新增 `runtime/character-event-analysis.js`，唯一 export 计划为
  `createCharacterEventAnalysis`。
- 输入为 plain `target`、`analysisInput`、final `worldModel`、`execution`、
  token 与 saved analysis；capabilities 逐项注入。
- 不注入整个 `event-analysis` coordinator，不引入 World module 或 Tracking
  instance，不移动 generic retry。
- 风险：HIGH；若无法形成窄 seam，停止。

## Step 3 — Move Event AI/identity/normalization/validation attempt

- old `runAnalysis` Event invoke → new module `runEventAttempt`。
- 保持 `analyzer.analyzeFloor` 参数、Event trace sink、identity options、
  deterministic IDs/source、state-fact materialization、empty classification、
  validation order 与 error codes。
- AI parser/domain functions留在 `ai/analyzer.js`、`core/events.js`、
  `core/identity.js`。
- 风险：HIGH；重点验证 parser/identity/empty/retry。

## Step 4 — Move successful Event complete workflow

- old `runAnalysis` retry `complete` → new module cohesive Event completion。
- 保持 `commitAnalysis`、dependency hash、`owner=event`、patch fields、
  `operation_type="event-analysis-patch"`、assertCurrent、readback、
  `CHARACTER_CANONICAL_*` ordering、Snapshot call、Tracking call和返回值。
- 具体 `commitFloorPatch`、Floor resolver、business DTO/readback capability
  仍由原 owner提供。
- 风险：HIGH；必须重点验证 canonical readback、siblings、stale/Swipe。

## Step 5 — Keep outer runAnalysis and terminal path

- `runAnalysis` 继续负责 World prerequisite、shared retry invocation、catch/
  cancellation/terminal persistence、finalize/status、Generation integration。
- `persistTerminalAttempt`、rollback、execution registry 与 retry classifier
  不搬、不复制、不重写。
- 风险：HIGH；验证 dual-owner analysis 和 late-result guard。

## Step 6 — Rewire composition only

- `runtime/event-analysis.js` 创建 Character/Event module并以窄能力调用。
- `runtime/events.js` public API、UI import/call方式不改。
- 不改变 Diagnostics/World/Event Editing/Tracking Runtime。
- 风险：MEDIUM。

## Step 7 — Verification and stop

- 运行用户要求的完整测试矩阵、`npm test -- --test-force-exit`、`npm run check`、
  `git diff --check` 与所有改动 JS 的 `node --check`。
- 若需要移动 generic retry、Generation、Floor traversal、Snapshot machinery、
  Persistence coordinator，或必须反向 import `event-analysis.js`，立即停止，
  报告 `NOT SAFE TO EXTRACT UNDER CURRENT SEAM`。
- 不进入下一 Phase。

## Forbidden changes during implementation

不得修改 Prompt/Input、Manual Character routing、identity semantics、retry
semantics、Persistence coordinator、Floor Version/Swipe policy、Generation
lifecycle、Snapshot/Projection behavior、Tracking semantics、tests期望或
Diagnostics API。
