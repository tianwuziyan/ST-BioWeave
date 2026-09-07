# Research: World Model v1 最小修改映射

- Query: 汇总本地、ST-SevenDaysCal、Anima-Memory-System 证据，给实现者一个不改冻结模块、不新增复杂 Provider、不保存 secret、不复制业务代码的最小映射。
- Scope: mixed
- Date: 2026-09-07

## Findings

### Evidence-backed mapping

| 语义 | 参考实现 | BioWeave 最小映射 |
|---|---|---|
| 固定规则/schema | ST system 注入 `api/client.js:216-219`；Anima OpenAI role 处理 `scripts/api.js:1768-1800` | 继续使用 `ai/prompts.js` 固定 World prompt，作为 `system` 内容 |
| 普通文本/实际输入 | Anima string -> user：`scripts/api.js:1499-1505`；ST 最终追加 user：`index.js:5910` | `AnalysisInput` 作为一条 `user` 消息 |
| 完整消息 | ST `buildMessages()`：`index.js:5850-5910`；Anima blocks 合并：`summary_logic.js:353-377` | 只保留 `[system, user]`；不带历史、角色卡、RAG、记忆业务块 |
| 当前 ST API 边界 | BioWeave `generateRaw({prompt: messages})`：`ai/client.js:188-195`；本地测试：`tests/api-profile.test.js:351-367` | 不先重写 Provider；若仍 400，只核对 `generateRaw` 的宿主契约 |
| 独立 API 边界 | BioWeave `processRequest`：`ai/client.js:197-221`；ST 原始代理 body：`api/client.js:222-239` | 保留现有宿主适配和 `secret_id`，不要把 raw endpoint body 直接塞进另一层 API |
| 可编辑 prompt | ST 按用途分开：`index.js:3162-3192`；Anima `role/content` blocks：`summary_logic.js:18-49` | 如必须开放，只用现有 `prompts.task.world_analysis`（或等价 task key）保存一段文本；不引入全局创作 prompt |
| 标签/label | ST tag settings：`index.js:3170-3176`、保存：`index.js:7078-7100`；worldbook label 是 UI | 不把标签/显示 label 加到 World Model 请求或 schema；稳定 `source_id`/`entry_id` 继续负责选择 |
| secret | BioWeave `secret_ref`/sentinel：`ai/client.js:216-218`、`storage/schema.js:192-215` | 不保存 API key；不复制 ST/Anima 的 flat key 配置 |
| 结果保存 | `ui/app.js:1174-1228`、`storage/schema.js:302-313`、`storage/store.js:419-435` | 只保存 Chat-local `world_model`/`world_model_meta`，raw AnalysisInput 仍不落盘 |

### Recommended implementation order (research conclusion, no code changed)

1. 先把 analyzer 的消息组织对齐为 `system + user`，让固定规则与实际 `AnalysisInput` 分开。当前本地测试明确要求这一形状：`tests/world-model.test.js:64-113`；现状失败已由 `npm test` 复核为 81 pass / 1 fail。
2. 保持 `ai/client.js` 的两条现有适配路径和 secret boundary 不变，先在宿主环境确认 `generateRaw` 是否接受 `prompt: Message[]`。如果 400 仍在 current API，最小修正应只发生在 `runCurrentApi()` 的宿主调用适配，不要新增 Provider。
3. 不引入 ST-SevenDaysCal 的完整 `buildMessages()`，也不引入 Anima 的动态状态/GC/RAG blocks；World Model 已经有 `collectCurrentAnalysisInput()`：`ui/app.js:920-953`，避免重复拼装业务上下文。
4. 可编辑 prompt 不是修复 400 的前置条件。若产品确实要求，复用 `storage/schema.js:2-17` 的 `prompts.task`，只增加 World Analysis 的 task 文本读取；不要把 ST 的 `customPrompt`（明确只给创作链）或 Anima 的角色卡写回机制移植过来。
5. 保持现有 UI 结构化编辑和失败保留旧值：`ui/world.js:148-200`、`ui/app.js:1124-1172`、`ui/app.js:1219-1228`。这轮只需把请求消息形状补齐，不需要改 schema、secret、Chat 存储或新增设置页。

### Critical distinction

- 已证实的本地问题：World Analysis 当前只发一条 system message，而测试/参考实现要求实际输入有 user message。
- 尚未证实的网络问题：当前宿主 `generateRaw` 是否把 `prompt: Message[]` 正确翻译到当前 ST backend；这个必须在实现环境/宿主版本验证。
- 因此最小实现假设应是“先补 message role，保留既有适配器”，而不是把 400 直接归因于 URL、model、secret 或新增 Provider。

## Related specs

- `.trellis/tasks/09-07-world-model-v1/prd.md`
- `.trellis/tasks/09-07-world-model-v1/design.md`
- `.trellis/spec/guides/cross-layer-thinking-guide.md`
- `.trellis/spec/guides/code-reuse-thinking-guide.md`

## Caveats / Not Found

- 研究未修改生产代码、测试、规格、配置或其它 task 目录。
- 外部仓库使用滚动分支；引用的是 2026-09-07 读取到的源码行号，后续实现若需复核应锁定 commit。
- 本报告没有复现真实远端 HTTP 400；已用本地测试确认消息角色契约失败，并定位了需在宿主版本核对的适配边界。
