# 技术设计：妊娠参与者名单聚合生命周期

## 1. 推荐所有权

新增独立的 Floor-owned `participant_aggregation_timeline`，不把成功状态放入：

- `tracking_window_timeline`：它负责 Exposure round 的时间相关性与 horizon 生命周期；
- `projection_timing_timeline`：它只冻结 Timing basis、偏移和 effective range；
- `projection_timeline`：它负责未来可能性，不拥有事实聚合；
- Chat-level registry/cache：违反 Floor State Ownership。

独立 timeline 可以复用现有 Floor Persistence Coordinator 和 active Swipe/六字段 Floor Version 校验，但拥有独立 schema、readback、dedupe 和 lifecycle 语义。

## 2. 推荐记录

```text
participant_aggregation_timeline:
  schema_version
  creations[]:
    aggregation_id
    owner_type: character
    subject_id
    mechanism_key
    cycle_id
    timing_instance_id
    aggregation_trigger_strategy: at_effective_min
    status: succeeded
    reference_story_time
    aggregation_story_time
    elapsed_story_days
    effective_min_story_days
    effective_max_story_days
    sampled_individual_offset_story_days
    config_snapshot
    accepted_exposure_event_ids[]
    source_basis_refs{}
    created_at_floor_version
    created_at
  lifecycle_records[]
```

`accepted_exposure_event_ids` 是聚合成功时已经接收的本轮边界，不是跨 Floor Exposure 池。当前名单每次从当前有效完整 Floor Event 集合中按这些 IDs 重新派生，因此编辑/删除会修正名单，而成功状态不会因 AI 失败或重跑消失。

## 3. 状态与策略

```text
Timing Instance
  → elapsed = Story Time - reference_story_time
  → elapsed < effective_min: not_due
  → elapsed >= effective_min: aggregate_due
  → elapsed > effective_max: aggregate_due_overdue
  → current complete Events → persist succeeded
  → current participant read model → existing Projection Runtime
```

当前纯策略接口建议为 `resolveAggregationTrigger({strategy, timingInstance, currentStoryTime, elapsed})`，只实现 `at_effective_min`。未来 `random_within_effective_range` 只能读取 frozen effective min/max；本阶段不抽样、不写配置、不修改 Timing Instance。

成功记录按 `subject_id + cycle_id + timing_instance_id` 查找。已成功且人物仍处于锁定期时，不能接收该人物新的受孕相关 NSFW Exposure；过滤在 Event 持久化前完成。未锁定人物的 Exposure 仍正常保存，普通非受孕 NSFW Event 不受影响。重复执行不重复写 success，但继续依据当前完整 Event 快照重建名单。

## 4. 生产调用链

当前 `runtime/events.js:1891-1976` 收集 Floor、Events、Tracking、Story Time 并解析 Timing，`runtime/projection-runtime.js:263-325` 执行 Eligibility/AI。目标链路为：

```text
collectInputs
  → resolve existing Timing Instances
  → read aggregation timeline bounded by current endpoint Floor/active Swipe
  → evaluate trigger using effective fields only
  → due + no success: aggregate current complete Events and persist success
  → derive current participant list
  → require aggregation success in Projection Eligibility
  → existing Projection Runtime / AI / readback
```

Event edit/delete 继续经过现有完整 Event 集合保存和 refresh；不能在普通 Event 入口做全局锁定，也不能重新调用 Timing Instance resolver 抽取偏移。

## 4A. Event 写入过滤与复合 Event

现有代码的实际顺序是：

```text
AI analyzeFloor
  → parseEventAnalysisResponse / normalizeEventRecord
  → identity resolution
  → Story Time filtering
  → validateEventCollection
  → build complete events array
  → commitFloorPatch({events})
```

证据为 `runtime/character-event-analysis.js:329-342`、`356-376`、`413-467`、`503-506`、`607-616`。现有 `ai/analyzer.js:3418-3423` 和 `core/events.js:619-637` 都会拒绝多 gestational subject 的 canonical `sexual_activity`，所以人物级过滤不能等到最终 canonical Event 写入后再做。

当前 `parseEventAnalysisResponse`/canonical parser 可能在人物拆分前拒绝多 gestational subject，因此不能把复合 JSON 直接传入其单主体 canonical 分支。推荐在 `runtime/character-event-analysis.js` 的 AI 原始结果接收后、`normalizeEventRecord` 和最终 `validateEventCollection()` 之前增加“复合 AI 中间结果 → subject-local canonical Event”边界；identity resolution/Story Time 接受结果仍在该边界前完成：

