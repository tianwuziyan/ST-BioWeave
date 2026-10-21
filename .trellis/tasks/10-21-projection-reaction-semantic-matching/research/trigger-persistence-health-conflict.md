# 推演触发记录与健康恢复冲突审计

## 已确认现状

- `runtime/event-analysis.js` 的健康恢复路径会在 expected recovery 到达后，把符合条件的短期健康 Event 从当前 Floor 的事件集合中移除。
- `runtime/projection-runtime.js` 当前只使用 `businessData.active_events` 即时计算 `observed_reaction.matched`，没有保存命中结果。
- 因此来源 Event 被健康恢复清理后，同一卡片下一次读取会失去“已触发”。最小复现结果为：恢复前 `matched=true`，Event 过期并过滤后 `matched=false`。
- 内置受孕前推演采用完整阶段快照；endpoint 只把最新完整阶段作为当前产品视图，旧阶段卡片不会继续出现在当前候选中。
- `projection_timeline` 已是 Floor/Swipe-owned append-only owner，现有集合包括 creations、evidence、lifecycle 和 delivery。历史 delivery 已有独立读取路径，证明旧阶段记录可以在不重新暴露旧候选的前提下进行历史 replay。

## 产品决定

- 不修改健康识别、恢复或 Event 清理规则。
- 首次明确命中后，由推演卡自身保存“已触发”记录。
- 记录直接引用现有 `projection_id`，业务隔离只按人物；不新增 `pregnancy_id`，也不重复保存周期编号。
- 阶段替换后，仅已触发旧卡进入人物级“本轮曾经触发”，未触发旧卡不保留为当前数据。
- 历史触发继续发送给 ST，固定说明“此前出现过，不代表当前仍持续”。
- 用户手动编辑或删除 Event 只重算当前阶段；旧阶段历史不倒改。健康自动恢复不撤销触发。
- 当前人物的观察作用范围结束后，从当前读模型清理该人物的历史触发，不再进入 UI 或 Context；历史 Floor 仍按 endpoint/Swipe 规则用于回退。

## 推荐实现边界

- 在现有 `projection_timeline` 增加独立 observation records，而不是复用通用 factual lifecycle 的 `realized`。后者会改变 `factual_status/context_visible`，并把“候选反应曾出现”混同为通用 Projection factual evolution。
- observation record 必须 append-only、确定性去重、完整 Floor Version 绑定，并通过现有 Projection persistence coordinator 批量写入和权威读回。
- 当前视图继续只返回最新完整阶段；历史触发使用独立的历史读取结果，不把旧阶段 creations 重新放回当前候选集合。
- 当前阶段手动纠错需要 observation action 支持撤销；健康自动恢复路径不调用该撤销入口。
- 新持久化集合必须进入 schema、normalizer、lifecycle registry、clear/invalidation、Floor/Swipe rollback 和文档测试。
