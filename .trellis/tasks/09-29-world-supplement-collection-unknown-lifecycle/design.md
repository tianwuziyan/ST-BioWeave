# Technical Design

## Boundary

Keep the existing World Model owner and persistence coordinator. Add the smallest
Supplement-only resolution metadata at the JSON protocol boundary, then reduce it
to deterministic operations before the existing v2 canonical mutation layer.

```text
permitted evidence
  → one Supplement JSON request/response
  → JSON structural validation + resolution declarations
  → Fact address/dependency/evidence-membership safety
  → canonical collection/scalar mutation into transient Execution Snapshot
  → accepted-Fact-bound Unknown removal in the same Snapshot
  → saveWorldModel()
  → commitFloorPatch(owner="world")
  → authoritative readback
```

## Proposed contracts

### Mutation classes

| Class | Fields | Operation | Ordering |
|---|---|---|---|
| Scalar | descriptions, capabilities, reproduction/lifecycle, medical | `SET_FIELD` replacement | addressed value replaces old value |
| Collection | `Special_Rule` | `ADD_SPECIAL_RULE` | preserve old order, append response order, canonical normalized dedupe |
| Collection | `Exception` | `ADD_EXCEPTION` | preserve old order, append response order, host-owned canonical identity/equivalence |
| Queue | `Unknown` | `ADD_UNKNOWN` plus bound removals | retain old order, append new order, remove only accepted bindings |

Collection ordering is an explicit invariant, not a normalization preference:
remove the current appended-entry re-sort from the Supplement merge path. For
each collection, retain every existing item at its original index, then append
accepted unique response items in their response/acceptance order. Thus
`[A, B] + C` is exactly `[A, B, C]`; it must never become an alphabetically or
identity-sorted alternative. Any shared sorter must be split or bypassed for
Supplement while preserving any independently proven Full contract.

### Unknown identity and binding

First reuse canonical normalized Unknown text as the stable identity material. If
the current canonical schema cannot expose that as a stable reference in the
request, derive a host-owned deterministic `unknown_id` from the canonical
normalized text (and its world address/versioned identity contract), never from
time, randomness, or model-generated IDs. Keep persisted schema compatibility
unless a stable non-persisted address is insufficient.

The response adds only the minimum control shape required by the audit, expected
to be `resolved_unknown_ids`, with each ID accepted only when the same response
contains at least one resolving Fact whose exact canonical address is the Unknown's
declared expected address. If an existing Unknown has no explicit expected address,
the design must use the simplest stable canonical Unknown identity/address
available in the current schema and record the binding in diagnostics; it must not
infer resolution from textual similarity alone.

### Guard split

Extract a Supplement structured-Fact guard that checks structural validity,
canonical address/dependency, permitted evidence membership and scope safety, but
does not run field-specific capability/reproduction/lifecycle/collection semantic
regexes. This is a required cleanup deliverable: the Supplement production path
must no longer enter Candidate-era field-specific semantic NLP reclassification.
Keep Full-only complete-model evidence logic and any Patch v2 safety helper that is
independently structural. Remove the temporary `structuredFactDelta` flag if a
clean split is safe; otherwise document the exact blocker and isolate the call
sites so Supplement cannot execute the Full semantic branch.

### Snapshot and diagnostics

The reducer must apply accepted Facts first, verify each claimed resolution against
accepted Fact results, then remove only bound Unknowns from the same cloned model.
Diagnostics should expose append/dedupe/retention/removal/rejection reasons in the
existing trace style, including counts sufficient to distinguish a claimed but
rejected resolution from an unresolved/no-evidence retention.

## Compatibility and risk

- Full analysis and its complete-model guard remain unchanged unless a helper split
  is required to prevent Supplement entry.
- Existing `format_retry` remains a transport/format recovery exception only. No
  continuation or completeness semantic retry is added.
- Existing order must not be normalized by alphabetical sorting. If canonical
  normalization currently sorts a collection, change only the Supplement merge
  boundary and add an explicit regression.
- Persistence remains owner-scoped and coordinator-owned; no direct Floor writes.
