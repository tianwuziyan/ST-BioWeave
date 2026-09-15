# 修正 NSFW 多人物妊娠追踪对象识别

## 目标

修正 BioWeave 在多人物 NSFW 场景中的妊娠追踪对象识别：先对当前 Target Floor
完整识别所有实际发生 pregnancy-relevant reproductive exposure 的 exposure
recipient，再分别解析 species、biological_type 与 reproductive capabilities，最后
按 `eligible`、`pending`、`ineligible` 三态建立追踪结果。

Tracking 只表示“该人物具有或可能具有当前世界承担妊娠的生理功能，且发生过
pregnancy-relevant exposure，需要继续追踪妊娠可能性”。Tracking 不表示受孕、怀孕或
妊娠事实；`pregnancy_relevance.possible_conception` 也不是事实性怀孕结论。

## 当前代码审计结论（基于本地工作区）

- A. exposure recipient discovery 当前主要由 `ai/prompts.js:29-35,46-53` 指导，
  解析器只接收 AI 给出的 `gestational_subject_ids[]`；没有 Core/Runtime 的独立
  exhaustive recipient collection 阶段。
- B. species/biological_type 当前由 `ai/prompts.js:34,38,65-66` 要求 AI 写入
  participant `biological_context`，并在 `ai/analyzer.js` / `core/events.js` 做结构
  校验与归一化；`core/tracking.js` 尚未把显式 identity 映射到 World Model 的
  `species[] -> biological_types[]` baseline。
- C. capability 筛选在 `core/tracking.js:194-231`，Registry 构建在
  `core/tracking.js:272-335`，正式列表只由 `eligibleGestationalSubjects()` 的结果建立。
- D. `core/tracking.js:216-223` 把 `can_carry_pregnancy === null` 记为
  `CAN_CARRY_PREGNANCY_UNKNOWN`，随后通过二态 `eligible` 过滤掉；未知状态没有保存
  入口。
- E. `storage/schema.js:470-488`、`storage/store.js:509-576` 只有
  `tracking_subjects` 与 `character_profiles`，没有 pending/candidate Registry。
- F. `runtime/event-analysis.js:425-445` 会在 Floor、Event 和 Chat 生命周期后重建
  Registry，但重建只保留 eligible；当前没有针对历史 pending exposure 的重新评估
  数据或 World Model 保存后的刷新链路。
- G. 当前没有发现“找到 user/Persona 后代码提前 return”的循环；但
  `ai/prompts.js` 尚未明确要求先收集临时 Candidate 集合、扫描完整 Target Floor、
  继续处理后续 recipient，也没有明确 `character_context` 不是 participant whitelist。

## 需求

### R1. Exhaustive exposure recipient scan

在 Event Analyzer 生成任何 pregnancy-related `sexual_activity` Event 前，必须先扫描
整个 Target Floor，收集所有 actual pregnancy-relevant exposure recipients 到临时
Exposure Candidate 集合。不得因第一个 recipient 是 Persona/current user/current
Character Card、已经得到一个 eligible subject、或中间 recipient 为 false/unknown 而
停止。

每个候选都必须独立执行：

`exposure detection -> identity resolution -> capability resolution -> eligibility decision`

该扫描使用通用的 `exposure recipient`、`gestational candidate` 等语义；行为是否构成
pregnancy-relevant exposure 由 World Model、当前 species/biological_type 的生殖规则和
当前 Narrative evidence 共同决定，不把某一种现实机制硬编码为所有世界的必要条件。

### R2. Identity evidence boundary

recipient 的解析顺序为收集全部 identity evidence、判断最符合的 species、判断该 species
下最符合的 biological_type、读取 World Model baseline，再应用 individual evidence。
Event Analyzer 允许综合 Character Card、Persona、Worldbook、Narrative、Existing
BioWeave profile、稳定历史设定、身体结构/生理特征、生殖事实、族群特征和 World Model，
把没有直接标签但由多条一致上下文证据支持的人物映射到当前 World Model 的
`species[] -> biological_types[]`。

明确 species、biological/reproductive classification、生理性别、生殖结构、生殖能力，
以及与某个 World Model `biological_type` 高度一致的稳定生理描述可以直接或高置信度
支持 identity。姓名、称谓、主动/被动、性行为位置、社会身份、穿着、气质或单一外貌
风格可以作为综合上下文的一部分，但任一单一弱线索不能单独确定 biological_type 或
capability。综合证据不足或冲突时保留 null 并进入 pending；不能因为剧情没有直接标签
就机械放弃 contextual inference，也不能让候选消失。

### R3. Three-state tracking decision

最终的 gestational tracking qualification 必须表达当前 World Model 下是否具备实际
承担妊娠的生理功能：

- `can_carry_pregnancy === true`：`eligible`，进入正式 `tracking_subjects`。
- `can_carry_pregnancy === false`：`ineligible`，不进入 active Tracking Registry；
  历史 BiologicalEvent 保留。
- `can_carry_pregnancy === null` 或无法确认：`pending`，保留在独立
  `tracking_candidates` 中，不能把 pending 当成 eligible。

`can_be_fertilized === true` 不能单独授权正式 gestational Tracking；如果当前 World
Model 明确表达可受精但不可承担妊娠，结果必须为 `ineligible`。其它能力字段仍按当前
World Model 的实际生殖机制保留 true/false/null，不新增现实世界硬编码。

