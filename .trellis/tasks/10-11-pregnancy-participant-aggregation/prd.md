# 妊娠参与者名单聚合生命周期

## Goal

在不改变 Floor-owned 完整 BiologicalEvent 快照、历史 Floor 与 active Swipe 隔离的前提下，为每个妊娠人物周期增加可追溯的“参与者名单聚合成功”状态。聚合触发复用现有 Projection Timing Instance；当前策略为 `at_effective_min`，未来只预留策略接口，不实现新的随机日期算法。

## 已确认事实

- `core/character-timing-config.js:1-55` 校验和规范化人物 timing 配置；原始配置包含 base min/max 与偏移参数。
- `core/human-timing-preset.js:3-18` 的 Human 默认配置为 14～42 天。
- `core/projection-timing.js:86-131` 在首次有效 Exposure basis 上创建并冻结 `cycle_id`、`reference_story_time`、`sampled_individual_offset_story_days`、`config_snapshot`、`effective_min_story_days`、`effective_max_story_days`。
- `core/projection-timing.js:134-145` 当前超过 effective max 返回 `window_missed`；这不能继续作为本任务的最终行为。
- `storage/projection-timing.js:29-77` 已提供 Floor/Swipe、六字段 Floor Version、Coordinator、timeline readback 机制。
- `.trellis/spec/domain/pregnancy-tracking.md:18-44` 明确 Timing、Tracking Window、Projection 分离；`197-208` 要求 Floor/Swipe/Version authority；`246-268` 要求 Projection owner 分离。
- 当前 Projection 入口位于 `runtime/events.js:1891-1976`，实际 AI 生成位于 `runtime/projection-runtime.js:263-325`。
- 当前不存在独立名单聚合成功状态；Tracking Window、Timing Instance、Eligibility、AI 状态均不得替代它。

## 父方追踪与人物知情状态：现状审查及范围边界

### 已有可复用能力

- `core/reproductive-attribution.js:1-40` 已提供 `ReproductiveSourceCandidate` 与 `ContributorAttribution` DTO；候选与确认/排除关系均带有 `pregnancy_id` 和 `subject_id`，并拒绝未声明的 `father_id` 字段。
- `core/reproductive-attribution.js:43-75` 的 `deriveReproductiveSourceCandidates()` 从已确认妊娠 Window 的 terminal `pregnancy_confirmation` Event 读取 `pregnancy_id`，再从该 Window 的有效 Exposure 派生候选人；同一来源的多个 Exposure 会合并 `source_event_ids`，但不会把候选人推断为确认父方。
- `runtime/event-analysis.js:2920-2984` 已把 `reproductive_source_candidates` 放入分析输出；`tests/reproductive-attribution.test.js:8-40,43-60,62-87` 覆盖多候选、按 pregnancy_id 隔离、删除来源后重建以及不得使用单一 father 字段等边界。
- `.trellis/spec/domain/pregnancy-tracking.md:307-315` 明确候选是只读派生视图，不是 contributor，也不会自动确认或排除；妊娠结束后可以开启新的 Exposure round。

### 当前不存在的能力

1. 当前 Event Analysis/Event Schema 没有可复用的逐人物 awareness/knowledge 记录，不能可靠区分目标本人、CHAR、具体 NPC 是否知道妊娠，也不能仅靠 Timing、Tracking 或 Projection 推断知情。
2. 当前没有独立的 `father_status`/父方追踪实例；候选数量不能确认父方，ST 正文未明确确认时后续状态必须保持 `unknown`。
3. `runtime/projection-context.js:138-247` 只把当前有效 Projection DTO 与健康指导合并到一个 ST extension slot，并没有 awareness-gated 的父方剧情方向通道。
4. `runtime/events.js:2485-2591` 已有 Story Time 生命周期机会：`MESSAGE_RECEIVED` 后先执行 lifecycle tick，再执行 Projection Runtime；但当前没有父方专用的周期、去重或推动状态。

### 本次聚合任务与后续父方追踪的边界

本次只实现名单聚合所需基础：稳定的 `pregnancy_id`/`cycle_id` 关联、Floor-owned 聚合成功状态、当前有效候选输入的重建，以及 Projection 只能在聚合成功后运行。本次不实现 awareness、父方确认、父方剧情方向、周期性父方推动或固定推送间隔。

后续独立父方追踪阶段必须满足：确认妊娠、同一 `pregnancy_id` 下存在多于一个有效候选、父方仍 unknown，且至少一个相关人物已由 ST 正文/Event Analysis 明确知晓妊娠。一个候选不启动周期性父方剧情，也不等于生物学父亲。知情状态必须按人物和具体 `pregnancy_id` 记录；旧妊娠的父方实例在妊娠结束后仍可存在，新周期不得继承旧候选或旧知情状态。

