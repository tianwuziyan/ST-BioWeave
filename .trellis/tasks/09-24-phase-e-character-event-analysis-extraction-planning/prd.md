# Phase E — Character / Event Analysis Extraction Planning

## Goal

以当前工作树（包含 Phase A–D）为准，审计 `runtime/event-analysis.js` 中
Character/Event Analysis 的真实 orchestration，并规划将其归位到
`runtime/character-event-analysis.js` 的最小、可验证 seam。

本阶段只输出审计/设计计划，不开始 extraction。

## Confirmed scope constraints

- 不修改 production code、tests、docs、Diagnostics、World Analysis、Event
  Editing 或 Tracking Runtime。
- 不修 Manual Character 触发 World AI、Event input contamination、Prompt
  boundary、identity semantics、retry semantics、Persistence、Generation
  lifecycle、Snapshot/Projection 或 Tracking product semantics。
- `storage/floor-persistence-coordinator.js` 及 owner acquisition、host-ahead
  bootstrap、authoritative readback、sibling preservation、Swipe/Floor Version
  guard、transaction serialization、terminal supersede 均冻结。
- Runtime facade 与 UI 调用方式必须兼容。

## Planning requirements

- 用当前代码确认完整入口与 call graph，而不是按函数名机械归类。
- 明确 Character 与 Event 当前是否同一 AI stage、同一 owner patch，以及
  `character_registry` 与 Tracking registry 的区别。
- 区分 AI parser/domain normalization、Event-specific orchestration、shared
  retry/execution/persistence/readback、Snapshot bridge 与 Tracking refresh。
- 明确 `runAnalysis` 是否继续留在 `runtime/event-analysis.js` 作为 pipeline
  coordinator；目标不是把整个 coordinator 搬走。
- 提出不反向 import `event-analysis.js`、`events.js`、`world-analysis.js`
  实现、Event Editing、Tracking Runtime instance 或 concrete Coordinator 的
  最小 API。

## Acceptance criteria

- [x] 已读取当前 Phase A–D 工作树及 Floor ownership/lifecycle contracts。
- [x] 报告覆盖用户要求的 A–X 项，包含证据路径/符号、风险、测试矩阵和
  follow-up issues。
- [x] 明确 Event owner patch、operation type、terminal dual-owner contract
  与 post-success Snapshot/Tracking 顺序必须保持不变。
- [x] 明确目标模块不能拥有 generic retry、Floor resolver、Persistence
  coordinator、Generation lifecycle、Snapshot machinery 或 Tracking
  implementation。
- [x] 规划阶段没有修改 production code、tests 或 project docs，也没有开始
  extraction。

## Recommendation gate

只有在能形成窄的 Event-specific attempt/complete seam、且不需要新建第二套
retry/persistence/execution framework 时，后续才可进入 Phase E implementation。
