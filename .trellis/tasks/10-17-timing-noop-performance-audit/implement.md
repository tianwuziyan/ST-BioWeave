# 执行计划（审计模式）

本任务不进入实现阶段；以下是已执行/待交付的审计步骤，不是生产代码修改计划。

## 已执行

1. 保留现有 worktree 状态，确认当前分支与既有未跟踪任务目录未被改动。
2. 读取适用的 `AGENTS.md`、Floor State Ownership Contract、架构文档和生命周期约束。
3. 检查 Timing 编辑器的 draft、保存和错误 reconciliation 路径。
4. 检查 Timing、Aggregation Storage 与共享 Coordinator 的 owner、队列、no-op、官方 I/O 和 readback 阶段。
5. 检查 Event、World、Character、Tracking、Config、Projection 及其他 Floor 写入入口。
6. 对照现有测试的官方 I/O count、local save count、stale、Swipe、并发和 partial-success 断言。
7. 解析三个真实宿主 Debug 文件，只把其中可归因的 Timing 操作列为 `H` 证据。

## 报告步骤

1. 先给出现状和三种 no-op 的定义，避免把 UI equality 当成 authority equality。
2. 给出当前 Timing + Aggregation 完整调用链和每个 GET/SAVE 的数据与不变量。
3. 给出跨模块写入目标、事务边界、等待语义和请求数字；不确定处标 `UNKNOWN`。
4. 对方案 A/B/C/D 做收益、正确性、并发窗口和测试前置条件比较。
5. 对现有测试逐项标记覆盖、部分覆盖或缺失。
6. 仅提出审计结论和分级建议，不实施优化。

## 验证

- 不新增测试、不修改生产逻辑，因此本轮不运行新增测试用例。
- 对新增 Markdown 执行 `git diff --check`。
- 最终复查 `git status --short`，确认既有生产/测试改动及 `.trellis/tasks/10-15-nsfw-auto-aggregation-diagnostics/` 仍然保留。
