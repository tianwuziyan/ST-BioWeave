# 执行计划：删除旧 Floor Event 跨 Floor 消失审计

## Phase 1：只读代码审计

1. 记录当前 worktree 状态，读取相关 domain/frontend spec，建立本 task 的文件/函数证据表；不覆盖用户已有修改。
2. 审计 UI 删除入口、Event target 定位、Floor Version 和 `event-delete-patch` 参数。
3. 审计 coordinator/store/adapter 的目标 slot 写入、official readback、host sync、confirmed 和 sibling audit；确认是否存在跨 Floor mutation。
4. 审计 `collectCurrentFloorStates`、`getActiveFloorEvents`、active Swipe/Floor Version resolver、invalidated map、latest/baseline/current Floor 边界。
5. 审计 canonical Event rebuild 到 UI read model/filter/render 的每个集合和计数，输出 A/B/C 或 NOT YET PROVEN。

## Phase 2：最小修复与回归验证

1. 已由代码审计和 failing regression test 证明第一处 divergence，无需增加 observation-only diagnostics。
2. 为 `invalidateMutation` 增加显式 `mutationScope`，将 `target-local` 与 `downstream-destructive` 分离。
3. 将 Event edit/delete 改为 target-local；保留真实 `MESSAGE_DELETED` 的 downstream cleanup。
4. 添加/运行 historical delete、same-Floor sibling、historical edit、active Swipe/Floor Version 和真实 message deletion 回归测试。

## Phase 3：报告与后续边界

1. 已完成根因修复：Event edit/delete 使用 `target-local`，真实 Host timeline mutation 使用 `downstream-destructive`。
2. 已完成真实 ST Host acceptance：后续 Events 保留，authoritative/canonical/UI event count 均为 7。
3. 检查并同步 `.trellis/spec/domain/floor-state.md` 的 Event-local mutation contract。
4. 运行 focused tests、Floor persistence tests、`node --check` 和 `git diff --check`；完整 `npm test` 的无关 Active Swipe / World prompt failures 不纳入本 task。
5. task 归档时使用 `task.py archive --no-commit`；不 commit、不 push。

## 验证命令（按实际变更调整）

- `npm test -- --test-name-pattern='event|floor|tracking|diagnostic'`
- `npm run check`
- `node --check <changed-runtime-file>`
- `git diff --check`

## 风险与回滚点

- 现有 worktree 有大量未提交 Health/Event/World 变更；只允许触及本 task 明确的 diagnostics/test 文件，审计和 diff 必须区分既有修改。
- `event_count=3` 可能只是 target/current-floor 计数，不能作为完整 history 证据。
- 若 observation DTO 过早进入产品 UI，会违反 debug/provenance 边界；默认只走 diagnostics。
- 如出现需要修改 persistence ownership、Health contract、scheduler 或旧数据的结论，停止并报告为 scope blocker。
