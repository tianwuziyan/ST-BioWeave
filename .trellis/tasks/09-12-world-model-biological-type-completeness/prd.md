# 补强 biological_type 完整性与 Prompt 证据召回

## Goal

修正 World Model 对少数、稀有、例外或使用派生称谓表达的稳定
`biological_type` 的召回遗漏：让 Prompt 能把确定性低推理的存在表达视为
type evidence，同时继续拒绝无证据猜测、A/B 成对补全和非生物分类轴。

本阶段只完成审计与 planning，不修改产品代码，不启动实现。

## Confirmed Findings

- `ai/prompts.js` 的 `WORLD_MODEL_CORE_INSTRUCTIONS` 已定义 species/type 的
  稳定生理边界、A–E 成立条件以及 `biological_types: []` 的保守规则，但
  E 条件使用“充分直接证据”表述，没有明确覆盖“少数、极少、罕见、例外、
  也存在、除……外”等确定性低推理存在语义。
- 当前 Prompt 将“空数组优于错误分类”写成单向保护，尚未同时说明：遗漏
  已经被输入明确证明存在的稳定 type 也是错误。
- 当前 Prompt 的内部自检检查候选是否合法，却没有要求每个 species 在输出
  前扫描 AnalysisInput，找出已表达但尚未输出的稳定 type。
- `ai/analyzer.js` 的 `hasGenericScopedTypeEvidence()` 已包含若干通用数量/频率
  关系词，`hasTypeSubtreeEvidence()` 也检查 type 名称、description、规则和
  lifecycle；目前没有证据证明 Analyzer 专门按“主要类型”截断列表。
- 但如果 AI 使用了输入中没有直接可回指的规范化 type 名称，且其它 type
  字段也没有可直接匹配的证据，`hasTypeSubtreeEvidence()` 仍可能删除该 type。
  需要先用 Raw/Canonical 分离测试判断是 Prompt 漏报还是 Analyzer 误删。
- 早期 biological type evidence 设计已经正确禁止“为了完整性”猜测缺失 type；
  本任务不是撤销该边界，而是补充“已由输入直接或确定性低推理语义证明”的
  completeness 规则。

## Requirements

### R1. 低推理存在证据必须被识别

- Prompt 明确规定：只要 AnalysisInput 直接表达，或通过确定性、低推理的
  自然语言语义明确证明某个稳定 biological type 存在，就必须输出该 type。
- 数量少、属于例外、不是主要类型、位于“通常/多数”之外，不能成为遗漏
  已成立 type 的理由。
- 原文不必逐字使用最终 canonical type 名称；只要类别的指称能够唯一回指
  到输入中的稳定生理/生殖分类，允许使用该分类的规范化名称。
- “少数/罕见”修饰的是已被输入识别的类别时，数量信息是 existence evidence，
  不是否定证据。

### R2. 每个 type 仍须独立有证据

- 每个 biological type 都必须有自己的输入证据。
- 只存在 A 不能推导 B；不做 A/B 成对补全、默认性别补全或其它列表填充。
- 没有可唯一回指的类别、只有“某类成员”而没有稳定生理/生殖含义、或存在
  明显歧义时，仍不得创建 type。
- `biological_types: []` 继续表示没有任何候选通过成立条件，并且优于无证据猜测。

### R3. 输出前 completeness check

Prompt 要求模型在每个 species 完成 `biological_types` 后进行内部检查：

1. 从完整 AnalysisInput 扫描数量、频率、对比、例外和并存表达；
2. 找出已明确指向但尚未输出的稳定生理/生殖分类；
3. 对每个遗漏候选重新执行既有 A–E 成立条件；
4. 通过才补入，不能通过则保持遗漏/空数组；
5. 检查不输出，只输出最终 JSON。

该检查不能把 capability、reproduction_rules、lifecycle 或 special_rules
的未知值当成 type existence evidence，也不能因为 type 数量少就扩展列表。

### R4. 保持既有通用边界

- 不增加任何具体 species、世界观、角色卡、gender 特判或 biological type
  registry。
- biological type 仍只表示 species 内稳定的生理/生殖分类；职业、身份、
  阵营、等级、阶段、路线、临时/可逆状态、个体特质等仍被排除。
- type 成立不代表 capability、reproduction_rules、lifecycle 已知；字段继续
  逐项使用现有 evidence contract 和 `true / false / null`。
- 不修改 schema、AnalysisInput、UI、Event、State、Projection、Runtime 或
  storage。

### R5. Analyzer 只在被证明误删时最小修正

- 先使用抽象 Raw/Canonical 回归确认 type 是 AI 未生成，还是 Analyzer 后处理
  删除。
- 如果 Raw 已包含有稳定生理分类证据的陌生 type，而 Analyzer 仅因名称形式或
  通用证据匹配失败删除，才允许提出最小、可解释的通用修正。
- 在此之前不修改 `ai/analyzer.js`，不新增关键词表、别名表、白名单、黑名单或
  species/type 映射。

## Acceptance Criteria

- [ ] Prompt 明确区分“无证据猜测”与“已由低推理语义证明但尚未输出的 type”。
- [ ] Prompt 明确将少数、极少、罕见、例外、通常之外和并存表达视为可成立的
      existence evidence。
- [ ] Prompt 包含每个 species 的 completeness check，且不引入 A/B 成对补全。
- [ ] Prompt 仍保留 A–E biological_type 成立条件、分类轴排除、`[]` 未知处理、
      capability 独立证据和 Nonhuman Evidence Gate。
- [ ] 新增抽象回归覆盖“多数 + 少数”与“主要 + 例外”两类 type 召回。
- [ ] 新增回归确认只有 A 时不会因 completeness check 自动生成 B。
- [ ] 新增回归能区分 Raw 未生成 type 与 Canonical 后处理删除 type。
- [ ] 如果没有证明 Analyzer 误删，`ai/analyzer.js` 保持不变。
- [ ] 不出现具体世界观知识、species/type registry、专用 regex 或 schema/UI 改动。

## Planned Verification

- `node --test tests/world-model.test.js`
- `npm test`
- `npm run check`
- `node --check ai/prompts.js`
- `node --check tests/world-model.test.js`
- `git diff --check`

真实 LLM 黑盒只作为 Prompt 召回验证，不能替代 Raw/Canonical 单测；若当前
环境没有可安全使用的测试输入和 API，不将 Node 测试描述为真实黑盒通过。

## Notes

- 本任务为复杂 Prompt/Analyzer 边界审计，需要在实现前补充 `design.md`、
  `implement.md`、`research/current-audit.md` 及真实 spec/research manifests。
- 在用户批准最终 planning summary 前，不运行 `task.py start`，不修改产品代码。
