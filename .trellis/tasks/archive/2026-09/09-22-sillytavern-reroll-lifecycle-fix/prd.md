# 修复真实 SillyTavern reroll 生命周期适配

## Goal

核对当前 SillyTavern 官方 reroll/generation 事件顺序，修复 pending generation 与新 Floor Version 的适配，并补充真实顺序回归测试；保持其它 Scheduler 语义不变。

## Requirements

- 适配 SillyTavern 官方 `GENERATION_STARTED` 的位置参数形状：第一参数是 generation type（`regenerate`/`swipe`），不能当作 message id。
- 允许正常完成路径中的 `GENERATION_ENDED -> CHARACTER_MESSAGE_RENDERED` 顺序，使 pending reroll intent 能由最终的新 Floor Version 消费。
- 仅当 generation intent 与新 Floor Version 同时成立时，强制当前 Character Floor 分析 exactly once。
- 取消/停止且未形成新 Floor Version 时不分析，并清理 pending intent；后续普通 CMR 不得误触发。
- 保持 existing Swipe switch、ordinary edit/update、Character-only counter、retryPaused、World Full/Patch/Reuse、single-flight、stale guard、immutable Floor、forward-only persistence 和 bounded dedupe 的既有语义不变。

## Acceptance Criteria

- [ ] 真实 ST 位置参数 `GENERATION_STARTED("regenerate")` + `GENERATION_ENDED` + 新版本 `CHARACTER_MESSAGE_RENDERED` 触发一次 force analysis。
- [ ] `GENERATION_ENDED` 在 CMR 前到达时 pending 不提前丢失。
- [ ] 停止/取消且版本未变化时不分析，pending 最终清理，后续普通 CMR 不误触发。
- [ ] existing Swipe switch API=0、counter 不变；ordinary edit/update API=0。
- [ ] `npm test`、`npm run check`、`node --check`、`git diff --check` 全部通过，0 fail、0 skipped。

## Notes

- 官方源码依据：`Generate(type)` 在 `public/script.js` 发出 `GENERATION_STARTED` 时传递 `type`，正常回复保存后发出 `CHARACTER_MESSAGE_RENDERED`；`hideStopButton` 会发出 `GENERATION_ENDED`。
- 本任务只修复真实宿主生命周期适配，不重新设计 Scheduler。
