# BioWeave 开发规范（轻量模块版）

当前 feature ownership、依赖方向和“Where do I change this?”导航以
[ARCHITECTURE.md](./ARCHITECTURE.md) 为 canonical reference。本文保留开发规则、领域边界和已验证契约；历史 Trellis phase 文档不作为当前模块地图。

## 模块边界

- `core/events.js`：BiologicalEvent 类型、固定结构、normalize / validate / sort；统一拥有 Event 边界，不让 UI 或其它消费者各自解析原始 payload。
- `core/identity.js`：Floor-owned canonical Character Registry invariants、Runtime canonical character ID allocation、existing/new/unresolved identity resolution 和 alias candidate policy；不按姓名建立键，不执行 destructive merge。
- Tracking Registry 领域逻辑：从已验证的 Floor-bound Event 建立/重建 Runtime Tracking Subject 派生索引；只保存稳定人物信息和 `event_id` 引用，不访问 DOM、AI 或宿主。
- `core/state.js`：纯程序 State Reducer，不调用 AI；Phase 2A 不接通完整妊娠状态归约。
- `core/snapshot.js`：检查点与删除楼层后的局部恢复。
- `core/projection.js`：未来软推演数据；不是事实。
- Pregnancy Exposure Tracking Window：规范见 [Pregnancy Exposure Tracking Lifecycle](../.trellis/spec/domain/pregnancy-tracking.md)；当前 `core/tracking.js` 只有按有效 exposure 派生 Subject/Candidate，尚未实现独立 Window lifecycle。
- `core/genealogy.js`：家系查询、世代与排序。
- `ai/client.js`：API Profile 的校验、SillyTavern Secret 引用和宿主代理测试请求；不在浏览器或 Chat 数据中保存明文 API Key。
- `ai/prompts.js`：受保护 Core Prompt + 公共 `analysis_prompt` + 各 Analyzer 的任务/输出 Contract Pipeline。
- `ai/worldbook.js`：世界书枚举/选择/Token 估算。
- `ai/analyzer.js`：World / Floor / Projection 三类 AI 任务；Phase 2A 的 Floor Event 分析必须使用固定 JSON 解析和统一 Event 校验，不能以自由文本作为成功结果。
- `runtime/chat.js`：ChatBoundary。
- `runtime/floor.js`：Floor Version、内容签名与成功版本去重基础设施；自动调度状态由 Runtime 持有。
- `runtime/event-analysis.js`：Event Analysis coordinator；拥有目标 Floor 解析、生产输入构建（含 `getCurrentFloorAnalysisInput()`）、自动/手动调度、去重、提交、状态 DTO、Event CRUD 与 Registry 重建。Prompt Preview 复用该 Runtime 输入，不在 UI 重建 Floor Version。
- `runtime/events.js`：SillyTavern 生命周期事件映射与公开 Runtime Event Analysis API；自动分析在 Runtime 初始化后有效，不依赖 overlay 或 UI subscriber。
- `runtime/world-analysis.js`：World Analysis workflow；`runtime/character-event-analysis.js`：Character/Event Analysis workflow；`runtime/event-editing.js`：Event update/delete；`runtime/tracking-runtime.js`：Tracking refresh orchestration。
- `runtime/generation-lifecycle.js`：generation intent、settle barrier 和 exactly-once handoff；`runtime/sillytavern-adapter.js`：纯 SillyTavern I/O；`runtime/runtime.js`：轻量 composition root；`runtime/diagnostics.js`：diagnostics。
- `storage/store.js`：两级存储统一入口。
- `storage/schema.js`：默认结构和版本，包括 Floor-owned Character Registry 与独立于 Tracking Registry 的 Runtime projection 边界。

### Analysis Context / Prompt Contract

所有新的或调整中的 Analyzer 必须遵守 [`docs/CONTEXT-AND-PROMPT.md`](./CONTEXT-AND-PROMPT.md)，尤其是 Settings selection、SYSTEM 首尾边界、逐楼层 narrative regex 和 Preview parity contract。设置先决定可读取的数据源、楼层数量、regex、Persona、Worldbook 和 External Memory；共享 Collector 完成选择、清洗和脱敏后，任务 Prompt Builder 才能格式化稳定的 `messages[]`。Prompt Preview 必须直接复用真实请求的同一个 message builder。多个 `SYSTEM` message 是合法的，但应按职责聚合，关键是绝对边界、稳定顺序，以及 Preview 与实际请求一致。

