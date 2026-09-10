# 执行计划

1. 审查 `ui/settings.js` summary、preview 和 settingsPage，扩展 summary action 并迁移 preview 到 debug overlay。
2. 在 `ui/app.js` 增加临时 debug state、open/close、click/backdrop/Escape 事件路径，并在 close/destroy/route 边界清零。
3. 在 `style.css` 增加 dialog/header/body/backdrop 和移动端样式，保持主题与底部导航不变。
4. 更新既有 settings 静态测试，新增打开/关闭状态、preview 复用、Esc、overlay 内容/空白点击断言。
5. 运行 `node --test tests/ui.test.js tests/worldbook.test.js tests/world-model.test.js tests/api-profile.test.js`、`node --check ui/settings.js`、`node --check ui/app.js`、`git diff --check`。
6. 检查 diff 只覆盖 UI/CSS/测试，交给父任务进行第二阶段 Toast 改造前审查。

## 约束

- 不启动父任务，不实现 Toast，不修改 schema/prompt/Analyzer/storage。
- 不复制 `renderAnalysisInputPreview` 或 message builder，不添加拖拽/resize/持久化。
