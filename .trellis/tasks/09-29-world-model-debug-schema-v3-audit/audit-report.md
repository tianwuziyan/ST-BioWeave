# World Model Debug Schema v3 / Diagnostics Naming — Phase 1 Audit

审计日期：2026-09-29
分支：`fix/world-model-prompt-baseline`
范围：AUDIT / DESIGN ONLY；未修改 production code、tests、Spec、UI 或 `WORLD_MODEL_DEBUG_SCHEMA_VERSION`。

## A. Executive Summary

### 结论

**Debug Schema v3：YES。**

不是因为字段名称不够漂亮，而是因为当前 v2 同时存在三个会影响调试结论的结构性问题：

1. `world_model_live_state.final_result` 是 execution-level outcome，而 `latest_fact_delta.final_result` 是 attempt/fact-delta-level classification；同名字段会把正常的跨阶段差异误读为冲突。
2. `latest_fact_delta.persistence_occurred` 是 Fact Delta 产生时固定为 `false` 的 stage-local 字段；它不表示最终 execution 没有持久化，而字段名没有 owner/timepoint。
3. `coverage_rounds[]` 确实可能有多个记录，但其中的 `round` 实际是 Host-local accounting record index，混合了 semantic stage attempt 与 accepted-patch failure recovery 的 accounting，而不是 semantic continuation round 或 fixed-point iteration。

### 明确决策

| Decision | Result |
| --- | --- |
| Debug Schema v3 是否值得创建 | **YES** |
| Dynamic coverage diagnostics | **PARTIAL CHANGE** |
| `dynamic_coverage_target_ids` | KEEP |
| `unresolved_dynamic_target_ids` | RENAME（建议 `unaccounted_dynamic_target_ids`） |
| `coverage_rounds` | RESHAPE（保留数组，但改成 accounting records 语义） |
| `coverage_fixed_point_reached` | RENAME（建议 `derived_target_accounting_complete`） |
| `dynamic_coverage_unresolved_in_single_response` | RENAME（建议 `dynamic_coverage_unaccounted_in_single_response`） |
| Result/Persistence ownership ambiguity | **存在，且是 Tier 1** |

### Dynamic coverage 总结

`dynamic` 和 `target` 当前仍准确：它们表示 Host 在 accepted canonical mutation 后，从 candidate model 重新派生出的、初始 target set 中不存在的 coverage target。
`unresolved` 不够准确：当前代码没有再次执行 Resolver 或 coverage matching；它直接将 `unresolvedDynamicTargets = dynamicTargets`。更准确的是“未被本次 response 的初始 accounting 集合覆盖/记账”，即 `unaccounted`，不是 `uncovered` 或 `resolution_failed`。

`coverage_fixed_point_reached` 也过度描述算法。当前它只是“没有 Host 派生的新 target”，不是 fixed-point computation result。

### 未判定为 runtime bug 的差异

- execution `final_result = UPDATED` 与 Fact Delta `final_result = NO_CHANGE`：由 producer 和写入时点不同解释，属于 schema clarity issue，不是同一层的错误结果。
- Fact Delta `persistence_occurred = false` 与 execution `persistence_confirmed = true`：同样是 analysis/attempt 与 persistence/execution 的边界差异，不是 persistence failure。

## B. Current Debug Schema Ownership Map

| Owner | Current responsibility | Primary producer | Current boundary |
| --- | --- | --- | --- |
| REQUEST | Request envelope、request mode、evidence/reference/target payload fingerprints、request transition | `ai/analyzer.js:4871-4885`; `runtime/world-analysis.js:949-967` | Fact Delta summary + transition history；sanitized trace 可导出部分字段 |
| FACT_PIPELINE | raw/parsed/rejected/accepted Fact funnel、operation count、canonical mutation、Fact mappings | `ai/analyzer.js:5115-5168` | analyzer summary；`runtime/world-analysis.js` 将其嵌入 attempt summary |
| COVERAGE_ACCOUNTING | initial/current/dynamic targets、dispositions、mutation states、coverage records、derived-target flag | `runtime/world-analysis.js:969-1011`; `ai/analyzer.js:5155-5163` | Host-local in-memory debug only |
| IDENTITY_REVIEW | identity diversity、sibling discovery、Type identity decisions | `ai/world-supplement-protocol.js:223-318`; `ai/analyzer.js:5022-5041` | bounded Fact Delta diagnostics |
| COLLECTION_LIFECYCLE | Special Rule/Exception/Unknown append/dedupe/resolution counts | `ai/analyzer.js:5099-5111`, `5164-5166` | Fact Delta summary |
| EXECUTION_SNAPSHOT | cumulative transient snapshot、accepted operation total、successful round counters、recovery state | `runtime/world-analysis.js:833-848`, `513-520`, `633-638`, `710-716`, `1141-1158` | Runtime diagnostic state；不是 Floor state |
| PERSISTENCE | requested/started/confirmed、persisted fingerprint、Floor transaction result | `runtime/world-analysis.js:673-760` | execution diagnostic + persistence trace |
| RECONCILIATION | authoritative readback comparison/status/fingerprint | `runtime/world-analysis.js:690-752` | execution diagnostic + trace |
| UI_PROJECTION | UI state/render/ingress fingerprints、render counts、projection state | `ui/app.js:918-997`, `1947-1951`, `2010-2024` | live snapshot + UI trace |
| HISTORY_TRACE | bounded sequence of lifecycle/persistence events | `runtime/diagnostics.js:323-404`; adapter allow-list `runtime/events.js:186-242` | event buffer, max 64 sequence entries |

### Mixed ownership findings

