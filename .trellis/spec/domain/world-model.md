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
current permitted World Analysis evidence + Existing target/reference
  -> one Supplement AI request / one response
     -> logical evidence-only Discovery Ledger
     -> logical field review / Existing comparison / sparse Candidate
  -> deterministic identity coverage check
  -> baseline-aware consolidation
  -> Candidate Patch
  -> deterministic safety validation
  -> deterministic merge
  -> complete-model consistency
  -> strict canonical validation
```

Supplement must receive the validated canonical Existing World Model in the
same request as a comparison baseline for the Candidate phase and must
re-review the complete permitted evidence set. Discovery is an evidence-only
logical phase in that response: it must not use Existing to prove Species or
Biological Type identity. The Candidate phase may use Existing for comparison
and structure reference. The first question is the scope of each discovered fact: individual,
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
Supplement: evidence + Existing target -> one AI response containing
            evidence-only Discovery Ledger followed by sparse Candidate Builder
            -> deterministic identity coverage check
            -> Candidate -> internal Patch v2
            -> delta safety / Evidence Guard -> deterministic merge
            -> complete consistency -> canonical validation -> persist
```

The Supplement Discovery Ledger is a transient, strict structured protocol.
Its grammar contains only `Discovery -> Species -> Name -> Biological Type ->
Name`; it does not contain Existing, details, natural-language parsing, or
Patch operations. Opening/closing tags and a parser stack determine ownership;
indentation has no semantic effect. Missing identity, unsupported tags,
closing mismatch, or ambiguous parent ownership rejects the affected subtree
without re-parenting. The Discovery Ledger is not persisted and is never sent
to UI or Floor storage.

One valid Discovery Ledger contains at most one Species block for each exact
Species name, and each Species block contains at most one Biological Type
entry for each exact Type name. Duplicate Species or Type identity is a
protocol error (`WORLD_MODEL_DISCOVERY_DUPLICATE_IDENTITY`); it is never
last-write-wins or fuzzy-merged.

The single Supplement response contains the permitted evidence-driven
Discovery Ledger and the sparse Candidate. The Candidate Builder logical phase
uses that same-response Ledger plus the canonical Existing model. The Ledger is
the complete Species/Type identity universe for this pass: Candidate Builder does not
rediscover or create a new Species/Type identity. It only performs
field-level evidence review, Existing comparison, semantic consolidation, and
sparse Candidate synthesis. It emits the existing sparse hierarchical
Candidate DTO. Candidate omission is no claim/preserve Existing;
it is not removal. When an Existing Species/Type is only a parent scope for a
new child, the Candidate emits identity only and does not restate Existing
Description. A Description is emitted only for an evidence-supported
description ADD/CHANGE claim. Candidate protocol likewise permits at most one
Species block per exact Species name and at most one Type entry per Species;
duplicates fail closed with `WORLD_MODEL_CANDIDATE_DUPLICATE_IDENTITY` before
coverage indexing or Candidate-to-Patch translation.

The deterministic Discovery Coverage Check compares only exact canonical
Species/Type identity sets. Every Ledger identity absent from Existing must be
present in Candidate; every Candidate identity must be present in the Ledger.
It does not read evidence prose, perform NLP, infer biology, pair types, use
name dictionaries, or create identities. Missing coverage fails closed before
Candidate-to-Patch conversion with
`WORLD_MODEL_CANDIDATE_DISCOVERY_COVERAGE_MISSING`.

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

### 1.3.1 World Analysis Prompt regression freeze

The following semantic invariants are shared by Full and Supplement. The
Prompt may interpret the same evidence differently for complete reconstruction
versus baseline comparison, but Supplement must not use a weaker biological
classification or evidence boundary than Full.

For every candidate biological type, the required order is:

```text
Candidate Discovery
  -> Species Binding
  -> Biological Type Exclusion Gate
  -> Stability Gate
  -> Biological / Reproductive Classification Gate
  -> Evidence Sufficiency
  -> Type Creation
```

`Fact Discovery` happens before this sequence and `Unarchived Fact Review`
happens after it. Low-inference type discovery is permitted only after the
Exclusion Gate. It must never turn a non-biological category into a
`biological_type` merely because the category is mentioned together with
body, sex, reproduction, or capability language.

`biological_type` is a species-local, stable biological, physiological, or
reproductive classification. The Exclusion Gate rejects a candidate whose
meaning is principally any of the following, even when it has biological
descriptions nearby:

- species name, taxonomy, ordinary subspecies, lineage, ancestry, or origin;
- occupation, cultivation identity, social identity, organization, sect,
  faction, cultural group, or rank/realm;