1. 以当前 aggregation success records 建立 `lockedSubjectIds`，只针对 pregnancy-relevant Exposure；锁定判断在该中间结果边界完成。
2. 对每个 AI Exposure 的 gestational subject 建立独立 slice；锁定主体 slice 在 `commitFloorPatch` 前丢弃，未锁定主体 slice 保留。
3. 对每个保留 slice 重建 participants、subject/counterpart IDs、participant evidence、source evidence 与 relationship references；共享 counterpart 只在仍被保留的 slice 中出现。
4. 每个 slice 在 `normalizeEventRecord`/最终 collection validation 边界生成现有 subject-local canonical Event；最终 canonical Schema 仍只允许单一 gestational subject，不得通过放宽 `core/events.js` 的最终约束绕过拆分。
5. 若所有 Exposure slice 被过滤且没有其它业务内容，丢弃该 AI Event；若存在非 Exposure 内容，保留它但清除被锁定人物的所有引用。

这样既能实现人物级写入过滤，也不会把人物 A 的锁定扩大为人物 B 的全局阻断，更不会把不应写入的 Exposure 先写入再从 Tracking 排除。

## 4B. Event 编辑锁定

`runtime/event-editing.js:updateEvent()` 当前在 `normalizeEvent`、Story Time 校验、完整 collection validation 后，于 `commitFloorPatch` 写入；见 `97-224`。实施时应在 normalization 或 collection validation 前增加一个只读 `assertEventEditable(eventId, currentAggregationState)`：

- accepted Exposure Event 且其 aggregation cycle 尚未结束：返回稳定的 edit-locked error；
- 已结束周期、非 Exposure Event、尚未成功聚合 Event：继续原有编辑流程；
- `deleteEvent()` 不调用该 edit lock，继续允许删除并写回完整 Event 集合。

锁定判断必须读取当前有效 Floor/active Swipe 的 aggregation timeline，不能依赖旧 Chat registry。删除后 Tracking/aggregation current list 重新派生；Projection readback/context 必须按 `aggregation_id`、妊娠/周期身份、accepted Exposure IDs 和参与者→Exposure mapping 逐层比较当前证据。旧 Projection history 可以保留，但任一层不一致即不得进入当前 ST Context。

## 4C. 判定结束与锁定释放

不得把 confirmation、loss、abortion、delivery 等所有 factual terminal Window 统一映射为 Event 解锁：确认未怀孕时，本轮 Exposure 从当前有效 Event 集合退出；确认怀孕但妊娠仍在进行时，已聚合 Exposure 继续保留并锁定；妊娠实际结束时，必须先归档原 `pregnancy_id` 的候选名单、必要证据和 provenance，再让旧 Exposure 退出当前有效 Event 集合并释放编辑锁定。父方仍 unknown 时，独立父方追踪继续存在；父方确认只结束对应 pregnancy 的父方追踪，不单独触发 Exposure 解锁。

“妊娠实际结束”需要后续领域事实定义，不能仅从 terminal Window 类型枚举推断。AI 失败不会重新开放 Exposure 收集；妊娠生命周期、父方追踪和聚合/Projection 两个状态仍保持独立。该事实来源及归档边界必须在实施前写入 lifecycle contract 和测试。

## 5. Floor/Swipe 与 Projection 旧证据

- 新 adapter 仿照 `storage/projection-timing.js:16-43` 做 owner、active Swipe、完整 Version、current Version 校验。
- 读取只聚合当前 Chat、active Swipe、endpoint Floor 可见的 timeline；回退时不得读取未来 Floor success。
- 新聚合路径 Projection 必须带 `aggregation_path=participant_aggregation` 和完整 aggregation evidence；该标记用于与历史无 evidence Projection 区分，不能把缺失 evidence 的新记录当作旧记录兼容。Evidence 至少包含 subject、aggregation/cycle identity、accepted Exposure IDs 和 participant→Exposure mapping。
- 已有 Projection evidence 保持历史 append-only；删除/编辑 Exposure 后当前名单重算，旧 evidence 不静默改写。以下情况都要使 Projection 对当前 ST Context 不可见：多 Exposure 参与者仅删除其中一条导致其 mapping 变化；唯一 Exposure 被删除导致参与者退出；全部 accepted Exposure 被删除；或当前 accepted Exposure 集合/参与者 mapping 与旧 Projection 来源不一致。实现上可保留历史 Projection，在 readback/context DTO 构建时执行证据比较和 `context_visible=false` 过滤，不直接删除历史记录。
- 聚合 success 和 Projection AI success 独立，AI 失败不回滚 success。