- `latest_fact_delta` 当前承载 FACT_PIPELINE、REQUEST、COVERAGE_ACCOUNTING、IDENTITY_REVIEW、COLLECTION_LIFECYCLE，并额外承载 baseline/candidate provenance；它是一个 summary envelope，不是单一 owner。
- `request_transition` 既是 REQUEST 层的单次 transition，又被放入 Fact Delta summary；`request_transitions` 是 execution-history convenience。两者语义相关但不是同一 cardinality。
- `final_result` 同名跨 FACT_PIPELINE/attempt 与 execution/persistence 两层，属于真正的 `MIXED_OWNERSHIP`。
- `persistence_occurred` 同名出现在 analyzer summary、accepted trace、skip trace 和 confirmed trace；只有 confirmed trace 的写入时点真正属于 PERSISTENCE。

## C. Coverage Diagnostics Audit

### C.1 `dynamic_coverage_target_ids`

实际算法位于 `runtime/world-analysis.js:973-980`：

1. `inputTargets` 从 resolved authoritative model 派生，并建立 `initialTargetKeys`。
2. accepted Fact Delta merge 到 `supplementExecutionState.transientModel`。
3. `candidateTargets` 从 transient candidate model 重新派生。
4. `dynamicTargets = candidateTargets - initialTargetKeys`，比较的是 canonical address tuple：`scope/species/biological_type/field`。
5. 序列化为最多 64 个 `target_id`。

结论：

- `dynamic`：准确，表示 execution 开始后 Host 派生出的新增 target，不表示 API continuation。
- `target`：准确，ID 来自 `buildWorldModelSupplementCoverageTargets()`，不是 arbitrary identity 或 Fact ID。
- `ids`：准确，但受到 64 项输出截断；count 才是完整数量。
- action：**KEEP**。v3 只需在 owner 分组中明确它是 derived target inventory。

### C.2 `unresolved_dynamic_target_ids`

当前 producer 是 `runtime/world-analysis.js:980,1007-1008`：

```js
const unresolvedDynamicTargets = dynamicTargets;
```

因此它不是：

- Resolver unresolved；
- Evidence Guard rejected；
- response 中存在 matching Fact 但未 accepted；
- semantic API continuation queue。

它实际表示：accepted mutation 后新出现、没有出现在本次 response 初始 coverage accounting 中的 derived targets。`unresolved` 容易暗示“解析失败”，`uncovered` 容易暗示 coverage matcher 已证明无覆盖，`unreviewed` 又暗示 semantic review 未执行，而当前代码没有逐一记录这种 review 结果。

最准确的设计词是 **unaccounted**：

```text
unaccounted_dynamic_target_ids
```

建议 action：**RENAME**（v3）；保留 v2 alias 仅用于兼容读取，不改变 runtime algorithm。

### C.3 `coverage_rounds`

#### Append paths

| Path | Append? | Evidence | Meaning |
| --- | ---: | --- | --- |
| successful `analyzeWorldModelPatchV2()` response | yes | `runtime/world-analysis.js:907-994` | one local coverage accounting record for that response |
| transport/API failure before analyzer returns | no | `runtime/event-analysis.js:820-829`, `844-898` | no Fact Delta accounting exists |
| response-read failure before response normalization | no | same retry loop | no record |
| `FORMAT_RETRY` failure | no for failed format response | `runtime/world-analysis.js:1015-1075`; `runtime/event-analysis.js:856-909` | no parsed/merged accounting unless an accepted patch was also attached |
| `FORMAT_RETRY` success | yes | successful response path | one record for the successful response |
| accepted patch attached to a thrown error | yes | `runtime/world-analysis.js:1016-1041` | recovery/accounting record is appended before retry decision |
| failed attempt without accepted patch | no | catch path only pushes under `error.accepted_patch.operations.length` | no accepted snapshot mutation to account for |
| `completeWorldAnalysis()` snapshot persistence recovery | no additional append | `runtime/world-analysis.js:1130-1140` | reuses `lastFactDeltaSummary`; it does not create a new semantic/accounting record |
| dynamic target derivation alone | no additional append | `runtime/world-analysis.js:973-994` | only changes fields in the current record |
| Snapshot accumulation | no additional append by itself | `runtime/world-analysis.js:868-902` | snapshot counters are separate from records |

#### What does `round` mean?

`round: supplementExecutionState.rounds.length + 1` (`runtime/world-analysis.js:982-994`) is an index of a Host-local coverage accounting record. It is not a semantic continuation round, not a fixed-point iteration, and not exactly equal to `attempt` because:

- an attempt that fails before an accepted patch creates no record;
- an accepted-patch failure creates a record even though the stage attempt later fails;
- snapshot recovery persists an existing snapshot without appending a record;
- transport retry only creates a record if a later response is actually parsed/accepted.

#### Cardinality

- If `coverage_rounds` is present in a normal successful Fact Delta summary, minimum observed/structural cardinality is **1**.
- It can be **0/absent** when the path fails before a Fact Delta accounting record is produced; this is represented by the field being absent rather than a guaranteed empty array in every failure summary.
- With `retry_count` normalized to 0–3 (`storage/schema.js:248-254`), ordinary stage retries provide up to 4 stage attempts. A successful response or accepted-patch error can append at most one record per attempt.
- `FORMAT_RETRY` bypasses the ordinary retry-budget check once (`runtime/event-analysis.js:856-858`). In the structurally possible edge case where the last budgeted attempt carries an accepted patch and a format-retryable error, the extra format-retry attempt can add one more record. Therefore the safe production upper bound is **5 records**, while common successful Smoke is 1.
- `slice(-16)` (`runtime/world-analysis.js:1009`) imposes a retained/exported upper bound of 16 even if future retry policy changes.