- ability system, attribute label, growth stage, progression, or skill state;
- temporary condition, reversible body modification, transformation,
  mutation, disease, anomaly, or a single body's shape;
- personality, sexual preference, behavior, relationship, or an individual-only
  description.

An alleged type name is not evidence by itself. A name cannot establish type
existence, capability, reproduction rule, lifecycle, special rule, or Human
equivalence. Each of those facts requires evidence at its own scope. Species
binding likewise requires direct or uniquely low-inference evidence in the
same species context; another species, Human evidence, an unrelated partner,
or the Existing baseline cannot authorize the candidate.

The low-inference exception is intentionally retained. When the same species
has two or more stable, mutually distinguishable, species-level reproductive
physiology, reproductive-role, or reproductive-capability clusters, and the
clusters uniquely define biological classes, a class may be created even if
the source does not supply its label. This does not permit creating a paired
class from one cluster, importing Human assumptions into a Nonhuman species,
promoting an individual exception, or bypassing the Exclusion Gate.

### 1.3.2 Evidence truth, Human boundary, and capability tri-state

The following ordering and values are part of the shared semantic contract;
they are not merely output formatting guidance:

```text
explicit current evidence
  > reliable Human baseline
  > unknown
```

Human baseline is limited to an already-established ordinary Human Male or
Female. It fills only canonical null fields; explicit false, explicit
absence, and explicit known values win. Nonhuman species never use Human
baseline. This section does not redesign the Human baseline.

For each of the six capability fields:

- `true` requires evidence that the capability exists;
- `false` requires explicit evidence that it is absent or impossible;
- `null` means unknown, unmentioned, unobserved, insufficiently evidenced, or
  unresolved.

Absence of evidence is not false. No observed pregnancy, pseudo-pregnancy,
interaction-only text, and an unproved type label do not establish `false`.

### 1.3.3 Full, Supplement, and Empty Patch review

Full and Supplement must execute the same Fact Discovery, species discovery,
species binding, type exclusion, stability, classification, evidence-scope,
Human/Nonhuman, and capability tri-state invariants. Their difference is the
role of the Existing model:

- Full builds an independent complete model from permitted evidence and does
  not consume an Existing baseline. For each discovered species, Full first
  enumerates every evidence-supported biological-type candidate, then applies
  Species Binding -> Exclusion Gate -> Stability Gate -> Biological /
  Reproductive Classification Gate -> Evidence Sufficiency -> Type Creation
  to each candidate. Discovering a majority type must not end minority/rare
  candidate discovery for that species;
- Supplement emits one AI response whose logical first phase freezes the
  evidence-only Discovery Ledger, then whose Candidate Builder phase receives
  Existing only as a comparison baseline and re-runs field-level evidence
  review, semantic consolidation, and sparse Candidate synthesis over the
  Ledger identities and complete permitted evidence set. Candidate Builder
  does not rediscover or create Species/Type identities, and emits a sparse
  differential Candidate Patch.

An Existing entry is not evidence for a new fact. Existing non-empty content
does not authorize skipping Discovery Ledger review, species completeness
review, biological-type classification review, missing-world-fact review, or
compatible consolidation. An empty Patch is legal only after those reviews
have completed and no legal evidence-supported `ADD` or `CHANGE` candidate
remains. “Existing already has content” is not a completed review.

The Prompt operationalizes Supplement as one request and one response with an
evidence-only Discovery Ledger followed by a Candidate Builder logical phase
that performs field Classification, Existing Comparison, Patch Selection, and
the Empty Patch Gate. This two-phase semantic workflow is not two API requests.
The Discovery Ledger is strict structured content in the response, is not
persisted, and is not a Patch schema field:

The Supplement message architecture preserves the same epistemic boundary in
one request: the formal analysis contract and permitted evidence remain in
their existing system/assistant positions, and the Existing target remains in
the user message:

```text
system  formal Supplement single-response contract
system  permitted World Analysis references
assistant  Recent Story
user  【Supplement Target：当前已保存的 World Model】
      <existing_world_model>...</existing_world_model>
      【Supplement Single-Response Request】
```

The target block states that the model is the currently saved and active
canonical model under review: `Existing = TARGET + comparison baseline`.
Existing is never evidence. Worldbook, Character Card, External Memory, and
Opening Greeting keep their permitted system evidence architecture. Recent
Story remains a single permitted assistant message. Full continues to receive
no Existing model and independently rebuilds from permitted evidence. Event
and Character analyzers retain their existing World Model reference semantics;
this Supplement-specific target formatter must not change them. Persona
remains outside the World Model request unless a separate evidence-scope
review authorizes it.

