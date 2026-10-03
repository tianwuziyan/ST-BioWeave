# 移动端 UI preference persistence 修复

## Goal

修复 BioWeave Theme 与 Floating Launcher 的 device-local preference persistence：统一 App/Launcher storage realm；Theme 在同一 host Window 下刷新后恢复；Launcher 用户 drag 位置持久化；viewport resize 只做 transient clamp，不覆盖 durable preference。

## Background

Desktop 上 Theme 刷新后保留、Launcher 跨页面切换后保留；Mobile 上 Theme 刷新后恢复默认、Launcher 页面切换后回到默认右上角；iPad 尚未验证。本轮实施小范围修复与回归测试，不改变业务状态边界。

## Requirements

### R1 统一 device-local storage realm

新增小型 helper，统一解析顺序：显式 `storageRef` → `windowRef.localStorage` → `documentRef.defaultView.localStorage` → `globalThis.localStorage` → `null`。`index.js` 显式向 App 和 Launcher 传递同一 `documentRef`/Window context。保持默认 Desktop 初始化行为及现有 DI 兼容性。

### R2 Theme persistence

保留 `bioweave_ui_theme` key。Theme 读写使用统一 storage boundary；写入后做轻量 read-after-write 验证。读写/验证失败不得阻止当前会话切换，不抛出阻塞错误，但使用统一 BioWeave namespace 记录最小诊断。

### R3 Launcher durable/transient position

保留 `FLOATING_LAUNCHER_POSITION_KEY` 和现有 absolute `{x,y}` 格式。用户 `pointerup` 完成 drag 时 durable save；`window.resize` / `visualViewport.resize` 只 clamp 当前 DOM 显示位置，不写 storage。mount 读取 durable position 后只显示 clamp 结果，不覆盖原值。`pointercancel` 保持不 durable save。

### R4 Tests

补充 Theme 与 Launcher 的 same-storage remount、realm precedence、读写失败、resize/visualViewport transient clamp、viewport shrink/expand、pointercancel 等测试；使用 390×844、393×852 和 820×1180 shaped viewport，不模拟真实 Safari。

### R5 Docs 与边界

仅在 contract 发生变化处同步 `docs/UI_FRAMEWORK.md`、`docs/bioweave-data-lifecycle.md` 或相关 `.trellis/spec`；明确 Theme 是 durable device-local preference，Launcher drag 是 durable position，viewport clamp 是 transient。不得触碰 Floor、World、Story、Event、Prompt、archive、role normalization。

## Constraints

- 不修改 Floor、World、Story、Event、Prompt、archive、role normalization 或 chat persistence。
- 不执行 commit、push、reset、clean；保护 unrelated dirty worktree。
- 保留旧 keys 与旧 absolute `{x,y}` 数据格式，不做 migration。
- 统一 resolver 仍只使用 device-local `localStorage`，不迁移到 SillyTavern settings、Chat metadata 或 Floor。
- Launcher 每次 viewport clamp 都必须以 durable stored `{x,y}` 为基准；不得以此前 transient-clamped DOM rect 作为下一次逻辑基准。
- Theme read-after-write 失败只记录诊断；当次 UI 仍保持用户选择，不回滚。
- 不引入 viewport bucket、edge anchor、normalized ratio 或 orientation-specific preference。
- 不记录聊天内容、API key 或用户业务数据。

## Acceptance Criteria

- [ ] Theme、Launcher 和 bootstrap 消费同一 storage resolver；显式 `storageRef` 优先级保持可用。
- [ ] Theme 写入后验证 readback；读写失败只记录诊断，不阻止本次 UI 切换。
- [ ] `pointerup` 保存 durable position；`pointercancel` 不保存；resize/visualViewport resize 不修改 durable storage。
- [ ] mount clamp 不覆盖 durable storage；viewport shrink 后 expand 可恢复原 durable absolute position。
- [ ] 新增 focused tests 通过，完整 `npm test` 结果与 baseline/current failure identity 有记录。
- [ ] `node --check`、`git diff --check` 通过；production diff 只包含本任务范围。
- [ ] 相关 Markdown contract 已检查并在必要时同步。
