# Pregnancy Exposure Tracking Lifecycle Contract

## 1. Scope and status

This document is the canonical owner for the Pregnancy Exposure
Tracking Window lifecycle. It freezes the semantic boundaries between factual
Events, exposure tracking, Pregnancy Episodes, and Projections.

The current branch implements Tracking Subjects/Candidates and the independent
Phase 1 + Phase 2 Window object/lifecycle derived from valid
pregnancy-relevant Events. Phase 2 adds deterministic Story-Time-only
`expired` lifecycle evaluation at the persisted Timing Instance boundary. The overall feature remains
`PARTIAL / PHASE 1 + PHASE 2 IMPLEMENTED`; `resolved_not_pregnant` remains
unimplemented. Sections marked
**Target Contract** remain the design baseline for later phases. Sections
marked **Current Implementation** describe the current checkout.

Pre-confirmation Projection Timing remains separate from this Window. Its
`projection_timing_snapshot` is the complete Floor-owned collection of
lightweight observation timing records. A later Floor may replace one item or
attach additional valid Event refs by writing the next complete collection; it
must not be treated as the Window owner or as Window expiration. Historical
reads inherit the nearest valid Floor root only when the target root is absent;
an explicit empty snapshot blocks inheritance. The corresponding
`participant_aggregation_snapshot` uses the same complete-collection and
bounded historical-read semantics.
Timing candidates are derived from the current complete, valid
pregnancy-relevant Exposure snapshot and the Character timing resolver; an
empty World Model `projection_rules[]` does not block Timing Instance creation.
The Timing record may therefore have `world_rule_binding: null`. The same
frozen Timing Instance drives Participant Aggregation eligibility, while World
World Model rules remain the configurable path for Projection Eligibility and AI.
When a successful Participant Aggregation has valid Timing/Tracking Window
evidence, the Runtime may use its deterministic built-in
`pre_confirmation_observation` candidate path even when `projection_rules[]` is
empty. This candidate is neutral and does not create a BiologicalEvent,
pregnancy fact, or `pregnancy_id`; ST text and Event Analysis remain the
pregnancy-fact confirmation boundary.
The built-in branches are elapsed-Story-Time gates in three stages: day 14–20
offers fatigue/sleepiness, breast sensitivity, light scent-or-food changes,
and temporarily no obvious reaction; day 21–27 offers nausea, scent
discomfort, mood change, and appetite change; day 28–42 offers worsening
nausea, possible vomiting, persistent fatigue, and continued absence of obvious
reaction. A branch is not created before its stage gate; a later refresh can
create the newly reached branches for the same observation. Each generated
candidate carries its reference Story Time, current Story Time, elapsed days,
and the read-only stage metadata consumed by Product UI. When the branch
schedule changes, old built-in branch records are lifecycle-deleted and
regenerated; this migration does not delete factual Events or rewrite
Timing/Aggregation history.

Participant Aggregation remains an observation candidate snapshot. Its
`pregnancy_id` may be `null` until Event Analysis confirms a concrete pregnancy
identity from ST正文. A `null` identity is observation-scoped, not a wildcard:
different concrete pregnancy IDs remain isolated even when subject and cycle
match. When an observation reaches its frozen effective maximum without a
positive confirmation, the Projection lifecycle timeout path closes that
observation with `timeout_no_pregnancy` and removes only its currently accepted
Exposure Events through the existing Floor-owned lifecycle cleanup. A missing
response delivery does not by itself prevent this timeout evaluation. Historical
Aggregation snapshots remain unchanged.

After a successful Aggregation, active Tracking and Timing derivation only keep
the Aggregation's accepted Exposure IDs for that subject/mechanism until a
Lifecycle Release record exists. Later Exposure facts may remain ordinary
Floor-owned facts, but they cannot append to the frozen Timing/Window source
set or silently create the next observation round.

