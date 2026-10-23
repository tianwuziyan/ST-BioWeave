# 技术设计：受孕前观察事件支线生成与持续推进

## 1. 设计目标

在不改变 Event 事实权威、Floor 所有权和现有 Generation boundary 的前提下，为人物级 Projection 增加一个“候选设计 → 两条正文后唯一选线 → 单线推进 → 事实终止”的闭环。

设计坚持三个边界：

1. 支线只引导剧情，不生成生物事实；
2. 所有权威状态均由当前有效 Floor 完整快照提供；
3. API 只在正文完全 settle 后运行，`GENERATION_STARTED` 只读注入。

人物身份采用“内部稳定 ID、模型可读名称”的双层边界：Floor 状态和 Host 路由使用 canonical `subject_id`；发给模型的内容使用 `display_name`、必要 aliases 和人物资料。禁止把裸 ID 当作模型理解人物的唯一信息。

## 2. 已确认现状与前置修复

### 2.1 可复用能力

- `projection_timeline.triggered_snapshots` 已实现人物级完整快照、显式空集合、endpoint 向前读取和 sibling preservation。
- `projection-context` 已拥有 `bioweave_projection_context` 注入槽，不需要第二个 extension prompt slot。
- Projection delivery/readback、Floor persistence coordinator、六字段 Floor Version、active Swipe 与异步 stale guard 可以复用。
- `pregnancy_lifecycle:not_pregnant`、`pregnancy_confirmation` 和 archive/release 已有 domain/runtime 基础。

### 2.2 实现门禁

先完成 10-21 遗留的三个 P1，否则不接入新支线：

- triggered snapshot readback 比较完整预期内容，而不是只查人物存在；
- terminated triggered snapshot 不再被当前 derived event 重新匹配；
- active triggered item 必须至少有一个合法 `event_id`。

### 2.3 已发现事实闭环缺口

Event domain 支持 `pregnancy_lifecycle`，但当前 Event Analyzer 提示没有列出该类型。未孕事实的业务主体应是人物：Analyzer 只识别正文中哪个 `subject_id` 被明确判定未孕，不读取、选择或输出 `cycle_id`。现有 canonical lifecycle schema 仍要求 `cycle_id`，因为 archive/release 必须知道清理哪一批 Exposure；这个值由 Runtime 在接受人物事实后，从当前合法 Floor 的该人物活动观察中解析并补入，而不是交给模型决定。

## 3. 模块边界

为避免继续膨胀 `runtime/events.js` 和 `runtime/projection-runtime.js`，增加三个轻量 owner：

- `core/projection-storyline.js`：schema、确定性 ID、纯状态转换、完整快照验证与 endpoint reducer。
- `ai/projection-storyline.js`：设计/选线/推进消息构建器和严格 JSON parser；无存储访问。
- `runtime/projection-storyline-runtime.js`：settle 后编排、single-flight、计数、API 调用、stale/readback、事实终止。

现有模块只做窄接线：

- `storage/projection.js` 与 `core/projection-persistence.js` 扩展同一 `projection_timeline`。
- `runtime/projection-context.js` 将支线段落合并进已有 Projection Context。
- `runtime/events.js` / `runtime/event-analysis.js` 只接 lifecycle 回调和受限观察引用，不承载支线业务状态机。

不新增 Factory/Registry/Repository/Service 层，不新增持久化 root，不新增 UI。

## 4. 持久化模型

### 4.1 projection_timeline 扩展

在现有 root 中增加：

```text
storyline_snapshots: StorylineSubjectSnapshot[]
storyline_snapshot_complete: boolean
storyline_delivery_records: StorylineDeliveryRecord[]
```

`storyline_snapshots` 是 endpoint 权威产品状态；`storyline_delivery_records` 仅记录“哪次注入对应哪条成功正文”的可追溯回执，用来证明计数资格，不是第二状态源。

`storyline_snapshot_complete=true` 即使数组为空也有权威性。兼容旧 Floor 时，字段缺失表示该 Floor 没有写过支线快照，不表示显式空。

### 4.2 StorylineSubjectSnapshot

```text
schema_version: 1
subject_id: canonical character id
status: candidates | selected | terminated
branches: exactly 3 when candidates; exactly 1 when selected; [] when terminated
selected_branch_id: null | existing branch id
current_node_index: null | bounded integer
cadence:
  phase: selection | progression
  valid_response_count: 0 | 1 | 2
  due_attempt_id: null | deterministic id
  counted_response_versions: up to current two-version window
termination_reason: null | pregnancy_confirmed | not_pregnant
created_at_floor_version: complete six-field version
updated_at_floor_version: complete six-field version
```

每条 branch：

```text
branch_id: deterministic from design source Floor + ordinal
title: bounded text
premise: bounded non-factual setup
nodes: 3..5 ordered {node_id, goal}
conclusion_goal: bounded examination/outcome goal without asserting outcome
```

不持久化原始 prompt、原始 response、概率、API provider/model 参数或完整正文。

### 4.3 Delivery record

