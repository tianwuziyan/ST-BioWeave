# 实施计划：按 gestational subject 拆分妊娠暴露 Event

## 进入执行前

- [ ] 复核最新 `prd.md`、`design.md` 与本地 worktree；确认任务状态仍为 planning 且无用户并行改动。
- [ ] 通过 review gate 后再执行 `python3 ./.trellis/scripts/task.py start pregnancy-event-subject-grouping`；未 start 前不修改生产代码。
- [ ] 使用 `trellis-before-dev` 重新加载 domain/frontend 规范和 cross-layer checklist。

## 实施步骤

1. [ ] `ai/prompts.js`
   - 删除所有 One Floor → 0/1 consolidated Event、`events[]` 单项、唯一 primary type 的约束。
   - 增加 0/1/N、按 gestational subject 分组、同 subject 多 source 合并、subject-local participants/counterparts、同 Floor subject 唯一性规则。
   - 保留实际进入有效受孕路径、保护结果、immediate effect 合并、普通补品/静态外貌过滤和 gender 禁止推断。

2. [ ] `ai/analyzer.js`
   - 删除 `multiple_events_not_allowed` parser guard，使空、单个和多个 Event 都可进入 normalization。
   - 在 AI DTO boundary 增加 pregnancy exposure cardinality、participant 闭包、subject/counterpart 不重叠、去重结果和 response 内重复 subject 校验。
   - 保留未知字段、证据、角色、capability、Story Time、Runtime identity/source 等既有边界，并为新拒绝提供稳定 diagnostic code/path。

3. [ ] `core/events.js` 与 `runtime/event-analysis.js`
   - 强化 Domain 的 subject-local exposure 校验，同时保持其它 Event type 和无 exposure sexual activity 的既有语义。
   - 保持 canonical ID 数组和 participants 的唯一化语义。
   - 增加轻量 collection validator，拒绝同一 response/Floor 的重复 pregnancy subject，不合并 Event。
   - Runtime 在 ordinal ID/source enrichment 后使用 collection validator；保留失败 refresh、旧成功结果、`event_id = Floor Version + ordinal` 和现有保存流程。
   - 不修改 `core/tracking.js` eligibility 或 Registry 算法。

4. [ ] 回归测试
   - 改写上一轮“多 Event 必须失败”的 parser/runtime 测试。
   - 以抽象 ID 覆盖：一 subject 一 source；一 subject 多 source；两 subject；两 subject 中一方多 source；无 exposure participant；多 subject 单 Event 拒绝；同 subject 重复 Event 拒绝；counterpart 不跨 Event 混入及互相 exposure 合法场景。
   - 覆盖 Domain 与 Runtime collection boundary、ordinal IDs、Registry subject-local exposure refs、失败 refresh 保留旧成功结果。
   - 保留 barrier/actual-entry、no-path、gender/capability、non-pregnancy Event、immediate symptom/medical filtering 的既有回归。

5. [ ] 文档同步
   - 更新 `docs/DATA-MODEL.md`、`docs/DEVELOPMENT.md`、`docs/CONTEXT-AND-PROMPT.md`、`docs/UI.md` 的粒度、数组、Registry 和 UI 边界描述。
   - 搜索指定文档和生产 Prompt，确认没有残留单 Floor 单 Event 合同；历史 Trellis task 记录不改写。

6. [ ] 质量门禁
   - 运行 `npm run check`。
   - 对每个修改的 `.js` 文件运行 `node --check`。
   - 运行 `git diff --check`。
   - 运行 `trellis-check` 规定的 scope/spec/data-flow 检查；确认 `core/tracking.js`、StateReducer、Snapshot、Projection、Genealogy 未被修改。
   - 检查 `git diff --stat`、`git diff --name-only` 和完整 diff；不 commit、不 push、不进入 Phase 2B。

## 风险与回滚点

- 主要风险是 parser 与 Domain 只校验一侧、或把同一 subject 的多 source 错误拆开；每次修改后分别运行 parser、Domain、Runtime focused tests。
- 主要风险是旧 fixture 仍使用一个 Event 包含多个 subject；更新 fixture 时必须保留“跨 Event 互相作为 subject/source”合法案例。
- 主要风险是历史 normalized data 的数组兼容；保持现有 `normalizeIdArray` 去重，不改变 schema version 或 Runtime identity。
- 如发现 worktree 出现用户并行改动，停止写入并报告；回滚只允许精确撤销本任务新增的变更，不使用 reset/clean/stash/checkout 等破坏性操作。
