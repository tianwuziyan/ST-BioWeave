# 实施计划

1. 审计当前 UI 入口、Runtime Floor resolver/save、Analyzer Full/Patch、自动 update signal、Reuse 条件、in-flight/stale guard 与测试边界；确认不修改 StateReducer/Snapshot/Projection/schema/interval。
2. 在 Runtime 建立共享 `runWorldFullAnalysis` 与 `runWorldPatchAnalysis`；Manual/Auto 只选择调用它们。Full 不区分 Initial/Manual 两套实现，Patch 不区分 Manual/Auto 两套实现。
3. 接入 Auto 决策：无 World → Full；有 World 且需要 world-relevant 更新 → Patch；有 World 且无更新 → Reuse；只有 World 成功或 Reuse 后才 Character/Event。
4. 整合 World-specific Floor-Version single-flight，使 Manual Full/Patch、Auto Full/Patch 共用 registry，并验证 Full+Full、Patch+Patch、Full+Patch、Auto+Manual 不发第二个请求。
5. 将 `ui/app.js` 从直接 analyzer/save 改为两个 Runtime World-only 入口；区分 Full/Patch loading、disabled、失败保留和不触发 Event。
6. 将 `ui/world.js` 固定为两个按钮、指定 Tooltip、无 World 时 Patch disabled。
7. 增补测试：
   - UI 两按钮、文案、Tooltip、无 World disabled、Full/Patch loading；
   - Manual Full 无/有 World 都调用 Full、不调用 Patch/Character/Event；
   - Manual Patch 仅有 World 时调用 Patch，deterministic merge 保留旧字段，不调用 Full/Character/Event；
   - Auto 无 World/有更新/无更新分别验证 Full/Patch/Reuse 与后续 Character/Event 顺序；
   - 失败保留原 World、历史 Floor immutable、User-only 不持久化；
   - 重复点击、交叉操作、Auto+Manual single-flight，以及 Chat/Floor/Swipe/version stale 丢弃。
8. 同步 World/UI/pipeline 文档：内部区分 Initial Full、Manual Full、Auto Full 的触发场景但明确三者共用 Full；Manual/Auto Patch 共用 Patch；Auto 另有 Reuse；UI 仍只显示两个短按钮。
9. 运行 `npm test`、`npm run check`、所有变更 JavaScript 的 `node --check`、`git diff --check`，并检查 diff 未触及 out-of-scope 文件。

## 计划修改文件

- `runtime/event-analysis.js`：共享 Full/Patch 能力、Auto Full/Patch/Reuse 选择、World single-flight/stale/persistence 和 Runtime 导出入口。
- `ui/app.js`：Manual Full/Patch 转发、operation/loading/error 状态，不再直接调用 Analyzer/save。
- `ui/world.js`：两个固定按钮、disabled 状态、文案和 Tooltip。
- `tests/event-analysis-runtime.test.js`：Runtime World-only、Auto 选择、Floor/stale/single-flight/历史不可变。
- `tests/ui.test.js`、`tests/world-model.test.js`：按钮、Tooltip、disabled/loading 与 Manual API 路由。
- 相关 World/UI/pipeline 文档：同步 Full/Patch/Auto Reuse 正式定义。

## 风险与回滚点

- 最大风险是接入共享能力时误触 Character/Event；用调用计数和顺序测试守住边界。
- 不得把“已有 World”简化为“必然 Patch”；必须保留 world-relevant update required 与 Auto Reuse。
- 不得以 UI busy 代替 Runtime registry；所有 World API/write 互斥必须在 Runtime。
- 每阶段检查 `git diff --stat`、`git status --short` 和本任务路径，保留既有 dirty files。
