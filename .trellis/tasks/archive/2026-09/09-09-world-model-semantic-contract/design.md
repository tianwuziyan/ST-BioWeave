# World Model 通用字段语义 Contract 设计

## 1. 边界与数据流

保持现有数据流不变：

`AnalysisInput` → `buildWorldModelMessages()` 固定 Prompt → AI JSON → `normalizeWorldModel()` → 分析专用 Evidence Guard → final consistency guard → canonical World Model v1。

本轮只调整 AI 生成前的语义约束和回归测试。schema normalizer 继续只投影正式字段，Analyzer 继续负责结构与可确定一致性，不承担开放世界语义分类。

## 2. Prompt 设计

重写 `WORLD_MODEL_CORE_INSTRUCTIONS` 的重复表达，保持固定指令短而密集，按以下顺序组织：

1. 任务与层级：从当前 AnalysisInput 提取 `species → biological_types → capabilities / reproduction_rules / lifecycle / special_rules`，名称开放。
2. 分类边界：type 必须是当前 species 内稳定的性别/生殖分类；非生物分类、临时/可逆/条件性变化不能升级为 type；资料不足保留空数组。
3. 字段证据：五个 capability 逐字段独立使用 true/false/null；未知和“通常”不等于 false；不得跨 species/type 借证据。
4. 字段语义：明确 fertilization 只表示受精机制；明确 maturation/aging 只表示生命周期；临时变化留在已有 type 的 rules/exceptions。
5. baseline：仅已建立的普通人类男性/女性可使用普通现实 baseline；其它 Human type 和所有 Nonhuman type 按局部证据重新判断，明确设定优先。
6. 内部自检：输出前检查 type 成立依据、每个非 null capability 的直接依据、fertilization 和 lifecycle 的语义；不满足就降 null/删 type，不输出思考过程。

输出 schema contract 保持现状，只补充必要的语义提示，不复制一遍 schema 教学，也不加入具体世界例子。

## 3. Analyzer 责任

本轮预计不修改 `ai/analyzer.js`。现有通用 guard 已能处理本任务的确定性边界：

- 规范化并丢弃 schema 外 capability key；
- 只保存当前 species/type 局部支持的字段；
- 保持 `null` 与明确 `false` 的区别；
- 处理 Human Male/Female baseline 和世界规则覆盖；
- 删除 parent species 同名/通用后缀重复 type；
- 在保存前清理与 false capability 冲突的 reproductive rules。

现有“双性”临时状态 guard 是针对通用固定分类语义的结构性处理，不扩展为具体物种规则。若新增回归失败，优先确认测试输入是否违反现有证据边界；只有能由结构确定判断的缺陷才允许最小修正。

## 4. 测试设计

在现有测试之后增加一组全新原创命名的黑盒式 analyzer 测试，并增加 Prompt 文本断言：

- `澜壳体`：短暂/可逆性征变化不能成立固定 type；
- `雾棱群`：`雾棱群族` 等 parent-name 后缀不能成为 type；
- `回声囊体`：性交伴随能量共鸣但没有受精语义，`fertilization` 为 `null`；
- `浮芯体`：仅有男性/女性分类时五个 capability 全为 `null`；
- `阶纹生物`：修炼或力量等级 progression 不写入 `maturation`；
- Prompt 断言稳定 type、空数组优先、逐字段 true/false/null、fertilization 排除项、lifecycle 边界和内部自检均出现，且不出现具体 fixture species 教学。

测试 fixture 只在测试文件出现，生产 Prompt/Analyzer 不读取或注册这些名称。

## 5. 兼容性与回滚

不改变 canonical payload、AnalysisInput、UI、下游模块或依赖。若 Prompt 回归导致已有测试不稳定，回滚点是只还原 `WORLD_MODEL_CORE_INSTRUCTIONS` 文本和本轮新增测试；不需要数据迁移。
