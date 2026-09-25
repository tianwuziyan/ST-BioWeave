# BiologicalEvent Pipeline Contract

## 1. Scope / Trigger

This contract applies when narrative analysis produces or consumes a
`BiologicalEvent`, especially `sexual_activity`, and when the result updates
the Pregnancy Tracking Subject registry.

Phase 2D Projection is downstream of this factual pipeline. A Projection is a
future-direction DTO and never a substitute for a BiologicalEvent; a later
factual Event always takes precedence. Projection lifecycle and evidence records
are append-only derived operations and cannot mutate Event facts or StateReducer
state. A `reproductive_source_attribution` Event may factually confirm or exclude
a contributor relationship; candidate sources and unresolved attribution are read
models, not Events. Phase 2D-1.1 defines these contracts without Runtime,
persistence, AI generation, Context Injection, Probability, or RNG integration.

The StateReducer stores only confirmed/excluded attribution relationships inside
an already existing Pregnancy Episode. It never creates an episode from an
attribution Event, never stores Candidate values, and records orphan or
confirmed-vs-excluded conflicts as deterministic diagnostics.

Projection eligibility/evolution is a downstream pure rule layer. Its World Model
rules may mark a future concern eligible or evaluate a later factual realization,
contradiction, or explicit expiration, but it cannot emit or mutate a
BiologicalEvent. Story Time eligibility and Projection lifecycle are not factual
pregnancy conclusions.

The source of truth is the validated Event stored in the producing Floor or
active Swipe. The registry stores stable references to Event IDs and never
duplicates the Event fact.

Floor/active-Swipe ownership, lifecycle invalidation, previous resolution, and
provenance are defined by [Floor State Ownership](./floor-state.md). This
document owns the BiologicalEvent contract and only points to that shared
boundary.

## 1.2 Chat-local Runtime master switch

`settings.enabled` is the single Chat-local BioWeave Runtime master switch.
Its default is `true`; a missing value is normalized to `true`. It is stored
under the current Chat's `bioweave.settings`, never in a Character Card and
never in a cross-Chat or character-card registry.

When it is explicitly `false`, lifecycle analysis, interval scheduling,
manual/programmatic analysis, automatic Tracking rebuilds, Snapshot creation,
World Model/Character/Event AI requests, and all automatic Projection side
effects are skipped with a disabled/skipped-disabled result. A disabled skip
is not a failed analysis and must not create failure retry metadata. Existing
Floor facts and user edits remain readable and are not cleared.

The Runtime/coordinator and side-effect boundaries own this guard; pure Event,
StateReducer, normalizer, validator, and Projection eligibility functions do
not read it. Any asynchronous result must re-check the current Chat setting
alongside Chat epoch, active Swipe, owner, and complete Floor Version before
committing.

Disabling immediately clears the `bioweave_projection_context` extension
prompt slot and aborts cancellable work. Projection Context refreshes fail
closed while disabled. Re-enabling resumes future interval-eligible work and
normal reads without scanning or replaying disabled-period Floors.

## 1.1 Business boundary with World Model

Event Analysis and Character are independent from the World Model domain. They
share Floor infrastructure only: Floor Version, `store.getFloor()` /
`store.saveFloor()`, exact message/Swipe owner slots, lifecycle invalidation,
and business-neutral previous-Floor traversal.

Event Analysis may consume a resolved World Model DTO in `EventAnalysisInput`
to evaluate participant biological context, reproductive capability, and
exposure semantics. It must not own, persist, modify, parse, normalize, or
redefine the World Model. In particular, identity resolution, Character
Registry persistence, Tracking rebuild, Event CRUD, and ordinary Event
reanalysis must never update or clear valid `world_model` /
`world_model_meta` fields.

The reverse boundary also applies: World Model AI/manual saves and World
resolvers must preserve valid `analysis`, `events`, and
`character_registry`. World Model code must not update Character Registry,
Events, profiles, or Tracking. The Floor object is a shared storage container,
not a combined business owner. Only explicit complete Floor lifecycle
invalidation may clear both domains together.

`findPreviousSuccessfulBioWeave()` remains the Character/Event previous
analysis and registry resolver. World Model resolvers are separate World/Floor
operations; if they share mechanical traversal, the shared primitive must not
understand either domain's fields.

### Character Evidence semantic projection boundary

Character/Event Analysis and World Model Analysis are independent business
domains. “Independent” does not mean that the Character/Event Analyzer loses
the stable evidence required to analyze a person. The correct boundary is:

```text
raw Host/source data
  → source-specific collection
  → Character Evidence semantic projection
  → Character/Event Analyzer
```

It is neither raw source DTOs copied wholesale into the Event prompt nor raw
sources isolated so completely that stable person evidence disappears. Module
extraction separates responsibilities; it must not delete evidence required by
those responsibilities.

`individual_evidence` is the Event input projection for stable person facts.
Each entry is source-specific and subject-bound, and may contain
`subject_kind`, nullable `character_id`, `display_name`, `identity_hint`,
typed `stable_biological_evidence: {kind, text}[]`, canonical species/type,
explicit individual capabilities, and source/Floor provenance. Evidence kinds
are `biological_sex`, `species`, `biological_type`, `stable_physiology`,
`explicit_capability`, and `other_stable_biological`.

Character Evidence is used only to resolve a mention, map a person to an
already persisted World Model species/type, provide explicit individual
physiology or reproductive capability evidence, and provide stable person
background. It is not a current-Floor Event, a World Model rule, a Tracking
eligibility result, a replacement for Character Registry identity candidates,
a Chat-level fact, or a Characters UI list source.

Source rules are: Character Card may provide stable evidence for the current
Character; Persona may provide stable evidence for the Persona subject;
existing canonical/derived profiles retain their canonical ID, species/type,
capabilities and evidence; Current Floor and Recent Story are both narrative
Event discovery evidence; and Worldbook/External Memory require reliable
subject binding. Text containing a name is not a binding, first-match-wins and
cross-person borrowing are forbidden, and an unbound item is excluded from
Character Evidence rather than broadcast.
Character Card/Persona history is not a current-Floor Event and Persona facts
are never broadcast to other participants.

### Event discovery window and persistence owner

Event discovery window and Event persistence owner are independent concepts.
The Runtime explicitly sends the Current Target Floor and the bounded Recent
Story to the Event Analyzer as narrative evidence. Both may produce a
BiologicalEvent when the text contains a clear fact that belongs to that
window. A Recent Story fact is not limited to background context merely
because it predates the Target Floor; its Event keeps the fact's own
`story_time`.

Every newly discovered Event is nevertheless persisted by the current active
Character Floor/Swipe. Its canonical `source` is the current six-field Floor
Version and therefore represents the persistence owner, not the historical
time of the fact. The analyzer must not copy an historical Recent Story
source into the canonical Event source or create a second historical owner.

`existing_bioweave` keeps its existing contract: it is the nearest valid
successful previous Floor snapshot used for profile/identity continuity. The
separate `existing_events` projection is the bounded dedupe reference for the
narrative discovery window. It contains valid canonical Events from the
nearest previous snapshot plus older valid Floors represented in the selected
Recent Story window; it never scans an unbounded Chat cache, includes the
target's old result, or includes deleted, inactive-Swipe, stale, or invalidated
owners.

