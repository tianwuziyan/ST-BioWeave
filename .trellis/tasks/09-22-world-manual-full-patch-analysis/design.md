# 技术设计

## 两个共享底层能力

不按 Initial/Manual/Auto 复制实现，而是建立两个可复用的 Runtime World 能力：

### `runWorldFullAnalysis`

接收当前有效 Character Floor 的完整上下文，调用 `analyzer.analyzeWorldModel`，完成 response parse、canonical strict validation、normalize、consistency guard、Floor Version stale guard 和当前 owner persistence。已有 World 不作为 Patch 基底；完整结果替换当前 Floor 的 World。Initial Full、Manual Full、Auto Full 都调用它。

### `runWorldPatchAnalysis`

接收当前有效 Character Floor、已验证的 existing World 和上下文，调用 `analyzer.analyzeWorldModelPatch`，完成 Patch parse/`validateWorldModelPatch`、`mergeWorldModelPatch(existing, patch)`、final strict validation、stale guard 和当前 owner persistence。未提及字段保留，不支持删除。Manual Patch 与 Auto Patch 都调用它。

触发来源可作为诊断 metadata，但不能改变 Full/Patch 路径，也不能形成第三套实现。

## Auto 决策

```text
resolve current valid World
├─ absent → runWorldFullAnalysis → success → Character/Event
├─ present + world update required → runWorldPatchAnalysis → success → Character/Event
└─ present + no world-relevant evidence → Reuse existing World → Character/Event
```

已有 World 不能单独成为 Patch 条件；必须继续使用现有 world update signal/依赖判断。

## Runtime 与 UI 入口

Runtime 提供两个 World-only 入口，例如 `analyzeCurrentWorldModelFull()` 与 `analyzeCurrentWorldModelPatch()`。前者调用 `runWorldFullAnalysis`；后者先解析当前 Floor 与 existing World，无 World 时返回明确 `WORLD_MODEL_REQUIRED_FOR_PATCH`/disabled 且不发 API，再调用 `runWorldPatchAnalysis`。两者保存 World 后直接结束，不能调用 `analyzeFloor` 或其它 Character/Event 链。

Auto 可调用相同两个能力，但只有 Auto caller 在 World 成功或 Reuse 后继续 Character/Event。

## Shared single-flight / stale guard

所有 Manual/Auto Full/Patch 经过同一个 Runtime World-specific in-flight registry，key 为完整六字段 Floor Version identity（含 Chat scope）：

- 同 key 已有 World job 时复用 Promise 或返回 already-running，不创建第二个 World API 请求/写入。
- Full、Patch、Auto Full、Auto Patch 在同一 key 互斥。
- 手动 job 与自动 Character/Event execution 的 World 阶段共享该 registry。
- API 返回后、写入前后都检查 Chat token、当前 Character Floor、active Swipe 和完整 Floor Version；变化则丢弃，不挂到新 Floor/Swipe。
- `runtime.saveWorldModel` 仍是唯一 Floor storage 写入边界，selector 固定为当前 owner，历史 Floor 不可写。

## UI 状态契约

`ui/world.js` 固定渲染两个按钮；`ui/app.js` 仅维护 `full`/`patch`/null operation 并转发 Runtime，不直接持有 API/persistence 业务。任一 World job 运行时两个按钮 disabled；Patch 无 World 时持续显示、disabled、使用指定 Tooltip。Tooltip 使用现有 `title`/ARIA/`data-bioweave-*` 模式。

## 失败、兼容与风险

Full/Patch 在所有 parse/validate/normalize/merge/final validation 完成后才 persistence；失败或 stale 不保存半成品，保留原 World。当前 UI 的直接 analyzer/save 必须迁移到 Runtime；当前自动 `resolveFinalWorldModelForAnalysis` 的 Full/Patch/Reuse 判断应改为调用共享能力，同时保留 Auto Reuse 和后续 Event 链。不改变 World schema、Patch 算法、StateReducer、Snapshot、Projection、Character/Event schema 或 interval；不使用 Chat metadata、User message、virtual Floor fallback。
