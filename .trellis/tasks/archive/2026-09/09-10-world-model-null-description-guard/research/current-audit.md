# World Model 三态描述规则审计

## 审计范围

本阶段只检查当前 Analyzer、已有回归和上一轮 Raw/Canonical trace，不修改产品代码。使用全新的抽象 fixture：`缟核体`、`转维型`。

## 1. 已确认的 pipeline 职责

```text
AI Raw
  → parseWorldModelResponse()
  → normalizeWorldModel()
  → applyWorldModelEvidenceGuard()
  → applyWorldModelFinalConsistencyGuard()
  → canonical result / trace
```

- `normalizeRuleText()`：`ai/analyzer.js:97-105`；未知标记 → JS `null`，明确 absence → `"无"`，其它非空字符串原样保留。
- `normalizeBiologicalType()`：`ai/analyzer.js:147-159`；只做 schema 字段和类型归一化。
- `sanitizeNonHumanType()`：`ai/analyzer.js:550-552`；当前不清理 type 内容。
- `hasTypeSubtreeEvidence()` / `applyWorldModelEvidenceGuard()`：`ai/analyzer.js:748-807`；判断 species/type 是否有 AnalysisInput 证据。Nonhuman retained type 不被它重写，但 Human Male/Female 会在同一阶段进入 `sanitizeHumanType()` 并可能被 baseline 覆盖。
- `applyWorldModelFinalConsistencyGuard()`：`ai/analyzer.js:854-894`；执行已知 false capability 对应的 absence 和 fertilization role consistency；Human Male/Female baseline 在更早的 `sanitizeHumanType()` 阶段应用。

## 2. 第二层删除路径复现

使用同一个 raw type，只改变两个相关 capability：

| `can_be_fertilized` | `can_fertilize` | normalized fertilization | canonical fertilization |
| --- | --- | --- | --- |
| `null` | `null` | 非空 | 非空 |
| `null` | `false` | 非空 | `null` |
| `false` | `null` | 非空 | `null` |
| `false` | `false` | 非空 | `null` |

准确条件位于 `ai/analyzer.js:881-887`：

```js
const roleConflict = (capabilities.can_be_fertilized === false && roles.recipient)
  || (capabilities.can_fertilize === false && roles.donor)
  || (!roles.recipient && !roles.donor
    && (capabilities.can_be_fertilized === false || capabilities.can_fertilize === false));
```

当 rule 是合法但没有当前 Analyzer role regex 能识别的 recipient/donor 形式时，最后一个分支把任一 `false` 当成足以否定整个 fertilization 描述的依据。`null` 本身未触发，但与另一侧 `false` 的混合状态会暴露同一错误边界。

## 3. 上一轮测试为何遗漏

`f4af442` 的“unfamiliar fertilization prose”使用 `structuredFixtureType()` 默认两个相关 capability 均为 `null`，只覆盖 `null/null`；现有“interaction-only”测试使用 `false/false`，而其预期 null 依赖旧的无角色兜底分支。现有直接 role conflict 测试覆盖的是 recipient/donor 明确表达，不能发现无 role 证据时的错误清理。

因此 117/117 通过并不能覆盖最新黑盒的 mixed three-state 输入。

## 4. 同源字段审计

- `fertilization`：存在上述过宽的 roleConflict 兜底，需要收窄。
- `pregnancy_or_carrying`、`gestation`、`labor`：仅在 `can_carry_pregnancy === false` 时被设为 `"无"`；`null` 不进入该分支。
- `ovulation`：仅在 `can_produce_ova === false` 时被设为 `"无"`；`null` 不进入该分支。
- `cycle`、`lifecycle.maturation`、`lifecycle.aging`：没有 capability-null 清除分支；Human baseline 的 cycle 修正属于明确男性 baseline canonicalization。
- `mergeKnownValue()` / normalize 本身对已知非空值优先于 `null`，没有发现将普通非空描述降为 `null` 的通用 merge 路径；但 Human 专用 `sanitizeHumanType()` 另有 evidence-gated fallback，会把已知当前值替换为 baseline。

结论：Final Consistency Guard 的同源缺陷是 fertilization 的无 role + 任一 false 兜底；另外 Human baseline merge 存在独立的已知值覆盖缺陷。其它字段不需要改公共 normalization，但需分别回归 final guard 和 Human baseline merge。

## 5. Planning 结论

最小修正不是只有 fertilization guard 一处，而是两个相互独立的 Analyzer 点：

1. 删除最后一个无 role 兜底条件，只保留 capability `=== false` 与直接 recipient/donor role 的结构冲突；
2. 将 Human baseline 的 capabilities/reproduction rules 改为逐字段只对当前 `null` 补值，保留当前 `false`、`"无"` 和普通非空描述。

不要修改 biological_type Evidence Gate、Prompt、UI、Trace 或 schema。

## 6. Human Baseline / Human-origin transformation 合并链审计

### 6.1 当前真实顺序

```text
AI response
  → callOpenAICompatible()
  → parseWorldModelResponse()
  → normalizeWorldModel()
  → applyWorldModelEvidenceGuard()
       → Human species: sanitizeHumanType()
       → Nonhuman species: sanitizeNonHumanType() = identity
  → applyWorldModelFinalConsistencyGuard()
  → emitWorldModelTrace(raw, normalized, canonical)
  → analyzer return
  → ui/app.js 再 normalize 后保存 Chat canonical World Model
  → ui/world.js 读取 canonical model
```

