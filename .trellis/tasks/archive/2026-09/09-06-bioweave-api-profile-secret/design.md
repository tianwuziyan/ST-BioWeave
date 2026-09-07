# BioWeave API Profile / Secret 技术设计

## 1. 先审计再定实现

第一步检查既有 `ai/client.js`、`ai/analyzer.js`、`storage/schema.js`、`storage/store.js`、`ui/settings.js`、`settings.html`、`context/`、`runtime/`、导出/日志/Prompt Inspector 相关代码和现有测试。确认当前 Profile 的真实保存位置、SillyTavern 当前 API 的公开接入点，以及是否已经存在 Secret 能力；不根据猜测新增兼容层。

审计后只在现有模块能够自然承载时修改它们。预期优先修改 `ai/client.js`、现有 storage 模块、`ui/settings.js`、`style.css` 和现有测试；只有现有模块无法保持单一职责时才新增文件。

### 审计结论（2026-09-06）

- 现有 `ai/client.js` 直接从 `secret_ref` 解析明文并在浏览器中 `fetch`，而且错误结果会直接暴露异常文本；这不满足本任务的 Secret 边界。
- 现有 `storage/schema.js` 的 `emptyChat()` 包含 `api_profiles`，应移除；Profile 必须放在插件全局 `extensionSettings.bioweave`，不能进入 Chat metadata。
- 当前 `storage/store.js` 只有 Chat/Floor store，没有 Profile/assignment CRUD 或独立 Secret store。
- 当前 `ui/settings.js` 只是占位页，`ui/app.js` 已有稳定 settings 路由，可在现有设置模块和 app 事件委托中承载本任务。
- 当前工程没有 Event/Snapshot/Projection/Log/Export/Prompt Inspector 的 API Key 持久化或输出实现；本任务只需保持通用 Chat/Floor `sanitizeSecrets` 边界，并补充静态/单元回归检查。
- 对照 SillyTavern 官方公开 `getContext()`：插件持久设置使用 `extensionSettings` + `saveSettingsDebounced`；当前 API 使用 `generateRaw()`；ChatCompletion 代理使用 `ChatCompletionService.processRequest()`。
- SillyTavern 的 Secret HTTP API 提供 `/api/secrets/write` 与 `/api/secrets/delete`，Profile 只保存返回的 Secret ID；不调用 `/api/secrets/find`，避免把明文 Key 取回浏览器。独立 API 请求通过官方 `custom` backend 搭配 `custom_url` 和 `secret_id`，由酒馆服务端解析 Secret。

## 2. 数据与安全边界

- Profile 是插件级 API 配置，不属于 Chat-instance-local 动态数据；禁止写入 `chat_metadata["bioweave"]` 或 `message.extra.bioweave`。
- Profile 使用稳定 `profile_id`，对象包含非秘密配置和 `secret_ref`，绝不包含 `api_key`、`key` 或可逆的秘密副本。
- Secret 值只进入独立 Secret Store/宿主公开 Secret API（以审计结果为准），Profile 只保存引用。任何 fallback 都必须与 Chat 数据、Event、Snapshot、Projection、Log、Export、Prompt Inspector 分开，并在文档/测试中明确其边界和限制。
- `secret_ref`、Profile ID、Provider、Model、URL 等元数据可以出现在设置状态，但请求错误、日志和 Inspector 必须对 URL 中可能的 query secret、Authorization、Key 字段统一脱敏。
- 删除/替换 Secret 必须先更新引用关系，再清理旧 Secret；失败重试不能清空上一次仍可用的 Secret 或配置。

## 3. Client contract

`ai/client.js` 保持轻量：负责规范化 Profile、解析执行模式、构造脱敏的测试请求、超时/重试和安全结果，不把分析业务塞入 Client。

- 独立 API：按 Profile 配置发出最小测试请求，所有请求都使用 AbortController/超时和受控重试；仅返回安全的 `ok`、`model`、`latency_ms`、状态码/安全错误摘要。
- SillyTavern 当前 API：通过审计确认的公开宿主能力执行，不读取或保存宿主 Key；不能因为不可用就伪造“连接成功”。
- 失败只允许重试可重试网络/5xx 类错误，Key/权限/参数错误不盲目重试；无论异常内容如何，都不能把原始异常直接展示或写入日志。

## 4. 设置 UI contract

复用当前 `settings` 路由和现有 UI 壳，不创建第二套设置容器。UI 只持有表单编辑态和测试结果态：

- Profile 列表：名称/Provider/Model 等非秘密摘要、编辑、删除。
- 编辑器：常用配置（Profile、Provider、API URL、API Key、Model）+ 默认收起的高级配置（其余五项）+ 保存/取消 + 测试连接。测试连接使用当前内存 draft；新 Key 只通过临时 Secret 引用完成请求，不保存 Profile。
- 选择器：World Analysis、Event Analysis、Projection、History Scan 四个独立槽位，值为 Profile ID 或 SillyTavern 当前 API。
- 结果面板：成功/失败、模型、延迟和安全错误摘要；不显示 Authorization、Key 或完整响应。
- 移动端沿用 UI Foundation 的稳定 documentElement 宿主、响应式 token、safe-area 和滚动策略。

## 5. Scope / non-goals

本任务不实现 API 调用驱动的 Worldbook、World Model、Event、Projection 或 History Scan 逻辑；四个选择器只保存配置选择，不触发分析。不得把设置 UI 的 placeholder DTO 演变成业务数据库。

## 6. 回滚形态

若宿主 Secret/API 接口与审计结果不符，只回滚 client/storage/settings 的本任务 diff；保留此前已验收的 `#extensionsMenu` → documentElement UI Foundation 接入，不改入口和响应式宿主基线。
