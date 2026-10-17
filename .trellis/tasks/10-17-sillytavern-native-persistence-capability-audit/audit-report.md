# P1：SillyTavern 宿主原生持久化能力验证审计

审计分支：`fix/world-model-prompt-baseline`
审计日期：2026-10-17
生产持久化逻辑变更：无。
真实 SillyTavern Chat/Floor 写入：无。

## 1. 执行摘要

结论先行：

**当前不能把 SillyTavern 原生 `Context.saveChat()` 当作一个已经满足 BioWeave Floor 一致性契约的更短生产写入路径。**

它确实提供了两个有价值的能力：

1. 当前页面可以直接读取和修改 live `context.chat`，一次原生 Chat 保存请求本身不需要先调用 `/api/chats/get`。
2. 同一页面的普通 UI 保存会通过 `isChatSaving` 等待已有保存，`saveChatDebounced()` 会合并连续触发。

但它没有提供或当前无法证明提供以下能力：

- BioWeave 所需的 Floor Version / Swipe / epoch 条件写入；
- 服务端 expected-revision 或 compare-and-swap；
- 不同插件对同一完整 Chat 的字段级合并；
- 可区分 `SERVER_WRITE_COMPLETED`、`FAILED` 和 `UNKNOWN_OUTCOME` 的公开 `Context.saveChat()` 结果；
- 保存后的权威 Floor readback。

因此，本轮的决策结论是：

> **原生 Context + 原生保存对 BioWeave 只有条件可行性；当前尚未达到普通 Floor 写入生产迁移标准。**

对用户可见的慢点，宿主原生路径有可能减少 BioWeave 自己发出的 `/api/chats/get`，但这只是“去掉应用层 GET”的理论收益。若仍需安全确认，就必须重新补充 owner/revision/readback；若使用 `saveChatDebounced()`，则可能只是把等待移到后台，而且不能作为持久化成功确认。

当前最小安全建议是：

- `Character Timing Config` 等 Chat-local 设置继续使用现有 Chat metadata 路径；
- Timing Instance、Aggregation、Event、World Model、Tracking Window 等 Floor facts 继续走 Coordinator；
- 先不要把 `context.chat` 原地写入作为普通 Floor writer；
- 如要进入原型阶段，必须先获得与实际远程实例匹配的服务端源码或明确的宿主写入契约，并补做带真实服务端边界的隔离/临时 Chat 验证。

本报告严格区分四种证据：

| 标记 | 含义 |
|---|---|
| `SOURCE_VERIFIED` | 已从实际加载的前端资源、本地 BioWeave 源码或固定的官方源码快照核对 |
| `ISOLATED_TEST_VERIFIED` | 本轮确定性 deferred/barrier 测试模型实际通过；不等于真实宿主验证 |
| `HOST_RUNTIME_UNVERIFIED` | 当前远程宿主的运行版本、服务器构建或行为没有足够证据确认 |
| `UNKNOWN` | 现有源码、测试和只读观测不足以判断 |

本报告沿用的前序基线为：

- `.trellis/tasks/10-17-native-host-persistence-architecture-audit/audit-report.md`；
- `.trellis/tasks/10-17-floor-write-path-performance-audit/audit-report.md`；
- `.trellis/tasks/10-17-timing-noop-performance-audit/audit-report.md`。

## 2. 当前实际宿主版本与证据边界

### 2.1 运行页面证据

通过已认证的 Edge SillyTavern 页面只读读取当前同源 `/version`，得到：

```json
{
  "agent": "SillyTavern:1.19.0:Cohee#1207",
  "pkgVersion": "1.19.0",
  "gitRevision": null,
  "gitBranch": null,
  "commitDate": null,
  "isLatest": true
}
```

这确认了当前页面显示的包版本是 `1.19.0`，但 `gitRevision`、`gitBranch` 和 `commitDate` 都为空。因此：

- 运行包版本：`SOURCE_VERIFIED`，同时是当前页面的直接只读观测；
- 运行 commit/branch：`HOST_VERSION_UNVERIFIED`；
- 远程服务器安装目录：未在本机找到；
- 本轮未通过认证 API 执行 Chat、Swipe 或保存写入测试。

前端版本读取代码为官方 `public/script.js:getClientVersion()`，1.19.0 快照行 `502-518`；只有 revision 和 branch 都存在时才展示 commit/branch，行 `510-512`。

### 2.2 可固定的官方源码快照

本轮另行只读 clone 官方 SillyTavern 仓库到：

`/tmp/bioweave-st-host.QAupuu`

快照信息：

