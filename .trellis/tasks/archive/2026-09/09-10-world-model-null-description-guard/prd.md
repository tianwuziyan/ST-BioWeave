# 修复 World Model 三态描述规则误删

## Goal

修复 World Model 在 `capability` 处于未知状态或只部分未知时，把已经通过基础规范化和 biological type Evidence Gate 的非空 reproduction/lifecycle 描述错误清为 `null` 的问题，并修正 Human baseline 对当前 AI 结果的错误覆盖。

目标是恢复统一三态语义：

- capability `true`：明确具备；
- capability `false`：明确不具备；
- capability `null`：未知，不能按 `false` 处理；
- rule `null`：未知；
- rule `"无"`：明确不存在/不适用；
- rule 非空字符串：已知描述，不能被未知 capability 否定。

本轮只修正 Analyzer 的确定性 consistency guard 与 Human baseline 字段合并，不修改 schema、Prompt、UI renderer 或 biological type Contract。

## Confirmed audit findings

### Raw → Canonical 的实际删除点

- `normalizeRuleText()`（`ai/analyzer.js:97-105`）负责把真正的未知标记转成 `null`、明确 absence 归一化为 `"无"`；合法普通非空字符串不会在这里被清除。
- `normalizeBiologicalType()`（`ai/analyzer.js:147-159`）只做字段类型和正式 key 规范化。
- `sanitizeNonHumanType()`（`ai/analyzer.js:550-552`）当前直接保留 canonical type。
- `applyWorldModelEvidenceGuard()`（`ai/analyzer.js:748-807`）负责 species/type 的 AnalysisInput 证据过滤；Nonhuman retained type 不被它改写，但 Human Male/Female 会继续进入 `sanitizeHumanType()`，后者当前会改写 capabilities/reproduction rules 并因此暴露 baseline 覆盖问题。
- 上一轮固定 fertilization 关键词准入已删除；当前残留删除点在 `applyWorldModelFinalConsistencyGuard()`（`ai/analyzer.js:854-894`）。其中 `ai/analyzer.js:881-887` 的最后一个 `roleConflict` 分支在没有识别出 recipient/donor 角色时，只要任一 capability 是 `false` 就把非空 `fertilization` 清为 `null`。

### 全新抽象 fixture 的复现

使用 `缟核体 → 转维型`，Raw 的 `fertilization` 分别使用不依赖旧关键词的非空描述：

| capability 状态 | normalized | canonical |
| --- | --- | --- |
| `can_be_fertilized=null`, `can_fertilize=null` | 非空描述 | 保留 |
| `can_be_fertilized=null`, `can_fertilize=false` | 非空描述 | 被清为 `null` |
| `can_be_fertilized=false`, `can_fertilize=null` | 非空描述 | 被清为 `null` |
| 两者均 `false` | 非空描述 | 被清为 `null` |

因此本轮不是 trace、storage 或 UI 丢值，也不是 `null` normalization；是 final guard 把“未明确角色 + 任一 false”错误扩大成了语义否定。

### Human Baseline / Human-origin Baseline + Delta 审计

当前真实调用链为：

```text
AI Raw
  → parseWorldModelResponse()
  → normalizeWorldModel()
  → applyWorldModelEvidenceGuard()
       → Human species: sanitizeHumanType()
       → Nonhuman species: sanitizeNonHumanType()（当前为保留原值）
  → applyWorldModelFinalConsistencyGuard()
  → canonical result / trace
```

`sanitizeHumanType()` 位于 Evidence Guard 内、Final Consistency Guard 之前。它当前不是安全的“AI 结果优先、仅对 null 补 baseline”，而是先用 `AnalysisInput` 的本地 evidence regex 重新计算 capability/rule 是否有字段证据：

- capability 没有匹配到本地证据时，直接取 Male/Female baseline；因此 Raw `false` 可能被改回 baseline `true`；
- reproduction rule 没有匹配到本地证据时，直接取 baseline；因此 Raw `"无"` 或合法非空描述可能被 baseline 非空/`"无"` 覆盖；
- 只有 capability/rule 同时通过当前 regex evidence gate 时，Raw 当前值才会被采用。

这与既定优先级不一致。目标应改为逐字段保留已知当前值，只对真正的 `null` 补入可靠 Human baseline：

```text
current !== null ? current : reliableBaseline
```

其中 `false`、`"无"`、普通非空字符串都属于已知值，不能被 baseline 覆盖。Human-origin continuity 仍只允许在 AnalysisInput/AI 已经可靠支持时作为语义来源；Analyzer 不新增 source/origin 字段，也不对转化后的 Nonhuman 自动填 Human baseline。

Human-origin continuity 可以支持当前 type 的具体生理字段逐项延续，但不能复制 Human 的 biological_type 分类轴。新的 species 仍由当前 AnalysisInput/AI 决定其 `biological_types[]`。

本审计还确认：`ai/analyzer.js:881-887` 的 fertilization 删除条件与上述 baseline merge 是两个独立问题。Human baseline 可能影响 Human type 在 Final Consistency Guard 前的 capability/rule 值，但 Nonhuman 的 mixed capability fertilization 误删并不是由 baseline merge 产生的。

### 上一轮回归的覆盖缺口

`f4af442` 新增的陌生 fertilization 测试使用 `structuredFixtureType()` 默认的两个相关 capability 均为 `null`，覆盖了 `null/null`，但没有覆盖 `null/false` 或 `false/null` 的混合三态组合。上一轮的冲突测试使用了明确角色文本并设为 `false/false`，只能证明冲突清理存在，未暴露“无直接角色证据时仍因 false 清理”的过宽分支。

