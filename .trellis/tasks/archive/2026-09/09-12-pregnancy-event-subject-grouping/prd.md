# 按 gestational subject 拆分妊娠暴露 Event

## Goal

修正 Event Analysis 的多人 pregnancy exposure 合同，使每个
pregnancy-related `sexual_activity` Event 只表达一个 gestational subject
在当前 Floor Version 中的实际 conception-relevant exposure，避免 subject、
counterpart、source 和 exposure history 串线。

## Background

- 当前 Prompt 把一个 Target Floor Version 限制为一个 consolidated Event，导致不同 gestational subject 的暴露被压进同一 Event。
- 当前 AI parser 在 normalization 前以 `multiple_events_not_allowed` 拒绝多 Event；现有测试和文档也锁定了这一错误合同。
- `core/tracking.js` 已逐 Event 读取 `gestational_subject_ids` 并记录 `exposure_event_ids[]`，本轮不改变其 eligibility 规则。
- Characters / Character Detail / Events UI 应继续消费 Registry 与 canonical Event，不在 UI 层按人物拆分或重建 Event。
- 现有 DTO 没有独立的 source→subject 关系字段；本轮通过 Event-local participants、subject/cardinality、counterpart 闭包和跨 Event 唯一 subject 规则防止结构性串线，不新增 speculative relation 字段。

## Requirements

### R1. Floor 与 Event 粒度

- 一个 Target Floor Version 允许输出 `0 / 1 / N` 个 `BiologicalEvent`。
- 不得再要求按 Floor、Event type 或 primary type 把多人暴露合并为一个 Event。
- 对 pregnancy-related `sexual_activity`，主要分组键是 gestational subject；同一 subject 的多个 actual exposure sources 合并到一个 Event。
- 同一 AI response / Floor Version 中，同一 gestational subject 最多出现一个 pregnancy-related `sexual_activity` Event；重复 subject 必须拒绝，不得 Runtime 自动 merge。
- 独立的非 pregnancy `physical_symptom`、`medical_event` 或其它 BiologicalEvent 仍可合法共存，但即时 physical effect / immediate physical symptom 继续并入其所属 sexual exposure Event，不机械拆分。

### R2. Pregnancy exposure Event 合同

- 对 `type === "sexual_activity"`、`pregnancy_relevance.relevant === true` 且 `possible_conception === true` 的 Event，`gestational_subject_ids.length` 必须严格为 `1`。
- 该唯一 subject ID 必须存在于 `participants[]`；`counterpart_ids.length` 必须至少为 `1`。
- `counterpart_ids` 只能包含本 Event 中实际对该 subject 造成 conception-relevant exposure 的 source participants，不得包含另一 subject、另一 Event 的 source、在场人物、普通 sexual participant 或无 actual exposure 的对象。
- `participants[]` 的 ID 集合必须严格等于唯一 subject 与 `counterpart_ids` 的并集，且不得有额外人物。
- subject 不得出现在 `counterpart_ids`；subject、counterpart 和 participants ID 均不得重复。
- 同一 Floor 的不同 gestational subjects 必须输出不同 Events；同一 subject 的多个 sources 必须留在同一个 Event 的 `counterpart_ids` 中。
- 现实式 exposure 判定保持不变：只有 reproductive substance 实际进入有效受孕路径才算；完整防护未进入、体外无有效路径、仅插入和仅身体接触仍不算。

### R3. AI DTO、Domain 与 Runtime 边界

- `ai/prompts.js` 的 Core / Task / Output Contract 必须明确 0/1/N Event、按 gestational subject 分组、subject-local participants/counterparts 及上述 cardinality 约束。
- `ai/analyzer.js` 必须允许 `events.length >= 0`，删除 `multiple_events_not_allowed` 限制，并在 AI DTO 边界拒绝无效 pregnancy exposure 结构、规范化重复 ID 和同一 response 的重复 subject Event。
- Domain validator 必须执行同样的单 Event exposure 结构校验；集合校验必须拒绝同一 Floor response 的重复 pregnancy subject，而不是自动合并。
- Runtime 继续按 response ordinal 生成 deterministic `event_id` 并绑定 authoritative Floor Version；不得使用 display name 生成 ID。
- 失败 refresh 的旧成功 Event、`last_success` 与 Registry 保留语义不变。

