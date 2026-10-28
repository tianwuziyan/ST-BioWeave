# Research: Projection 二阶段写回失败的 readback mismatch

- Query: 分析 `ST-BioWeave-Debug-20261028-023200.txt` 中 `slot_present=true` 但最终 `present=false` 的具体原因，并给出不破坏 host_context + authoritative readback 约束的最小修复建议。
- Scope: internal
- Date: 2026-10-28

## Findings

### 1. API、解析和当前 Floor 内存写入均已成功

- Debug 的第二次运行从 `PROJECTION_PROCESS_STARTED`（seq 176，`projection-refresh`、`analysis`、`external_api_allowed=true`）开始；随后进入 `PROGRESSION_GENERATION`（seq 192/193）。
- API 请求完成（seq 204/205），`PROGRESSION_PARSE`（seq 206/207）为 `validated_snapshot`；当前内存调试快照已经有新的 `progression_event`，而不是旧的已完成入口节点（见附件约 34859 行及后续 `storyline.snapshots`）。
- `SNAPSHOT_WRITE`（seq 208/209）创建了 `floor-tx-2`，owner 为 projection，目标是当前 Floor 108 / Swipe 0；因此本次不是 API 没返回，也不是 JSON parser 没读取。

### 2. 宿主原生 saveChat() 已返回，但权威服务器仍返回旧 revision/旧 slot

- 当前写路径为 `floor_write_transport: host_context`：先由 `syncHostMemoryFloorSlot()` 写入宿主内存，再调用 `io.saveChat()`（`runtime/events.js:990-1056`、`runtime/events.js:1460-1538`）。
- seq 230/231 证明宿主内存写入后 slot 存在且 Floor Version 匹配；seq 235 的原生保存返回 `resolved`，耗时约 1007ms。
- 紧接着的权威 `/api/chats/get` seq 238/239 返回 revision `8ba2429f...`。第一次 readback seq 241 虽然 `slot_present=true` 且 `events_present=true`，但 `commit_state=unknown`；实现因此按既有规则执行一次 Context-first 收敛保存（seq 242-244），随后又进行了四次权威 GET（seq 245-268）。五次读取全部仍为同一个 revision `8ba2429f...`（附件约 43470、43611、43704、43797、43890 行）。
- 最终 seq 269 为 `present=false`、`floor_version_match=true`、`swipe_match=true`，seq 270 失败为 `FLOOR_PERSISTENCE_READBACK_FAILED`；所以“报错状态”是故意的 fail-closed 结果：内存已有新结果，但服务器权威数据没有确认新结果，不能当作已保存。

### 3. 当前 Debug 不能区分 slot 不一致还是 mirror 不一致

`runtime/events.js:1601-1622` 的 `candidateReadbackPresent` 同时要求：

1. 权威消息、消息 ID、active Swipe、Floor Version 都匹配；
2. `candidateSlot`（`swipe_info[swipe].extra.bioweave`）与 `mergedValue` 完全相等；
3. `candidateMirror`（active Swipe 的 `message.extra.bioweave`）也与 `mergedValue` 完全相等。

本次 seq 241/250/256/262/268 只被诊断保留为 `slot_present=true`、`events_present=true`，`mirror_present` 没有进入诊断白名单；seq 269 只保留了 `present=false`。因此仅凭附件不能严谨断言是 `candidateSlot` 旧了、`candidateMirror` 不一致、还是二者同时旧了。可以确认的是：不是“slot 缺失”，而是完整值比较未通过；同 revision 连续不变更强地指向权威服务器仍是旧数据，而非字段格式化问题。

### 4. 当前实现与既定合同一致，不能直接把内存结果视为成功

- `runtime/events.js:937-976` 将 active Swipe 同步写入 `swipe_info[swipe].extra.bioweave` 和顶层 `message.extra.bioweave`；`readFloorSlot()` 读取 Swipe slot。
- `runtime/events.js:1601-1677` 要求权威 readback 完整相等，失败后抛出 `FLOOR_PERSISTENCE_READBACK_FAILED`；`runtime/events.js:1687-1692` 仅在确认后才返回 `commitState: "confirmed"`。
- `.trellis/tasks/10-27-projection-floor-save-race/prd.md:24-35` 和 `docs/bioweave-data-lifecycle.md` 的冻结合同要求 Projection 使用 `host_context` 原生 `saveChat()`，官方 GET 只作确认，不恢复 Projection 专用 `/api/chats/save` 写入兜底。当前 debug 的错误状态符合该 fail-closed 约束，问题在宿主保存没有让权威读取看到新 slot。

