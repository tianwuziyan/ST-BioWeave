# 同步已确认的清理变更到 GitHub

## Goal

核对已确认的 BioWeave cleanup 变更，执行检查，提交并推送当前分支；严格限定现有 5 个代码与文档变更。

## Requirements

- 仅同步当前已确认的 5 个变更：`README.md`、`docs/DEVELOPMENT.md`、`core/projection.js`、`context/builder.js` 删除、`utils/helpers.js` 删除。
- 提交前检查工作区差异、语法/项目检查结果和 Git diff 范围。
- 使用中文提交说明，不修改其他模块，不创建额外重构。
- 推送当前分支 `fix/world-model-prompt-baseline` 到 `origin`。

## Acceptance Criteria

- [ ] 提交内容仅包含上述 5 个目标变更及本 task 记录。
- [ ] 现有检查已执行，结果已记录。
- [ ] 提交成功且当前分支已推送到 `origin`。
- [ ] 推送后工作区无未预期的同步变更。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
