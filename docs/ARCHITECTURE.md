# BioWeave 当前架构导航

本文是当前工作树的 canonical developer navigation。它说明“一个功能由哪里负责”、模块之间允许怎样依赖，以及修改某类问题时的第一落点。历史 Trellis task 的 PRD、design 和 implement 文档保留为历史记录，不作为当前模块地图。

## 总体边界

BioWeave 的基础架构重构已完成。后续优先修产品行为，不再为了文件大小继续拆分；只有形成独立生命周期、状态边界或可独立测试职责的新功能，才创建新的 feature module。

```mermaid
flowchart TD
    ST[SillyTavern host]
    Events[runtime/events.js\nbootstrap + facade + lifecycle orchestration]
    Adapter[runtime/sillytavern-adapter.js\nraw ST I/O]
    Compose[runtime/runtime.js\nlightweight composition root]
    Pipeline[runtime/event-analysis.js\nanalysis pipeline coordinator]
    Gen[runtime/generation-lifecycle.js]
    World[runtime/world-analysis.js]
    Event[runtime/character-event-analysis.js]
    Edit[runtime/event-editing.js]
    Track[runtime/tracking-runtime.js]
    Diag[runtime/diagnostics.js]
    Coord[storage/floor-persistence-coordinator.js]
    Store[storage/store.js]
    AI[ai/*]
    Core[core/*]

    ST --> Events
    Events --> Adapter
    Events --> Pipeline
    Events --> Compose
    Compose --> Gen
    Compose --> World
    Compose --> Event
    Compose --> Edit
    Compose --> Track
    Compose --> Diag
    Pipeline --> World
    Pipeline --> Event
    World --> AI
    Event --> AI
    World --> Coord
    Event --> Coord
    Edit --> Coord
    Coord --> Store
    Store --> Adapter
    Track --> Core
    World --> Core
    Event --> Core
```

依赖方向的硬规则：Adapter 不依赖业务 feature；feature 不直接依赖 UI 或 SillyTavern transport；Storage 不依赖 runtime feature；Generation Lifecycle 不反向导入 `events.js`；普通 Floor 写入不绕过 Coordinator。

## Feature-to-file map

