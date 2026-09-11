# Research: One Floor Version 与 Product UI 审计

- Query: 审计 Event Analyzer 是否允许每个 Target Floor Version 产生多个 Event、Runtime 的多 Event/失败刷新行为/Core 约束；盘点普通 Product UI 是否仍展示内部调试/provenance 字段；核对相关 tests/docs 与修改边界。
- Scope: internal
- Date: 2026-09-12

## Files found

| Path | Description |
| --- | --- |
| `ai/prompts.js` | Event Analyzer Core、Task、Output contract 与输出示例 schema。 |
| `ai/analyzer.js` | AI 响应提取、Event envelope 校验、normalize 与 parser。 |
| `runtime/event-analysis.js` | Floor 解析、分析调度、Event enrich/save、失败/取消 terminal 状态与 Registry refresh。 |
| `runtime/floor.js` | 六字段 Floor Version、active Event 过滤、重试与 `commitAnalysis()` 失败语义。 |
| `core/events.js` | 单个 `BiologicalEvent` schema、normalize、domain validate 与排序。 |
| `ui/characters.js` | Characters 列表/人物详情与 exposure card。 |
| `ui/events.js` | Events 历史卡片、结构化时间/source 详情与编辑表单。 |
| `ui/overview.js` | Overview 计数、Floor Version、分析详情与 Registry Summary。 |
| `ui/app.js` | Runtime Business DTO 注入页面、事件编辑/删除与显式 Debug Popup 入口。 |
| `style.css` | Overview analysis detail 与显式 Debug Popup 的样式；不产生文本内容。 |
| `tests/event-analysis.test.js` | Prompt/parser envelope、身份隔离、数组引用与 evidence 测试。 |
| `tests/event-analysis-runtime.test.js` | 多 Event、Floor Version、失败 refresh、取消/stale/save/Registry failure 测试。 |
| `tests/events.test.js` | 单 Event domain 约束、0/1/N source IDs 与排序测试。 |
| `tests/phase2a-ui.test.js` | 普通 Characters/Events/Overview markup 当前断言。 |
| `tests/phase2a-app.test.js` | App→Runtime 数据流、编辑/删除与 source 保留测试。 |
| `tests/ui.test.js` | 显式 Analysis Debug Popup、设置与 App 生命周期测试。 |
| `docs/UI.md` | 当前页面契约，明确写入了折叠 debug/source 区的现状。 |
| `docs/DEVELOPMENT.md` | Phase 2A Event/Tracking 数据流、失败刷新与 UI 边界。 |
| `docs/DATA-MODEL.md` | AI DTO/Domain Event、source binding、Registry 与运行状态模型。 |
| `docs/CONTEXT-AND-PROMPT.md` | Prompt narrative/provenance 边界；主要约束 Prompt 展示，不是 Product UI。 |
| `.trellis/spec/domain/event-pipeline.md` | Trellis domain contract；当前仍允许 `events[]` 与 Character exposure debug identity。 |
| `.trellis/spec/frontend/quality-guidelines.md` | UI/宿主验证边界，要求 Node 检查与真实宿主 smoke test。 |

## Findings

### 1. Event Analyzer Core / Task / Output contract

结论：当前 contract 允许 `events.length === 0`、`1` 或大于 `1`；没有“每个 Target Floor Version 最多一个 consolidated BiologicalEvent”的规则。

- `ai/prompts.js:25-37` 的 Core contract 要求提取当前 Floor Version 支持的事件，并明确兼容多个 BiologicalEvent 类型；`ai/prompts.js:34` 还明确允许 `gestational_subject_ids[]` / `counterpart_ids[]` 为 `0、1 或 N`。这里的 N 是 ID 数组 cardinality，但同一组规则没有声明 Event 记录必须只有一条。
- `ai/prompts.js:39-43` 的 Task contract 要求“返回完整 events 数组”，目标楼层只作为事实提取边界；没有单条、合并或 `maxItems: 1` 约束。
- `ai/prompts.js:45-60` 的 Output contract 只规定顶层 `{schema_version:1, events:[]}`、每个 Event 的字段和 ID 数组；`ai/prompts.js:56` 甚至再次说明 subject/source 数组允许空、单个或多个。没有对 `events` 数组本身设置长度上限。
- `ai/prompts.js:62-66` 的 `EVENT_ANALYZER_SCHEMA` 只是普通 JS 示例对象 `{schema_version: 1, events: []}`，不是带 `maxItems: 1` 的 JSON Schema，也没有其它 cardinality 元数据。
- `ai/analyzer.js:927-938` 的 `EVENT_AI_FIELDS` 与 `ai/analyzer.js:1079-1087` 的 `validateRawEventShape()` 是逐 Event 字段白名单；`ai/analyzer.js:1352-1379` 对单个 Event normalize。
- `ai/analyzer.js:1399-1417` 的 `parseEventAnalysisResponse()` 仅检查顶层 object、未知顶层字段、schema version 和 `Array.isArray(payload.events)`，然后对所有元素执行 `payload.events.map(...)`。没有 `events.length > 1` 分支，也没有把多条合并/拒绝的逻辑。
- `ai/analyzer.js:1527-1557` 的 `analyzeFloor()` 直接返回 parser 的 `{schema_version, events}`，未在 analyzer 层补 cardinality guard。

