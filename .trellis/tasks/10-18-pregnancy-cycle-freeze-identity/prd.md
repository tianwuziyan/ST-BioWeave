# 观察轮次冻结与身份隔离修复

## Goal

让受孕可能性观察轮次的业务语义与当前实现一致：

- 正式 Participant Aggregation 是当前轮次的候选名单快照，不是“已经怀孕”的事实；
- 聚合阶段允许 `pregnancy_id` 为空，因为此时还没有 ST 正文确认怀孕；
- 后续只有 ST 正文被 Event Analysis 确认后，才建立具体的 `pregnancy_id`；
- 没有正文确认时，超过正式观察周期就判定本轮没有怀孕，结束本轮，并清掉当前周期的 NSFW 事件，不能让它们继续影响下一轮；
- 当前有效 Event 变化不能改写历史正式 Aggregation；
- 不同妊娠身份不得互相污染，且不能把合法的 `pregnancy_id=null` 当成非法数据。

## Confirmed facts

1. 当前 HEAD 为 `851a7f8`，当前工作区在规划开始前干净；此前 `npm run check` 基线为 1576 pass、0 fail、16 skipped。
2. 当前 Timing 复用分支会在后续 Aggregation 判断之前，将候选 Event 加入已有 Timing 的 `source_event_ids`：
   [runtime/events.js:3068](/Users/ll/Library/CloudStorage/SynologyDrive-LL/VSCode/BioWeave/runtime/events.js:3068)。
3. 但生产 Lock 当前默认关闭：
   [runtime/events.js:1815](/Users/ll/Library/CloudStorage/SynologyDrive-LL/VSCode/BioWeave/runtime/events.js:1815)。因此“聚合成功后不会再写入受孕相关 Exposure”必须先确认实际运行路径是否有其他可靠保证，不能仅凭业务设想断言。
4. Tracking Window 当前会使用 World Model 的 `tracking_window_horizon` 拆分兼容 Exposure；测试明确覆盖该行为：
   [core/tracking-window.js:170](/Users/ll/Library/CloudStorage/SynologyDrive-LL/VSCode/BioWeave/core/tracking-window.js:170)、
   [tests/tracking-window-phase2.test.js:80](/Users/ll/Library/CloudStorage/SynologyDrive-LL/VSCode/BioWeave/tests/tracking-window-phase2.test.js:80)。
5. Lifecycle 事实冲突判断目前按 `subject_id + cycle_id`，未将 `pregnancy_id` 纳入比较：
   [core/pregnancy-lifecycle.js:107](/Users/ll/Library/CloudStorage/SynologyDrive-LL/VSCode/BioWeave/core/pregnancy-lifecycle.js:107)。
6. Projection Runtime 对 `not_pregnant` 存在绕过 `pregnancy_id` 比较的分支：
   [runtime/projection-runtime.js:39](/Users/ll/Library/CloudStorage/SynologyDrive-LL/VSCode/BioWeave/runtime/projection-runtime.js:39)。
7. `pregnancy_id=null` 不是天然错误：当前生命周期校验允许 `not_pregnant` 使用 null，观察阶段的 Aggregation 也可以尚未绑定具体妊娠身份。
8. 无 `cycle_id` 时 Lock 会按 subject 保守拦截：
   [core/participant-aggregation-lock.js:49](/Users/ll/Library/CloudStorage/SynologyDrive-LL/VSCode/BioWeave/core/participant-aggregation-lock.js:49)。这更接近 fail-closed 安全策略，而不是已经确认的跨妊娠污染；本任务只补测试和明确边界，不默认放宽。

## Requirements

### R1. 明确观察阶段与妊娠事实阶段

- Aggregation 只记录当前观察轮次的候选参与者与来源快照，不声明怀孕、父亲身份或概率事实。
- Aggregation 阶段 `pregnancy_id=null` 合法，表示尚未由 ST 正文建立妊娠身份。
- ST 正文经 Event Analysis 明确确认后，才生成具体 `pregnancy_id`，并将事实与正确的 subject/cycle 关联。
- 不能把“候选名单存在”当成“已经怀孕”。
- 如果观察周期走完仍没有 ST 正文确认怀孕，则本轮判定为没有怀孕，结束本轮，并从当前可用记录中删除本轮 NSFW 事件；这些事件不能带入下一轮。

### R2. 核实并保护聚合后的轮次边界

- 先用纯函数/假 Store/Runtime 测试确认：正式 Aggregation 成功后，实际业务路径是否仍能写入新的受孕相关 Exposure。
- 若业务路径确实禁止新 Exposure，则不得把“Timing 可能追加新来源”直接认定为已发生的主流程 Bug。
- 若新 Exposure 仍可进入当前有效 Event，则必须保证它不会悄悄修改已完成轮次的历史 Timing/Aggregation，也不能未经生命周期 Release 自动创建下一轮。
- 不允许因为本需求禁止普通 NSFW 事实记录；边界只针对受孕相关 Exposure 与轮次归属。

