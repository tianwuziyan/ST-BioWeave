# Pregnancy Lifecycle Archive & Release

## Goal

补齐 participant aggregation lock 上线所依赖的妊娠生命周期事实识别、证据归档、旧 Exposure 退出、锁定释放和跨周期隔离能力。交付物是可经用户审阅的 PRD、技术设计和实施计划；本轮保持 planning，不开始实施。

## 用户价值

妊娠实际结束后，系统能够在不改写历史 Floor 快照的前提下，先独立保存仍有业务用途的候选人与证据，再从当前 Character Floor 的完整 Event 快照中精确删除旧 cycle Exposure，验证删除后的快照并释放仅属于该 pregnancy/cycle 的锁，使新周期可以独立开始。只有完整链路通过统一门禁，才允许启用 aggregation 后的 Exposure 写入过滤和 `updateEvent` 编辑锁。

## 已确认的现状事实

- `core/events.js:13-30,56-72` 已有 `conception`、`pregnancy_confirmation`、`pregnancy_loss`、`abortion`、`delivery` 等 Event 类型，`state_fact` 是非 Exposure 事实的 canonical envelope；`pregnancy_relevance` 仍是 Exposure 的唯一事实源。
- `core/events.js:443-481` 现有 state-fact payload 只允许最小的 `pregnancy_id`，`labor_id`、`delivery_id` 等类型字段；没有统一 lifecycle status、`cycle_id`、not-pregnant 或 outcome-unknown payload。
- `runtime/character-event-analysis.js:37-86` 会依据 AI 的 `pregnancy_ref` 生成或复用确定性 `pregnancy_id`，生成材料包含 Floor Version、Event ordinal、subject 和 fact kind；没有生成或持久化 `cycle_id` 的 lifecycle binding。
- `core/state.js:104-132,450-535` 的 Pregnancy Episode 目前只有 `unknown/suspected/confirmed/ended`，loss/abortion/delivery 会进入 `ended`，但不能区分 miscarriage、termination、delivery，也没有 `pregnant_ongoing`、`outcome_unknown` 或冲突释放门禁。
- `core/tracking-window.js:11-23,80-109,122-134` 按 subject/mechanism/first exposure 建立 `cycle_id`，confirmation/loss/abortion/delivery 作为 Window terminal reason；`expired` 只代表 horizon 到期，不能代表 confirmed-not-pregnant。
- `core/projection-timing.js:86-131` 的 `cycle_id` 与 Timing Instance 由第一条 exposure 的稳定事实确定，并冻结 effective min/max、offset、config snapshot；不得由 lifecycle archive 重新抽样或重置。
- `core/participant-aggregation.js:12-18,55-80,143-204` 已有独立 aggregation DTO、`accepted_exposure_event_ids`、participant mapping、Projection evidence 比对和幂等聚合；它只会从当前完整 Event snapshot 重建名单。
- `storage/participant-aggregation.js:13-50` 已通过 active Swipe、完整六字段 Floor Version、当前版本 resolver、Floor Persistence Coordinator 写入并 readback；`storage/schema.js:745`、`storage/lifecycle.js:138-168` 已登记该 sibling root。
- `core/participant-aggregation-lock.js`、`runtime/character-event-analysis.js`、`runtime/event-editing.js` 和 `runtime/events.js` 已提供 test-only cycle-scoped lock capability；默认 capability 仍为 `false`，生产 gate 仍为 `disabled_until_lifecycle_archive_release`。真实 Runtime 测试覆盖新 NSFW 过滤、locked updateEvent 拒绝和 deleteEvent 放行。
- `.trellis/spec/domain/event-pipeline.md:654-679` 要求只有 confirmed Event 可改变 factual Pregnancy Episode，probable/ambiguous/negated/fictional 不得改变事实状态，并明确 exposure、confirmation、labor、delivery、postpartum、termination 分层。
- `.trellis/spec/domain/floor-state.md:237-244` 与 `docs/bioweave-data-lifecycle.md:639` 要求 aggregation 是 exact Character Floor/active Swipe-owned sibling root；当前代码不能用 Chat cache 或后续 Floor 合并历史事实。
- `core/tracking.js:467-479,519-526` 当前只从当前有效完整 Event 集合及 `openWindowExposureIds()` 建立 Exposure/Tracking registry；`core/tracking-window.js:382-388` 只把 `status=open` Window 的 `source_event_ids` 视为 active。它不会替代当前 Floor Event 删除，删除后必须从新完整快照重建。
- `storage/store.js:864-900` 与 `runtime/event-editing.js:276-301` 支持读取/替换当前 Floor 的完整 `events[]`；现有 Event delete 路径也会通过 `commitFloorPatch` 保存删除后的完整数组并刷新派生 Tracking。Lifecycle release 必须复用该 Floor-owned complete snapshot 写入/readback 语义，不能只隐藏 read model。
- 当前 Event Schema 没有独立持久化 `nsfw` flag 或通用 NSFW Event 枚举；可验证的业务边界仍是 `sexual_activity` 加上 `pregnancy_relevance`/subject-local participant contract。锁定实现必须在此边界上继续细分 cycle，不得把所有 Event 或所有 `sexual_activity` 无条件锁定。

