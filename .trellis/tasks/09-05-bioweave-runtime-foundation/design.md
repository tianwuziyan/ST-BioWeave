# BioWeave 基础运行层技术设计

## 设计目标

沿用现有 `runtime/`、`storage/`、`core/`、`ui/` 的中等粒度边界，只修正宿主适配、数据边界和生命周期。`index.js` 负责入口组装；`runtime/events.js` 负责 SillyTavern adapter 与生命周期绑定；`runtime/chat.js` 负责 Chat boundary/epoch；`runtime/floor.js` 负责 Floor Version 与分析决策；`storage/schema.js` 负责默认结构和最小数据清洗；`storage/store.js` 负责 Chat/Floor 的读写；`ui/app.js` 负责单一 UI 根节点、路由、主题和销毁。

## 宿主适配契约

只从每次调用时的 `SillyTavern.getContext()` 读取当前宿主状态，不缓存 `chatMetadata` 或 `chat` 引用。使用公共字段：

- `context.chatId`：当前 Chat scope 标识；
- `context.chat`：可变的 `ChatMessage[]`；
- `context.chatMetadata` + `context.saveMetadata()`：Chat-level 存储；
- `context.saveChat()`：Floor/message 保存；
- `context.eventSource` + `context.eventTypes`：生命周期事件；
- `context.getRequestHeaders()`：后续 API 请求所需宿主请求头（本轮不接 AI）。

事件 emitter 的解绑使用 `removeListener(event, listener)`。监听的最小集合包含 `CHAT_CHANGED`、`MESSAGE_UPDATED`、`MESSAGE_EDITED`、`MESSAGE_DELETED`、`MESSAGE_SWIPED`、`MESSAGE_SWIPE_DELETED`、`MESSAGE_RECEIVED`、`GENERATION_ENDED`；不存在的宿主事件可跳过，但不伪造私有事件名。

manifest 添加 `hooks.activate`，由入口导出的 `onActivate` 调用幂等 `init()`；同时导出 `onDisable` / `onDelete` 做运行时销毁，避免在宿主调用 lifecycle hook 时留下 DOM/监听器。

## Chat boundary 与 UI 刷新

`createChatBoundary(adapter)` 维护 `activeChatId`、递增 `epoch` 和订阅者集合。`current()` 每次从 adapter 取当前 Chat；发现变化时递增 epoch 并通知订阅者。`token()` 捕获 `{ chatId, epoch }`，`assert(token)` 在异步保存完成前验证仍处于同一 scope。订阅 API 保持简单，只在现有 `runtime/chat.js` 内实现，不新增 event bus 文件。

runtime 对宿主事件统一调用一次 `chat.current()`，并向 app 发送 invalidation；Chat 变化会把 UI route/focus 重置到 Chat-level overview，普通 message 事件只触发当前 UI 重绘。`destroy()` 用保存的 listener 引用调用 `removeListener` 并清空订阅。

## Menu 与 UI 生命周期

入口只查找/创建 `#bioweave-extensions-menu-entry`，菜单项挂在宿主已创建的 `#extensionsMenu` 内。若激活时菜单尚未出现，使用一次性、可销毁的 MutationObserver 等待目标节点；成功后立即断开 observer。已存在节点时复用它，并替换此前登记在节点上的 handler，而不是再 append 一个节点。

app 持有唯一 `#bioweave-panel`。`mount()` 先复用同 id 节点或创建一次；`open()` 只切换 `data-open`/`aria-hidden`；`close()` 隐藏；`destroy()` 解绑 app 自己的 handler、移除 menu handler、断开 observer、移除自己创建的根节点，并解除 runtime 订阅。index 保存单一 instance，`onActivate`/`init` 幂等。

所有新增/保留的 UI class 统一使用 `bioweave-` 前缀；不引入 `BioState` 或 `bw-` 别名。现有页面骨架可以继续存在，但使用同一前缀，不能把骨架误报成完整页面。

## Chat/Floor storage 设计

### Chat

`getChat(chatId)` 读取当前 `chatMetadata.bioweave`；缺失或 `chat_scope.chat_id` 不匹配时返回 `emptyChat(chatId)` 的深拷贝。`saveChat(chatId, data)` 先验证 payload scope，再在 adapter 保存前验证当前 context 的 chatId 一致。

Chat 数据不把 provider secret 放进对象。storage 边界对递归 payload 中明显的 `api_key` / `apiKey` / `apikey` / `authorization` / `bearer` / secret value 字段做最小清洗，同时保留 `secret_ref` / `secret_id` 这类引用字段。后续 API Profile 任务还需要将完整 profile 放入宿主明文扩展设置或 secrets server 的安全引用路径，并在导出/日志/Prompt Inspector 处统一 mask；本轮不实现这些 UI。

### Floor 与 swipe

对没有 `swipes`/`swipe_info` 的普通消息保存 `message.extra.bioweave`。只要消息存在 swipe 结构，保存目标就是 `message.swipe_info[swipeId].extra.bioweave`，包括 swipe 0；缺失的 `swipe_info[swipeId]` 与 `.extra` 按需创建。读取同样优先 per-swipe；不把另一个 swipe 的结果回退给当前 swipe。只有确实没有任何 swipe 结构的消息才使用 `message.extra.bioweave`。

store 继续按消息所在的 SillyTavern Floor 保存，删除消息后数据随 message 消失，不建立独立孤儿数据库。异步写入捕获当前 Chat ID；context 在写入前变化则抛出 `STALE_CHAT`，让调用方保留旧结果并重试，而不是污染新 Chat。

## Floor Version 与分析元数据

`floorVersion()` 计算 canonical `content_hash`，并返回包含 `chat_id`、`message_id`、`floor`、`swipe_id`、`content_hash`、`message_version` 的对象。未显式提供 message version 时由内容哈希派生一个稳定版本，编辑文本自然改变版本；swipe id 参与版本比较。

`sameFloorVersion(a, b)` 逐字段比较必需 identity 字段。`shouldAnalyze(meta, { version, manual })` 的规则为：manual 永远 true；没有成功结果、失败结果或成功结果版本不同则 true；同一版本成功则 false。`commitAnalysis(previous, attempt, version)` 只在新 attempt 成功时替换成功结果；失败时若存在旧成功结果，保留旧结果并附加本次错误/尝试元数据，否则保存失败状态以支持重试。

## Theme tokens

`ui/app.js` 保留一个 `bioweave_ui_theme` localStorage key，值域为 `tavern`、`light`、`dark`，非法值回退 `tavern`。CSS 只维护一套结构样式和三组 token：tavern 组引用 `--SmartTheme*`，light/dark 组定义 BioWeave 自己的变量。UI 不写 `body` 或宿主 theme class，不触发页面刷新。

## 兼容与回滚

- 宿主 API 不存在时，扩展入口应记录清晰错误并不创建半初始化 UI；纯 Node 单元测试通过注入 fake adapter 验证核心逻辑。
- 如果宿主菜单结构变化，入口只在找不到 `#extensionsMenu` 时等待，不创建替代顶部按钮。
- 如果需要回滚，优先恢复 `manifest.json` hook 与本轮修改的现有模块；不删除用户 Chat 数据。

