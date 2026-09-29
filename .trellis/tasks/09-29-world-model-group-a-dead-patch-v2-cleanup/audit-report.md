# Phase 5 Audit Report

## Gate result

`DELETE GATE: PASS — already satisfied before this task.`

The current tree contains no definition or caller for `mergeWorldModelPatchV2`
or `applyWorldModelPatchV2EvidenceGuard`. They were removed by commit
`c89b78b` together with their legacy tests and current specification references.
This task therefore made no production-code deletion.

| Gate | Result | Evidence |
|---|---|---|
| Full production callers | 0 | repo-wide current-source search |
| Supplement production callers | 0 | runtime imports `mergeWorldModelSupplementPatch`; analyzer uses Fact Delta guard |
| runtime/UI callers | 0 | current `ai/runtime/ui/tests` search |
| stable public API evidence | none in repo | private package; root `index.js` does not export analyzer functions; no package exports/plugin API |
| semantic obsolescence | proven | historical implementation accepted raw Patch V2 and ran `v2ValidateOperationEvidence` |
| replacement path | proven | JSON Fact Delta parser/resolver/current structured guard/classification/classified merge |
| test-only ownership | historical only | old direct-import tests were deleted in `c89b78b` |

## Historical semantic audit

Before `c89b78b`, `mergeWorldModelPatchV2(existing, patch, analysisInput)` did:

```text
raw Patch V2
-> normalize Existing
-> applyWorldModelPatchV2EvidenceGuard
-> mergeWorldModelPatchV2Classified
```

`applyWorldModelPatchV2EvidenceGuard` classified raw operations and invoked the
old `v2ValidateOperationEvidence` family. That family inspected evidence text,
scope, field/value support, individual-only filtering, Species/Type support,
mechanism/projection support, and annotated operation rejection. It was the
legacy semantic guard island, not the current structured Fact Delta boundary.

Current Supplement instead uses:

```text
parseWorldModelFactDeltaJson
-> validateWorldModelFactDelta
-> resolveWorldModelFactDelta
-> applyWorldModelFactDeltaEvidenceGuard
-> classifyWorldModelPatchV2
-> mergeWorldModelPatchV2Classified
```

Full analysis continues to use `applyWorldModelEvidenceGuard` independently.

## Public surface audit

`package.json` is private and has no `exports` map. Root `index.js` exports only
the host lifecycle API. No current barrel, dynamic property lookup, global
exposure, UI import, plugin API, or example references the removed symbols.
Two references remain only in archived historical task documents and are not
current architecture or compatibility promises.

## Prompt proof

`buildWorldModelPatchMessagesV2()` currently returns two messages with roles:
`system`, `user`. The generated messages contain the JSON Fact Delta contract,
Existing reference, coverage targets, identity reviews, `resolved_unknown_ids`,
and Reproductive Mechanism array requirements. They do not contain the old
hierarchical Candidate wording.

## Verification

- `node --check ai/analyzer.js ai/world-supplement-protocol.js ai/prompts.js`: passed.
- Required World Model/debug/API profile run: 322 tests, 290 passed, 32 known baseline failures.
- `npm test`: 1083 tests, 1046 passed, 37 failures; failures are existing prompt/UI/runtime baseline identities, with no Phase 5 production diff.
- `git diff --check`: passed.

No Debug Schema v3, parser, Resolver, current guard, Patch V2 semantics, retry,
Snapshot, persistence, readback, or UI projection code was modified.
