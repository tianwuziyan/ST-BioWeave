# 审计与修复结果

## 结论

**ROOT CAUSE：已修复并通过真实 Host acceptance。**

分类：**A. persistence/delete corruption → FIXED**。

Floor 70 的 Event 删除在目标 `event-delete-patch` 写入前，调用了一个面向“消息删除/历史源变更”的 invalidation routine。该 routine 从目标消息 index 开始清理直到 Chat 末尾，因此先清空了 Floor 70 之后的 surviving Floor slots。目标 Floor 的官方保存/readback 成功并不能恢复这些已被前置清理的非目标 slots。

## 第一处 divergence

第一处真实 divergence 在 `runtime/event-analysis.js` 的 `invalidateMutation()`：

1. `runtime/event-editing.js:87-101` 的 `deleteEvent()` 找到目标 Event 后调用：
   - `invalidateMutation({type: "MESSAGE_DELETED", ...}, target.index, {mutationScope: "target-local"})`
   - 随后才调用 `commitFloorPatch(..., {events}, {operation_type: "event-delete-patch"})`
2. `runtime/event-analysis.js:1252-1298` 的 `invalidateMutation()` 计算 `start = targetIndex`，遍历到 `all.length`。
3. 对 target 之后每个 Character Floor，`preserveTarget` 条件不成立，于 `runtime/event-analysis.js:1289-1295` 设置 invalidated 并调用 `persistence.clearFloorSlot()`。
4. `storage/floor-persistence-coordinator.js:403-430` 的 `clearFloorSlot()` 将该非目标 Floor 保存为空 Floor；这不是 UI filter，也不是单纯内存 invalidation。
5. 之后 `event-delete-patch` 只在目标 Floor 上合并/写入 `events`。`storage/floor-persistence-coordinator.js:358-400` 的 owner patch selector 来自目标 `ownerFloor`/target Floor Version，`runtime/events.js` 的 official adapter 也只解析并写入该目标 message/Swipe。

因此 Floor 75 等后续 Floor 在 collection 之前已经丢失 authoritative slot，属于 A，不是 B/C。

## 调用链证据

```text
ui/app.js delete-event
  -> runtime.deleteEvent(eventId)
  -> runtime/event-editing.js findActiveEvent
  -> invalidateMutation(MESSAGE_DELETED, target.index, mutationScope=target-local)
  -> target-local invalidation; no downstream clearFloorSlot()
  -> commitFloorPatch(target, event, {events}, event-delete-patch)
  -> refreshTrackingRegistry(event-delete)
  -> collectCurrentFloorStates()
  -> getActiveFloorEvents()
  -> canonical/Tracking rebuild
  -> UI refresh
```

`collectCurrentFloorStates()` 本身会扫描整个当前消息集合；`getActiveFloorEvents()` 只按当前完整 Floor Version 过滤。它们没有发现或排除后续 Floor 的机会，因为后续 slot 已被前置清空。

## 其它假设排除

- 没有发现 `floor >= deletedFloor` 的直接比较；实际等价效果来自 `targetIndex → all.length` 的清理范围。
- latest analyzed/baseline/current Floor 仅出现在 scheduler/previous-state 等路径，未作为本次 Event delete persistence collection 的截断边界。
- active Swipe/Floor Version resolver 会约束目标读取；它不是本次后续 slot 消失的第一处分歧。
- Event UI 不是第一处分歧；authoritative `store.getFloor(laterIndex).events` 已为空。
- 现有 `FLOOR_TX_SIBLING_AUDIT` 只比较目标 Floor 的 owner/sibling fields，不覆盖非目标 Floors，因此真实 Host 中“目标事务 confirmed”与跨 Floor slot 被清空可以同时成立。

## Regression evidence

新增测试：`tests/event-analysis-runtime.test.js` 的
`deleting an Event does not clear surviving later Floor Event slots`。

场景：Floor 70 和 Floor 75 各有一个已保存 Event；删除 Floor 70 Event 后，断言 Floor 75 的 authoritative slot 仍含原 Event ID。修复前实际值为 `[]`，期望为 surviving Event ID；修复后该回归测试通过。

## 最小修复

`runtime/event-analysis.js::invalidateMutation()` 新增显式 `mutationScope`：

- `downstream-destructive`：默认语义，真实 `MESSAGE_DELETED` / timeline mutation 继续从 target index 清理下游 roots。
- `target-local`：只对 target index 的 in-flight execution 做失效，不进入 `clearFloorSlot()` 循环。

`runtime/event-editing.js::updateEvent()` 和 `deleteEvent()` 均改用 `mutationScope: "target-local"`；没有只修 delete 而遗漏 edit。`preserveTarget` 不再承担 Event-local mutation 的语义。

## 是否增加 diagnostics

本轮未增加 `CHARACTER_FLOOR_COLLECTION_AUDIT` 或 `EVENT_DELETE_CROSS_FLOOR_AUDIT`：现有代码路径已经明确证明 A，且 regression test 直接观测 authoritative slot 被清空；继续增加 diagnostics 不会改变分类，也不应掩盖确定的 destructive path。

## 真实 ST Host acceptance

用户已在真实 SillyTavern Host 完成 acceptance：

- 删除较早 Floor 的 Event 后，后续 Floor 的独立 Events 仍保留；
- authoritative Floor source rebuild 仍保留后续 Events；
- `CHARACTER_FLOOR_SOURCE_RESOLVED event_count = 7`；
- `CHARACTER_CANONICAL_STATE_BUILT event_count = 7`；
- Event UI 正常保留后续 Events。

该结果确认 Event edit/delete 是 target-Floor-local factual mutation，不能清理或失效 independent downstream Floor authoritative slots。

## 最小修复方案

将 Event edit/delete 的 mutation invalidation 与“实际 Character message 删除/历史结构变更”的 downstream root 清理语义分离。Event factual patch 只能失效/重建目标 Floor 及其 derived state，不得调用会清理 `targetIndex` 之后所有 Floor slots 的 `clearRoots` 路径。最小实现应保留现有目标 Floor token/version guards 和 `event-delete-patch`，并让后续 surviving Floor slots 继续参与 full-chat rebuild。

修复后已通过现有 `MESSAGE_DELETED invalidates the downstream active path without analyzing` 测试，确认真实 Host timeline deletion 的 downstream cleanup 语义保持。未恢复 Floor 70 Event，未增加 legacy Health compatibility/backfill/migration，未修改 Health 或 scheduler。

## 最终状态

Regression tests 与真实 ST Host acceptance 均通过。本 bug 直接相关项无未解决问题；完整 `npm test` 中已有的无关 Active Swipe / World prompt failures 不在本 task 范围内，未因本 task 处理。
