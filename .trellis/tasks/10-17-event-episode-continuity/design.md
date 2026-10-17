# 技术设计：跨 Floor 持续 Event 连续性

## 1. 设计目标

将“完全重复事实”和“同一持续 Episode 的新观察”分成两条判断路径：

```text
AI candidates
  -> identity resolution
  -> exact semantic dedupe
  -> episode continuity reconciliation
  -> domain validation
  -> complete current-Floor Event snapshot
```

Floor 仍然是事实快照和 persistence owner；Episode continuity 只决定当前候选是否继承已有 canonical Event 的身份，不创建第二个事实源。

## 1.1 历史规则审计结论

`a438c6a26259912cad90e9f608f3ac6b34fcf744` 前后按事件相关文件追踪后的结论如下：

1. 初始实现 `171eee4` 没有历史 `existing_events`、精确 semantic duplicate guard 或跨 Floor continuation；它只处理当前分析输入，因此不会暴露“继承旧 Event 后又追加新 Event”的路径。
2. `3239980` 增加了历史发现窗口和 `eventSemanticKey()`。这是完全相等去重，不是 Episode 连续性；精确 Story Time 和证据文本属于 key 的一部分。
3. `c9feca3` 增加完整 Floor Event 状态继承，让旧 Event 在新 Floor 中继续存在。之后如果新候选无法通过严格匹配，就会出现旧 Event 保留、新 Event 追加。
4. `a8e046e` 增加 continuation 协议，并把跨 Floor 复用绑定到显式 ID 和精确 Story Time；同时 `eventContinuityKey()` 的无 ID fallback 只覆盖当前 Floor 来源事件。这是当前“同日相差两小时、跨午夜被拆成多条”的直接规则来源。

早期 `69b1ad1` 的 subject-local 规则仍然有效：一个 gestational subject 的同一持续 Episode 可以包含多个 counterpart/exposure source；不同 gestational subject 必须拆分。新的 continuity helper 必须继承这个集合扩展语义，不能把 counterpart 集合完全相等误当成 Event 边界。

所以修复应保留 `eventSemanticKey()` 的完全重复保护，同时新增独立的 Episode continuity reconciliation；不能把 semantic key 直接改成宽松 key，也不能把 `a438c6a` 当成事件规则变更点。

## 2. Core identity

### 2.1 保留 `eventSemanticKey`

`eventSemanticKey()` 继续承担保守的完全重复判断，保留 Story Time 和 factual evidence 的精确性，避免把同人物、同地点的真实独立事件直接吞掉。

`dedupeEventsAgainstExisting()` 改为维护一个包含历史 Event 和已保留候选的 key 集合：

- 历史 key 命中：丢弃历史重复候选；
- 当前候选首次出现：保留并加入集合；
- 同一响应后续相同 key：丢弃；
- key 不完整：维持当前 fail-safe，保留候选。

### 2.2 新增 episode continuity key/helper

在现有 `core/events.js` 的 Event identity owner 中增加独立 helper，或将现有同 Floor key 提炼为共享 helper。它只用于 `sexual_activity` 的持续性 reconciliation，不替代 semantic key。

稳定字段建议为：

- Event `type`；
- 单一 `gestational_subject_id`（这是 subject-local Event 的连续性锚点）；
- reproductive mechanism `kind`。

`counterpart_ids` 和 canonical participants 不参与宽 Episode key：同一接受方在持续 Episode 中可能先后出现多个 exposure source。对于 marker-free 延续，完整的 participant/counterpart 集合与地点必须保持稳定；命中一个历史候选时直接复用，若多个历史候选的 stable continuity identity 完全相同，则在没有明确独立边界和集合扩展时收敛到最早 source floor/event 并合并证据。当集合扩展时，`continuation_update=true` 才提供合并许可。只有主体变化、机制变化、明确独立边界或存在多个不完全相同且无法唯一消解的历史 Event 时才拒绝合并。若同一接受方存在多个独立事件，仍需依靠 continuation 证据、场景兼容性和 stable identity 保护，不能仅凭主体 ID 无条件合并。

以下字段不参与 Episode identity 的精确相等判断；无标记连续仍受 Story Time 窗口约束：

- exact Story Time / day rollover；
- source evidence 的具体文字；
- mechanism pathway / label 的修辞变化；
- Floor 编号、响应序号、Event ID。

无标记跨 Floor 延续必须使用可比较的 Story Time，实际间隔不超过 6 小时（含跨午夜）。
时间缺失、不可比较或超过窗口时 fail closed；合法显式 continuation 可以跨越该窗口。

地点作为 compatibility check：两边都有地点且明确不同则不隐式合并；一边未知时允许继续由叙事关系决定。不得把地点单独当作合并条件。

## 3. Runtime reconciliation

### 3.1 历史输入边界

继续使用 `runtime/event-analysis.js::selectAnalysisExistingEvents()` 和当前 bounded discovery window。不得读取 Chat-level Event map，不得遍历无界历史 Floor，也不改变 previous valid Floor 的 ownership contract。

### 3.2 continuation 校验

调整 `runtime/character-event-analysis.js`：

