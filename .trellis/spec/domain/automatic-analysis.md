# 自动分析隔离边界契约

状态：Phase 1 facade、Phase 2 shared execution port 与 Phase 3 manual port 已实现。
Host lifecycle 仍由 `runtime/events.js` 内部拥有。本文件定义边界、公开入口、禁止依赖和迁移验收；
各阶段均不改变自动分析规则、Floor ownership
或持久化行为。

自动分析的计数、due、retry、reroll、Swipe 和 Floor Version 语义仍以
[Auto Analysis Scheduler Architecture](../../../docs/AUTO-ANALYSIS-SCHEDULER.md) 为准；
Floor/active Swipe/version 的事实所有权仍以
[Floor State Ownership Contract](./floor-state.md) 为准。

## 1. CURRENT_BOUNDARIES：当前职责位置

当前路径是可工作的，但边界实际集中在一个较大的 coordinator 中：

```text
SillyTavern eventSource / adapter
  -> runtime/events.js
     (host listener binding, lifecycle serialization, runtime facade)
  -> runtime/event-analysis.js
     (Floor resolution, lifecycle interpretation, generation handoff,
      scheduler state, due decision, single-flight, World routing,
      shared Character/Event execution, persistence and derived refresh)
  -> runtime/generation-lifecycle.js
     (generation intent, pending/settled barrier, reroll/new Swipe ownership)
  -> runtime/world-analysis.js
  -> runtime/character-event-analysis.js
  -> storage/store.js + storage/floor-persistence-coordinator.js
  -> Floor/Swipe/version authoritative storage
```

Manual UI entry points currently leave `ui/app.js` through the runtime facade:

```text
manual-refresh     -> manualAnalysis.refreshCurrentFloor()
manual-character   -> manualAnalysis.analyzeCurrentCharacterEvents()
manual World       -> existing World-specific runtime entry points
manual-refresh / manual-character -> analysisExecution.run()
```

Automatic entry points currently follow:

```text
GENERATION_STARTED
  -> generationLifecycle.onGenerationStarted()
GENERATION_ENDED / STOPPED / CANCELLED
  -> generationLifecycle.onGenerationEnded() / onGenerationStopped()
CHARACTER_MESSAGE_RENDERED
  -> resolveMessage()
  -> resolveFloorAtIndex()
  -> generationLifecycle.onCharacterMessageRendered()
  -> automaticAnalysis.observeSettledCharacterFloor()
  -> counter / retryPaused / observed-key / interval due decision
  -> analysisExecution.run()
  -> analyzeFloor() [compatibility-owned implementation]
  -> runAnalysis()
  -> World resolution and execution
  -> Character/Event execution
  -> Floor persistence and derived refresh
```

`core/message-role.js` and `storage/store.js` remain the host-role/Floor
recognition boundary. The exact `assistant_message` Character support is part of
that boundary and must not be reimplemented inside a scheduler.

## 2. COUPLING_RISKS：最容易再次误伤的位置

1. `runtime/event-analysis.js` owns both scheduler state and analysis business.
   A change to input construction, World routing, Tracking refresh, or persistence
   can accidentally alter the path before/after the due decision.
2. `runtime/events.js` is both host bridge and public facade. Adding a lifecycle
   listener, UI refresh, or notification in the same coordinator can change
   ordering or error swallowing around automatic analysis.
3. `generation-lifecycle.js` calls the scheduler through an injected callback.
   Its generation barrier remains isolated, and the callback now points to the
   named Automatic Analysis port rather than directly to scheduler internals.
4. Floor recognition and scheduler consumption are adjacent in the same lifecycle
   function. A role-helper change can make a valid Floor disappear before the
   scheduler is invoked, as happened with the real SillyTavern
   `extra.type = "assistant_message"` shape.
5. Manual forced analysis currently records scheduler success/failure state through
   shared functions. This is intentional behavior today, but the coupling must be
   preserved explicitly during extraction; manual execution must not silently
   acquire a different save or retry policy.
