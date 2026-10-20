# 技术设计

## Change Boundary

最小行为差距是：Runtime 目前把前一阶段作为删除/到期 lifecycle 写入新 Floor，再写新阶段；读取器则把所有历史 Floor 累积在一起。目标是让每个阶段只存在于它产生时的 Floor，并由读取器按 endpoint 选择同人物同周期最近的阶段快照，同时让同一生成过程只在最终 Character Floor 上处理一次。

预计只修改：

- `core/projection-persistence.js`：在历史 Floor replay 时，对内置 pre-confirmation 阶段采用“同身份最近 creation Floor 为当前快照”的解析规则。
- `storage/projection.js`：保持现有 batch 写入；确保 Delivery 历史校验仍能识别旧 Floor 的 historical Projection ID，而产品视图只返回当前阶段快照。
- `runtime/projection-runtime.js`：先计算、后提交；同阶段复用；阶段切换只保存新阶段 creation/evidence，不再保存前一阶段 lifecycle，并只做一次最终 readback。
- `runtime/event-analysis.js` / `runtime/events.js`：把 settled Character Floor 的内部内置阶段同步与 scheduler 的外部 API interval gate 分开；外部 API 跳过且当前 Floor 尚无合法 owner slot 时，通过现有 Event/Floor Coordinator 建立当前 owner 快照，并保留 Generation gate 尾部合并规则。
- `storage/projection.js`：Projection owner 解析优先使用聊天数组位置，`message_id` 只作为兼容回退，避免把宿主消息身份误当数组下标。
- `tests/projection-runtime.test.js`、`tests/projection-persistence.test.js`、`tests/event-analysis-runtime.test.js`：在公开 seam 上增加回归测试。
- 相关架构、Floor ownership 和 lifecycle Markdown：同步最终契约。

明确不修改 UI、Projection schema、Timeline root、Candidate ID 算法、Aggregation/Timing、ST Prompt 文案或 `FloorPersistenceCoordinator`。

## Data Flow

```text
最终合法 Character Floor
  -> 先进入内部 Projection 阶段同步（不受外部 API interval 限制）
  -> 读取一次当前业务输入和 Projection views
  -> 解析人物/周期/机制/当前 Story Time 阶段
  -> 同阶段完整存在：直接复用并刷新 Context（0 次 Projection Floor 写入）
  -> 阶段发生变化：
       在内存中准备新阶段全部候选
       + 最后一次完整 Floor/输入 freshness 检查
       -> 若当前 Floor 尚无合法 owner slot，先由 Event/Floor Coordinator
          继承最近有效 events/character_registry（不复制 analysis.success）
       -> saveProjectionBatch(...) 一次
       -> FloorPersistenceCoordinator owner patch 一次
       -> 权威 readback 一次
       -> Resolver 以新 Floor 快照覆盖旧 Floor 阶段
       -> 刷新当前 Context

外部 API 路线另由 scheduler 的 `analysis_interval` 控制；只有 interval due
时才进入 World/Event/Projection 外部分析，不阻止上面的内部路线。
```

## Floor Snapshot Resolution

- 不新增持久化字段和保存 interface；继续使用现有 `saveProjectionBatch()` 原子保存一个新阶段的全部 creation/evidence。
- 内置阶段快照身份由现有数据组成：`subject_id + aggregation_evidence.pregnancy_id|null + aggregation_evidence.cycle_id`；机制元数据不参与阶段分组，避免同一人物的四条分支被拆散。
- 对同一身份，Resolver 选择 endpoint 之前最高合法 Character Floor 上的内置 pre-confirmation creations，并从当前产品视图中排除更早 Floor 的同身份阶段 creations。
- 新阶段 Floor 必须一次写入完整四条；若整批失败，该 Floor 没有阶段快照，读取仍落回上一合法 Floor。
- endpoint 回退、Floor 删除、Swipe 切换或版本失效后，最近合法快照会自然重新计算；不使用 Runtime cache 充当事实源。
- factual lifecycle、用户删除和 Delivery 仍按现有 timeline replay；只有 Story Time 阶段替换采用快照覆盖，不生成伪删除记录。

