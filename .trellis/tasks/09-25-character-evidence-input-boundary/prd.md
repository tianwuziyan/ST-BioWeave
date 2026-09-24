# 修复 Character Evidence Input Boundary

## Goal

审计并设计从 Character Card、Persona、Worldbook、External Memory 到 Event Analyzer 的最小 Character Evidence semantic projection，恢复人物稳定证据且不回退 raw host 输入边界。

## Background and confirmed facts

- 基准比较为 `16b8dbb7669bfe92b6cd545a544d9aef533e651f` → 当前 HEAD `bec4320b6fc45e570a9cf6ab661e269b3d721acc`；当前 worktree clean。
- `bec4320b` 在 `ai/input-builder.js` 将 Event 的窄输入收敛为 `identity_context`、`individual_evidence`、`world_model`、`existing_events` 与 narrative；在 `ai/prompts.js` 将 Event references 收敛为这些 projection，移除了 raw Character Card、Persona、Worldbook、External Memory formatter。
- Runtime 的 `commonInput` 仍由 `collectAnalysisContext()` 生成并保留 `character`、`persona`、`worldbooks`、`external_memory`；`defaultCharacterContext()` 仍保留 `current_character`、`character_card`、`profiles`。因此根因不是 source collection 删除，而是 Event semantic projection 不等价：`projectEventIndividualEvidence()` 当前只读取 `characterContext.profiles`。
- 现有 `tests/context-prompt.test.js` 已验证 raw world sources 不进入 Event prompt，但没有验证 Character Card/Persona 的稳定生理证据是否出现在最终 `buildEventAnalysisMessages()` 的窄 projection 中。
- 当前测试基线：`node --test tests/context-prompt.test.js tests/event-analysis-runtime.test.js` 通过，194/194；测试中的预期错误日志属于既有故障注入场景，不是本次审计失败。

## Requirements

1. 保留 World/Character-Event 输入边界：Event prompt 只能消费经过筛选、清洗、带来源/对象边界的 Character Evidence semantic projection，不能恢复 raw host DTO。
2. 恢复当前人物分析所需的稳定证据：Character Card description、当前 Persona description，以及已有 canonical/derived profile 在安全可归属时进入 projection；当前 Target Floor 与 Recent Story 继续只作为 narrative/event evidence。
3. Worldbook 与 External Memory 只有在当前 source collection 能证明其明确归属于当前人物/Persona 时才可进入 Character Evidence；无 subject binding 的选中内容不得被默认当作当前人物 profile，以防跨人物借证。它们仍可继续作为 World Model 的 raw-source 输入。
4. Projection 必须保留 evidence subject/target、display/identity hint、source kind、稳定生理证据文本、已明确的 species/biological_type 与 explicit capabilities（仅当原始 canonical/derived evidence 已提供），并保留足够 provenance 供调试/测试验证。
5. 明确生理性别只能帮助映射到当前已持久化 World Model 中已有的 species/type；不得从 gender 直接推 capability、创建不存在的 type、给 Nonhuman 套 Human baseline、使用现实常识补值或创建 gender eligibility fallback。
6. Initial Registry Bootstrap 在没有 canonical `character_id` 时仍必须能把当前 Character/Persona 的稳定 evidence 送入 Event Analyzer；identity creation 仍由 Runtime response normalization/registry 流程负责，projection 不伪造 ID。
7. 不修改 Tracking、`tracking_subjects` 语义、World Model schema/persistence、Event/Floor persistence、Generation lifecycle、UI、Story Time、Calendar、StateReducer、Projection 或 Coordinator。

## Scope boundary

### In scope

- 只读确认 `16b8dbb` 与 `bec4320b` 的人物证据差异和当前 runtime-wide DTO 保留情况。
- 设计并在后续获批后实现最小 Character Evidence projection，以及 Event message builder 对 projection 的消费适配。
- 覆盖 A-G 输入边界/映射/隔离回归测试，并验证最终 messages 而不只验证 Prompt 文案。

### Out of scope

- 本规划阶段不修改生产代码、不修改 Prompt 文案、不改 Tracking、不提交、不推送、不启动 Execute Phase。
- 不恢复 `formatCharacterReference()`、`formatPersonaReference()`、`formatWorldbookReference()`、`formatExternalMemoryReference()` 到 Event prompt。
- 不把 `character_registry.entities` 直接当人物列表，也不借由 gender、姓名、participant role 或普通剧情推导 eligibility。

## Acceptance Criteria

- [x] 形成可审计的完整数据流：Host source collection → Runtime wide DTO → Character Evidence projection → Event narrow input → `buildEventAnalysisMessages()`，并标出 `bec4320b` 前后删除点。
- [x] 方案明确回答当前 source 中哪些已由 narrative context 进入 Prompt、哪些在 Event boundary 丢失、哪些允许/禁止进入 Character Evidence，以及每类 source 的 provenance/subject isolation 规则。
- [x] 最小 projection schema 能表示 subject/target、identity hint、source kind、stable biological evidence、canonical species/type、explicit capabilities 与 provenance；不承载 raw host object、API/settings/secrets。
- [x] Case A-G 均有可执行回归测试设计并已实现；直接检查最终 `buildEventAnalysisMessages()` messages。
- [x] 规划明确所需最小文件集合及保持不动的模块；实现已获用户明确批准，未执行 commit/push。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
