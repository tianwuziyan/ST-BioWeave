# 推演周期 no-op 保存性能优化可行性审计

## Goal

在当前分支 `fix/world-model-prompt-baseline` 上，只读审计手动保存推演周期的三种 no-op：UI no-op、Timing no-op、Aggregation no-op，判断是否能够在保留 Floor Version、Swipe、Chat/epoch、并发与权威 readback 语义的前提下减少额外工作。

## Scope

- 追踪 `ui/app.js`、`ui/characters.js`、`runtime/events.js`、`storage/projection-timing.js`、`storage/participant-aggregation.js`、`storage/floor-persistence-coordinator.js` 及相关 Storage、Adapter、测试。
- 复核 Event Analysis、World Model、Character Analysis/State、Tracking Window、Character Timing Config、Timing Instance、Participant Aggregation、Projection AI 及其他实际 Floor 写入模块。
- 使用源码静态分析、现有集成/Mock Adapter 测试和三个真实宿主 Debug 文件，严格区分三种证据。
- 评估保持现状、UI dirty、Runtime 权威 no-op 快速路径、Coordinator 内部 no-op 优化四种方案。

## Non-goals and constraints

- 不修改生产持久化逻辑、Coordinator、业务规则、真实 Chat/Floor 数据或现有测试契约。
- 不删除官方 Chat GET、权威 readback，不合并 Timing 与 Aggregation 事务，不改变 Floor Version、Swipe、epoch/stale 保护。
- 不切换分支，不 commit、push、reset、clean。
- 不把 UI 表单相等推断为 Floor 权威 no-op。
- 未被源码或测试确认的请求数字必须标记为 `UNKNOWN` 或“理论上限”，不得伪装成实测结果。

## Required conclusions

1. 解释完全不修改 Timing 仍进入两笔事务的原因。
2. 区分 UI no-op、Timing no-op 与 Aggregation no-op，并指出各自在调用链首次可确认的位置。
3. 说明六类官方 GET 的数据、不变量、并发窗口、复用前提和 A/B/C/D 分类。
4. 说明 Timing 与 Aggregation 为何当前使用两笔事务，以及是否为业务硬性要求。
5. 列出其他模块是否真正写 Floor、是否调用官方 Chat GET、是否同步等待和现有计数证据。
6. 以现有测试列出已覆盖和缺失的 no-op/stale/concurrency/readback/partial-success 场景。
7. 给出一个风险最低且收益最明确的后续方案；若当前不能安全实施，明确写出“可证明减少请求数为 0”。

## Acceptance Criteria

- [ ] 在新的 `audit-report.md` 中包含执行摘要、当前 no-op 调用链、三种 no-op 定义、GET/SAVE 计数、Aggregation 触发条件、候选方案、并发/stale 风险、测试矩阵和推荐方案。
- [ ] 每项关键结论附实际文件路径、函数名称和行号；无法确认的模块或数字标为 `UNKNOWN` 并写明缺失证据。
- [ ] 对照表同时区分源码静态分析、现有集成测试/Mock Adapter、真实宿主 Debug 三类证据。
- [ ] 报告明确说明没有实施优化、没有修改生产代码和测试代码，并保留现有工作区修改及未跟踪文件。
- [ ] `git diff --check` 通过；本轮新增内容仅限审计任务文档。
