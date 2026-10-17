# Context-first Floor Writer 隔离原型设计

## 1. 设计边界

这是一个测试隔离原型，不是生产持久化替代实现。原型必须使用注入的 Context 和 Host Adapter，不能 import 到 `runtime/events.js`、`storage/*` 生产入口，也不能修改现有 Coordinator。

证据标签：

- `SOURCE_VERIFIED`：参考仓库或当前 BioWeave 源码可直接核对。
- `IMPLEMENTED_IN_PROTOTYPE`：后续 Execute 已实现，但不代表生产能力。
- `TESTED_IN_ISOLATION`：确定性隔离测试覆盖。
- `HOST_VERIFIED`：真实 SillyTavern 临时 Chat 验证；本任务默认未满足。
- `CONDITIONALLY_SAFE`：仅在明确前置条件下成立。
- `PROVEN_UNSAFE`：已有确定性反例。
- `BLOCKED`：缺少证据不能判断。

## 2. 参考实现核对

### 2.1 SevenDaysCal：主要参考

源码：[snapshot.js](https://raw.githubusercontent.com/atonal519/ST-SevenDaysCal/master/snapshot.js)。当前可核对的行为：

1. `ctx()` 通过 `getContext?.()` 取得宿主 Context，`messageAt()` 从 `context.chat[mesId]` 取得消息（约 `:33-55`）。
2. `writeSnapshot()` 生成插件自己的 payload，并先以内容比较判定幂等；`ts` 不参与实质内容比较（约 `:73-105`）。
3. 写入主消息 `msg.extra[SNAP_KEY]`，再把同一 payload 镜像到当前 `msg.swipe_info[msg.swipe_id].extra`（约 `:98-137`）。
4. `scheduleSnapshotSave()` 优先调用 `context.saveChatDebounced()`；没有该接口时才用定时器 fire-and-forget 调 `saveChat()`（约 `:36-46`）。
5. 读取只读 `message.extra`，其设计依赖宿主切换 Swipe 时把对应 `swipe_info[i].extra` 同步回 `extra`（约 `:139-162`）。
6. SevenDaysCal 的字段使用自己的前缀和 schema 版本，并保持历史 message 绑定；这解决的是插件自身 snapshot 的生命周期和基本幂等，不等于跨标签页 CAS、服务器权威 readback 或跨插件并发合并。

可直接借鉴：

- 以当前 Context 为普通读写入口；
- 使用插件命名空间字段；
- 主 `extra` 与当前 Swipe `extra` 双写；
- 内容不变时不触碰对象、不触发保存；
- 保存接口通过 Adapter 注入。

必须补足：

- BioWeave 的 Chat/Floor/Message/Swipe/Version/Epoch 身份 token；
- 历史 Floor 继承和显式空集合语义；
- 多模块 Snapshot 合并；
- 同 Floor 插件内队列；
- `HOST_ACCEPTED`、`CONFIRMED`、`UNKNOWN` 的结果区分；
- 其他扩展替换整个 message 或外部标签页旧快照写入的风险暴露。

参考实现没有解决或没有证明：

- save debounced 的实际持久化完成时点；
- 保存响应丢失后的结果判定；
- Context 在保存期间切换 Chat/Swipe 时的目标固定；
- 其他扩展/标签页/设备的 last-write-wins 覆盖；
- BioWeave 六字段 Floor Version 和历史不可变契约。

### 2.2 BioTracker：辅助参考，不直接套用数据模型

源码：[state.js](https://raw.githubusercontent.com/Liuuuu54/st_bs_biotracker/main/scripts/state.js)、[host.js](https://raw.githubusercontent.com/Liuuuu54/st_bs_biotracker/main/scripts/host.js)。

当前可核对的机制：

- `state.js` 从 `host.js` 注入 `getHostContext()`、Chat State load/save 和 `scheduleHostChatStateSave()`，说明其主要持久化目标是扩展设置/sidecar，不是 BioWeave Floor Snapshot。
- `host.js:418-460` 按 Chat ID 保存队列合并连续请求，并对不同宿主类型选择不同接口；该队列只协调插件自己的调用。
- `host.js:271-305` 对空 Chat State 采用保守判定：未确认 hydrate 前不允许用空状态覆盖存档。
- `host.js:353-415` 将“读取失败/内容未知”与“确实没有存档”区分，并保留未确认状态。
- `host.js:192-197` 的 `saveSettings()` 只调用 `saveSettingsDebounced()`，没有把调用返回值当成权威确认。

可借鉴：按 Chat key 合并保存、未知状态禁止空覆盖、Chat Context 读取隔离、保存 Adapter 边界。

不能直接套用：BioTracker 的 `chatStates` 不是 Floor Snapshot；其 host sidecar/extension settings 的版本和生命周期不能证明 SillyTavern message `extra` 的并发安全。

## 3. BioWeave 原型模块边界

采用最小的 Module / Interface / Implementation / Seam / Adapter / Locality 划分：

### 3.1 `ContextFloorLocator`

**职责**：从注入 Context 定位目标 message 和 active Swipe，生成不可变 `FloorIdentity`。

**接口草案**：

```js
resolveTarget({chatId, floor, messageId, swipeId, expectedVersion, epoch})
  -> {identity, message, swipeSlot, currentVersion}
```

**必须拒绝**：Chat ID 不匹配、message id 不匹配、floor 位置变化、active Swipe 不匹配、content hash/message version/epoch 不匹配、消息删除。

Floor 数组下标只能是定位提示，不能是唯一身份。

### 3.2 `BioWeaveSnapshotMerge`

**职责**：纯函数合并一个模块 owner 的 patch 到目标 Floor Snapshot。

**输入**：当前目标 Snapshot、模块 owner、patch、继承策略、明确的 clear sentinel。

**输出**：新的 Snapshot、`changed`、变更字段和冲突诊断。

**规则**：

- 只触碰 BioWeave 自有 root；
- 保留其他 BioWeave root、其他扩展 `extra`、历史 message 和其他 Swipe；
- 缺失 root 才允许按业务契约继承最近合法历史 Floor；
- 显式空数组/空对象必须阻止错误继承；
- 同 Floor 不同 owner 使用结构化 merge，不能用全 message 替换；
- 任何输入对象不原地修改，便于重放和比较。

建议的 owner 到字段映射：

| owner | 只允许写入的 Snapshot root |
| --- | --- |
| `event` | `analysis`、`events`、`character_registry` 等现有 Event-owned root |
| `world` | `world_model`、`world_model_meta` |
| `tracking` | `tracking_window_timeline` |
| `projection` | `projection_timeline` |
| `timing` | `projection_timing` / Timing-owned root |
| `aggregation` | `participant_aggregations` / Aggregation-owned root |

具体字段名必须从当前 schema/现有 storage abstraction 读取，原型不得发明第二份生产 schema。

### 3.3 `ContextFloorWriter`

**职责**：在身份验证后把 merge 结果写回当前消息和对应 Swipe 的 `extra`，只调用注入的 save adapter。

**写入顺序**：

```text
resolveTarget
  -> clone message.extra / current swipe extra
  -> merge only BioWeave root
  -> update message.extra
  -> update message.swipe_info[swipeId].extra
  -> mark DIRTY/SAVING
  -> hostSave()
```

主 `extra` 和当前 Swipe slot 必须写入同一 payload；如果 `swipe_info` 缺失，原型必须根据实际宿主契约选择拒绝或明确标记 `SWIPE_MIRROR_UNAVAILABLE`，不能静默声称双写成功。

### 3.4 `FloorWriteQueue`

**Locality**：按 `chatId + floor + swipeId` 建立操作队列，只存在原型实例内，不是全局跨标签页锁。

**职责**：串行化插件内 Timing/Aggregation 或不同 owner 写入；每个任务重新从当前 Context 取得目标并执行身份检查；不得把 capture 时的旧整条 message 作为 later write baseline。

队列不保护：其他标签页、设备、直接 API、宿主其他模块或替换整个 message 的外部写入。测试必须明确暴露这些限制。

### 3.5 `HostSaveAdapter`

**接口草案**：

```js
{
  save(context) -> Promise<HostSaveObservation>,
  readback(context, identity) -> Promise<ReadbackObservation> | null,
}
```

`save()` 必须能模拟：成功、明确失败、响应丢失、宿主只接受防抖、保存期间 Context 改变。Adapter 返回 `HOST_ACCEPTED` 不得自动返回 `CONFIRMED`；只有注入的 readback 明确匹配 identity 和 payload 才能升级 `CONFIRMED`。

## 4. 状态机

```text
CLEAN
  -> DIRTY                 merge 产生实际变化
DIRTY
  -> SAVING                目标身份复核通过并开始 host save
SAVING
  -> HOST_ACCEPTED         save Promise/host callback 接受，但未确认内容
SAVING
  -> FAILED                明确拒绝/抛错且结果可判定失败
SAVING
  -> UNKNOWN               请求发出后连接/响应结果不明
HOST_ACCEPTED
  -> CONFIRMED             可选 readback 匹配同一 identity 和 payload
HOST_ACCEPTED
  -> UNKNOWN               无 readback 或 Context 已漂移
任意非终态
  -> STALE                 Chat/Floor/Swipe/message/version/epoch 变化
```

`UNKNOWN` 不等于 `FAILED`，也不等于成功。`UNKNOWN` 允许的后续动作是显式确认、停止新写入或重新建立当前 Context View；不得无条件重放旧 payload。

## 5. Timing + Aggregation 原型流程

```text
Timing 输入
  -> resolveTarget + merge timing
  -> independent writer task #1
  -> save observation / optional confirmation
  -> 若 Timing 不是 CONFIRMED：停止，不假装进入成功的 Aggregation 阶段
  -> 使用已确认 Timing 结果重新计算 Aggregation
  -> merge aggregation
  -> independent writer task #2
  -> save observation / optional confirmation
  -> 返回 {timing, aggregation, partialSuccess, finalStatus}
```

原型必须固定 Timing Instance ID、Cycle ID 和 sampled offset；重复执行相同输入必须幂等。Aggregation 失败时返回 Timing 成功/Aggregation 失败的部分状态，但不得回滚或伪造 Aggregation 成功。

请求数量目标只是待验证模型：普通 Floor 修改目标为 0 GET + 1 SAVE，普通 no-op 目标为 0 GET + 0 SAVE，Timing + Aggregation 修改目标为 0 GET + 2 SAVE，Timing + Aggregation no-op 目标为 0 GET + 0 SAVE。目标不是安全证明。

## 6. 测试设计

每个测试使用 `Deferred`/Promise barrier，记录：

```text
scenario
baseline_get_count / prototype_get_count
baseline_save_count / prototype_save_count
merge_count
queue_wait
state
overwrite_detected
readback_required
external_risk
```

必测矩阵：

| 场景 | 原型必须证明/暴露的内容 |
| --- | --- |
| 单次修改 | 目标身份、双写、1 次 host save、状态转换 |
| no-op | 不改变对象、不触发 save、状态 CLEAN |
| 同 Floor 不同 Snapshot | 合并保留 sibling root |
| 同 Floor 并发 | queue 串行，第二任务重新读取当前 Context |
| 同 Snapshot 重复 | 内容等价幂等 |
| 其他扩展改 `message.extra` | 保留字段；若整对象替换导致失效则拒绝/暴露 |
| 其他扩展替换 message | 旧引用不可继续写，返回 STALE |
| Chat/Swipe 切换 | barrier 后身份失败，不写旧目标 |
| message 编辑/删除 | content hash/version 或存在性失败 |
| 历史 Floor | 普通写入拒绝旧 Floor；只读继承可用但不可回写历史 |
| 保存失败 | FAILED，不报告成功 |
| 响应丢失 | UNKNOWN，不自动升级 CONFIRMED |
| readback 不一致 | UNKNOWN/FAILED，记录 mismatch |
| 旧标签页覆盖 | 明确反例；插件内队列不能解决无 CAS |
| 其他模块当前 Floor 更新 | merge 结果不覆盖 sibling；身份失效时拒绝 |
| explicit empty | 清空有效，不能从历史恢复 |
| 保存期间新结果 | 新任务排队，不能用旧 full snapshot 覆盖 |
| Timing/Aggregation 部分成功 | 两笔逻辑事务独立，失败状态准确 |

## 7. 与现有 Coordinator 的比较边界

| 能力 | Context-first 原型 | 现有 Coordinator |
| --- | --- | --- |
| 当前 Context 内部读取 | 原型负责 | Store/Runtime 负责，Coordinator 不替代它 |
| Snapshot merge | 原型纯函数负责 | Coordinator 对 latest slot 做生产 merge |
| 插件内串行 | 原型队列 | 现有 Coordinator 有事务队列 |
| Floor/Swipe/epoch guard | 原型必须补足 | 现有路径已验证 |
| 外部 writer CAS | 无 | 当前宿主接口未证明有 CAS |
| SAVE 完成语义 | 由 Adapter + readback 定义 | 现有路径有 authoritative readback |
| 历史继承/显式清空 | 原型必须复现现有 schema 规则 | 现有 storage abstraction 已承载 |
| 官方 GET | 普通 Context 路径目标为 0，但确认路径可有 GET | 保护阶段已有多次 GET |

旧 Coordinator 不是自动否定原型的理由；但原型必须证明自己没有绕开其必要契约。不能把 `0 GET` 目标当作可以放宽版本保护的理由。

## 8. Execute 进入条件

在 `task.py start` 前需要用户 review：

1. 原型文件放置位置（建议 `tests/helpers/context-first-floor-writer-prototype.js`）。
2. 测试文件是否放置在 `tests/context-first-floor-writer-prototype.test.js`。
3. 是否允许使用测试专用 `readback` mock 记录 `0 GET` 普通路径，同时保留明确的确认/未知场景。
4. 是否接受最终结论可能是 `PROVEN_UNSAFE` 或 `BLOCKED`，不以请求减少为验收条件。

未满足 review 前，不创建原型代码、隔离测试或最终审计报告。
