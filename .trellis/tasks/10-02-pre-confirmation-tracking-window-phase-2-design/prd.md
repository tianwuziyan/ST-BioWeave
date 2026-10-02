# PRE-CONFIRMATION TRACKING WINDOW PHASE 2 DESIGN

## Goal

在不改变 Phase 1 冻结语义的前提下，设计 World-authoritative Tracking
Window horizon 与 Story-Time-only lifecycle evaluation：普通 Character
Floor 推进可以只执行 deterministic Window/Projection lifecycle，不触发
Character/Event Analysis、World Analysis 或 Projection AI generation。

## In scope

- World Model 中声明 pregnancy-relevant reproductive mechanism 的 Tracking
  Window horizon。
- Full Analysis、Supplement/Patch 对 horizon 的新增、保留、修正和失效
  语义。
- `open → expired` 的 deterministic Story-Time evaluation。
- expired 后 Tracking Subject/Candidate 与 pre-confirmation Projection
  Eligibility 的更新。
- active pre-confirmation Projection 的 deterministic lifecycle/context bridge。
- F5、Chat reopen、普通 Character Floor、edit/delete、reroll、Swipe、rebuild
  下的 identity、owner、version、single-flight 与 forward-only 行为。
- 不依赖 scheduler interval 的 lifecycle-only tick orchestration。

## Frozen constraints

- Timing `window_missed` != Tracking Window `expired`。
- Human 14/42 timing preset 不是 Window horizon。
- 不使用现实医学 Runtime fallback。
- `expired` != `resolved_not_pregnant`。
- Window 不制造 factual pregnancy/negative fact；Projection 不制造 Window
  factual transition。
- World Model 仍是 horizon authority。
- 普通 Story-Time tick 不调用 Character/Event Analysis、World Analysis 或
  Projection AI。
- Phase 1 identity、grouping、terminal factual statuses、Floor/Swipe owner、
  Timing binding 和 Characters compatibility 不重新设计。

## Acceptance criteria for design

- [ ] 明确 horizon 在 World declarative contract 中的 canonical location、
  identity、值域和缺失语义。
- [ ] 明确 Full/Patch 新增、保留、修正 horizon 的 fail-closed 规则。
- [ ] 明确 lifecycle-only tick 的 owner、输入、触发点、single-flight 和
  禁止调用边界。
- [ ] 明确 Window expiration、Tracking filtering、Projection eligibility、
  active Projection lifecycle/context 的 owner 分工。
- [ ] 明确 persistence/readback/rebuild/edit/delete/reroll/Swipe/F5 语义。
- [ ] 设计文档列出所有真正仍需产品决定的问题，不能把技术猜测写成冻结
  产品语义。

## Out of scope

- Phase 1 重审、Phase 1 冻结语义变更。
- World Model fixture failures 与 unrelated flaky 修复。
- 现实医学时长、GA/EDD、negative pregnancy resolution、Window Context
  injection redesign。

## Implementation authorization

本 task 已进入 implementation。允许按本 PRD、audit、design、implement
和既有 check 基线修改 production、schema、tests、docs/spec；不得扩大到
Phase 1 重审或 unrelated World fixture 修复。
## Current planning status

DESIGN_READY。已冻结：horizon 修正只影响仍为 open 的 Window 与未来新
Window；expired、resolved_pregnant、terminated 均为 forward-only terminal，
不得因 Full/Patch horizon 修正重新 open。
