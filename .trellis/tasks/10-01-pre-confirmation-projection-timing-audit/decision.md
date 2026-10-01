# PRE-CONFIRMATION PROJECTION TIMING CONTRACT DESIGN

Status: DESIGN ONLY. This document is the implementation contract proposal for
the current checkout of `fix/world-model-prompt-baseline`. It does not change
production code, tests, UI, or existing schema.

## 1. PRODUCT DECISIONS — frozen

1. Character timing configuration is Chat-local. `character_registry` remains
   responsible only for canonical identity, display name, aliases, and identity
   history. Chat A and Chat B do not share timing configuration by name or alias.
2. An observation timing instance is a small persisted Projection/Timing-domain
   record. It is not a BiologicalEvent, Pregnancy Episode, Tracking Window,
   Current State, Snapshot, Projection Context, or Projection.
3. A compatible additional factual exposure attaches to the active cycle and
   does not re-sample or recompute frozen effective timing. A new cycle is
   created only after the prior cycle is terminal and a new valid basis exists.
4. F5, reload, panel reopen, reread, Refresh, Swipe switch, and true reroll do
   not define biological timing identity or automatically cause a re-roll.
5. Timing is frozen at creation: config, base values, variance policy, sampled
   offset, state modifier, cap, effective min/max, rule binding, source basis,
   and creation Floor Version are all historical facts of that timing record.
6. `elapsed < effective_min` is closed-before-min; `effective_min <= elapsed <=
   effective_max` is open; `elapsed > effective_max` is missed. The max boundary
   is inclusive. A missed window is never backfilled.
7. Randomness is outside World `projection_rule`. v1 samples once at creation
   and persists the result. No medical timing numbers are selected here.
8. A State modifier can consume only factual Current Biological State. If the
   current World Model contract cannot supply a reliable modifier, v1 uses zero.
9. Factual pregnancy confirmation exits this responsibility immediately.
   Pregnancy loss/abortion terminates the cycle without reopening its old
   timing. A later independent valid exposure may create a new cycle.
10. Human baseline composition belongs to the World Model authority boundary;
    Runtime never supplies a real-world Human fallback. Tracking Window remains
    NOT IMPLEMENTED.

## 2. CHARACTER TIMING CONFIG CONTRACT

### 2.1 Owner and key

The future authoritative owner is a Chat-owned metadata extension under the
existing `chat_metadata.bioweave`/Chat `settings` persistence boundary. The
recommended logical collection is `character_timing_configs`, keyed by the
canonical `character_id` in the current Chat/Floor identity domain:

```js
{
  schema_version: 1,
  character_id: "<canonical id>",
  config_version: "<stable version>",
  override: null | {
    base_min_story_days: <number>,
    base_max_story_days: <number>,
    variance_ratio: <number>,
    variance_cap_story_days: <number>,
    total_adjustment_cap_story_days: <number>
  }
}
```

This is a design DTO, not a request to change `storage/schema.js` now. The
collection is Chat-owned, not Floor-owned, and is never written through the
Floor persistence coordinator. A resolved read DTO may additionally expose
`source` (`built_in_human_baseline` or `user_override`) and `overridden`; those
are read-model fields, not another authoritative record.

`config_version` changes whenever the normalized override changes and is
stable for the same canonical ID, contract version, and normalized values. It
must not depend on display name, alias, UI order, or runtime execution. Values
must be finite and non-negative; max must not be less than min; ratio and both
caps must be bounded by contract validation. No medical values are defined here.

`override: null` is the explicit reset-to-default representation. Reset creates
a new config version but does not mutate historical timing instances. A config
may exist before the character becomes a `tracking_subject`; it must not be
created from a derived tracking list.

### 2.2 Lifecycle

- Chat switch reads only the target Chat's config collection.
- Ordinary Character/Floor clear does not clear Chat-owned config.
- Explicit Chat metadata clear removes it; Start New Chat starts with no copied
  character timing config.
- Alias/display-name edits leave the key unchanged.
- If a canonical registry identity is deleted or made inactive, its config is
  retained as an orphaned Chat-local record until the existing Chat-data clear
  policy removes it; it is never silently rebound to another character.
