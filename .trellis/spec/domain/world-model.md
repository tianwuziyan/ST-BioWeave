# World Model and World Analysis Contract

## 1. Scope / Trigger

This is the canonical domain owner for World Model and World Analysis. It
defines how permitted evidence becomes a complete canonical model in Full
Analysis, or a scope-aware Supplement Fact Delta that deterministic code turns
into an internal Patch v2 in Supplement Analysis. It also defines the evidence, canonicalization, merge, and ownership
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

### Candidate delivery and persistence order

An accepted World analysis result is first a transient validated candidate, not
yet an authoritative Floor value. Runtime assigns it an execution-bound
revision using the canonical World fingerprint and persists it directly through
`saveWorldModel()` and the existing `FloorPersistenceCoordinator`. The UI does
not authorize or block that write. Only the authoritative Floor readback may be
projected into `worldModelState.model`.

```text
validated candidate -> saveWorldModel -> commitFloorPatch(owner="world")
  -> FloorPersistenceCoordinator -> authoritative readback
  -> WORLD_PERSISTENCE_CONFIRMED -> shared UI projection ingress
```

`resolveWorldModelUiReady()` and equivalent persisted/view-model helpers prove
only that an authoritative Floor model can be read and rendered. A reload that
started before a newer committed projection must not replace that newer
application state when its older Floor result returns. Projection failure,
closed tabs, loading gates, and delayed rendering do not release or reverse a
confirmed Floor transaction.

The candidate revision is transient and distinct from the Floor transaction
identity. Candidate creation remains diagnostic and persistence input only.
Canonical no-op candidates skip an unnecessary Floor transaction and do not
create a UI projection mutation.

### Supplement execution snapshot transaction

World Supplement uses one execution-scoped cumulative snapshot. At execution
start, Runtime clones the authoritative baseline model from the valid Floor.
Each guarded accepted Patch v2 delta merges into that snapshot; parser,
Resolver, or Evidence Guard rejected Facts never enter it. A later transport,
response-format, or API failure cannot roll back an already accepted snapshot
mutation.

Attempts never write the Floor directly. When the execution ends, Runtime
compares the accumulated snapshot with the authoritative baseline. A changed,
canonical-valid snapshot is persisted exactly once through the existing
`saveWorldModel()` -> `commitFloorPatch(owner="world")` -> authoritative
readback path. If the snapshot is canonically equal to the baseline, the
execution is `NO_CHANGE` and skips the Floor transaction.

The final attempt result and the execution snapshot are independent diagnostic
states: a terminal retry failure may coexist with a preserved, mutated,
persistence-confirmed snapshot. This recovery path remains fail-closed when
the execution is superseded, the Floor/Swipe Version changes, the request is
aborted, canonical validation fails, or the persistence coordinator rejects the
transaction. A persistence failure does not erase the in-memory snapshot or
pretend that the mutation was confirmed.

#### Supplement collection and Unknown lifecycle

Supplement JSON Facts use four mutation classes: scalar Facts are
`SET_FIELD` replacements; `Special_Rule` and `Exception` are append-only
collections with canonical host-owned deduplication; and `Unknown` is an
append-only unresolved queue. Existing collection order is authoritative:
accepted unique response items append in response order and are never
re-sorted. Existing Unknowns are sent in the same request with deterministic
host-owned `unknown_id` values derived from canonical text.

The optional `resolved_unknown_ids` response declaration contains an
`unknown_id` and one or more exact canonical `resolving_fact_addresses`. A
declared Unknown is removed only after the same response supplies a Fact at one
of those addresses and that Fact is accepted by structural/address/scope and
permitted-evidence guards. Rejected, unresolved, no-evidence, duplicate/no-op,
or unbound Facts retain the Unknown. Resolution is per queue item, and
accepted Fact mutation plus queue removal happens in the same execution
snapshot before the single World owner persistence transaction.

Supplement structured Facts do not enter Full-only field-specific semantic
regex/NLP reclassification. Their guard validates JSON structure, canonical
address/dependency, scope, permitted-evidence membership, and boundary safety;
Full analysis retains its independent semantic evidence guard.

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
     -> AI internal Complete Fact Discovery
     -> Fact Delta v1
  -> Fact parser / semantic resolver / Existing comparison
  -> internal Patch v2
  -> deterministic safety validation
  -> deterministic merge
  -> complete-model consistency
  -> strict canonical validation
```

Supplement must receive the validated canonical Existing World Model in the
same request as a TARGET, comparison baseline, and structure reference, and
must re-review the complete permitted evidence set. AI performs evidence
discovery and structured claim synthesis; deterministic code performs exact
Existing comparison and delta calculation. Existing is never evidence. The
first question is the scope of each discovered fact: individual,
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
            independent Fact Delta v1 Facts
            -> Fact parser / semantic resolver / Existing comparison
            -> Fact Delta -> internal Patch v2
            -> delta safety / Evidence Guard -> deterministic merge
            -> complete consistency -> canonical validation -> persist
```

The Supplement response is one strict Fact Delta v1 root containing independent
self-contained Facts. It contains no serialized discovery ledger or second
wrapper. Complete means complete with respect to permitted evidence, not
complete with respect to schema: every clearly scoped fact that can legally map
to the World Model is emitted, while unsupported schema fields are omitted.
Evidence completeness is not schema completeness. The AI performs internal
Complete Fact Discovery before serialization. It must not compress away
rare/minority facts or complete unsupported schema fields. Identity discovery
comes before detail extraction; identity evidence does not authorize details.
Fact order, indentation, previous Fact state, and implicit parent state have no
semantic effect. Missing identity, unsupported fields, malformed payloads,
scope mismatch, or unresolved dependency reject that Fact; root framing and
unrecoverable protocol violations reject the response. Indexing is never
last-write-wins or fuzzy-merged. Fact Delta is transient and is not
persisted or sent to UI or Floor storage.

