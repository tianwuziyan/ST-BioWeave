# Technical Design — Character Health Observation / Medical Intervention Contract

状态：`IMPLEMENTED / REVIEW PENDING`

## 1. 推荐最小 contract

推荐新增 factual record 字段：

```text
health_role: observation | intervention
```

字段放在已有 `state_fact.payload.symptom`（`physical_symptom`）或
`state_fact.payload.fact`（`medical_event`、`other_biological`）内，与 `kind`、
`description`、`body_site`、`laterality` 同级。它不放在 BiologicalEvent 顶层、Assessment
或 UI DTO，因此属于 factual Event semantic contract，并随 Event fingerprint、编辑、
Floor provenance 一起保存。新 health-related Event 明确输出该字段；其它 Event 不强制增加。

## 2. 现有链路与设计边界

```text
AI Event JSON
 → identity/materialization/normalize/validate
 → current Floor/Swipe Event persistence
 → one Health Assessment eligibility helper
 → persisted Assessment
 → Health Evolution
 → presentation aggregation / severity_summary
 → Character Health UI
 → non-factual Recovery Guidance / Projection Context
```

当前 broad eligibility 在 `core/health-assessment.js` 按三种 Event type 放行；Evolution
复用它；Aggregation 按 `body_site + laterality + factual_kind` 拆组。改造只需冻结
factual role、收窄这一 eligibility、重做 presentation grouping；不改变 Floor owner 或
Health 的职责边界。

## 3. 精确定义与适用范围

`observation` 是 narrative 明确支持的当前身体状态或独立身体状态事实，例如 wound、pain、
fever、infection、fracture、diagnosed disease，或检查/诊断发现的 physical condition。
它才可以有 Health Assessment 的 severity、persistence、natural recovery 和 expected
recovery；这些是 derived，不写回 Event。

`intervention` 是已经发生的医疗检查/治疗行为，例如上药、包扎、给药、注射、手术、清创、
监测或急救。它仍是独立 BiologicalEvent，保留 description、body_site、source evidence、
story time、Floor provenance 与 canonical Event navigation，但不成为 current condition，
不拥有 Assessment severity，不参与 persistence、natural recovery、Evolution、
`severity_summary` 或 Guidance。

| Event | 规则 |
| --- | --- |
| `physical_symptom` | health-related 输出使用 `observation`；非 health-related 不强制字段 |
| `medical_event` | 医疗行为使用 `intervention`；发现的状态另发 observation |
| `other_biological` | 只有明确属于 Character Health 的事实才声明 role |
| reproductive / exposure Events | 不新增 health role，继续使用自身 contract |

Health 层不得根据 kind、description、body_site 或中文关键词猜语义。`other_biological`
允许两种 role，但不构成大型枚举或 ontology。

## 4. Event Analysis 与 mixed narrative

Analysis 输出 role 作为同一 factual record 的结构化字段。一个目标 Floor 可继续输出
0/1/N 个独立 Event，Runtime 不合并不同事实。

“检查发现右臂骨折”应拆为：

```text
Event A: medical_event / fact.kind=examination / health_role=intervention
Event B: physical_symptom 或 other_biological / fact.kind=fracture
         / health_role=observation / body_site=右臂
```

“医生清创后发现伤口已经感染”同样拆成清创 intervention 与 infection observation。
两者可由同一次 Analysis 产生，但只有 observation 拥有 Assessment/lifecycle；两者各自保留
独立 provenance；不新增
`caused_by`、`discovered_by`、`reference_event_id` 或 effect/reference graph。只有行为没有
状态时只出 intervention，只有状态没有明确行为时只出 observation。

## 5. Health Assessment、Evolution、Severity、Guidance

唯一 eligibility 推荐为：

```text
event.health_role === observation
&& event.state_fact.subject_id
&& source_evidence.length > 0
&& status not in {negated, fictional}
```

