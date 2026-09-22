# BioWeave Auto Analysis Scheduler 正式替换

## Goal

以有效 Character Floor Counter 和真实生成生命周期替换旧物理 message floor 自动分析调度器，保留 Floor/World/Analysis 所有权、单飞、失败重试与 forward-only 规则，并补齐回归测试与文档。

## Goal and user value

用“有效 Character Floor 的独立推进计数”替换当前基于 ST 物理 message floor 的旧 Auto Analysis Scheduler，使自动分析只由真正定型的 Character 回复驱动，并在失败、编辑、重生成、Swipe 切换和异步竞态下保持可解释、可重试且不污染 Floor 历史。

## Confirmed current facts

- `runtime/event-analysis.js:71-89` 当前把 `MESSAGE_RECEIVED`、`GENERATION_ENDED`、`MESSAGE_UPDATED`、`MESSAGE_EDITED`、`MESSAGE_SWIPED`、`MESSAGE_SWIPE_DELETED` 作为自动分析入口，并以 `FORCED_LIFECYCLE_EVENTS` 绕过 interval。
- `runtime/event-analysis.js:2602-2611` 当前使用 `floor - lastProcessedFloor >= interval`；`runtime/floor.js:276-279` 提供仅服务旧语义的 `isIntervalTarget()`。
- `runtime/event-analysis.js:1293-1310` 当前通过成功 Floor 的 ST `floor` 重算 `lastProcessedFloor`；Floor State Contract 只允许该值作为 hint，不能作为事实或历史恢复来源。
- `runtime/event-analysis.js:767-807` 的 `invalidateMutation()` 同时承担正确的 Floor Version 失效/stale 保护和旧 forced scheduler 的取消/清根副作用，需拆分后保留前者、删除后者。
- `runtime/event-analysis.js:1033-1251` 已有 Floor-owned World Full/Patch/Reuse resolver、World-specific single-flight 与 fail-closed 前置；`runtime/event-analysis.js:2433-2481` 已有 Floor Version Analysis Job single-flight。
- `runtime/events.js:28-38,1237-1244` 当前没有绑定 `CHARACTER_MESSAGE_RENDERED` 或 `GENERATION_STARTED`；事件监听应仍使用宿主 `eventSource.on/removeListener`。
- Floor State Ownership Contract 与 `docs/bioweave-data-lifecycle.md` 要求 Character Floor only、User 不得成为 Floor、完整六字段 Floor Version、active Swipe ownership、历史 Floor immutable、forward-only persistence、stale async result discard；这些均不变。
- SevenDaysCal 的可借鉴生命周期是：`CHARACTER_MESSAGE_RENDERED` 驱动有效角色回复计数；编辑只更新正文签名；`pendingGeneration` 的新 Swipe 等待正文定型；既有 Swipe 切换读取已有结果，不因切换本身请求 AI。

## Requirements

### R1. Character Floor progression

- `analysis_interval` 表示“每 N 个新的有效 Character Floor 执行一次正常 Auto Analysis”。
- Auto Scheduler 必须拥有独立的 Character progression/counter；ST `floor`/`message_id` 继续仅用于 owner、排序、checkpoint、UI 和 Floor Version。
- User message、User edit、删除事件和普通生命周期更新不得推进 counter。
- 每个真正新的有效 Character 回复最多推进一次：`counter = min(interval, counter + 1)`；达到 interval 才触发正常 Auto Analysis。
- 成功必须覆盖 World Full/Patch/Reuse、Character/Event Analysis、validation、persistence 以及现有成功链；只有完整链成功才清零。

### R2. Failure and retry

- 自动分析任一必需步骤失败时，counter 不清零，并保持 interval 的到期状态。
- `retry_failed_analysis=true` 时，下一次有效 Character Floor 自动 retry；每次失败继续保持到期，直到完整成功。
- 首次 World Full 失败时不得创建假的 World，也不得运行 Character/Event；后续 retry 仍先 Full，成功后才进入 Character/Event。
- 已有 World 的 Patch 失败时不得运行 Character/Event；retry 按当前 Floor 重新 resolve World，可 Reuse 已有效 World，不得回写历史或无脑 Full。
- World 成功但 Character/Event 失败时不得破坏 World；retry 重新按当前 Floor resolve/reuse World，再执行完整链。
- `retry_failed_analysis=false` 时，失败保持 counter 到期并进入 `retryPaused`：后续 Character Floor 不自动请求；普通正文编辑不能解除 paused、清 counter 或触发 retry；Manual Refresh 和真正 reroll 可强制尝试；强制尝试成功后清零并恢复正常计数，失败则继续保持到期且 paused。

### R3. Lifecycle classification

