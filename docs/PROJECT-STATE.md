# BioWeave Project State

This document is a long-term handoff map for developers who do not have prior
conversation context. It records the current architectural checkpoint, not a
replacement for the domain specifications, implementation, or test suite.

## Current Snapshot

| Item | Current state |
| --- | --- |
| Project | ST-BioWeave |
| Development branch | `fix/world-model-prompt-baseline` |
| Checkpoint | Observed at 2026-10-02; HEAD is checkpoint information, not a permanent architectural contract. |
| Working tree | Contains uncommitted Pre-confirmation Projection Timing Phase 1 implementation and related task work. |
| Major milestone | Phase 1 timing implementation is present and automated verification is complete. Behavioral timing acceptance in a real SillyTavern lifecycle is still pending. |
| Loading model | SillyTavern direct source-extension loading: `manifest.json` → `index.js`; the remote third-party/BioWeave copy is the host under test. No build, `dist`, or bundle step is required by the current manifest. |
| Current host status | The remote SillyTavern copy has been verified to load the current Phase 1 entry; `__BIOWEAVE_DEBUG__` is visible and diagnostic timing/config reads are callable and read-only. The current source additionally contains controlled timing-config fixture save/reset methods using the official current-Chat persistence path; the remote copy must be refreshed before those writes can be used. Host build/load identity is VERIFIED. Behavioral timing smoke remains pending. |

When this checkpoint conflicts with a concrete implementation or an
authoritative domain document, verify the current checkout and update this
navigation document rather than reviving historical task conclusions.

## Architecture at a Glance

```text
Character Floor
  → Floor Version / active Swipe
  → World Model resolve
  → Character/Event Analysis
  → BiologicalEvent
  → Character Registry
  → Tracking Subjects / Candidates
  → Character Facts
  → Current Biological State
  → Projection Evolution
  → Projection Eligibility
  → Pre-confirmation Timing eligibility
  → Projection Generation
  → Projection Timeline
  → Projection Views
  → Projection Context
  → SillyTavern extension prompt
```

`Snapshot` is a factual-state optimization boundary. It does not contain
Projection or Timing persistence. A Projection failure is not a factual
Event/State failure: the factual pipeline and the future-possibility pipeline
have separate contracts and failure boundaries.

## Concept Separation

| Concept | Authority / owner | Persisted? | Purpose | Must not be confused with |
| --- | --- | --- | --- | --- |
| Character Registry | Floor-derived canonical identity domain | Yes, as Floor-derived registry data | Canonical IDs, display names, aliases, identity history, and participant references | Characters UI list; timing config; profile facts |
| Tracking Subject | Derived from valid factual exposure, canonical identity, and capability | Derived from current valid Floor | Active person eligible for pregnancy-relevant tracking | All Event participants; Registry entries |
| Tracking Candidate | Derived participant whose capability is unknown or unresolved | Derived from current valid Floor | Preserve unresolved eligibility without activating tracking | Active Tracking Subject |
| Character Facts/Profile | Analysis-derived character facts/profile data | Derived, Floor-scoped | Facts used by downstream analysis and views | Registry identity; Current State |
| BiologicalEvent | Factual Event contract owned by the valid current Floor | Yes, append-only/event timeline style | Represent narrative-supported biological facts and evidence | Projection; inferred causal consequence |
| Current Biological State | Reducer output from authorized factual Events | Yes/derived through Floor state | Current factual biological state | Narrative mood; Projection Context; timing modifier input unless factual |
| Pregnancy Episode | Domain grouping/derived lifecycle concept | Partial/derived | Group pregnancy-related facts without implementing a full Tracking Window | BiologicalEvent; Tracking Window; GA/EDD |
| Projection Rule | World Model authoritative declarative rule | Yes, in Floor-owned World Model | Deterministically describe when/what a possible development may be considered | Timing sample; factual Event |
| Projection | Floor-owned non-factual future possibility and its lifecycle | Yes, in `projection_timeline` | Watch for a possible development and evolve it as narrative evidence appears | Event; factual pregnancy state |
| Projection Context | Runtime view of context-visible Projections | Runtime/read model; prompt slot is refreshed | Inject possible developments into the ST prompt | Event evidence; authoritative factual storage |
| Character Timing Config | Chat-local character configuration | Yes, Chat-local | Base pre-confirmation timing policy for future cycles | Character Registry/Profile; World Rule |
| Observation Timing Instance | Floor-owned Timing-domain record | Yes, `projection_timing_timeline` | Freeze one cycle's basis, variance, effective min/max, and provenance | Tracking Window; Projection; BiologicalEvent |
| Tracking Window | Reserved broader exposure-tracking concept | **Not implemented** | Future complete exposure-window lifecycle | Current lightweight Timing Instance |
| Snapshot | Factual state optimization/bridge | Yes where the current lifecycle requires it | Avoid rebuilding factual state unnecessarily | Projection persistence; Timing persistence |

