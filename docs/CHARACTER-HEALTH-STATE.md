# Character Health State

> **Character Health State: PARTIAL / Phase 5A Character Details UI consumption**
> **Advanced Health Evolution / full Health State: DESIGN / NOT IMPLEMENTED**
>
> **Persisted Health Assessment Lifecycle Phase 1: IMPLEMENTED**
> **Minimal Health Evolution / Current Health State Phase 2: IMPLEMENTED (read model only)**
> **Active Observation Lifecycle / Presentation Aggregation Phase 4: IMPLEMENTED (derived read model only)**
> **Character Health UI Phase 5A: IMPLEMENTED (Character Details read-model presentation only; A compact popover)**
> **Health Recovery Guidance Phase 5B: IMPLEMENTED (deterministic Projection Context guidance only)**
>
> 本文是 Character Health State 的领域设计与实现边界说明，不是完整医疗系统或完整
> Health UI contract。当前生产链中已经存在 `Current Biological State`；本文说明在其上
> 形成的健康领域 read model 及 Phase 5A 的窄范围 UI 消费边界。

## 1. Problem Statement

BioWeave 当前能够保存正文支持的 `BiologicalEvent`，并通过 `StateReducer` 得到
derived `Current Biological State`。但“发生过什么”和“这个人现在身体怎么样”仍
需要更清楚的领域分界，尤其是短期症状、医疗事实、长期身体改变、明确恢复事实和
正文沉默之间的关系。

本设计不解决某一个 `physical_symptom` 的保存期限。问题是：人物当前身体/健康状态
应属于哪个 derived domain，如何由 surviving factual Events 重建，以及如何向未来的
Characters UI、压缩 Context 和 Projection consumers 提供稳定的事实读模型。

产品目标是“人物当前身体状态记录器”，不是医疗病历系统。只有正文或项目认可的
authoritative character/world factual source 明确出现、并通过 factual analysis 与
validated fact boundary 的健康事实，才允许进入该链路；没有明确事实不创建 Health
Condition，Runtime 不根据现实医学常识凭空诊断。

## 2. Audit Baseline: current architecture

本轮以当前 HEAD 和权威文档/代码为准，未将已撤回工作区设计作为事实。

- `core/events.js` 当前定义 `BiologicalEvent`、`physical_symptom`、
  `medical_event`、`other_biological`、`state_fact`、`story_time`、`location` 和
  六字段 `source`；`state_fact.subject_id` 绑定非 exposure 生物事实的人物归属。
- `core/state.js::reduceState()` 是纯 reducer，当前 state 已包含 reproductive
  exposure、conception/pregnancy、cycle、postpartum、symptoms、medical 等既有
  领域结果。它不会调用 AI、Storage 或 UI。
- `core/snapshot.js` 校验完整 Floor Version，并把有效 Snapshot 作为 derived
  state checkpoint；恢复后继续 replay Events，无效/缺失时 full replay。
- `runtime/event-analysis.js` 读取当前有效 Floor Events、Character Facts 和
  Story Time，通过最近合法 Snapshot 或完整 replay 生成 Current State。
- `ui/characters.js` 与 `ui/events.js` 消费 Runtime DTO；普通 Product UI 不应展示
  raw Event JSON、Event ID、Floor Version、hash 或内部 provenance。当前人物详情中的
  `ui/character-state.js` 是既有 Biological State 摘要，不是本文提出的 Health State。
- 当前 Event contract 没有 Condition ID、condition episode、统一 currentness TTL
  或 recovery duration。本文不把这些缺口偷偷固化为生产约束。

## 3. Domain Boundary

### 3.1 Factual Event domain

`BiologicalEvent` 继续是 Floor-owned authoritative factual history。正文明确支持
的事实，例如手腕被绳索勒伤、发烧、疾病、伤口恶化、接受治疗、伤势恢复、失去肢体、
长期生育损伤或幻肢痛，首先都必须以 narrative-supported Event 进入事实层。

Event 保存发生过的事实及其 `type`、`story_time`、`location`、participants、
`state_fact.subject_id`、factual payload、evidence 和完整 Floor/Swipe provenance。
Event History 不因为人物当前状态改变而删除。

### 3.2 Current Biological State

Current Biological State 是现有 reducer 的 derived factual state domain。它由当前
有效 Events、Character Facts 和 Story Time 计算，不是新的 authoritative fact store。
Health State 的未来 read model 应建立在该 derived state / reducer 语义之上，而不是
另造 Chat-level health ledger。

### 3.3 Character Health State

Character Health State 是 Character Current Biological State 的 derived read model /
derived state domain，面向人物健康摘要、当前问题和长期身体状况的消费方。

它不是：

- 新的 authoritative fact store；
- Chat-level 第二事实源；
- BiologicalEvent 的替代品；
- medical simulation database；
- AI 自己维护的病历；
- Projection 或未来结果的容器。

Health State 必须能够从 surviving authoritative Events deterministic rebuild。删除
Floor、编辑 Floor、切换/删除 Swipe、rollback 或 version replacement 后，失效事实不得
继续贡献健康状态。

## 4. Authority Model

```text
Narrative
↓
Event Analysis
↓
Floor-owned BiologicalEvents
↓
active Swipe / Floor Version filtering
↓
StateReducer / deterministic replay
↓
Character Current Biological State
↓
Character Health State
├─ overall health
├─ current conditions
└─ long-term conditions
↓
├─ Characters UI
├─ compressed factual Context
└─ future Health Projection input
↓
Projection Context
↓
SillyTavern narrative
↓
new narrative facts
↓
Event Analysis
```

完整边界是：

```text
Health State + Story Time + World Model biological rules
  → future Health Projection possibility
  → Projection Context
  → narrative may or may not realize it
  → only realized narrative facts return through Event Analysis
```

`Projection Context` 不允许直接返回成为 Event evidence。Event Analyzer 只能读取实际
生成的 narrative evidence，不能读取自己或 Projection Runtime 产生的提示来证明事实。

## 5. Event vs Health State

| 问题 | BiologicalEvent | Character Health State |
| --- | --- | --- |
| 回答什么 | 发生过什么 | 这个人当前身体/健康怎么样 |
| 权威性 | Floor-owned factual authority | derived read model / derived state |
| 时间语义 | 事实发生或被确认的 `story_time` | 从事实 replay 得到的当前视图，currentness 仍需独立政策 |
| 地点语义 | 事实发生/观察时的 provenance | 不属于 condition identity |
| 历史保留 | 不因当前状态改变而删除 | 可由剩余 Events 重建 |
| UI 用途 | 历史事实与相关历史 | 摘要、当前问题、长期状况 |
| Projection 关系 | 可作为 factual input/provenance | 可作为未来 Projection input；不能被 Projection 改写 |

例如 Day 1 地点 A 的“祁鸢手腕被绳索勒伤”永远表示该日该地点正文确认过的事实。
Day 2 移动到地点 B 不修改 Event.location，不结束伤势，也不创建第二个伤势。

## 6. Health State conceptual structure

以下是设计方向，不是生产 schema：

```text
Character Health State
├─ overall_health
├─ current_conditions
└─ long_term_conditions
```

### 6.1 overall_health

这是给 UI 和 Context 的总体摘要。候选展示可以包含“正常、轻微不适、生病、受伤、
严重受伤、危重”，但最终 enum、标签和排序尚未冻结。

总体状态应由具体有效 Health Conditions 按透明、可测试的汇总规则得到，而不是让 AI
额外生成一个脱离事实的 `severely_injured` authority。轻微擦伤与严重骨折并存时，
摘要可以由规则选择较高严重度，但严重度分级本身仍需产品/领域决策。

`overall_health` 不应绕过具体 condition，也不应直接从 Event Analysis 的一句摘要
复制而来。

`overall_health` 主要表示人物当前总体身体状态/当前影响程度。长期或永久状况应在
`long_term_conditions` / persistence class 的独立区域展示；不能因为存在稳定心脏病
就机械地把当前摘要永久显示为“生病”。例如当前只有轻微擦伤与稳定心脏病时，摘要可以
显示“轻微受伤”；擦伤 derived natural evolution 结束后，摘要的当前影响可以回到正常，
同时长期心脏病仍保留在长期健康状况中。最终 severity enum 和 aggregation rule 仍为
Deferred。

### 6.2 current_conditions

表示人物当前被 Health State 视图纳入的身体/健康问题，例如疼痛、发热、恶心、擦伤、
勒伤、骨折、感染、疾病发作、身体虚弱或生殖系统损伤。每项未来应能引用支持它的
factual Event provenance，并区分事实状态、当前视图状态和信息 currentness。

`physical_symptom` 只是现有候选入口之一，不是唯一或中心入口。`medical_event`、
`other_biological`、reproductive/other 已有 Event contract 中能够表达的事实，同样
可以成为映射来源；未来是否需要更细的事实 payload 另行审计和设计。

### 6.3 long_term_conditions

这是广义长期健康/身体状况，而不是只允许 disease 的“慢性病”表。候选范围包括心脏
病、癌症、长期疾病、后遗症、生育损伤、永久身体改变、截肢、持续性疼痛、幻肢痛和
长期功能受损。

“截肢”可以是永久身体状态而不是疾病；“幻肢痛”可以是长期症状。分类依据应来自
narrative-supported facts 和未来明确的映射政策，不使用现实医学常识自动诊断。