6. The runtime facade exposes broad functions such as `analyzeFloor` and
   `getAutoAnalysisSchedulerState`. Future modules could bypass the intended entry
   point and mutate or infer scheduler state from implementation details.
7. Floor Version, active Swipe, single-flight and stale guards are cross-cutting
   correctness boundaries. Moving scheduler state into persistence or Chat metadata
   would create a second fact source and violate Floor ownership.

## 3. SEVENDAYSCAL_REFERENCE：可借鉴与不适合之处

本地参考构画为 `/Users/ll/Downloads/ST-SevenDaysCal-master`，不是 BioWeave
production 依赖。它值得借鉴的不是具体模块名称，而是以下 seam：

- `automation-gate.js` 只保存 claim，并通过 `claim / isSuppressed / release /
  clear` 提供窄入口；业务模块不直接操作 gate 内部 Map。
- host boundary 负责把 SillyTavern eventSource 事件转换为模块调用；同一
  `CHARACTER_MESSAGE_RENDERED` 可以分发给彼此独立的 feature listener。
- `runtime/task-orchestration.js` 把 owner、revision、abort、commit 和
  follow-up 的判定做成纯逻辑，执行和保存由调用方负责。
- 手动与自动最终都进入同一个 feature controller 的业务执行函数；触发来源
  作为参数传入，而不是复制两套 API/保存流程。
- generation owner、chat revision 和 abort signal 被显式传递，异步结果不会
  直接凭旧闭包写入新 Chat。

不直接照搬的部分：

- SevenDaysCal 的 gate 是“多个自动模块互相抑制”的通用协调器；BioWeave 的
  scheduler 是 Character Floor 周期计数和完整分析 due 状态，不能改成通用
  module claim，也不能让外部模块宣称或清除 BioWeave 的 due/retry 状态。
- SevenDaysCal 的各业务模块多由一个大型宿主 `index.js` 装配；BioWeave 必须
  保留 Floor storage owner、World/Event 分域、Tracking/Projection 派生边界。
- SevenDaysCal 的 message id/content signature 不能替代 BioWeave 六字段 Floor
  Version、active Swipe 和 authoritative read-back。

## 4. PROPOSED_BOUNDARY：建议的目标边界

目标是把“何时允许自动分析”与“分析什么、如何保存”分开：

```text
Host Bridge
  -> Floor Recognition Port
  -> Generation Lifecycle Barrier
  -> Automatic Analysis Gate/Scheduler
  -> Shared Analysis Execution
       -> World Analysis
       -> Character/Event Analysis
       -> Floor persistence / Tracking rebuild / Projection refresh

Manual Analysis Port ----------------------^
```

### Host Bridge

只订阅/解绑 SillyTavern lifecycle，串行投递规范化的 lifecycle signal。它不做
counter、due、World 分析或 Floor 写入。

### Floor Recognition Port

使用现有 `core/message-role.js`、`storage/store.js` 和 Floor resolver，输出已
验证的 Character Floor target（含六字段 Floor Version、active Swipe、index 和
必要 provenance）。它负责拒绝 User、narrator、comment、unknown extension 和
不满足 owner/version 的消息；scheduler 只接受这个结果，不读取原始 host role。

### Generation Lifecycle Barrier

继续由 `runtime/generation-lifecycle.js` 管理 generation intent、pending
generation、pending new Swipe、settled/completed marker 和 stopped/cancelled
清理。它只在 Floor target 定型后向 Automatic Analysis Port 发出 settled target。

### Automatic Analysis Gate/Scheduler

只拥有自动触发状态：`counter`、`retryPaused`、有限 Floor key dedupe、due
判断、pending/force handoff、retry outcome 和只读诊断。它不拥有 World/Event/
Tracking/Floor persistence，也不判断 host message role，不直接写 Store。

### Shared Analysis Execution