- A user edit affects only future timing cycles. Existing instances remain
  frozen.

## 3. OBSERVATION TIMING INSTANCE CONTRACT

### 3.1 Logical DTO

The minimum persisted creation record is conceptually:

```js
{
  schema_version: 1,
  timing_instance_id: "<stable id>",
  owner_type: "character_floor_projection_timing",
  chat_id: "<chat scope>",
  subject_id: "<canonical id>",
  mechanism_key: "<validated world mechanism>",
  observation_cycle_id: "<logical cycle id>",
  source_basis_refs: [{ event_id, event_version, floor_version }],
  reference_story_time: <story time anchor>,
  config_snapshot: {
    config_version,
    base_min_story_days,
    base_max_story_days,
    variance_ratio,
    variance_cap_story_days,
    total_adjustment_cap_story_days
  },
  sampled_offset_story_days: <bounded sampled value>,
  sampling_contract_version: "<version>",
  state_modifier_snapshot: {
    value_story_days,
    state_refs: [],
    state_contract_version: "<version>"
  },
  total_adjustment_story_days: <clamped total>,
  effective_min_story_days: <frozen value>,
  effective_max_story_days: <frozen value>,
  world_rule_binding: {
    projection_rule_id,
    mechanism_key,
    rule_contract_version
  },
  created_at_floor_version: "<complete six-field Floor Version>"
}
```

Field names are illustrative contract names, not an implementation mandate.
The record must preserve the source factual basis and snapshots needed to audit
why the result was obtained. It must not be added to `events`, Current State,
Snapshot, Context, or the Projection record itself.

### 3.2 Persistence shape

Use an append-only timing timeline owned by the same current Character/Floor /
active-Swipe Projection persistence boundary, conceptually a sibling of
`projection_timeline`, for example `projection_timing_timeline`. Keep creation
records and basis-attachment records immutable. A derived read model resolves
the current cycle and status. Do not create a mutable blob whose history is
lost, and do not turn timing into the unimplemented Tracking Window.

There is no persisted status enum in v1. Invalidation, confirmation, loss,
abortion, before-min, open, and missed are derived from immutable records,
current valid factual Events, Story Time, and the active World rule. A future
administrative correction, if ever needed, should be an explicit append-only
action rather than an in-place rewrite.

## 4. OBSERVATION CYCLE IDENTITY

### 4.1 Identity layers

- **Logical cycle identity:** stable biological observation identity for one
  subject/mechanism round.
- **Execution identity:** runtime fingerprint/single-flight identity for one
  evaluation attempt. It must never create a cycle.
- **Floor persistence owner identity:** Chat + message/Floor + active Swipe +
  complete Floor Version owner used for legal writes.
- **Projection identity:** existing deterministic identity for one generated
  Projection. It is not the timing identity.

The cycle identity is conceptually a digest of the contract version, Chat scope,
canonical subject, validated mechanism, and immutable identity of the first
accepted factual basis. Additional compatible bases are attachments and do not
change the cycle ID. The timing instance ID is derived from cycle identity plus
the frozen rule/config binding, not from a random seed or UI action.

### 4.2 Compatibility and fail-closed behavior

An additional basis is compatible only when all of the following are proven by
current contracts: the Event is valid in the active Swipe/Floor; its pregnancy
relevance is factual and valid; the explicit gestational subject is the same
canonical subject; the normalized mechanism key is the same; the source Event
identity/version is valid; and its World rule binding is compatible with the
frozen binding. Names, aliases, gender, role/position, absence of menstruation,
and natural-language similarity are not compatibility evidence.

If compatibility cannot be established, return unresolved and do not attach,
re-sample, or silently start a replacement cycle. This is the v1 extension
point for richer mechanism-specific compatibility, not a license to infer
biology outside the Event/World contracts.

## 5. TIMING LIFECYCLE / DERIVED STATUS

The v1 derived status precedence is:

1. `source_invalidated` — no attached basis remains valid;
2. `confirmed` — factual pregnancy confirmation is established;
3. `terminated_by_loss_or_abortion` — an explicit terminating fact exists;
4. `window_missed` — no terminal factual exit and elapsed time is above max;
5. `before_min` — elapsed time is below min;
6. `window_open` — elapsed time is within the inclusive window;
7. `unresolved` — required timing/rule/basis comparison cannot be proven.

`active/open` is a read-model concept covering `before_min` and `window_open`;
it is not a new Tracking Window lifecycle. No status is stored in v1. An
instance is terminal for cycle reuse when its derived factual/lifecycle result
is `source_invalidated`, `confirmed`, `terminated_by_loss_or_abortion`, or
`window_missed`. A future independent valid basis may then create a new cycle.

## 6. ELIGIBILITY COMPOSITION

Timing is a second gate inside the existing Projection eligibility path, not a
UI calculation and not a replacement for World Rule evaluation:

```text
validated World Rule eligibility
AND
pre-confirmation timing eligibility
AND
no existing active logical Projection
        -> allow Projection generation
```

The future timing adapter should be called from the existing
`evaluateProjectionEligibility()`/runtime path after the factual basis and
World mechanism are known. It must return a structured result that the
existing evaluator can combine, rather than making the UI reproduce the logic.

The timing result maps as follows:

| Condition | Result |
| --- | --- |
| no valid basis | not eligible: `timing_basis_missing` |
| basis/mechanism/rule comparison ambiguous | unresolved: `timing_basis_unresolved` |
| elapsed below effective min | not eligible: `timing_before_min` |
| inclusive min through max | eligible: `timing_window_open` |
| elapsed above effective max | not eligible: `timing_window_missed` |
| factual confirmation | not eligible: `pre_confirmation_exited_confirmation` |
| loss/abortion | not eligible: `pre_confirmation_exited_termination` |
| all attached bases invalid | not eligible: `timing_source_invalidated` |

The existing World Rule outcomes remain authoritative: no rule remains
`projection_rules_unavailable`; unknown capability, source compatibility, or
contributor remains unresolved; an active Projection remains
`active_projection_exists`. Runtime must not synthesize a rule or Human timing
fallback. A resolved `window_missed` instance is retained for audit but cannot
generate a late Projection.

## 7. PROJECTION EVOLUTION INTEGRATION

Preserve the current Projection evolution order:

```text
realization -> contradiction -> expiration
```

The timing instance's `effective_max` gates only first generation. It must not
be treated as a second expiration lifecycle for an already active Projection.
Existing Projection `expiration.trigger` and evolution remain responsible for
active Projection expiration. This preserves the distinction between “never
generated because the pre-confirmation window was missed” and “an existing
Projection expired”.

Factual confirmation closes the pre-confirmation responsibility. If the current
World Rule can express confirmation as realization, use the existing
realization path and provenance. If an adapter is needed, it must call the
existing terminal/evolution primitive with the factual Event reference; it must
not invent a new parallel lifecycle or factual Event. Loss/abortion similarly
uses the existing rule-compatible terminal/contradiction primitive, or a
minimal evolution extension only if current rule semantics cannot represent the
terminal result. Neither transition creates pregnancy, conception, symptom, or
Current State facts.

## 8. HUMAN BASELINE COMPOSITION CONTRACT

Current code evidence shows `humanBaseline()` supplies Human capabilities and
reproduction rules; it does not currently supply projection timing. The design
boundary is therefore:

```text
built-in Human biological baseline
  + permitted World evidence / delta / override
  -> World Model authority composition
  -> normalize + validate projection_rules[]
  -> persisted declarative World Model
  -> Projection Runtime
```

### Full model

When the authoritative World Model type is ordinary Human, compose the built-in
baseline exactly once before normalization. Nonhuman or unresolved types do not
receive it. Explicit World evidence that changes a Human mechanism is applied
as a validated override/delta; the final World authority wins over the built-in
default. No numerical baseline is selected in this document.

### Patch model

Apply a validated patch to the authoritative World Model, then rerun the same
composition and normalization boundary. Semantic deduplication must happen
before persistence so a patch cannot append duplicate baseline rules. A stable
rule identity should be derived from the normalized semantic rule content plus
the mechanism contract version; explicit override content changes that identity
deterministically.