没有独立的“Human-origin transformation”存储层。当前模型没有 source/origin/transformation 字段，Analyzer 也没有根据 species 来源建立跨 species baseline 继承器。

### 6.2 对 planning 问题的逐项回答

1. **Human baseline 在哪里应用？**
   在 `applyWorldModelEvidenceGuard()` 内的 `sanitizeHumanType()`，位于 `normalizeWorldModel()` 之后、`applyWorldModelFinalConsistencyGuard()` 之前。当前只对被识别为 Human species 且 type 名为普通男性/女性的类型使用内置 baseline。

2. **是否已经真正实现 Human-origin Baseline + Explicit Delta？**
   只实现了 Human species Male/Female 的 baseline fallback，没有实现独立的 Human-origin transformed Nonhuman 自动继承。Prompt 已定义语义优先级，但 Analyzer 没有 origin schema；转化后的当前字段必须由 AI 直接合成到 Raw result 中。

3. **当前是哪种 merge？**
   不是 baseline-first + delta override，也不是 result-first + fill-null。当前是“本地 regex evidence gate 通过才收当前值，否则 baseline fallback”。这是导致覆盖问题的根因。

4. **false 会被 baseline 覆盖吗？**
   会。实测抽象 Human Male fixture 中，Raw capability `can_produce_sperm: false` 在没有被当前 field evidence regex 接受时，canonical 变回 baseline `true`。这违反了 `false` 是已知值的 Contract。

5. **`"无"` 会被 baseline 覆盖吗？**
   会。抽象 Human Female fixture 中，Raw `cycle/ovulation/gestation/labor: "无"` 在没有对应本地 rule evidence 时，canonical 回退到 Female 的非空 baseline 描述。

6. **非空 AI description 会被 baseline 覆盖吗？**
   会。同一 Female fixture 的自定义非空周期/排卵/孕育/生产描述在没有本地 regex evidence 时被整体替换为 Female baseline。Male 的自定义 cycle 描述也被替换为 `"无"`。

7. **null 能正确继承可靠 baseline 吗？**
   能，这是当前 Human baseline fallback 已经覆盖且已有回归的路径；但它与“非 null 当前值必须保留”没有被同一个字段级 Contract 约束。

8. **Human-origin Nonhuman 会错误继承 Human biological_type 轴吗？**
   当前 Analyzer 不会。`sanitizeNonHumanType()` 是 identity，且没有复制 Human species/type 的路径。需要保留这一边界；未来若 AI 依据可靠 Human-origin continuity 输出当前具体字段，也不能新增跨 species type-axis 继承。

9. **无 Human-origin evidence 的 Nonhuman 会错误获得 Human baseline 吗？**
   当前不会。Nonhuman 不进入 `sanitizeHumanType()`；应继续保持此行为，不因修复 Human merge 而放宽。

10. **`ai/analyzer.js:881-887` 与 baseline merge 是否独立？**
    是两个独立根因。`881-887` 是 Final Consistency Guard 对无 role evidence + 任一 capability false 的过宽 fertilization 删除；Human baseline merge 是更早的 Evidence Guard 对 Human 当前字段的覆盖。Baseline 的结果可能影响 Human type 后续 guard，但不能解释 Nonhuman mixed `null/false` fertilization 的误删。

11. **是否需要扩大本轮 implementation 文件范围？**
    需要在原计划的 `ai/analyzer.js`、`tests/world-model.test.js`、`docs/DATA-MODEL.md` 范围内增加 `sanitizeHumanType()` 的最小字段级 merge 修正。无需扩大到 `ai/prompts.js`、UI、Trace、schema、Event、State、Projection 或 Runtime。

12. **需要新增哪些 Baseline + Delta 回归？**
    - Human Male：当前 capability `false` 对 baseline `true`，必须保留 `false`；当前 `null` 才补 `true`。
    - Human Female：当前 rule 为 `"无"`，baseline 为非空描述，必须保留 `"无"`；当前非空自定义描述也必须保留；当前 `null` 才补 baseline。
    - Human-origin transformed species：当前已明确的具体 physiology fields 可以保留，未明确字段继续 `null`；不自动复制 Male/Female biological_type 轴。
    - explicit transformation/world rule 与 baseline 冲突时，explicit rule 胜出。
    - 无 Human-origin evidence 的原创 Nonhuman 继续保持 `null`，并保留现有 Nonhuman Evidence Gate。

### 6.3 实施边界结论

本补充审计不修改产品代码。实施获批后，Analyzer 只做两项通用结构修正：收窄 fertilization role conflict，以及把 Human baseline 合并改为 `null`-only field fill。不会建立转化关键词系统、Human-derived registry、species alias table 或新的 schema 字段。

## 7. 实施后的实际变更记录

本次实现已按上述边界完成：

- `sanitizeHumanType()` 不再用 `AnalysisInput` 局部 regex 决定是否覆盖当前 capability/reproduction rule；当前字段只有在值为 `null` 时才使用 Male/Female baseline。后续 Final Consistency Guard 仍可处理明确的结构冲突。
- 移除了 Final Consistency Guard 中会覆盖非空 Human fertilization/cycle 当前值的 Human 专用 baseline 重写；这些值现在遵循当前结果优先。
- `roleConflict` 只保留 capability `=== false` 与直接 recipient/donor role 的冲突；无 role evidence 不再清除 fertilization。
- `can_produce_ova === false` 与 `can_carry_pregnancy === false` 的直接 absence guard 未改变；Nonhuman sanitizer、Evidence Gate、schema、Prompt 和 UI 未修改。