```text
permitted evidence + Existing target/reference
  -> one response: evidence-only Discovery Ledger
     -> Candidate Builder / Classification (UNCHANGED / ADD / CHANGE / EXCLUDED)
  -> Existing Comparison (Candidate Builder logical phase only)
  -> Patch Selection
  -> Empty Patch Gate
```

Candidate enumeration must explicitly cover missing species; missing
biological types, including minority/rare types; missing capability knowledge;
reproductive mechanisms/rules; lifecycle; `special_rules`; exceptions;
unknowns; `medical_context`; `projection_rules`; evidence-supported
corrections; and compatible completions. Each candidate receives exactly one
classification: `UNCHANGED`, `ADD`, `CHANGE`, or `EXCLUDED`, after applying the
shared scope, species/type binding, exclusion, stability, classification, and
evidence rules. Existing is used only after candidate discovery, for
comparison and compatible consolidation; it cannot create or prove a
candidate. Patch Selection emits only legal evidence-supported `ADD`/`CHANGE`
in the active Patch contract. The compatibility v1 implementation uses a
complete `update.species` Candidate; the production Supplement path in §1.5.8
replaces AI-facing Patch construction with a sparse hierarchical Candidate and
deterministic internal delta operations. The Empty Patch Gate may
pass only after every candidate category and candidate has been reviewed and
no legal `ADD` or `CHANGE` remains. Neither v1 nor v2 authorizes `REMOVE` or
Structural Reclassification.

### 1.3.4 Structural Reclassification gap

Prompt regression restoration and Structural Reclassification are separate
problems. Supplement may continue to support safe field-level `CHANGE` and
evidence-supported `ADD` under its current contract. If an Existing canonical
entry's identity or knowledge outlet is itself wrong—for example, an Existing
`biological_type` is actually an occupation or social classification—the
current protection against unsupported `REMOVE` may prevent complete
structural correction. This is an independent `Structural Reclassification /
Existing Classification Correction` gap.

This section records the gap but does not authorize arbitrary `REMOVE`,
general reclassification, or a new deterministic narrative classifier.

### 1.3.5 Historical implementation boundary

The semantic invariants above are retained independently of the historical
implementation used to enforce them. Do not restore branches for a concrete
species, type, person, or fixture; fixture-specific `if/else`, large regex
narrative classifiers, and a second NLP parser are not part of the contract.
AI owns narrative Fact Discovery, scope, species binding, classification, and
baseline-aware consolidation. Deterministic code owns structure, canonical
identity, evidence isolation, delta/merge safety, complete-model consistency,
and strict validation.

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

### 1.5.8 Supplement Patch v2 DTO design (frozen, not implemented)

#### 1.5.8.1 Scope / trigger and design decision

The production Supplement boundary is now hierarchical Sparse World Fact
Candidate Text. The AI discovers and structures evidence-supported facts;
deterministic code parses ownership, compares the Candidate with Existing, and
creates the internal Patch v2 mutation IR. Patch v2 is not an AI-facing output
contract. The Candidate is not persisted, returned to UI, or used as a Floor
schema.

The complete production chain is:

```text
Evidence + Existing target/reference
  -> one Supplement AI request / one hierarchical response
     -> [Discovery] evidence-only identity ledger
     -> [Candidate] sparse hierarchical Candidate Text
  -> deterministic identity coverage check
  -> stack-based Candidate parser
  -> Candidate + Existing deterministic comparison
  -> internal Patch v2
  -> existing Evidence Guard
  -> existing mergeWorldModelPatchV2
  -> final consistency + canonical validation
  -> complete canonical World Model
  -> existing Floor persistence / UI view model
```

Candidate omission is no claim and preserves Existing. No Candidate field or
empty outlet can request removal. Full remains on its existing complete-model
contract and is not part of this migration.

#### 1.5.8.2 Message architecture

The single Supplement request uses this role order, excluding optional
configured boundary system messages:

```text
system     formal Supplement single-response contract
system     permitted World Analysis references
assistant  Recent Story
user       Existing target + Supplement Single-Response Request
```

The response contains both logical phases in one explicit top-level grammar.
Discovery must not use Existing to prove identity. Candidate Builder may use
the same request's Existing target as comparison baseline and structure
reference; Existing is never evidence:

```text
【Supplement Target：当前已保存的 World Model】
这是当前已保存且 active 的 canonical World Model，是本次 Supplement 审查和补充的目标。
Existing = TARGET + comparison baseline。
Existing 本身不是 evidence。
<existing_world_model_reference>...</existing_world_model_reference>

【Supplement Single-Response Request】
在同一次响应中先输出 [Discovery]，再输出 [Candidate]。Discovery 只根据
permitted evidence 建立 Species/Type identity；Candidate 只对同一响应中的
Discovery identities 做 field-level evidence review、Existing comparison、
semantic consolidation 与 sparse Candidate synthesis。不要重新发现或创建新的
Species/Type identity。Ledger identity 已存在 Existing 且无新 claim 时可以
省略；Ledger identity 不存在 Existing 时必须输出 identity block。
不要输出 JSON、operation、target、path、classification 或 old_value。
```