因此，模型返回两个或更多结构合法 Event 时，当前 parser 会成功返回；空数组也会成功返回。AI 返回的 `event_id` / `source` 仍会在 `ai/analyzer.js:1352-1379` 的 AI DTO normalize 中被排除，这是身份归属正确但与 Event 数量约束无关。

### 2. Runtime 是否保存多个 Event，以及失败 refresh 语义

#### 成功路径明确保存多 Event

- `runtime/event-analysis.js:726-743` 构造请求并调用 production analyzer；请求同时带入当前 `floor_version` 与 `authoritative_floor_version`。
- `runtime/event-analysis.js:745-756` 对 `result.events` 的每个元素执行 `normalizeEvent()`，按 `ordinal` 生成独立 deterministic `event_id`，并为每条绑定同一个当前 Floor Version 的 authoritative `source`。因此同一 Floor Version 的多条 Event 会分别获得 `_1`、`_2` 等 ordinal 后缀，而不是被合并。
- `runtime/event-analysis.js:757-775` 逐条 domain validate，随后以 `events.length` 写入 `analysis.event_count`。
- `runtime/event-analysis.js:777-801` 把整个 `events` 数组写入 `store.saveFloor(...)`，并以同一数组重建 Registry；`collectActiveBusinessData()` 在 `runtime/event-analysis.js:514-543` 中按数组长度计算 active/event/sexual activity 统计并把完整 `active_events` 传给 UI。
- 现有运行时回归直接证明此行为：`tests/event-analysis-runtime.test.js:267-363` 构造 `eventA`、`eventB`、`eventC`，以三个 Event 的 API 响应完成成功保存；`tests/event-analysis-runtime.test.js:341-358` 断言当前 Floor 有 3 条 Event、active count 为 3，并验证三条均进入业务 DTO。该测试不是“潜在未覆盖”，而是当前多 Event 行为的显式基线。

#### Core 没有 Floor-level Event list cardinality 约束

- `core/events.js:60-95` 描述的是单个 `BIOLOGICAL_EVENT_SCHEMA`，没有 Floor `events[]` schema。
- `core/events.js:247-264` 的 `normalizeEvent()` 和 `core/events.js:346-496` 的 `validateEvent()` 都只接收/校验一个 Event；没有全局列表长度参数。
- `core/events.js:307-343` 对一个 Event 内部的 `gestational_subject_ids` / `counterpart_ids` 做 participant-backed 与 exposure consistency 校验，天然允许多个 source/subject。
- `core/events.js:504-513` 的 `sortEvents()` 接受任意数组并按 Floor、Story Time、Event ID 排序，不限制数组数量。

这意味着“同一 Event 内可有 N 个 source/subject”与“同一 Floor Version 可有 N 条 Event”是两层不同 cardinality，不能通过删掉 ID 数组的 N 语义来实现 One Floor。

#### 失败、取消、stale 与 Registry failure

