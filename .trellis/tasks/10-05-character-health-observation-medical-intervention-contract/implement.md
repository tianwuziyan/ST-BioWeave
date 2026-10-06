# Implementation Plan (implemented; review pending)

本文件记录已完成的实现顺序和待人工验收项；task 保持 `in_progress`，不提交、不 push。

1. 已重读适用 `AGENTS.md`、Floor/Event/Health 规范，并确认设计与 HEAD 一致。
2. 已在 `core/events.js` 与 parser boundary 冻结 `health_role` 的可选枚举校验；schema envelope 保持 v1。
3. 已在 Event Analysis prompt/parser boundary 支持显式 role 与 mixed narrative 拆 Event。
4. 已将 `healthAssessmentEligibility()` 收紧为 explicit observation-only；旧 source-bound Assessment 不再为缺 role Event 提供兼容资格，但历史 timeline 保留。
5. 已保持 Evolution 与 Guidance 的单一消费边界，不新增 kind/treatment 判断。
6. 已将 presentation aggregation 改为 active-observation-only site group，使用 per-event missing-site fallback，保留 factual value、laterality 与 canonical source IDs。
7. 已将 Characters UI 限定为当前 observation 展示；intervention 仅保留在 Event history，不增加 treatment popup/module。
8. focused tests 已通过；完整套件与静态检查在本轮完成并记录；真实 ST Host 验收留待人工 review。
9. 已按实际 diff 同步受影响 Markdown，并执行 Trellis quality check。

## Review gates / rollback points

- Gate A：新/未知 role 不被 Health 按 kind 或 description 猜测。
- Gate B：intervention 不产生 Assessment、active observation、severity 或 Guidance。
- Gate C：所有 derived DTO 仍从当前有效 Floor/Swipe/version 重建。
- Gate D：旧 Event 不被重写，不触发历史 AI backfill；失败时只回滚本阶段文件。

Follow-up observation：`eventContinuityKey()` 仍不包含 factual payload；本轮按批准范围不修改。
当前 `eventSemanticKey()` 与 `healthObservationFingerprint()` 已包含 `state_fact`，只有出现
实际 continuity 错误时再单独评估该边界。

## Verification record

```bash
npm test
npm run check
git diff --check
git status --short
```

Node tests/static checks 不能替代真实 ST Host 验收。完整结果在最终回报中记录；当前不提交或 push。

### Current verification result

- Contract-focused tests：169 passed，0 failed。
- Broader suite excluding the pre-existing long-running `event-analysis-runtime.test.js`
  and unrelated World Model prompt fixture：792 tests，789 passed，3 failed；失败集中在
  Start New Chat source-A cleanup lifecycle，不涉及本 task 的 health/Event/UI 模块。
- Full `npm test`：未获得 clean completion；`event-analysis-runtime.test.js` 长时间无终态，
  且完整运行中观察到独立的 World Model prompt fixture failure。未将其归因于本 task。
- `node --check`（index.js 与本轮修改的 JS）通过；`git diff --check` 通过。