Existing identity/facts with the same known value are omitted from the
Supplement Fact Delta. Existing identity may carry an independently evidenced
field-only ADD/CHANGE or correction claim. Fact omission is no
claim/preserve Existing, never removal. When an Existing Species/Type is only
a parent scope for a new child, do not restate its Description unless a real
evidence-backed description delta exists.

Omitted Facts are no claim/preserve Existing; Fact Delta is not a canonical
World Model object.
`remove` and `invalidate` are unsupported. The complete merged result must pass canonical validation before persistence;
otherwise the update and downstream Character/Event analysis fail closed and
the prior model remains intact.

Supplement discovery and downstream acceptance are separate contracts. Before
comparing against Existing, AI performs a complete semantic coverage pass: it
scans all evidence-supported Species, every stable Biological Type under each
Species, and for each Type the description, six capabilities, reproduction
rules, lifecycle, special rules, and reproductive mechanisms. Only after every
Type has been reviewed does it scan world-scoped medical/care fields,
exceptions, unknowns, and projection rules. Coverage means checking the whole
semantic surface, not filling unsupported schema fields. Existing null or
absence is not evidence; unsupported fields remain omitted.

The Supplement discovery pass is operationally divided into three internal
passes: (1) Identity Discovery exhausts open-string stable Biological Types and
their siblings for every evidence-supported Species; (2) Type Semantic
Discovery independently scans the complete Type field matrix for every known
or newly discovered Species/Type, without short-circuiting after a missing
field, one accepted Fact, one completed outlet, or one Type; and (3) World
Semantic Discovery rescans all permitted evidence independently for
world-scoped childbirth difficulty, care level, medical evidence, exceptions,
unknowns, and projection rules. Only after those passes is an internal claim
inventory compared with Existing. The inventory is model-internal and is not
serialized, parsed, persisted, used as Evidence Guard evidence, or added to
diagnostics. Coverage Targets remain a completeness audit checklist rather
than the primary discovery driver. `NO_EVIDENCE` is valid only after the
complete discovery passes have actively searched all permitted evidence for
the target canonical address and field and found no legal supporting claim.

Downstream acceptance remains independent per Fact. A supported Fact may pass
the existing Evidence Guard, map to an existing Patch v2 operation, merge, and
persist while an unsupported sibling Fact is rejected. Evidence Guard matching
is not weakened to improve discovery recall. Open-ended Type special rules use
direct claim/rule-context binding rather than the generic short-substring
fallback, so an unrelated capability or rule word cannot authorize a new
Special_Rule. Runtime diagnostics distinguish a successful analysis stage with
zero accepted operations from a response that produced a canonical mutation
and from confirmed persistence.

Fact Discovery must resolve address before emission. The Supplement sequence is
Evidence discovery -> semantic Field classification -> scope classification ->
canonical address resolution -> Existing comparison -> Fact emission. All
Type-scoped fields, including descriptions, capabilities, reproduction rules,
lifecycle, special rules, and reproductive mechanisms, require both Species and
Biological Type. A Species-only claim has no valid Type outlet and is omitted;
it is never projected to sibling Types, rewritten as Unknown/Exception, or
stored as a Species-level rule. One evidence claim may expand to multiple Facts
only when its permitted evidence explicitly scopes the claim to each addressed
stable Type. Existing identities may resolve an address but remain outside the
evidence set.

Supplement may add deterministic Missing Coverage Targets derived only from
the Existing canonical model. A target is a review address, not evidence and
not an output whitelist: the AI must search the complete permitted evidence
for each target, emit a Fact only when that evidence supports it, and may still
discover valid claims outside the target list. Missing scalar outlets produce
targets for null, empty, or `NONE RECORDED` values. Empty collections may
produce a category target, but a non-empty collection is not claimed complete
or incomplete because the canonical schema has no collection completeness
marker. Target diagnostics may report that a Fact was emitted for an address;
they must not infer `NO_EVIDENCE` or `reviewed` from omission.

When completeness review is required, each Coverage Target carries one
cardinality contract from the target builder. Scalar targets with `EMITTED`
require exactly one exact-address Fact; collection targets (`Special_Rule`,
`Reproductive_Mechanism`, `Exception`, `Unknown`, and `Projection_Rule`) with
`EMITTED` require at least one exact-address Fact and allow multiple distinct
items at that address. Both scalar and collection targets with `NO_EVIDENCE`
require zero exact-address Facts. This is coverage accounting only: Fact
identity, semantic deduplication, resolver validation, and Evidence Guard
decisions remain owned by their existing validators.

For Supplement JSON Fact Delta Patch v2 evidence binding, structured
permitted-evidence lines may be split into local units while retaining their
explicit Species and Biological_Type labels, or their structurally preserved
parent headings, as transient provenance on each descendant unit. This
provenance is context from the same permitted source, not a new evidence
source and not Existing/Coverage Target data. Full Analysis keeps its existing
complete-model evidence-unit path.

The JSON Fact Delta has already performed semantic field classification. Its
Evidence Guard must therefore enforce permitted-evidence membership and
address safety, but must not independently reclassify a valid `field` with a
second field-specific NLP heuristic when the proposed value is directly
anchored in a permitted unit. The Guard still rejects an unbound value, an
individual-only statement, or a value whose unit belongs to another Species
or sibling Biological Type.