结论：array 不是 legacy residue，必须保留 repeated-record capacity；但名称和 element field `round` 误导 architecture understanding。

建议 action：**RESHAPE** to a clearly named array, for example:

```json
"coverage_accounting": {
  "record_count": 1,
  "records": [
    {
      "record_index": 1,
      "source": "SEMANTIC_RESPONSE_ATTEMPT",
      "input_target_count": 0,
      "reviewed_target_count": 0,
      "accepted_fact_count": 0,
      "accepted_operation_count": 0,
      "derived_dynamic_target_count": 0,
      "unaccounted_dynamic_target_count": 0
    }
  ]
}
```

这里的 `source` 可区分 ordinary response 与 accepted-patch recovery；不改变现有 algorithm。

### C.4 `coverage_fixed_point_reached`

Producer：`runtime/world-analysis.js:1010`。当前定义严格等于：

```text
unresolved_dynamic_target_count === 0
```

而 `unresolved_dynamic_target_count` 又严格等于 `dynamicTargets.length`。当前 architecture 明确规定 dynamic target 不触发第二次 semantic request（`.trellis/spec/domain/world-model.md:1795-1808`），所以这不是 fixed-point iteration result。

建议名称：`derived_target_accounting_complete`。它直接描述当前 predicate：没有 Host 在 accepted mutation 后新增而未进入 initial response accounting 的 target。

action：**RENAME**，Tier 1 clarity；不要在 Phase 2 顺便改 predicate。

### C.5 `dynamic_coverage_unresolved_in_single_response`

Producer：`runtime/world-analysis.js:1011`。它为 `unresolvedDynamicTargets.length > 0`，且当前明确强调 `single_response`。这个后缀对防止误解为 continuation 有帮助。

但 `unresolved` 仍然不是当前 algorithm 的准确词。建议 v3 使用：

```text
dynamic_coverage_unaccounted_in_single_response
```

action：**RENAME**，但保留 v2 字段作为 deprecated compatibility alias。

## D. Result / Persistence Ownership Audit

### D.1 `final_result`

#### Execution-level

`runtime/world-analysis.js:619-649`, `695-729`, `1141-1158`, `1188-1202` 写入 Runtime diagnostic 的 `final_result`。它描述完整 World execution / transaction outcome：

- `UPDATED`：candidate 经过 persistence/readback confirmation；
- `NO_CHANGE`：canonical no-op 或没有 attempted/accepted mutation；
- `PERSISTENCE_FAILED`：snapshot mutated but not confirmed, or persistence/readback/reconciliation failure；
- `UPDATED_AFTER_RETRY_FAILURE`：此前 attempt terminal failure，但 preserved snapshot 已成功持久化。

UI collector 在 `ui/app.js:951-953` 优先取 `runtimeDiagnostic.final_result`，所以 `world_model_live_state.final_result` 是 execution-level。

#### Attempt/Fact Delta-level

`runtime/world-analysis.js:1013` 在 persistence 前调用：

```text
classifyWorldModelFinalResult({summary: factDeltaSummary})
```

此时没有 `persistenceConfirmed: true` 参数。即使 `accepted_operation_count > 0`，函数也会落到 `NO_CHANGE`（`runtime/world-analysis.js:156-175`）。之后 `WORLD_PERSISTENCE_CONFIRMED` trace 将同一 summary 展开并把 trace-local `persistence_occurred` 改成 `true`，但不会回写已 retained 的 `latest_fact_delta` summary。

所以 Smoke 组合：

```text
live execution final_result = UPDATED
latest_fact_delta.final_result = NO_CHANGE
```

是当前 producer 语义下的正常跨层结果，不是 runtime bug；但同名确实会造成错误调试结论。

建议：

- `execution.final_result`：KEEP 语义，v3 置于 execution namespace；
- `latest_attempt.fact_delta_result`：RENAME，不再叫 `final_result`；
- v2 compatibility reader 可按旧路径读取，但 export 新 schema 不应再同名。

### D.2 `persistence_occurred`

Fact Delta producer 在 `ai/analyzer.js:4994-5000` 与 `5115-5129` 固定写 `false`，表示 analyzer/Fact Delta stage 尚未执行 Floor persistence。`WORLD_ACCEPTED` 也在 `runtime/world-analysis.js:506-522` 使用 false；只有 `WORLD_PERSISTENCE_CONFIRMED` trace 在 `runtime/world-analysis.js:754-761` 写 true。

因此：

- Fact Delta summary 的 `persistence_occurred`：FACT_PIPELINE stage-local；不是 execution persistence result；
- confirmed trace 的同名字段：PERSISTENCE event-local；
- 同一字段名跨两个 producer/timepoint，属于 **MIXED_OWNERSHIP**。

建议 v3：从 `latest_attempt.fact_delta` 删除/移动此字段；persistence 区块只保留 execution-level `requested/started/confirmed/status`。若必须保留 attempt observation，应命名为 `persistence_observed_in_attempt`，但当前它永远 false，收益低于删除。

### D.3 `persistence_requested` / `persistence_confirmed`

两者由 `runtime/world-analysis.js:627-628`, `673-677`, `703-706`, `1152-1154` 写入 Runtime execution state：

- canonical noop：`requested=false`, `confirmed=false`，表示本次 execution 观察到不需要 persistence；
- changed candidate：`requested=true`；
- authoritative readback validated：`confirmed=true`；
- recovery path：`requested=true`, `confirmed=snapshot.persistenceConfirmed`。

这两个字段属于 execution/persistence owner，不应和 Fact Delta summary 并列在同一扁平命名空间。v3 建议放入：

```json
"persistence": {
  "requested": true,
  "started": true,
  "confirmed": true,
  "status": "CONFIRMED"
}
```

