# Actual reproductive exposure audit

## Audit scope

审计时间：2026-09-11。目标是确认本次收紧会影响哪些现有契约，同时排除 StateReducer、Projection、Genealogy、World Model 和 Runtime Registry 的实现范围。

## Repository state

- `git status --short --branch`：`fix/world-model-prompt-baseline`，既有 worktree clean。
- `git log -1 --oneline`：`67fa679 chore: record journal`。
- 审计后新增的未跟踪内容只属于当前 Trellis task planning artifacts，不是产品实现。

## Findings

| Area | Evidence | Finding |
| --- | --- | --- |
| Prompt | `ai/prompts.js:24-34`, `42-54` | Core contract still says sexual_activity should extract “全部实际参与者” and “不要省略实际参与者”; no final barrier/outcome semantics or direct exposure participant rule. |
| AI parser | `ai/analyzer.js:1079-1231`, `1308-1364` | Fixed envelope, array references, event roles, evidence shape and optional physical_effect object are validated; `physical_effect.gestational_substance_intake` and actual exposure consistency are not. |
| Domain | `core/events.js:242-258`, `286-420` | normalize keeps physical_effect; validate checks shape/enums/source/evidence but does not require exposure evidence for possible_conception or verify relevance arrays against participants. |
| Runtime | `runtime/event-analysis.js:745-769` | Runtime canonicalizes event identity/source and calls `validateEvent` before save; this is the correct enforcement point, and runtime orchestration must remain unchanged. |
| Tracking | `core/tracking.js:155-224` | Eligibility already requires sexual_activity, non-excluded status, relevant, possible_conception, subject ID and `can_carry_pregnancy=true`; no change is needed. |
| Character UI | `ui/characters.js:123-145`, `178-195` | Character exposure card renders both participants and counterpart; counterpart names already come from `counterpart_ids` mapped through event participants. |
| Event UI | `ui/events.js:100-151` | Global Event page renders canonical participants and pregnancy relevance. It can remain a presentation of the now-narrowed Event; it must not recalculate exposure. |
| Documentation | `docs/DATA-MODEL.md:97,177`, `docs/DEVELOPMENT.md:48,73`, `docs/UI.md:23,29,39,43` | Documentation describes participants as all actual participants and character records as showing all participants; these statements must be corrected. |
| Existing regressions | `tests/events.test.js`, `tests/event-analysis.test.js`, `tests/event-analysis-runtime.test.js`, `tests/tracking.test.js`, `tests/phase2a-ui.test.js` | Positive fixtures assume possible_conception can be true with weak/general evidence; UI fixture expects character exposure participants. Fixtures and assertions must be updated, while Tracking behavior assertions remain. |

## Chosen contract for implementation

Use the existing evidence object shape and add one mechanism-neutral evidence kind, `conception_relevant_exposure`, for Domain-level presence checking. The validator will not parse natural-language anatomy, protection, gender, semen, or event-role text. `physical_effect.gestational_substance_intake` remains an optional structured effect field; if present it must be boolean/null, and true requires the same actual-exposure evidence marker. Prompt and abstract-ID tests carry the real-world barrier examples; Domain only enforces typed evidence and ID relationships.

This preserves Universal Plugin extensibility while giving `possible_conception=true` a machine-checkable evidence boundary. No migration or storage rewrite is planned; persisted Events that fail the new contract remain subject to normal Runtime/Core validation and need re-analysis rather than an automatic historical rewrite.
