# 修复人物分析 Prompt gender/type/capability 回归

## Goal

修复当前 HEAD 中 Event Analyzer Prompt 的人物映射回归：允许明确的生理性别事实将人物映射到当前 World Model 已存在的 `biological_type`，但不允许 gender/sex 越过 World Model 直接授权或补齐生殖 capability。

## Confirmed facts

- 回归性 authority 句由 `8f98263b` 加入 `ai/prompts.js:64`。
- 同一 Prompt 已有且必须保留的语义位于 `ai/prompts.js:79-85`：Character Card / Persona / Worldbook / Narrative / Existing profile 可参与 species/type mapping；明确生理性别可作为 `biological_type` mapping evidence；capability 必须来自匹配 World Model baseline 或明确个体证据。
- `core/tracking.js:318-347` 的 `resolveCarryingCapability()` 在 mechanism 缺失或非唯一匹配时保留 participant 明确 `can_carry_pregnancy` 的 `EXPOSURE_CARRYING_CAPABILITY` fallback。本任务不得修改该逻辑，也不得新增 gender eligibility fallback。

## Requirements

1. 将 `EVENT_ANALYZER_CORE_CONTRACT` 的冲突 authority 句统一为：World Model 是世界级规则权威；species/type mapping 可综合指定上下文与稳定生理事实；明确生理性别只能映射到当前 World Model 已存在的 type，不能创建 type 或授权 capability；capability/mechanism compatibility 只能来自匹配 baseline 或明确个体证据，不得使用现实人类常识或旧默认能力补空。
2. 检查并同步 `EVENT_ANALYZER_TASK_CONTRACT` 与 `EVENT_ANALYZER_OUTPUT_CONTRACT`，确保三处不存在 gender/type/capability 的相互矛盾规则。
3. 增加最小 regression coverage：A 为 Human 女性 type baseline，B 为缺少女性 type，C 为 Nonhuman 同名 type 且 capability null，D 为 mechanism 非唯一时 participant 明确 carrying capability fallback，E 为冲突 mapping 保持 null/pending。
4. 审计 `8f98263b`、`cbb5654e`、`12b40071`、`89a76da6`、`b4df8930` 对 biological context、capability、participant identity/type、tracking 与 character profile 的影响，并在最终报告中说明是否需要除 Prompt/测试外的改动。

## Acceptance Criteria

- [ ] 三个 Event Analyzer contract 的最终文本对 gender → type → capability 语义一致。
- [ ] A–E regression tests 通过；D 证明 `core/tracking.js` 未被改动且 fallback 仍有效。
- [ ] `npm run check`、`node --check ai/prompts.js`、`git diff --check` 通过。
- [ ] 未修改 Runtime、identity、World Model、Story Time、Calendar、StateReducer、Floor ownership、Persistence Coordinator 或进入 Phase 2C。
- [ ] 未提交，未推送。

## Out of scope

- 不回滚整个提交，不修改 Runtime tracking 语义，不新增 gender eligibility 分支。
- 不改变 World Model schema、Floor ownership、Persistence、Character identity 或 UI 产品边界。
