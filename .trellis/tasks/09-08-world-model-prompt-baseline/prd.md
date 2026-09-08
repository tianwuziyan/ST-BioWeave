# 精简 World Model Prompt 并收敛生物学 baseline

## Goal

精简 World Model 生产 Prompt，明确普通人类 baseline 与非人类 Evidence Gate 的职责边界，并保留 analyzer 的确定性类型过滤与最终字段一致性修正。真实输入中出现什么 species 才分析什么，不把当前测试样例写成生产先验。

## Confirmed facts

- `ai/prompts.js:9-39` 当前 Core Prompt 同时包含重复规则、重复 schema 说明，以及针对若干当前测试物种和剑灵语句的具体案例。
- `ai/analyzer.js:320-487` 负责类型证据和非人类字段 Evidence Gate；其中单一非人类类型仍存在把 species 级证据当作 type 级证据的路径，且父 species/type 重复过滤需要收敛为通用规则。
- `ai/analyzer.js:518-594` 已有最终 consistency guard，负责按 capability 清理冲突的 reproduction rule，并区分人类男女的角色化 fertilization 与周期规则；本轮保留其职责，不重构 World Model 结构。
- `tests/world-model.test.js` 已覆盖历史 species/type、双性、非人类证据和最终 guard 回归；需要补充与当前 fixture 无关的通用输入。

## Requirements

### R1. 生产 Prompt 必须通用且精简

- 只根据当前 `AnalysisInput` 建立实际有证据的 species 和 biological_types。
- 删除 Core Prompt 中对当前测试物种、剑灵语句和其它 fixture 专名的先验案例；这些语义继续由测试覆盖。
- 合并重复的 species/type、Evidence Gate、null、schema 输出说明，只保留少量可执行原则。
- 保持英文 schema key、中文说明和现有顶层/嵌套结构约定；不改 schema。

### R2. 普通人类 baseline 只在已建立的人类类型下生效

- 只有当前资料已建立 `人类 → 男性/女性` 时，模型才可使用普通现实人类的对应 capability 与适用 reproduction baseline；不要求 `AnalysisInput` 再逐字段证明这些常识。
- baseline 必须按 biological_type 分开：男性不得继承女性的周期、排卵、妊娠、孕期和分娩规则；女性可使用适用的常规 baseline。
- 明确剧情事实、世界/世界书规则和个人例外优先于普通人类 baseline；不得因 baseline 创造缺失的 species 或 biological_type。
- analyzer 的非人类字段 Evidence Gate 不得拦截已建立的人类类型；analyzer 只保留现有的人类类型化一致性修正，不建立一个共享的人类 reproduction 模板。

### R3. 非人类字段必须通过 type-local Evidence Gate

- 非人类 species 的 capability、reproduction rule、lifecycle 和相关 type-level rule 必须有同一 species、同一 biological_type 的字段级证据或直接语义归纳。
- 即使某 species 只有一个候选 biological_type，也不得把整个 species 的人物或机制证据聚合到该 type；无字段级依据保持 `null`。
- biological_type 名称为男性/女性、类人外形、生殖器、性交、发情、子宫等单一线索，不得自动套用完整人类 capability 模板。
- `true` 与 `false` 都需要字段级依据；没有证据只能 `null`。
- 明确说明非人类某一项生理规则与人类相同，只能继承被明确支持的对应字段。

### R4. 父 species 名称重复由 analyzer 通用拒绝

- biological_type 若与父 species 名称相同，或只是父 species 名称加通用种族/群体/身份后缀形成的重复标签，应在分析结果中确定性移除。
- 规则不得依赖某个固定物种名称或硬编码测试名称；应使用名称归一化与有限的通用后缀关系判断，避免把真正开放的生殖分类误删。
- 该过滤发生在 AI 分析 guard；手动编辑和结构 schema 行为不扩大本轮范围。

### R5. fertilization 只记录受精机制与当前 type 的角色

- `reproduction_rules.fertilization` 只描述实际受精机制及当前 biological_type 作为供体/受体的角色。
- 双修、补灵、侵蚀、魔化、性交或其它互动行为本身不构成受精证据，也不能单独填入 fertilization。
- 继续保留现有 donor/recipient 冲突清理；无角色的泛化文本不得机械复制给所有 type。

### R6. 保留最终 consistency guard

- `can_produce_ova === false` 时清理 `ovulation`。
- `can_carry_pregnancy === false` 时清理 `pregnancy_or_carrying`、`gestation`、`labor`。
- `can_be_fertilized === false` 或 `can_fertilize === false` 时，只清理对应冲突的 fertilization 角色。
- capability 为 `null` 时不因未知而删除有独立直接证据的 reproduction rule，也不把未知改成 `false`。

### R7. 通用回归测试

至少增加或改写以下与当前 fixture 无关的测试：

1. 普通现代人类男性/女性使用各自 baseline，且男性不获得女性周期/排卵/妊娠字段。
2. 只有一个任意名称的幻想 species，存在 species 证据但无 biological_type 证据，类型数组为空。
3. 任意幻想 species 明确有男性/女性，但无 capability 字段证据，所有 capability 保持 `null`。
4. 父 species 与 type 完全重复，以及父 species 加通用后缀的重复名称，均被 analyzer 移除。
5. 非人类 `false` capability 清理不适用 reproduction rule；`null` capability 保留独立有效 rule。
6. fertilization 仅由真实受精机制证据支持；性交、双修或能量互动不单独创建该规则。
7. 现有双性固定/临时、开放类型和历史非人类回归继续通过，但这些专名只出现在测试，不出现在生产 Prompt。

## Scope constraints

本轮只涉及 `ai/prompts.js`、`ai/analyzer.js`、World Model tests，以及必要的契约文档。不得修改 schema、AnalysisInput、API 请求、Chat storage、UI、刷新机制或其它 BioWeave 模块。

## Acceptance criteria

- [x] 生产 World Model Prompt 不再包含当前 fixture 的具体 species 名称或剑灵案例，且长度和重复规则明显收敛。
- [x] Prompt 明确普通人类 baseline 可在已建立的人类男性/女性类型下使用，并明确事实/规则/例外优先级。
- [x] Prompt 明确非人类必须走 type-local Evidence Gate；名称和类人身体线索不能触发人类模板。
- [x] analyzer 通用拒绝父 species 重复 biological_type，不依赖 `魔族` 等固定名称。
- [x] fertilization 只保留受精机制/角色语义，不把互动行为当作受精。
- [x] 现有 final consistency guard 行为保留，且 capability 为 `null` 不误删独立有效规则。
- [x] 新增通用测试和既有 World Model 测试全部通过。
- [x] 未修改 schema、AnalysisInput、API、Chat storage、UI 和其它明确排除模块。

## Open questions

无。实现前只需用户批准本规划摘要；批准不等于已开始实现。
