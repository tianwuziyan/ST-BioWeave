# World Model 三态描述规则修复设计

## 1. 设计目标与职责边界

本轮只处理 `capability` 三态与 description rule 的 final consistency 边界：未知 capability 不得否定已知描述，明确 false 与直接结构冲突仍可被 canonical guard 处理。

职责保持不变：

- Prompt/AI：理解 AnalysisInput 的世界语义并决定字段内容。
- Analyzer normalization：校验类型、保留正式 schema key、把未知和明确 absence 规范化。
- Analyzer Evidence Gate：验证 species/type 与当前 AnalysisInput 的绑定证据。
- Analyzer final guard：只执行可由结构关系确定的 consistency 修正。
- Storage/UI：继续只使用 canonical model；UI 不恢复或重新判断自然语言。

## 2. 当前管线与缺陷位置

```text
AI Raw
  → parseWorldModelResponse()
  → normalizeWorldModel()
  → applyWorldModelEvidenceGuard()
  → applyWorldModelFinalConsistencyGuard()
  → canonical result / trace
```

`normalizeRuleText()` 已正确区分 `null`、`"无"` 和普通非空文本。`applyWorldModelEvidenceGuard()` 的 Nonhuman type filtering 不负责清理 retained type 的 rule value；Human Male/Female 另有 `sanitizeHumanType()` baseline fallback。当前 fertilization 缺陷集中在 final guard 的 `roleConflict` 最后一个兜底条件：

```js
(!roles.recipient && !roles.donor
  && (capabilities.can_be_fertilized === false || capabilities.can_fertilize === false))
```

它把“没有直接 role 证据”误当成“该 rule 与所有 false capability 冲突”。

## 3. 最小修正

将 fertilization consistency 限定为两个直接结构冲突：

```js
const roleConflict = (capabilities.can_be_fertilized === false && roles.recipient)
  || (capabilities.can_fertilize === false && roles.donor);
```

不添加新 helper、词典或 semantic parser，不修改现有 role regex。这样：

- `null` 不会触发冲突；
- `false` 只有在 rule 文本明确表达对应 role 时触发冲突；
- 没有 role 证据的非空 mechanism description 保留，由 Prompt 对其语义负责。

## 4. 同类字段检查

同一 final guard 中的其它规则处理分为两类：

1. Human baseline 的非空角色化描述和男性周期重写：删除。它们不是结构性 absence，而且会覆盖当前 AI 已知值；baseline 应由 `sanitizeHumanType()` 只对 `null` 字段补入。
2. `can_produce_ova === false` 时 `ovulation = "无"`，以及 `can_carry_pregnancy === false` 时 carrying/gestation/labor 为 `"无"`：保留，这是 capability false 对直接结构机制的已知 absence，不会在 capability null 时执行。

因此 final guard 不需要为每个字段增加新的语义分支；测试锁定 `null` 时完整保留，`false` 时现有 absence guard 不回退。Human baseline 的字段覆盖问题在后续专门的合并审计中单独修正。

## 5. Human Baseline + Explicit Delta 合并审计

### 5.1 当前实际行为

Human baseline 在 `applyWorldModelEvidenceGuard()` 内通过 `sanitizeHumanType()` 应用，顺序是：

```text
normalizeWorldModel()
  → Human sanitize / baseline fallback
  → final consistency guard
  → canonical storage / trace
```

当前 `sanitizeHumanType()` 对 capabilities 和 reproduction rules 先查询 `fieldEvidenceUnits()`：

- capability 只要没有命中对应本地 regex，就丢弃当前 AI 值并回退 baseline；
- rule 只要没有命中对应本地 regex，就丢弃当前 AI 值并回退 baseline；
- `special_rules` 仍由现有 direct evidence filter 处理，本轮不因 baseline 审计扩大其职责。

这不是安全的 result-first + fill-null，也不是 baseline-first + explicit delta override，而是 evidence-gated result + baseline fallback。实测确认：Human Female 的 Raw `cycle/ovulation/gestation/labor` 为 `"无"` 或自定义非空描述时，在没有匹配本地字段 regex 的输入下，会整体回退到 Female baseline；Human Male 的 Raw capability `false` 也可能回退为 baseline `true`。

### 5.2 目标合并规则

保持现有字段结构，改为每个正式字段独立合并：

```js
const value = current[key];
return value === null ? baseline[key] : value;
```

这不是简单对象 merge。实现必须显式区分：

- `false`：已知不存在，保留；
- `"无"`：已知规则不存在/不适用，保留；
- 非空字符串：已知当前描述，保留；
- `null`：未知，才允许使用可靠 baseline。

因此最终优先级是：

```text
explicit current fact
  > explicit transformation / special-system rule
  > explicit world rule
  > reliable Human baseline
  > unknown
```

AI 已经给出的当前 canonical value 是上游 Prompt/AnalysisInput 语义判断后的结果；Analyzer 不再用局部关键词重新决定它是否“足够像”一项 Human 规则。Final Consistency Guard 仍可对明确结构冲突写入已知 absence，但不得把 `null` 误当成 `false`；这类结构性修正不属于 baseline 覆盖。

### 5.3 Human-origin continuity 边界

本项目没有 `source_species`、`origin` 或 `transformation` 字段，也没有 Human-derived registry。Human-origin continuity 只能由 Prompt/AI 基于完整 AnalysisInput 语义判断，并以当前结果中的具体字段体现。

因此：

- Human-origin 的新 species 不会在 Analyzer 中自动继承 Human baseline；
- 当前 type 的具体字段如已被 AI 明确输出，Canonical 保留；
- 当前 type 的 `null` 不因“看起来像人类”或 type 名称熟悉而自动填 Human baseline；
- Human Male/Female biological_type 轴不会跨 species 复制；
- 没有 Human-origin evidence 的 Nonhuman 继续走 identity sanitizer 和 Nonhuman Evidence Gate。

这保留了 Nonhuman 安全边界，同时允许未来 Prompt 在可靠来源连续性成立时输出已经合成好的当前字段，而无需引入来源 schema。

### 5.4 两个缺陷的关系

`881-887` 的 fertilization `roleConflict` 兜底删除和 `sanitizeHumanType()` 的 baseline 覆盖都位于 normalize 之后，但职责不同：

- 前者是 Final Consistency Guard 把 capability `false` 与“无可识别 role”错误合并；
- 后者是 Human Evidence Guard 把当前非空值与“没有本地 regex evidence”错误合并。

同一任务可以分别修正，但不能用 baseline 修改来掩盖 fertilization guard，也不能为修复 fertilization 而放宽 Human/Nonhuman Evidence Gate。

## 6. 兼容性与回滚

- schema v1、storage shape、Trace shape、Prompt 和 UI 不变。
- 旧的 interaction-only fixture 不能继续把 raw 普通交互字符串交给 Analyzer 期待它完成语义判断；测试改为模拟 Prompt 按 Contract 输出 `null`，并独立保留直接 role conflict 回归。
- 若回归失败，回滚范围只涉及 `ai/analyzer.js` 的 roleConflict 条件和对应 World Model tests/docs；不触碰现有 dirty `style.css`、`ui/world.js` 或旧 Trellis task。
- 若 Baseline + Delta 回归失败，回滚范围只涉及 `sanitizeHumanType()` 的字段级 merge 和对应 tests/docs；不引入跨 species 继承或新增 schema。
