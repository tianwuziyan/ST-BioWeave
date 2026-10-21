# Research: projection observed-reaction link tests and debug DTO

- Query: Inspect projection and health/event tests, debug DTO/export paths, and lifecycle/evolution semantics; propose focused regression tests and bounded debug fields for exact mapping from structured symptom kind to built-in projection concern key.
- Scope: internal
- Date: 2026-10-21

## Findings

### Existing contracts and code paths

- A factual `physical_symptom` Event stores its structured payload under `state_fact.payload.symptom`; validation requires `symptom.kind` and permits only the bounded health identity fields (`kind`, `description`, `body_site`, `laterality`, `continuation`, `health_role`) (`core/events.js:449-479`, `core/events.js:547-550`). The StateReducer copies that structured symptom into the subject-local `character.symptoms.records` (`core/state.js:573-582`). This is the correct input for a deterministic link; the prose description is not a contract field for matching.
- Health eligibility is conservative: the Event must be a supported health Event, non-negated/non-fictional, have a `state_fact.subject_id`, and have source evidence; only `health_role: observation` is assessment-eligible (`core/health-assessment.js:51-82`). `healthObservationFingerprint()` deliberately includes the structured Event/state fact and excludes display-only metadata (`core/health-assessment.js:85-106`).
- Active Health Assessments are source-bound, not authoritative symptom facts: the saved assessment must still find its source Event, match the Event's source version, match the current Floor Version on all six fields, and match the observation fingerprint (`core/health-assessment.js:272-283`). The observed-reaction link should use the same source-bound Event/Floor gate and must not treat an Assessment or cache as a substitute source.
- Built-in Projection branches already have stable keys. The current stage defines `nausea`, `odor_discomfort`, `mood_change`, and `appetite_change` for days 21–27 (`core/projection-eligibility.js:24-53`). `builtInPreConfirmationBranchForConcern()` extracts the suffix only from the exact `pre_confirmation_observation:` prefix (`core/projection-eligibility.js:218-220`). The requested first mapping can therefore be a strict table such as `symptom.kind === "nausea" -> concern_key === "pre_confirmation_observation:nausea"`; unknown kinds and non-built-in concerns must remain unmatched.
- Projection identity and built-in stage identity are already subject-scoped. Projection identity uses Chat, `subject_id`, rule ID, and concern key (`core/projection.js:115-116`); built-in stage identity uses `subject_id + pregnancy_id|null + cycle_id`, not mechanism metadata (`core/projection-persistence.js:130-147`). The resolver keeps the latest complete stage snapshot per identity and prevents a late older-stage branch from regressing a newer complete stage (`core/projection-persistence.js:149-215`).
- Projection reads are owner/lifecycle guarded before the resolver runs: storage enumerates only active Swipes, complete six-field versions, matching Chat/message identity, and `resolveVersion()`-confirmed current versions; each timeline record is filtered to the exact owner version (`storage/projection.js:231-260`). The endpoint then resolves the current Projection view (`storage/projection.js:264-267`). This is the appropriate place to ensure links disappear after source Floor/Swipe invalidation; do not add a Chat-level link cache.
- The product Projection DTO is intentionally presentation-safe and currently exposes `id`, subject, rule/concern, status, generated statement, source refs, timing, and lifecycle (`runtime/projection-runtime.js:96-145`). Product UI should receive only a bounded boolean/status such as `observed_reaction: true` or `observed_reaction_status: "matched"`; Event IDs, Projection IDs, Floor Version, and reasons belong to Debug. Existing DTO tests assert presentation-safe timing and suppression of invalid built-in candidates (`tests/projection-runtime.test.js:362-430`).

### Existing regression evidence to extend

