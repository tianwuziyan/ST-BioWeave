# Audit: PRE-CONFIRMATION TRACKING WINDOW PHASE 2 DESIGN

## Scope

本轮只做代码/契约审计与设计，不修改 production、tests、schema，不处理
既有 World Model fixture failures，也不重新审计 Phase 1 的已冻结决策。

## Confirmed facts

### World Model

- `ai/analyzer.js:217-303` 将 `reproductive_mechanisms[]` 规范化到
  `species[].biological_types[]` 下。当前 mechanism DTO 只有 `key`、`label`、
  `pathway`、`carrying_compatibility`、`world_model_rule_refs`、`evidence`。
- `ai/analyzer.js:2000-2072` 的 Full canonical model 通过
  `normalizeWorldModel()` / `validateWorldModel()` 收敛；World v1 顶层固定含
  `species`、`medical_context`、`exceptions`、`unknowns`、`projection_rules`。
- `ai/prompts.js:174-185` 的 World output contract 允许 mechanism 和
  projection rule，但没有 Tracking horizon。
- `ai/analyzer.js:3525-3632` 的 Patch v2 允许 Biological Type 的固定字段
  `SET_FIELD`，以及 `ADD_MECHANISM`；当前没有 mechanism horizon field 或
  mechanism-specific correction operation。
- `.trellis/spec/domain/world-model.md` 与 `floor-state.md` 明确 World Model
  是 World owner，Character/Event 不得改写或重新定义 World rules。

### Phase 1 Window and Timing

- `core/tracking-window.js:92-117` 复用 `buildProjectionTimingCycleId()`；
  Window identity 不依赖 Swipe、UI index、array position 或 random UUID。
- `core/tracking-window.js:191-259` 当前 Window 只由 surviving valid
  pregnancy-relevant Events 派生，兼容 grouping 依据 canonical subject +
  mechanism；Phase 1 没有 Story-Time horizon。
- `runtime/tracking-runtime.js` 与 `runtime/event-analysis.js` 将 open Window
  传给 Tracking registry；Window 变更不制造 pregnancy fact。
- `storage/tracking-window.js` 与 Floor coordinator 使用独立
  `tracking_window_timeline`，沿用 active Swipe、完整 Floor Version、当前
  owner/readback 和 forward-only persistence。
- `core/projection-timing.js` / `storage/projection-timing.js` 独立拥有
  Timing Instance、variance、effective min/max 和 `window_missed`。现有 Timing
  Instance 不得因 Phase 2 horizon evaluation 被重新 sampling。

### Story Time and lifecycle

- `story/coordinator.js:314-343` 能从当前 Character Floor active Swipe 解析
  canonical current Story Time；不可解析时返回 unknown/null，不使用现实时间。
- `runtime/events.js:2299-2332` 将 host lifecycle 串行化到 `lifecycleTail`，
  但当前 Character message render 最终进入
  `eventAnalysis.handleLifecycleEvent()`。
- `runtime/event-analysis.js:3073-3160` 对 Character render 走
  `scheduleRenderedCharacter()`；`analysis_interval` 会阻止部分 Floor 进入
  Character/Event Analysis。该 scheduler 不应成为纯 lifecycle 推进的前提。
- 当前 `refreshTrackingRegistry()` 是 deterministic read/rebuild path，但它
  属于 Tracking runtime，不应被误称为 AI Event Analysis。

### Projection lifecycle

- `runtime/projection-runtime.js:158-195` 已先执行 deterministic
  `evaluateProjectionEvolution()`，再继续 eligibility 与 Projection AI
  generation。
- `runtime/projection-runtime.js:200-282` 的 `process()` 在 evolution 后仍会
  进入 generation phase；普通 Story-Time tick 不能直接调用 `process()`。
- `core/projection.js:148-150` 将 Projection factual lifecycle owner 归于
  Projection timeline；`expired` 是 Projection lifecycle，不是 Window status。
- `core/projection-eligibility.js:166-173` 已有 rule-driven Projection
  expiration，但没有 Window-expired bridge。
- Phase 1 已把 open Window 传给 pre-confirmation Eligibility；Window 本身不
  进入 Context，也不能直接写 Projection lifecycle。

## Audit findings

1. Horizon 不应放入 `projection_rules[]`：Projection rule 的 expiration 是
   某一 Projection 的发展生命周期，不是某一 exposure round 的
   pre-confirmation scope。
2. Horizon 不应放在 Window record 作为 AI/Runtime 自由配置：那会让 World
   authority 丢失，并使同一 World mechanism 的 Window 得到不一致 scope。
3. 最小安全绑定层是 subject canonical biological type 下的
   `reproductive_mechanisms[].tracking_window_horizon`。它既能区分机制，
   又不会把同一 mechanism 跨物种误用；无法解析 subject type、mechanism
   或 horizon 时必须 fail closed。
4. 当前 Full/Patch validator 都会拒绝未知字段，因此 horizon 必须在
   World canonicalizer、Full prompt、Patch v2 validator/merge 中形成同一
   contract，不能只在 Runtime 读取旁路字段。
5. 当前 scheduler interval 只控制 Event Analysis 频率，不应控制
   lifecycle-only tick。tick 应在 host lifecycle chain 中以独立 single-flight
   运行，并以 `(chat_id, active Floor Version)` 去重。
6. Projection Runtime 当前公开的 `process()` 不是 lifecycle-only API；Phase
   2 需要在同一 Projection owner 内增加 deterministic lifecycle-only seam，
   禁止通过 `process()` 间接触发 AI。
7. Existing Projection 没有足够明确的 pre-confirmation lifecycle scope
   标记。仅靠 source Event 与 mechanism 猜测，可能错误关闭已进入
   pregnancy-stage 的 Projection；需要在 Projection creation/provenance 中
   增加可验证的 scope/window binding，或对无法证明的 Projection fail closed。

## No production changes made

本审计只读取仓库、Phase 1 Trellis artifacts、domain specs 和历史 session
索引；没有修改 production、tests 或 schema。
