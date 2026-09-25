# World Model and World Analysis Contract

## 1. Scope / Trigger

This is the canonical domain owner for World Model and World Analysis. It
defines how permitted evidence becomes a complete canonical model in Full
Analysis, or a scope-aware, baseline-consolidated sparse Patch in Supplement
Analysis. It also defines the evidence, canonicalization, merge, and ownership
boundaries; it does not turn deterministic validation into a world-knowledge
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
  reproduction rules, lifecycle/special rules, `exceptions`, `unknowns`,
  `medical_context`, `projection_rules`, and other medical/world context;
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
Patch / Supplement Analysis first reviews what world-level knowledge the
current evidence establishes, then consolidates it against the baseline:

```text
Existing canonical World Model + current permitted World Analysis evidence
  -> World Fact Discovery / scope / classification
  -> baseline-aware consolidation
  -> Candidate Patch
  -> deterministic safety validation
  -> deterministic merge
  -> complete-model consistency
  -> strict canonical validation
```

Supplement must receive the validated canonical Existing World Model as a
comparison baseline and must re-review the complete permitted evidence set.
The first question is the scope of each discovered fact: individual,
world-level rule, world-level exception, world-level unknown, world-level
medical context, or species/type special rule. Only world-level knowledge is
eligible for World Model consolidation. The same mechanism covers newly
available evidence and previously available but missed world-level evidence;
current-Floor origin is not an eligibility rule. Supplement does not return a
complete replacement model.

Full and Supplement share the same permitted evidence boundary. The mode
changes the interpretation of that evidence, not the set of legal evidence
sources. Floor/Swipe provenance, lifecycle, active-version and persistence
authority remain Floor-owned, but Floor provenance is not a Supplement fact
eligibility rule.

The pipeline is therefore:

```text
Full:       evidence -> fact discovery/scope/classification
            -> complete candidate -> Full guards
            -> complete consistency -> canonical model -> persist
Supplement: Existing model + evidence
            -> fact discovery/scope/classification
            -> baseline consolidation -> Candidate Patch
            -> delta safety -> deterministic merge
            -> complete consistency -> canonical validation -> persist
```

Omitted fields in sparse Patch sections are unchanged; complete Candidate
sections follow their explicit contract in section 1.5.2. `remove` and
`invalidate` are unsupported. The complete merged result must pass canonical validation before persistence;
otherwise the update and downstream Character/Event analysis fail closed and
the prior model remains intact.

## 1.3 World Knowledge Scope and canonical outlets

World Analysis separates factual truth from evidence scope. A statement can be
true for one character without establishing a rule for a species, biological
type, population, or world. Supplement must classify scope before selecting a
World Model outlet; it must not default every new fact into
`species -> biological_types`.

| Evidence scope | Default owner or outlet | World Model behavior |
| --- | --- | --- |
| Individual fact tied only to one character | Character / Event | Do not update species/type world rules |
| World-level species/type rule or population mechanism | World Model | Consolidate into the matching species/type/rule area |
| World-level exception to a general rule | `exceptions` | Preserve the general rule and add the exception mechanism |
| World-level unresolved question | `unknowns` | Record only when the evidence establishes a world-level unknown |
| World/species/population medical or care context | `medical_context` | Update only when the scope is world-level, species-level, or group-level |
| Species/type rule outside fixed fields | `special_rules` | Add as an open-ended world rule |
| Ambiguous or insufficient scope | None | Preserve Existing; do not force classification |

The canonical World Model outlets are peer capabilities with different
semantics: `species` / `biological_types`, capabilities,
`reproduction_rules`, lifecycle, `special_rules`, `exceptions`, `unknowns`,
`medical_context`, and `projection_rules`. AI must discover the world-level
fact and classify its outlet before proposing a Candidate Patch.

An individual-only statement must not be promoted into a population rule. A
single anomalous character does not automatically create a world exception, and
an individual uncertainty does not automatically create a world unknown. A
single character's medical need does not update world medical context. If the
evidence explicitly establishes a world-level exception, unknown, or medical
background, that knowledge may enter its corresponding outlet.

When a new world-level fact is compatible with Existing knowledge, Supplement
consolidates it rather than replacing the Existing entry. When a fact appears
to conflict with an Existing world rule, scope is resolved first:

