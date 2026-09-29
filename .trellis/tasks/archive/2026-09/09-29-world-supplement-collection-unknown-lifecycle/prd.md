# World Supplement Collection Mutation 与 Unknown 生命周期

## Goal

让 Supplement JSON Fact Delta 在不改变上一轮 scalar replacement 与 Full Analysis 合约的前提下，正确执行 `Special_Rule`、`Exception`、`Unknown` 三类 collection mutation，并将 `Unknown` 作为可追踪的 unresolved knowledge queue 处理；同时从 Supplement production path 清理 Candidate-era 的 field-specific semantic reclassification。

## Confirmed current behavior

- 当前生产入口为 `buildWorldModelPatchMessagesV2()`；消息拓扑保持 `system_top → system task/contract → system evidence → assistant story → user JSON control/reference → system_bottom`。
- JSON root 当前只接受 `facts`、`coverage`、`identity_reviews`；没有 `resolved_unknown_ids` 或 resolution binding。
- `Special_Rule` 映射为 `ADD_SPECIAL_RULE`，目标为 `species.<species>.biological_types.<type>.special_rules`；已有项通过 `v2TextIdentity()` 去重，新项追加，但 `v2SortAppendedEntries()` 会对新项排序，不能保证响应顺序追加。
- `Exception` 映射为 `ADD_EXCEPTION`，目标为 `world.exceptions`；当前 identity 为 normalized `statement + applies_to`，payload equality 还会比较 `evidence`，冲突会拒绝。
- `Unknown` 映射为 `ADD_UNKNOWN`，目标为 `world.unknowns`；当前只有文本 normalized equality 去重和追加，没有稳定 host-owned ID、resolution claim、accepted Fact binding 或保留/删除生命周期。
- 当前 Supplement 经过 `parseWorldModelFactDeltaJson → resolveWorldModelFactDelta → applyWorldModelFactDeltaEvidenceGuard → applyWorldModelPatchV2EvidenceGuard → mergeWorldModelPatchV2Classified → runtime transient model → saveWorldModel → commitFloorPatch(owner="world") → authoritative readback`。
- `applyWorldModelFactDeltaEvidenceGuard()` 仍以 `structured_fact_delta: true` 调用共享 v2 guard；共享路径最终进入 `patchFactEvidence()`、`v2EvidenceSupportsFact()` 与 Exception 的 field-specific evidence helpers。Supplement 必须保留地址、scope、permitted evidence membership、payload 与 canonical safety，但不得再由 Host 对 JSON Fact 的字段语义做 NLP/regex reclassification。
- Full `analyzeWorldModel()` 仍使用独立的 complete-model evidence guard；本任务不改变 Full 的正式语义或 scalar contract，也不修改 `storage/floor-persistence-coordinator.js`。
- 当前 `runtime/world-analysis.js` 已把接受的补丁先合入 transient model，之后由 `saveWorldModel()` 一次提交 `world_model/world_model_meta` 并 readback；本任务必须让 collection/Unknown mutation 继续遵守这一 Snapshot → one commit 边界，不恢复第二次 semantic API call。
- 当前 checkout 的 git status 实际为 clean（只有本任务目录是新增未跟踪文件）；这与用户所述上一轮未提交状态不一致，本任务不得自行恢复、回滚、reset 或 clean。

## Requirements

1. Scalar fields listed by the request remain `SET_FIELD` replacement semantics。
2. `Special_Rule` is append + canonical normalized dedupe; existing order is preserved and new unique entries append in response order。
3. `Exception` is append + deterministic host-owned object identity/equivalence; existing order is preserved, equivalent canonical exceptions do not duplicate, and different exceptions append。
4. `Unknown` is append + deterministic identity/dedupe + lifecycle resolution. Existing unresolved entries are sent in the same Supplement request as explicit unresolved context; no-evidence retains them; new unresolved entries append; duplicate unresolved entries do not duplicate。
5. Unknown removal requires both an explicit model resolution declaration and at least one accepted resolving Fact with deterministic address/identity binding. Rejected, unresolved, or no-op-without-resolution Facts never remove the Unknown。
6. Partial resolution is per Unknown: accepted bindings remove only their Unknowns; rejected/unresolved ones remain。
7. Resolution and canonical Fact mutation occur in the same execution snapshot and are persisted by the existing `saveWorldModel() → commitFloorPatch(owner="world")` path exactly once for a successful changed Supplement。
8. The JSON parser/validator, production prompt, final messages, diagnostics, debug preview/trace, tests, and `world-model.md` must describe the same contract。
9. Supplement production must not execute field-specific semantic regex classification for structured JSON Facts, including collection fields; Full-only semantic machinery may remain when proven required and isolated。
10. Remove or migrate obsolete Supplement-only Candidate/textual/continuation/semantic-reclassification contract and tests without breaking Full mode or the existing format/network recovery exception。

## Acceptance Criteria

- [x] Audit report documents the real mutation matrix, call graph, helper ownership, current diagnostics, Full/Supplement call sites, and remaining legacy debt。
- [x] Special_Rule append, dedupe, order preservation, and scalar replacement tests pass, including the previous 14 nested scalar regressions。
- [x] Exception append, equivalent-object dedupe, different-object append, and stable object contract tests pass。
- [x] Supplement collection re-sort is removed: existing Special_Rule/Exception order is unchanged and accepted unique items append to the tail in response order (`[A, B] + C → [A, B, C]`)。
- [x] Unknown retention, accepted resolution, false-resolution protection, new append, dedupe, partial resolution, deterministic identity, and resolution binding tests pass。
- [x] Production-style integration test proves Special_Rule/Exception/Unknown and resolving Fact reach one final Floor state with Floor commit count `1`。
- [x] Final `buildWorldModelPatchMessagesV2()` messages visibly contain Existing Unknowns, resolution instructions, JSON resolution contract, and unchanged role topology with no semantic continuation/completeness retry model call。
- [x] Full mode remains green; Supplement structured Fact path has no legacy field-specific semantic reclassification。
- [x] Supplement no longer enters Candidate-era field-specific semantic NLP reclassification; any shared helper retained for Full is split or call-site isolated and documented。
- [x] Required targeted tests, `npm test`, `git diff --check`, and `node --check` for all changed JS are run; unexpected new failures are zero relative to the known baseline of 35 stale failures。
- [x] Real SillyTavern smoke is explicitly reported as not executed; fixtures are not presented as real-host validation。

## Scope boundaries

- Do not commit, push, reset, clean, or revert previous work。
- Do not modify `storage/floor-persistence-coordinator.js` unless an independently proven blocker is discovered and reported before any such change。
- Do not introduce a graph framework, a second semantic API call, fuzzy NLP similarity, LLM-generated persistence IDs, or a second persistence root。
- Do not change Full mode semantics merely to implement Supplement collection lifecycle。