The current Patch v2 supports `ADD_PROJECTION_RULE` but has no explicit disable
or remove operation. Therefore omission/empty `projection_rules` must mean “no
explicit World evidence”, not “disable the applicable built-in Human baseline”.
An explicit disable contract is a real schema/validator gap for a future change.
Until it exists, do not pretend that an empty AI list can disable baseline.

Fantasy/modified Human must carry an explicit World type/evidence/override that
changes the composition decision. Nonhuman, archived, or unresolved species
must not inherit Human timing merely because a character is human-named or has
an apparent gender.

## 9. CONFIG PERSISTENCE CONTRACT

Conceptual APIs, to be implemented later without exposing storage details to
the UI:

- `getCharacterTimingConfig(chat_scope, character_id)` returns the resolved
  default/override DTO and `config_version`.
- `saveCharacterTimingConfig(chat_scope, character_id, override,
  expected_config_version)` performs an optimistic Chat-owned write.
- `resetCharacterTimingConfig(chat_scope, character_id,
  expected_config_version)` writes `override: null` with a new version.

The implementation should reuse the current `storage/store.js` Chat read/write
boundary (`getChat()`/`saveChat()`), Chat token/owner checks, and official adapter
save/readback. It must not use `floor-persistence-coordinator.js`, because the
config is not a Floor fact. A stale expected version must fail without
overwriting a newer user edit. After a successful save, the returned official
Chat readback is authoritative.

The canonical ID used by this API must come from the current valid registry
identity domain. Alias editing can update display data but cannot change the
config key. A config write must not create a tracking subject or Event.

## 10. FLOOR TIMING PERSISTENCE CONTRACT

Timing instances are Floor-owned even though character config is Chat-owned.
The future persistence path should reuse the existing Projection storage and
Floor coordinator invariants:

- owner is the current Chat/message/Floor and active Swipe;
- writes require the complete exact six-field Floor Version;
- historical Floors remain immutable;
- stale async results are rejected by owner/epoch/version guards;
- official adapter save/readback is the source of truth;
- host-memory synchronization and sibling preservation follow the existing
  Projection persistence path;
- readback filters to surviving messages, active Swipes, and valid complete
  versions before resolving the timeline.

The new timing sibling must not be read from `message.extra`,
`message.swipe_info[swipe_id].extra`, or a Chat-level derived map. It must not
be copied into Snapshot or Current State. Deleting a Swipe removes access to
that Swipe's timing owner; another Swipe cannot read it as its own fact.

Creation and basis attachment are append-only. A timing record may be read by
Projection eligibility and debug explainability, but it is not Event evidence,
does not enter Event Analyzer input as evidence, and cannot create a self-
evidence loop through Projection Context.

## 11. STALE / EDIT / DELETE / SWIPE RULES

| Change | Contract action |
| --- | --- |
| Source Event deleted | Preserve historical timing record; remove the basis from the valid read set. Keep the cycle only if another compatible basis survives; otherwise derive `source_invalidated`. Never re-sample. |
| Source Event edited out of pregnancy relevance | Same as deletion for eligibility. Historical creation remains immutable. |
| Source Event remains relevant but identity/version changes | Old basis is invalid for current eligibility; do not silently rewrite or re-sample the old instance. An unambiguous later valid basis may create a new cycle only under terminal-cycle rules. |
| One of several bases disappears | One remaining compatible basis is sufficient. If remaining bases conflict or compatibility cannot be proven, fail closed as unresolved. |
| Alias/display name changes | No timing action; canonical ID is unchanged. |
| Character config edit/reset | Future cycles only; all existing snapshots remain frozen. |
| World Model Full/Patch changes mechanism/rule | Existing instance remains frozen. A changed binding cannot silently attach new bases; unresolved/fail-closed until a new valid cycle is created. |
| Existing Swipe switch | Read only that Swipe's timing records. Do not create or re-randomize. |
| True reroll/new Swipe | No automatic timing action. A new instance requires a new valid factual basis in the active Swipe/Floor and no reusable active compatible cycle. |
| Factual pregnancy confirmation | Derive confirmation exit; stop pre-confirmation generation and use existing Projection terminal/evolution primitive where applicable. |
| Pregnancy loss/abortion | Derive terminal termination; do not reopen old timing or Projection. A later independent exposure may start a new cycle. |
| Stale async result | Reject the write; preserve the current official Floor state. |