- individual-only difference: preserve the Existing world rule;
- explicit world-level exception: preserve the general rule and add the
  exception;
- explicit world-level correction: allow a correction Candidate only when
  current permitted evidence supports the new world-level statement;
- ambiguous scope: do not force a World Model change.

## 1.4 Existing baseline and evidence isolation

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

## 1.5 Semantic Delta safety contract

Semantic Delta remains a deterministic safety layer after AI World Fact
Discovery, scope/classification, and baseline-aware consolidation. It is not a
world-semantics engine. It must not decide whether an NPC represents a whole
species, whether two narrative descriptions are compatible world knowledge,
or whether a fact belongs in a species rule versus an exception. The program
must instead use the Candidate already proposed by AI to:

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
| `CHANGE` | Candidate replaces an Existing value with another value | Current permitted evidence must directly establish the Candidate world-level fact at a scope compatible with the Existing rule and semantically conflicting with or replacing the Existing value |
| `REMOVE` | An Existing fact disappears from a complete update | Unsupported; reject |

An `add` entry has no Existing target, so every world-level fact-bearing
semantic field in the new entity is delta and must be independently supported.
A species name being evidenced cannot authorize its entire subtree. An
`update` may contain a complete canonical entry, but unchanged Existing fields
do not need to appear again in current evidence. A supported new rule or field
cannot allow an
unsupported capability, rule, lifecycle value, special rule, reproductive
mechanism, or other nested fact to hitchhike into the model.

This safety treatment applies to species and nested
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

`CHANGE` is stricter than `ADD`: evidence that merely mentions the new value,
without establishing the same compatible world-level scope and its conflict or
replacement of the Existing value, does not support the change. No special
correction wording such as “修正”, “其实”, “原来”, “并非”, or “应为” is
required. AI proposes a Candidate only. Program/Runtime owns structural
validation, semantic delta, evidence and consistency validation, deterministic
merge, complete canonical validation, and persistence authority.

Evidence factual truth and evidence scope are separate checks. AI owns
narrative World Fact Discovery and scope/classification. Deterministic Patch
validation must not promote a Candidate merely because a text/value hit exists;
it may reject clearly incompatible or explicitly individual-bound support when
the existing evidence structure makes that contradiction reliable. It does not
claim complete narrative-scope inference and must not become a second
regex-driven natural-language parser. Ambiguous semantic scope is resolved by
the AI Candidate contract, while Existing baseline remains comparison only and
never becomes evidence.

### 1.5.1 Patch presence and canonical null contract

Patch field presence and canonical value semantics are separate dimensions.
The complete canonical model retains the existing tri-state meanings:

| Canonical value | Meaning |
| --- | --- |
| `true` / `false` | Explicitly present / explicitly absent boolean fact |
| `null` | Unknown or insufficiently established fact |
| `"无"` | Explicitly absent or not applicable rule/text fact |
| non-empty text | Known descriptive fact |

For a sparse Patch object, a raw field that is absent means `UNCHANGED`; a
field that is present is an explicit Candidate value. Raw Patch presence must
therefore be retained until Semantic Delta classification. A complete-model
canonicalizer may add `null`, `[]`, or other stable default shape when
finalizing a complete model, but those generated values must not be mistaken
for an AI-proposed Patch value.

This distinction is especially important for `update.medical_context`. A raw
Patch such as:

```json
{ "care_level": "specialist" }
```

updates only `care_level`; an absent `childbirth_difficulty` remains
`UNCHANGED`, even if complete-model normalization would represent it as
`null`. This is a Patch presence boundary, not a defect in
`normalizeMedicalContext()` and must not be fixed by changing the complete
canonical null contract. `null`, `false`, `"无"`, and an absent Patch field
must never be conflated.

### 1.5.2 Complete and sparse Patch candidates

Patch sections do not all have the same omission semantics:

- `update.species` is a complete updated canonical species Candidate. It is not
  a nested sparse species Patch. Existing semantic facts that disappear from
  that Candidate are `REMOVE` / knowledge weakening attempts and must be
  rejected; omission does not mean unchanged inside this complete Candidate.
- `update.medical_context` is a sparse field update. Only fields present in
  the raw Patch participate in the delta; absent fields are `UNCHANGED`.