## Minimal repair recommendation

### A. 先补足非正文诊断，再决定是否改比较语义

在 `BIOWEAVE_FULL_CHAT_SAVE_READBACK` 诊断中增加布尔字段（不记录 raw slot）：

- `slot_matches_merged`
- `mirror_matches_merged`
- `candidate_floor_version_match`
- `candidate_active_swipe_match`
- `candidate_message_id_match`
- `readback_mismatch_class`（例如 `slot_stale`、`mirror_only_mismatch`、`slot_and_mirror_mismatch`）

这样下一次真实宿主测试可以直接证明 mismatch 属于哪一层。当前白名单没有 `mirror_present`，正是导致 Debug 只能看到“slot 有但整体失败”的原因。

### B. 若确认只是 mirror 不一致，Canonical readback 应只验证 Swipe slot

`readFloorSlot()` 的 canonical source 是 active Swipe 的 `swipe_info[swipe].extra.bioweave`；顶层 `message.extra.bioweave` 是兼容镜像。若下一次诊断显示 `slot_matches_merged=true` 而 `mirror_matches_merged=false`，最小修复是：

- authoritative success 只以 canonical `candidateSlot` 完整相等为准；
- 保留 mirror 写入/同步，但 mirror 差异只作为兼容诊断，不阻断 Floor 确认；
- 增加回归测试覆盖 Swipe 0：server Swipe slot 新值、top-level mirror 缺失或旧值时应确认成功。

这不会把内存状态当作权威，也不会绕过 Floor owner/version/readback。

### C. 若 slot 也旧，不能放宽 readback；应修 host save 的实际落盘入口

若诊断显示 `slot_matches_merged=false`，本次不是比较器误判，而是原生 `context.saveChat()` 返回后权威服务器仍未收到当前 Context 的 slot。应继续保持失败关闭，并针对真实宿主检查：

- `context.chat[messageIndex].swipe_info[activeSwipe].extra.bioweave` 是否在调用 saveChat 前仍为新值；
- saveChat 是否被其它 Chat/generation 生命周期保存覆盖；
- host 的 saveChat 是否需要等待其内部 flush/settle 事件，或当前 SillyTavern 版本是否支持一个正式的 Context save callback；
- 第一次超时留下的 save 是否在第二次测试前已真正 settle（当前 023200 与前一次失败相隔约 61 秒，不能只凭“看起来第二次”推断并发）。

在没有宿主证据前，不建议删除权威 readback、延长重试到无限、或把内存 slot 直接标记为 confirmed；那会让刷新后仍读旧版本时丢失可追溯性。

## Suggested regression tests

1. **Mirror-only mismatch**：权威响应的 Swipe 0 `bioweave` 完整等于 `mergedValue`，顶层 `message.extra.bioweave` 缺失/旧值；若产品选择 canonical-slot 语义，必须确认成功并留下 `mirror_only_mismatch` 诊断。
2. **Stale server slot**：`context.saveChat()` resolved，但权威 GET 五次都返回旧 Swipe slot/同 revision；必须保持 `FLOOR_PERSISTENCE_READBACK_FAILED`，不能把运行时新值当已保存。
3. **Delayed host flush**：第一次 GET 旧 slot，收敛保存后第二/第三次 GET 变为新 slot；必须确认成功，且不得并行 native save。
4. **Swipe/owner guard**：readback 重试期间消息 ID、active Swipe 或四字段 Floor Version 变化时，必须失败关闭，不得写入或确认旧 owner。

## Caveats / Not Found

- Debug 没有记录 candidate slot/mirror 的 fingerprint 或字段级比较结果，也没有 raw `/api/chats/get` payload；因此无法从该附件单独证明 mismatch 是 slot 还是 mirror。
- `revision` 在五次权威 GET 中保持不变，强烈支持“服务器旧版本/保存未落盘”判断，但不排除宿主的 saveChat 内部保存目标或服务器版本计算存在问题；需要真实宿主加诊断后复测。
- 本研究未修改生产代码、测试、规范或既有任务实现文件；只新增了本 research 记录。