1. 显式 `continuation_of_event_id` 先按稳定 Episode compatibility 校验；
2. 不再要求候选与已有 Event 的 Story Time 完全相等；无标记延续的实际间隔仍必须不超过 6 小时；
3. 允许 6 小时窗口内的同日推进、跨午夜推进和不同精度的可比较时间；显式 continuation 可跨越窗口；
4. 继续保留 Chat、active Swipe、source visibility、type、subject anchor 和机制 kind 等安全校验；counterpart/participant 集合允许在同一 subject-local Episode 中扩展；
5. 继续拒绝不同机制、不同 subject、不可见来源和无法唯一确定的引用。

### 3.3 无精确 ID 的连续

当 AI 判断当前候选仍属于同一持续 Episode 时，优先设置已有的 `continuation_update=true`；但如果 subject、机制、地点以及 canonical participant/counterpart 集合均未变化，Runtime 可以在唯一稳定匹配时接受省略 marker 的候选。`continuation_of_event_id` 仍是可选的精确身份提示：

- 有合法 ID：按稳定 Episode compatibility 校验并合并；
- 没有 ID：在 bounded `existing_events` 中存在一个稳定 Episode compatibility 候选且 Story Time 可比较、实际间隔不超过 6 小时时解析为该 Event 并合并；如果存在多个完全相同 stable continuity identity 的历史候选，且当前候选没有 `continuation_update=false`、稳定集合没有扩展并且都处于同一 6 小时窗口内，则收敛到最早 source floor/event 并合并历史证据；有合法 `continuation_of_event_id` 时以被引用 Event 作为身份锚点，如果它本身属于同一 stable duplicate group，则把其它历史重复合并进去；引用无效、目标属于集合扩展或其它不同 stable identity 时不猜测收敛；
- 没有 `continuation_update=true` 时，只允许完整稳定集合的唯一 marker-free 延续；集合扩展、关系不完整或需要更宽 Episode 匹配时不自动合并；
- 若存在多个不完全相同的兼容历史 Event、无法读取稳定主体或关系不明，则保留候选并记录诊断；完全相同 stable identity 的历史重复按最早 source floor/event 收敛，并记录 removed ids；
- 新 Event 仍按当前目标 Floor Version 生成 ID，合法连续 Event 则复用原 Event ID。

叙事边界仍由 Event analyzer 负责识别，Prompt 要明确“窗口内的时间变化不是新 Episode”；Runtime 只做稳定身份、6 小时窗口和 provenance 安全校验，不使用粗暴的关键词/模糊文本相似度代替事件边界。超过窗口的无标记观察必须作为新候选，明确 continuation 才能跨窗口。这样可以去掉精确 Event ID 与精确时间的硬耦合，同时避免把同人物同地点的独立新一轮事件全部吞并。

## 4. Merge semantics

`mergeContinuedEvent()` 保留：

- 原始 `event_id`；
- 原始 Event `source`；
- 原始起始 `story_time`；
- 已有 participant/capability facts。

合并新增：

- 新的 source evidence；
- participant evidence；
- 已有的 state/physical effect 更新；
- mechanism evidence / compatible rule refs。

本任务不新增 `last_observed_story_time` 或时间区间字段，避免扩展 persistent schema、生命周期 registry、UI 和下游时间计算。后续若需要展示持续区间，另行设计非破坏性字段和迁移。

## 5. Prompt and contract synchronization

`ai/prompts.js` 需要明确：

- 同一场景和行动线程持续时，即使 Story Time 前进或跨午夜，也属于同一 Episode；
- 证据文本、pathway、label 的改写不等于新 Event；
- 明确结束/重新开始/独立动作才建立新 Episode；
- `existing_events` 是参考，Runtime 会做最终稳定匹配和 provenance 校验。

同步更新：

- `.trellis/spec/domain/event-pipeline.md`；
- `docs/DATA-MODEL.md`；
- `docs/ARCHITECTURE.md`（如最终模块责任或连续性边界发生变化）；
- 相关测试说明。

## 6. Compatibility and risks

- 旧 Event 没有新增字段，不需要数据迁移。
- 原始 Event source 保持不变，继续满足 Floor provenance 约束。
- 已存在的重复 Event 不在本任务自动清理；隐式连续只对新一轮 reconciliation 生效。
- 最大风险是同人物、同地点、同机制的独立事件被误合并，因此只有完整 stable identity 且 Story Time 间隔不超过 6 小时的历史重复才允许无 marker 收敛；不完全相同的多匹配必须保守保留，集合扩展仍需要显式 marker，明确 continuation 才能跨窗口。
- 如果真实宿主仍产生重复，Debug trace 需要区分：`existing_events` 缺失、稳定 key 多匹配、AI 明确独立、或 Runtime 合并未执行。

## 7. Rollback shape

所有行为变更集中在 `core/events.js`、`runtime/character-event-analysis.js`、`ai/prompts.js` 和对应测试/契约文档；不修改 `storage/floor-persistence-coordinator.js`。若真实宿主验收发现误合并，可回滚 episode continuity fallback，同时保留同响应 exact duplicate fix。