拥有一次分析执行所需的 target validation、single-flight、World hard dependency、
Character/Event 调用、canonical read-back、Floor persistence、Tracking rebuild
和 Projection refresh。它接受 `trigger`/`reason` 等来源信息，但不根据来源复制
业务流程。自动和手动都通过此入口执行。

### Domain owners

- World 只拥有 World model 的分析/校验/域字段。
- Character/Event 只拥有 Character/Event 分析、身份解析、Event 域校验和域字段。
- Tracking/Projection 只从有效 Floor facts 重建派生结果。
- Storage/Coordinator 只拥有 Floor/Swipe/version 的 authoritative persistence。
- UI 只调用 manual port、读取状态和显示通知。

本轮落地的是调用 seam 和 facade，不是物理文件搬迁：scheduler 与 shared
execution 的实现仍由 `runtime/event-analysis.js` 装配和持有。依赖规则已经由
调用方向和窄 port 固定，但该 coordinator 仍是本轮明确保留的剩余 coupling，
后续只有出现实际收益并且测试稳定时才考虑拆实现 owner。

## 5. PUBLIC_PORTS：最小公开入口

名称是目标概念；迁移阶段可以由现有 runtime facade 适配，不要求本轮新增文件。

### Host port

```js
hostLifecycle.onGenerationStarted(payload)
hostLifecycle.onGenerationEnded(payload)
hostLifecycle.onGenerationStopped(payload)
hostLifecycle.onCharacterMessageRendered(payload)
hostLifecycle.onSwipe(payload)
hostLifecycle.onChatChanged(payload)
```

Host port 只接收 host signal，不暴露 scheduler 内部 Map 或 Floor 写方法。

### Automatic analysis port

```js
autoAnalysis.observeSettledCharacterFloor(target, {
  force,
  reason,
  generation,
})
autoAnalysis.getState()
autoAnalysis.reset(reason)
```

`observeSettledCharacterFloor` 是唯一推进自动 counter/due 的写入口；`getState`
是只读诊断；`reset` 只由 Chat lifecycle/destroy 等已授权 owner 调用。外部模块
不得设置 counter、retryPaused、dedupe key、pending 或任何其它 scheduler 内部状态。

### Manual port

```js
manualAnalysis.refreshCurrentFloor()
manualAnalysis.analyzeCurrentCharacterEvents()
```

Manual port 可以绕过自动 due，但不能绕过同一 shared execution 的 Floor owner、
World hard dependency、single-flight、stale guard 或 persistence contract。World-specific
manual actions 仍由现有 World runtime entry points 拥有，尚未纳入本 port。

### Shared execution port

```js
analysisExecution.run({
  target,
  trigger: "automatic" | "manual-refresh" | "manual-character" | "reroll",
  generation,
})
```

该入口当前由 `runtime/analysis-execution.js` 提供，冻结对象只暴露 `run`；
automatic due、manual-refresh 和 manual-character 都通过它委托到现有
`analyzeFloor`。它是内部模块 port；未来业务模块若需要接入分析，只能提供明确
trigger 和 validated target，通过此入口连接，不得直接调用 `store.saveFloor` 或
修改自动 scheduler state。

## 6. SHARED_EXECUTION：自动/手动共用路径

自动入口只做：

1. 接收 Generation Lifecycle 已 settle 的合法 Character Floor。
2. 做 observed/dedupe、interval counter、retryPaused 和 due 判断。
3. due 时调用 `analysisExecution.run({trigger: "automatic"})`。
4. 根据完整执行的 success/failure 结果更新 scheduler outcome。

手动入口只做：

1. 请求当前合法 Floor 或指定合法 target。
2. 指定 `manual-refresh`、`manual-character` 或 World-specific trigger。
3. 调用同一个 `analysisExecution.run`。

两者都必须经过相同的：

- active Chat/Character owner、active Swipe 和六字段 Floor Version 校验；
- single-flight 和 stale/abort guard；
- World hard dependency（Manual Character 继续复用合法已持久化 World，不发起
  World AI）；