Character/Event 与 World Model 是独立业务域，但拆分职责不等于删除人物证据。Event 输入必须保持：

```text
raw/source collection → Character Evidence semantic projection → Character/Event Analyzer
```

Event Analyzer 不直接消费 raw Character Card、Persona、Worldbook 或 External
Memory DTO；Character Card/Persona 的稳定生理证据必须经
`individual_evidence` projection 进入。`identity_context` 只负责 mention
identity，Character Evidence 负责稳定人物事实，persisted `world_model`
负责 species/type baseline。生理性别可参与已有 type mapping，但不得直接推出
capability；Nonhuman 不套 Human baseline，未知保持 `null`。

未来修改 Event Input Boundary、Prompt trimming、World/Event separation、source
isolation、sanitization、module extraction 或 AnalysisInput narrowing 时，必须
保留等价或更严格的 Character Evidence projection，并用最终
`buildEventAnalysisMessages()` 回归验证，而不能只验证 Prompt 文案。
- `story/*`：StoryTimeCoordinator、BioWeave 本地 canonical parser、era-aware 标准月份算术，以及独立的外部记忆适配。`story/time.js` 负责本地 Story Time 归一化、Calendar Engine 接线和 display formatter；`formatStoryTime()` 不从 display 反向推导日期。
- `context/builder.js`：向 Tavern 注入短、稳定、结构化的 BioWeave Context。
- `ui/*`：一个一级页面一个文件；页面只消费 Runtime 传入的 Tracking Registry / BiologicalEvent DTO，不判断生殖资格。

### Data Lifecycle Contract

凡新增或修改 BioWeave 的持久化字段、Floor/Swipe 派生结果或 Runtime
异步任务，必须先阅读并遵守 [`docs/bioweave-data-lifecycle.md`](./bioweave-data-lifecycle.md)。
字段必须登记到 `storage/lifecycle.js`，并同时回答人物/世界/全部清除、普通
`CHAT_CHANGED`、SillyTavern 原生 Start New Chat、消息编辑/删除、Swipe
切换、异步失效和保存失败处理。普通 Chat 切换只加载目标；只有经过一次性
官方生命周期证据配对的 Start New Chat 才会定向清除 source Chat。设置页的
手动清除入口统一位于“数据管理”，UI 只能调用 Runtime/Clear Service。

## 不再继续细拆的规则

新增功能优先扩展已有 feature owner；只在形成独立生命周期、状态/行为边界、public capability 或可独立测试职责时新建 module。不要把新的独立 feature 堆回 `runtime/events.js` 或 `runtime/event-analysis.js`，也不要为单个 helper 创建碎片 module。原则是 **ONE FEATURE OWNER, NOT ONE FUNCTION PER FILE**。修改前先查 [ARCHITECTURE.md](./ARCHITECTURE.md) 的 Where-do-I-change-this 表。

只有文件稳定超过约 500–800 行、出现两个独立职责、或独立测试明显更清楚时才拆。不要建立 event-store / event-validator / event-factory / event-interface 这类碎片目录。

## Phase 2A Event / Tracking 实施契约

Phase 2A 只新增事实提取和追踪索引，不是完整妊娠状态引擎。跨层数据流保持轻量：

```text
当前 Chat / Floor / Recent Story discovery window / World Model / Story Time
  → Event Analyzer raw JSON（existing/new/unresolved mention）
  → Runtime Character Identity resolution / registration
  → Event normalize / validate
  → bounded semantic duplicate guard
  → 当前 active Character Floor-bound BiologicalEvent[0..N]
  → Runtime-derived Tracking Subjects / Candidates
  → Characters / Events / Overview
```

实现时必须保持以下边界：