Permitted Worldbook, Character Card, External Memory, Opening Greeting, and
Recent Story evidence retain their existing message roles and provenance.
Persona remains excluded from the World Model request. Full, Event, and
Character message architecture is unchanged.

#### 1.5.8.3 Signatures and top-level response contract

The production parser/validator boundary is:

```text
parseWorldModelSupplementText(raw) -> { discoveryLedger, candidate, diagnostics }
validateWorldModelDiscoveryLedger(ledger) -> DiscoveryLedger
validateWorldModelCandidate(candidate) -> SparseWorldFactCandidate
checkWorldModelCandidateDiscoveryCoverage(ledger, candidate, existing) -> pass/fail
worldModelIdentityIndex(model) -> exact identity index or duplicate error
worldModelCandidateToPatchV2(candidate, existingModel) -> WorldModelPatchV2
applyWorldModelPatchV2EvidenceGuard(patch, existingModel, analysisInput) -> classified Patch v2
mergeWorldModelPatchV2(existingModel, patch) -> complete WorldModelV1
```

Patch v2 remains an internal deterministic IR:

```json
{
  "schema_version": 2,
  "operations": []
}
```

The internally generated `operations` contains only evidence-supported proposed `ADD` or `CHANGE`
information. It never contains complete updated Existing species,
unchanged Existing fields, `UNCHANGED` operations, `REMOVE`, `invalidate`, or
Structural Reclassification. `operations: []` means the complete Candidate
Ledger and Existing comparison found no legal change.

All operation targets use canonical identity, never array index, input order,
mutable full-content identity, or guessed identity:

| Domain object | Required identity |
| --- | --- |
| species | `species_name` |
| biological type | `species_name` + `type_name` |
| reproductive mechanism | `species_name` + `type_name` + stable `key` |
| world field | explicit allowlisted canonical field path |
| projection update | blocked; no v2 workaround |

The DTO does not return `old_value`. The implementation resolves the old value
from Existing and derives the semantic result.

#### 1.5.8.4 Minimal operation set

The frozen operation set is:

| Operation | Purpose | Identity / payload |
| --- | --- | --- |
| `ADD_SPECIES` | Add a species absent from Existing | `species.name` plus supported new entry fields |
| `ADD_TYPE` | Add a biological type to an Existing species | `target.species_name`, `type.name` plus supported new type fields |
| `SET_FIELD` | Add or change one allowlisted scalar field | target + allowlisted `path` + proposed `value` |
| `ADD_SPECIAL_RULE` | Add one type-local special rule | species + type + canonical rule string |
| `ADD_MECHANISM` | Add one reproductive mechanism | species + type + stable mechanism `key` plus mechanism fields |
| `ADD_EXCEPTION` | Add one world exception | canonical exception value |
| `ADD_UNKNOWN` | Add one triggered world unknown | canonical unknown value |
| `ADD_PROJECTION_RULE` | Add a new projection rule | existing raw new-rule fields; generated identity is deterministic and not AI-supplied |

`medical_context` uses constrained `SET_FIELD` rather than a dedicated
operation. It is already a world-scoped field object, and the same
old-value/proposed-value/presence semantics apply without creating a
single-use operation type. Only allowlisted `medical_context` keys are legal.

No operation is defined for updating projection rules. `ADD_PROJECTION_RULE`
retains the current raw AI new-rule contract: `schema_version`,
`mechanism_key`, `development_concern_key`, `development_kind`, `trigger`, and
the optional validated `requirements`, `realization`, `contradiction`, and
`expiration` fields. AI must not include `projection_rule_id`; after raw
validation, BioWeave generates it through the existing deterministic
production path. Mutable Existing projection identity remains blocked, and
this operation must not create an update workaround.

Current source verification: `core/projection-eligibility.js` defines
`RAW_RULE_FIELDS` and `validateProjectionRuleContent()` with exactly this raw
boundary, while `normalizeProjectionRules()` calls `buildProjectionRuleId()`
to add the generated identity. The v2 design does not change those functions
or their ID algorithm.

#### 1.5.8.5 SET_FIELD whitelist and validation matrix

`SET_FIELD` is not an arbitrary JSON path mutation API. The path is a finite
canonical tuple selected by `target.kind`:

