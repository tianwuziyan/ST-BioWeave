# Technical Design Plan

## Audit-first approach

核对 `docs/PROJECT-STATE.md`、`docs/DEVELOPMENT.md`、`docs/DATA-MODEL.md`、`docs/UI.md`、`docs/bioweave-data-lifecycle.md`、`.trellis/spec/domain/event-pipeline.md`，以及 `core/events.js`、`core/state.js`、`core/snapshot.js`、`runtime/event-analysis.js`、`runtime/events.js` 与 Character/Events UI。特别读取 `.trellis/spec/domain/floor-state.md`、`.trellis/spec/domain/index.md` 和 frontend 相关 index/指南。

## Deliverables

1. `docs/CHARACTER-HEALTH-STATE.md`：完整领域设计，明确 `DESIGN / NOT IMPLEMENTED`。
2. 仅在审计证明导航需要时更新现有 Markdown，加入指向设计文档的非实现性说明。

## Design boundaries to capture

- `Narrative -> Event Analysis -> Floor-owned BiologicalEvents -> active Swipe/Floor Version filtering -> StateReducer/deterministic replay -> Character Current Biological State -> Character Health State -> Characters UI / compressed factual Context / future Projection input`。
- Health State 不拥有新的事实、不替代 Event、不成为 Chat-level 第二事实源；长期/当前状态均可由 surviving Events deterministic rebuild。
- `overall_health` 是从具体有效 conditions 规则汇总出的读模型，不是 AI 独立生成的 authority。
- current 与 long-term 是广义健康/身体状态分类，不把 long-term 限定为疾病。
- currentness 与 factual resolution 分离；沉默不等于 recovery；统一 TTL 和医学常识推断 deferred。
- 产品层允许 `short_term`、`long_term`、`permanent` persistence class；仅明确 short-term 且被未来 policy 标记为 natural recovery eligible 的 condition 可由 Story Time 触发 derived natural evolution，且绝不生成 recovery Event。
- explicit factual recovery、恶化、持续或治疗事实优先于任何旧的 derived trajectory；long-term/permanent 不因沉默自动删除。
- location 只保留在 Event/history/provenance 视图，不参与 condition identity。
- Projection 只能提出未来可能性，不能写回 factual Health State，也不能成为 Event evidence。
- Character Health State 的主要产品消费位置是 Character Analysis / Character Details，不新增顶级 Health 页面。
- Worldbook/Character Card factual ingress 尚未确认存在；未来必须复用或扩展现有 factual analysis boundary，不能绕过 Floor ownership。

## Compatibility / migration stance

本轮没有生产迁移。文档只描述未来最小实施阶段：先冻结领域词汇与 provenance/replay 合同，再设计非生产 reducer/read model，随后才分别评估 UI、Context 与 Projection consumers。任何 schema、prompt、runtime 或测试工作另立任务。

## Risks and trade-offs

- condition identity 过粗会合并不同伤情，过细会制造重复 condition；本轮采用可重建的“问题轨迹”概念方向，保留 identity key 的组成与 episode/ontology 取舍为 deferred。
- natural recovery policy 若过早固化 duration，会把产品 policy 伪装成医学事实；本轮只冻结 derived evolution 的 authority boundary，保留资格、duration、severity、World/AI/Product fallback 为 deferred。

## Health Assessment Contract direction

- Health Assessment 是首次健康事实后的 derived evaluation，不是 factual Event。
- 推荐未来采用与源 Event/Floor Version 绑定的独立 derived assessment record；它必须由现有 Character Floor owner 持有，源失效时一同失效，不能成为新的 Chat-level Health root。
- 同一 source factual observation 的首次成功结果必须保存；ordinary replay、reload、Snapshot restore、Context rebuild 和 Projection refresh 在没有新 authoritative observation 时只消费 saved result，不重新调用 AI。
- 新 authoritative observation 可以产生新的 persisted Assessment；Assessments 形成 observation-level 时间序列，旧记录保留，最新适用 Assessment 驱动当前 trajectory，不把一个 condition 永久锁定在首次 expected boundary。
- 正文明确 remaining duration 以新 observation 的 Story Time 为 reference，例如 Day 2 + 3 days = Day 5；explicit timing 优先于 AI 自行估算。
- 概念结果包括 persistence class、natural recovery eligibility、earliest boundary、expected boundary、assessment source 和 reference Story Time；最终字段/schema deferred。
- `earliest` 只表示恢复可能开始的窗口，`expected` 才是默认 derived closure boundary；二者都不生成 recovery Event。
- 新 authoritative observation 优先于旧 trajectory；expected closure 后再次出现问题时不回溯修改旧 derived closure。
- 推荐独立 Assessment pass，以隔离 factual extraction 与 AI-derived estimate；Event 成功与 Assessment 成功解耦，失败时保留事实并保守为不自动关闭。
- currentness 若被误写成 medical TTL，会把沉默错误地解释为恢复；设计文档必须把 information currentness 与 factual resolution 分开。
- Snapshot 可减少 replay 成本，但不能提升 authority；文档必须明确 invalidation/rebuild 条件。

