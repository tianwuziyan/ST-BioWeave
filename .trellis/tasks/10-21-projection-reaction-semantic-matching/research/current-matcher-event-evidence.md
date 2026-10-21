# Research: Current observed-reaction matcher and Event evidence

- Query: Audit the observed-reaction matcher from BiologicalEvent extraction through Projection Runtime DTO; explain why only nausea matches, inventory structured physical_symptom fields/kinds, describe negation/fiction/intervention/subject/time representation, and identify safe evidence available without re-reading raw narrative.
- Scope: internal
- Date: 2026-10-21

## Findings

### 1. End-to-end path and exact reason only nausea matches

The production path is:

`current valid Floor -> eventAnalysis.collectActiveBusinessData() -> projection-runtime.collectInputs() -> dtoFromViews() -> matchBuiltInObservedReaction() -> toProjectionDTO()`.

- `runtime/events.js:2951-2971` constructs Projection inputs from the current BioWeave Floor and `collectActiveBusinessData()`. The matcher receives `business.active_events`, plus current state, timing, and World Model; it does not independently search chat text.
- `runtime/event-analysis.js:3576-3588` exposes `active_events`, current state, current Story Time, and current health state as derived business data. `runtime/event-analysis.js:3460-3472` shows the event-state debug projection is derived from active events and includes each event's structured DTO and source/provenance metadata.
- `runtime/projection-runtime.js:150-174` calls the matcher only for built-in stage projections, then inserts only `{observed_reaction: {matched: boolean}}` into the product Projection DTO. Full matcher details are retained only in the optional debug link at `runtime/projection-runtime.js:160-184` (`matched_event_ids`, `matched_kind`, `reason_code`, subject and projection IDs).
- The built-in schedule defines 12 branches at `core/projection-eligibility.js:12-61`: `fatigue`, `breast_sensitivity`, `scent_food_change`, `no_reaction_early`, `nausea`, `odor_discomfort`, `mood_change`, `appetite_change`, `nausea_worsening`, `vomiting`, `persistent_fatigue`, and `no_reaction_late`.
- The decisive defect is `core/projection-eligibility.js:225-235`: after resolving a branch, the matcher returns immediately with `UNSUPPORTED_OBSERVED_REACTION_BRANCH` unless `branch.key === 'nausea'`. Thus the other 11 branches cannot reach the common subject, health-role, status, and Story Time checks, regardless of their structured Event data.
- For the one supported branch, matching is exact and structured (`core/projection-eligibility.js:241-268`): `state_fact.subject_id` must equal the Projection subject; Event type must be `physical_symptom`; status must be `confirmed`; `healthAssessmentEligibility()` must accept it; `payload.symptom.kind` must equal the branch key; and `differenceStoryTime(event.story_time, referenceStoryTime)` must be a day-valued difference inside the branch's configured min/max window.
- Existing tests encode this behavior at `tests/projection-eligibility.test.js:228-244`: an exact `nausea` kind matches; a different subject does not; an `odor_discomfort` projection does not match even with a nausea Event; events outside days 21–27 do not match; intervention and negated Events do not match. The test's `odor_discomfort` Event at line 239 is evidence that the current matcher gate, not merely the kind inventory, is the blocker.

### 2. Structured `physical_symptom` shape and kinds

The canonical Event domain defines:

- Event type `physical_symptom` at `core/events.js:13-31`.
- A state fact is mandatory for this type, with a participant-bound `state_fact.subject_id`, at `core/events.js:564-588`.
- The payload must be exactly `{symptom: ...}` for `physical_symptom`, at `core/events.js:547-550`.
- The health fact record accepts `kind`, optional `description`, optional `body_site`, optional `laterality`, optional `continuation`, and optional `health_role`, at `core/events.js:449-479`.
- `laterality` is constrained to `left | right | bilateral | midline | unknown` at `core/events.js:49-55`; `health_role` is `observation | intervention` at `core/events.js:53-55`.
- The shared `HEALTH_FACT_KINDS` inventory is `abrasion`, `amputation`, `bleeding`, `bruise`, `burn`, `contusion`, `disease`, `diagnosed_disease`, `fatigue`, `fever`, `fracture`, `heart_disease`, `infection`, `injury`, `laceration`, `nausea`, `pain`, `pain_and_soreness`, `soreness`, `sprain`, `swelling`, `vomiting`, and `wound` (`core/events.js:57-91`).
- Important asymmetry: the Event validator requires a non-empty `kind` but does not restrict `physical_symptom.symptom.kind` to `HEALTH_FACT_KINDS` (`core/events.js:453-479`, `547-550`). The supported-kind check is applied to `other_biological` by `healthAssessmentEligibility()` (`core/health-assessment.js:62-67`). Therefore a physical symptom may carry a domain-specific/open kind such as the fixture's `physical_soreness` (`tests/fixtures/real-event-output-reroll.json:102-150`), even though that kind is absent from the shared inventory.
- The AI boundary intentionally allows the same structured health identity fields for `physical_symptom`, `medical_event`, and `other_biological`: `ai/analyzer.js:2925-2950` validates those fields, and `ai/analyzer.js:3035-3043` routes the type-specific payload. The prompt states the required physical symptom shape and that body site must come from explicit narrative evidence, not inference (`ai/prompts.js:80` and the health-field guidance in the nearby Event contract block).

### 3. Negation, fiction, intervention, and subject semantics

