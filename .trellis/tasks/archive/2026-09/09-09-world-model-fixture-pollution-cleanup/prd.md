# 清理 World Model fixture-specific 污染并恢复通用分析边界

## Goal

让 BioWeave 能够仅依据当前 Chat 的 `AnalysisInput` 分析任意世界设定。生产 Prompt 只定义通用分析任务，AI 负责自然语言语义提取，Analyzer 只执行结构化、证据边界和确定性一致性处理；测试 fixture 不得反向变成生产世界知识。

## Confirmed facts

- 当前分支为 `fix/world-model-prompt-baseline`，工作区在任务创建前干净；`node --test tests/world-model.test.js` 当前为 59/59 通过。
- World Model v1 schema 已在 `storage/schema.js` 固定为 `species[] → biological_types[] → capabilities/rules`，本任务不改变 schema、`AnalysisInput`、API、Chat storage、Runtime 或 World UI。
- `ai/prompts.js:9-28` 已经删除上一轮 Prompt 中的大部分 fixture 正例，但仍包含较多重复的职责、Evidence Gate 和输出契约表述，需要进一步收敛为通用任务定义；Prompt 不得加入任何具体世界物种例子。
- `ai/analyzer.js:27-28` 的男性/女性证据正则仍含 `男剑灵`、`女剑灵`；`ai/analyzer.js:245-250` 仍有针对 `妖`、`魔`、`剑灵` 的 aliases；`ai/analyzer.js:447-454` 仍有 `半兽人`、`妖剑剑灵`、`魔剑灵` 的物种特判。这些是 fixture-specific 污染，必须删除。
- 当前 `fieldEvidenceUnits()` 已不再使用历史上的 `typeCount === 1 → speciesUnits` 回退，但缺少一个原创物种的明确回归锁定；本任务必须确认并测试该禁止行为。
- 当前 `ai/analyzer.js:561-605` 已有 final consistency guard，可清理 `false` capability 冲突规则、保留 `null` capability 的独立规则，并处理 fertilization donor/recipient 冲突；该职责必须保留。
- 当前 analyzer 只在 raw AI 结果已经带有完整能力时识别人类男女 baseline，尚未为已成立的 Human Male/Female 提供缺失字段的确定性 fallback；本任务需要补上有边界的 baseline，不得把它扩展到其它类型或非人类。

## Requirements

### R1. 生产 Prompt 通用且精简

- Prompt 只要求从本次 `AnalysisInput` 提取当前资料实际支持的 species、biological types、capabilities、reproduction rules、lifecycle 和 special rules。
- 明确 `species` 与 `biological_type` 分层；两者名称均为开放字符串。`biological_type` 只表达性别、生殖性别或直接影响生殖机制的生物分类，不接收 species、亚种、血统、职业、身份、阵营、来源、属性、身体形态或临时状态。
- 明确不跨 species、不跨 biological type 借用证据；缺乏字段证据时为 `null`；非人类不得使用模型自身的幻想生物常识或从类型名称套用 Human template。
- Human 只在当前资料支持普通人类背景时建立；已成立的 Human Male/Female 可使用各自现实 baseline，不创造缺失类型；明确剧情事实、世界规则和个人例外优先于 baseline；其它开放类型仍按证据分析。
- `fertilization` 仅记录真实受精/配子结合机制和当前 type 的 donor/recipient 角色；普通互动不等同于受精。
- 输出严格保持 World Model v1 JSON 结构，未知标量为 `null`、列表为数组，不在 Prompt 中加入 fixture 物种正例或冗长 schema 教学。

### R2. Analyzer 只做确定性边界处理

- 删除所有 fixture-specific species/type aliases、特判和男性/女性 fixture 表达；不得改写为 species registry、词典或其它幻想世界知识表。
- 将 species 证据关联简化为当前输出的 exact species 名称与同一语义单元的 type 名称关联；保留必要的通用否定、个体/互动隔离，避免 Analyzer 重新理解任意世界观。
- 保留开放 type 名称；只保留通用的 Human 常见名称本地化、`双性` 名称规范化、明显 parent species/type 重复过滤和临时/歧义标签的安全边界。不得建立完整 biological type enum。
- 非人类 capability、reproduction rule、lifecycle 和 type-level special rule 始终使用同一 species + type 的字段证据；即使只有一个 type，也不得使用 species-wide evidence。
- 保留 schema 解析、版本校验、nullable/boolean 规范化、schema 外字段删除和保存前安全检查。

### R3. Human baseline 有严格边界

