# Research: Event Analysis 身份容错与提示词 ID 边界

- Query: 审计 Event Analysis API 是否把内部 character ID 发给模型，以及 API 返回错误/未知 ID 时当前 Runtime 如何处理；提出不按同名硬合并、唯一匹配才允许的最小容错方案。
- Scope: internal
- Date: 2026-10-29

## Findings

> 说明：以下 Findings 是 2026-10-29 修改前的审计快照。当前实现已按本研究建议完成 Prompt 边界与 Runtime 容错；文末的实施状态是最终事实。

### 1. 当前提示词仍然发送了内部 ID，和“只发送人名”的记忆不一致

当前事件提示词由 `buildEventAnalysisMessages()` 组装两个关键资料块：

- `ai/prompts.js:758-772` 将 `formatEventCharacterRegistry()` 和 `formatEventIndividualEvidence()` 放入第二个 `system` 消息；
- `ai/prompts.js:371-381` 的 Registry 说明要求模型从 `character_id` 中选择；
- `ai/prompt-context.js:475-482` 把每个候选的 `character_id` 投影为 `role_identifier`，因此发送的内容会出现类似“角色标识: char_000001”；
- `ai/prompt-context.js:484-511` 的人物资料同样输出 `role_identifier: source.character_id`，没有 ID 时还会输出“未分配 canonical character_id……”说明。

这不是 `stripIds()` 遗漏造成的偶发现象，而是两个 Event 专用 semantic kind 明确绕过了通用 ID 清理：`event_identity_registry` 与 `event_character_profiles` 专门保留了角色标识。现有回归测试也把这个行为固定下来了：

- `tests/context-prompt.test.js:749-800` 断言“角色标识: character_subject”；
- `tests/event-analysis.test.js:145-175` 断言 Registry 规则和正式 ID 语义；
- `tests/event-analysis.test.js:725-765` 断言 `char_000001`、`char_000002` 出现在 Registry prompt 中。

因此，用户看到的“这次发送内容没有人物 ID”与当前代码/测试不一致；需要以实际 API 请求 Debug 为准确认运行版本，但仓库当前实现确实仍会发送内部 ID。更可能是上一轮“去 ID”只改了 `event_reference`、Storyline 或其它 prompt variant，没有同步清理这两个 Event 身份资料块。

### 2. API 返回 ID 的当前处理：严格身份解析，只有有限的唯一显示名兜底

Runtime 在 API 返回后执行：

1. `runtime/character-event-analysis.js:765-802` 进入 `identity_resolution`，把 API envelope 与当前 Floor 的 `character_registry` 交给 `resolveEventAnalysisIdentities()`；失败会抛出 `EVENT_IDENTITY_RESOLUTION_FAILED`，并保留具体 `diagnostic_code`/路径。
2. `core/identity.js:1130-1321` 的 `resolveRawParticipantIdentity()` 对 `identity_status=existing` 先检查 supplied `character_id` 是否存在。
3. 如果 supplied ID 不存在，当前实现会调用 `exactExistingFallbackCandidateIds()`；只有 display name/alias 的候选恰好唯一时才接受 `exact_unique_display_fallback`，否则：
   - 0 个候选 → `unknown_existing_character_id`；
   - 多个候选 → `identity_unresolved`。
4. `core/identity.js:1827-1880` 随后对 `gestational_subject_ids`、`counterpart_ids` 和 `state_fact.subject_id` 做同样的 canonical reference 校验；无法映射时整个分析结果失败关闭。
5. 失败会进入 `runtime/character-event-analysis.js:390-425` 的校验重试路径；`runtime/event-analysis.js:1080-1100` 也把 identity resolution 列为可诊断/重试阶段。它不会直接写入一个未知 ID。

现有测试已经覆盖了部分容错边界：