### 后续父方剧情间隔配置

现有「推演周期」设置证据显示：`ui/characters.js:311-328` 只编辑人物的 base min/max、variance 和 adjustment 配置；`ui/app.js:3925-3952` 只接受这些字段并调用 `runtime.saveCharacterTimingConfig()`；`core/character-timing-config.js:3-7,24-48` 只允许这些字段，且仅校验非负数及 max 不小于 min；`storage/character-timing.js:11-23` 将其持久化到 Chat-local `settings.character_timing_configs[characterId]`；`.trellis/spec/domain/floor-state.md:216-228` 将该配置定义为 Chat-local authoritative configuration。当前不存在父方剧情间隔字段、默认值或校验规则，14/42 只是现有 Human timing preset，不是父方间隔默认值。

后续 UI 阶段应在现有「推演周期」区域下增加独立的「父方确认剧情间隔：[数字] 天」及说明文字。推荐将其作为独立的 Chat-local father-tracking configuration（例如按 `character_id` 存储的 `confirmation_interval_story_days`），不要把它写入 frozen Timing Instance 或复用 `effective_min/max` 字段。当前暂定产品规则为默认 7 Story Day、最小值 1 Story Day、正整数输入、用户可修改；旧聊天缺少该字段时使用默认值，清空输入恢复默认值。7 Story Day 仍是待最终确认的推荐默认值，正式实施 UI 前必须再次提示用户确认。

该配置只影响多人有效父方候选、父方 unknown 且至少一名相关人物已明确知晓怀孕的妊娠实例的父方剧情提示间隔，不改变 Projection Timing 的 effective 范围、人物偏移、`cycle_id` 或周期身份。输入必须是 1 以上的正整数，并沿用现有 Chat-local 保存、版本递增、当前 Chat/人物 stale guard 和服务端 normalize/validate 边界。

### 后续父方剧情调度规则

后续阶段必须同时满足以下条件才允许推动：ST 正文确认本次妊娠；该 `pregnancy_id` 有至少两个有效候选；`father_status=unknown`；至少一名相关人物的 awareness 已由 ST 正文/Event Analysis 明确记录。首次满足时允许启动；后续以该妊娠实例自己的调度锚点和用户设置的 Story Day 间隔计算，不得从首次 Exposure 时间计算，也不得以 Projection/Timing 推断 awareness。

每次有效执行机会最多推动一次。Story Time 大幅跳跃只产生一次当前推动，不补发多条历史提示；推动后更新该 `pregnancy_id` 的调度状态并去重。ST 明确确认父方后立即停止该妊娠实例的父方推动。父方追踪可延续到生产后；旧妊娠父方 unknown 不阻止同一人物开启新妊娠周期。

妊娠结束事实只能来自 ST 正文建立的明确剧情事实，并经 Event Analysis 识别后更新；不得由 Timing、Tracking Window、Projection AI 或 Story Time 跨度自动认定。后续生命周期状态至少区分：`not_pregnant`、`pregnant_ongoing`、`miscarriage`、`termination`、`delivery`、`outcome_unknown`。确认未怀孕时本轮 Exposure 退出当前有效 Event 集合且不启动父方追踪；确认怀孕且仍在进行时保留并锁定本轮 Exposure；实际结束时先归档原 `pregnancy_id` 的候选名单和必要证据，再让旧 Exposure 退出当前有效集合。父方 unknown 不阻止妊娠结束或新周期；归档/清理不得修改历史 Floor 快照。

## Requirements

### Timing 复用

1. 聚合只能消费已有 Timing Instance 的 `effective_min_story_days`、`effective_max_story_days`、`reference_story_time`、`cycle_id`、`sampled_individual_offset_story_days`、`config_snapshot`。
2. 不得用原始 base min/max 替代 effective 范围，不得重新抽取、覆盖或无故重置既有 Timing。
3. Event 编辑、删除、Story Time 推进、Floor/Swipe 切换只能重新解析当前有效输入。

### 聚合策略

1. 当前 `aggregation_trigger_strategy = at_effective_min`。
2. elapsed >= effective min 且本轮未成功聚合时，在下一次有效生产执行机会尝试聚合。
3. elapsed > effective max 且未成功聚合时，必须立即补做聚合，不得以 `window_missed` 跳过。
4. 预留 `random_within_effective_range` 策略接口；本任务不执行新随机抽样，未来策略必须受 frozen effective min/max 约束。
5. 策略不得修改 Timing Instance 的个体偏移或有效范围。

### 状态与生命周期