- 非 force 请求只有在保存结果为 success 且六字段版本相同才跳过：`runtime/event-analysis.js:846-853` 调用 `shouldAnalyze()`；手动 refresh 在 `runtime/event-analysis.js:884-890` 强制执行。
- `runtime/event-analysis.js:605-627` 的 `persistTerminalAttempt()` 从当前 Floor 读取既有 `events`；失败/取消 metadata 保存时不会把 Event 数组清空。
- `runtime/floor.js:234-273` 的 `commitAnalysis()` 对失败/取消会保留上一份成功分析（包括 `last_success`），将本次状态写成 `failed` 或 `cancelled`，并保存 `last_attempt`、error code/stage。相同 Floor Version 下，原 Event 的 source 仍匹配当前版本，因此可继续 active。
- 普通失败分支 `runtime/event-analysis.js:820-840` 会保存失败 attempt（非 stale Chat），随后尝试 `refreshTrackingRegistry('analysis-failed')`；stale Chat 则跳过旧作用域的失败 metadata 写入。`runtime/event-analysis.js:841-843` 最终统一释放 execution。
- 取消分支 `runtime/event-analysis.js:803-817` 先构造 `REQUEST_ABORTED`，必要时通过 `runtime/event-analysis.js:630-639` 回滚迟到的 Floor success commit，再尽力保存 cancelled attempt；`runtime/event-analysis.js:559-589` 删除 in-flight、清空 controller 并发布 terminal status。
- 如果消息已编辑导致新 Floor Version，旧 Event 的 source 不匹配新版本，`runtime/floor.js:181-189` 的 `getActiveFloorEvents()` 会过滤掉它。对应回归在 `tests/event-analysis-runtime.test.js:506-524`：第二次分析失败后，`active_event_count` 与 Tracking Subject 都为 0。也就是说“保留上次成功分析 metadata”不等于把旧版本 Event 继续放入当前 active Registry。
- Registry rebuild 本身失败时，Floor Event 仍保留：`tests/event-analysis-runtime.test.js:683-694` 断言 state 为 failed 但 `current_floor_events.length === 1`。这符合 Runtime 将事实保存与 Registry refresh 分阶段处理的当前行为。
- `tests/event-analysis-runtime.test.js:486-504` 覆盖同一版本的 force refresh failure：state 为 failed、`last_error` 记录失败、上一份成功 Event 仍在 `current_floor_events`。

若收紧到 0/1，必须在失败分支之外补充“多 Event 响应被拒绝/合并时是否保留前次成功 Event”的回归；不能只改 `analysis.event_count` 或 UI 计数，否则 Floor 仍可能写入多条事实。

### 3. 普通 Product UI 的内部字段盘点

#### `ui/characters.js`

- `ui/characters.js:102-110` 用 `event_id` 做 exposure 引用索引，并把它放入 `data-bioweave-event-id`；这属于操作所需 DOM 标识，当前不一定作为普通文本显示。
- `ui/characters.js:143-157` 的 `renderExposureDebug()` 在普通人物详情 exposure card 内生成 `<details class="bioweave-event-debug"><summary>调试信息</summary>`，内容包含 `event_id`、`chat_id`、`message_id`、`floor`、`swipe_id`、`content_hash`、`message_version`。默认折叠不等于不渲染；用户展开后可见全部 Floor provenance/hash。
- 引用缺失时，`ui/characters.js:160-166` 仍生成“调试信息”并显示 `event_id`。
- `ui/characters.js:168-175` 的普通 exposure card 显示用户业务字段（type/status/time/location/相关对象），但紧跟着拼入 `renderExposureDebug()`；`ui/characters.js:200-206` 通过 Subject 的 `exposure_event_ids` 读取 Event。
- `ui/characters.js:209-215` 的人物摘要在普通人物详情中生成“调试信息”，直接显示 `character_id`。
- `ui/characters.js:259-264` 的不可用详情空状态也把请求的 `character_id` 作为可见文本输出。

实际风险：Characters 主列表主要显示人物名/状态，未直接显示完整 source；但人物详情/错误态仍把 Event ID、Character ID 与完整 source debug 放在普通产品页面中。当前 `docs/UI.md:35` 与 `docs/DEVELOPMENT.md:74` 反而把技术字段放入折叠调试区作为既有契约，因此新边界需要同步改文档/spec，而不是只改模板。

#### `ui/events.js`

