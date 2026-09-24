# Phase D — World Analysis Extraction Planning

## Goal

根据当前工作树真实代码，规划把 World Analysis Runtime orchestration 从
`runtime/event-analysis.js` 归位到 `runtime/world-analysis.js`，只改变代码
ownership，不改变 World/Event、Generation、Tracking、Persistence、Prompt/Input
或 UI 行为。

## Confirmed current facts

- `runtime/event-analysis.js` 当前同时承载 World resolution、World Full/Patch
  workflow、World retry invocation、World save/readback/readiness、Event Analysis、
  Generation lifecycle、Snapshot/State、Tracking 输入与业务 DTO。
- World Runtime public entry points 由 `runtime/events.js` facade 暴露：
  `resolveWorldModelAtOrBefore`、`resolveWorldModelStrictlyBefore`、
  `saveWorldModel`、`analyzeCurrentWorldModelFull`、
  `analyzeCurrentWorldModelPatch`。
- World domain/AI 能力已经在 `ai/analyzer.js` 与 `ai/prompts.js`；当前没有
  独立的 `core/world-model.js`。
- World persistence 通过注入的 `commitFloorPatch` 到现有
  `FloorPersistenceCoordinator`，World owner patch 是
  `{world_model, world_model_meta}`；Coordinator、Floor Version、Swipe、
  readback 与 owner policy 不属于本 Phase。
- `runAnalysisStageWithRetry` 同时被 World 与 Event 使用，不能整体搬入
  World module。
- `resolveFinalWorldModelForAnalysis` 同时是自动 Event pipeline 的 World
  prerequisite resolver；当前 Manual Character/automatic analysis 的边界行为
  只审计、不修复。
- UI 只通过 Runtime facade 使用 World resolver/save/analyze API；不应直接依赖
  新模块。

## In scope

1. 完整盘点 World Runtime call graph、Full/Patch、resolution、readback、
   readiness、retry 与 auto/manual callers。
2. 识别可安全注入的 Runtime capabilities，并提出最小
   `createWorldAnalysis(...)` API。
3. 规划 `runtime/world-analysis.js` 的 cohesive responsibility、old → new
   映射、依赖方向、迁移顺序与回滚点。
4. 明确必须继续留在 `runtime/event-analysis.js` 的 shared/generation/event/state
   能力与风险。

## Out of scope

- 不修改 production code、tests、docs、Diagnostics、Event Editing 或 Tracking
  Runtime。
- 不修 Manual Character 触发 World 的 boundary bug，不修 Prompt/Input contamination。
- 不改变 retry count、execution guard、Generation Settle Barrier、scheduler、
  Event stage、Tracking refresh、Snapshot/StateReducer、Projection 或 UI semantics。
- 不修改 `storage/floor-persistence-coordinator.js` 或任何 persistence transport,
  owner acquisition, bootstrap, readback, stale guard, Swipe ownership 或
  transaction serialization。

## Acceptance criteria for the planning report

- 报告回答用户要求的 A–T 项，并以当前工作树路径/符号为证据。
- 明确 Full、Patch、`resolveFinalWorldModelForAnalysis`、manual World、auto
  World stage 与 Event stage 的真实调用时序。
- 明确 World Analysis、AI、World domain、Persistence、Generation、Event 的边界。
- 提出的目标模块不反向 import `event-analysis.js`/`events.js`，且不拥有通用
  retry、Floor resolver、Persistence coordinator、Generation scheduler 或
  Snapshot machinery。
- 给出 HIGH/MEDIUM/LOW 风险、回归测试矩阵、迁移顺序、follow-up issues，且
  在规划阶段不启动实现。

## Blocking open questions

无。当前代码证据足以形成纯审计/规划结论；后续实现是否批准由用户审阅最终
planning summary 决定。
