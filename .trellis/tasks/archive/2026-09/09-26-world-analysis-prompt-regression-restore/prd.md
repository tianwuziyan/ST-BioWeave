# World Analysis Prompt 回归恢复与历史规则对照

## Goal

审计历史 World Model classification/evidence 修复，冻结 Full/Supplement 共享语义不变量，并仅更新 canonical spec 与设计文档。

本任务解释当前真实 API 中 Existing World Model 分类可疑、evidence 已有但 Supplement 返回空 Patch 的回归风险；目标是恢复历史行为不变量，而不是机械回滚历史实现。

## Confirmed scope and constraints

- 只允许设计与文档工作；不得修改生产代码、Prompt 实现、analyzer、validator、merge、runtime、UI 或测试。
- 历史对照提交：`1f382a0469f1423ffa36c9c4860ecba8fefd0f56`、`784cd1292b117fbc50687c6b3c8b112a85c77a5d`、`ce1d09517ed516bfa8a2c0ecf1b0444f0d59350c`。
- 必查当前文件：`ai/prompts.js`、`ai/analyzer.js`、`tests/world-model.test.js`、`.trellis/spec/domain/world-model.md`、`docs/CONTEXT-AND-PROMPT.md`，以及相关历史 task/design 文档。
- canonical owner 是 `.trellis/spec/domain/world-model.md`；Supplement task/design 文档只记录本次审计、矩阵、恢复计划和独立 gap，不取代 canonical spec。
- 只有确实存在直接冲突时才同步 `docs/CONTEXT-AND-PROMPT.md`；不扩散到其它文档。

## Required design decisions

1. 增加正式 `World Analysis Prompt Regression Matrix`，逐项记录 Rule / Invariant、历史提交、历史行为、当前行为、状态、原因和所需回归覆盖；状态限定为 `KEEP`、`RESTORE`、`STRENGTHEN`、`SUPERSEDED`、`DO NOT RESTORE`。
2. 冻结 species/type 分层、biological_type 的 species-local stable biological/reproductive boundary、通用 Exclusion Gate、Name Is Not Evidence、species-linked evidence、Human baseline、capability tri-state、rare/minority、Fact Discovery、low-inference stable classification 及新增 World Model outlets 的语义。
3. 明确低推理分类顺序：Candidate Discovery → Species Binding → Exclusion Gate → Stability Gate → Biological/Reproductive Classification Gate → Evidence Sufficiency → Type Creation；低推理不得绕过排除门。
4. 明确 Full 与 Supplement 共享同一套 semantic invariants；Existing 仅是 Supplement comparison baseline，不是 evidence；Full 不消费 baseline，Supplement 不能因 Existing 非空而跳过分类审查。
5. 明确 Empty Patch 合法但只能表示完整 Fact Discovery、baseline comparison、completeness/type/missing-fact/consolidation review 后没有合法 ADD/CHANGE candidate。
6. 明确 Structural Reclassification / Existing Classification Correction 是独立 gap；本任务不开放 arbitrary REMOVE，也不修改现有 remove protection。
7. 只设计 generic regression fixtures A–O，不实现测试，不把历史 fixture 名称或 species/type 名称写入 production contract。
8. 明确历史 deterministic species/name/fixture if-else、大型 regex narrative classifier、第二套 NLP parser 均不得恢复；AI 负责语义，程序负责结构、identity、evidence isolation、delta/merge/consistency/strict validation。

## Acceptance Criteria

- [ ] 当前 task/design 文档含完整 Regression Matrix，覆盖用户列出的 12 类重点规则、Full/Supplement、Empty Patch 与 Structural Reclassification 边界。
- [ ] canonical `.trellis/spec/domain/world-model.md` 含冻结后的通用语义顺序、排除类别、Human/Nonhuman 与 tri-state 边界，并保留后来新增能力。
- [ ] generic regression design 覆盖 A–O：species 无 type、非生物身份排除、双 cluster、单 cluster、不足 capability、跨 species 隔离、未观察 pregnancy、明确 false、rare/minority、individual exception、Supplement 非空 baseline 仍发现事实、baseline 不作 evidence、Full baseline-free、Supplement baseline-aware、Exclusion Gate 优先级。
- [ ] 文档明确记录 `RESTORE` / `STRENGTHEN` / `KEEP` / `DO NOT RESTORE`；真正冲突标记 `REVIEW REQUIRED`，不自行选边实现。
- [ ] `docs/CONTEXT-AND-PROMPT.md` 仅在存在直接冲突时同步。
- [ ] `git diff --check` 通过，且最终 diff 只包含允许的文档/任务设计文件；生产代码与测试文件无修改。

## Out of scope

- 任何生产代码、Prompt 常量、analyzer/validator/merge/runtime/UI 修改。
- 测试实现、fixture 实现、真实 API 重跑或为测试通过而改实现。
- arbitrary REMOVE、通用 Structural Reclassification、schema redesign、Human baseline redesign。
- 恢复历史具体 species/type 名称判断、fixture-specific branch、regex narrative parser 或第二套 NLP parser。
- commit、push。

## Open questions

- 若历史提交与当前 canonical spec 对同一语义存在真实冲突，必须在矩阵标记 `REVIEW REQUIRED`，并停止自行选择实现方案。

## Notes

本任务是现有 `09-25-world-model-supplement-differential` 的设计审计子任务；不改变父任务的实现授权边界。
