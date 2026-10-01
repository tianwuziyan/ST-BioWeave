# Projection Runtime Integration

## Goal

Connect existing Projection core, generation, Floor-owned persistence, Context, Runtime DTO, and minimal UI into the production Runtime without changing frozen domain semantics.

## Requirements

- Projection remains derived/future possibility and never becomes a BiologicalEvent, Current Biological State, Pregnancy Episode, or Snapshot field.
- Add `runtime/projection-runtime.js` as the Projection Runtime feature owner for post-processing after factual Event persistence/readback, Tracking, StateReducer, and Snapshot.
- Implement independent execution identity and single-flight for Chat, complete Floor Version, active Swipe, factual-basis fingerprint, and World/rule fingerprint.
- Run evolution before eligibility, persist only terminal lifecycle decisions, reread views, then generate missing eligible identities serially with one AI request per decision.
- Reuse `ai/analyzer.js::generateProjection`, existing generation validation, and `storage/projection.js`.
- Enforce pre-request, post-response, and pre-persistence stale guards. Stale results must not persist.
- Keep Projection failure, retry, status, and notifications independent from factual Character/Event success.
- Expose read-only Projection DTOs and summaries through Runtime business data without triggering AI generation.
- Add a minimal Projection UI consumer and Overview active/recent summary; UI must not calculate eligibility or evolution.
- Preserve the same-Floor Context temporal boundary: a Projection generated after a factual execution cannot feed that same execution.
- Provide `refreshProjection` without rerunning World or Character/Event analysis; preserve append-only delete semantics.

## Acceptance Criteria

- [ ] New factual Floor success runs Projection post-processing only after factual state and Snapshot work succeeds.
- [ ] Manual Projection Refresh runs only Projection processing; World-only runs and existing Swipe switches do not invoke Projection AI.
- [ ] No eligible, unresolved, not-eligible, or existing same-identity decision invokes AI.
- [ ] Duplicate lifecycle events, same-Floor rereads, panel reopen, and concurrent calls are single-flight/idempotent.
- [ ] One candidate failure does not roll back sibling successful candidates.
- [ ] Evolution covers keep_active, realized, contradicted, expired, and unresolved without rewriting history.
- [ ] Stale Floor Version, Swipe, facts, Story Time, World/rule, or execution identity prevents persistence.
- [ ] Valid candidates and lifecycle records use the existing Floor-owned append-only projection timeline.
- [ ] Readback returns Runtime Projection DTOs and active/recent summary without causing generation.
- [ ] Context does not create same-Floor circular feedback and may expose persisted views to a later factual execution.
- [ ] Projection failure leaves Events, Current State, Snapshot, and factual success unchanged.
- [ ] Active Swipe isolation and historical Floor immutability remain intact.
- [ ] Minimal Projection UI supports empty/list/status/refresh and existing delete semantics without business calculations.
- [ ] Existing Projection core and persistence tests remain green; new Runtime/UI integration tests cover the frozen contract.
- [ ] `npm run check` and `git diff --check` pass with zero failures, skips, todos, and no focused-test bypasses.

## Confirmed Scope Decisions

- One logical Projection exists per `chat + subject + projection rule + development concern`; Floor Version, source Event set, display text, Story Time, and random output are not identity fields.
- Terminal identities are not regenerated. Multi-round same-identity generation is out of scope.
- Tracking Window, Gestational Age/EDD, Genealogy, Character Profile redesign, World Model schema changes, and Snapshot schema changes are out of scope.
- Projection persistence remains Floor-owned and timeline-backed; no Chat-level or Runtime-only authoritative store is allowed.

## Blocking Open Questions

None. The implementation may choose the narrowest code-level mechanism for the already-frozen Context temporal boundary, provided automated tests prove no same-Floor circular feedback.
