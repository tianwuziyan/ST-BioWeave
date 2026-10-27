# 怀孕确认与知情名单

## Goal

在受孕前观察支线完成后的正文事实基础上，识别目标人物是否已经确认怀孕，并记录哪些角色明确知道这一结果，避免把剧情事实自动扩散成全知信息。

## User Value

- 支线完成后可以形成明确的“已确认怀孕”结论，供后续剧情使用。
- 角色昏迷、不在场或未被告知时，不会因为系统已经识别出怀孕而自动知道结果。
- 后续正文明确让新的角色得知结果时，只追加该角色，不改变历史 Floor 的知情状态。

## Background / Confirmed Facts

- 当前受孕前支线任务已经规定：合法 `pregnancy_confirmation` 事实会终止并清空当前受孕前 storyline 推送状态；怀孕后的新推送内容不在该任务范围内。
- 现有 Event Pipeline 已有 `pregnancy_confirmation` 事件类型，但需要确认其当前 payload、人物归属和 Runtime/UI 消费边界是否足以表达“谁知道”。
- BioWeave 的事实和派生状态必须由当前合法 Character Floor、active Swipe 和四字段 Floor owner 持有；不能增加 Chat-level 或 Runtime-level 第二事实源。
- 所有写入只作用于当前 Floor；读取使用当前 endpoint 之前最近的合法完整快照，回退旧 Floor 时不能读到未来知情名单。
- 内部 `subject_id`/character ID 仅用于归属和持久化；面向 API、Debug 或剧情上下文时仍需提供角色名及必要 aliases，避免模型只看到不可读 ID。
- “其他角色默认不知道”是本功能的明确叙事边界；知情名单只能由正文证据或明确的剧情传播渠道逐步增加。

## Requirements

### 1. 怀孕结论识别

- 只有正文中有符合现有 Event 合同的检查、诊断或其它充分事实证据时，才允许形成“已确认怀孕”。
- 症状、怀疑、支线目标、角色猜测或系统内部推演结果不得直接升级为怀孕事实。
- AI 不能只因为支线完成就宣布怀孕；必须由现有 Event Analyzer 识别并通过 canonical schema、人物归属、Floor stale guard 和持久化 readback。
- 本任务先聚焦“已确认怀孕”；“已确认未孕”的收口和生命周期清理沿用既有合同，若需要扩展只在规划中明确边界，不借此重写现有未孕流程。

### 2. 知情名单

- 知情状态采用独立的 Floor-owned 知识快照，不扩展或改写现有 `pregnancy_confirmation` payload；怀孕事实与角色认知保持两条独立数据边界。
- 每份知情状态必须以 `subject_id + pregnancy_id` 作为妊娠实例归属，Chat scope 由 Floor owner 提供；不得使用一个 Chat 级全局 `known_by` 集合。
- 每个妊娠实例各自拥有独立的知情角色集合。多人同时怀孕时，甲的知情人不得进入乙的名单；同一人物未来不同 pregnancy episode 的名单也不得复用。
- 知情集合中的每个成员以 canonical character ID 保存；显示名称和 aliases 由当前 endpoint 的合法 Character Registry 投影，不把姓名当作持久化身份键。
- 知情集合中的每个角色必须唯一解析到 canonical character identity；无法解析、同名歧义、只有临时称谓或匿名人物时失败关闭，不把临时姓名写入权威名单。
- 可读的显示名称和必要 aliases 只在 API/剧情上下文/Debug 投影时从当前合法 Character Registry 解析，不复制进权威身份键。
- 目标人物是否知情不能默认推断：昏迷、不在场、未被告知时可以不在名单中；只有正文明确表现其知道、亲自获知或通过合理渠道获知时才加入。
- 检查者、在场人物、传播消息者等角色也不能仅凭“在场”自动加入；必须有明确的信息获得证据或由正文建立合理认知链。
- 不在名单中的角色默认不知道，后续正文明确建立知情关系时只追加新角色，不把名单扩展成全体角色。
- 知情名单需要能区分“已知事实”“传闻/猜测”与“未获知”，不能把未经证实的传闻写成已确认知情。
- 第一版权威名单只保存“明确知道已确认怀孕事实”的角色；仅怀疑、猜测、听闻未证实消息的角色不进入该名单。
- 第一版只允许由新正文证据新增知情角色，不因沉默、离场、昏迷或时间经过自动删除/遗忘既有知情关系；未来若需要显式遗忘或纠错，必须另行定义事实证据和删除操作。

### 3. Floor 与生命周期

- 怀孕结论及知情名单必须写入当前合法 Character Floor/active Swipe，并保留 Floor/Swipe provenance。
- 知情状态采用人物集合的完整快照语义，不保存局部 patch，也不跨 Floor 合并局部记录：
  - 20 楼保存 `[A, B]`；
  - 26 楼把 A 修改为 A′时，26 楼保存完整 `[A′, B]`，20 楼仍是 `[A, B]`；
  - 30 楼删除 B 时，30 楼保存完整 `[A′]`，20/26 楼保持不变；
  - 回退到 23 楼时，只读取不晚于 23 楼的最近合法完整快照，即 20 楼 `[A, B]`。
- 修改当前知情名单时只写当前 Floor；必须把未变化的 sibling 一并复制到当前完整快照，此前 Floor 的结论和名单保持不变。
- 删除最后一项时必须写入显式完整空快照，不能因空集合继续向前回退并复活旧知情状态。
- 删除消息、切换/删除 Swipe、回退或正文编辑后，状态必须按 Floor 合同重建，不能遗留未来 Floor 的知情角色。
- 当前怀孕事实终止受孕前观察支线；怀孕后的新剧情推送、妊娠期状态推进和知情名单后续 UI 不在本任务中新增。

