# BiologicalEvent Pipeline Contract

## 1. Scope / Trigger

This contract applies when narrative analysis produces or consumes a
`BiologicalEvent`, especially `sexual_activity`, and when the result updates
the Pregnancy Tracking Subject registry.

The source of truth is the validated Event stored in the producing Floor or
active Swipe. The registry stores stable references to Event IDs and never
duplicates the Event fact.

Floor/active-Swipe ownership, lifecycle invalidation, previous resolution, and
provenance are defined by [Floor State Ownership](./floor-state.md). This
document owns the BiologicalEvent contract and only points to that shared
boundary.

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

### AI DTO / Domain DTO boundary

`AIEventAnalysisDTO` has only `schema_version: 1` and `events[]` at the top
level, and Event Analysis V1 accepts `events.length >= 0` for one Target Floor
Version. A legacy top-level `source` may be present and is ignored; any other
unknown top-level field is rejected. An AI event does not require or trust
`event_id` or `source`; legacy copies of those fields inside an event are
ignored. Each accepted AI event contains biological facts such as `type`,
`status`, structured `story_time`, `location`, directly relevant
`participants`, `pregnancy_relevance`, `source_evidence`, and optional
`physical_effect`. For `sexual_activity`, participants are only the direct
members of the actual reproductive exposure chain; other Event types retain
only objects directly relevant to that biological fact.

For pregnancy-related `sexual_activity`, Event granularity is per gestational
subject: first identify all subjects with actual conception-relevant exposure,
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
- `chatMetadata.bioweave.character_registry`, if retained, is only a
  materialized projection/cache. It is not an independent historical source
  for Analyzer API input.
- `identity_status` is one of `existing`, `new`, or `unresolved` in the raw
  participant DTO. `new` and `unresolved` require `character_id: null` and a
  response-local `mention_id`; `existing` requires an ID supplied by the
  Runtime registry input.
- `alias_candidate` is a proposal with `value`, `kind: name_variant | nickname`,
  optional `confidence`, and separate identity evidence. It is never a registry
  write command.

#### 3. Contracts

1. Registry entries are keyed only by canonical `character_id`. New IDs are
   generated by Runtime in the exact form `char_` plus six decimal digits,
   from `char_000001` through `char_999999`. The sequence is opaque and never
   derived from display names, pinyin, romanization, slugs, hashes, translations,
   initials, timestamps, UUIDs, or random values.
2. `display_name` may change and `aliases[]` may grow; neither is a primary key.
   Same display names, same-sounding names, and same aliases may belong to
   different IDs. Exact lookup returns the complete candidate ID set.
3. The request prompt contains a separate Runtime Canonical Character Registry
   block. `character_context` and profiles remain semantic evidence and cannot
   authorize an ID absent from the registry.
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
| No sequence is available after `char_999999` | Fail closed with `character_id_sequence_exhausted`; never wrap or use a random fallback |
| Raw participants repeat a canonical ID before canonicalization | Preserve/check the raw records; strict post-resolution validation rejects the duplicate instead of allowing a last-record-wins write |
| Alias candidate is empty, a duplicate, display name, pronoun, generic reference, title, or lacks explicit establishment evidence | Reject the candidate; do not modify aliases |
| Existing ID has explicit name-revelation evidence and a new display name | Update the same registry entry, retain the old stable display form as an alias, and never create/merge an ID |

#### 5. Good / Base / Bad Cases

- Good: `霁棱` exactly matches the unique alias of `char_000001`, so the mention
  resolves to `char_000001` and no new ID is generated.
- Good: `曜柘` with an explicit first-appearance `new` status receives the next
  Runtime sequential ID, the current Event uses it, and the next Analyzer input
  lists the same ID and accepted aliases.
- Good: `“沈祁鸢坐在窗边。鸢儿随后起身。”` may resolve the second mention for
  this Event, but without explicit alias-establishment evidence it creates no
  alias candidate and persists no alias.
- Good: `“以后叫我鸢儿”“小名是鸢儿”“众人都称她为鸢儿”` may produce an
  alias candidate; Runtime validates and persists it separately.
- Good: `char_000001` and `char_000002` both have `澄砾`; exact matching returns both,
  and only reliable narrative context can select one.
- Bad: `character_id = normalize(display_name)`, `registry[name] = character`,
  or `shen_qi_yuan` returned by a model is written as a canonical ID.
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
  `conception_relevant_exposure`;
- participant capability keys that are each `true`, `false`, or `null`;
- `gestational_subject_ids[]` and `counterpart_ids[]`, never a scalar or a
  comma-delimited display string.

For a pregnancy-related `sexual_activity` AI participant, `biological_context`
is required and must contain `species` and `biological_type`, each a string or
`null`. `species` comes from the participant's current World Model identity;
`biological_type` is the stable physiological/reproductive classification under
that species. The Analyzer may combine Character Card, Persona, Worldbook,
narrative, existing profile, stable setting, body/physiology/reproductive facts,
and multiple consistent context clues to map an object to the current World
Model. An explicit physiological-sex fact may be one piece of evidence for
mapping `biological_type`, but it does not by itself authorize any capability.
A name, title, event role, position, active/passive label, social role,
clothing, demeanor, or one appearance clue is never sufficient by itself.
Insufficient or conflicting evidence remains `null` and the recipient remains
pending rather than disappearing. No `gender` field is added. Capability
evaluation uses the current World Model baseline first, then existing profile
and individual Character/Persona/Worldbook/current narrative evidence; explicit
individual values may override or complete the baseline, while unknown values
remain `null`. Non-pregnancy Events retain the existing optional participant
context compatibility.

For `sexual_activity`, `counterpart_ids[]` is a subset of `participants[]`
containing only actual exposure source IDs. Whether an interaction is an actual
pregnancy-relevant exposure is determined by the current World Model,
species/type reproductive rules, and narrative evidence; no one real-world
species, gender, anatomy, behavior position, contact mode, or reproductive
mechanism is a universal requirement. A sexual activity with no
conception-relevant exposure, if retained at all, has no participants, uses
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

An active subject stores only stable references and display/profile indexes:

```json
{
  "character_id": "char_000001",
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
| `possible_conception: true` without direct exposure marker, non-empty subject/source IDs, or participant membership | Reject before Floor save; no partial Event or Registry update |
| `sexual_activity` has no actual exposure but keeps participants, relevance, or subject/source IDs | Reject; represent it as unrelated with no participants and both ID arrays empty |
| Invalid `physical_effect.gestational_substance_intake` shape | Reject with a safe field path; only boolean/null is accepted |
| Incomplete or mismatched Floor Version source | Bind to the authoritative version or reject before storage; stale Events are inactive |
| `can_carry_pregnancy: true` | Create an active Tracking Subject |
| `can_carry_pregnancy: false` | Keep the recipient out of active subjects and pending candidates |
| `can_carry_pregnancy: null` or unresolved identity/capability | Persist a `pending` tracking candidate; do not create a Subject |
| NSFW without `relevant === true` and `possible_conception === true` | Create zero Tracking Subjects |
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
  `conception_relevant_exposure` evidence marker.
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
