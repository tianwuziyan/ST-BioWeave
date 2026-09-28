# 实施计划：World Model Supplement UI ingress

## Phase 1：只读审计与基线

1. 固定当前 worktree 状态与已有用户改动边界；继续用 Git history 对照 `89a76da`、Candidate 引入后的提交和当前未提交 diff。
2. 完成函数级旧/当前 call graph，特别核对 `worldModelState` assignment、`buildWorldModelViewModel()`、`render()`、`renderWorldModelView()`、load generation、refresh in-flight/key、loading、tab 状态和 ACK。
3. 运行现有相关 tests，记录哪些测试只是 no-op/trace 顺序，哪些尚未证明真实 mutation 和 DOM values。

## Phase 2：最小实现（仅在 planning summary 获批准后）

1. 在 `ui/app.js` 复用或抽取 shared canonical UI ingress；保持现有 state shape、renderer 和 route 行为。
2. 调整 Candidate Adoption 的 metadata、render scheduling、ACK ordering 和 stale reload guard；不触碰 Floor Coordinator。
3. 让 Manual 与 Automatic 最终使用同一 application helper；保留 Manual/Automatic 上游触发差异。
4. 增加 pipeline diagnostic 的安全字段和必要 trace 汇总；不写完整模型。
5. 补充 generic real-mutation fixtures 与 T1-T15 targeted regressions，尤其是 deferred stale resolver、loading gate、closed/open tab、render observation、field continuity。
6. 若实现需要更新 domain contract，则同步更新 `.trellis/spec/domain/world-model.md`；同时记录实际 changed files 和未实现范围。

## 验证清单

- `node --check`：每个修改的 `.js` 文件。
- `node --test tests/phase2a-app.test.js tests/phase2a-ui.test.js tests/event-analysis-runtime.test.js tests/world-model.test.js`（按实际 test runner 兼容性调整为 targeted commands）。
- `npm run check`。
- `git diff --check`。
- 检查 `git diff -- storage/floor-persistence-coordinator.js` 为空，owner whitelist/transaction key 未改。
- 检查完整 `git status --short`，不 commit/push。

## 风险与回滚点

- 共享 helper 若误把 view-model 当 canonical fingerprint source，会造成 continuity 假阳性；测试必须分别比较 normalized canonical fingerprint、adoption payload、state canonical projection 和 rendered values。
- reload suppression 若只检查 success path，failure/settle path 仍可能清空 Candidate；T6 覆盖 resolve 与 reject 两种返回。
- 旧 UI route 未打开时不能以“不 render”误判失败；closed-tab 测试先检查 application state，再 route 到 World 检查 DOM。
- 任何发现需要改 Floor Coordinator 的情形先停止实现并报告 root-cause，不在本任务内重构。

## Phase 2 实施记录（2026-09-28）

历史 UI ingress call graph：

```text
Manual Patch result / WORLD_PERSISTENCE_CONFIRMED
  -> projectCommittedWorldModel()（Committed projection 路径）
  -> applyWorldModelUiIngress()
     -> normalizeStoredWorldModel()
     -> fingerprintWorldModel(canonical)
     -> buildWorldModelViewModel()
     -> fingerprintWorldModel(view-model)
     -> worldModelState（沿用旧 state，重置 loading/busy/selection/editor）
     -> render()（仅 open World tab）
        -> worldPage()
        -> renderWorldModelView()
  -> WORLD_UI_INGRESS_COMPLETED
```

`reloadWorldModelFromRuntime()` 也通过同一 ingress 应用合法 authoritative model。旧 resolver 在 committed projection 之后 settle 时只增加安全 suppression 计数，不覆盖更新的 Floor projection；stale protection 绑定 committed fingerprint、Floor Version 与 projection sequence。canonical `NO_CHANGE` 只清除操作 busy 状态，不创建持久化事务，也不执行 model ingress。

authoritative readback projection 在完成 `normalizeStoredWorldModel()`、
`buildWorldModelViewModel()` 与 fingerprint continuity 校验后提交
`worldModelState` 并触发已有 `render()`。UI projection failure 不会改变已确认
的 Floor transaction 状态。

定向回归使用 `tests/fixtures/world-model/ui-ingress.js` 的 generic mutation（`Species-A`、`Type-A`、`cycle = Value-A cycle`），覆盖：T1-T5/T10 shared state/fingerprint/closed-tab/loading、T6 stale resolve 与 reject、T7 queued authoritative readback、T8/T9 Manual/Automatic convergence、T11 open-tab render-before-ACK、T12-T14 canonical renderer fields 与 projection coverage、T15 no-op。

验证结果：`npm run check` 1102/1102；targeted UI/runtime/world-model tests 548/548；
`node --check` 所有修改 JavaScript 通过；`git diff --check` 通过。未修改
`storage/floor-persistence-coordinator.js`、owner whitelist 或 transaction key；未 commit、push、reset、clean。

## Evidence Scope Binding 修复（2026-09-28）

本次实测断点位于 Supplement completeness 之后的 Fact Resolution / Evidence
Guard。`factDeltaEvidenceUnitRecords()` 已构造 `parent_context`，但
`factDeltaEvidenceUnits()` 在 Guard 入口只保留文本，导致
`v2ScopedEvidenceUnits()` 无法消费可靠的 Species / Biological_Type 绑定，
并退回 heuristic scope 判断。

修复后，Fact Delta Evidence Guard 使用保留 `parent_context` 的
String-like evidence units：旧文本 matcher 保持兼容，scope binding 优先按
结构化 Species + Biological_Type 做精确匹配；缺失 Type、错误 Species、兄弟
Type 均不继承该 unit。scope 通过后仍使用原有 value support / Evidence Guard
阈值。新增 generic regression 覆盖 scope binding、sibling/species isolation、
value support rejection、supported/unsupported Type Identity，以及最终
`accepted_operation_count > 0`。

本次未修改 UI、Candidate Adoption、Supplement completeness、Prompt、Full、
API retry、canonical schema 或 Floor persistence。

## World Model Persistence Ownership 迁移（2026-09-28）

Persistence authority now stays in Runtime after canonical acceptance. The
validated candidate is published for diagnostics and persistence input, but no
longer waits for a UI adoption Promise or ACK. Runtime calls
`saveWorldModel()` -> `commitFloorPatch(owner="world")`, validates authoritative
readback, and emits `WORLD_PERSISTENCE_CONFIRMED` with the committed model.

The UI consumes that event through `projectCommittedWorldModel()` and the
existing `applyWorldModelUiIngress()` path. Its projection sequence and
committed Floor fingerprint protect against stale reload overwrite. Candidate
adoption state, the UI ACK export, and the UI-gated persistence edge were
removed; Candidate remains a transient validated canonical snapshot for
diagnostics, fingerprint checks, and persistence input.

The Host smoke issue where `Reproductive_Mechanism` completeness fails to match
an emitted Fact remains fail-closed and is intentionally outside this migration.
