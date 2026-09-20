# Implementation Plan

1. 在 `ai/prompts.js` 阅读并锁定当前 formatter 边界；从
   `formatCharacterReference()` 移除 greeting loop。
2. 添加 `formatCharacterGreetingReference(input, names)`，只格式化已有
   `character.greetings`，标题固定为 `【开场白】`，空列表返回空字符串。
3. 将 greeting formatter 仅追加到 `formatWorldModelReferences()` 的最后。
4. 调整/补充 `tests/context-prompt.test.js` 或 `tests/world-model.test.js`，覆盖
   World Model 尾部、Event Analysis 排除、空 greeting、背景双侧保留和 selection。
5. 运行指定测试与 package.json 中的统一测试命令（若存在）。
6. 复核 `git diff`，确认未修改输入收集、来源选择、UI 或无关架构。

## Validation commands

```bash
node --test tests/context-prompt.test.js tests/world-model.test.js tests/worldbook.test.js
npm test   # 仅当 package.json 定义该命令
```

## Scope and rollback points

- 预期产品代码：`ai/prompts.js`。
- 预期测试：`tests/context-prompt.test.js` 和/或 `tests/world-model.test.js`。
- 不允许触碰 `ai/input-builder.js`、`ai/worldbook.js` 或 UI 代码。
