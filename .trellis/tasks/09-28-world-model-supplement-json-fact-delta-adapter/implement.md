# 实施计划

1. 读取当前 task/spec 与工作区 diff，确认不覆盖既有修改。
2. 在 `ai/world-supplement-protocol.js` 增加 JSON extraction、root envelope 和 per-Fact adapter；保留现有 text parser 供迁移兼容测试，不改变 Resolver IR。
3. 在 `ai/prompts.js` 改造 Supplement request topology，显式分隔 analyzer control、permitted evidence、Existing、Targets，并切换 JSON Fact Delta contract。
4. 在 `ai/analyzer.js` 接入 JSON adapter；保留 accepted Fact、resolver、Evidence Guard、coverage mapping 和 identity summary 的既有边界。
5. 在 `ai/client.js` 设计/接入显式 JSON-mode capability 注入；未知时不发送 `response_format`。
6. 在 `runtime/world-analysis.js` 或其现有 retry ingress 中仅增加 root FORMAT_RETRY 分类/隔离；不改变 completeness/continuation retry。
7. 增加 generic regression tests：per-Fact fail-soft、accepted-Fact coverage、identity/fact independent failure、request topology、JSON mode fallback、retry separation。
8. 运行定向测试、静态检查和完整相关测试；检查 `git diff`、`git status`，确认无 persistence/UI/Frozen layer 意外修改。
9. 完成后停止，不 commit/push/reset/clean。
