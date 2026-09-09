# World Model 三态语义与 Human baseline 设计

## 1. 现有数据流与问题定位

当前数据流为：

AI JSON → parseWorldModel()/normalizeWorldModel() → applyWorldModelEvidenceGuard() → applyWorldModelFinalConsistencyGuard() → ui/app.js 保存或加载 → ui/world.js 展示

审计结论：

1. storage/schema.js 的正式字段已经允许 string | null。因此 "无" 是现有 schema 内的 canonical value，不需要 schema migration。
2. normalizeBiologicalType() 目前用 localizedWorldModelText() 处理规则值；nullableText() 会把缺失、空字符串、unknown/null/未知/不确定转成 null，但不会区分已知 absence，也不会把 absence 同义表达统一成 "无"。
3. humanBaseline() 是 baseline 的实际来源。Male 当前四项（以及 pregnancy_or_carrying）为 null，Female 当前四项已经是非空值。因此 Female “仍可能为 null”不是 baseline 文本缺失，而是 Human species 识别失败、alias 未 canonicalize、或 type 未经过 Human branch 时退化为 Nonhuman path 的结果。
4. applyWorldModelFinalConsistencyGuard() 当前把 can_produce_ova === false 和 can_carry_pregnancy === false 对应规则设成 null，并在 fertilization 机制检查中把 "无" 视为无效描述。这些行为必须改为保留/生成 canonical absence，而不是清除已知 absence。
5. normalizeSpecies() 当前只做名称局部翻译，不合并 species。Human 会被替换为 人类，但 人类 (Human) 会变成 人类 (人类)；现有黑盒结果因此出现两个 species，第二个不会使用 Human baseline。
6. ui/app.js 只在加载/保存边界调用 normalizeWorldModel()，没有另一个 species merge；ui/world.js 的 displayText() 对 null 显示“未知”、对字符串原样显示，所以 "无" 可以直接显示为紧凑值，UI renderer 不需要特殊分支。

## 2. 三态 Contract

### 2.1 Canonicalization boundary

在 normalizeBiologicalType() 的 rule-field boundary 增加轻量的通用规则值归一化：

- 缺失、空、未知 token → null；
- 明确的 absence token/短语（例如 canonical "无" 及明确“不具备/不适用/不存在”等）→ "无"；
- 其它非空文本原样保留为规则描述。

该逻辑只作用于固定的 rule/lifecycle string 字段，不扩展为中文世界观 NLP。尤其不能把“没有说明”“资料不足”“尚未确定”归一化为 "无"。

### 2.2 Prompt contract

ai/prompts.js 只补充一组紧凑、无世界观示例的输出规则：

- null 是 unknown；"无" 是 known absent/inapplicable；非空字符串是 known present；
- Human Male/Female baseline 允许使用相同 contract，其中 Male 的已知不适用规则必须写 "无"，Female 使用简洁 baseline；
- 非 Human 没有证据时不能写 "无"；
- fertilization 只有真实受精机制才能是非空机制描述，明确不存在才是 "无"，普通性行为/能量交换仍不是机制；
- 输出前检查每个规则值的证据状态，但不输出检查过程。

把原有“未知标量为 null”的宽泛表述收紧为上述字段级 contract，避免与 canonical absence 冲突。

## 3. Human baseline + Delta

保留现有字段级覆盖顺序：

明确当前个体事实 > 明确转化后/特殊体系规则 > 明确世界级规则 > 可靠 Human baseline > 未知

具体设计：

- humanBaseline('男性') 将 pregnancy_or_carrying、cycle、ovulation、gestation、labor 设为 "无"；fertilization 保留施受精角色描述。
- humanBaseline('女性') 保留现有简洁的 fertilization/pregnancy/cycle/ovulation/gestation/labor 非空 baseline。
- sanitizeHumanType() 仍按 capability 和 rule 各字段独立判断，不会因为新 baseline 整套覆盖显式 delta；自定义 Human type 继续不套 Male/Female baseline。
- final guard 只在确定性 capability/role consistency 需要覆盖时动作：已知 false 关联的 ovulation、pregnancy_or_carrying、gestation、labor 使用 "无"；null 表示未知的字段不因缺失证据被扩大为 absence。
- fertilization 的 "无" 是合法 canonical absence，不能被机制探测清回 null；普通性行为等非机制描述仍按原 semantic guard 置为 null，因为那不是“明确不存在受精机制”的证据。
- capability 为 null 时不自动清除规则；capability 为 false 时只覆盖有直接确定关系的规则，避免把“不能产卵”错误扩展成整个 cycle absence。

## 4. Human species canonicalization

增加一个仅针对 Human 的 species-name canonicalization seam，放在 normalizeSpecies() 的 species name 边界，不把 localizedWorldModelText() 变成全局 species registry：

1. 识别明确的 Human 显示变体（包括括号/空白包裹的 Human 形式），canonical display 固定为 人类。
2. isHumanSpeciesName() 与 species evidence matching 使用同一 Human-only canonical predicate，确保名称 canonicalize 后仍能通过 Human evidence branch。
3. normalizeWorldModel() 在 species normalization 后合并 canonical 人类 entry；合并 biological type 时只按已有 canonical type name 去重，不推断新的 biological type。
4. 字段合并遵守三态优先级：null 不能覆盖已知 "无" 或已知非空值；相同已知值直接保留。若同一 canonical Human/type 的两个已知非空值互相冲突，采用稳定的输入顺序保留首个值，不拼接或臆造第三种规则；该风险在测试和实现报告中显式记录。
5. Human description、types、medical_context 等其它字段不因此获得世界知识；非 Human species 不做别名合并。

这条 canonicalization 解决 人类 / Human / 人类 (Human) 产生多个 entry 的路径，同时不允许借机建立其它 species synonym table。

## 5. 保持的边界

- biological_type 仍只表示稳定的生理/生殖分类；路线、职业、身份、阶段、临时状态不因 baseline/delta 进入 type。
- Nonhuman branch 继续逐 species/type 做 Evidence Gate；仅有“男性/女性”名称不获得 Human baseline。
- fertilization、maturation、gestation 的既有语义 guard 保留，不把普通行为、progression 或非妊娠变化升级为规则。
- UI 继续使用统一 species.map()/biological_types.map() renderer；"无" 由现有 displayText() 直接显示，null 仍显示“未知”。

## 6. 兼容性与回滚

- 不改 WORLD_MODEL_SCHEMA、五个 capability、AnalysisInput 或持久化字段。
- 不改 Event/State/Projection/Runtime/API。
- 未来实现只需回滚本任务在 ai/prompts.js、ai/analyzer.js、tests/world-model.test.js、docs/DATA-MODEL.md 的自有 diff；不得用 destructive git 命令覆盖当前分支上已有的其它 dirty work。
