# 最小修复与验证计划（已实现，待质量门禁与 real-host）

## 顺序

1. ✅ generation lifecycle：pending Floor 56 后 render Floor 66 会 supersede 56，迟到 `GENERATION_ENDED` 不创建 56 analysis。
2. ✅ execution owner：generation-bound execution 在 AI 前校验 Chat、active owner、六字段 Version 与 generation identity；失败 fail closed。
3. ✅ input boundary：automatic reroll 使用 target slot 的 comparison Events/Registry，但不改变严格 previous Floor 语义。
4. ✅ Event identity：沿用现有保守 semantic key；historical rediscovery 与 genuinely new repeated Event 均有回归覆盖。
5. ✅ 五份权威文档已同步；未改变 Floor/active Swipe/version persistence boundary。
6. ⏳ 已完成语法与目标测试；待执行最终 `npm run check` 并进行 real-host 验收。

## 风险与回滚点

- `runtime/generation-lifecycle.js` 当前为 known-good/frozen 倾向路径；只允许修改已由 trace 证明的 stale supersede 分支。
- `runtime/event-analysis.js` 同时拥有 scheduler、execution ownership 与 context builder；不进行模块重构。
- `core/events.js` 的 semantic key 必须保持保守；未知或证据不足时宁可保留候选，不吞掉 genuine repeat。
- 如测试显示旧 Floor 的 valid current result 在 reroll 中承担 manual supplement A+B preservation 作用，必须保留该行为并改为显式 comparison reference，而非扩大 previous Floor。

## Real-host acceptance

- 手机前台生成、切后台、恢复后：不存在迟到旧 generation callback 重新触发旧 Floor。
- Floor 66 到来后，自动分析 owner 与四部分 Analysis Context 都是同一 Floor 66 Version。
- 切 Chat、切 Swipe、编辑/删除 Floor、reroll 后旧 execution 不写入新 owner。
- 历史 Event 重发现不新增 canonical record；后来真实发生的同类型事件仍保存。
- 事件写入、F5/reload、Tracking、Projection、World hard dependency 与 manual supplement A+B 均保持原语义。
