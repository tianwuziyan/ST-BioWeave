# Phase F Runtime Composition Cleanup Planning

## Goal

以当前工作树为准，审计 BioWeave Runtime 的 feature construction、capability
wiring、public facade、mutable state ownership 与 destroy/clear wiring，并规划
一个轻量、无业务语义的 Runtime composition boundary。

本阶段只输出规划，不新增 `runtime/runtime.js`，不移动代码，不改变任何业务
顺序或既有 API。

## Scope

- 覆盖 Phase A–E 后的 `runtime/events.js`、`runtime/event-analysis.js`、
  `runtime/world-analysis.js`、`runtime/character-event-analysis.js`、
  `runtime/event-editing.js`、`runtime/tracking-runtime.js`、
  `runtime/diagnostics.js`、`runtime/floor-persistence.js`。
- 核对 Storage persistence coordinator、SillyTavern adapter、UI facade、
  lifecycle 与相关测试入口。
- 区分 composition（创建、注入、组装）与 orchestration（World→Event、retry、
  generation、snapshot、tracking、terminal、clear）。
- 评估 `runtime/runtime.js` 是否值得引入；若可行，只规划最小 factory/facade
  seam，不建立 service container 或通用 DI framework。

## Frozen behavior and non-goals

- 不修改 Manual Character→World AI routing、Event input、Prompt、Generation
  lifecycle、Persistence、Snapshot/Projection、Tracking/UI semantics。
- 不移动或重写 SillyTavern transport：`createSillyTavernAdapter`、official
  owner acquisition/bootstrap/readback/save 等留在当前边界，后续另做 Adapter
  Phase。
- `storage/floor-persistence-coordinator.js` 继续是普通 Floor persistence
  owner；composition 只能创建或注入 capability。
- 不移动 execution maps、scheduler、invalidated Floor、retry loop、terminal
  writer、general derived state 或 Snapshot machinery 到 composition root。
- Runtime public facade、UI/lifecycle 调用方式、static persistence gate contract
  必须兼容。

## Acceptance Criteria

- [ ] 以当前工作树真实代码记录 A–X 审计结论与关键符号路径。
- [ ] 绘制 current composition graph，并列出每个 feature 的 construction site、
      injected capabilities 与 mutable state owner。
- [ ] 明确 `runtime/events.js` 与 `runtime/event-analysis.js` 的职责边界，尤其
      区分 host integration、facade、composition、pipeline/execution。
- [ ] 给出 `runtime/runtime.js` 的最小候选 API；若当前 seam 不足，明确禁止
      强行引入以及需要的窄 seam。
- [ ] 评估 import/callback circular dependency、destroy/clear、settings/enabled
      和 static gate 影响。
- [ ] 列出实施阶段的回归测试与 stop conditions。
- [ ] 本阶段没有修改 production code、tests 或项目 docs，没有开始 extraction。

## Decision gate

最终只选择：`SAFE TO EXTRACT COMPOSITION ROOT`、`SAFE WITH NARROW SEAMS` 或
`NOT SAFE TO EXTRACT YET`。只有在不把 `event-analysis.js` 的私有 pipeline state
提升为全局 service、且不引入第二套 persistence/retry/execution 机制时，后续
Phase F implementation 才可开始。
