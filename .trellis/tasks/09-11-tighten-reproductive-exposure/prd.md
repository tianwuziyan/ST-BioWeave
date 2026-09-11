# 收紧妊娠相关实际暴露判定

## Goal and product value

BioWeave 的 `sexual_activity` Event 只表达与妊娠事实直接相关的实际生殖暴露链，不再充当完整 NSFW 行为日志。只有最终形成 `conception-relevant reproductive exposure` 的 gestational subject 与 exposure source 才进入该 Event 的 `participants[]`、`gestational_subject_ids[]` 和 `counterpart_ids[]`；有效防护、体外射精、单纯插入或身体接触不产生妊娠相关参与者。

## Repository audit / confirmed baseline

- 审计时 worktree 干净：分支为 `fix/world-model-prompt-baseline`，HEAD 与 origin 同步，只有本任务目录是新建的未跟踪规划文件；没有既有产品代码改动需要覆盖。
- `ai/prompts.js:27` 当前要求 sexual_activity 提取“全部实际参与者”，`ai/prompts.js:48` 还要求“不要省略实际参与者”，与本任务的直接暴露参与者语义冲突。
- `ai/analyzer.js:1079-1231` 已执行固定字段、角色、数组、证据形状和 `physical_effect` 对象形状检查，但没有检查实际暴露证据与妊娠相关数组的一致性。
- `core/events.js:242-258` 会保留 `physical_effect`，`core/events.js:286-420` 主要验证 DTO 形状、ID 数组和枚举；当前没有要求 `possible_conception` 对应非空 subject/source、participants 引用和暴露证据。
- `runtime/event-analysis.js:745-769` 会在 Runtime 生成 canonical identity 后调用 `validateEvent`，因此 Domain 校验是持久化前的统一入口；本任务不改变 Runtime 的调度、保存或 Registry 所有权。
- `ui/characters.js:123-145,178-195` 当前在人物 exposure card 中渲染 `参与者` 和 `相关对象`；`counterpart_ids` 已经是相关对象名称的来源，但多余的 participants 展示会暴露不属于该人物妊娠链的对象。
- `docs/DATA-MODEL.md:97,177`、`docs/DEVELOPMENT.md:48,73`、`docs/UI.md:23,29,39,43` 仍把 participants 描述为全部参与者，需要同步收紧。
- `core/tracking.js:155-224` 的 eligibility 路径已经按 `sexual_activity`、有效状态、两个 relevance flag、gestational subject ID 和 `can_carry_pregnancy` 判断；本任务保持该实现不变，只让输入 Event 更准确。

## In scope

### R1. Actual exposure business contract

- 对妊娠相关 `sexual_activity`，`participants[]` 只记录实际暴露链中的直接生殖参与者；通常是实际承载暴露的 subject 与实际造成暴露的 source，可支持 0/1/N 个实际 source。
- `counterpart_ids[]` 只记录本次最终实际造成 conception-relevant exposure 的 source ID，不表示所有性伴侣、在场者、能力具备者或所有射精者。
- 保护/Barrier 只作为证据。最终结果优先：完整有效阻隔且未进入有效路径为 false；破裂、脱落、摘除后或其它失效原因导致实际进入有效路径为 true。
- 仅射精、体外射精、插入、身体接触或阻隔外的体液存在，不足以成立 actual exposure；必须有实际 reproductive substance/mechanism 进入有效受孕路径的证据。
- 无 actual exposure 的 `sexual_activity`（如果仍因其它独立生物学价值保留）必须为 `relevant=false`、`possible_conception=false`、两个 ID 数组为空；没有其它 BioWeave 生物学价值时 Prompt 可以不输出该 Event。

### R2. Prompt and AI DTO boundary

- 修改 `ai/prompts.js`：删除“全部实际参与者”“不要省略实际参与者”语义，改成直接暴露链参与者语义；明确排除有效防护未进入、体外射精、仅插入/接触、仅在场和 capability-only 角色。
- Prompt 明确最终实际 exposure 结果优先于是否曾采取防护动作，并覆盖 intact barrier、破裂、脱落、摘除后实际进入等结果。
- Prompt 要求 `physical_effect.gestational_substance_intake=true` 只能由 narrative evidence 支持，并与妊娠相关性保持一致；使用机制中性词汇，不把精液、器官、男性/女性或攻受写成通用 Domain 分支。
- Prompt 对其它 BiologicalEvent 也要求 participants 只保留对该生物事实直接有作用的人，不因在场、说话或普通递送行为自动加入。

### R3. Domain consistency validation

