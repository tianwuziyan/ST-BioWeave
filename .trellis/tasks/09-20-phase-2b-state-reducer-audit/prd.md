# Phase 2B Wave 0：Biological State Fact Contract

## Goal

在上一轮审计结论基础上，实施 Wave 0 Contract，使现有 BiologicalEvent 能够安全、确定性地表达后续 StateReducer 所需的 factual state transitions。完成 Contract 后停止；不实现完整 StateReducer。

## Scope

- 建立稳定 `state_fact` envelope：明确 canonical `subject_id`、有效 Story Time 与 type-specific factual payload。
- 为各 BiologicalEvent type 建立最低 factual payload 与严格 validator；不把 pregnancy/conception 字段放入所有 Event 的公共层。
- 正式定义 reproductive episode identity，解决 pregnancy A → delivery → pregnancy B 的确定性区分。
- 定义 Event status applicability、Story Time comparability、provenance/story ordering 与 duplicate Event identity policy。
- 建立最小 `characterFacts` DTO，不让 Reducer 依赖 Tracking Registry 数据结构。
- 同步 AI Prompt/Parser/Normalizer/Validator/Fixtures/Tests/Domain 文档，保持单一新 contract。

## Hard Constraints

- User message 永远不是 BioWeave Floor；只有当前有效 Character/assistant Floor、active Swipe、完整有效 Floor Version 的 facts 可进入 Runtime input。
- Reducer 不读取 AI、UI、SillyTavern message、Chat metadata，不扫描 Floor，不调用随机数或系统时间，不写 Floor/Chat metadata，不重新解析 Narrative。
- 不实现完整 `core/state.js` transition engine；不进入 Snapshot、Projection、UI State、Context Injection、Genealogy。
- `sexual_activity` 的非-exposure Event 不强制 state fact；有效 pregnancy-relevant exposure 继续使用当前 `pregnancy_relevance` contract，避免重复存储。
- `possible_conception` 永远不等于 conception confirmed。
- 不使用 display name、gender、event_role 或 participants 顺序推断 subject/identity。
- 不复制 Tracking eligibility、mechanism matching 或 `resolveCarryingCapability()` 到 StateReducer。
- 不使用 legacy migration、compatibility alias、dual-read 或 dual-write。

## Acceptance Criteria

1. 所有会改变 CharacterState 的 Event 都有明确 canonical `subject_id` contract；缺失 subject 的 Event validation 失败。
2. Event payload 按 type 严格校验；conception、pregnancy、termination、delivery、postpartum、cycle、fertility、symptom、medical 等不再以 minimal shape 通过。
3. exposure 的 Phase 2A.1 schema、Tracking eligible/pending/ineligible 逻辑与多 subject/source contract 全部保持通过。
4. `possible_conception` 不产生 conception fact；不新增 fertility capability aliases 或 user override。
5. 明确 pregnancy/reproductive episode identity 的创建、引用、冲突和 deterministic ID 策略。
6. 明确 Event status、Story Time comparability、两种 ordering 与 duplicate Event identity policy。
7. 提供最小 `characterFacts` contract；不要求 StateReducer 依赖整个 Tracking Registry。
8. 新增/更新 Wave 0 测试及文档；`npm run check` 全部通过。
9. 不实现完整 `core/state.js` Reducer、Snapshot、Projection 或 UI State。

## Out of Scope

完整 StateReducer transition engine、Snapshot persistence/recovery、Projection/Probability Resolver、Context Injection、Genealogy、AI state inference、automatic AI recalculation、UI State implementation。
