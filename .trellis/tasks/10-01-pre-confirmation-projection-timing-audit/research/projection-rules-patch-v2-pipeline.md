# Research: World Model projection_rules Patch v2 pipeline

- Query: 审计当前 `projection_rules` Patch v2 从 raw AI 输出到 Runtime 消费的真实链路，重点确认 `ADD_PROJECTION_RULE` 身份、去重、替换/override、Full/Patch composition、Human baseline、Floor 持久化与 stale guard。
- Scope: internal
- Date: 2026-10-02

## Findings

### 1. Current implementation map / real pipeline

```text
Supplement raw AI JSON Fact Delta
  -> parseWorldModelFactDeltaJson()
  -> resolveWorldModelFactDelta()
  -> factDeltaCanonicalProjection() / generated projection_rule_id
  -> factDeltaOperationForFact(): ADD_PROJECTION_RULE (ID removed from wire op)
  -> validateWorldModelPatchV2()
  -> classifyWorldModelPatchV2(existing)
  -> applyWorldModelFactDeltaEvidenceGuard()
  -> mergeWorldModelSupplementPatch() / mergeWorldModelPatchV2Classified()
  -> final consistency guard + normalizeWorldModel(strict)
  -> runtime/world-analysis.js saveWorldModel()
  -> commitFloorPatch(owner="world") + authoritative readback
  -> later resolveWorldModelAtOrBefore()/collectInputs()
  -> runtime/projection-runtime.js eligibility/evolution/generation
```

- Production Supplement entry is `createAnalyzer().analyzeWorldModelPatchV2()` in `ai/analyzer.js:4845-4918`. The prompt is built by `buildWorldModelPatchMessagesV2`; the AI response is parsed as Fact Delta, not Patch v2. Parsed facts are resolved and guarded at `ai/analyzer.js:4918-4959`.
- Fact-to-operation conversion is `factDeltaOperationForFact()` at `ai/analyzer.js:4570-4604`; `Projection_Rule` is canonicalized, then emitted as `ADD_PROJECTION_RULE` after stripping the generated ID at `4600-4603`.
- The resolver processes identity dependencies and canonical Fact addresses deterministically; duplicate same-address/same-content facts become `deduplicated`, conflicting content is rejected at `ai/analyzer.js:4634-4718` (projection-specific update conflict at `4692-4700`).
- Patch v2 structural validation is `validateWorldModelPatchV2()` / `validateV2Operation()` at `ai/analyzer.js:3638-3697`. `ADD_PROJECTION_RULE` accepts only `projection_rule`, forbids AI-supplied `projection_rule_id`, and calls `validateProjectionRuleContent()` at `3682-3686`.
- Classification is `classifyWorldModelPatchV2()` at `ai/analyzer.js:3786-3850`. It normalizes the raw rule to generate an ID, then classifies by that ID and canonical content. Evidence safety is independently applied in `applyWorldModelFactDeltaEvidenceGuard()` at `ai/analyzer.js:4245-4320`, using `v2ValidateStructuredOperationEvidence()` (`3990-3998`).
- Deterministic merge is `mergeWorldModelPatchV2Classified()` at `ai/analyzer.js:4229-4237`; it clones the Existing model, applies accepted operations, runs `applyWorldModelFinalConsistencyGuard()`, then strict canonical normalization. Runtime invokes this through `mergeWorldModelSupplementPatch()` at `ai/analyzer.js:4323-4330` and `runtime/world-analysis.js:901-935`.
- World save/readback is `runtime/world-analysis.js:351-408` and `410-439`: current Floor Version is re-resolved, the World owner patch contains only `world_model`/`world_model_meta`, and UI-ready readback requires the same current six-field version.
- The shared Coordinator restricts owner fields to World `world_model`/`world_model_meta` and Projection `snapshot`/`projection_timeline` at `storage/floor-persistence-coordinator.js:8-15`; it merges siblings, saves, rereads, checks owner fields and version, and returns `confirmed` only after readback at `240-339`.
- Runtime projection consumption is separately owned by `runtime/projection-runtime.js`: it normalizes rules (`168-170`), evolves existing projections (`174-193`), evaluates eligibility (`196-210`), and generates only eligible/no-existing candidates (`212-287`). Wiring in `runtime/events.js:1686-1721` collects active Floor-derived State, Events, Tracking candidates, and the nearest valid World Model; post-processing begins on `factual-success`, not from a timing rule alone.

### 2. `ADD_PROJECTION_RULE` identity, dedupe, replacement semantics