## 6. 主要风险

- 现有 `evaluateProjectionTiming()` 在 max 后返回 `window_missed`；实现应在聚合前置层把它转为 overdue aggregation，不修改 Timing Instance 的 frozen fields。
- 新 Floor root 必须同步 lifecycle/clear/readback；缺少任一项都不能宣称完成。
- 聚合锁定不得在没有妊娠结束归档与释放能力时独立启用。推荐以 lifecycle archive/release capability 作为 aggregation lock 的上线门禁；未满足时不启用新 Exposure 写入过滤和 edit lock，且不得用 Story Time、Timing Window 或 Projection AI 猜测结束。父方 unknown 不阻止新妊娠周期。
- 现有规范将 Timing/Window/Projection 分离；实施时需更新受影响业务规范，但本规划阶段不改规范文件。

## 7. 父方追踪的后续领域边界（不属于本次实现）

### 7.0 配置所有权与 UI 依赖

现有「推演周期」UI 是人物详情页的 Chat-local timing config 编辑器：`ui/characters.js:311-328` 渲染 5 个 timing 字段，`ui/app.js:3925-3952` 过滤字段并保存，`core/character-timing-config.js:3-48` 负责 schema/非负数校验，`storage/character-timing.js:11-23` 负责 Chat-local 读写。该配置没有父方间隔字段；Human preset 的 14/42 只属于 Projection Timing base 配置。

后续推荐在同一 UI 区域呈现独立配置，但使用独立的 Chat-local father-tracking config（例如 `father_tracking_configs[character_id].confirmation_interval_story_days`），不扩张 Timing Instance 的 frozen config snapshot，也不让该字段影响 `effective_min_story_days`、`effective_max_story_days`、offset 或 `cycle_id`。如果实现阶段决定复用同一个 API 外壳，也必须保持独立 namespace/schema/validation，避免把父方策略配置伪装成 Timing 配置。

现有代码不能推导父方间隔默认值。当前暂定产品规则为 `confirmation_interval_story_days=7` Story Day、最小 1、正整数；旧聊天缺失字段时回退 7，清空输入也恢复 7。7 Story Day 仍是待最终确认的推荐默认值，正式实施 UI 前必须再次提示用户。输入校验沿现有 normalize/save/current Chat stale guard 机制，并拒绝小于 1 或非正整数值。

### 7.1 候选与妊娠实例

后续父方追踪必须以 `pregnancy_id` 为主键，并同时保留对应 `subject_id`、`cycle_id` 和候选来源 Event provenance。不得使用仅按 subject 的候选表，也不得从 `reproductive_source_candidates` 直接写入 confirmed father。现有 `deriveReproductiveSourceCandidates()` 已可作为候选输入；`ContributorAttribution` 只接受带 `pregnancy_id` 的显式 confirmed/excluded 事实，适合承载 ST/Event Analysis 已明确的归因结果。

父方追踪应是独立于 `participant_aggregation_timeline` 的后续 Floor-owned timeline 或等价 pregnancy-instance record。妊娠结束不会删除旧实例；新妊娠必须创建新的 `pregnancy_id`/`cycle_id` 作用域，不能继承旧候选、知情状态或确认结果。

### 7.2 Awareness 与 father status

后续应建立逐人物、逐 `pregnancy_id` 的事实记录，至少区分：妊娠事实、目标本人是否知道、CHAR 是否知道、每个相关 NPC 是否知道、父方是否 confirmed。`father_status` 在 ST 正文/Event Analysis 没有明确身份确认时保持 `unknown`。插件拥有候选名单不等于剧情人物知道完整名单；只有已确认 awareness 的人物才可作为剧情视角来源。

当前代码没有该 DTO 或持久化根：现有 Event Schema 的 `state_fact`/`pregnancy_relevance` 记录事实与关系，但搜索不到 awareness/knowledge/father 专用字段；因此不能把这些字段临时塞入 Timing、Tracking Window、Projection Eligibility 或聚合成功记录。

### 7.3 父方剧情触发与 Projection

父方推进的可推动条件应是：ST 正文确认妊娠、同一 pregnancy 有多个有效候选、father status 为 unknown、至少一个相关人物 awareness 为 true。目标本人/CHAR/NPC 未知时，不得生成其主动调查方向；只有一个候选时不启动周期性父方确认剧情。awareness 必须来自 ST 正文/Event Analysis，不得由 Projection 或 Timing 推断。