| Feature | Primary owner | 负责什么 |
| --- | --- | --- |
| Runtime Diagnostics | `runtime/diagnostics.js` | trace 缓冲、payload 安全格式化、diagnostic DTO 和查询 |
| Event Editing | `runtime/event-editing.js` | 已存在 Biological Event 的 update/delete workflow |
| Tracking Runtime | `runtime/tracking-runtime.js` | 从有效 Floor facts 重建并刷新 Tracking Registry |
| World Analysis | `runtime/world-analysis.js` | World 查询、Full/Supplement/Patch、World AI orchestration、结果 readback/readiness；业务语义见 [World Model and World Analysis Contract](../.trellis/spec/domain/world-model.md) |
| Character/Event Analysis | `runtime/character-event-analysis.js` | Event AI、parse/normalize、identity、Event patch、readback 和成功后的桥接 |
| Projection Runtime | `runtime/projection-runtime.js` | factual success 后的 evolution、eligibility、single-flight、generation、stale guard、Floor persistence readback、Runtime DTO 和 Projection Refresh |
| Generation Lifecycle | `runtime/generation-lifecycle.js` | generation intent、settle barrier、supersede、exactly-once handoff |
| SillyTavern Adapter | `runtime/sillytavern-adapter.js` | 原始 Host context、Chat/Floor slot I/O、HTTP transport、listener subscribe |
| Runtime Composition | `runtime/runtime.js` | create / inject / assemble / return；不拥有业务状态 |
| Analysis Pipeline Coordinator | `runtime/event-analysis.js` | execution ownership、runAnalysis、generic retry、scheduler、World→Event pipeline、terminal 和 shared bridges |
| ST integration / compatibility facade | `runtime/events.js` | 顶层 bootstrap、public facade、lifecycle orchestration、source cleanup 和冻结的 persistence-policy bridge |
| Floor Persistence Coordinator | `storage/floor-persistence-coordinator.js` | ordinary owner-scoped Floor transaction、merge、save、readback、confirmed decision |
| Projection | `storage/projection.js`、`runtime/projection-runtime.js` | `projection_timeline` 的 Floor-owned owner workflow；Runtime post-processing 与 readback |
| Storage primitives | `storage/store.js` | Floor/Chat storage abstraction 与 host-store compatibility |
| Clear / special lifecycle | `storage/clear.js` | explicit clear、restore/migration 和特殊生命周期操作 |
| AI input construction | `ai/input-builder.js` | AnalysisInput 收集、选择、清洗和规范化 |
| Analyzer boundary | `ai/analyzer.js` | analyzer invocation、raw response 解析和结果规范化入口 |
| Prompt construction | `ai/prompts.js` | World/Event 等 analyzer prompt 和 contract |
| Character Evidence projection | `ai/input-builder.js` | 从 raw/runtime sources 构建 source-specific semantic Character Evidence；不创建 canonical identity |
| Character identity domain | `core/identity.js` | canonical ID、existing/new/unresolved、alias candidate 与 registry invariants |
| Tracking domain | `core/tracking.js` | eligibility、candidate/subject derivation 和 registry rebuild algorithm |
| Pregnancy Exposure Tracking lifecycle | `core/tracking-window.js`, `runtime/tracking-window-runtime.js`, `storage/tracking-window.js` | Phase 1 Window identity/grouping/lifecycle and Floor persistence; horizon remains deferred |
| Snapshot domain | `core/snapshot.js` + `runtime/event-analysis.js` | Floor-owned checkpoint validation/persistence、nearest valid restore、later Event replay 与 full replay fallback |
| State domain | `core/state.js` + `runtime/event-analysis.js` | `reduceState()` 与 `getCurrentBiologicalState()` 的 derived Current Biological State path |
| UI orchestration | `ui/app.js` | overlay、页面动作和 Runtime API 调用 |
| Characters UI | `ui/characters.js` | Characters 页面渲染；当前主要枚举 `tracking_subjects` |

## Where do I change this?