回执绑定：`subject_id`、snapshot revision、context fingerprint、submission Floor Version、response Floor Version、generation identity、phase。只有存在可验证的提交回执、随后生成新的合法 Character Floor、且事实分析 settle 成功时，该 response 才可进入 cadence。

回执与 response identity 使用确定性 ID 去重；重复 render、重复 settle 或同一 response 重放不会再次计数。

## 5. 完整快照读写算法

### 5.1 读取

给定 endpoint：

1. 仅遍历当前 Chat 中不晚于 endpoint 的 Floor；
2. 选择各 Floor 的 active Swipe，并校验六字段版本；
3. 从后向前找到最近 `storyline_snapshot_complete=true` 的 Floor；
4. 返回该 Floor 的整个 `storyline_snapshots`，包括空数组；
5. 没有合法完整快照则返回空状态。

禁止合并多个 Floor 的局部集合，禁止读取未来 Floor，禁止从 runtime cache 补数据。

### 5.2 写入

任何人物变化都执行同一流程：

1. 解析并锁定当前 Character Floor owner；
2. 触发态仍读取当前 endpoint；判断是否需要候选设计时读取严格排除当前
   Floor 的前一 endpoint（`floor.index - 1`），避免同一 Floor 的旧分析结果
   阻止重新设计；
3. 事实终止、响应计数和推进继续使用当前 endpoint 的最新完整状态；在内存
   Map 中只替换/删除目标人物，保留 siblings；
4. 写入当前 Floor 的完整有序数组并设置 complete marker；
5. coordinator readback 后比较完整期望 digest；
6. 再次验证 Chat/Floor/Swipe/六字段版本；失败则不报告成功。

因此 20/26/30 楼分别持有 `[A,B]`、`[A′,B]`、`[A′]`，回退 23 楼仍读 `[A,B]`。终止写 `status=terminated, branches=[]`；若所有人物都被清除，可写显式完整空数组，二者都不能向前回退复活旧状态。

## 6. 状态机

```text
ABSENT
  └─ settled triggered + design/readback success → CANDIDATES(count=0)

CANDIDATES
  ├─ valid response → count 1
  ├─ next valid response → count 2 / selection due
  ├─ judge none → keep 3 branches, reset count 0
  └─ judge unique → SELECTED(only chosen branch, node 0, count 0)

SELECTED
  ├─ valid response → count 1
  ├─ next valid response → count 2 / progression due
  ├─ stay → same node, reset count 0
  ├─ advance → next bounded node, reset count 0
  └─ awaiting_outcome → retain last plan, reset count 0

CANDIDATES or SELECTED
  ├─ pregnancy_confirmation fact → TERMINATED(pregnancy_confirmed)
  └─ pregnancy_lifecycle:not_pregnant fact → existing archive/release,
                                               then TERMINATED(not_pregnant)
```

API/parse/persistence/readback 失败不消费 `due_attempt_id`，保留 due 状态供同一确定性 attempt 重试。只有成功提交新完整快照后才清零计数。

## 7. API 合同

### 7.1 设计 API

每个请求预先绑定一个内部 `subject_id`，但模型输入以该人物的 `display_name`、必要 aliases、人物资料、插件 World Model/世界观、其他参考数据、最近合法剧情窗口和 triggered 摘要呈现；不发送世界书。模型不需要输出 `subject_id`；Runtime 将整个响应归入请求已经绑定的人物。输出必须严格为 3 个 branch，每个 3–5 节点。Host 生成确定性 branch ID 或验证 API 只能引用 Host 给出的 branch ID，不接收模型随机永久人物 ID。

Storyline request 使用固定的四段消息分层：SYSTEM 1 放剧情支线规则和 JSON 输出协议；SYSTEM 2 放插件内的世界观、其他参考数据和外部记忆，不再发送世界书；ASSISTANT 只放带 `【近期剧情正文】` 说明的近期/当前正文；USER 放目标人物、已触发生理信号、人物资料、候选/已选支线以及本次任务要求。每段资料都有用途说明，人物、世界和支线资料使用带标题的自然语言和嵌套可读文本，不把 Host DTO、路径化键或候选对象直接序列化成 JSON；响应仍由 Host 按既有 JSON parser 校验。独立 API 不再附加“你是 BioWeave 剧情支线 API……”身份句。每条信号的提示词证据仅按该 triggered item 的 `event_ids` 回查当前 Event `source_evidence[].text`，不得把 `character_profiles` 的 tracking/profile `evidence` 放进人物资料或借给任一信号；Event 不可用时只显示信号。`known_characters` 由专用 formatter 按来源顺序仅输出有昵称的角色，使用 `已知人物 -> 角色名 -> 昵称` 嵌套结构；没有昵称时省略角色，没有任何昵称时省略整个块。Current-Floor 的已触发快照在派生 Event 暂时不可用时仍可保留产品徽标，但 `projection_id` 与 `reaction_concept` 必须同时精确匹配，概念缺失或不一致时失败关闭。

