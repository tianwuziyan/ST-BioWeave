# Context-first Floor Writer 隔离原型审计报告

日期：2026-10-17
任务：`10-17-context-first-floor-writer`
证据范围：生产源码静态核对、隔离原型测试、现有真实宿主审计报告；本轮没有写入真实 SillyTavern Chat。

## 1. 执行摘要

结论分级如下：

| 结论 | 状态 | 说明 |
| --- | --- | --- |
| 原型实现 | `IMPLEMENTED_IN_PROTOTYPE` | 新增测试专用 Context-first Writer、Host mock、Snapshot merge 和队列。 |
| 隔离测试 | `TESTED_IN_ISOLATION` | 新增测试 23/23 通过；覆盖身份失效、保存未知结果、外部覆盖和 Timing/Aggregation 两阶段。 |
| 单 Context 模型 | `CONDITIONALLY_SAFE` | 在没有外部写入、目标 Context 未漂移且以明确 Host 状态为前提时，Context-first merge 可以工作。 |
| 外部整 Chat / 旧标签页并发 | `PROVEN_UNSAFE` | 无 CAS 时存在确定性 last-write-wins 覆盖；`context-fast` 仍可能报告 `HOST_ACCEPTED`。 |
| 当前真实宿主保证 | `HOST_VERIFIED` 未满足 | 本轮没有真实 Chat 写入测试；mock readback 只能证明测试模型。 |
| 生产默认路径替换 | `BLOCKED` | 尚没有同时满足原生保存完成语义、跨写入者冲突控制和现有 Floor 契约的宿主保证。 |

直接回答：BioWeave 可以借鉴 SevenDaysCal 的 Context 定位、命名空间字段、双写和幂等比较，但当前不能把这种直接写入作为默认生产 Floor 路径。隔离模型确实能把普通 changed 写入降到 0 GET + 1 SAVE，把带确认的单笔写入降到 1 GET + 1 SAVE；但这不等于真实宿主安全，也没有解决外部标签页、其他插件或直接 API 的无条件整 Chat 覆盖。

特别重要的是：

- `context-fast` 的 0 GET 路径只返回 `HOST_ACCEPTED`；不会自动返回 `CONFIRMED`。
- `native-confirmed` 只有在显式 readback 同时匹配身份和 Snapshot 后才返回 `CONFIRMED`。
- 保存响应丢失返回 `UNKNOWN`，不把 Promise 结果或服务端可能已写入映射为成功。
- 在严格语义下，`context-fast` 的 Timing 保存不能继续把 Aggregation 当作已确认成功；原型会停止第二阶段并报告未确认状态。

## 2. 生产 Schema 与现有写入边界

本原型没有发明第二套 Timing/Aggregation 数据结构。

| 事实 | 源码证据 |
| --- | --- |
| `emptyFloor()` 定义 `projection_timing_snapshot` 和 `participant_aggregation_snapshot`，两者都是 `schema_version: 1` + `items` | `storage/schema.js:735-746` |
| Timing Snapshot 只把 `items` 作为完整 Floor collection，规范化、冲突和 Chat scope 检查在 `normalizeProjectionTimingSnapshot()` | `core/projection-timing-persistence.js:20-61` |
| Timing upsert 对相同实例返回 `deduped`，不会重新抽样 | `core/projection-timing-persistence.js:64-92`；实例编辑保留冻结字段见 `core/projection-timing.js` |
| Aggregation Snapshot 同样只把 `items` 作为权威 collection，并检查冲突、拒绝项和 Chat scope | `core/participant-aggregation.js:89-125` |
| Aggregation upsert 对相同内容返回 `deduped` | `core/participant-aggregation.js:128-149` |
| 当前 storage 的 Timing root 是 `projection_timing_snapshot` | `storage/projection-timing.js:14` |
| 当前 storage 的 Aggregation root 是 `participant_aggregation_snapshot` | `storage/participant-aggregation.js:14` |
| 结构化消息的 durable owner 是 `message.swipe_info[swipe_id].extra.bioweave`；active-message `extra` 只是 host mirror | `.trellis/spec/domain/floor-state.md:59-77,95-99,154-166` |

