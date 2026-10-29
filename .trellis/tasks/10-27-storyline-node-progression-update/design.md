# 技术设计：节点完成后的同支线推进事件

## 1. 设计结论

原始支线的三个节点仍然只是三种不同的初始切入方式，不是顺序步骤。选择其中一个
节点并完成后，流程不能停在原节点，也不能跳到原节点二/三；应该在同一已选支线内
生成一个新的“推进事件”，让正文继续创造条件，直到自然进入检查/事实结论。

因此本轮把状态拆成两个层次：

1. `selected_node_id/selected_node_status` 保留“从哪一个入口进入支线”的历史；
2. 新增一个当前支线专属的 `progression_event` 读写对象，表示现在正文要沿着哪一
   个阶段性方向推进。

`progression_event` 不是新的事实源，也不是第二条支线。它只在当前 Storyline
snapshot 内保存当前 Floor 的完整剧情引导；前一个推进事件仍可作为历史摘要保留，
但不会继续作为当前目标重复注入。

状态示意：

```text
候选三支线
  -> 选择支线 + 初始入口节点
  -> 初始入口节点完成
  -> 根据入口节点 + 近期正文生成 progression_event
  -> 正文沿当前支线创造条件
  -> progression_event 完成
      -> 生成下一 progression_event
      -> 或 awaiting_outcome，等待 Event Analysis 事实
  -> 合法怀孕/未孕事实
  -> 既有终止/清理路径
```

关键语义：`complete` 是“当前推进事件完成，可以生成下一阶段”，不是整条支线
结束；`awaiting_outcome` 才是“暂时等待检查/事实结果”；`stay` 是继续当前推进
事件。

## 2. 当前根因

当前代码只保存了 `selected_node_status=completed`，没有独立的下一阶段对象：

```text
正文 settle
  -> Judge 返回 complete
  -> 当前 Floor 保存 selected_node_status=completed
  -> context 仍从 selected_node 读取 objective/completion_signal
  -> 下一楼继续收到“密室切脉与病症陈述”旧内容
```

同时，progression Judge 仍把已选支线的所有原始节点写入请求，容易让模型把节点二、
节点三误当成后续步骤。需要把“初始入口节点”和“动态推进事件”分开。

## 3. 数据结构与兼容边界

### 3.1 `progression_event` 最小字段

字段名按现有代码风格落地，建议包括：

- `progression_id`：插件内部当前推进事件令牌；不发送给正文 API 作为人物身份。
- `source_node_id`：表示本推进事件从哪个入口节点产生，用于追溯。
- `status`：`active`、`completed`、`awaiting_outcome`。
- `title`：阶段性推进事件标题。
- `guidance`：跨楼层的引导方向和条件创造要求，不写连续动作脚本。
- `completion_signal`：正文可以表现出的阶段完成信号。
- `conclusion_goal`：该阶段可能引出的后续检查/确认目标。
- `created_at_floor_version`：当前 Floor provenance。

如需保留历史，使用有限长度的 `progression_history` 摘要；不得把完整正文、raw
Prompt 或 raw API response 写入 snapshot。

实现前需根据当前 schema/读回约束决定是否提升 schema version。无论是否升级，旧
snapshot 都必须能够归一化读取为“无 progression_event 的已选支线”，并通过当前
Floor replacement 迁移；不能重写历史 Floor，也不能改变已有 branch/node ID 的含义。

### 3.2 当前读模型

- 初始候选阶段：展示三条支线及每条支线的三个独立入口节点。
- 已选但尚未完成入口节点：展示入口节点的 objective、completion_signal、
  conclusion_goal。
- 入口节点已完成且尚未生成推进事件：显示“正在生成后续推进事件”，短暂不把旧节点
  当作当前目标。
- 已有推进事件：只展示当前推进事件的 title、guidance、completion_signal、
  conclusion_goal；入口节点只作为已完成历史摘要。
- `awaiting_outcome`：只展示当前阶段的等待边界和结论目标，不继续生成推进事件。

## 4. 模块边界与改动点

### 4.1 `core/projection-storyline.js`