`null` 仅表示 live snapshot 尚未拿到该 execution diagnostic；`false` 是已观察的 negative/not-required，不是 unknown。

### D.4 `mutation_persisted` / `mutation_ui_projected`

`requestSnapshot` 在 `runtime/world-analysis.js:949-960` 初始化二者为 `null`。confirmed persistence 后只将 `mutation_persisted` 更新为 `true`，`mutation_ui_projected` 仍在 `runtime/world-analysis.js:781-783` 保持 `null`。全仓 producer 搜索未发现它被写为 `true` 或 `false`。

结论：

- `mutation_persisted`：有真实回填 producer，`null` 表示 transition 尚未得到后续 persistence observation，`true` 表示已确认；当前没有 observed false producer。
- `mutation_ui_projected`：**STALE_DIAGNOSTIC_FIELD**。它表达了一个理论 UI phase，但当前 transition object 永远不回填；不能当作 confirmed false 或 N/A。

建议 v3：删除 `mutation_ui_projected`，使用顶层 `ui_projection` 的真实 ingress/render fields；`mutation_persisted` 改为 `persistence_observation: "PENDING" | "CONFIRMED"` 或移入 transition 的 persistence subsection。

## E. Candidate / Fingerprint Audit

### E.1 Candidate fields

Candidate 不是 legacy。当前 spec 明确 candidate 是 transient validated persistence input，不是 Floor fact（`.trellis/spec/domain/world-model.md:57-82`）。

| Field | Actual meaning | Finding |
| --- | --- | --- |
| `candidate_execution_id` | Published candidate 的 execution-bound ID；与 candidate lifecycle 绑定 | KEEP |
| `current_execution_candidate_id` | UI live snapshot 依据 candidate ID 是否等于 active execution ID 派生的 convenience field | KEEP but move/label as UI diagnostic projection |
| `candidate_belongs_to_previous_execution` | 当前 retained candidate 与 active execution 不同的 boolean | KEEP; useful to avoid stale-candidate misread |
| `candidate_fingerprint` | candidate canonical model 的 short SHA-256 identity | KEEP |
| `candidate_full_hash` | same candidate 的 full SHA-256 | KEEP; explicit full-vs-short distinction |
| `candidate_state` | `VALIDATED → PERSISTING → PERSISTED`, or `CANONICAL_NOOP/SUPERSEDED` | KEEP |
| `candidate_created_at` | candidate creation time | KEEP |

不存在“candidate ID 重复但 ownership 不明”的 confirmed bug；真正需要的是 namespace grouping：`execution.candidate` 与 `execution.id` 不要并列无标签。

### E.2 Fingerprint algorithm

所有 World Model fingerprint 主要复用 `utils/world-model-debug.js:3-35`：stable object-key sort、array order preservation、SHA-256、short form `sha256:<12 hex>...`、full form `sha256:<full digest>`。Request payload fingerprints 使用同一 helper（`ai/analyzer.js:658-680`）。算法一致，字段不应合并为一个 hash，因为它们代表不同 layer/payload：

- `candidate_fingerprint` / `candidate_full_hash`：transient candidate identity；
- `committed_fingerprint`：UI adopted/committed canonical state；
- `persisted_fingerprint`：authoritative Floor readback；
- `reconciliation_fingerprint`：comparison result；
- `ui_state_fingerprint`：current UI canonical state；
- `ui_ingress_fingerprint_before/after`、`ui_rendered_model_fingerprint`：UI transition/render observation；
- `baseline_fingerprint`：attempt baseline；
- `permitted_evidence_fingerprint`、`existing_reference_fingerprint`、`coverage_target_set_fingerprint`、`analysis_payload_fingerprint`、`model_request_payload_fingerprint`、`control_directive_fingerprint`：request envelope components；
- `resolved_candidate_world_fingerprint/full_hash`：live collector 对 retained candidate model 的补充读取。

相同值的重复是有意的 comparison endpoint duplication，不是相同算法误用。v3 可 reshape 成 `{short, full}` objects，但这是 Tier 2 structural cleanup，不是必须 rename 的 correctness fix。

## F. Stale / Ambiguous Fields

### High-value ambiguity

1. Flat same-name `final_result` across execution and Fact Delta attempt。
2. Flat same-name `persistence_occurred` across analysis summary and confirmed persistence event。
3. `coverage_fixed_point_reached` overstates a no-derived-target predicate。
4. `unresolved_dynamic_*` overstates unresolved/resolution failure; actual state is unaccounted derived targets。
5. `coverage_rounds[].round` hides that records can represent semantic response accounting or accepted-patch error accounting。

### Stale field

`request_transitions[].mutation_ui_projected` is currently initialized but never backfilled. It should be treated as stale, not as a reliable `null` state.

### Not stale

- `latest_nonempty_fact_delta` is intentional: it preserves the latest parsed/non-empty diagnostic when the latest attempt is empty/no-op/failure.
- `candidate_belongs_to_previous_execution` is intentional stale-candidate detection, not stale schema.
- `persistence_confirmed=false` in canonical noop is observed “not required/not confirmed”, not an unmaintained field.

## G. Compatibility / Consumer Audit

### Version and consumers

- Producer constant: `ai/analyzer.js:26`, `WORLD_MODEL_DEBUG_SCHEMA_VERSION = 2`。
- History sanitizers/allow-lists: `runtime/diagnostics.js:16-43` and `runtime/events.js:188-238`。
- Live snapshot collector: `ui/app.js:918-997`。
- Debug renderer: `ui/settings.js:1076-1161`。
- Tests: `tests/world-model-debug.test.js:153-220`, `tests/event-analysis-runtime.test.js:7507-7552`, `tests/world-model.test.js:2663` and related prompt/Fact assertions。

