# Audit Execution Plan

1. 读取当前架构、Floor ownership、World Model domain contract、相关历史 task 与 git baseline。
2. 从 producer root 建立完整 schema inventory，覆盖 live state、fact delta、history trace、request envelope、coverage、identity、collection、candidate/persistence/reconciliation/UI。
3. 追踪每个关键字段的 producer、retention、sanitizer/export、UI/test/spec consumer，并记录 owner/timepoint/cardinality/null semantics。
4. 单独证明 dynamic coverage 五字段语义，以及 `coverage_rounds` 的 production min/max；区分 retry 与 semantic continuation。
5. 审计同名 `final_result`、persistence fields、candidate IDs/fingerprints、request transitions、mutation nulls、latest delta duplication、status vocabulary。
6. 运行只读 focused tests/static checks，并记录测试对字段的实际依赖；不修改任何 product/test/spec/UI 文件。
7. 生成最终审计报告：A–L 全部章节、完整 inventory、Tier 建议、coverage/result-persistence recommendation、proposed v3 或不升级结论。

## Validation

- `node --test tests/world-model-debug.test.js tests/event-analysis-runtime.test.js tests/world-model.test.js`
- `node --check ai/analyzer.js runtime/world-analysis.js runtime/diagnostics.js runtime/events.js ui/app.js ui/settings.js utils/world-model-debug.js`
- `git diff --check`
- 最终 `git status --short` 确认无 production/test/spec/UI 修改；报告注明真实 SillyTavern Smoke 仅采用用户提供基线，未在本轮重跑除非环境明确可用。

## Rollback / safety

禁止 `task.py start` 后执行生产实现；禁止 commit、push、reset、clean、restore。若审计发现 runtime bug，写入报告的单独 findings，不扩展实施范围。
