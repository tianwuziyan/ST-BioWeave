# Technical Design: 单一 `floor.events` 完整状态语义

## Boundary

`floor.events` 是当前 Floor 保存的完整有效 Event 集合。Event 的 `source` 仍表示原始事实来源，Floor slot 的 `floor_version` 表示当前完整状态的 owner。

## Read path

从目标位置向前检查 Character Floor，验证当前 active Swipe、完整六字段 Floor Version 和合法 Floor slot，找到最近有效完整状态后直接返回该 Floor 的 `events`。新语义下不得 flatMap 多个历史完整状态。

本轮按用户确认不实现旧格式兼容或新旧格式标记；测试 fixture 全部使用完整状态语义。`events: []` 是明确空状态，必须与没有 Floor 状态记录区分。若现有 slot 结构无法区分，优先增加最小 presence metadata，不增加 Event 数据副本。

## Write path

- Event analysis：读取 previous complete events，与本楼 AI 结果按现有 ID/dedupe 规则合并，只写当前 Floor。
- Event update/delete：从当前完整状态修改，只写当前 Floor；不得定位原始 source Floor 后回写。
- 同一当前 Floor 再次操作时，基于该 Floor 已保存的完整 `events` 更新，避免重复追加。
- Coordinator 继续负责 owner、active Swipe、Floor Version、authoritative readback 和 sibling preservation。

## Downstream compatibility

- `getActiveFloorEvents` 必须先验证 Floor container owner，再返回完整事件，不能要求 inherited Event source 等于当前 Floor Version。
- Health Assessment 必须继续按 Event source 和 observation fingerprint 绑定；继承 Event 不重复 assessment，修改后 fingerprint 不得复用旧 assessment。
- Tracking 和 StateReducer 只消费当前完整集合。
- 旧的逐 Floor Snapshot Event replay 若会重复应用完整集合，必须关闭或改为正确的当前集合计算。
- MESSAGE_DELETED 的 owner/downstream invalidation 与 Event delete 的当前 Floor 写入保持分离。

## Risks

- 现有 Event source filter、Health Assessment timeline owner 校验和 Snapshot replay 都假设 Floor-local 增量，需要逐项调整。
- 不实现旧格式兼容意味着当前测试 fixture 与实现必须同步切换为完整语义；旧真实 Chat 数据不在本轮迁移范围。
- 自动化测试通过不代表 SillyTavern Host 验收完成。
