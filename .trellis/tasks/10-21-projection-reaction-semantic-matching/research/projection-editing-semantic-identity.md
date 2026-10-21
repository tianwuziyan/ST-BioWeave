# Research: Projection 编辑与反应语义身份

- Query: Audit Projection generation/editing/persistence/view code and UI; identify title/description/concern key/branch key fields, editable surfaces, stable IDs/semantic keys, built-in versus custom/AI behavior, and a safe meaning of “标题或内容改变后仍可识别”.
- Scope: internal
- Date: 2026-10-21

## Findings

### 1. 当前 Projection 实例没有独立 title/description 字段

- `core/projection.js:19-26,126-155` 定义并校验 Projection domain DTO。实例字段包含 `projection_id`、`projection_rule_id`、`development_concern_key`、`development.next_signal`、timing、evidence 与 Floor provenance；没有 `title`、`label` 或 `description` 顶层字段。
- AI/raw 生成契约只有 `development.kind` 与 `development.description`：`core/projection-generation.js:16-18,94-112`。`assembleProjectionCandidate()` 将该 description 写入 `development.next_signal`：`core/projection-generation.js:194-237`。
- Runtime DTO 把 `development.next_signal` 暴露为 `generated_statement`，并把规则/内置分支文案放入 `rule.label`、`rule.description`：`runtime/projection-runtime.js:96-147`。因此 UI 的“正文”来源有两种：内置分支的规则 description，或自定义/AI Projection 的 `generated_statement`；二者不是同一字段。
- UI `displayStatement()` 优先读取 `item.rule.description`，否则读取 `item.generated_statement`：`ui/projection.js:31-40`。UI 标题/卡片 label 优先读取 `item.rule.label`，否则使用“潜在生理变化”：`ui/projection.js:124-131,224-239`。这说明当前产品层的 title 是 read-model 派生值，不是持久化实例字段。

### 2. concern key、branch key 和 ID 的实际职责

- `development_concern_key` 是 Projection 实例必填字段，也是规则必填字段：`core/projection.js:143-154`、`core/projection-eligibility.js:64-71,124-125`。
- Projection 实例 ID 的确定性身份材料为 `{schema_version, chat_id, subject_id, projection_rule_id, development_concern_key}`：`core/projection.js:115-116`。`source_event_ids` 明确只是 provenance，不参与实例 ID（`docs/DATA-MODEL.md:252-256`）。因此改变 concern key 或 rule ID 会生成不同的 Projection identity，而只改正文不会改变现有 `projection_id`，前提是通过受控编辑路径保留原 ID。
- `projection_rule_id` 不是 AI 输入身份字段；raw rule content 经规范化后由完整规则材料 deterministic digest 生成：`core/projection-eligibility.js:150-180`。规则 ID 的 identity material 包含 `mechanism_key`、`development_concern_key`、kind、trigger、requirements、realization、contradiction、expiration，因此改变这些语义字段会产生新 rule ID。
- 内置 branch key 并非独立存储字段；它嵌在 `development_concern_key` 的 `pre_confirmation_observation:<branch>` 后缀中，并由 `builtInPreConfirmationBranchForConcern()` 解析：`core/projection-eligibility.js:10-61,219-223`。内置 stage/branch 的显示 label 和 description 来自常量表：`core/projection-eligibility.js:12-61,204-216`。
- 内置规则按 `mechanism_key + branch key` 创建完整规则，concern key 是 `pre_confirmation_observation:<branch>`，rule ID 再由该规则内容生成：`core/projection-eligibility.js:183-201`。内置 branch 的 `label`、`description`、stage key 是代码 preset，不是 Projection timeline 中的可编辑字段。

### 3. “编辑”当前指 Timing 编辑，不是 Projection 内容编辑

- 没有发现 `editProjection()`、Projection title/description 编辑 API、Projection content form 或 Projection update persistence。产品 UI 只提供删除 Projection：`ui/projection.js:240-245`；产品文档也明确“Event 可编辑删除；Projection 仅删除”：`docs/UI.md:134`。
- 已实现的编辑入口是人物详情中的“推演周期”编辑器，编辑的是 Timing Instance 的基础周期、浮动与上限配置：`ui/characters.js:313-333`、`ui/app.js:4242-4360`。
- `editProjectionTimingInstance()` 明确保持 `cycle_id`、`timing_instance_id` 和 provenance 不变，只重算有效窗口，冻结 creation-time sampled offset：`core/projection-timing.js:167-225`。Storage 层通过 `editTimingInstance()` 使用指定 `timingInstanceId`、owner/Floor guards 和 authoritative readback：`storage/projection-timing.js:275-295`。这是一个可复用的“编辑后保留稳定 ID/语义身份”模式，但不能误称为 Projection 内容编辑。

