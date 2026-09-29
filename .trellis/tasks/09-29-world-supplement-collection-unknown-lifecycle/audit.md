# Supplement collection / Unknown lifecycle audit

## Mutation matrix

| Input Fact | Internal operation | Supplement order/lifecycle |
| --- | --- | --- |
| Scalar field | `SET_FIELD` | replacement at the addressed canonical path |
| `Special_Rule` | `ADD_SPECIAL_RULE` | canonical text dedupe; existing order, then response order |
| `Exception` | `ADD_EXCEPTION` | host-owned canonical statement/scope identity; provenance differences are no-op |
| `Unknown` | `ADD_UNKNOWN` | deterministic text identity; unresolved entries remain queued |
| `resolved_unknown_ids` | snapshot-only queue removal | requires an accepted non-Unknown Fact at an exact declared address |

## Call graph and ownership

`buildWorldModelPatchMessagesV2()` builds one request containing the canonical
Existing model, `existing_unknowns`, coverage checklist and identity review
seeds. `createAnalyzer().analyzeWorldModelPatchV2()` parses one JSON response,
resolves Fact dependencies, applies the Supplement structural/evidence-boundary
guard, and returns both the internal Patch v2 and the transient `snapshot_model`.
`runtime/world-analysis.js` merges that snapshot into the execution-scoped
model and the existing `saveWorldModel()` →
`commitFloorPatch(owner="world")` path performs the single authoritative
transaction. `storage/floor-persistence-coordinator.js` remains unchanged.

## Guard split and diagnostics

Full analysis continues to use `applyWorldModelPatchV2EvidenceGuard()` and its
field-specific semantic evidence rules. Supplement structured Facts use the
local structured boundary guard: JSON operation shape, existing identity
address, scope/dependency, and permitted-evidence membership. Resolution traces
report `UNKNOWN_RESOLUTION_ACCEPTED`, `UNKNOWN_RESOLUTION_FACT_NOT_ACCEPTED`,
and `UNKNOWN_RESOLUTION_ID_NOT_FOUND` so retention is distinguishable from a
successful removal.

## Remaining legacy debt

The hierarchical Candidate parser and Full-side compatibility helpers remain
for existing Full/compatibility contracts. The Supplement runtime no longer
requests semantic completeness continuation; `format_retry` remains the only
response-repair request. The pre-existing World Model prompt/UI fixture drift
remains in the checkout's test suite; it is not real-host validation. Full-side
field-specific helpers remain intentionally isolated and are not called by
Supplement JSON Fact Delta.