- 人物列表不是当前 Chat 的全角色列表，只读取 `tracking_subjects` 中 `eligibility: "eligible"` 的 active Tracking Subject。`BiologicalEvent.participants[]` 对 `sexual_activity` 只保存 actual reproductive exposure chain 的直接参与者，Event Participant 不等于 Tracking Subject；Subject 的进入由 BiologicalEvent、World Model、Narrative Evidence 和 `can_carry_pregnancy` 三态解析决定，pending recipient 保存在独立 `tracking_candidates`，UI 不参与判断。
- BiologicalEvent 是当前范围内实际生物事实（尤其是 pregnancy-relevant reproductive exposure）的单一来源，不是完整 NSFW 行为日志。Subject 只保存 `created_from_event_id`、`exposure_event_ids[]` 等 Event 引用和必要索引，不复制完整 Event；稳定关联使用 `character_id`，不用姓名。
- Event discovery window 与 persistence owner 独立：Current Target Floor 与 bounded Recent Story 都是允许产生 Event 的 narrative evidence；Recent Story 历史 Event 保留自己的 `story_time`，但本轮新发现结果统一写入当前 active Character Floor/Swipe，canonical `source` 仍表示当前 persistence owner。Event Analyzer 输入至少覆盖 Current Chat Scope、Current Floor Version、当前 Floor Narrative、必要最近上下文、persisted canonical World Model、结构化 Story Time、`identity_context`、经过 source-specific projection 的 Character Evidence (`individual_evidence`) 和 bounded existing Events。输出只能是固定 `{schema_version, events[]}`，每个 Target Floor Version 允许 `events.length >= 0`。对于 pregnancy-related `sexual_activity`，AI 先识别整个 discovery window 内所有实际暴露的 gestational subject，再按 subject 分组；每个 Event 恰好一个 subject，同一 subject 的多个 actual exposure source 合并，不同 subject 分 Event。即时症状、physical effect 和相关证据仍并入同一 subject 的 sexual Event；其它真正独立的 BiologicalEvent 可以并存。只有通过统一 normalize / validate 和 deterministic semantic duplicate guard 的结果才能写入 Floor。raw Character Card、Persona、Worldbook 和 External Memory 仍可保留在 Runtime wide DTO 供 World/legacy orchestration 使用，但不直接进入 Event prompt。Character Card/Persona stable evidence 不得因此丢失。
- 每个已确认 Event participant 都必须执行人物 biological analysis，不论 `pregnancy_relevance.relevant` 是 true 还是 false。顺序固定为 identity → Character Evidence → species → species 内 biological_type → exact persisted World Model species/type → baseline capability → explicit individual capability evidence → participant facts。`pregnancy_relevance` 只描述当前 Event 是否与受孕/妊娠有关；它不是跳过 participant facts 的条件，也不能由人物 capability 反推为 true。gender/sex 只能帮助已有 type mapping，不能直接推出 capability；证据不足、冲突、缺失 World Model type 或 capability 未知时保持 `null`。Tracking 只消费最终 participant facts，不能弥补 Event Analyzer 缺失的人物分析。
- Event Analyzer 另外接收独立的 Runtime identity projection。participant 的 `identity_status` 必须是 `existing`、`new` 或 `unresolved`；模型只能原样引用 projection 中的 existing ID，new/unresolved 使用 `character_id: null` 与 response-local `mention_id`。Runtime 完成 identity resolution/registration 后，才将 mention/reference 转为 canonical IDs 并执行 participant-backed pregnancy closure。完整 `character_registry`、Tracking Registry 和 raw character context 都不是 Event prompt 的输入；canonical/derived individual evidence 只保留必要的 profile/state/evidence 字段。
- mention resolution、alias discovery、alias persistence 必须分离。正文共现、连续性和高置信度 mention 不自动学习 alias；只有明确“叫我/小名/众人称为/真名揭示”等 establishment evidence 才可提出 candidate，Runtime 才能决定写入。alias 不唯一，碰撞无上下文时 unresolved。新人物 ID 只能由 Runtime 的 canonical allocator 生成，不能从姓名、UUID、时间或随机值派生；AI 不依赖固定 ID 或 mention token 格式。
- `source` 由分析调度器强制绑定 `chat_id`、`message_id`、`floor`、`swipe_id`、`content_hash`、`message_version`，不信任模型返回的跨 Chat/Floor/Swipe 身份。存在 swipe 结构时 Event 只写对应 `message.swipe_info[swipe_id].extra.bioweave`，包括 swipe `0`；没有 swipe 结构时才使用 `message.extra.bioweave`。同一 Floor Version 的新分析可写入 0/1/N 条 Event；每条通过 subject-local 结构校验，重复 subject 或非法闭包在 AI/Domain boundary 失败，不保存半正确结果。
- `story_time` 是结构化对象；`display` 只用于显示。Floor 的 trusted candidate 由 StoryTimeCoordinator 提取，日期和传统时辰由 BioWeave 本地 parser 归一化，排序和计算只使用结构化字段，无法可靠获取时保存 `null`。
- `counterpart_ids` 与 `gestational_subject_ids` 永远是数组，可为 0/1/N；Event type 保留现有其它类型兼容，但本阶段以 pregnancy-relevant exposure 作为 Tracking gate。
- `counterpart_ids[]` 只保存该 Event 的 `participants[]` 中最终实际造成该 gestational subject pregnancy-relevant exposure 的 source ID；不能跨 subject 或跨 Event 借用 source。对于 pregnancy-related `sexual_activity`，subject 数组严格一个、counterpart 至少一个、participants ID 集合严格等于 subject + counterpart 且各自去重；`relevant=true` 必须有 pregnancy-relevant exposure evidence、participant-backed 的数组和 `source_evidence` 中 kind 为 `pregnancy_relevant_exposure` 的 marker。无实际暴露的 `sexual_activity`（若保留）不保留 participants，使用两个空数组和两个 false 标记。
- `existing_bioweave` 保持最近合法前置 Floor snapshot 语义；`existing_events` 额外覆盖 Recent Story discovery window 内的合法 active canonical Events，用于 semantic dedupe，不扫描无界 Chat 历史，不读取 Chat metadata/cache，不包含 target 自身旧结果、删除/失效 Swipe 或 stale Floor。去重要求 Event type、structured story_time、canonical participant/subject/counterpart 集合、机制、关键 source evidence 与 state fact 完全匹配；缺字段、不同 type、不同 subject/source、不同机制或不同事实 evidence 时保留两个 Event。不得使用模糊 AI 相似度 dedupe。
- `true`、`false`、`null` capability 三态不可压缩；当前解析不得把 `null` 当作 `true` 或 `false`，后续可信 World Model/profile/narrative 更新可以重评 pending candidate；`can_be_fertilized` 不能单独授权承孕追踪。不以 gender、receiver、攻受、姓名或 NSFW 单独推导 Subject。
- StateReducer、Snapshot、Projection、Genealogy、完整妊娠计算、Gestational Age 和预计分娩日不在本阶段接通；对应页面/领域模块保持空状态或兼容骨架。
- Tracking Window 尚未实现：当前 exposure 聚合没有 round identity、open/closed/expired 状态、Story Time horizon 或关闭后过滤；`core/state.js` 的 `elapsed_story_days` 只描述 State 派生值，不能冒充 Window expiration。Projection 的 `realized/contradicted/expired` 也属于另一生命周期。

