# Character Health State 领域设计与文档

## Goal

审计当前 HEAD 的真实 Event、Floor、State、Snapshot、Analysis、Runtime 与 Characters UI 边界，形成一份明确标注为 `DESIGN / NOT IMPLEMENTED` 的 Character Health State 领域设计文档。只修改设计/导航文档，不实现 runtime、schema、prompt、UI、测试或 projection。

## Background / confirmed constraints

- BiologicalEvent 是 Floor-owned authoritative factual history，必须受 active Swipe 与六字段 Floor Version 过滤，并保留 provenance。
- Current biological state 只能由 surviving authoritative Events 经 deterministic replay/reducer 重建；Snapshot 只能是 derived checkpoint。
- Event.location 是事实发生/观察时的 provenance，不是人物健康 condition 的身份字段。
- Event History 不因当前状态改变而删除；`state_fact.subject_id` 保持人物事实归属语义。
- Pregnancy tracking 是独立边界；普通 `physical_symptom` 不自动进入 pregnancy tracking。
- Projection 是非事实的未来可能性，Projection Context 不能成为 Event evidence。
- 本轮不添加 freshness、current_state_relation、Event 类型、schema 字段、测试或实现。

## Requirements

1. 先以当前仓库 HEAD 与权威文档为准审计，不能把撤回设计当成事实。
2. 新设计必须分离：historical factual Event、Character Current Biological State、Character Health State、Projection。
3. Health State 只作为 derived read model / derived state domain 的设计方向，概念上包含 `overall_health`、`current_conditions`、`long_term_conditions`，不固化生产 schema。
4. 设计 condition identity，覆盖并发问题、重复观察、改善/恶化/治疗/恢复、长期跨 Floor，明确不使用 location、Event ID、counterpart 作为默认 identity。
5. 明确 currentness、explicit resolution、long-term recognition 与 story time 的边界；不引入统一 TTL 或现实医学自动推断。
6. 说明 reducer/rebuild、Snapshot、Floor 删除/编辑/Swipe 切换/version replacement 后的重建语义。
7. 说明 UI、压缩 factual Context、未来 Health Projection input 的边界。
8. 同步必要导航文档，但只能标记 `DESIGN / NOT IMPLEMENTED`，不能伪装成生产能力。

## Out of scope

Health State runtime/UI/Context injection/Projection、medical simulator、automatic recovery implementation、freshness TTL、recovery duration table、symptom episode system、injury source attribution、counterpart identity、disease ontology、body-region ontology、generic diagnosis、pregnancy redesign、生产 schema、Event Analysis prompt、测试。允许在设计层冻结 derived natural evolution 的 authority boundary，但不实现恢复或冻结 duration policy。

## Acceptance criteria

- 新设计文档包含用户要求的 19 个主题及完整闭环路径图，并明确 Projection Context 不得返回成为 Event evidence。
- 新设计文档明确 `short_term`、`long_term`、`permanent` persistence class；仅明确 short-term 且未来 policy 认可 natural recovery eligible 的 condition 可由 Story Time 驱动 derived natural evolution，且不创建 recovery Event。
- 每个 factual health observation 独立演化；long-term/permanent 不因沉默自动消失；overall health 主要反映当前影响，不被长期状况机械固定。
- Character Analysis / Character Details 是未来主要 UI 位置，不新增顶级 Health 页面；Worldbook/Character Card factual ingress 标记为 Future Implementation / Open Design。
- 文档中的每项建议与当前代码/权威文档审计结果区分为 confirmed fact、design recommendation 或 deferred decision。
- 相关导航文档如有更新，均明确为 `DESIGN / NOT IMPLEMENTED`，且不改变既有已实现状态标签。
- `git diff` 仅包含规划材料与设计/导航 Markdown，不包含生产代码、schema、prompt、测试或 UI 实现。
- 完成文档内容检查、Markdown 一致性检查和 git diff/status 检查；不执行实现测试。

## Blocking open questions

无。用户已明确本轮目标、边界和不实现项；condition identity 的未决点应记录在设计文档的 Deferred decisions，而不是阻塞本轮设计。

## Audit findings captured for design

