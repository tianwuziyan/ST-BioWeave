# Phase D World Analysis Extraction Implementation Record

本 Phase 已完成实施；不进入 Character/Event extraction。

## Completed

- 新增 `runtime/world-analysis.js`，唯一 module export 为
  `createWorldAnalysis`。
- 将 World query、Full/Patch workflow、World job deduplication、World AI
  orchestration、metadata、World persistence invocation、canonical readback、
  UI-ready gate、World status publication 和
  `resolveFinalWorldModelForAnalysis` 归位。
- `runAnalysisStageWithRetry`、Floor resolver/version policy、execution
  registry/cancellation、Generation lifecycle、Event stage、Tracking、Snapshot、
  StateReducer 与 Persistence coordinator 保持原 owner。
- Runtime facade API、World owner patch、operation types、status/trace ordering、
  Manual Character 当前行为保持兼容。

## Verification

- Focused World/Runtime/UI/Persistence tests: 457 pass, 0 fail。
- `npm test -- --test-force-exit`: 931 pass, 0 fail。
- `npm run check`: 931 pass, 0 fail。
- `node --check runtime/world-analysis.js`: pass。
- `node --check runtime/event-analysis.js`: pass。
- `git diff --check`: pass。

## Scope review

- `storage/floor-persistence-coordinator.js` 未修改。
- 无 direct host save、Floor Version policy、Swipe ownership 或 readback 实现搬迁。
- 无测试期望、Prompt/Input、Diagnostics、Event Editing、Tracking Runtime 或
  Generation lifecycle 修改。
- `runtime/world-analysis.js` 无反向 import `event-analysis.js`、`events.js`、
  Event Editing、Tracking Runtime 或 concrete Persistence coordinator。

## Ordered migration steps

### Step 1 — Freeze current contracts

- 记录当前 `runtime/event-analysis.js` World symbols、Runtime facade exports、
  UI calls、World status payloads、trace stages、owner/operation types 和
  `runAnalysis` → World → Event 时序。
- 运行当前 World/Runtime/UI/Floor persistence focused tests，作为 extraction
  前基线。
- 风险：MEDIUM。

### Step 2 — Introduce the World capability seam

- 新增 `runtime/world-analysis.js`，只从现有 AI/World helpers 接收或导入纯
  World transform capability。
- 由 Runtime composition 注入现有 Floor resolver/readback、token/currentness、
  execution guard、invalidated-floor access、notification/trace、retry wrapper
  和 `commitFloorPatch` capability。
- 不复制 `resolveFloorAtIndex`、Floor Version policy、Persistence coordinator、
  `runAnalysisStageWithRetry`、Generation state 或 Event Analysis。
- 风险：HIGH。

### Step 3 — Move canonical World read/resolution

- 将 `resolveWorldModelAtOrBefore`、strict-before facade、World UI-ready
  readback 与 World-specific error mapping 归位。
- 保持 UI、Tracking input、Event input 的现有调用面，只在 Runtime composition
  改变内部引用。
- 风险：HIGH；重点验证 active Swipe、六字段 Floor Version、历史 Floor 和
  stale/deleted owner fail-closed 行为。

### Step 4 — Move Full/Patch job workflow

- 将 `worldInFlight`、`runWorldAnalysisJob`、World status phases、Full/Patch
  analyzer invocation、normalize/merge、metadata、automatic save、canonical
  readback 和 terminal status 归入新模块。
- 使用注入的通用 retry wrapper；不复制或重写 retry policy。
- 保留 World owner patch、operation types、persistence owner claim 和所有
  assert-current 顺序。
- 风险：HIGH。

### Step 5 — Move conditional World prerequisite resolver

- 将 `resolveFinalWorldModelForAnalysis` 接到新模块。
- 通过窄 capability 更新 `execution.stage/phase`、读取 signal/controller、
  进行 currentness assertion 和清除 target invalidation；不把完整 execution
  object 的业务所有权交给 World module。
- 保持 automatic Event Analysis 调用位置、reuse/full/patch 选择和错误映射。
- 风险：HIGH；如无法形成窄 seam，停止并报告
  `NOT SAFE TO EXTRACT UNDER CURRENT SEAM`。

### Step 6 — Re-compose public Runtime facade

- `runtime/events.js` 继续暴露同名 World API；UI 不直接 import 新模块。
- `event-analysis.js` 保留 Event/Generation/Tracking/State/Snapshot/clear
  workflow，并使用注入的 World capabilities。
- 风险：MEDIUM；禁止改变公共 DTO、Promise 返回值、通知 payload 或调用顺序。

### Step 7 — Verify and review diff scope

- 运行 focused World Model, Event Analysis Runtime, Runtime, phase2a app, UI,
  retry, Floor persistence coordinator/static gate tests。
- 对全部变更 JS 运行 `node --check`，运行 `npm test -- --test-force-exit`、
  `npm run check`、`git diff --check`。
- 检查 diff 只能是模块新增、导入/组合替换、调用引用替换和必要的 seam；不
  接受条件表达式、operation type、owner、patch shape、retry 或 lifecycle
  ordering 变化。
- 风险：HIGH。

## Stop conditions

立即停止，不扩大范围，如果需要：

- 修改 `storage/floor-persistence-coordinator.js` 或任何 save/readback/bootstrap
  transport；
- 移动/复制 `runAnalysisStageWithRetry`、Floor traversal、Floor Version policy、
  Generation Settle Barrier、scheduler、Event stage、Tracking Runtime、Snapshot
  或 StateReducer；
- 修改 World/Event boundary、Prompt/Input、retry semantics、UI semantics、
  public Runtime API 或 Diagnostics API；
- 改变任何 World persistence operation type/owner/patch/readback order；
- 改变 `WORLD_ANALYSIS_STATUS_CHANGED` payload/stage ordering，或使 Event stage
  在 World canonical readiness 之前继续；
- 产生对 `event-analysis.js`、`events.js`、Event Editing、Tracking Runtime 或
  concrete persistence coordinator 的反向 import。

## Required acceptance matrix

- Manual World Full/Patch and manual section/collection save.
- Automatic World Full/Patch, valid existing World reuse, update-signal patch,
  and World retry/exhaustion.
- Chat change, active Swipe change/deletion, stale six-field Floor Version,
  cancellation/supersede, and missing/deleted target.
- `{world_model, world_model_meta}` sibling preservation and authoritative
  readback.
- World status running/readback/ui-ready/success/failure and Event stage ordering.
- Current Manual Character behavior remains unchanged, including current World
  coupling; no test expectation may be rewritten to hide a regression.
- Tracking refresh timing, Snapshot/StateReducer/Projection outputs, and
  persistence static gate remain unchanged.

## Real-host validation boundary

Pure code relocation does not by itself require dedicated ST + F5 validation.
If implementation touches any Persistence transport, owner acquisition,
bootstrap/readback, Swipe ownership, Floor Version policy, or lifecycle ordering,
stop the extraction and require real-host/F5 validation under a separate approved
scope.