The “new cycle” rule is deliberately conservative. It does not define a
complete exposure-tracking window and does not use real-world assumptions to
join Events.

## 12. UI DTO / API CONTRACT

The future Characters detail header seam is the existing detail-header action
creation/binding in `ui/characters.js`, where the current “编辑昵称” action is
rendered. The intended order is `[推演周期] [编辑昵称]`. `ui/app.js` remains
the route/application integration owner; no UI implementation is part of this
task.

The editor's read DTO contains only:

```js
{
  character_id,
  display_name,
  config_version,
  effective: {
    base_min_story_days,
    base_max_story_days,
    variance_ratio,
    variance_cap_story_days,
    total_adjustment_cap_story_days
  },
  overridden
}
```

`display_name` is display-only. Save accepts a normalized override and an
expected version; reset uses the same optimistic version boundary. The UI does
not receive raw sampled values, Floor persistence, source Event IDs, World Rule
internals, or eligibility implementation details unless a separate debug mode
explicitly requests a debug DTO.

## 13. DEBUG / EXPLAIN DTO

The evaluator, not the UI, owns explainability. A minimal read-only explain DTO
should include:

```js
{
  subject_id,
  timing_instance_id,
  status,
  reason_code,
  eligible_for_generation,
  valid_basis_ids,
  effective_min_story_days,
  effective_max_story_days,
  elapsed_story_days,
  world_rule_status,
  capability_status,
  source_compatibility_status,
  contributor_status,
  existing_projection_id
}
```

Minimum reason codes are:
`projection_rules_unavailable`, `timing_basis_missing`,
`timing_basis_unresolved`, `timing_before_min`, `timing_window_open`,
`timing_window_missed`, `capability_unresolved`,
`source_compatibility_unresolved`, `contributor_unresolved`,
`active_projection_exists`, `pre_confirmation_exited_confirmation`,
`pre_confirmation_exited_termination`, and `timing_source_invalidated`.
The DTO is explanatory only and cannot be fed back as Event evidence.

## 14. IMPLEMENTATION TEST MATRIX

Future implementation must cover at least:

1. same basis repeated execution does not duplicate or re-sample;
2. multiple compatible exposure Events attach to one active cycle;
3. F5/reload readback preserves the instance;
4. Projection Refresh preserves the instance;
5. config edit affects a future cycle only;
6. source Event deletion invalidates only what no longer has a valid basis;
7. source Event edit-out-of-scope fails closed;
8. source Event relevant identity/version edit never silently re-samples;
9. existing Swipe switch is isolated;
10. true reroll/new Swipe does not itself randomize;
11. Story Time before min;
12. exactly min is eligible when World Rule gates pass;
13. exactly max is eligible;
14. after max is missed and never backfilled;
15. factual confirmation exits pre-confirmation;
16. loss/abortion terminates without reopening;
17. Human baseline Full composition;
18. Human baseline Patch composition without duplication;
19. fantasy/modified Human explicit override;
20. nonhuman receives no Human fallback;
21. stale async result cannot write;
22. official host save/readback survives reload;
23. Context injection remains non-factual Event evidence;
24. zero State modifier and total-cap clamping;
25. alias change preserves canonical config/timing;
26. orphaned/deleted registry identity is not silently rebound;
27. immutable historical Floor records remain unchanged.

## 15. MINIMAL FILE CHANGE PLAN

This is a future implementation map, not a change list for the current DESIGN
ONLY phase:

- `core/character-timing-config.js` (or the smallest existing config owner):
  normalize, validate, version, resolve baseline/override;
- `core/projection-timing.js`: cycle identity, frozen arithmetic, derived
  status, compatibility, and explain result;
- `storage/store.js` and the smallest Chat-owned schema extension: official
  config read/write/reset with optimistic versioning;
