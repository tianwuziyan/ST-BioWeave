# 关闭 BioWeave 时隐藏浮动图标

## Goal

当角色卡对应 Chat 的 BioWeave 开关关闭时，不显示顶端拖动栏右侧的浮动图标，并在开关切换后保持同步。

## Background / Confirmed Repository Facts

- Chat-local 主开关使用现有 `settings.enabled`，由 Runtime 的 `getBioWeaveEnabled()` / `setBioWeaveEnabled()` 管理；不得新增第二个启用字段。
- `floating-launcher.js` 当前只根据全局 UI 偏好 `show_floating_launcher` 挂载或卸载图标；它不直接依赖 Runtime、Storage 或业务层。
- `runtime/events.js` 已在主开关变化后发出 `BIOWEAVE_ENABLED_CHANGED`，Chat 切换使用 `CHAT_CHANGED`；UI 已订阅 Runtime 事件。
- `index.js` 负责把 UI 和 Runtime 连接到 Floating Launcher；现有 `onUiPreferencesChanged` 只同步全局浮动图标偏好。
- 现有全局 `show_floating_launcher` 语义必须保留：即使 Chat 已启用，用户关闭该偏好时仍不显示图标。
- 当前 worktree 存在与本任务无关的未提交 Trellis 会话摘要；本任务不得覆盖或清理它。

## Requirements

### Visibility contract

- Floating Launcher 只有在当前 Chat 的 BioWeave `enabled !== false` 且全局 `show_floating_launcher !== false` 时显示。
- Chat 关闭时立即卸载浮动图标及其监听器；Chat 重新启用时，按现有全局显示偏好立即恢复。
- Chat 切换后按新 Chat 的 `settings.enabled` 重新计算可见性；不得把上一个 Chat 的启用状态带到新 Chat。
- 关闭 Chat 主开关不修改浮动图标全局偏好、图标位置、主题或任何业务/Floor 数据。

### Boundary and compatibility

- 复用 Runtime 现有 `getBioWeaveEnabled()` 与事件通知；不新增持久化字段、Chat/Floor 字段、Registry、业务 DTO 或 Runtime 事实源。
- 保持 Floating Launcher 的 Host/UI 边界：`floating-launcher.js` 通过回调/偏好接收已解析的状态，不 import Runtime、Storage、Event 或 Floor 模块。
- 保持顶栏主开关、Settings 中的全局浮动图标开关、点击/拖动/键盘行为和现有生命周期清理不变。
- 由于这是用户可见 UI 行为变化，需同步现有权威说明：`README.md`、`docs/UI_FRAMEWORK.md`、`docs/ui-framework.config.json`、`docs/UI_FRAMEWORK_EXAMPLE.html`；若生命周期说明仍会误导，再同步 `docs/bioweave-data-lifecycle.md`。

## Acceptance Criteria

- [x] 当前 Chat 的 `settings.enabled === false` 时，初始注册不创建 `bioweave-floating-launcher`。
- [x] Chat 从启用切换为关闭后，浮动图标立即移除；从关闭切换为启用后，图标按 `show_floating_launcher` 恢复。
- [x] Chat 切换到关闭的 Chat 时图标隐藏，切换到启用的 Chat 时图标恢复；不存在跨 Chat 状态串用。
- [x] `show_floating_launcher === false` 时，无论 Chat 是否启用都不显示；重新启用 Chat 不会覆盖该全局偏好。
- [x] 图标隐藏时其 Pointer/Keyboard/resize/activity 监听器被清理，重新显示后仍可点击、拖动并接收活动状态。
- [x] 测试覆盖 Floating Launcher 可见性组合、动态更新和 Chat/Runtime 事件同步；现有浮动图标和主开关测试不回归。
- [x] 相关 Markdown / UI contract 文档只描述最终已实现的可见性门控，并明确全局 `show_floating_launcher` 仍是独立偏好、Chat `enabled` 不新增持久化字段。
- [x] 通过变更文件的 `node --check`、相关 focused tests、`npm run check` 和 `git diff --check`；真实 SillyTavern Desktop/Tablet/Mobile 视觉验收仍待宿主环境执行。

## Out of Scope

- 不改变 Chat 主开关本身的持久化、确认弹窗、Runtime guard、分析/追踪/Projection 语义。
- 不删除或重构现有全局 `show_floating_launcher` 偏好，不把它迁移到 Chat/Floor，也不新增“角色卡级别”独立存储。
- 不改变顶栏按钮是否可见、Settings 页面结构、图标样式、位置持久化、主题或业务数据清理行为。

## Implementation Status

- This is treated as a lightweight, narrowly scoped synchronization fix; PRD-only planning is sufficient.
- The final planning summary was approved and the implementation is complete.
- The task remains uncommitted because commit/publish authorization was not included in the implementation approval.

## Validation Record

- `npm run check`: 1860 passed, 16 skipped, 0 failed.
- `node --check floating-launcher.js`, `node --check index.js`, `node --check ui/app.js`: passed.
- `git diff --check`: passed.
- `docs/ui-framework.config.json` JSON parse: passed.
- Real SillyTavern Desktop/Tablet/Mobile visual acceptance: not executed in this session.