后续可复用 `runtime/events.js:2485-2591` 的 Story Time lifecycle opportunity，以及 `runtime/projection-context.js:138-247` 的 Floor 校验、当前 Projection readback 和 ST extension slot。但应新增独立、可去重的父方剧情 DTO/evidence 类型，并由实际 awareness 与 pregnancy_id 过滤。首次满足条件时建立该 pregnancy 的调度锚点；后续按独立 Chat-local interval 的 Story Day 距离判断，每次机会最多推动一次，跳跃不补发历史条目，推动后更新调度状态。不得从首次 Exposure 时间计时，不得让父方追踪重置 Timing Instance；当前暂定 interval 默认值为 7 Story Day，正式 UI 实施前仍需再次确认。父方确认可以发生在妊娠期间或生产后，确认事实必须回写原 pregnancy_id，而非当前新周期。

### 7.4 妊娠结束、Exposure 锁定与父方追踪解耦

Event 锁定释放必须依赖妊娠生命周期事实，而不是笼统的 terminal Window 枚举：

1. `not_pregnant`/确认未怀孕：本轮 Exposure 不再属于当前有效 Event 集合；聚合结果不得继续作为当前名单输入，也不启动父方追踪。
2. `pregnant_ongoing`/确认怀孕但仍在进行：已聚合 Exposure 继续作为当前快照依据并保持编辑锁定；不能因 confirmation 事件本身解锁。
3. `miscarriage`、`termination` 或 `delivery` 等妊娠实际结束事实：先在原 `pregnancy_id` 下归档候选名单、必要证据和 provenance，再让旧 Exposure 退出当前有效 Event 集合并释放编辑锁定。
4. `outcome_unknown`/结果仍未知：不得自动归档、解锁或认定妊娠结束。
5. `father_unknown`：不影响妊娠实际结束或新妊娠判定周期；旧父方追踪仍绑定原 `pregnancy_id`/`cycle_id`。
6. `father_confirmed`：结束原 pregnancy 的父方追踪，但不替代妊娠结束事实，也不单独触发 Exposure 解锁。

上述状态只能由 ST 正文中的明确剧情事实经 Event Analysis 识别后更新；不能由 Timing、Tracking Window、Projection AI 或 Story Time 跨度推断。归档和清理只产生新的 Floor-owned 派生记录/当前有效性结果，不修改历史 Floor 快照。

### 7.5 与本次聚合的接口

本次聚合只向后续消费者提供：聚合成功状态、当前 Floor 快照派生的 accepted Exposure participant list、`pregnancy_id`/`cycle_id`、以及候选来源 provenance。它不提供人物知情结论、不确认父方，也不因候选数量触发剧情。Projection AI 成功仍与聚合成功分离；未来父方剧情若 AI 失败，不得改变已确认的 awareness 或重新开放 Exposure 收集。

### 7.6 后续阶段依赖顺序

推荐顺序为：

1. 先完成本 task 的名单聚合基础与 Floor-owned provenance；同时只实现 Event 写入过滤和 `updateEvent` 编辑锁的禁用状态、接口边界和测试，不启用锁定行为。
2. 在 lifecycle archive/release capability 完整实现并通过统一上线门禁前，明确禁止启用聚合后新受孕 Exposure 写入过滤、`updateEvent` 编辑锁，也不得宣称完整聚合锁定已形成闭环。
3. 后续实现 ST 明确事实驱动的妊娠结束识别、候选及必要证据归档、旧 Exposure 退出当前有效集合、锁定释放和跨周期隔离测试；只有这些能力完成并通过同一上线门禁后，才能启用完整锁定功能。
4. 再实现逐人物 awareness/father status 的 ST/Event Analysis 事实识别与持久化。
5. 再实现独立父方 interval 配置、UI、默认值和校验；正式动工 UI 前再次确认暂定 7 Story Day 默认值。
6. 最后实现父方 Story Time 调度、去重、Projection Context 注入和生产后延续。

父方阶段必须作为独立可验收任务，不得通过本次聚合 task 的 success 状态、Timing Instance 或 Projection Eligibility 临时承载。

本阶段不预先指定妊娠生命周期 canonical fact/payload 的具体结构。后续设计任务必须先审查现有 Event Schema、`pregnancy_id` 关联、Event Analysis 规范化流程和 Floor persistence 边界，再提交事实结构与归档方案审批。
