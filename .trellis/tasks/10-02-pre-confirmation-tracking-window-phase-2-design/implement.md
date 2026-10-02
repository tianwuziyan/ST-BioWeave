# Implementation Plan: PRE-CONFIRMATION TRACKING WINDOW PHASE 2

本文件记录并跟踪本轮已执行的实施顺序。

## Preconditions

- 用户已确认 `expired` Window 在 World horizon correction 后不 reopen。
- 保持 Phase 1 commit `8513d26` 的 frozen semantics 不变。
- 不追既有 World fixture failures 或 unrelated flaky。
- Implementation 前重新读取适用 AGENTS、Floor State、World Model、Event
  Pipeline、Pregnancy Tracking 与 cross-layer specs。

## Ordered checklist

1. World mechanism horizon contract：schema、Full prompt、normalizer、validator、
   canonical evidence/provenance。
2. World Patch v2 narrow mechanism horizon operation：ADD/SET/CORRECT、
   omitted-preserve、invalid-retain、authoritative readback。
3. Window horizon resolver/evaluator：subject type + mechanism binding、
   comparable Story Time、fail-closed、`open → expired`。
4. Window timeline lifecycle persistence：current Floor owner、active Swipe、
   Floor Version、World binding fingerprint、forward-only readback/rebuild。
5. Lifecycle-only tick owner：host lifecycle integration、single-flight、tick
   dedupe、scheduler-independent execution；严禁 Event/World/Projection AI。
6. Tracking registry 与 pre-confirmation Projection Eligibility 的 expired
   view integration。
7. Projection owner lifecycle-only bridge：明确 pre-confirmation Window binding、
   expired lifecycle record、context refresh，不调用 generation。
8. Edit/delete/reroll/Swipe/F5/reload/rebuild/stale/save failure regressions。
9. 文档/spec 同步与完整质量验证。

## Required validation

- World Full/Patch horizon normalization and merge tests。
- Window horizon core/reducer tests。
- Story-Time comparator and unknown/incomparable tests。
- lifecycle-only tick call-boundary tests：Event analyzer、World analyzer、
  Projection generator 均为 0。
- scheduler interval 1/N independence tests。
- Tracking Subject/Candidate expired filtering tests。
- Projection lifecycle/context bridge tests。
- Floor/Swipe/version/readback/reload/edit/delete/reroll isolation tests。
- Existing Phase 1 focused suites、`npm run check`、`git diff --check`。

## Risk gates

- 不得把 horizon 放入 Timing Config 或 Projection Rule expiration。
- 不得使用 Human timing preset、现实时间或医学 duration fallback。
- 不得让 Window 直接写 Current State、Projection timeline 或 Context text。
- 不得让 lifecycle-only tick 复用会进入 AI generation 的
  `projectionRuntime.process()`。
- 没有明确 Projection Window binding 时必须保留 active Projection。

## Rollback points

- World contract failure：回滚 horizon DTO/Prompt/Patch surface，不改变 Phase 1。
- Tick boundary failure：禁用 tick orchestration，保留 pure resolver/persistence
  设计，不修改 Event Analysis scheduler。
- Projection bridge failure：保留 Window expiration 与 Tracking filtering，暂不
  自动推进 active Projection lifecycle。

## Implementation result

- World mechanism horizon canonicalization、Full prompt 与 Patch v2
  `SET_MECHANISM_HORIZON` 已实现。
- Window horizon resolver/evaluator 已实现 `open → expired`、fail-closed 与
  forward-only terminal readback。
- lifecycle-only tick 已接入 host lifecycle；Projection owner 只处理显式
  pre-confirmation Window binding。
- Phase 2 focused tests 已加入；完整测试基线仍需运行并记录既有 World fixture
  failures。
