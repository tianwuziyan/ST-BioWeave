# 技术设计：删除旧 Floor Event 的跨 Floor 观测审计

## 边界与原则

本 task 是 read-only audit。审计读取当前 host message/Swipe slot、Floor Version、derived collector、canonical business state 和 UI read model；不改变 Floor owner、事件事实、invalidation 语义、scheduler 或 Health contract。所有新增 diagnostic 必须通过已有 diagnostics/trace 通道观察，不调用 save、commit、clear 或 repair。

正确性 invariant：删除 Event A 只能修改 A 所属 authoritative Floor/active Swipe 的对应 Event factual data。依赖 A 的 derived state 可以重建或消失，但其它 surviving Floor 的 BiologicalEvents 不得因 Floor 顺序、gap、baseline 或 latest analyzed Floor 被删除、截断或隐藏。

## 调查数据流

```text
ui/app.js delete-event
  -> runtime.deleteEvent(eventId)
  -> runtime/event-editing.js findActiveEvent
  -> invalidateMutation(preserveTarget)
  -> commitFloorPatch(owner=event, operation_type=event-delete-patch)
  -> floor-persistence-coordinator / storage/store / ST adapter
  -> official readback + host sync + confirmed
  -> refreshTrackingRegistry(event-delete)
  -> collectCurrentFloorStates(active Character + active Swipe + Floor Version)
  -> getActiveFloorEvents(source/version filter)
  -> tracking/canonical Event rebuild
  -> collectActiveBusinessData / UI refreshBusinessState
  -> Event UI read model/render
```

## 关键核查点

1. `runtime/event-editing.js`：target Event 如何映射到 Floor；patch 是否只包含 target Floor 的 `events`；mutation token/invalidation 是否带有跨 Floor 清理。
2. `storage/floor-persistence-coordinator.js`、`storage/store.js`、`runtime/events.js`：owner、message_id、swipe_id、Floor Version 和 official readback 是否限定在目标 slot；删除前后是否已有 sibling/cross-floor 观察能力。
3. `runtime/event-analysis.js`：`collectCurrentFloorStates` 是否遍历全部 Character message；`resolveFloorAtIndex`/`resolveCurrentBioWeaveFloor` 是否错误使用 current/latest/baseline 边界；`isFloorInvalidated` 是否能排除后续 Floor。
4. `runtime/floor.js`：`getActiveFloorEvents` 是否只按当前完整 six-field version 过滤，是否存在跨 Floor 或历史 boundary。
5. `runtime/tracking-runtime.js`、canonical Event bridge：collection 中的 surviving Event 是否在 derived state 中仍存在。
6. `ui/app.js`：`refreshBusinessState`、Event read model 和 filter/render 是否在 authoritative state 之后丢失事件。

## Observation-only diagnostics

若现有 evidence 不足，优先在 full-chat collector 产生 `CHARACTER_FLOOR_COLLECTION_AUDIT`：每个候选 Character Floor 一个安全 DTO，包含 floor/message/swipe identity、slot/events presence、event IDs/count、computed-vs-stored Floor Version match、included 和 enum exclusion reason；最后输出 summary。诊断不得暴露完整事实文本或 secret，不得成为新的 authority。

只有当 collector 之前已能确认非目标 slot 发生变化，或 persistence 读回不足以比较时，才在删除流程增加 `EVENT_DELETE_CROSS_FLOOR_AUDIT`，对 delete 前 snapshot 与 official readback 做内存只读比较。不得使用额外 save/read-write cycle 作为诊断。

## 分类标准

- **A**：后续 Floor 在 delete 前存在，delete official readback 后其 authoritative slot/Events 已缺失、被覆盖、版本失效或 owner 不再匹配。
- **B**：后续 authoritative slot 和 Event source 仍存在且有效，但 full-chat collector、active Swipe/Floor Version resolver、canonical rebuild 将其排除或截断。
- **C**：后续 Floor 已被 collector/canonical state 纳入，但 UI read model/filter/render 后才消失。
- **NOT YET PROVEN**：现有代码/diagnostic 无法在上述边界之间定位 divergence；只补观察点并要求真实 Host 重现。

## 兼容与回滚

不引入 legacy Health compatibility，不迁移、不 backfill、不改变旧 Floor 70 数据。新增诊断应默认只进入既有 debug/trace，必要时可通过现有 diagnostics 查询；回滚仅移除本 task 新增 observation code/test，不触碰已存在的业务写入路径。