- Rule content validation is deliberately closed: `core/projection-eligibility.js:8-15` defines exact fields and forbids `probability`, `weight`, `rng`, `random`, `seed`, executable fields, prompts, raw AI output, pregnancy outcomes, and similar fields. `validateProjectionRuleContent()` forbids identity while `validateProjectionRule()` requires it (`36-69`).
- Canonical normalization sorts unordered requirement/criteria material (`core/projection-eligibility.js:71-91`). `buildProjectionRuleId()` hashes the complete normalized rule material excluding `projection_rule_id` (`94-98`), so identity is deterministic but content-derived.
- `normalizeProjectionRules()` generates the ID, rejects a supplied mismatching ID, dedupes exact same generated ID/content, and rejects same-ID/different-content conflicts (`99-124`). This is the existing general normalize/dedupe primitive, not an update primitive.
- Patch classification uses `v2CollectionClassification()` (`ai/analyzer.js:3769-3774`): same ID + equal content = `NO-OP`; same ID + different content = `REJECT`; absent ID = `ADD`. The apply path repeats the same fail-closed behavior at `4172-4180`.
- Existing rules cannot be replaced or edited. `resolveWorldModelFactDelta()` explicitly returns `FACT_DELTA_EXISTING_PROJECTION_UPDATE_UNSUPPORTED` when a generated ID matches an Existing rule but canonical content differs (`ai/analyzer.js:4692-4700`). The authoritative spec calls this out as the current “Projection Rule identity gap” because mutable-content IDs change when content changes (`.trellis/spec/domain/world-model.md:1575-1584`).
- There is no `UPDATE_PROJECTION_RULE`, `REPLACE_PROJECTION_RULE`, override layer, priority layer, stable logical ID, or user override primitive in the current production path. The operation set is frozen as add-only in `.trellis/spec/domain/world-model.md:1099-1126`; the same spec explicitly says projection update is blocked (`1422-1436`).
- Consequence for the blocker: changing timing content (for example `min_elapsed_story_days`) creates a different generated ID and can only be represented as a new rule if the old rule is separately absent. It cannot safely supersede the old rule; retaining both can yield two independent eligibility decisions. Any future timing config must therefore be separate from `projection_rules[]`, or first introduce a stable logical rule identity plus explicit migration/replacement semantics.

### 3. Full vs Patch composition and Human baseline

- Full production World analysis removes `analysisInput.world_model` before AI invocation (`runtime/world-analysis.js:825-845`); the current test asserts Full receives no Existing baseline at `tests/event-analysis-runtime.test.js:7179-7196`.
- Patch/Supplement resolves the nearest valid persisted World Model and passes it as both `world_model` and `supplement_candidate` (`runtime/world-analysis.js:847-894`). The authoritative pipeline is Existing comparison/reference -> Fact Delta -> internal Patch v2 -> evidence guard -> sparse merge; omission preserves Existing and never means REMOVE (`.trellis/spec/domain/world-model.md:1205-1229`, `1252-1272`).
- Full and Supplement use the same Projection Rule raw schema/validator, but Full produces a complete canonical model while Patch adds sparse facts. The spec confirms Full is baseline-free and Patch’s Existing is comparison-only, never evidence (`.trellis/spec/domain/world-model.md:1590-1608`).
- Human baseline is an Analyzer normalization helper, not a Projection timing source. `humanBaseline()` and `sanitizeHumanType()` are in `ai/analyzer.js:1446-1511`; only `null` Human fields are filled, while explicit `false`, `"无"`, or non-empty values are preserved. Nonhuman types use `sanitizeNonHumanType()` and do not inherit Human defaults.
- Current World Model docs state the same Baseline + Delta precedence and explicitly say Projection Eligibility has no real-world Human timing fallback (`docs/DATA-MODEL.md:255-262`). Therefore no current helper supplies a pre-confirmation timing duration or max-window default.

### 4. Timing/eligibility and Runtime boundary relevant to the blocker

- Current rule timing supports declarative trigger kinds only. `core/projection-eligibility.js:10,136-148` evaluates event-based or story-time triggers; `min_elapsed_story_days` is part of trigger eligibility, not a persisted timing instance.
- Evolution is separate from eligibility. `evaluateProjectionEvolution()` consumes rule realization/contradiction/expiration criteria and only returns lifecycle decisions; current tests assert time/silence do not create facts (`tests/projection-eligibility.test.js:76-123`).
- Projection rules are never evidence and do not create BiologicalEvents, pregnancy, or Current State. This is enforced by the domain/spec boundary (`.trellis/spec/domain/floor-state.md:584-610`) and tests (`tests/projection-rules-world-model.test.js:114-118`, `tests/projection-eligibility.test.js:50-55`).
- Runtime execution identity hashes Chat/Floor Version, factual Events, source candidates, Current State, Story Time, and World rules (`runtime/projection-runtime.js:100-114`). A changed rule set or factual basis therefore changes execution identity; same identity is single-flight (`295-309`).
- Before generated Projection persistence, Runtime recomputes inputs and fails closed on mismatch (`runtime/projection-runtime.js:238-255`). Projection writes additionally validate Character owner, active Swipe, complete version, current version, and record version (`storage/projection.js:22-61,64-100`), then use the Projection owner Coordinator transaction and readback (`64-93`).

