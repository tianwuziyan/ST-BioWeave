# World Model and World Analysis Contract

## 1. Scope / Trigger

This is the canonical domain owner for World Model and World Analysis. It
defines how permitted evidence becomes a complete canonical model in Full
Analysis, or a baseline-aware sparse differential Patch in Supplement
Analysis. It also defines the evidence, canonicalization, merge, and
ownership boundaries; it does not turn the Analyzer into a world-knowledge
parser.

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

## 1.2 Full and Supplement Analysis contract

Automatic Character/Event analysis is downstream of a current, validated and
normalized World Model. When the current valid Floor has no World Model,
Runtime must complete Initial World Analysis first; an API, parse, schema,
normalization, stale-owner, or save failure is fail-closed and must not send a
Character/Event request or persist new Character/Event facts.

Full Analysis means “开始分析 / 重新分析”: rebuild from the current permitted
World Analysis evidence. It is not a refresh of the old answer and does not
consume an Existing World Model baseline, even when the caller's
`AnalysisInput` happens to contain `world_model`.

```text
current permitted World Analysis evidence
  -> complete canonical World Model
```

When a valid prior World Model exists, Runtime reuses it by default. World
Patch / Supplement Analysis is baseline-aware differential analysis:

```text
Existing canonical World Model + current permitted World Analysis evidence
  -> baseline-aware semantic differential analysis
  -> evidence-supported sparse add/update Patch
  -> deterministic merge
  -> complete canonical World Model validation
```

Supplement must receive the validated canonical Existing World Model as a
comparison baseline and must re-review the complete permitted evidence set.
The same mechanism covers newly available evidence, previously available but
missed evidence, completion of an existing entry, and an explicit
evidence-supported correction. Eligibility is whether the Existing Model
already expresses the evidence-supported fact sufficiently; the fact need not
originate on the current Floor. Supplement is not a current-Floor-only mode and
does not return a complete replacement model.

Full and Supplement share the same permitted evidence boundary. The mode
changes the interpretation of that evidence, not the set of legal evidence
sources. Floor/Swipe provenance, lifecycle, active-version and persistence
authority remain Floor-owned, but Floor provenance is not a Supplement fact
eligibility rule.

The pipeline is therefore:

```text
Full:       evidence -> complete candidate -> full guards -> canonical model
Supplement: Existing canonical model + evidence
            -> semantic delta -> sparse Patch -> deterministic merge
            -> complete canonical validation -> persist
```

Omitted Patch fields are unchanged. `remove` and `invalidate` are unsupported.
The complete merged result must pass canonical validation before persistence;
otherwise the update and downstream Character/Event analysis fail closed and
the prior model remains intact.

## 1.3 Existing baseline and evidence isolation

The Existing World Model has exactly one role in Supplement: comparison
baseline. It is not a source of evidence and must not be collected by
`evidenceUnits()` or any equivalent permitted-evidence collector. In
particular, a fact that exists only in `analysisInput.world_model` cannot prove
a newly proposed Patch fact. The invariant is:

```text
Existing canonical model = comparison baseline
Existing canonical model != evidence proving its own new Patch
```

Full final messages must not contain the Existing World Model baseline. Patch
final messages must contain the validated baseline in a clearly labelled
reference boundary, separate in meaning from ordinary evidence references.

## 1.4 Semantic Delta Patch contract

Patch evidence validation is defined over semantic changes relative to the
canonical Existing target entry, not over an arbitrary string hit anywhere in a
whole entry. The program must:

1. resolve the Existing update target using the canonical identity used by the
   deterministic merge;
2. canonicalize Existing and Candidate using the same World Model boundary;
3. compute the semantic delta at field/path level; and
4. validate only the changed facts against current permitted evidence.

The semantic delta has four states:

