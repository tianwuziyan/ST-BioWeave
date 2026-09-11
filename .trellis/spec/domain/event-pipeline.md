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
- `parseEventAnalysisResponse(raw, authoritativeFloorVersion) -> {schema_version, events}`
- `normalizeEvent(raw) -> BiologicalEvent`
- `validateEvent(event) -> {ok, errors}`
- `rebuildTrackingRegistry(events, previousChat) -> {tracking_subjects, character_profiles}`
- `getActiveFloorEvents(floorData, floorVersion) -> BiologicalEvent[]`

`authoritativeFloorVersion` contains exactly these binding fields:
`chat_id`, `message_id`, `floor`, `swipe_id`, `content_hash`, and
`message_version`.

## 3. Contracts

### Input

`EventAnalysisInput` contains `chat_scope`, `floor_version`, `current_floor`,
`recent_context`, `world_model`, `story_time`, and `character_context`.
The input boundary is text-oriented and removes secret-like keys before prompt
construction. The analyzer receives a fixed JSON-only output contract.

### BiologicalEvent

Every accepted analyzer event has:

- `event_id`, `type`, and one of `confirmed`, `probable`, `ambiguous`,
  `negated`, or `fictional` statuses;
- structured `story_time` with `display`, `normalized`, `calendar_id`,
  `day_index`, `provider`, `precision`, and `confidence`;
- `location`, `participants[]`, `pregnancy_relevance`, `source_evidence`,
  and a complete Floor/Swipe `source`;
- participant capability keys that are each `true`, `false`, or `null`;
- `gestational_subject_ids[]` and `counterpart_ids[]`, never a scalar or a
  comma-delimited display string.

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
eligibility from gender, participant labels, or event roles. UI formatting may
map IDs to display names and format Story Time.

## 4. Validation & Error Matrix

| Condition | Required behavior |
|-----------|-------------------|
| Natural language, fenced JSON, or non-object analyzer response | `EVENT_ANALYSIS_INVALID`; write no new result |
| Missing required fixed-envelope field | `EVENT_ANALYSIS_INVALID`; write no partial Event |
| Scalar `counterpart_ids` or `gestational_subject_ids` | Reject; do not coerce names or comma-delimited text |
| Incomplete or mismatched Floor Version source | Bind to the authoritative version or reject before storage; stale Events are inactive |
| `can_carry_pregnancy: null` | Never create a Tracking Subject |
| NSFW without `relevant === true` and `possible_conception === true` | Create zero Tracking Subjects |
| Floor deletion or inactive Swipe | Event is absent from active reads; rebuild removes dangling references |
| Analysis failure after prior success | Keep the prior successful Events and record the failed attempt |

## 5. Good / Base / Bad Cases

- Good: one sexual Event has one participant with explicit carrying
  capability and one or more counterpart IDs; one subject references that
  Event.
- Good: one Event names two explicit gestational subjects; the registry has
  two subjects, while a conception source remains absent from Characters.
- Base: a non-sexual BiologicalEvent passes the same envelope and remains
  available to the shared Event system without creating a subject.
- Base: unknown capability stays `null` and is shown as unknown where exposed.
- Bad: a participant is made eligible because their gender or UI label says
  receiver/攻/受.
- Bad: a UI card copies an entire Event or uses `partner: "B,C"`.

## 6. Tests Required

- Parser assertions for fixed envelopes, all existing Event types, strict JSON,
  array-only references, and authoritative source binding.
- Tracking assertions for zero/one/multiple subjects, repeated exposures,
  unknown capability, no exposure, dangling cleanup, and gender independence.
- Storage/runtime assertions for Floor deletion, Swipe switching, object-indexed
  and array-indexed `swipe_info`, and stale Chat guards.
- UI assertions that lists consume registry/Event DTOs, preserve empty states,
  and never infer eligibility.
- Scheduling assertions for Floor Version deduplication, manual replacement,
  and failed-refresh preservation.

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

Eligibility belongs to the validated Event plus World Model and narrative
evidence. Rendering only consumes the resulting registry.
