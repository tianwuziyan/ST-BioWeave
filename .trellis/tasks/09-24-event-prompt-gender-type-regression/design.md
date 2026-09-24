# Technical design

## Boundary

最小行为缺口位于 Event Analyzer 的文字 contract：前部把 gender/sex 排除在所有 mapping 证据之外，后部又允许明确生理性别参与既有 World Model type mapping。修复只调整 Prompt 规则表达，并用 Prompt contract assertions 加上既有 tracking unit path 验证边界。

## Data flow and invariants

```text
Character/Persona/Worldbook/Narrative stable sex fact
  -> map only to an already-present species/type in validated World Model
  -> read matching type baseline
  -> combine explicit individual evidence
  -> capability / mechanism compatibility
  -> Runtime eligibility
```

- gender/sex never creates a missing type, selects a Human template for Nonhuman, or directly sets a capability.
- conflicting mapping remains `null`/`pending`.
- Runtime remains the owner of canonical IDs and tracking decisions.
- Mechanism non-unique fallback remains `resolveCarryingCapability()` and uses explicit participant capability only.

## Files

- `ai/prompts.js`: reconcile CORE/TASK/OUTPUT contract language.
- `tests/event-analysis.test.js`: assert the prompt contract contains the positive mapping rule and negative capability/type guard across A-C/E semantics.
- `tests/tracking.test.js`: retain/add a narrow D assertion for the existing explicit capability fallback without changing production Runtime.
- `.trellis/tasks/09-24-event-prompt-gender-type-regression/*`: planning and final evidence only.

## Explicitly not changing

No Runtime, tracking, identity, World Model, lifecycle, Floor, persistence, UI, or Phase 2C code. No commit or push.
