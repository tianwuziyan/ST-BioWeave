# World Model fixture 污染清理实施计划

## Ordered checklist

1. [x] 在开始改代码前读取 `trellis-before-dev` 及 frontend 相关规范，确认本轮文件边界和现有测试契约。
2. [x] 重写 `ai/prompts.js` 的 World Model core/output instructions，保留 schema 接口、Human baseline 边界、Nonhuman Evidence Gate、开放 type 和 fertilization 语义，删除重复表述及任何具体世界先验。
3. [x] 清理 `ai/analyzer.js`：删除 fixture species aliases、fixture type 分支和 `男剑灵`/`女剑灵`；将 species 关联收敛到当前 exact 名称；保留通用结构过滤、必要的否定/互动/个体隔离和 type-local field evidence。
4. [x] 确认 `fieldEvidenceUnits()` 与 `sanitizeNonHumanType()` 没有 `typeCount` 或 species-wide fallback；增加单一原创 type 的反吸收回归。
5. [x] 实现仅适用于已由当前输入支持的 Human Male/Female fallback：Male/Female 分离，Male 不继承女性规则，其它 Human type 与所有 nonhuman type 不继承。
6. [x] 保留并整理 final consistency guard，验证 false/null 区分、受精 donor/recipient 冲突和 Human Male pregnancy world override。
7. [x] 增加/改写 unknown-world-first World Model 测试和生产污染静态 regression；将依赖历史 fixture aliases 的测试改成 generic/original species 语义。
8. [x] 如实现契约发生变化，更新 `.trellis/spec/frontend/state-management.md` 中的 fixture-specific 例子为通用表达；不触碰 schema、AnalysisInput、API、storage、UI 和其它模块。
9. [x] 运行定向测试、全项目测试、`npm run check`、修改 JS 的 `node --check` 和 `git diff --check`。
10. [x] 检查 `git diff`/`git status`，确认没有替代性 hardcode、依赖变化或无关文件，再提交并归档任务。

## Validation commands

```bash
node --test tests/world-model.test.js
npm test
npm run check
node --check ai/analyzer.js
node --check ai/prompts.js
node --check tests/world-model.test.js
git diff --check
```

## Review gates

- Prompt 中不得出现具体 fixture species/type 教学、例子或 alias。
- Analyzer 中不得出现 fixture-specific string comparison、alias list、registry 或 `男剑灵`/`女剑灵`。
- Human baseline 必须只作用于 Human Male/Female，且 baseline 不能覆盖非空 AI/world rule。
- Nonhuman type-local evidence 必须不使用 `typeCount === 1` 或等效 species-wide fallback。
- final consistency guard 必须继续处理 false capability 冲突，且 null capability 保留独立 rule。
- schema、AnalysisInput、API、Chat storage、Runtime、World UI 没有 diff。
- 新测试使用原创 species 名称，静态 regression 只扫描 `ai/prompts.js` 和 `ai/analyzer.js`。

## Rollback points

- Prompt rollback：只恢复 `ai/prompts.js` 的 Prompt 文本，不回退 schema 或请求链路。
- Evidence rollback：只回滚 exact species/type evidence 关联和 generic duplicate predicate，不恢复任何 fixture alias。
- Baseline rollback：只撤销 Human fallback，不影响非人类 Evidence Gate 或 final consistency guard。
- Test/doc rollback：只移除本任务新增断言或通用文档例子，不删除原有 World Model v1 合同。
