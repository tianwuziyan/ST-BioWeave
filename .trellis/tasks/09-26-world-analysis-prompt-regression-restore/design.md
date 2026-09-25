# Technical Design

## Evidence boundary

历史语义以三个指定提交和当前 HEAD 的实际文件为准。历史实现只提供行为证据，不直接恢复代码。当前 canonical owner 继续是 `.trellis/spec/domain/world-model.md`；本 task 文档保存审计过程、矩阵与设计冻结，不复制成第二份领域合同。

## Frozen semantic pipeline

```text
Fact Discovery
  -> Species Discovery / Binding
  -> Candidate biological classification
  -> Exclusion Gate
  -> Stability Gate
  -> Biological / Reproductive Classification Gate
  -> Evidence Sufficiency
  -> Type Creation
  -> field-level evidence / capability tri-state
  -> unarchived fact review
```

为避免歧义，实际优先级冻结为：Species existence 不等于 type existence；Exclusion Gate 先于低推理 type creation；type name 不授权 capability；非 Human 不借 Human baseline；absence of evidence 不等于 false。

## Full / Supplement boundary

```text
Full:       permitted evidence -> same discovery/classification invariants -> complete model
Supplement: Existing baseline + permitted evidence -> same invariants -> differential review -> sparse patch
```

Existing baseline 只能用于 comparison、completeness review 和 consolidation；不能证明新增事实。Empty Patch 只有在完成 review 后没有合法 ADD/CHANGE candidate 时才成立。若 Existing identity/outlet 本身错误，当前 remove protection 造成的 structural correction gap 单独记录，不通过本任务扩大 REMOVE。

## AI / deterministic boundary

- AI：narrative Fact Discovery、scope、species binding、classification、baseline-aware consolidation。
- Deterministic program：结构与 canonical identity、evidence isolation、field/delta safety、merge、complete-model consistency、strict validation。
- 禁止恢复历史具体名称分支、fixture-specific if/else、大型 regex narrative classifier 或第二套 NLP parser。

## Documentation update shape

1. 在 canonical spec 增加回归恢复章节和矩阵引用/冻结规则。
2. 在本 task `design.md` 加入完整 `World Analysis Prompt Regression Matrix` 与 generic fixture design。
3. 仅在 `docs/CONTEXT-AND-PROMPT.md` 存在直接矛盾时同步；其它历史文档保持不扩散。

## Generic regression fixture design

测试设计使用匿名 `Species-A`、`Species-B`、`Type-A`、`Type-B`、`Occupation-X`、`Group-X` 等占位符，不把它们写入 production logic。每个 fixture 必须同时声明：permitted evidence、scope、预期 species/type existence、字段级 capability 预期、Full/Supplement 模式和是否允许 candidate delta。

## Review-required condition

若历史提交表达的行为与当前 canonical spec 或后来通用设计不能同时成立，矩阵状态写 `REVIEW REQUIRED`，并列出冲突段落、影响边界和未决选择；本任务不代替产品决策。

## World Analysis Prompt Regression Matrix

判定原则：`KEEP` 只表示行为合同的边界、顺序和反例仍完整可观察；Prompt 中存在相似文字不够。核心语义保留但优先级、species/type binding 或 negative boundary 变得间接时判为 `STRENGTHEN`。`RESTORE` 只用于当前合同实质缺失。`SUPERSEDED` 必须说明替代机制及其保留的不变量。`DO NOT RESTORE` 只禁止旧实现 hack，不否定其保护的领域 invariant。

