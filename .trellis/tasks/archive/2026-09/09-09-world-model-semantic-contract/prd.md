# 强化 World Model 通用字段语义 Contract

## Goal

基于两次真实角色卡黑盒结果，修正 World Model 生成前的通用语义 Contract，使模型在任意 AnalysisInput 中稳定区分 `species`、`biological_type`、五个 capability、`fertilization`、`lifecycle` 与 temporary state。只清理语义边界，不引入任何具体幻想 species 知识，不改变 World Model v1 schema 或下游消费者。

## Confirmed baseline

- 当前正式 capability 只有 `can_produce_sperm`、`can_produce_ova`、`can_be_fertilized`、`can_fertilize`、`can_carry_pregnancy`，值为 `true` / `false` / `null` 三态。
- `Event`、`State`、`Projection` 当前没有读取单个 capability；项目不需要把 `lactation`、`regeneration` 或 `shapeshifting` 扩展为结构化字段。它们如被资料提及，仍应落在现有规则/特殊规则文本中，而不是动态增加 key。
- `ui/world.js` 已按 `species.map` → `biological_types.map` 使用统一 renderer，不需要 Human 或 Nonhuman 分支。
- `ai/analyzer.js` 当前只有开放类型名、同名/通用后缀重复、species/type 局部证据、Human Male/Female baseline、字段证据和最终一致性 guard；未发现针对具体幻想 species 的生产规则。本轮不把它扩展为中文世界观解析器。
- 当前 Prompt 已覆盖层级分离、Human fallback、Nonhuman 不继承 Human template、跨 species/type 隔离和基础受精语义；缺口是这些规则没有集中明确说明稳定 type、空数组优先、逐字段三态证据、生命周期语义边界、临时/可逆状态和输出前自检。

## Requirements

### R1. 精简并强化 Prompt Contract

在 `ai/prompts.js` 的固定 World Model 指令中，以少量不重复的句子明确：

- `biological_type` 只表示当前 species 内稳定存在的性别、生殖角色或直接影响生殖机制的分类。species、亚种、职业、身份、阵营、等级、形态以及临时/可逆/条件性变化不能成为 type；证据不足时保留 `biological_types: []`。
- 五个 capability 必须逐字段独立取证：明确具备为 `true`，明确不具备为 `false`，其余（未提及、未知、通常/一般描述）为 `null`。除已建立的普通人类男性/女性 baseline 外，类型名称不得推导能力。
- `fertilization` 只表示真实受精、授精或配子结合及当前 type 的角色；性交、体液/能量交换、感染/寄生、侵蚀/异化、身体改造、觉醒、个体生成、力量或关系变化本身不构成受精证据。
- `lifecycle.maturation` 只表示生物成熟或生命阶段变化，`aging` 只表示寿命、衰老或明确抗衰老生理；职业、修炼、技能、关系和力量 progression 不得写入 lifecycle。
- Human baseline 只适用于已经由资料建立的普通人类“男性”或“女性”；其它 Human type 和所有 Nonhuman type 都必须从当前 species/type 局部证据逐字段判断。
- 输出前要求模型做不输出的内部自检：每个 type 为什么成立、每个非 null capability 的直接依据、fertilization 是否真的描述受精、lifecycle 是否真的描述生命周期；无法回答时降为 `null` 或删除错误 type。

### R2. Analyzer 保持轻量和通用

- 不新增具体 species/type 名称、alias、blacklist、fantasy registry 或世界观关键词词典。
- 保留现有通用的格式规范化、Evidence Gate、Human baseline、parent species/type 明显重复检查、`false` 与 `null` 区分及 final consistency guard。
- 只有测试暴露出可由结构确定的通用错误时才补 guard；不让 Analyzer 重新理解职业、种族、临时状态或幻想生理语义。

### R3. 增加原创名称回归测试

在 `tests/world-model.test.js` 中使用本轮新造且生产代码从未见过的 species/type 名称，覆盖：

- 临时/可逆身体变化不建立 biological type；
- parent species 加通用后缀不成为 type；
- 性交伴随能量/体液等非受精效果时 `fertilization` 为 `null`；
- Nonhuman 的“男性/女性”名称不获得 Human capabilities；
- 修炼/职业/技能等 progression 不成为 `lifecycle.maturation`；
- Prompt 含上述通用 Contract 且生产源码不含 fixture-specific species knowledge。

现有合理回归测试继续保留，不修改统一 UI、Event、State、Projection 或五字段 schema。

### R4. 验证边界

完成后执行 World Model tests、全项目 tests、`npm run check`、相关 `node --check`、`git diff --check`，并检查 diff 只包含本轮 Prompt/测试/必要 Contract 文档及任务记录。

## Acceptance Criteria

- [x] 生成的 World Model Prompt 不包含任何具体幻想 species/type 教学，也不通过新增另一批例子替代旧污染。
- [x] Prompt 对稳定 biological type、空数组优先、五字段独立三态证据、fertilization、maturation/aging、temporary state、Human/Nonhuman baseline 和内部自检各有一条清晰且不重复的约束。
- [x] `ai/analyzer.js` 没有新增具体物种知识；现有通用 Evidence Guard、Human baseline 与 final consistency guard 行为不回退。
- [x] 五 capability schema、AnalysisInput、统一 UI renderer、Event/State/Projection 均未改变；模型返回的 schema 外 capability key 仍不会进入 canonical model。
- [x] 新增原创物种测试全部通过，并验证未知保持 `null`、错误 type 被移除、非受精行为不进入 `fertilization`、progression 不进入 `maturation`。
- [x] World Model tests、全项目 tests、`npm run check`、`node --check` 和 `git diff --check` 全部通过。

## Scope

### In scope

- `ai/prompts.js` 的固定 World Model 语义 Contract。
- `tests/world-model.test.js` 的原创名称回归测试与 Prompt Contract 断言。
- 如实现需要同步可执行契约，只更新已有 World Model 相关 Trellis spec；不新建抽象或依赖。

### Out of scope

- 新增 capability、修改 `storage/schema.js` 或修改任何 World Model 下游读取方式。
- 修改 `ai/input-builder.js`、`ui/world.js`、Event/State/Projection、Genealogy、Runtime、API/Chat 存储。
- 建立具体幻想 species registry、ontology、dictionary 或 species-specific renderer。

## Open questions

无。用户已明确本轮保持五 capability schema、只做通用 Prompt Contract 强化，且未发现需要扩展下游消费者的证据。