- `tests/character-identity.test.js:283-322`：错误 ID + 唯一显示名/昵称可以被唯一兜底到 canonical ID；
- `tests/character-identity.test.js:324-343`：错误 ID + 无候选或多候选必须失败；
- `tests/event-analysis-runtime.test.js:4746-4769`：伪造 existing ID 在 Runtime 层必须失败，Floor 不保存事件。

### 3. 对本次怀孕确认/推演未结束问题的直接意义

当前容错只发生在“API Event 返回后、Event 写入前”。它可以防止一个未知的 participant ID 写入，但不能自动修复已经写成另一个合法 canonical ID 的事实：如果 API 返回 `char_000002`，而 `char_000002` 在当前 Registry 中是合法人物，Runtime 会把它视为合法身份；它不会知道该响应实际应该属于活动推演的 `char_000003`。

因此，单纯把未知 ID 改成按名字匹配，不能解决本次“确认事实与活动推演 subject 不一致”的问题；本次两个 ID 都可能是合法 ID，必须增加“当前分析目标/活动 subject 连续性”约束，且不能用同名直接合并。

### 4. 最小且安全的容错方案

建议分为两个边界，避免把模型展示协议和事实身份修复混在一起：

#### A. Prompt 边界（优先修正；身份参考方案已按后续需求收敛）

- Event API 不应把正式 ID 混入人物生理资料；但为了让模型把叙事名称对应到已登记人物，允许在独立的只读身份参考块中发送当前 canonical registry 的 `known_characters`、`display_name`、`character_id` 和 `aliases`。`event_character_profiles` 仍不承载 canonical ID。
- 提示词改为明确要求：模型只返回 `identity_status`、`display_name`/alias、response-local `mention_id`；`existing` 也不填写正式 `character_id`（或统一要求 `character_id:null`），由 Host 根据正文和当前 Registry 解析。
- 但不要删除 Runtime 的 canonical Registry、identity resolver 或内部 Floor ID；它们仍然是插件内部唯一身份来源。
- 所有引用目标人物的分析调用都应通过统一的姓名/mention 输入 DTO，避免某个模块又把 raw registry 直接序列化回 prompt。

#### B. Runtime 容错边界（解决合法但错误的 ID）

- API 返回包含正式 ID 时，不要盲目接受；先把它视为“不可信模型提示”。
- 只有以下情况才允许唯一改写到当前 canonical ID：
  1. API 返回 ID 在 Registry 中不存在，且正文 display name/alias 在当前 Registry 中恰好唯一；使用现有 `exact_unique_display_fallback`；
  2. API 不返回 ID、返回 response-local mention，且 display name/alias 在当前 Registry 中恰好唯一；使用统一 identity resolver；
  3. 对于当前活动推演/观察 subject，存在明确的本次分析目标 ID 或唯一活动观察绑定，并且正文明确指向该目标；这属于“目标上下文约束”，不是同名匹配。
- 下面情况必须失败关闭，不得写入或继续触发推演：
  - 返回 ID 合法但与当前活动 subject 不一致，且没有独立、明确的正文证据说明是另一人物；
  - display name/alias 对应 0 个或多个 canonical candidates；
  - 同名人物同时存在，只有名字相同而没有唯一上下文；
  - Event 的 participant、`state_fact.subject_id`、`gestational_subject_ids` 之间解析到不同人物。
- 失败时保留原有 Floor/Storyline 状态，记录 `SUBJECT_ID_MISMATCH` 或 `IDENTITY_UNRESOLVED`，禁止把怀孕确认当成活动推演人物的终止事实，也禁止继续调用下一阶段剧情 API。
- 不建议直接按显示名把 `char_000002` 合并成 `char_000003`；显示名只能用于生成候选集，不能作为唯一业务身份，除非候选确实唯一且有当前目标/正文上下文支持。

最小实现应优先放在 Event Analysis 结果进入 `resolveEventAnalysisIdentities()` 之前/附近的窄校验层，复用现有 `core/identity.js` 的候选解析，不重写 `core/identity.js` 的基础 Registry 规则。推演闭环另外需要在事实成功读回后做活动 subject 的精确匹配；身份不一致时要有明确的 closure skip，而不是静默跳过。