## Runtime Rules

1. Story Time 阶段变化不再为旧阶段构造 `deleted` 或 `expired` lifecycle 记录；旧阶段原样留在原始 Floor。
2. 内置当前阶段候选全部在内存中确定生成；如果候选缺失或生成不完整，不写当前 Floor。
3. 同一阶段已有对应人物/规则的活动 Projection 时，`existing_projection_id` 继续作为复用依据；不生成、不写入。
4. 有新候选时只调用现有 `saveProjectionBatch()`；真正的 factual lifecycle 或用户删除继续单独使用 `saveProjectionLifecycleBatch()`。
5. 新阶段保存后只做一次最终 Projection views readback；阶段切换前不再做清理保存或清理 readback。
6. 当前 view 由 Floor endpoint 和最新阶段快照解析得到，不把阶段切换解释为删除事实。
7. 外部 API 因 interval 跳过时，内部路线可以建立当前 Floor 的合法 owner slot，但不伪造
   `analysis.status=success`，不改变 scheduler baseline，也不创建第二事实源。

## Host Generation Settle Rule

- `GENERATION_STARTED` 的 provisional lease 仍用于排除打开角色卡时的假启动。
- 如果该 lease 过期后，同一 Chat/epoch 随后出现 `MESSAGE_RECEIVED` 或最终 Character render，则把它视为真实生成活动证据，恢复/保持延后状态，而不是立刻运行 Projection。
- Projection 只在现有 Generation Lifecycle 同时确认 final Character Floor 与 generation ended（或明确 stop/cancel）后进行一次 handoff。
- 如果最终 Character Floor 已先完成交接而旧 generation intent 被 supersede 清理，后续匹配的 `GENERATION_ENDED` 仍释放 gate，并按当前完整 Floor Version 只 flush 一次暂存 postprocessor。
- 过期的旧 Chat、hard-watchdog 后的迟到信号继续丢弃，不能复活旧工作。

## Compatibility And Lifecycle

- 不新增持久化字段；`projection_timeline` 的 owner、clear/invalidation、Swipe 和 Floor Version 规则不变。
- 历史旧阶段 creation 只保存在原 Floor；当前读取按 endpoint 选择最近阶段快照，回退后自然恢复旧快照。
- Delivery replay 独立收集 surviving Floor 中的 historical creation IDs 做引用校验；它不使用产品 current views，因此旧阶段 Delivery 仍可用于 response observation/timeout，但不会重新进入产品 Projection view。
- 删除旧 Exposure、怀孕确认、未怀孕到期和用户手动删除仍走既有事实/生命周期规则。
- 现有调用方继续使用 `saveProjectionBatch()` 与 `saveProjectionLifecycleBatch()`；本任务不新增 Projection persistence interface。

## Failure And Rollback

- freshness、owner、Swipe、Chat、record validation、append conflict 或 Host save 任一失败：新阶段整批失败，原历史 Floor 完全不变。
- Runtime 把 freshness 失败记为 stale/cancelled，不把它缓存成“已完成”，允许最终合法 Floor 重试。
- Timeline schema 没有迁移，因此不需要数据回滚；回滚解析规则即可恢复旧的历史累积视图。

## Diagnostics

- 复用：记录 `PROJECTION_STAGE_REUSED`，包含人物数、阶段和复用候选数，不记录叙事正文。
- 替换：记录 `PROJECTION_STAGE_SNAPSHOT`，区分 planned/succeeded/failed，包含身份、阶段、新记录数和一次保存耗时，不报告旧阶段删除数。
- stale：沿用 `FLOOR_VERSION_CHANGED` / `FLOOR_VERSION_STALE`，不得标为成功，也不得报告 AI 调用。
- Debug 页面和导出还显示 `projection_route`、`external_api_allowed`、`scheduler_decision`、
  阶段键、候选数、复用数、延后外部候选数和 `failure_reason`，用于区分“没有触发、只走
  内部路线、复用、阶段替换失败或外部 API 被延后”。上述诊断通过现有 Runtime transient
  status/Debug trace seam 暴露，不新增持久化字段或第二套诊断状态源。
