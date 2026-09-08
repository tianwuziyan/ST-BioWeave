# 收紧非人类世界模型证据门槛

## Goal

修正上一轮 World Model 修正后仍存在的两类回归：非人类 species 被无证据补出男性/女性，以及非人类 biological type 被套用现实人类 capabilities、reproduction_rules 和 lifecycle。保持已经通过真实测试的嵌套结构、类型排除和临时“双性化”行为不变。

## Confirmed Current Behavior and Evidence

- 总体契约已经是 `species[] -> biological_types[] -> capabilities`；顶层扁平 `biological_types` 和 species 级合并 capabilities 仍应拒绝（`ai/prompts.js:26-32`、`ai/analyzer.js:257-270`）。
- 上一轮分析 guard 已经能过滤 `性别模糊`、`妖修`、`半兽人`、`妖剑剑灵`、`魔剑灵`，并能区分固定“双性”和临时“双性化”（`ai/analyzer.js:212-255`）。这些行为不可回退。
- 当前 `isUnsupportedFamiliarType` 使用整个 AnalysisInput 的全局男性/女性证据（`ai/analyzer.js:222-227`），因此人类证据可能错误地放行妖、魔下的男性/女性。
- 当前 guard 只限制熟悉类型名称和双性 unknowns，没有按非人类 species 清理 AI 返回的 capability、reproduction_rule 或 lifecycle 模板值（`ai/analyzer.js:238-255`）。
- 当前 Prompt 已说明非人类不要套用人类规则，但真实 SillyTavern 输出仍将妖、魔的男性/女性 capability 复制为人类模板；仅靠旧提示语不足以完成本轮验收。

## Requirements

### R1. Preserve the existing World Model boundary

- Keep `species[] -> biological_types[] -> capabilities` unchanged.
- Keep the existing AnalysisInput construction, API request flow, Chat-local persistence, World Model refresh, UI lifecycle, schema nesting, open type names, canonical `双性`, and existing non-biological/temporary-type filters unchanged.
- Do not modify Character Card / Worldbook selectors, Recent Story, external memory, API Profile, Secret, Floor Version, Event, State, Projection, or Genealogy modules.

### R2. Add a species-local evidence gate for non-human biological types

- For every non-human species, create a biological type only when AnalysisInput directly states that the species has that type or a deterministic, low-inference semantic equivalent supports it.
- Evidence must be linked to the same species context. Global evidence that merely proves another species has 男性/女性 must not authorize the same type under 妖、魔、剑灵 or another non-human species.
- Direct semantic paraphrase is allowed. For example, `剑灵性别基本都为男性，极少女剑灵` directly supports `剑灵 -> 男性、女性`; `极少女剑灵` must not be lost merely because the word `女性` is absent.
- Plausibility, humanoid appearance, intercourse, reproductive anatomy, ordinary-world convention, or a model belief that a species “should” have male/female types is not evidence.
- If no biological type has species-linked evidence, retain `biological_types: []`.
- Keep open classifications such as Alpha/Beta/Omega supported when their own species-linked evidence is present; do not create combinations.

### R3. Gate non-human capabilities independently

- For each non-human biological type, every capability remains `true`, `false`, or `null` independently.
- A capability may be preserved only when AnalysisInput directly states it or supports a unique, low-inference semantic equivalent for that species/type. Explicit negative evidence may support `false`.
- A type name such as 男性 or 女性, human-like anatomy, intercourse, pregnancy, or the existence of a uterus alone cannot fill the complete human capability template.
- With no field-level evidence, normalize that capability to `null`; do not copy a human male/female baseline into a non-human type.
- Human baseline behavior remains unchanged for established 人类 types.

### R4. Gate non-human reproduction rules and lifecycle

