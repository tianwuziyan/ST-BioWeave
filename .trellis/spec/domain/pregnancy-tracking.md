# Pregnancy Exposure Tracking Lifecycle Contract

## 1. Scope and status

This document is the canonical owner for the Pregnancy Exposure
Tracking Window lifecycle. It freezes the semantic boundaries between factual
Events, exposure tracking, Pregnancy Episodes, and Projections.

The current branch implements Tracking Subjects/Candidates and the independent
Phase 1 + Phase 2 Window object/lifecycle derived from valid
pregnancy-relevant Events. Phase 2 adds the World-authoritative mechanism
horizon and deterministic Story-Time-only `expired` lifecycle. The overall feature remains
`PARTIAL / PHASE 1 + PHASE 2 IMPLEMENTED`; `resolved_not_pregnant` remains
unimplemented. Sections marked
**Target Contract** remain the design baseline for later phases. Sections
marked **Current Implementation** describe the current checkout.

Pre-confirmation Projection Timing remains separate from this Window. Its
`projection_timing_timeline` is only a lightweight observation timing record:
same subject + same explicit mechanism may attach additional valid Event refs,
but it must not be treated as the Window owner or as Window expiration.

When Story Time advances, Runtime re-evaluates active pre-confirmation Timing
instances even if no new factual Event was discovered. The deterministic
`before_min` to `window_open` result is derived from the current Timing Instance
and existing Projection presence; it is not persisted as a second transition
authority. Entering the window collects all compatible exposure Event refs from
the current Tracking Window/basis before the Projection Runtime applies its
existing identity and lifecycle guards.

### Current Implementation: Phase 1 + Phase 2

Phase 1 owns deterministic Window/cycle identity, compatible exposure grouping,
and Floor persistence/readback. Phase 2 adds the World-authoritative horizon and
Story-Time-only expiration. Together they provide `open` / `resolved_pregnant` /
`terminated` / `expired`, active
Tracking filtering, Timing cycle binding, and the pre-confirmation Projection
Eligibility bridge. `pregnancy_confirmation` resolves an open Window;
`pregnancy_loss` and `abortion` terminate it. Conception, suspicion, symptoms,
Timing `window_missed`, elapsed Story Time, and Projection do not close it.

The independent owner is `core/tracking-window.js` with Runtime/storage adapters
and `tracking_window_timeline`. Historical Floors remain immutable and active
Windows are rebuilt only from surviving valid Event facts.

This contract is deliberately generic. Human examples, fixed day counts,
names, IDs, Floor numbers, and particular reproductive mechanisms are not
production rules.

## 2. Four layers that must remain separate

| Layer | Answers | Nature |
| --- | --- | --- |
| `BiologicalEvent` | What factual biological event happened in the narrative? | Historical fact, Floor-bound |
| Pregnancy Exposure Tracking Window | Which exposures still have current biological relevance as an unresolved pregnancy possibility? | Derived Tracking lifecycle, not a fact Event |
| Pregnancy Episode | Has a factual conception, suspicion, confirmation, or ending been established? | StateReducer factual state |
| Projection | What future development is possible from the facts and rules? | Future possibility, not a fact |

The conceptual flow is:

```text
BiologicalEvent
  → Pregnancy Exposure Tracking Window
  → factual Pregnancy Episode when later evidence supports it
  → Projection / Context derived from the surviving facts
```

`expired` is a Window lifecycle result. It is not deletion of a
`BiologicalEvent`, `resolved_not_pregnant`, `pregnancy_confirmation(false)`, a
`medical_event`, or any other newly invented fact.

## 3. Target Window contract

### 3.1 Subject axis and contents

A Window is keyed by one canonical gestational subject, not by a counterpart.
One Window may reference multiple canonical exposure Events with different
Story Times and multiple counterpart/source IDs:

```text
Event A ─┐
Event B ─┼→ Window(subject = canonical gestational subject)
Event C ─┘
```