Some canonical nested fields have no Species-level storage slot even when a
stable rule is stated for the whole Species. For a Supplement Type-scoped Fact,
the Guard may bind a directly anchored value to Species-wide evidence and
store it at the addressed Type, provided the evidence is not explicitly bound
to a different sibling Type. This is scope-preserving canonical storage, not
automatic keyword inheritance. A Type-A-specific unit can never authorize a
Type-B Fact, and a Species-A unit can never authorize a Species-B Fact.

Full Analysis is unchanged and continues to use its existing complete-model
semantic evidence checks.

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
fact and classify its outlet before emitting a Supplement Candidate claim.

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
happens after it. Type existence has two paths. Direct Stable Classification
applies when permitted evidence directly names a Species-scoped, persistent
physiological, biological-sex, reproductive, or other biological
classification. Derived Stable Classification is used only when the source
does not name the classification and a stable, mutually distinguishable,
species-level cluster uniquely defines its boundary. Low-inference type
discovery is permitted only after the Exclusion Gate. It must never turn a
non-biological category into a `biological_type` merely because the category
is mentioned together with body, sex, reproduction, or capability language.

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

An alleged type name is not evidence by itself. An isolated, unscoped,
social/role-based, individual-only, or temporary sex-like label cannot establish
Species-level type existence. Conversely, a direct Species-scoped statement
that the classification is stable is sufficient for type-existence review; it
does not require a second capability cluster. Each detail still requires
evidence at its own scope. Species binding likewise requires direct or
uniquely low-inference evidence in the same species context; another species,
Human evidence, an unrelated partner, or the Existing baseline cannot
authorize the candidate.

Prevalence and stability are separate dimensions. Quantity, ratio, commonness,
or rarity do not participate in the existence threshold: rare != temporary,
minority != unstable, and low prevalence != insufficient existence evidence.
The Stability Gate asks whether the classification is persistent and biological,
not whether it is common. Every evidence-supported stable classification must
be reviewed; confirming one type must not stop review of the same Species.

Type existence != type details. A proven identity does not authorize
capabilities, reproduction rules, lifecycle, mechanisms, special rules, or
other details. Those fields remain independently evidenced and may remain
unknown/null (or omitted in Supplement Candidate output).

For Patch v2 `ADD_TYPE`, `operation.type.name` uses the same frozen Type
existence contract as analysis: a Species-scoped Direct Stable Classification
may establish identity without a capability/detail claim, and the Derived
Stable Classification path remains available only for a uniquely bounded,
stable, species-local biological/reproductive cluster after the existing
Species Binding, Exclusion, Stability, Classification, and Evidence
Sufficiency gates. Prevalence never lowers either path. Detail leaves are
validated independently; unsupported capability or description evidence must
fail at that detail path, not at `operation.type.name`.

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
- Supplement performs internal Complete Fact Discovery inside one AI response,
  then serializes only independent Fact Delta facts over the complete permitted
  evidence set. Existing is only TARGET/comparison/structure reference;
  deterministic code parses and resolves facts, computes identity and field
  deltas, and creates Patch v2. Existing identities may receive field-only
  ADD/CHANGE or correction claims, while unchanged Existing facts are omitted.

An Existing entry is not evidence for a new fact. Existing non-empty content
does not authorize skipping complete evidence review, species completeness
review, biological-type classification review, missing-world-fact review, or
compatible consolidation. An empty Patch is legal only after those reviews
have completed and no legal evidence-supported `ADD` or `CHANGE` candidate
remains. “Existing already has content” is not a completed review.

The Prompt operationalizes Supplement as one request and one response with
internal Complete Fact Discovery followed by JSON Fact Delta serialization.
Deterministic code performs JSON root parsing, per-Fact validation, semantic resolution, Existing
Comparison, Patch Selection, and the Empty Patch Gate. The semantic workflow
is not two API requests. Fact Delta is transient, is not persisted, and is not
a canonical schema field or Patch v2 AI output:

The Supplement message architecture preserves the historical role ownership:
analyzer control and permitted source context remain in system messages,
Recent Story remains an assistant message, and Existing/Coverage/task remain
in the user request:

```text
system    analyzer control
system    permitted source context
assistant Recent Story
user      Existing + Coverage Targets + JSON Fact Delta task
system    optional analyzer boundary
```

The structured user request states that the model is the currently saved and
active canonical model under review: `Existing = TARGET + comparison baseline`.
Existing is never evidence. Character Card, Worldbook, External Memory, and
Opening Greeting remain permitted evidence in the system context; Recent Story
remains permitted evidence in the assistant context. Persona remains outside
the historical World Supplement request. Full continues to receive
no Existing model and independently rebuilds from permitted evidence. Event
and Character analyzers retain their existing World Model reference semantics;
this Supplement-specific target formatter must not change them. Persona
remains outside the World Model request unless a separate evidence-scope
review authorizes it.

```text
permitted evidence + structured Existing/Targets request
  -> one response: internal Complete Evidence Discovery
     -> JSON Fact Delta
  -> JSON adapter + current Fact IR + semantic resolver + Existing Comparison
  -> internal Patch v2
  -> Evidence Guard
  -> merge
  -> canonical World Model
```