| `target.kind` | Allowed paths |
| --- | --- |
| `biological_type` | `capabilities.<CAPABILITY_KEY>`; `reproduction_rules.<WORLD_RULE_KEY>`; `lifecycle.maturation`; `lifecycle.aging`; `description` |
| `species` | `description` and only future explicitly allowlisted species scalar correction fields |
| `world` | `medical_context.childbirth_difficulty`; `medical_context.care_level`; `medical_context.evidence` |

The initial species scalar whitelist is only `description`; adding another
field requires a separate contract update. `description` is allowed because it
is a canonical scalar, not an identity or collection replacement.

The following are always invalid `SET_FIELD` paths:

- any array index or numeric path segment;
- `biological_types` as a whole or any biological-types array path;
- `special_rules` as a whole;
- `reproductive_mechanisms` as a whole;
- `exceptions`, `unknowns`, or `projection_rules` as a whole;
- `schema_version`, `name`, `species_name`, or `type_name` mutation;
- any path not listed for the target kind;
- `null` as a deletion/weakening value.

Collection additions use their dedicated `ADD_*` operation. `false` and
`"无"` are explicit known facts and are not unknown values.

#### 1.5.8.6 Deterministic ADD / CHANGE semantics

For `SET_FIELD`, the program resolves `old` from the canonical Existing target
and reads `proposed` from the operation:

| Existing `old` | Proposed value | Result |
| --- | --- | --- |
| equal to proposed | equal | `NO-OP`; do not emit or persist a delta |
| `null` / unknown | known value | `ADD` |
| known value | different known value | `CHANGE` |
| known value | `null` | weakening / `REMOVE` semantic; reject |

`false` and `"无"` remain known values. Existing supplies only the old value;
it cannot prove the proposed value. Every operation must independently pass
current permitted World Analysis evidence validation. One supported operation
does not authorize any sibling operation.

`ADD_TYPE` separates type existence evidence from type-field evidence. A type
may be added with only evidence-supported identity/existence fields; capability
fields without independent evidence remain canonical `null` after merge. Type
existence never authorizes capability, lifecycle, reproduction, or mechanism
facts.

#### 1.5.8.7 Collection operation contracts

| Operation | Identity / semantic equality | Evidence requirement | Merge behavior |
| --- | --- | --- | --- |
| `ADD_SPECIAL_RULE` | species + type + normalized semantic rule identity | evidence supports that type-local rule | same identity + same canonical content is deterministic `NO-OP`; different identity is `ADD`; same identity with different content is `REJECT` |
| `ADD_MECHANISM` | species + type + non-empty stable `key` | each proposed mechanism fact is independently supported | same key + same canonical content is deterministic `NO-OP`; same key + different content is `REJECT`; no reliable key fails closed |
| `ADD_EXCEPTION` | canonical `statement + applies_to`, not raw JSON key order | evidence supports the world-level exception scope | same identity + same canonical content is deterministic `NO-OP`; same identity with another fact-bearing conflict is `REJECT`; different identity is `ADD` |
| `ADD_UNKNOWN` | canonical unknown value after normalization | input must trigger the unresolved world-level question | same canonical unknown is deterministic `NO-OP`; different canonical unknown is `ADD` |
| `ADD_PROJECTION_RULE` | existing production canonical/generated new-rule identity; AI does not provide generated ID | raw new rule passes current `validateProjectionRuleContent()` and add evidence checks | same deterministic identity + same canonical content is `NO-OP`; identity collision with different content is `REJECT`; if safe comparison is unavailable, fail closed / `BLOCKED`; Existing rule update remains blocked |

`ADD_MECHANISM` fails closed when no reliable stable key exists. It must not
use label, array position, or mutable full content as a substitute identity.
`ADD_EXCEPTION` must use canonical field equality and never raw
`JSON.stringify()` ordering. Collection reorder is not a semantic delta.
For every collection operation, same canonical identity plus same canonical
content is a deterministic `NO-OP`; same identity plus different canonical
content is a conflict and must `REJECT`; a different canonical identity is a
normal `ADD` candidate. A `NO-OP` creates no semantic delta, no duplicate item,
no persistence requirement, and no sibling authorization.

#### 1.5.8.8 Evidence and merge pipeline

Each operation is independently validated:

```text
clone Existing
  -> validate operation shape and canonical identities
  -> resolve Existing target / old value
  -> evidence-validate exactly this operation
  -> apply validated operation
  -> complete-model consistency guard
  -> strict canonical normalization / validation
  -> persist
```

Absence of an operation means `UNCHANGED`; `NO-OP` is a deterministic
validation result, not an AI operation type. AI must not emit `NO_OP`.
Omission never implies REMOVE. If every operation resolves to `NO-OP`, the
merged canonical model is unchanged and produces no `ADD`/`CHANGE` delta;
whether persistence skips a write remains the existing Runtime/ownership
contract and is not redesigned here.
Merge applies a sparse field or collection addition to the cloned Existing
model; it never replaces a complete Existing species entry. A supported
capability operation cannot authorize another capability, reproduction rule,
lifecycle field, special rule, or mechanism operation.

