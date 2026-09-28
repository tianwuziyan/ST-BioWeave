# 修复 World Model Supplement 到 UI 的共享 ingress 链路

## Goal

当 World Model Supplement 产生真实 canonical mutation（`accepted_operation_count > 0` 且 `canonical_mutation_occurred === true`）时，Candidate 必须稳定进入现有 World Model UI application state 并显示。Manual 与 Automatic 必须共享同一套 canonical → UI ingress；双端口只负责 Candidate OUT、UI Adoption/ACK 和持久化握手，不建立第二套 renderer/state model。

## Confirmed repository facts

- 历史成功路径位于 `89a76da`：`ui/app.js` 的 `analyzeWorldModel()` 等待 Runtime 结果，执行 `normalizeStoredWorldModel()`，然后直接把 canonical model、meta、busy/operation/selection/editor 等状态写入 `worldModelState`，最后在 World route 调用 `render()`；Runtime 的 `runWorldAnalysisJob()` 在 `runtime/event-analysis.js:1389-1570` 负责分析、`saveWorldModel()`、readback 和 `buildWorldModelViewModel()`。
- 历史 UI 读取路径是 `render()` → `worldPage()` → `renderWorldModelView()`；后者再次经过 `buildWorldModelViewModel()`，并由 `ui/world.js` 读取 species/type、description、capabilities、reproduction rules、lifecycle、special rules、reproductive mechanisms、medical context、exceptions、unknowns 和 projection rules。
- 当前 Candidate 入口是 `ui/app.js:1858` 的 `adoptWorldModelCandidate()`，由 `WORLD_ANALYSIS_CANDIDATE_READY` 事件触发（`ui/app.js:4478-4480`）。它已做 candidate fingerprint 校验、`buildWorldModelViewModel()` 和 `worldModelState.model` assignment，但当前 ACK 发生在 render 之前（`ui/app.js:1901-1909` vs `1931`），且仍需逐项复核旧路径的 state side effects。
- 当前 authoritative reload 为 `reloadWorldModelFromRuntime()`（`ui/app.js:1953-2143`），使用 `worldModelLoadGeneration` 与 `worldModelCandidateAdoptionSequence` 抑制 Candidate 之后返回的旧 Floor 结果；该机制需要真实 deferred resolver 测试确认不会被 loading gate、生命周期刷新或 failure path 绕过。
- 当前 Runtime Candidate 在 `runtime/world-analysis.js:283-413` 发布并等待 ACK；真实 mutation 之后才进入 `saveWorldModel()` 和现有 `commitFloorPatch()`。`storage/floor-persistence-coordinator.js` 是本轮只读审计对象，除非证据表明 stale reload 直接由它导致，否则不得修改。
- 当前 worktree 已有用户未提交改动（包括 World Supplement、Candidate Adoption、UI diagnostics 与测试）；本任务只能在现状上做窄范围增量，不能回滚或覆盖这些改动。

## Requirements

1. 先完成 Git 历史对照，记录 LAST KNOWN GOOD UI PATH 与 CURRENT SUPPLEMENT UI PATH，函数级回答旧 ingress、state/generation/loading/refresh side effects、view-model/render 触发、closed/open tab 行为、双端口替换边与丢失行为。
2. 真实 mutation fixture 使用 generic `Species-A` / `Type-A` / `Cycle = Value-A` 等值；必须证明 accepted operation count 与 canonical mutation，而不是以 no-op 作为 UI 成功依据。
3. 保持 canonical fingerprint 连续性：candidate、UI adoption payload、`worldModelState.model`（按 canonical fingerprint 规则）一致；如 view-model/DOM 不一致，测试需定位首个断点。
4. Candidate adoption 必须复用历史成功 UI application semantics，更新完成所需的 state metadata，并在合法 Candidate adoption 后触发现有 World render/refresh；loading 为 true 不能静默跳过。
5. ACK 只能在 Candidate 校验、canonical UI state adoption、必要 metadata 更新和 render refresh 已安排/完成后发送；ACK 不要求浏览器 paint，但必须证明 application-state adoption。
6. 防止旧 Floor reload、旧 generation、旧 execution 或通用 refresh 覆盖较新的 Candidate；已确认 persistence/readback 的新 authoritative Floor 仍可正常 reconciliation。
7. Manual 与 Automatic 的 canonical → UI application semantics 必须统一；上游触发方式可以不同。
8. 保持 canonical no-op 不创建 Candidate、不 adoption、不产生伪 UI mutation。
9. 增加 pipeline diagnostic，记录 execution/revision/fingerprint、ingress 前后、load generation、render requested/completed、rendered revision/model fingerprint、stale suppression count 和 ACK fingerprint，但不记录完整 World Model。
10. 不修改 Supplement completeness/fixed-point、API parity、Evidence Guard、Scope Binding、Value Support、canonical schema、Full/重新分析、Floor Coordinator 等非直接阻断范围。

## Acceptance Criteria

- [ ] 历史与当前函数级 call graph、双端口迁移丢失边和最终修复 call graph 已落库并可在最终报告中回答。
- [ ] T1 historical ingress equivalence：旧成功 UI application semantics 与 Candidate Adoption 对同一 canonical model 产生等价 state/view/renderable result。
- [ ] T2/T3/T4/T5：真实 mutation 能 adoption；candidate/adoption/state fingerprint 连续；adoption 触发 render；loading 状态不跳过。
- [ ] T6/T7：旧 Floor N-1 reload 不能覆盖 Candidate N；新 authoritative Floor N readback 可 reconciliation。
- [ ] T8/T9：Manual 与 Automatic 真实 mutation 进入同一 shared UI ingress。
- [ ] T10/T11：closed tab 先进入 application state，打开后可显示；open tab adoption 后立即刷新/render。
- [ ] T12/T13/T14：普通字段、collection 字段以及 species description、reproductive mechanism、projection rule 至少各有真实 renderer regression 覆盖，并覆盖其余当前 canonical renderer 字段的传递检查。
- [ ] T15：canonical no-op 不创建 Candidate、不 adoption、不伪造 render mutation。
- [ ] `npm run check`、相关 targeted tests、所有修改 JS 的 `node --check <file>`、`git diff --check` 均通过。
- [ ] `storage/floor-persistence-coordinator.js`、owner whitelist、transaction key 未改；无 commit/push。
- [ ] 最终报告包含完整 Git status、旧/当前/修复后路径、fingerprint 结果、stale reload 结论、Manual/Automatic 收敛结论、canonical fields、测试结果和未实现范围。

## Scope boundary

本轮只处理 Supplement Fact Delta → accepted operations → canonical candidate → UI adoption → existing World UI render 的链路。发现其他系统问题只记录，不顺手修复；Floor 仍严格走 `UI adoption → ACK → Runtime persistence → saveWorldModel() → commitFloorPatch(owner="world") → existing Floor Persistence Coordinator`。