### R3. 重新定义聚合前 Tracking Window 的职责

- 在正式 Aggregation 到期前，独立 `tracking_window_horizon` 不得无依据拆散仍属于同一观察轮次的 Exposure。
- 不删除 Tracking Window；保留其当前 Tracking、生命周期展示和必要的派生职责。
- 将 horizon 拆分行为与正式 Timing/Aggregation 的有效 min/max 关系写成可测试契约。
- 当前 `.trellis/spec/domain/pregnancy-tracking.md` 与 2026-10-18 设计共识对 horizon 语义存在差异；实现前必须同步最终契约与测试基线。

### R4. 正确处理 nullable pregnancy identity

- `pregnancy_id=null` 必须继续支持观察阶段和未建立具体妊娠身份的生命周期路径。
- 不能简单把所有 null 判为非法，也不能让 null 无条件匹配任意具体妊娠 ID。
- 需要明确“观察阶段 null → ST 正文确认后具体 ID”的合法转换，以及不同已确认妊娠身份之间的隔离。
- Lifecycle 冲突判断、Projection Timeout/事实匹配、Archive/Release 关联必须使用同一套身份转换语义。

### R5. 删除与编辑来源的双层语义

- 删除或编辑旧 Exposure 可以改变当前有效 Event 快照和当前证据状态。
- 历史正式 Aggregation 的名单、数量、创建来源和 Story Time 不得被重新聚合或覆盖。
- 当前 Context/候选投影不得继续使用已经删除或失去依据的来源。
- 需要有明确的 `SOURCE_INVALIDATED` 或等价诊断，但不把历史成功降级为未聚合。

### R6. Lock 的保守边界

- 无 `cycle_id` 的受孕相关 Event 在 Lock 开启时继续 fail-closed，除非已经有可靠的周期解析结果。
- 明确周期且属于其他未锁定轮次的 Event 不应被错误拦截。
- 不在本任务中启用生产 Gate，也不以放宽 Lock 作为默认修复。

## Acceptance Criteria

- [ ] 测试证明聚合前同一轮的全部有效 Exposure 能进入同一正式聚合候选集合，不被 horizon 提前拆散。
- [ ] 测试证明正式 Aggregation 成功后的正常业务路径不会再把新的受孕相关 Exposure 纳入旧轮次；若当前代码允许该输入，则结果必须明确 fail-closed 或进入待处理状态，不能改写历史快照或自动开新轮。
- [ ] 测试证明 `pregnancy_id=null` 的观察阶段可以正常创建、持久化、推送中性 Context，并在 ST 正文确认后关联到具体妊娠 ID。
- [ ] 测试证明观察周期结束仍未收到 ST 正文确认时，本轮结束，本轮 NSFW 事件从当前可用记录中删除，下一轮不会继续使用它们。
- [ ] 测试证明不同具体 `pregnancy_id` 不会互相触发 Lifecycle 冲突、Timeout、Archive 或 Release。
- [ ] 测试证明 `not_pregnant` 的 nullable identity 只在正确的 subject/cycle/观察身份下生效，不绕过所有 pregnancy identity 检查。
- [ ] 测试证明删除一个已聚合 Exposure 后历史 Aggregation 不变、当前证据数量变化、来源失效诊断出现，且不会重新聚合。
- [ ] 测试证明删除候选人的唯一来源后，当前 Context 不再把该候选人当作当前有效事实。
- [ ] 测试覆盖显式空 Event 快照、Swipe 切换、Floor Version 变化、重复触发、写入结果未知和并发重入，并保持 fail-closed。
- [ ] 生产 `participantAggregationLockCapability` Gate 仍保持关闭；本任务不进行新的 Host 实验、不修改真实 ST 数据。

## Out of scope

- H-14 Host 最终请求装配、Abort/stopGeneration 和真实 Host 消费验收。
- 启用生产 Lock/Gate 或改变普通 NSFW 事实记录策略。
- 真实 ST Chat/Floor/Swipe 数据操作。
- Child NPC、分娩后人物生成、跨年自动结局。
- 清理不存在的固定 C001/C002 生产系统。
- 提交、推送或修改 Git 历史。

## 已确认的业务结论

超过正式观察周期仍没有 ST 正文确认时，按“本轮没有怀孕”处理：当前周期结束，本轮 NSFW 事件删除，下一轮重新开始。这个结论不依赖 Aggregation 是否曾经生成过候选名单。
