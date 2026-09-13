# 同步 Event participant 生物身份上下文到 GitHub

## Goal

审计当前已验证的本地 worktree，提交并推送本轮 Event participant biological_context 合同、Analyzer 校验、测试与文档修改。

## Requirements

- 审计当前 worktree，只同步本轮已完成并验证的 Event participant `biological_context` 合同、Analyzer DTO 校验、测试、领域规范与相关文档。
- 提交信息使用简体中文，并以实际 staged diff 为准；不纳入无法归属本轮的其它改动。
- 将当前分支 `fix/world-model-prompt-baseline` 推送到已配置的 `origin` 同名分支。
- 不执行 reset、restore、clean、rebase、merge、amend、改 remote 或其它破坏性 Git 操作。

## Acceptance Criteria

- [ ] staged diff 仅包含本轮 Event participant 生物身份上下文相关修改及其必要 Trellis 任务记录。
- [ ] 提交前通过 `npm run check`、`git diff --check`，修改的 JavaScript 通过 `node --check`。
- [ ] 提交成功，且提交信息具体说明 participant `biological_context` 合同、Analyzer 校验、测试与文档同步内容。
- [ ] 推送后远端目标分支 SHA 与本地 HEAD 一致。
- [ ] 推送后 worktree 无未处理的本轮改动；不进入 Phase 2B。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
