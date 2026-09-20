# Implementation Plan — Phase 2A.1

本文件描述本轮已获审核并执行中的实施步骤。`task.py start` 已完成；以下波次
与硬性架构约束是本次 implementation 的验收边界。

## Hard gates for every wave

- Floor-local analysis results are authoritative。每个 Floor / Swipe 产生的事实
  只能通过现有 Floor storage abstraction 保存于
  `message.swipe_info[swipe_id].extra.bioweave`，没有 Swipe structure 时保存于
  `message.extra.bioweave`。
- 不得新增 Chat-level authoritative biological aggregate、Event/Profile/Exposure/
  Mechanism database、dual-write 或 runtime-as-source path。
- No legacy compatibility is required during current pre-release development。删除
  compatibility alias、deprecated fallback、dual-read/dual-write 和旧语义保留，
  不为不存在的旧用户数据增加技术债。
- 不得实现 probability、random resolution、outcome、Snapshot、Projection、
  Genealogy、StateReducer 或 full Context Injection。
- 如果实际代码与某波前提冲突，停止该波并记录具体冲突，回到规划；不得大范围
  临时重构来绕过冲突。

## Wave 0 — contract and storage boundary preparation

1. Re-read and reconcile `.trellis/spec/domain/floor-state.md`,
   `docs/bioweave-data-lifecycle.md`, `docs/DATA-MODEL.md` and the Event/World
   Model specs. Update the canonical domain wording first; do not create a second
   lifecycle field list.
2. Define the current-development structured mechanism contract and schema directly；
   不设计 legacy migration 或 compatibility schema。
3. Trace every write/read path for analysis, Event, registry, profile, exposure,
   mechanism and capability evidence. Prove every authoritative write lands in the
   producing Floor / Swipe owner and Chat metadata is not used as an owner。
4. Add a shared domain exposure predicate and pure mechanism-resolution contract with
   unit tests before changing Runtime or UI consumers。

## Wave 1 — Event Domain and parser

1. Update `core/events.js` normalization/validation so `relevant === true` can
   represent non-conception reproductive exposure with valid subject/counterpart
   references and mechanism evidence.
2. Preserve old sexual-activity subject-local cardinality and collection duplicate
   validation, but move the common exposure checks behind the shared predicate.
3. Treat `possible_conception` only as an independently evidenced fact if retained by
   the corrected schema；remove rules that block valid non-conception exposure。
4. Delete every `can_fertilize` fallback/alias to `can_cause_pregnancy`; add explicit
   tests proving `true` plus no independent evidence remains `null`。
5. Update `ai/analyzer.js` parser and `ai/prompts.js` so non-sexual exposure can be
   returned, mechanism values remain open, and capability values remain independent
   tri-state facts.
6. Preserve Runtime-owned canonical IDs, Floor Version, source provenance and
   identity resolution. Do not let the AI provide authoritative source fields.

## Wave 2 — World Model and mechanism-aware Tracking

1. Extend the World Model/Event contract with a stable structured mechanism object：
   open kind/label/pathway, supporting World Model rule/fact references and evidence。
   Do not add `can_implant_embryo`, `can_seed_host`, `can_magic_pregnancy`, or a
   closed natural/implantation/magic enum。
2. Implement `resolveCarryingCapability(...)` as a pure function with explicit
   evidence precedence and `true | false | null` output.
3. Change `collectExposureCandidates()` and Registry rebuild to use the shared
   exposure predicate and resolver. Retain pending candidates and complete Floor /
   Swipe provenance。
4. Keep `can_fertilize` and `can_cause_pregnancy` separate with no alias or fallback。
   `resolveCarryingCapability({characterFacts, exposureEvent, mechanism, worldModel})`
   returns only `true | false | null`; it never returns probability or outcome data。

## Wave 3 — Runtime persistence, DTO and isolation

1. Update Runtime Event Analysis, edit, delete and rebuild paths to validate the full
   collection for mixed event types and preserve last successful Floor results on
   failure.
