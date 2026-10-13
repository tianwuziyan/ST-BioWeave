# ST-BioWeave 稳定核心模块边界保护（方案 A）

## Goal

通过现有 Trellis 规范、轻量静态边界门禁和 Story Time 行为基线测试，保护已验证的 Story Time、Event Domain、Event Reconciliation 与 Floor persistence 边界；不改变产品业务行为。

## Requirements

- 在现有 `.trellis/spec/domain/event-pipeline.md` 中记录稳定核心契约，并引用 `floor-state.md` 的 Floor/Swipe/Version 所有权。
- 增加只检查可靠 import 边界的静态测试，并由现有 `npm run check` 自动执行。
- 增加只读 Story Time 快路径的 characterization coverage，覆盖 canonical、Gregorian、custom calendar、calendar 不兼容、字段冲突、precision 和不可比较输入。
- 复用现有 Event Reconciliation 测试；仅在确认存在真实缺口时补测试。
- 不修改受保护核心实现、Event Schema、业务规则、持久化 ownership 或性能快路径。
- 禁止 commit、push、reset、stash 和切换分支；保留已有未提交文件。

## Acceptance Criteria

- [ ] 架构契约位于既有规范文件，不创建重复架构文档体系。
- [ ] 静态门禁只阻止可靠的跨层 import 越界，不使用全局字段字符串禁用。
- [ ] Story Time 基线测试记录现状与已知 fast-path 差异，不修改比较算法。
- [ ] 现有 Event Reconciliation 行为测试继续覆盖重复、continuation、evidence、身份、source、Floor/Swipe/Version 和生命周期行为。
- [ ] `npm run check` 与 `git diff --check` 通过。
- [ ] 受保护核心实现文件无 diff，产品运行行为不变。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