After Runtime identity resolution, a newly returned Event is compared with
`existing_events` using a deterministic semantic key. The key requires a
complete high-confidence match of Event type, structured story time,
canonical participant set, gestational-subject set, counterpart set,
reproductive mechanism fields, factual source evidence, and state fact. A
candidate without complete key material is retained. Different Event types,
subjects, counterpart sources, mechanisms, story times, or key factual
evidence are never merged by fuzzy similarity. Same-time independent
exposures therefore remain separate when their source set or evidence differs;
`physical_symptom` and `sexual_activity` can never dedupe each other.

Three projections remain distinct: `identity_context` answers which person a
mention names and contains canonical ID/display name/aliases only;
`individual_evidence` / Character Evidence answers which stable biological
facts belong to that person and contains subject binding, typed evidence,
species/type evidence, explicit capability evidence and provenance; and
`world_model` answers which baseline rules apply to the current species/type.
None of these projections may substitute for another.

Capability resolution is ordered: map Character Evidence to an already
persisted World Model species/type; read that type's baseline capabilities and
mechanism rules; then use explicit individual capability evidence to override
or supplement the baseline. Conflicting or insufficient evidence remains
`null`. Physiological sex/gender may help map to an existing biological type,
but never directly grants a capability. Human baseline is created only by
World Model; Character/Event must not create Human baseline or a missing type,
and a Nonhuman type named “female” or “male” does not inherit Human physiology.
Real-world common sense cannot fill a persisted World Model `null`.

During Initial Registry Bootstrap, Character Evidence remains usable when the
registry is empty and no canonical ID exists. The transient subject uses
`character_id: null`, subject kind, display name/identity hint and provenance;
the raw AI response uses `identity_status: new` or `unresolved`, and Runtime
later allocates the canonical ID. A missing profile or empty Registry must not
discard Character Card/Persona evidence, and a display name must never become a
fabricated canonical ID.

Character Evidence is transient analyzer input. It adds no Chat metadata, Floor
field, Event, Registry, World Model, profile read model, or Tracking Subject.
`character_registry.entities` is not the Characters UI list; Characters UI
continues to consume `tracking_subjects`, whose eligibility is decided from
validated Events, participant biological context, World Model / explicit
capability evidence, and `resolveCarryingCapability()`.

#### Character Evidence regression guard

Future changes to Event Input Boundary, prompt trimming, World/Event
separation, source isolation, sanitization, module extraction, or
`AnalysisInput` narrowing must preserve an equivalent or stricter Character
Evidence projection. Removing raw sources is safe only when the projection
remains available. Tests must inspect final `buildEventAnalysisMessages()`
messages for projected Character Evidence; a Prompt rule saying that gender
can map to a type is not sufficient.

### Character Identity and Character Evidence Contract

BioWeave 不把“人物”当作单一列表。以下四层必须保持分离：

```text
Narrative Person Mention
  != Canonical Character Identity
  != Tracking Subject
  != Characters UI Entry
```

Canonical identity pipeline is:

```text
narrative mention
  → identity_context + Character Evidence + previous valid registry snapshot
  → AI participant identity classification
  → identity_status + existing canonical character_id or response-local mention token
  → Runtime identity resolution
  → canonical character_id
  → participant reference canonicalization
  → Event domain validation
  → current Character Floor active-Swipe character_registry snapshot
  → canonical BiologicalEvent
  → Tracking derivation
  → tracking_subjects / tracking_candidates
  → Characters UI
```

AI may classify what a mention may refer to, but it never owns canonical identity
authority. Runtime owns validation, allocation, registration, and canonical
reference rewriting. A `character_registry` entry is not a Tracking Subject,
and the Characters UI is not a registry browser; the UI currently displays
active eligible `tracking_subjects`.

The raw identity states are:

- `existing`: the participant uniquely maps to an ID that actually exists in
  `identity_context`; AI must copy that ID exactly. It must not derive an ID
  from display name, order, gender, biological type, or event role. Runtime
  rejects an unknown or unauthorized ID and never silently accepts it.
- `new`: the narrative identifies a person not yet represented canonically;
  raw `character_id` is `null` and the response-local mention token is only a
  reference inside this AI response. It is not persisted, is never a registry
  key, and has no required literal format. Production code must not depend on
  numbered fixture tokens.
- `unresolved`: identity cannot be uniquely established. Same-name or alias
  collisions, contradictory evidence, and multiple candidates fail closed;
  first-match-wins is forbidden.

`display_name`, `aliases[]`, response-local mention tokens, `event_role`,
gender, physiological sex, species, biological type, Tracking eligibility, and
UI visibility are not canonical identity. `character_id` is the Runtime-owned
opaque entity identity; display and alias values are resolution attributes.

`character_registry` is a cumulative, Floor-owned canonical identity snapshot.
The active Character Floor Swipe owns it; User messages, Chat metadata, and
inactive Swipes do not. A valid next Character Floor inherits the nearest valid
previous snapshot and resolves the new response against it. Target self-results
are never their own previous authority. Deleted Floors, inactive Swipes, and
stale Floor Versions cannot restore an old snapshot; Runtime rebuilds from
surviving valid Character Floors.

Mention resolution, alias establishment, and alias persistence are separate
operations. A one-off form of address, pronoun, title, or co-occurrence does
not enter `aliases[]`. Only explicit alias-establishment evidence or a manual
alias edit may persist an alias. Alias collisions are unresolved. Manual alias
editing changes the active Floor Swipe snapshot without changing
`character_id` or `display_name`, without rewriting historical Floors or other
Swipes; cancellation writes nothing.

Character Evidence is a transient semantic projection, not an identity
database. Its route is:

```text
raw source → source-specific collection → Character Evidence projection → Event Analyzer
```

It may provide identity hints, stable biological evidence, species/type
evidence, explicit individual capability evidence, and provenance. It may help
resolve a mention and map it to an existing World Model species/type, but it
cannot create a canonical ID, replace the registry, create a Tracking Subject,
or turn a name into an alias. Character Card/Persona and reliably subject-bound
references may supply stable background evidence; Worldbook/External Memory
require reliable subject binding. Recent Story and Current Target Floor are
primarily narrative Event evidence. Narrative Event evidence is not automatically
persisted as stable Character Evidence.

For every confirmed Event participant, regardless of Event pregnancy relevance,
the biological analysis order is:

```text
identity_context
  → Character Evidence
  → species
  → biological_type within that species
  → exact persisted World Model species/type
  → baseline capabilities
  → explicit individual capability evidence
  → null on conflict/no unique match/insufficient evidence
  → final participant biological facts
  → Tracking consumes those facts
```

Physiological sex may help map an already existing biological type, but never
directly supplies reproductive capability or creates a missing type. Nonhuman
types are resolved within their own species and never borrow a Human baseline.
`can_be_fertilized`, `can_fertilize`, `can_cause_pregnancy`, and
`can_carry_pregnancy` are distinct facts; none substitutes for another.
`can_carry_pregnancy: true` without a valid pregnancy-relevant exposure does not
create a Tracking Subject.

#### Identity guardrails

Wrong: derive `character_id` from `display_name`, let AI invent a canonical ID,
or persist a one-off nickname as an alias.