### 6.4 Persistence class（粗粒度产品分类）

Condition 设计上允许具有粗粒度 persistence class：

- `short_term`：发热、普通短期疾病、轻微擦伤、短期疼痛、可自然恢复的普通伤势；
- `long_term`：心脏病、癌症、慢性疾病、长期功能异常、长期生殖系统损伤、持续性疼痛；
- `permanent`：截肢、明确永久性的身体结构改变、明确永久性功能丧失。

这些是 Health State lifecycle 分类，不是医学诊断体系，也不构成 disease ontology。
具体字段名、schema、分类判定算法和 UI enum 尚未冻结。

正文事实覆盖默认分类：如果正文明确说明某状态是暂时、长期、永久、已经恢复或仍然
持续，narrative fact 优先。例如“暂时性失明”不能仅因“失明”一词而默认归入
`permanent`。

## 7. Current vs Long-term conditions

这是产品语义方向；字段名和最终 contract 仍未冻结。

- `current_conditions` 关注当前读模型希望展示/注入的身体问题。
- `long_term_conditions` 关注跨越较长剧情范围仍成立或明确长期存在的状况；其中
  `permanent` 是可单独投影到“永久身体状态”的 persistence class，而不是新的事实根。
- 一个问题可以从 current 视图转为被识别的 long-term 状况；也可能同时在两个视图
  中出现，但如何避免重复展示尚未决定。
- “短期”和“长期”不能仅由 Event type 推断。`medical_event` 不自动等于长期，
  `physical_symptom` 也不自动等于短期。
- `short_term` 只有在未来 policy 认可 natural recovery eligible 时，才可能参与
  Story Time 驱动的 derived natural evolution；这不等于所有 short-term 共享同一 TTL。
- `long_term` 与 `permanent` 不因 Story Time 推进或正文长期沉默而自动消失；只有新的
  authoritative factual evidence 可以改变、终止或重新分类它们。
- 生殖、妊娠和 pregnancy tracking 仍由既有独立领域负责；Health State 不重做妊娠
  模型，也不把普通身体不适自动变成 tracking subject。

## 8. Active observation model（Phase 4 simplification）

Phase 4 撤回 Phase 3 将多个 observation 先归并为 Condition/Trajectory 再进行 lifecycle
evolution 的做法。产品问题是“人物现在身体有什么问题”，不是“多个 Event 是否属于同一
医学 episode”。每个 surviving eligible health observation 独立消费自己的 Assessment，
独立判断 active/inactive。

当前 read model 是 `active_observations[]` 加 `grouped_issues[]`。前者保留 source Event、
Assessment、factual kind/content（包括 factual description）、body_site、laterality、persistence、Story Time 与 recovery
window；后者只按 `body_site + laterality + factual kind` 做确定性精确展示分组，并保留
factual description 与 `source_observation_ids`。普通 UI 优先展示 factual description，不把 machine
kind 直接当成用户文案。展示分组不能合并 Assessment、共享 deadline、supersede observation
或创建 Condition authority。

左手腕疼痛 Day 3 到期、左手腕擦伤 Day 5 到期时，Day 2 两者都 active，Day 3 只保留擦伤，
Day 5 两者都 inactive。重复的 active pain 可以显示为一项，但最后一个 source observation
inactive 后该 display issue 才消失。没有 body site 的事实进入 read-model `general` 展示组，
不会把 `general` 写回 Event。

`body_site` 与 `laterality` 仍是可选 factual metadata，只能来自正文明确支持，不发展为
body-region ontology。`continuation` 保留在 Event contract 作为 provenance metadata，但不再
是 Health Evolution lifecycle prerequisite，也不触发 Assessment supersede、episode resolver
或 recurrence graph。

当前 Event contract 没有独立的、可稳定指向某个 source observation 的
`resolved/healed/recovered` Event 或 reference 字段。普通 `physical_symptom`、
`medical_event`、`other_biological` 的自由 factual payload 不能安全表达“解决了哪一条
observation”。因此本阶段不实现 explicit recovery 提前关闭；目前只有该 observation 自身
保存的 expected boundary 可以触发 derived inactive。最小 recovery factual contract 仍是
后续设计依赖。

`trajectory_id`、MATCH/NEW/AMBIGUOUS、closed trajectory reopening 规则和
`core/health-condition-identity.js` 不再属于 Phase 4 lifecycle path，已移除。高级 Condition
identity、reference resolution、recurrence graph 与医学 ontology 仍 Deferred。

### Retired Phase 3 identity rationale

Phase 3 的 trajectory identity 设计已被 Phase 4 产品模型取代。其 factual `body_site`、
`laterality` 与 `continuation` 字段仍保留，但不再构成 lifecycle grouping contract。

以下 Phase 3 规则已不再用于 lifecycle：

- subject、factual kind、site 与 laterality 现在只用于 observation DTO 和精确展示分组。
- continuation 不再决定是否合并 observation，也不阻止相同问题再次出现。

事实层扩展只允许在正文明确支持时写入：`body_site` 是不带 ontology 的原始部位描述，
`laterality` 只能是受限值，`continuation` 只能在正文明确建立延续关系时为 true。Runtime
不使用自由文本 regex 推断这些字段。

`core/health-condition-identity.js` 已删除。高级 Condition identity、reference resolution、
recurrence graph 与医学 ontology 保持 Deferred。


## 9. Lifecycle

每个 Health observation 可以具有粗粒度 lifecycle view：

```text
current → improving → resolved
current → recognized as long-term
long-term → treated/resolved
```

其中本轮冻结一项新的设计原则：明确属于 `short_term` 且被未来 policy 标记为允许自然
恢复的 condition，可以由 Story Time 驱动 derived Health State 的自然演化。它只能改变
derived Character Health State 的 active/current view，不能改变 historical Event。

概念流程：

```text
Day 1 narrative: 手腕出现轻微擦伤
  → BiologicalEvent
  → short_term Health observation
  → natural recovery eligible
  → Story Time 推进
  → 达到未来 policy 的恢复边界
  → observation 从 Current Health State 结束/移出
```

自动自然演化绝对不能创建 `recovered` BiologicalEvent 或任何正文未确认的恢复事实。
Day 1 的擦伤 Event 仍然保留；Day 10 只可以得到“当前 derived view 不再 active”，不能
伪造 Day 10“已经痊愈”的 Event。

所有其它 transition 仍必须由 narrative-supported factual evidence，或未来明确批准的
derived policy 驱动。不能使用现实医学常识自动补出治疗成功、痊愈、恶化或诊断。

明确的“伤势恢复”“接受治疗”“疾病得到控制”是 explicit factual evidence，可以由已有
合适 Event factual payload 表达；Health State 再据此派生视图。explicit recovery fact
优先于此前的 derived natural evolution。recovery-specific payload、冲突 Event 处理和
improvement/resolution 的最终语义仍 Deferred。

## 10. Health Assessment Contract

> **Status: IMPLEMENTED (Phase 1 lifecycle only)**
>
> At the Phase 1 boundary this did not implement Character Health State, Health Evolution,
> automatic recovery, UI, Context injection, or Health Projection.
>
> Health Assessment 是首次健康事实出现后，对其自然演化的非事实性派生评估。本节不
> 修改当前 Event、schema、prompt、Snapshot 或 Runtime contract。

### 10.1 Purpose and authority

Health Assessment 回答的是：

> “如果后续没有新的明确事实，这个健康事实在 Story Time 上可能如何自然演化？”

它不回答“正文已经发生了什么”。因此必须保持以下分层：

```text
BiologicalEvent
  = 正文明确发生过什么

Health Assessment
  = 对该事实未来自然演化的一次保存后的 derived evaluation

Character Health State
  = surviving facts + saved assessments + current Story Time 的 derived current view
```

Assessment 可以持久化，但持久化不提升其 authority。它不能成为第二 factual source，
不能覆盖 BiologicalEvent，也不能被 Projection 或 Context injection 升级为正文证据。

### 10.2 First successful assessment persistence

对于需要 Assessment 的一条 authoritative factual observation，第一次成功产生的
Assessment 应保存并作为该 observation 后续 Health Evolution 的稳定输入。这里的稳定性
是 source-observation 级别的，不表示一个 Character Condition 一生只能有一个 Assessment，
也不表示 expected recovery 是 immutable condition-level deadline。普通以下操作不得重新
请求 AI 生成另一份恢复预估：

- UI refresh；
- runtime/plugin reload；
- ST restart；
- Snapshot restore；
- full deterministic replay；
- ordinary Context rebuild；
- ordinary Projection refresh。

核心不变量是：

```text
没有新的 authoritative health observation
  → 使用已经保存的 Assessment
  → 不重新估算
```

例如 Day 10 的轻微擦伤第一次得到 `short_term`、natural recovery eligible、earliest
`+3`、expected `+7` 的评估后，Day 17 必须继续使用这份已保存结果，不能因 reload 后
重新得到 `+12` 而改变当前状态。之后如果正文出现新的 authoritative health observation，
则可以产生新的 Assessment，更新该 observation 的后续 derived evaluation；这不是 ordinary replay reassessment。

Assessment 失败时不视为成功保存；普通 replay 不得为了补齐缺失 Assessment 而隐式调用
AI。未来如允许显式重试，必须是当前源事实仍有效且有明确 owner/epoch/版本校验的独立
Assessment operation，不是普通 state rebuild 的副作用。