### Branching / migration

- UI only branches for unknown version: `ui/settings.js:1150-1152` renders `DEBUG_SCHEMA_MISMATCH` when version is not 2。
- No parser or migration layer for Debug Schema v2 was found。
- Most export is raw JSON display/copy; `ui/app.js` reads selected paths and otherwise serializes the object。
- No repository-local external troubleshooting script consuming this schema was found。
- A breaking v3 would therefore require updating producer, sanitizer/allow-lists, collector, renderer, focused tests, and version check together. There is no existing automatic v2 migration.

Compatibility recommendation: if Phase 2 proceeds, use an explicit v3 namespace and either (a) a short-lived v2 compatibility reader for raw existing snapshots, or (b) reject old snapshots with a clear version notice. Do not silently reinterpret old `final_result` or `coverage_fixed_point_reached` under new semantics.

## H. Full Schema Inventory

为避免把同一字段的 leaf 列表重复 10 次，以下按 producer object 分组；每一行的 Field 列是该组的完整 leaf inventory，组内字段共享 Owner/Producer/Consumer/Cardinality 结论。

| Field | Owner | Producer | Consumer | Cardinality | Current meaning | Ambiguous? | Stale? | v3 action |
| --- | --- | --- | --- | --- | --- | ---: | ---: | --- |
| `world_model_debug_schema_version`, `analysis_stage_succeeded`, `first_failed_stage`, `failure_stage`, `failure_code`, `semantic_incomplete`, `semantic_failure_code`, `semantic_diagnostics`, `analysis_outcome`, `completeness_required`, `completeness_satisfied`, `supplement_completeness_complete`, `review_accounted` | FACT_PIPELINE | `ai/analyzer.js:5115-5163`; runtime failure wrappers | trace, live state, UI raw view, tests | scalar | Fact/semantic stage outcome and completeness accounting | `analysis_outcome` vs `final_result` partly | no | KEEP; namespace in v3 |
| `raw_fact_block_count`, `parsed_fact_count`, `parse_rejected_fact_count`, `resolution_rejected_fact_count`, `evidence_guard_rejected_fact_count`, `fact_count`, `rejected_fact_count`, `accepted_fact_count`, `accepted_operation_count`, `patch_operation_count`, `canonical_mutation_occurred`, `mutation_rejected_count` | FACT_PIPELINE | `ai/analyzer.js:5118-5129`, `5163` | LIVE STATE funnel, trace, tests | scalar counts/boolean | Fact funnel and accepted canonical mutation | `fact_count`/`parsed_fact_count` legacy aggregate overlap | no | KEEP |
| `coverage_dispositions`, `coverage_mutation_states`, `coverage_fact_mappings`, `fact_mappings`, `coverage_target_count`, `coverage_target_counts`, `covered_target_count`, `coverage_targets`, `coverage_targets_truncated`, `target_emitted`, `target_not_emitted`, `target_index`, `fact_index` | COVERAGE_ACCOUNTING + FACT_PIPELINE | `ai/analyzer.js:707-810`, `5155-5163`, `5179-5181` | trace, live state, UI raw view, tests | arrays/maps, bounded to 64/128 | response Fact-to-target review and mutation mapping | `target_emitted` is raw presence while dispositions are accepted review; distinguish in docs | no | KEEP; group under coverage |
| `dynamic_coverage_target_count`, `dynamic_coverage_target_ids`, `unresolved_dynamic_target_count`, `unresolved_dynamic_target_ids`, `coverage_rounds`, `coverage_fixed_point_reached`, `dynamic_coverage_unresolved_in_single_response` | COVERAGE_ACCOUNTING | `runtime/world-analysis.js:973-1011` | trace, live state, tests | counts + bounded IDs + repeated array + booleans | Host-local derived target accounting | yes: unresolved/fixed-point/round terminology | no, but naming/shape stale relative to architecture | PARTIAL: KEEP/RENAME/RESHAPE as above |
| `initial_type_count`, `initial_identity_search_performed`, `sibling_search_seeded`, `sibling_search_complete`, `discovered_sibling_type_count`, `discovered_sibling_type_names`, `accepted_sibling_type_count`, `accepted_sibling_type_names`, `rejected_sibling_type_count`, `rejected_sibling_type_names`, `reported_distinct_type_count`, `host_observed_distinct_type_count`, `accepted_canonical_type_count`, `new_type_identity_fact_count`, `accepted_new_type_identity_count`, `identity_diversity`, `type_identity_decisions` | IDENTITY_REVIEW | `ai/world-supplement-protocol.js:223-318`; `ai/analyzer.js:5022-5041` | trace, LIVE STATE raw summary, UI identity block, tests | arrays + scalar aggregate | identity discovery/review/diversity, not canonical identity history | `accepted_canonical_type_count` can be mistaken for persisted canonical state | no | KEEP; namespace under identity_review |
| `special_rule_appended_count`, `special_rule_deduped_count`, `exception_appended_count`, `exception_deduped_count`, `unknown_existing_count`, `unknown_appended_count`, `unknown_deduped_count`, `unknown_resolved_count`, `unknown_resolution_rejected_count`, `unknown_resolution`, `unknown_removed_count`, `collection_lifecycle` | COLLECTION_LIFECYCLE | `ai/analyzer.js:5099-5111`, `5164-5166` | trace, live state raw summary, tests | arrays + scalar counts | append/dedupe/resolution accounting | `unknown_resolved_count` vs `unknown_removed_count` overlap in wording | no | KEEP; namespace under collection_lifecycle |
| `request_envelope.request_mode`, `request_total_char_count`, `permitted_evidence_char_count`, `existing_reference_char_count`, `coverage_target_char_count`, `retry_directive_char_count`, `host_diagnostics_included`, `permitted_evidence_fingerprint`, `existing_reference_fingerprint`, `coverage_target_set_fingerprint`, `analysis_payload_fingerprint`, `model_request_payload_fingerprint`, `control_directive_fingerprint` | REQUEST | `ai/analyzer.js:4871-4885` | Fact summary, trace allow-list, tests, debug export | object of scalar fields | exact request/reference/evidence boundary metadata and payload identity | `analysis_payload` vs `model_request_payload` needs label, not algorithm change | no | KEEP; group under request |
| `baseline_source`, `baseline_execution_id`, `baseline_fingerprint`, `request_transition` | REQUEST + EXECUTION_SNAPSHOT | `runtime/world-analysis.js:949-1002` | latest Fact Delta, trace, transition history | scalar + object | baseline provenance and adjacent independent request comparison | mixed owner | no | MOVE/RESHAPE into attempt.request and transition record |
| `previous_execution_id`, `current_execution_id`, `permitted_evidence`, `existing_reference`, `coverage_targets`, `added_existing_addresses`, `removed_existing_addresses`, `added_target_ids`, `removed_target_ids`, `baseline_source`, `baseline_fingerprint`, `mutation_source_execution_id`, `mutation_source_candidate_fingerprint`, `mutation_persisted`, `mutation_ui_projected` | REQUEST + RECONCILIATION/UI_PROJECTION | `runtime/world-analysis.js:213-237` | `request_transitions[]`, UI displays latest transition | array of transition objects | independent-request history and mutation provenance | yes: mutation fields mix later phases into request transition | `mutation_ui_projected` stale | RESHAPE; remove stale leaf, keep transition history |
| `execution_id`, `mode`, `floor_version`, `summary`, `candidate_model`, `updated_at` | HISTORY_TRACE / EXECUTION_SNAPSHOT | `runtime/world-analysis.js:177-190` | `recent_fact_delta_executions`, latest nonempty, live exporter | bounded array max 8 | retained recent attempt entries | full `candidate_model` makes diagnostic record large | no | RESHAPE to references + bounded summary in v3 |
| `candidate_execution_id`, `candidate_fingerprint`, `candidate_full_hash`, `candidate_state`, `candidate_created_at`, `execution_id`, `mode`, `trigger`, `floor_version`, `candidate_model`, `runtime_model`, `fact_delta_summary`, `latest_world_fact_delta_execution_id`, `updated_at` | EXECUTION_SNAPSHOT + PERSISTENCE | `runtime/world-analysis.js:619-729`, `1141-1158`, `1210-1229` | runtime getter, UI collector, renderer, tests | latest object; conditional fields | current execution/candidate/readback diagnostic | `execution_id` has diagnostic-vs-candidate contexts | no | RESHAPE into execution/candidate/persistence namespaces |
| `execution_snapshot_present`, `execution_snapshot_mutated`, `execution_snapshot_accepted_operation_count`, `execution_snapshot_successful_round_count`, `execution_snapshot_last_successful_round`, `execution_snapshot_persistence_eligible`, `snapshot_preserved`, `last_attempt_failed`, `last_attempt_failure_code` | EXECUTION_SNAPSHOT | `runtime/world-analysis.js:513-520`, `633-638`, `710-716`, `1141-1158` | trace, live state, recovery diagnostics | scalar | snapshot/recovery state | `successful_round_count` references rounds whose element semantics are mixed | no | RENAME/RESHAPE with coverage record references |
| `persistence_requested`, `persistence_started`, `persistence_confirmed`, `persisted_fingerprint`, `committed_fingerprint`, `reconciliation_status`, `reconciliation_fingerprint`, `authoritative_reload_generation`, `reload_skipped_reason`, `reload_suppressed_by_newer_committed_revision` | PERSISTENCE + RECONCILIATION + UI_PROJECTION | runtime and UI ingress | live state, trace, UI | scalar | persistence lifecycle and authoritative readback/UI reload observations | flat namespace mixes persistence and UI reload | no | RESHAPE under persistence/reconciliation/ui_projection |
| `mutation_source_execution_id`, `mutation_source_candidate_fingerprint`, `mutation_persisted`, `mutation_ui_projected` | REQUEST + PERSISTENCE + UI_PROJECTION | runtime transition builder/update | transition history, trace | scalar nullable | mutation provenance and later phase observations | yes; `mutation_ui_projected` stale | `mutation_ui_projected` yes | MOVE/DELETE as above |
| `snapshot_id`, `snapshot_started_at`, `snapshot_completed_at`, `snapshot_generated_at`, `chat_id`, `message_id`, `floor`, `swipe_id`, `content_hash`, `message_version`, `snapshot_consistent`, `snapshot_invalidation_reason`, `target_before`, `target_after`, `target_read_error_code` | HISTORY_TRACE + UI_PROJECTION | `ui/app.js:918-931`, `986` | Settings debug/export, tests | one live snapshot | sampling identity, freshness and target consistency | no | no | KEEP; group under live_snapshot |
| `active_world_execution_id`, `current_execution_candidate_id`, `candidate_belongs_to_previous_execution`, `candidate_fingerprint`, `candidate_state`, `candidate_created_at` | EXECUTION_SNAPSHOT + UI_PROJECTION | `ui/app.js:933-945` | Settings renderer | one live snapshot | current-vs-retained candidate identity | some duplication intentional | no | KEEP; namespace |
| `ui_projection_state`, `committed_fingerprint`, `ui_state_fingerprint`, `rendered_field_count`, `unrendered_canonical_field_count`, `ui_ingress_source`, `ui_ingress_revision`, `ui_ingress_fingerprint_before`, `ui_ingress_fingerprint_after`, `ui_ingress_render_requested`, `ui_ingress_render_completed`, `ui_rendered_revision`, `ui_rendered_model_fingerprint`, `stale_reload_suppression_count` | UI_PROJECTION | `ui/app.js:946-970` | Settings renderer/export, tests | scalar | UI ingress, adoption and render state | `ui_projection_state` vs ingress/render statuses are different phases but flat | no | RESHAPE under ui_projection |
| `canonical_mutation_occurred`, `accepted_operation_count`, `final_result`, `persistence_requested`, `persistence_confirmed`, `persisted_fingerprint`, `reconciliation_status`, `reconciliation_fingerprint` | MIXED_OWNERSHIP | `ui/app.js:951-961` | Settings renderer | one live snapshot | convenience projection of latest execution + latest attempt | **yes** because same flat object crosses owner boundaries | no | MOVE into execution/attempt/persistence |
| `latest_fact_delta`, `latest_nonempty_fact_delta`, `recent_fact_delta_executions`, `request_transitions` | HISTORY_TRACE + FACT_PIPELINE + REQUEST | `runtime/world-analysis.js:639-642`, `724-727`, `1214-1218`; collector `972-985` | Settings debug/raw export/tests | latest scalar/object + bounded arrays | latest current summary, last non-empty summary, recent history, transition history | duplication/size ambiguity | no | RESHAPE to references plus bounded summaries |
| `history_trace_metadata.trace_buffer_capacity`, `trace_event_count`, `trace_truncated`, `oldest_trace_timestamp`, `newest_trace_timestamp`, `layers`, `world_consistency`, `mismatch_layers`, `address_diff` | HISTORY_TRACE + UI_PROJECTION | `ui/app.js:987-997`; `utils/world-model-debug.js:71-149` | Settings renderer/export, tests | one object; layer maps | trace provenance and four-layer comparison | `trace_buffer_capacity/truncated` are null placeholders, not observed values | **yes/unknown** for capacity/truncated | KEEP observed fields; DELETE or explicitly mark unavailable placeholders |
| `layers.runtime/floor/ui/last_render.{source,model_present,fingerprint,full_hash,fingerprint_status,unavailable_reason,species_count,biological_type_count,addresses,view_model_fingerprint,view_model_full_hash,rendered_at}` | UI_PROJECTION + RECONCILIATION | `utils/world-model-debug.js:71-107` | live collector, renderer, tests | four fixed layer objects | deterministic fingerprints/counts/address inventories | no | no | KEEP; namespace |
| `stage`, `seq`, `timestamp/created_at`, `domain`, `path`, `reason`, `attempt`, `retry_index`, `failure_stage`, `failure_code`, `error_name`, `error_message`, `diagnostic_code`, plus sanitized fields from `runtime/diagnostics.js:16-43` and `runtime/events.js:188-238` | HISTORY_TRACE | diagnostics observer/sanitizer | copied trace, debug export, tests | sequence max 64 | historical event buffer, not current state | raw stage payload has broad union shape and mixed owner | no | RESHAPE only if v3 introduces typed event envelopes; otherwise KEEP |

