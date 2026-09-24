# Phase G Generation Lifecycle Extraction Planning

## Goal

以当前 Phase A–F 工作树为准，完整还原 Generation Settle Barrier、pending
generation intent、exactly-once consume、supersede、reroll/new Swipe、scheduler
与 host lifecycle 转发，并评估是否可以将真正的 Generation lifecycle orchestration
规划到 `runtime/generation-lifecycle.js`。

本阶段只做审计/设计，不创建该 production module，不修改现有代码、tests 或
项目 docs。

## Frozen contracts

- `final_character_floor_seen && generation_ended` 才能进入
  `GENERATION_SETTLED`。
- `CHARACTER_MESSAGE_RENDERED -> GENERATION_ENDED` 与
  `GENERATION_ENDED -> CHARACTER_MESSAGE_RENDERED` 两条顺序均保持 exactly-once。
- existing Swipe switch 不伪装成新 generation；new Swipe/reroll/continue 的
  ownership、supersede 和 Floor Version correlation 保持现状。
- Generation lifecycle 不拥有 execution maps、retry、Floor resolver/version
  policy、Persistence、Snapshot、Tracking、World/Event logic 或 ST transport。
- AI 前继续只要求现有 Analysis Input Ready 语义，不重新引入 official-owner
  convergence prerequisite；`saveChatConditional` resolved 不等于 durable。

## Scope

- 审计 `runtime/event-analysis.js` scheduler/lifecycle 状态机、
  `runtime/events.js` ST event subscription/facade、Phase F composition wiring，
  以及 Generation/lifecycle/persistence tests。
- 输出当前事件→状态→guard→next action、intent 字段、diagnostics、state owner、
  clear/destroy/chat-switch 行为、依赖边界与未来 MOVE/KEEP 清单。
- 判断推荐：`SAFE TO EXTRACT GENERATION LIFECYCLE`、`SAFE WITH NARROW SEAMS` 或
  `NOT SAFE TO EXTRACT YET`，并给出实施 stop conditions 与测试矩阵。

## Non-goals

- 不重写 Generation 状态机、优化自动分析、改变 World/Event 顺序或 retry。
- 不修改 Persistence、host-ahead handling、Floor ownership/version、ST Adapter、
  Analysis Boundary、Input Boundary、Snapshot/Projection 或 Tracking/UI semantics。
- 不进入 Phase H SillyTavern Adapter extraction。

## Acceptance Criteria

- [ ] 基于当前工作树完成用户要求的 A–AI 报告，含符号/文件证据。
- [ ] 明确 Generation 与 execution、analysis pipeline、Persistence、scheduler、
      ST subscription 的边界。
- [ ] 列出所有 generation-related mutable state 的当前 owner 与是否应移动。
- [ ] 提出最小 factory/API，不注入整个 `event-analysis` coordinator，不产生 cycle。
- [ ] 列出 Existing/Missing/Necessary-before-extraction tests 与历史回归保护。
- [ ] 本阶段没有修改 production code、tests、项目 docs，也没有开始 Phase G
      implementation。

## Decision gate

若形成窄 `onGenerationStarted` / `onCharacterMessageRendered` /
`onGenerationEnded` / settle callback seam 且不改变状态机，可进入后续实现；若需
移动 execution、scheduler 外的业务、Persistence/host handling 或修改 settle
ordering，必须判定 `NOT SAFE TO EXTRACT YET`。
