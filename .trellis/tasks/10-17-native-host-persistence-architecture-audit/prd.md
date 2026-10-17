# SillyTavern 原生 Chat 保存机制架构审计

## Goal

研究 BioWeave 是否能在保持 Floor 数据模型与一致性契约的前提下使用 SillyTavern Chat Context、消息对象和原生保存接口；仅新增隔离测试与审计报告，不修改生产持久化逻辑。

## Requirements

1. 以当前 BioWeave 源码和两个参考仓库的生产源码/测试为一手证据，分别还原：
   - ST-SevenDaysCal 的 Chat Context、消息/Swipe slot、`message.extra`、`saveChatDebounced()`、`saveChat()` 调用链；
   - st_bs_biotracker 的内存 Chat State、保存合并、防抖/立即保存、`saveRevision`、`localStorage`、`BroadcastChannel` 和刷新/关闭边界；
   - BioWeave 的 Timing、Aggregation、Coordinator、Store、Adapter 当前写入链。
2. 明确区分 Chat-local 配置、Floor Snapshot、宿主内存对象和官方 Chat 存档，不把参考项目的模型直接当作 BioWeave Floor 方案。
3. 在不修改生产持久化逻辑、Adapter、Runtime、业务规则和真实 Chat 数据的前提下，新增隔离的 host-save 行为模型/Mock 测试，覆盖 Context 原地修改、no-op、Chat/Swipe/消息正文变化、同 Floor 并发修改、Timing 与 Aggregation、保存失败、防抖未完成、其他扩展字段、Context/存档不一致、刷新前保存未完成、历史 Floor 拒绝及原生接口不可用 fallback。
4. 对候选 A（Context 原地修改 + 原生保存）、B（插件保存队列/批量过程）、C（持久化前变更检测）、D（混合 fallback）分别记录可观测请求数、同步等待和数据一致性边界，并标注 `PROVEN_SAFE`、`CONDITIONALLY_SAFE`、`PROVEN_UNSAFE` 或 `NOT_YET_PROVEN`。
5. 任何“保存成功”结论必须区分调用防抖接口、内存同步、官方 SAVE 完成和权威 readback；不能把 `saveChatDebounced()` 返回当作持久化确认。
6. 交付新的 Markdown 审计报告，所有关键结论附文件路径、函数名、行号、证据类型；理论请求数必须明确标为理论值。

## Acceptance Criteria

- [ ] 未修改生产 Coordinator、Adapter、Runtime、业务规则或真实 Chat/Floor 数据；现有工作区修改和既有任务目录完整保留。
- [ ] 报告包含两个参考项目和 BioWeave 的实际保存调用图、机制对照、契约边界、候选方案、测试证据、性能估计及真实宿主验证清单。
- [ ] 隔离测试使用可控 Promise/barrier，不使用固定延迟制造竞态；每个场景记录初始状态、并发位置、baseline 与候选行为差异。
- [ ] 测试结果区分 Mock/隔离模型证据、BioWeave 现有测试证据和真实宿主证据，不把模型通过等同于真实宿主安全。
- [ ] 报告直接回答：在不改变 Floor 数据模型和一致性契约的前提下，是否能够使用宿主原生保存机制；若有条件可行，列出进入生产前必须满足的条件。
- [ ] 运行 `npm run check` 与 `git diff --check`，真实记录结果；失败时区分既有失败和本轮新增失败。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