These contracts must remain distinct. The implementation must not let a
partial species object silently replace a complete Existing species, or let
canonical defaults in a partial medical-context object overwrite Existing
fields that the AI omitted.

### 1.5.3 Canonical Semantic Delta boundary

The executable boundary is:

```text
Raw Supplement Patch
  -> structural validation
  -> preserve required Patch presence information
  -> canonical Candidate
  -> resolve canonical Existing target
  -> semantic delta
```

Semantic Delta compares canonical Existing semantic values with canonical
Candidate semantic values. It must not compare raw AI JSON, Prompt text,
serialized baseline text, storage raw objects, or arbitrary
`JSON.stringify()` output. Species aliases, biological-type normalization,
Human baseline handling, null tri-state, `"无"`, normalized strings,
canonical defaults, and generated structures must not create false deltas.

For scalar or fixed semantic fields, the minimum classification is:

| Existing | Candidate | Delta |
| --- | --- | --- |
| same value | same value | `UNCHANGED` |
| `null` | known value | `ADD` |
| known value | different known value | `CHANGE` |
| known value | `null` | `REMOVE` / knowledge weakening |

For booleans, `null -> true/false` is `ADD`, `true <-> false` is `CHANGE`,
and `true/false -> null` is `REMOVE`. For rule text, `null -> "无"` and
`null -> non-empty text` are `ADD`; `"无" -> non-empty text` and
`non-empty text -> "无"` are `CHANGE`; a known value to `null` is `REMOVE`.
`"无"` is never equivalent to `null`.

Knowledge weakening includes more than an explicit top-level `remove`: a
known scalar or text becoming `null`, an Existing collection item disappearing,
or an Existing nested type/rule/fact disappearing from a complete Candidate is
a `REMOVE` attempt. Supplement v1 rejects all such changes because
`remove`/`invalidate` is unsupported.

### 1.5.4 Collection comparison boundary

Collections require domain semantic identity, not generic raw deep diff. The
current contract establishes only these identity principles:

- `species[]`: canonical species identity;
- `biological_types[]`: species-local canonical biological-type identity;
- `special_rules[]`: normalized semantic string membership.

For `reproductive_mechanisms[]`, `exceptions[]`, `unknowns[]`, and
`projection_rules[]`, identity is only as reliable as the current domain
contract. Where canonical identity is insufficient, the implementation must
record `PARTIAL`, `GAP`, or `BLOCKED` rather than inventing an identity. In
particular, `projection_rules.update` remains a separate identity blocker:
its current generated ID includes mutable rule content, so changing that
content can change the ID needed to locate the Existing rule. This document
does not resolve that gap.

### 1.5.5 Delta evidence validation

Patch evidence validation must operate on each changed semantic fact:

- `UNCHANGED` requires no current-evidence re-proof;
- `ADD` requires support in the current permitted World Analysis evidence;
- `CHANGE` requires sufficient current evidence for the replacement or
  correction, not merely a mention of the new value;
- `REMOVE` is rejected in Supplement v1.

One supported delta cannot authorize another unsupported delta in the same
Candidate. For example, a supported new rule and an unsupported new
capability must cause the Patch to be rejected together; a species name hit or
one nested-field hit cannot authorize the entire species subtree. The guard
must be generic and must not use current-Floor origin, fixed people/species,
Floor numbers, or test-story literals as eligibility rules.

The CHANGE principle is frozen here without inventing a brittle keyword
algorithm. Its executable semantics must reuse and be audited against the
existing field-specific evidence machinery during implementation.

### 1.5.6 Complete-model finalization

Supplement does not end at schema-valid Patch merge. Its final responsibility
chain is:

```text
validated Semantic Delta
  -> deterministic merge
  -> complete canonical World Model
  -> shared complete-model consistency invariant
  -> strict canonical validation
  -> persist
```

The merged complete model must satisfy the same canonical consistency
invariants as a Full result. For example, a final
`can_carry_pregnancy: false` cannot coexist with conflicting pregnancy,
gestation, or labor facts. If a supported world-level capability change
deterministically produces `pregnancy_or_carrying: "无"`,
`gestation: "无"`, or `labor: "无"`, those are consistency consequences, not
new AI-proposed Patch facts and do not require three independent evidence
proofs. This freezes the invariant, not a particular function name: the sparse
Patch guard must not be forced to call the Full complete-model evidence guard
merely for reuse.

