# 代码审计：世界分析提示词首尾 SYSTEM

## 配置与存储

- `storage/schema.js:64-97`：`DEFAULT_WORLD_ANALYSIS_PROMPT`、`promptText()` 和 `normalizeWorldAnalysisPrompt()` 共同拥有提示词字段默认值、trim 与 20,000 字符限制。
- `storage/schema.js:145-158`：`DEFAULT_EXTENSION_SETTINGS.world_analysis_prompt` 显式复制默认字段。
- `storage/schema.js:375-409`：旧全局配置读取时统一经过 normalize，但不会主动写回，因此无需迁移。
- `storage/store.js:395-403`：读取返回 clone；保存当前直接 normalize `raw`。若调用者只传新增字段，旧自定义 task/prefix/suffix 会回落默认值，因此保存入口需要“已有配置 + 显式 raw”合并后 normalize。

## UI 与预览

- `ui/settings.js:719-741`：设置卡使用一个局部 `textArea()` helper 渲染 task/input_prefix/input_suffix，新增字段应复用它。
- `ui/app.js:1874-1919`：表单读取、草稿捕获、保存成功/失败状态都围绕完整 prompt 对象，无需新状态层，只需采集新增键。
- `ui/settings.js:744-760,795-829,874-880`：设置页的“实际发送消息”直接调用 `buildWorldModelMessages()`，并使用 draft 优先的 prompt settings，因此 builder 是预览与请求一致性的单一来源。
- `ui/world.js:606-608` 的独立 World 页面也复用预览组件，但 `ui/app.js:1668-1678` 没传 promptSettings；这是已有 task/prefix/suffix 的历史不一致，不属于本次明确要求的设置页预览范围。

## 请求构建

- `ai/prompts.js:35-50`：`expandPlaceholders()` 已支持大小写不敏感的 `{{user}}`/`<user>` 与 `{{char}}`/`<char>`；`inputNames()` 从 AnalysisInput meta 获取名称。
- `ai/prompts.js:82-120`：`buildWorldModelMessages()` 当前固定返回核心 SYSTEM、AnalysisInput SYSTEM、最近剧情 ASSISTANT、最终指令 USER。
- `ai/analyzer.js:996-1008`：真实 World Analysis 直接把 builder 结果传给客户端。
- `ai/client.js:279-317`：当前 API 与独立 API 均保持传入 messages 的顺序，不需要修改 API Profile 行为。

## 测试与文档

- `tests/world-model.test.js:2292-2379` 已覆盖四段角色顺序和可编辑 task/prefix/suffix；`:2551-2577` 已覆盖设置页消息预览。
- `tests/api-profile.test.js:874-921` 已覆盖 textarea、失败草稿、保存读取与 Secret 排除。
- `docs/UI.md:17` 固定描述四段消息；`docs/DATA-MODEL.md:20` 和 `README.md:408` 需最小同步新增字段。

## 不可变边界

无需修改 `ai/analyzer.js`、`ai/input-builder.js`、World Model schema、Evidence/Consistency Guard、API Profile 或 Secret 路径。新增文本必须保持独立消息，不能拼进固定核心约束。