Correct: use a unique canonical candidate as `existing`; otherwise return
`new`/`unresolved` with `character_id: null` and a response-local token, then
let Runtime resolve and persist the canonical ID or fail closed.

Wrong: treat `character_registry` as the Characters UI list, or treat
`can_carry_pregnancy: true` as UI eligibility.

Correct: derive `tracking_subjects` only from canonical BiologicalEvents,
participant facts, valid pregnancy-relevant exposure, and Tracking eligibility;
the Characters UI consumes that projection.

Wrong: make Recent Story reference-only or write a historical Event back to its
original Floor.

Correct: Current Target Floor and bounded Recent Story form the discovery
window; preserve historical `story_time`, compare bounded `existing_events`,
and persist a newly discovered Event to the current active Floor Swipe.

## 2. Signatures

- `buildEventAnalysisInput(options) -> EventAnalysisInput`
- `parseEventAnalysisResponse(raw, {deferIdentityValidation = false}) -> AIEventAnalysisDTO`
- `normalizeCharacterRegistry(raw) -> {schema_version: 1, entities: Record<character_id, CharacterRegistryEntry>}`
- `resolveEventAnalysisIdentities(rawAnalysis, {registry, persistAliases = false}) -> {ok, events, character_registry, errors[]}`
- `resolveRawParticipantIdentity(registry, rawParticipant, options?) -> IdentityResolutionResult`
- `allocateSequentialCharacterId(registry) -> {character_id, error_code}`
- `discoverAliasCandidate(rawCandidate, identityEvidence) -> AliasCandidate | null`
- `persistAliasCandidate(registry, characterId, candidate) -> {accepted, registry}`
- `updateCharacterDisplayName(registry, characterId, displayName) -> {ok, registry}`
- `normalizeEvent(raw) -> BiologicalEvent`
- `validateEvent(event, {strictCanonicalParticipants = false}) -> {ok, errors}`
- `validateEventCollection(events, options?) -> {ok, errors}`
- `rebuildTrackingRegistry(events, previousChat) -> {tracking_subjects, tracking_candidates, character_profiles}`
- `explainTrackingDecision(event, previousChat?) -> Array<{character_id, eligibility, reasons[]}>`, where `eligibility` is `eligible | pending | ineligible`
- `getActiveFloorEvents(floorData, floorVersion) -> BiologicalEvent[]`
- `findPreviousSuccessfulBioWeave(target) -> {analysis, events, character_registry}`
- `createEventAnalysisCoordinator(deps) -> EventAnalysisRuntimeAPI`
- `runtime.analyzeCurrentFloor({force = false}) -> AnalysisResult`
- `runtime.analyzeFloor(messageIdOrIndex, {force = false}) -> AnalysisResult`
- `runtime.refreshCurrentFloorAnalysis() -> AnalysisResult`
- `runtime.requestAbortCurrentFloorAnalysis() -> Promise<boolean>`
- `runtime.collectActiveBusinessData() -> EventAnalysisBusinessDTO`
- `runtime.updateEvent(eventId, patch) -> BiologicalEvent`
- `runtime.deleteEvent(eventId) -> true`
- `normalizeCnDateDigits(value) -> string`
- `_cnToNumber(token) -> number | null`
- `parseCnDate(text, options?) -> {year?, eraLabel?, month, day} | null`
- `parseTraditionalTime(text) -> {branch, marks, hour, minute, dayOffset} | null`
- `matchTraditionalTime(text, options?) -> parsed time + {text, index} | null`
- `extractDayFromTime(text) -> string | null`
- `parseCalendarDate(text, calendar?) -> CalendarDate | null`
- `validateCalendarDate(date, calendar?) -> boolean`
- `ordinalOf(date, calendar) -> number | null`
- `dateFromOrdinal(ordinal, calendar, year?) -> CalendarDate | null`
- `addCalendarDays(date, delta, calendar) -> CalendarDate | null`
- `createSevenDaysCalProvider(provider?) -> StoryTimeProvider`
- `createFallbackStoryTimeProvider(input?) -> StoryTimeProvider`

`authoritativeFloorVersion` contains exactly these binding fields:
`chat_id`, `message_id`, `floor`, `swipe_id`, `content_hash`, and
`message_version`.

## Projection generation boundary

Projection generation is downstream of deterministic Eligibility and remains
outside the factual Event pipeline. Only an `eligible` decision may be sent to
the dedicated Projection Generation prompt. The raw AI DTO contains future
development content only; it cannot create a BiologicalEvent, attribution,
identity, owner, probability, or state. BioWeave assembles and validates the
Projection candidate from the decision and current Floor Version. A stale Chat,
Floor, Swipe, rule, or Eligibility context fails closed and produces no write.

When persisted, a Projection candidate is saved only to the current Character
Floor/active Swipe owner. Creation, evidence, and lifecycle records remain
separate append-only records; later records never rewrite the creation Floor.
Projection persistence is not part of the BiologicalEvent pipeline and never
writes StateReducer, Snapshot, or Chat metadata.

### Projection Context Injection

Phase 2E consumes only the current Projection View from the Floor timeline. It
filters `context_visible`, deduplicates by `projection_id`, orders by stable
business fields, and renders a short future-direction prompt through the
`bioweave_projection_context` `setExtensionPrompt()` slot. The prompt is not an
Event and cannot update StateReducer; Event Analysis treats only the actual
target Character message as direct factual evidence. Clearing or changing the
current Chat/Floor/Swipe/Version clears or replaces the same slot.

## 3. Contracts

### Input

`EventAnalysisInput` contains `chat_scope`, `floor_version`, `current_floor`,
`recent_context`, `world_model`, `story_time`, an explicit
Floor-provenance-checked `character_registry` snapshot, `character_context`, a
sanitized `persona`, and optional existing BioWeave context.
`character_registry` is the only identity candidate source;
`character_context` is semantic/profile evidence and is not an ID whitelist.
For ordinary analysis, the registry may only come from the nearest valid
previous Floor snapshot; a Chat-level registry is not a historical input.
The input boundary is text-oriented and removes secret-like keys before prompt
construction. The analyzer receives a fixed JSON-only output contract.

Runtime must resolve and validate the World Model before constructing a
Character/Event request. `world_model` is a hard business precondition, not a
prompt-only suggestion: a missing or unvalidated model produces
`WORLD_MODEL_UNAVAILABLE` and no Event/Character API request is sent. The
Analyzer also keeps a defensive boundary guard so alternate callers cannot
reintroduce a null World Model path.

Automatic lifecycle analysis is one Floor-Version single-flight Job. The Job
resolves or updates the World Model first, awaits its parse/validation,
normalization, merge, stale guard, and current-Floor save, and only then sends
the Character/Event request. `MESSAGE_RECEIVED`, `GENERATION_ENDED`, and
duplicate mutation notifications for the same complete Floor Version may
observe or join that Job; they must not cancel and restart it. A mutation only
invalidates the affected Floor and downstream work when the lifecycle snapshot
proves a change in the formal Floor-Version identity (`chat_id`, `message_id`,
`floor`, `swipe_id`, `content_hash`, or `message_version`). Different Floor
Versions retain independent in-flight Jobs. A manual refresh joins an existing
Job for the same Version rather than starting a concurrent request.

