# 只读审计结论

## 结论摘要

真实 Trace 的 `registry_character_count = 1` 与 `character_count = 0` 并不矛盾：前者来自 Floor-owned `character_registry.entities` 的 canonical identity 快照，后者来自 `business.tracking_subjects`。后者只收录通过 pregnancy-relevant exposure、gestational subject 和 carrying capability eligibility 的 Tracking Subject；counterpart、pending、ineligible 或只被 identity resolution 注册的实体不会进入人物页面。

当前 `CHARACTER_UI_READY` 的确允许 `event_count > 0`、registry 为 1、business character 为 0 时 `ready=true`。这是 `b4df893` 新增的 readiness 条件遗漏：它校验 Floor/version、状态错误和 Event 数量/ID 一致性，却没有校验 business character 是否符合本次 Event 的预期，也没有把 `character_count` 纳入 ready 条件。该 change 解释了 Trace 中的 ready=true，但不证明它制造了人物消失；baseline 的人物页面同样读取 `tracking_subjects`。

## A. Event prompt 完整 diff

`git diff a8030e..HEAD -- ai/prompts.js` 只有 4 行变更（3 行新增、1 行替换），且 `EVENT_ANALYZER_TASK_CONTRACT`、`buildEventAnalysisMessages()`、`formatEventAnalysisRules()`、`formatEventAnalysisReferences()`、`formatEventCharacterRegistry()`、`formatEventCharacterContext()`、`formatNarrativeContext()` 没有其它文本/调用结构变化。

1. `EVENT_ANALYZER_CORE_CONTRACT` 新增：目标楼层直接描述仍存在/正在发生的疼痛、酸胀、肿胀、瘀痕、活动受限等症状时，即使诱因在 Recent Story，也评估为当前楼层 `physical_symptom`；只有无当前状态、仅泛回顾才不输出。
2. `EVENT_ANALYZER_CORE_CONTRACT` 将 `physical_symptom` payload 从泛化的 `symptom` 文字要求收紧为 `{"symptom":{"kind":"...","description":"..."}}`，并将 `medical_event`/`other_biological` 收紧为 `{"fact":{"kind":"...","description":"..."}}`。
3. `EVENT_ANALYZER_OUTPUT_CONTRACT` 新增：`pregnancy_relevance.reproductive_mechanism.evidence[]` 不能替代顶层 `source_evidence[]`；`relevant=true` 必须另有顶层 pregnancy exposure evidence。

语义影响：第 1 条可能增加当前楼层 physical symptom 的发现；第 2 条可能使不符合新 payload 的 AI Event 在 parser/schema 阶段失败；第 3 条可能使 pregnancy-related Event 因证据不足被拒绝。它们都不改变人物 identity、participant exhaustive discovery、registry 写入、`tracking_subjects` eligibility 或人物 UI 的来源。prompt 没有导致“registry 有实体但 business character 为 0”的直接调用链证据。

## B. 人物消失是否由 prompt 引起

当前证据结论：不是已证实的 prompt 根因。

`a8030e` 与当前的 `core/identity.js`、`core/tracking.js` 没有差异；两版本 `collectCurrentDerivedState()` 都将有效 Floor Events 送入 `rebuildTrackingRegistry()`，两版本 `buildBusinessData()` 都把 `registry.tracking_subjects` 输出为 `tracking_subjects`。当前 prompt diff 只影响物理症状 payload 和 pregnancy evidence contract。

## C. a8030e 人物数据生成链

`analyzeFloor()` 返回 AI Event envelope → `parseEventAnalysisResponse()` 保留 0/1/N Events → `resolveEventAnalysisIdentities()` 为全部 participants 建立/复用 canonical entities → normalization/validation → Floor 保存 `analysis/events/character_registry` → `collectCurrentFloorStates()` 读取有效 Floor → `rebuildTrackingRegistry(activeEvents, world)` → `tracking_subjects/tracking_candidates/character_profiles` → `buildBusinessData()` → `ui/app.js` 的 `trackingSubjects` → `ui/characters.js` 的 `subjectEntries()`。

baseline 没有 `CHARACTER_CANONICAL_ACTUAL` / `CHARACTER_UI_READY` 门；页面直接消费 `collectActiveBusinessData()` 的 `tracking_subjects`。因此 baseline 的“人物”也不是 `character_registry.entities` 的全体。

## D. 当前人物数据生成链

AI → parse → identity resolution → canonical Events/registry → persistence/readback 后，当前额外执行 `refreshTrackingRegistry()`，随后 `verifyCharacterCanonicalReady()` 再调用 `collectActiveBusinessData()`。`character_count` 在 `runtime/event-analysis.js:2896` 由 `Object.keys(business?.tracking_subjects ?? {}).length` 构造；UI refresh 的同名 trace 在 `ui/app.js:2892,2897` 也由 `trackingSubjects` 构造；`ui/characters.js:325-330` 再从该对象生成列表。

## E. `registry=1` 但 `character_count=0` 的精确原因

1. `slotAudit.character_count` 在 `runtime/event-analysis.js:2828-2830` 统计 `floorData.character_registry.entities`。
2. `business.tracking_subjects` 在 `runtime/event-analysis.js:2981` 取 `registry.tracking_subjects`。
3. `rebuildTrackingRegistry()` 只扫描 `isPregnancyRelevantExposure(event)` 的 gestational subjects（`core/tracking.js:475-506`）；pending 写入 `tracking_candidates`（`559-575`），只有 `eligibility === "eligible"` 才写入 `tracking_subjects`（`577-596`）。
4. identity resolution 对 Event participants 逐个建/复用 entity（`core/identity.js:1527-1698`），所以 counterpart、仅参与但非 gestational subject、pending/ineligible subject 都可能使 `entities` 为 1，却不产生 `tracking_subjects`。

