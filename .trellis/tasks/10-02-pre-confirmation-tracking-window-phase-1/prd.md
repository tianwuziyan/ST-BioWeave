# PRE-CONFIRMATION TRACKING WINDOW PHASE 1

## Goal

在当前已冻结的 Tracking Subject/Candidate、Observation Timing Instance、Projection、Current State、Floor/Swipe ownership 与 forward-only persistence 之上，实现最小完整的 Tracking Window Phase 1 vertical slice：

```text
pregnancy-relevant factual exposure
  → open Tracking Window
  → active Tracking Subject/Candidate filtering
  → shared biological cycle / Timing Instance binding
  → factual terminal resolution
  → future independent exposure starts a new Window
```

本任务不重新设计产品架构，不实现 Story-Time horizon expiration，也不 commit/push。

## Confirmed repository facts

- `core/tracking.js` 已从当前有效 Floor Events 重建 `tracking_subjects` 与 `tracking_candidates`，并保持 `can_carry_pregnancy` 的 `true/null/false` 三态语义；尚无 Window round identity/status/filter。
- `core/projection-timing.js` 已提供 `buildProjectionTimingCycleId()`、Timing Instance frozen config/variance/effective window、basis attachment 所需的同 subject + mechanism 语义；`window_missed` 只属于 Timing，不是 Window expired。
- `projection_timing_timeline` 已通过 Projection owner、Floor Version、active Swipe、authoritative readback 与 append-only persistence 保存 Timing Instance；它明确不是 Tracking Window。
- `storage/floor-persistence-coordinator.js` 当前 Projection owner whitelist 包含 `projection_timing_timeline`，但没有独立 Tracking Window owner/field。
- `core/state.js` 已对 `pregnancy_confirmation`、`pregnancy_loss`、`abortion` 产生 factual Current State/Pregnancy Episode；`conception` 不等同 confirmed pregnancy。
- `runtime/event-editing.js` 会修改/删除 active Floor Event 后刷新 Tracking；Window read model 必须从 surviving valid facts 重建并保留 historical Floor immutable。
- Characters 当前主要从 `tracking_subjects` 渲染；confirmed pregnancy 后不能因为 pre-confirmation Window 关闭而错误移除仍有 active factual Pregnancy Episode 的人物。
- 当前工作树既有未提交修改位于 `docs/PROJECT-STATE.md`、`tests/event-analysis-runtime.test.js`、`tests/start-new-chat-lifecycle.test.js`，本任务必须保留。

## Requirements

### Window semantics

- Window 与 Timing Instance、BiologicalEvent、Current State、Projection 分离。
- Window 只记录当前 subject 的一轮 pregnancy-relevant exposure 是否仍在 active pre-confirmation scope；不产生 pregnancy/conception/negative pregnancy fact。
- Phase 1 statuses 仅为 `open`、`resolved_pregnant`、`terminated`；不实现 `resolved_not_pregnant`、`expired` 或任何 horizon。
- `pregnancy_confirmation` 关闭为 `resolved_pregnant`；`pregnancy_loss`/`abortion` 关闭为 `terminated`；`conception`、suspicion、symptom、Timing `window_missed`、Story Time elapsed、Projection 均不关闭 Window。
- terminal Window 不因后续历史事实重新打开；未来独立 factual exposure 可以创建新的 Window。
- compatible exposures 必须复用同一 Window/cycle，不重新 sampling 或改变现有 Timing Instance。

### Identity, grouping, and capability

- Window identity 至少由 Chat、canonical subject、mechanism、first factual exposure Event、first Event Story Time 构成；不得使用 Swipe、UI index、array position、random UUID 或 AI identity。
- Phase 1 compatibility 至少要求同 subject、同 reproductive mechanism、valid pregnancy-relevant factual basis、Window 为 `open`；尽可能复用 Timing 的 predicate，不创建相冲突的第二套兼容规则。
- factual basis 可存在而 capability unresolved；此时 Window 可为 `open`，subject 仍只能是 Candidate。
- `can_carry_pregnancy === true` → active Subject；`null` → Candidate；`false` → inactive。Window 不得升级 capability。