User-message lifecycle events update the lifecycle snapshot but never create,
invalidate, or reanalyze a BioWeave Character Floor.

World Model validation keeps `carrying_compatibility` as `boolean | null`;
Character/Event must consume that canonical value and must not reinterpret
natural-language anatomy or mechanism descriptions as capability values.

Event Analysis does not consume a raw Character Card DTO. The selected Character
Card description may enter Event Analysis only through the Character Evidence
semantic projection above. `character.greetings` may remain present in the
shared `AnalysisInput` for World Model composition, but Event Analysis must not
format or send greeting content or the `【开场白】` section.

### AI DTO / Domain DTO boundary

`AIEventAnalysisDTO` has only `schema_version: 1` and `events[]` at the top
level, and Event Analysis V1 accepts `events.length >= 0` for one Target Floor
Version. A legacy top-level `source` may be present and is ignored; any other
unknown top-level field is rejected. An AI event does not require or trust
`event_id` or `source`; legacy copies of those fields inside an event are
ignored. Each accepted AI event contains biological facts such as `type`,
`status`, structured `story_time`, `location`, directly relevant
`participants`, `pregnancy_relevance`, `source_evidence`, and optional
`physical_effect`, and for non-exposure biological transitions a type-specific
`state_fact: {subject_id, payload}`. `state_fact` is a factual contract rather
than Current State or Projection. Its subject must be one of the Event's
explicit participant identities; no display-name, gender, role, or positional
inference is allowed. For `sexual_activity`, participants are only the direct
members of the actual reproductive exposure chain; other Event types retain
only objects directly relevant to that biological fact.

Valid pregnancy-related exposure keeps `pregnancy_relevance` as its sole
authoritative exposure fact and must not duplicate it in `state_fact`. The
payload is type-specific and minimal: conception and later pregnancy facts
share one explicit pregnancy episode reference, capability changes name one of the six independent tri-state
capabilities, and symptoms/medical facts carry a factual kind (plus optional
description). AI may use `new` / `existing` references; Runtime materializes
deterministic Chat-local IDs from Floor Version, Event ordinal, subject and fact
kind. `possible_conception` never creates a conception fact.

`state_fact` reuses the Event's normalized `story_time`; it does not create a
second effective-time source. `confirmed`, `probable`, `ambiguous`, `negated`,
and `fictional` remain separate status values. Only factual statuses are
transition candidates; negated and fictional facts do not change factual state.

For pregnancy-related `sexual_activity`, Event granularity is per gestational
subject: first identify all subjects with actual pregnancy-relevant exposure,
then emit one Event per subject. Each such Event has exactly one
`gestational_subject_ids` ID, at least one subject-local `counterpart_ids` source,
and a participant ID set exactly equal to subject plus counterparts. Same-subject
sources are merged into one Event; different subjects must remain separate even
when time, location, or type match. A response containing the same pregnancy
subject twice is rejected with `duplicate_gestational_subject_event`; no Runtime
or UI semantic merge is allowed.

The protected Prompt contract still consolidates immediate effects, directly
associated symptoms, observations, and evidence into the same subject's
`sexual_activity` Event. Independent `physical_symptom`, `medical_event`, or
other BiologicalEvents may coexist in one Floor. Ordinary care/supplements do
not become a `medical_event`, and static appearance/constitution text does not
become a `physical_symptom`.

After parsing, Runtime generates a deterministic canonical `event_id` from the
authoritative Floor Version and response ordinal, then binds the complete
authoritative `source`. The ordinal remains an identity compatibility detail and
keeps multiple Events in one response stable. Runtime calls
`validateEventCollection()` before saving; only this enriched collection is
normalized and validated as persisted `BiologicalEvent` Domain DTOs.
Identical duplicate `event_id` records are deterministically deduped; the same
ID with different normalized facts is a validation conflict and is never
resolved by input order or last-write-wins.

`sortEvents()` remains the existing provenance order used by Event/Tracking
flows. Story-time chronology uses the separate `sortEventsByStoryTime()` helper:
compatible structured domains sort by `day_index`; different or unresolved
domains use a deterministic domain/provenance fallback. `display`, Floor index,
message send time, and system clock are never Story Time arithmetic inputs.

### Runtime Character Identity Contract

#### 1. Scope / Trigger

This contract is required whenever an Event Analyzer returns a participant or a
pregnancy reference containing `character_id`, `mention_id`, display names,
aliases, or provisional identity status. It applies before Event/domain
validation, Floor persistence, Tracking rebuild, and Event CRUD writes.

#### 2. Signatures

- A successful Floor owner persists a cumulative `CharacterRegistry` snapshot in
  its exact `message.extra.bioweave` or
  `message.swipe_info[swipe_id].extra.bioweave` slot:
  `{schema_version: 1, entities: {[canonicalId]: {character_id, display_name, aliases[]}}}`.
  The enclosing successful analysis and complete six-field Floor Version bind
  its validity. Cumulative does not mean global authoritative ownership.
- Any `chatMetadata.bioweave.character_registry`, if retained for compatibility,
  is only a materialized projection/cache. It is not the registry owner, an
  independent historical source, or an Analyzer API input source.
- `identity_status` is one of `existing`, `new`, or `unresolved` in the raw
  participant DTO. `new` and `unresolved` require `character_id: null` and a
  response-local, opaque `mention_id`; `existing` requires an ID supplied by the
  Runtime registry input and has `mention_id: null`. A mention handle has no
  business meaning, is unique within the complete response, and must not be a
  display name, alias, role label, or canonical ID.
- `alias_candidate` is a proposal with `value`, `kind: name_variant | nickname`,
  optional `confidence`, and separate identity evidence. It is never a registry
  write command.

#### 3. Contracts

1. Registry entries are keyed only by canonical `character_id`. New IDs are
   generated by Runtime through its canonical allocator. The exact sequence is
   opaque and never derived from display names, pinyin, romanization, slugs, hashes, translations,
   initials, timestamps, UUIDs, or random values.
2. `display_name` may change and `aliases[]` may grow; neither is a primary key.
   Same display names, same-sounding names, and same aliases may belong to
   different IDs. Exact lookup returns the complete candidate ID set.
3. The request prompt contains a separate Runtime Canonical Character Registry
  block. `character_context` and profiles remain semantic evidence and cannot
  authorize an ID absent from the registry. When the registry is empty, the
  prompt is an Initial Registry Bootstrap: there are no valid `existing`
  participants; new or unresolved raw participants use `character_id: null` and
   opaque response-local handles. The prompt does not expose the formal ID
  format or sequence examples; the model does not need to know, predict, or emit
  a formal `character_id`, and Runtime assigns it after the response. The model
  MUST NOT use a name-shaped permanent ID or mention handle.
4. One complete AI response shares one response-local mention map. The production
   order is: `raw AI DTO -> response-global identity resolution/registration ->
   Runtime event_id/source -> strict Domain validation -> normalize -> Floor
   snapshot persistence -> Chat projection -> Tracking`.
   Raw provisional null IDs are therefore not passed to final participant-backed
   validation.

#### 4. Validation & Error Matrix