Important identity boundaries:

- Registry ≠ Characters UI list. The Characters page primarily displays eligible
  Tracking Subjects.
- Tracking Subject ≠ all Event participants.
- Timing Instance ≠ Tracking Window.
- Projection ≠ Event.
- Projection Context ≠ factual evidence.
- Timing Config ≠ Registry/Profile.
- Projection Rule ≠ sampled timing result.
- Snapshot ≠ Projection persistence.

## World Model Contract

World Model is a hard dependency of Character/Event analysis. The current
routing contract is:

| Situation | Operation |
| --- | --- |
| Auto: no World Model | Full construction |
| Auto: existing World Model plus relevant evidence | Patch/Supplement |
| Auto: existing World Model and no relevant evidence | Reuse |
| Manual World analysis | Full |
| Manual supplementary analysis | Patch |

World Model is Floor-owned and active-Swipe-owned, protected by the complete
Floor Version contract. Missing or stale authority fails closed. Character Card
data is not a fallback authority, and Runtime must not silently apply
real-world Human assumptions. `carrying_compatibility` is tri-state; unknown is
not false.

`projection_rules[]` is the validated declarative authority consumed by
Projection Runtime. No rule means no Projection eligibility fallback; Runtime
does not invent a rule.

### Projection Rule Override

The current override contract uses a factual `Projection_Rule_Override` unit
and the internal `DISABLE_PROJECTION_RULE` operation:

- AI does not own the canonical `projection_rule_id`; the host assigns a
  deterministic ID.
- Omission, uncertainty, and no evidence do not mean disable.
- Only explicit contradiction or non-applicability evidence can disable a rule.
- Replacement is disable plus a distinct added rule.
- Historical Floors are never rewritten.
- Runtime does not maintain a disabled-rule blacklist.

## Event and Factual Semantics

The reducer modifies only states explicitly authorized by the Event contract.
It must not manufacture missing facts from real-world causal relationships.

The following distinctions are frozen:

- exposure ≠ conception;
- conception ≠ `pregnancy_confirmation`;
- labor ≠ delivery;
- postpartum ≠ delivery or termination;
- uncertain Event ≠ factual state transition;
- confirmed conception ≠ confirmed pregnancy.

Probable or ambiguous Events may be retained in uncertain history, but must not
silently mutate factual pregnancy status. A Projection prompt is not Event
evidence; Event Analyzer reads actual narrative evidence rather than its own
Projection Context.

## Character and Tracking Contract

Character Analyzer may analyze every Event participant. Registry data may include
source and counterpart identities, so Registry cardinality is expected to be
larger than the active Characters page. For example, Registry 4 and Characters
2 can be correct.

An active Tracking Subject requires a valid pregnancy-relevant exposure, a
canonical subject, and `can_carry_pregnancy === true`. Unknown capability is a
Tracking Candidate; false capability is not an active subject. Eligibility is
capability/world-model driven and must not be inferred from gender, role, NSFW
content, symptoms, name, or natural-language guesswork.

Characters UI is therefore a consumer of validated tracking data, not a direct
Registry browser.

## Projection Contract