### 10.3 Ownership and Floor Version binding

推荐采用 **与源 Event/Floor Version 绑定的独立 Health Assessment record**：

- 它不是 BiologicalEvent 内部 factual metadata；
- 它不是只存在于 Current Biological State 的一次性字段；
- 它不是 Projection；
- 它不是 runtime-only cache；
- 它不是 Snapshot 的唯一保存位置。

Assessment record 概念上至少需要指向：

1. 触发评估的 authoritative Event；
2. 该 Event 所属的完整六字段 Floor Version：`chat_id`、`message_id`、`floor`、
   `swipe_id`、`content_hash`、`message_version`；
3. 对应的 factual onset/reference Story Time；
4. Assessment 的派生来源与结果；
5. 能够判断记录是否仍可贡献当前 Health State 的 provenance。

这里的“独立”是领域 ownership 独立，不预先冻结最终物理字段或 storage root。未来它
必须由现有 Character Floor owner 持有，并遵守 active Swipe、六字段 Floor Version、
owner/epoch 和 lifecycle invalidation；不能变成 Chat-level Health ledger。是否在现有
Floor owner 中增加一个受 lifecycle registry 管理的 derived record collection，或采用
其它同等可重建的持久化布局，仍需实现阶段单独决定。

源 Event 因 edit、delete、active Swipe replacement、rollback 或 Floor Version replacement
失效时，其 Assessment 同时失效，不得继续参与 Health State。源 Event 仍然有效但出现
新的 authoritative observation 时，旧 Assessment 可以保留为旧事实的 historical derived
provenance，但不能无条件控制新的 current condition。

### 10.4 Conceptual assessment content

本轮只冻结语义，不冻结生产 schema。概念 Assessment 至少需要表达：

- persistence class：`short_term`、`long_term`、`permanent`；
- natural recovery eligibility：`eligible`、`not_eligible` 或 `unknown`；
- earliest recovery boundary：恢复在剧情上已经合理可能发生的最早边界；
- expected recovery boundary：在没有新的冲突 factual observation 时，derived Current
  Health State 默认结束短期 condition 的边界；
- assessment source：如 `explicit_narrative_timing`、`ai_derived_assessment`、
  `world_model_rule`、`product_policy_fallback`、`unknown`；
- factual onset/reference Story Time：恢复 duration 相对于哪个事实时间计算。

当前生产 Assessment schema 为 v2，并增加 observation-level `severity`：
`unknown`、`mild`、`moderate`、`severe`。它只描述单个 observation / condition 本身的
严重程度；不能被解释为 persistence、recovery duration、permanent、current functional
impact 或 overall health。v1 / legacy Assessment 缺少该字段时，运行时按 `unknown` 消费，
不回写、不自动 backfill，也不因缺字段重新调用 AI。非法 severity 只降级为 `unknown`，
其它合法 Assessment 字段仍保留。confidence、rationale、functional impact、severity
aggregation、overall health 与 Condition identity 仍保持 Deferred。

### 10.5 Earliest versus expected recovery

两者不是同一个 lifecycle boundary：

```text
Day 10：轻微擦伤
earliest = Day 13
expected = Day 17
```

Day 13 以后表示恢复已经“可能合理发生”，但不自动关闭 Current Health Condition。
只有达到 expected boundary，且期间没有新的相关 authoritative factual observation，未来
Health Evolution 才可以将 condition 从 active current view 中关闭/移出。

earliest 可以作为未来 Projection、UI 或 Context reasoning 的输入，但它不是 recovery
fact，也不能直接结束 condition。expected closure 同样不是 factual recovery。

### 10.6 Story Time jumps and natural closure

Health Evolution 必须支持任意大 Story Time jump。Day 10 之后剧情直接写“两个月后”并
到达 Day 70 时，系统应直接比较当前 Story Time 与 saved expected boundary：

```text
current_story_time >= expected_recovery_boundary
  → derived condition 不再 active
```

不模拟中间每一天，不生成中间 Event，不请求 AI 补全过程，不生成 Day 17 recovery
BiologicalEvent。Day 10 的历史 Event 始终保留；Day 24/70 的 derived closure 只改变
当前 read model。

Story Time 不可比较时不能强行推进 recovery；应保留 factual condition，并进入未来
定义的 unknown/unresolved derived state。具体 currentness 表示仍 Deferred。

### 10.7 New observations and independent assessment lifecycles

新的 authoritative health observation 不会自动 supersede 旧 observation；每条 observation 独立演化。

Assessment 应形成按 factual observation 组织的时间序列，而不是把旧记录原地改写：

```text
Day 1 Event A
  → Assessment A
  → expected Day 7

Day 2 Event B：医生说还有三天
  → Assessment B
  → expected Day 5
```

Assessment A 仍表示“基于 Day 1 当时已知事实，系统曾得到 expected Day 7”；它不被改写
成 Day 5。当前 Health Evolution 选择最新适用、且其 source observation 仍属于 surviving
authoritative history 的 Assessment B。

正文明确的 remaining duration 必须以该条新 observation 的 Story Time 为 reference：

```text
Day 2：还有 3 天恢复
  → Day 2 + 3
  → expected Day 5
```

不能错误地以原始受伤 Day 1 作为加法锚点得到 Day 4。同理，Day 4 的“至少还要休息一周”
以 Day 4 为 reference，重新计算新的 expected boundary。每个 recovery timing 都必须有
自己的 Story Time reference/anchor。

普通 replay 与 reassessment trigger 必须分开：

- reload、rebuild、Snapshot restore、Swipe rebuild、Context rebuild 和 Projection refresh，
  如果没有新事实，只消费保存的 Assessment；
- 明确恢复时间、持续、恶化、好转、治疗结果、医生新判断或其它相关新事实出现时，才
  可以触发新的 Assessment。

如果 Day 15 在 expected Day 24 之前出现“伤口恶化并感染”：

1. 保存 Day 15 factual Event；
2. 旧 Assessment 不再无条件控制 Day 24 closure；
3. Day 15 成为新的 current evaluation input；
4. 针对这次新事实产生并保存新的 Assessment；
5. 新的 factual observation 从自身 Assessment 与生命周期开始；不回溯改写旧 observation。

如果 expected boundary 已经过了，Day 72 又出现“手腕居然还没恢复”：

- 不回溯修改 Day 24 的 derived closure；
- Day 72 是新的 authoritative factual observation；
- 当前 Health State 根据 Day 72 及 surviving history 重新得到当前视图；
- 如需自然演化评估，Day 72 事实产生新的 Assessment；
- 旧 Assessment 只保留为旧事实当时的 derived provenance。

这表示 Health State 是“截至当前已知 authoritative facts 的 derived view”，不是上帝
视角的 retroactive medical truth reconstruction。最终 Condition identity 与多次观察如何
合并仍然 Deferred；本节只冻结 authority precedence。

### 10.8 Long-term and permanent

Assessment 可以把事实评估为 `long_term` 或 `permanent`，但这两类原则上没有自动
recovery closure boundary：

- long-term 不因 elapsed Story Time 或正文沉默自动关闭；
- permanent 不因 elapsed Story Time 或正文沉默自动关闭；
- expected recovery 对它们通常不存在、不适用或为 unknown；
- 只有新的 authoritative factual observation 才能改变当前表达。

Story Time 快进十年不能自动删除心脏病，也不能让截肢从 Health State 消失。

### 10.9 Narrative timing versus AI estimate

必须区分两类 timing：

**正文明确 timing**：

> “医生说大约三天就能恢复。”

这是正文中“某人作出了 prognosis/prediction”的 factual statement。未来 factual
analysis 可以提取其 evidence，但它不等于未来一定恢复，也不等于已发生 recovery。

**正文未明确 timing**：

> “这是轻微擦伤。”

AI/规则产生的 `+N` / `+M` 是 derived biological estimate，不是 narrative factual
evidence。

概念 precedence 为：

```text
explicit narrative timing
  > saved derived Health Assessment
  > Product Policy fallback
```

其中 explicit timing 只优先提供 Assessment 的 timing input；实际 recovery 仍需正文
明确 Event 或 derived Health Evolution closure，不能把“医生预计三天”直接变成三天后
必然发生的 factual Event。

### 10.10 Assessment production boundary

推荐未来采用 **独立 Assessment pass**，在 factual BiologicalEvent 成功保存后，以当前
有效 Event/Floor Version 为输入生成一次 Assessment。

相较于让 Event Analysis 在同一 response 中同时输出 factual Event 和 AI estimate，独立
pass 的理由是：

- factual extraction 与 derived evaluation 的 prompt/validation boundary 更清楚；
- Assessment failure 不会使 factual Event 失败；
- 可以严格使用已保存的 authoritative Event 作为输入；
- 未来可分别重试 Assessment，而不重写 Event history；
- 更容易在 replay 时只消费已保存 Assessment，不重新调用 AI。

代价是首次事实处理需要额外 AI/API pass，且需要额外的异步 owner、幂等和持久化协调。
本轮不实现，也不修改 Event Analysis prompt。若未来产品选择单次 AI response，也必须把
derived assessment 与 factual Event 明确隔离，并经过独立 validation/persistence boundary；
不能把 AI estimate 塞入 factual Event payload。

### 10.11 Assessment failure and fallback