When a valid Timing Instance reaches its frozen effective minimum, the current
aggregation strategy may record one independent participant-aggregation
success. A Story Time value beyond the frozen effective maximum is an overdue
aggregation opportunity, not a reason to skip the aggregation. The aggregation
record remains separate from Projection AI success; its participant list is
re-derived from the accepted Exposure IDs and the current complete valid Floor
Event snapshot after Event deletion or other permitted changes. If only some
of the accepted IDs remain valid, a new Projection may use that surviving
current subset without changing the historical Aggregation snapshot. The
read-only debug DTO reports the exact missing or invalid IDs under
`aggregation_evidence_invalid_event_ids`; it must not put those stale sources
back into the current evidence. If no accepted ID remains valid, the
Projection decision fails closed.

Event Analysis negative results follow the same ownership boundary. The model
may identify a confirmed negative examination by character name/alias only;
Runtime binds that candidate to the unique active, unreleased `cycle_id` from
the current Floor tracking/aggregation state. It never asks the model to invent
or expose a cycle ID. No unique subject or cycle means no lifecycle Event. A
bound result is saved through the canonical Event collection and only then can
the existing pregnancy lifecycle archive/release path close the observation.

When Story Time advances, Runtime re-evaluates active pre-confirmation Timing
instances even if no new factual Event was discovered. The deterministic
`before_min` to `window_open` result is derived from the current Timing Instance
and existing Projection presence; it is not persisted as a second transition
authority. Entering the window collects all compatible exposure Event refs from
the current Tracking Window/basis before the Projection Runtime applies its
existing identity and lifecycle guards.

### Current Implementation: Phase 1 + Phase 2

Phase 1 owns deterministic Window/cycle identity, compatible exposure grouping,
and Floor persistence/readback. Phase 2 adds Timing-bound Story-Time-only
expiration. Together they provide `open` / `resolved_pregnant` /
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

`expired` is a Window lifecycle result. It is not, by itself, deletion of a
`BiologicalEvent`, `resolved_not_pregnant`, `pregnancy_confirmation(false)`, a
`medical_event`, or any other newly invented fact. After a formal Participant
Aggregation has been created, a separate lifecycle timeout may close that
observation with `timeout_no_pregnancy` and remove only its currently accepted
Exposure Events; that cleanup is not the Window status itself and does not
rewrite the historical Aggregation snapshot.

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

Standalone Window expiration only ends the Window's current Tracking influence.
It must not:

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

The Timing and Tracking cycle identity uses one canonical Story-Time shape. A
missing `day_index` and an explicit `day_index: null` are equivalent for this
identity; Story-Time comparison still uses the existing Calendar Engine and is
not replaced by the identity normalization. Runtime lifecycle recovery may
revisit a current Chat at initialization, Chat change, plugin re-enable, or a
stable new Floor boundary without re-running Event Analysis. Before creating a
new Timing Instance it may reuse one historical instance only when the current
Chat, active Swipe/Floor authority, subject, mechanism, first source Event,
source overlap, and Story-Time basis prove one unique cycle. Ambiguous or
unavailable provenance must not be guessed; the runtime creates only a new
canonical cycle when no old record can be safely proven equivalent.

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

These return `null` when structured day indexes and the existing calendar
arithmetic cannot establish a shared time domain, including unknown or
different eras. For an era-standard display date, the existing Chinese-date
parser may recover the date arithmetic even when the persisted `day_index` is
empty; this does not authorize guessing across eras or unknown calendars. A
future Window implementation must fail closed in the unresolved case: no
system-clock fallback, no AI common-sense fallback, and no interpretation of
“a long time” as elapsed Story Time.

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
and factual terminal transitions from surviving valid Events. Runtime supplies
read-only persisted Timing Instances through the event-analysis orchestration
boundary. A matching Timing Instance's frozen `effective_max_story_days` is
the time boundary for Window split/expiration; the independent World Model
`tracking_window_horizon` cannot end a Window earlier. Without a matching
Timing Instance, time-based split/expiration fails closed and leaves the Window
open. Factual terminal Windows never reopen from horizon correction; an
`expired` result is recomputed from the current complete Events and matching
Timing boundary.

`core/state.js` separately records exposure history and retains
`last_exposure_story_time`; the current Story Time participates only in
downstream derived judgments and no `elapsed_story_days` field is recorded or
returned. Its `pregnancy.episodes` structure is the Pregnancy Episode layer,
not a Window substitute, and it has no generic `resolved_not_pregnant` Window
state.