## 本任务范围

1. 设计 ST 明确事实驱动的 lifecycle fact contract，覆盖 `not_pregnant`、`pregnant_ongoing`、`miscarriage`、`termination`、`delivery`、`outcome_unknown`。
2. 明确 canonical payload、pregnancy/cycle identity、证据引用、幂等、冲突和状态转换规则。
3. 设计 pregnancy-specific archive/release Floor-owned persistence，包括候选名单、accepted Exposure IDs、participant mapping、Projection evidence 和 source provenance 的归档。
4. 设计严格顺序：lifecycle fact 确认 → 独立保存必要且最小化的候选信息 → 当前 Floor 完整 Event 快照精确删除 → Event 快照 readback → cycle-scoped lock release → release readback，并设计每个失败点的可重试恢复。
5. 设计 C001→C002 跨周期隔离和统一上线门禁；C001 father unknown 不阻止 C002，C002 不继承 C001 候选、aggregation success 或 lock。
6. 只规划后续生产实现、测试和真实 ST host acceptance；本轮不写生产代码、测试或业务规范。

## 明确非目标

- 不执行 `task.py start`，不进入 implementation。
- 不启用 Exposure 写入过滤，不启用 `updateEvent` 编辑锁。
- 不实现父方追踪、awareness、father status、父方 UI 或父方剧情调度。
- 不从 Timing、Story Time 跨度、Projection AI 或 father unknown 推断妊娠结束。
- 不修改历史 Floor 快照，不建立 Chat-level Event/Exposure 事实源，不 commit、push 或切换分支。

## 生命周期事实要求

- 事实来源必须是当前有效 Character Floor/active Swipe 中，由 Event Analysis 识别的 ST 明确剧情事实；仅 `confirmed` 可产生状态转换。
- `pregnant_ongoing` 只能由明确确认仍在妊娠中的事实产生；`pregnancy_confirmation` 不得自动推断 delivery 或终止。
- `miscarriage`、`termination`、`delivery` 是不同终止原因；不得将三者压缩为一个不可解释的 terminal 枚举。
- `not_pregnant` 与 `outcome_unknown` 不得删除历史 Floor；前者必须绑定当前判定 `cycle_id`，不得因为统一结构而 materialize 一个已确认的 `pregnancy_id`，并应精确删除该 cycle 的旧 Exposure Event、保存删除后的完整当前 Floor 快照、清理不再需要的 cycle aggregation candidate data、释放 cycle lock；后者保持锁定/未归档并等待新明确事实。
- 明确 `pregnant` 后，妊娠期间保留该 cycle Exposure；只有 ST 明确确认 `delivery`、`miscarriage` 或 `termination` 后，才执行同样的精确 Event 删除、完整快照保存/readback 和 cycle lock release；不要求 father status 已确认。
- 同一 pregnancy/cycle 的 contradictory terminal facts、身份不匹配、缺少有效 Floor provenance 或无法确认 source Event 时 fail closed：保留证据和诊断，不执行 archive/release。

