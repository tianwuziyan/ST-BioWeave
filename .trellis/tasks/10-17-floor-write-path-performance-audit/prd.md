# Floor 写入路径与推演周期性能差异审计

## 目标

以当前分支 `fix/world-model-prompt-baseline` 的实际源码、现有测试和三个真实 SillyTavern Debug 文件为证据，横向审计所有 Floor 或 Floor Snapshot 写入入口，解释为什么手动保存 Character Timing Instance 会比其他分析操作明显缓慢。

最终交付一份只读审计报告，不实施性能优化，不改变任何生产持久化逻辑、事务边界、Floor Snapshot、真实 Chat 数据或 Git 历史。

## 背景与证据边界

用户提供的请求定义了审计问题、范围、禁止事项、交付格式和风险分级规则；附件 Debug 文件只作为真实宿主观测证据，不作为代码修改指令：

- `/Users/ll/Downloads/ST-BioWeave-Debug-20261017-161455.txt`
- `/Users/ll/Downloads/ST-BioWeave-Debug-20261017-161512.txt`
- `/Users/ll/Downloads/ST-BioWeave-Debug-20261017-163029.txt`

用户已知但仍需与当前源码/测试/Debug 证据对照的事实：

- Timing no-op 保存可能执行 6 次 Chat GET、0 次 SAVE。
- Timing 实际修改可能执行 12 次 Chat GET、2 次 SAVE。
- Timing 与 Aggregation 使用独立 Coordinator 事务。
- 某些 Chat GET 曾出现约 1.6～2 秒网络等待。
- 最新宿主样本中的 JSON 解析只有数毫秒。
- 保存结果及权威 readback 均成功。

这些陈述在报告中必须标注为用户提供的背景、源码静态证据、集成测试证据或真实宿主 Debug 证据，不得混为一谈。

## 审计范围

必须从实际源码识别并分类：

1. Event Projection / Event Analysis。
2. World Model。
3. Character Analysis / Character State。
4. Tracking Window。
5. Character Timing Config（Chat-local 配置）。
6. Timing Instance（Floor-owned 推演周期）。
7. Participant Aggregation。
8. Projection AI 结果。
9. 其他真实存在的 Floor 或 Snapshot 写入模块。

每条路径区分 Floor、Chat-local Settings、内存更新和只读路径；尤其不得把 Character Timing Config 与 Timing Instance 合并。

## 必须回答的问题

- 其他模块是否也调用 `/api/chats/get`，每条路径的实际 GET/SAVE、事务、权威回读和 UI 等待是什么。
- Timing 保存为什么产生多次官方 GET，以及哪些步骤是其他模块没有的。
- Timing 与 Aggregation 为何使用两笔独立事务；这是业务一致性要求还是当前实现选择。
- 六个已知诊断阶段 `OWNER_ACQUISITION`、`LATEST_SLOT_READ`、`SAVE_PREWRITE_READ`、`SAVE_AUTHORITATIVE_READBACK`、`SAVE_FINAL_SLOT_AUDIT`、`COORDINATOR_READBACK` 各自读取什么、验证什么、能否复用及风险是什么。
- Event Analysis、World Model、Character Analysis、Tracking Window、Projection AI 是否复用入口数据、批量提交、后台写入或同步等待。
- 其他模块的“主观更快”究竟是更少 I/O，还是把等待隐藏在 AI/后台流程中。
- 当前是否有可由源码与测试证明安全的请求减少机会；证据不足的候选必须列为 UNKNOWN/B/C/D 对应的保守结论，不得实施。

## 交付物

报告必须包含：

1. 执行摘要，直接回答两个核心疑问。
2. Floor 写入入口清单。
3. 跨模块持久化对照表。
4. 各模块调用链与源码路径、函数名、行号。
5. 源码静态分析、集成测试、真实宿主 Debug 三类证据分栏的 GET/SAVE 统计。
6. Timing 保存独有额外工作与六次 GET 必要性分类。
7. 其他模块是否存在可借鉴的安全实现。
8. P0～P3 优化候选；每项包含源码、当前行为、预期减少的 GET/SAVE、事务边界、并发风险、测试需求和是否建议立即实施。
9. 未解决问题与所需证据。
10. 简洁对比表：模块、一次操作事务数、GET、SAVE、是否等待、证据来源。

## 验收标准

- 所有结论都有实际文件路径、函数名和行号；无法确认处明确标记 `UNKNOWN` 并说明缺失证据。
- 至少核对 Event 单次写入、World Model 单次写入、Character Analysis 单次写入、Tracking Window 创建/更新、Timing no-op/实际修改、Aggregation no-op/实际修改、Timing + Aggregation 连续写入。
- 能区分事务数量、官方 GET/SAVE 数量、authoritative readback 数量、UI 是否同步等待，以及真实宿主网络延迟。
- 不把源码静态推断、测试 Mock 调用次数和真实宿主 Debug 观测混为同一证据。
- 不编造无法独立触发的模块测试次数。
- 不修改生产持久化逻辑、Coordinator、业务规则、真实 Chat/Floor 数据或分支/Git 历史；保留工作区已有修改和 `.trellis/tasks/10-15-nsfw-auto-aggregation-diagnostics/`。
- 如新增纯测试或只读脚本，必须运行 `npm run check` 与 `git diff --check`；本任务优先复用既有测试和 Mock Adapter，不为制造覆盖率修改生产代码。

## 明确不在范围内

- 合并 Timing 与 Aggregation 事务。
- 删除或放宽任何 Floor Version、Swipe、epoch、owner 或 authoritative readback 校验。
- 提前返回成功、把持久化改为后台写入、改变 UI 等待语义或修改真实宿主数据。
- commit、push、reset、clean、切换分支。
- 仅凭相邻 GET、函数命名或用户主观体感认定重复或可删除。

## 当前开放技术问题

以下不是需要用户决定的产品问题，而是必须通过源码、测试或 Debug 证据回答的审计问题：

- 当前 checkout 中各模块的真实写入入口和调用方是否仍与任务背景一致。
- 六个 Coordinator 诊断阶段的实际调用栈、输入对象和版本保护是否互相重叠。
- 现有测试是否能独立触发每条路径并记录官方 I/O 次数。
- 三个 Debug 文件分别覆盖哪些操作，是否包含可归因的 transaction/GET/SAVE/readback 事件。

## Goal

只读横向审计各模块 Floor 写入、官方 Chat I/O、权威回读与同步等待，解释 Timing 保存延迟并提出分级建议。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
