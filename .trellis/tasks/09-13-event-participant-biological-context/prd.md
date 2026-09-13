# 补齐 Event participant 生物身份上下文

## Goal

为 pregnancy-related sexual_activity 的每个 participant 补齐可审计的 biological_context，并在 AI DTO 边界校验字段与未知 capability 语义，保持 Core/Tracking/UI 边界不变。

## Context

当前 `ai/analyzer.js` 允许 participant 省略 `biological_context`，或传入缺少 `species` / `biological_type` 的对象；`core/events.js` 已能在 Domain normalization 阶段保存这两个字段，`core/tracking.js` 也已通过 `profileFromParticipant()` 将其写入 character profile。本轮只补齐 AI 输出合同和验证链，不重新设计 World Model、Profile 或 Tracking。

## Requirements

- R1. 仅对 `type === "sexual_activity"` 且 `pregnancy_relevance.relevant === true`、`possible_conception === true` 的 Event 强制 participant 身份上下文；该 Event 的每个 participant 都必须包含 `biological_context` 对象。
- R2. `biological_context` 必须包含 `species` 与 `biological_type` 两个字段；每个值只能是非空字符串或 `null`，资料不足时使用 `null`。不新增 `gender`，不根据姓名、外貌、event_role、性行为位置或主动/被动角色猜测生物身份。
- R3. Prompt 必须要求 capability 判断先参考当前 World Model、已有 character profile，以及 Character / Worldbook / 当前剧情证据，再填写 `reproductive_capabilities_used`；身份字段用于说明这次 capability 判断采用的生物身份背景。
- R4. 在 `ai/analyzer.js` 的 AI DTO / Domain boundary 拒绝缺少 `biological_context`、缺少任一必需字段、或字段值类型不合法的 pregnancy exposure Event，并提供稳定、可诊断的错误信息。`null` 是合法值。
- R5. 当 `species` 与 `biological_type` 均为 `null` 且没有直接人物证据时，Prompt 必须要求相关 capability 保持 `null`，不得凭空输出完整 capability 套装；验证逻辑不得用性别或角色替代证据。由于现有 `evidence` 是自然语言字段，不能用脆弱的字符串启发式判定“直接证据”，本轮以 Prompt 合同和抽象 fixture 回归锁定该语义。
- R6. `core/events.js` 继续保存 `biological_context.species` 与 `biological_context.biological_type`；`core/tracking.js` 的 `profileFromParticipant()` 保持不变；UI 不补身份字段，也不从 Event 重建人物。
- R7. 补充抽象 ID 回归测试：明确身份上下文、资料不足与 role-only/no-evidence 三类场景；同时覆盖缺失对象、缺失字段、非法值的 DTO rejection，以及 Core normalization 的字段保留。
- R8. 仅同步与该合同直接相关的领域/提示文档；不进入大规模 World Model / Profile 架构重构。

## Acceptance Criteria

- [x] `ai/prompts.js` 明确要求 pregnancy-related `sexual_activity` 的每个 participant 必填 `biological_context: { species, biological_type }`，并说明其与 capability 证据链的关系。
- [x] `ai/analyzer.js` 对缺少上下文、缺少字段、非法值的 pregnancy exposure participant 拒绝结果；两个字段为 `null` 时仍可通过结构校验。
- [x] 明确身份且证据充分的 fixture 保留对应 species/type；资料不足 fixture 返回 `null` 身份，且未知 capability 为 `null`；只有 event_role 时不能产生完整 capability 套装。
- [x] `core/events.js` 的 normalization 测试证明两个身份字段仍被保存；`core/tracking.js` 没有生产代码改动，既有 profile 写入测试继续通过。
- [x] 非 pregnancy BiologicalEvent 的 participant 合同与即时 physical effect / ordinary food、supplement、static appearance 的既有独立事件边界不被本轮放宽或改写。
- [x] 通过 `npm run check`、`git diff --check`，所有修改的 JS 通过 `node --check`。
- [x] 不修改 StateReducer、Snapshot、Projection、Genealogy、StoryTime、Universal World Model cleanup、profile conflict/override、Tracking eligibility 或 UI 拆分逻辑；不 commit、不 push。

## Notes

- 本轮最终规划已获批准，任务已进入 implementation；不得在本任务范围内 commit 或 push。
- 保护边界：`biological_context` 的结构校验属于 AI DTO boundary；Domain 只负责现有 normalization/storage；Tracking 和 UI 只消费已验证结果。