Cross-Floor or cross-Story-Time Events must not be rewritten into a synthetic
aggregate Event merely for Tracking. The Window references the original Event
IDs and retains source provenance.

The same subject may have multiple rounds over time. An exposure never reopens
a closed Window. A new exposure joins a compatible open Window or starts a new
round after the prior Window has closed.

### 3.2 Lifecycle states

The Target Contract requires these semantic states:

- `open`: exposure remains within the applicable tracking boundary;
- `resolved_pregnant`: later canonical factual evidence supports a real
  Pregnancy Episode;
- `resolved_not_pregnant`: later canonical factual evidence reliably excludes
  pregnancy for this Window;
- `expired`: no factual resolution was established, but the Window has passed
  the deterministic tracking boundary.

These are the only Window lifecycle states. `unresolved` may describe a lack
of resolution in prose, but it is not a fifth lifecycle state.

Window lifecycle and Tracking eligibility are separate dimensions:

- `eligible` / `pending` / `ineligible` answer whether a person currently
  qualifies as a Tracking Subject;
- `open` / `resolved_pregnant` / `resolved_not_pregnant` / `expired` answer
  whether this exposure round remains time-relevant.

A legitimate pregnancy-relevant exposure whose participant capability is
`can_carry_pregnancy === null` may therefore have an `open` Window while its
person remains a `pending` Tracking Candidate. That Window must still be able
to reach deterministic expiration from canonical Story Time. A pending Window
does not create a `tracking_subjects` entry or a Characters UI entry.

`resolved_not_pregnant` requires factual evidence. Silence, time passing, or
the absence of a later pregnancy Event cannot create it.

Expiration only ends the Window's current Tracking influence. It must not:

- delete, negate, or rewrite the historical exposure Event;
- create a negative pregnancy fact, `medical_event`, or `state_fact`;
- create or end a Pregnancy Episode;
- alter `reproductive_source_attribution`;
- delete canonical identity, aliases, or the Character Registry.

Only an `open` Window contributes to current active pregnancy Tracking or a
current unresolved-exposure tracking signal. An open Window represents an
unresolved pregnancy-relevant exposure round; it does not establish conception,
pregnancy suspicion, or confirmed pregnancy. Closed Window history may remain
visible through the ordinary bounded historical Event rules.

### 3.3 No unbounded timer reset

The lifecycle must not reset one permanent timer after every new exposure.
The semantic model distinguishes, without freezing final field names or JSON:

- the Story Time at which the Window opened;
- the latest compatible exposure Story Time;
- a resolution/detection horizon;
- a maximum Window horizon that prevents indefinite renewal.

`buildTrackingWindowCycleId()` reuses the deterministic Timing cycle identity
material: Chat identity, canonical subject, reproductive mechanism, first
factual pregnancy-relevant Event ID, and first Event Story Time. The Window ID
is a deterministic digest of that cycle ID. Compatible attachment requires the
same canonical subject, mechanism, and valid pregnancy-relevant factual basis.
Grouping and identity are implemented; cross-mechanism Episode binding remains
outside this contract.

## 4. Resolution and attribution boundaries

An open Window is not a Pregnancy Episode. A possible conception or an
eligible Tracking Subject cannot create a confirmed Episode. The existing
Pregnancy Episode state remains owned by `core/state.js` and factual state
Events such as conception, suspicion, confirmation, loss, delivery, and
postpartum.

A Window containing several sources does not establish any contributor
relationship when a pregnancy is later confirmed. Confirmation establishes the
subject's Pregnancy Episode. Only explicit
`reproductive_source_attribution` facts may confirm or exclude a contributor;
recency, input order, display name, gender, sex, event role, or the first/last
source is never sufficient.

## 5. Time and World Model responsibility

World Model owns reproductive biological timing semantics for the applicable
species, biological type, and reproductive mechanism. Story Time / Calendar
Engine owns canonical comparison and elapsed-time arithmetic. Tracking owns the
deterministic Window state transition. Event Analyzer only discovers factual
Events and never decides that a Window expired from subjective language.