| Problem / feature | 第一站 | 可能的第二站 | 通常不要先改 |
| --- | --- | --- | --- |
| World analysis bug | `runtime/world-analysis.js` | `ai/analyzer.js`、`ai/input-builder.js`、`ai/prompts.js` | `floor-persistence-coordinator.js`、Adapter |
| Character/Event analysis bug | `runtime/character-event-analysis.js` | `core/events.js`、`core/identity.js`、AI 层 | `runtime/generation-lifecycle.js` |
| Manual World action | `runtime/world-analysis.js` | `runtime/event-analysis.js`、`ui/app.js` | Persistence transport |
| Manual Character action | `runtime/event-analysis.js` explicit `analyzeCurrentCharacterEvents()` routing | `runtime/world-analysis.js` read-only World prerequisite、`runtime/character-event-analysis.js`、`ui/app.js` | Adapter、Generation state、`resolveFinalWorldModelForAnalysis()` |
| Event parsing/normalization | `core/events.js`、`ai/analyzer.js` | `runtime/character-event-analysis.js` | UI |
| Event editing | `runtime/event-editing.js` | `core/events.js`、`core/identity.js` | Event AI stage |
| Character identity | `core/identity.js` | `runtime/character-event-analysis.js` | `core/tracking.js` |
| Tracking behavior | `core/tracking.js` | `runtime/tracking-runtime.js` | `character_registry` persistence |
| Characters UI | `ui/characters.js` | `ui/app.js`、business DTO bridge | Event persistence schema |
| Generation auto-trigger | `runtime/generation-lifecycle.js` | `runtime/events.js` host forwarding、`runtime/event-analysis.js` handoff | World/Event implementation |
| Generation settle | `runtime/generation-lifecycle.js` | lifecycle tests | Persistence |
| Retry behavior | `runtime/event-analysis.js` | World/Event attempt modules | Generation state |
| Scheduler | `runtime/event-analysis.js` | settings/runtime wiring | Adapter |
| Diagnostics | `runtime/diagnostics.js`、`utils/world-model-debug.js` | caller-specific trace emission、World LIVE STATE fingerprint/diff | General event bus、Floor writers |
| AI input construction | `ai/input-builder.js` | `runtime/event-analysis.js` caller | Persistence |
| World prompt | `ai/prompts.js` | `ai/analyzer.js` | Event runtime |
| Event prompt | `ai/prompts.js` | `ai/input-builder.js` | World runtime |
| Snapshot | `core/snapshot.js`、`core/state.js` | `runtime/event-analysis.js` checkpoint bridge | Adapter |
| Current Biological State | `core/state.js` | `runtime/event-analysis.js` replay/read API | UI business logic |
| Projection | `runtime/projection-runtime.js`、`storage/projection.js`、`core/projection.js` | `ui/projection.js`、Context injection | World/Event direct writes |
| Floor persistence | `storage/floor-persistence-coordinator.js` | owner caller、`storage/store.js` | direct host save |
| F5 durability | Coordinator + `storage/store.js` + Adapter bridge | `REAL-HOST VERIFIED` after automated mechanism tests | analysis modules |
| Swipe ownership | `runtime/floor.js`、`storage/store.js` | Coordinator/Adapter raw slot access | UI-only code |
| ST HTTP transport | `runtime/sillytavern-adapter.js` | `runtime/events.js` compatibility bridge | business feature |
| ST lifecycle listener registration | Adapter subscribe API | `runtime/events.js` callback wiring | Generation module |
| Source cleanup | `runtime/events.js`、`storage/clear.js` | lifecycle contract | Adapter policy |
| Settings | `ui/settings.js`、settings/storage callers | `runtime/events.js` host/settings glue | new Settings service |
| Clear/reset | `storage/clear.js` + owning runtime bridge | `runtime/events.js` orchestration | ordinary Floor writer |

### World Model Debug LIVE STATE boundary

Settings Debug keeps two explicitly different data sources:

```text
user action (open / refresh / copy)
→ ui/app.js collectWorldModelLiveState()
→ Runtime transient diagnostic state (read only)
→ existing authoritative World/Floor resolver (read only)
→ current ui/app.js World state
→ last World render diagnostic
→ utils/world-model-debug.js fingerprint / comparison / address diff
→ WORLD MODEL LIVE STATE + HISTORY TRACE output
```

`WORLD MODEL LIVE STATE` is sampled at the action boundary and includes its own
snapshot ID, started/completed timestamps, six-field target identity, layer
fingerprints, dynamic addresses, consistency status, and target-change
invalidation. `HISTORY TRACE` remains the event buffer returned by
`runtime/diagnostics.js`; it is labeled as historical and is never used as a
substitute for current Runtime, Floor, UI, or renderer state. The collector has
no Floor writer, does not call analysis or repair, and does not alter the
canonical `saveWorldModel → commitFloorPatch(owner="world") →
FloorPersistenceCoordinator` path.

## Feature module creation rule

1. 已有 feature owner 能完整说明职责时，扩展该 owner。
2. 只需要少量 shared orchestration 时，通过 `event-analysis.js` 或 `runtime.js` 的 narrow capability wiring 连接，不注入整个 coordinator。
3. 只有独立生命周期、独立 state/behavior boundary、清晰 public capability 或可独立测试的完整职责，才创建新 feature module。
4. 不要把新的独立 feature 继续堆进 `runtime/events.js` 或 `runtime/event-analysis.js`。
5. 不要为了一个 helper 或一个 function 创建碎片 module。

原则是 **ONE FEATURE OWNER, NOT ONE FUNCTION PER FILE**。

## 两个仍然较大的 Runtime 文件

### `runtime/events.js`

