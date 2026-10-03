# 实施执行计划

1. 读取 `trellis-before-dev`、适用 frontend specs、现有 AGENTS 与当前 dirty state。验证：生产修改前规则完整。
2. 新增并测试 device-local storage resolver。验证：显式 storage、host window、document defaultView、global fallback 优先级。
3. 修改 `index.js` 显式传递 document/window/storage context；修改 App Theme 读写诊断。验证：App/Launcher 使用相同 host realm，旧 Desktop 默认路径不变。
4. 修改 Launcher reclamp 为 transient-only，并保留独立 durable position 基准；保留 pointerup durable save 与 pointercancel no-save。验证：resize 不改变 storage，连续 shrink/expand 仍从原 durable value 重新 clamp。
5. 添加最小 focused tests，必要时同步 UI/data lifecycle contract。验证：docs 只描述最终已实现事实。
6. 运行 focused tests、完整 `npm test`、syntax check、`git diff --check`，并检查 failure identity 与 scope。

## 预期命令

- `node --check` 及所有修改后的 JS：语法检查。
- `node --test tests/ui.test.js tests/floating-launcher.test.js`：focused 回归测试。
- `npm test`：完整回归测试。
- `git diff --check`：空白检查。
- `git diff -- ui/app.js floating-launcher.js index.js core/device-local-preference.js tests docs`：确认范围。

## 明确禁止

不运行 `git commit`、`git push`、`git reset`、`git clean`；不修改 Floor、World、Story、Event、Prompt、archive、role normalization 或 chat persistence。