2. Keep `sexual_activity_count` only as a compatibility/status metric; add or rename
   a mechanism-neutral exposure metric only if product UI actually needs it.
3. Keep normal UI consuming Registry/Event DTOs. Do not move eligibility logic into
   `ui/characters.js`, `ui/events.js`, `ui/overview.js`, or UI form parsing.
4. Add current-schema tests for mechanism values, Floor-local persistence, Chat
   isolation, Swipe 0/reroll/content hash/Floor Version isolation, deletion, stale
   versions and rollback。Do not add migration or old-alias tests。

## Test plan

### Domain and parser

- A valid non-sexual implantation/medical/parasitic/magic-shaped exposure can be
  normalized and validated without `possible_conception === true`.
- A non-exposure sexual activity remains empty and never creates a candidate.
- `possible_conception === false` does not erase a valid mechanism exposure.
- `can_fertilize === true` never implies `can_cause_pregnancy === true`; no alias or
  fallback exists and the two fields are independently tested.
- `can_be_fertilized`, `can_carry_pregnancy`, and mechanism carrying resolution each
  preserve true/false/null and evidence conflicts.
- Gender, name, pronoun, role, position and weak identity text never authorize
  exposure or eligibility.
- Subject/counterpart references, participant closure, evidence requirement and
  duplicate subject collection rules remain sound.

### Tracking and Runtime

- Valid non-sexual exposure creates eligible/pending candidates according to the
  mechanism-aware resolver.
- Ordinary NSFW and unrelated biological events create no candidate.
- A valid sexual-activity exposure produces the same subject/candidate result after
  the mechanism-neutral gate is applied.
- Full Floor collection validation, identity resolution, deterministic IDs, source
  provenance, edit/delete rebuild, Swipe isolation, stale async protection and
  failed-refresh rollback remain unchanged.
- Registry never becomes a second Event database and no Chat-level Event history is
  introduced.
- Every directly produced analysis fact is persisted in the producing Floor / Swipe
  owner, while Registry/Profile/UI state can be rebuilt from valid Floor facts。

### World Model and UI

- World Model accepts open structured mechanism descriptions with unknown fields
  preserved as unknown/null, no fixture-specific species rules, and no hardcoded
  mechanism enum。
- Normal UI renders only readable DTO projections and never re-runs eligibility or
  exposes raw IDs/provenance; Debug may inspect mechanism evidence.
- StateReducer/Projection/Outcome code remains absent from the diff.

## Validation commands

Implementation validation uses the repository's normal commands and focused suites:

```bash
node --check core/events.js
node --check core/tracking.js
node --check ai/analyzer.js
node --check runtime/event-analysis.js
node --test tests/events.test.js tests/tracking.test.js tests/event-analysis.test.js
node --test tests/event-analysis-runtime.test.js tests/world-model.test.js tests/phase2a-ui.test.js tests/phase2a-app.test.js
npm run check
```

Required new cases include independent `can_fertilize`/`can_cause_pregnancy`,
non-sexual valid exposure, natural-false versus implantation-true carrying
resolution, unknown mechanism pending, multiple directed sources, Floor-local writes,
Runtime rebuild from valid Floors, Swipe 0/reroll isolation, Chat isolation, no gender
or sexual-role inference, and open mechanism representation without a fixed enum。

Real SillyTavern Desktop/Tablet/Mobile host acceptance remains required after code
implementation; Node tests do not replace host validation.

## Rollback points and review gates

- Gate A: domain wording, direct schema and Floor-local ownership reviewed before code。
- Gate B: parser/domain tests pass before Tracking changes.
- Gate C: Tracking/Runtime tests pass before any UI DTO change.
- Gate D: full diff confirms no StateReducer, Snapshot, Projection, Genealogy,
  Context Injection, Chat-level Event database, or product UI reclassification.
- Any failed analysis or stale save must preserve the previous valid Floor result;
  rollback is limited to the current implementation wave and must not discard
  accepted prior Phase 2A behavior。
