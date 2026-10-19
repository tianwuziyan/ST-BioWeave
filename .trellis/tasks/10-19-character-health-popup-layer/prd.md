# 修复人物健康浮层内部菜单裁剪

## Goal

修复健康浮层来源菜单被滚动容器裁剪的问题，并验证 Desktop/iPad/Mobile 层级与关闭交互。

## Requirements

- 保留现有健康浮层 DOM 结构、`role="dialog"`、`aria-controls` 和 `data-bioweave-*` 事件钩子。
- 修正滚动边界或浮层挂载层级，使来源菜单不再被健康浮层自身的 `overflow-y: auto` 裁剪；不能只依赖继续提高子元素 z-index。
- 保证健康主浮层仍高于人物详情中的普通事件内容，并保持 Desktop/iPad 下方定位、Mobile 底部定位。
- 不引入第二套 Modal、Backdrop 或宿主 Popup；不改变健康数据 DTO 和 source navigation 语义。

## Acceptance Criteria

- [ ] 来源菜单在列表底部打开时完整显示。
- [ ] 健康主浮层仍可通过再次点击、外侧点击和 Escape 关闭，Escape 优先关闭健康浮层。
- [ ] Desktop、Tablet、Mobile 的 CSS 规则无后置通用规则覆盖移动端定位。
- [ ] 相关 UI 定向测试与 `node --check` 通过。

## Out of Scope

- 不新增 Modal、Backdrop、宿主 Popup 或新的 UI 状态；不改变 Health DTO、source Event navigation 和关闭事件契约。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
