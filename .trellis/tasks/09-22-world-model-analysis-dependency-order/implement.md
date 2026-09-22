# 执行计划

## 1. 基线与接口

- 阅读当前 `trellis-before-dev` 指南、domain specs 和 exact target blocks。
- 确认 analyzer coordinator 的依赖注入、World prompt settings、Floor save/error conventions。
- 为 World unavailable、patch DTO、gate 和 merge 定义最小内部接口，不改变现有公开签名。

## 2. World pipeline

- 增加首次 World Analysis 与已有模型 Update/Patch 的分支调用。
- 增加独立 patch prompt、parser/schema、证据 gate；AI 只返回新增/明确修正 facts。
- 由 BioWeave 程序实现 deterministic merge `validated A + validated Patch`，再 validate 完整 B；默认不支持 remove/invalidate，省略字段永不删除。
- 若 patch 合法但 B 不合法，整次更新 fail-closed，不保存 B、不进入 Event Analysis。
- 将 World Analysis 结果绑定当前 Floor Version，失败或 stale 时不保存半成品。

## 3. Character/Event hard dependency

- 在自动 `analyzeFloor()` 入口串联 World resolve/update/save/final resolve。
- 在 input builder / analyzer boundary 显式传递并断言 validated normalized World Model。
- 保持 Event validation、persistence、StateReducer、Tracking、Projection downstream 现有顺序和语义。
- 同步收紧 Event prompt；不修改 UI。

## 4. 回归测试

- runtime 顺序、失败 fail-closed、复用、dirty 更新、patch 保留/空/无效/明确替换、删除回退。
- 无 World 不写人物字段、gender/sex 不推能力、User message 不持久化、stale World async 丢弃。
- 保留现有 World resolver/save 隔离测试并补充必要 fixture。

## 5. 验证与收尾

- `npm run check`
- 相关 `node --test` 测试
- `node --check` 覆盖修改的 `.js`
- `git diff --check`
- 复核实际 diff 与本轮范围；同步更新必要的 domain spec / `docs/bioweave-data-lifecycle.md`，若新增字段或 lifecycle contract 则一并登记。

## 风险点与回滚点

- 主要风险文件：`runtime/event-analysis.js`、`ai/analyzer.js`、`ai/prompts.js`、`tests/event-analysis-runtime.test.js`、`tests/world-model.test.js`。
- 每个阶段保持独立可回滚：先新增纯函数/测试，再接 coordinator，最后接 analyzer defensive guard。
- 禁止改动 Snapshot、StateReducer、Projection、UI 和 analysis interval。
