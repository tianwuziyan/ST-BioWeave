# Phase 2A.1 Pregnancy-Relevant Exposure / Reproductive Mechanism Generalization

## Goal

在进入 Phase 2B StateReducer 前，收口 BioWeave 的 pregnancy-relevant
reproductive exposure 边界：确认 Event Analysis 只保存事实，Tracking 只从
有效 exposure 中解析潜在 gestational carrier，并为非传统世界机制留下开放、
可验证且不依赖自然受精的接口。

本任务只产出代码审计、PRD、技术设计和实施计划；不修改产品代码，不启动
StateReducer、Projection、Snapshot、Genealogy 或完整 Context Injection。

## Hard architecture constraints

- Floor-local analysis results are authoritative. 针对某个 Floor / Swipe 产生的
  `analysis`、BiologicalEvent、character registry/profile observations、exposure、
  mechanism、capability evidence/resolution、pregnancy relevance、source/
  counterpart/subject relations，以及 World Model / metadata（按现有 owner 规则），
  必须保存于产生它们的当前 Floor Swipe owner：
  `message.swipe_info[swipe_id].extra.bioweave`；没有 Swipe structure 时使用
  `message.extra.bioweave`。
- Chat metadata 不得成为任何分析事实的 authoritative owner。不得新建第二套
  Chat-level Event/Profile/Exposure/Mechanism biological aggregate database。
- Runtime 可以跨 Floor 聚合、重建和派生 Tracking Registry、Profiles、Indexes、
  Current State（未来）和 UI DTO，但这些必须可由有效 Floor facts 重建，不能反向
  成为事实来源。
- No legacy compatibility is required during current pre-release development. 不保留
  legacy migration、compatibility alias、deprecated fallback、dual-read、
  dual-write 或旧语义保留；schema、fixtures、parser、validator、normalizer、
  prompt、README/DATA-MODEL/domain docs 直接收敛到正确模型。
- 禁止任何 `can_fertilize -> can_cause_pregnancy` fallback 或 alias。没有独立证据
  时，`can_fertilize: true` 不得改变 `can_cause_pregnancy: null`。

## Background and confirmed constraints

- 当前权威事实仍是当前有效 Floor / Swipe 的 `BiologicalEvent[]`；Registry、
  Profile、Tracking Candidate/Subject、UI DTO 和 Runtime cache 都必须可从有效
  Floor facts 重建。
- 当前 Phase 2A 已有稳定的 Floor Version、Swipe isolation、完整 Event collection
  validation、identity resolution、pending candidate 和 stale async protection；
  本任务不得破坏这些边界。
- Event Analysis 只识别事实：exposure、potential carrier、source/counterpart、
  mechanism evidence、Story Time、provenance 和事实证据；不做概率、抽签、
  actual pregnancy、父系最终归属、多胎/流产或未来事件。
- `pregnancy possibility / exposure eligibility` 与未来的
  `pregnancy probability / outcome resolution` 必须保持不同层次。
- 普通 NSFW 不进入 pregnancy tracking；非 NSFW 但产生有效 reproductive exposure
  的 implantation、medical、parasitic、magic 或世界特有事件可以进入同一 pipeline。
- 只有有效 exposure 的潜在 carrier 才能进入 tracking：`false` 为 ineligible，
  `unknown` 为 pending candidate，`true` 才是 eligible subject。

## Requirements

### R1. 事实与结果边界

审计并在设计中明确 Event Analysis、Tracking Eligibility 与未来 Projection /
Probability Resolution 的责任边界。规划不得引入任何概率值、权重、随机种子、
抽签或 pregnancy outcome 字段。

### R2. 机制中立的 exposure 入口

将当前 `sexual_activity` 保留为一种 BiologicalEvent 类型；目标契约是
`pregnancy-relevant reproductive exposure -> Tracking`。机制不得要求
`can_fertilize` 或 `possible_conception === true`，也不得把自然性交链作为所有
世界的必要条件。

### R3. Capability 语义

分别审计 `can_fertilize`、`can_cause_pregnancy`、`can_be_fertilized` 和
`can_carry_pregnancy` 的定义、alias、fallback、merge、validator、prompt 和
tracking 使用。设计必须禁止从 gender/sex label、name、pronoun、event role、
attacker/receiver 或 active/passive position 推导 exposure eligibility。

必须评估将全局 `can_carry_pregnancy` 解析收口为类似
`canCarry(character, mechanism, worldModel)` 的机制化接口，同时不增加一组
针对每种机制的硬编码 capability 字段。

### R4. Schema and mechanism contract

审计 `pregnancy_relevance.relevant`、`possible_conception`、
`gestational_subject_ids`、`counterpart_ids` 的语义是否足够，给出当前语义、
命名问题、真实业务问题、正确 schema 设计和回滚策略。不为旧数据设计兼容层。

新增 mechanism/exposure 描述必须是最小、结构化、可验证且开放 World Model 定义
的结构，而不是 implantation/parasite/magic 等固定 enum，也不能退化为 Runtime
无法消费的完全自由文本。

### R5. Tracking population

保持 tracking 只覆盖发生有效 exposure 的潜在 carrier，不扩大为所有
Biological Characters；pending candidate 继续保留可重评所需的最小 provenance、
Story Time、evidence 和 resolved capability，不创建普通 NSFW 人物卡。

### R6. StateReducer 前置接口

只设计未来输入/输出 seam：有效 exposure history、Story Time、World Model、
Current Biological State 和 capability/mechanism resolution。不得实现或提前定义
StateReducer、Snapshot、Projection、Genealogy 或 outcome resolution。

### R7. 验收与实施计划

规划必须覆盖重点源文件、domain specs、DATA-MODEL、相关 tests、UI DTO consumers，
并给出测试矩阵、实施波次、风险、迁移影响及明确的不做清单。

## Acceptance Criteria

- [ ] 规划列出当前实现事实，并带有可定位的文件/行号证据。
- [ ] 明确区分命名/兼容问题与会阻断非传统机制的真实业务逻辑问题。
- [ ] 给出最小机制泛化设计，且不把 capability 或机制硬编码为现实人类模型。
- [ ] 给出直接 schema 修改、Floor-local persistence、重建 Registry 和回滚影响。
- [ ] 给出 Phase 2B StateReducer 的只读接口建议，不实现任何 StateReducer 代码。
- [ ] 给出 parser/domain/runtime/tracking/world-model/UI DTO 的测试计划和实施波次。
- [ ] 明确列出本阶段不做：概率、抽签、妊娠结果、父系/遗传最终归属、单胎/多胎、
  流产、未来事件、Snapshot、Projection、Genealogy、完整 Context Injection。
- [ ] 测试覆盖 Floor-local authoritative persistence、Chat isolation、Swipe 0 /
  reroll / content hash / Floor Version、非 sexual exposure、机制相关 carrier
  resolution、capability 独立语义，以及禁止 gender/sexual-role 推断。
- [ ] `prd.md`、`design.md`、`implement.md` 完成并通过最终规划审阅；本任务仍停留
  在 planning，不运行 `task.py start`，不修改产品代码。
