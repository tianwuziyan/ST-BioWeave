# Research: projection observed reaction linkage

- Query: Investigate the existing Event → Health Assessment → business DTO → Projection data flow and identify the narrowest correct owner for deriving an observed-reaction match between a confirmed `physical_symptom` Event and a built-in pre-confirmation Projection card.
- Scope: internal
- Date: 2026-10-21

## Findings

### Existing flow and ownership

1. The canonical source is the current Character Floor and its active Swipe. The Floor State Ownership Contract defines the one-way flow as current Character/assistant message + active Swipe → authoritative Floor Version → Floor/Swipe Events → current valid Floor facts → derived Runtime/UI/API state (`.trellis/spec/domain/floor-state.md:8-16`). Projection generation uses the same owner boundary and must be invalidated when the owner changes (`.trellis/spec/domain/floor-state.md:18-22`).
2. Event analysis resolves a complete current Event collection before deriving business state. `collectActiveBusinessData()` resolves the current Floor, obtains canonical derived state, asserts the target is still current, and passes `derived.activeEvents` into `buildBusinessData()` (`runtime/event-analysis.js:3146-3160`, `runtime/event-analysis.js:3176-3205`). The business DTO exposes the current active Events and `current_health_state`; it does not currently expose Projection DTOs (`runtime/event-analysis.js:3576-3593`).
3. Health Assessment eligibility is a pure Core decision. It accepts only supported health Event types, non-negated/non-fictional facts with a subject and source evidence, and an explicit `health_role: observation`; `intervention` is rejected (`core/health-assessment.js:62-82`). The domain contract explicitly says only `observation` enters Assessment and that intervention Events do not contribute to Current Health State (`.trellis/spec/domain/event-pipeline.md:101-112`).
4. Health Assessment persistence is an owner-bound derived timeline. Each Assessment stores `source_event_id`, the complete `source_floor_version`, and an observation fingerprint (`core/health-assessment.js:181-201`); `activeHealthAssessments()` retains it only when the Event source, current Floor Version, and fingerprint all match (`core/health-assessment.js:272-283`). Runtime derives Current Health State from the current Events plus those active Assessments (`runtime/health-evolution.js:10-25`).
5. Current Health State is a presentation/read model, not the canonical Event source. It carries per-subject `active_observations` with `factual_kind`, description, severity, and `source_event_id`, then groups them for display (`core/health-evolution.js:123-149`; `core/health-aggregation.js:58-100`). It deliberately depends on a valid Assessment and can omit an otherwise valid Event when no Assessment exists or a short-term recovery boundary has closed.
6. Projection DTO construction is Projection-owned. `toProjectionDTO()` maps a resolved Projection View to the public business shape, including `subject.id`, built-in rule concern/label/description, status, and timing (`runtime/projection-runtime.js:96-145`). Built-in branches are exact machine keys: `nausea`, `odor_discomfort`, `mood_change`, and `appetite_change` for days 21–27 (`core/projection-eligibility.js:25-36`), and `builtInPreConfirmationBranchForConcern()` resolves a card concern to one branch (`core/projection-eligibility.js:218-222`).
7. The public business read is composed at the Runtime facade: it first gets Event business data, then gets Projection business data and merges the two DTOs (`runtime/events.js:7065-7070`). Projection Runtime input collection already receives current `business.active_events`, the current Floor, and current Story Time (`runtime/events.js:2947-2973`).
8. The Projection UI is intentionally a consumer. It groups by `subject.id`, selects current-stage items, and renders each signal from DTO `rule.label`, `rule.description`, and status; it does not infer symptoms from text or Event data (`ui/projection.js:117-168`, `ui/projection.js:224-243`). The UI contract likewise says it must display only Projection DTO data and must not infer symptoms from names, text, or technical fields (`docs/UI.md:94-99`).

### Recommended narrow owner

The narrowest correct owner is a small pure Core matcher used by the Projection DTO boundary, with Runtime responsible only for supplying the already-resolved current Floor facts and forwarding the result. In practical terms:

