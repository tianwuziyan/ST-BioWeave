# 技术设计

## Boundaries

以 `storage/schema.js` 为 schema inventory，以 `storage/store.js` 为 storage boundary，以 `runtime/event-analysis.js` 为 Floor traversal、previous resolution、World resolver 和 derived rebuild boundary；沿 `runtime/events.js`、`ai/input-builder.js`、`ui/app.js` 验证 API/UI consumers。`storage/lifecycle.js` 只保留实际仍存在的 ownership。

不兼容旧存档，因此旧字段直接删除，不增加 migration、legacy reader、deprecated getter 或 delete-before-save cleanup。

## Target data flow

```text
message + active Swipe
  -> exact Floor owner + valid Floor Version
  -> current Floor facts
  -> Runtime collect/rebuild
  -> business DTO
  -> API/UI
```

`refreshTrackingRegistry()` 只执行 Runtime refresh/derivation 并返回 DTO，不调用 `store.saveChat()`。

## Final ownership

- Global: `extensionSettings.bioweave`。
- Chat: structural `schema_version`、`chat_scope`、`settings`、`data_lifecycle.character_reset`。
- Floor: `floor_version`、`analysis`、`events`、`character_registry`、`world_model`、`world_model_meta`。
- Runtime: tracking registry、profiles、active events、indexes、UI DTO 和 caches。

删除 Chat `character_registry`，Floor snapshot 成为唯一 canonical identity history。`defaultCharacterContext()`、`buildFloorAnalysisInput()` 和 UI consumers 均改为使用 causal/current Floor-derived DTO。

删除 Floor `history`、`snapshot`、`projections` 的持久契约；保留 `core/snapshot.js` 等仍有独立测试/用途的纯函数。

保留 `data_lifecycle.character_reset`，因为它仍用于在 Character clear 后阻止旧 Floor facts 立即重新进入 Runtime projection。本阶段不改变 clear 行为。

## Reload proof

构造三个 message/Floor，至少覆盖一个多-Swipe owner；写入 valid `analysis`、`events`、cumulative Floor `character_registry`、`world_model`、`world_model_meta`。Chat metadata 只提供 `chat_scope`、`settings`、`data_lifecycle.character_reset`，不提供任何旧 projection、index 或 Chat World Model。

重新创建 Runtime/coordinator 后断言：

- Characters DTO、pending candidates、eligible subjects、profiles 与 Floor facts 派生结果一致；
- Events 与 canonical identity 恢复；
- previous API input 只来自 nearest valid previous Floor；
- World resolver 和 manual save/read 只访问 Floor owner；
- last processed floor 由当前 valid successful Floor scan 重新计算；
- Chat metadata 在 refresh 后没有 forbidden derived roots。

## Compatibility and rollback

不提供旧格式兼容。实现前后通过 Git diff 和测试验证；禁止 destructive Git rollback。若发现某路径确实需要 Chat configuration，改为保留在 `settings`，不恢复 Floor-derived 字段。
