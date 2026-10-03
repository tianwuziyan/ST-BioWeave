# 技术实施设计

## 边界

只修改 `ui/app.js`、`floating-launcher.js`、`index.js`、一个小型 device-local storage helper、相关测试和必要 contract 文档。不得建立大型架构或修改业务 persistence。

## 设计

1. `resolveDeviceLocalStorage({documentRef, windowRef, storageRef})` 是唯一 realm 解析规则；返回 storage 或 `null`，不访问业务数据。
2. `createApp` 保存 `documentRef`/`windowRef`，storage 由 helper 解析；`index.js` 将同一 host context 显式传给 App 与 Launcher。
3. Theme `readTheme`/`writeTheme` 通过 helper；write 后 readback，失败使用 `console.warn` 或 `console.debug` 的统一 BioWeave 前缀。
4. Launcher 将 durable position 保存在内存中的 last durable position，并将 `applyPosition` 的持久化语义收敛为明确的 durable user save 与 transient clamp；`reclamp` 永不写 storage。
5. Launcher mount 读取旧 absolute `{x,y}` 作为 durable 基准；每次 viewport 变化都从该基准重新 clamp，只更新显示位置，不迁移、不改 key，也不把 transient DOM rect 写回基准。
6. Theme read-after-write mismatch 只诊断，不回滚本次 `root.dataset.theme`。
7. 测试使用独立 host document/window storage，验证 App 与 Launcher identity 和显式 DI 优先级。

## 兼容性与风险

- 保留 `bioweave_ui_theme`、`FLOATING_LAUNCHER_POSITION_KEY` 和旧 `{x,y}` 数据。
- `pointercancel` 仍不保存，避免把中断手势当成用户确认。
- storage failure 仍 best-effort，但不再完全静默。
- 暂不引入 viewport bucket、anchor、ratio、orientation-specific preference。

## 回滚/安全

实现前再次检查 dirty worktree；只使用 `apply_patch`，不执行 commit/push/reset/clean。若测试揭示超出本任务的 host lifecycle 问题，保留当前修复并报告，不扩展到业务层。