Factual Event 成功与 Assessment 成功必须解耦：

| 情况 | 设计行为 |
| --- | --- |
| Assessment 缺失 | 保留 factual Event；Health State 不自动关闭该 condition |
| AI failure | 保留 factual Event；不把失败当作 unknown recovery fact |
| malformed result | 拒绝保存该 Assessment；不污染 Event |
| Story Time reference 不可用 | 保留事实；不计算 recovery boundary |
| duration 无法规范化 | 使用 `unknown`/无自动关闭方向，具体表示 Deferred |
| 已有有效保存结果 | replay/reload 只消费保存结果，不重新调用 AI |

未来可以评估 Product Policy fallback，但只有在明确批准且 deterministic 时才可使用。若
fallback 产生 Assessment，它也必须保存为 `product_policy_fallback` 来源，不能每次 replay
重新选择。当前不存在通用 Health fallback，也不建立医学 duration database；没有可靠
结果时，保守行为是“不自动关闭”。

### 10.12 Replay and Snapshot independence

目标是不变量：

```text
same surviving factual Events
+ same saved Health Assessments
+ same Story Time
+ same deterministic evolution rules
→ same Character Health State
```

因此：

- full replay 消费 saved Assessment，不请求 AI；
- reload 消费当前有效 Floor owner 中的 assessment records；
- active Swipe rebuild 只读取新 active Swipe 的有效 records；
- edit/delete/version replacement 使源 Event 与绑定 Assessment 一起失效，并从 surviving
  history rebuild；
- Snapshot restore 可以读取 derived checkpoint，但必须受 Assessment provenance 与
  当前 Floor Version 校验；
- Snapshot 删除、损坏或过期后，仍应能从 surviving Events 与已保存 Assessments 继续
  rebuild，不依赖 Snapshot 中唯一的一份 assessment。

Assessment 的真正 persisted ownership 因而不能是 Snapshot-only，也不能是 runtime-only
cache。具体 record collection、生命周期 registry entry、clear/invalidation matrix 和
存储迁移需另立实现设计；本轮不修改生产 schema。

### 10.13 Projection and context safety

earliest recovery 可以未来作为 Projection input：

```text
current Health State + Story Time + saved Assessment
  → possible health Projection
```

Projection 可以提示“可能已经明显好转”，但不能关闭 condition、创建 recovery Event、
覆盖 saved Assessment 或成为 factual evidence。expected recovery 的 derived closure 属于
Health Evolution，不属于 Projection realization。

未来 Health State/Assessment/Projection Context 注入 ST 后，也不能回流成为 Event evidence：

```text
saved Assessment / derived Health State / Projection Context
  → prompt context
  → narrative may produce new text
  → only actual narrative output may enter Event Analysis
```

插件注入的文本、Assessment 或 Projection 不因被模型看见而获得 factual authority。

## 11. Story Time / currentness boundary

必须区分五件事：

1. **Historical fact**：某个 Event 在其 `story_time` 发生/被正文确认。
2. **Current health condition**：从有效事实 replay 后，当前 Health State 选择展示的
   condition view。
3. **Long-term condition**：当前/历史事实支持的长期或永久身体状况 view。
4. **Explicit resolution/recovery fact**：正文明确表达改善、治疗、恢复、控制或
   解除的 factual Event。
5. **Derived natural evolution**：在 condition 已被明确分类为允许自然恢复、且未来
   policy 能够提供有效恢复边界时，Story Time 对 derived Current Health State 的演化。

还要单独区分第六件事：**information currentness**。Story Time 过去、正文沉默，不能
制造 recovery Event；Day 1 手腕受伤、Day 5 未提，不自动等于 Day 5 已恢复。只有明确
属于 short-term 且允许自然恢复的 condition，才可能依据未来 policy 进入 derived
natural evolution；long-term/permanent 不因沉默自动消失。

本轮明确不引入 `physicalSymptomFreshnessDays`、统一 TTL 或“所有 short-term 统一 X 天
恢复”。轻微酸痛、普通发热、严重骨折等不能共享未经产品论证的统一恢复时间。
设计层允许未来 policy 表达 persistence class、severity、natural recovery eligibility
和 estimated recovery range/boundary，但本轮不冻结字段名、schema、默认恢复天数或
医疗恢复时间数据库。

仍然 Deferred / Open Decision 的内容包括：哪些 condition 允许 natural recovery、如何
确定恢复时间、severity 如何影响时间、World Model 是否参与恢复规则、AI 是否提供候选
duration、Product Policy 是否提供 fallback、Story Time 不可比较时如何处理、trajectory
如何重算，以及是否需要独立 confidence/currentness 概念。

## 12. Location boundary

`Event.location` 表示该次事实发生/观察时的地点 provenance。它不是 Health Condition
的 identity、生命周期或当前归属地点。

```text
Day 1 / 地点 A：祁鸢手腕受伤
Day 2：祁鸢移动到地点 B
```

Health State 仍可包含手腕问题。地点只在具体 Event/history detail 中显示；它不能因为
地点变化而创建第二个 condition、自动结束旧 condition、阻止 continuity 或改变严重度。

## 13. Existing Event contract and gaps

本轮审计结论是：现有 `physical_symptom`、`medical_event`、`other_biological` 和
已有 reproductive Event/state facts 足以作为设计阶段的事实候选入口；不需要现在增加
`injury_event`、`disease_event`、`chronic_event`、`recovery_event`、`health_event`
或 `condition_event`。

同时存在表达缺口，暂不实现：

- 当前 `state_fact` payload 的 `kind/description` 约束还不能定义稳定 Condition identity；
- 当前 contract 没有明确表示 condition continuity、improving、resolved 或 long-term
  recognition 的统一语义；
- 当前没有 Health Condition provenance/read-model DTO；
- 当前 Event 事实与 future currentness policy 尚未分层表达。
- 当前没有可验证的 Worldbook/Character Card → Health factual Event authoritative
  ingestion path；不能由 Runtime 直接读取任意设定文本并偷偷写入 Health State。

这些是后续领域设计/实现任务的输入，不是本轮生产 schema 修改理由。

## 14. Reducer / rebuild path

未来最小实现应保持以下方向：

1. 解析当前 Chat 中 surviving Character Floors。
2. 只接受 active Swipe、完整六字段 Floor Version 匹配且通过 Event validation 的
   Events。
3. 按 Story Time/既有 deterministic ordering replay；不按 location 合并身份。
4. 由 `StateReducer` 产出 Current Biological State。
5. 从 reducer output 与 supporting Event provenance 派生 Character Health State；对明确
   short-term natural recovery eligible 的 condition，才评估未来 policy 驱动的 derived
   natural evolution。
6. 新的 authoritative factual Event 形成新的 observation：恶化、持续、
   治疗或 explicit recovery 都必须重新评估 derived view。
7. 对 Floor 删除、编辑、Swipe 切换/删除、rollback、version replacement 和 reload
   完整重建或从安全 checkpoint 继续重建。

Health State 不能从 Chat metadata、runtime cache、`last_processed_floor`、已失效
Event、inactive Swipe 或旧 UI DTO 恢复事实。

## 15. Snapshot boundary

Snapshot 继续只是 derived Current State checkpoint。它可以减少 replay 成本，但不能
成为 Health State 的第二 authority，也不能独立创造 condition、resolution 或 long-term
status。

有效 Snapshot 必须继续绑定当前完整 Floor Version/active Swipe；损坏、缺失、stale 或
owner 不匹配时回退 full replay。若未来 Snapshot 包含 Health State 的 derived projection，
仍必须能够由 surviving Events 验证/重建，并遵守既有 clear/invalidation 规则；本轮不改
Snapshot schema。

## 16. Projection boundary

Health State 是 factual derived state，Projection 是 non-factual future possibility。
未来可以使用：

```text
Health State + Story Time + World Model biological rules
  → health-related Projection
  → Projection Context
  → SillyTavern narrative generation
```

Projection 可以提出“可能继续疼痛、恢复或恶化”等未来可能性，但不能治愈、恶化、创建
疾病或修改 Health State factual truth。只有正文真的写出新事实后，Event Analysis 才能
提取新的 BiologicalEvent，Health State 再由 replay 更新。

本轮不实现 generic Health Projection。Projection Context 仍不能进入 Event evidence，
也不能形成 self-reinforcing analyzer loop。

### 16.1 Health Recovery Guidance（Phase 5B IMPLEMENTED / narrow scope）

当前实现的 Health Recovery Guidance / health-related Projection 的目的不是反复提醒剧情模型
“某人仍然受伤”，而是让它在剧情相关时知道当前身体问题处于怎样的粗粒度恢复阶段，并
自然改变身体反应的表现：

- 早期：疼痛明显、活动可能受限、相关动作容易引发明显反应；
- 恢复中：不适减轻、功能影响下降、用力或特定动作仍可能引发反应；
- 接近恢复：大部分活动不再明显受影响，只在特定动作、刺激或环境下出现轻微/偶发反应。

Assessment 的 `reference_story_time`、earliest/expected boundary、persistence 和
natural-recovery eligibility 可以供 Health Evolution / future Guidance 计算 elapsed time、
remaining expectation 与粗粒度 recovery stage。具体时间是 BioWeave 内部推演参数，不是
应该复述给用户的剧情内容。注入给剧情 AI 的 Guidance 禁止要求或诱导输出：具体剩余天数、
恢复日期、百分比、deadline、elapsed/remaining day count、Assessment 字段或内部预测参数，
例如“还有 3 天恢复”“预计第 15 天恢复”“恢复进度 60%”。