- Character/Event canonical read-back、manual supplement A+B preservation；
- Floor persistence、Tracking rebuild 和 Projection refresh。

自动 scheduler 的 `counter=0` 只能由完整成功结果触发；手动成功是否清 counter
以及 force/reroll 的当前行为必须在迁移测试中锁定，不得因拆分而改变。

## 7. MIGRATION_PLAN：小步迁移

Phase 1 已通过窄 facade 包装现有 scheduler；Phase 2 已通过冻结的
`analysisExecution.run` 包装现有 `analyzeFloor`，并由 automatic、manual-refresh
和 manual-character 共用；`runtime/event-analysis.js` 仍保留 scheduler 与执行
实现，旧 runtime facade 保持可用。后续建议按以下顺序，每一步保持旧
facade 可用并做 real-host 验收：

1. **冻结合同**：先补 port、边界、禁止依赖和现有行为测试；保留当前
   `runtime/event-analysis.js` 实现不动。
2. **包一层 Automatic Analysis Port（Phase 1 已完成）**：把现有
`scheduleRenderedCharacter`、`runScheduledAnalysis` 和 scheduler state
通过 `runtime/automatic-analysis.js` 的窄 facade 暴露；内部仍委托原函数，
generation settle 与直接 Character render 都通过该 port 进入，零行为变化。
3. **接 Generation Lifecycle（Phase 1 已完成）**：只把 settled target 从
   `generation-lifecycle.js` 接到该 facade；保留 pending/reroll/Swipe 规则和
   `assistant_message` Floor recognition 测试。
4. **抽 Shared Execution Port（Phase 2 已完成）**：由
   `runtime/analysis-execution.js` 提供唯一 `run` seam；automatic 与 manual
   都通过适配器调用，`analyzeFloor`/`runAnalysis`、World、Tracking 和
   persistence 均未移动。
5. **收窄 runtime facade（Phase 3 已完成）**：UI 的 Character manual action
   通过 `manualAnalysis` port；旧方法仍作为兼容入口保留。Host lifecycle 继续
   由 `runtime/events.js` 内部拥有，未新增无调用方的 host abstraction。
6. **最后才移动实现文件**：仅在 targeted tests、real-host trace 和旧行为对照
   全部通过后，才把 scheduler/gate 代码移入独立模块。任何一步失败都回到上一
   个 facade 层，不整体回滚 World/Tracking/role 修复。

禁止把这项迁移和 World prompt、Tracking、Projection、UI redesign 或 unrelated
StoryTime failures 合并处理。

## 8. TEST_BOUNDARY：必须独立保护的测试

### Host/Floor recognition

- 真实 SillyTavern `assistant_message` Character shape 仍被识别为有效 Floor。
- hidden Character 仍不因 `is_system` 单独降为 system。
- User、narrator、comment、unknown extension/system message 仍拒绝进入 Floor。
- active Swipe、六字段 Floor Version、编辑/删除和 message version 变化仍正确。

### Lifecycle barrier

- generation start/end/render 的 settle 顺序；
- stopped/cancelled 未成 Floor 时清理 pending；
- reroll/new Swipe force 规则；
- 同一 generation/同一 Floor Version 的重复 CMR 不重入。

### Automatic gate

- 每个新的有效 Character Floor 只计数一次；
- interval 未到不执行，达到才 due；
- success 清 counter，failure 按 retry 配置保持 due 或 paused；
- force/reroll、pending、dedupe、Chat switch/destroy 清理；
- scheduler 不直接触碰 World/Event/Tracking/Floor persistence。

### Shared execution

- automatic、manual-refresh、manual-character 都到同一个 execution spy/port；
- UI Character manual entry 使用 `manualAnalysis` port；World-specific manual entry
  仍使用现有 World runtime owner；
- World hard dependency 和 World=0 的 Manual Character contract；
- manual supplement A+B preservation；
- Floor save/read-back、active Swipe/version stale guard；
- Tracking/Projection 只在 canonical Floor facts 之后刷新。