## Requirements

### R1. capability 三态不可合并

- 只允许显式 `=== true`、`=== false`、`=== null` 判断三态 capability。
- 禁止使用 `if (!capability)` 或等价逻辑把 `null` 与 `false` 合并。
- capability 为 `null` 时，不得删除或改写任何已经规范化的非空 reproduction/lifecycle 描述。

### R2. fertilization 只保留确定性 role conflict guard

- 移除“没有识别 recipient/donor 角色时，只要 capability 为 false 就清空 fertilization”的兜底分支。
- 保留明确的结构性冲突：`can_be_fertilized === false` 且描述直接表达当前 type 是受精接受方，或 `can_fertilize === false` 且描述直接表达当前 type 是施受精方。
- 不增加关键词、词典、species/type alias 或新的自然语言语义解析。
- capability 为 `null` 时即使 fertilization 有非空描述，也必须保留。

### R3. 其它 description fields 保持三态并审计同源行为

覆盖 `pregnancy_or_carrying`、`cycle`、`ovulation`、`gestation`、`labor`、`lifecycle.maturation` 和 `lifecycle.aging`：

- capability 为 `null` 或辅助字段缺失时，非空描述不能被清除。
- 已知 `capability === false` 导致的结构性明确 absence（例如不能产生卵子对应 `ovulation: "无"`，不能承担妊娠对应 carrying/gestation/labor 为 `"无"`）继续保留。
- Human baseline 的字段补全和 world delta 覆盖继续保留。
- `normalizeRuleText()` 的 `null` / `"无"` / 非空字符串规范化继续保留。

### R4. 保持现有边界

- `applyWorldModelEvidenceGuard() → hasTypeSubtreeEvidence()` 不修改。
- 不修改 `ai/prompts.js`、`storage/schema.js`、`ui/world.js`、Trace UI、Event、State、Projection 或 Runtime。
- Nonhuman Evidence Gate、Human baseline、special_rules、schema v1 和 UI 基础映射不回退。
- 交互文本是否具有受精语义仍由 Prompt/AI 负责；Analyzer 不以新增语义黑名单恢复旧行为。

### R5. Human Baseline + Explicit Delta 逐字段优先级

- 对已经合法识别的普通 Human 男性/女性，baseline 只能补当前字段为 JS `null` 的位置。
- 当前 AI/AnalysisInput 结果为 `false`、`"无"` 或非空描述时，必须保留当前结果；baseline 不得以 truthy/falsy merge、整体 spread 或 evidence regex fallback 覆盖它。独立的明确结构冲突仍可由 Final Consistency Guard 处理。
- 可靠的 explicit current fact、transformation/special-system rule 和 world rule 继续高于 Human baseline。
- Human baseline 不创建缺失的 biological_type，也不把 Human Male/Female 分类轴复制给 Human-origin 的新 species。
- 没有 Human-origin evidence 的 Nonhuman 继续使用 Nonhuman Evidence Gate，不能因为外形、名称或性别标签获得 Human baseline。

## Test acceptance criteria

- [ ] `null/null` capability + 非空 fertilization 保留。
- [ ] `null/false` 或 `false/null` capability + 无直接 recipient/donor 角色的非空 fertilization 保留。
- [ ] capability `false` + 直接相冲的 fertilization role 仍清为 `null`。
- [ ] capability `null` + 非空 `pregnancy_or_carrying`、`gestation`、`ovulation`、`maturation`、`aging` 均保留；其它同类字段没有同源误删。
- [ ] capability `false` 的已知 absence 规则仍 canonicalize 为 `"无"`。
- [ ] rule `null`、`"无"` 和普通非空字符串分别保持三态语义。
- [ ] Human Male/Female 的当前 `false`、`"无"`、非空描述不会被 baseline 覆盖，只有 `null` 才补 baseline。
- [ ] 可靠 Human-origin continuity 可以逐字段补 `null`，但不继承 Human biological_type 轴；无 continuity 的 Nonhuman 保持未知。
- [ ] explicit transformation/world rule 与 Human baseline 冲突时，explicit rule 胜出。
- [ ] biological type Evidence Gate、Human baseline、Nonhuman Evidence Gate、special_rules 和 Trace 回归保持通过。
- [ ] 旧 interaction-only 测试改为验证 AI 遵守 Prompt 时输出 `null`，不再要求 Analyzer 通过模糊语义清除字符串。
- [ ] 不新增具体世界观知识、物种/type registry、关键词表或 fixture-specific 逻辑。
- [ ] World Model tests、`npm test`、`npm run check`、指定 `node --check` 和 `git diff --check` 全部通过。

## Out of scope

- 修改 World Model v1 schema 或新增 capability/rule 字段。
- 修改 Prompt、普通 World UI renderer、Raw/Canonical Trace UI 或 storage pipeline。
- 放宽 species/type Evidence Gate，或为陌生名称增加 whitelist/blacklist。
- 用 Analyzer 重新理解 fertilization、pregnancy、maturation 等自然语言语义。
- 新增 Human-origin registry、transformation keyword dictionary、source/origin schema 或跨 species 的 Human 模板继承。

## Open questions

无。实现策略已经由代码审计和抽象 fixture 复现确定；下一步是等待本 planning summary 的实施批准。实现范围需要在原 fertilization guard 收窄之外，同步包含 `sanitizeHumanType()` 的逐字段 null-only baseline merge。