Guidance 是行为一致性提示，不是强制剧情点。若当前剧情没有涉及受伤部位、相关动作、
刺激或环境，剧情 AI 可以完全不提该健康问题；只有剧情相关时，才应自然体现当前恢复阶段。
它的目标是表现恢复过程，而不是机械重复 `active` 状态。第一版应保持 `early`、
`recovering`、`near_recovery` 一类粗粒度阶段，不设计百分比曲线、wound-healing ontology、
疾病专属 progression engine、body-region recovery database 或医学 simulator。

每个 observation 仍独立恢复。Phase 5B 使用单一 Health-owned deterministic calculator：
相对 reference Story Time 的 elapsed duration / expected duration 比例小于 1/3 为
early，小于 2/3 为 recovering，其余未到 expected boundary 的 active observation 为
near_recovery。不可比较的 Story Time、缺少 reference 或 expected duration 的 observation
不生成阶段 Guidance；long_term/permanent 也不进入自动恢复阶段。多个同部位 observation 可以在 Guidance 中压缩成一段自然
语义，例如“左手腕整体正在恢复，疼痛已明显减轻，但擦伤在活动或受到刺激时仍可能带来
轻微不适”；这只是 non-factual guidance，不合并 Assessment、不共享 deadline、不创建
Condition authority。Story Time 可以从 Day 10 直接跳到 Day 14，Guidance 直接计算对应
阶段，不逐日模拟、不生成中间 Event、不请求 AI 补全过程。observation 到达自身 expected
boundary 后不再提供 recovery Guidance。

权威边界保持：

```text
authoritative narrative
↓
Event Analysis
↓
BiologicalEvent
↓
Health Assessment
↓
Health Evolution
↓
Health Recovery Guidance / Projection
↓
ST context injection
↓
new narrative text
↓
Event Analysis
```

Guidance / Projection Context 不得成为 Event evidence，也不能创建“疼痛减轻”“已经恢复”
或“伤口愈合” Event。只有剧情正文真正写出这些发展，Event Analysis 才能提取新的 factual
observation。没有新正文时，Health Evolution 仍可在 expected boundary 后移除短期 observation，
但绝不生成 factual recovery Event。

Character Health UI 回答“这个人物现在身体有什么问题”；Recovery Guidance 回答“这些问题
当前发展到什么阶段，剧情相关时如何自然表现”。两者可以消费同一个 Current Health State /
active observations，但 UI 不负责 Projection，Projection 也不成为 factual authority。Phase
5B 复用唯一的 `bioweave_projection_context` 槽位；不新增 Health persistence、Assessment
AI pass、第二个 Context 槽位或 UI recovery countdown。Guidance read failure 不清除同槽位中
仍有效的 Projection；Context 每次按当前 Projection 与 Health Guidance 全量重建。

## 17. Pregnancy boundary

Pregnancy tracking、gestational subject grouping、exposure、Pregnancy Episode 和
Tracking Subject 继续由既有独立领域负责。Health State 可以消费已验证的 derived
biological state 或长期身体事实，但不改变：

- `physical_symptom` 不因普通身体不适自动进入 pregnancy tracking；
- tracking 只由既有 exposure/Event/World Model/capability contract 决定；
- Pregnancy Event 的 subject-local 与 counterpart 语义；
- pregnancy facts 的 Floor ownership、provenance 和 replay boundary。

Health State 不重新设计 pregnancy schema、妊娠计算或 tracking lifecycle。

## 18. UI read model

普通 Characters UI 应消费 Health State 的用户可读 projection，而不是 raw Event JSON。
产品定位上，Health State 主要属于 Character Analysis / Character Details 页面；本轮
不新增顶级 Health 页面。

人物卡片摘要方向：

```text
健康状态：正常
```

或：

```text
健康状态：轻微受伤
```

点击后进入“健康详情”：

```text
总体状态
────────────────
轻微受伤

当前健康问题
────────────────
手腕勒伤       轻微 · 当前存在
最近确认：某 Story Time
发热           中度 · 当前存在

长期健康状况
────────────────
心脏病         长期

永久身体状态
────────────────
截肢           永久身体状态

相关历史
────────────────
某 Story Time · 手腕受伤
某 Story Time · 接受治疗
某 Story Time · 伤势改善
```

普通 UI 不展示 raw Event ID、`character_id`、Floor Version、hash 或内部 provenance。
地点只在相关 Event/history detail 中展示。Debug/Advanced 继续遵守项目既有规则。

Phase 5A 已将当前 `current_health_state` 的 `grouped_issues` 接入现有 Character
Details 页面。该 UI 只展示当前 active read model，不扫描历史 Event、不重算
lifecycle/aggregation、不显示内部 ID、Floor Version 或恢复时间。Phase 5B 已实现
窄范围 deterministic Health Recovery Guidance：它复用唯一
`bioweave_projection_context` 槽位，属于 non-factual guidance，不创建 Event、不修改
Assessment、不修改 Current Health State，也不成为 factual evidence。完整 Health
Projection 仍为 Deferred。

如果人物设定明确写出长期或永久健康事实，未来产品可以支持它进入 factual pipeline。
但当前项目没有已验证的 Worldbook/Character Card → Health Event authoritative ingress；
具体入口必须复用或扩展现有 factual analysis boundary，不能由 UI 或 Runtime 绕过 Floor
ownership 直接读取任意文本写入 Health State。

## 19. Context injection boundary

未来 Context 注入应优先使用压缩后的 derived factual view：

```text
Character: 祁鸢
Health:
- overall: injured
- current: wrist injury, improving
- long-term: none
```

默认不注入全部历史 Event。只有上下文确实需要时，才提供少量相关历史事实；这些历史
事实仍来自当前有效 Event provenance，而不是另一个 health ledger。

Health Context 必须在 Event Analyzer 的 direct narrative evidence 之外保持隔离，避免：

```text
Health State injection
  → Event Analyzer 误当正文事实
  → 生成 Event
  → Health State 自我强化
```

本节是 Context 设计方向，不是当前 Health Context injection 实现。

## 20. Good / Bad examples

### Good

- Day 1 地点 A 的勒伤 Event 在 Day 2 地点 B 仍可支持同一人物的 Health State view。
- “淋了一夜雨”不会自动创建感冒、发烧或肺炎；只有正文后来明确写出健康事实，才可形成
  新的 factual Event。
- 新正文事实在 short-term condition 自然恢复前出现时，保存新 Event，并覆盖旧的 derived
  trajectory expectation；explicit recovery fact 同样优先于自然演化。
- 正文明确“接受治疗”时，未来 reducer/read model 可以引用该 factual Event 并将
  condition view 标为 improving；没有正文支持时不自动治疗成功。
- `physical_symptom`、`medical_event` 和 `other_biological` 都可作为候选事实来源，
  映射由经验证的 payload/evidence 决定。
- Floor 删除或 Swipe 切换后，Health State 从 surviving active Events rebuild，
  不从旧 Chat cache 复活事实。
- Projection 只提出可能性；正文后来真的写出恢复，才产生新的 recovery-supporting
  Event。

### Bad

- 仅因 Day 5 没再提手腕疼痛，就生成“已恢复”。
- 仅因地点从 A 变为 B，就创建第二个 condition 或结束原 condition。
- 把 `subject_id + symptom.kind`、Event ID、counterpart 或 location 直接冻结为最终
  Condition ID。
- 让 Event Analysis 直接输出独立的 `overall_health` authority。
- 将 Projection Context 当作 Event evidence，或让 Health State 直接写回 Event。
- 仅因性行为、淋雨或受伤风险而创建怀孕、感染或其它健康事实。
- 把所有长期状况都限制成 disease，或把截肢/幻肢痛强制归入慢性病。

## 21. Deferred decisions / Open decisions

以下仍属 Deferred / Open decisions；其中已 withdrawn 的旧路线不应重新解释为当前架构：

1. 高级 Condition identity、轨迹/episode 语义与 condition auto-merge（当前路线 withdrawn）。
2. 同 kind、不同部位/伤情和并发问题的展示拆分规则；不恢复 Condition authority。
3. 跨 Event continuity evidence 与无法合并时的 unresolved 行为；不恢复 reference graph。
4. `current_conditions`、`long_term_conditions` 与 `permanent` projection 的互斥、重叠和迁移规则。
5. overall severity 的 enum、排序、聚合和冲突策略。
6. 哪些 condition 允许 natural recovery、恢复边界如何确定，以及 severity 的影响。
7. Health Assessment record 的最终 storage layout、lifecycle registry entry 与物理字段。
8. World Model、AI candidate duration 与 Product Policy fallback 的职责。
9. improving/resolved/treated 的 factual payload 与 reducer transition contract。
10. Story Time 不可比较、正文沉默和 information currentness 的表示。
11. 是否需要独立 confidence/currentness 概念；不预设 TTL、freshness 或医学恢复时间；
    freshness/currentness TTL 路线当前 Deferred。
12. Worldbook/Character Card factual ingress 的具体 authoritative path。
13. 哪些 facts 可以进入 compressed Context，以及如何阻断 Context → Event evidence 回流。
14. Health State 是否进入未来 Snapshot derived checkpoint，以及校验/失效策略。
15. 现有 Event payload 是否需要最小兼容扩展；在此之前不增加 Event 类型或 schema。