| Delta | Meaning | Evidence rule |
| --- | --- | --- |
| `UNCHANGED` | Candidate preserves an Existing canonical fact | No current-evidence re-proof is required |
| `ADD` | Candidate introduces a fact absent from Existing | Current permitted evidence is required |
| `CHANGE` | Candidate replaces an Existing value with another value | Explicit evidence of correction, replacement, or conflict resolution is required |
| `REMOVE` | An Existing fact disappears from a complete update | Unsupported; reject |

An `add` entry has no Existing target, so every fact-bearing semantic field in
the new entity is delta and must be independently supported. A species name
being evidenced cannot authorize its entire subtree. An `update` may contain a
complete canonical entry, but unchanged Existing fields do not need to appear
again in current evidence. A supported new rule or field cannot allow an
unsupported capability, rule, lifecycle value, special rule, reproductive
mechanism, or other nested fact to hitchhike into the model.

This field/path treatment applies to species and nested
`biological_types`, `capabilities`, `reproduction_rules`, `lifecycle`,
`special_rules`, and `reproductive_mechanisms`, as well as
`projection_rules`, `exceptions`, `unknowns`, and `medical_context`. The exact
canonical diff representation and field-specific support predicates remain an
implementation design responsibility, but an entry-level “any evidence hit
accepts the whole subtree” guard is not conformant.

Semantic diff must occur after canonical normalization. Raw JSON deep diff is
not sufficient because defaults, ordering, canonical names, and generated
fields are mechanical changes rather than new world facts. If a complete
update omits an Existing fact, that omission is a `REMOVE` attempt, not an
unchanged field, and must be rejected.

`CHANGE` is stricter than `ADD`: evidence that merely presents the new value
does not automatically prove that the old value was wrong. AI proposes a
candidate only. Program/Runtime owns structural validation, semantic delta,
evidence and consistency validation, deterministic merge, complete canonical
validation, and persistence authority.

## 1.5 Routing and scheduler ownership

Manual routing is fixed:

| Action | Analysis |
| --- | --- |
| 开始分析 / 重新分析 | Full |
| 补充分析 | Supplement |

Automatic routing is fixed:

| World state and update signal | Result |
| --- | --- |
| No valid World Model | Full |
| Valid World Model + world-relevant update | Supplement |
| Valid World Model + no relevant update | Reuse |

The scheduler decides when to invoke a capability and when to reuse a valid
model; it does not define Full/Supplement semantics or Patch fact eligibility.

## 1.6 Current implementation status

The current uncommitted implementation is **BLOCKER / NOT YET CONFORMANT** to
this contract. The Prompt baseline boundary is substantially correct: Patch
receives Existing baseline, Full does not consume it, and Existing baseline is
not collected by `evidenceUnits()`. However,
`applyWorldModelPatchEvidenceGuard()` still performs entry-level evidence-hit
validation rather than semantic-delta validation. Existing baseline is not
actually compared at semantic-delta level; nested fields are not protected at
delta level; Cases A/B/C/D below are not covered by current tests; and
`projection_rules.update` has the identity gap documented in section 2.1.
This status records the implementation state, not a weakening of the target
contract above.

## 2. Signatures

- `buildWorldModelMessages(analysisInput, promptSettings) -> ChatMessage[]`
- `buildWorldModelPatchMessages(analysisInput, promptSettings) -> ChatMessage[]`
- `parseWorldModelResponse(raw) -> WorldModelV1`
- `createAnalyzer(deps).analyzeWorldModel(input) -> WorldModelV1`
- `createAnalyzer(deps).analyzeWorldModelPatch(input) -> WorldModelPatchV1`
- `applyWorldModelEvidenceGuard(model, analysisInput) -> WorldModelV1`
- `applyWorldModelPatchEvidenceGuard(patch, analysisInput) -> WorldModelPatchV1`

## 2.1 Reproductive mechanism and Projection Rule output contract

`carrying_compatibility` is a strict tri-state canonical field:

