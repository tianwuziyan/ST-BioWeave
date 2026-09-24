# Phase G Generation Lifecycle Extraction — Future Implementation Plan

本阶段只完成 planning；下列步骤不得在未批准前执行。

## Step 0 — baseline

- 重新读取 `AGENTS.md`、Floor State Ownership Contract、Data Lifecycle Contract。
- 记录当前完整 lifecycle trace、public facade、listener count、scheduler state、
  `getAutoAnalysisSchedulerState()` shape。
- 运行现有 Generation/lifecycle/persistence focused tests，确认 baseline。

## Step 1 — establish the narrow seam

- 设计 `runtime/generation-lifecycle.js` 的唯一 factory
  `createGenerationLifecycle(...)`。
- 只注入 normalized target resolver、baseline/owner comparison capability、
  lifecycle serialization capability（如确实不能留在原 owner）、Generation trace
  sink、settled handoff callback。
- 禁止注入整个 `eventAnalysis`、Runtime、ST adapter 或 persistence coordinator。

## Step 2 — move lifecycle-only state

候选只包括 pending normal/Swipe intent、intent sequence、completed markers、
settle/supersede/Generation-specific diagnostics，以及对应的 start/CMR/ENDED/
stop/cancel/new-Swipe transition。

保留 `counter`、`retryPaused`、`lastFailure`、generic observed/count keys、Floor
snapshot、mutation invalidation、execution state 和 `lifecycleMutationChain`，除非
证明可独立拆分且不改变非-Generation event ordering。

## Step 3 — preserve dispatch boundary

- settle 后只调用原有 scheduler/pipeline handoff。
- 不由 lifecycle module 调用 World/Event/analyzer。
- 不改变 CMR→ENDED 或 ENDED→CMR 任一顺序。
- 不改变 existing Swipe reuse、new Swipe、reroll、continue、stale target、Chat
  switch、clear、destroy、disable 语义。

## Step 4 — wire through existing composition

- `runtime/runtime.js` 最多创建一个 Generation lifecycle instance 并注入窄能力。
- `runtime/events.js` 保持唯一 ST listener registration/unregistration。
- 保留 `eventAnalysis.handleLifecycleEvent` 的兼容入口，或通过单一 dispatch seam
  转发；不得产生第二 listener 或第二 Generation consumer。
- 保留现有 Runtime facade 和 `getAutoAnalysisSchedulerState` 返回结构。

## Step 5 — validation

必须运行：

- focused Generation/lifecycle/World-first/stale execution tests；
- `npm test -- --test-force-exit`；
- `npm run check`；
- Persistence static gate；
- 所有修改 JS 的 `node --check`；
- `git diff --check`。

若只改变 lifecycle 文件位置，且 Persistence transport、Floor ownership/version、
ST adapter、settle ordering 均未变化，则不要求 REAL ST + F5。

## Stop conditions

立即停止并报告 `NOT SAFE TO EXTRACT YET`：

- 必须改变 settle barrier 或 event ordering；
- 必须移动 execution ownership、generic retry、Floor policy、Persistence、host
  convergence、World/Event ordering 或 Input Ready semantics；
- 必须把 interval/retry scheduler 整体搬入新模块；
- 必须抽 ST adapter，创建第二 listener/consumer，注入整个 coordinator，或形成
  callback/import cycle；
- 无法维持 historical protections、diagnostic sequence 或 public API。

Phase G 完成后停止，不进入 Phase H。

## Phase G implementation result

- 新增 `runtime/generation-lifecycle.js`，唯一导出为
  `createGenerationLifecycle(...)`。
- 迁移 Generation-specific pending normal/Swipe intent、intent sequence、
  completed markers、settle barrier、CMR/ENDED consume、Generation supersede、
  stop/cancel cleanup 和 Generation trace emission。
- 保留 `runtime/events.js` 的全部 SillyTavern listener registration/
  unregistration；`runtime/event-analysis.js` 只将 host lifecycle event 转换为
  lifecycle capability 调用。
- 保留 execution ownership、generic retry、scheduler、Floor/Swipe/Version
  policy、Persistence、Snapshot、Tracking queue、Generation→World/Event handoff
  owner；settled handoff 仅调用原 `scheduleRenderedCharacter` capability。
- `runtime/runtime.js` 只新增 Generation factory construction/wiring；不持有
  Generation mutable state。
- focused Generation/Runtime/lifecycle/static-gate tests: 214/214 passed。
- full `npm test -- --test-force-exit`: 931/931 passed。
- `npm run check`: 931/931 passed；all changed JS `node --check` passed；
  `git diff --check` passed。
- Persistence implementation、ST adapter、public Runtime API、settle ordering 和
  Floor ownership/version semantics 未改变；REAL ST + F5 未执行（本 Phase 未触及
  其要求的边界）。
- 本 Phase 完成后停止，不进入 Phase H。