## 22. Implementation phases (historical planning record)

本节保留早期规划记录。Phase 1、Phase 2、Phase 4、Phase 5A 与 Phase 5B 的已实现范围
以本文件的 Status reminder 和对应实现章节为准；本节未完成项不能覆盖后续阶段已实现
内容，也不授权恢复 withdrawn 的 trajectory、Condition identity 或 generic Projection。

1. **Vocabulary and contract audit**：冻结术语、authority、provenance、replay 与
   pregnancy boundary；解决上述 Open Decisions。
2. **Health Assessment contract prototype**：在不改生产 schema/prompt 的前提下，验证
   source Event/Floor Version binding、首次保存、explicit timing precedence、earliest /
   expected、failure fallback 与 saved-result replay；不重新请求 AI，不冻结最终字段。
3. **Pure read-model prototype**：以现有 Event contract 验证 condition mapping、
   persistence class、identity 候选和 deterministic rebuild；自然演化只验证 policy seam，
   不冻结 duration。
4. **Reducer integration design**：评估 Current Biological State 与 Health State 的
   组合方式、Snapshot compatibility、invalid owner rebuild 和 failure behavior。
5. **Runtime DTO design**：定义 Characters/Context 消费的压缩 factual DTO；保留
   Debug provenance 与普通 UI 隔离。
6. **Product UI design**：在 DTO 稳定后设计人物卡片、详情、空状态与 currentness 文案。
7. **Context boundary review**：单独审查 factual Context、Projection Context 与
   Event Analyzer evidence isolation。
8. **Implementation and tests**：另立任务后，才考虑 schema、runtime、prompt、UI、
   lifecycle tests 和 real-host acceptance；不由本文授权。

## 23. Health Assessment Storage & Lifecycle Implementation Design

> **Status: IMPLEMENTED (Phase 1 lifecycle only)**
>
> At the Phase 1 storage boundary this did not implement Character Health State, Health
> Evolution, automatic recovery, UI, Context injection, or Health Projection.

### 23.1 Current implementation audit

当前真实架构的关键事实如下：

- `BiologicalEvent` 保存于当前 Character Floor owner 的 `events[]`；无 Swipe 时是
  `message.extra.bioweave`，有 Swipe 时是对应的
  `message.swipe_info[swipe_id].extra.bioweave`。
- Event 的 `source` 由 Runtime 写入，不信任 AI 返回的 source；固定绑定完整六字段
  Floor Version：`chat_id`、`message_id`、`floor`、`swipe_id`、`content_hash`、
  `message_version`。
- Event Analysis AI response 不负责生成 `event_id`；Runtime 依据完整 Floor Version 与
  response ordinal 确定性生成 `event_id`。
- 同一 Floor 的 manual supplement 会使用事实 continuity 保留匹配 Event 的 canonical
  Event ID；真正新增的 Event 使用新的 ordinal。Floor Version 变化时，新的分析结果以
  新版本重新生成/绑定 Event。
- 当前 `event-editing.js` 更新 Event 时保留 Event ID，删除 Event 时从当前 Floor 的
  `events[]` 过滤掉对应 ID 后提交。
- `getActiveFloorEvents()` 只返回 Event source 与当前完整 Floor Version 完全匹配的
  Events；缺少或不完整的 Floor Version 时返回空集合。
- `runtime/event-analysis.js` 通过 active Swipe、完整 Floor Version、Chat token、
  execution/generation identity 和 persistence readback 防止 stale commit。
- `storage/floor-persistence-coordinator.js` 已提供相同 Floor Version transaction key
  的串行化、owner 检查、active Swipe 检查、版本检查、sibling preservation 和
  authoritative readback。
- `core/state.js` 只从当前 surviving Events replay Current Biological State；不读取 AI
  cache 或 Snapshot 之外的隐式事实源。
- `core/snapshot.js` 保存 derived checkpoint 与 processed Event IDs；Snapshot 不是
  Event 或其它 derived record 的 authority。
- Phase 1 已提供 Health Assessment storage、lookup/dedupe、validation、authoritative
  readback、source-bound active filtering 和 stale completion protection；Health Evolution
  runtime 仍未实现。

现有可复用的 derived-record 模式包括 Projection/Tracking timeline 的 Floor-owned
collection、source Event references、deterministic IDs、dedupe、lifecycle filtering 和
Floor Version readback。但这些模块不能被直接当作 Health Assessment 实现；这里只复用
ownership/lifecycle 形状。

### 23.2 Recommended ownership

推荐的概念 ownership 是：

```text
authoritative BiologicalEvent
  + source Floor Version
  ↓
independent persisted Health Assessment record
  ↓
Health Evolution
```

Assessment 应作为同一 Character Floor owner 下的独立 derived assessment timeline /
record collection，与 Event 共享 exact message/Swipe owner 和 Floor Version boundary。
它不是新的 Chat-level Health ledger，也不是 BiologicalEvent factual payload。

这里的“独立”表示领域记录和生命周期独立。Phase 1 已在现有 Floor owner 下增加受
lifecycle registry 管理的 `health_assessment_timeline` collection，当前 schema version 为 2：

- v2 Assessment 增加 observation-level `severity`：`unknown`、`mild`、`moderate`、`severe`；
- 旧 v1 Assessment 缺少 severity 时仍可读取，运行时按 `unknown` 消费，不因缺字段重跑或
  自动 backfill；legacy item 不被回写为 v2 unknown；

- `storage/schema.js` 的默认结构；
- `storage/lifecycle.js` 的 ownership/clear registry；
- `storage/floor-persistence-coordinator.js` 的 owner field allowlist；
- source mutation、Swipe、Chat clear 和 readback contract。

Assessment 不应放在以下位置：

- BiologicalEvent factual payload：会污染 Event contract；
- 仅在 Current Biological State：Snapshot 丢失后无法恢复 AI 结果；
- Projection：会混淆 possibility 与 derived lifecycle；
- runtime-only cache：reload 后丢失且无法稳定 replay；
- Snapshot-only：Snapshot 不是 authority；
- Chat metadata：绕过 Floor ownership 和 Swipe boundary。

### 23.3 Stable key recommendation

当前 Event identity 需要一个重要的实现注意事项：`runtime/event-editing.js::updateEvent()`
会在同一 Floor Version 内保留原 `event_id` 和 `source`，但允许修改 Event factual
payload。因此仅使用 `(source_event_id, source_floor_version)` 还不足以识别“同一条未改变
的 source observation”。

推荐的概念 lookup/binding 是：

```text
(source_event_id, source_floor_version, source_observation_fingerprint)
```

其中：

- `source_event_id` 是主要 Event identity anchor；
- `source_floor_version` 是完整六字段版本，而不是只保存 `floor` 或 `message_id`；
- `source_observation_fingerprint` 是对规范化 factual Event observation 的一致性 guard，
  不包含 `event_id`、`source` 或 Assessment 自身字段。

Phase 1 fingerprint 是 key-order-independent 的规范化字符串，覆盖 type/status、
state_fact.subject_id 与 payload、participants 的 canonical identity/context、
source_evidence、physical_effect、pregnancy relevance 标记和 story_time；明确排除
location、event_id、source envelope、display-only metadata 与 diagnostics。它不是新的
Event ID，也不改变现有 Event identity 系统。

理由：

1. `source_event_id` 是当前 Event persistence 已有的稳定关联点；不需要重新设计整个
   Event identity 系统。
2. 当前 Runtime 的 Event ID 已由完整 Floor Version + response ordinal 确定性生成。
3. 同一 Floor 的多个健康 Event 由不同 Event ID 区分，不会因 subject/kind 冲突。
4. 同一版本的 manual supplement 保留匹配 Event ID，可复用同一 source observation 的
   Assessment。
5. 同一版本的 direct Event edit 即使保留 Event ID，也会因 fingerprint 变化使旧
   Assessment 不再匹配。
6. edit、content hash、message version 或 Swipe replacement 产生新版本时，旧 binding
   不会错误匹配新事实。
7. Assessment record 仍能在 Snapshot 丢失后通过 Event ID + source version + fingerprint
   lookup。

不推荐：

- 只用 `source_event_id`：未来迁移或异常数据中可能把旧版本结果错误复用到新 owner，
  也无法防护同版本 direct Event edit；
- 只用 `source_event_id + source_floor_version`：无法防护当前 Event editing API 保留
  Event ID/source 但修改 factual payload 的情况；
- `Floor Version + array index`：Event ordinal/index 会因分析结果变化而移动；
- canonical factual observation identity：当前 Condition/observation identity 尚未冻结；
- `subject_id + symptom.kind`：不能区分同 kind 并发问题；
- random Assessment ID：无法 deterministic dedupe/rebuild。

未来可以由该 binding material 派生 deterministic assessment ID，但 ID 的具体编码和
Assessment contract version 仍 Deferred。若 source observation fingerprint 不匹配，必须
视为新 observation/失效 binding，而不是继续复用旧 Assessment。

### 23.4 Event and Floor Version invalidation

Assessment 的 active read 必须执行 source join，而不是仅按 Assessment 自己的字段判断：