- For non-human types, `reproduction_rules` and `lifecycle` fields are retained only when the corresponding fact has direct or deterministic species/type evidence.
- Examples allowed: explicit 妖族发情期 supports a cycle statement; explicit 妖族寿命 or aging statement supports the corresponding lifecycle field.
- Do not infer human-style fertilization, uterus pregnancy, ovulation, menstrual cycle, gestation, labor, maturation, lifespan, or slow aging from type names or general fantasy convention.
- Do not infer effects or purposes not stated by the input, such as turning a knotting rule into an increased-fertilization rule.
- Unsupported non-human fields normalize to `null`; later AnalysisInput may fill them incrementally.
- Explicit partial human-equivalence may continue to support only the named fields, never the whole template.

### R5. Make the evidence gate explicit in the World Model Prompt

Rewrite the relevant Prompt text coherently, not as a contradictory append-only patch. Before writing any non-human biological type, capability, reproduction rule, or lifecycle fact, require:

1. AnalysisInput directly states it; or
2. AnalysisInput permits a unique, direct, low-inference semantic deduction.

Otherwise the result must be no type, `null`, or an existing unknown tied to an established type/rule. Explicitly reject “常见”“通常如此”“现实生物可能如此”“模型认为合理” and type-name-based guessing as evidence.

### R6. Keep human baseline precedence unchanged

- For established 人类 types, retain the current human biological baseline for ordinary capabilities and rules.
- Precedence remains story fact > world/worldbook rule > individual exception > human baseline.
- A world-specific human rule overrides the baseline; an individual exception does not rewrite the species baseline.

### R7. Regression coverage and documentation

- Add tests for the exact remaining regressions and preserve tests for the already-correct filters.
- Cover species-local evidence, including `剑灵性别基本都为男性，极少女剑灵` -> 男性、女性;妖/魔 with only species or human-context evidence -> empty types; and non-human human-looking types with unsupported capabilities/rules -> null.
- Cover direct non-human semantic evidence for at least one type/capability/rule and confirm it is retained without opening unrelated fields.
- Update World Model documentation/spec wording so the evidence gate and human/non-human boundary are consistent.

## Acceptance Criteria

- [x] An AI result cannot retain 妖/魔/剑灵/other non-human 男性 or 女性 solely because AnalysisInput contains human male/female evidence elsewhere.
- [x] `剑灵性别基本都为男性，极少女剑灵` yields `剑灵 -> 男性、女性`; the female type is not dropped because the evidence is semantic rather than the exact word `女性`.
- [x] A non-human species supported only by its species name, humanoid description, anatomy, intercourse, or pregnancy has `biological_types: []` unless a type is directly or deterministically evidenced.
- [x] Non-human types without field-level evidence have all unsupported capabilities, reproduction rules, and lifecycle fields as `null`, rather than human male/female template values.
- [x] Direct non-human evidence such as a species-specific sperm/ovum/pregnancy/cycle/lifespan statement can preserve only the corresponding supported field; unrelated fields remain `null`.
- [x] Explicit partial human-equivalence for a non-human species preserves only the named baseline fields.
- [x] Established 人类 types still receive the existing human baseline and explicit human world rules override it.
- [x] Existing correct behavior remains covered: no `性别模糊`, `妖修`, `半兽人`, `妖剑剑灵`, `魔剑灵`, or temporary `双性化` type; fixed `双性` behavior and open ABO names remain intact.
- [x] The nested schema contract is unchanged and no unrelated module is modified.
- [x] Focused World Model tests, `npm test`, `npm run check`, syntax checks, and `git diff --check` pass.

## Scope and Deferred Items

- This round does not create a general ontology, multidimensional sex matrix, character/event/state model, evidence database, or new schema fields.
- The evidence gate is intentionally narrow and deterministic: it protects the AI-analysis boundary without attempting to solve every possible natural-language interpretation.
- Real SillyTavern re-analysis with the user's existing AnalysisInput remains the final external verification step after implementation.

## Open Questions

None. The user has specified the desired evidence threshold, human baseline exception, non-human null behavior, unchanged scope, and final real-test handoff.
