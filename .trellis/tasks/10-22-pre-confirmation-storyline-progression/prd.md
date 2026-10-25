# 受孕前观察事件支线生成与持续推进

## Goal

当人物首次进入 Projection“已触发”后，在正文完全结束且当前 Floor 仍有效时设计一批非事实剧情支线；下一次正文必须主动创造条件启动其中一条，随后只沿该支线推进，直到正文事实确认怀孕或未孕。

## Background / Confirmed Facts

- 支线是人物级 Projection 剧情引导，不是 BiologicalEvent、健康事实、妊娠事实或当前生理状态。
- 支线身份只按 `subject_id` 判断；本阶段不增加周期 fingerprint、观察实例或 pregnancy identity 作为产品层读取键。
- `subject_id` 是 Host 内部身份键，不是给模型理解剧情的显示文本。所有支线 API 都必须提供角色名及必要的人物语境，禁止只发送裸 ID；设计/选线/推进请求按单人物预先限定作用域，模型无需输出人物 ID。
- 独立语义判定频率已确定为每 2 条有效支线正文一次。
- 每批固定生成 3 条候选支线；每条包含 3–5 个有顺序的剧情节点，每个节点各自拥有一个结论目标。
- 选线后删除未选候选，但保留已选支线计划直至事实确认怀孕或未孕。
- 当前没有确定“自然进入下一个周期”时的自动清理节点；本阶段仅保留后续扩展钩子，不实现周期自动清理。
- Floor 数据采用完整快照：20 楼 `[A, B]`，26 楼修改 A 后为 `[A′, B]`，30 楼删除 B 后为 `[A′]`；回退 23 楼只能读取 20 楼 `[A, B]`。

## Requirements

### 1. 触发与设计

- 人物第一次进入“已触发”后，必须等待正文、流式输出和 Generation settle 全部结束，并重新验证当前 Character Floor、active Swipe 与六字段 Floor Version，才可请求支线设计 API。
- 非第一次观察到“已触发”时，判断是否需要设计只读取当前 Floor 之前的最近合法人物支线快照：没有内容则补设计；已有候选或已选支线则不得重复设计。当前 Floor 已经写入的旧支线不参与这个存在性判断，因此同一 Floor 反复分析时可以重新设计并替换当前人物数据；写入仍保留同批其它人物。
- 设计 API 使用受限的当前正文上下文、人物信息、插件 World Model/世界观、其他参考数据、外部记忆和已触发信号，不发送世界书；固定返回 3 条彼此可区分的支线；每条有稳定 `branch_id`、标题/前提和 3–5 个有序节点，每个节点包含 `title`、`objective`、`completion_signal`、`conclusion_goal`。
- 已触发信号的模型可读证据只从该信号 `event_ids` 对应的当前 Event `source_evidence[].text` 获取，并显示在对应信号下；人物资料中的 tracking/profile `evidence` 不进入支线请求。其他参考数据中的已知人物只保留有昵称的角色，按来源顺序显示角色名和昵称；没有昵称时省略该角色，没有任何昵称时省略整个已知人物块，第一项不得与“已知人物”父标题挤在同行。
- 设计、选线和推进 API 面向模型显示 `display_name`、必要 aliases 与人物资料；内部 `subject_id` 只由 Host 用于读取、写入和请求结果归属，不得作为唯一的人物说明文本。
- 支线可通过主动就医、其它不适就诊、传统诊察、事故后入院等直接或间接契机走向检查；结果可以是怀孕、未孕、肠胃问题或其它非妊娠原因，设计阶段不得预写事实结论。
- 结构化结果通过 schema、owner/Swipe/Floor Version stale guard 和持久化 readback 后才算成功；不持久化原始 prompt、原始响应、概率或敏感正文。

### 2. 正文注入与唯一选线

- 候选阶段在下一次正文生成前注入全部 3 条候选，明确要求正文只启动一条，并主动创造符合上下文和世界设定的自然条件；不得因“当前情节不适合”而无限延期。
- 正文不需要输出隐藏标记；独立判定 API 根据完整正文和候选 ID 做语义判断。
- 只有已成功注入该人物支线上下文、随后完全 settle、形成合法 Character Floor 且完成所需事实分析边界的 AI 正文才计数。流式 token、重复 render、失败/取消生成、User 楼、无支线上下文的正文和 stale Floor 均不计数。
- 候选阶段累计到 2 条有效正文后，判定 API 返回唯一 `branch_id` 或“尚未唯一起线”。不能唯一判断时保留全部候选、计数归零、继续强制选线，不重设计也不猜测。
- 唯一选线确认后，在当前 Floor 的完整快照中删除其它候选和候选选择提示，只保留已选支线的全部节点、当前游标和推进状态；以前 Floor 不变。

