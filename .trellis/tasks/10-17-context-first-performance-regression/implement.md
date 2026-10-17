# 执行计划

本任务已进入 Execute。实现范围收敛为手动单角色 Timing 保存后的定向 Aggregation 输入，以及 Timing popup 的局部 UI 渲染修复；不修改 Coordinator 事务边界、Snapshot Schema 或业务规则。

## Phase 1：基线复核

- [x] 读取真实宿主 Debug：`ST-BioWeave-Debug-20261017-203027.txt`。
- [x] 用 `jq -e` 断言 no-op/changed 操作的总时长、Aggregation 输入耗时、宿主保存等待、canonical build 数量和 tracking build 数量。
- [x] 将官方网络 GET/SAVE、原生宿主保存等待和插件内部计算分开记录。
- [x] 读取改动后真实宿主 Debug：`ST-BioWeave-Debug-20261017-220906.txt`；记录 8 次 canonical cache hit、最新 no-op Runtime 操作 413.6ms 和 Aggregation 输入 346.2ms。

## Phase 2：源码归因

- [x] 核对 `editCharacterTimingInstance()` 到 Aggregation reevaluation 的调用链。
- [x] 核对 `collectActiveBusinessData()`、canonical build、tracking registry 和 projection refresh 的调用关系。
- [x] 核对 UI refresh 的 in-flight/queued 行为和 route switch 计时边界。
- [ ] 继续确认 `projectionRuntime.getBusinessData()` 与 `getParticipantAggregations()` 的独立耗时贡献。

## Phase 3：单角色定向输入隔离验证

- [x] 为一个目标角色 A 构造 Timing 更新，确认不会新增完整 Character canonical rebuild，并且不会修改角色 B 的 Aggregation。
- [x] 验证目标角色 A 的输入通过现有 Event/World/Story Time/Tracking Window 运行时边界构造，并在进入 Aggregation 前继续读取已有 Aggregation。
- [x] 覆盖目标角色已有 Aggregation 的 `before_min` 移除和仍在有效窗口内的保留路径；其他状态仍由既有测试覆盖。
- [x] 覆盖同一 Floor 中存在 sibling Aggregation 时，只移除目标角色 item，其他 item 保持不变。
- [x] 现有实现保持 Timing readback 完成后才进入 Aggregation；本轮未新增 deferred barrier，依赖既有顺序测试与源码调用顺序。
- [x] 现有实现保持 Timing 成功、Aggregation 计算/保存失败的部分成功语义；本轮未改变错误处理。
- [x] 现有 Coordinator 的 Chat/Floor/Swipe/epoch/version stale guard 继续覆盖目标写入；本轮未放宽校验。
- [ ] 使用 deferred Promise 验证等价 projection refresh 是否被串行执行，而不是被合并。
- [x] 使用 deferred Promise 验证 Timing popup 关闭后，迟到的读取结果不会复活 popup 或替换整页主容器。
- [x] 使用同一完整 Floor Version 的顺序读取验证 canonical 完成结果复用，并验证 Event derived commit 会使缓存失效。
- [x] 保留 Tracking Runtime 的非枚举 `tracking_windows` 字段；缓存副本不会把该业务输入丢失。

## Phase 4：最小生产改动

- [x] 在 `runtime/events.js` 中将手动 Timing 保存后的 Aggregation 输入改为单角色定向路径。
- [x] 复用 `storage/participant-aggregation.js` 现有 owner/merge 规则，只替换目标角色记录，不创建第二套 Snapshot Schema。
- [x] 保留 `storage/floor-persistence-coordinator.js` 的两笔逻辑事务、身份校验、版本校验和 readback。
- [x] Timing popup 开启、读取完成和关闭优先只替换当前 Character detail pane；detail 未挂载时才回退整页渲染，并保留 Chat/route/角色/request identity guard。
- [ ] 让 UI 直接消费 Runtime 返回的 Timing/Aggregation 结果，避免保存完成后再次触发完整业务读取；本轮未扩大到保存完成后的全量业务刷新。
- [x] 在 `runtime/projection-runtime.js` 与 `runtime/projection-context.js` 之间复用同一调用链已构造的 Business DTO；仅接受完整六字段 Floor Version 一致的快照，不同版本回退重建。
- [x] 在 `runtime/event-analysis.js` 中加入当前 Runtime 范围的 completed canonical read cache；Chat boundary、Event/World/Terminal/Health confirmed commit 会失效，`includeDebug` 读取绕过。
- [ ] 继续评估独立生命周期请求之间的 Promise coalesce；当前仍保持串行执行，未把不同请求合并。
- [x] 记录新版本 no-op 的真实内部阶段耗时；新导出未提供 endpoint 级 GET/SAVE 计数，因此 changed 操作和网络计数仍需后续样本补齐。

回退方式：恢复本任务修改的定向 Aggregation 调用，回到现有 `collectActiveBusinessData()` 路径；不改变 Snapshot Schema 和历史数据。

## Phase 5：质量门

- [x] 已在 Execute 授权后修改生产代码并补充回归测试。
- [x] 运行 `npm run check`：1672 passed、16 skipped、0 failed。
- [x] 运行 `git diff --check`。
- [x] 检查相关 Markdown；本次未改变持久化契约或 Schema，已同步本任务文档的 UI 范围与验证结果，无需同步 `docs/ARCHITECTURE.md` / `docs/bioweave-data-lifecycle.md`。
- [x] 保留所有既有工作区修改及 `.trellis/tasks/10-15-nsfw-auto-aggregation-diagnostics/`。