`medical_event`、`wound_treatment`、kind、description、body_site 都不是 eligibility
依据；`intervention` 与缺失 role 的新 Event 均不 eligible。Evolution 只消费已合法进入
Assessment 的 observation，不再判断 treatment、diagnosis、intervention 或 kind。
Guidance 继续只消费 Evolution 输出，无需添加 medical_event/wound_treatment/description
filter。

`severity_summary` 只汇总 active observation 的 Assessment severity；intervention 没有
Assessment severity，因此不能把伤口 mild 与治疗行为合计成 moderate。

## 6. Character Health site-group DTO

当前 `grouped_issues` 只保留 active observation 的 presentation-only site group，概念形状为：

```js
{
  group_key,
  body_site,                 // factual value; null when missing
  laterality,                // independent dimension
  display_site,              // presentation label only
  health_observations: [
    { description, factual_kind, severity, source_event_id }
  ],
  source_event_ids
}
```

Current Health v1 只展示 `health_observations[]`。intervention 不进入 current-state DTO/UI，
仅保留在 Event history；description/body_site 原样展示，laterality 不拼接进 body_site，
source navigation 继续使用 canonical `event_id`，不使用 Assessment ID。

### Grouping rules

- known body_site：按规范化 factual body_site 分组；同一 site 不因 factual_kind 拆卡片。
- laterality：保留结构化维度；不同 laterality 可以形成 `(body_site, laterality)` 可读组，
  但不修改 factual body_site。
- factual_kind：保留在每条 observation/intervention item，用于标签、详情和排序，不是
  site-card 的拆分维度。
- missing body_site：不得把所有事件粗暴合成一个巨大“未标明部位”组。推荐以
  subject + laterality + factual_kind + source_event_id 的 presentation fallback 形成
  独立未定位条目，或每 Event 一条未定位列表；不伪造/回写 body_site。具体文案留实现阶段。

Grouping 只是 presentation，不是 Condition identity、supersede、episode、reference 或
lifecycle；每条 Event 独立存活和失效。

## 7. Intervention display lifecycle

现有 contract 足以决定 intervention 的 source、Floor/Swipe/version 有效性与 rebuild，
但没有可靠的 treatment duration、resolution、freshness 或“当前显示多久”依据。不能借用
observation Assessment 的 expected recovery，也不能凭空添加 TTL、人工 expiry、treatment
Assessment、synthetic Event 或 treatment recovery lifecycle。

因此标记为 `DEFERRED / UNRESOLVED`。v1 不从 surviving intervention Events 构造
Character Health current presentation；intervention 只保留在 Event history。未来展示策略或
产品时间窗口必须另行明确，不在本设计中偷偷决定。

## 8. Legacy compatibility

推荐分层兼容：

1. 新 Event 或编辑后重新生成的 health-related Event 必须显式 role。
2. legacy 缺 role 的 Event 保留 Event 页面与 Floor provenance，但不触发新的 Assessment，
   不因 `medical_event` 自动变成 observation。
3. 已存在且 source-bound、仍有效的旧 Health Assessment 保留在历史 timeline，但不能反向
   赋予缺失 role 的 Event observation 身份，也不能进入 Current Health read model。
4. legacy medical_event 无论是否已有 Assessment 都不进入新的 Current Health observation；旧
   Chat 可能少显示部分健康项，这是 contract correction，不通过 kind 恢复 broad rule。
5. 不重写历史 Event、不批量 reload、不自动 AI 重分析；正常编辑/重新分析产生显式 role
   后才按新 contract 生效。

## 9. Schema / persistence / lifecycle

- Event schema：保持现有 `EVENT_SCHEMA_VERSION = 1`。`health_role` 是已有 factual payload
  的可选、枚举受限字段，缺省仍可被旧 Event 读取；无需 envelope version bump、storage
  migration、snapshot migration 或历史 rewrite/backfill。
- Health Assessment：不需要 schema bump；现有 v2 继续承载 observation-only severity，
  只收窄 eligibility。旧 Assessment 继续以 source Event、完整 Floor Version 和 fingerprint
  过滤。
- Current Health read model：不是独立持久化 root；DTO 改形可提升 read-model version，
  不做 storage migration。