Fact review must cover missing Species/Types, field knowledge, reproductive
mechanisms/rules, lifecycle, `special_rules`, exceptions, unknowns,
`medical_context`, `projection_rules`, evidence-supported corrections, and
compatible completions. Each reviewed candidate receives exactly one
classification: `UNCHANGED`, `ADD`, `CHANGE`, or `EXCLUDED`, after applying the
shared scope, Species/Type binding, exclusion, stability, classification, and
evidence rules. Existing is used only after evidence-only discovery, for
  comparison and compatible consolidation; it cannot create or prove a
  candidate. The retired Patch v1 design used a complete `update.species`
  Candidate. The current Supplement path in §1.5.8 uses JSON Fact Delta and
  deterministic internal Patch v2 operations. The Empty Patch
  Gate may
pass only after every candidate category and candidate has been reviewed and
  no legal mutation remains. The internal Patch v2 vocabulary does not authorize `REMOVE` or
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

### 1.5.1 Retired Patch v1 presence and canonical null contract

The following Patch v1 presence contract is historical/retired. It is kept only
as design history; no current analyzer entry or production Supplement path
parses or emits this DTO.

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

### 1.5.2 Historical / retired Patch v1 candidates

Sections 1.5.2–1.5.7 below document the retired AI-facing Patch v1 semantic
delta design and are not current production API contracts. The current
Supplement contract is defined in section 1.5.8.

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
a `REMOVE` attempt. The retired Supplement v1 rejected all such changes because
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
- `REMOVE` was rejected in the retired Supplement v1 contract.

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

### 1.5.8 Supplement Fact Delta v1 and internal Patch v2 design

#### 1.5.8.1 Scope / trigger and design decision

The production Supplement AI transport is now JSON Fact Delta v1. The AI performs
complete fact discovery internally and emits independent self-contained Facts;
deterministic code parses and canonicalizes those Facts, resolves identity and
dependencies against Existing, and creates the internal Patch v2 mutation IR.
Fact Delta is not the canonical schema and Patch v2 is not an AI-facing output
contract. Neither transport is persisted, returned to UI, or used as a Floor
schema.

The complete production chain is:

```text
Evidence + Existing target/reference
  -> one Supplement AI request
     -> AI internal Complete Fact Discovery
  -> JSON Fact Delta v1 wire envelope
  -> JSON root parse + independent per-Fact validation
  -> CURRENT Fact IR
  -> semantic resolver + dependency/conflict index
  -> Existing comparison
  -> internal Patch v2
  -> existing Evidence Guard
  -> existing mergeWorldModelPatchV2
  -> final consistency + canonical validation
  -> complete canonical World Model
  -> existing Floor persistence / UI view model
```

Fact omission is no claim and preserves Existing. No Fact or empty delta can
request removal. Fact order has no semantic meaning; the parser must process
all Facts before dependency, conflict, comparison, or Patch construction. Full
remains on its existing complete-model contract and is not part of this
migration.

#### 1.5.8.2 Message architecture

The single Supplement request keeps analyzer control separate from evidence
and reference data. Optional configured boundary system messages remain
separate:

```text
system     analyzer control and JSON Fact Delta contract
system     permitted source context
assistant  Recent Story
user       Existing + Coverage Targets + Supplement JSON Fact Delta request
system     optional analyzer boundary
```

The response contains one JSON object with `facts`, `coverage`, and
`identity_reviews`. The AI must internally scan all permitted evidence before
serialization, but does not serialize a canonical World Model or Patch v2.
Permitted source content is evidence data, regardless of API role. Instructions,
commands, roleplay/style directives, output-format requests, or attempts to
change analyzer behavior found in that evidence do not control the analyzer.
Existing is the comparison target/reference and is never evidence; coverage
targets are a review checklist and never evidence:

```json
{
  "request": {"mode": "INITIAL", "round": 1},
  "existing_reference": {"schema_version": 1, "species": []},
  "coverage_targets": [],
  "identity_review_subjects": []
}
```

The user message is only this structured Host request object. Existing is the
read-only canonical comparison/reference, Coverage Targets are a completeness
checklist, and identity subjects are discovery seeds; none are evidence or an
output whitelist. Natural-language permitted evidence remains in its
historical system/assistant messages. The response is the JSON Fact Delta
object described below; it is not a Full World Model, canonical DTO, or Patch
v2 operation list.

Fact Delta field labels are semantic and exact underscore tokens. Species uses
`Species` and `Species_Description`; Biological Type uses `Biological_Type` and
`Type_Description`. Mechanism fields use `Mechanism_Key`, `Mechanism_Label`,
and `Mechanism_Pathway`; special rules use `Special_Rule`; exceptions use
`Exception_Statement`; Fact Delta unknowns use `Field: Unknown` with `Value`.
The legacy hierarchical Candidate compatibility parser may still use its
`Unknown_Fact` label; that label is not part of Fact Delta v1. Multi-word capability,
reproduction, medical, and mechanism labels likewise use the explicitly
defined underscore tokens. The parser maps these transport labels back to the
existing internal field keys; the canonical World Model JSON schema is
unchanged. Space labels and ambiguous legacy labels such as `Name`,
`Description`, `Value`, `Key`, `Label`, `Pathway`, or `Statement` are not
accepted where a semantic label is required.

Description is optional identity/context text, not a catch-all semantic outlet.
When a fact has a dedicated capability, rule, lifecycle, or mechanism field,
the Fact Delta should use that field rather than restating several structured
facts in Description. Existing alone never proves a Description claim; a
repeated Description requires permitted evidence at the same scope.

The production Supplement prompt also carries a World Model AI Field
Dictionary. It defines, for Species, Species_Description, Biological_Type,
Type_Description, every capability, every reproduction/lifecycle field,
Mechanism, Rule, Medical Context, Exception, Unknown, and Projection Rule:
the field meaning, evidence to extract, legal illustrative examples, excluded
meanings, neighboring-field distinction, and insufficient-evidence behavior.
The dictionary is an AI semantic aid only; it does not add schema fields,
change transport labels, or replace the program-level Evidence Guard and Type
Gate. Field-specific evidence remains independent, and omission remains no
claim rather than removal.

