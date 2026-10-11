# 技术设计：Pregnancy Lifecycle Archive & Release

## 1. 当前边界与核心判断

现有 Event Schema 已经是正确的事实入口，但不是完整 lifecycle contract：`core/events.js:56-72` 将 pregnancy facts 放进 `state_fact`，`core/events.js:448-481` 对既有事实只允许最小 payload；`runtime/character-event-analysis.js:54-86` 只负责稳定 materialization；`core/state.js:450-535` 把多个结束原因压缩到 `ended`。因此不能直接把 `core/state.js` 的 `ended` 当作 lock release，也不能用 `tracking_window.status=terminated` 替代生命周期事实。

推荐引入一个 canonical `pregnancy_lifecycle` factual DTO/Event boundary。既有 `pregnancy_confirmation`、`pregnancy_loss`、`abortion`、`delivery` 仍可作为兼容输入，但必须在 Event Analysis/domain normalization 中映射成同一 normalized lifecycle fact；不得由 reducer 从 Event type 猜测未声明的 outcome。本轮不修改生产代码或规范。

## 2. Canonical lifecycle fact

### 2.1 推荐 payload

```json
{
  "schema_version": 1,
  "fact_id": "pregnancy_lifecycle_<deterministic>",
  "subject_id": "char_000001",
  "pregnancy_id": "preg_<deterministic-or-existing>",
  "cycle_id": "projection_timing_cycle_<deterministic>",
  "status": "delivery",
  "source_event_id": "evt_<floor-derived>",
  "evidence_refs": ["event:<source_event_id>", "floor:<version-key>"],
  "story_time": {"normalized": "...", "day_index": 123, "precision": "day"},
  "source_floor_version": {"chat_id": "...", "message_id": "...", "floor": 12, "swipe_id": 0, "content_hash": "...", "message_version": "..."}
}
```

Required semantics:

- `status` is exactly one of `not_pregnant | pregnant_ongoing | miscarriage | termination | delivery | outcome_unknown`.
- `subject_id` is the canonical gestational subject from Event participant closure; no display-name, role, gender or positional inference.
- `pregnancy_id` is required for an identified pregnancy (`pregnant_ongoing`, `miscarriage`, `termination`, `delivery`); `not_pregnant` must carry an explicit `pregnancy_id: null` and must never pass a `pregnancy_ref: new` path. This status-specific null is an explicit “no confirmed pregnancy episode” value, not permission to synthesize an ID. `outcome_unknown` may be null only when ST explicitly leaves the episode unidentified.
- `cycle_id` is required for `not_pregnant` and for every fact referring to a known Exposure round. It is the existing deterministic exposure/timing cycle identity, not a newly sampled lifecycle identity. A confirmed pregnancy binds the cycle explicitly to `pregnancy_id`; later facts must not select a cycle by nearest date, elapsed time or first matching Event.
- The existing identity contract remains authoritative: `runtime/character-event-analysis.js:60-72` may materialize a deterministic `pregnancy_id` only for an explicit `pregnancy_ref: new`/`existing` fact. The future lifecycle normalizer must reject that materialization path for `not_pregnant` and validate `(subject_id, cycle_id, pregnancy_id=null)` instead.
- `source_event_id`, `source_floor_version`, `story_time` and `evidence_refs` are mandatory for a persisted fact. `source_floor_version` must remain the exact active Character Floor/Swipe six-field version.

### 2.2 Source mapping

| Normalized status | Accepted explicit ST/Event source | Must not be inferred from |
| --- | --- | --- |
| `not_pregnant` | New explicit negative pregnancy fact with subject/current-cycle scope and `pregnancy_id: null` | Window expiry, elapsed time, lack of symptoms, Projection |
| `pregnant_ongoing` | Explicit confirmed ongoing pregnancy fact; existing `pregnancy_confirmation` maps here only when its factual meaning is confirmation, not outcome | confirmation alone after a later conflicting terminal fact |
| `miscarriage` | Explicit `pregnancy_loss` whose ST meaning is miscarriage | generic `pregnancy_loss` without outcome meaning, Timing |
| `termination` | Explicit `abortion`/termination fact | father status, Projection, Story Time |
| `delivery` | Explicit `delivery` fact with matching pregnancy identity | `labor`, `postpartum`, gestation duration |
| `outcome_unknown` | Explicit ST statement that outcome remains unknown, or a normalized unresolved fact retained as non-terminal evidence | absence of a terminal Event, timing window miss |