1. 聚合成功状态绑定 canonical `subject_id`、`cycle_id`、Timing Instance 和成功时完整 Floor Version/active Swipe provenance。
2. 推荐新增独立 Floor-owned `participant_aggregation_timeline`，不把聚合状态塞入 Tracking Window、Projection Timing 或 Projection timeline 的语义字段。
3. 成功时记录本轮已接收的 Exposure Event IDs；聚合成功且该人物仍处于锁定期时，插件不得在 Event 持久化前写入该人物新的受孕相关 NSFW Exposure。未锁定人物的 Exposure 仍正常写入；普通非受孕 NSFW 事实不得被误伤。
4. 聚合成功与 Projection AI 成功分离；AI 失败不得重新开放本轮 Exposure 收集。
5. 聚合后编辑/删除已有 Exposure，必须从当前有效完整 Floor Event 快照重新派生名单；同一参与者仍有有效 Exposure 时必须保留。
6. 不得建立跨 Floor 累加 Exposure 池；历史 Floor、active Swipe、六字段 Version 和 stale guard 继续有效。

## Non-goals

- 不重写 Projection Timing 偏移算法，不新增第二套人物周期时间算法。
- 不实现新的随机聚合日期算法，不新增用户配置或 UI。
- 不阻断普通 NSFW Event；阻断只作用于本周期受孕相关 Exposure 的聚合输入。
- 不改变 Tracking Window 既有生命周期语义作为副作用。
- 本规划阶段不修改生产代码、测试代码或业务规范文档。

## Event 写入过滤与编辑锁定（本轮补充）

### 人物级写入边界

1. AI 仍按现有流程返回 Event 数据；AI 不负责判断人物是否处于聚合锁定期。
2. 插件必须在最终 `commitFloorPatch(..., {events})` 之前，按人物读取当前 Floor-owned aggregation success 状态并过滤。
3. 已成功聚合且尚未结束本轮判定的人物，不再写入新的受孕相关 NSFW Exposure；尚未聚合或不在锁定期的人物继续正常写入。
4. 不得采用“先写入，再从 Tracking 名单排除”替代写入过滤；普通 NSFW Event 和其他人物不得被全局关闭或误伤。

### 复合 Event 处理

当前 `ai/analyzer.js:3372-3462` 与 `core/events.js:594-660` 要求 `sexual_activity` 的 canonical Event 只有一个 gestational subject。为支持 AI 返回的复合 Event，规划采用中间结果过滤/拆分：

1. AI 原始复合结果不得直接进入当前会拒绝多主体的 canonical parser 分支；在 `parseEventAnalysisResponse` 的原始结果进入 `normalizeEventRecord`/最终 collection validation 之前，建立可携带多个 gestational subject 的中间复合结果，并识别每个主体的 Exposure slice。
2. 锁定主体的 slice 被移除；未锁定主体的 slice 保留并生成现有 subject-local canonical Event。
3. 在人物级过滤边界重建 `participants`、`gestational_subject_ids`、`counterpart_ids`、participant evidence、source evidence 和关系引用；每个保留 slice 在 `runtime/character-event-analysis.js` 的 `normalizeEventRecord`/collection validation 边界生成 subject-local canonical Event，最终结果必须再次通过现有 `validateEvent()` / `validateEventCollection()`。
4. 如果过滤后没有有效受孕主体且没有其它业务内容，丢弃该 Event；如果仍有其它业务内容，保留非 Exposure 内容但不得残留被锁定主体引用。
5. 人物 A 锁定不得阻止人物 B 的独立 Exposure。

### Event 编辑锁定

1. 聚合成功记录中的 `accepted_exposure_event_ids` 对应当前有效 Event 进入编辑锁定。
2. 编辑锁定必须在 `runtime/event-editing.js:updateEvent()` 的最终写入前执行，禁止编辑但允许 `deleteEvent()`。
3. 删除锁定 Event 继续走现有完整 Floor Event 删除路径；当前名单按剩余有效 Event 重新派生。
4. 不得把所有 factual terminal Window 统一作为解锁条件：确认未怀孕时，本轮 Exposure 从当前有效 Event 集合退出；确认怀孕但妊娠仍在进行时，已聚合 Exposure 继续保留并锁定；只有妊娠实际结束时，先归档该 pregnancy 的候选名单及必要证据，再让旧 Exposure 退出当前有效 Event 集合并释放锁定。父方仍 unknown 时，父方追踪独立保留；父方确认只结束对应 `pregnancy_id` 的父方追踪，不单独决定 Exposure 锁定释放。
5. 删除导致 Projection evidence 不再有效时，当前 Projection Context 必须过滤失效内容，不能继续注入 ST。

### 当前实现证据