- Negation and fiction are Event-level statuses, not symptom fields. `EVENT_STATUS` includes `confirmed`, `probable`, `ambiguous`, `negated`, and `fictional` (`core/events.js:5-11`). The matcher delegates acceptance to `healthAssessmentEligibility()`, which rejects `negated` and `fictional` (`core/health-assessment.js:62-73`). It does not currently accept `probable` or `ambiguous` as observed health facts because eligibility requires `health_role === 'observation'`, a valid subject, and non-empty source evidence; the status itself is not otherwise restricted.
- Intervention is carried by `state_fact.payload.symptom.health_role: 'intervention'` (or the analogous `fact` record for other health Event types), not by a separate Event type. `core/health-assessment.js:56-80` explicitly returns `health_intervention_not_assessment_eligible`; the matcher therefore excludes interventions through the health-assessment gate. This is a deliberate domain boundary: the Event remains historical evidence, but it must not become a current observation or reaction match.
- The matcher uses `event.state_fact.subject_id` at `core/projection-eligibility.js:235-245`; it does not infer a subject from `participants[0]`, display name, event role, or pregnancy relevance. The domain validator requires that subject ID to be present in the Event's participant IDs (`core/events.js:581-587`). This is the safe subject-local seam for future branch matching.
- Runtime input is already rebuilt from active, current Floor-owned Events (`runtime/events.js:2951-2965` and `runtime/event-analysis.js:3576-3588`). This preserves the Floor/Swipe provenance boundary: a matcher extension should consume the supplied active Event DTOs and not re-read `message.extra`, Swipe text, or chat-level caches.

### 4. Time representation and current time gate

- Event Story Time is a structured object containing `display`, `normalized`, `day_index`, `calendar_id`, `precision`, and `confidence` (`core/events.js:167-175`). `core/events.js:380-397` normalizes it through the shared Story Time module.
- The matcher compares the Event's Story Time to the Projection timing reference at `core/projection-eligibility.js:236-263`, using `differenceStoryTime()` rather than raw text or host message order. It requires a `day` difference and enforces the branch's inclusive min/max elapsed-day window. Missing/incomparable time, a non-day unit, or an out-of-window value fails closed.
- The built-in windows are explicit in `core/projection-eligibility.js:14-50`: 14–20 days for early subtle changes, 21–27 for early reactions, and 28–42 for more obvious reactions. The matcher receives `reference_story_time` from `projectionView.timing`, not from the current narrative.

### 5. Safe evidence available without re-reading raw narrative

Safe structured evidence already available to a matcher extension:

- Event identity and type: `event_id`, `type`, `status`.
- Subject identity: `state_fact.subject_id`, with participant closure validated by the Event domain; canonical participant IDs and event roles are available in `participants`.
- Structured symptom fact: `state_fact.payload.symptom.kind`, `description` (display/evidence only), `body_site`, `laterality`, `continuation`, and `health_role`.
- Factual timing: normalized `event.story_time` and the Projection's `timing.reference_story_time`; compare only via the shared Story Time functions.
- Source/provenance: `event.source` contains chat/message/floor/swipe/content-hash/message-version fields (`core/events.js:367-377`), and `runtime/event-analysis.js:3464-3472` retains source information for diagnostics. These fields allow Floor/Swipe validity and evidence identity to be traced without reopening narrative text.
- Event evidence presence: `source_evidence` is normalized into `{kind, text}` records (`core/events.js:268-280`, `380-397`), and health eligibility only requires a non-empty array (`core/health-assessment.js:67-73`). The actual `text` is narrative-derived and should not be re-read by the matcher for semantic classification; use the structured `kind`/fields and event status/role instead.
- Existing Projection debug evidence is already bounded to IDs and reason codes (`runtime/projection-runtime.js:160-168`), and product DTO deliberately exposes only the boolean match (`runtime/projection-runtime.js:142-144`). This is the right separation for adding richer internal matching diagnostics without leaking raw narrative into the product Projection UI.

The safe extension seam is therefore the common post-branch gate inside `matchBuiltInObservedReaction()` (`core/projection-eligibility.js:225-278`): map each branch to one or more structured symptom kinds (or an explicit structured predicate), retain the existing subject/status/health-role/time checks, and return event IDs/kind/reason codes. Do not infer symptom kinds from `description` or `source_evidence.text`, and do not make the Projection DTO a second fact source.

## Related specs

- `.trellis/spec/domain/event-pipeline.md`: BiologicalEvent is the factual source; Projection is downstream and must not replace or mutate Event facts. Health observations and interventions are separate semantic roles.
- `.trellis/spec/domain/floor-state.md`: only the current valid active-Swipe Floor owns usable facts; derived Projection inputs must fail closed on invalid provenance.
- `docs/ARCHITECTURE.md`: Runtime, Core/domain, storage, and Projection ownership boundaries; relevant to keeping the matcher pure and read-only.
- `docs/bioweave-data-lifecycle.md`: current Floor-owned/derived-state lifecycle and prohibition on a separate Chat-level fact source.

## Caveats / Not Found

- No external references were needed; this is a repository-only audit.
- The current matcher has no branch-specific semantic mapping beyond exact `branch.key === symptom.kind` for the single supported `nausea` branch. The schedule's labels/descriptions are not machine-readable evidence rules.
- `HEALTH_FACT_KINDS` is not a complete physical-symptom enum in current validation: `physical_symptom` kinds are structurally open strings, while `other_biological` receives the shared-kind check. Any extension should decide explicitly whether to preserve this openness or introduce a separate validated mapping.
- `healthAssessmentEligibility()` requires `health_role: 'observation'`; older or valid-looking physical symptom Events without that field will not match. This is intentional under the current contract, but it is a compatibility consideration for historical data.
- Product Projection DTO currently exposes only `observed_reaction.matched`; `matched_kind`, event IDs, and reason codes are debug-only. Any consumer needing richer evidence must use the internal/debug contract or add a separately specified DTO field.
- `source_evidence.text` remains present in the internal Event DTO, but relying on it would violate the requested no-raw-narrative re-read boundary and would be less deterministic than structured fields.
