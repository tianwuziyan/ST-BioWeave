# 实施计划：Projection 批量生成与保存

## Phase A：先补回归测试

1. Runtime 测试覆盖两人物八条内置候选，断言完整输入收集恰好两次、批量保存一次、Analyzer 零调用。
2. Persistence 测试覆盖八条 creation/evidence 一次写入、最终 timeline 完整、精确重复零写入。
3. Persistence 测试覆盖非法 record、stale Floor Version、错误 owner/Swipe/Chat 和 append conflict 整批零写入。
4. Delivery 测试覆盖 23 条 submission/response 各一次 batch 写入、精确重复 no-op，以及非法/stale 整批零写入。
5. Lifecycle 测试覆盖多条 deletion/factual/expired 记录一次 batch 写入、精确重复 no-op，以及非法/stale/conflict 整批零写入。

## Phase B：最小实现

1. 在 `storage/projection.js` 增加 candidate/evidence 与 delivery batch API，并让单条 API 复用对应实现。
2. 在 `runtime/projection-runtime.js` 收集成功候选，内置候选使用 execution-local guard，批量提交前只执行一次完整 current-input 比对。
3. 在 `runtime/events.js` 注入批量保存 API。
4. 在 `runtime/events.js` 和 `runtime/projection-runtime.js` 将 delivery submission/response 改为内存汇总后单次批量保存；保留旧单条 response 的兼容回退。
5. 在分析成功后的 post-processing 中共享一次业务输入和 delivery 快照；超时关闭后才重新收集输入。
6. 在 `storage/projection.js` 增加 Projection lifecycle batch API；Runtime 分开汇总删除升级、事实状态和 lifecycle-only 过期记录，单条 API 保持兼容薄封装。
7. 在 Host lifecycle 编排边界增加 Generation settle gate：生成期间只记录待处理原因，禁止自动计算、Projection/Tracking/超时保存和 Context 重算；生成结束后合并执行一次。
8. 将普通 `CHAT_CHANGED` 收口为 Chat rebind：清理旧 Context、失效旧 owner、稳定后恢复已有结果；禁止进入 Projection process、lifecycle tick、Tracking/超时持久化和完整自动 recovery。
9. 跳过 `GENERATION_STARTED` 的完整 Projection Context 重算；重复 start 不清空 gate；将 Context/业务恢复统一放到最终 Character Floor 的单次 handoff。
10. 如现有 Context 恢复入口无法区分“已有结果恢复”和“完整业务收集”，增加最小只读参数/入口；保持 Coordinator、UI、候选文案和领域规则不变。

## Phase C：验证

1. 运行 Projection Runtime/Persistence/Floor Coordinator 定向测试。
2. 运行 `node --check`、`git diff --check` 和完整 `npm run check`。
3. 审查真实 diff、旧单条实现是否已收敛为薄封装、Markdown 是否仍与实现一致。
4. 真实 SillyTavern 中复测两个角色阶段切换耗时、自动 UI 刷新和 Debug 计数。
5. 真实 SillyTavern 中确认 `GENERATION_STARTED` 到最终消息确认期间无 Projection/Tracking/Floor 保存，结束后只执行一次合并后处理。
6. 真实 SillyTavern 中仅点击进入已有角色卡、不生成正文时，确认只发生 Chat rebind/已有结果恢复；不产生 Projection/Tracking/Lifecycle persistence，不调用 Analyzer；快速切换 Chat 时旧 Context 不残留。

## 回滚点

批量 API 与 Runtime 调用点可以作为一个整体回滚；不迁移或重写任何既有 Floor 数据。

## 当前验证记录