- Subject isolation exists for Health read models (`tests/health-evolution.test.js:441-450`) and for Projection Context stage selection (`tests/projection-context.test.js:263-297`). Add the link test beside these boundaries: a `nausea` Event for subject A can mark only A's `pre_confirmation_observation:nausea`, while subject B's same concern remains unmatched.
- Structured-vs-text behavior is already explicit in the Event contract and should be locked at the link boundary: `description` is optional metadata while `kind` is required (`core/events.js:453-464`, `core/events.js:547-550`). The regression fixture should include `kind: "nausea"` with a description mentioning odor/appetite, plus separate non-matching projections. Assert only the exact kind mapping wins; never search the description or generated statement.
- Floor/Swipe invalidation is covered for Projection persistence (`tests/projection-persistence.test.js:365-389`, `tests/projection-persistence.test.js:402-416`) and Health Assessment activation (`tests/health-assessment.test.js:562-577`). Reuse the same fixture style for the link: remove the source Event, switch active Swipe, change `content_hash`/message version, remove the source Floor, and assert the next read returns no match.
- Stage and endpoint semantics are already tested for complete stage replacement, per-subject legacy reconstruction, and older-stage non-regression (`tests/projection-persistence.test.js:73-143`). Add a link-specific stage mismatch case: a valid `nausea` Event may be present, but a current stage containing only `fatigue` or a later stage containing `nausea_worsening` must not mark the current card as `nausea`; matching is exact concern-key equality, not symptom-family or label similarity.
- Existing evolution tests make the key semantic boundary clear: time/silence alone do not create a factual transition, and evolution returns no factual Event (`tests/projection-eligibility.test.js:353-399`). The observed-reaction marker must likewise be a read-model annotation only; it must not call Projection evolution, append a lifecycle record, realize/contradict/expire a Projection, or imply pregnancy confirmation.
- Product/debug separation already exists. `collectActiveBusinessData({includeDebug:true})` combines Event business data, Projection business data, and a separate lifecycle/debug payload (`runtime/events.js:7065-7082`); the UI renders business debug under the Advanced/Debug section (`ui/settings.js:1373-1425`). Debug export serializes `business_debug` and diagnostic sections through `buildDebugExportText()` (`ui/app.js:151-171`), and UI tests already assert exported business debug fields and exclusion of story-time trace internals (`tests/ui.test.js:3037-3071`).

### Proposed focused regression tests