### Floor / Swipe / Version 生命周期

自动分析按新的有效 Character Floor counter 运行；User、编辑、删除、普通 update/received/ended 和 existing Swipe 切换不推进或强制请求。reroll/new Swipe generation 只有在真实 intent 形成新 Floor Version 后才进入 force path。完整状态机、失败欠账语义、World retry 和 Runtime state 生命周期见 [Auto Analysis Scheduler Architecture](./AUTO-ANALYSIS-SCHEDULER.md)。

World Full/Patch 在当前 Floor read-back 与共享 World canonical view-model 未达到 `WORLD_READY` 前，不得调用 Character/Event。Runtime 发布 World/Event 阶段状态，UI 据此分别显示 World Full/Patch/read-back busy 或人物等待/分析状态；最终 terminal status 由 `ui/app.js` 统一转为 SillyTavern toastr。面板关闭不影响通知，插件关闭后忽略迟到结果。

删除 Floor、切换 Swipe、Event 编辑/删除或 Chat 切换后，Runtime/Storage 必须以当前有效 Floor-bound Event 重建 Registry，不留下 dangling `event_id`。Event 删除是真删除，不新增 `user_override` priority layer。失败分析不得写入半结构化 Event。

### World Analysis Runtime 能力边界

World Model / World Analysis 的完整 canonical 规则见
[`../.trellis/spec/domain/world-model.md`](../.trellis/spec/domain/world-model.md)。
Full 是 `permitted evidence → World Fact Discovery / scope / classification → complete
canonical model`，不消费 Existing World Model baseline；Supplement 是 `Existing
canonical model + 同一 permitted evidence set → hierarchical Candidate text →
deterministic Candidate → internal Patch v2 → Guard → merge → complete canonical
validation`。Existing baseline 只是 comparison baseline，不是 evidence；Supplement
eligibility 不由事实是否首次出现在 current Floor 决定。