因此最可能的具体状态是：唯一 registry entity 是 counterpart/source，或唯一 gestational subject 的 World Model capability 为 null/false，导致 candidate/ineligible；需要下一次 Trace 的 participant/eligibility payload 才能在这两个子情况间定论。`character_context`、profiles、snapshot、projection_timeline 不直接构造人物 count：profiles 只供 facts/profile 使用；snapshot 只用于 State restore；projection timeline 是 Projection 读模型。

## F. Event 少提取发生在哪一侧

当前 Trace 只能确认持久化/readback 最后是 1 个 Event，不能确认 AI 原始响应是否只有 1 个，因为现有 `EVENT_RAW_RESPONSE_SHAPE` 没有 raw event count。现有等价阶段是：

- `EVENT_PARSE_RESULT.event_count`：parsed count（`ai/analyzer.js:3097-3140`）。
- `EVENT_NORMALIZATION_RESULT.event_count`：identity-resolved 后 normalization count（`runtime/event-analysis.js:3540-3548`）。
- `CHARACTER_CANONICAL_EXPECTATION.expected_event_count`：normalized input count（`runtime/event-analysis.js:3559-3562`）。
- `CHARACTER_CANONICAL_ACTUAL.actual_event_count`：Floor readback count（`runtime/event-analysis.js:2908-2911`）。

Runtime identity resolution 是原子性的：失败时整批 `events=[]` 返回失败，不会把多个 Event 静默压成一个；正常 normalization 对每个 resolved Event map，deterministic ordinal ID 也不会让多个 ordinal 互相覆盖。`dedupeEvents()` 只按 event_id 去重，而 event_id 是 ordinal 生成的。因此若下次 Trace 显示 raw/parsed/resolved/normalized 都为 N、readback 为 1，才应继续审计 Runtime/persistence；目前没有这种证据。

最小 diagnostics 补齐建议（不在本轮实施）：在现有 stages 增加 `raw_event_count`、`parsed_event_count`、`validated_event_count`、`identity_resolved_event_count`、`canonical_event_count`、`persisted_event_count`、`readback_event_count`；participant 侧增加 `raw_participant_count`、`resolved_participant_count`、`registry_character_count`、`business_character_count`，并携带 participant IDs/eligibility reason。不要重复造 `EVENT_PARSE_RESULT.event_count`、`EVENT_NORMALIZATION_RESULT.event_count`、`CHARACTER_CANONICAL_EXPECTATION.expected_event_count`、`CHARACTER_CANONICAL_ACTUAL.actual_event_count`。

## G. 引入行为差异的 change

- `ai/prompts.js` 的 prompt 变化来自 `b4df893`，但不覆盖 identity/tracking/UI 人物生成。
- `b4df893` 新增 `verifyCharacterCanonicalReady()`、`CHARACTER_CANONICAL_ACTUAL`、`CHARACTER_CANONICAL_STATE_BUILT`、`CHARACTER_UI_READY`，并在 Event stage 完成后调用；它引入了“business character count”与“registry entity count”并列但命名不清的 Trace。
- `b4df893` 的 readiness 条件（`runtime/event-analysis.js:2927-2930`）没有检查 `character_count`，所以 `0` 仍可 ready；这是 readiness diagnostics/contract gap，而非已证明的 extraction regression。
- `ui/app.js` 的 single-in-flight/queued refresh 只串行/排队 `collectActiveBusinessData()`（`ui/app.js:2846-2969`），不改变输入对象来源；它没有把 registry 替换成 derived profile。

## H. 最小修复位置

先补 diagnostics，再依据真实 raw/parsed/resolved/readback counts 定位。若 counts 证明 AI 只返回 1 个，修复位置是 Event prompt/model extraction；若 counts 证明 Runtime 在 identity/normalization/canonical 间丢失，最小修复点是对应阶段而不是 persistence；若 counts 一致但人物仍为 0，则修复 `rebuildTrackingRegistry()` 的 eligibility/business contract 或修正 readiness 命名/条件。不要直接把 `character_registry.entities` 当人物列表，这会违反当前 Characters 仅展示 Tracking Subjects 的边界。

## I. 明确不要改

本轮没有直接证据要求修改 `FloorPersistenceCoordinator`、Generation Settle Barrier、Analysis Input Ready、Owner Acquisition、World/Event persistence、host-ahead bootstrap、Stage Retry 或 scheduler；它们已由真实 SillyTavern World/Event F5 测试验证，应保持不动。

## J. 是否先补 diagnostics 再真实测试

是。下一次真实 Event Stage 前应先补齐上述计数（优先复用已有四个等价 diagnostics），否则只能看到最终 `1`，无法区分“AI 只返回 1”与“Runtime 从 N 变 1”。本轮未实施 diagnostics 或生产修复。

## Verification

在 clean production worktree 上运行了带目标名称过滤的 Node test：927 tests 中 926 passed、1 failed。唯一失败是既有 `start-new-chat-lifecycle.test.js` 的 unknown-source-save 断言，属于 lifecycle clear 测试，与本审计目标无直接关系；其余相关 Event/identity/tracking/canonical/UI tests 通过。由于过滤表达式仍匹配了大量测试，不能将该结果视为完整 `npm test` 结论。
