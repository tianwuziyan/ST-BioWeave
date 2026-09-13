# 实施计划：Event participant 生物身份上下文

## 执行顺序

1. 重新读取 Trellis before-development 指南与 domain/event-pipeline 规范，确认当前 branch/worktree 与任务范围未漂移。
2. 修改 `ai/prompts.js`：把 pregnancy exposure participant 的 `biological_context` 改为必填，并写清 World Model/profile/evidence 优先级、nullable identity 与未知 capability 规则。
3. 修改 `ai/analyzer.js`：在已有 Event normalization 中加入条件式 participant context 校验；保留 0/1/N Event 与 subject-local pregnancy validation，不引入 UI/Core/Tracking 重构。
4. 补充 `tests/event-analysis.test.js` 的抽象 ID fixtures 与 DTO rejection/provenance 语义测试；补充 `tests/events.test.js` 的 normalization 保留测试，确认既有 Tracking 测试无需生产代码变化。
5. 最小同步 `docs/DATA-MODEL.md`、`docs/CONTEXT-AND-PROMPT.md` 与 `.trellis/spec/domain/event-pipeline.md`，使 participant 必填上下文和 capability evidence boundary 可检索。
6. 做 targeted tests，再执行完整 `npm run check`、所有修改 JS 的 `node --check`、`git diff --check`；审阅 diff，确认没有越界文件、commit 或 push。

## 文件责任边界

- AI contract：`ai/prompts.js`、`ai/analyzer.js`
- Regression：`tests/event-analysis.test.js`、必要时 `tests/events.test.js`
- Contract docs/spec：`docs/DATA-MODEL.md`、`docs/CONTEXT-AND-PROMPT.md`、`.trellis/spec/domain/event-pipeline.md`
- 明确不修改：`core/tracking.js`、UI、StateReducer、Snapshot、Projection、Genealogy、StoryTime、Universal World Model cleanup、profile conflict/override。

## 验收检查

- pregnancy-related `sexual_activity` participant 缺 context/缺字段/非法类型均被 analyzer reject；null 值合法。
- 明确身份资料可保留 species/type；资料不足且无直接人物证据时不生成完整 capability 套装，未知 capability 为 null。
- non-pregnancy Event 的既有 participant 解析兼容性不变。
- Core normalization 与 Tracking profileFromParticipant 的既有字段链路不回归。
- 0/1/N、多 Event subject-local contract 与 UI/Tracking 边界不受影响。
- `npm run check`、`node --check`、`git diff --check` 全部通过。

## 授权状态

用户已批准本最终规划，任务已通过 `task.py start` 进入 implementation。仍禁止
commit、push，以及超出本文件列出的代码/文档范围的修改。