#### 1.5.8.9 Candidate grammar and presence semantics

Candidate Text uses explicit opening/closing tags and a parser stack. Indent,
nearest-node lookup, natural-language headings, and implicit close are not
semantic. The allowed hierarchy is:

```text
[World Model]
  [Species]
    [Biological Type]
      [Capabilities] ... [/Capabilities]
      [Reproduction Rules] ... [/Reproduction Rules]
      [Lifecycle] ... [/Lifecycle]
      [Reproductive Mechanisms]
        [Mechanism] ... [/Mechanism]
      [/Reproductive Mechanisms]
      [Special Rules]
        [Rule] ... [/Rule]
      [/Special Rules]
    [/Biological Type]
  [/Species]
  [Medical Context] ... [/Medical Context]
  [Exceptions] [Exception] ... [/Exception] [/Exceptions]
  [Unknowns] [Unknown] ... [/Unknown] [/Unknowns]
  [Projection Rules] [Projection Rule] ... [/Projection Rules]
[/World Model]
```

The protocol field labels are fixed per section:

```text
[Species]                 Name, Description
[Biological Type]         Name, Description
[Capabilities]            Can Produce Sperm, Can Produce Ova,
                          Can Be Fertilized, Can Fertilize,
                          Can Cause Pregnancy, Can Carry Pregnancy
[Reproduction Rules]      Fertilization, Pregnancy Or Carrying, Cycle,
                          Ovulation, Gestation, Labor
[Lifecycle]               Maturation, Aging
[Mechanism]               Key, Label, Pathway, Carrying Compatibility,
                          World Model Rule Refs, Evidence
[Rule]                    Value only
[Medical Context]         Childbirth Difficulty, Care Level, Evidence
[Exception]               Statement, Applies To, Evidence
[Unknown]                 Value only
[Projection Rule]         JSON only: one raw projection-rule object without
                          projection_rule_id
```

Only these exact protocol labels are accepted. Internal snake_case names,
underscore/hyphen aliases, fuzzy case or spacing variants, and fields not
listed for the current section are invalid and must be omitted. In particular,
`[Rule]` cannot contain `Name` or `Description`.

Species and Biological Type require an explicit `Name`. A child is attached
only when its opening tag is legal under the current stack parent. Missing
identity, mismatched closing tags, illegal nesting, a new Species before the
previous Species closes, or an unclosed subtree invalidates the smallest safe
subtree. Every section and collection item is transactional: fields are staged
only in the current frame, and `attach()` commits them to the parent only
after a normal closing tag and successful finalization. An invalid section is
discarded without mutating its parent, so no rollback is required. The parser
never re-parents a fact to another Species or Type; valid closed siblings may
still be recovered. Projection identity is not Candidate input:
`projection_rule_id` is rejected and generated only by the existing production
normalization path.

Field parsing accepts only the exact protocol labels defined by the grammar
(`Name`, `Description`, `Can Carry Pregnancy`, and so on). Internal canonical
snake_case names, underscore aliases, hyphen aliases, and fuzzy case/spacing
variants are not Candidate protocol tokens.

Candidate values have these meanings:

| Candidate form | Meaning |
| --- | --- |
| field absent | no claim; preserve Existing |
| `null` | invalid Candidate value; never a removal request |
| empty array/outlet | no collection claim; preserve Existing, never clear it |
| explicit `true`/`false` | evidence-supported boolean fact |
| `[Unknown]` item | explicit unresolved world proposition supported by evidence |
| non-empty text/object | evidence-supported semantic fact |

Existing formatter output may show canonical `null` and `NONE RECORDED` as
reference markers. The Candidate parser does not treat those markers as
claims. Existing remains TARGET, comparison baseline, and structure reference,
never evidence.

#### 1.5.8.10 Deterministic Candidate -> Patch v2 mapping

For each Candidate fact, deterministic code resolves canonical identity in
Existing and emits the smallest internal operation. A missing Existing entity
emits `ADD`; an equal fact emits no operation (`NO-OP`); a different known fact
emits `CHANGE` and remains subject to the existing guard; Candidate omission
preserves Existing. The mapping is:

