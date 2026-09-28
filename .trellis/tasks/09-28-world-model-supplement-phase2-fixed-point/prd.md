# World Model Supplement Phase 2 Dynamic Coverage Fixed Point

## Goal

实现新 Biological Type identity 触发的 dynamic coverage bounded continuation、stable target accounting、fixed-point completeness 与最终 persistence gate；严格遵守总稳定化方案 Phase 2。

## Requirements

- 仅修复 Supplement Dynamic Coverage Fixed Point：accepted new identity → transient candidate → canonical target recomputation → bounded continuation → fixed-point completion。
- 复用现有 World stage retry/execution architecture；不得新建独立 API、candidate、persistence 或 execution pipeline。
- Review completeness、dynamic coverage pending、fixed point 和 final `complete` 必须在代码与 diagnostics 中分开表达。
- Target 集合比较必须使用 canonical address；同一 address 的 Target ID 必须跨 round 稳定，不能依赖 round-local 数组位置。
- `NO_EVIDENCE` 只能 disposition review target，不得写入 canonical model，也不得成为 evidence；`EMITTED` Fact 仍必须独立经过 resolver 和 Evidence Guard。
- 中间 round 只能更新 transient state；只有 fixed-point final candidate 才能进入既有 UI adoption / exact ACK / Floor persistence path。
- continuation 达到 bounded budget 仍未 fixed point 时，最终 `complete=false`、不持久化，并提供明确诊断。
- 继续保持 Phase 1 Evidence Guard、Scope Binding、Value Support、permitted evidence boundary 不变。

## Acceptance Criteria

- [ ] 记录并测试当前 broken state：new identity 后产生 dynamic targets，但 expansion round 为 0、fixed point 为 false，仍完成并持久化。
- [ ] 实现至少覆盖 no-mutation fixed、new identity expansion、NO_EVIDENCE convergence、EMITTED mutation、second identity expansion、budget exhaustion、stable IDs、Existing/Target 非 evidence、Guard rejection、no minimum Type cardinality 的 generic tests。
- [ ] continuation 使用最新 transient candidate 作为下一轮 Existing，并复用原 permitted evidence boundary。
- [ ] continuation 不是 target whitelist；仍允许发现新的 identity，并能继续扩张到下一 round。
- [ ] fixed point 只在 review accounting complete、accepted mutations merged、canonical targets 重算且无 unresolved dynamic targets 时成立。
- [ ] persistence 只发生在最终 fixed-point candidate；中间 round 不发布最终 candidate、不触发 Floor 写入。
- [ ] Phase 1 regression tests 保持通过；不修改 Full、UI Projection、Floor Coordinator、transaction key、canonical schema、Evidence Guard threshold 或 evidence boundary。
- [ ] 运行 targeted tests、`npm run check`、相关 `node --check`、`git diff --check` 和 Trellis validation；无新增 failure。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
