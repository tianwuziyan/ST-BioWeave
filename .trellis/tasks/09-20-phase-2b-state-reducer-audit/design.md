# Wave 0 Technical Design

## Stable fact envelope

Use one optional domain envelope for state-changing Events only:

```js
state_fact: {
  subject_id: canonicalCharacterId,
  effective_story_time: normalizedStoryTime,
  payload: typeSpecificPayload
}
```

`effective_story_time` must be the normalized Event `story_time` rather than a duplicated independent date. The envelope is absent for non-state-changing Events such as non-exposure `sexual_activity`; valid pregnancy-relevant exposure continues to use the existing `pregnancy_relevance` contract as its authoritative fact.

## Type-specific payload direction

- `conception`: explicit `conception_id`; no pregnancy ID is required unless the fact explicitly binds one.
- `pregnancy_suspicion`: optional explicit `pregnancy_id`, plus a non-empty factual observation record.
- `pregnancy_confirmation`: explicit `pregnancy_id`.
- `pregnancy_loss` / `abortion`: explicit `pregnancy_id`.
- `labor`: explicit `pregnancy_id` and `labor_id`.
- `delivery`: explicit `pregnancy_id` and `delivery_id`.
- `postpartum`: explicit `pregnancy_id` and a factual postpartum payload/identity.
- `menstrual_event` / `ovulation_event`: explicit cycle-related factual payload; no pregnancy ID.
- `fertility_change`: `capability_changes` with existing six capability keys only, each `true | false | null`.
- `physical_symptom`: explicit factual symptom payload; no probability/timing projection.
- `medical_event`: explicit factual medical payload.
- `other_biological`: explicit factual category/payload; otherwise reject as underspecified.

Exact fields must be enforced by the Domain validator. Generic participant position, display name, gender, or event role cannot satisfy `subject_id`.

## Episode identity

Use `pregnancy_id` only for pregnancy episodes. The Event analysis/runtime boundary should deterministically derive missing generated IDs from the authoritative Floor Version, Event ordinal, canonical subject identity, and event type. No random/clock/UUID source is allowed. The same pregnancy episode must be explicitly referenced by confirmation, loss, abortion, labor, delivery, and postpartum facts. `conception_id` is not mandatory for every pregnancy; add it only when the story explicitly distinguishes a conception fact that must be linked later.

## Status contract

Event `type` and `status` remain independent. `confirmed` is eligible as a factual transition candidate; `probable` and `ambiguous` remain evidence candidates and cannot downgrade an existing confirmed fact; `negated` and `fictional` are retained as history but do not affect factual current state. Conflicting confirmed facts must produce a deterministic conflict diagnostic and preserve both references; no last-write-wins.

## CharacterFacts contract

Reducer-facing input is a plain normalized map:

```js
characterFacts[character_id] = {
  identity: { character_id, display_name, species, biological_type },
  reproductive_capabilities: {
    can_produce_sperm, can_produce_ova, can_be_fertilized,
    can_fertilize, can_carry_pregnancy, can_cause_pregnancy
  },
  resolved_mechanism_facts: []
}
```

It is a Runtime-provided fact DTO, not the Tracking Registry. It does not contain eligibility rules and does not require rebuilding the full Registry during future replay.

## Story Time and ordering

Add a pure helper that compares normalized Story Time only when `day_index` values are finite and their calendar/domain identity is compatible. `calendar_id: null` is comparable only with another compatible null-domain value; different explicit calendars are incomparable. Unknown `day_index`, incompatible provider/domain, or unsupported precision returns explicit unknown/null. No display/Floor/system-time fallback.

Keep existing `sortEvents()` as provenance order (`source.floor → day_index → event_id`) for Tracking and Floor-derived lists. Add a separate Story Time order helper for state chronology, with deterministic fallback to provenance order when Story Time is incomparable. Equal Story Time uses source Floor, source message/Swipe, and Event ID tie-breakers.

Duplicate Event policy: identical normalized Event identity and content is deduped deterministically; same `event_id` with different normalized content/source is a validation error. Never use input order or last-write-wins.

## Boundary

This design changes Event contract and supporting normalization only. It does not implement StateReducer transitions, Snapshot persistence, Projection, or UI state.
