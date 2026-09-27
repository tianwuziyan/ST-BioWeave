# Supplement Completeness、Recent Debug 与 UI-Gated Persistence

## Goal

为 World Model Supplement 增加可审计的 coverage 与 identity completeness、最近 Fact Delta execution 诊断，以及 no-op/UI adoption persistence gate。

## Requirements

- Audit and document the existing Supplement attempt/retry path before changing it.
- Add deterministic, transient Coverage Target IDs and an independent Coverage Disposition grammar with only `EMITTED` and `NO_EVIDENCE`.
- Add species-level Identity Discovery Review subjects and an independent `REVIEWED` grammar without hardcoded biological-type vocabulary.
- Validate completeness separately from Fact correctness: exact-once target/review accounting, exact EMITTED-to-Fact mapping, and explicit incomplete diagnostics.
- Reuse the existing retry limit and payload path. Incomplete Supplement responses must not be reported as successful and must not persist canonical state.
- Preserve non-target Fact discovery and the existing Evidence Guard boundary.
- Keep `latest_fact_delta`, and add bounded recent execution summaries plus `latest_nonempty_fact_delta` to LIVE STATE without changing freshness or read-only semantics.
- Gate persistence when the canonical candidate is a no-op. Implement exact UI application-state candidate adoption acknowledgement if the existing lifecycle provides a safe hook; otherwise implement the no-op gate and document the concrete UI-gating blocker and hook design.
- Do not change Full mode, Floor Coordinator behavior, transaction identity, UI renderer/refresh behavior, Evidence Guard thresholds, or add real fixture hardcoding.

## Acceptance Criteria

- [ ] Existing retry flow, empty/incomplete behavior, evidence/Existing payload reuse, and final success condition are recorded.
- [ ] Coverage target IDs are stable for the same deterministic target input/order; disposition validation enforces exact accounting and allows non-target Facts.
- [ ] Identity review validation enforces exact accounting for required species subjects and does not invent Type vocabulary.
- [ ] Completeness diagnostics are distinct from parser/resolver/Guard/accepted Fact counts.
- [ ] Recent debug summaries preserve the latest and most recent non-empty Fact Delta and retain existing freshness/read-only fields.
- [ ] Zero-mutation candidates emit a skip diagnostic and create no Floor transaction.
- [ ] UI-gated persistence is either safely implemented with idempotent exact-revision acknowledgement, or explicitly deferred with tested no-op behavior and a concrete blocker.
- [ ] Focused regressions cover completeness, retry exhaustion, recent debug history, no-op persistence, UI adoption if implemented, and prior multiline/Evidence Guard behavior.
- [ ] `node --check` for modified JS, `npm run check`, and `git diff --check` pass; no commit or push is made.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