Gestation duration is not an unresolved-exposure tracking horizon. The World
Model must not be treated as having a Window horizon merely because it has a
`lifecycle.gestation` or related rule.

The audited Story Time API already provides reusable deterministic primitives:

- `compareStoryTime(left, right)`;
- `differenceStoryDays(left, right)`;
- `differenceStoryTime(left, right)`;
- `createStoryTime().diff()` / `getDateDifference()`.

These return `null` when structured day indexes or calendar domains are not
reliably comparable, including unknown or different eras. A future Window
implementation must fail closed in that case: no system-clock fallback, no AI
common-sense fallback, and no interpretation of “a long time” as elapsed Story
Time.

## 6. Floor, Swipe, and Version authority

Window derivation and any future Window persistence must obey the existing
Character Floor, active Swipe, complete Floor Version, and surviving valid
facts contract. Floor deletion, Swipe switching/deletion, Event edit/deletion,
or stale Version invalidation must remove the affected exposure from the
surviving input before active Windows and Tracking are rebuilt.

No Chat-level permanent Event or Window cache may bypass Floor authority. If a
future design persists Windows, it must first decide whether the Window is a
Floor-bound fact or a Runtime-derived view, specify its owner and source Event
references, and prove rebuild/invalidation behavior.

## 7. Current Implementation audit

The current `core/tracking.js` path is:

```text
valid Floor-bound Events
  → collect all pregnancy-relevant exposure Events
  → group by canonical gestational subject ID
  → resolve participant identity/type/capabilities against World Model
  → eligible / pending / ineligible
  → tracking_subjects / tracking_candidates
```

`rebuildTrackingRegistry()` now receives the Phase 1 + Phase 2 Window view from Runtime.
It accumulates valid exposure provenance per subject only while the source
Event belongs to an `open` Window. `can_carry_pregnancy === true` creates an
active Subject, `false` creates neither an active Subject nor a pending
Candidate, and `null` creates a pending Candidate. A Window may therefore keep
factual exposure basis while the same subject remains a Candidate. Terminal
Window statuses do not delete Events, Registry identity, or Pregnancy Episodes.

`core/tracking-window.js` derives deterministic identity, compatible grouping,
and factual terminal transitions from surviving valid Events. Runtime evaluates
the World mechanism-level `tracking_window_horizon`; a comparable Story-Time
value at or beyond the authoritative maximum produces `expired`. Missing,
ambiguous, or incomparable horizon/time data fails closed and leaves the Window
open. Factual terminal Windows never reopen from horizon correction; an
`expired` result is recomputed from the current complete Events and effective
horizon.

`core/state.js` separately records exposure history and derives
`last_exposure_story_time` plus `elapsed_story_days`; that derived value does
not currently close or filter Tracking. Its `pregnancy.episodes` structure is
the Pregnancy Episode layer, not a Window substitute, and it has no generic
`resolved_not_pregnant` Window state.

The Runtime current-state path remains connected: valid active Floor Events and
the derived `characterFacts` are replayed through `reduceState()`, using a valid
Snapshot checkpoint when available. Advancing `currentStoryTime` without a new
Event can update `elapsed_story_days` transiently, but it does not create an
Event or implement Window expiration. The ordinary current Window view is
re-derived from the target complete Event state, effective World Model, and
target Story Time; the persisted Timeline remains an independent
compatibility/lifecycle persistence path and does not override that result.

`runtime/tracking-runtime.js` is an orchestration wrapper around
`rebuildTrackingRegistry()`. `runtime/event-analysis.js` exposes the resulting
Tracking DTO to UI/runtime consumers. `ui/characters.js` consumes active
`tracking_subjects`; it must not be changed to infer Window state itself.

## 8. Projection boundary

The Projection domain already has its own `realized`, `contradicted`, and
`expired` lifecycle records, append-only timeline, Story Time eligibility, and
Floor ownership. Projection expiration is not Pregnancy Exposure Tracking
Window expiration. In Phase 2, only a Projection with explicit
`tracking_scope: pre_confirmation` and `tracking_window_id` may receive a
Projection-owner lifecycle record when that Window expires; an unbound
Projection remains active. Window Runtime never writes the Projection timeline.

