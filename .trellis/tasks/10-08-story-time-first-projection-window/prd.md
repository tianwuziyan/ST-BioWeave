# Story Time 驱动首次 Projection 窗口生产链

## Goal

当当前 Character Floor 的 Story Time 从某个 active reproductive cycle 的
`before_min` 进入该 Timing Instance 冻结的 `window_open` 区间时，即使当前
Floor 没有新的 `sexual_activity`、pregnancy fact 或 exposure，BioWeave 也必须
自动聚合该 logical cycle 的全部 compatible exposure，生成首次非事实
Projection，并在下一次 SillyTavern generation prompt assembly 前通过现有
`bioweave_projection_context` 可见。

## Confirmed facts

- `core/projection-timing.js:evaluateProjectionTiming` 已使用 Timing Instance 的
  `reference_story_time`、`effective_min_story_days` 和
  `effective_max_story_days` 计算 `before_min`、`window_open`、`window_missed`；
  本任务不得增加固定天数阈值。
- `core/tracking-window.js:deriveTrackingWindows` 按 subject + reproductive
  mechanism 建立 cycle，并将同一 open window 的 compatible exposure 追加到
  `source_event_ids` / `source_basis_refs`，不是只取一条事件。
- `runtime/events.js:1874-1963` 的 Projection Runtime input collector 会从当前
  Floor business data 读取 active Events、tracking windows、World Model 与当前
  Story Time；其 pre-confirmation timing resolver 会读取/创建 Timing Instance。
- `runtime/projection-runtime.js:318-350` 的 `tickLifecycleOnly` 明确只处理已存在
  pre-confirmation Projection 过期并刷新 Context，不执行
  `evaluateProjectionEligibility`、Analyzer 或首次 Projection generation。
- `runtime/events.js:1964-1967` 当前自动 Projection generation 只挂在 factual
  Event analysis 成功后的 post-processor；因此 Story Time-only progression 没有
  同等的 generation trigger。
- `runtime/events.js:2468-2589` 已有 `GENERATION_STARTED` 的 awaited
  Projection Context refresh；它保证 Context 写入完成后 Host listener 才返回，
  但当前 refresh 本身只读已持久化 Projection，不负责发现并生成缺失 Projection。
- Projection schema (`core/projection.js`) 是一个 candidate 对应一个 Projection，
  Projection identity 按 subject + rule + concern 稳定生成；现有架构允许同一
  subject 使用 sibling rules 表达互斥可能性，不需要创建第二套 schema。
- Floor-derived Projection、Timing 与 Tracking timeline 均已有 Floor owner、active
  Swipe、完整六字段 Floor Version、shared Floor Persistence Coordinator 和
  authoritative readback 边界；本任务不改变该 persistence architecture。

## Requirements

1. Story Time-only progression 必须重新 collect 当前仍 active 的 reproductive
   Tracking / Timing cycle，并用新的 current Story Time 重新计算 elapsed 与 timing
   state。
2. 只有在可观察到 `before_min -> window_open` 的首次进入，且该 cycle 尚未成功
   生成首次 Projection 时，才触发首次 Projection eligibility/generation。
3. Exposure basis 必须来自同一 logical cycle 的现有 Tracking Window / Timing
   compatibility contract，并保留 canonical subject、source Event ID、source Floor
   Version、participant/potential source identity、Story Time、World Model capability
   eligibility 与 cycle identity；不得用文本、性别猜测或症状推导替代现有契约。
4. Eligibility 必须遵守现有 World Model projection rule、capability、source
   compatibility、Timing Instance 与 Tracking Window contract。
5. Projection 必须保持 non-factual；不得创建 factual Event、修改历史 Event、
   回写历史 Floor 或创建 Chat-level authority。
6. Projection persistence 必须继续走 candidate validation → projection timeline →
   shared Floor Persistence Coordinator → official Host save → authoritative readback
   → `getProjectionViews()`。
7. 首次 Projection 成功后必须立即 refresh Projection Context；下一次
   `GENERATION_STARTED` 必须等待该 refresh 完成后才允许 prompt assembly 消费 slot。
8. 复用现有单-Projection schema。若 A/B 可能性需要两条路线，则只能通过现有
   sibling/mutually-exclusive Projection rules 表达，不能增加第二套 candidate schema。
