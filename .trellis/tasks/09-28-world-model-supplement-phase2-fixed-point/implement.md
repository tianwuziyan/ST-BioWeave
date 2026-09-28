# Phase 2 执行计划

1. 读取并核对总稳定化方案与 Phase 1 结果；记录 branch、HEAD、worktree 和 1080/0 baseline。
2. 审计 `runWorldAnalysisJob()`、`runAnalysisStageWithRetry()`、Supplement analyzer/protocol 的真实 state machine、retry owner、target builder、review completeness 和 persistence callback。
3. 先写 generic regression/simulation，固定复现 new identity → dynamic target → no continuation → false complete/persistence，并覆盖 target ID/address 当前语义。
4. 以 canonical address 推导 stable target ID；复用现有 review grammar 与 permitted evidence，不改变 Fact parser/Guard contract。
5. 在 World Supplement 单次 execution 内实现 bounded transient continuation：每轮使用最新 transient candidate，重新计算 target set，收集 round diagnostics；只有当前 review complete 且 unresolved queue 为空才 fixed point。
6. 将 `NO_EVIDENCE`、`EMITTED`、Guard rejected、new identity expansion 和 budget exhaustion 分开计数；continuation 不得把 Guard rejection 改写为 NO_EVIDENCE。
7. 将 persistence/adoption 调用延后到 final fixed-point candidate；budget exhaustion fail closed，不写 Floor。
8. 运行 T1–T15 targeted tests、Phase 1 tests、`npm run check`、`node --check runtime/world-analysis.js`、`node --check ai/analyzer.js`、`node --check ai/world-supplement-protocol.js`、`git diff --check` 和 Trellis validation。
9. 检查实际 diff 与非目标边界，记录 `git status --short`，完成 Phase 2 后停止，不进入 Phase 3。

## Implementation record

- `runtime/world-analysis.js` now carries one transient Supplement candidate across the existing bounded Stage retry attempts. Each retry reuses the original permitted evidence input, recomputes canonical coverage addresses, records round summaries, and throws the existing retryable `WORLD_MODEL_SUPPLEMENT_INCOMPLETE` shape with `WORLD_MODEL_SUPPLEMENT_COVERAGE_NOT_AT_FIXED_POINT` diagnostics while dynamic targets remain unresolved.
- `ai/world-supplement-protocol.js` now derives coverage target IDs from the canonical `(scope, species, biological_type, field)` address rather than array position. Completeness can distinguish a raw EMITTED Fact rejected by the Guard from `NO_EVIDENCE`.
- `ai/analyzer.js` runs the existing Guard before completeness accounting for Supplement responses and returns bounded coverage dispositions. Guard rejection remains rejection; it is never rewritten as `NO_EVIDENCE`.
- `runtime/diagnostics.js` and the existing runtime diagnostics projection whitelist the bounded fixed-point fields (`coverage_*`, unresolved target IDs, dispositions, and round summaries).
- Generic runtime regressions cover new identity continuation, second identity continuation, `NO_EVIDENCE` convergence, stable IDs, and no intermediate Floor write. Existing Phase 1 generic Guard/scope tests remain unchanged and pass.

## Validation record

- Baseline: branch `fix/world-model-prompt-baseline`, HEAD `1056ebd7ea75aa2d1aadafdfe42875051b55e8d1`; pre-existing user modifications preserved.
- Targeted: `node --test tests/world-model.test.js tests/event-analysis-runtime.test.js` — 457 passed / 0 failed.
- Full: `npm run check` — 1081 passed / 0 failed. Phase 1 baseline was 1080 passed / 0 failed; the additional passing test is the Phase 2 Guard-rejected-EMITTED regression.
- Syntax: `node --check runtime/world-analysis.js`, `runtime/diagnostics.js`, `runtime/events.js`, `ai/analyzer.js`, and `ai/world-supplement-protocol.js` — all passed.
- `git diff --check` — passed.
- Trellis context validation — passed; only the existing context-size warnings for the two referenced spec files remain.

## Rollback boundary

只允许回退本 task 新增的 Phase 2 代码、tests 和 task docs；保留用户已有未提交修改、Phase 1 regression、总稳定化方案及其它 task。禁止 reset、clean、checkout、restore、commit、push。