### Ownership and lifecycle

- Window 必须是当前 Character Floor、active Swipe、complete Floor Version 所拥有的独立 domain record，并使用 forward-only authoritative readback。
- 推荐字段名为独立 `tracking_window_timeline`；不得复用 `events`、`snapshot`、`projection_timeline` 或 `projection_timing_timeline`。
- F5、Chat reopen、active Swipe reread、Event edit/delete 后必须从 surviving authoritative facts deterministic rebuild；historical Floors 不回写。
- source exposure 被删除/invalidated 时，唯一 basis 的 Window 不得继续作为 active authority；仍有 valid compatible basis 时继续有效。terminal Event 被删除时按现有 rebuild 策略重新解析。

### Downstream integration

- active Tracking projection 只消费 `open` Window；terminal Window 不再激活旧的 pre-confirmation Tracking entry，但不得删除 Character Registry、Event、Pregnancy Episode 或 Window history。
- Timing Instance 与 Window 必须共享 deterministic cycle binding；已有 Timing Instance 不重新 sampling，不改变 `effective_min`/`effective_max`/`config_snapshot`。
- Projection bridge 只限制 exposure-driven pre-confirmation path：open Window + matching Timing eligibility + World Rule 才可参与；不得把 Window closed 写成所有 future pregnancy-stage Projection 都禁止，也不得让 Window进入 Context或让 Projection修改 Window lifecycle。
- Characters read model 通过 `active Tracking Window OR active factual Pregnancy Episode` 保持 confirmed pregnancy 人物可见；不重新设计 Characters UI。

## Acceptance criteria

- [ ] First valid exposure creates one deterministic open Window.
- [ ] Compatible second exposure attaches to that Window; incompatible mechanism and different subject produce distinct Window IDs.
- [ ] Reroll/new Swipe alone does not create a biological round; inactive Swipe cannot activate current Tracking; stale save fails closed.
- [ ] Capability true/null/false produces Subject/Candidate/inactive respectively without Window-driven upgrade.
- [ ] Confirmation resolves pregnant; conception alone remains open; loss/abortion terminates; suspicion/symptom/Timing missed/Projection do not close; terminal Window never reopens.
- [ ] A later independent exposure creates a new Window.
- [ ] Window and Timing cycle IDs have deterministic binding and existing Timing Instance is not resampled.
- [ ] Event edit/delete, reload/rebuild, Chat isolation, Swipe isolation, Floor Version guard, authoritative readback, and duplicate prevention work.
- [ ] Projection pre-confirmation eligibility consumes only open Window; Window is absent from Projection Context and Projection cannot mutate Window facts.
- [ ] Characters regression is covered for active pre-confirmation subject, confirmed active Pregnancy Episode, and terminated/no-longer-active state.
- [ ] Focused, Tracking, Timing, Projection Eligibility/Runtime, State, Snapshot, Characters-relevant, Event edit/delete, persistence-coordinator tests and `npm run check`/`git diff --check` are run; unrelated known failures are recorded only.
- [ ] Required Markdown/specs are synchronized and accurately state `PARTIAL / PHASE 1 IMPLEMENTED`; Story-Time horizon, `expired`, negative resolution, Context injection, and advanced Episode orchestration remain unimplemented.

## Out of scope

- World/Story-Time horizon authority, `TRACKING_WINDOW_HORIZON`, `expired`.
- `resolved_not_pregnant` or negative pregnancy inference.
- Gestational age, EDD, genealogy, contributor inference, medical simulation.
- Window summary in Context, new Projection Rules, Characters UI redesign.
- Broad refactor of persistence coordinator, adapter, event pipeline, or existing timing sampling.
- Commit, push, or unrelated worktree cleanup.

## Blocking open questions

None. The user supplied and froze the product decisions; repository audit resolved the current owner/schema/integration choices sufficiently for implementation planning.
