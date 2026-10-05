# Execution Plan

本任务当前已完成 Persisted Health Assessment Lifecycle Phase 1、最小 Health Evolution /
Current Health State Phase 2 read model 与 Phase 4 independent observation lifecycle /
presentation aggregation；Phase 3 trajectory identity 已撤回。Phase 5A 仅完成 Character
Details 对既有 current_health_state read model 的窄范围消费；完整 Character Health UI、
Recovery Guidance、Projection、advanced Condition identity 与 World Model health rules
仍不进入实现。

1. 读取适用 AGENTS、Trellis domain/frontend index 与 Floor State/Lifecycle 规范。
2. 审计指定权威 Markdown 与实际实现，记录 confirmed boundaries、现有 Event contract、State/Snapshot 现状、UI/Context 现状及冲突。
3. 若发现用户方向与当前真实架构存在根本冲突，停止设计定稿并在报告中给出证据；否则更新 `docs/CHARACTER-HEALTH-STATE.md` 并实现 Phase 1 lifecycle 与 Phase 2 minimal derived read model。
4. 检查导航文档是否需要添加 `DESIGN / NOT IMPLEMENTED` 链接；不修改既有状态标签。
5. 运行 focused tests、完整测试集（按项目现实报告超时/既有失败）以及 Markdown/链接检查。
6. 最终复核设计中的 authority、replay、location、pregnancy、projection、UI、Context、natural recovery 与 deferred decisions。
7. 复核 Health Assessment Contract：按 source observation 首次保存、new-observation reassessment、Event/Floor Version 绑定、earliest/expected、Day 2 + 3 days = Day 5、Story Time jump、failure fallback、Snapshot-independent replay 与 self-evidence loop。
8. 复核 Storage & Lifecycle 设计：Event ID/continuity、source composite key、Floor/Swipe invalidation、readback/stale guards、retry/dedup、legacy Chat compatibility 与 Phase 1 最小范围。
9. 复核 Phase 4：每条 observation 独立 lifecycle、site/laterality presentation grouping、duplicate display source retention，以及不再依赖 trajectory supersede。
10. 记录未来 Health Recovery Guidance / Projection contract：内部恢复时间只用于粗粒度阶段判断；不得输出具体倒计时；不强制每轮提及；Guidance 不得成为 Event evidence。
11. Phase 5A UI 只消费 grouped_issues 与 Runtime summary，保持 canonical character_id、空状态、内部字段隔离与 UI_OPEN_FAST_PATH；不触发 AI、Analysis、Projection 或 persistence。
12. Phase 5B 使用 Health-owned deterministic recovery-stage calculator，并通过现有 bioweave_projection_context 全量组合 Projection 与 Health Guidance；不得新增 Health slot、persistence、Assessment AI pass 或 UI countdown。

## Validation

- `git status --short`
- `git diff --check`
- `git diff --stat` 与 `git diff --name-only`
- `rg` 检查 `DESIGN / NOT IMPLEMENTED`、禁止实现词项及文档链接
- `rg` 检查 Health Assessment 术语没有被描述为生产 schema、runtime 或 prompt 能力
- `rg` 检查 Health State/Health Evolution 的实现范围没有被误报为完整能力；Phase 1 persisted lifecycle 与 Phase 2 minimal read model 属于本次批准范围
- Phase 1/Phase 2/Phase 4 focused tests 与 Phase 5A Character UI focused tests 必须运行；不实现 Recovery Guidance/Projection/World Model health rules。
- Health Recovery Guidance / recovery-stage Context injection 已实现 Phase 5B 的窄范围 deterministic guidance；generic Health Projection、long-term progression、explicit recovery reference 与 UI recovery stage 继续标记为 DESIGN / PLANNED，不能写成已实现。

## Rollback boundary

只允许撤销本轮新增/修改的实现与设计 Markdown；不得触碰用户既有工作区改动。生产文件、schema、prompt、tests 与 runtime UI 仍受本阶段明确 scope 约束。