- 增加 `progression_event` 的 normalize/validate/创建与安全摘要函数。
- 保持原始节点“互相独立”的语义；不要把 `current_node_index` 改回顺序游标。
- 增加纯函数阶段派生，至少覆盖 `candidate_selection`、`node_active`、
  `progression_generation`、`progression_active`、`awaiting_outcome`、`terminated`。
- `buildStorylineContextPrompt()`：
  - 入口节点 active 时渲染入口节点目标；
  - 入口节点完成后，若没有 progression_event，只提示后续阶段正在生成；
  - 有 active progression_event 时只渲染推进事件，不再渲染旧入口节点目标/完成信号；
  - awaiting_outcome 时只渲染等待事实结论边界。
- `applyStorylineJudge()` 不再把 `complete` 直接解释为整条支线等待事实；它应把当前
  推进事件标为完成并清空 cadence，交给 Runtime 生成下一推进事件。`awaiting_outcome`
  才把当前推进事件置为等待事实结论。
- `recordStorylineBody()` 和 `storylineJudgeDue()` 针对当前 active progression_event
  工作；没有当前推进事件或已 awaiting_outcome 时不计入 progression cadence。

### 4.2 `ai/projection-storyline.js`

拆分两个 API 语义，但沿用统一的消息排版和数据端口：

1. **推进事件生成 API**：输入已选支线、已完成入口节点、最近正文、人物/世界/事件
   参考；输出一个新的结构化 `progression_event`。
2. **推进事件判定 API**：只输入当前 `progression_event` 和最近正文；输出
   `stay|complete|awaiting_outcome`。

生成 API 的硬约束：

- 不生成新支线，不重新选择原始节点，不让正文每楼重新选线；
- 以“阶段目标/条件创造/完成信号/结论目标”为核心；
- 必须有明显时间或场景跨度，禁止把“走过去—说一句—摸一下—立刻结论”写成连续动作；
- 具体推进机制必须由 API 结合当前世界观、人物关系、组织规则、资源条件、信息流、
  空间/时间约束和近期正文自行选择；插件不得预设医疗、社会、NPC、修仙或任何固定
  场景，也不得把本任务中的示例当成模板内容；
- 可以使用符合当前世界的社会关系、信息传播、制度流程、资源限制、环境变化、第三方
  介入、物证留痕或其它机制，但只能在当前上下文确实支持时使用；
- 已完成入口的原目标与结论目标只作为远期方向；`probable`、`possible`、`suspected`、
  `uncertain`、`inferred` 或等价的“可能/怀疑/疑似/推测”事件记录不进入推进事件的
  参考块，避免把未决判断升级为当前事实；生成结果必须引入新的因果来源或已完成入口的
  外部后果，不得把原场景、角色或动作换名重复；
- 提示词必须把入口方向、当前已确认事实和近期正文分块呈现；入口目标与结论目标只作历史/远期方向，
  不得被模型复述为当前阶段内容。推进输出还必须避开由入口线索直接引出的任何结论性术语，资料不足时
  回退到中性的关系、信息、制度、资源、环境或时间条件引导；设计 API 仍保留完整的已确认事件资料，
  不能套用推进阶段的未决事件过滤。
- 不得把任何症状、行为、第三方判断、怀疑或剧情目标写成怀孕事实；
- 不发送 cycle_id、pregnancy_id、Event/Floor ID 或 raw DTO；如需帮助模型把叙事名称对应到
  已登记人物，只能通过当前 canonical registry 派生的独立只读身份参考正文展示 active
  `character_id`。正文保留 `known_characters`、`display_name`、`character_id`、`aliases`
  原始字段名。Event Analysis 使用同一正文端口承载 Runtime Canonical Character Registry；
  该参考不改变返回协议，模型不得生成、修改或回传人物 ID。

输出字段的示意只用于说明抽象语义，不规定具体内容：

```text
标题：下一阶段的阶段性目标
引导：说明需要跨越哪些场景、关系、规则或条件，才能让当前线索自然进入下一阶段；
      不写成连续动作脚本，也不假定当前世界存在某种固定机构或人物关系。
完成信号：正文中可观察到的阶段性变化。
结论目标：该阶段可能引出的后续检查、确认或信息入口，但不是事实结论。
```

