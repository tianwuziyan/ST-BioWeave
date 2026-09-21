# Redesign Floating Launcher Themes

## Goal

Redesign the BioWeave circular Floating Launcher with three selectable persisted color themes while preserving existing behavior, DOM contract, positioning, lifecycle, and business interfaces.

## Requirements

- 保留现有魔法棒入口、Floating Launcher 的 DOM、点击目标、拖动、定位、z-index 与生命周期行为。
- 使用同一份内联 SVG 表现中央圆、两段等粗圆弧和两个圆点；不使用参考 PNG 作为生产资源。
- 增加 `midnight-indigo`、`mist-violet`、`deep-teal` 三种主题，默认值为 `midnight-indigo`。
- 主题作为全局 `extensionSettings.bioweave` UI preference 保存，非法或缺失值回退默认主题。
- 设置控件复用现有 Settings 结构，修改后立即更新浮标，刷新后恢复。
- 不修改 Runtime DTO、分析、Projection、Floor、Snapshot、Tracking 或 Character 数据契约。
- 同步现有生命周期、UI 规范与项目说明文档。

## Acceptance Criteria

- [ ] 三种主题共用同一份 SVG/DOM，主题只切换 CSS 变量或主题属性。
- [ ] 设置可键盘操作，保存至现有全局设置，非法值安全回退。
- [ ] 既有 click/drag、位置、响应式约束、状态与 destroy 测试继续通过。
- [ ] 新增默认值、合法值、非法值、持久化与即时渲染切换测试。
- [ ] `node --check`、相关测试、`npm run check`、`git diff --check` 通过。
- [ ] 不提交、不推送；真实 SillyTavern 三端验收单独列出。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
