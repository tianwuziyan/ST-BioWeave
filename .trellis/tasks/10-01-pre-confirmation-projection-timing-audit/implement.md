# Phase 1 Implementation Plan: Pre-confirmation Projection Timing

This phase implements only the frozen Core, persistence, and eligibility
contract. It now includes the approved Characters timing-config UI and the
versioned Human narrative preset; it does not implement medical Human defaults,
Tracking Window, GA/EDD, Genealogy, Event schema changes, or StateReducer
semantic changes. Do not commit or push.

## Baseline failure ledger

Before Phase 1 changes, `npm run check` completed with 1102 tests: 1085 pass,
17 fail, 0 cancelled/skipped/todo. The failures are pre-existing and are
recorded here so the after-run can compare the exact set rather than treating
the baseline as a Phase 1 regression:

1. `tests/event-analysis-runtime.test.js:8299` — `Manual Full and Manual Patch share one World persistence job`; assertion `0 !== 1` at line 8325.
2. `tests/world-model.test.js` prompt-baseline failure: direct stable rare Type existence must stay separate from prevalence/details.
3. `tests/world-model.test.js` prompt-baseline failure: discovered facts must not relax evidence thresholds.
4. `tests/world-model.test.js` prompt-baseline failure: Analysis blocks can be edited without format tags.
5. `tests/world-model.test.js` prompt-baseline failure: unknown non-human rules differ from Human baseline.
6. `tests/world-model.test.js` prompt-baseline failure: Human fallback remains bounded/generic.
7. `tests/world-model.test.js` prompt-baseline failure: fixed dual evidence differs from temporary dualization.
8. `tests/world-model.test.js` prompt-baseline failure: dual types are not inferred from default male/female input.
9. `tests/world-model.test.js` prompt-baseline failure: generic field semantic contract is complete.
10. `tests/world-model.test.js` prompt-baseline failure: full generic biological type candidate gate.
11. `tests/world-model.test.js` prompt-baseline failure: unnamed structural reproductive classes do not invent paired types.
12. `tests/world-model.test.js` prompt-baseline failure: conditional implicit Human baseline and field-level delta.
13. `tests/world-model.test.js` prompt-baseline failure: exhaustive Human type recall without baseline invention.
14. `tests/world-model.test.js` prompt-baseline failure: global species discovery precedes field analysis.
15. `tests/world-model.test.js` prompt-baseline failure: ordered discovery, continuity, and final self-check stages.
16. `tests/world-model.test.js` prompt-baseline failure: ordered generic biological type gate for Full and Supplement.
17. `tests/world-model.test.js` prompt-baseline failure: type existence, capability evidence, and species-linked scope are separate.

## Phase 1 decisions used by implementation

- Character timing config is Chat-local under authoritative Chat metadata,
  keyed by canonical `character_id`, and remains separate from the Registry,
  Tracking, Profile, State, Snapshot, and Projection timeline.
- Timing instances use a sibling Floor-owned append-only timing timeline and
  the existing coordinator/owner/version/readback path. They are not
  Projection records or BiologicalEvents.
- V1 cycle compatibility is fail-closed and strict: same canonical subject,
  same explicit mechanism key, and a currently valid pregnancy-relevant Event.
  Additional compatible basis references join the active instance without
  resampling or recomputing frozen timing.
- V1 variance uses the midpoint of the configured base window as the reference
  days: `min(((base_min + base_max) / 2) * variance_ratio,
  variance_cap_story_days)`. A bounded signed sample is taken once at creation;
  individual offset plus the v1 zero state modifier is clamped to the total
  adjustment cap. Effective min/max are persisted.
- State modifier is frozen at zero in v1. No narrative, absence, projection,
  or uncontracted Current State signal may influence timing.
- `effective_max` gates first Projection generation only. Existing Projection
  evolution retains realization → contradiction → expiration and its own
  expiration semantics.
- Timing status is derived from the persisted record, current valid factual
  basis, terminal facts, and comparable Story Time; lifecycle enums are not
  duplicated unless persistence requires an audit action.

## Implementation sequence

1. Add pure config normalization/validation/default resolution and Chat-local
   read/write/reset helpers.
2. Add timing DTO, deterministic cycle/instance identity, bounded one-time
   resolver, append-only persistence, and authoritative readback through the
   existing Floor coordinator.
3. Add timing eligibility composition to the existing Projection eligibility
   path without changing World Rule semantics or Runtime fallback behavior.
4. Add focused Core/storage/runtime regression tests, then run the full check.
5. Update the lifecycle/spec/docs and task decision/design documents only for
   behavior actually implemented and verified.

## Validation and scope review

- Run the focused Phase 1 tests first, then `npm run check`.
- Compare after failures against the ledger above: total, newly introduced,
  resolved, changed, and unchanged failures.
- Review `git diff --stat`, forbidden-path changes, stale owner guards,
  authoritative readback, and Markdown/spec synchronization.