- 在 `core/events.js` 增加轻量、机制中性的实际暴露一致性检查：`possible_conception=true` 时必须 `relevant=true`、subject/source 数组非空、所有 ID 存在于 participants、数组对应合法 participant，并存在结构化 conception-relevant exposure evidence。
- 使用现有 `{kind,text}` evidence 结构增加稳定的通用 evidence kind（例如 `conception_relevant_exposure`）作为可验证标记；Domain 只检查结构化标记和关系，不读取自然语言中的器官、防护或性别词。
- 对 `physical_effect.gestational_substance_intake` 做布尔/空值形状检查；值为 true 时必须有实际暴露 evidence。Domain 不把该字段硬编码为唯一受孕机制，也不根据它自行创建 Tracking Subject。
- 对 `sexual_activity` 的无暴露结果校验 `relevant=false`、`possible_conception=false`、subject/source 数组为空。保持其它 Event type 的固定 envelope 兼容，不扩展 State、Projection、Genealogy 或 World Model 计算。

### R4. Tracking and Runtime boundary

- 不修改 `core/tracking.js` 的 eligibility 条件、Registry 数据形状或决策路径。
- 不修改 Event Analyzer 的调用时机、Runtime Registry 重建、Floor/Swipe identity 或保存语义；只让 Runtime 继续使用更严格的统一 `validateEvent`。

### R5. UI projection

- `ui/characters.js` 的人物 exposure record 保留事件类型、状态、发生时间、地点和唯一的“相关对象”；“相关对象”只从 `pregnancy_relevance.counterpart_ids` 映射 display name。
- 人物 exposure record 不读取/筛选 protection、condom、ejaculation、`physical_effect`、capability 或 `event_role`；不显示全部 participants，也不建立第二套来源字段。
- `ui/events.js` 继续展示 canonical Event 的直接相关 participants 和 relevance 结果；不在 UI 中重新判断 actual exposure。人物列表入口仍只接受 Tracking Registry 中存在的 character ID。

### R6. Tests and documentation

- 增加/更新 Prompt、AI parser、Domain validator、Runtime integration、Tracking regression、人物 UI projection 的测试，覆盖无防护、完整防护、破裂、摘除、脱落、体外射精、无精液暴露、多人单来源、多来源等 0/1/N 情况。
- 更新 `docs/DATA-MODEL.md`、`docs/DEVELOPMENT.md`、`docs/UI.md`，并同步 `.trellis/spec/domain/event-pipeline.md` 中的 participants、counterpart、evidence 和 UI boundary 约定。
- 运行 `npm run check` 与 `git diff --check`；本任务不 commit、不 push。

## Out of scope

- 不实现 StateReducer、biological current state、gestational age、pregnancy probability、StoryTime elapsed calculation、Snapshot、Projection、Genealogy 或关系计算。
- 不修改 Tracking eligibility、Runtime Registry、Event participant filtering 的其它调用边界、World Model、Phase 2B、HistoryRecord 深层架构或 null capability 历史重评估。
- 不建立完整 NSFW 历史、不保存无关 sexual participants、不新增 notes persistence、不让 UI 根据事件文本/角色/能力重新推导 exposure。
- 不把现实人类词汇或精液机制写成 Universal Plugin 的 Domain 分支；现实式语义只存在于 Prompt 说明和抽象 ID 回归测试证据中。
- 不改变顶级导航、Event Analysis 调度、Floor/Swipe storage 或 Git 历史。

## Acceptance criteria

- [ ] Prompt 不再要求 sexual_activity 记录全部实际参与者；Prompt 明确 direct exposure participant、最终 barrier outcome 和 actual reproductive exposure 规则。
- [ ] `possible_conception=true` 的 Event 具有非空 subject/source、两类 ID 都在 participants 中、合法 participant shape，并有结构化 conception-relevant exposure evidence。
- [ ] 无 exposure 的 sexual_activity（若保留）不保存 participants，使用 `relevant=false`、`possible_conception=false`、空 subject/source 数组；不产生 Tracking Subject。
- [ ] 保护完整未进入有效路径、体外射精、无实际 reproductive substance exposure 的测试均为 false；破裂、脱落、摘除后实际进入有效路径的测试均为 true。
- [ ] 多人场景只保留实际 source；单 source 时不保存其它 sexual participant，多 source 时保留所有实际 source。
- [ ] Character exposure card 只显示 counterpart 对应的“相关对象”，不显示“参与者”，且 UI 不读取保护、射精、physical effect、capability 或 event role 来做判断。
- [ ] `core/tracking.js` 资格条件和实现未改动，已有 Tracking/Event/Runtime 测试继续通过。
- [ ] `docs/DATA-MODEL.md`、`docs/DEVELOPMENT.md`、`docs/UI.md` 和领域 spec 明确新的 participants/counterpart/evidence 语义及 UI/Business DTO 边界。
- [ ] `npm run check` 通过，`git diff --check` 通过，未产生 commit 或 push。

## Open questions

无阻塞性问题。World Model 对某机制是否具备受孕能力仍由既有 World Model/narrative evidence 契约提供；本任务只验证结构化暴露证据与 Event 内部引用的一致性，不在 Domain 层推断机制效果。