Supplement 只产生 presence-sensitive Candidate；deterministic Candidate →
internal Patch v2 负责字段比较、分类与 mutation IR。Candidate 的 omission
不表示 REMOVE，canonical null/boolean/`"无"` 语义仍由现有 validator 与 merge
边界维护。不得借此重写 Full evidence collector、Human baseline、Fact
Discovery、UI read model 或既有 World canonicalizer。单一 character evidence
也不得自动提升为 species/type world rule；具体执行合同以 canonical spec 为准。

World Analysis 只有两套底层能力：Full World Analysis 与 World Supplement Analysis。Initial Full、Manual“开始分析”和 Auto 在没有有效 World 时都调用同一个 Full 能力；Manual“补充分析”和 Auto 在存在 world-relevant 新证据信号时都调用同一个 Supplement 能力。该触发信号不改变 Supplement 的事实 eligibility：Supplement 仍重新审阅完整允许的 World Analysis evidence，既可补充较早资料中已存在但之前遗漏的事实，也可处理新近 evidence。已有 World 且没有 world-relevant 新证据触发信号时，Auto 不调用 World AI，直接 Reuse 已验证的 World 后再进行 Character/Event Analysis。Scheduler 只负责调用时机和 Reuse 路由，不拥有 Full/Supplement 的业务语义。

世界页的“开始分析”始终强制 Full，“补充分析”始终强制 Patch；两种手动操作只保存 World，不继续 Character/Event。Manual/Auto Full/Patch 共享 Runtime World-specific Floor-Version single-flight，避免同一 `chat_id`、`message_id`、`floor`、`swipe_id`、`content_hash`、`message_version` 发出第二个 World API 请求或产生并发 World persistence。所有结果仍只能 forward-only 写入当前有效 Character Floor，经过 canonical validation 与 stale guard；历史 Floor、User message 和 Chat-level World fallback 不可修改或持有事实。

### Event Analysis Runtime API

`createRuntime()` 对 UI 暴露 `analyzeCurrentFloor({force})`、`analyzeCurrentCharacterEvents()`、`analyzeFloor(target, {force})`、`refreshCurrentFloorAnalysis()`、`requestAbortCurrentFloorAnalysis()`、`getCurrentFloorAnalysisStatus()`、`getCurrentFloorEvents()`、`getTrackingRegistry()`、`collectActiveBusinessData()`、`updateEvent()` 与 `deleteEvent()`。当前楼层始终是当前 Chat 最后一条消息的 active Swipe；指定消息优先按稳定 `message_id` 匹配，不能直接假定 lifecycle payload 的 `message_id` 是数组下标。

### Manual Analysis Boundary

Manual World Full/Patch 只执行 World Analysis，不进入 Character/Event stage。
Manual Character 通过明确的 `analyzeCurrentCharacterEvents()` 入口执行：它只
调用 `runtime/world-analysis.js` 的只读 persisted World prerequisite，按现有
at-or-before、active Swipe、六字段 Floor Version、invalidated Floor 和
canonical World UI-ready 规则复用 World；它绝不调用 World Full/Patch 或
`resolveFinalWorldModelForAnalysis()`。缺少有效 World 时返回
`WORLD_MODEL_REQUIRED`（`prerequisite_failed=true`、不可重试），不提交 Event
patch，也不写 terminal failure；UI 提示用户先完成世界分析。

该入口仍复用共享 execution、取消/supersede、Floor currentness 和 Event retry
机制。AUTO 路径继续由 `runAnalysis()` 负责 World reuse/full/patch 后再进入
Character/Event Analysis。Event Input Boundary 已实现：World Analyzer 继续读取 raw world sources；Character/Event Analyzer 只读取 narrow semantic projection。未来修改输入边界时，先更新 `docs/CONTEXT-AND-PROMPT.md` 与本文件，再补充 prompt/input regression tests。

