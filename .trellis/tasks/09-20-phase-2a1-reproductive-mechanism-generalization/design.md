# Technical Design — Phase 2A.1

## 0. Non-negotiable architecture decisions

### Floor-local authority

Floor-local analysis results are authoritative. 对某个 Floor / Swipe 分析得到的
`analysis`、`BiologicalEvent`、`character_registry`、character/profile
observations、reproductive exposure、mechanism facts/references、capability
evidence/resolution、pregnancy relevance、source/counterpart/subject relations，
以及 World Model / metadata（按现有 owner 规则），必须写入产生它们的当前
Floor Swipe owner：`message.swipe_info[swipe_id].extra.bioweave`；没有 Swipe
structure 时使用 `message.extra.bioweave`。

Chat metadata 只承担真正的 Chat-scoped settings/lifecycle/configuration。不得
新增 Chat-level authoritative Event/Profile/Exposure/Mechanism 数据库，也不得
把 Runtime 聚合结果当作事实来源。Tracking Registry、Profiles、Indexes、未来
Current State 和 UI DTO 都必须从当前有效 Floor facts 重建。

### No legacy compatibility

当前是 pre-release development，No legacy compatibility is required during
current pre-release development。不得设计 legacy schema migration、compatibility
alias、deprecated fallback、dual-read、dual-write 或旧语义保留。所有
`can_fertilize -> can_cause_pregnancy` 读取/写入 alias 必须删除；独立证据缺失时
两者分别保持自己的 `true | false | null` 值。

## 1. Audit findings

### 1.1 Current implementation facts

1. `core/events.js:13-44` defines `sexual_activity` as the first event type and
   stores five participant capabilities. `normalizeCapabilities()` at
   `core/events.js:190-206` currently falls back from `can_cause_pregnancy` to
   `can_fertilize`; this is a defect to remove, not compatibility behavior.
2. `core/events.js:255-264` normalizes `relevant` and `possible_conception` as
   independent booleans, while `validateExposureConsistency()` at
   `core/events.js:347-427` requires the exposure evidence marker and participant
   closure only when `possible_conception === true`. For `sexual_activity`, a
   false conception flag currently forces empty participants and empty ID arrays.
3. `core/events.js:684-719` rejects duplicate pregnancy Events by subject, but
   only when `type === 'sexual_activity'`, both relevance flags are true, and
   there is exactly one gestational subject.
4. `core/tracking.js:396-438` collects candidates only when
   `event.type === 'sexual_activity'`, the status is not excluded, and both
   `relevant` and `possible_conception` are true. `rebuildTrackingRegistry()` then
   resolves only `can_carry_pregnancy`; true is eligible, false is ineligible, and
   null is pending (`core/tracking.js:255-290`, `446-530`).
5. The Event parser applies mandatory participant biological context only to
   `sexual_activity` with both relevance flags true (`ai/analyzer.js:2180-2199`),
   and its exposure structure validator returns early for every non-sexual type
   (`ai/analyzer.js:2246-2275`). The collection duplicate guard repeats the same
   type gate (`ai/analyzer.js:2380-2398`).
6. Event prompt rules explicitly describe only pregnancy-related
   `sexual_activity`, require five fixed capability keys, and require
   `possible_conception` plus `conception_relevant_exposure` evidence
   (`ai/prompts.js:51-92`).
7. World Model v1 stores capabilities under each biological type. Its fixed shape
   has `can_fertilize` and `can_carry_pregnancy`, but no first-class mechanism
   object (`storage/schema.js:6-53`; prompt contract `ai/prompts.js:117-125`).
   `applyWorldModelFinalConsistencyGuard()` also derives absence of some rules from
   `can_carry_pregnancy === false` and checks fertilization prose against
   `can_be_fertilized` / `can_fertilize` (`ai/analyzer.js:1158-1189`).
8. Identity resolution rewrites participant references and relevance ID arrays but
   does not resolve a mechanism (`core/identity.js:1712-1820`). Runtime writes
   authoritative source and stable IDs, validates the complete collection, and
   rebuilds the registry (`runtime/event-analysis.js:1536-1615`).
9. UI consumers already treat Registry and Events as DTO projections and do not
   recalculate eligibility (`ui/characters.js`, `ui/events.js`,
   `tests/phase2a-ui.test.js:386-486`). Runtime still reports
   `sexual_activity_count` as a product/status count (`runtime/event-analysis.js:1188-1213`),
   which should become a compatibility metric rather than the domain population
   definition.
10. Floor ownership is already the correct boundary: valid Event facts belong to the
    six-field Floor Version and current Swipe; derived registry/profile/UI state is
    rebuilt from current valid facts (`.trellis/spec/domain/floor-state.md:22-59`,
    `docs/DATA-MODEL.md:157-179`).

### 1.2 Conflicts with the product definition

#### Real business-logic conflicts

- Tracking cannot currently accept non-sexual implantation, medical, parasitic,
  magic, or world-specific exposure because both Domain and Tracking hard-gate on
  `sexual_activity`.
- Tracking currently requires `possible_conception === true`; this excludes direct
  implantation or other exposure where pregnancy is possible without a conception
  occurring in the Event.
- `conception_relevant_exposure` and `possible_conception` encode traditional
  conception language in validator paths and diagnostic codes, making the facts
  layer narrower than the desired exposure concept.