## Health Assessment Storage & Lifecycle implementation design

Phase 1 已实现 `health_assessment_timeline` 的 source-bound persisted lifecycle；Phase 2
已实现最小 derived Health Evolution / Current Health State read model。完整 UI、Projection、
advanced Condition identity、World Model health rules 与 automatic recovery Event 仍为
`DESIGN / NOT IMPLEMENTED`。

## Phase 4 Health Model Simplification

Phase 3 的 trajectory grouping 已撤回，不再参与 Health Evolution correctness。每个 surviving
health observation 独立消费 source-bound Assessment、独立计算 recovery closure，再由
presentation-only aggregation 按 exact `body_site + laterality + factual kind` 分组。
`body_site`、`laterality`、`continuation` 仍是可选 factual metadata；continuation 不再
触发 supersede 或 episode linking。`trajectory_id`、Condition ledger、reference resolver
与 recurrence graph 均不实现，advanced Condition identity 继续 Deferred。

## Future Health Recovery Guidance / Projection

Recovery Guidance 的产品目标不是持续提醒剧情模型某人仍有伤病，而是根据每个独立
observation 的 Assessment 与 Story Time，把恢复过程转换为粗粒度身体表现指导：早期、
恢复中、接近恢复。内部 duration、boundary、elapsed/remaining time 只用于阶段判断，禁止
作为具体倒计时、日期、百分比或 Assessment 字段注入并要求剧情复述。Guidance 不是强制剧情
点；只有动作、刺激、环境或剧情确实相关时，才自然表现身体反应。

多个同部位 active observations 可以被压缩为一段自然 guidance，但不合并 lifecycle、
Assessment 或 deadline。Story Time 大跨度直接计算阶段，不逐日模拟。expected boundary
后该 observation 不再提供 Guidance。Guidance / Projection 不创建 Event、不修改 Health
State、不成为 Event evidence；只有新生成的 narrative text 才能回到 Event Analysis。

本能力为 `DESIGN / PLANNED`，recovery-stage Guidance、generic health Projection 与
Context injection 均未实现。

## Phase 5A Character Health UI

Phase 5A 已实现窄范围 Character Details read-model consumption：现有人物详情通过
Runtime DTO 接收 current_health_state，主要消费 grouped_issues，并按 canonical
character_id 展示当前身体问题。UI 不扫描历史 Events、不重新计算 observation lifecycle
或 presentation aggregation、不显示 assessment/Floor Version/recovery timing 内部字段，
也不触发 AI、Analysis、Projection 或 persistence。Recovery Guidance、Projection 与
Context injection 继续保持 DESIGN / PLANNED。

## Phase 5B Health Recovery Guidance / Recovery-Stage Projection

Phase 5B 已实现 deterministic、non-factual recovery guidance：Health-owned pure core 从
现有 active observations、保存的 Assessment 与 current Story Time 计算 early / recovering /
near_recovery，并把自然身体表现指导加入唯一的 bioweave_projection_context 槽位。
恢复时间、deadline、比例与 Assessment 字段不进入剧情可复述内容；无关剧情可以完全不提，
Guidance 不创建 Event、不修改 Health State/Assessment、不参与 persistence。不可比较时间、
long_term/permanent 或缺少 expected duration 的 observation 不生成自动 recovery stage。
完整 Health Projection、long-term progression、explicit recovery reference 与 UI recovery
stage 仍未实现。

- 当前 Event 的 stable identity 由完整 Floor Version + response ordinal 确定性生成；同 Floor manual supplement 保留 continuity Event ID，版本变化不应复用旧 Assessment。
- 推荐 Assessment 作为同一 Character Floor owner 下的独立 derived collection/timeline；不放进 Event factual payload、Projection、runtime cache 或 Snapshot-only。
- 推荐 stable lookup/binding 以 `(source_event_id, source_floor_version, source_observation_fingerprint)` 为概念 key；因为当前 Event editing 可在同一 Floor Version 保留 Event ID/source 但修改 factual payload。fingerprint 不是新的 Event ID，具体字段仍 deferred。
- source Event/Floor Version 失效时先由 surviving-source join 过滤；物理 GC 仅为可选清理，不承担 authority correctness。
- 创建点在 factual Event 成功持久化并 authoritative readback 之后；Assessment failure 不回滚 Event，也不在普通 reload/replay 自动 retry。
- duplicate protection 复用现有 in-flight execution、Floor Version/active Swipe/owner guards 与 persistence coordinator；stale completion fail closed。
- Story Time 建议同时保留 normalized duration 与 resolved boundary 的概念信息；replay 消费已保存 boundary，不重新询问 AI。
- 旧 Chat 只保留 factual Events，不自动批量补 Assessment；Phase 1 只描述新事实的 lazy/explicit path。
