# 推演阶段批量生成与保存性能修复

## Goal

将同一推演阶段的候选、证据以及 ST 投递回执统一计算并通过批量 Projection Floor 事务保存，减少重复数据收集和宿主读写，同时保留完整版本与读回保护。

## Requirements

- 内置受孕前推演必须继续从一次确定的当前业务快照生成，不改变候选内容、时间段、人物隔离、Aggregation 约束或 UI DTO。
- 同一轮生成的 Projection creation 与 evidence 必须先在内存中完成校验和追加，再通过一次 Projection owner Floor patch 保存。
- 同一轮上下文投递的 delivery submission，以及同一轮正文完成后的 delivery response，必须先在内存中汇总，再分别通过一次专用批量接口保存；不得按 Projection 逐条触发宿主保存。
- 同一次正文成功后的回执观察、超时判断和推演生成应共享一份全量业务快照与 delivery 读取；只有超时关闭改变业务状态时才允许重新读取。
- 同一轮 Projection 的删除升级、事实状态变化和超时过期记录应先在内存汇总，再按语义类别通过一次生命周期批量接口保存；不得逐条触发宿主保存。
- 内置候选不调用 AI；其逐条生成过程不得重复执行完整 `collectInputs()`。批量提交前保留一次完整的当前输入比对。
- AI Projection 继续保留请求前/响应后的 stale guard；本任务不以性能为由削弱网络请求期间的失效保护。
- 批量持久化必须继续经过现有 Floor Persistence Coordinator，保留 Character owner、Chat、active Swipe、完整六字段 Floor Version、sibling preservation 和 authoritative readback。
- 批次校验或持久化冲突必须 fail closed；同一 Floor 不得留下半批 creation/evidence。
- 最终 Projection readback 与 Context/UI 刷新仍只在持久化完成后进行。
- ST 正在生成正文期间，BioWeave 不启动任何自动业务计算、Projection 生命周期处理、Tracking/超时判断、Floor 保存或 Projection Context 重算；这些工作必须等生成结束并确认最终 Character Floor 后统一执行。
- 普通 `CHAT_CHANGED`（仅进入已有角色卡/已有聊天）只承担切换当前 Chat、清理旧 Context、加载当前已有数据和刷新显示的职责；不得因为进入角色卡就启动 Projection process、Projection lifecycle tick、Tracking/超时持久化或完整自动恢复，也不得调用 AI。需要恢复主楼 Context 时，只能在当前 Chat 稳定后基于当前有效 Floor 的既有结果做一次合并刷新；若期间进入正文生成，则延后到生成 settle 后。
- 批量 delivery 写入继续使用现有 Floor Persistence Coordinator；精确重复不产生额外宿主写入，批量校验失败不得部分落盘。
- 不修改 Lifecycle 的业务判断与状态语义、`storage/floor-persistence-coordinator.js`、Projection 候选文案、Event、Tracking 领域规则或 UI；只调整自动计算与 Host 生成生命周期的执行顺序。

## Acceptance Criteria

- [x] 两个人物各四条内置候选时，生成八条 Projection，只调用两次完整 `collectInputs()`：初始快照一次、批量提交前一次。
- [x] 同一轮全部 creation/evidence 只调用一次批量持久化，并只产生一次 `saveFloor()`/authoritative readback。
- [x] 批量完成后最终 timeline 同时包含全部 creation 与对应 evidence，既有 Context/UI 输出不变。
- [x] 任一 batch record schema 无效、Floor Version stale、Chat/Swipe/owner 不匹配或 append conflict 时零写入。
- [x] 精确重复批次保持幂等，不产生重复记录或额外 Host 写入。
- [x] AI Projection 仍执行请求前与响应后 stale guard，内置候选路径不调用 Analyzer。
- [x] 23 条待回执 delivery submission 或 response 分别只调用一次批量持久化；精确重复为 no-op，非法或 stale 批次零写入。
- [x] 同一轮多条 Projection lifecycle deletion/factual/expired 记录按语义类别各只调用一次批量持久化；精确重复为 no-op，非法、stale 或 conflict 批次零写入。
- [x] 正文成功后的回执观察、超时判断和推演生成共享一次业务输入与 delivery 快照；无生命周期变化时复用最终 Projection views 刷新 Context。
- [x] ST 生成期间不触发自动推演、Tracking/超时计算、Projection 保存或 Context 重算；生成结束并确认最终 Character Floor 后合并执行一次；生成期间暂存的消息/Swipe/Chat 事件在结束后按当前 Chat 重放一次，旧 Chat 事件丢弃。
- [x] 只进入已有角色卡而不生成正文时，仅发生当前 Chat 重新绑定、旧 Context 清理、已有结果恢复和 UI 刷新；不产生 Projection/Tracking/Lifecycle Floor 写入、不调用 Projection process 或 AI；切换过程中若马上开始生成，恢复任务被合并到生成结束后的单次 handoff。
- [x] 受影响测试和完整 `npm run check` 已通过；真实 SillyTavern 阶段切换耗时仍作为宿主验收项保留。

## Notes

- 当前证据：两人物共八条内置候选会触发 25 次完整输入收集；每条 creation/evidence 分开保存时正常产生 16 次 Floor transaction。真实 ST 阶段切换还曾在 15 条上下文投影上产生 23 次逐条 delivery Floor transaction，耗时约 332 秒。
- 本任务是观察周期业务任务的独立子任务，仅修复 Projection 生成/持久化性能，不改变领域规则。
