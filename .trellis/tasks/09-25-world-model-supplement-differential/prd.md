# World Model Supplement World Knowledge Scope 与安全验证

## Goal

正式将 World Model Supplement / Patch 定义为：

`Existing World Model + current permitted World Analysis evidence -> World Knowledge Scope / Classification -> baseline-aware Consolidation -> Candidate Patch -> deterministic Safety Validation`。

Supplement 的首要问题是当前 evidence 建立了什么世界级知识、其作用域是什么、以及应进入哪个 World Model knowledge outlet；Semantic Delta 退居 Candidate 之后的 deterministic safety layer。Supplement 必须重新审阅完整允许的 World Analysis evidence，允许补充较早资料中此前遗漏的世界级事实，不要求事实首次来自 current Floor。

## Confirmed scope

- 保留现有 `Existing Model -> validated Patch -> deterministic merge -> complete canonical validation -> persist` 架构。
- Full Analysis 继续是 `evidence -> complete model`，不得因 `analysisInput.world_model` 偶然存在而消费旧模型。
- Supplement/Patch Prompt 必须收到 validated Existing World Model baseline，并继续使用与 Full 相同的 permitted World Analysis evidence set。
- AI 负责 World Fact Discovery、Individual/World scope、分类、兼容补充与明确 world-level correction 的 Candidate 提出；确定性代码负责安全验证、merge 与最终 canonical model。
- `CHANGE` 不要求固定 correction wording；必须由当前 permitted evidence 直接建立与 Existing rule 同 scope、且语义冲突/替代的 Candidate world-level fact。
- World Model 的 `species` / `biological_types`、capabilities、`reproduction_rules`、lifecycle、`special_rules`、`exceptions`、`unknowns`、`medical_context`、`projection_rules` 是同级知识出口，不默认把所有新知识塞入 species/type。
- 保持 sparse Patch 合同：sparse section 的省略字段表示 unchanged；complete
  `update.species` Candidate 遵循完整候选语义；remove/invalidate 继续不支持；
  不返回完整 replacement model。
- 不修改 World Model schema，除非审计证明当前 Patch schema 无法表达现有合法补充；如发现该问题，先报告。
- 不进入 Pregnancy Tracking Window Phase；不 commit、不 push。

## Required audit and deliverables

检查 runtime/world-analysis.js、ai/prompts.js、ai/analyzer.js、World AnalysisInput 构建、Patch validator/merge、ui/world.js、World Model spec、prompt context 文档和相关测试；基于实际调用链做最小修改。

审计 Patch evidence validation 是否能阻止 AI 添加 AnalysisInput 没有证据支持的 canonical fact；不得直接把 full-model evidence guard 套到 sparse Patch，必要时新增 generic Patch-specific guard。

## Acceptance criteria

1. Patch final API messages 明确包含 Existing World Model baseline。
2. Full final API messages 即使调用路径有旧模型也不包含 Existing World Model baseline。
3. Prompt contract 统一覆盖 previously missed、newly available、existing-entry supplement/correction，并移除 current-Floor-origin 限制。
4. Existing Model 已充分表达的事实不要求重新输出完整模型；缺失事实可 add；明确补充/修正可 update。
5. sparse section 的 omitted field 保持 unchanged；complete species candidate
   的知识削弱按 REMOVE 拒绝；remove/invalidate 仍被拒绝。
6. Patch merge 后通过完整 canonical World Model validation，并具有与 sparse delta 相匹配的 evidence boundary。
7. 生产逻辑不出现测试人物、固定 species/type、Human 常量、Floor 编号或测试剧情字面量。
8. `.trellis/spec/domain/world-model.md`、`docs/CONTEXT-AND-PROMPT.md`及发现的冲突文档完成必要同步。
9. 通过相关测试、`git diff --check`，并报告最终 `git status`。

## Out of scope

- World Model schema 扩展。
- Full Analysis evidence collection 重写。
- 无关 runtime、storage、Floor ownership、UI 重构。
- Pregnancy Tracking Window Phase。
- commit、push。

## Open questions

无；技术细节以当前代码审计结果为准，若发现 schema/contract 无法满足上述范围，停止扩大实现并报告。

## Documentation freeze status

本任务继续作为 implementation planning/history，不是 World Analysis 的
canonical owner。当前实现状态为 **REVIEW REQUIRED / PARTIAL**：Prompt baseline
boundary 正确，Full 不消费 baseline，Existing baseline 不进入
`evidenceUnits()`；World Fact Discovery、canonical null semantics、Human baseline、
Patch DTO、structural validation、deterministic merge、strict canonical
normalization、canonical Existing/Candidate comparison、changed-fact delta
safety、sparse medical presence 与 post-merge consistency 已存在。剩余限制是
deterministic code 不重做叙事 scope/classification，且
`projection_rules.update` 仍受 mutable-content identity gap 阻塞。目标业务合同以
[`World Model and World Analysis Contract`](../../spec/domain/world-model.md) 为准，
不因当前实现缺口而降低。

## Canonical clarification / next implementation boundary

下一实现阶段只补足 World Knowledge Scope 到 deterministic safety 的执行合同，
不重新设计已经可用的 World Analysis。实现范围为：

- 保持 AI World Fact Discovery，并明确 Individual / World / Exception /
  Unknown / Medical / Special Rule scope 与 knowledge outlet；
- 对 Existing world knowledge 做兼容 consolidation 或明确 world-level correction
  Candidate 约束；
- 在需要的 Patch 路径保留 Raw field presence；
- resolve Existing canonical target；
- 在 canonical boundary 比较 Existing 与 Candidate，仅作为 safety check；
- 确定性分类 `UNCHANGED` / `ADD` / `CHANGE` / `REMOVE`；
- 检查 changed world-level fact 的 evidence 与 scope compatibility；
- 拒绝 knowledge weakening、unsupported piggyback 和其它 REMOVE attempt；
- 完成 deterministic merge 后的 complete-model consistency finalization；
- 为 scope、consolidation、delta safety、presence 与 finalization 补充 regression tests。

本阶段明确不做：Full rewrite、permitted evidence collector rewrite、canonical
null semantics rewrite、UI rewrite、schema redesign、Floor ownership 变化、
Pregnancy Tracking 变化，以及 Projection Rule identity redesign。
