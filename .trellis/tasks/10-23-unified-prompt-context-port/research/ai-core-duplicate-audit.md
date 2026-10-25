# Research: ai/core 模块重复实现审计

- Query: 检查 `ai/` 与 `core/` 是否存在除 `projection-storyline.js` 外的同名或重叠实现，并判断安全清理范围。
- Scope: internal
- Date: 2026-10-24

## Findings

### 1. 同名文件盘点

当前 `ai/` 与 `core/` 的递归同名文件只有：

- `ai/projection-storyline.js`：AI 提示词构建、响应 JSON 解析、支线设计/判定适配。
- `core/projection-storyline.js`：支线快照、分支 ID、状态转换、校验、持久化领域模型，以及注入正文的上下文字符串。

没有发现其它 `ai/`/`core/` 同名文件。`ai/` 的 `analyzer.js`、`client.js`、`input-builder.js`、`prompts.js`、`prompt-context.js`、`worldbook.js`、`world-supplement-protocol.js` 在 `core/` 中没有同名实现。

### 2. `buildStorylineContextPrompt` 是确实重复的导出

- `ai/projection-storyline.js:420-429` 再次导出 `buildStorylineContextPrompt`，只做快照规范化和 `<bioweave-storyline>` 字符串拼装。
- `core/projection-storyline.js:114` 已有同名导出，功能相同；唯一可见差异是 `core` 版本对缺失的起始节点目标使用 `|| ''`，`ai` 版本直接插值，可能产生 `undefined` 文本。
- 生产调用方使用的是 `core` 版本：`core/projection-context.js:4` 导入，`core/projection-context.js:328-334` 调用。
- `runtime/projection-storyline-runtime.js:2` 只从 `ai/projection-storyline.js` 导入提示词构建器和响应解析器；没有导入该 `ai` 版本的上下文函数。
- 测试也从 `core/projection-storyline.js:3` 导入上下文函数，从 `ai/projection-storyline.js:4` 导入 API 消息/解析函数。

结论：`ai/projection-storyline.js:420-429` 是无调用方的旧重复实现。安全清理候选是删除该导出及其函数体，保留 `core/projection-storyline.js:114` 作为唯一正文注入实现。删除前应补一次全仓库符号搜索；当前搜索已确认没有其它调用方。

### 3. 两个文件不是整体重复，边界总体是有意的

`ai/projection-storyline.js` 依赖 `core/projection-storyline.js` 的领域函数（文件首行导入 `applyStorylineJudge`、`buildStorylineBranchId`、`createStorylineSnapshot`、`normalizeStorylineSnapshot`），说明 `core` 是领域状态 owner，`ai` 是 API adapter/prompt owner。`core` 被 `storage/projection.js`、`core/projection-persistence.js`、`runtime/projection-storyline-runtime.js` 和 `core/projection-context.js` 直接消费；`ai` 被 `runtime/projection-storyline-runtime.js` 消费。

除上述重复导出外，没有发现 `ai` 和 `core` 之间重复的导出函数名。对同名模块之外的相似命名进行检查后，未发现另一个 AI/核心边界重复实现。

### 4. 相关但不属于本次 `ai/core` 重复的项目

- `core/events.js:434` 和 `core/identity.js:560` 都导出 `isCanonicalCharacterId`。这是 `core` 内部重复符号，不是 `ai`/`core` 同名文件；本次不建议顺手删除，应另开小范围审计确认事件层是否需要保持独立边界。
- 全仓库还有 `runtime/`、`storage/`、`ui/` 与 `core/` 的同名文件（如 `events.js`、`projection.js`、`health-assessment.js`），但它们分别承担运行时编排、持久化适配、UI 和领域职责；不能仅凭文件名判定为重复。当前证据不足以删除。

## Related specs

- `.trellis/tasks/10-23-unified-prompt-context-port/prd.md` 的 Key Decisions 明确要求：`ai/projection-storyline.js` 保留任务规则/输出协议，`core` 保持领域状态；迁移完成后清理无调用方旧 formatter。
- `.trellis/spec/guides/code-reuse-thinking-guide.md` 要求搜索已有实现、避免复制粘贴，并在确认无调用方后收敛唯一 owner。

## Caveats / Not Found

- 本次为只读审计，没有修改生产代码，也没有删除重复函数。
- git 工作区已有用户本地未跟踪的 `.trellis/tasks/**` 文件；审计未触碰这些文件。
- 尚未执行删除后的测试。若主会话实施清理，建议删除 `ai/projection-storyline.js:420-429` 后运行 `npm run check`，并再次执行 `rg -n "buildStorylineContextPrompt" ai core runtime storage tests` 确认仅保留 `core` 导出及其调用。