9. 不实现 resolution 后半段：cycle cleanup、pregnancy confirmation 完整 lifecycle、
   final paternal source、exposure cleanup、genealogy、synthetic conception Event 或
   synthetic pregnancy Event。

## Acceptance criteria

- AC1：已有 exposure 且 elapsed < Timing Instance `effective_min` 时，不生成首次
  Projection。
- AC2：没有新 exposure，只有 Story Time 从 `before_min` 前进到
  `window_open` 时，自动生成首次 Projection。
- AC3：同一 cycle 的 exposure A/B/C 进入窗口时，Projection basis 包含 A/B/C 的
  source IDs 与 provenance，而非单条事件。
- AC4：同一 cycle 已生成首次 Projection 后继续处于 window 时，不重复调用 AI 或
  持久化相同首次 Projection。
- AC5：首次未生成且 elapsed > `effective_max` 时遵守现有 `window_missed` contract，
  不 backfill。
- AC6：Projection 成功后 `getProjectionViews()` 可见，Context contribution count
  大于零，且 `bioweave_projection_context` 包含该 Projection。
- AC7：`GENERATION_STARTED` 的 listener 返回前，Projection Context refresh 已完成，
  并有顺序测试证明 prompt assembly 读取前 slot 已更新。
- AC8：诊断至少能观察 cycle/window/timing IDs、current/anchor Story Time、elapsed、
  effective bounds、timing state/transition、compatible exposure count/IDs、eligibility、
  generation request/result、Projection ID、Floor transaction、View count、Context
  contribution count 与 slot write result，且不记录完整 NSFW 正文。
- AC9：同一 window_open 内 Story Time 连续推进多次时，AI generation 只发生一次。
- AC10：Story Time trigger 不新增 transition persistence authority；transition 由当前
  Timing state 与 existing Projection presence 推导。
- AC11：没有新 factual Event 时，Projection process 仍可合法运行；不得伪造 Event。
- AC12：任何 sibling possibility fixture 必须证明两者都是 non-factual、不会立即互相
  contradict、不会因 source basis dedupe 成一条，并且后续 factual Event 能分别触发
  realized 与 contradicted/expired；若现有 lifecycle 无法表达则停止并报告。

## Out of scope

本任务不实现 Projection resolution、事实确认、父源最终确认、任何 synthetic Event、
genealogy 或历史数据迁移。

## Blocking open questions

无。A/B possibility 采用现有 sibling Projection rule contract；具体是否已有对应
World Model rules 由审计与测试 fixture 验证，缺少 rule 时保持现有 fail-closed 行为，
不在本任务发明新 schema。
# Story Time 驱动首次 Projection 窗口生产链

## Goal

当当前 Character Floor 的 Story Time 从某个 active reproductive cycle 的
`before_min` 进入该 Timing Instance 冻结的 `window_open` 区间时，即使当前
Floor 没有新的 `sexual_activity`、pregnancy fact 或 exposure，BioWeave 也必须
自动聚合该 logical cycle 的全部 compatible exposure，生成首次非事实
Projection，并在下一次 SillyTavern generation prompt assembly 前通过现有
`bioweave_projection_context` 可见。

## Background and confirmed repository facts

- `core/projection-timing.js:evaluateProjectionTiming` 已使用 Timing Instance 的
  `reference_story_time`、`effective_min_story_days` 和
  `effective_max_story_days` 计算 `before_min`、`window_open`、`window_missed`；
  本任务不得增加固定天数阈值。
- `core/tracking-window.js:deriveTrackingWindows` 按 subject + reproductive
  mechanism 建立 cycle，并将同一 open window 的 compatible exposure 追加到
  `source_event_ids` / `source_basis_refs`，不是只取一条事件。
- `runtime/events.js:1874-1963` 的 Projection Runtime input collector 会从当前
  Floor business data 读取 active Events、tracking windows、World Model 与当前
  Story Time；其 pre-confirmation timing resolver 会读取/创建 Timing Instance。
- `runtime/projection-runtime.js:318-350` 的 `tickLifecycleOnly` 明确只处理已存在
  pre-confirmation Projection 过期并刷新 Context，不执行
  `evaluateProjectionEligibility`、Analyzer 或首次 Projection generation。
- `runtime/events.js:1964-1967` 当前自动 Projection generation 只挂在 factual
  Event analysis 成功后的 post-processor；因此 Story Time-only progression 没有
  同等的 generation trigger。