- `true`: the current `biological_type` is explicitly compatible with the
  pregnancy/carrying side of the mechanism;
- `false`: the current `biological_type` is explicitly incompatible;
- `null`: the evidence is insufficient.

It is never a natural-language description. Anatomy, species/type names, and
mechanism descriptions belong in `pathway`,
`reproduction_rules.pregnancy_or_carrying`, or `special_rules`.

`reproductive_mechanisms` is an array when present; no mechanism is `[]`, and
`null` is invalid. Its canonical item fields are `key: string|null`,
`label: string|null`, `pathway: string|null`,
`carrying_compatibility: boolean|null`, `world_model_rule_refs: string[]`,
and `evidence: string[]`. Omitted item fields receive the existing canonical
defaults; non-string list elements remain invalid.

World Model owns reproductive biological timing semantics for a species/type/
mechanism, but the current v1 schema does not freeze dedicated fields for
Pregnancy Exposure Tracking Window grouping, detection/resolution, or maximum
tracking horizons. Gestation duration and lifecycle text are not those
horizons. The proposed Window contract is documented separately in
[Pregnancy Exposure Tracking Lifecycle](./pregnancy-tracking.md); this World
Model contract does not add or imply a final horizon schema.

Initial World Analysis and World Patch Analysis use the same mechanism
contract. Projection Rule prompts mirror `normalizeProjectionRules()` and
`validateProjectionRuleContent()`: raw rules require schema version 1,
mechanism/development keys, the production development-kind and trigger
enums, the validated requirements/realization/contradiction/expiration
shapes, and no forbidden executable/probability/outcome fields. Raw AI output
must not include `projection_rule_id`; BioWeave generates it deterministically.

### Projection Rule identity gap (CURRENT CONTRACT GAP)

The current `projection_rule_id` is deterministically generated from mutable
rule content. Changing that content therefore changes the ID, while a reliable
`update` needs a stable way to locate the same existing entity. Until this
conflict is resolved, `projection_rules.update` must not be described as a
reliable update contract. A later decision must choose either temporary
add-only behavior or a stable logical identity separate from mutable content.
This contract does not change the schema, `core/projection-eligibility.js`, or
the current identity generation.

## 3. Contracts

### Prompt reference source boundary

World Analysis has two deliberate final message shapes:

- Full: permitted World Analysis evidence references, without an Existing World
  Model baseline; `evidence -> complete model`.
- Supplement/Patch: the same permitted evidence references plus a clearly
  labelled Existing canonical World Model comparison baseline; `existing model
  + evidence -> sparse differential Patch`.

The baseline is not evidence and must not be described to the model as proof of
new Patch facts. Full must remain baseline-free even if `AnalysisInput` carries
an old `world_model` property. Patch must not be constrained to facts first
introduced by the current Floor.

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
| Existing update field is unchanged | Do not require current evidence to repeat it |
| Patch add field has no current evidence | Reject the Patch |
| Patch change has only evidence of the new value, not correction | Reject the change |
| Existing field disappears from a complete update | Treat as REMOVE and reject |
| Existing baseline is the only support for a new Patch fact | Reject the Patch |
| One nested field has evidence but a sibling nested field does not | Reject the unsupported sibling; do not bless the subtree |
| `projection_rules.update` relies on mutable-content ID | Do not claim reliable update support; preserve the identity gap |

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
- Final-message tests asserting Patch includes Existing baseline and Full excludes
  it even when `AnalysisInput.world_model` exists.
- Semantic-delta tests for accepted unchanged Existing fields plus one supported
  add, rejected unsupported hitchhiking fields, accepted unchanged fields not
  repeated in current evidence, and rejection when the baseline alone is the
  purported evidence (Cases A-D). Also test complete-update omission as REMOVE
  and correction evidence stricter than ordinary ADD.
- A production-source scan asserting no fixture/person/species/type/Floor
  literal is introduced by the generic Patch guard.

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