生产 Store 仍是事实源边界：`getFloor()` 从当前消息的 active Swipe slot 读取，`saveFloor()` 通过 adapter 的 slot writer 写入，`readAuthoritativeFloor()` 调用 authoritative reader 并重新检查 host token，见 `storage/store.js:831-849`、`storage/store.js:879-930`。本原型只在测试 Context 中复现这条 slot 规则，不把 `message.extra` 变成第二历史事实源。

当前生产 Coordinator 的 owner 字段表把 Timing root 放在 `projection` owner 下，把 Aggregation root 放在独立 `participant_aggregation` owner 下，见 `storage/floor-persistence-coordinator.js:9-20`。原型里的 `timing` 和 `aggregation` owner 是测试专用别名，不能作为生产 API 迁移依据。

## 3. 参考插件对应关系

### 3.1 SevenDaysCal

实际源码：[`snapshot.js`](https://raw.githubusercontent.com/atonal519/ST-SevenDaysCal/master/snapshot.js)。

- `ctx()` 通过宿主 `getContext?.()` 取得当前 Context，`messageAt()` 取当前消息。
- `writeSnapshot()` 先比较已有 payload，内容不变时不写入；变化时更新主 `message.extra`，并把同一 payload 写入当前 `message.swipe_info[message.swipe_id].extra`。
- `scheduleSnapshotSave()` 优先调用 `context.saveChatDebounced()`；没有该方法时再调 `saveChat()`，后者是 fire-and-forget fallback。
- 该实现没有证明跨标签页 CAS、服务器 authoritative readback、响应丢失后的结果判定，或 BioWeave 的六字段 Floor Version / epoch 契约。

因此本原型借鉴了 Context 定位、命名空间、主 extra/active Swipe extra 双写和内容幂等比较，但额外加入了身份 token、epoch、message object replacement 检查、历史 Floor 拒绝、Snapshot root 白名单、显式状态和可选 readback。

### 3.2 BioTracker

实际源码：[`scripts/state.js`](https://raw.githubusercontent.com/Liuuuu54/st_bs_biotracker/main/scripts/state.js)、[`scripts/host.js`](https://raw.githubusercontent.com/Liuuuu54/st_bs_biotracker/main/scripts/host.js)。

- `scheduleHostChatStateSave()` 按 Chat key 合并插件自己的保存请求。
- `host.js` 对未完成 hydrate 或空/未知 Chat State 采用保守策略，不用未确认的空状态覆盖持久化内容。
- `saveSettings()` 走 `saveSettingsDebounced()`，不把调用返回值当成持久化确认。
- 其主要数据目标是扩展设置 / sidecar Chat State，不是 BioWeave 的 per-Floor `message.extra` Snapshot；不能直接套用其数据模型或并发保证。

## 4. 当前生产路径与原型路径

### 4.1 生产路径

当前 Coordinator 的关键调用边界如下：

```text
business storage
  -> storage/floor-persistence-coordinator.js:613 commitFloorPatch()
  -> owner guard / owner acquisition:300-354
  -> current Floor Version + LATEST_SLOT_READ:356-407
  -> SNAPSHOT_MERGE:424-450
  -> no-op: coordinator readback + FLOOR_TX_READBACK_FAILED guard:452-517
  -> changed: store.saveFloor():519-532
  -> post-save guard:535-541
  -> authoritative readback + sibling/version audit:543-610
```

`store.saveFloor()` 本身固定目标 Chat token 和 Floor slot，见 `storage/store.js:879-907`；当前 SillyTavern adapter 的 `/api/chats/get` 和 `/api/chats/save` 入口分别见 `runtime/sillytavern-adapter.js:397-442`、`runtime/sillytavern-adapter.js:444-484`。这解释了前序审计中普通 changed 事务的 6 GET + 1 SAVE、普通 no-op 的 3 GET + 0 SAVE，以及 Timing + Aggregation 两笔事务的 12/2 与 6/0 基线；数字来自既有真实宿主审计，不是本原型测量。

### 4.2 原型路径

```text
ContextFloorWriter.captureTarget()
  -> resolveFloorTarget(): Chat/Floor/Message/Swipe/6-field Version/epoch/ref
  -> read current active Swipe slot from Context
  -> mergeSnapshot(): owner whitelist + inheritance + explicit empty
  -> update only message.extra.bioweave and active swipe extra.bioweave
  -> injected ContextHostModel.saveChat()
  -> context-fast: HOST_ACCEPTED only
  -> native-confirmed: one readback + identity/payload comparison
```

实现位置：

- `tests/helpers/context-first-floor-writer-prototype.js:3-35`：状态、owner root 白名单；
- `:85-176`：使用生产 Floor Version 的 Timing/Aggregation fixture；
- `:178-236`：Context fixture 与多 Swipe；
- `:238-267`：六字段 Version、Chat/Floor/Swipe/epoch/message ref 和历史 owner 校验；
- `:269-323`：纯函数 Snapshot merge、历史继承和 explicit empty；
- `:325-424`：确定性 Host save/readback mock、响应丢失和外部 full-chat writer；
- `:492-617`：Writer、插件内队列、状态转换和确认；
- `:618-657`：Timing/Aggregation 两阶段逻辑事务。

原型没有 import 或调用生产 Coordinator；唯一复用的是生产 `emptyFloor()` 作为 fixture schema 基础，以及测试中调用生产 timing/aggregation normalizer 进行 schema sanity check。

## 5. Snapshot Merge 与保存状态

### 5.1 Merge 保护

`mergeSnapshot()` 只允许 owner 对应的 root 被 patch，保留未涉及的 sibling root、历史消息、其他 Swipe 和 `extra` 字段。当前 root 缺失时才复制传入的历史 Floor root；显式 `{schema_version: 1, items: []}` 被当成真实清空，不会被历史值覆盖。测试位置：`tests/context-first-floor-writer-prototype.test.js:104-147`。

Timing 与 Aggregation 使用完整 collection root，不按角色另造第二个数据层；两个 valid fixture 都携带完整六字段 `created_at_floor_version`，并保留 `timing_instance_id`、`cycle_id` 和 `sampled_individual_offset_story_days`。测试位置：`tests/context-first-floor-writer-prototype.test.js:317-338`。

### 5.2 状态语义

| 状态 | 原型含义 |
| --- | --- |
| `CLEAN` | 当前 Context 中 merge 结果无变化；没有发起 SAVE；`context-fast` 不宣称权威确认。 |
| `DIRTY` | merge 有变化，尚未发起 host save。 |
| `SAVING` | `saveChat()` 已被调用，等待 server-write/response barrier。 |
| `HOST_ACCEPTED` | mock save 完成并返回，但没有 readback；不是 `CONFIRMED`。 |
| `CONFIRMED` | readback 同时匹配目标身份、六字段 Version、active Swipe 和两个 mirror payload。 |
| `FAILED` | 保存明确在 server write 前失败，且本地目标仍未被外部改写；原型恢复本地修改。 |
| `UNKNOWN` | 响应丢失、readback 不一致或 readback 失败；不自动重放旧 payload。 |
| `STALE` | Chat、epoch、Floor、Swipe、内容/version、消息对象或历史 owner 已变化；不继续写入或不报告成功。 |

`saveChatDebounced()` 在 mock 中返回 `undefined`，只记录“已调度但没有可等待结果”，测试确认它不会成为 `CONFIRMED`，见 `tests/context-first-floor-writer-prototype.test.js:420-425`。

## 6. 隔离测试结果

测试文件：`tests/context-first-floor-writer-prototype.test.js`。

测试总数：23；通过：23；失败：0。所有竞争点使用 `Deferred`、显式 server-write barrier、response barrier 或 readback barrier，没有 `setTimeout` / 固定 sleep。

覆盖矩阵：

| 风险/契约 | 测试位置 | 结果 |
| --- | --- | --- |
| changed / no-op / 双写 / 其他 extra 保留 | `:52-103` | 通过；fast changed 为 `HOST_ACCEPTED`，fast no-op 为 `CLEAN`。 |
| Event、World、Character、Tracking、Projection、Timing、Aggregation owner 白名单 | `:104-130` | 通过；Timing/Aggregation 使用生产 root 名。 |
| 历史继承与 explicit empty | `:132-147` | 通过。 |
| 同 Floor 不同 Snapshot 并发、队列顺序、sibling 合并 | `:149-180`、`:402-418` | 通过；第二任务从当前 Context 读，队列等待计数为 1。 |
| 其他扩展修改 `message.extra`、整 Message 替换 | `:183-201` | 前者保留；后者确定性 `STALE`。 |
| Chat / Swipe / 消息正文 / 删除 / epoch / 历史 Floor | `:203-247` | 均在 SAVE 前或保存后 fail closed。 |
| 明确保存失败 | `:249-259` | `FAILED`，仍拥有目标时恢复本地 Context。 |
| server commit 后响应丢失 | `:261-271` | `UNKNOWN`；官方 mock 已写入但不误报成功。 |
| readback 不一致 | `:273-288` | `UNKNOWN`，记录 `READBACK_PAYLOAD_MISMATCH`。 |
| 旧标签页 / 外部 full-chat writer 覆盖 | `:290-315` | 确定性反例；fast 路径无法观察覆盖。 |
| Timing + Aggregation 两笔独立事务 | `:317-365` | 通过；不合并 SAVE；每阶段独立 readback。 |
| fast 模式未确认时停止 Aggregation | `:367-382` | 通过；不会把 `HOST_ACCEPTED` 当 Timing 成功前提。 |
| Timing 成功、Aggregation 失败的部分成功 | `:384-400` | 通过；Timing `CONFIRMED`，Aggregation `FAILED`。 |

### 6.1 确定性反例的时序

**反例 1：保存后旧标签页覆盖**

```text
T0  Writer 从当前 Context 合并 Timing
T1  saveChat() 捕获整 Chat Snapshot
T2  mock server write 完成，返回 HOST_ACCEPTED
T3  old-tab full-chat writer 写入旧 Snapshot
T4  context-fast 返回 HOST_ACCEPTED；没有 GET，因此无法发现旧 Snapshot 已覆盖
```

这证明 `0 GET + 1 SAVE` 不能在无 CAS 的多写入者环境中提供“数据已保持”的保证。

**反例 2：保存请求发出后其他扩展修改 `message.extra`**

```text
T0  Writer 已修改当前 Context，并调用 saveChat()
T1  Host save 捕获 Writer 的整 Chat Snapshot
T2  其他扩展修改 live Context 的 extra
T3  原始 save 完成并覆盖 official snapshot
T4  live Context 有新字段，official snapshot 没有新字段
```

原型保留了操作前已经存在的其他扩展字段，但不能把“捕获之后的外部修改”合并回已发出的整 Chat SAVE；这是宿主原生整 Chat 保存的边界。

**反例 3：保存期间 Context 生命周期变化**

Chat、Swipe、正文、删除或 epoch 在 save barrier 期间变化时，原型最终返回 `STALE`，不报告确认。若宿主已经接受旧目标写入，旧写入是否需要恢复仍是 `UNKNOWN`，不能仅靠本地状态回滚解决。

## 7. 请求计数与性能对照

下表左侧是既有 Coordinator/真实宿主基线，右侧是本轮隔离 Host mock 的实际计数。原型的 GET 是 `ContextHostModel.readback()` 计数，SAVE 是 mock `saveChat()` dispatch 计数，不是浏览器真实 `/api/chats/*` 网络计数。

| 场景 | 现有 Coordinator 基线 | `context-fast` 原型实测 | `native-confirmed` 原型实测 | 证据 |
| --- | ---: | ---: | ---: | --- |
| 单笔 Floor changed | 6 GET + 1 SAVE | 0 GET + 1 SAVE，`HOST_ACCEPTED` | 1 GET + 1 SAVE，`CONFIRMED` | 既有真实宿主审计 + 隔离测试 `:52-103` |
| 单笔 Floor no-op | 3 GET + 0 SAVE | 0 GET + 0 SAVE，`CLEAN` | 1 GET + 0 SAVE，`CONFIRMED` | 既有真实宿主审计 + 隔离测试 `:70-84` |
| Timing + Aggregation changed | 12 GET + 2 SAVE | 1 SAVE 后停止 Aggregation，严格两阶段完整结果未产生 | 2 GET + 2 SAVE，两个阶段各 1 次 readback | 既有真实宿主审计 + 隔离测试 `:317-338`、`:367-382` |
| Timing + Aggregation no-op | 6 GET + 0 SAVE | Timing `CLEAN` 后停止未确认的 Aggregation | 2 GET + 0 SAVE，两个阶段各 1 次 readback | 既有真实宿主审计 + 隔离测试 `:341-365` |
| Timing changed + Aggregation no-op | 未在既有审计中独立提供 | 未产生完整两阶段结果 | 2 GET + 1 SAVE | 隔离测试 `:341-365` |
| Timing no-op + Aggregation changed | 未在既有审计中独立提供 | 未产生完整两阶段结果 | 2 GET + 1 SAVE | 隔离测试 `:341-365` |

因此不能把“原型 2 GET”写成已证明的生产优化，也不能把 context-fast 的 `1 SAVE` 写成 Timing + Aggregation 完整操作的 1 SAVE 方案：在严格完成语义下，未确认 Timing 时第二阶段被阻断。

## 8. 安全边界矩阵

| 能力 | 原型实现 | 当前真实宿主证据 | 结论 |
| --- | --- | --- | --- |
| Chat/Floor/Message/Swipe/六字段 Version/epoch 定位 | `resolveFloorTarget()` 校验；`messageRef` 变化也拒绝 | 生产 Floor contract 已要求这些身份，但本轮未测试原生 Context 生命周期 | `TESTED_IN_ISOLATION` / `HOST_UNVERIFIED` |
| 当前 Swipe slot 作为 durable owner | 写 `swipe_info[swipe_id].extra.bioweave`，同步 active `message.extra.bioweave` | `storage/store.js:831-849` 和 floor-state contract 支持 slot 规则 | `CONDITIONALLY_SAFE` |
| 历史 Floor 不可变 | 非最新 Character owner 返回 `HISTORICAL_FLOOR_WRITE_FORBIDDEN` | 生产 contract 要求历史 owner 不回写 | `TESTED_IN_ISOLATION` |
| 完整 Snapshot 继承 / explicit empty | merge 纯函数覆盖并测试 | 生产各 persistence normalizer 有相同完整 collection 语义 | `TESTED_IN_ISOLATION` |
| 其他 BioWeave roots / 其他扩展字段保留 | owner whitelist + 非整条 message 替换 | 只证明当前 Context 内写入，不证明 save 期间外部更新可合并 | `CONDITIONALLY_SAFE` |
| 插件内串行 | 单 Writer、按 Chat/Floor/Swipe key 队列 | 不能覆盖其他 tab、设备、直接 API | `TESTED_IN_ISOLATION`，跨写入者 `PROVEN_UNSAFE` |
| SAVE 完成 | fast 只有 `HOST_ACCEPTED`；confirmed 依赖 mock readback | 当前 adapter 只等待 `context.saveChat()` 返回并返回 response/unknown 结果，见 `runtime/sillytavern-adapter.js:575-585`；真实宿主文件写入时点未在本轮验证 | `HOST_UNVERIFIED` |
| 原子 CAS | 原型没有实现 | 当前资料没有证明 `/api/chats/save` 提供条件写入 | `NOT_SUPPORTED` |
| 响应丢失 | 明确 `UNKNOWN`，不重放旧 payload | 真实宿主未知结果仍需真实验证 | `TESTED_IN_ISOLATION` / `HOST_UNVERIFIED` |
| Timing/Aggregation 部分成功 | 两笔独立逻辑事务，Aggregation 失败不回滚 Timing | 与现有业务语义一致，但原型不是生产实现 | `TESTED_IN_ISOLATION` |

## 9. 与现有 Coordinator 的差异

生产 Coordinator 的 no-op 分支在 `storage/floor-persistence-coordinator.js:452-517` 仍做 no-op guard、authoritative readback 和 Floor Version 校验；changed 分支在 `:519-610` 还做 post-save guard、owner-field audit、sibling audit 和 version audit。原型没有删除这些保护，也没有声称可以用 Context 结果替代它们。

原型实际减少的是**架构入口层面的官方读取**：普通 merge 从当前 Context 的 active slot 取基线，而不是先请求服务器整 Chat。它没有证明以下保护可以被删除：

1. 其他写入者在 save 前后的冲突检测；
2. 权威保存结果确认；
3. readback 后的时点外覆盖；
4. 宿主切换 Chat、Swipe、消息对象和保存目标的生命周期关系；
5. 服务器是否支持 revision/CAS。

因此它不是“把六次 GET 机械删成零次 GET”，而是把普通单写入的**本地 merge**和**权威保存确认**分成了两层；确认层仍可能需要 GET，外部冲突则仍需要宿主能力或明确拒绝/fallback。

## 10. 推荐结论与后续条件

### 当前最小结论

可以把 SevenDaysCal 式的以下机制保留为隔离设计方向：

- 当前 Context 作为普通计算与 merge 输入；
- 只修改 BioWeave 自有 root；
- 主 `extra` 与当前 Swipe `extra` 使用同一 payload 镜像；
- 内容等价时不触碰对象、不发 SAVE；
- 插件内按 Chat/Floor/Swipe 排队；
- 将 `HOST_ACCEPTED`、`CONFIRMED`、`UNKNOWN`、`STALE` 分开报告。

但不能在当前证据下把它作为默认生产 Floor writer。推荐保持现有 Coordinator 为生产基线，仅在后续用户单独授权的临时真实 Chat 验证中推进原型。

### 进入真实宿主原型前必须满足

1. 真实安装版本中确认 `getContext().chat`、消息对象替换、Swipe 切换和 `saveChat()` 的目标捕获时点。
2. 明确 `saveChat()` Promise 的实际完成语义；void/undefined/响应丢失必须映射为 `UNKNOWN`，不能映射为 confirmed。
3. 在临时 Chat 中验证 active Swipe slot、主 extra mirror、消息编辑/删除和 Chat 切换，不改用户真实数据。
4. 明确宿主没有 CAS 时的产品策略：禁止外部多写入者、失败后强制 authoritative refresh，或始终保留 Coordinator fallback；不能以插件内存锁宣称跨 tab 安全。
5. 证明 save 前后都能保持现有六字段 Floor Version、epoch、历史不可变、完整继承和显式清空语义。
6. 对 Timing + Aggregation 保留两笔逻辑事务，并规定 Timing 未确认时不得开始可报告成功的 Aggregation。
7. 补充真实宿主的保存失败、响应丢失、保存后立即读取、外部覆盖和页面刷新验证。

若这些条件不能满足，最安全的结论仍是：Context-first 只能作为内部 view/merge 的实验或低风险非确认路径，不能替代现有权威 Coordinator。

## 11. 运行验证与工作区边界

已运行：

- `node --test tests/context-first-floor-writer-prototype.test.js`：23 passed, 0 failed。
- `npm run check`：1650 passed, 0 failed, 16 skipped；退出码 0。全量测试中已有若干预期错误日志，但没有失败测试。
- `git diff --check`：通过，无 whitespace error。

本轮新增文件只有：

- `tests/helpers/context-first-floor-writer-prototype.js`
- `tests/context-first-floor-writer-prototype.test.js`
- `.trellis/tasks/10-17-context-first-floor-writer/audit-report.md`

另更新了本任务的 `prd.md` 和 `implement.md` 以记录用户已批准 Execute。工作区原有生产文件修改、既有 Trellis 任务目录和 `.trellis/tasks/10-15-nsfw-auto-aggregation-diagnostics/` 均未清理、未回退、未覆盖。

最终状态：`IMPLEMENTED_IN_PROTOTYPE` + `TESTED_IN_ISOLATION`；真实宿主仍为 `HOST_UNVERIFIED`，外部整 Chat 并发为 `PROVEN_UNSAFE`，因此当前不进入生产迁移。