| Condition | Required behavior |
|-----------|-------------------|
| `existing` ID is not in the current canonical registry | Reject/downgrade with `unknown_existing_character_id`; do not write the string to Event or registry |
| `existing` ID is unknown but display/alias exact lookup returns one candidate | Reject the supplied value and canonicalize to the unique Registry `character_id` |
| `existing` ID is unknown and display/alias exact lookup returns zero candidates | Fail closed with `unknown_existing_character_id`; do not convert to `new` |
| `existing` ID is unknown and display/alias exact lookup returns multiple IDs | Fail closed with all candidates; never first-match-wins |
| Exact display/alias lookup returns multiple IDs without reliable context | Return `identity_unresolved` with all `candidate_ids`; never first-match-wins |
| `new` display/alias matches an existing entity | Treat display/alias as non-unique; without explicit `explicit_new_entity`-style evidence for a distinct person, return `identity_unresolved`; never auto-merge by the sole string match |
| `new` has no reliable existing match | Runtime creates the next sequential ID, registers it before the Event is saved, and backfills the current Event |
| `new` collides with multiple existing display/alias candidates | Return `identity_unresolved`; do not create or merge an entity |
| `unresolved` participant or reference remains unresolved | Abort the complete analysis batch; preserve the prior successful Floor result and do not persist registry, Event, or Tracking changes |
| Same raw mention handle resolves to different canonical IDs | Reject atomically with `raw_identity_conflict` |
| The same response-local `mention_id` appears in multiple Events | Reuse the one response-global canonical ID; never register a second entity |
| One response-local `mention_id` carries contradictory identity data | Reject atomically with `raw_identity_conflict` or the equivalent identity error |
| The Runtime canonical ID allocator is exhausted | Fail closed with `character_id_sequence_exhausted`; never wrap or use a random fallback |
| Raw participants repeat a canonical ID before canonicalization | Preserve/check the raw records; strict post-resolution validation rejects the duplicate instead of allowing a last-record-wins write |
| Alias candidate is empty, a duplicate, display name, pronoun, generic reference, title, or lacks explicit establishment evidence | Reject the candidate; do not modify aliases |
| Existing ID has explicit name-revelation evidence and a new display name | Update the same registry entry, retain the old stable display form as an alias, and never create/merge an ID |

#### 5. Good / Base / Bad Cases

- Good: a mention exactly matches one unique alias candidate, so it resolves to
  that canonical ID and no new ID is generated.
- Good: a first-appearance `new` participant receives the next
  Runtime sequential ID, the current Event uses it, and the next Analyzer input
  lists the same ID and accepted aliases.
- Good: a one-off narrative form of address may resolve for this Event, but
  without explicit alias-establishment evidence it creates no alias candidate
  and persists no alias.
- Good: explicit alias-establishment language may produce an alias candidate;
  Runtime validates and persists it separately.
- Good: two canonical characters share one alias; exact matching returns both,
  and only reliable narrative context can select one.
- Bad: `character_id = normalize(display_name)`, `registry[name] = character`,
  or a model-generated slug is written as a canonical ID.
- Bad: a single co-occurrence, continuity inference, title (`姐姐`), generic
  reference (`那个女孩`), or pronoun (`她`) is learned permanently as an alias.
- Bad: a supplied display name, UUID, timestamp, random token, or self-created
  non-six-digit `char_...` value is accepted as a new canonical ID.

#### 6. Tests Required

- Registry unit tests assert sequential ID generation, empty/sparse registries,
  upper-bound exhaustion, mutable display names, stable IDs, duplicate
  display/same-sounding/same-alias coexistence, and complete candidate sets.
- Identity unit tests assert existing/new/unresolved, membership rejection,
  response-local references, atomic conflict handling, new-identity re-check,
  nickname-only newcomers, explicit name revelation, no destructive merge, and
  unique existing display/alias fallback with fail-closed ambiguity.
- Alias tests separately assert mention resolution, alias discovery, and alias
  persistence; continuity/co-occurrence/high confidence alone must return no
  candidate, while explicit establishment evidence may be accepted by Runtime.
- Runtime tests assert new registration before pregnancy closure, current Event
  backfill, next-input registry visibility, unresolved batch rollback, strict
  hallucinated-ID rejection, alias collision behavior, raw duplicate rejection,
  and Chinese `location` preservation.
- Storage/runtime tests assert Chat projections default to an empty registry,
  Floor snapshots round-trip only
  through their exact message/Swipe owner, and deleting or invalidating that
  owner cannot restore its identities from Chat Metadata.

#### 7. Wrong vs Correct

```js
// Wrong: model text becomes a permanent identity and aliases learn from prose.
const characterId = slugify(participant.display_name)
registry[participant.display_name] = characterId
registry[characterId].aliases.push(participant.display_name)
```

```js
// Correct: Runtime takes candidates from the one provenance-checked previous
// Floor snapshot, then persists the result in the target Floor owner.
const previous = findPreviousSuccessfulBioWeave(target)
const resolved = resolveEventAnalysisIdentities(rawAnalysis, {
  registry: previous.character_registry,
  persistAliases: true,
})
if (!resolved.ok) throw new Error('EVENT_IDENTITY_RESOLUTION_FAILED')
```

```js
// Correct: final participant/reference validation only sees canonical IDs.
validateEventCollection(enrichedEvents, {
  strictCanonicalParticipants: true,
})
```

### Story Time date boundary

`parseCnDate(text, options?)` is a pure parser. It accepts Chinese numerals,
Chinese year/month/day forms, fixed month and festival aliases, numeric dates,
and formal month names from an injected custom calendar. Alias matching is
longest-first and dictionary-driven; era labels are captured from the input and
are never pre-registered. The parser preserves this precedence: input guards and
explicit year bounds, exact numeric dates, full Chinese year/date or
year/festival forms, open era-year forms, formal month names, fixed aliases, and
numeric month/date forms.

The parser returns `{month, day}` plus `year` and/or `eraLabel` when known, or
`null` for an unknown, out-of-range, or invalid date. Month/day validation uses
the injected calendar when present. Gregorian dates with a year also require
real leap-year validity; custom calendars do not pass through JavaScript `Date`.
`extractDayFromTime()` retains its existing relative-day and numeric-date keys,
then uses the same parser for the Chinese-date fallback.

Only the trusted SevenDaysCal-compatible provider adapter may turn a raw
provider/display-only value into structured date or time fields. Existing
structured fields (`normalized`, `date`, `iso_date`, `day_index`, and equivalent
aliases) are authoritative. Complete Gregorian dates become `YYYY-MM-DD` with
a strict UTC `day_index`; custom or era-labeled dates become
`cn-year-month-day` with `day_index: null`. When an explicit display-formatting
boundary is used (the trusted provider adapter or final Event normalization),
`parseCnDate()` may independently canonicalize only the reliable date portion
of `display`; it must preserve the trailing text and must not regenerate or
overwrite `normalized` or `day_index`. The local fallback provider and
`formatStoryTime()` never turn display text into structured date/time values.

