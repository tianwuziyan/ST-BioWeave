# World Model Evidence Contract

## 1. Scope / Trigger

This contract applies when World Model AI output is converted into the
canonical `species[] -> biological_types[]` structure. It protects generic
type recall without turning the Analyzer into a world-knowledge parser.

## 2. Signatures

- `buildWorldModelMessages(analysisInput, promptSettings) -> ChatMessage[]`
- `parseWorldModelResponse(raw) -> WorldModelV1`
- `createAnalyzer(deps).analyzeWorldModel(input) -> WorldModelV1`
- `applyWorldModelEvidenceGuard(model, analysisInput) -> WorldModelV1`

## 3. Contracts

- `biological_type` is a stable physiological or reproductive classification
  inside one `species`; it is not a general taxonomy, identity, occupation,
  route, level, phase, temporary state, or individual label.
- A type has independent evidence. Direct naming and deterministic,
  low-inference existence language based on quantity, frequency, contrast,
  coexistence, or exception relations are valid evidence for the type's
  existence. Rarity does not invalidate an otherwise stable type.
- The Prompt performs the per-species completeness scan: after collecting
  candidates, it rescans the full `AnalysisInput` for explicitly indicated
  stable types and re-applies the type contract. It must not fill a sibling
  merely because another type exists.
- Type existence does not authorize capability, reproduction-rule, lifecycle,
  or special-rule values. Those fields remain independently evidenced and may
  remain `null`.
- The Analyzer may bind an AI name to source text using generic lexical forms
  already present in the input. Generic suffix normalization is structural
  only; it must not become a species/type dictionary or semantic classifier.
- A type with no reliable source binding remains removable by the Evidence
  Gate. Canonicalization must not trade away the no-hallucination boundary.

## 4. Validation & Error Matrix

| Condition | Required behavior |
|-----------|-------------------|
| Directly named stable type | Keep the type and analyze its fields independently |
| Stable type identified by majority/minority, frequency, contrast, or exception wording | Keep every independently identified type, including rare types |
| Only one type is evidenced | Do not create an unmentioned sibling type |
| Candidate is an occupation, identity, route, level, phase, temporary state, or individual trait | Remove the candidate |
| Canonical type name uses a generic lexical suffix while preserving a source stem | Allow generic source binding |
| Canonical type has no source name, description, rule, lifecycle, or field anchor | Remove it |
| Type is retained but a field lacks evidence | Keep the type; leave that field `null` |

## 5. Good / Base / Bad Cases

- Good: one species has a common stable type and a rare stable type explicitly
  indicated by the same source relation; both are returned.
- Good: a normalized type name preserves a source stem, while its capabilities
  remain `null` because the input does not describe them.
- Base: a species has no stable type evidence and returns
  `biological_types: []`.
- Bad: the model adds a sibling because the first type suggests a familiar
  pair or because the type list feels incomplete.
- Bad: Analyzer accepts an unfamiliar type solely because the AI returned it,
  without any source binding.

## 6. Tests Required

- Prompt assertions for low-inference existence evidence and the per-species
  completeness scan.
- Canonical pipeline assertions for common-plus-rare type retention, no
  sibling invention, generic normalized-name binding, and unbound-name
  rejection.
- Assertions that retained types keep unknown capabilities and rules as
  `null`.
- Production-source scan asserting no species registry, world-specific alias,
  or fixture-specific biological rule is added.

## 7. Wrong vs Correct

### Wrong

```js
if (types.length === 1) types.push(inferredSibling);
```

### Correct

```js
// Prompt: rescan AnalysisInput, then require independent evidence for each type.
// Analyzer: only bind generic source text; do not infer world semantics.
```
