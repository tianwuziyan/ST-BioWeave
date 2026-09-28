# World Model Supplement Phase 2.1 Retry Continuation Contract Repair

## Goal

修复 Supplement 自动重试输入膨胀、Review accounting 与 mutation acceptance 混淆，以及 retry/continuation 无法稳定形成最终 candidate 的问题；保持 Phase 2 fixed point 与 Phase 1 Guard 不变量。

## Requirements

- 修复 Initial、Completeness Retry、Coverage Continuation 三类 Supplement request envelope，使它们共享 evidence、transient Existing、当前 targets、identity subjects 与 Fact Delta contract；差异仅保留 bounded directive。
- Host-only completeness diagnostics、identity diversity、execution history、raw rejected operations 不得进入模型 user prompt；retry 只传最小 reason/Target_ID。
- 分离 review accounting 与 mutation acceptance：`NO_EVIDENCE` 是已完成 review 且无 mutation；`EMITTED + accepted` 是 review 完成且 mutation accepted；`EMITTED + rejected` 是 review 完成但 mutation rejected。
- 区分 recoverable response-contract retry、transport/API retry、evidence rejection 与 dynamic coverage continuation；重复 Guard rejection 必须受既有 retry budget 限制。
- 保持最终 candidate gate：中间 retry/continuation 不创建 final candidate、不进入 UI adoption 或 persistence；只有 fixed-point terminal state 才进入既有流程。
- 保持 Full、Phase 1 Evidence Guard/Scope Binding/Value Support、permitted evidence boundary、canonical schema、Candidate Adoption 与 Floor persistence 架构不变。
- 所有新增 fixture 只能使用 `Species-A`、`Species-B`、`Type-A`、`Type-B`、`Type-C`。

## Acceptance Criteria

- [ ] 记录三类 request envelope 的 before/after 字段组成，并证明 Host diagnostics 不进入 user prompt。
- [ ] completeness retry 与 coverage continuation 使用明确且不同的 directive/state，且都复用同一 bounded execution/retry owner。
- [ ] Review 与 mutation 状态可分别诊断 `NO_EVIDENCE`、accepted `EMITTED`、rejected `EMITTED`。
- [ ] 同一 Guard rejection 不会无限重试；budget exhausted 时 deterministic fail closed、candidate 为 null、无 persistence。
- [ ] accepted identity continuation 仍达到 Phase 2 fixed point，并形成唯一 final candidate。
- [ ] 添加 bounded request-size diagnostics，不记录完整 prompt 或敏感 evidence。
- [ ] Phase 1/Phase 2 regressions 保持通过；运行 targeted tests、`npm run check`、适用 `node --check`、`git diff --check` 与 Trellis validation。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
