# 还原人物健康弹窗 v3 视觉结构

状态：执行中

## Goal

以 `work/character-health-popup-v3.html` 为视觉参考，只还原人物详情页现有 Character Health Popover 的视觉结构与样式。生产数据、业务语义、事件导航和 Health Read Model contract 必须继续来自当前仓库真实代码。

## Background / confirmed facts

- 当前生产入口位于 `ui/characters.js`：`healthViewModel()`、`renderHealthStatusButton()`、`renderHealthPopover()`、`renderHealthRecoveryStage()`、`healthSourceEventIds()`、`renderHealthSourceActions()`。
- 当前弹窗使用 `.bioweave-character-health-popover`，并由现有 `data-bioweave-action` 委托处理打开、关闭和来源事件导航。
- Current Health DTO 的 `grouped_issues`、`current_health_summary`、`severity_summary`、`health_observations[]`、`recovery_stage` 与 canonical `source_event_ids` 已存在，UI 只应消费这些字段。
- intervention 仍保留在 Event history，不进入当前 Character Health 弹窗。
- 当前代码的主要视觉差异是：来源操作仍在右侧列；issue 不是固定 `94px / minmax(0, 1fr) / 48px`；恢复阶段仍有“恢复阶段”标题并使用节点/连接器结构，不是三等宽连续温度计。
- `work/` 是用户已有未提交内容，不能删除、覆盖或纳入本次功能修改。

## Requirements

1. 只修改 Character Health Popover 的局部 HTML 结构与 CSS；优先修改 `ui/characters.js` 和 `style.css`。
2. 保持现有函数签名、Runtime DTO、Health Read Model、`data-bioweave-action`、canonical `event_id` 导航、打开/关闭/外侧点击/Escape 行为。
3. issue 使用固定三列：`94px minmax(0, 1fr) 48px`，`column-gap: 12px`；第一列展示 body_site、laterality、底部来源按钮；第二列展示中文当前身体问题标签、factual/current description 与可选恢复条；第三列只展示 severity。
4. 恢复条仅在有效 `recovery_stage` 为 `early`、`recovering`、`near_recovery` 时渲染；三个等宽阶段、连续单一渐变、统一未到达遮罩，不显示百分比，不渲染“恢复阶段”标题。
5. 用户可见文字使用中文，不显示 raw event id、Assessment ID、Floor Version、provenance、raw JSON 或 `health_role`。
6. intervention 不新增卡片、治疗列表、时间窗、治疗进度或图标依赖；底部最多保留弱职责说明。
7. 桌面端保持标题区域右上方 absolute popover；移动端为 `left/right/bottom: 10px` 的 fixed 底部浮层，不能产生页面横向滚动。

## Out of scope

不新增路由、Condition model、治疗关系图、intervention lifecycle、TTL/最近 N 天、Health Assessment、Health Evolution、Recovery Guidance、Floor/Snapshot/Projection authority、`eventContinuityKey`、Event persistence、自动调度、历史重分析、AI backfill、历史 Event rewrite、Health Manager/Popover Manager/UI Registry 或新的 UI/icon dependency。

## Acceptance criteria

- 健康按钮、关闭按钮、外侧点击、Escape 和来源事件导航行为保持现状。
- 桌面弹窗为 `position: absolute`、`top: 63px` 左右、`right: 12px`、`width: min(440px, calc(100% - 24px))`、`max-height: min(70vh, 520px)`。
- 移动弹窗为 fixed bottom sheet，`left/right/bottom: 10px`，`max-height: min(72vh, 560px)`，无横向溢出。
- 多行 description 不改变三列宽度；来源始终在第一列底部，severity 始终在第三列顶部。
- 同部位多个 observation 均保留；intervention 不进入弹窗；empty state 正常；缺失 recovery_stage 不显示虚假恢复条。
- 字体栈、颜色、边框、阴影、间距符合用户给定值，且不引入大面积纯黑/纯白或渐变背景。
- focused tests、`npm test`、`npm run check`、`node --check`、`git diff --check` 均执行并分别记录结果；无关既有失败单独列出。

## Open questions

无。用户已提供明确的视觉、行为和范围约束；剩余技术细节可由真实代码与测试验证。
