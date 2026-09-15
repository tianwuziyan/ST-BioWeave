# Event DTO location contract 执行计划

## Ordered checklist

1. 记录当前 worktree 基线，确认本任务目录与其它未提交改动不重叠；复查 `ai/prompts.js`、`ai/analyzer.js`、`core/events.js`、Runtime 保存失败路径和相关测试。
2. 执行 `task.py start` 前完成本计划审核；开始执行后加载 `trellis-before-dev`，读取 domain spec 与已核对的 UI framework contract。
3. 在 `EVENT_ANALYZER_OUTPUT_CONTRACT` 加入明确的 `location: string | null` 规则、`location_alpha` / `null` 示例和 object/array 禁止项；不得改动其它既有 Prompt contract。
4. 增加最小回归：Prompt 文本、双 subject 字符串地点、null、object strict rejection、Runtime invalid raw response 保留旧成功结果/Registry、人物页双 subject 输入。
5. 运行本轮修改 JS 的 `node --check`；按仓库要求立即执行本地 Prettier，仅格式化本轮修改文件，并在成功前停止后续 Git 操作。
6. 运行针对性测试，再运行 `npm run check`、`git diff --check`；检查实际 diff，确认未修改 `core/events.js`、`core/tracking.js` 或生产 UI。
7. 使用 `trellis-check` 做最终规范、跨层契约和测试审查；本任务不执行 commit、push 或发布。

## Validation commands

```bash
node --check ai/prompts.js
node --check ai/analyzer.js
node --check tests/event-analysis.test.js
node --check tests/event-analysis-runtime.test.js
node --check tests/phase2a-ui.test.js
npm test -- tests/event-analysis.test.js tests/event-analysis-runtime.test.js tests/phase2a-ui.test.js
npm run check
git diff --check
```

针对 `npm test` 的参数是否被 Node test runner 接受，以仓库实际脚本结果为准；必要时直接运行 `node --test` 对上述文件做等价定向验证，但最终仍须运行完整 `npm run check`。

## Review gates

- Prompt 只新增 location contract，不把 object 示例留在输出契约中。
- Analyzer 仍拒绝 object/array；不增加 Core 兼容字段。
- 双 subject 成功路径证明 `events`、`tracking_subjects`、`character_profiles` 均保留两个对象。
- 失败路径证明 schema failure 不会部分提交新 Event，也不会覆盖旧成功 Registry。
- UI 仅新增测试输入验证；生产 UI、Tracking eligibility 和 subject-local Event 代码没有本轮变更。
- Prettier 成功后才允许继续测试和 diff 审查；不 commit、不 push。