`labor` and `postpartum` remain independent facts. They may be evidence around a lifecycle fact but cannot upgrade it. `probable`, `ambiguous`, `negated` and `fictional` facts remain historical/uncertain and cannot transition or release, consistent with `.trellis/spec/domain/event-pipeline.md:654-679`.

### 2.3 Identity, idempotency and conflicts

- `fact_id` is deterministic from schema version, normalized status, subject, pregnancy/cycle identity and source Event ID. Same source fact read again dedupes; same `fact_id` with different payload is a conflict.
- The identity tuple for an identified episode is `(subject_id, pregnancy_id, cycle_id)`; `pregnancy_id` is the biological episode identity and `cycle_id` is the Exposure/timing round. A new cycle never inherits the old tuple's candidates, aggregation record or release state.
- A terminal outcome is monotonic for a given tuple. Repeated identical miscarriage/termination/delivery facts are idempotent; distinct terminal outcomes conflict and fail closed. `pregnant_ongoing` may precede one terminal outcome, but cannot reopen a released tuple.
- `outcome_unknown` never releases. A later confirmed ongoing or terminal fact may supersede it by append-only transition; the unknown evidence remains archived.
- `not_pregnant` closes only the referenced Exposure round. It does not create a pregnancy episode, does not create a confirmed `pregnancy_id`, and does not authorize cleanup of unrelated cycles.

## 3. Archive/release ownership and records

Add a separate Floor-owned sibling root, recommended name `pregnancy_lifecycle_timeline`. It uses the same storage contract as `participant_aggregation_timeline`: exact Character message/active Swipe, complete six-field Floor Version, Coordinator mutation, authoritative readback, endpoint-bound read, and lifecycle clear/invalidation. It owns independent candidate records and release state, while the current Character Floor owns the post-deletion complete `events[]` snapshot. It never edits a historical Floor or copies facts to Chat metadata.

Recommended logical shape:

```text
pregnancy_lifecycle_timeline:
  schema_version
  facts[]
  candidate_records[]
  archives[]
  release_records[]
```

An archive snapshot is keyed by `archive_id` derived from `(subject_id, pregnancy_id|null, cycle_id, terminal_fact_id)` and contains the terminal lifecycle fact and full provenance, current valid `participant_aggregation`/`aggregation_id`, exact `accepted_exposure_event_ids`, current candidate list and source Event IDs, participant→Exposure mapping, Projection evidence refs, `archived_at_floor_version`, payload digest and readback status. Candidate records required after Exposure deletion must be independently readable from this lifecycle root; they cannot be reconstructed from deleted Events.

The snapshot is immutable. If current Events later disappear because a Floor/Swipe is deleted, the archived evidence remains historical; current read models must still validate surviving ownership before exposing it.

The release state machine is append-only and idempotent:

```text
identified → candidates_persisted → archive_readback_verified → old_exposure_deleted → event_snapshot_readback_verified → cycle_lock_released
```

Every transition records `archive_id`, `(subject_id,pregnancy_id|null,cycle_id)`, source fact, operation key, current Floor Version, precondition and postcondition. No transition is allowed for `outcome_unknown` or unresolved conflict. A `not_pregnant` archive/release uses the cycle identity and null pregnancy identity; it does not invent a pregnancy episode.

## 4. Runtime order and recovery

