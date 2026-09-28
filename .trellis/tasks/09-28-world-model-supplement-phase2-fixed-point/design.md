# Phase 2 Dynamic Coverage Fixed Point 设计

## Confirmed current gap

当前 `runtime/world-analysis.js` 的 Supplement path 由 `runWorldAnalysisJob()` 调用既有 `runAnalysisStageWithRetry()`。每次 stage attempt 都通过 `resolveWorldModelAtOrBefore()` 读取同一个 authoritative baseline，调用一次 `analyzeWorldModelPatchV2()`，将 patch merge 为 candidate，然后只比较 baseline 与 candidate 的 target JSON 数量集合；summary 固定写入 `coverage_expansion_round_count: 0`，并以 `newUnreviewedTargetCount === 0` 设置 fixed point。

因此 accepted new Type 可以让 candidate 产生 dynamic targets，但这些 targets 不会启动新的 Supplement request；stage 仍进入 `complete()`，candidate 继续进入 adoption/persistence。既有 retry 只由异常触发，不能承载语义上的 coverage continuation。

## Target state machine

```text
authoritative Existing baseline
  -> initial canonical coverage targets
  -> Supplement response + review accounting
  -> parse / resolve / Evidence Guard
  -> accepted facts merged into transient candidate
  -> canonical target recomputation by address
  -> unresolved dynamic target queue
       -> bounded continuation with latest transient Existing
       -> repeat until queue empty and review complete
  -> fixed-point final candidate
  -> existing candidate adoption / exact ACK / persistence
```

Review completeness is the response-level accounting result for the supplied coverage and identity review subjects. Dynamic coverage pending is the newly relevant canonical address set created by the accepted transient mutation and not yet dispositioned in a valid response. Fixed point requires response review complete, accepted mutations merged, target recomputation complete, and no unresolved dynamic target or newly created target remaining. Final `complete` is true only at fixed point.

## Continuation ownership

Continuation stays inside `runWorldAnalysisJob()`'s one World execution and uses the existing request/stage execution identity, cancellation, Floor-version guards, retry configuration, diagnostics, candidate adoption and persistence completion callback. It does not call persistence between rounds. The continuation budget is the existing bounded World stage retry budget; a separate unbounded loop or second persistence owner is forbidden.

The transient candidate is carried locally across semantic rounds. A continuation request receives that latest candidate as `world_model` / comparison reference and the original `analysisInput` evidence unchanged. Existing remains a target/reference, never evidence. `supplement_completeness_retry` carries only review accounting gaps for the current round; dynamic target IDs are supplied as the current review queue, not as an output whitelist.

## Canonical target identity

Coverage targets use the canonical address tuple:

```text
scope + species + biological_type + field
```

Target IDs are derived from this address, not the current array index. The implementation must preserve the existing target field shape and prompt grammar; only the deterministic identity calculation and round accounting may change as required. Target set comparison uses address keys, so reorderings do not create false expansion or lose dispositions.

## Disposition rules

- `NO_EVIDENCE` removes a reviewed target from the current unresolved queue only; it never mutates the model or becomes evidence.
- `EMITTED` requires exactly one syntactically valid Fact at the target address. That Fact independently passes resolver and Evidence Guard; a rejected Fact remains an explicit rejected-emission diagnostic and is not treated as `NO_EVIDENCE`.
- Accepted operations merge into the transient candidate, after which targets are recomputed. A newly accepted identity may create another dynamic queue even if an earlier round already expanded.
- No accepted mutation and no unresolved target may reach fixed point without an artificial extra request.

## Persistence boundary

Intermediate transient candidates are never sent through `publishWorldModelCandidate()` or `saveWorldModel()`. Only the final fixed-point candidate reaches the existing adoption → exact ACK → saveWorldModel → Floor coordinator → readback path. Budget exhaustion throws/returns the existing World failure shape extended with fixed-point diagnostics and prevents persistence.

## Out of scope

Full / 重新分析、Phase 1 Evidence Guard/provenance/scope matcher、UI projection、Candidate Adoption protocol、Floor coordinator/persistence transaction identity、canonical schema、minimum Type cardinality and any broader evidence boundary change.