### 3. 已选支线持续推进

- 已选阶段只向正文注入所选支线和当前自然推进目标，不再发送其它候选，不允许换线。
- 选线后计数重新开始；每累计 2 条有效支线正文，判定 API 只判断 `stay`、`advance` 或 `awaiting_outcome`。
- 每次只推进自然的下一步，不把所有节点一次性强塞给正文。
- 节点走完但没有合法怀孕/未孕 Event 时，继续保留已选支线并引导形成自然检查结论；判定 API 不得创造或替代事实 Event。
- 判定请求失败、响应非法或持久化失败时必须失败关闭：保留到期状态以便幂等重试，不丢候选、不推进游标、不重复计数。

### 4. 事实闭环与清理

- 只有正文明确写出的检查、症状、怀疑或诊断，才允许现有 Event Analyzer 产生 `medical_event`、`physical_symptom`、`pregnancy_suspicion`、`pregnancy_confirmation` 或 `pregnancy_lifecycle:not_pregnant`。
- 明确未孕首先按角色名与正文人物语境识别；Event Analyzer 的 identity context 必须把 `display_name`/aliases 与 Host 身份引用成对提供，不能只给裸 ID。Host 将模型识别结果解析为 canonical `subject_id`；AI 不负责选择、返回或猜测 `cycle_id`。Runtime 随后从当前合法 Floor 状态解析该人物正在观察的内部周期，并把既有 lifecycle schema 所需的 `cycle_id` 补入 canonical fact，用于精确归档、删除本轮 Exposure 和释放本轮锁；不能安全解析时不得误清其它历史周期。
- 合法 `pregnancy_lifecycle:not_pregnant` 复用既有 Pregnancy Lifecycle archive/release：归档本轮证据，从当前 Floor 完整 Event 集合删除本周期已接受的 Exposure Events，释放 cycle lock，并终止当前受孕前 Projection/triggered/storyline 活动态。历史 Floor、历史 Aggregation 与归档证据不变。
- 合法 `pregnancy_confirmation` 只终止并清空当前受孕前 storyline 推送状态；怀孕后的新推送内容属于后续任务。
- 周期自然变化、观察窗口到期或其它未确定节点不自动删除支线；仅预留明确的终止入口。

### 5. Floor 所有权与读取

- 所有生成、选线、推进、删除和终止写入只提交到操作发生时的当前合法 Character Floor 与 active Swipe；禁止修改、补写或清除此前 Floor。
- 判断是否需要候选设计时，先读取严格排除当前 Floor 的前一 endpoint；事实终止、响应计数和推进则继续读取当前 endpoint 的最新完整状态。所有变化在内存中应用后写入当前 Floor；同一 Floor 重复设计只替换目标人物，必须保留同批其它人物。
- endpoint 读取只取当前 Chat 中不晚于 endpoint、active Swipe 且六字段 Floor Version 有效的最近完整快照；禁止读取未来 Floor、跨 Floor 合并局部 patch，或用 Chat/runtime cache 覆盖事实。
- 删除最后一条或终止时必须写显式完整空/终止快照；空集合具有权威性，不能向前回退复活旧数据。
- `GENERATION_STARTED` 只从最近合法完成 Floor 只读重建注入上下文，不得在该边界调用设计/判定 API 或写 Floor。

### 6. Debug 可观测性（已实现）

- Settings 的当前生产业务 Debug 展示当前 Floor 重建的 storyline 完整快照、submission/response 回执和有界执行顺序。
- Runtime 只记录安全诊断摘要：阶段、时间序号、Floor/Swipe provenance、人物名/subject、状态、attempt/due ID、计数、fingerprint/长度和结构化分支摘要；不记录完整正文、prompt、原始 API response 或凭据。
- 同一安全 DTO 进入现有 TXT 导出；诊断 trace 只保存在 bounded Runtime buffer，Floor 快照仍是唯一权威状态。

