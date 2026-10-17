# Context-first Floor Writer 真实宿主验证报告

日期：2026-10-17
任务：`10-17-context-first-floor-writer-real-host-validation`
结论：`HOST_VERIFIED`（受控临时 Chat 的 Context 写入、原生保存与官方 readback 已验证；重载后的 Context 自动重建未验证）

## 1. 执行摘要

本轮在用户确认的 disposable fixture Character Chat 上完成了受控 Phase B 写入；没有修改生产 Coordinator、Adapter、Runtime、UI 或 Snapshot Schema，也没有触碰其他聊天。写入前重新验证了 Chat、Floor、Message、Swipe、正文身份和空的 `bioweave` 目标，并生成了测试专用 token `bw-phaseb-1792237858481-r1aukv71`。

Timing 与 Aggregation 保持两次独立的逻辑保存：每次 `saveChat()` 本身返回 `undefined`，但捕获到 HTTP 200；随后对每次保存分别执行官方 `/api/chats/get`，Snapshot、Floor 身份、主 `extra`/active Swipe 镜像、其他扩展字段和消息正文均匹配。因此这两次结果可报告为 `CONFIRMED`，而不是把 Promise resolve 当成确认。

本次 Writer 捕获到 2 次 `/api/chats/save` 和 2 次官方 `/api/chats/get`，总耗时约 479.6 ms；相比前序 Timing + Aggregation Coordinator 的 12 GET + 2 SAVE，测试模型中的 GET 数量少 10 次。但该数字只证明本次受控 Writer 操作的真实请求计数，不证明生产路径可以直接替换 Coordinator 的并发保护。

页面重载后宿主回到了未选择 Character Chat 的入口状态，无法证明 Context 自动重建；随后使用已经确认的 Chat ID 做了一次只读官方 GET，HTTP 200，两个 Snapshot 根和 Swipe 镜像仍存在。因此“文件级重载后持久化”已得到确认，“页面 Context 重建到同一 Chat”仍为 `RELOAD_NOT_VERIFIED`。

本报告第 3--10 节保留了用户确认临时 Chat 之前的 Phase A/阻断历史；最新 Phase B 证据和结论见第 11 节，优先于其中的历史未执行描述。

## 2. 证据分层

| 证据 | 结果 | 等级 |
| --- | --- | --- |
| 实际宿主 `/version` | `pkgVersion: 1.19.0`、`agent: SillyTavern:1.19.0:Cohee#1207`、`gitBranch: null`、`gitRevision: null` | `SOURCE_VERIFIED`；commit 未验证 |
| 实际宿主 `SillyTavern.getContext()` 结构 | `chat` 为数组；本次 Character Chat 有 `chatId`/`characterId`；`saveChat` 存在；`saveChatDebounced` 未暴露 | `SOURCE_VERIFIED` |
| 实际宿主无文件 `saveChat()` 探针 | Promise resolve `undefined`，无 `/api/chats/get`、无 `/api/chats/save` | `SOURCE_VERIFIED` + `HOST_TEST_BLOCKED` |
| Snapshot 双写、身份 guard、保存状态分类 | 本地注入工具/隔离测试 | `ISOLATED_TEST_VERIFIED` |
| 真实 `extra.bioweave` Floor 写入 | 临时 Chat 当前可写 Floor 写入成功；Timing/Aggregation 双写 | `HOST_VERIFIED` |
| 真实官方 readback | 两次保存后各 1 次 GET，均匹配；重载后额外只读 GET 也匹配 | `HOST_VERIFIED` |
| 页面重载后的 Context 自动重建 | 页面回到未选 Chat；未强行重新选择 | `RELOAD_NOT_VERIFIED` |
| 外部标签页/设备/API 并发 | 未执行 | `HOST_UNVERIFIED` |

## 3. 当前实际宿主证据

### 3.1 版本和构建

浏览器标签页：`http://twzy.myds.me:8001/`。页面显示 `SillyTavern 1.19.0`；只读请求 `/version` 返回：

```json
{
  "agent": "SillyTavern:1.19.0:Cohee#1207",
  "commitDate": null,
  "gitBranch": null,
  "gitRevision": null,
  "isLatest": true,
  "pkgVersion": "1.19.0"
}
```