A Projection is a non-factual future biological development possibility or
question. Conceptually:

```text
Current factual State + Story Time + World Rule
  → development worth watching
  → possible future development
  → Projection Context
  → narrative may or may not realize it
```

The current lifecycle vocabulary is `active`, `realized`, `contradicted`,
`expired`, and `deleted`. Factual State remains Event-owned.

Projection Context uses the fixed extension prompt slot
`bioweave_projection_context`, as a SYSTEM message in `IN_CHAT` at depth 4. It
contains only context-visible Projection Views and is cleared when no valid
Projection is available. It is not a factual source and cannot create a
self-evidence loop.

## Pre-confirmation Projection Timing Phase 1

Phase 1 currently includes:

- Chat-local `character_timing_configs`, including reset and versioning;
- Floor-owned `projection_timing_timeline`;
- deterministic logical cycle and timing identities;
- one-time bounded variance sampling at Timing Instance creation;
- frozen effective minimum and maximum;
- compatible multi-exposure basis attachment;
- source invalidation;
- confirmation, pregnancy-loss, and abortion exits;
- timing plus World Rule eligibility composition;
- Floor, Swipe, and stale-owner guards;
- authoritative persistence readback.

The built-in Human narrative preset is a versioned Product Policy preset,
not a medical-derived universal interval: `14 / 42` Story days, `10%`
variance, `3` Story-day variance cap, and `3` Story-day total adjustment cap.
It applies only when authoritative World/character context establishes
ordinary Human applicability, and only as the default for future cycles. The
Characters detail now exposes the formal Chat-local timing-config editor beside
the nickname action; existing Timing Instances remain frozen.

The Current Biological State modifier is `ZERO_V1` by intent. This is an
intentional boundary, not an omitted feature: no weak narrative signal is
allowed to alter timing.

### Timing semantics

```text
elapsed < effective_min       → before_min / not eligible
effective_min ≤ elapsed ≤ max  → window_open
elapsed > effective_max        → window_missed / not eligible
```

The maximum boundary is inclusive. A missed window is not backfilled later.
An active Projection's expiration still belongs to the existing Projection
evolution/expiration lifecycle; Timing `effective_max` only controls whether a
new pre-confirmation Projection may first be generated.

Variance is sampled once at the Timing Instance creation boundary and the
result is persisted. F5, reread, panel reopen, Projection Refresh, config edit,
and later State changes do not resample an existing instance. World Projection
Rules remain declarative and deterministic and prohibit `random`, `rng`,
`seed`, `probability`, and `weight` fields.

For an active compatible cycle, later compatible factual exposures attach as
additional basis references. They do not resample, move the anchor, or change
the frozen effective window. Timing Instance is deliberately not a complete
Pregnancy Exposure Tracking Window.

## Persistence Model

The validated persistence architecture is:

- Floor-owned derived facts and timelines;
- active-Swipe ownership;
- complete Floor Version guards;
- official save through the Floor Persistence Coordinator;
- authoritative readback after save;
- host-memory slot synchronization;
- stale-owner/epoch guards;
- immutable historical Floors;
- forward-only persistence.

Projection records and Timing records are separate Floor-owned timelines. Do
not bypass `floor-persistence-coordinator.js`, use message extras as a parallel
fact source, or introduce Chat-level derived state as a second authority.

The historical World F5/reload persistence overwrite issue is closed: the
known-good path synchronizes host memory and performs authoritative final
readback. This is not a current blocker and must not be reintroduced by a new
feature.

## Scheduler

The auto-analysis scheduler counts valid Character Floor progression, not a
physical difference between Floor numbers. User message/edit/delete actions do
not count. Switching an existing Swipe does not count. A true reroll/new Swipe
is considered through generation intent and a genuinely new Floor Version.

Successful analysis resets the counter. Failure keeps analysis due, subject to
the existing `retryPaused` contract. Do not replace this scheduler with a new
counter while working on Timing.

## Feature Status Matrix

Statuses are checkpoint labels, not permanent API guarantees.

