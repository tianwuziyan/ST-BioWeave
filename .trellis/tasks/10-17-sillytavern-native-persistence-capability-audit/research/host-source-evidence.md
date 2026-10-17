# Research: SillyTavern 宿主原生持久化源码证据

- Query: 核验当前实际运行 SillyTavern 的根目录、版本/commit/启动状态，并追踪 `saveChat()`、`saveChatDebounced()`、`/api/chats/save`、`/api/chats/get`、并发/版本控制和 Chat/Swipe/消息生命周期。
- Scope: mixed（当前 Edge 已认证运行页面 + 本机工作区只读对照）
- Date: 2026-10-17

## Findings

### 1. 当前运行宿主与版本

- **SOURCE_VERIFIED**：当前 Edge 标签页是 `http://twzy.myds.me:8001/`，页面可见宿主标识为 `SillyTavern 1.19.0`。证据来自该运行页面的无副作用 DOM 读取，页面位置为最近聊天面板 `#version_display` 附近；该页面也加载了 `http://twzy.myds.me:8001/script.js`、`/scripts/chats.js` 等核心资源。
- **SOURCE_VERIFIED**：当前运行页面的同源 `/version` 接口返回：`{"agent":"SillyTavern:1.19.0:Cohee#1207","pkgVersion":"1.19.0","gitRevision":null,"gitBranch":null,"commitDate":null,"isLatest":true}`。前端源码 `http://twzy.myds.me:8001/script.js` 的 `getClientVersion()`（行 502-518）请求 `/version`，将 `pkgVersion` 写入显示版本，并且只有在 `gitRevision` 与 `gitBranch` 同时存在时才显示分支/commit（行 504-512）。
- **HOST_RUNTIME_UNVERIFIED**：运行服务端没有公开 commit、branch 或 commit date；`gitRevision`、`gitBranch`、`commitDate` 均为 `null`。因此 commit 级别身份无法确认，但当前运行版本号 `1.19.0` 已由宿主自身 `/version` 响应确认。
- **UNKNOWN**：本机没有找到该远程宿主的安装根目录或源码 checkout，也没有找到本地正在运行的 SillyTavern 进程。常见本机目录搜索、Git checkout 搜索和监听进程检查均未命中 `SillyTavern`。不能把本机 BioWeave checkout 或其他 GitHub 版本当作宿主源码根目录。
- **HOST_RUNTIME_UNVERIFIED**：直接用本机 `curl` 读取 `http://twzy.myds.me:8001/manifest.json`、`/script.js`、`/api/version` 等路径均收到 `401 Unauthorized`（`WWW-Authenticate: Basic realm="SillyTavern"`）；已认证浏览器页面的 Network/CDP 资源响应才提供了下面的前端源码证据。未做任何保存、Chat/Swipe 切换或真实数据写入。

### 2. 前端 `saveChat()` 与 `/api/chats/save`

- **SOURCE_VERIFIED**：运行宿主 `http://twzy.myds.me:8001/script.js` 的 `saveChat()` 位于行 7395-7480。它将当前内存 `chat`（或显式 `chatData`）裁剪/复制为 `trimmedChat`（行 7421-7425），组装 `chatHeader`（行 7427-7432），随后 POST `/api/chats/save`（行 7434-7447），请求体包含 `ch_name`、`file_name`、`chat`、`avatar_url`、`force`（行 7439-7445）。
- **SOURCE_VERIFIED**：`saveChat()` 仅以 `fetch()` 返回的 `result.ok` 作为成功返回条件（行 7447-7451）；非 2xx 时解析错误并特殊处理 `error === 'integrity'`（行 7453-7475）。普通异常被捕获并显示“Chat could not be saved”提示（行 7476-7480）。源码没有在该函数内做保存后的 `/api/chats/get` 权威回读。
- **SOURCE_VERIFIED**：前端请求使用 `cache: 'no-cache'`、`getRequestHeaders()` 和 `compressRequest()`（行 7434-7439），但当前前端源码未显示 CAS token、revision/etag、服务端版本号或 compare-and-swap 字段。**HOST_RUNTIME_UNVERIFIED**：服务端是否在请求体之外提供锁、队列、文件原子替换或版本校验，因服务端源码不可得，不能推断。
- **SOURCE_VERIFIED**：另一个前端调用点在 `http://twzy.myds.me:8001/script.js` 行 7335-7350（角色重命名历史 Chat），同样直接 POST `/api/chats/save` 并只检查 `saveChatResponse.ok`。

### 3. `saveChatDebounced()`、等待与完成语义