1. **Exact positive mapping and product-safe DTO** — Build one valid subject-local `physical_symptom` Event with `symptom.kind: "nausea"`, valid source evidence and source Floor Version; build the current `pre_confirmation_observation:nausea` Projection. Assert the link is `matched`/true and the product DTO contains no Event ID, Projection ID, raw source, Floor Version, or pregnancy-confirmation wording. Also assert the Projection remains active and no lifecycle save is requested.
2. **Subject isolation** — Use identical `nausea` Events for subjects A and B and one `nausea` Projection per subject, then omit B's Event in a second input. Assert A matches only A and B is unmatched; ensure no name/display-name comparison is involved.
3. **No free-text matching** — Keep `symptom.kind: "nausea"` but use descriptions containing `气味`, `食欲`, and `恶心`; assert only the `nausea` concern matches. Separately use `kind: "odor_discomfort"` or `kind: "appetite_change"` with descriptions containing `恶心`; assert those do not match `nausea`. A generated statement containing the word `恶心` must also not affect the result.
4. **Unknown/unsupported kind fail closed** — Use a valid health Event with an unrecognized kind, missing kind, `health_role: intervention`, `status: negated`, and an `other_biological` unsupported fact. Assert `unmatched` with a stable reason code and no guessed concern key.
5. **Stage mismatch and exact concern key** — Present a valid `nausea` Event with a current `fatigue` stage snapshot, a later `nausea_worsening` stage, and a generic Projection whose display text says “恶心”. Assert none is marked as the exact `pre_confirmation_observation:nausea` match unless that exact built-in concern is in the current selected subject/cycle stage.
6. **Floor deletion / Event deletion** — Start with a matched source Event and Projection, then remove the Event from the current resolved Floor or append an Event deletion/replacement result according to the existing Event owner path. Re-read the link and assert `unmatched`; no prior runtime/cache result may survive.
7. **Swipe isolation** — Store the matching Event and Projection on Swipe 0, switch the active Swipe to 1 with no matching Event, and assert the marker disappears. Switch back to Swipe 0 and assert it returns only if the exact original six-field version still resolves. Include Swipe 0 explicitly because it is a real owner (`docs/bioweave-data-lifecycle.md:208-209` and `tests/projection-persistence.test.js:365-379`).
8. **Floor Version invalidation** — Change each of `chat_id`, `message_id`, `floor`, `swipe_id`, `content_hash`, and `message_version` independently between the Event source and current endpoint. Assert every mismatch is unmatched, mirroring `activeHealthAssessments()`'s all-six-field check (`core/health-assessment.js:275-282`) and the Projection persistence stale-version tests (`tests/projection-persistence.test.js:381-389`).
9. **Endpoint rollback and stage replacement** — Have Floor 20 own a complete old stage and Floor 26 own a complete current stage, with a matching `nausea` Event only in the valid endpoint history. At endpoint 26 assert only the current subject/cycle stage is considered; remove/roll back Floor 26 and assert the result is derived from the surviving Floor 20, not from a stale cached current-stage link. This should reuse the existing endpoint/stage tests (`tests/projection-persistence.test.js:73-143`, `core/projection-persistence.js:165-215`).
10. **Non-mutating read model** — Snapshot Events, Projection timeline, lifecycle records, DTO input, and debug input; compute links; assert all inputs are unchanged and no `saveProjectionLifecycle`, Event write, Assessment write, or StateReducer mutation occurred. This preserves the established “Projection is not a BiologicalEvent” boundary (`.trellis/spec/domain/event-pipeline.md`, Phase 2D section) and the existing non-mutating Projection tests (`tests/projection.test.js:97-100`).

### Bounded Debug DTO proposal

Add one optional, read-only collection under the existing debug/business diagnostic payload, for example `projection_diagnostics.observed_reaction_links`. Keep it bounded to the current endpoint and selected built-in cards, with at most one record per candidate card and a hard cap consistent with existing debug truncation. Suggested fields:

```js
{
  subject_id: "char_000001",                 // internal Debug only
  projection_concern_key: "pre_confirmation_observation:nausea",
  symptom_kind: "nausea",                    // null when no valid source
  matched: true,
  reason_code: "EXACT_STRUCTURED_KIND_MATCH",
  source_event_id: "event-health-1",         // Debug only
  source_floor_version: {                     // Debug only; full six fields
    chat_id, message_id, floor, swipe_id, content_hash, message_version
  },
  stage_key: "early_reactions",
  source_status: "CURRENT_RESOLVED"
}
```

Use a finite reason-code vocabulary rather than free-form prose: `EXACT_STRUCTURED_KIND_MATCH`, `NO_VALID_SOURCE_EVENT`, `SUBJECT_MISMATCH`, `KIND_NOT_SUPPORTED`, `CONCERN_NOT_BUILT_IN`, `STAGE_MISMATCH`, `SOURCE_FLOOR_INVALID`, `SOURCE_SWIPE_INACTIVE`, `SOURCE_EVENT_DELETED`, and `SOURCE_KIND_NOT_EQUAL`. Do not include full Event payload, description, generated statement, prompt, raw AI output, or pregnancy outcome. This aligns with the existing debug promise of safe operational state without complete inputs/prompts/credentials (`ui/settings.js:1065-1070`) and the existing projection diagnostic pattern of bounded IDs/counts/status fields (`runtime/projection-runtime.js:168-179`).

The product DTO should expose only the minimum display projection, preferably `observed_reaction: true` plus an optional stable display status. Do not expose `source_event_id`, Floor Version, reason code, raw symptom description, or internal concern mapping in normal Character/Projection UI. The debug export will include the bounded collection automatically because `buildDebugExportText()` serializes `business_debug` (`ui/app.js:151-171`); add an export test asserting the fields are present and sensitive/raw narrative fields are absent.

