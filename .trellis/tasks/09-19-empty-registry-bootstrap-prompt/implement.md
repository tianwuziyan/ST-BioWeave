# 实施计划：空 Character Registry Prompt Bootstrap

## Phase 1：实施前检查

- [x] 审计 `ai/prompts.js`、`ai/input-builder.js`、`core/identity.js`、
      `runtime/event-analysis.js` 的实际调用链。
- [x] 确认空 Registry 当前只显示无 candidate，且 Runtime 已保持 fail closed。
- [x] 搜索 `char_000000`、`character_id`、`mention_id`、identity 状态与相关
      Prompt/schema 描述，确认没有另一个 Prompt formatter 需要同步。
- [x] 读取 Floor State、Event Pipeline 与 lifecycle 规范，确定本轮不改变数据所有权。

## Phase 2：最小修改顺序

1. 修改 `ai/prompts.js`：先补强 core/output 的 raw identity wording，再在
   `formatEventCharacterRegistry()` 增加 empty bootstrap 分支；保持非空 candidate
   格式与消息顺序不变。
2. 修改 `tests/event-analysis.test.js`：先加入 Prompt 回归断言，覆盖空/非空
   Registry 和 mention/ID 禁止项。
3. 修改 `tests/character-identity.test.js`：补充 `char_000000` 空 Registry
   fail-closed 与必要的多 new sequential response regression。
4. 按规范更新 `.trellis/spec/domain/event-pipeline.md` 中的 Runtime Character
   Identity Contract，记录空 Registry bootstrap 与 opaque mention handle。

## Phase 3：验证与审查

- [x] 运行目标 Prompt、identity、event-analysis-runtime 测试（117/117）。
- [x] 运行 `npm test`（574/574）。
- [x] 运行 `npm run check`（574/574）。
- [x] 对所有本轮修改 JS 执行 `node --check`。
- [x] 运行 `git diff --check`，审查只包含本任务允许文件。
- [x] 完成独立 Trellis quality review 所需的人工等价检查；checker 子 Agent
      因长时间无输出被关闭，未产生额外 diff。
- [x] 当前环境未确认加载本地 checkout，未执行真实 SillyTavern acceptance。

## Verification Notes

- `char_000000` 与姓名型 `existing` 在空 Registry 下均保持
  `UNKNOWN_EXISTING_CHARACTER_ID` fail closed；没有 existing → new 自动转换。
- 空 Registry 的四个 new mention 按 `char_000001` 到 `char_000004` 顺序注册。
- 工作区实际产品 diff 仅包含 `ai/prompts.js`、两份测试和
  `.trellis/spec/domain/event-pipeline.md`；没有 Runtime、schema、parser、UI/CSS
  或 World Model 修改。

## 回滚点

- Prompt 文案异常：仅回滚 `ai/prompts.js`。
- 测试/规范不匹配：修正对应测试或 spec，不触碰 Runtime identity/storage。
- 任何失败都不得清空或重写已有 Floor/Swipe 数据。

## 禁止操作

- 不修改 `core/identity.js`、`runtime/event-analysis.js` 的实现 authority。
- 不修改 `ai/analyzer.js` parser/schema、Event schema、UI/CSS、World Model 或 lifecycle。
- 不使用 reset/restore/clean，不覆盖 unrelated dirty files，不 push。
