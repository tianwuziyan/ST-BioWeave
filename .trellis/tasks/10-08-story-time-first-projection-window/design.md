# Technical Design

## Root cause

FACT：Timing evaluation 已具备 `before_min/window_open/window_missed` 三态，且
Projection Runtime 的完整 `process()` 已包含 evolution、eligibility、AI candidate
generation、Floor persistence、authoritative readback 与 Context refresh。

FACT：生产生命周期在 Story Time 相关 Host event 后调用的是
`projectionRuntime.tickLifecycleOnly()`；该函数只扫描已存在 Projection 对应的
expired Tracking Window，不调用 `process()`，因此不会重新评估 eligibility，也不会
发现首次 Projection。

FACT：自动 `projectionRuntime.process()` 当前由 Event analysis factual-success
post-processor、Event edit/delete 等路径触发；`GENERATION_STARTED` 只 awaited
`projectionContext.refreshProjectionContext()`。

INFERENCE：实测“Floor 2 有 exposure、Floor 3 只有 Story Time 前进但没有 Projection”
的直接原因是 Story Time-only lifecycle 到达了 lifecycle-only bridge，却没有进入
Projection Runtime 的完整 eligibility/generation path。Tracking/Timing 的输入读取
能力已存在，但没有被首次 Projection trigger 统一消费。

UNVERIFIED HOST BEHAVIOR：真实 Host 是否在目标版本对正文 Story Time-only Floor
稳定发出并按顺序交付 `MESSAGE_RECEIVED` / `CHARACTER_MESSAGE_RENDERED`，需要完成后
用真实 Host acceptance 验证；自动测试不能替代该验证。

## Minimal production flow

1. 在 Story Time progression lifecycle 完成当前 Floor/active Swipe 的收集后，调用
   Projection Runtime 的完整 `process({reason: "story-time-progression"})`，而不是只
   调用 lifecycle-only expiry bridge。
2. `collectInputs()` 继续从当前有效 Floor-derived business data 读取 active Events、
   Tracking Windows、World Model、current Story Time；不增加 Chat-level cache 或旁路
   facts。
3. `resolvePreConfirmationTiming()` 继续读取 frozen Timing Instance。只对当前 cycle
   的 source events 补充 compatible basis；首次 timing creation 仍由现有 config →
   variance/offset → effective bounds 机制负责。
4. `evaluateProjectionEligibility()` 继续同时检查 exposure/rule、capability、source
   compatibility、Tracking Window 和 Timing state。`window_open` 才可生成；已有
   Projection 由现有 deterministic identity 拦截重复生成；`window_missed` 保持
   fail-closed。
5. 复用 `runExecution()` 的 candidate validation、owner/execution stale guards、
   `saveGeneratedProjection()`、evidence persistence、`getProjectionViews()` readback
   与 `refreshProjectionContext()`。
6. `GENERATION_STARTED` 的现有 awaited Context refresh 保持不变；如 Story Time trigger
   与 generation boundary 有并发，使用现有 lifecycle tail/Context refresh queue，确保
   generation listener 返回前看到最新 authoritative readback。

## Process interface and dedupe guard

Story Time trigger 调用完整 `process()` 时传入明确的 lifecycle reason 和当前有效
Floor-derived inputs，不假设本轮存在新 factual Event。若现有 process 入口的命名或
validation 隐含“factual-success”，只做最小接口调整以允许空的新 Event delta；不会
构造 synthetic Event。

完整 process 仍先执行 deterministic evolution、Timing/Window eligibility 与现有
Projection identity lookup。只有 decision 为 eligible 且没有 `existing_projection_id`
时才调用 Analyzer；同一 window_open 内 Story Time 变化会改变 execution identity，
但不会绕过 Projection identity/dedupe，因此不会重复调用 AI。`tickLifecycleOnly()`
保留为无 AI 的 Window/Projection lifecycle maintenance，调用场景不与 full process
混淆。

## Transition and idempotency

现有 projection identity 是 subject + projection rule + concern；现有
`existing_projection_id` 检查足以阻止相同首次 candidate 重复生成。新增的 transition
判定只用于触发时机与 diagnostics，不新增持久化 authority。若需要记录 transition，
优先使用现有 derived timing/tracking lifecycle ownership；不把 runtime hint 写成
Chat-level fact。

## Possibility model

现有 Projection 是单 candidate/单 rule。A（可能发生受精/妊娠后续）与 B（本周期没有
形成后续发展）只有在现有 World Model 已提供两个 sibling rule 且 lifecycle 测试证明
两者都是 non-factual、不会立即互相 contradict、不因相同 source basis 被 dedupe、并
能由后续 factual Event 分别进入 realized 与 contradicted/expired 时，才按 sibling
Projection 表达。若任一条件不成立，本任务不硬改 schema、不拼接 A/B 文本，改为报告
该 contract blocker。

## Diagnostics

在现有 diagnostics/persistence trace 体系中补足最小结构化字段：cycle/window/timing
IDs、current/anchor Story Time、elapsed、effective bounds、timing state 与 transition、
compatible exposure count/IDs、eligibility result、generation request/result、Projection
ID、transaction/readback result、View count、Context contribution count 与 slot write
result。只写 IDs、结构化时间和状态，不写完整正文。

## Compatibility and rollback

不修改 Projection/Timing/Tracking/Floor schema，不修改 Coordinator，不改变 Snapshot
responsibility。若 Story Time trigger 失败，现有 factual/Event pipeline 与已存在
Projection lifecycle 保持可用；可通过回退新增 trigger 调用与诊断分支恢复旧行为。