- 两人物八条内置候选测试确认完整 `collectInputs()` 为 2 次、批量持久化为 1 次、Analyzer 为 0 次。
- Storage 测试确认八条 creation/evidence 只产生一次 `saveFloor()`，精确重复为 no-op，非法/冲突/空批次均零写入。
- Delivery 测试确认 23 条 submission 与 response 各只产生一次 `saveFloor()`，精确重复为 no-op，非法/stale batch 均零写入。
- Lifecycle Storage 测试确认多条 deletion/factual 记录各自一次 batch 写入，精确重复为 no-op，非法/append conflict 整批零写入；Runtime 过期与 factual evolution 路径均只调用一次生命周期 batch。
- Runtime response 测试确认 23 条未回执 delivery 先集中构造，再只调用一次 response batch。
- Runtime 后处理测试确认回执观察、超时判断和推演生成共享一次 delivery 读取；内置候选正常路径只保留初始快照和提交前 freshness 检查两次输入收集。
- Generation gate 定向测试：生成期间零自动分析/保存，消息更新、编辑、删除和 Swipe 事件在停止后均完成一次延后重放。
- 真实 ST Debug `ST-BioWeave-Debug-20261020-004942.txt` 暴露同一轮连续两个 `normal GENERATION_STARTED`：第二个返回 `generation-intent-already-pending` 后曾错误释放 gate，并在没有任何 ended/stopped/cancelled 信号时启动 Context refresh。Runtime 现将该结果视为当前 generation intent 的重复通知并继续复用 active gate。
- 重复 start 回归测试按真实顺序覆盖 `GENERATION_STARTED -> deferred CHAT_CHANGED -> duplicate normal GENERATION_STARTED`：生成未结束时 Analyzer、Floor save、Context refresh 和 deferred replay 均为零；`GENERATION_STOPPED` 后该 Chat 事件恰好成功重放一次。
- 普通 `CHAT_CHANGED` 回归确认先清理旧 Context，再恢复已有 Projection；无 Projection process、lifecycle tick、自动 recovery、Analyzer、Floor save 或 delivery submission。
- `tests/event-analysis-runtime.test.js`、`tests/projection-context.test.js` 与 `tests/projection-runtime.test.js` 定向测试：371 pass、0 fail、0 skipped。
- 完整 `npm run check`：1652 pass、0 fail、16 skipped。
- `node --check` 与 `git diff --check` 通过；`storage/floor-persistence-coordinator.js` 未修改。
- 真实 SillyTavern 阶段切换耗时、自动 UI 刷新和 Debug 计数仍待宿主验收。

## Phase D：Generation activity lease 修复

- [x] 为 `GENERATION_STARTED` 增加约 3000ms provisional lease；重复 start 续租并保留 pending 事件。
- [x] 在宿主提供 `STREAM_TOKEN_RECEIVED` 时续租约 1500ms；终止事件和 runtime destroy 清理 timer。
- [x] lease timer 使用 gate identity/token guard；超时仅重放 deferred `CHAT_CHANGED` 只读恢复，其他业务事件 fail closed，不授权分析或持久化。
- [x] lease 超时时显式取消 event-analysis Generation Lifecycle stale pending intent；回归确认后续 START/STOP 立即复用并释放新 gate，不等待第二个 lease。
- [x] stream token 或匹配最终 Character Floor 活动会确认真实生成并停止 provisional expiry；CMR-before-ENDED 回归确认长非流式生成不被固定 lease 取消，最终只 handoff 一次。
- [x] Projection Context 在已有 built-in Story Time schedule 下只保留当前 observation stage；day 25 的旧 14–20 天 visible views 不再进入 prompt，append-only history 不变。
- [x] 增加无 token、无终止事件的重复 start 回归，覆盖超时重放一次、零 Analyzer/Floor save/Projection process/lifecycle persistence 和 gate 可复用。
- [x] 自动 Event analysis 成功后的 Projection postprocessor 在 generation gate 活跃时按 Floor 暂存，最终 Character Floor settle 后只释放一次；自动生命周期恢复同样启用顺序去重，完成态只保留当前 Chat 最近一项并在 Chat 切换时清空。
- [x] 对已确认真实活动但缺失 terminal event 的 generation 保留不续租 hard watchdog；超时 fail-closed 放弃本轮、禁止 partial-text handoff，并通过 public lifecycle seam 回归验证 gate 可复用。
- [ ] 真实 SillyTavern 仍需确认 quiet/background start 的超时恢复、stream token 续租和 Debug trace。
