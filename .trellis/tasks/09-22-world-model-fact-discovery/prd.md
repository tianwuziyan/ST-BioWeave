# 重构 World Model Prompt 事实发现归档并补齐回归测试

## Goal

修复 World Model Prompt 丢弃 medical_context 等横向生物事实的问题，并建立最小化 Prompt regression fixtures。

## Background and confirmed evidence

- 当前 HEAD 的 `ai/prompts.js` 已有 Species Discovery、Biological Type Discovery、Human baseline、Nonhuman evidence、capability 独立判断、reproductive mechanisms、transformation continuity、null/“无”语义和 `projection_rules` 约束，但主流程仍然以 schema 分类为中心。
- 真实 Host World Model AnalysisInput `/Users/ll/Downloads/输入文件.txt` 明确包含“生母甄兰心因难产去世”。该事实支持 `medical_context.childbirth_difficulty` 与 `medical_context.evidence`，但不支持镇野朝人口层面的医疗结论，也不支持 `care_level`。
- 同一真实输入包含普通人类性行为与射精等剧情事实，但未提供临时/条件性生物规则偏离的证据，也未提出一个会影响当前 World Model 的、证据不足的机制问题。因此本样本不应被强行填充 `exceptions` 或 `unknowns`。
- 支点 `515ecc6094fd4eb1ec3334f6ea7231a6ef1c7594` 仅作为行为方向参考；实现目标是修复当前 HEAD 的 Prompt 事实发现与归档结构，不回滚当前已有 World Model 能力与 schema 工作。

## Requirements

1. 重构 `WORLD_MODEL_CORE_INSTRUCTIONS` 为“先完整发现与生物学、生殖、妊娠、分娩、生理变化、生殖相关医疗/照护有关的有效事实，再按最合适字段归档，再逐字段严格验证，最后复查未归档事实”的流程。
2. 明确横向事实可以进入 `special_rules`、`medical_context`、`exceptions`、`unknowns` 或 `projection_rules`，不得因不适合 species/type/capability/reproduction/lifecycle 而丢弃；保留当前严格 evidence policy，不允许常识补写。
3. 明确 `medical_context` 只记录 AnalysisInput 支持的妊娠、分娩、产后医疗事实、照护条件、分娩困难、风险和结果；个体案例不得自动升级为 world-wide 规则；普通剧情 medical event 不自动归入 World Model。
4. 明确 `exceptions` 只有在一般 biological rule/baseline 已成立且存在明确个体、条件性、临时性或可逆偏离证据时才记录；稳定 type-level 规则进入 `special_rules`，没有证据时保持 `[]`。
5. 明确 `unknowns` 只记录输入已触及、但机制/条件/边界/适用范围/冲突仍不足以确定且会影响当前 World Model 的问题；不得从 null 字段或 schema 缺口自动生成 unknown。
6. 增加最小化自动 Prompt regression fixtures，覆盖用户指定的 A-F；不得把整份真实附件复制进 fixture。真实附件只作为人工回归参考。
7. 除非现有 normalize/validator 阻止上述正确输出，不修改 normalization/schema；不修改 Event Analyzer、Story Time、Calendar、StateReducer、Character Registry、Floor ownership 或 UI。

## Acceptance Criteria

- [x] Prompt 明确采用 fact-discovery-first，而不是仅围绕 species → biological_type → capability → reproduction/lifecycle 扫描。
- [x] Prompt 明确列出事实归档候选字段，并包含“未归档事实检查”。
- [x] 真实样本对应的回归行为允许 `medical_context.childbirth_difficulty` 与 `evidence` 捕获“甄兰心因难产去世”，`care_level` 仍可为 null；不要求 `exceptions`/`unknowns` 非空。
- [x] A：单条“某产妇因难产死亡”允许医疗事实与证据，不生成 population-level 医疗结论。
- [x] B：普通 Human 生殖资料无医疗信息时 `medical_context` 保持 null。
- [x] C：一般规则加临时条件偏离保留 exception，且不创建稳定 biological_type。
- [x] D：已触及特殊孕育现象但机制未解决时进入 `unknowns`。
- [x] E：输入未触及的机制不会因字段为空生成 unknown。
- [x] F：没有 exception evidence 时 `exceptions` 允许为 `[]`。
- [x] targeted World Model tests、`npm run check`、`node --check` 与 `git diff --check` 通过。
- [x] 修改文件限于 `ai/prompts.js` 与对应 World Model prompt tests，除非验证证明 schema/normalizer 必须调整。

## Notes

- 真实附件不得直接复制进自动 fixture。
- 不进入 Phase 2C。
