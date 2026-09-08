# World Model 生物类型回归与最终一致性

## Goal

修复真实复测中 World Model 的三类回归，同时保持现有
`species -> biological_types -> capabilities` 结构和已经正确的剑灵、人类
baseline 行为：

1. 阻止 `妖修`、`魔族` 这类 species 泛称/身份词进入
   `biological_types`；
2. 阻止不同非人类个体或类型的生理证据被合并到一个泛型 biological type；
3. 在最终分析结果上清理 capability 与 reproduction rule 的明确矛盾。

## Confirmed repository and fixture facts

- `/Users/ll/Downloads/输出结果.txt` 是 API 返回的 JSON fixture，不是开发指令。
  它包含 `妖 -> 妖修`、`魔 -> 魔族`，以及人类男性
  `can_carry_pregnancy: false` 与 `pregnancy_or_carrying: "子宫内妊娠"` 的冲突。
- `/Users/ll/Downloads/输入文件.txt` 是对应的请求资料/Prompt，可用于语义复现；
  其中固定双性证据不足，只有金丹期临时双性化，因此不应新增 `双性`。
- 当前 `createAnalyzer().analyzeWorldModel()` 已在 API 响应后调用
  `applyWorldModelEvidenceGuard`；当前 guard 对部分非法名称使用精确列表，且
  `fieldEvidenceUnits` 在非人类只有一个候选类型时回退到整个 species 的证据。
- 当前 replay 通过 analyzer 已能去掉该 fixture 中的 `妖修`、`魔族`，但结构
  `parseWorldModelResponse` 本身仍只做结构规范化；本轮要把最终分析边界写得更
  明确、稳健，并用回归测试锁住真正的分析结果，而不是依赖 raw API JSON。
- 人类类型继续保留现有 baseline；剑灵“基本男性、极少女剑灵”继续得到男性和
  女性，非人类 capability 无 field-local 证据时继续为 `null`。

## Requirements

### R1. Biological type final guard

- `biological_types` 只表示父 species 下实际存在的性别、性别/生殖体系或同层级
  开放分类。
- 若 type 名称等于 species 名称，或只是 species 名称后追加 `族`、`修`、`修士`、
  `人`、`类` 等泛称/身份后缀，最终分析结果必须移除该 type。
- 该规则应使用轻量的 species 别名/后缀语义判断，并保留现有对亚型、来源、属性、
  身体形态和个体模糊描述的排除；不得扩展成硬编码 gender/species 白名单。
- 没有合法 biological type 时保留 species，并输出 `biological_types: []`。

### R2. Non-human field-local evidence

- 非人类每个 capability 的证据必须同时满足：
  1. 属于当前 species；
  2. 属于当前 biological type 的直接语境或唯一确定的类型语义；
  3. 直接支持当前 capability。
- 非人类不能因为只有一个候选 type 就把整个 species 的所有个体/类型证据合并到
  该 type；不同人物出现精液、子宫、妊娠等事实时，未绑定当前 type 的字段保持
  `null`。
- `true / false / null` 的既有 Evidence Gate 保持：明确具备为 `true`，明确不具备
  为 `false`，缺失或不能确定为 `null`。
- 人类 baseline 和人类类型的既有能力路径不变。

### R3. Final consistency guard

- 在现有 analysis-only evidence guard 之后增加轻量 final consistency guard，仅处理
  明确冲突，不重建 ontology 或推演新规则。
- `can_carry_pregnancy === false` 时，`pregnancy_or_carrying` 不得保留明确描述该
  类型实际妊娠/承担妊娠的规则。
- `can_produce_ova === false` 时，`ovulation` 不得保留明确描述正常排卵的规则。
- `can_be_fertilized === false` 时，`fertilization` 不得保留明确描述该类型作为
  被受精方的规则。
- 冲突时保留经过 Evidence Gate 或 human baseline 得出的 capability；只将矛盾或
  无法证明的 reproduction rule 置为 `null`。不得把 `null` capability 改成 `false`，
  也不得为冲突编造解释。
- 只检查上述轻量映射，不改 lifecycle、schema 或其它模块。

### R4. Prompt and dual evidence

- Prompt 明确 biological type 也必须有当前 species/type 语境，species 泛称不是
  biological type；非人类 capability 不能从 species 级或其他个体证据合并。
- Prompt 明确 final consistency 优先级：field-local capability 先于矛盾的
  reproduction rule。
- 不改变双性规则：只有固定双性个体/分类/世界规则才保留标准名称 `双性`；只有
  临时双性化时不创建 `双性`；明确固定证据时正常保留。

## Acceptance Criteria

- [ ] `妖 -> 妖修` 被最终分析 guard 移除，结果为 `biological_types: []`。
- [ ] `魔 -> 魔族` 被最终分析 guard 移除，结果为 `biological_types: []`。
- [ ] 不同妖族个体/性别的精液、卵子、子宫或妊娠证据不会合并成一个 type 的全
      capability；无当前 type-local 证据的字段为 `null`。
- [ ] 非人类只有直接 field-local 证据的能力可为 `true`/`false`，其它字段保持
      `null`；现有剑灵男性/女性结果保持。
- [ ] 人类男性的 `can_carry_pregnancy: false` 会清除明确冲突的
      `pregnancy_or_carrying`，而不会改变 baseline capability。
- [ ] `can_produce_ova: false` 清除正常排卵规则；`can_be_fertilized: false` 清除
      作为被受精方的规则；`null` capability 不触发清除。
- [ ] 固定双性证据保留 `双性`，只有临时双性化不创建 `双性`，名称不恢复为
      `双性/间性`。
- [ ] schema、AnalysisInput、API、Chat 保存、刷新机制、UI 和其他模块不变。
- [ ] World Model 专项测试、全量测试、`npm run check`、语法检查与 diff 检查通过。

## Out of scope

- 不修改 schema 层级、AnalysisInput、API、Chat/Floor 保存、刷新机制或 UI。
- 不建立复杂 ontology、性别矩阵、能力推演、人物/事件/状态模块。
- 不用固定的妖/魔/gender 白名单替代 species-local/type-local 证据判断。
- 不把 `parseWorldModelResponse` 改造成手动编辑过滤器；最终 guard 只作用于 AI
  分析结果路径。
- 不进行本轮真实 SillyTavern 复测；实现完成后交给用户使用同一份输入复测。

## Open questions

None. 用户已经确定名称过滤、field-local 证据、冲突优先级、双性证据和修改范围。