它不是通用 feature dumping ground，但仍是顶层 ST integration shell、compatibility facade、lifecycle orchestration、source cleanup integration、settings/enabled glue 和冻结 persistence-policy bridge 的组合边界。以下路径是 KNOWN-GOOD / FROZEN：

- `inspectOfficialFloorOwner`
- `acquireAuthoritativeFloorOwner`
- `bootstrapOfficialFloorOwner`
- `saveOfficialFloorSlot`
- host-ahead classification
- official readback / confirmed logic

普通产品功能不得为了方便进入这些路径。

### `runtime/event-analysis.js`

它是 Analysis Pipeline Coordinator，合理保留：`runAnalysis`、execution ownership、cancellation/supersede、generic retry、scheduler、Floor resolver/version guards、World→Event transition、terminal handling、Snapshot/general-derived-state bridge 和 capability wiring。它不是 World、Character/Event、Tracking、Event Editing、Generation state machine 或 Adapter 的 feature owner；新功能不应默认加入这里。

## Generation Lifecycle boundary

`runtime/generation-lifecycle.js` 拥有 pending generation intent、Swipe generation intent、sequence/token、completed markers、`final_character_floor_seen`、`generation_ended`、settle barrier、exactly-once consume、supersede、stop/cancel cleanup、generation diagnostics 和 settled handoff。

核心 invariant：

```text
final_character_floor_seen === true
AND generation_ended === true
→ GENERATION_SETTLED exactly once
```

`CHARACTER_MESSAGE_RENDERED → GENERATION_ENDED` 与反向顺序都必须工作。该模块不拥有 World/Event pipeline、generic retry、scheduler、Persistence、Floor Version policy 或 ST listener registration。

## SillyTavern Adapter boundary

`runtime/sillytavern-adapter.js` 负责 **HOW**：context/settings/raw metadata、Chat/message/Swipe raw access、official GET/SAVE transport、host save request、raw Floor slot read/write、lifecycle subscribe/unsubscribe、prompt host call 和 transport normalization。

它不负责 **WHY**：owner acquisition、Floor Version、stale、host-ahead、sibling merge、confirmed decision、Generation state、World/Event behavior 或 source cleanup policy。新的 ST I/O primitive 放 Adapter；新的 persistence/business decision 不放 Adapter。

## Persistence canonical path

ordinary Floor write path：

```text
World / Event / Event Editing / Projection / Terminal
→ owner-scoped patch
→ FloorPersistenceCoordinator
→ latest authoritative merge
→ host sync
→ official save
→ authoritative readback
→ confirmed
```

Owner whitelist：

| Owner | Allowed fields |
| --- | --- |
| `world` | `world_model`, `world_model_meta` |
| `event` | `analysis`, `events`, `character_registry` |
| `projection` | `snapshot`, `projection_timeline` |
| `terminal` | `analysis` |

普通业务模块不得直接调用 `store.saveFloor`、`/api/chats/save`、`context.saveChat`、`saveOfficialFloorSlot`，也不得直接写任意 `extra.bioweave` 或 `swipe_info[*].extra.bioweave`。Chat clear、source cleanup、lifecycle root invalidation、migration/restore、metadata/settings 和 explicit Floor clear 是特殊操作，不是 ordinary owner-patch precedent。

## Known-good freeze

以下内容未经 root-cause evidence 不应修改：

- `storage/floor-persistence-coordinator.js`
- `runtime/sillytavern-adapter.js`
- `runtime/generation-lifecycle.js`
- `runtime/floor.js`
- `runtime/events.js` 中的 owner inspection/acquisition、host-ahead bootstrap、official save、readback/confirmed 路径

这些路径的当前状态为：`IMPLEMENTED`；自动化测试已覆盖 persistence mechanism；真实
SillyTavern World persistence 的 final-save + F5/reload durability 与 Swipe 行为已人工验证。
人工宿主验收不等同于自动化测试。与产品行为无关的问题不得顺手触碰它们。

