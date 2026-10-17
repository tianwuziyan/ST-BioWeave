# Context-first 修改后 UI 与保存变慢：最小实现审计

## 结论

本轮实施了三个互不改变持久化契约的最小修复：手动保存 Timing Instance 后，Aggregation 重评估不再默认调用完整 `collectActiveBusinessData()`，而是通过 `getParticipantAggregationInputs()` 构造目标角色所需的 Event、Tracking Window、Story Time 和 Floor Version 输入；Timing popup 的打开、读取完成和关闭改为优先局部替换当前 Character detail pane，避免无关整页重渲染；同一 Runtime 中相同完整 Floor Version 的顺序 canonical 读取复用已完成结果，避免人物页和 Projection 生命周期重复重建约 1 秒的 canonical 状态。

结论标签：

- `SOURCE_VERIFIED`：调用链和生产代码已核对。
- `TESTED_IN_ISOLATION`：目标 Aggregation 保留、无新增完整 canonical build 的回归测试通过。
- `MEASURED`：自动化测试和真实宿主样本均有记录；真实宿主数据仍只代表单次采样。
- `HOST_VERIFIED（本次样本）`：`ST-BioWeave-Debug-20261017-220906.txt` 已观察到 completed canonical cache 命中和更短的内部等待；跨机器、跨 Chat、跨所有生命周期操作仍未普遍证明。

这不是 Coordinator 重写，也不是 Timing/Aggregation 合并。两笔逻辑事务、各自的 readback 和 Timing 成功后 Aggregation 失败的部分成功语义均保留。UI 修复和 canonical read cache 不改变 Runtime 业务结果、Storage、Snapshot 或保存确认路径；缓存只服务于当前 Runtime 的读 DTO，命中仍执行当前目标身份与 stale assertion。

## 当前调用链与改动

改动前的关键路径：

```text
editCharacterTimingInstance()
  -> Timing edit transaction
  -> Timing authoritative readback
  -> eventAnalysis.collectActiveBusinessData()
       -> canonical derived state
       -> full tracking registry / health / state reduction
  -> getParticipantAggregations()
  -> target Aggregation calculation
  -> Aggregation transaction + readback
```

改动后的关键路径：

```text
editCharacterTimingInstance()
  -> Timing edit transaction
  -> Timing authoritative readback
  -> eventAnalysis.getParticipantAggregationInputs({subjectId, mechanismKey, target})
       -> current complete Event state
       -> current World Model and Story Time
       -> Tracking Window construction, then target/mechanism filtering
       -> target-related exposure filtering
  -> getParticipantAggregations()
  -> target Aggregation calculation
  -> Aggregation transaction + readback
```

源码位置：

- `runtime/events.js:5865-5877`：手动 Timing readback 后使用定向输入，并继续读取已有 Aggregation。
- `runtime/event-analysis.js:2013-2057`：定向输入构造和 Chat token 复核。
- `runtime/event-analysis.js:4861`：Runtime 对外暴露该输入入口。
- `storage/participant-aggregation.js:211-256`：仍通过现有 Coordinator、owner 校验和 Snapshot merge 写入。
- `storage/floor-persistence-coordinator.js:281-360`：仍执行当前 Context owner/version guard；本轮未改事务边界。

`getParticipantAggregationInputs()` 仍会从完整当前 Event 集合构造 Tracking Window 后按目标角色和机制筛选；本轮的确定性收益是移除了完整 canonical registry、Character Facts、Health 和 Current State rebuild，不应把它描述成“所有其他角色的 Tracking Window 计算都已删除”。

## 保留的契约

- `projection_timing_snapshot` 与 `participant_aggregation_snapshot` Schema 未改动。
- Timing Instance ID、Cycle ID 和 sampled offset 仍从已确认 Timing 继承。
- Aggregation 仍只替换目标 item；同 Floor sibling item 由现有 Snapshot merge 保留。
- 历史 Floor、active Swipe、Chat/Floor/epoch/version 校验和 Coordinator readback 未删除。
- Timing 成功后才开始 Aggregation；Aggregation 失败不会回滚已确认 Timing。
- 未新增全局缓存、UI dirty shortcut、事务合并或并行 Writer。
- canonical read cache 不是全局 Floor 缓存：它只存在于当前 Runtime，并按完整 Floor Version、canonical generation 和 analysis phase 限定；Chat boundary、Event/World/Terminal/Health confirmed commit 后失效。

## 证据与测试

### 真实宿主基线（改动前）

来自 `/Users/ll/Downloads/ST-BioWeave-Debug-20261017-203027.txt` 的已记录样本：

| 操作 | 总时长 | Aggregation 输入阶段 | canonical build | Tracking build |
| --- | ---: | ---: | ---: | ---: |
| Timing no-op + Aggregation no-op | 1259.3 ms | 1148.8 ms | 15 | 14 |
| Timing changed + Aggregation changed | 2099.4 ms | 1147.7 ms | 15 | 14 |