| Feature | Status |
| --- | --- |
| World Model | PRODUCTION |
| World Full/Patch/Reuse | IMPLEMENTED / AUTOMATED VERIFIED |
| World Projection Rule Override | IMPLEMENTED / AUTOMATED VERIFIED; blocker resolved |
| Character Identity | PRODUCTION |
| Character Registry | PRODUCTION |
| Character Facts/Profile | IMPLEMENTED; derived Floor/runtime data, not an independent authoritative root |
| BiologicalEvent | PRODUCTION / AUTOMATED VERIFIED |
| Tracking Subject/Candidate | IMPLEMENTED / AUTOMATED VERIFIED |
| Tracking Window | NOT_IMPLEMENTED |
| StateReducer | PRODUCTION; lifecycle coverage remains bounded by implemented Event contracts |
| Pregnancy Episode | PARTIAL |
| Contributor Attribution | PARTIAL |
| Story Time elapsed | IMPLEMENTED |
| Current Biological State | PRODUCTION / IMPLEMENTED |
| Snapshot | IMPLEMENTED / AUTOMATED VERIFIED |
| Projection Core | IMPLEMENTED / AUTOMATED VERIFIED |
| Projection Runtime Integration | IMPLEMENTED / AUTOMATED VERIFIED; eligible Projection host smoke pending |
| Projection Context Injection | IMPLEMENTED / AUTOMATED VERIFIED; host context acceptance pending |
| Pre-confirmation Timing Config | IMPLEMENTED / AUTOMATED VERIFIED; host behavior pending |
| Observation Timing Instance | IMPLEMENTED / AUTOMATED VERIFIED; host behavior pending |
| Human narrative timing preset | IMPLEMENTED / AUTOMATED VERIFIED; host behavior pending |
| Characters timing config UI | IMPLEMENTED / AUTOMATED VERIFIED; host UI acceptance pending |
| Events UI | IMPLEMENTED / PRODUCTION consumer of validated data |
| Projection UI | PARTIAL |
| Overview | PARTIAL |
| GA/EDD | NOT_IMPLEMENTED; outside this task |
| Genealogy | PARTIAL; outside this task's timing boundary |

## Closed Problems — Do Not Reopen Without New Evidence

1. **World F5/reload persistence:** CLOSED; real-host persistence path has been
   verified. Do not treat the former host-memory overwrite as an open Timing
   problem.
2. **`pregnancy_relevant_exposure` evidence contract regression:** FIXED;
   automated coverage and a real-host example support the typed factual Event
   boundary.
3. **StateReducer uncertain-pregnancy semantic leak:** FIXED; the reducer's
   explicit Event contract and uncertain-history boundary are frozen.
4. **Projection Runtime Integration:** IMPLEMENTED / AUTOMATED VERIFIED. This
   is distinct from acceptance of an eligible Projection in a real host and
   from Timing behavioral smoke.
5. **World Projection Rule Override blocker:** RESOLVED under the deterministic
   host-ID and explicit-disable contract above.

Reopen any of these only with current production evidence, a reproducible
regression, or an explicit contract change.

## Known Open Items

- Pre-confirmation Timing real-host behavioral smoke;
- Tracking Window;
- completion of Contributor Attribution;
- GA/EDD;
- Genealogy;
- Overview completion;
- remaining real-host Projection verification.

The Human preset is intentionally a conservative narrative Product Policy, not
a medical standard, pregnancy-confirmation interval, symptom guarantee, or
universal exposure-anchored medical value. The research note preserves the
medical evidence and its anchor limitations. The preset does not create a World
Rule, infer capability, or provide a Runtime fallback when World Rules are
missing.

## Current Test Baseline

This is a checkpoint, not a permanent number:

```text
1113 total
1096 pass
17 fail
```

Sixteen failures are the known World Model prompt-baseline failures. One
additional unresolved Runtime concurrency/persistence failure is present in the
current run. The seven-test increase is from the Human preset, config-facade,
and Characters timing UI coverage added in this implementation. The current
Runtime failure signature is the `start-new-chat-lifecycle` case; the prior
checkpoint had two related Runtime signatures. This cannot currently be
attributed to Timing, but it also cannot be claimed proven unrelated to Timing.
Future verification must compare failure sets and signatures, not only failure
counts.