- `CHARACTER_MESSAGE_RENDERED` 是正常新 Character Floor 的主要定型触发点；必须通过 active Swipe、正文签名、message version 与 Floor Version single-flight 去重。
- `MESSAGE_EDITED` / 普通 `MESSAGE_UPDATED` 只更新当前正文签名/识别基线并按 Floor 正确性失效旧版本派生事实，不得推进 counter 或自动调用 World/Character/Event API。
- 真正 regenerate/reroll 必须由 `GENERATION_STARTED`、pending 状态、最终 `CHARACTER_MESSAGE_RENDERED` 及现有 content/Floor Version 变化共同识别；成功形成的新 active Swipe/正文强制分析，不受 interval 限制。
- `MESSAGE_SWIPED` 必须区分 `pendingGeneration=true` 的新 Swipe generation 与切回已有 Swipe：前者等待新正文定型并强制分析，后者优先复用匹配六字段 Floor Version 的成功结果，无匹配时再按正式规则判断。
- `MESSAGE_DELETED` / `MESSAGE_SWIPE_DELETED` 不因删除本身推进 counter 或无条件调用 AI；active owner 实际切换时只按已有 Floor/Swipe 重建派生状态。
- Manual Refresh 始终允许强制分析当前 Character Floor，并与相同 Floor Version 的 Auto/World Full/World Patch/reroll 复用同一 in-flight Job。

### R4. Preserve domain boundaries

- 保留 Character Floor only、User message 非 Floor、六字段 Floor Version、active Swipe owner、World Model hard prerequisite、World Full/Patch/Reuse、World/Analysis single-flight、历史 Floor immutable、forward-only persistence、stale result discard、Snapshot/Projection 现有规则。
- Auto counter/retry 是 Runtime 调度状态，不得写入 User Floor、旧 Character Floor、旧 Snapshot 或历史 World Model，不得建立第二历史数据库。
- 不复制 SevenDaysCal 业务数据结构，不引入 speculative Factory/Registry/Repository/Service 层。

### R5. Dead-code cleanup and documentation

- 删除仅服务旧 scheduler 的 `isIntervalTarget`、`lastProcessedFloor`/`recomputeLastProcessedFloor`、ST floor-difference path、旧 `FORCED_LIFECYCLE_EVENTS` forced semantics、相关 `invalidateMutation` 分支及无调用方 helper/state/test/fixture/comment/docs。
- 保留仍服务 Floor correctness、Version identity、content hash/message version、active Swipe、World/Analysis single-flight、stale guard、failure status、forward-only persistence 的结构。
- 同步更新受影响的 runtime 文档、README/数据模型/生命周期说明与测试命名，清理所有旧物理 floor interval 和 edit/update/swipe 无条件 force analysis 的残留引用。

## Acceptance Criteria

- [ ] Character-only interval：User/Character 交替时 interval=2，Character #1 不分析、#2 分析一次、#3 不分析；User 连续出现不改变 counter。
- [ ] 新 Character Floor 每个只计数一次；普通 Character edit 五次 counter 不变，User edit API/counter 均不变。
- [ ] 普通 `MESSAGE_UPDATED`、`MESSAGE_EDITED`、删除和既有 Swipe 切换不因事件名称无条件调用 AI。
- [ ] 真正 reroll/new Swipe generation 强制分析一次；多事件生命周期最多一条实际 Analysis Job、World API 和 Character/Event API 不重复。
- [ ] 切回已有成功 Swipe 时 API=0；新 Swipe 正文定型时 Analysis=1。
- [ ] interval target failure、连续 retry、retry success、`retry_failed_analysis=false` 均符合 R2，并使用 deferred Promise/API call count 断言。
- [ ] 首次 World Full failure、World Patch failure、Character/Event failure 均 fail-closed；retry 不修改历史 World，不绕过 World hard prerequisite，不无脑重复 Full。
- [ ] Auto retry 与 Manual Refresh、Manual World Full/Patch、reroll 重叠时，同一 Floor Version 不产生重复 World/Character API。
- [ ] 删除与 Swipe 删除不增加 counter；active Swipe/owner 发生真实切换时仅恢复对应合法 Floor 数据。
- [ ] 旧 scheduler 语义无残留：无 `isIntervalTarget` 调用方、无物理 floor interval 路径、无 edit/update 无条件 force analysis 路径、无旧 forced fallback/alias。
- [ ] `npm test`、`npm run check`、目标文件 `node --check`、`git diff --check` 全部通过，0 fail、0 skipped；真实 SillyTavern Desktop/Tablet/Mobile acceptance 作为独立未自动化项明确报告。

## Out of scope

- 不改 World Model、Character/Event、Snapshot、Projection 的业务 schema 或历史持久化所有权。
- 不把 SevenDaysCal 的 ledger/calendar/业务数据结构移植到 BioWeave。
- 不扩展 UI 功能；仅更新产品文档中与 scheduler 合约直接相关的文字。
- 不提交、push、创建 PR；除非用户另行授权。

## Resolved product decisions

- `retry_failed_analysis=false` 的最终语义已确认：失败后 `counter` 保持 interval、`retryPaused=true`；后续正常 Character Floor 只更新去重/生命周期基线，不自动请求；普通编辑不解除 paused；Manual Refresh 或真正 reroll 可强制请求；强制成功清零并恢复正常 interval，强制失败继续保持到期和 paused。
- `retry_failed_analysis=true` 时失败保持 interval 到期，下一新的有效 Character Floor 自动 retry；连续失败继续 retry，成功后清零并从下一个新的 Character Floor 重新按 interval 计数。
- 真正 reroll/new Swipe generation 是强制路径，不以 counter 是否到期为前提；其成功按强制成功规则清零，失败按当前 `retry_failed_analysis` 设置决定自动 retry 或 paused。
- 已有 Swipe 切换优先复用匹配六字段 Floor Version 的成功结果；没有匹配成功结果时不因事件名强制请求，而是进入正常 interval eligibility。