### Integration and architecture

- real-host trace：`GENERATION_*` → accepted Floor → scheduler notification →
  counter/due → `AUTO_ANALYSIS_TRIGGERED` → World/Event invocation；
- automatic failure 的第一失败点能通过 trace 定位；
- static/import checks：scheduler 不导入 UI、World/Event domain、Tracking 或
  storage write implementation；external feature 不写 scheduler internals。

## 9. DOC_PLAN：权威文档维护

- 本文件：权威记录自动分析模块的职责边界、公开 ports 和禁止跨层访问。
- `docs/AUTO-ANALYSIS-SCHEDULER.md`：继续记录当前计数/due/retry/reroll/Swipe
  语义，并链接回本文件；不得重新定义模块 ownership。
- `.trellis/spec/domain/index.md`：登记本文件，避免未来只看到 scheduler 状态
  而忽略隔离边界。
- `docs/ARCHITECTURE.md`：production extraction 完成后才同步实际文件 owner；本
  轮不写未实现的模块名。
- `docs/bioweave-data-lifecycle.md` 与 `floor-state.md`：只有迁移新增/改变持久
  化或 runtime state ownership 时才同步；本轮不改变这些 contract。

## 10. Validation / Error Matrix

| 输入/结果 | 责任边界 | 允许动作 | 禁止动作 |
| --- | --- | --- | --- |
| 非 Character host message | Floor Recognition | 返回 rejected/not-a-floor | scheduler 计数或分析 |
| Character Floor 未 settle | Generation Lifecycle | 保留 pending | scheduler 计数 |
| 有效 Floor，未到 interval | Automatic Gate | counter + 1 | 调用 World/Event |
| 有效 Floor，due | Automatic Gate → Shared Execution | 启动一次执行 | scheduler 自己组 World/Event 输入 |
| World 不可用/未 Ready | Shared Execution | fail closed，按现有 retry 结果回传 | 调用 Character/Event |
| manual-character | Manual → Shared Execution | 复用已验证 World，执行 Event | 触发 World AI 或绕过 Floor authority |
| execution stale/abort | Shared Execution | 丢弃迟到结果 | 写旧 Floor、清除不属于自己的 scheduler 状态 |
| execution success/failure | Shared Execution → Automatic Gate | 按现有规则更新 outcome | 改变产品计数规则 |

## 11. Good / Base / Bad examples

**Good**：host bridge 把 `assistant_message` 正规化成已验证 Character Floor，
settled barrier 调用 automatic port；automatic port 达到 interval 后调用 shared
execution；shared execution 完成 World → Event → canonical save/read-back。

**Base**：普通有效 Character Floor 尚未 due；automatic port 只递增 counter，
没有 AI 调用，下一楼继续观察。

**Bad**：scheduler 读取 `message.extra.type` 自己判断 Character、直接调用
`store.saveFloor`、直接修改 scheduler 内部处理状态，或 UI/Tracking 通过
`getAutoAnalysisSchedulerState()` 修改内部 counter/retry/dedupe。

## 12. Wrong vs Correct

| Wrong | Correct |
| --- | --- |
| 修改 role helper 后顺手改 scheduler 兼容判断 | role/Floor recognition 产出 validated target，scheduler 只消费 target |
| 手动分析复制一套 World/Event 保存流程 | Manual port 与 automatic port 调同一 shared execution |
| 把 scheduler counter 写进 Chat/Floor | scheduler state 保持 Runtime-only；Floor Version 才是事实身份 |
| scheduler 为了“方便”刷新 Tracking/Projection | shared execution 在 canonical persistence 后调用各 domain owner |
| 外部模块直接设置 retryPaused 或 observed keys | 通过公开 observe/reset port；内部状态只读诊断 |
| 用 scheduler 重写 due/retry/reroll 产品规则 | 迁移只移动 owner，不改变现有规则和测试 |