| 项目 | 值 |
|---|---|
| package version | `1.19.0`，`package.json:118` |
| commit | `06bde939fb1e9c4c8d8641d810f0a916b5bce127` |
| commit message | `Fix npm release publishing workflow (#6037)` |
| commit date | `2026-09-14T21:01:34+02:00` |
| 公开来源 | [SillyTavern fixed source snapshot](https://github.com/SillyTavern/SillyTavern/tree/06bde939fb1e9c4c8d8641d810f0a916b5bce127) |

该快照的 `package.json` 与运行页面包版本相同，但运行页面没有 commit，所以不能证明远程服务器正是这个 commit。下面所有服务端结论都同时标注“官方 1.19.0 快照已核对”和“当前远程运行 build 未确认”。

## 3. `getContext()`、`saveChat()` 与 `saveChatDebounced()` 调用图

### 3.1 Context 暴露的保存入口

官方 `public/scripts/st-context.js:getContext()` 行 `115-159` 返回：

```text
getContext()
  ├─ chat                  → live Chat array 引用
  ├─ chatMetadata          → live Chat metadata 引用
  ├─ chatId                → 当前角色 Chat 或 group Chat ID
  ├─ eventSource/eventTypes
  └─ saveChat              → saveChatConditional，不是 raw saveChat
```

关键位置：

- `public/scripts/st-context.js:115-127`：`chat`、`chatMetadata`、`chatId`；
- `public/scripts/st-context.js:154-158`：`saveChat: saveChatConditional`；
- 实际远程加载的 `http://twzy.myds.me:8001/script.js` 与官方 1.19.0 快照行号一致。

因此插件从 Context 取得的是可变的当前页面对象，不是一个带服务器 revision 的不可变快照。

### 3.2 同步保存调用图

```text
插件调用 context.saveChat()
  ↓
public/scripts/st-context.js:getContext().saveChat
  ↓
public/script.js:saveChatConditional()                 [9412-9439]
  ├─ waitUntilCondition(() => !isChatSaving, ...)       [9414-9417]
  ├─ cancelDebouncedChatSave()                          [9421]
  ├─ isChatSaving = true                                [9423]
  ├─ saveGroupChat(...) 或 saveChat()                  [9425-9429]
  ├─ saveTokenCache()/saveItemizedPrompts()             [9431-9433]
  └─ finally: isChatSaving = false                     [9434-9438]
```

raw `public/script.js:saveChat()` 行 `7395-7480` 的实际过程为：

```text
saveChat(options)
  ├─ 捕获 metadata / fileName / chat.slice()            [7406-7425]
  ├─ 构造完整 chatHeader + 完整 Chat JSON              [7427-7445]
  ├─ await compressRequest(...)                         [7434-7446]
  ├─ await fetch('/api/chats/save', request)            [7447]
  ├─ result.ok                                           [7449-7450]
  ├─ 非 2xx：解析错误、integrity 处理                  [7453-7475]
  └─ catch：console/toastr，吞掉异常                    [7476-7479]
```

重要事实：

- `saveChat()` 的 HTTP body 在进入 `compressRequest()` 前已经构造；一次调用的 Chat 内容不会因为之后切换页面而重新从另一个 Chat 组装。
- 但该 body 是完整 Chat，而不是只包含 BioWeave 目标字段的 patch。
- `result.ok === true` 后 raw `saveChat()` 直接 `return`，没有调用 `/api/chats/get`，没有比对 Floor Version，也没有权威 readback。
- 非 2xx、网络异常和多数异常在 `saveChat()` 内被 catch；调用者通常只能看到一个 fulfilled `undefined`，不能把 fulfilled 解释为 BioWeave 的 `confirmed`。
- `Context.saveChat()` 指向 `saveChatConditional()`，所以插件拿到的 Promise 是“条件保存流程结束”的 Promise，不是带 commit revision 的保存结果。

### 3.3 防抖保存调用图

```text
saveChatDebounced()                                    [7361-7382]
  ├─ 捕获 chid / selected_group                        [7362-7363]
  ├─ cancelDebouncedChatSave()                         [7365]
  ├─ setTimeout(..., DEFAULT_SAVE_EDIT_TIMEOUT)        [7367]
  │    ├─ group 变化 → abort                           [7368-7371]
  │    ├─ chid 变化 → abort                            [7373-7376]
  │    └─ await saveChatConditional()                  [7378-7380]
  └─ 函数本身没有 return Promise
```

`DEFAULT_SAVE_EDIT_TIMEOUT` 为 `debounce_timeout.relaxed`：

- `public/script.js:465-466`；
- `public/scripts/constants.js:6-17`，`relaxed = 1000`；
- `public/scripts/utils.js:568-584` 的 `debounce()` 会取消上一个 timer，仅保留最后一次触发。

所以 `saveChatDebounced()` 的语义是“安排一次未来的保存”，不是“等待保存完成”。连续调用会合并；调用后页面离开、timer 被取消或 `chid` 改变时可能没有任何 SAVE。

## 4. 原生 `/api/chats/save` 与 `/api/chats/get` 服务端路径

### 4.1 `/api/chats/save`

固定官方 1.19.0 快照中的调用图：

```text
POST /api/chats/save                                  [src/endpoints/chats.js:545-570]
  ├─ 校验 avatar/path，构造 chatFilePath               [547-554]
  ├─ 检查 body.chat 是 Array                        [556-560]
  └─ await trySaveChat(...)                           [557]
       ├─ 每个消息 JSON.stringify，拼成完整 JSONL       [532-533]
       ├─ 可选 checkChatIntegrity                     [535-539]
       ├─ tryWriteFileSync(filePath, jsonlData)        [541]
       │    └─ mkdirSync + writeFileAtomicSync        [src/util.js:1514-1521]
       ├─ 调用按用户/Chat 节流的 backup function         [542]
       └─ response.send({ok:true})                     [558]
```

官方快照的事实：

- 主 Chat 文件的 JSONL 序列化和 `writeFileAtomicSync()` 在 HTTP 成功响应前执行；这支持“该服务端处理已完成主文件替换”的解释。
- `write-file-atomic` 提供文件替换原子性，但当前代码没有 BioWeave 所需的 expected revision/CAS 参数。
- `tryWriteFileSync()` 没有显式 `fsync` 或磁盘持久化确认；不能把函数返回等同于物理存储介质 durable commit。
- integrity check 只读取已有文件首行的 `chat_metadata.integrity`，见 `src/endpoints/chats.js:331-369`。它用于防止把不同完整性 slug 的 Chat 静默覆盖，不是 Chat revision 比较，也不是 CAS。
- 备份函数由 lodash throttle 管理，见 `src/endpoints/chats.js:80-122`。首次调用可能同步执行备份；后续 trailing backup 不属于主 `/save` 的可等待确认契约。
- 在已审计的 endpoint/mount 源码中没有 Chat 级保存队列、expected revision、ETag 或 compare-and-swap 路径。由于当前远程服务端 commit 未暴露，这一结论对实际远程 server build 标记为 `HOST_RUNTIME_UNVERIFIED`。

### 4.2 `/api/chats/get`

固定快照中的调用图：

```text
POST /api/chats/get                                   [src/endpoints/chats.js:592-619]
  ├─ 校验目录和 file_name                           [593-613]
  └─ getChatData(chatFilePath)                       [614]
       ├─ tryReadFileSync → fs.readFileSync           [src/util.js:1528-1537]
       ├─ 读取整个 Chat 文件                         [580]
       ├─ split('\n')                                 [582]
       ├─ 每行 tryParse                               [583-584]
       └─ response.send(chatData)
```

这说明固定快照的 `/api/chats/get` 是整份 JSONL 文件读取与解析，不是只读一个 Floor slot。当前远程服务端没有可读安装目录，因此“实际运行实例是否完全使用这段服务端实现”是 `HOST_RUNTIME_UNVERIFIED`。

### 4.3 锁、队列、CAS 与 last-write-wins

从固定快照 endpoint 源码可以确认：

- 没有应用层 Chat revision 参数；
- 没有服务端 CAS；
- 没有在 `/save` 路由内按 Chat 组织的队列或锁；
- 保存请求发送的是完整 Chat，而不是 field-level patch；
- 多个完整快照请求如果都通过完整性检查，语义上允许后到的无条件替换覆盖先到的写入。

因此：

> `write-file-atomic` 解决的是文件替换过程中不产生半个 JSONL 文件，不解决“两个完整但不同的 Chat 快照谁有权覆盖谁”。

前端 `isChatSaving` 只在一个页面 JavaScript 上下文内有效。它不能约束：

- 另一个标签页；
- 另一个浏览器或设备；
- 直接 `/api/chats/save`；
- 其他插件绕过该标志的完整 Chat 保存。

当前运行 server 是否额外在进程外层提供锁，源码证据不足，标记 `UNKNOWN`，不能依赖。

## 5. 保存完成语义矩阵

### 5.1 宿主公开接口

| 阶段 | 宿主可观察事实 | BioWeave 能否直接当作 confirmed | 证据 |
|---|---|---:|---|
| `saveChatDebounced()` 返回 | 只安排 timer，返回值不是 Promise | 否 | `public/script.js:7361-7382` |
| `saveChatConditional()` 进入 | 等待本页面 `isChatSaving` | 否 | `public/script.js:9412-9424` |
| raw `saveChat()` 调用 fetch | 请求已经进入浏览器 Fetch 流程 | 否 | `public/script.js:7434-7447` |
| HTTP 2xx | 固定官方快照中服务端已执行 `trySaveChat` 并发送 `{ok:true}` | 不能证明 Floor readback；当前远程 server build 未确认 | `src/endpoints/chats.js:545-570`，`saveChat:7447-7450` |
| raw `saveChat()` fulfilled | 成功和被 catch 的失败都可能是 `undefined` | 否 | `public/script.js:7476-7479` |
| Context `saveChat()` fulfilled | 条件保存流程完成；可能是错误被吞掉、等待超时或真正 HTTP 成功 | 否 | `st-context.js:155`、`script.js:9412-9439` |
| `/api/chats/get` 读回目标内容 | 只确认该 GET 时点的服务端内容 | 只有与 owner token/revision 一起校验才可作为 Floor confirmed | 宿主没有内建 readback；BioWeave 自己实现 |

### 5.2 失败、响应丢失和未知结果

| 情况 | 插件通常看到什么 | 可确认的结论 |
|---|---|---|
| 请求发送前 body/压缩失败 | raw save catch + toastr；Context Promise 仍可能 fulfilled | `FAILED` 或 `UNKNOWN_OUTCOME`，不能仅凭 Context 返回值判断 |
| fetch 在发送前 reject | catch；不知服务端是否收到 | `FAILED` 若能证明未发送，否则 `UNKNOWN_OUTCOME` |
| 请求发出后连接中断 | catch；服务端可能已经替换文件 | `UNKNOWN_OUTCOME` |
| 服务端返回 4xx/完整性拒绝 | raw save catch；通常未写主文件 | 可在直接 fetch 层判断 `FAILED`，Context 包装层仍吞错 |
| 服务端返回 5xx | 服务器可能在写入前或写入后失败 | `UNKNOWN_OUTCOME`，需要权威 readback/人工恢复策略 |
| 服务端成功写入但响应丢失 | 浏览器看到网络错误 | `UNKNOWN_OUTCOME` |
| HTTP 2xx | 固定快照中主文件 write 已返回；没有 revision/readback | `HOST_ACCEPTED` / `SERVER_WRITE_COMPLETED` 级别，不能自动升为 `AUTHORITATIVE_READBACK_CONFIRMED` |
| 先 SAVE 后立即 GET | GET 可观察保存后的某一时点 | 不能排除 GET 后又被其他写入覆盖 |
| 页面刷新/关闭时 pending debounce | timer 可能尚未执行 | 保存可能从未发起；结果未知 |

BioWeave 自己的低层 `runtime/sillytavern-adapter.js:274-360` 会把写请求网络异常和 5xx 包装为 `SOURCE_OWNER_SAVE_UNKNOWN`，并在 `requestOfficialChatSave()` 行 `444-485` 保留异常；这是比宿主 public `Context.saveChat()` 更明确的 transport 语义。但当前 Floor 生产路径使用的是 Runtime 的 `saveOfficialFloorSlot()`，而不是简单依赖 Context wrapper。

## 6. 写入顺序与生命周期风险

### 6.1 同一页面

`isChatSaving` 在 `public/script.js:417-419` 声明，在 `saveChatConditional()` 中设置和清除。角色 Chat 切换、新建 Chat、关闭 Chat 会等待它：

- `openCharacterChat():7744-7752`；
- `doNewChat():10618-10645`；
- `closeCurrentChat():10746-10760`。

这提供的是同一页面的协作约束，不是宿主服务器的原子写入约束。

`reloadCurrentChat` 还有 `SimpleMutex`：`public/script.js:1702-1727`，但它只保护本页面 reload 流程，不能约束另一个页面的 `/save`。

### 6.2 Chat 切换

有两种不同情形：

1. 普通宿主 UI 切换：大多数入口等待 `!isChatSaving`，所以当前同步保存期间通常不会切换。
2. pending debounce、直接 API、其他页面或其他插件：没有同等保护。`saveChatDebounced()` 只检查 timer 执行时的 `chid`/group；如果 Chat 已切换，它会放弃该 timer，而不是把保存转移到新 Chat。

raw `saveChat()` 的请求 body 在调用时已组装，调用后切换不能让同一个 body 自动变成新 Chat。但“旧 Chat body 已发出”不等于目标 owner 仍允许写入，也不提供跨页面冲突拒绝。

BioWeave adapter 只做调用前后当前 `context.chatId` 检查：`runtime/sillytavern-adapter.js:575-585`。这能检测本页面 Chat boundary 变化，不能证明远程文件在期间没有被另一写入覆盖；且 `context.saveChat()` 已经把多数错误吞掉。

### 6.3 Swipe 切换与消息编辑

宿主的 Swipe 路径会修改 live message：

- `loadFromSwipeId():10141-10155` 修改 `chat[mesId].swipe_id`；
- `endSwipe():10092-10101` 在 Swipe 变化后调用 `saveChatDebounced()`；
- `MESSAGE_SWIPED` 在 `10315` 附近发出；
- 消息自动编辑 `messageEditAuto():8218-8234` 使用 debounce；
- 正式编辑 `messageEditDone():8397-8434` 最后 `await saveChatConditional()`；
- 删除消息使用 `deleteMessage():1677-1699` 的 debounce 保存。

宿主保存接口自身没有 BioWeave 的 `swipe_id`、`content_hash`、`message_version` 或 epoch 检查。它会保存调用时完整 Chat。若另一个写入者使用旧 Swipe 或旧消息版本的完整快照，服务器源码没有字段级 merge/CAS 来保护当前 Swipe 的 BioWeave slot。

### 6.4 unload / refresh

`beforeunload` 只在 `isChatSaving` 或消息编辑状态存在时阻止卸载：`public/script.js:12593-12598`。它不检查 `chatSaveTimeout` 是否仍有待执行的 debounce。浏览器提示本身也不能保证网络请求完成、服务器写入完成或响应返回。

## 7. BioWeave 当前 Floor 保存路径

### 7.1 当前 Context 与官方 Chat 的关系

BioWeave 有意把 Context 快照和官方权威读取分开：

| 数据 | 入口 | 语义 |
|---|---|---|
| 当前 live Context | `storage/store.js:getCurrentChatOwnerSnapshot()`，`933-947` | 当前页面内存对象；可读，但不是服务器最新 revision |
| 当前 message/Swipe Floor | `storage/store.js:getFloor()`，`831-849`；`runtime/sillytavern-adapter.js:197-233` | 当前 Context 中的 owner slot |
| 官方 Chat owner | `runtime/sillytavern-adapter.js:397-442` 的 `readOfficialChatOwner()` | `/api/chats/get` 返回的完整 Chat、Floor slot 和内容 hash revision |
| 官方 Chat SAVE | `runtime/sillytavern-adapter.js:444-485` 的 `requestOfficialChatSave()` | `/api/chats/save` 完整 Chat POST，不带 expected revision/CAS |

BioWeave source revision 由 `runtime/sillytavern-adapter.js:363-372` 对 Chat ID、character/group、header、metadata 和全部 messages 做稳定 JSON hash；因此它会反映被纳入 messages 的 Swipe/extra 内容变化，但不是宿主提供的递增 revision，也不是服务器锁。它不能把“读到 revision”与之后的无条件 SAVE 变成原子 CAS；两者之间仍有竞争窗口。

### 7.2 Floor writer 的完整路径

普通 Floor 写入通过 `runtime/events.js:createSillyTavernAdapter()` 的 `saveFloorSlot()` 行 `1716-1724` 进入 `saveOfficialFloorSlot()` 行 `923-1437`，并强制附加 `coordinator_transaction: true`。

```text
业务模块
  ↓
storage/floor-persistence-coordinator.js:commitFloorPatch()       [613-708]
  ├─ transaction_key 队列                                          [648-700]
  ├─ OWNER_ACQUISITION / owner guard                               [322-354]
  ├─ current Floor Version resolver                                [356-369]
  ├─ LATEST_SLOT_READ                                               [370-407]
  ├─ SNAPSHOT_MERGE / sibling protection                            [424-450]
  ├─ no-op：COORDINATOR_NOOP_GUARD + readback                       [452-517]
  └─ changed：store.saveFloor() + coordinator readback              [519-610]
       ↓
storage/store.js:saveFloor()                                       [879-908]
       ↓
runtime/events.js:saveFloorSlot()                                 [1716-1724]
       ↓
saveOfficialFloorSlot()
  ├─ live Chat/Floor/Swipe version check                            [976-1000]
  ├─ SAVE_PREWRITE_READ → readOfficialChatOwner()                  [1001-1011]
  ├─ official owner/message/Swipe/Floor Version check               [1029-1228]
  ├─ merge only after latest official owner read                    [1248-1271]
  ├─ direct /api/chats/save via requestOfficialChatSave()           [1272-1323]
  ├─ SAVE_AUTHORITATIVE_READBACK → readOfficialChatOwner()          [1325-1366]
  ├─ host memory sync                                                [1367-1376]
  └─ SAVE_FINAL_SLOT_AUDIT → readOfficialChatOwner()                [1377-1437]
```

因此当前普通 Floor no-op 的 3 GET 和 changed 的 6 GET 是 Coordinator + adapter 的分层权威校验结果，不是宿主 `saveChat()` 自动产生的 GET。

### 7.3 Timing 与 Aggregation 的边界

UI 的当前保存入口为 `ui/app.js:4181-4229`：

- 打开编辑器时保存 `chatId`、`timingInstance`、`editStartFloorVersion`，见 `ui/app.js:4068-4120`；
- 五个输入通过 `Number()` 规范化，见 `ui/app.js:4148-4153`；
- 没有独立的 dirty 标志；恢复默认只覆盖 draft，见 `ui/app.js:4155-4179`；
- 有 current Timing Instance 时总是调用 `runtime.editCharacterTimingInstance()`；
- 没有 current instance 时走 Chat-local `saveCharacterTimingConfig()`，这不是 Floor 写入。

Timing Runtime `runtime/events.js:5480-6037`：

1. 解析当前 Character Floor 和 `editStartFloorVersion`，行 `5485-5492`；
2. `projectionTimingPersistence.editTimingInstance()`，行 `5683-5699`；
3. 权威 Timing readback 并核对 instance ID、cycle ID、五项输入及 frozen offset，行 `5716-5763`；
4. 重新收集 active business data 和 Aggregation snapshot，行 `5795-5815`；
5. 重新计算 trigger，按 `before_min` / eligible / unresolved 等语义 remove、preserve、create 或 update，行 `5816-6011`；
6. Aggregation 独立 Coordinator 写入与 readback，行 `5865-5905`、`5953-6003`；
7. Timing 成功而 Aggregation 失败时返回 `timing_persisted: true` 与 `AGGREGATION_REEVALUATION_FAILED`，行 `5964-5979`。

`storage/projection-timing.js:219-272` 和 `storage/participant-aggregation.js:211-255` 都在 Coordinator 的同一 transaction key 队列中以“队列内 latest snapshot”为 merge 基线；这正是原地 Context 直接覆盖不能自动替代的部分。

`settings.character_timing_configs` 是 Chat-local 配置，见 `storage/character-timing.js:1-23`、`storage/store.js:820-829`；`projection_timing_snapshot` 是 Floor-owned sibling root，见 `.trellis/spec/domain/floor-state.md:218-246`。两者不得用同一 native-save 结论替代。

## 8. 宿主能力与 BioWeave 契约适配矩阵

| BioWeave 契约 | 宿主已提供的内容 | 状态 | 结论 |
|---|---|---|---|
| Chat ID / 当前 Context | `getContext().chatId` 和 live `chat` | `HOST_GUARANTEED`（仅当前页面 live state） | 仍需插件在保存前后检查，不能代表服务器最新 |
| Message ID / Floor / Swipe ID | 宿主消息对象有相关字段和 `swipe_info` | `PLUGIN_MUST_ENFORCE` | 宿主保存不验证 BioWeave 六字段 |
| `content_hash` / `message_version` | 当前 Floor 版本由 BioWeave 计算 | `PLUGIN_MUST_ENFORCE` | Host API 没有 expected version 字段 |
| epoch / generation identity | Context/Chat save 没有 BioWeave epoch | `PLUGIN_MUST_ENFORCE` | 不能交给原生保存接口 |
| 历史 Floor 不可变 | 原生保存只替换完整 Chat 文件 | `NOT_SUPPORTED` | 历史保护必须由 BioWeave merge/owner guard 实施 |
| Snapshot 完整继承 / 显式空值清除 | Host 只序列化传入完整对象 | `PLUGIN_MUST_ENFORCE` | 需要 latest merge 和 sibling presence 检查 |
| 同 Floor 并发合并 | 固定快照无字段级 merge/CAS；前端只有单页标志 | `NOT_SUPPORTED` / 当前 server `UNKNOWN` | 不能用宿主保存代替 Coordinator |
| Timing Instance ID / Cycle ID / sampled offset | 只要插件传入对象可原样保存 | `PLUGIN_MUST_ENFORCE` | Host 不理解其稳定性语义 |
| Aggregation 幂等、before_min、in_window、overdue | Host 不理解业务规则 | `PLUGIN_MUST_ENFORCE` | 仍需 Runtime 重评估和独立结果处理 |
| Timing 成功、Aggregation 失败部分成功 | Native save 没有多事务语义 | `NOT_SUPPORTED` | 两阶段原生写入仍需插件编排和明确结果 |
| 保存失败不得误报成功 | `saveChat()` catch 后通常 fulfilled `undefined` | `NOT_SUPPORTED`（公开 Context 层） | 必须使用可分类的 direct transport 或 readback/fallback |
| Chat/Swipe/消息切换保护 | 同页 UI 等待部分 `isChatSaving`；debounce 有 chid guard | `PLUGIN_MUST_ENFORCE` | 跨页、直接 API、Swipe/version 不受完整保护 |
| HTTP 响应后的主文件写入 | 固定官方快照中 route 等待 `trySaveChat` | `UNKNOWN`（当前远程 server build） | 不能从包版本相同推断远程 commit 完全一致 |
| 磁盘 durable / fsync | 未见显式 fsync | `UNKNOWN` | HTTP 200 不是物理介质确认 |
| 权威 Floor readback | 宿主 `saveChat()` 不做 | `PLUGIN_MUST_ENFORCE` | BioWeave 当前 adapter 已自行做 |

## 9. 当前实现与候选原生路径的请求量

### 9.1 已验证的当前基线

| 操作 | Floor 事务 | `/api/chats/get` | `/api/chats/save` | 证据类型 |
|---|---:|---:|---:|---|
| 普通 Floor no-op | 1 | 3 | 0 | 前一轮隔离测试/源码 + 真实宿主 Debug；见上一轮报告 |
| 普通 Floor changed | 1 | 6 | 1 | 前一轮隔离测试/源码 + 真实宿主 Debug |
| Timing + Aggregation no-op | 2 | 6 | 0 | 前两轮真实宿主 Debug 与审计报告 |
| Timing + Aggregation changed | 2 | 12 | 2 | 前两轮真实宿主 Debug 与审计报告 |

Timing + Aggregation no-op 仍有两笔事务，因为 Timing 编辑完成后 Runtime 不以“输入未变”替代权威 Timing readback，随后仍会重新计算 Aggregation；Timing no-op 不蕴含 Aggregation no-op。

### 9.2 宿主原生 API 的源代码级计数

| 路径 | GET | SAVE | 是否实测当前远程宿主 |
|---|---:|---:|---|
| raw `saveChat()` 单次调用 | 0（函数内没有 `/api/chats/get`） | 1 次 `POST /api/chats/save` | `SOURCE_VERIFIED`；网络运行计数未做真实写入 |
| `saveChatDebounced()` 触发并完成 | 0（该函数本身） | 0 或 1；被取消则 0 | `SOURCE_VERIFIED`；未做真实写入 |
| Context `saveChat()` | 0 个已知 GET | 0 或 1，取决于 group/条件等待 | `SOURCE_VERIFIED`；完成语义不足 |
| 原生 Context + Timing no-op 预判 | 理论 0 | 理论 0 | `UNKNOWN`，未实现、未证明安全 |
| 原生 Context + Timing changed | 理论 0 | 理论 1 | `UNKNOWN`，未验证同 Floor 并发和成功语义 |
| Timing + Aggregation 各自原生保存 | 理论 0 | 理论 2 | `UNKNOWN`，仍无 CAS/readback/部分失败保证 |
| Timing + Aggregation 合并一次原生保存 | 理论 0 | 理论 1 | 不建议；会改变现有部分成功边界，未实施 |

最后四行是方案设计的理论值，不是已实现性能承诺。当前没有任何生产路径迁移，也没有用 mock 计数冒充真实宿主计数。

### 9.3 是否只是把等待转移到后台

- Timing editor 的 `ui/app.js:4212-4303` 会 `await runtime.editCharacterTimingInstance()`，并在结果后才关闭 `saving`、校验并显示成功；当前 Floor 路径的等待是真实同步等待。
- `saveChatDebounced()` 不被 UI 等待；SevenDaysCal 类似地调用 debounce 后继续 UI 流程，上一轮报告已确认这类路径不能证明保存完成。
- 使用 native debounce 可能让用户感觉更快，但代价是：保存可能尚未发起、失败可能延迟到 toast、页面关闭可能丢失 pending timer，且不能提前显示“已安全持久化”。
- 使用 native immediate save 会把等待变成一次完整 Chat upload；它不自动消除网络/服务器写入等待。

## 10. `/api/chats/get` 偶发秒级等待审计

### 已证实

1. BioWeave adapter 把请求准备、`fetch` network wait、response body read、JSON parse、normalize 和 source revision 分开记录，见 `runtime/sillytavern-adapter.js:274-360`、`397-440`。
2. 真实宿主样本中部分 GET 的 `fetch()` 等待达到约 1.6～2.0 秒，而最新样本 JSON parse 只有数毫秒；这一事实来自此前 Debug，不是本轮新增真实写入。
3. 官方 1.19.0 服务端快照的 `/api/chats/get` 使用同步 `fs.readFileSync`，然后对完整 JSONL 做 `split` 和逐行 parse，见 `src/endpoints/chats.js:577-589`、`src/util.js:1528-1537`。
4. 官方快照的 `/api/chats/save` 也会做完整 JSONL stringify 和同步 atomic write，见 `src/endpoints/chats.js:532-542`。

### 尚未证实

- 秒级等待究竟来自远程网络、浏览器调度、Basic Auth/proxy、Node 事件循环被同步读写阻塞、磁盘、备份，还是多个请求排队；
- 当前远程 server 是否有本地改动、额外锁或 reverse proxy；
- 当前 `/api/chats/get` 的服务端实际耗时和文件大小关联。

因此本轮不能把秒级等待根因定性为“物理网络”或“JSON parse”。最小只读诊断建议是下一轮在真实宿主上记录同一请求的：浏览器 request/response 时间、response body 到达时间、Chat 文件大小（如果宿主日志可提供）、服务端入站/出站时间或 `Server-Timing`；不需要修改 BioWeave 生产持久化逻辑。若服务端无法提供时间戳，只能保留当前 `network_wait_duration_ms` 的“边界等待”结论。

## 11. 隔离测试结果

新增测试：

`tests/sillytavern-native-persistence-capability-audit.test.js`

测试使用 deferred Promise 和显式释放点，没有使用固定 `setTimeout` 制造竞争。模型对应固定 1.19.0 源码可观察边界，但不导入远程 SillyTavern 运行时代码。

本轮定向测试实际通过 18 个用例；全量 `npm run check` 还包含仓库既有测试，结果记录见第 15 节。定向用例覆盖：

- raw save 的 server-write / HTTP-response / readback 三个边界；
- HTTP/服务器失败时 fulfilled `undefined` 的歧义；
- debounce 可取消、连续调用合并、unload 丢失风险；
- 同页 `isChatSaving` 串行等待；
- 两个完整 Chat writer 的 last-write-wins；
- 不同 extension 修改不同 `extra` 字段时不能自动合并；
- 直接 API 绕过同页队列；
- atomic replacement 不是 CAS；
- 响应丢失后的 `UNKNOWN`；
- 失败后 retry；
- Chat、Swipe、message、epoch 变化时旧 owner 不应当被当作当前 owner；
- SAVE 后的 GET 会被之后的完整快照覆盖；
- 保存期间 Chat 切换保持旧请求目标；
- live Context 与 official state 分叉时，Context-only no-op 判断不安全。

测试文件关键位置：

- 源码/证据边界说明：`tests/sillytavern-native-persistence-capability-audit.test.js:4-14`；
- deferred/barrier 模型：`18-146`；
- save completion：`156-190`；
- debounce/同页串行：`192-239`；
- full Chat overwrite/CAS/extra merge：`241-302`；
- unknown/retry/lifecycle：`304-385`。

证据等级：

- 测试通过 = `ISOLATED_TEST_VERIFIED`；
- 不等于 `HOST_RUNTIME_VERIFIED`；
- 未执行真实保存、真实 Chat 切换、真实 Swipe 竞争、真实响应丢失注入，符合本轮禁止修改真实 Chat 的边界；
- 当前测试模型没有模拟 Node `write-file-atomic`、Express response flush、真实浏览器 unload 或远程跨标签页，因此这些维度仍是 `HOST_RUNTIME_UNVERIFIED`/`UNKNOWN`。

## 12. 原生方案的安全边界

### 方案 A：Context 原地修改 + 原生 immediate save

**状态：`CONDITIONALLY_SAFE`，当前 `NOT_YET_PROVEN`。**

可以成立的最窄边界：

- 只处理当前 Chat、当前 Character Floor、当前 active Swipe；
- 保存前用完整六字段 Floor Version、Chat ID、message ID、Swipe ID、epoch 校验；
- 通过 per-Chat 队列串行化 BioWeave 自己的写入；
- 保存前仍需取得最新可接受的 owner merge 基线，或明确证明不存在外部 writer；
- 保存结果必须能区分 confirmed/failed/unknown，并在 unknown 时 readback；
- 只在权威确认后才向 UI 报成功；
- 发生 Chat/Swipe/message/version 变化时在 native dispatch 前拒绝或退回严格 Coordinator。

当前宿主 public Context 不满足最后三项的完整组合；因此不能直接实施。

### 方案 B：插件统一写入队列

**状态：`CONDITIONALLY_SAFE`，但不能单独解决跨页面竞争。**

可以合并同一页面内 BioWeave 自己的 save request，减少自己制造的并发和重复上传；不能阻止另一标签页或直接 `/api/chats/save`。若无 server CAS，队列只能扩大“本插件单页面安全窗口”，不能成为全局一致性证明。

Timing 与 Aggregation 也不能未经设计地合并为一次 native SAVE，因为当前 Runtime 明确保留：Timing 已成功、Aggregation 失败时的部分成功结果，见 `runtime/events.js:5964-5979`。

### 方案 C：持久化前 no-op 检测

**状态：UI dirty 只能 `CONDITIONALLY_SAFE` 用于提示，不能作为 Floor 短路依据。**

- UI draft 与打开时值相同，只能证明 UI no-op；
- Timing no-op 必须以当前权威 Timing Snapshot 和完整 owner token 判定；
- Aggregation no-op 仍需重新读取 Timing、Exposure、Tracking Window、active Event 和当前 Aggregation，因为 Timing 参数未变时其他输入仍可能改变；
- 当前 UI 没有 dirty 状态，见 `ui/app.js:4078-4120,4148-4166`；
- 隔离测试已证明 live Context 与 official state 分叉时 Context-only no-op 会错判，见测试 `380-385`。

因此可以把 dirty 用作“无需提交提示”或减少 UI 工作，但不能未经权威检查阻止 Runtime 保存。

### 方案 D：混合式 native + strict fallback

**状态：架构上最有希望，但当前 `NOT_YET_PROVEN`。**

建议的安全方向是“native path only before dispatch, strict path after uncertainty”，而不是 native 发出后遇到未知结果再盲目 fallback：

1. native dispatch 前检查宿主能力、owner token、当前 Chat/Swipe/message/epoch；
2. 没有可确认的 revision/CAS、save Promise 或目标 owner 时，直接走现有 Coordinator；
3. native 请求已发出后发生网络未知，不能立刻再走 Coordinator；必须先 readback/冲突确认，否则保持 `UNKNOWN_OUTCOME`；
4. native path 不能把 Context 内存对象当第二事实源，最终仍要把结果收敛回 Floor storage 语义。

该方案可以减少正常路径的 GET，但只有在真实宿主提供可依赖的 revision/冲突边界后才值得进入原型。

## 13. 推荐的下一阶段最小方案

### 不立即迁移生产 Floor writer

当前推荐：**暂不修改 Coordinator、Adapter、Runtime 或业务规则；不要把 native Context save 作为 Timing Instance 的生产替代路径。**

### 进入原型验证前必须补齐

1. 获取当前远程实例的服务端源码或由宿主管理员提供可验证的 build/commit；至少确认 `/api/chats/save` 的实际 route、文件写入、锁和版本行为。
2. 明确一个可等待的保存契约：`confirmed`、`failed`、`unknown` 三态，而不是 fulfilled `undefined`。
3. 若继续支持同 Floor 并发安全，必须有服务端 CAS/冲突拒绝，或明确禁止/检测所有外部 writer；插件内 mutex 不能替代跨标签页/跨设备保护。
4. 为 native path 定义完整 owner token：Chat ID、message ID、Floor、Swipe、content hash、message version、epoch，以及 save 前后检查点。
5. 设计 unknown 结果处理：保存已发出后不能直接 fallback；需要带 revision/目标内容的权威确认或明确失败恢复。
6. 用临时/隔离 Chat 做真实宿主验证，覆盖 Chat 切换、Swipe 切换、消息编辑、两个标签页旧快照、不同 `extra` 字段、服务端成功但响应丢失、save-then-get。该测试需要用户另行授权，本轮没有执行。
7. 在原型通过后，再测量 native immediate 与现有 Coordinator 的真实 GET/SAVE、UI wait 和错误语义；不能用理论 0 GET/1 SAVE 作为性能承诺。

### 可先借鉴但不直接套用的设计

上一轮参考项目审计已经确认，SevenDaysCal 的严格外置路径和 BioTracker 的保存队列提供了有用模式：写队列、expected revision、写后确认、unknown 状态、同 Chat 生命周期 guard。但 BioTracker 主要保存 extension settings，SevenDaysCal 的轻量 `message.extra` 快照也没有 BioWeave Floor 的六字段 owner、历史不可变和 Aggregation 部分成功契约；它们不能直接证明 BioWeave 可以移除 Coordinator。

## 14. 最终回答

### BioWeave 能否在不改变 Floor 数据模型与一致性契约的情况下改用宿主原生保存？

**只能有条件地说“可能”，当前不能说“已经可以”。**

宿主已经提供：

- 当前 live `context.chat`/message/Swipe 对象；
- 同页保存等待和 debounce；
- 固定官方快照中主 Chat 文件在 HTTP 响应前进行 atomic replacement。

插件仍必须补充：

- 完整 Floor owner/version/epoch 校验；
- latest merge 与其他 `message.extra` 字段保留；
- 跨模块/同页写入队列；
- 可分类的保存完成结果；
- unknown readback 与成功提示门槛；
- Timing/Aggregation 的独立事务和部分成功语义。

仍无法由当前宿主保证：

- 跨标签页、跨设备或直接 API 的冲突拒绝；
- 服务端 revision/CAS；
- 当前远程 server build 的锁、队列和 durable write 细节；
- native save 后的 BioWeave Floor 权威 readback。

所以当前 P1 结论是：

> **原生 Context + immediate save 值得进入“只读/临时 Chat、先验证宿主能力”的原型研究，但不值得直接进入生产 Floor 持久化改造。**

本轮没有修改生产持久化逻辑，没有删除任何 GET/readback，没有修改真实 SillyTavern Chat/Floor，也没有实施性能优化。

## 15. 验证结果与工作区边界

本轮实际执行：

```text
node --test tests/sillytavern-native-persistence-capability-audit.test.js
18 passed, 0 failed, 0 skipped

npm run check
1623 tests total, 1607 passed, 0 failed, 16 skipped

git diff --check
passed
```

`npm run check` 的输出包含本轮新增测试和工作区已有测试；过程中出现的若干 `BioWeave` 错误日志是既有测试主动注入的失败/取消场景，相关测试均通过，未产生失败项。

本轮新增或修改的任务范围文件：

- `.trellis/tasks/10-17-sillytavern-native-persistence-capability-audit/audit-report.md`；
- `.trellis/tasks/10-17-sillytavern-native-persistence-capability-audit/research/host-source-evidence.md`；
- `.trellis/tasks/10-17-sillytavern-native-persistence-capability-audit/prd.md`、`design.md`、`implement.md`、任务上下文 JSONL；
- `tests/sillytavern-native-persistence-capability-audit.test.js`。

没有修改生产 Coordinator、Adapter、Runtime、UI 业务逻辑或 SillyTavern 源码；没有写入真实 Chat/Floor。工作区中其他既有修改和未跟踪 Trellis 目录保持原状。

Markdown 影响检查：本轮只新增审计任务报告和任务研究文档，没有改变生产行为或公共接口，因此无需同步修改 README、架构契约或生命周期合同。

仍然存在的 blocker：远程 SillyTavern 服务端 commit、锁/CAS 语义和真实响应丢失边界未能确认；进入生产原型前需要用户另行授权临时 Chat 的真实写入验证。