## World 与 Character/Event

World Analysis 的 domain owner 是
[`World Model and World Analysis Contract`](../.trellis/spec/domain/world-model.md)：
Full 使用 permitted evidence 重建 complete model，Supplement 使用同一 evidence
set 加 Existing canonical baseline，经过 JSON Fact Delta、Fact validation、canonical
address resolution、Existing comparison 和当前 Fact Delta safety boundary，再由
deterministic code 生成 Host-internal Patch v2 operation、classification 与
classified merge，经过 shared complete-model consistency 与 strict canonical
validation 后持久化。Supplement 的 wire format 是 JSON Fact Delta；Patch v2
不是 AI output format、Supplement wire format 或 raw model response contract。
Projection rule 的世界级修正使用同一 Fact Delta 边界：明确的
`Projection_Rule_Override` 才能生成 `DISABLE_PROJECTION_RULE`；缺少证据、
不确定性或 omission 不会移除 Existing rule。最终 active World snapshot
直接成为 Runtime authority，Runtime 不维护 disabled-rule blacklist；历史
Floor 与已有 Projection 不回写。
本文只保留模块导航，不复制该领域算法；Floor/Swipe ownership 仍以 Floor State
Ownership Contract 为准。

### 当前实现与目标契约

当前代码已实现 Manual Character 的独立分析边界：它通过 `analyzeCurrentCharacterEvents()` 读取现有 at-or-before canonical World，不进入 `resolveFinalWorldModelForAnalysis()`，因此不会触发 World AI。缺少可用 World 时以 `WORLD_MODEL_REQUIRED` fail closed，且不写 Event 或 terminal failure。Event prompt 通过 input builder 的 narrow semantic projection 消费 persisted World Model、Current Target Floor、Recent Story、`identity_context`、Character Evidence (`individual_evidence`)、bounded `existing_events` 和 Story Time；raw Character Card、Persona、Worldbook、External Memory 不直接进入 Event prompt，但 Character Card/Persona 的稳定人物证据必须先经过 projection。

目标契约为：

```text
AUTO:             World → Event
MANUAL WORLD:     World only
MANUAL CHARACTER: existing persisted valid World → Event only
                  WORLD_AI_CALLS = 0
                  no valid World → fail closed
```

Analysis Boundary Fix 与 Event Input Boundary Fix 均已实现；Event Input Boundary 不改变 World Analyzer 对 raw Character Card、Persona、Worldbook 和 External Memory 的既有输入。

World feature 以宿主可选来源构建 World Model；Character/Event feature 以已持久化 `world_model`、narrative discovery window（Current Target Floor + bounded Recent Story）、`identity_context`、Character Evidence (`individual_evidence`) 和 bounded existing Events 产生 `events`、`character_registry` 与 `analysis`。正确边界是 `raw/source collection → Character Evidence semantic projection → Character/Event Analyzer`：Runtime wide DTO 可以保留 raw sources 供 World/legacy orchestration，但 Event prompt 不消费 raw sources，也不能因隔离 raw DTO 而失去稳定人物证据。

Event discovery window 与 Event persistence owner 是独立概念。Recent Story 中明确发生且尚未记录的历史 Event 可以在当前分析中被发现，保留自身 `story_time`；Runtime 仍将本轮所有新 Event 写入当前 Character Floor active Swipe，并将 canonical `source` 绑定当前 Floor Version。`existing_bioweave` 仍是最近合法前置 Floor snapshot；`existing_events` 是按 Recent Story 窗口从当前有效 Floor facts 聚合的 bounded semantic-dedupe reference，不是 Chat-level Event cache。identity resolution 后使用确定性完整事实 key 去重，缺少高置信度字段时保留候选。

