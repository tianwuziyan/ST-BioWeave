# Technical Design: PRE-CONFIRMATION TRACKING WINDOW PHASE 1

## Design decision

选择最小安全方案：保留现有 `buildProjectionTimingCycleId()` 作为 biological observation cycle identity primitive，在 Window core 中提供一个薄的 Window identity wrapper/绑定校验；不创建第二套 random 或 Swipe-derived round identity。Window 使用独立 `tracking_window_timeline`，不复用 Timing/Projection timeline。

## Domain record

Window creation record采用现有 Floor record style，至少包含：

```js
{
  schema_version,
  tracking_window_id,
  cycle_id,
  subject_id,
  mechanism_key,
  source_event_ids,
  source_basis_refs,
  status: 'open' | 'resolved_pregnant' | 'terminated',
  opened_story_time,
  opened_at_floor_version,
  terminal_event_id,
  terminal_reason,
  terminal_story_time,
  terminal_at_floor_version,
  created_at,
  updated_at,
}
```

Timeline is append-only at the Floor owner. Reducer/view dedupes deterministic creation/basis/terminal records and ignores inactive Swipe/stale Floor Version entries. No probability, pregnancy boolean, inferred conception, medical age, EDD, contributor guess, or Projection text is allowed.

## Identity and grouping

- `cycle_id` comes from existing deterministic Timing cycle identity material: Chat, canonical subject, mechanism, first factual exposure Event, first Event Story Time.
- `tracking_window_id` is deterministic from the same cycle binding plus a Window schema version; it is not a new biological identity.
- Valid exposure basis requires existing `isPregnancyRelevantExposure()` plus the canonical subject and mechanism key.
- Compatible exposure means same subject, same normalized mechanism key, valid basis, and current Window open. It attaches Event IDs/basis refs without changing cycle identity or Timing sample.
- A terminal Event is eligible only when it is a confirmed, valid, subject-bound factual `pregnancy_confirmation`, `pregnancy_loss`, or `abortion` after the Window opening Story Time. If Story Time is incomparable, no transition is made. The subject-bound contract is used because current Event schema has no Window foreign key; no contributor/pregnancy inference is introduced.
- Terminal application is forward-only and deterministic. Historical facts are never rewritten. If a terminal fact is later invalidated/deleted, the surviving-facts rebuild removes that terminal result and recomputes the Window view; it does not append a compensating history mutation to an old Floor.

## Data flow

```text
active valid Floor Events + authoritative World Model/current state
  → Tracking Window Core reducer/view
  → open-window filtered Tracking registry
  → Timing binding + pre-confirmation Projection eligibility
  → Characters read model (open Window OR active factual Episode)
```

The Window Core remains pure. Runtime owns Floor resolution, active Swipe, token/epoch guards, persistence and readback. Storage owns only schema normalization and owner-scoped persistence. UI receives read models and never reads raw Window timeline.

## Persistence

- Add `tracking_window_timeline` to `emptyFloor()` and normalization.
- Add a dedicated `tracking` owner with only `tracking_window_timeline` in `FLOOR_OWNER_FIELDS`; keep Projection owner unchanged.
- Register field lifecycle as Floor/Character domain, clearable with Character/All, and preserve it during sibling owner patches.
- Use the existing coordinator transaction, active Swipe check, complete six-field Floor Version, current-owner assertion, official save, authoritative readback, and stale failure behavior.
- `getTrackingWindows()` scans surviving Character Floors in Chat order, checks active Swipe and exact Floor Version, then resolves the append-only timeline deterministically. No Chat-level cache is authoritative.

## Tracking integration

`rebuildTrackingRegistry(events, { world_model, trackingWindows })` first derives valid exposure candidates, then retains only exposure basis IDs belonging to an open Window for that subject/mechanism. Capability resolution remains unchanged. `true` creates Subject, `null` creates Candidate, `false` creates neither. Terminal Window records remain available in the Window read model but not as pre-confirmation active exposure input.

The Window Runtime refresh is composed before Tracking refresh. Event edit/delete and normal Floor rebuild paths call the same resolver; no new UI callback or Chat-level mutation is introduced.

## Timing binding

When a Timing Instance is created, its existing `cycle_id` is the binding authority. Window view either references that cycle or deterministically derives the same cycle from the first basis Event. Existing instances are never recreated or resampled. Additional compatible basis is appended through existing Timing basis attachment semantics.

## Projection bridge

Pass a narrow `openPreConfirmationWindow`/window view into the existing eligibility evaluator. Only exposure-driven pre-confirmation timing checks require an open Window. Pregnancy-stage rules remain governed by World `projection_rules[]`; Window is not put into Projection Context and Projection lifecycle writes never call Window persistence.

## Characters read model

Keep `ui/characters.js` presentation unchanged. The runtime business DTO supplies subjects from `open Window + capability=true`, and retains a character when current factual state contains an active confirmed/suspected Pregnancy Episode according to the existing State contract. Terminated/no-longer-active characters continue to follow the existing Characters contract. Registry/Event/Episode/Window history is never deleted as a UI side effect.

## Compatibility and rollback

- Existing Floors without `tracking_window_timeline` normalize to an empty timeline and rebuild from current valid Events.
- Existing Timing records remain readable without migration or resampling.
- If the new owner cannot commit, tracking fails closed to no active Window authority while factual Events/State remain intact.
- No broad refactor of known-good adapter/coordinator internals; only owner allowlist/schema/lifecycle registration and narrow feature wiring are changed.

## Deferred

No horizon, `expired`, `resolved_not_pregnant`, Window Context injection, advanced Episode orchestration, medical timing, or contributor inference is designed beyond extension-compatible status/schema slots.