这份日志证明的是历史样本中的内部计算成本；它不证明本轮改动后的真实宿主耗时。

### 真实宿主复测（缓存改动后）

来自 `/Users/ll/Downloads/ST-BioWeave-Debug-20261017-220906.txt`。该文件只作为性能证据读取，不把其中的聊天内容或完整身份信息写入报告。

| 操作/指标 | 本次观测 |
| --- | ---: |
| 角色页首次完整渲染 | 10.5 ms |
| 推演周期弹窗打开（两次记录） | 14.2 ms / 16.8 ms |
| 人物选择提交 | 1.4 ms |
| 人物详情 DOM 局部提交 | 1.3 ms |
| 最新 Timing no-op + Aggregation no-op Runtime 操作 | 413.6 ms |
| 其中 Aggregation 输入阶段 | 346.2 ms |
| `CHARACTER_CANONICAL_BUILD_CACHE_HIT` | 8 次 |
| `CHARACTER_CANONICAL_BUILD_COMPLETED` | 4 次 |
| `TRACKING_REGISTRY_BUILD_PHASES` | 6 次 |

最新一次 Runtime 操作的两个 Floor 事务都记录为 `FLOOR_TX_NOOP`，两个 `STORE_SAVE_FLOOR` 均为 `NOT_APPLICABLE`；因此本次样本没有发生 Floor SAVE。该导出没有提供独立的 `/api/chats/get`、`/api/chats/save` 网络计数，不能从它推导官方 endpoint 的精确次数；这里只确认了 Coordinator 的 Context no-op 结果，不把 `SAVE_RUNTIME_CALL`（396.7 ms 的 Runtime 调用总等待）误写成宿主网络 SAVE。

与改动前 no-op 样本的 1259.3 ms 相比，本次 413.6 ms 少 845.7 ms，约下降 67.1%。这是两份真实宿主样本之间的观测差异，不是所有操作和设备的性能承诺。日志末尾仍出现一次约 983.9 ms 的完整 canonical build，说明缓存不是“所有读取永远零成本”；它只在完整 Floor Version、generation 和 analysis phase 均匹配时复用。

### 隔离回归

- `tests/event-analysis-runtime.test.js:1101-1163`：手动 Timing 编辑后，`CHARACTER_CANONICAL_PHASES` 数量不增加；Timing/Aggregation 结果仍正确。
- `tests/event-analysis-runtime.test.js:2411-2450`：同一完整 Floor Version 的顺序读取只构造一次 canonical state，第二次命中完成结果；Event derived commit 后再次构造，验证 generation 失效。
- `tests/event-analysis-runtime.test.js:1729-1800`：目标 Aggregation 移除时，sibling Aggregation 保持不变。
- 相关既有测试继续覆盖已存在 Aggregation 的保留、`before_min` 移除、Timing readback 顺序和部分失败语义。

实际执行：

- 聚焦手动 Timing 测试：3 passed、0 failed。
- `node --check runtime/event-analysis.js runtime/events.js tests/event-analysis-runtime.test.js`：通过。
- `node --test tests/ui.test.js`：76 passed、5 skipped、0 failed。
- `node --test tests/event-analysis-runtime.test.js`：288 passed、0 failed。
- `npm run check`：1672 passed、16 skipped、0 failed。
- `git diff --check`：通过。

Timing popup 另有一个 Promise barrier 回归测试：读取挂起期间关闭 popup，释放迟到结果后，popup 不会复活，`.bioweave-main` 也不会被整页替换。

本轮新增的 Projection DTO 复用回归：

- `tests/projection-context.test.js`：同一完整 Floor Version 不再触发 fallback business read；跨 Floor 的 supplied DTO 会被拒绝并回退当前 Floor 重建。
- `tests/projection-runtime.test.js`：lifecycle-only refresh 收到 `collectInputs()` 已构造的同一 Business DTO。

对应生产代码只在 `runtime/projection-runtime.js` 传递 DTO，并在
`runtime/projection-context.js` 用完整六字段 `sameFloorVersion()` 验证后复用；未删除末尾
Chat/Floor 检查，未改变 Coordinator 或保存确认语义。

## 请求与性能边界

本轮没有修改 Coordinator 的事务边界或宿主 Adapter 的 endpoint 语义；收益来自插件内部计算，尤其是复用同一 Floor 的完成 canonical state。`ST-BioWeave-Debug-20261017-214909.txt` 是缓存改动前的样本，而新的 `ST-BioWeave-Debug-20261017-220906.txt` 已观察到 8 次 cache hit、最新 no-op Runtime 操作 413.6 ms。新导出没有 endpoint 级 GET/SAVE 计数，因此仍不能声称官方网络请求减少了多少；需要带网络计数的后续样本才能回答该问题。

本轮仍没有处理：

