# Auto Analysis Scheduler 正式替换：技术设计

## 1. Change boundary

本任务只替换 Runtime 自动调度与宿主生命周期分类，保持现有 Floor、World、Character/Event、Snapshot、Projection 和 Storage 所有权不变。

预期产品文件边界：

- `runtime/events.js`：增加最小必要的宿主事件绑定和 payload 转换，纳入 `CHARACTER_MESSAGE_RENDERED`、`GENERATION_STARTED`；保留现有事件串行队列与 `removeListener` 清理。
- `runtime/event-analysis.js`：移除旧物理 floor scheduler，加入 transient Character counter、generation/swipe lifecycle classifier、failure retry/paused 决策，并复用现有 analysis/world jobs、stale guard、Floor resolver 和 invalidation 基础设施。
- `runtime/floor.js`：删除只服务旧物理 floor interval 的 `isIntervalTarget()`；保留 Floor Version、hash、active Event、analysis commit/status 基础设施。
- `tests/event-analysis-runtime.test.js`：重写旧 scheduler 测试并新增 deferred Promise/API call count 的生命周期矩阵。
- `tests/runtime.test.js` 及必要的共享 fixture：补齐实际宿主 event type/payload 与 listener 注册/解绑覆盖；不保留废弃行为测试。
- `docs/DEVELOPMENT.md`、`docs/UI.md`、`docs/DATA-MODEL.md`、`README.md`：同步 scheduler 合约，删除 N-floor/ST physical floor 旧语义；`docs/bioweave-data-lifecycle.md` 仅在其 scheduler/hint 描述需要时更新，明确 counter 是 Runtime transient、不是 Floor 字段。

明确不改：`storage/schema.js` 的持久字段结构（不持久化 counter/paused）、World Model schema/analyzer、Character/Event DTO、Snapshot/Projection schema、UI 页面行为、Chat-level derived facts。

## 2. Runtime state model

调度状态只存在 `createEventAnalysisCoordinator()` 的 Runtime 内存中，随 Chat owner/epoch 失效或重新初始化；不写入 Floor、User message、Chat metadata、Snapshot 或历史 World。

```text
schedulerState = {
  counter: 0,                    // 0..interval，失败时保持 interval
  retryPaused: false,            // false 仅表示允许正常自动 retry
  countedFloorKeys: Set,         // chat + complete six-field version keys
  observedFloorKeys: Set,        // lifecycle 去重基线，不是历史事实源
  pendingGeneration: null,       // 当前 generation/reroll intent
  pendingSwipeGeneration: null,  // 新 Swipe 尚未定型的 intent
  lastFailure: null              // transient diagnostic/status，仅供调度决策
}
```

`countedFloorKeys` / `observedFloorKeys` 只防止同一 Floor Version 被多个 ST events 重复处理；它们不能替代 `store`、Floor Version 校验或 previous resolver。Chat change、Swipe owner change、content hash/message version change 都由现有 owner/epoch/version guard 再次确认。

### Counter transitions

| 触发 | counter | retryPaused | 是否自动请求 |
| --- | --- | --- | --- |
| 新的有效 normal Character Floor，未到 interval | `min(interval, counter + 1)` | 保持 false；若已 paused 则保持 true | 否；paused 时也否 |
| 新的有效 normal Character Floor，到 interval，`retry_failed_analysis=true` | 保持/置满 interval | false | 是 |
| 新的有效 normal Character Floor，到 interval，`retry_failed_analysis=false` 且 paused | 保持 interval | true | 否 |
| 完整自动链成功 | `0` | false | 当前请求完成 |
| 自动链失败，retry=true | interval | false | 等下一新 Character Floor retry |
| 自动链失败，retry=false | interval | true | 后续 normal Character Floor 不请求 |
| Manual Refresh / true reroll 成功 | `0` | false | 强制请求完成 |
| Manual Refresh / true reroll 失败 | interval | 按 setting 保持 false/true | retry=true 等下一新 Character；retry=false 继续 paused |
| 普通 edit/update/delete | 不变 | 不变 | 否 |

普通新 Character Floor只在“完成定型、active Character、当前六字段版本完整、该版本未被 scheduler 观察过”时推进一次。强制 reroll/new Swipe generation 不额外 +1；它是独立 force path，成功清零，失败置为到期。

## 3. Lifecycle classifier

### Normal Character reply

`CHARACTER_MESSAGE_RENDERED` 读取当前 message/active Swipe，重新计算六字段 Floor Version。没有 pending generation/reroll，且版本不是已观察版本时，标记 observed、推进 counter，再根据 counter/paused/setting 决定是否调用 `analyzeFloor({force:false})`。同一版本的后续 `MESSAGE_RECEIVED`、`GENERATION_ENDED`、`MESSAGE_UPDATED` 只能更新识别基线或 join 已有 Job，不得再次计数。

