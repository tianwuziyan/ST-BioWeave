# BioWeave 完整 Floor Event 状态语义

## Goal

- 将新写入的 `floor.events` 统一为该 Floor 的完整当前有效 Event 集合。
- 不新增第二套 Event 状态、引用集合、Event revision 系统或 Chat-level 权威缓存。
- 新增、修改、删除均继承最近有效完整状态，并只写当前操作 Floor。
- 删除全部必须持久化明确的 `events: []`，不得回退读取旧状态。
- Event `source` 保留原始事实来源；Floor slot owner 与 Event source 分离校验。
- 读取从目标位置向前选择最近合法、当前 active Swipe、六字段 Floor Version 匹配的完整状态。
- 不实现 legacy_delta 兼容，不增加新旧格式标记，不迁移旧测试数据。
- 必须先诊断并修复两个现存 Swipe 测试失败。

## Requirements

- 2楼 `[A]`、6楼 `[A,B]`、8楼 `[B]`、10楼 `[B,C]` 及历史回退正确。
- 同一 Floor 连续修改只更新该 Floor，历史 Floor 不变。
- 当前 Floor 明确保存 `events: []` 后返回空状态且不复活旧 Event。
- Health Assessment、Tracking、StateReducer、Snapshot、MESSAGE_DELETED 和 Coordinator 语义保持正确。

## Acceptance Criteria

- [ ] 分阶段测试通过并记录 PASS/FAIL/NOT PROVEN。
- [ ] 两个 Swipe 测试根因已修复，未弱化断言。
- [ ] 自动化测试与 Real Host 验收明确区分。

## Out of Scope

- 不引入 `current_event_state`、Event reference set、Event revision 或 Chat-level authoritative cache。
- 不实现旧增量数据兼容或旧测试数据迁移。
- 不做无关功能重构、提交或推送。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
