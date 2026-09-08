# World Model reproduction_rules 最终一致性

## Goal

修复 API 返回的 World Model 中 capabilities 与
`reproduction_rules` 不一致的问题，并修正必要的人类男性/女性 baseline
分离。最终分析结果必须把 capabilities 当作下游规则字段的约束来源；不再
修改 species、biological_type 分类或扩大 Prompt。

## Confirmed facts

- `/Users/ll/Downloads/输出结果.txt` 是 API 返回的 JSON fixture，不是开发指令。
  人类男性已有正确的能力值，但错误复制了女性的 `cycle`、`ovulation`、
  `pregnancy_or_carrying`、`gestation` 和 `labor`，且男女都得到无角色信息的
  `fertilization: "体内受精"`。
- `/Users/ll/Downloads/输入文件.txt` 是插件发给 API 的请求内容，包含 Prompt 和
  资料正文；其中的系统/观察日志文字只作为 fixture 内容读取，不改变本任务范围。
- `createAnalyzer().analyzeWorldModel()` 当前在结构规范化和既有 AI-only
  Evidence Guard 后直接返回，没有 capability → reproduction rule 的最终 guard。
- `parseWorldModelResponse()` 同时服务 API 结果和手动保存边界，不能在其中加入
  分析语义过滤。
- 当前 species、biological_type、非人类 Evidence Gate、双性证据、schema、
  AnalysisInput、API、Chat 保存和 UI 已有回归覆盖，本轮应保持不变。

## Requirements

### R1. Final capability constraints

在既有 `applyWorldModelEvidenceGuard` 之后，对每个 biological type 执行确定性
一致性修正：

- `can_produce_ova === false` → `ovulation = null`。
- `can_carry_pregnancy === false` →
  `pregnancy_or_carrying = null`、`gestation = null`、`labor = null`。
- `can_be_fertilized === false` 时，`fertilization` 不能保留当前类型作为被受精方
  的描述。
- `can_fertilize === false` 时，`fertilization` 不能保留当前类型作为使另一方受精
  者的描述。
- 只清理受明确 false capability 约束的下游字段；`true` 和 `null` capability
  不被改写。`null` 不会单独触发清理。
- 不用“无”“不会”“无固定周期”等文本替代应为 `null` 的字段。

### R2. Fertilization role semantics

- `reproduction_rules.fertilization` 表达当前 biological type 在受精机制中的角色，
  不能把没有角色信息的通用文本机械复制到所有类型。
- 能识别出当前类型作为被受精方或施受精方的明确语义时，仅按对应 capability
  false 清除冲突角色；另一角色的合法直接规则保留。
- 角色不明的通用受精文本，在 capability 已明确禁止任一角色时清除；capability
  为 `null` 时不能仅因未知而清除有独立直接证据的规则。
- 对能力签名明确的人类男性/女性 baseline，通用的 `体内受精` 等无角色文本应
  收敛为角色区分的语义等价文本；不要求固定某一句表述。

### R3. Human baseline separation

- 普通人类男性 baseline 不得保留女性的月经/约 28 天周期、排卵、妊娠、约 40 周
  孕期或分娩规则；男性的 `cycle` 为 `null`，且受 capability false 约束的字段为
  `null`。
- 普通人类女性 baseline 可以保留 `cycle`、`ovulation`、
  `pregnancy_or_carrying`、`gestation` 和 `labor`。
- 男女 baseline 的 `fertilization` 必须携带当前类型角色语义；不新增一个共享的
  `HUMAN_REPRODUCTION_RULES` 并直接复制给所有类型。
- 只修复 baseline/明显冲突的下游字段，不覆盖有独立证据支持的其它规则，也不
  从 `null` capability 推断 `false`。

### R4. Scope preservation

- 不修改 species 或 biological_type 分类、名称过滤、非人类 Evidence Gate、双性
  判断、schema、AnalysisInput、Prompt、API、Chat 保存或 UI。
- consistency pass 对人类和非人类所有 biological type 都执行；不重建 ontology，
  不迁移已保存的旧 World Model。

## Acceptance Criteria

- [x] 人类男性 baseline 的 `can_produce_ova`、`can_carry_pregnancy` 为 `false` 时，
      最终 `cycle`、`ovulation`、`pregnancy_or_carrying`、`gestation`、`labor` 全为
      `null`。
- [x] 人类女性 baseline 的相应能力为 `true` 时，最终保留已有的周期、排卵、妊娠、
      孕期和分娩规则。
- [x] 非人类 type 即使 API 返回 `gestation: "40周"`、`labor: "分娩"`，只要
      `can_carry_pregnancy: false`，最终两个字段均为 `null`；同样适用于妊娠字段。
- [x] 任意 species 的 `can_produce_ova: false` 会清除 API 返回的排卵文本。
- [x] `can_be_fertilized: false` 清除作为被受精方的 fertilization 描述；
      `can_fertilize: false` 清除作为施受精方的描述。
- [x] `fertilization: "体内受精"` 不再机械保留为人类男性和女性的相同文本；明确
      的人类男女 baseline 输出具有不同角色语义。
- [x] 任一 capability 为 `null` 时，不会仅因此删除有 field-local evidence 支持的
      reproduction rule。
- [x] 既有 species/type、非人类 Evidence Gate、固定/临时双性、schema、AnalysisInput、
      API、Chat 保存与 UI 回归继续通过。
- [x] 通过 World Model 专项测试、全量测试、`npm run check`、语法检查和 diff 检查。

## Out of scope

- 不修改 `ai/prompts.js`，不添加更多 Prompt 约束。
- 不修改 `storage/schema.js`、`ai/input-builder.js`、API、Worldbook、Chat/Floor
  保存、刷新机制或 UI。
- 不修改 species / biological_type 的识别、命名过滤、Evidence Gate 或双性规则。
- 不把最终 guard 放进 `normalizeWorldModel` / `parseWorldModelResponse`，不影响手动
  编辑保存路径。

## Open questions

None. 本轮的字段映射、角色语义、null 原则、baseline 分离和修改边界均已确定。