- UI 页面切换触发的 `collectActiveBusinessData()`；
- 独立生命周期请求之间的 Projection refresh 串行队列 coalesce；当前仍串行执行；
- 真实宿主网络等待或宿主保存延迟；
- 跨标签页、设备或直接 API 的外部覆盖。

因此本轮对页面/角色切换的新增收益在源码和隔离测试中证明为“同一 Runtime、同一完整 Floor Version 的顺序读取少一次 canonical rebuild”；不能保证所有页面首次打开或独立生命周期刷新都已变快，也不能把隔离测试耗时当成真实宿主收益。独立生命周期请求之间仍未 coalesce。

## 清理审计

本次按“是否存在明确的所有权、生命周期或并发保护职责”检查了本任务涉及的新增代码，没有发现可以安全删除的生产代码：

- `C1` `runtime/event-analysis.js:559` 的 `canonicalBuilds` 与 `completedCanonicalBuilds` 不是重复缓存。前者只合并并发中的同一构建 Promise，后者只复用已经完成的结果；删除任一者都会分别恢复并发重复构建或顺序重复构建。
- `C2` `runtime/event-analysis.js:603-617` 的两次副本边界不是无效深拷贝。写入缓存前的副本隔离构建结果，命中时的副本隔离调用方；`tracking_windows` 非枚举属性的重新挂载保持 Tracking Runtime 的 DTO 契约。
- `C3` `runtime/event-analysis.js:2457-2464` 的 cache-hit 后 `chat.assert(token)` 与 `collectActiveBusinessData()` 后的 `assertBusinessTargetCurrent()` 保护不同窗口：前者覆盖等待期间 Chat token 变化，后者覆盖完整 Floor/Swipe/Version 变化，不能合并成一次弱校验。
- `C4` `runtime/event-analysis.js:627-630` 的 generation 递增和 Map 清空也不是同一职责：generation 使旧 key 失效，清空则释放已经构造的 DTO，避免失效结果继续占用内存。
- `C5` `runtime/events.js:2184-2201` 的 Health 失效回调仍需保留；Health 提交绕过 `event-analysis.js:836-868` 的通用 patch 包装，不能仅依赖通用 owner 分支失效缓存。
- `C6` `runtime/projection-context.js:306-309` 的 `refreshTail` 与 `ui/app.js:3783-3950` 的 in-flight/queued refresh 仍保留顺序和最新请求语义；它们没有实现 coalesce，但也不能在没有 deferred 顺序测试前删除。

本次实际清理的是当前任务文档中的过时状态：删除“最新真实日志仍是缓存改动前、真实宿主尚未复测”的陈述，补入 220906 样本及其证据边界。历史审计任务目录保持不变，避免把历史基线改写成事后结论。

### 清理操作收据

- **范围**：当前性能回归任务的缓存变更说明、真实宿主复测证据和相关候选代码审计。
- **基线**：旧样本 `203027`/`214909` 与当前源码、隔离测试结果；工作区其他 Trellis 任务和生产改动保持原样。
- **退休义务**：撤销当前任务文档中“最新真实日志仍在缓存改动之前、宿主收益尚未复测”的过时陈述；没有退休任何生产能力。
- **变更产物**：更新本任务的 `audit-report.md`、`design.md`、`implement.md`；未删除生产文件、Snapshot Schema 或测试契约。
- **行为**：代码行为不变；文档新增 220906 样本的真实测量和 endpoint 计数未知边界。
- **验证**：`npm run check` 为 1672 passed、16 skipped、0 failed；`git diff --check` 和本任务未跟踪 Markdown 的空白检查均通过。
- **残余风险**：changed 操作的新版真实样本、endpoint 级 GET/SAVE 计数，以及独立 Projection 请求 coalesce 仍未完成验证。
- **保留候选**：`C1`–`C6` 均因承担不同并发、生命周期、失效或顺序保证而保留。
- **撤销**：仅恢复这三个任务文档的本次 hunk 即可；不涉及数据迁移或真实 Chat/Floor 恢复。

## 回退

如需回退，只需恢复 `runtime/events.js:5865-5870` 到完整 `eventAnalysis.collectActiveBusinessData()` 输入，并移除 `runtime/event-analysis.js:2013-2057` 及 `4861` 的定向入口；不需要迁移数据，Snapshot Schema 和历史 Floor 不受影响。当前工作区存在其他既有修改，回退时必须只撤销本任务对应 hunk，不能使用 `reset` 或 `clean`。

## 后续建议

继续补采至少一份 changed 操作并记录 endpoint 级 GET/SAVE 计数，再单独确认 `projectionRuntime.getBusinessData()` 与 `getParticipantAggregations()` 的阶段贡献。若独立生命周期刷新仍产生连续 canonical build，再单独评估带 Floor Version 身份的 Promise coalesce，不要引入永久全局缓存或把完整 Business DTO 接回 Timing 保存关键路径。
