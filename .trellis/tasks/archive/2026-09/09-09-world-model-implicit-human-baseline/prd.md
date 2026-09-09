# 扩展 World Model 隐含 Human 基线 Contract

## Goal

在不放宽 Nonhuman Evidence Gate、不得新增来源字段的前提下，让 World Model 能从完整 `AnalysisInput` 判断可靠的隐含普通人类基线，并按 `Baseline + Explicit Biological Delta` 生成当前生物模型。

## 已确认的当前缺口

- `ai/prompts.js` 当前将 Human baseline 表述为“资料支持普通人类背景”后使用，容易被模型理解为必须出现 `Human/人类` 字样。
- `ai/analyzer.js` 的 Human baseline 入口是 canonical 输出中的 `species.name` 经过 `isHumanSpeciesName()` 后进入 `sanitizeHumanType()`；没有门派、修炼、转化或 fixture 关键词表。
- `sanitizeHumanType()` 已按 capability / reproduction rule 逐字段以 Human baseline 作 fallback，并让明确当前字段证据优先；`applyWorldModelFinalConsistencyGuard()` 负责最终确定性冲突清理。
- 对最终被资料定义为独立新 species 的结果，当前 v1 schema 没有 `source_species`、`origin` 或 inheritance 字段；因此来源基线与 delta 必须由 AI 在输出当前字段时完成，不能在 Analyzer 中另造持久化来源模型。

## Requirements

### R1. 允许有条件的隐含 Human baseline

Prompt 必须说明：Human 是唯一内置现实生物 baseline。即使资料没有出现 `Human/人类` 字样，只要整个 `AnalysisInput` 综合支持“普通人类是当前对象/群体的默认生物背景”，且没有明确独立 Nonhuman 来源、冲突生理体系、陌生生命或明显不同身体结构，就可以建立 `species = 人类` 并使用已成立的普通人类男性/女性 baseline。

这只是有证据的 fallback，不等于“没有 species 就是 Human”。无法形成可靠默认判断或存在冲突时，保持 species/type/capability 未知；不能靠形态相似、性别称呼、性交行为或社会结构触发 Human fallback。

### R2. Baseline + Delta 只生成当前模型

- 先判断基础生物来源，再读取当前世界、剧情、路线、改造或转化造成的明确生理变化。
- 明确当前个体事实 > 明确转化后/特殊体系规则 > 明确世界级规则 > 可靠推断出的 Human baseline > 未知。
- 逐 capability、逐 reproduction rule、逐 lifecycle 字段覆盖；特殊规则未涉及的稳定 Human 字段继续保留，不能因发生变化而整套清空，也不能因 Human baseline 而忽略明确 delta。
- 明确移除、替换、永久身体改变或稳定生殖分类变化只覆盖对应字段；未被改变的字段继续继承。
- 如果当前资料明确将永久变化后的对象视为新 species，按资料输出当前 species label，但仍可在当前 type 的字段中保留未被 delta 改变的 Human baseline；不得新增来源/继承 schema。

### R3. 保持 species/type Contract

- 来源、路线、职业、门派、身份、能力体系、等级、阶段、临时状态和改造路线名称不能因为具有生理影响就自动成为 `biological_type`。
- 只有同一 species 内稳定、独立、直接属于生理/生殖分类轴且有充分证据的分类才能进入 `biological_types`；`[]` 仍然合法。
- individual-level Human 来源不能自动证明整个新 species 都来自 Human。

### R4. 保持既有字段和非 Human 边界

- Nonhuman 即使类人、使用男性/女性名称、具有类似器官或性交行为，也必须按当前 species/type 局部证据逐字段判断，不能继承 Human template。
- 保留 fertilization、gestation、lifecycle.maturation、capability true/false/null、final consistency guard 等既有 Contract，不重复削弱或扩展其语义。
- 不修改 `WORLD_MODEL_SCHEMA`、五个 capability、UI、Event、State、Projection、Runtime、API 或 Worldbook selector。

### R5. Analyzer 约束

- 默认只修改 `ai/prompts.js`、`tests/world-model.test.js`，必要时同步 `docs/DATA-MODEL.md`。
- 不新增门派/修炼/转化关键词、species registry、Human-derived registry、alias、fixture regex、species→Human 映射或来源字段。
- 若测试证明 Analyzer 的现有结构证据 gate 会确定性地阻止合法 implicit Human 输出，先记录具体路径，只允许最小通用修正；不得把语义推断搬进 Analyzer。

## 回归测试范围

使用此前未出现的原创世界与名称，覆盖：

1. 无 `Human/人类` 字样但有可靠普通人类默认背景，可使用 baseline；
2. 加入特殊体系但未改变的 Human capability 保留；
3. 特殊体系只覆盖一个 capability；
4. 特殊体系只覆盖一个 reproduction rule；
5. 体系/职业/门派/路线名称不成为 biological type；
6. 明确独立 Nonhuman 和类 Human 外形不继承 baseline；
7. 来源不明时不无条件 fallback；
8. Human 来源永久转为新 species label 时，未改变字段保留，改变字段覆盖；
9. 个体 Human 来源不升级为整个新 species 来源；
10. 完全陌生世界无需 JS registry/schema 即可使用同一结构。

## Acceptance Criteria

- [ ] Prompt 明确“隐含 Human baseline 是有条件推断，不是全局默认”。
- [ ] Prompt 明确 Baseline + Delta、逐字段覆盖优先级和新 species label 的来源连续性边界。
- [ ] Prompt 继续保留 biological_type、Nonhuman、fertilization、gestation、lifecycle 和 null/[] Contract，且没有具体世界观示例。
- [ ] Analyzer 未新增世界观关键词或来源 registry；若有改动，仅为可验证的通用结构 gate，并有回归测试。
- [ ] 新增原创 fixture 覆盖上述 10 类回归，不改变 schema/UI/Event/State/Projection。
- [ ] `node --test tests/world-model.test.js`、`npm test`、`npm run check`、变更 JS 的 `node --check`、`git diff --check` 通过。
- [ ] 完整 diff 不包含无关模块或新增依赖，使用中文 commit message 并记录 commit hash。

## 当前未提交改动保护

现有 `ai/analyzer.js`、`ui/world.js`、`style.css`、历史 `.trellis` 文件以及分支上的既有提交属于先前工作。本任务不执行 reset/checkout/清理，不覆盖这些改动。
