# BiologicalEvent Pipeline Contract

## 1. Scope / Trigger

This contract applies when narrative analysis produces or consumes a
`BiologicalEvent`, especially `sexual_activity`, and when the result updates
the Pregnancy Tracking Subject registry.

The source of truth is the validated Event stored in the producing Floor or
active Swipe. The registry stores stable references to Event IDs and never
duplicates the Event fact.

## 2. Signatures

- `buildEventAnalysisInput(options) -> EventAnalysisInput`
- `parseEventAnalysisResponse(raw) -> AIEventAnalysisDTO`
- `normalizeEvent(raw) -> BiologicalEvent`
- `validateEvent(event) -> {ok, errors}`
- `validateEventCollection(events) -> {ok, errors}`
- `rebuildTrackingRegistry(events, previousChat) -> {tracking_subjects, character_profiles}`
- `explainTrackingDecision(event) -> Array<{character_id, eligible, reasons[]}>`
- `getActiveFloorEvents(floorData, floorVersion) -> BiologicalEvent[]`
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
`recent_context`, `world_model`, `story_time`, `character_context`, a sanitized
`persona`, and optional existing BioWeave context.
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

Every persisted, accepted Domain Event has:

- `event_id`, `type`, and one of `confirmed`, `probable`, `ambiguous`,
  `negated`, or `fictional` statuses;
- structured `story_time` with `display`, `normalized`, `calendar_id`,
  `day_index`, `provider`, `precision`, and `confidence`;
- `location`, `participants[]`, `pregnancy_relevance`, `source_evidence`,
  and a complete Floor/Swipe `source`;
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
that species. Missing evidence uses `null`; no `gender` field is added and no
identity or capability is inferred from event role, position, active/passive
labels, name, or appearance. Capability evaluation first uses the current World
Model, existing character profile, and Character/Worldbook/current narrative
evidence. Without direct character evidence, unknown capabilities remain
`null`. Non-pregnancy Events retain the existing optional participant context
compatibility.

For `sexual_activity`, `counterpart_ids[]` is a subset of `participants[]`
containing only actual exposure source IDs. A sexual activity with no
conception-relevant exposure, if retained at all, has no participants, uses
`relevant: false`, `possible_conception: false`, and empty subject/source
arrays. A valid barrier with no exposure, external/no-path outcome,
insertion-only, and contact-only cases follow that shape. Barrier/protection
actions are evidence; the final actual exposure outcome controls the Event.
`physical_effect.gestational_substance_intake`,
when present, is only `true`, `false`, or `null`; `true` requires the same
canonical exposure evidence marker.

`story_time.display` is for formatting only. Sorting and elapsed-time logic
must use `day_index` or another structured normalized value.

### Tracking registry

An active subject stores only stable references and display/profile indexes:

```json
{
  "character_id": "char_A",
  "created_from_event_id": "evt_001",
  "exposure_event_ids": ["evt_001", "evt_008"],
  "status": "active"
}
```

The registry is rebuilt from currently active Floor-bound Events. Dangling
Event IDs are removed. Historical sanitized profile data may remain after the
active subject has no exposure, but it is not displayed as an active subject.

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
Successful analysis replaces the target Floor's `analysis/events` in its
existing storage slot; request failure, cancellation, or response/domain
validation failure must not pre-delete the previous successful target result.
Re-analyzing a historical Floor does not automatically invalidate or delete
later Floors.

`EventAnalysisBusinessDTO.analysis_status` contains `state`, `busy`,
`current_floor`, `floor_version`, `attempt`, `last_success`, `last_error`,
`event_count`, `active_event_count`, `sexual_activity_count`,
`tracking_subject_count`, `current_floor_events`, `active_events`,
`tracking_decisions`, and `registry_summary`. Current-Floor counts and Chat-wide
active counts are distinct. Raw AI responses, request bodies, headers, and
secrets are not persisted for diagnostics. `running` is transient execution
state, not a persisted historical result. Terminal diagnostics expose
`error_stage`, `error_code`, `safe_error_summary`, `started_at`, and
`finished_at`; a failed force refresh keeps `last_success` and its valid
Events. `cancelled` uses `REQUEST_ABORTED` and is informational rather than an
API/schema failure.

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
| `can_carry_pregnancy: null` | Never create a Tracking Subject |
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
- Good: intact barrier, external/no-path outcome, insertion-only, and
  contact-only cases remain valid unrelated Events with empty relevance IDs;
  barrier failure/removal that reaches a valid exposure path retains only the
  actual source IDs.
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
- Base: unknown capability stays `null` and is shown as unknown where exposed.
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
- Tracking assertions for zero/one/multiple subjects, repeated exposures,
  unknown capability, no exposure, dangling cleanup, and gender independence.
- Storage/runtime assertions for Floor deletion, Swipe switching, object-indexed
  and array-indexed `swipe_info`, and stale Chat guards.
- UI assertions that lists consume registry/Event DTOs, preserve empty states,
  and never infer eligibility.
- Scheduling assertions for Floor Version deduplication, manual replacement,
  and failed-refresh preservation.
- Runtime input assertions that the nearest previous successful current-version
  Floor supplies `existing_bioweave`, no prior valid Floor yields
  `{analysis: null, events: []}`, stale candidates are skipped, the target
  Floor never self-references, and repeated force analysis replaces rather than
  accumulates its Events.
- Runtime integration assertions that lifecycle analysis requires no UI
  subscriber, UI reopen causes no AI call, stable message IDs and active Swipes
  select the correct Floor Version, and status DTOs distinguish zero Events
  from no analysis.
- Diagnostic assertions that `eligibleGestationalSubjects()` and
  `explainTrackingDecision()` share the same decision path and unknown carrying
  capability remains ineligible.
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