### 4. 生成、持久化与视图均以 append-only 和 owner 约束为前提

- AI 生成只接受 `eligible` decision；raw DTO 不得携带 identity、Floor、evidence、Event、State 等字段，最终由 Runtime 用 decision + rule + Floor context 组装：`core/projection-generation.js:118-146,157-237`；文档契约见 `docs/DATA-MODEL.md:670-697`。
- Projection creation/evidence/lifecycle records 只能追加到当前 Character Floor/active Swipe 的 `projection_timeline`。Storage 会验证完整 Floor Version、当前 owner、active Swipe、Chat 和 stale version：`storage/projection.js:33-69,71-109,120-159`。timeline append 对同一 ID 的内容变化返回 conflict，而非原地覆盖：`core/projection-persistence.js:79-89`。
- 读取先筛选 surviving Character Floors、active Swipe 和当前有效六字段 Floor Version，再按 Floor 顺序聚合：`storage/projection.js:231-267`。`resolveProjectionView()` 依据 lifecycle records 派生 factual status/deleted/context_visible，不改变 creation：`core/projection.js:199-204`。
- Context 注入只保留正文需要的 subject、development kind、未来方向、mechanism 和 attribution，不携带 Projection identity：`core/projection-context.js:152-174`；因此“仍可识别”不能依赖 AI/Story prompt 内部使用的 projection ID，因为该 ID 对下游正文不可见。

### 5. 内置与 custom/AI Projection 的差异

#### 内置 pre-confirmation

- 规则为空时，只有有效 Timing、Tracking Window 和成功 Participant Aggregation 才启用内置候选；按三个 Story Time stage、每 stage 四个 branch 生成确定性中性候选，不调用 Projection AI：`core/projection-eligibility.js:326-329`、`runtime/projection-runtime.js:860-905`、`docs/DATA-MODEL.md:269-279`。
- 内置分支的语义身份最强地依赖 `subject_id + pregnancy_id|null + cycle_id` 的 stage snapshot identity，branch 由 concern key 后缀解析，stage 完整性必须四分支齐全：`core/projection-persistence.js:130-178`、`runtime/projection-runtime.js:332-351`。
- 内置视图的 title/content 可从代码 preset 重新投影；UI/Context 不从自由文本判断 branch。观察 reaction 只对内置 `nausea` 分支做结构化 Event 匹配，并明确不读取标题、正文或 provenance：`core/projection-eligibility.js:225-278`；`docs/UI.md:100`。
- 当前 stage replacement 是追加新 stage snapshot，不给旧 stage 合成删除/过期 lifecycle；同一 subject/cycle 的最新完整 stage 赢得产品视图：`.trellis/spec/domain/floor-state.md` Projection stage synchronization sections、`core/projection-persistence.js:143-181`。

#### custom/AI rule 与 candidate

- World Model `projection_rules[]` 是 Floor-owned 的声明式规则集合，不是 Projection 实例。raw AI rule 不带 `projection_rule_id`，规范化后生成 deterministic ID；规则内容包括 mechanism、concern、kind、trigger、requirements、realization、contradiction、expiration：`docs/DATA-MODEL.md:318-325`。
- custom/AI candidate 的可读 title 通常没有规则 label；UI 回退到“潜在生理变化”，正文读取 AI 生成的 `development.next_signal`：`runtime/projection-runtime.js:105-126`、`ui/projection.js:124-131,224-239`。
- custom/AI candidate 的 reaction matching 当前没有通用语义匹配器；`matchBuiltInObservedReaction()` 对非内置 concern 直接返回 `CONCERN_NOT_BUILT_IN`：`core/projection-eligibility.js:225-234`。因此不能把任意 AI 文本改写后仍自动视为同一可观察反应。

### 6. 对“标题或内容改变后仍可识别”的安全解释

建议把这句话拆成两个层级，而不要承诺自然语言相似度识别：

1. **实例连续性（可安全承诺）**：在受控的编辑 API 中，用户只修改 display title/description 等 presentation fields；保留原 `projection_id`、`projection_rule_id`、`development_concern_key`、subject、mechanism、timing identity、source/provenance 和 owner Floor Version 约束。这样 Timeline/lifecycle/evidence/delivery 仍能通过原 `projection_id` 找到同一实例。当前 schema 尚无这些 display fields，需要先扩展 DTO、schema、normalizer、append/conflict 规则与 lifecycle registry；不能把未知字段塞入现有 Projection（现有 validator 会报 unexpected field）。
2. **语义匹配（仅结构化 key 可安全承诺）**：Reaction 关联应使用稳定的结构化 `concern_key`/`branch_key`（内置 branch 可由 `pre_confirmation_observation:<branch>` 解析）以及 subject、cycle/stage、机制和规定的 Event kind/window；标题或正文仅用于展示。改变标题/正文不会改变匹配；改变 concern/branch、mechanism、stage/window 或结构化 reaction kind 则应视为新语义或重新绑定，并要求显式迁移/替换。