## 失败分类与恢复契约

规划必须区分以下 failure class，不能把技术失败写成永久人物锁定：

| Failure class | 业务含义 | 处理 |
| --- | --- | --- |
| `fact_conflict` | 同一 identity 出现不可调和的 lifecycle facts | 保留所有证据，禁止 archive/release；等待新的明确事实或人工诊断，不自动选择最后写入 |
| `event_analysis_failed` | AI/parser/normalization 未产出可信 confirmed fact | 不改变既有 lifecycle/archive/lock；保留旧状态，下一次有效分析可重试 |
| `archive_persistence_failed` | archive snapshot 未确认写入 | 不执行 Exposure exit 或 lock release；使用确定性 archive ID 重试 |
| `archive_readback_failed` | 写入结果无法通过 owner/version/digest readback | 不宣称 archive verified，不释放；保留已写证据并重试/诊断 stale owner |
| `exposure_exit_failed` | archive/候选已保存，但当前 Floor 完整 Event 快照未成功完成精确删除或 readback | 不丢 archive；旧 cycle lock 保持 pending，幂等重试当前 Floor deletion |
| `lock_release_failed` | Exposure exit 已成功，lock release record 未确认 | 不回滚 archive 或历史 Event；按 cycle 重试 release，不能将 pending 技术状态扩大为 subject-global lock，distinct C002 仍可按独立 cycle 判定 |

所有状态转移必须有确定性 operation key、幂等 readback 和可重复执行语义。

## Exposure 删除契约

- 本契约采用真实 Event 快照删除，不接受仅在 Tracking/Projection read model 隐藏 Exposure 的替代方案。
- 删除后必须把完整 `events[]`（允许为 `[]`）写回当前 Character Floor，并 readback 验证。`events: []` 是权威空快照，不得从旧 Floor、未来 Floor、Chat cache 或 registry 继承 Event。
- 删除前必须解析当前有效 Character Floor、active Swipe、完整六字段 Version、`cycle_id` 及精确 Exposure Event IDs；只删除目标 cycle 的 IDs，不误删其它 cycle、人物或非 Exposure Event。历史 Floor 快照不可改写。
- `not_pregnant` 删除当前判定 cycle；confirmed pregnant 后，delivery/miscarriage/termination 删除对应 pregnancy/cycle 的旧 Exposure。删除后清理不再需要的 cycle-scoped aggregation candidate data，但独立仍有业务用途的 father candidates 不得随意清理。C002 必须使用新的 cycle、Timing Instance、aggregation 和 lock state。

## 父方候选名单生命周期

- ST confirmed pregnancy 后、father source 未确认期间，保留 candidate list、accepted Exposure provenance 和 participant mapping。
- ST 明确确认 father source 后，保留 confirmed attribution/fact，但删除该 pregnancy 的候选名单；不等待妊娠结束。
- 妊娠结束但 father unknown 时，仍删除旧 Exposure、释放 cycle lock；candidate list 必须以独立 Floor-owned pregnancy/father record 继续可读，不能依赖已删除 Exposure 重建。
- 后续父源确认时再删除该 pregnancy 的独立候选名单。已无业务用途的 candidates、participant mapping 和重复 Exposure evidence 必须有明确清理条件，不得永久保留。

## 聚合成功后的 NSFW 锁定

- aggregation success 是停止保存该人物当前 cycle 新 NSFW Event 的触发点；锁定 key 必须是 `(subject_id, pregnancy_id|null, cycle_id)`，不是人物永久锁。
- 锁定期间：该人物当前 cycle 的新 NSFW Event 不保存；已锁定 NSFW Event 不可编辑但始终可删除；无关人物不受影响；医疗、症状、妊娠 lifecycle fact 等非 NSFW Event 不受影响。
- 多人物 Event 必须先拆分为 subject-local slices，再过滤已锁定 cycle；不得按 subject_id 全局过滤，也不得将所有 Event 类型或所有 `sexual_activity` 无条件视为 NSFW Exposure。
- lifecycle archive/release、当前 Floor Event 删除/readback、候选名单独立保留/清理和端到端测试通过前，真实锁定 gate 继续 disabled。

