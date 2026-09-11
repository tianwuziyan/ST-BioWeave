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
level, and Event Analysis V1 accepts only `events.length === 0` or
`events.length === 1` for one Target Floor Version. A legacy top-level `source`
may be present and is ignored; any other unknown top-level field is rejected.
An AI event does not require or trust `event_id` or `source`; legacy copies of
those fields inside an event are ignored. Each accepted AI event contains biological facts such as `type`,
`status`, structured `story_time`, `location`, directly relevant
`participants`, `pregnancy_relevance`, `source_evidence`, and optional
`physical_effect`. For `sexual_activity`, participants are only the direct
members of the actual reproductive exposure chain; other Event types retain
only objects directly relevant to that biological fact.

The protected Prompt contract selects one primary Event for the Floor and
consolidates immediate effects, directly associated symptoms, observations, and
evidence into it. Pregnancy-relevant sexual exposure takes priority as a
`sexual_activity` primary type. Ordinary care/supplements do not become a
`medical_event`, and static appearance/constitution text does not become a
`physical_symptom`. A response with more than one Event is rejected with the
stable `multiple_events_not_allowed` diagnostic before Runtime enrichment; no
Runtime or UI semantic merge is allowed.

After parsing, Runtime generates a deterministic canonical `event_id` from the
authoritative Floor Version and response ordinal, then binds the complete
authoritative `source`. The ordinal remains an identity compatibility detail;
new analysis for one Floor Version still persists at most one Event. Only this
enriched object is normalized and validated as the persisted `BiologicalEvent`
Domain DTO.

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
| AI response contains more than one Event for one Target Floor Version | Reject with `multiple_events_not_allowed` at `$.events`; write no new result and do not merge |
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

## 5. Good / Base / Bad Cases

- Good: one sexual Event has a direct gestational subject, one or more actual
  source IDs, and the canonical exposure evidence marker; one subject
  references that Event.
- Good: intact barrier, external/no-path outcome, insertion-only, and
  contact-only cases remain valid unrelated Events with empty relevance IDs;
  barrier failure/removal that reaches a valid exposure path retains only the
  actual source IDs.
- Good: one Event names two explicit gestational subjects; the registry has
  two subjects, while a conception source remains absent from Characters.
- Good: the overlay is never opened; `MESSAGE_RECEIVED` reaches the Runtime
  coordinator and performs interval-eligible analysis.
- Base: a non-sexual BiologicalEvent passes the same envelope and remains
  available to the shared Event system without creating a subject.
- Base: unknown capability stays `null` and is shown as unknown where exposed.
- Bad: a participant is made eligible because their gender or UI label says
  receiver/攻/受.
- Bad: a UI card copies an entire Event or uses `partner: "B,C"`.
- Bad: `ui/app.js` builds Event analysis input, validates Event source, or
  rebuilds Tracking Registry after rendering.

## 6. Tests Required

- Parser assertions for fixed AI envelopes, one-Floor 0/1 cardinality, all existing Event types, strict
  JSON, array-only references, canonical evidence, typed physical effects,
  diagnostic paths, and ignoring legacy identity/source fields.
- Domain assertions for actual-exposure consistency, 0/1/N source IDs,
  participant-backed references, no-exposure sexual Events, and the
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
- Runtime integration assertions that lifecycle analysis requires no UI
  subscriber, UI reopen causes no AI call, stable message IDs and active Swipes
  select the correct Floor Version, and status DTOs distinguish zero Events
  from no analysis.
- Diagnostic assertions that `eligibleGestationalSubjects()` and
  `explainTrackingDecision()` share the same decision path and unknown carrying
  capability remains ineligible.

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

Eligibility belongs to the validated Event plus World Model and narrative
evidence. Rendering only consumes the resulting registry.
