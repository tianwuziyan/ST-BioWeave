# Technical Design

## Boundary

行为缺口位于 `ai/prompts.js` 的 Prompt composition，而不是
`ai/input-builder.js` 的 AnalysisInput 收集。修改范围限定为公共角色背景
formatter、World Model references 组合和对应回归测试。

## Data flow

`AnalysisInput.character.greetings` 保持原样进入 Prompt composition：

```text
AnalysisInput
  -> formatCharacterReference       -> character background only
  -> formatWorldbookReference
  -> formatExternalMemoryReference
  -> formatCharacterGreetingReference -> World Model only, final section
```

Event Analysis 只调用 `formatEventCharacterReference()`，而该 formatter
复用不含 greeting 的公共角色背景 formatter，因此 Event messages 中没有
任何 greeting 正文或 greeting section 标题。

## Compatibility and risks

- 不改变 `AnalysisInput` shape、source selection 或 greeting selection。
- `joinPromptSections()` 的空 section 过滤继续负责避免空 message/空 section。
- 现有 World Model message 数量和 role 结构不变；仅 references SYSTEM message
  的尾部在有 greeting 时增加一个 section。

## Rollback

如果回归测试显示现有非 greeting references 或 selection 行为变化，只回退
`ai/prompts.js` 中 formatter/组合改动及其回归测试，不触及输入收集文件。