```text
current active Floor owner
  → current complete Floor Version
  → surviving Events whose source exactly matches that version
  → Assessment records whose composite key matches a surviving Event
  → valid Assessment view
```

因此：

- Floor edit 使 V1 Event 退出 active history，V1 Assessment 也退出 active assessment view；
- message delete 或 history truncation 移除 owner 后，相关 Event 和 Assessment 都不能被
  读取；
- active Swipe replacement 只读取新 Swipe owner，新 Swipe 不得复用旧 Swipe Assessment；
- rollback/version replacement 通过完整版本匹配阻止旧 Assessment 贡献当前状态；
- 同一 Floor Version 的 direct Event edit 即使保留 Event ID，也必须通过 observation
  fingerprint mismatch 使旧 Assessment 退出 active assessment view；
- direct Event delete 后，Assessment 即使物理记录暂时存在，也必须因 source Event 不再
  surviving 而被 resolver 忽略。

推荐以 **logical invalidation first** 为正确性策略：不要依赖逐条物理删除来保证
authority。当前 owner clear 会物理清除整个 Floor slot；但 Event edit/delete 和 derived
timeline 可能保留同一 slot 中的其它记录，因此 Assessment resolver 必须始终验证
surviving source Event。

失效 Assessment 可以在安全的 owner mutation/rebuild 中做 opportunistic garbage collection，
但 GC 不是 correctness prerequisite：

- 保留的 stale record 不得出现在 active Health State；
- 不得成为未来同 Event ID 的 fallback；
- 不得跨 Swipe 或版本复用；
- 不得在普通 reload 中触发 AI 或自动复活。

这比将所有 invalidated records 立即物理删除更符合当前 Projection/Tracking derived
record 的 provenance filtering 模式，也允许保留必要的 diagnostics/provenance。具体
retention 和 GC 策略仍需实现任务决定。

### 23.5 Creation integration point

最小侵入的未来 pipeline 应是：

```text
Event Analysis
  ↓
factual Event normalize / validate / canonicalize
  ↓
Event + analysis + registry authoritative Floor commit/readback
  ↓
identify health facts that need Assessment
  ↓
lookup (source_event_id + source_floor_version)
  ├─ found valid Assessment → reuse, no AI
  └─ missing → independent Health Assessment pass
                  ↓
                validate
                  ↓
                persist under same Floor owner/version
```

Assessment 必须在 factual Event 成功提交并通过 authoritative readback 后触发，原因是：

- Assessment 必须只引用已经成为 authoritative history 的 Event；
- factual Event 失败时不应产生 dangling Assessment；
- source Event、Floor Version、active Swipe 和 owner 可在同一边界验证；
- Assessment 失败不会回滚 factual Event。

职责建议：

- Event Analysis / canonicalization：判断 factual Event 是否有效，不负责生成 Health
  Assessment estimate；
- Health Assessment eligibility helper：未来纯规则层判断哪些 Event 需要 Assessment；
- Health Assessment coordinator：按 composite key lookup、调用独立 pass、校验版本并
  管理 persist；
- Health Assessment analyzer：未来 AI/规则评估，不修改 Event；
- Floor persistence coordinator：复用现有 owner、版本、active Swipe、串行 transaction
  和 readback guard；
- Health Evolution：只消费 valid Events + valid Assessments + current Story Time。

Assessment success 不得反向修改 factual Event、Event ID、Event source 或 Event history。

### 23.6 Retry lifecycle

需要区分：

```text
valid Assessment already saved
  → never retry during ordinary replay

no valid Assessment saved
  → factual Event remains valid
  → optional explicit retry only
```

推荐最小策略：

- API failure、timeout、malformed result、validation failure 不影响 Event Analysis success；
- 普通 reload、replay、Snapshot restore、Projection refresh 不 retry；
- 不建立每次打开 Chat 自动重试的 job system；
- 未来只允许 explicit manual/analysis action 在 source Event 与 Floor Version 仍有效时
  retry；
- retry 前再次 lookup composite key，已有成功 Assessment 时直接 dedupe；
- retry 结果成功后保存为该 source observation 的唯一有效 Assessment；
- failed attempt 可以记录在 diagnostics/attempt status，但不得伪装成 Assessment result。

这让“无 Assessment”成为可解释的 downstream incomplete 状态，同时避免旧 Chat 打开时
大量自动发起 AI 请求。

### 23.7 Duplicate protection and stale completion

当前项目已有可复用的最小保护：

- `runtime/event-analysis.js` 的 per-Floor `inFlight` execution dedupe；
- execution attempt/generation identity；
- `assertExecutionTargetCurrent()` 的 Chat/Floor Version 检查；
- `invalidateInFlightExecutions()` 的 mutation invalidation；
- Floor persistence coordinator 按版本 transaction key 串行化；
- owner、active Swipe、版本和 authoritative readback 检查。

未来 Assessment 不需要分布式锁。建议增加的最小 source-level protection 是：

```text
assessment_request_key = source_event_id + source_floor_version
```

同一 key 的并发 caller 应共享/复用同一 in-flight pass，或在持久化前再次 lookup。若
两个请求仍然同时完成：

- 相同 normalized result：dedupe；
- 不同 result：first confirmed current record wins，后到结果 fail closed，不覆盖已
  保存 Assessment；
- source Event/Floor Version 已不存在或不是 active owner：丢弃结果；
- 不得把后到结果转换为新的 factual Event。

AI response 返回后，必须再次检查：

1. Chat token/epoch 仍有效；
2. 当前 active Swipe 仍是 source Swipe；
3. current Floor Version 与 source Floor Version 完全相等；
4. source Event ID 仍存在且 source 完全匹配；
5. execution/generation identity 仍是 current；
6. persistence transaction readback 仍确认同一 owner/version。

任一检查失败都不能写入 V2、不能绑定到新 Event、不能更新当前 Health State。

### 23.8 Story Time storage recommendation

Assessment 需要保存自己的 Story Time reference/anchor。对“Day 2 还有 3 天”的事实，
概念上应保留：

```text
reference_story_time = Day 2
remaining_duration = +3 story days
expected_recovery_boundary = Day 5
```

推荐未来同时保存：

1. normalized duration：保留正文/Assessment 得到的 duration 语义和 provenance；
2. resolved boundary：在成功 Assessment 时基于 reference Story Time 解析出的 expected
   Story Time；必要时同样保存 earliest boundary。

Health Evolution replay 优先消费已保存的 resolved boundary，不在每次 reload 时重新让
AI 或新的 parser 猜测 duration。保存 reference 与 duration 是为了 provenance、诊断和
未来校验，不是为了让 replay 重新计算出另一条 trajectory。

custom calendar、era、`calendar_id`、`day_index` 和 Story Time precision 必须随 reference /
boundary 的语义一起验证。若 Story Time 不可比较或 boundary 无法规范化，则 factual Event
仍成功；Assessment 可以缺失/unknown，但不得启用自动 closure。

Story Time parser/version 后续变化如何处理、是否以 policy version 使旧 Assessment 失效，
本轮 Deferred；不能在实现阶段静默重算已经保存的 Assessment。

### 23.9 Snapshot and conceptual read path

Snapshot 仍然只是 derived checkpoint：

```text
valid Snapshot
  → 快速恢复 derived Health State

Snapshot 缺失/损坏/过期
  → surviving Events
  + persisted valid Assessments
  + current Story Time
  → deterministic replay
  → 相同 derived Health State
```

Snapshot 不保存 Assessment authority，也不能在 Assessment collection 丢失时补造 Assessment。
当前 Snapshot schema 不适合本轮扩展，因此本轮不修改 `core/snapshot.js` 或其 schema。

当前最小 read path 只解决 assessment validity 与 observation lifecycle，不解决完整 Condition identity：

1. 读取当前 Chat 的 active Character Floors；
2. 验证 active Swipe 与完整 Floor Version；
3. 收集 surviving Events；
4. 收集并验证 source Event/Floor Version/fingerprint binding 匹配的 Assessments；
5. 排除 source 已失效、版本不匹配或 malformed 的记录；
6. 将每个有效 observation 与自身 Assessment 交给 Health Evolution；
7. 对仍 active 的 observation 做 presentation-only exact grouping，不共享 lifecycle。

Assessment storage layer 可以返回“所有 valid source-bound Assessments”和 provenance；
它不应在本轮强行决定不同 Event 是否属于同一 Condition。

### 23.10 Legacy Chat compatibility

旧 Chat 没有 Health Assessment 是正常兼容状态：

- 旧的 surviving health Events 继续作为 factual history；
- 没有 Assessment 时不自动补发大量 AI 请求；
- 不在 Chat 打开、reload、replay 或 Snapshot restore 时后台批量评估历史 Events；
- Phase 1 只处理新成功 Event Analysis 中需要 Assessment 的新 factual observations；
- 未来可以提供显式 manual historical assessment，但必须逐条/受控、绑定当前 source
  Event/Floor Version，并遵守同样的 retry/stale guards；
- 老 Chat 不因缺少 Assessment 而删除或降级 factual Event。

这保持旧数据低成本打开，也避免迁移过程改变历史事实或造成 API burst。

### 23.11 Phase 1 implementation scope (implemented)

Phase 1 已打通：