### R4. Tracking、UI 与身份边界

- 不修改 `core/tracking.js` 的 eligibility、Registry rebuild 或 subject 来源；正确分组后的 Event 自然分别进入对应 subject 的 `exposure_event_ids[]`。
- 人物列表继续只来自 `tracking_subjects`；UI 不按 `events`、`participants` 或 `counterpart_ids` 自己拆人物/Event。
- 人物详情只读取对应 subject 引用的 Event，因此 subject A 的 counterpart 不得出现在 subject B 页面。
- 不按 gender、攻受、receiver、姓名或 display label 推断 source/subject/capability。

### R5. Tests、Docs 与操作边界

- 更新 parser、Domain、Runtime 的旧多 Event rejection 测试，增加抽象 ID 回归覆盖：单 source、多 source、两个 subject、混合多 source、无 exposure participant、subject cardinality、重复 subject、cross-Event counterpart 结构闭包。
- 更新 `docs/DATA-MODEL.md`、`docs/DEVELOPMENT.md`、`docs/CONTEXT-AND-PROMPT.md`、`docs/UI.md`，统一写明 Floor 为 0/1/N、pregnancy Event per gestational subject、同 subject 每 Floor 最多一个以及 UI/Tracking 边界。
- 保留其它 Event 类型和“不要乱拆 symptom / medical / 普通补品”的独立事件标准。
- 本轮只处理 Event Analysis contract、Domain validation、相关测试和文档；不处理 StateReducer、Snapshot、Projection、Genealogy、StoryTime canonical index、Universal World Model cleanup、历史 null capability 重评估或 Phase 2B。
- 不 commit、不 push。

## Acceptance Criteria

- [ ] Prompt 不再出现“一个 Floor 最多一个 consolidated Event”“events 只能为空或一个”“唯一 primary Event type”或等价单 Event 约束，并明确 0/1/N 与按 gestational subject 分组。
- [ ] Parser 接受空数组、单 Event 和多个合法 Event；不再产生 `multiple_events_not_allowed`。
- [ ] 合法 pregnancy exposure Event 严格包含一个 gestational subject、至少一个实际 source，且 participants 恰好为 subject + sources。
- [ ] 多 subject 同 Floor 产生多个互不串线的 Event；同一 subject 多 source 合并为一个 Event。
- [ ] 无 exposure participant 不进入 pregnancy Event；保护/实际进入规则、gender 禁止推断和 immediate effect 合并规则保持不变。
- [ ] 非法 subject cardinality、空 counterpart、subject-as-counterpart、额外 participant 和重复 subject Event 均被 validator 拒绝并提供稳定 diagnostic path/code；重复 counterpart/participant IDs 规范化为唯一 canonical 数组。
- [ ] 同一 response 中的 Event ordinal 继续生成稳定 deterministic IDs；Runtime 不自动 merge 或按 display name 生成 ID。
- [ ] Domain/Runtime 保存边界对多个 Event 正常工作，失败 refresh 仍保留旧成功结果；`core/tracking.js` 无业务逻辑改动。
- [ ] Tracking Registry 将不同 subject 绑定到各自 Event；UI 只消费 Registry / Event 引用，不新增按人物拆 Event 逻辑。
- [ ] Case 1–8 的抽象 fixture 回归测试通过，并更新/删除上一轮“多 Event 必须失败”的测试。
- [ ] 四份指定文档与生产 Prompt/validator 合同一致。
- [ ] `npm run check`、`git diff --check` 和所有修改 JS 的 `node --check` 通过；不执行 commit/push，且不进入 Phase 2B。

## Open Questions

无。用户已确定产品粒度、validator 行为、范围边界和验收规则；DTO 不新增显式 relation mapping 字段。
