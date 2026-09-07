# Research: BioWeave 本地请求形状与 World Model 边界

- Query: 确认当前 BioWeave 的 World Analysis 请求形状、Bad Request 可能边界、Chat/UI/secret 存储约束，并给出 ST/Anima 消息格式到本地代码的最小映射。
- Scope: internal
- Date: 2026-09-07

## Findings

### Files found

- `ai/client.js` — 当前 API 与独立 API 的宿主适配、错误归一化、模型探测。
- `ai/analyzer.js` — World Model 请求构造、响应提取与固定 schema 校验。
- `ai/prompts.js` — 固定 World Model prompt/schema；通用 prompt builder。
- `ui/world.js` — World Model 展示、中文未知值、结构化编辑器。
- `ui/app.js` — AnalysisInput 收集、AI 分析、Chat metadata 保存与失败保留旧模型。
- `storage/schema.js` — profile/assignment、prompt 设置容器、URL/secret 清理、Chat-local 槽位。
- `storage/store.js` — 以当前 Chat token 和 `bioweave` metadata 读写 Chat-local 数据。
- `tests/world-model.test.js` — World Model schema/parser/request/UI/storage 契约。
- `tests/api-profile.test.js` — 独立 API `processRequest` 形状、当前 API `generateRaw` 形状、无 key 泄漏契约。

### 请求形状：最值得优先核对的真实问题

1. `createAnalyzer().analyzeWorldModel()` 当前把完整 prompt 作为一个 system message 发送：`ai/analyzer.js:197-205`。`buildWorldModelPrompt()` 把规则、`AnalysisInput`、固定 schema 全拼在一个字符串中：`ai/prompts.js:54-73`。

2. 当前 API 分支不是直接发 OpenAI JSON，而是调用宿主 `generateRaw`：`ai/client.js:188-195`。`messagesForRequest()` 原样保留非空消息数组：`ai/client.js:179-182`，因此实际传给宿主的是：

   ```js
   context.generateRaw({
     prompt: [{ role: 'system', content: '<完整 World prompt>' }],
     responseLength: <number>,
     signal,
   })
   ```

   这与 ST-SevenDaysCal 直接送往 ST 代理的 `body.messages` 形状不是同一层 API。若 Bad Request 来自当前 API，第一嫌疑是 BioWeave 对当前宿主 `generateRaw` 的适配契约，而不是 World Model JSON parser。

3. 独立 API 分支调用 `ChatCompletionService.processRequest`：`ai/client.js:197-221`，payload 形状为：

   ```js
   {
     stream: false,
     messages: [{ role: 'system', content: '<完整 World prompt>' }],
     model,
     chat_completion_source: 'custom',
     custom_url: <normalized base URL>,
     secret_id: <opaque ref or __bioweave_no_secret__>,
     max_tokens,
     temperature,
   }
   ```

   `processRequest` 的宿主签名和 `custom_url`/`secret_id` 字段是 ST 版本相关的适配边界；不能把它当成第三方端点原始 HTTP body。

4. 本地测试已经暴露了消息组织的真实漂移：`tests/world-model.test.js:64-113` 明确要求 current/independent 两路消息角色为 `['system', 'user']`，并要求 `AnalysisInput` 出现在第二条消息；当前实现实际只有 `['system']`。执行 `npm test` 的结果是 81 项通过、1 项失败，唯一失败正是该断言（`tests/world-model.test.js:107`）。这比“猜测某个字段名导致 400”更直接地指出了当前 World Analysis 的消息组织缺口。

5. `tests/api-profile.test.js:289-349` 只验证独立 API 宿主 payload 的 opaque `secret_id`、normalized URL 和无 `api_key`；`tests/api-profile.test.js:351-367` 只验证当前 API 的 `rawOptions.prompt` 是数组且没有 `api_key`。这些测试证明了本地安全边界，但不能证明所有已安装 ST 版本的 `generateRaw` 都接受当前数组形状。

### 最小 ST/Anima 消息映射

- 固定规则放 `system`，实际 `AnalysisInput` 放一条普通 `user` 消息；这满足本地失败测试，也与 ST-SevenDaysCal 的 `system + history + user` 组织和 Anima 的普通文本规则一致。不要把整段 `AnalysisInput` 复制到 system 之外的复杂业务 pipeline。
- 最小消息可表达为：

  ```js
  [
    { role: 'system', content: '<固定 World Model 规则 + schema>' },
    { role: 'user', content: 'AnalysisInput:\n<JSON>' },
  ]
  ```

- 不要先改整个 `ai/client.js` 的 Provider 架构。先保持当前 profile/assignment 路由，只在 analyzer/prompt 与已有宿主适配边界之间补齐 `system + user`；若真实宿主仍对 `generateRaw({prompt: messages})` 返回 400，再只核对/调整 `runCurrentApi` 的宿主调用格式。
- 不要把 ST-SevenDaysCal 的 `reverse_proxy`、`proxy_password` 或 Anima 的 `Authorization: Bearer <key>` 直接引入 BioWeave；本地约束是 profile 只保留 `secret_ref`，宿主 secret store 通过 opaque reference 工作：`storage/schema.js:192-215`、`ai/client.js:216-218`。

### Prompt、UI 与保存边界

- `storage/schema.js:2-17` 已有全局 `prompts: { prefix, suffix, task }` 容器，但当前 `buildWorldModelPrompt()` 不读取它（`ai/prompts.js:54-73`）；所以现状没有 World Model 可编辑 prompt 的生效路径。最小实现若确实需要可编辑，只应把一个 task-local 文本映射到现有 `prompts.task`，不要新增 Provider 或复制业务 prompt pipeline。
- `ui/app.js:920-953` 统一收集当前 Chat 的 AnalysisInput；`ui/app.js:1174-1228` 分析后只保存规范化 `world_model` 和 `world_model_meta`，分析原文只放临时 preview 状态。
- `ui/app.js:995-1015` 从当前 Chat metadata 读取模型；`ui/app.js:1124-1172` 手动编辑保存同一个 Chat-local 槽位，校验失败或 Chat 切换时保留旧模型。`storage/schema.js:302-313` 的 `emptyChat()` 只预留 `world_model`/`world_model_meta`，没有 profile/key。
- `ui/world.js:148-200` 使用结构化字段和三态能力值编辑；`ui/world.js:22-46` 将 null/空值显示为“未知”。不需要将 ST 的 UI label 当成消息字段。
- `storage/store.js:419-435` 以 `bioweave` metadata 和 Chat token 读写，说明 prompt/profile 全局设置与 World Model Chat-local 结果应保持分离。

### Related specs

- `.trellis/spec/frontend/index.md` — 前端层约束索引。
- `.trellis/spec/guides/cross-layer-thinking-guide.md` — 请求、输入、存储跨层契约。
- `.trellis/spec/guides/code-reuse-thinking-guide.md` — 复用现有适配边界，不复制业务代码。
- `.trellis/tasks/09-07-world-model-v1/prd.md`、`design.md`、`implement.md` — 固定 schema、World Analysis、Chat-local 保存、无 secret 持久化和不新增复杂 Provider 的任务约束。

## Caveats / Not Found

- 未直接读取用户当前运行的 SillyTavern 版本实现，因此 `generateRaw` 的精确入参仍需实现阶段在宿主环境核对；本地 fake context 只能证明 BioWeave 的调用形状。
- `npm test` 的失败是确定的本地消息角色契约失败，不等于已经复现远端 HTTP 400；它能定位最小修正方向，但不能单独证明 400 的 HTTP 响应来源。
- 未修改生产代码、测试、规格或其它 task 文件。