```text
current valid Floor Events + resolved Projection Views
  → pure exact observed-reaction matcher
  → Projection business DTO enrichment
  → UI presentation
```

The matcher should not live in `ui/projection.js`, `runtime/event-analysis.js`, or the Health Assessment persistence coordinator. Projection owns the card vocabulary and DTO (`runtime/projection-runtime.js:96-145`), while the pure matcher can own only the cross-domain comparison. This follows the documented Health extension shape of “small pure core module → explicit DTO → narrow runtime coordinator/hook → presentation-only UI” (`docs/ARCHITECTURE.md:100-126`).

The matcher should consume canonical `active_events` rather than `current_health_state` as its factual input. `current_health_state` is Assessment-gated and lifecycle-derived; using it would make a confirmed, structured symptom fail to match merely because its one-time Assessment is missing, stale, legacy, or already at a recovery boundary. The matcher may call/reuse the existing `healthAssessmentEligibility()` predicate to preserve the explicit observation-role boundary, but it should not require Assessment severity, persistence, recovery guidance, or an Assessment ID. This keeps the match factual and avoids making an AI-derived recovery profile a prerequisite for a deterministic UI annotation.

For the first version, the exact predicate should be:

```text
Event.status === "confirmed"
AND Event.type === "physical_symptom"
AND Event.state_fact.subject_id === card.subject.id
AND Event.state_fact.payload.symptom.health_role === "observation"
AND Event.state_fact.payload.symptom.kind === exact built-in branch key
```

The last comparison is a typed equality, not a description search. Therefore `kind: "nausea"` matches the `pre_confirmation_observation:nausea` card; text mentioning smells, food, or appetite cannot match `odor_discomfort` or `appetite_change` unless those become separate structured Events. The existing Event contract requires typed `symptom.kind`/`description` and forbids adding Projection/UI fields to the Event payload (`ai/prompts.js:80`, `core/events.js:462-477`).

### Recommended DTO shape

Enrich each Projection DTO with a presentation-safe, non-provenance field:

```js
observed_reaction: {
  matched: true,
}
```

For an unmatched card, use `{matched: false}` or omit the field consistently; the preferred stable contract is `{matched: false}` so the UI has no inference/default ambiguity. Do not expose `event_id`, `projection_id`, Floor Version, Swipe, raw description, or Assessment ID in this product DTO. The existing product/debug boundary excludes those fields from normal UI (`docs/UI.md:103-110`).

Keep a separate internal/debug explanation, produced from the same calculation, for example:

```js
observed_reaction_debug: {
  status: "matched" | "unmatched" | "invalid_source" | "stale_input",
  source_event_ids: ["..."],
  subject_id: "...",
  matched_kind: "nausea" | null,
  reason: "exact_typed_kind" | "no_subject_match" | "kind_not_structured" | "event_not_confirmed" | "event_not_observation" | "source_not_current",
}
```

That debug shape is optional implementation detail; it must remain outside the ordinary Projection DTO/HTML. A single Event should produce at most one exact match per same-subject card. Other cards remain visible and unchanged.

### Persistence and invalidation

Do not persist the match in `projection_timeline`, `health_assessment_timeline`, Event payloads, or Chat-level state.

- Projection Timeline is an append-only Floor-owned root for creations, evidence, and lifecycle records; later Floors do not mutate earlier creations (`.trellis/spec/domain/floor-state.md:28-55`). A match is a current read-time relation, not a new Projection lifecycle fact.
- Health Assessment persistence is for derived recovery/health profile data and is keyed to an Event plus exact Floor Version/fingerprint (`core/health-assessment.js:108-123`, `core/health-assessment.js:181-201`). Adding a UI relation there would conflate recovery assessment with Projection card realization and make Assessment AI output authoritative for a deterministic typed match.
- Event facts remain factual and must not be enriched with Projection/UI fields; the Event contract separates factual `state_fact` from Current State and Projection (`docs/DATA-MODEL.md:423-427`).

