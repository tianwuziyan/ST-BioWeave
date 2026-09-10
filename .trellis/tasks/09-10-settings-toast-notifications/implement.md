# 执行计划

1. 先读取 debug 子任务的已接受 diff，确认共享文件的当前基线和事件接口。
2. 在 `ui/app.js` 实现 notify helper，迁移设置操作的 success/info/warning/error 反馈，保留持续状态和错误可读性。
3. 调整 `persistAnalysisSettings`/来源 checkbox 保存完成路径，验证串行保存、立即勾选、滚动恢复和 stale Chat 保护。
4. 在 `ui/settings.js` 移除设置页顶部/worldbook card 的瞬时 notice 输出，保留 preview error 与其他持续组件状态。
5. 更新/新增 Toast、checkbox、规则上限、模型为空、提示词保存和失败回归测试。
6. 运行 `node --test tests/ui.test.js tests/worldbook.test.js tests/world-model.test.js tests/api-profile.test.js`、`node --check ui/app.js`、`node --check ui/settings.js`、`git diff --check`。
7. 交给父任务做全局 notice 搜索和完整 npm 回归。

## 约束

- 不改 debug overlay 结构以外的本次子任务范围，不修改 schema/prompt/Analyzer/storage。
- 不引入第三方 Toast UI，不删除 API test/preview/trace 等持续状态。