## I. v3 Change Candidates by Tier

### Tier 1 — High-value clarity/correctness

- Separate `execution.final_result` from `latest_attempt.fact_delta_result`.
- Remove/move Fact Delta `persistence_occurred`; keep persistence truth under execution persistence lifecycle.
- Rename fixed-point/unresolved terminology to derived-target accounting terminology.
- Rename/reshape `coverage_rounds` so its entries are accounting records, not semantic rounds.
- Delete or replace never-updated `mutation_ui_projected`.

### Tier 2 — Structural cleanup

- Namespace `execution`, `latest_attempt`, `coverage_accounting`, `persistence`, `reconciliation`, `ui_projection`, and `history_trace`.
- Replace duplicated `latest_nonempty_fact_delta` full entry/candidate model with an ID/reference plus bounded summary, unless raw candidate retention is explicitly required for debugging.
- Keep `request_transitions[]` history but make `latest_attempt.request_transition` a reference or clearly labeled snapshot.
- Represent short/full fingerprints as `{short, full}` where both exist; keep component fingerprints separate.
- Remove null placeholder `trace_buffer_capacity` and `trace_truncated`, or add explicit `availability: "UNKNOWN"`.

### Tier 3 — Cosmetic only / default do not change

- Reordering fields in the raw JSON.
- Renaming `candidate_*` merely because the word Candidate is historical.
- Changing uppercase/lowercase style without namespace/meaning improvement.
- Renaming `dynamic_coverage_target_ids` when `dynamic` and `target` remain technically accurate.