- `runtime/events.js:2468-2589` 已有 `GENERATION_STARTED` 的 awaited
  Projection Context refresh；它保证 Context 写入完成后 Host listener 才返回，
  但当前 refresh 本身只读已持久化 Projection，不负责发现并生成缺失 Projection。
- Projection schema (`core/projection.js`) 是一个 candidate 对应一个 Projection，
  Projection identity 按 subject + rule + concern 稳定生成；现有架构允许同一
  subject 使用 sibling rules 表达互斥可能性，不需要创建第二套 schema。
- Floor-derived Projection、Timing 与 Tracking timeline 均已有 Floor owner、active
  Swipe、完整六字段 Floor Version、shared Floor Persistence Coordinator 和
  authoritative readback 边界；本任务不改变该 persistence architecture。

## Requirements

1. Story Time-only progression 必须重新 collect 当前仍 active 的 reproductive
   Tracking / Timing cycle，并用新的 current Story Time 重新计算 elapsed 与 timing
   state。
2. 只有在可观察到 `before_min -> window_open` 的首次进入，且该 cycle 尚未成功
   生成首次 Projection 时，才触发首次 Projection eligibility/generation。
3. Exposure basis 必须来自同一 logical cycle 的现有 Tracking Window / Timing
   compatibility contract，并保留 canonical subject、source Event ID、source Floor
   Version、participant/potential source identity、Story Time、World Model capability
   eligibility 与 cycle identity；不得用文本、性别猜测或症状推导替代现有契约。
4. Eligibility 必须遵守现有 World Model projection rule、capability、source
   compatibility、Timing Instance 与 Tracking Window contract。
5. Projection 必须保持 non-factual；不得创建 factual Event、修改历史 Event、
   回写历史 Floor 或创建 Chat-level authority。
6. Projection persistence 必须继续走 candidate validation → projection timeline →
   shared Floor Persistence Coordinator → official Host save → authoritative readback
   → `getProjectionViews()`。
7. 首次 Projection 成功后必须立即 refresh Projection Context；下一次
   `GENERATION_STARTED` 必须等待该 refresh 完成后才允许 prompt assembly 消费 slot。
8. 复用现有单-Projection schema。若 A/B 可能性需要两条路线，则只能通过现有
   sibling/mutually-exclusive Projection rules 表达，不能增加第二套 candidate schema。
9. 不实现 resolution 后半段：cycle cleanup、pregnancy confirmation 完整 lifecycle、
   final paternal source、exposure cleanup、genealogy、synthetic conception Event 或
   synthetic pregnancy Event。

## Acceptance criteria

- AC1：已有 exposure 且 elapsed < Timing Instance `effective_min` 时，不生成首次
  Projection。
- AC2：没有新 exposure，只有 Story Time 从 `before_min` 前进到
  `window_open` 时，自动生成首次 Projection。
- AC3：同一 cycle 的 exposure A/B/C 进入窗口时，Projection basis 包含 A/B/C 的
  source IDs 与 provenance，而非单条事件。
- AC4：同一 cycle 已生成首次 Projection 后继续处于 window 时，不重复调用 AI 或
  持久化相同首次 Projection。
- AC5：首次未生成且 elapsed > `effective_max` 时遵守现有 `window_missed` contract，
  不 backfill。
- AC6：Projection 成功后 `getProjectionViews()` 可见，Context contribution count
  大于零，且 `bioweave_projection_context` 包含该 Projection。
- AC7：`GENERATION_STARTED` 的 listener 返回前，Projection Context refresh 已完成，
  并有顺序测试证明 prompt assembly 读取前 slot 已更新。
- AC8：诊断至少能观察 cycle/window/timing IDs、current/anchor Story Time、elapsed、
  effective bounds、timing state/transition、compatible exposure count/IDs、eligibility、
  generation request/result、Projection ID、Floor transaction、View count、Context
  contribution count 与 slot write result，且不记录完整 NSFW 正文。

## Out of scope

本任务不实现 Projection resolution、事实确认、父源最终确认、任何 synthetic Event、
genealogy 或历史数据迁移。

## Blocking open questions

无。A/B possibility 采用现有 sibling Projection rule contract；具体是否已有对应
World Model rules 由审计与测试 fixture 验证，缺少 rule 时保持现有 fail-closed 行为，
不在本任务发明新 schema。
