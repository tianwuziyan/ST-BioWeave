# Auto Analysis Scheduler 正式替换：执行计划

## Phase 0：启动前门禁

- [ ] 用户批准本规划摘要后，运行 `python3 ./.trellis/scripts/task.py validate auto-analysis-scheduler-replacement`。
- [ ] 运行 `python3 ./.trellis/scripts/task.py start auto-analysis-scheduler-replacement`，确认状态变为 `in_progress`。
- [ ] 实现前重新读取 `AGENTS.md`、`prd.md`、`design.md`、本文件、`.trellis/spec/domain/floor-state.md`、`docs/bioweave-data-lifecycle.md` 与 shared thinking guides。
- [ ] 记录 change boundary：只改调度与生命周期分类，不改 domain/storage schema。

## Phase 1：宿主生命周期与状态骨架

- [ ] 审核 `runtime/events.js` 的 `LIFECYCLE_EVENTS`、event type mapping、`lifecycleTail` 与 teardown；加入 `CHARACTER_MESSAGE_RENDERED`、`GENERATION_STARTED` 的最小绑定和必要 payload 转发。
- [ ] 在 `runtime/event-analysis.js` 建立 transient scheduler state 与明确的 state transition helper；状态不落 Floor/Chat metadata。
- [ ] 建立 Floor Version key 去重与 pending generation/swipe intent 消费逻辑；确认普通 update/edit 不会消费 force intent。
- [ ] 先写/重写 deferred Promise 测试，确保重复 generation lifecycle 只进入一条 Job。

## Phase 2：正式替换 interval 调度

- [ ] 删除 `AUTO_ANALYSIS_EVENTS` 的旧统一入口语义，按 normal CMR、force generation、ordinary mutation、delete/swipe ownership 分流。
- [ ] 删除物理 ST floor 差值判断、`FORCED_LIFECYCLE_EVENTS` 绕过逻辑和 `lastProcessedFloor` scheduler 依赖。
- [ ] 实现 normal Character Floor 的 `counter = min(interval, counter + 1)`；User/编辑/删除不计数；同一完整 Floor Version 不重复计数。
- [ ] 实现 target success/failed transitions；失败时 counter 保持 interval，完整 chain 成功才清零。
- [ ] 实现 `retry_failed_analysis=true` 的下一 Character Floor retry，以及连续失败/成功后的恢复计数。
- [ ] 实现 `retry_failed_analysis=false` 的 `retryPaused`：普通 Character/edit 不自动 retry；Manual Refresh/reroll 可 force；force success 清零，force failure 保持 paused/到期。

## Phase 3：mutation invalidation 与 Swipe/reroll

- [ ] 将 `invalidateMutation()` 中的正确 Floor Version invalidation、owner/epoch/stale protection 与旧 scheduler force side effect 分离。
- [ ] 普通 `MESSAGE_EDITED` / `MESSAGE_UPDATED` 只刷新正文签名与基线，不调用 AI；User mutation 只更新 lifecycle snapshot。
- [ ] 真正 `GENERATION_STARTED` + CMR 的 reroll/regenerate 形成 force path，不依赖 counter。
- [ ] `MESSAGE_SWIPED` 区分 pending new Swipe generation 与 existing Swipe switch；已有匹配成功 Floor API=0，新 Swipe 定型 force 一次，无匹配已有 Swipe 走正式 eligibility。
- [ ] `MESSAGE_DELETED` / `MESSAGE_SWIPE_DELETED` 不推进 counter、不无条件 force，active owner 变化时重建合法派生状态。
- [ ] 验证 Manual Refresh、Manual World Full/Patch、Auto retry、reroll 在同一 Floor Version 上复用现有 single-flight。

## Phase 4：dead-code cleanup 与文档同步

- [ ] 删除 `runtime/floor.js:isIntervalTarget` 及无调用方导入。
- [ ] 删除 `lastProcessedFloorFromStates` / `recomputeLastProcessedFloor` 及仅为 scheduler 保留的 state/helper/comment。
- [ ] 删除 `FORCED_LIFECYCLE_EVENTS` 和旧 `MESSAGE_EDITED/UPDATED/SWIPED/SWIPE_DELETED` 无条件 force 路径。
- [ ] 重命名/删除旧测试、fixture 与注释；不得 skip 旧测试或保留 compatibility alias/fallback。
- [ ] `rg` 全库搜索 `isIntervalTarget|lastProcessedFloor|recomputeLastProcessedFloor|FORCED_LIFECYCLE_EVENTS|MESSAGE_EDITED.*force|MESSAGE_UPDATED.*force|MESSAGE_SWIPED.*force|MESSAGE_SWIPE_DELETED.*force`，逐项确认残留是否仅为合法历史文档/schema hint。
- [ ] 同步 `README.md`、`docs/DEVELOPMENT.md`、`docs/UI.md`、`docs/DATA-MODEL.md` 及必要的 `docs/bioweave-data-lifecycle.md`，明确 Runtime counter/paused 非持久事实。

## Phase 5：验证矩阵

- [ ] Character-only interval、User 不计数、普通 Character/User edit、普通 UPDATED。
- [ ] reroll 多事件、existing Swipe、new Swipe generation。
- [ ] retry=true：单次失败 retry、连续失败、retry success 后 counter=0 再从 1 开始。
- [ ] retry=false：失败 paused、后续 Character 不请求、edit 不解除、Manual Refresh/reroll success/failure。
- [ ] 首次 World Full failure、Patch failure、Character/Event failure；验证 World hard prerequisite、World API/Character API call count 与历史 World immutable。
- [ ] single-flight：Auto/retry 与 Manual Refresh、Manual World Full/Patch、reroll 重叠。
- [ ] 删除/Swipe 删除、active Swipe 恢复、stale async result discard、disabled/Chat switch。

## Phase 6：质量门禁

- [ ] `npm test`：0 fail、0 skipped。
- [ ] `npm run check`：0 fail、0 skipped。
- [ ] `node --check runtime/event-analysis.js`、`node --check runtime/events.js`、`node --check runtime/floor.js` 及所有新增/改写 JS。
- [ ] `git diff --check`。
- [ ] `python3 ./.trellis/scripts/task.py validate auto-analysis-scheduler-replacement`。
- [ ] 使用 `trellis-check` 做 spec compliance、cross-layer、single-flight、dead-code 和测试完整性复核；必要时先回到本文件/设计修正，再重复验证。
- [ ] 报告真实 SillyTavern acceptance 未由 Node 测试覆盖，单独列出 Desktop/Tablet/Mobile 待验收，不伪称自动化通过。

## Implementation stop boundary

完成上述实现与质量验证后停止，不继续修改其它功能；不 commit/push/PR，除非用户另行授权。完成后必须汇报实际 Git diff、删除的旧结构、保留的基础设施、测试 pass/fail/skipped 数量和未完成的真实宿主验收。

## Final status

- implementation complete
- automated verification complete
- real SillyTavern host acceptance pending
- Scheduler 产品行为在本任务结束后冻结；后续仅在真实宿主验收证明生命周期假设错误时重新打开
