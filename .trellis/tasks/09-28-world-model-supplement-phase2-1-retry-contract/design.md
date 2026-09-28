# Phase 2.1 Retry / Continuation Contract Repair 设计

## Smoke root cause to confirm

真实 smoke 表明 Supplement API response 已返回，但 Host completeness / Guard rejection 使最终 candidate 没有形成；随后自动 retry 使用错误或膨胀的输入 envelope，最终 response-error，因而没有 Candidate Created、UI Adoption 或 persistence。先从实际 prompt builder、retry diagnostics、analyzer completeness 与 `runWorldAnalysisJob()` 追踪确认，不假定 UI 是根因。

## Three request state machine

```text
INITIAL
  -> parse/review/resolve/Guard
  -> accepted mutation + transient candidate
  -> if protocol contract invalid: COMPLETENESS_RETRY
  -> if new canonical targets: COVERAGE_CONTINUATION
  -> fixed point -> final candidate
```

All three requests share the same bounded base envelope:

```text
permitted evidence
+ current transient Existing
+ current Coverage Targets
+ Identity Discovery subjects
+ Fact Delta output contract
```

Only a minimal deterministic directive may vary. Host diagnostics remain in Host memory and bounded diagnostics, never in prompt content.

## Review / mutation contract

The Host keeps review accounting separate from operation acceptance:

| Review | Mutation | Meaning |
| --- | --- | --- |
| `NO_EVIDENCE` | `NOT_APPLICABLE` | target reviewed, no canonical mutation |
| `EMITTED` | `ACCEPTED` | target reviewed, Fact passed resolver and Guard |
| `EMITTED` | `REJECTED` | target reviewed, Fact existed/addressed but Host rejected mutation |

`EMITTED + REJECTED` is never rewritten to `NO_EVIDENCE`. Recovery depends on rejection class: malformed/recoverable response contract may retry; evidence rejection is bounded and remains explicit; transport errors use transport retry semantics.

## Candidate and persistence boundary

Transient models remain internal to one World execution. Completeness retry and coverage continuation do not publish final candidate or invoke persistence. Only a review-complete, fixed-point candidate reaches the existing adoption → exact ACK → save → Floor coordinator path.

## Non-goals

No Full changes, UI renderer changes, Guard threshold/provenance changes, evidence-boundary expansion, canonical schema change, Candidate Adoption redesign, or Floor coordinator/persistence change.
