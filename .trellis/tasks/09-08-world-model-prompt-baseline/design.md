# Technical Design: Generic World Model Prompt and Baseline Boundaries

## Boundary and data flow

保持现有分析链路，只收敛 Prompt 与分析 guard 的职责：

```text
AnalysisInput
  -> generic World Model Prompt
  -> API response JSON
  -> parseWorldModelResponse (structural normalization)
  -> applyWorldModelEvidenceGuard (analysis-only type/field evidence)
  -> applyWorldModelFinalConsistencyGuard (capability downstream constraints)
  -> Chat-local World Model
  -> World UI
```

schema、请求消息结构、Chat 保存和 UI 不在本轮修改范围内。raw API JSON 的结构校验继续由 `parseWorldModelResponse` 负责；语义证据过滤只发生在 `analyzeWorldModel()` 的分析路径。

## Responsibility split

| Concern | Prompt responsibility | Analyzer responsibility |
| --- | --- | --- |
| species/type recognition | 说明先识别 species，再识别当前资料支持的 type；不补全 | 保留已有 evidence guard；拒绝无证据 type |
| human baseline | 允许已建立的人类男性/女性使用对应现实 baseline；说明优先级和男女差异 | 不把 baseline 当成非人类证据门槛；保留 type-specific final consistency，不创建缺失 type |
| non-human biology | 要求当前 species/type 的字段级证据，未知为 null | 确定性过滤跨 type/species 的能力和规则证据；单一候选 type 也不回退到 species-wide evidence |
| duplicate type name | 给出“type 不能重复父 species”的通用语义 | 归一化名称后确定性 reject，不依赖具体物种词表 |
| fertilization | 只输出实际受精机制和当前 type 角色，互动行为不算受精 | 保留角色冲突清理，并对无真实受精机制的 rule 做最小过滤 |
| final consistency | 提醒 capability 是下游约束 | 保留并执行已有 false-to-rule 清理；null 不触发清理 |

## Prompt reduction

重写 `WORLD_MODEL_CORE_INSTRUCTIONS` 与 `WORLD_MODEL_OUTPUT_CONTRACT`，目标是用少量通用规则覆盖四个决策：

1. 当前资料支持哪些 species/type；不因默认完整性补类型。
2. 已建立的人类男性/女性可使用各自 baseline，且明确事实优先。
3. 非人类字段必须 type-local、逐项证据化，未知为 `null`。
4. 输出开放类型和固定 schema；fertilization 需要真实机制与角色。

删除重复 schema 字段解释、重复的“未知/null”表述和当前 fixture 的物种/案例专名。保留固定双性与临时改造的通用原则，但不再用任何当前 fixture 作为生产示例。Prompt 不负责实现可由 analyzer 确定执行的字符串过滤或最终字段清理。

## Analyzer changes

### 1. Generic parent/type duplicate predicate

在现有 `isObservedNonBiologicalType` 入口收敛为通用谓词：

- 去除空格并比较归一化后的父子名称；完全相同直接 reject。
- 对“父 species + 通用群体/种族/身份后缀”的重复形式做有限判断，例如通用的 `族`、`类`、`种`、`人`、`修`、`修士` 等后缀。
- 不维护固定物种名称列表来完成该判断；不把任意开放 type 名称做过度字符串过滤。

### 2. Non-human type-local evidence

非人类 `sanitizeNonHumanType` 的 capability、reproduction rule、lifecycle 和 type-level special rule 统一基于 `typeEvidenceUnits()`。删除“只有一个候选 type 时使用 speciesUnits”的回退路径。这样不同人物或不同 type 的精子、卵子、妊娠等证据不会合并成一个泛型 type 的全能力。

人类类型继续绕过非人类 Evidence Gate，因此普通 baseline 不需要被 AnalysisInput 逐字段重新证明；人类 type 是否存在仍由已有的类型识别证据决定。

### 3. Fertilization semantics

继续用轻量字段证据判断，不建立复杂生殖 ontology：

- 只有包含实际受精/配子结合机制并能表达当前 type 角色的 rule 才保留。
- 单独的性交、双修、补灵、侵蚀、魔化等互动文本不作为 fertilization 证据。
- `null` capability 不触发删除；明确 `false` 继续由 final consistency guard 清理冲突角色。

### 4. Existing final consistency guard

保留 `applyWorldModelFinalConsistencyGuard()` 的 downstream contract：capability 已确定为 `false` 时清理不适用的 reproduction rule；capability 为 `null` 时保留独立有效证据。人类 male/female 的 role-specific fertilization 与 female-only cycle cleanup 继续按具体 type 执行，不引入共享 `HUMAN_REPRODUCTION_RULES` 对象。

## Test design

测试通过 `createAnalyzer().analyzeWorldModel()` 验证最终分析结果，而不是只验证 raw API JSON 或内部 helper。新增测试使用任意合成 species 名称，不复用当前输入附件中的专名；现有历史回归测试继续保留，但生产 Prompt 断言必须验证这些专名不再出现。

## Compatibility and rollback

不修改 schema 或持久化格式，不迁移既有 World Model。回滚点为 `ai/prompts.js`、`ai/analyzer.js` 与对应测试；若证据过滤过严，只需回滚 type-local predicate 或缩小通用后缀判断，不影响 API、storage、UI 和其它模块。