### Ordinary edit/update

`MESSAGE_EDITED` 和没有 generation intent 的 `MESSAGE_UPDATED` 只捕获新正文 hash/message version，执行现有正确性失效与 active derived rebuild；不走 scheduler advance，不强制调用 `analyzeFloor`。User owner 直接更新 lifecycle snapshot，不创建 Floor、不计数、不分析。编辑失败后的 paused 状态保持不变。

### Reroll/regenerate

`GENERATION_STARTED` 建立带 chat/owner/message/previous version 的 pending generation intent；如宿主 payload 明确为 regenerate/reroll 或伴随 active Swipe generation，则将其标记为 force。`CHARACTER_MESSAGE_RENDERED` 看到新的 active Swipe/正文 Floor Version 后消费 intent，走 force path；`MESSAGE_UPDATED`/`GENERATION_ENDED` 只能协助确认定型，不能单独启动第二条 Job。现有 Floor Version `inFlight` 与 `worldInFlight` maps 是最终 single-flight 边界。

### Swipe

- `MESSAGE_SWIPED` 携带 `pendingGeneration=true` 时只登记 pending new Swipe，等待 CMR 的新正文/版本后 force analyze。
- 切回已存在 Swipe 时先读取该 Swipe 的 exact owner slot。匹配完整六字段版本且 analysis success 时直接复用；无匹配成功结果时走 normal interval eligibility，不因 `MESSAGE_SWIPED` 名称 force。
- `MESSAGE_SWIPE_DELETED` 只让被删 owner 失效并按当前 active Swipe 重建；不推进 counter、不 force AI。

### Delete

`MESSAGE_DELETED` 不增加 counter、不启动分析。保留 `invalidateMutation()` 中对 owner/epoch、活跃 Floor Version、stale async 结果和 forward-only derived rebuild 所必需的部分；删除为旧 forced scheduler 服务的“删除后统一 force”分支。

## 4. Analysis chain and failure boundary

调度器只决定“是否提交一个请求”；请求内部继续复用当前链：

```text
resolve current Character Floor
  -> resolve World Full/Patch/Reuse
  -> validate + normalize + save current World
  -> Character/Event Analysis with validated World
  -> identity/event collection validation
  -> current Floor save
  -> Snapshot checkpoint (disposable)
  -> Tracking/Projection rebuild
```

任何必须节点失败都返回失败，不清 counter。World 未成功时 Character/Event API 次数必须为 0；Patch 失败不回滚历史 World；Character/Event 失败不修改已成功 World。下一次 retry 重新按当前 Floor resolve World，允许 Reuse 仍有效的 World，禁止无条件 Full。所有写入继续受 chat token、epoch、完整 Floor Version 和 current-owner checks 保护。

## 5. Single-flight and stale behavior

- 同一完整 Floor Version 的 Auto、retry、Manual Refresh、Manual World Full/Patch、reroll 共享现有 `inFlight`/`worldInFlight` Promise。
- 生命周期事件由 `runtime/events.js` 现有 `lifecycleTail` 串行送入 coordinator；coordinator 内不因重复 mutation 取消当前同版本 Job。
- 只有 formal Floor Version 发生真实 owner/text/swipe/version 变化时才使相关 Floor 失效；普通更新通知不等价于事实变化。
- Chat switch、Swipe 删除、消息删除、版本变化或 disabled 会使 late result discard；不得向新 owner 或历史 Floor 写回。

## 6. Compatibility / cleanup decision

这是 replacement，不保留双轨或 alias：

- 删除 `isIntervalTarget`、`lastProcessedFloorFromStates`、`recomputeLastProcessedFloor` 和 scheduler 对 `last_processed_floor` 的读取。
- 删除 `FORCED_LIFECYCLE_EVENTS` 及其绕过 interval 的分支。
- 删除 `invalidateMutation` 中仅为旧 forced scheduler 清理/强制分析服务的分支；保留 Floor 正确性和 stale guard。
- 删除/改写验证旧物理 floor interval、edit/update/swipe 无条件 force 的测试与 fixture，并搜索残留引用。
- 不删除 `last_processed_floor` 的历史 schema/读写，若其仍被非 scheduler UI/diagnostic 使用则按实际调用保留；本任务不得再让它决定分析。

## 7. Risks and rollback shape

主要风险是 ST 在不同生成路径中 payload 形状不同，或 `CHARACTER_MESSAGE_RENDERED` 与 `MESSAGE_SWIPED` 到达顺序不同。通过真实 event type 绑定、payload 归一化、deferred lifecycle 测试和 Floor Version identity guard 处理；不引入业务数据迁移。

若质量检查发现问题，回滚边界是本 task 的产品文件和 task artifacts，不触碰工作区原有 accepted changes；不得用旧 scheduler fallback 掩盖失败。