### 1.5.7 Semantic Delta implementation guardrails

Implementing Semantic Delta must preserve, rather than redesign:

- World Model canonical null semantics, `nullableBoolean()`, and
  `normalizeRuleText()`;
- the complete-model responsibility of `normalizeMedicalContext()`;
- UI null rendering and `buildWorldModelViewModel()`;
- Human baseline and Fact Discovery;
- the shared `evidenceUnits()` permitted evidence universe;
- Full Analysis Prompt and Full baseline isolation;
- Runtime Full/Patch/Reuse selection;
- Floor ownership, World Model persistence ownership, and Pregnancy Tracking.

If implementation would require changing one of these boundaries, stop and
re-audit the contract instead of treating it as incidental Semantic Delta
refactoring.

## 1.6 Routing and scheduler ownership

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

## 1.7 Current implementation status

The current implementation has the v2 safety path in place but remains
**REVIEW REQUIRED / PARTIAL** against the full contract. Existing capability
includes Full/Patch Runtime routing, Full/Supplement Prompt separation, Patch
baseline final-message injection, Full baseline isolation, the shared permitted
evidence universe, Existing baseline isolation from evidence, World Fact
Discovery, canonical null semantics, Human baseline, Patch DTO structural
validation, top-level `remove`/`invalidate` rejection, deterministic merge,
strict canonical normalization, canonical Existing/Candidate comparison,
changed-fact `UNCHANGED`/`ADD`/`CHANGE`/`REMOVE` safety classification,
per-fact evidence checks, sparse medical presence preservation, and post-merge
complete-model consistency finalization. The Prompt and evidence boundaries
remain correct: Patch receives Existing baseline, Full does not consume it, and
Existing baseline is not collected by `evidenceUnits()`.

The remaining limits are intentional or independently blocked: deterministic
code does not re-implement narrative World Fact Discovery; AI remains
responsible for scope, outlet classification, compatible consolidation, and
correction proposals. Existing reproductive-mechanism update identity remains
blocked when no stable logical identity is available, while safe new mechanism
adds require an explicit non-colliding key. Exceptions use explicit canonical
field equality rather than serialized-object identity. `projection_rules.update`
remains blocked by the mutable-content identity gap documented in section 2.1.
This status records implementation reality and does not weaken the target
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
  Model baseline; `evidence -> World Fact Discovery / scope / classification
  -> complete model`.
- Supplement/Patch: the same permitted evidence references plus a clearly
  labelled Existing canonical World Model comparison baseline; `existing model
  + evidence -> World Fact Discovery / scope / classification
  -> baseline-aware consolidation -> sparse Candidate Patch`.

The baseline is not evidence and must not be described to the model as proof of
new Patch facts. Full must remain baseline-free even if `AnalysisInput` carries
an old `world_model` property. Patch must not be constrained to facts first
introduced by the current Floor. Patch instructions must distinguish
individual-only facts from world-level rules, exceptions, unknowns, medical
context, and species/type special rules; the baseline is a comparison aid, not
the source of any new fact.

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
| Patch change has only a value mention without evidence establishing the Candidate at the compatible world scope | Reject the change |
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
- World Knowledge Scope tests: an individual-only fact does not update a
  species/type rule; an explicit world correction can update it; a world-level
  exception preserves the general rule; an individual anomaly does not create
  an exception; an individual uncertainty does not create a world unknown; and
  individual medical context does not update world medical context.
- Consolidation tests: compatible world-level facts merge with Existing
  knowledge instead of replacing it; older permitted evidence can supplement a
  missing Existing fact even when it is not from the current Floor.
- Semantic-safety tests: accepted unchanged Existing fields plus one supported
  add, rejected unsupported hitchhiking fields, accepted unchanged fields not
  repeated in current evidence, and rejection when the baseline alone is the
  purported evidence (Cases A-D). Also test complete-update omission as REMOVE,
  correction evidence stricter than ordinary ADD, sparse medical presence, and
  deterministic consistency consequences without Full evidence re-proof.
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