1. Resolve current valid Floor/active Swipe and lifecycle fact; reject stale owner, missing Version, mismatched Chat or unknown identity. For `not_pregnant`, require `pregnancy_id === null` and a resolvable current `cycle_id`.
2. Read current aggregation, candidates, accepted Exposure IDs, participant mapping and Projection evidence from current valid complete Events. For `not_pregnant`, the candidate/archive payload may be empty, but the cycle's exact accepted Exposure IDs and source evidence still must be captured when available.
3. Append immutable archive snapshot through the lifecycle Floor owner.
4. Read the same owner back and verify identity, digest, provenance and required evidence.
5. Build a complete current Event snapshot with exactly the old cycle's Exposure Event IDs removed. Preserve all other cycle/person/non-NSFW Events; `events: []` is valid and authoritative. The deletion patch must be resolved inside the Floor Persistence Coordinator from its latest authoritative snapshot, not precomputed from an earlier read, so an interleaved unrelated or C002 write is preserved.
6. Read back the complete Floor snapshot and verify the target IDs are absent, all unrelated Events remain, owner/Swipe/version are current, and an empty array is not replaced by inherited Events.
7. Append `old_exposure_deleted` and clean only cycle-scoped aggregation candidate data that no longer has business use. Keep independent father candidate records when father remains unknown.
8. Append `cycle_lock_released`; the lock key is cycle-specific, never subject-global. A failed release record is retryable and cannot block a distinct C002 cycle.

Failure rules:

- `fact_conflict`: preserve all conflicting facts/evidence and fail closed; no archive, exit or release. Do not use last-write-wins.
- `event_analysis_failed`: no lifecycle transition and no lock mutation; retry from the next valid analysis while preserving the last authoritative state.
- Archive write failure: no exit and no release; retry the same deterministic `archive_id`.
- Archive write succeeds but readback fails: classify as unverified, not as business conflict; preserve the write, do not clear or release, retry readback/diagnose stale owner.
- Archive verified but Event snapshot deletion/save fails: archive and independent candidate records remain the recovery source; retain the old-cycle lock, retry the exact deletion against a fresh current Floor, and never delete or rewrite a historical Floor.
- Event snapshot save succeeds but readback fails: do not release the lock or claim deletion complete; retry readback against the same owner/version, and fail closed if the target Floor changed.
- Event snapshot deletion/readback succeeds but candidate cleanup fails: keep the independent candidate record and mark cleanup pending; do not block C002 solely because a retryable cleanup remains.
- Exposure deletion succeeds but lock release fails: keep release pending and retry. The evaluator must scope by `(subject_id,pregnancy_id|null,cycle_id)` and permit a distinct C002 after the old cycle's valid snapshot has been deleted; a release failure cannot become a subject-global permanent block.
- Any stale async callback, Swipe switch, Floor Version change or Chat switch aborts before each write. A later valid execution resumes the deterministic state machine.

Each stage has a deterministic operation key and readback predicate. Re-running after any failure either returns the already verified stage or advances the next missing stage; it never duplicates an archive, removes evidence, or rewrites an earlier Floor snapshot.

## 4A. Exposure deletion: complete current Floor snapshot

The current implementation already has the required primitive for current-snapshot deletion: `runtime/event-editing.js:276-301` removes an Event from the complete array and commits the full result, while `storage/store.js:864-900` writes the exact Character Floor/Swipe slot. Lifecycle deletion must use the same complete-snapshot boundary, with cycle selection added before the write.

Required flow:

1. Resolve current valid Character Floor, active Swipe and complete six-field Version.
2. Resolve the target `(subject_id,pregnancy_id|null,cycle_id)` and exact Exposure Event IDs from current aggregation/timing/window provenance; fail closed if any ID cannot be proven to belong to the target cycle.
3. Remove only those Exposure IDs from the current full `events[]`; preserve unrelated people, cycles, medical/symptom/lifecycle facts and other Event types.
4. Commit the complete resulting array through the Floor Persistence Coordinator. An empty resulting array is a valid authoritative snapshot. For lifecycle cleanup, the Coordinator receives a patch resolver that filters the target IDs after the latest six-field-validated read; a stale static `events` array is not safe.
5. Read back the exact current Floor/Swipe/version and assert target IDs are absent and unrelated IDs are unchanged.
6. Rebuild Tracking/Projection inputs from this readback snapshot; never inherit old Events from a prior Floor, future Floor, Chat cache or registry.