- `ui/events.js:100-112` 的参与者业务行显示姓名和可读事件角色；若有 ID，继续渲染“标识信息”折叠块并显示 `character_id`。
- `ui/events.js:135-151` 的妊娠相关性业务区之后，继续渲染“结构化标识”折叠块，显示 `gestational_subject_ids` 与 `counterpart_ids`。
- `ui/events.js:154-164` 的 `renderStoryTime()` 输出 `normalized`、`day_index`、`calendar_id`、`provider`、`precision`、`confidence`；这不是普通用户所需的 Story Time display，而是 raw/structured metadata。
- `ui/events.js:167-177` 的 `renderSource()` 明确输出 `event_id`、六字段 source（含 `chat_id`、`message_id`、`floor`、`swipe_id`、`content_hash`、`message_version`）。
- `ui/events.js:216-236` 的普通 Event card 拼入“来源与调试信息” details（结构化时间 + 来源）；同时 `ui/events.js:188-213` 的编辑表单显示只读 Event ID、source 只读说明和 `data-bioweave-event-field="event_id"`。`ui/events.js:219`、`233-236` 还把 Event ID 作为操作 data attribute 保留。
- `ui/events.js:239-269` 是普通“历史事件”页面，会为当前 active Event 生成上述卡片；这些不是只在设置页/显式 Debug Popup 渲染。

实际风险：Events 页面仍可展开“标识信息/结构化标识/来源与调试信息”，并能看到所有 requested 内部字段；编辑操作仍需要内部 `event_id`/source，但可将它们保留在 Runtime/DOM data binding，移除用户可见的 raw details。当前 `tests/phase2a-ui.test.js:275-344` 显式断言这些 source/debug 文本存在，属于需要反向更新的旧基线。

#### `ui/overview.js`

- `ui/overview.js:204-214` 在人物总览行显示“稳定 character_id”。
- `ui/overview.js:221-234` 在最近事件卡显示 `Event ID` 与 `Floor`；`event_id` 也由 `ui/overview.js:200-224` 用于列表映射。
- `ui/overview.js:137-151` 的 `compactFloorVersion()` 拼接六字段版本，并把 `content_hash` 截断为前 12 个字符后展示。
- `ui/overview.js:263-294` 将当前 Floor、`Floor Version：<compact hash>`、Analysis Status、Current Floor Event Count 等直接放在普通 Overview 顶部/状态卡，因而 Floor Version/hash 不是仅调试区。
- `ui/overview.js:163-187` 的 `renderAnalysisDetail()` 生成普通 Overview 内的“查看分析详情” details；其中包括 status、execution state、stage、attempt、started/finished timestamps、error code/path、last success/error、六个 Floor Version 字段、解析后的 Event JSON 和 `Registry Summary`。`safeDiagnosticClone()` 只按 secret-like key 脱敏（`ui/overview.js:101-135`），不会移除 event/source/registry/floor/hash 字段。
- Details 默认闭合只改变初始可见性，不改变 markup 中已经存在的内部字段；`style.css:488-502` 只设置其布局/滚动。

实际风险：Overview 是当前最明显的普通 Product UI 泄露面，直接暴露 Floor Version、hash、Event ID、character_id 和 Registry Summary；现有 `tests/phase2a-ui.test.js:125-167` 与 `:353-367` 正在验证这些内容可见。若普通 UI 要去除 provenance/debug，应把轻量用户状态与显式 Debug/Analysis Detail 分开。

#### `ui/app.js`

- `ui/app.js:1841-1862` 从 `runtime.collectActiveBusinessData()` 接收完整业务 DTO，并把 `analysis_status` 原样放入 `businessState`；没有 Product UI 专用的 presentation redaction。
- `ui/app.js:2029-2068` 调用当前页面 renderer 时，把 `trackingSubjects`、`characterProfiles`、`activeEvents`、`currentFloor`、`lastAnalysis`、完整 `analysisStatus` 传入。App 自身不是主要 HTML 泄露点，但页面模板可因此读取全部内部字段。
- `ui/app.js:1878-1949` 的 `activeEventById()`、编辑保存与删除路径需要 `event_id` 和 `source` 来定位/保留 authoritative identity；这是业务操作边界，不等同于把这些字段展示给用户。
- `ui/app.js:613-692` 实现独立的 `renderDebugPopupContent()` / `openAnalysisDebugPopup()`；`ui/app.js:2850-2854` 的设置调试入口和 `ui/app.js:2954-2957` 的 World Model input 入口都使用 SillyTavern DISPLAY Popup。这个显式入口与普通 Overview/Characters/Events markup 应分开保留。
- `ui/app.js:1882-1913` 的失败 Toast 只显示安全错误和“上一份有效事件已保留”，没有直接输出 source/hash；这部分不构成当前主要泄露点。

实际风险：App 当前把完整 DTO 贯穿到普通页面，页面层没有安全的“用户可见 DTO”边界；但不应为了 UI 清理而删掉 Runtime 操作所需的 `event_id`/source。建议在页面 renderer 侧只选取用户字段，或显式建立很薄的 presentation projection；保留 App→Runtime 编辑/删除数据流。