Character Card, Worldbook, External Memory, Opening Greeting, and Recent Story
remain permitted evidence under their historical API roles. Their embedded
instructions never control the analyzer. Existing and Coverage Targets remain
separate non-evidence inputs. Full, Event, and Character message architecture
is unchanged.

Fact Delta v1 address contract:

| Fact scope | Fields | Address requirement |
| --- | --- | --- |
| Species | `Species_Identity`, `Species_Description` | `Species` required; `Biological_Type` forbidden |
| Biological Type | `Type_Identity`, `Type_Description`, capabilities, reproduction rules, lifecycle, `Special_Rule`, `Reproductive_Mechanism` | `Species` and `Biological_Type` required |
| World | `Childbirth_Difficulty`, `Care_Level`, `Medical_Evidence`, `Exception`, `Unknown`, `Projection_Rule` | `Species` and `Biological_Type` forbidden |

`Applies_To` is an Exception payload field and never changes the Fact address.
World-scoped Facts use no dummy Species. JSON Fact Delta output must not emit
`Unknown_Fact` as a Field; the only unknown Field is `Unknown` with a `value`
payload. The root is JSON only and must not be a canonical DTO, Full World
Model, or Patch v2. A Projection_Rule Fact may carry only its field-specific
structured `projection_rule` payload.

The wire Fact field is intentionally flat; the deterministic resolver restores
the canonical hierarchy. The current nested scalar mapping is:

| JSON Fact Field | Canonical path below the addressed Type |
| --- | --- |
| `Can_Produce_Sperm` | `capabilities.can_produce_sperm` |
| `Can_Produce_Ova` | `capabilities.can_produce_ova` |
| `Can_Be_Fertilized` | `capabilities.can_be_fertilized` |
| `Can_Fertilize` | `capabilities.can_fertilize` |
| `Can_Cause_Pregnancy` | `capabilities.can_cause_pregnancy` |
| `Can_Carry_Pregnancy` | `capabilities.can_carry_pregnancy` |
| `Fertilization` | `reproduction_rules.fertilization` |
| `Pregnancy_Or_Carrying` | `reproduction_rules.pregnancy_or_carrying` |
| `Cycle` | `reproduction_rules.cycle` |
| `Ovulation` | `reproduction_rules.ovulation` |
| `Gestation` | `reproduction_rules.gestation` |
| `Labor` | `reproduction_rules.labor` |
| `Maturation` | `lifecycle.maturation` |
| `Aging` | `lifecycle.aging` |

`Type_Description` maps to `description`, while `Special_Rule` and
`Reproductive_Mechanism` use their dedicated type collections. The JSON Fact
does not repeat `Capabilities`, `Reproduction_Rules`, or `Lifecycle`; the
resolver owns this flat-to-hierarchical mapping and Patch v2 owns the
canonical mutation.

Reproductive mechanism payload types are field-specific and must stay aligned
with the canonical mechanism shape: `Mechanism_Key`, `Mechanism_Label`, and
`Mechanism_Pathway` are non-empty text; `Carrying_Compatibility` is a boolean;
`World_Model_Rule_Refs` is a strict JSON string array; and
`Mechanism_Evidence` is a field-specific semantic payload which the JSON
adapter normalizes to the current canonical `evidence` string array. It is
validated independently from address/control tokens; address, boolean,
structured-key, and JSON payload validation remain fail-closed.

#### 1.5.8.3 Signatures and top-level response contract

The production Supplement parser/resolver boundary is:

```text
parseWorldModelFactDeltaJson(raw) -> root envelope + independently accepted/rejected Fact items
normalizeWorldModelFactDeltaJson(...) -> CURRENT Fact IR
validateWorldModelFactDelta(facts) -> validated Fact Delta
worldModelIdentityIndex(model) -> exact identity index or duplicate error
worldModelFactDeltaToPatchV2(facts, existingModel) -> WorldModelPatchV2
resolveWorldModelFactDelta(facts, existingModel) -> per-Fact resolution + Patch v2
Supplement operation-level Evidence Guard -> accepted Patch v2 + rejected Facts
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
Structural Reclassification. `operations: []` means the Supplement Fact Delta and
Existing comparison found no legal change.

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
| `ADD_SPECIAL_RULE` | species + type + normalized rule text | structured Fact has permitted, type-compatible evidence | same identity is deterministic `NO-OP`; different identity is `ADD` at the response tail; existing order is never re-sorted |
| `ADD_MECHANISM` | species + type + non-empty stable `key` | each proposed mechanism fact is independently supported | same key + same canonical content is deterministic `NO-OP`; same key + different content is `REJECT`; no reliable key fails closed |
| `ADD_EXCEPTION` | host-owned canonical `statement + applies_to`, not raw JSON key order | structured Fact has permitted world-scope evidence | same identity is deterministic `NO-OP` even if provenance/evidence differs; different identity is `ADD` at the response tail |
| `ADD_UNKNOWN` | canonical unknown value after normalization | input must trigger the unresolved world-level question | same canonical unknown is deterministic `NO-OP`; different canonical unknown is `ADD` |
| `ADD_PROJECTION_RULE` | existing production canonical/generated new-rule identity; AI does not provide generated ID | raw new rule passes current `validateProjectionRuleContent()` and add evidence checks | same deterministic identity + same canonical content is `NO-OP`; identity collision with different content is `REJECT`; if safe comparison is unavailable, fail closed / `BLOCKED`; Existing rule update remains blocked |

`ADD_MECHANISM` fails closed when no reliable stable key exists. It must not
use label, array position, or mutable full content as a substitute identity.
`ADD_EXCEPTION` must use canonical identity and never raw `JSON.stringify()`
ordering. Collection reorder is not a semantic delta. For
`Special_Rule`/`Exception`/`Unknown`, existing items remain at their original
indices and accepted unique items append in response order. A collection
`NO-OP` creates no semantic delta, no duplicate item, no persistence
requirement, and no sibling authorization.

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
[Species]                 Species, Species_Description
[Biological Type]         Biological_Type, Type_Description
[Capabilities]            Can_Produce_Sperm, Can_Produce_Ova,
                          Can_Be_Fertilized, Can_Fertilize,
                          Can_Cause_Pregnancy, Can_Carry_Pregnancy
[Reproduction Rules]      Fertilization, Pregnancy_Or_Carrying, Cycle,
                          Ovulation, Gestation, Labor
[Lifecycle]               Maturation, Aging
[Mechanism]               Mechanism_Key, Mechanism_Label, Mechanism_Pathway,
                          Carrying_Compatibility, World_Model_Rule_Refs, Evidence
[Rule]                    Rule only
[Medical Context]         Childbirth_Difficulty, Care_Level, Evidence
[Exception]               Exception_Statement, Applies_To, Evidence
[Unknown]                 Unknown_Fact only
[Projection Rule]         JSON only: one raw projection-rule object without
                          projection_rule_id
```