### 5. Floor/Swipe lifecycle and stale behavior

- World Model, including `projection_rules[]`, is Floor-owned, never Chat-level (`.trellis/spec/domain/floor-state.md:68-83`; `docs/bioweave-data-lifecycle.md:355-389`). The nearest valid World resolver checks Character owner, active Swipe, exact stored/current Floor Version, and skips invalidated candidates (`runtime/world-analysis.js:323-349`).
- World saves are forward-only to the current target Floor; historical World owners are not rewritten. The Coordinator latest-slot merge preserves sibling fields and rejects stale version/current-owner mismatches (`storage/floor-persistence-coordinator.js:240-339`).
- Deleting/changing a World Floor or Swipe removes it from valid reads; a later target may expose the nearest surviving valid World owner. Projection timeline has its own Character-domain lifecycle and is cleared separately from World (`storage/lifecycle.js:120-145`).
- Projection timeline reads enumerate current messages/active Swipes and retain only records whose record version equals the owning Floor version (`storage/projection.js:125-155`). This protects generated Projections but does not provide a way to migrate or override World rules.

### 6. Existing tests and what they do not cover

- `tests/projection-rules-world-model.test.js:37-112` covers stable content-derived IDs, normalization ordering, forbidden fields, AI-supplied ID rejection, exact duplicate dedupe, same-ID conflict, and canonical storage validation.
- `tests/world-model.test.js:3477-3516` covers Patch v2 generated identity and duplicate operation behavior; `tests/world-model.test.js:3195-3259` covers structural rejection including AI-supplied projection IDs.
- `tests/event-analysis-runtime.test.js:8036-8075` proves a Patch ADD persists a generated canonical identity without raw ID leakage. `tests/event-analysis-runtime.test.js:7427-7465` covers sparse Patch merge/current-Floor save; `7179-7196` covers Full baseline exclusion.
- `tests/projection-eligibility.test.js:17-75` covers deterministic eligibility, multiple exposures, existing projection identity, Story Time, and rule dedupe; `96-123` covers explicit expiration/evolution boundaries. `tests/projection-runtime.test.js:80-123` covers same-identity no-repeat, single-flight, and stale factual-basis rejection before persistence.
- Not covered as a current primitive: stable logical rule IDs independent of mutable content; replacement/override priority; migration when a timing rule is edited; simultaneous old/new timing rule conflict resolution; a persisted effective timing instance; or Human baseline composition for timing. These are design gaps, not failing tests.

## Recommendation

1. Do not retrofit pre-confirmation timing into `projection_rules[]` as an override or by mutating `ADD_PROJECTION_RULE`. The current identity is content-derived and the only safe operation is add/no-op/reject; using it for mutable timing would make edits produce new rules and duplicate eligibility.
2. Keep declarative World Model rules immutable/add-only for v1. Put Chat-local character timing configuration and the persisted effective observation/timing instance in a separate Timing/Projection-domain owner, with a stable logical cycle identity and frozen rule/config/state snapshots. This follows the task’s frozen design direction and avoids expanding Floor World Model ownership.
3. Compose Human timing baseline only at the World Model authority boundary if product policy later requires it; Runtime must consume a resolved/frozen effective timing record and must not invent a medical fallback. Current `humanBaseline()` is not suitable for this timing purpose without an explicit contract.
4. Reuse existing owner/epoch/Floor-Version safeguards and authoritative readback; do not change the known-good World persistence Coordinator to solve a timing-domain problem. Add tests for timing-instance creation/reuse, compatible exposure joining without resampling, stable boundaries, config/world/swipe/edit invalidation, and old/new rule identity conflicts before implementation.

## Related specs / docs

- `.trellis/spec/domain/world-model.md:1099-1126,1163-1229,1279-1298,1422-1453,1501-1518,1567-1608`
- `.trellis/spec/domain/floor-state.md:68-83,584-610`
- `docs/bioweave-data-lifecycle.md:355-389,424-429,693-696`
- `docs/DATA-MODEL.md:188-220,255-262`
- `docs/ARCHITECTURE.md:60-63,234-266`

## Caveats / Not Found

- No external references were needed; the authoritative current checkout is the source of truth.
- `Full hook output`/older task records were not used as behavior evidence; current code, current specs, current docs, and focused tests were inspected.
- `git status --short` shows only the task directory as untracked; no production code, tests, schema, existing docs, commit, or push was changed. The research file itself is the only new artifact under the task directory at report time.
- This is a read-only audit. No numeric medical baseline, timing duration, max-window value, or implementation was inferred or proposed.
