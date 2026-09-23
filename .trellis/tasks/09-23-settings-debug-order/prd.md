# 调整设置页调试分组顺序与内容

## Goal

删除 Story Time 调试折叠栏，并将高级 / 调试分组移动到设置页底部。

## Requirements

- 保留现有设置项和调试功能，不修改数据、事件或持久化契约。
- 将“高级 / 调试”折叠栏移动到设置页最底端。
- 删除设置页底部独立的“Story Time 调试”折叠栏；Story Time 调试内容继续由“高级 / 调试”内部承载。
- 同步调整受影响的 UI 回归测试与本 task 文档。

## Acceptance Criteria

- [x] 设置页折叠栏顺序中“高级 / 调试”为最后一个分组。
- [x] 设置页不再渲染 `story_time_debug` 独立折叠栏。
- [x] “高级 / 调试”内部现有分析预览、诊断和 Story Time 调试内容保持可用。
- [x] 相关 Node 测试通过。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