`collectActiveBusinessData()` 的 `analysis_status` 至少包含 `state`、`busy`、`current_floor`、`floor_version`、`attempt`、`last_success`、`last_error`、`event_count`、`active_event_count`、`sexual_activity_count`、`tracking_subject_count`、`tracking_candidate_count`、`pending_tracking_candidate_count`、`current_floor_events`、`active_events`、`tracking_decisions` 与 `registry_summary`，并在有执行记录时提供 `error_stage`、`error_code`、`safe_error_summary`、`started_at` 和 `finished_at`。其中 `tracking_decisions` 是 Core/Runtime 诊断兼容数据，不是人物业务实体，普通 Characters UI 不消费它。`running` 只存在于 Runtime transient execution，不作为持久历史状态；终止分析使用 Runtime AbortController，迟到结果不能写回 Floor 或 Registry。该 DTO 只包含结构化、可脱敏显示的数据；Raw AI Response 与 API Secret 不写入 Chat。

UI 只能调用这些 API 并显示 busy/success/error。不得在 `ui/app.js` 或页面模块重新实现 Floor Version 有效性、Event normalize/validate、Tracking eligibility 或 Registry rebuild。强制刷新失败时，Runtime 写入失败状态，但保留同一 Floor Version 的上一份成功 Events；UI 不清空事件或人物。

### KNOWN-GOOD Floor Persistence Mainline（Frozen Boundary）

当前已经通过真实 SillyTavern World/Event 与 F5 durability 验证的普通
Floor persistence mainline 必须视为冻结行为，而不是可顺手重构的基础设施。
普通 World、Event/Character、Projection、Manual World 和获准的 Terminal
写入统一遵循：

```text
owner-scoped patch
  → storage/floor-persistence-coordinator.js
  → latest authoritative Floor merge
  → host sync + official save
  → authoritative readback + sibling audit
  → confirmed
```

`runtime/floor-persistence.js` 只是 compatibility re-export，不是第二套
persistence implementation。冻结范围包括 owner allowlist、同 Floor 串行、
当前 message/Swipe/Floor Version 校验、latest merge、sibling preservation、
host-ahead bootstrap、official readback、confirmed 定义、terminal supersede、
cancel/supersede guard，以及 Swipe 0 规则。`saveChat()` 或
`saveChatConditional()` 的 Promise resolve 不能单独证明 durable persistence。

World Analysis、Event Analysis、Character Analysis、Prompt、Input Builder、
UI 或 Tracking 任务不得顺手修改这条 mainline。只有新的真实 SillyTavern
Trace 直接证明 persistence defect，或明确的 persistence 需求变化，才可
创建独立 persistence root-cause task；该任务必须独立说明根因、补充
persistence regression tests，并重新执行 World + Event F5 durability 验证。

明确的 Chat/source clear、lifecycle root invalidation、migration/restore、
Chat metadata/settings save 和 Auto prerequisite host lifecycle/save boundary
属于 special operation 或 host boundary，不得被误判为 ordinary Floor writer，
也不得成为 ordinary owner patch 的绕过路径。

### 页面职责

`ui/characters.js`、`ui/events.js` 和 `ui/overview.js` 只负责展示或提交业务 DTO：人物列表只枚举 `tracking_subjects`，人物详情展示可用物种/生理类型、已知 capabilities、受孕相关记录和“等待状态引擎计算”；普通 Product UI 不渲染稳定 ID、Source、Floor Version、hash、Registry Summary 或 raw schema/debug 字段。事件页展示真实 Event 的用户可读类型、Story Time、Location、妊娠追踪对象、相关对象、Status、Confidence 和用户可读证据；妊娠相关 `sexual_activity` 不在普通卡片单独重复显示完整 participants，相关对象只由 `counterpart_ids[]` 投影。编辑表单与普通卡片分开，必要的只读 Event ID 可仅用于编辑操作。人物 exposure card 不读取 protection、physical_effect、capability、event_role 做判断；总览统计分别来自 Registry 与当前有效 Event。页面不伪造 probability / gestational age，也不根据文本重新判断资格。

## 推荐实施顺序