This is real current Event deletion, not read-model hiding. It does not modify historical Floors because the mutation creates a new current Floor snapshot. If deletion or readback fails, no lock release occurs.

## 5. Integration boundaries

- `participant_aggregation_timeline` remains the source of aggregation success and frozen Timing provenance. Lifecycle timeline references it; it does not move or reinterpret it. The lifecycle timeline is the only owner of release/exclusion state.
- Tracking Window may expose `resolved_pregnant` / `terminated` as a compatibility view, but only normalized lifecycle facts authorize archive/release. `expired` remains horizon-only.
- Projection Context retains historical records but hides current context when lifecycle release or aggregation evidence no longer matches. It never becomes lifecycle authority.
- `core/state.js` may expose a derived Episode status, but archive consumes explicit normalized facts, not the lossy `ended` value.
- Existing disabled gate remains false until the full capability is tested. Future lock evaluation must receive a cycle-scoped release view. `father_status` is not owned or changed by this task.

## 5C. Projection 投递与后续正文顺序契约（本轮只设计）

### 5C.1 已确认的真实 Runtime 调用链

当前可观测链路不是“Projection AI 成功即已投递”，而是：

```text
projectionRuntime.process()
  → evaluateProjectionEligibility()
  → generateProjectionCandidate()
  → saveGeneratedProjection()/saveProjectionEvidence()
  → refreshProjectionContext()
  → projection-context.write()
  → setExtensionPrompt()
  → GENERATION_STARTED
  → GENERATION_ENDED + CHARACTER_MESSAGE_RENDERED settle
  → Event Analysis 对目标 Floor 执行并持久化
```

具体证据：`runtime/projection-runtime.js:runExecution()` 在生成后保存 Projection/evidence 并调用 `refreshProjectionContext()`；`runtime/projection-context.js:write()` 调用宿主 `setExtensionPrompt()`；`runtime/events.js:2630-2767` 在 `GENERATION_STARTED` 前等待 refresh，并记录 `context_fingerprint` 与 setter/slot 结果；`runtime/generation-lifecycle.js:173-399` 要求 generation end 与 character render 一起 settle；`runtime/event-analysis.js:4170-4225` 仅在当前 render 目标进入 scheduler handoff，`finalizeExecution(..., "success")`/`EVENT_ANALYSIS_COMMITTED` 才证明该六字段 Floor Version 的分析已完成。`PROJECTION_READBACK` 只证明 Projection readback，不证明宿主模型消费。

`MESSAGE_RECEIVED`、Host generation end 或 `setExtensionPrompt` 返回成功本身均不是“提交后的新正文已被分析”的证据。后续正文必须以当前 active Swipe 的完整六字段 Floor Version（尤其 `message_id`、`swipe_id`、`content_hash`、`message_version`）和该版本 Event Analysis 成功 readback 共同确认。

### 5C.2 重复提交、regenerate 与 Swipe

同一 Projection 可能被 Projection process 结束时、每次 `GENERATION_STARTED`、`MESSAGE_RECEIVED` 后及 owner refresh 再次注入。`refreshProjectionContext()` 通过 `refreshTail` 串行化，但不会为同一 Projection 提供持久提交身份；重复调用不得重置等待起点，也不得创建新的 aggregation/cycle。

regenerate/新 Swipe 必须用新的 `swipe_id` 及相应 `content_hash`/`message_version` 形成新的正文版本。Floor 回退或 Swipe 切换只读取目标 Floor 当前有效记录，不能引用未来 Floor 的提交或正文。

### 5C.3 最小 Floor-owned 证据契约

现有 `participant_aggregation_timeline` 不承接 Projection 投递语义；本实现将最小记录作为 `projection_timeline.delivery_records` 的扩展，由同一 Floor owner、Coordinator 和六字段 Version guard 管理，不建立第二套 Projection 身份体系：