- Floor：role 随 Event 存入当前 Character Floor/active Swipe slot，不新增 intervention
  state root。edit/delete/rollback/swipe/version replacement 继续触发现有 rebuild/invalidation。
- manual supplement：保留独立 Event；role 差异不能通过模糊 semantic match 合并。
- reroll：旧结果只是 comparison-only，不能成为新 owner 或历史 authority。

## 10. Source navigation / forbidden scope

DTO 只携带 observation 的 canonical `source_event_id` / `source_event_ids`。当前 Event、active Swipe 或
Floor Version 失效时，current group 与其中 observation 一并消失；intervention 仍由其 owning
Floor 作为 Event history 管理；不得从 Chat cache、
message.extra 旁路、Assessment ID 或 UI history 恢复。

未来实现涉及 `core/events.js`、Event Analysis prompt/parser boundary、
`core/health-assessment.js`、`core/health-evolution.js`、`core/health-aggregation.js`、
现有 runtime DTO forwarding 与 `ui/characters.js`。`core/health-recovery-guidance.js`
原则上不改。禁止把规则塞入 `core/state.js`、`runtime/event-analysis.js` 或 `runtime/events.js`，
禁止 Condition/diagnosis/reference/effect/treatment graph、intervention Assessment、全局治疗
弹窗、Chat-level authority、synthetic recovery Event 和历史 AI backfill。

## 11. Test matrix for later implementation

| Area | Cases |
| --- | --- |
| Event schema | valid roles, invalid role, omitted role, reproductive unchanged |
| Analysis | wound+treatment remain two Events; examination+fracture split; treatment-only stays intervention |
| Eligibility | observation eligible; intervention/missing role ineligible; evidence/status guards |
| Evolution | only eligible observations active; no second treatment classification |
| Severity | intervention never changes observation severity or summary |
| Guidance | intervention-only produces no guidance; observation path unchanged |
| Aggregation/UI | same site combines observation kinds; kind does not split card; missing site avoids giant group; factual text and canonical navigation preserved; intervention is not rendered in Current Health |
| Compatibility/lifecycle | old Assessment, no backfill, edit/delete/Swipe/version invalidation, manual supplement and reroll |

## 12. Documentation impact

实现前需按实际 diff 检查并在受影响时同步：

- `docs/CHARACTER-HEALTH-STATE.md`：role、observation-only Assessment、site-group DTO、legacy 状态。
- `docs/ARCHITECTURE.md`：eligibility、Aggregation owner、无 Guidance filter。
- `docs/PROJECT-STATE.md`：状态与 rollout。
- `docs/DEVELOPMENT.md`：实现/测试/真实 Host 验收流程（仅当流程变化）。
- `docs/DATA-MODEL.md`：仅当 Event schema 或 DTO 被正式记录。
- `docs/bioweave-data-lifecycle.md`：仅当实际新增/改变 persistent field 或 registry entry。
- `.trellis/spec/domain/event-pipeline.md`：role 输出与 mixed-narrative split。
- `.trellis/spec/domain/floor-state.md`：现有 Floor ownership 已覆盖；只有新增 lifecycle invariant 才更新。

实现已同步受影响的 canonical Markdown 与 `.trellis/spec`：文档明确记录 factual
`health_role`、observation-only Assessment、site-oriented presentation、Floor ownership
以及 deferred treatment display lifecycle；未修改与本 contract 无关的文档。

## 13. Phased recommendation and decision

1. 已冻结 schema/normalize/validate 与 Analysis role/split，并补充 contract tests。
2. 已收窄唯一 eligibility，保留 legacy source-bound adapter，验证 Evolution、severity、Guidance。
3. 已完成 presentation-only site grouping 与 missing-site fallback。
4. 已更新 Characters UI 的两栏展示和 canonical navigation。
5. 待人工 review 与真实 ST Host 验收 lifecycle、reroll、manual supplement。

结论：`GO` 已进入实现；当前实现不新增 persistence root、migration、treatment lifecycle 或 reference graph，完成后等待人工 review。