### 4.3 `runtime/projection-storyline-runtime.js`

- 事实闭环仍然优先执行。
- 当入口节点 Judge 返回 `complete` 后，在当前 Floor 使用同一 owner/epoch/stale
  guard 调用推进事件生成 API，并将新 `progression_event` 与已选支线一起完整写回。
- 当当前推进事件判定为 `complete` 时，生成并写入下一推进事件；不得自动换支线或回到
  原始候选节点。
- 当判定为 `awaiting_outcome` 时，停止 progression cadence 和推进事件生成，只等待
  Event Analysis 合法事实。
- 生成 API、判定 API、parser、persist 或 readback 失败时，保留原当前推进事件和
  due 状态；不能把失败当成完成，也不能清理已选支线。
- 同 Floor 重复分析允许替换当前 Floor 的 progression_event，但不得修改之前 Floor。

### 4.4 `runtime/projection-runtime.js`、`runtime/diagnostics.js`、UI

- 安全 DTO 增加 `progression_phase`、当前推进事件标题/状态和来源入口摘要；不暴露
  raw prompt、正文或 raw API response。
- Trace 必须体现：入口节点完成 → 推进事件生成 → 写回/读回 → 正文注入 → 推进判定
  → 下一推进事件或等待事实。
- UI 复用当前支线卡片与节点详情结构；可以把已完成入口节点作为历史摘要，把当前
  progression_event 作为新的当前内容，不创建第二事实源。

## 5. 持久化与生命周期

- 仍只有 `storyline_snapshots` 这一条 Floor-owned 非事实剧情状态来源。
- 当前推进事件和有限历史摘要都随当前 Floor 完整快照写入；历史 Floor 不变。
- 不写入 BiologicalEvent、Current Biological State、pregnancy status 或 World Model。
- 合法怀孕/未孕事实、archive/release、terminal tombstone 继续由既有 Event/Projection
  runtime 处理；本设计不实现周期自动清理或孕后新支线。

## 6. 失败与恢复

| 场景 | 处理 |
| --- | --- |
| 推进事件生成 API/JSON/parser 失败 | 保留已完成入口节点和原 progression_event；本次 settle 不误推进，后续新的 settled Floor 仍可再次生成 |
| 推进判定 API 失败 | 保留当前 active progression_event 和 due attempt，不误生成下一步 |
| current Floor/Swipe/owner 改变 | stale callback 丢弃，不写当前或历史 Floor |
| Chat reload/rebind 在请求或写回途中到达 | 取消并排空在途 Projection/Storyline；只读恢复上下文，不登记 submission receipt |
| snapshot readback mismatch | 不报告成功，保留可重试状态 |
| 推进快照写回/readback 失败 | `settled()` 返回持久化失败结果；Projection Runtime 仅做只读上下文刷新，避免再次写入 submission receipt，并将本次运行标记为 partial |
| 当前推进事件为 `awaiting_outcome` | 不再生成新推进事件，只等待 Event Analysis |
| 合法怀孕/未孕事实确认 | 复用既有 archive/release/terminal closure |

## 7. 验证重点

- Core：入口节点完成后不再作为当前目标；能生成/渲染新的 progression_event；
  `complete` 触发下一阶段，`awaiting_outcome` 才停止。
- AI：生成 API 输出单个阶段性引导；只含当前已选支线和入口节点上下文；判定 API
  不携带原始其它节点；由当前世界观决定推进机制；跨度/非连续动作/事实边界规则有 regression。
- Runtime：节点完成后下一次 settle 会生成推进事件；推进事件完成后继续生成下一步；
  waiting 状态不再调用推进 API；事实 Event 仍优先终止。
- Floor：20/26/30 楼完整快照、同 Floor 替换和回退 23 楼仍符合合同。
- Debug/UI：能看出入口节点、当前推进事件、生成/判定顺序与跳过原因，不泄漏正文或 raw API。
