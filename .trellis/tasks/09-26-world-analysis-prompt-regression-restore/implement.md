# Documentation Execution Plan

1. 完成历史提交与当前 HEAD 的 semantic regression archaeology；记录文件、commit、关键行为和证据位置。
2. 审阅当前 canonical World Model spec、Supplement design、Prompt context 与 tests 的现有合同，区分已保留、语义弱化、已丢失、被更好设计替代和旧 hack。
3. 在本 task design 文档加入正式 `World Analysis Prompt Regression Matrix`，覆盖用户要求的全部规则及其 generic regression coverage。
4. 更新 `.trellis/spec/domain/world-model.md`，冻结通用语义不变量、执行顺序、Full/Supplement 关系、Empty Patch 语义和 Structural Reclassification 独立 gap。
5. 如且仅如发现直接冲突，同步 `docs/CONTEXT-AND-PROMPT.md`；否则在最终报告说明无需修改。
6. 运行文档级验证：`git diff --check`、生产代码/测试路径变更扫描、矩阵条目完整性扫描；不运行或修改测试，不修改生产代码。
7. 最终核对 `git status` 与 diff，确认只修改允许文档，报告 RESTORE/STRENGTHEN/KEEP/DO NOT RESTORE、其它 regression、结构纠正 gap 和未决 REVIEW REQUIRED。

## Allowed writes

- `.trellis/spec/domain/world-model.md`
- `.trellis/tasks/09-26-world-analysis-prompt-regression-restore/design.md`
- `.trellis/tasks/09-26-world-analysis-prompt-regression-restore/prd.md`
- `docs/CONTEXT-AND-PROMPT.md` only if directly conflicting

## Forbidden writes

`ai/`, `runtime/`, `core/`, `storage/`, `ui/`, `tests/`, schema/validator/merge implementation, unrelated docs, commits and pushes.