Only these exact protocol labels are accepted. Internal snake_case names,
underscore/hyphen aliases, fuzzy case or spacing variants, and fields not
listed for the current section are invalid and must be omitted. In particular,
`[Rule]` cannot contain `Name` or `Description`.

Species and Biological Type require an explicit `Species` or `Biological_Type`
transport label. A child is attached
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

Field parsing accepts only the exact transport labels defined by the grammar
(`Species`, `Species_Description`, `Biological_Type`, `Type_Description`,
`Can_Carry_Pregnancy`, and so on). Internal canonical snake_case names,
unlisted underscore aliases, space labels, hyphen aliases, and fuzzy
case/spacing variants are not Candidate protocol tokens.

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

Known Existing value -> Fact Delta `null`, collection disappearance, or any
identity mutation is weakening and fails closed as unsupported `REMOVE`.
Projection updates remain blocked. No new mechanism, exception, or projection
update operation is introduced.

#### 1.5.8.11 Migration status

The production Supplement path is JSON Fact Delta v1. The current production
path is the JSON root/per-Fact adapter and semantic resolver followed by
deterministic Fact Delta -> internal Patch v2 conversion, operation-level
evidence validation, merge, consistency, and canonical validation. The legacy
hierarchical Candidate parser remains only for compatibility callers/tests and
is not a Supplement production fallback. Patch v2 remains an internal mutation
IR and is not an AI-facing transport contract.

#### 1.5.8.12 Canonical writability registry

`SUPPLEMENT_CANONICAL_WRITABILITY_REGISTRY` is the machine-checkable registry
for the writable Supplement Fact contract. Each legal Field declares its wire
scope, canonical owner, relative canonical path, container kind, mutation
operation, payload kind, create policy, correction policy, and UI outlet. The
registry is an address and writability contract, not a second canonical schema.

Address resolution and mutation are separate steps:

```text
JSON Fact -> registry address descriptor -> Patch v2 operation
```

Scalar descriptors use `SET_FIELD`; type-local `Special_Rule` uses append-only
deduplicated `ADD_SPECIAL_RULE`; structured collections use deterministic item
identity; `Unknown` remains an append-only lifecycle queue; identity Facts add
Species or Biological Type containers. Existing mechanism and projection item
corrections remain unsupported (`create_writable=true`,
`correction_writable=false`) and fail closed rather than inventing an update
operation.

The registry must satisfy `SUPPLEMENT_CANONICAL_WRITABILITY_INVARIANT`: every
Field accepted by the JSON adapter has a deterministic canonical outlet,
resolver operation, Snapshot application path, final Floor persistence path,
authoritative readback, and UI projection outlet. Table-driven tests must fail
when a legal Field is added without a registry entry or when its resolver
operation/path does not match the canonical tree.

The canonical path below the addressed owner is:

| Field family | Canonical path | Container / operation |
| --- | --- | --- |
| `Species_Identity`, `Type_Identity` | `species[].name`, `species[].biological_types[].name` | identity add |
| `Species_Description`, `Type_Description` | `species[].description`, `species[].biological_types[].description` | scalar `SET_FIELD` |
| capabilities | `biological_types[].capabilities.<key>` | scalar `SET_FIELD` |
| reproduction rules | `biological_types[].reproduction_rules.<key>` | scalar `SET_FIELD` |
| lifecycle | `biological_types[].lifecycle.<key>` | scalar `SET_FIELD` |
| `Special_Rule` | `biological_types[].special_rules[]` | append + dedupe |
| `Reproductive_Mechanism` | `biological_types[].reproductive_mechanisms[]` | structured add by `key` |
| `Childbirth_Difficulty`, `Care_Level`, `Medical_Evidence` | `medical_context.<key>` | scalar `SET_FIELD` |
| `Exception` | `exceptions[]` | structured add by `statement + applies_to` |
| `Unknown` | `unknowns[]` | lifecycle append/dedupe/resolution |
| `Projection_Rule` | `projection_rules[]` | structured add by generated identity |

