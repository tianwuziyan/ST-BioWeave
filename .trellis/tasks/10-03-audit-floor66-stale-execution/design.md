# 技术审计设计与当前证据

## 审计结论与实现边界

代码与附件已充分证明 stale owner、Context comparison state 缺失与重复 Event 输入缺失的路径；未把手机后台具体停在某个 `setTimeout`、Promise 或 Host event 写成已证事实。实现因此只增加 owner/supersede/stale guard，不加入 `visibilitychange` 特判；后台机制仍需 real-host 复测确认。

## 证据链

### A. Stale execution

附件 trace 已形成以下序列：

1. `调试信息.txt:913-965`：`generation-3` 已把 `finalFloorSeen` 固定为 Floor 56，但 `generation_ended=false`。
2. `调试信息.txt:973-1007`：随后收到消息/渲染 Floor 66；同一个 pending generation intent 仍是 `generation-3`，并没有被新 Floor supersede。
3. `调试信息.txt:1014-1049`：`GENERATION_ENDED` 没有目标 Floor，pending intent 仍指向 56；后续 `GENERATION_SETTLED` 在 `调试信息.txt:1055-1083` 明确结算 Floor 56。
4. `调试信息.txt:1135-1187`：`ANALYSIS_INPUT_READY` 与 `AUTO_ANALYSIS_TRIGGERED` 的 owner、目标消息、Floor Version 全部是 56，并且 `trigger=reroll`、`generation_type=regenerate`、`generation_settled=true`。
5. `runtime/generation-lifecycle.js`：`onGenerationEnded()` 使用 `pending.finalFloorIndex` 调用 `resolveEndedTarget()`；`onCharacterMessageRendered()` 只接受 `pendingMatchesTarget()`，而该匹配要求 pending messageId 与新 target messageId 相同。因 56 与 66 不同，新 render 不会消费/替换旧 intent。
6. `runtime/event-analysis.js`：`scheduleRenderedCharacter()` 把 captured target 的 `index` 交给 `runScheduledAnalysis()`；`analyzeFloor()` 再按该 index 解析并创建 execution。`assertExecutionTargetCurrent()` 只验证 execution 绑定的 Floor 56 是否未变，没有验证它仍是 live current/settled owner。

因此，已证明的根因是 **generation intent 的 owner supersede 边界与 analysis execution 的 live-owner gate 之间存在断口**，不是 scheduler counter 本身。

### B. Context boundary

`runtime/event-analysis.js::buildFloorAnalysisInput()` 的四类输入目前不是一个显式 immutable Analysis Job snapshot：

- `current_floor` 与 `floor_version` 来自传入 target 56；
- `recent_story` 明确限制为 `recentStoryItemsThrough(target.index)`；
- `character_registry` 来自 `findPreviousSuccessfulBioWeave(target)` 的严格前置 Floor；
- `existing_events` 来自 previous events、严格前置且出现在 recent-story floor 集合内的 events，以及仅在 `preserveCurrentFloorState=true` 时才加入 target 当前 slot 的 events。

本次 automatic reroll 调用 `buildFloorAnalysisInput(target, token)`，没有传 `preserveCurrentFloorState`，因此 target 56 原有 Event 不进入 `existing_events`。附件输入 `【补充】输入文件1.txt:202-425` 中存在剧情上下文和目标 56，但没有 `【现有 BiologicalEvent 事实参考】` block；`ai/prompts.js:521-527` 证明该 block 只有非空 existing_events 才会输出。

已证明：该 execution 内部的四部分都围绕旧 target 56 构建，而不是 live Floor 66；问题首先是 owner 错了，其次 automatic reroll 又没有把 target 自身已保存事实作为比较基线。当前 trace 没有足够字段证明某一部分实际混入了 live 66，因此不能声称发生了 56/66 混合输入。

### C. Registry 与 Runtime dedupe

- 附件输入 `【补充】输入文件1.txt:75-78` 明确为 Initial Registry Bootstrap，`entities` 为空。
- `ai/input-builder.js:976-998` 会把空 registry 投影成空 `canonical_candidates`；`ai/prompts.js:435-442` 因而向模型声明没有 existing canonical identity。
- `runtime/character-event-analysis.js:337-350` 先按该空 registry 做 identity resolution，再执行 `dedupeEventsAgainstExisting()`；现有事件参考为空时，Runtime 没有可比较的 canonical historical key。
- `core/events.js:1035-1073` 的 `eventSemanticKey()` 已是保守的结构化 key，使用 type、canonical participant IDs、subject/counterpart、mechanism、story time 和 source evidence；不是 display name 或模糊文本。
- 但 `runtime/character-event-analysis.js:18-33` 的 event_id 依赖 Floor Version + response ordinal；这适合当前 Floor 内唯一，不适合跨次 historical rediscovery。`eventContinuityKey()` (`:90-113`) 还使用 display_name/event_role 做同一 Floor continuity，这不是跨历史 canonical identity contract。
- `core/events.js:998-1013` 的 `dedupeEvents()` 只按相同 event_id 或完整 fingerprint 去重；新 Floor Version/ordinal 会得到新 ID，persistence 的 owner/version 检查只保证写入合法 owner，不负责跨 Floor factual identity。

因此，本次重复不是“prompt 没有要求去重”：输入没有 existing_events，Registry 为空，Runtime canonical key 无法命中，且 event_id 本身是本次 response ordinal identity。已证明第二道防线在该现场没有有效比较对象；是否还存在另一个 persistence 层重复保存，需要后续读取实际 Floor slot 的完整 Event 列表确认，当前附件 trace 不能单独证明最终重复记录的两个 source。

## SevenDaysCal 对照

参考仓库的 `runtime/task-owner.js` 建立单调 token、Chat revision、channel latest owner、AbortController，并在 owner 替换时 abort 前一个任务；`runtime/task-orchestration.js` 将 canCommit/canCallback/canFollowup 集中到 owner/revision 判断。`memory.js` 的 queue 按 job key 串行执行，API await 后用 lifecycle epoch、Chat ID、source hash 再检查，切 Chat 或源变化时丢弃结果；`date-coordinator.js` 还按 chat/message/swipe/content signature 建立记录并淘汰同 Floor 的旧版本。`store.js` 使用 owner guard 和确认式即时保存。

可借鉴的是“队列任务不依赖 UI timer 才推进 + 明确 owner token/epoch + await 后再验证 + stale 结果不可 commit”，不借鉴其业务数据架构。

## 最小修复方向（已按批准实现）

1. ✅ Generation lifecycle：新 Character Floor render 明确 supersede 尚未 settle 的旧 pending generation；迟到 `GENERATION_ENDED` 不能按旧 index 复活。
2. ✅ Analysis execution：execution 保存完整 Floor Version 与 generation identity；AI request 前 fail-closed 验证合法 owner。
3. ✅ Input：reroll 显式使用 target slot comparison reference，不把它混入严格 previous Floor；manual supplement A+B 保持原语义。
4. ✅ Event identity：保留现有 conservative `eventSemanticKey`，补 historical rediscovery 与 genuine repeat 测试，未重新设计 `event_id`。
5. ✅ 后台：没有加入 `visibilitychange`；延迟由 owner/supersede/stale guard 兜底，后台继续执行能力留给 real-host 验收。