Character Evidence 只提供 mention identity context、已有 World Model species/type mapping evidence、明确个体生理/生殖 capability evidence 与稳定人物背景。它不是当前 Floor Event、World Model rule、Tracking eligibility、Character Registry identity source 的替代品、Chat-level 持久化字段或 UI 人物列表来源。生理性别可参与已有 type mapping，但不得直接推出 capability；Human baseline 只能由 World Model 建立，Nonhuman 不能套用 Human baseline。未来修改 Event Input Boundary、Prompt trimming 或 AnalysisInput narrowing，必须保留等价 projection，并用最终 `buildEventAnalysisMessages()` 测试验证。
每个已确认 Event participant 都必须执行完整的人物分析，不以 `pregnancy_relevance.relevant === true` 为前提：identity → Character Evidence → species → species 内 biological_type → exact persisted World Model species/type → baseline capabilities → explicit individual capability evidence → final participant biological facts。`pregnancy_relevance` 只描述当前 Event，不能跳过人物 facts，也不能由人物 capability 反推妊娠相关性；证据不足保持 `null`。Tracking 继续消费最终 participant facts，Characters UI 继续消费 `tracking_subjects`，Registry 不直接成为人物列表。

## Character Registry 与 Tracking Subjects

`character_registry` != `tracking_subjects`。

- `character_registry`：Floor-owned canonical identity snapshot。
- `tracking_subjects`：runtime-derived Tracking projection。
- Characters UI 当前主要枚举 `tracking_subjects`。

`character_profiles` / `characterFacts` 也不是 Registry 或 Tracking Subject 的
别名：它们是 Runtime 为 StateReducer 构建的 derived biological/profile facts，
当前没有独立 authoritative persisted Character Profile root。Current Biological
State 则是 Events replay、characterFacts 与 Story Time 的 derived 输出；它不是
事实存储。

人物身份的 canonical pipeline 是：

```text
narrative mention
  → identity_context + Character Evidence + previous valid registry snapshot
  → AI identity classification
  → Runtime canonical identity resolution
  → participant canonicalization / Event validation
  → current Floor character_registry snapshot
  → BiologicalEvent
  → tracking_subjects / tracking_candidates
  → Characters UI
```

`core/identity.js` 是 identity domain owner；`runtime/character-event-analysis.js`
负责 Runtime resolution/canonicalization；`ai/input-builder.js` 只负责 Character
Evidence projection；`ai/prompts.js` 维护 AI identity contract；`core/tracking.js`
只负责从 canonical Event 与 participant facts 派生 Tracking；`ui/characters.js`
只负责 presentation。AI 不拥有 canonical ID authority，Registry 不直接成为 UI
人物列表，Tracking 也不负责修复人物识别。

Pregnancy Exposure Tracking Window Phase 1 已有独立的
`core/tracking-window.js`、`runtime/tracking-window-runtime.js` 和
`storage/tracking-window.js` owner。Window 使用独立
`tracking_window_timeline`，复用 Timing cycle identity，支持
`open`、`resolved_pregnant`、`terminated`，并由 Tracking 消费 open view。
不要把 `core/tracking.js` 的 Subject registry、`core/state.js` 的 Pregnancy
Episode 或 `core/projection.js` 的 Projection lifecycle 当作 Window。Story-Time
horizon、`expired`、negative resolution 和 advanced Episode orchestration 仍未实现。

Event discovery window、identity authority、Event occurrence time 和 persistence
owner 是四个独立概念。Current Target Floor 与 bounded Recent Story 可以共同发现
Event；历史 Event 保留自身 `story_time`，但新结果由当前 active Floor/Swipe 持久化。

未来改变 Characters UI 产品定义应作为独立产品任务，不应偷偷改变 Event persistence schema。

当前生产状态的完整矩阵维护在 [DEVELOPMENT.md](./DEVELOPMENT.md)。其中
StateReducer、Current Biological State、Snapshot Runtime 和 Projection Runtime
已接通；Tracking Window 为 PARTIAL / PHASE 1 IMPLEMENTED；Genealogy 仍为
PARTIAL。

## Safe modification guardrails

### UI_OPEN_FAST_PATH

