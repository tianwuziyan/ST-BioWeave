# 执行计划

## 顺序

1. 先启动并完成 `09-10-analysis-debug-dialog`：确认 summary action、debug overlay、状态/事件/CSS 与静态/交互测试。
2. 独立审查第一阶段 diff，确认未修改 schema、prompt、Analyzer guard、请求 builder 或 storage。
3. 再启动并完成 `09-10-settings-toast-notifications`：迁移设置瞬时反馈、保留持续状态、补 Toast/checkbox/提示词测试。
4. 父任务整合共享文件的 diff，搜索所有 `notice` 写入和 `.bioweave-settings-notice` 输出，修复遗漏或范围漂移。
5. 运行聚焦测试，再运行完整测试和语法/空白检查；最后做真实宿主验收记录。

## 实现清单

- [ ] 更新 settings summary 的受控 action 插槽，只在世界分析提示词项传入 debug button。
- [ ] 从设置页移除非 standalone preview，加入 hidden/open debug overlay，并继续传入真实 preview 参数。
- [ ] 增加临时 debug state、open/close helpers、backdrop click 与 Escape 优先级。
- [ ] 增加 notify helper，逐点迁移设置操作的 success/info/warning/error 反馈。
- [ ] 移除设置页顶部和世界书卡片的瞬时 notice 文档流输出，保留 preview/test/trace/World Model 持续状态。
- [ ] 对来源保存路径减少不必要的完成后 render，验证异步保存链和滚动恢复仍工作。
- [ ] 更新既有设置静态断言，新增 dialog/Toast/Esc/overlay/checkbox/prompt 回归断言。
- [ ] 对最终 diff 做业务边界搜索和文件级变更汇总。

## 验证命令

### 聚焦

```bash
node --test tests/ui.test.js
node --test tests/worldbook.test.js
node --test tests/world-model.test.js
node --test tests/api-profile.test.js
node --check ui/settings.js
node --check ui/app.js
```

### 完整

```bash
npm test
npm run check
node --check ui/settings.js
node --check ui/app.js
git diff --check
```

### 范围审查

```bash
rg -n "analysis_preview|settingsState\.notice|analysisSourcesState\.notice|bioweave-settings-notice|buildWorldModelMessages" ui tests
git diff --stat
git diff --name-only
git diff -- storage/schema.js storage/store.js ai/prompts.js ai/analyzer.js
```

## 风险点和回滚点

- `ui/settings.js` summary/action/overlay 拼接：先跑静态 HTML 测试。
- `ui/app.js` click/keydown/backdrop 与异步通知：先跑 UI helper/Toast 测试，再跑设置相关测试。
- `style.css` fixed overlay 和 mobile media：需记录 Node 检查无法替代真实 SillyTavern Desktop/Tablet/Mobile smoke。
- 任何 schema、prompt、Analyzer、storage 或真实 builder diff 都是越界，必须在接受前撤回/停止。

## 完成门槛

- 两个子任务各自 acceptance 全部满足，且父任务完整回归通过。
- `node --check`、`npm test`、`npm run check`、`git diff --check` 均有实际结果。
- 报告修改文件、Toast 替换点统计、新增测试、聚焦/完整结果和待宿主验收项。