The relation should be recomputed on every current business/Projection read from the same owner-bounded inputs. It disappears automatically when:

- the Event is deleted, edited away from `confirmed`/`physical_symptom`/`observation`, or its typed `kind` changes;
- the Event source is no longer in the current complete Event collection;
- the active Swipe changes or is deleted;
- the current Character Floor or six-field Floor Version changes, becomes invalid, or is replaced by a later valid Floor;
- the card is no longer a current built-in card for the subject/stage.

This is consistent with Event edit/delete invalidating the factual basis on the next derived read (`.trellis/spec/domain/event-pipeline.md:94-99`) and with the Floor rule that stale/inactive Swipe/version data is never a fallback (`.trellis/spec/domain/floor-state.md:28-34`). The current read must use the same target Floor for both Event facts and Projection Views; it must not combine a current card with a prior or latest-message Event.

### Risks and verification points

- Requiring `current_health_state.active_observations` would under-match because that read model is Assessment/recovery gated; requiring only `physical_symptom` without `health_role: observation` would violate the Health contract. The matcher should use the explicit role predicate but remain independent of persisted Assessment output.
- Matching by `description`, localized label, or card prose would incorrectly mark the “闻到气味不舒服” and “食欲变化” cards from a single `nausea` Event. Exact `kind` equality is the required fail-closed behavior.
- Matching only by `kind` would leak one person’s symptom to another. Subject ID equality must be part of the predicate; UI grouping by person is not a substitute (`ui/projection.js:117-132`).
- A card’s concern key is the stable built-in identity; its label/description are presentation text and may change. Use `builtInPreConfirmationBranchForConcern()`/branch key resolution rather than comparing Chinese labels (`core/projection-eligibility.js:218-222`).
- A `physical_symptom` Event may be valid as an Event but not eligible for Health Assessment when `health_role` is absent or the Event lacks source evidence. The product decision must explicitly preserve the first-version requirement for confirmed observation Events; otherwise the matcher should report `invalid_source` and not mark the card.
- Current Projection DTO generation is currently view-only (`runtime/projection-runtime.js:147-159`), while the facade merges Event and Projection DTOs separately (`runtime/events.js:7065-7070`). The implementation must pass one already-validated business snapshot into DTO enrichment or otherwise ensure both reads resolve the same Floor/Swipe. Avoid an independent UI-side Event fetch.
- Add tests for same-subject `nausea`, different-subject `nausea`, exact `kind` versus description-only overlap, missing/invalid `health_role`, deleted Event, edited Event, Swipe switch, stale Floor Version, and built-in stage replacement. Also verify that no projection lifecycle/evidence save occurs solely because a match is derived.

## Related specs

- `.trellis/spec/domain/floor-state.md` — authoritative Floor/Swipe ownership, Projection timeline ownership, current endpoint read, and invalidation.
- `.trellis/spec/domain/event-pipeline.md` — canonical Event pipeline, health factual role contract, and Projection separation.
- `docs/ARCHITECTURE.md` — Health extension rule and Projection ownership map.
- `docs/DATA-MODEL.md` — typed health Event payload and factual-vs-derived boundary.
- `docs/UI.md` — Projection DTO/UI boundary and built-in stage/card vocabulary.

## External references

None required. This decision is fully determined by the repository’s current source and project contracts.

## Caveats / Not Found

- No existing observed-reaction link field or matcher was found in the inspected Core, Runtime, Storage, or UI paths.
- The task PRD leaves open whether matching should be limited to the current observation round or all earlier valid same-Chat Events. The owner recommendation assumes all Events in the current valid Floor-derived Event collection are eligible, subject to exact subject/kind/role matching; if product intent is “current round only,” that temporal restriction must be made explicit before implementation.
- The existing built-in `nausea` card text mentions odors and food, but those prose cues are intentionally not separate structured match keys (`core/projection-eligibility.js:31-36`).