| Rule / Invariant | Historical source commit | Historical behavior | Current behavior | Status | Reason | Required regression coverage |
|---|---|---|---|---|---|---|
| Species existence 与 biological_type existence 独立 | `1f382a0`, `784cd12` | 先独立保留 species；没有 type evidence 时保留 species 且 `biological_types: []` | 当前 Prompt/spec 明确分层，现有测试覆盖空 type species | KEEP | 顺序、空数组语义和“不得为完整性补 type”仍完整 | A |
| biological_type 必须是 species-local、stable、biological/physiological/reproductive classification | `1f382a0` | type 只在父 species 内表达稳定生理/生殖分类 | 当前有 A–E gate 和排除词，但边界集中在长规则中，负面类别与低推理许可未形成独立优先级 | STRENGTHEN | 核心语义保留，但解释空间比历史明确排除更大 | B, J, O |
| Biological Type Exclusion Gate | `1f382a0`, `784cd12` | 明确排除 species/taxonomy、血统、职业、修炼、组织/阵营、属性、形态、临时改造、人格、偏好和个体描述 | 当前列出多数排除类别，但没有把 Gate 作为 low-inference 前的强制阶段单独冻结 | STRENGTHEN | negative boundary 存在但优先级弱化，可能被身体/生殖关联反向升级 | B, O |
| Exclusion Gate 优先于 low-inference discovery | `784cd12` | 非人类 evidence gate 先阻断人类常识和标签扩展，再允许直接、低推断的 species-linked classification | 当前允许 stable reproductive clusters 低推理建类，但没有独立的顺序合同 | STRENGTHEN | 不是缺少能力，而是顺序不够强，正对应当前回归风险 | B, C, O |
| Species/type binding 是直接同 species scope，而非名称或上下文近似 | `784cd12` | 非人类 type/capability/rule 必须在同一 species 上下文有直接或唯一低推断 evidence；其它 species 不授权 | 当前要求按 species/type 独立举证，但 binding 在部分合同中是间接描述 | STRENGTHEN | 必须把 Species Binding 放在 Exclusion Gate 前并要求 scope-compatible evidence | E, F, O |
| Name Is Not Evidence | `1f382a0`, `784cd12` | type 名称不能单独证明 type existence、能力、规则、生命周期或 Human equivalence | 当前明确“type existence 不授权 capability”，但对名称不能证明 type existence 和其它 outlet 的总合同不够集中 | STRENGTHEN | 防止 Existing/API 输出中的可疑名称被当作事实入口 | E, L, O |
| Nonhuman species-linked evidence gate | `784cd12`, `ce1d095` | Nonhuman 每个 type、capability、reproduction/lifecycle/special rule 均回到同 species evidence；Human 不跨 species | 当前 Prompt/analyzer/spec 大体保留，且有字段级隔离与三态测试 | KEEP | scope isolation、Human boundary 和 field-level unknown 仍是完整可观察合同 | E, F, M |
| Human baseline hierarchy | `1f382a0`, `784cd12` | explicit current evidence > reliable Human baseline > unknown；只适用于已成立的普通 Human Male/Female；Nonhuman 不使用 | 当前 canonical spec 已冻结同一层级、canonical null 和 explicit false/value 优先级 | KEEP | 后来 generalization 没有改变本 invariant，本任务不重新设计 | E, M, N |
| Capability six-key tri-state | `ce1d095` | true 要 positive evidence，false 要 explicit inability，未知/未观察/证据不足为 null；absence ≠ false | 当前 Prompt/spec/test 保留六字段、false gate 和 null semantics | KEEP | 行为合同完整，包含 pseudo-pregnancy/no-observation 反例 | E, G, H |
| pseudo-pregnancy / no observed pregnancy 不推出 false | `ce1d095` | 没观察到 pregnancy 或存在 pseudo-pregnancy 时保持 null | 当前测试与 prompt 保留 unknown boundary | KEEP | 负面边界仍明确 | G |
| Rare/minority stable biological type | `1f382a0`, `784cd12` | 少数/罕见/例外但稳定且可区分的 type 不能因数量少被丢弃 | 当前 Fact Discovery、type completeness 和 tests 明确保留 rare type | KEEP | 新版机制完整保持历史 invariant | I |
| Fact Discovery → Classification → Unarchived Fact Review | `4897c9f`（later general design） | 从完整 evidence 发现事实，再归档到固定或横向 outlet；不只按旧 schema slots 搜索 | 当前已由新版 Fact Discovery、scope/outlet classification、unarchived review 替代旧 slot-first 行为 | SUPERSEDED | 新机制保留“不遗漏有效事实”和“发现不等于推测” invariant，并扩展 outlets；旧 slot-first 不是恢复目标 | K, L |
| Low-inference stable classification | `784cd12` 与后续新版 Prompt | 同 species 有两个或更多稳定、互相可区分的 reproductive physiology/role/capability clusters 时，可在未命名时建立 class | 当前能力存在，但 gate order、single-cluster prohibition、no paired invention 需集中冻结 | STRENGTHEN | 保留新能力，不回滚为“必须原文命名”；补强其前置排除和边界 | C, D, O |
| One cluster 不自动补 paired type | 后续新版 Prompt/tests | 仅一个 stable cluster 只建立该 cluster；不得从常识补另一 type | 当前有 Prompt/test 语句，需与 low-inference stage 一起成为强合同 | STRENGTHEN | 反例需要作为 type creation 的硬后置条件，而非提示性说明 | D |
| Individual-only exception 不升级为 world type/rule | `1f382a0`, `784cd12` | 单一个体、临时状态或异常不得建立 species-wide biological type | 当前 scope model 与 exceptions 已存在，但本回归矩阵需把 type gate 关联固定 | KEEP | 当前通用 scope/outlet 机制保持旧边界 | J |
| Later World Model outlets and safeguards | 后续 World Model commits | 保留 reproductive_mechanisms、six capabilities、projection_rules、Fact Discovery、scope/classification、exceptions、unknowns、medical_context、baseline-aware Supplement、Semantic Delta、final consistency | 当前 spec/design 已覆盖这些能力 | KEEP | 新增通用设计不是历史回归对象，不得因恢复旧边界而削弱 | K, L, M |
| Full/Supplement share biological semantic invariants | `920153f`, `fae2cf5`, `3e207b6` 与历史 type commits | Full 与 Patch 使用同 evidence semantics；Patch 加 baseline comparison，不使用较弱 type rules | 当前共享 core Prompt 与 permitted evidence，但 canonical 合同没有把“同 classification invariants”单独冻结 | STRENGTHEN | baseline-aware interpretation 不应改变 type/evidence boundary | K, L, M, N |
| Existing baseline is comparison only | `920153f`, `fae2cf5`, `3e207b6` | Existing 可比较/合并，不能证明新增 fact；Full 不读取 baseline | 当前已有 baseline isolation 和 Full/Patch message boundary | KEEP | baseline/evidence isolation 行为合同完整 | K, L, M, N |
| Empty Patch means completed review, not skipped analysis | 当前 Supplement 回归场景；父任务 design | 空 Patch 合法，但前提是完整 evidence review 后没有合法 ADD/CHANGE candidate | 当前允许 empty Patch，但未明确要求完成 species completeness、type review 和 missing-fact review 后才能为空 | RESTORE | “空结果合法”存在，但“完成审查”前置语义实质缺失 | K, L |
| Structural Reclassification is independent from Prompt regression | 当前 Supplement remove protection；父任务 design | field CHANGE/add 可用；Existing identity/outlet 错误时 arbitrary REMOVE/重分类仍是独立能力缺口 | 当前 REMOVE protection 仍在，但 canonical spec 尚未集中记录该 gap 与本任务边界 | RESTORE | 恢复设计边界，不开放实现；避免 Empty Patch 或 Prompt regression 偷渡 arbitrary REMOVE | K, L |
| Historical semantic invariant versus implementation hack | `1f382a0`, `784cd12`, `ce1d095` | 历史曾用具体 species/type/fixture 判断、regex 或 deterministic branch 保护边界 | 当前已有更通用 evidence isolation / canonical validation；旧 hack 不应回来 | DO NOT RESTORE | 只拒绝实现手段；被保护的 species-local、tri-state、negative boundary 仍按上列规则保留 | B, E, F, G, O |