```text
projection_delivery_record:
  delivery_id                 # deterministic, not AI-generated
  projection_id
  aggregation_id
  subject_id
  pregnancy_id|null
  cycle_id
  submitted_floor_version    # all six fields
  context_fingerprint
  submitted_status            # submitted / readback_verified
  status                      # readback_verified / response_observed
  response_id|null            # deterministic from delivery + response version
  response_floor_version|null # all six fields
  generation_id/intention|null
  analysis_execution_id|null
  analysis_status|null        # success / failed / skipped / stale
  explicit_lifecycle_fact_ids[]
```

`submitted_status=readback_verified` 只能证明可验证的 prompt 提交边界，不宣称模型实际阅读。只有提交之后出现新的完整 Floor Version，且对应 Event Analysis 以 `success` 完成并 readback，才可计数为“至少一条新正文”。failed、skipped、stale、无分析或仅 Host event 的版本均不得计数。

记录必须经过现有 Floor Persistence Coordinator，具备 owner/epoch/六字段 Version guard、确定性 operation key、重复提交/重复正文观察幂等和 stale retry。重复 refresh 相同 Projection 不得覆盖原始提交起点；正文观察不得跨 Chat、Floor 或 Swipe 复用。

### 5C.4 自动超时的严格判定

只有 aggregation success、有效提交 readback、至少一个提交后 Event Analysis 成功的新正文、无明确 lifecycle fact、Story Time 可比较、冻结 Timing Instance 的 `effective_max` 已超过且 cycle 未 release 同时成立，才允许标记“本轮未触发怀孕”。这不是显式 `not_pregnant` Event，也不能由 Projection AI 输出伪造。

尚未 aggregation 的 overdue 仍走 `resolveParticipantAggregationTrigger()` 的 `aggregate_due_overdue` compensation；补偿聚合和投递的同一次处理不得立即结束周期。若没有新正文、分析失败/跳过、Story Time 不可比较或事实 identity 不明确，必须 fail closed。

当前实现已写入并 readback `projection_timeline.delivery_records`，提交回执只在 Projection/evidence readback、`setExtensionPrompt()` 成功且当前 Floor 仍有效后生成；后续正文回执只在 Event Analysis success/readback 后生成。`timeout_no_pregnancy` 复用现有 `archiveAndRelease`，不写入伪造 lifecycle fact。重复 refresh、stale Version、无效 Swipe/Floor 和失败 readback 均 fail closed；生产 gate 仍 disabled，真实宿主消费仍不被声称。

## 5A. Father tracking independence

Pregnancy lifecycle and father tracking are separate state machines. `delivery`, `miscarriage` and `termination` close/release the pregnancy Exposure cycle only; they never write `father_status=confirmed`. `father unknown` does not block archive, Exposure deletion, lock release or creation of a new cycle. Before deleting Exposure, candidate records needed after deletion must already be independently persisted. If father remains unknown at pregnancy end, keep that independent candidate record; if a later explicit father confirmation arrives, preserve the confirmed attribution fact and delete only the now-unused candidate list/mapping. Candidate cleanup must be deterministic and must not remove confirmed attribution or evidence required for audit.

## 5B. NSFW classification and cycle-scoped lock

The lock must not classify every Event as NSFW. The future implementation must first identify the existing NSFW/Exposure classification boundary and preserve non-NSFW factual Events. `sexual_activity` is not automatically sufficient by itself: only the subject-local pregnancy-relevant Exposure slice that passes the existing `pregnancy_relevance`/participant contract is lockable. Medical, symptom, pregnancy lifecycle, delivery and other biological facts remain writable unless independently classified as the target cycle's lockable NSFW Exposure.

For an AI composite Event, reuse the existing split boundary (`runtime/character-event-analysis.js:356-360`) before filtering. Filter only slices whose `(subject_id,pregnancy_id|null,cycle_id)` is currently locked; retain other people and unrelated slices, then validate and save the complete resulting Event array. `updateEvent()` must reject only a locked cycle's NSFW Exposure, while `deleteEvent()` remains allowed. The gate remains disabled until deletion, candidate lifecycle and release have passed end-to-end tests.

