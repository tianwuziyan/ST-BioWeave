# Design: PRE-CONFIRMATION TRACKING WINDOW PHASE 2

## PHASE_2_WORLD_HORIZON_CONTRACT

### Canonical location and binding

World Model 在现有
`species[].biological_types[].reproductive_mechanisms[]` mechanism record
中增加可选的 declarative horizon：

```json
{
  "key": "fertilization",
  "tracking_window_horizon": {
    "schema_version": 1,
    "max_story_days": 42
  }
}
```

`max_story_days` 是从 Window `opened_story_time` 到当前 canonical Story Time
的最大 exposure-tracking scope，单位是 structured Story Time day，不是现实
医学时长、gestation、GA、EDD 或 Timing min/max。

绑定规则：

1. 先用 canonical subject 的已验证 biological species/type 解析机制。
2. 只读取该 biological type 下 key 精确匹配的 reproductive mechanism。
3. 不从 species-level、global-level、Projection Rule、Human preset 或
   Window 自身推断 fallback。
4. 缺少 subject type、机制 key、唯一机制匹配、可比较 Story Time 或有效
   `max_story_days` 时，horizon 为 unavailable，Window 保持 `open`，不产生
   `expired`。
5. 多个候选 type/mechanism 给出冲突 horizon 时，整体 fail closed，不选择
   最短、最长或 Human baseline。

这是 World authority；Window 只保存 binding/provenance 和 lifecycle view，
不复制一个可独立编辑的 horizon。

## STORY_TIME_LIFECYCLE_TICK_CONTRACT

### Owner and inputs

建议新增 deterministic `TrackingWindowLifecycleRuntime`，由现有 host
lifecycle orchestration 调用，依赖方向为：

```text
active Character Floor + active Swipe + Story Time
  + surviving Events + resolved World Model
    → Window lifecycle evaluator
      → Window persistence/readback
        → Tracking registry refresh
          → Projection lifecycle-only bridge/context refresh
```

Tick 只允许读取/写入已拥有的 deterministic domain records：current complete
Floor Version / active Swipe / Chat epoch、surviving valid Events、Phase 1
Window view、current canonical Story Time、already persisted World Model、
existing Projection timeline，以及 Floor-owned Window/Projection lifecycle
records。

Tick 明确禁止：

- `analyzeFloor()` / Character Event analyzer；
- World Full/Supplement analysis、World AI request；
- `projectionRuntime.process()`；
- `analyzer.generateProjection()`；
- Event creation/editing、Current State mutation、Projection AI generation；
- scheduler interval counter as a precondition。

### Trigger and dedupe

触发点为 runtime init/F5、Chat reopen、Character Floor rendered、current
Character Floor edit/delete、Swipe switch/delete，以及能改变 current Floor
Version/Story Time 的同类 lifecycle event。

Tick 必须在 Character/Event Analysis scheduler 前独立运行，以
`chat_id + complete active Floor Version` single-flight/dedupe。若 current Story
Time 未知或 Floor/Swipe/version stale，则 no-op/fail closed；不能退回 wall
clock 或 scheduler interval。若同一 lifecycle 同时需要 Event Analysis，先完成
tick 的 authoritative readback，再由原有 scheduler 决定是否分析。

## WINDOW_EXPIRATION_CONTRACT

对于 `open` Window：

```text
current Story Time - opened Story Time >= World mechanism max_story_days
  → expired
```

实际比较必须使用现有 Story Time comparator；不同 calendar/era、缺少
`day_index` 或不可比较时不 expire。边界采用 `>=`，`max_story_days = 0` 表示
同一可比较 Story Time tick 即可结束 scope。

`expired` 只表示该 exposure round 不再属于 active pre-confirmation tracking
scope；它不代表 confirmed pregnancy、not pregnant、negative fact、Episode
transition 或 Event invalidation。Window history、source Events、Character
Registry 和 Pregnancy Episode 保留。

expired 是 Window lifecycle terminal result；后续 factual exposure 不重新打开
旧 Window，而按 Phase 1 identity/grouping 创建新的 biological round。

### Tracking result

- `open + can_carry_pregnancy === true` → active Tracking Subject；
- `open + can_carry_pregnancy === null` → Tracking Candidate；
- `open + false` → inactive；
- `expired` → 不再贡献 pre-confirmation Subject/Candidate exposure；
- active factual Pregnancy Episode 仍按 Phase 1 Characters compatibility read
  model 保持可见，不能因为 Window expired 删除人物。

### Projection Eligibility result

Window expired 后，旧 exposure 的 pre-confirmation Eligibility 返回
`not_eligible` / `tracking_window_expired`。这只限制 exposure-driven
pre-confirmation path；不全局禁用 pregnancy-stage Projection Rules。

## PROJECTION_LIFECYCLE_BRIDGE

Projection timeline 仍是 Projection lifecycle owner。Window runtime 不写
Projection timeline；同一 deterministic Story-Time tick orchestration 依次：

1. 解析/持久化 Window expiration；
2. 以 authoritative Window readback 作为输入调用 Projection 的
   lifecycle-only evaluator；
3. Projection evaluator 对明确绑定该 Window 且 scope 为
   `pre_confirmation` 的 active Projection 写入现有 `expired` lifecycle
   record，并刷新 context；
4. 不触发 eligibility generation、Projection AI 或新 Projection creation。