1. Health Assessment domain validation/normalization；
2. 在现有 Character Floor owner 下保存 `health_assessment_timeline`；
3. 建立 `(source_event_id, source_floor_version, source_observation_fingerprint)` lookup/dedupe；
4. 在 factual Event 成功 readback 后触发独立 Assessment pass；
5. 复用现有 execution、Floor Version、active Swipe、owner/epoch、transaction/readback
   guards；
6. 持久化成功 Assessment，并在 ordinary replay/reload 中只读取它；
7. source Event invalidation 时过滤 Assessment；
8. 对 legacy Chat 保持 lazy/no-auto-backfill；
9. 只提供最小 read DTO 或内部 read path 验证 lifecycle，不实现完整 Health UI。

以下列表描述的是 Phase 1 当时的历史 scope，不代表当前仓库的最终实现状态：

Phase 1 明确不包括：

- 完整 Health State reducer/evolution runtime；
- generic Projection；
- World Model health rules；
- Condition identity/episode 合并；
- chronic disease ontology/body-region ontology；
- pregnancy redesign；
- Snapshot schema migration；
- UI、Context injection、Event Analysis prompt 或 Health Evolution 实现。

### 23.12 Phase 2 minimal Health Evolution (implemented read model)

> **Status: IMPLEMENTED (minimal derived read model only)**

Phase 2 新增 `core/health-evolution.js` 与 `runtime/health-evolution.js`。它们只从
当前仍 surviving 的 BiologicalEvents、通过 source Event/Floor Version/fingerprint
校验的 persisted Assessments，以及当前 Story Time 派生最小 `current_health_state` DTO；
该 DTO 不是新的 storage root，也不是 factual authority。

- `short_term` 且 `natural_recovery = eligible` 的 observation 只有在可比较的
  `expected_recovery.boundary` 到达，或已保存的 expected duration 相对
  `reference_story_time` 到达后，才从 active read model 中移除；`earliest_recovery`
  不会关闭 observation；
- `long_term` 与 `permanent` 不因 Story Time 跳跃或正文沉默自动关闭；不可比较的
  Story Time 保持 active/unresolved；大跨度跳跃直接比较，不逐日模拟；
- derived closure 不创建 recovery Event、不改写原 Event、不改写 Assessment；
- Phase 4 不再执行 trajectory grouping 或 latest-observation supersede；每条 observation
  独立消费自己的 Assessment，`body_site`/`laterality` 只用于 presentation grouping；
- 没有 Assessment 的 legacy health Event 不会被自动补评估；它仍可按现有 lifecycle 进入
  active read model，severity 按 unknown 消费，且没有 Assessment recovery deadline。

主 Event Analysis 只保留 commit/read path 上的窄 Health hook；候选选择、Assessment、
observation evolution 与 presentation aggregation 分别由 Health-owned modules 负责。
本段中“Phase 4 仍不实现 UI、Projection……”是该阶段的 historical phase scope，后续
Phase 5A/5B 已分别实现 Character Health UI 与窄范围 Health Recovery Guidance。World
Model health rules、Snapshot Health migration、historical backfill、复杂 Condition
identity、reference resolver、recurrence graph 与 pregnancy redesign 仍不属于当前实现。

### 23.13 Phase 5A Character Health UI (implemented, narrow scope)

Phase 5A 在既有 Character Analysis / Character Details 页面展示 Runtime 已提供的
current_health_state。人物详情按 canonical character_id 读取对应人物的
grouped_issues，使用 read model 提供的 display_site、laterality 与 factual_kind
做用户可读呈现；缺少部位时显示为展示层的“未标明部位”，不回写 Event。

UI 不推导 overall severity，不消费或显示 active_observations 的生命周期字段，
不显示 Assessment ID、Floor Version、fingerprint、raw timing 或 recovery countdown。
current_health_summary 只有在 Runtime 提供非空摘要时才直接显示；缺少摘要时不额外
渲染摘要行，状态由健康按钮与“总体状态”徽标表达。Health read model 已 ready 但人物
不存在于 `characters` 或 `grouped_issues` 为空时，保持正常状态的安全空状态；read model
缺失、未 ready 或失败时，保持不可用状态。

Phase 5A 只实现 Character Details read-model consumption；不新增顶级 Health 页面、
不触发 AI/Analysis/Projection/persistence，不实现 recovery stage、Context injection
或 UI 侧 Health lifecycle。Phase 5B 随后通过既有 Projection Context 槽位提供
Health Recovery Guidance；Phase 5A UI 本身不显示 recovery stage 或倒计时。

健康按钮的“健康 · 正常”只表示成功就绪的 Health read model 中没有已知 active health
issue；人物没有 `characters[character_id]` entry 也可以合法表示该状态。Read model 未就绪、
失败或不可用时使用“健康 · 暂不可用”，不把它解释成正常，也不创建任何健康事实。

Phase 5A 的来源导航使用 `grouped_issues[].source_observation_ids` 中已有的 canonical
Event ID。单个来源显示“查看来源事件”，多个来源逐个提供定位入口；Character UI 只依据
当前有效 Event read model 校验来源，不通过 description、body_site、factual_kind 或人物
文本匹配。Events 页面按 `data-bioweave-event-id` 展开、滚动并短暂聚焦目标 Event。
来源 Event 已删除、失效或不属于当前人物时，不生成来源入口；这项交互不改变 Event、
Assessment、Health Evolution、Aggregation 或 Floor authority。

## Status reminder

advanced Health Condition identity、currentness policy 在当前仓库仍为 **DESIGN / NOT
IMPLEMENTED**。Character Health UI 已实现 Phase 5A；Health Recovery Guidance / recovery-stage
Projection Context 已实现 Phase 5B 的窄范围 deterministic guidance。Character Health UI 目前仅
实现 Phase 5A 的 Character Details read-model presentation，不代表完整 Health UI。
当前已实现的是 BiologicalEvent、Persisted Health Assessment Lifecycle Phase 1、minimal
derived Health Evolution / Current Health State read model、Phase 4 independent observation
lifecycle and presentation aggregation、Current Biological State、Snapshot、既有
Characters/Events consumers、Health → source Event navigation，以及 Phase 5B 的窄范围
Health Recovery Guidance / Projection Context boundary。

```text
BiologicalEvent
  → Health Assessment
  → Health Evolution
  → Health Aggregation（presentation-only）
  → Current Health State
  → Character Health UI

Current Health State
  → Health Recovery Guidance
  → Projection Context
```

Health Recovery Guidance 是 deterministic、non-factual guidance：不生成 Event、不修改
Assessment、不修改 Current Health State，也不成为 Event evidence。不能将 Phase 5B 写成
完整 Health Projection、explicit recovery resolution、long-term disease progression engine
或医疗系统。

健康按钮的“健康 · 正常”只表示当前已成功就绪的 derived Health read model 中没有已知
active health issue；它不是 authoritative healthy fact、BiologicalEvent、Health Assessment、
persistence state，也不是医学意义上的完全健康声明。read model ready 且人物没有
`characters[character_id]` entry，或已有 entry 但 `grouped_issues=[]` 时，都可以显示“健康 ·
正常”；active issues 显示“健康 · 有异常”；unavailable、error 或 not ready 显示“健康 ·
暂不可用”。人物没有 entry 不代表 Health 无数据，因为当前 entry 由 active health
observation 驱动产生。

`grouped_issues[].source_observation_ids` 当前实际保存 canonical `BiologicalEvent.event_id`，
用于 Character Health → source Event navigation；它是 presentation/read-model provenance
linkage，不是新的 observation authority。

generic runtime 只允许提供 narrow orchestration hooks：调用、DTO forwarding、lifecycle/
stale guard 和 persistence coordination。eligibility、assessment semantics（包括 severity）、evolution、
aggregation、recovery guidance，以及未来 health summary 均由 Health-owned modules
负责；UI 只负责 presentation。未来新增能力应遵循：small pure core module → explicit DTO
→ narrow runtime coordinator/hook → presentation-only UI。禁止创建 Health Manager / God
module，也不得把 Health 规则塞进 `runtime/event-analysis.js`、`runtime/events.js`、
`ui/app.js`、`ui/characters.js` 或 generic StateReducer。

以下能力保持 Deferred：current functional impact、overall health summary、severity aggregation、
long-term disease progression、explicit recovery reference resolution、
以及 chronic/permanent 的 advanced presentation。`severity ≠ persistence`、`severity ≠
recovery duration`、`severity ≠ permanent`、`severity ≠ current functional impact`、
`severity ≠ overall health`。当前不实现 `critical`、confidence、rationale、medical risk、
triage 或 emergency-level semantics。

Health Assessment Severity v1 当前为 **CLOSED**。实现与 regression attribution 已完成：
Health focused tests 28 passed，broader controlled tests 106 passed，`node --check` 与
`git diff --check` 通过。Full suite 未获得 clean pass；已确认的 `DIGEST_BROKE` 与 World
prompt fixture failure 可由 HEAD baseline 复现，reroll/scheduler 仅在长文件/长驻运行环境中
出现过非稳定观察，`event-analysis-runtime.test.js` 的长时间不结束问题也不归因于 severity。
这些结果不构成 severity regression，不重新打开本实现。

以下旧设计已 withdrawn 或明确不属于 current architecture，不得恢复：trajectory identity、
`core/health-condition-identity.js`、latest-observation supersede、condition auto-merge、
recurrence graph、reference graph、freshness/currentness TTL、implicit explicit-recovery
resolver、generic Health Projection、medical ontology 与 body-region ontology。