### Generic regression fixture matrix

Fixture 名称仅是测试设计占位符，不得进入 production Prompt taxonomy、keyword list 或 deterministic semantic classifier。

| Case | Generic permitted evidence / setup | Expected contract |
|---|---|---|
| A | Species-A existence evidence；无 stable type evidence | Species-A 保留，`biological_types: []` |
| B | Occupation-X / cultivation / social Group-X 同时伴有身体或生殖描述 | 不建立 biological_type；可进入正确的 special rule/outlet 或保持不归档 |
| C | Species-A 有两个稳定、互相可区分且 species-wide 的 reproductive clusters，无 type name | 允许建立两个 evidence-supported stable classes |
| D | Species-A 只有一个 stable reproductive cluster | 只建立一个，不补 paired type |
| E | Nonhuman Species-A 有 male/female 或等价 label，但无 capability evidence | type 可成立；六项 capability 保持 null |
| F | Species-B 有 capability evidence，Species-A 无 | Species-B evidence 不授权 Species-A |
| G | 资料仅说明未观察 pregnancy / pseudo-pregnancy | `can_carry_pregnancy` 不得变 false，保持 null |
| H | 资料明确 Species-A/type 无法 pregnancy | 对应 capability 可为 false |
| I | Species-A 的 stable minority type 有直接 world evidence | 不能因少数/罕见遗漏 |
| J | 单一个体的 physiological exception | 不升级为 world biological_type |
| K | Existing 有 Type-A；permitted evidence 另有未归档的合法 world fact | Supplement 仍提出合法 ADD/CHANGE candidate，不因 baseline 非空返回空 |
| L | Existing 含某 type，但新增 fact 只有 baseline 文本支持 | 不得把 baseline 当 evidence |
| M | Full input 偶然携带 Existing baseline | Full request/model 不消费 baseline |
| N | Supplement input 带 Existing baseline 与同一 permitted evidence | baseline 只用于 comparison/consolidation；分类规则与 Full 相同 |
| O | Candidate 同时像 reproductive cluster 又本质属于 Occupation-X / identity / rank | Exclusion Gate 先拒绝 type creation |
