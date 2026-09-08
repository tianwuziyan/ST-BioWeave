# 修复 World UI 类型展示与非人类能力证据

## Goal

修复本次真实复测暴露的两个独立问题：World 页面必须展示 AI 返回的全部
`species[].biological_types[]`，同时非人类 capability 的 `true` / `false` /
`null` 必须严格区分“明确具备”“明确不具备”和“无法确认”。保持现有
`species -> biological_types -> capabilities` 结构、AnalysisInput、API、Chat
保存与 World Model 主流程不变。

## Confirmed Repository Facts

- 附件 `输入文件.txt` / `输出结果.txt` 是本次 API 请求与返回的复测资料，作为
  回归 fixture 参考，不是代码修改指令。
- `ui/world.js` 当前已经从 `species[].biological_types[]` 取数组并遍历，但现有
  UI 测试只覆盖单个 canonical `双性`，没有锁定“男性、女性、双性”同时展示，
  需要把动态显示行为作为明确回归契约。
- `ai/analyzer.js` 的非人类 capability guard 当前把通用的
  `没有 / 无 / 未记录 / 不存在` 等上下文与能力否定混在一起；因此“仅存在假孕
  现象，无实际妊娠记录”可能被转换为 `can_carry_pregnancy: false`。
- 非人类类型的 species-local Evidence Gate 已在上一轮建立；本轮不能通过硬编码
  删除妖族男性/女性来替代证据判断。
- 人类 biological type 当前绕过非人类 field scrub，以保留现实人类 baseline；本轮
  不得改变这条路径。

## Requirements

### R1. World UI 动态展示所有 biological types

- World view 与现有编辑器都以 `species[].biological_types[]` 为唯一类型来源。
- 每个数组元素都必须渲染，不限制为男性/女性，不使用 biological type 白名单，
  不因缺少中文映射而跳过未知字符串。
- `双性`直接显示为“`双性`”；`Alpha`、`Beta`、`Omega`、`无性`及世界自定义名称
  也必须正常显示并继续 HTML 转义。
- 不改变 schema key、保存结构、World 页面布局或响应式行为。

### R2. Non-human capability tri-state Evidence Gate

- 对每个非人类 biological type 的每个 capability 独立判断：
  - `true`：AnalysisInput 的同 species/type field-local 证据，或允许的明确
    baseline，直接支持具备能力；
  - `false`：AnalysisInput 的同 species/type field-local 证据，或允许的明确
    baseline，直接支持不具备能力；
  - `null`：只有缺失、未观察、未记录、没有实际记录、资料未说明、仅有假孕等
    不足以确认的表述。
- “没有证据证明可以”不得转为 `false`。
- “没有观察到”“目前没有实际记录”“仅存在假孕”不得转为 `false`，除非同一
  证据同时明确说明不能、无法、不具备或其它等价的能力不可能结论。
- 非人类 biological type 名称（包括男性/女性）不得触发人类 capability 模板。
- 现有 species-local type 识别保持：有证据保留，没有证据才删除；不得直接硬编码
  删除妖族男性/女性。

### R3. Human baseline compatibility

- `species = 人类` 的现有 capability baseline 与世界规则覆盖优先级不变。
- 本轮 guard 调整只收紧非人类能力证据，不把人类男性/女性正常 baseline 改成大量
  `null`。

### R4. Prompt / validator contract

- World Model Prompt 明确 false 也必须有 field-local 明确负证据；缺证据为 null。
- 结构 schema 不变，开放 biological type 名称不增加 enum。
- 仅保留分析响应边界上的语义修正，不改变手动编辑、AnalysisInput、API、Chat-local
  保存、刷新流程。

### R5. Regression coverage

- World UI：人类的 `[男性, 女性, 双性]` 三项全部出现在渲染 HTML 中；自定义名称
  至少验证一个不依赖映射的类型正常显示。
- Non-human capabilities：
  - “仅存在假孕，无实际妊娠记录” -> `can_carry_pregnancy: null`；
  - 明确“不能怀孕/无法被受精”等 -> 对应字段 `false`；
  - 明确“能够产生精子/能够妊娠”等 -> 对应字段 `true`；
  - 其他无证据字段仍为 `null`；
  - 人类 baseline 回归保持正常。
- 保留已有妖/魔 species-local type 与非人类模板隔离测试。

## Acceptance Criteria

- [x] World UI 对 `[男性, 女性, 双性]` 三个 biological type 全部显示，且 `双性`
      不显示为“双性/间性”。
- [x] World UI 对 Alpha 或其它自定义 biological type 不依赖预定义映射即可显示。
- [x] 非人类只有“无记录/未观察/仅假孕”等缺失性证据时，所有对应 capability 为
      `null`，不误写 `false`。
- [x] 非人类明确不能/无法/不具备某能力时，对应 capability 可以为 `false`；
      明确具备时可以为 `true`；字段之间不互相推断。
- [x] 妖族男性/女性是否保留仍由现有 species-local Evidence Gate 决定，代码没有
      针对妖族的硬删除。
- [x] 人类男性/女性的现实 baseline 不回归。
- [x] 不修改 schema 层级、AnalysisInput、API、Chat 保存、World Model 主结构或其他
      模块。
- [x] World Model 专项测试、全量测试、项目检查、语法检查与 diff 检查全部通过。

## Out of Scope

- 不重构 World Model schema、AnalysisInput、API、Chat persistence、刷新链路或其他
  BioWeave 模块。
- 不建立新的 ontology、capability 矩阵、证据数据库或人物/事件/状态模块。
- 不通过硬编码物种或 gender 列表解决妖族类型识别。
- 不进行本轮真实 SillyTavern 复测；实现完成后交给用户使用同一份输入复测。

## Open Questions

None. 用户已明确 UI 动态展示、capability tri-state 语义、human baseline、species-local
type 识别边界和修改范围。
