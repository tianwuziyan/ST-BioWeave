# 执行计划：跨 Floor 持续 Event 连续性

## 前置检查

1. 重新检查当前分支、工作区和本任务文件，确认没有覆盖用户已有修改。
2. 读取目标层的 Trellis spec 与当前 production context，特别是 Floor ownership、Event pipeline、Architecture 和 Data Model。
3. 保持 `storage/floor-persistence-coordinator.js`、Adapter、Generation lifecycle 和 lifecycle registry 不变；若发现必须修改，暂停并拆成独立 persistence/lifecycle root-cause task。

## 实施顺序

1. 在 `core/events.js` 增加/提炼 Episode continuity helper，并修复候选集合内部的 exact semantic dedupe。
   - 验证：纯函数测试覆盖历史重复、同响应重复、缺失 key 保留。
2. 在 `runtime/character-event-analysis.js` 调整 continuation compatibility。
   - 去除 exact Story Time equality。
   - 保留 Floor/Swipe/source、主体、参与者、机制和非同 stable identity 多匹配 fail-closed guard；完全相同 stable identity 的历史重复默认收敛到最早 source floor/event，合法显式引用属于该重复组时保留被引用 Event 为身份锚点。
   - 实现完整稳定 participant/counterpart 集合下、Story Time 可比较且间隔不超过 6 小时（含跨午夜）时无需 marker 的唯一候选 continuity；超过窗口、缺失/不可比较时间时 fail closed；保留 `continuation_update=true` 对集合扩展和跨窗口延续的授权，并在没有 marker 时拒绝宽 Episode 猜测。
   - 保留原 Event ID/source 和合并证据语义。
3. 更新 `ai/prompts.js` 的 episode boundary contract。
   - 明确时间前进/跨午夜不是新事件。
   - 明确结束、转场、重新开始才是独立边界。
4. 先添加/改写回归测试，再运行实现后的 focused tests：
   - 同日相差两小时（以及 6 小时边界内的 2 小时 10 分）；
   - 跨午夜；
   - 超过 6 小时、时间缺失或不可比较时不隐式合并；
   - 多小时证据/pathway 改写；
   - 明确结束后重启；
   - 不同 stable identity 的多个兼容历史 Event 时不猜测；完全相同 stable identity 的多个历史 Event 收敛并暴露 trace removed ids；
   - 不同 subject/机制不合并；
   - 同响应 exact duplicate 只保留一个；
   - 旧显式 continuation 与 manual reanalysis 保持原 ID/source。
5. 同步 `.trellis/spec/domain/event-pipeline.md`、`docs/DATA-MODEL.md`、必要的 `docs/ARCHITECTURE.md` 和相关 Markdown；删除/替换与最终规则冲突的旧测试说明，不保留两套连续性契约。
6. 运行验证：
   - `node --check` 修改的 JavaScript；
   - Event focused tests；
   - `npm run check`；
   - `git diff --check`；
   - 检查无新增 Chat-level state、无 storage bypass、无临时 debug 前缀残留。
7. 通过项目真实 SillyTavern 宿主验收：
   - 同一场景连续生成多个 Floor，时间相差约两小时；
   - 同一场景跨午夜；
   - 明确结束并重新开始；
   - F5/reload、切换 Swipe、重新分析后 Event ID/source/Tracking 一致。

## 高风险文件与回滚点

- `core/events.js`：identity helper 与候选去重；必须保持 conservative exact key。
- `runtime/character-event-analysis.js`：跨 Floor reconciliation；必须保留 owner、source visibility、current Floor snapshot 和多匹配 fail-closed guard。
- `ai/prompts.js`：输出边界契约；必须保持 0/1/N Event、subject-local grouping 和 continuation metadata placement。
- `tests/event-analysis-runtime.test.js` / `tests/event-analysis.test.js`：替换旧的 strict time/license 断言，不能删除独立 Event 防误合并覆盖。
- `docs/DATA-MODEL.md` / `.trellis/spec/domain/event-pipeline.md`：与实际最终实现保持一致。

若 focused test 发现隐式连续会吞掉独立事件，先关闭 fallback，仅保留时间容错的显式 continuation，再重新评估，不修改 persistence 或加入临时 Chat cache。

## 完成门槛

- 最小红色复现和回归测试在修复前失败、修复后通过。
- 完整 `npm run check` 通过。
- 实际 Diff 只包含本任务范围。
- 相关 Markdown/spec 已检查并同步。
- 未 commit、未 push；真实宿主验收结果单独报告。