The Runtime capability seam is test-only until the production gate is approved: `createRuntime({participantAggregationLockCapability: true})` resolves the current Floor's aggregation timeline and lifecycle release records, then passes cycle keys into the existing lock helpers. The default is `false`, so production remains `disabled_until_lifecycle_archive_release`. Event Analysis filters only newly materialized lockable Exposure slices; editing checks the original Event before normalization and the resulting Event after normalization, preventing type/subject/relevance edits from bypassing a lock. Delete has no corresponding rejection check.

## 6. C001 → C002 isolation

```text
C001 exposure(s) → C001 aggregation success → ST confirmed pregnancy (P1,C1)
→ ST confirmed delivery → archive P1/C1 + readback → C1 Exposure exit
→ C1 lock release → C002 exposure creates P2/C2 basis
```

Assertions: C1 archive contains only C1 accepted IDs/candidates/mapping; the current C1 Floor snapshot no longer contains C1 Exposure IDs after verified deletion; C1 father remains `unknown` unless a later independent ST/Event fact confirms it; C1 father unknown cannot block C2; C2 has new identity and no C1 aggregation/archive/candidate/Projection/lock state; historical Floor snapshots remain immutable; a retrying C1 release cannot block a distinct C2.

## 7. Compatibility, migration and risks

No migration is performed in this planning task. Implementation must define legacy no-cycle handling (recommended: no release until explicit binding is recoverable), generic `pregnancy_loss` handling (recommended: uncertain/non-releasing until explicit outcome), absent lifecycle timeline behavior (recommended: lock stays disabled), and registry/clear/test coverage before enabling writes.

Main risks are a unified Event type touching AI prompts and parser, the existing `pregnancy_id`/exposure-derived `cycle_id` split, stale source Floors after edit/Swipe deletion, and the current working tree's unrelated uncommitted aggregation changes. Implementation must isolate this task's diff.

## 8. 子代 NPC / Genealogy 架构审查（仅设计，不在本 task 实施）

### 8.1 现有 char/NPC 体系

当前 BioWeave 没有与 SillyTavern Character Card 等价的独立 NPC 表。现有 canonical 人物身份就是 `character_registry` 中的 `character_id`：

```text
AI mention / existing-or-new classification
  → Runtime resolveEventAnalysisIdentities()
  → allocateSequentialCharacterId()
  → Floor-owned character_registry.entities[character_id]
  → current Events / Tracking derived views
```

证据：`core/identity.js:435-465,508-625`、`runtime/character-event-analysis.js:356-618`、`storage/store.js:864-900`。ID 格式为 `char_` 加六位序号，分配只看 registry 中已有 canonical IDs；display name、alias、角色卡 ID、species、gender、event role 都不能生成或替代 ID。

`character_registry` 当前实体只有：

```json
{
  "character_id": "char_000123",
  "display_name": null,
  "aliases": []
}
```

因此它可以承载未命名人物的稳定身份，也可以承载后续改名，但不能直接承载出生日期、年龄、species、gender、parent IDs、pregnancy provenance 或 father candidate state。

### 8.2 NPC 与角色卡的关系

角色卡只属于 SillyTavern 宿主上下文/资料来源；当前 BioWeave 的 active Characters 来自 `tracking_subjects`，而不是角色卡全量列表。一个角色卡可在叙事中产生多个 canonical `character_id`，也不能把宿主 card ID 写入 child identity。`docs/DATA-MODEL.md`、`docs/DEVELOPMENT.md` 和 `.trellis/spec/domain/event-pipeline.md:312-360` 均要求稳定人物关联使用 `character_id`，不用姓名或 UI 可见性。

### 8.3 当前缺失的 NPC 运行时链

目前不存在以下生产链：

```text
confirmed delivery
  → newborn count/identity binding
  → character_registry creation/update
  → parent relationship persistence
  → Floor readback
```

