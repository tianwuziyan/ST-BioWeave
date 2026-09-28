# Implementation Plan

1. 读取 `trellis-before-dev`、当前 World Model spec、Floor State contract，并再次确认 target files 的现有 diff；验证 storage/Floor/UI 文件无本轮 ownership。
2. 在 `ai/prompts.js` 以最小 diff 重写 Supplement discovery guidance：三个 PASS、完整 field matrix、generic semantic definitions、internal inventory、post-discovery Existing comparison、targets-after-discovery、retry parity。
3. 保持 `WORLD_MODEL_FACT_DELTA_OUTPUT_CONTRACT`、parser、resolver 和 Evidence Guard 不变；只有出现明确 contract 文案缺口时才同步最小测试/diagnostic 字段。
4. 在 `tests/world-model.test.js` 增加/调整 generic fixtures 覆盖 T1–T17，重点验证 prompt topology 与现有 per-Fact/fixed-point/guard 行为没有回归。
5. 检查 `Reproductive_Mechanism` mapping；若只是既有独立问题，不在本轮修复并在报告记录 `SEPARATE FOLLOW-UP REQUIRED`。
6. 运行：
   - `node --test tests/world-model.test.js`
   - `npm run check`
   - `node --check <all modified js>`
   - `git diff --check`
   - `git diff -- storage/floor-persistence-coordinator.js`
7. 审查实际 diff，确认仅包含本轮授权文件与 task artifacts，不覆盖前序修改；生成最终 A–H 报告，不 commit/push。

## Verification Record

- `node --test tests/world-model.test.js`: 286 passed。
- `node --check`：当前工作树所有已修改/新增 JavaScript 文件通过。
- `git diff --check`: passed。
- `git diff -- storage/floor-persistence-coordinator.js`: empty。
- `npm run check`: current worktree has one unrelated failure at
  `tests/start-new-chat-lifecycle.test.js:557`; no failure was observed in the
  World Model suite.

## Risk checkpoints

- 修改 `ai/prompts.js` 前先逐项搜索现有 contract 文案，避免破坏已通过的 regex assertions。
- 若测试暴露 parser/resolver/guard 变化需求，停止扩大范围，先报告根因；不得为 prompt 目标绕过安全边界。
- 若历史/当前工作区与本计划不一致，保留已有修改并重新审计，不执行 reset/clean/restore。