- `storage/schema.js` plus the existing Floor owner path: only after the
  lifecycle contract is accepted, add the timing timeline sibling;
- `storage/projection.js` or a narrowly adjacent timing persistence module:
  reuse existing Floor/Swipe/version guards and readback;
- `runtime/projection-runtime.js` and `core/projection-eligibility.js`:
  compose timing with World Rule eligibility;
- World Model normalization/patch boundary in `ai/analyzer.js` and prompts:
  compose/dedupe Human baseline and later add explicit disable only through a
  separately approved schema contract;
- `ui/characters.js` and `ui/app.js`: future DTO/API integration only;
- focused tests for the matrix above.

No file in this future map is modified by this design phase.

## 16. DOCS / SPEC CHANGE PLAN

Future implementation must update, as applicable, the authoritative:

- `.trellis/spec/domain/floor-state.md` for the new Floor-owned timing sibling;
- `.trellis/spec/domain/event-pipeline.md` for timing/source provenance and the
  explicit non-evidence boundary;
- `.trellis/spec/domain/pregnancy-tracking.md` to keep Tracking Window marked
  NOT IMPLEMENTED and distinguish timing cycles from tracking;
- the World Model spec/prompt contract for Human baseline composition and the
  explicit-disable gap;
- `docs/DATA-MODEL.md`, `docs/ARCHITECTURE.md`, and
  `docs/bioweave-data-lifecycle.md` for ownership, persistence, and clear rules;
- `docs/DEVELOPMENT.md` for the implementation/test contract.

The design-only phase changed only Trellis task artifacts. The subsequent
approved World Model blocker implementation also synchronizes the existing
World Model specification and the related data-model, architecture,
development, and lifecycle Markdown documents.

## 17. REMAINING TRUE BLOCKERS

The previous blocker is resolved by the minimal evidence-bound
`Projection_Rule_Override` -> `DISABLE_PROJECTION_RULE` contract. No remaining
product blocker was found within the approved scope. A future schema version
may add richer replacement/administrative correction semantics, but it is not
needed for the current baseline disable requirement.

The pre-confirmation timing feature remains unimplemented by design; its
separate contract is not changed by this World Model patch.

## Final contract

PRE_CONFIRMATION_TIMING_CONTRACT:
- PREVIOUS_BLOCKER: World Model Patch v2 lacked explicit projection-rule baseline disable/remove/override semantics.
- BLOCKER_RESOLVED: YES — implemented evidence-bound disable-only override at the World Model authority boundary.
- CHARACTER_CONFIG_SCOPE: Chat-local; keyed only by canonical character_id in the current Chat identity domain.
- CHARACTER_CONFIG_OWNER: Chat-owned bioweave settings/metadata extension, separate from character_registry and Floor state.
- TIMING_INSTANCE_OWNER: Floor-owned, active-Swipe, Character Projection/Timing timeline sibling with exact Floor-Version provenance.
- CYCLE_IDENTITY: Stable digest of Chat scope + canonical subject + validated mechanism + immutable first accepted factual basis; execution/UI identity is separate.
- MULTI_EXPOSURE_POLICY: Compatible additional factual exposures attach to the active cycle without resampling; ambiguous compatibility fails closed; terminal cycle permits a later independent cycle.
- RANDOMNESS_POLICY: One bounded sample at first timing-instance creation, persist the sampled offset and snapshots, never re-sample on reread/Refresh/config change.
- STATE_MODIFIER_POLICY: Factual Current Biological State only, bounded by total cap, frozen per instance; v1 may be zero; no Context or narrative mood input.
- MIN_BOUNDARY: elapsed < effective_min is not eligible; min is inclusive.
- MAX_BOUNDARY: effective_min <= elapsed <= effective_max is open; elapsed > effective_max is missed and never backfilled; max is inclusive.
- CONFIRMATION_EXIT: Factual pregnancy_confirmation immediately exits pre-confirmation timing; reuse existing Projection terminal/evolution primitive where applicable.
- LOSS_ABORTION_EXIT: Terminate the current cycle and do not reopen old timing/Projection; a later independent valid exposure may create a new cycle.
- HUMAN_BASELINE_BOUNDARY: Built-in Human baseline is composed with World evidence at World Model authority, then normalized/validated/persisted as declarative projection_rules.
- RUNTIME_FALLBACK: None; Runtime consumes only validated World Model rules.
- TRACKING_WINDOW_STATUS: NOT IMPLEMENTED; timing instance/cycle is not a Tracking Window.
- IMPLEMENTATION_READY: YES for the World Model baseline-override boundary; pre-confirmation timing production implementation remains a separate future phase.

