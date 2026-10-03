# 66楼自动分析 stale execution 与重复 Event 根因审计

## Goal

基于 real-host Floor 66 附件、当前代码与 SevenDaysCal 对照，证明或排除三个关联问题的共同根因：后台/迟到的 stale analysis execution、Analysis Context 混用 Floor、以及历史 Event 重复进入 canonical Event 记录。只有代码与 trace 已充分证明根因时，才进入最小修复；证据不足时只增加最小诊断 trace，等待下一次 real-host 复测。

## Confirmed field facts

- Live snapshot 已经是 Floor 66，并收到 Floor 66 的 `CHARACTER_MESSAGE_RENDERED` 与完整六字段 Floor Version。
- 随后的 `ANALYSIS_INPUT_READY` / `AUTO_ANALYSIS_TRIGGERED` owner 是 Floor 56；该 execution 为 `trigger=reroll`、`generation_type=regenerate`、`generation_settled=true`。
- Event Analysis input 明确是目标楼层/目标消息 56；AI 从旧 narrative 再次输出已发生的 `sexual_activity`，用户观察到重复 Event。
- 手机浏览器切后台期间自动分析不能正常继续；SevenDaysCal 在相同使用方式下可后台继续工作。

## Requirements

1. 完整追踪 `GENERATION_STARTED → render → generation settle → scheduler → automatic-analysis port → analysis-execution → input build`，定位 Floor 56 如何在 live Floor 66 后成为 execution owner，并确定是否由 timer、pending/completed generation、reroll intent、迟到 callback 或 owner 校验缺失造成。
2. 逐字段证明 `Current Target Floor`、`Recent Story`、`existing_events`、`character_registry` 使用的 analysis boundary，禁止一个 Analysis Job 在创建、输入构建、AI 提交之间混用 Floor Version。
3. 审计现有 Event identity/canonical contract、`core/events.js::dedupeEvents` 与 persistence gate，区分 historical rediscovery 和 genuinely new repeated event；不以 display name、模糊文本或 type/人物粗暴去重。
4. 对照 SevenDaysCal 的后台任务/队列、task owner、Chat boundary、取消与即时保存机制，只提炼适用于 BioWeave 的边界，不复制其业务架构。
5. 明确并冻结用户给出的 10 条 invariants，保留 Floor/active Swipe/version authority、manual supplement A+B、World hard dependency、Tracking 与 Projection 语义。
6. 若实施修复，必须同步审计并更新 `docs/AUTO-ANALYSIS-SCHEDULER.md`、`docs/DATA-MODEL.md`、`docs/bioweave-data-lifecycle.md`、`.trellis/spec/domain/floor-state.md`、`.trellis/spec/domain/event-pipeline.md`；若仅增加诊断，也必须记录实际影响范围。

## Out of scope

- unrelated StoryTime failures。
- 回滚已完成的 automatic-analysis / manual-analysis / analysis-execution 隔离。
- 大重构、commit、push，以及没有 trace/代码证据支持的猜测性修复。

## Acceptance Criteria

- [ ] 交付用户要求的 `BACKGROUND_FINDING`、`STALE_56_EXECUTION_PATH`、`CONTEXT_BOUNDARY_FINDING`、`EXISTING_EVENTS_FINDING`、`REGISTRY_FINDING`、`RUNTIME_DEDUPE_FINDING`、`SEVENDAYSCAL_COMPARISON`、`COMMON_ROOT_CAUSE`、`MINIMAL_FIX_PLAN`、`REGRESSION_TEST_PLAN`、`DOC_UPDATE_PLAN`，每项有附件/代码位置证据。
- [ ] 明确判断根因是否已充分证明；未充分证明时不得修改产品运行时代码，只允许最小诊断 trace。
- [ ] 若实现最小修复：自动 execution 绑定单一 Floor Version，AI 开始前执行 owner 合法性检查，四部分 Context 同 boundary，迟到 callback 不得复活 stale Floor，重复历史事实有 Runtime 第二道确定性防线且不吞掉后来真实重复事件。
- [ ] 自动化测试覆盖 stale execution、后台/迟到 callback、context boundary、registry/existing events、historical rediscovery 与 genuine repeat；real-host 验收项单独列出。
- [ ] 相关权威 Markdown/spec 与最终实现一致；不提交、不推送。

## Open planning decision

- 当前需要先完成代码、附件与 SevenDaysCal 证据审计；若证据充分，后续规划最小修复并等待用户批准规划摘要后再启动实现。若证据不足，规划仅包含诊断 trace 与 real-host 复测。