The Supplement Evidence Guard is orthogonal to this hierarchy. It checks
permitted-evidence membership, identity/address safety, scope binding,
payload safety, and cross-Species/Type isolation. It must not re-run an
independent field-specific NLP classifier for a structurally valid JSON Fact.
Species-wide evidence may support a Fact at an explicitly addressed Type when
the canonical schema has no Species-level slot, but evidence bound to a
different sibling Type or Species never crosses that boundary.

The JSON Fact payload for `Reproductive_Mechanism` is strict and mirrors the
canonical item contract: `key` is required text; `label`, `pathway`, and
`carrying_compatibility` are optional scalar properties; and
`world_model_rule_refs`, when present, is an array of strings while `evidence`,
when present, is also an array of strings. A scalar string in either collection
property is invalid and must remain a parser diagnostic; the adapter must not
silently coerce it into a one-item array.

For an existing canonical Biological Type, structured Supplement guard
validation uses the JSON Fact address as the semantic scope already selected by
the analyzer. Natural-language evidence is used only as a permitted-evidence
boundary and as a contradiction check: explicit evidence for another Species
or sibling Type rejects the Fact, while the absence of a repeated Type label
does not by itself reject an otherwise valid addressed Fact. A new Type
identity remains stricter and requires explicit Species + Biological Type
evidence before dependent Facts can be accepted.

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

- JSON request topology: analyzer control is system-only; permitted evidence,
  Existing, and Coverage Targets are data/reference blocks;
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

The current implementation uses AI internal Complete Fact Discovery, Fact Delta
transport, deterministic Existing comparison, Fact parsing/resolution, internal Patch v2, operation-level
evidence validation, sparse merge, complete-model consistency, and canonical
validation. Full does not consume Existing; Supplement receives Existing only
as TARGET/comparison/reference, and Existing is not collected by
`evidenceUnits()`.

The remaining limits are intentional or independently blocked: deterministic
code does not re-implement narrative World Fact Discovery or infer facts from
evidence prose. AI remains responsible for scope, outlet classification,
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
- `buildWorldModelPatchMessagesV2(analysisInput, promptSettings) -> ChatMessage[]`
- `parseWorldModelResponse(raw) -> WorldModelV1`
- `createAnalyzer(deps).analyzeWorldModel(input) -> WorldModelV1`
- `parseWorldModelFactDeltaJson(raw) -> root envelope + per-Fact diagnostics`
- `normalizeWorldModelFactDeltaJson(...) -> CURRENT Fact IR`
- `validateWorldModelFactDelta(facts) -> validated Fact Delta`
- `resolveWorldModelFactDelta(facts, existingModel) -> per-Fact resolution + Patch v2`
- `worldModelFactDeltaToPatchV2(facts, existingModel) -> WorldModelPatchV2`
- `validateWorldModelPatchV2(patch) -> WorldModelPatchV2`
- `mergeWorldModelPatchV2(existingModel, patch) -> WorldModelV1`
- `applyWorldModelEvidenceGuard(model, analysisInput) -> WorldModelV1`
- `applyWorldModelPatchV2EvidenceGuard(patch, existingModel, analysisInput) -> WorldModelPatchV2`

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
  -> baseline-aware consolidation -> Complete Evidence-Supported Candidate`.

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
- A type has independent evidence. Species-scoped direct naming or stable
  classification language can establish existence; when no classification is
  directly named, deterministic low-inference cluster evidence may establish
  it only when the boundary is unique. Quantity, ratio, and frequency do not
  set the existence threshold. Rarity does not invalidate an otherwise stable
  type.
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
| Existing update field is unchanged | Omit it from the Supplement Candidate |
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

## 8. Supplement Fact Delta diagnostic observability

Supplement diagnostics are an in-memory/debug trace only. They are not part of
the canonical World Model, Patch v2, Floor payload, or persistence transaction.
The Supplement analyzer may emit the following structured stages:

- `WORLD_PATCH_EVIDENCE_SUMMARY`: permitted evidence unit count, stable index,
  source kind, and text length; Existing World Model is excluded.
- `WORLD_FACT_DELTA_RESPONSE_RECEIVED`: bounded response metadata only.
- `WORLD_FACT_DELTA_PARSED`: fact count, fields, scopes, and addresses; full
  canonicalized Fact payload is allowed only in explicit debug mode.
- `WORLD_FACT_DELTA_RESOLVED`: per-Fact canonical address, Existing comparison,
  resolver status, resolved canonical path, Guard status, and Patch v2
  operation/no-op mapping. A rejected Fact includes its failure stage/code;
  an accepted Fact includes the operation that can be applied to the execution
  snapshot.
- `WORLD_PATCH_EVIDENCE_REJECTED`: rejected operation/path, semantic address,
  proposed value, classification, Guard failure, and evidence candidate summary.
- `WORLD_COLLECTION_LIFECYCLE`: append/dedupe counts for Special_Rule and
  Exception, existing/appended/deduped/resolved Unknown counts, and per-Unknown
  retention/removal reason.

Every Supplement diagnostic carries `mode: "patch"`, an execution identifier,
attempt, and retry index. Diagnostic callbacks are best-effort and must never
change parser, resolver, Guard, retry, persistence, canonical, or UI behavior.
Evidence excerpts, when enabled for Host acceptance, are bounded and are never
stored in a Floor.

### 8.1 Supplement Fact-level failure isolation

The Supplement production path keeps Fact boundaries after transport parsing:

```text
Fact Delta root
  -> parse each Fact independently
  -> deterministic Fact resolver / Existing comparison
  -> one Patch v2 operation per accepted Fact
  -> invoke the existing Evidence Guard per operation
  -> retain accepted operations only
  -> existing Patch v2 merge / canonical validation