| Candidate fact | Existing comparison | Internal operation |
| --- | --- | --- |
| new Species subtree | species identity absent | `ADD_SPECIES` |
| new Biological Type | species exists, type identity absent | `ADD_TYPE` |
| species/type scalar, capability, rule, lifecycle, or medical field | absent/unknown | `SET_FIELD` classified `ADD` |
| same scalar/field | equal canonical value | no operation (`NO-OP`) |
| changed scalar/field | different known canonical value | `SET_FIELD` classified `CHANGE` |
| type-local special rule | semantic rule identity absent/equal | `ADD_SPECIAL_RULE` / no-op |
| reproductive mechanism | stable mechanism key absent/equal | `ADD_MECHANISM` / no-op |
| world exception | canonical statement + scope absent/equal | `ADD_EXCEPTION` / no-op |
| triggered world unknown | canonical unknown absent/equal | `ADD_UNKNOWN` / no-op |
| new projection rule | generated identity absent/equal | `ADD_PROJECTION_RULE` / no-op |

Known Existing value -> Candidate `null`, collection disappearance, or any
identity mutation is weakening and fails closed as unsupported `REMOVE`.
Projection updates remain blocked. No new mechanism, exception, or projection
update operation is introduced.

#### 1.5.8.11 Compatibility and migration status

The completed migration preserves the already-tested v1 guard path:

1. Keep v1 parsing, evidence guard, and complete-candidate merge as temporary
   backward compatibility. Do not silently reinterpret v1 `update.species`.
2. Implement an isolated v2 parser/validator and an internal operation
   application path. A v1-to-internal adapter may translate only after v1
   validation and must preserve v1 complete-candidate deletion-risk checks.
3. Change only the Supplement Prompt to request hierarchical Candidate Text.
   Full output and Full schema remain unchanged.
4. Route Candidate responses through deterministic Candidate -> Patch v2
   conversion, then the existing operation-level evidence validation and merge.
5. Keep the v1 parser/guard/merge compatibility path for non-migrated callers;
   the production Supplement path no longer asks the AI for v1 or v2 Patch
   operations.

Runtime should not own semantic conversion. If an adapter is needed, it stays
inside the World Model Patch parser/compatibility boundary and returns the
same internal validated operation representation.

#### 1.5.8.10 Generic DTO examples

All examples use only generic names.

```json
// ADD_SPECIES
{"schema_version":2,"operations":[{"op":"ADD_SPECIES","species":{"name":"Species-B","description":"Supported species."}}]}

// ADD_TYPE
{"schema_version":2,"operations":[{"op":"ADD_TYPE","target":{"species_name":"Species-A"},"type":{"name":"Type-B","description":"Supported type."}}]}

// SET capability
{"schema_version":2,"operations":[{"op":"SET_FIELD","target":{"kind":"biological_type","species_name":"Species-A","type_name":"Type-A"},"path":["capabilities","can_carry_pregnancy"],"value":true}]}

// SET reproduction rule
{"schema_version":2,"operations":[{"op":"SET_FIELD","target":{"kind":"biological_type","species_name":"Species-A","type_name":"Type-A"},"path":["reproduction_rules","gestation"],"value":"Supported gestation rule."}]}

// SET lifecycle
{"schema_version":2,"operations":[{"op":"SET_FIELD","target":{"kind":"biological_type","species_name":"Species-A","type_name":"Type-A"},"path":["lifecycle","maturation"],"value":"Supported maturation rule."}]}

// ADD_SPECIAL_RULE
{"schema_version":2,"operations":[{"op":"ADD_SPECIAL_RULE","target":{"species_name":"Species-A","type_name":"Type-A"},"value":"Supported special rule."}]}

// ADD_MECHANISM
{"schema_version":2,"operations":[{"op":"ADD_MECHANISM","target":{"species_name":"Species-A","type_name":"Type-A"},"mechanism":{"key":"stable-mechanism-key","label":"Supported mechanism","pathway":"Supported pathway","carrying_compatibility":null}}]}

// medical_context field update
{"schema_version":2,"operations":[{"op":"SET_FIELD","target":{"kind":"world"},"path":["medical_context","care_level"],"value":"Supported care level."}]}

// ADD_EXCEPTION
{"schema_version":2,"operations":[{"op":"ADD_EXCEPTION","exception":{"statement":"Supported exception.","applies_to":"Species-A"}}]}

// ADD_UNKNOWN
{"schema_version":2,"operations":[{"op":"ADD_UNKNOWN","unknown":"Supported unresolved world question."}]}

// ADD_PROJECTION_RULE: raw AI payload; projection_rule_id is forbidden.
{"schema_version":2,"operations":[{"op":"ADD_PROJECTION_RULE","projection_rule":{"schema_version":1,"mechanism_key":"stable-mechanism-key","development_concern_key":"concern","development_kind":"possible_detection","trigger":{"kind":"story_time_reached","target_story_time":{"day_index":1}}}}]}

// no-op
{"schema_version":2,"operations":[]}
```