建议 Phase 2 在 Projection creation/provenance 中保存 deterministic
`pre_confirmation` scope 与 `tracking_window_id` binding。若既有 Projection
缺少这两个字段，无法证明其属于 pre-confirmation Window 时必须保留 active，
不能用 source Event/mechanism 猜测关闭。

Existing Projection 的 expiration/context removal 由 Projection owner 推进；
Window 只提供 deterministic lifecycle input。Projection expired 与 Window
expired 仍是两个 status/record，不共享 owner 或事实语义。

## WORLD_FULL_PATCH_BEHAVIOR

### Full Analysis

- Full output contract、World schema、normalizer、validator 和 mechanism
  evidence contract 同步声明 horizon。
- 有明确 evidence 的合法 horizon 写入对应 mechanism。
- 没有 horizon evidence 时 canonical value 为 unavailable/null，不使用
  Human/medical/default duration。
- Full 是从当前 permitted evidence 构建 canonical World，不把旧 horizon
  当成 evidence；因此缺失值不能静默继承旧值。

### Supplement/Patch

- Delta 未提及 horizon → preserve Existing mechanism horizon。
- 新机制可在 `ADD_MECHANISM` 中携带 horizon；已有机制的新增/修正使用
  mechanism-targeted、evidence-bound 的 narrow SET/CORRECT operation，不能
  通过任意动态 path 或 AI text 旁路修改。
- invalid、ambiguous、unverifiable horizon correction → reject that operation
  and retain prior authoritative World Model。
- Patch merge 后重新 canonical normalize/validate；同一 mechanism 的 horizon
  不允许产生多个冲突值。
- horizon correction 不回写历史 Floor/Window/Projection records；只影响
  后续 lifecycle evaluation，已完成的 terminal lifecycle 是否重新评估见
  Open Product Decision。

## FAIL_CLOSED_BEHAVIOR

以下任何条件成立时，不产生 expiration：

- World Model 缺失、未 readback-confirmed、schema invalid 或 mechanism absent；
- subject species/type 未解析、多个候选冲突、机制 key 未绑定；
- horizon 缺失、不是有限非负整数、scope 不明确；
- opened/current Story Time 不可比较或 current Floor/Swipe/version stale；
- Window provenance/source basis 不再有效；
- lifecycle tick readback/persistence 失败；
- Projection 缺少明确 pre-confirmation Window binding。

Fail closed 的结果是保持 Window open/unresolved view、保留 Tracking
Subject/Candidate（如果 Phase 1 capability 允许），不制造任何 factual
pregnancy/negative fact，不触发 AI，不误关闭 Projection。

## PERSISTENCE_AND_REBUILD

- `tracking_window_timeline` 继续由 Tracking owner 写入当前有效 Character
  Floor/active Swipe；历史 Floor immutable。
- expiration 以 append-only lifecycle record 或等价 current-Floor materialized
  view 记录完整 Window ID、World binding/horizon fingerprint、current Story
  Time、Floor Version、reason `tracking_window_horizon_reached`。
- 每次 tick 先读取 authoritative current Floor/World/Window view，再在同一
  current Version 下 commit；stale owner、Swipe、Chat epoch、readback failure
  fail closed。
- F5/reload/rebuild 按 surviving Events + authoritative World + persisted
  lifecycle records deterministic 重建；不依赖内存 Map、scheduler counter 或
  random identity。
- edit/delete/reroll/Swipe 会使受影响 Floor/Window provenance 重新解析；
  inactive Swipe 和 stale versions 不贡献 lifecycle。历史 Floor 不回写。
- Tick 与 Event Analysis/Projection processing 使用独立 single-flight keys，
  但共享 host lifecycle ordering，避免旧 tick 覆盖新 Floor。

## IMPLEMENTATION_PLAN

1. 先冻结 World mechanism horizon DTO、Full prompt/schema/normalizer 与
   fail-closed validator。
2. 设计并实现 Patch v2 的 narrow mechanism horizon add/set/correction path，
   保持 omitted-preserve 与 invalid-retain semantics。
3. 扩展 Window core evaluator：World mechanism resolution、comparable Story
   Time、`open → expired`、horizon provenance、deterministic reducer。
4. 扩展 Window persistence/rebuild，保留 Phase 1 owner/version/Swipe guards。
5. 建立独立 lifecycle-only tick runtime，在 host lifecycle chain 中先于
   scheduler 调用；验证普通 Floor progression 不触发 Event/World/Projection
   AI。
6. 将 expired Window view 接入 Tracking registry 与 pre-confirmation
   Eligibility。
7. 在 Projection owner 增加 lifecycle-only evaluator 和明确
   pre-confirmation Window binding；只对可证明 scope 的 Projection 处理
   expiration/context refresh。
8. 覆盖 World Full/Patch、missing/ambiguous horizon、Story Time comparison、
   scheduler interval、F5/reload/edit/delete/reroll/Swipe/stale/readback、
   Projection non-AI bridge 与 semantic guards。

## OPEN_PRODUCT_DECISIONS

1. **World horizon correction 后，已 `expired` Window 是否重新 `open`？**
   - 已冻结：不重新打开。`expired` 是 forward-only terminal lifecycle；新
     horizon 只影响尚未 evaluated 的 open Window 和未来新 Window。World Patch
     不逆向重写 Window/Projection 历史，resolved_pregnant/terminated 同样
     不 reopen。

## Design status

`DESIGN_READY`。上述 reopen 语义已由产品冻结；本 task 随后进入 implementation。