普通 settings editor、Character editor、popup、modal、详情辅助窗口等轻量
查看/编辑 surface 遵守 `UI_OPEN_FAST_PATH`：用户点击后必须先同步设置 open
state 并渲染可见 shell，再读取必要的轻量 DTO；异步结果返回时必须重新确认
Chat identity、canonical entity identity、editor 仍然打开且请求仍为当前请求，
通过后最多进行一次必要的内容填充 rerender。关闭或 stale 的结果必须丢弃，
不得复活已关闭的 editor。

普通 OPEN 默认是 read-only、无副作用的轻量操作。除非该操作本身明确是开始
分析、刷新分析、执行推演、保存或重建，否则不得为了显示 editor 触发 AI、
World Full/Patch、Event Analysis、Projection generation/eligibility、事实
State/Tracking rebuild、exhaustive Floor scan、heavy debug aggregation、
persistence transaction、saveChat、official save/readback、Timeline rebuild，
或无关的 World/Projection aggregation。已有 UI DTO、identity-valid Runtime
read DTO 和 scoped config/store read 优先；不能因为已有 getter 恰好能返回某
字段，就复用返回大量无关业务数据的诊断聚合 API。正式产品 UI 不调用
`window.__BIOWEAVE_DEBUG__`，debug surface 只服务 diagnostics、development、
fixture 和人工验证。

多个确实必要且互不依赖的轻量异步读取可以并行；有依赖时保持正确顺序。可见
shell 不得等待 heavyweight async work：`FAST OPEN, AUTHORITATIVE SAVE`。保存
仍必须使用对应正式 Runtime API、校验、canonical identity 与 Chat/Floor stale
guard、权威持久化/readback 和结果 rerender，不能为了打开速度削弱保存正确性。

当前 Characters 的 Timing、昵称 editor 与 World 的归档资料都采用该边界：
compact popup/popover 不展开主页面；Timing 使用轻量正式 view read，昵称只读取
当前身份 DTO，归档资料只读取已经加载的 World metadata。三者均不通过 debug
facade 打开，也不在 OPEN 阶段创建 Event、State、Timing Instance、Projection
或 World Rule。三者共享 `bioweave-compact-popup` 的紧凑 presentation 基础，
业务专属内容、定位上下文和动作保留在各自 owner。

### Pre-confirmation Projection Timing

Phase 1 的 timing resolver 位于 Core，Chat config 通过 `storage/store.js` 的
Chat metadata 读写，timing instance 通过 `storage/projection-timing.js` 复用
Floor Persistence Coordinator、active Swipe、完整 Floor Version、官方保存与
权威 readback。Runtime 只把 timing eligibility 与现有 World Rule eligibility
组合；不向 World projection rule 加入 probability/random/seed，也不在 Runtime
使用缺少 World authority 的 Human 常识 fallback。内置 Human narrative preset
位于单一 Core preset module，只有在 World species 与 canonical character
species 都明确为普通 Human 时作为未来周期 config baseline；它不创建或替代
World projection rule。Characters UI 通过正式 Runtime config API 读取/保存
Chat-local override，不能调用 debug facade。Timing editor 的正式 view read
只读取当前 Chat 的 World applicability、Chat config 和 Floor timing timeline，
不调用 debug aggregation、Event analysis 或 Projection eligibility；打开先显示
popup shell，再异步填充 read projection。v1 state modifier 固定为 0；没有明确
有效 config 时 timing integration 保持 disabled，不改变既有 Projection 行为。

- 普通产品修复优先限于对应 feature owner。
- 不为产品行为问题修改 Coordinator、Adapter raw transport、Generation settle 或 Floor Version policy。
- 不把 special clear/restore 写法复制成 ordinary Floor writer。
- 修改 persistence、host integration 或 generation boundary 前，必须有 root-cause evidence，并重新做对应 automated + real-host verification。
- 变更前阅读本文件及相关 domain contract；历史 Phase 文档只用于追溯。