### 5. 建议新增回归测试

建议最小覆盖以下案例：

1. **提示词身份边界**：Event messages 的人物资料不出现 canonical ID；独立 Registry 身份参考块可以出现原始字段名 `known_characters`、`display_name`、`character_id`、`aliases`，且不得混入 cycle、Event、Floor 或 source ID。
2. **API 返回未知 ID + 唯一名称**：唯一匹配时归一化到现有 canonical ID，记录 `exact_unique_display_fallback`，事件可继续保存。
3. **API 返回未知 ID + 同名多候选**：返回 `IDENTITY_UNRESOLVED`，不写 Event、不更新 Registry。
4. **API 返回合法但错误的 canonical ID**：当前活动 subject 是 `char_000003`，响应确诊写 `char_000002`；若正文没有明确另一人物证据，必须返回 `SUBJECT_ID_MISMATCH`/失败关闭，不得触发 Storyline progression。
5. **API 返回无 ID但唯一 mention**：由 Host 解析到唯一 ID后保存；无法唯一时失败关闭。
6. **字段交叉一致性**：participant、`state_fact.subject_id`、`gestational_subject_ids` 指向不一致时整体失败。
7. **Storyline closure**：事实确认 ID 与 active storyline subject 不一致时，Debug 必须包含 `STORYLINE_CLOSURE_SKIPPED`、事实 ID、活动 ID 和原因；不得把该事实当作当前人物终止，也不得生成下一推进事件。

### 6. 文档影响

如果实现“API 不再接收正式 ID”或新增“活动 subject 连续性校验”，需要同步检查并更新：

- `docs/bioweave-data-lifecycle.md`：API context identity presentation、Event identity resolution、Storyline factual closure/失败关闭边界；
- `.trellis/spec/domain/floor-state.md`：Prompt Context content-port 的 Event semantic kinds 当前仍写着“Storyline design/judge 必须将内部 subject_id 传给端口”，需要区分“内部筛选参数”与“发送给模型的正文”；
- `tests/context-prompt.test.js`、`tests/event-analysis.test.js`、`tests/event-analysis-runtime.test.js`：同步修改现有“角色标识/正式 ID 必须出现”的断言。

本次研究没有修改生产代码、测试或规格文件，也没有执行 Git 操作。

### 7. 实施状态

- `ai/prompt-context.js` 的 Event Registry 与 Storyline 身份参考共用独立正文端口，使用原始字段名 `known_characters`、`display_name`、`character_id`、`aliases`；Event 人物生理资料仍不输出 canonical ID，也不输出 `role_identifier`。
- Event raw response 统一使用 `character_id: null` 与 response-local `mention_id`；API Analyzer 入口允许 names-only existing，Runtime 再绑定 canonical ID。
- Runtime 只在当前活动 Tracking Window/Participant Aggregation 的连续性候选唯一匹配时纠正旧的合法或未知 ID；对于模型误标为 `new` 的 mention，也只在唯一活动候选且没有明确 `distinct_new` 证据时复用该 ID。同名多候选、无活动候选和身份冲突均失败关闭；明确的 `distinct_new` 证据仍可注册新人物。
- 新增了 Prompt 不泄漏 ID、names-only parser、合法旧 ID 唯一连续性纠正和同名歧义失败的回归测试；`npm run check` 已通过。

## Caveats / Not Found

- 修改前未发现一个已经完全移除 Event prompt 内部 ID 的实现；该问题已在当前工作树修正。
- Debug 附件只能证明最终事实与活动推演使用了不同 ID，不能单独定位 ID 是在 API 生成、解析归一化还是后续写入覆盖阶段改变的；下一步应在 API raw response、parse result、identity result、Floor event write/readback 四个边界分别记录安全 fingerprint/ID mapping。
- 不应使用显示名称全局硬合并；同名角色测试已经证明这种做法会破坏 canonical identity 隔离。