## Out of Scope

- 怀孕确认后的妊娠期新支线。
- 基于自然周期变化或观察窗口到期的自动清理策略。
- 新的普通产品 UI、支线编辑器或用户手工选线。
- 用支线或判定结果直接改写 BiologicalEvent、Current Biological State、World Model 或妊娠状态。
- Chat-level、Runtime-level 第二事实源，或新的持久化根。

## Acceptance Criteria

- [ ] settle 前没有设计 API 请求或支线写入；settle 后人物无支线时恰好设计一次，重复生命周期事件不重复请求。
- [ ] 每次设计严格得到 3 条候选，每条 3–5 个有序节点且每个节点都有 `conclusion_goal`；非法响应不落盘。
- [ ] 支线 API 中人物以角色名和人物语境呈现，模型不会只收到裸 `subject_id`；单人物请求的输出不要求模型回传人物 ID，Host 仍能将结果稳定写回正确人物。
- [ ] 每条已触发生理信号只携带其 `event_ids` 命中的 Event 证据；人物资料不混入暴露/profile evidence；没有可读 Event 证据时仍保留信号。已知人物只保留有昵称的角色，保持来源顺序并使用一致的角色名/昵称嵌套列表；没有任何昵称时不发送已知人物块。
- [ ] 候选阶段正文 prompt 强制主动创造条件并只启动一条；达到 2 条有效正文前不调用语义判定。
- [ ] 第 2 条有效正文后恰好判定一次；不能唯一选线时保留候选、计数重置，不重设计、不猜测。
- [ ] 唯一选线后当前 Floor 只保留所选支线，后续 prompt 只含该支线；历史 Floor 仍能恢复当时的完整候选集合。
- [ ] 已选阶段每 2 条有效正文判定一次并只做保持、前进或等待事实结论；不允许换线。
- [ ] API 失败、非法响应、stale callback、readback 失败均不丢状态、不重复计数，并可安全重试。
- [ ] 20/26/30 楼示例及回退 23 楼的读取结果符合完整快照合同；显式空快照不会复活旧支线。
- [ ] 多人物快照中修改或终止一人不会删除其余人物状态。
- [ ] 判定器声称剧情完成但没有合法事实 Event 时不清理；继续引导自然检查结论。
- [ ] 明确未孕由正文事实按人物 `subject_id` 归属；AI 输出不依赖也不暴露 `cycle_id`。Runtime 只把当前人物的活动周期作为内部 cleanup binding，完成现有 archive/release 与本功能终止；无法定位 cleanup 范围时不误删其它周期并保留可重试状态。
- [ ] 明确怀孕由合法 `pregnancy_confirmation` 终止受孕前支线，不在本任务生成妊娠期新内容。
- [ ] 删除消息、切换/删除 Swipe、回退、Chat 变化、Character/All clear 和正文编辑后，状态按 Floor/lifecycle 合同重建且无幽灵支线。
- [ ] 自动化测试覆盖触发、去重、固定候选结构、计数、选线、推进、事实闭环、完整快照、并发/stale 与失败恢复。
- [ ] real-host 验收证明：正文结束后才设计；下一次正文主动起线；后续只沿同一支线推进；事实确认后停止注入。

## Technical Notes / Prerequisites

- `10-21-projection-reaction-semantic-matching` 的三个 P1 是实现前门禁：triggered snapshot readback 校验完整预期内容；terminated snapshot 不得继续匹配当前 derived event；active snapshot item 不得接受空 `event_ids`。
- 现有 `projection_timeline.triggered_snapshots` 已提供最接近的完整快照范式；新状态应扩展同一 Floor-owned root，而不是新建 Chat-level root。
- 参考 ST-SevenDaysCal 的结构化节点、稳定注入和语义定位形式，但不复制其多线并行模型。其普通“面”判定默认每 3 条有效 AI 回复一次；`relocate` 只在显式时光旅行后的首条新回复调用。BioWeave 的每 2 条、候选唯一选线和单线持续推进均为本项目自己的合同。
- 当前 Event domain 已支持 `pregnancy_lifecycle`，但 Event prompt 尚未给出明确未孕类型，Runtime 也缺少“人物事实 → 当前活动周期 cleanup binding”的受控桥接；实现必须补齐该入口且不改变 Floor 持久化所有权。
