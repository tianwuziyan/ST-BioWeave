# Phase 2D Projection Architecture Plan

状态：Phase 2E Context Injection 已实现；Projection persistence、generation 和
deterministic domain contract 已完成。未实现 UI、Probability/RNG、Genealogy 或
自动 Projection generation cadence。
范围：Projection Event、Projection evolution、Floor 时间轴生命周期，以及当前
有效 Projection View 的只读 Context Injection。

## 1. 本轮结论

Phase 2D 的唯一 Projection 定义是：

> 基于当前确定性生物事实、Current State、Story Time、World Model 生殖机制和
> Character Facts，生成一个未来可能发展的、可供正文自然参考的结构化生物发展
> 方向。

Projection 不是 BiologicalEvent、Current State、Snapshot，也不是事实性生物结论。
正文是否实现、改变或否定该方向，必须再次经过 Event Analysis 和
StateReducer；Projection 本身不能写入事实层。

本轮只更新规划文档，不修改 BioWeave 产品代码、测试或 Phase 2C。

## 2. 构画源码审计范围

实际审计的 SevenDaysCal `master` 源码包括：

- `business/lines/schema.js`
- `business/lines/prompt.js`
- `business/lines/injection.js`
- `business/lines/evolution.js`
- `business/lines/lifecycle.js`
- `business/lines/runtime.js`
- `business/lines/strategy.js`
- `business/lines/generation.js`
- `business/lines/history.js`
- `business/lines/controller.js`
- `business/lines/actions.js`
- `business/lines/mutations.js`
- `business/lines/swipe-store.js`
- `business/lines/capacity.js`
- `business/lines/inline.js`
- `business/lines/feature.js`
- `draw.js`
- `index.js` 中 Lines feature 的创建、消息生命周期和注入调用位置