- AI parse 入口：[ai/analyzer.js:3487-3538]；复合 sexual_activity 当前会在 `3372-3462` 被拒绝。
- Runtime normalization、完整 Event collection validation 和最终保存前边界：[runtime/character-event-analysis.js:312-506]、`607-616`。
- Event edit/delete 入口：[runtime/event-editing.js:97-304]。
- 当前 Floor-owned 完整事件写入由 `commitFloorPatch` 承担，不能改为 Chat-level 镜像。过滤必须发生在该最终写入之前，不能先写入再从 Tracking 或名单排除。

## Acceptance Criteria

- [ ] 现状、调用链、所有权和失效边界已经有文件/函数/行号证据。
- [ ] 已明确独立聚合 timeline 的 schema、owner、Floor/Swipe 读写和生命周期。
- [ ] 已明确 effective min/max、max 补做、策略接口和 Timing 不重置方案。
- [ ] 已列出分阶段实施、测试、验收和回滚点。
- [ ] 已设计与 `implement.md` 一致的 14 类专项测试：Timing/effective 范围、偏移稳定、min 触发、max 补做、策略接口、成功锁定、删除重算、Floor/Swipe 回退隔离、复合 Event 拆分过滤、引用一致性/最终 Schema、全 slice 丢弃、编辑/删除锁定、Projection evidence 失效重校验、重复执行/AI 失败/普通 NSFW 隔离。
- [ ] 未运行 `task.py start`，等待用户批准最终规划摘要后再实施。
- [ ] 已明确 Event Analysis AI → 中间复合结果 → 人物级过滤/拆分 → canonical validation → Floor save 的写入顺序。
- [ ] 已明确编辑锁定只阻止 `updateEvent`，删除仍允许，并覆盖 Projection Context 失效清理。
- [ ] 已将父方 awareness、剧情调度、候选归档和 UI 配置明确列为后续阶段，而非本轮聚合实现。
- [ ] 后续 UI 阶段已核对现有推演周期配置的 UI、Chat-local 持久化、默认值来源和输入校验，并由产品确认父方剧情间隔默认值。
- [ ] 正式实施 UI 前再次提示用户确认暂定推荐默认值 7 Story Day；实施规则为最小 1 Story Day、正整数、旧聊天缺省使用默认值、清空恢复默认值。
- [ ] 已明确妊娠实际结束只能来自 ST 明确事实并经 Event Analysis 识别，且区分未怀孕、进行中、流产、终止、分娩和未知结果。
- [ ] 已区分“确认未怀孕”“确认怀孕仍进行”“妊娠实际结束”“父方确认”四类状态及其对 Exposure、锁定和父方追踪的不同影响。

### Projection evidence 失效与锁定上线门禁

Projection 历史记录可以保留，但当前 ST Context 必须逐次比较 Projection 的证据粒度：`aggregation_id`、`pregnancy_id`/`cycle_id`、accepted Exposure Event IDs，以及每个参与者对应的当前有效 Exposure IDs/participant mapping。删除一条多 Exposure 参与者的 Event、删除唯一 Exposure 使参与者退出、删除全部 accepted Exposure，或任何当前集合与旧 Projection 来源不一致，都必须使该 Projection 对当前 Context 不可见；不得只在全部 Exposure 消失时才失效，也不得静默删除历史 Projection。

本轮聚合成功后的“停止新 Exposure 写入”和“已聚合 Event 禁止编辑”不能在妊娠结束归档/释放尚未实现时作为永久锁独立上线。推荐上线门禁为：只有 aggregation lock 与基于 ST 明确事实的 lifecycle archive/release capability 同时可用时才启用；否则本 task 的锁定写入过滤、编辑拒绝和相关 UI 行为保持 disabled，避免形成无法解除的锁。该门禁不得用 Story Time、Timing Window 或 Projection AI 猜测结束；父方 unknown 也不得阻止新的妊娠判定周期。

该统一上线门禁已获确认。名单聚合基础能力可以先行开发和测试，但在 lifecycle archive/release capability 完整可用前，禁止启用聚合后的新受孕 Exposure 写入过滤和已聚合 Exposure 的 `updateEvent` 编辑锁。完整启用前必须验证 ST 明确事实驱动妊娠结束、候选名单及必要证据归档、旧 Exposure 退出当前有效集合、编辑锁释放、新妊娠周期启动，以及旧周期父方 unknown 不影响新周期。

跨周期验收场景：C001 Exposure 收集 → 聚合成功 → 确认怀孕 → 确认分娩 → 候选/证据归档 → 旧 Exposure 退出当前有效集合 → C002 新 Exposure 正常写入。必须同时验证 C001 父方仍为 unknown 不阻止 C002；C002 不继承 C001 聚合成功状态或候选名单；历史 Floor 快照不被修改。