## J. Proposed Debug Schema v3

仅提出 diagnostics fragment，不复制完整 World Model：

```json
{
  "world_model_debug_schema_version": 3,
  "live_snapshot": {
    "snapshot_id": "...",
    "target": {"chat_id": "...", "message_id": "...", "floor": 6, "swipe_id": 0},
    "consistent": true,
    "started_at": "...",
    "completed_at": "..."
  },
  "execution": {
    "execution_id": "...",
    "final_result": "UPDATED",
    "mode": "patch",
    "trigger": "manual-patch",
    "candidate": {
      "execution_id": "...",
      "short_fingerprint": "sha256:...",
      "full_hash": "sha256:...",
      "state": "PERSISTED",
      "belongs_to_current_execution": true
    },
    "snapshot": {
      "present": true,
      "mutated": true,
      "accepted_operation_count": 2,
      "persistence_eligible": true,
      "last_attempt_failed": false
    }
  },
  "latest_attempt": {
    "execution_id": "...-attempt-1",
    "fact_delta_result": "NO_CHANGE",
    "fact_pipeline": {
      "raw_fact_block_count": 6,
      "parsed_fact_count": 6,
      "parse_rejected_fact_count": 0,
      "resolution_rejected_fact_count": 0,
      "evidence_guard_rejected_fact_count": 0,
      "accepted_fact_count": 6,
      "accepted_operation_count": 2,
      "canonical_mutation_occurred": true
    },
    "request": {"request_mode": "INITIAL", "model_request_payload_fingerprint": "sha256:..."}
  },
  "coverage_accounting": {
    "initial_target_count": 23,
    "current_target_count": 25,
    "derived_dynamic_target_count": 2,
    "derived_dynamic_target_ids": ["..."],
    "unaccounted_dynamic_target_count": 2,
    "unaccounted_dynamic_target_ids": ["..."],
    "derived_target_accounting_complete": false,
    "records": [
      {
        "record_index": 1,
        "source": "SEMANTIC_RESPONSE_ATTEMPT",
        "input_target_count": 23,
        "reviewed_target_count": 23,
        "accepted_fact_count": 6,
        "accepted_operation_count": 2,
        "derived_dynamic_target_count": 2,
        "unaccounted_dynamic_target_count": 2
      }
    ]
  },
  "persistence": {
    "requested": true,
    "started": true,
    "confirmed": true,
    "status": "CONFIRMED",
    "persisted_short_fingerprint": "sha256:...",
    "reconciliation_status": "CONFIRMED",
    "reconciliation_short_fingerprint": "sha256:..."
  },
  "ui_projection": {
    "ingress_source": "authoritative-persistence-readback",
    "render_requested": true,
    "render_completed": true,
    "state_short_fingerprint": "sha256:...",
    "rendered_model_short_fingerprint": "sha256:..."
  },
  "history_trace": {
    "source": "event_buffer",
    "events": [],
    "latest_nonempty_attempt_id": "...-attempt-1"
  }
}
```

