# 技术设计：观察轮次冻结与身份转换

## 1. 设计边界

本任务只处理本地 Domain、Runtime、Storage 的观察轮次语义和回归验证，不处理 Host 最终请求安全边界。Floor-owned Event 仍是当前事实源；Timing、Aggregation、Lifecycle、Tracking Window、Projection Delivery 各自保持现有 owner，不新增第二事实源。

## 2. 目标数据流

```text
当前有效 Exposure Event
  → Tracking Window / Timing 候选
  → 到达 frozen effective_min
  → Participant Aggregation 候选快照（pregnancy_id 可为 null）
  → 插件内置的中性 Projection 候选 / Context
  → ST 真实回复
  → Event Analysis
       ├─ 明确怀孕：建立具体 pregnancy_id 的事实
       ├─ 没有明确结果：继续观察
       └─ 超过 effective_max：判定本轮没有怀孕，结束本轮并删除本轮 NSFW 事件
```

Aggregation 不创建怀孕事实；`pregnancy_id=null` 表示观察轮次尚未绑定具体妊娠身份。

受孕前候选由插件按人物自己的经过天数生成，不调用 Projection AI：第 14–20 天显示嗜睡或疲倦、乳房敏感、对气味或食物产生轻微变化、暂时没有明显反应；第 21–27 天显示恶心、闻到气味不舒服、情绪变化、食欲变化；第 28–42 天显示恶心加重、可能出现孕吐、持续疲倦、一直没有明显反应。

## 3. 轮次边界

### 3.1 聚合前

正式聚合之前，所有符合 subject、mechanism 和 Story Time 约束的当前有效 Exposure 应进入同一轮次候选集合。Tracking horizon 不应在 effective_min 之前拆散这些事实。

### 3.2 聚合后

先确认实际 Event 写入路径是否已经阻止新的受孕相关 Exposure。若已经阻止，Timing 来源追加分支是防御性问题而非正常路径；若没有阻止，则必须使后续输入不能修改已成功快照，也不能自动创建新轮次。

历史 Aggregation 和当前证据分离：当前 Event 删除/编辑只影响当前证据视图与诊断，不覆盖历史 Aggregation。
如果仍有部分 accepted Exposure 在当前快照中有效，新 Projection 使用这部分当前证据；只有全部
来源失效时才阻断推演。已经保存且仍引用失效来源的旧 Projection 隐藏，不把失效来源重新带回正文。

### 3.3 没有怀孕时结束本轮

如果到了观察周期上限，ST 正文仍没有确认怀孕，则直接结束当前观察轮次。当前轮次积累的 NSFW 事件从当前可用记录中删除，下一轮不能继续读取这些事件。

如果这一轮已经生成过候选名单，名单也不能因此被当成怀孕事实；下一轮从新的有效事件重新开始。

## 4. pregnancy identity 转换

不要把 nullable identity 简化为“null 永远匹配”或“null 永远不匹配”。需要区分：

- 观察阶段：`subject_id + cycle_id + pregnancy_id=null`；
- ST 确认后：同一观察轮次关联具体 `pregnancy_id`；
- 不同已经确认的 pregnancy ID：必须隔离；
- `not_pregnant`：必须有明确的观察轮次归属，不能用状态名绕过所有身份检查。

最终实现应集中一个可复用的 identity matching/transition 规则，避免 `core/pregnancy-lifecycle.js`、`runtime/projection-runtime.js` 和 Lock 各自定义不同语义。

## 5. Tracking Window 改造原则

不删除 Tracking Window。应将其保留为当前 Tracking/生命周期派生视图，并移除或限制它在正式聚合前以独立 horizon 拆轮的能力。需要保留：

- Story Time 不可比较时 fail-closed；
- 当前有效 Event、Floor、Swipe 和 provenance 校验；
- 确认、流产、终止、分娩等事实终止行为；
- 与 Timing 的 cycle identity 一致性诊断。

## 6. 兼容性与回滚

- 不改变 Floor Event 的六字段 ownership 机制。
- 不删除已有历史 Timing/Aggregation/Lifecycle 数据。
- 不把历史 4 条来源改写成当前 3 条。
- 如果 horizon 语义发生迁移，必须先更新纯函数测试和 domain spec，再修改 Runtime 调度；保留旧数据的读取兼容性。
- 任一身份匹配无法证明时，返回 unresolved/blocked，而不是猜测或跨身份合并。

## 7. 延后项

H-14 Host 安全、真实回复消费、Receipt、Child NPC 和真实 ST 验收均不属于本设计。
