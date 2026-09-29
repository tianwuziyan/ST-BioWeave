# Phase 6 World Model Supplement Documentation Consistency Report

## A. Documentation Inventory

本阶段审计了以下 current-facing 文档、规范、测试描述和相关源码注释：

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/DEVELOPMENT.md`
- `docs/CONTEXT-AND-PROMPT.md`
- `.trellis/spec/domain/world-model.md`（current normative source of truth）
- `ai/**/*.js`、`runtime/**/*.js`、`ui/**/*.js`、`tests/**/*.js` 中与 World
  Model / Supplement / Debug diagnostics 相关的命中
- `.trellis/tasks/archive/**` 仅审计，未修改

## B. Stale Current References

确认的 stale current references：

- `docs/DEVELOPMENT.md` 原先把 Supplement 写成
  `hierarchical Candidate text -> deterministic Candidate -> internal Patch v2`。
- `docs/ARCHITECTURE.md` 原先把 Analyzer 生成 Supplement Candidate、再生成
  Patch v2 的旧 transport 描述作为当前模块导航。
- `docs/CONTEXT-AND-PROMPT.md` 原先把 Supplement response 描述成
  hierarchical Candidate text 和 deterministic Candidate。
- `.trellis/spec/domain/world-model.md` 的当前 pipeline 中有
  `complete candidate` 和未明确 wire/IR ownership 的旧式表述，已改为
  complete canonical model / JSON Fact Delta / Host-internal Patch v2。

未发现需要改生产行为的 DOC/CODE CONTRACT CONFLICT。实现中的 prompt 已实际
返回 JSON Fact Delta，且不包含 `Supplement Candidate`、`hierarchical Candidate`
或 `Patch v2` output wording。

## C. Updated Files

- `.trellis/spec/domain/world-model.md`
  - 增加 persistence candidate 与旧 AI Candidate 的边界定义。
  - 明确 JSON Fact Delta root、Fact validation、resolver、Existing comparison、
    Fact Delta safety boundary 和 Host-internal Patch v2 顺序。
  - 明确 Existing/Coverage Targets 不是 evidence。
  - 移除当前 pipeline 中会暗示 Candidate transport 的描述。
  - 补充 `resolved_unknown_ids` root contract 示例。
  - 保留并强化 Debug Schema v3、无 semantic continuation、result/persistence
    ownership 的规范表述。

- `docs/DEVELOPMENT.md`
  - 用当前 Supplement pipeline 替换 hierarchical Candidate / deterministic
    Candidate 旧架构段。
  - 增加 Fact Delta、identity、evidence、dynamic accounting 和 retry 边界。

- `docs/ARCHITECTURE.md`
  - 将 World Analysis 模块导航改为 JSON Fact Delta -> Host-internal Patch v2
    operation -> classification/merge。
  - 明确 Patch v2 不是 AI output 或 Supplement wire format。

- `docs/CONTEXT-AND-PROMPT.md`
  - 同步当前 Supplement request/response、Fact claim、Existing/evidence、
    persistence candidate 术语。

- `README.md`
  - 增加简短的当前 Supplement architecture 摘要，不复制完整领域规范。

## D. Historical References Preserved

`.trellis/tasks/archive/**` 未修改。扫描到的两处旧符号引用均属于历史任务文档：

- `09-29-world-supplement-collection-unknown-lifecycle/audit.md`
- `09-29-world-supplement-collection-unknown-lifecycle/prd.md`

它们描述当时的实现状态，不是 current normative architecture。测试中的旧术语
主要属于 prompt negative regression assertions，例如断言当前 prompt 不包含
`Complete Evidence-Supported Candidate`、`coverage continuation` 或第二次
semantic model call；这些断言被保留。

## E. Candidate Terminology

current 文档现在明确区分：

- 已退出 current architecture：AI hierarchical Candidate、Supplement Candidate
  transport、Complete Evidence-Supported Candidate、Candidate -> Patch v2 adapter。
- 仍合法：`candidate_model`、`candidate_fingerprint`、`candidate_reference`、
  `publishWorldModelCandidate`、`completedWorldCandidates`，均表示
  authoritative persistence/readback confirmation 前的 transient validated
  canonical persistence candidate。

## F. Patch V2 Terminology

current 文档统一说明：Patch V2 是 Host-internal deterministic mutation IR。
它不是 AI output format、Supplement wire format、raw model response contract 或
persistence DTO。Supplement 的 wire response 是一个 JSON Fact Delta root。

## G. Retry / Dynamic Accounting

current 文档统一说明：Supplement 没有 semantic continuation。Dynamic coverage
是 Host-local accounting，不触发 coverage continuation 或 completeness retry。
额外 API attempt 仅属于 transport/request failure、response-read failure、不可
恢复 root JSON/format failure 或 `FORMAT_RETRY`。

Debug Schema v3 terminology 已在规范和开发文档中使用：

- `dynamic_coverage_target_ids`
- `unaccounted_dynamic_target_ids`
- `derived_target_accounting_records`
- `derived_target_accounting_complete`
- `dynamic_coverage_unaccounted_in_single_response`

## H. Debug Schema v3

current 文档不再把以下 v2 names 作为 current schema 描述：

- `coverage_rounds`
- `unresolved_dynamic_target_ids`
- `coverage_fixed_point_reached`
- `dynamic_coverage_unresolved_in_single_response`
- `mutation_ui_projected`

规范保留了当前 `record_index` 不是 semantic continuation round、accounting
completion 不是 semantic convergence 的说明。

## I. Full vs Supplement

Full：

```text
buildWorldModelMessages()
  -> API
  -> parseWorldModelResponse()
  -> applyWorldModelEvidenceGuard()
  -> final consistency
  -> canonical model
  -> Snapshot / persistence
```

Supplement：

```text
buildWorldModelPatchMessagesV2()
  -> one JSON Fact Delta response
  -> parseWorldModelFactDeltaJson()
  -> Fact validation
  -> canonical address resolution
  -> Existing comparison
  -> applyWorldModelFactDeltaEvidenceGuard()
  -> Host-internal Patch V2 operation
  -> classification / classified merge
  -> Snapshot / persistence
```

Full 使用 `applyWorldModelEvidenceGuard()`；Supplement 使用
`applyWorldModelFactDeltaEvidenceGuard()`。旧
`applyWorldModelPatchV2EvidenceGuard()` 不属于 current architecture。

## J. Result and Persistence Ownership

文档现在明确区分：

- `world_model_live_state.execution_result`：whole-execution result；
- `latest_fact_delta.fact_delta_result`：single Fact Delta attempt result。

因此 `execution_result = UPDATED` 与 `fact_delta_result = NO_CHANGE` 是合法组合。
Fact Delta 不拥有最终 persistence status；`persistence_requested`、
`persistence_confirmed`、reconciliation、authoritative readback 和 UI ingress
属于 execution/persistence boundary。

## K. Source Scan

current `ai/`, `runtime/`, `ui/`, `tests/`, `docs/`, README 和 `.trellis/spec`
中的旧入口、旧 parser/adapter symbols 均为 0。当前仍存在的
`mergeWorldModelPatchV2Classified` 是保留的 Host-internal primitive，不属于
被清理的 `mergeWorldModelPatchV2`。

保留分类：

- archive historical references：2；
- negative regression assertions：`tests/world-model.test.js` 中关于旧 Candidate
  wording、coverage continuation 和 second semantic call 的断言；
- current explanatory negative wording：规范中用于明确“不是旧架构”的边界句，
  不表示旧架构仍是 current path。

未发现 current source/spec/docs 中的：

`parseWorldModelCandidateText`、`validateWorldModelCandidate`、
`parseWorldModelSupplementText`、`worldModelCandidateToPatchV2`、
`WORLD_MODEL_PATCH_V2_TASK_PROMPT`、`WORLD_MODEL_PATCH_V2_OUTPUT_CONTRACT`、
`WORLD_MODEL_SUPPLEMENT_FIELD_DICTIONARY`、
`WORLD_MODEL_LEGACY_FACT_DELTA_TASK_PROMPT`。

## L. Verification and Diff Scope

- `git diff --check`：通过。
- focused suite：`322 total / 290 pass / 32 fail`，与当前已知 baseline 一致；
  失败集中在既有 prompt/settings fixture assertions，文档改动未新增 runtime
  failure。
- 本阶段未修改 JS 行为实现，因此没有新增 `node --check` 目标；已通过现有
  focused test 触发相关模块加载。
- Phase 6 修改范围仅为 documentation/spec/architecture notes：
  `.trellis/spec/domain/world-model.md`、`docs/DEVELOPMENT.md`、
  `docs/ARCHITECTURE.md`、`docs/CONTEXT-AND-PROMPT.md`、`README.md`，以及本
  task report。
- 未修改 prompt behavior、parser、resolver、guards、Patch V2 mutation、retry、
  Snapshot、persistence coordinator、canonical schema、UI projection 或
  Debug Schema v3 production implementation。
