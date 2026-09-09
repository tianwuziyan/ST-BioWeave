# World Model fixture 污染清理技术设计

## 1. 目标边界与数据流

保持现有 World Model v1 数据结构和请求链路，只修复 Prompt 与 Analyzer 的职责边界：

```text
AnalysisInput
  -> 通用 World Model Prompt
  -> AI 语义提取 JSON
  -> parseWorldModelResponse（schema 规范化/校验）
  -> applyWorldModelEvidenceGuard（分析阶段的 species/type/字段证据边界）
  -> Human Male/Female fallback
  -> applyWorldModelFinalConsistencyGuard（capability 下游一致性）
  -> Chat-local World Model
```

不改变 `storage/schema.js`、`ai/input-builder.js`、请求 Profile/Secret、Chat storage、World UI 或其它业务层。手动编辑仍只经过结构规范化；Evidence Gate 和 Human fallback 只作用于 AI 分析路径。

## 2. Prompt 职责

重写 `WORLD_MODEL_CORE_INSTRUCTIONS` 和输出契约，保留少量可执行的通用原则：

1. 从本次 `AnalysisInput` 识别实际存在的 species，再识别各 species 下资料支持的 biological type。
2. biological type 是开放名称的性别/生殖分类；不把 species、亚种、身份、职业、阵营、来源、属性或临时状态当成 type。
3. Human 只在资料支持普通人类背景时建立；已建立的 Male/Female 可使用分离的现实 baseline，明确事实优先，缺失类型不补齐。
4. Nonhuman 逐 species、逐 type、逐字段使用当前资料，不使用模型常识、不跨层借证据，不确定值为 `null`。
5. `fertilization` 只记录配子结合的真实机制和当前 type 角色。
6. 严格输出现有 v1 schema；不放入具体幻想 species 正例，也不重复解释 Analyzer 能确定完成的结构检查。

输出契约仍列出 v1 必需字段，因为这是模型与解析器之间的接口；只压缩措辞，不删除字段。

## 3. Analyzer 边界

### 3.1 物种/type 证据关联

删除 `speciesEvidenceAliases()` 及所有具体物种分支。改为只使用当前模型返回的 exact species 名称作为证据关联 token，并在同一 evidence unit 中查找 type。保留很小的、与具体世界无关的上下文检查，阻止：

- 物种与外部人类/伴侣之间的互动被误认为该物种 type；
- 单个角色的标签被升级成 species-level biological type；
- 明确否定或不确定文本被当作存在证据。

这些检查只验证 AI 输出是否能在当前输入中找到同层证据，不负责从自然语言推导新的物种学知识。

### 3.2 开放 type 与通用结构过滤

保留开放 `biological_type.name`。`normalizeBiologicalTypeName()` 只做 Human 常见英文标签、通用性别标签和固定“双性”名称的本地化/规范化；不建立 species/type registry。

`isObservedNonBiologicalType()` 只保留：

- 空名称或与父 species 完全相同；
- 父 species 加有限通用群体/种族后缀形成的明显重复；
- 明确的性别模糊/临时状态等不具备固定 biological type 语义的标签。

删除对任意具体物种、亚种、来源或属性词的判断。single-type 不参与字段证据授权，`fieldEvidenceUnits()` 永远只返回当前 species + type 的直接证据单元。

### 3.3 Human baseline

`applyWorldModelEvidenceGuard()` 在确认 Human type 有当前输入证据后，对名称恰为 `男性` 或 `女性` 的类型执行小型 fallback：

- 只填 `null` capability/rule；raw AI 已给出的值优先；
- 男性填普通精子/受精供体能力，受精文本使用供体角色，不填女性周期、排卵、妊娠、孕期、分娩；
- 女性填普通女性能力、受精受体角色、周期、排卵、妊娠、约 40 周孕期和分娩；
- 其它 Human type 不进入该 fallback；
- 若 raw 结果已给出与 world/story rule 对应的非空规则，fallback 不用相反的默认值覆盖该字段，避免最终 guard 抹掉明确 override。

普通人类 fallback 不创建 Human/species/type。对于非人类，即使 type 名称是 `男性`/`女性`，继续走 type-local Evidence Gate，全部缺证据字段保持 `null`。

### 3.4 Final consistency guard

保留现有 `applyWorldModelFinalConsistencyGuard()`，只处理下游确定性约束：

- `can_produce_ova: false` 清除 `ovulation`；
- `can_carry_pregnancy: false` 清除 pregnancy/carrying、gestation、labor；
- fertilization 角色与 `can_be_fertilized`/`can_fertilize` 冲突时清除冲突 rule；
- `null` 不触发清理；
- Human baseline 的 roleless fertilization 文本继续被规范为供体/受体表述。

不新增补灵、双修、性交或其它世界词汇黑名单；fertilization 的语义由 Prompt 与 AI 提取负责，Analyzer 只保留必要的机制存在和角色一致性安全检查。

## 4. 测试设计

在现有 World Model 测试中以原创名称为主验证分析路径，raw API 响应用于模拟 AI 提取结果：

- 普通 Human Male/Female baseline、缺失类型不补、自定义类型不继承；
- 原创非人类无 type、Male/Female unknown、局部 capability 证据；
- 单一 type 不吸收 species-level 规则；
- exact/generic-suffix parent/type duplicate；
- 临时 type、互动非受精、Human Male 妊娠 override；
- Prompt 不含具体世界先验；
- 读取两个生产文件的静态污染 regression，拒绝已知 fixture-specific 复发和 registry 标识。

现有 schema、请求消息、失败保留和 UI 测试继续保留；只改写直接依赖旧 fixture aliases 的行为测试，使它们验证同一通用契约而非某个世界。

## 5. 兼容性、风险与回滚

schema v1 和持久化数据不迁移。主要行为变化是：历史 fixture 别名不再被 Analyzer 当作同一 species，以及 AI 返回的 Human Male/Female 缺失字段会获得有限 baseline。若证据 gate 过严，只需回滚 exact evidence predicate 或收窄上下文检查；若 baseline 影响既有世界规则，只回滚 fallback 条件，不涉及 API、storage 或 UI。