Traditional time parsing is a separate pure component of that same boundary.
Its grammar is exactly `<earthly branch>时 [<number>刻]` (the traditional `時`
variant is accepted); the刻 part is optional and an omitted part means
`marks: 0`. When the part is present, its token is first passed through
`normalizeCnDateDigits()` and then `_cnToNumber()`, and only values from 1
through 8 are accepted. The start-hour table is the sole source for the twelve
branches: 子23, 丑1, 寅3, 卯5, 辰7, 巳9, 午11, 未13, 申15, 酉17, 戌19, 亥21.
The clock value is calculated as start minutes plus `marks * 15`, returning
`hour`, `minute`, and `dayOffset`; for example, the eighth刻 of 子时 is the
next day at 01:00.

For a trusted raw value containing both date and traditional time, the adapter
uses the parsed date to produce numeric `display` date text and appends the
original matched time substring. The source date remains the display date even
when `dayOffset` is non-zero; only `normalized` uses the shifted date key. A
pure traditional time normalizes to `HH:MM`; a date plus time normalizes to
`date-keyTHH:MM`. If a custom/era calendar cannot safely advance across its
boundary, the adapter keeps the display but returns `normalized: null` and never
invents an absolute `day_index`.

### Persisted BiologicalEvent

The complete Event `source` binds the Event to its owning Floor/Swipe according
to [Floor State Ownership](./floor-state.md).

Every persisted, accepted Domain Event has:

- `event_id`, `type`, and one of `confirmed`, `probable`, `ambiguous`,
  `negated`, or `fictional` statuses;
- structured `story_time` with `display`, `normalized`, `calendar_id`,
  `day_index`, `provider`, `precision`, and `confidence`;
- scalar `location` (`string | null`), `participants[]`,
  `pregnancy_relevance`, `source_evidence`, and a complete Floor/Swipe `source`;
- for `possible_conception: true`, `relevant: true`, non-empty
  participant-backed subject/source arrays, and a
  `source_evidence` item whose `kind` is
  `pregnancy_relevant_exposure`;
- participant capability keys that are each `true`, `false`, or `null`;
- `gestational_subject_ids[]` and `counterpart_ids[]`, never a scalar or a
  comma-delimited display string.

Every confirmed Event participant must undergo the same `biological_context`
analysis; it is not conditional on `pregnancy_relevance.relevant === true`.
The output object contains `species` and `biological_type`, each a string or
`null`, even for a non-pregnancy Event. `pregnancy_relevance` describes whether
the current Event concerns conception/pregnancy; participant biological facts
describe the person and must not be skipped, and a person's capability must not
make an otherwise unrelated Event pregnancy-relevant. The stable analysis order
is identity → Character Evidence → species → `biological_type` within that
species → exact persisted World Model species/type → baseline capability →
explicit individual capability evidence → final participant facts.

`species` comes from the participant's current World Model identity;
`biological_type` is the stable physiological/reproductive classification under
that species. The Analyzer may combine projected Character Card, Persona,
Worldbook, narrative, existing profile, stable setting, body/physiology/
reproductive facts, and multiple consistent context clues to map an object to
the current World Model. An explicit physiological-sex fact may be one piece
of evidence for mapping `biological_type`, but it does not by itself authorize
any capability. A name, title, event role, position, active/passive label,
social role, clothing, demeanor, or one appearance clue is never sufficient by
itself. Insufficient or conflicting evidence remains `null` and the recipient
remains pending rather than disappearing. No `gender` field is added.
Capability evaluation uses the current World Model baseline first, then
projected existing profile/Character Evidence and current narrative evidence;
explicit individual values may override or complete the baseline, while
unknown values remain `null`. Non-pregnancy Events therefore retain full
participant biological analysis, not merely optional context compatibility.

For `sexual_activity`, `counterpart_ids[]` is a subset of `participants[]`
containing only actual exposure source IDs. Whether an interaction is an actual
pregnancy-relevant exposure is determined by the current World Model,
species/type reproductive rules, and narrative evidence; no one real-world
species, gender, anatomy, behavior position, contact mode, or reproductive
mechanism is a universal requirement. A sexual activity with no
pregnancy-relevant exposure, if retained at all, has no participants, uses
`relevant: false`, `possible_conception: false`, and empty subject/source
arrays. `possible_conception` expresses potential relevance only, not actual
conception or pregnancy. Exposure/source evidence controls the Event.
`physical_effect.gestational_substance_intake`,
when present, is only `true`, `false`, or `null`; `true` requires the same
canonical exposure evidence marker.

`story_time.display` is for formatting only. Sorting and elapsed-time logic
must use `day_index` or another structured normalized value.

`location` is a natural-language `string | null`. Known locations retain the
original narrative/Target Floor/Recent Context/Worldbook text and language; no
translation, pinyin, romanization, snake_case, slug, or ASCII identifier is
allowed. Unknown locations remain `null`.

### Tracking registry

Tracking rebuild and orphan invalidation follow [Floor State Ownership](./floor-state.md);
the rules below define the Tracking projection shape and eligibility only.

This document owns the `BiologicalEvent` → Tracking boundary. A valid
pregnancy-relevant exposure Event is historical fact; it is not a Tracking
Window. The planned Window lifecycle, including expiration and multiple rounds,
is owned by [Pregnancy Exposure Tracking Lifecycle](./pregnancy-tracking.md).
Window closure must never delete, negate, or rewrite the Event or its
Floor/Swipe provenance.

An active subject stores only stable references and display/profile indexes:

```json
{
  "character_id": "<canonical_character_id>",
  "created_from_event_id": "evt_001",
  "exposure_event_ids": ["evt_001", "evt_008"],
  "status": "active"
}
```

The registry is rebuilt from currently active Floor-bound Events. Dangling
Event IDs are removed. Historical sanitized profile data may remain after the
active subject has no exposure, but it is not displayed as an active subject.
The rebuild first exhaustively collects every exposure recipient from the full
active Event collection, then resolves each recipient independently. It must
not stop at the current user/Persona, a current Character Card, an existing
profile, the first eligible recipient, or a false/unknown recipient.

`tracking_subjects` contains only recipients whose resolved
`can_carry_pregnancy` is `true`. A resolved `false` is `ineligible` and enters
neither active registry. A `null` or unresolved value is `pending` and is saved
in the separate `tracking_candidates` map with `character_id`, exposure Event
IDs, each original Event `story_time` and authoritative Floor/Swipe `source`,
resolved identity, capabilities, and evidence. Candidate records are rebuilt
and re-evaluated after trusted World Model/profile/narrative updates; a
transition to `eligible` keeps the original Event reference and a transition
to `ineligible` removes only the registry index, never the historical Event.

### UI boundary

Characters, Events, and Overview consume domain DTOs. UI code must not derive
eligibility or exposure from gender, participant labels, event roles,
protection, ejaculation, or physical effects. Ordinary Product UI renders only
user-readable business projections: Character exposure cards show time,
location, Event type/status, and one `相关对象` row mapped from
`counterpart_ids[]` against canonical Event participants. Ordinary Characters,
Events, and Overview markup does not render `event_id`, `character_id`,
`source`, Floor Version, hashes, Registry Summary, raw Event JSON, or other
provenance fields. Edit operations may retain necessary internal bindings, and
Settings Advanced/Debug may use the explicit host Popup. UI formatting may map
IDs to display names and format Story Time.

### Runtime coordinator