### Lifecycle/evolution implications

- The link is a derived read annotation from current valid Floor facts and current Projection views. It must be recomputed after every endpoint read and must not become a second persistent root or Chat-level cache. The Floor contract states that derived UI models are rebuilt from valid Floor facts and stale/inactive Swipe facts cannot contribute (`.trellis/spec/domain/floor-state.md`; `docs/bioweave-data-lifecycle.md`, ownership and Projection sections).
- A source Event can be authoritative without confirming pregnancy. The marker means only “structured symptom observed in valid current narrative”; it must not set `factual_status`, write Projection lifecycle `realized`, modify StateReducer pregnancy state, create an Assessment, or alter Context injection.
- Stage mismatch is conservative. If the exact concern is absent from the selected current complete stage for the subject/cycle identity, report no match even if an older stage or a different subject has a similar branch. Historical Delivery replay remains separate from the product view (`storage/projection.js:269-279` and `.trellis/spec/domain/floor-state.md`, Projection delivery contract).

## Related specs

- `.trellis/spec/domain/floor-state.md` — exact Floor/Swipe owner, current endpoint, provenance, derived-state rebuild, and Projection timeline ownership.
- `.trellis/spec/domain/event-pipeline.md` — BiologicalEvent boundary and Projection as a downstream non-factual DTO.
- `.trellis/spec/domain/pregnancy-tracking.md` — subject/cycle identity and tracking-derived boundaries.
- `docs/bioweave-data-lifecycle.md` — persistent-root ownership, invalidation, active Swipe handling, and Health Assessment source binding.
- `docs/CHARACTER-HEALTH-STATE.md` — Health read model is derived from surviving Events and must not create an independent health authority.

## Files found

- `core/events.js` — Event normalization and strict structured symptom validation.
- `core/state.js` — subject-local reduction of `physical_symptom` facts.
- `core/health-assessment.js` — health eligibility, fingerprints, and six-field source/Floor activation filter.
- `core/projection.js` — Projection schema, identity, validation, and current view resolution.
- `core/projection-eligibility.js` — built-in stage/branch keys, including `nausea`.
- `core/projection-persistence.js` — endpoint ordering and per-subject/cycle complete-stage selection.
- `storage/projection.js` — active-Swipe/current-version timeline read and Projection view boundary.
- `runtime/projection-runtime.js` — product Projection DTO and bounded Projection diagnostics.
- `runtime/events.js` — business/debug data assembly and Projection diagnostic export path.
- `ui/app.js` — debug export serialization and stale sampled-business-debug handling.
- `ui/settings.js` — Advanced/Debug rendering and safe-debug copy/export controls.
- `tests/health-assessment.test.js`, `tests/health-evolution.test.js` — source binding, subject isolation, and invalidation tests.
- `tests/projection.test.js`, `tests/projection-persistence.test.js`, `tests/projection-runtime.test.js`, `tests/projection-context.test.js` — Projection identity, stage, endpoint, DTO, and subject isolation tests.
- `tests/ui.test.js` — debug export field and sensitive-content assertions.

## Caveats / Not Found

- No existing production symbol currently links `state_fact.payload.symptom.kind` to a built-in Projection concern key; this is a proposed derived read-model seam, not an existing API.
- The PRD leaves “current observation round vs any earlier Chat symptom” open. The safest default supported by the current owner contracts is current endpoint scope only: valid Events visible in the current resolved endpoint and selected subject/cycle stage. A broader Chat-wide rule would need an explicit product decision and additional historical semantics.
- The exact existing debug DTO envelope is assembled across `runtime/events.js`, `runtime/diagnostics.js`, and UI render/export code; adding the bounded collection should preserve the current `source_type`/safe-debug separation rather than introduce a new persistent field or a second export format.
- No external references were needed; the relevant primary sources are the repository code and normative `.trellis/spec/`/`docs/` contracts.