## 统一上线门禁

只有 lifecycle archive/release capability 与 participant aggregation lock 同时满足以下条件，`lifecycleArchiveReleaseReady` 才可被真实运行时置为 true：

- 六种生命周期状态均有 canonical fact、Event Analysis 识别和状态转换测试；
- archive write/readback、旧 Exposure 当前有效集合退出、lock release 均有成功与失败恢复测试；
- C001→C002 场景验证旧候选/accepted IDs/mapping/aggregation success/lock 不会泄漏；
- 历史 Floor、active Swipe、六字段 Version 和 stale async write guard 均通过；
- 明确区分自动化测试与真实 ST Desktop/Tablet/Mobile host acceptance。

## Acceptance Criteria

- [ ] 新 task 保持 `planning`，存在 `prd.md`、`design.md`、`implement.md`，未运行 `task.py start`。
- [ ] 规划文件提供了以上代码、规范和存储边界的实际证据，并区分 confirmed facts、推荐设计和未实现能力。
- [ ] 六种 lifecycle status 均明确事实来源、canonical payload、identity、evidence refs、幂等、冲突、Floor/Swipe authority 和转换约束。
- [ ] 归档顺序与 partial-failure recovery 可测试：候选独立保存→当前完整 Event 快照精确删除→删除快照 readback→cycle lock release→release readback；任何失败均可幂等重试且不丢证据。
- [ ] 归档记录包含当前有效候选、accepted Exposure IDs、participant mapping、Projection evidence 和 Floor/Swipe provenance；历史 Floor 快照保持不变，当前删除后的 `events: []` 不继承旧 Event。
- [ ] C001 Exposure→aggregation success→阻止新 NSFW→not_pregnant→删除旧 Exposure→readback→release→C002 正常记录新 NSFW；以及 pregnant→delivery→同样删除/release→C002 场景完整定义。
- [ ] father confirmed 会删除该 pregnancy 的候选名单但保留 confirmed fact；delivery 时 father unknown 会保留独立候选名单；后续 father confirmed 再删除名单。
- [ ] 已锁定 Event 不可编辑但可删除，多人物 Event 不误伤其它人物，医疗/症状/lifecycle facts 不受 NSFW lock 影响。
- [ ] 真实 Runtime lock capability 已在 Event Analysis 写入入口和 `updateEvent` 入口验证；默认 production gate 仍为 `disabled_until_lifecycle_archive_release`。
- [ ] 手动删除已聚合 cycle 的 Exposure 不会自动产生 release；只有 cycle-scoped archive/delete/readback/release/readback 完成后，后续 cycle 才恢复 NSFW 写入。
- [ ] Projection 超时结束只在 Floor-owned 投递回执、提交后的新正文完整 Floor Version、Event Analysis 成功 readback、明确事实缺失、可比较 Story Time 和冻结 `effective_max` 全部成立后执行；Projection 生成或 `setExtensionPrompt` 返回成功本身不足以触发清理。
- [ ] `participant_aggregation_timeline`、Timing、Tracking Window、Pregnancy Episode、Projection 和新 lifecycle archive/release owner 的边界没有互相替代。
- [ ] task validation 已执行，最终报告包含 task 路径、实际代码证据、待用户确认设计决策、validation 结果及 `git status --short --branch`。

## 待用户确认的设计决策

以下不阻塞本轮规划文件生成，但在进入实现前必须确认：