1. SillyTavern Adapter 与 Chat-local Storage。
2. UI Foundation：魔法棒入口、documentElement-level overlay、响应式壳、主题与生命周期。
3. API Profile、Secret 引用与测试连接。
4. BiologicalEvent schema、normalize / validate、结构化 Story Time 与 Tracking Registry 纯逻辑。
5. 固定 Event Analyzer、Floor-bound Event 持久化与 Character counter / Floor Version 生命周期。
6. Event CRUD 和 Characters / Events / Overview 真实 DTO 接线。
7. State Reducer。
8. Snapshot restore、Projection 和 Genealogy。
9. Worldbook + Prompt Pipeline 与后续分析任务。
10. Tavern Context。

## UI Foundation 手工验收

以下步骤需要在更新后的真实 SillyTavern 页面执行。BioWeave 主窗口使用独立高层级宿主；不把“先手动关闭酒馆 drawer”作为打开主 UI 的前置条件。

入口生命周期边界：Host Entry 是 BioWeave 的宿主可见性边界，只依赖宿主 `document`、`#extensionsMenu`、`MutationObserver` 和 UI shell 的打开回调，不读取 Chat、Floor、Swipe、Event、World Model、State、Snapshot、Projection、Projection Context、API 或 Storage。BioWeave 先挂载 UI shell 并注册 `#extensionsMenu` 入口，再初始化 Runtime；业务 Runtime 初始化失败不得导致插件入口消失，Host Entry 不以业务数据是否可用作为注册条件。Projection Context 注入属于可选宿主能力；没有 `setExtensionPrompt` 或注入失败时只返回 `unavailable`，不阻断 Runtime 初始化，也不移除菜单入口。Runtime 初始化失败时仍保留菜单入口和 UI shell，业务页面使用现有空状态/错误状态。

### Desktop（>= 1200px）

1. 点击输入区附近的魔法棒。
2. 在 `#extensionsMenu` 点击 BioWeave。
3. 确认出现左侧完整导航和多人总览；关闭后再次从同一菜单打开。
4. 确认总览、人物、事件、推演、家系、世界模型、设置均可进入，并切换跟随酒馆、日、夜主题。

### Tablet（768–1199px）

1. 将窗口或 iPad viewport 调整到约 1024×800。
2. 重复魔法棒 → `#extensionsMenu` → BioWeave。
3. 确认导航变为顶部紧凑布局、内容区保持可滚动，关闭/重开不丢失 overlay。
4. 检查三主题和人物详情壳，没有横向溢出。

### Mobile（< 768px）

1. 将 viewport 调整到约 390×844；无需先手动关闭酒馆 drawer。
2. 重复魔法棒 → `#extensionsMenu` → BioWeave。
3. 确认单列页面和底部“总览 / 人物 / 事件 / 推演 / 更多”导航出现。
4. 点击“更多”，确认真实菜单可进入家系图谱、世界模型、设置、分析状态。
5. 检查底部安全区、关闭/重开、三主题和页面没有普通横向滚动。

## Phase 2A 验证与真实宿主验收

实现波次完成后，自动检查至少应覆盖固定 Event JSON 的拒绝/写入边界、每个 Target Floor Version 的 0/1/N Event、Current Target Floor + Recent Story discovery、历史 Event 保留自身 story_time、当前 Floor source ownership、bounded existing_events 聚合、semantic duplicate guard、不同 source 的同时间 exposure 不误合并、不同 type 不互相去重、pregnancy-related `sexual_activity` 每个 Event 恰好一个 subject 及 1/N actual counterpart、不同 subject 分 Event、同 subject 重复 Event、gender 不决定能力、`can_carry_pregnancy` 的 eligible/pending/ineligible 三态、`can_be_fertilized` 不能单独授权、无受孕暴露、Event 编辑/删除、Floor 删除、Swipe 切换、Floor Version 替换以及手动刷新成功/失败。文档波次不把这些待实现回归写成已经通过的测试。

自动检查不能证明全部 SillyTavern 行为。Phase H 已在真实宿主验证核心 EventEmitter、Character counter、reroll/Swipe 分类、官方持久化、F5 durability、new Swipe 和 existing Swipe 切换；仍需单独完成 Event 编辑/真删除、Story Time 以及 Desktop / Tablet / Mobile UI 验收。完成人工验收前不应把 Phase 2A 描述为完整妊娠状态能力。