- **SOURCE_VERIFIED**：`saveChatDebounced()` 位于 `http://twzy.myds.me:8001/script.js` 行 7361-7382。每次调用先 `cancelDebouncedChatSave()`（行 7365），再用 `setTimeout`（行 7367）安排保存；回调先检查捕获的 `selectedGroup` 与当前 `selected_group`（行 7368-7371），再检查捕获的 `chid` 与当前 `this_chid`（行 7373-7376），通过后调用 `saveChatConditional()`（行 7378-7380）。这是 debounce + Chat/Group 身份门槛，不是服务端 CAS。
- **SOURCE_VERIFIED**：`DEFAULT_SAVE_EDIT_TIMEOUT` 等于 `debounce_timeout.relaxed`（`http://twzy.myds.me:8001/script.js` 行 466-470）；源码注释只明确 `debounce_timeout.long` 为 1,000 ms，未在当前证据片段中给出 `relaxed` 的具体数值，因此具体 debounce 毫秒数为 **UNKNOWN**。
- **SOURCE_VERIFIED**：`saveChatConditional()` 位于 `http://twzy.myds.me:8001/script.js` 行 9412-9439。它等待 `isChatSaving` 清除，等待超时只记录 warning 并返回（行 9413-9417）；随后取消 debounce、设置 `isChatSaving = true`（行 9420-9424），调用 `saveGroupChat()` 或 `saveChat()`（行 9425-9429），最后在 `finally` 中设置 `isChatSaving = false`（行 9434-9438）。
- **SOURCE_VERIFIED**：`isChatSaving` 是前端单页面内存标志（`http://twzy.myds.me:8001/script.js` 行 417-419），并非跨标签页/跨进程锁。`saveChat()` 的 `Promise` resolve 只代表浏览器收到 `fetch` 的成功 HTTP 响应；不能升级为磁盘落盘或随后权威 readback 已确认。
- **SOURCE_VERIFIED**：页面卸载保护在 `http://twzy.myds.me:8001/script.js` 行 12594 附近注册 `beforeunload`；当 `isChatSaving` 或消息编辑状态仍在进行时阻止卸载。**UNKNOWN**：该浏览器保护是否能覆盖进程崩溃、网络断开或服务端已接收但响应丢失，源码没有提供保证。

### 4. `/api/chats/get` 与 Chat 读取

- **SOURCE_VERIFIED**：`getChat()` 位于 `http://twzy.myds.me:8001/script.js` 行 7634-7669，POST `/api/chats/get`（行 7638-7647），请求包含 `ch_name`、`file_name`、`avatar_url`（行 7642-7646），并检查 `response.ok`（行 7649-7651）。成功后解析 JSON（行 7653），把首项当作 `chatHeader` 并取出 `chat_metadata`，其余数组替换当前内存 `chat`（行 7654-7659）；空/损坏文件会清空内存 Chat（行 7660-7664）。
- **SOURCE_VERIFIED**：读取完成后调用 `getChatResult()`，再发出 `CHAT_LOADED`（`http://twzy.myds.me:8001/script.js` 行 7668-7669）。**HOST_RUNTIME_UNVERIFIED**：服务端读取是否经过队列、锁、缓存、JSONL 增量解析或文件锁，当前没有服务端源码证据。
- **UNKNOWN**：任务要求调查 `/api/chats/get` 偶发秒级等待；当前前端代码只定义请求和响应解析边界，没有服务端耗时/锁等待诊断证据，不能把秒级等待归因于锁、队列、磁盘或网络。

### 5. Chat、消息、Swipe 生命周期事件