1. 推荐新增 `pregnancy_lifecycle` canonical factual Event/DTO，兼容映射既有 confirmation/loss/abortion/delivery；是否接受该统一类型，而不是继续为每个旧 Event type 添加分散字段。
2. 推荐新增独立 Floor-owned `pregnancy_lifecycle_timeline`，其中 append-only 保存 normalized facts、独立 father candidate records、archive snapshots 和 release state machine；是否接受该 owner，而不是把候选和 archive 写入 aggregation timeline。
3. `not_pregnant` 的 identity 推荐绑定 `subject_id + cycle_id`，canonical payload 显式使用 `pregnancy_id: null`（禁止 `materializeStateFact()` 生成 ID）；已确认 pregnancy 的其它状态必须绑定 `subject_id + pregnancy_id + cycle_id`。是否接受该 status-specific identity 规则。
4. 发生不可解决的终止事实冲突时，推荐 fail closed、不 archive、不删除 Event、不 release，直到新的明确 ST 事实或人工诊断处理；是否接受该安全策略。
5. 推荐将当前 Floor 的 Event deletion 作为 lifecycle release 的唯一有效 Exposure exit；是否接受不提供逻辑隐藏替代路径。

## 子代 NPC 只读审查补充（本轮不实施）

本轮根据“出生孩子进入 BioWeave NPC/char 体系”的新规则，补充架构审查；不新增生产代码、测试或 canonical schema。

### 已确认的现有架构证据

- `core/identity.js:435-465,508-625` 定义了唯一的 Floor-owned `character_registry`。实体只有稳定 `character_id`、`display_name`、`aliases[]`；ID 由 `allocateSequentialCharacterId()` 生成 `char_000001` 形式，姓名和角色卡 ID 都不是身份键。
- `runtime/character-event-analysis.js:356-618` 负责 response-local mention 到 canonical `character_id` 的 Runtime 解析，并把完整 registry snapshot 写回当前 Character Floor；AI 不得编造 canonical ID。
- `storage/store.js:864-900` 与 `storage/floor-persistence-coordinator.js:11-18` 证明 registry 是当前 Character Floor/active Swipe 的 owner sibling；`storage/schema.js:726-760` 与 `storage/lifecycle.js:108-174` 证明现有生命周期 registry 只登记 `character_registry`、Events、Projection、Tracking、aggregation 和 pregnancy lifecycle roots。
- `core/genealogy.js:1-2` 只有 `sortRelatives()`、`childrenOf()` 查询/排序辅助；`tests/genealogy.test.js:1` 只有排序测试。当前没有亲子关系写入、NPC 创建/更新/删除 Runtime 入口，也没有 genealogy Floor persistence/readback 链。
- `docs/DEVELOPMENT.md` 将 Genealogy 标记为 `PARTIAL`，明确为“core query support and placeholder UI；no relation-data production chain”。当前 Character Card 仅是宿主上下文/来源，不是 BioWeave NPC Registry。

### 当前字段能力与缺口

| 需求 | 当前是否可承载 | 证据/结论 |
| --- | --- | --- |
| 稳定 NPC 身份 | 可复用 | 直接复用 `character_registry.entities[].character_id`；不新增 `child_id`。 |
| 未命名/改名 | 部分可复用 | `display_name: null` 与 `aliases[]` 已支持；但没有孩子出生事实驱动的更新入口。 |
| 种族、性别、年龄 | 不可由 registry 承载 | 需要未来 NPC/Character facts 设计；World Model 的 species/type 不是个体 NPC 档案。年龄应从出生 Story Time 派生。 |
| 出生日期、来源 pregnancy/cycle | 当前缺失 | lifecycle archive 有 pregnancy/cycle provenance，但没有 child/NPC record。 |
| 母亲、父亲、父源状态 | 当前缺失 | `core/reproductive-attribution.js` 只支持 pregnancy subject/source attribution；没有 child identity 绑定。 |
| 多胞胎独立身份 | 当前未接通 | 通用 `character_id` allocator 可分配多个 ID，但没有出生人数确认、稳定绑定或关系持久化。 |
| 父方候选名单 | 当前只属于 pregnancy/cycle | `pregnancy_lifecycle_timeline.candidate_records[]` 可独立保存，但尚无转移到 child NPC 的 owner。 |

### 业务边界