## World Model projection rule override blocker — audit/design addendum

### Current implementation conclusion

There is no existing safe override primitive. The real path is:

```text
Fact Delta JSON
-> parseWorldModelFactDeltaJson()
-> resolveWorldModelFactDelta()
-> validateV2Operation()
-> classifyWorldModelPatchV2()
-> v2ValidateStructuredOperationEvidence()
-> mergeWorldModelPatchV2Classified()
-> World Floor owner patch/readback
-> normalizeWorldModel()
-> Projection Runtime consumes final projection_rules
```

`ADD_PROJECTION_RULE` rejects an AI-supplied ID. `normalizeProjectionRules()`
generates the ID from canonical rule content. Classification is keyed by that
ID: equal content is `NO-OP`; an ID collision with different content is
rejected. `v2ApplyAddProjectionRule()` only appends a new rule. `SET_FIELD`
cannot target `projection_rules`, and the current World Model spec explicitly
states that Existing rule update is blocked. Therefore deterministic identity
collision is not replacement, and Full rebuild is not an active Patch override.

The active World Model is persisted through the existing World owner patch and
Floor Version/readback path. Historical Floors retain their old `world_model`
snapshot. A later authoritative Floor may contain a different final rule set;
this does not rewrite history. Runtime already consumes only the normalized
active Floor model and has no disabled-rule blacklist.

### Selected minimal contract

Add one explicit internal Patch v2 operation:

```js
{
  op: "DISABLE_PROJECTION_RULE",
  projection_rule_id: "projection_rule_<stable id>",
  reason: "<explicit world contradiction/non-applicability>",
  source_evidence: ["<permitted evidence reference>"],
}
```

The wire remains the existing Fact Delta language: add a dedicated
world-scoped `Projection_Rule_Override` fact whose payload explicitly states
`action: "disable"`, the target `projection_rule_id`, a non-empty reason, and
evidence. It must not accept an empty projection rule, a missing action, an
AI-created new rule identity, or a generic text instruction. The deterministic
resolver converts this fact into the internal operation; no second Patch
language is introduced.

The operation is intentionally disable-only in v1. Replacement is expressed as
one explicit disable fact plus one ordinary `ADD_PROJECTION_RULE` fact. The
merge result removes the target from the new active `projection_rules[]`; it
does not mutate historical Floors, rewrite existing Projection records, or
introduce a Runtime blacklist. The target must exist in Existing and must be a
baseline rule or otherwise explicitly supported World rule identity; unknown
targets fail closed.

The disable fact requires permitted current World evidence and an explicit
contradiction/non-applicability assertion. Omission, uncertainty, no-evidence,
an empty array, or a merely different proposed rule cannot disable anything.
Nonhuman worlds do not inherit Human baseline rules and therefore do not need a
disable operation for baseline avoidance. Human baseline identity is generated
deterministically from a stable baseline contract/version and logical rule
content, never from AI text, message ID, Floor ID, or randomness. A derived
World-specific rule uses a separate namespace/versioned identity material so it
cannot collide accidentally with the baseline namespace.

### Full and Patch semantics

- Full composition decides whether the Human baseline applies before final
  normalization. Explicit World contradiction prevents that baseline from
  entering the final rule set; Full output is the complete authoritative set.
- Patch omission preserves the Existing rule set.
- Patch `ADD_PROJECTION_RULE` adds only a new deterministic rule and is a
  no-op on identical content.
- Patch `DISABLE_PROJECTION_RULE` removes exactly the explicitly identified
  target from the new active set after evidence validation.
- A disable followed by an add is deterministic: the final active set contains
  the new rule only when the add has a distinct valid identity.
