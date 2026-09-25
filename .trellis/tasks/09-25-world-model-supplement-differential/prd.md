# 修复 World Model Supplement Patch 基线差分语义

## Goal

正式将 World Model Supplement / Patch 定义为：

`Existing World Model + current permitted World Analysis evidence -> baseline-aware differential analysis -> evidence-supported Patch`。

Patch 必须在当前 validated canonical Existing World Model 上，对完整允许的 World Analysis evidence 重新审阅，只输出 Existing Model 尚未充分表达、但 evidence 明确支持的 add/update；不要求事实必须首次来自 current Floor。

## Confirmed scope

- 保留现有 `Existing Model -> validated Patch -> deterministic merge -> complete canonical validation -> persist` 架构。
- Full Analysis 继续是 `evidence -> complete model`，不得因 `analysisInput.world_model` 偶然存在而消费旧模型。
- Supplement/Patch Prompt 必须收到 validated Existing World Model baseline，并继续使用与 Full 相同的 permitted World Analysis evidence set。
- 保持 sparse Patch 合同：省略字段表示 unchanged；remove/invalidate 继续不支持；不返回完整 replacement model。
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
5. omitted field 保持 unchanged；remove/invalidate 仍被拒绝。
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
canonical owner。文档冻结时的当前实现状态为 **BLOCKER / NOT YET CONFORMANT**：
Prompt baseline boundary 基本正确，Full 不消费 baseline，Existing baseline 不进入
`evidenceUnits()`；但 Patch guard 仍是 entry-level evidence hit，没有实现
semantic-delta 级别的 Existing 对照和 nested-field evidence validation，Cases
A/B/C/D 也尚未覆盖。目标业务合同以
[`World Model and World Analysis Contract`](../../spec/domain/world-model.md) 为准，
不因当前实现缺口而降低。
