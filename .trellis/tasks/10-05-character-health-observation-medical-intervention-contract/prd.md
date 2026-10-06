# Character Health Observation / Medical Intervention Contract

## Goal

实现并验证 Character Health 的最小 factual Event 语义：区分当前身体状态 observation 与 medical intervention，确保 Health Assessment 只消费 observation，并按身体部位组织 observation-only current presentation；intervention 保留在 Event history。

## Background / confirmed facts

- 真实 ST Host 已出现同一部位的 `physical_symptom/laceration` 与 `medical_event/wound_treatment` 两个独立 factual BiologicalEvent。
- `core/health-assessment.js::healthAssessmentEligibility()` 当前按 `physical_symptom`、`medical_event`、`other_biological` 加 subject/evidence 放行，治疗因此可能进入 Assessment、severity、Evolution 与 Recovery Guidance。
- `core/health-evolution.js` 复用该 eligibility；`core/health-aggregation.js` 当前按 `body_site + laterality + factual_kind` 分组。
- Event semantic payload 位于 `state_fact.payload.symptom` 或 `state_fact.payload.fact`；factual record 已包含 `kind`、`description`、可选 `body_site`、`laterality`、`continuation`。
- BiologicalEvent 由当前有效 Floor / active Swipe / 完整六字段 Floor Version 拥有；derived Health Assessment、Evolution、UI 与 Guidance 不能创建第二事实源。

## Requirements

1. BiologicalEvent 仍是事实权威；伤势/症状和医疗行为保持独立 Event，不合并 factual Event。
2. 新增最小结构化 health semantic contract，至少支持 `observation` 与 `intervention`；字段属于 factual Event semantic payload，不是 UI metadata。
3. `observation` 表示当前身体状态或检查/诊断发现的独立身体状态事实；只有它可进入 Health Assessment、Health Evolution、`severity_summary` 与 Recovery Guidance。
4. `intervention` 表示已经发生的治疗、检查、给药、手术、包扎、监测或急救行为；仍保存为 BiologicalEvent 并保留在 Event history，但不是 current health condition，不拥有 Assessment severity，不参与 persistence、natural recovery、Evolution、Current Health presentation、severity_summary 或 Guidance。
5. Mixed narrative 必须拆成独立 Event：行为一个 intervention，所发现/确认的身体状态另一个 observation；不建立新的 reference/effect/diagnosis graph。
6. Character Health v1 presentation 仅以身体部位组织 active observations，保留 `health_observations[]`，使用 canonical `event_id` 导航。intervention 暂不进入 Current Health UI。UI 不按 kind、description 或 body_site 猜语义；factual description/body_site 原样保留，laterality 维持独立维度。
7. 不创建 Condition model、reference graph、treatment lifecycle、人工过期 Event、migration backfill 或历史 AI 重分析。
8. 所有新语义继续服从 Floor authority、active Swipe/version invalidation、edit/delete/rollback rebuild、manual supplement merge 与 reroll comparison-only 规则。

## In scope

- Event semantic contract 的位置、适用 Event 类型和 analysis 输出规则。
- Health Assessment eligibility 与 Health Evolution / severity / Guidance 边界。
- Character Health site-group read-model DTO、known/missing body-site grouping、source navigation。
- treatment display lifecycle 的证据审计与 deferred 决策。
- legacy compatibility、schema/version/persistence 影响、Floor lifecycle 影响。
- 实现前模块清单、禁止扩展清单、测试矩阵、文档同步清单和阶段计划。

## Out of scope

- 本次获批实现范围包含最小 Event contract、Health eligibility、presentation read model/UI
  以及对应 focused tests 和受影响 canonical 文档。
- Condition/diagnosis/reference/effect/treatment graph 或 medical ontology。
- treatment 的独立 Assessment、severity、recovery deadline、lifecycle 或人工 TTL。
- 历史 Event 的 AI backfill、自动 reload/reanalysis、已有 Event rewrite。

## Acceptance Criteria

- [x] 设计文档逐项覆盖用户要求的 A–O 与 20 项最终输出。
- [x] 明确推荐字段的准确位置、允许值、适用 Event 类型和缺失字段行为。
- [x] 明确 mixed narrative 拆 Event，且没有新增 Event 间关系系统。
- [x] 明确单一 Health Assessment eligibility；Evolution 不重复判断 intervention。
- [x] 明确 intervention 不影响 Assessment severity、`severity_summary`、Evolution 和 Guidance。
- [x] 明确 site-group 不按 factual kind 拆卡片，且对 missing body_site 不制造巨大组。
- [x] 明确 treatment display lifecycle 当前证据不足之处并标为 deferred/unresolved。
- [x] 明确 legacy、schema、migration、Floor/Swipe/edit/reroll/manual supplement 影响。
- [x] 列出需要修改与禁止修改的模块、测试矩阵、文档同步清单和阶段计划。
- [x] 实现范围仅修改本 task 相关业务模块、focused tests、规范文档与 Trellis artifacts，未引入禁止范围。

## Decision status

设计已获批准，task 当前处于 `in_progress`。实现不包含提交或 push；完成后等待人工 review。Treatment display lifecycle 继续保持 `DEFERRED / UNRESOLVED`。