- Empty `projection_rules` in AI output cannot clear Existing or baseline rules.

### Existing Projection impact

Disabling a World rule prevents new generation under that rule. Existing active
Projections are historical records and are not deleted or retroactively
rewritten. Their normal realization/contradiction/expiration lifecycle remains
unchanged; a new `rule_disabled` Projection terminal lifecycle is out of scope
unless a separate product decision establishes it. This keeps World authority
override separate from Projection lifecycle.

### Persistence and stale behavior

The implementation must use the existing World Floor owner, active Swipe,
complete Floor Version, official save/readback, host-memory synchronization,
and stale owner guards. A stale Patch cannot disable a rule. The final active
World snapshot is validated and persisted as a complete normalized model; the
Runtime reads that model directly.

## World Model override final contract

WORLD_PROJECTION_RULE_OVERRIDE:
- EXISTING_OVERRIDE_PRIMITIVE: None; prior `ADD_PROJECTION_RULE` supported only deterministic add/no-op/reject.
- SELECTED_STRATEGY: Evidence-bound disable-only `Projection_Rule_Override` Fact -> internal `DISABLE_PROJECTION_RULE`; replacement is disable plus distinct add.
- BASELINE_RULE_IDENTITY: Existing `buildProjectionRuleId()` deterministic canonical-content identity; AI cannot provide the ID. A future baseline namespace/version may refine composition identity without changing this disable boundary.
- OMISSION_BEHAVIOR: Preserve Existing active rules; empty arrays cannot clear them.
- EXPLICIT_CONTRADICTION_BEHAVIOR: Require `action: "disable"`, exact existing rule content, explicit contradiction/non-applicability reason, and permitted current World evidence; otherwise fail closed.
- FULL_BEHAVIOR: Compose applicable Human baseline and explicit World overrides before final normalization; Full output is the complete authoritative rule set.
- PATCH_BEHAVIOR: Preserve omission, dedupe identical add, disable only an existing target, and allow replacement as disable plus a distinct add.
- RUNTIME_DISABLED_RULE_BLACKLIST: None; Runtime consumes only the final validated active `projection_rules[]`.
- HISTORICAL_FLOOR_BEHAVIOR: Historical World snapshots and existing Projection records remain immutable; only the new active Floor authority changes.
- IMPLEMENTED: YES.
- VERIFIED: Focused override/timing tests, syntax checks, diff check, and `npm run check` executed; Phase 1 full check is 1106 total, 1090 pass, 16 fail. The remaining failures are the existing World Model prompt-baseline assertions.

## Phase 1 implementation decisions

- Character timing config is persisted in Chat metadata under
  `settings.character_timing_configs`, keyed only by canonical character ID.
  Reset removes the override; baseline resolution is explicit and does not
  introduce medical values in Runtime.
- Timing instances are immutable creation records in the sibling
  Floor-owned `projection_timing_timeline`; additional compatible exposure
  Events append basis records. The existing Floor coordinator and authoritative
  readback remain the only persistence path.
- V1 compatibility is strict same subject plus same explicit mechanism key and
  a currently valid pregnancy-relevant Event. Cycle identity is deterministic
  from Chat, subject, mechanism, and first Event basis; UI/runtime rereads,
  Refresh, F5, Swipe selection, and RNG are not identity inputs.
- V1 sampling uses the configured window midpoint as reference days, samples a
  signed bounded offset once, clamps the total adjustment to the configured
  total cap, and persists effective min/max. State modifier is frozen at zero.
- `effective_max` gates only first generation. Existing Projection evolution
  remains realization → contradiction → expiration. Source invalidation is
  derived fail-closed; no Event/State/Snapshot fact is created by timing.

## Phase 1 verification ledger

Focused timing/lifecycle/Projection tests pass 27/27. Full `npm run check`
after implementation is 1106 total, 1090 pass, 16 fail. Compared with the
recorded pre-Phase-1 baseline of 1102 total, 1085 pass, 17 fail, there are no
new failures; the prior Manual Full/Patch persistence failure is resolved and
the remaining 16 are the existing World Model prompt-baseline assertions.