#### `style.css`

- `style.css` 中没有“调试信息/标识信息/结构化标识/来源与调试信息”等文本，也没有 `event_id`、`character_id` 或 hash 的 content 生成；CSS 本身不会渲染这些字段。
- `style.css:488-502` 只为 `.bioweave-analysis-detail` 和内部 `<pre>` 设置跨列、滚动和换行，未隐藏 Overview 的详情内容。
- `style.css:2499-2600` 为 `.bioweave-analysis-debug-popup-content` 及其 raw/structure preview 提供独立 Debug Popup 样式。这是显式调试面的支持，不是普通页面 provenance 渲染。
- 未找到 `.bioweave-event-debug`、`.bioweave-inline-debug`、`.bioweave-structured-identifiers`、`.bioweave-event-source` 的专用隐藏规则；依靠 `<details>` 默认闭合不能满足“普通 Product UI 不渲染内部字段”的强边界。

### 4. Tests/docs 当前状态与修改边界

#### 当前测试基线

本次只读执行 `npm test`，结果为 `368` passed、`0` failed、`0` skipped，退出码 `0`。测试过程中有 `tests/event-analysis-runtime.test.js:428` 预期的 `DIGEST_BROKE` console diagnostic，但对应测试仍通过；这不是本次审计发现的新失败。Node 测试不替代真实 SillyTavern/browser 验收。

与本任务直接相关的现状：

- `tests/event-analysis.test.js:103-123` 断言 Prompt 含 `0、1 或 N`，当前语义是引用 ID cardinality；若 Output contract 改成每 Floor 0/1，需避免把“单个 consolidated Event 内多个 subject/source”误改成单值。
- `tests/event-analysis.test.js:534-562` 以三个 Event（无 exposure、单 source、多 source）调用 parser，并断言三条都成功。它直接证明 parser 当前接受 `events.length > 1`。
- `tests/event-analysis-runtime.test.js:267-363` 以三个不同类型 Event 成功保存/进入 active DTO；One Floor 改动必须明确是“拒绝多条”还是“在某层合并后保存一条”，再重写该测试。
- `tests/event-analysis-runtime.test.js:473-524` 已覆盖相同版本 force success replacement、force failure preservation、编辑后版本失败并从 active Registry 移除旧版本 Event；这些应保留并增加 0/1 cardinality 断言。
- `tests/event-analysis-runtime.test.js:683-694` 覆盖 Registry rebuild failure 后 Floor Event 仍可用；`:697` 之后覆盖取消与迟到响应；这些是失败边界，不能因 UI 清理而删除。
- `tests/events.test.js:214-235` 与 `tests/event-analysis.test.js:534-562` 的“one or multiple sources”是一个 Event 内数组 cardinality，应继续保留，除非需求同时改变领域模型。
- `tests/phase2a-ui.test.js:57-109` 已验证 Characters 不显示 Tracking decision diagnostics；但 `:169-220` 仍验证人物详情包含 `character_id`/`evt-1`，而实现还会输出折叠“调试信息”。
- `tests/phase2a-ui.test.js:125-167` 验证 Overview 的 Analysis Detail/diagnostics；`:275-344` 明确要求 Events 页面输出 source/hash 和“来源与调试信息”；`:353-367` 允许 Overview 事件 ID/多事件计数。这些是要反向改为“普通 markup 不含内部字段、显式 debug surface 另测”的测试。
- `tests/phase2a-app.test.js:309-325` 与 `:375-415` 验证 App 消费 Runtime DTO、Event edit/delete 和 source 保留；source 保留是持久化不变量，不应被误删成 UI 不再能编辑。
- `tests/ui.test.js:509-614`、`:616-763`、`:765-795` 专门验证设置/World Model 的显式 Analysis Debug Popup、共享 prompt boundary 与 Popup 不可用时 Toast；这些测试说明项目已有“显式 Debug Popup”边界，建议继续保留，不把普通页面的 raw details 混回去。

#### 当前文档/spec 约束与冲突

