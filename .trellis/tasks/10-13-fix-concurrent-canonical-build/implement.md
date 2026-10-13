# 实施计划

1. 读取当前 `runtime/event-analysis.js`、runtime 测试 seam 与现有 diagnostics，确认可复用的代际/失效信号和调用方引用边界。
2. 先在现有 runtime 测试 seam 增加并发失败测试：相同代际合并、旧 Snapshot commit 后不合并、选项隔离、失败清理。
3. 实现最小 in-flight 派生构建合并；不改变 `collectActiveBusinessData()` 的外层参数和业务 DTO。
4. 接入 Event commit/readback、Tracking 更新和 Chat/Swipe/Version/phase 变化的 invalidation；确认 stale guard 仍在原位置执行。
5. 添加有界性能诊断计数与耗时字段，检查 Debug export 不含正文/evidence/Prompt/API key。
6. 运行定向测试，检查 continuation 回归，再运行 `npm run check` 与 `git diff --check`。
7. 审查实际 diff，确认只修改必要 runtime/test 文件；检查相关 Markdown 是否仍准确，本任务不应需要产品文档更新。

验证重点：

- A/B/C 同代际只执行一次派生构建；
- A 旧 Snapshot 构建期间 commit，B 新代际不 join A；
- 任一构建失败后可重新构建；
- `includeDebug`、`route`、`reason` 不共享错误的 DTO/诊断；
- 业务 Event、Tracking、Projection 结果和 Floor 66 → 68 continuation 不变。

禁止：生产行为之外的 UI refresh 合并、排序优化、Schema/Prompt/continuation/Scheduler 修改、commit、push、reset、stash、切换分支。