The following are invalid and must fail closed:

```json
{"schema_version":2,"operations":[{"op":"REMOVE","target":{"species_name":"Species-A","type_name":"Type-A"}}]}
{"schema_version":2,"operations":[{"op":"SET_FIELD","target":{"kind":"biological_type","species_name":"Species-A","type_name":"Type-A"},"path":["capabilities","can_carry_pregnancy"],"value":null}]}
{"schema_version":2,"operations":[{"op":"SET_FIELD","target":{"kind":"biological_type","species_name":"Species-A","type_name":"Type-A"},"path":["biological_types",0,"capabilities"],"value":{}}]}
{"schema_version":2,"operations":[{"op":"ADD_TYPE","target":{},"type":{"name":"Type-B"}}]}
{"schema_version":2,"operations":[{"op":"SET_FIELD","target":{"kind":"biological_type","species_name":"Species-A"},"path":["capabilities","can_carry_pregnancy"],"value":true}]}
```

#### 1.5.8.11 Validation and error matrix

| Condition | Required result |
| --- | --- |
| unsupported `schema_version` or unknown operation | reject closed |
| missing species/type/mechanism identity | reject closed |
| array index, identity mutation, or non-whitelisted path | reject closed |
| Existing target species/type absent | reject closed |
| proposed known value unsupported by permitted evidence | reject closed |
| known Existing value -> `null` | reject as weakening / REMOVE |
| duplicate type or mechanism identity | reject closed |
| duplicate canonical collection addition | no-op or reject per collection policy; never duplicate or replace |
| projection rule update | reject with explicit blocked status |
| `REMOVE`, `invalidate`, Structural Reclassification | reject as unsupported |
| valid no-op against same Existing value | no semantic delta; omit/persist no change |

#### 1.5.8.12 Tests required

Implementation must add coverage for:

- role rollback: Existing only in user Target; permitted evidence in original
  system/assistant roles; Recent Story once; Persona excluded;
- Full without Existing and unchanged Event behavior;
- every legal operation type and canonical identity resolution;
- no-op and deterministic `ADD` versus `CHANGE` derivation;
- known-to-null rejection, explicit `false` and `"无"` preservation;
- capability/type/reproduction/lifecycle/special-rule sibling isolation;
- baseline cannot self-prove a proposed value;
- merge preservation of all untouched Existing data;
- collection dedupe and reorder invariance;
- REMOVE, Structural Reclassification, and projection update rejection;
- final consistency and strict canonical validation;
- generic production fixture leakage audit using only Species-A / Species-B /
  Type-A / Type-B in tests.

#### 1.5.8.13 Wrong versus correct

Wrong: return a complete `update.species` containing Existing Type-A merely to
add Type-B, or use a missing nested field to mean REMOVE.

Correct: return one `ADD_TYPE` operation targeting `Species-A` with
`Type-B`; merge resolves Existing Species-A, preserves Type-A untouched, and
adds only the independently evidence-supported Type-B fields.

#### 1.5.8.14 REVIEW REQUIRED

The following remain open until implementation review:

- whether the external API may accept v1 and v2 concurrently during migration;
- implementation conformance to the frozen collection policy: same identity +
  same canonical content is `NO-OP`, while same identity + different content
  is `REJECT`;
- the final allowlist of species scalar correction fields beyond `description`;
- implementation verification that `ADD_PROJECTION_RULE` invokes the existing
  raw validator and deterministic generator without accepting an AI-supplied
  `projection_rule_id`;
- whether v1 compatibility must be time-limited by release or capability flag;
- adapter placement and API error codes for v2 operation failures.

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

The current implementation keeps the v1 complete-candidate Patch path as
compatibility for non-migrated callers, while the production Supplement v2
path uses the evidence-only Discovery Ledger, deterministic identity coverage,
hierarchical Candidate Text, internal Patch v2, operation-level evidence
validation, sparse merge, complete-model consistency, and canonical
validation. Full does not consume Existing; Candidate Builder receives
Existing only as TARGET/comparison/reference, and Existing is not collected by
`evidenceUnits()`.

The remaining limits are intentional or independently blocked: deterministic
code does not re-implement narrative World Fact Discovery or infer facts from
evidence prose; the Discovery parser and coverage checker only parse and
compare identities. AI remains responsible for scope, outlet classification,
compatible consolidation, and correction proposals. Existing
reproductive-mechanism update identity remains
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
- `parseWorldModelPatchV2(raw) -> WorldModelPatchV2` (planned)
- `validateWorldModelPatchV2(patch) -> WorldModelPatchV2` (planned)
- `mergeWorldModelPatchV2(existingModel, patch) -> WorldModelV1` (planned)
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
