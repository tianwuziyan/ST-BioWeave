# Character Biological State 系统现状审计

## Goal

只读审计当前 Character、BiologicalEvent、Tracking、State、Snapshot、Projection 生产链与 UI 数据来源，不修改生产代码。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
# Character / Biological State 系统现状审计

## Goal

基于当前 checkout 的生产代码，审计 Character、BiologicalEvent、Tracking、StateReducer、Snapshot、Projection 与三类 UI 的真实接线状态，输出可追溯的现状报告和下一阶段唯一推荐施工边界。本轮只读，不修改生产代码。

## Confirmed scope and constraints

- 审计对象是当前仓库代码、测试、配置与文档；代码优先，文档冲突必须标记 `DOC/CODE MISMATCH`。
- 覆盖 `core/`、`runtime/`、`storage/`、`ai/`、`ui/` 及实际 import/call 关系。
- 必须区分代码存在、Runtime 接线、持久化、UI 消费，以及 `CONNECTED` / `PARTIAL` / `NOT_CONNECTED` / `LEGACY/DEAD`。
- 必须追踪 Character Floor 到分析、身份、Event、Registry、Tracking、Current State、Snapshot、Projection 和 UI 的真实数据流。
- 禁止修改生产代码、schema、Prompt、validator、Scheduler、World Analysis、UI；禁止新建/删除模块、重构、修 bug 或修改 phase 标记。
- 允许只读搜索、阅读现有测试和运行现有测试；任务文档本身可作为审计记录。

## Required findings

报告必须覆盖：

1. 真实生产数据流图及每个节点状态。
2. Character Registry 的 canonical ID、解析、存储、Floor/Swipe 所有权、跨 Floor 延续、alias 和 UI 边界。
3. Character Facts/Profile 的实际结构、事实来源、持久化/derived 语义、forward-only 与 UI 数据源。
4. BiologicalEvent 的 parse → identity → normalize/validate → dedupe → persistence → readback pipeline、支持类型、StateReducer 消费和编辑/删除重建。
5. Tracking Subject、Candidate、Exposure、Window 的实际语义；Window 未实现项必须明确列出。
6. `core/state.js` 的 reducer 输入/输出、baseState/events/story time/characterFacts 支持，以及用户列出的每个 Event type 状态。
7. Pregnancy Episode、termination 历史、事实置信语义和 Contributor Attribution 的实际 reducer 能力。
8. Story Time elapsed state 的 reducer 支持与 Runtime 接线。
9. Runtime Current Biological State API、Floor/Swipe/version 聚合、characterFacts/currentStoryTime、Snapshot 使用和 UI 调用情况。
10. Snapshot DTO、持久化、checkpoint、验证、查找、replay、删除 fallback、interval 与真实 Runtime 接线。
11. Characters UI 各字段真实来源，Events/Overview UI 的 canonical 数据边界。
12. Projection eligibility/generation/persistence/context injection，以及是否消费 Current Biological State。
13. 指定功能矩阵和文档/代码不一致项。
14. 基于证据选择一个下一阶段唯一主要目标，并列出明确不做项。

## Acceptance criteria

- [ ] 报告中所有关键结论都有当前文件/符号/测试证据，不能仅依据旧 phase 文档。
- [ ] 数据流图明确区分生产接线与 code-only，并分别标注状态。
- [ ] `core/state.js` 的逐 Event type 审计完整覆盖 18 个指定类型。
- [ ] Registry、Tracking Subject、Character Profile、Current State 四者没有概念混淆。
- [ ] 明确说明真实 Runtime 是否调用 Current Biological State 和 Snapshot。
- [ ] 输出完整功能矩阵，状态值仅使用 `PRODUCTION`、`PARTIAL`、`CODE_ONLY`、`NOT_IMPLEMENTED`、`LEGACY/DEAD`。
- [ ] 最终报告确认本轮没有修改生产代码。
- [ ] 运行适合的现有只读测试/静态检查，并报告未覆盖的 real-host acceptance 风险。

## Out of scope

任何实现、重构、清理旧模块、schema/Prompt/validator/Scheduler/World/UI 修改、Projection 施工、phase 状态更新、commit/push。

## Evidence notes

- 当前仓库已有 Floor State Ownership、Event Pipeline、Pregnancy Tracking 等规范；它们只能作为审计索引，最终状态以当前代码为准。
- 规范已明确指出 Tracking Window 是目标契约而非当前实现，并明确 Character/Event identity pipeline 与 `tracking_subjects` UI 边界；这些结论需要用当前代码重新核验。
