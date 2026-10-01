# Pre-confirmation Projection Timing 专项架构审计

## Goal

只读审计当前 ST-BioWeave 对尚未确认妊娠阶段 Projection timing 的时间模型、数据所有权、稳定性、Floor/Swipe 生命周期、World baseline 与 UI 接入点；不修改 production code、tests、docs、schema，不 commit/push。

## Scope and constraints

This is an AUDIT ONLY deliverable. Do not modify production code, tests, docs,
schema, or Git history; do not commit or push. Trellis task artifacts are the
only workflow metadata allowed to change.

The audit must use the current checkout and authoritative repository specs as
the source of truth. Do not infer current behavior from older task records.

## Requirements

The report must trace the real Projection rule schema, validator, evaluator,
generation, persistence, runtime evolution, context injection, Floor/Swipe
ownership, Tracking, Current State, World Model, Characters UI, and relevant
tests. It must answer sections A-J from the request, including:

- actual trigger, minimum elapsed time, expiration, realization, contradiction,
  and max-window semantics;
- the architectural reason Projection Core rejects probability, weight, RNG,
  random, and seed;
- ownership alternatives for character-level base timing and an
  exposure/observation-cycle effective timing instance;
- one-time sampling versus stable deterministic variance;
- factual Current Biological State modifier boundaries;
- the future Characters UI entry point without implementing it;
- Human baseline ownership without hard-coding medical values;
- edit/delete/invalidation behavior for source Events, identity, config,
  World Model, Swipe, confirmation, loss, and abortion;
- a minimal data model, production change surface, test plan, documentation
  and spec update plan, risks, open product questions, and implementation order.

The product semantics to audit are fixed: timing only gates possible
pre-confirmation Projection eligibility; it never creates factual pregnancy,
conception, symptoms, BiologicalEvents, or Current State. A factual
pregnancy_confirmation exits this responsibility. Projections are Context
input only and never Event evidence. Character eligibility remains
capability/world-model driven, not gender-driven.

## Acceptance Criteria

- [ ] Deliver a structured Chinese audit report with the required sections:
      CURRENT IMPLEMENTATION MAP; EXISTING TIME/TRIGGER/EXPIRATION SEMANTICS;
      DATA OWNERSHIP OPTIONS; RANDOMNESS / DETERMINISM OPTIONS; STATE MODIFIER
      BOUNDARY; UI INTEGRATION POINT; BASELINE OWNERSHIP; EDIT/DELETE/STALE
      BEHAVIOR; MINIMAL DATA MODEL PROPOSAL; MINIMAL PRODUCTION CHANGE SURFACE;
      TEST PLAN; DOCS/SPEC UPDATE PLAN; RISKS / OPEN QUESTIONS; and
      RECOMMENDED IMPLEMENTATION ORDER.
- [ ] Every current-behavior conclusion is tied to current file/symbol or
      authoritative spec/test evidence; schema-only inference is not accepted.
- [ ] The report distinguishes confirmed implementation facts, architectural
      recommendations, and unresolved product decisions.
- [ ] The final `PRE_CONFIRMATION_TIMING_AUDIT` block explicitly reports
      existing support, missing primitives, recommended owners, max-window
      strategy, randomness, state modifier, World baseline, UI entry point,
      and implementation readiness.
- [ ] Confirm via Git status/diff that no production code, tests, docs, schema,
      commit, or push changed. Report any Trellis-only task artifact changes.
- [ ] Markdown impact is assessed for the hypothetical future implementation,
      but no repository Markdown is changed in this audit-only task.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.

## Design phase addendum

The next phase is `PRE-CONFIRMATION PROJECTION TIMING CONTRACT DESIGN`.
It remains DESIGN ONLY: production code, tests, UI, existing schema, commits,
and pushes are out of scope. Only this Trellis task's design/decision artifacts
may be updated.

The following product decisions are frozen for the design:

- Character timing configuration is Chat-local and separate from
  `character_registry`, `tracking_subjects`, profiles, Current State, and
  Snapshot.
- An observation timing instance is a small persisted Projection/Timing-domain
  record, not an Event, Pregnancy Episode, Tracking Window, Current State,
  Snapshot, Context record, or Projection.
- A compatible additional exposure joins an active cycle without re-sampling;
  runtime/UI actions never define biological cycle identity.
- Timing results are frozen at creation, including config/rule/state snapshots
  and effective min/max. The max boundary is inclusive and only gates first
  Projection generation.
- Randomness stays outside `projection_rule`; v1 uses one-time bounded sampling
  persisted in the timing instance.
- State modifiers consume only factual Current Biological State and may be zero
  in v1. They never consume Projection Context or narrative mood.
- Confirmation, loss, and abortion terminate the pre-confirmation responsibility
  without reopening an old cycle; future independent factual exposure may start
  a new cycle.
- Human timing baseline is composed at the World Model authority boundary. The
  Runtime has no real-world Human fallback, and no medical default values are
  specified in this task.
- Pregnancy Exposure Tracking Window remains NOT IMPLEMENTED.