此 fragment 的核心不是增加字段，而是让阶段、owner、时间点和 cardinality 从 namespace 可读；旧 v2 aliases 只用于兼容迁移，不应继续作为 v3 canonical names。

## K. Migration Risk

- **中高风险**：`runtime/diagnostics.js` 与 `runtime/events.js` 有两个独立 allow-list；任何 v3 field rename/reshape 都必须同步，否则 history trace 会静默丢字段。
- **中风险**：`ui/app.js` 当前对多个 flat paths 有直接读取，`ui/settings.js` 直接渲染旧路径；必须同步 collector、renderer、copy/export 和 tests。
- **中风险**：现有 tests 直接断言 `latest_fact_delta.final_result`、coverage flags 与 `world_model_debug_schema_version`。
- **低风险**：没有发现持久化 Floor schema、外部 repo script 或 migration parser 依赖 Debug Schema v2；Debug state 是 transient/raw export。
- **real-host**：本轮没有重新执行 SillyTavern Smoke；用户提供的 Smoke baseline 作为真实 acceptance evidence。v3 若实施，必须在安装刷新后重跑 real-host Debug export，确认 authoritative readback、UI ingress/render 与 history trace 仍可追踪。

## L. Proposed Phase 2

只给实施范围，不在本阶段执行：

1. 定义 v3 canonical namespaces 与 compatibility policy；明确 v2 aliases 的读取期限和 `DEBUG_SCHEMA_MISMATCH` 行为。
2. 将 Fact Delta 的 `final_result` 改成 attempt-scoped `fact_delta_result`，将 execution `final_result` 放入 execution namespace。
3. 将 persistence truth 收拢到 `persistence.requested/started/confirmed/status`，从 Fact Delta summary 移除或显式改名 stage-local persistence field。
4. 将 coverage diagnostics 改成 `derived_dynamic_*` / `unaccounted_dynamic_*`，保留动态 target accounting algorithm 不变。
5. 将 `coverage_rounds[]` 迁移为 `coverage_accounting.records[]`，增加 record source，移除误导性的 semantic `round` 命名。
6. 删除 `mutation_ui_projected`，或由 UI ingress 的真实 producer 明确维护后再决定是否保留；不得保留永远 null 的字段。
7. 将 candidate、snapshot、request、persistence、reconciliation、UI projection、history trace 分组；不改变 candidate/persistence/runtime architecture。
8. 更新两个 trace sanitizer、collector、settings renderer、focused tests 和 debug version check；补充 v2→v3 raw export compatibility tests。
9. 运行 focused tests、全量 `npm run check`、static gates、`git diff --check`，并重新执行真实 SillyTavern Smoke。

## Audit verification record

- `node --check`：`ai/analyzer.js`、`runtime/world-analysis.js`、`runtime/diagnostics.js`、`runtime/events.js`、`ui/app.js`、`ui/settings.js`、`utils/world-model-debug.js` 全部通过。
- Focused command：`node --test tests/world-model-debug.test.js tests/event-analysis-runtime.test.js tests/world-model.test.js`。
- Focused result：461 tests，429 pass，32 fail。失败集中在当前 prompt 断言、settings debug preview boundary 断言和 fixture-specific species static gate；World runtime、coverage diagnostics、live-state 与 debug rendering 的相关通过项已包含在 429 pass 中。未将这些 baseline failures 归因于本 task。
- `git diff --check`：通过。
- Worktree：除本 task 的 `.trellis/tasks/09-29-world-model-debug-schema-v3-audit/` planning/report artifacts 外，没有 production code、tests、Spec、UI 或 version constant 修改。