### R4. Pending candidate persistence

pending 候选必须至少保存：

- `character_id`
- `exposure_event_ids[]`
- 每个 exposure 的 Event ID、Story Time 与可追溯的 Floor/Swipe Source Version
- `eligibility: "pending"`
- 当前已解析的 `species`、`biological_type`、`reproductive_capabilities`、`evidence`

`tracking_subjects` 继续只表示正式 eligible subject；普通 Characters UI 默认只枚举
它。pending 可以保留在后台 Registry/Runtime DTO 中，不在普通人物列表展示；如果未来
必须展示，只能使用“生理能力待确认”等用户文案，不能显示内部 ID、reason code 或 raw
capability JSON。

### R5. Pending re-evaluation

每次 active Event、Profile、World Model 或可信 identity/capability 资料更新后，必须
可以重新运行同一条 Core eligibility resolution。最小实现复用现有
`refreshTrackingRegistry()` / Registry rebuild，不新建大型 Profile service。

- pending -> eligible：加入正式 `tracking_subjects`。
- pending -> ineligible：从 `tracking_candidates` 和 active `tracking_subjects` 删除，
  但不删除真实历史 BiologicalEvent。
- 重新评估时沿用原始 exposure 的 Story Time 和 Event Source；不能使用后续确认能力
  的楼层作为 exposure 起点。

### R6. Event / Tracking separation and granularity

Event 继续记录当前 Floor 中识别出的生物学事实，Tracking Registry 只记录由这些事实
派生的 eligible/pending 追踪索引。进入 Event 不等于进入正式 Tracking，进入 Tracking
也不创建 actual pregnancy 状态。

pregnancy-related `sexual_activity` 继续遵守现有 subject-local 0/1/N contract：一个
Event 只有一个 gestational subject；不同 recipient 必须是不同 Event；同一 recipient
对应多个 conception-relevant source 时合并为一个 Event，`counterpart_ids[]` 只包含
直接相关 source，participants 不包含整个场景的其它人物。

### R7. UI and state boundary

UI、Characters list 和 Runtime consumer 不重新推断 species、biological_type、capability
或 exposure。actual pregnancy 必须由后续 Event、StateReducer 或明确剧情事实确定；本次
修改不得自动写入 `pregnant = true`、`conception_confirmed = true` 或其它妊娠状态。

### R8. Generic fixtures and regression coverage

新增测试必须使用抽象 ID 和 World Model fixture（例如 `species_alpha`、`type_a`、
`subject_a`、`source_a`），通过 fixture capability 定义行为。新增业务代码与测试不得
依赖现实人种、性别词、具体人物名或固定现实生殖规则。

## 验收标准

- [ ] A1. Prompt 和数据流明确要求先完整扫描 Target Floor 的全部实际 exposure
      recipients，再执行逐 recipient identity/capability/eligibility resolution；不存在
      user/Persona 优先级或早停语义。
- [ ] A2. 同一 Floor 的两个 eligible recipients 产生两个独立 subject-local Events 和
      两个正式 Tracking Subjects。
- [ ] A3. true/false/true 三个 recipients 中，首尾保留，中间 ineligible 不会阻止后续
      recipient；false 人物不在 active subjects 或 pending candidates。
- [ ] A4. true/null 结果为一个 eligible subject 和一个 pending candidate，null 不再被
      永久丢弃。
- [ ] A5. pending 在后续获得 true 时转为 eligible，并保留最初 exposure 的 Story Time；
      获得 false 时从候选/追踪 Registry 消失而历史 Event 仍存在。
- [ ] A6. 明确 species + biological_type 或多条一致的稳定 biological evidence 能可靠
      映射 World Model 时，可使用该 type 的 capability baseline；只凭单一姓名、称谓、
      外貌、主动/被动、位置等弱线索时保持 null/pending。
- [ ] A7. `can_be_fertilized: true` 且 `can_carry_pregnancy: false` 不得成为正式
      gestational Tracking Subject。
- [ ] A8. Persona 作为 source、Persona 作为 recipient、以及首次出现的 narrative
      character 都不会被漏扫或获得特殊优先级。
- [ ] A9. `tracking_decisions`、Registry 和 UI 语义严格区分 exposure recipient、
      reproductive capability、pregnancy possibility 与 actual pregnancy；eligible
      不创建妊娠状态，pending 不被当成 eligible。
- [ ] A10. Event 仍保持 0/1/N 与 subject-local participant closure；UI 不新增业务推断。
- [ ] A11. 新增/更新回归测试覆盖本需求列出的 11 类场景，并通过指定静态与 Node 检查。
- [ ] A12. 不产生 commit 或 push；最终工作区 diff 只包含本任务规划/实现相关改动。

## 非目标

- 不重构完整 Storage 数据库，不建立新的通用人物数据库。
- 不实现 actual pregnancy、概率、孕周、StateReducer、Projection 或 Genealogy。
- 不改变既有 Event ID、Floor Version、Swipe 绑定、0/1/N 保存和删除语义。
- 不在 UI 增加 pending 人物列表或调试信息展示，除非现有产品契约确实要求且文案能
  明确表达“待确认”而不是“已怀孕”。

## 未决问题

无。当前明确采用“eligible 进入 `tracking_subjects`、pending 进入后台
`tracking_candidates`、ineligible 不进入 active Registry”的最小方案。