不安全的含义包括：用标题/description 的关键词、模糊字符串相似度、AI embedding 或改写后的自然语言去猜“同一反应”；这会把同义改写、否定、程度变化、跨 stage 变化混为一谈，也不符合当前内置匹配器“只看结构化 `symptom.kind`、subject 和 Story Time 窗口”的 fail-closed 规则。

候选数据契约（规划建议，非当前实现）：

```text
ProjectionInstance
  projection_id: immutable instance ID
  semantic_identity:
    subject_id
    cycle_id / pregnancy_id|null (when applicable)
    mechanism_key
    concern_key (stable semantic key)
    branch_key (stable branch key; required for built-in, optional/null for custom)
  rule_id: immutable binding for the rule revision
  presentation:
    title
    content
  provenance/timing/owner: existing Floor-bound fields, unchanged
```

For custom rules, a stable user/runtime-assigned `concern_key` or explicit semantic key is required before allowing content edits. If an edit changes rule semantics rather than presentation, the safe operation is “new rule/new Projection identity plus explicit old-rule disable/deletion semantics”, consistent with World Model rule replacement (`DISABLE_PROJECTION_RULE` + `ADD_PROJECTION_RULE`) rather than mutating an append-only creation.

## Files found

- `core/projection.js` — Projection schema, deterministic instance ID, validation, lifecycle/evidence identity, view reducer.
- `core/projection-eligibility.js` — rule schema/ID, built-in stages and branches, eligibility, built-in observed reaction matching.
- `core/projection-generation.js` — AI/raw generation boundary and assembly into domain Projection.
- `core/projection-persistence.js` — append-only timeline normalization, built-in stage snapshot selection, lifecycle resolution.
- `core/projection-timing.js` — frozen Timing Instance identity and explicit timing edit semantics.
- `runtime/projection-runtime.js` — generation orchestration and Runtime DTO shaping, including built-in/custom presentation differences.
- `storage/projection.js` — Floor/Swipe owner validation, append persistence, current valid read path, lifecycle operations.
- `storage/projection-timing.js` — Timing Instance edit persistence and readback.
- `core/projection-context.js` — Context DTO/prompt projection; identity intentionally omitted from injected content.
- `ui/projection.js` — read-only Projection page, title/content fallbacks, built-in stage display, delete action.
- `ui/characters.js`, `ui/app.js` — user-editable Timing editor, not Projection content editor.
- `docs/UI.md` — product behavior: Projection delete-only and structured built-in reaction badge semantics.
- `docs/DATA-MODEL.md` — Projection identity, rule identity, generation and Context contracts.
- `.trellis/spec/domain/floor-state.md` — Floor ownership, append-only timeline, built-in stage snapshot and owner invalidation contract.
- `docs/bioweave-data-lifecycle.md` — persistent/derived ownership and lifecycle constraints.

## External references

- None used. This query is fully answerable from the repository’s first-party code and normative project documents.

## Related specs

- `.trellis/spec/domain/floor-state.md`
- `.trellis/spec/domain/event-pipeline.md`
- `.trellis/spec/domain/pregnancy-tracking.md`
- `.trellis/spec/frontend/component-guidelines.md`
- `docs/DATA-MODEL.md`
- `docs/UI.md`
- `docs/bioweave-data-lifecycle.md`

## Caveats / Not Found

- No Projection title/description editing UI or persistence API was found. “Editing” found in the Projection area is Timing Instance editing only.
- Current Projection schema rejects arbitrary title/description/branch fields; the candidate contract above is a design recommendation, not an existing compatible DTO.
- `projection_id` is deterministic from concern/rule identity. Recomputing it after semantic edits would break append-only lifecycle/evidence/delivery references; preserving it across semantic changes would instead create an identity collision. Semantic changes therefore need explicit new identity/migration semantics.
- Built-in observed reaction matching currently supports only the structured `nausea` branch. Other built-in branches are not recognized as observed reactions even if their title/content changes.
- The UI currently receives built-in labels/descriptions by re-deriving them from code presets, while custom/AI content is split between rule fields and `generated_statement`; any future editable presentation contract must decide whether those fields are persisted on the Projection instance or on the rule, and must update DTO/UI/Context contracts together.