The existing `projection_rules[]` supports generic elapsed-event and
story-time triggers. This is reusable timing infrastructure; the Phase 2 bridge
is explicit and preserves the separate owners.

## 9. World Model schema audit

The current World Model v1 contains species/types, capabilities,
reproductive mechanisms, lifecycle/special rules, and declarative Projection
Rules. Phase 2 implements the canonical field
`reproductive_mechanisms[].tracking_window_horizon` with
`{schema_version: 1, max_story_days: non-negative integer}`. Exact subject
species/type/mechanism binding is required; missing or ambiguous data keeps a
Window open. Do not equate existing
gestation duration or generic Projection trigger thresholds with these
semantics. Full omission is unavailable and Patch omission preserves the
existing declaration. Horizon correction never reopens an expired or factual
terminal Window.

## 10. Current derivation and deferred boundaries

The planned deterministic flow is:

```text
surviving valid Events + canonical identities + persisted World Model
  → sort pregnancy-relevant exposure by canonical Story Time
  → group by gestational subject
  → build or rebuild Window rounds
  → attach compatible Event IDs and source sets
  → inspect later factual resolution Events
  → resolve pregnant only when an authorized factual Event supports it
  → expire only when a reliable World Model horizon and Story Time elapsed value support it
  → feed open Windows to active Tracking / current unresolved-exposure tracking signal
```

If the elapsed value is `null`, the Window remains open; unresolved is
descriptive language only, not a separate lifecycle state. Closed Windows do
not revive from future exposures; new exposures may start a new round.
Historical Events remain unchanged throughout. Resolved Window provenance now
feeds a pure read-only contributor-candidate view, bound to the terminal
`pregnancy_confirmation` `pregnancy_id`; candidate sources are not contributors
and are never auto-confirmed or excluded. After confirmed pregnancy, later
exposure Events are still recorded, but exposures after the confirmation Story
Time do not open a new pre-confirmation Window. Historical exposures at or
before that Story Time remain part of the resolved Window. After factual
`pregnancy_loss`, `abortion`, or `delivery`, future exposures may open a new
round; mechanism-specific Windows remain independent.

## 11. Explicitly deferred decisions and open gaps

The following decisions belong to a later design task and must not be implied
by this contract:

1. the generic factual authority for `resolved_not_pregnant` (product-contract
   required; not implemented);
2. cross-mechanism Window-to-Episode binding and advanced Pregnancy Episode
   orchestration.

## 12. Regression guardrails

Wrong: elapsed time deletes a historical `sexual_activity` Event.

Correct: elapsed canonical Story Time may close/expire a derived Window while
the Event remains in its authoritative Floor/Swipe.

Wrong: `expired` means “confirmed not pregnant.”

Correct: `expired` only means the exposure no longer contributes to the
current unresolved pregnancy Tracking window.

Wrong: gestation duration is the Tracking horizon.

Correct: World Model timing semantics must distinguish gestation from
unresolved exposure tracking horizons.

Wrong: every new exposure indefinitely resets one Window.

Correct: compatible exposures join the same open round, and closed rounds do
not reopen. A World-authoritative mechanism horizon is required for expiration;
missing/ambiguous horizon or Story Time remains open.

Wrong: pregnancy confirmation automatically chooses the nearest counterpart.

Correct: source attribution remains an explicit factual Event owned by the
existing attribution contract.

Wrong: Projection `expired` proves Tracking Window `expired`.

Correct: the two lifecycles remain separate until an explicit bridge is
designed.

Wrong: `character_registry` or `can_carry_pregnancy` directly creates a
Characters UI entry.

Correct: only valid pregnancy-relevant exposure plus resolved Tracking
eligibility and an open Window produces pre-confirmation `tracking_subjects`;
UI consumes that Runtime DTO. Active factual Pregnancy State remains a
separate Characters read-model compatibility source.