- **SOURCE_VERIFIED**：运行宿主 `http://twzy.myds.me:8001/scripts/events.js`（通过已认证页面加载响应读取）行 7-25 定义 `MESSAGE_SWIPED`、`MESSAGE_SENT`、`MESSAGE_RECEIVED`、`MESSAGE_EDITED`、`MESSAGE_DELETED`、`MESSAGE_UPDATED`、`MESSAGE_SWIPE_DELETED`、`CHAT_CHANGED`、`CHAT_LOADED`、`GENERATION_STARTED`、`GENERATION_STOPPED`、`GENERATION_ENDED`；行 51-55 还定义 `CHAT_DELETED`、`CHAT_CREATED`、`CHAT_RENAMED`。
- **SOURCE_VERIFIED**：消息编辑路径在 `http://twzy.myds.me:8001/script.js` 行 8405 附近发出 `MESSAGE_EDITED`，随后在行 8431-8433 发出 `MESSAGE_UPDATED` 并调用 `saveChatConditional()`。消息删除路径在行 1611 附近发出 `MESSAGE_DELETED`；删除消息后的保存/刷新也使用 `saveChatDebounced()` 或 `saveChatConditional()`（行 1691-1699）。
- **SOURCE_VERIFIED**：Swipe 删除路径在 `http://twzy.myds.me:8001/script.js` 行 9369-9403：从 `message.swipe_info` 删除对应项（行 9369-9371），重新计算 `newSwipeId`（行 9373-9381），设置 `message.swipe_id`（行 9385-9387），发出 `MESSAGE_SWIPE_DELETED`（行 9388），最后调用 `saveChatConditional()`（行 9400-9403）。
- **SOURCE_VERIFIED**：Swipe 变化后的保存入口在 `http://twzy.myds.me:8001/script.js` 行 10095-10098，注释明确 `swipe_id` 变化时调用 `saveChatDebounced()`；生成/接收消息路径还会发出 `MESSAGE_RECEIVED`、`CHARACTER_MESSAGE_RENDERED`（例如行 6691-6694、6716-6718）。
- **SOURCE_VERIFIED**：Chat 加载完成发出 `CHAT_LOADED`（`script.js` 行 7668-7669）；Chat 切换和新建在行 7700-7705 发出 `CHAT_CHANGED`、条件性的 `CHAT_CREATED` 以及首条消息事件。**HOST_RUNTIME_UNVERIFIED**：事件发出与服务端文件完成写入之间没有公开的 post-save hook 证据。

### 6. 服务端 save/get、锁/队列/版本/CAS 能力

- **HOST_RUNTIME_UNVERIFIED**：实际运行服务端的 route/controller、文件读写实现、锁、队列、版本字段、ETag/CAS、原子替换和错误映射均未能从本机文件系统取得。宿主通过远程地址运行，HTTP Basic Auth 阻止了无认证本机 `curl`，而浏览器已加载资源只覆盖前端模块。
- **UNKNOWN**：不能从前端存在的 `isChatSaving`、`saveChatConditional()` 或 `result.ok` 推出服务端有全局锁、Chat 级队列、版本比较或 last-write-wins 规则。也不能从一次 `/api/chats/save` 200/OK 推出权威持久化或 readback 成功。
- **HOST_RUNTIME_UNVERIFIED**：没有进行真实保存、并发覆盖、失败注入、响应丢失、刷新/关闭或 save-then-get 实验，符合本任务“不得修改真实 Chat”的约束。

### 7. 与本地 BioWeave 代码的证据边界

- **SOURCE_VERIFIED（本地项目，不是宿主源码）**：`runtime/sillytavern-adapter.js` 行 399-437 封装 `/api/chats/get`，行 449-480 封装 `/api/chats/save`，行 575-585 调用宿主 `context.saveChat()`；行 197-221 读写 `message.swipe_info[swipeIndex].extra.bioweave`。这些是 BioWeave 当前适配层实现，不能反向证明远程宿主服务端的锁/CAS。
- **SOURCE_VERIFIED（契约对照）**：`.trellis/spec/domain/floor-state.md` 要求当前 Chat、消息、active Swipe 和完整六字段 Floor Version 作为 Floor 所有权边界；`docs/ARCHITECTURE.md` 将 `runtime/sillytavern-adapter.js` 定义为原始 Host I/O 边界、`storage/floor-persistence-coordinator.js` 定义为 owner-scoped transaction。该契约不能替代宿主 save/get 的未取得服务端实现证据。

## Caveats / Not Found

- **HOST_VERSION_UNVERIFIED（仅针对 commit 级别）**：当前运行版本号 `1.19.0` 由同源 `/version` 确认，但 commit/branch/date 全为 `null`，因此不存在可确认的 commit 身份。
- 未发现当前远程宿主的本机安装根目录、Git checkout、启动命令或 Node 进程；远程地址的服务器文件系统不在本机可读范围内。
- 没有用 GitHub 其他版本替代当前宿主源码，也没有将本地 BioWeave 或历史研究中的 host API 结论冒充当前服务器源码。
- 浏览器页面在只读检查过程中被重新加载以捕获已认证资源响应；未点击保存、未切换/修改 Chat 或 Swipe、未提交任何真实数据。页面随后恢复到 SillyTavern 主界面。
- 由于服务端源码与真实 save/get 实验均不可用，服务端锁/队列/CAS、秒级 get 等待根因、响应丢失后的最终结果、刷新/关闭边界均保持 `HOST_RUNTIME_UNVERIFIED` 或 `UNKNOWN`，不应进入“宿主已保证”的能力清单。
