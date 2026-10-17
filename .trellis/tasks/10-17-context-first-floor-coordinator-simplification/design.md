# 技术设计

## 边界

业务模块继续提交 owner-scoped patch 到现有 Coordinator。Coordinator 负责从 `store.getFloor(messageIndex, swipeId)` 取得当前 Context 中的 Floor 视图并完成 merge；Store 负责通过现有 Adapter host-slot primitive 更新当前消息/active Swipe 并调用原生保存；Adapter/Runtime 负责单次官方 readback 与目标身份确认。

## 目标调用链

```text
owner patch
  -> Coordinator queue / current-context identity guard
  -> store.getFloor (host Context, no official GET)
  -> owner-scoped merge
  -> store.saveFloor
       -> current message + active Swipe bioweave mirror
       -> await native saveChat()
  -> one authoritative /api/chats/get readback
  -> version / owner fields / sibling-presence audit
```

## 明确不做

- 不修改业务计算规则。
- 不删除 Coordinator queue、owner allow-list、Floor Version guard、readback 或 partial-success 语义。
- 不把 Timing 和 Aggregation 合并成一笔不可分割事务。
- 不把 UI no-op 直接当成持久化确认。
- 不声称插件内队列提供跨标签页/设备 CAS。

## 兼容策略

保留必要的旧 adapter API 名称和既有外部回退能力，但普通 Coordinator transaction 不再走 `OWNER_ACQUISITION`、官方 `LATEST_SLOT_READ` 或保存前/保存后的重复官方 GET。若当前 Context 无法完成身份/slot/version 校验，操作必须拒绝或保留明确失败/未知结果，不得静默回退到无保护写入。