## Real Host Status

The current host model is SillyTavern direct source loading through the
manifest and `index.js`, using the remote third-party/BioWeave copy. No build is
required by the extension loading path.

The current source checkout contains a diagnostic surface for timing and
character timing configuration. Diagnostic reads are read-only. Controlled
fixture save/reset methods are explicit current-Chat configuration writes that
delegate to the official Chat-local persistence API; they do not expose
arbitrary Floor, World, Timing, Projection, or storage mutation. A dedicated
build/load audit verified that
the remote direct copy loads the current Phase 1 entry and that the diagnostic
surface is available after initialization and reload:

| Area | Status |
| --- | --- |
| Source-side diagnostic API present | VERIFIED |
| Live remote copy loading the current Phase 1 entry | VERIFIED |
| `__BIOWEAVE_DEBUG__` visible after init/reload | VERIFIED |
| Diagnostic timing/config reads callable and read-only | VERIFIED |
| Controlled timing-config fixture save/reset path | VERIFIED in source; host fixture use remains separate from product UI acceptance |
| Host build/load identity | VERIFIED |
| Timing behavioral smoke | PENDING |
| Host acceptance | PARTIAL / PENDING |

Build/load identity being VERIFIED is not behavioral Timing acceptance. The
next smoke run must verify timing identity, persistence, window boundaries, and
Projection lifecycle behavior separately.

## Documentation Conflicts and Evidence Notes

- `docs/DEVELOPMENT.md` contains older checkpoints. The current checkout
  checkpoint is `1113 / 1096 / 17` after adding seven focused tests. Use the
  current test run/failure signatures as the
  operational baseline and update the authoritative development document in a
  separately authorized documentation task if needed.
- Historical Timing task artifacts describe earlier design-only or pre-host
  stages. Current production code and current authoritative docs take
  precedence over those historical descriptions.
- An earlier probe observed `__BIOWEAVE_DEBUG__` as undefined. A subsequent
  dedicated build/load audit superseded that observation: the current remote
  loaded entry was verified to contain the Phase 1 diagnostic code, and the
  debug handle plus both read APIs were verified after initialization and
  reload. The build/load identity gate is closed; Timing behavioral acceptance
  remains open.

## Current Next Step

**NEXT STEP: Resume Pre-confirmation Timing real-host behavioral smoke.**

Prioritize:

1. first Timing Instance creation;
2. ordinary reread stability;
3. Projection Refresh stability;
4. F5 timing durability;
5. before min;
6. exactly min;
7. exactly max;
8. after max with no backfill;
9. Swipe isolation;
10. compatible multi-exposure;
11. source invalidation;
12. confirmation/loss/abortion exit.

Until Timing Host Acceptance is closed, do not enter Tracking Window work.
Human preset source research is complete as a documented Product Policy
boundary; real-host timing and Characters UI acceptance remain separate gates.

## Authoritative Reading Order

1. `docs/PROJECT-STATE.md`
2. `docs/ARCHITECTURE.md`
3. `docs/DATA-MODEL.md`
4. `docs/bioweave-data-lifecycle.md`
5. `docs/AUTO-ANALYSIS-SCHEDULER.md`
6. Relevant `.trellis/spec/domain/*`
7. The current active Trellis task
8. Current production code and tests

This document is navigation and checkpoint memory. Specific domain contracts
remain authoritative in their corresponding specs/docs and in validated current
production behavior.

## Documentation Maintenance Rule

Update this file when one of the following changes:

- a major domain feature is implemented;
- a feature status changes;
- a blocker is opened or closed;
- persistence ownership changes;
- a semantic invariant changes;
- a host-acceptance milestone is reached;
- roadmap priority changes.

Do not record every small bug, paste complete task history, preserve temporary
debug traces, write local absolute filesystem paths, or treat a particular HEAD
as a permanent contract.
