# Execution Plan

## 1. Read-only closure audit

1. Inventory current health modules, runtime bridges, Event schema, Floor/Swipe storage paths, UI projection and Projection Context consumers.
2. Trace explicit `health_role=observation` eligibility and source Event / six-field Floor Version / fingerprint binding.
3. Trace evolution inputs and boundary semantics for short-term eligible, earliest recovery, expected boundary, long-term and permanent.
4. Trace aggregation, severity, UI and guidance to prove presentation-only behavior and inactive filtering.
5. Trace delete/edit/Swipe/version rebuild paths and source Event traceability.
6. Search for obsolete trajectory/Condition/freshness/legacy fallback contract or dead callers.
7. Compare implementation against domain specs, architecture and health docs; produce the required classification table with file/line evidence.

## 2. Host acceptance preparation

1. Define a fresh observation fixture shape without reusing legacy test data.
2. Record the initial Host state and evidence fields.
3. Advance Story Time before the expected boundary and verify no factual/persistence/AI mutation.
4. Advance to and beyond the expected boundary and verify derived inactivity and absence of recovery Event.
5. Reload/rebuild ST and verify identical derived state from Event + Assessment + Story Time.
6. Mark every item `PASS`, `FAIL`, or `NOT PROVEN`; only declare `CLOSED` if all required real-host checks pass and no contract gap/doc drift remains.

## Verification gates

- Read-only commands: `git status --short`, targeted `rg`, syntax/static checks and existing relevant tests only.
- No product-code writes, no test-data migration, no commit/push.
- Real ST Host checks must be explicitly distinguished from Node/static evidence.
- Final report must list modified files (task artifacts only), tests/checks run, unimplemented scope, and remaining Host acceptance risk.