### 4. API 与剧情边界

- 怀孕结论识别沿用现有分析 API 的 SYSTEM/ASSISTANT/USER 层级和统一资料端口；不得把原始 JSON 直接塞进 USER。
- 知情候选复用既有人物/Event Analysis 请求与触发频率，不为每条正文新增独立知识判定 API；候选不是 BiologicalEvent，Runtime 校验并绑定身份后才可进入独立知情快照。
- 同一响应中的 Event 与知情候选分别校验：非法知情候选不得使合法 Event 或其它合法知情候选失效；非法 Event 也不得把尚未绑定、尚未持久化的知情候选误报为成功。
- 给 API 的人物必须同时提供角色名和必要人物语境；内部 ID 只作为 Host 归属键，不要求模型输出内部 ID。
- 支线任务、已触发生理信号和待调查线索不能被当作怀孕事实发送或写入知情名单。
- 后续正文上下文只应注入当前已确认的怀孕事实和已知情角色；未在名单中的角色必须保持未知叙事边界。
- 发给 AI 时必须按妊娠实例分层转换为可读角色名，结构至少表达“怀孕人物 → 已知情角色名单 → 其他角色默认不知道”；禁止把不同怀孕人物的知情名单扁平合并，也禁止只发送内部 ID。
- 若当前上下文存在多个已确认怀孕人物，必须逐人独立展示其 pregnancy knowledge，且每组只能使用该 `subject_id + pregnancy_id` 的知情集合。

## Repository Evidence / Technical Notes

- `core/events.js` 与 `ai/analyzer.js` 当前将 `pregnancy_confirmation` payload 限定为 `pregnancy_id`；它是“发生了确认怀孕事实”的 Event，不承载叙事知识传播状态。
- `core/pregnancy-lifecycle.js` 与 `storage/pregnancy-lifecycle.js` 当前的 Floor-owned timeline 保存 lifecycle facts、candidate records、archives 和 release records，没有“谁知道”或增量知情记录。
- `runtime/projection-storyline-runtime.js` 已在合法 `pregnancy_confirmation` 后终止当前受孕前 storyline，但没有知识名单读取、写入或后续上下文注入。
- Event Analysis 已有 `not_pregnant_candidates` 先例：模型可在固定 Event envelope 旁返回候选，Runtime 再进行人物身份和活动周期绑定；候选本身不是 BiologicalEvent。知情变化可沿用同类边界，返回只读候选并由 Host 绑定到 canonical identities 后写入独立知情快照。
- 因此第一版需要在现有 Floor-owned 生命周期/事实边界内增加知情状态的明确归属；不能把名单放到 Chat-level、Runtime cache 或直接混入 `pregnancy_confirmation` 的既有 payload。

## Acceptance Criteria

- [ ] 支线完成但没有合法确认事实时，不生成 `pregnancy_confirmation`，也不产生知情名单。
- [ ] 正文包含合法检查/诊断事实时，Event Analyzer 能按目标人物稳定归属，形成 `pregnancy_confirmation` 并写入当前 Floor。
- [ ] 知情名单只包含正文明确知道或通过合理信息渠道获知结果的角色；昏迷、不在场、未被告知的角色不会被自动加入。
- [ ] 匿名、临时称谓、零匹配或多匹配的知情候选被逐项拒绝；其它合法 Event 和合法知情候选仍可按各自边界保存。
- [ ] 不在名单中的角色在后续剧情上下文中明确视为不知道；新角色获知后只追加该角色。
- [ ] 两名或以上人物同时怀孕时，每个 `subject_id + pregnancy_id` 的知情名单独立读取、更新和回退，不发生跨人物或跨 pregnancy episode 串线。
- [ ] 发给 AI 的知识上下文按怀孕人物分组显示角色名和知情人名称；内部 ID 不作为模型唯一可读信息，不同人物名单不会被扁平化。
- [ ] 人物身份对 API 以显示名称/aliases 呈现，内部 ID 仅用于 Host 归属；不发送裸 JSON 作为资料块。
- [ ] 当前 Floor 修改不会改变历史 Floor；回退时读取对应历史 Floor 的怀孕结论和知情名单。
- [ ] 20/26/30 楼的新增、修改、删除以及回退 23 楼严格符合完整快照示例；显式空集合不会复活旧数据。
- [ ] Swipe 切换/删除、消息删除、正文编辑和 stale/失败 API 不会产生幽灵怀孕事实或幽灵知情名单。
- [ ] 怀孕确认成功后，当前受孕前 storyline 推送停止；怀孕后的新推送内容仍保持后续任务边界。
- [ ] 自动化测试覆盖事实确认、知情名单增量、未知默认、Floor 回退、并发/stale、失败恢复和多人物隔离。
- [ ] real-host 验收确认：只有正文事实确认后才结束受孕前支线，知情名单不会自动扩散到未获知角色。

## Out of Scope

- 怀孕后的妊娠期剧情支线、孕期推送和新的医学事件链。
- 自动推断所有在场人物、所有已知角色或玩家为知情者。
- 基于怀孕事实直接改写 World Model、其它人物资料或历史 Floor。
- 新的 Chat-level/Runtime-level 持久化根、独立周期清理策略或新的普通产品 UI/手动编辑器；第一版只接入现有 Settings Debug 的只读诊断。
- 重新设计现有 `pregnancy_lifecycle:not_pregnant` 的清理流程。
- 自动遗忘、撤销或基于沉默删除知情关系。

## Decisions

- 权威知情名单只接受唯一 canonical character ID；匿名医生、临时称谓和歧义姓名不进入名单。
- 第一版不增加普通产品 UI 或手动编辑器，先完成事实识别、Floor 快照、上下文约束和 Settings Debug 只读验收。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
