# 修复角色卡开场白的 Prompt 职责边界

## Goal

修复角色卡开场白在分析 Prompt 中的职责和位置：已选择的 greeting 只进入
World Model references 的末尾，不进入 Event Analysis；保留现有来源选择、
字段选择和 greeting 收集语义。

## Background and confirmed facts

- `ai/input-builder.js` 已将用户选择的 `character.greetings` 保存在
  `AnalysisInput` 中，未选择的备用 greeting 不应进入输入；本次不修改该收集逻辑。
- `ai/prompts.js` 当前 `formatCharacterReference()` 同时格式化角色背景和
  `character.greetings`，而 `formatEventCharacterReference()` 复用它，因此
  Event Analysis 会收到开场白。
- World Model references 与 Event Analysis references 都由独立的 SYSTEM
  message 承载；开场白必须追加到 World Model 原 references SYSTEM message，
  不能新增 message。

## Requirements

1. `formatCharacterReference()` 只输出角色背景，不读取/输出 greetings。
2. 新增职责单一的 greeting formatter，只读取已有
   `input.character.greetings`，并以 `【开场白】\\n<正文>` 输出；空值不输出 section。
3. `formatWorldModelReferences()` 按角色背景、世界书、外部记忆、开场白的顺序
   组合，保证开场白是 references SYSTEM message 的最后一个 section。
4. Event Analysis 的角色 reference 只包含角色背景，不调用 greeting formatter，
   Prompt 正文中不得出现已选或未选 greeting 及 `【开场白】`。
5. 不修改 greeting 的识别、收集、选择、来源选择或 UI 逻辑，不做无关架构重构。

## Acceptance Criteria

- World Model 包含已选择的 `CHARACTER_OPENING_SELECTED`，包含标题 `【开场白】`，
  且承载该正文的 message 为 `role === 'system'`，`trimEnd()` 以该正文结束。
- World Model 同时保留角色背景和其它 references。
- Event Analysis 同时保留角色背景，但完全不包含
  `CHARACTER_OPENING_SELECTED`、`CHARACTER_NOT_SELECTED` 或 `【开场白】`。
- 未选择 greeting 或 greetings 为空时，不输出空 greeting section，也不增加空 message。
- 未选择的备用 greeting 不泄漏到任何 prompt，既有 selection 行为保持不变。
- 相关测试通过：`tests/context-prompt.test.js`、`tests/world-model.test.js`、
  `tests/worldbook.test.js`；若 package.json 提供统一测试命令，执行完整测试集。

## Out of scope

- 不修改 `detectCurrentCharacterGreetingField`、`normalizeCharacterCardFields`、
  `buildCharacterInput`、greeting selection/collection 或 UI。
- 不修改 Worldbook 来源选择、角色卡字段选择、Event/World Model 数据模型、
  message 结构或其它 Prompt 架构。

## Open questions

无。用户已明确目标、边界、输出格式和验收条件。
