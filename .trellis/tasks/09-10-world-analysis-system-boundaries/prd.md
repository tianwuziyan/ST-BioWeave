# 世界分析提示词首尾 SYSTEM 消息

## Goal

为 `world_analysis_prompt` 增加可编辑的 `system_top` 与 `system_bottom`，使用户可以分别向 World Analysis API 请求的绝对首部和绝对尾部插入独立 SYSTEM 消息，同时保持旧配置、现有中间消息、变量替换和请求预览行为一致。

## Background

- 当前 `buildWorldModelMessages()` 固定生成四条消息：核心 SYSTEM、AnalysisInput SYSTEM、最近剧情 ASSISTANT、最终指令 USER。
- 设置页的“实际发送消息”预览直接调用 `buildWorldModelMessages()`，并接收当前 `worldAnalysisPromptDraft` 或已保存设置。
- `normalizeWorldAnalysisPrompt()` 是默认补全、保存前清洗和读取后归一化的共同边界；现有提示词字符串由同一个文本规范化函数去除首尾空白并限制为 20,000 字符。
- 当前分支为 `fix/world-model-prompt-baseline`，规划开始时工作区干净。

## Requirements

- R1. 在全局 `world_analysis_prompt` 配置中新增字符串字段 `system_top` 和 `system_bottom`，默认值均为 `''`。
- R2. `normalizeWorldAnalysisPrompt()` 必须返回这两个字段；缺失或非字符串值按空字符串处理，字符串沿用现有提示词文本的 20,000 字符长度限制。
- R3. 旧配置缺少新增字段时不得触发迁移，也不得覆盖或重置用户已有的 `task`、`input_prefix`、`input_suffix` 或内部 `labels`；保存入口收到部分对象时也必须先保留已有字段，再统一 normalize。
- R4. 设置 → 世界分析提示词 → 提示词设置增加两个可编辑 textarea：
  - `顶部 SYSTEM` / `system_top`，说明为“发送给 API 时作为 messages[0]。”
  - `尾部 SYSTEM` / `system_bottom`，说明为“发送给 API 时作为 messages 最后一项。”
- R5. 表单读取、失败后草稿保留、保存、重新读取与页面渲染必须保留两个新增字段。
- R6. `buildWorldModelMessages()` 对归一化且变量展开后非空的 `system_top` 生成独立 `{role: 'system', content}`，并将其放在消息数组绝对第一项。
- R7. `buildWorldModelMessages()` 对归一化且变量展开后非空的 `system_bottom` 生成独立 `{role: 'system', content}`，并将其放在消息数组绝对最后一项，即最终 USER 消息之后。
- R8. 新增 SYSTEM 文本不得拼接到既有 SYSTEM content 中；任一新增字段为空时不得发送空 SYSTEM message。
- R9. 新增 SYSTEM 文本沿用当前 `{{user}}`、`{{char}}`、`<user>`、`<char>` 的大小写不敏感变量替换规则，名称来源不变。
- R10. 两个新增字段均为空时，消息角色和内容顺序保持当前四消息行为。
- R11. 请求预览继续以 `buildWorldModelMessages()` 的返回值为唯一消息来源，真实展示新增后的首尾 SYSTEM。

## Acceptance Criteria

- [x] AC1. `system_top = 'TOP'`、`system_bottom = 'BOTTOM'` 时，第一项严格等于 `{role: 'system', content: 'TOP'}`，最后一项严格等于 `{role: 'system', content: 'BOTTOM'}`。
- [x] AC2. 同一场景中，现有核心 SYSTEM、AnalysisInput SYSTEM、最近剧情 ASSISTANT、最终指令 USER 的相对顺序与内容职责不变。
- [x] AC3. 两字段为空或旧配置缺失时，不生成空 SYSTEM message，返回现有四条消息且角色顺序为 `system, system, assistant, user`。
- [x] AC4. normalize、默认扩展配置和存储 round-trip 均包含两个字段；超长字符串被限制为 20,000 字符，非字符串与缺失值归一化为空字符串。
- [x] AC4a. 对已有自定义 `task`、`input_prefix`、`input_suffix` 的配置仅保存新增字段时，旧自定义值保持不变。
- [x] AC5. 两个新增 SYSTEM 中的 `{{user}}` / `{{char}}`（以及现有兼容写法）均按当前 AnalysisInput 名称正确展开。
- [x] AC6. 设置页渲染正确的两个 textarea、键名和精确说明文字，保存后可重新读取；保存失败时草稿仍可渲染。
- [x] AC7. 请求预览显示首部 SYSTEM 为第 1 段、尾部 SYSTEM 为最后一段，顺序与真正 API 请求一致。
- [x] AC8. 现有 World Model、API Profile、设置页与完整测试均通过；`npm run check`、`node --check` 和 `git diff --check` 无错误。

## Out of Scope

- 不修改 BioWeave 硬编码的 World Model 核心约束或输出契约。
- 不修改 World Model schema、规范化/一致性 guard 或 Analyzer 的结果处理。
- 不修改 AnalysisInput 的字段、采集方式或分段结构。
- 不修改 API Profile、请求设置、Secret、安全边界或调用协议。
- 不迁移旧配置，不重排四条既有中间消息，不扩展新的变量语法。
- 不扩展本次设置页以外的独立 World 页面预览状态传参；该页面现有行为不属于用户指定的设置页预览范围。
- 不进行与本功能无关的 UI 重构、样式调整或模块抽象。

## Technical Notes

- 配置所有权位于 `storage/schema.js` 的 `DEFAULT_WORLD_ANALYSIS_PROMPT` 与 `normalizeWorldAnalysisPrompt()`；`storage/store.js` 已统一通过 normalize 保存。
- UI 所有权位于 `ui/settings.js` 的渲染与 `ui/app.js` 的表单采集；不引入新的状态层。
- 消息所有权位于 `ai/prompts.js` 的 `buildWorldModelMessages()`；真实 Analyzer 和预览均复用该函数。
- 主要回归测试落在 `tests/world-model.test.js` 与 `tests/api-profile.test.js`，沿用 Node `node:test` 和现有断言风格。
- `docs/UI.md` 当前把消息固定描述为四段，`docs/DATA-MODEL.md` 与 `README.md` 仅笼统描述提示词字段；实现时做最小文字同步，避免文档与 4–6 条真实消息漂移。