- `.trellis/spec/domain/event-pipeline.md:47-61` 把 AI DTO 定义为 `events[]`，并按 response ordinal 生成多个 Event ID；`:112-119` 还明确规定 Character exposure card 可渲染 debug identity。`:137-148` 与 `:167-171` 明确规定 failed force refresh 保留上次成功 Event/last_success。
- `docs/UI.md:35` 允许人物详情把稳定 `character_id` 等技术字段放入折叠 debug 信息；`docs/UI.md:39` 允许 Events 页把 Event ID、Source、结构化时间/raw 字段放入折叠详情；`docs/UI.md:55` 要求 Overview 显示 Floor Version 与轻量 Analysis Detail；`docs/UI.md:61` 记录失败刷新保留成功结果、旧版本 Event 不进入 active Registry。
- `docs/DEVELOPMENT.md:37-44` 的跨层数据流是 `Floor-bound BiologicalEvent[]`；`:50-54` 保留 `events[]` 与 subject/source 0/1/N 语义；`:60-70` 定义 Floor Version、失败 refresh 与 Runtime DTO；`:74` 仍把稳定 ID/source/raw 字段放入调试区。
- `docs/DATA-MODEL.md:109-114` 规定 AI 返回 `events[]`、Runtime 按 ordinal 生成 identity；`:131-133` 规定 Floor `events[]` 是当前消息/版本的事实集合、失败保留旧成功结果；`:173-181` 规定 Registry 引用 Event ID、普通 Characters 不展示 decision diagnostics、Runtime DTO 仍含 Floor Version/Registry 摘要。
- `docs/CONTEXT-AND-PROMPT.md:161-182` 约束的是送入模型的 narrative presentation 与 Runtime provenance，不显示 floor/message/hash 给模型；它不能直接证明 Product UI 应隐藏这些字段，需避免混淆 Prompt 隐私边界与 UI 展示边界。

#### 建议的修改边界（仅审计建议，未实现）

1. **Cardinality 层**：先在 PRD/design 中明确“多条 AI Event 是拒绝还是合并”。如果目标确实是每个 Target Floor Version 保存 0/1 条 consolidated Event，建议由 protected Output contract + parser/runtime 共同 enforce `events.length <= 1`，并给出专用 diagnostic path（例如 `$.events`）；不能只在 UI 隐藏第二条，也不能把 `counterpart_ids[]` / `gestational_subject_ids[]` 改成单值。
2. **Consolidation 语义**：若允许 analyzer 返回多条再由 Runtime 合并，必须先定义不同 `type`、`status`、Story Time、location、participants、evidence、physical effect 的冲突/去重规则；当前 `core/events.js` 只知道“一个 Event”，没有可直接复用的多 Event aggregate contract。没有该定义时，拒绝多条比静默合并更可验证。
3. **Runtime 保存/失败边界**：成功路径应明确断言 Floor save payload 与 `current_floor_events` 数量只能为 0/1；多条响应失败时不得写部分 Event。保留现有同版本失败 refresh、编辑后旧版本失效、取消/stale late result、Floor save failure 和 Registry failure 回归。
4. **普通 Product UI**：移除 `ui/characters.js` 的 exposure/character debug details、`ui/events.js` 的 ID/source/structured details、`ui/overview.js` 的 visible Floor Version/hash/Event ID/Registry Summary（具体保留哪些用户状态需在 PRD 定义）。保留操作所需的 `data-bioweave-event-id`、Runtime source 和内部 DTO，不把“不可见”误实现为删除业务 identity。
5. **显式 Debug surface**：`ui/app.js:613-692` 的 SillyTavern DISPLAY Popup 与 `ui/settings.js` 的高级/调试入口可作为唯一 raw/provenance 检查面；应测试普通 route markup 与 Popup markup 分离，而不是把 Debug Popup 的能力整体删除。
6. **文档/spec/test 同步**：至少更新 `.trellis/spec/domain/event-pipeline.md`、`docs/UI.md`、`docs/DEVELOPMENT.md`、`docs/DATA-MODEL.md` 中的 `events[]`/debug/source/UI 断言；保留 `docs/CONTEXT-AND-PROMPT.md` 的模型输入 provenance 规则，除非新的 Output contract 也改变 Prompt。同步修正当前期待 debug/source 的 UI tests，并新增“普通页面无内部字段、显式 Popup 仍可诊断”的回归。

#### 建议新增/调整的测试

