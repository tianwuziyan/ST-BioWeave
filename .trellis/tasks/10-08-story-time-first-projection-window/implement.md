# Implementation Plan

## Ordered checklist

1. 读取 `trellis-before-dev`，并加载 domain/runtime 相关 spec index；确认变更文件与
   owner boundary。
2. 先补生产语义测试：timing eligibility、Story Time-only trigger、A/B/C aggregation、
   duplicate suppression、window missed no-backfill、Projection readback/Context、
   GENERATION_STARTED await ordering。
3. 在最小生命周期入口接入完整 Projection Runtime process，使 Story Time progression
   能触发现有 eligibility/generation path；保留已有 lifecycle-only expiry 行为，避免
   将 expiry 误变成 factual analysis。
4. 最小调整 process 输入/理由，使“无新 Event、Story Time 已变化”成为合法调用；先过
   deterministic timing/eligibility/dedupe gate，再允许 AI。验证 window_open 内连续
   Story Time 只生成一次。
5. 检查/补齐 compatible exposure basis 与 timing diagnostics；不得引入固定天数、文本
   推断、历史 Floor 回写或 Chat-level authority。
6. 专门验证 sibling possibility contract；若现有 lifecycle 不能表达 realized 与
   contradicted/expired 的互斥演化，停止 schema 修改并报告 blocker。
7. 运行定向 Node tests、全量 test/check 命令与静态语法检查；审阅实际 Git diff。
8. 检查相关 Markdown 是否仍准确；如生产链行为/测试流程文档受影响，同步更新权威文档。
9. 进行 independent quality check：跨层数据流、owner/stale guards、readback、Context
   boundary、duplicate and missed-window behavior。
10. 仅在自动验证完成后报告真实 Host acceptance steps；不把单元测试通过描述为 Host
   acceptance PASS。

## Likely files to inspect/change

- `runtime/events.js`
- `runtime/projection-runtime.js`
- `runtime/event-analysis.js`（仅在确认 lifecycle trigger 需要窄接口时）
- `core/projection-eligibility.js`
- `core/projection-timing.js`
- `core/tracking-window.js`
- `tests/projection-runtime.test.js`
- `tests/tracking-window-phase2.test.js`
- `tests/event-analysis-runtime.test.js`
- 受实际行为影响的相关 Markdown

## Validation commands

- `npm test`
- `npm run check`（若 package scripts 提供）
- 定向：`node --test tests/projection-runtime.test.js tests/tracking-window-phase2.test.js tests/event-analysis-runtime.test.js`
- `git diff --check`
- 真实 Host：按报告步骤验证 Story Time-only Floor、Projection Context 与下一次生成顺序。

## Rollback points

- 在写生产代码前保留当前 clean worktree 基线。
- 若发现需要改 Coordinator、Snapshot、Projection schema 或生命周期 registry，停止并
  返回规划，不扩大本任务；这些变化不属于当前最小修复。
- 若 Host 事件顺序无法证明，保留自动测试修复但将 Host acceptance 标记为
  UNVERIFIED，不宣称完成。