- 孩子出生后应进入现有 canonical `character_id` 体系；角色卡 ID 不得成为 NPC ID。除非后续审查证明现有 registry 无法表达同一 ID 的 NPC 生命周期，否则不创建 `child_id`。
- 只允许 ST 明确的出生事实创建 NPC。预产期、Timing、Projection、候选数量和父源推断不能创建孩子。
- 出生人数明确为一名或双胞胎时，分别分配稳定 `character_id`；人数未知时保存待解析出生事实，不分配固定数量。
- 未命名孩子允许 `display_name: null`；后续命名必须更新同一 `character_id`。多胞胎命名无法唯一绑定时 fail closed，不新建 NPC。
- `miscarriage`、`termination`、死产等事实不得自动创建“存活孩子”；特殊结果必须先有明确的 NPC 状态表达能力。
- 母亲 C001 的 Exposure 删除、cycle release 和 C002 开始不得等待孩子创建、命名或父源确认。

### 建议拆分

建议将“出生子代 NPC、亲子关系、候选转移、出生/命名/父源确认的 Floor 历史语义”拆为独立的 `Pregnancy Child NPC & Genealogy` 任务。本 task 只保留明确的 lifecycle 交接点：delivery 结束母亲 cycle 后，若孩子身份及人数可唯一确定，向后续任务提供 pregnancy/cycle/archive/candidate provenance；若不能确定，母亲 release 仍独立完成，候选不得删除或错误转移。

## 已批准的任务边界与 delivery archive 交接

用户已批准：孩子复用现有 `character_id`，不新增 `child_id`；`character_registry` 只继续承担轻量身份目录职责；NPC profile、出生信息、亲子关系和父方候选归属由独立 Floor-owned 业务数据承载。本 task 不实现上述 child/NPC runtime。

delivery archive 必须向后续子代任务提供以下稳定来源数据：

- 母亲 `subject_id`/`character_id`；
- `pregnancy_id`；
- `cycle_id`；
- delivery source Event IDs 与 source Floor/Swipe Version；
- birth Story Time（若 delivery Event 提供）；
- 明确的出生人数及其 source Event/evidence；
- 明确的出生结局（存活、死产或其它已确认结果）；
- 当前父源确认状态；
- 尚未确认父源时的最小候选来源引用、accepted Exposure provenance 和 participant mapping。

当前 `pregnancy_lifecycle` canonical payload 只定义 lifecycle status、pregnancy/cycle、source Event/evidence 和 Floor Version；`delivery` 旧 Event 也只要求 `pregnancy_id + delivery_id`（`core/events.js:492-494`）。因此 birth count、出生结局、birth Story Time 的 child-specific canonical 字段尚未存在。本 task 不擅自扩张 canonical schema；实现只能归档当前已有的 delivery source/provenance，并将缺失字段标记为交接缺口。后续子代任务必须在新增 canonical 字段获批准后才能消费“已确认出生人数/结局”。

Projection AI 生成成功和 extension-prompt setter 返回成功目前只能证明生成/提交边界，不能证明 ST 模型实际消费；在缺少 Floor-owned submission receipt 与后续正文 ordering 证据前，不得执行“推送后无反馈超时”自动 release。

当前真实 Runtime 已可观察 `GENERATION_STARTED`、`GENERATION_ENDED`、`MESSAGE_RECEIVED`、`CHARACTER_MESSAGE_RENDERED`、完整六字段 Floor Version 和 `EVENT_ANALYSIS_COMMITTED`。但现有 `projection_timeline` 没有把 Projection submission 与后续正文/analysis execution 绑定起来；该最小 Floor-owned delivery/response 记录是自动超时实现前的契约 blocker，而不是要求证明 ST 模型实际阅读提示。

母亲 C001 的 Exposure 删除、cycle lock release 和 C002 开始不等待孩子创建、命名、父源确认或候选转移。父源未知时，未能安全交接的母亲侧 candidate record 必须保留为独立可读证据，但不得继续作为母亲当前活跃妊娠周期的 lock/Exposure 输入。
