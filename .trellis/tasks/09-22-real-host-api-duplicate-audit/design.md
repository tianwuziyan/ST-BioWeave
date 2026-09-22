# 技术设计与证据基线

## 已确认的附件证据

| 证据 | 结论 |
| --- | --- |
| 输入1 = 输入3 | 两次完全相同的 World Full 请求输入 |
| 输入2 / 输入4 | 同一目标边界：Floor 6、message 6、Swipe 0；均为 Event Analysis 输入 |
| 输入5 = 输入6 | 两次完全相同的 World Patch 请求输入 |
| 输出1 / 输出3 | 均可被当前 `parseWorldModelResponse` 成功解析并通过 World validation |
| 输出2 / 输出4 | JSON 可解析，但均在 `state_fact.payload.symptom` 的 typed record 校验失败 |
| 输出5 / 输出6 | World Patch 均可通过当前 patch validator；输出5含 fenced JSON，当前 World parser 的宽松候选解析可处理，patch 调用边界需按实际代码核对 |

当前不能仅凭 Event validation 失败解释所有重复请求：World Full 与 World Patch 也各自出现成对相同输入，必须从 runtime 调度、single-flight、Floor terminal state 与宿主事件顺序定位触发来源。

## 目标调用链

```text
真实 ST lifecycle signal
  -> lifecycle snapshot / Floor Version resolve
  -> scheduler decision (new Character / reroll / existing Swipe / edit)
  -> one Floor-Version Analysis Job
  -> resolve current World (Reuse | Patch | Full)
  -> Event Analysis
  -> normalize / validate / persistence
  -> UI resolver / selector / render
```

事件名只能作为观察信号；不得让 `MESSAGE_UPDATED`、`MESSAGE_EDITED`、`MESSAGE_SWIPED` 或普通 render 直接等价为 force/retry。

## 修复边界

优先修改 `runtime/event-analysis.js`，必要时修改 `runtime/events.js` 的真实 ST 事件适配；提示词修改在 `ai/prompts.js`。World UI 只对真实 World-owner mutation 失效，`GENERATION_ENDED` / `MESSAGE_RECEIVED` 这类纯生命周期信号不清空已解析的 World Model。保留现有 Floor storage abstraction、World/Analysis single-flight、stale guard 和 bounded scheduler dedupe。

## World UI-ready 与通知桥接

`ai/analyzer.js` 提供共享的 `buildWorldModelViewModel()` canonical read model。
World Full/Patch 保存后，Runtime 必须从当前 Floor/active Swipe 读回 root
`floor_version` 与 `world_model`，再通过该 helper；只有 read-back 和 view-model
都成功才发布 `WORLD_ANALYSIS_STATUS_CHANGED: success` 并继续 Event Analysis。
`WORLD_MODEL_UI_NOT_READY` 不回退到旧 World、人类规则或 Chat metadata。

Runtime 的 `WORLD_ANALYSIS_STATUS_CHANGED` / `EVENT_ANALYSIS_STATUS_CHANGED` 仍是
业务事件。`ui/app.js` 只对 terminal business result 转换为 toastr；自动 World
成功不单独弹窗，最终 Event terminal 才弹一次“世界与人物分析完成”。通知 identity
使用 Chat、Floor Version、attempt/trigger 和 domain，且 Runtime/UI 都不依赖面板是否打开。
BioWeave disabled 时丢弃迟到 terminal notification。
