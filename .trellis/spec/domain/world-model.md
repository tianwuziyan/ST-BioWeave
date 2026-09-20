# World Model Evidence Contract

## 1. Scope / Trigger

This contract applies when World Model AI output is converted into the
canonical `species[] -> biological_types[]` structure. It protects generic
type recall without turning the Analyzer into a world-knowledge parser.

When World Model values participate in Floor-bound analysis, storage,
previous-state, derived-state, and API provenance follow [Floor State
Ownership](./floor-state.md); this document owns only World Model evidence and
canonicalization.

## 1.1 Business ownership boundary

World Model and Character/Event Analysis are independent business domains.
They share only Floor infrastructure: the complete Floor Version, the existing
`store.getFloor()` / `store.saveFloor()` boundary, the ordinary/per-Swipe owner
slots, lifecycle invalidation, and business-neutral previous-Floor traversal.
The fact that one Floor container contains multiple fields does not merge their
owners.

World Model owns:

- world-rule analysis, `species`, `biological_types`, capability baselines,
  reproduction rules, lifecycle/special rules, and medical/world context;
- World Model prompt construction, parser, normalizer, evidence guard;
- World Model Floor persistence and World-specific resolution.

Character/Event owns character identity, Character Registry, character
profile/context, participant resolution, `BiologicalEvent`, Tracking
Subject/Candidate, and the corresponding prompt/parser/normalizer/validation.
Event Analysis may consume an already resolved World Model DTO as an input, but
Character/Event code does not own, modify, or redefine World Model.

Allowed dependency direction:

```text
             Floor infrastructure
                    |
        +-----------+-----------+
        |                       |
   World Model             Character / Event
```

World Model persistence updates only `world_model` and `world_model_meta` and
preserves `analysis`, `events`, and `character_registry`. Character/Event
persistence updates only its own analysis/events/registry fields and preserves
World Model fields. Only an explicit complete Floor lifecycle invalidation may
clear multiple business-owned fields together. Do not introduce a combined
World + Character save/update helper.

World resolvers such as `resolveWorldModelAtOrBefore()` and
`resolveWorldModelStrictlyBefore()` belong to the World/Floor boundary.
Character Registry previous-snapshot resolution remains independent. Shared
mechanical scanning may use a business-neutral primitive such as
`findPreviousValidFloor()`, but no universal resolver may understand all World,
Event, analysis, and registry semantics.

## 2. Signatures

- `buildWorldModelMessages(analysisInput, promptSettings) -> ChatMessage[]`
- `parseWorldModelResponse(raw) -> WorldModelV1`
- `createAnalyzer(deps).analyzeWorldModel(input) -> WorldModelV1`
- `applyWorldModelEvidenceGuard(model, analysisInput) -> WorldModelV1`

## 3. Contracts

### Prompt reference source boundary

- `formatCharacterReference()` only formats the selected Character Card
  background.
- `character.greetings` remains collected in `AnalysisInput`, but its only
  Prompt consumer is `formatCharacterGreetingReference()` in World Model
  references.
- When greetings exist, the World Model references SYSTEM message orders its
  sections as Character background, Worldbook, external memory, then
  `【开场白】` as the final section. Empty greetings produce no section or
  message.
- The greeting formatter is not used by Event Analysis.

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