The Runtime current-state path remains connected: valid active Floor Events and
the derived `characterFacts` are replayed through `reduceState()`, using a valid
Snapshot checkpoint when available. Advancing `currentStoryTime` without a new
Event participates only in derived timing judgments; it does not create an
Event, output `elapsed_story_days`, or implement Window expiration. The ordinary current Window view is
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
  → expire only when a matching persisted Timing boundary and Story Time elapsed value support it
  → feed open Windows to active Tracking / current unresolved-exposure tracking signal
```

If the elapsed value is `null`, the Window remains open; unresolved is
descriptive language only, not a separate lifecycle state. Closed Windows do
not revive from future exposures; new exposures may start a new round only
after the prior observation has been released. Standalone Window derivation
does not rewrite Events. The separate `timeout_no_pregnancy` lifecycle cleanup
may remove currently accepted Exposure IDs after archiving their Aggregation;
the archive preserves the historical source identity. Resolved Window provenance now
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

Wrong: Window expiration itself deletes a historical `sexual_activity` Event.

Correct: elapsed canonical Story Time may close/expire a derived Window while
the Event remains in its authoritative Floor/Swipe; only the separate
post-Aggregation `timeout_no_pregnancy` cleanup removes currently accepted
cycle Exposure IDs after archiving them.

Wrong: `expired` means “confirmed not pregnant.”

Correct: `expired` only means the exposure no longer contributes to the
current unresolved pregnancy Tracking window.

Wrong: gestation duration is the Tracking horizon.

Correct: World Model timing semantics must distinguish gestation from
unresolved exposure tracking horizons.

Wrong: every new exposure indefinitely resets one Window.

Correct: compatible exposures join the same open round, and closed rounds do
not reopen. A matching persisted Timing Instance boundary is required for
time-based expiration; missing/ambiguous Timing boundary or Story Time remains
open. Lifecycle `timeout_no_pregnancy` may then clear the current cycle's
accepted Exposure Events through the existing cleanup entry point; historical
Aggregation snapshots are not rewritten.

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

## 13. Lifecycle runtime observability contract

### 13.1 Scope / trigger

Changes to participant aggregation, Projection delivery, pregnancy lifecycle
archive/release, or cycle-scoped NSFW capability must review the existing
read-only Runtime debug path. It is observability only, not a second state
owner.

### 13.2 Signature

`runtime.collectActiveBusinessData({includeDebug: true})` returns the normal
business DTO plus `debug.lifecycle_runtime`, built from the active
Chat/Floor/Swipe and existing persistence readbacks.

### 13.3 Contract

`lifecycle_runtime` contains the target six-field `floor_version`,
`participant_aggregation.aggregations[]`, `projection_delivery.records[]`,
`pregnancy_lifecycle.facts/archives/candidate_records/release_records`, and
`nsfw_lock`. Aggregations expose identity, accepted Exposure counts/IDs, Story
Time and frozen min/max. `observation_boundary.aggregations[]` additionally
exposes the read-only per-aggregation Floor/Swipe boundary, `freeze_status`,
`accepted_exposure_event_ids`, current valid pregnancy-relevant Exposure IDs,
post-aggregation excluded IDs with `POST_AGGREGATION_CYCLE_FROZEN` when
applicable, `effective_max_story_days`, elapsed Story days, and a timeout state
of `waiting/not_due`, `due/overdue_not_released`, or
`released/timeout_no_pregnancy`; a normally completed terminal lifecycle uses
`released/terminal_lifecycle`. Elapsed Story days use the observation's
reference/first Exposure Story Time, not the later Aggregation write time. It
also carries nullable-or-concrete `pregnancy_id`, closure/release reason
fields, and deleted-event count. These
fields explain why a later Exposure did not enter the frozen snapshot and
whether timeout cleanup actually released the cycle; they do not create or
modify business facts. Delivery records expose submission/response versions
and analysis status. Candidate records expose counts, not narrative payloads.

### 13.4 Validation and error matrix

- missing or stale current Floor → `status: unavailable`, safe reason only;
- failed readback → `status: unavailable`, never a successful lifecycle state;
- production capability disabled → gate remains
  `disabled_until_lifecycle_archive_release`;
- isolated capability enabled → locks derive from current aggregation and
  release timelines, never from subject ID alone.

### 13.5 Good / base / bad cases

- Good: C001 aggregation, delivery response, archive and release records show
  the same cycle identity.
- Base: empty timelines render zero counts and safe unknown values.
- Bad: debug code reconstructs candidates from deleted Exposure Events or reads
  a future Swipe/Floor.

### 13.6 Required tests

Assert read-only debug collection, active Swipe/Floor provenance, default gate
status, missing-data safety, C001 release/C002 isolation, delivery response
status, and existing stale/readback/concurrency lifecycle tests.

### 13.7 Wrong vs correct

Wrong: add a user setting or Chat-level mirror for each internal lock state.

Correct: reuse current Timing settings where configuration is needed and expose
bounded lock/delivery/lifecycle status through the existing debug DTO.

## 14. Executable observation-timeout and identity contract

### 14.1 Scope / trigger

This contract applies after a successful Participant Aggregation has created an
observation candidate and Story Time advances beyond its frozen
`effective_max_story_days` without a matching positive pregnancy fact.

### 14.2 Signatures

- `evaluateTimeoutNoPregnancy(target) -> {status, closed}` evaluates both
  successful Projection deliveries and persisted successful Aggregations.
- `pregnancyIdentityMatches({subjectId, pregnancyId, candidateSubjectId,
  candidatePregnancyId, candidateStatus, allowObservationPromotion}) -> boolean`
  is the shared nullable-identity comparison rule.
- `evaluateTrackingWindowHorizon(window, {timingInstances, currentStoryTime})`
  uses the matching Timing Instance as the time boundary.

### 14.3 Contracts

- Aggregation identity is `subject_id + pregnancy_id + cycle_id`; the
  observation phase permits `pregnancy_id: null`.
- `null` matches `null` exactly. It may promote to one concrete ID only for a
  positive confirmation/ongoing-pregnancy fact in the same subject and cycle;
  it is never a wildcard for an unrelated concrete ID.
- Timeout archives the Aggregation snapshot with
  `closure_reason: timeout_no_pregnancy`, deletes only its currently accepted
  Exposure Event IDs, and releases the cycle. The operation key must include
  the delivery ID or Aggregation ID so separate rounds cannot deduplicate one
  another.
- A missing Projection response delivery does not suppress timeout evaluation.
- The Window's World `tracking_window_horizon` cannot split or expire a round
  before the matching Timing `effective_max_story_days`.

### 14.4 Validation and error matrix

- no matching Timing Instance or incomparable Story Time → keep the Window
  open;
- different subject, cycle, or concrete pregnancy ID → lifecycle fact does not
  match the Aggregation;
- `not_pregnant` with a concrete pregnancy ID → invalid fact;
- missing accepted current Event IDs during cleanup → fail closed according to
  the existing Floor lifecycle persistence contract;
- missing response delivery with a valid successful Aggregation → still
  evaluate timeout.

### 14.5 Good / base / bad cases

- Good: `subject + null + cycle` Aggregation times out, accepted current NSFW
  Events are removed, the archive is preserved, and a new cycle cannot reuse
  them.
- Base: a later positive ST fact promotes the observation to its concrete
  pregnancy ID and prevents the no-pregnancy timeout.
- Bad: a fact for another pregnancy ID or another cycle suppresses timeout or
  causes the wrong Exposure Events to be archived/deleted.

### 14.6 Required tests

- nullable identity promotion and concrete-ID isolation;
- timeout with and without a response delivery;
- timeout mismatch by pregnancy ID and by cycle ID;
- deletion of only accepted current-cycle Exposure Events with unrelated
  Events preserved;
- same-subject Day 0/Day 8/Day 14 exposures remaining in one round when the
  Timing maximum is later than the World horizon.

### 14.7 Wrong vs correct

Wrong: treat `pregnancy_id: null` as matching every pregnancy, or use a fixed
`timeout-no-pregnancy:null` operation key for all no-delivery Aggregations.

Correct: compare subject, cycle, and nullable pregnancy identity explicitly,
allow only the documented observation-to-confirmation promotion, and derive a
unique timeout operation key from the delivery or Aggregation identity.
