# Context-first Floor 持久化流程简化

## 目标

在不新增第二套生产 Writer、不过渡 Snapshot Schema、也不改变业务模块调用入口的前提下，简化现有 `Floor Persistence Coordinator` 的普通 Floor 写入路径：使用当前 SillyTavern Context 中的目标消息/active Swipe 作为内部 Floor 读取和合并来源，调用宿主原生 `saveChat()`，再执行一次官方 `/api/chats/get` readback。

## 必须保留的契约

- `storage/floor-persistence-coordinator.js` 仍是普通 Floor 写入的唯一生产协调入口。
- 校验 Chat ID、Message ID、Floor、Swipe ID、Content Hash、Message Version 和 epoch/当前执行状态；目标变化时 fail closed。
- 只更新本次 owner 允许的字段，保留其他 BioWeave root、其他扩展字段、消息正文、其他 Swipe 和历史 Floor。
- 保留 `projection_timing_snapshot` 与 `participant_aggregation_snapshot` 等现有 Schema 根名、继承和显式清空语义。
- Timing 与 Aggregation 仍是两笔独立逻辑事务，保留 Timing 成功/Aggregation 失败的部分成功语义。
- 保存失败、结果未知或 readback 不一致不能报告 `confirmed`。
- 外部标签页、设备和直接 API 的整 Chat last-write-wins 风险必须在报告中明确保留。

## 性能验收

- 单笔 changed：目标为 1 次官方 Chat SAVE + 1 次官方 Chat GET readback。
- Timing + Aggregation changed：两笔事务各 1 SAVE + 1 GET，合计 2 SAVE + 2 GET。
- Context local no-op：不修改 Context、不 SAVE、不为比较主动 GET；结果必须区别于权威 `confirmed`。
- 任何无法通过现有测试和当前宿主适配层证明的请求数量或安全性，标记为 UNKNOWN。

## 验证范围

补充 Coordinator、Store/Adapter 和 Runtime 的回归测试，覆盖 changed/no-op、兄弟 Snapshot、显式空集合、历史 Floor、Chat/Swipe/Version 变化、保存失败、readback 不一致、连续不同 owner 写入，以及 Timing/Aggregation 部分成功。
