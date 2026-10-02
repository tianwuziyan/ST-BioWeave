# 执行计划：真实宿主自动分析触发回归

## Phase A：只读定位

- [x] 固定 worktree、HEAD、`132f915`、`ad1f394`、`756d76c`，确认无业务脏改动。
- [x] 比较 `core/message-role.js`、`storage/store.js`、`runtime/event-analysis.js`、`ai/input-builder.js`、`ai/worldbook.js` 与真正 generation/scheduler 所在路径。
- [x] 阅读现有 lifecycle/scheduler regression tests，确认测试覆盖的 host shape 与真实 shape 的差异。
- [x] 获取 real-host 当前 Chat 的 generated message shape；普通 Character reply 为 `is_user:false`、无 `extra.type`，另有历史隐藏 Character 为 `is_user:false,is_system:true,extra:{}`。
- [x] 产出 OLD/CURRENT 八问路径表，标记第一次差异和拦截 guard。

## Phase B：最小实现（仅当 Phase A 已证明根因）

- [x] 修改唯一根因点；不改 scheduler interval/counter/due 产品规则。
- [x] 增加“132f915 可触发的真实 host Character shape”自动触发回归测试。
- [x] 保留并验证 hidden Character、narrator、comment、unknown extension/system 的边界测试。
- [x] 清理仅由本次修改产生的 unused import/变量；不做旁支重构。

## Phase C：验证与交付

- [x] `node --check` 相关修改文件。
- [x] 运行 role、input-builder/worldbook、event-analysis-runtime 的目标测试；记录已知非本任务 failures，不处理它们。
- [x] 检查 README/architecture/domain/testing Markdown 是否因最终行为变化而需要同步；本轮无产品行为修改，无需同步。
- [x] 运行 `git diff`、`git status`，确认没有回滚 manual supplement 或 hidden-role 修复，没有 commit/push。
- [ ] 输出 `OLD_WORKING_PATH`、`CURRENT_BROKEN_PATH`、`FIRST_BEHAVIOR_DIFFERENCE`、`ROOT_CAUSE`、`FIX`、`WHY_IT_DOES_NOT_REOPEN_OLD_ROLE_BUG`、`AUTO_TRIGGER_REGRESSION_TEST`、`TEST_RESULTS`、`HOST_RETEST_STEP`。

## 回滚点

若 host shape 证据不足，保留只读定位结果和 planning artifacts，不修改产品代码。若最小修复使 narrator/comment/unknown 边界失败，立即撤销本轮产品 diff，不触碰已接受的前置提交。

## 已确认根因

- 真实宿主加载出的 Character-like message shape 为 `is_user:false`、`is_system:false`、`extra.type:"assistant_message"`，该类型也存在于 SillyTavern 的 `system_message_types`。
- OLD 的 `isCharacterMessage` 忽略 `extra.type`，接受该消息；CURRENT 的统一 helper 将任意未知非空 type 判为 `other`。
- CURRENT 在 `captureLifecycleSnapshot` / `resolveFloorAtIndex` 的 Character owner 判断处首次分叉，随后抛出 `NO_CHARACTER_FLOOR`，没有进入 generation settle、scheduler counter 或 due。
