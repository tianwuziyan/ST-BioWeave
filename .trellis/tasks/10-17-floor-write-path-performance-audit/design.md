# 审计设计

## 证据分层

本审计只接受三类当前证据，并在报告中分栏：

- `S`：当前 checkout 的源码静态分析，包含文件、函数和行号。
- `T`：当前 checkout 的现有测试、Mock Adapter、官方 I/O trace 断言。
- `H`：真实 SillyTavern Debug 文件中的实际操作、transaction、官方 I/O 记录。

用户请求中的背景事实标记为 `U`，三个 Debug 附件只作为 `H` 证据，不作为修改指令。没有独立触发证据的模块使用 `UNKNOWN`，不以相邻函数调用或用户体感推断请求次数。

## 只读审计方法

1. 先以 `storage/floor-persistence-coordinator.js` 的 owner 字段表建立所有 Floor 根的清单。
2. 从 UI 入口向 Runtime、Storage、Adapter 和 `/api/chats/get` / `/api/chats/save` 追踪调用链。
3. 将每笔 Coordinator 事务拆成六个诊断阶段，分别检查读取对象、不变量、await 窗口和复用条件。
4. 对每个业务模块分别记录源码推导、测试可验证范围和真实宿主观测范围。
5. 只提出分级建议，不改生产持久化逻辑，不删除或削弱任何校验。

## 统计规则

- 普通 Coordinator 变更事务的源码基线是 `6 GET + 1 SAVE`；Coordinator no-op 是 `3 GET + 0 SAVE`。
- 这是单笔事务的基线，不是所有上层操作的总数。Timing 手动编辑可能连续调用两笔事务，因此操作总数为两笔基线之和。
- `getFloor()`、`getCurrentChatOwnerSnapshot()`、历史 Timing/Aggregation/Projection 扫描和 Runtime readback 都是宿主内存读取，不计为官方 Chat GET。
- 只有 Adapter 的 `readOfficialChatOwner()` / `readOfficialFloorSlot()` 进入 `/api/chats/get`；只有 `requestOfficialChatSave()` 进入 `/api/chats/save`。