参考仓库：[ST-SevenDaysCal](https://github.com/atonal519/ST-SevenDaysCal)。关键源码：
[schema.js](https://github.com/atonal519/ST-SevenDaysCal/blob/master/business/lines/schema.js)、
[prompt.js](https://github.com/atonal519/ST-SevenDaysCal/blob/master/business/lines/prompt.js)、
[evolution.js](https://github.com/atonal519/ST-SevenDaysCal/blob/master/business/lines/evolution.js)、
[injection.js](https://github.com/atonal519/ST-SevenDaysCal/blob/master/business/lines/injection.js)、
[controller.js](https://github.com/atonal519/ST-SevenDaysCal/blob/master/business/lines/controller.js)。

## 3. 【构画源码实际行为】

### 3.1 Line 数据和生成

`schema.js` 将每条 Line 规范化为 `name`、`stage`、`when`、`agency`、`stall`、
`pin`、`adult`、`desc`、`next` 和可选 `cue`。有效回复必须含完整 widget；每条
Line 必须有非空的 name、when、Desc、Next。阶段集合是 `起线`、`延展`、`成形`、
`收束`、`淡出`。

首次生成或 reroll 可以产生自动 Lines；advance 会要求旧的 active Lines 继续
返回，同时允许产生带新 Ticket 的新 Line。AI 输出要经过 schema 校验，随后由
`evolution.js` 检查旧 Line 是否遗漏、旧 Line 是否错误获得新 Ticket、新 Line
是否使用合法 Ticket，以及 active 数量上限。

### 3.2 Desc、Next、Ticket、Cue

- `Desc` 描述当前暗线的状态、背景和位置。
- `Next` 描述可能的下一步或恢复条件，不是命令，也不是已经发生的结果。
- Ticket 是新 Line 的生成输入约束/资格凭证；它不是剧情结果。
- Cue 是内部的方向向量/生成上下文；它不是事实和用户可确认的业务结果。

Prompt 明确要求未来方向不强制剧情、短时间不能跨越长过程、没有 Line 必须每轮
升级，并允许发展激化、维持、缓和、转向、解决或淡出。因此阶段是创作生命周期
位置，不是生物事实状态。

### 3.3 active、terminal 和注入

`strategy.js` 的 `activeLines()` 默认过滤 terminal stage；`收束`、`淡出` 不再
作为 active Line 注入。注入由 `injection.js` 通过 SillyTavern
`setExtensionPrompt()` 完成，位置是 `IN_CHAT`，深度为 4，角色为 SYSTEM。注入前缀
明确告诉正文模型这是“潜伏的伏笔”，只能把握暗线走向，不应直接引用、点破或强制
剧情；文本包含 name、stage、when、stall、desc、next。

### 3.4 触发、正文反馈和异步保护

`strategy.js` 支持两类推进：turns 按渲染/轮次计数，days 按故事日变化推进；也
支持 manual 不自动推进。`feature.js` 在 assistant Floor render 后登记并确认 Floor，
按模式触发 advance；days 模式在日期 aftermath 后触发。最新且尚未稳定的 assistant
消息不会作为本轮 generation 的历史上下文。

生成控制器会捕获 chat、chat revision、participant、baseline 和 AbortController，
在 AI 调用前后检查 owner/baseline，并只允许仍然属于当前 owner 且 baseline 未变的
结果 commit。Chat switch、participant 变化、旧 reroll 或旧 swipe 会使旧任务失效。

Lines 的主要状态保存在独立的 Lines store；swipe 层使用独立 localStorage key。
这不是 BioWeave 的 Floor authority，不能直接照搬。源码没有一个
“Line 实现后自动生成 BiologicalEvent”的内部事实管线；“正文影响下一轮 Lines”
是由正文生成生命周期和下一轮 AI generation 形成的反馈，而不是 Lines 自己的事实
reducer。

## 4. 【从构画源码借鉴的思想】与【不能照搬的部分】

可以借鉴：

1. active future directions 与事实层分离。
2. 当前描述与下一发展方向分开表达，类似 `Desc` / `Next`，但 BioWeave 应以
   结构化字段为主，文本只是受限渲染字段。
3. active 条目注入正文；terminal 条目退出注入。
4. Story Time-only 变化也可以触发演化机会，不要求新 BiologicalEvent。
5. 正文可自然实现、改变或忽略暗线；下一轮再根据新事实演化。
6. AI 输出先校验、再审计演化、最后在 owner/baseline 守卫下持久化。
7. 旧状态不被原地改写，生成结果通过新的生命周期记录表达。

不能照搬：

- `起线/延展/成形/收束/淡出` 不是 BioWeave 的 pregnancy/status 枚举。
- Line name 不能作为 BioWeave identity；BioWeave 必须使用稳定的机制、subject、
  source Event 和 development kind 指纹。
- Ticket、Cue、agency、pin、成人标记、Line capacity 和构画专用剧情规则不属于
  BioWeave 生物域。
- 构画的 Lines store、per-swipe localStorage 和外部缓存不能替代当前
  Character Floor / active Swipe owner，也不能进入 Chat metadata。
- 构画的随机向量抽取不能变成 BioWeave 的 pregnancy RNG。
- 构画的通用 Line 反馈不能替代 BiologicalEvent、StateReducer、Current State、
  Snapshot、World Model 或 Event provenance。
- BioWeave 只通过 adapter 读取 SevenDaysCal Story Time / Story Context，不 import
  SevenDaysCal 私有业务模块。

## 5. BioWeave 完整反馈闭环

```text
当前 Character Floor / active Swipe
  -> Event Analysis
  -> BiologicalEvent（事实层）
  -> StateReducer
  -> Current State（确定性派生层）
  -> 当前 Story Time + World Model mechanism
  -> Projection generation / evolution
  -> active Projection Events（未来方向层）
  -> 后续正文 Context（Phase 2E）
  -> 正文自然实现、改变或忽略方向
  -> 下一 Character Floor Event Analysis
  -> 新 BiologicalEvent / 新 Current State
  -> Projection 再演化
```

| 层 | 输入 | 输出 | owner | AI | 可否写事实层 |
| --- | --- | --- | --- | --- | --- |
| Event Analysis | 当前正文、Story Time、当前事实上下文 | BiologicalEvent | 被分析 Floor/active Swipe | 是 | 只能写当前 Floor facts |
| StateReducer | 有效 Events、当前 Story Time、Character Facts | Current State | Runtime derived；Snapshot 只是 Floor cache | 否 | 否 |
| Projection engine | Current State、exposure history、mechanism、Story Time | Projection DTO/lifecycle operation | 当前生成所在 Character Floor/active Swipe | hybrid | 否 |
| Context Injection | active Projection read DTO | 有明确“可能方向”语义的 prompt | Runtime transient | 否 | 否 |
| 正文生成 | 正文上下文和可选 Projection prompt | 新正文 | SillyTavern message | 是 | 间接产生下一轮事实输入 |

Projection 不进入 `Snapshot.state`、`state.characters` 或 StateReducer；Snapshot
继续只保存 Current State。

## 6. 新 Projection 定义和边界

### 6.1 三层语义

- Exposure happened：由有效 BiologicalEvent 表达。
- Current unresolved state：由 StateReducer 根据事实表达。
- Projected development：由 Projection 表达，代表未来方向/可能表现。

“可能出现机制相关变化”不等于 symptom fact；“检查方向变得合理”不等于检查已经
发生；“当前没有明显表现”也不等于某个事实状态已经成立。只有正文后来明确写出并
经 Event Analysis 验证，才进入 factual Event；Projection 不能生成事实。

### 6.2 Story Time

Story Time-only advancement 必须可以生成或推进 Projection，即使当前 Floor 没有
新的 BiologicalEvent。时间的作用是使某个机制的未来发展候选开始变得合理。不能
硬编码人类 7/30/90 天、排卵、孕期或分娩时间。

World Model 机制建议未来扩展为机器可读的 `development_timing` 或
`projection_triggers`：

```js
development_timing: [{
  key,
  trigger: 'elapsed_after_exposure' | 'story_time_reached' | 'factual_event',
  reference: 'exposure_story_time' | 'current_story_time',
  earliest: { value, unit, time_domain },
  latest: { value, unit, time_domain },
  evidence: [],
}]
```

第一版优先支持可计算的 Story Time day domain；不兼容或无法比较的时间保持
unknown/null，不借用 Floor、message 或系统时间。

## 7. Projection Event DTO

这是 Phase 2D-1 的纯 Core/domain contract；当前不代表已经接入 Floor persistence。

```js
{
  schema_version: 1,
  projection_id: 'deterministic projection key',
  owner_type: 'character',
  subject_id,
  projection_rule_id,
  development_concern_key,
  mechanism: {
    key,
    world_model_rule_refs: [],
  },
  source_event_ids: [],
  created_at_floor_version: {
    chat_id, message_id, floor, swipe_id, content_hash, message_version,
  },
  development: {
    kind: 'possible_biological_change' | 'possible_detection' |
      'mechanism_progression' | 'no_obvious_change' | 'monitoring_signal',
    current_basis: {
      event_ids: [],
      state_refs: [],
      mechanism_rule_refs: [],
    },
    next_signal: 'bounded structured/renderable text',
  },
  timing: {
    trigger_kind,
    reference_event_id,
    reference_story_time,
    current_story_time,
    elapsed_story_days,
  },
  evidence_refs: [],
}
```

`current_basis` 和 `next_signal` 可以承担构画 Desc/Next 的结构化/可读职责，但不能
把 Current State 副本或 UI 字符串塞进 DTO；kind、timing、basis、source refs 和
Floor owner 必须可验证。`projection_rule_id` 和 `development_concern_key` 属于
发展关注 identity；source Event 集合只属于 provenance/evidence。

后续变化使用独立的 `ProjectionLifecycleRecord`：

```js
{
  schema_version: 1,
  lifecycle_id: 'projection_lifecycle_<deterministic_digest>',
  projection_id,
  owner_type: 'character',
  record_kind: 'factual' | 'deletion',
  action: 'realized' | 'contradicted' | 'expired' | 'deleted',
  created_at_floor_version: {
    chat_id, message_id, floor, swipe_id, content_hash, message_version,
  },
  evidence_refs: [],
}
```

Projection identity 只使用 Chat scope、subject、`projection_rule_id` 和
`development_concern_key`；source Event 集合只是 provenance/evidence。新增 evidence
必须使用 append-only `ProjectionEvidenceRecord`，不能覆盖创建 Floor 的 DTO：

```js
{
  schema_version: 1,
  evidence_record_id: 'projection_evidence_<deterministic_digest>',
  projection_id,
  owner_type: 'character',
  source_event_ids: [],
  created_at_floor_version: { chat_id, message_id, floor, swipe_id, content_hash, message_version },
  evidence_refs: [],
}
```

生命周期聚合不按 Floor Version 的 `floor → message_id → swipe_id → content_hash →
message_version` 排序；这一版 2D-1.1 审计后废止该排序方案。业务时间必须由
surviving Character Floor resolver 提供的 canonical timeline 顺序决定，Swipe ID、
content hash 和 message version 只用于 owner/version 校验。事实 lifecycle 与用户
Delete 分属两个维度；同一 timeline position 的互相冲突 factual actions 报 conflict，
不能用 enum precedence 偷选。完全相同记录仍可去重。

`resolveProjectionView({timeline})` 返回 identity、聚合 provenance、
`factual_status`、`deleted`、`context_visible` 和 diagnostics；timeline 必须是当前
Chat 的 surviving Character Floor/active Swipe 序列。

### 7.1 Multiple reproductive sources

`ReproductiveSourceCandidate` 是由 exposure history 与 World Model compatibility
派生的 read DTO，不是 Event、Projection 或 Snapshot 内容。它保留
`subject_id`、`source_character_id`、source Event IDs、mechanism、contribution kind
和 `compatibility: true | false | null`。

`ContributorAttribution` 独立表达一个 pregnancy episode 的 contributor 视图，包含
`confirmed[]`、`excluded[]`、动态 `candidates[]`、`unresolved` 和 conflicts。关系
identity 是 `pregnancy_id + subject_id + source_character_id + contribution_kind`，
允许多个 confirmed contributors，也允许同一 source 的多个 contribution kind。只有
factual `reproductive_source_attribution` Event 能建立 confirmed/excluded；candidate
不会自动升级。

## 8. 生命周期与 append-only Floor 时间轴

建议使用以下语义，而非照搬 Line stage：

- `active`：当前仍可作为未来方向参考。
- `realized`：后续 factual Event 满足明确 realization criteria。
- `contradicted`：后续 factual Event 明确否定该方向。
- `expired`：机制时序结束，且没有规则允许继续的方向。
- `deleted`：用户主动删除；从未来 Context 完全消失。
不需要把 `evolving` 作为持久 status；它可以是生成操作。第一版不定义“替代”
状态：新 Projection 出现本身没有独立的 Runtime、UI 或 Context 语义，不能自动
终止旧 Projection。第一次生成只发生在有
有效 basis 且没有相同 active identity 时。Story Time 推进但正文未实现时，保持
active、更新 timing/evolution 或按规则 expired，不自动变成事实。

Projection X 在 Floor 10 创建后，Floor 20 的 realization/deletion/contradiction
只能保存新的 `ProjectionLifecycleRecord` 到 Floor 20 的 active Swipe。Floor 10 原样不动。
当前聚合按 surviving Character Floors 的 canonical timeline 折叠创建记录和后续记录。
Delete 只使当前 Projection 不 active，不抹掉 factual lifecycle；删除 Floor 20
时，其所有记录一起消失，系统自然恢复 Floor 19 之前的视图；不实现中间
历史删除后的全局 dependency DAG 或未来级联扫描。

Projection owner 必须与现有 Floor 规则一致：Character/assistant Floor 的当前
active Swipe；无 Swipe 使用 `message.extra.bioweave`，有 Swipe（包括 0）使用
对应 `swipe_info[swipe_id].extra.bioweave`。禁止 User Floor、Chat metadata、旧
Swipe fallback 和跨 Chat tombstone。

## 9. Identity、去重与多来源发展关注

Projection identity 不等于创建 Floor Version，也不等于 source Event 集合。第一版
建议使用：

```text
chat_id
+ subject_id
+ projection_rule_id
+ development_concern_key
```

其中 `projection_rule_id` 表示具体的机制发展规则，`development_concern_key`
表示同一 subject 的同一未来发展关注。`source_event_ids` 是 provenance/evidence，
不是 identity；E1、E2、E3 可以共同支持一个 Projection，避免为 B/C/D 各生成一份
重复的生物发展提示。

多个 exposure 应合并为一个 Projection 的条件是：同一 subject、同一
`development_concern_key`、同一 `projection_rule_id`，且 World Model 判定它们
进入同一发展路径。不同机制若由同一规则明确允许共同导致同一发展关注，可以合并，
但必须保留各自 evidence 和 mechanism refs；机制规则不同且发展路径不同，必须拆成
多个 Projection。source candidate attribution 不属于 Projection identity。

新增 E4 不修改历史 Projection。当前 aggregate view 收集 E4 作为新的 provenance
和 candidate evidence，并通过 append-only evolution/evidence record 表达；如果 E4
改变了 rule 或 development concern，则创建新的 Projection identity。任何情况下都
不能回写创建 Projection 的历史 Floor。

Projection generation 读取已有 identity 和当前 candidate summary，执行 keep/evolve
或 create；不存在按 source Event 逐个复制未来方向的默认行为。identity 中不使用
UUID、Date.now、Math.random、content hash 或 message version。

## 10. Generation：规则、AI、Probability

| 方案 | 优点 | 风险 | 结论 |
| --- | --- | --- | --- |
| 纯规则 | 可验证、稳定、无幻觉 | 难表达自定义世界的表现形式 | 负责 eligibility、timing、identity、lifecycle |
| 完全 AI | 能表达外星/魔法/寄生/技术机制 | 可能改写事实、重复、跨过时间边界 | 不采用为唯一生成器 |
| hybrid | 规则守住事实边界，AI表达世界特有方向 | 需要严格 DTO 校验与 stale guard | 推荐 |

第一版不实现 Probability 或 RNG。规则先判断 exposure、subject、机制兼容性、
Story Time、factual precedence 和已有 active projection；AI 只在这些约束内产生
候选 development 描述。未来若增加 Probability，只允许用于候选方向排序、发展权重
或方向选择，不能改变事实层。

## 11. Event Analysis feedback loop

不能采用“任意相关 Event 出现就 realized”。最小可行关联为：

1. Projection 保存 development concern、rule refs 和 source Event provenance。
2. 后续 Event Analysis 生成事实时，不改变旧 Projection。
3. 来源确认/排除由独立的 factual attribution Event 表达，再由聚合器更新
   Contributor Attribution。
4. 显式 factual Event 优先于 Projection；Projection 不能降级、覆盖或伪装成 Event。
5. 未出现可靠 attribution fact 时，source attribution 永远可以保持 unresolved。

后续如果需要 AI 辅助匹配，AI 只能提出 candidate association，由确定性 validator
和 evidence policy 接受；AI 不能直接写 realized 事实。

## 12. Context Injection

当前接口为：

```text
buildBioWeaveProjectionInjection(activeProjectionReadDTO, {
  channel: IN_CHAT,
  depth,
  role: SYSTEM,
}) -> prompt text / empty
```

只注入当前 Chat、当前有效 Floor/Swipe 链中 `context_visible === true` 且 provenance
有效的 Projection。注入内容包含有限的 development kind、未来方向、机制背景和
“可能方向、不是事实；不要强制剧情；可以实现、改变或忽略”的明确边界。不得注入
deleted、contradicted、expired、raw seed、内部 hash 或无效 owner 数据。注入使用
固定 `bioweave_projection_context` slot，空 View 会清空该 slot。

## 13. Delete 语义

UI 只有 Delete，没有 Accept。Delete 不修改旧 Projection，而是在用户当前的
Character Floor/active Swipe 写一个 owner-local deletion lifecycle record。聚合后
该 identity 不再 active、不进入未来 Context，但保留独立的 factual lifecycle 视图。
因此“正文已经实现”与“用户不再希望继续注入”可以同时成立；删除不会擦掉 realized、
contradicted 或 expired 的事实语义。删除记录所在 Floor 被删时，记录也消失，时间轴
恢复到此前状态。

如果同一 Floor 后续重新运行 projection generation，必须由当前有效 deletion record
阻止无条件复生；这需要一个明确的同 Floor dedupe/deletion policy，不能用 Chat-level
永久 tombstone 解决。无论采用哪种 policy，都必须保留 Floor Version/Swipe owner
和 stale write guard。

## 14. 建议的 Phase 2D Roadmap

### Phase 2D-1 — Projection Event Domain Contract

已完成 DTO、validator、normalizer、mechanism timing、identity fingerprint、
lifecycle operation、Floor/Swipe owner 约束和 append-only replay 纯函数；不调用 AI，
不生成随机方向，不注入 Context。

### Phase 2D-1.1 — Multiple Reproductive Sources / Contributor Attribution

本阶段先完成领域审计和契约修订，不接 Runtime、Storage、UI、Context Injection、
Probability、RNG、StateReducer 或 Genealogy。重点是把多来源 exposure、未来生物发展
和 contributor attribution 分成三个独立问题，并为后续实现留下 factual attribution
Event 和 derived candidate view 的接口。

### Phase 2D-2 — Deterministic Eligibility / Evolution Kernel

已完成 `core/projection-eligibility.js` 纯规则层。World Model 的
`projection_rules[]` 定义 mechanism、requirements、Story Time trigger、development
kind、realization/contradiction/expiration criteria。Eligibility 输出
`eligible`、`not_eligible` 或 `unresolved`；Evolution 输出 `keep_active`、`realized`、
`contradicted`、`expired` 或 `unresolved`。该层不创建 Projection、Event、lifecycle
record 或事实，也不使用 AI、Probability、RNG、系统时间或 Persistence。

### Phase 2D-2.1 — World Model Projection Rules Contract

`world_model.projection_rules[]` 是 World Model v1 的正式 Floor-owned 字段。规则是
纯声明式数据，经过 `validateProjectionRule()`、`normalizeProjectionRule()` 和
`normalizeProjectionRules()` 后才能进入持久化模型；重复规则确定性去重，同一
`projection_rule_id` 对应不同规范化内容时 fail closed。规则 identity 由规范化的
mechanism、development concern、development kind、trigger、requirements 和生命周期
criteria 材料稳定生成，不使用 Floor、系统时间、随机数或完整 World Model hash。
Raw World Model/AI rule content 不包含 `projection_rule_id`；该字段只能由 BioWeave
规范化阶段生成，随后作为完整 domain DTO 的受信字段进入验证与持久化。

规则只定义 eligibility 与后续 factual evidence 的生命周期判定条件，不能包含
probability、RNG、Prompt、AI 原文、pregnancy/no-pregnancy outcome 或 executable code。
World Model AI 输出必须先经过解析、schema validation、规则 validation/normalization，
再保存；没有合法规则时 Eligibility 保持无可用规则，不使用现实人类时间 fallback。

### Phase 2D-2.2 — Projection Rule Identity Authority

AI 只输出规则业务内容。`parseWorldModelResponse()` 对 raw rule 禁止
`projection_rule_id`，`normalizeProjectionRules()` 负责 canonical normalization、使用
64-bit FNV-1a stable digest 生成 ID、final validation 和 deterministic dedupe。内部
normalized DTO 必须能由相同 canonical material 复算出相同 ID；Floor、message、Swipe、
content hash、prompt、AI wording 和时间都不进入 identity material。即使出现同 ID 不同
canonical content，Eligibility 仍 fail closed，不使用 last-write-wins。

### Phase 2D-3 — Constrained Projection Generation

已完成生成 Contract 层：`core/projection-generation.js` 只接受 `eligible`
decision，构建有边界的 AI 输入，校验原始 `{development:{kind,description}}`
输出，并由 BioWeave 通过现有 Projection validator 组装 candidate。AI 不生成
identity、owner、evidence、probability、attribution 或 BiologicalEvent；规则、事实、
Floor Version 与 `projection_id` 均来自已验证的领域输入。生成请求有 Chat/Floor/
Swipe/rule/Eligibility stale guard，当前 Character Floor 是 Story Context 上界，
所以最新 User message 不能成为 Projection owner 或 generation context 终点。

本阶段不接自动调度、UI 或 Context Injection 生成；失败和过期结果均 fail closed，
不修改 State、Snapshot、Event 或历史 Projection。已有 candidate 的保存由 Phase 2D-4
独立负责，Context Injection 由 Phase 2E 读取保存后的 View。

### Phase 2D-4 — Projection Persistence / Timeline Read Model

已完成 Floor timeline persistence contract：每个 Character Floor/active Swipe 的
`projection_timeline` 分开保存 `creations`、`evidence_records` 和
`lifecycle_records`。`storage/projection.js` 要求当前 Floor-Version resolver，拒绝
User Floor、非 active Swipe、错误 Chat、stale Version 和无效 owner，并通过一次
Floor save 写入 append-only 记录。`getProjectionViews()` 只聚合 surviving、有效的
Character Floor timeline；Delete 是后续 deletion lifecycle record，Floor/Swipe 删除
会自然移除其记录。Projection 不写 Chat metadata、StateReducer 或 Snapshot。

本阶段不实现自动生成调度、UI 或 Projection generation orchestration；Phase 2E 仅
接入已有 View 的 Context Injection。

Projection 仍不进入 Snapshot；后续只需在不改变本阶段 owner/append-only contract
的前提下接入 Runtime orchestration。

### Phase 2E — Context Injection + feedback loop（已完成本轮）

读取 active Projection read DTO，构建明确非事实、非强制的正文注入；正文后续事实再
回到 Event Analysis。已完成 terminal/contradicted/deleted/stale 排除、固定 slot
覆盖与清理、Character Floor 上界和 Event Analysis 非事实边界。

### Phase 2F — Genealogy

完全独立于本规划。

## 15. 当前产品决定项

实现前仍需产品明确：

1. 第一版 Projection 是否只支持 exposure-driven development，还是同时支持独立的
   medical/parasitic/implantation mechanisms。
2. `development_timing` 的最小时间单位和跨 calendar/domain 的不可比策略。
3. AI generation 是否在 2D-3 才加入，以及是否允许同一 Projection 保留 AI 文本的
   evolution history。
4. `realized` 是否只接受明确 Event type，还是允许 evidence-backed 多 Event criteria。
5. 删除后同一 Floor Version 是否永久抑制自动复生，还是允许用户显式重新生成一个
   新 identity。
6. 一次 Context Injection 的最大 Projection 数量、排序和 token 上限。

## 16. 当前审计结论

构画源码支持以下理解：已有上下文/事实 → 活跃的未来发展暗线 → Desc/Next 注入
后续正文 → 正文自然选择或忽略 → 下一轮继续生成/演化。它不支持把 Line 直接视为
事实，也没有 BioWeave 式 BiologicalEvent/StateReducer 闭环；后者是本规划对 BioWeave
现有架构的组合推论。

本文件当前记录 Phase 2D 与 Phase 2E 已完成的 domain、persistence 和 context contract。后续继续遵守 Floor State
Ownership Contract、BioWeave Data Lifecycle 和 Phase 2C Snapshot cache-only 约束。

## 17. Phase 2D-1.1：Multiple Reproductive Sources / Contributor Attribution

### 17.1 三个独立问题

1. **Exposure Fact**：谁和谁之间实际发生了什么 pregnancy-relevant mechanism，属于
   BiologicalEvent factual layer。现有 Event 已有 `gestational_subject_ids`、
   `counterpart_ids`、`pregnancy_relevance.relevant`、reproductive mechanism、
   Story Time 和 Floor provenance；这些字段表达 exposure，但不表达 episode contributor
   已被确认。
2. **Pregnancy / Biological Development**：gestational subject 后续发生了什么，属于
   StateReducer 和 Projection 的发展问题。
3. **Contributor Attribution**：某个 factual pregnancy episode 与哪些历史 source
   exposure 存在实际贡献关系，是独立的关系事实/聚合问题。

不使用 father 作为领域概念。建议后续使用：

- `ReproductiveSourceCandidate`：从有效 exposure、mechanism compatibility 和当前
  endpoint 动态派生的 source candidate。
- `ReproductiveContributor`：episode 与 source entity 的关系记录，可以是 genetic、
  magical、parasitic、implanted、technological 或 World Model 定义的其它贡献类型。
- `ContributorAttribution`：对一个 pregnancy episode 聚合 confirmed、excluded 和
  unresolved 关系的领域视图。

### 17.2 candidate、confirmed、excluded、unresolved 的归属

- `candidate`：不是永久 factual Event；它是当前有效 exposure history + World Model
  compatibility 动态派生的关系视图。
- `confirmed`：是事实关系，必须由正文可靠陈述经 Event Analysis 产生 attribution
  Event。
- `excluded`：也是事实关系，必须由正文可靠排除证据经 Event Analysis 产生 attribution
  Event。
- `unresolved`：是合法的当前聚合状态，表示已有 candidate 但没有足够事实确认或排除。

B/C/D 都可继续保持 candidate；不能按时间、性别、现实规则、最近 exposure 或概率
自动选择任何一个。

### 17.3 Event Contract 选择

当前 Event Contract 足以表达 E1/E2/E3 exposure，但不足以表达“C 是 Pregnancy P1
的 contributor”这一后来出现的关系事实，因为 exposure 的 `counterpart_ids` 不等于
episode attribution。

比较结果：

- 扩展既有 exposure Event：会把 exposure 与后来确认关系混在一个 Event，难以表达
  多 contributor 和独立排除，不推荐。
- 新增专门 attribution Event：推荐。概念类型可命名为
  `reproductive_source_attribution`；其 payload 应绑定 `pregnancy_id`、subject、
  source/contributor identity、contribution kind 和 `confirmed | excluded` fact，且
  保留自己的 Story Time 与 Floor provenance。
- 从已有 Event 组合 deterministic derive：只能产生 candidate，不能产生正文后来
  明确的 confirmed/excluded relationship；不适合作为事实来源。

因此 Phase 2B 后续最小修改是增加专门 attribution fact contract 的设计入口；本轮
不修改 `core/events.js`，不新增 Event type。

### 17.4 StateReducer 与 Pregnancy Episode

Current State 可以在未来保存 episode 的 contributor attribution aggregate，例如：

```js
pregnancy: {
  episodes: {
    [pregnancy_id]: {
      contributors: [
        {source_id, contribution_kind, status: 'confirmed'},
        {source_id, contribution_kind, status: 'excluded'},
      ],
      attribution_status: 'unresolved',
    },
  },
}
```

这里的 `confirmed/excluded` 来自 factual attribution Events；`candidate` 不应永久
写成 factual State，而应由有效 exposure + mechanism compatibility 在当前 endpoint
动态派生。一个 episode 可同时存在多个 confirmed contributors，也可表达多个
contribution kinds；不建立单一 source/father 字段。

### 17.5 Projection identity 与 exposure set

生物发展 Projection 围绕 subject、`projection_rule_id`、development concern 和
机制规则 scope，不围绕单一 source。E1/E2/E3 若共同支持同一发展 concern，应合成一个
Projection；不同发展 concern 或互不兼容机制才拆分。不同 mechanism 若 World Model
明确允许共同导致同一 concern，可以由同一 Projection 聚合，但保留各自 provenance。

`source_event_ids` 是 provenance/evidence，不是 identity。新增 E4 时不修改旧 Floor
或旧 Projection；当前 endpoint 聚合新的 evidence/candidate，必要时追加 evolution/
evidence record。只有 rule identity 或 development concern 实质改变时才创建新
Projection identity。

### 17.6 World Model 与正文事实边界

World Model 负责声明 mechanism compatibility、contribution kind、多个 source 是否
可共同参与以及 candidate eligibility。它不选择实际 contributor，也不提供概率事实。

未来 Context Injection 应表达：当前有多个 compatible source candidates，attribution
仍 unresolved；正文可以自然发展检测、确认、排除或继续未知，不得把任一 candidate
写成 confirmed。正文不是被询问后随机裁判，而是事实来源；正文出现可靠确认/排除后，
Event Analysis 才生成 attribution Event。

### 17.7 Genealogy 边界

Phase 2F Genealogy 只消费已解析的 confirmed contributor relationships，并允许
unresolved/unknown 结果。Genealogy 不回看 NSFW exposure 历史自行猜测来源。Phase 2D
和 Phase 2B 至少需要留下稳定的 episode、subject、source identity、contribution kind、
confirmed/excluded status、Story Time 和 Floor provenance 接口。

### 17.8 Rule identity 与 lifecycle chronology 修订

`projection_rule_id` 必须成为 identity 的明确组成部分。它应由 mechanism rule、
development concern 和 projection contract version 形成稳定 fingerprint；同一 rule
下新增 exposure 不产生 identity conflict，rule 本身改变才产生新 identity。

Lifecycle chronology 不再比较 `swipe_id`、`content_hash` 或 `message_version` 的大小。
纯聚合 API 应接收 Character Floor resolver 提供的 ordered surviving timeline，每个
entry 已经完成当前 Chat、active Swipe、完整 Floor Version 和 owner validity 检查；
聚合器只按该 timeline 顺序折叠，不把版本字段当作业务时间。

Delete 与 factual lifecycle 分离：`deleted` 是停止 active/context 的 user lifecycle
record；`realized`、`contradicted`、`expired` 是 factual/development lifecycle。二者
可以并存。若同一 timeline position 出现互相冲突的 factual actions，返回 conflict
并保持 unresolved/error，不能使用 arbitrary enum precedence。

### 17.9 Phase 2D-1.1 实施范围与结果

本轮实现只修改 Phase 2D-1 Core/domain contract 和定向测试，范围为：

- 引入 `projection_rule_id` / `development_concern_key` 的 identity contract。
- 将 source Event 集合降级为 provenance/evidence，不再直接决定 identity。
- 增加 `ReproductiveSourceCandidate` / `ContributorAttribution` 的纯 DTO 或 read
  contract，不写 factual attribution Event。
- 在 `core/events.js` 建立 factual attribution Event 的最小 validator/normalizer contract，
  但不接入 Runtime/StateReducer。
- 将 lifecycle aggregation 改为 ordered surviving Character Floor timeline 输入。
- 分离 factual lifecycle 与 user deletion，冲突返回 conflict，不静默 precedence。
- 补充 E1/E2/E3、多 contributor、unresolved、E4 新增、删除 Floor 恢复和跨机制聚合
  的纯测试。

不修改产品 UI、Snapshot、StateReducer、Probability、RNG 或 Genealogy；本轮只实现
已有 Projection View 的 Runtime Context Injection，不接自动 Projection generation
cadence。

## 10. Phase 2E Context Injection Contract

Runtime 通过 `storage/projection.js` 的 `getProjectionViews()` 读取当前 Chat
的 canonical Character Floor timeline，限定到当前有效 Character Floor，随后由
`core/projection-context.js` 过滤 `context_visible`、去重、稳定排序并构建无存储
元数据的 Context DTO。Context DTO 仅包含 subject、development kind、未来可能
方向、机制背景和可选 attribution 摘要。

`runtime/projection-context.js` 使用统一的
`bioweave_projection_context` slot 调用 SillyTavern `setExtensionPrompt()`：
position `IN_CHAT`、depth `4`、role `SYSTEM`、scan disabled。每次刷新覆盖该
slot；无 Projection、无 Character Floor、读取失败、Chat/Swipe/Version 变化或
销毁时清空。`realized`、`contradicted`、`expired`、deleted、conflicted 和 stale
View 不进入 Context。

Projection prompt 只表达可能的发展方向，不宣布 factual pregnancy、contributor
或其它 BiologicalEvent。正文是否实际实现，必须由下一轮正文和 Event Analysis
重新建立事实；Projection prompt 自身不能成为 analyzer evidence。
