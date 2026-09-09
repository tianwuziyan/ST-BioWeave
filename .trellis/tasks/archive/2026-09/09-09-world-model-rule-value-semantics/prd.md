# 补全 World Model 三态语义与 Human reproduction baseline

## Goal

统一 World Model 规则字段的三态语义，补全已合法识别 Human Male/Female 的 reproduction baseline，并修复 Human 显示别名造成的重复 species entry。实现保持 World Model v1 的统一结构，不把任何具体幻想世界知识写入生产代码。

## Current audit findings

- storage/schema.js 当前的 reproduction/lifecycle 字段已经是 string | null，能够直接表达 null、"无" 和非空描述，不需要新增 schema 字段。
- ai/analyzer.js 的 nullableText() 会保留非空 "无"，但没有建立规则字段的 canonical absence 处理；缺失值、未知值和 Human Male baseline 当前的已知不适用规则都可能落成 null。
- 当前 Human Male baseline 的 cycle、ovulation、gestation、labor 以及 pregnancy_or_carrying 使用 null；这把“已知不适用”与“尚未知晓”混在一起。
- 当前 Human Female baseline 已有非空 cycle/ovulation/gestation/labor 文本，但只有 isHumanSpeciesName() 识别成功并且 type 已通过 evidence guard 时才会应用。Human 与人类可进入 baseline，而人类 (Human) 当前会被局部英文替换成人类 (人类)，既不能作为 Human species canonical name，也不会应用 Female baseline。
- normalizeWorldModel() 只逐项归一化 species，没有合并 canonical Human entry；ui/app.js 在加载、手动保存和 AI 保存时都会调用它，因此 duplicate path 位于 canonicalization/normalization 层，而不是 World UI renderer。
- applyWorldModelFinalConsistencyGuard() 当前在 capability 为 false 时把关联规则清成 null，并且会把 "无" 当作没有受精语义而清成 null；这会破坏新的 absence contract。
- ui/world.js 的 displayText() 对 null 显示“未知”，对非空字符串原样显示；它可以正确显示 "无"，无需新增 Human renderer 或规则值转换。

## Requirements

### R1. Rule value tri-state contract

对 reproduction_rules.* 与 lifecycle.* 等 string | null 规则字段统一规定：

- null：未知、证据不足、当前无法确定；
- "无"：已知不存在、明确不具备或明确不适用；
- 非空描述：已知存在对应机制，使用简洁规则描述。

canonical absence value 只能是 "无"。自然语言输入中的“无此功能”“不适用”等可以在 canonicalization 时收敛为 "无"，但不得把未知、未提及或“没有资料”误收敛为 "无"。非 Human 没有证据时仍必须保持 null。

### R2. Human reproduction baseline

- 只有已由当前 AnalysisInput 建立的普通 Human Male/Female biological type 才能使用内置 baseline；baseline 不创建缺失 type，也不适用于 Human 自定义 type 或其它 species。
- Human Male 的已知不适用 reproduction rules 使用 "无"，至少包括 cycle、ovulation、gestation、labor；按同一 contract，pregnancy_or_carrying 也应使用 "无"。
- Human Female 的 cycle、ovulation、gestation、labor 使用简洁、稳定的普通 Human baseline，不因 AI 未逐字段输出而回落为 null。
- baseline 只提供 fallback；明确当前个体事实、转化/特殊体系规则和世界规则继续按既有 Baseline + Delta 优先级逐字段覆盖。

### R3. Human species canonicalization

- 人类、Human、human、Humans、人类 (Human) 等 Human 显示形式 canonical display 固定为 人类。
- canonicalization 后同一 Human species 只能保留一个 species entry；同名 biological type 不能因多个 Human entry 重复出现。
- 只允许这一项 Human 专用 canonicalization 例外；不建立其它 species 同义词表、registry、ontology 或世界观知识库。
- canonicalization 必须不改变 Human/Nonhuman Evidence Gate 的边界，也不能把独立 Nonhuman 变成 Human。

### R4. Existing semantic boundaries

继续保持 fertilization 仅表示真实受精/授精机制，maturation 仅表示真实生物成熟；性交、体液/能量交换、等级/修炼 progression、非妊娠身体变化不能被 Analyzer 或 Prompt 当作对应规则。Nonhuman capability 仍逐字段依赖当前 species/type 局部证据，biological_types: [] 仍合法。

### R5. Scope and compatibility

- 不修改 World Model v1 schema、五个 capability、AnalysisInput、UI renderer、Event、State、Projection、Runtime、API 或 Chat storage contract。
- 不新增 status enum、absence_reason、known_absent、species registry、fantasy dictionary、世界观关键词表或 fixture-specific 分支。
- 修改范围原则上限定为 ai/prompts.js、ai/analyzer.js、tests/world-model.test.js、docs/DATA-MODEL.md；storage/schema.js 与 ui/world.js 只在审计证明确有必要时才可修改。

## Acceptance Criteria

- [ ] Prompt 明确写出 null / "无" / 非空描述三态，并明确未知不等于 absence。
- [ ] 普通 Human Male baseline 的已知不适用 reproduction rules 为 "无"；Human Female 的四个基础规则非空且简洁。
- [ ] 明确的 Human world override 可以覆盖 baseline 的 "无"，且未覆盖字段仍保留 baseline。
- [ ] Nonhuman 的未知规则仍为 null；明确不存在的规则才为 "无"；null 与 "无" 在 normalize/merge/final guard 中不混淆。
- [ ] Human aliases canonicalize 到单一 人类 entry；不新增其它 species alias knowledge。
- [ ] final consistency guard 保留，并在已知 absence 场景不把 "无" 错误清回 null；capability false 与确定的关联规则 absence 保持一致。
- [ ] fertilization、maturation、Nonhuman Evidence Gate 与 biological_type Contract 的现有回归继续通过。
- [ ] 新增测试覆盖 Human baseline、三态值、Human alias duplicate、override 和非 Human unknown/absence。
- [ ] 不修改 schema/UI/Event/State/Projection 等任务外模块，不引入依赖或具体世界观知识。

## Out of Scope

- 不重新设计 World Model 层级或 capability schema。
- 不把所有规则值改造成新的状态对象，也不新增 absence metadata。
- 不为其它 species 建立 synonym canonicalization 或生理知识。
- 不借本任务修复无关的 UI、Runtime、storage 或 Worldbook 行为。

## Implementation status

本任务已获准进入实现阶段。产品实现、回归测试、文档同步和质量验证完成后，按当前分支的提交流程提交；不改变既有 schema、UI、Event、State、Projection 或 Runtime。