`core/genealogy.js:1-2` 只有 `sortRelatives()` 和 `childrenOf()` 查询辅助；`tests/genealogy.test.js:1` 只验证排序，没有关系写入测试。`storage/lifecycle.js` 和 `storage/schema.js` 也没有 genealogy/NPC profile owner。不能把这些查询函数误认为已存在的 NPC persistence。

### 8.4 推荐的孩子身份与状态模型

不新增 `child_id`。后续独立任务应在现有 `character_id` 上建立 child-owned、Floor-owned 的人物事实/关系记录；具体 root 名称、schema 和 owner 仍需单独设计并注册到 lifecycle registry。推荐最小逻辑记录如下：

```json
{
  "character_id": "char_000124",
  "display_name": null,
  "identity_status": "confirmed",
  "species": null,
  "gender": null,
  "birth_story_time": {"day_index": 123, "precision": "day"},
  "mother_character_id": "char_000001",
  "father_character_id": null,
  "father_status": "unknown",
  "source_pregnancy_id": "preg_...",
  "source_cycle_id": "cycle_...",
  "father_candidates": []
}
```

这不是本轮新增 canonical schema，只是用于评估缺口的候选契约。`age` 不应成为永久事实字段；若现有 Story Time 规范没有更具体的年龄规则，年龄应由 `birth_story_time` 与当前有效 Story Time 派生。不得从父母资料自动推断 child species、gender 或其它未知字段。

状态约束：

- 明确“一名孩子”才创建一个稳定 `character_id`；明确双胞胎才创建两个不同 ID。
- delivery 但数量未知时只保存待解析出生事实/诊断，不创建固定数量 NPC；后续唯一明确的出生事实才能继续。
- 未命名孩子可以存在，命名和改名只更新同一 ID。
- 多胞胎后续命名若不能唯一绑定目标 ID，fail closed。
- `miscarriage`、`termination`、死产等不能自动进入存活 child 状态；当前体系没有足够的死产/出生结局枚举，必须先补充最小 canonical 状态契约。

### 8.5 父方候选转移

当前 pregnancy 候选由 `core/reproductive-attribution.js` 和 `pregnancy_lifecycle_timeline.candidate_records[]` 表达，候选包含 pregnancy subject/source/event refs，但不包含 child ID。因而出生后的转移必须等待两个条件：

1. ST 明确确认出生人数；
2. 每个出生孩子都获得唯一、稳定的现有 `character_id`。

转移顺序应为：

```text
child relationship/candidate record persist
  → child record readback + Floor/Swipe/version verification
  → remove mother pregnancy/cycle active candidate record
  → mother-side cleanup readback
```

父源已确认时，只保留 child 的 confirmed parent relationship；父源未知时，每个 child 必须能独立确认父源，但应避免为每个 child 重复复制同一来源证据。推荐共享不可变来源证据引用、独立 child relationship state；不同 child 不得合并 `father_status`。如果 child identity、child ordinal 或候选归属无法唯一绑定，不得删除母亲侧候选。

母亲 C001 的 archive/delete/release/C002 不等待以上转移；转移失败只能留下可恢复的母亲侧候选，不得阻止 C002。`miscarriage` 与 `termination` 不走出生转移路径。

### 8.6 父源确认的 identity binding

现有 `reproductive_source_attribution` canonical payload 在 `core/events.js:478-486` 和 `core/reproductive-attribution.js:1-24` 绑定 `(pregnancy_id, subject_id, source_character_id, contribution_kind)`，没有 `cycle_id`，也没有 child `character_id`。`core/state.js:350-435` 只在已有 Pregnancy Episode 下保存 confirmed/excluded contributor relationship。

因此：

- 出生前父源确认至少需要由已确认的 pregnancy identity 绑定；若 cycle 仍是母亲 lifecycle cleanup 的必要键，当前 payload 仍不足以做 cycle-scoped cleanup，不能靠最近时间或 Exposure 顺序补齐。
- 出生后父源确认必须绑定具体 child `character_id`，不能仅凭 pregnancy_id 在多胞胎间广播。
- 多胞胎必须拥有独立 relationship state；一个孩子的确认不得改变其它孩子。
- 系统应确定性提供 pregnancy/cycle/child binding；AI 只能提供事实内容和 response-local mention，不得编造这些 IDs。