- 只对已成立的 `人类 → 男性` 或 `人类 → 女性` 使用现实普通人类 baseline；不因为 baseline 创造 Human 或缺失 biological type。
- Male baseline 至少提供五个 capability 的普通值，并只保留适用于男性的受精角色描述；`ovulation`、妊娠/孕期/分娩和女性周期字段为 `null`。
- Female baseline 提供普通女性 capability、受精、周期、排卵、妊娠、约 40 周孕期和分娩规则。
- 双性、Alpha/Beta/Omega、无性和其它开放 type 不自动套 Male/Female baseline。
- baseline 只填补缺失值，不覆盖 AI 已提取的明确剧情/世界规则；最终 consistency guard 不能把明确允许的 Human Male pregnancy 改回 `false`。
- 非人类即使 type 名称是男性/女性，也保持未知，除非 `AnalysisInput` 明确授权相应字段或明确声明与普通人类相同。

### R4. Fertilization 与 final consistency

- 不为性交、能量交换、补充能量、修炼、侵蚀、魔化、交换体液或身体接触建立 fertilization；不通过增加词汇黑名单实现该原则。
- 保留 `can_produce_ova === false → ovulation = null`。
- 保留 `can_carry_pregnancy === false → pregnancy_or_carrying/gestation/labor = null`。
- 保留 fertilization recipient/donor 与 `can_be_fertilized`/`can_fertilize` 的冲突清理。
- `capability === null` 表示未知，不得因此删除有独立证据的 reproduction rule，也不得把未知改成 `false`。

### R5. 通用测试与污染回归

- 在 `tests/world-model.test.js` 增加或改写 unknown-world-first 测试，覆盖普通 Human Male、普通 Human Female、Human Male+Female、Human 自定义 type、原创非人类无 type、原创非人类 Male/Female unknown、原创非人类明确局部 capability、single-type species-wide 证据隔离、parent/type 重复、临时状态、非受精互动和 Human Male pregnancy override。
- 使用完全原创的 species 名称验证非人类行为，不把这些名称写入生产代码。
- 增加轻量静态 regression，只读取 `ai/prompts.js` 与 `ai/analyzer.js`，拒绝已知 fixture-specific species/type 特判字符串和幻想 registry 标识；测试代码自身可以包含历史 fixture 名称。
- 保留 schema、请求消息、失败保留、UI 和其它已有合理 World Model 回归。

## Scope constraints

原则上只修改 `ai/prompts.js`、`ai/analyzer.js`、`tests/world-model.test.js` 和与该契约直接相关的现有开发文档（必要时更新 `.trellis/spec/frontend/state-management.md`）。不修改 `storage/schema.js`、`ai/input-builder.js`、Worldbook selector、API Profile/Secret、Chat-local storage、Floor/Runtime、World UI、Event/State/Snapshot/Projection/Genealogy，不引入依赖或新框架，不创建大型 abstraction。

## Acceptance criteria

- [x] 生产 Prompt 不含当前 fixture 的物种、亚种、职业或剑灵类教学，并明显少于当前重复规则表达。
- [x] Analyzer 不含 `妖`/`魔`/`剑灵` 等 fixture-specific species/type 特判，不含 `男剑灵`/`女剑灵` 等表达，不含 fantasy species registry/词典。
- [x] `fieldEvidenceUnits` 及其调用链完全没有 single-type species-wide fallback。
- [x] schema v1、`AnalysisInput`、API、storage、Runtime 和 World UI 未改变。
- [x] Human Male/Female 只在已成立且有当前资料支持的人类类型下获得各自 baseline；Male 不含 female-only 规则，Female 保留适用的现实规则；自定义 Human type 不套 baseline。
- [x] 任意原创非人类的 Male/Female 不因名称获得 Human capability；无证据字段为 `null`，明确局部证据只授权对应字段，`false` 与 `null` 严格区分。
- [x] parent species/type 同名及通用后缀重复由通用结构规则过滤，不依赖具体物种。
- [x] fertilization 只保留受精语义，普通互动不污染；final consistency guard 的 false/null 与 donor/recipient 行为全部保留。
- [x] fixture pollution regression 通过，且未出现替代性硬编码。
- [x] World Model 定向测试、全项目测试、`npm run check`、修改 JS 的 `node --check` 和 `git diff --check` 全部通过。
- [x] git diff 只涉及本任务范围；无新增依赖。

## Open questions

无。当前需求、兼容边界、测试范围和风险接受度已经由用户要求与仓库证据确定；实现前仍需用户批准最终规划摘要。