- 当前 `core/state.js::reduceState()` 已是纯、可重放的 Current Biological State reducer；人物状态目前包含 identity、reproductive exposure、conception/pregnancy、cycle、postpartum、symptoms、medical 与 activity chain。
- 当前 `core/snapshot.js` 已验证完整六字段 Floor Version，并在有效 checkpoint 上 restore 后继续 replay；无效/缺失时 full replay。
- 当前 Event contract 已有 `physical_symptom`、`medical_event`、`other_biological`，并以 `{state_fact: {subject_id, payload}}` 表达非 exposure 的类型化事实；payload 目前只要求 `kind` 与可选 description，未建立 Health Condition identity 或 recovery lifecycle。
- `location`、结构化 `story_time`、`source_evidence`、完整 `source` 属于 BiologicalEvent；`state_fact.subject_id` 是事实归属，不是 Health State schema。
- `runtime/event-analysis.js` 从当前有效 Floor Events、Character Facts 与 Story Time，经最近有效 Snapshot 或完整 replay 生成 Current State；UI 通过 Runtime DTO 消费，当前 Characters 页面主要显示 Tracking Subject 及其 exposure/history，`ui/character-state.js` 展示既有 Biological State 摘要。
- Projection Context 当前已有独立 factual boundary；`docs/PROJECT-STATE.md`、`docs/DEVELOPMENT.md`、`docs/DATA-MODEL.md` 与 lifecycle contract 均明确 Projection 不进入 Event evidence/StateReducer/Snapshot。
- `docs/UI.md` 中一段“Projection、Genealogy、StateReducer、Snapshot … Empty State”的阶段性描述已落后于当前代码与上述权威文档，设计文档同步时应改为当前已实现状态，并单独标注 Health State 为 `DESIGN / NOT IMPLEMENTED`。

## Approved planning decisions

- `physical_symptom` 只是现有候选事实入口之一；`medical_event`、`other_biological` 及其他已存在的经验证 BiologicalEvent 同等保留为可映射来源。
- Condition identity 不在本轮冻结为最终 contract；currentness、silence-over-time 与 resolution policy 也只记录设计约束、候选方向和开放决策，除非审计发现现有实现已有不可绕过的约束。
- 产品目标是人物当前身体状态记录器，不是医疗病历系统；没有明确 factual source 不创建 Health Condition，不根据现实医学常识诊断。
- Health Condition 允许粗粒度 persistence class：`short_term`、`long_term`、`permanent`；它们不是医学诊断体系，具体字段/schema 仍 deferred。
- 仅对明确属于 `short_term` 且未来 policy 认可 natural recovery eligible 的 condition，允许 Story Time 驱动 derived natural evolution；自然演化不得创建 recovery Event。
- 新的 authoritative factual Event（包括恶化、持续、治疗或 explicit recovery）形成新的 observation assessment；默认不 supersede 旧 observation；`long_term`/`permanent` 不因沉默自动消失。
- Health State 主要属于 Character Analysis / Character Details 页面，本轮不新增顶级 Health 页面。
- Worldbook/Character Card 到 Health factual Event 的 authoritative ingestion path 当前未确认实现，必须标记为 Future Implementation / Open Design。

## Follow-up design decision: Health Assessment Contract

本任务后续设计材料新增 Health Assessment Contract 方向；Persisted Assessment Lifecycle
Phase 1 已实现，但完整 Health State 仍属于 `DESIGN / NOT IMPLEMENTED`：首次成功 Assessment 必须持久化并绑定源 Event 与完整六字段
Floor Version；普通 replay/reload/Snapshot restore/Projection refresh 在没有新
authoritative health observation 时不得重新调用 AI。新的 observation 可以产生新的
Assessment，Assessment 是按 source observation 稳定保存的时间序列，不是 condition-level
永久锁死的单一结果。Assessment 是 derived evaluation，不是 BiologicalEvent factual
authority；Phase 1 的 record layout、runtime pass 和 lifecycle registry 已实现，Phase 2
已实现最小 derived Health Evolution / Current Health State read model；完整 UI、Projection、
advanced Condition identity、reference resolver、World Model health rules 与自动恢复 Event 仍不实现；Phase 4 采用 observation lifecycle + presentation aggregation。

## Follow-up design decision: Storage & Lifecycle Implementation Design

本阶段只形成实现前设计：审计现有 Event/Floor/Swipe/Snapshot/persistence coordinator，
推荐在同一 Character Floor owner 下持久化独立 Assessment collection/timeline，并以
`(source_event_id, source_floor_version, source_observation_fingerprint)` 做
source-observation scoped lookup；当前 Event editing 在同一版本可能保留 Event ID 但
修改 factual payload，因此 fingerprint 是必要 guard，不是新的 Event ID。source
Event/Floor Version 失效时 active read 过滤 Assessment；普通 replay 不调用 AI；新
authoritative observation 才能生成新的 Assessment。最终 storage root、schema、registry、
retry、并发实现和 runtime integration 仍未实现。
