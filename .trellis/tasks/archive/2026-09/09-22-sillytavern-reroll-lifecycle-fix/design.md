# Technical Design

## Root cause

当前适配把非对象的 `GENERATION_STARTED` payload 直接写入 `pendingGeneration.messageId`。真实 SillyTavern 传入的第一个参数是 generation type 字符串（例如 `regenerate`），因此 pending intent 会携带错误的 message id，后续 CMR 无法匹配目标 Floor。

同时当前 `GENERATION_ENDED`、`GENERATION_STOPPED`、`GENERATION_CANCELLED` 共用立即清理逻辑。官方正常完成路径可能先发 `GENERATION_ENDED`，再发 `CHARACTER_MESSAGE_RENDERED`，所以正常 reroll 的 intent 会在最终 Floor Version 出现前被丢弃。

## Change boundary

只修改 `runtime/event-analysis.js` 的 generation intent 解析/生命周期消费和必要的 `runtime/events.js` 绑定，及 `tests/event-analysis-runtime.test.js` 的回归测试。保留所有已确认 Scheduler 业务状态和 Floor 数据规则；不恢复任何 event-name 到 force analysis 的粗粒度语义。

## Runtime behavior

- 标量 generation payload 只用于识别 generation type；message/swipe owner 从当前 lifecycle snapshot 推导，不把 `regenerate`/`swipe` 当作 id。
- `GENERATION_STARTED("regenerate")` 捕获当前 active Character Floor Version 作为 baseline，并保留 pending intent。
- `GENERATION_ENDED` 标记 generation 已结束但不立即清理 pending；随后 CMR 用新 Floor Version 判定并消费 intent。
- `GENERATION_STOPPED`/`GENERATION_CANCELLED` 在没有形成新版本时清理 pending；后续 CMR 只能走普通 CMR 规则。
- CMR 只在 `pendingGenerationMatches` 确认 chat/owner（若宿主未提供 owner 则使用 snapshot owner）且版本不同后进入 force path。清理和 single-flight 仍由现有代码负责。
- existing Swipe switch 和 ordinary edit/update 分支保持原样，不因本修复获得 force 权限。

## Verification seam

测试使用真实宿主的事件参数形状和顺序：`GENERATION_STARTED` 的 payload 为字符串 `regenerate`，而不是模拟对象；正常路径安排 `GENERATION_ENDED` 先于 CMR。另测 stopped/cancelled、existing Swipe、ordinary edit/update，断言实际 analyzer 调用次数。