- **Prompt/parser**：空数组成功；单条 consolidated Event 成功；两条合法 Event 产生明确 reject（或按批准的 consolidation 规则得到唯一 Event）；错误 path/code 稳定；单条 Event 内多个 subject/source/evidence 仍可用。
- **Runtime**：成功响应、Floor save payload、`event_count`、`current_floor_events` 和 active Registry 均满足 0/1；多条响应不会写半结果；同版本 force failure 保留旧成功 Event/last_success；编辑版本 failure 让旧 source inactive；cancel/stale/late response 不覆盖新执行。
- **Core**：继续测试单个 Event 的 0/1/N `counterpart_ids` 与 `gestational_subject_ids`，以及 exposure consistency；只有在 domain 明确新增 Floor aggregate contract 时才增加列表 cardinality validator。
- **Characters/Events/Overview**：普通 route 的 rendered HTML 不包含可见的“调试信息/标识信息/结构化标识/来源与调试信息”、`event_id`、`character_id`、source keys、Floor Version/hash/Registry Summary；同时保留用户可读 type/status/time/location/相关对象、计数、错误空态、edit/delete 行为。测试应区分可保留的 `data-*` 操作属性与可见文本/raw `<code>`。
- **Debug Popup**：显式触发 `open-analysis-debug` / `world-model-view-input` 时仍能显示临时 preview/raw messages；Popup 不应出现在普通 page `main.innerHTML` 中。现有 `tests/ui.test.js:509-795` 可作为保留边界。
- **真实宿主**：按 `.trellis/spec/frontend/quality-guidelines.md:55-64` 补 Desktop/Tablet/Mobile SillyTavern smoke，确认普通页面展开/切换、Popup、事件编辑与无横向溢出；Node 通过不等同于宿主验收。

## External references (docs, versions)

- 未使用外部网络资料；本审计针对仓库源码、项目 docs 与 Trellis specs。
- 运行环境/测试基线由 `package.json:6-14` 定义：ES module、Node `>=18`，`npm test` 执行 `node --test tests/*.test.js`。
- 真实宿主验证要求来自 `.trellis/spec/frontend/quality-guidelines.md:55-64`；本次只执行 Node 测试，没有启动 SillyTavern 或浏览器 smoke。

## Related specs

- `.trellis/spec/domain/event-pipeline.md:45-61`：当前 AI DTO 与 Runtime identity 绑定；这是 One Floor cardinality 需要更新的主要 domain spec。
- `.trellis/spec/domain/event-pipeline.md:112-119`：当前 UI boundary 仍允许 Character exposure card 显示 debug identity，与新的普通 Product UI 去内部字段目标冲突。
- `.trellis/spec/domain/event-pipeline.md:137-173`：Business DTO、失败 refresh、active Event 过滤与 UI mount 不触发分析的现有契约。
- `.trellis/spec/frontend/component-guidelines.md:106-115`：页面模块应返回 presentation HTML，使用空状态，不建立第二套 UI store。
- `.trellis/spec/frontend/component-guidelines.md:166-171`：复杂 Analysis Debug 必须使用宿主 DISPLAY Popup，支持把 raw/provenance 从普通页面移出。
- `.trellis/spec/frontend/quality-guidelines.md:55-76`：Node/host smoke 验证边界。

## Caveats / Not Found

- 没有发现任何 `events.length > 1` 拒绝、`maxItems: 1`、consolidated Event merge helper 或 Floor-level cardinality validator；当前多 Event 是设计/测试可达路径。
- 没有发现 CSS 文字生成或针对 `.bioweave-event-debug` / `.bioweave-inline-debug` / `.bioweave-structured-identifiers` / `.bioweave-event-source` 的隐藏规则；仅靠折叠 details 不会从 DOM/产品页面移除内部字段。
- 本次没有修改产品代码、spec、docs、tests，也没有 commit/push；唯一应写入的产物是本 research 文件。
- “consolidated BiologicalEvent” 的字段合并规则在现有 docs/spec 中未定义，尤其是跨 Event type、冲突 status/Story Time/location 与 participants/evidence 的处理；在实现前必须由主任务确认。
- 现有文档同时使用 `BiologicalEvent[]`、单个 Event 内 0/1/N ID 与 Character debug/source details；One Floor 与 Product UI 新边界不能通过简单替换一个字符串完成，需同步修改 contract、runtime 测试和 UI 验收断言。
- `npm test` 的 368/368 通过只说明当前 Node 回归与当前旧 UI 契约一致；它不能证明刷新后的 SillyTavern 安装、真实 Popup、实际 swipe storage 或 Desktop/Tablet/Mobile 展示已经验收。