所以宿主包版本已验证，但具体 Git commit/branch 未验证，标记 `HOST_VERSION_UNVERIFIED`（仅针对 commit 身份）。

### 3.2 Context 暴露层

实际加载的 [`scripts/st-context.js`](http://twzy.myds.me:8001/scripts/st-context.js) 中，`getContext()` 返回：

```text
chat
characterId: this_chid
chatId: selected_group ? group.chat_id : characters[this_chid]?.chat
getCurrentChatId
saveChat: saveChatConditional
saveMetadata
saveMetadataDebounced
```

同一函数没有返回 `saveChatDebounced`。当前实际 `window.SillyTavern.getContext()` 探针结果：

| 字段 | 实际值 |
| --- | --- |
| `chat` | 数组，长度 2 |
| `chatId` | `undefined` |
| `characterId` | `undefined` |
| `getCurrentChatId()` | `undefined` |
| `saveChat` | function，实际为 `saveChatConditional` |
| `saveChatDebounced` | 未暴露 |
| 当前最后消息 | `is_user: false` 的 SillyTavern System UI 消息，无 Character Floor 身份 |

当前两条消息是中性欢迎/系统上下文；当前目标不是 BioWeave 合法 Character/assistant Floor，不能拿它作为 Snapshot owner。

### 3.3 `saveChatDebounced()`

实际加载的 [`script.js`](http://twzy.myds.me:8001/script.js) 中存在导出的 `saveChatDebounced()`。源码行为为：

1. 捕获调用时的 `this_chid` 和 `selected_group`；
2. 取消已有 debounce timer；
3. 通过 `setTimeout` 延迟执行；
4. 执行时如果 group 或 `this_chid` 已变化则放弃；
5. 否则调用 `saveChatConditional()`；
6. 函数本身不返回可等待的 Promise。

这说明它有调用时身份快照和切换时放弃保护，但不能被插件通过当前 `getContext()` 直接等待，也不能把“已调度”当成持久化完成。

### 3.4 `saveChat()`

实际 `script.js` 的 `export async function saveChat({ chatName, withMetadata, mesId, force, chatData } = {})`：

- 计算 `fileName`，无 Chat 文件时直接 `return`；
- 生成 `[chatHeader, ...trimmedChat]` 的完整内存 Chat payload；
- 调用 `compressRequest()`；
- `await fetch('/api/chats/save', saveChatRequest)`；
- `result.ok` 时 `return`；
- integrity 错误需要显式 `OVERWRITE` 后才递归 `force: true`；
- 其他错误在函数内部 catch，记录错误并显示 Toast。

这证明 Promise 至少等待到前端收到 `/api/chats/save` 的 HTTP 响应；本轮没有取得服务端源码，因此不能把 HTTP 成功进一步解释为“文件已持久化并且后续没有覆盖”。此外，`saveChatConditional()` 也 catch 保存错误，Context 暴露的 `saveChat` 可能以 resolved `undefined` 结束，不能单独作为失败信号。

### 3.5 当前中性上下文的实际保存探针

在不修改 Context、不添加字段的前提下调用当前 `getContext().saveChat()`：

| 观测项 | 结果 |
| --- | --- |
| Promise | resolve |
| 返回值 | `undefined` |
| elapsed | 约 101.7 ms（仅本次探针，非性能基线） |
| `/api/chats/get` | 0 |
| `/api/chats/save` | 0 |
| 数据写入 | 0 |

这不是 Floor 写入成功，而是“无 Chat 文件的保存调用没有持久化目标”。因此该结果只能支持 `HOST_TEST_BLOCKED`，不能支持 Context-first Writer 的性能或正确性结论。

## 4. Phase A 原型与隔离测试

### 4.1 新增文件

- `tests/helpers/real-host-floor-writer-verification.js`
- `tests/real-host-floor-writer-verification.test.js`

工具只在测试目录提供注入式 Host Adapter/Probe，不被生产入口 import。

### 4.2 工具边界

`real-host-floor-writer-verification.js` 提供（行号以本轮最终文件为准）：

- `summarizeHostContext()`：只输出 Chat/消息结构、字段名和 root 名，不输出正文（`:64-90`）；
- `assertDedicatedTempChatTarget()`：需要专用 Chat 创建证明、创建 Chat ID、target token 和 dedicated Chat ID（`:92-103`）；
- `assertTargetCurrent()`：复核 Chat、epoch、message 引用、六字段 Floor Version、Character owner 和 active Swipe slot（`:105-122`）；
- `buildProbeSnapshot()`：仅使用 `projection_timing_snapshot` 和 `participant_aggregation_snapshot` 两个生产 root（`:124-130`）；
- `applySnapshotProbe()`：dry-run 默认不写，允许写入时只改 BioWeave root，并同步 message `extra` 与 active Swipe `extra`（`:156-167`）；
- `classifyPersistenceOutcome()`：区分 `HOST_ACCEPTED`、`CONFIRMED`、`FAILED`、`UNKNOWN`、`STALE`（`:169-181`）；
- `createRequestRecorder()`：统计注入/观察事件，明确不是自动捕获真实网络（`:132-148`）；
- `makeHostProbeSource()`：默认 dry-run，无远程 Chat 硬编码（`:222-229`）；
- `createHostProbeRunner()`：注入 Context、save、readback、refresh，不实现生产路径（`:183-220`）。

### 4.3 隔离测试结果

隔离测试文件 `tests/real-host-floor-writer-verification.test.js`（最终 `:1-161`）共 11/11 通过，覆盖：

- 没有 dedicated Chat proof 时拒绝；
- 当前目标身份和 epoch 漂移时拒绝；
- 生产 Snapshot root 及 `schema_version/items` 形状；
- dry-run 不写入；
- message `extra` 与 active Swipe mirror 双写；
- 其他扩展字段和 inactive Swipe 保留；
- save response 未确认、明确失败、响应未知、readback mismatch；
- dry-run 0 SAVE；带 readback 的注入模型 GET/SAVE 计数；
- debounced save 没有被误报为 `CONFIRMED`；
- 探针源默认不包含远程或正式 Chat 目标。

该测试结果只能标记 `ISOLATED_TEST_VERIFIED`。它不能替代真实宿主的消息结构、Chat 文件目标、服务端保存和刷新证据。

## 5. Phase B 是否进入及阻断原因（前置尝试；第 11 节已完成受控验证）

没有进入真实写入，原因不是测试失败，而是安全前置条件不成立：

1. 当前页面没有 Character Chat 身份；
2. 当前 `chatId`/`characterId`/`getCurrentChatId()` 都不可用；
3. 当前最后消息是系统 UI 消息，不是可拥有 Floor 的 Character message；
4. `saveChat()` 对无文件上下文直接返回，实际探针没有产生 `/api/chats/save`；
5. 宿主源码显示其“临时 Assistant Chat”没有 Chat 文件；
6. 若改用已有角色的正式 Chat 或随便选择最近聊天，就会违反本任务“不得使用现有正式聊天”的安全边界；
7. 若通过创建角色/永久助手 Chat 变通，则目标不再是已确认的临时 Chat，且会扩大外部数据修改范围。

所以没有执行以下操作：

- 不点击会创建永久 Assistant/Character Chat 的入口；
- 不选择任何现有角色或最近聊天；
- 不修改任何 `message.extra`；
- 不调用真实 `/api/chats/save`；
- 不做刷新、Swipe 切换、正文编辑或删除测试。

## 6. 请求次数对照

| 操作 | 现有 Coordinator 基线 | 本轮真实宿主 | 本地隔离模型 | 证据 |
| --- | ---: | ---: | ---: | --- |
| 当前中性上下文 `getContext().saveChat()` | 不适用 | GET 0 / SAVE 0 | 不适用 | 宿主探针 + Network 事件 |
| 单笔普通 Floor changed | GET 6 / SAVE 1 | 未执行 | 工具可注入 GET 0 / SAVE 1（未确认）或 GET 1 / SAVE 1（readback） | 前序真实宿主审计；隔离测试 |
| 单笔普通 Floor no-op | GET 3 / SAVE 0 | 未执行 | 未作为真实宿主结果报告 | 前序真实宿主审计 |
| Timing + Aggregation changed | GET 12 / SAVE 2 | 未执行 | 未作为真实宿主结果报告 | 前序真实宿主审计 |
| Timing + Aggregation no-op | GET 6 / SAVE 0 | 未执行 | 未作为真实宿主结果报告 | 前序真实宿主审计 |

本轮没有可报告的真实 Context-first Floor 请求数，也没有可报告的实际耗时改善。中性 save 探针的 0/0 不能与 Coordinator Floor 事务比较，因为它没有目标 Floor、没有 Snapshot 变化、没有保存请求。

## 7. Phase A 未验证与风险（第 11 节已补充最新实测）

### 已验证

- 当前宿主包版本为 1.19.0；Git revision 未提供；
- Context API 的字段和 `saveChat`/debounce 暴露边界；
- 无文件中性上下文的 save resolve 行为和 0/0 网络结果；
- 本地工具的身份 fail-closed、生产 root、双写和结果状态分类。

### 未验证

- 当前目标 Chat 中 `message.extra.bioweave` 与 active Swipe slot 的真实写入；
- 真实服务器 `/api/chats/save` 的文件完成语义、锁、队列、CAS 或 last-write-wins；
- 真实 `/api/chats/get` readback 与刷新后的 Snapshot；
- 页面切换/Swipe/消息编辑/对象替换期间的真实 Writer 目标保护；
- 其他标签页、其他扩展或直接 API 写入下的真实覆盖结果；
- Context-first 路径实际能否减少 Coordinator 的 6/12 次 GET。

### 已知风险

- `saveChatDebounced()` 不提供可等待 Promise，页面关闭/刷新时的未执行 timer 结果未确认；
- `saveChat()`/`saveChatConditional()` 可能 catch 错误并 resolve，不能单独作为失败或 durable confirmation；
- 宿主保存 payload 是完整 Chat 数组，而不是字段级 CAS；没有服务端 CAS 证据时，跨标签页/设备旧快照覆盖风险仍存在；
- 当前 Context-first 原型只能在专用目标 token、身份复核和明确 readback 下工作；插件内锁不能覆盖外部写入者。

## 8. Phase A 阻断时的下一步方案（第 11 节已记录实际进入条件）

本轮不建议直接进入生产改造。若要继续真实验证，必须先取得单独授权，允许使用一个明确命名、可通过 Chat ID/文件名稳定重定位、不会与现有正式聊天混淆的 disposable permanent test Chat；创建前记录 Chat 列表/身份，创建后确认新文件，测试后由用户决定是否手工清理。测试工具必须继续保留：

1. 每次写入前复核 Chat/Floor/message/Swipe/content hash/message version/epoch；
2. 只更新 BioWeave 自有字段，并保留 active Swipe 镜像、其他扩展和历史消息；
3. 通过 Network 事件区分 Writer、宿主刷新和其他扩展请求；
4. `saveChat()` 返回仅记为 `HOST_ACCEPTED`，官方 GET/readback 和刷新后的同一 token/payload 才能升级 `CONFIRMED`；
5. 任何 Chat/Swipe/message 漂移立即停止，不回退到正式聊天补测。

在没有上述 disposable persistent target 之前，结论保持：`HOST_TEST_BLOCKED`。

## 9. Phase A 历史最终结论（已由第 11 节更新）

在用户确认 disposable fixture Chat 之前，当前实际运行的 SillyTavern 能提供可读取的 Context 和原生保存函数，但当时无法在安全、专用且可持久化的临时 Chat 上验证 BioWeave Floor 写入。因此：

**本轮没有达到 `HOST_VERIFIED`，也没有证明 Context-first Floor Writer 可以替代现有 Coordinator。**

## 10. Phase B 前置阻断记录（2026-10-17；已由第 11 节更新）

本轮按用户确认重新读取了同一 SillyTavern 页面，仍未执行写入。

### 10.1 身份检查结果

- 宿主版本仍为 SillyTavern 1.19.0；当前 `/version` 可读，但 commit、branch 和 revision 仍为 `null`，因此 `HOST_VERSION_UNVERIFIED` 仍适用于构建来源。
- `getContext()` 当前可读到 Character Chat：`characterId=7`，`chatId` 与 `getCurrentChatId()` 均为 `与剑灵们的双修日常 - 2026-08-07@01h21m20s881ms`，消息数为 73。
- 当前 Chat 是一个已有较长历史和 Swipe 结构的 Chat；本次页面 Context 没有提供由本验证工具生成的 `dedicatedChatProof`、`createdChatId`、`creationToken` 或 `targetToken`。
- 因而无法证明当前 Chat 是本任务要求的专用 disposable 临时 Chat，也无法证明目标 Snapshot 为空或本次写入不会触碰既有数据。
- 当前消息对象没有可直接读取的 `message_id`、`floor` 或 `message_version` 字段；生产代码可以用消息数组索引作为缺省 `message_id`/`floor` 并从正文计算 hash，但在没有专用 Chat proof 和本次目标 token 的情况下，本轮不能把这种 fallback 当作授权写入依据。

身份结论：`DEDICATED_TEMP_CHAT_PROOF_REQUIRED`，本轮 Phase B 立即停止。没有生成测试 token，因为 token 不能替代专用 Chat 的创建证明；生成 token 并绑定当前已有 Chat 会绕过身份保护。

### 10.2 实际动作边界

本次只执行了版本、Context、Chat/Character 身份和消息结构的只读检查：

- 没有选择或创建其他 Chat；
- 没有修改消息正文、`message.extra` 或任一 `swipe_info[*].extra`；
- 没有调用真实 `/api/chats/save`；
- 没有执行官方 readback、刷新、Swipe 切换、消息编辑或删除；
- 没有产生可归属于本轮 Writer 的真实 GET/SAVE 计数或耗时。

所以本轮仍不能报告 `HOST_VERIFIED`、`CONFIRMED`、刷新持久化成功或性能改善；结论继续为 `HOST_TEST_BLOCKED`。

隔离原型证明了“如何在模型中做身份复核、生产 Snapshot root 双写和明确保存状态分类”，但不证明真实宿主的服务器写入、readback、刷新耐久性或外部并发安全。不得将 0 GET 的中性 save 结果当作性能优化结果。

## 11. Phase B 受控临时 Chat 实测结果（2026-10-17）

本节是用户确认专用临时 Character Chat 后的最新实测记录，覆盖并取代第 3--10 节中“Phase B 未执行”的历史结论；第 3--10 节仍保留作为前置审计和阻断证据。

### 11.1 目标身份与写入前保护

| 检查项 | 实测结果 | 证据等级 |
| --- | --- | --- |
| 宿主版本 | `SillyTavern:1.19.0:Cohee#1207`；`pkgVersion=1.19.0`；Git revision/branch 为 `null` | `HOST_VERIFIED`（包版本）；`HOST_VERSION_UNVERIFIED`（具体 commit） |
| 页面类型 | Character Chat；`characterId=0` | `HOST_VERIFIED` |
| Chat ID | `30Days - 2026-10-02@02h30m27s624ms`，Context 与 `getCurrentChatId()` 一致 | `HOST_VERIFIED` |
| 目标 Floor | 当前 `chat.length=6` 的末尾 Character 消息，数组索引 5；不是历史 Floor | `HOST_VERIFIED` |
| Message ID / Floor | 宿主未提供显式字段，按生产 `messageIdForFloor()` 兼容规则回退为 `5` / `5` | `SOURCE_VERIFIED` + `HOST_VERIFIED` |
| Swipe | active `swipe_id=0`，`swipe_info[0]` 存在；本目标没有其他 Swipe slot | `HOST_VERIFIED` |
| Epoch | 宿主 Context 暴露为 `null`；验证脚本以 `null/undefined` 归一化后复核，未声称宿主提供非空 epoch 保护 | `HOST_UNVERIFIED`（能力限制） |
| 目标清洁度 | 写入前主 `message.extra.bioweave` 与 active Swipe `extra.bioweave` 均为空 | `HOST_VERIFIED` |
| 专用 Chat 证明 | 用户确认 + 页面内 disposable fixture marker + 本次目标 token；宿主没有返回独立 creation record | `CONDITIONALLY_SAFE` |
| 测试 token | `bw-phaseb-1792237858481-r1aukv71`；target token 绑定索引 5，仅用于本次验证 | `HOST_VERIFIED`（验证工具身份绑定） |

这里的“专用 Chat 证明”不是 SillyTavern 原生创建证明：宿主只提供了当前 Chat ID，未提供创建事务或文件创建时间。本次写入之所以允许执行，是因为用户明确确认该 Chat 为专用临时 Chat，且 Context 中存在 disposable fixture 标记；这不能外推到任意已有 Chat。

### 11.2 实际写入内容与调用顺序

验证工具使用当前消息对象引用，不替换整条消息。写入范围为：

1. `message.extra.bioweave`；
2. `message.swipe_info[0].extra.bioweave`；
3. 在两个 `bioweave` 对象中保持相同的 `v`、`floor_version` 和 Snapshot roots。

Timing 使用生产 root `projection_timing_snapshot`，Aggregation 使用生产 root `participant_aggregation_snapshot`。两个 root 都是 `{schema_version: 1, items: [...]}`，item 使用当前生产 `projection-timing` / `participant-aggregation` Schema；没有引入原型专用的第二套字段名。Timing item 的 `timing_instance_id`、`cycle_id` 和 sampled offset 在 Aggregation 阶段保持不变。

实际调用顺序是：

```text
写入前身份/版本复核
  -> 内部合并 Timing root（0 GET）
  -> Context saveChat()                    -> /api/chats/save 200
  -> 官方 readback                         -> /api/chats/get 200
  -> readback 匹配后确认 Timing
  -> 内部合并 Aggregation root（0 GET）
  -> Context saveChat()                    -> /api/chats/save 200
  -> 官方 readback                         -> /api/chats/get 200
  -> readback 匹配后确认 Aggregation
```

保存期间没有修改正文、message identity 或其他 Swipe；原始的其他扩展字段 `api`、`model`、`reasoning`、`reasoning_duration`、`reasoning_signature`、`gouhua_snapshot` 在两次官方 readback 中均保留。真实结果中 `rootMatch`、`identityMatch`、`mirrorMatch`、`siblingMessageFields`、`siblingActiveFields`、`bodyPreserved` 均为 `true`。

### 11.3 保存完成语义

| 阶段 | `saveChat()` 返回 | HTTP 观测 | 状态 | 允许报告为 `CONFIRMED` 的依据 |
| --- | --- | --- | --- | --- |
| Timing | `undefined` | `/api/chats/save` `200`, 113.6 ms 网络等待 | `HOST_ACCEPTED` 后升级为 `CONFIRMED` | 同一目标的官方 `/api/chats/get` 匹配 Timing root、身份、镜像和保留字段 |
| Aggregation | `undefined` | `/api/chats/save` `200`, 58.4 ms 网络等待 | `HOST_ACCEPTED` 后升级为 `CONFIRMED` | 同一目标的官方 `/api/chats/get` 匹配 Aggregation root，并再次确认 Timing root 仍在 |

`saveChat()` 返回 `undefined` 只说明宿主前端调用完成；本次没有把它单独当成成功。官方 readback 是本次将 `HOST_ACCEPTED` 升级为 `CONFIRMED` 的必要条件。若保存抛错、HTTP 不可观测或 readback 不匹配，工具会返回 `FAILED` 或 `UNKNOWN`，不会自动重放原 Snapshot。

### 11.4 真实请求和耗时

以下只统计验证工具安装 fetch 捕获器之后、Timing + Aggregation 两阶段的相关请求；版本 `/version` 请求不计入 Writer，重载后的额外只读 GET 单列。

| 指标 | 实测结果 | 证据说明 |
| --- | ---: | --- |
| Writer 主动/宿主保存 `/api/chats/save` | 2 | Timing 1 次，Aggregation 1 次；均 HTTP 200 |
| Writer 主动官方 `/api/chats/get` | 2 | 每个保存后 1 次 readback；均 HTTP 200 |
| Timing Snapshot merge | 0.4 ms | 页面 Context 内部对象合并 |
| Timing `saveChat()` 等待 | 219.6 ms | Promise 返回 `undefined`；其中捕获到 SAVE 网络段 113.6 ms |
| Timing 官方 readback | 49.1 ms | GET 网络段 35.2 ms |
| Aggregation Snapshot merge | 0.1 ms | 保留 Timing root 后追加 Aggregation root |
| Aggregation `saveChat()` 等待 | 162.0 ms | Promise 返回 `undefined`；其中捕获到 SAVE 网络段 58.4 ms |
| Aggregation 官方 readback | 46.3 ms | GET 网络段 29.0 ms |
| 两阶段总耗时 | 479.6 ms | 从受控 Writer 开始到第二次 readback 完成 |
| 重载后只读官方 GET | 1 | HTTP 200，58.5 ms；不计入上述 Writer 2 GET |

本次真实 Writer 计数为 **2 GET + 2 SAVE**。前序 Coordinator 的同类基线为 Timing + Aggregation changed **12 GET + 2 SAVE**；因此本次实际少 10 次 GET。两者不是同一业务入口的逐字节 A/B 性能实验，不能据此声称 UI 等待必然减少同样的毫秒数，也不能据此证明 Coordinator 的并发保护可以删除。

### 11.5 重载后的持久化

页面 `Page.reload` 后，宿主回到未选择 Chat 的入口状态：`characterId=null`、`chatId=null`、`chat.length=2`。因此：

- `RELOAD_CONTEXT_REHYDRATION = NOT_VERIFIED`：没有通过 UI 猜测重新选择 Chat；
- 没有继续写入、没有恢复旧 Snapshot、没有修改任何其他 Chat；
- 使用已确认的 Chat ID、Character name `30Days` 做了一次只读 `/api/chats/get`，HTTP 200，耗时 58.5 ms；
- readback 的目标索引 5、Message ID 5、Floor 5、active Swipe 0 均匹配；
- `projection_timing_snapshot` 与 `participant_aggregation_snapshot` 均存在，两个 root 的 item ID 均包含本次 token；
- 主 `extra.bioweave` 与 active Swipe `extra.bioweave` 的两个 root 完全一致；`floor_version.chat_id` 匹配目标 Chat。

因此文件级结论为 `POST_RELOAD_READBACK_CONFIRMED`；页面 Context 自动恢复结论仍为 `RELOAD_NOT_VERIFIED`。

### 11.6 当前风险边界

本轮真实宿主验证已经证明：在一个用户明确确认、写入前为空、当前消息为末尾 Character Floor、active Swipe 可定位且使用官方 readback 的受控目标上，SevenDaysCal 式的“修改当前 Context 消息对象 + 原生 `saveChat()`”可以保存 BioWeave 两个生产 Snapshot root，并减少本次 Writer 自身的 Chat GET。

仍未证明、因此不能直接作为生产契约的内容：

- SillyTavern 服务端是否提供跨标签页、跨设备或直接 `/api/chats/save` 的 CAS；
- 其他标签页/设备使用旧完整 Chat payload 时是否会 last-write-wins 覆盖本次 root；
- 其他插件同时替换整个 `message.extra` 或整条消息对象时的真实合并行为；
- 保存请求成功但响应丢失、页面关闭、`saveChatDebounced()` 未执行时的真实 UNKNOWN_OUTCOME 恢复；
- Chat/Swipe 切换、正文编辑或消息删除发生在原生保存异步窗口中的真实宿主行为；
- 非空 epoch 的真实生命周期和服务端保护；
- 真实 Context 重新加载后自动定位同一 Chat 的生命周期行为。

### 11.7 本轮结论

结论分层如下：

| 结论 | 等级 |
| --- | --- |
| 当前 1.19.0 宿主允许在当前消息 `extra.bioweave` 和 active Swipe `extra.bioweave` 上进行这类直接写入 | `HOST_VERIFIED`（限本次目标结构） |
| 两次原生保存各自得到 HTTP 200，并在官方 readback 中确认 | `HOST_VERIFIED` |
| 重载后持久化文件仍包含两个 Snapshot root | `HOST_VERIFIED`（只读官方 readback） |
| 重载后页面 Context 自动恢复到同一 Chat | `RELOAD_NOT_VERIFIED` |
| 直接 Context-first Writer 已经具备替代生产 Coordinator 的全部并发安全 | `UNKNOWN` / 不成立 |
| 可以在生产中默认移除 Coordinator 的保护读取 | `BLOCKED` |

所以，本轮答案是：**SevenDaysCal 式直接 Context 写入在当前宿主上已对受控临时目标得到真实保存验证，并且本次 Writer 实际使用 2 GET + 2 SAVE；但尚不足以作为生产默认路径。** 若进入下一阶段，应先在不改变业务入口的情况下补充真实失败/未知结果和外部并发验证，并定义服务端无 CAS 时的明确回退策略；在此之前不得把本次 2 GET 计数直接迁移到生产 Coordinator。
