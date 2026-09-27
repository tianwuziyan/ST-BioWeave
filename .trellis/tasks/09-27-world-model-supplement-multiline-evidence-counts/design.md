# Supplement multiline、Type Identity Guard 与 LIVE STATE 计数技术设计

## Boundary and data flow

```text
raw API response
  -> root framing and Fact block discovery
  -> per-Fact line/payload parse
  -> semantic validation
  -> resolver / Existing comparison / identity dependency
  -> internal Patch v2 operation
  -> Evidence Guard against permitted evidence only
  -> accepted operation
  -> existing canonical merge and Floor owner path
```

Parser rejection is counted at raw Fact block disposition. Resolver rejection is counted
only for parsed Facts that fail dependency, conflict, unsupported correction, or another
resolver-owned terminal rule. Evidence Guard rejection is counted only for parsed Facts
that resolved to an operation and fail the Guard. Accepted Fact is a parsed Fact that is
not in a rejection bucket and has an accepted/no-op disposition according to the existing
contract; accepted operation counts only operations that enter the accepted Patch v2 list.
The implementation must verify the exact no-op/dedup treatment against current tests and
avoid counting one Fact in two terminal buckets.

## Multiline parser policy

The parser will retain strict label parsing. It may append a physical line only when all
of the following are true: the parser is inside a valid Fact; a recognized payload label
has already been read; that label is explicitly allowed by the existing schema to contain
natural-language text; the new line is not a root/block marker, known label, unknown
`X:` label, Patch IR token, or malformed structural token; and appending cannot change
the address or payload schema. Normalization will use one deterministic separator and
preserve content rather than silently guessing a broken label.

Address labels (`Species`, `Biological_Type`, `Field`) and typed/structured payloads
remain single-line/schema-specific. `Projection_Rule_JSON`, JSON arrays, booleans and
identity Facts do not use ordinary continuation handling.

## Evidence audit and diagnostics

Reuse the current `factDeltaEvidenceUnitRecords` parent-context builder and existing
scope matcher. For a Type Identity operation, compare exact Species + Biological_Type
against candidate, scoped and matched permitted units. Existing is only comparison/baseline;
detail text cannot imply identity unless current formal identity semantics already say so.
If the evidence chain proves a matcher/scope preservation bug, patch only that root cause.
Otherwise keep the Guard fail-closed and add the unsupported regression.

Diagnostics will extend the existing evidence binding object rather than introduce a second
trace format. Indices refer to the same transient evidence-unit list, and concise reason
codes explain candidate/scoped/matched failure.

## LIVE STATE compatibility

The summary is produced at the analyzer result boundary, transported through the existing
Runtime diagnostic state and surfaced by `collectWorldModelLiveState()`. The UI/debug
collector remains a read-only projection. The new funnel fields become authoritative for
new diagnostics; legacy fields are retained only if current consumers require them and
must not imply `parsed + rejected = raw` when they combine stages.

## Rollback and risk

Keep edits limited to parser/prompt/analyzer diagnostic plumbing, existing debug display
projection, and focused tests. Do not touch `storage/floor-persistence-coordinator.js`
or add any writer. If Host-like tests expose a semantic ambiguity in the formal payload
schema, stop at evidence and preserve fail-closed behavior rather than broadening the
continuation set.