The Runtime owns Event Analysis independently of UI mount/open state. It binds
SillyTavern lifecycle events during `runtime.init()`, resolves stable
`message_id` before treating a numeric value as an array index, selects the
active Swipe, applies N-floor and Floor Version dedupe, calls the one production
analyzer, commits Floor-bound Events, and rebuilds the registry.

The coordinator keeps the in-flight execution and its `AbortController` in a
transient map keyed by the complete Floor Version. The controller signal is
passed through the analyzer to the shared `ChatCompletionService` transport.
Every success, failure, cancellation, stale-Chat exit, timeout, retry
exhaustion, save failure, and registry failure releases the in-flight entry and
controller and publishes a terminal status. A cancelled or stale late result
may not commit a Floor Event or rebuild the Registry.

For any target Floor N, Runtime selects `existing_bioweave` only from the
nearest valid successful Floor before N. The scan starts at the target message
index minus one, so the target's own saved `analysis` and `events` are never a
baseline, including during force/re-analysis. A candidate is usable only when
its saved `analysis.status` is `success`, its current authoritative version has
`version.floor < target.version.floor`, and
`sameFloorVersion(floorVersionFromData(candidateFloor), version)` is true.
Candidate Events must come from `getActiveFloorEvents(candidateIndex, version)`
so inactive Swipes and stale Event sources are excluded. If no candidate
passes, the normalized baseline is exactly `{analysis: null, events: []}`.
The ownership and API provenance boundary for this input is
[Floor State Ownership](./floor-state.md).
Successful analysis replaces the target Floor's `analysis/events` in its
existing storage slot; request failure, cancellation, or response/domain
validation failure must not pre-delete the previous successful target result.
Re-analyzing a historical Floor does not automatically invalidate or delete
later Floors.

`EventAnalysisBusinessDTO.analysis_status` contains `state`, `busy`,
`current_floor`, `floor_version`, `attempt`, `last_success`, `last_error`,
`event_count`, `active_event_count`, `sexual_activity_count`,
`tracking_subject_count`, `tracking_candidate_count`, `current_floor_events`,
`active_events`, `tracking_decisions`, and `registry_summary`. Current-Floor
counts and Chat-wide active counts are distinct. `tracking_decisions` exposes
the same three-state `eligibility` contract as Core; pending is never rendered
as confirmed eligible. Raw AI responses, request bodies, headers, and secrets
are not persisted for diagnostics. `running` is transient execution state, not
a persisted historical result. Terminal diagnostics expose `error_stage`,
`error_code`, `safe_error_summary`, `started_at`, and `finished_at`; a failed
force refresh keeps `last_success` and its valid Events. `cancelled` uses
`REQUEST_ABORTED` and is informational rather than an API/schema failure.

## 4. Validation & Error Matrix

| Condition | Required behavior |
|-----------|-------------------|
| Natural language, fenced JSON, or non-object analyzer response | `EVENT_ANALYSIS_INVALID`; write no new result |
| Missing required fixed-envelope field | `EVENT_ANALYSIS_INVALID`; write no partial Event |
| Legacy top-level `source`, or event-level `event_id`/`source` | Ignore those compatibility fields; Runtime still owns identity and provenance |
| Arbitrary unknown top-level field | Reject with `unexpected_top_level_field` and a safe JSON path |
| Invalid event role, conception flag, evidence shape, or participant reference | Reject with a specific diagnostic code and safe JSON path |
| AI response contains multiple legal Events for one Target Floor Version | Accept 0/1/N; preserve each Event and do not merge |
| Pregnancy `sexual_activity` Event has zero or multiple gestational subjects | Reject with `invalid_gestational_subject_cardinality` |
| Same Floor response repeats a pregnancy gestational subject | Reject with `duplicate_gestational_subject_event`; do not runtime-merge |
| Pregnancy Event participants are not exactly subject plus actual counterparts, or counterpart overlaps subject | Reject with subject-local structure diagnostics |
| Pregnancy `sexual_activity` participant lacks `biological_context`, lacks `species`/`biological_type`, or uses a non-string/non-null value | Reject with `invalid_biological_context` and a safe participant context path |
| Scalar `counterpart_ids` or `gestational_subject_ids` | Reject; do not coerce names or comma-delimited text |
| `relevant: true` without direct pregnancy-relevant exposure marker, non-empty subject/source IDs, or participant membership | Reject before Floor save; no partial Event or Registry update |
| `sexual_activity` has no actual exposure but keeps participants, relevance, or subject/source IDs | Reject; represent it as unrelated with no participants and both ID arrays empty |
| Invalid `physical_effect.gestational_substance_intake` shape | Reject with a safe field path; only boolean/null is accepted |
| Incomplete or mismatched Floor Version source | Bind to the authoritative version or reject before storage; stale Events are inactive |
| `can_carry_pregnancy: true` | Create an active Tracking Subject |
| `can_carry_pregnancy: false` | Keep the recipient out of active subjects and pending candidates |
| `can_carry_pregnancy: null` or unresolved identity/capability | Persist a `pending` tracking candidate; do not create a Subject |
| Any Event without `relevant === true` and a valid pregnancy-relevant exposure fact | Create zero Tracking Subjects |
| Floor deletion or inactive Swipe | Event is absent from active reads; rebuild removes dangling references |
| Analysis failure after prior success | Keep the prior successful Events and record the failed attempt |
| Analysis is cancelled or the Chat becomes stale | Release execution resources; preserve the previous success and ignore late results |
| Successful current Floor, non-force request | Skip without another AI call |
| Manual force succeeds | Replace that Floor Version's prior successful Events |
| Manual force fails | Record `failed`/`last_error`; keep prior successful Events active |
| Lifecycle payload has a stable message ID | Resolve by message identity before numeric array index |
| UI mount/open/reopen | Read Runtime DTO only; never request Event Analysis |
| Chinese date uses an unknown or invalid alias/date | Return `null`; do not manufacture a normalized date |
| A longer month/festival alias overlaps a shorter alias | Match the longest dictionary entry first |
| Custom era label appears without prior registration | Capture the label from input and keep the canonical date era-scoped |
| Structured Story Time fields are present | Preserve `normalized`/`day_index` and independently format only a reliably parsed display date when the explicit formatting boundary allows it |
| Trusted provider or final narrative Event normalization receives a parseable display date | Canonicalize only the date portion; preserve arbitrary trailing text and every structured field |
| Fallback provider or `formatStoryTime()` receives display text | Keep the conservative display-only behavior; do not create structured date/time values |
| Custom/era date has no Gregorian absolute day | Keep `day_index: null`; sorting/calculation must not invent one |
| Traditional time has no刻 part | Accept it with `marks: 0` and hour precision |
| Traditional time has刻 `0`, greater than `8`, or an unconvertible token | Return `null`; provider keeps the value conservative and does not fall back to date-only |
| Traditional time token is missing `时`/`時` or has trailing text | Reject the partial match |
| Traditional time crosses midnight | Shift only the internal normalized date when the calendar can prove the next date; keep display tied to the source date |

## 5. Good / Base / Bad Cases

- Good: one sexual Event has a direct gestational subject, one or more actual
  source IDs, and the canonical exposure evidence marker; one subject
  references that Event.
- Good: interactions that do not satisfy the current World Model's effective
  reproductive path remain unrelated Events with empty relevance IDs; an
  interaction supported by the current species/type rules and narrative
  evidence retains only its actual source IDs.