本轮不修改 canonical schema。最小待确认契约是：是否为 attribution fact 增加显式 `cycle_id`，以及是否新增明确的 `child_character_id`/child-target relationship fact；在用户确认前，无法唯一绑定时保留候选，不执行删除。

### 8.7 Floor/Swipe 历史语义

由于 registry 是 cumulative snapshot 而不是全局事实源，后续 child record、关系和命名必须由当前 Character Floor/active Swipe owner 保存，并绑定完整六字段 Floor Version。回退到 Floor 25 时只能读取该 Floor 最近合法 registry/child record；Floor 30 可见出生但未命名，Floor 35 才可见名字。Swipe 切换只读取目标 Swipe owner。

不得通过修改全局 registry、Chat metadata 或 Runtime cache 让未来出生/命名回流到历史 Floor。若当前 registry 仅能承载 ID/姓名，必须新增经过 lifecycle registry 和 Coordinator 约束的 Floor-owned child facts；不能绕过现有存储抽象。

## 9. 与当前 lifecycle 实现的最小衔接范围

当前 task 不实现 NPC 创建。最小衔接仅包括：

1. delivery lifecycle archive 保存出生事实的 source Event、pregnancy/cycle provenance 和候选来源证据；
2. 母亲 Exposure 删除、cycle lock release、C002 仍独立完成；
3. 后续 child task 消费已验证 archive/candidate record，成功建立 child identity 后再执行候选转移；
4. child creation/transfer 不得回写历史母亲 Floor，不得改变 miscarriage/termination 的 release 语义；
5. 生产 NSFW gate 继续保持 `disabled_until_lifecycle_archive_release`，直到原 lifecycle 任务自身验收完成。

## 10. 已批准的 delivery archive handoff contract

当前 task 的 archive 是母亲 pregnancy/cycle 的历史证据，不是 child NPC owner。对 `delivery`，archive 至少必须保留：

```text
mother_character_id / subject_id
pregnancy_id
cycle_id
delivery_source_event_ids[]
source_floor_version / active swipe provenance
birth_story_time (nullable until canonical delivery evidence exists)
birth_outcome (nullable until canonical outcome exists)
birth_count (nullable until explicit count exists)
father_status
candidate_source_refs[]
accepted_exposure_event_ids[]
participant_mapping[]
```

其中 `birth_count`、`birth_outcome` 和 child-specific birth facts 目前只能作为 archive handoff 的可选接口字段/缺口诊断，不能直接写入现有 canonical `pregnancy_lifecycle` fact。现有事实证据为：`core/events.js:465-476` 的 lifecycle payload 没有出生字段，`core/events.js:492-494` 的 legacy `delivery` payload 只有 `pregnancy_id` 和 `delivery_id`，`core/pregnancy-lifecycle.js:120-145` 当前 archive 只保存 terminal fact、aggregation、accepted IDs、mapping、candidate/projection evidence 与 Floor Version。

因此本 task 的实现边界是：

1. 不伪造出生人数、存活结局、性别、种族、姓名或 child ID；
2. 保存可确认的 delivery source Event IDs、Story Time、pregnancy/cycle 和父方候选来源；
3. 缺少出生人数/结局时，以 nullable handoff metadata 或诊断表示，不触发 child 创建；
4. 母亲 Exposure 删除、cycle release、C002 仍按既有 lifecycle 状态机独立完成；
5. 后续 `Pregnancy Child NPC & Genealogy` task 在 canonical 字段获批准后，才可建立 child-target relationship 和候选转移。

候选交接不能成为母亲 release 的前置条件。若 child identity 或出生人数无法唯一确定，母亲侧 candidate archive 必须保留；清理母亲当前 active candidate 的操作只能在独立 child record 已成功 readback 后由后续 task 执行。