- Carrying eligibility is resolved as a type/participant Boolean only. There is no
  mechanism-aware `canCarry(character, mechanism, worldModel)` seam, so a carrier
  who is incompatible with natural fertilization but compatible with implantation
  cannot be represented without overloading `can_carry_pregnancy`.

#### Naming issues, not compatibility requirements

- `possible_conception` is narrower than the required exposure concept. If the
  current schema blocks direct implantation or another mechanism, change the schema
  directly; do not preserve the old semantic behavior for absent legacy data.
- `counterpart_ids` is broad enough to represent an exposure source/counterpart;
  it remains the current directed relation field.
- `can_fertilize` and `can_cause_pregnancy` are independent facts. The current
  alias/fallback is forbidden and must be removed from production code, prompts,
  normalization and tests.
- `sexual_activity_count` is a status/UI metric, not the authoritative population
  predicate. It may remain for compatibility while a mechanism-neutral exposure
  count is added later.

## 2. Recommended minimum generalization

### 2.1 Canonical Event meaning

Keep the existing envelope and ID arrays. Reinterpret the business meaning of
`pregnancy_relevance.relevant` as:

> this Event contains a factually supported reproductive exposure that is relevant
> to a possible future pregnancy-resolution path.

`possible_conception` is not the universal exposure predicate. If retained as a
domain field, it is an independently evidenced fact and may be false while
`relevant === true` for direct implantation or another non-conception pathway. No
legacy default, alias, or old semantic preservation is permitted.

Add one optional, open mechanism description at the Event/domain boundary, for
example `pregnancy_relevance.reproductive_mechanism`:

```json
{
  "kind": "world_defined_or_unknown",
  "label": "世界模型提供的机制名称或 null",
  "pathway": "opaque world-defined pathway description or null",
  "evidence": [{"kind": "reproductive_mechanism", "text": "..."}]
}
```

`kind`, `label`, and `pathway` are descriptive/opaque values, not a fixed enum of
implantation, parasite, magic, etc. The World Model remains the owner of mechanism
semantics. Event Analysis records what the current evidence says; it does not
resolve outcome.

This is a direct current-development schema change. The field is structured and
validated; mechanism kind is open data, not a closed enum. Unknown mechanism facts
remain explicitly unknown/null, and no legacy Event migration path is required.

### 2.2 Exposure predicate

Introduce one shared domain predicate, conceptually:

```text
isPregnancyRelevantExposure(event) =
  event is valid
  AND status is not negated/fictional
  AND pregnancy_relevance.relevant === true
  AND subject/counterpart references are valid for the Event type
  AND exposure evidence is present
```

The predicate must not inspect `type === 'sexual_activity'` or
`possible_conception === true`. Type-specific rules remain only for cardinality and
participant closure: the current one-subject subject-local rule can continue for
sexual activity, while non-sexual mechanisms get their own direct-participant
contract without forcing natural conception semantics.

### 2.3 Mechanism-aware carrying resolution

Keep World Model capability baselines tri-state. Add a pure, read-only seam rather
than new per-mechanism Boolean fields:

```text
resolveCarryingCapability({
  characterFacts,
  exposureEvent,
  mechanism,
  worldModel,
}) -> { value: true | false | null, evidence[], reason }
```

The resolver may use a World Model-defined mechanism/pathway and explicit character /
narrative evidence. A type-level `can_carry_pregnancy` is only one input fact; it is
not a universal gate for every mechanism. `can_fertilize`, `can_cause_pregnancy`, `can_be_fertilized`, and
`can_carry_pregnancy` stay independently evidenced; no equality or implication is
added between them.

Tracking then becomes:

```text
valid pregnancy-relevant exposure
  -> potential gestational subject
  -> resolveCarryingCapability(...)
  -> false: no active subject
     null: tracking_candidates[pending]
     true: tracking_subjects[eligible]
```

### 2.4 Persistence and schema decision

Update the current schema, fixtures, parser, validator, normalizer, prompts and
documentation directly. No migration, dual-read, dual-write or legacy compatibility
layer is required. New and edited facts are written only to the producing Floor /
Swipe owner. A failed analysis still leaves the previous successful result for that
Floor Version intact through the existing Runtime rollback and stale-version
protection; this is transactional behavior, not legacy migration.

## 3. Future StateReducer seam (not implemented here)

The future reducer should consume a read-only, provenance-bearing collection of
effective exposures and resolved world/mechanism facts:

```text
resolveCurrentBiologicalState({
  validExposureHistory: [{event_id, story_time, source, subject_id, counterpart_ids,
                          mechanism, evidence}],
  worldModelAtTime,
  priorBiologicalState,
}) -> CurrentBiologicalState
```

The reducer may later hand a stable input to Probability Resolution. It must not
re-read Chat-level history, reconstruct Events from Registry, or treat an eligible
Subject as proof of conception/pregnancy. It must aggregate valid Floor-local facts.
Random resolution and persistence are future contracts and are intentionally deferred.

## 4. Risks and trade-offs

- Reusing `relevant` minimizes domain churn but requires direct schema and validator
  changes so it is no longer coupled to conception semantics.
- An opaque mechanism description avoids hardcoding fantasy mechanisms, but World Model
  evidence quality becomes more important; unknown must remain pending rather than
  guessed.
- Mechanism-aware carrying resolution returns pending when mechanism evidence is
  genuinely missing; it must not invent a legacy fallback or probability.
- UI should not expose raw mechanism IDs or provenance in normal product pages. DTOs
  may add readable mechanism summaries later, while Debug retains raw evidence.