```

The root and its framing remain whole-response protocol boundaries. Once the
root is valid, a malformed Fact is represented in `rejectedFacts` and does not
discard valid sibling Facts. Resolver conflicts, unresolved identity
dependencies, unsupported composite corrections, and Evidence Guard failures
are also per-Fact rejections. A new identity is processed before its dependent
detail Facts, independent of response order; if identity acceptance fails,
dependent details receive an unresolved-dependency rejection.

The existing hierarchical Candidate parser and
`worldModelCandidateToPatchV2` remain compatibility/Full-side helpers. They
are not called by the Supplement Fact Delta production path. The canonical
World Model remains hierarchical, and Patch v2 operation names remain
unchanged. The Supplement adapter may split a new identity from its detail
Facts into `ADD_SPECIES`/`ADD_TYPE` plus field-level Patch v2 operations; this
does not change the canonical schema or Evidence Guard matching rules.

### 8.2 New Type Identity bootstrap and observability

`Type_Identity` may bootstrap a Type that is absent from Existing, but it must
still have permitted evidence that binds the Species to a stable, explicitly
named Biological Type. A text candidate or a temporary individual label is not
stable identity evidence. Detail Facts may depend on an accepted identity in
the same response; resolver ordering is deterministic and independent of Fact
text order. Existing identity, Identity Discovery Review metadata, and
Coverage Targets are never evidence.

Identity diagnostics must distinguish candidate text hits from scope-bound
stable evidence and must classify unsupported new identities without lowering
the Guard threshold. Runtime diagnostics are an observability contract: any
World Model pipeline change must review and, when necessary, update Runtime
diagnostics, Advanced Debug collection/rendering, the diagnostics schema
version, and regression tests in the same change. Debug data is bounded,
read-only, and never becomes canonical or Floor state. Advanced Debug must
separate the current execution from any retained candidate belonging to an
earlier execution.

## 8.3 JSON Fact Delta adapter contract

World Supplement uses JSON only as a wire format. The root envelope is parsed
and recovered first; each `facts[]` item is then normalized and validated
independently into the existing Fact IR. A malformed item is recorded as a
parser diagnostic and cannot discard valid sibling Facts. The normalized IR
continues through the existing Resolver, Evidence Guard, accepted-operation
mapping, fixed-point, persistence, and UI paths.

Coverage `EMITTED` is derived only from exact-address Facts accepted by the
Resolver and Evidence Guard. A rejected matching Fact yields an unresolved
coverage target, not `EMITTED` or `NO_EVIDENCE`. `NO_EVIDENCE` is accepted only
when explicitly listed by the JSON response and no exact-address Fact is
accepted. Identity reviews are independent metadata; a new Biological Type
still requires its own accepted `Type_Identity` Fact.

Supplement request messages keep analyzer controls and historical system
context in system messages, Recent Story in the assistant message, and one
structured JSON request object in the user message. That object contains
`request`, `existing_reference`, `coverage_targets`, and
`identity_review_subjects`; Existing is embedded directly as canonical JSON,
coverage and identity inputs remain machine-readable arrays, and retry control
is structured metadata rather than a textual directive. Natural-language
evidence remains in its historical system/assistant messages and is not
converted into a JSON AST. The request object is Host control/reference data,
not an Evidence Guard evidence unit. API role and permitted-evidence
classification are independent. Root-format retry is a single,
explicit `FORMAT_RETRY`; semantic completeness is handled locally and does not
create another semantic model request. Native JSON mode is opt-in through an explicit capability and is
never inferred from provider or model names.

The Supplement analyzer task prompt is intentionally plain-language and
evidence-first. It tells the model what facts to find, how to judge stable
Species/Type identity, how to inspect every Type field and world-level field,
and when `NO_EVIDENCE` is allowed. It must not expose Host implementation
stages such as Resolver, Patch v2, Fact IR, Floor, persistence, diagnostics,
or internal accounting as the model's primary task. JSON response rules are
kept at the end as a separate output contract. One business execution has one
semantic model response: discovery of a new Species or Biological Type and
its supported dependent facts must be completed in that response. Host may
derive dynamic coverage targets and record local completeness diagnostics,
but dynamic targets never trigger another semantic model request.

Automatic retry is transport/response-recovery infrastructure, not semantic
continuation. It may retry API/request failures, response-read failures, and
unrecoverable root JSON/format failures using the existing plugin retry
setting. Semantic incompleteness, dynamic coverage, new identities, missing
semantic fields, fixed-point accounting, and `ALL_FACTS_REJECTED` do not
consume that retry budget. `FORMAT_RETRY` is the only structured model retry
control and only repairs root JSON serialization; ordinary API recovery
replays the same initial semantic request.

User-visible outcome follows the final transaction, not the last model attempt.
A mutated execution Snapshot with confirmed persistence is `SUCCESS` even when
the last recovery attempt failed. A canonically unchanged Snapshot is
`NO_CHANGE` and must not display an update failure. A mutated Snapshot without
confirmed persistence, or a valid cancellation/abort, remains a failure or
cancellation according to the existing Runtime UX.

The JSON adapter separates schema/control tokens from semantic value text:
`scope`, `field`, address identifiers, review identifiers, and review enums
use exact control-token or enum validation, while Fact payload values retain
the semantic sentinel rejection rules. `Unknown` is therefore a legal
`field` enum member but remains invalid as a semantic scalar value where the
current Fact contract rejects that sentinel.