- Good: one Floor response emits two subject-local sexual Events for two explicit
  gestational subjects; each Registry subject references only its own Event and
  counterpart sources remain local to that Event.
- Good: one subject with two or more actual exposure sources uses one Event whose
  `counterpart_ids[]` contains all actual sources; a sexual participant without
  actual exposure is absent from `participants[]`.
- Good: the overlay is never opened; `MESSAGE_RECEIVED` reaches the Runtime
  coordinator and performs interval-eligible analysis.
- Base: a non-sexual BiologicalEvent passes the same envelope and remains
  available to the shared Event system without creating a subject.
- Base: unknown capability stays `null`, is persisted as a `pending` candidate
  when an exposure exists, and is never shown as confirmed eligible.
- Good: `霜月初七`, `中秋节`, and an unregistered era label resolve through the
  shared alias/parser path; the sample labels are test data, not production
  branches.
- Base: a valid Gregorian date receives a strict UTC `day_index`; a valid custom
  or era date keeps a canonical `cn-*` normalized value without an invented
  absolute index.
- Good: all twelve branch names use the one start-hour table; pure times use
  `marks: 0`, and numeric marks in Chinese, Arabic, full-width, or financial
  forms share the existing number conversion functions.
- Good: a date with a traditional time keeps the original time spelling in
  `display`, while `normalized` uses modern `HH:MM`; an eighth 子时刻 advances
  only the normalized date.
- Bad: a participant is made eligible because their gender or UI label says
  receiver/攻/受.
- Bad: a UI card copies an entire Event or uses `partner: "B,C"`.
- Bad: `formatStoryTime()` or the fallback provider creates structured values
  from display text, a display formatter overwrites authoritative structured
  fields, or production code special-cases an era name from a fixture.
- Bad: a missing `时`/`時`, invalid刻 count, or trailing fragment is accepted as
  a shorter valid time or silently reduced to a date-only value.
- Bad: `ui/app.js` builds Event analysis input, validates Event source, or
  rebuilds Tracking Registry after rendering.

## 6. Tests Required

- Parser assertions for fixed AI envelopes, one-Floor 0/1/N cardinality, per-subject pregnancy grouping, duplicate-subject rejection, all existing Event types, strict
  JSON, array-only references, canonical evidence, typed physical effects,
  diagnostic paths, and ignoring legacy identity/source fields.
- Domain assertions for actual-exposure consistency, one-subject pregnancy
  cardinality, 0/1/N source IDs, participant-backed references, no-exposure sexual Events, collection duplicate-subject rejection, and the
  `pregnancy_relevant_exposure` evidence marker.
- Runtime assertions that every successful AI response receives a generated
  canonical Event ID and authoritative source before Floor save; model-provided
  identity/provenance never survives as persisted identity.
- Character identity assertions for Floor-owned cumulative snapshots,
  Runtime-sequential ID generation, empty/sparse registries, sequence exhaustion,
  existing/new/unresolved resolution, unique display/alias fallback, full exact
  candidate sets, alias establishment evidence, no automatic continuity alias
  learning, alias collision unresolved behavior, name-revelation updates, and
  strict hallucinated-ID rejection.
- Raw-to-canonical ordering assertions that a new participant is registered and
  its mention/reference handles are converted before pregnancy participant
  closure and collection validation.
- Tracking assertions for zero/one/multiple subjects, repeated exposures,
  unknown capability, no exposure, dangling cleanup, and gender independence.
- Storage/runtime assertions for Floor deletion, Swipe switching, object-indexed
  and array-indexed `swipe_info`, and stale Chat guards.
- UI assertions that lists consume registry/Event DTOs, preserve empty states,
  and never infer eligibility.
- Scheduling assertions for Floor Version deduplication, manual replacement,
  and failed-refresh preservation.
- Runtime input assertions that the nearest previous successful current-version
  Floor supplies `existing_bioweave` and its own `character_registry` snapshot,
  no prior valid Floor yields an empty previous bundle, stale candidates are
  skipped, the target Floor never self-references, repeated force analysis
  replaces rather than accumulates its Events or identity snapshot, and the
  final Prompt/request contains no deleted or Chat-only identity.
- Runtime integration assertions that lifecycle analysis requires no UI
  subscriber, UI reopen causes no AI call, stable message IDs and active Swipes
  select the correct Floor Version, and status DTOs distinguish zero Events
  from no analysis.
- Diagnostic assertions that `eligibleGestationalSubjects()` and
  `explainTrackingDecision()` share the same decision path, while unknown
  carrying capability is `pending` and never enters the eligible selector.
- Date assertions for all fixed month aliases and festival aliases, longest
  matching, Chinese numerals, full Chinese year/month/day forms, open era labels,
  formal custom month names, invalid Gregorian/custom dates, relative-day
  compatibility, and the three representative fixture strings.
- Story Time assertions for structured-field precedence, trusted-provider parsing,
  independent display date formatting for narrative/provider values with
  arbitrary trailing text, unchanged normalized fields, Gregorian day-index
  generation, `cn-*` custom/era normalization, and the conservative
  fallback/formatter behavior.
- Traditional-time assertions for all twelve start hours, optional刻 semantics,
  shared numeric conversion, 1/3/8刻 variants, invalid and partial matches,
  modern `HH:MM` normalization, original display spelling, and Gregorian/custom
  midnight rollover.

## 7. Wrong vs Correct

### Wrong

```js
if (participant.event_role === 'receiver') {
  createCharacterCard(participant);
}
```

### Correct

```js
const registry = rebuildTrackingRegistry(activeEvents, chat);
renderCharacters(registry.tracking_subjects);
```

```js
// Wrong: UI owns production analysis and business persistence.
await analyzer.analyzeFloor(buildEventAnalysisInput(uiState));

// Correct: UI invokes the Runtime coordinator and renders its DTO.
await runtime.refreshCurrentFloorAnalysis();
render(await runtime.collectActiveBusinessData());
```

```js
// Wrong: feed the target Floor's old result back into its own prompt.
existingBioWeave: {
  analysis: target.floorData?.analysis ?? null,
  events: target.floorData?.events ?? [],
}

// Correct: use the nearest earlier candidate that still matches its current
// six-field Floor Version, or the empty baseline when none is valid.
const previous = await findPreviousSuccessfulBioWeave(target);
chat.assert(token);
existingBioWeave: previous;
```

```js
// Wrong: every consumer invents its own date parser or reparses display text.
const normalized = parseDate(storyTime.display);

// Correct: parse once at the trusted provider boundary and consume structure.
const provider = createSevenDaysCalProvider(publicProvider);
const storyTime = provider.getCurrentTime();
const dayIndex = storyTime.day_index;
```

```js
// Wrong: invent a second parser or use the display as a calculation input.
const minutes = parseInt(storyTime.display.replace(/\D/g, ''), 10);

// Correct: the trusted boundary owns parsing; consumers use normalized fields.
const time = parseTraditionalTime(rawProviderValue);
const normalized = time ? `${time.hour}:${String(time.minute).padStart(2, '0')}` : null;
```

Eligibility belongs to the validated Event plus World Model and narrative
evidence. Rendering only consumes the resulting registry.