### 7.2 候选判定 API

请求同样已由 Host 绑定单个人物，输入用角色名和人物语境展示该人物，并提供全部 3 个候选及当前两条有效 response 的受限正文。模型只返回 branch 选择，不返回人物 ID。输出字段使用 `branch_id`，由 Host 校验其属于当前候选集合：

```json
{"branch_id":"..."}
```

或：

```json
{"branch_id":null}
```

返回 ID 必须属于当前快照且唯一；任何附加事实主张都被忽略/拒绝。

### 7.3 推进判定 API

请求已绑定单个人物；输入用角色名展示对象，并仅含已选 branch、当前节点和两条有效 response。输出 action 只能是 `stay|advance|awaiting_outcome`。它不能输出人物 ID、妊娠结论、Event 或新 branch。

## 8. Prompt 注入

继续使用 `bioweave_projection_context`：

- 候选阶段提供 3 个候选的 ID、标题、前提与开场目标，并要求本次正文主动创造条件、只启动一个，不向读者显示内部 ID。
- 已选阶段只提供选中 branch 的当前节点、必要的前后衔接和检查结论目标，明确禁止换线。
- `awaiting_outcome` 时引导剧情自然形成检查/诊断结果，但不规定结果为怀孕或未孕。

`GENERATION_STARTED` 只重建和写 transient context。设计、判定、计数和持久化全部在完成后的 lifecycle orchestration 中执行。

## 9. 事实闭环

Event Analyzer 继续复用现有 identity projection，但每个候选必须同时提供模型可读的 `display_name`/aliases 与 Host 身份引用；模型根据姓名和正文语境识别人，不能只面对裸 ID。Host 再把识别结果解析为明确未孕事实所属的 canonical `subject_id`。不把内部 `cycle_id` 暴露为模型需要理解或复制的字段。

Event Analysis 接受结果后，Runtime 使用 `subject_id` 从当前合法 Floor 的 Tracking/Aggregation/Lifecycle read model 解析该人物未 release 的活动观察。该步骤只负责把事实映射到既有 cleanup scope：能确定时由 Host 补齐 canonical lifecycle fact 的 `cycle_id`；不能确定时保留人物事实处理的可重试诊断，不执行可能波及其它周期的 archive/delete/release。

Event prompt 明确：

- 只有正文明确给出目标人物未孕结论，才可输出人物级 `not_pregnant` candidate；
- candidate 必须绑定现有 canonical `subject_id`，不得输出或猜测 `cycle_id`；`pregnancy_id` 为 `null`；
- 普通阴性检查、暂未检出、仍不确定或其它疾病诊断不能自动等于本轮未孕；
- 支线提示和判定响应都不是事实证据。

Runtime 先校验 subject/source Event/Floor，再按 `subject_id` 解析当前 cleanup cycle 并由 Host 构造 canonical lifecycle fact。未孕先完成既有 archive/delete/readback/release/readback，再写 storyline terminal；无法解析或中途失败时保留可重试状态，不误清历史周期。怀孕 confirmation 可直接写 storyline terminal，但不创建后续支线。

## 10. 并发、失效与恢复

- design/judge 分别按 `chat + subject + source revision/attempt id` single-flight。
- API 前后均执行 owner/epoch/Floor Version guard。
- 通过 coordinator 以 projection owner 写同一 root，完整 readback digest 防止 sibling 丢失。
- message edit/delete、Swipe switch/delete、Floor 回退、Chat switch 后全部由 endpoint 重新解析；内存 Map 只可加速，不能恢复状态。
- Character/All clear 由现有 `projection_timeline` lifecycle registry 自动覆盖新字段；World clear 不单独删除人物 Floor 支线，除非既有合同要求整个人物域失效重建。
- schema 旧版本缺字段时只读为空；不做历史 Floor 回填迁移。

## 11. 文档、UI 与可观测性

- Settings 高级调试复用现有 business.debug/diagnostics/TXT 导出接点，增加只读 Storyline Debug；不增加产品推演页控件，也不增加 UI 数据源。
- Runtime 维护有界 storyline execution trace，诊断投影展示当前完整快照、delivery receipts、读写结果和顺序事件；正文仅保留 Floor 引用、数量、fingerprint/长度。
- 更新 `docs/ARCHITECTURE.md`、`docs/bioweave-data-lifecycle.md`、`.trellis/spec/domain/floor-state.md`，描述 owner、完整快照、清理与异步保护。
- 诊断只记录安全枚举、subject、phase、计数、attempt/result code 和 Floor provenance；不记录正文、prompt 或原始 API response。

## 12. 回滚策略

- 新字段是同一 schema 的可选扩展；关闭 runtime 接线后旧读取方忽略它们。
- 任一阶段失败可先停用 storyline orchestration，同时保留合法历史 Floor 数据，不需要修改旧楼或 destructive migration。
- Event Analyzer 的未孕入口只负责人物事实；Runtime 的 cleanup binding 可独立关闭，无法安全解析当前人物活动周期时不执行清理。
