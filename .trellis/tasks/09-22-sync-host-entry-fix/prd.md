# 同步 Host Entry 隔离修复到 GitHub

## 目标

将当前工作区已完成的 BioWeave Host Entry 隔离修复，以准确的中文提交同步到当前分支的 `origin` 远端。

## 范围

- 仅包含当前工作区中与 Host Entry、Projection Context fail-closed、Runtime 初始化边界、回归测试和 DEVELOPMENT 文档相关的变更。
- 提交前通过现有自动化测试、语法检查和 `git diff --check`。
- 不修改其他未授权文件，不执行 reset、clean、rebase 或 force push。

## 验收条件

- 工作区 diff 与目标变更范围一致。
- `npm run check`、`node --check` 和 `git diff --check` 通过。
- 使用中文 commit message 提交变更。
- 当前分支成功推送到 `origin/fix/world-model-prompt-baseline`。
- 推送后远端 HEAD 与本地提交一致，并报告提交 SHA。
